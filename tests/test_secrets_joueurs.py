"""Les secrets du MJ hors des textes lus par les joueurs : le nom caché de l'auberge (même coupé par un caractère invisible,
sans « l'auberge l'auberge »), les PNJ, lieux et peuples encore inconnus signalés avant l'envoi, et le « Précédemment »
rédigé à partir de ce que savent les joueurs. Le modèle est un faux client."""
import json
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, carnet_api, config, contexte_du_modele, tv_cartes, tv_ecran, tv_etat  # noqa: E402
from ia import redaction  # noqa: E402
from faux_modele import FauxClient  # noqa: E402
from table.masque import contient_nom_cache, forme_simple, masquer  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture
def fiches(client):
    """Un petit monde : des PNJ et des lieux connus ou non, des aventuriers au peuple caché ou non. Effacé à la fin."""
    creees = []

    def creer(collection, **fiche):
        f = client.post(f"/api/{collection}", json=fiche).json()
        creees.append((collection, f["id"]))
        return f

    monde = {
        "corentin": creer("pnj", nom="Corentin Vasselin", surnom="le Héron", connu=False, role="passeur", envie="ENVIE-SECRETE"),
        "ninette": creer("pnj", nom="Ninette Vasselin", connu=True, role="meunière", peuple="Humaine", secret="SECRET-NINETTE"),
        "vierge": creer("pnj", nom="Nouveau PNJ", connu=False),
        "grange": creer("lieux", nom="La Grange-Écarlate", type="ruine", connu=False, resume="RESUME-GRANGE"),
        "pre": creer("lieux", nom="Le Pré-Vert", type="point", connu=True, resume="Un pré au bord de l'eau.", secrets="SECRET-PRE"),
        "ombre": creer("aventuriers", nom="Ysolde Gris", joueur="Lou", peuple="Fils des Brumes", peuple_cache=True, specialite="pisteuse",
                       element="Mort", pourquoi="POURQUOI-YSOLDE", tablee=True),
        "elfe": creer("aventuriers", nom="Aldwin Sylve", joueur="Max", peuple="Elfe", specialite="archer", tablee=True),
        "elfe-cache": creer("aventuriers", nom="Brune Sylve", joueur="Zoé", peuple="Elfe", peuple_cache=True, tablee=True),
    }
    yield monde
    for collection, ident in creees:
        client.delete(f"/api/{collection}/{ident}")


def secrets(client, texte):
    return {(x["genre"], x["nom"]): x for x in client.post("/api/masque", json={"texte": texte}).json()["secrets"]}


def test_un_trait_d_union_invisible_ne_cache_plus_le_nom(client):
    colle = "Ils ont dormi à la Pe­tite Fanf­relée."  # tel qu'il arrive d'un copier-coller de PDF
    assert contient_nom_cache(colle) and masquer(colle) == "Ils ont dormi à l'auberge."
    assert masquer("Retour à la Fan​frelée﻿ ce soir") == "Retour à l'auberge ce soir"
    assert masquer("« Jamais⁠ ne dort », a-t-il dit.") == "L'auberge, a-t-il dit."
    verif = client.post("/api/masque", json={"texte": colle}).json()
    assert verif["trouve"] and verif["texte"] == "Ils ont dormi à l'auberge." and "­" not in verif["texte"]
    # La TV aussi : le « Précédemment » d'une séance passe par le même masque.
    seance = client.post("/api/seances", json={"nom": "Séance invisible", "precedemment": colle}).json()
    recap = client.get(f"/api/table/precedemment/{tv_cartes.jeton('seances', seance['id'])}").json()
    assert recap["texte"] == "Ils ont dormi à l'auberge."
    client.delete(f"/api/seances/{seance['id']}")


@pytest.mark.parametrize("texte, attendu", [
    ("Ils ont quitté l'auberge « Jamais ne dort »", "Ils ont quitté l'auberge"),
    ("Ils ont quitté l'auberge « Jamais ne dort », sans payer.", "Ils ont quitté l'auberge, sans payer."),
    ("Le soir, l'auberge La Petite Fanfrelée était pleine", "Le soir, l'auberge était pleine"),
    ("L'Auberge Petite Fanfrelée est fermée.", "L'Auberge est fermée."),
    ("Une nuit à l'auberge, la Petite Fanfrelée, puis la route.", "Une nuit à l'auberge, puis la route."),
    ("Ils sont rentrés à l'auberge : la P'tite Fanfrelée.", "Ils sont rentrés à l'auberge."),
    ("Une auberge, la Petite Fanfrelée brûlait.", "Une auberge, l'auberge brûlait."),
    # Ce qui marchait avant ne change pas.
    ("Ils ont dormi à l'auberge de la Petite Fanfrelée.", "Ils ont dormi à l'auberge."),
    ("Retour chez Petite Fanfrelée", "Retour à l'auberge"),
    ("auberge de la Petite Fanfrelée", "Auberge"),
    ("Jamais ne dort, la gamine !", "L'auberge, la gamine !"),
    ("Le groupe a dormi à la Petite-Fanfrelee. Puis il est reparti.", "Le groupe a dormi à l'auberge. Puis il est reparti."),
])
def test_plus_jamais_l_auberge_l_auberge(texte, attendu):
    assert masquer(texte) == attendu
    assert "auberge l'auberge" not in masquer(texte).lower()



# Un invisible entre deux mots, sans espace visible : l'écran montre « PetiteFanfrelée », le nom doit tomber quand même.
@pytest.mark.parametrize("invisible", ["\u200b", "\u200c", "\u200d", "\u2060", "\ufeff", "\u180e", "\u00ad", "\u2063"])
def test_un_invisible_entre_deux_mots_ne_laisse_pas_passer_le_nom(client, invisible):
    for texte, attendu in (
        (f"Ils ont dormi à la Petite{invisible}Fanfrelée.", "Ils ont dormi à l'auberge."),
        (f"Retour à{invisible}la{invisible}Fanfrelée", "Retour à l'auberge"),
        (f"Ils ont dormi à la{invisible}Petite{invisible}Fanf{invisible}relée.", "Ils ont dormi à l'auberge."),
        (f"« Jamais{invisible}ne{invisible}dort », a-t-il dit.", "L'auberge, a-t-il dit."),
        (f"Ils ont quitté l'auberge{invisible} « Jamais ne dort »{invisible}, sans payer.", "Ils ont quitté l'auberge, sans payer."),
    ):
        assert contient_nom_cache(texte), ascii(texte)
        assert masquer(texte) == attendu, ascii(texte)
        verif = client.post("/api/masque", json={"texte": texte}).json()
        assert verif["trouve"] and verif["texte"] == attendu


@pytest.mark.parametrize("texte, attendu", [
    ("la PetiteFanfrelée", "L'auberge"),
    ("Retour à laFanfrelée.", "Retour à l'auberge."),
    ("Une suite de" + "\u200b" * 5000 + " rien", "Une suite de rien"),
    # Un « é » en deux caractères, même séparés par un invisible.
    ("La Fanfrele\u200b\u0301e brûle", "L'auberge brûle"),
    # Ce qui ne la désigne pas reste.
    ("Benjamais ne dort", "Benjamais ne dort"),
    ("Une fanfreluche.", "Une fanfreluche."),
])
def test_le_nom_colle_ou_truffe_d_invisibles(texte, attendu):
    assert masquer(texte) == attendu


def test_un_invisible_entre_deux_mots_d_un_pnj_inconnu(client, fiches):
    for texte in ("Ils ont suivi Corentin\u200bVasseur.", "Ils ont suivi Corentin\u2060Vasseur.",
                  "Ils ont suivi Co\u00adrentin\u200bVasseur.", "Ils ont suivi Co\u200brentin.", "Le\u200bHéron les attendait."):
        assert ("pnj", "Corentin Vasselin") in secrets(client, texte), ascii(texte)
    assert ("lieu", "La Grange-Écarlate") in secrets(client, "Ils ont fouillé la Grange\u200cÉcarlate.")


def test_marquer_connu_ne_vise_qu_une_fiche_parmi_les_homonymes(client, fiches):
    creees = []

    def creer(collection, **fiche):
        f = client.post(f"/api/{collection}", json=fiche).json()
        creees.append((collection, f["id"]))
        return f

    colporteur = creer("pnj", nom="Bertrand", role="Colporteur", connu=False)
    palefrenier = creer("pnj", nom="Bertrand", role="Palefrenier", connu=False, lieu=fiches["grange"]["id"])
    jumeau_a = creer("pnj", nom="Bertrand", role="Gamin des rues", connu=False)
    jumeau_b = creer("pnj", nom="bertrand", role="gamin des rues", connu=False)
    creer("lieux", nom="Le Gué", type="village", connu=False)
    creer("lieux", nom="Le Gué", type="ruine", connu=False)
    lignes = [x for x in client.post("/api/masque", json={"texte": "Bertrand le palefrenier les attendait au Gué."}).json()["secrets"]]
    pnj = {x["ids"][0]: x for x in lignes if x["genre"] == "pnj" and forme_simple(x["nom"]) == "bertrand"}
    # Une ligne par fiche, une seule fiche par ligne, distinguée comme dans le carnet (métier · lieu).
    assert set(pnj) == {colporteur["id"], palefrenier["id"], jumeau_a["id"], jumeau_b["id"]}
    assert all(len(x["ids"]) == 1 for x in lignes)
    assert pnj[colporteur["id"]]["precision"] == "Colporteur" and not pnj[colporteur["id"]].get("ambigu")
    assert pnj[palefrenier["id"]]["precision"] == "Palefrenier · La Grange-Écarlate"
    # Deux fiches que rien ne distingue : pas de « Marquer connu » possible, le MJ choisit dans le carnet.
    assert pnj[jumeau_a["id"]]["ambigu"] and pnj[jumeau_b["id"]]["ambigu"]
    gues = [x for x in lignes if x["genre"] == "lieu" and x["nom"] == "Le Gué"]
    assert sorted(x["precision"] for x in gues) == ["ruine", "village"] and not any(x.get("ambigu") for x in gues)
    # Un nom porté par une seule fiche : pas de précision, comme avant.
    assert "precision" not in secrets(client, "Corentin Vasselin")[("pnj", "Corentin Vasselin")]
    # Marquer le palefrenier connu ne touche pas les autres Bertrand.
    client.patch(f"/api/pnj/{palefrenier['id']}", json={"connu": True})
    for f, connu in ((colporteur, False), (palefrenier, True), (jumeau_a, False), (jumeau_b, False)):
        assert client.get(f"/api/pnj/{f['id']}").json()["connu"] is connu
    restes = client.post("/api/masque", json={"texte": "Bertrand"}).json()["secrets"]
    assert {x["ids"][0] for x in restes if x["genre"] == "pnj"} == {colporteur["id"], jumeau_a["id"], jumeau_b["id"]}
    for collection, ident in creees:
        client.delete(f"/api/{collection}/{ident}")

def test_les_pnj_et_lieux_inconnus_sont_signales(client, fiches):
    texte = ("Le groupe a croisé corentin près de la grange ecarlate. Ninette Vasselin a pleuré au Pré-Vert. "
             "Le fils des brumes s'est tu. Un elfe chantait. Le nouveau PNJ attendait.")
    trouves = secrets(client, texte)
    corentin = trouves[("pnj", "Corentin Vasselin")]
    assert corentin["ids"] == [fiches["corentin"]["id"]]
    assert trouves[("lieu", "La Grange-Écarlate")]["ids"] == [fiches["grange"]["id"]]
    assert trouves[("peuple", "Fils des Brumes")]["de"] == ["Ysolde Gris"]
    # Connus, nom par défaut, ou peuple que porte aussi un autre aventurier à visage découvert : rien à signaler.
    noms = {nom for _, nom in trouves}
    assert not noms & {"Ninette Vasselin", "Le Pré-Vert", "Nouveau PNJ", "Elfe"}
    # « Vasselin » seul désigne aussi Ninette, connue : ce n'est pas le secret de Corentin.
    assert ("pnj", "Corentin Vasselin") not in secrets(client, "Vasselin a parlé au moulin.")
    # Par son surnom, sans accents ni casse, même coupé par un trait d'union invisible.
    assert ("pnj", "Corentin Vasselin") in secrets(client, "Le HERON les attendait.")
    assert ("pnj", "Corentin Vasselin") in secrets(client, "Ils ont suivi Co­rentin jusqu'au gué.")
    assert ("lieu", "La Grange-Écarlate") in secrets(client, "Ils ont fouillé la Grange​-Écarlate.")
    # « Marquer connu » : la fiche ne change que par ce champ, et l'avertissement disparaît.
    apres = client.patch(f"/api/pnj/{fiches['corentin']['id']}", json={"connu": True}).json()
    assert apres["connu"] is True and apres["envie"] == "ENVIE-SECRETE"
    assert ("pnj", "Corentin Vasselin") not in secrets(client, texte)
    # Un texte sans secret : la liste est vide.
    assert client.post("/api/masque", json={"texte": "Il pleuvait."}).json()["secrets"] == []


def test_le_contexte_public_ne_dit_que_ce_que_savent_les_joueurs(client, fiches, monkeypatch, tmp_path):
    campagne = tmp_path / "campagne.json"
    campagne.write_text(json.dumps({"nom": "Essai", "niveau": 2, "tablee": [
        {"aventurier": fiches["ombre"]["id"], "actif": True}, {"aventurier": fiches["elfe"]["id"], "actif": True}]}), encoding="utf-8")
    monkeypatch.setattr(config, "CAMPAGNE", campagne)
    fil = client.post("/api/fils", json={"nom": "FIL-SECRET", "but": "BUT-SECRET"}).json()
    idee = client.post("/api/idees", json={"texte": "IDEE-SECRETE"}).json()
    lue = client.post("/api/seances", json={"nom": "Séance lue", "numero": 41, "close": True, "resume": "RESUME-MJ",
                                            "precedemment": "Ils ont trouvé la clé à la Petite Fanfrelée."}).json()
    leger, public = contexte_du_modele.contexte_ia("leger"), contexte_du_modele.contexte_ia("public")
    # Même consigne, même canon : le cache reste commun ; seul l'état de la campagne diffère.
    assert public[:2] == leger[:2] and [b.get("cache_control", {}).get("ttl") for b in public] == [None, "1h", "5m"]
    etat, complet = public[-1]["text"], leger[-1]["text"]
    assert "Corentin Vasselin" in complet and "FIL-SECRET" in complet and "IDEE-SECRETE" in complet
    for present in ("Ninette Vasselin", "meunière", "Le Pré-Vert", "Un pré au bord de l'eau.", "Ysolde Gris", "pisteuse",
                    "Aldwin Sylve", "Elfe", "Ils ont trouvé la clé à l'auberge."):
        assert present in etat, present
    for absent in ("Corentin", "Héron", "ENVIE-SECRETE", "SECRET-NINETTE", "Grange", "RESUME-GRANGE", "SECRET-PRE",
                   "FIL-SECRET", "BUT-SECRET", "IDEE-SECRETE", "Fils des Brumes", "POURQUOI-YSOLDE", "RESUME-MJ",
                   "inconnu des", "anfrel", "Rencontres préparées", "Scénarios"):
        assert absent not in etat, absent
    assert contexte_du_modele.contexte_ia("public") == public  # mêmes données, même texte
    for collection, f in (("fils", fil), ("idees", idee), ("seances", lue)):
        client.delete(f"/api/{collection}/{f['id']}")


def test_precedemment_et_histoire_rediges_avec_le_contexte_public(client, fiches, monkeypatch):
    faux = FauxClient("Ils ont fui la ferme. Qui les suivait ?", "Ancienne pisteuse, elle compte ses pas.")
    monkeypatch.setattr(redaction, "CLIENT", faux)
    r = client.post("/api/precedemment/redaction", json={"journal": "14:10 fuite de la ferme", "resume": "Corentin les suit"})
    assert r.status_code == 200 and r.json()["texte"] == "Ils ont fui la ferme. Qui les suivait ?"
    h = client.post("/api/aventurier/histoire", json={"nom": "Ysolde Gris", "avant": "pisteuse", "peuple": "Fils des Brumes"})
    assert h.status_code == 200
    public = contexte_du_modele.contexte_ia("public")
    for appel in faux.appels:
        assert appel["system"] == public
        assert "Corentin" not in appel["system"][-1]["text"] and "Grange" not in appel["system"][-1]["text"]
    # Les notes du MJ, elles, partent dans la demande : c'est à lui de dire ce que les héros ont appris.
    assert "Corentin les suit" in faux.appels[0]["messages"][0]["content"]


def test_un_billet_secret_ne_sort_jamais_de_l_atelier(client, fiches, monkeypatch, tmp_path):
    """Les billets d'une séance (le mot remis sur papier à un seul joueur) sont des données du MJ : ni la TV (vues de la
    séance, état poussé par le WebSocket, même si un écran tente de les y mettre), ni le carnet des joueurs, ni le
    contexte public du modèle de rédaction ne les reçoivent. La séance est close et sa TV montrée, pour que tout parte."""
    from commun import carnet
    campagne = tmp_path / "campagne.json"
    campagne.write_text(json.dumps({"nom": "Essai", "niveau": 1, "tablee": [
        {"id": "j1", "aventurier": fiches["elfe"]["id"], "actif": True}]}), encoding="utf-8")
    monkeypatch.setattr(config, "CAMPAGNE", campagne)
    billets = [{"id": "b-1", "pour": ["j1"], "titre": "BILLET-TITRE-SECRET", "texte": "BILLET-TEXTE-SECRET", "scene": "sc-1", "remis": True},
               {"id": "b-2", "pour": [], "titre": "", "texte": "BILLET-SANS-HEROS", "scene": "", "remis": False}]
    s = client.post("/api/seances", json={"nom": "Séance de la ferme", "numero": 61, "close": True, "date": "2026-11-07",
                                          "precedemment": "Ils ont fui la ferme.", "deroule": [{"titre": "La ferme", "cle": "sc-1"}],
                                          "billets": billets}).json()
    j = tv_cartes.jeton("seances", s["id"])
    interdits = ("BILLET-", "billets")
    for vue in ("precedemment", "episode"):
        client.put("/api/table", json={"vue": vue, "seance": s["id"], "billets": billets})
        texte = client.get(f"/api/table/{vue}/{j}").text
        assert not any(x in texte for x in interdits), vue
        with client.websocket_connect("/ws/table") as ws:
            etat = json.dumps(ws.receive_json(), ensure_ascii=False)
        assert not any(x in etat for x in interdits), etat
    # L'état que reçoivent la TV et la table publique : seulement les clés de la table, projetées.
    assert not any(x in json.dumps(tv_etat.etat_public(tv_ecran.etat_table()), ensure_ascii=False) for x in interdits)
    assert client.put("/api/carnet-joueurs", json={"ouvert": True}).json()["ouvert"] is True
    try:
        carnet_api.publier_carnet()
        publie = "\n".join(f.read_text(encoding="utf-8") for f in sorted((config.PROPOSITIONS / carnet.CARNET).rglob("*.json")))
        assert "Ils ont fui la ferme." in publie  # la séance est bien dans le carnet…
        assert not any(x in publie for x in interdits)  # … sans ses billets
    finally:
        client.put("/api/carnet-joueurs", json={"ouvert": False})
        carnet_api.publier_carnet()
    public = json.dumps(contexte_du_modele.contexte_ia("public"), ensure_ascii=False)
    assert "BILLET-" not in public
    client.put("/api/table", json={"vue": "accueil"})
    client.delete(f"/api/seances/{s['id']}")
