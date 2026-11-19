"""Les pions en figurines (js/plan/figurine.js) : ce que la TV en reçoit de plus. Le pion d'un héros porte un jeton à
part (« heros »), le même que son entrée dans l'ordre du combat, pour que sa figurine luise à son tour ; ce jeton n'ouvre
aucune fiche. Le pion d'un familier se dit familier et nomme le pion de son héros (« maitre »), seulement si ce héros est
montré. Le dessin se vérifie sous node (outils/verifier_figurines.mjs) ; ici aussi, ce que la TV (Chromium 79) n'a pas."""

import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import joueurs  # noqa: E402
import main  # noqa: E402
from api import application, tv_cartes, tv_plans  # noqa: E402
from mj import acces_mj  # noqa: E402

J = tv_cartes.jeton
RACINE = Path(__file__).resolve().parent.parent
JS = RACINE / "app" / "static" / "js"
W, H = 8, 4


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture()
def monde(client):
    a = client.post("/api/aventuriers", json={"nom": "Tavarède Lavelle", "couleur": "#ae00ff", "sante": 7, "tablee": True}).json()
    b = client.post("/api/aventuriers", json={"nom": "Velora Dorvan", "couleur": "#2f7de1", "sante": 8, "tablee": True}).json()
    pions = [
        {"id": "t-a", "genre": "heros", "nom": "Tavarède Lavelle", "ref": f"aventurier:{a['id']}", "x": 0.5, "y": 0.5},
        {"id": "f-a", "genre": "autre", "nom": "Brindille", "ref": f"familier:{a['id']}", "x": 1.5, "y": 0.5},
        # Le héros caché : son familier montré ne le trahit pas.
        {"id": "t-b", "genre": "heros", "nom": "Velora Dorvan", "ref": f"aventurier:{b['id']}", "x": 4.5, "y": 0.5, "cache": True},
        {"id": "f-b", "genre": "autre", "nom": "Escarbille", "ref": f"familier:{b['id']}", "x": 5.5, "y": 0.5},
        {"id": "e-1", "genre": "ennemi", "nom": "Brigand", "court": "1", "x": 2.5, "y": 2.5},
    ]
    plan = client.post("/api/plans", json={"nom": "Figurines", "largeur": W, "hauteur": H, "brouillard_actif": False,
                                           "sol": [2] * (W * H), "piece": [1] * (W * H), "pions": pions}).json()
    s = client.post("/api/seances", json={"nom": "Séance des figurines", "numero": 9, "date": "2026-11-19"}).json()
    yield {"a": a, "b": b, "plan": plan, "seance": s}
    client.put(f"/api/seances/{s['id']}/combat/tv", json={"montrer": False})
    client.delete(f"/api/seances/{s['id']}/combat")
    client.put("/api/table", json={"vue": "accueil"})
    for collection, ident in (("seances", s["id"]), ("plans", plan["id"]), ("aventuriers", a["id"]), ("aventuriers", b["id"])):
        client.delete(f"/api/{collection}/{ident}")


def pions_tv(client, plan) -> dict:
    assert client.put("/api/table", json={"vue": "plan", "plan": plan["id"], "style": "couleur"}).status_code == 200
    r = client.get(f"/api/table/plan/{J('plans', plan['id'])}")
    assert r.status_code == 200, r.text
    return {t["id"]: t for t in r.json()["pions"]}


def test_le_heros_porte_son_jeton_et_le_familier_son_maitre(client, monde):
    a, b = monde["a"], monde["b"]
    pions = pions_tv(client, monde["plan"])
    assert pions["t-a"]["heros"] == tv_plans.jeton_heros(a["id"]) == J("heros-pion", a["id"])
    # Un jeton opaque, qui ne dit pas l'identifiant de la fiche et n'en ouvre aucune.
    assert re.fullmatch(r"[a-f0-9]{20}", pions["t-a"]["heros"]) and a["id"] not in pions["t-a"]["heros"]
    assert client.get(f"/api/table/aventurier/{pions['t-a']['heros']}").status_code == 404
    assert client.get(f"/api/table/aventurier/{J('aventuriers', a['id'])}").status_code == 200
    # Le familier se dit familier, relié au pion de son héros ; celui du héros caché, sans maître.
    assert pions["f-a"]["familier"] is True and pions["f-a"]["maitre"] == "t-a"
    assert "t-b" not in pions and pions["f-b"]["familier"] is True and "maitre" not in pions["f-b"]
    # Ni un ennemi ni un familier ne portent de jeton de héros ; aucune référence ne sort.
    assert "heros" not in pions["e-1"] and "heros" not in pions["f-a"] and "familier" not in pions["e-1"]
    assert not any("ref" in t for t in pions.values())


def test_l_ordre_du_combat_nomme_le_meme_jeton(client, monde):
    a, b = monde["a"], monde["b"]
    url = f"/api/seances/{monde['seance']['id']}/combat"
    combat = {"id": "c1", "nom": "Combat", "tour": 1, "actif": 0, "strat": False,
              "ordre": [f"aventurier:{a['id']}", "ennemis", f"aventurier:{b['id']}"],
              "heros": [{"id": a["id"], "nom": "Tavarède", "max": 7, "sante": 7}, {"id": b["id"], "nom": "Velora", "max": 8, "sante": 8}],
              "adversaires": [{"id": "x1", "nom": "Brigand", "numero": "1", "sante": 5, "max": 5}], "version_base": None}
    assert client.put(url, json=combat).status_code == 200
    assert client.put(f"{url}/tv", json={"montrer": True}).status_code == 200
    pions = pions_tv(client, monde["plan"])
    c = client.get(f"/api/table/combat/{J('seances', monde['seance']['id'])}").json()
    assert c["ordre"][c["actif"]]["heros"] == pions["t-a"]["heros"]
    assert c["ordre"][2]["heros"] == J("heros-pion", b["id"]) and "heros" not in c["ordre"][1]


@pytest.mark.skipif(shutil.which("node") is None, reason="node absent de l'image des essais")
def test_le_verifieur_passe():
    r = subprocess.run(["node", str(RACINE / "outils" / "verifier_figurines.mjs")], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_le_dessin_reste_lisible_par_la_tv_et_sert_partout():
    # Chromium 79 (la TV) : ni roundRect, ni at(), qu'esbuild ne transpile pas.
    for chemin in ("plan/figurine.js", "plan/trace.js", "plan/rendu.js", "plan/vue.js", "table/carte-plan.js", "table/combat.js"):
        source = (JS / chemin).read_text(encoding="utf-8")
        assert "roundRect(" not in source and not re.search(r"\.at\(-?\d", source), chemin
    # Le module des figurines sort au coin et chez le MJ invité ; plan/rendu.js et la page de la table du coin l'importent.
    for module in ("js/plan/figurine.js", "js/plan/trace.js"):
        assert module in joueurs.FICHIERS and module in acces_mj.STATIQUES_INVITE, module
    assert 'from "./figurine.js"' in (JS / "plan/rendu.js").read_text(encoding="utf-8")
    assert 'from "../plan/figurine.js"' in (JS / "joueurs/table-coin.js").read_text(encoding="utf-8")
    # Une figurine se prend par la tête comme par le socle, dans l'éditeur et à la table du coin.
    assert "if (dansFigurine(t, x, y)) return { genre: \"pion\", id: t.id };" in (JS / "plan/editeur.js").read_text(encoding="utf-8")
    assert "mes.find((p) => dansFigurine(p, x, y))" in (JS / "joueurs/bouger.js").read_text(encoding="utf-8")
    # Rien ne bouge pour qui demande moins de mouvement, ni dans une image exportée.
    vue = (JS / "plan/vue.js").read_text(encoding="utf-8")
    assert "prefers-reduced-motion: reduce" in vue and "const animations = this.sansJauges ? null : this.animations(pions, jauges, calme);" in vue
