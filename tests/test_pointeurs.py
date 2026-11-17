"""Les pointeurs de la table (lot du 13/11) : le pointeur du MJ et sa règle (outil Mesurer) arrivent à la page Table du coin des
joueurs, en lecture seule ; le pointeur d'un joueur (« Montrer au MJ ») arrive sur le plan du MJ, à la couleur de son héros.
Tout passe par de petits fichiers de propositions/pointeurs/ et par le flux du coin, jamais par la TV.

Fuite : le coin ne reçoit que des positions et un jeton public (jamais l'identifiant du plan, ni un secret du MJ) ; le pointeur
d'un joueur ne part que vers les pages de l'atelier, jamais vers la TV ni vers un autre joueur ; un joueur ne désigne que le plan
ou la carte que la TV montre, jamais un jeton venu de sa requête ; rien ne s'écrit table du coin fermée ; le module de dessin
de l'atelier n'est pas servi au coin."""
import asyncio
import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import joueurs  # noqa: E402
import main  # noqa: E402
from api import actions_coin, application, config, tv_cartes, tv_etat, tv_fiches, tv_temps_reel  # noqa: E402
from commun import flux_coin, pointeurs, table_joueurs  # noqa: E402
from comptes_coin import entrer as entrer_au_coin  # noqa: E402

APP = Path(__file__).resolve().parent.parent / "app"
STATIQUE = APP / "static"
DOSSIER = config.PROPOSITIONS / pointeurs.DOSSIER


def attendre(condition, delai=4.0):
    fin = time.monotonic() + delai
    while time.monotonic() < fin:
        v = condition()
        if v:
            return v
        time.sleep(0.05)
    raise AssertionError("la condition n'est jamais venue")


def recevoir_avant(ws, delai=5.0):
    """Le prochain message d'un WebSocket de l'essai, sans attendre plus de `delai` secondes."""
    boite = []
    t = threading.Thread(target=lambda: boite.append(ws.receive_json()), daemon=True)
    t.start()
    t.join(delai)
    assert boite, "aucun message reçu"
    return boite[0]


@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


def coin_de(monkeypatch):
    monkeypatch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    monkeypatch.setattr(joueurs, "COOKIE_SUR", False)
    monkeypatch.setattr(joueurs, "HOTES", set())
    monkeypatch.setattr(joueurs, "POINTEURS_RESERVES", {})
    return TestClient(joueurs.app)


@pytest.fixture()
def monde(atelier, monkeypatch):
    """Une joueuse reliée à son héros (couleur choisie), un joueur sans héros, un plan et une carte. La table du coin est
    fermée au départ ; tout repart à la fin."""
    crees, invites = [], []

    def creer(collection, **fiche):
        f = atelier.post(f"/api/{collection}", json=fiche).json()
        crees.append((collection, f["id"]))
        return f

    aude = creer("aventuriers", nom="Aude de Valcombe", genre="f", tablee=True, couleur="#2e7d32")
    m = {"aude": aude}
    for cle, nom, heros in (("lea", "Léa", aude), ("basile", "Basile", None)):
        invite = atelier.post("/api/joueurs", json={"nom": nom}).json()
        invites.append(invite["id"])
        if heros:
            assert atelier.post(f"/api/joueurs/{invite['id']}/relier", json={"heros": heros["id"]}).status_code == 200
        coin = coin_de(monkeypatch)
        entrer_au_coin(coin, invite)
        m[cle], m[f"{cle}_id"] = coin, invite["id"]
    m["plan"] = creer("plans", nom="Plan des pointeurs", largeur=8, hauteur=5, m_case=1.5, brouillard_actif=False, sol=[2] * 40, piece=[1] * 40,
                      pieces=[{"id": 1, "nom": "Salle", "genre": "salle", "notes": "NOTE-DU-MJ-PLAN"}], portes=[], objets=[], textes=[], pions=[])
    m["autre"] = creer("plans", nom="Un autre plan", largeur=3, hauteur=2, brouillard_actif=False, sol=[2] * 6, piece=[1] * 6,
                       pieces=[{"id": 1, "nom": "Cour", "genre": "salle"}], portes=[], objets=[], textes=[], pions=[])
    atelier.put("/api/table-joueurs", json={"ouverte": False})
    yield m
    atelier.put("/api/table-joueurs", json={"ouverte": False})
    atelier.put("/api/table", json={"vue": "accueil"})
    for ident in invites:
        atelier.delete(f"/api/joueurs/{ident}")
    for collection, ident in crees:
        atelier.delete(f"/api/{collection}/{ident}")
    tv_etat.TABLE_JOUEURS.unlink(missing_ok=True)
    table_joueurs.fermer(config.PROPOSITIONS)
    if DOSSIER.exists():
        for f in DOSSIER.rglob("*.json"):
            f.unlink(missing_ok=True)


def montrer_plan(atelier, plan):
    assert atelier.put("/api/table", json={"vue": "plan", "plan": plan["id"], "style": "couleur", "camera": None}).status_code == 200
    return tv_etat.table_coin.tout_de_suite()


def ouvrir_la_table(atelier, plan):
    atelier.put("/api/table-joueurs", json={"ouverte": True})
    montrer_plan(atelier, plan)
    vue = table_joueurs.vue_publiee(config.PROPOSITIONS)
    assert vue and vue["genre"] == "plan"
    return vue["plan"]["id"]


def pointer(ws, **m):
    ws.send_text(json.dumps(m))


# ---------------------------------------------------------------- le module commun

def test_les_valeurs_sont_bornees_et_nettoyees():
    assert pointeurs.nombre(1.23456) == 1.235 and pointeurs.nombre(True) is None and pointeurs.nombre("3") is None
    assert pointeurs.nombre(float("nan")) is None and pointeurs.nombre(float("inf")) is None and pointeurs.nombre(1e9) is None
    # La mesure s'affiche en texte brut : ni balise, ni guillemet, une ligne, courte.
    assert pointeurs.texte_court('<img src=x onerror="alert(1)"> 4,5 m\n· 3 cases') == "img src=x onerror=alert(1) 4,5 m · 3 cases"[:40]
    assert "<" not in pointeurs.texte_court("<b>x</b>") and len(pointeurs.texte_court("a" * 500)) == pointeurs.TEXTE_MAX
    assert pointeurs.texte_court(12) == "" and pointeurs.texte_court(None) == ""
    jeton = "a" * 20
    assert pointeurs.cible({"plan": jeton}) == ("plan", jeton) and pointeurs.cible({"carte": jeton}) == ("carte", jeton)
    for faux in ({"plan": "mon-plan"}, {"plan": jeton.upper()}, {"plan": jeton + "a"}, {"plan": 3}, {}, None, "plan", [jeton]):
        assert pointeurs.cible(faux) is None
    assert pointeurs.point_valide({"plan": jeton, "x": 1, "y": 2})["x"] == 1
    for faux in ({"plan": jeton, "x": 1}, {"plan": jeton, "x": "1", "y": 2}, {"plan": "x", "x": 1, "y": 2}, {"x": 1, "y": 2}, 5):
        assert pointeurs.point_valide(faux) is None
    assert pointeurs.regle_valide({"plan": jeton, "a": [1, 2], "b": [3, 4], "texte": "4 m"}) == {"plan": jeton, "a": [1.0, 2.0], "b": [3.0, 4.0], "texte": "4 m"}
    for faux in ({"plan": jeton, "a": [1, 2], "b": [3]}, {"plan": jeton, "a": [1, 2]}, {"plan": jeton, "a": [1, "2"], "b": [3, 4]}, {"a": [1, 2], "b": [3, 4]}, None, 3):
        assert pointeurs.regle_valide(faux) is None


def test_ce_que_le_mj_ecrit_se_lit_avec_son_age(tmp_path):
    jeton = "b" * 20
    maintenant = pointeurs.maintenant()
    pointeurs.ecrire_mj(tmp_path, {"plan": jeton, "x": 2, "y": 3, "vu": maintenant, "onde": 2, "onde_vue": maintenant},
                        {"plan": jeton, "a": [0, 0], "b": [3, 4], "texte": "7,5 m"})
    lu = pointeurs.lire_mj(tmp_path)
    assert lu["point"]["x"] == 2 and lu["point"]["plan"] == jeton and lu["point"]["onde"] == 2
    assert set(lu["point"]) == {"plan", "x", "y", "onde", "age", "onde_age"} and lu["point"]["age"] < 2
    assert lu["regle"] == {"plan": jeton, "a": [0.0, 0.0], "b": [3.0, 4.0], "texte": "7,5 m"}
    # Un point sans nouvelle depuis plus de dix secondes n'existe plus ; la règle reste.
    vieux = "2020-01-01T10:00:00.000"
    pointeurs.ecrire_mj(tmp_path, {"plan": jeton, "x": 2, "y": 3, "vu": vieux, "onde": 0, "onde_vue": None}, {"plan": jeton, "a": [0, 0], "b": [1, 1], "texte": ""})
    assert pointeurs.lire_mj(tmp_path)["point"] is None and pointeurs.lire_mj(tmp_path)["regle"] is not None
    # Rien à montrer : le fichier s'en va ; illisible : rien.
    pointeurs.ecrire_mj(tmp_path, None, None)
    assert not (tmp_path / pointeurs.DOSSIER / pointeurs.MJ).exists() and pointeurs.lire_mj(tmp_path) == {"point": None, "regle": None}
    (tmp_path / pointeurs.DOSSIER).mkdir(exist_ok=True)
    (tmp_path / pointeurs.DOSSIER / pointeurs.MJ).write_text("pas du json")
    assert pointeurs.lire_mj(tmp_path) == {"point": None, "regle": None}


def test_le_flux_du_coin_ne_connait_que_le_pointeur_du_mj():
    assert flux_coin.sujet_du_fichier((pointeurs.DOSSIER, pointeurs.MJ)) == (None, "pointeur")
    # Les pointeurs des joueurs ne font jamais réveiller une page du coin, ni la table.
    assert flux_coin.sujet_du_fichier((pointeurs.DOSSIER, pointeurs.JOUEURS, "lea.json")) is None
    assert "pointeur" in flux_coin.SUJETS
    # La page du coin écoute les mêmes sujets que le serveur en annonce.
    source = (STATIQUE / "js" / "joueurs" / "flux.js").read_text(encoding="utf-8")
    ligne = next(l for l in source.splitlines() if l.startswith("const SUJETS"))
    assert set(json.loads(ligne[ligne.index("["):ligne.rindex("]") + 1])) == set(flux_coin.SUJETS)


def test_ce_que_l_editeur_envoie_est_lu_avec_soin():
    lire = tv_temps_reel.lire_pointeur
    assert lire(json.dumps({"plan": "mon-plan", "regle": [1, 2, 3, 4.5], "texte": "4 m"})) == {"genre": "plan", "id": "mon-plan", "regle": [1.0, 2.0, 3.0, 4.5], "texte": "4 m"}
    assert lire('{"regle": false}') == {"regle_efface": True}
    for faux in ({"plan": "mon-plan", "regle": [1, 2, 3]}, {"plan": "mon-plan", "regle": "oui"}, {"plan": "mon-plan", "regle": [1, 2, 3, "4"]},
                 {"plan": "mon-plan", "regle": [1, 2, 3, 1e12]}, {"regle": [1, 2, 3, 4]}, {"plan": "../x", "regle": [1, 2, 3, 4]}):
        assert lire(json.dumps(faux)) is None
    # Une mesure trop longue ou piégée est nettoyée, jamais refusée : seul le segment compte.
    assert lire(json.dumps({"plan": "mon-plan", "regle": [0, 0, 1, 1], "texte": "<script>" + "x" * 99}))["texte"].startswith("script")
    assert lire(json.dumps({"plan": "mon-plan", "x": 1, "y": 2}))["x"] == 1  # le point d'avant, inchangé


# ---------------------------------------------------------------- le MJ vers le coin

def test_le_pointeur_et_la_regle_du_mj_arrivent_au_coin(atelier, monde):
    jeton_du_plan = ouvrir_la_table(atelier, monde["plan"])
    lea, basile = monde["lea"], monde["basile"]
    assert lea.get("/api/pointeurs").json() == {"point": None, "regle": None}
    with atelier.websocket_connect("/ws/pointeur") as mj:
        pointer(mj, plan=monde["plan"]["id"], x=3.14159, y=2, onde=True)
        assert recevoir_avant(mj) == {"type": "portee", "ici": True, "ecrans": 0}
        lu = attendre(lambda: lea.get("/api/pointeurs").json()["point"])
        # Le jeton public du plan, jamais son identifiant ; les positions en cases ; l'onde du clic.
        assert lu["plan"] == jeton_du_plan and monde["plan"]["id"] not in json.dumps(lu)
        assert (lu["x"], lu["y"]) == (3.142, 2) and lu["onde"] == 1 and lu["onde_age"] < 2
        assert basile.get("/api/pointeurs").json()["point"]["plan"] == jeton_du_plan  # chaque joueur voit la même chose
        # La règle de l'outil Mesurer : un segment et sa mesure, nettoyée.
        pointer(mj, plan=monde["plan"]["id"], regle=[1, 1, 4, 3], texte="<b>4,5 m</b> · 3 cases")
        regle = attendre(lambda: lea.get("/api/pointeurs").json()["regle"])
        assert regle == {"plan": jeton_du_plan, "a": [1.0, 1.0], "b": [4.0, 3.0], "texte": "b4,5 m/b · 3 cases"}
        # Le MJ retire la règle : le point reste.
        pointer(mj, regle=False)
        attendre(lambda: lea.get("/api/pointeurs").json()["regle"] is None)
        assert lea.get("/api/pointeurs").json()["point"] is not None
        # Il efface le point : plus rien, et le fichier s'en va.
        pointer(mj, efface=True)
        attendre(lambda: lea.get("/api/pointeurs").json() == {"point": None, "regle": None})
        assert not (DOSSIER / pointeurs.MJ).exists()
        # Une règle posée puis un éditeur qui se ferme sans l'effacer : elle s'en va avec lui.
        pointer(mj, plan=monde["plan"]["id"], regle=[0, 0, 2, 0], texte="3 m")
        attendre(lambda: lea.get("/api/pointeurs").json()["regle"])
    attendre(lambda: lea.get("/api/pointeurs").json() == {"point": None, "regle": None})


def test_rien_n_est_ecrit_pour_le_coin_hors_de_la_vue_ou_table_fermee(atelier, monde):
    # Table du coin fermée : rien ne s'écrit, même quand la TV montre ce plan.
    montrer_plan(atelier, monde["plan"])
    with atelier.websocket_connect("/ws/pointeur") as mj:
        pointer(mj, plan=monde["plan"]["id"], x=1, y=1, onde=True)
        pointer(mj, plan=monde["plan"]["id"], regle=[0, 0, 1, 1], texte="1 m")
        assert recevoir_avant(mj)["ici"] is True
        time.sleep(0.4)
        assert not (DOSSIER / pointeurs.MJ).exists()
        # Table ouverte, mais le MJ pointe un autre plan que celui de la TV : rien non plus.
        ouvrir_la_table(atelier, monde["plan"])
        pointer(mj, relire=True)
        pointer(mj, plan=monde["autre"]["id"], x=1, y=1)
        assert recevoir_avant(mj)["ici"] is False
        pointer(mj, plan=monde["autre"]["id"], regle=[0, 0, 1, 1], texte="1 m")
        time.sleep(0.4)
        assert not (DOSSIER / pointeurs.MJ).exists()
    # Un plan ou une carte inconnus du serveur ne sont jamais publiés.
    assert monde["lea"].get("/api/pointeurs").json() == {"point": None, "regle": None}


def test_le_coin_ne_lit_que_connecte_et_rien_de_plus(atelier, monde, monkeypatch):
    ouvrir_la_table(atelier, monde["plan"])
    inconnu = coin_de(monkeypatch)
    assert inconnu.get("/api/pointeurs").status_code == 401
    # Même un fichier piégé n'ajoute rien à ce que la page lit : le point et la règle, leurs champs connus.
    DOSSIER.mkdir(parents=True, exist_ok=True)
    jeton = "c" * 20
    maintenant = pointeurs.maintenant()
    (DOSSIER / pointeurs.MJ).write_text(json.dumps({
        "maj": maintenant, "secret": "NOTE-DU-MJ-PLAN", "tout": "TEXTE-MJ",
        "point": {"plan": jeton, "x": 1, "y": 2, "vu": maintenant, "onde": 0, "onde_vue": None, "note": "NOTE-DU-MJ-PLAN", "id": monde["plan"]["id"]},
        "regle": {"plan": jeton, "a": [0, 0], "b": [1, 1], "texte": "1 m", "note": "NOTE-DU-MJ-PLAN"}}))
    brut = json.dumps(monde["lea"].get("/api/pointeurs").json())
    for interdit in ("NOTE-DU-MJ-PLAN", "TEXTE-MJ", monde["plan"]["id"], "secret", "note"):
        assert interdit not in brut, interdit
    # La table du coin fermée : rien, même avec le fichier.
    atelier.put("/api/table-joueurs", json={"ouverte": False})
    assert monde["lea"].get("/api/pointeurs").json() == {"point": None, "regle": None}


# ---------------------------------------------------------------- le joueur vers le MJ

def test_un_joueur_pointe_et_le_mj_le_voit_a_sa_couleur(atelier, monde):
    jeton_du_plan = ouvrir_la_table(atelier, monde["plan"])
    lea = monde["lea"]
    r = lea.post("/api/pointeurs", json={"x": 3.5, "y": 2, "onde": True})
    assert r.status_code == 200, r.text
    fichier = DOSSIER / pointeurs.JOUEURS / f"{monde['lea_id']}.json"
    ecrit = json.loads(fichier.read_text(encoding="utf-8"))
    assert ecrit["plan"] == jeton_du_plan and (ecrit["x"], ecrit["y"], ecrit["onde"]) == (3.5, 2, 1)
    # Ce que voit le MJ : son prénom, la couleur de son héros à la TV, le plan par son identifiant (il est chez lui).
    vue = actions_coin.pointeurs_des_joueurs.vue()
    assert len(vue) == 1
    p = vue[0]
    assert (p["joueur"], p["nom"], p["genre"], p["id"], p["x"], p["y"]) == (monde["lea_id"], "Léa", "plan", monde["plan"]["id"], 3.5, 2)
    assert p["couleur"] == tv_fiches.couleurs_de_la_tv()[monde["aude"]["id"]]
    # Un glissé : la position suit ; l'onde ne repart pas sans toucher.
    assert lea.post("/api/pointeurs", json={"x": 4, "y": 2.5}).status_code == 200
    p2 = actions_coin.pointeurs_des_joueurs.vue()[0]
    assert (p2["x"], p2["y"], p2["onde"]) == (4, 2.5, 1)
    # Le joueur sans héros pointe aussi, à la couleur par défaut, sous son prénom.
    assert monde["basile"].post("/api/pointeurs", json={"x": 1, "y": 1}).status_code == 200
    par_nom = {p["nom"]: p for p in actions_coin.pointeurs_des_joueurs.vue()}
    assert set(par_nom) == {"Léa", "Basile"} and par_nom["Basile"]["couleur"].startswith("#")
    # Il le retire : le fichier s'en va, et la vue du MJ aussi.
    assert lea.delete("/api/pointeurs").status_code == 200 and not fichier.exists()
    assert [p["nom"] for p in actions_coin.pointeurs_des_joueurs.vue()] == ["Basile"]


def test_un_joueur_ne_designe_que_ce_que_la_tv_montre(atelier, monde, monkeypatch):
    lea = monde["lea"]
    # Table fermée : refusée, rien d'écrit.
    assert lea.post("/api/pointeurs", json={"x": 1, "y": 1}).status_code == 409
    assert not (DOSSIER / pointeurs.JOUEURS).exists() or not list((DOSSIER / pointeurs.JOUEURS).glob("*.json"))
    jeton_du_plan = ouvrir_la_table(atelier, monde["plan"])
    # Un jeton, un plan ou un joueur venus de la requête ne comptent pas : le plan est celui de la TV, le joueur sa session.
    r = lea.post("/api/pointeurs", json={"x": 1, "y": 1, "plan": "d" * 20, "carte": "e" * 20, "joueur": monde["basile_id"]})
    assert r.status_code == 200
    ecrit = json.loads((DOSSIER / pointeurs.JOUEURS / f"{monde['lea_id']}.json").read_text(encoding="utf-8"))
    assert ecrit["plan"] == jeton_du_plan and "carte" not in ecrit and "joueur" not in ecrit
    assert not (DOSSIER / pointeurs.JOUEURS / f"{monde['basile_id']}.json").exists()
    # Hors du plan, illisible, trop gros : refusé.
    for corps in ({"x": 9.5, "y": 1}, {"x": 1, "y": -2}, {"x": "1", "y": 1}, {"x": 1}, {"x": 1e9, "y": 1}, {}):
        assert lea.post("/api/pointeurs", json=corps).status_code in (400, 409), corps
    assert lea.post("/api/pointeurs", content=b"x" * 600, headers={"content-type": "application/json"}).status_code in (400, 413)
    # Sans session : refusé.
    assert coin_de(monkeypatch).post("/api/pointeurs", json={"x": 1, "y": 1}).status_code == 401
    assert coin_de(monkeypatch).delete("/api/pointeurs").status_code == 401
    # La TV quitte le plan pour une image : plus rien à désigner.
    atelier.put("/api/table", json={"vue": "image", "url": None, "titre": "Une image"})
    tv_etat.table_coin.tout_de_suite()
    assert lea.post("/api/pointeurs", json={"x": 1, "y": 1}).status_code == 409


def test_le_rythme_d_un_joueur_est_borne(atelier, monde):
    ouvrir_la_table(atelier, monde["plan"])
    codes = [monde["lea"].post("/api/pointeurs", json={"x": 1, "y": 1}).status_code for _ in range(30)]
    assert codes[:10] == [200] * 10 and 429 in codes
    # Un autre joueur n'est pas gêné.
    assert monde["basile"].post("/api/pointeurs", json={"x": 1, "y": 1}).status_code == 200


def test_un_pointeur_perime_ou_d_un_autre_plan_n_est_pas_montre(atelier, monde):
    ouvrir_la_table(atelier, monde["plan"])
    assert monde["lea"].post("/api/pointeurs", json={"x": 2, "y": 2}).status_code == 200
    assert len(actions_coin.pointeurs_des_joueurs.vue()) == 1
    # La TV passe à un autre plan : le pointeur de Léa vise l'ancien, le MJ ne le voit plus.
    montrer_plan(atelier, monde["autre"])
    assert actions_coin.pointeurs_des_joueurs.vue() == []
    # Un pointeur trop vieux s'éteint seul.
    montrer_plan(atelier, monde["plan"])
    fichier = DOSSIER / pointeurs.JOUEURS / f"{monde['lea_id']}.json"
    ecrit = json.loads(fichier.read_text(encoding="utf-8"))
    ecrit["vu"] = "2020-01-01T10:00:00.000"
    fichier.write_text(json.dumps(ecrit))
    assert actions_coin.pointeurs_des_joueurs.vue() == []
    # Un fichier au nom douteux ou piégé est ignoré.
    (fichier.parent / "Pas Un Joueur.json").write_text(json.dumps({"plan": "f" * 20, "x": 1, "y": 1, "vu": pointeurs.maintenant()}))
    (fichier.parent / "x.json").write_text("n'importe quoi")
    assert actions_coin.pointeurs_des_joueurs.vue() == []


def test_le_pointeur_d_un_joueur_ne_va_qu_aux_pages_de_l_atelier(atelier, monde):
    """Jamais la TV, jamais un autre écran : seule la liaison /ws/atelier le reçoit, et le coin n'a aucune route pour le lire."""
    ouvrir_la_table(atelier, monde["plan"])
    with atelier.websocket_connect("/ws/table") as tv, atelier.websocket_connect("/ws/atelier") as page:
        assert recevoir_avant(tv)["type"] == "etat" and recevoir_avant(page)["type"] == "etat"
        assert monde["lea"].post("/api/pointeurs", json={"x": 3, "y": 2, "onde": True}).status_code == 200
        # La veille de l'atelier le voit et le pousse aux pages (dans la seconde).
        message = recevoir_avant(page)
        while message["type"] != "pointeurs-joueurs":
            message = recevoir_avant(page)
        assert [(p["nom"], p["id"], p["x"], p["y"]) for p in message["pointeurs"]] == [("Léa", monde["plan"]["id"], 3, 2)]
        # La TV, elle, ne reçoit que son état : le message suivant qu'elle lit est celui d'un changement de vue.
        atelier.put("/api/table", json={"vue": "accueil"})
        assert recevoir_avant(tv)["type"] == "etat"
    # Le coin n'a aucune route qui rende les pointeurs des joueurs, ni d'un autre joueur.
    for chemin in ("/api/pointeurs/joueurs", f"/api/pointeurs/{monde['lea_id']}", "/propositions/pointeurs/joueurs"):
        assert monde["basile"].get(chemin).status_code in (404, 405)
    assert "Léa" not in json.dumps(monde["basile"].get("/api/pointeurs").json())


# ---------------------------------------------------------------- ce que sert le coin

def test_le_coin_sert_ses_modules_mais_pas_celui_de_l_atelier(monde):
    assert {"js/joueurs/pointeurs-coin.js", "css/pointeurs-coin.css", "js/ecran-tv/pointeur-tv.js"} <= joueurs.FICHIERS
    for atelier_seul in ("js/commun/pointeurs-joueurs.js", "css/pointeurs-joueurs.css", "js/ecran-tv/pointeur.js", "js/ecran-tv/canal-table.js"):
        assert atelier_seul not in joueurs.FICHIERS
        assert monde["lea"].get(f"/static/{atelier_seul}").status_code == 404, atelier_seul
    for servi in ("js/joueurs/pointeurs-coin.js", "css/pointeurs-coin.css"):
        assert monde["lea"].get(f"/static/{servi}").status_code == 200, servi
    # Ce que le module du coin importe est servi au coin.
    source = (STATIQUE / "js" / "joueurs" / "pointeurs-coin.js").read_text(encoding="utf-8")
    for nom in ("../api.js", "../ecran-tv/pointeur-tv.js", "./flux.js"):
        assert f'"{nom}"' in source
        chemin = os.path.normpath(os.path.join("js/joueurs", nom))
        assert chemin in joueurs.FICHIERS or chemin == "js/api.js" or (STATIQUE / chemin).exists()
    assert "js/api.js" in joueurs.FICHIERS or monde["lea"].get("/static/js/api.js").status_code == 200
    # Le point du joueur et la règle ne portent ni emoji ni tiret cadratin dans ce qu'ils écrivent à l'écran.
    for fichier in ("js/joueurs/pointeurs-coin.js", "js/commun/pointeurs-joueurs.js", "css/pointeurs-coin.css", "css/pointeurs-joueurs.css", "joueurs/table.html"):
        texte = (STATIQUE / fichier).read_text(encoding="utf-8")
        assert "—" not in texte and not any(0x1F300 <= ord(c) <= 0x1FAFF or 0x2600 <= ord(c) <= 0x27BF for c in texte), fichier


def test_le_bouton_et_la_page_table(monde):
    page = monde["lea"].get("/table")
    assert page.status_code == 200
    assert 'data-pointeur="montrer"' in page.text and "/css/pointeurs-coin.css" in page.text
