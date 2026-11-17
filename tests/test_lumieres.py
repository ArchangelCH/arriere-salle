"""Les lumières d'un plan, posées et réglées à la main (outil Lumières, js/plan/lumieres.js et lumieres-menu.js) : ce que
la TV en reçoit (une lumière éteinte, cachée ou dans une case cachée n'y est pas ; ni nom du MJ, ni type, ni état), le
câblage de l'outil dans l'éditeur, et les vérifieurs Node."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
APP = Path(__file__).resolve().parent.parent / "app"
sys.path.insert(0, str(APP))

import pytest  # noqa: E402

from ia import habillage  # noqa: E402

JS = APP / "static" / "js" / "plan"
RACINE = Path(__file__).resolve().parent.parent


def lumiere(ident, x, y, **kw):
    return {"id": ident, "x": x, "y": y, "rayon": 4, "couleur": "#ffa94d", "intensite": 0.9, "type": "torche",
            "source": f"SECRET-{ident}", **kw}


def tv(lumieres, revele=lambda x, y: True):
    hab = {"heure": "soir", "lumieres": lumieres, "objets": [], "legende": []}
    return habillage.plan_tv(hab, revele, {})["lumieres"]


def test_la_tv_ne_recoit_que_les_lumieres_allumees_visibles_et_revelees():
    sortie = tv([lumiere("l1", 1.5, 1.5), lumiere("l2", 2.5, 1.5, eteinte=True), lumiere("l3", 3.5, 1.5, cache=True),
                 lumiere("l4", 8.5, 1.5)], revele=lambda x, y: x < 5)
    assert [l["id"] for l in sortie] == ["l1"]


def test_la_tv_ne_recoit_ni_nom_ni_type_ni_etat():
    (l,) = tv([lumiere("l1", 1.5, 1.5, cache=False)])
    assert set(l) == {"id", "x", "y", "rayon", "couleur", "intensite"}
    assert "SECRET" not in json.dumps(l)


def test_les_bornes_de_la_tv_valent_celles_du_menu():
    # Portée de 0,8 à 10 et intensité de 0,1 à 1 dans le menu (lumieres.js) : la TV ne les rogne pas.
    (l,) = tv([lumiere("l1", 1.5, 1.5, rayon=10, intensite=1)])
    assert l["rayon"] == 10 and l["intensite"] == 1
    (l,) = tv([lumiere("l1", 1.5, 1.5, rayon=0.8, intensite=0.1)])
    assert l["rayon"] == 0.8 and l["intensite"] == 0.1


def test_l_outil_est_cable_dans_l_editeur():
    editeur = (JS / "editeur.js").read_text(encoding="utf-8")
    for attendu in ('["lumiere", "Lumières", "O"]', 'case "lumiere":', 'genres.includes("lumiere")', "ajouterLumiere(x, y)",
                    "actionLumiere(d)", "if (d.lum) return this.actionLumiere(d);", "lumiere: this.optLumiere",
                    'from "./lumieres-menu.js"', 'from "./lumieres.js"', 'this.outil === "lumiere") html = this.panneauLumieres()'):
        assert attendu in editeur, attendu
    # Le menu et la logique vivent à part, et le menu ne parle pas de l'IA.
    menu = (JS / "lumieres-menu.js").read_text(encoding="utf-8")
    assert "data-lum=\"tout-eteindre\"" in menu and "jamais sur la TV" in menu
    assert "claude" not in (menu + (JS / "lumieres.js").read_text(encoding="utf-8")).lower()


def test_une_lumiere_eteinte_n_est_pas_dessinee_au_rendu():
    peint = (JS / "peint.js").read_text(encoding="utf-8")
    assert "if (!l || l.eteinte) continue;" in peint


@pytest.mark.skipif(shutil.which("node") is None, reason="node absent")
def test_les_verifieurs_node_passent():
    r = subprocess.run(["node", str(RACINE / "outils" / "verifier_lumieres.mjs")], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout[-2000:] + r.stderr[-1000:]
