"""La main levée (main_levee.py, salle.py, POST/DELETE /api/main du coin) : la main se lève et se baisse, une seule à la
fois par joueur, elle retombe seule au bout du délai, « Donner la parole » et « Plus tard » avec la version lue, un
joueur ne baisse jamais la main d'un autre, rien ne part sur Telegram ni dans la boîte des demandes, on la lève carnet
fermé, la pause la fige, l'atelier le sait dans la seconde par son canal, et rien de la salle ne sort vers la TV, la
table publique ou le coin."""
import asyncio
import json
import os
import re
import sys
import tempfile
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from coin_mj import boite as boite_mod  # noqa: E402
from commun import demandes  # noqa: E402
import joueurs  # noqa: E402
from commun import main_levee  # noqa: E402
from commun import presence  # noqa: E402
from comptes_coin import entrer as entrer_au_coin  # noqa: E402
import main  # noqa: E402
from api import application, carnet_api, config, joueurs_mj  # noqa: E402

CF = {"CF-Connecting-IP": "203.0.113.7"}


@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c
    presence.chemin(config.PROPOSITIONS).unlink(missing_ok=True)


@pytest.fixture()
def coin(monkeypatch):
    monkeypatch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    monkeypatch.setattr(joueurs, "COOKIE_SUR", False)
    monkeypatch.setattr(joueurs, "HOTES", set())
    monkeypatch.setattr(joueurs, "DEMANDES_FAITES", {})
    monkeypatch.setattr(joueurs, "MAINS_LEVEES", {})
    with TestClient(joueurs.app) as c:
        yield c


@pytest.fixture()
def un_autre_coin(coin):
    """Un second appareil, celui d'un autre joueur (les réglages du coin sont déjà posés)."""
    with TestClient(joueurs.app) as c:
        yield c


@pytest.fixture()
def invites(atelier):
    crees = []

    def inviter(nom):
        j = atelier.post("/api/joueurs", json={"nom": nom}).json()
        crees.append(j["id"])
        return j
    yield inviter
    for ident in crees:
        atelier.delete(f"/api/joueurs/{ident}")
    demandes.ecrire_pause(config.PROPOSITIONS, False)


def entrer(client, j):
    cle = j["id"]
    entrer_au_coin(client, cle)


def lever(client):
    return client.post("/api/main", json={})


def baisser(client):
    return client.delete("/api/main")


def mains_de(joueur):
    return [d for d in demandes.lire(config.PROPOSITIONS, joueur) if d["genre"] == main_levee.GENRE]


def salle(atelier, joueur=None):
    v = atelier.get("/api/salle").json()
    return [m for m in v["mains"] if joueur is None or m["joueur"] == joueur]


def vieillir(joueur, ident, secondes):
    """La main levée il y a tant de secondes (l'heure de la demande, réécrite sous le verrou)."""
    with demandes.verrou(config.PROPOSITIONS):
        liste = demandes.lire(config.PROPOSITIONS, joueur)
        d = demandes.trouver(liste, ident)
        d["cree"] = (datetime.now() - timedelta(seconds=secondes)).isoformat(timespec="milliseconds")
        demandes.ecrire(config.PROPOSITIONS, joueur, liste)


def attendre(condition, delai=5.0):
    fin = time.monotonic() + delai
    while time.monotonic() < fin:
        if condition():
            return True
        time.sleep(0.05)
    return False


# ---------------------------------------------------------------- lever, baisser

def test_lever_et_baisser_la_main(atelier, coin, invites):
    j = invites("Dario")
    entrer(coin, j)
    assert coin.get("/api/main").json()["etat"] == "repos"
    r = lever(coin)
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["etat"] == "levee" and 290 < m["reste"] <= main_levee.DUREE and m["id"]
    [d] = mains_de(j["id"])
    assert d["statut"] == "en-attente" and d["corps"] == {} and d["par"] == "joueur" and d["id"] == m["id"]
    # L'atelier la voit, avec le prénom du joueur, au premier rang.
    [vue] = salle(atelier, j["id"])
    assert vue["nom"] == "Dario" and vue["id"] == m["id"] and vue["version"] == 1 and vue["rang"] == 1 and vue["heros"] is None
    r = baisser(coin)
    assert r.status_code == 200 and r.json()["etat"] == "repos"
    [d] = mains_de(j["id"])
    assert d["statut"] == "retiree" and d["resultat"] == main_levee.BAISSEE
    assert salle(atelier, j["id"]) == []
    # Baisser une main qui ne l'est pas ne fait rien.
    assert baisser(coin).status_code == 200 and len(mains_de(j["id"])) == 1


def test_une_seule_main_par_joueur(atelier, coin, invites):
    j = invites("Une main")
    entrer(coin, j)
    un = lever(coin).json()["id"]
    assert lever(coin).json()["id"] == un
    # Par la route commune des demandes aussi : la même main revient.
    r = coin.post("/api/demandes", json={"genre": "main", "corps": {}})
    assert r.status_code == 200 and r.json()["id"] == un
    assert coin.post("/api/demandes", json={"genre": "main"}).json()["id"] == un
    assert coin.post("/api/demandes", json={"genre": "main", "corps": {"texte": "moi"}}).status_code == 400
    assert [d["statut"] for d in mains_de(j["id"])] == ["en-attente"]
    assert len(salle(atelier, j["id"])) == 1
    # Une partie animée ne remplit pas le fichier, et ne chasse pas « Un mot au MJ ».
    coin.post("/api/demandes", json={"genre": "message", "corps": {"texte": "Un mot gardé"}})
    for _ in range(12):
        baisser(coin)
        lever(coin)
    assert len(mains_de(j["id"])) <= main_levee.GARDEES + 1
    assert any(d["genre"] == "message" for d in demandes.lire(config.PROPOSITIONS, j["id"]))
    assert len([d for d in mains_de(j["id"]) if d["statut"] == "en-attente"]) == 1


def test_la_main_retombe_seule(atelier, coin, invites):
    j = invites("Retombée")
    entrer(coin, j)
    un = lever(coin).json()["id"]
    vieillir(j["id"], un, main_levee.DUREE - 30)
    m = coin.get("/api/main").json()
    assert m["etat"] == "levee" and 25 < m["reste"] <= 30
    assert [x["reste"] for x in salle(atelier, j["id"])][0] <= 30
    vieillir(j["id"], un, main_levee.DUREE + 1)
    # Ni le joueur ni le MJ ne la voient plus levée : personne n'a eu à l'écrire.
    assert coin.get("/api/main").json() == {"etat": "retombee", "id": un, "reste": 0, "duree": main_levee.DUREE, "pause": False}
    assert salle(atelier, j["id"]) == []
    vieillir(j["id"], un, main_levee.DUREE + main_levee.DIT + 5)
    assert coin.get("/api/main").json()["etat"] == "repos"
    # La lever de nouveau en lève une autre, et range l'ancienne, avec sa phrase.
    deux = lever(coin).json()
    assert deux["etat"] == "levee" and deux["id"] != un
    ancienne = next(d for d in mains_de(j["id"]) if d["id"] == un)
    assert ancienne["statut"] == "retiree" and ancienne["resultat"] == main_levee.RETOMBEE


def test_levee_se_calcule_a_l_identique():
    instant = datetime(2026, 11, 8, 20, 0, 0)
    d = {"genre": "main", "statut": "en-attente", "cree": (instant - timedelta(seconds=10)).isoformat()}
    assert main_levee.levee(d, instant) and main_levee.reste(d, instant) == main_levee.DUREE - 10
    assert not main_levee.levee(d | {"cree": (instant - timedelta(seconds=main_levee.DUREE)).isoformat()}, instant)
    assert not main_levee.levee(d | {"statut": "acceptee"}, instant)
    assert not main_levee.levee(d | {"genre": "message"}, instant)
    assert not main_levee.levee(d | {"cree": "pas une date"}, instant)


# ---------------------------------------------------------------- le MJ répond

def test_donner_la_parole(atelier, coin, invites):
    j = invites("Parole")
    entrer(coin, j)
    m = lever(coin).json()
    [vue] = salle(atelier, j["id"])
    url = f"/api/salle/mains/{j['id']}/{m['id']}"
    assert atelier.post(url, json={"geste": "applaudir", "version": vue["version"]}).status_code == 400
    assert atelier.post(url, json={"geste": "parole"}).status_code == 400
    assert atelier.post(url, json={"geste": "parole", "version": vue["version"] + 1}).status_code == 409
    r = atelier.post(url, json={"geste": "parole", "version": vue["version"]})
    assert r.status_code == 200 and [x for x in r.json()["mains"] if x["joueur"] == j["id"]] == []
    # Le joueur lit « À vous ! » (rendue), une seule fois traitée.
    assert coin.get("/api/main").json()["etat"] == "rendue" and coin.get("/api/main").json()["id"] == m["id"]
    [d] = mains_de(j["id"])
    assert d["statut"] == "acceptee" and d["par"] == "mj"
    assert atelier.post(url, json={"geste": "parole", "version": vue["version"]}).status_code == 409
    assert atelier.post(url, json={"geste": "plus-tard", "version": d["version"]}).status_code == 409


def test_plus_tard_et_main_baissee_entre_temps(atelier, coin, invites):
    j = invites("Plus tard")
    entrer(coin, j)
    m = lever(coin).json()
    [vue] = salle(atelier, j["id"])
    r = atelier.post(f"/api/salle/mains/{j['id']}/{m['id']}", json={"geste": "plus-tard", "version": vue["version"]})
    assert r.status_code == 200
    assert coin.get("/api/main").json()["etat"] == "plus-tard"
    assert next(d for d in mains_de(j["id"]) if d["id"] == m["id"])["statut"] == "refusee"
    # Le joueur baisse sa main pendant que le MJ allait lui donner la parole : refusé, rien ne change.
    m2 = lever(coin).json()
    [vue] = salle(atelier, j["id"])
    baisser(coin)
    r = atelier.post(f"/api/salle/mains/{j['id']}/{m2['id']}", json={"geste": "parole", "version": vue["version"]})
    assert r.status_code == 409 and "baissé" in r.json()["detail"]
    assert coin.get("/api/main").json()["etat"] == "repos"
    # Une demande d'un autre genre ne se traite pas par là.
    mot = coin.post("/api/demandes", json={"genre": "message", "corps": {"texte": "Coucou"}}).json()
    assert atelier.post(f"/api/salle/mains/{j['id']}/{mot['id']}", json={"geste": "parole", "version": 1}).status_code == 404
    assert atelier.post(f"/api/salle/mains/inconnu/{m2['id']}", json={"geste": "parole", "version": 1}).status_code == 404


def test_un_joueur_ne_baisse_pas_la_main_d_un_autre(atelier, coin, un_autre_coin, invites):
    lea, max_ = invites("Léa-main"), invites("Max-main")
    entrer(coin, lea)
    entrer(un_autre_coin, max_)
    m = lever(coin).json()
    # Max ne trouve pas la main de Léa : ni par son identifiant, ni en baissant « la sienne ».
    assert un_autre_coin.delete(f"/api/demandes/{m['id']}").status_code == 404
    assert baisser(un_autre_coin).json()["etat"] == "repos"
    assert coin.get("/api/main").json()["etat"] == "levee"
    assert [d["statut"] for d in mains_de(lea["id"])] == ["en-attente"]
    # Ce que lit Max ne parle que de lui.
    vu_max = json.dumps([un_autre_coin.get("/api/main").json(), un_autre_coin.get("/api/demandes").json()], ensure_ascii=False)
    assert m["id"] not in vu_max and "Léa" not in vu_max and lea["id"] not in vu_max
    # Léa, elle, peut la retirer comme toute demande.
    assert coin.delete(f"/api/demandes/{m['id']}").status_code == 200
    assert coin.get("/api/main").json()["etat"] == "repos"


# ---------------------------------------------------------------- silence, carnet, pause

def test_ni_telegram_ni_boite(atelier, coin, invites, tmp_path):
    j = invites("Silence")
    entrer(coin, j)
    envoyes = []

    class Faux:
        def configure(self):
            return True

        def envoyer(self, texte):
            envoyes.append(texte)
            return True

    async def signaler(_m):
        pass

    b = boite_mod.Boite(config.PROPOSITIONS, tmp_path, joueurs_lus=joueurs_mj.joueurs_lus, nettoyer_mot=lambda m: m, signaler=signaler, telegram=Faux())
    b.file = asyncio.Queue()

    async def vague():
        await b.annoncer()
        sortie = []
        while not b.file.empty():
            sortie.append(b.file.get_nowait())
        return sortie

    assert asyncio.run(vague()) == []
    compte = atelier.get("/api/demandes").json()["compte"]
    lever(coin)
    assert asyncio.run(vague()) == [] and envoyes == []
    # Ni dans la boîte du MJ, ni dans « Mes demandes » du joueur : la main vit dans le Tableau.
    v = atelier.get("/api/demandes").json()
    assert v["compte"] == compte and not any(x["genre"] == "main" for x in v["attente"] + v["historique"])
    assert not any(d["genre"] == "main" for d in coin.get("/api/demandes").json()["demandes"])
    assert demandes.GENRES["main"].silencieux and not demandes.GENRES["main"].carnet
    # Un genre inconnu de cette version (écrit par une plus récente) reste dans la boîte.
    assert demandes.dans_la_liste({"genre": "venu-d-ailleurs"}) and not demandes.dans_la_liste({"genre": "main"})
    # Un mot au MJ, lui, se dit toujours.
    coin.post("/api/demandes", json={"genre": "message", "corps": {"texte": "Ding"}})
    assert len(asyncio.run(vague())) == 1


def test_carnet_ferme_et_pause(atelier, coin, invites):
    j = invites("Fermé")
    entrer(coin, j)
    assert atelier.put("/api/carnet-joueurs", json={"ouvert": False}).json()["ouvert"] is False
    carnet_api.publier_carnet()
    assert coin.get("/api/carnet").json()["ouvert"] is False
    r = lever(coin)
    assert r.status_code == 200 and r.json()["etat"] == "levee"
    assert baisser(coin).status_code == 200
    # Le coin en pause fige la main, comme toute écriture.
    atelier.put("/api/demandes/reglages", json={"pause": True})
    r = lever(coin)
    assert r.status_code == 423 and r.headers["X-Coin-En-Pause"] == "1"
    assert coin.get("/api/main").json()["pause"] is True
    atelier.put("/api/demandes/reglages", json={"pause": False})
    assert lever(coin).status_code == 200


def test_plafond_des_mains(atelier, coin, invites, monkeypatch):
    monkeypatch.setattr(main_levee, "PAR_HEURE", 3)
    j = invites("Plafond")
    entrer(coin, j)
    for _ in range(3):
        assert lever(coin).status_code == 200
        baisser(coin)
    r = lever(coin)
    assert r.status_code == 429 and "main" in r.json()["detail"]
    # Les autres demandes ont leur propre plafond.
    assert coin.post("/api/demandes", json={"genre": "message", "corps": {"texte": "Toujours là"}}).status_code == 200


# ---------------------------------------------------------------- l'atelier le sait tout de suite

def test_l_atelier_le_sait_dans_la_seconde(atelier, coin, invites):
    j = invites("Vite")
    entrer(coin, j)
    recus = []
    with atelier.websocket_connect("/ws/atelier") as ws:
        assert json.loads(ws.receive_text())["type"] == "etat"

        def ecouter():
            while True:
                try:
                    m = json.loads(ws.receive_text())
                except Exception:
                    return
                recus.append((time.monotonic(), m))
                if m.get("type") == "salle" and any(x["joueur"] == j["id"] for x in m["mains"]):
                    return
        t = threading.Thread(target=ecouter, daemon=True)
        t.start()
        time.sleep(0.2)
        debut = time.monotonic()
        lever(coin)
        t.join(3)
        arrivee = next((quand for quand, m in recus if m.get("type") == "salle" and any(x["joueur"] == j["id"] for x in m["mains"])), None)
        assert arrivee is not None, recus
        assert arrivee - debut < 1.0, arrivee - debut
        m = recus[-1][1]
        assert {"type", "mains", "en_ligne", "presence", "signature", "duree"} <= set(m)
        [x] = [x for x in m["mains"] if x["joueur"] == j["id"]]
        assert x["nom"] == "Vite" and x["version"] == 1


def test_le_heros_du_joueur_dans_la_salle(atelier, coin, invites):
    j = invites("Avec héros")
    h = atelier.post("/api/aventuriers", json={"nom": "Brom Lanterne", "genre": "h", "tablee": True, "secret": "SECRET-BROM"}).json()
    try:
        assert atelier.post(f"/api/joueurs/{j['id']}/relier", json={"heros": h["id"]}).status_code == 200
        entrer(coin, j)
        lever(coin)
        [vue] = salle(atelier, j["id"])
        assert vue["heros"] == {"id": h["id"], "nom": "Brom Lanterne"}
        # Le joueur, lui, ne lit que l'état de sa main.
        lu = coin.get("/api/main").json()
        assert set(lu) == {"etat", "id", "reste", "duree", "pause"} and "SECRET" not in json.dumps(lu)
    finally:
        atelier.delete(f"/api/joueurs/{j['id']}/relier")
        atelier.delete(f"/api/aventuriers/{h['id']}")


# ---------------------------------------------------------------- fuites

def test_rien_de_la_salle_hors_de_l_atelier(atelier, coin, invites):
    j = invites("Discret")
    entrer(coin, j)
    lever(coin)
    # Ni la table publique, ni le coin des joueurs ne servent la salle ; le coin sert le bouton et sa feuille.
    assert atelier.get("/api/salle", headers=CF).status_code == 404
    assert atelier.post(f"/api/salle/mains/{j['id']}/000000000000", json={"geste": "parole", "version": 1}, headers=CF).status_code == 404
    assert coin.get("/api/salle").status_code == 404
    for chemin in ("js/salle/salle.js", "js/salle/mains-tableau.js", "js/salle/mains-telecommande.js", "css/salle.css"):
        assert coin.get(f"/static/{chemin}").status_code == 404, chemin
    for chemin in ("js/joueurs/main-levee.js", "css/main-levee.css"):
        assert chemin in joueurs.FICHIERS and coin.get(f"/static/{chemin}").status_code == 200, chemin
    assert 'from "./flux.js"' in coin.get("/static/js/joueurs/main-levee.js").text
    # Sans session, rien.
    with TestClient(joueurs.app) as inconnu:
        assert inconnu.get("/api/main").status_code == 401 and inconnu.post("/api/main", json={}).status_code == 401


def test_la_tv_ne_recoit_pas_la_salle(atelier, coin, invites):
    j = invites("Pas à la TV")
    entrer(coin, j)
    atelier.put("/api/table", json={"vue": "accueil"})
    with atelier.websocket_connect("/ws/table") as tv:
        tv.receive_text()
        lever(coin)
        time.sleep(0.6)
        atelier.put("/api/table", json={"vue": "heros"})
        message = tv.receive_text()
        assert json.loads(message)["type"] == "etat" and "Pas à la TV" not in message and j["id"] not in message
    atelier.put("/api/table", json={"vue": "accueil"})


def test_la_page_table_porte_la_main_levee():
    """« Je veux agir » est aussi sur la page « La table », où les joueurs sont pendant la partie ; les boutons du plan et la
    légende des héros lui laissent sa place (les mesures de 320 à 1366 px se font au navigateur)."""
    statique = Path(__file__).resolve().parent.parent / "app" / "static"
    js = (statique / "js/joueurs/table-coin.js").read_text(encoding="utf-8")
    assert 'import { monter as monterMainLevee } from "./main-levee.js";' in js and "\nmonterMainLevee();" in js
    css = (statique / "css/table-coin.css").read_text(encoding="utf-8")
    assert "body.coin-table.avec-main-levee { padding-bottom: 0; }" in css
    assert ".avec-main-levee .commandes-table {" in css and ".avec-main-levee .legende-coin {" in css
    # Les boutons et la légende se posent dans la case du plan, jamais sur le bandeau du combat.
    assert "grid-template-rows: auto minmax(0, 1fr)" in css
    assert ".scene-table > .legende-coin, .scene-table > .commandes-table { grid-row: 2; grid-column: 1; }" in css


def test_le_bouton_s_efface_pendant_qu_on_ecrit():
    """Au téléphone, le bouton flottant se poserait sur le clavier, juste sur « Envoyer » ou « Proposer au MJ » : il
    s'efface tant qu'un champ a le focus (essayé au navigateur, iPhone et Chrome mobile)."""
    css = (Path(__file__).resolve().parent.parent / "app" / "static" / "css" / "main-levee.css").read_text(encoding="utf-8")
    regle = next(ligne for ligne in css.splitlines() if ligne.startswith("body:has(:is(input"))
    assert "textarea" in regle and "select" in regle and regle.endswith(".main-levee { display: none; }")


def test_le_bouton_ne_revient_pas_sous_le_doigt_qui_envoie():
    """Le champ quitté pour toucher « Envoyer » (posé juste dessous), le bouton ne reparaît qu'un peu après, et jamais tant
    qu'un pointeur reste enfoncé : sinon le relâcher tombe sur lui et le clic est perdu (vu à la souris et dans WebKit ;
    essai au navigateur : v3-essais/main-levee-envoi.mjs)."""
    statique = Path(__file__).resolve().parent.parent / "app" / "static"
    css = (statique / "css" / "main-levee.css").read_text(encoding="utf-8")
    js = (statique / "js" / "joueurs" / "main-levee.js").read_text(encoding="utf-8")
    assert ".main-levee.apres-saisie { display: none; }" in css
    assert 'bloc.classList.add("apres-saisie")' in js and 'bloc.classList.remove("apres-saisie")' in js
    retour = int(re.search(r"const RETOUR_APRES_SAISIE = (\d+);", js).group(1))
    assert 300 <= retour <= 600
    for evenement in ("focusout", "pointerdown", "pointerup", "pointercancel"):
        assert f'document.addEventListener("{evenement}"' in js
