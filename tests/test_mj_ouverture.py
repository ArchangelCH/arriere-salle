"""L'ouverture du compte invité, sans l'ouvrir : INVITATIONS_OUVERTES reste faux en service.

- La garde : un invité n'entre qu'avec le cloisonnement en strict. En veille, même les invitations ouvertes, il ne peut ni
  naître, ni se connecter, ni garder une session, ni passer la porte du réseau local ; Alban, lui, entre toujours.
- Au réveil de la porte du LAN, les appareils d'Alban sont à relire : la liste paraît en tête de l'atelier avec un avis,
  rien n'est oublié tout seul, « C'est relu » le retire.
- Les « Précédemment » de l'invité se numérotent à part (« Quête annexe N », ou le nom qu'il donne à sa suite) : au
  carnet des joueurs, dans les « croisés », sur le carton d'épisode de la TV et dans le contexte de rédaction. Sans
  invité, rien ne change. Canaris dans les deux sens : un nom de suite qui dirait un secret (de l'un ou de l'autre) laisse
  la suite par défaut.
"""
import json
import os
import secrets
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from mj import adresses  # noqa: E402
from mj import cloisonnement  # noqa: E402
from mj import comptes_mj  # noqa: E402
import deux_mj  # noqa: E402
import main  # noqa: E402
from api import application, carnet_api, config, contexte_du_modele, portier, statiques_versionnes, tv_cartes  # noqa: E402
from mj import porte_lan  # noqa: E402
from mj import proprietes  # noqa: E402

SUIVIS = ("table.json", "renommages.json")
UA_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
MDP_LEA = "cire-et-chandelle-12"  # celui de tests/deux_mj.py


@pytest.fixture(scope="module")
def appli():
    avant = {f for f in config.DONNEES.rglob("*") if f.is_file()}
    suivis = {n: (config.DONNEES / n).read_bytes() if (config.DONNEES / n).exists() else None for n in SUIVIS}
    with TestClient(application.app, raise_server_exceptions=False) as client:
        yield client
    for n, contenu in suivis.items():
        if contenu is None:
            (config.DONNEES / n).unlink(missing_ok=True)
        else:
            (config.DONNEES / n).write_bytes(contenu)
    for f in sorted({f for f in config.DONNEES.rglob("*") if f.is_file()} - avant, reverse=True):
        f.unlink(missing_ok=True)


@pytest.fixture
def client(appli, monkeypatch):
    monkeypatch.setattr(porte_lan, "FORCAGE", "")
    monkeypatch.setattr(portier, "ATTENTE_ECHEC", 0)
    deux_mj.fermer()
    portier.ECHECS_CONNEXION.clear()
    appli.cookies.clear()
    yield appli
    appli.cookies.clear()
    deux_mj.fermer()
    portier.ECHECS_CONNEXION.clear()


@pytest.fixture(params=[cloisonnement.VEILLE, cloisonnement.STRICT])
def mode(request, monkeypatch):
    monkeypatch.setattr(cloisonnement, "MODE", request.param)
    cloisonnement.oublier()
    yield request.param
    cloisonnement.oublier()


def outil() -> dict:
    """Alban sur le LAN, porte éveillée, comme un script du serveur."""
    return {"X-Atelier-Outil": portier.PORTE_LAN.secret(porte_lan.JETON_OUTILS)}


def appareil(valeur: str) -> dict:
    return {"Cookie": f"{porte_lan.COOKIE}={valeur}", "User-Agent": UA_MAC}


def connexion(client, identifiant: str, mdp: str):
    entetes = {"Host": deux_mj.HOTE, "CF-Connecting-IP": deux_mj.IP, "Origin": f"https://{deux_mj.HOTE}"}
    return client.post("/connexion", data={"identifiant": identifiant, "mot_de_passe": mdp, "suite": "/"}, headers=entetes,
                       follow_redirects=False)


# ---------------------------------------------------------------- la garde : un invité seulement en strict

def test_le_drapeau_reste_baisse_sans_la_variable():
    # Les essais tournent sans ATELIER_INVITATIONS : fermées, comme en service tant que le compose ne la porte pas.
    if not os.environ.get("ATELIER_INVITATIONS"):
        assert comptes_mj.INVITATIONS_OUVERTES is False
    assert comptes_mj.ESSAI_INVITE_EN_VEILLE is False
    assert not comptes_mj.invites_permis() or cloisonnement.strict()


def test_un_invite_n_entre_qu_en_strict(client, mode, monkeypatch):
    strict = mode == cloisonnement.STRICT
    # Léa, née et ouverte avec le strict (un retour en veille après MJ-7 la laisserait dans le fichier), un appareil reconnu
    # sur le LAN. Le mode du test ensuite.
    monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.STRICT)
    alban, lea = deux_mj.ouvrir(monkeypatch, garde_stricte=True)
    _, valeur_lea = portier.PORTE_LAN.reconnaitre(deux_mj.INVITE, "Tablette de Léa")
    _, valeur_alban = portier.PORTE_LAN.reconnaitre(proprietes.PRINCIPAL, "Mac d'Alban")
    monkeypatch.setattr(cloisonnement, "MODE", mode)
    assert comptes_mj.invites_permis() is strict
    attendu = 200 if strict else 401
    # Sa session de l'atelier en ligne.
    assert client.get("/api/moi", headers=lea).status_code == attendu
    assert client.get("/api/pnj", headers=lea).status_code == attendu
    # Sa connexion.
    r = connexion(client, "lea", MDP_LEA)
    assert r.status_code == (303 if strict else 401)
    client.cookies.clear()
    # Son appareil sur le LAN (la porte s'est éveillée avec son compte).
    assert portier.PORTE_LAN.eveillee()
    assert client.get("/api/moi", headers=appareil(valeur_lea)).status_code == attendu
    assert client.get("/", headers=appareil(valeur_lea), follow_redirects=False).status_code == (200 if strict else 303)
    if not strict:
        # Ni appareil de plus, ni place parmi les destinataires des joueurs.
        with pytest.raises(comptes_mj.comptes.Refus):
            portier.PORTE_LAN.reconnaitre(deux_mj.INVITE, "Téléphone de Léa")
        assert [c["id"] for c in adresses.ouverts(config.DONNEES)] == [proprietes.PRINCIPAL]
    # Alban entre toujours, en ligne comme sur le LAN.
    assert client.get("/api/moi", headers=alban).json()["role"] == "principal"
    assert client.get("/api/moi", headers=appareil(valeur_alban)).json()["role"] == "principal"
    # « Les MJ » le dit ; ni lien ni nouveau lien en veille.
    liste = client.get("/api/mj/comptes", headers=outil()).json()
    assert liste["invitations"] is True and liste["strict"] is strict
    r = client.post("/api/mj/comptes", json={"nom": "Lucas", "cle": secrets.token_urlsafe(24)}, headers=outil())
    assert r.status_code == (200 if strict else 403)
    if not strict:
        assert r.json()["detail"] == comptes_mj.EN_VEILLE
        assert [c["id"] for c in client.get("/api/mj/comptes", headers=outil()).json()["comptes"]] == ["alban", "lea"]
    cle = secrets.token_urlsafe(24)
    r = client.post(f"/api/mj/comptes/{deux_mj.INVITE}/lien", json={"cle": cle}, headers=outil())
    assert r.status_code == (200 if strict else 403)
    # Une invitation déjà envoyée ne s'ouvre pas non plus en veille.
    if strict:
        monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.VEILLE)
    r = client.post("/connexion/invitation/etat", json={"cle": cle}, headers={"Origin": "http://testserver"})
    assert r.status_code in (403, 410) and r.status_code != 200
    # Fermer reste possible en veille : c'est le geste de repli.
    assert client.post(f"/api/mj/comptes/{deux_mj.INVITE}/fermer", json={}, headers=outil()).status_code == 200


def test_sans_les_invitations_le_bloc_ne_dit_rien_de_plus(client):
    # Le drapeau baissé (en service) : la réponse d'avant le lot, sans « strict ».
    liste = client.get("/api/mj/comptes").json()
    assert set(liste) == {"invitations", "adresse", "comptes"} and liste["invitations"] is False


# ---------------------------------------------------------------- au réveil de la porte : relire ses appareils

def test_au_reveil_les_appareils_sont_a_relire(client, monkeypatch):
    page_seule = statiques_versionnes.page_html("index.html").body  # la page, ses liens sous l'empreinte
    r = client.post("/api/mj/appareils", json={"nom": "Mac d'Alban"}, headers={"User-Agent": UA_MAC})
    assert r.status_code == 200
    mac = r.headers["set-cookie"].split(";")[0].split("=", 1)[1]
    client.cookies.clear()
    r = client.post("/api/mj/appareils", json={"nom": "iPad du salon"}, headers={"User-Agent": UA_MAC})
    client.cookies.clear()
    # Porte endormie : ni avis, ni marque sur la page.
    vue = client.get("/api/mj/appareils", headers=appareil(mac)).json()
    assert "a_relire" not in vue and vue["porte"] == "dormante"
    assert client.get("/").content == page_seule
    # Le premier invité : la porte s'éveille à la requête suivante, l'avis est posé pour Alban seul.
    monkeypatch.setattr(comptes_mj, "INVITATIONS_OUVERTES", True)
    monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.STRICT)
    comptes_mj.creer_invite(config.DONNEES, "Lucas", secrets.token_urlsafe(24))
    vue = client.get("/api/mj/appareils", headers=appareil(mac)).json()
    assert vue["porte"] == "eveillee" and isinstance(vue.get("a_relire"), str)
    # Rien n'est oublié tout seul.
    assert sorted(a["nom"] for a in vue["appareils"]) == ["Mac d'Alban", "iPad du salon"]
    page = client.get("/", headers=appareil(mac)).text
    assert 'data-appareils="a-relire"' in page and "data-role" not in page
    # Un appareil non reconnu n'apprend rien : renvoyé à la connexion.
    assert client.get("/", follow_redirects=False).status_code == 303
    # « C'est relu » : plus d'avis, la page redevient celle d'avant, le geste est noté.
    vue = client.post("/api/mj/appareils/relus", json={}, headers=appareil(mac)).json()
    assert "a_relire" not in vue and len(vue["appareils"]) == 2
    assert client.get("/", headers=appareil(mac)).content == page_seule
    journal = (comptes_mj.dossier(config.DONNEES) / comptes_mj.JOURNAL).read_text(encoding="utf-8")
    assert '"geste": "appareils-relus"' in journal
    # La porte reste éveillée : l'avis ne revient pas.
    assert portier.PORTE_LAN.eveillee() and portier.PORTE_LAN.a_relire(proprietes.PRINCIPAL) is None
    # Rouverte à la main (la marque effacée, plus d'invité) : plus rien à relire non plus.
    etat = comptes_mj.lire(config.DONNEES)
    comptes_mj.principal(etat)[porte_lan.A_RELIRE] = "2026-11-10T12:00:00"
    etat["comptes"] = [c for c in etat["comptes"] if c["role"] == "principal"]
    comptes_mj.ecrire(config.DONNEES, etat)
    (comptes_mj.dossier(config.DONNEES) / porte_lan.MARQUE).unlink()
    assert portier.PORTE_LAN.a_relire(proprietes.PRINCIPAL) is None
    assert "a_relire" not in client.get("/api/mj/appareils").json()


# ---------------------------------------------------------------- les « Précédemment » de l'invité, numérotés à part

@pytest.fixture
def deux(client, monkeypatch):
    monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.STRICT)
    cloisonnement.oublier()
    alban, lea = deux_mj.ouvrir(monkeypatch)
    crees = []

    def creer(collection, fiche, h):
        r = client.post(f"/api/{collection}", json=fiche, headers=h)
        assert r.status_code == 200, (collection, r.text)
        crees.append((collection, r.json()["id"]))
        return r.json()["id"]

    ids = {
        # Un secret de chacun (inconnu des joueurs), un PNJ connu de chacun.
        "baron": creer("pnj", {"nom": "Baron Canarialban", "connu": False}, alban),
        "sorciere": creer("pnj", {"nom": "Sorcière Canarilea", "connu": False}, lea),
        "bertrand": creer("pnj", {"nom": "Bertrand le Passeur", "connu": True}, alban),
        "mila": creer("pnj", {"nom": "Mila la Brodeuse", "connu": True}, lea),
    }
    ids["s_alban"] = creer("seances", {"nom": "La grange", "numero": 1, "date": "2026-11-07", "close": True,
                                        "precedemment": "Les héros ont passé le gué avec Bertrand."}, alban)
    ids["s_lea"] = creer("seances", {"nom": "Les fils d'or", "numero": 1, "date": "2026-11-12", "close": True,
                                     "precedemment": "Mila a brodé une carte pour les héros."}, lea)
    # Bertrand, croisé dans les deux suites (écrit dans la fiche : Léa ne lit pas les PNJ d'Alban par son atelier).
    for cle, pnj in (("s_alban", ["bertrand"]), ("s_lea", ["bertrand", "mila"])):
        f = config.SEANCES / f"{ids[cle]}.json"
        fiche = json.loads(f.read_text(encoding="utf-8"))
        f.write_text(json.dumps({**fiche, "pnj": [ids[p] for p in pnj]}, ensure_ascii=False), encoding="utf-8")
    yield client, alban, lea, ids
    for collection, ident in crees:
        (config.DONNEES / collection / f"{ident}.json").unlink(missing_ok=True)


def episode(client, h: dict, ident: str) -> dict:
    """Le carton d'épisode de cette séance, montré à la TV par son MJ, tel que la TV le lit."""
    r = client.put("/api/table", json={"vue": "episode", "seance": ident, "reprendre": True}, headers=h)
    assert r.status_code == 200, r.text
    r = client.get(f"/api/table/episode/{tv_cartes.jeton('seances', ident)}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def chroniques() -> dict:
    sections = carnet_api.elements_du_carnet()[0]
    return {c["titre"]: c for c in sections["precedemment"]}, {p["nom"]: p for p in sections["personnages"]}


def test_les_seances_de_l_invite_sont_numerotees_a_part(deux):
    client, alban, lea, ids = deux
    precedemment, personnages = chroniques()
    assert "suite" not in precedemment["La grange"] and precedemment["La grange"]["numero"] == 1
    assert precedemment["Les fils d'or"]["suite"] == "Quête annexe" and precedemment["Les fils d'or"]["numero"] == 1
    # Deux suites qui partent de 1 : la date fait l'ordre.
    ordre = [c["titre"] for c in carnet_api.elements_du_carnet()[0]["precedemment"]]
    assert ordre.index("Les fils d'or") < ordre.index("La grange")
    # Les croisés disent les deux suites ; l'ordre au coin reste celui des séances d'Alban.
    assert personnages["Bertrand le Passeur"]["rencontre"] == "Séance 1, Quête annexe 1"
    assert personnages["Bertrand le Passeur"]["seances"] == [1]
    assert personnages["Mila la Brodeuse"]["rencontre"] == "Quête annexe 1" and personnages["Mila la Brodeuse"]["seances"] == []
    # Le carton d'épisode de la TV.
    ep = episode(client, lea, ids["s_lea"])
    assert ep["suite"] == "Quête annexe" and ep["numero"] == 1
    assert "suite" not in episode(client, alban, ids["s_alban"])
    # Le contexte de rédaction : ce que savent les joueurs, puis les séances de l'invité sous sa suite.
    contexte = contexte_du_modele.etat_campagne_public()
    assert "- Séance 1 (2026-11-07)" in contexte and "- Quête annexe 1 (2026-11-12)" in contexte
    jeton = cloisonnement.poser_lecteur(deux_mj.INVITE)
    try:
        assert "- Quête annexe 1 (2026-11-12, close)" in contexte_du_modele.etat_campagne()
    finally:
        cloisonnement.retirer_lecteur(jeton)
    # Ce que voit chacun de la suite.
    assert client.get("/api/moi", headers=lea).json()["suite"] == "Quête annexe"
    assert "suite" not in client.get("/api/moi", headers=alban).json()
    # « Les MJ » ne montre pas le nom tel qu'elle l'a tapé (il pourrait nommer un de ses secrets).
    assert all("suite" not in c for c in client.get("/api/mj/comptes", headers=alban).json()["comptes"])


def test_l_invite_nomme_sa_suite(deux):
    client, alban, lea, ids = deux
    r = client.put("/api/mj/suite", json={"suite": "  Les contes   de Léa "}, headers=lea)
    assert r.status_code == 200 and r.json()["suite"] == "Les contes de Léa"
    precedemment, personnages = chroniques()
    assert precedemment["Les fils d'or"]["suite"] == "Les contes de Léa"
    assert personnages["Bertrand le Passeur"]["rencontre"] == "Séance 1, Les contes de Léa 1"
    assert episode(client, lea, ids["s_lea"])["suite"] == "Les contes de Léa"
    # Vide : la suite par défaut ; trop long : refusé ; le principal n'en a pas.
    assert client.put("/api/mj/suite", json={"suite": ""}, headers=lea).json()["suite"] == "Quête annexe"
    assert client.put("/api/mj/suite", json={"suite": "x" * 41}, headers=lea).status_code == 400
    assert client.put("/api/mj/suite", json={"suite": "Mes séances"}, headers=alban).status_code == 400
    assert "suite" not in comptes_mj.principal(comptes_mj.lire(config.DONNEES))


@pytest.mark.parametrize("secret", ["Baron Canarialban", "Sorcière Canarilea", "la Petite Fanfrelée"])
def test_un_nom_de_suite_qui_dit_un_secret_reste_au_defaut(deux, secret):
    # Le secret d'Alban (Léa ne le connaît pas, mais le tape), le sien (Alban et les joueurs ne le savent pas), le nom
    # caché de l'auberge : ni le carnet, ni la TV, ni le contexte de ce que savent les joueurs ne le montrent.
    client, alban, lea, ids = deux
    assert client.put("/api/mj/suite", json={"suite": f"Les suites de {secret}"}, headers=lea).status_code == 200
    precedemment, personnages = chroniques()
    assert precedemment["Les fils d'or"]["suite"] == "Quête annexe"
    assert personnages["Bertrand le Passeur"]["rencontre"] == "Séance 1, Quête annexe 1"
    carnet = json.dumps(carnet_api.elements_du_carnet()[0], ensure_ascii=False)
    ep = episode(client, lea, ids["s_lea"])
    assert ep["suite"] == "Quête annexe"
    contexte = contexte_du_modele.etat_campagne_public()
    for texte in (carnet, json.dumps(ep, ensure_ascii=False), contexte):
        assert "Canarialban" not in texte and "Canarilea" not in texte and "Fanfrelée" not in texte
    # Ce que lit Alban du carnet et de « Les MJ » ne nomme pas le secret de Léa non plus.
    for adresse in ("/api/carnet-joueurs", "/api/mj/comptes", "/api/moi"):
        assert "Canarilea" not in client.get(adresse, headers=alban).text, adresse


def test_sans_invite_rien_ne_change(client):
    # Pas de compte invité, des séances d'Alban seulement : ni « suite » au carnet, ni à la TV, ni dans /api/moi.
    r = client.post("/api/seances", json={"nom": "Seule", "numero": 4, "close": True, "precedemment": "Un récit."})
    s = r.json()
    try:
        precedemment = {c["titre"]: c for c in carnet_api.elements_du_carnet()[0]["precedemment"]}
        assert "suite" not in precedemment["Seule"]
        assert "suite" not in episode(client, {}, s["id"])
        assert client.get("/api/moi").json() == {"compte": "alban", "nom": "Alban", "role": "principal"}
        assert "- Séance 4 (" in contexte_du_modele.etat_campagne_public()
    finally:
        (config.SEANCES / f"{s['id']}.json").unlink(missing_ok=True)
