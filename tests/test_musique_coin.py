"""La musique du MJ à la table du coin (musique_coin.py, 19/11) : l'atelier ne publie que la vidéo, sa position et si elle
joue (jamais le nom ni la note d'une ambiance), seulement table du coin ouverte et musique au coin permise ; le coin dit
où en est la vidéo à l'instant ; le lecteur de YouTube n'entre que sur la page Table."""
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from commun import flux_coin, musique_coin  # noqa: E402
from commun.demandes import Refus  # noqa: E402
import joueurs  # noqa: E402
from comptes_coin import entrer  # noqa: E402
import main  # noqa: E402,F401
from api import application, config, tv_etat  # noqa: E402

VIDEO = "aB3_cD4-eF5"


@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture(scope="module")
def coin(atelier):
    patch = pytest.MonkeyPatch()
    patch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    patch.setattr(joueurs, "COOKIE_SUR", False)
    patch.setattr(joueurs, "HOTES", set())
    j = atelier.post("/api/joueurs", json={"nom": "Ombeline"}).json()
    c = TestClient(joueurs.app)
    entrer(c, j)
    avant = tv_etat.reglage_table_joueurs()
    yield c
    atelier.put("/api/table-joueurs", json={"ouverte": avant["ouverte"], "musique": True})
    c.close()
    atelier.delete(f"/api/joueurs/{j['id']}")
    musique_coin.effacer(config.PROPOSITIONS)
    patch.undo()


def ecouter(atelier, **corps):
    return atelier.put("/api/musique/ecoute", json=corps)


@pytest.mark.parametrize("corps", [{}, {"etat": "fort"}, {"etat": "joue"}, {"etat": "joue", "video": "trop-court"},
                                   {"etat": "joue", "video": VIDEO, "temps": -1}, {"etat": "joue", "video": VIDEO, "temps": True},
                                   {"etat": "pause", "video": "<script>x</sc", "temps": 1}])
def test_corps_refuses(corps):
    with pytest.raises(Refus):
        musique_coin.valider(corps)


def test_la_position_avance_a_la_lecture(tmp_path):
    musique_coin.ecrire(tmp_path, {"etat": "joue", "video": VIDEO, "temps": 100.0})
    plus_tard = datetime.now() + timedelta(seconds=30)
    assert musique_coin.lire(tmp_path, plus_tard) == {"etat": "joue", "video": VIDEO, "position": pytest.approx(130.0, abs=1)}
    musique_coin.ecrire(tmp_path, {"etat": "pause", "video": VIDEO, "temps": 100.0})
    assert musique_coin.lire(tmp_path, plus_tard)["position"] == 100.0
    # Sans nouvelle depuis un quart d'heure : plus rien ne joue.
    assert musique_coin.lire(tmp_path, datetime.now() + timedelta(seconds=musique_coin.VIEILLE + 5))["etat"] == "arret"
    musique_coin.ecrire(tmp_path, {"etat": "arret", "video": None, "temps": 0})
    assert not musique_coin.chemin(tmp_path).exists()


def test_table_fermee_rien_ne_part(atelier, coin):
    atelier.put("/api/table-joueurs", json={"ouverte": False})
    assert ecouter(atelier, etat="joue", video=VIDEO, temps=5).json() == {"publie": False}
    assert not musique_coin.chemin(config.PROPOSITIONS).exists()
    assert coin.get("/api/musique-table").json()["etat"] == "arret"


def test_table_ouverte_le_coin_l_entend(atelier, coin):
    assert atelier.put("/api/table-joueurs", json={"ouverte": True, "musique": True}).status_code == 200
    assert ecouter(atelier, etat="joue", video=VIDEO, temps=42.5).json() == {"publie": True}
    publie = musique_coin.chemin(config.PROPOSITIONS).read_text(encoding="utf-8")
    assert set(json.loads(publie)) == {"etat", "video", "temps", "depuis"}
    m = coin.get("/api/musique-table").json()
    assert m["etat"] == "joue" and m["video"] == VIDEO and m["position"] >= 42.5
    # Le flux a son sujet, et le fichier se guette.
    assert flux_coin.sujet_du_fichier((musique_coin.DOSSIER, musique_coin.FICHIER)) == (None, "musique")
    # En pause, puis arrêtée.
    ecouter(atelier, etat="pause", video=VIDEO, temps=50)
    assert coin.get("/api/musique-table").json() == {"etat": "pause", "video": VIDEO, "position": 50.0}
    ecouter(atelier, etat="arret")
    assert coin.get("/api/musique-table").json()["etat"] == "arret"


def test_musique_au_coin_coupee_par_le_mj(atelier, coin):
    atelier.put("/api/table-joueurs", json={"ouverte": True, "musique": True})
    ecouter(atelier, etat="joue", video=VIDEO, temps=1)
    r = atelier.put("/api/table-joueurs", json={"musique": False})
    assert r.status_code == 200 and r.json()["musique"] is False
    assert not musique_coin.chemin(config.PROPOSITIONS).exists()
    assert ecouter(atelier, etat="joue", video=VIDEO, temps=2).json() == {"publie": False}
    assert atelier.put("/api/table-joueurs", json={"musique": "oui"}).status_code == 400
    atelier.put("/api/table-joueurs", json={"musique": True})


def test_fermer_la_table_arrete_la_musique(atelier, coin):
    atelier.put("/api/table-joueurs", json={"ouverte": True, "musique": True})
    ecouter(atelier, etat="joue", video=VIDEO, temps=1)
    atelier.put("/api/table-joueurs", json={"ouverte": False})
    assert not musique_coin.chemin(config.PROPOSITIONS).exists()


def test_youtube_seulement_sur_la_page_table(coin):
    table = coin.get("/table").headers["content-security-policy"]
    assert "https://www.youtube.com" in table and "frame-src 'self' https://www.youtube-nocookie.com" in table
    for page in ("/carnet", "/", "/table/ecran", "/api/musique-table"):
        csp = coin.get(page).headers.get("content-security-policy", "")
        assert "youtube" not in csp, page
    assert "js/joueurs/musique-coin.js" in joueurs.FICHIERS


def test_sans_session_rien(coin):
    with TestClient(joueurs.app) as inconnu:
        assert inconnu.get("/api/musique-table").status_code in (401, 403)


def test_le_flux_dit_chaque_changement_de_musique(tmp_path):
    """Une page déjà ouverte apprend le début, le changement et l'arrêt de la musique (le fichier naît, change, s'efface)."""
    import asyncio

    async def essai():
        f = flux_coin.Flux(lambda: tmp_path)
        q = f.ouvrir("lea")
        f.connu = {}
        recus = []
        for geste in ({"etat": "joue", "video": VIDEO, "temps": 1.0}, {"etat": "pause", "video": VIDEO, "temps": 4.0}, {"etat": "arret", "video": None, "temps": 0}):
            musique_coin.ecrire(tmp_path, geste)
            await f.relire()
            while not q.empty():
                recus.append(q.get_nowait())
        return recus

    assert asyncio.run(essai()) == ["musique", "musique", "musique"]
