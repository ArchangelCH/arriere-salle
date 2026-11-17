"""Une fiche renommée pendant qu'un autre écran l'a ouverte (liens_fiches.py) : le serveur garde la trace du renommage
et la suit, à la lecture comme à l'enregistrement. L'écran resté sur l'ancien identifiant enregistre la bonne fiche (avec
la fusion habituelle), sa page rechargée la retrouve, un lien écrit depuis une liste pas encore relue y mène et compte
dans « Dans les scénarios ». Aucune autre fiche ne reprend l'ancien identifiant."""

import json
import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, config  # noqa: E402

JS = Path(__file__).resolve().parent.parent / "app" / "static" / "js"
CF = {"CF-Connecting-IP": "203.0.113.7"}


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def renommer(client, collection, ident, nom):
    """Comme l'écran qui renomme : le nom part, puis l'identifiant suit."""
    lue = client.get(f"/api/{collection}/{ident}").json()
    assert client.put(f"/api/{collection}/{ident}", json={**lue, "nom": nom, "version_base": lue["modifie"]}).status_code == 200
    r = client.post(f"/api/{collection}/{ident}/identifiant", json={}).json()
    assert r["change"], r
    return r["id"]


def enregistrer_comme_la_page(client, url, local, base):
    """enregistrerAvecVersion (api.js) : la version d'abord ; en conflit, relire, fusionner champ par champ, renvoyer."""
    r = client.put(url, json={**local, "version_base": local["modifie"]})
    if r.status_code != 409:
        return r
    actuel = client.get(url).json()
    fusion = {k: (local[k] if json.dumps(local.get(k)) != json.dumps(base.get(k)) else actuel.get(k))
              for k in {*actuel, *local}}
    return client.put(url, json={**fusion, "version_base": actuel["modifie"]})


def test_l_ecran_reste_sur_l_ancien_identifiant_enregistre_la_bonne_fiche(client):
    p = client.post("/api/pnj", json={"nom": "Nouveau PNJ suivi", "rang": "civil", "connu": False}).json()
    ancien = p["id"]
    # Le second écran ouvre la fiche, puis le premier la nomme : l'identifiant suit le nom.
    base = client.get(f"/api/pnj/{ancien}").json()
    neuf = renommer(client, "pnj", ancien, "Gaspard Suivi")
    assert neuf == "gaspard-suivi" and not (config.PNJ / f"{ancien}.json").exists()
    # Le second écran écrit ce que le PNJ cache, sous l'ancien identifiant : rien ne se perd.
    local = {**base, "secret": "Il doit trois cents pièces aux Régisseurs."}
    r = enregistrer_comme_la_page(client, f"/api/pnj/{ancien}", local, base)
    assert r.status_code == 200 and r.json()["id"] == neuf and r.headers["x-identifiant"] == neuf
    disque = json.loads((config.PNJ / f"{neuf}.json").read_text())
    assert disque["secret"] == "Il doit trois cents pièces aux Régisseurs." and disque["nom"] == "Gaspard Suivi"
    assert not (config.PNJ / f"{ancien}.json").exists()
    # Rechargée sur l'ancienne adresse, la page retrouve la fiche ; ses autres routes suivent aussi.
    assert client.get(f"/api/pnj/{ancien}").json()["id"] == neuf
    assert client.patch(f"/api/pnj/{ancien}", json={"connu": True}).json()["connu"] is True
    assert client.get(f"/api/pnj/{ancien}/carton").status_code == 200
    assert client.get(f"/api/versions/pnj/{ancien}").json()["id"] == neuf
    assert client.get(f"/api/mentions/pnj/{ancien}").status_code == 200
    assert client.get("/api/renommages").json()["pnj"][ancien] == neuf
    client.delete(f"/api/pnj/{neuf}")


def test_jetee_depuis_l_ancien_identifiant_annuler_la_ramene(client):
    """L'écran resté sur l'ancien identifiant jette la fiche (le serveur suit le renommage), puis « Annuler » avec ce même
    identifiant : la fiche revient, sous son identifiant actuel."""
    p = client.post("/api/pnj", json={"nom": "Nouveau PNJ jete", "rang": "civil", "connu": False}).json()
    ancien = p["id"]
    neuf = renommer(client, "pnj", ancien, "Hilaire Jete")
    assert client.delete(f"/api/pnj/{ancien}").status_code == 200 and not (config.PNJ / f"{neuf}.json").exists()
    r = client.post(f"/api/corbeille/pnj/{ancien}/annuler")
    assert r.status_code == 200 and r.json()["id"] == neuf and (config.PNJ / f"{neuf}.json").exists()
    assert not (config.PNJ / f"{ancien}.json").exists()
    client.delete(f"/api/pnj/{neuf}")


def test_un_lien_vers_l_ancien_identifiant_compte_et_le_retient(client):
    p = client.post("/api/pnj", json={"nom": "Nouveau PNJ cité", "rang": "civil"}).json()
    ancien = p["id"]
    neuf = renommer(client, "pnj", ancien, "Mahaut Citée")
    # Une liste pas encore relue sur un autre écran : le scénario lie l'ancien identifiant.
    s = client.post("/api/scenarios", json={"nom": "Le lien d'avant", "chapitres": [
        {"id": "c-1", "titre": "Au gué", "texte": f"Ils croisent [Mahaut](#/pnj/{ancien}) au gué."}]}).json()
    passages = client.get(f"/api/mentions/pnj/{neuf}").json()["passages"]
    assert [x["scenario"] for x in passages] == [s["id"]]
    # Renommée encore : la chaîne mène toujours à elle, et le passage compte encore.
    plus_neuf = renommer(client, "pnj", neuf, "Mahaut la Citée")
    assert plus_neuf == "mahaut-la-citee" and client.get(f"/api/pnj/{ancien}").json()["id"] == plus_neuf
    assert [x["scenario"] for x in client.get(f"/api/mentions/pnj/{plus_neuf}").json()["passages"]] == [s["id"]]
    client.delete(f"/api/scenarios/{s['id']}")
    client.delete(f"/api/pnj/{plus_neuf}")


def test_une_chaine_de_renommages_et_le_retour_a_un_ancien_nom(client):
    p = client.post("/api/pnj", json={"nom": "Nouveau PNJ chaîne", "rang": "civil"}).json()
    a = p["id"]
    b = renommer(client, "pnj", a, "Bertrand Chaîne")
    c = renommer(client, "pnj", b, "Bertrand des Chaînes")
    assert (b, c) == ("bertrand-chaine", "bertrand-des-chaines")
    assert client.get(f"/api/pnj/{a}").json()["id"] == c and client.get(f"/api/pnj/{b}").json()["id"] == c
    # Revenir à son nom d'avant : la fiche reprend son propre ancien identifiant, sans suffixe.
    assert renommer(client, "pnj", c, "Bertrand Chaîne") == b
    assert client.get(f"/api/pnj/{c}").json()["id"] == b and client.get(f"/api/pnj/{a}").json()["id"] == b
    assert b not in client.get("/api/renommages").json()["pnj"]
    # Jetée : ses anciens identifiants ne mènent plus nulle part.
    client.delete(f"/api/pnj/{b}")
    assert client.get(f"/api/pnj/{a}").status_code == 404 and client.get(f"/api/pnj/{c}").status_code == 404
    assert c not in client.get("/api/renommages").json()["pnj"]


def test_aucune_autre_fiche_ne_reprend_un_ancien_identifiant(client):
    p = client.post("/api/pnj", json={"nom": "Odon Pris", "rang": "civil"}).json()
    assert p["id"] == "odon-pris"
    renommer(client, "pnj", "odon-pris", "Odon le Pris")
    # Ni une création, ni un autre renommage ne prennent « odon-pris » : un écran resté dessus suit Odon le Pris.
    autre = client.post("/api/pnj", json={"nom": "Odon Pris", "rang": "civil"}).json()
    assert re.fullmatch(r"odon-pris-[0-9a-f]{4}", autre["id"])
    troisieme = client.post("/api/pnj", json={"nom": "Nouveau PNJ pris", "rang": "civil"}).json()
    r = renommer(client, "pnj", troisieme["id"], "Odon Pris")
    assert re.fullmatch(r"odon-pris-[0-9a-f]{4}", r)
    assert client.get("/api/pnj/odon-pris").json()["nom"] == "Odon le Pris"
    for ident in ("odon-le-pris", autre["id"], r):
        client.delete(f"/api/pnj/{ident}")


def test_un_lieu_renomme_sur_sa_carte_et_l_editeur_reste_ouvert(client):
    carte = client.post("/api/cartes", json={"nom": "Carte du suivi", "largeur": 20, "hauteur": 20, "terrain": "AA"}).json()
    lieu = client.post("/api/lieux", json={"nom": "Village sans nom suivi", "type": "village", "carte": carte["id"]}).json()
    lue = client.get(f"/api/cartes/{carte['id']}").json()
    version = client.put(f"/api/cartes/{carte['id']}", json={**lue, "marqueurs": [{"id": "m1", "lieu": lieu["id"], "x": 3, "y": 4}],
                                                             "version_base": lue["modifie"]}).json()["modifie"]
    base = client.get(f"/api/lieux/{lieu['id']}").json()
    lu = client.get(f"/api/lieux/{lieu['id']}").json()
    client.put(f"/api/lieux/{lieu['id']}", json={**lu, "nom": "Le Gué suivi", "version_base": lu["modifie"]})
    r = client.post(f"/api/lieux/{lieu['id']}/identifiant", json={"carte": carte["id"], "version_carte": version}).json()
    assert r["change"] and r["id"] == "le-gue-suivi"
    # L'autre éditeur, resté sur l'ancien identifiant, écrit les secrets du lieu.
    local = {**base, "secrets": "Le passeur ment."}
    srv = enregistrer_comme_la_page(client, f"/api/lieux/{lieu['id']}", local, base)
    assert srv.status_code == 200 and srv.json()["id"] == "le-gue-suivi" and srv.json()["nom"] == "Le Gué suivi"
    assert json.loads((config.LIEUX / "le-gue-suivi.json").read_text())["secrets"] == "Le passeur ment."
    assert client.get(f"/api/mentions/lieux/{lieu['id']}").status_code == 200
    client.delete(f"/api/cartes/{carte['id']}")
    client.delete("/api/lieux/le-gue-suivi")


def test_la_trace_reste_a_l_atelier(client):
    p = client.post("/api/pnj", json={"nom": "Nouveau PNJ public", "rang": "civil"}).json()
    neuf = renommer(client, "pnj", p["id"], "Ysolde Publique")
    assert client.get("/api/renommages", headers=CF).status_code == 404
    assert client.get(f"/api/pnj/{p['id']}", headers=CF).status_code == 404
    # Pas même par l'en-tête : le nouvel identifiant dit le nom de la fiche (un PNJ encore inconnu des joueurs).
    for chemin in (f"/api/pnj/{p['id']}", f"/api/mentions/pnj/{p['id']}", f"/api/versions/pnj/{p['id']}"):
        r = client.get(chemin, headers=CF)
        assert r.status_code == 404 and "x-identifiant" not in r.headers and neuf not in r.text, chemin
    assert client.get(f"/api/pnj/{neuf}", headers=CF).status_code == 404
    # La trace n'est pas une citation : la fiche suit encore son nom.
    assert renommer(client, "pnj", neuf, "Ysolde la Publique") == "ysolde-la-publique"
    client.delete("/api/pnj/ysolde-la-publique")


def test_les_ecrans_adoptent_le_nouvel_identifiant():
    """Le carnet des PNJ, la fiche d'un lieu et l'éditeur de carte prennent le nouvel identifiant que rend le serveur
    après un enregistrement, et une adresse ancienne se résout par le serveur."""
    carnet = (JS / "pnj" / "carnet.js").read_text(encoding="utf-8")
    ecrire = carnet[carnet.index("  async ecrire() {"):carnet.index("  async creer(donnees) {")]
    assert ecrire.index("enregistrerAvecVersion(") < ecrire.index("this.adopterIdentifiant(p, id, this.bases[id].id, this.bases[id])")
    assert "|| (await this.retrouver(this.idDemande))" in carnet and "async retrouver(id) {" in carnet
    lieu = (JS / "lieux" / "fiche-lieu.js").read_text(encoding="utf-8")
    assert "this.adopter(id, this.bases[id].id, this.bases[id])" in lieu and "if (lieu.id && lieu.id !== this.id)" in lieu
    editeur = (JS / "carte" / "editeur.js").read_text(encoding="utf-8")
    assert "if (srv.id && srv.id !== id) adopterSurLaCarte(this, lieu, id, srv.id, srv);" in editeur
    fiches = (JS / "scenarios" / "fiches.js").read_text(encoding="utf-8")
    assert "listes.renommages?.[collection]" in fiches
    assert '"/api/renommages"' in (JS / "scenarios" / "scenarios.js").read_text(encoding="utf-8")
