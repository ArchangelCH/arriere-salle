"""Les notes du joueur à la table du coin (notes.py, 19/11) : à lui seul (son fichier se trouve par sa session), bornées,
enregistrées sans rien perdre quand un autre appareil les a changées, effacées vides ; l'atelier n'a aucune route pour les
lire. Et les fichiers de la table (fiche en résumé, tiroirs) sont servis au coin."""
import os
import stat
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from commun import notes  # noqa: E402
import joueurs  # noqa: E402
from comptes_coin import entrer  # noqa: E402
import main  # noqa: E402,F401
from api import application, config  # noqa: E402


@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture(scope="module")
def deux(atelier):
    patch = pytest.MonkeyPatch()
    patch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    patch.setattr(joueurs, "COOKIE_SUR", False)
    patch.setattr(joueurs, "HOTES", set())
    patch.setattr(joueurs, "NOTES_ECRITES", {})
    t = {}
    for code, nom in (("a", "Ombeline"), ("b", "Corentin")):
        j = atelier.post("/api/joueurs", json={"nom": nom}).json()
        coin = TestClient(joueurs.app)
        entrer(coin, j)
        t[code] = {"joueur": j, "coin": coin}
    yield t
    for code in ("a", "b"):
        t[code]["coin"].close()
        atelier.delete(f"/api/joueurs/{t[code]['joueur']['id']}")
    patch.undo()


def test_sans_session_rien(deux):
    with TestClient(joueurs.app) as inconnu:
        assert inconnu.get("/api/notes").status_code in (401, 403)
        assert inconnu.put("/api/notes", json={"texte": "x"}).status_code in (401, 403)


def test_ecrire_relire_effacer(deux):
    a, b = deux["a"]["coin"], deux["b"]["coin"]
    assert a.get("/api/notes").json() == {"texte": "", "modifie": None}
    r = a.put("/api/notes", json={"texte": "Le passeur ment.\r\nIl doit 12 pièces.\x07", "base": None})
    assert r.status_code == 200, r.text
    n = r.json()
    assert n["texte"] == "Le passeur ment.\nIl doit 12 pièces." and n["modifie"]
    assert a.get("/api/notes").json() == n
    # À lui seul : l'autre joueur ne lit que les siennes.
    assert b.get("/api/notes").json()["texte"] == ""
    chemin = notes.fichier(config.PROPOSITIONS, deux["a"]["joueur"]["id"])
    assert stat.S_IMODE(chemin.stat().st_mode) == 0o600
    # Une suite, sur la version lue.
    n2 = a.put("/api/notes", json={"texte": n["texte"] + "\nLa tour du nord.", "base": n["modifie"]}).json()
    assert n2["texte"].endswith("La tour du nord.")
    # Vides : le fichier s'en va.
    assert a.put("/api/notes", json={"texte": "  \n", "base": n2["modifie"]}).json() == {"texte": "", "modifie": None}
    assert not chemin.exists()


def test_un_autre_appareil_entre_temps(deux):
    a = deux["a"]["coin"]
    n = a.put("/api/notes", json={"texte": "Version du téléphone.", "base": None}).json()
    # La tablette avait lu une version plus ancienne : refus, rien d'écrasé.
    r = a.put("/api/notes", json={"texte": "Version de la tablette.", "base": "2026-01-01T00:00:00.000"})
    assert r.status_code == 409
    # Sans version lue, des notes déjà écrites ne s'écrasent pas non plus.
    assert a.put("/api/notes", json={"texte": "Autre chose.", "base": None}).status_code == 409
    assert a.get("/api/notes").json() == n
    a.put("/api/notes", json={"texte": "", "base": n["modifie"]})


@pytest.mark.parametrize("corps", [{"texte": 12}, {"texte": "x", "base": 5}, {"texte": "x", "autre": 1}, {"base": None}])
def test_corps_illisibles(deux, corps):
    assert deux["a"]["coin"].put("/api/notes", json=corps).status_code == 400


def test_trop_long(deux):
    r = deux["a"]["coin"].put("/api/notes", json={"texte": "a" * (notes.TEXTE_MAX + 1), "base": None})
    assert r.status_code == 413


def test_l_atelier_ne_les_lit_pas(atelier, deux):
    deux["a"]["coin"].put("/api/notes", json={"texte": "NOTE-SECRETE-DU-JOUEUR", "base": None})
    assert atelier.get("/api/notes").status_code == 404
    assert "NOTE-SECRETE-DU-JOUEUR" not in atelier.get("/api/joueurs").text
    n = deux["a"]["coin"].get("/api/notes").json()
    deux["a"]["coin"].put("/api/notes", json={"texte": "", "base": n["modifie"]})


def test_les_fichiers_de_la_table_sont_servis_au_coin():
    for f in ("js/joueurs/table-heros.js", "css/table-heros.css", "css/sac-coin.css", "js/joueurs/sac.js"):
        assert f in joueurs.FICHIERS, f
