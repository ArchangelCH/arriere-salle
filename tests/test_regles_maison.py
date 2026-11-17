"""Le registre des règles maison : lecture, écriture, corbeille et historique, des champs vérifiés un à un, et le carnet
des joueurs (propositions/carnet/regles.json) qui n'a que les règles en vigueur et publiques, sans contexte, nom caché
masqué, écrit d'un seul coup."""

import json
import os
import re
import sys
import tempfile
from datetime import date
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from table.masque import contient_nom_cache  # noqa: E402
from api import application, campagne_api, config, tv_cartes  # noqa: E402

STATIQUE = Path(__file__).resolve().parent.parent / "app" / "static"
CF = {"CF-Connecting-IP": "203.0.113.7"}


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture
def regles(client):
    """Crée des règles par la route ; toutes retirées après l'essai (le carnet se récrit sans elles)."""
    creees = []

    def creer(**champs):
        r = client.post("/api/regles-maison", json=champs)
        assert r.status_code == 200, r.text
        creees.append(r.json()["id"])
        return r.json()

    yield creer
    for ident in creees:
        client.delete(f"/api/regles-maison/{ident}")


def carnet() -> dict:
    return json.loads(campagne_api.CARNET_REGLES.read_text(encoding="utf-8"))


def test_une_regle_de_bout_en_bout(client, regles):
    r = regles(titre="  Sauter   de l'étage ", texte="Test de Physique.  \r\n\r\n\r\n\r\nRaté : 1D6 Santé.", contexte="Décidé en riant.")
    assert r["id"].startswith("sauter-de-l-etage") and r["cree"] and r["modifie"] == r["cree"]
    assert r["titre"] == "Sauter de l'étage" and r["texte"] == "Test de Physique.\n\nRaté : 1D6 Santé."
    # Par défaut : en vigueur dès aujourd'hui, publique, sans séance.
    assert r["statut"] == "en-vigueur" and r["publique"] is True and r["seance"] == "" and r["depuis"] == date.today().isoformat()
    assert client.get(f"/api/regles-maison/{r['id']}").json() == r
    assert r["id"] in [x["id"] for x in client.get("/api/regles-maison").json()]

    # Ne change que ce qui est envoyé ; une version périmée est refusée.
    m = client.patch(f"/api/regles-maison/{r['id']}", json={"texte": "Physique, raté : 1D6.", "version_base": r["modifie"]}).json()
    assert m["texte"] == "Physique, raté : 1D6." and m["titre"] == r["titre"] and m["contexte"] == "Décidé en riant."
    assert m["cree"] == r["cree"] and m["modifie"] >= r["modifie"] and m["depuis"] == r["depuis"]
    refus = client.patch(f"/api/regles-maison/{r['id']}", json={"titre": "Autre", "version_base": r["modifie"]})
    assert refus.status_code == 409
    # L'ancienne version est archivée.
    assert list((config.HISTORIQUE / "regles-maison" / r["id"]).glob("*.json"))

    # Supprimer envoie à la corbeille.
    assert client.delete(f"/api/regles-maison/{r['id']}").status_code == 200
    assert client.get(f"/api/regles-maison/{r['id']}").status_code == 404
    assert any(f.name.startswith(r["id"]) for f in (config.CORBEILLE / "regles-maison").glob("*.json"))
    assert client.patch(f"/api/regles-maison/{r['id']}", json={"titre": "x"}).status_code == 404
    assert client.get("/api/regles-maison/PAS_UN_ID").status_code == 400


def test_a_trancher_d_abord_puis_en_vigueur(client, regles):
    a = regles(titre="Règle A, en vigueur", depuis="2026-10-01")
    b = regles(titre="Règle B, à trancher", statut="a-trancher")
    c = regles(titre="Règle C, en vigueur", depuis="2026-11-02")
    ordre = [x["id"] for x in client.get("/api/regles-maison").json() if x["id"] in (a["id"], b["id"], c["id"])]
    assert ordre == [b["id"], c["id"], a["id"]]


def test_la_date_d_entree_en_vigueur(client, regles):
    aujourdhui = date.today().isoformat()
    r = regles(titre="Focus au calme", statut="a-trancher", depuis="2026-11-02")
    assert r["depuis"] is None  # une question n'est en vigueur depuis rien
    r = client.patch(f"/api/regles-maison/{r['id']}", json={"statut": "en-vigueur"}).json()
    assert r["depuis"] == aujourdhui  # tranchée aujourd'hui
    r = client.patch(f"/api/regles-maison/{r['id']}", json={"depuis": "2026-11-02"}).json()
    assert r["depuis"] == "2026-11-02"  # le MJ la corrige
    r = client.patch(f"/api/regles-maison/{r['id']}", json={"texte": "Oui, partout."}).json()
    assert r["depuis"] == "2026-11-02"  # une retouche du texte ne la change pas
    r = client.patch(f"/api/regles-maison/{r['id']}", json={"statut": "a-trancher"}).json()
    assert r["depuis"] is None
    r = client.patch(f"/api/regles-maison/{r['id']}", json={"statut": "en-vigueur", "depuis": ""}).json()
    assert r["depuis"] == aujourdhui


@pytest.mark.parametrize("champs, message", [
    ({"texte": "sans titre"}, "titre"),
    ({"titre": "   "}, "titre"),
    ({"titre": "x" * 81}, "80 caractères"),
    ({"titre": 12}, "texte est attendu"),
    ({"titre": "Ok", "texte": "x" * 2001}, "2000 caractères"),
    ({"titre": "Ok", "contexte": "x" * 4001}, "4000 caractères"),
    ({"titre": "Ok", "texte": ["une", "liste"]}, "texte est attendu"),
    ({"titre": "Ok", "statut": "tranchee"}, "Statut"),
    ({"titre": "Ok", "publique": "oui"}, "Publique"),
    ({"titre": "Ok", "publique": 1}, "Publique"),
    ({"titre": "Ok", "seance": "pas-de-seance-pareille"}, "séance"),
    ({"titre": "Ok", "seance": "../seances/x"}, "Séance"),
    ({"titre": "Ok", "seance": 3}, "Séance"),
    ({"titre": "Ok", "depuis": "02/11/2026"}, "AAAA-MM-JJ"),
    ({"titre": "Ok", "depuis": "2026-02-30"}, "impossible"),
    ({"titre": "Ok", "depuis": "1789-07-14"}, "portée"),
    ({"titre": "Ok", "secret": "glissé en douce"}, "Champ inconnu : secret"),
])
def test_une_regle_invalide_n_ecrit_rien(client, champs, message):
    avant = client.get("/api/regles-maison").json()
    carnet_avant = campagne_api.CARNET_REGLES.read_text(encoding="utf-8") if campagne_api.CARNET_REGLES.exists() else None
    r = client.post("/api/regles-maison", json=champs)
    assert r.status_code == 400 and message in r.json()["detail"], r.text
    assert client.get("/api/regles-maison").json() == avant
    assert (campagne_api.CARNET_REGLES.read_text(encoding="utf-8") if campagne_api.CARNET_REGLES.exists() else None) == carnet_avant


def test_une_modification_invalide_ne_change_rien(client, regles):
    r = regles(titre="Les postures", texte="Une défense en défensive.")
    for champs in ({"titre": ""}, {"statut": "peut-etre"}, {"inconnu": 1}, {"texte": None}):
        assert client.patch(f"/api/regles-maison/{r['id']}", json=champs).status_code == 400
    assert client.get(f"/api/regles-maison/{r['id']}").json() == r
    assert client.post("/api/regles-maison", content=b"pas du json").status_code == 400
    assert client.post("/api/regles-maison", json=["une", "liste"]).status_code == 400


def test_la_seance_de_rattachement(client, regles):
    seance = client.post("/api/seances", json={"nom": "Séance des règles", "numero": 9}).json()
    r = regles(titre="Rattachée", seance=seance["id"])
    assert r["seance"] == seance["id"]
    # La séance part à la corbeille : la règle qui la nommait reste modifiable, sans être rattachée à autre chose.
    client.delete(f"/api/seances/{seance['id']}")
    m = client.patch(f"/api/regles-maison/{r['id']}", json={"texte": "Toujours là.", "seance": seance["id"]})
    assert m.status_code == 200 and m.json()["seance"] == seance["id"]
    assert client.patch(f"/api/regles-maison/{r['id']}", json={"seance": "une-autre-absente"}).status_code == 400
    assert client.patch(f"/api/regles-maison/{r['id']}", json={"seance": None}).json()["seance"] == ""


def test_le_carnet_n_a_que_les_regles_en_vigueur_et_publiques(client, regles):
    publique = regles(titre="Les postures", texte="Défensive : une défense par tour.", contexte="CONTEXTE-SECRET du MJ",
                      seance="", depuis="2026-11-02")
    regles(titre="A-TRANCHER-SECRET", texte="TEXTE-A-TRANCHER", statut="a-trancher")
    privee = regles(titre="PRIVEE-DU-MJ", texte="TEXTE-PRIVE", publique=False)
    brut = campagne_api.CARNET_REGLES.read_text(encoding="utf-8")
    c = json.loads(brut)
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?", c["maj"])
    for interdit in ("CONTEXTE-SECRET", "A-TRANCHER-SECRET", "TEXTE-A-TRANCHER", "PRIVEE-DU-MJ", "TEXTE-PRIVE", "contexte",
                     "seance", "statut", "publique", publique["id"]):
        assert interdit not in brut, interdit
    element = next(x for x in c["elements"] if x["titre"] == "Les postures")
    assert set(element) == {"id", "titre", "texte", "date"}
    assert element == {"id": tv_cartes.jeton("regles-maison", publique["id"]), "titre": "Les postures",
                       "texte": "Défensive : une défense par tour.", "date": "2026-11-02"}
    assert re.fullmatch(r"[a-f0-9]{20}", element["id"])

    # Rendue publique, puis remise à trancher : le carnet suit chaque changement.
    client.patch(f"/api/regles-maison/{privee['id']}", json={"publique": True})
    assert "PRIVEE-DU-MJ" in [x["titre"] for x in carnet()["elements"]]
    client.patch(f"/api/regles-maison/{privee['id']}", json={"statut": "a-trancher"})
    assert "PRIVEE-DU-MJ" not in campagne_api.CARNET_REGLES.read_text(encoding="utf-8")
    client.delete(f"/api/regles-maison/{publique['id']}")
    assert "Les postures" not in [x["titre"] for x in carnet()["elements"]]


def test_le_nom_cache_de_l_auberge_ne_part_pas_au_carnet(client, regles):
    r = regles(titre="Pas de bagarre à la Petite Fanfrelée", texte="Chez « Jamais ne dort », on se bat dehors.")
    assert "Fanfrel" in r["titre"]  # l'atelier garde le vrai nom
    brut = campagne_api.CARNET_REGLES.read_text(encoding="utf-8")
    assert not contient_nom_cache(brut) and "fanfrel" not in brut.lower() and "ne dort" not in brut.lower()
    element = next(x for x in carnet()["elements"] if x["id"] == tv_cartes.jeton("regles-maison", r["id"]))
    assert element["titre"] == "Pas de bagarre à l'auberge"
    assert element["texte"] == "À l'auberge, on se bat dehors."
    # L'identifiant de la fiche vient du titre : il porte le nom, le carnet ne reçoit que son jeton.
    assert "fanfrelee" in r["id"] and r["id"] not in brut


def test_le_carnet_s_ecrit_d_un_seul_coup(client, regles, monkeypatch):
    regles(titre="Première règle", texte="Elle est publiée.")
    avant = campagne_api.CARNET_REGLES.read_text(encoding="utf-8")
    dossier = campagne_api.CARNET_REGLES.parent
    assert campagne_api.CARNET_REGLES.stat().st_mode & 0o444 == 0o444  # lisible par le coin des joueurs
    assert not [f for f in dossier.iterdir() if f.name.endswith(".tmp")]

    # Une écriture qui casse en route laisse le carnet d'avant intact, et aucun fichier temporaire.
    ecrire_texte = Path.write_text

    def casse(self, *args, **kwargs):
        if self.parent == dossier:
            ecrire_texte(self, '{"maj": "à moitié', encoding="utf-8")
            raise OSError("disque plein")
        return ecrire_texte(self, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", casse)
    with pytest.raises(OSError):
        client.post("/api/regles-maison", json={"titre": "Règle qui casse le carnet"})
    monkeypatch.undo()
    assert campagne_api.CARNET_REGLES.read_text(encoding="utf-8") == avant
    assert not [f for f in dossier.iterdir() if f.name.endswith(".tmp")]
    # La règle elle-même est enregistrée : le carnet la reprend au changement suivant.
    cassee = next(x for x in client.get("/api/regles-maison").json() if x["titre"] == "Règle qui casse le carnet")
    regles(titre="Règle suivante")
    assert "Règle qui casse le carnet" in [x["titre"] for x in carnet()["elements"]]
    client.delete(f"/api/regles-maison/{cassee['id']}")


def test_par_cloudflare_le_registre_reste_ferme(client, regles):
    r = regles(titre="Règle du salon")
    assert client.get("/api/regles-maison", headers=CF).status_code == 404
    assert client.get(f"/api/regles-maison/{r['id']}", headers=CF).status_code == 404
    assert client.post("/api/regles-maison", json={"titre": "Venue d'Internet"}, headers=CF).status_code == 404
    assert client.patch(f"/api/regles-maison/{r['id']}", json={"titre": "Changée d'Internet"}, headers=CF).status_code == 404


def test_la_touche_r_laisse_les_editeurs_et_les_champs():
    source = (STATIQUE / "js/regles/rapide.js").read_text(encoding="utf-8")
    touche = re.search(r"\n  touche\(ev\) \{(.*?)\n  \}", source, flags=re.S).group(1)
    for garde in ("ev.ctrlKey", "ev.metaKey", "ev.altKey", "ev.repeat", "input, textarea, select, dialog", "dialog[open]",
                  "rPourLEditeur()", "ev.stopPropagation()"):
        assert garde in touche, garde
    # Ce que la fenêtre suppose des deux éditeurs : la carte prend R pour l'outil Rivière, le plan pour tourner un meuble,
    # dont l'orientation s'affiche avec le bouton « tourner-d ». Les deux écoutent la fenêtre, après le document.
    plan = (STATIQUE / "js/plan/editeur.js").read_text(encoding="utf-8")
    carte = (STATIQUE / "js/carte/editeur.js").read_text(encoding="utf-8")
    assert 'if (ev.key.toLowerCase() === "r") return this.tourner(' in plan and 'data-action="tourner-d"' in plan
    assert re.search(r'\["trace", "[^"]+", "R"\]', (STATIQUE / "js/carte/outils.js").read_text(encoding="utf-8"))
    assert 'import { OUTILS, tailleMarqueur } from "./outils.js";' in carte
    assert '<div class="editeur editeur-plan">' in plan and '<div class="editeur">' in carte
    for editeur in (plan, carte):
        assert 'window.addEventListener("keydown", this.clavier);' in editeur
    assert 'document.addEventListener("keydown", (ev) => this.touche(ev));' in source
