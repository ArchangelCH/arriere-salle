"""Les comptes sans lien à clé (lot A1b, provisoires.py) : le MJ crée le compte d'un joueur dans l'atelier, le serveur
tire un mot de passe provisoire montré une seule fois ; le joueur se connecte avec, doit choisir le sien avant tout, et le
provisoire ne sert plus. Un nouveau provisoire coupe toutes ses sessions ; il expire au bout de 7 jours ; un identifiant
pris ou retiré ne se redonne pas ; les comptes d'avant et leurs sessions marchent toujours ; un ancien lien n'ouvre rien ;
un provisoire refait pendant une connexion ne laisse jamais deux mots de passe valables ; les essais manqués sont
comptés ; et ni provisoire, ni empreinte, ni jeton interne ne sortent."""
import hashlib
import json
import logging
import os
import re
import stat
import sys
import tempfile
import threading
import time
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlsplit

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from commun import acces  # noqa: E402
from commun import comptes  # noqa: E402
import joueurs  # noqa: E402
import main  # noqa: E402
from api import application, carnet_api, config  # noqa: E402
from commun import provisoires  # noqa: E402
from comptes_coin import MOT_DE_PASSE, entrer, jeton_de, sans_version  # noqa: E402

COMPTES = config.PROPOSITIONS / comptes.DOSSIER
PROVISOIRES = config.PROPOSITIONS / provisoires.DOSSIER
FORME = re.compile(r"^[a-z]{3,9}-[a-z]{3,9}-[a-z]{3,9}-[2-9]{2}$")
INCORRECT = {"detail": "Identifiant ou mot de passe incorrect."}


@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture(autouse=True)
def coin_branche(monkeypatch):
    monkeypatch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    monkeypatch.setattr(joueurs, "COOKIE_SUR", False)
    monkeypatch.setattr(joueurs, "HOTES", set())
    monkeypatch.setattr(joueurs, "ATTENTE_ECHEC", 0)
    joueurs.ESSAIS.clear()
    yield
    joueurs.ESSAIS.clear()


@pytest.fixture
def invites(atelier):
    """Des joueurs invités par le MJ, retirés à la fin : inviter("Léa") rend sa carte."""
    faits = []

    def inviter(nom):
        j = atelier.post("/api/joueurs", json={"nom": nom}).json()
        faits.append(j["id"])
        return j
    yield inviter
    for ident in faits:
        atelier.delete(f"/api/joueurs/{ident}")


def appareil():
    return TestClient(joueurs.app)


def creer_compte(atelier, j, identifiant=None):
    """« Créer son compte » (ou « Nouveau mot de passe provisoire ») : la réponse, qui seule porte le provisoire."""
    return atelier.post(f"/api/joueurs/{j['id']}/provisoire", json={} if identifiant is None else {"identifiant": identifiant})


def connecter(client, ident, mdp=MOT_DE_PASSE, ip=None):
    return client.post("/api/connexion", json={"identifiant": ident, "mot_de_passe": mdp},
                       headers={"CF-Connecting-IP": ip} if ip else {})


def choisir(client, mdp=MOT_DE_PASSE, confirmation=None):
    return client.post("/api/compte", json={"mot_de_passe": mdp, "confirmation": mdp if confirmation is None else confirmation})


def carte(atelier, ident):
    return next(j for j in atelier.get("/api/joueurs").json() if j["id"] == ident)


def compte_de(ident):
    return json.loads((COMPTES / f"{ident}.json").read_text(encoding="utf-8"))


def provisoire_de(ident):
    return json.loads((PROVISOIRES / f"{ident}.json").read_text(encoding="utf-8"))


def joueur_publie(ident):
    return next(x for x in joueurs.acces() if x["id"] == ident)


def test_creation_du_compte_par_le_provisoire(atelier, invites):
    j = invites("Lison")
    assert j["compte"] is None and j["identifiant_propose"].startswith("lison") and "lien" not in j
    r = creer_compte(atelier, j, " Lison.V ")
    assert r.status_code == 200, r.text
    assert r.headers["cache-control"] == "no-store"
    rendu = r.json()
    mot = rendu["provisoire"]
    # Trois mots courts et deux chiffres, sans 0 ni 1 ; la phrase à transmettre telle quelle.
    assert FORME.match(mot), mot
    adresse = urlsplit(config.LIEN_JOUEURS).netloc
    assert rendu["phrase"] == f"Va sur {adresse}, identifiant Lison.V, mot de passe provisoire {mot}"
    assert rendu["compte"]["identifiant"] == "Lison.V" and rendu["compte"]["compte"] is False
    # Le serveur n'en garde que l'empreinte, dans un fichier de l'atelier lisible par lui seul.
    chemin = PROVISOIRES / f"{j['id']}.json"
    assert stat.S_IMODE(chemin.stat().st_mode) == 0o600
    p = provisoire_de(j["id"])
    assert set(p) == {"joueur", "identifiant", "forme", "empreinte", "generation", "cree", "expire"}
    assert p["identifiant"] == "Lison.V" and p["forme"] == "lison.v" and p["generation"] == 1
    assert acces.verifier(p["empreinte"], provisoires.canonique(mot)) and mot not in chemin.read_text(encoding="utf-8")
    assert provisoires.date(p["expire"]) - provisoires.date(p["cree"]) == timedelta(days=7)
    # La carte dit qu'un provisoire attend, sans le redonner.
    c = carte(atelier, j["id"])
    assert c["compte"]["provisoire"]["expire"] is False and c["compte"]["compte"] is False and mot not in json.dumps(c)
    # Le joueur se connecte, quelle que soit la casse, même dicté avec des espaces au lieu des tirets.
    lea = appareil()
    r = connecter(lea, "LISON.v", mot.upper().replace("-", " "))
    assert r.status_code == 200 and r.json() == {"ok": True, "suite": "/compte", "choisir": True}
    invitation = next(x for x in r.headers.get_list("set-cookie") if x.startswith("invitation="))
    assert "HttpOnly" in invitation and "samesite=lax" in invitation.lower() and "Max-Age=3600" in invitation
    # Rien d'autre ne s'ouvre avant d'avoir choisi son mot de passe.
    assert lea.get("/api/moi").status_code == 401 and lea.get("/api/carnet").status_code == 401
    assert lea.get("/", follow_redirects=False).headers["location"] == "/compte"
    assert lea.get("/fiche", follow_redirects=False).status_code == 303
    assert lea.get("/compte").status_code == 200
    assert lea.get("/api/compte").json() == {"etat": "choisir", "joueur": "Lison", "identifiant": "Lison.V"}
    # Les règles d'A1, et jamais le provisoire lui-même.
    assert choisir(lea, "court").status_code == 400
    assert choisir(lea, "assez long", "pas pareil").status_code == 400
    assert choisir(lea, "lison.v").status_code == 400
    r = choisir(lea, mot.replace("-", " "))
    assert r.status_code == 400 and "provisoire" in r.json()["detail"]
    assert not (COMPTES / f"{j['id']}.json").exists()
    r = choisir(lea)
    assert r.status_code == 200 and r.json() == {"ok": True, "identifiant": "Lison.V", "suite": "/"}
    poses = r.headers.get_list("set-cookie")
    assert any(x.startswith("aventurier=v2.") and "Max-Age=15552000" in x for x in poses)
    assert any(x.startswith("invitation=") and "Max-Age=0" in x for x in poses)
    # Il arrive sur son créateur, exactement comme avant.
    assert lea.get("/api/moi").json()["joueur"] == "Lison" and "/static/js/joueurs/joueur.js" in sans_version(lea.get("/").text)
    c = compte_de(j["id"])
    assert c["identifiant"] == "Lison.V" and c["generation"] == 1 and c["provisoire_utilise"] == 1
    assert c["lien"] == joueurs.empreinte(jeton_de(j)) and acces.verifier(c["empreinte"], MOT_DE_PASSE)
    assert stat.S_IMODE((COMPTES / f"{j['id']}.json").stat().st_mode) == 0o600
    # La carte du MJ le dit ; le provisoire servi s'efface, jusqu'à son empreinte.
    assert carte(atelier, j["id"])["compte"] == {"identifiant": "Lison.V", "compte": True, "bloque": False, "provisoire": None}
    assert not (PROVISOIRES / f"{j['id']}.json").exists()
    # Ailleurs, son identifiant et son mot de passe.
    ailleurs = appareil()
    assert connecter(ailleurs, "lison.v").json() == {"ok": True, "suite": "/"}
    assert ailleurs.get("/api/moi").status_code == 200


def test_le_provisoire_ne_sert_qu_une_fois(atelier, invites):
    j = invites("Malo")
    mot = creer_compte(atelier, j, "malo").json()["provisoire"]
    # Deux appareils entrent avec ; le premier qui choisit l'emporte, l'autre n'ouvre plus rien.
    telephone, tablette = appareil(), appareil()
    assert connecter(telephone, "malo", mot).json()["choisir"] is True
    assert connecter(tablette, "malo", mot).json()["choisir"] is True
    assert choisir(telephone).status_code == 200
    assert tablette.get("/api/compte").status_code == 401 and choisir(tablette, "un autre mot").status_code == 401
    assert acces.verifier(compte_de(j["id"])["empreinte"], MOT_DE_PASSE)
    # Le provisoire ne rouvre plus, même avant que l'atelier l'ait effacé.
    assert (PROVISOIRES / f"{j['id']}.json").exists()
    r = connecter(appareil(), "malo", mot)
    assert r.status_code == 401 and r.json() == INCORRECT
    assert connecter(appareil(), "malo").status_code == 200


def test_le_provisoire_expire_au_bout_de_7_jours(atelier, invites, monkeypatch):
    j = invites("Nine")
    mot = creer_compte(atelier, j, "nine").json()["provisoire"]
    avant = appareil()
    assert connecter(avant, "nine", mot).status_code == 200
    vrai = provisoires.maintenant
    monkeypatch.setattr(provisoires, "maintenant", lambda: vrai() + timedelta(days=7, seconds=1))
    # Le bon provisoire le dit (il ne compte pas comme un essai manqué) ; un faux échoue comme toujours.
    r = connecter(appareil(), "nine", mot)
    assert r.status_code == 403 and "expiré" in r.json()["detail"] and joueurs.ESSAIS.echecs == []
    assert connecter(appareil(), "nine", "pas-le-bon-du-tout-22").json() == INCORRECT
    # L'appareil entré à temps ne peut plus choisir.
    assert choisir(avant).status_code == 401 and not (COMPTES / f"{j['id']}.json").exists()
    assert carte(atelier, j["id"])["compte"]["provisoire"]["expire"] is True
    # Le MJ en refait un : il marche.
    monkeypatch.setattr(provisoires, "maintenant", vrai)
    nouveau = creer_compte(atelier, j).json()
    assert nouveau["compte"]["identifiant"] == "nine" and provisoire_de(j["id"])["generation"] == 2
    joueurs.ESSAIS.clear()
    c = appareil()
    assert connecter(c, "nine", mot).status_code == 401
    assert connecter(c, "nine", nouveau["provisoire"]).status_code == 200 and choisir(c).status_code == 200


def test_un_nouveau_provisoire_coupe_toutes_les_sessions(atelier, invites):
    j = invites("Noé")
    telephone, tablette = appareil(), appareil()
    entrer(telephone, j, "noe-p")
    assert connecter(tablette, "noe-p").status_code == 200
    assert compte_de(j["id"])["provisoire_utilise"] == 1
    # « Mot de passe oublié » : l'identifiant ne change pas, quoi qu'envoie la page.
    r = creer_compte(atelier, j, "un-autre-nom")
    assert r.status_code == 200 and r.json()["compte"]["identifiant"] == "noe-p" and r.json()["compte"]["compte"] is True
    mot = r.json()["provisoire"]
    assert provisoire_de(j["id"])["generation"] == 2 and "noe-p" in r.json()["phrase"]
    # Toutes ses sessions tombent aussitôt, et l'ancien mot de passe ne vaut plus.
    assert telephone.get("/api/moi").status_code == 401 and tablette.get("/api/moi").status_code == 401
    assert connecter(appareil(), "noe-p").json() == INCORRECT
    c = carte(atelier, j["id"])["compte"]
    assert c["compte"] is True and c["provisoire"]["expire"] is False
    # Même parcours qu'à la création.
    assert connecter(telephone, "noe-p", mot).json()["choisir"] is True
    assert telephone.get("/api/compte").json() == {"etat": "choisir", "joueur": "Noé", "identifiant": "noe-p"}
    assert choisir(telephone, "la nuit des loups").status_code == 200
    c = compte_de(j["id"])
    assert c["generation"] == 2 and c["provisoire_utilise"] == 2 and c["identifiant"] == "noe-p"
    assert telephone.get("/api/moi").status_code == 200 and tablette.get("/api/moi").status_code == 401
    assert connecter(appareil(), "noe-p").status_code == 401
    assert connecter(tablette, "noe-p", "la nuit des loups").status_code == 200


def test_un_identifiant_pris_ou_retire_ne_se_redonne_pas(atelier, invites):
    vera = invites("Valère")
    entrer(appareil(), vera, "Valere")
    willy = invites("Wanda")
    for pris in ("VALERE", "valere", " Valere "):
        r = creer_compte(atelier, willy, pris)
        assert r.status_code == 409 and "déjà pris" in r.json()["detail"], pris
    for mauvais in ("ab", "a" * 33, "avec espace", "-tiret", "x/../y", "<b>", ""):
        assert creer_compte(atelier, willy, mauvais).status_code == 400, mauvais
    assert not (PROVISOIRES / f"{willy['id']}.json").exists()
    # Un provisoire en cours retient son identifiant, pour le MJ comme pour une création d'avant les comptes.
    xena = invites("Xena")
    assert creer_compte(atelier, xena, "xena-1").status_code == 200
    assert creer_compte(atelier, willy, "XENA-1").status_code == 409
    quentin = invites("Quirin")
    vieux = appareil()
    vieux.cookies.set("aventurier", f"{quentin['id']}.{joueurs.signature(joueur_publie(quentin['id']))}")
    r = vieux.post("/api/compte", json={"identifiant": "Xena-1", "mot_de_passe": MOT_DE_PASSE, "confirmation": MOT_DE_PASSE})
    assert r.status_code == 409
    # Un identifiant retiré ne resert jamais.
    zoe = invites("Zélie")
    entrer(appareil(), zoe, "zelie-r")
    assert atelier.delete(f"/api/joueurs/{zoe['id']}").status_code == 200
    assert creer_compte(atelier, willy, "Zelie-R").status_code == 409
    # La carte propose un identifiant libre : le prénom, puis un chiffre.
    bis = invites("Valère")
    assert bis["identifiant_propose"] not in ("valere", "") and bis["identifiant_propose"].startswith("valere")
    assert creer_compte(atelier, bis, bis["identifiant_propose"]).status_code == 200
    # Un joueur retiré emporte son provisoire en attente.
    assert atelier.delete(f"/api/joueurs/{xena['id']}").status_code == 200
    assert not (PROVISOIRES / f"{xena['id']}.json").exists()
    assert creer_compte(atelier, willy, "xena-1").status_code == 200


def test_un_provisoire_expire_garde_son_identifiant(atelier, invites, monkeypatch):
    """Un provisoire expiré, pas encore servi, retient son identifiant : « Nouveau provisoire » le redonne au même joueur
    (sa carte n'a plus de champ pour en choisir un autre). Donné à un autre entre-temps, les deux joueurs restaient
    bloqués : la connexion tombait sur le provisoire expiré du premier, et le MJ ne pouvait plus en tirer pour lui."""
    olga = invites("Olga")
    assert creer_compte(atelier, olga, "olga").status_code == 200
    vrai = provisoires.maintenant
    monkeypatch.setattr(provisoires, "maintenant", lambda: vrai() + timedelta(days=8))
    assert carte(atelier, olga["id"])["compte"]["provisoire"]["expire"] is True
    paul = invites("Paul")
    r = creer_compte(atelier, paul, "OLGA")
    assert r.status_code == 409 and "déjà pris" in r.json()["detail"]
    assert carte(atelier, paul["id"])["identifiant_propose"] != "olga"
    # Le MJ refait le provisoire d'Olga : même identifiant, et il ouvre.
    nouveau = creer_compte(atelier, olga)
    assert nouveau.status_code == 200 and nouveau.json()["compte"]["identifiant"] == "olga"
    monkeypatch.setattr(provisoires, "maintenant", vrai)
    c = appareil()
    assert connecter(c, "olga", nouveau.json()["provisoire"]).status_code == 200 and choisir(c).status_code == 200


def test_les_comptes_d_avant_et_leurs_sessions_restent(atelier, invites):
    """Les trois comptes créés par lien n'ont pas de provisoire : leur mot de passe et leurs sessions marchent."""
    j = invites("Dorian")
    publie = joueur_publie(j["id"])
    compte = comptes.creer(config.PROPOSITIONS, j["id"], publie["jeton"], "Vortan-p", acces.empreinte("mot de passe d'avant"))
    assert "provisoire_utilise" not in compte
    brut = (COMPTES / f"{j['id']}.json").read_bytes()
    ancien = appareil()
    ancien.cookies.set("aventurier", joueurs.session(publie, compte))
    assert ancien.get("/api/moi").status_code == 200
    assert carte(atelier, j["id"])["compte"] == {"identifiant": "Vortan-p", "compte": True, "bloque": False, "provisoire": None}
    assert connecter(appareil(), "vortan-p", "mot de passe d'avant").status_code == 200
    # Rien ne l'a réécrit, ni la liste des joueurs ni les connexions.
    assert (COMPTES / f"{j['id']}.json").read_bytes() == brut
    assert ancien.post("/api/compte/mot-de-passe", json={"actuel": "mot de passe d'avant", "nouveau": "nouveau mot à moi",
                                                         "confirmation": "nouveau mot à moi"}).status_code == 200
    assert ancien.get("/api/moi").status_code == 200


def test_un_compte_dont_le_dernier_lien_n_a_jamais_servi_rouvre_par_un_provisoire(atelier, invites):
    """Un compte d'A1 dont le MJ avait fait « Nouveau lien » sans que le joueur l'ouvre : son lien ne correspond plus. Il
    ne rouvre que par un provisoire, qui le remet sur le jeton du joueur."""
    j = invites("Ewen")
    compte = comptes.creer(config.PROPOSITIONS, j["id"], "0" * 64, "elian-a1", acces.empreinte("mot de passe d'avant"))
    assert compte["lien"] != joueur_publie(j["id"])["jeton"]
    r = connecter(appareil(), "elian-a1", "mot de passe d'avant")
    assert r.status_code == 403 and "provisoire" in r.json()["detail"]
    assert carte(atelier, j["id"])["compte"]["bloque"] is True
    mot = creer_compte(atelier, j).json()["provisoire"]
    c = appareil()
    assert connecter(c, "elian-a1", mot).status_code == 200 and choisir(c).status_code == 200
    assert compte_de(j["id"])["lien"] == joueur_publie(j["id"])["jeton"] and c.get("/api/moi").status_code == 200


def test_un_ancien_lien_ne_cree_rien_et_n_ouvre_rien(atelier, invites):
    j = invites("Pacome")
    jeton = jeton_de(j)
    # Le lien d'avant, encore dans une messagerie : vers la connexion, sans cookie, sans compte, sans dire s'il était bon.
    for cle in (jeton, "faux"):
        c = appareil()
        r = c.get(f"/?cle={cle}", follow_redirects=False)
        assert r.status_code == 303 and r.headers["location"] == "/connexion?lien=ancien" and "set-cookie" not in r.headers
        assert c.get("/api/compte").status_code == 401 and c.get("/compte", follow_redirects=False).status_code == 303
    assert not (COMPTES / f"{j['id']}.json").exists()
    page = appareil().get("/connexion?lien=ancien").text
    assert "Se connecter" in page and "mot de passe provisoire" in page
    statique = Path(joueurs.__file__).resolve().parent / "static"
    assert "Demandez à votre MJ votre identifiant et un mot de passe provisoire." in (statique / "js/joueurs/compte.js").read_text(encoding="utf-8")
    # Avec un compte, pas davantage.
    entrer(appareil(), j, "pacome")
    c = appareil()
    assert c.get(f"/?cle={jeton}", follow_redirects=False).headers["location"] == "/connexion?lien=ancien"
    assert c.get("/api/moi").status_code == 401
    # Plus de « Nouveau lien » dans l'atelier, ni de lien dans ses réponses.
    assert atelier.post(f"/api/joueurs/{j['id']}/lien").status_code in (404, 405)
    tout = atelier.get("/api/joueurs").text
    assert jeton not in tout and "?cle=" not in tout
    # Un cookie d'avant les comptes invite encore (la migration), sauf quand le MJ a tiré un provisoire.
    rose = invites("Rosalie")
    vieux = appareil()
    vieux.cookies.set("aventurier", f"{rose['id']}.{joueurs.signature(joueur_publie(rose['id']))}")
    assert vieux.get("/api/compte").json() == {"etat": "creer", "joueur": "Rosalie"}
    creer_compte(atelier, rose, "rosalie")
    assert vieux.get("/", follow_redirects=False).status_code == 200 and vieux.get("/api/compte").status_code == 401
    r = vieux.post("/api/compte", json={"identifiant": "rosalie-bis", "mot_de_passe": MOT_DE_PASSE, "confirmation": MOT_DE_PASSE})
    assert r.status_code == 401 and not (COMPTES / f"{rose['id']}.json").exists()


def test_un_provisoire_refait_avant_le_choix_rend_l_ancien_caduc(atelier, invites):
    j = invites("Apolline")
    premier = creer_compte(atelier, j, "apolline").json()["provisoire"]
    c = appareil()
    assert connecter(c, "apolline", premier).status_code == 200
    second = creer_compte(atelier, j).json()["provisoire"]
    # L'appareil entré avec le premier ne choisit plus rien, et le lit (sa page renvoie à la connexion) ; le premier ne
    # rouvre plus ; seul le second marche.
    r = choisir(c)
    assert r.status_code == 401 and r.json()["detail"] == provisoires.CADUC and not (COMPTES / f"{j['id']}.json").exists()
    assert "invitation" not in c.cookies
    assert appareil().post("/api/compte", json={"mot_de_passe": MOT_DE_PASSE, "confirmation": MOT_DE_PASSE}).json()["detail"] != provisoires.CADUC
    assert connecter(appareil(), "apolline", premier).json() == INCORRECT
    d = appareil()
    assert connecter(d, "apolline", second).status_code == 200 and choisir(d).status_code == 200


def test_la_course_entre_un_provisoire_refait_et_une_connexion(atelier, invites, monkeypatch):
    """Le MJ refait le provisoire pendant que le joueur enregistre son mot de passe : l'un attend l'autre (le verrou des
    comptes), et quel que soit l'ordre, un seul mot de passe vaut ensuite, celui du dernier provisoire."""
    j = invites("Brice")
    premier = creer_compte(atelier, j, "brice").json()["provisoire"]
    c = appareil()
    assert connecter(c, "brice", premier).status_code == 200
    # L'écriture du compte traîne : le MJ tire son nouveau provisoire pendant ce temps.
    lent, dedans = comptes.ecrire, threading.Event()

    def ecrire(*args):
        dedans.set()
        time.sleep(0.4)
        lent(*args)
    monkeypatch.setattr(comptes, "ecrire", ecrire)
    statut = []
    fil = threading.Thread(target=lambda: statut.append(choisir(c, "mon mot de passe").status_code))
    fil.start()
    assert dedans.wait(5)
    second = creer_compte(atelier, j).json()["provisoire"]
    fil.join()
    monkeypatch.setattr(comptes, "ecrire", lent)
    assert statut == [200]
    c_ = compte_de(j["id"])
    assert c_["provisoire_utilise"] == 1 and provisoire_de(j["id"])["generation"] == 2
    # Le mot de passe choisi entre-temps tombe aussitôt, sa session aussi ; le premier provisoire ne vaut rien ; le second
    # ouvre, une fois.
    assert c.get("/api/moi").status_code == 401
    assert connecter(appareil(), "brice", "mon mot de passe").json() == INCORRECT
    assert connecter(appareil(), "brice", premier).json() == INCORRECT
    d = appareil()
    assert connecter(d, "brice", second).json()["choisir"] is True and choisir(d, "le vrai cette fois").status_code == 200
    assert connecter(appareil(), "brice", "le vrai cette fois").status_code == 200
    assert connecter(appareil(), "brice", "mon mot de passe").status_code == 401


def test_la_generation_tranche():
    """Un provisoire qui a servi ne sert plus ; un nouveau a une génération plus haute que celle que le compte note, et un
    choix fait avec l'ancien est refusé."""
    depot = Path(tempfile.mkdtemp(prefix="provisoires-"))
    provisoires.poser(depot, "lou", "lou", acces.empreinte("unmotdepasse22"))
    compte = provisoires.utiliser(depot, "lou", 1, acces.empreinte("le sien"), "x" * 64)
    assert provisoires.en_cours(depot, "lou", compte) is None
    provisoires.poser(depot, "lou", None, acces.empreinte("unautremot33"))
    assert provisoires.en_cours(depot, "lou", comptes.lire(depot, "lou"))["generation"] == 2
    with pytest.raises(comptes.Refus):
        provisoires.utiliser(depot, "lou", 1, acces.empreinte("encore"), "x" * 64)
    assert provisoires.pour_la_connexion(depot, "lou")[1]["generation"] == 2


def test_anti_essais_du_provisoire(atelier, invites, monkeypatch):
    j = invites("Sixtine")
    mot = creer_compte(atelier, j, "sixtine").json()["provisoire"]
    for _ in range(5):
        assert connecter(appareil(), "sixtine", "lune-lune-lune-22", ip="203.0.113.5").status_code == 401
    # Même le bon provisoire attend, depuis cette adresse ; une autre passe.
    r = connecter(appareil(), "sixtine", mot, ip="203.0.113.5")
    assert r.status_code == 429 and "set-cookie" not in r.headers
    assert connecter(appareil(), "sixtine", mot, ip="198.51.100.7").status_code == 200
    # 10 par identifiant, d'adresses différentes.
    joueurs.ESSAIS.clear()
    for i in range(10):
        assert connecter(appareil(), "sixtine", "pomme-poire-prune-33", ip=f"198.51.100.{i + 20}").status_code == 401
    assert connecter(appareil(), "sixtine", mot, ip="198.51.100.99").status_code == 429
    # Un identifiant inconnu échoue de même, avec le même calcul unique, et le même message.
    joueurs.ESSAIS.clear()
    calculs = []
    vrai = acces.verifier
    monkeypatch.setattr(acces, "verifier", lambda e, m: calculs.append(e) or vrai(e, m))
    inconnu = connecter(appareil(), "personne-ici", "lune-lune-lune-22")
    connu = connecter(appareil(), "sixtine", "lune-lune-lune-22")
    assert inconnu.status_code == connu.status_code == 401 and inconnu.json() == connu.json() == INCORRECT
    assert len(calculs) == 2 and all(e.startswith(f"scrypt:{2 ** 15}:8:1:") for e in calculs)


def test_aucun_provisoire_ni_empreinte_ni_jeton_ne_sort(atelier, invites, caplog):
    """Le provisoire en clair : dans la seule réponse qui le tire. Son empreinte, celle du mot de passe, le jeton interne :
    nulle part, ni dans une réponse du coin, de l'atelier ou du carnet, ni dans un journal, ni dans un cookie."""
    caplog.set_level(logging.DEBUG)
    j = invites("Dalia")
    jeton = jeton_de(j)
    tire = creer_compte(atelier, j, "dalia")
    mot = tire.json()["provisoire"]
    p = provisoire_de(j["id"])
    d = appareil()
    reponses = [connecter(d, "dalia", mot), d.get("/api/compte"), d.get("/compte"), d.get("/")]
    reponses += [choisir(d), d.get("/api/compte"), d.get("/api/moi"), d.get("/api/carnet"), d.get("/api/echoppe"), d.get("/")]
    c = compte_de(j["id"])
    second = creer_compte(atelier, j)
    mot2 = second.json()["provisoire"]
    p2 = provisoire_de(j["id"])
    reponses += [atelier.get("/api/joueurs"), atelier.get(f"/api/joueurs/{j['id']}/apercu"), atelier.get("/api/carnet-joueurs"),
                 atelier.get("/api/corbeille"), connecter(d, "dalia", mot2), d.get("/api/compte")]
    assert atelier.put("/api/carnet-joueurs", json={"ouvert": True}).status_code == 200
    try:
        carnet_api.publier_carnet()
        assert choisir(d, "autre mot de passe").status_code == 200
        reponses += [d.get("/api/carnet"), atelier.get(f"/api/joueurs/{j['id']}/apercu")]
        publie = "\n".join(f.read_text(encoding="utf-8", errors="replace") for f in (config.PROPOSITIONS / "carnet").rglob("*.json"))
    finally:
        atelier.put("/api/carnet-joueurs", json={"ouvert": False})
    interdits = [jeton, "scrypt:"]
    for empr in (p["empreinte"], p2["empreinte"], c["empreinte"]):
        _, _, _, _, sel, hachage = empr.split(":")
        interdits += [empr, sel, hachage]
    textes = [r.text + json.dumps(dict(r.headers)) for r in reponses + [tire, second]]
    textes += [publie, (config.PROPOSITIONS / ".acces.json").read_text(encoding="utf-8"), caplog.text]
    for texte in textes:
        for interdit in interdits:
            assert interdit not in texte
    # Chaque provisoire en clair, dans sa seule réponse.
    for texte in [r.text + json.dumps(dict(r.headers)) for r in reponses] + [publie, caplog.text, second.text]:
        assert mot not in texte and provisoires.canonique(mot) not in texte
    for texte in [r.text + json.dumps(dict(r.headers)) for r in reponses] + [publie, caplog.text, tire.text]:
        assert mot2 not in texte
    # Ni dans les données de l'atelier ou du coin, ni dans les cookies.
    for f in config.DONNEES.rglob("*"):
        if f.is_file() and f.stat().st_size < 2_000_000:
            contenu = f.read_bytes()
            assert mot.encode() not in contenu and mot2.encode() not in contenu, f
    for valeur in d.cookies.values():
        assert all(x not in valeur for x in (*interdits, mot, mot2, c["lien"]))
    # Rien de nouveau à la racine des propositions, lue comme des propositions de héros.
    racine = {f.name for f in config.PROPOSITIONS.iterdir() if f.is_file()}
    assert all(not n.startswith(("compte", "provisoire")) for n in racine)


def test_les_mots_du_provisoire():
    assert len(provisoires.MOTS) >= 200 and len(set(provisoires.MOTS)) == len(provisoires.MOTS)
    assert all(re.fullmatch(r"[a-z]{4,9}", m) for m in provisoires.MOTS)
    tires = {provisoires.tirer() for _ in range(200)}
    assert len(tires) == 200 and all(FORME.match(t) for t in tires)
    assert provisoires.canonique("Lune - TIGRE sablé 47") == "lunetigresable47"
    assert provisoires.simple("Jean-Noël Brière") == "jean-noelbriere" and provisoires.simple("  ") == ""
