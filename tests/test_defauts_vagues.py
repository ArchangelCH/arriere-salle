"""Les petits défauts relevés aux contrôles des vagues 5 et 6, un essai chacun : les écritures de
joueurs.json sous un verrou, la remise d'une version d'une fiche illustrée sous SAC_VERROU, la bibliothèque d'images
sans doublon, la ligne de la boîte d'une porte fermée à clé dite une fois, la table du coin republiée dès qu'un plan
montré est enregistré."""

import io
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
from PIL import Image  # noqa: E402

from ia import images_plan  # noqa: E402
import main  # noqa: E402
from api import application, config, heros_etat, illustrations_api, joueurs_mj, tv_etat, utilitaires  # noqa: E402
from commun import table_joueurs  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def attendu_sous(verrou, geste):
    """Lance geste() dans un fil pendant que ce fil-ci tient le verrou : vrai si le geste a attendu qu'il soit rendu."""
    fini = threading.Event()
    sortie = {}

    def lancer():
        sortie["r"] = geste()
        fini.set()

    with verrou:
        fil = threading.Thread(target=lancer)
        fil.start()
        attendu = not fini.wait(0.4)
    fil.join(10)
    return attendu and fini.is_set(), sortie.get("r")


# ---------------------------------------------------------------- joueurs.json

def test_les_ecritures_de_joueurs_json_attendent_leur_tour(client):
    """« Retirer » un joueur (un fil) et une invitation ou un lien (la boucle) ne s'écrasent plus : chacun lit et écrit
    joueurs.json sous VERROU_JOUEURS."""
    a = client.post("/api/joueurs", json={"nom": "Verrou Un"}).json()
    attendu, r = attendu_sous(joueurs_mj.VERROU_JOUEURS, lambda: client.delete(f"/api/joueurs/{a['id']}"))
    assert attendu and r.status_code == 200
    attendu, r = attendu_sous(joueurs_mj.VERROU_JOUEURS, lambda: client.post("/api/joueurs", json={"nom": "Verrou Deux"}))
    assert attendu and r.status_code == 200
    ident = r.json()["id"]
    # Des invitations et des retraits mêlés : aucun ne perd l'écriture d'un autre.
    gardes = []

    def inviter(i):
        gardes.append(client.post("/api/joueurs", json={"nom": f"Foule {i}"}).json()["id"])

    fils = [threading.Thread(target=inviter, args=(i,)) for i in range(8)]
    fils.append(threading.Thread(target=lambda: client.delete(f"/api/joueurs/{ident}")))
    for f in fils:
        f.start()
    for f in fils:
        f.join(20)
    presents = {j["id"] for j in joueurs_mj.joueurs_lus()}
    assert set(gardes) <= presents and ident not in presents
    acces = json.loads((config.PROPOSITIONS / ".acces.json").read_text(encoding="utf-8"))
    assert {j["id"] for j in acces["joueurs"]} == presents
    for g in gardes:
        client.delete(f"/api/joueurs/{g}")


# ---------------------------------------------------------------- la remise d'une version

def test_revenir_a_une_version_d_une_fiche_illustree_prend_sac_verrou(client):
    """Revenir à une version d'un PNJ, d'un lieu ou d'un aventurier (corbeille.py) attend SAC_VERROU, que prennent les fils
    qui écrivent ces fiches (boîte du MJ, portraits) : sinon l'une effaçait l'écriture de l'autre."""
    pnj = client.post("/api/pnj", json={"nom": "Version Verrou", "connu": True}).json()
    chemin = config.PNJ / f"{pnj['id']}.json"
    dossier = config.HISTORIQUE / "pnj" / pnj["id"]
    dossier.mkdir(parents=True, exist_ok=True)
    (dossier / "20260101-120000.json").write_text(json.dumps({**utilitaires.lire(chemin), "resume": "Ancienne version"}), encoding="utf-8")
    attendu, r = attendu_sous(heros_etat.SAC_VERROU, lambda: client.post(f"/api/versions/pnj/{pnj['id']}/20260101-120000/remettre"))
    assert attendu and r.status_code == 200 and utilitaires.lire(chemin)["resume"] == "Ancienne version"
    # Une fiche sans illustration (une idée) ne l'attend pas.
    idee = client.post("/api/idees", json={"titre": "Sans verrou", "texte": "rien"}).json()
    d = config.HISTORIQUE / "idees" / idee["id"]
    d.mkdir(parents=True, exist_ok=True)
    (d / "20260101-120000.json").write_text(json.dumps(utilitaires.lire(config.IDEES / f"{idee['id']}.json")), encoding="utf-8")
    attendu, r = attendu_sous(heros_etat.SAC_VERROU, lambda: client.post(f"/api/versions/idees/{idee['id']}/20260101-120000/remettre"))
    assert not attendu and r.status_code == 200
    # Remettre une fiche de la corbeille l'attend aussi.
    client.delete(f"/api/pnj/{pnj['id']}")
    attendu, r = attendu_sous(heros_etat.SAC_VERROU, lambda: client.post(f"/api/corbeille/pnj/{pnj['id']}/annuler"))
    assert attendu and r.status_code == 200 and chemin.exists()


def test_revenir_a_une_version_d_un_plan_prend_le_verrou_du_rejeu(client):
    plan = client.post("/api/plans", json={"nom": "Version du rejeu", "largeur": 2, "hauteur": 2, "pions": []}).json()
    d = config.HISTORIQUE / "plans" / plan["id"]
    d.mkdir(parents=True, exist_ok=True)
    (d / "20260101-120000.json").write_text(json.dumps(utilitaires.lire(config.PLANS / f"{plan['id']}.json")), encoding="utf-8")
    attendu, r = attendu_sous(tv_etat.mouvements_joueurs.verrou,
                              lambda: client.post(f"/api/versions/plans/{plan['id']}/20260101-120000/remettre"))
    assert attendu and r.status_code == 200


# ---------------------------------------------------------------- la bibliothèque d'images

def png(couleur=(200, 30, 30)) -> bytes:
    sortie = io.BytesIO()
    Image.new("RGBA", (24, 16), (*couleur, 255)).save(sortie, "PNG")
    return sortie.getvalue()


def test_une_image_importee_deux_fois_n_entre_qu_une_fois(client):
    """La même image importée deux fois (deux clics, la même image d'un autre nom) : une seule fiche, un seul fichier ;
    la réponse dit qu'elle y était déjà. Une autre image entre, elle."""
    avant = {x["id"] for x in client.get("/api/bibliotheque-images").json()["images"]}
    fichiers = set(config.IMAGES.iterdir())
    r1 = client.post("/api/bibliotheque-images", files={"image": ("table.png", png(), "image/png")}, data={"nom": "Table", "rayon": "Décors"})
    r2 = client.post("/api/bibliotheque-images", files={"image": ("autre-nom.png", png(), "image/png")}, data={"nom": "Autre", "rayon": "Pions"})
    assert r1.status_code == r2.status_code == 200
    assert r2.json()["id"] == r1.json()["id"] and r2.json().get("deja") is True and not r1.json().get("deja")
    apres = client.get("/api/bibliotheque-images").json()["images"]
    assert len([x for x in apres if x["id"] not in avant]) == 1
    assert len(set(config.IMAGES.iterdir()) - fichiers) == 1
    # Une image d'avant cette règle (sans empreinte notée) se reconnaît aussi, par son fichier.
    liste = json.loads(illustrations_api.BIBLIOTHEQUE_IMAGES.fichier.read_text(encoding="utf-8"))
    for x in liste["images"]:
        x.pop("empreinte", None)
    illustrations_api.BIBLIOTHEQUE_IMAGES.fichier.write_text(json.dumps(liste), encoding="utf-8")
    assert client.post("/api/bibliotheque-images", files={"image": ("t.png", png(), "image/png")}).json()["id"] == r1.json()["id"]
    r3 = client.post("/api/bibliotheque-images", files={"image": ("bleu.png", png((20, 20, 200)), "image/png")})
    assert r3.json()["id"] != r1.json()["id"] and not r3.json().get("deja")
    # L'empreinte reste dans l'atelier : la projection d'un plan ne porte que l'adresse /media/ (images_plan.objet_public).
    assert "empreinte" not in images_plan.objet_public({"cle": "image", "image": r1.json()["url"]}, lambda u: True)
    for x in (r1.json(), r3.json()):
        client.delete(f"/api/bibliotheque-images/{x['id']}")


def test_deux_imports_simultanes_de_la_meme_image(client):
    avant = len(client.get("/api/bibliotheque-images").json()["images"])
    reponses = []

    def importer():
        reponses.append(client.post("/api/bibliotheque-images", files={"image": ("x.png", png((10, 200, 10)), "image/png")}).json())

    fils = [threading.Thread(target=importer) for _ in range(4)]
    for f in fils:
        f.start()
    for f in fils:
        f.join(20)
    assert len({r["id"] for r in reponses}) == 1
    assert len(client.get("/api/bibliotheque-images").json()["images"]) == avant + 1
    client.delete(f"/api/bibliotheque-images/{reponses[0]['id']}")


# ---------------------------------------------------------------- la boîte : une porte fermée à clé

def test_une_porte_fermee_a_cle_n_est_dite_qu_une_fois_dans_la_boite():
    """La raison du refus (« Cette porte est fermée à clé. ») suit la ligne : la phrase de la tentative ne la redit pas.
    Une porte secrète ou un mur, que la raison tait (« un mur »), gardent leur phrase pour le MJ."""
    m = tv_etat.mouvements_joueurs
    j = {"id": "joueur-boite", "nom": "Aude"}
    d = {"id": "d-boite-1", "statut": "echec", "corps": {"depuis": [1, 1], "vers": [3, 1], "plan": "x", "pion": "p"}}
    for raison, dite in (("verrouillee", False), ("secrete", True), ("mur", True)):
        m.noter_tentative(d["id"], "plan-boite", raison, None)
        ligne = m.dire(j, d)
        assert ligne.startswith("Aude veut aller à 2 cases vers l'est.")
        assert ("fermée à clé" in ligne) is False
        assert (m.phrase_tentative({"raison": raison}) in ligne) is dite, (raison, ligne)


# ---------------------------------------------------------------- la table du coin suit l'éditeur

def test_la_table_du_coin_suit_un_plan_enregistre(client, monkeypatch):
    """Un plan que montre la TV, enregistré (PUT ou PATCH) sans que l'état de la TV change : la table du coin se republie
    dans la seconde, pas au secours des 30 secondes. Un plan qui n'est pas à la TV ne republie rien."""
    plan = client.post("/api/plans", json={"nom": "Suivi du coin", "largeur": 3, "hauteur": 2, "sol": [2] * 6, "piece": [1] * 6,
                                           "brouillard_actif": False, "pions": []}).json()
    autre = client.post("/api/plans", json={"nom": "Pas à la TV", "largeur": 3, "hauteur": 2, "pions": []}).json()
    client.put("/api/table-joueurs", json={"ouverte": True})
    client.put("/api/table", json={"vue": "plan", "plan": plan["id"], "style": "couleur"})
    time.sleep(0.6)
    publies = []
    vrai = tv_etat.table_coin.publier
    monkeypatch.setattr(tv_etat.table_coin, "publier", lambda: publies.append(time.monotonic()) or vrai())
    p = client.get(f"/api/plans/{autre['id']}").json()
    client.put(f"/api/plans/{autre['id']}", json={**p, "nom": "Toujours pas", "version_base": p["modifie"]})
    time.sleep(0.6)
    assert publies == []
    p = client.get(f"/api/plans/{plan['id']}").json()
    p.update(nom="Suivi du coin, retouché", version_base=p["modifie"])
    assert client.put(f"/api/plans/{plan['id']}", json=p).status_code == 200
    time.sleep(0.6)
    assert len(publies) == 1
    vue = table_joueurs.vue_publiee(config.PROPOSITIONS)
    assert vue and vue["genre"] == "plan"
    assert client.patch(f"/api/plans/{plan['id']}", json={"niveau": "cave"}).status_code == 200
    time.sleep(0.6)
    assert len(publies) == 2
    client.put("/api/table", json={"vue": "accueil"})
    client.put("/api/table-joueurs", json={"ouverte": False})


# ---------------------------------------------------------------- l'ordre des essais

def test_aucun_essai_n_impose_son_dossier_de_donnees():
    """main ne s'importe qu'une fois pour toute la suite : un essai qui impose DATA_DIR (au lieu de setdefault) écrit dans
    un dossier que main ne lit pas dès qu'un autre fichier l'a importé avant lui (test_api.py, avant un « test_a… »)."""
    import re
    ici = Path(__file__).resolve().parent
    imposent = [f.name for f in sorted(ici.glob("test_*.py"))
                if re.search(r"os\.environ\[\s*[\"']DATA_DIR[\"']\s*\]\s*=", f.read_text(encoding="utf-8"))]
    assert imposent == []


# ---------------------------------------------------------------- aucune mention d'IA dans l'interface

def test_aucune_mention_d_ia_dans_l_interface():
    """Règle d'Alban : l'interface ne parle ni d'IA ni d'un produit d'IA (« Habiller avec l'IA » est devenu « Habiller le
    plan »). Les commentaires du code ne comptent pas ici ; le filtre de l'aide à l'écriture (aide_mj.MACHINE) non plus."""
    import re
    statique = Path(__file__).resolve().parent.parent / "app" / "static"
    interdit = re.compile(r"\bIA\b|intelligence artificielle|ChatGPT|Gemini|Midjourney|\bClaude\b|Anthropic|mod[eè]le local")
    trouves = []
    for f in sorted([*statique.rglob("*.js"), *statique.rglob("*.html"), *(statique.parent).glob("*.html")]):
        if "tv" in f.relative_to(statique.parent).parts[:2]:
            continue
        for n, ligne in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            code = ligne.split("//", 1)[0] if not ligne.lstrip().startswith(("<", "`")) else ligne
            if ligne.lstrip().startswith(("//", "*", "/*")):
                continue
            if interdit.search(code):
                trouves.append(f"{f.name}:{n}")
    assert trouves == []


# ---------------------------------------------------------------- l'interface (essayée au navigateur : defauts-essais)

STATIQUE = Path(__file__).resolve().parent.parent / "app" / "static"


def bloc_au_doigt(css: str) -> str:
    """Le premier bloc @media (pointer: coarse) d'une feuille, accolades comprises."""
    debut = css.index("@media (pointer: coarse) {")
    profondeur, i = 0, css.index("{", debut)
    while True:
        profondeur += {"{": 1, "}": -1}.get(css[i], 0)
        if profondeur == 0:
            return css[debut:i + 1]
        i += 1


def test_les_petites_cibles_relevees_font_44_px_au_doigt():
    """Vagues 5 et 6 : le lien des réglages de la boîte (19 px), « Les 12 derniers » (28 px), les champs de nombre de
    l'onglet Table (40 px), « Supprimer » des cartes (20 px), les aides du Tableau, les liens du carnet dans le texte."""
    doigt = bloc_au_doigt((STATIQUE / "css" / "doigt.css").read_text(encoding="utf-8"))
    for regle in (".table-etat input[type=\"number\"] { min-height: 44px; }", ".reglages-boite a { padding: 13px 0; }",
                  "button.jets-plus { min-height: 44px; }", "button.ta-large { min-height: 44px; }",
                  ".fiche-carte .lien-danger { display: inline-flex; align-items: center; min-height: 44px;",
                  ".liste-joueurs .lien-danger { min-height: 44px;", ".inviter-joueur input { min-height: 44px; }",
                  ".entete-atelier .chercher-entete::after { content: \"\"; position: absolute; top: -10px; bottom: -10px;"):
        assert regle in doigt, regle
    # La barre des éditeurs passe sur deux lignes au doigt au-delà de 1 200 px (iPad Pro couché : « Accueil » sortait).
    assert "@media (min-width: 1201px) {\n    .barre-carte { flex-wrap: wrap;" in doigt
    carnet = bloc_au_doigt((STATIQUE / "css" / "carnet.css").read_text(encoding="utf-8"))
    assert ".vers-aide a, .compagnon .joueur a { padding: 11px 0; }" in carnet


def test_le_provisoire_se_dicte_sur_une_ligne_et_bouger_degage_le_heros():
    dialogue = (STATIQUE / "js" / "commun/dialogue.js").read_text(encoding="utf-8")
    assert 'dd.classList.add("a-la-ligne")' in dialogue and "px > 15" in dialogue
    css = (STATIQUE / "css" / "createur.css").read_text(encoding="utf-8")
    assert ".une-fois .a-dicter dd { white-space: nowrap; overflow: hidden; }" in css
    bouger = (STATIQUE / "js" / "joueurs" / "bouger.js").read_text(encoding="utf-8")
    assert bouger.count("this.degager();") == 2 and "  degager() {" in bouger
    assert "surCadre: () => {\n      auto = false;" in (STATIQUE / "js" / "joueurs" / "table-coin.js").read_text(encoding="utf-8")
