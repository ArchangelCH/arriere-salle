"""Les jauges des pions des héros sur la TV (part de Santé et de Psy, coma, cartons, jeton d'avantage) et le jeton
d'avantage de l'état du moment : écrit héros par héros, tenu par le combat en cours, jamais la note du MJ vers la TV,
rien pour un adversaire ; la TV qui montre le plan le relit quand une jauge change."""

import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, heros_etat, tv_cartes, tv_ecran, tv_etat  # noqa: E402

NOTE = "NOTE-DU-MJ-JAUGES"


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture(autouse=True)
def etats_neufs():
    heros_etat.ETATS_HEROS.unlink(missing_ok=True)
    yield
    heros_etat.ETATS_HEROS.unlink(missing_ok=True)


@pytest.fixture(scope="module")
def heros(client):
    a = client.post("/api/aventuriers", json={"nom": "Orlane Jauge", "sante": 8, "psy": 4, "tablee": True, "posture": "defensive"}).json()
    b = client.post("/api/aventuriers", json={"nom": "Josse Jauge", "sante": 10, "psy": 0, "tablee": True}).json()
    yield a, b
    for x in (a, b):
        client.delete(f"/api/aventuriers/{x['id']}")


@pytest.fixture(scope="module")
def plan(client, heros):
    a, b = heros
    w, h = 4, 2
    p = client.post("/api/plans", json={
        "nom": "Plan des jauges", "largeur": w, "hauteur": h, "m_case": 1.5, "brouillard_actif": False,
        "sol": [2] * (w * h), "piece": [1] * (w * h), "brouillard": [1] * (w * h),
        "pieces": [{"id": 1, "nom": "Salle", "genre": "salle"}], "portes": [], "objets": [], "textes": [],
        "pions": [{"id": "h1", "genre": "heros", "nom": a["nom"], "ref": f"aventurier:{a['id']}", "x": 0.5, "y": 0.5},
                  {"id": "h2", "genre": "heros", "nom": b["nom"], "ref": f"aventurier:{b['id']}", "x": 1.5, "y": 0.5},
                  {"id": "e1", "genre": "ennemi", "nom": "Brigand", "ref": "bestiaire:brigand", "court": "1", "x": 2.5, "y": 0.5}],
    }).json()
    yield p
    client.delete(f"/api/plans/{p['id']}")


@pytest.fixture()
def seance(client):
    s = client.post("/api/seances", json={"nom": "Séance des jauges", "numero": 9, "date": "2026-11-02"}).json()
    yield s
    client.delete(f"/api/seances/{s['id']}/combat")
    client.delete(f"/api/seances/{s['id']}")


def pions_tv(client, plan):
    r = client.get(f"/api/table/plan/{tv_cartes.jeton('plans', plan['id'])}")
    assert r.status_code == 200
    return r, {t["id"]: t for t in r.json()["pions"]}


def test_le_jeton_d_avantage_s_ecrit_et_se_retire(client, heros):
    a, _ = heros
    assert client.patch(f"/api/etats-heros/{a['id']}", json={"avantage": "avantage"}).json()["etat"]["avantage"] == "avantage"
    assert client.patch(f"/api/etats-heros/{a['id']}", json={"avantage": "desavantage"}).json()["etat"]["avantage"] == "desavantage"
    for mauvais in ("double", 1, True, ["avantage"]):
        assert client.patch(f"/api/etats-heros/{a['id']}", json={"avantage": mauvais}).status_code == 400, mauvais
    # "" ou null : plus de jeton, et un état revenu à rien disparaît.
    assert client.patch(f"/api/etats-heros/{a['id']}", json={"avantage": ""}).json()["etat"] == {}
    client.patch(f"/api/etats-heros/{a['id']}", json={"avantage": "avantage"})
    assert client.patch(f"/api/etats-heros/{a['id']}", json={"avantage": None}).json()["etat"] == {}
    # Lu par un écran, puis changé ailleurs : un geste calculé sur l'ancien est refusé.
    client.patch(f"/api/etats-heros/{a['id']}", json={"avantage": "avantage"})
    assert client.patch(f"/api/etats-heros/{a['id']}", json={"avantage": None, "avant": {"avantage": None}}).status_code == 409
    assert client.patch(f"/api/etats-heros/{a['id']}", json={"avantage": None, "avant": {"avantage": "avantage"}}).status_code == 200


def test_le_combat_tient_le_jeton(client, heros, seance):
    a, b = heros
    url = f"/api/seances/{seance['id']}/combat"
    combat = {"id": "j1", "rencontre": "r", "nom": "Les jauges", "tour": 1, "actif": 0, "avant": 1,
              "ordre": [f"aventurier:{a['id']}", "ennemis", f"aventurier:{b['id']}"],
              "heros": [{"id": a["id"], "nom": a["nom"], "max": 8, "sante": 5, "psy": 4, "psyMax": 4, "posture": "focus", "cartons": {}, "avantage": "avantage"},
                        {"id": b["id"], "nom": b["nom"], "max": 10, "sante": 10, "posture": "defensive", "cartons": {}, "avantage": "n'importe"}],
              "adversaires": [], "strat": False, "sablier": None}
    c = client.put(url, json={**combat, "version_base": None}).json()["combat"]
    # Un jeton inconnu ne s'enregistre pas.
    assert "avantage" not in c["heros"][1]
    etats = client.get("/api/etats-heros").json()["etats"]
    assert etats[a["id"]]["avantage"] == "avantage" and b["id"] not in etats
    # Pendant le combat, le jeton se change là seulement.
    assert client.patch(f"/api/etats-heros/{a['id']}", json={"avantage": None}).status_code == 409
    # Le bandeau de la TV le montre.
    client.put(url + "/tv", json={"montrer": True})
    try:
        bandeau = client.get(f"/api/table/combat/{tv_cartes.jeton('seances', seance['id'])}").json()
        assert [x.get("avantage") for x in bandeau["ordre"] if x["genre"] == "heros"] == ["avantage", ""]
    finally:
        client.put(url + "/tv", json={"montrer": False})
    # Un combat qui ne parle pas du jeton (d'avant cette règle) n'y touche pas.
    sans = {**combat, "heros": [{**combat["heros"][0]}, combat["heros"][1]]}
    del sans["heros"][0]["avantage"]
    c = client.put(url, json={**sans, "version_base": c["modifie"]}).json()["combat"]
    assert client.get("/api/etats-heros").json()["etats"][a["id"]]["avantage"] == "avantage"
    # Joué (clé vide) : retiré de l'état aussi.
    joue = {**combat, "heros": [{**combat["heros"][0], "avantage": ""}, combat["heros"][1]]}
    c = client.put(url, json={**joue, "version_base": c["modifie"]}).json()["combat"]
    assert c["heros"][0]["avantage"] == ""
    assert "avantage" not in client.get("/api/etats-heros").json()["etats"].get(a["id"], {})


def test_les_pions_des_heros_portent_leurs_jauges(client, heros, plan):
    a, b = heros
    client.patch(f"/api/etats-heros/{a['id']}", json={"sante": 2, "psy": 1, "notes": NOTE, "santeDon": 1,
                                                     "cartons": {"physique": "jaune", "mental": "rouge"}, "avantage": "desavantage"})
    client.patch(f"/api/etats-heros/{b['id']}", json={"sante": -3})
    r, pions = pions_tv(client, plan)
    assert NOTE not in r.text and "santeDon" not in r.text
    assert pions["h1"]["jauges"] == {"sante": 0.25, "psy": 0.25, "coma": False, "avantage": "desavantage", "posture": "defensive",
                                     "cartons": [{"carac": "physique", "couleur": "jaune"}, {"carac": "mental", "couleur": "rouge"}]}
    # Dans le coma, la barre est vide ; sans Psy sur la fiche, pas de barre de Psy ; sans posture de base, aucune.
    assert pions["h2"]["jauges"] == {"sante": 0.0, "psy": None, "coma": True, "cartons": [], "avantage": "", "posture": ""}
    # Rien pour un adversaire.
    assert "jauges" not in pions["e1"]


def test_sans_etat_un_heros_a_ses_jauges_pleines(client, heros, plan):
    _, pions = pions_tv(client, plan)
    assert pions["h1"]["jauges"] == {"sante": 1.0, "psy": 1.0, "coma": False, "cartons": [], "avantage": "", "posture": "defensive"}


def test_la_tv_qui_montre_le_plan_le_relit_quand_une_jauge_change(client, heros, plan):
    a, _ = heros
    avant = client.get("/api/table").json()
    try:
        client.put("/api/table", json={"vue": "plan", "plan": plan["id"]})
        v1 = tv_etat.etat_public(tv_ecran.etat_table())["version"]
        with client.websocket_connect("/ws/table") as ws:
            assert ws.receive_json()["etat"]["vue"] == "plan"
            # Une note ne change rien de ce que voit la TV : pas de message ; un jeton, si.
            client.patch(f"/api/etats-heros/{a['id']}", json={"notes": "rien pour la TV"})
            client.patch(f"/api/etats-heros/{a['id']}", json={"avantage": "avantage"})
            message = ws.receive_json()
        assert message["etat"]["vue"] == "plan" and message["etat"]["version"] != v1
        assert "rien pour la TV" not in str(message)
    finally:
        client.put("/api/table", json={"vue": avant.get("vue") or "accueil"})


def test_la_posture_du_combat_passe_sur_le_pion_puis_s_efface(client, heros, plan, seance):
    a, b = heros
    url = f"/api/seances/{seance['id']}/combat"
    combat = {"id": "p1", "rencontre": "r", "nom": "Les postures", "tour": 1, "actif": 0, "avant": 1,
              "ordre": [f"aventurier:{a['id']}", "ennemis"],
              "heros": [{"id": a["id"], "nom": a["nom"], "max": 8, "sante": 8, "posture": "offensive", "cartons": {}}],
              "adversaires": [], "strat": False, "sablier": None}
    client.put(url, json={**combat, "version_base": None})
    assert pions_tv(client, plan)[1]["h1"]["jauges"]["posture"] == "offensive"
    # Rien n'est écrit dans l'état : en pleine forme, il n'en a toujours pas.
    assert a["id"] not in client.get("/api/etats-heros").json()["etats"]
    # Combat fini : il reprend la posture de sa fiche.
    client.delete(url)
    assert pions_tv(client, plan)[1]["h1"]["jauges"]["posture"] == "defensive"
