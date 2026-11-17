"""Le nom de l'auberge pour les joueurs (masque.py, /api/nom-auberge) : le carnet le reprend dès qu'il change, pas au
passage suivant de la tâche de fond ; un nom public qui coupe exprès le vrai (espaces, tirets, points, invisibles,
majuscules, chiffres, lettres d'un autre alphabet) est refusé, et le masque reconnaît aussi le vrai nom coupé dans un
texte, sans toucher aux mots ordinaires."""

import json
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from commun import carnet  # noqa: E402
import main  # noqa: E402
from api import application, carnet_api, config, noms_caches  # noqa: E402
from table import masque  # noqa: E402

COUPES = ["Fan frelée", "Fanfre-lée", "F.anfrelée", "F a n f r e l é e", "fA-nF-rE-lÉe", "Fan\xa0frelée", "Fan\u2009frelée",
          "Fan\u2014\u2013\u2014\u2013frelée", "F4nfrelée", "Fanfr\u0435lée", "ＦＡＮＦＲＥＬＥＥ", "La P'tite Fanf-relée",
          "Ja mais ne do rt", "Jamais.ne.dort", "Fan\xad fre\u200blée"]
ORDINAIRES = ["Le Chaudron", "l'auberge de Garin", "Les 3 Pots", "Au Bouclier", "La Taverne du Gué", "Chez Fanfan", "La Fanfare",
              "Le Fanfaron", "La Relée", "L'Étoile du soir"]


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture()
def nom_par_defaut(client):
    yield
    client.put("/api/nom-auberge", json={"nom": ""})
    noms_caches.NOM_AUBERGE.unlink(missing_ok=True)


def test_une_graphie_coupee_du_vrai_nom_est_refusee(client, nom_par_defaut):
    for nom in COUPES:
        r = client.put("/api/nom-auberge", json={"nom": nom})
        assert r.status_code == 400 and "vrai nom" in r.json()["detail"], nom
    for nom in ORDINAIRES:
        assert client.put("/api/nom-auberge", json={"nom": nom}).status_code == 200, nom
    client.put("/api/nom-auberge", json={"nom": ""})


def test_le_masque_reconnait_le_nom_coupe_dans_un_texte():
    masque.regler_nom_public("")
    for phrase, attendu in (("Ils dorment à la Fan frelée.", "Ils dorment à l'auberge."),
                            ("Le comptoir de la Fanfre-lée.", "Le comptoir de l'auberge."),
                            ("La F.anfrelée brûle.", "L'auberge brûle."),
                            ("Ils reviennent à la Petite Fanf-\nrelée, l'auberge de Garin.", "Ils reviennent à l'auberge de Garin."),
                            ("« Jamais ne do-rt », dit Garin.", "L'auberge, dit Garin.")):
        assert masque.masquer(phrase) == attendu, phrase
        assert masque.contient_nom_cache(phrase)
    # Les mots ordinaires ne bougent pas : ni fanfare, ni fanfreluche, ni une virgule qui sépare deux mots.
    for phrase in ("Une fanfare !", "Une fanfreluche dorée.", "Ils sont fanfarons.", "Fan, frelée contre le mur.",
                   "do ré fa fan", "Jamais ne dors. Il dort.", "La relée du pont a cédé."):
        assert masque.masquer(phrase) == phrase and not masque.contient_nom_cache(phrase), phrase


def test_le_carnet_prend_le_nouveau_nom_tout_de_suite(client, nom_par_defaut, monkeypatch):
    seance = client.post("/api/seances", json={"nom": "La séance du nom", "numero": 61, "close": True, "date": "2026-11-01",
                                               "precedemment": "Ils ont dormi à la Petite Fanfrelée."}).json()
    assert client.put("/api/carnet-joueurs", json={"ouvert": True}).status_code == 200
    fichier = config.PROPOSITIONS / carnet.CARNET / "precedemment.json"

    def recit():
        elements = json.loads(fichier.read_text(encoding="utf-8"))["elements"]
        return next(e["texte"] for e in elements if e["numero"] == 61)

    assert recit() == "Ils ont dormi à l'auberge."
    # La tâche de fond ne passe pas pendant l'essai : seul le changement du réglage republie.
    sources = carnet_api.sources_du_carnet()
    assert client.put("/api/nom-auberge", json={"nom": "le Chaudron"}).status_code == 200
    assert recit() == "Ils ont dormi au Chaudron."
    assert carnet_api.sources_du_carnet() != sources
    # Un échec de la publication n'empêche pas le réglage : la tâche de fond s'en chargera.
    monkeypatch.setattr(carnet_api, "publier_carnet", lambda: (_ for _ in ()).throw(OSError("disque plein")))
    r = client.put("/api/nom-auberge", json={"nom": "la Taverne"})
    assert r.status_code == 200 and r.json()["public"] == "la Taverne"
    monkeypatch.undo()
    client.put("/api/carnet-joueurs", json={"ouvert": False})
    client.delete(f"/api/seances/{seance['id']}")
