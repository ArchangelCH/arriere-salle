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
from comptes_coin import entrer, jeton_de  # noqa: E402
import main  # noqa: E402
from api import application, config  # noqa: E402


@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture()
def coin(monkeypatch):
    monkeypatch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    monkeypatch.setattr(joueurs, "COOKIE_SUR", False)
    monkeypatch.setattr(joueurs, "HOTES", set())
    with TestClient(joueurs.app) as c:
        yield c



def test_sans_lien_rien_ne_s_ouvre(coin):
    # Sans session, l'accueil est la page de connexion.
    assert "Se connecter" in coin.get("/").text
    assert coin.get("/api/moi").status_code == 401
    r = coin.get("/?cle=faux", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/connexion?lien=ancien" and "set-cookie" not in r.headers
    assert coin.get("/fiche", follow_redirects=False).status_code == 303


def test_seuls_les_fichiers_du_createur_sortent(coin):
    assert coin.get("/static/js/aventuriers/createur.js").status_code == 200
    # js/table.js (l'écran de la TV, déjà public sur la table en ligne) est servi au coin depuis le lot du 12/11 : la page
    # Table le tient dans un cadre. L'atelier, lui, ne sort jamais.
    assert coin.get("/static/js/table.js").status_code == 200
    for chemin in ("/static/js/atelier.js", "/static/js/telecommande.js", "/static/js/idees/idees.js", "/static/index.html", "/static/../main.py",
                   "/static/js/../../main.py", "/api/aventuriers", "/api/idees", "/api/campagne", "/api/etats-heros",
                   "/static/js/seances/compagnie.js"):
        assert coin.get(chemin).status_code == 404, chemin


def test_chaque_module_servi_trouve_ses_imports(coin):
    """Un module du créateur qui en importe un autre hors de la liste ne se chargerait pas : le coin resterait vide."""
    statique = Path(joueurs.__file__).resolve().parent / "static"
    for fichier in sorted(f for f in joueurs.FICHIERS if f.endswith(".js")):
        source = (statique / fichier).read_text(encoding="utf-8")
        for importe in re.findall(r'^\s*(?:import|export)\b[^;]*?from\s+"(\.{1,2}/[^"]+)"|^\s*import\s+"(\.{1,2}/[^"]+)"', source, flags=re.M):
            cible = (Path(fichier).parent / (importe[0] or importe[1])).as_posix()
            cible = os.path.normpath(cible)
            assert cible in joueurs.FICHIERS, f"{fichier} importe {cible}, que le coin des joueurs ne sert pas"
            assert coin.get(f"/static/{cible}").status_code == 200, cible


def test_du_lien_a_la_tablee(atelier, coin):
    invite = atelier.post("/api/joueurs", json={"nom": "Maxime"}).json()
    # Plus de lien à clé : la carte propose un identifiant, le jeton interne reste dans l'atelier.
    assert invite["etat"] == "invite" and "lien" not in invite and invite["compte"] is None and invite["identifiant_propose"].startswith("maxime")
    # Seule l'empreinte du jeton part dans le dossier que voit le service public.
    assert jeton_de(invite) not in (config.PROPOSITIONS / ".acces.json").read_text(encoding="utf-8")

    assert entrer(coin, invite) == "/" and coin.cookies.get("aventurier", "").startswith("v2.")
    moi = coin.get("/api/moi").json()
    # Ce que le coin sait toujours (coin.json) : les couleurs prises à la tablée, la prochaine séance.
    assert isinstance(moi.pop("couleurs_prises"), list) and isinstance(moi.pop("prochaine"), str)
    assert moi == {"joueur": "Maxime", "aventurier": None, "envoye": False, "envoye_le": None, "accueilli": False,
                   "accueilli_le": None, "heros": None, "carnet": False, "relie": False, "present": None}
    assert 'data-mode="joueur"' in coin.get("/fiche").text

    # Ce qui revient au MJ ne s'écrit pas depuis le coin des joueurs.
    propose = {"nom": "Elouan Vasselin", "niveau": 5, "tablee": False, "dons": [{"nom": "Vision dans le noir", "valide_mj": True}]}
    propose["secret"] = "SECRET-JOUEUR"
    propose["notes_mj"] = "NOTE"
    a = coin.post("/api/moi/aventurier", json=propose).json()
    assert a["id"] == invite["id"] and a["niveau"] == 1 and a["joueur"] == "Maxime"
    assert "secret" not in a and "notes_mj" not in a and "tablee" not in a and "valide_mj" not in a["dons"][0]
    assert coin.post("/api/moi/aventurier", json={"nom": "Bis"}).status_code == 409

    maj = coin.put("/api/moi/aventurier", json={**a, "nom": "Elouan", "version_base": a["modifie"]}).json()
    assert maj["nom"] == "Elouan"
    assert coin.put("/api/moi/aventurier", json={**a, "version_base": a["modifie"]}).status_code == 409

    assert coin.post("/api/moi/envoyer").json()["envoye"] is True
    etats = {j["id"]: j for j in atelier.get("/api/joueurs").json()}
    assert etats[invite["id"]]["etat"] == "envoye" and etats[invite["id"]]["aventurier"] == "Elouan"
    coin.put("/api/moi/aventurier", json={**maj, "genre": "h", "version_base": maj["modifie"]})
    assert {j["id"]: j for j in atelier.get("/api/joueurs").json()}[invite["id"]]["etat"] == "retouche"

    fiche = atelier.post(f"/api/joueurs/{invite['id']}/accueillir").json()
    assert fiche["nom"] == "Elouan" and fiche["tablee"] is True and fiche["source"] == f"joueur:{invite['id']}"
    assert (config.AVENTURIERS / f"{fiche['id']}.json").exists()
    assert atelier.post(f"/api/joueurs/{invite['id']}/accueillir").status_code == 409
    assert coin.get("/api/moi").json()["accueilli"] is True
    assert coin.put("/api/moi/aventurier", json={"nom": "Autre"}).status_code == 423
    assert coin.post("/api/moi/envoyer").status_code == 423


def test_nouveau_provisoire_et_retrait(atelier, coin):
    invite = atelier.post("/api/joueurs", json={"nom": "Léa"}).json()
    entrer(coin, invite)
    assert coin.get("/api/moi").status_code == 200
    nouveau = atelier.post(f"/api/joueurs/{invite['id']}/provisoire", json={}).json()
    assert nouveau["provisoire"] and "lien" not in nouveau
    # Les appareils déjà connectés ne passent plus ; le joueur rentre par le provisoire.
    assert coin.get("/api/moi").status_code == 401
    entrer(coin, invite)
    coin.post("/api/moi/aventurier", json={"nom": "Brouillon"})
    assert atelier.delete(f"/api/joueurs/{invite['id']}").status_code == 200
    assert coin.get("/api/moi").status_code == 401
    assert not (config.PROPOSITIONS / f"{invite['id']}.json").exists()
