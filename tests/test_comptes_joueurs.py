"""Les comptes des joueurs du coin (comptes.py, acces.py) : un nouveau mot de passe coupe toutes les sessions ; un ancien
cookie invite à créer son compte pendant la migration ; les essais manqués sont comptés ; un cookie forgé n'entre pas ;
un joueur retiré emporte son compte. Les mots de passe provisoires du MJ, qui remplacent les liens à clé depuis le lot
A1b, ont leurs essais dans test_comptes_provisoires.py."""
import asyncio
import json
import os
import stat
import sys
import tempfile
import threading
import time
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from commun import acces  # noqa: E402
from commun import comptes  # noqa: E402
import joueurs  # noqa: E402
import main  # noqa: E402
from api import application, config  # noqa: E402
from comptes_coin import MOT_DE_PASSE, entrer, sans_version  # noqa: E402

COMPTES = config.PROPOSITIONS / comptes.DOSSIER
MEME_ORIGINE = {"Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"}


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


def ancien_cookie(j) -> str:
    """Le cookie qu'un appareil gardait d'avant les comptes (« <joueur>.<signature> ») : il invite à créer son compte."""
    return f"{j['id']}.{joueurs.signature(joueur_publie(j['id']))}"


def appareil_d_avant(j):
    c = appareil()
    c.cookies.set("aventurier", ancien_cookie(j))
    return c


def appareil():
    return TestClient(joueurs.app)


def creer(client, ident, mdp=MOT_DE_PASSE, confirmation=None):
    return client.post("/api/compte", json={"identifiant": ident, "mot_de_passe": mdp,
                                            "confirmation": mdp if confirmation is None else confirmation})


def connecter(client, ident, mdp=MOT_DE_PASSE, ip=None):
    return client.post("/api/connexion", json={"identifiant": ident, "mot_de_passe": mdp},
                       headers={"CF-Connecting-IP": ip} if ip else {})


def compte_de(ident):
    return json.loads((COMPTES / f"{ident}.json").read_text(encoding="utf-8"))


def carte(atelier, ident):
    return next(j for j in atelier.get("/api/joueurs").json() if j["id"] == ident)


def joueur_publie(ident):
    return next(x for x in joueurs.acces() if x["id"] == ident)


def test_changer_son_mot_de_passe_coupe_les_autres_appareils(atelier, invites):
    j = invites("Odile")
    ici, ailleurs = appareil(), appareil()
    entrer(ici, j, "odile")
    connecter(ailleurs, "odile")
    corps = {"actuel": "pas le bon du tout", "nouveau": "la nuit des loups", "confirmation": "la nuit des loups"}
    r = ici.post("/api/compte/mot-de-passe", json=corps)
    assert r.status_code == 403 and r.json()["detail"] == "Mot de passe actuel incorrect."
    assert ici.post("/api/compte/mot-de-passe", json={**corps, "actuel": MOT_DE_PASSE, "confirmation": "autre"}).status_code == 400
    assert ici.post("/api/compte/mot-de-passe", json={**corps, "actuel": MOT_DE_PASSE, "nouveau": "odile", "confirmation": "odile"}).status_code == 400
    r = ici.post("/api/compte/mot-de-passe", json={**corps, "actuel": MOT_DE_PASSE})
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert compte_de(j["id"])["generation"] == 2
    assert ici.get("/api/moi").status_code == 200 and ailleurs.get("/api/moi").status_code == 401
    assert connecter(appareil(), "odile").status_code == 401
    assert connecter(appareil(), "odile", "la nuit des loups").status_code == 200
    # Sans session, rien ne change.
    assert appareil().post("/api/compte/mot-de-passe", json=corps).status_code == 401


def test_un_ancien_cookie_invite_a_creer_son_compte(atelier, invites, monkeypatch):
    """Gardée tant qu'elle court (30 jours) : c'est une session ouverte avant les comptes sur un appareil du joueur, pas
    un lien qu'on recopie d'un message."""
    j = invites("Quentin")
    ancien = ancien_cookie(j)
    vieux = appareil()
    # Posé par le coin d'avant pour cet hôte : le nouveau cookie le remplace, comme dans un navigateur.
    vieux.cookies.set("aventurier", ancien, domain="testserver.local")
    # Il n'ouvre plus le coin, il invite à créer son compte, sans lien à renvoyer.
    assert vieux.get("/api/moi").status_code == 401
    r = vieux.get("/", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/compte"
    assert vieux.get("/api/compte").json() == {"etat": "creer", "joueur": "Quentin"}
    assert creer(vieux, "quentin").status_code == 200
    assert vieux.cookies.get("aventurier").startswith("v2.") and vieux.get("/api/moi").status_code == 200
    # L'ancien cookie, ailleurs, n'invite plus (le compte existe).
    autre = appareil()
    autre.cookies.set("aventurier", ancien)
    assert autre.get("/", follow_redirects=False).status_code == 200 and autre.get("/api/compte").status_code == 401
    # Un ancien cookie faux n'invite pas ; après les 30 jours, plus aucun n'invite.
    j2 = invites("Rose")
    faux = appareil()
    faux.cookies.set("aventurier", f"{j2['id']}.{'0' * 40}")
    assert faux.get("/", follow_redirects=False).status_code == 200 and creer(faux, "rose").status_code == 401
    bon = f"{j2['id']}.{joueurs.signature(joueur_publie(j2['id']))}"
    monkeypatch.setitem(comptes._FIN_MIGRATION, str(config.PROPOSITIONS), time.time() - 1)
    tard = appareil()
    tard.cookies.set("aventurier", bon)
    assert tard.get("/", follow_redirects=False).status_code == 200 and creer(tard, "rose").status_code == 401


def test_la_migration_dure_trente_jours_depuis_le_premier_passage(tmp_path):
    fin = comptes.fin_migration(tmp_path)
    assert abs(fin - (time.time() + 30 * 86400)) < 5
    note = (tmp_path / comptes.DOSSIER / comptes.MIGRATION).read_text(encoding="utf-8")
    comptes._FIN_MIGRATION.clear()
    assert comptes.fin_migration(tmp_path) == pytest.approx(fin, abs=1)
    assert (tmp_path / comptes.DOSSIER / comptes.MIGRATION).read_text(encoding="utf-8") == note


def test_trop_d_essais_manques(atelier, invites, monkeypatch):
    j = invites("Sacha")
    entrer(appareil(), j, "sacha")
    c = appareil()
    for _ in range(5):
        assert connecter(c, "sacha", "mauvais", ip="203.0.113.5").status_code == 401
    # Même le bon mot de passe attend, depuis cette adresse ; une autre adresse passe.
    r = connecter(c, "sacha", ip="203.0.113.5")
    assert r.status_code == 429 and "set-cookie" not in r.headers
    assert connecter(c, "sacha", ip="198.51.100.7").status_code == 200
    # 10 essais manqués sur un identifiant, d'adresses différentes : il attend une heure, les autres non.
    joueurs.ESSAIS.clear()
    for i in range(10):
        assert connecter(appareil(), "sacha", "mauvais", ip=f"198.51.100.{i + 20}").status_code == 401
    assert connecter(appareil(), "sacha", ip="198.51.100.99").status_code == 429
    # Et 50 en tout, toutes adresses et tous identifiants confondus (ici 3).
    joueurs.ESSAIS.clear()
    monkeypatch.setattr(joueurs, "ECHECS_EN_TOUT", 3)
    for i in range(3):
        assert connecter(appareil(), f"inconnu-{i}", "mauvais", ip=f"192.0.2.{i}").status_code == 401
    # Passé ce plafond, la porte ne se ferme pas à tous : le bon mot de passe entre d'une adresse qui n'a rien manqué,
    # et une adresse n'a plus que deux essais manqués.
    assert connecter(appareil(), "sacha", ip="192.0.2.200").status_code == 200
    assert connecter(appareil(), "inconnu-9", "mauvais", ip="192.0.2.0").status_code == 401
    assert connecter(appareil(), "sacha", ip="192.0.2.0").status_code == 429
    # Le changement de mot de passe compte aussi ses essais.
    joueurs.ESSAIS.clear()
    monkeypatch.setattr(joueurs, "ECHECS_EN_TOUT", 50)
    ici = appareil()
    connecter(ici, "sacha")
    for _ in range(5):
        assert ici.post("/api/compte/mot-de-passe", json={"actuel": "faux", "nouveau": "nouveau secret", "confirmation": "nouveau secret"}).status_code == 403
    assert ici.post("/api/compte/mot-de-passe", json={"actuel": MOT_DE_PASSE, "nouveau": "nouveau secret", "confirmation": "nouveau secret"}).status_code == 429


def test_l_echec_ne_dit_pas_si_l_identifiant_existe_et_attend(atelier, invites, monkeypatch):
    j = invites("Tom")
    entrer(appareil(), j, "tom")
    monkeypatch.setattr(joueurs, "ATTENTE_ECHEC", 0.3)
    calculs = []
    vrai = acces.verifier
    monkeypatch.setattr(acces, "verifier", lambda e, m: calculs.append(e) or vrai(e, m))
    debut = time.monotonic()
    inconnu = connecter(appareil(), "personne-ici", "mauvais")
    assert time.monotonic() - debut >= 0.3
    connu = connecter(appareil(), "tom", "mauvais")
    assert inconnu.status_code == connu.status_code == 401
    assert inconnu.json() == connu.json() == {"detail": "Identifiant ou mot de passe incorrect."}
    # Un identifiant inconnu coûte le même calcul scrypt qu'un vrai.
    assert len(calculs) == 2 and all(e.startswith(f"scrypt:{2 ** 15}:8:1:") for e in calculs)


def test_les_regles_du_compte(atelier, invites):
    j = invites("Ulysse")
    u = appareil_d_avant(j)
    for ident in ("ab", "a" * 33, "avec espace", "-tiret", "_trait", "adresse@ici", "x/../y", 42, None, "<b>"):
        assert creer(u, ident).status_code == 400, ident
    assert creer(u, "ulysse", "court").status_code == 400
    assert creer(u, "ulysse", "        ").status_code == 400
    assert creer(u, "ulysse", "x" * 129).status_code == 400
    assert creer(u, "ulysse", "assez long", "pas pareil").status_code == 400
    assert creer(u, "Ulysse99", "ulysse99").status_code == 400  # le mot de passe ne peut pas être l'identifiant
    assert not (COMPTES / f"{j['id']}.json").exists()
    assert creer(u, "ulysse", "ulysse99").status_code == 200
    assert compte_de(j["id"])["identifiant"] == "ulysse"


def test_la_creation_par_un_ancien_cookie_compte_ses_essais(atelier, invites):
    """Un ancien cookie (30 jours de migration) ne sonde pas les identifiants sans limite : un identifiant pris compte comme
    un essai manqué, par adresse (5 en un quart d'heure) et par joueur (10 en une heure) ; une forme refusée ne compte pas.
    Défaut relevé au contrôle de la vague 5."""
    a = invites("Anatole")
    b = invites("Brunehilde")
    entrer(appareil(), a, "Anatole")
    w = appareil_d_avant(b)
    ici = {"CF-Connecting-IP": "203.0.113.9"}
    for _ in range(3):
        assert w.post("/api/compte", json={"identifiant": "brunehilde", "mot_de_passe": "court", "confirmation": "court"},
                      headers=ici).status_code == 400
    for _ in range(5):
        r = w.post("/api/compte", json={"identifiant": "anatole", "mot_de_passe": MOT_DE_PASSE, "confirmation": MOT_DE_PASSE}, headers=ici)
        assert r.status_code == 409
    r = w.post("/api/compte", json={"identifiant": "brunehilde", "mot_de_passe": MOT_DE_PASSE, "confirmation": MOT_DE_PASSE}, headers=ici)
    assert r.status_code == 429 and "set-cookie" not in r.headers and comptes.lire(config.PROPOSITIONS, b["id"]) is None
    # Par joueur : dix sondes d'adresses différentes, puis plus rien ce soir-là, même d'une adresse neuve.
    joueurs.ESSAIS.clear()
    for i in range(10):
        assert w.post("/api/compte", json={"identifiant": "anatole", "mot_de_passe": MOT_DE_PASSE, "confirmation": MOT_DE_PASSE},
                      headers={"CF-Connecting-IP": f"198.51.100.{i + 40}"}).status_code == 409
    assert w.post("/api/compte", json={"identifiant": "brunehilde", "mot_de_passe": MOT_DE_PASSE, "confirmation": MOT_DE_PASSE},
                  headers={"CF-Connecting-IP": "198.51.100.200"}).status_code == 429
    # Un succès efface ses propres fautes : le compte se crée une fois les essais rendus.
    joueurs.ESSAIS.clear()
    assert creer(w, "anatole").status_code == 409
    assert creer(w, "brunehilde").status_code == 200
    assert not [e for e in joueurs.ESSAIS.echecs if ("creation", b["id"]) in e[1]]


def test_un_identifiant_pris_ne_se_reprend_pas(atelier, invites):
    a = invites("Vera")
    b = invites("Willy")
    entrer(appareil(), a, "Vera")
    w = appareil_d_avant(b)
    r = creer(w, "VERA")
    assert r.status_code == 409 and "déjà pris" in r.json()["detail"]
    assert creer(w, "willy").status_code == 200


def test_un_cookie_force_n_entre_pas(atelier, invites):
    j = invites("Xavier")
    x = appareil()
    entrer(x, j, "xavier")
    bon = x.cookies.get("aventurier")
    v, ident, generation, echeance, sig = bon.split(".")
    assert (v, ident, generation) == ("v2", j["id"], "1")
    publie, c = joueur_publie(j["id"]), compte_de(j["id"])
    vrai = lambda champs, e: joueurs.signature_session(publie, c, champs, e)  # noqa: E731
    autre = invites("Yann")
    entrer(appareil(), autre, "yann")
    # Le dernier chiffre changé pour un autre : une signature qui finit déjà par « 0 » (une fois sur seize) resterait
    # sinon la vraie, et le test échouerait au hasard.
    retouchee = sig[:-1] + ("1" if sig[-1] == "0" else "0")
    forges = [
        f"v2.{ident}.{generation}.{int(echeance) + 999}.{sig}",  # échéance repoussée
        f"v2.{ident}.2.{echeance}.{sig}",  # génération changée
        f"v2.{autre['id']}.{generation}.{echeance}.{sig}",  # un autre joueur
        f"v2.{ident}.{generation}.{echeance}.{retouchee}",  # signature retouchée
        f"v2.{ident}.{generation}.{echeance}",  # tronqué
        acces.jeton_signe(["v2", ident, 1], int(time.time()) - 10, vrai),  # signé, mais échu
        acces.jeton_signe(["v2", ident, 1], int(time.time()) + 600,  # signé d'une autre clé
                          lambda champs, e: acces.signer(b"pas-la-cle", "|".join([*champs, str(e), c["empreinte"], publie["jeton"]]))),
        f"{ident}.{sig[:40]}",  # l'ancien format, signature fausse
        "",
    ]
    for valeur in forges:
        pirate = appareil()
        pirate.cookies.set("aventurier", valeur)
        assert pirate.get("/api/moi").status_code == 401, valeur
        assert pirate.get("/fiche", follow_redirects=False).status_code == 303, valeur
        assert "data-connexion" in pirate.get("/").text, valeur
    # Une signature hors ASCII (un cookie se lit en latin-1) : refusée sans erreur du serveur.
    for valeur in (f"v2.{ident}.{generation}.{echeance}.{'é' * len(sig)}", f"{ident}.{'é' * 40}"):
        brut = f"aventurier={valeur}".encode("latin-1")
        assert appareil().get("/api/moi", headers={"Cookie": brut}).status_code == 401
        assert appareil().get("/", headers={"Cookie": brut}).status_code == 200
    # Le vrai, recopié, passe ; les mêmes champs signés de la bonne clé aussi.
    copie = appareil()
    copie.cookies.set("aventurier", acces.jeton_signe(["v2", ident, 1], int(time.time()) + 600, vrai))
    assert copie.get("/api/moi").status_code == 200
    # Une invitation forgée ne crée rien, ni d'avant (trois morceaux), ni d'après le provisoire (quatre).
    for forgee in (f"{autre['id']}.{int(time.time()) + 600}.{'a' * 64}", f"{autre['id']}.1.{int(time.time()) + 600}.{'a' * 64}"):
        pirate = appareil()
        pirate.cookies.set("invitation", forgee)
        assert creer(pirate, "pirate").status_code == 401 and pirate.get("/api/compte").status_code == 401


def test_un_joueur_retire_emporte_son_compte(atelier, invites):
    j = invites("Zoé")
    z = appareil()
    entrer(z, j, "zoe")
    assert atelier.delete(f"/api/joueurs/{j['id']}").status_code == 200
    # Effacé, empreinte comprise ; son identifiant ne resert plus.
    assert not (COMPTES / f"{j['id']}.json").exists()
    assert "zoe" in comptes.retires(config.PROPOSITIONS)
    assert stat.S_IMODE((COMPTES / comptes.RETIRES).stat().st_mode) == 0o600
    assert z.get("/api/moi").status_code == 401
    r = connecter(appareil(), "zoe")
    assert r.status_code == 401 and r.json()["detail"] == "Identifiant ou mot de passe incorrect."
    # Réinvitée sous le même prénom, elle reprend son identifiant de joueur (F4), jamais l'ancien compte.
    nouveau = invites("Zoé")
    assert nouveau["id"] == j["id"] and nouveau["compte"] is None and nouveau["identifiant_propose"] != "zoe"
    r = atelier.post(f"/api/joueurs/{nouveau['id']}/provisoire", json={"identifiant": "Zoe"})
    assert r.status_code == 409 and "déjà pris" in r.json()["detail"]
    assert atelier.post(f"/api/joueurs/{nouveau['id']}/provisoire", json={"identifiant": "zoe-2"}).status_code == 200
    assert connecter(appareil(), "zoe").status_code == 401


def test_deux_creations_simultanees_du_meme_identifiant(atelier, invites, monkeypatch):
    a = invites("Agathe")
    b = invites("Bruno")
    clients = []
    for j in (a, b):
        c = appareil_d_avant(j)
        assert c.get("/", follow_redirects=False).headers["location"] == "/compte"
        clients.append(c)
    # L'écriture traîne : sans le verrou, les deux vérifieraient l'identifiant libre avant que l'un ne l'écrive.
    lent = comptes.ecrire

    def ecrire(*args):
        time.sleep(0.3)
        lent(*args)
    monkeypatch.setattr(comptes, "ecrire", ecrire)
    depart = threading.Barrier(2)
    statuts = []

    def essayer(c):
        depart.wait()
        statuts.append(creer(c, "Corbeau").status_code)
    fils = [threading.Thread(target=essayer, args=(c,)) for c in clients]
    for f in fils:
        f.start()
    for f in fils:
        f.join()
    assert sorted(statuts) == [200, 409]
    assert [c["joueur"] for c in comptes.tous(config.PROPOSITIONS) if c["forme"] == "corbeau"] in ([a["id"]], [b["id"]])


def test_deux_calculs_au_plus_a_la_fois():
    en_cours, plus_haut = [0], [0]
    verrou = threading.Lock()

    def calcul(_):
        with verrou:
            en_cours[0] += 1
            plus_haut[0] = max(plus_haut[0], en_cours[0])
        time.sleep(0.05)
        with verrou:
            en_cours[0] -= 1
        return threading.current_thread() is not threading.main_thread()

    async def rafale():
        return await asyncio.gather(*(acces.calculer(calcul, i) for i in range(6)))
    hors_boucle = asyncio.run(rafale())
    assert plus_haut[0] == 2 and all(hors_boucle)


def test_les_essais_se_reservent_et_se_rendent():
    e = acces.Essais()
    limites = {"a": (2, 900)}
    un = e.reserver(("a", "x"), limites, 10)
    deux = e.reserver(("a", "y"), limites, 10)
    # Deux essais en vol comptent déjà : le troisième attend, même avant la fin des deux premiers.
    assert un and deux and e.reserver(("a", "z"), limites, 10) is None
    e.liberer(un)
    assert e.permis(limites, 10)
    e.oublier("a", "y")
    assert e.echecs == [] and e.permis(limites, 10)


def test_routes_du_compte_sous_la_garde(atelier, invites):
    j = invites("Céline")
    c = appareil_d_avant(j)
    corps = json.dumps({"identifiant": "celine", "mot_de_passe": MOT_DE_PASSE, "confirmation": MOT_DE_PASSE})
    for route in ("/api/compte", "/api/connexion", "/api/deconnexion", "/api/compte/mot-de-passe"):
        for entetes, statut in (({"Origin": "https://pirate.example", "Content-Type": "application/json"}, 403),
                                ({"Sec-Fetch-Site": "cross-site", "Content-Type": "application/json"}, 403),
                                ({"Content-Type": "text/plain"}, 415),
                                ({"Content-Type": "application/x-www-form-urlencoded"}, 415)):
            assert c.request("POST", route, content=corps, headers=entetes).status_code == statut, (route, entetes)
        assert c.post(route, json={}).headers["cache-control"] == "no-store"
    assert not (COMPTES / f"{j['id']}.json").exists()
    c.cookies.set("aventurier", ancien_cookie(j))  # « Se déconnecter » l'a retiré
    assert c.post("/api/compte", content=corps, headers={"Content-Type": "application/json", **MEME_ORIGINE}).status_code == 200


def test_les_pages_du_compte(atelier, invites):
    anonyme = appareil()
    page = anonyme.get("/connexion")
    assert page.status_code == 200 and 'method="post"' in page.text and "/static/js/joueurs/compte.js" in sans_version(page.text)
    assert anonyme.get("/compte", follow_redirects=False).headers["location"] == "/connexion"
    for f in ("js/joueurs/compte.js", "js/joueurs/pied-coin.js", "css/compte-coin.css"):
        assert f in joueurs.FICHIERS and anonyme.get(f"/static/{f}").status_code == 200, f
    # Chaque page du coin a ses deux liens discrets ; les pages du compte ne sont pas des fichiers servis tels quels.
    statique = Path(joueurs.__file__).resolve().parent / "static"
    for nom in ("index.html", "carnet.html"):
        html = (statique / "joueurs" / nom).read_text(encoding="utf-8")
        assert 'href="/compte">Changer mon mot de passe' in html and "data-deconnexion>Se déconnecter" in html, nom
    for chemin in ("/static/joueurs/connexion.html", "/static/joueurs/compte.html", f"/{comptes.DOSSIER}/x.json"):
        assert anonyme.get(chemin).status_code == 404, chemin


def test_la_suite_de_connexion_reste_au_coin():
    """« /connexion?suite=/%09/ailleurs » : le navigateur retire la tabulation et irait sur un autre site après la
    connexion. La suite passe par suite.js (servi au coin), que vérifie outils/verifier_suite_coin.mjs."""
    anonyme = appareil()
    assert "js/joueurs/suite.js" in joueurs.FICHIERS and anonyme.get("/static/js/joueurs/suite.js").status_code == 200
    statique = Path(joueurs.__file__).resolve().parent / "static" / "js" / "joueurs"
    compte = (statique / "compte.js").read_text(encoding="utf-8")
    assert 'from "./suite.js"' in compte and "suiteSure(" in compte
    # Plus de contrôle maison qui ne regarderait que le début de l'adresse.
    assert 'startsWith("/\\\\")' not in compte
    suite = (statique / "suite.js").read_text(encoding="utf-8")
    assert "new URL(" in suite and "\\u0000-\\u001f" in suite


def test_les_textes_du_coin_parlent_des_comptes():
    """Depuis les comptes, le lien du MJ n'est plus la clé d'entrée : aucune page servie au coin ne dit encore « Ce lien
    n'est plus valable » à un joueur simplement déconnecté. Et la pause se dit sans jargon."""
    statique = Path(joueurs.__file__).resolve().parent / "static"
    pages = [statique / "joueurs" / n for n in ("index.html", "carnet.html", "bible.html", "connexion.html", "compte.html",
                                                "fiche.html")]
    servis = [statique / f for f in joueurs.FICHIERS if f.endswith((".js", ".html"))]
    for f in pages + servis:
        texte = f.read_text(encoding="utf-8")
        # Ni les liens à clé, partis avec le lot A1b.
        for perime in ("Ce lien n'est plus valable", "n'est plus valable : demandez", "figé les écritures", "ouvrez le lien que votre MJ",
                       "demandez-lui un nouveau lien", "vous a envoyé un nouveau lien", "Nouveau lien"):
            assert perime not in texte, (f.name, perime)
    assert "figé" not in joueurs.demandes.MOT_PAUSE


def test_l_apercu_du_mj_et_le_rendu_pdf_marchent_encore(atelier, invites):
    j = invites("Émile")
    e = appareil()
    entrer(e, j, "emile")
    assert atelier.get(f"/api/joueurs/{j['id']}/apercu").status_code == 200
    jeton = "rendu-essai"
    joueurs.RENDUS[jeton] = (j["id"], time.monotonic() + 60)
    chromium = TestClient(joueurs.app, base_url="http://localhost:8000")
    r = chromium.get(f"/fiche?rendu={jeton}")
    session = r.headers["set-cookie"]
    assert r.status_code == 200 and session.startswith("aventurier=v2.") and "Max-Age=300" in session
    assert chromium.get("/api/moi").json()["joueur"] == "Émile"
    # Sans compte, pas de rendu.
    sans = invites("Fanny")
    joueurs.RENDUS[jeton] = (sans["id"], time.monotonic() + 60)
    assert TestClient(joueurs.app, base_url="http://localhost:8000").get(f"/fiche?rendu={jeton}").status_code == 403
