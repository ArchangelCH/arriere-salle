"""La porte du réseau local (porte_lan.py, lot MJ-2) : dormante tant qu'aucun MJ invité n'existe (rien ne change), éveillée
par le premier invité ou par l'interrupteur de test. Éveillée : un appareil non reconnu est renvoyé à la connexion, un
appareil reconnu voit la même chose qu'avant ; un cookie forgé, périmé, oublié ou d'un compte fermé ne passe pas ; les
outils du serveur passent par leur jeton, le rendu PDF par un jeton à usage unique ; la TV et la sonde restent libres ;
ni le jeton ni le cookie n'entrent dans un journal."""

import hashlib
import json
import logging
import os
import secrets
import shutil
import stat
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402

from mj import cloisonnement  # noqa: E402
from mj import comptes_mj  # noqa: E402
import main  # noqa: E402
from api import pages  # noqa: E402
from api import application, config, portier, tv_cartes, utilitaires  # noqa: E402
from mj import porte_lan  # noqa: E402

HOTE_EN_LIGNE = "atelier-porte.example.ch"
HOTE_TABLE = "table-porte.example.ch"
MDP = "lanterne-corbeau-moulin-givre-47"
UA_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
PDF = b"%PDF-1.7\n" + b"0" * 4000


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
    portier.PORTE_LAN.rendus.clear()
    portier.PORTE_LAN.en_rendu.clear()


@pytest.fixture
def client(appli, monkeypatch):
    monkeypatch.setattr(porte_lan, "FORCAGE", "")
    monkeypatch.setattr(portier, "ATELIER_PUBLIC", {HOTE_EN_LIGNE})
    monkeypatch.setattr(portier, "TABLE_PUBLIQUE", {HOTE_TABLE})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {HOTE_EN_LIGNE, HOTE_TABLE})
    monkeypatch.setattr(portier, "EMPREINTE_MDP", empreinte(MDP))
    monkeypatch.setattr(portier, "CLE_SESSION", b"cle-de-test-porte")
    monkeypatch.setattr(portier, "ATTENTE_ECHEC", 0)
    repartir_de_zero()
    appli.cookies.clear()
    yield appli
    appli.cookies.clear()
    repartir_de_zero()


@pytest.fixture
def eveillee(monkeypatch):
    monkeypatch.setattr(porte_lan, "FORCAGE", porte_lan.EVEILLEE)


@pytest.fixture
def ouvertes(monkeypatch):
    # Les invitations ouvertes vont avec le strict : en veille, aucun invité n'entre.
    monkeypatch.setattr(comptes_mj, "INVITATIONS_OUVERTES", True)
    monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.STRICT)


def cookie_pose(r, nom=porte_lan.COOKIE) -> str:
    for entete in r.headers.get_list("set-cookie"):
        cle, _, reste = entete.partition("=")
        if cle.strip() == nom:
            return reste.split(";", 1)[0]
    return ""


def avec(valeur: str, ua: str = UA_MAC) -> dict:
    return {"Cookie": f"{porte_lan.COOKIE}={valeur}", "User-Agent": ua}


def reconnaitre(client, nom="Mac d'essai", ua=UA_MAC) -> str:
    """Reconnaît un appareil depuis le LAN (porte endormie, ou un appareil déjà reconnu) : la valeur de son cookie."""
    r = client.post("/api/mj/appareils", json={"nom": nom}, headers={"User-Agent": ua})
    assert r.status_code == 200, r.text
    client.cookies.clear()
    valeur = cookie_pose(r)
    assert valeur and r.json()["cet_appareil"]
    return valeur


def etat_fichier() -> dict:
    return json.loads(comptes_mj.chemin(config.DONNEES).read_text(encoding="utf-8"))


def creer_invite(nom="Lucas") -> dict:
    return comptes_mj.creer_invite(config.DONNEES, nom, secrets.token_urlsafe(24))


def ouvrir_invite(c: dict) -> dict:
    """Un invité qui a ouvert son lien (comptes_mj.accepter) : un compte ouvert."""
    cle = secrets.token_urlsafe(24)
    comptes_mj.nouveau_lien(config.DONNEES, c["id"], cle)
    return comptes_mj.accepter(config.DONNEES, cle, f"{c['id']}.mj", empreinte("mot-de-passe-de-l-invite"))


# ---------------------------------------------------------------- dormante : rien ne change

def test_dormante_le_lan_reste_alban(client):
    assert not portier.PORTE_LAN.eveillee()
    for adresse in ("/", "/api/aventuriers", "/telecommande", "/fiche-aventurier", "/billets", "/api/mj/comptes"):
        r = client.get(adresse, follow_redirects=False)
        assert r.status_code == 200, adresse
        assert porte_lan.COOKIE not in r.headers.get("set-cookie", "")
    assert client.get("/api/moi").json()["role"] == "principal"
    with client.websocket_connect("/ws/atelier"):
        pass
    # Rien d'éveillé : ni marque, ni cookie posé, et le bloc le dit.
    assert not (comptes_mj.dossier(config.DONNEES) / porte_lan.MARQUE).exists()
    vue = client.get("/api/mj/appareils", headers={"User-Agent": UA_MAC}).json()
    assert vue == {"porte": "dormante", "lan": True, "cet_appareil": None, "nom_propose": "Mac, Chrome", "appareils": []}


def test_un_fichier_illisible_avant_le_premier_invite_ne_change_rien(client):
    f = comptes_mj.chemin(config.DONNEES)
    f.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    f.write_text("{abîmé", encoding="utf-8")
    assert not portier.PORTE_LAN.eveillee()
    assert client.get("/api/aventuriers").status_code == 200
    assert f.read_text(encoding="utf-8") == "{abîmé"


def test_les_secrets_de_la_porte_sont_prives(client):
    portier.PORTE_LAN.preparer()
    d = comptes_mj.dossier(config.DONNEES)
    assert stat.S_IMODE(d.stat().st_mode) == 0o700
    for nom in (porte_lan.CLE, porte_lan.JETON_OUTILS):
        f = d / nom
        assert stat.S_IMODE(f.stat().st_mode) == 0o600 and len(f.read_text().strip()) >= 32
    assert config.PROPOSITIONS not in d.parents
    assert portier.PORTE_LAN.secret(porte_lan.CLE) != portier.PORTE_LAN.secret(porte_lan.JETON_OUTILS)


# ---------------------------------------------------------------- éveillée : qui passe, qui ne passe pas

def test_eveillee_un_appareil_non_reconnu_est_renvoye_a_la_connexion(client, eveillee):
    r = client.get("/", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/connexion"
    r = client.get("/fiche-aventurier?id=naima&verso=0", follow_redirects=False)
    assert r.status_code == 303 and parse_qs(urlsplit(r.headers["location"]).query)["suite"] == ["/fiche-aventurier?id=naima&verso=0"]
    for adresse in ("/telecommande", "/billets", "/carte-x"):
        assert client.get(adresse, follow_redirects=False).status_code == 303, adresse
    for adresse in ("/api/aventuriers", "/api/moi", "/api/mj/appareils", "/api/table", "/static/js/atelier.js",
                    "/static/index.html", "/api/bible"):
        r = client.get(adresse)
        assert r.status_code == 401 and r.json()["detail"] == "Connexion requise", adresse
    assert client.post("/api/pnj", json={"nom": "Intrus"}).status_code == 401
    assert client.post("/api/mj/appareils", json={"nom": "Intrus"}).status_code == 401
    for ws in ("/ws/atelier", "/ws/pointeur"):
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(ws):
                pass
    # La connexion, elle, répond.
    r = client.get("/connexion")
    assert r.status_code == 200 and 'action="/connexion"' in r.text


def test_eveillee_la_tv_et_la_sonde_restent_libres(client, eveillee):
    # La sonde d'Uptime Kuma : /table, par l'adresse du serveur, avec son mot.
    r = client.get("/table", headers={"Host": "192.0.2.10:8323"})
    assert r.status_code == 200 and "la table" in r.text
    assert client.get("/static/css/table.css").status_code == 200
    assert client.get("/static/fonts/Cinzel-VF.woff2").status_code == 200
    # De la table, ce qu'elle montre en ce moment, comme la table publique ouverte (lectures_publiques.py) : la TV ne lit
    # rien d'autre.
    avant = config.TABLE.read_bytes() if config.TABLE.exists() else None
    try:
        utilitaires.ecrire(config.TABLE, {"vue": "heros"})
        assert client.get("/api/table/heros").status_code == 200
        assert client.get("/api/table/fiches").status_code == 404
        utilitaires.ecrire(config.TABLE, {"vue": "fiches"})
        assert client.get("/api/table/fiches").status_code == 200
        assert client.get("/api/table/heros").status_code == 404
        # Un jeton retenu d'une fiche que la TV ne montre pas, une vue d'une autre heure : rien.
        utilitaires.ecrire(config.TABLE, {"vue": "accueil"})
        for adresse in ("/api/table/planche", "/api/table/sanctuaire", f"/api/table/pnj/{tv_cartes.jeton('pnj', 'gaspard')}",
                        f"/api/table/combat/{tv_cartes.jeton('seances', 'seance-1')}"):
            assert client.get(adresse).status_code == 404, adresse
        # Un appareil reconnu, lui, lit comme le MJ (table_au_compte).
        porte_lan.FORCAGE = ""
        valeur = reconnaitre(client)
        porte_lan.FORCAGE = porte_lan.EVEILLEE
        assert client.get("/api/table/heros", headers=avec(valeur)).status_code == 200
    finally:
        if avant is None:
            config.TABLE.unlink(missing_ok=True)
        else:
            config.TABLE.write_bytes(avant)
    # Une image ou un jeton inconnus : 404 comme avant (pas 401), le chemin reste ouvert.
    assert client.get("/media/inconnue.png").status_code == 404
    assert client.get("/api/table/vignette/inconnue.png").status_code == 404
    with client.websocket_connect("/ws/table") as ws:
        assert ws.receive_json()["type"] == "etat"
    # Pas d'écriture par les chemins de la TV.
    assert client.post("/api/table/heros").status_code == 401


def test_le_premier_invite_eveille_la_porte_pour_de_bon(client, ouvertes):
    assert not portier.PORTE_LAN.eveillee()
    creer_invite()
    assert portier.PORTE_LAN.eveillee()
    assert client.get("/api/aventuriers").status_code == 401
    marque = comptes_mj.dossier(config.DONNEES) / porte_lan.MARQUE
    assert marque.exists() and stat.S_IMODE(marque.stat().st_mode) == 0o600
    # Le fichier abîmé, ou l'invité retiré à la main : la porte reste éveillée.
    e = etat_fichier()
    e["comptes"] = [c for c in e["comptes"] if c["role"] != "invite"]
    comptes_mj.ecrire(config.DONNEES, e)
    assert portier.PORTE_LAN.eveillee() and client.get("/api/aventuriers").status_code == 401
    comptes_mj.chemin(config.DONNEES).write_text("{abîmé", encoding="utf-8")
    assert portier.PORTE_LAN.eveillee() and client.get("/api/aventuriers").status_code == 401
    assert client.get("/table").status_code == 200
    # Effacer la marque à la main rouvre le LAN.
    comptes_mj.ecrire(config.DONNEES, e)
    marque.unlink()
    assert not portier.PORTE_LAN.eveillee() and client.get("/api/aventuriers").status_code == 200


def test_un_invite_ferme_compte_aussi(client, ouvertes):
    c = creer_invite()
    comptes_mj.fermer(config.DONNEES, c["id"])
    assert not (comptes_mj.dossier(config.DONNEES) / porte_lan.MARQUE).exists()
    assert portier.PORTE_LAN.eveillee()


# ---------------------------------------------------------------- les appareils reconnus

def test_un_appareil_reconnu_voit_la_meme_chose(client):
    adresses = ("/", "/api/aventuriers", "/api/moi", "/api/table", "/api/musique", "/telecommande", "/api/etats-heros",
                "/fiche-aventurier", "/static/js/atelier.js", "/api/regles-maison")
    avant = {a: client.get(a).content for a in adresses}
    valeur = reconnaitre(client)
    porte_lan.FORCAGE = porte_lan.EVEILLEE
    try:
        for a in adresses:
            r = client.get(a, headers=avec(valeur), follow_redirects=False)
            assert r.status_code == 200 and r.content == avant[a], a
        assert client.get("/api/moi", headers=avec(valeur)).json()["role"] == "principal"
        with client.websocket_connect("/ws/atelier", headers=avec(valeur)):
            pass
        with client.websocket_connect("/ws/pointeur", headers=avec(valeur)):
            pass
        vue = client.get("/api/mj/appareils", headers=avec(valeur)).json()
        assert vue["porte"] == "eveillee" and vue["cet_appareil"] == vue["appareils"][0]["id"]
        assert vue["appareils"][0]["nom"] == "Mac d'essai"
        # Une écriture aussi.
        r = client.post("/api/pnj", json={"nom": "Gaspard de la porte"}, headers=avec(valeur))
        assert r.status_code == 200 and r.json()["auteur"] == "alban"
    finally:
        porte_lan.FORCAGE = ""


def test_le_cookie_est_signe_et_rattache(client, eveillee, monkeypatch):
    porte_lan.FORCAGE = ""
    valeur = reconnaitre(client)
    porte_lan.FORCAGE = porte_lan.EVEILLEE
    compte, appareil, echeance, sig = valeur.split(".")
    assert compte == "alban" and len(appareil) == 16 and echeance.isdigit()
    assert time.time() + 399 * 86400 < int(echeance) <= time.time() + 400 * 86400 + 5
    autre = "0" if sig[-1] != "0" else "1"
    refuses = [
        f"{compte}.{appareil}.{echeance}.{sig[:-1]}{autre}",  # signature touchée
        f"{compte}.{appareil}.{int(echeance) + 1}.{sig}",  # échéance repoussée
        f"{compte}.{'f' * 16}.{echeance}.{sig}",  # autre appareil
        f"lucas.{appareil}.{echeance}.{sig}",  # autre compte
        f"{compte}.{appareil}.{echeance}",  # sans signature
        "", "n'importe-quoi", f"{valeur}.en-trop",
    ]
    for faux in refuses:
        assert client.get("/api/aventuriers", headers=avec(faux)).status_code == 401, faux
    # Un cookie signé mais échu.
    a = portier.PORTE_LAN.appareil(valeur)[1]
    echu = portier.PORTE_LAN.jeton("alban", a["id"], etat_fichier()["comptes"][0]["generation"], int(time.time()) - 1)
    assert client.get("/api/aventuriers", headers=avec(echu)).status_code == 401
    # Une autre clé des appareils : tous les cookies tombent.
    assert client.get("/api/aventuriers", headers=avec(valeur)).status_code == 200
    (comptes_mj.dossier(config.DONNEES) / porte_lan.CLE).unlink()
    assert client.get("/api/aventuriers", headers=avec(valeur)).status_code == 401


def test_oublier_un_appareil_le_coupe(client, eveillee):
    porte_lan.FORCAGE = ""
    mac = reconnaitre(client, "Mac")
    iphone = reconnaitre(client, "iPhone", UA_IPHONE)
    porte_lan.FORCAGE = porte_lan.EVEILLEE
    vue = client.get("/api/mj/appareils", headers=avec(mac)).json()
    assert [a["nom"] for a in vue["appareils"]] == ["iPhone", "Mac"] or [a["nom"] for a in vue["appareils"]] == ["Mac", "iPhone"]
    id_iphone = next(a["id"] for a in vue["appareils"] if a["nom"] == "iPhone")
    id_mac = vue["cet_appareil"]
    # Depuis le Mac, oublier l'iPhone : l'iPhone ne passe plus, le Mac si.
    r = client.delete(f"/api/mj/appareils/{id_iphone}", headers=avec(mac))
    assert r.status_code == 200 and [a["nom"] for a in r.json()["appareils"]] == ["Mac"] and not cookie_pose(r)
    assert client.get("/api/aventuriers", headers=avec(iphone, UA_IPHONE)).status_code == 401
    assert client.get("/api/aventuriers", headers=avec(mac)).status_code == 200
    assert client.delete(f"/api/mj/appareils/{id_iphone}", headers=avec(mac)).status_code == 404
    # Le Mac s'oublie lui-même : son cookie est effacé, et il ne passe plus.
    r = client.delete(f"/api/mj/appareils/{id_mac}", headers=avec(mac))
    assert r.status_code == 200 and r.json()["appareils"] == [] and r.json()["cet_appareil"] is None
    assert any(c.startswith(f"{porte_lan.COOKIE}=;") or c.startswith(f'{porte_lan.COOKIE}="";') or "Max-Age=0" in c
               for c in r.headers.get_list("set-cookie"))
    client.cookies.clear()
    assert client.get("/api/aventuriers", headers=avec(mac)).status_code == 401
    # Le journal des comptes note les gestes, sans cookie.
    journal = (comptes_mj.dossier(config.DONNEES) / comptes_mj.JOURNAL).read_text(encoding="utf-8")
    assert journal.count('"appareil-reconnu"') == 2 and journal.count('"appareil-oublie"') == 2
    assert mac.split(".")[3] not in journal and iphone.split(".")[3] not in journal


def test_renommer_cet_appareil(client, eveillee):
    """Un appareil reconnu à la connexion porte le nom de son navigateur (un iPad se dit Mac) : « Renommer » le reconnaît
    de nouveau sous son nom, à la place de l'ancien."""
    r = client.post("/connexion", data={"mot_de_passe": MDP, "suite": "/"}, headers={"User-Agent": UA_MAC}, follow_redirects=False)
    ancien = cookie_pose(r)
    client.cookies.clear()
    r = client.post("/api/mj/appareils", json={"nom": "iPad du salon"}, headers=avec(ancien))
    assert r.status_code == 200
    neuf = cookie_pose(r)
    client.cookies.clear()
    assert [a["nom"] for a in r.json()["appareils"]] == ["iPad du salon"] and r.json()["cet_appareil"] == neuf.split(".")[1]
    assert client.get("/api/aventuriers", headers=avec(neuf)).status_code == 200
    assert client.get("/api/aventuriers", headers=avec(ancien)).status_code == 401


def test_un_nouveau_mot_de_passe_coupe_les_appareils(client, eveillee, monkeypatch):
    porte_lan.FORCAGE = ""
    valeur = reconnaitre(client)
    porte_lan.FORCAGE = porte_lan.EVEILLEE
    assert client.get("/api/aventuriers", headers=avec(valeur)).status_code == 200
    monkeypatch.setattr(portier, "EMPREINTE_MDP", empreinte("un-autre-mot-de-passe-de-givre"))
    comptes_mj.assurer_principal(config.DONNEES, portier.EMPREINTE_MDP)
    assert client.get("/api/aventuriers", headers=avec(valeur)).status_code == 401
    # La liste ne montre plus l'appareil d'avant ; reconnaître à nouveau rend la main.
    assert client.get("/api/mj/appareils", headers={"X-Atelier-Outil": portier.PORTE_LAN.secret(porte_lan.JETON_OUTILS)}).json()["appareils"] == []


def test_l_appareil_d_un_invite_ferme_ne_passe_plus(client, eveillee, ouvertes):
    c = ouvrir_invite(creer_invite())
    _, valeur = portier.PORTE_LAN.reconnaitre(c["id"], "Portable de Lucas")
    # L'appareil de l'invité entre, sous son compte à lui.
    assert client.get("/api/moi", headers=avec(valeur)).json() == {"compte": c["id"], "nom": "Lucas", "role": "invite", "suite": "Quête annexe"}
    vue = client.get("/api/mj/appareils", headers=avec(valeur)).json()
    assert [a["nom"] for a in vue["appareils"]] == ["Portable de Lucas"]
    # Fermé : refusé.
    comptes_mj.fermer(config.DONNEES, c["id"])
    assert client.get("/api/moi", headers=avec(valeur)).status_code == 401
    # Rouvert par un nouveau lien : ses anciens appareils restent coupés (la génération a monté).
    ouvrir_invite(c)
    assert client.get("/api/moi", headers=avec(valeur)).status_code == 401
    # Les invitations refermées : aucun appareil d'invité n'entre.
    c = ouvrir_invite(creer_invite("Léa"))
    _, valeur = portier.PORTE_LAN.reconnaitre(c["id"], "Tablette de Léa")
    assert client.get("/api/moi", headers=avec(valeur)).status_code == 200
    comptes_mj.INVITATIONS_OUVERTES = False
    try:
        assert client.get("/api/moi", headers=avec(valeur)).status_code == 401
    finally:
        comptes_mj.INVITATIONS_OUVERTES = True


def test_le_cookie_se_renouvelle_a_l_ouverture_d_une_page(client):
    valeur = reconnaitre(client)
    compte, appareil, _, _ = valeur.split(".")
    generation = etat_fichier()["comptes"][0]["generation"]
    proche = portier.PORTE_LAN.jeton(compte, appareil, generation, int(time.time()) + 100 * 86400)
    # Une lecture de l'API ne pose rien ; une page, si : 400 jours de plus, le même appareil.
    assert not cookie_pose(client.get("/api/aventuriers", headers=avec(proche)))
    neuf = cookie_pose(client.get("/", headers=avec(proche)))
    assert neuf and neuf.split(".")[1] == appareil and int(neuf.split(".")[2]) > time.time() + 399 * 86400
    client.cookies.clear()
    # Loin de l'échéance : rien.
    assert not cookie_pose(client.get("/", headers=avec(valeur)))
    client.cookies.clear()


def test_vu_le_se_note_deux_fois_par_jour_au_plus(client):
    valeur = reconnaitre(client)
    e = etat_fichier()
    e["comptes"][0]["appareils"][0]["vu"] = "2026-01-01T10:00:00"
    comptes_mj.ecrire(config.DONNEES, e)
    client.get("/api/aventuriers", headers=avec(valeur))
    vu = etat_fichier()["comptes"][0]["appareils"][0]["vu"]
    assert vu.startswith(time.strftime("%Y-%m-%d"))
    avant = comptes_mj.chemin(config.DONNEES).stat().st_mtime_ns
    client.get("/api/aventuriers", headers=avec(valeur))
    assert comptes_mj.chemin(config.DONNEES).stat().st_mtime_ns == avant


def test_reconnaitre_se_fait_sur_le_lan_seulement(client):
    r = client.post("/connexion", data={"mot_de_passe": MDP, "suite": "/"},
                    headers={"Host": HOTE_EN_LIGNE, "CF-Connecting-IP": "203.0.113.30", "Origin": f"https://{HOTE_EN_LIGNE}"},
                    follow_redirects=False)
    session = {"Host": HOTE_EN_LIGNE, "CF-Connecting-IP": "203.0.113.30", "Origin": f"https://{HOTE_EN_LIGNE}",
               "Cookie": r.headers["set-cookie"].split(";")[0]}
    # En ligne, la session ne pose aucun cookie d'appareil, et « Reconnaître » est refusé.
    assert not cookie_pose(r)
    r = client.post("/api/mj/appareils", json={"nom": "En ligne"}, headers=session)
    assert r.status_code == 400 and "réseau local" in r.json()["detail"]
    # En ligne, on voit et on oublie ses appareils (un téléphone perdu).
    client.cookies.clear()
    valeur = reconnaitre(client)
    vue = client.get("/api/mj/appareils", headers=session).json()
    assert vue["lan"] is False and vue["cet_appareil"] is None and len(vue["appareils"]) == 1
    assert client.delete(f"/api/mj/appareils/{vue['appareils'][0]['id']}", headers=session).status_code == 200
    porte_lan.FORCAGE = porte_lan.EVEILLEE
    try:
        assert client.get("/api/aventuriers", headers=avec(valeur)).status_code == 401
        # Un cookie d'appareil ne vaut rien en ligne, ni à la table publique.
        assert client.get("/api/aventuriers", headers={"Host": HOTE_EN_LIGNE, "CF-Connecting-IP": "203.0.113.30",
                                                       **avec(valeur)}).status_code == 401
    finally:
        porte_lan.FORCAGE = ""


def test_se_connecter_sur_le_lan_reconnait_l_appareil(client, eveillee):
    r = client.post("/connexion", data={"mot_de_passe": MDP, "suite": "/#/aventuriers"},
                    headers={"User-Agent": UA_IPHONE}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/#/aventuriers"
    valeur = cookie_pose(r)
    client.cookies.clear()
    assert valeur and "HttpOnly" in next(c for c in r.headers.get_list("set-cookie") if c.startswith(porte_lan.COOKIE))
    assert client.get("/api/aventuriers", headers=avec(valeur, UA_IPHONE)).status_code == 200
    assert [a["nom"] for a in client.get("/api/mj/appareils", headers=avec(valeur, UA_IPHONE)).json()["appareils"]] == ["iPhone, Safari"]
    # Un mauvais mot de passe ne reconnaît rien.
    r = client.post("/connexion", data={"mot_de_passe": "pas-le-bon", "suite": "/"}, follow_redirects=False)
    assert r.status_code == 401 and not cookie_pose(r)


def test_se_connecter_sur_le_lan_porte_dormante_ne_change_rien(client):
    r = client.post("/connexion", data={"mot_de_passe": MDP, "suite": "/"}, follow_redirects=False)
    assert r.status_code == 303 and not cookie_pose(r)
    assert not comptes_mj.principal(etat_fichier()).get("appareils")


def test_le_nom_propose_d_un_appareil():
    assert porte_lan.nom_propose(UA_MAC) == "Mac, Chrome"
    assert porte_lan.nom_propose(UA_IPHONE) == "iPhone, Safari"
    assert porte_lan.nom_propose("Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/79.0 Safari/537.36") == "TV LG, Chrome"
    assert porte_lan.nom_propose("") == "Appareil"
    assert porte_lan.nom_choisi("  Mon   Mac\u0007 ", UA_MAC) == "Mon Mac"
    assert porte_lan.nom_choisi("x" * 99) == "x" * porte_lan.NOM_MAX
    assert porte_lan.nom_choisi(None, UA_IPHONE) == "iPhone, Safari"


def test_trente_appareils_au_plus(client):
    for i in range(porte_lan.APPAREILS_MAX + 3):
        portier.PORTE_LAN.reconnaitre("alban", f"Appareil {i}")
    noms = [a["nom"] for a in portier.PORTE_LAN.liste("alban")]
    assert len(noms) == porte_lan.APPAREILS_MAX and "Appareil 0" not in noms and f"Appareil {porte_lan.APPAREILS_MAX + 2}" in noms


def test_le_bloc_ne_montre_ni_cle_ni_cookie(client):
    valeur = reconnaitre(client)
    texte = client.get("/api/mj/appareils", headers=avec(valeur)).text
    assert valeur not in texte and valeur.split(".")[3] not in texte
    assert portier.PORTE_LAN.secret(porte_lan.CLE) not in texte and "generation" not in texte
    # Rien de tout cela dans ce que voit le coin des joueurs.
    for f in config.PROPOSITIONS.rglob("*"):
        if f.is_file():
            assert valeur.split(".")[3].encode() not in f.read_bytes()


# ---------------------------------------------------------------- les outils du serveur

def test_un_outil_passe_par_son_jeton(client, eveillee):
    jeton = (comptes_mj.dossier(config.DONNEES) / porte_lan.JETON_OUTILS)
    portier.PORTE_LAN.preparer()
    outil = {"X-Atelier-Outil": jeton.read_text().strip()}
    # Comme outils/idees.py et outils/scenarios.py : 127.0.0.1:8323, lecture et écriture.
    assert client.get("/api/idees", headers={"Host": "127.0.0.1:8323", **outil}).status_code == 200
    r = client.post("/api/idees", json={"nom": "Une idée d'outil"}, headers={"Host": "127.0.0.1:8323", **outil})
    assert r.status_code == 200 and r.json()["auteur"] == "alban"
    assert client.get("/api/moi", headers=outil).json()["role"] == "principal"
    for faux in ("", "faux", outil["X-Atelier-Outil"][:-1], outil["X-Atelier-Outil"] + "x"):
        assert client.get("/api/idees", headers={"X-Atelier-Outil": faux}).status_code == 401, faux
    # Seulement sur le LAN : ni en ligne, ni à la table publique.
    assert client.get("/api/idees", headers={"Host": HOTE_EN_LIGNE, "CF-Connecting-IP": "203.0.113.31", **outil}).status_code == 401
    assert client.get("/api/idees", headers={"Host": HOTE_TABLE, **outil}).status_code == 404
    # Un nouveau jeton (le fichier remplacé) : l'ancien ne vaut plus rien.
    jeton.unlink()
    assert client.get("/api/idees", headers=outil).status_code == 401
    portier.PORTE_LAN.preparer()
    assert client.get("/api/idees", headers={"X-Atelier-Outil": jeton.read_text().strip()}).status_code == 200


# ---------------------------------------------------------------- le rendu PDF

@pytest.fixture
def chromium(monkeypatch):
    """Chromium remplacé par un client qui ouvre la page depuis la boucle locale, garde ses cookies, puis lit ce que la
    page lirait : la fiche, puis l'API."""
    vues = []

    async def faux(url):
        transport = httpx.ASGITransport(app=application.app, client=("127.0.0.1", 41000))
        async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1:8000") as navigateur:
            page = await navigateur.get(url)
            api = await navigateur.get("/api/aventuriers")
            vues.append({"url": url, "page": page.status_code, "api": api.status_code,
                         "cookie": navigateur.cookies.get(porte_lan.COOKIE_RENDU)})
        return PDF

    monkeypatch.setattr(pages, "page_en_pdf", faux)
    return vues


def test_le_pdf_passe_la_porte_par_un_jeton_a_usage_unique(client, eveillee, chromium):
    porte_lan.FORCAGE = ""
    a = client.post("/api/aventuriers", json={"nom": "Vortan de la porte", "tablee": True}).json()
    valeur = reconnaitre(client)
    porte_lan.FORCAGE = porte_lan.EVEILLEE
    r = client.get(f"/fiche-aventurier.pdf?id={a['id']}&verso=0", headers=avec(valeur))
    assert r.status_code == 200 and r.content == PDF
    vue = chromium[-1]
    assert vue["page"] == 200 and vue["api"] == 200 and vue["cookie"]
    jeton = parse_qs(urlsplit(vue["url"]).query)["rendu"][0]
    # Après le rendu : ni le jeton de l'adresse, ni le cookie ne valent plus rien.
    assert jeton not in portier.PORTE_LAN.rendus and vue["cookie"] not in portier.PORTE_LAN.en_rendu
    boucle = TestClient(application.app, base_url="http://127.0.0.1:8000", client=("127.0.0.1", 41001))
    assert boucle.get(f"/fiche-aventurier?rendu={jeton}", follow_redirects=False).status_code == 303
    assert boucle.get("/api/aventuriers", headers={"Cookie": f"{porte_lan.COOKIE_RENDU}={vue['cookie']}"}).status_code == 401
    # Un jeton neuf ne sert qu'une fois, et seulement depuis la boucle locale.
    jeton = portier.PORTE_LAN.jeton_de_rendu("alban")
    ailleurs = TestClient(application.app, base_url="http://127.0.0.1:8000", client=("192.168.1.50", 41002))
    assert ailleurs.get(f"/fiche-aventurier?rendu={jeton}", follow_redirects=False).status_code == 303
    r = boucle.get(f"/fiche-aventurier?rendu={jeton}", follow_redirects=False)
    assert r.status_code == 200 and cookie_pose(r, porte_lan.COOKIE_RENDU)
    rendu = cookie_pose(r, porte_lan.COOKIE_RENDU)
    assert boucle.get(f"/fiche-aventurier?rendu={jeton}", follow_redirects=False, headers={"Cookie": ""}).status_code == 303
    assert ailleurs.get("/api/aventuriers", headers={"Cookie": f"{porte_lan.COOKIE_RENDU}={rendu}"}).status_code == 401
    assert boucle.get("/api/aventuriers", headers={"Cookie": f"{porte_lan.COOKIE_RENDU}={rendu}"}).status_code == 200
    portier.PORTE_LAN.fin_de_rendu(jeton)
    assert boucle.get("/api/aventuriers", headers={"Cookie": f"{porte_lan.COOKIE_RENDU}={rendu}"}).status_code == 401
    # Seule la page de la fiche échange un jeton.
    jeton = portier.PORTE_LAN.jeton_de_rendu("alban")
    assert boucle.get(f"/billets?rendu={jeton}", follow_redirects=False).status_code == 303


def test_le_pdf_porte_dormante_reste_le_meme(client, chromium):
    a = client.post("/api/aventuriers", json={"nom": "Vortan endormi", "tablee": True}).json()
    r = client.get(f"/fiche-aventurier.pdf?id={a['id']}")
    assert r.status_code == 200 and r.content == PDF and chromium[-1]["page"] == 200 and chromium[-1]["api"] == 200


# ---------------------------------------------------------------- les journaux

def test_ni_jeton_ni_cookie_dans_les_journaux(client, eveillee, chromium, caplog):
    caplog.set_level(logging.DEBUG)
    porte_lan.FORCAGE = ""
    valeur = reconnaitre(client)
    porte_lan.FORCAGE = porte_lan.EVEILLEE
    portier.PORTE_LAN.preparer()
    outil = (comptes_mj.dossier(config.DONNEES) / porte_lan.JETON_OUTILS).read_text().strip()
    a = client.post("/api/aventuriers", json={"nom": "Vortan des journaux", "tablee": True}, headers=avec(valeur)).json()
    client.get("/api/idees", headers={"X-Atelier-Outil": outil})
    client.get("/api/idees", headers={"X-Atelier-Outil": "faux-jeton-d-outil-qui-ne-doit-pas-sortir"})
    client.get("/api/aventuriers", headers=avec(valeur + "x"))
    client.get(f"/fiche-aventurier.pdf?id={a['id']}", headers=avec(valeur))
    r = client.post("/connexion", data={"mot_de_passe": MDP, "suite": "/"}, follow_redirects=False)
    lan = cookie_pose(r)
    texte = caplog.text
    for secret in (valeur, valeur.split(".")[3], outil, "faux-jeton-d-outil", lan, lan.split(".")[3],
                   portier.PORTE_LAN.secret(porte_lan.CLE), chromium[-1]["cookie"]):
        assert secret and secret not in texte
    assert "Appareil reconnu sur le réseau local pour le compte alban" in texte


def test_le_journal_des_acces_masque_le_jeton_de_rendu():
    """uvicorn écrit « client - "GET /chemin?requête HTTP/1.1" statut » : le jeton de rendu y est masqué."""
    jeton = secrets.token_urlsafe(24)
    record = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
                               ("127.0.0.1:41000", "GET", f"/fiche-aventurier?id=naima&rendu={jeton}&verso=0", "1.1", 200), None)
    for filtre in logging.getLogger("uvicorn.access").filters:
        filtre.filter(record)
    message = record.getMessage()
    assert jeton not in message and "rendu=…&verso=0" in message and "id=naima" in message
