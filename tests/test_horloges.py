"""Les horloges de la menace : trois au plus, rangées dans l'état de la table et validées strictement par le serveur.
Vers la TV et la table publique ne partent que les horloges montrées, réduites à leur identifiant, leur nom (passé au
filtre des noms cachés), leurs parts et leurs parts remplies."""

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

from table import horloges  # noqa: E402
import main  # noqa: E402
from api import application, config, tv_etat  # noqa: E402
from sources_front import source_page  # noqa: E402

CF = {"CF-Connecting-IP": "203.0.113.7"}
STATIQUE = Path(__file__).resolve().parent.parent / "app" / "static"


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture(autouse=True)
def sans_horloges(client):
    """Chaque essai part d'une table sans horloge, table publique ouverte, et la laisse ainsi."""
    def vider():
        for h in client.get("/api/horloges").json()["horloges"]:
            client.delete(f"/api/horloges/{h['id']}")
    config.TABLE_OUVERTURE.unlink(missing_ok=True)
    vider()
    yield
    vider()
    config.TABLE_OUVERTURE.unlink(missing_ok=True)


def creer(client, nom="Le toit va céder", parts=6, **extra):
    r = client.post("/api/horloges", json={"nom": nom, "parts": parts, **extra})
    assert r.status_code == 200, r.text
    return next(h for h in r.json()["horloges"] if h["id"] == r.json()["horloge"])


def liste(client):
    return client.get("/api/horloges").json()["horloges"]


def changer(client, h, **corps):
    r = client.patch(f"/api/horloges/{h['id']}", json=corps)
    assert r.status_code == 200, r.text
    return next(x for x in r.json()["horloges"] if x["id"] == h["id"])


def etat_tv(client, entetes=None):
    with client.websocket_connect("/ws/table", headers=entetes or {}) as ws:
        return ws.receive_json()["etat"]


def test_une_horloge_se_cree_vide_et_cachee_et_persiste_avec_la_table(client):
    h = creer(client, nom="  Les chasseurs\n approchent  ", parts=4)
    assert re.fullmatch(r"[a-z0-9]{1,12}", h["id"])
    assert (h["nom"], h["parts"], h["remplies"], h["visible"]) == ("Les chasseurs approchent", 4, 0, False)
    assert liste(client) == [h]
    assert json.loads(config.TABLE.read_text(encoding="utf-8"))["horloges"] == [h]
    assert "horloges" not in etat_tv(client)


@pytest.mark.parametrize("parts", [0, 3, 5, 7, 10, -6, "6", 6.0, True, None, [6]])
def test_les_parts_hors_de_4_6_ou_8_sont_refusees(client, parts):
    assert client.post("/api/horloges", json={"nom": "Essai", "parts": parts}).status_code == 400
    assert liste(client) == []
    h = creer(client)
    assert client.patch(f"/api/horloges/{h['id']}", json={"parts": parts}).status_code == 400
    assert liste(client) == [h]


def test_les_parts_remplies_restent_entre_zero_et_le_nombre_de_parts(client):
    h = creer(client, parts=4)
    assert changer(client, h, pas=-1)["remplies"] == 0
    assert [changer(client, h, pas=1)["remplies"] for _ in range(6)] == [1, 2, 3, 4, 4, 4]
    url = f"/api/horloges/{h['id']}"
    for valeur in (5, -1, 2.0, "2", True, None):
        assert client.patch(url, json={"remplies": valeur}).status_code == 400, valeur
    for pas in (2, -2, 0, "1", 1.0, True, None):
        assert client.patch(url, json={"pas": pas}).status_code == 400, pas
    assert changer(client, h, remplies=1)["remplies"] == 1
    # Huit parts dont six remplies, ramenée à quatre : quatre remplies, pas une de plus.
    assert changer(client, h, parts=8, remplies=6)["remplies"] == 6
    assert (lambda x: (x["parts"], x["remplies"]))(changer(client, h, parts=4)) == (4, 4)
    # Tout ou rien : un champ refusé n'en laisse passer aucun.
    avant = liste(client)
    assert client.patch(url, json={"nom": "Autre nom", "remplies": 1, "parts": 5}).status_code == 400
    assert liste(client) == avant
    assert client.post("/api/horloges", json={"nom": "Trop pleine", "parts": 4, "remplies": 5}).status_code == 400
    assert client.post("/api/horloges", json={"nom": "Montrée ?", "parts": 4, "visible": "oui"}).status_code == 400


@pytest.mark.parametrize("nom", ["", "   ", "x" * 41, "Le toit " + "é" * 33, 12, None, ["Le toit"]])
def test_un_nom_vide_trop_long_ou_qui_n_est_pas_un_texte_est_refuse(client, nom):
    assert client.post("/api/horloges", json={"nom": nom, "parts": 6}).status_code == 400
    assert liste(client) == []
    h = creer(client)
    assert client.patch(f"/api/horloges/{h['id']}", json={"nom": nom}).status_code == 400
    assert liste(client) == [h]


def test_un_nom_de_quarante_caracteres_passe(client):
    assert creer(client, nom="é" * 40)["nom"] == "é" * 40


def test_trois_horloges_au_plus(client):
    trois = [creer(client, nom=f"Horloge {i}", parts=4) for i in range(3)]
    r = client.post("/api/horloges", json={"nom": "Quatrième", "parts": 4})
    assert r.status_code == 409 and "Trois horloges au plus" in r.json()["detail"]
    assert [h["nom"] for h in liste(client)] == ["Horloge 0", "Horloge 1", "Horloge 2"]
    # Une place libérée se reprend ; supprimer deux fois ne coûte rien.
    assert client.delete(f"/api/horloges/{trois[1]['id']}").status_code == 200
    assert client.delete(f"/api/horloges/{trois[1]['id']}").status_code == 200
    creer(client, nom="Quatrième", parts=4)
    assert [h["nom"] for h in liste(client)] == ["Horloge 0", "Horloge 2", "Quatrième"]
    assert client.patch(f"/api/horloges/{trois[1]['id']}", json={"pas": 1}).status_code == 404


def test_seules_les_horloges_montrees_partent_vers_la_tv_et_rien_d_autre(client):
    cachee = creer(client, nom="Le complot du MJ", parts=8)
    montree = creer(client, nom="Le toit va céder", parts=6)
    changer(client, cachee, remplies=5)
    changer(client, montree, visible=True, remplies=2)
    etat = etat_tv(client)
    assert etat["horloges"] == [{"id": montree["id"], "nom": "Le toit va céder", "parts": 6, "remplies": 2}]
    vu = json.dumps(etat, ensure_ascii=False)
    assert "complot" not in vu and cachee["id"] not in vu and "touchee" not in vu and "visible" not in vu
    # La table publique ouverte voit la même chose ; fermée, l'accueil seul.
    assert etat_tv(client, CF)["horloges"] == etat["horloges"]
    client.put("/api/table-publique", json={"ouverte": False})
    assert "horloges" not in etat_tv(client, CF)
    client.put("/api/table-publique", json={"ouverte": True})
    # Plus rien de montré : plus de clé du tout.
    changer(client, montree, visible=False)
    assert "horloges" not in etat_tv(client)


def test_le_nom_cache_de_l_auberge_sort_masque(client):
    h = creer(client, nom="La Petite Fanfrelée va brûler", parts=4)
    changer(client, h, visible=True)
    for entetes in (None, CF):
        etat = etat_tv(client, entetes)
        assert etat["horloges"][0]["nom"] == "L'auberge va brûler"
        assert "anfrel" not in json.dumps(etat, ensure_ascii=False).lower()
    changer(client, h, nom="Jamais ne dort : le toit cède")
    etat = etat_tv(client)
    assert etat["horloges"][0]["nom"] == "L'auberge : le toit cède" and "morte" not in json.dumps(etat, ensure_ascii=False)
    # L'atelier, lui, garde le nom tel que le MJ l'a écrit.
    assert liste(client)[0]["nom"] == "Jamais ne dort : le toit cède"


def test_un_ecran_qui_renvoie_la_table_garde_les_horloges(client):
    h = creer(client)
    changer(client, h, visible=True, remplies=3)
    attendu = liste(client)
    ancienne = client.get("/api/table").json()
    client.put("/api/table", json={"vue": "accueil"})
    pirate = [{"id": "pirate", "nom": "Piratée", "parts": 4, "remplies": 4, "visible": True}]
    client.put("/api/table", json={**ancienne, "horloges": pirate})
    assert liste(client) == attendu
    assert etat_tv(client)["horloges"] == [{"id": h["id"], "nom": "Le toit va céder", "parts": 6, "remplies": 3}]


def test_la_touche_h_avance_l_horloge_montree_touchee_en_dernier(client):
    r = client.post("/api/horloges/avancer", json={"pas": 1})
    assert r.status_code == 409 and "créez-en une" in r.json()["detail"]
    a = creer(client, nom="A", parts=4)
    b = creer(client, nom="B", parts=4)
    c = creer(client, nom="C, cachée", parts=4)
    changer(client, a, visible=True)
    changer(client, b, visible=True)
    changer(client, c, pas=1)  # touchée en dernier, mais cachée : H ne la voit pas
    r = client.post("/api/horloges/avancer", json={"pas": 1}).json()
    assert r["horloge"] == b["id"] and [h["remplies"] for h in r["horloges"]] == [0, 1, 1]
    changer(client, a, pas=1)
    r = client.post("/api/horloges/avancer", json={"pas": -1}).json()  # Maj+H
    assert r["horloge"] == a["id"] and [h["remplies"] for h in r["horloges"]] == [0, 1, 1]
    for _ in range(6):
        r = client.post("/api/horloges/avancer", json={}).json()
    assert [h["remplies"] for h in r["horloges"]] == [4, 1, 1]
    assert client.post("/api/horloges/avancer", json={"pas": 2}).status_code == 400
    changer(client, a, visible=False)
    changer(client, b, visible=False)
    # Plus rien de montré : H avance la dernière touchée (B, cachée), et l'atelier propose de la montrer.
    r = client.post("/api/horloges/avancer", json={"pas": 1}).json()
    assert r["horloge"] == b["id"] and [h["remplies"] for h in r["horloges"]] == [4, 2, 1]
    assert not next(h for h in r["horloges"] if h["id"] == b["id"])["visible"]


def test_une_horloge_cachee_qui_change_ne_derange_pas_les_ecrans(client, monkeypatch):
    envois = []

    async def noter(etat):
        envois.append(json.dumps(tv_etat.etat_public(etat), ensure_ascii=False))

    monkeypatch.setattr(tv_etat.diffusion, "diffuser", noter)
    h = creer(client)
    changer(client, h, pas=1)
    changer(client, h, nom="Le toit cède bientôt")
    assert envois == []
    changer(client, h, visible=True)
    changer(client, h, pas=1)
    client.delete(f"/api/horloges/{h['id']}")
    assert len(envois) == 3
    assert '"remplies": 1' in envois[0] and '"remplies": 2' in envois[1] and "horloges" not in envois[2]


def test_depuis_internet_on_ne_lit_ni_ne_change_les_horloges(client):
    h = creer(client, nom="Le secret du MJ")
    for methode, chemin, corps in (("GET", "/api/horloges", None), ("POST", "/api/horloges", {"nom": "Pirate", "parts": 4}),
                                   ("POST", "/api/horloges/avancer", {"pas": 1}), ("PATCH", f"/api/horloges/{h['id']}", {"visible": True}),
                                   ("DELETE", f"/api/horloges/{h['id']}", None)):
        r = client.request(methode, chemin, json=corps, headers=CF)
        assert r.status_code == 404 and "secret" not in r.text, chemin
    assert liste(client) == [h]


def test_un_fichier_retouche_a_la_main_ne_casse_rien(client):
    etat = {"horloges": [
        {"id": "aaa111", "nom": "Bonne", "parts": 6, "remplies": 9, "visible": True, "touchee": 2},
        {"id": "aaa111", "nom": "Doublon", "parts": 6},
        {"id": "PAS BON", "nom": "Identifiant", "parts": 6},
        {"id": "bbb222", "nom": "", "parts": 6},
        {"id": "ccc333", "nom": "Cinq parts", "parts": 5},
        "pas un objet",
        {"id": "ddd444", "nom": "Sans remplies", "parts": 4, "visible": "oui", "touchee": "hier"},
        {"id": "eee555", "nom": "Huit", "parts": 8, "remplies": -3},
        {"id": "fff666", "nom": "De trop", "parts": 4},
    ]}
    propres = horloges.de_l_etat(etat)
    assert [(h["id"], h["remplies"], h["visible"], h["touchee"]) for h in propres] == [
        ("aaa111", 6, True, 2), ("ddd444", 0, False, 0), ("eee555", 0, False, 0)]
    assert horloges.de_l_etat({"horloges": "rien"}) == [] and horloges.de_l_etat({}) == []
    assert horloges.publiques(propres) == [{"id": "aaa111", "nom": "Bonne", "parts": 6, "remplies": 6}]
    # Le même état sur le disque : la TV et l'atelier le lisent sans erreur.
    sauve = config.TABLE.read_text(encoding="utf-8") if config.TABLE.exists() else None
    config.TABLE.write_text(json.dumps({"vue": "accueil", **etat}), encoding="utf-8")
    try:
        assert etat_tv(client)["horloges"] == [{"id": "aaa111", "nom": "Bonne", "parts": 6, "remplies": 6}]
        assert [h["id"] for h in liste(client)] == ["aaa111", "ddd444", "eee555"]
    finally:
        if sauve is None:
            config.TABLE.unlink()
        else:
            config.TABLE.write_text(sauve, encoding="utf-8")


def sans_commentaires(css: str) -> str:
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def test_la_feuille_des_horloges_reste_lisible_par_chromium_79():
    css = sans_commentaires((STATIQUE / "css" / "horloges-tv.css").read_text(encoding="utf-8"))
    assert not re.search(r"(^|[;{\s])inset\s*:", css) and ":has(" not in css and "aspect-ratio" not in css
    for regle in re.findall(r"\{([^{}]*)\}", css):
        if re.search(r"display\s*:\s*(inline-)?flex", regle):
            assert not re.search(r"(^|[;\s])(row-|column-)?gap\s*:", regle), regle.strip()[:80]
    assert 'href="/static/css/horloges-tv.css"' in (STATIQUE / "table.html").read_text(encoding="utf-8")


def test_le_script_des_horloges_n_emploie_rien_de_plus_recent_que_chromium_79():
    source = (STATIQUE / "js" / "ecran-tv/horloges-tv.js").read_text(encoding="utf-8")
    # esbuild transpile la syntaxe, pas les fonctions : celles-ci sont venues après Chromium 79.
    for recent in (".at(", "hasOwn", "structuredClone", "replaceAll", "findLast", "toSorted", "Promise.any"):
        assert recent not in source, recent
    assert re.search(r'^import \{ HorlogesTv \} from "\.\./ecran-tv/horloges-tv\.js";$', source_page("table"), flags=re.M)


def test_la_touche_h_reste_libre_dans_les_editeurs():
    """H et Maj+H tiennent les horloges dans tout l'atelier : aucun outil des éditeurs de plan et de carte ne la prend."""
    # Les outils de la carte vivent à part (carte/outils.js, lot MJ-6) : l'éditeur les importe.
    for chemin, liste in (("plan/editeur.js", "plan/editeur.js"), ("carte/editeur.js", "carte/outils.js")):
        source = (STATIQUE / "js" / chemin).read_text(encoding="utf-8")
        outils = re.search(r"const OUTILS = \[(.*?)\n\];", (STATIQUE / "js" / liste).read_text(encoding="utf-8"), flags=re.S).group(1)
        lettres = re.findall(r'"([A-Z])"\]', outils)
        assert len(lettres) >= 8 and "H" not in lettres, chemin
        assert not re.search(r"""key(\.toLowerCase\(\))? === ["']h["']""", source, flags=re.I), chemin
