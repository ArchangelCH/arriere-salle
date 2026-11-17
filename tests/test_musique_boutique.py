"""L'ambiance des boutiques du panneau Musique : enregistrée avec la liste, comme celle des combats, et indépendante
d'elle. Le réglage seul ne touche pas à la liste et ne redemande rien à YouTube ; une ambiance retirée de la liste n'est
plus l'ambiance des boutiques."""

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
from table import musique  # noqa: E402

LISTE = [
    {"nom": "L'auberge", "lien": "https://www.youtube.com/playlist?list=PLexempleDeListe_0123456789abcdefg"},
    {"nom": "Combat", "lien": "https://www.youtube.com/playlist?list=PLbHUA-o_5dgKIcvpPs10ftV9AdaV_hNN1"},
    {"nom": "L'échoppe", "lien": "https://www.youtube.com/watch?v=Ech0ppeAbcd"},
]


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture
def youtube(monkeypatch):
    appels = []

    async def faux_youtube(source):
        appels.append(source)
        return {"lisible": True, "titre": "Titre", "auteur": "Studio"}

    monkeypatch.setattr(musique, "verifier", faux_youtube)
    return appels


def test_le_reglage_se_valide_contre_la_liste():
    ambiances = [{"id": "a-1"}, {"id": "a-2"}]
    assert musique.nettoyer_boutique("a-2", ambiances) == "a-2"
    assert musique.nettoyer_boutique(None, ambiances) is None and musique.nettoyer_boutique("", ambiances) is None
    for mauvais in ("a-3", 12, True, ["a-1"]):
        with pytest.raises(musique.LienInvalide, match="boutique"):
            musique.nettoyer_boutique(mauvais, ambiances)


def test_l_ambiance_des_boutiques_de_bout_en_bout(client, youtube):
    actuel = client.get("/api/musique").json()
    d = client.put("/api/musique", json={"version_base": actuel["modifie"], "ambiances": LISTE, "combat": None,
                                         "boutique": None}).json()
    assert d["boutique"] is None and client.get("/api/musique").json()["boutique"] is None
    auberge, combat, echoppe = d["ambiances"]

    # Le réglage seul : la liste reste à l'identique, YouTube n'est pas consulté, le combat ne bouge pas.
    youtube.clear()
    d2 = client.put("/api/musique", json={"combat": combat["id"]}).json()
    r = client.put("/api/musique", json={"boutique": echoppe["id"]})
    assert r.status_code == 200
    d3 = r.json()
    assert d3["boutique"] == echoppe["id"] and d3["combat"] == combat["id"]
    assert d3["ambiances"] == d["ambiances"] == d2["ambiances"] and youtube == []
    assert client.get("/api/musique").json() == d3

    # Le réglage du combat seul garde celui des boutiques, et l'inverse.
    d4 = client.put("/api/musique", json={"combat": None}).json()
    assert d4["combat"] is None and d4["boutique"] == echoppe["id"]

    # Une ambiance inconnue ou un identifiant illisible : refusés, rien ne change.
    for mauvais in ("a-inconnue", 7, ["x"]):
        r = client.put("/api/musique", json={"boutique": mauvais})
        assert r.status_code == 422 and "boutique" in r.json()["detail"]
    assert client.get("/api/musique").json() == d4

    # Avec sa version : un réglage fait sur une liste périmée est refusé.
    assert client.put("/api/musique", json={"boutique": auberge["id"], "version_base": d["modifie"]}).status_code == 409

    # La liste modifiée sans parler des boutiques : l'ambiance reste ; retirée de la liste, plus aucune.
    d5 = client.put("/api/musique", json={"version_base": d4["modifie"], "ambiances": [
        {"id": echoppe["id"], "nom": "Le magasin", "lien": echoppe["lien"]},
        {"id": auberge["id"], "nom": auberge["nom"], "lien": auberge["lien"]},
    ]}).json()
    assert d5["boutique"] == echoppe["id"] and youtube == []
    d6 = client.put("/api/musique", json={"version_base": d5["modifie"], "ambiances": [
        {"id": auberge["id"], "nom": auberge["nom"], "lien": auberge["lien"]},
    ]}).json()
    assert d6["boutique"] is None and client.get("/api/musique").json()["boutique"] is None
