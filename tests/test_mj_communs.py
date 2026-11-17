"""Ce qui reste commun aux deux MJ : le canal des pages de l'atelier (/ws/atelier) adressé, un relais de
télécommande par MJ, la main sur la TV (« par », la question « La reprendre ? »), la boîte des demandes avec destinataire
(« Un mot au MJ » adressé par le joueur, un déplacement au MJ du plan, une commande à l'auteur de la boutique, « Pour le
MJ seulement » toujours au principal, Telegram pour lui seul), les horloges par auteur.

Avec Léa, une MJ invitée (tests/deux_mj.py), en strict : des canaris dans les deux sens par chaque canal ; rien de l'un
n'arrive chez l'autre. Sans invité, rien ne change : ni « par », ni choix de destinataire au coin, ni question."""
import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import anyio  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from mj import adresses  # noqa: E402
from commun import carnet  # noqa: E402
from mj import cloisonnement  # noqa: E402
from mj import comptes_mj  # noqa: E402
from commun import demandes  # noqa: E402
from commun import deplacement  # noqa: E402
import deux_mj  # noqa: E402
import joueurs  # noqa: E402
import main  # noqa: E402
from table import telecommande  # noqa: E402
from api import application, commandes_api, config, pilotage, tv_boutique_combat, tv_cartes, tv_ecran, tv_etat, tv_fiches, utilitaires  # noqa: E402
from comptes_coin import entrer as entrer_au_coin  # noqa: E402

CANARI = {"alban": "CANARI-ALBAN", "lea": "CANARI-LEA"}
SUIVIS = ("table.json", "prives.json", "demandes-vues.json")
DESTINATAIRES = config.PROPOSITIONS / demandes.DOSSIER / demandes.DESTINATAIRES


@pytest.fixture(scope="module")
def appli():
    avant = {f for f in config.DONNEES.rglob("*") if f.is_file()}
    suivis = {n: (config.DONNEES / n).read_bytes() if (config.DONNEES / n).exists() else None for n in SUIVIS}
    with TestClient(application.app) as client:
        yield client
    for n, contenu in suivis.items():
        if contenu is None:
            (config.DONNEES / n).unlink(missing_ok=True)
        else:
            (config.DONNEES / n).write_bytes(contenu)
    for f in sorted({f for f in config.DONNEES.rglob("*") if f.is_file()} - avant, reverse=True):
        f.unlink(missing_ok=True)


@pytest.fixture(params=[cloisonnement.VEILLE, cloisonnement.STRICT])
def mode(request, monkeypatch):
    monkeypatch.setattr(cloisonnement, "MODE", request.param)
    cloisonnement.oublier()
    yield request.param
    cloisonnement.oublier()


@pytest.fixture
def strict(monkeypatch):
    monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.STRICT)
    cloisonnement.oublier()
    yield
    cloisonnement.oublier()


@pytest.fixture
def deux(appli, monkeypatch):
    alban, lea = deux_mj.ouvrir(monkeypatch)
    # Chaque essai part d'une TV à l'accueil, la main au principal.
    utilitaires.ecrire(config.TABLE, {"vue": "accueil"})
    yield appli, alban, lea
    utilitaires.ecrire(config.TABLE, {"vue": "accueil"})
    DESTINATAIRES.unlink(missing_ok=True)
    deux_mj.fermer()


@pytest.fixture
def coin(monkeypatch):
    monkeypatch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    monkeypatch.setattr(joueurs, "COOKIE_SUR", False)
    monkeypatch.setattr(joueurs, "HOTES", set())
    monkeypatch.setattr(joueurs, "DEMANDES_FAITES", {})
    with TestClient(joueurs.app) as c:
        yield c


@pytest.fixture
def joueur(appli):
    """Un joueur invité au coin, retiré à la fin (ses demandes et ses commandes partent avec lui)."""
    crees = []

    def inviter(nom, h=None):
        j = appli.post("/api/joueurs", json={"nom": nom}, headers=h or {}).json()
        crees.append((j["id"], h))
        return j
    yield inviter
    for ident, h in crees:
        (config.PROPOSITIONS / demandes.DOSSIER / f"{ident}.json").unlink(missing_ok=True)
        carnet.ecrire_commandes(config.PROPOSITIONS, ident, [])
        appli.delete(f"/api/joueurs/{ident}", headers=h or {})


def creer(client, collection, fiche, h):
    r = client.post(f"/api/{collection}", json=fiche, headers=h)
    assert r.status_code == 200, (collection, r.text)
    return r.json()["id"]


def recevoir(ws, delai=5.0):
    """Le prochain message du WebSocket, ou une erreur passé le délai (un message attendu qui n'arrive pas)."""
    async def lire():
        with anyio.fail_after(delai):
            return await ws._send_rx.receive()
    return json.loads(ws.portal.call(lire)["text"])


def jusqu_au_temoin(ws, temoin) -> list:
    """Les messages reçus avant le témoin : un état de la table dont le cadrage porte ce nombre (envoyé à toutes les pages
    après les gestes de l'essai : tout ce qui devait leur arriver est arrivé avant lui)."""
    vus = []
    while True:
        m = recevoir(ws)
        if m.get("type") == "etat" and (m["etat"].get("camera") or {}).get("temoin") == temoin:
            return vus
        vus.append(m)


def poser_temoin(client, h, temoin):
    """Un cadrage seul : la main ne change pas, toutes les pages reçoivent l'état."""
    etat = {k: v for k, v in tv_ecran.etat_table().items() if k not in ("maj", "par")}
    r = client.put("/api/table", json={**etat, "camera": {"temoin": temoin}}, headers=h)
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------- sans invité, rien ne change

def test_sans_invite_rien_ne_change(appli, coin, joueur, mode):
    """Alban seul (le LAN, comme aujourd'hui) : la table sans « par », le canal sans « par », aucune question ; le coin
    sans choix de destinataire, et un mot adressé à un autre MJ refusé ; la liste des MJ n'est pas publiée."""
    deux_mj.fermer()
    utilitaires.ecrire(config.TABLE, {"vue": "accueil"})
    assert adresses.ouverts(config.DONNEES) == [{"id": "alban", "nom": "Alban"}]
    r = appli.put("/api/table", json={"vue": "heros"})
    assert r.status_code == 200
    assert "par" not in tv_ecran.etat_table() and "par" not in appli.get("/api/table").json()
    assert "par_nom" not in appli.get("/api/table").json()
    with appli.websocket_connect("/ws/atelier") as ws:
        assert "par" not in recevoir(ws)["etat"]
    asyncio.run(commandes_api.boite.annoncer())
    assert not DESTINATAIRES.exists()
    j = joueur("Solo")
    entrer_au_coin(coin, j)
    lu = coin.get("/api/demandes").json()
    assert "destinataires" not in lu
    assert coin.post("/api/demandes", json={"genre": "message", "corps": {"texte": "Bonjour", "mj": "lea"}}).status_code == 409
    # Choisir le principal par son nom revient à ne rien choisir : le corps reste celui d'avant.
    r = coin.post("/api/demandes", json={"genre": "message", "corps": {"texte": "Bonjour", "mj": "alban"}})
    assert r.status_code == 200 and r.json()["corps"] == {"texte": "Bonjour"}
    v = appli.get("/api/demandes").json()
    assert {"telegram", "telegram_configure", "pause"} <= set(v) and all("_pour" not in x for x in v["attente"] + v["historique"])
    assert any(x["joueur"] == j["id"] for x in v["attente"])
    utilitaires.ecrire(config.TABLE, {"vue": "accueil"})
    assert cloisonnement.vues() == []


# ---------------------------------------------------------------- la main sur la TV

def test_la_main_sur_la_tv(deux, mode):
    client, alban, lea = deux
    plan_a = creer(client, "plans", {"nom": f"{CANARI['alban']} plan"}, alban)
    plan_l = creer(client, "plans", {"nom": f"{CANARI['lea']} plan"}, lea)
    try:
        assert client.put("/api/table", json={"vue": "plan", "plan": plan_a}, headers=alban).status_code == 200
        assert "par" not in tv_ecran.etat_table()
        # Léa voit qu'Alban a la main ; Alban ne voit rien de plus qu'avant.
        t = client.get("/api/table", headers=lea).json()
        assert (t["par"], t["par_nom"]) == ("alban", "Alban")
        assert "par" not in client.get("/api/table", headers=alban).json()
        # Changer l'écran : la question d'abord, puis la main passe à Léa.
        r = client.put("/api/table", json={"vue": "plan", "plan": plan_l}, headers=lea)
        assert r.status_code == 409 and r.json()["question"] == {"genre": "main-tv", "par": "alban", "nom": "Alban"}
        assert tv_ecran.etat_table()["plan"] == plan_a
        assert client.put("/api/table", json={"vue": "plan", "plan": plan_l, "reprendre": True}, headers=lea).status_code == 200
        assert tv_ecran.etat_table()["par"] == "lea" and "reprendre" not in tv_ecran.etat_table()
        t = client.get("/api/table", headers=alban).json()
        assert (t["par"], t["par_nom"]) == ("lea", "Léa") and CANARI["lea"] not in json.dumps(t)
        assert "par" not in client.get("/api/table", headers=lea).json()
        # Rien de nouveau à la TV ni à la table publique.
        assert "par" not in tv_etat.etat_public(tv_ecran.etat_table())
        with client.websocket_connect("/ws/table", headers={"Host": "testserver"}) as ws:
            m = recevoir(ws)
            assert m["type"] == "etat" and "par" not in m["etat"] and "par_nom" not in m["etat"]
        # Un cadrage, une version : la main ne bouge pas, sans question (l'éditeur d'Alban relit la table et la renvoie).
        renvoyee = {k: v for k, v in client.get("/api/table", headers=alban).json().items() if k in tv_boutique_combat.CLES_TABLE or k in tv_boutique_combat.REFS_TABLE}
        assert client.put("/api/table", json={**renvoyee, "camera": {"x": 3}}, headers=alban).status_code == 200
        assert tv_ecran.etat_table()["par"] == "lea" and tv_ecran.etat_table()["plan"] == plan_l
        # Une page qui renvoie « par » ou « par_nom » ne choisit pas qui a la main ; « reprendre », si.
        assert client.put("/api/table", json={**renvoyee, "par": "alban", "par_nom": "Alban"}, headers=alban).status_code == 200
        assert tv_ecran.etat_table()["par"] == "lea"
        assert client.put("/api/table", json={**renvoyee, "reprendre": True}, headers=alban).status_code == 200
        assert "par" not in tv_ecran.etat_table()
        assert client.put("/api/table", json={**renvoyee, "reprendre": True}, headers=lea).status_code == 200
        assert tv_ecran.etat_table()["par"] == "lea"
        # Alban la reprend : « par » disparaît (absent : le principal), l'état de la table redevient celui d'avant.
        assert client.put("/api/table", json={"vue": "accueil"}, headers=alban).status_code == 409
        assert client.put("/api/table", json={"vue": "accueil", "reprendre": True}, headers=alban).status_code == 200
        assert "par" not in tv_ecran.etat_table() and "par" not in client.get("/api/table", headers=alban).json()
        # Un compte fermé ne tient plus la main : pas de question.
        assert client.put("/api/table", json={"vue": "heros", "reprendre": True}, headers=lea).status_code == 200
        with comptes_mj.verrou(config.DONNEES):
            etat = comptes_mj.lire(config.DONNEES)
            comptes_mj.par_id(etat, "lea")["ferme"] = comptes_mj.maintenant()
            comptes_mj.ecrire(config.DONNEES, etat)
        assert "par" not in client.get("/api/table", headers=alban).json()
        assert client.put("/api/table", json={"vue": "accueil"}, headers=alban).status_code == 200
    finally:
        for p in (plan_a, plan_l):
            (config.PLANS / f"{p}.json").unlink(missing_ok=True)


def test_montrer_son_combat_prend_la_main(deux, strict):
    client, alban, lea = deux
    s = creer(client, "seances", {"nom": "Séance de Léa"}, lea)
    try:
        assert client.put(f"/api/seances/{s}/combat", json={"version_base": None, "ordre": []}, headers=lea).status_code == 200
        r = client.put(f"/api/seances/{s}/combat/tv", json={"montrer": True}, headers=lea)
        assert r.status_code == 409 and r.json()["question"]["par"] == "alban"
        assert "combat" not in tv_ecran.etat_table()
        assert client.put(f"/api/seances/{s}/combat/tv", json={"montrer": True, "reprendre": True}, headers=lea).status_code == 200
        assert tv_ecran.etat_table()["combat"] == s and tv_ecran.etat_table()["par"] == "lea"
        # Le retirer ne prend rien.
        assert client.put(f"/api/seances/{s}/combat/tv", json={"montrer": False}, headers=lea).status_code == 200
        assert tv_ecran.etat_table()["par"] == "lea"
    finally:
        (config.SEANCES / f"{s}.json").unlink(missing_ok=True)


# ---------------------------------------------------------------- le canal des pages de l'atelier

def test_le_canal_des_pages_est_adresse(deux, strict):
    """Les deux reçoivent ce que montre la TV ; le combat d'une séance, la boîte d'un MJ et les pions bougés sur son plan
    ne partent qu'à ses pages."""
    client, alban, lea = deux
    seances = {qui: creer(client, "seances", {"nom": f"{CANARI[qui]} séance"}, h) for qui, h in (("alban", alban), ("lea", lea))}
    try:
        with client.websocket_connect("/ws/atelier", headers=alban) as wa, client.websocket_connect("/ws/atelier", headers=lea) as wl:
            assert recevoir(wa)["type"] == "etat" and recevoir(wl)["type"] == "etat"
            for qui, h in (("alban", alban), ("lea", lea)):
                r = client.put(f"/api/seances/{seances[qui]}/combat", json={"version_base": None, "ordre": []}, headers=h)
                assert r.status_code == 200
            # Léa prend la main : toutes les pages le savent (« par »), la TV non.
            assert client.put("/api/table", json={"vue": "heros", "reprendre": True}, headers=lea).status_code == 200
            poser_temoin(client, alban, 1)
            recus = {"alban": jusqu_au_temoin(wa, 1), "lea": jusqu_au_temoin(wl, 1)}
            for qui, autre in (("alban", "lea"), ("lea", "alban")):
                assert any(m["type"] == "etat" and m["etat"].get("par") == "lea" and m["etat"].get("vue") == "heros" for m in recus[qui])
                combats = [m["seance"] for m in recus[qui] if m["type"] == "combat"]
                assert seances[qui] in combats and seances[autre] not in combats, (qui, recus[qui])
                assert CANARI[autre] not in json.dumps(recus[qui], ensure_ascii=False)
    finally:
        for s in seances.values():
            (config.SEANCES / f"{s}.json").unlink(missing_ok=True)


def test_les_signaux_des_modules_vont_a_leur_mj(deux, strict, monkeypatch):
    """Les pions bougés sur un plan vont à son MJ ; une commande à l'échoppe, un déplacement : à l'auteur du plan ou de la
    boutique. Un plan disparu, une boutique inconnue : au principal."""
    client, alban, lea = deux
    plan_l = creer(client, "plans", {"nom": "Plan de Léa"}, lea)
    plan_a = creer(client, "plans", {"nom": "Plan d'Alban"}, alban)
    boutique_l = creer(client, "boutiques", {"nom": "Boutique de Léa"}, lea)
    envoyes = []

    async def noter(message, pour=None):
        envoyes.append((message.get("plan"), pour))
    monkeypatch.setattr(commandes_api, "signaler_demandes", noter)
    try:
        asyncio.run(tv_etat.signaler_plan({"type": "plan", "plan": plan_l, "mouvements": []}))
        asyncio.run(tv_etat.signaler_plan({"type": "plan", "plan": plan_a, "mouvements": []}))
        assert envoyes == [(plan_l, "lea"), (plan_a, "alban")]
        corps = lambda p: {"corps": {"plan": tv_cartes.jeton("plans", p)}}  # noqa: E731
        assert tv_etat.destinataire_deplacement({}, corps(plan_l)) == "lea"
        assert tv_etat.destinataire_deplacement({}, corps(plan_a)) == "alban"
        assert tv_etat.destinataire_deplacement({}, {"corps": {"plan": "0" * 20}}) == "alban"
        assert commandes_api.destinataire_commande({"boutique": tv_cartes.jeton("boutiques", boutique_l)}) == "lea"
        assert commandes_api.destinataire_commande({"boutique": "f" * 20}) == "alban"
        # « Annuler » un déplacement relit le plan comme le lit son MJ (le cas relevé au lot MJ-3) : Léa le trouve, Alban non.
        for qui, attendu in (("lea", True), ("alban", False)):
            jeton = cloisonnement.poser_lecteur(qui)
            try:
                assert (tv_etat.plan_par_id(plan_l) is not None) is attendu
            finally:
                cloisonnement.retirer_lecteur(jeton)
    finally:
        for chemin in (config.PLANS / f"{plan_l}.json", config.PLANS / f"{plan_a}.json", config.BOUTIQUES / f"{boutique_l}.json"):
            chemin.unlink(missing_ok=True)


def test_les_billets_prives_previennent_leur_mj(deux, strict, monkeypatch):
    f = tv_fiches.billets_prives.fichier
    avant = f.read_bytes() if f.exists() else None
    envoyes = []

    async def noter(message, pour=None):
        envoyes.append((message["type"], pour))
    monkeypatch.setattr(tv_fiches.billets_prives, "signaler", noter)
    monkeypatch.setattr(tv_fiches.billets_prives, "signatures", {})
    billet = lambda i, qui: {"id": i * 24, "nature": "billet", "joueur": "x", "pour": "Bix", "titre": "Billet",  # noqa: E731
                             "texte": CANARI[qui], "envoye": i, **({"auteur": qui} if qui != "alban" else {})}
    try:
        tv_fiches.billets_prives.ecrire([billet("a", "alban")])
        asyncio.run(tv_fiches.billets_prives.annoncer_a_chacun())
        assert envoyes == []  # le premier passage ne dit rien
        tv_fiches.billets_prives.ecrire([billet("a", "alban"), billet("b", "lea")])
        asyncio.run(tv_fiches.billets_prives.annoncer_a_chacun())
        assert envoyes == [("prives", "lea")]
        tv_fiches.billets_prives.ecrire([billet("b", "lea"), billet("c", "alban")])
        envoyes.clear()
        asyncio.run(tv_fiches.billets_prives.annoncer_a_chacun())
        assert envoyes == [("prives", "alban")]
    finally:
        if avant is None:
            f.unlink(missing_ok=True)
        else:
            f.write_bytes(avant)


# ---------------------------------------------------------------- le relais de la télécommande

def test_le_relais_de_chacun(deux, strict, monkeypatch):
    """Chaque MJ son relais : son téléphone ne voit que les écrans de son atelier et leurs plans, ne confie ses commandes
    qu'à eux, et ne lit pas celles de l'autre."""
    client, alban, lea = deux
    monkeypatch.setattr(pilotage, "relais", telecommande.Relais())
    monkeypatch.setattr(pilotage, "relais_des_invites", {})
    plans = {qui: creer(client, "plans", {"nom": f"{CANARI[qui]} plan", "etapes": [{"nom": "un"}, {"nom": "deux"}]}, h)
             for qui, h in (("alban", alban), ("lea", lea))}
    seance_l = creer(client, "seances", {"nom": f"{CANARI['lea']} séance", "deroule": [{"titre": "a"}, {"titre": f"{CANARI['lea']} scène"}]}, lea)
    ecrans = {"alban": "ecranalban01", "lea": "ecranlea0001"}
    musique = {"courante": "ambiance-une", "nom": "Une", "titre": "", "enPause": False, "liste": True, "joue": True}
    try:
        for qui, h in (("alban", alban), ("lea", lea)):
            r = client.post("/api/telecommande/releve", json={"ecran": ecrans[qui], "plan": plans[qui], "musique": musique}, headers=h)
            assert r.json() == {"commandes": []}
        for qui, autre, h in (("alban", "lea", alban), ("lea", "alban", lea)):
            etat = client.get("/api/telecommande", headers=h).json()
            assert etat["ecrans"] == 1 and etat["plans"] == [plans[qui]], (qui, etat)
        # Une étape sur le plan de l'autre : comme un plan qui n'existe pas.
        assert client.post("/api/telecommande/commandes", json={"genre": "etape", "plan": plans["alban"], "etape": 1}, headers=lea).status_code == 404
        # La scène suivante de Léa ne va qu'à son atelier ; Alban n'en voit rien, ni le titre.
        r = client.post("/api/telecommande/commandes", json={"genre": "scene", "seance": seance_l, "de": 0, "vers": 1,
                                                              "titre": f"{CANARI['lea']} scène"}, headers=lea).json()
        assert r["relais"] is True
        numero = r["numero"]
        recue = client.post("/api/telecommande/releve", json={"ecran": ecrans["alban"], "plan": plans["alban"], "musique": musique},
                            headers=alban).json()
        assert recue == {"commandes": []}
        assert client.get(f"/api/telecommande/commandes/{numero}", headers=alban).status_code == 404
        assert client.delete(f"/api/telecommande/commandes/{numero}", headers=alban).status_code == 404
        # Même un écran d'Alban qui prendrait le nom de celui de Léa ne relève rien chez elle.
        recue = client.post("/api/telecommande/releve", json={"ecran": ecrans["lea"]}, headers=alban).json()
        assert recue == {"commandes": []}
        recue = client.post("/api/telecommande/releve", json={"ecran": ecrans["lea"], "plan": plans["lea"]}, headers=lea).json()
        assert [c["numero"] for c in recue["commandes"]] == [numero]
        assert client.post(f"/api/telecommande/commandes/{numero}/resultat", json={"ecran": ecrans["lea"], "ok": True}, headers=alban).json() == {"pris": False}
        # La musique d'Alban joue sur son Mac : sa commande y va, pas chez Léa.
        r = client.post("/api/telecommande/commandes", json={"genre": "musique", "action": "pause"}, headers=alban).json()
        recue = client.post("/api/telecommande/releve", json={"ecran": ecrans["lea"], "plan": plans["lea"], "musique": musique}, headers=lea).json()
        assert all(c["numero"] != r["numero"] for c in recue["commandes"])
        recue = client.post("/api/telecommande/releve", json={"ecran": ecrans["alban"], "musique": musique}, headers=alban).json()
        assert [c["numero"] for c in recue["commandes"]] == [r["numero"]]
        assert CANARI["lea"] not in json.dumps(recue) and CANARI["lea"] not in client.get("/api/telecommande", headers=alban).text
        assert CANARI["alban"] not in client.get("/api/telecommande", headers=lea).text
    finally:
        for p in plans.values():
            (config.PLANS / f"{p}.json").unlink(missing_ok=True)
        (config.SEANCES / f"{seance_l}.json").unlink(missing_ok=True)


# ---------------------------------------------------------------- la boîte des demandes

def test_un_mot_au_mj_choisi_par_le_joueur(deux, coin, joueur, strict):
    client, alban, lea = deux
    asyncio.run(commandes_api.boite.annoncer())
    assert json.loads(DESTINATAIRES.read_text(encoding="utf-8")) == {"mj": [{"id": "alban", "nom": "Alban"}, {"id": "lea", "nom": "Léa"}]}
    j = joueur("Aude", alban)
    entrer_au_coin(coin, j)
    assert coin.get("/api/demandes").json()["destinataires"] == [{"id": "alban", "nom": "Alban"}, {"id": "lea", "nom": "Léa"}]
    pour_lea = coin.post("/api/demandes", json={"genre": "message", "corps": {"texte": f"{CANARI['lea']} mot", "mj": "lea"}}).json()
    pour_alban = coin.post("/api/demandes", json={"genre": "message", "corps": {"texte": f"{CANARI['alban']} mot"}}).json()
    assert pour_lea["corps"]["mj"] == "lea" and "mj" not in pour_alban["corps"]
    assert coin.post("/api/demandes", json={"genre": "message", "corps": {"texte": "x", "mj": "inconnu"}}).status_code == 409
    assert coin.post("/api/demandes", json={"genre": "message", "corps": {"texte": "x", "mj": "Léa!"}}).status_code == 400
    boites = {qui: client.get("/api/demandes", headers=h) for qui, h in (("alban", alban), ("lea", lea))}
    for qui, autre in (("alban", "lea"), ("lea", "alban")):
        assert boites[qui].status_code == 200
        assert CANARI[qui] in boites[qui].text and CANARI[autre] not in boites[qui].text
        assert boites[qui].json()["compte"] == 1
    assert client.get("/api/demandes/resume", headers=lea).json()["compte"] == 1
    # Telegram ne concerne qu'Alban : la boîte de Léa le dit éteint, et rien de ce qui revient à Léa ne s'y dit.
    assert boites["lea"].json()["telegram"] is False and boites["lea"].json()["telegram_configure"] is False
    presentes = commandes_api.boite.cles_presentes(*commandes_api.boite.tout())
    assert presentes[f"d:{j['id']}:{pour_lea['id']}"][2] is False
    assert presentes[f"d:{j['id']}:{pour_alban['id']}"][2] is True
    # Chacun tranche le sien ; celui de l'autre est comme une demande qui n'existe pas.
    for qui, h, d in (("alban", alban, pour_lea), ("lea", lea, pour_alban)):
        r = client.post(f"/api/demandes/{j['id']}/{d['id']}/accepter", json={"version": 1}, headers=h)
        assert r.status_code == 404 and CANARI["lea" if qui == "alban" else "alban"] not in r.text
    r = client.post(f"/api/demandes/{j['id']}/{pour_lea['id']}/accepter", json={"version": 1, "mot": "Bien reçu"}, headers=lea)
    assert r.status_code == 200 and r.json()["statut"] == "acceptee"
    assert CANARI["lea"] not in client.get("/api/demandes", headers=alban).text
    # Le joueur relit son mot, pour Léa, lu par elle.
    lu = next(d for d in coin.get("/api/demandes").json()["demandes"] if d["id"] == pour_lea["id"])
    assert lu["statut"] == "acceptee" and lu["mot"] == "Bien reçu"
    # Léa partie (compte fermé) : plus de choix au coin, et son mot reste à elle, pas à Alban.
    with comptes_mj.verrou(config.DONNEES):
        etat = comptes_mj.lire(config.DONNEES)
        comptes_mj.par_id(etat, "lea")["ferme"] = comptes_mj.maintenant()
        comptes_mj.ecrire(config.DONNEES, etat)
    asyncio.run(commandes_api.boite.annoncer())
    assert not DESTINATAIRES.exists() and "destinataires" not in coin.get("/api/demandes").json()
    assert CANARI["lea"] not in client.get("/api/demandes", headers=alban).text
    assert coin.post("/api/demandes", json={"genre": "message", "corps": {"texte": "x", "mj": "lea"}}).status_code == 409


def test_chaque_demande_va_au_mj_concerne(deux, coin, joueur, strict):
    """Un déplacement va au MJ du plan, une commande à l'auteur de la boutique ; « Pour le MJ seulement » reste au principal,
    même adressé à l'autre ; le reste (sac, dons, histoire, portraits…) au principal. Alban n'accepte plus un déplacement
    sur le plan de Léa (le cas relevé au lot MJ-3) : il ne le voit pas."""
    client, alban, lea = deux
    plan_l = creer(client, "plans", {"nom": "Plan de Léa"}, lea)
    boutiques = {qui: creer(client, "boutiques", {"nom": f"{CANARI[qui]} boutique"}, h) for qui, h in (("alban", alban), ("lea", lea))}
    j = joueur("Basile", alban)
    maintenant = demandes.maintenant()

    def entree(ident, genre, corps, statut="en-attente"):
        return {"id": ident, "genre": genre, "statut": statut, "version": 1, "cree": maintenant, "modifie": maintenant,
                "corps": corps, "resultat": None, "mot": "", "traitee": None, "par": "joueur"}
    try:
        with demandes.verrou(config.PROPOSITIONS):
            demandes.ecrire(config.PROPOSITIONS, j["id"], [
                entree("a00000000001", deplacement.GENRE, {"plan": tv_cartes.jeton("plans", plan_l), "pion": "p1", "depuis": [0, 0], "vers": [1, 0]}),
                entree("a00000000002", "confie", {"longueur": 12, "mj": "lea"}, statut="echec"),
                entree("a00000000003", "don-or", {"or": 3, "pour": "x"}, statut="refusee"),
            ])
        commande = lambda i, qui: {"id": i * 12, "statut": "en-attente", "boutique": tv_cartes.jeton("boutiques", boutiques[qui]),  # noqa: E731
                                   "boutique_nom": f"{CANARI[qui]} boutique", "lignes": [], "cree": maintenant}
        carnet.ecrire_commandes(config.PROPOSITIONS, j["id"], [commande("b", "alban"), commande("c", "lea")])
        vues = {qui: client.get("/api/demandes", headers=h).json() for qui, h in (("alban", alban), ("lea", lea))}
        ids = {qui: {x["id"] for x in v["attente"] + v["historique"]} for qui, v in vues.items()}
        assert ids["lea"] == {"a00000000001", "c" * 12}
        assert ids["alban"] == {"a00000000002", "a00000000003", "b" * 12}
        assert CANARI["lea"] not in json.dumps(vues["alban"]) and CANARI["alban"] not in json.dumps(vues["lea"])
        # Les commandes de l'échoppe : chacun celles de ses boutiques ; celle de l'autre ne se vend ni ne se refuse.
        for qui, autre, h in (("alban", "lea", alban), ("lea", "alban", lea)):
            liste = client.get("/api/commandes", headers=h).json()
            assert [c["id"] for c in liste] == [("b" if qui == "alban" else "c") * 12]
            ident = ("c" if qui == "alban" else "b") * 12
            r = client.post(f"/api/commandes/{j['id']}/{ident}/refuser", json={"mot": "non"}, headers=h)
            assert r.status_code == 404 and CANARI[autre] not in r.text
        # Le déplacement sur le plan de Léa : Alban ne le tranche pas, Léa si (le plan n'est plus à la TV : refus du chemin).
        r = client.post(f"/api/demandes/{j['id']}/a00000000001/refuser", json={"version": 1}, headers=alban)
        assert r.status_code == 404
        assert client.post(f"/api/demandes/{j['id']}/a00000000001/refuser", json={"version": 1}, headers=lea).status_code == 200
    finally:
        for chemin in (config.PLANS / f"{plan_l}.json", *(config.BOUTIQUES / f"{b}.json" for b in boutiques.values())):
            chemin.unlink(missing_ok=True)


def test_en_veille_la_boite_note_sans_rien_cacher(deux, coin, joueur, monkeypatch):
    """En veille (avant le strict, jamais avec un invité ouvert en service) : Alban lit encore tout, mais chaque lecture
    de ce qui revient à Léa est notée."""
    client, alban, lea = deux
    monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.VEILLE)
    cloisonnement.oublier()
    asyncio.run(commandes_api.boite.annoncer())
    j = joueur("Cyrille", alban)
    entrer_au_coin(coin, j)
    coin.post("/api/demandes", json={"genre": "message", "corps": {"texte": f"{CANARI['lea']} veille", "mj": "lea"}})
    assert CANARI["lea"] in client.get("/api/demandes", headers=alban).text
    assert any(v[0] == "demande-d-un-autre" and v[3] == "alban" for v in cloisonnement.vues())
    cloisonnement.oublier()


# ---------------------------------------------------------------- les horloges

def test_les_horloges_par_auteur(deux, strict):
    """Trois chacun : celles de l'autre ne comptent pas et ne se devinent pas à un refus. La TV en montre trois au plus, les
    plus récemment touchées, de l'un ou de l'autre, dans un ordre qui ne bouge pas ; chacun ne lit et ne règle que les
    siennes, et ne voit de celles de l'autre que ce que la TV montre."""
    client, alban, lea = deux
    cachee = {qui: f"{CANARI[qui]} cachée" for qui in CANARI}

    def creer_horloge(h, nom, visible):
        r = client.post("/api/horloges", json={"nom": nom, "parts": 4, "visible": visible}, headers=h)
        assert r.status_code == 200, r.text
        return r.json()["horloge"]
    a0, a1 = creer_horloge(alban, "Alban 0", True), creer_horloge(alban, "Alban 1", True)
    creer_horloge(alban, cachee["alban"], False)
    assert client.post("/api/horloges", json={"nom": "De trop", "parts": 4}, headers=alban).status_code == 409
    l0 = creer_horloge(lea, "Léa 0", True)
    l1 = creer_horloge(lea, cachee["lea"], False)
    for qui, autre, h in (("alban", "lea", alban), ("lea", "alban", lea)):
        lu = client.get("/api/horloges", headers=h)
        assert cachee[autre] not in lu.text and cachee[qui] in lu.text and len(lu.json()["horloges"]) == (3 if qui == "alban" else 2)
        assert cachee[autre] not in client.get("/api/table", headers=h).text
    tv = lambda: [h["id"] for h in tv_etat.etat_public(tv_ecran.etat_table()).get("horloges", [])]  # noqa: E731
    assert tv() == [a0, a1, l0]
    # Léa montre la sienne : quatre montrées, la TV garde les trois touchées en dernier, dans l'ordre de la liste.
    assert client.patch(f"/api/horloges/{l1}", json={"visible": True}, headers=lea).status_code == 200
    assert tv() == [a1, l0, l1]
    # Alban avance la sienne : elle revient à la TV, la plus ancienne touchée en sort.
    assert client.patch(f"/api/horloges/{a0}", json={"pas": 1}, headers=alban).status_code == 200
    assert tv() == [a0, l0, l1]
    # Léa avance par la touche H : la sienne touchée en dernier, jamais une d'Alban.
    r = client.post("/api/horloges/avancer", json={"pas": 1}, headers=lea).json()
    assert r["horloge"] == l1 and {h["id"]: h["remplies"] for h in r["horloges"]} == {l0: 0, l1: 1}
    assert {h["id"]: h["remplies"] for h in client.get("/api/horloges", headers=alban).json()["horloges"]}[a0] == 1
    # Ni l'une ni l'autre ne touche à celles de l'autre.
    assert client.patch(f"/api/horloges/{a1}", json={"pas": 1}, headers=lea).status_code == 404
    assert client.delete(f"/api/horloges/{l0}", headers=alban).json()["horloges"] and l0 in tv()
