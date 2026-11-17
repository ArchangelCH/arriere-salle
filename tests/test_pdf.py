import os
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import joueurs  # noqa: E402
from comptes_coin import entrer  # noqa: E402
import main  # noqa: E402
from api import pages  # noqa: E402
from api import application, config, portier  # noqa: E402

PDF = b"%PDF-1.7\n" + b"0" * 4000


@pytest.fixture()
def rendus(monkeypatch):
    """Chromium remplacé : on garde les adresses qu'il aurait ouvertes."""
    vues = []

    async def faux(url):
        vues.append(url)
        return PDF

    monkeypatch.setattr(pages, "page_en_pdf", faux)
    monkeypatch.setattr(joueurs, "page_en_pdf", faux)
    return vues


@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture()
def coin(monkeypatch):
    monkeypatch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    monkeypatch.setattr(joueurs, "COOKIE_SUR", False)
    monkeypatch.setattr(joueurs, "HOTES", {"joueurs.exemple.org"})
    with TestClient(joueurs.app, base_url="http://joueurs.exemple.org") as c:
        yield c


def test_pdf_de_l_atelier(atelier, rendus):
    a = atelier.post("/api/aventuriers", json={"nom": "Vortan Aldrea", "tablee": True}).json()
    r = atelier.get(f"/fiche-aventurier.pdf?id={a['id']}&verso=0&autre=x")
    assert r.status_code == 200 and r.content == PDF and r.headers["content-type"] == "application/pdf"
    assert 'filename="Vortan Aldrea - fiche.pdf"' in r.headers["content-disposition"]
    # Chromium ouvre la fiche de l'atelier lui-même, avec les seules options connues, et un jeton de rendu (porte_lan.py)
    # qui ne survit pas au rendu.
    vue = urlparse(rendus[-1])
    options = parse_qs(vue.query)
    assert f"{vue.scheme}://{vue.netloc}{vue.path}" == "http://127.0.0.1:8000/fiche-aventurier"
    assert {k: v for k, v in options.items() if k != "rendu"} == {"id": [a["id"]], "verso": ["0"]}
    assert options["rendu"][0] and options["rendu"][0] not in portier.PORTE_LAN.rendus
    assert atelier.get("/fiche-aventurier.pdf?id=inconnu").status_code == 404
    assert atelier.get("/fiche-aventurier.pdf").status_code == 400


def test_un_joueur_ne_demande_pas_des_pdf_sans_fin(atelier, coin, rendus, monkeypatch):
    monkeypatch.setattr(joueurs, "PDF_PAR_HEURE", 2)
    monkeypatch.setattr(joueurs, "PDF_RECENTS", {})
    invite = atelier.post("/api/joueurs", json={"nom": "Maud"}).json()
    entrer(coin, invite)
    coin.post("/api/moi/aventurier", json={"nom": "Brune"})
    assert [coin.get("/fiche.pdf").status_code for _ in range(3)] == [200, 200, 429]
    assert len(rendus) == 2  # le troisième n'a pas lancé de rendu
    # Une heure plus tard, c'est reparti.
    joueurs.PDF_RECENTS[invite["id"]] = [t - 3601 for t in joueurs.PDF_RECENTS[invite["id"]]]
    assert coin.get("/fiche.pdf").status_code == 200


def test_pdf_du_joueur_et_jeton_de_rendu(atelier, coin, rendus):
    invite = atelier.post("/api/joueurs", json={"nom": "Dario"}).json()
    assert coin.get("/fiche.pdf").status_code == 401
    entrer(coin, invite)
    assert coin.get("/fiche.pdf").status_code == 404
    coin.post("/api/moi/aventurier", json={"nom": "Vortan"})
    r = coin.get("/fiche.pdf?eco=1")
    assert r.status_code == 200 and r.content == PDF and "Vortan - fiche.pdf" in r.headers["content-disposition"]
    vue = urlparse(rendus[-1])
    assert vue.netloc == "localhost:8000" and vue.path == "/fiche" and parse_qs(vue.query)["eco"] == ["1"]
    # Le jeton de rendu ne sert qu'une fois, et ne survit pas au rendu.
    assert parse_qs(vue.query)["rendu"][0] not in joueurs.RENDUS
    chromium = TestClient(joueurs.app, base_url="http://localhost:8000")
    jeton = "jeton-de-test"
    joueurs.RENDUS[jeton] = (invite["id"], time.monotonic() + 60)
    page = chromium.get(f"/fiche?rendu={jeton}")
    assert page.status_code == 200 and 'data-mode="joueur"' in page.text and "aventurier=" in page.headers["set-cookie"]
    assert chromium.get("/api/moi").json()["aventurier"]["nom"] == "Vortan"
    assert TestClient(joueurs.app, base_url="http://localhost:8000").get(f"/fiche?rendu={jeton}").status_code == 403
    joueurs.RENDUS["perime"] = (invite["id"], time.monotonic() - 1)
    assert TestClient(joueurs.app, base_url="http://localhost:8000").get("/fiche?rendu=perime").status_code == 403
    # Un autre nom que le domaine public ou le rendu interne reste refusé.
    assert TestClient(joueurs.app, base_url="http://ailleurs.example").get("/").status_code == 421
