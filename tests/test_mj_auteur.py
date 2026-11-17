"""Le champ « auteur » des collections à auteur (proprietes.py, lot MJ-0) : posé par le serveur à chaque création, jamais
changé ensuite (PATCH, PUT, versions, corbeille), jamais envoyé à la TV ni au coin des joueurs."""

import base64
import json
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from mj import cloisonnement  # noqa: E402
from contenu import corbeille  # noqa: E402
import main  # noqa: E402
from api import application, carnet_api, config, ia_api, tv_cartes  # noqa: E402
from mj import proprietes  # noqa: E402

FICHES = {
    "lieux": {"nom": "Lieu de l'auteur", "connu": True},
    "pnj": {"nom": "PNJ de l'auteur", "connu": True},
    "contrats": {"nom": "Contrat de l'auteur", "etat": "affiche"},
    "rumeurs": {"texte": "Rumeur de l'auteur"},
    "fils": {"nom": "Fil de l'auteur"},
    "seances": {"nom": "Séance de l'auteur"},
    "rencontres": {"nom": "Rencontre de l'auteur"},
    "plans": {"nom": "Plan de l'auteur", "largeur": 4, "hauteur": 3},
    "idees": {"texte": "Idée de l'auteur"},
    "boutiques": {"nom": "Boutique de l'auteur"},
    "documents": {"nom": "Document de l'auteur", "texte": "Lettre"},
    "scenarios": {"nom": "Scénario de l'auteur"},
}


def carte(nom="Carte de l'auteur"):
    return {"nom": nom, "largeur": 4, "hauteur": 3, "km_case": 1, "terrain": base64.b64encode(bytes(12)).decode(),
            "brouillard": base64.b64encode(bytes(12)).decode(), "marqueurs": [], "traces": [], "etiquettes": []}


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def test_les_treize_collections():
    assert set(proprietes.COLLECTIONS) == {"pnj", "lieux", "cartes", "plans", "scenarios", "seances", "idees", "fils",
                                          "rencontres", "contrats", "rumeurs", "boutiques", "documents"}
    assert set(proprietes.POLITIQUES.values()) <= {proprietes.CLOISONNEE, proprietes.MONDE}
    assert not set(proprietes.PARTAGEES) & set(proprietes.COLLECTIONS)
    # La tablée reste commune : un héros n'a pas d'auteur.
    assert not proprietes.a_auteur("aventuriers") and not proprietes.a_auteur("regles-maison")


def test_un_champ_absent_vaut_le_principal():
    assert proprietes.auteur_de({}) == proprietes.auteur_de({"auteur": ""}) == proprietes.auteur_de(None) == "alban"
    assert proprietes.auteur_de({"auteur": 3}) == "alban"
    assert proprietes.auteur_de({"auteur": "lucas"}) == "lucas"
    # Hors requête, le compte qui écrit est le principal.
    assert proprietes.compte_courant() == "alban"


@pytest.mark.parametrize("collection", sorted(FICHES))
def test_chaque_creation_pose_l_auteur_et_rien_ne_le_change(client, collection):
    # La page ne choisit pas l'auteur : le serveur pose le compte de la requête (sur le LAN, le principal).
    f = client.post(f"/api/{collection}", json={**FICHES[collection], "auteur": "quelqu-un-d-autre"}).json()
    assert f["auteur"] == "alban"
    sur_disque = json.loads((config.DONNEES / collection / f"{f['id']}.json").read_text(encoding="utf-8"))
    assert sur_disque["auteur"] == "alban"
    # Un PATCH l'ignore.
    p = client.patch(f"/api/{collection}/{f['id']}", json={"auteur": "lucas", "notes": "retouche"}).json()
    assert p["auteur"] == "alban" and p["notes"] == "retouche"
    # Un PUT le reprend du disque.
    actuelle = client.get(f"/api/{collection}/{f['id']}").json()
    r = client.put(f"/api/{collection}/{f['id']}", json={**actuelle, "version_base": actuelle["modifie"], "auteur": "lucas"})
    assert r.status_code == 200 and r.json()["auteur"] == "alban"
    actuelle = client.get(f"/api/{collection}/{f['id']}").json()
    sans = {k: v for k, v in actuelle.items() if k != "auteur"}
    assert client.put(f"/api/{collection}/{f['id']}", json={**sans, "version_base": actuelle["modifie"]}).json()["auteur"] == "alban"
    client.delete(f"/api/{collection}/{f['id']}")


def test_les_cartes_aussi(client):
    c = client.post("/api/cartes", json={**carte(), "auteur": "lucas"}).json()
    lue = client.get(f"/api/cartes/{c['id']}").json()
    assert lue["auteur"] == "alban"
    r = client.put(f"/api/cartes/{c['id']}", json={**lue, "version_base": lue["modifie"], "auteur": "lucas"})
    assert r.status_code == 200 and client.get(f"/api/cartes/{c['id']}").json()["auteur"] == "alban"
    client.delete(f"/api/cartes/{c['id']}")


def test_une_fiche_d_avant_le_champ_reste_sans_lui(client):
    """Une fiche que la migration n'a pas encore touchée : un PUT ou un PATCH ne lui ajoutent rien (au principal)."""
    ident = "fiche-sans-auteur"
    (config.PNJ / f"{ident}.json").write_text(json.dumps({"id": ident, "nom": "Sans auteur", "modifie": "2026-01-01T00:00:00.000"}),
                                            encoding="utf-8")
    lue = client.get(f"/api/pnj/{ident}").json()
    assert "auteur" not in lue
    r = client.put(f"/api/pnj/{ident}", json={**lue, "version_base": lue["modifie"], "auteur": "lucas"})
    assert "auteur" not in r.json() and "auteur" not in client.patch(f"/api/pnj/{ident}", json={"auteur": "lucas"}).json()
    assert "auteur" not in json.loads((config.PNJ / f"{ident}.json").read_text(encoding="utf-8"))
    client.delete(f"/api/pnj/{ident}")


def test_un_heros_n_a_pas_d_auteur(client):
    a = client.post("/api/aventuriers", json={"nom": "Héros sans auteur"}).json()
    assert "auteur" not in a
    client.delete(f"/api/aventuriers/{a['id']}")


def test_les_creations_du_serveur(client):
    """creer_fiche (les PNJ et rencontres que crée une consigne de scénario)."""
    texte = ia_api.creer_pnj_depuis({"pnj": {"nom": "Gaspard Auteur", "genre": "h"}}, "scenario-x")
    ident = texte.split("](#/pnj/")[1].split(")")[0]
    assert json.loads((config.PNJ / f"{ident}.json").read_text(encoding="utf-8"))["auteur"] == "alban"
    texte = ia_api.creer_rencontre_depuis({"rencontre": {"nom": "Rencontre Auteur", "adversaires": []}})
    ident_r = texte.split("](#/combats/")[1].split(")")[0]
    assert json.loads((config.RENCONTRES / f"{ident_r}.json").read_text(encoding="utf-8"))["auteur"] == "alban"
    client.delete(f"/api/pnj/{ident}")
    client.delete(f"/api/rencontres/{ident_r}")


def jeter_et_occuper(client, collection: str, ident: str) -> dict:
    """Met une fiche à la corbeille et pose une autre fiche à sa place : elle ne peut revenir qu'à côté."""
    client.delete(f"/api/{collection}/{ident}")
    jetee = next(e for e in client.get("/api/corbeille").json()["elements"] if e["id"] == ident and e["collection"] == collection)
    (config.DONNEES / collection / f"{ident}.json").write_text(json.dumps({"id": ident, "nom": "Occupant"}), encoding="utf-8")
    return jetee


def test_la_corbeille_et_les_versions_gardent_l_auteur(client, monkeypatch):
    # Les fiches « d'un autre MJ » d'ici sont remises depuis le LAN (le principal) : en veille, le cloisonnement les laisse
    # passer, le test ne regarde que l'auteur (le cloisonnement de la corbeille : test_mj_canaris.py).
    monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.VEILLE)
    # Une fiche d'un autre MJ : remise à côté, sous un nouvel identifiant, elle reste la sienne.
    f = client.post("/api/pnj", json={"nom": "PNJ jeté"}).json()
    chemin = config.PNJ / f"{f['id']}.json"
    chemin.write_text(json.dumps({**json.loads(chemin.read_text(encoding="utf-8")), "auteur": "lucas"}), encoding="utf-8")
    jetee = jeter_et_occuper(client, "pnj", f["id"])
    r = client.post(f"/api/corbeille/pnj/{jetee['fichier']}/remettre", json={"a_cote": True}).json()
    assert r["a_cote"] and r["id"] != f["id"]
    assert json.loads((config.PNJ / f"{r['id']}.json").read_text(encoding="utf-8"))["auteur"] == "lucas"
    # Une fiche d'avant le champ, remise à côté : elle devient explicitement celle du principal.
    g = client.post("/api/pnj", json={"nom": "PNJ ancien"}).json()
    cg = config.PNJ / f"{g['id']}.json"
    cg.write_text(json.dumps({k: v for k, v in json.loads(cg.read_text(encoding="utf-8")).items() if k != "auteur"}), encoding="utf-8")
    jetee_g = jeter_et_occuper(client, "pnj", g["id"])
    rg = client.post(f"/api/corbeille/pnj/{jetee_g['fichier']}/remettre", json={"a_cote": True}).json()
    assert json.loads((config.PNJ / f"{rg['id']}.json").read_text(encoding="utf-8"))["auteur"] == "alban"
    # Remise à sa place, telle qu'elle a été jetée : son auteur avec elle.
    k = client.post("/api/pnj", json={"nom": "PNJ remis"}).json()
    ck = config.PNJ / f"{k['id']}.json"
    ck.write_text(json.dumps({**json.loads(ck.read_text(encoding="utf-8")), "auteur": "lucas"}), encoding="utf-8")
    client.delete(f"/api/pnj/{k['id']}")
    assert client.post(f"/api/corbeille/pnj/{k['id']}/annuler").status_code == 200
    assert json.loads(ck.read_text(encoding="utf-8"))["auteur"] == "lucas"
    # Revenir à une version ne change pas l'auteur (GARDES de corbeille.py).
    assert "auteur" in corbeille.GARDES
    h = client.post("/api/lieux", json={"nom": "Lieu versionné"}).json()
    version = config.HISTORIQUE / "lieux" / h["id"] / "20260101-120000.json"
    version.parent.mkdir(parents=True, exist_ok=True)
    version.write_text(json.dumps({**h, "nom": "Ancien nom", "auteur": "lucas"}), encoding="utf-8")
    remise = client.post(f"/api/versions/lieux/{h['id']}/20260101-120000/remettre").json()["fiche"]
    assert remise["nom"] == "Ancien nom" and remise["auteur"] == "alban"
    for collection, ident in (("pnj", f["id"]), ("pnj", r["id"]), ("pnj", g["id"]), ("pnj", rg["id"]), ("pnj", k["id"]),
                              ("lieux", h["id"])):
        client.delete(f"/api/{collection}/{ident}")


def test_l_auteur_ne_sort_ni_vers_la_tv_ni_vers_le_coin(client):
    """Fuite : aucune projection publique ne porte le champ « auteur » (ni le compte d'un autre MJ)."""
    canari = "mj-canari-auteur"
    lieu = client.post("/api/lieux", json={"nom": "Lieu canari", "connu": True, "resume": "Visible"}).json()
    pnj = client.post("/api/pnj", json={"nom": "PNJ canari", "connu": True}).json()
    contrat = client.post("/api/contrats", json={"nom": "Contrat canari", "etat": "affiche", "affiche": "Avis"}).json()
    rumeur = client.post("/api/rumeurs", json={"texte": "Rumeur canari"}).json()
    plan = client.post("/api/plans", json={"nom": "Plan canari", "largeur": 2, "hauteur": 2, "sol": [2] * 4, "piece": [1] * 4,
                                           "brouillard": [0] * 4, "portes": [], "pions": []}).json()
    boutique = client.post("/api/boutiques", json={"nom": "Boutique canari", "articles": []}).json()
    document = client.post("/api/documents", json={"nom": "Document canari", "texte": "Lettre"}).json()
    c = client.post("/api/cartes", json={**carte("Carte canari"), "marqueurs": [{"id": "m", "lieu": lieu["id"], "x": 1, "y": 1}]}).json()
    for collection, f in (("lieux", lieu), ("pnj", pnj), ("contrats", contrat), ("rumeurs", rumeur), ("plans", plan),
                          ("boutiques", boutique), ("documents", document), ("cartes", c)):
        chemin = config.DONNEES / collection / f"{f['id']}.json"
        chemin.write_text(json.dumps({**json.loads(chemin.read_text(encoding="utf-8")), "auteur": canari}), encoding="utf-8")
    J = tv_cartes.jeton
    publiques = [f"/api/table/lieu/{J('lieux', lieu['id'])}", f"/api/table/pnj/{J('pnj', pnj['id'])}", "/api/table/planche",
                 f"/api/table/rumeur/{J('rumeurs', rumeur['id'])}", f"/api/table/plan/{J('plans', plan['id'])}",
                 f"/api/table/boutique/{J('boutiques', boutique['id'])}", f"/api/table/document/{J('documents', document['id'])}",
                 f"/api/table/carte/{J('cartes', c['id'])}", "/api/table/heros", "/api/table/fiches"]
    for adresse in publiques:
        r = client.get(adresse)
        assert canari not in r.text and '"auteur"' not in r.text, adresse
    with client.websocket_connect("/ws/table") as ws:
        assert canari not in json.dumps(ws.receive_json())
    carnet_api.publier_carnet()
    for f in config.PROPOSITIONS.rglob("*"):
        if f.is_file() and f.suffix in (".json", ".txt"):
            assert canari not in f.read_text(encoding="utf-8", errors="ignore"), f
    for collection, f in (("lieux", lieu), ("pnj", pnj), ("contrats", contrat), ("rumeurs", rumeur), ("plans", plan),
                          ("boutiques", boutique), ("documents", document), ("cartes", c)):
        client.delete(f"/api/{collection}/{f['id']}")


# ---------------------------------------------------------------- « Partager avec l'autre MJ » : le champ « partage »

def test_le_champ_partage(client):
    """« partage » ne se garde que vrai, sur un PNJ ou un lieu ; il ne part ni vers la TV ni vers le coin des joueurs."""
    assert proprietes.PARTAGEABLES == ("pnj", "lieux")
    crees = []
    try:
        for collection in ("pnj", "lieux"):
            f = client.post(f"/api/{collection}", json={**FICHES[collection], "nom": f"Partagé {collection}", "partage": True}).json()
            crees.append((collection, f["id"]))
            assert f["partage"] is True and f["auteur"] == "alban"
            # Un PATCH d'un autre champ le garde ; un PUT le reprend de la page ; décoché, il quitte le fichier.
            assert client.patch(f"/api/{collection}/{f['id']}", json={"connu": True}).json()["partage"] is True
            entiere = client.get(f"/api/{collection}/{f['id']}").json()
            assert client.put(f"/api/{collection}/{f['id']}", json={**entiere, "resume": "x"}).json()["partage"] is True
            entiere = client.get(f"/api/{collection}/{f['id']}").json()
            sans = client.put(f"/api/{collection}/{f['id']}", json={**entiere, "partage": False}).json()
            assert "partage" not in sans and "partage" not in json.loads((config.DONNEES / collection / f"{f['id']}.json").read_text(encoding="utf-8"))
            assert client.patch(f"/api/{collection}/{f['id']}", json={"partage": True}).json()["partage"] is True
            # La TV, le monde, le carnet : jamais le champ.
            j = tv_cartes.jeton(collection, f["id"])
            vue = client.get(f"/api/table/{'lieu' if collection == 'lieux' else 'pnj'}/{j}")
            assert vue.status_code == 200 and "partage" not in vue.json() and "auteur" not in vue.json()
        assert '"partage"' not in client.get("/api/monde").text
        jeton = cloisonnement.poser_lecteur(cloisonnement.FOND)
        try:
            assert '"partage"' not in json.dumps(carnet_api.elements_du_carnet(), ensure_ascii=False, default=str)
        finally:
            cloisonnement.retirer_lecteur(jeton)
        # Une collection qui ne se partage pas ne garde pas le champ.
        for collection in ("contrats", "scenarios", "plans"):
            f = client.post(f"/api/{collection}", json={**FICHES[collection], "partage": True}).json()
            crees.append((collection, f["id"]))
            assert "partage" not in f
            assert "partage" not in client.patch(f"/api/{collection}/{f['id']}", json={"partage": True}).json()
        c = client.post("/api/cartes", json={**carte("Carte non partagée"), "partage": True}).json()
        crees.append(("cartes", c["id"]))
        assert "partage" not in client.get(f"/api/cartes/{c['id']}").json()
    finally:
        for collection, ident in crees:
            (config.DONNEES / collection / f"{ident}.json").unlink(missing_ok=True)
