"""Les activités entre les séances (lot D, activites.py, activites_mj.py, jets.py) : le jet du serveur (une valeur envoyée
par le coin ne compte jamais), une activité par héros et par période, les critiques, l'or validé par le MJ vers la bourse
ou une cagnotte (accepté, modifié, refusé), les places limitées, et les fuites : ni formule, ni récit d'une autre issue, ni
note du MJ, ni inconnu, ni vérité de rumeur dans ce que lit le joueur ; un joueur n'agit pas pour un autre ; carnet
fermé, pause et Telegram."""
import asyncio
import hashlib
import json
import os
import random
import sys
import tempfile
import time
from collections import Counter
from datetime import date
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from commun import activites  # noqa: E402
from coin_mj import activites_mj  # noqa: E402
from coin_mj import boite as boite_mod  # noqa: E402
from commun import carnet  # noqa: E402
from commun import demandes  # noqa: E402
from commun import jets  # noqa: E402
import joueurs  # noqa: E402
from contenu import sanctuaire  # noqa: E402
from comptes_coin import entrer  # noqa: E402
import main  # noqa: E402
from api import actions_coin, application, carnet_api, config, heros_etat, joueurs_mj, refuge, utilitaires  # noqa: E402

NOTE = "NOTE-MJ-ACTIVITE"
RECIT_RC, RECIT_R, RECIT_E, RECIT_EC = "RECIT-CRITIQUE-OK", "RECIT-REUSSITE", "RECIT-ECHEC", "RECIT-CRITIQUE-KO"
FORMULE = "2D6 × 7"
VERITE = "VERITE-DE-LA-RUMEUR"
SECRETS = (NOTE, FORMULE, "Gorvak", "anfrel", VERITE, '"notes_mj"', '"issues"', '"recit_retenu"', '"proposition"', '"formule"')



def attendre(condition, delai=6.0):
    fin = time.monotonic() + delai
    while time.monotonic() < fin:
        r = condition()
        if r:
            return r
        time.sleep(0.05)
    return None


class Hasard:
    """Un hasard qui rend, dans l'ordre, les dés voulus (une face de 1 à n), puis recommence."""

    def __init__(self, *faces):
        self.faces = list(faces)
        self.i = 0

    def randbelow(self, n):
        f = self.faces[self.i % len(self.faces)]
        self.i += 1
        return min(f, n) - 1


class Seme:
    def __init__(self, graine):
        self.r = random.Random(graine)

    def randbelow(self, n):
        return self.r.randrange(n)


@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture(scope="module")
def tablee(atelier):
    """Aube (Ysolde Gris, Physique 60, Athlétisme +15, Artisanat (forge) +25) et Basile (Tavarède Lavelle) à la tablée, un
    PNJ inconnu, une rumeur et sa vérité, le carnet ouvert."""
    patch = pytest.MonkeyPatch()
    patch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    patch.setattr(joueurs, "COOKIE_SUR", False)
    patch.setattr(joueurs, "HOTES", set())
    patch.setattr(joueurs, "DEMANDES_FAITES", {})
    t = {"pnj": atelier.post("/api/pnj", json={"nom": "Gorvak Sombrefer", "connu": False}).json(),
         "rumeur": atelier.post("/api/rumeurs", json={"texte": "On dit que le puits chante", "etat": "entendue", "verite": "vraie",
                                                      "notes": VERITE}).json()}
    comps = [{"nom": "Athlétisme", "bonus": 15, "avec": "Physique"}, {"nom": "Artisanat (forge)", "bonus": 25, "avec": "Mental"},
             {"nom": "Lames", "bonus": -10, "avec": "Physique"}]
    for code, nom, heros, genre in (("a", "Aube", "Ysolde Gris", "f"), ("b", "Basile", "Tavarède Lavelle", "h")):
        invite = atelier.post("/api/joueurs", json={"nom": nom}).json()
        coin = TestClient(joueurs.app)
        entrer(coin, invite)
        coin.post("/api/moi/aventurier", json={"nom": heros, "genre": genre, "physique": 60, "social": 40, "mental": 50, "sante": 9, "psy": 5,
                                               "competences": comps, "equipement": ["Cape"], "objets": ["", "", ""], "or": 30})
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
    atelier.delete(f"/api/rumeurs/{t['rumeur']['id']}")
    atelier.put("/api/carnet-joueurs", json={"ouvert": avant})
    demandes.ecrire_pause(config.PROPOSITIONS, False)
    for f in (actions_coin.activites_mj.fichier, actions_coin.activites_mj.journal.fichier, actions_coin.activites_mj.tirages_fichier, refuge.SANCTUAIRE):
        f.unlink(missing_ok=True)
    carnet_api.publier_carnet()
    patch.undo()


def catalogue(**options):
    """Une activité d'essai, « Forger », Physique avec Athlétisme et Artisanat, -5, et des récits marqués pour chaque issue."""
    a = {"id": "forger", "nom": "Forger des clous", "texte": "Battre le fer pour le forgeron.", "carac": "physique",
         "competences": ["Athlétisme", "Artisanat"], "modificateur": -5, "places": None, "visible": True, "chantier": "",
         "notes_mj": NOTE,
         "issues": {"reussite-critique": {"or": FORMULE, "vers": "bourse", "recit": f"{RECIT_RC} {{prenom}} brille, {{il|elle}} est ravi{{|e}}."},
                    "reussite": {"or": "1D6 + 4", "vers": "bourse", "recit": f"{RECIT_R} pour {{prenom}}."},
                    "echec": {"or": "1D4", "vers": "bourse", "recit": f"{RECIT_E} pour {{prenom}}."},
                    "echec-critique": {"or": "0", "vers": "bourse", "recit": f"{RECIT_EC} pour {{prenom}}."}}}
    a.update(options.pop("activite", {}))
    autres = options.pop("autres", [])
    return {"ouvert": True, "periode": "semaine", "activites": [a, *autres]} | options


def poser(atelier, doc):
    actuel = atelier.get("/api/activites").json()
    r = atelier.put("/api/activites", json=doc | {"version_base": actuel["modifie"]})
    assert r.status_code == 200, r.text
    carnet_api.publier_carnet()
    return r.json()


@pytest.fixture()
def neuf(atelier, tablee):
    """Chaque essai part d'un catalogue connu, d'un journal vide, de bourses à 30 po, sans demande."""
    actions_coin.activites_mj.journal.fichier.unlink(missing_ok=True)
    actions_coin.activites_mj.fichier.unlink(missing_ok=True)
    actions_coin.activites_mj.tirages_fichier.unlink(missing_ok=True)
    for code in ("a", "b"):
        h = tablee[code]["heros"]
        f = atelier.get(f"/api/aventuriers/{h['id']}").json()
        atelier.patch(f"/api/aventuriers/{h['id']}/sac", json={"or": {"avant": heros_etat.sac_de(f, "or"), "apres": 30}})
        with demandes.verrou(config.PROPOSITIONS):
            demandes.fichier(config.PROPOSITIONS, tablee[code]["joueur"]["id"]).unlink(missing_ok=True)
    joueurs.DEMANDES_FAITES.clear()
    demandes.ecrire_pause(config.PROPOSITIONS, False)
    poser(atelier, catalogue())
    yield
    refuge.SANCTUAIRE.unlink(missing_ok=True)


def lu(t, code):
    return t[code]["coin"].get("/api/activites").json()


def ref(t, code="a", nom="Forger des clous"):
    return next(a["id"] for a in lu(t, code)["activites"] if a["nom"] == nom)


def choisir(t, code, **corps):
    return t[code]["coin"].post("/api/demandes", json={"genre": "activite", "corps": corps})


def la_demande(t, code, ident):
    return demandes.trouver(demandes.lire(config.PROPOSITIONS, t[code]["joueur"]["id"]), ident)


def jetee(t, code, ident):
    """La demande, une fois que l'atelier a jeté le dé (ou l'a mise en échec)."""
    d = attendre(lambda: (x := la_demande(t, code, ident)) and (x.get("fige") or x["statut"] == demandes.ECHEC) and x)
    assert d, "l'atelier n'a pas jeté le dé"
    return d


def ecrire_demande(t, code, corps, **en_plus):
    """Une demande écrite tout droit dans la file, comme un coin qui ne vérifierait rien."""
    d = demandes.nouvelle({"genre": "activite", "corps": {"activite": corps.get("activite"), "mot": ""}}) | en_plus
    d["corps"] = corps
    with demandes.verrou(config.PROPOSITIONS):
        jid = t[code]["joueur"]["id"]
        demandes.ecrire(config.PROPOSITIONS, jid, [*demandes.lire(config.PROPOSITIONS, jid), d])
    return d


def trancher(atelier, t, code, ident, **corps):
    d = la_demande(t, code, ident)
    return atelier.post(f"/api/activites/demandes/{t[code]['joueur']['id']}/{ident}/trancher", json={"version": d["version"], **corps})


def bourse(atelier, t, code):
    return atelier.get(f"/api/aventuriers/{t[code]['heros']['id']}").json()["or"]


def jouer(t, code, monkeypatch, *faces, activite_nom="Forger des clous", **corps):
    """Une activité choisie depuis le coin (« Forger des clous » sauf avis contraire), le dé de l'atelier réglé sur ces faces :
    rend la demande jetée."""
    monkeypatch.setattr(jets, "secrets", Hasard(*faces))
    r = choisir(t, code, activite=ref(t, code, activite_nom), **corps)
    assert r.status_code == 200, r.text
    return jetee(t, code, r.json()["id"])


# ---------------------------------------------------------------- le jet, seul

def test_le_de_du_serveur_sur_dix_mille_jets():
    fiche = {"physique": 60, "competences": [{"nom": "Athlétisme", "bonus": 15}]}
    hasard = Seme(20261108)
    jets_ = [jets.jet(fiche, "physique", ["Athlétisme"], -5, hasard=hasard) for _ in range(10_000)]
    assert {j["visee"] for j in jets_} == {70}
    des = Counter(j["de"] for j in jets_)
    assert min(des) == 1 and max(des) == 100 and len(des) == 100
    assert max(des.values()) < 160 and min(des.values()) > 50  # environ 100 par face
    issues = Counter(j["issue"] for j in jets_)
    reussis = issues["reussite"] + issues["reussite-critique"]
    assert 6750 <= reussis <= 7250, issues  # 70 % visés
    assert 400 <= issues["reussite-critique"] <= 600 and 400 <= issues["echec-critique"] <= 600
    assert all(j["reussi"] == (j["de"] <= 70) for j in jets_)
    # Le même hasard semé, le même tirage : le jet ne dépend que de la fiche et du dé.
    assert [j["de"] for j in jets_[:50]] == [jets.jet(fiche, "physique", ["Athlétisme"], -5, hasard=h)["de"]
                                             for h in [Seme(20261108)] for _ in range(50)]


def test_les_critiques_et_les_bornes():
    for de in range(1, 6):
        assert jets.issue(de, 0) == "reussite-critique" and jets.issue(de, -40) == "reussite-critique"
    for de in range(96, 101):
        assert jets.issue(de, 250) == "echec-critique"
    assert jets.issue(50, 50) == "reussite" and jets.issue(51, 50) == "echec" and jets.issue(6, 5) == "echec"
    assert jets.chances(150) == 95 and jets.chances(-20) == 5 and jets.chances(64) == 64


def test_la_posture_offensive_elargit_les_critiques():
    """01 à 10 et 91 à 100 en posture offensive, par des seuils passés en paramètre ; le focus et la défensive ne
    changent rien, et jet() ne lit jamais la posture sur la fiche (les activités gardent les seuils ordinaires)."""
    assert jets.seuils_de("offensive") == (10, 91) == jets.SEUILS_OFFENSIFS
    for posture in ("focus", "defensive", "", None, "Offensive", ["offensive"]):
        assert jets.seuils_de(posture) == (5, 96) == jets.SEUILS
    o = jets.SEUILS_OFFENSIFS
    for de in range(1, 11):
        assert jets.issue(de, -40, o) == "reussite-critique"
    for de in range(91, 101):
        assert jets.issue(de, 250, o) == "echec-critique"
    assert jets.issue(11, 10, o) == "echec" and jets.issue(11, 50, o) == "reussite" and jets.issue(90, 250, o) == "reussite"
    # Sans seuils, rien n'a changé : 06 à 10 et 91 à 95 restent ordinaires.
    assert jets.issue(8, 5) == "echec" and jets.issue(93, 250) == "reussite"
    assert jets.chances(150, o) == 90 and jets.chances(-20, o) == 10 and jets.chances(64, o) == 64
    # Une fiche en posture offensive, lancée sans seuils (une activité entre les séances) : les critiques ordinaires.
    fiche = {"physique": 50, "posture": "offensive"}
    assert jets.jet(fiche, "physique", hasard=Hasard(8))["issue"] == "reussite"
    assert jets.jet(fiche, "physique", hasard=Hasard(93))["issue"] == "echec"
    assert jets.jet(fiche, "physique", hasard=Hasard(8), seuils=o)["issue"] == "reussite-critique"
    assert jets.jet(fiche, "physique", hasard=Hasard(93), seuils=o)["issue"] == "echec-critique"


def test_la_valeur_visee_sur_la_fiche():
    fiche = {"physique": 60, "mental": 50, "competences": [{"nom": "Artisanat, fabriquer", "bonus": 15}, {"nom": "Artisanat (forge)", "bonus": 25},
                                                           {"nom": "Lames", "bonus": -10}, {"nom": "Esquive", "bonus": "beaucoup"}]}
    v = jets.visee(fiche, "physique", ["Artisanat", "Athlétisme"], 10)
    assert (v["base"], v["competence"], v["bonus"], v["modificateur"], v["visee"]) == (60, "Artisanat (forge)", 25, 10, 95)
    # Une compétence qui gêne ne s'emploie pas ; aucune qui aide : la caractéristique seule.
    assert jets.visee(fiche, "physique", ["Lames"])["visee"] == 60
    assert jets.visee(fiche, "mental", [])["visee"] == 50 and jets.visee({}, "social", ["Charme"])["visee"] == 0
    assert jets.visee(fiche, "mental", ["artisanat"], -300)["modificateur"] == -100
    with pytest.raises(ValueError):
        jets.visee(fiche, "chance")


def test_les_formules_d_or():
    lues = {t: (f["texte"] if (f := jets.formule(t)) else None) for t in ("10", "2d6", "1D6+4", "2D6 x 5", "2D6 × 3 + 1", "-1D6", "−10", "0",
                                                                        "2D", "3D7", "dix", "1D6 + ", "21D6", "", None, True)}
    assert lues == {"10": "10", "2d6": "2D6", "1D6+4": "1D6 + 4", "2D6 x 5": "2D6 × 5", "2D6 × 3 + 1": "2D6 × 3 + 1", "-1D6": "-1D6",
                    "−10": "-10", "0": "0", "2D": None, "3D7": None, "dix": None, "1D6 + ": None, "21D6": None, "": None, None: None, True: None}
    h = Seme(7)
    for _ in range(500):
        assert 2 <= jets.tirer("2D6", h)["total"] <= 12
        assert -6 <= jets.tirer("-1D6", h)["total"] <= -1
        assert jets.tirer("1D4 - 9", h)["total"] == 0
    assert jets.tirer("2D6 × 5", Hasard(3, 4)) == {"total": 35, "des": [3, 4], "texte": "2D6 × 5"}


def test_les_formules_communes_a_la_page():
    """Les cas que outils/verifier_formules.mjs passe aussi à la page du catalogue (js/activites/formule.js)."""
    cas = json.loads((Path(__file__).parent / "formules-cas.json").read_text(encoding="utf-8"))
    for texte, attendu in cas:
        f = jets.formule(texte)
        assert (f["texte"] if f else None) == attendu, texte


def test_le_recit_type_au_prenom_et_a_l_accord():
    modele = "{prenom} rentre fourbu{|e} : {il|elle} dort. {Prénom} ira mieux."
    assert activites_mj.raconter(modele, "Ysolde", "f") == "Ysolde rentre fourbue : elle dort. Ysolde ira mieux."
    assert activites_mj.raconter(modele, "Tavarède", "h") == "Tavarède rentre fourbu : il dort. Tavarède ira mieux."


def test_les_periodes():
    jeton = lambda c, i: hashlib.sha256(f"{c}/{i}".encode()).hexdigest()[:20]  # noqa: E731
    s = activites_mj.semaine(date(2026, 11, 11))
    assert s["cle"] == "semaine-2026-46" and s["libelle"] == "Semaine du lundi 9 au dimanche 15 novembre"
    assert activites_mj.semaine(date(2026, 12, 1))["libelle"] == "Semaine du lundi 30 novembre au dimanche 6 décembre"
    assert activites_mj.semaine(date(2026, 11, 15))["cle"] == s["cle"] != activites_mj.semaine(date(2026, 11, 16))["cle"]
    s1 = {"id": "s1", "numero": 1, "date": "2026-11-01", "close": True}
    s2 = {"id": "s2", "numero": 2, "date": "2026-11-07"}
    s3 = {"id": "s3", "numero": 3, "date": "2026-11-21"}
    avant = activites_mj.entre_deux_seances([s1, s2, s3], date(2026, 11, 7), jeton, "samedi 21 novembre à 18 h")
    apres = activites_mj.entre_deux_seances([s1, s2, s3], date(2026, 11, 8), jeton)
    assert avant["libelle"] == "Depuis la séance 1, jusqu'à samedi 21 novembre à 18 h" and apres["libelle"] == "Depuis la séance 2"
    assert avant["cle"] != apres["cle"] and "s1" not in avant["cle"] and "s2" not in apres["cle"]
    # Close le soir même : la période bascule tout de suite.
    assert activites_mj.entre_deux_seances([s1, s2 | {"close": True}], date(2026, 11, 7), jeton)["cle"] == apres["cle"]
    assert activites_mj.entre_deux_seances([], date(2026, 11, 7), jeton)["cle"] == "seance-debut"


# ---------------------------------------------------------------- fermé par défaut, le catalogue

def test_ferme_par_defaut_et_catalogue_de_depart(atelier, tablee):
    actions_coin.activites_mj.fichier.unlink(missing_ok=True)
    c = atelier.get("/api/activites").json()
    assert c["ouvert"] is False and c["modifie"] is None and len(c["activites"]) == 6
    assert all(jets.formule(i["or"]) for a in c["activites"] for i in a["issues"].values())
    assert {a["id"]: a["visible"] for a in c["activites"]}["sanctuaire"] is False
    carnet_api.publier_carnet()
    assert not (config.PROPOSITIONS / carnet.CARNET / "activites.json").exists()
    assert lu(tablee, "a") == {"ouvert": True, "visible": False}
    assert tablee["a"]["coin"].get("/api/carnet").json()["activites"] == []
    r = choisir(tablee, "a", activite="0" * 20)
    assert r.status_code == 409 and "pas ouvertes" in r.json()["detail"]


def test_le_catalogue_se_valide_et_se_garde(atelier, tablee, neuf):
    actuel = atelier.get("/api/activites").json()
    doc = catalogue(activite={"carac": "chance", "modificateur": 500, "places": 0, "visible": "oui", "competences": ["Lames", "lames", 3, "x" * 90],
                              "issues": {"reussite": {"or": "2D", "vers": "ailleurs", "recit": 5}}}, periode="mois")
    r = atelier.put("/api/activites", json=doc | {"version_base": actuel["modifie"]}).json()
    a = r["activites"][0]
    assert (a["carac"], a["modificateur"], a["places"], a["visible"], r["periode"]) == ("physique", 100, None, False, "semaine")
    assert a["competences"] == ["Lames", "x" * 60] and a["issues"]["reussite"] == {"or": "2D", "vers": "bourse", "recit": ""}
    assert atelier.get("/api/activites/etat").json()["formules"]["forger"]["reussite"] is False
    # Un autre écran est passé avant : 409, rien d'écrasé.
    assert atelier.put("/api/activites", json=doc | {"version_base": actuel["modifie"]}).status_code == 409


def test_une_caracteristique_illisible_dans_le_catalogue(atelier, tablee, neuf):
    """Une caractéristique qui n'est pas un texte (une liste, un objet) ne fait pas une erreur 500 : Physique par défaut."""
    for carac in (["mental"], {"mental": 1}, 3):
        doc = catalogue(activite={"carac": carac})
        actuel = atelier.get("/api/activites").json()
        r = atelier.put("/api/activites", json=doc | {"version_base": actuel["modifie"]})
        assert r.status_code == 200, r.text
        assert next(a for a in r.json()["activites"] if a["id"] == "forger")["carac"] == "physique"


def test_la_section_publiee_sans_or_ni_recit(atelier, tablee, neuf):
    s = lu(tablee, "a")
    assert s["visible"] is True and s["periode"]["cle"].startswith("semaine-")
    a = next(x for x in s["activites"] if x["nom"] == "Forger des clous")
    # Le tableau (19/11) : sa place au tableau, l'accroche d'une quête, les gains annoncés (rien, tant que le MJ ne le veut pas).
    assert set(a) == {"genre", "id", "nom", "texte", "carac", "carac_nom", "competences", "modificateur", "places", "restantes", "chances", "faite",
                      "offre", "accroche", "gains"}
    assert (a["offre"], a["accroche"], a["gains"]) == ("toujours", "", [])
    assert a["id"] != "forger" and len(a["id"]) == 20
    # Ses chances, sur sa fiche publiée : 60, plus Artisanat (forge) 25 (le meilleur bonus qui aide, quelle que soit sa caractéristique), moins 5.
    assert a["chances"]["visee"] == 80 and a["chances"]["competence"] == "Artisanat (forge)"
    fichier = (config.PROPOSITIONS / carnet.CARNET / "activites.json").read_text(encoding="utf-8")
    for secret in (*SECRETS, RECIT_RC, RECIT_R, "1D6 + 4", '"or"'):
        assert secret not in fichier and secret not in json.dumps(s, ensure_ascii=False), secret


# ---------------------------------------------------------------- le jet

def test_une_valeur_envoyee_par_le_coin_est_ignoree(atelier, tablee, neuf, monkeypatch):
    t = tablee
    monkeypatch.setattr(jets, "secrets", Hasard(99))
    r = choisir(t, "a", activite=ref(t), mot="Au marteau", de=1, visee=999, issue="reussite-critique", jet={"de": 1})
    assert r.status_code == 200, r.text
    assert r.json()["corps"] == {"activite": ref(t), "mot": "Au marteau"}
    d = jetee(t, "a", r.json()["id"])
    j = d["public"]["jet"]
    assert (j["de"], j["issue"], j["visee"]) == (99, "echec-critique", 80) and RECIT_EC in d["public"]["recit"]
    assert d["statut"] == "en-attente" and d["version"] == 2 and "Physique 80 %" in d["resultat"]
    # Un coin indiscipliné écrit lui-même un jet dans la file : l'atelier le jette de nouveau, sur sa fiche.
    monkeypatch.setattr(jets, "secrets", Hasard(40))
    faux = ecrire_demande(t, "b", {"activite": ref(t, "b"), "mot": "", "de": 1, "visee": 999}, fige=True,
                          public={"jet": {"de": 1, "issue": "reussite-critique", "visee": 999}, "recit": "Tout réussi"})
    d = jetee(t, "b", faux["id"])
    attendre(lambda: la_demande(t, "b", faux["id"])["public"]["jet"]["de"] == 40)
    d = la_demande(t, "b", faux["id"])
    assert d["corps"] == {"activite": ref(t, "b"), "mot": ""} and d["public"]["jet"]["de"] == 40 and RECIT_R in d["public"]["recit"]
    assert actions_coin.activites_mj.journal.jet(t["b"]["joueur"]["id"], faux["id"])["jet"]["de"] == 40


def test_le_carton_du_heros_compte_dans_ses_chances_et_son_jet(atelier, tablee, neuf, monkeypatch):
    """Choix d'Alban du 09/11 : le carton du moment (etats-heros.json, comme le Tableau) compte dans le jet d'une activité,
    jaune -10 sur la caractéristique cartonnée ; le joueur le lit dans ses chances et dans son jet."""
    t = tablee
    ident = t["a"]["heros"]["id"]
    assert atelier.patch(f"/api/etats-heros/{ident}", json={"cartons": {"physique": "jaune", "mental": "rouge"}}).status_code == 200
    try:
        carnet_api.publier_carnet()
        a = next(x for x in lu(t, "a")["activites"] if x["nom"] == "Forger des clous")
        # Physique 60, Artisanat (forge) +25, -5, carton jaune -10 ; le rouge en Mental ne touche pas une activité de Physique.
        assert (a["chances"]["visee"], a["chances"]["chances"]) == (70, 70)
        assert a["chances"]["ajustements"] == [{"libelle": "Carton jaune en Physique", "valeur": -10}]
        # Sans carton, 75 réussirait (80) : avec, il échoue, sur la fiche et l'état de l'atelier.
        d = jouer(t, "a", monkeypatch, 75)
        j = d["public"]["jet"]
        assert (j["de"], j["visee"], j["issue"]) == (75, 70, "echec") and RECIT_E in d["public"]["recit"]
        assert j["ajustements"] == [{"libelle": "Carton jaune en Physique", "valeur": -10}]
        assert "Physique 70 %" in d["resultat"]
        assert actions_coin.activites_mj.journal.jet(t["a"]["joueur"]["id"], d["id"])["jet"]["visee"] == 70
        # Basile n'a pas de carton : ses chances restent entières.
        b = next(x for x in lu(t, "b")["activites"] if x["nom"] == "Forger des clous")
        assert (b["chances"]["visee"], b["chances"]["ajustements"]) == (80, [])
    finally:
        atelier.patch(f"/api/etats-heros/{ident}", json={"cartons": {"physique": None, "mental": None}})
        carnet_api.publier_carnet()


def test_critiques_et_recit_de_l_issue(atelier, tablee, neuf, monkeypatch):
    t = tablee
    d = jouer(t, "a", monkeypatch, 3, 4, 5)
    assert d["public"]["jet"]["issue_nom"] == "Réussite critique"
    assert d["public"]["recit"] == f"{RECIT_RC} Ysolde brille, elle est ravie."
    e = actions_coin.activites_mj.journal.jet(t["a"]["joueur"]["id"], d["id"])
    assert e["proposition"] == {"formule": FORMULE, "lisible": True, "montant": 63, "des": [4, 5], "vers": "bourse", "chantier": ""}
    vu = lu(t, "a")["courantes"][0]
    assert vu["public"]["jet"]["de"] == 3 and vu["retirable"] is False and vu["statut_dit"] == "en attente du MJ"
    for secret in (*SECRETS, RECIT_R, RECIT_E, RECIT_EC):
        assert secret not in json.dumps(lu(t, "a"), ensure_ascii=False), secret
    # Le joueur ne retire pas un jet qui ne lui plaît pas.
    r = t["a"]["coin"].delete(f"/api/demandes/{d['id']}")
    assert r.status_code == 409 and "dé est jeté" in r.json()["detail"]


# ---------------------------------------------------------------- une par période

def test_chaque_activite_une_fois_par_periode_et_la_bascule(atelier, tablee, neuf, monkeypatch):
    t = tablee
    autre = catalogue()["activites"][0] | {"id": "chanter", "nom": "Chanter à la veillée"}
    poser(atelier, catalogue(autres=[autre]))
    d = jouer(t, "a", monkeypatch, 50, 2)
    # La même activité deux fois : non.
    r = choisir(t, "a", activite=ref(t))
    assert r.status_code == 409 and "déjà fait « Forger des clous » pour cette semaine" in r.json()["detail"]
    # Écrite tout droit dans la file (deux d'un coup, comme deux écrans) : l'atelier n'en jette aucune, la première l'a faite.
    deux = [ecrire_demande(t, "a", {"activite": ref(t), "mot": ""}) for _ in range(2)]
    for x in deux:
        e = jetee(t, "a", x["id"])
        assert e["statut"] == "echec" and "Ysolde a déjà fait « Forger des clous » pour cette semaine" in e["resultat"]
    # Une autre activité : oui, le héros peut toutes les faire, chacune une fois.
    faites = {a["nom"]: a["faite"] for a in lu(t, "a")["activites"]}
    assert faites == {"Forger des clous": True, "Chanter à la veillée": False}
    d_autre = jouer(t, "a", monkeypatch, 40, 3, activite_nom="Chanter à la veillée")
    assert d_autre["public"]["activite"] == "Chanter à la veillée"
    assert [x["id"] for x in lu(t, "a")["courantes"]] == [d_autre["id"], d["id"]]
    assert choisir(t, "a", activite=ref(t, nom="Chanter à la veillée")).status_code == 409
    # Validée ou non, la période est prise ; la semaine suivante, de nouveau libre.
    assert trancher(atelier, t, "a", d["id"], decision="valider", montant=5).status_code == 200
    assert choisir(t, "a", activite=ref(t)).status_code == 409

    class Lundi(date):
        @classmethod
        def today(cls):
            return cls(2099, 1, 5)

    monkeypatch.setattr(activites_mj, "date", Lundi)
    actions_coin.activites_mj.publier_section()
    assert lu(t, "a")["periode"]["libelle"] == "Semaine du lundi 5 au dimanche 11 janvier"
    assert lu(t, "a")["courantes"] == [] and lu(t, "a")["passees"][0]["id"] == d["id"]
    d2 = jouer(t, "a", monkeypatch, 20, 1)
    assert d2["statut"] == "en-attente" and d2["public"]["periode"] != d["public"]["periode"]


def test_entre_deux_seances(atelier, tablee, neuf, monkeypatch):
    t = tablee
    s = atelier.post("/api/seances", json={"nom": "Essai des activités", "numero": 41, "date": "2099-12-30"}).json()
    try:
        poser(atelier, catalogue(periode="seance"))
        p1 = lu(t, "a")["periode"]
        d = jouer(t, "a", monkeypatch, 30, 1)
        assert choisir(t, "a", activite=ref(t)).status_code == 409
        # Le MJ clôt la séance : une nouvelle période commence.
        atelier.patch(f"/api/seances/{s['id']}", json={"close": True})
        actions_coin.activites_mj.publier_section()
        p2 = lu(t, "a")["periode"]
        assert p2["cle"] != p1["cle"] and p2["libelle"].startswith("Depuis la séance 41") and s["id"] not in p2["cle"]
        assert jouer(t, "a", monkeypatch, 30, 1)["id"] != d["id"]
    finally:
        atelier.delete(f"/api/seances/{s['id']}")


def test_les_places_limitees(atelier, tablee, neuf, monkeypatch):
    t = tablee
    poser(atelier, catalogue(activite={"places": 1}))
    assert next(a for a in lu(t, "b")["activites"])["restantes"] == 1
    d = jouer(t, "a", monkeypatch, 50, 2)
    assert attendre(lambda: lu(t, "b")["activites"][0]["restantes"] == 0)
    r = choisir(t, "b", activite=ref(t, "b"))
    assert r.status_code == 409 and "Plus de place" in r.json()["detail"]
    x = jetee(t, "b", ecrire_demande(t, "b", {"activite": ref(t, "b"), "mot": ""})["id"])
    assert x["statut"] == "echec" and "Plus de place" in x["resultat"]
    assert lu(t, "b")["echec"]["id"] == x["id"]
    # Refusée en rendant son tour : la place se libère.
    assert trancher(atelier, t, "a", d["id"], decision="refuser", rendre=True).status_code == 200
    assert attendre(lambda: lu(t, "b")["activites"][0]["restantes"] == 1)
    assert jouer(t, "b", monkeypatch, 50, 2)["statut"] == "en-attente"


# ---------------------------------------------------------------- l'or, par le MJ

def test_or_vers_la_bourse_accepte_et_modifie(atelier, tablee, neuf, monkeypatch):
    t = tablee
    d = jouer(t, "a", monkeypatch, 40, 3)
    jid = t["a"]["joueur"]["id"]
    x = atelier.get(f"/api/activites/demandes/{jid}/{d['id']}").json()
    assert x["pret"] and x["proposition"]["montant"] == 7 and x["proposition"]["destination"] == "bourse"
    assert x["jet"]["de"] == 40 and x["heros"]["or"] == 30 and x["destinations"][0] == {"cle": "bourse", "nom": "La bourse de Ysolde", "detail": "30 po"}
    ligne = next(e for e in atelier.get("/api/demandes").json()["attente"] if e["id"] == d["id"])
    assert "réussite (40 pour 80)" in ligne["phrase"] and "7 po proposées pour sa bourse" in ligne["phrase"]
    # Le bouton commun de la boîte n'a pas de montant : refusé.
    r = atelier.post(f"/api/demandes/{jid}/{d['id']}/accepter", json={"version": d["version"]})
    assert r.status_code == 400 and "ouvrez-la" in r.json()["detail"]
    # Une version périmée : refusé ; la bonne, avec un montant changé par le MJ.
    r = atelier.post(f"/api/activites/demandes/{jid}/{d['id']}/trancher", json={"version": 1, "decision": "valider", "montant": 12})
    assert r.status_code == 409
    r = trancher(atelier, t, "a", d["id"], decision="valider", montant=12, vers="bourse", apprend="Le forgeron cherche un apprenti.",
                 mot="Bien joué")
    assert r.status_code == 200, r.text
    assert bourse(atelier, t, "a") == 42
    vu = la_demande(t, "a", d["id"])
    assert vu["statut"] == "acceptee" and vu["public"]["or"] == {"montant": 12, "vers": "bourse", "chantier": ""}
    assert vu["public"]["apprend"] == "Le forgeron cherche un apprenti." and vu["mot"] == "Bien joué"
    assert vu["resultat"] == "12 po dans la bourse de Ysolde."
    # « Mon héros » est déjà à jour quand le statut part.
    assert t["a"]["coin"].get("/api/carnet").json()["heros"]["or"] == 42
    assert trancher(atelier, t, "a", d["id"], decision="valider", montant=12).status_code == 409
    assert bourse(atelier, t, "a") == 42


def test_or_refuse_et_perte(atelier, tablee, neuf, monkeypatch):
    t = tablee
    d = jouer(t, "a", monkeypatch, 90, 2)
    assert trancher(atelier, t, "a", d["id"], decision="refuser", mot="Pas cette fois").status_code == 200
    vu = la_demande(t, "a", d["id"])
    assert vu["statut"] == "refusee" and vu["public"]["or"] is None and vu["public"]["rendu"] is False and bourse(atelier, t, "a") == 30
    assert choisir(t, "a", activite=ref(t)).status_code == 409  # la période reste prise
    d = jouer(t, "b", monkeypatch, 90, 2)
    r = trancher(atelier, t, "b", d["id"], decision="valider", montant=-40)
    assert r.status_code == 409 and "n'a que 30 po" in r.json()["detail"]
    assert trancher(atelier, t, "b", d["id"], decision="valider", montant=-10, vers="batiment:auberge").status_code in (400, 409)
    assert trancher(atelier, t, "b", d["id"], decision="valider", montant=-10).status_code == 200
    assert bourse(atelier, t, "b") == 20 and "perdues" in la_demande(t, "b", d["id"])["resultat"]


def test_or_vers_une_cagnotte(atelier, tablee, neuf, monkeypatch):
    t = tablee
    s = sanctuaire.nouveau_sanctuaire()
    s["joueurs"] = True
    s["batiments"].append({"id": "remise", "type": "maison", "nom": "La remise cachée", "niveau": 0, "ruine": False, "cache": True,
                           "x": 400, "y": 300, "cagnotte": 0, "versements": [], "notes_mj": "", "boutique": ""})
    utilitaires.ecrire(refuge.SANCTUAIRE, s | {"modifie": utilitaires.maintenant()})
    poser(atelier, catalogue(activite={"issues": {i: {"or": "10", "vers": "cagnotte", "recit": "Au chantier."} for i in jets.ISSUES}}))
    d = jouer(t, "a", monkeypatch, 40)
    jid = t["a"]["joueur"]["id"]
    x = atelier.get(f"/api/activites/demandes/{jid}/{d['id']}").json()
    assert x["proposition"]["destination"] == "batiment:auberge"
    assert {y["cle"] for y in x["destinations"]} >= {"bourse", "batiment:auberge", "batiment:remise"}
    trop = trancher(atelier, t, "a", d["id"], decision="valider", montant=500, vers="batiment:auberge")
    assert trop.status_code == 409 and "Il ne manque que" in trop.json()["detail"]
    assert trancher(atelier, t, "a", d["id"], decision="valider", montant=12, vers="batiment:auberge").status_code == 200
    b = next(x for x in refuge.lire_sanctuaire()["batiments"] if x["id"] == "auberge")
    assert b["cagnotte"] == 12 and b["versements"][-1]["nom"] == "Ysolde Gris" and b["versements"][-1]["don"] is True
    assert bourse(atelier, t, "a") == 30  # aucune bourse débitée
    # « Rendre » ce don dans l'onglet Sanctuaire : il quitte la cagnotte sans rien créditer (il n'était sorti d'aucune bourse).
    vid = b["versements"][-1]["id"]
    rendu = atelier.delete(f"/api/sanctuaire/versements/{vid}")
    assert rendu.status_code == 200 and rendu.json()["rendu"]["don"] is True
    assert bourse(atelier, t, "a") == 30
    assert next(x for x in refuge.lire_sanctuaire()["batiments"] if x["id"] == "auberge")["cagnotte"] == 0
    # Le même don, rendu au MJ : on le redonne pour la suite du test.
    refuge.verser_don("auberge", t["a"]["heros"]["id"], 12, "Ysolde Gris")
    assert "Ysolde" in [x["nom"] for x in sanctuaire.sanctuaire_public(refuge.lire_sanctuaire())["batiments"][0]["donateurs"]]
    vu = la_demande(t, "a", d["id"])
    assert vu["public"]["or"] == {"montant": 12, "vers": "cagnotte", "chantier": "l'auberge"} and "au sanctuaire" in vu["resultat"]
    # Vers un chantier caché : le joueur lit « un chantier », jamais son nom.
    d = jouer(t, "b", monkeypatch, 40)
    assert trancher(atelier, t, "b", d["id"], decision="valider", montant=5, vers="batiment:remise").status_code == 200
    vu = json.dumps(t["b"]["coin"].get("/api/activites").json(), ensure_ascii=False)
    assert "remise" not in vu.lower() and "un chantier" in vu


# ---------------------------------------------------------------- les fuites, un joueur pour un autre

def test_aucun_secret_dans_ce_que_lit_le_joueur(atelier, tablee, neuf, monkeypatch):
    t = tablee
    poser(atelier, catalogue(activite={"issues": {"reussite": {"or": "5", "vers": "bourse", "recit": "{prenom} croise Gorvak Sombrefer."},
                                                  "reussite-critique": {"or": FORMULE, "vers": "bourse", "recit": RECIT_RC}}},
                             autres=[{"id": "cachee", "nom": "Activité CACHEE-AUX-JOUEURS", "visible": False, "carac": "mental"},
                                     {"id": "gorvak", "nom": "Chez Gorvak", "visible": True, "carac": "mental"}]))
    s = lu(t, "a")
    assert [a["nom"] for a in s["activites"]] == ["Forger des clous"]
    d = jouer(t, "a", monkeypatch, 40)
    assert d["public"]["recit"] == activites_mj.SANS_RECIT
    x = atelier.get(f"/api/activites/demandes/{t['a']['joueur']['id']}/{d['id']}").json()
    assert "Gorvak Sombrefer" in x["recit_retenu"]
    r = trancher(atelier, t, "a", d["id"], decision="valider", montant=5, apprend="Gorvak cherche la petite.")
    assert r.status_code == 409 and "Gorvak Sombrefer" in r.json()["detail"]
    r = trancher(atelier, t, "a", d["id"], decision="valider", montant=5, apprend="Le puits chante la nuit, à la Petite Fanfrelée.")
    assert r.status_code == 200
    lus = [lu(t, "a"), t["a"]["coin"].get("/api/carnet").json(), t["a"]["coin"].get("/api/demandes").json(),
           t["b"]["coin"].get("/api/activites").json()]
    fichiers = [p.read_text(encoding="utf-8") for p in (config.PROPOSITIONS / carnet.CARNET).glob("*.json")]
    fichiers.append(demandes.fichier(config.PROPOSITIONS, t["a"]["joueur"]["id"]).read_text(encoding="utf-8"))
    for texte in [json.dumps(x, ensure_ascii=False) for x in lus] + fichiers:
        for secret in (*SECRETS, RECIT_RC, "CACHEE-AUX-JOUEURS", '"proposition"', '"activite_nom"', '"competence_mj"'):
            assert secret not in texte, secret
    assert "Fanfrelée" not in la_demande(t, "a", d["id"])["public"]["apprend"]


def test_un_joueur_n_agit_pas_pour_un_autre(atelier, tablee, neuf, monkeypatch):
    t = tablee
    d = jouer(t, "a", monkeypatch, 40, 2)
    # Basile ne lit ni ne retire l'activité d'Aube, ne la tranche pas ; la sienne se jette sur son héros à lui.
    assert all(x["id"] != d["id"] for x in t["b"]["coin"].get("/api/demandes").json()["demandes"])
    assert lu(t, "b")["courantes"] == []
    assert t["b"]["coin"].delete(f"/api/demandes/{d['id']}").status_code == 404
    assert t["b"]["coin"].post(f"/api/activites/demandes/{t['a']['joueur']['id']}/{d['id']}/trancher", json={}).status_code in (404, 405)
    r = choisir(t, "b", activite=ref(t, "b"), heros=t["a"]["heros"]["id"], joueur=t["a"]["joueur"]["id"])
    e = actions_coin.activites_mj.journal.jet(t["b"]["joueur"]["id"], jetee(t, "b", r.json()["id"])["id"])
    assert e["heros"] == t["b"]["heros"]["id"]
    # Le MJ, lui, ne tranche pas l'activité d'Aube sous le nom de Basile.
    r = atelier.post(f"/api/activites/demandes/{t['b']['joueur']['id']}/{d['id']}/trancher", json={"version": d["version"], "decision": "valider"})
    assert r.status_code == 404


def test_carnet_ferme_pause_et_telegram(atelier, tablee, neuf, monkeypatch, tmp_path):
    t = tablee
    jeton = ref(t)
    atelier.put("/api/carnet-joueurs", json={"ouvert": False})
    try:
        assert lu(t, "a") == {"ouvert": False}
        r = choisir(t, "a", activite=jeton)
        assert r.status_code == 423 and "fermé" in r.json()["detail"]
        # Écrite quand même dans la file : l'atelier ne jette pas le dé carnet fermé.
        x = jetee(t, "a", ecrire_demande(t, "a", {"activite": jeton, "mot": ""})["id"])
        assert x["statut"] == "echec" and "fermé" in x["resultat"]
    finally:
        atelier.put("/api/carnet-joueurs", json={"ouvert": True})
    atelier.put("/api/demandes/reglages", json={"pause": True})
    try:
        r = choisir(t, "a", activite=jeton)
        assert r.status_code == 423 and r.headers["X-Coin-En-Pause"] == "1" and lu(t, "a")["pause"] is True
    finally:
        atelier.put("/api/demandes/reglages", json={"pause": False})
    g = demandes.GENRES["activite"]
    assert g.attente and g.carnet and not g.silencieux and not g.annulable
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

    asyncio.run(vague())
    jouer(t, "a", monkeypatch, 40, 2, mot="SECRET-DU-JOUEUR")
    message = asyncio.run(vague())
    assert len(message) == 1 and "Aube</b> : une activité entre les séances." in message[0] and "SECRET-DU-JOUEUR" not in message[0]


# ---------------------------------------------------------------- le tableau de la semaine (19/11)

RESERVE = [{"id": f"reserve-{k}", "nom": f"Offre {k.upper()}", "texte": f"Texte de l'offre {k}.", "carac": "social", "competences": [],
            "modificateur": 0, "places": None, "visible": True, "rythme": "souvent",
            "issues": {i: {"or": "1", "vers": "bourse", "recit": f"Récit {k}."} for i in jets.ISSUES}} for k in "abcde"]
QUETE = {"id": "quete-du-puits", "nom": "Descendre au puits", "texte": "Une semaine seulement.", "carac": "mental", "competences": [],
         "modificateur": -10, "places": 2, "visible": True, "unique": True, "accroche": "Tirée de la rumeur du puits",
         "gains": ["or", "rumeur"], "issues": {i: {"or": "0", "vers": "bourse", "recit": "Au puits."} for i in jets.ISSUES}}


def tableau(t, code="a"):
    return {a["nom"]: a for a in lu(t, code)["activites"]}


def tirer(atelier, doc, graine=1):
    """Le catalogue posé, puis le tirage de la période fait avec un hasard semé, et la section republiée."""
    poser(atelier, doc)
    actions_coin.activites_mj.tirages_fichier.unlink(missing_ok=True)
    o = actions_coin.activites_mj.offre(hasard=Seme(graine))
    carnet_api.publier_carnet()
    return o


def test_un_catalogue_d_avant_garde_tout_son_tableau(atelier, tablee, neuf):
    """Sans rythme, une activité est de chaque semaine : le tableau est celui d'avant, et le jeu ne change pas."""
    t = tablee
    poser(atelier, catalogue(autres=[{"id": "veiller", "nom": "Veiller", "texte": "", "carac": "mental", "competences": [], "modificateur": 0,
                                      "places": None, "visible": True, "issues": catalogue()["activites"][0]["issues"]}]))
    vus = tableau(t)
    assert set(vus) == {"Forger des clous", "Veiller"} and {a["offre"] for a in vus.values()} == {"toujours"}
    assert lu(t, "a")["periode"]["renouvellement"] == ""  # rien ne tourne : le coin ne promet pas de nouvelles affiches
    c = atelier.get("/api/activites").json()
    assert c["offres"] == 3 and c["annoncer_gains"] is False and {a["rythme"] for a in c["activites"]} == {"toujours"}


def test_le_tirage_tient_toute_la_periode(atelier, tablee, neuf, monkeypatch):
    t = tablee
    o = tirer(atelier, catalogue(offres=2, autres=RESERVE))
    tirees = [i for i in o["ids"] if o["genres"][i] == "tiree"]
    assert len(tirees) == 2 and o["genres"]["forger"] == "toujours" and o["tourne"] is True
    vus = tableau(t)
    assert len(vus) == 3 and "Forger des clous" in vus and lu(t, "a")["periode"]["renouvellement"].startswith("lundi ")
    # Relu, avec un autre hasard, ou par un atelier qui redémarre (le fichier fait foi) : le même tableau.
    assert actions_coin.activites_mj.offre(hasard=Seme(99))["ids"] == o["ids"]
    neuf_mj = activites_mj.ActivitesMJ.__new__(activites_mj.ActivitesMJ)
    neuf_mj.__dict__.update(actions_coin.activites_mj.__dict__)
    assert neuf_mj.offre()["ids"] == o["ids"]
    # Rien de ce qui n'est pas tiré ne sort vers le coin : ni son nom, ni son texte, ni son jeton.
    absentes = [a for a in RESERVE if a["id"] not in tirees]
    publie = "".join(f.read_text(encoding="utf-8") for f in config.PROPOSITIONS.rglob("*.json"))
    for a in absentes:
        for secret in (a["nom"], a["texte"], actions_coin.activites_mj.jeton("activites", a["id"])):
            assert secret not in publie and secret not in json.dumps(lu(t, "a"), ensure_ascii=False), secret
    # Le jeton d'une activité de la réserve, envoyé tout droit : le dé n'est pas jeté.
    absente = actions_coin.activites_mj.jeton("activites", absentes[0]["id"])
    x = jetee(t, "a", ecrire_demande(t, "a", {"activite": absente, "mot": ""})["id"])
    assert x["statut"] == "echec" and "plus au tableau" in x["resultat"]


def test_retoucher_la_reserve_ne_change_pas_le_tableau(atelier, tablee, neuf):
    t = tablee
    o = tirer(atelier, catalogue(offres=2, autres=RESERVE))
    tirees = [i for i in o["ids"] if o["genres"][i] == "tiree"]
    reste = [a["id"] for a in RESERVE if a["id"] not in tirees]
    avant = tableau(t)
    doc = catalogue(offres=4, autres=[a | ({"rythme": "rarement"} if a["id"] in tirees else {}) for a in RESERVE])
    poser(atelier, doc)
    assert tableau(t).keys() == avant.keys()  # le rythme change, le tableau de la période non
    # Forger passe de chaque semaine à souvent : elle reste au tableau de cette période.
    doc["activites"][0]["rythme"] = "souvent"
    poser(atelier, doc)
    assert tableau(t).keys() == avant.keys()
    # Cachée, une offre tirée sort aussitôt ; une activité passée « chaque semaine » entre aussitôt.
    for a in doc["activites"]:
        if a["id"] == tirees[0]:
            a["visible"] = False
        if a["id"] == reste[0]:
            a["rythme"] = "toujours"
    poser(atelier, doc)
    vus = tableau(t)
    nom = {a["id"]: a["nom"] for a in RESERVE}
    assert nom[tirees[0]] not in vus and vus[nom[reste[0]]]["offre"] == "toujours" and nom[tirees[1]] in vus


def test_la_quete_unique_ne_revient_pas(atelier, tablee, neuf, monkeypatch):
    t = tablee
    tirer(atelier, catalogue(annoncer_gains=True, autres=[QUETE]))
    q = tableau(t)["Descendre au puits"]
    assert (q["offre"], q["accroche"], q["gains"], q["places"], q["restantes"]) == ("quete", "Tirée de la rumeur du puits", ["or", "rumeur"], 2, 2)
    assert lu(t, "a")["activites"][0]["nom"] == "Descendre au puits"  # la quête en tête du tableau
    # La période suivante : la quête ne revient pas.
    class Demain(date):
        @classmethod
        def today(cls):
            return date.today() + __import__("datetime").timedelta(days=7)
    monkeypatch.setattr(activites_mj, "date", Demain)
    carnet_api.publier_carnet()
    assert "Descendre au puits" not in tableau(t) and "Forger des clous" in tableau(t)
    # Une accroche qui nomme un inconnu des joueurs ne part pas.
    monkeypatch.undo()
    actions_coin.activites_mj.tirages_fichier.unlink(missing_ok=True)
    poser(atelier, catalogue(autres=[QUETE | {"accroche": "À la demande de Gorvak Sombrefer"}]))
    assert tableau(t)["Descendre au puits"]["accroche"] == ""
    assert "Gorvak" not in (config.PROPOSITIONS / carnet.CARNET / "activites.json").read_text(encoding="utf-8")


def test_le_mj_change_le_tableau(atelier, tablee, neuf, monkeypatch):
    t = tablee
    o = tirer(atelier, catalogue(offres=1, autres=RESERVE))
    tiree = next(i for i in o["ids"] if o["genres"][i] == "tiree")
    r = atelier.post("/api/activites/tableau", json={"action": "changer", "activite": tiree})
    assert r.status_code == 200, r.text
    neuve = [i for i in r.json()["tableau"]["ids"] if i not in o["ids"]]
    assert len(neuve) == 1 and tiree not in r.json()["tableau"]["ids"]
    nom = {a["id"]: a["nom"] for a in RESERVE}
    assert nom[neuve[0]] in tableau(t) and nom[tiree] not in tableau(t)
    # Ajouter une activité de la réserve, la retirer ; mais une offre jouée reste.
    autre = next(a["id"] for a in RESERVE if a["id"] not in (tiree, neuve[0]))
    assert atelier.post("/api/activites/tableau", json={"action": "ajouter", "activite": autre}).status_code == 200
    assert nom[autre] in tableau(t)
    assert atelier.post("/api/activites/tableau", json={"action": "retirer", "activite": autre}).status_code == 200
    assert nom[autre] not in tableau(t)
    jouer(t, "a", monkeypatch, 40, 3)
    r = atelier.post("/api/activites/tableau", json={"action": "changer", "activite": "forger"})
    assert r.status_code == 409 and "déjà jouée" in r.json()["detail"]
    assert atelier.post("/api/activites/tableau", json={"action": "rien", "activite": "forger"}).status_code == 400


def test_un_objet_rejoint_le_sac_avec_l_or(atelier, tablee, neuf, monkeypatch):
    t = tablee
    # Refusée : l'objet ne compte pas.
    d = jouer(t, "a", monkeypatch, 40, 3)
    assert trancher(atelier, t, "a", d["id"], decision="refuser", objet="Lanterne").status_code == 200
    assert "Lanterne" not in atelier.get(f"/api/aventuriers/{t['a']['heros']['id']}").json()["equipement"]
    d = jouer(t, "b", monkeypatch, 40, 3)
    r = trancher(atelier, t, "b", d["id"], decision="valider", montant=5, objet="Un clou de Gorvak Sombrefer")
    assert r.status_code == 409 and "Gorvak" in r.json()["detail"]
    r = trancher(atelier, t, "b", d["id"], decision="valider", montant=5, objet="  Une   lanterne sourde ")
    assert r.status_code == 200, r.text
    fiche = atelier.get(f"/api/aventuriers/{t['b']['heros']['id']}").json()
    assert fiche["or"] == 35 and fiche["equipement"][-1] == "Une lanterne sourde"
    vu = la_demande(t, "b", d["id"])
    assert vu["public"]["objet"] == "Une lanterne sourde" and "rejoint son sac" in vu["resultat"]


def test_un_objet_seul_ou_avec_une_cagnotte(atelier, tablee, neuf, monkeypatch):
    t = tablee
    s = sanctuaire.nouveau_sanctuaire()
    s["joueurs"] = True
    utilitaires.ecrire(refuge.SANCTUAIRE, s | {"modifie": utilitaires.maintenant()})
    equipement = lambda code: atelier.get(f"/api/aventuriers/{t[code]['heros']['id']}").json()["equipement"]  # noqa: E731
    # Sans or : l'objet seul, et une phrase courte même pour un objet long (la file borne le résultat).
    long_ = "Une boîte à musique gravée " + "de lierre " * 27
    d = jouer(t, "a", monkeypatch, 40, 3)
    assert trancher(atelier, t, "a", d["id"], decision="valider", montant=0, objet=long_).status_code == 200
    vu = la_demande(t, "a", d["id"])
    assert equipement("a")[-1] == " ".join(long_.split())[:300].strip() and bourse(atelier, t, "a") == 30
    assert vu["public"]["or"] is None and vu["resultat"].endswith("Un objet rejoint son sac.")
    # Avec une cagnotte : l'or au chantier, l'objet au sac.
    d = jouer(t, "b", monkeypatch, 40, 3)
    assert trancher(atelier, t, "b", d["id"], decision="valider", montant=6, vers="batiment:auberge", objet="Une truelle").status_code == 200
    assert equipement("b")[-1] == "Une truelle" and bourse(atelier, t, "b") == 30
    assert next(x for x in refuge.lire_sanctuaire()["batiments"] if x["id"] == "auberge")["cagnotte"] == 6
    # Le chantier refuse (introuvable) : l'objet ne reste pas dans le sac, rien n'est tranché.
    actions_coin.activites_mj.journal.fichier.unlink(missing_ok=True)
    with demandes.verrou(config.PROPOSITIONS):
        demandes.fichier(config.PROPOSITIONS, t["b"]["joueur"]["id"]).unlink(missing_ok=True)
    d = jouer(t, "b", monkeypatch, 40, 3)
    avant = equipement("b")
    r = trancher(atelier, t, "b", d["id"], decision="valider", montant=6, vers="batiment:introuvable", objet="Une pelle")
    assert r.status_code == 409 and equipement("b") == avant and la_demande(t, "b", d["id"])["statut"] == "en-attente"


def test_les_reglages_gardent_la_reserve_et_le_tableau_attend_l_ouverture(atelier, tablee, neuf):
    poser(atelier, catalogue(offres=2, annoncer_gains=True, autres=[RESERVE[0], QUETE]))
    # Les Réglages renvoient le catalogue lu, l'interrupteur changé : la réserve garde ses rythmes et ses réglages.
    doc = atelier.get("/api/activites").json()
    r = atelier.put("/api/activites", json={**doc, "ouvert": False, "version_base": doc["modifie"]})
    c = r.json()
    assert r.status_code == 200 and c["offres"] == 2 and c["annoncer_gains"] is True
    assert {a["id"]: (a["rythme"], a["unique"]) for a in c["activites"]} == {"forger": ("toujours", False), "reserve-a": ("souvent", False),
                                                                             "quete-du-puits": ("toujours", True)}
    # Fermées : aucun tirage ne s'écrit, la quête n'est pas usée ; le MJ ne change pas un tableau qui n'est pas tiré.
    actions_coin.activites_mj.tirages_fichier.unlink(missing_ok=True)
    assert atelier.get("/api/activites/etat").json()["tableau"]["ids"] == ["forger"]
    assert not actions_coin.activites_mj.tirages_fichier.exists()
    assert atelier.post("/api/activites/tableau", json={"action": "ajouter", "activite": "reserve-a"}).status_code == 409
    # Rouvertes : le tableau se tire, la quête y est.
    doc = atelier.get("/api/activites").json()
    atelier.put("/api/activites", json={**doc, "ouvert": True, "version_base": doc["modifie"]})
    assert "quete-du-puits" in atelier.get("/api/activites/etat").json()["tableau"]["ids"]


def test_une_reserve_d_une_centaine_tient_entiere(atelier, tablee, neuf):
    """Une réserve de 120 activités, toutes tirables, et 7 offres par période : rien n'est coupé à l'enregistrement ni à la
    relecture, et le tableau en tire exactement 7."""
    autres = [RESERVE[0] | {"id": f"pioche-{k:03d}", "nom": f"Pioche {k:03d}"} for k in range(119)]
    c = poser(atelier, catalogue(offres=7, autres=autres))
    assert len(c["activites"]) == 120 and c["offres"] == 7
    lu_ = atelier.get("/api/activites").json()
    assert [a["id"] for a in lu_["activites"]] == ["forger"] + [a["id"] for a in autres]
    actions_coin.activites_mj.tirages_fichier.unlink(missing_ok=True)
    o = actions_coin.activites_mj.offre(hasard=Seme(3))
    assert sum(1 for g in o["genres"].values() if g == "tiree") == 7 and o["genres"]["forger"] == "toujours"

