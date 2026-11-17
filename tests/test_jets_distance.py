"""Les jets à distance (lot F3, jets_distance.py, jets_mj.py, routes /api/jets du coin et de l'atelier) : le dé vient du
serveur et de la fiche de l'atelier (une valeur envoyée par le coin ne compte jamais), le hasard semé, un jet à la fois, le
plafond horaire, le test demandé par le MJ qui n'arrive qu'au bon joueur, « Retirer », un joueur qui ne lance ni ne lit pour
un autre, rien de secret à la TV (ni peuple caché, ni inconnu, ni valeur visée), la fiche de jet publiée sans secret, table
du coin fermée et coin en pause, le jet arrivé trop tard, et les pages de l'atelier prévenues par leur canal."""
import json
import re
import os
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from commun import demandes  # noqa: E402
from commun import flux_coin  # noqa: E402
from commun import jets  # noqa: E402
from commun import jets_distance as jd  # noqa: E402
import joueurs  # noqa: E402
from comptes_coin import entrer  # noqa: E402
import main  # noqa: E402
from api import actions_coin, application, config, tv_etat  # noqa: E402

CF = {"CF-Connecting-IP": "203.0.113.7"}
PEUPLE = "Fils des Brumes"
SECRETS_DE_LA_FICHE = ("SECRET-YSOLDE", "NOTE-YSOLDE", "Gorvak", "Brumes", "peuple")
CLES_TV = {"type", "id", "nom", "couleur", "carac", "competence", "de", "issue", "issue_nom"}


class Hasard:
    """Un hasard qui rend, dans l'ordre, les dés voulus (une face de 1 à n), puis recommence."""

    def __init__(self, *faces):
        self.faces = list(faces)
        self.i = 0

    def randbelow(self, n):
        f = self.faces[self.i % len(self.faces)]
        self.i += 1
        return min(f, n) - 1



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
    """Aube joue Ysolde Gris (peuple gardé secret, carton rouge en Physique, posture focus, une compétence qui nomme son
    peuple, une qui nomme un PNJ inconnu) ; Basile joue Tavarède Lavelle. La table du coin est ouverte."""
    patch = pytest.MonkeyPatch()
    patch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    patch.setattr(joueurs, "COOKIE_SUR", False)
    patch.setattr(joueurs, "HOTES", set())
    patch.setattr(joueurs, "DEMANDES_FAITES", {})
    patch.setattr(joueurs, "JETS_LANCES", {})
    crees = []

    def creer(collection, **fiche):
        f = atelier.post(f"/api/{collection}", json=fiche).json()
        crees.append((collection, f["id"]))
        return f

    t = {"pnj": creer("pnj", nom="Gorvak Sombrefer", connu=False),
         "ysolde": creer("aventuriers", nom="Ysolde Gris", genre="f", joueur="Aube", tablee=True, couleur="#2f6ea5", peuple=PEUPLE,
                         peuple_cache=True, physique=60, social=40, mental=50, sante=9, psy=5, posture="focus",
                         secret="SECRET-YSOLDE", notes_mj="NOTE-YSOLDE",
                         competences=[{"nom": "Athlétisme", "bonus": 15}, {"nom": "Langue des Fils des Brumes", "bonus": 20},
                                      {"nom": "Traque de Gorvak", "bonus": 10}, {"nom": "Lames", "bonus": -10}]),
         "tavarede": creer("aventuriers", nom="Tavarède Lavelle", genre="h", joueur="Basile", tablee=True, couleur="#8e1b17",
                           physique=45, social=65, mental=55, sante=10, psy=4, competences=[{"nom": "Baratin", "bonus": 10}])}
    for code, nom, heros in (("a", "Aube", "ysolde"), ("b", "Basile", "tavarede")):
        j = atelier.post("/api/joueurs", json={"nom": nom}).json()
        assert atelier.post(f"/api/joueurs/{j['id']}/relier", json={"heros": t[heros]["id"]}).status_code == 200
        coin = TestClient(joueurs.app)
        entrer(coin, j)
        t[code] = {"joueur": j, "coin": coin}
    assert atelier.patch(f"/api/etats-heros/{t['ysolde']['id']}", json={"cartons": {"physique": "rouge"}}).status_code == 200
    avant = tv_etat.reglage_table_joueurs()["ouverte"]
    assert atelier.put("/api/table-joueurs", json={"ouverte": True}).status_code == 200
    assert attendre(lambda: t["a"]["coin"].get("/api/jets").json()["heros"]), "la fiche de jet n'est pas publiée"
    yield t
    atelier.put("/api/table-joueurs", json={"ouverte": avant})
    demandes.ecrire_pause(config.PROPOSITIONS, False)
    for code in ("a", "b"):
        t[code]["coin"].close()
        atelier.delete(f"/api/joueurs/{t[code]['joueur']['id']}")
    atelier.patch(f"/api/etats-heros/{t['ysolde']['id']}", json={"cartons": {"physique": None}})
    for collection, ident in reversed(crees):
        atelier.delete(f"/api/{collection}/{ident}")
    actions_coin.jets_mj.fichier.unlink(missing_ok=True)
    actions_coin.jets_mj.hasard = None
    patch.undo()


@pytest.fixture()
def hasard():
    def poser(*faces):
        actions_coin.jets_mj.hasard = Hasard(*faces)
    yield poser
    actions_coin.jets_mj.hasard = None


def jets_de(joueur):
    return [d for d in demandes.lire(config.PROPOSITIONS, joueur["id"]) if d["genre"] in (jd.GENRE, jd.GENRE_DEMANDE)]


def lancer(coin, **corps):
    return coin.post("/api/jets", json=corps)


def resultat(coin, ident):
    """Le résultat de ce jet, tel que le joueur le relit, quand l'atelier l'a lancé."""
    def lu():
        d = coin.get("/api/jets").json()["dernier"]
        return d if d and d["id"] == ident and d["statut"] != "a-appliquer" else None
    r = attendre(lu)
    assert r, "l'atelier n'a pas lancé le jet"
    return r


def attendre_que_ca_roule_plus(joueur):
    assert attendre(lambda: not any(jd.en_route(d, datetime.now()) for d in jets_de(joueur)))


# ---------------------------------------------------------------- le dé du serveur

def test_le_de_et_la_fiche_sont_ceux_du_serveur(atelier, tablee, hasard):
    hasard(32)
    a = tablee["a"]
    r = lancer(a["coin"], carac="physique", competence="Athlétisme", modificateur=-5,
               de=1, visee=999, issue="reussite-critique", reussi=True, base=100, bonus=80, physique=99)
    assert r.status_code == 200, r.text
    ident = r.json()["lance"]
    [d] = [x for x in jets_de(a["joueur"]) if x["id"] == ident]
    # Rien d'autre que les trois choix ne s'écrit dans la demande du joueur.
    assert set(d["corps"]) == {"carac", "competence", "modificateur"}
    p = resultat(a["coin"], ident)["public"]
    # La fiche de l'atelier : Physique 60, Athlétisme +15, -5, et son carton rouge en Physique (-30, choix d'Alban du 09/11) ;
    # le dé du serveur. La posture focus ne compte jamais dans un test du téléphone, et rien ne le dit.
    assert (p["base"], p["bonus"], p["modificateur"], p["visee"], p["de"]) == (60, 15, -5, 40, 32)
    assert (p["issue"], p["reussi"], p["competence"], p["nom"]) == ("reussite", True, "Athlétisme", "Ysolde Gris")
    assert p["ajustements"] == [{"libelle": "Carton rouge en Physique", "valeur": -30}]
    assert "non_comptes" not in p and "focus" not in json.dumps(p, ensure_ascii=False).lower()
    # Le registre du MJ le garde, et la vue de l'atelier le montre.
    vue = atelier.get("/api/jets").json()
    x = next(j for j in vue["jets"] if j["id"] == ident)
    assert (x["joueur_nom"], x["heros_nom"], x["de"], x["visee"], x["issue"]) == ("Aube", "Ysolde Gris", 32, 40, "reussite")
    assert x["ajustements"] == [{"libelle": "Carton rouge en Physique", "valeur": -30}]


def test_critiques_et_competence_qu_il_n_a_pas(atelier, tablee, hasard):
    a = tablee["a"]
    attendre_que_ca_roule_plus(a["joueur"])
    hasard(3)
    # Social 40 - 50 : rien ne passe, sauf un critique (01 à 05). Une compétence qu'il n'a pas n'aide pas.
    ident = lancer(a["coin"], carac="social", competence="Magie des étoiles", modificateur=-50).json()["lance"]
    p = resultat(a["coin"], ident)["public"]
    assert (p["visee"], p["de"], p["issue"], p["competence"], p["bonus"]) == (-10, 3, "reussite-critique", "", 0)
    attendre_que_ca_roule_plus(a["joueur"])
    hasard(97)
    # Mental 50 + 50 : le maximum du modificateur, et 96 à 100 reste un échec critique.
    ident = lancer(a["coin"], carac="mental", modificateur=999).json()["lance"]
    p = resultat(a["coin"], ident)["public"]
    assert (p["modificateur"], p["visee"], p["de"], p["issue"], p["reussi"]) == (jd.MODIFICATEUR_MAX, 100, 97, "echec-critique", False)
    attendre_que_ca_roule_plus(a["joueur"])
    # Une compétence au bonus négatif ne gêne jamais (et la fiche publiée ne la propose pas).
    hasard(50)
    ident = lancer(a["coin"], carac="physique", competence="Lames").json()["lance"]
    assert resultat(a["coin"], ident)["public"]["bonus"] == 0


def test_le_hasard_seme_et_le_hasard_du_serveur(tablee):
    """Le même hasard semé, le même tirage ; sans hasard, le dé reste entre 1 et 100."""
    fiche = jd.fiche_valide({"nom": "Essai", "physique": 60, "competences": [{"nom": "Athlétisme", "bonus": 15}]})
    un = [jets.jet(fiche, "physique", ["Athlétisme"], 0, hasard=h)["de"] for h in [Hasard(7, 77, 99)] for _ in range(3)]
    assert un == [7, 77, 99]
    assert all(1 <= jets.jet(fiche, "physique")["de"] <= 100 for _ in range(500))


def test_un_jet_a_la_fois(tmp_path):
    corps = {"carac": "mental", "competence": "", "modificateur": 0}
    d = jd.lancer(tmp_path, "essai", corps)
    assert d["statut"] == "a-appliquer" and d["genre"] == jd.GENRE
    with pytest.raises(demandes.Refus) as refus:
        jd.lancer(tmp_path, "essai", corps)
    assert refus.value.statut == 409
    # Un jet resté en route (l'atelier arrêté) n'empêche plus de lancer au bout d'une minute ; il reste dans le fichier.
    with demandes.verrou(tmp_path):
        liste = demandes.lire(tmp_path, "essai")
        liste[0]["cree"] = (datetime.now() - timedelta(seconds=jd.EN_ROUTE + 5)).isoformat(timespec="milliseconds")
        demandes.ecrire(tmp_path, "essai", liste)
    jd.lancer(tmp_path, "essai", corps)
    assert len(demandes.lire(tmp_path, "essai")) == 2


def test_seuls_les_derniers_jets_restent(tmp_path):
    """Une partie animée ne remplit pas le fichier du joueur : les trois derniers jets clos, ses autres demandes intactes."""
    with demandes.verrou(tmp_path):
        mot = demandes.nouvelle({"genre": "message", "corps": {"texte": "Bonsoir"}})
        demandes.ecrire(tmp_path, "essai", [mot])
    for _ in range(8):
        d = jd.lancer(tmp_path, "essai", {"carac": "physique"})
        with demandes.verrou(tmp_path):
            liste = demandes.lire(tmp_path, "essai")
            demandes.passer(demandes.trouver(liste, d["id"]), demandes.APPLIQUEE, "atelier")
            demandes.ecrire(tmp_path, "essai", liste)
    liste = demandes.lire(tmp_path, "essai")
    # Les trois derniers clos gardés au moment du dernier jet, plus lui.
    assert [x["genre"] for x in liste].count(jd.GENRE) == jd.GARDES + 1
    assert any(x["genre"] == "message" for x in liste)


def test_le_plafond_horaire(atelier, tablee, hasard, monkeypatch):
    b = tablee["b"]
    monkeypatch.setattr(jd, "PAR_HEURE", 2)
    monkeypatch.setattr(joueurs, "JETS_LANCES", {})
    hasard(40)
    for _ in range(2):
        attendre_que_ca_roule_plus(b["joueur"])
        r = lancer(b["coin"], carac="social", competence="Baratin")
        assert r.status_code == 200, r.text
        resultat(b["coin"], r.json()["lance"])
    r = lancer(b["coin"], carac="social")
    assert r.status_code == 429 and "2 tests par heure" in r.json()["detail"]
    # Un test que le MJ demande passe quand même : il ne compte pas dans le plafond.
    assert atelier.post("/api/jets/demander", json={"joueur": b["joueur"]["id"], "carac": "mental"}).status_code == 200
    demande = b["coin"].get("/api/jets").json()["demande"]
    r = lancer(b["coin"], demande=demande["id"])
    assert r.status_code == 200, r.text
    resultat(b["coin"], r.json()["lance"])


# ---------------------------------------------------------------- le test demandé par le MJ

def test_le_test_demande_arrive_au_bon_joueur(atelier, tablee, hasard):
    a, b = tablee["a"], tablee["b"]
    attendre_que_ca_roule_plus(a["joueur"])
    r = atelier.post("/api/jets/demander", json={"joueur": a["joueur"]["id"], "carac": "mental", "modificateur": -10})
    assert r.status_code == 200, r.text
    vue = r.json()
    [ouverte] = [d for d in vue["demandes"] if d["joueur"] == a["joueur"]["id"]]
    assert (ouverte["carac_nom"], ouverte["modificateur"], ouverte["nom"]) == ("Mental", -10, "Aube")
    assert 590 < ouverte["reste"] <= jd.DUREE_DEMANDE
    # Aube le voit ; Basile, non. Le flux ne réveille que la page d'Aube (son fichier de demandes).
    lu = a["coin"].get("/api/jets").json()["demande"]
    assert lu["id"] == ouverte["id"] and lu["carac"] == "mental" and lu["modificateur"] == -10
    assert b["coin"].get("/api/jets").json()["demande"] is None
    assert flux_coin.sujet_du_fichier((demandes.DOSSIER, f"{a['joueur']['id']}.json")) == (a["joueur"]["id"], "demandes")
    # Basile ne peut pas répondre à la place d'Aube : la demande n'est pas dans son fichier.
    r = lancer(b["coin"], demande=ouverte["id"])
    assert r.status_code == 404
    # Aube lance d'un toucher : la caractéristique et le modificateur sont ceux du MJ, quoi que dise la page.
    hasard(42)
    r = lancer(a["coin"], demande=ouverte["id"], carac="physique", modificateur=50, competence="")
    assert r.status_code == 200, r.text
    p = resultat(a["coin"], r.json()["lance"])["public"]
    assert (p["carac"], p["modificateur"], p["visee"], p["de"], p["issue"]) == ("mental", -10, 40, 42, "echec")
    assert a["coin"].get("/api/jets").json()["demande"] is None
    v = atelier.get("/api/jets").json()
    assert not [d for d in v["demandes"] if d["joueur"] == a["joueur"]["id"]]
    assert next(x for x in v["jets"] if x["id"] == r.json()["lance"])["demande"] is True
    # Une seconde fois, non : il a déjà lancé.
    r = lancer(a["coin"], demande=ouverte["id"])
    assert r.status_code == 409 and "déjà lancé" in r.json()["detail"]


def test_retirer_un_test_demande(atelier, tablee):
    a = tablee["a"]
    attendre_que_ca_roule_plus(a["joueur"])
    jid = a["joueur"]["id"]
    un = [d for d in atelier.post("/api/jets/demander", json={"joueur": jid, "carac": "social"}).json()["demandes"] if d["joueur"] == jid][0]
    # Un second test pour le même joueur remplace le premier.
    deux = [d for d in atelier.post("/api/jets/demander", json={"joueur": jid, "carac": "physique"}).json()["demandes"] if d["joueur"] == jid]
    assert len(deux) == 1 and deux[0]["id"] != un["id"] and deux[0]["carac"] == "physique"
    assert lancer(a["coin"], demande=un["id"]).status_code == 409
    d = deux[0]
    url = f"/api/jets/demandes/{jid}/{d['id']}/retirer"
    assert atelier.post(url, json={"version": d["version"] + 5}).status_code == 409
    r = atelier.post(url, json={"version": d["version"]})
    assert r.status_code == 200 and not [x for x in r.json()["demandes"] if x["joueur"] == jid]
    assert a["coin"].get("/api/jets").json()["demande"] is None
    r = lancer(a["coin"], demande=d["id"])
    assert r.status_code == 409 and "ne demande plus" in r.json()["detail"]
    # Le joueur a lancé avant que le MJ retire : le geste du MJ est refusé.
    d = [x for x in atelier.post("/api/jets/demander", json={"joueur": jid, "carac": "mental"}).json()["demandes"] if x["joueur"] == jid][0]
    resultat(a["coin"], lancer(a["coin"], demande=d["id"]).json()["lance"])
    r = atelier.post(f"/api/jets/demandes/{jid}/{d['id']}/retirer", json={"version": d["version"]})
    assert r.status_code == 409 and "déjà lancé" in r.json()["detail"]


def test_une_caracteristique_illisible_est_refusee(atelier, tablee):
    """Une liste ou un objet à la place du nom de la caractéristique : 400 avec la phrase, jamais une erreur 500 (le coin
    et l'atelier), et rien ne s'écrit dans la file du joueur."""
    a = tablee["a"]
    attendre_que_ca_roule_plus(a["joueur"])
    avant = len(jets_de(a["joueur"]))
    # Sans « with » : ni la boucle de l'atelier ni celle du coin ne démarrent une seconde fois.
    coin = TestClient(joueurs.app, raise_server_exceptions=False)
    coin.cookies = a["coin"].cookies
    for carac in (["mental"], {"mental": 1}, 3, None):
        r = coin.post("/api/jets", json={"carac": carac, "competence": "", "modificateur": 0})
        assert r.status_code == 400 and r.json()["detail"] == "Choisissez Physique, Social ou Mental.", (carac, r.text)
    mj = TestClient(application.app, raise_server_exceptions=False)
    r = mj.post("/api/jets/demander", json={"joueur": a["joueur"]["id"], "carac": ["mental"]})
    assert r.status_code == 400, r.text
    assert len(jets_de(a["joueur"])) == avant
    with pytest.raises(ValueError):
        jets.visee({"mental": 50}, ["mental"])
    # La phrase s'accorde (« Le nom de la compétence est trop long »), pour une compétence trop longue ou illisible.
    for competence, statut, fin in (("x" * (jd.COMPETENCE_MAX + 1), 413, "est trop long : 60 signes au plus."), (["Lames"], 400, "est illisible.")):
        r = coin.post("/api/jets", json={"carac": "mental", "competence": competence})
        assert r.status_code == statut and r.json()["detail"] == f"Le nom de la compétence {fin}", r.text


def test_le_coin_n_ecrit_ni_test_demande_ni_jet_par_la_route_commune(tablee):
    a = tablee["a"]
    r = a["coin"].post("/api/demandes", json={"genre": jd.GENRE_DEMANDE, "corps": {"carac": "mental"}})
    assert r.status_code == 403 and r.json()["detail"] == jd.SEUL_LE_MJ
    r = a["coin"].post("/api/demandes", json={"genre": jd.GENRE, "corps": {"carac": "mental"}})
    assert r.status_code == 409 and "Lancer un test" in r.json()["detail"]
    # Ni dans « Mes demandes », ni dans la boîte du MJ, ni sur Telegram.
    assert not [d for d in a["coin"].get("/api/demandes").json()["demandes"] if d["genre"] in (jd.GENRE, jd.GENRE_DEMANDE)]
    for g in (jd.GENRE, jd.GENRE_DEMANDE):
        assert demandes.GENRES[g].silencieux and not demandes.GENRES[g].liste and not demandes.GENRES[g].attente


def test_un_joueur_ne_lit_pas_les_jets_d_un_autre(atelier, tablee, hasard):
    a, b = tablee["a"], tablee["b"]
    attendre_que_ca_roule_plus(a["joueur"])
    hasard(17)
    ident = lancer(a["coin"], carac="physique", competence="Athlétisme").json()["lance"]
    resultat(a["coin"], ident)
    lu = b["coin"].get("/api/jets").json()
    texte = json.dumps(lu, ensure_ascii=False)
    assert ident not in texte and "Ysolde" not in texte and "Athlétisme" not in texte
    assert lu["heros"]["nom"] == "Tavarède Lavelle"
    # Les routes du MJ ne répondent pas au coin, ni l'atelier à Internet.
    assert b["coin"].post("/api/jets/demander", json={"joueur": a["joueur"]["id"], "carac": "mental"}).status_code in (404, 405)
    assert atelier.get("/api/jets", headers=CF).status_code == 404
    assert atelier.post("/api/jets/demander", json={"joueur": a["joueur"]["id"], "carac": "mental"}, headers=CF).status_code == 404


# ---------------------------------------------------------------- les fuites

def test_la_fiche_de_jet_publiee_ne_dit_rien_de_secret(atelier, tablee):
    a, b = tablee["a"], tablee["b"]
    fiche = a["coin"].get("/api/jets").json()["heros"]
    assert fiche["nom"] == "Ysolde Gris"
    assert [(c["cle"], c["valeur"], c["carton"]) for c in fiche["caracs"]] == [("physique", 60, "rouge"), ("social", 40, None), ("mental", 50, None)]
    # Le carton rouge retire 30 aux chances que dit la page, comme au dé de l'atelier ; rien pour le focus.
    assert [(c["ajustement"], c["ajustements"]) for c in fiche["caracs"]] == [
        (-30, [{"libelle": "Carton rouge en Physique", "valeur": -30}]), (0, []), (0, [])]
    assert "non_comptes" not in json.dumps(fiche)
    # Ses compétences qui aident : son propre peuple n'est pas un secret pour elle ; le PNJ inconnu, si ; « Lames » ne compte pas.
    assert [c["nom"] for c in fiche["competences"]] == ["Athlétisme", "Langue des Fils des Brumes"]
    publie = "".join(f.read_text(encoding="utf-8") for f in (config.PROPOSITIONS / jd.DOSSIER).glob("*.json"))
    for mot in ("SECRET-YSOLDE", "NOTE-YSOLDE", "Gorvak", "peuple_cache", "notes_mj", "secret"):
        assert mot not in publie, mot
    # Basile ne lit que la sienne.
    assert "Brumes" not in json.dumps(b["coin"].get("/api/jets").json(), ensure_ascii=False)
    # Le coin ne choisit jamais un fichier d'après la requête : une clé fabriquée ne lit rien.
    assert jd.fiche_publiee(config.PROPOSITIONS, "../" + "a" * 30) is None
    assert flux_coin.sujet_du_fichier((jd.DOSSIER, "a" * 32 + ".json")) == (None, "jets")


def test_rien_de_secret_a_la_tv(atelier, tablee, hasard):
    a = tablee["a"]
    attendre_que_ca_roule_plus(a["joueur"])
    atelier.put("/api/table", json={"vue": "accueil"})
    publique = tv_etat.table_publique()["ouverte"]
    atelier.put("/api/table-publique", json={"ouverte": True})
    with atelier.websocket_connect("/ws/table") as salon, atelier.websocket_connect("/ws/table", headers=CF) as dehors:
        for ecran in (salon, dehors):
            assert ecran.receive_json()["type"] == "etat"
        recus = []
        for competence, de in (("Langue des Fils des Brumes", 4), ("Traque de Gorvak", 98), ("Athlétisme", 30)):
            hasard(de)
            attendre_que_ca_roule_plus(a["joueur"])
            ident = lancer(a["coin"], carac="physique", competence=competence, modificateur=-10).json()["lance"]
            p = resultat(a["coin"], ident)["public"]
            for ecran in (salon, dehors):
                m = ecran.receive_json()
                while m["type"] != "jet":
                    m = ecran.receive_json()
                recus.append(m)
                assert set(m) == CLES_TV, set(m)
                assert (m["nom"], m["couleur"], m["carac"], m["de"]) == ("Ysolde", "#2f6ea5", "Physique", de)
            recus.append(p)
        texte = json.dumps(recus[:2] + recus[3:5] + recus[6:8], ensure_ascii=False)
        # Ni le peuple caché, ni l'inconnu, ni la valeur visée, ni le modificateur, ni le joueur, ni la fiche.
        for mot in ("Brumes", "Fils des", "Gorvak", "visee", "modificateur", "Aube", ident, a["joueur"]["id"], tablee["ysolde"]["id"]):
            assert mot not in texte, mot
        tv = [m for m in recus if m.get("type") == "jet"]
        assert [m["competence"] for m in tv] == ["", "", "", "", "Athlétisme", "Athlétisme"]
        assert [m["issue"] for m in tv[::2]] == ["reussite-critique", "echec-critique", "reussite"]
        # Ce que lit Aube : son peuple n'est pas un secret pour elle ; l'inconnu, si.
        assert [x["competence"] for x in recus if "base" in x] == ["Langue des Fils des Brumes", "une compétence", "Athlétisme"]
        # Table publique fermée : Internet ne reçoit plus le bandeau, le salon si.
        atelier.put("/api/table-publique", json={"ouverte": False})
        dehors.receive_json()
        hasard(55)
        attendre_que_ca_roule_plus(a["joueur"])
        resultat(a["coin"], lancer(a["coin"], carac="social").json()["lance"])
        m = salon.receive_json()
        while m["type"] != "jet":
            m = salon.receive_json()
        assert m["de"] == 55
        time.sleep(0.4)
        atelier.put("/api/table", json={"vue": "heros"})
        assert dehors.receive_json()["type"] == "etat"
    atelier.put("/api/table-publique", json={"ouverte": publique})
    atelier.put("/api/table", json={"vue": "accueil"})


def test_les_pages_de_l_atelier_l_apprennent_par_leur_canal(atelier, tablee, hasard):
    a = tablee["a"]
    attendre_que_ca_roule_plus(a["joueur"])
    with atelier.websocket_connect("/ws/atelier") as ws:
        assert ws.receive_json()["type"] == "etat"
        hasard(21)
        debut = time.monotonic()
        ident = lancer(a["coin"], carac="mental").json()["lance"]
        m = ws.receive_json()
        while m["type"] != "jets" or not m["jets"] or m["jets"][0]["id"] != ident:
            m = ws.receive_json()
        assert time.monotonic() - debut < 1.5
        assert m["jets"][0]["de"] == 21 and m["jets"][0]["heros_nom"] == "Ysolde Gris"


# ---------------------------------------------------------------- table fermée, pause, trop tard

def test_table_fermee_et_pause(atelier, tablee):
    a = tablee["a"]
    jid = a["joueur"]["id"]
    attendre_que_ca_roule_plus(a["joueur"])
    demandes.ecrire_pause(config.PROPOSITIONS, True)
    try:
        r = lancer(a["coin"], carac="mental")
        assert r.status_code == 423 and r.json()["pause"] is True
        assert a["coin"].get("/api/jets").json()["pause"] is True
        r = atelier.post("/api/jets/demander", json={"joueur": jid, "carac": "mental"})
        assert r.status_code == 423 and "pause" in r.json()["detail"]
    finally:
        demandes.ecrire_pause(config.PROPOSITIONS, False)
    assert atelier.put("/api/table-joueurs", json={"ouverte": False}).status_code == 200
    try:
        lu = a["coin"].get("/api/jets").json()
        assert lu["ouvert"] is False and lu["heros"] is None
        r = lancer(a["coin"], carac="mental")
        assert r.status_code == 409 and r.json()["detail"] == jd.FERMEE
        assert atelier.post("/api/jets/demander", json={"joueur": jid, "carac": "mental"}).status_code == 409
        # La fiche de jet s'en va avec la table.
        assert attendre(lambda: not (config.PROPOSITIONS / jd.DOSSIER).exists())
        assert atelier.get("/api/jets").json()["ouvert"] is False
    finally:
        atelier.put("/api/table-joueurs", json={"ouverte": True})
    assert attendre(lambda: a["coin"].get("/api/jets").json()["heros"])


def test_un_jet_arrive_trop_tard_echoue(atelier, tablee):
    """L'atelier arrêté, puis relancé : un jet vieux de plus d'une minute ne part pas à la TV, le joueur relance."""
    a = tablee["a"]
    attendre_que_ca_roule_plus(a["joueur"])
    with demandes.verrou(config.PROPOSITIONS):
        liste = demandes.lire(config.PROPOSITIONS, a["joueur"]["id"])
        d = demandes.nouvelle({"genre": jd.GENRE, "corps": {"carac": "mental"}})
        d["cree"] = (datetime.now() - timedelta(seconds=jd.EN_ROUTE + 10)).isoformat(timespec="milliseconds")
        demandes.ecrire(config.PROPOSITIONS, a["joueur"]["id"], [*liste, d])
    r = resultat(a["coin"], d["id"])
    assert r["statut"] == "echec" and r["phrase"] == jd.TROP_TARD and "public" not in r


def test_les_modules_du_coin_sont_servis(tablee):
    coin = tablee["a"]["coin"]
    assert "js/joueurs/jets-coin.js" in joueurs.FICHIERS and "css/jets-coin.css" in joueurs.FICHIERS
    assert coin.get("/static/js/joueurs/jets-coin.js").status_code == 200
    # Les pages du MJ ne sont pas servies au coin ; le bandeau de la TV, lui, l'est depuis le lot du 12/11 (les jets des autres).
    for chemin in ("/static/js/jets/jets.js", "/static/js/jets/jets-tableau.js", "/static/css/jets.css", "/static/js/jets/des-mj.js"):
        assert coin.get(chemin).status_code == 404, chemin
    assert coin.get("/static/js/ecran-tv/jet-tv.js").status_code == 200
    statique = Path(joueurs.__file__).resolve().parent / "static"
    for page in ("js/joueurs/carnet.js", "js/joueurs/table-coin.js"):
        assert "\nmonterJets();" in (statique / page).read_text(encoding="utf-8"), page


# ---------------------------------------------------------------- les cartons (choix d'Alban du 09/11)

def test_ajustements_les_cartons_comptent_le_focus_jamais():
    """Le seul endroit des ajustements : jaune -10, rouge -30 sur la caractéristique cartonnée, comme en jeu
    (js/combats/suivi.js) ; la posture focus n'y entre jamais, ni en nombre ni en phrase."""
    fiche = {"physique": 60, "social": 40, "mental": 50, "cartons": {"physique": "jaune", "mental": "rouge"}, "posture": "focus"}
    assert jd.ajustements(fiche, "physique") == [("Carton jaune en Physique", -10)]
    assert jd.ajustements(fiche, "mental") == [("Carton rouge en Mental", -30)]
    assert jd.ajustements(fiche, "social") == []
    # Un carton d'une autre couleur, un état illisible ou une caractéristique qui n'est pas un texte : rien.
    assert jd.ajustements({"cartons": {"physique": "vert"}}, "physique") == []
    assert jd.ajustements({"cartons": ["physique"]}, "physique") == []
    assert jd.ajustements({"cartons": {"physique": "rouge"}}, ["physique"]) == []
    assert jd.chances(fiche, "physique", "", 0) == {"visee": 50, "chances": 50, "competence": "", "bonus": 0,
                                                    "ajustements": [{"libelle": "Carton jaune en Physique", "valeur": -10}]}
    # Les critiques restent : un carton rouge sur une petite valeur garde 5 % de chances.
    assert jd.chances({"mental": 20, "cartons": {"mental": "rouge"}}, "mental")["chances"] == 5


# ---------------------------------------------------------------- la posture offensive (choix d'Alban, lot du 12/11)

def test_la_posture_offensive_elargit_les_critiques_des_jets(atelier, tablee, hasard):
    """Tavarède passe en posture offensive : 08 devient une réussite critique, 93 un échec critique ; la page l'annonce
    (posture, seuils, chances bornées à 10 et 90) et le MJ le lit dans le Tableau. Ysolde, en focus, garde 01-05 et 96-100."""
    a, b = tablee["a"], tablee["b"]
    tavarede = tablee["tavarede"]["id"]
    fiche = atelier.get(f"/api/aventuriers/{tavarede}").json()
    assert atelier.put(f"/api/aventuriers/{tavarede}", json={**fiche, "posture": "offensive"}).status_code == 200
    try:
        lu = attendre(lambda: (lambda h: h if h and h["posture"] == "offensive" else None)(b["coin"].get("/api/jets").json()["heros"]))
        assert lu, "la posture offensive n'est pas publiée"
        assert lu["critiques"] == {"reussite": 10, "echec": 91, "offensive": True}
        for de, issue, reussi in ((8, "reussite-critique", True), (93, "echec-critique", False), (11, "reussite", True), (90, "echec", False)):
            attendre_que_ca_roule_plus(b["joueur"])
            hasard(de)
            # Physique 45 - 50 : rien ne passe sans critique pour 08 ; Social 65 pour 11 ; Physique 45 pour 90 et 93.
            corps = {"carac": "social"} if de == 11 else {"carac": "physique", "modificateur": -50 if de == 8 else 0}
            ident = lancer(b["coin"], **corps).json()["lance"]
            p = resultat(b["coin"], ident)["public"]
            assert (p["de"], p["issue"], p["reussi"]) == (de, issue, reussi), p
            assert p["critiques"] == {"reussite": 10, "echec": 91, "offensive": True}
            x = next(j for j in atelier.get("/api/jets").json()["jets"] if j["id"] == ident)
            assert x["issue"] == issue and x["critiques"]["offensive"] is True
        # Ysolde est en focus : ses seuils ne bougent pas, et rien ne dit « critiques » dans son résultat.
        vue = a["coin"].get("/api/jets").json()["heros"]
        assert vue["posture"] == "focus" and vue["critiques"] == {"reussite": 5, "echec": 96, "offensive": False}
        attendre_que_ca_roule_plus(a["joueur"])
        hasard(8)
        ident = lancer(a["coin"], carac="social", modificateur=-50).json()["lance"]
        p = resultat(a["coin"], ident)["public"]
        assert (p["de"], p["issue"]) == (8, "echec") and "critiques" not in p
    finally:
        fiche = atelier.get(f"/api/aventuriers/{tavarede}").json()
        atelier.put(f"/api/aventuriers/{tavarede}", json={**fiche, "posture": ""})
        attendre_que_ca_roule_plus(a["joueur"])
        attendre_que_ca_roule_plus(b["joueur"])


def test_les_chances_dites_au_coin_suivent_la_posture():
    assert jd.critiques("offensive") == {"reussite": 10, "echec": 91, "offensive": True}
    assert jd.critiques("focus") == jd.critiques("") == jd.critiques(None) == {"reussite": 5, "echec": 96, "offensive": False}
    assert jd.chances({"mental": 3, "posture": "offensive"}, "mental")["chances"] == 10
    assert jd.chances({"mental": 99, "posture": "offensive"}, "mental")["chances"] == 90
    assert jd.chances({"mental": 99, "posture": "focus"}, "mental")["chances"] == 95
    statique = Path(joueurs.__file__).resolve().parent / "static"
    page = (statique / "js/joueurs/jets-coin.js").read_text(encoding="utf-8")
    assert "Posture offensive" in page and "critiques()" in page
    assert "91 à 100" in (statique / "joueurs/guide.html").read_text(encoding="utf-8")


# ---------------------------------------------------------------- les dés du MJ (lot du 12/11)

def test_les_des_du_mj_reviennent_au_mj_et_ne_partent_que_montres(atelier, tablee, hasard):
    """POST /api/jets/mj : des dés libres ou un D100 contre une valeur. Le résultat revient toujours au MJ ; rien ne part
    à la table sans « tv » ; rien n'entre au registre des jets des joueurs."""
    avant = atelier.get("/api/jets").json()
    registre = actions_coin.jets_mj.fichier.read_bytes() if actions_coin.jets_mj.fichier.exists() else None
    atelier.put("/api/table", json={"vue": "accueil"})
    with atelier.websocket_connect("/ws/table") as salon:
        assert salon.receive_json()["type"] == "etat"
        hasard(4, 6)
        r = atelier.post("/api/jets/mj", json={"des": "2d6 + 1"})
        assert r.status_code == 200, r.text
        assert r.json() | {"quand": ""} == {"genre": "des", "texte": "2D6+1", "nombre": 2, "faces": 6, "bonus": 1, "des": [4, 6], "total": 11,
                                            "nom": "Le MJ", "libelle": "", "quand": "", "tv": False, "nom_montre": ""}
        hasard(34)
        r = atelier.post("/api/jets/mj", json={"test": {"valeur": 55, "libelle": "Attaque", "nom": "Gobelin 2"}, "tv": False}).json()
        assert (r["genre"], r["de"], r["visee"], r["issue"], r["reussi"], r["nom"], r["libelle"], r["tv"]) == ("jet", 34, 55, "reussite", True, "Gobelin 2", "Attaque", False)
        # Montré : les formes des jets des joueurs, sans la valeur visée.
        hasard(97)
        r = atelier.post("/api/jets/mj", json={"test": {"valeur": 55, "libelle": "Attaque", "nom": "Gobelin 2"}, "tv": True}).json()
        assert r["tv"] is True and r["nom_montre"] == "Gobelin 2" and r["issue"] == "echec-critique"
        m = salon.receive_json()
        assert set(m) == CLES_TV and m | {"id": ""} == {"type": "jet", "id": "", "nom": "Gobelin 2", "couleur": "", "carac": "", "competence": "Attaque",
                                                       "de": 97, "issue": "echec-critique", "issue_nom": "Échec critique"}
        # La valeur visée (55) ne part jamais ; l'identifiant tiré au hasard peut, lui, contenir « 55 ».
        assert not re.search(r"(?<![\w.-])55(?![\w.-])", json.dumps({k: v for k, v in m.items() if k != "id"})) and "visee" not in m
        hasard(3, 2, 1)
        r = atelier.post("/api/jets/mj", json={"des": "3D4-2", "tv": True}).json()
        m = salon.receive_json()
        assert m | {"id": ""} == {"type": "des", "id": "", "nom": "Le MJ", "couleur": "", "texte": "3D4-2", "nombre": 3, "faces": 4, "bonus": -2,
                                  "des": [3, 2, 1], "total": 4, "arme": ""}
    # Ni le registre ni la vue des jets des joueurs n'ont bougé.
    assert (actions_coin.jets_mj.fichier.read_bytes() if actions_coin.jets_mj.fichier.exists() else None) == registre
    assert atelier.get("/api/jets").json()["jets"] == avant["jets"]


def test_les_des_du_mj_ne_nomment_aucun_secret(atelier, tablee, hasard):
    """Un adversaire qui porte le nom d'un PNJ inconnu des joueurs, un libellé qui nomme un peuple caché : « Le MJ » à la
    place du nom, rien à la place du libellé. Le MJ, lui, relit ce qu'il a écrit."""
    atelier.put("/api/table", json={"vue": "accueil"})
    with atelier.websocket_connect("/ws/table") as salon:
        assert salon.receive_json()["type"] == "etat"
        hasard(50)
        r = atelier.post("/api/jets/mj", json={"test": {"valeur": 60, "libelle": "Rage des Fils des Brumes", "nom": "Gorvak Sombrefer"}, "tv": True}).json()
        assert (r["nom"], r["libelle"], r["nom_montre"]) == ("Gorvak Sombrefer", "Rage des Fils des Brumes", "Le MJ")
        m = salon.receive_json()
        assert (m["nom"], m["competence"], m["carac"]) == ("Le MJ", "", "")
        hasard(5)
        atelier.post("/api/jets/mj", json={"des": "1D8", "libelle": "Hache de Gorvak", "nom": "Gorvak", "tv": True})
        m2 = salon.receive_json()
        assert (m2["nom"], m2["arme"]) == ("Le MJ", "")
        texte = json.dumps([m, m2], ensure_ascii=False)
        for mot in ("Gorvak", "Brumes", "visee"):
            assert mot not in texte, mot
        # La valeur visée, comme nombre seul : « 60 » dans un identifiant ou une date tirés au hasard n'est pas une fuite.
        assert not re.search(r"(?<![\w.-])60(?![\w.-])", texte), "la valeur visée"


def test_les_des_du_mj_refusent_ce_qui_ne_se_lance_pas(atelier, tablee):
    for corps in ({}, {"des": "6D6"}, {"des": "1D7"}, {"des": "2D6", "test": {"valeur": 50}}, {"test": {"valeur": "55"}}, {"test": {"valeur": 1000}},
                  {"test": {"valeur": -1}}, {"test": {"valeur": True}}, {"test": []}, {"des": "1D6", "tv": "oui"}, {"des": "1D6", "nom": 3},
                  {"test": {"valeur": 50, "libelle": ["x"]}}):
        assert atelier.post("/api/jets/mj", json=corps).status_code == 400, corps
    # Fermée à Internet et au coin, comme les autres gestes du MJ.
    assert atelier.post("/api/jets/mj", json={"des": "1D6"}, headers=CF).status_code == 404
    assert tablee["a"]["coin"].post("/api/jets/mj", json={"des": "1D6"}).status_code in (404, 405)
    statique = Path(joueurs.__file__).resolve().parent / "static"
    assert "LanceurMJ" in (statique / "js/tableau/tableau.js").read_text(encoding="utf-8")
    assert "js/jets/des-mj.js" not in joueurs.FICHIERS


# ---------------------------------------------------------------- les jets des autres sur la table du coin (lot du 12/11)

def jets_de_la_table(coin):
    r = coin.get("/api/table/jets")
    assert r.status_code == 200, r.text
    return r.json()["jets"]


def test_chaque_joueur_voit_le_jet_des_autres(atelier, tablee, hasard):
    """Le bandeau qui part à la TV part aussi vers la table du coin (propositions/table/jets.json) : Basile lit le jet
    d'Aube, tel que la TV le reçoit, et le flux le dit par un sujet à part."""
    a, b = tablee["a"], tablee["b"]
    assert attendre(lambda: (config.PROPOSITIONS / "table" / "vue.json").exists())
    attendre_que_ca_roule_plus(a["joueur"])
    avant = {x["id"] for x in jets_de_la_table(b["coin"])}
    hasard(42)
    ident = lancer(a["coin"], carac="physique", competence="Traque de Gorvak", modificateur=-10).json()["lance"]
    resultat(a["coin"], ident)
    nouveaux = attendre(lambda: [x for x in jets_de_la_table(b["coin"]) if x["id"] not in avant])
    assert nouveaux and len(nouveaux) == 1
    m = nouveaux[0]
    assert set(m) == CLES_TV | {"age", "frais"} and m["frais"] is True and 0 <= m["age"] < 10
    assert (m["type"], m["nom"], m["couleur"], m["carac"], m["competence"], m["de"]) == ("jet", "Ysolde", "#2f6ea5", "Physique", "", 42)
    # Les dés du MJ montrés à la table y arrivent aussi ; pas ceux qu'il garde pour lui.
    hasard(6, 2)
    atelier.post("/api/jets/mj", json={"des": "1D8", "tv": False})
    assert atelier.post("/api/jets/mj", json={"des": "1D8", "libelle": "Hache de Gorvak", "nom": "Gorvak Sombrefer", "tv": True}).json()["tv"] is True
    liste = attendre(lambda: (lambda l: l if l[-1]["type"] == "des" else None)(jets_de_la_table(b["coin"])))
    assert liste and (liste[-1]["nom"], liste[-1]["des"], liste[-1]["arme"]) == ("Le MJ", [2], "")
    assert len([x for x in liste if x["id"] not in avant]) == 2
    # Rien de secret dans le fichier publié ni dans ce que lit le coin : ni l'inconnu, ni le peuple, ni la valeur visée, ni le joueur.
    publie = (config.PROPOSITIONS / "table" / "jets.json").read_text(encoding="utf-8") + json.dumps(liste, ensure_ascii=False)
    for mot in ("Gorvak", "Brumes", "visee", "modificateur", "Aube", ident, a["joueur"]["id"], tablee["ysolde"]["id"]):
        assert mot not in publie, mot
    # Le fichier ne vit pas dans propositions/jets/ (que la publication des fiches de jet efface) et y survit.
    actions_coin.jets_mj.publier()
    assert (config.PROPOSITIONS / "table" / "jets.json").exists() and not (config.PROPOSITIONS / jd.DOSSIER / "jets.json").exists()
    # Sans session : rien.
    assert TestClient(joueurs.app).get("/api/table/jets").status_code in (401, 403)


def test_les_jets_de_la_table_un_sujet_leger_et_des_jets_frais():
    from commun import table_joueurs as tj
    assert flux_coin.sujet_du_fichier(("table", "jets.json")) == (None, "jets-table")
    assert flux_coin.sujet_du_fichier(("table", "vue.json")) == (None, "table")
    assert "jets-table" in flux_coin.SUJETS
    depot = Path(tempfile.mkdtemp(prefix="jets-table-"))
    # Table fermée : rien ne s'écrit, rien ne se lit.
    assert tj.ajouter_jet(depot, {"type": "jet", "id": "a1"}) is False and tj.jets_publies(depot) == []
    tj.publier(depot, {"genre": "accueil", "titre": "accueil"}, {}, {})
    assert tj.ajouter_jet(depot, {"type": "pointeur", "id": "x"}) is False
    for i in range(tj.JETS_GARDES + 3):
        assert tj.ajouter_jet(depot, {"type": "des", "id": f"j{i}", "total": i}) is True
    lus = tj.jets_publies(depot)
    assert [x["id"] for x in lus] == [f"j{i}" for i in range(3, tj.JETS_GARDES + 3)] and all(x["frais"] and "quand" not in x for x in lus)
    # Un vieux jet n'est plus frais : une page revenue de veille ne le rejoue pas.
    plus_tard = datetime.now() + timedelta(seconds=tj.JET_FRAIS + 5)
    assert not any(x["frais"] for x in tj.jets_publies(depot, plus_tard))
    # La publication de la vue garde les jets ; la table fermée les emporte.
    tj.publier(depot, {"genre": "accueil", "titre": "accueil"}, {}, {})
    assert len(tj.jets_publies(depot)) == tj.JETS_GARDES
    tj.fermer(depot)
    assert tj.jets_publies(depot) == [] and not (depot / "table").exists()


def test_la_page_table_joue_les_des_le_bandeau_et_les_sons(tablee):
    coin = tablee["a"]["coin"]
    statique = Path(joueurs.__file__).resolve().parent / "static"
    for chemin in ("js/joueurs/jets-table-coin.js", "js/ecran-tv/des-3d.js", "js/ecran-tv/sons-jets.js", "js/ecran-tv/volume-sons.js", "css/jet-tv.css",
                   "sons/jet-reussite.mp3", "sons/jet-echec-critique.mp3"):
        assert chemin in joueurs.FICHIERS, chemin
        # Les jingles viennent du pack de campagne (docs/campagne.md) : sans lui, la table reste muette.
        if chemin.startswith("sons/") and not (statique / chemin).is_file():
            continue
        assert coin.get(f"/static/{chemin}").status_code == 200, chemin
    # Un son, déjà compressé, ne repasse pas par gzip ; un script, si.
    if (statique / "sons/jet-reussite.mp3").is_file():
        assert coin.get("/static/sons/jet-reussite.mp3", headers={"Accept-Encoding": "gzip"}).headers.get("content-encoding") is None
    assert coin.get("/static/js/ecran-tv/des-3d.js", headers={"Accept-Encoding": "gzip"}).headers.get("content-encoding") == "gzip"
    page = (statique / "js/joueurs/table-coin.js").read_text(encoding="utf-8")
    assert "monterJetsDeLaTable();" in page
    module = (statique / "js/joueurs/jets-table-coin.js").read_text(encoding="utf-8")
    assert 'ecouterFlux("jets-table"' in module and "msg.rappel" in module and "premiere" in module
    des = (statique / "js/ecran-tv/des-3d.js").read_text(encoding="utf-8")
    # Faits maison : ni bibliothèque, ni adresse extérieure ; les mouvements réduits sont respectés.
    assert "http" not in des and "\nimport " not in des and "prefers-reduced-motion" in des
    sons = (statique / "js/ecran-tv/sons-jets.js").read_text(encoding="utf-8")
    volume = (statique / "js/ecran-tv/volume-sons.js").read_text(encoding="utf-8")
    assert "function regler(" in sons and "localStorage" in volume and volume.count("catch") >= 2 and "activer le son" in volume
    ecran = (statique / "js/table.js").read_text(encoding="utf-8")
    assert "des3d.lancer(msg)" in ecran and "monterVolume(sonsJets)" in ecran
