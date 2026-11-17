"""La table publiée sur Internet (table.exemple.org, par le tunnel Cloudflare) : la vue TV en lecture, rien d'autre."""

import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, config, portier, tv_cartes, tv_etat  # noqa: E402
from sources_front import source_page  # noqa: E402

CF = {"CF-Connecting-IP": "203.0.113.7"}
OUVERTS_EN_LOCAL = ["/api/aventuriers", "/api/pnj", "/api/lieux", "/api/campagne", "/api/scenarios", "/api/joueurs", "/api/cartes",
                    "/api/boutiques"]


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def test_par_cloudflare_la_vue_tv_repond(client):
    assert client.get("/table", headers=CF).status_code == 200
    assert client.get("/static/tv/table.js", headers=CF).status_code in (200, 404)  # produit au build de l'image
    assert client.get("/static/css/table.css", headers=CF).status_code == 200
    # Une vue de la table se lit depuis Internet quand la TV la montre (lectures_publiques.py, test_lectures_publiques.py).
    client.put("/api/table", json={"vue": "heros"})
    assert client.get("/api/table/heros", headers=CF).status_code == 200
    client.put("/api/table", json={"vue": "planche"})
    assert client.get("/api/table/planche", headers=CF).status_code == 200
    with client.websocket_connect("/ws/table", headers=CF) as ws:
        assert ws.receive_json()["type"] == "etat"


SECRETS_DANS_LE_CODE = ["/static/js/auberge/kit.js", "/static/js/pnj/kit.js", "/static/js/carte/generateur.js",
                        "/static/js/campagne/auberge.js", "/static/js/campagne/pnj.js",
                        "/static/js/carte/saison4.js", "/static/js/campagne/carte.js", "/static/js/campagne/pays.js",
                        "/static/js/pnj/carton-pnj.js", "/static/js/seances/pour-le-carnet.js",
                        "/static/index.html", "/static/telecommande.html", "/static/js/telecommande.js", "/static/css/atelier.css"]


@pytest.mark.parametrize("entetes", [CF, {"Host": "table.example.ch"}])
def test_par_internet_seuls_les_fichiers_de_la_tv_se_lisent(client, monkeypatch, entetes):
    """Le code de l'atelier porte les fiches de départ de la campagne (le vrai nom de l'auberge, le secret de Toma, les
    étapes de la Chasse) : la table publique ne lit que ce que charge la page de la TV, et rien ne remonte par « .. »."""
    monkeypatch.setattr(portier, "TABLE_PUBLIQUE", {"table.example.ch"})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {"table.example.ch"})
    for chemin in SECRETS_DANS_LE_CODE + ["/static/tv/../js/auberge/kit.js", "/static/fonts/../js/pnj/kit.js",
                                          "/static/img/kit/../../js/carte/generateur.js", "/static/css/../js/auberge/kit.js"]:
        r = client.get(chemin, headers=entetes)
        assert r.status_code == 404 and "Fanfrel" not in r.text, chemin
        # Le client d'essai résout « .. » avant d'envoyer : la règle elle-même ne doit pas laisser passer le chemin brut.
        assert not portier.CHEMINS_TABLE.match(chemin), chemin
    for chemin in ("/static/css/table.css", "/static/css/affiches.css", "/static/css/horloges-tv.css", "/static/fonts/Cinzel-VF.woff2",
                   "/static/img/carte-parchemin.jpg", "/static/img/planche-chene.jpg", "/static/img/kit/sang-1.svg",
                   "/static/img/eveil.mp4",  # la vidéo qui garde l'écran de la table allumé (js/ecran-tv/eveil.js)
                   # les jingles des tests, joués avec le bandeau du jet (js/ecran-tv/sons-jets.js)
                   "/static/sons/jet-reussite.mp3", "/static/sons/jet-reussite-critique.mp3", "/static/sons/jet-echec.mp3",
                   "/static/sons/jet-echec-critique.mp3"):
        # Les jingles viennent du pack de campagne (docs/campagne.md) : sans lui, ils n'existent pas.
        if chemin.startswith("/static/sons/") and not (Path(__file__).resolve().parents[1] / "app" / chemin[1:]).is_file():
            continue
        assert client.get(chemin, headers=entetes).status_code == 200, chemin
    # Sur le réseau local, l'atelier lit tout son code, comme avant.
    assert client.get("/static/js/auberge/kit.js").status_code == 200


def test_tout_ce_que_charge_la_page_de_la_tv_reste_lisible_par_internet():
    """Les feuilles, polices, textures et scripts que nomment table.html, ses feuilles et js/table.js : un fichier ajouté à
    la TV sans être ajouté à STATIQUES_TABLE laisserait la table publique sans lui."""
    import re
    statique = Path(config.ICI) / "static"
    html = (statique / "table.html").read_text(encoding="utf-8")
    chemins = set(re.findall(r'(?:href|src)="(/static/[^"]+)"', html))
    for css in [c for c in chemins if c.endswith(".css")]:
        for url in re.findall(r'url\("?([^")]+)"?\)', (statique / css.removeprefix("/static/")).read_text(encoding="utf-8")):
            if not url.startswith("data:"):
                chemins.add("/static/" + os.path.normpath(os.path.join(os.path.dirname(css.removeprefix("/static/")), url)))
    chemins |= set(re.findall(r'"(/static/[^"]+)"', source_page("table")))
    assert "/static/tv/table.js" in chemins and "/static/tv/peint-worker.js" in chemins and len(chemins) > 8
    for chemin in chemins:
        assert portier.CHEMINS_TABLE.match(chemin), chemin


def test_par_cloudflare_la_racine_mene_a_la_table(client):
    r = client.get("/", headers=CF, follow_redirects=False)
    assert r.status_code == 307 and r.headers["location"] == "/table"


@pytest.mark.parametrize("chemin", OUVERTS_EN_LOCAL + ["/api/table", "/api/ia/couts", "/api/bible", "/fiche-seance", "/feuille-combat", "/fiche-aventurier.pdf",
                                    "/billets", "/billets?seance=seance"])
def test_par_cloudflare_l_atelier_reste_ferme(client, chemin):
    assert client.get(chemin, headers=CF).status_code == 404


def test_par_cloudflare_on_ne_change_pas_la_tv(client):
    avant = client.get("/api/table").json()
    assert client.put("/api/table", json={"vue": "heros"}, headers=CF).status_code == 404
    assert client.post("/api/table/heros", json={}, headers=CF).status_code == 404
    assert client.get("/api/table").json().get("vue") == avant.get("vue")


def test_le_nom_public_seul_suffit_a_fermer_l_atelier(client, monkeypatch):
    monkeypatch.setattr(portier, "TABLE_PUBLIQUE", {"table.example.ch"})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {"table.example.ch"})
    h = {"Host": "table.example.ch"}
    assert client.get("/table", headers=h).status_code == 200
    assert client.get("/api/aventuriers", headers=h).status_code == 404


def test_sur_le_reseau_local_rien_ne_change(client):
    assert client.get("/", follow_redirects=False).status_code == 200
    assert client.get("/api/table").status_code == 200
    for chemin in OUVERTS_EN_LOCAL:
        assert client.get(chemin).status_code == 200, chemin


# ---------------------------------------------------------------- table publique ouverte ou fermée, places des écrans

from datetime import date  # noqa: E402
import json  # noqa: E402

from starlette.websockets import WebSocketDisconnect  # noqa: E402


@pytest.fixture
def reglage_neuf():
    """Chaque essai part de la table publique sans réglage (donc ouverte) et la laisse ainsi."""
    config.TABLE_OUVERTURE.unlink(missing_ok=True)
    yield
    config.TABLE_OUVERTURE.unlink(missing_ok=True)


def fermer(client, ouverte=False):
    r = client.put("/api/table-publique", json={"ouverte": ouverte})
    assert r.status_code == 200 and r.json()["ouverte"] is ouverte
    return r.json()


def test_sans_reglage_la_table_publique_reste_ouverte(client, reglage_neuf):
    client.put("/api/table", json={"vue": "planche"})
    etat = client.get("/api/table").json()
    assert etat["publique"]["ouverte"] is True and etat["publique"]["modifie"] is None
    with client.websocket_connect("/ws/table", headers=CF) as ws:
        assert ws.receive_json()["etat"]["vue"] == "planche"
    assert client.get("/api/table/planche", headers=CF).status_code == 200


def test_fermee_internet_n_a_que_l_accueil_et_le_salon_rien_ne_change(client, reglage_neuf, monkeypatch):
    monkeypatch.setattr(tv_etat, "prochaine_seance", lambda: "dimanche 1er novembre à 14 h")
    client.put("/api/table", json={"vue": "plan", "plan": "la-petite-fanfrelee", "pnj": "un-pnj", "camera": None})
    fermer(client)
    with client.websocket_connect("/ws/table", headers=CF) as dehors, client.websocket_connect("/ws/table") as salon:
        assert dehors.receive_json()["etat"] == {"vue": "accueil", "prochaine": "dimanche 1er novembre à 14 h"}
        recu = salon.receive_json()["etat"]
        assert recu["vue"] == "plan" and recu["plan"] and "prochaine" not in recu
        # Ce que le MJ envoie ensuite : le salon le reçoit, Internet garde l'accueil.
        client.put("/api/table", json={"vue": "carte", "carte": "x", "camera": None})
        assert salon.receive_json()["etat"]["vue"] == "carte"
        assert dehors.receive_json()["etat"] == {"vue": "accueil", "prochaine": "dimanche 1er novembre à 14 h"}
    # Les routes de la table se ferment à Internet ; la page, ses fichiers et le WebSocket restent.
    for chemin in ("/api/table/planche", "/api/table/heros", "/api/table/fiches", "/api/table/plan/abc", "/api/table/episode/abc"):
        assert client.get(chemin, headers=CF).status_code == 404, chemin
    assert client.get("/table", headers=CF).status_code == 200
    assert client.get("/static/css/table.css", headers=CF).status_code == 200
    assert client.get("/api/table/planche").status_code == 200
    assert client.get("/api/table/heros").status_code == 200


def test_fermee_sans_seance_datee_l_accueil_est_nu(client, reglage_neuf, monkeypatch):
    monkeypatch.setattr(tv_etat, "prochaine_seance", lambda: "")
    fermer(client)
    with client.websocket_connect("/ws/table", headers=CF) as ws:
        assert ws.receive_json()["etat"] == {"vue": "accueil"}


def test_l_interrupteur_prend_effet_sur_les_ecrans_deja_branches(client, reglage_neuf):
    client.put("/api/table", json={"vue": "planche"})
    with client.websocket_connect("/ws/table", headers=CF) as dehors, client.websocket_connect("/ws/table") as salon:
        assert dehors.receive_json()["etat"]["vue"] == "planche"
        assert salon.receive_json()["etat"]["vue"] == "planche"
        reponse = fermer(client)
        assert reponse["ecrans_salon"] == 1 and reponse["ecrans_internet"] == 1 and reponse["ecrans"] == 1
        assert dehors.receive_json()["etat"]["vue"] == "accueil"
        reponse = fermer(client, ouverte=True)
        assert reponse["ecrans"] == 2
        assert dehors.receive_json()["etat"]["vue"] == "planche"
        etat = client.get("/api/table").json()
        assert etat["ecrans_salon"] == 1 and etat["ecrans_internet"] == 1 and etat["publique"]["ouverte"] is True


def test_l_interrupteur_se_manie_du_salon_seulement(client, reglage_neuf):
    assert client.put("/api/table-publique", json={"ouverte": False}, headers=CF).status_code == 404
    assert client.get("/api/table-publique", headers=CF).status_code == 404
    assert not config.TABLE_OUVERTURE.exists()
    assert client.put("/api/table-publique", json={"ouverte": "non"}).status_code == 400
    assert client.put("/api/table-publique", json={}).status_code == 400
    assert not config.TABLE_OUVERTURE.exists()


def test_un_reglage_illisible_ferme_la_table(client, reglage_neuf):
    config.TABLE_OUVERTURE.write_text("{pas du json", encoding="utf-8")
    assert client.get("/api/table").json()["publique"]["ouverte"] is False
    assert client.get("/api/table/planche", headers=CF).status_code == 404
    config.TABLE_OUVERTURE.write_text(json.dumps({"ouverte": "oui"}), encoding="utf-8")
    assert client.get("/api/table").json()["publique"]["ouverte"] is False


def test_ce_que_l_atelier_relit_n_est_jamais_enregistre(client, reglage_neuf):
    lu = client.get("/api/table").json()
    assert {"ecrans", "ecrans_salon", "ecrans_internet", "publique"} <= set(lu)
    client.put("/api/table", json={**lu, "vue": "heros"})
    enregistre = json.loads(config.TABLE.read_text(encoding="utf-8"))
    assert enregistre["vue"] == "heros"
    assert not {"ecrans", "ecrans_salon", "ecrans_internet", "publique"} & set(enregistre)


def test_internet_a_sa_limite_et_la_tv_du_salon_toujours_sa_place(client, reglage_neuf, monkeypatch):
    monkeypatch.setattr(config, "ECRANS_MAX", 2)
    with client.websocket_connect("/ws/table", headers=CF) as a, client.websocket_connect("/ws/table", headers=CF) as b:
        a.receive_json(), b.receive_json()
        with client.websocket_connect("/ws/table", headers=CF) as refuse:
            with pytest.raises(WebSocketDisconnect) as fin:
                refuse.receive_json()
            assert fin.value.code == 1013
        with client.websocket_connect("/ws/table") as tv, client.websocket_connect("/ws/table") as mac, \
                client.websocket_connect("/ws/table") as ipad:
            for ecran in (tv, mac, ipad):
                assert ecran.receive_json()["type"] == "etat"
            etat = client.get("/api/table").json()
            assert etat["ecrans_salon"] == 3 and etat["ecrans_internet"] == 2 and etat["ecrans"] == 5
    etat = client.get("/api/table").json()
    assert etat["ecrans_salon"] == 0 and etat["ecrans_internet"] == 0


def test_une_adresse_ne_prend_pas_toutes_les_places(client, reglage_neuf, monkeypatch):
    monkeypatch.setattr(config, "ECRANS_PAR_ADRESSE", 2)
    autre = {"CF-Connecting-IP": "198.51.100.44"}
    with client.websocket_connect("/ws/table", headers=CF) as a, client.websocket_connect("/ws/table", headers=CF) as b:
        a.receive_json(), b.receive_json()
        with client.websocket_connect("/ws/table", headers=CF) as refuse:
            with pytest.raises(WebSocketDisconnect) as fin:
                refuse.receive_json()
            assert fin.value.code == 1013
        # Une autre adresse garde sa place, et l'écran refusé n'en occupe aucune.
        with client.websocket_connect("/ws/table", headers=autre) as c:
            assert c.receive_json()["type"] == "etat"
            assert client.get("/api/table").json()["ecrans_internet"] == 3
    # Les places se libèrent quand les écrans partent.
    with client.websocket_connect("/ws/table", headers=CF) as a, client.websocket_connect("/ws/table", headers=CF) as b:
        assert a.receive_json()["type"] == "etat" and b.receive_json()["type"] == "etat"


def test_la_prochaine_seance_en_clair(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SEANCES", tmp_path)
    assert tv_etat.prochaine_seance(date(2026, 11, 1)) == ""
    seances = {
        "close": {"nom": "La Petite Fanfrelée", "date": "2026-11-01", "heure": "10:00", "close": True},
        "passee": {"date": "2026-10-25", "heure": "14:00"},
        "dimanche": {"nom": "Une nouvelle compagnie", "date": "2026-11-01", "heure": "14:00"},
        "suivante": {"date": "2026-11-08", "heure": "20:30"},
        "sans-date": {"date": "", "heure": "09:00"},
        "nouvel-an": {"date": "2027-01-03", "heure": "14h"},
    }
    for ident, s in seances.items():
        (tmp_path / f"{ident}.json").write_text(json.dumps({"id": ident, **s}), encoding="utf-8")
    assert tv_etat.prochaine_seance(date(2026, 11, 1)) == "dimanche 1er novembre à 14 h"
    assert tv_etat.prochaine_seance(date(2026, 11, 2)) == "dimanche 8 novembre à 20 h 30"
    assert tv_etat.prochaine_seance(date(2026, 11, 9)) == "dimanche 3 janvier 2027"
    assert tv_etat.prochaine_seance(date(2027, 1, 4)) == ""


def test_par_cloudflare_une_boutique_se_lit_comme_la_tv_la_voit(client, reglage_neuf):
    """La boutique montrée à la TV passe par /api/table/boutique/<jeton>, lisible depuis Internet comme les autres vues
    de la table ; la fiche du MJ (/api/boutiques), jamais. Table publique fermée : 404 aussi."""
    b = client.post("/api/boutiques", json={"nom": "Échoppe en ligne", "notes_mj": "NOTE-DU-MJ-EN-LIGNE",
                                            "articles": [{"id": "abc123", "nom": "Corde", "prix": "2", "note_mj": "NOTE-ARTICLE-EN-LIGNE"}]}).json()
    j = tv_cartes.jeton("boutiques", b["id"])
    assert client.get(f"/api/table/boutique/{j}", headers=CF).status_code == 404  # pas encore montrée
    client.put("/api/table", json={"vue": "boutique", "boutique": b["id"]})
    r = client.get(f"/api/table/boutique/{j}", headers=CF)
    assert r.status_code == 200 and r.json()["articles"][0]["nom"] == "Corde"
    assert "NOTE-DU-MJ" not in r.text and "NOTE-ARTICLE" not in r.text
    for chemin in ("/api/boutiques", f"/api/boutiques/{b['id']}"):
        assert client.get(chemin, headers=CF).status_code == 404, chemin
    assert client.put(f"/api/boutiques/{b['id']}", json={"nom": "Piratée"}, headers=CF).status_code == 404
    assert client.get(f"/api/table/boutique/{b['id']}", headers=CF).status_code == 404
    fermer(client)
    assert client.get(f"/api/table/boutique/{j}", headers=CF).status_code == 404
    assert client.get(f"/api/table/boutique/{j}").status_code == 200
    client.put("/api/table", json={"vue": "accueil"})
    client.delete(f"/api/boutiques/{b['id']}")


@pytest.mark.parametrize("entetes", [CF, {"Host": "table.example.ch"}])
def test_les_billets_secrets_restent_dans_l_atelier(client, monkeypatch, reglage_neuf, entetes):
    """Les billets d'une séance sont pour le MJ : ni leur feuille à imprimer, ni son script, ni la séance qui les porte ne
    se lisent depuis Internet, même quand la TV montre le « Précédemment » ou le titre de cette séance."""
    monkeypatch.setattr(portier, "TABLE_PUBLIQUE", {"table.example.ch"})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {"table.example.ch"})
    s = client.post("/api/seances", json={"nom": "Séance de la porte", "numero": 77, "precedemment": "Ils ont fui.", "close": True,
                                          "deroule": [{"titre": "La porte", "cle": "sc-porte"}],
                                          "billets": [{"id": "b-1", "pour": ["j1"], "titre": "BILLET-TITRE", "texte": "BILLET-SECRET-PORTE",
                                                       "scene": "sc-porte", "remis": False}]}).json()
    j = tv_cartes.jeton("seances", s["id"])
    for chemin in (f"/billets?seance={s['id']}", "/static/billets.html", "/static/js/seances/billets-page.js", "/static/js/seances/billets.js",
                   "/static/css/billets.css", "/api/seances", f"/api/seances/{s['id']}"):
        r = client.get(chemin, headers=entetes)
        assert r.status_code == 404 and "BILLET-" not in r.text, chemin
    for vue, route in (("precedemment", "precedemment"), ("episode", "episode")):
        client.put("/api/table", json={"vue": vue, "seance": s["id"]})
        r = client.get(f"/api/table/{route}/{j}", headers=entetes)
        assert r.status_code == 200 and "BILLET-" not in r.text and "billets" not in r.json(), route
    with client.websocket_connect("/ws/table", headers=entetes) as ws:
        assert "BILLET-" not in json.dumps(ws.receive_json(), ensure_ascii=False)
    # Sur le réseau local, l'atelier sert la feuille.
    assert client.get(f"/billets?seance={s['id']}").status_code == 200
    client.put("/api/table", json={"vue": "accueil"})
    client.delete(f"/api/seances/{s['id']}")
