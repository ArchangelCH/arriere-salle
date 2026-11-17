"""La file des demandes des joueurs (demandes.py) et la boîte du MJ (boite.py) : le format et le verrou du fichier, ses
bornes et le plafond horaire, le retrait par le joueur, accepter et refuser avec la version (un double traitement est
refusé), chacun ne lit que ses demandes, le mot du MJ passe au masque et ne nomme aucun inconnu, la pause fige toute
écriture, la surveillance applique seule ce qui doit l'être sans se relancer sur ses propres écritures, et rien de la
boîte ne sort par la table publique."""
import asyncio
import json
import os
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
from commun import carnet  # noqa: E402
from commun import demandes  # noqa: E402
import joueurs  # noqa: E402
from comptes_coin import entrer as entrer_au_coin  # noqa: E402
import main  # noqa: E402
from api import application, commandes_api, config, joueurs_mj, portier  # noqa: E402

CF = {"CF-Connecting-IP": "203.0.113.7"}
DOSSIER = config.PROPOSITIONS / demandes.DOSSIER


@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture()
def coin(monkeypatch):
    monkeypatch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    monkeypatch.setattr(joueurs, "COOKIE_SUR", False)
    monkeypatch.setattr(joueurs, "HOTES", set())
    monkeypatch.setattr(joueurs, "DEMANDES_FAITES", {})
    with TestClient(joueurs.app) as c:
        yield c


@pytest.fixture()
def invites(atelier):
    """Des joueurs invités pour l'essai, retirés à la fin (leurs demandes partent avec eux)."""
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
    entrer_au_coin(client, cle)  # le provisoire du MJ ouvre le compte et la session


def un_mot(client, texte="Je serai en retard samedi."):
    return client.post("/api/demandes", json={"genre": "message", "corps": {"texte": texte}})


def dans_la_boite(atelier, joueur):
    v = atelier.get("/api/demandes").json()
    return [x for x in v["attente"] + v["historique"] if x["joueur"] == joueur]


def attendre(condition, delai=5.0):
    fin = time.monotonic() + delai
    while time.monotonic() < fin:
        if condition():
            return True
        time.sleep(0.05)
    return False


# ---------------------------------------------------------------- format, verrou, bornes

def test_le_format_d_une_demande(atelier, coin, invites):
    j = invites("Dario")
    entrer(coin, j)
    r = un_mot(coin, "  Je serai en retard\u0007 samedi.\r\n\r\n\r\n\r\nGarde-moi une chaise.  ")
    assert r.status_code == 200
    vue = r.json()
    assert vue["statut"] == "en-attente" and vue["statut_dit"] == "envoyé, pas encore lu" and vue["retirable"] is True
    brut = json.loads((DOSSIER / f"{j['id']}.json").read_text(encoding="utf-8"))
    assert len(brut) == 1
    d = brut[0]
    assert set(d) == {"id", "genre", "statut", "version", "cree", "modifie", "corps", "resultat", "mot", "traitee", "par"}
    assert d["genre"] == "message" and d["version"] == 1 and d["par"] == "joueur" and d["traitee"] is None
    # Le texte nettoyé : ni caractère de contrôle, ni lignes vides à la suite.
    assert d["corps"] == {"texte": "Je serai en retard samedi.\n\nGarde-moi une chaise."}
    assert (DOSSIER / f"{j['id']}.json").stat().st_mode & 0o777 == 0o644


def test_le_verrou_tient_le_coin_et_l_atelier(atelier, coin, invites):
    j = invites("Verrou")
    entrer(coin, j)
    fini = threading.Event()

    def ecrire():
        joueurs.demander_ici({"id": j["id"]}, {"genre": "message", "corps": {"texte": "Pendant le verrou."}})
        fini.set()

    with demandes.verrou(config.PROPOSITIONS):
        t = threading.Thread(target=ecrire)
        t.start()
        time.sleep(0.3)
        assert not fini.is_set(), "le coin a écrit pendant que l'atelier tenait le verrou"
    t.join(5)
    assert fini.is_set() and len(demandes.lire(config.PROPOSITIONS, j["id"])) == 1


def test_les_bornes(atelier, coin, invites):
    j = invites("Bornes")
    entrer(coin, j)
    assert un_mot(coin, "x" * (demandes.MESSAGE_MAX + 1)).status_code == 413
    assert un_mot(coin, "  \n ").status_code == 400
    assert un_mot(coin, "ligne\n" * 30).status_code == 413
    # Un genre que l'atelier ne connaît pas (« sac » existe depuis le lot B1 : test_inventaire.py).
    assert coin.post("/api/demandes", json={"genre": "inexistant", "corps": {}}).status_code == 400
    assert coin.post("/api/demandes", json={"genre": "message", "corps": {"texte": "x", "autre": 1}}).status_code == 400
    assert coin.post("/api/demandes", json={"genre": "message", "corps": {"texte": "x"}, "statut": "acceptee"}).status_code == 400
    assert coin.post("/api/demandes", json={"genre": "message", "corps": "texte"}).status_code == 400
    assert coin.post("/api/demandes", content=b"{" + b" " * 9000 + b"}", headers={"Content-Type": "application/json"}).status_code == 413
    assert not (DOSSIER / f"{j['id']}.json").exists()


def test_borner_garde_ce_qui_attend():
    vieux = (datetime.now() - timedelta(days=3)).isoformat(timespec="milliseconds")
    traitee = lambda i: {"id": f"{i:012x}", "genre": "message", "statut": "acceptee", "version": 2, "cree": vieux, "corps": {"texte": "t"}}
    attente = lambda i: {**traitee(i), "statut": "en-attente", "version": 1}
    liste = demandes.borner([traitee(i) for i in range(40)] + [attente(100 + i) for i in range(30)])
    assert len(liste) == demandes.ENTREES_MAX and sum(d["statut"] == "en-attente" for d in liste) == 30
    # Les plus anciennes traitées s'en vont d'abord.
    assert liste[0]["id"] == f"{10:012x}"
    with pytest.raises(demandes.Refus) as refus:
        demandes.borner([attente(i) for i in range(demandes.ENTREES_MAX + 1)])
    assert refus.value.statut == 429
    # En octets aussi : 128 Ko au plus.
    lourde = lambda i: {**traitee(i), "corps": {"texte": "é" * 790}}
    assert demandes.taille(demandes.borner([lourde(i) for i in range(60)])) <= demandes.OCTETS_MAX


def test_un_fichier_abime_ou_trop_lourd_ne_se_lit_pas(atelier, coin, invites):
    j = invites("Abime")
    entrer(coin, j)
    chemin = DOSSIER / f"{j['id']}.json"
    chemin.write_text('[{"id":"pas-un-id"},{"id":"aaaaaaaaaaaa","genre":"message","statut":"inconnu","version":1,"cree":"x","corps":{}}]', encoding="utf-8")
    assert coin.get("/api/demandes").json()["demandes"] == []
    chemin.write_text(json.dumps([{"x": "y" * (demandes.OCTETS_MAX + 10)}]), encoding="utf-8")
    assert demandes.lire(config.PROPOSITIONS, j["id"]) == []
    chemin.unlink()


def test_trente_par_heure(atelier, coin, invites):
    j = invites("Bavard")
    entrer(coin, j)
    for i in range(demandes.PAR_HEURE):
        assert un_mot(coin, f"Mot {i}").status_code == 200, i
    r = un_mot(coin, "Un de trop")
    assert r.status_code == 429 and "par heure" in r.json()["detail"]
    # Le fichier suffit aussi (le coin a redémarré, sa mémoire est vide).
    joueurs.DEMANDES_FAITES.clear()
    assert un_mot(coin, "Encore un").status_code == 429


# ---------------------------------------------------------------- retirer, accepter, refuser

def test_le_joueur_retire_tant_que_rien_n_est_fait(atelier, coin, invites):
    j = invites("Retrait")
    entrer(coin, j)
    d = un_mot(coin).json()
    r = coin.delete(f"/api/demandes/{d['id']}")
    assert r.status_code == 200 and r.json()["statut"] == "retiree" and r.json()["retirable"] is False
    assert coin.delete(f"/api/demandes/{d['id']}").status_code == 409
    assert coin.delete("/api/demandes/000000000000").status_code == 404
    assert coin.delete("/api/demandes/..%2F..%2Fcarnet").status_code in (404, 405)
    # Le MJ qui l'avait encore à l'écran (version 1) ne la traite plus.
    r = atelier.post(f"/api/demandes/{j['id']}/{d['id']}/accepter", json={"version": 1})
    assert r.status_code == 409 and "retiré" in r.json()["detail"]
    # Une demande lue par le MJ ne se retire plus.
    d2 = un_mot(coin, "Deuxième").json()
    assert atelier.post(f"/api/demandes/{j['id']}/{d2['id']}/accepter", json={"version": 1}).status_code == 200
    assert coin.delete(f"/api/demandes/{d2['id']}").status_code == 409


def test_accepter_et_refuser_avec_la_version(atelier, coin, invites):
    j = invites("Yuna")
    entrer(coin, j)
    d = un_mot(coin, "Puis-je jouer un nain ?").json()
    vue = next(x for x in dans_la_boite(atelier, j["id"]) if x["id"] == d["id"])
    assert vue["statut"] == "en-attente" and vue["version"] == 1 and vue["oui"] == "Lu" and vue["non"] is None
    assert vue["corps"] == {"texte": "Puis-je jouer un nain ?"} and vue["joueur_nom"] == "Yuna"
    url = f"/api/demandes/{j['id']}/{d['id']}"
    assert atelier.post(f"{url}/accepter", json={}).status_code == 400  # sans version
    assert atelier.post(f"{url}/accepter", json={"version": 7}).status_code == 409  # une autre version
    # Un mot ne se refuse pas : on y répond.
    assert atelier.post(f"{url}/refuser", json={"version": 1}).status_code == 400
    r = atelier.post(f"{url}/accepter", json={"version": 1, "mot": "Oui, parlons-en samedi."})
    assert r.status_code == 200 and r.json()["statut"] == "acceptee" and r.json()["version"] == 2
    # L'iPad avait la même demande sous les yeux : son geste est refusé, rien ne change.
    r = atelier.post(f"{url}/accepter", json={"version": 1, "mot": "Autre chose"})
    assert r.status_code == 409
    vu = coin.get("/api/demandes").json()["demandes"][0]
    assert vu["statut"] == "acceptee" and vu["statut_dit"] == "lu par le MJ" and vu["mot"] == "Oui, parlons-en samedi."
    assert atelier.post(f"/api/demandes/{j['id']}/000000000000/accepter", json={"version": 1}).status_code == 404
    assert atelier.post(f"/api/demandes/inconnu/{d['id']}/accepter", json={"version": 1}).status_code == 404


def test_refuser_un_genre_qui_se_refuse(atelier, coin, invites):
    genre = demandes.enregistrer(demandes.Genre("essai-refus", "Essai", ("un essai", "{n} essais"), attente=True,
                                                valider=lambda c: demandes.seulement(c, {"x"}, "Essai")))
    try:
        j = invites("Refus")
        entrer(coin, j)
        d = coin.post("/api/demandes", json={"genre": genre.cle, "corps": {"x": 1}}).json()
        url = f"/api/demandes/{j['id']}/{d['id']}"
        r = atelier.post(f"{url}/refuser", json={"version": 1, "mot": "Pas cette fois."})
        assert r.status_code == 200 and r.json()["statut"] == "refusee"
        assert atelier.post(f"{url}/accepter", json={"version": 2}).status_code == 409
        assert coin.get("/api/demandes").json()["demandes"][0]["mot"] == "Pas cette fois."
    finally:
        demandes.GENRES.pop("essai-refus", None)


def test_un_joueur_ne_voit_que_ses_demandes(atelier, invites, monkeypatch):
    monkeypatch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    monkeypatch.setattr(joueurs, "COOKIE_SUR", False)
    monkeypatch.setattr(joueurs, "HOTES", set())
    lea, max_ = invites("Léa"), invites("Max")
    with TestClient(joueurs.app) as c1, TestClient(joueurs.app) as c2:
        entrer(c1, lea)
        entrer(c2, max_)
        d = un_mot(c1, "MOT-DE-LEA").json()
        un_mot(c2, "MOT-DE-MAX")
        assert "MOT-DE-MAX" not in c1.get("/api/demandes").text and "MOT-DE-LEA" in c1.get("/api/demandes").text
        assert "MOT-DE-LEA" not in c2.get("/api/demandes").text
        # L'identifiant d'une demande de Léa ne mène à rien depuis la session de Max.
        assert c2.delete(f"/api/demandes/{d['id']}").status_code == 404
        assert c1.get("/api/demandes").json()["demandes"][0]["statut"] == "en-attente"
    with TestClient(joueurs.app) as sans:
        assert sans.get("/api/demandes").status_code == 401
        assert un_mot(sans).status_code == 401


# ---------------------------------------------------------------- le mot du MJ

@pytest.fixture()
def inconnu(atelier):
    p = atelier.post("/api/pnj", json={"nom": "Gorvak Sombrefer", "connu": False, "role": "traître"}).json()
    yield p
    atelier.delete(f"/api/pnj/{p['id']}")


def test_le_mot_du_mj_passe_au_masque_et_ne_nomme_aucun_inconnu(atelier, coin, invites, inconnu):
    j = invites("Masque")
    entrer(coin, j)
    d = un_mot(coin, "On dort où samedi ?").json()
    url = f"/api/demandes/{j['id']}/{d['id']}"
    r = atelier.post(f"{url}/accepter", json={"version": 1, "mot": "Méfie-toi de Gorvak."})
    assert r.status_code == 409 and "Gorvak" in r.json()["detail"]
    # Rien n'est parti : la demande attend toujours.
    assert coin.get("/api/demandes").json()["demandes"][0]["statut"] == "en-attente"
    r = atelier.post(f"{url}/accepter", json={"version": 1, "mot": "À la Petite Fanfrelée, comme d'habitude."})
    assert r.status_code == 200
    vu = coin.get("/api/demandes").text
    assert "Fanfrel" not in vu and "auberge" in vu
    assert "Fanfrel" not in (DOSSIER / f"{j['id']}.json").read_text(encoding="utf-8")
    assert atelier.post(f"{url}/accepter", json={"version": 2, "mot": 12}).status_code == 400


# ---------------------------------------------------------------- la pause

def test_la_pause_fige_toute_ecriture(atelier, coin, invites):
    j = invites("Pause")
    entrer(coin, j)
    d = un_mot(coin, "Avant la pause").json()
    racine_avant = sorted(p.name for p in config.PROPOSITIONS.iterdir())
    r = atelier.put("/api/demandes/reglages", json={"pause": True})
    assert r.status_code == 200 and r.json()["pause"] is True
    # Rien de nouveau à la racine des propositions (elle est lue comme des héros proposés).
    assert sorted(p.name for p in config.PROPOSITIONS.iterdir()) == racine_avant
    assert (DOSSIER / demandes.PAUSE).exists()
    r = un_mot(coin, "Pendant la pause")
    assert r.status_code == 423 and "pause" in r.json()["detail"] and r.headers["X-Coin-En-Pause"] == "1"
    assert coin.delete(f"/api/demandes/{d['id']}").status_code == 423
    assert coin.post("/api/commandes", json={"boutique": "0" * 20, "lignes": []}).status_code == 423
    assert coin.put("/api/moi/limites", json={}).status_code == 423
    # Le créateur lit un 423 comme « accueilli » : il reçoit un 503, garde sa saisie et réessaie seul.
    r = coin.post("/api/moi/aventurier", json={"nom": "Brouillon"})
    assert r.status_code == 503 and r.headers["Retry-After"] and "pause" in r.json()["detail"]
    assert coin.post("/api/moi/envoyer").status_code == 503
    # Lire reste permis, et dit la pause.
    lu = coin.get("/api/demandes").json()
    assert lu["pause"] is True and len(lu["demandes"]) == 1
    assert coin.get("/api/moi").status_code == 200
    assert atelier.get("/api/demandes").json()["pause"] is True
    atelier.put("/api/demandes/reglages", json={"pause": False})
    assert un_mot(coin, "Après la pause").status_code == 200


def test_une_pause_illisible_fige_par_prudence(atelier, coin, invites):
    j = invites("Prudence")
    entrer(coin, j)
    (DOSSIER / demandes.PAUSE).write_text("{pas du json", encoding="utf-8")
    assert un_mot(coin).status_code == 423
    (DOSSIER / demandes.PAUSE).write_text('{"pause": "non"}', encoding="utf-8")
    assert un_mot(coin).status_code == 423
    demandes.ecrire_pause(config.PROPOSITIONS, False)
    assert un_mot(coin).status_code == 200


def test_les_reglages_de_la_boite(atelier):
    assert atelier.put("/api/demandes/reglages", json={}).status_code == 400
    assert atelier.put("/api/demandes/reglages", json={"pause": "oui"}).status_code == 400
    assert atelier.put("/api/demandes/reglages", json={"autre": True}).status_code == 400
    r = atelier.put("/api/demandes/reglages", json={"telegram": False}).json()
    assert r["telegram"] is False and r["telegram_configure"] is False
    assert atelier.put("/api/demandes/reglages", json={"telegram": True}).json()["telegram"] is True


# ---------------------------------------------------------------- la boîte : commandes et aventuriers envoyés

def test_la_boite_rassemble_commandes_et_aventuriers(atelier, coin, invites):
    j = invites("Rassemble")
    entrer(coin, j)
    coin.post("/api/moi/aventurier", json={"nom": "Elouan"})
    coin.post("/api/moi/envoyer")
    with carnet.verrou(config.PROPOSITIONS):
        carnet.ecrire_commandes(config.PROPOSITIONS, j["id"], [{"id": "abcdefabcdef", "boutique": "0" * 20, "boutique_nom": "La Forge",
                                                             "lignes": [{"article": "a1", "nom": "Dague", "prix": "3", "quantite": 2}],
                                                             "total": 6, "a_fixer": False, "statut": "en-attente", "cree": "2026-11-08T10:00:00.000"}])
    un_mot(coin, "Et un mot")
    v = atelier.get("/api/demandes").json()
    miens = [x for x in v["attente"] if x["joueur"] == j["id"]]
    assert {x["type"] for x in miens} == {"demande", "commande", "aventurier"}
    commande = next(x for x in miens if x["type"] == "commande")
    assert commande["boutique_nom"] == "La Forge" and commande["articles"] == 2 and commande["total"] == 6
    assert next(x for x in miens if x["type"] == "aventurier")["aventurier"] == "Elouan"
    assert v["compte"] >= 3
    # Rangés par joueur, puis par genre.
    assert [x["genre"] for x in miens] == sorted(x["genre"] for x in miens)
    # Le format des commandes n'a pas bougé : l'échoppe les lit comme avant.
    assert carnet.lire_commandes(config.PROPOSITIONS, j["id"])[0]["id"] == "abcdefabcdef"


def test_rien_de_la_boite_par_la_table_publique(atelier, monkeypatch):
    for chemin in ("/api/demandes", "/api/demandes/resume", "/api/demandes/reglages"):
        assert atelier.get(chemin, headers=CF).status_code == 404, chemin
    assert atelier.post("/api/demandes/x/aaaaaaaaaaaa/accepter", json={"version": 1}, headers=CF).status_code == 404
    monkeypatch.setattr(portier, "TABLE_PUBLIQUE", {"table.example.ch"})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {"table.example.ch"})
    assert atelier.get("/api/demandes", headers={"Host": "table.example.ch"}).status_code == 404


def test_un_joueur_retire_emporte_ses_demandes(atelier, coin, invites):
    j = invites("Parti")
    entrer(coin, j)
    un_mot(coin)
    assert (DOSSIER / f"{j['id']}.json").exists()
    atelier.delete(f"/api/joueurs/{j['id']}")
    assert not (DOSSIER / f"{j['id']}.json").exists()
    # Un nouveau joueur du même prénom n'hérite de rien.
    neuf = invites("Parti")
    assert not (DOSSIER / f"{neuf['id']}.json").exists()


# ---------------------------------------------------------------- la surveillance

def test_la_surveillance_applique_seule_sans_se_relancer(atelier, coin, invites):
    appels = []
    demandes.enregistrer(demandes.Genre("essai-auto", "Essai appliqué", ("un essai", "{n} essais"), attente=False, annulable=True,
                                        valider=lambda c: demandes.seulement(c, {"n"}, "Essai")))

    def appliquer(j, d):
        appels.append(d["id"])
        if d["corps"].get("n") == 13:
            raise demandes.Refus(409, "Treize porte malheur.")
        return f"Fait pour {j['nom']}."
    commandes_api.boite.brancher("essai-auto", appliquer=appliquer, annuler=lambda j, d: "Défait.")
    try:
        j = invites("Auto")
        entrer(coin, j)
        d = coin.post("/api/demandes", json={"genre": "essai-auto", "corps": {"n": 1}}).json()
        assert d["statut"] == "a-appliquer"
        lire = lambda: {x["id"]: x for x in demandes.lire(config.PROPOSITIONS, j["id"])}
        assert attendre(lambda: lire()[d["id"]]["statut"] == "appliquee"), "la surveillance n'a rien appliqué"
        passages = commandes_api.boite.passages
        time.sleep(1.5)
        # Ses propres écritures ne la relancent qu'une fois au plus, et rien n'est appliqué deux fois.
        assert appels == [d["id"]] and commandes_api.boite.passages - passages <= 1
        assert lire()[d["id"]]["resultat"] == "Fait pour Auto." and lire()[d["id"]]["par"] == "atelier"
        # Un échec garde sa phrase, que le joueur lit.
        e = coin.post("/api/demandes", json={"genre": "essai-auto", "corps": {"n": 13}}).json()
        assert attendre(lambda: lire()[e["id"]]["statut"] == "echec")
        assert coin.get("/api/demandes").json()["demandes"][0]["resultat"] == "Treize porte malheur."
        # « Annuler » dans la boîte, avec la version.
        vue = next(x for x in dans_la_boite(atelier, j["id"]) if x["id"] == d["id"])
        assert vue["annulable"] is True
        r = atelier.post(f"/api/demandes/{j['id']}/{d['id']}/annuler", json={"version": vue["version"]})
        assert r.status_code == 200 and r.json()["statut"] == "annulee" and r.json()["resultat"] == "Défait."
        assert atelier.post(f"/api/demandes/{j['id']}/{d['id']}/annuler", json={"version": r.json()["version"]}).status_code == 409
        assert atelier.post(f"/api/demandes/{j['id']}/{e['id']}/annuler", json={"version": 2}).status_code == 409
    finally:
        demandes.GENRES.pop("essai-auto", None)
        commandes_api.boite.branchements.pop("essai-auto", None)


def test_l_atelier_est_prevenu_par_son_canal(atelier, coin, invites):
    j = invites("Canal")
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
                recus.append(m)
                if m.get("type") == "demandes":
                    return
        t = threading.Thread(target=ecouter, daemon=True)
        t.start()
        debut = time.monotonic()
        un_mot(coin, "Ding")
        t.join(3)
        assert any(m.get("type") == "demandes" for m in recus), recus
        assert time.monotonic() - debut < 2
        m = next(m for m in recus if m.get("type") == "demandes")
        # Le canal de l'atelier ne porte que le compte : la page relit la boîte.
        assert set(m) == {"type", "compte", "pause", "signature"} and m["compte"] >= 1


def test_rien_n_est_notifie_deux_fois(atelier, coin, invites, tmp_path):
    j = invites("Une fois")
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

    def boite_neuve():
        b = boite_mod.Boite(config.PROPOSITIONS, tmp_path, joueurs_lus=joueurs_mj.joueurs_lus, nettoyer_mot=lambda m: m, signaler=signaler, telegram=Faux())
        b.file = asyncio.Queue()
        return b

    async def vague(b):
        await b.annoncer()
        sortie = []
        while not b.file.empty():
            sortie.append(b.file.get_nowait())
        return sortie

    b = boite_neuve()
    assert asyncio.run(vague(b)) == []  # le tout premier passage : tout ce qui est là compte pour vu
    un_mot(coin, "Premier")
    un_mot(coin, "Second")
    premiere = asyncio.run(vague(b))
    assert len(premiere) == 1 and "Une fois</b> : 2 mots pour toi." in premiere[0]
    assert asyncio.run(vague(b)) == []
    # Redémarré : la mémoire est sur le disque.
    assert asyncio.run(vague(boite_neuve())) == []
    assert "Premier" not in premiere[0] and "Second" not in premiere[0]


def test_ce_qui_se_dit_sur_telegram():
    """Une demande appliquée seule se dit (elle l'est déjà quand la boîte la découvre) ; une demande retirée avant d'être
    vue, ou d'un genre silencieux (les déplacements à venir), jamais."""
    demandes.enregistrer(demandes.Genre("essai-muet", "Muet", ("un pas", "{n} pas"), attente=False, silencieux=True,
                                        valider=lambda c: c))
    try:
        el = lambda genre, statut, i: {"type": "demande", "joueur": "lea", "joueur_nom": "Léa", "id": f"{i:012x}", "genre": genre, "statut": statut}
        presentes = boite_mod.Boite.cles_presentes([el("message", "en-attente", 1)], [el("message", "appliquee", 2), el("message", "retiree", 3),
                                                                                      el("essai-muet", "appliquee", 4), el("inconnu", "en-attente", 5)])
        assert [presentes[f"d:lea:{i:012x}"][2] for i in range(1, 6)] == [True, True, False, False, False]
    finally:
        demandes.GENRES.pop("essai-muet", None)


def test_la_surveillance_cree_les_dossiers_que_le_coin_remplira(tmp_path):
    """Un dossier créé par le coin à la toute première demande échapperait aux notifications le temps que la surveillance
    le découvre (la demande attendrait la relecture de secours) : la boîte les crée dès son démarrage."""
    depot = tmp_path / "propositions"
    depot.mkdir()

    async def signaler(_m):
        pass

    b = boite_mod.Boite(depot, tmp_path, joueurs_lus=lambda: [], nettoyer_mot=lambda m: m, signaler=signaler)

    async def un_instant():
        try:
            await asyncio.wait_for(b.surveiller(), 0.5)
        except asyncio.TimeoutError:
            pass

    asyncio.run(un_instant())
    assert (depot / demandes.DOSSIER).is_dir() and (depot / carnet.COMMANDES).is_dir()
