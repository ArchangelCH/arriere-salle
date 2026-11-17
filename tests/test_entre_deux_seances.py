"""Entre deux séances, le coin des joueurs dit vrai : la prochaine séance et les couleurs prises, publiées carnet fermé
comme ouvert (coin.json, sans rien d'autre) ; « X a rejoint la tablée » seulement si c'est vrai, et le refus d'écrire
dit « confié » pour un héros relié ; les personnages et les lieux croisés en jouant, sans nommer un inconnu ; l'aperçu
du MJ (« Voir comme Léa ») montre au MJ exactement ce que lit ce joueur, sans rien écrire, et reste fermé à la table
publique comme au coin des joueurs."""
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
from commun import portraits  # noqa: E402
from comptes_coin import entrer, jeton_de  # noqa: E402
import main  # noqa: E402
from api import actions_coin, application, carnet_api, config, tv_etat  # noqa: E402

CARNET = config.PROPOSITIONS / carnet.CARNET
CF = {"CF-Connecting-IP": "203.0.113.7"}



def ouvrir_carnet(atelier, ouvert=True):
    assert atelier.put("/api/carnet-joueurs", json={"ouvert": ouvert}).json()["ouvert"] is ouvert


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


@pytest.fixture(scope="module")
def monde(atelier, coin_pour):
    """Lou, accueillie depuis son lien avec Aube ; Max, relié à Brune, créée dans l'atelier ; une séance close avec ses
    PNJ et ses lieux, dont un inconnu ; une séance à venir. Tout est retiré à la fin."""
    crees = []

    def creer(collection, **fiche):
        f = atelier.post(f"/api/{collection}", json=fiche).json()
        crees.append((collection, f["id"]))
        return f

    m = {
        "moulin": creer("lieux", nom="Le Moulin Ventru", type="point", connu=True),
        "auberge": creer("lieux", nom="La Petite Fanfrelée", type="auberge", connu=True),
        "repaire": creer("lieux", nom="Le Repaire-Écarlate", type="ruine", connu=False),
        "loin": creer("lieux", nom="Les Tours Lointaines", type="ville", connu=True),
        "meunier": creer("pnj", nom="Gaspard Farinier", role="meunier", connu=True),
        "hote": creer("pnj", nom="Hortense Pot-au-Feu", role="aubergiste", connu=True),
        "chef": creer("pnj", nom="Rufin Sanglier", role="chef de bande", connu=True),
        "lointain": creer("pnj", nom="Dame Ombeline", role="duchesse", connu=True),
        "brune": creer("aventuriers", nom="Brune Haute-Forge", genre="f", joueur="Max", tablee=True, couleur="#3f8f4a",
                       secret="SECRET-BRUNE", notes_mj="NOTE-BRUNE"),
    }
    atelier.patch(f"/api/pnj/{m['meunier']['id']}", json={"lieu": m["moulin"]["id"]})
    atelier.patch(f"/api/pnj/{m['hote']['id']}", json={"lieu": m["auberge"]["id"]})
    atelier.patch(f"/api/pnj/{m['chef']['id']}", json={"lieu": m["repaire"]["id"]})
    m["close"] = creer("seances", nom="La farine et le sang", numero=9, close=True, date="2026-10-31",
                       pnj=[m["meunier"]["id"], m["hote"]["id"], m["chef"]["id"]],
                       lieux=[m["moulin"]["id"], m["auberge"]["id"], m["repaire"]["id"]])
    m["avenir"] = creer("seances", nom="Prochaine", numero=10, close=False, date="2099-03-14", heure="20:30")
    lou = atelier.post("/api/joueurs", json={"nom": "Lou"}).json()
    coin_lou = coin_pour(lou)
    coin_lou.post("/api/moi/aventurier", json={"nom": "Aube Clairvent", "genre": "f", "couleur": "#c9a227"})
    coin_lou.post("/api/moi/envoyer")
    m["aube"] = atelier.post(f"/api/joueurs/{lou['id']}/accueillir").json()
    crees.append(("aventuriers", m["aube"]["id"]))
    max_ = atelier.post("/api/joueurs", json={"nom": "Max"}).json()
    assert atelier.post(f"/api/joueurs/{max_['id']}/relier", json={"heros": m["brune"]["id"]}).status_code == 200
    m.update(lou=lou, coin_lou=coin_lou, max=max_, coin_max=coin_pour(max_))
    carnet_api.publier_carnet()
    yield m
    ouvrir_carnet(atelier, False)
    for j in (lou, max_):
        atelier.delete(f"/api/joueurs/{j['id']}")
    for collection, ident in reversed(crees):
        atelier.delete(f"/api/{collection}/{ident}")
    carnet_api.publier_carnet()


def test_ce_que_le_coin_sait_toujours(atelier, monde):
    ouvrir_carnet(atelier, False)
    carnet_api.publier_carnet()
    coin = json.loads((CARNET / "coin.json").read_text(encoding="utf-8"))
    # La date de la table publique fermée, rien d'autre de la séance.
    assert coin["prochaine"] == tv_etat.prochaine_seance() and "Prochaine" not in coin["prochaine"]
    assert {"#c9a227", "#3f8f4a"} <= set(coin["couleurs"])
    # Les héros présents, par la clé du lien de leur joueur : ni identifiant, ni joueur, ni rien du MJ.
    noms = {e["nom"] for e in coin["elements"]}
    assert {"Aube Clairvent", "Brune Haute-Forge"} <= noms
    brut = json.dumps(coin, ensure_ascii=False)
    for interdit in ("SECRET-", "NOTE-", monde["brune"]["id"], monde["aube"]["id"], jeton_de(monde["lou"]), "Lou", "Max"):
        assert interdit not in brut, interdit
    # Carnet fermé : chaque joueur lit sa date et les couleurs prises, rien de plus.
    moi = monde["coin_lou"].get("/api/moi").json()
    assert moi["prochaine"] == coin["prochaine"] and "#3f8f4a" in moi["couleurs_prises"]
    assert moi["present"] is True and moi["heros"] == {"nom": "Aube Clairvent", "genre": "f"} and moi["relie"] is False
    assert monde["coin_lou"].get("/api/carnet").json() == {"ouvert": False, "prochaine": coin["prochaine"]}


def test_le_coin_ne_dit_rejoint_la_tablee_que_si_c_est_vrai(atelier, monde):
    ouvrir_carnet(atelier)
    lou, aube = monde["coin_lou"], monde["aube"]["id"]
    # Mise de côté par le MJ : le coin le sait, le lien ne mène plus à une fiche vide, le carnet le dit.
    atelier.patch(f"/api/aventuriers/{aube}", json={"tablee": False})
    try:
        carnet_api.publier_carnet()
        moi = lou.get("/api/moi").json()
        assert moi["accueilli"] is True and moi["present"] is False and moi["heros"]["nom"] == "Aube Clairvent"
        assert entrer(TestClient(joueurs.app), monde["lou"]) == "/"
        lu = lou.get("/api/carnet").json()
        assert lu["heros"] is None and lu["absent"] == {"nom": "Aube Clairvent", "genre": "f"}
    finally:
        atelier.patch(f"/api/aventuriers/{aube}", json={"tablee": True})
        carnet_api.publier_carnet()
    assert lou.get("/api/moi").json()["present"] is True
    assert lou.get("/api/carnet").json()["absent"] is None
    # Reliée puis jetée à la corbeille : plus « présente » non plus, et Max l'apprend.
    atelier.delete(f"/api/aventuriers/{monde['brune']['id']}")
    try:
        carnet_api.publier_carnet()
        assert monde["coin_max"].get("/api/moi").json()["present"] is False
    finally:
        atelier.post(f"/api/corbeille/aventuriers/{monde['brune']['id']}/annuler")
        carnet_api.publier_carnet()
    assert monde["coin_max"].get("/api/moi").json()["present"] is True


def test_le_refus_dit_confie_pour_un_heros_relie(atelier, monde):
    max_ = monde["coin_max"]
    for r in (max_.post("/api/moi/aventurier", json={"nom": "Un autre"}), max_.post("/api/moi/envoyer")):
        assert r.status_code in (404, 423)
    r = max_.post("/api/moi/aventurier", json={"nom": "Un autre"})
    assert r.status_code == 423 and r.json()["detail"] == "Votre MJ vous a confié Brune Haute-Forge : la suite se fait avec lui."
    assert "accueilli" not in r.json()["detail"]
    r = monde["coin_lou"].put("/api/moi/aventurier", json={"nom": "Autre"})
    assert r.status_code == 423 and "accueilli" in r.json()["detail"]
    assert max_.get("/api/moi").json()["relie"] is True


def test_les_personnages_et_les_lieux_croises_en_jouant(atelier, monde):
    ouvrir_carnet(atelier)
    carnet_api.publier_carnet()
    lu = monde["coin_lou"].get("/api/carnet").json()
    pnj = {p["nom"]: p for p in lu["personnages"]}
    assert pnj["Gaspard Farinier"]["croise"] is True and pnj["Gaspard Farinier"]["seances"] == [9]
    assert pnj["Gaspard Farinier"]["rencontre"] == "Séance 9, au Moulin Ventru"
    # Le nom caché de l'auberge passe au masque ; un lieu inconnu n'est jamais nommé.
    assert pnj["Hortense Pot-au-Feu"]["rencontre"] == "Séance 9, à l'auberge"
    assert pnj["Rufin Sanglier"]["rencontre"] == "Séance 9"
    assert pnj["Dame Ombeline"]["croise"] is False and pnj["Dame Ombeline"]["rencontre"] == ""
    lieux = {x["nom"]: x for x in lu["lieux"]}
    assert lieux["Le Moulin Ventru"]["croise"] is True and lieux["Les Tours Lointaines"]["croise"] is False
    tout = "".join(f.read_text(encoding="utf-8") for f in CARNET.rglob("*.json"))
    assert "Repaire" not in tout and "Fanfrelée" not in tout


def test_une_rencontre_qui_nommerait_un_inconnu_est_retenue(atelier, monde):
    """Un lieu connu qui porte le nom entier d'un PNJ inconnu (le Moulin de Silas Brumeval, sans Silas) : la rencontre
    du meunier passe à la même détection que le reste du carnet."""
    ouvrir_carnet(atelier)
    moulin = monde["moulin"]["id"]
    inconnu = atelier.post("/api/pnj", json={"nom": "Silas Brumeval", "connu": False}).json()
    atelier.patch(f"/api/lieux/{moulin}", json={"nom": "Le Moulin de Silas Brumeval"})
    try:
        carnet_api.publier_carnet()
        meunier = next(p for p in monde["coin_lou"].get("/api/carnet").json()["personnages"] if p["nom"] == "Gaspard Farinier")
        assert meunier["rencontre"] == "" and meunier["croise"] is True
        assert any(x.startswith("Gaspard Farinier : rencontre retenue, elle nomme Silas Brumeval")
                   for x in atelier.get("/api/carnet-joueurs").json()["retenus"])
        assert "Silas" not in "".join(f.read_text(encoding="utf-8") for f in CARNET.rglob("*.json"))
    finally:
        atelier.patch(f"/api/lieux/{moulin}", json={"nom": "Le Moulin Ventru"})
        atelier.delete(f"/api/pnj/{inconnu['id']}")
        carnet_api.publier_carnet()


def instantane():
    return {str(f): (f.stat().st_mtime_ns, f.stat().st_size) for f in config.PROPOSITIONS.rglob("*") if f.is_file()}


class SansPublicationDeFond:
    """Le temps de comparer deux instantanés : les portraits publiés d'abord, puis la tâche de fond qui les
    republie chaque seconde tenue à l'écart. Sans cela, une publication tombait parfois entre les deux instantanés."""

    def __enter__(self):
        actions_coin.portraits_joueurs.publier()
        portraits.PUBLICATION.acquire()
        return self

    def __exit__(self, *_):
        portraits.PUBLICATION.release()


def sans_adresses(x):
    return json.loads(json.dumps(x).replace("/api/carnet-joueurs/media/", "/carnet/media/"))


def test_voir_comme_un_joueur_carnet_ouvert(atelier, monde):
    ouvrir_carnet(atelier)
    carnet_api.publier_carnet()
    with SansPublicationDeFond():
        avant = instantane()
        ap = atelier.get(f"/api/joueurs/{monde['lou']['id']}/apercu").json()
        # Rien ne s'écrit chez le joueur, ni ailleurs dans son dossier.
        assert instantane() == avant
    assert ap["joueur"] == "Lou" and ap["ouvert"] is True and ap["etat"] == "accueilli"
    # Exactement ce que lit Lou depuis son lien : son carnet, son échoppe.
    assert sans_adresses(ap["carnet"]) == monde["coin_lou"].get("/api/carnet").json()
    assert sans_adresses(ap["echoppe"]) == monde["coin_lou"].get("/api/echoppe").json()
    # Hors de la compagnie (les héros de la tablée tels que la TV les montre), rien du héros de l'autre.
    sans_compagnie = lambda x: json.dumps(x | {"carnet": {k: v for k, v in x["carnet"].items() if k != "compagnie"}}, ensure_ascii=False)  # noqa: E731
    brut = sans_compagnie(ap)
    assert "Aube Clairvent" in brut and "Brune" not in brut and "SECRET-" not in json.dumps(ap) and "NOTE-" not in json.dumps(ap)
    vu_max = sans_compagnie(atelier.get(f"/api/joueurs/{monde['max']['id']}/apercu").json())
    assert "Brune Haute-Forge" in vu_max and "Aube" not in vu_max


def test_voir_comme_un_joueur_carnet_ferme(atelier, monde):
    ouvrir_carnet(atelier, False)
    carnet_api.publier_carnet()
    with SansPublicationDeFond():
        avant = instantane()
        ap = atelier.get(f"/api/joueurs/{monde['max']['id']}/apercu").json()
        assert instantane() == avant
    # Ce qu'il lirait à l'ouverture, calculé sans être publié : le coin, lui, ne montre toujours rien.
    assert ap["ouvert"] is False and ap["carnet"]["heros"]["nom"] == "Brune Haute-Forge"
    assert any(p["nom"] == "Gaspard Farinier" for p in ap["carnet"]["personnages"])
    assert monde["coin_max"].get("/api/carnet").json()["ouvert"] is False
    assert sorted(f.name for f in CARNET.glob("*.json") if f.name != "regles.json") == ["coin.json", "sommaire.json"]
    brut = json.dumps(ap, ensure_ascii=False)
    for interdit in ("SECRET-", "NOTE-", "Repaire", "Fanfrelée"):
        assert interdit not in brut, interdit
    # Aube n'est que dans la compagnie, comme la TV la montre.
    assert "Aube" not in json.dumps(ap | {"carnet": {k: v for k, v in ap["carnet"].items() if k != "compagnie"}}, ensure_ascii=False)


def test_l_apercu_reste_a_l_atelier(atelier, monde, coin_pour):
    lou = monde["lou"]["id"]
    assert atelier.get(f"/api/joueurs/{lou}/apercu", headers=CF).status_code == 404
    assert atelier.get("/api/carnet-joueurs/media/0123456789abcdef01234567.jpg", headers=CF).status_code == 404
    assert atelier.get("/static/joueurs/apercu.html", headers=CF).status_code == 404
    assert atelier.get("/api/joueurs/inconnu/apercu").status_code == 404
    for tordu in ("../x.jpg", "x.png", "0123456789abcdef01234567.jpg"):
        assert atelier.get(f"/api/carnet-joueurs/media/{tordu}").status_code == 404
    # Le coin des joueurs ne sert ni la page ni le module de l'aperçu.
    coin = monde["coin_lou"]
    for chemin in ("/static/joueurs/apercu.html", "/static/js/joueurs/apercu.js", "/static/js/joueurs/etat-carnet.js",
                   f"/api/joueurs/{lou}/apercu", "/apercu"):
        assert coin.get(chemin).status_code == 404, chemin


def test_un_ancien_lien_mene_a_la_connexion(coin_pour, atelier):
    anonyme = TestClient(joueurs.app)
    sans = anonyme.get("/").text
    assert "Se connecter" in sans and "demandez à votre MJ votre identifiant et un mot de passe provisoire" in sans
    perime = anonyme.get("/?cle=un-lien-renouvele", follow_redirects=False)
    assert perime.status_code == 303 and perime.headers["location"] == "/connexion?lien=ancien" and "set-cookie" not in perime.headers
