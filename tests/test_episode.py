"""Le carton-titre d'épisode sur la TV : le numéro, le titre montré aux joueurs (passé au masque) et une image de fond,
rien d'autre de la séance."""

import json
import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

import main  # noqa: E402
from api import application, config, portier, tv_cartes  # noqa: E402
from sources_front import source_page  # noqa: E402

J = tv_cartes.jeton
STATIQUE = Path(__file__).resolve().parent.parent / "app" / "static"


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def media(nom):
    Image.new("RGB", (8, 8), (90, 60, 40)).save(config.IMAGES / nom)
    return f"/media/{nom}"


def episode(client, seance):
    return client.get(f"/api/table/episode/{J('seances', seance['id'])}")


def test_le_carton_titre_ne_donne_que_numero_titre_et_image(client):
    cache = client.post("/api/lieux", json={"nom": "Le repaire de Vadim", "connu": False}).json()
    client.post(f"/api/lieux/{cache['id']}/illustrations", json={"url": media("ep-repaire.jpg")})
    nu = client.post("/api/lieux", json={"nom": "Le pré sans image", "connu": True}).json()
    secret = client.post("/api/lieux", json={"nom": "La crypte", "connu": True}).json()
    client.post(f"/api/lieux/{secret['id']}/illustrations", json={"url": media("ep-crypte.jpg")})
    # Les illustrations ne s'écrivent que par leurs routes : la marque « secrète » se pose ici sur le disque de l'essai.
    chemin = config.LIEUX / f"{secret['id']}.json"
    contenu = json.loads(chemin.read_text(encoding="utf-8"))
    contenu["illustrations"][0]["secrete"] = True
    chemin.write_text(json.dumps(contenu, ensure_ascii=False), encoding="utf-8")
    moulin = client.post("/api/lieux", json={"nom": "Le moulin des Essais", "connu": True}).json()
    client.post(f"/api/lieux/{moulin['id']}/illustrations", json={"url": media("ep-moulin.jpg")})
    seance = client.post("/api/seances", json={
        "nom": "La trahison de Vadim", "titre_episode": "  Retour à la   Petite Fanfrelée ", "numero": 3,
        "objectif": "OBJECTIF-MJ", "notes": "NOTE-MJ", "lieux": [cache["id"], nu["id"], secret["id"], moulin["id"]],
    }).json()
    client.post(f"/api/seances/{seance['id']}/journal", json={"texte": "JOURNAL-MJ"})

    # La TV ne connaît la séance que par son jeton.
    assert client.get(f"/api/table/episode/{seance['id']}").status_code == 404
    r = episode(client, seance)
    assert r.status_code == 200
    d = r.json()
    assert set(d) == {"id", "numero", "titre", "image"}
    assert d["numero"] == 3 and d["titre"] == "Retour à l'auberge"
    # Ni un lieu inconnu, ni un lieu sans image, ni une image secrète : le premier lieu connu qui a une image montrable.
    assert d["image"] == "/media/ep-moulin.jpg"
    for interdit in ("anfrel", "Vadim", "trahison", "OBJECTIF-MJ", "NOTE-MJ", "JOURNAL-MJ", "moulin des", cache["id"]):
        assert interdit not in r.text


def test_sans_titre_choisi_le_nom_de_la_seance_et_sans_image_un_fond_sombre(client):
    seance = client.post("/api/seances", json={"nom": "Une nouvelle compagnie", "numero": "1", "titre_episode": "   "}).json()
    d = episode(client, seance).json()
    assert d == {"id": J("seances", seance["id"]), "numero": 1, "titre": "Une nouvelle compagnie", "image": None}
    for numero in (None, 0, -2, "deux", 1.5, "1e400"):
        s = client.post("/api/seances", json={"nom": "Séance sans numéro", "numero": numero}).json()
        assert episode(client, s).json()["numero"] is None
    nom_cache = client.post("/api/seances", json={"nom": "Une nuit à la Petite-Fanfrelee"}).json()
    assert episode(client, nom_cache).json()["titre"] == "Une nuit à l'auberge"


def test_l_illustration_de_la_seance_passe_avant_celle_des_lieux(client):
    lieu = client.post("/api/lieux", json={"nom": "La place", "connu": True}).json()
    client.post(f"/api/lieux/{lieu['id']}/illustrations", json={"url": media("ep-place.jpg")})
    propre = media("ep-seance.jpg")
    seance = client.post("/api/seances", json={"nom": "Le marché", "lieux": [lieu["id"]],
                                               "illustrations": [{"url": propre}], "illustration": propre}).json()
    assert episode(client, seance).json()["image"] == propre
    # Une image disparue de /media ne laisse pas la TV sur une adresse morte : le lieu reprend la main.
    (config.IMAGES / "ep-seance.jpg").unlink()
    assert episode(client, seance).json()["image"] == "/media/ep-place.jpg"


def test_la_tv_recoit_la_vue_episode_par_jeton(client):
    seance = client.post("/api/seances", json={"nom": "Le départ", "numero": 4, "notes": "NOTE-SEANCE"}).json()
    client.put("/api/table", json={"vue": "episode", "seance": seance["id"], "seance_maj": seance["modifie"], "contrat": None,
                                   "avant": {"vue": "plan", "lieu": "la-petite-fanfrelee"}})
    with client.websocket_connect("/ws/table") as ws:
        etat = json.loads(ws.receive_text())["etat"]
    assert etat["vue"] == "episode" and etat["seance"] == J("seances", seance["id"]) and etat["seance_maj"] == seance["modifie"]
    assert "avant" not in etat and "NOTE-SEANCE" not in json.dumps(etat) and "fanfrel" not in json.dumps(etat)
    # Par le tunnel Cloudflare aussi : la route est une route de la TV, en lecture.
    assert portier.CHEMINS_TABLE.match(f"/api/table/episode/{etat['seance']}")
    assert client.get(f"/api/table/episode/{etat['seance']}", headers={"CF-Connecting-IP": "203.0.113.7"}).status_code == 200
    client.put("/api/table", json={"vue": "accueil"})


def test_la_tv_sait_jouer_le_carton_titre():
    table = source_page("table")
    assert "/api/table/episode/" in table and re.search(r'etat\.vue === "episode" && etat\.seance', table)
    assert '<section class="episode" hidden' in (STATIQUE / "table.html").read_text(encoding="utf-8")
    css = (STATIQUE / "css" / "table.css").read_text(encoding="utf-8")
    assert ".episode.sans-image" in css and '"Cinzel Decorative"' in css
    # Quitter le carton-titre ramène à ce que la TV montrait avant lui, de quelque écran que parte le geste.
    for fichier in ("seances/seances.js", "auberge/auberge.js", "aventuriers/createur.js", "aventuriers/tablee.js", "illustrations/illustrations.js"):
        source = (STATIQUE / "js" / fichier).read_text(encoding="utf-8")
        assert re.search(r'\["planche", "precedemment", "episode"', source), fichier
