"""Le mobilier, les sols, les murs et la lumière ajoutés aux plans : les listes partagées par le navigateur et le
serveur, ce que la TV et le coin des joueurs en reçoivent (rien de caché, rien d'autre qu'une couleur ou un mot connu, et
la projection d'un plan d'avant inchangée), et l'habillage par l'API sur un plan meublé de neuf (faux modèle)."""
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

from table import decor_plan  # noqa: E402
from commun import deplacement as dp  # noqa: E402
from ia import habillage  # noqa: E402
import main  # noqa: E402
from api import application, tv_cartes, tv_plans  # noqa: E402
from ia import redaction  # noqa: E402
from faux_modele import FauxClient  # noqa: E402

J = tv_cartes.jeton
MODELE_JS = (ICI.parent / "app" / "static" / "js" / "plan" / "modele.js").read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def bloc(debut, fin):
    return MODELE_JS[MODELE_JS.index(debut):MODELE_JS.index(fin)]


# ---------------------------------------------------------------- listes partagées

def test_les_passages_et_les_listes_du_serveur_suivent_modele_js():
    mobilier = bloc("export const MOBILIER", "export const MEUBLES")
    passages = set(re.findall(r"\{ cle: \"([a-z-]+)\"[^}]*passage: true[^}]*\}", mobilier))
    assert passages == dp.PASSAGES_MEUBLES == {"pont", "ponton", "passerelle", "barque"}
    assert passages <= dp.FRANCHISSABLES
    # L'habillage par l'API connaît le même mobilier : ce qu'on enjambe, et ce qui porte un objet de table.
    assert habillage.FRANCHISSABLES == set(dp.FRANCHISSABLES)
    assert habillage.PORTEURS <= dp.MEUBLES and not habillage.PORTEURS & dp.FRANCHISSABLES
    assert len(dp.MEUBLES) >= 120


def test_murs_lumieres_et_teintes_suivent_modele_js():
    murs = bloc("export const MURS", "export const murValide")
    assert tuple(v for v in re.findall(r"\[\"([a-z]*)\", \"", murs) if v) == decor_plan.MURS
    lumieres = bloc("export const LUMIERES", "export const lumiereValide")
    assert tuple(re.findall(r"\[\"([a-z]+)\", \"", lumieres)) == decor_plan.LUMIERES
    teintes = bloc("export const TEINTES", "export const teinteValide")
    assert all(decor_plan.teinte(c) == c for c in re.findall(r"\"(#[0-9a-f]{6})\"", teintes))
    # Les sols : l'identifiant d'un sol est sa place dans la liste, et ceux d'avant n'ont pas bougé.
    sols = re.findall(r"\{ id: (\d+), cle: \"([a-z-]+)\"", bloc("export const SOLS", "export const SOLS_DEDANS"))
    assert [int(i) for i, _ in sols] == list(range(len(sols))) and len(sols) == 26
    assert [c for _, c in sols[:11]] == ["vide", "pierre", "plancher", "terre", "paves", "herbe", "roche", "eau", "marbre", "paille", "sable"]


# ---------------------------------------------------------------- ce que la TV reçoit

def plan_meuble():
    """10 × 6 : la salle 1 (x 0-4) révélée, la salle 2 (x 5-9) encore cachée."""
    w, h = 10, 6
    return {
        "nom": "Plan meublé d'essai", "largeur": w, "hauteur": h, "m_case": 1.5, "brouillard_actif": True, "style": "peint",
        "sol": [15 if x < 5 else 13 for y in range(h) for x in range(w)], "piece": [1 if x < 5 else 2 for y in range(h) for x in range(w)],
        "brouillard": [1 if x < 5 else 0 for y in range(h) for x in range(w)],
        "pieces": [{"id": 1, "nom": "Salle 1", "genre": "salle", "nom_visible": True, "teinte": "#2C3E66", "mur": "palissade", "notes": ""},
                   {"id": 2, "nom": "SALLE-CACHEE", "genre": "salle", "teinte": "#8e2a20", "mur": "pierre", "notes": "NOTE-CACHEE"}],
        "portes": [], "pions": [], "textes": [], "lumiere": "torches",
        "objets": [
            {"id": "t1", "cle": "tapis-rond", "x": 0, "y": 0, "l": 2, "h": 2, "rot": 0, "teinte": "#B8862E"},
            {"id": "t2", "cle": "tenture", "x": 2, "y": 0, "l": 2, "h": 1, "rot": 0, "teinte": "#123456\"><img src=x onerror=alert(1)>"},
            {"id": "t3", "cle": "banniere", "x": 4, "y": 0, "l": 1, "h": 1, "rot": 0, "teinte": "rgb(1,2,3)"},
            {"id": "f1", "cle": "forge", "x": 0, "y": 3, "l": 2, "h": 2, "rot": 0, "cache": True, "note": "FORGE-SECRETE"},
            {"id": "c1", "cle": "coffre-ouvert", "x": 3, "y": 4, "l": 1, "h": 1, "rot": 0, "cache": True, "teinte": "#00ff00"},
            {"id": "c2", "cle": "cercueil", "x": 7, "y": 1, "l": 1, "h": 2, "rot": 0, "note": "CERCUEIL-DE-LA-SALLE-CACHEE"},
        ],
    }


def test_le_decor_part_a_la_tv_sans_secret(client):
    p = client.post("/api/plans", json=plan_meuble()).json()
    pub = client.get(f"/api/table/plan/{J('plans', p['id'])}").json()
    texte = json.dumps(pub, ensure_ascii=False)
    # Un meuble caché ne part pas, même nouveau, même dans une case révélée ; ni rien de la salle encore cachée.
    for interdit in ("forge", "coffre-ouvert", "FORGE-SECRETE", "#00ff00", "cercueil", "CERCUEIL", "SALLE-CACHEE", "NOTE-CACHEE", "#8e2a20",
                     "pierre", "img", "onerror", "rgb("):
        assert interdit not in texte, interdit
    objets = {o["id"]: o for o in pub["objets"]}
    assert set(objets) == {"t1", "t2", "t3"}
    # Seule une couleur #rrggbb passe, en minuscules ; le reste est ignoré.
    assert objets["t1"]["teinte"] == "#b8862e" and "teinte" not in objets["t2"] and "teinte" not in objets["t3"]
    assert pub["pieces"] == [{"id": 1, "genre": "salle", "nom": "Salle 1", "nom_visible": True, "teinte": "#2c3e66", "mur": "palissade"}]
    assert pub["lumiere"] == "torches"
    # Un mot inconnu ne passe pas.
    q = client.get(f"/api/plans/{p['id']}").json()
    q["lumiere"] = "minuit<script>"
    q["pieces"][0]["mur"] = "beton"
    q["pieces"][0]["teinte"] = "bleu"
    client.put(f"/api/plans/{p['id']}", json=q)
    pub = client.get(f"/api/table/plan/{J('plans', p['id'])}").json()
    assert "lumiere" not in pub and pub["pieces"] == [{"id": 1, "genre": "salle", "nom": "Salle 1", "nom_visible": True}]
    client.delete(f"/api/plans/{p['id']}")


def test_un_plan_d_avant_garde_la_meme_projection():
    """Sans teinte, sans matière, sans lumière : aucune clé de plus, ni sur le plan, ni sur une pièce, ni sur un meuble."""
    assert decor_plan.extras_plan({"lumiere": None}) == {} and decor_plan.extras_plan({}) == {}
    assert decor_plan.extras_piece({"id": 1, "genre": "salle"}) == {} and decor_plan.extras_piece({"mur": ""}) == {}
    assert decor_plan.extras_objet({"cle": "tapis"}) == {} and decor_plan.extras_objet({"teinte": 12}) == {}
    p = plan_meuble()
    del p["lumiere"]
    for x in p["pieces"]:
        x.pop("teinte")
        x.pop("mur")
    for o in p["objets"]:
        o.pop("teinte", None)
    p["modifie"] = "2026-11-09T10:00:00"
    pub = tv_plans.plan_public(p, "a" * 20)
    assert "lumiere" not in pub
    assert all(set(x) == {"id", "genre", "nom", "nom_visible"} for x in pub["pieces"])
    assert all(set(o) == {"id", "cle", "x", "y", "l", "h", "rot"} for o in pub["objets"])


# ---------------------------------------------------------------- l'habillage par l'API (faux modèle)

def test_l_habillage_d_un_plan_meuble_de_neuf(client, monkeypatch):
    p = plan_meuble()
    p["brouillard_actif"] = False
    p["objets"] += [{"id": "b1", "cle": "table-banquet", "x": 1, "y": 3, "l": 3, "h": 2, "rot": 0},
                    {"id": "r1", "cle": "riviere", "x": 5, "y": 3, "l": 2, "h": 3, "rot": 0}]
    p = client.post("/api/plans", json=p).json()
    reponse = {"ambiance": {"interieur": "#4c5278", "exterieur": "#363f62", "force": 0.7}, "lumieres": [], "legende": [], "objets": [
        {"piece": 1, "cle": "chope", "case": [2, 3], "decalage": [0.5, 0.5], "rot": 0},  # sur la table de banquet : gardée
        {"piece": 1, "cle": "sac", "case": [0, 0], "decalage": [0.5, 0.5], "rot": 0},  # sur le tapis rond, qu'on enjambe : gardé
        {"piece": 2, "cle": "seau", "case": [5, 4], "decalage": [0.5, 0.5], "rot": 0},  # dans la rivière : écarté
        {"piece": 1, "cle": "chope", "case": [3, 1], "decalage": [0.5, 0.5], "rot": 0},  # par terre : écartée
    ]}
    faux = FauxClient(json.dumps(reponse))
    monkeypatch.setattr(redaction, "CLIENT", faux)
    r = client.post(f"/api/plans/{p['id']}/habiller", json={"heure": "soir"})
    assert r.status_code == 200
    demande = faux.appels[0]["messages"][0]["content"]
    # Le mobilier visible part au modèle, jamais le caché.
    assert "table-banquet x 1-3, y 3-4" in demande and "riviere x 5-6, y 3-5" in demande and "tapis-rond" in demande
    for interdit in ("forge", "coffre-ouvert", "FORGE-SECRETE"):
        assert interdit not in demande, interdit
    hab = r.json()["habillage"]
    assert [(o["cle"], tuple(o["case"])) for o in hab["objets"]] == [("chope", (2, 3)), ("sac", (0, 0))]
    client.delete(f"/api/plans/{p['id']}")


# ---------------------------------------------------------------- un plan et son jumeau sans secret

def plan_aux_secrets(client, image_cachee: str, image_libre: str, pnj: str) -> tuple[dict, dict]:
    """(plan avec ses secrets, le même sans eux) : 12 × 6, salle 1 (x 0-5) révélée, salle 2 (x 6-11) cachée. Les secrets
    sont tous d'un lot de novembre (H1, H2) : torchère et brasero cachés (ils éclairent en style peint), pont caché sur la
    rivière, image cachée, image et mobilier lumineux de la salle cachée, teinte et matière de ses murs, pion invisible,
    étiquette et image d'un PNJ inconnu, brume et feu sur le caché, lumière d'habillage cachée."""
    w, h = 12, 6
    commun = {
        "largeur": w, "hauteur": h, "m_case": 1.5, "brouillard_actif": True, "style": "peint", "lumiere": "torches",
        "sol": [2 if x < 6 else 1 for y in range(h) for x in range(w)], "piece": [1 if x < 6 else 2 for y in range(h) for x in range(w)],
        "brouillard": [1 if x < 6 else 0 for y in range(h) for x in range(w)], "quadrillage": True,
    }
    visibles = [
        {"id": "riv", "cle": "riviere", "x": 4, "y": 0, "l": 1, "h": 6, "rot": 0},
        {"id": "pont", "cle": "pont", "x": 3, "y": 1, "l": 3, "h": 1, "rot": 0},
        {"id": "torche", "cle": "torchere", "x": 0, "y": 0, "l": 1, "h": 1, "rot": 0},
        {"id": "tapis", "cle": "tapis-long", "x": 0, "y": 2, "l": 3, "h": 1, "rot": 0, "teinte": "#2c3e66"},
    ]
    secrets_objets = [
        {"id": "torche-cachee", "cle": "torchere", "x": 1, "y": 4, "l": 1, "h": 1, "rot": 0, "cache": True, "note": "NOTE-TORCHE"},
        {"id": "brasero-cache", "cle": "brasero", "x": 2, "y": 5, "l": 1, "h": 1, "rot": 0, "cache": True},
        {"id": "pont-cache", "cle": "pont", "x": 3, "y": 4, "l": 3, "h": 1, "rot": 0, "cache": True},
        {"id": "img-cachee", "cle": "image", "image": image_cachee, "x": 0, "y": 3, "l": 2, "h": 1, "cache": True, "nom": "IMAGE-CACHEE"},
        {"id": "img-salle", "cle": "image", "image": image_cachee, "x": 7, "y": 1, "l": 2, "h": 2, "nom": "IMAGE-SALLE"},
        {"id": "cheminee-salle", "cle": "cheminee", "x": 10, "y": 0, "l": 2, "h": 1, "rot": 0},
        {"id": "candelabre-salle", "cle": "candelabre", "x": 9, "y": 4, "l": 1, "h": 1, "rot": 0},
        {"id": "tapis-salle", "cle": "tapis-rond", "x": 7, "y": 3, "l": 2, "h": 2, "rot": 0, "teinte": "#8e2a20"},
    ]
    heros = {"id": "t-heros", "genre": "autre", "nom": "Passeur", "x": 0.5, "y": 1.5}
    pnj_nu = {"id": "t-pnj", "genre": "pnj", "ref": f"pnj:{pnj}", "court": "1", "x": 2.5, "y": 3.5}
    pnj_secret = {**pnj_nu, "nom": "NOM-DU-PNJ", "etiquette": "ETIQUETTE-DU-PNJ", "image_libre": image_libre, "nom_visible": True}
    secrets_pions = [
        {"id": "t-invisible", "genre": "ennemi", "nom": "INVISIBLE", "court": "2", "x": 3.5, "y": 2.5, "etats": ["invisible"]},
        {"id": "t-salle", "genre": "ennemi", "nom": "GARDE-SALLE", "court": "3", "x": 8.5, "y": 2.5, "etiquette": "GARDE"},
    ]
    piece_1 = {"id": 1, "nom": "Rive", "genre": "exterieur", "nom_visible": True}
    piece_2 = {"id": 2, "nom": "SALLE-SECRETE", "genre": "salle", "teinte": "#8e2a20", "mur": "torchis", "notes": "NOTE-SALLE"}
    hab_nu = {"heure": "nuit", "lumieres": [{"id": "l1", "x": 0.5, "y": 0.5, "rayon": 3}], "objets": [], "legende": []}
    hab = {**hab_nu, "lumieres": [*hab_nu["lumieres"], {"id": "l2", "x": 1.5, "y": 1.5, "rayon": 4, "cache": True},
                                  {"id": "l3", "x": 9.5, "y": 2.5, "rayon": 4, "source": "NOTE-LUMIERE"}]}
    avec = {**commun, "nom": "Plan aux secrets", "notes": "NOTE-PLAN", "objets": visibles + secrets_objets,
            "pions": [heros, pnj_secret, *secrets_pions], "pieces": [piece_1, piece_2], "habillage": hab,
            "brume": [2 if x >= 6 else 0 for y in range(h) for x in range(w)],
            "feu": [2 if x >= 6 else 0 for y in range(h) for x in range(w)],
            "portes": [{"id": "d1", "sens": "v", "x": 6, "y": 2, "genre": "secrete"}, {"id": "d2", "sens": "v", "x": 9, "y": 2, "genre": "porte"}],
            "textes": [{"id": "x1", "texte": "TEXTE-MJ", "x": 1, "y": 1, "mj": True}, {"id": "x2", "texte": "TEXTE-SALLE", "x": 8, "y": 1}]}
    sans = {**commun, "nom": "Plan sans secret", "objets": visibles, "pions": [heros, pnj_nu], "pieces": [piece_1, {"id": 2, "genre": "salle"}],
            "habillage": hab_nu, "portes": [], "textes": []}
    return avec, sans


def test_un_plan_et_son_jumeau_sans_secret_partent_a_l_identique(client):
    """Ce que reçoivent la TV, la table publique et le coin (plan_public) : le plan aux secrets et son jumeau sans secret
    donnent la même projection, au champ près. La TV et le coin ne dessinent que d'elle : même image, lumière comprise."""
    pnj = client.post("/api/pnj", json={"nom": "Le Guetteur", "connu": False}).json()
    images = [client.post("/api/bibliotheque-images", files={"image": (f"{n}.png", png_simple(), "image/png")}, data={"nom": n}).json()
              for n in ("cachee", "libre")]
    avec, sans = plan_aux_secrets(client, images[0]["url"], images[1]["url"], pnj["id"])
    sorties = []
    for fiche in (avec, sans):
        p = client.post("/api/plans", json=fiche).json()
        pub = client.get(f"/api/table/plan/{J('plans', p['id'])}").json()
        client.delete(f"/api/plans/{p['id']}")
        sorties.append({k: v for k, v in pub.items() if k not in ("id", "modifie")})
    texte = json.dumps(sorties[0], ensure_ascii=False)
    for interdit in ("NOTE-", "IMAGE-", "SALLE", "INVISIBLE", "GARDE", "NOM-DU-PNJ", "ETIQUETTE", "TEXTE-", "torchis", "#8e2a20",
                     "cachee", "-cache", "candelabre", "cheminee", images[0]["url"], images[1]["url"]):
        assert interdit not in texte, interdit
    assert sorties[0] == sorties[1]
    client.delete(f"/api/pnj/{pnj['id']}")
    for im in images:
        client.delete(f"/api/bibliotheque-images/{im['id']}")


def png_simple() -> bytes:
    import io
    from PIL import Image
    sortie = io.BytesIO()
    Image.new("RGB", (16, 16), (90, 30, 30)).save(sortie, "PNG")
    return sortie.getvalue()
