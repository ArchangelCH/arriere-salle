"""Le lecteur des essais (cloisonnement.py, lot MJ-3) : hors d'une requête, le code d'un essai lit comme une tâche de fond
du serveur. Une requête passe par la Garde, qui pose le sien ; un essai qui veut un autre lecteur (aucun, un invité) le
pose lui-même. La suite tourne en veille (par défaut) comme en strict : ATELIER_CLOISONNEMENT=strict.

Les noms cachés des essais (masque.py lit data/noms-caches.json) : ceux de noms-caches-essai.json, un nom d'auberge
inventé pour les essais, et, sur un dépôt recouvert par un pack de campagne (docs/campagne.md), ceux que le pack ajoute
dans noms-caches-campagne.json, pour ses propres essais. Le fichier est posé dans le dossier des données des essais avant
tout import de l'atelier : masque.py le lit à son chargement."""

import json
import os
import sys
import tempfile
from pathlib import Path

ICI = Path(__file__).resolve().parent
sys.path.insert(0, str(ICI.parent / "app"))

# Le compte principal des essais (mj/proprietes.py) : un identifiant et un nom inventés, posés avant tout import.
os.environ.setdefault("ATELIER_MJ_PRINCIPAL", "alban")
os.environ.setdefault("ATELIER_MJ_NOM", "Alban")

if "DATA_DIR" not in os.environ:
    os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="arriere-salle-")
    noms = json.loads((ICI / "noms-caches-essai.json").read_text(encoding="utf-8"))
    if (ICI / "noms-caches-campagne.json").is_file():
        noms += json.loads((ICI / "noms-caches-campagne.json").read_text(encoding="utf-8"))
    (Path(os.environ["DATA_DIR"]) / "noms-caches.json").write_text(json.dumps(noms, ensure_ascii=False), encoding="utf-8")

import pytest  # noqa: E402

from mj import cloisonnement  # noqa: E402


@pytest.fixture(autouse=True)
def lecteur_des_essais():
    jeton = cloisonnement.poser_lecteur(cloisonnement.FOND)
    yield
    cloisonnement.retirer_lecteur(jeton)
