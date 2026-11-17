"""Un seul combat : la fin du combat rend le combat tel qu'il était (« Rouvrir le combat » le remet), l'écran qui l'a
écrit en dernier est retenu (« La télécommande a déjà passé la main »), et chaque combat enregistré ou fini est signalé
aux seules pages de l'atelier (/ws/atelier), même quand la TV ne montre pas l'ordre : ni la TV ni la table publique ne
reçoivent ce signal."""

import json
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application  # noqa: E402

CF = {"CF-Connecting-IP": "203.0.113.7"}


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture()
def seance(client):
    s = client.post("/api/seances", json={"nom": "Séance du combat unique", "numero": 8, "date": "2026-11-07"}).json()
    yield s
    client.put(f"/api/seances/{s['id']}/combat/tv", json={"montrer": False})
    client.delete(f"/api/seances/{s['id']}/combat")
    client.delete(f"/api/seances/{s['id']}")


def un_combat(**champs):
    return {
        "id": "u1", "rencontre": "rencontre-du-mj", "nom": "Les chasseurs du Notaire", "debut": "2026-11-07T18:00:00Z", "avant": 2,
        "moral": True, "tour": 2, "actif": 1, "ordre": ["aventurier:tavarede", "ennemis"],
        "heros": [{"id": "tavarede", "nom": "Tavarède", "max": 7, "sante": 3, "posture": "offensive", "cartons": {"physique": "jaune"}}],
        "adversaires": [{"id": "a1", "nom": "Hilaire", "rang": "soldat", "sante": 9, "max": 9}],
        "strat": True, "sablier": None,
    } | champs


def test_la_fin_rend_le_combat_tel_qu_il_etait(client, seance):
    url = f"/api/seances/{seance['id']}/combat"
    c = client.put(url, json={**un_combat(), "version_base": None}).json()["combat"]
    r = client.delete(url).json()
    assert r["combat"] is None and r["fini"] == c
    # « Rouvrir le combat » : le combat revient tel quel, avec sa main, son tour, ses blessures.
    remis = client.put(url, json={**r["fini"], "par": "atelier", "version_base": None}).json()["combat"]
    assert {k: remis[k] for k in ("id", "tour", "actif", "strat", "heros", "adversaires")} == {k: c[k] for k in ("id", "tour", "actif", "strat", "heros", "adversaires")}
    # Un autre combat commencé entre-temps : il ne se remet plus (la version d'avant n'est plus la bonne).
    client.delete(url)
    client.put(url, json={**un_combat(id="u2", nom="Un autre combat"), "version_base": None})
    assert client.put(url, json={**r["fini"], "version_base": None}).status_code == 409
    # Fini une seconde fois : rien à rendre.
    client.delete(url)
    assert client.delete(url).json()["fini"] is None


def test_l_ecran_qui_ecrit_est_retenu(client, seance):
    url = f"/api/seances/{seance['id']}/combat"
    c = client.put(url, json={**un_combat(), "par": "telecommande", "version_base": None}).json()["combat"]
    assert c["par"] == "telecommande"
    c = client.put(url, json={**c, "par": "atelier", "version_base": c["modifie"]}).json()["combat"]
    assert c["par"] == "atelier"
    for inconnu in ("pirate", None, ""):
        c = client.put(url, json={**c, "par": inconnu, "version_base": c["modifie"]}).json()["combat"]
        assert "par" not in c, inconnu
    assert client.put(url, json={**c, "par": 4, "version_base": c["modifie"]}).status_code == 400


def test_le_signal_du_combat_va_aux_seules_pages_de_l_atelier(client, seance):
    url = f"/api/seances/{seance['id']}/combat"
    client.put("/api/table", json={"vue": "accueil"})
    with client.websocket_connect("/ws/atelier") as atelier, client.websocket_connect("/ws/table") as tv:
        atelier.receive_text()
        tv.receive_text()
        # L'ordre n'est pas à la TV : la télécommande passe la main, l'atelier le sait tout de suite.
        c = client.put(url, json={**un_combat(), "par": "telecommande", "version_base": None}).json()["combat"]
        assert json.loads(atelier.receive_text()) == {"type": "combat", "seance": seance["id"], "modifie": c["modifie"], "par": "telecommande"}
        client.delete(url)
        assert json.loads(atelier.receive_text()) == {"type": "combat", "seance": seance["id"], "modifie": None, "par": ""}
        # La TV n'a rien reçu de tout cela : son message suivant est l'état de la table.
        client.put("/api/table", json={"vue": "heros"})
        assert json.loads(tv.receive_text())["type"] == "etat"
        assert json.loads(atelier.receive_text())["type"] == "etat"
    client.put("/api/table", json={"vue": "accueil"})


def test_rien_du_combat_pour_la_table_publique(client, seance):
    url = f"/api/seances/{seance['id']}/combat"
    client.put("/api/table", json={"vue": "accueil"})
    c = client.put(url, json={**un_combat(), "version_base": None}).json()["combat"]
    with client.websocket_connect("/ws/table", headers=CF) as publique:
        publique.receive_text()
        client.put(url, json={**c, "actif": 0, "version_base": c["modifie"]})
        # Ni le signal ni le combat fini ne sortent par Internet.
        assert client.delete(url, headers=CF).status_code == 404
        client.put("/api/table", json={"vue": "heros"})
        message = publique.receive_text()
        assert json.loads(message)["type"] == "etat" and "Hilaire" not in message and seance["id"] not in message
    r = client.delete(url).json()
    assert r["fini"]["actif"] == 0
    client.put("/api/table", json={"vue": "accueil"})
