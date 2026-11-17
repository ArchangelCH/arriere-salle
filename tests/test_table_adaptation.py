"""La table à toute taille d'écran : ce que la rumeur montrée à la TV laisse passer (et rien de plus), et la présence des
mesures qui font tenir la tablée, les fiches, le document et le plan dans l'écran (le rendu lui-même se contrôle dans un
navigateur)."""

import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402,F401
from api import application, tv_cartes  # noqa: E402

J = tv_cartes.jeton
STATIQUE = Path(__file__).resolve().parent.parent / "app" / "static"


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def test_une_rumeur_a_placer_montree_a_la_tv_se_lit_sans_404_et_sans_ses_secrets(client):
    """Le MJ montre une rumeur avant que sa fiche soit enregistrée « entendue » : la TV la lit quand même (sinon un 404 et un
    carton qui ne paraît pas). Une autre rumeur « à placer », que la TV ne montre pas, reste fermée. Rien de la vérité ni du
    fond ne part."""
    montree = client.post("/api/rumeurs", json={"texte": "Un pont s'est effondré.", "source": "un meunier", "verite": "fausse", "fond": "FOND-SECRET-A", "etat": "a-placer"}).json()
    autre = client.post("/api/rumeurs", json={"texte": "Une autre.", "source": "", "verite": "vraie", "fond": "FOND-SECRET-B", "etat": "a-placer"}).json()
    assert client.get(f"/api/table/rumeur/{J('rumeurs', montree['id'])}").status_code == 404
    client.put("/api/table", json={"vue": "accueil", "rumeur": montree["id"]})
    lue = client.get(f"/api/table/rumeur/{J('rumeurs', montree['id'])}")
    assert lue.status_code == 200
    assert lue.json()["texte"] == "Un pont s'est effondré."
    assert "FOND-SECRET" not in lue.text and "fausse" not in lue.text
    assert set(lue.json()) == {"id", "texte", "source"}
    assert client.get(f"/api/table/rumeur/{J('rumeurs', autre['id'])}").status_code == 404
    client.put("/api/table", json={"vue": "accueil"})
    assert client.get(f"/api/table/rumeur/{J('rumeurs', montree['id'])}").status_code == 404


def test_la_tv_remesure_ses_vues_quand_la_fenetre_change():
    """Le document, la tablée, les fiches, le bandeau du combat et la rumeur se remesurent au redimensionnement."""
    table = (STATIQUE / "js" / "table.js").read_text(encoding="utf-8")
    assert 'addEventListener("resize"' in table
    for appel in ("ajusterPapier()", "reajusterVues()", "majBandeau()", "remesurerEcran()"):
        assert appel in table, appel
    fiches = (STATIQUE / "js" / "table" / "fiches.js").read_text(encoding="utf-8")
    assert "function ajusterTablee" in fiches and "function ajusterFiches" in fiches
    plan = (STATIQUE / "js" / "table" / "carte-plan.js").read_text(encoding="utf-8")
    assert "S.basRumeur" in plan
