"""L'inventaire des joueurs (lot B1, inventaire.py et sacs.py) : le joueur gère le sac de son héros depuis le coin, par la
file des demandes. Le geste est rejoué sur le sac du moment (une ligne se retrouve par son texte, jamais une ligne
retenue pour le MJ) ; un don d'objet touche deux sacs d'un coup, un don d'or attend le MJ ; « Annuler » rejoue l'inverse,
et refuse quand le sac a changé depuis ; l'or ne bouge pas par le sac ; le carnet fermé ferme l'inventaire. Et les
fuites : chacun ne lit et ne touche que son sac, rien de secret ne repart vers le coin, le jeton d'un compagnon ne dit
rien de sa fiche."""
import hashlib
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

from coin_mj import boite as boite_mod  # noqa: E402
from commun import carnet  # noqa: E402
from commun import demandes  # noqa: E402
from commun import inventaire  # noqa: E402
import joueurs  # noqa: E402
from comptes_coin import entrer  # noqa: E402
import main  # noqa: E402
from api import application, carnet_api, commandes_api, config, heros_etat, tv_cartes  # noqa: E402

DEMANDES = config.PROPOSITIONS / demandes.DOSSIER
SECRETS = ("SECRET-SAC", "NOTE-SAC", '"secret"', '"notes_mj"', "Gorvak", "anfrel")



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
def tablee(atelier):
    """Deux joueurs dont les héros sont à la tablée (Ysolde pour Aube, Tavarède pour Basile), un héros de la tablée sans
    joueur (Odile), un PNJ inconnu ; le carnet ouvert. Tout est retiré à la fin."""
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
        coin.post("/api/moi/aventurier", json={"nom": heros, "sante": 9, "psy": 5, "equipement": ["Cape"], "objets": ["", "", ""], "or": 30})
        coin.post("/api/moi/envoyer")
        fiche = atelier.post(f"/api/joueurs/{invite['id']}/accueillir").json()
        t[code] = {"joueur": invite, "coin": coin, "heros": fiche}
    t["odile"] = atelier.post("/api/aventuriers", json={"nom": "Odile Sansjoueur", "tablee": True, "equipement": [], "or": 0}).json()
    avant = carnet_api.carnet_ouvert()
    atelier.put("/api/carnet-joueurs", json={"ouvert": True})
    yield t
    for code in ("a", "b"):
        t[code]["coin"].close()
        atelier.delete(f"/api/joueurs/{t[code]['joueur']['id']}")
        atelier.delete(f"/api/aventuriers/{t[code]['heros']['id']}")
    atelier.delete(f"/api/aventuriers/{t['odile']['id']}")
    atelier.delete(f"/api/pnj/{t['pnj']['id']}")
    atelier.put("/api/carnet-joueurs", json={"ouvert": avant})
    demandes.ecrire_pause(config.PROPOSITIONS, False)
    patch.undo()


@pytest.fixture()
def sacs_neufs(atelier, tablee):
    """Chaque essai part de sacs connus, publiés, et d'un plafond horaire vide."""
    def poser(code, equipement, objets=("", "", ""), bourse=30):
        h = tablee[code]["heros"]
        f = atelier.get(f"/api/aventuriers/{h['id']}").json()
        r = atelier.patch(f"/api/aventuriers/{h['id']}/sac", json={
            "equipement": {"avant": heros_etat.sac_de(f, "equipement"), "apres": list(equipement)},
            "objets": {"avant": heros_etat.sac_de(f, "objets"), "apres": list(objets)},
            "or": {"avant": heros_etat.sac_de(f, "or"), "apres": bourse}})
        assert r.status_code == 200, r.text
    poser("a", ["Cape", "Corde"])
    poser("b", ["Torche"])
    with demandes.verrou(config.PROPOSITIONS):
        for code in ("a", "b"):
            demandes.fichier(config.PROPOSITIONS, tablee[code]["joueur"]["id"]).unlink(missing_ok=True)
    with carnet.verrou(config.PROPOSITIONS):
        for code in ("a", "b"):
            carnet.ecrire_commandes(config.PROPOSITIONS, tablee[code]["joueur"]["id"], [])
    joueurs.DEMANDES_FAITES.clear()
    carnet_api.publier_carnet()
    yield poser


def fiche(atelier, t, code):
    return atelier.get(f"/api/aventuriers/{t[code]['heros']['id']}").json()


def sac(t, code):
    return t[code]["coin"].get("/api/sac").json()


def geste(t, code, genre="sac", **corps):
    return t[code]["coin"].post("/api/demandes", json={"genre": genre, "corps": corps})


def traitee(t, code, ident):
    """La demande, une fois que l'atelier l'a appliquée ou mise en échec."""
    def lue():
        d = demandes.trouver(demandes.lire(config.PROPOSITIONS, t[code]["joueur"]["id"]), ident)
        return d if d and d["statut"] != demandes.A_APPLIQUER else None
    d = attendre(lue)
    assert d, "l'atelier n'a pas traité la demande"
    return d


def dans_la_boite(atelier, t, code, ident):
    v = atelier.get("/api/demandes").json()
    return next(x for x in v["attente"] + v["historique"] if x["joueur"] == t[code]["joueur"]["id"] and x["id"] == ident)


def ecrire_demande(t, code, genre, corps):
    """Une demande écrite tout droit dans la file, comme un coin qui ne vérifierait rien."""
    d = demandes.nouvelle({"genre": genre, "corps": corps})
    with demandes.verrou(config.PROPOSITIONS):
        jid = t[code]["joueur"]["id"]
        demandes.ecrire(config.PROPOSITIONS, jid, [*demandes.lire(config.PROPOSITIONS, jid), d])
    return d


def ref_de(t, code_qui_lit, nom):
    return next(c["ref"] for c in sac(t, code_qui_lit)["compagnons"] if c["nom"] == nom)


# ---------------------------------------------------------------- le sac : rejouer

def test_ajouter_renommer_retirer(atelier, tablee, sacs_neufs):
    t = tablee
    r = geste(t, "a", geste="ajouter", liste="equipement", ligne="  Lanterne \u0007 sourde ")
    assert r.status_code == 200 and r.json()["statut"] == "a-appliquer", r.text
    d = traitee(t, "a", r.json()["id"])
    assert d["statut"] == "appliquee" and d["resultat"] == "Ajouté à votre équipement : «\u00a0Lanterne sourde\u00a0»."
    assert fiche(atelier, t, "a")["equipement"] == ["Cape", "Corde", "Lanterne sourde"]
    # Quand le joueur lit « fait », sa fiche publiée est déjà à jour (republiée avant le statut).
    assert sac(t, "a")["heros"]["equipement"] == ["Cape", "Corde", "Lanterne sourde"]

    d = traitee(t, "a", geste(t, "a", geste="changer", liste="equipement", rang=1, avant="Corde", ligne="Corde de 15 m").json()["id"])
    assert d["statut"] == "appliquee" and fiche(atelier, t, "a")["equipement"] == ["Cape", "Corde de 15 m", "Lanterne sourde"]
    d = traitee(t, "a", geste(t, "a", geste="retirer", liste="equipement", rang=0, avant="Cape").json()["id"])
    assert d["statut"] == "appliquee" and fiche(atelier, t, "a")["equipement"] == ["Corde de 15 m", "Lanterne sourde"]

    # Les objets personnels : trois cases, une vidée reste une case.
    for nom in ("Un harmonica", "Une loupe", "Une alliance"):
        assert traitee(t, "a", geste(t, "a", geste="ajouter", liste="objets", ligne=nom).json()["id"])["statut"] == "appliquee"
    assert fiche(atelier, t, "a")["objets"] == ["Un harmonica", "Une loupe", "Une alliance"]
    r = geste(t, "a", geste="ajouter", liste="objets", ligne="Un quatrième")
    assert r.status_code == 409 and "trois objets" in r.json()["detail"]
    traitee(t, "a", geste(t, "a", geste="retirer", liste="objets", rang=1, avant="Une loupe").json()["id"])
    assert fiche(atelier, t, "a")["objets"] == ["Un harmonica", "", "Une alliance"]
    # Dans la boîte du MJ : une ligne lisible, et « Annuler ».
    vue = dans_la_boite(atelier, t, "a", d["id"])
    assert vue["phrase"] == "Aube a retiré « Cape »" and vue["annulable"] is True and vue["genre_nom"] == "Le sac"


def test_les_bornes_du_geste(atelier, tablee, sacs_neufs):
    t = tablee
    for corps, statut in (({"geste": "ajouter", "liste": "equipement", "ligne": "x" * 301}, 413),
                          ({"geste": "ajouter", "liste": "equipement", "ligne": "   "}, 400),
                          ({"geste": "ajouter", "liste": "poches", "ligne": "x"}, 400),
                          ({"geste": "voler", "liste": "equipement"}, 400),
                          ({"geste": "retirer", "liste": "equipement", "rang": -1, "avant": "Cape"}, 400),
                          ({"geste": "retirer", "liste": "equipement", "rang": True, "avant": "Cape"}, 400),
                          ({"geste": "retirer", "liste": "equipement", "rang": 0}, 400),
                          ({"geste": "ajouter", "liste": "equipement", "ligne": "x", "id": "vortan"}, 400)):
        r = geste(t, "a", **corps)
        assert r.status_code == statut, (corps, r.text)
    assert demandes.lire(config.PROPOSITIONS, t["a"]["joueur"]["id"]) == []


def test_un_geste_sur_l_or_est_refuse(atelier, tablee, sacs_neufs):
    t = tablee
    for corps in ({"geste": "or", "texte": "+500"}, {"geste": "ajouter", "liste": "or", "ligne": "500"},
                  {"geste": "changer", "liste": "equipement", "rang": 0, "avant": "Cape", "ligne": "x", "or": {"avant": 30, "apres": 900}}):
        r = geste(t, "a", **corps)
        assert r.status_code == 400 and "échoppe" in r.json()["detail"], r.text
    # Écrit tout droit dans la file, il ne passe pas davantage dans l'atelier.
    d = {"id": "abcabcabcabc", "genre": "sac", "statut": "a-appliquer", "version": 1, "cree": demandes.maintenant(),
         "modifie": demandes.maintenant(), "corps": {"geste": "or", "liste": "or"}, "resultat": None, "mot": "", "traitee": None, "par": "joueur"}
    with demandes.verrou(config.PROPOSITIONS):
        demandes.ecrire(config.PROPOSITIONS, t["a"]["joueur"]["id"], [d])
    assert traitee(t, "a", d["id"])["statut"] == "echec"
    assert fiche(atelier, t, "a")["or"] == 30


def test_rejeu_apres_un_changement_du_mj(atelier, tablee, sacs_neufs):
    """Le joueur voit « Corde » en 2e ligne ; le MJ ajoute une ligne en tête entre-temps : le geste retrouve « Corde » par
    son texte et ne touche à rien d'autre."""
    t = tablee
    f = fiche(atelier, t, "a")
    atelier.patch(f"/api/aventuriers/{f['id']}/sac", json={"equipement": {"avant": ["Cape", "Corde"], "apres": ["Torche", "Cape", "Corde"]}})
    d = traitee(t, "a", geste(t, "a", geste="changer", liste="equipement", rang=1, avant="Corde", ligne="Corde usée").json()["id"])
    assert d["statut"] == "appliquee"
    assert fiche(atelier, t, "a")["equipement"] == ["Torche", "Cape", "Corde usée"]
    # La ligne n'y est plus du tout (le MJ l'a retirée) : échec, avec sa phrase, et rien ne bouge.
    d = ecrire_demande(t, "a", "sac", {"geste": "retirer", "liste": "equipement", "rang": 5, "avant": "Corde"})
    fini = traitee(t, "a", d["id"])
    assert fini["statut"] == "echec" and fini["resultat"] == inventaire.PLUS_LA
    assert fiche(atelier, t, "a")["equipement"] == ["Torche", "Cape", "Corde usée"]


def test_une_ligne_retenue_est_introuvable(atelier, tablee, sacs_neufs):
    """Une ligne écrite par le MJ qui nomme un inconnu n'est pas publiée, et le joueur ne peut pas la viser, même en
    écrivant tout droit dans la file : l'atelier ne cherche que dans ce qu'il voit, et répond comme pour une ligne partie."""
    t = tablee
    sacs_neufs("a", ["Cape", "Lettre de Gorvak Sombrefer", "Corde"])
    carnet_api.publier_carnet()
    publie = sac(t, "a")["heros"]["equipement"]
    assert publie == ["Cape", "Corde"]
    assert "Gorvak" in " ".join(atelier.get("/api/carnet-joueurs").json()["retenus"])
    r = geste(t, "a", geste="retirer", liste="equipement", rang=1, avant="Lettre de Gorvak Sombrefer")
    assert r.status_code == 409 and r.json()["detail"] == inventaire.PLUS_LA
    d = ecrire_demande(t, "a", "sac", {"geste": "retirer", "liste": "equipement", "rang": 1, "avant": "Lettre de Gorvak Sombrefer"})
    fini = traitee(t, "a", d["id"])
    assert fini["statut"] == "echec" and fini["resultat"] == inventaire.PLUS_LA
    assert "Lettre de Gorvak Sombrefer" in fiche(atelier, t, "a")["equipement"]
    # Le rang que voit le joueur n'est pas celui de la fiche : « Corde » est sa 2e ligne, la 3e du serveur.
    assert traitee(t, "a", geste(t, "a", geste="retirer", liste="equipement", rang=1, avant="Corde").json()["id"])["statut"] == "appliquee"
    assert fiche(atelier, t, "a")["equipement"] == ["Cape", "Lettre de Gorvak Sombrefer"]
    # Trois cases d'objets dont une retenue : le joueur en voit deux, le troisième s'ajoute sans rien en dire.
    sacs_neufs("a", ["Cape"], ["Un harmonica", "Le sceau de Gorvak Sombrefer", "Une loupe"])
    carnet_api.publier_carnet()
    assert sac(t, "a")["heros"]["objets"] == ["Un harmonica", "Une loupe"]
    assert traitee(t, "a", geste(t, "a", geste="ajouter", liste="objets", ligne="Une alliance").json()["id"])["statut"] == "appliquee"
    assert fiche(atelier, t, "a")["objets"] == ["Un harmonica", "Le sceau de Gorvak Sombrefer", "Une loupe", "Une alliance"]
    assert sac(t, "a")["heros"]["objets"] == ["Un harmonica", "Une loupe", "Une alliance"]


def test_ce_que_le_joueur_ecrit_lui_revient_tel_quel(atelier, tablee, sacs_neufs):
    """Qu'une ligne tapée par le joueur disparaisse ou change lui dirait qu'elle nomme un secret : elle lui revient telle
    qu'il l'a écrite, et le MJ en est averti. La même ligne écrite par le MJ reste retenue ou masquée."""
    t = tablee
    for ligne in ("Lettre pour Gorvak Sombrefer", "Clé de la chambre 3 de la Petite Fanfrelée"):
        assert traitee(t, "a", geste(t, "a", geste="ajouter", liste="equipement", ligne=ligne).json()["id"])["statut"] == "appliquee"
    assert sac(t, "a")["heros"]["equipement"] == ["Cape", "Corde", "Lettre pour Gorvak Sombrefer", "Clé de la chambre 3 de la Petite Fanfrelée"]
    retenus = " ".join(atelier.get("/api/carnet-joueurs").json()["retenus"])
    assert "son joueur a noté « Lettre pour Gorvak Sombrefer »" in retenus
    # Il peut la viser comme il la lit.
    d = geste(t, "a", geste="changer", liste="equipement", rang=3, avant="Clé de la chambre 3 de la Petite Fanfrelée", ligne="Clé de la cave")
    assert traitee(t, "a", d.json()["id"])["statut"] == "appliquee"
    # Écrite par le MJ chez un autre héros, la même ligne ne paraît pas, ou passe au masque.
    sacs_neufs("b", ["Lettre pour Gorvak Sombrefer", "Clé de la Petite Fanfrelée"])
    carnet_api.publier_carnet()
    vu = sac(t, "b")["heros"]["equipement"]
    assert len(vu) == 1 and "Fanfrel" not in vu[0] and "auberge" in vu[0]


# ---------------------------------------------------------------- annuler

def test_annuler_qui_marche_et_qui_refuse(atelier, tablee, sacs_neufs):
    t = tablee
    d = traitee(t, "a", geste(t, "a", geste="ajouter", liste="equipement", ligne="Lanterne").json()["id"])
    vue = dans_la_boite(atelier, t, "a", d["id"])
    url = f"/api/demandes/{t['a']['joueur']['id']}/{d['id']}/annuler"
    r = atelier.post(url, json={"version": vue["version"]})
    assert r.status_code == 200 and r.json()["statut"] == "annulee", r.text
    assert fiche(atelier, t, "a")["equipement"] == ["Cape", "Corde"]
    assert sac(t, "a")["heros"]["equipement"] == ["Cape", "Corde"]
    vu = next(x for x in sac(t, "a")["demandes"] if x["id"] == d["id"])
    assert vu["statut_dit"] == "annulé par le MJ" and "annulé" in vu["resultat"]
    assert atelier.post(url, json={"version": r.json()["version"]}).status_code == 409

    # Trop tard : le sac a changé depuis (le MJ y a ajouté une ligne). Rien ne bouge, et le MJ lit pourquoi.
    d = traitee(t, "a", geste(t, "a", geste="retirer", liste="equipement", rang=0, avant="Cape").json()["id"])
    atelier.patch(f"/api/aventuriers/{t['a']['heros']['id']}/sac", json={"equipement": {"avant": ["Corde"], "apres": ["Corde", "Torche"]}})
    vue = dans_la_boite(atelier, t, "a", d["id"])
    r = atelier.post(f"/api/demandes/{t['a']['joueur']['id']}/{d['id']}/annuler", json={"version": vue["version"]})
    assert r.status_code == 409 and "a changé depuis" in r.json()["detail"]
    assert fiche(atelier, t, "a")["equipement"] == ["Corde", "Torche"]
    assert dans_la_boite(atelier, t, "a", d["id"])["statut"] == "appliquee"


# ---------------------------------------------------------------- donner

def test_donner_un_objet_puis_annuler(atelier, tablee, sacs_neufs):
    t = tablee
    tavarede = ref_de(t, "a", "Tavarède Lavelle")
    d = traitee(t, "a", geste(t, "a", "don-objet", liste="equipement", rang=1, avant="Corde", ref=tavarede).json()["id"])
    assert d["statut"] == "appliquee" and d["resultat"] == "«\u00a0Corde\u00a0» donné à Tavarède."
    assert fiche(atelier, t, "a")["equipement"] == ["Cape"] and fiche(atelier, t, "b")["equipement"] == ["Torche", "Corde"]
    # Les deux fiches « Mon héros » sont republiées tout de suite.
    assert sac(t, "a")["heros"]["equipement"] == ["Cape"] and sac(t, "b")["heros"]["equipement"] == ["Torche", "Corde"]
    vue = dans_la_boite(atelier, t, "a", d["id"])
    assert vue["phrase"] == "Aube donne « Corde » à Tavarède" and vue["annulable"]
    r = atelier.post(f"/api/demandes/{t['a']['joueur']['id']}/{d['id']}/annuler", json={"version": vue["version"]})
    assert r.status_code == 200
    assert fiche(atelier, t, "a")["equipement"] == ["Cape", "Corde"] and fiche(atelier, t, "b")["equipement"] == ["Torche"]
    # Un objet personnel donné : sa case se vide, il entre dans l'équipement de l'autre. À un héros sans joueur aussi.
    sacs_neufs("a", ["Cape"], ["Un harmonica", "", ""])
    carnet_api.publier_carnet()
    odile = ref_de(t, "a", "Odile Sansjoueur")
    d = traitee(t, "a", geste(t, "a", "don-objet", liste="objets", rang=0, avant="Un harmonica", ref=odile).json()["id"])
    assert d["statut"] == "appliquee"
    assert fiche(atelier, t, "a")["objets"] == ["", "", ""] and atelier.get(f"/api/aventuriers/{t['odile']['id']}").json()["equipement"] == ["Un harmonica"]
    # Ni à soi-même, ni à un inconnu.
    moi = carnet_api.ref_compagnon(t["a"]["heros"]["id"])
    assert moi not in {c["ref"] for c in sac(t, "a")["compagnons"]}
    assert geste(t, "a", "don-objet", liste="equipement", rang=0, avant="Cape", ref=moi).status_code == 409
    assert geste(t, "a", "don-objet", liste="equipement", rang=0, avant="Cape", ref="0" * 20).status_code == 409
    d = ecrire_demande(t, "a", "don-objet", {"liste": "equipement", "rang": 0, "avant": "Cape", "ref": moi})
    assert traitee(t, "a", d["id"])["statut"] == "echec" and fiche(atelier, t, "a")["equipement"] == ["Cape"]


def test_don_simultane_dans_les_deux_sens(atelier, tablee, sacs_neufs):
    """Aube donne sa corde à Tavarède pendant que Basile donne sa torche à Ysolde : les deux passent, rien ne se perd."""
    t = tablee
    ysolde, tavarede = ref_de(t, "b", "Ysolde Gris"), ref_de(t, "a", "Tavarède Lavelle")
    with demandes.verrou(config.PROPOSITIONS):
        da = demandes.nouvelle({"genre": "don-objet", "corps": {"liste": "equipement", "rang": 1, "avant": "Corde", "ref": tavarede}})
        db = demandes.nouvelle({"genre": "don-objet", "corps": {"liste": "equipement", "rang": 0, "avant": "Torche", "ref": ysolde}})
        demandes.ecrire(config.PROPOSITIONS, t["a"]["joueur"]["id"], [da])
        demandes.ecrire(config.PROPOSITIONS, t["b"]["joueur"]["id"], [db])
    assert traitee(t, "a", da["id"])["statut"] == "appliquee" and traitee(t, "b", db["id"])["statut"] == "appliquee"
    assert sorted(fiche(atelier, t, "a")["equipement"]) == ["Cape", "Torche"]
    assert sorted(fiche(atelier, t, "b")["equipement"]) == ["Corde"]
    # Deux dons de la même ligne : le second ne la trouve plus.
    sacs_neufs("a", ["Corde"])
    carnet_api.publier_carnet()
    d1 = ecrire_demande(t, "a", "don-objet", {"liste": "equipement", "rang": 0, "avant": "Corde", "ref": tavarede})
    d2 = ecrire_demande(t, "a", "don-objet", {"liste": "equipement", "rang": 0, "avant": "Corde", "ref": ref_de(t, "a", "Odile Sansjoueur")})
    statuts = sorted([traitee(t, "a", d1["id"])["statut"], traitee(t, "a", d2["id"])["statut"]])
    assert statuts == ["appliquee", "echec"]
    assert fiche(atelier, t, "a")["equipement"] == []


def test_un_don_touche_deux_sacs_ou_aucun(atelier, tablee, sacs_neufs, monkeypatch):
    """Si le sac du compagnon a changé entre la lecture et l'écriture, ni l'un ni l'autre ne bouge."""
    t = tablee
    vrai = heros_etat.changer_les_sacs

    def changer(corps):
        # Le MJ écrit dans le sac de Tavarède juste avant : la route le voit au moment de vérifier.
        if t["b"]["heros"]["id"] in corps and len(corps) == 2:
            vrai({t["b"]["heros"]["id"]: {"equipement": {"avant": ["Torche"], "apres": ["Torche", "Pain"]}}})
        return vrai(corps)
    monkeypatch.setattr(commandes_api.sacs, "changer", changer)
    d = ecrire_demande(t, "a", "don-objet", {"liste": "equipement", "rang": 1, "avant": "Corde", "ref": ref_de(t, "a", "Tavarède Lavelle")})
    fini = traitee(t, "a", d["id"])
    assert fini["statut"] == "echec" and "au même moment" in fini["resultat"]
    assert fiche(atelier, t, "a")["equipement"] == ["Cape", "Corde"] and fiche(atelier, t, "b")["equipement"] == ["Torche", "Pain"]


# ---------------------------------------------------------------- l'or

def test_donner_de_l_or(atelier, tablee, sacs_neufs):
    t = tablee
    tavarede = ref_de(t, "a", "Tavarède Lavelle")
    # Une commande en attente engage de l'or, elle aussi.
    with carnet.verrou(config.PROPOSITIONS):
        carnet.ecrire_commandes(config.PROPOSITIONS, t["a"]["joueur"]["id"], [{"id": "abcdefabcdef", "boutique": "0" * 20, "boutique_nom": "La Forge",
                                                                          "lignes": [], "total": 5, "a_fixer": False, "statut": "en-attente",
                                                                          "cree": demandes.maintenant()}])
    r = geste(t, "a", "don-or", ref=tavarede, montant=20)
    assert r.status_code == 200 and r.json()["statut"] == "en-attente", r.text
    o = sac(t, "a")["or"]
    assert o == {"bourse": 30, "commandes": 5, "dons": 20, "versements": 0, "total": 25, "disponible": 5}
    r = geste(t, "a", "don-or", ref=tavarede, montant=6)
    assert r.status_code == 409 and "5 po disponibles" in r.json()["detail"]
    for montant in (0, -3, 2.5, "10", True):
        assert geste(t, "a", "don-or", ref=tavarede, montant=montant).status_code == 400, montant
    d = next(x for x in sac(t, "a")["demandes"] if x["genre"] == "don-or")
    vue = dans_la_boite(atelier, t, "a", d["id"])
    assert vue["phrase"] == "Aube donne 20 po à Tavarède (sa bourse : 30 po)" and vue["oui"] == "Accepter" and vue["non"] == "Refuser"
    assert atelier.get("/api/demandes").json()["compte"] >= 1
    # Accepté : la bourse est revérifiée, l'or passe d'un sac à l'autre.
    r = atelier.post(f"/api/demandes/{t['a']['joueur']['id']}/{d['id']}/accepter", json={"version": vue["version"], "mot": "Bien joué."})
    assert r.status_code == 200 and r.json()["statut"] == "acceptee", r.text
    assert fiche(atelier, t, "a")["or"] == 10 and fiche(atelier, t, "b")["or"] == 50
    assert sac(t, "a")["or"]["bourse"] == 10 and sac(t, "b")["or"]["bourse"] == 50
    vu = next(x for x in sac(t, "a")["demandes"] if x["id"] == d["id"])
    assert vu["mot"] == "Bien joué." and vu["resultat"] == "20 po données à Tavarède." and vu["retirable"] is False

    # La bourse a fondu avant que le MJ ne tranche : « Accepter » refuse, rien ne bouge, la demande attend toujours.
    d = geste(t, "a", "don-or", ref=tavarede, montant=5).json()
    atelier.patch(f"/api/aventuriers/{t['a']['heros']['id']}/sac", json={"or": {"avant": 10, "apres": 2}})
    url = f"/api/demandes/{t['a']['joueur']['id']}/{d['id']}"
    r = atelier.post(f"{url}/accepter", json={"version": 1})
    assert r.status_code == 409 and "n'a plus que 2 po" in r.json()["detail"]
    assert fiche(atelier, t, "a")["or"] == 2 and fiche(atelier, t, "b")["or"] == 50
    r = atelier.post(f"{url}/refuser", json={"version": 1, "mot": "Pas maintenant."})
    assert r.status_code == 200 and r.json()["statut"] == "refusee"
    vu = next(x for x in sac(t, "a")["demandes"] if x["id"] == d["id"])
    assert vu["statut_dit"] == "refusé par le MJ" and vu["mot"] == "Pas maintenant."
    assert sac(t, "a")["or"]["dons"] == 0 and fiche(atelier, t, "a")["or"] == 2


def test_le_joueur_retire_son_don_d_or(atelier, tablee, sacs_neufs):
    t = tablee
    d = geste(t, "a", "don-or", ref=ref_de(t, "a", "Tavarède Lavelle"), montant=10).json()
    assert sac(t, "a")["or"]["disponible"] == 20
    assert t["a"]["coin"].delete(f"/api/demandes/{d['id']}").status_code == 200
    assert sac(t, "a")["or"]["disponible"] == 30


def test_ce_qui_se_dit_sur_telegram():
    """Les gestes du sac et les dons d'objets sont silencieux ; un don d'or prévient le MJ."""
    assert demandes.GENRES["sac"].silencieux and demandes.GENRES["don-objet"].silencieux
    assert not demandes.GENRES["don-or"].silencieux and demandes.GENRES["don-or"].attente
    el = lambda genre, statut, i: {"type": "demande", "joueur": "lea", "joueur_nom": "Léa", "id": f"{i:012x}", "genre": genre, "statut": statut}
    presentes = boite_mod.Boite.cles_presentes([el("don-or", "en-attente", 3)], [el("sac", "appliquee", 1), el("don-objet", "appliquee", 2)])
    assert [presentes[f"d:lea:{i:012x}"][2] for i in (1, 2, 3)] == [False, False, True]


# ---------------------------------------------------------------- fermé, en pause

def test_carnet_ferme_inventaire_ferme(atelier, tablee, sacs_neufs):
    t = tablee
    atelier.put("/api/carnet-joueurs", json={"ouvert": False})
    try:
        assert sac(t, "a") == {"ouvert": False}
        for genre, corps in (("sac", {"geste": "ajouter", "liste": "equipement", "ligne": "Pain"}),
                             ("don-or", {"ref": "a" * 20, "montant": 1})):
            r = geste(t, "a", genre, **corps)
            assert r.status_code == 423 and "fermé" in r.json()["detail"], r.text
        # Une demande écrite avant la fermeture n'est plus appliquée.
        d = ecrire_demande(t, "a", "sac", {"geste": "ajouter", "liste": "equipement", "ligne": "Pain"})
        assert traitee(t, "a", d["id"])["statut"] == "echec" and fiche(atelier, t, "a")["equipement"] == ["Cape", "Corde"]
    finally:
        atelier.put("/api/carnet-joueurs", json={"ouvert": True})


def test_en_pause_rien_ne_change(atelier, tablee, sacs_neufs):
    t = tablee
    atelier.put("/api/demandes/reglages", json={"pause": True})
    try:
        r = geste(t, "a", geste="ajouter", liste="equipement", ligne="Pain")
        assert r.status_code == 423 and r.headers["X-Coin-En-Pause"] == "1"
        assert sac(t, "a")["pause"] is True
    finally:
        atelier.put("/api/demandes/reglages", json={"pause": False})


# ---------------------------------------------------------------- les fuites

def test_chacun_son_sac(atelier, tablee, sacs_neufs):
    """Basile ne lit ni ne touche le sac d'Ysolde : ses gestes ne visent que le sien, ce qu'il lit n'est que le sien."""
    t = tablee
    sacs_neufs("a", ["Cape", "CORDE-YSOLDE"])
    carnet_api.publier_carnet()
    lu = sac(t, "b")
    assert "CORDE-YSOLDE" not in json.dumps(lu) and lu["heros"]["nom"] == "Tavarède Lavelle"
    r = geste(t, "b", geste="retirer", liste="equipement", rang=1, avant="CORDE-YSOLDE")
    assert r.status_code == 409
    d = ecrire_demande(t, "b", "sac", {"geste": "retirer", "liste": "equipement", "rang": 1, "avant": "CORDE-YSOLDE"})
    assert traitee(t, "b", d["id"])["statut"] == "echec"
    d = ecrire_demande(t, "b", "don-objet", {"liste": "equipement", "rang": 1, "avant": "CORDE-YSOLDE", "ref": ref_de(t, "b", "Odile Sansjoueur")})
    assert traitee(t, "b", d["id"])["statut"] == "echec"
    assert fiche(atelier, t, "a")["equipement"] == ["Cape", "CORDE-YSOLDE"]
    # Les demandes d'Aube ne se lisent pas depuis la session de Basile, ni sans session.
    da = geste(t, "a", "don-or", ref=ref_de(t, "a", "Tavarède Lavelle"), montant=3).json()
    assert da["id"] not in json.dumps(sac(t, "b")) and t["b"]["coin"].delete(f"/api/demandes/{da['id']}").status_code == 404
    with TestClient(joueurs.app) as sans:
        assert sans.get("/api/sac").status_code == 401
        assert sans.post("/api/demandes", json={"genre": "sac", "corps": {"geste": "ajouter", "liste": "equipement", "ligne": "x"}}).status_code == 401


def test_rien_de_secret_ne_repart_vers_le_coin(atelier, tablee, sacs_neufs):
    t = tablee
    h = t["a"]["heros"]
    atelier.patch(f"/api/aventuriers/{h['id']}", json={"secret": "SECRET-SAC", "notes_mj": "NOTE-SAC"})
    sacs_neufs("a", ["Cape", "Clé de la Petite Fanfrelée", "Lettre de Gorvak Sombrefer"])
    try:
        d = traitee(t, "a", geste(t, "a", geste="ajouter", liste="equipement", ligne="Pain").json()["id"])
        tout = [sac(t, "a"), sac(t, "b"), t["a"]["coin"].get("/api/demandes").json(), t["a"]["coin"].get("/api/carnet").json(), d]
        tout.append([f.read_text(encoding="utf-8") for f in (config.PROPOSITIONS / carnet.CARNET / carnet.HEROS).glob("*.json")])
        tout.append((config.PROPOSITIONS / carnet.CARNET / "compagnie.json").read_text(encoding="utf-8"))
        texte = json.dumps(tout, ensure_ascii=False)
        for interdit in SECRETS:
            assert interdit not in texte, interdit
        # Les identifiants des fiches ne sortent pas non plus.
        for code in ("a", "b"):
            assert f'"{t[code]["heros"]["id"]}"' not in json.dumps(tout[:4], ensure_ascii=False)
        # Le journal du sac reste dans l'atelier : rien n'en est écrit dans le dossier des propositions.
        assert not list(config.PROPOSITIONS.rglob("journal-sac*")) and (config.DONNEES / "journal-sac.jsonl").exists()
        # Rien de nouveau à la racine des propositions, ni dans carnet/media.
        assert not [p for p in config.PROPOSITIONS.glob("*.json") if "sac" in p.name]
    finally:
        atelier.patch(f"/api/aventuriers/{h['id']}", json={"secret": "", "notes_mj": ""})


def test_le_jeton_d_un_compagnon_ne_dit_rien_de_sa_fiche(atelier, tablee, sacs_neufs):
    t = tablee
    compagnie = carnet.lire_publie(config.PROPOSITIONS / carnet.CARNET / "compagnie.json")["elements"]
    refs = {h["nom"]: h["ref"] for h in compagnie}
    for code in ("a", "b"):
        ident = t[code]["heros"]["id"]
        ref = refs[t[code]["heros"]["nom"]]
        assert inventaire.REF.match(ref) and ident not in ref
        assert ref != tv_cartes.jeton("aventuriers", ident)  # pas celui de la TV non plus
        assert ref not in (hashlib.sha256(ident.encode()).hexdigest(), hashlib.md5(ident.encode()).hexdigest()[:20],
                           hashlib.sha256(ident.encode()).hexdigest()[:20], ident.encode().hex()[:20])
    assert len(set(refs.values())) == len(refs)
    # Côté coin, la liste des compagnons ne porte que le jeton, le nom et le genre.
    assert all(set(c) == {"ref", "nom", "genre"} for c in sac(t, "a")["compagnons"])


def test_les_pages_de_l_atelier_relisent_les_sacs(atelier, tablee, sacs_neufs):
    t = tablee
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
                if m.get("type") == "sac":
                    return
        fil = threading.Thread(target=ecouter, daemon=True)
        fil.start()
        geste(t, "a", geste="ajouter", liste="equipement", ligne="Pain")
        fil.join(5)
    m = next((m for m in recus if m.get("type") == "sac"), None)
    assert m == {"type": "sac", "heros": [t["a"]["heros"]["id"]]}, recus


def test_la_route_du_mj_ne_change_pas(atelier, tablee, sacs_neufs):
    """La route du sac de l'atelier, devenue le cœur partagé : mêmes réponses qu'avant."""
    h = tablee["a"]["heros"]
    url = f"/api/aventuriers/{h['id']}/sac"
    r = atelier.patch(url, json={"equipement": {"avant": ["Cape", "Corde"], "apres": ["Cape"]}})
    assert r.status_code == 200 and r.json()["equipement"] == ["Cape"] and "secret" in r.json()
    assert atelier.patch(url, json={"equipement": {"avant": ["Cape", "Corde"], "apres": ["Cape"]}}).status_code == 200  # déjà fait
    assert atelier.patch(url, json={"equipement": {"avant": ["Autre"], "apres": []}}).status_code == 409
    assert atelier.patch(url, json={"equipement": ["x"]}).status_code == 400
    assert atelier.patch(url, json={"or": {"avant": 30, "apres": -1}}).status_code == 400
    assert atelier.patch("/api/aventuriers/inconnu-du-tout/sac", json={}).status_code == 404


def test_le_portage_suit_corps_du_sac():
    """Les cas communs (tests/sac-cas.json, vérifiés côté page par outils/verifier_sac.mjs) : sur une fiche publiée, le
    rejeu de l'atelier rend ce que corpsDuSac rend dans la page du joueur."""
    cas = json.loads((Path(__file__).parent / "sac-cas.json").read_text(encoding="utf-8"))["cas"]
    for c in cas:
        g = c["geste"]
        brute = heros_etat.sac_de(c["fiche"], g["liste"])
        vues = [(i, x) for i, x in enumerate(brute) if x.strip()]
        corps = {"geste": g["genre"], "liste": g["liste"], **({"rang": g["rang"], "avant": g["avant"]} if "avant" in g else {}),
                 **({"ligne": g["texte"]} if "texte" in g else {}), **({"de": g["de"]} if "de" in g else {})}
        # Le validateur du coin ne laisse passer qu'un de plus ou un de moins dans l'équipement ; le rejeu, lui, sert aussi au
        # don de quelques exemplaires : ces cas-là lui arrivent tout droit.
        if not (g["genre"] == "quantite" and (abs(g["de"]) != 1 or g["liste"] != "equipement")):
            corps = inventaire.valider_sac(corps)
        if c["attendu"].get("erreur"):
            with pytest.raises(demandes.Refus):
                inventaire.rejouer(brute, vues, corps)
        else:
            assert inventaire.rejouer(brute, vues, corps) == c["attendu"], c["nom"]


def test_les_gestes_du_sac_ont_leur_propre_compte(monkeypatch):
    """Une séance d'inventaire (beaucoup de petits gestes) n'empêche pas d'écrire un mot au MJ, et inversement."""
    monkeypatch.setattr(joueurs, "DEMANDES_FAITES", {})
    import time as _t
    maintenant = _t.monotonic()
    joueurs.DEMANDES_FAITES["lea"] = [maintenant] * joueurs.demandes.PAR_HEURE
    assert joueurs.plafond_horaire("lea", "message")
    assert not joueurs.plafond_horaire("lea", "sac") and not joueurs.plafond_horaire("lea", "don-objet")
    joueurs.DEMANDES_FAITES["lea:sac"] = [maintenant] * joueurs.GESTES_DU_SAC_PAR_HEURE
    assert joueurs.plafond_horaire("lea", "sac")
    assert joueurs.compte_horaire("lea", "don-or") == ("lea", joueurs.demandes.PAR_HEURE)


def test_le_plafond_du_fichier_se_compte_aussi_par_famille(monkeypatch):
    """Trente gestes du sac dans l'heure, notés dans le fichier, n'empêchent pas un mot au MJ (et le coin redémarré
    retrouve les deux comptes séparés)."""
    from datetime import datetime as _dt
    instant = _dt.now().isoformat(timespec="milliseconds")
    deja = [{"genre": "sac", "cree": instant} for _ in range(joueurs.demandes.PAR_HEURE)]
    sac = [x for x in deja if x["genre"] in joueurs.GESTES_DU_SAC]
    autres = [x for x in deja if x["genre"] not in joueurs.GESTES_DU_SAC]
    borne = _dt.now().replace(hour=0, minute=0)
    assert joueurs.demandes.recentes(sac, borne) == joueurs.demandes.PAR_HEURE
    assert joueurs.demandes.recentes(autres, borne) == 0


def test_une_ligne_trop_longue_se_dit_au_bon_accord():
    """« Le texte de la ligne est trop long » (il disait « Cette ligne est trop long »)."""
    with pytest.raises(demandes.Refus) as refus:
        inventaire.valider_sac({"geste": "ajouter", "liste": "objets", "ligne": "y" * (inventaire.LIGNE_MAX + 1)})
    assert refus.value.statut == 413 and refus.value.message.startswith("Le texte de la ligne est trop long")


# ---------------------------------------------------------------- les quantités

CAS = json.loads((Path(__file__).parent / "sac-cas.json").read_text(encoding="utf-8"))


def test_les_quantites_se_lisent_comme_dans_la_page():
    """Les cas communs des jumelles (tests/sac-cas.json, vérifiés côté page par outils/verifier_sac.mjs) : quantite_de,
    ligne, douteuse, cle_nom. Et ce qui se lit se réécrit et se relit pareil, à toute quantité."""
    for texte, nom, n in CAS["quantites"]:
        assert inventaire.quantite_de(texte) == (nom, n), texte
        if nom and not inventaire.douteuse(texte):
            for k in (1, 2, 999):
                assert inventaire.quantite_de(inventaire.ligne(nom, k)) == (nom, k), (texte, k)
    for nom, n, texte in CAS["lignes"]:
        assert inventaire.ligne(nom, n) == texte
    for texte, oui in CAS["douteuses"]:
        assert inventaire.douteuse(texte) is oui, texte
    for a, b, meme in CAS["memes_noms"]:
        assert (inventaire.cle_nom(a) == inventaire.cle_nom(b)) is meme, (a, b)
    assert inventaire.quantite_de(None) == ("", 1) and inventaire.quantite_de(12) == ("", 1)


def test_une_ligne_tordue_se_lit_vite():
    """Trois cents marques empilées : la lecture ne s'emballe pas (pas de retour en arrière en cascade)."""
    debut = time.monotonic()
    for texte in ("1x " * 99 + "a" + " ×1" * 99, "a" + " x1" * 150, "×" * 600, "1 " * 300, "a" + " " * 300 + "×" + "9" * 290):
        inventaire.quantite_de(texte)
        inventaire.douteuse(texte)
    assert time.monotonic() - debut < 0.5


def test_plus_un_moins_un_et_retrait_a_zero(atelier, tablee, sacs_neufs):
    t = tablee
    sacs_neufs("a", ["Cape", "Torche"])
    carnet_api.publier_carnet()
    d = traitee(t, "a", geste(t, "a", geste="quantite", liste="equipement", rang=1, avant="Torche", de=1).json()["id"])
    assert d["statut"] == "appliquee" and d["resultat"] == "«\u00a0Torche\u00a0» : un de plus, vous en avez 2."
    assert fiche(atelier, t, "a")["equipement"] == ["Cape", "Torche ×2"] and sac(t, "a")["heros"]["equipement"] == ["Cape", "Torche ×2"]
    assert dans_la_boite(atelier, t, "a", d["id"])["phrase"] == "Aube a ajouté 1 à « Torche »"
    # Deux touchers rapprochés : le second part avec le texte d'avant le premier. La ligne se retrouve par son nom.
    d = ecrire_demande(t, "a", "sac", {"geste": "quantite", "liste": "equipement", "rang": 1, "avant": "Torche", "de": 1})
    assert traitee(t, "a", d["id"])["statut"] == "appliquee" and fiche(atelier, t, "a")["equipement"] == ["Cape", "Torche ×3"]
    assert geste(t, "a", geste="quantite", liste="equipement", rang=1, avant="Torche ×2", de=1).status_code == 200
    assert attendre(lambda: fiche(atelier, t, "a")["equipement"] == ["Cape", "Torche ×4"])
    for attendu in (["Cape", "Torche ×3"], ["Cape", "Torche ×2"], ["Cape", "Torche"]):
        avant = fiche(atelier, t, "a")["equipement"][1]
        d = traitee(t, "a", geste(t, "a", geste="quantite", liste="equipement", rang=1, avant=avant, de=-1).json()["id"])
        assert d["statut"] == "appliquee" and fiche(atelier, t, "a")["equipement"] == attendu
    assert d["resultat"] == "«\u00a0Torche\u00a0» : un de moins, il vous en reste 1."
    # À zéro, la ligne s'en va.
    d = traitee(t, "a", geste(t, "a", geste="quantite", liste="equipement", rang=1, avant="Torche", de=-1).json()["id"])
    assert d["statut"] == "appliquee" and d["resultat"] == "Retiré de votre équipement : «\u00a0Torche\u00a0»."
    assert fiche(atelier, t, "a")["equipement"] == ["Cape"] and sac(t, "a")["heros"]["equipement"] == ["Cape"]
    assert dans_la_boite(atelier, t, "a", d["id"])["phrase"] == "Aube a retiré 1 de « Torche »"
    # Une ligne écrite à l'ancienne se compte et se réécrit ; une mesure ne se compte pas.
    sacs_neufs("a", ["Corde x2", "Planche 2 x 4"])
    carnet_api.publier_carnet()
    assert traitee(t, "a", geste(t, "a", geste="quantite", liste="equipement", rang=0, avant="Corde x2", de=1).json()["id"])["statut"] == "appliquee"
    fini = traitee(t, "a", geste(t, "a", geste="quantite", liste="equipement", rang=1, avant="Planche 2 x 4", de=1).json()["id"])
    assert fini["statut"] == "echec" and fini["resultat"] == inventaire.NE_SE_COMPTE_PAS
    assert fiche(atelier, t, "a")["equipement"] == ["Corde ×3", "Planche 2 x 4"]


def test_les_bornes_de_la_quantite(atelier, tablee, sacs_neufs):
    t = tablee
    base = {"geste": "quantite", "liste": "equipement", "rang": 0, "avant": "Cape"}
    for corps in ({**base}, {**base, "de": 2}, {**base, "de": 0}, {**base, "de": -5}, {**base, "de": True}, {**base, "de": "1"}, {**base, "de": 1.0, "ligne": "x"},
                  {**base, "de": 1, "liste": "objets"}, {"geste": "quantite", "liste": "equipement", "de": 1},
                  {"geste": "ajouter", "liste": "equipement", "ligne": "x", "de": 1}, {"geste": "retirer", "liste": "equipement", "rang": 0, "avant": "Cape", "de": -1}):
        r = geste(t, "a", **corps)
        assert r.status_code == 400, (corps, r.text)
    assert geste(t, "a", **{**base, "avant": "Lanterne", "de": 1}).status_code == 409
    assert demandes.lire(config.PROPOSITIONS, t["a"]["joueur"]["id"]) == []
    assert fiche(atelier, t, "a")["equipement"] == ["Cape", "Corde"]
    # Pas plus de 999 : refusé par l'atelier, rien ne bouge.
    sacs_neufs("a", ["Flèches ×999"])
    carnet_api.publier_carnet()
    fini = traitee(t, "a", geste(t, "a", geste="quantite", liste="equipement", rang=0, avant="Flèches ×999", de=1).json()["id"])
    assert fini["statut"] == "echec" and fini["resultat"] == inventaire.TROP and fiche(atelier, t, "a")["equipement"] == ["Flèches ×999"]


def test_ajouter_ce_qui_est_deja_la_augmente_la_quantite(atelier, tablee, sacs_neufs):
    t = tablee
    sacs_neufs("a", ["Potion de soins ×2", "Potion de soins", "Cape"])
    carnet_api.publier_carnet()
    d = traitee(t, "a", geste(t, "a", geste="ajouter", liste="equipement", ligne="  potion de  SOINS ").json()["id"])
    assert d["statut"] == "appliquee" and d["resultat"] == "Ajouté à votre équipement : «\u00a0potion de SOINS\u00a0». Vous en avez 3."
    assert fiche(atelier, t, "a")["equipement"] == ["Potion de soins ×3", "Potion de soins", "Cape"]
    assert traitee(t, "a", geste(t, "a", geste="ajouter", liste="equipement", ligne="cape x2").json()["id"])["statut"] == "appliquee"
    assert fiche(atelier, t, "a")["equipement"] == ["Potion de soins ×3", "Potion de soins", "Cape ×3"]
    # Une ligne neuve : la quantité s'écrit « ×N », un seul exemplaire sans suffixe.
    for tape, ecrit in (("3x Torche", "Torche ×3"), ("Lanterne ×1", "Lanterne"), ("Planche 2 x 4", "Planche 2 x 4")):
        d = traitee(t, "a", geste(t, "a", geste="ajouter", liste="equipement", ligne=tape).json()["id"])
        assert d["statut"] == "appliquee" and fiche(atelier, t, "a")["equipement"][-1] == ecrit, tape
    # Renommer écrit aussi « ×N », sans rien regrouper.
    rang = len(fiche(atelier, t, "a")["equipement"]) - 2
    d = traitee(t, "a", geste(t, "a", geste="changer", liste="equipement", rang=rang, avant="Lanterne", ligne="Cape x 4").json()["id"])
    assert d["statut"] == "appliquee" and fiche(atelier, t, "a")["equipement"][rang] == "Cape ×4"
    # Les trois objets personnels ne sont pas concernés : ni regroupés, ni réécrits.
    for nom in ("Dés x2", "Dés x2"):
        assert traitee(t, "a", geste(t, "a", geste="ajouter", liste="objets", ligne=nom).json()["id"])["statut"] == "appliquee"
    assert fiche(atelier, t, "a")["objets"] == ["Dés x2", "Dés x2", ""]
    # Un sac plein reçoit encore ce qu'il a déjà.
    sacs_neufs("a", ["Torche"] + [f"Objet {i}" for i in range(inventaire.LIGNES_MAX - 1)])
    carnet_api.publier_carnet()
    assert geste(t, "a", geste="ajouter", liste="equipement", ligne="Lanterne").status_code == 409
    assert traitee(t, "a", geste(t, "a", geste="ajouter", liste="equipement", ligne="Torche").json()["id"])["statut"] == "appliquee"
    assert fiche(atelier, t, "a")["equipement"][0] == "Torche ×2"


def test_annuler_par_le_journal_apres_un_changement_de_quantite(atelier, tablee, sacs_neufs):
    """Le journal garde les listes d'avant et d'après : annuler un « un de plus » rend le compte d'avant ; annuler l'ajout
    d'une ligne dont le compte a changé depuis est refusé (le sac a changé), puis passe une fois le compte revenu."""
    t = tablee
    jid = t["a"]["joueur"]["id"]

    def annuler(d):
        vue = dans_la_boite(atelier, t, "a", d["id"])
        return atelier.post(f"/api/demandes/{jid}/{d['id']}/annuler", json={"version": vue["version"]})

    ajout = traitee(t, "a", geste(t, "a", geste="ajouter", liste="equipement", ligne="Torche").json()["id"])
    plus = traitee(t, "a", geste(t, "a", geste="quantite", liste="equipement", rang=2, avant="Torche", de=1).json()["id"])
    assert fiche(atelier, t, "a")["equipement"] == ["Cape", "Corde", "Torche ×2"]
    r = annuler(ajout)
    assert r.status_code == 409 and "a changé depuis" in r.json()["detail"]
    assert fiche(atelier, t, "a")["equipement"] == ["Cape", "Corde", "Torche ×2"]
    assert annuler(plus).status_code == 200
    assert fiche(atelier, t, "a")["equipement"] == ["Cape", "Corde", "Torche"] and sac(t, "a")["heros"]["equipement"] == ["Cape", "Corde", "Torche"]
    assert annuler(ajout).status_code == 200 and fiche(atelier, t, "a")["equipement"] == ["Cape", "Corde"]
    # Un ajout qui a grossi une ligne : annulé, la ligne retrouve son compte.
    grossi = traitee(t, "a", geste(t, "a", geste="ajouter", liste="equipement", ligne="corde").json()["id"])
    assert fiche(atelier, t, "a")["equipement"] == ["Cape", "Corde ×2"]
    assert annuler(grossi).status_code == 200 and fiche(atelier, t, "a")["equipement"] == ["Cape", "Corde"]
    # Un retrait à zéro : annulé, la ligne revient.
    moins = traitee(t, "a", geste(t, "a", geste="quantite", liste="equipement", rang=1, avant="Corde", de=-1).json()["id"])
    assert fiche(atelier, t, "a")["equipement"] == ["Cape"]
    assert annuler(moins).status_code == 200 and fiche(atelier, t, "a")["equipement"] == ["Cape", "Corde"]


def test_donner_quelques_exemplaires_ou_tout(atelier, tablee, sacs_neufs):
    t = tablee
    sacs_neufs("a", ["Cape", "Potion de soins ×3"])
    sacs_neufs("b", ["Torche", "potion de soins"])
    carnet_api.publier_carnet()
    tavarede = ref_de(t, "a", "Tavarède Lavelle")
    d = traitee(t, "a", geste(t, "a", "don-objet", liste="equipement", rang=1, avant="Potion de soins ×3", ref=tavarede, nombre=1).json()["id"])
    assert d["statut"] == "appliquee" and d["resultat"] == "«\u00a0Potion de soins\u00a0» donné à Tavarède."
    # Le compagnon en avait déjà : sa ligne grossit, sous le nom qu'elle portait.
    assert fiche(atelier, t, "a")["equipement"] == ["Cape", "Potion de soins ×2"] and fiche(atelier, t, "b")["equipement"] == ["Torche", "potion de soins ×2"]
    assert sac(t, "a")["heros"]["equipement"] == ["Cape", "Potion de soins ×2"] and sac(t, "b")["heros"]["equipement"] == ["Torche", "potion de soins ×2"]
    vue = dans_la_boite(atelier, t, "a", d["id"])
    assert vue["phrase"] == "Aube donne « Potion de soins » à Tavarède"
    # Annulé : les deux sacs retrouvent leur compte.
    assert atelier.post(f"/api/demandes/{t['a']['joueur']['id']}/{d['id']}/annuler", json={"version": vue["version"]}).status_code == 200
    assert fiche(atelier, t, "a")["equipement"] == ["Cape", "Potion de soins ×3"] and fiche(atelier, t, "b")["equipement"] == ["Torche", "potion de soins"]
    # Deux d'un coup, puis tout ce qui reste (sans nombre : la ligne entière, comme avant).
    d = traitee(t, "a", geste(t, "a", "don-objet", liste="equipement", rang=1, avant="Potion de soins ×3", ref=tavarede, nombre=2).json()["id"])
    assert d["resultat"] == "«\u00a0Potion de soins ×2\u00a0» donné à Tavarède."
    assert fiche(atelier, t, "a")["equipement"] == ["Cape", "Potion de soins"] and fiche(atelier, t, "b")["equipement"] == ["Torche", "potion de soins ×3"]
    d = traitee(t, "a", geste(t, "a", "don-objet", liste="equipement", rang=1, avant="Potion de soins", ref=tavarede).json()["id"])
    assert d["statut"] == "appliquee"
    assert fiche(atelier, t, "a")["equipement"] == ["Cape"] and fiche(atelier, t, "b")["equipement"] == ["Torche", "potion de soins ×4"]
    # Le nombre entier de la ligne vaut « tout » ; plus qu'il n'y en a : refusé, rien ne part.
    sacs_neufs("a", ["Flèches ×5"])
    sacs_neufs("b", ["Torche"])
    carnet_api.publier_carnet()
    r = geste(t, "a", "don-objet", liste="equipement", rang=0, avant="Flèches ×5", ref=tavarede, nombre=6)
    assert r.status_code == 409 and r.json()["detail"] == inventaire.PLUS_AUTANT
    d = ecrire_demande(t, "a", "don-objet", {"liste": "equipement", "rang": 0, "avant": "Flèches ×5", "ref": tavarede, "nombre": 6})
    fini = traitee(t, "a", d["id"])
    assert fini["statut"] == "echec" and fini["resultat"] == inventaire.PLUS_AUTANT
    assert fiche(atelier, t, "a")["equipement"] == ["Flèches ×5"] and fiche(atelier, t, "b")["equipement"] == ["Torche"]
    d = traitee(t, "a", geste(t, "a", "don-objet", liste="equipement", rang=0, avant="Flèches ×5", ref=tavarede, nombre=5).json()["id"])
    assert d["statut"] == "appliquee" and fiche(atelier, t, "a")["equipement"] == [] and fiche(atelier, t, "b")["equipement"] == ["Torche", "Flèches ×5"]
    # Les bornes du nombre, et les objets personnels qui ne se comptent pas.
    for corps in ({"nombre": 0}, {"nombre": -1}, {"nombre": True}, {"nombre": "1"}, {"nombre": 1000}, {"nombre": 1, "liste": "objets"}):
        r = geste(t, "b", "don-objet", **{"liste": "equipement", "rang": 1, "avant": "Flèches ×5", "ref": ref_de(t, "b", "Ysolde Gris"), **corps})
        assert r.status_code == 400, (corps, r.text)


def test_le_masque_tient_quand_la_quantite_change(atelier, tablee, sacs_neufs):
    """Une ligne réécrite par le serveur ne fait ni fuir un nom secret vers le coin, ni perdre au joueur le texte qu'il a
    écrit lui-même."""
    t = tablee
    # 1. Écrite par le joueur, elle nomme un inconnu et l'auberge : il la lit telle quelle, à tout compte, que le
    # changement vienne de lui ou du MJ.
    ecrite = "Lettre pour Gorvak Sombrefer"
    assert traitee(t, "a", geste(t, "a", geste="ajouter", liste="equipement", ligne=ecrite).json()["id"])["statut"] == "appliquee"
    assert traitee(t, "a", geste(t, "a", geste="quantite", liste="equipement", rang=2, avant=ecrite, de=1).json()["id"])["statut"] == "appliquee"
    assert sac(t, "a")["heros"]["equipement"] == ["Cape", "Corde", ecrite + " ×2"]
    atelier.patch(f"/api/aventuriers/{t['a']['heros']['id']}/sac", json={"equipement": {"avant": ["Cape", "Corde", ecrite + " ×2"],
                                                                                    "apres": ["Cape", "Corde", ecrite + " ×5"]}})
    carnet_api.publier_carnet()
    assert sac(t, "a")["heros"]["equipement"] == ["Cape", "Corde", ecrite + " ×5"]
    assert traitee(t, "a", geste(t, "a", geste="ajouter", liste="equipement", ligne=ecrite.lower()).json()["id"])["statut"] == "appliquee"
    assert sac(t, "a")["heros"]["equipement"] == ["Cape", "Corde", ecrite + " ×6"]
    # 2. Écrites par le MJ : l'une est retenue (elle nomme un inconnu), l'autre passe au masque (le nom de l'auberge).
    sacs_neufs("b", ["Sceau de Gorvak Sombrefer ×2", "Clé de la Petite Fanfrelée"])
    carnet_api.publier_carnet()
    vu = sac(t, "b")["heros"]["equipement"]
    assert len(vu) == 1 and "Fanfrel" not in vu[0]
    # Un de plus sur la ligne masquée : le vrai nom reste dans la fiche, le joueur lit toujours le masque.
    d = traitee(t, "b", geste(t, "b", geste="quantite", liste="equipement", rang=0, avant=vu[0], de=1).json()["id"])
    assert d["statut"] == "appliquee"
    assert fiche(atelier, t, "b")["equipement"] == ["Sceau de Gorvak Sombrefer ×2", "Clé de la Petite Fanfrelée ×2"]
    assert sac(t, "b")["heros"]["equipement"] == [vu[0] + " ×2"]
    # Taper ce qu'il lit grossit la ligne sans qu'elle devienne « écrite par lui » : toujours au masque.
    d = traitee(t, "b", geste(t, "b", geste="ajouter", liste="equipement", ligne=vu[0].upper()).json()["id"])
    assert d["statut"] == "appliquee" and fiche(atelier, t, "b")["equipement"][1] == "Clé de la Petite Fanfrelée ×3"
    assert sac(t, "b")["heros"]["equipement"] == [vu[0] + " ×3"]
    # Une quantité visée à l'aveugle sur la ligne retenue : introuvable, au coin comme dans l'atelier.
    assert geste(t, "b", geste="quantite", liste="equipement", rang=0, avant="Sceau de Gorvak Sombrefer ×2", de=-1).status_code == 409
    d = ecrire_demande(t, "b", "sac", {"geste": "quantite", "liste": "equipement", "rang": 0, "avant": "Sceau de Gorvak Sombrefer ×2", "de": -1})
    fini = traitee(t, "b", d["id"])
    assert fini["statut"] == "echec" and fini["resultat"] == inventaire.PLUS_LA
    # Taper le nom d'une ligne retenue ne la grossit pas et n'en dit rien : une ligne à part, sans compte annoncé.
    d = traitee(t, "b", geste(t, "b", geste="ajouter", liste="equipement", ligne="Sceau de Gorvak Sombrefer").json()["id"])
    assert d["statut"] == "appliquee" and d["resultat"] == "Ajouté à votre équipement : «\u00a0Sceau de Gorvak Sombrefer\u00a0»."
    assert fiche(atelier, t, "b")["equipement"] == ["Sceau de Gorvak Sombrefer ×2", "Clé de la Petite Fanfrelée ×3", "Sceau de Gorvak Sombrefer"]
    # Rien de ce que lit Basile ne nomme l'inconnu ni l'auberge : ni son sac, ni ses demandes.
    for texte in (json.dumps(sac(t, "b"), ensure_ascii=False), json.dumps(t["b"]["coin"].get("/api/carnet").json(), ensure_ascii=False)):
        assert "Fanfrel" not in texte
    assert "Fanfrel" not in json.dumps(sac(t, "b"), ensure_ascii=False)


def test_un_don_recu_ne_demasque_rien(atelier, tablee, sacs_neufs):
    """Aube a écrit elle-même une ligne qui nomme un inconnu ; elle en donne une à Tavarède, qui porte déjà la même ligne,
    retenue pour le MJ : la ligne de Tavarède grossit dans la fiche, et Basile n'en lit toujours rien."""
    t = tablee
    sacs_neufs("b", ["Torche", "Lettre pour Gorvak Sombrefer"])
    carnet_api.publier_carnet()
    assert sac(t, "b")["heros"]["equipement"] == ["Torche"]
    for _ in range(2):
        assert traitee(t, "a", geste(t, "a", geste="ajouter", liste="equipement", ligne="Lettre pour Gorvak Sombrefer").json()["id"])["statut"] == "appliquee"
    assert sac(t, "a")["heros"]["equipement"] == ["Cape", "Corde", "Lettre pour Gorvak Sombrefer ×2"]
    d = traitee(t, "a", geste(t, "a", "don-objet", liste="equipement", rang=2, avant="Lettre pour Gorvak Sombrefer ×2",
                              ref=ref_de(t, "a", "Tavarède Lavelle"), nombre=1).json()["id"])
    assert d["statut"] == "appliquee"
    assert fiche(atelier, t, "b")["equipement"] == ["Torche", "Lettre pour Gorvak Sombrefer ×2"]
    assert sac(t, "a")["heros"]["equipement"] == ["Cape", "Corde", "Lettre pour Gorvak Sombrefer"]
    assert sac(t, "b")["heros"]["equipement"] == ["Torche"] and "Gorvak" not in json.dumps(sac(t, "b"), ensure_ascii=False)


def test_la_vente_de_l_echoppe_grossit_la_ligne():
    """vendre_la_commande range par inventaire.avec : un article déjà dans le sac augmente sa ligne (le parcours entier est
    dans tests/test_carnet_joueurs.py)."""
    assert commandes_api.ligne_du_sac("Torche", 1) == "Torche" and commandes_api.ligne_du_sac("Torche", 2) == "Torche ×2"
    assert commandes_api.ligne_du_sac("Flèches x20", 2) == "Flèches ×40" and commandes_api.ligne_du_sac("Flèches ×500", 2) == "Flèches ×500 ×2"
    assert commandes_api.ligne_du_sac("Planche 2 x 4", 3) == "Planche 2 x 4 ×3"
    sac_ = ["Cape", "torche", ""]
    sac_ = inventaire.avec(sac_, commandes_api.ligne_du_sac("Torche", 2))
    assert sac_ == ["Cape", "torche ×3", ""]
    sac_ = inventaire.avec(sac_, commandes_api.ligne_du_sac("Corde", 1))
    assert sac_ == ["Cape", "torche ×3", "Corde"]
    assert inventaire.avec(sac_, "Planche 2 x 4") == ["Cape", "torche ×3", "Corde", "Planche 2 x 4"]
    with pytest.raises(demandes.Refus):
        inventaire.avec(["Flèches ×999"], "Flèches")
    with pytest.raises(demandes.Refus):
        inventaire.avec(["x"] * inventaire.LIGNES_MAX, "Lanterne")


# ---------------------------------------------------------------- l'outil qui regroupe les sacs d'avant

def outil_fusion():
    import importlib.util
    spec = importlib.util.spec_from_file_location("fusionner_sacs", Path(__file__).resolve().parent.parent / "outils" / "fusionner_sacs.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_l_outil_regroupe_sans_toucher_aux_lignes_ambigues():
    outil = outil_fusion()
    apres, phrases = outil.regrouper(["Potion de soins ×2", "Cape", "potion de  soins", "Corde x2", "Planche 2 x 4", "Planche 2 x 4", "",
                                      "2x Potion de soins", "Corde ×0", "Flèches ×990", "Flèches ×10"])
    assert apres == ["Potion de soins ×5", "Cape", "Corde x2", "Planche 2 x 4", "Planche 2 x 4", "", "Corde ×0", "Flèches ×990", "Flèches ×10"]
    assert phrases[0] == "« Potion de soins ×2 » + « potion de  soins » + « 2x Potion de soins » → « Potion de soins ×5 »"
    assert any(p.startswith("laissé : « Flèches ×990 »") for p in phrases) and any("Planche 2 x 4" in p and "ambiguë" in p for p in phrases)
    # Rien à regrouper : la liste revient telle quelle, sans une phrase (une ligne seule n'est pas réécrite).
    assert outil.regrouper(["Cape", "Corde x2", "Planche 2 x 4"]) == (["Cape", "Corde x2", "Planche 2 x 4"], [])
    assert outil.regrouper([]) == ([], [])


def test_l_outil_passe_par_la_route_du_sac(atelier, tablee, sacs_neufs, monkeypatch, capsys):
    """Essai à blanc par défaut : rien n'est écrit. Avec --appliquer, la route du sac reçoit la liste d'avant ; les objets
    personnels, l'or et les autres fiches ne bougent pas."""
    t = tablee
    outil = outil_fusion()
    sacs_neufs("a", ["Potion de soins ×2", "Cape", "Potion de soins"], ["Un dé", "Un dé", ""])

    def appel(methode, chemin, corps=None):
        r = atelier.request(methode, chemin, json=corps)
        if r.status_code >= 400:
            raise outil.urllib.error.HTTPError(chemin, r.status_code, r.text, None, None)
        return r.json()
    monkeypatch.setattr(outil, "appel", appel)
    ident = t["a"]["heros"]["id"]
    assert outil.principal(["--heros", ident]) == 0
    sortie = capsys.readouterr().out
    assert "« Potion de soins ×2 » + « Potion de soins » → « Potion de soins ×3 »" in sortie and "rien n'est écrit" in sortie
    assert fiche(atelier, t, "a")["equipement"] == ["Potion de soins ×2", "Cape", "Potion de soins"]
    assert outil.principal(["--heros", ident, "--appliquer"]) == 0
    f = fiche(atelier, t, "a")
    assert f["equipement"] == ["Potion de soins ×3", "Cape"] and f["objets"] == ["Un dé", "Un dé", ""] and f["or"] == 30
    assert fiche(atelier, t, "b")["equipement"] == ["Torche"]
    assert outil.principal(["--heros", ident, "--appliquer"]) == 0 and "Rien à regrouper" in capsys.readouterr().out
    assert outil.principal(["--heros", "personne-de-ce-nom"]) == 1
