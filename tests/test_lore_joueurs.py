"""Le lore du personnage (lot C2, lore.py, lore_mj.py) : le joueur étoffe le récit de son héros depuis le coin, à son
rythme, puis l'envoie au MJ, qui accepte, retouche ou refuse chaque passage. Seuls les passages du récit, aux bornes de la
fiche ; un brouillon par joueur, que lui seul lit ; un passage que le carnet garde (il nomme un inconnu, ou le vrai nom
de l'auberge) reste en lecture seule et n'est jamais écrasé par une acceptation ; une fiche changée entre-temps ne
s'écrase pas sans que le MJ le confirme. Et les fuites : ce qui est accepté passe par le masque et par retenir, au carnet
comme à la TV ; le coin ne lit jamais le texte d'un passage tenu."""
import asyncio
import json
import os
import sys
import tempfile
import time
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from coin_mj import boite as boite_mod  # noqa: E402
from commun import carnet  # noqa: E402
from commun import demandes  # noqa: E402
import joueurs  # noqa: E402
from commun import lore  # noqa: E402
from comptes_coin import entrer  # noqa: E402
import main  # noqa: E402
from api import application, carnet_api, config, joueurs_mj, portier  # noqa: E402

PNJ_SECRET = "Gorvak Sombrefer"
LIEU_SECRET = "Le Puits-aux-Ombres"



@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture(scope="module")
def tablee(atelier):
    """Deux joueurs dont les héros sont à la tablée (Ysolde pour Aube, Tavarède pour Basile), un PNJ et un lieu inconnus ;
    le carnet ouvert. Tout est retiré à la fin."""
    patch = pytest.MonkeyPatch()
    patch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    patch.setattr(joueurs, "COOKIE_SUR", False)
    patch.setattr(joueurs, "HOTES", set())
    patch.setattr(joueurs, "DEMANDES_FAITES", {})
    t = {"pnj": atelier.post("/api/pnj", json={"nom": PNJ_SECRET, "connu": False}).json(),
         "lieu": atelier.post("/api/lieux", json={"nom": LIEU_SECRET, "connu": False}).json()}
    for code, nom, heros, genre in (("a", "Aube", "Ysolde Gris", "f"), ("b", "Basile", "Tavarède Lavelle", "h")):
        invite = atelier.post("/api/joueurs", json={"nom": nom}).json()
        coin = TestClient(joueurs.app)
        entrer(coin, invite)
        coin.post("/api/moi/aventurier", json={"nom": heros, "genre": genre, "sante": 9, "psy": 5, "histoire": "Né sous la pluie.",
                                               "allure": "Grande, une cicatrice.", "equipement": ["Cape"], "objets": ["", "", ""]})
        coin.post("/api/moi/envoyer")
        fiche = atelier.post(f"/api/joueurs/{invite['id']}/accueillir").json()
        t[code] = {"joueur": invite, "coin": coin, "heros": fiche}
    avant = carnet_api.carnet_ouvert()
    atelier.put("/api/carnet-joueurs", json={"ouvert": True})
    yield t
    for code in ("a", "b"):
        t[code]["coin"].close()
        atelier.delete(f"/api/joueurs/{t[code]['joueur']['id']}")
        atelier.delete(f"/api/aventuriers/{t[code]['heros']['id']}")
    atelier.delete(f"/api/pnj/{t['pnj']['id']}")
    atelier.delete(f"/api/lieux/{t['lieu']['id']}")
    atelier.put("/api/carnet-joueurs", json={"ouvert": avant})
    demandes.ecrire_pause(config.PROPOSITIONS, False)
    patch.undo()


def fiche(atelier, t, code):
    return atelier.get(f"/api/aventuriers/{t[code]['heros']['id']}").json()


def ecrire_fiche(atelier, t, code, **champs):
    """Le MJ change la fiche dans l'atelier (son éditeur), puis le carnet est republié."""
    f = fiche(atelier, t, code)
    r = atelier.put(f"/api/aventuriers/{f['id']}", json={**f, **champs, "version_base": f["modifie"]})
    assert r.status_code == 200, r.text
    carnet_api.publier_carnet()
    return r.json()


@pytest.fixture()
def neuf(atelier, tablee):
    """Chaque essai part de récits connus, publiés, sans brouillon ni demande, et d'un plafond horaire vide."""
    for code in ("a", "b"):
        ecrire_fiche(atelier, tablee, code, histoire="Né sous la pluie.", avant="", pourquoi="", jamais="", allure="Grande, une cicatrice.",
                     defaut="", lien="", contacts="", particularites="")
        jid = tablee[code]["joueur"]["id"]
        with lore.verrou(config.PROPOSITIONS):
            lore.fichier(config.PROPOSITIONS, jid).unlink(missing_ok=True)
        with demandes.verrou(config.PROPOSITIONS):
            demandes.fichier(config.PROPOSITIONS, jid).unlink(missing_ok=True)
    joueurs.DEMANDES_FAITES.clear()
    demandes.ecrire_pause(config.PROPOSITIONS, False)
    carnet_api.publier_carnet()
    yield tablee


def coin(t, code):
    return t[code]["coin"]


def etat(t, code):
    r = coin(t, code).get("/api/lore")
    assert r.status_code == 200, r.text
    return r.json()


def passage(e, cle_):
    return next(p for p in e["passages"] if p["cle"] == cle_)


def ecrire(t, code, **champs):
    return coin(t, code).put("/api/lore", json={"champs": champs})


def envoyer(t, code):
    return coin(t, code).post("/api/lore/envoyer", json={})


def ouverte(t, code):
    return next(d for d in demandes.lire(config.PROPOSITIONS, t[code]["joueur"]["id"]) if d["genre"] == "lore" and d["statut"] == "en-attente")


def comparer(atelier, t, code, ident):
    r = atelier.get(f"/api/lore/{t[code]['joueur']['id']}/{ident}")
    assert r.status_code == 200, r.text
    return r.json()


def trancher(atelier, t, code, ident, decisions: dict, mot: str = "", version=None):
    v = comparer(atelier, t, code, ident)
    champs = {}
    for c in v["champs"]:
        x = decisions[c["cle"]]
        champs[c["cle"]] = {"decision": "refuser"} if x == "refuser" else {"decision": "accepter", "empreinte": c["empreinte"], **(x if isinstance(x, dict) else {})}
    return atelier.post(f"/api/lore/{t[code]['joueur']['id']}/{ident}/trancher",
                        json={"version": v["version"] if version is None else version, "mot": mot, "champs": champs})


def tout_ce_que_lit_le_coin(t, code) -> str:
    c = coin(t, code)
    return json.dumps([c.get(u).json() for u in ("/api/lore", "/api/carnet", "/api/demandes", "/api/sac")], ensure_ascii=False)


# ---------------------------------------------------------------- les passages et leurs bornes

def test_les_passages_sont_ceux_du_recit():
    assert lore.CHAMPS == carnet_api.RECIT_DU_HEROS
    assert {"secret", "notes_mj", "progression", "lien_avec"}.isdisjoint(lore.CHAMPS)


@pytest.mark.parametrize("interdit", ["secret", "notes_mj", "progression", "lien_avec", "nom", "peuple", "or"])
def test_un_champ_hors_du_recit_est_refuse(neuf, interdit):
    r = coin(neuf, "a").put("/api/lore", json={"champs": {interdit: "Je suis le MJ maintenant."}})
    assert r.status_code == 400, r.text
    with pytest.raises(demandes.Refus) as refus:
        lore.valider_lore({"ref": "a" * 20, "champs": {interdit: {"avant": "", "apres": "x"}}})
    assert refus.value.statut == 400
    # Écrite à la main dans la file, une histoire est refusée par le coin, et l'atelier la revalide de même.
    r = coin(neuf, "a").post("/api/demandes", json={"genre": "lore", "corps": {"ref": "a" * 20, "champs": {"histoire": {"avant": "", "apres": "x"}}}})
    assert r.status_code == 400
    assert not lore.lire_brouillon(config.PROPOSITIONS, neuf["a"]["joueur"]["id"])["champs"]


def test_les_bornes_de_la_fiche(neuf):
    assert ecrire(neuf, "a", histoire="x" * lore.LONG).status_code == 200
    assert ecrire(neuf, "a", histoire="x" * (lore.LONG + 1)).status_code == 413
    with pytest.raises(demandes.Refus) as refus:
        lore.valider_lore({"ref": "a" * 20, "champs": {"histoire": {"avant": "", "apres": "é" * (lore.LONG + 1)}}})
    assert refus.value.statut == 413
    # Un envoi trop lourd pour la file du joueur est refusé, avec de quoi faire.
    gros = {k: {"avant": "a" * lore.LONG, "apres": "b" * lore.LONG} for k in lore.CHAMPS}
    with pytest.raises(demandes.Refus) as refus:
        lore.valider_lore({"ref": "a" * 20, "champs": gros})
    assert refus.value.statut == 413 and "partie" in refus.value.message
    # Repasser un texte propre ne le change pas : l'atelier le revalide tel quel.
    t = lore.propre("  Une ligne.  \r\n\n\n\nUne autre​.\t ")
    assert t == "Une ligne.\n\nUne autre." and lore.propre(t) == t


def test_le_brouillon_s_enregistre_et_reste_a_lui(neuf):
    r = ecrire(neuf, "a", histoire="Née sous la pluie, élevée par les loups.", contacts="Une sœur à Clairefonds.")
    assert r.status_code == 200, r.text
    e = r.json()
    assert passage(e, "histoire")["etat"] == "brouillon" and passage(e, "histoire")["brouillon"].startswith("Née")
    assert e["enregistre"]
    # Revenir au texte de la fiche efface le brouillon de ce passage.
    e = coin(neuf, "a").put("/api/lore", json={"effacer": ["contacts"]}).json()
    assert passage(e, "contacts")["brouillon"] is None and passage(e, "contacts")["etat"] == "fiche"
    # Basile ne lit rien de ce qu'écrit Aube, et son fichier est à lui.
    assert "loups" not in json.dumps(etat(neuf, "b"), ensure_ascii=False)
    assert passage(etat(neuf, "b"), "histoire")["brouillon"] is None
    chemin = lore.fichier(config.PROPOSITIONS, neuf["a"]["joueur"]["id"])
    assert chemin.exists() and (chemin.stat().st_mode & 0o077) == 0
    assert not lore.fichier(config.PROPOSITIONS, neuf["b"]["joueur"]["id"]).exists()


def test_rien_ne_s_ecrit_sans_session(neuf):
    anonyme = TestClient(joueurs.app)
    assert anonyme.get("/api/lore").status_code == 401
    assert anonyme.put("/api/lore", json={"champs": {"histoire": "x"}}).status_code == 401
    assert anonyme.post("/api/lore/envoyer", json={}).status_code == 401
    assert anonyme.get("/histoire", follow_redirects=False).status_code == 303


# ---------------------------------------------------------------- l'envoi et la boîte du MJ

def test_envoyer_cree_une_demande_en_attente(atelier, neuf):
    ecrire(neuf, "a", histoire="Née sous la pluie, élevée par les loups.", jamais="Trahir un serment.")
    e = envoyer(neuf, "a").json()
    d = ouverte(neuf, "a")
    assert d["statut"] == "en-attente" and set(d["corps"]["champs"]) == {"histoire", "jamais"}
    assert d["corps"]["champs"]["histoire"] == {"avant": "Né sous la pluie.", "apres": "Née sous la pluie, élevée par les loups."}
    assert passage(e, "histoire")["etat"] == "envoye" and e["envoi"]["id"] == d["id"]
    # Le même envoi, refait, ne repart pas ; un texte changé remplace l'envoi qui attend.
    assert envoyer(neuf, "a").json().get("deja") is True
    ecrire(neuf, "a", jamais="Trahir un serment, jamais.")
    assert passage(etat(neuf, "a"), "jamais")["etat"] == "a-renvoyer"
    envoyer(neuf, "a")
    liste = [x for x in demandes.lire(config.PROPOSITIONS, neuf["a"]["joueur"]["id"]) if x["genre"] == "lore"]
    assert [x["statut"] for x in liste] == ["retiree", "en-attente"]
    # La boîte du MJ la montre, avec sa ligne.
    v = atelier.get("/api/demandes").json()
    x = next(x for x in v["attente"] if x["genre"] == "lore")
    assert x["phrase"] == "Aube propose 2 passages pour Ysolde : l'histoire et ce qu'elle ne fera jamais."
    # Le bouton commun de la boîte n'accepte pas une histoire d'un bloc.
    r = atelier.post(f"/api/demandes/{neuf['a']['joueur']['id']}/{x['id']}/accepter", json={"version": x["version"], "mot": ""})
    assert r.status_code == 400 and fiche(atelier, neuf, "a")["histoire"] == "Né sous la pluie."


def test_rien_a_envoyer(neuf):
    r = envoyer(neuf, "a")
    assert r.status_code == 400 and "Rien à envoyer" in r.json()["detail"]
    # Un texte revenu à celui de la fiche n'est plus un brouillon.
    e = ecrire(neuf, "a", histoire="Né sous la pluie.  ").json()
    assert passage(e, "histoire")["brouillon"] is None


def test_acceptation_partielle_retouche_et_refus(atelier, neuf):
    ecrire(neuf, "a", histoire="Née sous la pluie, élevée par les loups.", avant="Bergère des hauts.", contacts="Mère Corneille, herboriste.")
    envoyer(neuf, "a")
    d = ouverte(neuf, "a")
    v = comparer(atelier, neuf, "a", d["id"])
    assert [c["cle"] for c in v["champs"]] == ["histoire", "avant", "contacts"]
    assert not any(c["change_depuis"] for c in v["champs"]) and v["sien"]
    r = trancher(atelier, neuf, "a", d["id"], {"histoire": {}, "avant": {"texte": "Bergère des hauts plateaux."}, "contacts": "refuser"},
                 mot="Belle histoire, la mère Corneille viendra plus tard.")
    assert r.status_code == 200, r.text
    f = fiche(atelier, neuf, "a")
    assert f["histoire"] == "Née sous la pluie, élevée par les loups." and f["avant"] == "Bergère des hauts plateaux." and f["contacts"] == ""
    d = next(x for x in demandes.lire(config.PROPOSITIONS, neuf["a"]["joueur"]["id"]) if x["id"] == d["id"])
    assert d["statut"] == "acceptee" and d["issue"] == {"histoire": "acceptee", "avant": "retouchee", "contacts": "refusee"}
    assert d["resultat"] == "2 passages acceptés, dont 1 retouché par votre MJ ; 1 refusé."
    # L'ancienne version de la fiche est à l'historique.
    assert any((config.HISTORIQUE / "aventuriers" / f["id"]).glob("*.json"))
    # « Mon héros » est republié tout de suite ; la page du joueur dit ce qu'il en est, passage par passage.
    h = coin(neuf, "a").get("/api/carnet").json()["heros"]
    assert h["histoire"] == "Née sous la pluie, élevée par les loups." and h["avant"] == "Bergère des hauts plateaux."
    e = etat(neuf, "a")
    assert passage(e, "histoire")["etat"] == "fiche" and passage(e, "histoire")["dernier"]["issue"] == "acceptee"
    av = passage(e, "avant")
    assert av["etat"] == "fiche" and av["brouillon"] is None and av["dernier"] == {"issue": "retouchee", "quand": d["traitee"], "propose": "Bergère des hauts."}
    co = passage(e, "contacts")
    assert co["etat"] == "refuse" and co["brouillon"] == "Mère Corneille, herboriste."
    assert e["historique"][0]["mot"] == "Belle histoire, la mère Corneille viendra plus tard."
    assert [x["issue"] for x in e["historique"][0]["passages"]] == ["acceptee", "retouchee", "refusee"]
    # Le texte refusé ne repart pas de lui-même.
    assert envoyer(neuf, "a").status_code == 400
    # Déjà tranchée : un second geste (l'iPad après le Mac) est refusé.
    assert trancher(atelier, neuf, "a", d["id"], {"histoire": {}, "avant": {}, "contacts": "refuser"}, version=d["version"] - 1).status_code == 409


def test_tout_refuser(atelier, neuf):
    ecrire(neuf, "b", particularites="Voit dans le noir.")
    envoyer(neuf, "b")
    d = ouverte(neuf, "b")
    r = trancher(atelier, neuf, "b", d["id"], {"particularites": "refuser"})
    assert r.status_code == 200 and r.json()["statut"] == "refusee"
    assert fiche(atelier, neuf, "b")["particularites"] == ""
    assert passage(etat(neuf, "b"), "particularites")["etat"] == "refuse"


def test_un_choix_par_passage_et_la_bonne_version(atelier, neuf):
    ecrire(neuf, "a", histoire="Une histoire.", avant="Un passé.")
    envoyer(neuf, "a")
    d = ouverte(neuf, "a")
    v = comparer(atelier, neuf, "a", d["id"])
    base = f"/api/lore/{neuf['a']['joueur']['id']}/{d['id']}/trancher"
    seul = {"histoire": {"decision": "accepter", "empreinte": v["champs"][0]["empreinte"]}}
    r = atelier.post(base, json={"version": v["version"], "champs": seul})
    assert r.status_code == 400 and "chaque passage" in r.json()["detail"]
    r = atelier.post(base, json={"version": v["version"] + 7, "champs": {**seul, "avant": {"decision": "refuser"}}})
    assert r.status_code == 409
    r = atelier.post(base, json={"version": v["version"], "champs": {**seul, "avant": {"decision": "refuser"}, "secret": {"decision": "accepter"}}})
    assert r.status_code == 400
    assert fiche(atelier, neuf, "a")["histoire"] == "Né sous la pluie."


# ---------------------------------------------------------------- la fiche changée entre-temps

def test_une_fiche_changee_ne_s_ecrase_pas_a_l_aveugle(atelier, neuf):
    ecrire(neuf, "a", histoire="Née sous la pluie, et fière de l'être.")
    # Le MJ retouche la fiche pendant que le joueur écrit : le joueur le voit.
    ecrire_fiche(atelier, neuf, "a", histoire="Née sous la grêle, à Valbrume.")
    e = etat(neuf, "a")
    assert passage(e, "histoire")["change_depuis"] and passage(e, "histoire")["publie"] == "Née sous la grêle, à Valbrume."
    envoyer(neuf, "a")
    d = ouverte(neuf, "a")
    assert d["corps"]["champs"]["histoire"]["avant"] == "Né sous la pluie."
    c = comparer(atelier, neuf, "a", d["id"])["champs"][0]
    assert c["change_depuis"] and c["actuel"] == "Née sous la grêle, à Valbrume." and c["vu"] == "Né sous la pluie."
    assert trancher(atelier, neuf, "a", d["id"], {"histoire": {}}).status_code == 409
    assert fiche(atelier, neuf, "a")["histoire"] == "Née sous la grêle, à Valbrume."
    # La fiche change encore pendant que le MJ lit : son empreinte ne vaut plus.
    v = comparer(atelier, neuf, "a", d["id"])
    ecrire_fiche(atelier, neuf, "a", histoire="Née sous la neige.")
    r = atelier.post(f"/api/lore/{neuf['a']['joueur']['id']}/{d['id']}/trancher",
                     json={"version": v["version"], "champs": {"histoire": {"decision": "accepter", "empreinte": v["champs"][0]["empreinte"], "ecraser": True}}})
    assert r.status_code == 409 and fiche(atelier, neuf, "a")["histoire"] == "Née sous la neige."
    # Confirmé sur la fiche du moment, il passe.
    assert trancher(atelier, neuf, "a", d["id"], {"histoire": {"ecraser": True}}).status_code == 200
    assert fiche(atelier, neuf, "a")["histoire"] == "Née sous la pluie, et fière de l'être."


def test_garder_sa_version_apres_avoir_lu_celle_du_mj(atelier, neuf):
    ecrire(neuf, "a", lien="Doit la vie à Tavarède.")
    ecrire_fiche(atelier, neuf, "a", lien="Rivale de Tavarède.")
    assert passage(etat(neuf, "a"), "lien")["change_depuis"]
    e = coin(neuf, "a").put("/api/lore", json={"relus": ["lien"]}).json()
    assert not passage(e, "lien")["change_depuis"] and passage(e, "lien")["brouillon"] == "Doit la vie à Tavarède."
    envoyer(neuf, "a")
    assert ouverte(neuf, "a")["corps"]["champs"]["lien"]["avant"] == "Rivale de Tavarède."


# ---------------------------------------------------------------- les passages tenus

def test_un_passage_qui_nomme_un_inconnu_est_tenu(atelier, neuf):
    ecrire_fiche(atelier, neuf, "a", contacts=f"Doit trois pièces à {PNJ_SECRET}.")
    h = coin(neuf, "a").get("/api/carnet").json()["heros"]
    assert h["contacts"] == "" and h["tenus"] == ["contacts"]
    p = passage(etat(neuf, "a"), "contacts")
    assert p["tenu"] and p["publie"] == "" and p["brouillon"] is None
    # En lecture seule : le coin refuse de l'écrire, et rien ne part.
    r = ecrire(neuf, "a", contacts="Je ne dois rien à personne.")
    assert r.status_code == 409 and lore.TENU in r.json()["detail"]
    assert PNJ_SECRET not in tout_ce_que_lit_le_coin(neuf, "a") and "Gorvak" not in tout_ce_que_lit_le_coin(neuf, "a")
    # Marqué connu par le MJ, le passage n'est plus tenu.
    atelier.patch(f"/api/pnj/{neuf['pnj']['id']}", json={"connu": True})
    try:
        carnet_api.publier_carnet()
        assert not passage(etat(neuf, "a"), "contacts")["tenu"]
    finally:
        atelier.patch(f"/api/pnj/{neuf['pnj']['id']}", json={"connu": False})
        carnet_api.publier_carnet()


def test_un_passage_change_par_le_masque_est_tenu(atelier, neuf):
    """« Partiellement retenu » : le carnet en publie une version masquée (« l'auberge »). Accepter le texte du joueur,
    écrit sur cette version, effacerait le vrai nom que le MJ a écrit."""
    ecrire_fiche(atelier, neuf, "a", avant="Servante à la Petite Fanfrelée, l'auberge de Toma.")
    h = coin(neuf, "a").get("/api/carnet").json()["heros"]
    assert "Fanfrel" not in h["avant"] and "auberge" in h["avant"] and h["tenus"] == ["avant"]
    p = passage(etat(neuf, "a"), "avant")
    assert p["tenu"] and p["publie"] == ""
    assert ecrire(neuf, "a", avant=h["avant"] + " Puis voleuse.").status_code == 409
    assert "anfrel" not in tout_ce_que_lit_le_coin(neuf, "a")


def test_un_passage_tenu_n_est_jamais_ecrase_par_une_acceptation(atelier, neuf):
    """Même une histoire écrite à la main dans la file (un coin qui ne vérifierait rien), avec pour « avant » ce que le
    carnet publie : l'atelier sait que le joueur n'a jamais lu ce passage, et ne l'écrase pas sans confirmation."""
    ecrire_fiche(atelier, neuf, "a", contacts=f"Doit trois pièces à {PNJ_SECRET}.")
    ref = next(h["ref"] for h in coin(neuf, "a").get("/api/carnet").json()["compagnie"] if h["moi"])
    d = demandes.nouvelle({"genre": "lore", "corps": {"ref": ref, "champs": {"contacts": {"avant": "", "apres": "Ne doit rien."}}}})
    with demandes.verrou(config.PROPOSITIONS):
        jid = neuf["a"]["joueur"]["id"]
        demandes.ecrire(config.PROPOSITIONS, jid, [*demandes.lire(config.PROPOSITIONS, jid), d])
    c = comparer(atelier, neuf, "a", d["id"])["champs"][0]
    assert c["tenu"] and c["change_depuis"] and PNJ_SECRET in c["actuel"]
    assert trancher(atelier, neuf, "a", d["id"], {"contacts": {}}).status_code == 409
    assert fiche(atelier, neuf, "a")["contacts"] == f"Doit trois pièces à {PNJ_SECRET}."


def test_un_brouillon_devenu_tenu_bloque_l_envoi_sans_rien_ecraser(atelier, neuf):
    ecrire(neuf, "a", contacts="Un cousin forgeron.", jamais="Mentir à un enfant.")
    ecrire_fiche(atelier, neuf, "a", contacts=f"Le cousin de {PNJ_SECRET}.")
    p = passage(etat(neuf, "a"), "contacts")
    assert p["tenu"] and p["brouillon"] == "Un cousin forgeron." and p["publie"] == ""
    r = envoyer(neuf, "a")
    assert r.status_code == 409 and "Effacez" in r.json()["detail"]
    coin(neuf, "a").put("/api/lore", json={"effacer": ["contacts"]})
    assert envoyer(neuf, "a").status_code == 200
    assert set(ouverte(neuf, "a")["corps"]["champs"]) == {"jamais"}


# ---------------------------------------------------------------- les fuites

def test_un_inconnu_nomme_par_le_joueur_entre_dans_la_fiche_mais_pas_au_carnet(atelier, neuf):
    ecrire(neuf, "a", allure=f"Porte la cape de {PNJ_SECRET}.", contacts=f"A grandi près du {LIEU_SECRET}.")
    envoyer(neuf, "a")
    d = ouverte(neuf, "a")
    v = comparer(atelier, neuf, "a", d["id"])
    # La comparaison prévient le MJ avant qu'il accepte.
    assert {s["nom"] for c in v["champs"] for s in c["secrets"]} == {PNJ_SECRET, LIEU_SECRET}
    assert trancher(atelier, neuf, "a", d["id"], {"allure": {}, "contacts": {}}).status_code == 200
    f = fiche(atelier, neuf, "a")
    assert PNJ_SECRET in f["allure"] and LIEU_SECRET in f["contacts"]
    carnet_api.publier_carnet()
    lu = coin(neuf, "a").get("/api/carnet").json()
    assert lu["heros"]["allure"] == "" and lu["heros"]["contacts"] == "" and set(lu["heros"]["tenus"]) == {"allure", "contacts"}
    moi = next(h for h in lu["compagnie"] if h["moi"])
    assert moi["allure"] == ""
    autre = json.dumps(coin(neuf, "b").get("/api/carnet").json(), ensure_ascii=False)
    for secret in (PNJ_SECRET, "Gorvak", LIEU_SECRET, "Puits-aux-Ombres"):
        assert secret not in autre
    # Le brouillon a fait son œuvre : la page dit « tenu », sans le texte.
    p = passage(etat(neuf, "a"), "allure")
    assert p["tenu"] and p["brouillon"] is None and p["publie"] == ""
    # La TV : ni le carton, ni le Tableau, ni la tablée.
    for url in ("/api/table/heros", "/api/table/fiches"):
        brut = atelier.get(url).text
        assert "Gorvak" not in brut and "Sombrefer" not in brut, url
    jeton = next(h["id"] for h in atelier.get("/api/table/heros").json() if h["nom"] == "Ysolde Gris")
    assert atelier.get(f"/api/table/aventurier/{jeton}").json()["allure"] == ""


def test_le_nom_cache_de_l_auberge_ne_sort_pas_par_l_allure(atelier, neuf):
    ecrire(neuf, "b", allure="Sent la bière de la Petite Fanfrelée.")
    envoyer(neuf, "b")
    d = ouverte(neuf, "b")
    assert comparer(atelier, neuf, "b", d["id"])["champs"][0]["auberge"] is True
    assert trancher(atelier, neuf, "b", d["id"], {"allure": {}}).status_code == 200
    carnet_api.publier_carnet()
    for brut in (atelier.get("/api/table/heros").text, atelier.get("/api/table/fiches").text,
                 json.dumps(coin(neuf, "a").get("/api/carnet").json(), ensure_ascii=False),
                 json.dumps(coin(neuf, "b").get("/api/carnet").json(), ensure_ascii=False)):
        assert "anfrel" not in brut
    tv = next(h for h in atelier.get("/api/table/heros").json() if h["nom"] == "Tavarède Lavelle")
    assert "auberge" in tv["allure"]


def test_le_mot_du_mj_passe_au_masque(atelier, neuf):
    ecrire(neuf, "a", defaut="Ronfle.")
    envoyer(neuf, "a")
    d = ouverte(neuf, "a")
    assert trancher(atelier, neuf, "a", d["id"], {"defaut": "refuser"}, mot=f"Pas devant {PNJ_SECRET}.").status_code == 409
    assert trancher(atelier, neuf, "a", d["id"], {"defaut": "refuser"}, mot="Raconte-le à la Petite Fanfrelée.").status_code == 200
    assert "anfrel" not in json.dumps(etat(neuf, "a"), ensure_ascii=False)


def test_telegram_ne_dit_que_le_prenom_et_le_genre(neuf, tmp_path):
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
    ecrire(neuf, "a", histoire="Le secret de ma naissance, Gorgonzola.")
    envoyer(neuf, "a")
    vague1 = asyncio.run(vague())
    assert len(vague1) == 1 and "Aube</b> : une histoire à relire." in vague1[0] and "Gorgonzola" not in vague1[0]


# ---------------------------------------------------------------- carnet fermé, pause, joueur retiré

def test_carnet_ferme(atelier, neuf):
    ecrire(neuf, "a", histoire="Avant la fermeture.")
    atelier.put("/api/carnet-joueurs", json={"ouvert": False})
    try:
        assert coin(neuf, "a").get("/api/lore").json()["ouvert"] is False
        assert ecrire(neuf, "a", histoire="Pendant.").status_code == 423
        assert envoyer(neuf, "a").status_code == 423
    finally:
        atelier.put("/api/carnet-joueurs", json={"ouvert": True})
    assert passage(etat(neuf, "a"), "histoire")["brouillon"] == "Avant la fermeture."


def test_coin_en_pause(neuf):
    ecrire(neuf, "a", histoire="Avant la pause.")
    demandes.ecrire_pause(config.PROPOSITIONS, True)
    try:
        r = ecrire(neuf, "a", histoire="Pendant la pause.")
        assert r.status_code == 423 and r.json().get("pause") is True
        assert envoyer(neuf, "a").status_code == 423
        assert etat(neuf, "a")["pause"] is True
    finally:
        demandes.ecrire_pause(config.PROPOSITIONS, False)
    assert passage(etat(neuf, "a"), "histoire")["brouillon"] == "Avant la pause."


def test_un_brouillon_pour_un_autre_heros_ne_compte_plus(neuf):
    jid = neuf["a"]["joueur"]["id"]
    ecrire(neuf, "a", histoire="Pour l'ancien héros.")
    with lore.verrou(config.PROPOSITIONS):
        b = lore.lire_brouillon(config.PROPOSITIONS, jid)
        lore.ecrire_brouillon(config.PROPOSITIONS, jid, b | {"ref": "f" * 20})
    assert passage(etat(neuf, "a"), "histoire")["brouillon"] is None
    assert envoyer(neuf, "a").status_code == 400


def test_le_brouillon_part_avec_le_joueur_retire(atelier, tablee):
    invite = atelier.post("/api/joueurs", json={"nom": "Éphémère"}).json()
    jid = invite["id"]
    with lore.verrou(config.PROPOSITIONS):
        lore.ecrire_brouillon(config.PROPOSITIONS, jid, {"ref": "a" * 20, "champs": {"histoire": {"texte": "x", "base": "", "modifie": "2026"}}, "modifie": "2026"})
    assert lore.fichier(config.PROPOSITIONS, jid).exists()
    atelier.delete(f"/api/joueurs/{jid}")
    assert not lore.fichier(config.PROPOSITIONS, jid).exists()


def test_les_modules_de_la_page_sont_servis(tablee):
    c = coin(tablee, "a")
    for f in ("js/joueurs/histoire.js", "js/joueurs/histoire-aide.js", "js/joueurs/vers-histoire.js", "js/lore/ecart.js", "css/histoire-coin.css"):
        assert c.get(f"/static/{f}").status_code == 200, f
    assert c.get("/histoire").status_code == 200
    # Le panneau du MJ n'est pas servi au coin.
    assert c.get("/static/js/demandes/lore.js").status_code == 404


def test_la_comparaison_ne_sort_pas_de_l_atelier(atelier, neuf, monkeypatch):
    """Elle montre la fiche entière, secrets compris : jamais à la table publique, jamais depuis Internet sans session."""
    monkeypatch.setattr(portier, "TABLE_PUBLIQUE", {"table.example.ch"})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {"table.example.ch"})
    ecrire(neuf, "a", histoire="Une histoire.")
    envoyer(neuf, "a")
    d = ouverte(neuf, "a")
    jid = neuf["a"]["joueur"]["id"]
    for entetes in ({"CF-Connecting-IP": "203.0.113.9"}, {"Host": "table.example.ch"}):
        assert atelier.get(f"/api/lore/{jid}/{d['id']}", headers=entetes).status_code == 404
        assert atelier.post(f"/api/lore/{jid}/{d['id']}/trancher", json={"version": 1, "champs": {}}, headers=entetes).status_code == 404
    assert fiche(atelier, neuf, "a")["histoire"] == "Né sous la pluie."
