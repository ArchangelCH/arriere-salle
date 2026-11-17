"""Les boutiques du MJ : la TV n'en reçoit que la partie publique (/api/table/boutique/<jeton>), au prix ajusté pour la
tablée ; jamais les notes du MJ, le stock chiffré, un article caché, le lieu, ni le nom d'un marchand inconnu des joueurs."""

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

import main  # noqa: E402
from sources_front import source_page  # noqa: E402
from api import application, config, tv_boutique_combat, tv_cartes, utilitaires  # noqa: E402

J = tv_cartes.jeton


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture
def fiches(client):
    """Un marchand connu, un autre inconnu, un lieu ; retirés après l'essai (la tablée et le carnet restent propres)."""
    crees = {
        "bran": client.post("/api/pnj", json={"nom": "Bran le Borgne", "connu": True, "secret": "SECRET-DE-BRAN"}).json(),
        "ombre": client.post("/api/pnj", json={"nom": "Silas l'Ombre", "connu": False}).json(),
        "pont": client.post("/api/lieux", json={"nom": "Le Pont-aux-Roseaux", "connu": True}).json(),
    }
    yield crees
    client.delete(f"/api/pnj/{crees['bran']['id']}")
    client.delete(f"/api/pnj/{crees['ombre']['id']}")
    client.delete(f"/api/lieux/{crees['pont']['id']}")


def boutique(client, **champs):
    b = client.post("/api/boutiques", json={"nom": "Le Comptoir", "accroche": "", "marchand": "", "lieu": "", "ajustement": 0,
                                            "notes_mj": "", "articles": [], **champs}).json()
    return b, J("boutiques", b["id"])


def article(ident, nom, prix, **champs):
    return {"id": ident, "nom": nom, "prix": prix, "categorie": "", "description": "", "note_mj": "", "stock": None, "cache": False, **champs}


def test_rien_du_mj_ne_sort(client, fiches):
    b, j = boutique(
        client, nom="Le Comptoir du Pont", accroche="Tout pour la route.", marchand=fiches["bran"]["id"], lieu=fiches["pont"]["id"],
        notes_mj="NOTE-DE-LA-BOUTIQUE",
        articles=[
            article("aaa111", "Épée", "25", categorie="Armes", description="Acier honnête.", note_mj="NOTE-DE-L-ARTICLE", stock=3),
            article("bbb222", "POTION-INTERDITE", "100", categorie="Curiosités", cache=True, description="DESCRIPTION-CACHEE"),
            article("ccc333", "  ", "5"),  # un article sans nom ne part pas
        ],
    )
    r = client.get(f"/api/table/boutique/{j}")
    assert r.status_code == 200
    d = r.json()
    assert d == {
        "id": j, "nom": "Le Comptoir du Pont", "accroche": "Tout pour la route.", "marchand": "Bran le Borgne", "portrait": None,
        "articles": [{"id": "aaa111", "nom": "Épée", "prix": "25", "categorie": "Armes", "description": "Acier honnête.", "epuise": False,
                      "dessin": ""}],
    }
    for interdit in ("NOTE-DE", "POTION-INTERDITE", "DESCRIPTION-CACHEE", "SECRET-DE-BRAN", "stock", fiches["pont"]["id"], "Pont-aux-Roseaux",
                     fiches["bran"]["id"], b["id"]):
        assert interdit not in r.text, interdit
    # La TV ne connaît la boutique que par son jeton : ni l'identifiant, ni un jeton inventé.
    assert client.get(f"/api/table/boutique/{b['id']}").status_code == 404
    assert client.get("/api/table/boutique/0123456789abcdef0123").status_code == 404
    assert client.get("/api/table/boutique/..%2Fpnj").status_code == 404
    client.delete(f"/api/boutiques/{b['id']}")


def test_un_marchand_inconnu_n_est_pas_nomme(client, fiches):
    b, j = boutique(client, marchand=fiches["ombre"]["id"], articles=[article("aaa111", "Dague", "3")])
    r = client.get(f"/api/table/boutique/{j}")
    assert r.json()["marchand"] == "" and "Silas" not in r.text
    # Connu ensuite : son nom paraît. Un PNJ disparu ou un identifiant tordu ne casse rien.
    client.patch(f"/api/pnj/{fiches['ombre']['id']}", json={"connu": True})
    assert client.get(f"/api/table/boutique/{j}").json()["marchand"] == "Silas l'Ombre"
    for marchand in ("pnj-disparu", "../secret", 12, None):
        client.patch(f"/api/boutiques/{b['id']}", json={"marchand": marchand})
        assert client.get(f"/api/table/boutique/{j}").json()["marchand"] == ""
    client.delete(f"/api/boutiques/{b['id']}")


@pytest.mark.parametrize("prix, ajustement, attendu", [
    ("25", -10, "23"),  # 22,5 : la moitié vers le haut
    ("25", 0, "25"),
    ("80", 20, "96"),
    ("à partir de 150", -10, "à partir de 135"),
    ("15 / 120 / 600", 20, "18 / 144 / 720"),
    ("1", -60, "1"),  # jamais sous 1 pour un prix non nul
    ("3", -100, "1"),
    ("0", 50, "0"),
    ("sur demande", 20, "sur demande"),
    ("2,5", 10, "3"),
    ("2,5", 0, "2,5"),  # sans ajustement, le prix reste tel que tapé
    ("  40 po ", 10, "44 po"),
])
def test_l_ajustement_des_prix(prix, ajustement, attendu):
    assert tv_boutique_combat.prix_ajuste(prix, ajustement) == attendu


def test_l_ajustement_de_la_boutique_passe_a_la_tv(client):
    articles = [article("aaa111", "Épée", "25"), article("bbb222", "Gemme brute", "à partir de 150")]
    b, j = boutique(client, ajustement=-10, articles=articles)
    assert [a["prix"] for a in client.get(f"/api/table/boutique/{j}").json()["articles"]] == ["23", "à partir de 135"]
    # Une valeur illisible vaut 0 ; une valeur folle est bornée.
    for valeur, epee in (("beaucoup", "25"), (True, "25"), (None, "25"), ("nan", "25"), (5000, "275"), (-300, "1")):
        client.patch(f"/api/boutiques/{b['id']}", json={"ajustement": valeur})
        assert client.get(f"/api/table/boutique/{j}").json()["articles"][0]["prix"] == epee, valeur
    client.delete(f"/api/boutiques/{b['id']}")


def test_un_article_epuise_est_dit_sans_son_stock(client):
    b, j = boutique(client, articles=[
        article("aaa111", "Sans limite", "1", stock=None), article("bbb222", "Encore deux", "1", stock=2),
        article("ccc333", "Plus rien", "1", stock=0), article("ddd444", "Stock bizarre", "1", stock="deux"),
    ])
    d = client.get(f"/api/table/boutique/{j}").json()
    assert [(a["nom"], a["epuise"]) for a in d["articles"]] == [
        ("Sans limite", False), ("Encore deux", False), ("Plus rien", True), ("Stock bizarre", False)]
    assert all("stock" not in a for a in d["articles"])
    client.delete(f"/api/boutiques/{b['id']}")


def test_le_nom_cache_de_l_auberge_est_masque(client):
    b, j = boutique(client, nom="Le comptoir de la Petite Fanfrelée", accroche="Comme à la Fanfrelée, on paie d'avance.",
                    articles=[article("aaa111", "Chope de la Petite Fanfrelée", "2", categorie="Souvenirs de la Fanfrelée",
                                      description="Gravée « Jamais ne dort »")])
    r = client.get(f"/api/table/boutique/{j}")
    assert r.status_code == 200
    assert "anfrel" not in r.text and "ne dort" not in r.text
    assert r.json()["articles"][0]["id"] == "aaa111"
    client.delete(f"/api/boutiques/{b['id']}")


def test_l_article_montre_de_pres_passe_a_la_tv(client):
    b, j = boutique(client, articles=[article("aaa111", "Épée", "25")])
    client.put("/api/table", json={"vue": "boutique", "boutique": b["id"], "article": "aaa111", "avant": {"vue": "plan", "plan": "un-plan"}})
    with client.websocket_connect("/ws/table") as ws:
        tv = json.loads(ws.receive_text())["etat"]
    assert tv["vue"] == "boutique" and tv["boutique"] == j and tv["article"] == "aaa111"
    assert "avant" not in tv and b["id"] not in json.dumps(tv)
    # Un identifiant d'article qui n'a pas la forme attendue ne passe pas.
    for mauvais in ("../x", "AAA111", "a" * 40, 12, "<b>", ""):
        client.put("/api/table", json={"vue": "boutique", "boutique": b["id"], "article": mauvais})
        with client.websocket_connect("/ws/table") as ws:
            assert "article" not in json.loads(ws.receive_text())["etat"], mauvais
    client.put("/api/table", json={"vue": "accueil"})
    client.delete(f"/api/boutiques/{b['id']}")


def test_les_prix_du_kit_et_le_calcul_de_l_atelier():
    """Le calcul des prix de l'atelier et de la TV (js/boutiques/commun.js) est le même que celui du serveur : même
    arrondi, même borne ; et les prix du kit y sont ceux du kit de règles."""
    source = (Path(__file__).resolve().parent.parent / "app" / "static" / "js" / "boutiques" / "commun.js").read_text(encoding="utf-8")
    assert "Math.max(1, Math.floor((n * (100 + pourcent)) / 100 + 0.5))" in source
    assert f"AJUSTEMENT_MIN = {tv_boutique_combat.AJUSTEMENT_MIN}" in source and f"AJUSTEMENT_MAX = {tv_boutique_combat.AJUSTEMENT_MAX}" in source
    for nom, prix in (("Repas et lit à l'auberge", "1"), ("Semaine de vivres", "5"), ("Dague", "3"), ("Bâton", "3"), ("Épée", "25"),
                      ("Arc long", "25"), ("Arbalète", "40"), ("Armure de cuir", "15"), ("Cotte de mailles", "120"),
                      ("Armure de plaques", "600"), ("Cheval", "80"), ("Trousse de soins (5 usages)", "10"),
                      ("Potion de soins (1D6+2)", "30"), ("Gemme brute", "à partir de 150")):
        assert f'nom: "{nom}", prix: "{prix}"' in source, nom


def test_le_portrait_du_marchand_seulement_s_il_est_connu(client, fiches):
    """L'échoppe de la TV montre le marchand dans un cadre : son portrait ne part que s'il est connu des joueurs, et
    jamais une illustration secrète."""
    ident = fiches["ombre"]["id"]
    chemin = config.PNJ / f"{ident}.json"
    fiche = utilitaires.lire_fiche(chemin)
    fiche["illustrations"] = [{"url": "/media/secret-de-silas.jpg", "secrete": True}, {"url": "/media/portrait-de-silas.jpg"}]
    fiche["illustration"] = "/media/secret-de-silas.jpg"
    utilitaires.ecrire(chemin, fiche)
    b, j = boutique(client, marchand=ident, articles=[article("aaa111", "Dague", "3")])
    r = client.get(f"/api/table/boutique/{j}")
    assert r.json()["portrait"] is None and "silas" not in r.text.lower()
    client.patch(f"/api/pnj/{ident}", json={"connu": True})
    d = client.get(f"/api/table/boutique/{j}").json()
    assert d["marchand"] == "Silas l'Ombre" and d["portrait"] == "/media/portrait-de-silas.jpg"
    client.delete(f"/api/boutiques/{b['id']}")


def test_le_dessin_d_un_article_passe_s_il_est_connu():
    """Le dessin choisi par le MJ (article.dessin) part avec l'article s'il fait partie de ceux que la TV sait peindre
    (même liste que boutiques/objets.js) ; sinon il est vide, et la TV le devine d'après le nom."""
    js = (Path(__file__).resolve().parent.parent / "app" / "static" / "js" / "boutiques" / "objets.js").read_text(encoding="utf-8")
    liste = js.split("export const NOMS_DESSINS = [")[1].split("];")[0]
    assert tuple(re.findall(r'\["([a-z]+)", "', liste)) == tv_boutique_combat.DESSINS_ARTICLE
    for dessin in tv_boutique_combat.DESSINS_ARTICLE:
        assert f"  {dessin}: (u" in js, dessin
    for dessin, attendu in (("marteau", "marteau"), ("", ""), ("licorne", ""), (3, ""), (None, ""), ("../x", "")):
        assert tv_boutique_combat.article_public(article("aaa111", "Épée", "25", dessin=dessin), 0)["dessin"] == attendu


def test_l_echoppe_de_la_tv():
    """La boutique de la TV est une échoppe : enseigne, marchand, étagères où chaque article est peint (objets.js) ; plus
    rien de l'ancienne carte de marchand."""
    statique = Path(__file__).resolve().parent.parent / "app" / "static"
    html = (statique / "table.html").read_text(encoding="utf-8")
    assert '<div class="echoppe">' in html and 'class="etageres-tv"' in html and 'class="marchand-tv"' in html
    table = source_page("table")
    assert 'import { objetSvg } from "../boutiques/objets.js";' in table
    css = (statique / "css" / "table.css").read_text(encoding="utf-8")
    for ancien in ("carte-marchand", "tete-marchand", ".rayons"):
        assert ancien not in table and ancien not in css, ancien

