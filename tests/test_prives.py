"""Les billets privés (prives.py, prives_mj.py, lot F2) : un billet secret ou un document part sur le seul téléphone du
joueur concerné, sous la clé de son lien ; il le lit, le MJ le voit lu dans la seconde, et peut le retirer.

Fuite : un joueur ne lit jamais le billet d'un autre (ni par l'API, ni par le disque publié, ni par le flux) ; le nom caché
de l'auberge est masqué ; aucun identifiant de séance, de billet ni de fiche dans ce que lit le joueur ; le dossier n'est
pas servi tel quel ; un document remis à un seul n'entre ni dans « Documents reçus » ni à la TV ; le peuple caché d'un
autre héros ne part pas. Et : plusieurs destinataires, carnet fermé, pause, lien renouvelé, rien vers Telegram."""
import asyncio
import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from commun import carnet  # noqa: E402
from commun import demandes  # noqa: E402
from commun import flux_coin  # noqa: E402
import joueurs  # noqa: E402
from commun import prives  # noqa: E402
from comptes_coin import entrer as entrer_au_coin, jeton_de  # noqa: E402
import main  # noqa: E402
from api import application, carnet_api, config, tv_cartes, tv_fiches  # noqa: E402

CF = {"CF-Connecting-IP": "203.0.113.7"}


def attendre(condition, delai=4.0):
    fin = time.monotonic() + delai
    while time.monotonic() < fin:
        r = condition()
        if r:
            return r
        time.sleep(0.05)
    return None


@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture(scope="module")
def tablee(atelier):
    """Deux joueurs dont les héros sont à la tablée (Ysolde pour Aube, Tavarède pour Basile), un héros sans joueur (Odile),
    un PNJ inconnu ; la tablée de la campagne les nomme. Tout est retiré à la fin."""
    patch = pytest.MonkeyPatch()
    patch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    patch.setattr(joueurs, "COOKIE_SUR", False)
    patch.setattr(joueurs, "HOTES", set())
    patch.setattr(joueurs, "DEMANDES_FAITES", {})
    t = {"pnj": atelier.post("/api/pnj", json={"nom": "Gorvak Sombrefer", "connu": False}).json()}
    for code, nom, heros in (("a", "Aube", "Ysolde Gris"), ("b", "Basile", "Tavarède Brume")):
        invite = atelier.post("/api/joueurs", json={"nom": nom}).json()
        coin = TestClient(joueurs.app)
        entrer_au_coin(coin, invite)
        coin.post("/api/moi/aventurier", json={"nom": heros, "sante": 9, "psy": 5})
        coin.post("/api/moi/envoyer")
        fiche = atelier.post(f"/api/joueurs/{invite['id']}/accueillir").json()
        t[code] = {"joueur": invite, "coin": coin, "heros": fiche}
    t["odile"] = atelier.post("/api/aventuriers", json={"nom": "Odile Sansjoueur", "tablee": True}).json()
    avant = atelier.get("/api/campagne").json()
    rangees = [{"id": "f2-a", "aventurier": t["a"]["heros"]["id"], "personnage": "Ysolde Gris", "joueur": "Aube", "actif": True},
               {"id": "f2-b", "aventurier": t["b"]["heros"]["id"], "personnage": "Tavarède Brume", "joueur": "Basile", "actif": True},
               {"id": "f2-o", "aventurier": t["odile"]["id"], "personnage": "Odile Sansjoueur", "joueur": "", "actif": True}]
    atelier.put("/api/campagne", json={**avant, "tablee": [*(avant.get("tablee") or []), *rangees]})
    yield t
    atelier.put("/api/campagne", json={**atelier.get("/api/campagne").json(), "tablee": avant.get("tablee") or []})
    for code in ("a", "b"):
        t[code]["coin"].close()
        atelier.delete(f"/api/joueurs/{t[code]['joueur']['id']}")
        atelier.delete(f"/api/aventuriers/{t[code]['heros']['id']}")
    atelier.delete(f"/api/aventuriers/{t['odile']['id']}")
    atelier.delete(f"/api/pnj/{t['pnj']['id']}")
    demandes.ecrire_pause(config.PROPOSITIONS, False)
    tv_fiches.billets_prives.ecrire([])
    tv_fiches.billets_prives.publier()
    patch.undo()


@pytest.fixture()
def seance(atelier, tablee):
    """Une séance neuve, ses billets à écrire ; aucun envoi en cours au départ, ni à la fin."""
    tv_fiches.billets_prives.ecrire([])
    tv_fiches.billets_prives.publier()
    crees = []

    def creer(*billets):
        s = atelier.post("/api/seances", json={"nom": "Billets privés", "numero": 91, "deroule": [{"titre": "La porte", "cle": "sc-porte"}],
                                               "billets": [{"id": f"b-{i}", "scene": "sc-porte", "remis": False, "titre": "", **b}
                                                           for i, b in enumerate(billets)]}).json()
        crees.append(s["id"])
        return s
    yield creer
    for ident in crees:
        atelier.delete(f"/api/seances/{ident}")
    tv_fiches.billets_prives.ecrire([])
    tv_fiches.billets_prives.publier()


def envoyer(atelier, s, billet, **en_plus):
    r = atelier.post("/api/prives/billet", json={"seance": s["id"], "billet": billet, **en_plus})
    assert r.status_code == 200, r.text
    return r.json()


def cle(t, code) -> str:
    """La clé de ce joueur, telle que le coin la tire de .acces.json."""
    invites = json.loads((config.PROPOSITIONS / ".acces.json").read_text(encoding="utf-8"))["joueurs"]
    return carnet.cle_heros(next(j["jeton"] for j in invites if j["id"] == t[code]["joueur"]["id"]))


def billets(t, code) -> list:
    r = t[code]["coin"].get("/api/prives")
    assert r.status_code == 200, r.text
    return r.json()["billets"]


# ---------------------------------------------------------------- envoyer, lire, retirer

def test_un_billet_part_sur_le_seul_telephone_de_son_heros(atelier, tablee, seance):
    s = seance({"pour": ["f2-a"], "titre": "Derrière la porte", "texte": "Toi seule entends un murmure."})
    r = envoyer(atelier, s, "b-0")
    assert r["envoyes"] == ["Ysolde"] and r["bloques"] == [] and r["papier"] == [] and r["tous"] is True and r["masque"] is False
    [b] = billets(tablee, "a")
    assert b["nature"] == "billet" and b["texte"] == "Toi seule entends un murmure." and b["titre"] == "Derrière la porte"
    assert b["pour"] == "Ysolde" and b["aussi"] == [] and b["lu"] is None
    # Basile n'en sait rien : ni par l'API, ni par un fichier à lui.
    assert billets(tablee, "b") == []
    assert not (config.PROPOSITIONS / prives.DOSSIER / f"{cle(tablee, 'b')}.json").exists()
    # Ce que lit Aube ne porte ni la séance, ni le billet, ni la fiche, ni la ligne de la tablée.
    publie = (config.PROPOSITIONS / prives.DOSSIER / f"{cle(tablee, 'a')}.json").read_text(encoding="utf-8")
    for ident in (s["id"], '"b-0"', "sc-porte", tablee["a"]["heros"]["id"], "f2-a", tablee["a"]["joueur"]["id"]):
        assert ident not in publie and ident not in json.dumps(b), ident
    assert set(b) == {"id", "nature", "pour", "envoye", "titre", "texte", "aussi", "lu"}
    # Le même billet, renvoyé tel quel, ne repart pas ; retouché, il repart (et sa lecture repart de zéro).
    assert envoyer(atelier, s, "b-0")["inchanges"] == ["Ysolde"]
    tablee["a"]["coin"].post(f"/api/prives/{b['id']}/lu", json={})
    s = atelier.get(f"/api/seances/{s['id']}").json()
    s["billets"][0]["texte"] = "Toi seule entends deux murmures."
    atelier.put(f"/api/seances/{s['id']}", json=s)
    assert envoyer(atelier, s, "b-0")["envoyes"] == ["Ysolde"]
    [b2] = billets(tablee, "a")
    assert b2["id"] != b["id"] and b2["texte"].endswith("deux murmures.") and b2["lu"] is None


def test_un_billet_pour_plusieurs_heros_part_a_chacun(atelier, tablee, seance):
    s = seance({"pour": ["f2-a", "f2-b", "f2-o"], "texte": "Vous trois sentez l'odeur du soufre."})
    r = envoyer(atelier, s, "b-0")
    assert sorted(r["envoyes"]) == ["Tavarède", "Ysolde"] and r["papier"] == ["Odile"] and r["tous"] is False
    [a], [b] = billets(tablee, "a"), billets(tablee, "b")
    assert a["texte"] == b["texte"] and a["id"] != b["id"]
    # Comme le papier : « Aussi remis à … ».
    assert a["pour"] == "Ysolde" and a["aussi"] == ["Tavarède", "Odile"]
    assert b["pour"] == "Tavarède" and b["aussi"] == ["Ysolde", "Odile"]
    # Chacun ne lit que sa copie : Basile ne peut ni noter lu, ni lire celle d'Aube.
    assert tablee["b"]["coin"].post(f"/api/prives/{a['id']}/lu", json={}).status_code == 404
    etat = atelier.get("/api/prives").json()
    assert {x["pour"]: x["lu"] for x in etat["envois"]} == {"Ysolde": None, "Tavarède": None}


def test_sans_joueur_relie_le_billet_reste_sur_papier(atelier, tablee, seance):
    s = seance({"pour": ["f2-o"], "texte": "Pour Odile seule."}, {"pour": ["f2-a"], "texte": "   "}, {"pour": [], "texte": "Pour personne."})
    r = atelier.post("/api/prives/billet", json={"seance": s["id"], "billet": "b-0"})
    assert r.status_code == 409 and "papier" in r.json()["detail"]
    assert atelier.post("/api/prives/billet", json={"seance": s["id"], "billet": "b-1"}).status_code == 400
    assert atelier.post("/api/prives/billet", json={"seance": s["id"], "billet": "b-2"}).status_code == 400
    assert atelier.post("/api/prives/billet", json={"seance": s["id"], "billet": "b-9"}).status_code == 404
    etat = atelier.get("/api/prives").json()
    assert etat["envois"] == []
    # Les héros joignables : ceux d'Aube et de Basile, jamais Odile.
    assert {x["heros"] for x in etat["joignables"]} >= {tablee["a"]["heros"]["id"], tablee["b"]["heros"]["id"]}
    assert tablee["odile"]["id"] not in {x["heros"] for x in etat["joignables"]}
    # Rien de l'état du MJ ne dit le jeton interne des joueurs.
    assert jeton_de(tablee["a"]["joueur"]) not in json.dumps(etat)


def test_lu_puis_retire(atelier, tablee, seance):
    s = seance({"pour": ["f2-a"], "texte": "Un billet lu."})
    envoyer(atelier, s, "b-0")
    [b] = billets(tablee, "a")
    with atelier.websocket_connect("/ws/atelier") as canal:
        canal.receive_text()
        recus = []

        def ecouter():
            fin = time.monotonic() + 3
            while time.monotonic() < fin:
                m = json.loads(canal.receive_text())
                recus.append((time.monotonic(), m))
                if m.get("type") == "prives":
                    return
        fil = threading.Thread(target=ecouter, daemon=True)
        fil.start()
        time.sleep(0.2)
        debut = time.monotonic()
        r = tablee["a"]["coin"].post(f"/api/prives/{b['id']}/lu", json={})
        assert r.status_code == 200 and r.json()["lu"]
        fil.join(3)
        arrivee = next((quand for quand, m in recus if m.get("type") == "prives"), None)
        assert arrivee is not None and arrivee - debut < 1.5, recus
        # Le signal ne porte que sa signature : la page relit l'état.
        assert set(recus[-1][1]) == {"type", "signature"}
    [x] = atelier.get("/api/prives").json()["envois"]
    assert x["lu"] == r.json()["lu"]
    # Une relecture ne change pas l'heure de la première.
    time.sleep(0.01)
    assert tablee["a"]["coin"].post(f"/api/prives/{b['id']}/lu", json={}).json()["lu"] == x["lu"]
    assert billets(tablee, "a")[0]["lu"] == x["lu"]
    # Retiré par le MJ : il disparaît du coin, et sa lecture ne se note plus.
    assert atelier.delete(f"/api/prives/{x['id']}").json()["retire"] == "Ysolde"
    assert billets(tablee, "a") == []
    assert tablee["a"]["coin"].post(f"/api/prives/{b['id']}/lu", json={}).status_code == 404
    assert atelier.delete(f"/api/prives/{x['id']}").status_code == 404
    assert not (config.PROPOSITIONS / prives.DOSSIER / f"{cle(tablee, 'a')}.json").exists()


# ---------------------------------------------------------------- ce qui part, et ce qui ne part pas

def test_le_nom_cache_de_l_auberge_est_masque(atelier, tablee, seance):
    s = seance({"pour": ["f2-a"], "titre": "La Petite Fanfrelée", "texte": "Rendez-vous à la Petite Fanfrelée, ce soir."})
    # Le MJ apprend que le masque a changé son billet.
    assert envoyer(atelier, s, "b-0")["masque"] is True
    [b] = billets(tablee, "a")
    publie = (config.PROPOSITIONS / prives.DOSSIER / f"{cle(tablee, 'a')}.json").read_text(encoding="utf-8")
    for texte in (json.dumps(b, ensure_ascii=False), publie):
        assert "anfrel" not in texte.lower()
    assert "auberge" in b["texte"]


def test_un_inconnu_part_tel_quel_apres_la_question(atelier, tablee, seance):
    s = seance({"pour": ["f2-a"], "texte": "Gorvak Sombrefer t'attend sous le pont."})
    r = envoyer(atelier, s, "b-0")
    assert "question" in r and "Gorvak Sombrefer" in r["question"]["secrets"] and r["question"]["pour"] == ["Ysolde"]
    # Rien n'est parti tant que le MJ n'a pas dit oui.
    assert billets(tablee, "a") == [] and atelier.get("/api/prives").json()["envois"] == []
    r = envoyer(atelier, s, "b-0", confirme=True)
    assert r["envoyes"] == ["Ysolde"]
    # Le billet s'adresse à ce joueur : il le lit tel que le MJ l'a écrit. Les autres n'en savent rien.
    assert billets(tablee, "a")[0]["texte"] == "Gorvak Sombrefer t'attend sous le pont."
    assert billets(tablee, "b") == []


def test_le_peuple_cache_d_un_autre_heros_ne_part_pas(atelier, tablee, seance):
    a = atelier.get(f"/api/aventuriers/{tablee['a']['heros']['id']}").json()
    atelier.put(f"/api/aventuriers/{a['id']}", json={**a, "peuple": "Sylphe des brumes", "peuple_cache": True})
    try:
        s = seance({"pour": ["f2-a", "f2-b"], "texte": "Ysolde est une sylphe des brumes, tu le sens."})
        r = envoyer(atelier, s, "b-0")
        # À Ysolde, son propre secret part ; à Basile, non : c'est le secret d'une autre joueuse.
        assert r["envoyes"] == ["Ysolde"] and [x["pour"] for x in r["bloques"]] == ["Tavarède"]
        assert "Sylphe des brumes" in r["bloques"][0]["raison"]
        assert billets(tablee, "b") == [] and len(billets(tablee, "a")) == 1
        assert not (config.PROPOSITIONS / prives.DOSSIER / f"{cle(tablee, 'b')}.json").exists()
        # L'état du MJ le dit sous le billet, sans rien envoyer.
        assert [x["pour"] for x in atelier.get("/api/prives").json()["envois"]] == ["Ysolde"]
    finally:
        a = atelier.get(f"/api/aventuriers/{a['id']}").json()
        atelier.put(f"/api/aventuriers/{a['id']}", json={**a, "peuple": "", "peuple_cache": False})


def test_un_document_remis_a_un_seul(atelier, tablee, seance):
    image = config.IMAGES / "essai-f2-lettre.png"
    Image.new("RGB", (40, 30), (120, 80, 40)).save(image)
    d = atelier.post("/api/documents", json={"nom": "Lettre de l'intendant", "genre": "lettre", "texte": "Ne faites confiance à personne.",
                                             "signature": "G.", "notes_mj": "NOTE-DU-MJ-F2", "image": f"/media/{image.name}",
                                             "dans_le_carnet": True}).json()
    atelier.put("/api/table", json={"vue": "accueil"})
    try:
        r = atelier.post("/api/prives/document", json={"document": d["id"], "heros": tablee["a"]["heros"]["id"]})
        assert r.status_code == 200 and r.json()["envoyes"] == ["Ysolde"], r.text
        [x] = billets(tablee, "a")
        assert x["nature"] == "document" and x["nom"] == "Lettre de l'intendant" and x["texte"] == "Ne faites confiance à personne."
        assert x["genre"] == "lettre" and x["signature"] == "G." and x["image"].startswith("/prives/media/")
        lu = json.dumps(x)
        assert "NOTE-DU-MJ-F2" not in lu and d["id"] not in lu and image.name not in lu
        # L'image : à Aube seule, jamais par son nom d'atelier, jamais à Basile.
        assert tablee["a"]["coin"].get(x["image"]).status_code == 200
        assert tablee["b"]["coin"].get(x["image"]).status_code == 404
        assert billets(tablee, "b") == []
        # Ni montré à la TV, ni dans « Documents reçus », ni lisible par la table.
        assert atelier.get(f"/api/documents/{d['id']}").json().get("montre") in (None, "")
        assert atelier.get("/api/table").json().get("vue") == "accueil"
        ouvert = carnet_api.carnet_ouvert()
        atelier.put("/api/carnet-joueurs", json={"ouvert": True})
        carnet_api.publier_carnet()
        recus = tablee["a"]["coin"].get("/api/carnet").json()["documents"]
        atelier.put("/api/carnet-joueurs", json={"ouvert": ouvert})
        assert "Lettre de l'intendant" not in json.dumps(recus, ensure_ascii=False)
        assert atelier.get(f"/api/table/document/{tv_cartes.jeton('documents', d['id'])}").status_code == 404
        # Un héros sans joueur : rien.
        assert atelier.post("/api/prives/document", json={"document": d["id"], "heros": tablee["odile"]["id"]}).status_code == 409
        # Retiré : l'image s'en va avec lui.
        nom = x["image"].rsplit("/", 1)[1]
        [envoi] = atelier.get("/api/prives").json()["envois"]
        atelier.delete(f"/api/prives/{envoi['id']}")
        assert not (config.PROPOSITIONS / prives.DOSSIER / prives.MEDIA / nom).exists()
        assert tablee["a"]["coin"].get(x["image"]).status_code == 404
    finally:
        atelier.delete(f"/api/documents/{d['id']}")
        image.unlink(missing_ok=True)


# ---------------------------------------------------------------- le coin, ce qu'il sert et ce qu'il ne sert pas

def test_le_dossier_n_est_pas_servi_tel_quel(atelier, tablee, seance):
    s = seance({"pour": ["f2-a"], "texte": "Rien qu'à toi."})
    envoyer(atelier, s, "b-0")
    ca, cb = cle(tablee, "a"), cle(tablee, "b")
    for coin in (tablee["a"]["coin"], tablee["b"]["coin"]):
        for chemin in (f"/prives/{ca}.json", f"/propositions/prives/{ca}.json", f"/static/../prives/{ca}.json", "/prives/",
                       f"/carnet/prives/{ca}.json", "/prives-lus/aube.json", f"/static/prives/{ca}.json", "/api/prives/" + ca,
                       f"/prives/media/{ca[:24]}.jpg", "/prives/media/..%2F..%2F.acces.json"):
            assert coin.get(chemin).status_code in (404, 405), chemin
    with TestClient(joueurs.app) as inconnu:
        assert inconnu.get("/api/prives").status_code == 401
        assert inconnu.post(f"/api/prives/{'0' * 24}/lu", json={}).status_code == 401
    assert cb != ca


def test_ni_la_table_publique_ni_la_tv(atelier, tablee, seance):
    s = seance({"pour": ["f2-a"], "texte": "TEXTE-PRIVE-F2"})
    assert atelier.get("/api/prives", headers=CF).status_code == 404
    assert atelier.post("/api/prives/billet", json={"seance": s["id"], "billet": "b-0"}, headers=CF).status_code == 404
    atelier.put("/api/table", json={"vue": "accueil"})
    with atelier.websocket_connect("/ws/table") as tv:
        tv.receive_text()
        envoyer(atelier, s, "b-0")
        atelier.put("/api/table", json={"vue": "heros"})
        message = tv.receive_text()
        assert json.loads(message)["type"] == "etat" and "TEXTE-PRIVE-F2" not in message
    atelier.put("/api/table", json={"vue": "accueil"})


def test_les_modules_du_coin(tablee):
    coin = tablee["a"]["coin"]
    for chemin in ("js/joueurs/prives.js", "css/prives-coin.css"):
        assert chemin in joueurs.FICHIERS and coin.get(f"/static/{chemin}").status_code == 200
    for chemin in ("js/prives/telephone.js", "css/prives-atelier.css"):
        assert chemin not in joueurs.FICHIERS and coin.get(f"/static/{chemin}").status_code == 404
    statique = Path(joueurs.__file__).resolve().parent / "static"
    assert 'import { monter as monterBillets } from "./prives.js";' in (statique / "js/joueurs/table-coin.js").read_text(encoding="utf-8")
    assert "mesBillets.section(" in (statique / "js/joueurs/carnet.js").read_text(encoding="utf-8")


def test_carnet_ferme_les_billets_passent(atelier, tablee, seance):
    avant = carnet_api.carnet_ouvert()
    atelier.put("/api/carnet-joueurs", json={"ouvert": False})
    try:
        s = seance({"pour": ["f2-a"], "texte": "Pendant la séance, carnet fermé."})
        envoyer(atelier, s, "b-0")
        assert tablee["a"]["coin"].get("/api/carnet").json()["ouvert"] is False
        [b] = billets(tablee, "a")
        assert tablee["a"]["coin"].post(f"/api/prives/{b['id']}/lu", json={}).status_code == 200
    finally:
        atelier.put("/api/carnet-joueurs", json={"ouvert": avant})


def test_en_pause_on_lit_et_la_lecture_se_note(atelier, tablee, seance):
    s = seance({"pour": ["f2-a"], "texte": "Lu pendant la pause."})
    envoyer(atelier, s, "b-0")
    demandes.ecrire_pause(config.PROPOSITIONS, True)
    try:
        coin = tablee["a"]["coin"]
        r = coin.get("/api/prives").json()
        assert r["pause"] is True and len(r["billets"]) == 1
        assert coin.post(f"/api/prives/{r['billets'][0]['id']}/lu", json={}).status_code == 200
        # Le reste du jeu, lui, est figé.
        assert coin.post("/api/demandes", json={"genre": "message", "corps": {"texte": "Bonjour"}}).status_code == 423
    finally:
        demandes.ecrire_pause(config.PROPOSITIONS, False)


def test_rien_vers_telegram_ni_la_boite(atelier, tablee, seance):
    s = seance({"pour": ["f2-a"], "texte": "Silencieux."})
    envoyer(atelier, s, "b-0")
    [b] = billets(tablee, "a")
    tablee["a"]["coin"].post(f"/api/prives/{b['id']}/lu", json={})
    # Ni demande, ni boîte : c'est le MJ qui envoie, il n'y a rien à lui notifier.
    assert demandes.lire(config.PROPOSITIONS, tablee["a"]["joueur"]["id"]) == []
    assert not [x for x in atelier.get("/api/demandes").json()["attente"] if x["joueur"] == tablee["a"]["joueur"]["id"]]


def test_un_nouveau_provisoire_garde_ses_billets(atelier, tablee, seance):
    """Depuis les mots de passe provisoires, le jeton du joueur ne change plus : un nouveau provisoire coupe
    ses sessions, ses billets restent rangés sous la même clé et il les retrouve en se reconnectant."""
    s = seance({"pour": ["f2-b"], "texte": "Pour Basile, même après un nouveau mot de passe."})
    envoyer(atelier, s, "b-0")
    avant = cle(tablee, "b")
    j = tablee["b"]["joueur"]
    assert atelier.post(f"/api/joueurs/{j['id']}/provisoire", json={}).status_code == 200
    tv_fiches.billets_prives.publier()
    assert cle(tablee, "b") == avant and (config.PROPOSITIONS / prives.DOSSIER / f"{avant}.json").exists()
    assert tablee["b"]["coin"].get("/api/prives").status_code == 401
    coin = TestClient(joueurs.app)
    entrer_au_coin(coin, j)
    tablee["b"]["coin"].close()
    tablee["b"]["coin"] = coin
    assert [b["texte"] for b in billets(tablee, "b")] == ["Pour Basile, même après un nouveau mot de passe."]


# ---------------------------------------------------------------- le flux

def test_le_flux_ne_le_dit_qu_au_joueur_concerne(tmp_path):
    """Le fichier publié porte la clé du lien : le flux la rapporte à son joueur, et ne pousse « prives » qu'à lui."""
    assert flux_coin.sujet_du_fichier((prives.DOSSIER, "a" * 32 + ".json")) == ("cle:" + "a" * 32, "prives")
    assert flux_coin.sujet_du_fichier((prives.DOSSIER, "media", "x.json")) is None
    assert flux_coin.sujet_du_fichier((prives.DOSSIER, "ab.json")) is None
    assert flux_coin.sujet_du_fichier((prives.LUS, "lea.json")) == ("lea", "prives")

    async def essai():
        f = flux_coin.Flux(lambda: tmp_path)
        f.joueurs_des_cles = lambda: {"a" * 32: "lea", "b" * 32: "max"}
        lea, max_ = f.ouvrir("lea"), f.ouvrir("max")
        f.connu = {}
        prives.publier(tmp_path, {"a" * 32: [{"id": "1" * 24, "nature": "billet", "texte": "x", "envoye": "2026-11-08T21:02:00"}]}, {})
        await f.relire()
        recus = {"lea": [], "max": []}
        for nom, q in (("lea", lea), ("max", max_)):
            while not q.empty():
                recus[nom].append(q.get_nowait())
        # Une clé inconnue (un joueur retiré) ne se dit à personne.
        prives.publier(tmp_path, {"c" * 32: [{"id": "2" * 24, "nature": "billet", "texte": "y", "envoye": "2026-11-08T21:03:00"}]}, {})
        await f.relire()
        restes = [q.get_nowait() for q in (lea, max_) if not q.empty()]
        return recus, restes

    recus, restes = asyncio.run(essai())
    assert recus == {"lea": ["prives"], "max": []}
    # Le fichier de Léa retiré la concerne, celui de la clé inconnue personne.
    assert restes == ["prives"]


def test_le_flux_pousse_le_billet_vers_la_page(atelier, tablee, seance, monkeypatch):
    monkeypatch.setattr(flux_coin, "BATTEMENT", 0.2)
    monkeypatch.setattr(flux_coin, "DUREE_MAX", 2.5)
    s = seance({"pour": ["f2-b"], "texte": "BILLET-DE-BASILE"}, {"pour": ["f2-a"], "texte": "BILLET-D-AUBE"})

    def plus_tard():
        time.sleep(0.6)
        envoyer(atelier, s, "b-0")
        time.sleep(0.6)
        envoyer(atelier, s, "b-1")
    fil = threading.Thread(target=plus_tard)
    fil.start()
    r = tablee["a"]["coin"].get("/api/flux")
    fil.join()
    lignes = [x for x in r.text.splitlines() if x.startswith("data:")]
    # Aube n'apprend que son propre billet, et le flux n'en porte que le sujet.
    assert lignes.count("data: prives") == 1, r.text
    assert "BILLET" not in r.text
    joueurs.FLUX.abonnes.clear()


def test_les_bornes_du_fichier_publie(tmp_path):
    """Un fichier publié est relu champ par champ : un champ inconnu ne sort pas, une image hors de prives/media non plus."""
    cle_ = "d" * 32
    prives.publier(tmp_path, {cle_: [{"id": "3" * 24, "nature": "billet", "texte": "ok", "envoye": "2026-11-08T21:00:00",
                                      "seance": "SEANCE", "heros": "HEROS"},
                                     {"id": "4" * 24, "nature": "document", "texte": "doc", "envoye": "2026-11-08T21:01:00",
                                      "image": "/media/secret.png", "notes_mj": "NOTE"},
                                     {"id": "pas-un-id", "nature": "billet", "texte": "non", "envoye": "x"}]}, {})
    lu = prives.lire(tmp_path, cle_)
    assert [x["id"] for x in lu] == ["4" * 24, "3" * 24]
    assert "SEANCE" not in json.dumps(lu) and "NOTE" not in json.dumps(lu) and lu[0]["image"] is None
    assert prives.lire(tmp_path, "../" + cle_) == [] and prives.lire(tmp_path, "") == []
    with pytest.raises(KeyError):
        prives.noter_lu(tmp_path, "lea", "5" * 24, {"3" * 24})
    with pytest.raises(ValueError):
        prives.noter_lu(tmp_path, "../x", "3" * 24, {"3" * 24})
