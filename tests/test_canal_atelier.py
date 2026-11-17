"""Le canal de l'atelier (/ws/atelier) : il reçoit ce que reçoit la TV du salon, au même instant, ne compte pas parmi
les écrans branchés et ne s'ouvre jamais à la table publique."""

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
from api import application, portier  # noqa: E402

CF = {"CF-Connecting-IP": "203.0.113.7"}


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def test_l_atelier_recoit_ce_que_recoit_la_tv(client):
    client.put("/api/table", json={"vue": "accueil"})
    with client.websocket_connect("/ws/atelier") as atelier, client.websocket_connect("/ws/table") as tv:
        assert json.loads(atelier.receive_text())["etat"] == json.loads(tv.receive_text())["etat"]
        client.put("/api/table", json={"vue": "heros"})
        vu_atelier = json.loads(atelier.receive_text())
        vu_tv = json.loads(tv.receive_text())
        assert vu_atelier == vu_tv and vu_atelier["etat"]["vue"] == "heros"
    client.put("/api/table", json={"vue": "accueil"})


def test_l_atelier_ne_compte_pas_parmi_les_ecrans(client):
    with client.websocket_connect("/ws/atelier") as atelier:
        atelier.receive_text()
        assert client.get("/api/table").json()["ecrans"] == 0


def test_jamais_par_la_table_publique(client, monkeypatch):
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/atelier", headers=CF) as ws:
            ws.receive_text()
    monkeypatch.setattr(portier, "TABLE_PUBLIQUE", {"table.example.ch"})
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/atelier", headers={"Host": "table.example.ch"}) as ws:
            ws.receive_text()
