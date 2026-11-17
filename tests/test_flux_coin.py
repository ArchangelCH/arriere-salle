"""Le flux poussé du coin des joueurs (flux_coin.py, GET /api/flux) : refusé depuis une autre origine ou sans session,
3 flux par joueur et 30 en tout, un événement ne porte qu'un sujet (jamais le contenu d'une demande, d'un mot du MJ ou
du carnet), chaque joueur n'apprend que ce qui le regarde, et le flux se ferme quand la session ne tient plus."""
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

from commun import demandes  # noqa: E402
from commun import flux_coin  # noqa: E402
import joueurs  # noqa: E402
from comptes_coin import entrer as entrer_au_coin  # noqa: E402
import main  # noqa: E402
from api import application, config  # noqa: E402


@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture()
def coin(monkeypatch):
    monkeypatch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    monkeypatch.setattr(joueurs, "COOKIE_SUR", False)
    monkeypatch.setattr(joueurs, "HOTES", set())
    monkeypatch.setattr(joueurs, "DEMANDES_FAITES", {})
    # Des flux courts : le client d'essai attend la fin de la réponse pour la rendre.
    monkeypatch.setattr(flux_coin, "BATTEMENT", 0.2)
    monkeypatch.setattr(flux_coin, "DUREE_MAX", 2.0)
    with TestClient(joueurs.app) as c:
        yield c
    joueurs.FLUX.abonnes.clear()


@pytest.fixture()
def invites(atelier):
    crees = []

    def inviter(nom):
        j = atelier.post("/api/joueurs", json={"nom": nom}).json()
        crees.append(j["id"])
        return j
    yield inviter
    for ident in crees:
        atelier.delete(f"/api/joueurs/{ident}")


def entrer(client, j):
    cle = j["id"]
    entrer_au_coin(client, cle)  # le provisoire du MJ ouvre le compte et la session


def evenements(corps: str) -> list:
    """Les lignes d'un flux, sans les commentaires ni le « retry »."""
    return [l for l in corps.splitlines() if l and not l.startswith((":", "retry:"))]


def test_refuse_une_autre_origine(coin, invites):
    j = invites("Origine")
    entrer(coin, j)
    for entetes in ({"Origin": "https://ailleurs.example"}, {"Sec-Fetch-Site": "cross-site"},
                    {"Sec-Fetch-Site": "same-site"}, {"Origin": "https://table.exemple.org"}):
        r = coin.get("/api/flux", headers=entetes)
        assert r.status_code == 403, entetes
    assert joueurs.FLUX.nombre() == 0


def test_refuse_sans_session(coin):
    assert coin.get("/api/flux").status_code == 401
    assert joueurs.FLUX.nombre() == 0


def test_trois_par_joueur_trente_en_tout(coin, invites):
    j = invites("Trois")
    entrer(coin, j)
    places = [joueurs.FLUX.ouvrir(j["id"]) for _ in range(flux_coin.PAR_JOUEUR)]
    r = coin.get("/api/flux")
    assert r.status_code == 429 and "pages ouvertes" in r.json()["detail"]
    for q in places:
        joueurs.FLUX.fermer(j["id"], q)
    autres = [(f"autre-{i}", joueurs.FLUX.ouvrir(f"autre-{i}")) for i in range(flux_coin.EN_TOUT)]
    assert coin.get("/api/flux").status_code == 429
    for ident, q in autres:
        joueurs.FLUX.fermer(ident, q)
    assert joueurs.FLUX.nombre() == 0
    # Une place rendue se reprend : le flux s'ouvre, puis rend la sienne en se fermant.
    r = coin.get("/api/flux", headers={"Sec-Fetch-Site": "same-origin"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    assert r.headers["cache-control"] == "no-store" and joueurs.FLUX.nombre() == 0


def test_un_evenement_ne_porte_qu_un_sujet(coin, invites, atelier):
    lea, max_ = invites("Léa-flux"), invites("Max-flux")
    entrer(coin, lea)
    d = coin.post("/api/demandes", json={"genre": "message", "corps": {"texte": "TEXTE-SECRET-DE-LEA"}}).json()

    def plus_tard():
        time.sleep(0.6)
        # Le MJ répond à Léa ; Max écrit de son côté ; le MJ met le coin en pause, puis le rouvre.
        atelier.post(f"/api/demandes/{lea['id']}/{d['id']}/accepter", json={"version": 1, "mot": "MOT-DU-MJ-POUR-LEA"})
        joueurs.demander_ici({"id": max_["id"]}, {"genre": "message", "corps": {"texte": "TEXTE-DE-MAX"}})
        time.sleep(0.4)
        atelier.put("/api/demandes/reglages", json={"pause": True})
        time.sleep(0.4)
        atelier.put("/api/demandes/reglages", json={"pause": False})
    t = threading.Thread(target=plus_tard)
    t.start()
    r = coin.get("/api/flux")
    t.join()
    assert r.status_code == 200
    lignes = evenements(r.text)
    assert lignes, r.text
    # Rien que « data: <sujet> » : ni texte, ni mot, ni JSON, ni identifiant.
    assert all(l.startswith("data: ") and l[6:] in flux_coin.SUJETS for l in lignes), lignes
    assert "data: demandes" in lignes and "data: pause" in lignes
    for secret in ("TEXTE-SECRET-DE-LEA", "MOT-DU-MJ-POUR-LEA", "TEXTE-DE-MAX", d["id"], max_["id"], "{"):
        assert secret not in r.text
    # Léa n'apprend que ce qui la regarde : un seul « demandes » (sa réponse), pas l'écriture de Max.
    assert lignes.count("data: demandes") == 1


def test_le_flux_se_ferme_quand_la_session_ne_tient_plus(coin, invites, atelier):
    j = invites("Coupé")
    entrer(coin, j)

    def renouveler():
        time.sleep(0.3)
        atelier.post(f"/api/joueurs/{j['id']}/provisoire", json={})
    t = threading.Thread(target=renouveler)
    t.start()
    debut = time.monotonic()
    r = coin.get("/api/flux")
    t.join()
    assert r.status_code == 200 and time.monotonic() - debut < flux_coin.DUREE_MAX - 0.5
    assert joueurs.FLUX.nombre() == 0
    assert coin.get("/api/flux").status_code == 401


def test_la_session_se_reverifie_meme_quand_les_sujets_se_suivent(monkeypatch, tmp_path):
    """Un sujet toutes les 50 ms (le carnet republié sans cesse) : le battement ne tombe jamais, mais la session coupée
    ferme quand même le flux dans le battement qui suit, au lieu de laisser passer des sujets jusqu'à la demi-heure."""
    import asyncio
    monkeypatch.setattr(flux_coin, "BATTEMENT", 0.2)
    monkeypatch.setattr(flux_coin, "DUREE_MAX", 3.0)

    async def essai():
        f = flux_coin.Flux(lambda: tmp_path)
        q = f.ouvrir("lea")
        tient = {"oui": True}
        coupee = {}

        async def pousser():
            for i in range(80):
                f.pousser("lea", "carnet")
                if i == 6:
                    tient["oui"] = False
                    coupee["a"] = time.monotonic()
                await asyncio.sleep(0.05)
        tache = asyncio.create_task(pousser())
        recus = []
        async for ligne in f.evenements("lea", q, lambda: tient["oui"]):
            recus.append((time.monotonic(), ligne))
        fin = time.monotonic()
        tache.cancel()
        return coupee["a"], fin, recus, f.nombre("lea")

    coupee, fin, recus, places = asyncio.run(essai())
    assert fin - coupee < 0.2 + 0.15, "le flux a continué après la session coupée"
    assert all(t - coupee < 0.2 + 0.15 for t, l in recus if l.startswith("data:"))
    assert any(l == "data: carnet\n\n" for _, l in recus) and places == 0


def test_les_modules_du_flux_sont_servis_au_coin(coin):
    for chemin in ("js/joueurs/flux.js", "js/joueurs/demandes.js", "css/demandes-coin.css"):
        assert chemin in joueurs.FICHIERS and coin.get(f"/static/{chemin}").status_code == 200
    # Ceux de l'atelier, non.
    for chemin in ("js/demandes/boite.js", "js/demandes/reglages.js", "css/demandes.css"):
        assert coin.get(f"/static/{chemin}").status_code == 404


def test_les_sujets_des_fichiers():
    assert flux_coin.sujet_du_fichier(("demandes", "lea.json")) == ("lea", "demandes")
    assert flux_coin.sujet_du_fichier(("demandes", demandes.PAUSE)) == (None, "pause")
    assert flux_coin.sujet_du_fichier(("commandes", "lea.json")) == ("lea", "commandes")
    assert flux_coin.sujet_du_fichier(("carnet", "heros", "a" * 32 + ".json")) == (None, "carnet")
    assert flux_coin.sujet_du_fichier(("carnet", "media", "x.json")) is None
    assert flux_coin.sujet_du_fichier(("lea.json",)) is None
    assert flux_coin.sujet_du_fichier(("demandes", "..json")) is None
    assert flux_coin.origine_refusee({"host": "joueurs.exemple.org", "origin": "https://joueurs.exemple.org",
                                      "sec-fetch-site": "same-origin"}) is False
    assert flux_coin.origine_refusee({"host": "joueurs.exemple.org"}) is False
