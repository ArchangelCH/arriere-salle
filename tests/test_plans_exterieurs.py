"""Les plans extérieurs : les listes partagées par le navigateur et le serveur (sols infranchissables, mobilier,
générateurs que connaît le plan conçu par l'API), et ce qui sort d'un plan extérieur à demi révélé vers la TV et le coin
des joueurs : ni la forme d'une zone cachée, ni un meuble caché, ni un bâtiment qu'on n'a pas révélé."""
import json
import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
ICI = Path(__file__).resolve().parent
sys.path.insert(0, str(ICI.parent / "app"))
sys.path.insert(0, str(ICI))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from commun import deplacement as dp  # noqa: E402
from ia import habillage  # noqa: E402
import main  # noqa: E402
from api import application, contexte_du_modele, ia_api, tv_cartes, tv_plans  # noqa: E402

J = tv_cartes.jeton
JS = ICI.parent / "app" / "static" / "js" / "plan"
MODELE_JS = (JS / "modele.js").read_text(encoding="utf-8")
DEHORS_JS = (JS / "generateurs-dehors.js").read_text(encoding="utf-8")
PLAN = json.loads((ICI / "plan-exterieur.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def test_les_sols_infranchissables_suivent_modele_js():
    sols = dict((int(i), c) for i, c in re.findall(r"\{ id: (\d+), cle: \"([a-z-]+)\"", MODELE_JS))
    infranchissables = {int(v) for v in re.search(r"SOLS_INFRANCHISSABLES = new Set\(\[([\d, ]+)\]\)", MODELE_JS).group(1).split(",")}
    assert infranchissables == set(dp.SOLS_INFRANCHISSABLES) == set(habillage.SOLS_INFRANCHISSABLES) == {23, 24}
    assert (sols[23], sols[24], sols[25]) == ("eau-profonde", "falaise", "cultures")
    assert dp.sol_infranchissable(23) and dp.sol_infranchissable(24.0) and not dp.sol_infranchissable(True)
    assert not dp.sol_infranchissable("23") and not dp.sol_infranchissable([23]) and not dp.sol_infranchissable(7)


def test_le_mobilier_des_exterieurs_suit_modele_js():
    for cle in ("palmier", "roseaux", "dune", "fontaine", "tombe"):
        assert cle in dp.MEUBLES and f'cle: "{cle}"' in MODELE_JS
    assert {"roseaux", "dune"} <= dp.FRANCHISSABLES and {"palmier", "fontaine", "tombe"}.isdisjoint(dp.FRANCHISSABLES)


def test_le_plan_concu_par_l_api_connait_les_exterieurs():
    """Le modèle choisit le générateur parmi MODELES_PLAN_IA : tous ceux du navigateur, rien d'autre."""
    dehors = re.findall(r"\{ cle: \"([a-z-]+)\", nom: \"[^\"]+\", aide: \"[^\"]+\", dehors: true \}", DEHORS_JS)
    assert dehors == ["ville", "village", "foret", "montagne", "desert", "marais", "riviere", "cote", "camp", "ruines"]
    assert set(dehors) <= set(contexte_du_modele.MODELES_PLAN_IA)
    assert set(ia_api.SCHEMA_PLAN["properties"]["modele"]["enum"]) == set(contexte_du_modele.MODELES_PLAN_IA)
    assert re.search(rf"export const GENERATEURS_DEHORS = \{{ {', '.join(dehors)} \}};", DEHORS_JS)


def cases_vues(p):
    return {i for i, v in enumerate(p["brouillard"]) if v == 1 and p["sol"][i]}


def test_fuite_un_exterieur_a_demi_revele():
    """La projection d'un village à demi révélé : pas une case, pas un mur, pas une porte, pas un meuble des zones et des
    bâtiments cachés ; ni leurs noms, ni leurs notes ; le piège et le pion cachés restent au MJ."""
    p = {**PLAN, "modifie": "2026-11-10T09:00:00"}
    w, n = p["largeur"], p["largeur"] * p["hauteur"]
    vues = cases_vues(p)
    pub = tv_plans.plan_public(p, "a" * 20)
    texte = json.dumps(pub, ensure_ascii=False)
    # Aucune silhouette : sol, pièce et murs à zéro partout hors des cases vues.
    assert {i for i in range(n) if pub["sol"][i]} == vues
    assert all(not pub["piece"][i] and not pub["murs"][i] for i in range(n) if i not in vues)
    # Les pièces : seulement celles qu'on voit ; un bâtiment caché n'existe pas pour les joueurs.
    ids_vus = {p["piece"][i] for i in vues}
    assert {x["id"] for x in pub["pieces"]} == ids_vus
    salles_cachees = [x for x in p["pieces"] if x["genre"] == "salle" and x["id"] not in ids_vus]
    assert len(salles_cachees) >= 5 and any(x["genre"] == "salle" for x in pub["pieces"])
    for x in p["pieces"]:
        assert x["notes"] not in texte
        if x["nom"].startswith("CACHE-"):
            assert x["nom"] not in texte
    for interdit in ("PIEGE-SECRET", "piege-cache", "COFFRE-SECRET", "coffre-salle", "BRIGAND-CACHE", "t-cache", "Village d'essai"):
        assert interdit not in texte, interdit
    # Chaque meuble envoyé touche une case vue ; chaque porte envoyée borde une case vue.
    def cases(o):
        l, h = (o["h"], o["l"]) if (o.get("rot") or 0) % 180 else (o["l"], o["h"])
        return {y * w + x for y in range(o["y"], o["y"] + h) for x in range(o["x"], o["x"] + l)}
    assert pub["objets"] and all(cases(o) & vues for o in pub["objets"])
    tous = {o["id"]: o for o in p["objets"]}
    assert all(not tous[o["id"]].get("cache") for o in pub["objets"])
    assert len(pub["objets"]) < len([o for o in p["objets"] if not o.get("cache")])
    for d in pub["portes"]:
        bord = {(d["y"]) * w + d["x"] - 1, d["y"] * w + d["x"]} if d["sens"] == "v" else {(d["y"] - 1) * w + d["x"], d["y"] * w + d["x"]}
        assert bord & vues
    assert not pub["pions"]


def test_fuite_un_exterieur_a_la_tv_et_au_coin(client):
    """Par les routes : la TV (et la table du coin, qui lit la même projection) ne reçoit rien de plus."""
    p = client.post("/api/plans", json={k: v for k, v in PLAN.items() if k != "generateur"}).json()
    try:
        pub = client.get(f"/api/table/plan/{J('plans', p['id'])}").json()
        texte = json.dumps(pub, ensure_ascii=False)
        assert {i for i, v in enumerate(pub["sol"]) if v} == cases_vues(PLAN)
        for x in PLAN["pieces"]:
            assert x["notes"] not in texte and not (x["nom"].startswith("CACHE-") and x["nom"] in texte)
        for interdit in ("PIEGE-SECRET", "COFFRE-SECRET", "BRIGAND-CACHE"):
            assert interdit not in texte
    finally:
        client.delete(f"/api/plans/{p['id']}")
