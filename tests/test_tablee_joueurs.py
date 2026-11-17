"""La tablée et les joueurs : un héros créé dans l'atelier se relie au lien de son joueur (il lit sa fiche et commande
pour lui seul, jamais un autre) ; le lien d'un joueur accueilli ouvre le carnet sur sa fiche et son créateur ne s'écrit
plus ; le carnet lit le texte écrit pour lui à la clôture d'une séance ; « Mon héros » est complet, sans rien du MJ."""
import json
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from commun import carnet  # noqa: E402
import joueurs  # noqa: E402
from comptes_coin import entrer, jeton_de  # noqa: E402
from coin_mj import liens_joueurs  # noqa: E402
import main  # noqa: E402
from api import application, carnet_api, config, tv_cartes  # noqa: E402

CARNET = config.PROPOSITIONS / carnet.CARNET
CF = {"CF-Connecting-IP": "203.0.113.7"}
# Tout ce que peut contenir la fiche publiée d'un héros : une clé de plus doit être ajoutée ici, en connaissance de cause.
CLES_DE_LA_FICHE = {"nom", "joueur", "genre", "couleur", "peuple", "vocations", "specialite", "element", "niveau", "physique", "social",
                    "mental", "competences", "armes", "protection", "bouclier", "dons", "langues", "posture", "posture_elementaire",
                    "themes", "conseils", "histoire", "avant", "pourquoi", "jamais", "allure", "defaut", "lien", "contacts",
                    "particularites", "lien_avec", "sante_max", "sante", "psy_max", "psy", "cartons", "or", "equipement", "objets",
                    "illustration",
                    # Les passages du récit que le carnet garde : des noms de champs, jamais leur texte.
                    "tenus"}



@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture(scope="module")
def coin_pour():
    patch = pytest.MonkeyPatch()
    patch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    patch.setattr(joueurs, "COOKIE_SUR", False)
    patch.setattr(joueurs, "HOTES", set())

    def ouvrir(joueur):
        c = TestClient(joueurs.app)
        entrer(c, joueur)
        return c
    yield ouvrir
    patch.undo()


def ouvrir_carnet(atelier, ouvert=True):
    assert atelier.put("/api/carnet-joueurs", json={"ouvert": ouvert}).json()["ouvert"] is ouvert


@pytest.fixture(scope="module")
def tablee(atelier, coin_pour):
    """Basile, accueilli depuis son lien avec Tavarède ; Velora, créée dans l'atelier pour Yuna, invitée sans héros ; une
    boutique ouverte aux joueurs. Tout est retiré à la fin."""
    crees = []

    def creer(collection, **fiche):
        f = atelier.post(f"/api/{collection}", json=fiche).json()
        crees.append((collection, f["id"]))
        return f

    t = {"velora": creer("aventuriers", nom="Velora Dorvan", genre="f", joueur="Yuna", tablee=True, physique=60, social=50,
                         mental=60, sante=7, psy=5, secret="SECRET-VELORA", notes_mj="NOTE-VELORA", **{"or": 40}),
         "hors": creer("aventuriers", nom="Kasper Hors", tablee=False),
         "sans_nom": creer("aventuriers", nom="", tablee=True),
         "echoppe": creer("boutiques", nom="Chez Odile", ouverte_joueurs=True, articles=[
             {"id": "torche1", "nom": "Torche", "prix": "1", "categorie": "Équipement", "description": "", "stock": None, "cache": False}])}
    basile = atelier.post("/api/joueurs", json={"nom": "Basile"}).json()
    coin_basile = coin_pour(basile)
    coin_basile.post("/api/moi/aventurier", json={"nom": "Tavarède Gué", "sante": 9, "psy": 5, "or": 10})
    coin_basile.post("/api/moi/envoyer")
    t["tavarede"] = atelier.post(f"/api/joueurs/{basile['id']}/accueillir").json()
    crees.append(("aventuriers", t["tavarede"]["id"]))
    yuna = atelier.post("/api/joueurs", json={"nom": "Yuna"}).json()
    t.update(basile=basile, coin_basile=coin_basile, yuna=yuna, coin_yuki=coin_pour(yuna))
    yield t
    ouvrir_carnet(atelier, False)
    for j in (basile, yuna):
        atelier.delete(f"/api/joueurs/{j['id']}")
    for collection, ident in crees:
        atelier.delete(f"/api/{collection}/{ident}")
    carnet_api.publier_carnet()


def commander(coin, t):
    return coin.post("/api/commandes", json={"boutique": tv_cartes.jeton("boutiques", t["echoppe"]["id"]),
                                             "lignes": [{"article": "torche1", "quantite": 1}]})


def test_un_heros_de_l_atelier_se_relie_a_son_joueur(atelier, tablee):
    t, yuna = tablee, tablee["yuna"]["id"]
    ouvrir_carnet(atelier)
    # Avant : Velora est signalée sans lien ; Yuna n'a ni fiche, ni échoppe pour elle.
    avant = atelier.get("/api/carnet-joueurs").json()
    assert {"id": t["velora"]["id"], "nom": "Velora Dorvan", "joueur": "Yuna"} in avant["sans_lien"]
    assert all(x["nom"] not in ("Kasper Hors", "", "Tavarède Gué") for x in avant["sans_lien"])
    assert t["coin_yuki"].get("/api/carnet").json()["heros"] is None
    assert commander(t["coin_yuki"], t).status_code == 409

    r = atelier.post(f"/api/joueurs/{yuna}/relier", json={"heros": t["velora"]["id"]})
    assert r.status_code == 200
    assert r.json()["etat"] == "relie" and r.json()["relie"] is True and r.json()["heros"] == {"id": t["velora"]["id"], "nom": "Velora Dorvan"}
    assert r.json()["aventurier"] == "Velora Dorvan"
    assert all(x["id"] != t["velora"]["id"] for x in atelier.get("/api/carnet-joueurs").json()["sans_lien"])
    # Yuna lit sa fiche (rien du MJ) et commande pour elle ; son créateur est fermé.
    lu = t["coin_yuki"].get("/api/carnet").json()
    assert lu["heros"]["nom"] == "Velora Dorvan" and lu["heros"]["or"] == 40
    assert "SECRET-VELORA" not in json.dumps(lu, ensure_ascii=False) and "NOTE-VELORA" not in json.dumps(lu, ensure_ascii=False)
    moi = t["coin_yuki"].get("/api/moi").json()
    assert moi["accueilli"] is True and moi["heros"] == {"nom": "Velora Dorvan", "genre": "f"} and moi["accueilli_le"]
    assert t["coin_yuki"].post("/api/moi/aventurier", json={"nom": "Un second héros"}).status_code == 423
    c = commander(t["coin_yuki"], t)
    assert c.status_code == 200
    vendue = atelier.post(f"/api/commandes/{yuna}/{c.json()['id']}/vendre", json={})
    assert vendue.status_code == 200 and vendue.json()["heros"]["nom"] == "Velora Dorvan"
    assert atelier.get(f"/api/aventuriers/{t['velora']['id']}").json()["or"] == 39
    # Le lien ne part pas dans le dossier du coin des joueurs : seulement de quoi fermer le créateur.
    acces = json.loads((config.PROPOSITIONS / ".acces.json").read_text(encoding="utf-8"))
    assert next(j for j in acces["joueurs"] if j["id"] == yuna)["relie"]["nom"] == "Velora Dorvan"
    assert t["velora"]["id"] not in (config.PROPOSITIONS / ".acces.json").read_text(encoding="utf-8")
    carnet.fichier_commandes(config.PROPOSITIONS, yuna).unlink(missing_ok=True)


def test_un_joueur_ne_voit_jamais_le_heros_d_un_autre(atelier, tablee):
    t, yuna, basile = tablee, tablee["yuna"]["id"], tablee["basile"]["id"]
    ouvrir_carnet(atelier)
    atelier.post(f"/api/joueurs/{yuna}/relier", json={"heros": t["velora"]["id"]})
    carnet_api.publier_carnet()
    # Hors de la compagnie (les héros de la tablée tels que la TV les montre, test_joueurs_et_tv.py), rien de l'autre.
    lu_basile, lu_yuki = t["coin_basile"].get("/api/carnet").json(), t["coin_yuki"].get("/api/carnet").json()
    vu_basile = json.dumps({k: v for k, v in lu_basile.items() if k != "compagnie"}, ensure_ascii=False)
    vu_yuki = json.dumps({k: v for k, v in lu_yuki.items() if k != "compagnie"}, ensure_ascii=False)
    assert "Tavarède Gué" in vu_basile and "Velora" not in vu_basile
    assert "Velora Dorvan" in vu_yuki and "Tavarède" not in vu_yuki
    assert {h["nom"]: h["moi"] for h in lu_basile["compagnie"]}["Velora Dorvan"] is False
    assert {h["nom"]: h["moi"] for h in lu_yuki["compagnie"]}["Velora Dorvan"] is True
    # Un héros n'a qu'un joueur, un joueur qu'un héros.
    r = atelier.post(f"/api/joueurs/{basile}/relier", json={"heros": t["velora"]["id"]})
    assert r.status_code == 409 and "Basile joue déjà Tavarède Gué" in r.json()["detail"]
    lea = atelier.post("/api/joueurs", json={"nom": "Léa"}).json()
    try:
        r = atelier.post(f"/api/joueurs/{lea['id']}/relier", json={"heros": t["velora"]["id"]})
        assert r.status_code == 409 and r.json()["detail"] == "Velora Dorvan est déjà reliée à Yuna."
        assert atelier.post(f"/api/joueurs/{lea['id']}/relier", json={"heros": t["tavarede"]["id"]}).status_code == 409
        # Ni un héros hors de la tablée, ni un sans nom, ni un identifiant tordu, ni un joueur inconnu.
        assert atelier.post(f"/api/joueurs/{lea['id']}/relier", json={"heros": t["hors"]["id"]}).status_code == 404
        assert atelier.post(f"/api/joueurs/{lea['id']}/relier", json={"heros": t["sans_nom"]["id"]}).status_code == 409
        for tordu in ("../aventurier", "", None, 3, ["x"]):
            assert atelier.post(f"/api/joueurs/{lea['id']}/relier", json={"heros": tordu}).status_code == 400, tordu
        assert atelier.post("/api/joueurs/inconnu/relier", json={"heros": t["velora"]["id"]}).status_code == 404
        # Accueillir pour un joueur déjà relié ne créerait qu'un double : refusé.
        assert atelier.post(f"/api/joueurs/{yuna}/accueillir").status_code in (404, 409)
    finally:
        atelier.delete(f"/api/joueurs/{lea['id']}")


def test_defaire_le_lien(atelier, tablee):
    t, yuna = tablee, tablee["yuna"]["id"]
    ouvrir_carnet(atelier)
    atelier.post(f"/api/joueurs/{yuna}/relier", json={"heros": t["velora"]["id"]})
    r = atelier.delete(f"/api/joueurs/{yuna}/relier")
    assert r.status_code == 200 and r.json()["etat"] == "invite" and r.json()["relie"] is False and r.json()["heros"] is None
    assert t["coin_yuki"].get("/api/carnet").json()["heros"] is None
    assert t["coin_yuki"].get("/api/moi").json()["accueilli"] is False
    assert "relie" not in next(j for j in json.loads((config.PROPOSITIONS / ".acces.json").read_text(encoding="utf-8"))["joueurs"] if j["id"] == yuna)
    assert atelier.delete(f"/api/joueurs/{yuna}/relier").status_code == 404
    assert any(x["id"] == t["velora"]["id"] for x in atelier.get("/api/carnet-joueurs").json()["sans_lien"])
    # Relié de nouveau (l'« Annuler » de l'atelier), puis hors de la tablée : plus de fiche, et pas d'autre héros à la place.
    atelier.post(f"/api/joueurs/{yuna}/relier", json={"heros": t["velora"]["id"]})
    atelier.patch(f"/api/aventuriers/{t['velora']['id']}", json={"tablee": False})
    try:
        carnet_api.publier_carnet()
        assert t["coin_yuki"].get("/api/carnet").json()["heros"] is None
    finally:
        atelier.patch(f"/api/aventuriers/{t['velora']['id']}", json={"tablee": True})
        atelier.delete(f"/api/joueurs/{yuna}/relier")


def test_le_lien_pose_dans_l_atelier_passe_avant_l_accueil():
    """La règle elle-même : au moindre doute, personne ne lit le héros."""
    x = {"id": "x", "nom": "X", "source": "joueur:a", "cree": "2026-10-01T10:00:00.000"}
    y = {"id": "y", "nom": "Y", "tablee": False, "cree": "2026-10-02T10:00:00.000"}
    aventuriers = {"x": x, "y": y}
    liens = liens_joueurs.heros_des_joueurs
    vers = lambda ident, h: {"id": ident, "heros": h["id"], "heros_cree": h["cree"]}  # noqa: E731
    assert liens([{"id": "a"}], {"a": "x"}, aventuriers) == {"a": x}
    # Relié à b : a, qui l'avait envoyé, ne le lit plus.
    assert liens([{"id": "a"}, vers("b", x)], {"a": "x"}, aventuriers) == {"b": x}
    # Deux joueurs reliés au même héros (fichier retouché à la main) : ni l'un ni l'autre.
    assert liens([vers("b", x), vers("c", x)], {}, aventuriers) == {}
    # Relié à un héros hors de la tablée : rien, et surtout pas son ancien héros accueilli à la place.
    assert liens([{"id": "a", "heros": "y", "heros_cree": y["cree"]}], {"a": "x"}, aventuriers) == {}
    # La proposition seule ne suffit pas : la fiche doit porter la source du joueur.
    assert liens([{"id": "b"}], {"b": "x"}, aventuriers) == {}
    assert liens([{"id": "b", "heros": "../x"}], {}, aventuriers) == {}
    # Un lien sans empreinte, ou dont l'empreinte n'est plus celle de la fiche (une autre venue sous son identifiant) :
    # personne ne la lit, et le joueur qui l'avait envoyée la garde.
    assert liens([{"id": "b", "heros": "x"}], {}, aventuriers) == {}
    assert liens([{"id": "a"}, {"id": "b", "heros": "x", "heros_cree": "2026-09-01T10:00:00.000"}], {"a": "x"}, aventuriers) == {"a": x}


def test_un_lien_ne_passe_pas_a_la_fiche_qui_reprend_l_identifiant(atelier, tablee):
    """Le héros relié part à la corbeille ; une fiche nouvelle prend plus tard son identifiant (même nom recréé, ou un
    aventurier commencé sans nom après une Velora « aventurier ») : le joueur ne la lit pas et ne commande pas pour elle.
    Remis de la corbeille, le vrai héros retrouve son joueur."""
    t, yuna = tablee, tablee["yuna"]["id"]
    ouvrir_carnet(atelier)
    gaspard = atelier.post("/api/aventuriers", json={"nom": "Gaspard Reprise", "tablee": True, "histoire": "HISTOIRE-DU-PREMIER"}).json()
    try:
        assert atelier.post(f"/api/joueurs/{yuna}/relier", json={"heros": gaspard["id"]}).status_code == 200
        assert t["coin_yuki"].get("/api/carnet").json()["heros"]["histoire"] == "HISTOIRE-DU-PREMIER"
        # Jeté par erreur puis « Annuler » : remis tel quel, il garde son joueur.
        atelier.delete(f"/api/aventuriers/{gaspard['id']}")
        carnet_api.publier_carnet()
        assert t["coin_yuki"].get("/api/carnet").json()["heros"] is None
        assert atelier.post(f"/api/corbeille/aventuriers/{gaspard['id']}/annuler").status_code == 200
        carnet_api.publier_carnet()
        assert t["coin_yuki"].get("/api/carnet").json()["heros"]["histoire"] == "HISTOIRE-DU-PREMIER"
        # Jeté pour de bon, puis une autre fiche sous le même identifiant.
        atelier.delete(f"/api/aventuriers/{gaspard['id']}")
        autre = atelier.post("/api/aventuriers", json={"nom": "Gaspard Reprise", "tablee": True, "histoire": "HISTOIRE-D-UN-AUTRE",
                                                       **{"or": 50}}).json()
        assert autre["id"] == gaspard["id"] and autre["cree"] != gaspard["cree"]
        carnet_api.publier_carnet()
        assert t["coin_yuki"].get("/api/carnet").json()["heros"] is None
        assert "HISTOIRE-D-UN-AUTRE" not in "".join(f.read_text(encoding="utf-8") for f in CARNET.rglob("*.json"))
        assert commander(t["coin_yuki"], t).status_code == 409
        carte = next(j for j in atelier.get("/api/joueurs").json() if j["id"] == yuna)
        assert carte["etat"] == "relie-perdu" and carte["relie"] is True and carte["heros"] is None and carte["aventurier"] == ""
        assert carte["accueilli"] is None
        # Le coin des joueurs n'apprend pas le nom de l'autre fiche, même quand .acces.json se réécrit.
        atelier.post("/api/joueurs", json={"nom": "Réécriture"})
        assert next(j for j in json.loads((config.PROPOSITIONS / ".acces.json").read_text(encoding="utf-8"))["joueurs"]
                    if j["id"] == yuna)["relie"]["nom"] == ""
        # L'autre fiche reste libre : le carnet la signale sans lien, un autre joueur peut la recevoir.
        assert any(x["id"] == autre["id"] for x in atelier.get("/api/carnet-joueurs").json()["sans_lien"])
    finally:
        atelier.delete(f"/api/joueurs/{yuna}/relier")
        atelier.delete(f"/api/aventuriers/{gaspard['id']}")
        for j in atelier.get("/api/joueurs").json():
            if j["nom"] == "Réécriture":
                atelier.delete(f"/api/joueurs/{j['id']}")
        carnet_api.publier_carnet()


def test_la_fiche_entiere_passe_a_la_detection_des_noms_inconnus(atelier, tablee):
    """Pas seulement le récit : un conseil, un thème, une note d'arme, un don, une ligne du sac qui nomment un inconnu
    s'en vont ; le peuple caché d'un autre aventurier aussi. Le sien reste."""
    t = tablee
    ouvrir_carnet(atelier)
    tavarede = t["tavarede"]["id"]
    sylvain = atelier.post("/api/pnj", json={"nom": "Sylvestre Brumeval", "connu": False}).json()
    autre = atelier.post("/api/aventuriers", json={"nom": "Odon Cachefeu", "tablee": False, "peuple": "Fils des Cendres", "peuple_cache": True}).json()
    atelier.patch(f"/api/aventuriers/{tavarede}", json={
        "peuple": "Ondin des Gués", "peuple_cache": True, "conseils": ["Méfiez-vous de Sylvestre Brumeval.", "Parlez le premier."],
        "themes": ["La dette envers Sylvestre Brumeval", "Le fleuve"], "langues": "Commun, et le patois des Ondin des Gués",
        "armes": [{"nom": "Dague", "competence": "Lames", "degats": "1D4", "notes": "Volée à Sylvestre Brumeval"}],
        "dons": [{"nom": "Le souffle", "cout": "2", "effet": "Comme le lui apprit Sylvestre Brumeval.", "cree": True}],
        "equipement": ["Corde", "Lettre pour Sylvestre Brumeval"], "lien": "Il sait qu'Odon est un Fils des Cendres."})
    try:
        carnet_api.publier_carnet()
        fiche = t["coin_basile"].get("/api/carnet").json()["heros"]
        brut = json.dumps(fiche, ensure_ascii=False)
        assert "Sylvestre" not in brut and "Brumeval" not in brut and "Fils des Cendres" not in brut
        assert fiche["conseils"] == ["Parlez le premier."] and fiche["themes"] == ["Le fleuve"] and fiche["equipement"] == ["Corde"]
        assert fiche["armes"] == [{"nom": "Dague", "competence": "Lames", "degats": "1D4", "notes": ""}]
        assert fiche["dons"][0]["nom"] == "Le souffle" and fiche["dons"][0]["effet"] == "" and fiche["lien"] == ""
        # Son propre peuple caché n'est pas un secret pour lui.
        assert fiche["peuple"] == "Ondin des Gués" and fiche["langues"] == "Commun, et le patois des Ondin des Gués"
        assert any(x.startswith("Le héros « Tavarède Gué » : une partie de sa fiche est retenue, elle nomme ")
                   and "Sylvestre Brumeval" in x and "Fils des Cendres" in x for x in atelier.get("/api/carnet-joueurs").json()["retenus"])
    finally:
        atelier.patch(f"/api/aventuriers/{tavarede}", json={"peuple": "", "peuple_cache": False, "conseils": [], "themes": [], "langues": "",
                                                             "armes": [], "dons": [], "equipement": [], "lien": ""})
        atelier.delete(f"/api/pnj/{sylvain['id']}")
        atelier.delete(f"/api/aventuriers/{autre['id']}")
        carnet_api.publier_carnet()


def test_les_routes_du_lien_restent_fermees_a_la_table_publique(atelier, tablee):
    yuna = tablee["yuna"]["id"]
    assert atelier.post(f"/api/joueurs/{yuna}/relier", json={"heros": tablee["velora"]["id"]}, headers=CF).status_code == 404
    assert atelier.delete(f"/api/joueurs/{yuna}/relier", headers=CF).status_code == 404
    assert atelier.get("/api/carnet-joueurs", headers=CF).status_code == 404
    assert atelier.get("/api/joueurs").json() and next(j for j in atelier.get("/api/joueurs").json() if j["id"] == yuna)["relie"] is False


def test_le_lien_d_un_joueur_accueilli_ouvre_le_carnet(atelier, tablee):
    t = tablee
    basile = t["basile"]
    anonyme = TestClient(joueurs.app)
    ouvrir_carnet(atelier, False)
    assert entrer(anonyme, basile) == "/"
    ouvrir_carnet(atelier)
    assert entrer(anonyme, basile) == "/carnet#heros"
    moi = anonyme.get("/api/moi").json()
    assert moi["accueilli"] is True and moi["carnet"] is True and moi["heros"] == {"nom": "Tavarède Gué", "genre": ""}
    # Le créateur ne s'écrit plus : rien ne se perd sans qu'il le sache (refus explicite).
    assert anonyme.put("/api/moi/aventurier", json={"nom": "Autre"}).status_code == 423
    # Un joueur qui n'a pas encore de héros arrive toujours sur son créateur.
    assert entrer(TestClient(joueurs.app), t["yuna"]) == "/"


def test_le_carnet_lit_le_texte_ecrit_pour_lui(atelier, tablee):
    ouvrir_carnet(atelier)
    grange = atelier.post("/api/lieux", json={"nom": "La Grange-aux-Loups", "type": "ruine", "connu": False}).json()
    seance = atelier.post("/api/seances", json={"nom": "La nuit des loups", "numero": 7, "close": True, "date": "2026-11-07",
                                                "precedemment": "Ils ont fui la Grange-aux-Loups."}).json()
    try:
        carnet_api.publier_carnet()
        chroniques = lambda: [x for x in carnet.lire_publie(CARNET / "precedemment.json")["elements"] if x["numero"] == 7]
        assert chroniques() == []
        retenus = atelier.get("/api/carnet-joueurs").json()["retenus"]
        assert ("Le « Précédemment » de la séance 7 : absent du carnet, il nomme La Grange-aux-Loups (lieu inconnu des joueurs)."
                in retenus)
        # Le texte écrit pour le carnet passe à sa place, masqué comme le reste.
        atelier.patch(f"/api/seances/{seance['id']}", json={"precedemment_carnet": "Ils ont fui une ferme, puis dormi à la Petite Fanfrelée."})
        carnet_api.publier_carnet()
        assert [x["texte"] for x in chroniques()] == ["Ils ont fui une ferme, puis dormi à l'auberge."]
        assert not any("séance 7" in x for x in atelier.get("/api/carnet-joueurs").json()["retenus"])
        # Le texte du carnet passe à la même vérification des noms inconnus.
        atelier.patch(f"/api/seances/{seance['id']}", json={"precedemment_carnet": "La Grange-aux-Loups brûle encore."})
        carnet_api.publier_carnet()
        assert chroniques() == [] and "Grange" not in "".join(f.read_text(encoding="utf-8") for f in CARNET.rglob("*.json"))
        assert any(x.startswith("Le texte pour le carnet de la séance 7 : absent du carnet")
                   for x in atelier.get("/api/carnet-joueurs").json()["retenus"])
        # Sans ce texte, rien ne change : le « Précédemment » repasse, dès que le lieu est connu.
        atelier.patch(f"/api/seances/{seance['id']}", json={"precedemment_carnet": ""})
        atelier.patch(f"/api/lieux/{grange['id']}", json={"connu": True})
        carnet_api.publier_carnet()
        assert [x["texte"] for x in chroniques()] == ["Ils ont fui la Grange-aux-Loups."]
    finally:
        atelier.delete(f"/api/seances/{seance['id']}")
        atelier.delete(f"/api/lieux/{grange['id']}")
        carnet_api.publier_carnet()


def test_mon_heros_est_complet_et_ne_dit_rien_du_mj(atelier, tablee):
    t = tablee
    ouvrir_carnet(atelier)
    valentine = atelier.post("/api/pnj", json={"nom": "Valentine Ombrebois", "connu": False}).json()
    tavarede = t["tavarede"]["id"]
    atelier.patch(f"/api/aventuriers/{tavarede}", json={
        "genre": "h", "peuple": "Demi-élémentaire", "peuple_cache": True, "element": "Air", "posture": "focus",
        "posture_elementaire": "Il vole.", "themes": ["Le vent", ""], "conseils": ["Restez en retrait."],
        "dons": [{"nom": "Vision dans le noir", "valide_mj": True}, {"nom": "Le souffle", "cout": "2", "effet": "Un mur d'air.", "cree": True,
                                                                       "ameliore": "coûte 1 de moins"}],
        "histoire": "Né sur un bac du Gué.", "allure": "Grand.", "defaut": "Bavard.", "lien": "Doit une dette à Velora.",
        "lien_avec": t["velora"]["id"], "contacts": "Valentine Ombrebois, qui le cherche.", "particularites": "Ses yeux changent.",
        "secret": "SECRET-TAVAREDE", "notes_mj": "NOTE-TAVAREDE",
        "progression": [{"niveau": 2, "date": "2026-11-01T10:00:00", "texte": "+3", "avant": {"secret": "SECRET-AVANT"}}]})
    atelier.patch(f"/api/etats-heros/{tavarede}", json={"sante": 5, "notes": "NOTE-ETAT"})
    try:
        carnet_api.publier_carnet()
        fichier = CARNET / carnet.HEROS / f"{carnet.cle_heros(joueurs.empreinte(jeton_de(t['basile'])))}.json"
        brut = fichier.read_text(encoding="utf-8")
        for interdit in ("SECRET-", "NOTE-", "valide_mj", "progression", "secrete", "Valentine", '"notes"', "notes_mj", "illustrations"):
            assert interdit not in brut, interdit
        fiche = t["coin_basile"].get("/api/carnet").json()["heros"]
        assert set(fiche) <= CLES_DE_LA_FICHE, set(fiche) - CLES_DE_LA_FICHE
        # Ce qui lui sert entre deux séances : dons (le kit donne coût et effet à la page), posture, thèmes, histoire, liens.
        assert fiche["dons"] == [{"nom": "Vision dans le noir", "cout": None, "effet": None, "cree": False, "ameliore": ""},
                                 {"nom": "Le souffle", "cout": "2", "effet": "Un mur d'air.", "cree": True, "ameliore": "coûte 1 de moins"}]
        assert (fiche["posture"], fiche["posture_elementaire"], fiche["themes"], fiche["conseils"]) == ("focus", "Il vole.", ["Le vent"], ["Restez en retrait."])
        assert fiche["histoire"] == "Né sur un bac du Gué." and fiche["lien_avec"] == "Velora Dorvan" and fiche["lien"] == "Doit une dette à Velora."
        # Son propre peuple, gardé secret pour la table, n'est pas un secret pour lui ; le PNJ inconnu de ses contacts, si.
        assert fiche["peuple"] == "Demi-élémentaire" and fiche["particularites"] == "Ses yeux changent."
        assert fiche["contacts"] == "" and fiche["sante"] == 5
        assert ("Le héros « Tavarède Gué » : une partie de son histoire est retenue, elle nomme Valentine Ombrebois (personnage inconnu "
                "des joueurs).") in atelier.get("/api/carnet-joueurs").json()["retenus"]
    finally:
        atelier.delete(f"/api/pnj/{valentine['id']}")
        atelier.patch(f"/api/aventuriers/{tavarede}", json={"secret": "", "notes_mj": "", "progression": []})
        carnet_api.publier_carnet()
