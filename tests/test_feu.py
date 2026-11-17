"""Le feu d'un plan (plan.feu : 0 rien, 1 braises, 2 flammes, 3 brasier, 4 calciné, case par case) et ses étapes
(plan.etapes : le feu et la brume gardés pour la partie) : la TV ne reçoit que le feu du moment, sur les cases révélées
qui ont un sol, jamais une étape préparée ; la brume peut prendre la teinte de la fumée."""

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
from api import application, config, tv_cartes, tv_plans  # noqa: E402
from sources_front import source_page  # noqa: E402

J = tv_cartes.jeton
W, H = 6, 3
STATIQUE = Path(__file__).resolve().parent.parent / "app" / "static"
# Deux salles côte à côte : A (x < 3) révélée, B (x >= 3) cachée ; la case (2, 2) n'a pas de sol.
BROUILLARD = [1 if x < 3 else 0 for y in range(H) for x in range(W)]
SOL = [0 if (x, y) == (2, 2) else 2 for y in range(H) for x in range(W)]


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def grille(cases: dict) -> list:
    return [cases.get((x, y), 0) for y in range(H) for x in range(W)]


def plan_d_essai(nom: str, **champs) -> dict:
    plan = {
        "nom": nom, "largeur": W, "hauteur": H, "m_case": 1.5, "brouillard_actif": True,
        "sol": SOL, "piece": [1 if x < 3 else 2 for y in range(H) for x in range(W)], "brouillard": BROUILLARD,
        "pieces": [{"id": 1, "nom": "Salle A", "genre": "salle"}, {"id": 2, "nom": "Salle B", "genre": "salle"}],
        "portes": [], "objets": [], "pions": [], "textes": [],
    }
    plan.update(champs)
    return plan


def publier(client, nom, **k):
    p = client.post("/api/plans", json=plan_d_essai(nom, **k)).json()
    return p, J("plans", p["id"])


def test_le_feu_ne_va_a_la_tv_que_sur_les_cases_revelees_et_jamais_ses_etapes(client):
    feu = grille({(0, 0): 1, (1, 0): 3, (2, 1): 2, (2, 2): 3, (3, 0): 3, (4, 1): 4, (5, 2): 2})
    # Deux étapes préparées : un brasier partout (et une brume épaisse), puis tout calciné.
    etapes = [{"nom": "Le toit tombe", "feu": [3] * (W * H), "brume": [2] * (W * H)},
              {"nom": "L'aube", "feu": [4] * (W * H), "brume": [0] * (W * H)}]
    p, jp = publier(client, "Auberge d'essai en flammes", feu=feu, etapes=etapes, etape=None)
    public = client.get(f"/api/table/plan/{jp}")
    assert public.status_code == 200
    pub = public.json()
    # La salle A seulement, et rien sur la case sans sol.
    assert pub["feu"] == grille({(0, 0): 1, (1, 0): 3, (2, 1): 2})
    assert "etapes" not in pub and "etape" not in pub
    assert "Le toit tombe" not in public.text and "L'aube" not in public.text
    # Le plan enregistré garde tout : le feu, les étapes et celle en cours.
    relu = client.get(f"/api/plans/{p['id']}").json()
    assert relu["etapes"] == etapes and relu["feu"] == feu

    # L'étape 1 rappelée par l'atelier : son feu et sa brume deviennent ceux du plan ; la TV ne voit que la salle A.
    relu |= {"feu": etapes[0]["feu"], "brume": etapes[0]["brume"], "etape": 0}
    client.put(f"/api/plans/{p['id']}", json=relu)
    pub = client.get(f"/api/table/plan/{jp}").json()
    assert pub["feu"] == [3 if BROUILLARD[i] and SOL[i] else 0 for i in range(W * H)]
    assert pub["brume"] == [2 if BROUILLARD[i] else 0 for i in range(W * H)]

    # Le feu seulement dans la salle cachée : la TV n'en reçoit rien du tout.
    relu = client.get(f"/api/plans/{p['id']}").json() | {"feu": grille({(4, 0): 3, (5, 1): 2})}
    client.put(f"/api/plans/{p['id']}", json=relu)
    assert client.get(f"/api/table/plan/{jp}").json()["feu"] == []

    # Sans brouillard, tout le feu se voit (hors du sol, toujours rien).
    relu = client.get(f"/api/plans/{p['id']}").json() | {"feu": feu, "brouillard_actif": False}
    client.put(f"/api/plans/{p['id']}", json=relu)
    assert client.get(f"/api/table/plan/{jp}").json()["feu"] == [0 if i == 2 * W + 2 else v for i, v in enumerate(feu)]
    assert client.delete(f"/api/plans/{p['id']}").json() == {"ok": True}


@pytest.mark.parametrize("feu", [None, "rien", {"0": 3}, [3] * 3, [3] * 40, [5, -1, 2.5, "3", True, None, [3], 2.0, 4] + [0] * 9])
def test_un_plan_sans_feu_ou_au_feu_abime(client, feu):
    champs = {} if feu is None else {"feu": feu}
    p, jp = publier(client, "Plan sans feu", **champs)
    public = client.get(f"/api/table/plan/{jp}")
    assert public.status_code == 200
    attendu = tv_plans.cases_feu({"largeur": W, "hauteur": H, "sol": SOL, "feu": feu})
    assert set(attendu) <= {0, 1, 2, 3, 4} and len(attendu) == W * H
    if isinstance(feu, list) and feu[:1] == [5]:
        # Seuls 2.0 (un entier écrit en flottant) et 4 comptent, tous deux dans la salle cachée.
        assert attendu[:9] == [0, 0, 0, 0, 0, 0, 0, 2, 4] and not any(attendu[9:])
    vus = [v if BROUILLARD[i] else 0 for i, v in enumerate(attendu)]
    assert public.json()["feu"] == (vus if any(vus) else [])
    assert client.delete(f"/api/plans/{p['id']}").json() == {"ok": True}


@pytest.mark.parametrize("teinte, attendue", [("fumee", "fumee"), ("brume", "brume"), (None, "brume"), ("rouge", "brume"), (3, "brume")])
def test_la_brume_peut_prendre_la_teinte_de_la_fumee(client, teinte, attendue):
    champs = {"brume": grille({(0, 0): 2})} | ({} if teinte is None else {"brume_teinte": teinte})
    p, jp = publier(client, "Fumée d'essai", **champs)
    assert client.get(f"/api/table/plan/{jp}").json()["brume_teinte"] == attendue
    assert client.delete(f"/api/plans/{p['id']}").json() == {"ok": True}


def test_le_feu_ne_s_ecrit_pas_par_la_table_publique(client):
    """Aucune route nouvelle : le feu et les étapes ne passent que par l'enregistrement du plan, fermé à Internet."""
    config.TABLE_OUVERTURE.unlink(missing_ok=True)  # sans réglage, la table publique est ouverte
    p, jp = publier(client, "Plan d'Internet en flammes", feu=grille({(0, 0): 3}), etapes=[{"nom": "Étape 1", "feu": [3] * (W * H), "brume": [0] * (W * H)}])
    cf = {"CF-Connecting-IP": "203.0.113.7"}
    assert client.put(f"/api/plans/{p['id']}", json=p, headers=cf).status_code == 404
    assert client.get(f"/api/plans/{p['id']}", headers=cf).status_code == 404
    client.put("/api/table", json={"vue": "plan", "plan": p["id"]})  # la table publique ne lit que le plan montré
    pub = client.get(f"/api/table/plan/{jp}", headers=cf).json()
    client.put("/api/table", json={"vue": "accueil"})
    assert pub["feu"] == grille({(0, 0): 3}) and "etapes" not in pub
    assert client.delete(f"/api/plans/{p['id']}").json() == {"ok": True}


def test_le_feu_a_son_calque_sans_repeindre_le_plan():
    """Le feu danse sur son propre calque, posé sur celui de la brume, à 24 images par seconde dans l'atelier et 12 sur la
    TV : le changer ne repeint le plan de la TV que si la lumière qu'il jette change (lumieresDuFeu, dans la signature
    de sa structure), et ce calque ne prend aucun geste."""
    vue = (STATIQUE / "js" / "plan" / "vue.js").read_text(encoding="utf-8")
    signature = re.search(r"export function signatureStructure\(p\) \{\n(.*?)\n\}", vue, flags=re.S).group(1)
    assert "lumieresDuFeu(p, true)" in signature and "p.feu" not in signature
    html = (STATIQUE / "table.html").read_text(encoding="utf-8")
    assert re.search(r'<canvas class="brume-plan"[^>]*></canvas>\s*<canvas class="feu-plan"[^>]*></canvas>', html)
    table = source_page("table")
    assert re.search(r"new VuePlan\(.*\bfeu: \(\) => toileFeu\b", table) and "vuePlan.majFeu(" in table
    css = re.sub(r"/\*.*?\*/", "", (STATIQUE / "css" / "table.css").read_text(encoding="utf-8"), flags=re.S)
    assert "#plan.visible ~ .feu-plan" in css and re.search(r"\.feu-plan \{[^}]*pointer-events: none", css)
    atelier = re.sub(r"/\*.*?\*/", "", (STATIQUE / "css" / "atelier.css").read_text(encoding="utf-8"), flags=re.S)
    assert re.search(r"\.scene canvas\.feu-plan \{[^}]*pointer-events: none", atelier)
    feu = (STATIQUE / "js" / "plan" / "feu.js").read_text(encoding="utf-8")
    rythmes = dict(re.findall(r"export const FEU_(ATELIER|TV) = \{[^}]*\bimages: (\d+)", feu))
    assert int(rythmes["ATELIER"]) <= 24 and int(rythmes["TV"]) <= 12
    # La vue joueurs et l'export des joueurs peignent le feu des seules cases révélées, comme la TV.
    relire = feu.split("  relire() {")[1].split("\n  }\n")[0]
    assert "feuVue(plan, this.joueurs)" in relire
    exporter = feu.split("  exporter(ctx, l, h, joueurs) {")[1].split("\n  }\n")[0]
    assert "feuVue(v.plan, joueurs)" in exporter
    # Une pièce révélée ou cachée en vue joueurs relit le feu.
    assert "this.feu.verifier()" in vue.split("  rafraichirZone(z, options = {}) {")[1].split("\n  }\n")[0]
