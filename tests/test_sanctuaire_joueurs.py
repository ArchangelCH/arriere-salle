"""Le sanctuaire des joueurs (lot B2, cagnottes.py et sanctuaire_joueurs.py) : caché tant que le MJ ne le montre pas,
puis le village et ses chantiers dans le carnet, et les seuls projets qu'il coche. Le joueur verse de la bourse de son
héros dans une cagnotte ou propose un projet ; tout attend le MJ, qui accepte par les cœurs des routes du sanctuaire (la
bourse revérifiée, le niveau bâti dès qu'il est payé, les journaux tenus), ou refuse. Et les fuites : ni notes du MJ, ni
bâtiment caché, ni type non coché, ni journal, ni nom caché de l'auberge, ni inconnu nommé dans un bonus."""
import json
import os
import sys
import tempfile
from datetime import date
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from coin_mj import boite as boite_mod  # noqa: E402
from commun import cagnottes  # noqa: E402
from commun import carnet  # noqa: E402
from commun import demandes  # noqa: E402
from commun import flux_coin  # noqa: E402
import joueurs  # noqa: E402
from table import masque  # noqa: E402
from contenu import sanctuaire  # noqa: E402
from coin_mj import sanctuaire_joueurs  # noqa: E402
from comptes_coin import entrer  # noqa: E402
import main  # noqa: E402
from api import application, carnet_api, config, heros_etat, refuge, tv_cartes, utilitaires  # noqa: E402

NOTE = "NOTE-MJ-SANCT"
CACHE = "TOUR-CACHEE-SANCT"
NON_COCHE = "TYPE-NON-COCHE"
JOURNAL = "JOURNAL-SANCT"
OMBRE = "OMBRE-QUI-VERSE"
SECRETS = (NOTE, CACHE, NON_COCHE, JOURNAL, OMBRE, "Gorvak", "anfrel", "ne dort", '"notes_mj"', '"journal"', '"catalogue"', '"cache"')



@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture(scope="module")
def tablee(atelier):
    """Aube (Ysolde Gris) et Basile (Tavarède Lavelle) à la tablée, un PNJ inconnu, le carnet ouvert."""
    patch = pytest.MonkeyPatch()
    patch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    patch.setattr(joueurs, "COOKIE_SUR", False)
    patch.setattr(joueurs, "HOTES", set())
    patch.setattr(joueurs, "DEMANDES_FAITES", {})
    t = {"pnj": atelier.post("/api/pnj", json={"nom": "Gorvak Sombrefer", "connu": False}).json()}
    for code, nom, heros in (("a", "Aube", "Ysolde Gris"), ("b", "Basile", "Tavarède Lavelle")):
        invite = atelier.post("/api/joueurs", json={"nom": nom}).json()
        coin = TestClient(joueurs.app)
        entrer(coin, invite)
        coin.post("/api/moi/aventurier", json={"nom": heros, "sante": 9, "psy": 5, "equipement": ["Cape"], "objets": ["", "", ""], "or": 100})
        coin.post("/api/moi/envoyer")
        fiche = atelier.post(f"/api/joueurs/{invite['id']}/accueillir").json()
        t[code] = {"joueur": invite, "coin": coin, "heros": fiche}
    t["seance"] = atelier.post("/api/seances", json={"nom": "Essai du sanctuaire", "numero": 1, "date": date.today().isoformat()}).json()
    avant = carnet_api.carnet_ouvert()
    atelier.put("/api/carnet-joueurs", json={"ouvert": True})
    yield t
    for code in ("a", "b"):
        t[code]["coin"].close()
        atelier.delete(f"/api/joueurs/{t[code]['joueur']['id']}")
        atelier.delete(f"/api/aventuriers/{t[code]['heros']['id']}")
    atelier.delete(f"/api/pnj/{t['pnj']['id']}")
    atelier.delete(f"/api/seances/{t['seance']['id']}")
    atelier.put("/api/carnet-joueurs", json={"ouvert": avant})
    demandes.ecrire_pause(config.PROPOSITIONS, False)
    refuge.SANCTUAIRE.unlink(missing_ok=True)
    carnet_api.publier_carnet()
    patch.undo()


def bourse(atelier, t, code, valeur=None):
    h = t[code]["heros"]
    f = atelier.get(f"/api/aventuriers/{h['id']}").json()
    if valeur is not None:
        r = atelier.patch(f"/api/aventuriers/{h['id']}/sac", json={"or": {"avant": heros_etat.sac_de(f, "or"), "apres": valeur}})
        assert r.status_code == 200, r.text
        carnet_api.publier_carnet()
        return valeur
    return f["or"]


def poser(joueurs_voient=True, coches=("forge", "maison", "tour"), retouche=None):
    """Le sanctuaire d'essai : l'auberge en ruines (150 po pour le niveau I), une tour cachée, des notes et un journal du
    MJ ; publié tout de suite."""
    s = sanctuaire.nouveau_sanctuaire()
    s["joueurs"] = joueurs_voient
    s["notes_mj"] = NOTE
    s["journal"] = [{"t": "2026-11-01T10:00:00", "texte": JOURNAL}]
    for t in s["catalogue"]:
        t["joueurs"] = t["type"] in coches
        if t["type"] == "autel":
            t["nom"] = f"L'autel {NON_COCHE}"
            t["description"] = NON_COCHE
    s["batiments"][0]["notes_mj"] = NOTE
    s["batiments"].append({"id": "tour", "type": "tour", "nom": f"La tour {CACHE}", "niveau": 1, "ruine": False, "cache": True,
                           "x": 1370, "y": 220, "cagnotte": 20, "versements": [{"id": "abcd0001", "aventurier": "x", "nom": OMBRE, "or": 20,
                                                                                    "pour": 2, "niveau": 1, "t": "2026-11-01"}],
                           "notes_mj": NOTE, "boutique": ""})
    if retouche:
        retouche(s)
    utilitaires.ecrire(refuge.SANCTUAIRE, s | {"modifie": utilitaires.maintenant()})
    carnet_api.publier_carnet()
    return s


@pytest.fixture()
def neuf(atelier, tablee):
    """Chaque essai part d'un sanctuaire connu, de bourses à 100 po, sans demande ni commande."""
    for code in ("a", "b"):
        bourse(atelier, tablee, code, 100)
        with demandes.verrou(config.PROPOSITIONS):
            demandes.fichier(config.PROPOSITIONS, tablee[code]["joueur"]["id"]).unlink(missing_ok=True)
    joueurs.DEMANDES_FAITES.clear()
    demandes.ecrire_pause(config.PROPOSITIONS, False)
    poser()
    yield
    refuge.SANCTUAIRE.unlink(missing_ok=True)


def lu(t, code):
    return t[code]["coin"].get("/api/sanctuaire").json()


def section(t, code):
    return cagnottes.lire_section(lu(t, code)["elements"])


def auberge(t, code="a"):
    return next(b for b in section(t, code)["batiments"] if b["nom"] == "L'auberge" or b["etat"] == "En ruines")


def demander(t, code, genre, **corps):
    return t[code]["coin"].post("/api/demandes", json={"genre": genre, "corps": corps})


def dans_la_boite(atelier, t, code, ident):
    v = atelier.get("/api/demandes").json()
    return next(x for x in v["attente"] + v["historique"] if x["joueur"] == t[code]["joueur"]["id"] and x["id"] == ident)


def trancher(atelier, t, code, ident, geste="accepter", mot=""):
    x = dans_la_boite(atelier, t, code, ident)
    return atelier.post(f"/api/demandes/{t[code]['joueur']['id']}/{ident}/{geste}", json={"version": x["version"], "mot": mot})


def la_demande(t, code, ident):
    return demandes.trouver(demandes.lire(config.PROPOSITIONS, t[code]["joueur"]["id"]), ident)


def ecrire_demande(t, code, genre, corps):
    """Une demande écrite tout droit dans la file, comme un coin qui ne vérifierait rien."""
    d = demandes.nouvelle({"genre": genre, "corps": corps})
    with demandes.verrou(config.PROPOSITIONS):
        jid = t[code]["joueur"]["id"]
        demandes.ecrire(config.PROPOSITIONS, jid, [*demandes.lire(config.PROPOSITIONS, jid), d])
    return d


def batiment_disque(ident="auberge"):
    return next(b for b in refuge.lire_sanctuaire()["batiments"] if b["id"] == ident)


# ---------------------------------------------------------------- caché par défaut, champs gardés

def test_cache_par_defaut(atelier, tablee):
    refuge.SANCTUAIRE.unlink(missing_ok=True)
    s = atelier.get("/api/sanctuaire").json()
    assert s["joueurs"] is False and all(t["joueurs"] is False for t in s["catalogue"])
    carnet_api.publier_carnet()
    assert not (config.PROPOSITIONS / carnet.CARNET / "sanctuaire.json").exists()
    assert lu(tablee, "a") == {"ouvert": True, "visible": False}
    assert tablee["a"]["coin"].get("/api/carnet").json()["sanctuaire"] == []
    r = demander(tablee, "a", "versement", batiment="0" * 20, **{"or": 5})
    assert r.status_code == 409 and "pas ouvert aux joueurs" in r.json()["detail"]


def test_l_onglet_garde_les_champs_des_joueurs(atelier, tablee):
    refuge.SANCTUAIRE.unlink(missing_ok=True)
    s = atelier.get("/api/sanctuaire").json()
    s["joueurs"] = True
    s["catalogue"][4]["joueurs"] = True
    s["catalogue"][5]["joueurs"] = "oui"
    s["version_base"] = s["modifie"]
    r = atelier.put("/api/sanctuaire", json=s).json()
    assert r["joueurs"] is True and r["catalogue"][4]["joueurs"] is True and r["catalogue"][5]["joueurs"] is False
    # Un écran qui n'envoie pas « joueurs » (resté ouvert depuis avant) ne le change pas.
    sans = {k: v for k, v in r.items() if k != "joueurs"} | {"version_base": r["modifie"]}
    assert atelier.put("/api/sanctuaire", json=sans).json()["joueurs"] is True
    assert sanctuaire.type_valide({"type": "x", "joueurs": 1})["joueurs"] is False
    refuge.SANCTUAIRE.unlink(missing_ok=True)


# ---------------------------------------------------------------- ce que lit le joueur

def test_le_village_et_les_projets(atelier, tablee, neuf):
    r = lu(tablee, "a")
    assert r["visible"] is True and r["or"]["disponible"] == 100 and r["heros"]["nom"] == "Ysolde Gris"
    sec = cagnottes.lire_section(r["elements"])
    assert sec["village"]["nom"] == "Le sanctuaire" and sec["village"]["habitants"] == 0
    assert [b["etat"] for b in sec["batiments"]] == ["En ruines"]
    a = sec["batiments"][0]
    assert a["prochain"]["cout"] == 150 and a["cagnotte"] == 0 and a["id"] == tv_cartes.jeton("sanctuaire", "auberge")
    # Les projets cochés, et la tour (unique) aussi : celle du village est cachée, son absence la trahirait.
    assert sorted(p["nom"] for p in sec["projets"]) == ["La forge", "La tour de guet", "Une maison"]
    forge = next(p for p in sec["projets"] if p["nom"] == "La forge")
    assert [n["cout"] for n in forge["niveaux"]] == [150, 400, 900] and forge["unique"] is True
    # Le carnet le porte aussi, pour son premier dessin et pour l'aperçu du MJ.
    c = tablee["a"]["coin"].get("/api/carnet").json()
    assert c["sanctuaire"] == r["elements"]
    assert "sanctuaire" in {x["section"] for x in carnet.publie(config.PROPOSITIONS, carnet.SOMMAIRE)["elements"]}


def test_rien_de_secret_ne_part(atelier, tablee, neuf):
    """Notes du MJ, bâtiment caché (son nom, son jeton, ses versements), type non coché, journal ; le nom caché de
    l'auberge dans un nom de bâtiment, un bonus, une description ; un inconnu nommé dans un bonus."""
    def retoucher(s):
        s["nom"] = "Le refuge de la Petite Fanfrelée"
        s["batiments"][0].update(nom="La Petite Fanfrelée", niveau=1, ruine=False)
        t = s["catalogue"][0]
        t["niveaux"][0]["bonus"] = "Repas offerts à la Fanfrelée."
        t["niveaux"][1]["bonus"] = "Gorvak Sombrefer y dort."
        forge = next(x for x in s["catalogue"] if x["type"] == "forge")
        forge["description"] = "Forgée pour Jamais ne dort."
        forge["niveaux"][2]["bonus"] = "Une lame de Gorvak Sombrefer."
    poser(retouche=retoucher)
    brut = (config.PROPOSITIONS / carnet.CARNET / "sanctuaire.json").read_text(encoding="utf-8")
    for texte in (brut, json.dumps(lu(tablee, "a"), ensure_ascii=False), json.dumps(tablee["b"]["coin"].get("/api/carnet").json(), ensure_ascii=False)):
        for secret in SECRETS:
            assert secret not in texte, secret
        for ident in (tv_cartes.jeton("sanctuaire", "tour"), tv_cartes.jeton("sanctuaire-type", "autel")):
            assert ident not in texte, ident
    # Ni le détail des versements, ni les identifiants de l'atelier : des jetons seulement.
    assert '"aventurier"' not in brut and '"type"' not in brut and '"pour"' not in brut
    sec = section(tablee, "a")
    assert all(x["id"] not in ("auberge", "tour", "forge", "maison") for x in sec["batiments"] + sec["projets"])
    a = sec["batiments"][0]
    assert a["nom"] == masque.masquer("La Petite Fanfrelée") and sec["village"]["nom"] == masque.masquer("Le refuge de la Petite Fanfrelée")
    assert a["prochain"]["bonus"] == "" and sec["village"]["bonus"][0]["bonus"] == masque.masquer("Repas offerts à la Fanfrelée.")
    forge = next(p for p in sec["projets"] if p["nom"] == "La forge")
    assert forge["description"] == masque.masquer("Forgée pour Jamais ne dort.") and forge["niveaux"][2]["bonus"] == ""
    # Le MJ lit ce qui est retenu, avec le reste du carnet.
    retenus = " ".join(atelier.get("/api/carnet-joueurs").json()["retenus"])
    assert "Gorvak" in retenus and "sanctuaire" in retenus
    # Un bâtiment dont le nom même nomme un inconnu reste hors du village, et ses bonus avec lui.
    poser(retouche=lambda s: s["batiments"][0].update(nom="Chez Gorvak Sombrefer", niveau=1, ruine=False))
    sec = section(tablee, "a")
    assert sec["batiments"] == [] and sec["village"]["bonus"] == []


def test_l_interrupteur_cache_tout(atelier, tablee, neuf):
    d = demander(tablee, "a", "versement", batiment=auberge(tablee)["id"], **{"or": 10}).json()
    poser(joueurs_voient=False)
    assert not (config.PROPOSITIONS / carnet.CARNET / "sanctuaire.json").exists()
    assert lu(tablee, "a") == {"ouvert": True, "visible": False}
    assert tablee["a"]["coin"].get("/api/carnet").json()["sanctuaire"] == []
    for corps in ({"genre": "versement", "corps": {"batiment": d["corps"]["batiment"], "or": 5}},
                  {"genre": "projet", "corps": {"type": tv_cartes.jeton("sanctuaire-type", "forge"), "mot": ""}}):
        r = tablee["a"]["coin"].post("/api/demandes", json=corps)
        assert r.status_code == 409 and "pas ouvert aux joueurs" in r.json()["detail"]
    # Ce qui attendait déjà reste au MJ, qui tranche comme il veut.
    assert dans_la_boite(atelier, tablee, "a", d["id"])["statut"] == "en-attente"


# ---------------------------------------------------------------- verser

def test_verser_puis_accepter(atelier, tablee, neuf):
    t = tablee
    jeton = auberge(t)["id"]
    r = demander(t, "a", "versement", batiment=jeton, **{"or": 30})
    assert r.status_code == 200 and r.json()["statut"] == "en-attente", r.text
    # L'or proposé est engagé : disponible ici comme dans le sac.
    assert lu(t, "a")["or"] == {"bourse": 100, "commandes": 0, "dons": 0, "versements": 30, "total": 30, "disponible": 70}
    assert t["a"]["coin"].get("/api/sac").json()["or"]["disponible"] == 70
    vue = dans_la_boite(atelier, t, "a", r.json()["id"])
    assert vue["phrase"] == "Aube verse 30 po pour l'auberge (sa bourse : 100 po)" and vue["genre_nom"] == "Un versement au sanctuaire"
    assert vue["annulable"] is False and vue["non"] == "Refuser"
    avant = (config.PROPOSITIONS / carnet.CARNET / "sanctuaire.json").read_text(encoding="utf-8")

    rep = trancher(atelier, t, "a", r.json()["id"], mot="Merci pour l'auberge")
    assert rep.status_code == 200 and rep.json()["statut"] == "acceptee", rep.text
    d = la_demande(t, "a", r.json()["id"])
    assert d["resultat"] == "30 po versées pour l'auberge." and d["mot"] == "Merci pour l'auberge"
    assert bourse(atelier, t, "a") == 70 and batiment_disque()["cagnotte"] == 30
    # Republiés avant que le statut ne parte : la cagnotte, la fiche « Mon héros », le sujet « carnet » du flux.
    apres = (config.PROPOSITIONS / carnet.CARNET / "sanctuaire.json").read_text(encoding="utf-8")
    assert apres != avant and flux_coin.sujet_du_fichier(("carnet", "sanctuaire.json")) == (None, "carnet")
    assert auberge(t)["cagnotte"] == 30 and auberge(t)["donateurs"] == [{"nom": "Ysolde", "or": 30}]
    assert t["a"]["coin"].get("/api/carnet").json()["heros"]["or"] == 70
    assert lu(t, "a")["or"]["disponible"] == 70
    vu = next(x for x in lu(t, "a")["demandes"] if x["id"] == r.json()["id"])
    assert vu["statut_dit"] == "versé, accepté par le MJ"
    # Les journaux : celui du sanctuaire (pour le MJ), celui de la séance en cours, comme l'onglet Sanctuaire les écrit.
    assert any(l["texte"] == "Ysolde verse 30 po pour L'auberge (La salle commune)." for l in refuge.lire_sanctuaire()["journal"])
    seance = sanctuaire_joueurs.seance_en_cours(utilitaires.lire_tout(config.SEANCES))
    assert seance and seance["journal"][-1]["texte"] == "Ysolde verse 30 po pour L'auberge."
    assert dans_la_boite(atelier, t, "a", r.json()["id"])["phrase"] == "Aube a versé 30 po pour l'auberge"


def test_verser_au_dela_du_disponible(atelier, tablee, neuf):
    t = tablee
    jeton = auberge(t)["id"]
    assert demander(t, "a", "versement", batiment=jeton, **{"or": 80}).status_code == 200
    r = demander(t, "a", "versement", batiment=jeton, **{"or": 30})
    assert r.status_code == 409 and "20 po disponibles" in r.json()["detail"]
    # Au-delà de ce qui manque au niveau, de la bourse, ou un montant qui n'en est pas un.
    bourse(atelier, t, "b", 500)
    r = demander(t, "b", "versement", batiment=jeton, **{"or": 151})
    assert r.status_code == 409 and "ne manque que 150 po" in r.json()["detail"]
    for mauvais in (0, -3, 2.5, "dix", True, None, 2_000_000):
        assert demander(t, "b", "versement", batiment=jeton, **{"or": mauvais}).status_code == 400, mauvais
    for ref in ("auberge", "0" * 20, tv_cartes.jeton("sanctuaire", "tour")):
        assert demander(t, "b", "versement", batiment=ref, **{"or": 5}).status_code in (400, 409), ref
    assert [d["genre"] for d in demandes.lire(config.PROPOSITIONS, t["b"]["joueur"]["id"])] == []


def test_refuse_puis_bourse_fondue(atelier, tablee, neuf):
    t = tablee
    jeton = auberge(t)["id"]
    d = demander(t, "a", "versement", batiment=jeton, **{"or": 40}).json()
    rep = trancher(atelier, t, "a", d["id"], geste="refuser", mot="Gardez-les pour la forge")
    assert rep.status_code == 200 and rep.json()["statut"] == "refusee"
    assert bourse(atelier, t, "a") == 100 and batiment_disque()["cagnotte"] == 0 and lu(t, "a")["or"]["disponible"] == 100
    vu = next(x for x in lu(t, "a")["demandes"] if x["id"] == d["id"])
    assert vu["statut_dit"] == "refusé par le MJ" and vu["mot"] == "Gardez-les pour la forge"
    # La bourse a fondu entre la demande et l'acceptation (un achat, le MJ) : rien ne passe, le MJ lit pourquoi.
    d = demander(t, "a", "versement", batiment=jeton, **{"or": 50}).json()
    bourse(atelier, t, "a", 10)
    rep = trancher(atelier, t, "a", d["id"])
    assert rep.status_code == 409 and "n'a que 10 pièces d'or" in rep.json()["detail"] and "Refusez" in rep.json()["detail"]
    assert la_demande(t, "a", d["id"])["statut"] == "en-attente"
    assert bourse(atelier, t, "a") == 10 and batiment_disque()["cagnotte"] == 0
    assert dans_la_boite(atelier, t, "a", d["id"])["phrase"].endswith("(sa bourse : 10 po)")
    # Le joueur retire lui-même ce qui attend encore.
    assert t["a"]["coin"].delete(f"/api/demandes/{d['id']}").json()["statut"] == "retiree"
    assert trancher(atelier, t, "a", d["id"]).status_code == 409


def test_le_niveau_se_batit_des_qu_il_est_paye(atelier, tablee, neuf):
    t = tablee
    jeton = auberge(t)["id"]
    da = demander(t, "a", "versement", batiment=jeton, **{"or": 100}).json()
    db = demander(t, "b", "versement", batiment=jeton, **{"or": 90}).json()
    assert trancher(atelier, t, "a", da["id"]).status_code == 200
    # Il ne manque plus que 50 : le versement de Basile n'en prend que 50, le niveau est bâti, le reste reste à Tavarède.
    assert trancher(atelier, t, "b", db["id"]).status_code == 200
    b = batiment_disque()
    assert (b["niveau"], b["cagnotte"], b["ruine"]) == (1, 0, False)
    assert bourse(atelier, t, "a") == 0 and bourse(atelier, t, "b") == 50
    res = la_demande(t, "b", db["id"])["resultat"]
    assert res == ("50 po versées pour l'auberge. Il n'en manquait que 50 : les 40 autres restent dans votre bourse. "
                   "L'auberge passe au niveau 1 : La salle commune.")
    pub = auberge(t)
    assert pub["niveau"] == 1 and pub["etat"] == "La salle commune" and pub["prochain"]["rang"] == 2
    assert section(t, "a")["village"]["habitants"] == 2 and len(section(t, "a")["village"]["bonus"]) == 1
    seance = sanctuaire_joueurs.seance_en_cours(utilitaires.lire_tout(config.SEANCES))
    assert [l["texte"] for l in seance["journal"][-2:]] == ["Tavarède verse 50 po pour L'auberge.", "L'auberge passe au niveau 1 : La salle commune."]
    # La route du MJ, inchangée : ses versements passent par le même cœur.
    r = atelier.post("/api/sanctuaire/versements", json={"batiment": "auberge", "aventurier": t["b"]["heros"]["id"], "or": 20})
    assert r.status_code == 200 and r.json()["pris"] == 20 and r.json()["or"] == 30 and set(r.json()) == {"sanctuaire", "pris", "construit", "versement", "or"}


def test_un_joueur_ne_verse_pas_pour_un_autre(atelier, tablee, neuf):
    t = tablee
    jeton = auberge(t)["id"]
    for champ in ({"aventurier": t["b"]["heros"]["id"]}, {"heros": "b"}, {"joueur": t["b"]["joueur"]["id"]}):
        r = demander(t, "a", "versement", batiment=jeton, **{"or": 10}, **champ)
        assert r.status_code == 400 and "champ inconnu" in r.json()["detail"], champ
    # Écrite tout droit dans la file d'Aube, elle prend toujours dans la bourse d'Ysolde.
    d = ecrire_demande(t, "a", "versement", {"batiment": jeton, "or": 10})
    assert trancher(atelier, t, "a", d["id"]).status_code == 200
    assert bourse(atelier, t, "a") == 90 and bourse(atelier, t, "b") == 100
    # Et Basile ne lit que ses propres demandes.
    assert lu(t, "b")["demandes"] == [] and lu(t, "b")["or"]["disponible"] == 100


# ---------------------------------------------------------------- proposer un projet

def test_proposer_un_projet(atelier, tablee, neuf):
    t = tablee
    forge = next(p for p in section(t, "a")["projets"] if p["nom"] == "La forge")
    # Un type non coché n'a pas de jeton dans le carnet : refusé au coin, et par l'atelier s'il arrive tout droit.
    autel = tv_cartes.jeton("sanctuaire-type", "autel")
    r = demander(t, "a", "projet", type=autel, mot="")
    assert r.status_code == 409 and "pas parmi ceux" in r.json()["detail"]
    d = ecrire_demande(t, "a", "projet", {"type": autel, "mot": ""})
    rep = trancher(atelier, t, "a", d["id"])
    assert rep.status_code == 409 and "plus proposé aux joueurs" in rep.json()["detail"]
    assert la_demande(t, "a", d["id"])["statut"] == "en-attente"
    trancher(atelier, t, "a", d["id"], geste="refuser")

    assert demander(t, "a", "projet", type=forge["id"], mot="x" * 301).status_code == 413
    r = demander(t, "a", "projet", type=forge["id"], mot="  Pour  réparer nos lames ")
    assert r.status_code == 200 and r.json()["corps"]["mot"] == "Pour réparer nos lames"
    r2 = demander(t, "a", "projet", type=forge["id"])
    assert r2.status_code == 409 and "déjà proposé" in r2.json()["detail"]
    vue = dans_la_boite(atelier, t, "a", r.json()["id"])
    assert vue["phrase"] == "Aube propose : la forge (niveau I : 150 po), « Pour réparer nos lames »"
    rep = trancher(atelier, t, "a", r.json()["id"])
    assert rep.status_code == 200 and rep.json()["statut"] == "acceptee", rep.text
    nouveau = next(b for b in refuge.lire_sanctuaire()["batiments"] if b["type"] == "forge")
    assert nouveau["cache"] is False and nouveau["niveau"] == 0
    assert refuge.lire_sanctuaire()["journal"][-1]["texte"] == "Chantier ouvert : La forge (proposé par Aube)."
    assert la_demande(t, "a", r.json()["id"])["resultat"] == "Chantier ouvert : La forge. Votre MJ lui choisit sa place au village."
    sec = section(t, "b")
    assert "La forge" in {b["nom"] for b in sec["batiments"]} and "La forge" not in {p["nom"] for p in sec["projets"]}
    # Le même projet, accepté une seconde fois (deux joueurs l'ont proposé) : le MJ lit qu'il est déjà là.
    d = ecrire_demande(t, "b", "projet", {"type": forge["id"], "mot": ""})
    rep = trancher(atelier, t, "b", d["id"])
    assert rep.status_code == 409 and "déjà au sanctuaire" in rep.json()["detail"]


def test_un_projet_deja_la_mais_cache(atelier, tablee, neuf):
    """La tour est cochée et sa jumelle cachée existe : le joueur peut la proposer sans rien apprendre ; le MJ, lui, lit
    qu'elle est déjà là, cachée."""
    t = tablee
    tour = next(p for p in section(t, "a")["projets"] if p["nom"] == "La tour de guet")
    d = demander(t, "a", "projet", type=tour["id"]).json()
    rep = trancher(atelier, t, "a", d["id"])
    assert rep.status_code == 409 and "caché aux joueurs" in rep.json()["detail"]
    assert la_demande(t, "a", d["id"])["statut"] == "en-attente"


# ---------------------------------------------------------------- fermé, en pause, Telegram

def test_carnet_ferme_et_pause(atelier, tablee, neuf):
    t = tablee
    jeton = auberge(t)["id"]
    atelier.put("/api/carnet-joueurs", json={"ouvert": False})
    try:
        assert lu(t, "a") == {"ouvert": False}
        for genre, corps in (("versement", {"batiment": jeton, "or": 5}), ("projet", {"type": jeton, "mot": ""})):
            r = t["a"]["coin"].post("/api/demandes", json={"genre": genre, "corps": corps})
            assert r.status_code == 423 and "fermé" in r.json()["detail"], r.text
    finally:
        atelier.put("/api/carnet-joueurs", json={"ouvert": True})
    atelier.put("/api/demandes/reglages", json={"pause": True})
    try:
        r = demander(t, "a", "versement", batiment=jeton, **{"or": 5})
        assert r.status_code == 423 and r.headers["X-Coin-En-Pause"] == "1"
        assert lu(t, "a")["pause"] is True
    finally:
        atelier.put("/api/demandes/reglages", json={"pause": False})


def test_ce_qui_se_dit_sur_telegram():
    for genre in cagnottes.GENRES_DU_SANCTUAIRE:
        g = demandes.GENRES[genre]
        assert g.attente and not g.silencieux and g.carnet and not g.annulable
    el = lambda genre, i: {"type": "demande", "joueur": "lea", "joueur_nom": "Léa", "id": f"{i:012x}", "genre": genre, "statut": "en-attente"}
    presentes = boite_mod.Boite.cles_presentes([el("versement", 1), el("projet", 2)], [])
    assert [presentes[f"d:lea:{i:012x}"][2] for i in (1, 2)] == [True, True]
    assert boite_mod.dit(demandes.GENRES["versement"].telegram, 2) == "2 versements au sanctuaire"


# ---------------------------------------------------------------- la séance en cours (portage de seance-en-cours.js)

def test_la_seance_en_cours_suit_la_regle_de_l_atelier():
    jour = "2026-11-03"
    s1 = {"id": "s1", "numero": 1, "date": "2026-11-01", "close": True}
    s2 = {"id": "s2", "numero": 2, "date": "2026-11-07"}
    s3 = {"id": "s3", "numero": 3, "date": jour}
    choisie = lambda liste: (sanctuaire_joueurs.seance_en_cours(liste, jour) or {}).get("id")  # noqa: E731
    assert choisie([]) is None and choisie([s1]) is None
    assert choisie([s1, s2, s3]) == "s3" and choisie([s1, s2]) == "s2"
    assert choisie([{"id": "b", "numero": 5, "date": "2026-11-08"}, {"id": "a", "numero": 4, "date": "2026-11-01"}]) == "a"
    assert choisie([{"id": "c", "numero": 7, "date": "2026-11-05"}, {"id": "d", "numero": 6, "date": "2026-11-01"}]) == "d"
    assert choisie([{"id": "x", "numero": 9}, {"id": "y", "numero": 8}]) == "y"
    assert choisie([{"id": "x", "numero": 1}, s2]) == "s2"
    jouee = {"id": "j", "numero": 4, "date": "2026-10-01", "deroule": [{"en_cours": f"{jour}T19:30:00"}]}
    assert choisie([s3, jouee]) == "j"
    combat = {"id": "k", "numero": 5, "date": "2026-09-01", "combat": {"debut": f"{jour}T20:00:00"}}
    assert choisie([s3, jouee, combat]) == "k"


def test_la_boite_et_l_onglet_en_meme_temps(atelier, tablee, neuf):
    """Le MJ accepte les versements d'Aube dans sa boîte (un fil à part, sous le verrou des demandes) pendant que l'onglet
    Sanctuaire verse pour Tavarède et que des gestes du sac passent par la file : rien ne se perd, rien ne se bloque."""
    from concurrent.futures import ThreadPoolExecutor

    t = tablee
    jeton = auberge(t)["id"]
    ids = [ecrire_demande(t, "a", "versement", {"batiment": jeton, "or": 10})["id"] for _ in range(5)]
    with ThreadPoolExecutor(max_workers=8) as pool:
        acceptes = [pool.submit(trancher, atelier, t, "a", i) for i in ids]
        routes = [pool.submit(atelier.post, "/api/sanctuaire/versements", json={"batiment": "auberge", "aventurier": t["b"]["heros"]["id"], "or": 10})
                  for _ in range(5)]
        sacs = [pool.submit(demander, t, "a", "sac", geste="ajouter", liste="equipement", ligne=f"Pain {k}") for k in range(3)]
        for f in acceptes + routes + sacs:
            assert f.result(timeout=30).status_code == 200
    assert batiment_disque()["cagnotte"] == 100
    assert bourse(atelier, t, "a") == 50 and bourse(atelier, t, "b") == 50
    assert all(la_demande(t, "a", i)["statut"] == "acceptee" for i in ids)


def test_la_reponse_au_joueur_passe_au_masque(atelier, tablee, neuf):
    """L'auberge porte son vrai nom dans l'atelier : la boîte du MJ le dit, la réponse lue par le joueur jamais."""
    t = tablee
    poser(retouche=lambda s: s["batiments"][0].update(nom="La Petite Fanfrelée"))
    bourse(atelier, t, "a", 200)
    jeton = section(t, "a")["batiments"][0]["id"]
    d = demander(t, "a", "versement", batiment=jeton, **{"or": 150}).json()
    assert "Fanfrelée" in dans_la_boite(atelier, t, "a", d["id"])["phrase"]
    assert trancher(atelier, t, "a", d["id"]).status_code == 200
    vu = next(x for x in lu(t, "a")["demandes"] if x["id"] == d["id"])
    assert "anfrel" not in json.dumps(vu, ensure_ascii=False) and "auberge" in vu["resultat"].lower()
    assert "passe au niveau 1" in vu["resultat"]


def test_la_tv_relit_apres_un_versement_accepte(atelier, tablee, neuf):
    t = tablee
    avant = atelier.get("/api/table").json()
    d = demander(t, "a", "versement", batiment=auberge(t)["id"], **{"or": 10}).json()
    try:
        atelier.put("/api/table", json={"vue": "sanctuaire"})
        with atelier.websocket_connect("/ws/table") as ws:
            maj = ws.receive_json()["etat"].get("sanctuaire_maj")
            assert trancher(atelier, t, "a", d["id"]).status_code == 200
            message = ws.receive_json()
        assert message["etat"]["vue"] == "sanctuaire" and message["etat"]["sanctuaire_maj"] != maj
        assert message["etat"]["sanctuaire_maj"] == refuge.lire_sanctuaire()["modifie"]
    finally:
        atelier.put("/api/table", json={"vue": avant.get("vue") or "accueil"})
