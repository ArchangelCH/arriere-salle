"""Les liens dans les deux sens (chantier VII) : ce que lient les scènes entre dans « Sous la main », que lisent « Avant de
jouer », la feuille de combat, la fiche d'une page, À montrer, le combat et la clôture ; « Dans les scénarios » sur la
fiche d'un PNJ et d'un lieu, calculé à partir des liens écrits ; l'identifiant d'une fiche, qui suit son nom tant que
rien ne la cite ; les liens courts de la zone d'écriture, sans jamais réécrire le texte d'un scénario. Rien de tout cela
ne s'ouvre à la table publique."""

import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from contenu import liens_fiches  # noqa: E402
import main  # noqa: E402
from api import application, config  # noqa: E402

JS = Path(__file__).resolve().parent.parent / "app" / "static" / "js"
CF = {"CF-Connecting-IP": "203.0.113.7"}


def lire(chemin: str) -> str:
    return (JS / chemin).read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture(scope="module")
def monde(client):
    """Un PNJ, un lieu sans carte, un plan de ce lieu, et un scénario qui les cite de toutes les façons."""
    pnj = client.post("/api/pnj", json={"nom": "Gaspard Tourbe-Ivoire", "connu": False, "secret": "SECRET-MJ-GASPARD"}).json()
    lieu = client.post("/api/lieux", json={"nom": "Le gué aux Cendres-Ivoire", "type": "point", "connu": False}).json()
    plan = client.post("/api/plans", json={"nom": "Le moulin ivoire", "lieu": lieu["id"], "largeur": 10, "hauteur": 8}).json()
    autre = client.post("/api/scenarios", json={"nom": "Un autre scénario ivoire", "chapitres": [
        {"id": "c-x", "titre": "Rien", "texte": "Personne ici."}]}).json()
    s = client.post("/api/scenarios", json={"nom": "Séance ivoire", "etat": "brouillon", "chapitres": [
        {"id": "c-1", "titre": "Le moulin", "texte": f"Au gué, [le meunier](#/pnj/{pnj['id']}) attend.\n\n"
                                                    f"| [Gaspard](#/pnj/{pnj['id']}) | 55 | 9 |"},
        {"id": "c-2", "titre": "La ferme", "texte": f"Vers [le gué](#/lieu/{lieu['id']}), puis le [moulin](#/plan/{plan['id']})."},
        {"id": "c-3", "titre": "Le prix", "texte": "Puis @[Gaspard Tourbe-Ivoire] avoue, et @[Personne Ivoire] se tait."},
    ], "corbeille": [{"id": "c-9", "titre": "Jeté", "texte": f"[x](#/pnj/{pnj['id']})"}]}).json()
    return {"pnj": pnj, "lieu": lieu, "plan": plan, "scenario": s, "autre": autre}


def test_dans_les_scenarios_cite_le_pnj(client, monde):
    p = monde["pnj"]
    r = client.get(f"/api/mentions/pnj/{p['id']}").json()
    passages = [x for x in r["passages"] if x["scenario"] == monde["scenario"]["id"]]
    assert [(x["numero"], x["titre"], x["fois"]) for x in passages] == [(1, "Le moulin", 2), (3, "Le prix", 1)]
    # L'extrait se lit sans adresse ; une rangée de tableau se lit en cellules ; un lien court se résout par le nom.
    assert passages[0]["extrait"] == "Au gué, le meunier attend." and passages[0]["lien"] == f"#/pnj/{p['id']}"
    assert passages[2 - 1]["extrait"].startswith("Puis Gaspard Tourbe-Ivoire avoue") and passages[1]["lien"] == "@[Gaspard Tourbe-Ivoire]"
    # Un chapitre mis à la corbeille du scénario ne compte pas ; les noms des scénarios sont là pour l'ancien champ.
    assert all(x["chapitre"] != "c-9" for x in r["passages"])
    assert r["noms"][monde["scenario"]["id"]] == "Séance ivoire"
    assert client.get("/api/mentions/pnj/inexistant-ivoire").status_code == 404
    assert client.get("/api/mentions/scenarios/x").status_code == 404


def test_dans_les_scenarios_cite_le_lieu_et_ses_plans(client, monde):
    r = client.get(f"/api/mentions/lieux/{monde['lieu']['id']}").json()
    passages = [x for x in r["passages"] if x["scenario"] == monde["scenario"]["id"]]
    assert [(x["numero"], x["fois"], x["par"]) for x in passages] == [(2, 2, ["Le moulin ivoire"])]
    assert passages[0]["lien"] == f"#/lieu/{monde['lieu']['id']}"


def test_les_liens_vers_une_fiche_restent_a_l_atelier(client, monde):
    """Ni la table publique ni un écran venu d'Internet ne lisent les passages des scénarios ni ne touchent un identifiant."""
    p = monde["pnj"]
    assert client.get(f"/api/mentions/pnj/{p['id']}", headers=CF).status_code == 404
    assert client.post(f"/api/pnj/{p['id']}/identifiant", headers=CF).status_code == 404
    assert client.post(f"/api/lieux/{monde['lieu']['id']}/identifiant", headers=CF).status_code == 404
    r = client.get(f"/api/mentions/pnj/{p['id']}")
    assert "SECRET-MJ-GASPARD" not in r.text


def test_l_identifiant_suit_le_nom_tant_que_rien_ne_cite_la_fiche(client):
    neuf = client.post("/api/pnj", json={"nom": "Nouveau PNJ", "rang": "civil"}).json()
    assert neuf["id"].startswith("nouveau-pnj")
    # Le premier vrai nom : la fiche passe sous « bertrand-ivoire », ses versions la suivent.
    lue = client.get(f"/api/pnj/{neuf['id']}").json()
    client.put(f"/api/pnj/{neuf['id']}", json={**lue, "nom": "Bertrand Ivoire", "version_base": lue["modifie"]})
    client.put(f"/api/pnj/{neuf['id']}", json={**client.get(f"/api/pnj/{neuf['id']}").json(), "voix": "Grave"})
    r = client.post(f"/api/pnj/{neuf['id']}/identifiant").json()
    assert r["change"] and r["id"] == "bertrand-ivoire" and r["fiche"]["nom"] == "Bertrand Ivoire" and r["fiche"]["voix"] == "Grave"
    # L'ancien fichier n'est plus ; l'ancien identifiant mène à la fiche (un écran resté dessus, test_renommage_suivi.py).
    assert not (config.PNJ / f"{neuf['id']}.json").exists()
    assert client.get(f"/api/pnj/{neuf['id']}").json()["id"] == "bertrand-ivoire"
    assert client.get("/api/pnj/bertrand-ivoire").json()["id"] == "bertrand-ivoire"
    assert (config.HISTORIQUE / "pnj" / "bertrand-ivoire").is_dir() and not (config.HISTORIQUE / "pnj" / neuf["id"]).exists()
    # Le même nom : rien ne bouge.
    assert client.post("/api/pnj/bertrand-ivoire/identifiant").json() == {**r, "change": False}
    # Une séance le cite : renommé ensuite, il garde son identifiant.
    client.post("/api/seances", json={"nom": "Séance ivoire", "numero": 41, "pnj": ["bertrand-ivoire"]})
    lue = client.get("/api/pnj/bertrand-ivoire").json()
    client.put("/api/pnj/bertrand-ivoire", json={**lue, "nom": "Bertrand le Meunier", "version_base": lue["modifie"]})
    r = client.post("/api/pnj/bertrand-ivoire/identifiant").json()
    assert not r["change"] and r["id"] == "bertrand-ivoire"


def test_l_identifiant_d_un_lieu_sans_carte(client):
    lieu = client.post("/api/lieux", json={"nom": "Village sans nom", "type": "village"}).json()
    lue = client.get(f"/api/lieux/{lieu['id']}").json()
    client.put(f"/api/lieux/{lieu['id']}", json={**lue, "nom": "La source ivoire", "version_base": lue["modifie"]})
    r = client.post(f"/api/lieux/{lieu['id']}/identifiant").json()
    assert r["change"] and r["id"] == "la-source-ivoire"
    # Un scénario le cite : il ne bouge plus.
    client.post("/api/scenarios", json={"nom": "Cite la source", "chapitres": [{"id": "c", "titre": "t", "texte": "[la source](#/lieu/la-source-ivoire)"}]})
    lue = client.get("/api/lieux/la-source-ivoire").json()
    client.put("/api/lieux/la-source-ivoire", json={**lue, "nom": "La source tarie", "version_base": lue["modifie"]})
    assert not client.post("/api/lieux/la-source-ivoire/identifiant").json()["change"]


def test_un_scenario_n_est_jamais_reecrit_par_le_serveur(client, monde):
    """Les liens courts ne vivent que dans la zone d'écriture : le fichier garde ce que la page envoie, octet pour octet."""
    s = client.get(f"/api/scenarios/{monde['scenario']['id']}").json()
    assert s["chapitres"][0]["texte"] == monde["scenario"]["chapitres"][0]["texte"]
    assert s["chapitres"][2]["texte"] == "Puis @[Gaspard Tourbe-Ivoire] avoue, et @[Personne Ivoire] se tait."


def test_lire_un_lien_comme_la_page():
    assert liens_fiches.cible("#/carte/route?lieu=la-ferme") == ("carte", "route", "la-ferme")
    assert liens_fiches.cible("#/pnj/a%20b") == ("pnj", "a b", None)
    assert liens_fiches.cible("#/pnj/%E0") is None and liens_fiches.cible("#/pnj/nouveau") is None
    assert liens_fiches.cible("https://youtu.be/x") is None and liens_fiches.cible("#/auberge/contrat/x") is None
    fiches = {"pnj": [{"id": "b1", "nom": "Billy"}, {"id": "b2", "nom": "Billy"}, {"id": "n", "nom": "Lisette"}],
              "lieu": [{"id": "f", "nom": "La Ferme"}], "plan": [{"id": "pf", "nom": "La Ferme"}]}
    assert liens_fiches.resoudre("lisette", fiches) == ("pnj", "n")
    assert liens_fiches.resoudre("Billy", fiches) is None
    assert liens_fiches.resoudre("LA FERME", fiches) == ("lieu", "f")


def test_ce_que_lient_les_scenes_entre_dans_sous_la_main():
    """Une seule règle (seances/sous-la-main.js) pour toutes les pages qui lisent « Sous la main »."""
    for chemin in ("seances/avant-de-jouer.js", "seances/feuille-combat.js", "seances/fiche.js", "seances/pour-le-carnet.js"):
        assert 'from "./sous-la-main.js"' in lire(chemin), chemin
    assert 'from "../seances/sous-la-main.js"' in lire("combats/combat.js")
    avant = lire("seances/avant-de-jouer.js").split("export function avantDeJouer")[1].split("\n}\n")[0]
    assert "new Set(s.rencontres" not in avant and "idsSousLaMain(s, plans).rencontres" in avant
    feuille = lire("seances/feuille-combat.js")
    assert "(s.rencontres || []).map" not in feuille and "sousLaMain(s, { rencontres, plans }).rencontres" in feuille
    seances = lire("seances/seances.js")
    assert 'htmlRubrique(s, "pnj"' in seances and 'htmlRubrique(s, "rencontres"' in seances
    maj = seances.split("  majLier(i, focus) {")[1].split("\n  }\n")[0]
    assert "this.majSousLaMain();" in maj and "this.majAvantDeJouer();" in maj


def test_le_champ_scenario_du_pnj_reste_lisible():
    carnet = lire("pnj/carnet.js")
    assert 'data-champ="scenario"' not in carnet
    assert 'placeMentions("pnj", p.id)' in carnet and "ancien: p.scenario" in carnet
    assert 'p.scenario = ""' in carnet.split("verserScenario(p) {")[1].split("\n  }\n")[0]


def test_la_zone_d_ecriture_passe_par_les_liens_courts():
    scenarios = lire("scenarios/scenarios.js")
    assert "ch.texte = this.courts.fichier(ch, this.zone.value);" in scenarios
    assert "ch.texte = this.zone.value;" not in scenarios
    assert "this.zone.value = this.courts.zone({ id: this.chap, texte });" in scenarios


def test_sur_la_carte_l_identifiant_suit_aussi_le_nom(client):
    """L'outil Lieu crée « Village sans nom » sur une carte : son marqueur le cite. L'éditeur de cette carte demande le
    nouvel identifiant en la nommant, avec la version de la carte qu'il a sous les yeux : le serveur réécrit le marqueur
    dans le même geste. Une autre carte, aucune carte ou aucune version ne suffisent pas."""
    carte = client.post("/api/cartes", json={"nom": "Carte ivoire", "largeur": 20, "hauteur": 20, "terrain": "AA"}).json()
    autre = client.post("/api/cartes", json={"nom": "Autre carte ivoire", "largeur": 20, "hauteur": 20, "terrain": "AA"}).json()
    lieu = client.post("/api/lieux", json={"nom": "Village sans nom", "type": "village", "carte": carte["id"]}).json()
    lue = client.get(f"/api/cartes/{carte['id']}").json()
    client.put(f"/api/cartes/{carte['id']}", json={**lue, "marqueurs": [{"id": "m1", "lieu": lieu["id"], "x": 3, "y": 4}],
                                                   "version_base": lue["modifie"]})
    fiche = client.get(f"/api/lieux/{lieu['id']}").json()
    client.put(f"/api/lieux/{lieu['id']}", json={**fiche, "nom": "Le pont ivoire", "version_base": fiche["modifie"]})
    version = client.get(f"/api/cartes/{carte['id']}").json()["modifie"]
    assert not client.post(f"/api/lieux/{lieu['id']}/identifiant").json()["change"]
    assert not client.post(f"/api/lieux/{lieu['id']}/identifiant", json={"carte": autre["id"], "version_carte": version}).json()["change"]
    assert not client.post(f"/api/lieux/{lieu['id']}/identifiant", json={"carte": carte["id"]}).json()["change"]
    r = client.post(f"/api/lieux/{lieu['id']}/identifiant", json={"carte": carte["id"], "version_carte": version}).json()
    assert r["change"] and r["id"] == "le-pont-ivoire"
    relue = client.get(f"/api/cartes/{carte['id']}").json()
    assert relue["marqueurs"][0]["lieu"] == "le-pont-ivoire" and r["carte"] == {"id": carte["id"], "modifie": relue["modifie"]}
    # Un PNJ n'a pas de carte : la demande n'y change rien.
    p = client.post("/api/pnj", json={"nom": "Le passeur ivoire"}).json()
    client.post("/api/seances", json={"nom": "Cite le passeur", "numero": 42, "pnj": [p["id"]]})
    lue = client.get(f"/api/pnj/{p['id']}").json()
    client.put(f"/api/pnj/{p['id']}", json={**lue, "nom": "Le passeur des cendres", "version_base": lue["modifie"]})
    assert not client.post(f"/api/pnj/{p['id']}/identifiant", json={"carte": carte["id"]}).json()["change"]
