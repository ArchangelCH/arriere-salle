"""L'atelier entier publié par le tunnel (atelier.exemple.org), derrière un mot de passe."""

import hashlib
import os
import sys
import tempfile
import time
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, portier  # noqa: E402

HOTE = "atelier.example.ch"
MDP = "lanterne-corbeau-moulin-givre-47"
PUBLIC = {"Host": HOTE, "CF-Connecting-IP": "203.0.113.9"}


def empreinte(mdp: str) -> str:
    sel = b"0123456789abcdef"
    h = hashlib.scrypt(mdp.encode(), salt=sel, n=2 ** 10, r=8, p=1, dklen=32)
    return f"scrypt:{2 ** 10}:8:1:{sel.hex()}:{h.hex()}"


@pytest.fixture(scope="module")
def appli():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture
def client(appli, monkeypatch):
    monkeypatch.setattr(portier, "ATELIER_PUBLIC", {HOTE})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {HOTE})
    monkeypatch.setattr(portier, "EMPREINTE_MDP", empreinte(MDP))
    monkeypatch.setattr(portier, "CLE_SESSION", b"cle-de-test")
    monkeypatch.setattr(portier, "ATTENTE_ECHEC", 0)
    portier.ECHECS_CONNEXION.clear()
    appli.cookies.clear()
    yield appli
    portier.ECHECS_CONNEXION.clear()


def entrer(client, mdp=MDP, suite="/", ip="203.0.113.9"):
    return client.post("/connexion", data={"mot_de_passe": mdp, "suite": suite},
                       headers={"Host": HOTE, "CF-Connecting-IP": ip, "Origin": f"https://{HOTE}"},
                       follow_redirects=False)


def avec_session(client) -> dict:
    r = entrer(client)
    assert r.status_code == 303
    jeton = r.headers["set-cookie"].split(";")[0]
    return PUBLIC | {"Cookie": jeton}


def test_sans_session_la_page_mene_a_la_connexion(client):
    r = client.get("/", headers=PUBLIC, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/connexion"
    r = client.get("/feuille-combat?id=x", headers=PUBLIC, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/connexion?suite=%2Ffeuille-combat%3Fid%3Dx"


@pytest.mark.parametrize("chemin", ["/api/aventuriers", "/api/pnj", "/api/table", "/api/table/heros", "/table",
                                    "/static/js/api.js", "/media/x.png", "/api/ia/couts"])
def test_sans_session_rien_ne_sort(client, chemin):
    r = client.get(chemin, headers=PUBLIC, follow_redirects=False)
    assert r.status_code in (303, 401)
    assert r.status_code == 401 or r.headers["location"].startswith("/connexion")


def test_sans_session_ni_ecriture_ni_websocket(client):
    assert client.put("/api/table", json={"vue": "heros"}, headers=PUBLIC | {"Origin": f"https://{HOTE}"}).status_code == 401
    for chemin in ("/ws/table", "/ws/pointeur"):
        with pytest.raises(Exception):
            with client.websocket_connect(chemin, headers=PUBLIC) as ws:
                ws.receive_json()


def test_la_page_de_connexion_et_ses_polices_repondent(client):
    r = client.get("/connexion?suite=/pnj", headers=PUBLIC)
    assert r.status_code == 200 and "mot_de_passe" in r.text and 'value="/pnj"' in r.text
    assert r.headers["cache-control"] == "no-store"
    assert client.get("/static/fonts/Cinzel-VF.woff2", headers=PUBLIC).status_code == 200


def test_mauvais_mot_de_passe(client):
    r = entrer(client, "pas-le-bon")
    assert r.status_code == 401 and "Identifiant ou mot de passe incorrect" in r.text and "set-cookie" not in r.headers


def test_bon_mot_de_passe_ouvre_tout_l_atelier(client):
    r = entrer(client, suite="/feuille-combat?id=x")
    assert r.status_code == 303 and r.headers["location"] == "/feuille-combat?id=x"
    cookie = r.headers["set-cookie"]
    assert "__Host-arriere-salle=" in cookie and "Secure" in cookie and "HttpOnly" in cookie
    assert "samesite=lax" in cookie.lower() and "Path=/" in cookie
    h = avec_session(client)
    assert client.get("/", headers=h).status_code == 200
    assert client.get("/api/aventuriers", headers=h).status_code == 200
    assert client.get("/api/table", headers=h).status_code == 200
    with client.websocket_connect("/ws/pointeur", headers=h):
        pass
    with client.websocket_connect("/ws/table", headers=h) as ws:
        assert ws.receive_json()["type"] == "etat"


def test_session_falsifiee_ou_expiree(client):
    h = avec_session(client)
    # La session d'un compte MJ (comptes_mj.py) : « compte.génération.appareil.échéance.signature ».
    compte, generation, appareil, expire, signature = h["Cookie"].split("=", 1)[1].split(".")
    assert compte == "alban"
    faux = PUBLIC | {"Cookie": f"__Host-arriere-salle={compte}.{generation}.{appareil}.{int(expire) + 999}.{signature}"}
    assert client.get("/api/aventuriers", headers=faux).status_code == 401
    autre = PUBLIC | {"Cookie": f"__Host-arriere-salle=autre.{generation}.{appareil}.{expire}.{signature}"}
    assert client.get("/api/aventuriers", headers=autre).status_code == 401
    passe = int(time.time()) - 10
    vieux = PUBLIC | {"Cookie": f"__Host-arriere-salle={passe}.{portier.signature_session(passe)}"}
    assert client.get("/api/aventuriers", headers=vieux).status_code == 401


def test_changer_le_mot_de_passe_deconnecte(client, monkeypatch):
    h = avec_session(client)
    monkeypatch.setattr(portier, "EMPREINTE_MDP", empreinte("un-autre-mot-de-passe"))
    assert client.get("/api/aventuriers", headers=h).status_code == 401


def test_sans_empreinte_personne_n_entre(client, monkeypatch):
    monkeypatch.setattr(portier, "EMPREINTE_MDP", "")
    assert entrer(client).status_code == 401


def test_la_session_ne_vaut_pas_sur_la_table_publique(client, monkeypatch):
    monkeypatch.setattr(portier, "TABLE_PUBLIQUE", {"table.example.ch"})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {"table.example.ch"})
    h = avec_session(client)
    ailleurs = {"Host": "table.example.ch", "CF-Connecting-IP": "203.0.113.9", "Cookie": h["Cookie"]}
    assert client.get("/api/aventuriers", headers=ailleurs).status_code == 404


def test_suite_vers_un_autre_site_refusee(client):
    for suite in ("//mechant.example", "https://mechant.example", "/\\mechant.example"):
        assert entrer(client, suite=suite).headers["location"] == "/"
    assert 'value="/"' in client.get("/connexion?suite=//mechant.example", headers=PUBLIC).text


def test_trop_d_essais(client, monkeypatch):
    for _ in range(portier.ECHECS_PAR_ADRESSE):
        assert entrer(client, "faux").status_code == 401
    r = entrer(client)  # même le bon mot de passe attend
    assert r.status_code == 429 and "set-cookie" not in r.headers
    assert entrer(client, ip="198.51.100.4").status_code == 303  # une autre adresse n'est pas bloquée


def test_plafond_global(client, monkeypatch):
    monkeypatch.setattr(portier, "ECHECS_EN_TOUT", 3)
    for i in range(3):
        assert entrer(client, "faux", ip=f"198.51.100.{i}").status_code == 401
    # Le plafond atteint ne ferme pas la porte : le bon mot de passe entre encore d'une adresse qui n'a rien manqué.
    assert entrer(client, ip="198.51.100.200").status_code == 303
    # Mais une adresse n'a plus que deux essais manqués, au lieu de cinq.
    assert entrer(client, "faux", ip="198.51.100.0").status_code == 401
    assert entrer(client, "faux", ip="198.51.100.0").status_code == 429
    assert entrer(client, ip="198.51.100.0").status_code == 429
    assert entrer(client, ip="198.51.100.201").status_code == 303


def test_origine_etrangere_refusee(client):
    r = client.post("/connexion", data={"mot_de_passe": MDP}, follow_redirects=False,
                    headers=PUBLIC | {"Origin": "https://mechant.example"})
    assert r.status_code == 403


def test_sur_le_lan_rien_ne_change(client):
    assert client.get("/api/aventuriers").status_code == 200
    assert client.get("/", headers={"Host": "192.0.2.10:8323"}).status_code == 200


# Les routes d'écriture ajoutées par le premier passage du chantier « ergonomie » (corbeille, versions, journal, liens des
# joueurs, scène suivante, combat signalé) : aucune ne s'ouvre à la table publique, à l'atelier en ligne sans session, ni
# à une page d'une autre origine, même d'un domaine frère (le coin des joueurs) avec la session du MJ.
ECRITURES_NEUVES = [
    ("post", "/api/corbeille/pnj/x-20261104-120000/remettre"), ("post", "/api/corbeille/pnj/x/annuler"),
    ("post", "/api/versions/pnj/x/20261104-120000/remettre"), ("post", "/api/seances/x/journal/remettre"),
    ("post", "/api/joueurs/x/relier"), ("delete", "/api/joueurs/x/relier"), ("post", "/api/telecommande/commandes"),
    ("put", "/api/seances/x/combat"), ("delete", "/api/seances/x/combat"), ("post", "/api/horloges/avancer"),
    ("delete", "/api/sanctuaire/versements/x"),
]


@pytest.mark.parametrize("methode,chemin", ECRITURES_NEUVES)
def test_les_ecritures_neuves_restent_fermees(client, methode, chemin):
    envoi = (lambda h: client.request(methode.upper(), chemin, json={}, headers=h, follow_redirects=False))
    assert envoi({"CF-Connecting-IP": "203.0.113.9"}).status_code == 404
    assert envoi(PUBLIC | {"Origin": f"https://{HOTE}"}).status_code == 401
    session = avec_session(client)
    for origine in ("https://mechant.example", "https://joueurs.exemple.org", "null"):
        assert envoi(session | {"Origin": origine}).status_code == 403, origine
        assert envoi({"Origin": origine}).status_code == 403, origine
    # Avec la session, depuis l'atelier en ligne lui-même : la route répond (refus métier, jamais la garde).
    assert envoi(session | {"Origin": f"https://{HOTE}"}).status_code not in (401, 403)


def test_sans_session_un_renommage_ne_se_dit_pas(client):
    """L'ancien identifiant d'une fiche renommée (liens_fiches.py) : sans session, ni la fiche ni son nouvel identifiant,
    qui dit son nom, ne sortent ; avec la session, l'écran resté dessus la retrouve."""
    p = client.post("/api/pnj", json={"nom": "Nouveau PNJ en ligne", "rang": "civil", "connu": False}).json()
    client.patch(f"/api/pnj/{p['id']}", json={"nom": "Ombre du Notaire"})
    neuf = client.post(f"/api/pnj/{p['id']}/identifiant", json={}).json()["id"]
    assert neuf == "ombre-du-notaire"
    r = client.get(f"/api/pnj/{p['id']}", headers=PUBLIC)
    assert r.status_code == 401 and "x-identifiant" not in r.headers and neuf not in r.text
    r = client.get(f"/api/pnj/{p['id']}", headers=avec_session(client))
    assert r.status_code == 200 and r.json()["id"] == neuf and r.headers["x-identifiant"] == neuf
    client.delete(f"/api/pnj/{neuf}")
