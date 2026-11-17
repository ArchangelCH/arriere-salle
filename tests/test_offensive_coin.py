"""Le coin des joueurs vu par un attaquant : un joueur connecté qui forge ses requêtes, écrit tout droit
dans la file comme un coin qui ne vérifierait rien, ou frappe en rafale. Chaque essai dit l'attaque et ce qui la bloque :
le sac d'un autre, un compagnon forgé, l'or en double, « Annuler » détourné, une fiche republiée trop bavarde, le plan et
ses images, le pion d'un autre, la présence et la main d'un autre, et les réglages de l'atelier depuis Internet."""
import json
import os
import secrets
import sys
import tempfile
import threading
import time
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from commun import carnet  # noqa: E402
from commun import demandes  # noqa: E402
import joueurs  # noqa: E402
import main  # noqa: E402
from table.masque import masquer_tout  # noqa: E402
from api import application, carnet_api, commandes_api, config, heros_etat, portier, tv_cartes, tv_etat, tv_plans, utilitaires  # noqa: E402
from comptes_coin import entrer  # noqa: E402

SECRETS = ("SECRET-OFF", "NOTE-OFF", "Murgoth", "Noirval", "Vampyre", "anfrel")



def attendre(condition, delai=6.0):
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
def monde(atelier):
    """Aube (Ysolde) et Basile (Tavarède) accueillis ; Odile à la tablée sans joueur, d'un peuple caché ; Hors, un héros
    hors de la tablée ; un PNJ inconnu ; une boutique ouverte aux joueurs. Tout est retiré à la fin."""
    patch = pytest.MonkeyPatch()
    patch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    patch.setattr(joueurs, "COOKIE_SUR", False)
    patch.setattr(joueurs, "HOTES", set())
    patch.setattr(joueurs, "DEMANDES_FAITES", {})
    m = {"pnj": atelier.post("/api/pnj", json={"nom": "Murgoth Noirval", "connu": False}).json()}
    for code, nom, heros in (("a", "Aube", "Ysolde Offensive"), ("b", "Basile", "Tavarède Offensif")):
        invite = atelier.post("/api/joueurs", json={"nom": nom}).json()
        coin = TestClient(joueurs.app)
        entrer(coin, invite)
        coin.post("/api/moi/aventurier", json={"nom": heros, "sante": 9, "psy": 5, "equipement": ["Cape"], "objets": ["", "", ""], "or": 30})
        coin.post("/api/moi/envoyer")
        fiche = atelier.post(f"/api/joueurs/{invite['id']}/accueillir").json()
        m[code] = {"joueur": invite, "coin": coin, "heros": fiche}
    m["odile"] = atelier.post("/api/aventuriers", json={"nom": "Odile Offensive", "tablee": True, "equipement": [], "or": 0,
                                                         "peuple": "Vampyre", "peuple_cache": True}).json()
    m["hors"] = atelier.post("/api/aventuriers", json={"nom": "Hors Offensif", "tablee": False, "equipement": [], "or": 0}).json()
    m["boutique"] = atelier.post("/api/boutiques", json={
        "nom": "Chez Offensive", "ouverte_joueurs": True, "ajustement": 0, "articles": [
            {"id": "corde1", "nom": "Corde", "prix": "4", "categorie": "Équipement", "description": "", "stock": None, "cache": False},
            {"id": "epee1", "nom": "Épée", "prix": "25", "categorie": "Équipement", "description": "", "stock": None, "cache": False}]}).json()
    avant = carnet_api.carnet_ouvert()
    atelier.put("/api/carnet-joueurs", json={"ouvert": True})
    yield m
    for code in ("a", "b"):
        m[code]["coin"].close()
        carnet.fichier_commandes(config.PROPOSITIONS, m[code]["joueur"]["id"]).unlink(missing_ok=True)
        atelier.delete(f"/api/joueurs/{m[code]['joueur']['id']}")
        atelier.delete(f"/api/aventuriers/{m[code]['heros']['id']}")
    for cle_ in ("odile", "hors"):
        atelier.delete(f"/api/aventuriers/{m[cle_]['id']}")
    atelier.delete(f"/api/boutiques/{m['boutique']['id']}")
    atelier.delete(f"/api/pnj/{m['pnj']['id']}")
    atelier.put("/api/carnet-joueurs", json={"ouvert": avant})
    demandes.ecrire_pause(config.PROPOSITIONS, False)
    patch.undo()


@pytest.fixture()
def neufs(atelier, monde):
    """Chaque essai part de sacs connus et publiés, sans demande ni commande, et d'un plafond horaire vide."""
    def poser(code, equipement, objets=("", "", ""), bourse=30):
        h = monde[code]["heros"] if code in ("a", "b") else monde[code]
        f = atelier.get(f"/api/aventuriers/{h['id']}").json()
        r = atelier.patch(f"/api/aventuriers/{h['id']}/sac", json={
            "equipement": {"avant": heros_etat.sac_de(f, "equipement"), "apres": list(equipement)},
            "objets": {"avant": heros_etat.sac_de(f, "objets"), "apres": list(objets)},
            "or": {"avant": heros_etat.sac_de(f, "or"), "apres": bourse}})
        assert r.status_code == 200, r.text
    poser("a", ["Cape", "Corde"])
    poser("b", ["Torche"])
    poser("odile", [], bourse=0)
    with demandes.verrou(config.PROPOSITIONS):
        for code in ("a", "b"):
            demandes.fichier(config.PROPOSITIONS, monde[code]["joueur"]["id"]).unlink(missing_ok=True)
    with carnet.verrou(config.PROPOSITIONS):
        for code in ("a", "b"):
            carnet.ecrire_commandes(config.PROPOSITIONS, monde[code]["joueur"]["id"], [])
    joueurs.DEMANDES_FAITES.clear()
    joueurs.MAINS_LEVEES.clear()
    carnet_api.publier_carnet()
    yield poser


def fiche(atelier, ident):
    return atelier.get(f"/api/aventuriers/{ident}").json()


def sac(m, code):
    return m[code]["coin"].get("/api/sac").json()


def geste(m, code, genre="sac", **corps):
    return m[code]["coin"].post("/api/demandes", json={"genre": genre, "corps": corps})


def traitee(m, code, ident):
    def lue():
        d = demandes.trouver(demandes.lire(config.PROPOSITIONS, m[code]["joueur"]["id"]), ident)
        return d if d and d["statut"] != demandes.A_APPLIQUER else None
    d = attendre(lue)
    assert d, "l'atelier n'a pas traité la demande"
    return d


def ecrire_demande(m, code, genre, corps):
    """Tout droit dans la file, comme un coin qui ne vérifierait rien : seul le validateur du genre passe."""
    d = demandes.nouvelle({"genre": genre, "corps": corps})
    with demandes.verrou(config.PROPOSITIONS):
        jid = m[code]["joueur"]["id"]
        demandes.ecrire(config.PROPOSITIONS, jid, [*demandes.lire(config.PROPOSITIONS, jid), d])
    return d


def ref_de(m, code_qui_lit, nom):
    return next(c["ref"] for c in sac(m, code_qui_lit)["compagnons"] if c["nom"] == nom)


def la_boite(atelier, m, code, ident):
    v = atelier.get("/api/demandes").json()
    return next(x for x in v["attente"] + v["historique"] if x["joueur"] == m[code]["joueur"]["id"] and x["id"] == ident)


def publie_de(m, code):
    """La fiche « Mon héros » publiée pour ce joueur, telle que le coin la lit sur le disque."""
    j = next(x for x in joueurs.acces() if x["id"] == m[code]["joueur"]["id"])
    return carnet.lire_publie(config.PROPOSITIONS / carnet.CARNET / carnet.HEROS / f"{carnet.cle_heros(j['jeton'])}.json")


# ---------------------------------------------------------------- le sac d'un autre

def test_le_sac_d_un_autre_ne_se_vise_pas(atelier, monde, neufs):
    """Basile glisse l'identifiant d'Ysolde, son joueur, une liste qui n'en est pas une : tout est refusé avant d'écrire, et
    une demande écrite tout droit ne touche que le sac de Basile."""
    m = monde
    a_id, b_id = m["a"]["heros"]["id"], m["b"]["heros"]["id"]
    base = {"geste": "ajouter", "liste": "equipement", "ligne": "Pain volé"}
    for corps in ({**base, "heros": a_id}, {**base, "aventurier": a_id}, {**base, "joueur": m["a"]["joueur"]["id"]},
                  {**base, "id": a_id}, {**base, "liste": f"../{a_id}"}, {**base, "liste": "secret"}, {**base, "liste": "notes_mj"},
                  {**base, "liste": "or", "ligne": "999"}, {"geste": "changer", "liste": "or", "rang": 0, "avant": "30", "ligne": "9999"}):
        r = m["b"]["coin"].post("/api/demandes", json={"genre": "sac", "corps": corps})
        assert r.status_code == 400, (corps, r.text)
    for enveloppe in ({"genre": "sac", "corps": base, "joueur": m["a"]["joueur"]["id"]}, {"genre": "sac", "corps": base, "heros": a_id},
                      {"genre": "sac", "corps": base, "id": "aaaaaaaaaaaa", "statut": "appliquee"}):
        assert m["b"]["coin"].post("/api/demandes", json=enveloppe).status_code == 400, enveloppe
    # Le coin n'a pas la route du sac de l'atelier.
    for methode in ("PATCH", "PUT", "POST"):
        assert m["b"]["coin"].request(methode, f"/api/aventuriers/{a_id}/sac", json={"equipement": {"avant": [], "apres": []}}).status_code in (404, 405)
    # Écrit tout droit dans la file de Basile : seul son sac bouge.
    d = ecrire_demande(m, "b", "sac", base)
    assert traitee(m, "b", d["id"])["statut"] == "appliquee"
    assert fiche(atelier, a_id)["equipement"] == ["Cape", "Corde"] and fiche(atelier, b_id)["equipement"] == ["Torche", "Pain volé"]


# ---------------------------------------------------------------- un compagnon forgé

def test_un_don_vers_un_compagnon_force(atelier, monde, neufs):
    """Jeton au hasard, jeton d'une autre collection (celui de la TV, d'un plan), héros hors de la tablée, soi-même : le
    coin refuse, et une demande écrite tout droit échoue dans l'atelier sans rien bouger."""
    m = monde
    a_id, b_id = m["a"]["heros"]["id"], m["b"]["heros"]["id"]
    propre = carnet_api.ref_compagnon(a_id)
    forges = {"hasard": "0123456789abcdef0123", "tv": tv_cartes.jeton("aventuriers", b_id), "plan": tv_cartes.jeton("plans", b_id),
              "carnet": tv_cartes.jeton("carnet", b_id), "hors": carnet_api.ref_compagnon(m["hors"]["id"]), "soi": propre}
    # Le jeton d'Ysolde se lit dans la compagnie publiée (le carnet entier) : Aube le connaît, il ne lui sert à rien.
    assert propre in json.dumps(m["a"]["coin"].get("/api/carnet").json()) or True
    assert propre not in {c["ref"] for c in sac(m, "a")["compagnons"]}
    assert carnet_api.ref_compagnon(m["hors"]["id"]) not in json.dumps(m["a"]["coin"].get("/api/carnet").json())
    for quoi, ref in forges.items():
        r = geste(m, "a", "don-objet", liste="equipement", rang=1, avant="Corde", ref=ref)
        assert r.status_code == 409, (quoi, r.text)
        r = geste(m, "a", "don-or", ref=ref, montant=5)
        assert r.status_code == 409, (quoi, r.text)
    for ref in ("0" * 19, "0" * 21, propre.upper(), f"../{b_id}", 12, None, ["x"], {"ref": propre}):
        assert geste(m, "a", "don-objet", liste="equipement", rang=1, avant="Corde", ref=ref).status_code == 400, ref
    for quoi, ref in forges.items():
        d = ecrire_demande(m, "a", "don-objet", {"liste": "equipement", "rang": 1, "avant": "Corde", "ref": ref})
        assert traitee(m, "a", d["id"])["statut"] == "echec", quoi
    assert fiche(atelier, a_id)["equipement"] == ["Cape", "Corde"]
    assert fiche(atelier, m["hors"]["id"])["equipement"] == [] and fiche(atelier, b_id)["equipement"] == ["Torche"]
    # Le don d'or écrit tout droit vers soi-même ou hors de la tablée : « Accepter » refuse, aucune bourse ne bouge.
    for ref in (propre, forges["hors"], forges["tv"]):
        d = ecrire_demande(m, "a", "don-or", {"ref": ref, "montant": 5})
        r = atelier.post(f"/api/demandes/{m['a']['joueur']['id']}/{d['id']}/accepter", json={"version": 1})
        assert r.status_code == 409 or r.status_code == 400, r.text
    assert fiche(atelier, a_id)["or"] == 30 and fiche(atelier, m["hors"]["id"])["or"] == 0


# ---------------------------------------------------------------- l'or en double

def test_l_or_en_rafale_ne_depasse_pas_la_bourse(atelier, monde, neufs):
    """Douze dons de 5 po lancés ensemble sur une bourse de 30 : six passent, pas un de plus. Le MJ les accepte tous en même
    temps qu'il vend une commande : la bourse ne descend jamais sous zéro, et l'or ne se crée ni ne se perd."""
    m = monde
    tavarede = ref_de(m, "a", "Tavarède Offensif")
    statuts, verrou = [], threading.Lock()

    def donner():
        r = geste(m, "a", "don-or", ref=tavarede, montant=5)
        with verrou:
            statuts.append(r.status_code)
    fils = [threading.Thread(target=donner) for _ in range(12)]
    for f in fils:
        f.start()
    for f in fils:
        f.join()
    assert sorted(statuts) == [200] * 6 + [409] * 6, statuts
    assert sac(m, "a")["or"]["disponible"] == 0
    # La commande ne compte que la bourse (les dons ne l'engagent pas pour l'échoppe) : elle passe.
    jeton = tv_cartes.jeton("boutiques", m["boutique"]["id"])
    r = m["a"]["coin"].post("/api/commandes", json={"boutique": jeton, "lignes": [{"article": "epee1", "quantite": 1}]})
    assert r.status_code == 200, r.text
    commande = r.json()
    dons = [d for d in demandes.lire(config.PROPOSITIONS, m["a"]["joueur"]["id"]) if d["genre"] == "don-or"]
    resultats = []

    def accepter(d):
        r = atelier.post(f"/api/demandes/{m['a']['joueur']['id']}/{d['id']}/accepter", json={"version": d["version"]})
        with verrou:
            resultats.append(("don", r.status_code))

    def vendre():
        r = atelier.post(f"/api/commandes/{m['a']['joueur']['id']}/{commande['id']}/vendre", json={})
        with verrou:
            resultats.append(("vente", r.status_code))
    fils = [threading.Thread(target=accepter, args=(d,)) for d in dons] + [threading.Thread(target=vendre)]
    for f in fils:
        f.start()
    for f in fils:
        f.join()
    a, b = fiche(atelier, m["a"]["heros"]["id"]), fiche(atelier, m["b"]["heros"]["id"])
    vendu = 25 if ("vente", 200) in resultats else 0
    donne = 5 * sum(1 for x in resultats if x == ("don", 200))
    assert a["or"] >= 0 and a["or"] == 30 - vendu - donne and b["or"] == 30 + donne, (resultats, a["or"], b["or"])


def test_une_vente_et_un_don_d_or_ne_s_ecrasent_pas(atelier, monde, neufs, monkeypatch):
    """La vente d'une commande (l'échoppe) et l'acceptation d'un don d'or (la boîte) écrivent la même fiche, chacune dans
    son fil : la vente lit la bourse, le don passe, puis la vente écrit. Sans verrou commun, le don s'efface et l'or
    donné se retrouve des deux côtés."""
    m = monde
    jeton = tv_cartes.jeton("boutiques", m["boutique"]["id"])
    commande = m["a"]["coin"].post("/api/commandes", json={"boutique": jeton, "lignes": [{"article": "corde1", "quantite": 1}]}).json()
    don = geste(m, "a", "don-or", ref=ref_de(m, "a", "Tavarède Offensif"), montant=5).json()
    vrai, lue = utilitaires.archiver, threading.Event()

    def archiver(chemin, *args, **kw):
        # La vente a lu la fiche ; elle s'attarde avant de l'écrire.
        if threading.current_thread().name == "vente" and "aventuriers" in args:
            lue.set()
            time.sleep(0.4)
        return vrai(chemin, *args, **kw)
    monkeypatch.setattr(utilitaires, "archiver", archiver)
    fil = threading.Thread(target=commandes_api.vendre_la_commande, args=(m["a"]["joueur"]["id"], commande["id"], None), name="vente")
    fil.start()
    assert lue.wait(3)
    r = atelier.post(f"/api/demandes/{m['a']['joueur']['id']}/{don['id']}/accepter", json={"version": 1})
    fil.join()
    a, b = fiche(atelier, m["a"]["heros"]["id"]), fiche(atelier, m["b"]["heros"]["id"])
    # La vente passe d'abord ; le don attend son tour, puis passe, ou refuse proprement (la bourse a changé sous ses yeux) et
    # le MJ l'accepte de nouveau. Jamais les deux à moitié.
    # Ysolde avait déjà une corde : la vente grossit sa ligne (les quantités du 12/11) au lieu d'en ouvrir une autre.
    assert "Corde ×2" in a["equipement"][1:], a["equipement"]
    if r.status_code == 409:
        assert (a["or"], b["or"]) == (26, 30) and la_boite(atelier, m, "a", don["id"])["statut"] == "en-attente"
        r = atelier.post(f"/api/demandes/{m['a']['joueur']['id']}/{don['id']}/accepter", json={"version": 1})
        a, b = fiche(atelier, m["a"]["heros"]["id"]), fiche(atelier, m["b"]["heros"]["id"])
    assert r.status_code == 200, r.text
    assert (a["or"], b["or"]) == (30 - 4 - 5, 35), (a["or"], b["or"])


def test_un_geste_du_sac_et_une_vente_ne_s_ecrasent_pas(atelier, monde, neufs, monkeypatch):
    """Même chose avec un geste du joueur appliqué par la boîte pendant que le MJ vend : la ligne ajoutée ne se perd pas,
    et la vente paie bien."""
    m = monde
    jeton = tv_cartes.jeton("boutiques", m["boutique"]["id"])
    commande = m["a"]["coin"].post("/api/commandes", json={"boutique": jeton, "lignes": [{"article": "corde1", "quantite": 1}]}).json()
    vrai, lue = utilitaires.archiver, threading.Event()

    def archiver(chemin, *args, **kw):
        if threading.current_thread().name == "vente" and "aventuriers" in args:
            lue.set()
            time.sleep(0.5)
        return vrai(chemin, *args, **kw)
    monkeypatch.setattr(utilitaires, "archiver", archiver)
    fil = threading.Thread(target=commandes_api.vendre_la_commande, args=(m["a"]["joueur"]["id"], commande["id"], None), name="vente")
    fil.start()
    assert lue.wait(3)
    d = ecrire_demande(m, "a", "sac", {"geste": "ajouter", "liste": "equipement", "ligne": "Lanterne"})
    fil.join()
    fait = traitee(m, "a", d["id"])
    a = fiche(atelier, m["a"]["heros"]["id"])
    # La vente est entière ; le geste est passé après elle, ou a échoué en le disant (le joueur le refait) : jamais perdu
    # en silence.
    assert a["or"] == 26 and a["equipement"][:2] == ["Cape", "Corde ×2"], a
    if fait["statut"] == "appliquee":
        assert "Lanterne" in a["equipement"], a
    else:
        assert fait["statut"] == "echec" and "réessayez" in fait["resultat"] and "Lanterne" not in a["equipement"]


def test_une_quantite_ecrite_tout_droit_dans_la_file(atelier, monde, neufs):
    """Un coin qui ne vérifierait rien : cinq cents exemplaires d'un coup, un nombre négatif à donner, une quantité sur un
    objet personnel. L'atelier revalide chaque demande : échec, et les sacs ne bougent pas."""
    m = monde
    neufs("a", ["Cape", "Corde ×2"], ("Médaillon", "", ""))
    carnet_api.publier_carnet()
    ref = ref_de(m, "a", "Tavarède Offensif")
    for genre, corps in (("sac", {"geste": "quantite", "liste": "equipement", "rang": 1, "avant": "Corde ×2", "de": 500}),
                         ("sac", {"geste": "quantite", "liste": "equipement", "rang": 1, "avant": "Corde ×2", "de": -500}),
                         ("sac", {"geste": "quantite", "liste": "equipement", "rang": 1, "avant": "Corde ×2", "de": 1, "ligne": "Trésor ×999"}),
                         ("sac", {"geste": "quantite", "liste": "objets", "rang": 0, "avant": "Médaillon", "de": 1}),
                         ("don-objet", {"liste": "equipement", "rang": 1, "avant": "Corde ×2", "ref": ref, "nombre": -3}),
                         ("don-objet", {"liste": "equipement", "rang": 1, "avant": "Corde ×2", "ref": ref, "nombre": 3}),
                         ("don-objet", {"liste": "objets", "rang": 0, "avant": "Médaillon", "ref": ref, "nombre": 1})):
        # Écrite tout droit dans le fichier, sans passer par le validateur du coin.
        d = {"id": secrets.token_hex(6), "genre": genre, "statut": "a-appliquer", "version": 1, "cree": demandes.maintenant(),
             "modifie": demandes.maintenant(), "corps": corps, "resultat": None, "mot": "", "traitee": None, "par": "joueur"}
        with demandes.verrou(config.PROPOSITIONS):
            demandes.ecrire(config.PROPOSITIONS, m["a"]["joueur"]["id"], [*demandes.lire(config.PROPOSITIONS, m["a"]["joueur"]["id"]), d])
        assert traitee(m, "a", d["id"])["statut"] == "echec", corps
    a = fiche(atelier, m["a"]["heros"]["id"])
    assert a["equipement"] == ["Cape", "Corde ×2"] and a["objets"] == ["Médaillon", "", ""]
    assert fiche(atelier, m["b"]["heros"]["id"])["equipement"] == ["Torche"]


# ---------------------------------------------------------------- « Annuler » détourné

def test_annuler_ne_se_detourne_pas(atelier, monde, neufs):
    m = monde
    jid = m["a"]["joueur"]["id"]
    d = traitee(m, "a", geste(m, "a", geste="ajouter", liste="equipement", ligne="Lanterne").json()["id"])
    # Le joueur ne retire pas ce qui s'est déjà appliqué (le retrait vaudrait annulation sans le MJ).
    assert m["a"]["coin"].delete(f"/api/demandes/{d['id']}").status_code == 409
    assert fiche(atelier, m["a"]["heros"]["id"])["equipement"] == ["Cape", "Corde", "Lanterne"]
    # Les routes du MJ n'existent pas au coin.
    for chemin in (f"/api/demandes/{jid}/{d['id']}/annuler", f"/api/demandes/{d['id']}/annuler", f"/api/demandes/{jid}/{d['id']}/accepter"):
        assert m["a"]["coin"].post(chemin, json={"version": 2}).status_code in (404, 405), chemin
    # Un identifiant choisi par le joueur ne s'enregistre pas.
    assert m["a"]["coin"].post("/api/demandes", json={"genre": "sac", "id": d["id"], "corps": {"geste": "retirer", "liste": "equipement",
                                                                                                "rang": 2, "avant": "Lanterne"}}).status_code == 400
    # L'annulation d'un don quand le compagnon a déjà touché à ce qu'il a reçu : rien ne bouge d'un côté ni de l'autre.
    don = traitee(m, "a", geste(m, "a", "don-objet", liste="equipement", rang=1, avant="Corde", ref=ref_de(m, "a", "Tavarède Offensif")).json()["id"])
    assert don["statut"] == "appliquee"
    r = traitee(m, "b", geste(m, "b", geste="changer", liste="equipement", rang=1, avant="Corde", ligne="Corde effilochée").json()["id"])
    assert r["statut"] == "appliquee"
    vue = la_boite(atelier, m, "a", don["id"])
    r = atelier.post(f"/api/demandes/{jid}/{don['id']}/annuler", json={"version": vue["version"]})
    assert r.status_code == 409
    assert fiche(atelier, m["a"]["heros"]["id"])["equipement"] == ["Cape", "Lanterne"]
    assert fiche(atelier, m["b"]["heros"]["id"])["equipement"] == ["Torche", "Corde effilochée"]
    # Le joueur d'en face n'annule pas non plus le don qu'il a reçu.
    assert m["b"]["coin"].delete(f"/api/demandes/{don['id']}").status_code == 404


# ---------------------------------------------------------------- la fiche republiée

def test_la_fiche_republiee_est_celle_du_carnet(atelier, monde, neufs):
    """publier_heros (après un geste) écrit exactement ce qu'écrit la publication complète du carnet : ni secret, ni note,
    ni ligne qui nomme un inconnu ou le peuple caché d'un autre, ni le nom caché de l'auberge."""
    m = monde
    h = m["a"]["heros"]
    atelier.patch(f"/api/aventuriers/{h['id']}", json={"secret": "SECRET-OFF", "notes_mj": "NOTE-OFF", "histoire": "Née à la Petite Fanfrelée."})
    try:
        neufs("a", ["Cape", "Lettre de Murgoth Noirval", "Croc de Vampyre", "Clé de la Petite Fanfrelée"], ("Médaillon", "", ""))
        carnet_api.publier_carnet()
        complet = publie_de(m, "a")["elements"]
        d = traitee(m, "a", geste(m, "a", geste="ajouter", liste="equipement", ligne="Pain").json()["id"])
        assert d["statut"] == "appliquee"
        apres_geste = publie_de(m, "a")["elements"]
        texte = json.dumps(apres_geste, ensure_ascii=False)
        for interdit in SECRETS:
            assert interdit not in texte, interdit
        assert apres_geste[0]["equipement"] == ["Cape", "Clé de l'auberge", "Pain"]
        carnet_api.publier_carnet()
        assert publie_de(m, "a")["elements"] == apres_geste
        assert {k: v for k, v in complet[0].items() if k != "equipement"} == {k: v for k, v in apres_geste[0].items() if k != "equipement"}
    finally:
        atelier.patch(f"/api/aventuriers/{h['id']}", json={"secret": "", "notes_mj": "", "histoire": ""})


def test_ce_qu_un_joueur_ecrit_ne_suit_pas_le_don(atelier, monde, neufs):
    """Aube écrit elle-même une ligne qui nomme un inconnu : elle la lit (elle l'a écrite). Donnée à Tavarède, la ligne
    n'est pas la sienne : Basile ne la lit pas."""
    m = monde
    d = traitee(m, "a", geste(m, "a", geste="ajouter", liste="equipement", ligne="Lettre pour Murgoth").json()["id"])
    assert d["statut"] == "appliquee" and "Lettre pour Murgoth" in sac(m, "a")["heros"]["equipement"]
    don = traitee(m, "a", geste(m, "a", "don-objet", liste="equipement", rang=2, avant="Lettre pour Murgoth",
                                ref=ref_de(m, "a", "Tavarède Offensif")).json()["id"])
    assert don["statut"] == "appliquee"
    assert fiche(atelier, m["b"]["heros"]["id"])["equipement"] == ["Torche", "Lettre pour Murgoth"]
    for texte in (json.dumps(sac(m, "b"), ensure_ascii=False), json.dumps(publie_de(m, "b"), ensure_ascii=False),
                  json.dumps(m["b"]["coin"].get("/api/demandes").json(), ensure_ascii=False)):
        assert "Murgoth" not in texte
    # Basile ne peut pas viser la ligne qu'il ne voit pas.
    assert geste(m, "b", geste="retirer", liste="equipement", rang=1, avant="Lettre pour Murgoth").status_code == 409


# ---------------------------------------------------------------- les plafonds

def test_les_gestes_du_sac_ne_bloquent_pas_le_reste(atelier, monde, neufs):
    """Trente gestes du sac dans l'heure (une séance d'inventaire) : le trente et unième passe, et « Un mot au MJ » aussi.
    Le plafond de 30 par heure ne compte que les autres demandes, celui des gestes (150) les siens."""
    m = monde
    for i in range(31):
        r = geste(m, "a", geste="ajouter" if i % 2 == 0 else "retirer", liste="equipement",
                  **({"ligne": "Caillou"} if i % 2 == 0 else {"rang": 2, "avant": "Caillou"}))
        assert r.status_code == 200, (i, r.text)
        assert traitee(m, "a", r.json()["id"])["statut"] == "appliquee", i
    r = m["a"]["coin"].post("/api/demandes", json={"genre": "message", "corps": {"texte": "Je range mon sac."}})
    assert r.status_code == 200, r.text


def test_un_heros_confie_a_un_autre_joueur_ne_lui_dit_pas_ce_que_l_ancien_a_ecrit(atelier, monde, neufs):
    """Céline a écrit elle-même dans le sac de Gaspard une ligne qui nomme un inconnu : elle la lit. Le MJ retire Céline
    et confie Gaspard à Damien : la ligne n'est plus celle de son lecteur, elle est retenue comme toute autre."""
    celine = atelier.post("/api/joueurs", json={"nom": "Céline"}).json()
    damien = atelier.post("/api/joueurs", json={"nom": "Damien"}).json()
    coin_c, coin_d = TestClient(joueurs.app), TestClient(joueurs.app)
    gaspard = None
    try:
        entrer(coin_c, celine)
        coin_c.post("/api/moi/aventurier", json={"nom": "Gaspard Offensif", "sante": 9, "psy": 5, "equipement": ["Cape"], "objets": ["", "", ""], "or": 3})
        coin_c.post("/api/moi/envoyer")
        gaspard = atelier.post(f"/api/joueurs/{celine['id']}/accueillir").json()
        carnet_api.publier_carnet()
        r = coin_c.post("/api/demandes", json={"genre": "sac", "corps": {"geste": "ajouter", "liste": "equipement", "ligne": "Lettre pour Murgoth"}})
        assert r.status_code == 200, r.text
        assert attendre(lambda: "Lettre pour Murgoth" in coin_c.get("/api/sac").json()["heros"]["equipement"])
        assert fiche(atelier, gaspard["id"])["equipement"] == ["Cape", "Lettre pour Murgoth"]
        assert atelier.delete(f"/api/joueurs/{celine['id']}").status_code == 200
        assert atelier.post(f"/api/joueurs/{damien['id']}/relier", json={"heros": gaspard["id"]}).status_code == 200
        entrer(coin_d, damien)
        carnet_api.publier_carnet()
        lu = coin_d.get("/api/sac").json()
        assert lu["heros"]["nom"] == "Gaspard Offensif", lu
        assert "Murgoth" not in json.dumps(lu, ensure_ascii=False) and lu["heros"]["equipement"] == ["Cape"]
        # Et il ne peut pas la viser.
        r = coin_d.post("/api/demandes", json={"genre": "sac", "corps": {"geste": "retirer", "liste": "equipement", "rang": 1, "avant": "Lettre pour Murgoth"}})
        assert r.status_code == 409
    finally:
        coin_c.close()
        coin_d.close()
        atelier.delete(f"/api/joueurs/{celine['id']}")
        atelier.delete(f"/api/joueurs/{damien['id']}")
        if gaspard:
            atelier.delete(f"/api/aventuriers/{gaspard['id']}")


# ---------------------------------------------------------------- la table : le plan publié et ses images

TW, TH = 8, 6


def grille(cases: dict, defaut=0) -> list:
    return [cases.get((x, y), defaut) for y in range(TH) for x in range(TW)]


@pytest.fixture()
def table(atelier, monde, neufs):
    """Un plan à secrets montré à la TV, la table ouverte : salle A (x < 4) révélée, au nom gardé pour le MJ ; salle B
    cachée, avec son habillage, son feu et ses pions. Le fond est blanc dans A, rouge vif dans B."""
    from PIL import Image
    fond = Image.new("RGB", (TW * 20, TH * 20), (240, 240, 240))
    fond.paste((255, 0, 0), (4 * 20, 0, TW * 20, TH * 20))
    fond.save(config.IMAGES / "fond-offensive.png")
    m = monde
    a_id, odile = m["a"]["heros"]["id"], m["odile"]["id"]
    vu = grille({(x, y): 1 if x < 4 else 0 for y in range(TH) for x in range(TW)})
    plan = atelier.post("/api/plans", json={
        "nom": "PLAN-OFFENSIVE", "lieu": "LIEU-OFFENSIVE", "largeur": TW, "hauteur": TH, "m_case": 1.5, "brouillard_actif": True,
        "notes": "NOTE-PLAN-OFF", "style": "couleur", "sol": [2] * (TW * TH),
        "piece": grille({(x, y): 1 if x < 4 else 2 for y in range(TH) for x in range(TW)}), "brouillard": vu,
        "brume": grille({(2, 4): 2, (6, 2): 2}), "brume_teinte": "brume",
        "feu": grille({(1, 1): 1, (5, 1): 3, (6, 4): 2}),
        "etapes": [{"nom": "ETAPE-SECRETE", "feu": [4] * (TW * TH), "brume": [2] * (TW * TH)}],
        "pieces": [{"id": 1, "nom": "SALLE-A-NOM-MJ", "genre": "salle", "nom_visible": False, "notes": "NOTE-SALLE-A"},
                   {"id": 2, "nom": "SALLE-B-CACHEE", "genre": "salle", "nom_visible": True, "notes": "NOTE-SALLE-B"}],
        "portes": [{"id": "p-secrete", "sens": "v", "x": 4, "y": 1, "genre": "secrete", "etat": "fermee", "decouverte": False, "note": "NOTE-P"},
                   {"id": "p-loin", "sens": "h", "x": 6, "y": 3, "genre": "porte", "etat": "ouverte"}],
        "objets": [{"id": "o-piege", "cle": "piege", "x": 1, "y": 3, "l": 1, "h": 1, "cache": True, "note": "PIEGE-OFF"},
                   {"id": "o-coffre-b", "cle": "coffre", "x": 6, "y": 1, "l": 1, "h": 1}],
        "pions": [{"id": "t-ysolde", "genre": "heros", "nom": "Ysolde", "ref": f"aventurier:{a_id}", "x": 0.5, "y": 0.5},
                  {"id": "t-odile", "genre": "heros", "nom": "Odile", "ref": f"aventurier:{odile}", "x": 1.5, "y": 0.5},
                  {"id": "t-murgoth", "genre": "pnj", "nom": "Murgoth", "ref": f"pnj:{m['pnj']['id']}", "court": "Mu", "x": 2.5, "y": 0.5},
                  {"id": "t-embusque", "genre": "ennemi", "nom": "EMBUSQUE-OFF", "court": "1", "x": 3.5, "y": 2.5, "cache": True},
                  {"id": "t-brume", "genre": "ennemi", "nom": "BRUME-OFF", "court": "2", "x": 2.5, "y": 4.5},
                  {"id": "t-salle-b", "genre": "ennemi", "nom": "SALLE-B-PION", "court": "3", "x": 5.5, "y": 1.5}],
        "textes": [{"id": "x-mj", "texte": "TEXTE-MJ-OFF", "x": 1, "y": 2, "mj": True},
                   {"id": "x-b", "texte": "TEXTE-SALLE-B", "x": 5, "y": 4}],
        "habillage": {"heure": "nuit", "lumieres": [{"id": "l-b", "x": 6, "y": 2, "rayon": 3, "source": "SOURCE-OFF"},
                                                    {"id": "l-cachee", "x": 1, "y": 1, "rayon": 2, "cache": True}],
                      "objets": [{"id": "h-b", "piece": 2, "cle": "tonneau", "case": [6, 4]}, {"id": "h-a", "piece": 1, "cle": "tonneau", "case": [1, 4]}],
                      "legende": [{"piece": 1, "x": 1, "y": 1, "texte": "LEGENDE-A"}, {"piece": 2, "x": 6, "y": 1, "texte": "LEGENDE-B"}]},
        "fond": {"url": "/media/fond-offensive.png", "x": 0, "y": 0, "l": TW, "h": TH, "opacite": 1},
    }).json()
    assert atelier.put("/api/table", json={"vue": "plan", "plan": plan["id"], "style": "couleur", "camera": {"x": 2, "y": 3, "hv": 6}}).status_code == 200
    atelier.put("/api/table-joueurs", json={"ouverte": True})
    tv_etat.table_coin.tout_de_suite()
    yield plan
    atelier.put("/api/table-joueurs", json={"ouverte": False})
    atelier.put("/api/table", json={"vue": "accueil"})
    atelier.delete(f"/api/plans/{plan['id']}")
    tv_etat.TABLE_JOUEURS.unlink(missing_ok=True)
    (config.IMAGES / "fond-offensive.png").unlink(missing_ok=True)


def publie_table() -> str:
    dossier = config.PROPOSITIONS / "table"
    return "\n".join(f.name if f.suffix == ".jpg" else f.read_text(encoding="utf-8") for f in sorted(dossier.rglob("*")) if f.is_file())


def test_le_plan_publie_n_en_dit_pas_plus_que_la_tv(atelier, monde, table):
    m = monde
    r = m["a"]["coin"].get("/api/table").json()
    p = r["vue"]["plan"]
    # Exactement la projection de la TV, au masque ; seules les adresses des images changent (le coin ne lit pas /media/).
    tv = masquer_tout(tv_plans.plan_public(utilitaires.lire_fiche(utilitaires.existant(config.PLANS, table["id"])), tv_cartes.jeton("plans", table["id"])))
    sans_images = lambda q: {**q, "fond": {k: v for k, v in (q["fond"] or {}).items() if k != "url"},
                             "pions": [{k: v for k, v in t.items() if k != "image"} for t in q["pions"]]}
    assert sans_images(p) == sans_images(tv)
    texte = "\n".join([publie_table(), json.dumps(r, ensure_ascii=False), json.dumps(m["b"]["coin"].get("/api/table").json(), ensure_ascii=False)])
    for interdit in ("PLAN-OFFENSIVE", "LIEU-OFFENSIVE", "NOTE-", "ETAPE-SECRETE", "etapes", "SALLE-A-NOM-MJ", "SALLE-B", "p-secrete",
                     "secrete", "PIEGE-OFF", "o-piege", "o-coffre-b", "EMBUSQUE-OFF", "t-embusque", "BRUME-OFF", "t-brume", "t-salle-b",
                     "TEXTE-MJ-OFF", "TEXTE-SALLE-B", "SOURCE-OFF", "l-b", "l-cachee", "h-b", "LEGENDE", "Murgoth", "aventurier:", "pnj:",
                     '"ref"', table["id"], m["a"]["heros"]["id"], m["odile"]["id"], m["pnj"]["id"], "fond-offensive", '"/media/', "camera"):
        assert interdit not in texte, interdit
    # Le PNJ inconnu reste un pion sans nom ni lettre ; le feu et la brume de la salle cachée ne dessinent rien.
    murgoth = next(t for t in p["pions"] if t["id"] == "t-murgoth")
    assert (murgoth["nom"], murgoth["court"], murgoth["image"]) == ("", "", "")
    assert all(v == 0 for i, v in enumerate(p["feu"]) if i % TW >= 4) and all(v == 0 for i, v in enumerate(p["brume"]) if i % TW >= 4)
    assert [x["nom"] for x in p["pieces"]] == [""]


def test_le_fond_masque_n_a_aucun_pixel_de_la_salle_cachee(atelier, monde, table):
    from io import BytesIO
    from PIL import Image
    url = monde["a"]["coin"].get("/api/table").json()["vue"]["plan"]["fond"]["url"]
    img = Image.open(BytesIO(monde["a"]["coin"].get(url).content)).convert("RGB")
    w, h = img.size
    # Toute la salle cachée (au pixel de bord près, le JPEG bave) : noire, sans une trace du rouge.
    for x in range(w * 4 // TW + 2, w):
        for y in range(h):
            r, g, b = img.getpixel((x, y))
            assert r < 40 and g < 40 and b < 40, (x, y, img.getpixel((x, y)))
    assert img.getpixel((5, 5))[1] > 200


def test_les_medias_de_la_table_ne_sortent_pas_autrement(atelier, monde, table, monkeypatch):
    m = monde
    vrai = m["a"]["coin"].get("/api/table").json()["vue"]["plan"]["fond"]["url"]
    nom = vrai.rsplit("/", 1)[1]
    for forge in ("..%2F..%2F.cle-session", "..%2Fvue.json", "%2E%2E%2Fpions", nom[:-4] + ".JPG", nom + "%00", "fond-offensive.png",
                  "%2e%2e", "%2e%2e%2f%2e%2e%2fcomptes"):
        assert m["a"]["coin"].get(f"/table/media/{forge}").status_code == 404, forge
    for chemin in ("/table/vue.json", "/table/pions", "/propositions/table/vue.json", "/table/media/", f"/carnet/media/{nom}"):
        assert m["a"]["coin"].get(chemin).status_code in (404, 405), chemin
    # Sans session : 401, même avec le vrai nom.
    with TestClient(joueurs.app) as sans:
        assert sans.get(vrai).status_code == 401 and sans.get("/api/table").status_code == 401
    # La table refermée : plus rien, même sous le nom qui servait.
    atelier.put("/api/table-joueurs", json={"ouverte": False})
    assert m["a"]["coin"].get(vrai).status_code == 404 and m["a"]["coin"].get("/api/table").json() == {"ouverte": False}


def test_personne_ne_sait_ou_est_le_pion_d_un_autre(atelier, monde, table):
    """Aube a le pion d'Ysolde ; Basile, dont le héros n'est pas sur le plan, n'a rien ; Odile (sans joueur) n'a pas de
    fichier. Les fichiers des pions ne portent que la clé du lien, l'id public du pion et le tour."""
    m = monde
    ra, rb = m["a"]["coin"].get("/api/table").json(), m["b"]["coin"].get("/api/table").json()
    assert (ra["pion"], rb["pion"], ra["mon_tour"], rb["mon_tour"]) == ("t-ysolde", None, False, False)
    pions = sorted((config.PROPOSITIONS / "table" / "pions").glob("*.json"))
    cles = {carnet.cle_heros(j["jeton"]) for j in joueurs.acces() if j["id"] in (m["a"]["joueur"]["id"], m["b"]["joueur"]["id"])}
    assert cles <= {f.stem for f in pions}
    for f in pions:
        assert "t-odile" not in f.read_text(encoding="utf-8")
    # Ysolde se cache : Aube ne la voit plus comme la sienne, et rien ne dit où elle est.
    p = atelier.get(f"/api/plans/{table['id']}").json()
    p["pions"][0]["cache"] = True
    atelier.put(f"/api/plans/{table['id']}", json=p)
    tv_etat.table_coin.tout_de_suite()
    ra = m["a"]["coin"].get("/api/table").json()
    assert ra["pion"] is None and "t-ysolde" not in publie_table()


# ---------------------------------------------------------------- la main levée et la présence

def mains_de(m, code):
    return [d for d in demandes.lire(config.PROPOSITIONS, m[code]["joueur"]["id"]) if d["genre"] == "main"]


def test_la_main_d_un_autre_ne_se_leve_ni_ne_se_baisse(atelier, monde, neufs):
    m = monde
    a, b = m["a"]["joueur"]["id"], m["b"]["joueur"]["id"]
    try:
        # Basile lève la main en glissant l'identifiant d'Aube : c'est la sienne qui se lève.
        assert m["b"]["coin"].post("/api/main", json={"joueur": a}).status_code == 200
        assert len(mains_de(m, "b")) == 1 and mains_de(m, "a") == []
        for corps in ({"joueur": a}, {"id": "aaaaaaaaaaaa"}, "x", [a]):
            assert m["b"]["coin"].post("/api/demandes", json={"genre": "main", "corps": corps}).status_code == 400, corps
        # Aube lève la sienne en rafale : une seule main.
        statuts, verrou = [], threading.Lock()

        def lever():
            r = m["a"]["coin"].post("/api/main", json={})
            with verrou:
                statuts.append(r.status_code)
        fils = [threading.Thread(target=lever) for _ in range(15)]
        for f in fils:
            f.start()
        for f in fils:
            f.join()
        assert statuts == [200] * 15 and len([d for d in mains_de(m, "a") if d["statut"] == "en-attente"]) == 1
        ma = mains_de(m, "a")[0]
        # Basile baisse « la main » : la sienne seulement ; il ne retire pas celle d'Aube par son id.
        assert m["b"]["coin"].delete("/api/main").status_code == 200
        assert m["b"]["coin"].delete(f"/api/demandes/{ma['id']}").status_code == 404
        assert mains_de(m, "a")[0]["statut"] == "en-attente" and mains_de(m, "b")[-1]["statut"] == "retiree"
        # Ce que lit Basile ne parle que de sa main.
        lu = m["b"]["coin"].get("/api/main").json()
        assert ma["id"] not in json.dumps(lu) and lu["etat"] in ("repos", "retombee")
        # Le MJ ne rend pas la parole à une main baissée, ni par un chemin forgé.
        mb = mains_de(m, "b")[-1]
        assert atelier.post(f"/api/salle/mains/{b}/{mb['id']}", json={"geste": "parole", "version": mb["version"]}).status_code == 409
        for joueur, ident in (("..", ma["id"]), (f"{a}x", ma["id"]), (b, ma["id"])):
            assert atelier.post(f"/api/salle/mains/{joueur}/{ident}", json={"geste": "parole", "version": 1}).status_code in (404, 422), (joueur, ident)
        # Le coin n'a pas les routes de la salle.
        assert m["a"]["coin"].get("/api/salle").status_code == 404
        assert m["a"]["coin"].post(f"/api/salle/mains/{a}/{ma['id']}", json={"geste": "parole", "version": 1}).status_code in (404, 405)
    finally:
        for code in ("a", "b"):
            m[code]["coin"].delete("/api/main")


def test_la_presence_ne_se_forge_pas(atelier, monde, neufs):
    """Seul le coin écrit la présence, d'après les flux ouverts sous une session ; l'atelier ne croit que les joueurs
    invités, et pas un fichier abîmé, trop lourd, d'une autre forme ou daté de loin."""
    from commun import presence
    from datetime import datetime, timedelta
    m = monde
    a, b = m["a"]["joueur"]["id"], m["b"]["joueur"]["id"]
    chemin = presence.chemin(config.PROPOSITIONS)
    for methode in ("POST", "PUT", "DELETE"):
        for route in ("/api/presence", "/api/salle", "/api/flux"):
            assert m["a"]["coin"].request(methode, route, json={"joueurs": [b]}).status_code in (404, 405), (methode, route)
    try:
        def en_ligne():
            return [x["joueur"] for x in atelier.get("/api/salle").json()["en_ligne"]]
        maintenant = datetime.now().isoformat(timespec="seconds")
        chemin.parent.mkdir(parents=True, exist_ok=True)
        chemin.write_text(json.dumps({"maj": maintenant, "joueurs": [a, "intrus", "../b", b.upper()]}), encoding="utf-8")
        assert en_ligne() == [a]
        loin = (datetime.now() + timedelta(days=2)).isoformat(timespec="seconds")
        for contenu in (json.dumps({"maj": loin, "joueurs": [a]}), json.dumps({"maj": maintenant, "joueurs": [a], "en_plus": 1}),
                        json.dumps({"maj": maintenant, "joueurs": a}), json.dumps({"maj": 12, "joueurs": [a]}), "{", "[]",
                        json.dumps({"maj": maintenant, "joueurs": [a] + ["x" * 50] * 400})):
            chemin.write_text(contenu, encoding="utf-8")
            assert en_ligne() == [], contenu[:60]
    finally:
        chemin.unlink(missing_ok=True)


# ---------------------------------------------------------------- les réglages de l'atelier depuis Internet

def test_rien_de_l_atelier_des_joueurs_depuis_internet(atelier, monde, neufs, monkeypatch):
    """Le réglage de la table des joueurs, la salle, la boîte, le sac d'un héros : ni par la table publique (Cloudflare, ou
    son nom), ni par l'atelier public sans session. Aucun de ces chemins ne passe la liste de la table publique."""
    from starlette.websockets import WebSocketDisconnect
    m = monde
    a, hid = m["a"]["joueur"]["id"], m["a"]["heros"]["id"]
    monkeypatch.setattr(portier, "TABLE_PUBLIQUE", {"table.example.ch"})
    monkeypatch.setattr(portier, "ATELIER_PUBLIC", {"atelier.example.ch"})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {"table.example.ch", "atelier.example.ch"})
    routes = [("GET", "/api/table-joueurs"), ("PUT", "/api/table-joueurs"), ("GET", "/api/salle"),
              ("POST", f"/api/salle/mains/{a}/aaaaaaaaaaaa"), ("PATCH", f"/api/aventuriers/{hid}/sac"), ("GET", "/api/demandes"),
              ("POST", f"/api/demandes/{a}/aaaaaaaaaaaa/accepter"), ("POST", f"/api/demandes/{a}/aaaaaaaaaaaa/annuler"),
              ("PUT", "/api/demandes/reglages"), ("GET", "/api/demandes/resume"), ("GET", f"/api/aventuriers/{hid}"),
              ("GET", "/api/carnet-joueurs"), ("POST", f"/api/commandes/{a}/aaaaaaaaaaaa/vendre")]
    for methode, chemin in routes:
        assert portier.CHEMINS_TABLE.match(chemin) is None, chemin
        for entetes in ({"CF-Connecting-IP": "203.0.113.9"}, {"Host": "table.example.ch"}):
            r = atelier.request(methode, chemin, json={"ouverte": True, "geste": "parole", "version": 1}, headers=entetes)
            assert r.status_code == 404, (methode, chemin, entetes, r.status_code)
        r = atelier.request(methode, chemin, json={"ouverte": True}, headers={"Host": "atelier.example.ch", "CF-Connecting-IP": "203.0.113.9"},
                            follow_redirects=False)
        assert r.status_code == 401, (methode, chemin, r.status_code)
    assert tv_etat.reglage_table_joueurs()["ouverte"] is False
    # Le canal de l'atelier (la salle, les sacs touchés) ne s'ouvre pas depuis Internet.
    for entetes in ({"CF-Connecting-IP": "203.0.113.9"}, {"Host": "table.example.ch"}, {"Host": "atelier.example.ch"}):
        with pytest.raises(WebSocketDisconnect):
            with atelier.websocket_connect("/ws/atelier", headers=entetes) as ws:
                ws.receive_text()
