"""L'atelier d'un MJ invité : la liste fermée de ses statiques (chaque module y trouve ses imports, aucun ne
porte un secret du kit), les modules du kit hors du graphe statique des modules communs, la page de l'atelier marquée de
son rôle, la campagne en projection, les références de la table données sous leur jeton. Sans invité, rien ne change."""

import json
import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from mj import acces_mj  # noqa: E402
from mj import cloisonnement  # noqa: E402
import deux_mj  # noqa: E402
import main  # noqa: E402
from api import application, campagne_api, config, statiques_versionnes, tv_cartes, tv_ecran  # noqa: E402
from table import masque  # noqa: E402

STATIQUE = Path(__file__).resolve().parent.parent / "app" / "static"

# Ce qui porte les fiches de départ du kit et ses secrets : jamais servi à l'invité, jamais importé d'avance.
KIT = ("js/aventuriers/kit.js", "js/pnj/kit.js", "js/auberge/kit.js", "js/carte/generateur.js", "js/carte/saison4.js",
       "js/carte/editeur.js", "js/campagne/carte.js", "js/campagne/pays.js",
       "js/campagne/pretires.js")
# Les données du kit de l'auberge et des PNJ, sorties de pnj/kit.js et d'auberge/kit.js dans la campagne.
KIT += ("js/campagne/pnj.js", "js/campagne/auberge.js")
# Ce que les modules de la liste chargent à la demande, chez le compte principal seulement (sa page, son bouton).
CHEZ_ALBAN = KIT + ("js/activites/catalogue.js", "js/bible/joueurs-mj.js", "js/illustrations/charte.js", "js/mj/les-mj.js",
                     "js/joueurs/carnet-mj.js", "js/aventuriers/compte-joueur.js", "js/aventuriers/confie-mj.js",
                     "js/reglages/principal.js")
# Les pages de l'atelier qu'un invité ouvre, et ce qu'elles chargent.
PAGES = ("index.html", "telecommande.html", "fiche-seance.html", "feuille-combat.html", "billets.html", "carte-x.html",
         "document-imprime.html", "table.html")
# Une adresse statique écrite dans un module de la liste, pour une page du compte principal (l'aperçu du coin).
ADRESSES_DU_PRINCIPAL = {"/static/joueurs/apercu.html"}

IMPORTS = re.compile(r'^\s*(?:import|export)\b[^;]*?from\s+"(\.{1,2}/[^"]+)"|^\s*import\s+"(\.{1,2}/[^"]+)"', re.M)
DYNAMIQUES = re.compile(r'import\(\s*["\'](\.{1,2}/[^"\']+)["\']\s*\)')


def cible(module: str, relatif: str) -> str:
    return os.path.normpath((Path(module).parent / relatif).as_posix())


def statiques(module: str) -> list:
    source = (STATIQUE / module).read_text(encoding="utf-8")
    return [cible(module, a or b) for a, b in IMPORTS.findall(source)]


def fermeture(depart) -> set:
    vus, pile = set(), list(depart)
    while pile:
        m = pile.pop()
        if m not in vus:
            vus.add(m)
            pile.extend(statiques(m))
    return vus


def test_chaque_module_de_l_invite_trouve_ses_imports():
    """Un module de la liste qui en importe un autre hors de la liste ne se chargerait pas : l'atelier de l'invité resterait
    vide. Un import à la demande y est, ou va chez Alban seulement (CHEZ_ALBAN)."""
    modules = sorted(f for f in acces_mj.STATIQUES_INVITE if f.endswith(".js"))
    assert "js/atelier.js" in modules and "js/telecommande.js" in modules and "js/mj/monde.js" in modules
    for module in modules:
        assert (STATIQUE / module).is_file(), module
        for importe in statiques(module):
            assert importe in acces_mj.STATIQUES_INVITE, f"{module} importe {importe}, que l'invité ne reçoit pas"
        for importe in DYNAMIQUES.findall((STATIQUE / module).read_text(encoding="utf-8")):
            vise = cible(module, importe)
            assert vise in acces_mj.STATIQUES_INVITE or vise in CHEZ_ALBAN, f"{module} charge {vise} : à ranger"
    for feuille in (f for f in acces_mj.STATIQUES_INVITE if f.endswith(".css")):
        assert (STATIQUE / feuille).is_file(), feuille


def test_chaque_page_de_l_invite_trouve_ses_fichiers():
    """Les scripts et les feuilles des pages qu'il ouvre, et les adresses que ses modules écrivent (une feuille posée à la
    demande, le worker du relief) : tous dans sa liste."""
    for page in PAGES:
        for adresse in re.findall(r'(?:href|src)="(/static/[^"]+)"', (STATIQUE / page).read_text(encoding="utf-8")):
            assert acces_mj.statique_de_l_invite(adresse), f"{page} charge {adresse}"
    for module in (f for f in acces_mj.STATIQUES_INVITE if f.endswith(".js")):
        for adresse in re.findall(r'/static/[\w./-]+\.(?:js|css|html|jpg|png|svg|mp4|woff2)\b', (STATIQUE / module).read_text(encoding="utf-8")):
            assert acces_mj.statique_de_l_invite(adresse) or adresse in ADRESSES_DU_PRINCIPAL, f"{module} écrit {adresse}"


def test_les_modules_communs_n_importent_pas_le_kit_d_avance():
    """Le kit se charge au clic, chez Alban seulement : ni la page de l'atelier, ni la télécommande, ni la TV, ni le coin
    ne l'importent statiquement."""
    for depart in ("js/atelier.js", "js/telecommande.js", "js/table.js", "js/seances/fiche.js", "js/seances/feuille-combat.js"):
        assert not fermeture([depart]) & set(KIT), depart
    for module in KIT:
        assert module not in acces_mj.STATIQUES_INVITE, module
    # Les dons du livret sont des règles, que lisent les fiches, la TV et le coin : à part des prétirés (deux modules de la
    # campagne, campagne/dons.js et campagne/pretires.js).
    assert "js/campagne/dons.js" in fermeture(["js/table.js"])
    assert "export const PRETIRES" not in (STATIQUE / "js/campagne/dons.js").read_text(encoding="utf-8")
    assert "js/campagne/pretires.js" not in fermeture(["js/aventuriers/regles.js", "js/aventuriers/tables.js", "js/combats/groupe.js"])


# Les champs des modules du kit qui portent ses secrets : ce que savent les PNJ, le fond et la vérité des rumeurs et des
# affiches, les étapes et la fin des fils, les secrets des lieux, les histoires des prétirés.
CHAMPS_SECRETS = re.compile(r'\b"?(secret|secrets|fond|verite|histoire|jamais|defaut|lien|fin|but|texte|rumeur)"?\s*:\s*"((?:[^"\\]|\\.){24,})"')


def secrets_du_kit() -> set:
    trouves = set()
    for module in KIT:
        for _champ, valeur in CHAMPS_SECRETS.findall((STATIQUE / module).read_text(encoding="utf-8")):
            trouves.add(json.loads(f'"{valeur}"'))
    return trouves


def test_aucun_fichier_de_l_invite_ne_porte_un_secret_du_kit():
    secrets = secrets_du_kit()
    # Assez de secrets pour que la recherche ait un sens, quel que soit le pack de campagne (celui de l'exemple en a une
    # soixantaine).
    assert len(secrets) > 40
    servis = [f for f in STATIQUE.rglob("*") if f.is_file() and f.suffix in (".js", ".css", ".html", ".json", ".svg", ".txt")
              and acces_mj.statique_de_l_invite("/static/" + f.relative_to(STATIQUE).as_posix())]
    assert len(servis) > 200
    for f in servis:
        contenu = f.read_text(encoding="utf-8", errors="replace")
        assert not masque.contient_nom_cache(contenu), f
        fuites = [s[:60] for s in secrets if s in contenu]
        assert not fuites, (f, fuites)


# ---------------------------------------------------------------- par les routes, deux MJ

@pytest.fixture(scope="module")
def appli():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture
def strict(monkeypatch):
    monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.STRICT)
    cloisonnement.oublier()
    yield
    cloisonnement.oublier()


@pytest.fixture
def veille(monkeypatch):
    monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.VEILLE)
    cloisonnement.oublier()
    yield
    cloisonnement.oublier()


@pytest.fixture
def deux(appli, monkeypatch):
    avant = {n: (config.DONNEES / n).read_bytes() if (config.DONNEES / n).exists() else None for n in ("table.json", "campagne.json")}
    alban, lea = deux_mj.ouvrir(monkeypatch)
    yield appli, alban, lea
    deux_mj.fermer()
    for n, contenu in avant.items():
        if contenu is None:
            (config.DONNEES / n).unlink(missing_ok=True)
        else:
            (config.DONNEES / n).write_bytes(contenu)


def test_les_statiques_par_les_routes(deux, strict):
    client, alban, lea = deux
    for chemin in sorted(acces_mj.STATIQUES_INVITE):
        assert client.get(f"/static/{chemin}", headers=lea).status_code == 200, chemin
    for chemin in CHEZ_ALBAN + ("js/table.js", "js/joueurs/joueur.js", "index.html", "connexion.html"):
        assert client.get(f"/static/{chemin}", headers=lea).status_code == 404, chemin
    assert client.get("/static/js/pnj/kit.js", headers=alban).status_code == 200


def test_la_page_de_l_atelier_porte_le_role(deux, strict):
    client, alban, lea = deux
    fichier = statiques_versionnes.page_html("index.html").body  # la page, ses liens sous l'empreinte
    # Avec deux MJ, la page dit aussi à chacun son compte et l'autre MJ (la case « Partager », js/mj/partage.js) : rien d'autre.
    def sans_les_mj(texte: str) -> str:
        return re.sub(r' data-(?:compte|autres-mj)="[^"]*"', "", texte)
    assert sans_les_mj(client.get("/", headers=alban).text).encode() == fichier
    page = client.get("/", headers=lea)
    assert page.status_code == 200 and page.text.count('data-role="invite"') == 1
    assert sans_les_mj(page.text).replace(' data-role="invite"', "").encode() == fichier


def test_la_page_porte_les_deux_mj_pour_le_partage(deux, strict, appli):
    """« Partager avec l'autre MJ » (js/mj/partage.js) : la page dit à chacun son compte et les autres MJ ouverts, rien de
    plus ; l'invité reçoit le module, la case et la lecture seule sont dans le carnet des PNJ et la fiche d'un lieu."""
    import html
    client, alban, lea = deux
    for h, moi, autre in ((alban, "alban", "lea"), (lea, "lea", "alban")):
        page = client.get("/", headers=h).text
        assert f'data-compte="{moi}"' in page
        autres = json.loads(html.unescape(re.search(r'data-autres-mj="([^"]*)"', page).group(1)))
        assert [m["id"] for m in autres] == [autre] and set(autres[0]) == {"id", "nom"}
    assert client.get("/static/js/mj/partage.js", headers=lea).status_code == 200
    for module, repere in (("js/pnj/carnet.js", 'data-champ="partage"'), ("js/lieux/fiche-lieu.js", 'data-l="partage"'),
                           ("js/carte/editeur.js", 'data-champ="partage"')):
        source = (STATIQUE / module).read_text(encoding="utf-8")
        assert "htmlCasePartage" in source and repere in source, module
    for module in ("js/pnj/carnet.js", "js/lieux/fiche-lieu.js"):
        source = (STATIQUE / module).read_text(encoding="utf-8")
        assert "partageeParUnAutre" in source and "figer(" in source, module
    # L'éditeur de carte, qui écrit les fiches de ses lieux, ne reçoit pas ceux que l'autre MJ partage.
    assert "lieux.filter((l) => !partageeParUnAutre(l))" in (STATIQUE / "js/atelier/cartes.js").read_text(encoding="utf-8")


def test_sans_invite_la_page_ne_porte_rien_du_partage(appli):
    page = appli.get("/").text
    assert "data-compte" not in page and "data-autres-mj" not in page


def test_la_campagne_de_l_invite(deux, strict):
    client, alban, lea = deux
    heros = client.post("/api/aventuriers", json={"nom": "Naïma Ventebrise", "peuple": "Demi-élémentaire", "peuple_cache": True,
                                                  "tablee": True, "secret": "SECRET-HEROS"}, headers=alban).json()
    visible = client.post("/api/aventuriers", json={"nom": "Orlane de Vaux", "peuple": "Humain", "tablee": True}, headers=alban).json()
    campagne = {"nom": "CANARI-NOM-CAMPAGNE", "niveau": 3, "niveau_seance": 4,
                "reputations": [{"region": "Nord", "souvenir": "CANARI-REPUTATION"}],
                "balance": {"groupe": [{"nom": "CANARI-BALANCE"}]},
                "tablee": [{"id": "a1", "actif": True, "aventurier": heros["id"], "joueur": "Yuna", "couleur": "#b3261e",
                            "personnage": "Naïma Ventebrise", "peuple": "Demi-élémentaire de la lumière", "vocation": "Gardienne",
                            "notes": "CANARI-NOTE-TABLEE"},
                           {"id": "a2", "actif": True, "aventurier": visible["id"], "joueur": "Jude", "couleur": "#2f6ea5",
                            "personnage": "Orlane de Vaux", "peuple": "Humain", "vocation": "Paladine"},
                           {"id": "a3", "actif": False, "joueur": "Bix", "personnage": "Petite Fanfrelée", "peuple": "Nain"}]}
    actuelle = client.get("/api/campagne", headers=alban).json()
    assert client.put("/api/campagne", json={**campagne, "version_base": actuelle.get("modifie")}, headers=alban).status_code == 200
    vue = client.get("/api/campagne", headers=lea)
    assert vue.status_code == 200
    v = vue.json()
    assert set(v) == {"niveau", "tablee", "reputations", "modifie"} and v["niveau"] == 3 and v["reputations"] == []
    assert [j["peuple"] for j in v["tablee"]] == ["", "Humain", ""]
    assert [j["joueur"] for j in v["tablee"]] == ["Yuna", "Jude", "Bix"]
    assert all(set(j) <= {"id", "actif", "aventurier", "joueur", "couleur", "personnage", "vocation", "peuple"} for j in v["tablee"])
    assert "CANARI" not in vue.text and "SECRET" not in vue.text and not masque.contient_nom_cache(vue.text)
    # Il ne l'écrit pas ; Alban la lit entière.
    assert client.put("/api/campagne", json={**v, "version_base": v["modifie"]}, headers=lea).status_code == 404
    assert client.get("/api/campagne", headers=alban).json()["nom"] == "CANARI-NOM-CAMPAGNE"


def test_en_veille_la_campagne_reste_entiere_et_c_est_note(deux, veille):
    client, alban, lea = deux
    entiere = client.get("/api/campagne", headers=alban).json()
    assert client.get("/api/campagne", headers=lea).json() == entiere
    assert "campagne-entiere" in {v[0] for v in cloisonnement.vues()}


def test_la_table_dit_ses_jetons(deux, strict):
    """Une référence de la table donnée sous son jeton (la fiche de l'autre MJ) est nommée dans « jetons » : la page en lit
    le nom comme la TV, jamais par les routes de l'atelier. Sans autre MJ dans l'état, pas de champ."""
    client, alban, lea = deux
    pnj = client.post("/api/pnj", json={"nom": "Ernest Viguier", "connu": True}, headers=alban).json()
    plan_lea = client.post("/api/plans", json={"nom": "Le moulin", "largeur": 4, "hauteur": 3, "sol": [1] * 12, "piece": [1] * 12,
                                               "brouillard": [1] * 12, "pieces": [{"id": 1, "genre": "salle", "nom": "salle"}],
                                               "portes": [], "objets": [], "pions": [], "textes": [], "m_case": 1.5}, headers=lea).json()
    assert client.put("/api/table", json={"vue": "accueil", "pnj": pnj["id"]}, headers=alban).status_code == 200
    vue_alban = client.get("/api/table", headers=alban).json()
    assert vue_alban["pnj"] == pnj["id"] and "jetons" not in vue_alban
    vue_lea = client.get("/api/table", headers=lea).json()
    assert vue_lea["pnj"] == tv_cartes.jeton("pnj", pnj["id"]) and vue_lea["jetons"] == ["pnj"]
    assert client.get(f"/api/table/pnj/{vue_lea['pnj']}", headers=lea).json()["nom"] == "Ernest Viguier"
    # Léa montre son plan (elle reprend la main) : chez elle en clair, chez Alban sous son jeton.
    r = client.put("/api/table", json={"vue": "plan", "plan": plan_lea["id"], "reprendre": True}, headers=lea)
    assert r.status_code == 200
    vue_lea = client.get("/api/table", headers=lea).json()
    assert vue_lea["plan"] == plan_lea["id"] and "plan" not in vue_lea.get("jetons", [])
    vue_alban = client.get("/api/table", headers=alban).json()
    assert vue_alban["plan"] == tv_cartes.jeton("plans", plan_lea["id"]) and vue_alban["jetons"] == ["plan"]
    # Renvoyé par une page, « jetons » ne s'enregistre pas.
    assert client.put("/api/table", json={**vue_alban, "reprendre": True}, headers=alban).status_code == 200
    assert "jetons" not in tv_ecran.etat_table()


def test_sans_invite_la_table_et_la_campagne_ne_changent_pas(appli):
    client = appli
    assert client.get("/").content == statiques_versionnes.page_html("index.html").body
    assert client.put("/api/table", json={"vue": "accueil"}).status_code == 200
    assert "jetons" not in client.get("/api/table").json()
    assert client.get("/api/campagne").json() == campagne_api.campagne()


def test_les_regles_maison_sans_leur_contexte(deux, strict):
    """Les règles maison sont les mêmes à la table pour les deux MJ, pas leur contexte : une note du MJ qui cite ses
    scénarios et ses séances. L'invité les lit sans lui et au masque, par la liste, la fiche et la recherche ; Alban les
    lit entières."""
    client, alban, lea = deux
    r = client.post("/api/regles-maison", json={"titre": "Le feu", "texte": "Traverser les flammes à la Petite Fanfrelée : 1D6.",
                                                 "contexte": "CANARI-CONTEXTE : la nuit des trois Églises.", "statut": "en-vigueur",
                                                 "publique": False}, headers=alban)
    assert r.status_code == 200
    ident = r.json()["id"]
    try:
        for adresse in ("/api/regles-maison", f"/api/regles-maison/{ident}", "/api/recherche"):
            vue = client.get(adresse, headers=lea)
            assert vue.status_code == 200 and "Traverser les flammes" in vue.text, adresse
            assert "CANARI-CONTEXTE" not in vue.text and not masque.contient_nom_cache(vue.text), adresse
            assert "CANARI-CONTEXTE" in client.get(adresse, headers=alban).text, adresse
    finally:
        client.delete(f"/api/regles-maison/{ident}", headers=alban)


def test_une_regle_gardee_ne_nomme_pas_un_secret_d_alban(deux, strict):
    """Une règle gardée pour le MJ peut nommer un PNJ inconnu des joueurs : l'invité la lit sans cette ligne, par la liste,
    la fiche et la recherche ; le reste de la règle demeure. Alban la lit entière."""
    client, alban, lea = deux
    p = client.post("/api/pnj", json={"nom": "Baron Ostrogoth", "connu": False}, headers=alban).json()
    r = client.post("/api/regles-maison", json={"titre": "La peur", "statut": "en-vigueur", "publique": False,
                                                 "texte": "Le baron Ostrogoth ne meurt pas avant la fin.\nLes jets de peur se font en secret."},
                    headers=alban)
    assert r.status_code == 200
    ident = r.json()["id"]
    try:
        for adresse in ("/api/regles-maison", f"/api/regles-maison/{ident}", "/api/recherche"):
            vue = client.get(adresse, headers=lea)
            assert vue.status_code == 200 and "Les jets de peur se font en secret." in vue.text, adresse
            assert "Ostrogoth" not in vue.text, adresse
            assert "Ostrogoth" in client.get(adresse, headers=alban).text, adresse
    finally:
        client.delete(f"/api/regles-maison/{ident}", headers=alban)
        (config.PNJ / f"{p['id']}.json").unlink(missing_ok=True)


def test_en_veille_les_regles_restent_entieres(deux, veille):
    client, alban, lea = deux
    r = client.post("/api/regles-maison", json={"titre": "La fumée", "texte": "1D4 par étape.", "contexte": "CANARI-FUMEE",
                                                 "statut": "en-vigueur"}, headers=alban)
    try:
        assert "CANARI-FUMEE" in client.get(f"/api/regles-maison/{r.json()['id']}", headers=lea).text
        assert "regle-entiere" in {v[0] for v in cloisonnement.vues()}
    finally:
        client.delete(f"/api/regles-maison/{r.json()['id']}", headers=alban)
