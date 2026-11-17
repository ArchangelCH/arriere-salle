"""La page Réglages (js/reglages/) et le deuxième MJ : l'invité reçoit la page et ce qu'elle charge pour lui (son mot de
passe, ses appareils, sa suite, la musique, sa rédaction), jamais le module des réglages d'Alban ni les blocs qu'il
importe ; les routes de ces réglages lui répondent 404 ; ce que lit sa page ne porte aucun réglage ni canari d'Alban.
Les réglages ont quitté leurs anciennes places, qui gardent un lien vers la bonne section."""

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
from api import application  # noqa: E402
from sources_front import source_page  # noqa: E402

STATIQUE = Path(__file__).resolve().parent.parent / "app" / "static"
JS = STATIQUE / "js"
CANARI = "CANARI-REGLAGE-ALBAN"
# Les modules des réglages d'Alban : chargés par reglages/principal.js, chez lui seulement.
DU_PRINCIPAL = ("js/reglages/principal.js", "js/demandes/reglages.js", "js/demandes/aide-joueurs.js", "js/joueurs/table-mj.js",
                "js/mj/les-mj.js", "js/joueurs/carnet-mj.js", "js/bible/joueurs-mj.js", "js/aventuriers/compte-joueur.js")
# Ce que lit la page de l'invité.
LECTURES_INVITE = ("/api/moi", "/api/mj/appareils", "/api/musique", "/api/ia/couts")


@pytest.fixture(scope="module")
def appli():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture
def deux(appli, monkeypatch):
    monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.STRICT)
    alban, lea = deux_mj.ouvrir(monkeypatch, garde_stricte=True)
    appli.cookies.clear()
    yield appli, alban, lea
    appli.cookies.clear()
    deux_mj.fermer()


def test_la_page_et_ses_modules_de_l_invite(deux):
    client, alban, lea = deux
    for chemin in ("js/reglages/reglages.js", "js/reglages/mot-de-passe.js", "js/reglages/redaction.js", "css/reglages.css",
                   "js/mj/appareils.js", "js/mj/suite.js", "js/musique/musique-combat.js", "js/musique/musique-boutique.js"):
        assert client.get(f"/static/{chemin}", headers=lea).status_code == 200, chemin
        assert acces_mj.statique_de_l_invite(f"/static/{chemin}"), chemin
    for chemin in DU_PRINCIPAL:
        assert client.get(f"/static/{chemin}", headers=lea).status_code == 404, chemin
        assert client.get(f"/static/{chemin}", headers=alban).status_code == 200, chemin
    # Le module de la page ne charge celui d'Alban que chez lui, et n'importe d'avance aucun de ses blocs.
    source = (JS / "reglages" / "reglages.js").read_text(encoding="utf-8")
    assert 'if (!this.invite) {' in source and 'import("./principal.js")' in source
    statiques = re.findall(r'^import .* from "(\.{1,2}/[^"]+)";$', source, re.M)
    assert sorted(statiques) == ["../api.js", "../mj/role.js"]


def test_les_routes_des_reglages_d_alban_sont_fermees_a_l_invite(deux):
    client, alban, lea = deux
    source = (JS / "reglages" / "principal.js").read_text(encoding="utf-8")
    lues = set(re.findall(r'api\.get\("(/api/[^"$`{]+)"', source))
    assert {"/api/joueurs", "/api/activites", "/api/activites/etat"} <= lues
    for route in sorted(lues - {"/api/table", "/api/sanctuaire"}):
        assert client.get(route, headers=lea).status_code == 404, route
        assert client.get(route, headers=alban).status_code == 200, route
    for methode, route, corps in (("put", "/api/table-publique", {"ouverte": False}), ("put", "/api/sanctuaire", {"joueurs": True}),
                                  ("put", "/api/activites", {"ouvert": True}), ("put", "/api/demandes/reglages", {"pause": True}),
                                  ("put", "/api/table-joueurs", {"ouverte": True}), ("put", "/api/bible-joueurs", {"ouverte": True}),
                                  ("put", "/api/carnet-joueurs", {"ouvert": True}), ("put", "/api/nom-auberge", {"nom": CANARI}),
                                  ("put", "/api/aide-joueurs", {"par_joueur": 1}), ("put", "/api/des-aventure", {"actif": True}),
                                  ("put", "/api/confort", {"themes": {}}), ("post", "/api/joueurs", {"nom": CANARI}),
                                  ("put", "/api/mj/comptes/lea/budget", {"budget_mois": 50})):
        r = getattr(client, methode)(route, json=corps, headers=lea)
        assert r.status_code == 404, (route, r.status_code)


def test_ce_que_lit_la_page_de_l_invite_ne_dit_rien_d_alban(deux):
    client, alban, lea = deux
    assert client.put("/api/nom-auberge", json={"nom": f"le {CANARI}"}, headers=alban).status_code == 200
    try:
        for route in LECTURES_INVITE:
            r = client.get(route, headers=lea)
            assert r.status_code == 200, route
            assert CANARI not in r.text and "telegram" not in r.text and "empreinte" not in r.text, route
        assert client.get("/api/moi", headers=lea).json()["role"] == "invite"
        # Ses appareils sont les siens : ceux d'Alban n'y paraissent pas.
        assert client.get("/api/mj/appareils", headers=lea).json()["appareils"] == []
    finally:
        client.put("/api/nom-auberge", json={"nom": ""}, headers=alban)


def test_les_anciennes_places_menent_aux_reglages():
    """Les réglages ont quitté l'onglet Table, l'onglet Aventuriers, la Bible, le Sanctuaire, les activités, les Règles
    maison et le panneau Musique ; chaque ancienne place garde un lien vers la bonne section, sans dupliquer le réglage."""
    lire = lambda chemin: (JS / chemin).read_text(encoding="utf-8")  # noqa: E731
    atelier = source_page("atelier")
    for bloc in ("ajouterBlocCoin", "ajouterBlocAideJoueurs", "ajouterBlocTableJoueurs", "ajouterBlocNomAuberge", "blocCouts",
                 "/api/table-publique", "blocSuite", "blocDesAppareils("):
        assert bloc not in atelier, bloc
    assert 'href="#/reglages"' in atelier and 'href="#/reglages/table"' in atelier and 'libelle: "Réglages"' in atelier
    createur = lire("aventuriers/createur.js")
    for bloc in ("inviter-joueur", "interrupteurCarnet", "blocDesMJ", "blocDesAppareils", "tirerProvisoire", "htmlCreerCompte"):
        assert bloc not in createur, bloc
    assert 'href="#/reglages/acces"' in createur and 'href="#/reglages/coin"' in createur
    assert "data-sc-joueurs" not in lire("sanctuaire/sanctuaire.js") and 'href="#/reglages/coin"' in lire("sanctuaire/sanctuaire.js")
    assert 'data-cat="ouvert"' not in lire("activites/catalogue.js") and 'href="#/reglages/coin"' in lire("activites/catalogue.js")
    assert "PanneauConfort" not in lire("regles/regles.js") and 'href="#/reglages/regles?confort"' in lire("regles/regles.js")
    assert "htmlReglageCombat" not in lire("musique/musique.js") and 'href="#/reglages/table"' in lire("musique/musique.js")
    bible = lire("bible/joueurs-mj.js")
    assert "interrupteurBible" not in bible and "etatBibleJoueurs" in atelier
    # Un seul endroit règle chacun : la page Réglages (reglages/principal.js et ses blocs).
    principal = lire("reglages/principal.js")
    for bloc in ("ajouterBlocCoin(coin)", "blocCarnet(coin)", "ajouterBlocTableJoueurs(coin)", "blocBible(coin)", "blocSanctuaire(coin)",
                 "blocActivites(coin)", "blocTablePublique(table)", "ajouterBlocNomAuberge(table)", "ajouterReglageDesAventure(regles)",
                 "ajouterBlocPionsJoueurs(regles)", "new PanneauConfort(", "blocDesMJ(", "blocComptesJoueurs(acces)",
                 "ajouterBlocAideJoueurs(redaction)", "blocBudgetsDesMJ(", "blocCharte(redaction)"):
        assert bloc in principal, bloc
