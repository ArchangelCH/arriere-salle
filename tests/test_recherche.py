"""« Chercher » dans l'atelier (recherche.py, js/chercher/) : un index léger, lu d'un coup, fermé à la table publique et
absent du coin des joueurs ; le moteur de « Lier une fiche », mis en commun et non copié ; les touches « / », ⌘K et ⌘F
lues par le code et déclarées sur la carte des touches ; le comptoir des boutiques. Le moteur lui-même se vérifie avec
node outils/verifier_recherche.mjs."""

import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import joueurs  # noqa: E402
import main  # noqa: E402
from api import application, config, portier, tv_cartes  # noqa: E402
from sources_front import source_page  # noqa: E402

APP = Path(__file__).resolve().parent.parent / "app"
STATIQUE = APP / "static"
JS = STATIQUE / "js"
CF = {"CF-Connecting-IP": "203.0.113.7"}


def lire(chemin):
    return (STATIQUE / chemin).read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def test_l_index_donne_les_textes_et_rien_de_lourd(client):
    p = client.post("/api/pnj", json={"nom": "Gaspard Tourbe", "role": "Meunier", "voix": "Il chuchote quand il ment.",
                                      "secret": "Payé en or neuf.", "illustrations": [], "connu": False}).json()
    plan = client.post("/api/plans", json={"nom": "Le moulin", "largeur": 3, "hauteur": 2, "sol": [1] * 6, "brouillard": [1] * 6,
                                           "pieces": [{"id": 1, "nom": "La meule", "notes": "Sous la meule, l'or."}]}).json()
    s = client.post("/api/scenarios", json={"nom": "Les cendres", "chapitres": [{"id": "c-un", "titre": "Le prix", "texte": "payé en or neuf"}],
                                            "corbeille": [{"titre": "jeté", "texte": "rien"}]}).json()
    ix = client.get("/api/recherche").json()
    assert set(ix) == {"pnj", "lieux", "plans", "rencontres", "cartes", "boutiques", "aventuriers", "contrats", "rumeurs", "seances",
                       "regles", "idees", "scenarios", "documents"}
    gaspard = next(x for x in ix["pnj"] if x["id"] == p["id"])
    assert gaspard["voix"] == "Il chuchote quand il ment." and gaspard["connu"] is False and "illustrations" not in gaspard
    moulin = next(x for x in ix["plans"] if x["id"] == plan["id"])
    assert moulin["pieces"] == [{"nom": "La meule", "notes": "Sous la meule, l'or."}]
    assert "sol" not in moulin and "brouillard" not in moulin
    cendres = next(x for x in ix["scenarios"] if x["id"] == s["id"])
    assert cendres["chapitres"] == [{"id": "c-un", "titre": "Le prix", "texte": "payé en or neuf"}]
    assert "corbeille" not in cendres and "reponses" not in cendres and "relectures" not in cendres
    # Une carte ne donne que son nom et ses étiquettes, jamais son terrain.
    for c in ix["cartes"]:
        assert set(c) <= {"id", "modifie", "nom", "etiquettes"}


def test_un_champ_illisible_est_passe():
    from contenu import recherche
    fiche = {"id": "x", "modifie": 3, "nom": "Ok", "voix": {"pas": "un texte"}, "notes": None, "objets": ["a", 2, None, "b"],
             "pieces": [{"nom": "Salle", "notes": ["liste"]}, "pas un objet"]}
    leger = recherche.leger(fiche, ("nom", "voix", "notes", "objets", ("pieces", ("nom", "notes"))))
    assert leger == {"id": "x", "modifie": None, "nom": "Ok", "objets": ["a", "b"], "pieces": [{"nom": "Salle"}]}


def test_la_recherche_est_fermee_a_la_table_publique_et_au_coin_des_joueurs(client, monkeypatch):
    assert client.get("/api/recherche").status_code == 200
    assert client.get("/api/recherche", headers=CF).status_code == 404
    monkeypatch.setattr(portier, "TABLE_PUBLIQUE", {"table.example.ch"})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {"table.example.ch"})
    assert client.get("/api/recherche", headers={"Host": "table.example.ch"}).status_code == 404
    assert not portier.CHEMINS_TABLE.match("/api/recherche")
    # Le code de la recherche ne se lit pas non plus depuis Internet.
    for chemin in ("/static/js/chercher/chercher.js", "/static/js/chercher/moteur.js", "/static/js/boutiques/comptoir.js", "/static/css/chercher.css"):
        assert client.get(chemin, headers=CF).status_code == 404, chemin
    monkeypatch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    monkeypatch.setattr(joueurs, "HOTES", set())
    with TestClient(joueurs.app) as coin:
        assert coin.get("/api/recherche").status_code in (401, 404, 405)


def test_la_recherche_est_fermee_a_l_atelier_en_ligne_sans_session(client, monkeypatch):
    monkeypatch.setattr(portier, "ATELIER_PUBLIC", {"atelier.example.ch"})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {"atelier.example.ch"})
    monkeypatch.setattr(portier, "EMPREINTE_MDP", "scrypt:1024:8:1:00:00")
    monkeypatch.setattr(portier, "CLE_SESSION", b"cle")
    assert client.get("/api/recherche", headers={"Host": "atelier.example.ch", "CF-Connecting-IP": "203.0.113.9"}).status_code == 401


def test_ni_la_tv_ni_le_coin_des_joueurs_ne_chargent_la_recherche():
    for module in ("chercher/", "comptoir.js"):
        assert module not in source_page("table"), module
        assert module not in lire("js/joueurs/joueur.js"), module
        for f in (JS / "joueurs").rglob("*.js"):
            assert module not in f.read_text(encoding="utf-8"), f.name
    for feuille in ("chercher.css", "comptoir.css"):
        assert feuille not in lire("table.html") and feuille not in lire("joueurs/index.html"), feuille
    assert "/api/recherche" not in (APP / "joueurs.py").read_text(encoding="utf-8")
    # Les modules de la recherche ne font que lire.
    for f in [*(JS / "chercher").glob("*.js"), JS / "boutiques" / "comptoir.js"]:
        assert not re.search(r"\bapi\.(put|post|patch|del)\(", f.read_text(encoding="utf-8")), f.name


def test_le_moteur_de_lier_une_fiche_est_mis_en_commun():
    sources = {f: f.read_text(encoding="utf-8") for f in JS.rglob("*.js")}
    definitions = [f.name for f, s in sources.items() if re.search(r"export function chercherFiches\(", s)]
    assert definitions == ["moteur.js"]
    fiches = lire("js/scenarios/fiches.js")
    assert 'import { chercherFiches } from "../chercher/moteur.js";' in fiches and "export { chercherFiches };" in fiches
    # « Chercher » bâtit ses fiches par fichesDe, comme « Lier une fiche » : mêmes routes, mêmes détails.
    assert 'import { fichesDe } from "../scenarios/fiches.js";' in lire("js/chercher/index-atelier.js")
    # Les listes des PNJ et des lieux passent par le même moteur.
    assert 'import { chercherPnj, htmlTrouve, surligner } from "../chercher/listes.js";' in lire("js/pnj/carnet.js")
    assert "const filtrer = () => filtrerLieux(page, lieux);" in source_page("atelier")
    assert ".toLowerCase().includes(q)" not in lire("js/pnj/carnet.js")


def test_chercher_s_installe_dans_l_en_tete_sans_rien_deplacer():
    page = lire("index.html")
    assert 'href="/static/css/chercher.css"' in page and 'href="/static/css/comptoir.css"' in page
    atelier = source_page("atelier")
    assert 'installerRecherche(document.querySelector(".entete"));' in atelier
    assert atelier.index("installerTouches({ barre: barreOnglets });") < atelier.index("installerRecherche(")
    # Posé par le code au bout de la seconde ligne, par-dessus le vide des onglets : la grille ne change pas.
    css = lire("css/chercher.css")
    assert re.search(r"\.entete-atelier \.chercher-entete \{\s*grid-row: 2; grid-column: 3; justify-self: end;", css)
    assert "grid-template" not in css
    chercher = lire("js/chercher/chercher.js")
    for taille in ('"large", "moyen", "court"', 'bouton.dataset.taille = "cache";'):
        assert taille in chercher, taille
    assert 'new MutationObserver(reajuster).observe(nav, { attributes: true, attributeFilter: ["hidden", "class"]' in chercher


def test_les_touches_de_chercher_sont_lues_et_declarees():
    chercher = lire("js/chercher/chercher.js")
    barre = re.search(r"\nfunction toucheBarre\(ev\) \{(.*?)\n\}", chercher, flags=re.S).group(1)
    for garde in ('ev.key !== "/"', "ev.ctrlKey", "ev.metaKey", "ev.altKey", "ev.isComposing", "ev.repeat", "champDeSaisie(cible)",
                  'closest("input, textarea, select, dialog, [contenteditable]")', "dialogueOuvert()", "ev.stopPropagation()"):
        assert garde in barre, garde
    k = re.search(r"\nfunction touche\(ev\) \{(.*?)\n\}", chercher, flags=re.S).group(1)
    assert '(ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && (ev.key || "").toLowerCase() === "k"' in k
    assert 'document.addEventListener("keydown", touche, true);' in chercher and 'document.addEventListener("keydown", toucheBarre);' in chercher
    scenario = lire("js/chercher/scenario.js")
    assert '(ev.key || "").toLowerCase() !== "f"' in scenario and "document.activeElement === this.champ || dialogueOuvert()" in scenario
    touches = lire("js/commun/touches.js")
    groupe = touches.split('{ titre: "Chercher", lignes: [')[1].split("] },")[0]
    for ligne in ('l(`/ ${CMD}+K`', 'l(`${CMD}+K`', 'l("↑ ↓ Entrée"', 'l(`${CMD}+F`'):
        assert ligne in groupe, ligne
    # Dans la fenêtre : les flèches et Entrée ; Échap suit echap.js (le dialogue se ferme du premier coup).
    assert '"ArrowDown"' in chercher and '"ArrowUp"' in chercher and 'ev.key === "Enter"' in chercher
    assert 'type="search"' in chercher and "<dialog" not in chercher and 'createElement("dialog")' in chercher


def test_l_arobase_propose_d_abord_les_fiches_du_scenario():
    scenarios = lire("js/scenarios/scenarios.js")
    assert "chercherFiches(this.fiches, q.value, { contexte: contexteDuScenario(this.s, this.fiches) })" in scenarios
    fiches = lire("js/scenarios/fiches.js")
    assert "export function contexteDuScenario(s, fiches)" in fiches


def test_chercher_dans_ce_scenario_au_dessus_de_la_bible():
    scenarios = lire("js/scenarios/scenarios.js")
    assert scenarios.index('<details class="chercher-ici">') < scenarios.index('<details class="bible-rapide">')
    assert "this.chercherIci = new ChercherScenario(this);" in scenarios and "this.chercherIci.depuisLien();" in scenarios
    assert "allerAuPassage(chapitre, debut, fin, { focus = true } = {})" in scenarios
    # Les extraits de la bible s'ouvrent à leur passage.
    assert 'class="extrait" href="/#/bible?doc=' in scenarios and "&passage=0" in scenarios
    bible = lire("js/bible/bible.js")
    assert 'data-passage="${k}"' in bible and 'this.parametres.get("passage")' in bible and "blocDeLExtrait(zone, ligne)" in bible


def test_le_comptoir_d_une_boutique():
    boutiques = lire("js/boutiques/boutiques.js")
    assert 'import { MODES_BOUTIQUE, articlesTrouves, garderModeBoutique, htmlComptoir, htmlCompte, lireModeBoutique } from "./comptoir.js";' in boutiques
    assert 'placeholder="Chercher un article"' in boutiques and 'data-mode-boutique="${k}"' in boutiques
    # Les gestes de la ligne sont ceux de l'éditeur : « Vendre à… » et « Montrer de près » passent par les mêmes actions.
    comptoir = lire("js/boutiques/comptoir.js")
    for action in ('data-action="vendre"', 'data-action="${ici ? "toute-la-boutique" : "montrer-article"}"', 'data-action="deplier"'):
        assert action in comptoir, action
    assert 'querySelectorAll(".article-mj, .comptoir-article")' in boutiques
    # La classe « comptoir » appartient à l'auberge (les PNJ au comptoir) : le comptoir d'une boutique a la sienne.
    assert 'class="comptoir"' not in comptoir and "comptoir-boutique" in comptoir
    assert "new Boutiques(page, { id: morceaux[1], parametres })" in source_page("atelier")


def test_la_vue_publique_d_une_boutique_ne_change_pas(client):
    """Le comptoir est une affaire d'écran du MJ : la TV lit toujours la boutique sans note du MJ ni article caché."""
    b = client.post("/api/boutiques", json={"nom": "Le Comptoir", "notes_mj": "DETTE-MJ", "articles": [
        {"id": "a1", "nom": "Dague", "prix": "5", "note_mj": "NOTE-MJ", "cache": False},
        {"id": "a2", "nom": "Fiole interdite", "prix": "90", "cache": True}]}).json()
    r = client.get(f"/api/table/boutique/{tv_cartes.jeton('boutiques', b['id'])}")
    assert r.status_code == 200 and [a["nom"] for a in r.json()["articles"]] == ["Dague"]
    for texte in ("DETTE-MJ", "NOTE-MJ", "Fiole interdite"):
        assert texte not in r.text, texte
    client.delete(f"/api/boutiques/{b['id']}")


def test_le_texte_suit_le_style_de_l_atelier():
    for f in [*(JS / "chercher").glob("*.js"), JS / "boutiques" / "comptoir.js", STATIQUE / "css" / "chercher.css",
              STATIQUE / "css" / "comptoir.css", APP / "contenu" / "recherche.py"]:
        texte = f.read_text(encoding="utf-8")
        assert "—" not in texte and "–" not in texte, f.name
