"""« Changer mon mot de passe » (page Réglages, mot_de_passe_mj.py) : chacun le sien, l'actuel d'abord, 12 caractères au
moins ; les sessions et les appareils reconnus tombent, celui du geste reste dans l'atelier ; l'empreinte de
l'environnement ne revient pas au démarrage suivant, mais un nouveau mot de passe tiré par outils/mot-de-passe.py
l'emporte ; les essais manqués comptent avec ceux de la connexion ; rien ne sort d'une empreinte."""

import hashlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402

from mj import acces_mj  # noqa: E402
from mj import cloisonnement  # noqa: E402
from mj import comptes_mj  # noqa: E402
import deux_mj  # noqa: E402
import main  # noqa: E402
from api import application, config, portier, tv_etat  # noqa: E402
from mj import porte_lan  # noqa: E402

HOTE = "atelier-reglages.example.ch"
IP = "203.0.113.44"
PUBLIC = {"Host": HOTE, "CF-Connecting-IP": IP}
ECRIRE = PUBLIC | {"Origin": f"https://{HOTE}"}
MDP = "lanterne-corbeau-moulin-givre-47"
NEUF = "chardon-enclume-tisane-sorbier-62"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
ROUTE = "/api/mj/mot-de-passe"


def empreinte(mdp: str) -> str:
    sel = b"0123456789abcdef"
    h = hashlib.scrypt(mdp.encode(), salt=sel, n=2 ** 10, r=8, p=1, dklen=32)
    return f"scrypt:{2 ** 10}:8:1:{sel.hex()}:{h.hex()}"


@pytest.fixture(scope="module")
def appli():
    with TestClient(application.app) as c:
        yield c


def repartir_de_zero():
    shutil.rmtree(comptes_mj.dossier(config.DONNEES), ignore_errors=True)
    portier.ECHECS_CONNEXION.clear()


@pytest.fixture
def client(appli, monkeypatch):
    monkeypatch.setattr(porte_lan, "FORCAGE", "")
    monkeypatch.setattr(portier, "ATELIER_PUBLIC", {HOTE})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {HOTE})
    monkeypatch.setattr(portier, "EMPREINTE_MDP", empreinte(MDP))
    monkeypatch.setattr(portier, "CLE_SESSION", b"cle-de-test-reglages")
    monkeypatch.setattr(portier, "ATTENTE_ECHEC", 0)
    repartir_de_zero()
    appli.cookies.clear()
    yield appli
    appli.cookies.clear()
    repartir_de_zero()


def entrer(client, mdp, identifiant="alban"):
    r = client.post("/connexion", data={"identifiant": identifiant, "mot_de_passe": mdp, "suite": "/"}, headers=ECRIRE,
                    follow_redirects=False)
    client.cookies.clear()
    return r


def session(r) -> dict:
    assert r.status_code in (200, 303), r.text
    return ECRIRE | {"Cookie": r.headers["set-cookie"].split(";")[0]}


def changer(client, h, actuel=MDP, nouveau=NEUF, confirmation=None):
    r = client.post(ROUTE, json={"actuel": actuel, "nouveau": nouveau, "confirmation": nouveau if confirmation is None else confirmation},
                    headers=h)
    client.cookies.clear()
    return r


def fichier() -> dict:
    return json.loads(comptes_mj.chemin(config.DONNEES).read_text(encoding="utf-8"))


def journal() -> list:
    f = comptes_mj.dossier(config.DONNEES) / comptes_mj.JOURNAL
    return [json.loads(x) for x in f.read_text(encoding="utf-8").splitlines()] if f.exists() else []


def test_la_route_est_rangee_pour_chacun():
    assert acces_mj.REGLES["POST /api/mj/mot-de-passe"] == acces_mj.COMMUNE


def test_en_ligne_le_principal_change_le_sien(client):
    ancienne = session(entrer(client, MDP))
    autre = session(entrer(client, MDP))
    r = changer(client, ancienne)
    assert r.status_code == 200, r.text
    assert r.headers["cache-control"] == "no-store"
    # Rien d'une empreinte dans la réponse.
    assert "scrypt" not in r.text and "empreinte" not in r.text
    # Cet appareil reçoit une session neuve ; toutes les autres tombent, la sienne d'avant comprise.
    neuve = ECRIRE | {"Cookie": r.headers["set-cookie"].split(";")[0]}
    assert "Secure" in r.headers["set-cookie"] and "HttpOnly" in r.headers["set-cookie"]
    assert client.get("/api/moi", headers=neuve).json()["compte"] == "alban"
    for vieille in (ancienne, autre):
        assert client.get("/api/aventuriers", headers=vieille).status_code == 401
    # Le nouveau mot de passe ouvre, l'ancien plus.
    assert entrer(client, NEUF).status_code == 303
    assert entrer(client, MDP).status_code == 401
    p = comptes_mj.principal(comptes_mj.lire(config.DONNEES))
    assert p["empreinte"].startswith("scrypt:") and p["empreinte"] != portier.EMPREINTE_MDP
    gestes = [x for x in journal() if x["geste"] == "mot-de-passe"]
    assert len(gestes) == 1 and gestes[0]["compte"] == "alban" and set(gestes[0]) == {"quand", "geste", "compte", "par"}
    assert "scrypt" not in (comptes_mj.dossier(config.DONNEES) / comptes_mj.JOURNAL).read_text(encoding="utf-8")


def test_l_empreinte_de_l_environnement_ne_revient_pas_mais_l_outil_l_emporte(client, monkeypatch):
    assert changer(client, session(entrer(client, MDP))).status_code == 200
    # Même environnement au démarrage suivant : le mot de passe changé tient.
    comptes_mj.assurer_principal(config.DONNEES, portier.EMPREINTE_MDP)
    assert entrer(client, NEUF).status_code == 303 and entrer(client, MDP).status_code == 401
    # L'ancien cookie d'avant les comptes ne vaut plus rien : son mot de passe a changé.
    etat = comptes_mj.lire(config.DONNEES)
    assert not comptes_mj.ancien_cookie_tient(etat, portier.EMPREINTE_MDP)
    # outils/mot-de-passe.py tire un autre mot de passe, puis docker compose up -d : l'environnement l'emporte.
    tire = "givre-lanterne-relais-orme-55"
    monkeypatch.setattr(portier, "EMPREINTE_MDP", empreinte(tire))
    assert entrer(client, tire).status_code == 303
    assert entrer(client, NEUF).status_code == 401


def test_les_regles_du_nouveau(client):
    h = session(entrer(client, MDP))
    assert changer(client, h, nouveau="court-11car").status_code == 400
    assert changer(client, h, confirmation="autre-chose-encore-62").status_code == 400
    assert changer(client, h, nouveau="alban").status_code == 400
    r = changer(client, h, nouveau=MDP)
    assert r.status_code == 400 and "différent" in r.json()["detail"]
    # Rien n'a changé.
    assert entrer(client, MDP).status_code == 303


def test_l_actuel_d_abord_et_les_essais_comptent_avec_la_connexion(client):
    h = session(entrer(client, MDP))
    r = changer(client, h, actuel="pas-le-bon-du-tout")
    assert r.status_code == 403 and r.json()["detail"] == "Mot de passe actuel incorrect."
    assert entrer(client, MDP).status_code == 303
    h = session(entrer(client, MDP))
    for _ in range(portier.ECHECS_PAR_ADRESSE):
        assert changer(client, h, actuel="pas-le-bon-du-tout").status_code == 403
    # La même adresse est à court d'essais : la connexion aussi l'est.
    assert changer(client, h).status_code == 429
    assert entrer(client, MDP).status_code == 429


def test_sur_le_reseau_local_porte_endormie(client):
    # Le principal, sans session : son mot de passe change aussi.
    r = client.post(ROUTE, json={"actuel": MDP, "nouveau": NEUF, "confirmation": NEUF})
    assert r.status_code == 200, r.text
    assert "set-cookie" not in r.headers
    assert entrer(client, NEUF).status_code == 303


def test_sur_le_reseau_local_cet_appareil_reste_reconnu(client):
    r = client.post("/api/mj/appareils", json={"nom": "Mac du salon"}, headers={"User-Agent": UA})
    valeur = r.headers["set-cookie"].split(";")[0].split("=", 1)[1]
    client.cookies.clear()
    autre = client.post("/api/mj/appareils", json={"nom": "iPad"}, headers={"User-Agent": UA})
    valeur_ipad = autre.headers["set-cookie"].split(";")[0].split("=", 1)[1]
    client.cookies.clear()
    mac = {"Cookie": f"{porte_lan.COOKIE}={valeur}", "User-Agent": UA}
    r = client.post(ROUTE, json={"actuel": MDP, "nouveau": NEUF, "confirmation": NEUF}, headers=mac)
    client.cookies.clear()
    assert r.status_code == 200, r.text
    neuf = r.headers["set-cookie"].split(";")[0].split("=", 1)[1]
    assert r.headers["set-cookie"].startswith(porte_lan.COOKIE) and neuf != valeur
    # La porte éveillée : seul l'appareil du geste entre encore, sous son nom.
    porte_lan.FORCAGE = porte_lan.EVEILLEE
    try:
        assert client.get("/api/aventuriers", headers={"Cookie": f"{porte_lan.COOKIE}={neuf}", "User-Agent": UA}).status_code == 200
        for vieux in (valeur, valeur_ipad):
            assert client.get("/api/aventuriers", headers={"Cookie": f"{porte_lan.COOKIE}={vieux}", "User-Agent": UA}).status_code == 401
        vue = client.get("/api/mj/appareils", headers={"Cookie": f"{porte_lan.COOKIE}={neuf}", "User-Agent": UA}).json()
        assert [a["nom"] for a in vue["appareils"]] == ["Mac du salon"] and vue["cet_appareil"] == vue["appareils"][0]["id"]
    finally:
        porte_lan.FORCAGE = ""


def test_sans_mot_de_passe_rien_a_changer(client, monkeypatch):
    monkeypatch.setattr(portier, "EMPREINTE_MDP", "")
    r = client.post(ROUTE, json={"actuel": "", "nouveau": NEUF, "confirmation": NEUF})
    assert r.status_code == 409 and "outils/mot-de-passe.py" in r.json()["detail"]


@pytest.fixture
def deux(appli, monkeypatch):
    monkeypatch.setattr(portier, "ATTENTE_ECHEC", 0)
    monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.STRICT)
    portier.ECHECS_CONNEXION.clear()
    alban, lea = deux_mj.ouvrir(monkeypatch, garde_stricte=True)
    appli.cookies.clear()
    yield appli, alban, lea
    appli.cookies.clear()
    portier.ECHECS_CONNEXION.clear()
    deux_mj.fermer()


def test_l_invite_change_le_sien_et_seulement_le_sien(deux):
    client, alban, lea = deux
    avant = comptes_mj.principal(comptes_mj.lire(config.DONNEES))["empreinte"]
    r = client.post(ROUTE, json={"actuel": "cire-et-chandelle-12", "nouveau": NEUF, "confirmation": NEUF}, headers=lea)
    client.cookies.clear()
    assert r.status_code == 200, r.text
    etat = comptes_mj.lire(config.DONNEES)
    assert comptes_mj.principal(etat)["empreinte"] == avant
    assert comptes_mj.par_id(etat, deux_mj.INVITE)["empreinte"] != deux_mj.empreinte("cire-et-chandelle-12")
    # Sa session d'avant tombe ; celle d'Alban tient.
    assert client.get("/api/moi", headers=lea).status_code == 401
    assert client.get("/api/moi", headers=alban).json()["compte"] == "alban"
    neuve = {**lea, "Cookie": r.headers["set-cookie"].split(";")[0]}
    assert client.get("/api/moi", headers=neuve).json()["compte"] == deux_mj.INVITE
    # Le mot de passe d'Alban ne sert pas à changer celui de l'invité, ni l'inverse : la route ne prend aucun compte.
    r = client.post(ROUTE, json={"actuel": deux_mj.MDP, "nouveau": "autre-chose-de-long-77", "confirmation": "autre-chose-de-long-77",
                                 "compte": "alban"}, headers=neuve)
    client.cookies.clear()
    assert r.status_code == 403
    assert comptes_mj.principal(comptes_mj.lire(config.DONNEES))["empreinte"] == avant


def test_les_pages_ouvertes_du_compte_cessent_d_ecouter(deux):
    """Une session coupée ne garde pas le canal de l'atelier qu'elle avait ouvert avant le changement ; celui de l'autre
    MJ reste ouvert."""
    client, alban, lea = deux
    with client.websocket_connect("/ws/atelier", headers=lea) as ws_lea, \
            client.websocket_connect("/ws/atelier", headers=alban) as ws_alban:
        assert ws_lea.receive_json()["type"] == "etat" and ws_alban.receive_json()["type"] == "etat"
        assert len(tv_etat.diffusion.atelier) == 2
        r = client.post(ROUTE, json={"actuel": "cire-et-chandelle-12", "nouveau": NEUF, "confirmation": NEUF}, headers=lea)
        client.cookies.clear()
        assert r.status_code == 200, r.text
        with pytest.raises(WebSocketDisconnect):
            ws_lea.receive_json()
        assert list(tv_etat.diffusion.atelier.values()) == ["alban"]
    # Rouvert avec l'ancienne session : refusé ; avec la neuve : il écoute de nouveau.
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/atelier", headers=lea) as ws:
            ws.receive_json()
    neuve = {**lea, "Cookie": r.headers["set-cookie"].split(";")[0]}
    with client.websocket_connect("/ws/atelier", headers=neuve) as ws:
        assert ws.receive_json()["type"] == "etat"
