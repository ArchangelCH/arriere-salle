"""La brume d'un plan (plan.brume : 0 rien, 1 voile, 2 épaisse, case par case) : la TV ne la reçoit que sur les cases
révélées, et un pion qui n'est pas un héros, perdu dans la brume épaisse, ne part pas vers elle."""

import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, config, tv_cartes, tv_plans  # noqa: E402

J = tv_cartes.jeton
W, H = 6, 3
# Deux salles côte à côte : A (x < 3) révélée, B (x >= 3) cachée.
BROUILLARD = [1 if x < 3 else 0 for y in range(H) for x in range(W)]


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def grille(cases: dict) -> list:
    return [cases.get((x, y), 0) for y in range(H) for x in range(W)]


def plan_d_essai(nom: str, brume=None, pions=()) -> dict:
    plan = {
        "nom": nom, "largeur": W, "hauteur": H, "m_case": 1.5, "brouillard_actif": True,
        "sol": [2] * (W * H), "piece": [1 if x < 3 else 2 for y in range(H) for x in range(W)], "brouillard": BROUILLARD,
        "pieces": [{"id": 1, "nom": "Salle A", "genre": "salle"}, {"id": 2, "nom": "Salle B", "genre": "salle"}],
        "portes": [], "objets": [], "pions": list(pions), "textes": [],
    }
    if brume is not None:
        plan["brume"] = brume
    return plan


def publier(client, nom, **k):
    p = client.post("/api/plans", json=plan_d_essai(nom, **k)).json()
    return p, J("plans", p["id"])


def test_la_brume_ne_va_a_la_tv_que_sur_les_cases_revelees(client):
    # Voile et brume épaisse dans la salle A, une nappe épaisse entière dans la salle B, encore cachée.
    brume = grille({(0, 0): 1, (1, 0): 2, (2, 1): 1, (3, 0): 2, (4, 0): 2, (5, 0): 2, (3, 1): 2, (4, 1): 1, (5, 2): 2})
    p, jp = publier(client, "Etang d'essai", brume=brume)
    pub = client.get(f"/api/table/plan/{jp}").json()
    assert pub["brume"] == grille({(0, 0): 1, (1, 0): 2, (2, 1): 1})
    # Rien de la salle B, pas même la forme de sa brume.
    assert all(v == 0 for i, v in enumerate(pub["brume"]) if not BROUILLARD[i])

    # La brume seulement sur la salle cachée : la TV n'en reçoit rien du tout.
    p["brume"] = grille({(4, 0): 2, (4, 1): 2, (5, 1): 1})
    client.put(f"/api/plans/{p['id']}", json=p)
    assert client.get(f"/api/table/plan/{jp}").json()["brume"] == []

    # Sans brouillard, toute la brume se voit.
    p["brouillard_actif"] = False
    client.put(f"/api/plans/{p['id']}", json=p)
    assert client.get(f"/api/table/plan/{jp}").json()["brume"] == p["brume"]
    assert client.delete(f"/api/plans/{p['id']}").json() == {"ok": True}


def test_la_brume_epaisse_cache_adversaires_et_pnj_mais_pas_les_heros(client):
    brume = grille({(1, 0): 2, (2, 0): 2, (1, 1): 2, (1, 2): 2, (0, 0): 1, (2, 1): 1, (4, 1): 2})
    pions = [
        {"id": "t-heros-brume", "genre": "heros", "nom": "Tavarède", "ref": "aventurier:tavarede", "x": 1.5, "y": 0.5},
        {"id": "t-ennemi-brume", "genre": "ennemi", "nom": "Brigand", "court": "1", "x": 2.5, "y": 0.5},
        {"id": "t-pnj-brume", "genre": "pnj", "nom": "Clémence", "ref": "pnj:clemence-d-essai", "x": 1.5, "y": 1.5},
        {"id": "t-autre-brume", "genre": "autre", "nom": "Chien errant", "x": 1.5, "y": 2.5},
        {"id": "t-grand-brume", "genre": "ennemi", "nom": "Ours", "court": "2", "taille": 2, "x": 2, "y": 1},
        {"id": "t-ennemi-voile", "genre": "ennemi", "nom": "Brigand", "court": "3", "x": 0.5, "y": 0.5},
        {"id": "t-ennemi-voile-2", "genre": "ennemi", "nom": "Brigand", "court": "4", "x": 2.5, "y": 1.5},
        {"id": "t-ennemi-clair", "genre": "ennemi", "nom": "Brigand", "court": "5", "x": 0.5, "y": 1.5},
        {"id": "t-embuscade", "genre": "ennemi", "nom": "Brigand", "court": "6", "x": 0.5, "y": 2.5, "cache": True},
    ]
    client.post("/api/pnj", json={"nom": "Clémence d'essai", "connu": True})
    p, jp = publier(client, "Brume d'essai", brume=brume, pions=pions)
    public = client.get(f"/api/table/plan/{jp}")
    assert public.status_code == 200
    ids = [t["id"] for t in public.json()["pions"]]
    # Le héros reste ; dans le voile, on voit les adversaires ; un grand pion compte par la case de son centre, comme pour
    # le brouillard (l'ours, centré en 2 ; 1, un voile, a trois de ses quatre cases dans l'épaisse).
    assert ids == ["t-heros-brume", "t-grand-brume", "t-ennemi-voile", "t-ennemi-voile-2", "t-ennemi-clair"]
    for cache in ("t-ennemi-brume", "t-pnj-brume", "t-autre-brume", "Clémence", "Chien errant", "t-embuscade"):
        assert cache not in public.text, cache

    # La brume se dissipe : tout ce qu'elle cachait réapparaît (l'embuscade, non).
    p["brume"] = [0] * (W * H)
    client.put(f"/api/plans/{p['id']}", json=p)
    pub = client.get(f"/api/table/plan/{jp}").json()
    assert pub["brume"] == []
    assert [t["id"] for t in pub["pions"]] == [t["id"] for t in pions if not t.get("cache")]
    assert [t["nom"] for t in pub["pions"] if t["id"] == "t-pnj-brume"] == ["Clémence d'essai"]

    # Dans le voile seulement, rien ne disparaît.
    p["brume"] = [1] * (W * H)
    client.put(f"/api/plans/{p['id']}", json=p)
    assert len(client.get(f"/api/table/plan/{jp}").json()["pions"]) == 8

    # Une brume épaisse posée sur la salle cachée ne change rien à ce qui y est caché (et rien n'y est montré).
    p["brume"] = grille({(x, y): 2 for x in range(3, 6) for y in range(3)})
    p["pions"].append({"id": "t-dans-b", "genre": "heros", "nom": "Velora", "x": 4.5, "y": 1.5})
    client.put(f"/api/plans/{p['id']}", json=p)
    pub = client.get(f"/api/table/plan/{jp}").json()
    assert pub["brume"] == [] and "t-dans-b" not in [t["id"] for t in pub["pions"]] and len(pub["pions"]) == 8
    assert client.delete(f"/api/plans/{p['id']}").json() == {"ok": True}


@pytest.mark.parametrize("brume", [None, "rien", {"0": 2}, [2] * 3, [2] * 40, ["2", 3, -1, None, True, 2.0, [2], {"v": 2}] + [0] * 10])
def test_un_plan_sans_brume_ou_a_la_brume_abimee(client, brume):
    pions = [{"id": "t-ennemi", "genre": "ennemi", "court": "1", "x": 0.5, "y": 0.5},
             {"id": "t-ennemi-2", "genre": "ennemi", "court": "2", "x": 1.5, "y": 0.5}]
    p, jp = publier(client, "Plan sans brume", brume=brume, pions=pions)
    public = client.get(f"/api/table/plan/{jp}")
    assert public.status_code == 200
    pub = public.json()
    attendu = tv_plans.cases_brume({"largeur": W, "hauteur": H, "brume": brume})
    assert set(attendu) <= {0, 1, 2} and len(attendu) == W * H
    vus = [v if BROUILLARD[i] else 0 for i, v in enumerate(attendu)]
    assert pub["brume"] == (vus if any(vus) else [])
    # Seule une vraie brume épaisse (2) cache un pion : les deux, posés en (0, 0) et (1, 0), avec [2] * 3 (complétée par
    # du vide) et [2] * 40 (coupée à la taille du plan) ; dans la liste abîmée, seuls True (un voile) et 2.0 comptent,
    # tous deux dans la salle cachée.
    caches = {"t-ennemi", "t-ennemi-2"} if isinstance(brume, list) and brume[:2] == [2, 2] else set()
    if isinstance(brume, list) and brume[:1] == ["2"]:
        assert attendu[:6] == [0, 0, 0, 0, 1, 2] and not any(attendu[6:])
    assert {t["id"] for t in pub["pions"]} == {"t-ennemi", "t-ennemi-2"} - caches
    assert client.delete(f"/api/plans/{p['id']}").json() == {"ok": True}


def test_la_brume_ne_s_ecrit_pas_par_la_table_publique(client):
    """Aucune route nouvelle : la brume ne passe que par l'enregistrement du plan, fermé à Internet."""
    config.TABLE_OUVERTURE.unlink(missing_ok=True)  # sans réglage, la table publique est ouverte
    p, jp = publier(client, "Plan d'Internet", brume=grille({(0, 0): 2}))
    cf = {"CF-Connecting-IP": "203.0.113.7"}
    assert client.put(f"/api/plans/{p['id']}", json=p, headers=cf).status_code == 404
    assert client.get(f"/api/plans/{p['id']}", headers=cf).status_code == 404
    # La table publique lit le plan que la TV montre, et lui seul (lectures_publiques.py).
    assert client.get(f"/api/table/plan/{jp}", headers=cf).status_code == 404
    client.put("/api/table", json={"vue": "plan", "plan": p["id"]})
    assert client.get(f"/api/table/plan/{jp}", headers=cf).json()["brume"] == grille({(0, 0): 2})
    client.put("/api/table", json={"vue": "accueil"})
    assert client.delete(f"/api/plans/{p['id']}").json() == {"ok": True}


def test_la_vue_joueurs_et_l_export_de_l_atelier_peignent_la_brume_comme_la_tv():
    """Dans l'atelier, « Vue joueurs » et l'export des joueurs ne peignent que la brume des cases révélées (brumeVue,
    même règle que plan_public) : une brume posée sur une zone cachée n'en dessine pas la forme. La règle elle-même se
    vérifie avec node outils/verifier_brume.mjs."""
    js = Path(__file__).resolve().parent.parent / "app" / "static" / "js" / "plan"
    modele = (js / "modele.js").read_text(encoding="utf-8")
    brume = (js / "brume.js").read_text(encoding="utf-8")
    assert "export function brumeVue(p, joueurs)" in modele
    relire = brume.split("  relire() {")[1].split("\n  }\n")[0]
    assert "brumeVue(plan, this.joueurs)" in relire and "masquesBrume(plan, b)" in relire
    exporter = brume.split("  exporter(ctx, l, h, joueurs) {")[1].split("\n  }\n")[0]
    assert "brumeVue(v.plan, joueurs)" in exporter and "masquesBrume(v.plan, b)" in exporter
    # Aucun masque fait sur la brume brute du plan.
    assert "masquesBrume(plan)" not in brume and "masquesBrume(v.plan)" not in brume
    # Une pièce révélée ou cachée en vue joueurs relit la brume.
    vue = (js / "vue.js").read_text(encoding="utf-8")
    assert "this.brume.verifier()" in vue.split("  rafraichirZone(z, options = {}) {")[1].split("\n  }\n")[0]
