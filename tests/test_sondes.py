"""Les sondes de surveillance (Uptime Kuma, par exemple) : chacune cherche un mot dans sa page, pour qu'une page d'erreur de Cloudflare
servie en 200 ne passe pas pour une réponse. Changer un de ces mots, c'est changer la sonde aussi (README)."""

import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import joueurs  # noqa: E402
import main  # noqa: E402
from api import application, config, portier  # noqa: E402


@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


def test_la_sonde_de_l_atelier_passe_par_l_adresse_du_serveur(atelier):
    r = atelier.get("/table", headers={"Host": "192.0.2.10:8323"})
    assert r.status_code == 200 and "la table" in r.text
    # Le nom du conteneur est refusé par la garde : une sonde qui s'en servirait serait toujours rouge.
    assert atelier.get("/table", headers={"Host": "aventures-atelier:8000"}).status_code == 400


def test_la_sonde_de_la_table_publique_trouve_son_mot(atelier, monkeypatch):
    monkeypatch.setattr(portier, "TABLE_PUBLIQUE", {"table.exemple.org"})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {"table.exemple.org"})
    r = atelier.get("/table", headers={"Host": "table.exemple.org", "CF-Connecting-IP": "203.0.113.7"})
    assert r.status_code == 200 and "la table" in r.text


def test_la_sonde_du_coin_des_joueurs_trouve_son_mot(monkeypatch):
    monkeypatch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    monkeypatch.setattr(joueurs, "HOTES", {"joueurs.exemple.org"})
    with TestClient(joueurs.app) as coin:
        r = coin.get("/", headers={"Host": "joueurs.exemple.org", "CF-Connecting-IP": "203.0.113.7"})
    assert r.status_code == 200 and "coin des joueurs" in r.text
