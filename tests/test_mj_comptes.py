"""Les comptes des MJ (comptes_mj.py, porte_mj.py, lot MJ-1) : le compte principal né de l'empreinte de l'environnement,
l'ancien cookie valable 30 jours, la connexion par identifiant, l'invitation d'un MJ (lien à clé dans le fragment, une
seule fois), « Nouveau lien » et « Fermer », un seul principal, et l'invitation refusée tant que le drapeau est éteint."""

import hashlib
import json
import logging
import os
import re
import secrets
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from mj import cloisonnement  # noqa: E402
from mj import comptes_mj  # noqa: E402
import main  # noqa: E402
from api import application, config, portier  # noqa: E402

HOTE = "atelier-mj.example.ch"
IP = "203.0.113.20"
PUBLIC = {"Host": HOTE, "CF-Connecting-IP": IP}
ECRIRE = PUBLIC | {"Origin": f"https://{HOTE}"}
MDP = "lanterne-corbeau-moulin-givre-47"
MDP_INVITE = "chandelle-de-cire-33"
OUTIL = Path(__file__).resolve().parent.parent / "outils" / "mot-de-passe.py"


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
    monkeypatch.setattr(portier, "ATELIER_PUBLIC", {HOTE})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {HOTE})
    monkeypatch.setattr(portier, "EMPREINTE_MDP", empreinte(MDP))
    monkeypatch.setattr(portier, "CLE_SESSION", b"cle-de-test-mj")
    monkeypatch.setattr(portier, "ATTENTE_ECHEC", 0)
    # Ces tests passent par le LAN comme Alban : la porte du LAN, qu'un invité éveille, a les siens (test_mj_porte_lan.py).
    monkeypatch.setattr(portier.PORTE_LAN, "eveillee", lambda: False)
    repartir_de_zero()
    appli.cookies.clear()
    yield appli
    repartir_de_zero()


@pytest.fixture
def ouvertes(monkeypatch):
    # Les invitations ouvertes vont avec le strict : en veille, aucun invité n'entre.
    monkeypatch.setattr(comptes_mj, "INVITATIONS_OUVERTES", True)
    monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.STRICT)


def entrer(client, mdp=MDP, identifiant=None, ip=IP):
    data = {"mot_de_passe": mdp, "suite": "/"}
    if identifiant is not None:
        data["identifiant"] = identifiant
    return client.post("/connexion", data=data, headers=ECRIRE | {"CF-Connecting-IP": ip}, follow_redirects=False)


def session(r) -> dict:
    assert r.status_code in (200, 303), r.text
    return PUBLIC | {"Cookie": r.headers["set-cookie"].split(";")[0]}


def tirer_cle() -> str:
    return secrets.token_urlsafe(24)


def inviter(client, nom="Lucas"):
    cle = tirer_cle()
    r = client.post("/api/mj/comptes", json={"nom": nom, "cle": cle})
    return cle, r


def ouvrir(client, cle, identifiant="lucas.mj", mdp=MDP_INVITE, ip=IP):
    return client.post("/connexion/invitation", json={"cle": cle, "identifiant": identifiant, "mot_de_passe": mdp,
                                                      "confirmation": mdp}, headers=ECRIRE | {"CF-Connecting-IP": ip})


def etat_fichier() -> dict:
    return json.loads(comptes_mj.chemin(config.DONNEES).read_text(encoding="utf-8"))


def moi(client, h) -> dict:
    r = client.get("/api/moi", headers=h)
    assert r.status_code == 200, r.status_code
    return r.json()


# ---------------------------------------------------------------- le compte principal

def test_l_empreinte_de_l_environnement_ouvre_le_compte_principal(client):
    assert not comptes_mj.chemin(config.DONNEES).exists()
    # Comme avant : le mot de passe seul (pas d'identifiant), ou « MJ » que retenaient les navigateurs.
    for identifiant in (None, "", "MJ", "alban", " Alban "):
        r = entrer(client, identifiant=identifiant)
        assert r.status_code == 303, identifiant
        assert moi(client, session(r)) == {"compte": "alban", "nom": "Alban", "role": "principal"}
    assert entrer(client, identifiant="inconnu").status_code == 401
    assert entrer(client, "pas-le-bon", identifiant="alban").status_code == 401
    # Le fichier : dossier 0700, fichier 0600, hors du dossier que voit le coin des joueurs.
    f = comptes_mj.chemin(config.DONNEES)
    assert stat.S_IMODE(f.stat().st_mode) == 0o600 and stat.S_IMODE(f.parent.stat().st_mode) == 0o700
    assert config.PROPOSITIONS not in f.parents and not (config.PROPOSITIONS / "mj").exists()
    e = etat_fichier()
    principaux = [c for c in e["comptes"] if c["role"] == "principal"]
    assert len(principaux) == 1 and principaux[0]["id"] == "alban" and principaux[0]["empreinte"] == portier.EMPREINTE_MDP


def test_l_ancien_cookie_vaut_session_pendant_trente_jours(client, monkeypatch):
    expire = int(time.time()) + 3600
    ancien = PUBLIC | {"Cookie": f"__Host-arriere-salle={expire}.{portier.signature_session(expire)}"}
    assert moi(client, ancien)["role"] == "principal"
    assert client.get("/api/aventuriers", headers=ancien).status_code == 200
    fenetre = etat_fichier()["ancien_cookie"]
    assert time.time() + 29 * 86400 < fenetre["fin"] <= time.time() + 30 * 86400 + 5
    # Les 30 jours passés : il ne vaut plus rien.
    e = etat_fichier()
    e["ancien_cookie"]["fin"] = int(time.time()) - 1
    comptes_mj.ecrire(config.DONNEES, e)
    assert client.get("/api/aventuriers", headers=ancien).status_code == 401
    # Un mot de passe changé (outils/mot-de-passe.py, puis redémarrage) : ni l'ancien cookie, ni un ancien cookie signé
    # avec la nouvelle empreinte (le principal a changé de génération), ni les sessions d'avant.
    repartir_de_zero()
    neuve = session(entrer(client))
    assert client.get("/api/aventuriers", headers=ancien).status_code == 200
    monkeypatch.setattr(portier, "EMPREINTE_MDP", empreinte("un-autre-mot-de-passe"))
    assert client.get("/api/aventuriers", headers=ancien).status_code == 401
    assert client.get("/api/aventuriers", headers=neuve).status_code == 401
    expire = int(time.time()) + 3600
    resigne = PUBLIC | {"Cookie": f"__Host-arriere-salle={expire}.{portier.signature_session(expire)}"}
    assert client.get("/api/aventuriers", headers=resigne).status_code == 401
    assert entrer(client, "un-autre-mot-de-passe").status_code == 303 and entrer(client).status_code == 401


def test_un_fichier_illisible_ferme_l_atelier_en_ligne_sans_etre_ecrase(client):
    f = comptes_mj.chemin(config.DONNEES)
    f.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    f.write_text("{abîmé", encoding="utf-8")
    assert entrer(client).status_code == 401
    assert f.read_text(encoding="utf-8") == "{abîmé"
    # Le LAN ne change pas.
    assert client.get("/api/moi").json()["role"] == "principal"


def test_l_outil_de_secours_ecrit_le_compte(client, tmp_path):
    avant = session(entrer(client))
    # L'environnement que lit l'outil (secrets/acces.env, ou celui que donne --fichier) : celui que tient le conteneur.
    env = tmp_path / "acces.env"
    env.write_text(f"ATELIER_MDP_EMPREINTE={portier.EMPREINTE_MDP}\nATELIER_CLE_SESSION=x\n", encoding="utf-8")
    r = subprocess.run([sys.executable, str(OUTIL), "--compte", "alban", "--generer", "--donnees", str(config.DONNEES),
                        "--fichier", str(env)], capture_output=True, text=True, check=True)
    nouveau = re.search(r"Mot de passe : (\S+)", r.stdout)[1]
    assert entrer(client, nouveau).status_code == 303
    assert entrer(client).status_code == 401
    # Ses sessions d'avant tombent ; l'environnement inchangé ne reprend pas la main au prochain démarrage.
    assert client.get("/api/aventuriers", headers=avant).status_code == 401
    assert entrer(client, nouveau, identifiant="alban").status_code == 303
    assert "mot-de-passe-secours" in (comptes_mj.dossier(config.DONNEES) / comptes_mj.JOURNAL).read_text(encoding="utf-8")
    # Un fichier illisible : l'outil le met de côté et refait le principal.
    comptes_mj.chemin(config.DONNEES).write_text("{abîmé", encoding="utf-8")
    r = subprocess.run([sys.executable, str(OUTIL), "--compte", "alban", "--generer", "--donnees", str(config.DONNEES),
                        "--fichier", str(env)], capture_output=True, text=True, check=True)
    assert "mis de côté" in r.stdout and list(comptes_mj.dossier(config.DONNEES).glob("comptes.json.illisible-*"))
    assert entrer(client, re.search(r"Mot de passe : (\S+)", r.stdout)[1]).status_code == 303


# ---------------------------------------------------------------- l'invitation

def test_l_invitation_est_refusee_tant_que_le_drapeau_est_eteint(client, monkeypatch):
    assert comptes_mj.INVITATIONS_OUVERTES is False
    cle, r = inviter(client)
    assert r.status_code == 403 and "Pas encore disponible" in r.json()["detail"]
    liste = client.get("/api/mj/comptes").json()
    assert liste["invitations"] is False and [c["role"] for c in liste["comptes"]] == ["principal"]
    assert client.post("/connexion/invitation/etat", json={"cle": cle}, headers=ECRIRE).status_code == 403
    # Un invité né pendant un essai (drapeau levé) ne se connecte plus, et sa session ne vaut plus, drapeau baissé.
    monkeypatch.setattr(comptes_mj, "INVITATIONS_OUVERTES", True)
    monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.STRICT)
    cle, _ = inviter(client)
    h = session(ouvrir(client, cle))
    assert moi(client, h)["role"] == "invite"
    monkeypatch.setattr(comptes_mj, "INVITATIONS_OUVERTES", False)
    assert client.get("/api/aventuriers", headers=h).status_code == 401
    assert entrer(client, MDP_INVITE, identifiant="lucas.mj").status_code == 401
    assert client.post("/api/mj/comptes/lucas/lien", json={"cle": tirer_cle()}).status_code == 403


def test_l_invitation_sert_une_seule_fois(client, ouvertes):
    cle, r = inviter(client)
    assert r.status_code == 200
    lucas = next(c for c in r.json()["comptes"] if c["role"] == "invite")
    assert lucas["id"] == "lucas" and lucas["etat"] == "lien-a-ouvrir" and lucas["identifiant"] == ""
    # La page de l'invitation, sans session ; la clé ne passe que dans le corps.
    page = client.get("/connexion/invitation", headers=PUBLIC)
    assert page.status_code == 200 and page.headers["cache-control"] == "no-store" and page.headers["x-frame-options"] == "DENY"
    assert client.post("/connexion/invitation/etat", json={"cle": cle}, headers=ECRIRE).json() == {
        "etat": "creer", "nom": "Lucas", "identifiant": ""}
    # Les règles de l'identifiant et du mot de passe (comptes.py), et les identifiants pris (dont « MJ » et « alban »).
    for identifiant, mdp, statut in (("lu", MDP_INVITE, 400), ("lucas mj", MDP_INVITE, 400), ("MJ", MDP_INVITE, 400),
                                     ("Alban", MDP_INVITE, 409), ("lucas.mj", "court", 400)):
        assert ouvrir(client, cle, identifiant, mdp).status_code == statut, identifiant
    r = ouvrir(client, cle)
    assert r.status_code == 200 and r.json() == {"ok": True, "suite": "/"}
    cookie = r.headers["set-cookie"]
    assert "__Host-arriere-salle=lucas." in cookie and "Secure" in cookie and "HttpOnly" in cookie and "Path=/" in cookie
    h = session(r)
    assert moi(client, h) == {"compte": "lucas", "nom": "Lucas", "role": "invite", "suite": "Quête annexe"}
    # Rien n'est encore cloisonné : la session ouvre l'atelier.
    assert client.get("/api/aventuriers", headers=h).status_code == 200
    # Le lien a servi : il ne resert pas.
    assert ouvrir(client, cle, "autre.mj").status_code == 410
    assert client.post("/connexion/invitation/etat", json={"cle": cle}, headers=ECRIRE).status_code == 410
    # Ensuite, l'identifiant et le mot de passe, de n'importe où.
    assert entrer(client, MDP_INVITE, identifiant="Lucas.MJ", ip="198.51.100.7").status_code == 303
    assert entrer(client, MDP, identifiant="lucas.mj").status_code == 401
    liste = client.get("/api/mj/comptes").json()["comptes"]
    assert next(c for c in liste if c["id"] == "lucas")["etat"] == "actif"
    # Un deuxième invité ne prend ni l'identifiant du premier, ni son identifiant de compte.
    cle2, r2 = inviter(client, "Lucas")
    assert {c["id"] for c in r2.json()["comptes"]} >= {"lucas"} and len(r2.json()["comptes"]) == 3
    assert ouvrir(client, cle2, "LUCAS.mj").status_code == 409


def test_un_lien_expire_ne_s_ouvre_plus(client, ouvertes):
    cle, _ = inviter(client)
    e = etat_fichier()
    next(c for c in e["comptes"] if c["id"] == "lucas")["invitation"]["fin"] = int(time.time()) - 1
    comptes_mj.ecrire(config.DONNEES, e)
    assert ouvrir(client, cle).status_code == 410
    assert next(c for c in client.get("/api/mj/comptes").json()["comptes"] if c["id"] == "lucas")["etat"] == "lien-expire"


def test_un_nouveau_lien_rend_401_les_anciennes_sessions(client, ouvertes):
    cle, _ = inviter(client)
    h = session(ouvrir(client, cle))
    h2 = session(entrer(client, MDP_INVITE, identifiant="lucas.mj"))
    principal = session(entrer(client))
    cle2 = tirer_cle()
    assert client.post("/api/mj/comptes/lucas/lien", json={"cle": cle2}).status_code == 200
    for x in (h, h2):
        assert client.get("/api/aventuriers", headers=x).status_code == 401
    # Son mot de passe ne vaut plus, l'ancien lien non plus ; les sessions du principal tiennent.
    assert entrer(client, MDP_INVITE, identifiant="lucas.mj").status_code == 401
    assert ouvrir(client, cle).status_code == 410
    assert client.get("/api/aventuriers", headers=principal).status_code == 200
    # Le nouveau lien : un nouveau mot de passe, l'identifiant ne change pas (celui envoyé est ignoré).
    assert client.post("/connexion/invitation/etat", json={"cle": cle2}, headers=ECRIRE).json() == {
        "etat": "reinitialiser", "nom": "Lucas", "identifiant": "lucas.mj"}
    h3 = session(ouvrir(client, cle2, "autre-chose", "nouveau-mot-de-passe"))
    assert moi(client, h3)["compte"] == "lucas"
    assert entrer(client, "nouveau-mot-de-passe", identifiant="lucas.mj").status_code == 303
    # Le geste est tracé (sans clé ni empreinte).
    lignes = [json.loads(x) for x in (comptes_mj.dossier(config.DONNEES) / comptes_mj.JOURNAL).read_text(encoding="utf-8").splitlines()]
    assert [x["geste"] for x in lignes if x["compte"] == "lucas"] == ["invitation", "invitation-ouverte", "nouveau-lien",
                                                                       "invitation-ouverte"]


def test_fermer_coupe_les_sessions(client, ouvertes):
    cle, _ = inviter(client)
    h = session(ouvrir(client, cle))
    r = client.post("/api/mj/comptes/lucas/fermer")
    assert r.status_code == 200 and next(c for c in r.json()["comptes"] if c["id"] == "lucas")["etat"] == "ferme"
    assert client.get("/api/aventuriers", headers=h).status_code == 401
    assert entrer(client, MDP_INVITE, identifiant="lucas.mj").status_code == 401
    # Son compte reste (ses fiches restent les siennes) ; « Nouveau lien » le rouvre.
    assert comptes_mj.par_id(comptes_mj.lire(config.DONNEES), "lucas")["ferme"]
    cle2 = tirer_cle()
    client.post("/api/mj/comptes/lucas/lien", json={"cle": cle2})
    assert moi(client, session(ouvrir(client, cle2, mdp="rouvert-mot-de-passe")))["compte"] == "lucas"


def test_un_seul_principal(client, ouvertes):
    # Un invité au prénom d'Alban reste un invité, sous un autre identifiant de compte.
    assert client.post("/api/mj/comptes", json={"nom": "Alban", "cle": tirer_cle(), "role": "principal", "id": "alban"}).status_code == 200
    comptes = client.get("/api/mj/comptes").json()["comptes"]
    assert [c["role"] for c in comptes].count("principal") == 1
    autre = next(c for c in comptes if c["role"] == "invite")
    assert autre["id"] != "alban" and autre["id"].startswith("alban-")
    # Ni « Nouveau lien » ni « Fermer » pour le principal.
    assert client.post("/api/mj/comptes/alban/fermer").status_code == 404
    assert client.post("/api/mj/comptes/alban/lien", json={"cle": tirer_cle()}).status_code == 404
    # Le fichier n'en porte jamais deux ; un second écrit à la main ne compte pas.
    e = etat_fichier()
    with pytest.raises(ValueError):
        comptes_mj.ecrire(config.DONNEES, {**e, "comptes": e["comptes"] + [{**e["comptes"][0], "id": "second"}]})
    faux = {**e["comptes"][0], "id": "second", "identifiant": "second", "forme": "second"}
    comptes_mj.chemin(config.DONNEES).write_text(json.dumps({**e, "comptes": e["comptes"] + [faux]}), encoding="utf-8")
    assert comptes_mj.par_id(comptes_mj.lire(config.DONNEES), "second") is None
    assert entrer(client, identifiant="second").status_code == 401


def test_les_routes_des_comptes_au_principal_seul(client, ouvertes):
    cle, _ = inviter(client)
    h = session(ouvrir(client, cle))
    for methode, adresse in (("get", "/api/mj/comptes"), ("post", "/api/mj/comptes"), ("post", "/api/mj/comptes/lucas/fermer"),
                             ("post", "/api/mj/comptes/lucas/lien")):
        r = client.request(methode.upper(), adresse, json={"nom": "X", "cle": tirer_cle()}, headers=h | ECRIRE)
        assert r.status_code == 404, adresse
    principal = session(entrer(client))
    assert client.get("/api/mj/comptes", headers=principal).status_code == 200


def test_les_creations_d_un_invite_portent_son_auteur(client, ouvertes):
    cle, _ = inviter(client)
    h = session(ouvrir(client, cle))
    p = client.post("/api/pnj", json={"nom": "PNJ de Lucas"}, headers=h | ECRIRE).json()
    assert p["auteur"] == "lucas"
    # Une route synchrone (dans un fil à part) lit le même compte.
    assert moi(client, h)["compte"] == "lucas"
    # Le principal, en ligne ou sur le LAN.
    q = client.post("/api/pnj", json={"nom": "PNJ d'Alban"}, headers=session(entrer(client)) | ECRIRE).json()
    r = client.post("/api/pnj", json={"nom": "PNJ du LAN"}).json()
    assert q["auteur"] == r["auteur"] == "alban"
    # Une requête suivante n'hérite pas du compte d'une autre.
    assert client.get("/api/moi").json()["compte"] == "alban"
    for x in (p, q, r):
        client.delete(f"/api/pnj/{x['id']}")


def test_essais_limites_par_adresse_et_par_identifiant(client, ouvertes, monkeypatch):
    cle, _ = inviter(client)
    ouvrir(client, cle)
    portier.ECHECS_CONNEXION.clear()
    # Dix essais manqués sur un identifiant, de dix adresses : le onzième attend, même juste, même d'ailleurs.
    for i in range(portier.ECHECS_PAR_IDENTIFIANT):
        assert entrer(client, "faux", identifiant="lucas.mj", ip=f"198.51.100.{i}").status_code == 401
    assert entrer(client, MDP_INVITE, identifiant="lucas.mj", ip="198.51.100.99").status_code == 429
    # Un autre identifiant n'est pas bloqué.
    assert entrer(client, ip="198.51.100.98").status_code == 303
    # Les clés d'invitation fausses se comptent par adresse.
    portier.ECHECS_CONNEXION.clear()
    for _ in range(10):
        assert client.post("/connexion/invitation/etat", json={"cle": tirer_cle()}, headers=ECRIRE).status_code == 410
    assert client.post("/connexion/invitation/etat", json={"cle": tirer_cle()}, headers=ECRIRE).status_code == 429


def test_la_cle_et_les_empreintes_ne_sortent_jamais(client, ouvertes, caplog):
    """Fuite : ni la clé d'une invitation ni une empreinte de mot de passe dans une réponse, un journal ou les fichiers."""
    caplog.set_level(logging.DEBUG)
    reponses = []
    cle, r = inviter(client)
    reponses += [r, client.get("/api/mj/comptes"), client.get("/api/moi"),
                 client.post("/connexion/invitation/etat", json={"cle": cle}, headers=ECRIRE)]
    r = ouvrir(client, cle)
    h = session(r)
    reponses += [r, client.get("/api/moi", headers=h), entrer(client, MDP_INVITE, identifiant="lucas.mj"),
                 client.get("/connexion/invitation", headers=PUBLIC)]
    cle2 = tirer_cle()
    reponses += [client.post("/api/mj/comptes/lucas/lien", json={"cle": cle2}),
                 client.post("/connexion/invitation/etat", json={"cle": cle2}, headers=ECRIRE), ouvrir(client, cle2),
                 client.post("/api/mj/comptes/lucas/fermer"), client.get("/api/mj/comptes")]
    e = etat_fichier()
    secrets_ = [cle, cle2, comptes_mj.empreinte_cle(cle2), portier.EMPREINTE_MDP,
                *(c["empreinte"] for c in e["comptes"] if c["empreinte"]), *(c.get("env") for c in e["comptes"] if c.get("env"))]
    for r in reponses:
        texte = r.text + json.dumps(dict(r.headers))
        for s in secrets_:
            assert s not in texte, r.request.url
        assert "scrypt" not in r.text and "generation" not in r.text
    for s in (cle, cle2):
        assert s not in caplog.text
        for f in comptes_mj.dossier(config.DONNEES).iterdir():
            assert s not in f.read_text(encoding="utf-8", errors="ignore"), f
    journal_mj = (comptes_mj.dossier(config.DONNEES) / comptes_mj.JOURNAL).read_text(encoding="utf-8")
    assert "scrypt" not in journal_mj and "empreinte" not in journal_mj
    assert stat.S_IMODE((comptes_mj.dossier(config.DONNEES) / comptes_mj.JOURNAL).stat().st_mode) == 0o600


def test_sur_le_lan_rien_ne_change(client):
    assert client.get("/api/moi").json() == {"compte": "alban", "nom": "Alban", "role": "principal"}
    assert client.get("/api/aventuriers").status_code == 200
    assert client.get("/connexion/invitation").status_code == 200


def test_la_page_d_invitation_et_ses_routes_seulement(client):
    """Sans session, seules la page d'invitation et ses deux routes s'ajoutent à la connexion ; rien sur la table
    publique."""
    assert client.get("/connexion/invitationx", headers=PUBLIC, follow_redirects=False).status_code == 303
    assert client.post("/connexion/invitation/etatx", json={}, headers=ECRIRE).status_code == 401
    assert client.get("/api/moi", headers=PUBLIC).status_code == 401
    assert client.get("/api/mj/comptes", headers=PUBLIC).status_code == 401
    # Passé par Cloudflare hors de l'atelier en ligne : la table publique, en lecture, rien d'autre.
    for adresse in ("/connexion/invitation", "/api/moi", "/api/mj/comptes"):
        assert client.get(adresse, headers={"CF-Connecting-IP": IP}).status_code == 404, adresse
    assert client.post("/connexion/invitation/etat", json={"cle": tirer_cle()}, headers={"CF-Connecting-IP": IP}).status_code == 404
