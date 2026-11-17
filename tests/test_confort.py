"""Le confort de la table : chaque joueur note ses lignes et ses voiles dans son carnet (les siennes seulement, par son
lien, avec les gardes de toute écriture du coin) ; le MJ les lit rassemblées, sans le nom de qui les a notées sauf
accord, et y ajoute les siennes ; rien ne va à un autre joueur, au carnet publié, à la TV ni à la table publique ; la
carte X s'imprime depuis l'atelier seulement."""
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
from commun import confort  # noqa: E402
import joueurs  # noqa: E402
from comptes_coin import entrer  # noqa: E402
import main  # noqa: E402
from api import application, carnet_api, config  # noqa: E402

CF = {"CF-Connecting-IP": "203.0.113.7"}
MEME_ORIGINE = {"Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"}
# Des mots qu'on ne trouve nulle part ailleurs : s'ils paraissent quelque part, c'est une fuite.
LIGNE_PHILO = "les poupées de cire qui parlent"
VOILE_PHILO = "les cloches de minuit"
LIGNE_BASILE = "les puits sans fond"



@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture(scope="module")
def coin_pour():
    patch = pytest.MonkeyPatch()
    patch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    patch.setattr(joueurs, "COOKIE_SUR", False)
    patch.setattr(joueurs, "HOTES", set())

    def ouvrir(joueur):
        c = TestClient(joueurs.app)
        entrer(c, joueur)
        return c
    yield ouvrir
    patch.undo()


@pytest.fixture(scope="module")
def tablee(atelier, coin_pour):
    """Philomène, qui ne veut pas être nommée ; Basile, qui l'accepte ; Octave, qui n'a rien noté. Retirés à la fin, avec
    les limites du MJ."""
    t = {}
    for nom in ("Philomène", "Basile", "Octave"):
        j = atelier.post("/api/joueurs", json={"nom": nom}).json()
        t[nom] = {"joueur": j, "coin": coin_pour(j)}
    yield t
    for x in t.values():
        atelier.delete(f"/api/joueurs/{x['joueur']['id']}")
    (config.DONNEES / "confort.json").unlink(missing_ok=True)


def noter(coin, **limites):
    return coin.put("/api/moi/limites", json=limites, headers=MEME_ORIGINE)


def test_les_themes_sont_les_memes_des_deux_cotes():
    js = (Path(config.ICI) / "static" / "js" / "confort" / "themes.js").read_text(encoding="utf-8")
    assert re.findall(r'\{ cle: "([a-z-]+)"', js) == list(confort.THEMES)


def test_chacun_ne_lit_et_n_ecrit_que_les_siennes(tablee):
    philo, basile, octave = (tablee[n]["coin"] for n in ("Philomène", "Basile", "Octave"))
    assert octave.get("/api/moi/limites").json() == {"themes": {}, "lignes": [], "voiles": [], "nommer": False}
    r = noter(philo, themes={"araignees": "ligne", "torture": "voile"}, lignes=[LIGNE_PHILO], voiles=[VOILE_PHILO])
    assert r.status_code == 200 and r.json()["themes"] == {"araignees": "ligne", "torture": "voile"} and r.json()["nommer"] is False
    assert noter(basile, themes={"torture": "ligne", "noyade": "voile"}, lignes=[LIGNE_BASILE], nommer=True).status_code == 200
    # Chacun relit les siennes, jamais celles d'un autre, quoi que dise l'adresse.
    assert philo.get("/api/moi/limites").json()["lignes"] == [LIGNE_PHILO]
    for adresse in ("/api/moi/limites", f"/api/moi/limites?joueur={tablee['Philomène']['joueur']['id']}"):
        lu = json.dumps(basile.get(adresse).json(), ensure_ascii=False)
        assert LIGNE_BASILE in lu and LIGNE_PHILO not in lu and VOILE_PHILO not in lu
    assert LIGNE_PHILO not in json.dumps(octave.get("/api/moi/limites").json(), ensure_ascii=False)
    # Le fichier de chacun porte son identifiant, dans le seul dossier où le coin écrit.
    fichier = config.PROPOSITIONS / confort.DOSSIER / f"{tablee['Philomène']['joueur']['id']}.json"
    assert LIGNE_PHILO in fichier.read_text(encoding="utf-8")
    # Sans lien, rien ne se lit ni ne s'écrit.
    anonyme = TestClient(joueurs.app)
    assert anonyme.get("/api/moi/limites").status_code == 401
    assert anonyme.put("/api/moi/limites", json={"lignes": ["x"]}, headers=MEME_ORIGINE).status_code == 401


def test_une_ecriture_venue_d_ailleurs_est_refusee(tablee):
    coin = tablee["Octave"]["coin"]
    corps = json.dumps({"lignes": ["les falaises"]})
    pirate = "https://pirate.exemple.org"
    for entetes, statut in (({"Origin": pirate, "Content-Type": "text/plain"}, 403), ({"Origin": pirate}, 403), ({"Origin": "null"}, 403),
                            ({"Sec-Fetch-Site": "same-site"}, 403), ({"Sec-Fetch-Site": "cross-site"}, 403),
                            ({"Content-Type": "text/plain"}, 415), ({"Content-Type": "application/x-www-form-urlencoded"}, 415)):
        r = coin.request("PUT", "/api/moi/limites", content=corps, headers={"Content-Type": "application/json", **entetes})
        assert r.status_code == statut, entetes
    assert coin.get("/api/moi/limites").json()["lignes"] == []


@pytest.mark.parametrize("corps, statut", [
    ({"secret": "x"}, 400),
    ({"themes": {"inconnu": "ligne"}}, 400),
    ({"themes": {"torture": "peut-etre"}}, 400),
    ({"themes": ["torture"]}, 400),
    ({"lignes": "torture"}, 400),
    ({"lignes": [42]}, 400),
    ({"lignes": ["x" * (confort.LIBRE_MAX + 1)]}, 400),
    ({"voiles": [f"voile {i}" for i in range(confort.LIBRES_MAX + 1)]}, 400),
    ({"nommer": "oui"}, 400),
    ({"lignes": ["é" * confort.LIBRE_MAX] * 60}, 413),
])
def test_des_limites_bornees_et_typees(tablee, corps, statut):
    coin = tablee["Octave"]["coin"]
    assert noter(coin, **corps).status_code == statut
    assert coin.get("/api/moi/limites").json() == {"themes": {}, "lignes": [], "voiles": [], "nommer": False}


def test_les_mots_du_joueur_arrivent_propres(tablee):
    coin, ident = tablee["Octave"]["coin"], tablee["Octave"]["joueur"]["id"]
    r = noter(coin, lignes=["  les​  rats\n", "Les rats", "", "les guêpes"], voiles=["les guêpes", "le‮noir"], themes={"gore": None})
    assert r.status_code == 200
    assert r.json()["lignes"] == ["les rats", "les guêpes"] and r.json()["voiles"] == ["lenoir"] and r.json()["themes"] == {}
    # Tout effacé : le fichier s'en va.
    assert noter(coin, lignes=[], voiles=[]).status_code == 200
    assert not (config.PROPOSITIONS / confort.DOSSIER / f"{ident}.json").exists()


def test_le_mj_les_lit_sans_nom_sauf_accord(atelier, tablee):
    vue = atelier.get("/api/confort").json()
    texte = json.dumps(vue, ensure_ascii=False)
    # Philomène n'a pas accepté : ni son prénom, ni son identifiant ; Basile, oui.
    assert "Philom" not in texte and tablee["Philomène"]["joueur"]["id"] not in texte and "Octave" not in texte
    # Une seule réponse sans nom : son nombre la désignerait, il n'est pas donné.
    assert vue["reponses"] is None and vue["nommes"] == 1 and vue["invites"] >= 3
    lignes = {x.get("cle") or x.get("texte"): x for x in vue["lignes"]}
    voiles = {x.get("cle") or x.get("texte"): x for x in vue["voiles"]}
    # La torture : un voile pour l'une, une ligne pour l'autre, donc une ligne, avec le seul nom accepté.
    assert lignes["torture"]["noms"] == ["Basile"] and "torture" not in voiles
    assert lignes["araignees"]["noms"] == [] and lignes[LIGNE_PHILO]["noms"] == [] and voiles[VOILE_PHILO]["noms"] == []
    assert lignes[LIGNE_BASILE]["noms"] == ["Basile"] and voiles["noyade"]["noms"] == ["Basile"]
    # L'ordre ne trahit personne : les thèmes dans l'ordre du carnet, puis les mots des joueurs par ordre alphabétique.
    libres = [x["texte"] for x in vue["lignes"] if "texte" in x]
    assert libres == sorted(libres, key=confort.forme)
    assert [x["cle"] for x in vue["lignes"] if "cle" in x] == [c for c in confort.THEMES if c in ("araignees", "torture")]
    # Rien d'autre sur les joueurs : ni date, ni fichier, ni case cochée.
    assert "modifie" not in texte and "nommer" not in texte and "Philomène" not in json.dumps(atelier.get("/api/confort").json())


def test_le_mj_ajoute_les_siennes(atelier, tablee):
    r = atelier.put("/api/confort", json={"themes": {"suicide": "ligne", "araignees": "voile"}, "voiles": ["les hôpitaux"]})
    assert r.status_code == 200
    vue = r.json()
    assert vue["mj"]["themes"] == {"araignees": "voile", "suicide": "ligne"} and vue["mj"]["voiles"] == ["les hôpitaux"]
    suicide = next(x for x in vue["lignes"] if x.get("cle") == "suicide")
    assert suicide["mj"] is True and suicide["noms"] == []
    # Un voile du MJ ne fait pas d'une ligne d'un joueur un voile.
    assert any(x.get("cle") == "araignees" for x in vue["lignes"]) and not any(x.get("cle") == "araignees" for x in vue["voiles"])
    assert vue["reponses"] is None and vue["nommes"] == 1
    assert atelier.put("/api/confort", json={"nommer": True}).status_code == 400
    assert atelier.put("/api/confort", json={"themes": {"torture": "toujours"}}).status_code == 400
    assert atelier.get("/api/confort").json()["mj"]["voiles"] == ["les hôpitaux"]


def test_rien_ne_va_ailleurs(atelier, tablee):
    """Ni au carnet publié, ni à « Voir comme », ni à la liste des joueurs, ni à la TV : les limites restent au MJ."""
    assert atelier.put("/api/carnet-joueurs", json={"ouvert": True}).json()["ouvert"] is True
    carnet_api.publier_carnet()
    publie = "\n".join(f.read_text(encoding="utf-8") for f in sorted((config.PROPOSITIONS / carnet.CARNET).rglob("*.json")))
    for ident in (tablee["Philomène"]["joueur"]["id"], tablee["Basile"]["joueur"]["id"]):
        apercu = json.dumps(atelier.get(f"/api/joueurs/{ident}/apercu").json(), ensure_ascii=False)
        carnet_du_coin = json.dumps(tablee["Basile"]["coin"].get("/api/carnet").json(), ensure_ascii=False)
        for fuite in (LIGNE_PHILO, VOILE_PHILO, LIGNE_BASILE):
            assert fuite not in publie and fuite not in apercu and fuite not in carnet_du_coin
    for texte in (json.dumps(atelier.get("/api/joueurs").json(), ensure_ascii=False), json.dumps(atelier.get("/api/table").json(), ensure_ascii=False)):
        assert LIGNE_PHILO not in texte and LIGNE_BASILE not in texte
    with atelier.websocket_connect("/ws/table") as ws:
        etat = json.dumps(ws.receive_json(), ensure_ascii=False)
    assert LIGNE_PHILO not in etat and "limites" not in etat
    atelier.put("/api/carnet-joueurs", json={"ouvert": False})


def test_les_routes_du_mj_restent_fermees_a_la_table_publique_et_au_coin(atelier, tablee):
    for methode, chemin in (("GET", "/api/confort"), ("PUT", "/api/confort"), ("GET", "/carte-x"), ("GET", "/static/carte-x.html"),
                            ("GET", "/static/js/confort/confort.js")):
        assert atelier.request(methode, chemin, headers=CF, json={} if methode == "PUT" else None).status_code == 404, chemin
    # Le coin des joueurs n'a ni la vue du MJ, ni la carte, ni le module de l'atelier ; il sert seulement ce qu'il faut au carnet.
    coin = tablee["Basile"]["coin"]
    for chemin in ("/api/confort", "/carte-x", "/static/js/confort/confort.js", "/static/carte-x.html", "/static/css/confort.css"):
        assert coin.get(chemin).status_code == 404, chemin
    # « Mes limites » a quitté le carnet le 06/11 : ses modules ne sont plus servis au coin.
    for chemin in ("/static/js/joueurs/limites.js", "/static/js/confort/themes.js", "/static/css/limites-coin.css"):
        assert coin.get(chemin).status_code == 404, chemin
    # Sur le réseau local, la carte s'imprime et le MJ lit le confort.
    page = atelier.get("/carte-x")
    assert page.status_code == 200 and "La carte X" in page.text
    assert atelier.get("/api/confort").status_code == 200


def test_un_joueur_retire_emporte_ses_limites(atelier, coin_pour):
    j = atelier.post("/api/joueurs", json={"nom": "Gontran"}).json()
    coin = coin_pour(j)
    assert noter(coin, lignes=["les orties"], nommer=True).status_code == 200
    fichier = config.PROPOSITIONS / confort.DOSSIER / f"{j['id']}.json"
    assert fichier.exists()
    assert atelier.delete(f"/api/joueurs/{j['id']}").status_code == 200
    # Effacées, pas mises à la corbeille : elles y porteraient son identifiant.
    assert not fichier.exists()
    assert not any("les orties" in f.read_text(encoding="utf-8") for f in config.CORBEILLE.rglob("*.json"))
    assert "les orties" not in json.dumps(atelier.get("/api/confort").json(), ensure_ascii=False)
    # Réinvité, il repart de rien ; et un fichier resté sans joueur ne passe pas à un nouveau venu du même prénom.
    nouveau = atelier.post("/api/joueurs", json={"nom": "Gontran"}).json()
    assert coin_pour(nouveau).get("/api/moi/limites").json()["lignes"] == []
    confort.ecrire(config.PROPOSITIONS, "isidore", confort.limites({"lignes": ["les guêpes"]}))
    isidore = atelier.post("/api/joueurs", json={"nom": "Isidore"}).json()
    assert isidore["id"] != "isidore"
    assert coin_pour(isidore).get("/api/moi/limites").json()["lignes"] == []
    for x in (nouveau, isidore):
        atelier.delete(f"/api/joueurs/{x['id']}")
    confort.oublier(config.PROPOSITIONS, "isidore")


def test_le_rassemblement():
    vue = confort.tablee([
        ("Léa", {"themes": {"sexe": "voile"}, "lignes": ["Les Rats"], "voiles": [], "nommer": True}),
        ("Zoé", {"themes": {"sexe": "ligne", "inconnu": "ligne"}, "lignes": ["les rats"], "voiles": ["la mer"], "nommer": False}),
        ("Max", {"themes": {}, "lignes": [], "voiles": [], "nommer": True}),
        ("<b>Ana</b>", "illisible"),
    ], {"voiles": ["La Mer"]})
    assert vue["reponses"] is None and vue["nommes"] == 1
    assert vue["lignes"] == [{"cle": "sexe", "noms": ["Léa"], "mj": False}, {"texte": "Les Rats", "noms": ["Léa"], "mj": False}]
    assert vue["voiles"] == [{"texte": "La Mer", "noms": [], "mj": True}]
    # Un joueur qui n'a rien noté ne compte pas, même s'il accepte d'être nommé.
    assert "Max" not in json.dumps(vue) and "Ana" not in json.dumps(vue)


def test_le_compte_ne_trahit_personne():
    """Avec une ou deux réponses sans nom, leur nombre dirait qui a noté quoi : il n'est pas donné. À partir de trois, ou
    quand tous ont accepté d'être nommés, il l'est."""
    def vue(*joueurs):
        return confort.tablee([(nom, {"themes": {"gore": "ligne"}, "nommer": nommer}) for nom, nommer in joueurs], {})
    assert vue(("Léa", False))["reponses"] is None
    assert vue(("Léa", False), ("Zoé", False))["reponses"] is None
    assert vue(("Léa", True), ("Zoé", False))["reponses"] is None
    assert vue(("Léa", True), ("Zoé", False), ("Max", False))["reponses"] is None
    assert vue(("Léa", False), ("Zoé", False), ("Max", False))["reponses"] == 3
    assert vue(("Léa", True), ("Zoé", False), ("Max", False), ("Ana", False))["reponses"] == 4
    assert vue(("Léa", True), ("Zoé", True))["reponses"] == 2 and vue(("Léa", True))["nommes"] == 1
    assert vue()["reponses"] == 0
