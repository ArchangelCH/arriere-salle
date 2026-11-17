"""L'ambiance de combat du panneau Musique : enregistrée avec la liste (data/musique.json), une ambiance de la liste ou
aucune. Le réglage seul ne touche pas à la liste et ne redemande rien à YouTube ; une ambiance retirée de la liste
n'est plus l'ambiance de combat."""

import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, config, utilitaires  # noqa: E402
from table import musique  # noqa: E402

LISTE = [
    {"nom": "L'auberge", "lien": "https://www.youtube.com/playlist?list=PLexempleDeListe_0123456789abcdefg"},
    {"nom": "Combat", "lien": "https://www.youtube.com/playlist?list=PLbHUA-o_5dgKIcvpPs10ftV9AdaV_hNN1"},
    {"nom": "La rixe", "lien": "https://www.youtube.com/watch?v=Comb4tAbcde"},
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


def depart(client) -> dict:
    """Une liste neuve de trois ambiances, sans ambiance de combat."""
    actuel = client.get("/api/musique").json()
    d = client.put("/api/musique", json={"version_base": actuel["modifie"], "ambiances": LISTE, "combat": None})
    assert d.status_code == 200
    return d.json()


def test_le_reglage_se_valide_contre_la_liste():
    ambiances = [{"id": "a-1"}, {"id": "a-2"}]
    assert musique.nettoyer_combat("a-2", ambiances) == "a-2"
    assert musique.nettoyer_combat(None, ambiances) is None and musique.nettoyer_combat("", ambiances) is None
    for mauvais in ("a-3", 12, True, ["a-1"], {"id": "a-1"}):
        with pytest.raises(musique.LienInvalide):
            musique.nettoyer_combat(mauvais, ambiances)
    assert musique.combat_retenu("a-1", ambiances) == "a-1"
    assert musique.combat_retenu("a-3", ambiances) is None and musique.combat_retenu(None, []) is None


def test_l_ambiance_de_combat_de_bout_en_bout(client, youtube):
    d = depart(client)
    assert d["combat"] is None and client.get("/api/musique").json()["combat"] is None
    auberge, combat, rixe = d["ambiances"]

    # Le réglage seul : la liste reste à l'identique et YouTube n'est pas consulté.
    youtube.clear()
    r = client.put("/api/musique", json={"combat": combat["id"]})
    assert r.status_code == 200
    d2 = r.json()
    assert d2["combat"] == combat["id"] and d2["ambiances"] == d["ambiances"] and youtube == []
    assert client.get("/api/musique").json() == d2

    # Une ambiance inconnue ou un identifiant illisible : refusés, rien ne change.
    for mauvais in ("a-inconnue", 7, ["x"]):
        r = client.put("/api/musique", json={"combat": mauvais})
        assert r.status_code == 422 and "combat" in r.json()["detail"]
    assert client.get("/api/musique").json() == d2

    # Avec sa version : un réglage fait sur une liste périmée est refusé comme le reste.
    assert client.put("/api/musique", json={"combat": rixe["id"], "version_base": d["modifie"]}).status_code == 409

    # La liste modifiée sans parler du combat : renommée et réordonnée, l'ambiance de combat reste.
    d3 = client.put("/api/musique", json={"version_base": d2["modifie"], "ambiances": [
        {"id": combat["id"], "nom": "Bataille", "lien": combat["lien"]},
        {"id": auberge["id"], "nom": auberge["nom"], "lien": auberge["lien"]},
        {"id": rixe["id"], "nom": rixe["nom"], "lien": rixe["lien"]},
    ]}).json()
    assert d3["combat"] == combat["id"] and d3["ambiances"][0]["nom"] == "Bataille"

    # Retirée de la liste, elle n'est plus l'ambiance de combat.
    d4 = client.put("/api/musique", json={"version_base": d3["modifie"], "ambiances": [
        {"id": auberge["id"], "nom": auberge["nom"], "lien": auberge["lien"]},
        {"id": rixe["id"], "nom": rixe["nom"], "lien": rixe["lien"]},
    ]}).json()
    assert d4["combat"] is None

    # La liste et le réglage dans le même envoi ; puis « Aucune ».
    d5 = client.put("/api/musique", json={"version_base": d4["modifie"], "combat": rixe["id"], "ambiances": [
        {"id": auberge["id"], "nom": auberge["nom"], "lien": auberge["lien"]},
        {"id": rixe["id"], "nom": rixe["nom"], "lien": rixe["lien"]},
    ]}).json()
    assert d5["combat"] == rixe["id"]
    assert client.put("/api/musique", json={"combat": ""}).json()["combat"] is None

    # Sans liste ni réglage : refusé, comme avant.
    assert client.put("/api/musique", json={}).status_code == 422


def test_un_reglage_qui_ne_designe_plus_rien_se_lit_aucune(client, youtube):
    """Le fichier garde un ancien identifiant (liste remplacée par un autre écran, sauvegarde ancienne) : aucune."""
    d = depart(client)
    utilitaires.ecrire(config.MUSIQUE, {**d, "combat": "a-disparue"})
    assert client.get("/api/musique").json()["combat"] is None
    # Une liste d'avant le réglage (sans le champ) se lit aussi « aucune ».
    utilitaires.ecrire(config.MUSIQUE, {"ambiances": d["ambiances"], "modifie": d["modifie"]})
    assert client.get("/api/musique").json() == {**d, "combat": None}


def test_le_reglage_ne_sort_pas_par_la_table_publique(client, youtube):
    d = depart(client)
    dehors = {"cf-connecting-ip": "203.0.113.9"}
    assert client.put("/api/musique", json={"combat": d["ambiances"][1]["id"]}, headers=dehors).status_code == 404
    assert client.get("/api/musique").json()["combat"] is None
    assert client.get("/api/musique", headers=dehors).status_code == 404
