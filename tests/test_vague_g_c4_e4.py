"""Les trois lots de la sixième vague ensemble (G : dés d'aventure ; C4 : « Pour le MJ seulement » ; E4 : portes qui
s'ouvrent et pas dans le noir), que chaque lot n'essaie que seul :
- un test avec dé d'aventure (avantage dépensé) et une porte ouverte par un autre joueur dans la même vague de la boîte :
  les deux s'appliquent, la réserve, le jeton et le plan sont justes, la TV est prévenue des deux ;
- un dé de mésaventure annoncé (face du MJ sur un désavantage, ou non) pendant un combat où un héros entre dans le noir à
  son tour : le jeton du combat reste au combat, la face du MJ ne vaut que hors combat ;
- un passage confié au MJ pendant qu'un jet roule pour le même joueur : la file partagée applique les deux, le texte
  confié n'y reste pas, chaque plafond horaire ne compte que les siens ;
- « Annuler » d'un déplacement qui a ouvert une porte et révélé une pièce, et « Annuler le dé », dans les deux ordres,
  puis l'éditeur du plan en retard qui enregistre (rejeu) ;
- pendant tout cela, le Tableau, la boîte et l'éditeur relus sans arrêt : jamais d'erreur, la réserve toujours entière."""
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
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from commun import confie  # noqa: E402
from commun import demandes  # noqa: E402
from commun import deplacement as dp  # noqa: E402
from commun import jets_distance as jd  # noqa: E402
from coin_mj import jets_mj  # noqa: E402
import joueurs  # noqa: E402
from coin_mj import mouvements  # noqa: E402
from contenu import reserve as rsv  # noqa: E402
from commun import table_joueurs  # noqa: E402
from comptes_coin import entrer  # noqa: E402
import main  # noqa: E402
from api import actions_coin, application, carnet_api, commandes_api, config, heros_etat, tv_ecran, tv_etat, utilitaires  # noqa: E402

CANARI = "CONFIEV6Q8W2"
TEXTE = f"Aude a peur des puits depuis l'enfance. {CANARI}."
P = None  # config.PROPOSITIONS, lu au moment des essais


class Hasard:
    def __init__(self, *faces):
        self.faces = list(faces)
        self.i = 0

    def randbelow(self, n):
        f = self.faces[self.i % len(self.faces)]
        self.i += 1
        return min(f, n) - 1


def attendre(condition, delai=8.0):
    fin = time.monotonic() + delai
    while time.monotonic() < fin:
        r = condition()
        if r:
            return r
        time.sleep(0.03)
    return None


def plan_de_lettres(pions: list, carte: list, genres: dict | None = None, portes=(), noms: dict | None = None) -> dict:
    """Comme tests/test_deplacement.py : une lettre par case, minuscule révélée, majuscule cachée."""
    h, w = len(carte), len(carte[0])
    sol, piece, vu = [], [], []
    for ligne in carte:
        for c in ligne:
            sol.append(2)
            piece.append("abcdefghijklmnopqrstuvwxyz".index(c.lower()) + 1)
            vu.append(1 if c.islower() else 0)
    lettres = sorted({c.lower() for ligne in carte for c in ligne})
    pieces = [{"id": "abcdefghijklmnopqrstuvwxyz".index(c) + 1, "nom": (noms or {}).get(c, f"Pièce {c}"), "nom_visible": True,
               "genre": (genres or {}).get(c, "salle")} for c in lettres]
    return {"nom": "Plan de la sixième vague", "lieu": "", "largeur": w, "hauteur": h, "m_case": 1.5, "brouillard_actif": True,
            "style": "couleur", "sol": sol, "piece": piece, "brouillard": vu, "pieces": pieces, "portes": list(portes), "objets": [],
            "textes": [{"id": "t-mj", "texte": "Éditeur 0", "x": 0, "y": 0, "taille": 1}], "pions": pions}


# ---------------------------------------------------------------- le monde

@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


def reserve_neuve(**k):
    with demandes.verrou(config.PROPOSITIONS):
        actions_coin.jets_mj.reserve.ecrire(rsv.normaliser({"actif": False, "groupe": 4, "mj": 0, **k}))


@pytest.fixture(scope="module")
def monde(atelier):
    """Léa joue Aude, Basile joue Bertrand ; le carnet et la table du coin ouverts, pions libres, « entrer » coché, la règle
    des dés d'aventure en jeu (quatre dés au groupe), une séance pour le combat."""
    global P
    P = config.PROPOSITIONS
    patch = pytest.MonkeyPatch()
    patch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    patch.setattr(joueurs, "COOKIE_SUR", False)
    patch.setattr(joueurs, "HOTES", set())
    patch.setattr(joueurs, "DEMANDES_FAITES", {})
    patch.setattr(joueurs, "JETS_LANCES", {})
    patch.setattr(joueurs, "DEPLACEMENTS_FAITS", {})
    crees, invites = [], []

    def creer(collection, **fiche):
        f = atelier.post(f"/api/{collection}", json=fiche).json()
        crees.append((collection, f["id"]))
        return f

    m = {"creer": creer}
    for code, nom, heros, genre, couleur in (("lea", "Léa", "Aude Vaguesix", "f", "#2e7d32"), ("basile", "Basile", "Bertrand Vaguesix", "h", "#1565c0")):
        h = creer("aventuriers", nom=heros, genre=genre, joueur=nom, tablee=True, couleur=couleur, physique=50, social=50, mental=50,
                  sante=9, psy=5, competences=[], armes=[{"nom": "Dague", "competence": "Lames", "degats": "1D4", "notes": ""}],
                  histoire="Née au bord de l'eau.")
        j = atelier.post("/api/joueurs", json={"nom": nom}).json()
        invites.append(j["id"])
        assert atelier.post(f"/api/joueurs/{j['id']}/relier", json={"heros": h["id"]}).status_code == 200
        coin = TestClient(joueurs.app)
        entrer(coin, j)
        m[code], m[f"{code}_id"], m[f"heros_{code}"] = coin, j["id"], h
    m["seance"] = creer("seances", nom="Séance de la sixième vague", numero=6, date=time.strftime("%Y-%m-%d"))
    avant_carnet = carnet_api.carnet_ouvert()
    assert atelier.put("/api/carnet-joueurs", json={"ouvert": True}).status_code == 200
    assert atelier.put("/api/table-joueurs", json={"ouverte": True, "pions": "libres", "distance": 12, "distance_combat": 6,
                                                   "entrer": True}).status_code == 200
    carnet_api.publier_carnet()
    reserve_neuve()
    assert atelier.put("/api/des-aventure", json={"actif": True, "total": 4}).status_code == 200
    assert attendre(lambda: m["lea"].get("/api/jets").json()["heros"] and m["basile"].get("/api/jets").json()["heros"])
    assert attendre(lambda: m["lea"].get("/api/confie").json().get("heros")), m["lea"].get("/api/confie").json()
    yield m
    atelier.delete(f"/api/seances/{m['seance']['id']}/combat")
    atelier.put("/api/table", json={"vue": "accueil"})
    atelier.put("/api/table-joueurs", json={"ouverte": False, "pions": "a-valider", "distance": 12, "distance_combat": 6, "entrer": True})
    atelier.put("/api/carnet-joueurs", json={"ouvert": avant_carnet})
    for code in ("lea", "basile"):
        atelier.patch(f"/api/etats-heros/{m[f'heros_{code}']['id']}", json={"avantage": None})
        m[code].close()
    for ident in invites:
        with confie.verrou(config.PROPOSITIONS):
            confie.fichier(config.PROPOSITIONS, ident).unlink(missing_ok=True)
        atelier.delete(f"/api/joueurs/{ident}")
    for collection, ident in reversed(crees):
        atelier.delete(f"/api/{collection}/{ident}")
    actions_coin.jets_mj.fichier.unlink(missing_ok=True)
    actions_coin.jets_mj.reserve.fichier.unlink(missing_ok=True)
    actions_coin.jets_mj.hasard = None
    tv_etat.TABLE_JOUEURS.unlink(missing_ok=True)
    table_joueurs.fermer(config.PROPOSITIONS)
    demandes.ecrire_pause(config.PROPOSITIONS, False)
    patch.undo()


class Lecteurs:
    """Le Tableau, la boîte et l'éditeur du plan relus sans arrêt dans un autre fil, comme trois onglets ouverts : chaque
    réponse doit être un 200 lisible, la réserve toujours entière (groupe + MJ = le total réglé)."""

    def __init__(self, atelier, total=4):
        self.atelier, self.total = atelier, total
        self.plan = None
        self.fautes, self.lus = [], 0
        self.arret = threading.Event()
        self.fil = threading.Thread(target=self.tourner, daemon=True)

    def tourner(self):
        while not self.arret.is_set():
            try:
                urls = ["/api/jets", "/api/demandes"]
                if self.plan:
                    urls += [f"/api/plans/{self.plan}", f"/api/plans/{self.plan}/deplacements"]
                for url in urls:
                    r = self.atelier.get(url)
                    self.lus += 1
                    if r.status_code != 200:
                        self.fautes.append(f"{url} : {r.status_code} {r.text[:200]}")
                        continue
                    v = r.json()
                    if url == "/api/jets":
                        x = v["reserve"]
                        if x["groupe"] + x["mj"] != x["total"] or x["total"] != self.total or min(x["groupe"], x["mj"]) < 0:
                            self.fautes.append(f"réserve lue : {x}")
                    elif url.endswith("/deplacements"):
                        if set(v) != {"attente", "tentatives"}:
                            self.fautes.append(f"déplacements lus : {sorted(v)}")
                    elif url.startswith("/api/plans/"):
                        if len(v["brouillard"]) != v["largeur"] * v["hauteur"]:
                            self.fautes.append("plan lu à moitié")
            except Exception as err:  # noqa: BLE001
                self.fautes.append(f"exception : {err!r}")
            time.sleep(0.02)


@pytest.fixture()
def lecteurs(atelier, monde):
    lu = Lecteurs(atelier)
    lu.fil.start()
    yield lu
    lu.arret.set()
    lu.fil.join(10)
    assert not lu.fil.is_alive(), "les lecteurs sont restés bloqués"
    assert not lu.fautes, lu.fautes[:5]
    assert lu.lus > 10


@pytest.fixture()
def neuf(atelier, monde):
    """Chaque essai part de files vides, sans jeton, sans texte confié, quatre dés au groupe, sans combat."""
    atelier.delete(f"/api/seances/{monde['seance']['id']}/combat")
    for code in ("lea", "basile"):
        j = monde[f"{code}_id"]
        with demandes.verrou(config.PROPOSITIONS):
            demandes.fichier(config.PROPOSITIONS, j).unlink(missing_ok=True)
        with confie.verrou(config.PROPOSITIONS):
            confie.fichier(config.PROPOSITIONS, j).unlink(missing_ok=True)
        confie.fichier_recu(config.PROPOSITIONS, j).unlink(missing_ok=True)
        atelier.patch(f"/api/etats-heros/{monde[f'heros_{code}']['id']}", json={"avantage": None})
        chemin = config.AVENTURIERS / f"{monde[f'heros_{code}']['id']}.json"
        with heros_etat.SAC_VERROU:
            f = utilitaires.lire(chemin)
            f.pop(confie.CHAMP, None)
            utilitaires.ecrire(chemin, f)
    for cle in ("DEMANDES_FAITES", "JETS_LANCES", "DEPLACEMENTS_FAITS"):
        getattr(joueurs, cle).clear()
    reserve_neuve()
    assert atelier.put("/api/des-aventure", json={"actif": True, "total": 4}).status_code == 200
    assert atelier.put("/api/table-joueurs", json={"ouverte": True, "pions": "libres", "distance": 12, "distance_combat": 6,
                                                   "entrer": True}).status_code == 200
    actions_coin.jets_mj.hasard = None
    yield monde
    actions_coin.jets_mj.hasard = None
    (config.DONNEES / mouvements.TENTATIVES).unlink(missing_ok=True)
    (config.DONNEES / mouvements.TOURS).unlink(missing_ok=True)


def montrer(atelier, monde, fiche: dict) -> dict:
    p = monde["creer"]("plans", **fiche)
    assert atelier.put("/api/table", json={"vue": "plan", "plan": p["id"], "style": "couleur"}).status_code == 200
    tv_etat.table_coin.tout_de_suite()
    return p


def pions_a(monde, aude: tuple, bertrand: tuple) -> list:
    return [{"id": "t-aude", "genre": "heros", "nom": "Aude", "ref": f"aventurier:{monde['heros_lea']['id']}", "x": aude[0] + 0.5, "y": aude[1] + 0.5},
            {"id": "t-bertrand", "genre": "heros", "nom": "Bertrand", "ref": f"aventurier:{monde['heros_basile']['id']}",
             "x": bertrand[0] + 0.5, "y": bertrand[1] + 0.5}]


def plan_porte(monde) -> dict:
    """La salle a révélée (x < 3), la salle B cachée derrière une porte fermée en (3, 1). Aude en (0, 0), Bertrand en (1, 1)."""
    return plan_de_lettres(pions_a(monde, (0, 0), (1, 1)), ["aaaBBB", "aaaBBB", "aaaBBB"], noms={"b": "SALLE-VAGUE-SIX"},
                           portes=[{"id": "porte-b", "sens": "v", "x": 3, "y": 1, "genre": "porte", "etat": "fermee"}])


def jeton_public(coin) -> str:
    return attendre(lambda: (coin.get("/api/table").json().get("vue") or {}).get("plan", {}).get("id"))


def fiche_plan(atelier, p) -> dict:
    return atelier.get(f"/api/plans/{p['id']}").json()


def porte(atelier, p, ident="porte-b") -> str:
    return next(d for d in fiche_plan(atelier, p)["portes"] if d["id"] == ident)["etat"]


def pion(atelier, p, ident) -> list:
    t = next(x for x in fiche_plan(atelier, p)["pions"] if x["id"] == ident)
    return [t["x"], t["y"]]


def revelees(atelier, p) -> set:
    f = fiche_plan(atelier, p)
    return {(i % f["largeur"], i // f["largeur"]) for i, v in enumerate(f["brouillard"]) if v == 1}


def demande(monde, code, ident):
    return demandes.trouver(demandes.lire(config.PROPOSITIONS, monde[f"{code}_id"]), ident)


def traitee(monde, code, ident, delai=8.0):
    d = attendre(lambda: (lambda x: x if x and x["statut"] != demandes.A_APPLIQUER else None)(demande(monde, code, ident)), delai)
    assert d, f"l'atelier n'a pas traité la demande {ident}"
    return d


def ecrire_ensemble(monde, *paires) -> list:
    """Des demandes écrites tout droit dans les files, sous un seul verrou : la boîte les voit dans la même vague."""
    faites = []
    with demandes.verrou(config.PROPOSITIONS):
        for code, genre, corps in paires:
            d = demandes.nouvelle({"genre": genre, "corps": corps})
            jid = monde[f"{code}_id"]
            demandes.ecrire(config.PROPOSITIONS, jid, [*demandes.lire(config.PROPOSITIONS, jid), d])
            faites.append(d)
    return faites


def reserve(atelier) -> tuple:
    r = atelier.get("/api/jets").json()["reserve"]
    return r["groupe"], r["mj"]


def dans_la_boite(atelier, monde, code, ident):
    v = atelier.get("/api/demandes").json()
    return next((x for x in v["attente"] + v["historique"] if x["joueur"] == monde[f"{code}_id"] and x["id"] == ident), None)


def calme(monde, code):
    assert attendre(lambda: not any(jd.en_route(d, datetime.now()) for d in demandes.lire(config.PROPOSITIONS, monde[f"{code}_id"])
                                    if d["genre"] in jd.LANCES))


def lancer(monde, code, **corps):
    calme(monde, code)
    r = monde[code].post("/api/jets", json={"competence": "", "modificateur": 0, **corps})
    assert r.status_code == 200, r.text
    return traitee(monde, code, r.json()["lance"])


@pytest.fixture()
def tv(monkeypatch):
    """Ce que reçoit la TV : les bandeaux (envoyer_tv) et chaque état public diffusé (la réserve, la version du plan)."""
    recus = []
    vrai_diffuser = tv_etat.diffusion.diffuser

    async def diffuser(etat):
        recus.append(("etat", tv_etat.etat_public(etat)))
        await vrai_diffuser(etat)

    async def bandeau(message):
        recus.append((message.get("type"), message))

    monkeypatch.setattr(tv_etat.diffusion, "diffuser", diffuser)
    monkeypatch.setattr(actions_coin.jets_mj, "envoyer_tv", bandeau)
    return recus


# ---------------------------------------------------------------- un dé d'aventure et une porte, dans la même vague

def test_un_de_d_aventure_et_une_porte_dans_la_meme_vague(atelier, neuf, lecteurs, tv, monkeypatch):
    m = neuf
    p = montrer(atelier, m, plan_porte(m))
    lecteurs.plan = p["id"]
    aude = m["heros_lea"]["id"]
    assert atelier.patch(f"/api/etats-heros/{aude}", json={"avantage": "avantage"}).status_code == 200
    assert attendre(lambda: m["lea"].get("/api/jets").json()["heros"]["jeton"] == "avantage")
    plan_coin = jeton_public(m["basile"])
    version_avant = tv_etat.etat_public(tv_ecran.etat_table())["version"]
    vagues = []
    vraies_suites = commandes_api.boite.suites

    async def suites(faites):
        vagues.append(sorted(d["genre"] for _, d in faites))
        await vraies_suites(faites)

    monkeypatch.setattr(commandes_api.boite, "suites", suites)
    actions_coin.jets_mj.hasard = Hasard(50, 2)
    jet, pas = ecrire_ensemble(m, ("lea", jd.GENRE, {"carac": "mental", "competence": "", "modificateur": 0, "aventure": True,
                                                     "avantage": True}),
                               ("basile", dp.GENRE, {"plan": plan_coin, "pion": "t-bertrand", "depuis": [1, 1], "vers": [3, 1]}))
    jet, pas = traitee(m, "lea", jet["id"]), traitee(m, "basile", pas["id"])
    assert any({"jet", "deplacement"} <= set(v) for v in vagues), vagues
    # Le test : l'avantage dépensé pour +10 %, le dé d'aventure qui roule (il ne se choisit plus avant), un dé passé au MJ.
    assert jet["statut"] == "appliquee", jet
    assert jet["public"]["aventure"] == {"face": 2, "effet": "Mouvement", "choisie": False}
    assert {"libelle": "Avantage", "valeur": 10} in jet["public"]["ajustements"]
    assert (heros_etat.etats_heros().get(aude) or {}).get("avantage") is None
    assert reserve(atelier) == (3, 1)
    # Le pas : la porte s'ouvre, la salle cachée se révèle, le pion y est.
    assert pas["statut"] == "appliquee" and pas["resultat"] == "Fait : 2 cases, une porte ouverte, et la pièce se révèle.", pas
    assert porte(atelier, p) == "ouverte" and pion(atelier, p, "t-bertrand") == [3.5, 1.5]
    assert revelees(atelier, p) == {(x, y) for y in range(3) for x in range(6)}
    # La TV : le bandeau du test, son coin des réserves, le plan relu (sa version a changé).
    assert attendre(lambda: any(t == "jet" for t, _ in tv))
    bandeau = next(x for t, x in tv if t == "jet")
    assert bandeau["aventure"] == {"face": 2, "effet": "Mouvement", "choisie": False}
    assert attendre(lambda: any(t == "etat" and e.get("reserve") == {"aventure": 3, "mesaventure": 1} for t, e in tv))
    assert attendre(lambda: any(t == "etat" and e.get("version") not in (None, version_avant) for t, e in tv))
    vue = atelier.get(f"/api/table/plan/{tv_etat.etat_public(tv_ecran.etat_table())['plan']}").json()
    assert next(d for d in vue["portes"] if d["id"] == "porte-b")["etat"] == "ouverte"
    assert any(x["nom"] == "SALLE-VAGUE-SIX" for x in vue["pieces"])
    # Les deux joueurs relisent chacun le leur : Léa son jeton parti et la réserve, Basile sa table.
    assert attendre(lambda: m["lea"].get("/api/jets").json()["heros"]["jeton"] == "" and
                    m["lea"].get("/api/jets").json()["heros"]["reserve"] == {"actif": True, "aventure": 3, "mesaventure": 1})
    assert attendre(lambda: next(x for x in m["basile"].get("/api/table").json()["vue"]["plan"]["portes"] if x["id"] == "porte-b")["etat"] == "ouverte")
    # Le Tableau a le test, la boîte a le pas, l'éditeur les mouvements, rien ne s'est arrêté.
    note = next(x for x in atelier.get("/api/jets").json()["jets"] if x["id"] == jet["id"])
    assert note["aventure"]["choisie"] == "" and {"libelle": "Avantage", "valeur": 10} in note["ajustements"]
    assert "ouvre une porte" in dans_la_boite(atelier, m, "basile", pas["id"])["phrase"]
    assert atelier.get(f"/api/plans/{p['id']}/deplacements").json() == {"attente": [], "tentatives": []}


# ---------------------------------------------------------------- une mésaventure pendant un combat, un pas dans le noir

def combat(atelier, monde, actif, heros_combat, tour=1):
    url = f"/api/seances/{monde['seance']['id']}/combat"
    actuel = atelier.get(url).json()["combat"]
    b = monde["heros_basile"]
    corps = {"id": "c6", "nom": "Combat de la sixième vague", "tour": tour, "actif": actif,
             "ordre": [f"aventurier:{b['id']}", "ennemis"], "heros": heros_combat, "adversaires": [],
             "version_base": (actuel or {}).get("modifie")}
    r = atelier.put(url, json=corps)
    assert r.status_code == 200, r.text
    tv_etat.table_coin.tout_de_suite()


def test_mesaventure_pendant_un_combat_et_un_pas_dans_le_noir(atelier, neuf, lecteurs):
    m = neuf
    aude, bertrand = m["heros_lea"]["id"], m["heros_basile"]["id"]
    # Une grotte à moitié révélée ; Bertrand au bord du noir, Aude hors du combat.
    p = montrer(atelier, m, plan_de_lettres(pions_a(m, (0, 0), (2, 1)), ["aaaAAA", "aaaAAA", "aaaAAA"], genres={"a": "grotte"}))
    lecteurs.plan = p["id"]
    # Bertrand se bat, son désavantage vit dans le combat ; c'est à lui.
    combat(atelier, m, 0, [{"id": bertrand, "nom": "Bertrand", "max": 9, "sante": 9, "avantage": "desavantage"}])
    assert (heros_etat.etats_heros().get(bertrand) or {}).get("avantage") == "desavantage"
    assert bertrand in heros_etat.heros_au_combat()
    # Depuis le 11/11, la feuille du joueur lit son jeton en combat aussi (il peut dépenser un avantage pour un test).
    assert attendre(lambda: (lambda h: h["combat"] is True and h["jeton"] == "desavantage")(m["basile"].get("/api/jets").json()["heros"]))
    # Le MJ passe deux dés dans sa réserve. La face d'un héros au combat ne se choisit pas, même avec son désavantage.
    for _ in range(2):
        assert atelier.post("/api/des-aventure/passer", json={"vers": "mj"}).status_code == 200
    r = atelier.post("/api/jets/mesaventure", json={"joueur": m["basile_id"], "face": 4})
    assert r.status_code == 409 and r.json()["detail"] == jets_mj.FACE_MJ
    assert atelier.post("/api/jets/mesaventure", json={"joueur": m["basile_id"]}).status_code == 200
    # Hors combat, Aude porte un désavantage : le MJ choisit sa face.
    assert atelier.patch(f"/api/etats-heros/{aude}", json={"avantage": "desavantage"}).status_code == 200
    r = atelier.post("/api/jets/mesaventure", json={"joueur": m["lea_id"], "face": 2})
    assert r.status_code == 200, r.text
    assert attendre(lambda: m["lea"].get("/api/jets").json()["heros"]["mesaventure"] == {"face_choisie": True})
    assert attendre(lambda: m["basile"].get("/api/jets").json()["heros"]["mesaventure"] == {"face_choisie": False})
    # Il porte un désavantage : un avantage qu'il n'a pas ne se dépense pas, ni dans le combat ni dans son état.
    assert heros_etat.jeton_depense(bertrand, "avantage") is False
    assert (heros_etat.etats_heros().get(bertrand) or {}).get("avantage") == "desavantage"
    # À son tour, Bertrand fait un pas dans le noir : les alentours de la grotte se révèlent, le tour part de sa case.
    plan_coin = jeton_public(m["basile"])
    assert attendre(lambda: m["basile"].get("/api/table").json()["mon_tour"] is True)
    r = m["basile"].post("/api/demandes", json={"genre": dp.GENRE, "corps": {"plan": plan_coin, "pion": "t-bertrand", "depuis": [2, 1], "vers": [3, 1]}})
    assert r.status_code == 200, r.text
    d = traitee(m, "basile", r.json()["id"])
    assert (d["statut"], d["resultat"]) == ("appliquee", "Fait : 1 case, et les alentours se révèlent."), d
    assert {(3, 1), (4, 1), (5, 1)} <= revelees(atelier, p)
    assert attendre(lambda: m["basile"].get("/api/table").json()["debut"] == [2, 1])
    # Il lance un test en forgeant un avantage : il porte un désavantage, le +10 % ne part pas et le jeton reste.
    actions_coin.jets_mj.hasard = Hasard(30, 5)
    j = lancer(m, "basile", carac="physique", avantage=True)
    assert j["public"]["mesaventure"] == {"face": 5, "effet": "In extremis", "choisie": False}, j["public"]
    assert "avantage n'était plus là" in " ".join(j["public"].get("notes") or [])
    assert (heros_etat.etats_heros().get(bertrand) or {}).get("avantage") == "desavantage"
    s = atelier.get(f"/api/seances/{m['seance']['id']}/combat").json()["combat"]
    assert s["heros"][0]["avantage"] == "desavantage"
    # Aude, hors combat : la face du MJ, le désavantage enfin dépensé.
    actions_coin.jets_mj.hasard = Hasard(40, 6)
    j = lancer(m, "lea", carac="mental")
    assert j["public"]["mesaventure"] == {"face": 2, "effet": "Mouvement", "choisie": True}, j["public"]
    assert (heros_etat.etats_heros().get(aude) or {}).get("avantage") is None
    assert reserve(atelier) == (4, 0) and atelier.get("/api/jets").json()["reserve"]["mesaventures"] == []
    # Aude entre au combat avec une face choisie pour elle : le dé roule, le désavantage reste au combat.
    assert atelier.post("/api/des-aventure/passer", json={"vers": "mj"}).status_code == 200
    assert atelier.patch(f"/api/etats-heros/{aude}", json={"avantage": "desavantage"}).status_code == 200
    assert atelier.post("/api/jets/mesaventure", json={"joueur": m["lea_id"], "face": 3}).status_code == 200
    combat(atelier, m, 1, [{"id": bertrand, "nom": "Bertrand", "max": 9, "sante": 9, "avantage": "desavantage"},
                           {"id": aude, "nom": "Aude", "max": 9, "sante": 9, "avantage": "desavantage"}])
    actions_coin.jets_mj.hasard = Hasard(40, 6)
    j = lancer(m, "lea", carac="mental")
    assert j["public"]["mesaventure"] == {"face": 6, "effet": "In extremis", "choisie": False}, j["public"]
    assert (heros_etat.etats_heros().get(aude) or {}).get("avantage") == "desavantage"
    # Le tour passe aux ennemis : Bertrand ne bouge plus.
    r = m["basile"].post("/api/demandes", json={"genre": dp.GENRE, "corps": {"plan": jeton_public(m["basile"]), "pion": "t-bertrand",
                                                                             "depuis": [3, 1], "vers": [4, 1]}})
    assert r.status_code == 409 and r.json()["detail"] == dp.PAS_TON_TOUR
    assert reserve(atelier) == (4, 0)


# ---------------------------------------------------------------- un passage confié pendant qu'un jet roule

def test_un_passage_confie_pendant_qu_un_jet_roule(atelier, neuf, lecteurs):
    m = neuf
    aude = m["heros_lea"]["id"]
    actions_coin.jets_mj.hasard = Hasard(20, 4)
    resultats = {}
    # Le jet est en route (écrit, pas encore lancé) quand Léa envoie son passage : la file reste prise le temps de l'écrire.
    with demandes.verrou(config.PROPOSITIONS):
        jet = demandes.nouvelle({"genre": jd.GENRE, "corps": {"carac": "social", "competence": "", "modificateur": 0, "aventure": True}})
        demandes.ecrire(config.PROPOSITIONS, m["lea_id"], [*demandes.lire(config.PROPOSITIONS, m["lea_id"]), jet])
        fil = threading.Thread(target=lambda: resultats.update(r=m["lea"].post("/api/confie/envoyer", json={"texte": TEXTE})))
        fil.start()
        time.sleep(0.3)
        assert fil.is_alive()  # il attend la file
    fil.join(10)
    assert not fil.is_alive() and resultats["r"].status_code == 200, resultats["r"].text
    jet = traitee(m, "lea", jet["id"])
    assert jet["statut"] == "appliquee" and jet["public"]["aventure"]["face"] == 4
    envoi = resultats["r"].json()["envoye_id"]
    d = traitee(m, "lea", envoi)
    assert d["statut"] == "appliquee" and d["corps"] == {"signes": len(TEXTE)}
    fiche = utilitaires.lire(config.AVENTURIERS / f"{aude}.json")
    assert fiche[confie.CHAMP]["texte"] == TEXTE and fiche[confie.CHAMP]["envoi"] == envoi
    # Le texte ne reste ni dans la file de Léa, ni dans la boîte, ni dans le Tableau.
    assert CANARI not in demandes.fichier(config.PROPOSITIONS, m["lea_id"]).read_text(encoding="utf-8")
    for url in ("/api/demandes", "/api/jets"):
        assert CANARI not in atelier.get(url).text, url
    assert attendre(lambda: m["lea"].get("/api/confie").json()["envoye"]["etat"] == "depose")
    assert reserve(atelier) == (3, 1)
    # Chaque plafond ne compte que les siens : trente passages n'empêchent pas un test, soixante tests pas un passage.
    joueurs.DEMANDES_FAITES[m["lea_id"]] = [time.monotonic()] * demandes.PAR_HEURE
    r = m["lea"].post("/api/confie/envoyer", json={"texte": TEXTE + " Encore."})
    assert r.status_code == 429
    assert lancer(m, "lea", carac="mental")["statut"] == "appliquee"
    joueurs.DEMANDES_FAITES.clear()
    joueurs.JETS_LANCES[m["lea_id"]] = [time.monotonic()] * jd.PAR_HEURE
    calme(m, "lea")
    assert m["lea"].post("/api/jets", json={"carac": "mental", "competence": "", "modificateur": 0}).status_code == 429
    r = m["lea"].post("/api/confie/envoyer", json={"texte": TEXTE + " Encore."})
    assert r.status_code == 200, r.text
    assert traitee(m, "lea", r.json()["envoye_id"])["statut"] == "appliquee"
    joueurs.JETS_LANCES.clear()
    assert CANARI not in demandes.fichier(config.PROPOSITIONS, m["lea_id"]).read_text(encoding="utf-8")


def test_un_passage_retire_avant_d_etre_depose_ne_reste_pas_dans_la_file(atelier, neuf):
    """Léa retire son passage avant que l'atelier le dépose (l'atelier redémarre, la boîte n'est pas encore passée) : elle a
    changé d'avis, le MJ ne le lit pas, ni sur la fiche ni dans sa boîte ; la file n'en garde que la longueur, et Léa le
    relit toujours dans sa page pour le renvoyer."""
    m = neuf
    r = m["lea"].post("/api/confie/envoyer", json={"texte": TEXTE})
    assert r.status_code == 200, r.text
    ident = r.json()["envoye_id"]
    r = m["lea"].delete(f"/api/demandes/{ident}")
    if r.status_code != 200:
        pytest.skip("la boîte a déposé le passage avant le retrait")
    assert r.json()["statut"] == "retiree" and CANARI not in r.text
    d = traitee(m, "lea", ident)
    assert d["statut"] == "retiree" and d["corps"] == {"signes": len(TEXTE)}
    assert CANARI not in demandes.fichier(config.PROPOSITIONS, m["lea_id"]).read_text(encoding="utf-8")
    assert CANARI not in atelier.get("/api/demandes").text
    el = dans_la_boite(atelier, m, "lea", ident)
    assert el and el["corps"] == {"signes": len(TEXTE)} and "retiré un passage" in el["phrase"]
    assert confie.CHAMP not in utilitaires.lire(config.AVENTURIERS / f"{m['heros_lea']['id']}.json")
    vu = m["lea"].get("/api/confie").json()["envoye"]
    assert (vu["etat"], vu["texte"]) == ("retire", TEXTE)
    # Renvoyé, il part et se dépose ; la boîte n'en montre que la longueur.
    r = m["lea"].post("/api/confie/envoyer", json={"texte": TEXTE})
    assert r.status_code == 200 and not r.json().get("deja"), r.text
    assert traitee(m, "lea", r.json()["envoye_id"])["statut"] == "appliquee"
    assert utilitaires.lire(config.AVENTURIERS / f"{m['heros_lea']['id']}.json")[confie.CHAMP]["texte"] == TEXTE
    assert CANARI not in atelier.get("/api/demandes").text
    assert dans_la_boite(atelier, m, "lea", r.json()["envoye_id"])["corps"] == {"signes": len(TEXTE)}


# ---------------------------------------------------------------- « Annuler » le pas et le dé, puis l'éditeur en retard

@pytest.mark.parametrize("ordre", ["pas-puis-de", "de-puis-pas"])
@pytest.mark.parametrize("base", ["avant-le-pas", "apres-le-pas"])
def test_annuler_le_pas_et_le_de_puis_l_editeur_en_retard(atelier, neuf, lecteurs, ordre, base):
    m = neuf
    aude = m["heros_lea"]["id"]
    p = montrer(atelier, m, plan_porte(m))
    lecteurs.plan = p["id"]
    ed_avant = fiche_plan(atelier, p)
    plan_coin = jeton_public(m["basile"])
    r = m["basile"].post("/api/demandes", json={"genre": dp.GENRE, "corps": {"plan": plan_coin, "pion": "t-bertrand", "depuis": [1, 1], "vers": [3, 1]}})
    assert r.status_code == 200, r.text
    pas = traitee(m, "basile", r.json()["id"])
    assert pas["statut"] == "appliquee" and porte(atelier, p) == "ouverte"
    ed_apres = fiche_plan(atelier, p)
    # Le dé d'aventure de Léa, sa face choisie par son avantage.
    assert atelier.patch(f"/api/etats-heros/{aude}", json={"avantage": "avantage"}).status_code == 200
    assert attendre(lambda: m["lea"].get("/api/jets").json()["heros"]["jeton"] == "avantage")
    jet = lancer(m, "lea", carac="mental", aventure=True)
    r = m["lea"].post("/api/jets/face", json={"jet": jet["id"], "de": "aventure", "face": 3})
    assert r.status_code == 200, r.text
    assert traitee(m, "lea", r.json()["change"])["statut"] == "appliquee"
    assert m["lea"].get("/api/jets").json()["dernier"]["public"]["aventure"] == {"face": 3, "effet": "Posture", "choisie": True}
    assert reserve(atelier) == (3, 1)

    def annuler_le_pas():
        el = dans_la_boite(atelier, m, "basile", pas["id"])
        r = atelier.post(f"/api/demandes/{m['basile_id']}/{pas['id']}/annuler", json={"version": el["version"]})
        assert r.status_code == 200, r.text
        assert atelier.post(f"/api/demandes/{m['basile_id']}/{pas['id']}/annuler", json={"version": el["version"]}).status_code == 409

    def annuler_le_de():
        r = atelier.post(f"/api/jets/{jet['id']}/aventure/annuler")
        assert r.status_code == 200, r.text
        assert atelier.post(f"/api/jets/{jet['id']}/aventure/annuler").status_code == 409

    for geste in ((annuler_le_pas, annuler_le_de) if ordre == "pas-puis-de" else (annuler_le_de, annuler_le_pas)):
        geste()
    assert porte(atelier, p) == "fermee" and pion(atelier, p, "t-bertrand") == [1.5, 1.5]
    assert revelees(atelier, p) == {(x, y) for y in range(3) for x in range(3)}
    assert reserve(atelier) == (4, 0)
    # Le jeton dépensé ne revient pas seul (le MJ le rend d'un toucher) ; Léa lit son dé annulé.
    assert (heros_etat.etats_heros().get(aude) or {}).get("avantage") is None
    assert attendre(lambda: m["lea"].get("/api/jets").json()["dernier"]["public"]["aventure"].get("annule") is True)
    assert attendre(lambda: "SALLE-VAGUE-SIX" not in m["basile"].get("/api/table").text)
    # L'éditeur du MJ, resté sur une version d'avant, enregistre un texte : le pas et son annulation se rejouent sur sa
    # copie, sans conflit ; la porte reste fermée, la salle cachée, le pion à sa place, le texte du MJ gardé.
    ed = ed_avant if base == "avant-le-pas" else ed_apres
    ed["textes"] = [{"id": "t-mj", "texte": f"Éditeur {ordre} {base}", "x": 0, "y": 0, "taille": 1}]
    r = atelier.put(f"/api/plans/{p['id']}", json={**ed, "version_base": ed["modifie"]})
    assert r.status_code == 200, r.text
    assert [x["genre"] for x in r.json()["rejoues"]] == (["joueur", "annulation"] if base == "avant-le-pas" else ["annulation"])
    f = fiche_plan(atelier, p)
    assert next(d for d in f["portes"] if d["id"] == "porte-b")["etat"] == "fermee"
    assert pion(atelier, p, "t-bertrand") == [1.5, 1.5]
    assert revelees(atelier, p) == {(x, y) for y in range(3) for x in range(3)}
    assert f["textes"][0]["texte"] == f"Éditeur {ordre} {base}"
    assert attendre(lambda: next(x for x in m["basile"].get("/api/table").json()["vue"]["plan"]["portes"] if x["id"] == "porte-b")["etat"] == "fermee")
    # Le Tableau garde le dé annulé, une seule fois.
    x = next(x for x in atelier.get("/api/jets").json()["jets"] if x["id"] == jet["id"])
    assert x["aventure"]["annule"] is True
