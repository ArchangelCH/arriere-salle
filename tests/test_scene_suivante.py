"""« Scène suivante » sur la télécommande : la commande, vérifiée (la séance et ses scènes), va à l'atelier qui joue la
musique, une seule fois ; sans atelier ouvert, le téléphone fait le geste lui-même. La route reste fermée à la table
publique. Le geste lui-même (la scène cochée, la suivante jouée, rien deux fois) se vérifie sous node
(outils/verifier_seance_en_cours.mjs)."""

import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, pilotage, portier  # noqa: E402
from table import telecommande  # noqa: E402
from sources_front import source_page  # noqa: E402

A, B = "ecranaaaa0001", "ecranbbbb0002"
JS = Path(__file__).resolve().parent.parent / "app" / "static" / "js"
DEROULE = [
    {"heure": "18:00", "titre": "Installation", "duree": 10, "fait": True},
    {"heure": "18:10", "titre": "L'aube sur les cendres", "duree": 40, "en_cours": "2026-11-04T18:12:00.000Z"},
    {"heure": "18:50", "titre": "La piste  des chasseurs", "duree": 45},
]
EN_MUSIQUE = {"musique": {"courante": "a-auberge", "nom": "L'auberge", "enPause": False, "joue": True}, "geste": True, "touche": 4}
SANS_MUSIQUE = {"musique": {"courante": None}, "geste": True, "touche": 1}


@pytest.fixture(scope="module")
def appli():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture
def client(appli, monkeypatch):
    monkeypatch.setattr(pilotage, "relais", telecommande.Relais())
    return appli


@pytest.fixture
def seance(client):
    r = client.post("/api/seances", json={"nom": "Les cendres de l'auberge", "numero": 31, "deroule": DEROULE})
    assert r.status_code == 200
    return r.json()["id"]


def relever(client, ecran, **etat):
    r = client.post("/api/telecommande/releve", json={"ecran": ecran, **etat})
    assert r.status_code == 200, r.text
    return r.json()["commandes"]


def test_la_scene_suivante_va_au_lecteur_une_seule_fois(client, seance):
    relever(client, A, **EN_MUSIQUE)
    relever(client, B, **SANS_MUSIQUE)
    corps = {"genre": "scene", "seance": seance, "de": 1, "vers": 2, "titre": "La piste  des\nchasseurs", "jeton": "abcdef0123456789"}
    c = client.post("/api/telecommande/commandes", json=corps).json()
    assert c["relais"] is True and c["genre"] == "scene" and c["etat"] == "attente"
    # Renvoyée après une réponse perdue : la même commande.
    assert client.post("/api/telecommande/commandes", json=corps).json()["numero"] == c["numero"]
    assert relever(client, B, **SANS_MUSIQUE) == []
    attendu = [{"numero": c["numero"], "genre": "scene", "seance": seance, "de": 1, "vers": 2, "titre": "La piste des chasseurs"}]
    assert relever(client, A, **EN_MUSIQUE) == attendu
    r = client.post(f"/api/telecommande/commandes/{c['numero']}/resultat",
                    json={"ecran": A, "ok": True, "message": "Scène en cours : plan sur la TV, ambiance en fondu, notée au journal."})
    assert r.json() == {"pris": True}
    suivi = client.get(f"/api/telecommande/commandes/{c['numero']}").json()
    assert suivi["etat"] == "faite" and suivi["message"].startswith("Scène en cours")
    # Le relais ne touche pas la séance : c'est l'atelier qui la joue.
    assert client.get(f"/api/seances/{seance}").json()["deroule"] == DEROULE


def test_sans_atelier_ouvert_le_telephone_joue_lui_meme(client, seance):
    r = client.post("/api/telecommande/commandes", json={"genre": "scene", "seance": seance, "de": -1, "vers": 2})
    assert r.status_code == 200 and r.json() == {"relais": False}
    assert pilotage.relais.commandes == []


@pytest.mark.parametrize("corps, statut", [
    ({"seance": "../secret", "de": 1, "vers": 2}, 400),
    ({"seance": None, "de": 1, "vers": 2}, 400),
    ({"seance": "seance-qui-n-existe-pas", "de": 1, "vers": 2}, 404),
    ({"de": 1, "vers": 3}, 400),
    ({"de": 1, "vers": -1}, 400),
    ({"de": -2, "vers": 2}, 400),
    ({"de": 2, "vers": 2}, 400),
    ({"de": True, "vers": 2}, 400),
    ({"de": 1, "vers": "2"}, 400),
    ({"de": 1, "vers": 1.5}, 400),
    ({"de": 1}, 400),
])
def test_une_scene_illisible_est_refusee(client, seance, corps, statut):
    relever(client, A, **EN_MUSIQUE)
    r = client.post("/api/telecommande/commandes", json={"genre": "scene", "seance": seance, **corps})
    assert r.status_code == statut and pilotage.relais.commandes == []


def test_le_titre_est_borne(client, seance):
    relever(client, A, **EN_MUSIQUE)
    client.post("/api/telecommande/commandes", json={"genre": "scene", "seance": seance, "de": 1, "vers": 2, "titre": "T" * 900})
    assert len(relever(client, A, **EN_MUSIQUE)[0]["titre"]) == 200


@pytest.mark.parametrize("entetes, statut", [
    ({"Host": "table.example.ch", "CF-Connecting-IP": "203.0.113.9"}, 404),  # la table publique
    ({"CF-Connecting-IP": "203.0.113.9"}, 404),  # Internet, hors de l'atelier en ligne
    ({"Host": "atelier.example.ch", "CF-Connecting-IP": "203.0.113.9", "Origin": "https://atelier.example.ch"}, 401),  # sans session
])
def test_internet_ne_commande_rien(client, seance, monkeypatch, entetes, statut):
    monkeypatch.setattr(portier, "ATELIER_PUBLIC", {"atelier.example.ch"})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {"atelier.example.ch", "table.example.ch"})
    monkeypatch.setattr(portier, "TABLE_PUBLIQUE", {"table.example.ch"})
    relever(client, A, **EN_MUSIQUE)
    r = client.post("/api/telecommande/commandes", json={"genre": "scene", "seance": seance, "de": 1, "vers": 2}, headers=entetes)
    assert r.status_code == statut and pilotage.relais.commandes == []


def test_la_telecommande_et_le_relais_passent_par_le_meme_geste():
    """Le téléphone, le Tableau et le relais du Mac jouent la scène par scene-suivante.js : la page Séances la joue si
    elle tient la séance (événement « scene-suivante »), sinon la séance est relue et enregistrée avec sa version."""
    tel = source_page("telecommande")
    assert 'genre: "scene"' in tel and "jouerSuivanteAilleurs(" in tel and 'g === "scene"' in tel
    relais = (JS / "ecran-tv/relais-telecommande.js").read_text(encoding="utf-8")
    assert 'c.genre === "scene"' in relais and "demanderSceneSuivante(" in relais
    geste = (JS / "seances" / "scene-suivante.js").read_text(encoding="utf-8")
    assert re.search(r"api\.put\(url, \{ \.\.\.s, version_base: s\.modifie \}\)", geste)
    assert '"scene-suivante"' in geste and "jouerLaScene(" in geste
    seances = (JS / "seances" / "seances.js").read_text(encoding="utf-8")
    assert 'window.addEventListener("scene-suivante"' in seances and 'window.removeEventListener("scene-suivante"' in seances
