import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, config  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def test_une_idee_de_bout_en_bout(client):
    texte = "Toma ferme sa porte aux chasseurs de primes SECRET-IDEE #Toma #chasse"
    idee = client.post("/api/idees", json={"nom": "Toma ferme sa porte", "texte": texte, "mots": ["Toma", "chasse"], "etat": "a-creuser"}).json()
    assert idee["id"].startswith("toma-ferme-sa-porte") and idee["cree"] and idee["modifie"]
    assert idee["id"] in [i["id"] for i in client.get("/api/idees").json()]

    # Changer l'état ne touche pas au texte ; une version périmée est refusée.
    retenue = client.patch(f"/api/idees/{idee['id']}", json={"etat": "retenue", "version_base": idee["modifie"]}).json()
    assert retenue["etat"] == "retenue" and retenue["texte"] == texte and retenue["mots"] == ["Toma", "chasse"]
    assert client.patch(f"/api/idees/{idee['id']}", json={"etat": "ecartee", "version_base": idee["modifie"]}).status_code == 409

    # La note « au regard du canon » s'ajoute sans rien écraser.
    note = {"verdict": "conforme", "texte": "Toma est Paladin à l'épilogue [S4 E54 00:52:54](https://youtu.be/Ep1sodeS4xx?t=3174).", "date": "2026-09-30T14:00:00+00:00"}
    avec_note = client.patch(f"/api/idees/{idee['id']}", json={"canon": note}).json()
    assert avec_note["canon"] == note and avec_note["etat"] == "retenue"

    # Rien de tout cela ne part vers la TV.
    assert "SECRET-IDEE" not in client.get("/api/table").text

    # Supprimer envoie à la corbeille.
    assert client.delete(f"/api/idees/{idee['id']}").status_code == 200
    assert client.get(f"/api/idees/{idee['id']}").status_code == 404
    assert any(f.name.startswith(idee["id"]) for f in (config.CORBEILLE / "idees").glob("*.json"))
