"""L'habillage des cartes détaillées et des plans par l'API : la demande, le contrôle de la réponse (bornes, eau, murs,
polygones, nombres, clés, lieux secrets, nom caché de l'auberge) et ce que la TV en reçoit. Le modèle est un faux client."""
import base64
import json
import math
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from ia import habillage  # noqa: E402
import main  # noqa: E402
from api import application, config, tv_cartes, tv_plans, utilitaires  # noqa: E402
from ia import redaction  # noqa: E402
from faux_modele import FauxClient  # noqa: E402

J = tv_cartes.jeton


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def terrain_essai():
    """40 × 30 cases de plaine, un lac en haut à droite, des montagnes en bas à gauche."""
    t = bytearray([1] * 40 * 30)
    for y in range(30):
        for x in range(40):
            if x >= 30 and y < 10:
                t[y * 40 + x] = 0
            elif x < 6 and y >= 25:
                t[y * 40 + x] = 10
    return bytes(t)


@pytest.fixture
def tarvan(client):
    """Une carte détaillée (250 m par case) : un ruisseau à x = 20, une route à y = 15, un moulin connu, une ruine inconnue."""
    moulin = client.post("/api/lieux", json={"nom": "Le moulin d'essai", "type": "point", "connu": True,
                                             "resume": "Au gué d'un ruisseau. La roue est arrêtée.", "secrets": "SECRET-DU-MOULIN"}).json()
    ruine = client.post("/api/lieux", json={"nom": "La ruine d'essai", "type": "ruine", "connu": False,
                                            "resume": "Une grange noircie.", "secrets": "SECRET-DE-LA-RUINE"}).json()
    carte = client.post("/api/cartes", json={
        "nom": "Route d'essai", "largeur": 40, "hauteur": 30, "km_case": 0.25, "terrain": base64.b64encode(terrain_essai()).decode(),
        "brouillard": base64.b64encode(bytes(1200)).decode(), "brouillard_actif": False,
        "traces": [{"id": "r", "type": "riviere", "largeur": [0.3, 0.3], "points": [[20, 0], [20, 10], [20, 20], [20, 30]]},
                   {"id": "v", "type": "route", "points": [[0, 15], [10, 15], [20, 15], [30, 15], [40, 15]]}],
        "marqueurs": [{"id": "m1", "lieu": moulin["id"], "x": 21.5, "y": 12, "taille": 1},
                      {"id": "m2", "lieu": ruine["id"], "x": 8, "y": 6, "taille": 1}],
    }).json()
    yield carte, moulin, ruine
    client.delete(f"/api/cartes/{carte['id']}")
    client.delete(f"/api/lieux/{moulin['id']}")
    client.delete(f"/api/lieux/{ruine['id']}")


REPONSE_CARTE = {
    "taille_parcelle_m": 5000,
    "champs": [
        {"lieu": "L1", "zone": [[22, 16], [30, 16], [30, 24], [22, 24]], "orientation": 135, "cultures": ["blé", "Blés", "froment", "maïs", "jachere"],
         "haies": 3, "raison": "Les terres du moulin — on en parle à la Petite Fanfrelée."},
        {"lieu": "", "zone": [[31, 1], [38, 1], [38, 8], [31, 8]], "orientation": 0, "cultures": ["blé"], "haies": 0.2, "raison": ""},
        {"lieu": "", "zone": [[60, 60], [70, 60], [70, 70]], "orientation": 0, "cultures": ["blé"], "haies": 0.2, "raison": ""},
        {"lieu": "", "zone": [[2, 16], [10, 24], [10, 16], [2, 24]], "orientation": 0, "cultures": ["pré"], "haies": 0.2, "raison": ""},
        {"lieu": "L2", "zone": [[6, 8], [12, 8], [12, 12], [6, 12]], "orientation": 0, "cultures": ["jachère"], "haies": 0.6, "raison": ""},
        {"lieu": "", "zone": [[0, 0], [39, 0], [39, 29], [0, 29]], "orientation": 0, "cultures": ["blé"], "haies": 0, "raison": ""},
        {"lieu": "", "zone": [[1, 20], [1.4, 20], [1.2, 20.3]], "orientation": 0, "cultures": ["blé"], "haies": 0, "raison": ""},
        {"lieu": "", "zone": "partout", "orientation": "nord", "cultures": "blé", "haies": None, "raison": 3},
    ],
    "vergers": [{"lieu": "Le moulin d'essai", "zone": [[23, 9], [26, 9], [26, 11], [23, 11]], "orientation": 10, "essence": "pommiers", "raison": "Clos."}],
    "haies": [{"points": [[12, 14], [28, 14]], "raison": "Le long de la route."}, {"points": [[1, 1]], "raison": ""}],
    "hameaux": [{"nom": "", "lieu": "", "raison": "Quelques fermes.", "fermes": [
        {"x": 14, "y": 15.2, "angle": 400, "batiments": ["logis", "château"]},
        {"x": 34, "y": 4, "angle": 0, "batiments": ["logis"]},
        {"x": 14.5, "y": 17.5, "angle": 0, "batiments": ["grange"]},
        {"x": 26, "y": 20, "angle": -30, "batiments": ["logis", "etable"]}]}],
    "chemins": [{"lieu": "", "genre": "autoroute", "points": [[14, 18], [26, 18]], "raison": "Vers les champs."},
                {"lieu": "", "genre": "sentier", "points": [[8, 7.5], [12, 13]], "raison": "Vers la grange."}],
    "ponts": [{"x": 5, "y": 5, "longueur": 2, "genre": "planches", "raison": "Loin de tout."}],
    "gues": [{"x": 20.8, "y": 15.3, "raison": "Fiche : au gué."}],
    "batiments": [
        {"lieu": "L1", "genre": "moulin", "x": 21.0, "y": 11.0, "angle": 0, "roue": "arretee", "raison": "Fiche : la roue est arrêtée."},
        {"lieu": "L2", "genre": "ferme_brulee", "x": 8.5, "y": 6.5, "angle": 0, "roue": "", "raison": "Grange noircie."},
        {"lieu": "", "genre": "dragon", "x": 10, "y": 10, "angle": 0, "roue": "", "raison": ""},
        {"lieu": "", "genre": "moulin", "x": float("nan"), "y": 4, "angle": 0, "roue": "", "raison": ""},
    ],
}


def test_carte_habillee_et_controlee(client, tarvan, monkeypatch):
    carte, moulin, ruine = tarvan
    faux = FauxClient(json.dumps(REPONSE_CARTE, allow_nan=True))
    monkeypatch.setattr(redaction, "CLIENT", faux)
    r = client.post(f"/api/cartes/{carte['id']}/habiller", json={"idee": "Un hameau sur la route.", "image": "data:image/png;base64,iVBORw0KGgo="})
    assert r.status_code == 200
    hab, remarques = r.json()["habillage"], r.json()["remarques"]

    # Ce qui part au modèle : la grille avec la rivière, la route et les lieux ; les fiches visibles, jamais les secrets.
    contenu = faux.appels[0]["messages"][0]["content"]
    demande = contenu[1]["text"]
    assert contenu[0]["type"] == "image" and faux.appels[0]["output_config"]["effort"] == "medium" and faux.appels[0]["max_tokens"] == 32000
    assert "%" in demande and "=" in demande and "@" in demande and "~~~~" in demande
    assert "L1 « Le moulin d'essai »" in demande and "La roue est arrêtée" in demande and "INCONNU des joueurs" in demande
    assert "SECRET-" not in demande and "Un hameau sur la route." in demande and '"batiments"' in contenu[-1]["text"]

    # Identifiants attribués par le serveur, uniques.
    ids = [e["id"] for cle in ("champs", "vergers", "haies", "hameaux", "chemins", "ponts", "gues", "batiments") for e in hab[cle]]
    assert ids == [f"h{i}" for i in range(1, len(ids) + 1)]
    assert hab["taille_parcelle_m"] == 800 and hab["zone"] == {"x0": 0, "y0": 0, "x1": 40, "y1": 30}

    # Champs : celui du moulin reste (cultures connues seulement, nombres bornés, nom caché masqué) ; le lac, le dehors,
    # le démesuré, le minuscule et l'illisible sont écartés ; celui de la ruine inconnue est caché.
    t = habillage.Terrain(utilitaires.lire_fiche(config.CARTES / f"{carte['id']}.json"), terrain_essai(), {moulin["id"]: moulin, ruine["id"]: ruine})
    champ = hab["champs"][0]
    assert champ["lieu"] == moulin["id"] and champ["cultures"] == ["blé", "blé", "blé", "jachère"] and champ["haies"] == 1
    assert champ["orientation"] == -45 and "cache" not in champ
    assert champ["raison"] == "Les terres du moulin, on en parle à l'auberge."
    for c in hab["champs"]:
        assert habillage.polygone_simple(c["zone"]) and all(0 <= x <= 40 and 0 <= y <= 30 for x, y in c["zone"])
        assert not any(t.lac(x, y) for x, y in c["zone"])
    assert [c.get("cache") for c in hab["champs"] if c.get("lieu") == ruine["id"]] == [True]
    assert len(hab["champs"]) <= 3
    assert hab["vergers"][0]["lieu"] == moulin["id"]

    # La haie qui passe le ruisseau est coupée en deux ; aucun point sur l'eau ni sur la route.
    assert len(hab["haies"]) == 2
    for h in hab["haies"]:
        assert all(abs(x - 20) > 0.3 and abs(y - 15) >= 0.45 for x, y in h["points"])

    # Fermes : poussée hors de la route, celle du lac et celle collée à une autre écartées, bâtiments connus seulement.
    fermes = hab["hameaux"][0]["fermes"]
    assert len(fermes) == 2 and hab["hameaux"][0]["nom"] is None
    assert fermes[0]["y"] >= 16.99 and fermes[0]["batiments"] == ["logis"] and fermes[0]["angle"] == 40
    assert all(not t.sur_eau(f["x"], f["y"], 0.5) for f in fermes)

    # Le gué se cale là où la route passe le ruisseau ; le pont loin de l'eau est écarté ; le sentier qui passe le
    # ruisseau reçoit sa passerelle ; le sentier qui frôle la ruine est caché.
    assert [(g["x"], g["y"]) for g in hab["gues"]] == [(20.0, 15.0)]
    assert [(p["x"], p["y"], p["genre"]) for p in hab["ponts"]] == [(20.0, 18.0, "planches")]
    assert abs(math.cos(math.radians(hab["ponts"][0]["angle"]))) > 0.99 and hab["ponts"][0]["longueur"] >= 1.2
    chemins = {tuple(c["points"][0]): c for c in hab["chemins"]}
    assert chemins[(14.0, 18.0)]["genre"] == "sentier" and "cache" not in chemins[(14.0, 18.0)]
    assert chemins[(8.0, 7.5)]["cache"] is True

    # Bâtiments : le moulin garde sa roue arrêtée, tourné vers l'eau ; la ruine inconnue est cachée ; le reste écarté.
    batiments = {b["genre"]: b for b in hab["batiments"]}
    assert set(batiments) == {"moulin", "ferme_brulee"}
    assert batiments["moulin"]["roue"] == "arrêtée" and batiments["moulin"]["angle"] == -90 and "cache" not in batiments["moulin"]
    assert batiments["ferme_brulee"]["cache"] is True and "roue" not in batiments["ferme_brulee"]
    assert any("écarté" in r for r in remarques) and any("retouché" in r for r in remarques)

    # Rien n'est enregistré.
    assert "habillage" not in client.get(f"/api/cartes/{carte['id']}").json()


def test_reponse_absurde_ou_illisible(client, tarvan, monkeypatch):
    carte, _, _ = tarvan
    absurde = {"taille_parcelle_m": "énorme", "champs": "beaucoup", "vergers": [None, 3, {"zone": [[1, 1]]}], "haies": [1, 2, 3],
               "hameaux": [{"fermes": "oui"}], "chemins": [{"points": [["a", "b"], [1]]}], "ponts": [{"x": "nan", "y": 2}],
               "gues": [{"x": 1e308, "y": -1e308}], "batiments": [{"genre": "moulin", "x": 1e308, "y": -5}]}
    monkeypatch.setattr(redaction, "CLIENT", FauxClient(json.dumps(absurde)))
    hab = client.post(f"/api/cartes/{carte['id']}/habiller", json={}).json()["habillage"]
    assert hab["taille_parcelle_m"] == 420
    assert all(hab[k] == [] for k in ("champs", "vergers", "haies", "hameaux", "chemins", "ponts", "gues", "batiments"))
    monkeypatch.setattr(redaction, "CLIENT", FauxClient("Voici des champs.", "Toujours pas de JSON."))
    r = client.post(f"/api/cartes/{carte['id']}/habiller", json={})
    assert r.status_code == 503 and "illisible" in r.json()["detail"]
    assert client.post(f"/api/cartes/{carte['id']}/habiller", json={"zone": {"x0": 0, "y0": 0, "x1": 2, "y1": 2}}).status_code == 400


def test_carte_trop_vaste_ou_sans_cle(client, tarvan, monkeypatch):
    faux = FauxClient("{}")
    monkeypatch.setattr(redaction, "CLIENT", faux)
    vaste = client.post("/api/cartes", json={"nom": "Pays d'essai", "largeur": 10, "hauteur": 8, "km_case": 2,
                                             "terrain": base64.b64encode(bytes([1] * 80)).decode()}).json()
    r = client.post(f"/api/cartes/{vaste['id']}/habiller", json={})
    assert r.status_code == 400 and "trop vaste" in r.json()["detail"] and "1 km par case" in r.json()["detail"]
    assert faux.appels == []
    client.delete(f"/api/cartes/{vaste['id']}")
    monkeypatch.setattr(redaction, "CLIENT", None)
    assert client.post(f"/api/cartes/{tarvan[0]['id']}/habiller", json={}).status_code == 503


def test_la_tv_ne_voit_que_l_habillage_public(client, tarvan, monkeypatch):
    carte, moulin, ruine = tarvan
    monkeypatch.setattr(redaction, "CLIENT", FauxClient(json.dumps(REPONSE_CARTE, allow_nan=True)))
    hab = client.post(f"/api/cartes/{carte['id']}/habiller", json={}).json()["habillage"]
    hab["hameaux"][0]["nom"] = "Les fermes de la Petite Fanfrelée"
    # Le brouillard ne laisse voir que le haut de la carte (y < 18) : la passerelle (y 18) et la ferme du bas restent cachées.
    fiche = client.get(f"/api/cartes/{carte['id']}").json()
    brume = bytes([1 if y < 18 else 0 for y in range(30) for _ in range(40)])
    fiche |= {"habillage": hab, "brouillard_actif": True, "brouillard": base64.b64encode(brume).decode(), "version_base": fiche["modifie"]}
    assert client.put(f"/api/cartes/{carte['id']}", json=fiche).status_code == 200
    public = client.get(f"/api/table/carte/{J('cartes', carte['id'])}")
    pub = public.json()["habillage"]
    for interdit in ("raison", "cache", "lieu", ruine["id"], moulin["id"], "Petite Fanfrel", "ferme_brulee", "Grange noircie"):
        assert interdit not in json.dumps(pub, ensure_ascii=False), interdit
    assert pub["hameaux"][0]["nom"] == "Les fermes de l'auberge"
    assert [(f["x"], f["y"]) for f in pub["hameaux"][0]["fermes"]] == [(f["x"], f["y"]) for f in hab["hameaux"][0]["fermes"] if f["y"] < 18]
    assert pub["ponts"] == [] and [(g["x"], g["y"]) for g in pub["gues"]] == [(20.0, 15.0)]
    assert [b["genre"] for b in pub["batiments"]] == ["moulin"] and pub["batiments"][0]["roue"] == "arrêtée"
    # Les surfaces et les lignes ne suivent pas le brouillard (la TV le peint par-dessus), mais rien de la ruine inconnue.
    assert len(pub["champs"]) == len([c for c in hab["champs"] if not c.get("cache")]) and len(pub["haies"]) == 2
    assert len(pub["chemins"]) == 1

    # La version publique change avec l'habillage visible, pas avec un élément caché.
    connus = tv_cartes.lieux_connus()
    lue = utilitaires.lire_fiche(config.CARTES / f"{carte['id']}.json")
    avant = tv_cartes.version_carte(lue, connus)
    cache = json.loads(json.dumps(lue))
    cache["habillage"]["batiments"][1]["angle"] = 33
    assert tv_cartes.version_carte(cache, connus) == avant
    visible = json.loads(json.dumps(lue))
    visible["habillage"]["gues"] = []
    assert tv_cartes.version_carte(visible, connus) != avant
    # La ruine découverte : son habillage reste caché tant que le MJ ne l'a pas montré (cache posé d'office).
    client.patch(f"/api/lieux/{ruine['id']}", json={"connu": True})
    pub = client.get(f"/api/table/carte/{J('cartes', carte['id'])}").json()["habillage"]
    assert [b["genre"] for b in pub["batiments"]] == ["moulin"]
    # Des données abîmées n'empêchent pas la TV de montrer la carte.
    fiche = client.get(f"/api/cartes/{carte['id']}").json()
    fiche |= {"habillage": {"champs": [{"zone": None}, "x", {"zone": [[1, 1], [2, 2], ["a", 3]]}], "ponts": [{"x": 1}], "hameaux": "non"},
              "version_base": fiche["modifie"]}
    client.put(f"/api/cartes/{carte['id']}", json=fiche)
    assert client.get(f"/api/table/carte/{J('cartes', carte['id'])}").json()["habillage"]["champs"] == []


# ---------------------------------------------------------------- plans

def plan_essai():
    """10 × 8 : deux salles (x 0-4 et 5-9, y 0-5) et la route dessous (y 6-7)."""
    w, h = 10, 8
    sol = [2 if y < 6 else 3 for y in range(h) for x in range(w)]
    piece = [(1 if x < 5 else 2) if y < 6 else 3 for y in range(h) for x in range(w)]
    brume = [1 if (x < 5 or y >= 6) else 0 for y in range(h) for x in range(w)]
    return {
        "nom": "Auberge d'essai", "largeur": w, "hauteur": h, "m_case": 1.5, "brouillard_actif": True, "sol": sol, "piece": piece, "brouillard": brume,
        "pieces": [{"id": 1, "nom": "Salle 1", "genre": "salle", "notes": "", "nom_visible": True},
                   {"id": 2, "nom": "Salle 2", "genre": "salle", "notes": "NOTE-SALLE-SECRETE", "nom_visible": True},
                   {"id": 3, "nom": "La route", "genre": "exterieur", "notes": "", "nom_visible": False}],
        "portes": [{"id": "p1", "sens": "v", "x": 5, "y": 3, "genre": "porte", "etat": "fermee"},
                   {"id": "p2", "sens": "h", "x": 2, "y": 6, "genre": "double", "etat": "ouverte"},
                   {"id": "p3", "sens": "v", "x": 5, "y": 1, "genre": "secrete", "etat": "fermee"}],
        "objets": [{"id": "m1", "cle": "table", "x": 1, "y": 2, "l": 2, "h": 1, "rot": 0},
                   {"id": "m2", "cle": "tonneau", "x": 7, "y": 1, "l": 1, "h": 1, "rot": 0},
                   {"id": "m3", "cle": "tresor", "x": 8, "y": 4, "l": 1, "h": 1, "rot": 0, "cache": True, "note": "TRESOR-SECRET"}],
        "pions": [], "textes": [],
    }


REPONSE_PLAN = {
    "ambiance": {"interieur": "bleu", "exterieur": "#363f62", "force": 0.1},
    "lumieres": [
        {"x": 1.5, "y": 2.5, "rayon": 2.4, "couleur": "#ffd08a", "intensite": 5, "source": "chandelle — de la Petite Fanfrelée"},
        {"x": 50, "y": 50, "rayon": 2, "couleur": "#ffd08a", "intensite": 1, "source": ""},
        {"x": 7.5, "y": 2.5, "rayon": 30, "couleur": "orange", "intensite": 0.5, "source": "lanterne"},
        {"x": 1.6, "y": 2.6, "rayon": 2, "couleur": "#ffd08a", "intensite": 1, "source": "doublon"},
        {"x": 0.02, "y": 0.5, "rayon": 2, "couleur": "#ffd08a", "intensite": 1, "source": "contre le mur"},
    ],
    "objets": [
        {"piece": 1, "cle": "chope", "case": [1, 2], "decalage": [0.3, 0.4], "rot": 400},
        {"piece": 1, "cle": "Chope", "case": [3, 4], "decalage": [0.5, 0.5], "rot": 0},
        {"piece": 1, "cle": "dragon", "case": [3, 3], "decalage": [0.5, 0.5], "rot": 0},
        {"piece": 1, "cle": "seau", "case": [0, 0], "decalage": [0, 0], "rot": 0},
        {"piece": 1, "cle": "table-ronde", "case": [4, 3], "decalage": [0.5, 0.5], "rot": 0},
        {"piece": 1, "cle": "table-ronde", "case": [3, 1], "decalage": [0.1, 0.9], "rot": 0},
        {"piece": 1, "cle": "bougie", "case": [3, 1], "decalage": [0.5, 0.5], "rot": 0},
        {"piece": 1, "cle": "toile", "case": [0, 5], "decalage": [0.1, 0.9], "rot": 0},
        {"piece": 1, "cle": "toile", "case": [2, 3], "decalage": [0.5, 0.5], "rot": 0},
        {"piece": 2, "cle": "sac", "case": [7, 1], "decalage": [0.5, 0.5], "rot": 0},
        {"piece": 2, "cle": "sac", "case": [6, 4], "decalage": [0.5, 0.5], "rot": 0},
        {"piece": 9, "cle": "seau", "case": [99, 2], "decalage": [0.5, 0.5], "rot": 0},
        {"piece": 3, "cle": "ornieres", "case": [0, 6], "decalage": [0, 0], "rot": 0},
        {"piece": 3, "cle": "ornieres", "case": [5, 7], "decalage": [0, 0], "rot": 0},
        {"piece": 1, "cle": "ornieres", "case": [1, 1], "decalage": [0, 0], "rot": 0},
    ],
    "legende": [
        {"piece": 1, "texte": "Grande salle de la Petite Fanfrelée", "x": 2.5, "y": 2.5},
        {"piece": "Salle 2", "texte": "", "x": 0.5, "y": 0.5},
        {"piece": 3, "texte": "La route", "x": 5, "y": 7},
        {"piece": 1, "texte": "Doublon", "x": 1, "y": 1},
    ],
}


def test_plan_habille_et_controle(client, monkeypatch):
    p = client.post("/api/plans", json=plan_essai()).json()
    faux = FauxClient(json.dumps(REPONSE_PLAN))
    monkeypatch.setattr(redaction, "CLIENT", faux)
    r = client.post(f"/api/plans/{p['id']}/habiller", json={"heure": "soir", "idee": "Une soirée calme."})
    assert r.status_code == 200
    hab = r.json()["habillage"]
    demande = faux.appels[0]["messages"][0]["content"]
    # Ce qui part au modèle : la grille, les pièces, le mobilier visible, les portes connues ; ni trésor, ni note, ni porte secrète.
    for interdit in ("TRESOR-SECRET", "NOTE-SALLE-SECRETE", "tresor", "(4,1) et (5,1)"):
        assert interdit not in demande, interdit
    assert "  0 AaaAA" not in demande and "  2 AaaAAB" in demande and "porte entre (4,3) et (5,3)" in demande and "toile :" in demande

    assert hab["heure"] == "soir" and hab["ambiance"] == {"interieur": "#4c5278", "exterieur": "#363f62", "force": 0.5}
    objets = [(o["cle"], tuple(o["case"]), tuple(o["decalage"]), o["rot"], o["piece"]) for o in hab["objets"]]
    assert objets == [
        ("table-ronde", (3, 1), (0.5, 0.5), 0, 1),
        ("chope", (1, 2), (0.3, 0.4), 40, 1),
        ("seau", (0, 0), (0.25, 0.25), 0, 1),
        ("chandelle", (3, 1), (0.5, 0.5), 0, 1),
        ("toile", (0, 5), (0.0, 1.0), 270, 1),
        ("sac", (6, 4), (0.5, 0.5), 0, 2),
        ("ornieres", (0, 6), (0.5, 0.5), 0, 3),
    ]
    assert [o["id"] for o in hab["objets"]] == [f"o{i}" for i in range(1, 8)]
    lumieres = hab["lumieres"]
    assert [l["id"] for l in lumieres] == ["l1", "l2", "l3"]
    assert lumieres[0]["intensite"] == 1 and lumieres[0]["source"] == "chandelle, de l'auberge"
    assert lumieres[1]["rayon"] == 8 and lumieres[1]["couleur"] == "#ffb15e" and lumieres[1]["piece"] == 2
    assert lumieres[2]["x"] == 0.2
    # Le texte d'une étiquette est le nom de la pièce écrit par le MJ : le modèle ne choisit que la place.
    assert [(e["piece"], e["texte"]) for e in hab["legende"]] == [(1, "Salle 1"), (2, "Salle 2"), (3, "La route")]
    assert "texte" not in json.dumps(habillage.SCHEMA_PLAN["properties"]["legende"]) and "tu ne choisis que la place" in demande
    assert all(habillage.Plan(p, tv_plans.murs_du_plan(p)).piece_en(int(e["x"]), int(e["y"])) == e["piece"] for e in hab["legende"])
    assert any("écarté" in x for x in r.json()["remarques"])
    assert "habillage" not in client.get(f"/api/plans/{p['id']}").json()

    # Réponse absurde : rien ne casse, l'ambiance prend celle de l'heure.
    monkeypatch.setattr(redaction, "CLIENT", FauxClient(json.dumps({"objets": "plein", "lumieres": [None, 3, {"x": "a"}], "legende": {}, "ambiance": []})))
    hab = client.post(f"/api/plans/{p['id']}/habiller", json={"heure": "minuit"}).json()["habillage"]
    assert hab["heure"] == "soir" and hab["objets"] == [] and hab["lumieres"] == [] and hab["ambiance"]["force"] == 0.78
    vide = client.post("/api/plans", json={"nom": "Vide", "largeur": 3, "hauteur": 2, "sol": [0] * 6, "piece": [0] * 6}).json()
    assert client.post(f"/api/plans/{vide['id']}/habiller", json={}).status_code == 400
    client.delete(f"/api/plans/{vide['id']}")
    client.delete(f"/api/plans/{p['id']}")


def test_la_tv_ne_voit_du_plan_que_les_cases_revelees(client, monkeypatch):
    p = client.post("/api/plans", json=plan_essai()).json()
    monkeypatch.setattr(redaction, "CLIENT", FauxClient(json.dumps(REPONSE_PLAN)))
    hab = client.post(f"/api/plans/{p['id']}/habiller", json={"heure": "nuit"}).json()["habillage"]
    assert hab["ambiance"]["force"] == 0.7
    p["habillage"] = hab
    client.put(f"/api/plans/{p['id']}", json=p)
    public = client.get(f"/api/table/plan/{J('plans', p['id'])}")
    pub = public.json()["habillage"]
    for interdit in ("source", "chandelle, de", "Salle 2", "TRESOR", "Petite Fanfrel"):
        assert interdit not in json.dumps(pub, ensure_ascii=False), interdit
    # La salle 2 n'est pas révélée : ni son sac, ni sa lanterne, ni son étiquette ; la route n'a pas de nom visible.
    assert [o["cle"] for o in pub["objets"]] == ["table-ronde", "chope", "seau", "chandelle", "toile", "ornieres"]
    assert [(l["x"], l["y"]) for l in pub["lumieres"]] == [(1.5, 2.5), (0.2, 0.5)]
    assert [e["texte"] for e in pub["legende"]] == ["Salle 1"]
    assert pub["heure"] == "nuit" and pub["ambiance"]["force"] == 0.7
    # Brouillard levé : tout se voit, sauf l'étiquette d'une pièce au nom caché.
    p = client.get(f"/api/plans/{p['id']}").json()
    p["brouillard_actif"] = False
    client.put(f"/api/plans/{p['id']}", json=p)
    pub = client.get(f"/api/table/plan/{J('plans', p['id'])}").json()["habillage"]
    assert len(pub["objets"]) == 7 and len(pub["lumieres"]) == 3 and [e["piece"] for e in pub["legende"]] == [1, 2]
    # Un texte glissé dans l'habillage ne part pas : la TV écrit le nom actuel de la pièce.
    p = client.get(f"/api/plans/{p['id']}").json()
    p["habillage"]["legende"][0]["texte"] = "Nom inventé"
    p["pieces"][0]["nom"] = "Grande salle"
    client.put(f"/api/plans/{p['id']}", json=p)
    pub = client.get(f"/api/table/plan/{J('plans', p['id'])}").json()["habillage"]
    assert [e["texte"] for e in pub["legende"]] == ["Grande salle", "Salle 2"]
    # Un objet, une lumière ou une étiquette que le MJ a cachés ne partent pas, même dans une case révélée.
    p = client.get(f"/api/plans/{p['id']}").json()
    for cle in ("objets", "lumieres", "legende"):
        p["habillage"][cle][0]["cache"] = True
    client.put(f"/api/plans/{p['id']}", json=p)
    pub = client.get(f"/api/table/plan/{J('plans', p['id'])}").json()["habillage"]
    assert len(pub["objets"]) == 6 and len(pub["lumieres"]) == 2 and [e["piece"] for e in pub["legende"]] == [2]
    client.delete(f"/api/plans/{p['id']}")


def test_les_couts_portent_le_nom_de_l_habillage(client, tarvan, monkeypatch, tmp_path):
    monkeypatch.setattr(redaction, "CLIENT", FauxClient(json.dumps({"champs": []})))
    monkeypatch.setattr(redaction, "JOURNAL", tmp_path / "journal.jsonl")
    client.post(f"/api/cartes/{tarvan[0]['id']}/habiller", json={})
    assert [d["nom"] for d in client.get("/api/ia/couts").json()["detail"]] == ["Habillage des cartes"]
    assert redaction.NOMS_FONCTIONS["habillage-plan"] == "Habillage des plans"


def test_ponton_sur_la_rive_d_un_etang():
    """Contrôle direct, sans le serveur : un ponton près d'un étang part de la rive vers l'eau ; loin de l'eau, il s'écarte."""
    carte = {"largeur": 40, "hauteur": 30, "km_case": 0.25, "traces": [],
             "marqueurs": [{"lieu": "etang", "x": 28, "y": 5, "taille": 1}, {"lieu": "pre", "x": 10, "y": 20, "taille": 1}]}
    lieux = {"etang": {"nom": "L'étang", "connu": True}, "pre": {"nom": "Le pré", "connu": True}}
    t = habillage.Terrain(carte, terrain_essai(), lieux)
    brut = {"batiments": [{"lieu": "L1", "genre": "ponton", "x": 28, "y": 5.5, "angle": 45, "roue": "tourne", "raison": ""},
                          {"lieu": "L2", "genre": "ponton", "x": 10, "y": 21, "angle": 0, "roue": "", "raison": ""}]}
    hab, remarques = habillage.controler_carte(brut, t, {"x0": 0, "y0": 0, "x1": 40, "y1": 30}, {"L1": "etang", "L2": "pre"}, lambda s: s)
    assert len(hab["batiments"]) == 1
    p = hab["batiments"][0]
    assert p["genre"] == "ponton" and "roue" not in p and p["angle"] == 0 and 29 <= p["x"] < 30 and not t.lac(p["x"], p["y"])
    assert "1 écarté : ponton loin de l'eau" in remarques


def test_les_objets_du_plan_sont_ceux_que_le_dessin_connait():
    """La liste du contrôle suit KITS_HABILLAGE (plan/modele.js) : mêmes clés, mêmes genres de pièce."""
    source = (Path(config.ICI) / "static" / "js" / "plan" / "modele.js").read_text(encoding="utf-8")
    bloc = source[source.index("export const KITS_HABILLAGE"):]
    bloc = bloc[: bloc.index("];")]
    import re
    kits = {m.group(1): set(re.findall(r'"([a-z]+)"', m.group(2))) for m in re.finditer(r'cle: "([a-z-]+)".*?genres: \[([^\]]*)\]', bloc)}
    assert kits and set(kits) == set(habillage.OBJETS_PLAN)
    assert all(set(habillage.OBJETS_PLAN[k][2]) == g for k, g in kits.items())


def test_un_hameau_ne_porte_que_le_nom_donne_par_le_mj():
    carte = {"largeur": 40, "hauteur": 30, "km_case": 0.25, "traces": [], "marqueurs": []}
    t = habillage.Terrain(carte, terrain_essai(), {})
    brut = {"hameaux": [{"nom": "Les Trois-Puits", "fermes": [{"x": 10, "y": 20, "angle": 0, "batiments": ["logis"]}]},
                        {"nom": "Le hameau du Pinson", "fermes": [{"x": 20.5, "y": 25, "angle": 0, "batiments": ["logis"]}]}]}
    hab, _ = habillage.controler_carte(brut, t, {"x0": 0, "y0": 0, "x1": 40, "y1": 30}, {}, lambda s: s, idee="Un hameau nommé les trois puits.")
    assert [h["nom"] for h in hab["hameaux"]] == ["Les Trois-Puits", None]
