"""La page Réglages vue d'un MJ invité, en strict, toutes les routes parcourues (contrôle du lot reglages) : Alban règle
tout ce que la page déplace, avec des canaris (un joueur et son compte, Telegram, le coin en pause, les quotas de l'aide,
la table publique fermée, les coûts de la rédaction, la table et la bible des joueurs, le nom de l'auberge) ; l'invité ne
lit rien de tout cela, ni par une route GET, ni par un fichier servi, ni par la page de l'atelier. Le nom de l'auberge
pour les joueurs est public (le monde et la TV le disent à la place du vrai) : seul le vrai nom ne doit jamais paraître,
et le réglage lui-même reste fermé à l'invité. Ses propres réglages (la musique commune, ses appareils, sa suite, sa
rédaction) marchent. Les données de l'essai sont remises telles quelles à la fin, fichier par fichier."""

import json
import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
RACINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RACINE / "app"))
sys.path.insert(0, str(RACINE / "outils"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from mj import acces_mj  # noqa: E402
from mj import cloisonnement  # noqa: E402
import comparer_reponses  # noqa: E402
import deux_mj  # noqa: E402
import main  # noqa: E402
from datetime import datetime  # noqa: E402
from api import application, config, tv_cartes  # noqa: E402
from table import masque  # noqa: E402
from ia import redaction  # noqa: E402

AUBERGE = "Le Sanglier Canariauberge"
JOUEUSE = "Canarijoueuse"
# Des montants qu'aucune autre réponse ne porte : ceux d'Alban et de sa joueuse ne paraissent jamais chez l'invité.
COUT_ALBAN, COUT_JOUEUSE, COUT_LEA = 7.77731, 6.66617, 0.31337
MOTS = (JOUEUSE, "canarijoueuse", "7.77", "7,77", "6.66", "6,66", "par_joueur", "plafond", "comptes-provisoires")


@pytest.fixture(scope="module")
def appli():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture
def semes(appli, monkeypatch):
    monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.STRICT)
    cloisonnement.oublier()
    # Tout ce que l'essai change (les comptes des MJ, la pause du coin, Telegram, les quotas, le joueur et son compte…) :
    # remis à la fin tel qu'il était avant lui.
    sauves = {f: (f.read_bytes(), f.stat().st_mode) for f in config.DONNEES.rglob("*") if f.is_file()}
    dossiers = {d: d.stat().st_mode for d in config.DONNEES.rglob("*") if d.is_dir()}
    alban, lea = deux_mj.ouvrir(monkeypatch, garde_stricte=True)
    appli.cookies.clear()
    journal = Path(tempfile.mkdtemp(prefix="couts-")) / "couts.jsonl"
    monkeypatch.setattr(redaction, "JOURNAL", journal)
    c = appli
    # Le nom de l'auberge vit aussi en mémoire (masque.py) : remis par sa route à la fin, avant les fichiers.
    auberge_avant = c.get("/api/nom-auberge", headers=alban).json().get("nom") or ""
    assert c.put("/api/nom-auberge", json={"nom": AUBERGE}, headers=alban).status_code == 200
    j = c.post("/api/joueurs", json={"nom": JOUEUSE}, headers=alban)
    assert j.status_code == 200, j.text
    joueuse = j.json()["id"]
    r = c.post(f"/api/joueurs/{joueuse}/provisoire", json={"identifiant": "canarijoueuse"}, headers=alban)
    assert r.status_code == 200, r.text
    for route, corps in (("/api/demandes/reglages", {"telegram": True, "pause": True}),
                         ("/api/aide-joueurs", {"par_joueur": 9, "plafond": 4.21}),
                         ("/api/table-publique", {"ouverte": False}),
                         ("/api/table-joueurs", {"ouverte": True, "pions": "a-valider"}),
                         ("/api/bible-joueurs", {"ouverte": True}),
                         ("/api/carnet-joueurs", {"ouvert": True})):
        r = c.put(route, json=corps, headers=alban)
        assert r.status_code == 200, (route, r.text)
    mois = datetime.now().isoformat(timespec="seconds")
    lignes = [{"date": mois, "fonction": "pnj", "modele": "claude-opus-5-5", "lot": False, "entree": 1, "sortie": 1,
               "cache_ecrit": 0, "cache_lu": 0, "cout": COUT_ALBAN},
              {"date": mois, "fonction": "aide", "modele": "claude-opus-5-5", "lot": False, "entree": 1, "sortie": 1,
               "cache_ecrit": 0, "cache_lu": 0, "cout": COUT_JOUEUSE, "qui": joueuse},
              {"date": mois, "fonction": "pnj", "modele": "claude-opus-5-5", "lot": False, "entree": 1, "sortie": 1,
               "cache_ecrit": 0, "cache_lu": 0, "cout": COUT_LEA, "qui": f"{redaction.PREFIXE_MJ}{deux_mj.INVITE}"}]
    journal.write_text("".join(json.dumps(x) + "\n" for x in lignes), encoding="utf-8")
    yield c, alban, lea, joueuse
    appli.cookies.clear()
    c.put("/api/nom-auberge", json={"nom": auberge_avant}, headers=alban)
    appli.cookies.clear()
    deux_mj.fermer()
    for f in sorted({f for f in config.DONNEES.rglob("*") if f.is_file()} - set(sauves), reverse=True):
        f.unlink(missing_ok=True)
    for d, mode in sorted(dossiers.items()):
        d.mkdir(exist_ok=True)
        d.chmod(mode)
    for f, (contenu, mode) in sauves.items():
        if not f.exists() or f.read_bytes() != contenu:
            f.write_bytes(contenu)
        f.chmod(mode)
    cloisonnement.oublier()


def adresses() -> list:
    sortie = []
    for route, chemin in comparer_reponses.routes_a_plat(application.app.routes):
        if "GET" not in (getattr(route, "methods", None) or ()) or chemin in comparer_reponses.IGNOREES:
            continue
        for adresse in comparer_reponses.adresses(chemin, config.DONNEES, tv_cartes, {}) or []:
            sortie += comparer_reponses.avec_requetes(adresse, config.DONNEES, {})
    return sorted(set(sortie))


def fuites(texte: str, mots=MOTS) -> list:
    # Les dates des fiches (2026-11-10T22:16:06.664) contiennent « 6.66 » ou « 7.77 » de temps en temps : ce n'est pas un coût.
    texte = re.sub(r"\d{4}-\d{2}-\d{2}T[\d:.]+", "", texte)
    return [m for m in mots if m in texte]


def test_alban_lit_ses_canaris(semes):
    client, alban, _, joueuse = semes
    assert AUBERGE in client.get("/api/nom-auberge", headers=alban).text
    assert JOUEUSE in client.get("/api/joueurs", headers=alban).text
    couts = client.get("/api/ia/couts", headers=alban).json()
    assert couts["total"] >= COUT_ALBAN + COUT_JOUEUSE
    assert any(j["cout"] for j in couts.get("joueurs") or [])


def test_aucune_route_get_de_l_invite_ne_dit_un_reglage_d_alban(semes):
    client, _, lea, _ = semes
    vues, erreurs = 0, []
    for adresse in adresses():
        r = client.get(adresse, headers=lea, follow_redirects=False)
        vues += 1
        genre = r.headers.get("content-type", "")
        texte = r.text if "json" in genre or genre.startswith("text/") else ""
        if (f := fuites(texte)):
            erreurs.append((adresse, r.status_code, f))
        if texte and masque.contient_nom_cache(texte):
            erreurs.append((adresse, r.status_code, "nom caché de l'auberge"))
    # Toutes les routes GET de l'atelier (les fiches ne sont pas l'objet ici : les données de l'essai en ont peu).
    assert vues > 60
    assert erreurs == []


def test_ni_par_un_fichier_servi_ni_par_la_page(semes):
    client, _, lea, _ = semes
    for chemin in sorted(acces_mj.STATIQUES_INVITE):
        r = client.get(f"/static/{chemin}", headers=lea)
        assert r.status_code == 200, chemin
        # Les noms seulement : les modules portent les mots « plafond » ou « par_joueur » comme du code.
        assert fuites(r.text, MOTS[:2]) == [], chemin
    page = client.get("/", headers=lea)
    assert page.status_code == 200 and fuites(page.text, MOTS[:2]) == []
    assert "reglages/principal" not in page.text


def test_la_page_de_l_invite_lit_les_siens(semes):
    client, _, lea, _ = semes
    couts = client.get("/api/ia/couts", headers=lea).json()
    # Sa part seulement, et son budget ; ni le détail d'Alban, ni les joueurs, ni les autres MJ.
    assert abs(couts["total"] - COUT_LEA) < 0.001
    assert not couts.get("joueurs") and not couts.get("mj")
    assert couts["budget"]["budget"] == 3.0
    assert client.get("/api/moi", headers=lea).json()["role"] == "invite"
    # La boîte des demandes : Telegram ne concerne que le principal (réglé chez lui, éteint chez l'invité).
    boite = client.get("/api/demandes", headers=lea).json()
    assert boite["telegram"] is False and boite["telegram_configure"] is False
    assert client.get("/api/mj/appareils", headers=lea).json()["appareils"] == []
    assert client.get("/api/musique", headers=lea).status_code == 200
    r = client.put("/api/mj/suite", json={"suite": "Les Chemins de Léa"}, headers=lea)
    assert r.status_code == 200, r.text
    # Ce que la page de l'invité appelle pour le principal, refusé comme une route inconnue.
    for route in ("/api/nom-auberge", "/api/joueurs", "/api/demandes/reglages", "/api/aide-joueurs", "/api/table-joueurs",
                  "/api/bible-joueurs", "/api/carnet-joueurs", "/api/activites", "/api/mj/comptes"):
        assert client.get(route, headers=lea).status_code == 404, route
