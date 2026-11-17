"""Les documents remis aux joueurs (documents.py, js/documents/) : une lettre, une affiche, une note, un parchemin, un
plan. La TV et la table publique ne lisent un document que tant que la TV le montre ; un document jamais montré ne sort
jamais (TV, table publique, carnet), et les notes du MJ ne sortent jamais. Une fois montré, il entre au carnet de la
compagnie (« Documents reçus »), passé au masque et à la vérification des inconnus, sauf si le MJ l'en retire."""

import json
import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from commun import carnet  # noqa: E402
import joueurs  # noqa: E402
from table import lectures_publiques  # noqa: E402
import main  # noqa: E402
from sources_front import source_page  # noqa: E402
from api import application, carnet_api, config, portier, tv_cartes, tv_ecran, tv_etat  # noqa: E402

STATIQUE = Path(config.ICI) / "static"
CF = {"CF-Connecting-IP": "203.0.113.7"}
CARNET = config.PROPOSITIONS / carnet.CARNET
NOTE = "NOTE-DU-MJ-SUR-LA-LETTRE"


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture
def lettre(client):
    config.TABLE_OUVERTURE.unlink(missing_ok=True)  # sans réglage, la table publique est ouverte
    d = client.post("/api/documents", json={
        "nom": "La lettre de Bran", "genre": "lettre", "texte": "Frère,\n\nNous dormirons à la Petite Fanfrelée, puis le gué.",
        "signature": "Bran", "notes_mj": NOTE, "image": "/media/inexistante.jpg"}).json()
    yield d
    client.put("/api/table", json={"vue": "accueil"})
    client.put("/api/carnet-joueurs", json={"ouvert": False})
    client.delete(f"/api/documents/{d['id']}")


def jeton(d):
    return tv_cartes.jeton("documents", d["id"])


def montrer(client, d):
    assert client.put("/api/table", json={"vue": "document", "document": d["id"]}).status_code == 200


def publie(nom: str) -> list:
    return (carnet.lire_publie(CARNET / f"{nom}.json") or {}).get("elements") or []


def test_un_document_jamais_montre_ne_sort_pas(client, lettre):
    j = jeton(lettre)
    assert client.get(f"/api/table/document/{j}").status_code == 404
    assert client.get(f"/api/table/document/{j}", headers=CF).status_code == 404
    # Ni par son identifiant, ni par un jeton inventé.
    assert client.get(f"/api/table/document/{lettre['id']}").status_code == 404
    assert client.get("/api/table/document/0123456789abcdef0123").status_code == 404
    assert client.get(f"/api/documents/{lettre['id']}").json()["montre"] is None
    # Le carnet, ouvert, ne le reçoit pas.
    client.put("/api/carnet-joueurs", json={"ouvert": True})
    carnet_api.publier_carnet()
    assert all(x["nom"] != "La lettre de Bran" for x in publie("documents"))
    assert NOTE not in json.dumps(publie("documents"))


def test_montre_la_tv_lit_le_texte_public_et_rien_d_autre(client, lettre):
    j = jeton(lettre)
    montrer(client, lettre)
    r = client.get(f"/api/table/document/{j}")
    assert r.status_code == 200
    d = r.json()
    assert d == {"id": j, "genre": "lettre", "nom": "La lettre de Bran", "texte": "Frère,\n\nNous dormirons à l'auberge, puis le gué.",
                 "signature": "Bran", "image": None, "sceau": False}
    for interdit in (NOTE, "anfrel", lettre["id"], "notes_mj", "montre"):
        assert interdit not in r.text, interdit
    # La table publique le lit tant que la TV le montre, pas une seconde de plus.
    assert client.get(f"/api/table/document/{j}", headers=CF).status_code == 200
    client.put("/api/table", json={"vue": "plan", "plan": "un-plan", "document": lettre["id"]})
    assert client.get(f"/api/table/document/{j}", headers=CF).status_code == 404
    assert client.get(f"/api/table/document/{j}").status_code == 404
    # L'état que reçoit la TV : le jeton, jamais l'identifiant ni les notes.
    montrer(client, lettre)
    public = tv_etat.etat_public(tv_ecran.etat_table())
    assert public["vue"] == "document" and public["document"] == j and lettre["id"] not in json.dumps(public)


def test_la_premiere_fois_est_notee_et_le_carnet_le_recoit(client, lettre):
    montrer(client, lettre)
    fiche = client.get(f"/api/documents/{lettre['id']}").json()
    assert fiche["montre"] and fiche["modifie"] == lettre["modifie"], "la version de la fiche ne bouge pas"
    premiere = fiche["montre"]
    montrer(client, lettre)
    assert client.get(f"/api/documents/{lettre['id']}").json()["montre"] == premiere
    # Ni un enregistrement de la fiche entière (un écran ouvert avant), ni un PATCH n'effacent la date.
    client.put(f"/api/documents/{lettre['id']}", json={**fiche, "montre": None, "version_base": fiche["modifie"]})
    client.patch(f"/api/documents/{lettre['id']}", json={"montre": None})
    assert client.get(f"/api/documents/{lettre['id']}").json()["montre"] == premiere
    client.put("/api/carnet-joueurs", json={"ouvert": True})
    carnet_api.publier_carnet()
    recus = [x for x in publie("documents") if x["nom"] == "La lettre de Bran"]
    assert len(recus) == 1
    x = recus[0]
    assert x["texte"] == "Frère,\n\nNous dormirons à l'auberge, puis le gué." and x["date"] == premiere[:10] and x["image"] is None
    tout = json.dumps(publie("documents"), ensure_ascii=False)
    for interdit in (NOTE, "anfrel", '"notes_mj"', lettre["id"]):
        assert interdit not in tout, interdit
    # Ce que lit un joueur : la même section, par le coin des joueurs.
    assert "documents" in carnet.SECTIONS
    assert any(y["nom"] == "La lettre de Bran" for y in carnet.vue_du_carnet({"documents": publie("documents")}, None, None, "Léa")["documents"])


def test_garder_dans_le_carnet_decoche(client, lettre):
    montrer(client, lettre)
    client.patch(f"/api/documents/{lettre['id']}", json={"dans_le_carnet": False})
    client.put("/api/carnet-joueurs", json={"ouvert": True})
    carnet_api.publier_carnet()
    assert all(x["nom"] != "La lettre de Bran" for x in publie("documents"))
    client.patch(f"/api/documents/{lettre['id']}", json={"dans_le_carnet": True})
    carnet_api.publier_carnet()
    assert any(x["nom"] == "La lettre de Bran" for x in publie("documents"))


def test_un_inconnu_nomme_est_signale_puis_retenu_au_carnet(client, lettre):
    pnj = client.post("/api/pnj", json={"nom": "Ludovic Ombrelune", "connu": False}).json()
    try:
        client.patch(f"/api/documents/{lettre['id']}", json={"texte": "Méfie-toi de Ludovic Ombrelune, il sait tout."})
        secrets = client.get(f"/api/documents/{lettre['id']}/inconnus").json()["secrets"]
        assert [s["nom"] for s in secrets] == ["Ludovic Ombrelune"]
        imprime = client.get(f"/api/documents/{lettre['id']}/imprime").json()
        assert [s["nom"] for s in imprime["secrets"]] == ["Ludovic Ombrelune"] and NOTE not in json.dumps(imprime)
        montrer(client, lettre)
        client.put("/api/carnet-joueurs", json={"ouvert": True})
        carnet_api.publier_carnet()
        assert "Ombrelune" not in json.dumps(publie("documents"), ensure_ascii=False)
        retenus = client.get("/api/carnet-joueurs").json()["retenus"]
        assert any("La lettre de Bran" in r and "Ludovic Ombrelune" in r for r in retenus)
        # Une signature qui nomme l'inconnu : seule la signature s'efface.
        client.patch(f"/api/documents/{lettre['id']}", json={"texte": "Rendez-vous au gué.", "signature": "Ludovic Ombrelune"})
        carnet_api.publier_carnet()
        x = next(y for y in publie("documents") if y["nom"] == "La lettre de Bran")
        assert x["signature"] == "" and x["texte"] == "Rendez-vous au gué."
    finally:
        client.delete(f"/api/pnj/{pnj['id']}")


def test_corbeille_versions_et_recherche(client, lettre):
    assert client.delete(f"/api/documents/{lettre['id']}").status_code == 200
    jetees = [x for x in client.get("/api/corbeille").json()["elements"] if x["collection"] == "documents"]
    assert any(x["id"] == lettre["id"] and x["nom"] == "La lettre de Bran" for x in jetees)
    assert client.post(f"/api/corbeille/documents/{lettre['id']}/annuler").status_code == 200
    assert client.get(f"/api/documents/{lettre['id']}").json()["notes_mj"] == NOTE
    assert any(x["id"] == lettre["id"] for x in client.get("/api/recherche").json()["documents"])


@pytest.mark.parametrize("chemin", ["/api/documents", "/api/documents/un-document", "/api/documents/un-document/inconnus",
                                    "/api/documents/un-document/imprime", "/document-imprime", "/documents-imprimes",
                                    "/static/js/documents/documents.js", "/static/document-imprime.html"])
def test_l_atelier_des_documents_reste_ferme_a_la_table_publique(client, chemin):
    assert client.get(chemin, headers=CF).status_code == 404


def test_la_regle_de_la_table_publique_connait_les_documents():
    j = lambda c, i: f"{c}:{i}"  # noqa: E731
    montre = lectures_publiques.montre
    assert "document" in lectures_publiques.connues()
    assert montre("/api/table/document/documents:d", {"vue": "document", "document": "d"}, j)
    assert not montre("/api/table/document/documents:d", {"vue": "plan", "plan": "p", "document": "d"}, j)
    assert not montre("/api/table/document/documents:e", {"vue": "document", "document": "d"}, j)
    assert not montre("/api/table/document/documents:d/fond", {"vue": "document", "document": "d"}, j)


def test_la_tv_charge_le_papier_des_documents_lisible_par_chromium_79():
    html = (STATIQUE / "table.html").read_text(encoding="utf-8")
    assert '<link rel="stylesheet" href="/static/css/documents.css">' in html and 'class="document-tv"' in html
    assert portier.CHEMINS_TABLE.match("/static/css/documents.css")
    table = source_page("table")
    assert 'from "../documents/rendu.js"' in table and 'etat.vue === "document" && etat.document ? "document"' in table
    css = re.sub(r"/\*.*?\*/", "", (STATIQUE / "css" / "documents.css").read_text(encoding="utf-8"), flags=re.S)
    assert not re.search(r"(^|[;{\s])inset\s*:", css) and ":has(" not in css and "aspect-ratio" not in css
    for regle in re.findall(r"\{([^{}]*)\}", css):
        if re.search(r"display\s*:\s*(inline-)?flex", regle):
            assert not re.search(r"(^|[;\s])(row-|column-)?gap\s*:", regle), regle
    rendu = (STATIQUE / "js" / "documents" / "rendu.js").read_text(encoding="utf-8")
    for recent in (".at(", "hasOwn", "structuredClone", "replaceAll", "findLast", "toSorted", "Promise.any", "?.", "??"):
        assert recent not in rendu, recent
    assert re.findall(r'^import .* from "([^"]+)";$', rendu, flags=re.M) == ["../api.js"]


def test_le_coin_des_joueurs_sert_le_papier_des_documents_reçus():
    for f in ("css/documents.css", "js/documents/rendu.js", "img/parchemin.jpg"):
        assert f in joueurs.FICHIERS, f
    for page in ("carnet.html", "apercu.html"):
        assert "/static/css/documents.css" in (STATIQUE / "joueurs" / page).read_text(encoding="utf-8"), page
    vue = (STATIQUE / "js" / "joueurs" / "carnet-vue.js").read_text(encoding="utf-8")
    assert 'sectionCherchable("documents", "Documents reçus"' in vue
    # Le coin ne charge pas les modules de l'atelier (la TV, la question des inconnus).
    assert "js/documents/tv.js" not in joueurs.FICHIERS and "js/documents/documents.js" not in joueurs.FICHIERS


def test_le_texte_et_l_avertissement_ne_partent_pas_dans_l_etat(client, lettre):
    """document_maj (le MJ retouche un document montré) passe à la TV ; rien d'autre de la fiche."""
    client.put("/api/table", json={"vue": "document", "document": lettre["id"], "document_maj": "2026-11-07T18:00:00"})
    public = tv_etat.etat_public(tv_ecran.etat_table())
    assert public["document_maj"] == "2026-11-07T18:00:00"
    assert NOTE not in json.dumps(public) and "Bran" not in json.dumps(public)


def test_un_long_document_s_elargit_quel_que_soit_son_genre():
    """La largeur d'un long texte (deux colonnes) vient après celles des genres : sinon un long parchemin, une affiche ou
    une note restaient étroits, leurs deux colonnes minuscules à la TV."""
    css = re.sub(r"/\*.*?\*/", "", (STATIQUE / "css" / "documents.css").read_text(encoding="utf-8"), flags=re.S)
    largeurs = [(m.start(), m.group(1)) for m in re.finditer(r"\.document\.doc-([a-z]+)\s*\{[^}]*\bwidth:", css)]
    long_ = max(pos for pos, genre in largeurs if genre == "long")
    assert all(pos < long_ for pos, genre in largeurs if genre != "long"), largeurs


def test_au_telephone_le_bouton_de_la_tv_ne_couvre_pas_la_fiche():
    """Sous 900 px la page des documents défile entière : la fiche n'est plus un cadre qui défile, sinon le bouton collé
    « Montrer à la TV » s'y posait à la hauteur de l'en-tête, par-dessus les genres (iPhone plié et déplié)."""
    css = re.sub(r"/\*.*?\*/", "", (STATIQUE / "css" / "documents-atelier.css").read_text(encoding="utf-8"), flags=re.S)
    bloc = css[css.index("@media (max-width: 900px)"):]
    bloc = bloc[:bloc.index("\n}") + 2]
    assert re.search(r'body\[data-page="documents"\] \.fiche-document \{ overflow: visible; \}', bloc), bloc
