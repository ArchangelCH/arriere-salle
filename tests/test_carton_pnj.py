"""Le carton d'un PNJ vérifié avant de partir vers la TV : ce qu'il nomme d'encore inconnu des joueurs (un lieu dans son
rôle, un autre PNJ dans son apparence), tel que la TV le montrerait. Le PNJ lui-même n'y compte pas, et la route reste
fermée à la table publique et à Internet sans session."""
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, config, portier  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture
def monde(client):
    """Vadim, connu, chef des brigands d'une ferme que les joueurs ignorent ; Amandine et Cyril, inconnus, mère et fils."""
    creees = []

    def creer(collection, **fiche):
        f = client.post(f"/api/{collection}", json=fiche).json()
        creees.append((collection, f["id"]))
        return f

    m = {
        "ferme": creer("lieux", nom="La Ferme-Grise", type="ruine", connu=False, secrets="Le repaire."),
        "moulin": creer("lieux", nom="Le moulin des Varenne-Verts", type="point", connu=True),
        "vadim": creer("pnj", nom="Vadim Pinson", surnom="le Pinson", connu=True, role="Chef des brigands de la Ferme-Grise",
                         secret="Il a vu Lou faire monter l'eau."),
        "meunier": creer("pnj", nom="Gaspard Varenne-Vert", connu=True, role="Meunier du moulin des Varenne-Verts"),
        "amandine": creer("pnj", nom="Amandine Fournier", connu=False, role="Voyageuse", apparence="Un baluchon qu'elle ne lâche pas."),
        "cyril": creer("pnj", nom="Cyril Fournier", connu=False, role="Fils d'Amandine", apparence="Sept ans, de la suie aux joues."),
    }
    yield m
    for collection, ident in creees:
        client.delete(f"/api/{collection}/{ident}")


def carton(client, ident, **entetes):
    return client.get(f"/api/pnj/{ident}/carton", headers=entetes)


def test_le_role_qui_nomme_un_lieu_inconnu_est_signale(client, monde):
    secrets = carton(client, monde["vadim"]["id"]).json()["secrets"]
    assert [(x["genre"], x["nom"], x["ids"]) for x in secrets] == [("lieu", "La Ferme-Grise", [monde["ferme"]["id"]])]


def test_un_carton_qui_ne_nomme_que_du_connu_passe(client, monde):
    assert carton(client, monde["meunier"]["id"]).json()["secrets"] == []


def test_le_pnj_montre_ne_se_signale_pas_lui_meme(client, monde):
    # Amandine est inconnue : montrer son carton la rend connue. Son nom de famille ne désigne pas Cyril à lui seul.
    assert carton(client, monde["amandine"]["id"]).json()["secrets"] == []
    # Le carton de Cyril nomme Amandine dans son rôle : elle, oui.
    secrets = carton(client, monde["cyril"]["id"]).json()["secrets"]
    assert [(x["genre"], x["nom"]) for x in secrets] == [("pnj", "Amandine Fournier")]


def test_marquer_connu_fait_taire_l_avis(client, monde):
    client.patch(f"/api/lieux/{monde['ferme']['id']}", json={"connu": True})
    assert carton(client, monde["vadim"]["id"]).json()["secrets"] == []


def test_un_pnj_inconnu_de_l_atelier_repond_404(client):
    assert carton(client, "personne-de-ce-nom").status_code == 404


def test_la_table_publique_et_internet_sans_session_n_y_ont_pas_acces(client, monde, monkeypatch):
    assert carton(client, monde["vadim"]["id"], **{"CF-Connecting-IP": "203.0.113.7"}).status_code == 404
    monkeypatch.setattr(portier, "ATELIER_PUBLIC", {"atelier.example.ch"})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {"atelier.example.ch"})
    assert carton(client, monde["vadim"]["id"], Host="atelier.example.ch", **{"CF-Connecting-IP": "203.0.113.9"}).status_code == 401


def test_chaque_chemin_qui_montre_un_carton_passe_par_la_question():
    """Chaque page de l'atelier qui pose un PNJ sur la TV (« pnj: <id> » envoyé à /api/table) vérifie d'abord ce que son
    carton nomme : cartonVerifie (carton-pnj.js), ou nomsInconnus sur la télécommande. L'Auberge (« Au comptoir ce soir »)
    l'avait oublié : Amandine, « mère de Cyril », partait sans question."""
    import re
    envoi = re.compile(r"envoyer\(\{\s*pnj:(?!\s*null)|\.\.\.(?:etat|t),\s*pnj:(?!\s*null)|\{\s*pnj:\s*montrer")
    pages = []
    for f in (Path(config.ICI) / "static" / "js").rglob("*.js"):
        t = f.read_text(encoding="utf-8")
        if envoi.search(t):
            pages.append(f.relative_to(config.ICI).as_posix())
            assert "cartonVerifie(" in t or "nomsInconnus(" in t, f
    assert {"static/js/auberge/auberge.js", "static/js/pnj/carnet.js", "static/js/plan/editeur.js", "static/js/seances/seances.js",
            "static/js/tableau/impro.js", "static/js/telecommande/gestes.js"} <= set(pages), pages
