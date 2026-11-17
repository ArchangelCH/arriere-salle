"""Le sang d'un plan (outil Sang, js/plan/sang.js et sang-menu.js) : ce que la TV en reçoit (seulement les taches visibles, dans
une case révélée, bornées, sans rien d'autre), le câblage de l'outil dans l'éditeur, le module servi au coin des joueurs, et
le vérifieur Node."""
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
import joueurs  # noqa: E402

JS = APP / "static" / "js" / "plan"
RACINE = Path(__file__).resolve().parent.parent


def tache(x, y, **kw):
    return {"x": x, "y": y, "r": 1, "type": "flaque", "age": 0.2, "graine": 123, "rot": 0.5, "teinte": "rouge", **kw}


def tv(sang, revele=lambda x, y: True):
    hab = {"lumieres": [], "objets": [], "legende": [], "sang": sang}
    return habillage.plan_tv(hab, revele, {})["sang"]


def test_la_tv_ne_recoit_que_le_sang_visible_et_revele():
    sortie = tv([tache(1.5, 1.5), tache(2.5, 1.5, cache=True), tache(8.5, 1.5)], revele=lambda x, y: x < 5)
    assert [(s["x"], s["y"]) for s in sortie] == [(1.5, 1.5)]


def test_la_tv_borne_et_nettoie_chaque_tache():
    (s,) = tv([tache(1.5, 1.5, r=99, age=7, teinte="jaune", graine=-5, rot=99, secret="NOTE-DU-MJ", type="trainee", l=99)])
    assert s == {"x": 1.5, "y": 1.5, "r": 4, "type": "trainee", "age": 1, "graine": 5, "rot": 7, "teinte": "rouge", "l": 12}
    assert "NOTE" not in str(s)
    assert tv([tache(1.5, 1.5, type="inconnue")]) == []
    assert tv([{"x": "a", "y": 1}, "pas une tache", None]) == []
    assert "l" not in tv([tache(1.5, 1.5)])[0]


def test_la_tv_ne_depasse_pas_le_maximum():
    assert len(tv([tache(1.5, 1.5)] * (habillage.SANG_MAX + 50))) == habillage.SANG_MAX


def test_un_plan_sans_sang_donne_une_liste_vide():
    assert habillage.plan_tv({"heure": "soir"}, lambda x, y: True, {})["sang"] == []


def test_l_outil_est_cable_dans_l_editeur():
    editeur = (JS / "editeur.js").read_text(encoding="utf-8")
    for attendu in ('["sang", "Sang", "S"]', 'case "sang":', "poserSang(x, y)", "finSang(g)", "actionSang(d)", "if (d.sang) return this.actionSang(d);",
                    "sang: this.optSang", 'from "./sang-menu.js"', 'from "./sang.js"', 'if (o === "sang") return htmlSang(', "d.sangReglage",
                    'if (g.type === "sang") return this.poserSang(x, y);'):
        assert attendu in editeur, attendu
    assert "sang" in (JS / "sang-menu.js").read_text(encoding="utf-8")


def test_le_dessin_du_sang_est_servi_au_coin_et_au_rendu():
    # La TV et le coin dessinent le sang : peint.js l'importe, le coin le sert, la lecture des joueurs ne montre pas le caché.
    assert "js/plan/sang.js" in joueurs.FICHIERS
    peint = (JS / "peint.js").read_text(encoding="utf-8")
    assert 'from "./sang.js"' in peint and "s.cache || !reveleA(p, s.x, s.y)" in peint and "dessinerSangPlan(ctx, p, sangVu(p, etat.joueurs)" in peint and "sang: undefined" in peint
    assert (JS / "sang.js").exists()


def test_rien_de_l_ia_dans_le_menu_ni_dans_le_dessin():
    texte = ((JS / "sang.js").read_text(encoding="utf-8") + (JS / "sang-menu.js").read_text(encoding="utf-8")).lower()
    assert "claude" not in texte and "anthropic" not in texte


@pytest.mark.skipif(shutil.which("node") is None, reason="node absent")
def test_le_verifieur_node_passe():
    r = subprocess.run(["node", str(RACINE / "outils" / "verifier_sang.mjs")], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout[-2000:] + r.stderr[-1000:]
