"""Ce que voit la TV, côté atelier : le témoin de l'en-tête (temoin-tv.js) et les boutons des fiches (bouton-tv.js) lisent
l'état réel de la table par le canal de l'atelier, jamais par celui des écrans ; ils ne lisent que des routes de l'atelier,
fermées à la table publique ; et un seul couple de mots, « Montrer à la TV » et « Retirer de la TV », reste dans l'atelier.
La logique sans page (vue montrée, « Retirer », plan tout noir) se vérifie avec node outils/verifier_tv.mjs."""

import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application  # noqa: E402
from sources_front import source_page  # noqa: E402

STATIQUE = Path(__file__).resolve().parent.parent / "app" / "static"
JS = STATIQUE / "js"
CF = {"CF-Connecting-IP": "203.0.113.7"}
MODULES_TV = tuple(f"ecran-tv/{n}.js" for n in ("etat-tv", "temoin-tv", "bouton-tv", "table-tv", "tv-noire", "tv-commun"))


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def test_le_temoin_tient_dans_son_emplacement():
    page = (STATIQUE / "index.html").read_text(encoding="utf-8")
    outils = re.search(r'<div class="outils-entete">(.*?)</div>\s*</header>', page, flags=re.S).group(1)
    assert outils.index('class="temoin-tv"') < outils.index('class="ouvrir-tableau"')
    atelier = source_page("atelier")
    assert 'import { demarrerTemoin } from "./ecran-tv/temoin-tv.js";' in atelier and "demarrerTemoin(" in atelier


def test_l_atelier_n_ouvre_jamais_le_canal_des_ecrans():
    """/ws/table compterait comme une TV branchée : l'atelier écoute /ws/atelier (canal-table.js)."""
    for nom in MODULES_TV:
        assert "ws/table" not in (JS / nom).read_text(encoding="utf-8"), nom
    etat = (JS / "ecran-tv/etat-tv.js").read_text(encoding="utf-8")
    assert 'import { ecouterTable } from "./canal-table.js";' in etat and 'api.get("/api/table")' in etat


@pytest.mark.parametrize("chemin", ["/api/table", "/api/cartes", "/api/sanctuaire", "/api/plans/un-plan", "/api/pnj/un-pnj",
                                    "/api/lieux/un-lieu", "/api/boutiques/une-boutique", "/api/rumeurs/une-rumeur",
                                    "/api/contrats/un-contrat", "/api/aventuriers/un-heros", "/api/seances/une-seance",
                                    "/api/documents/un-document"])
def test_ce_que_lit_le_temoin_reste_ferme_a_la_table_publique(client, chemin):
    """Le témoin nomme ce que montre la TV avec les vrais identifiants et les vrais noms : il ne lit que des routes de
    l'atelier, que la table publique ne peut pas lire."""
    assert client.get(chemin, headers=CF).status_code == 404


def test_les_routes_lues_par_le_temoin_sont_bien_celles_de_l_atelier():
    etat = (JS / "ecran-tv/etat-tv.js").read_text(encoding="utf-8")
    lues = (set(re.findall(r'lire\("\w+", "(\w+)"', etat)) | set(re.findall(r'lireFiche\("(/api/[\w/]+)"\)', etat))
            | set(re.findall(r'"(/api/(?:cartes|monde))"', etat)))
    assert lues == {"plans", "lieux", "contrats", "boutiques", "seances", "pnj", "rumeurs", "aventuriers", "documents", "/api/cartes",
                    "/api/sanctuaire", "/api/monde"}
    # Seule une fiche de l'autre MJ (deux MJ, lot MJ-6), que GET /api/table désigne par son jeton (« jetons »), se lit comme
    # la TV la lit : sans autre MJ, jamais.
    assert etat.count("`/api/table/${") == 1 and "(!jetons.has(cle) ? fiche(collection, id)" in etat


def test_un_seul_couple_de_mots_pour_la_tv():
    """« Montrer à la TV » et « Retirer de la TV » partout ; « Raconter » et « Taire » restent aux rumeurs."""
    anciens = re.compile(r"Montrer à la table|Montrer sur la TV|Présenter la tablée|Retirer de la table|Retirer la tablée|"
                         r">Montrer la planche<|>Retirer la planche<|Le montrer de près à la table|Montrer de près à la table|"
                         r"Raconter à la table")
    for f in JS.rglob("*.js"):
        if f.name == "table.js":
            continue
        trouve = anciens.search(f.read_text(encoding="utf-8"))
        assert not trouve, f"{f.relative_to(JS)} : « {trouve.group(0)} »"


def test_les_modules_du_coin_des_joueurs_ecoutent_sans_importer():
    """Le créateur et la galerie sont aussi servis au coin des joueurs, qui ne sert pas etat-tv.js : ils écoutent
    l'événement « etat-tv » du document (test_joueurs vérifie qu'ils n'importent rien d'autre)."""
    for nom in ("aventuriers/createur.js", "illustrations/illustrations.js"):
        source = (JS / nom).read_text(encoding="utf-8")
        assert not re.search(r'from\s+"[./]+(etat-tv|bouton-tv|temoin-tv)\.js"|import\("[./]+(etat-tv|bouton-tv)\.js"\)', source), nom
        assert '"etat-tv"' in source and '"etat-tv-demande"' in source, nom


def test_la_feuille_des_temoins_est_liee_par_le_module():
    etat = (JS / "ecran-tv/etat-tv.js").read_text(encoding="utf-8")
    assert '"/static/css/tv-atelier.css"' in etat
    assert (STATIQUE / "css" / "tv-atelier.css").is_file()
