"""La « suite » de la page de connexion de l'atelier en ligne (atelier.exemple.org) : après le mot de passe, le
MJ revient sur une page de l'atelier, jamais sur un autre site. Le navigateur retire tabulations et sauts de ligne d'une
adresse avant de la lire (« /<tab>/ailleurs » devient « //ailleurs ») et lit « \\ » comme « / »."""
import os
import sys
import tempfile
from pathlib import Path
from urllib.parse import urljoin, urlsplit

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import main  # noqa: E402
from api import pages  # noqa: E402

PIEGES = ["//ailleurs.example", "/\\ailleurs.example", "/\t/ailleurs.example", "/\n/ailleurs.example", "/\r/ailleurs.example",
          "/\t\\ailleurs.example", "/\r\n/ailleurs.example", "/\x00/ailleurs.example", "/\x7f/ailleurs.example",
          "https://ailleurs.example", "javascript:alert(1)", "\t//ailleurs.example", "/ \t/ailleurs.example"]


def comme_le_navigateur(adresse: str) -> str:
    """L'hôte où mène un « Location: » relatif, lu comme le lit le navigateur (WHATWG URL : tabulations et sauts de ligne
    retirés, « \\ » lu comme « / »)."""
    propre = "".join(c for c in adresse if c not in "\t\n\r").replace("\\", "/")
    return urlsplit(urljoin("https://atelier.exemple.org/connexion", propre)).netloc


def test_la_suite_ne_mene_jamais_ailleurs():
    for piege in PIEGES:
        suite = pages.suite_sure(piege)
        assert comme_le_navigateur(suite) == "atelier.exemple.org", (piege, suite)


def test_les_suites_de_l_atelier_passent():
    for suite in ("/", "/pnj", "/feuille-combat?id=x", "/#/cartes", "/table", "/telecommande"):
        assert pages.suite_sure(suite) == suite
