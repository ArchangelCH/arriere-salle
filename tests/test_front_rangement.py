"""Le rangement du front : à la racine de app/static/js/, seules les pages et api.js ; chaque import relatif trouve son fichier."""

import shutil
import subprocess
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parent.parent
JS = RACINE / "app" / "static" / "js"
PAGES = {"api.js", "atelier.js", "table.js", "telecommande.js", "carte-x.js"}


def test_la_racine_ne_garde_que_les_pages_et_api():
    assert {f.name for f in JS.glob("*.js")} == PAGES


@pytest.mark.skipif(shutil.which("node") is None, reason="node absent de l'image des essais")
def test_chaque_import_relatif_trouve_son_fichier():
    r = subprocess.run(["node", str(RACINE / "outils" / "verifier_imports.mjs")], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout
