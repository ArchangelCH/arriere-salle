"""Les dés du lot G dans l'atelier et le coin : les dés libres et les dégâts des armes (l'expression vient du coin, les dés
roulent dans l'atelier, une arme n'est que celle de la fiche de l'atelier), le plafond partagé avec les tests, la réserve
des dés d'aventure (éteinte par défaut, le dé qui passe au MJ, l'annulation, la réserve vide, le dé de mésaventure annoncé
puis consommé une fois, la face choisie par un avantage ou par le MJ sur un désavantage), le total qui tient sous
concurrence, et les fuites : rien des notes d'arme, d'un inconnu, ni d'identifiant vers la TV ou le coin."""
import json
import os
import sys
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from mj import acces_mj  # noqa: E402
from commun import demandes  # noqa: E402
from commun import jets_distance as jd  # noqa: E402
import joueurs  # noqa: E402
from contenu import reserve as rsv  # noqa: E402
from comptes_coin import entrer  # noqa: E402
import main  # noqa: E402
from api import actions_coin, application, config, heros_etat, tv_ecran, tv_etat  # noqa: E402

CF = {"CF-Connecting-IP": "203.0.113.7"}
PEUPLE = "Fils des Brumes"
CLES_TV_DES = {"type", "id", "nom", "couleur", "texte", "nombre", "faces", "bonus", "des", "total", "arme"}
CLES_TV_JET = {"type", "id", "nom", "couleur", "carac", "competence", "de", "issue", "issue_nom"}


class Hasard:
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


def reserve_neuve(**k):
    with demandes.verrou(config.PROPOSITIONS):
        actions_coin.jets_mj.reserve.ecrire(rsv.normaliser({"actif": False, "groupe": 4, "mj": 0, **k}))


@pytest.fixture(scope="module")
def tablee(atelier):
    """Aube joue Ysolde Gris (peuple gardé secret ; une épée, deux fois sur la fiche, avec une note ; une lame qui nomme un PNJ
    inconnu ; une fronde aux dégâts illisibles) ; Basile joue Tavarède Lavelle (un arc long). Table du coin ouverte."""
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
                         peuple_cache=True, physique=60, social=40, mental=50, sante=9, psy=5, secret="SECRET-YSOLDE",
                         competences=[{"nom": "Athlétisme", "bonus": 15}],
                         armes=[{"nom": "Épée", "competence": "Lames", "degats": "1D10", "notes": "NOTE-ARME-YSOLDE"},
                                {"nom": "Lame de Gorvak", "competence": "Lames", "degats": "2D6+1", "notes": "volée"},
                                {"nom": "Fronde", "competence": "Armes de tir", "degats": "1D3", "notes": ""},
                                {"nom": "Épée", "competence": "Lames", "degats": "1D10", "notes": "la même"}]),
         "tavarede": creer("aventuriers", nom="Tavarède Lavelle", genre="h", joueur="Basile", tablee=True, couleur="#8e1b17",
                           physique=45, social=65, mental=55, sante=10, psy=4, competences=[{"nom": "Baratin", "bonus": 10}],
                           armes=[{"nom": "Arc long", "competence": "Armes de tir", "degats": "1D8", "notes": ""}])}
    for code, nom, heros in (("a", "Aube", "ysolde"), ("b", "Basile", "tavarede")):
        j = atelier.post("/api/joueurs", json={"nom": nom}).json()
        assert atelier.post(f"/api/joueurs/{j['id']}/relier", json={"heros": t[heros]["id"]}).status_code == 200
        coin = TestClient(joueurs.app)
        entrer(coin, j)
        t[code] = {"joueur": j, "coin": coin}
    reserve_neuve()
    avant = tv_etat.reglage_table_joueurs()["ouverte"]
    assert atelier.put("/api/table-joueurs", json={"ouverte": True}).status_code == 200
    assert attendre(lambda: t["a"]["coin"].get("/api/jets").json()["heros"]), "la fiche de jet n'est pas publiée"
    yield t
    atelier.put("/api/table-joueurs", json={"ouverte": avant})
    demandes.ecrire_pause(config.PROPOSITIONS, False)
    for code in ("a", "b"):
        t[code]["coin"].close()
        atelier.delete(f"/api/joueurs/{t[code]['joueur']['id']}")
    for h in ("ysolde", "tavarede"):
        atelier.patch(f"/api/etats-heros/{t[h]['id']}", json={"avantage": None})
    for collection, ident in reversed(crees):
        atelier.delete(f"/api/{collection}/{ident}")
    actions_coin.jets_mj.fichier.unlink(missing_ok=True)
    actions_coin.jets_mj.reserve.fichier.unlink(missing_ok=True)
    actions_coin.jets_mj.hasard = None
    patch.undo()


@pytest.fixture()
def hasard():
    def poser(*faces):
        actions_coin.jets_mj.hasard = Hasard(*faces)
    yield poser
    actions_coin.jets_mj.hasard = None


@pytest.fixture()
def regle(atelier, tablee):
    """La règle des dés d'aventure en jeu, quatre dés au groupe, plus aucun jeton ; éteinte après."""
    for h in ("ysolde", "tavarede"):
        atelier.patch(f"/api/etats-heros/{tablee[h]['id']}", json={"avantage": None})
    reserve_neuve()
    r = atelier.put("/api/des-aventure", json={"actif": True, "total": 4})
    assert r.status_code == 200, r.text
    yield
    reserve_neuve()
    for h in ("ysolde", "tavarede"):
        atelier.patch(f"/api/etats-heros/{tablee[h]['id']}", json={"avantage": None})


def lances(joueur):
    return [d for d in demandes.lire(config.PROPOSITIONS, joueur["id"]) if d["genre"] in jd.LANCES]


def calme(joueur):
    assert attendre(lambda: not any(jd.en_route(d, datetime.now()) for d in lances(joueur)))


def lancer(coin, **corps):
    return coin.post("/api/jets", json=corps)


def resultat(coin, ident):
    def lu():
        d = coin.get("/api/jets").json()["dernier"]
        return d if d and d["id"] == ident and d["statut"] != "a-appliquer" else None
    r = attendre(lu)
    assert r, "l'atelier n'a pas lancé"
    return r


def reserve_mj(atelier):
    return atelier.get("/api/jets").json()["reserve"]


def fiche_coin(coin):
    return coin.get("/api/jets").json()["heros"]


# ---------------------------------------------------------------- les armes et les dés libres

def test_les_armes_publiees_nom_et_degats_seulement(tablee):
    a = tablee["a"]
    h = fiche_coin(a["coin"])
    # La même épée une fois, la lame qui nomme un inconnu sous un nom neutre, pas de fronde (1D3 ne se lance pas).
    assert h["armes"] == [{"nom": "Épée", "degats": "1D10"}, {"nom": "Une arme", "degats": "2D6+1"}]
    assert fiche_coin(tablee["b"]["coin"])["armes"] == [{"nom": "Arc long", "degats": "1D8"}]
    publie = "".join(f.read_text(encoding="utf-8") for f in (config.PROPOSITIONS / jd.DOSSIER).glob("*.json"))
    for mot in ("NOTE-ARME", "volée", "la même", "notes", "Gorvak", "Fronde", "Lames", "competence\":\"Lames", "SECRET-YSOLDE"):
        assert mot not in publie, mot


def test_des_des_libres_roulent_dans_l_atelier(atelier, tablee, hasard):
    a = tablee["a"]
    calme(a["joueur"])
    hasard(4, 3)
    r = lancer(a["coin"], des="2d6 + 1", total=99, resultat=[6, 6], de=12)
    assert r.status_code == 200, r.text
    ident = r.json()["lance"]
    [d] = [x for x in lances(a["joueur"]) if x["id"] == ident]
    # Seule l'expression, écrite proprement, part dans la demande.
    assert d["genre"] == jd.GENRE_DES and d["corps"] == {"des": "2D6+1"}
    p = resultat(a["coin"], ident)["public"]
    assert (p["texte"], p["des"], p["bonus"], p["total"], p["arme"], p["nom"]) == ("2D6+1", [4, 3], 1, 8, "", "Ysolde Gris")
    x = next(j for j in atelier.get("/api/jets").json()["jets"] if j["id"] == ident)
    assert (x["genre"], x["texte"], x["des"], x["total"], x["joueur_nom"], x["heros_nom"]) == ("des", "2D6+1", [4, 3], 8, "Aube", "Ysolde Gris")


def test_les_degats_d_une_arme_sont_ceux_de_la_fiche(atelier, tablee, hasard):
    a = tablee["a"]
    calme(a["joueur"])
    hasard(7)
    p = resultat(a["coin"], lancer(a["coin"], arme="Épée", des="1D10").json()["lance"])["public"]
    assert (p["arme"], p["texte"], p["total"]) == ("Épée", "1D10", 7)
    # Une arme qu'il n'a pas, ou des dégâts qui ne sont pas les siens : rien ne roule.
    for arme, expression in (("Épée", "1D12"), ("Hache de guerre", "1D10"), ("Fronde", "1D4")):
        calme(a["joueur"])
        r = resultat(a["coin"], lancer(a["coin"], arme=arme, des=expression).json()["lance"])
        assert r["statut"] == "echec" and r["phrase"] == jd.ARME_PARTIE and "public" not in r, arme
    # La lame qui nomme un inconnu : le joueur la lit « Une arme », le MJ sous son vrai nom.
    calme(a["joueur"])
    hasard(5, 2)
    ident = lancer(a["coin"], arme="Une arme", des="2D6+1").json()["lance"]
    p = resultat(a["coin"], ident)["public"]
    assert (p["arme"], p["total"]) == ("Une arme", 8)
    x = next(j for j in atelier.get("/api/jets").json()["jets"] if j["id"] == ident)
    assert x["arme"] == "Lame de Gorvak"


@pytest.mark.parametrize("corps", [{"des": "6D6"}, {"des": "1D7"}, {"des": "1D6+21"}, {"des": 6}, {"des": ["1D6"]}, {"des": None},
                                   {"des": "1D6", "arme": ["Épée"]}, {"des": "1D6", "arme": ""}])
def test_des_hors_bornes_refuses(tablee, corps):
    a = tablee["a"]
    calme(a["joueur"])
    avant = len(lances(a["joueur"]))
    coin = TestClient(joueurs.app, raise_server_exceptions=False)
    coin.cookies = a["coin"].cookies
    r = coin.post("/api/jets", json=corps)
    assert r.status_code == 400, (corps, r.text)
    assert len(lances(a["joueur"])) == avant


def test_un_seul_en_route_tests_et_des(tmp_path):
    jd.lancer(tmp_path, "essai", {"des": "1D6"})
    with pytest.raises(demandes.Refus) as refus:
        jd.lancer(tmp_path, "essai", {"carac": "mental"})
    assert refus.value.statut == 409
    with pytest.raises(demandes.Refus):
        jd.lancer(tmp_path, "essai", {"des": "1D8"})


def test_le_plafond_compte_tests_et_des_ensemble(atelier, tablee, hasard, monkeypatch):
    b = tablee["b"]
    monkeypatch.setattr(jd, "PAR_HEURE", 2)
    monkeypatch.setattr(joueurs, "JETS_LANCES", {})
    hasard(3)
    calme(b["joueur"])
    resultat(b["coin"], lancer(b["coin"], carac="social").json()["lance"])
    calme(b["joueur"])
    resultat(b["coin"], lancer(b["coin"], des="1D6").json()["lance"])
    calme(b["joueur"])
    r = lancer(b["coin"], des="1D8")
    assert r.status_code == 429


def test_la_route_commune_ne_lance_pas_de_des(tablee):
    r = tablee["a"]["coin"].post("/api/demandes", json={"genre": jd.GENRE_DES, "corps": {"des": "1D6"}})
    assert r.status_code == 409
    g = demandes.GENRES[jd.GENRE_DES]
    assert g.silencieux and not g.liste and not g.attente


# ---------------------------------------------------------------- la réserve des dés d'aventure

def test_la_regle_est_eteinte_par_defaut(atelier, tablee):
    reserve_neuve()
    assert reserve_mj(atelier)["actif"] is False
    assert attendre(lambda: fiche_coin(tablee["a"]["coin"])["reserve"] == {"actif": False})
    assert "reserve" not in tv_etat.etat_public(tv_ecran.etat_table())
    # Éteinte, un dé d'aventure coché ne roule pas : le test part sans, et le dit.
    a = tablee["a"]
    calme(a["joueur"])
    p = resultat(a["coin"], lancer(a["coin"], carac="mental", aventure=True).json()["lance"])["public"]
    assert "aventure" not in p and "plus en jeu" in p["notes"][0]
    assert reserve_mj(atelier)["groupe"] == 4


def test_le_de_d_aventure_passe_au_mj(atelier, tablee, hasard, regle):
    a = tablee["a"]
    atelier.put("/api/table", json={"vue": "accueil"})
    with atelier.websocket_connect("/ws/table") as tv:
        etat = tv.receive_json()
        assert etat["type"] == "etat" and etat["etat"]["reserve"] == {"aventure": 4, "mesaventure": 0}
        assert attendre(lambda: fiche_coin(a["coin"])["reserve"] == {"actif": True, "aventure": 4, "mesaventure": 0})
        calme(a["joueur"])
        hasard(42, 5)
        ident = lancer(a["coin"], carac="mental", aventure=True).json()["lance"]
        assert next(x for x in lances(a["joueur"]) if x["id"] == ident)["corps"]["aventure"] is True
        p = resultat(a["coin"], ident)["public"]
        # Mental 50, dé 42 : réussi ; le dé d'aventure fait 5, In extremis, annoncé sans rien changer au test.
        assert (p["de"], p["issue"], p["visee"]) == (42, "reussite", 50)
        assert p["aventure"] == {"face": 5, "effet": "In extremis", "choisie": False}
        m = tv.receive_json()
        while m["type"] != "jet":
            m = tv.receive_json()
        assert set(m) == CLES_TV_JET | {"aventure"} and m["aventure"] == {"face": 5, "effet": "In extremis", "choisie": False}
        # La TV relit son coin : un dé est passé au MJ.
        m = tv.receive_json()
        while m["type"] != "etat":
            m = tv.receive_json()
        assert m["etat"]["reserve"] == {"aventure": 3, "mesaventure": 1}
    v = atelier.get("/api/jets").json()
    assert (v["reserve"]["groupe"], v["reserve"]["mj"], v["reserve"]["total"]) == (3, 1, 4)
    assert next(x for x in v["jets"] if x["id"] == ident)["aventure"] == {"face": 5, "effet": "In extremis", "choisie": "", "annule": False}
    assert attendre(lambda: fiche_coin(a["coin"])["reserve"] == {"actif": True, "aventure": 3, "mesaventure": 1})


def test_le_mj_annule_le_de(atelier, tablee, hasard, regle):
    a = tablee["a"]
    calme(a["joueur"])
    hasard(80, 1)
    ident = lancer(a["coin"], carac="physique", aventure=True).json()["lance"]
    assert resultat(a["coin"], ident)["public"]["aventure"]["effet"] == "Mouvement"
    assert (reserve_mj(atelier)["groupe"], reserve_mj(atelier)["mj"]) == (3, 1)
    r = atelier.post(f"/api/jets/{ident}/aventure/annuler")
    assert r.status_code == 200, r.text
    assert (r.json()["reserve"]["groupe"], r.json()["reserve"]["mj"]) == (4, 0)
    assert next(x for x in r.json()["jets"] if x["id"] == ident)["aventure"]["annule"] is True
    # Le joueur le lit sous son résultat ; une seconde annulation ne rend rien de plus.
    assert attendre(lambda: a["coin"].get("/api/jets").json()["dernier"]["public"]["aventure"].get("annule") is True)
    assert atelier.post(f"/api/jets/{ident}/aventure/annuler").status_code == 409
    assert atelier.post("/api/jets/000000000000/aventure/annuler").status_code == 404


def test_plus_de_de_au_groupe(atelier, tablee, hasard, regle):
    a, b = tablee["a"], tablee["b"]
    assert atelier.put("/api/des-aventure", json={"total": 1}).status_code == 200
    calme(a["joueur"])
    hasard(10, 3)
    assert resultat(a["coin"], lancer(a["coin"], carac="mental", aventure=True).json()["lance"])["public"]["aventure"]["face"] == 3
    calme(b["joueur"])
    p = resultat(b["coin"], lancer(b["coin"], carac="social", aventure=True).json()["lance"])["public"]
    assert "aventure" not in p and "Plus de dé d'aventure" in p["notes"][0]
    assert (reserve_mj(atelier)["groupe"], reserve_mj(atelier)["mj"]) == (0, 1)
    # La réserve du MJ vidée à la main : le dé ne peut plus revenir.
    assert atelier.post("/api/des-aventure/passer", json={"vers": "groupe"}).status_code == 200
    ident = atelier.get("/api/jets").json()["jets"][1]["id"]
    assert atelier.post(f"/api/jets/{ident}/aventure/annuler").status_code == 409
    assert atelier.post("/api/des-aventure/passer", json={"vers": "groupe"}).status_code == 409
    assert atelier.post("/api/des-aventure/passer", json={"vers": "ailleurs"}).status_code == 400


def test_le_de_de_mesaventure(atelier, tablee, hasard, regle):
    a, b = tablee["a"], tablee["b"]
    jid = a["joueur"]["id"]
    # Le MJ n'a rien en réserve : rien à annoncer.
    r = atelier.post("/api/jets/mesaventure", json={"joueur": jid})
    assert r.status_code == 409 and r.json()["detail"] == rsv.MJ_VIDE
    assert atelier.post("/api/des-aventure/passer", json={"vers": "mj"}).status_code == 200
    r = atelier.post("/api/jets/mesaventure", json={"joueur": jid})
    assert r.status_code == 200, r.text
    [m] = r.json()["reserve"]["mesaventures"]
    assert (m["joueur"], m["nom"], m["face"]) == (jid, "Aube", None)
    # Aube le voit annoncé avant de lancer ; Basile, non. Un second dé pour Basile : la réserve n'en a qu'un.
    assert attendre(lambda: fiche_coin(a["coin"])["mesaventure"] == {"face_choisie": False})
    assert fiche_coin(b["coin"])["mesaventure"] is None
    assert atelier.post("/api/jets/mesaventure", json={"joueur": b["joueur"]["id"]}).status_code == 409
    calme(a["joueur"])
    hasard(30, 2)
    p = resultat(a["coin"], lancer(a["coin"], carac="physique").json()["lance"])["public"]
    assert p["mesaventure"] == {"face": 2, "effet": "Mouvement", "choisie": False}
    # Consommé une seule fois ; le dé est revenu au groupe.
    v = atelier.get("/api/jets").json()
    assert v["reserve"]["mesaventures"] == [] and (v["reserve"]["groupe"], v["reserve"]["mj"]) == (4, 0)
    assert attendre(lambda: fiche_coin(a["coin"])["mesaventure"] is None)
    calme(a["joueur"])
    assert "mesaventure" not in resultat(a["coin"], lancer(a["coin"], carac="physique").json()["lance"])["public"]
    # « Retirer » une annonce.
    atelier.post("/api/des-aventure/passer", json={"vers": "mj"})
    assert atelier.post("/api/jets/mesaventure", json={"joueur": jid}).status_code == 200
    assert atelier.post(f"/api/jets/mesaventure/{jid}/retirer").status_code == 200
    assert atelier.post(f"/api/jets/mesaventure/{jid}/retirer").status_code == 404
    assert reserve_mj(atelier)["mesaventures"] == []


def test_mesaventure_en_demandant_un_test(atelier, tablee, hasard, regle):
    a = tablee["a"]
    jid = a["joueur"]["id"]
    calme(a["joueur"])
    # Sans dé au MJ, ni le test ni le dé ne partent.
    r = atelier.post("/api/jets/demander", json={"joueur": jid, "carac": "mental", "mesaventure": True})
    assert r.status_code == 409
    assert a["coin"].get("/api/jets").json()["demande"] is None
    atelier.post("/api/des-aventure/passer", json={"vers": "mj"})
    r = atelier.post("/api/jets/demander", json={"joueur": jid, "carac": "mental", "mesaventure": True})
    assert r.status_code == 200, r.text
    assert [m["joueur"] for m in r.json()["reserve"]["mesaventures"]] == [jid]
    lu = a["coin"].get("/api/jets").json()
    assert lu["demande"]["carac"] == "mental"
    assert attendre(lambda: fiche_coin(a["coin"])["mesaventure"] == {"face_choisie": False})
    hasard(12, 6, 4)
    ident = lancer(a["coin"], demande=lu["demande"]["id"], aventure=True).json()["lance"]
    p = resultat(a["coin"], ident)["public"]
    # Les deux dés roulent avec le test : l'aventure d'abord, puis la mésaventure.
    assert (p["aventure"]["face"], p["mesaventure"]["face"]) == (6, 4)
    assert (reserve_mj(atelier)["groupe"], reserve_mj(atelier)["mj"]) == (3, 1)


def dernier(coin):
    return coin.get("/api/jets").json()["dernier"]


def changer_face(coin, jet, de, face):
    return coin.post("/api/jets/face", json={"jet": jet, "de": de, "face": face})


def test_l_avantage_change_la_face_apres_le_lancer(atelier, tablee, hasard, regle):
    """11/11 : l'avantage ne choisit plus la face avant le lancer ; le dé vu, le joueur la change et le jeton s'en va."""
    a = tablee["a"]
    ysolde = tablee["ysolde"]["id"]
    assert atelier.patch(f"/api/etats-heros/{ysolde}", json={"avantage": "avantage"}).status_code == 200
    assert attendre(lambda: fiche_coin(a["coin"])["jeton"] == "avantage")
    calme(a["joueur"])
    # Un choix envoyé avec le test (une page restée ouverte) est refusé, et rien ne part.
    assert lancer(a["coin"], carac="mental", aventure=True, choix={"de": "aventure", "face": 6}).status_code == 400
    hasard(50, 1)
    jet = lancer(a["coin"], carac="mental", aventure=True).json()["lance"]
    p = resultat(a["coin"], jet)["public"]
    assert p["aventure"] == {"face": 1, "effet": "Mouvement", "choisie": False}
    # Le dé a roulé, le jeton est toujours là : rien n'a été dépensé.
    assert (heros_etat.etats_heros().get(ysolde) or {}).get("avantage") == "avantage"
    # Demandes illisibles, un autre test, un dé qui n'a pas roulé : refusés avant de partir.
    for corps in ({"jet": jet, "de": "aventure", "face": 7}, {"jet": jet, "de": "autre", "face": 2}, {"jet": "zz", "de": "aventure", "face": 2}, "6"):
        assert a["coin"].post("/api/jets/face", json=corps).status_code == 400, corps
    assert changer_face(a["coin"], "0" * 12, "aventure", 6).status_code == 409
    assert changer_face(a["coin"], jet, "mesaventure", 6).status_code == 409
    r = changer_face(a["coin"], jet, "aventure", 6)
    assert r.status_code == 200, r.text
    assert attendre(lambda: dernier(a["coin"])["public"]["aventure"] == {"face": 6, "effet": "In extremis", "choisie": True})
    # Le jeton est dépensé : retiré de l'état du héros et de sa feuille ; le registre du MJ garde la face d'avant.
    assert (heros_etat.etats_heros().get(ysolde) or {}).get("avantage") is None
    assert attendre(lambda: fiche_coin(a["coin"])["jeton"] == "")
    note = next(x for x in atelier.get("/api/jets").json()["jets"] if x["id"] == jet)["aventure"]
    assert (note["face"], note["choisie"], note["avant"]) == (6, "joueur", 1)
    # Une seule fois par dé, et jamais sans jeton.
    r = changer_face(a["coin"], jet, "aventure", 4)
    assert r.status_code == 409 and "déjà" in r.json()["detail"]
    calme(a["joueur"])
    hasard(50, 2)
    jet2 = lancer(a["coin"], carac="mental", aventure=True).json()["lance"]
    assert resultat(a["coin"], jet2)["public"]["aventure"]["face"] == 2
    r = changer_face(a["coin"], jet2, "aventure", 6)
    assert r.status_code == 409 and "avantage" in r.json()["detail"]
    # Un jeton rendu par le MJ ne change que le dernier test, pas un plus ancien.
    atelier.patch(f"/api/etats-heros/{ysolde}", json={"avantage": "avantage"})
    assert attendre(lambda: fiche_coin(a["coin"])["jeton"] == "avantage")
    assert changer_face(a["coin"], jet, "aventure", 4).status_code == 409


def test_une_face_forgee_dans_la_file_est_refusee_par_l_atelier(atelier, tablee, hasard, regle):
    """Le coin compromis écrit le changement tout droit dans la file : l'atelier revérifie sur son registre et sur l'état."""
    a = tablee["a"]
    ysolde = tablee["ysolde"]["id"]
    calme(a["joueur"])
    hasard(50, 1)
    jet = lancer(a["coin"], carac="mental", aventure=True).json()["lance"]
    resultat(a["coin"], jet)
    # Sans jeton d'avantage dans l'atelier : refusé, le dé garde sa face.
    with demandes.verrou(config.PROPOSITIONS):
        liste = demandes.lire(config.PROPOSITIONS, a["joueur"]["id"])
        d = demandes.nouvelle({"genre": jd.GENRE_FACE, "corps": {"jet": jet, "de": "aventure", "face": 6}})
        demandes.ecrire(config.PROPOSITIONS, a["joueur"]["id"], [*liste, d])
    fait = attendre(lambda: next((x for x in demandes.lire(config.PROPOSITIONS, a["joueur"]["id"]) if x["id"] == d["id"] and x["statut"] != "a-appliquer"), None))
    assert fait["statut"] == "echec" and "avantage" in fait["resultat"]
    assert dernier(a["coin"])["public"]["aventure"]["face"] == 1
    assert (heros_etat.etats_heros().get(ysolde) or {}).get("avantage") is None


def test_avantage_sur_le_de_de_mesaventure(atelier, tablee, hasard, regle):
    a = tablee["a"]
    ysolde = tablee["ysolde"]["id"]
    atelier.post("/api/des-aventure/passer", json={"vers": "mj"})
    assert atelier.post("/api/jets/mesaventure", json={"joueur": a["joueur"]["id"]}).status_code == 200
    atelier.patch(f"/api/etats-heros/{ysolde}", json={"avantage": "avantage"})
    assert attendre(lambda: fiche_coin(a["coin"])["jeton"] == "avantage")
    calme(a["joueur"])
    hasard(20, 1)
    jet = lancer(a["coin"], carac="physique").json()["lance"]
    assert resultat(a["coin"], jet)["public"]["mesaventure"] == {"face": 1, "effet": "Mouvement", "choisie": False}
    assert changer_face(a["coin"], jet, "mesaventure", 3).status_code == 200
    assert attendre(lambda: dernier(a["coin"])["public"]["mesaventure"] == {"face": 3, "effet": "Posture", "choisie": True})
    assert (heros_etat.etats_heros().get(ysolde) or {}).get("avantage") is None


def test_l_avantage_donne_dix_pour_cent_au_test(atelier, tablee, hasard, regle):
    """11/11 : « Utiliser mon avantage » ajoute 10 % à la valeur visée, et le jeton s'en va quand le dé roule."""
    a = tablee["a"]
    ysolde = tablee["ysolde"]["id"]
    calme(a["joueur"])
    hasard(50)
    sans = resultat(a["coin"], lancer(a["coin"], carac="mental").json()["lance"])["public"]
    assert atelier.patch(f"/api/etats-heros/{ysolde}", json={"avantage": "avantage"}).status_code == 200
    assert attendre(lambda: fiche_coin(a["coin"])["jeton"] == "avantage")
    assert fiche_coin(a["coin"])["avantage"] == 10
    assert lancer(a["coin"], carac="mental", avantage="oui").status_code == 400
    calme(a["joueur"])
    hasard(50)
    ident = lancer(a["coin"], carac="mental", avantage=True).json()["lance"]
    avec = resultat(a["coin"], ident)["public"]
    assert avec["visee"] == sans["visee"] + 10 and {"libelle": "Avantage", "valeur": 10} in avec["ajustements"]
    assert (heros_etat.etats_heros().get(ysolde) or {}).get("avantage") is None
    assert attendre(lambda: fiche_coin(a["coin"])["jeton"] == "")
    # Le registre du MJ dit d'où vient le +10 %.
    assert {"libelle": "Avantage", "valeur": 10} in next(x for x in atelier.get("/api/jets").json()["jets"] if x["id"] == ident)["ajustements"]
    # Sans jeton, le test part sans, et le joueur le lit.
    calme(a["joueur"])
    hasard(50)
    p = resultat(a["coin"], lancer(a["coin"], carac="mental", avantage=True).json()["lance"])["public"]
    assert p["visee"] == sans["visee"] and "avantage n'était plus là" in p["notes"][0]


def test_un_desavantage_laisse_le_mj_choisir(atelier, tablee, hasard, regle):
    a, b = tablee["a"], tablee["b"]
    tavarede = tablee["tavarede"]["id"]
    atelier.post("/api/des-aventure/passer", json={"vers": "mj"})
    atelier.post("/api/des-aventure/passer", json={"vers": "mj"})
    # Ysolde ne porte pas de désavantage : le MJ ne choisit pas sa face.
    r = atelier.post("/api/jets/mesaventure", json={"joueur": a["joueur"]["id"], "face": 3})
    assert r.status_code == 409 and "désavantage" in r.json()["detail"]
    assert atelier.post("/api/jets/mesaventure", json={"joueur": a["joueur"]["id"], "face": 9}).status_code == 400
    atelier.patch(f"/api/etats-heros/{tavarede}", json={"avantage": "desavantage"})
    assert attendre(lambda: next(j for j in atelier.get("/api/jets").json()["joueurs"] if j["joueur"] == b["joueur"]["id"])["jeton"] == "desavantage")
    r = atelier.post("/api/jets/mesaventure", json={"joueur": b["joueur"]["id"], "face": 4})
    assert r.status_code == 200, r.text
    # Basile sait qu'un dé l'attend, et que le MJ en a choisi la face, pas laquelle.
    assert attendre(lambda: fiche_coin(b["coin"])["mesaventure"] == {"face_choisie": True})
    assert '"face":4' not in "".join(f.read_text(encoding="utf-8") for f in (config.PROPOSITIONS / jd.DOSSIER).glob("*.json"))
    calme(b["joueur"])
    hasard(70, 1)
    p = resultat(b["coin"], lancer(b["coin"], carac="social").json()["lance"])["public"]
    assert p["mesaventure"] == {"face": 4, "effet": "Posture", "choisie": True}
    assert (heros_etat.etats_heros().get(tavarede) or {}).get("avantage") is None
    assert next(x for x in atelier.get("/api/jets").json()["jets"] if x["genre"] == "jet")["mesaventure"]["choisie"] == "mj"


def test_le_reglage_et_l_interrupteur(atelier, tablee, regle):
    v = atelier.put("/api/des-aventure", json={"total": 6}).json()["reserve"]
    assert (v["groupe"], v["mj"], v["total"], v["actif"]) == (6, 0, 6, True)
    for faux in ({"total": 0}, {"total": 13}, {"total": "4"}, {"actif": "oui"}):
        assert atelier.put("/api/des-aventure", json=faux).status_code == 400, faux
    atelier.post("/api/des-aventure/passer", json={"vers": "mj"})
    assert atelier.post("/api/jets/mesaventure", json={"joueur": tablee["a"]["joueur"]["id"]}).status_code == 200
    v = atelier.put("/api/des-aventure", json={"actif": False}).json()["reserve"]
    # Éteinte : les annonces tombent, le total est gardé pour la prochaine fois ; la TV n'en montre plus rien.
    assert v["actif"] is False and v["mesaventures"] == [] and v["total"] == 6
    assert "reserve" not in tv_etat.etat_public(tv_ecran.etat_table())
    assert attendre(lambda: fiche_coin(tablee["a"]["coin"])["reserve"] == {"actif": False})
    r = atelier.post("/api/jets/mesaventure", json={"joueur": tablee["a"]["joueur"]["id"]})
    assert r.status_code == 409 and r.json()["detail"] == rsv.ETEINTE
    # « Tout au groupe » : le MJ repart sans rien, le total ne bouge pas.
    atelier.put("/api/des-aventure", json={"actif": True})
    atelier.post("/api/des-aventure/passer", json={"vers": "mj"})
    v = atelier.put("/api/des-aventure", json={"remettre": True}).json()["reserve"]
    assert (v["groupe"], v["mj"], v["total"]) == (6, 0, 6)


# ---------------------------------------------------------------- le total sous concurrence

def test_deux_joueurs_et_le_dernier_de(atelier, tablee, hasard, regle):
    """Deux joueurs ajoutent le dernier dé du groupe au même instant : un seul l'a, l'autre le lit, le total tient."""
    a, b = tablee["a"], tablee["b"]
    atelier.put("/api/des-aventure", json={"total": 1})
    calme(a["joueur"])
    calme(b["joueur"])
    hasard(40, 2)
    debut = threading.Barrier(2)
    idents = {}

    def jeter(code, carac):
        debut.wait()
        idents[code] = lancer(tablee[code]["coin"], carac=carac, aventure=True).json()["lance"]

    fils = [threading.Thread(target=jeter, args=(c, k)) for c, k in (("a", "mental"), ("b", "social"))]
    for f in fils:
        f.start()
    for f in fils:
        f.join()
    pa = resultat(a["coin"], idents["a"])["public"]
    pb = resultat(b["coin"], idents["b"])["public"]
    assert ("aventure" in pa) != ("aventure" in pb)
    r = reserve_mj(atelier)
    assert (r["groupe"], r["mj"]) == (0, 1)


def test_gestes_du_mj_pendant_les_jets(atelier, tablee, hasard, regle):
    """Annulations, transferts et réglages du total pendant que la boîte jette des dés : le total ne bouge que par le
    réglage, et rien ne se bloque."""
    a = tablee["a"]
    hasard(33, 4)
    arret = threading.Event()
    refus = []

    def mj():
        i = 0
        while not arret.is_set():
            r = atelier.post("/api/des-aventure/passer", json={"vers": "mj" if i % 2 == 0 else "groupe"})
            if r.status_code not in (200, 409):
                refus.append(r.text)
            i += 1

    fil = threading.Thread(target=mj)
    fil.start()
    try:
        for _ in range(4):
            calme(a["joueur"])
            ident = lancer(a["coin"], carac="mental", aventure=True).json()["lance"]
            resultat(a["coin"], ident)
            x = next((j for j in atelier.get("/api/jets").json()["jets"] if j["id"] == ident), None)
            if x and x.get("aventure"):
                atelier.post(f"/api/jets/{ident}/aventure/annuler")
            assert rsv.total(actions_coin.jets_mj.reserve.lire()) == 4
        assert atelier.put("/api/des-aventure", json={"total": 5}).status_code == 200
    finally:
        arret.set()
        fil.join(timeout=10)
    assert not fil.is_alive() and not refus
    assert rsv.total(actions_coin.jets_mj.reserve.lire()) == 5


def test_le_verrou_fait_attendre_sans_bloquer(atelier, tablee, regle):
    """Un geste du MJ attend que la boîte rende le verrou de la file, puis passe."""
    fini = threading.Event()
    with demandes.verrou(config.PROPOSITIONS):
        fil = threading.Thread(target=lambda: (actions_coin.jets_mj.transferer("mj"), fini.set()))
        fil.start()
        time.sleep(0.3)
        assert not fini.is_set()
    fil.join(timeout=5)
    assert fini.is_set() and actions_coin.jets_mj.reserve.lire()["mj"] == 1


# ---------------------------------------------------------------- les fuites

def test_rien_de_secret_vers_la_tv_ni_le_coin(atelier, tablee, hasard, regle):
    a = tablee["a"]
    atelier.put("/api/table", json={"vue": "accueil"})
    publique = tv_etat.table_publique()["ouverte"]
    atelier.put("/api/table-publique", json={"ouverte": True})
    atelier.post("/api/des-aventure/passer", json={"vers": "mj"})
    atelier.post("/api/jets/mesaventure", json={"joueur": a["joueur"]["id"]})
    try:
        with atelier.websocket_connect("/ws/table") as salon, atelier.websocket_connect("/ws/table", headers=CF) as dehors:
            for ecran in (salon, dehors):
                e = ecran.receive_json()
                assert e["etat"]["reserve"] == {"aventure": 3, "mesaventure": 1}
            recus = []
            for corps, faces in (({"arme": "Une arme", "des": "2D6+1"}, (2, 3)), ({"des": "5D100-20"}, (1, 2, 3, 4, 5)),
                                 ({"carac": "physique", "aventure": True}, (50, 3, 6))):
                calme(a["joueur"])
                hasard(*faces)
                ident = lancer(a["coin"], **corps).json()["lance"]
                recus.append(resultat(a["coin"], ident))
                for ecran in (salon, dehors):
                    m = ecran.receive_json()
                    while m["type"] not in ("jet", "des"):
                        m = ecran.receive_json()
                    recus.append(m)
                    if m["type"] == "des":
                        assert set(m) == CLES_TV_DES, set(m)
                    else:
                        assert set(m) == CLES_TV_JET | {"aventure", "mesaventure"}, set(m)
            tv = [m for m in recus if m.get("type") in ("jet", "des")]
            # La lame qui nomme un inconnu n'a pas de nom à la TV.
            assert [m.get("arme") for m in tv if m["type"] == "des"] == ["", "", "", ""]
            assert tv[2]["des"] == [1, 2, 3, 4, 5] and tv[2]["total"] == -5
            texte = json.dumps(tv, ensure_ascii=False)
            for mot in ("Gorvak", "Lame", "Brumes", "NOTE-ARME", "Aube", "visee", "modificateur", a["joueur"]["id"], tablee["ysolde"]["id"]):
                assert mot not in texte, mot
            # Toute la réserve publique : deux nombres.
            atelier.put("/api/table", json={"vue": "heros"})
            for ecran in (salon, dehors):
                m = ecran.receive_json()
                while m["type"] != "etat":
                    m = ecran.receive_json()
                assert set(m["etat"]["reserve"]) == {"aventure", "mesaventure"}
    finally:
        atelier.put("/api/table-publique", json={"ouverte": publique})
        atelier.put("/api/table", json={"vue": "accueil"})
    # Ce que le coin lit de sa fiche : rien d'autre que les champs connus.
    h = fiche_coin(a["coin"])
    assert set(h) == {"nom", "caracs", "competences", "armes", "jeton", "combat", "reserve", "mesaventure", "avantage", "posture", "critiques"}


def test_les_routes_du_mj_restent_chez_le_mj(atelier, tablee):
    b = tablee["b"]
    for chemin, corps in (("/api/jets/mesaventure", {"joueur": tablee["a"]["joueur"]["id"]}), ("/api/des-aventure/passer", {"vers": "mj"})):
        assert b["coin"].post(chemin, json=corps).status_code in (404, 405)
        assert atelier.post(chemin, json=corps, headers=CF).status_code == 404
    assert b["coin"].put("/api/des-aventure", json={"actif": True}).status_code in (404, 405)
    assert atelier.put("/api/des-aventure", json={"actif": True}, headers=CF).status_code == 404
    for route in ("POST /api/jets/mesaventure", "POST /api/jets/mesaventure/{joueur}/retirer", "POST /api/jets/{ident}/aventure/annuler",
                  "POST /api/des-aventure/passer", "PUT /api/des-aventure"):
        assert route in acces_mj.REGLES, route


def test_le_module_de_lecture_est_servi_au_coin(tablee):
    coin = tablee["a"]["coin"]
    assert "js/jets/des.js" in joueurs.FICHIERS
    assert coin.get("/static/js/jets/des.js").status_code == 200
    assert coin.get("/static/js/jets/reserve-table.js").status_code == 404
