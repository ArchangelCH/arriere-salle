"""Le combat en cours d'une séance : il ne s'écrit que par ses routes, survit à l'enregistrement de la séance, et la TV
n'en reçoit, quand le MJ le montre, que l'ordre du tour, les prénoms et couleurs des héros et une seule case « Les
ennemis » : jamais le nom, la Santé ni le nombre d'un adversaire, ni la Santé ou la Psy d'un héros."""

import os
import sys
import tempfile
import time
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, seances_api, tv_cartes  # noqa: E402

J = tv_cartes.jeton
CF = {"CF-Connecting-IP": "203.0.113.7"}
# Rien de ceci ne doit sortir vers la TV : noms et capacités des adversaires, rencontre, nom caché de l'auberge.
SECRETS = ("Vadim", "Brigand", "Racket", "rencontre-secrete", "Ferme du MJ", "la-petite-fanfrelee", "Petite Fanfrelée", "Lavelle")


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture(scope="module")
def heros(client):
    a = client.post("/api/aventuriers", json={"nom": "Tavarède Lavelle", "couleur": "#ae00ff", "sante": 7, "posture": "focus"}).json()
    b = client.post("/api/aventuriers", json={"nom": "Velora Dorvan", "couleur": "red;background:url(x)", "sante": 8,
                                             "peuple": "Demi-élémentaire", "peuple_cache": True}).json()
    yield a, b
    for x in (a, b):
        client.delete(f"/api/aventuriers/{x['id']}")


@pytest.fixture()
def seance(client):
    s = client.post("/api/seances", json={"nom": "Séance du combat", "numero": 9, "date": "2026-11-01", "combat": {"id": "injecte"}}).json()
    yield s
    client.put(f"/api/seances/{s['id']}/combat/tv", json={"montrer": False})
    client.delete(f"/api/seances/{s['id']}/combat")
    client.delete(f"/api/seances/{s['id']}")


def un_combat(heros, **champs):
    a, b = heros
    return {
        "id": "c1", "rencontre": "rencontre-secrete", "nom": "La Ferme du MJ, près de la Petite Fanfrelée", "debut": "2026-11-01T15:15:00Z",
        "avant": 1, "moral": True, "tour": 2, "actif": 1,
        "ordre": [f"aventurier:{a['id']}", "ennemis", f"aventurier:{b['id']}", "aventurier:inconnu", "ennemis"],
        "heros": [
            {"id": a["id"], "nom": "Tavarède Lavelle", "couleur": "#ae00ff", "max": 7, "sante": 3, "psy": 1, "psyMax": 5, "santeDon": 2,
             "posture": "defensive", "cartons": {"physique": "jaune", "social": "violet", "mental": "rouge"}},
            {"id": b["id"], "nom": "Velora", "max": 8, "sante": 0, "posture": "en-embuscade", "cartons": {}},
        ],
        "adversaires": [
            {"id": "a1", "nom": "Vadim", "numero": "M", "rang": "soldat", "sante": 37, "max": 37,
             "capacites": "S'il tombe, ils fuient vers la-petite-fanfrelee."},
            {"id": "a2", "nom": "Brigand", "numero": "1", "rang": "sbire", "sante": 5, "max": 5, "capacites": "Racket"},
        ],
        "strat": False, "sablier": None,
    } | champs


def valeurs(x):
    if isinstance(x, dict):
        for k, v in x.items():
            yield k
            yield from valeurs(v)
    elif isinstance(x, list):
        for v in x:
            yield from valeurs(v)
    else:
        yield x


def test_le_combat_ne_s_ecrit_que_par_ses_routes(client, heros, seance):
    s = seance
    assert s["combat"] is None
    url = f"/api/seances/{s['id']}/combat"
    assert client.get(url).json()["combat"] is None
    r = client.put(url, json={**un_combat(heros), "version_base": None})
    assert r.status_code == 200
    c = r.json()["combat"]
    assert c["id"] == "c1" and c["tour"] == 2 and c["modifie"] and r.json()["tv"] is False
    # La version de la séance ne bouge pas : l'onglet Séances ouvert avant enregistre ensuite sans conflit, et ni son
    # enregistrement entier ni un PATCH ne touchent au combat.
    lue = client.get(f"/api/seances/{s['id']}").json()
    assert lue["modifie"] == s["modifie"] and lue["combat"] == c
    put = client.put(f"/api/seances/{s['id']}", json={**s, "objectif": "Mac", "combat": None, "version_base": s["modifie"]})
    assert put.status_code == 200 and put.json()["combat"] == c
    assert client.patch(f"/api/seances/{s['id']}", json={"combat": {"id": "x"}}).json()["combat"] == c
    # Deux écrans : la version d'avant doit être celle du serveur.
    assert client.put(url, json={**un_combat(heros, tour=3), "version_base": None}).status_code == 409
    assert client.put(url, json={**un_combat(heros, tour=3), "version_base": "2020-01-01T00:00:00.000"}).status_code == 409
    r = client.put(url, json={**un_combat(heros, tour=3), "version_base": c["modifie"]})
    assert r.status_code == 200 and r.json()["combat"]["tour"] == 3
    assert client.get(url).json()["combat"]["tour"] == 3


def test_un_combat_mal_forme_est_refuse(client, heros, seance):
    url = f"/api/seances/{seance['id']}/combat"
    for faux in ({"ordre": "ennemis"}, {"heros": [1]}, {"adversaires": ["Vadim"]}, {"ordre": [1]}, {"tour": True}, {"tour": "2"},
                 {"strat": "oui"}, {"nom": 4}):
        assert client.put(url, json={**un_combat(heros), **faux, "version_base": None}).status_code == 400, faux
    trop = un_combat(heros, adversaires=[{"id": f"a{k}", "nom": "x" * 400} for k in range(600)])
    assert client.put(url, json={**trop, "version_base": None}).status_code == 413
    assert client.put("/api/seances/inconnue/combat", json={"version_base": None}).status_code == 404
    assert client.put(f"{url}/tv", json={"montrer": "oui"}).status_code == 400
    assert client.put(f"{url}/tv", json={"montrer": True}).status_code == 404  # aucun combat en cours
    # Champs inconnus laissés de côté ; un identifiant douteux est remplacé ; le sablier part à l'heure du serveur.
    r = client.put(url, json={**un_combat(heros, id="<b>", sablier={"duree": 99999}), "pirate": 1, "version_base": None}).json()["combat"]
    assert "pirate" not in r and seances_api.ID_COMBAT.match(r["id"]) and r["sablier"]["duree"] == seances_api.SABLIER_MAX
    assert abs(r["sablier"]["fin"] - (time.time() + seances_api.SABLIER_MAX)) < 5


def test_la_psy_des_heros_est_bornee(client, heros, seance):
    url = f"/api/seances/{seance['id']}/combat"
    a, b = un_combat(heros)["heros"]
    for faux in ({"psy": "3"}, {"psyMax": True}, {"santeDon": None}, {"psy": [1]}):
        assert client.put(url, json={**un_combat(heros) | {"heros": [a | faux, b]}, "version_base": None}).status_code == 400, faux
    # Psy jamais sous 0 ; des entiers, bornés ; le reste du héros tel quel.
    corps = un_combat(heros) | {"heros": [a | {"psy": -3, "psyMax": 5.6, "santeDon": 10**9}, b]}
    r = client.put(url, json={**corps, "version_base": None})
    assert r.status_code == 200
    c = r.json()["combat"]
    h, v = c["heros"]
    assert (h["psy"], h["psyMax"], h["santeDon"]) == (0, 6, seances_api.PSY_MAX)
    assert h["sante"] == 3 and h["cartons"] == a["cartons"] and h["posture"] == "defensive"
    # Un combat d'avant le suivi de la Psy s'enregistre toujours, sans Psy inventée.
    assert not set(seances_api.CHAMPS_PSY) & set(v)
    r = client.put(url, json={**c, "heros": [b, a | {"psy": 2}], "version_base": c["modifie"]})
    assert r.status_code == 200 and [x.get("psy") for x in r.json()["combat"]["heros"]] == [None, 2]
    assert client.get(url).json()["combat"]["heros"][1]["psy"] == 2


def test_la_tv_ne_recoit_que_l_ordre_et_seulement_quand_le_mj_le_montre(client, heros, seance):
    a, b = heros
    s = seance
    url = f"/api/seances/{s['id']}/combat"
    public = f"/api/table/combat/{J('seances', s['id'])}"
    c = client.put(url, json={**un_combat(heros), "version_base": None}).json()["combat"]
    # Pas montré : la TV n'en sait rien, même avec le jeton.
    assert client.get(public).status_code == 404
    with client.websocket_connect("/ws/table") as ws:
        assert "combat" not in ws.receive_json()["etat"]
    r = client.put(f"{url}/tv", json={"montrer": True})
    assert r.status_code == 200 and r.json()["tv"] is True and "ecrans" in r.json()
    table = client.get("/api/table").json()
    assert table["combat"] == s["id"] and table["combat_maj"] == c["modifie"]
    with client.websocket_connect("/ws/table") as ws:
        etat = ws.receive_json()["etat"]
    assert etat["combat"] == J("seances", s["id"]) and etat["combat_maj"] == c["modifie"]
    r = client.get(public)
    assert r.status_code == 200
    d = r.json()
    assert d == {
        "id": J("seances", s["id"]), "tour": 2, "actif": 1, "strat": False, "sablier": None,
        "ordre": [
            {"genre": "heros", "nom": "Tavarède", "heros": J("heros-pion", a["id"]), "couleur": "#ae00ff", "posture": "defensive", "coma": False,
             "cartons": [{"carac": "physique", "couleur": "jaune"}, {"carac": "mental", "couleur": "rouge"}], "avantage": ""},
            {"genre": "ennemis"},
            # Couleur douteuse retirée, posture inconnue vide, à 0 Santé : dans le coma.
            {"genre": "heros", "nom": "Velora", "heros": J("heros-pion", b["id"]), "couleur": "", "posture": "", "coma": True, "cartons": [], "avantage": ""},
        ],
    }
    for interdit in SECRETS:
        assert interdit not in r.text, interdit
    assert not {"sante", "max", "psy", "psyMax", "santeDon", "numero", "capacites", "adversaires", "rencontre", "fin"} & set(valeurs(d))
    assert 37 not in list(valeurs(d)) and 5 not in list(valeurs(d))


def test_un_autre_ecran_garde_le_bandeau(client, heros, seance):
    s = seance
    url = f"/api/seances/{s['id']}/combat"
    c = client.put(url, json={**un_combat(heros), "version_base": None}).json()["combat"]
    client.put(f"{url}/tv", json={"montrer": True})
    # Un plan, puis l'accueil, envoyés par l'atelier : le bandeau reste ; un écran ne peut ni le poser ni le déplacer.
    assert client.put("/api/table", json={"vue": "accueil", "combat": "autre-seance", "combat_maj": "faux"}).status_code == 200
    table = client.get("/api/table").json()
    assert table["vue"] == "accueil" and table["combat"] == s["id"] and table["combat_maj"] == c["modifie"]
    client.put(f"{url}/tv", json={"montrer": False})
    assert client.put("/api/table", json={"vue": "accueil", "combat": s["id"]}).status_code == 200
    assert "combat" not in client.get("/api/table").json()
    assert client.get(f"/api/table/combat/{J('seances', s['id'])}").status_code == 404


def test_le_bandeau_suit_le_combat_puis_s_en_va(client, heros, seance):
    s = seance
    url = f"/api/seances/{s['id']}/combat"
    public = f"/api/table/combat/{J('seances', s['id'])}"
    c = client.put(url, json={**un_combat(heros), "version_base": None}).json()["combat"]
    client.put(f"{url}/tv", json={"montrer": True})
    with client.websocket_connect("/ws/table") as ws:
        ws.receive_json()
        c = client.put(url, json={**un_combat(heros, actif=2, tour=3, strat=True, sablier={"duree": 60}), "version_base": c["modifie"]}).json()["combat"]
        etat = ws.receive_json()["etat"]
    assert etat["combat_maj"] == c["modifie"]
    d = client.get(public).json()
    assert d["actif"] == 2 and d["tour"] == 3 and d["strat"] is True and 55 <= d["sablier"]["reste"] <= 60 and d["sablier"]["duree"] == 60
    # Sablier écoulé : il reste à zéro (« le monstre rejoue »).
    c = client.put(url, json={**c, "sablier": {"duree": 60, "fin": time.time() - 5}, "version_base": c["modifie"]}).json()["combat"]
    assert client.get(public).json()["sablier"] == {"duree": 60, "reste": 0.0}
    # Un autre combat remplace celui-ci : il ne part pas tout seul vers la TV.
    c = client.put(url, json={**un_combat(heros, id="c2"), "version_base": c["modifie"]}).json()["combat"]
    assert "combat" not in client.get("/api/table").json() and client.get(public).status_code == 404
    assert client.put(f"{url}/tv", json={"montrer": True}).json()["tv"] is True
    # Fin du combat : il quitte la séance et la TV.
    r = client.delete(url)
    assert r.status_code == 200 and r.json()["combat"] is None and r.json()["tv"] is False
    assert "combat" not in client.get("/api/table").json() and client.get(public).status_code == 404
    assert client.get(f"/api/seances/{s['id']}").json()["combat"] is None
    assert client.delete(url).status_code == 200


def test_depuis_internet_le_combat_reste_a_l_atelier(client, heros, seance):
    s = seance
    url = f"/api/seances/{s['id']}/combat"
    public = f"/api/table/combat/{J('seances', s['id'])}"
    c = client.put(url, json={**un_combat(heros), "version_base": None}).json()["combat"]
    assert client.get(url, headers=CF).status_code == 404
    assert client.put(url, json={**un_combat(heros), "version_base": c["modifie"]}, headers=CF).status_code == 404
    assert client.put(f"{url}/tv", json={"montrer": True}, headers=CF).status_code == 404
    assert client.delete(url, headers=CF).status_code == 404
    assert "combat" not in client.get("/api/table").json()
    client.put(f"{url}/tv", json={"montrer": True})
    try:
        r = client.get(public, headers=CF)
        assert r.status_code == 200 and all(x not in r.text for x in SECRETS)
        # Table publique fermée : rien du combat pour Internet, ni par la route ni par le WebSocket.
        client.put("/api/table-publique", json={"ouverte": False})
        assert client.get(public, headers=CF).status_code == 404
        with client.websocket_connect("/ws/table", headers=CF) as ws:
            assert "combat" not in ws.receive_json()["etat"]
        assert client.get(public).status_code == 200
    finally:
        client.put("/api/table-publique", json={"ouverte": True})
