"""L'import d'un plan Universal VTT (js/plan/uvtt.js, importer-uvtt.js) : le fichier se lit dans le navigateur, la
conversion se vérifie sous node (outils/verifier_uvtt.mjs, sur les fichiers de tests/uvtt/). Ici, sans node, les plans
attendus (tests/uvtt-cas.json) sont rejoués côté serveur : les murs que le serveur déduit sont ceux de la page, un pion
ne traverse pas un mur importé et passe une porte ouverte (deplacement.py), le plan s'enregistre sans jamais stocker de
murs, la TV le reçoit, et l'invité reçoit les modules."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
ICI = Path(__file__).resolve().parent
RACINE = ICI.parent
sys.path.insert(0, str(RACINE / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from api import application, tv_plans  # noqa: E402
from commun import deplacement as dp  # noqa: E402
from mj import acces_mj  # noqa: E402

CAS = json.loads((ICI / "uvtt-cas.json").read_text(encoding="utf-8"))["cas"]
JS = RACINE / "app" / "static" / "js"


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def lire(chemin):
    return (JS / chemin).read_text(encoding="utf-8")


@pytest.mark.skipif(shutil.which("node") is None, reason="node absent de l'image des essais")
def test_le_verifieur_passe():
    r = subprocess.run(["node", str(RACINE / "outils" / "verifier_uvtt.mjs")], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_les_fichiers_d_essai_sont_de_vrais_uvtt():
    assert [c["fichier"] for c in CAS] == ["maison.dd2vtt", "biais.uvtt", "sans-murs.json"]
    for c in CAS:
        brut = json.loads((ICI / "uvtt" / c["fichier"]).read_text(encoding="utf-8"))
        assert {"format", "resolution", "line_of_sight", "image"} <= set(brut)
        assert {"map_origin", "map_size", "pixels_per_grid"} <= set(brut["resolution"])
        assert len(brut["image"]) < 2000, "une image minuscule suffit"


@pytest.mark.parametrize("c", CAS, ids=[c["fichier"] for c in CAS])
def test_les_murs_du_serveur_sont_ceux_de_la_page(c):
    """Les murs ne sont pas stockés : murs_du_plan (serveur) et calculerMurs (page) les déduisent du même plan importé."""
    plan = c["plan"]
    assert "murs" not in plan
    assert tv_plans.murs_du_plan(plan) == c["murs"]
    assert len(plan["sol"]) == len(plan["piece"]) == plan["largeur"] * plan["hauteur"]
    assert {pc["genre"] for pc in plan["pieces"]} <= {"salle", "exterieur"}


@pytest.mark.parametrize("c", CAS, ids=[c["fichier"] for c in CAS])
def test_un_pion_ne_traverse_pas_un_mur_importe(c):
    """Les mêmes essais que la page (deplacement.js) : un mur arrête, une porte ouverte se passe, une porte fermée ne
    s'ouvre qu'avec « entrer »."""
    plan = c["plan"]
    public = {**plan, "murs": tv_plans.murs_du_plan(plan), "brouillard_actif": False, "objets": [], "pions": []}
    assert c["essais"]
    for e in c["essais"]:
        vus = dp.atteignables(public, None, tuple(e["de"]), entrer=e["entrer"])
        v = vus.get(tuple(e["vers"]))
        assert (v is not None) == e["atteint"], e["nom"]
        if e["atteint"]:
            assert v[0] == e["distance"], e["nom"]


def test_la_maison_importee_a_ses_pieces_et_ses_portes():
    maison = CAS[0]
    assert maison["bilan"] == {"salles": 2, "exterieurs": 1, "portes": 2, "portes_perdues": 0, "murs": 7, "biais": 0, "perdus": 0,
                               "enfermees": 0, "lumieres": 2}
    portes = [{k: v for k, v in d.items() if k != "id"} for d in maison["plan"]["portes"]]
    assert portes == [{"sens": "v", "x": 4, "y": 2, "genre": "porte", "etat": "ouverte"},
                      {"sens": "h", "x": 3, "y": 5, "genre": "porte", "etat": "fermee"}]
    assert [(pc["nom"], pc["genre"]) for pc in maison["plan"]["pieces"]] == [("Extérieur", "exterieur"), ("Salle 1", "salle"), ("Salle 2", "salle")]


def test_un_plan_importe_s_enregistre_et_part_a_la_tv_sans_murs_stockes(client):
    """Tel que « Nouveau plan » le crée : les grilles, l'image en fond (jamais dessinée par-dessus), le quadrillage éteint.
    Le serveur ne garde pas de murs ; la TV reçoit ceux qu'il déduit, des seules cases révélées."""
    c = CAS[0]
    n = c["plan"]["largeur"] * c["plan"]["hauteur"]
    corps = {
        "nom": "Maison importée", "lieu": "", "etage": "", "m_case": 1.5, "style": "peint", "quadrillage": False, "brouillard_actif": True,
        **c["plan"], "brouillard": [0] * n, "brume": [0] * n, "feu": [0] * n, "etapes": [], "etape": None, "objets": [], "pions": [], "textes": [],
        "notes": "", "generateur": {"modele": "vierge", "graine": 1},
        "fond": {"url": "/media/essai.png", **c["fond"], "opacite": 1, "dessiner": False, "ratio": 0.75},
    }
    cree = client.post("/api/plans", json=corps).json()
    garde = client.get(f"/api/plans/{cree['id']}").json()
    assert "murs" not in garde and garde["fond"]["dessiner"] is False and garde["quadrillage"] is False
    assert garde["generateur"] == {"modele": "vierge", "graine": 1}
    assert len(garde["portes"]) == 2 and len(garde["pieces"]) == 3
    # La salle 1 révélée : la TV en reçoit les murs, et rien de la salle 2.
    garde["brouillard"] = [1 if p == 2 else 0 for p in garde["piece"]]
    assert client.put(f"/api/plans/{cree['id']}", json={**garde, "version_base": garde["modifie"]}).status_code == 200
    public = tv_plans.plan_public(client.get(f"/api/plans/{cree['id']}").json(), "jeton")
    murs = tv_plans.murs_du_plan(garde)
    assert any(murs[i] for i, p in enumerate(garde["piece"]) if p == 2)
    for i, p in enumerate(garde["piece"]):
        if p == 2:
            assert public["murs"][i] == murs[i]
        if p == 3:
            assert not public["sol"][i] and not public["murs"][i]
    # L'image d'essai n'existe pas sur le disque : la TV ne reçoit pas de fond (sinon, noirci hors des cases révélées).
    assert public["fond"] is None
    client.delete(f"/api/plans/{cree['id']}")


def test_l_invite_recoit_les_modules_de_l_import():
    for module in ("js/plan/uvtt.js", "js/plan/importer-uvtt.js"):
        assert module in acces_mj.STATIQUES_INVITE


def test_l_interface_dit_ce_qui_se_perd_et_ou_importer():
    uvtt = lire("plan/uvtt.js")
    assert "murs en biais" in uvtt and "lumières du fichier ne sont pas reprises" in uvtt
    cartes = lire("atelier/cartes.js")
    assert "Importer un plan UVTT" in cartes and "PERTES_UVTT" in cartes and 'value="uvtt"' in cartes
    editeur = lire("plan/editeur.js")
    assert "Importer un plan UVTT" in editeur and "PERTES_UVTT" in editeur and 'data-action="uvtt-importer"' in editeur
    assert 'QUESTION_RETOUCHE("par le plan importé")' in editeur
    # Le générateur d'un plan importé reste un modèle connu, et rien n'écrit de murs dans un plan.
    assert editeur.count('generateur: { modele: "vierge", graine: 1 }') == 1 and 'generateur: { modele: "vierge", graine: 1 }' in cartes
    importer = lire("plan/importer-uvtt.js")
    assert "murs:" not in importer and "dessiner: false" in importer and "quadrillage: false" in importer
    # L'état d'attente et les erreurs claires ; le fichier ne part jamais entier au serveur.
    assert "<progress>" in importer and '"/api/images"' in importer and "/api/plans" not in importer
    for message in ("Fichier illisible", "pas d'image", "Plan trop grand"):
        assert message in uvtt
    # Ni confirm() ni prompt() : le dialogue maison.
    for source in (importer, uvtt):
        assert "confirm(" not in source and "prompt(" not in source
