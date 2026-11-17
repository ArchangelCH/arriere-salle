"""La table des règles du MJ invité (acces_mj.py) : chaque route de l'atelier y est rangée, rien n'y traîne d'une route
disparue, et la règle d'une requête est celle de la route qui la servirait. La table n'est pas encore appliquée."""

import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

from mj import acces_mj  # noqa: E402
import main  # noqa: E402
from api import application, campagne_api  # noqa: E402


def test_chaque_route_est_rangee():
    table = acces_mj.compiler(application.app.routes)
    assert table.non_rangees() == [], (
        "Ces routes ne sont pas rangées dans app/mj/acces_mj.py (REGLES) : à l'invité, elles répondraient 404. "
        "Range chacune (principal_seul, a_soi, commune, projection, statique, libre).")


def test_rien_ne_traine_d_une_route_disparue():
    assert acces_mj.en_trop(application.app.routes) == []


def test_que_des_regles_connues():
    assert set(acces_mj.REGLES.values()) <= set(acces_mj.REGLES_CONNUES)


def test_la_regle_d_une_requete():
    t = acces_mj.compiler(application.app.routes)
    assert t.regle("GET", "/api/joueurs") == acces_mj.PRINCIPAL_SEUL
    assert t.regle("HEAD", "/api/joueurs") == acces_mj.PRINCIPAL_SEUL
    assert t.regle("GET", "/api/pnj/gaspard") == acces_mj.A_SOI
    assert t.regle("PATCH", "/api/pnj/gaspard") == acces_mj.A_SOI
    assert t.regle("GET", "/api/aventuriers") == acces_mj.PROJECTION
    assert t.regle("PUT", "/api/aventuriers/naima") == acces_mj.PRINCIPAL_SEUL
    assert t.regle("GET", "/api/table/carte/0123456789abcdef0123/fond") == acces_mj.PROJECTION
    assert t.regle("POST", "/api/plans/programme") == acces_mj.A_SOI
    assert t.regle("GET", "/static/js/atelier.js") == acces_mj.STATIQUE
    assert t.regle("GET", "/media/abc.png") == acces_mj.COMMUNE
    # Commun depuis le lot MJ-4 (le canal adressé), comme le relais de la télécommande, un par MJ.
    assert t.regle("WS", "/ws/atelier") == acces_mj.COMMUNE
    assert t.regle("POST", "/api/telecommande/releve") == acces_mj.COMMUNE
    assert t.regle("GET", "/api/demandes") == acces_mj.COMMUNE
    assert t.regle("WS", "/ws/table") == acces_mj.PROJECTION
    assert t.regle("GET", "/connexion/invitation") == acces_mj.LIBRE
    assert t.regle("GET", "/api/mj/comptes") == acces_mj.PRINCIPAL_SEUL
    # Une adresse sans route, une méthode que la route n'a pas : aucune règle (404 pour l'invité).
    assert t.regle("GET", "/api/inconnue") is None
    assert t.regle("POST", "/api/joueurs/x/apercu") is None
    assert t.regle("GET", "/ws/atelier") is None


def test_les_secrets_du_principal_lui_restent():
    """Ce qui porte les liens des joueurs, leurs comptes, Telegram, le nom de l'auberge ou les secrets des héros n'est
    jamais « commune » ni « a_soi »."""
    for cle in ("GET /api/joueurs", "GET /api/demandes/reglages", "PUT /api/demandes/reglages", "GET /api/nom-auberge",
                "PUT /api/campagne", "GET /api/lore/{joueur}/{ident}", "GET /fiche-aventurier.pdf", "PUT /api/table-publique",
                "GET /api/bible-joueurs", "GET /api/carnet-joueurs", "GET /api/mj/comptes", "POST /api/mj/comptes"):
        assert acces_mj.REGLES[cle] == acces_mj.PRINCIPAL_SEUL, cle
    # La campagne : l'invité n'en lit que la projection (la tablée, le niveau ; campagne_api.campagne_pour_l_invite, lot MJ-6).
    assert acces_mj.REGLES["GET /api/campagne"] == acces_mj.PROJECTION
    for cle, regle in acces_mj.REGLES.items():
        if " /api/table/" in cle or cle == "WS /ws/table":
            assert regle == acces_mj.PROJECTION, cle
