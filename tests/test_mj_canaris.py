"""Le parcours aux canaris du deuxième MJ : Alban et Léa, une MJ invitée, ont chacun une fiche canari dans
chaque collection à auteur. Ni l'un ni l'autre ne voit celle de l'autre par aucune route GET (chaque adresse que sait
remplir outils/comparer_reponses.py, pour chaque fiche des données), ni par la recherche, les mentions, les erreurs, les
renommages, la corbeille, les versions ou les identifiants. Les deux voient la même chose de la projection publique (le
monde, la TV). Léa ne voit aucun secret des héros ni du kit. En veille, rien ne change, mais chaque fuite est notée."""

import base64
import json
import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
RACINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RACINE / "app"))
sys.path.insert(0, str(RACINE / "outils"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from mj import cloisonnement  # noqa: E402
import comparer_reponses  # noqa: E402
import deux_mj  # noqa: E402
import main  # noqa: E402
from table import lectures_publiques  # noqa: E402
from api import application, carnet_api, config, contexte_du_modele, portier, tv_cartes, tv_ecran, tv_etat  # noqa: E402
from table import masque  # noqa: E402
from mj import porte_lan  # noqa: E402

CANARI = {"alban": "CANARI-ALBAN", "lea": "CANARI-LEA"}
PUBLIC = {"alban": "Publicalban", "lea": "Publiclea"}
SECRET_HEROS = "SECRET-HEROS"
SUIVIS = ("table.json", "renommages.json", "etats-heros.json")
LAN = "192.0.2.10:8323"


def plan(nom: str, notes: str) -> dict:
    n = 12
    return {"nom": nom, "notes": notes, "largeur": 4, "hauteur": 3, "sol": [1] * n, "piece": [1] * n, "brouillard": [1] * n,
            "pieces": [{"id": 1, "genre": "salle", "nom": f"{notes} salle", "notes": notes}], "portes": [], "objets": [],
            "pions": [], "textes": [{"id": "t1", "texte": notes, "x": 1, "y": 1, "mj": True}], "m_case": 1.5}


def carte(nom: str, notes: str, marqueurs=()) -> dict:
    return {"nom": nom, "notes": notes, "largeur": 4, "hauteur": 3, "km_case": 1, "terrain": base64.b64encode(bytes(12)).decode(),
            "brouillard": base64.b64encode(bytes(12)).decode(), "marqueurs": list(marqueurs), "traces": [],
            "etiquettes": [{"id": "e1", "texte": notes, "cache": True}]}


def semer(client, h: dict, qui: str) -> dict:
    """Les canaris d'un MJ : une fiche secrète dans chacune des treize collections à auteur, un PNJ et un lieu connus des
    joueurs (publics), une carte publique où ce lieu se voit. Rend {genre: identifiant}."""
    m, pub = CANARI[qui], PUBLIC[qui]
    ids = {}

    def creer(collection, fiche):
        r = client.post(f"/api/{collection}", json=fiche, headers=h)
        assert r.status_code == 200, (collection, r.status_code, r.text)
        return r.json()["id"]

    ids["pnj"] = creer("pnj", {"nom": f"{m} Zorglub{qui}", "connu": False, "secret": f"{m}-SECRET-PNJ", "notes": f"{m}-NOTES"})
    ids["pnj_connu"] = creer("pnj", {"nom": f"{pub} Bertrand", "connu": True, "apparence": f"{pub} grand", "secret": f"{m}-SECRET-CONNU"})
    ids["lieu"] = creer("lieux", {"nom": f"{m} Valombre{qui}", "connu": False, "resume": f"{m}-RESUME", "secrets": f"{m}-SECRET-LIEU"})
    ids["lieu_connu"] = creer("lieux", {"nom": f"{pub} Marché", "connu": True, "resume": f"{pub} place", "secrets": f"{m}-SECRET-MARCHE"})
    ids["scenario"] = creer("scenarios", {"nom": f"{m} scénario", "resume": f"{m}-RESUME-SCENARIO", "chapitres": [
        {"id": "c1", "titre": f"{m} chapitre", "texte": f"{m} rencontre [{m} Zorglub{qui}](#/pnj/{ids['pnj']}) à [{pub} Marché](#/lieu/{ids['lieu_connu']})."}]})
    ids["plan"] = creer("plans", plan(f"{m} plan", f"{m}-NOTES-PLAN"))
    ids["contrat"] = creer("contrats", {"nom": f"{m} contrat", "etat": "brouillon", "verite": f"{m}-VERITE"})
    ids["rumeur"] = creer("rumeurs", {"texte": f"{m} rumeur", "etat": "a-placer", "fond": f"{m}-FOND"})
    # Le document nomme le PNJ secret de l'autre MJ (son titre et son texte ne disent rien d'autre de secret).
    ids["document"] = creer("documents", {"nom": "Lettre scellée", "texte": f"Remise par Zorglub{'lea' if qui == 'alban' else 'alban'}.",
                                          "notes_mj": f"{m}-NOTES-DOC"})
    ids["seance"] = creer("seances", {"nom": f"{m} séance", "notes": f"{m}-NOTES-SEANCE", "objectif": f"{m}-OBJECTIF"})
    ids["fil"] = creer("fils", {"nom": f"{m} fil", "but": f"{m}-BUT"})
    ids["idee"] = creer("idees", {"texte": f"{m} idée à jeter"})
    ids["rencontre"] = creer("rencontres", {"nom": f"{m} rencontre", "notes": f"{m}-NOTES-RENCONTRE"})
    ids["boutique"] = creer("boutiques", {"nom": f"{m} boutique", "notes_mj": f"{m}-NOTES-BOUTIQUE"})
    ids["carte"] = creer("cartes", carte(f"{m} carte", f"{m}-NOTES-CARTE", [{"id": "a", "lieu": ids["lieu"], "x": 1, "y": 1}]))
    ids["carte_publique"] = creer("cartes", carte(f"{pub} carte", f"{m}-NOTES-CARTE-PUB",
                                                  [{"id": "a", "lieu": ids["lieu_connu"], "x": 1, "y": 1},
                                                   {"id": "b", "lieu": ids["lieu"], "x": 2, "y": 2}]))
    # Une version gardée (le premier enregistrement archive la fiche d'avant), une fiche à la corbeille.
    s = client.get(f"/api/seances/{ids['seance']}", headers=h).json()
    assert client.put(f"/api/seances/{ids['seance']}", json={**s, "notes": f"{m}-NOTES-SEANCE-2"}, headers=h).status_code == 200
    assert client.delete(f"/api/idees/{ids['idee']}", headers=h).status_code == 200
    # Un PNJ renommé : son identifiant suit son nom (pour Alban), il laisse une trace dans renommages.json.
    neuf = client.post("/api/pnj", json={"nom": f"Esquisse {qui} mj trois"}, headers=h).json()
    client.put(f"/api/pnj/{neuf['id']}", json={**neuf, "nom": f"{m} Ferdinand{qui}"}, headers=h)
    r = client.post(f"/api/pnj/{neuf['id']}/identifiant", json={}, headers=h).json()
    ids["ancien"], ids["renomme"] = neuf["id"], r["id"]
    # Une horloge cachée et un billet du journal de séance.
    client.post("/api/horloges", json={"nom": f"{m} horloge", "parts": 4}, headers=h)
    client.post(f"/api/seances/{ids['seance']}/journal", json={"texte": f"{m}-JOURNAL"}, headers=h)
    return ids


@pytest.fixture(scope="module")
def monde():
    avant = {f for f in config.DONNEES.rglob("*") if f.is_file()}
    suivis = {n: (config.DONNEES / n).read_bytes() if (config.DONNEES / n).exists() else None for n in SUIVIS}
    # Les erreurs du serveur en réponses (500) : une fiche abîmée laissée par un autre essai ne fait pas tomber le parcours.
    with TestClient(application.app, raise_server_exceptions=False) as client, pytest.MonkeyPatch.context() as mp:
        mp.setattr(cloisonnement, "MODE", cloisonnement.STRICT)
        alban, lea = deux_mj.ouvrir(mp)
        ids = {"alban": semer(client, alban, "alban"), "lea": semer(client, lea, "lea")}
        # Un héros d'Alban, avec ses secrets ; ce qu'un joueur confie au MJ ne s'écrit que par sa route : posé ici.
        heros = client.post("/api/aventuriers", headers=alban, json={
            "nom": "Naïma Ventebrise", "joueur": "Bix", "peuple": f"Demi-élémentaire {SECRET_HEROS}-PEUPLE", "peuple_cache": True,
            "secret": f"{SECRET_HEROS}-1", "notes_mj": f"{SECRET_HEROS}-2", "histoire": f"{SECRET_HEROS}-3", "jamais": f"{SECRET_HEROS}-4",
            "avant": f"{SECRET_HEROS}-5", "pourquoi": f"{SECRET_HEROS}-6", "particularites": f"{SECRET_HEROS}-7",
            "dons": [{"nom": f"{SECRET_HEROS}-DON", "cout": "1", "effet": "x"}], "element": "feu",
            "equipement": ["Une clé de la Petite Fanfrelée"], "or": 12, "tablee": True}).json()
        chemin = config.AVENTURIERS / f"{heros['id']}.json"
        chemin.write_text(json.dumps({**json.loads(chemin.read_text(encoding="utf-8")), "confie_au_mj": f"{SECRET_HEROS}-CONFIE"}),
                          encoding="utf-8")
        # La TV montre le plan d'Alban : sa projection est publique, rien d'autre de lui.
        client.put("/api/table", json={"vue": "plan", "plan": ids["alban"]["plan"]}, headers=alban)
        yield {"client": client, "alban": alban, "lea": lea, "ids": ids, "heros": heros["id"], "mp": mp}
        deux_mj.fermer()
    for n, contenu in suivis.items():
        if contenu is None:
            (config.DONNEES / n).unlink(missing_ok=True)
        else:
            (config.DONNEES / n).write_bytes(contenu)
    for f in sorted({f for f in config.DONNEES.rglob("*") if f.is_file()} - avant, reverse=True):
        f.unlink(missing_ok=True)


@pytest.fixture
def strict(monde):
    monde["mp"].setattr(cloisonnement, "MODE", cloisonnement.STRICT)
    cloisonnement.oublier()
    yield monde
    cloisonnement.oublier()


@pytest.fixture
def veille(monde):
    monde["mp"].setattr(cloisonnement, "MODE", cloisonnement.VEILLE)
    cloisonnement.oublier()
    yield monde
    monde["mp"].setattr(cloisonnement, "MODE", cloisonnement.STRICT)
    cloisonnement.oublier()


def adresses() -> list:
    """Chaque adresse GET de l'atelier, remplie pour chaque fiche des données (celles des deux MJ comprises)."""
    sortie = []
    for route, chemin in comparer_reponses.routes_a_plat(application.app.routes):
        if "GET" not in (getattr(route, "methods", None) or ()) or chemin in comparer_reponses.IGNOREES:
            continue
        liste = comparer_reponses.adresses(chemin, config.DONNEES, tv_cartes, {})
        for adresse in liste or []:
            sortie += comparer_reponses.avec_requetes(adresse, config.DONNEES, {})
    return sorted(set(sortie))


def interdits(monde, lecteur: str) -> list:
    """Ce que ce MJ ne doit jamais lire : le canari de l'autre, sous toutes ses formes (les identifiants d'Alban suivent
    ses noms, ceux de Léa sont opaques), et pour Léa les secrets des héros."""
    autre = "lea" if lecteur == "alban" else "alban"
    # (Pas « Zorglub… » seul : le document de chacun nomme, de sa main, le PNJ secret de l'autre.)
    mots = [CANARI[autre], CANARI[autre].lower(), f"Valombre{autre}", f"Ferdinand{autre}", f"esquisse-{autre}"]
    # Ses identifiants : opaques pour Léa, tirés des noms canaris pour Alban (« idee », « rumeur » : des mots trop courants,
    # le canari du texte suffit).
    mots += [i for k, i in monde["ids"][autre].items()
             if k not in ("pnj_connu", "lieu_connu", "carte_publique") and (i.startswith("i-") or "canari" in i)]
    if lecteur == "lea":
        mots.append(SECRET_HEROS)
    return mots


def fuites(texte: str, mots: list) -> list:
    return [m for m in mots if m in texte]


@pytest.mark.parametrize("lecteur", ["alban", "lea"])
def test_aucune_route_get_ne_montre_le_canari_de_l_autre(strict, lecteur):
    client, h = strict["client"], strict[lecteur]
    mots = interdits(strict, lecteur)
    vues, erreurs, pannes = 0, [], []
    for adresse in adresses():
        r = client.get(adresse, headers=h, follow_redirects=False)
        vues += 1
        if r.status_code >= 500:
            pannes.append(adresse)
        texte = r.text if "json" in r.headers.get("content-type", "") or r.headers.get("content-type", "").startswith("text/") else ""
        if (f := fuites(texte, mots)):
            erreurs.append((adresse, f))
        if lecteur == "lea" and texte and masque.contient_nom_cache(texte):
            erreurs.append((adresse, "nom caché de l'auberge"))
    assert vues > 200
    assert erreurs == []
    # Les fiches abîmées d'autres essais (un plan sans cases) font tomber la projection de la TV pour Alban, comme avant le
    # lot ; jamais rien d'autre.
    assert all(a.startswith("/api/table/") for a in pannes), pannes
    if lecteur == "lea":
        assert pannes == []
    # Son propre canari, lui, se lit.
    assert CANARI[lecteur] in client.get("/api/pnj", headers=h).text


@pytest.mark.parametrize("lecteur", ["alban", "lea"])
def test_ni_par_les_websockets(strict, lecteur):
    client, h = strict["client"], strict[lecteur]
    # Le canal des pages de l'atelier, ouvert aux deux MJ depuis le lot MJ-4 (adressé : test_mj_communs.py).
    for chemin in ("/ws/table", "/ws/atelier"):
        with client.websocket_connect(chemin, headers=h) as ws:
            texte = json.dumps(ws.receive_json(), ensure_ascii=False)
        assert fuites(texte, interdits(strict, lecteur)) == [], chemin
    # Le relais de la télécommande : le sien, sans les écrans ni les plans de l'autre.
    assert client.get("/api/telecommande", headers=h).status_code == 200
    assert client.post("/api/telecommande/releve", json={"ecran": "abcdef12"}, headers=h).json() == {"commandes": []}
    # Le pointeur ne dit rien d'un plan de l'autre (ni point à la TV, ni portée).
    autre = strict["ids"]["lea" if lecteur == "alban" else "alban"]["plan"]
    with client.websocket_connect("/ws/pointeur", headers=h) as ws:
        ws.send_text(json.dumps({"plan": autre, "x": 1, "y": 1}))
        ws.send_text(json.dumps({"plan": strict["ids"][lecteur]["plan"], "x": 1, "y": 1}))
        assert ws.receive_json() == {"type": "portee", "ici": lecteur == "alban", "ecrans": 0}


def test_ni_par_les_erreurs_ni_les_ecritures(strict):
    client, alban, lea = strict["client"], strict["alban"], strict["lea"]
    for lecteur, h, autre in (("alban", alban, "lea"), ("lea", lea, "alban")):
        ids = strict["ids"][autre]
        mots = interdits(strict, lecteur)
        essais = [
            ("GET", f"/api/pnj/{ids['pnj']}", None), ("PUT", f"/api/pnj/{ids['pnj']}", {"nom": "x"}),
            ("PATCH", f"/api/pnj/{ids['pnj']}", {"connu": True}), ("DELETE", f"/api/pnj/{ids['pnj']}", None),
            ("POST", f"/api/pnj/{ids['pnj']}/identifiant", {}), ("GET", f"/api/mentions/pnj/{ids['pnj']}", None),
            ("GET", f"/api/scenarios/{ids['scenario']}/consignes", None), ("PUT", f"/api/seances/{ids['seance']}/combat", {}),
            ("POST", f"/api/seances/{ids['seance']}/journal", {"texte": "x"}), ("GET", f"/api/versions/seances/{ids['seance']}", None),
            ("POST", f"/api/corbeille/idees/{ids['idee']}/annuler", None), ("GET", f"/api/plans/{ids['plan']}/deplacements", None),
            ("GET", f"/api/cartes/{ids['carte']}/publique", None), ("GET", f"/api/documents/{ids['document']}/imprime", None),
            ("POST", f"/api/seances/{ids['seance']}/journal/remettre", {"ligne": {"texte": "x"}}),
            ("PUT", "/api/table", {"vue": "plan", "plan": ids["plan"]}),
            ("POST", "/api/prives/billet", {"seance": ids["seance"], "billet": "b1"}),
        ]
        for methode, adresse, corps in essais:
            r = client.request(methode, adresse, json=corps, headers=h)
            assert r.status_code == 404, (lecteur, methode, adresse, r.status_code, r.text[:200])
            assert fuites(r.text, mots) == [], (lecteur, adresse)
        # Rien n'a bougé chez l'autre.
        assert json.loads((config.PNJ / f"{ids['pnj']}.json").read_text(encoding="utf-8"))["nom"].startswith(CANARI[autre])
    # La fiche jetée de l'autre ne se remet pas, même désignée par son fichier.
    for lecteur, h, autre in (("alban", alban, "lea"), ("lea", lea, "alban")):
        jetees = [f.stem for f in (config.DONNEES / "corbeille" / "idees").glob(f"{strict['ids'][autre]['idee']}-*.json")]
        assert jetees
        r = client.post(f"/api/corbeille/idees/{jetees[0]}/remettre", headers=h)
        assert r.status_code == 404 and fuites(r.text, interdits(strict, lecteur)) == []
        version = next((config.DONNEES / "historique" / "seances" / strict["ids"][autre]["seance"]).glob("*.json"))
        r = client.post(f"/api/versions/seances/{strict['ids'][autre]['seance']}/{version.stem}/remettre", headers=h)
        assert r.status_code == 404


def test_la_corbeille_les_versions_les_renommages(strict):
    client, alban, lea = strict["client"], strict["alban"], strict["lea"]
    for lecteur, h, autre in (("alban", alban, "lea"), ("lea", lea, "alban")):
        corbeille = client.get("/api/corbeille", headers=h).text
        assert CANARI[lecteur] in corbeille and fuites(corbeille, interdits(strict, lecteur)) == []
        assert client.get(f"/api/versions/seances/{strict['ids'][lecteur]['seance']}", headers=h).json()["versions"]
        renommages = client.get("/api/renommages", headers=h).json()
        assert strict["ids"][autre]["ancien"] not in renommages["pnj"]
        # L'ancien identifiant de la fiche renommée de l'autre ne mène à rien (ni réécriture, ni X-Identifiant).
        r = client.get(f"/api/pnj/{strict['ids'][autre]['ancien']}", headers=h)
        assert r.status_code == 404 and "x-identifiant" not in r.headers
    # Alban suit le sien ; celui de Léa n'a pas bougé (un identifiant opaque ne suit pas son nom).
    assert strict["ids"]["alban"]["renomme"].startswith("canari-alban-ferdinand")
    assert strict["ids"]["alban"]["ancien"] in client.get("/api/renommages", headers=alban).json()["pnj"]
    assert strict["ids"]["lea"]["renomme"] == strict["ids"]["lea"]["ancien"]


def test_les_identifiants_de_l_invite_sont_opaques(strict):
    client, _, lea = strict["client"], strict["alban"], strict["lea"]
    for genre, ident in strict["ids"]["lea"].items():
        assert ident.startswith("i-") and "lea" not in ident and "canari" not in ident, (genre, ident)
    # Un nom que porte déjà une fiche d'Alban ne laisse aucune trace dans l'identifiant (pas de suffixe révélateur).
    r = client.post("/api/pnj", json={"nom": f"{CANARI['alban']} Zorglubalban"}, headers=lea).json()
    assert r["id"].startswith("i-") and "zorglub" not in r["id"]
    client.delete(f"/api/pnj/{r['id']}", headers=lea)
    # Sa fiche jetée porte le canari d'Alban, de la main de Léa : hors de sa corbeille, pour les parcours qui suivent.
    for f in (config.DONNEES / "corbeille" / "pnj").glob(f"{r['id']}-*.json"):
        f.unlink()


def test_les_messages_anonymisent(strict):
    client, alban, lea = strict["client"], strict["alban"], strict["lea"]
    # Léa écrit le nom d'un PNJ inconnu d'Alban : averti, sans le nom ni la fiche.
    r = client.post("/api/masque", json={"texte": "Puis vint Zorglubalban, et Zorglublea."}, headers=lea).json()
    noms = [s["nom"] for s in r["secrets"]]
    assert cloisonnement.AUTRE_MJ in noms and any("Zorglublea" in n for n in noms)
    assert "Zorglubalban" not in json.dumps(r["secrets"]) and strict["ids"]["alban"]["pnj"] not in json.dumps(r)
    # Et la même chose dans l'autre sens.
    r = client.post("/api/masque", json={"texte": "Puis vint Zorglubalban, et Zorglublea."}, headers=alban).json()
    assert "Zorglublea" not in json.dumps(r["secrets"]) and any("Zorglubalban" in s["nom"] for s in r["secrets"])
    # Le document de chacun nomme le PNJ secret de l'autre : la vérification avant de le montrer l'anonymise.
    for lecteur, h, autre in (("alban", alban, "lea"), ("lea", lea, "alban")):
        inconnus = client.get(f"/api/documents/{strict['ids'][lecteur]['document']}/inconnus", headers=h).json()["secrets"]
        assert inconnus == [{"genre": "pnj", "nom": cloisonnement.AUTRE_MJ, "ids": [], "autre": True}], (lecteur, inconnus)


def test_les_deux_voient_la_meme_projection_publique(strict):
    client, alban, lea = strict["client"], strict["alban"], strict["lea"]
    monde_a, monde_l = client.get("/api/monde", headers=alban).json(), client.get("/api/monde", headers=lea).json()
    assert monde_a == monde_l
    texte = json.dumps(monde_a, ensure_ascii=False)
    for qui in ("alban", "lea"):
        assert f"{PUBLIC[qui]} Bertrand" in texte and f"{PUBLIC[qui]} Marché" in texte and f"{PUBLIC[qui]} carte" in texte
        assert CANARI[qui] not in texte and CANARI[qui].lower() not in texte
    # La carte publique : le lieu connu seulement, jamais le lieu secret, les notes, ni les étiquettes cachées.
    for c in monde_a["cartes"]:
        if c["nom"].startswith(PUBLIC["alban"]):
            vues = [client.get(f"/api/monde/cartes/{c['id']}", headers=h).json() for h in (alban, lea)]
            assert vues[0] == vues[1] and len(vues[0]["marqueurs"]) == 1 and CANARI["alban"] not in json.dumps(vues[0])
    # La TV : la même projection du plan que montre la TV, pour l'un et l'autre.
    j = tv_cartes.jeton("plans", strict["ids"]["alban"]["plan"])
    vus = [client.get(f"/api/table/plan/{j}", headers=h) for h in (alban, lea)]
    assert vus[0].status_code == vus[1].status_code == 200 and vus[0].json() == vus[1].json()
    assert CANARI["alban"] not in vus[1].text
    # La table elle-même : l'invité la lit sous des jetons.
    assert client.get("/api/table", headers=lea).json()["plan"] == j


def test_l_invite_ne_lit_que_la_projection_des_heros(strict):
    client, alban, lea = strict["client"], strict["alban"], strict["lea"]
    ident = strict["heros"]
    entier = client.get(f"/api/aventuriers/{ident}", headers=alban).json()
    assert entier["confie_au_mj"].startswith(SECRET_HEROS) and entier["histoire"].startswith(SECRET_HEROS)
    vu = client.get(f"/api/aventuriers/{ident}", headers=lea).json()
    texte = json.dumps(vu, ensure_ascii=False)
    assert SECRET_HEROS not in texte and "Fanfrelée" not in texte and not masque.contient_nom_cache(texte)
    assert vu["peuple"] == "" and "dons" not in vu and "element" not in vu and vu["or"] == 12
    # Le sac est commun : l'invité le tient, et n'en relit que la projection.
    r = client.patch(f"/api/aventuriers/{ident}/sac", json={"or": {"avant": 12, "apres": 10}}, headers=lea)
    assert r.status_code == 200 and SECRET_HEROS not in r.text and r.json()["or"] == 10
    # Les écritures de la fiche, ses illustrations, sa page entière : au principal seul.
    assert client.put(f"/api/aventuriers/{ident}", json=entier, headers=lea).status_code == 404
    assert client.get(f"/fiche-aventurier?id={ident}", headers=lea).status_code == 404
    assert client.get(f"/api/versions/aventuriers/{ident}", headers=lea).status_code == 404
    assert client.post("/api/illustrations", json={"cible": "aventurier", "fiche": ident, "prompt": "x"}, headers=lea).status_code == 404


def test_les_secrets_du_kit_restent_au_principal(strict):
    client, lea = strict["client"], strict["lea"]
    for chemin in ("/api/nom-auberge", "/static/js/pnj/kit.js", "/static/js/auberge/kit.js",
                   "/static/js/campagne/pnj.js", "/static/js/campagne/auberge.js",
                   "/static/js/aventuriers/kit.js", "/static/js/carte/editeur.js", "/static/js/carte/generateur.js",
                   "/static/js/carte/saison4.js", "/static/js/campagne/carte.js", "/static/js/campagne/pays.js", "/api/bible-joueurs",
                   "/static/js/campagne/pretires.js"):
        assert client.get(chemin, headers=lea).status_code == 404, chemin
    # La campagne : sa projection seulement, sans nom ni réputation, au masque.
    vue = client.get("/api/campagne", headers=lea)
    assert vue.status_code == 200 and set(vue.json()) == {"niveau", "tablee", "reputations", "modifie"}
    assert vue.json()["reputations"] == [] and not masque.contient_nom_cache(vue.text)


def test_en_veille_rien_ne_change_mais_tout_est_note(veille):
    client, alban, lea = veille["client"], veille["alban"], veille["lea"]
    # Comme avant le lot : Léa lit les fiches d'Alban…
    assert CANARI["alban"] in client.get("/api/pnj", headers=lea).text
    assert client.get(f"/api/pnj/{veille['ids']['alban']['pnj']}", headers=lea).status_code == 200
    assert client.get("/api/joueurs", headers=lea).status_code == 200
    assert "histoire" in client.get(f"/api/aventuriers/{veille['heros']}", headers=lea).json()
    # … et chaque fuite est notée, sans nom ni identifiant.
    vues = cloisonnement.vues()
    genres = {v[0] for v in vues}
    assert {"fiche-d-un-autre", "route-fermee", "fiche-commune-entiere"} <= genres
    assert ("fiche-d-un-autre", "GET /api/pnj", "pnj", "lea") in vues
    texte = json.dumps(vues, ensure_ascii=False)
    assert CANARI["alban"] not in texte and veille["ids"]["alban"]["pnj"] not in texte
    # Ce qu'Alban lit ne note que les fiches et les secrets de Léa : jamais une projection qui oublierait l'union, ni une
    # lecture sans lecteur (ce qui casserait le strict pour lui).
    cloisonnement.oublier()
    for adresse in ("/api/pnj", "/api/table", "/api/corbeille", "/api/recherche", "/api/monde", "/api/etats-heros",
                    f"/api/table/plan/{tv_cartes.jeton('plans', veille['ids']['alban']['plan'])}", "/api/table/planche"):
        assert client.get(adresse, headers=alban).status_code == 200, adresse
    assert {v[0] for v in cloisonnement.vues()} <= {"fiche-d-un-autre", "secret-d-un-autre", "horloge-d-un-autre"}


# ---------------------------------------------------------------- « Partager avec l'autre MJ »

PARTAGE = "PARTAGE-MIRABEL"


def semer_partage(client, h) -> dict:
    """Un PNJ et un lieu inconnus des joueurs, que leur auteur partage. Ni l'un ni l'autre ne porte le mot des canaris :
    retirés à la fin, ils ne troublent pas les autres parcours."""
    pnj = client.post("/api/pnj", headers=h, json={"nom": f"{PARTAGE} Octave", "connu": False, "partage": True, "role": "passeur",
                                                    "secret": f"{PARTAGE}-SECRET-PNJ", "notes": f"{PARTAGE}-NOTES"}).json()
    lieu = client.post("/api/lieux", headers=h, json={"nom": f"{PARTAGE} Combe", "connu": False, "partage": True,
                                                       "resume": f"{PARTAGE}-RESUME", "secrets": f"{PARTAGE}-SECRET-LIEU"}).json()
    assert pnj["partage"] is True and lieu["partage"] is True
    return {"pnj": pnj["id"], "lieux": lieu["id"]}


def retirer_partage(ids: dict) -> None:
    for collection, ident in ids.items():
        (config.DONNEES / collection / f"{ident}.json").unlink(missing_ok=True)
        for dossier in (config.DONNEES / "corbeille" / collection, config.DONNEES / "historique" / collection / ident):
            for f in dossier.glob(f"{ident}-*.json") if dossier.name == collection else dossier.glob("*.json"):
                f.unlink()


@pytest.mark.parametrize("auteur,autre", [("alban", "lea"), ("lea", "alban")])
def test_le_canari_partage_se_lit_mais_ne_s_ecrit_pas(strict, auteur, autre):
    client, h, ha = strict["client"], strict[auteur], strict[autre]
    ids = semer_partage(client, h)
    table = config.TABLE.read_bytes()
    try:
        for collection, ident in ids.items():
            chemin = config.DONNEES / collection / f"{ident}.json"
            avant = chemin.read_bytes()
            # L'autre MJ la trouve dans sa liste, la lit entière (secrets compris), la cherche.
            liste = client.get(f"/api/{collection}", headers=ha).json()
            vue = next(f for f in liste if f["id"] == ident)
            assert vue["auteur"] == auteur and vue["partage"] is True
            lue = client.get(f"/api/{collection}/{ident}", headers=ha)
            assert lue.status_code == 200 and f"{PARTAGE}-SECRET" in lue.text
            assert PARTAGE in json.dumps(client.get("/api/recherche", headers=ha).json()[collection], ensure_ascii=False)
            # Aucune écriture, par aucune route : la fiche, la case elle-même, la corbeille, les illustrations, l'identifiant,
            # la rédaction, les versions.
            genre = "lieu" if collection == "lieux" else "pnj"
            ecritures = [
                ("PUT", f"/api/{collection}/{ident}", {**lue.json(), "nom": "Pris"}),
                ("PATCH", f"/api/{collection}/{ident}", {"connu": True}),
                ("PATCH", f"/api/{collection}/{ident}", {"partage": False}),
                ("PATCH", f"/api/{collection}/{ident}", {"auteur": autre}),
                ("DELETE", f"/api/{collection}/{ident}", None),
                ("POST", f"/api/{collection}/{ident}/illustrations", {"url": "/media/x.png"}),
                ("DELETE", f"/api/{collection}/{ident}/illustrations?url=/media/x.png", None),
                ("PUT", f"/api/{collection}/{ident}/illustration", {"url": "/media/x.png"}),
                ("POST", f"/api/{collection}/{ident}/identifiant", {}),
                ("POST", "/api/illustrations", {"cible": genre, "fiche": ident, "prompt": "un portrait"}),
                ("GET", f"/api/versions/{collection}/{ident}", None),
                ("POST", f"/api/corbeille/{collection}/{ident}/annuler", None),
            ]
            if collection == "lieux":
                ecritures.append(("POST", f"/api/lieux/{ident}/redaction", {"champ": "resume"}))
            for methode, adresse, corps in ecritures:
                r = client.request(methode, adresse, json=corps, headers=ha)
                assert r.status_code in (400, 403, 404), (methode, adresse, r.status_code, r.text[:200])
                assert chemin.read_bytes() == avant, (methode, adresse)
            # Le refus d'une écriture se dit : le lecteur sait déjà que la fiche existe.
            r = client.patch(f"/api/{collection}/{ident}", json={"connu": True}, headers=ha)
            assert r.status_code == 403 and "partagée" in r.json()["detail"]
            assert client.get(f"/api/mentions/{collection}/{ident}", headers=ha).status_code == 200
        # Son nom n'est plus anonymisé chez l'autre MJ ; « partage » dit que le marquer connu revient à son auteur.
        r = client.post("/api/masque", json={"texte": f"Voici {PARTAGE} Octave à {PARTAGE} Combe."}, headers=ha).json()
        assert {(x["genre"], x["nom"], x.get("partage")) for x in r["secrets"]} == {
            ("pnj", f"{PARTAGE} Octave", True), ("lieu", f"{PARTAGE} Combe", True)}
        assert all("auteur" not in x for x in r["secrets"])
        # Chez son auteur, comme avant : ni « auteur » ni « partage ».
        r = client.post("/api/masque", json={"texte": f"Voici {PARTAGE} Octave."}, headers=h).json()
        assert r["secrets"] and all("partage" not in x and "auteur" not in x for x in r["secrets"])
        assert client.get(f"/api/pnj/{ids['pnj']}/carton", headers=ha).status_code == 200
        # Montrer à la table : l'autre MJ l'envoie, et la relit en clair ; un identifiant non partagé reste refusé.
        assert client.put("/api/table", json={"vue": "accueil", "pnj": ids["pnj"], "lieu": ids["lieux"], "reprendre": True}, headers=ha).status_code == 200
        vue = client.get("/api/table", headers=ha).json()
        assert vue["pnj"] == ids["pnj"] and vue["lieu"] == ids["lieux"] and "pnj" not in vue.get("jetons", [])
        assert client.put("/api/table", json={"vue": "accueil", "pnj": strict["ids"][auteur]["pnj"]}, headers=ha).status_code == 404
        # Rien de secret ne sort : la TV ne lit pas un PNJ encore inconnu des joueurs, même montré ; ni l'état public, ni le
        # carnet du coin, ni le monde n'en disent le nom ou les secrets.
        j = tv_cartes.jeton("pnj", ids["pnj"])
        assert client.get(f"/api/table/pnj/{j}", headers=ha).status_code == 404
        assert client.get(f"/api/table/pnj/{j}", headers={"Host": LAN}).status_code in (401, 404)
        with cloisonnement.en_fond():
            dehors = json.dumps([tv_etat.etat_public(tv_ecran.etat_table()), carnet_api.elements_du_carnet(),
                                 contexte_du_modele.etat_campagne_public()], ensure_ascii=False, default=str)
        assert PARTAGE not in dehors and ids["pnj"] not in dehors
        assert PARTAGE not in client.get("/api/monde", headers=ha).text
        # Rendu connu par son auteur : la TV et le coin en lisent la projection, jamais les secrets.
        assert client.patch(f"/api/pnj/{ids['pnj']}", json={"connu": True}, headers=h).json()["partage"] is True
        vu = client.get(f"/api/table/pnj/{j}", headers={"Host": LAN})
        assert vu.status_code == 200 and "SECRET" not in vu.text and "NOTES" not in vu.text and ids["pnj"] not in vu.text
        with cloisonnement.en_fond():
            carnet = json.dumps(carnet_api.elements_du_carnet(), ensure_ascii=False, default=str)
        assert f"{PARTAGE} Octave" in carnet and "SECRET" not in carnet and f"{PARTAGE}-NOTES" not in carnet and '"partage"' not in carnet
        # La case décochée par son auteur : la fiche n'existe plus pour l'autre, et le champ a quitté le fichier.
        for collection, ident in ids.items():
            assert "partage" not in client.patch(f"/api/{collection}/{ident}", json={"partage": False}, headers=h).json()
            assert client.get(f"/api/{collection}/{ident}", headers=ha).status_code == 404
            assert ident not in client.get(f"/api/{collection}", headers=ha).text
            assert client.patch(f"/api/{collection}/{ident}", json={"connu": True}, headers=ha).status_code == 404
        # Ce que la TV montre encore : il ne le lit plus que sous son jeton, comme toute fiche de l'autre MJ.
        vue = client.get("/api/table", headers=ha).json()
        assert vue["lieu"] == tv_cartes.jeton("lieux", ids["lieux"]) and vue["pnj"] == tv_cartes.jeton("pnj", ids["pnj"])
        assert client.put("/api/table", json={"vue": "accueil", "lieu": ids["lieux"]}, headers=ha).status_code == 404
        assert client.put("/api/table", json={"vue": "accueil", "lieu": vue["lieu"], "pnj": vue["pnj"]}, headers=ha).status_code == 200
    finally:
        config.TABLE.write_bytes(table)
        retirer_partage(ids)


def test_le_partage_ne_vaut_que_pour_les_pnj_et_les_lieux(strict):
    client, alban, lea = strict["client"], strict["alban"], strict["lea"]
    crees = []
    try:
        for collection, fiche in (("scenarios", {"nom": "Scénario à partager"}), ("seances", {"nom": "Séance à partager"}),
                                  ("fils", {"nom": "Fil à partager"}), ("idees", {"texte": "Idée à partager"}),
                                  ("plans", plan("Plan à partager", "notes")), ("boutiques", {"nom": "Boutique à partager"}),
                                  ("documents", {"nom": "Document à partager", "texte": "x"}), ("rencontres", {"nom": "Rencontre à partager"}),
                                  ("contrats", {"nom": "Contrat à partager"}), ("rumeurs", {"texte": "Rumeur à partager"}),
                                  ("cartes", carte("Carte à partager", "notes"))):
            r = client.post(f"/api/{collection}", json={**fiche, "partage": True}, headers=alban).json()
            crees.append((collection, r["id"]))
            # Le champ n'y est pas gardé, et même écrit à la main dans le fichier il n'ouvre rien.
            chemin = config.DONNEES / collection / f"{r['id']}.json"
            assert "partage" not in json.loads(chemin.read_text(encoding="utf-8"))
            chemin.write_text(json.dumps({**json.loads(chemin.read_text(encoding="utf-8")), "partage": True}), encoding="utf-8")
            assert client.get(f"/api/{collection}/{r['id']}", headers=lea).status_code == 404, collection
            assert r["id"] not in client.get(f"/api/{collection}", headers=lea).text, collection
        # « partage » n'est vrai que s'il est le booléen vrai.
        for valeur in ("oui", 1, "true", ["x"], {"a": 1}):
            p = client.post("/api/pnj", json={"nom": "Presque partagé", "partage": valeur}, headers=alban).json()
            crees.append(("pnj", p["id"]))
            assert "partage" not in p and client.get(f"/api/pnj/{p['id']}", headers=lea).status_code == 404
    finally:
        for collection, ident in crees:
            (config.DONNEES / collection / f"{ident}.json").unlink(missing_ok=True)


def test_en_veille_le_partage_ne_note_rien_a_la_lecture(veille):
    client, alban, lea = veille["client"], veille["alban"], veille["lea"]
    ids = semer_partage(client, alban)
    try:
        cloisonnement.oublier()
        assert client.get(f"/api/pnj/{ids['pnj']}", headers=lea).status_code == 200
        assert client.get(f"/api/pnj/{ids['pnj']}/carton", headers=lea).status_code == 200
        assert not [v for v in cloisonnement.vues() if v[1] in ("GET /api/pnj/{ident}", "GET /api/pnj/{ident}/carton")]
        # Une écriture de l'autre MJ reste une violation : notée en veille (rien n'y est refusé), refusée en strict.
        assert client.patch(f"/api/pnj/{ids['pnj']}", json={"notes": "x"}, headers=lea).status_code == 200
        assert ("fiche-d-un-autre", "PATCH /api/pnj/{ident}", "pnj", "lea") in cloisonnement.vues()
    finally:
        retirer_partage(ids)


# ---------------------------------------------------------------- le réseau local, porte éveillée

@pytest.fixture
def lan(strict):
    """Un invité existe : la porte du réseau local est éveillée pour de bon (porte_lan.py), sans interrupteur de test.
    Alban et Léa entrent chacun par un appareil reconnu, comme après « Reconnaître cet appareil »."""
    assert portier.PORTE_LAN.eveillee()
    entetes = {}
    for qui in ("alban", "lea"):
        _, valeur = portier.PORTE_LAN.reconnaitre(qui, f"Appareil de {qui}")
        entetes[qui] = {"Host": LAN, "Origin": f"http://{LAN}", "Cookie": f"{porte_lan.COOKIE}={valeur}"}
    yield {**strict, "lan": entetes}


def lue(r) -> dict:
    """Une réponse comme la compare l'instantané (comparer_reponses.reponse), sans les champs datés."""
    return comparer_reponses.sans_cles(comparer_reponses.reponse(r), comparer_reponses.VOLATILES)


@pytest.mark.parametrize("lecteur", ["alban", "lea"])
def test_par_un_appareil_reconnu_chacun_lit_exactement_ce_qu_il_lit_en_ligne(lan, lecteur):
    client, par_le_lan, en_ligne = lan["client"], lan["lan"][lecteur], lan[lecteur]
    mots = interdits(lan, lecteur)
    ecarts, erreurs, vues = [], [], 0
    for adresse in adresses():
        # « Vos appareils » dit d'où vient la requête (« lan », « cet_appareil ») : c'est sa raison d'être.
        if adresse == "/api/mj/appareils":
            continue
        r = client.get(adresse, headers=par_le_lan, follow_redirects=False)
        vues += 1
        if lue(r) != lue(client.get(adresse, headers=en_ligne, follow_redirects=False)):
            ecarts.append(adresse)
        texte = r.text if "json" in r.headers.get("content-type", "") or r.headers.get("content-type", "").startswith("text/") else ""
        if (f := fuites(texte, mots)):
            erreurs.append((adresse, f))
    assert vues > 200
    assert ecarts == [] and erreurs == []
    assert client.get("/api/moi", headers=par_le_lan).json()["compte"] == lecteur
    vue = client.get("/api/mj/appareils", headers=par_le_lan).json()
    # Ses appareils seulement (un par passage de la fixture), jamais ceux de l'autre.
    assert vue["porte"] == "eveillee" and vue["lan"] and {a["nom"] for a in vue["appareils"]} == {f"Appareil de {lecteur}"}


def test_par_le_lan_ni_les_erreurs_ni_les_ecritures_ni_les_websockets(lan):
    client = lan["client"]
    for lecteur, autre in (("alban", "lea"), ("lea", "alban")):
        h, ids, mots = lan["lan"][lecteur], lan["ids"][autre], interdits(lan, lecteur)
        for methode, adresse, corps in (
                ("GET", f"/api/pnj/{ids['pnj']}", None), ("PUT", f"/api/pnj/{ids['pnj']}", {"nom": "x"}),
                ("DELETE", f"/api/scenarios/{ids['scenario']}", None), ("GET", f"/api/mentions/pnj/{ids['pnj']}", None),
                ("GET", f"/api/versions/seances/{ids['seance']}", None), ("POST", f"/api/corbeille/idees/{ids['idee']}/annuler", None),
                ("PUT", "/api/table", {"vue": "plan", "plan": ids["plan"]}), ("GET", f"/api/plans/{ids['plan']}/deplacements", None)):
            r = client.request(methode, adresse, json=corps, headers=h)
            assert r.status_code == 404, (lecteur, methode, adresse, r.status_code)
            assert fuites(r.text, mots) == [] and "x-identifiant" not in r.headers, (lecteur, adresse)
        # L'ancien identifiant de la fiche renommée de l'autre ne mène à rien, par le LAN non plus.
        r = client.get(f"/api/pnj/{ids['ancien']}", headers=h)
        assert r.status_code == 404 and "x-identifiant" not in r.headers
        # Ce que chacun écrit par son appareil est à lui : Léa reçoit un identifiant opaque.
        r = client.post("/api/pnj", json={"nom": f"Passage par le salon {lecteur}"}, headers=h)
        assert r.status_code == 200 and r.json()["auteur"] == lecteur
        assert r.json()["id"].startswith("i-") == (lecteur == "lea")
        assert client.delete(f"/api/pnj/{r.json()['id']}", headers=h).status_code == 200
        with client.websocket_connect("/ws/table", headers=h) as ws:
            assert fuites(json.dumps(ws.receive_json(), ensure_ascii=False), mots) == []
        with client.websocket_connect("/ws/pointeur", headers=h) as ws:
            ws.send_text(json.dumps({"plan": ids["plan"], "x": 1, "y": 1}))
            ws.send_text(json.dumps({"plan": lan["ids"][lecteur]["plan"], "x": 1, "y": 1}))
            assert ws.receive_json() == {"type": "portee", "ici": lecteur == "alban", "ecrans": 0}
    # Le canal des pages et le relais de la télécommande, chacun le sien par son appareil ; la fiche entière d'un
    # héros et son PDF : au principal.
    lea = lan["lan"]["lea"]
    for qui in ("alban", "lea"):
        with client.websocket_connect("/ws/atelier", headers=lan["lan"][qui]) as ws:
            assert fuites(json.dumps(ws.receive_json(), ensure_ascii=False), interdits(lan, qui)) == []
    for adresse in (f"/fiche-aventurier?id={lan['heros']}", f"/fiche-aventurier.pdf?id={lan['heros']}",
                    "/api/joueurs", "/api/mj/comptes", "/static/js/pnj/kit.js"):
        assert client.get(adresse, headers=lea, follow_redirects=False).status_code == 404, adresse
    assert client.post("/api/telecommande/releve", json={"ecran": "abcdef12"}, headers=lea).json() == {"commandes": []}


def test_par_le_lan_un_appareil_inconnu_ne_lit_que_la_tv(lan):
    """Ni Alban ni Léa, ni un téléphone du salon : sans appareil reconnu, la connexion, la TV et ce qu'elle montre (le plan
    d'Alban), rien d'autre ; aucun canari, d'un MJ ni de l'autre."""
    client = lan["client"]
    inconnu = {"Host": LAN}
    mots = [*interdits(lan, "alban"), *interdits(lan, "lea")]
    ouvertes = []
    for adresse in adresses():
        r = client.get(adresse, headers=inconnu, follow_redirects=False)
        assert fuites(r.text, mots) == [], adresse
        if r.status_code in (401, 303):
            continue
        ouvertes.append(adresse)
        assert re.match(r"^/(table|connexion|deconnexion|api/table/)", adresse), (adresse, r.status_code)
        if adresse.startswith("/api/table/") and r.status_code == 200:
            assert lectures_publiques.montre(adresse.split("?")[0], tv_ecran.etat_table(), tv_cartes.jeton), adresse
    assert f"/api/table/plan/{tv_cartes.jeton('plans', lan['ids']['alban']['plan'])}" in ouvertes
    assert client.get(f"/api/table/plan/{tv_cartes.jeton('plans', lan['ids']['lea']['plan'])}", headers=inconnu).status_code == 404
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/pointeur", headers=inconnu) as ws:
            ws.receive_json()
    # Le cookie d'appareil de Léa, tout seul, n'ouvre rien en ligne ; sa session, rien sur le LAN.
    en_ligne = {k: v for k, v in lan["lea"].items() if k != "Cookie"}
    assert client.get("/api/pnj", headers={**en_ligne, "Cookie": lan["lan"]["lea"]["Cookie"]}).status_code == 401
    assert client.get("/api/pnj", headers={"Host": LAN, "Cookie": lan["lea"]["Cookie"]}).status_code == 401


def test_par_le_lan_les_outils_du_serveur_sont_alban(lan):
    client = lan["client"]
    outil = {"Host": "127.0.0.1:8000", porte_lan.ENTETE_OUTIL: portier.PORTE_LAN.secret(porte_lan.JETON_OUTILS)}
    texte = client.get("/api/pnj", headers=outil).text
    assert CANARI["alban"] in texte and fuites(texte, interdits(lan, "alban")) == []
    assert client.get("/api/moi", headers=outil).json()["compte"] == "alban"
    assert client.get("/api/pnj", headers={**outil, porte_lan.ENTETE_OUTIL: "faux"}).status_code == 401
