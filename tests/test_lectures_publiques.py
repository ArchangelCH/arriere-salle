"""La table publique (un écran venu d'Internet) ne lit de /api/table/… que ce que la TV montre en ce moment : la même
règle que le sanctuaire, pour la planche, la tablée, les fiches, et chaque fiche désignée par son jeton (plan, carte,
lieu, boutique, PNJ, rumeur, aventurier, séance, combat). Quand la TV les montre vraiment, tout se lit ; le réseau local
et la TV du salon ne changent pas (lectures_publiques.py)."""

import base64
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from table import lectures_publiques  # noqa: E402
import main  # noqa: E402
from api import application, config, tv_cartes, tv_medias, utilitaires  # noqa: E402

J = tv_cartes.jeton
CF = {"CF-Connecting-IP": "203.0.113.7"}
W, H = 4, 2


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture(autouse=True)
def table_ouverte(client):
    config.TABLE_OUVERTURE.unlink(missing_ok=True)  # sans réglage, la table publique est ouverte
    yield
    client.put("/api/table", json={"vue": "accueil"})


@pytest.fixture(scope="module")
def fiches(client):
    b64 = lambda o: base64.b64encode(o).decode()  # noqa: E731
    lieu = client.post("/api/lieux", json={"nom": "Le Gué public", "type": "village", "connu": True}).json()
    plan = client.post("/api/plans", json={
        "nom": "Plan public", "largeur": W, "hauteur": H, "brouillard_actif": True, "sol": [2] * (W * H), "piece": [1] * (W * H),
        "brouillard": [1] * (W * H), "pieces": [{"id": 1, "nom": "Salle", "genre": "salle"}], "portes": [], "objets": [], "textes": [], "pions": [],
    }).json()
    autre = client.post("/api/plans", json={"nom": "Autre plan", "largeur": W, "hauteur": H, "brouillard_actif": False,
                                            "sol": [2] * (W * H), "piece": [1] * (W * H), "pions": []}).json()
    carte = client.post("/api/cartes", json={"nom": "Carte publique", "largeur": 6, "hauteur": 4, "km_case": 1, "style": "couleur",
                                             "terrain": b64(bytes([1]) * 24), "brouillard": b64(bytes(24)),
                                             "marqueurs": [{"id": "m1", "lieu": lieu["id"], "x": 2, "y": 2}]}).json()
    pnj = client.post("/api/pnj", json={"nom": "Odile Publique", "connu": True}).json()
    rumeur = client.post("/api/rumeurs", json={"texte": "On dit que le gué déborde.", "etat": "entendue"}).json()
    heros = client.post("/api/aventuriers", json={"nom": "Brune Lecture", "sante": 8, "psy": 4, "tablee": True}).json()
    seance = client.post("/api/seances", json={"nom": "Séance publique", "numero": 3, "precedemment": "Ils ont traversé le gué."}).json()
    boutique = client.post("/api/boutiques", json={"nom": "Étal public", "articles": [{"id": "a1", "nom": "Corde", "prix": "2"}]}).json()
    faites = {"lieu": lieu, "plan": plan, "autre": autre, "carte": carte, "pnj": pnj, "rumeur": rumeur, "heros": heros,
              "seance": seance, "boutique": boutique}
    yield faites
    for collection, cle in (("lieux", "lieu"), ("plans", "plan"), ("plans", "autre"), ("cartes", "carte"), ("pnj", "pnj"),
                            ("rumeurs", "rumeur"), ("aventuriers", "heros"), ("seances", "seance"), ("boutiques", "boutique")):
        client.delete(f"/api/{collection}/{faites[cle]['id']}")


def lit(client, chemin):
    return client.get(chemin, headers=CF).status_code


@pytest.mark.parametrize("vue", ["planche", "heros", "fiches", "sanctuaire"])
def test_une_vue_entiere_ne_se_lit_que_montree(client, vue):
    client.put("/api/table", json={"vue": "accueil"})
    assert lit(client, f"/api/table/{vue}") == 404
    client.put("/api/table", json={"vue": vue})
    assert lit(client, f"/api/table/{vue}") == 200
    autres = [v for v in ("planche", "heros", "fiches", "sanctuaire") if v != vue]
    for autre in autres:
        assert lit(client, f"/api/table/{autre}") == 404, autre
    # Sur le réseau local, rien ne change : l'atelier et la TV du salon lisent tout.
    client.put("/api/table", json={"vue": "accueil"})
    assert client.get(f"/api/table/{vue}").status_code == 200


def test_le_plan_montre_et_lui_seul(client, fiches):
    plan, autre = fiches["plan"], fiches["autre"]
    client.put("/api/table", json={"vue": "plan", "plan": plan["id"]})
    assert lit(client, f"/api/table/plan/{J('plans', plan['id'])}") == 200
    assert lit(client, f"/api/table/plan/{J('plans', autre['id'])}") == 404
    # Un jeton gardé d'une séance passée ne relit plus le plan quand la TV montre autre chose.
    client.put("/api/table", json={"vue": "carte", "carte": fiches["carte"]["id"], "plan": plan["id"]})
    assert lit(client, f"/api/table/plan/{J('plans', plan['id'])}") == 404
    assert client.get(f"/api/table/plan/{J('plans', plan['id'])}").status_code == 200


def test_la_carte_et_son_lieu_seulement_sur_la_carte(client, fiches):
    carte, lieu = fiches["carte"], fiches["lieu"]
    jc, jl = J("cartes", carte["id"]), J("lieux", lieu["id"])
    client.put("/api/table", json={"vue": "carte", "carte": carte["id"]})
    assert lit(client, f"/api/table/carte/{jc}") == 200
    assert lit(client, f"/api/table/lieu/{jl}") == 404
    client.put("/api/table", json={"vue": "carte", "carte": carte["id"], "lieu": lieu["id"]})
    assert lit(client, f"/api/table/lieu/{jl}") == 200
    # Le lieu resté dans l'état sous un plan ne se lit plus : la TV ne le montre que sur une carte.
    client.put("/api/table", json={"vue": "plan", "plan": fiches["plan"]["id"], "lieu": lieu["id"]})
    assert lit(client, f"/api/table/lieu/{jl}") == 404
    assert lit(client, f"/api/table/carte/{jc}") == 404


@pytest.mark.parametrize("cle, collection, chemin", [("pnj", "pnj", "pnj"), ("rumeur", "rumeurs", "rumeur"), ("heros", "aventuriers", "aventurier")])
def test_un_carton_tant_qu_il_est_a_l_ecran(client, fiches, cle, collection, chemin):
    ident = fiches[cle]["id"]
    champ = "aventurier" if cle == "heros" else cle
    url = f"/api/table/{chemin}/{J(collection, ident)}"
    client.put("/api/table", json={"vue": "accueil"})
    assert lit(client, url) == 404
    # Posé par-dessus n'importe quelle vue : un plan, ici.
    client.put("/api/table", json={"vue": "plan", "plan": fiches["plan"]["id"], champ: ident})
    assert lit(client, url) == 200
    client.put("/api/table", json={"vue": "plan", "plan": fiches["plan"]["id"]})
    assert lit(client, url) == 404


def test_la_seance_pour_sa_vue(client, fiches):
    seance = fiches["seance"]
    js = J("seances", seance["id"])
    client.put("/api/table", json={"vue": "precedemment", "seance": seance["id"]})
    assert lit(client, f"/api/table/precedemment/{js}") == 200
    assert lit(client, f"/api/table/episode/{js}") == 404
    client.put("/api/table", json={"vue": "episode", "seance": seance["id"]})
    assert lit(client, f"/api/table/episode/{js}") == 200
    assert lit(client, f"/api/table/precedemment/{js}") == 404


def test_la_boutique_montree_et_elle_seule(client, fiches):
    b = fiches["boutique"]
    jb = J("boutiques", b["id"])
    client.put("/api/table", json={"vue": "boutique", "boutique": b["id"]})
    assert lit(client, f"/api/table/boutique/{jb}") == 200
    client.put("/api/table", json={"vue": "planche", "boutique": b["id"]})
    assert lit(client, f"/api/table/boutique/{jb}") == 404


def test_le_combat_montre(client, fiches):
    seance, heros = fiches["seance"], fiches["heros"]
    js = J("seances", seance["id"])
    combat = {"version_base": None, "id": "lecture", "tour": 1, "ordre": [f"aventurier:{heros['id']}", "ennemis"],
              "heros": [{"id": heros["id"], "posture": "focus", "sante": 8}]}
    assert client.put(f"/api/seances/{seance['id']}/combat", json=combat).status_code == 200
    client.put("/api/table", json={"vue": "plan", "plan": fiches["plan"]["id"]})
    assert lit(client, f"/api/table/combat/{js}") == 404
    client.put(f"/api/seances/{seance['id']}/combat/tv", json={"montrer": True})
    assert lit(client, f"/api/table/combat/{js}") == 200
    client.put(f"/api/seances/{seance['id']}/combat/tv", json={"montrer": False})
    assert lit(client, f"/api/table/combat/{js}") == 404
    client.delete(f"/api/seances/{seance['id']}/combat")


def test_la_tv_d_internet_suit_ce_que_montre_le_mj(client, fiches):
    """Ce que la table publique reçoit par son WebSocket se lit aussitôt : la règle ne casse pas l'écran d'Internet."""
    plan = fiches["plan"]
    client.put("/api/table", json={"vue": "plan", "plan": plan["id"]})
    with client.websocket_connect("/ws/table", headers=CF) as ws:
        etat = ws.receive_json()["etat"]
        assert etat["vue"] == "plan" and lit(client, f"/api/table/plan/{etat['plan']}") == 200
        client.put("/api/table", json={"vue": "heros"})
        etat = ws.receive_json()["etat"]
        assert etat["vue"] == "heros" and lit(client, "/api/table/heros") == 200
        assert lit(client, f"/api/table/plan/{J('plans', plan['id'])}") == 404


def test_une_route_inconnue_reste_fermee_et_toutes_sont_rangees(client):
    client.put("/api/table", json={"vue": "planche"})
    assert lit(client, "/api/table/inconnue") == 404
    assert lit(client, "/api/table/planche/fond") == 404
    # Chaque lecture de la table déclarée dans main.py est connue de la règle : une route oubliée resterait fermée.
    quoi = {r.path.split("/")[3] for r in application.app.routes if getattr(r, "path", "").startswith("/api/table/") and "GET" in getattr(r, "methods", set())}
    assert quoi and quoi <= lectures_publiques.connues(), quoi - lectures_publiques.connues()


def test_la_regle_seule():
    j = lambda c, i: f"{c}:{i}"  # noqa: E731
    montre = lectures_publiques.montre
    assert montre("/api/table/plan/plans:p", {"vue": "plan", "plan": "p"}, j)
    assert montre("/api/table/plan/plans:p/fond", {"vue": "plan", "plan": "p"}, j)
    assert not montre("/api/table/lieu/lieux:l/fond", {"vue": "carte", "carte": "c", "lieu": "l"}, j)
    assert not montre("/api/table/plan/plans:q", {"vue": "plan", "plan": "p"}, j)
    assert not montre("/api/table/plan", {"vue": "plan", "plan": "p"}, j)
    # Une vignette : seulement une image que cite ce que la TV montre (tv_medias.medias_montres en donne la liste).
    assert not montre("/api/table/vignette/portrait-1.jpg", {"vue": "accueil"}, j)
    assert not montre("/api/table/vignette/portrait-1.jpg", {"vue": "accueil"}, j, {"autre.jpg"})
    assert montre("/api/table/vignette/portrait-1.jpg", {"vue": "accueil"}, j, {"portrait-1.jpg"})
    assert not montre("/api/table/vignette/a/fond", {"vue": "accueil"}, j, {"a"})
    assert not montre("/api/table/planche", None, j)


def test_les_lectures_que_la_tv_montre():
    """chemins_montres rend exactement des lectures que montre() laisse passer, et medias_cites les images d'une réponse."""
    j = lambda c, i: f"{c}:{i}"  # noqa: E731
    for etat in ({"vue": "heros"}, {"vue": "plan", "plan": "p", "pnj": "x", "aventurier": "a"},
                 {"vue": "carte", "carte": "c", "lieu": "l"}, {"vue": "precedemment", "seance": "s", "combat": "s"}, {}):
        chemins = lectures_publiques.chemins_montres(etat, j)
        assert all(lectures_publiques.montre(c, etat, j) for c in chemins), chemins
    assert lectures_publiques.chemins_montres({"vue": "plan", "plan": "p"}, j) == ["/api/table/plan/plans:p"]
    assert lectures_publiques.chemins_montres(None, j) == []
    texte = '{"image": "/media/abc-1.png", "autre": "/media/../x", "url": "https://x/media/def.jpg"}'
    assert lectures_publiques.medias_cites(texte) == {"abc-1.png", "def.jpg"}


def test_une_vignette_seulement_de_ce_que_la_tv_montre(client, fiches):
    """Depuis Internet, /api/table/vignette ne sert que l'image d'un portrait que la TV montre en ce moment ; ni une autre
    image de data/images (même au nom connu), ni celle d'un héros quand la TV passe à autre chose. Le salon et le MJ,
    toutes (lot H2, défauts de la vague 5)."""
    from PIL import Image
    config.IMAGES.mkdir(parents=True, exist_ok=True)
    montre, autre = "vignette-montree.png", "vignette-cachee.png"
    for nom in (montre, autre):
        Image.new("RGB", (40, 60), (120, 90, 60)).save(config.IMAGES / nom)
    heros = fiches["heros"]["id"]
    chemin = config.AVENTURIERS / f"{heros}.json"
    avant = chemin.read_bytes()
    try:
        fiche = utilitaires.lire(chemin)
        fiche.update(illustration=f"/media/{montre}", illustrations=[{"url": f"/media/{montre}"}])
        utilitaires.ecrire(chemin, fiche)
        tv_medias._medias_montres["cle"] = None
        client.put("/api/table", json={"vue": "heros"})
        assert lit(client, f"/api/table/vignette/{montre}?l=160") == 200
        assert lit(client, f"/api/table/vignette/{autre}?l=160") == 404
        # Le salon et le réseau local lisent toutes les vignettes, comme avant.
        assert client.get(f"/api/table/vignette/{autre}?l=160").status_code == 200
        # La TV passe à la planche : le portrait du héros ne se lit plus depuis Internet.
        client.put("/api/table", json={"vue": "planche"})
        assert lit(client, f"/api/table/vignette/{montre}?l=160") == 404
        # Un carton d'aventurier posé par-dessus une autre vue le rend lisible de nouveau.
        client.put("/api/table", json={"vue": "planche", "aventurier": heros})
        assert lit(client, f"/api/table/vignette/{montre}?l=160") == 200
    finally:
        chemin.write_bytes(avant)
        for nom in (montre, autre):
            (config.IMAGES / nom).unlink(missing_ok=True)


def test_une_vignette_d_un_portrait_change_pendant_que_la_tv_le_montre(client, fiches):
    """La fiche montrée change sans que l'état de la TV bouge (un portrait choisi, un pion ajouté au plan montré) : la
    nouvelle image se lit aussitôt depuis Internet, sans attendre la fin de la liste gardée deux secondes ; l'ancienne
    n'y est plus."""
    import time
    from PIL import Image
    config.IMAGES.mkdir(parents=True, exist_ok=True)
    avant_nom, apres_nom = "vignette-avant.png", "vignette-apres.png"
    for nom in (avant_nom, apres_nom):
        Image.new("RGB", (40, 60), (60, 90, 120)).save(config.IMAGES / nom)
    heros = fiches["heros"]["id"]
    chemin = config.AVENTURIERS / f"{heros}.json"
    sauve = chemin.read_bytes()
    try:
        def portrait(nom):
            fiche = utilitaires.lire(chemin)
            fiche.update(illustration=f"/media/{nom}", illustrations=[{"url": f"/media/{nom}"}])
            utilitaires.ecrire(chemin, fiche)
        portrait(avant_nom)
        tv_medias._medias_montres["cle"] = None
        client.put("/api/table", json={"vue": "heros"})
        assert lit(client, f"/api/table/vignette/{avant_nom}?l=160") == 200
        portrait(apres_nom)
        time.sleep(tv_medias.MEDIAS_MONTRES_RELECTURE + 0.05)
        assert lit(client, f"/api/table/vignette/{apres_nom}?l=160") == 200
        assert lit(client, f"/api/table/vignette/{avant_nom}?l=160") == 404
        # Une image jamais montrée reste refusée, liste refaite ou non.
        assert lit(client, "/api/table/vignette/jamais-montree.png?l=160") == 404
    finally:
        chemin.write_bytes(sauve)
        for nom in (avant_nom, apres_nom):
            (config.IMAGES / nom).unlink(missing_ok=True)
