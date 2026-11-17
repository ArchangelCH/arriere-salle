"""L'effet des flammes d'un plan (plan.feu_effet, réglé dans l'outil Feu) : un texte libre du MJ, vide par défaut,
enregistré avec le plan et rappelé dans le suivi du combat quand la main passe à un combattant dans les flammes
(combats/flammes.js, vérifié par outils/verifier_flammes.mjs). Il reste à l'atelier : ni la TV, ni la table publique ne
le reçoivent."""

import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, config, tv_cartes  # noqa: E402
from sources_front import source_page  # noqa: E402

J = tv_cartes.jeton
W, H = 4, 2
STATIQUE = Path(__file__).resolve().parent.parent / "app" / "static"
EFFET = "Test de Physique, raté = 1D6 Santé (l'armure ne compte pas), puis la Petite Fanfrelée"


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def plan_d_essai(**champs) -> dict:
    """Une salle entièrement révélée qui brûle, un héros dans le brasier."""
    plan = {
        "nom": "Salle en flammes", "largeur": W, "hauteur": H, "m_case": 1.5, "brouillard_actif": True,
        "sol": [2] * (W * H), "piece": [1] * (W * H), "brouillard": [1] * (W * H), "feu": [3, 2, 1, 4, 0, 0, 0, 0],
        "pieces": [{"id": 1, "nom": "Salle", "genre": "salle"}], "portes": [], "objets": [], "textes": [],
        "pions": [{"id": "h", "genre": "heros", "ref": "aventurier:eloran", "nom": "Eloran", "x": 0.5, "y": 0.5}],
    }
    plan.update(champs)
    return plan


def test_l_effet_s_enregistre_avec_le_plan(client):
    p = client.post("/api/plans", json=plan_d_essai(feu_effet=EFFET)).json()
    assert client.get(f"/api/plans/{p['id']}").json()["feu_effet"] == EFFET
    # Changé puis effacé par l'éditeur, qui renvoie le plan entier.
    relu = client.get(f"/api/plans/{p['id']}").json()
    assert client.put(f"/api/plans/{p['id']}", json=relu | {"feu_effet": "1D6 Santé"}).status_code == 200
    assert client.get(f"/api/plans/{p['id']}").json()["feu_effet"] == "1D6 Santé"
    relu = client.get(f"/api/plans/{p['id']}").json()
    client.put(f"/api/plans/{p['id']}", json=relu | {"feu_effet": ""})
    assert client.get(f"/api/plans/{p['id']}").json()["feu_effet"] == ""
    assert client.delete(f"/api/plans/{p['id']}").json() == {"ok": True}


def test_un_plan_d_avant_l_effet_se_lit_tel_quel(client):
    """Pas de migration : un plan sans le champ se lit et s'enregistre comme avant ; l'éditeur le prend vide."""
    p = client.post("/api/plans", json=plan_d_essai()).json()
    relu = client.get(f"/api/plans/{p['id']}").json()
    assert "feu_effet" not in relu
    assert client.put(f"/api/plans/{p['id']}", json=relu).status_code == 200
    assert client.get(f"/api/table/plan/{J('plans', p['id'])}").status_code == 200
    editeur = (STATIQUE / "js" / "plan" / "editeur.js").read_text(encoding="utf-8")
    assert 'if (typeof p.feu_effet !== "string") p.feu_effet = "";' in editeur
    # Il s'annule comme le reste du plan, une saisie à la fois, comme le nom ou les notes.
    champs = re.search(r"const CHAMPS_ETAT = \[(.*?)\];", editeur).group(1)
    assert '"feu_effet"' in champs
    assert '["nom", "etage", "notes", "feu_effet"].includes(k)' in editeur
    assert client.delete(f"/api/plans/{p['id']}").json() == {"ok": True}


def test_l_effet_est_dans_l_outil_feu_vide_par_defaut_sans_regle_inventee():
    editeur = (STATIQUE / "js" / "plan" / "editeur.js").read_text(encoding="utf-8")
    panneau = editeur.split("  panneauFeu() {")[1].split("\n  }\n")[0]
    champ = re.search(r'<label class="champ">Effet des flammes<textarea [^>]*data-p="feu_effet"[^>]*>(.*?)</textarea></label>', panneau)
    assert champ and champ.group(1) == '${e(p.feu_effet || "")}' and 'maxlength="160"' in champ.group(0)
    # Un exemple en grisé, rien d'écrit à la place du MJ.
    assert 'placeholder="Par exemple : ' in champ.group(0)
    for texte in (panneau, (STATIQUE / "js" / "combats" / "flammes.js").read_text(encoding="utf-8")):
        assert "—" not in texte and "–" not in texte


def test_l_effet_ne_va_jamais_a_la_tv(client):
    p = client.post("/api/plans", json=plan_d_essai(feu_effet=EFFET)).json()
    jp = J("plans", p["id"])
    public = client.get(f"/api/table/plan/{jp}")
    assert public.status_code == 200
    # Le feu passe, sur les cases révélées ; l'effet, jamais.
    assert public.json()["feu"] == [3, 2, 1, 4, 0, 0, 0, 0]
    assert "feu_effet" not in public.json()
    for morceau in ("Physique", "1D6", "armure", "Fanfrelée", "Fanfrelee"):
        assert morceau not in public.text
    # Par Internet (la table publique) non plus, et le plan lui-même y reste fermé.
    config.TABLE_OUVERTURE.unlink(missing_ok=True)
    cf = {"CF-Connecting-IP": "203.0.113.9"}
    client.put("/api/table", json={"vue": "plan", "plan": p["id"]})  # la table publique ne lit que le plan montré
    pub = client.get(f"/api/table/plan/{jp}", headers=cf)
    client.put("/api/table", json={"vue": "accueil"})
    assert pub.status_code == 200 and "1D6" not in pub.text and "feu_effet" not in pub.json()
    assert client.get(f"/api/plans/{p['id']}", headers=cf).status_code == 404
    assert client.put(f"/api/plans/{p['id']}", json=p | {"feu_effet": "rien"}, headers=cf).status_code == 404
    assert client.delete(f"/api/plans/{p['id']}").json() == {"ok": True}


def test_rien_de_neuf_a_la_tv():
    """Le rappel vit dans le suivi du combat et le tableau du MJ (les deux passent par htmlRappels) ; le script de la TV
    n'en charge rien."""
    combat = (STATIQUE / "js" / "combats" / "combat.js").read_text(encoding="utf-8")
    assert 'import { FeuDuCombat } from "./flammes.js";' in combat
    rappels = combat.split("  htmlRappels(c) {")[1].split("\n  }\n")[0]
    assert "this.flammes.html(c" in rappels
    for vue in ("htmlCombat", "htmlCompact"):
        assert "this.htmlRappels(c)" in combat.split(f"  {vue}() {{")[1].split("\n  }\n")[0]
    table = source_page("table")
    assert "flammes.js" not in table and "feu_effet" not in table and "FeuDuCombat" not in table
    html = (STATIQUE / "index.html").read_text(encoding="utf-8")
    assert '<link rel="stylesheet" href="/static/css/flammes.css">' in html
    assert "flammes.css" not in (STATIQUE / "table.html").read_text(encoding="utf-8")
