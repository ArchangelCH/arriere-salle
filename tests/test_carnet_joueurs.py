"""Le carnet de la compagnie et les commandes des joueurs : l'atelier ne publie dans propositions/carnet/ que ce que les
joueurs ont le droit de savoir (ni secret, ni note du MJ, ni PNJ inconnu, ni illustration secrète, ni le nom de
l'auberge) ; le coin des joueurs ne sert que ce qui y est publié, à chacun sa fiche et ses commandes ; une commande ne
passe que pour un article visible, en stock, dans une boutique ouverte, aux quantités bornées."""
import json
import logging
import os
import re
import sys
import tempfile
import threading
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from commun import carnet  # noqa: E402
import joueurs  # noqa: E402
from comptes_coin import entrer, jeton_de  # noqa: E402
import main  # noqa: E402
from api import application, carnet_api, config, tv_cartes  # noqa: E402

CARNET = config.PROPOSITIONS / carnet.CARNET
# Ce qui ne doit jamais atteindre le carnet, quel que soit le fichier.
INTERDITS = ("SECRET-", "NOTE-", "Silas", "Grange", "anfrel", "ne dort", "RESUME-MJ", "PREC-NON-CLOSE", "VERITE-",
             "COMMANDITAIRE", "RUMEUR-A-PLACER", "CONTRAT-AFFICHE", "ARTICLE-CACHE", "BOUTIQUE-FERMEE", '"/media/',
             '"secret"', '"notes_mj"', '"note_mj"', '"stock"', '"verite"', '"cache"')



def image(nom, couleur):
    Image.new("RGB", (60, 90), couleur).save(config.IMAGES / nom)
    return f"/media/{nom}"


def texte_du_carnet() -> str:
    return "\n".join(f.read_text(encoding="utf-8") for f in sorted(CARNET.rglob("*.json")))


def ouvrir_carnet(atelier, ouvert=True):
    assert atelier.put("/api/carnet-joueurs", json={"ouvert": ouvert}).json()["ouvert"] is ouvert


@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture(scope="module")
def coin_pour():
    """Un client du coin des joueurs par lien (chacun ses cookies), branché sur le dossier des propositions."""
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
    """Deux joueurs accueillis dans la tablée, des PNJ et des lieux connus ou non, une séance close et une ouverte, des
    contrats, des rumeurs, une boutique ouverte aux joueurs et une fermée. Tout est retiré à la fin."""
    crees = []

    def creer(collection, **fiche):
        f = atelier.post(f"/api/{collection}", json=fiche).json()
        crees.append((collection, f["id"]))
        return f

    secret_bran, portrait_bran = image("secret-bran.png", (200, 20, 20)), image("portrait-bran.png", (20, 190, 40))
    m = {
        "bran": creer("pnj", nom="Bran le Borgne", surnom="l'Œil", role="Passeur", peuple="Humain", apparence="Un bandeau de cuir.",
                      connu=True, secret="SECRET-BRAN", notes_mj="NOTE-BRAN", envie="SECRET-ENVIE", illustration=secret_bran,
                      illustrations=[{"url": secret_bran, "secrete": True, "prompt": "SECRET-PROMPT"}, {"url": portrait_bran, "prompt": "NOTE-PROMPT"}]),
        "silas": creer("pnj", nom="Silas l'Ombre", connu=False, illustrations=[{"url": image("silas.png", (0, 0, 200))}]),
        "pont": creer("lieux", nom="Le Pont-aux-Roseaux", type="village", connu=True, resume="On y dort à la Petite Fanfrelée.",
                      secrets="SECRET-PONT", illustrations=[{"url": image("pont.png", (90, 90, 90))}]),
        "grange": creer("lieux", nom="La Grange-Écarlate", type="ruine", connu=False, resume="SECRET-GRANGE"),
        "close": creer("seances", nom="La première", numero=1, close=True, date="2026-11-01", resume="RESUME-MJ",
                       precedemment="Ils ont dormi à la Petite Fanfrelée.\nBran les attendait au pont.", lieux=[], notes="NOTE-SEANCE"),
        "ouverte": creer("seances", nom="La suivante", numero=2, close=False, precedemment="PREC-NON-CLOSE"),
        "pris": creer("contrats", nom="Escorte d'une caravane de sel", etat="pris", affiche="Escorter une caravane.", recompense="20 po par tête",
                      verite="VERITE-CONTRAT", commanditaire="COMMANDITAIRE"),
        "affiche": creer("contrats", nom="CONTRAT-AFFICHE", etat="affiche"),
        "entendue": creer("rumeurs", texte="Les loups sont revenus.", source="un bûcheron", etat="entendue", verite="VERITE-RUMEUR"),
        "a-placer": creer("rumeurs", texte="RUMEUR-A-PLACER", etat="a-placer"),
    }
    atelier.patch(f"/api/seances/{m['close']['id']}", json={"lieux": [m["pont"]["id"], m["grange"]["id"]]})
    article = lambda ident, nom, prix, **x: {"id": ident, "nom": nom, "prix": prix, "categorie": "Équipement", "description": "",
                                             "note_mj": "NOTE-ARTICLE", "stock": None, "cache": False, **x}
    m["echoppe"] = creer("boutiques", nom="Chez Bran", accroche="Tout pour la route.", marchand=m["bran"]["id"], ajustement=0,
                         notes_mj="NOTE-BOUTIQUE", ouverte_joueurs=True, articles=[
                             article("torche1", "Torche", "1"), article("corde1", "Corde", "4", stock=3),
                             article("cache1", "ARTICLE-CACHE", "1", cache=True), article("vide1", "Lanterne", "6", stock=0),
                             article("gemme1", "Gemme brute", "à partir de 150"), article("epee1", "Épée", "25")])
    m["fermee"] = creer("boutiques", nom="BOUTIQUE-FERMEE", ouverte_joueurs=False, articles=[article("x1", "Dague", "3")])
    for cle_joueur, nom, heros in (("a", "Aube", "Ysolde Gris"), ("b", "Basile", "Tavarède Lavelle")):
        invite = atelier.post("/api/joueurs", json={"nom": nom}).json()
        coin = coin_pour(invite)
        coin.post("/api/moi/aventurier", json={"nom": heros, "sante": 9, "psy": 5, "physique": 60, "social": 45, "mental": 55,
                                               "competences": [{"nom": "Lames", "bonus": 15, "avec": "Physique"}],
                                               "equipement": ["Cape"], "objets": ["Un harmonica", "", ""], "or": 30})
        coin.post("/api/moi/envoyer")
        fiche = atelier.post(f"/api/joueurs/{invite['id']}/accueillir").json()
        crees.append(("aventuriers", fiche["id"]))
        m[cle_joueur] = {"joueur": invite, "coin": coin, "heros": fiche}
    atelier.patch(f"/api/aventuriers/{m['a']['heros']['id']}", json={"secret": "SECRET-HEROS", "notes_mj": "NOTE-HEROS"})
    atelier.patch(f"/api/etats-heros/{m['a']['heros']['id']}", json={"sante": 4, "notes": "NOTE-ETAT", "cartons": {"physique": "jaune"}})
    yield m
    ouvrir_carnet(atelier, False)
    carnet_api.publier_carnet()
    for x in ("a", "b"):
        atelier.delete(f"/api/joueurs/{m[x]['joueur']['id']}")
    for collection, ident in crees:
        atelier.delete(f"/api/{collection}/{ident}")


def test_ferme_le_carnet_ne_montre_rien(atelier, monde):
    ouvrir_carnet(atelier, False)
    carnet_api.publier_carnet()
    assert json.loads((CARNET / "sommaire.json").read_text(encoding="utf-8"))["ouvert"] is False
    # Fermé, il ne reste que le sommaire qui le dit, et ce que le coin sait toujours : la date de la prochaine séance,
    # les couleurs de la tablée, les héros qui y sont (par la clé du lien de leur joueur).
    assert sorted(f.name for f in CARNET.rglob("*") if f.is_file()) == ["coin.json", "sommaire.json"]
    su = json.loads((CARNET / "coin.json").read_text(encoding="utf-8"))
    assert set(su) == {"maj", "prochaine", "couleurs", "elements"}
    assert all(set(x) == {"cle", "nom", "genre"} for x in su["elements"])
    coin = monde["a"]["coin"]
    assert coin.get("/api/carnet").json() == {"ouvert": False, "prochaine": su["prochaine"]}
    assert coin.get("/api/echoppe").json() == {"ouvert": False}
    r = coin.post("/api/commandes", json={"boutique": tv_cartes.jeton("boutiques", monde["echoppe"]["id"]), "lignes": [{"article": "torche1", "quantite": 1}]})
    assert r.status_code == 423
    assert "Le carnet" in coin.get("/carnet").text


def test_rien_du_mj_dans_le_carnet(atelier, monde):
    ouvrir_carnet(atelier)
    carnet_api.publier_carnet()
    tout = texte_du_carnet()
    for interdit in INTERDITS:
        assert interdit not in tout, interdit
    # Les noms de fichiers non plus ne disent rien : des clés et des empreintes.
    for f in CARNET.rglob("*"):
        assert re.fullmatch(r"[a-z]+\.json|[a-f0-9]{32}\.json|[a-f0-9]{24}\.jpg|heros|media", f.name), f.name
    personnages = {p["nom"]: p for p in carnet.lire_publie(CARNET / "personnages.json")["elements"]}
    bran = personnages["Bran le Borgne"]
    assert bran["surnom"] == "l'Œil" and bran["role"] == "Passeur" and bran["apparence"] == "Un bandeau de cuir."
    # Le portrait recopié est le public (vert), jamais l'illustration secrète (rouge).
    miniature = CARNET / "media" / carnet.ADRESSE_MEDIA.match(bran["illustration"]).group(1)
    with Image.open(miniature) as im:
        r, v, b = im.convert("RGB").resize((1, 1)).getpixel((0, 0))
    assert v > 150 and r < 60
    lieux = {lieu["nom"]: lieu for lieu in carnet.lire_publie(CARNET / "lieux.json")["elements"]}
    assert lieux["Le Pont-aux-Roseaux"]["resume"] == "On y dort à l'auberge." and lieux["Le Pont-aux-Roseaux"]["type"] == "village"
    prec = carnet.lire_publie(CARNET / "precedemment.json")["elements"]
    seance = next(s for s in prec if s["numero"] == 1)
    assert seance["texte"] == "Ils ont dormi à l'auberge.\nBran les attendait au pont." and seance["date"] == "2026-11-01"
    assert [i["nom"] for i in seance["images"]] == ["Le Pont-aux-Roseaux"]
    contrats = carnet.lire_publie(CARNET / "contrats.json")["elements"]
    assert [c["nom"] for c in contrats if c["nom"] == "Escorte d'une caravane de sel"] and all(c["etat"] in ("pris", "reussi", "echoue") for c in contrats)
    assert {"texte": "Les loups sont revenus.", "source": "un bûcheron"}.items() <= next(
        r for r in carnet.lire_publie(CARNET / "rumeurs.json")["elements"] if r["texte"].startswith("Les loups")).items()
    boutiques = carnet.lire_publie(CARNET / "boutiques.json")["elements"]
    assert [b["nom"] for b in boutiques] == ["Chez Bran"]
    assert [a["nom"] for a in boutiques[0]["articles"]] == ["Torche", "Corde", "Lanterne", "Gemme brute", "Épée"]
    assert boutiques[0]["marchand"] == "Bran le Borgne" and carnet.ADRESSE_MEDIA.match(boutiques[0]["portrait"])
    # Le coin des joueurs sert le carnet tel quel, l'image par son nom vérifié.
    coin = monde["a"]["coin"]
    lu = coin.get("/api/carnet").json()
    assert lu["ouvert"] is True and lu["boutiques"] == 1
    assert any(p["nom"] == "Bran le Borgne" for p in lu["personnages"])
    r = coin.get(bran["illustration"])
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"


def test_un_champ_qui_nomme_un_inconnu_est_retenu(atelier, monde):
    """Le rôle d'un PNJ connu qui nomme un lieu encore inconnu n'est pas publié (relecture de sécurité, F2) : le PNJ paraît
    sans son rôle ; une rumeur dont le texte nomme un PNJ inconnu reste dehors, comme la légende d'une image. Le MJ le lit
    dans la section du carnet avant d'ouvrir, puis à l'ouverture."""
    ouvrir_carnet(atelier, False)
    carnet_api.publier_carnet()
    seance = monde["close"]["id"]
    lieux_avant = atelier.get(f"/api/seances/{seance}").json()["lieux"]
    veilleur = atelier.post("/api/pnj", json={"nom": "Odon", "role": "Veilleur de la Grange-Écarlate", "apparence": "Un vieil homme.",
                                              "connu": True}).json()
    rumeur = atelier.post("/api/rumeurs", json={"texte": "Silas l'Ombre rôde au moulin.", "source": "un meunier", "etat": "entendue"}).json()
    # Un lieu connu dont le nom nomme en entier un PNJ inconnu, montré dans un « Précédemment ».
    tour = atelier.post("/api/lieux", json={"nom": "La Tour de Silas l'Ombre", "type": "tour", "connu": True,
                                            "illustrations": [{"url": image("tour-silas.png", (40, 40, 40))}]}).json()
    atelier.patch(f"/api/seances/{seance}", json={"lieux": [*lieux_avant, tour["id"]]})
    try:
        avis_role = "Odon : rôle retenu, il nomme La Grange-Écarlate (lieu inconnu des joueurs)."
        avis_rumeur = ("La rumeur « Silas l'Ombre rôde au moulin. » : absente du carnet, elle nomme Silas l'Ombre "
                       "(personnage inconnu des joueurs).")
        avis_image = ("L'image « La Tour de Silas l'Ombre » du « Précédemment » de la séance 1 : absente du carnet, elle nomme "
                      "Silas l'Ombre (personnage inconnu des joueurs).")
        avant = atelier.get("/api/carnet-joueurs").json()
        assert avant["ouvert"] is False and {avis_role, avis_rumeur, avis_image} <= set(avant["retenus"])
        assert not list(CARNET.glob("personnages.json"))
        ouvert = atelier.put("/api/carnet-joueurs", json={"ouvert": True})
        assert ouvert.status_code == 200 and avis_role in ouvert.json()["retenus"]
        odon = next(x for x in carnet.lire_publie(CARNET / "personnages.json")["elements"] if x["nom"] == "Odon")
        assert odon["role"] == "" and odon["apparence"] == "Un vieil homme."
        prec = next(x for x in carnet.lire_publie(CARNET / "precedemment.json")["elements"] if x["numero"] == 1)
        assert [i["nom"] for i in prec["images"]] == ["Le Pont-aux-Roseaux"]
        tout = texte_du_carnet()
        assert "Grange" not in tout and "Silas" not in tout and "rôde au moulin" not in tout
        # Le lieu devenu connu : le rôle paraît, l'avis s'en va.
        atelier.patch(f"/api/lieux/{monde['grange']['id']}", json={"connu": True})
        carnet_api.publier_carnet()
        assert next(x for x in carnet.lire_publie(CARNET / "personnages.json")["elements"] if x["nom"] == "Odon")["role"] == "Veilleur de la Grange-Écarlate"
        assert avis_role not in atelier.get("/api/carnet-joueurs").json()["retenus"]
    finally:
        atelier.patch(f"/api/lieux/{monde['grange']['id']}", json={"connu": False})
        atelier.patch(f"/api/seances/{seance}", json={"lieux": lieux_avant})
        for collection, fiche in (("pnj", veilleur), ("rumeurs", rumeur), ("lieux", tour)):
            atelier.delete(f"/api/{collection}/{fiche['id']}")
        carnet_api.publier_carnet()


def test_un_pnj_devenu_inconnu_ou_cache_disparait(atelier, monde):
    ouvrir_carnet(atelier)
    carnet_api.publier_carnet()
    adresse = next(p for p in carnet.lire_publie(CARNET / "personnages.json")["elements"] if p["nom"] == "Bran le Borgne")["illustration"]
    atelier.patch(f"/api/pnj/{monde['bran']['id']}", json={"connu": False})
    try:
        carnet_api.publier_carnet()
        assert "Bran" not in texte_du_carnet()
        # Son portrait n'est plus servi ; sa boutique, qui porte son nom, reste dehors en entier, et le MJ sait pourquoi.
        assert monde["a"]["coin"].get(adresse).status_code == 404
        assert carnet.lire_publie(CARNET / "boutiques.json")["elements"] == []
        assert ("La boutique « Chez Bran » : absente du carnet, elle nomme Bran le Borgne (personnage inconnu des joueurs)."
                in atelier.get("/api/carnet-joueurs").json()["retenus"])
    finally:
        atelier.patch(f"/api/pnj/{monde['bran']['id']}", json={"connu": True})
        carnet_api.publier_carnet()
    assert [b["marchand"] for b in carnet.lire_publie(CARNET / "boutiques.json")["elements"]] == ["Bran le Borgne"]


def test_chaque_joueur_ne_lit_que_sa_fiche(atelier, monde):
    ouvrir_carnet(atelier)
    carnet_api.publier_carnet()
    a, b = monde["a"], monde["b"]
    fiche_a, fiche_b = a["coin"].get("/api/carnet").json()["heros"], b["coin"].get("/api/carnet").json()["heros"]
    assert fiche_a["nom"] == "Ysolde Gris" and fiche_b["nom"] == "Tavarède Lavelle"
    # Hors de la compagnie (les héros de la tablée tels que la TV les montre), rien de l'autre héros.
    sans_compagnie = lambda lu: json.dumps({k: v for k, v in lu.items() if k != "compagnie"}, ensure_ascii=False)  # noqa: E731
    assert "Tavarède" not in sans_compagnie(a["coin"].get("/api/carnet").json())
    assert "Ysolde" not in sans_compagnie(b["coin"].get("/api/carnet").json())
    autre = {h["nom"]: h for h in a["coin"].get("/api/carnet").json()["compagnie"]}["Tavarède Lavelle"]
    assert autre["moi"] is False and not {"histoire", "dons", "competences", "or", "secret", "notes_mj", "cartons"} & set(autre)
    # La Santé du moment et ses cartons, le sac ; ni la note du MJ sur l'état, ni ce qui est « pour le MJ ».
    assert (fiche_a["sante"], fiche_a["sante_max"], fiche_a["psy"], fiche_a["psy_max"]) == (4, 9, 5, 5)
    assert fiche_a["cartons"] == {"physique": "jaune"} and fiche_a["or"] == 30 and fiche_a["equipement"] == ["Cape"]
    assert fiche_a["competences"] == [{"nom": "Lames", "bonus": 15, "avec": "Physique"}]
    for interdit in ("SECRET-HEROS", "NOTE-HEROS", "NOTE-ETAT", "notes_mj", '"secret"', '"notes"'):
        assert interdit not in json.dumps(fiche_a, ensure_ascii=False)
    # Un fichier par joueur, nommé par une clé tirée de son jeton interne : ni son nom, ni celui de son héros.
    fichiers = sorted(f.name for f in (CARNET / "heros").glob("*.json"))
    attendus = sorted(f"{carnet.cle_heros(joueurs.empreinte(jeton_de(x['joueur'])))}.json" for x in (a, b))
    assert set(attendus) <= set(fichiers)
    # Un nouveau mot de passe provisoire : l'ancien cookie ne lit plus rien, le fichier reste à sa place (le
    # jeton ne change plus), et le joueur le retrouve en se reconnectant.
    sien = f"{carnet.cle_heros(joueurs.empreinte(jeton_de(a['joueur'])))}.json"
    assert atelier.post(f"/api/joueurs/{a['joueur']['id']}/provisoire", json={}).status_code == 200
    carnet_api.publier_carnet()
    assert (CARNET / "heros" / sien).exists()
    assert a["coin"].get("/api/carnet").status_code == 401
    a["coin"] = TestClient(joueurs.app)
    entrer(a["coin"], a["joueur"])
    assert a["coin"].get("/api/carnet").json()["heros"]["nom"] == "Ysolde Gris"
    # Hors de la tablée : plus de fiche.
    atelier.patch(f"/api/aventuriers/{b['heros']['id']}", json={"tablee": False})
    carnet_api.publier_carnet()
    assert b["coin"].get("/api/carnet").json()["heros"] is None
    atelier.patch(f"/api/aventuriers/{b['heros']['id']}", json={"tablee": True})
    carnet_api.publier_carnet()


def test_ecrit_seulement_ce_qui_change(atelier, monde):
    ouvrir_carnet(atelier)
    carnet_api.publier_carnet()
    dates = {f: f.stat().st_mtime_ns for f in CARNET.rglob("*.json")}
    assert carnet_api.publier_carnet()["ecrits"] == 0
    assert {f: f.stat().st_mtime_ns for f in CARNET.rglob("*.json")} == dates
    avant = carnet_api.sources_du_carnet()
    atelier.patch(f"/api/pnj/{monde['bran']['id']}", json={"role": "Passeur du gué"})
    assert carnet_api.sources_du_carnet() != avant
    carnet_api.publier_carnet()
    changes = {f.name for f in CARNET.rglob("*.json") if f.stat().st_mtime_ns != dates.get(f)}
    assert changes == {"personnages.json"}


def test_les_regles_de_la_table_si_publiees(atelier, monde):
    ouvrir_carnet(atelier)
    carnet_api.publier_carnet()
    carnet.ecrire_atomique(CARNET / "regles.json", {"maj": "2026-11-03T10:00:00", "elements": [
        {"id": "r1", "titre": "Les dés roulent à découvert", "texte": "Sauf pour le MJ.", "date": "2026-11-01"}]})
    lu = monde["a"]["coin"].get("/api/carnet").json()
    assert lu["regles"] == [{"id": "r1", "titre": "Les dés roulent à découvert", "texte": "Sauf pour le MJ.", "date": "2026-11-01"}]
    assert atelier.get("/api/carnet-joueurs").json()["sections"]["regles"] == 1
    (CARNET / "regles.json").unlink()


def commande(coin, monde, *lignes, boutique=None):
    jeton = boutique or tv_cartes.jeton("boutiques", monde["echoppe"]["id"])
    return coin.post("/api/commandes", json={"boutique": jeton, "lignes": [{"article": a, "quantite": q} for a, q in lignes]})


def vider_commandes(monde):
    for x in ("a", "b"):
        carnet.fichier_commandes(config.PROPOSITIONS, monde[x]["joueur"]["id"]).unlink(missing_ok=True)


def test_une_commande_de_bout_en_bout(atelier, monde):
    ouvrir_carnet(atelier)
    carnet_api.publier_carnet()
    vider_commandes(monde)
    a, b = monde["a"], monde["b"]
    echoppe = a["coin"].get("/api/echoppe").json()
    assert echoppe["heros"] == {"nom": "Ysolde Gris", "or": 30} and [x["nom"] for x in echoppe["boutiques"]] == ["Chez Bran"]
    r = commande(a["coin"], monde, ("torche1", 2), ("corde1", 1))
    assert r.status_code == 200
    passee = r.json()
    assert passee["statut"] == "en-attente" and passee["total"] == 6 and passee["boutique_nom"] == "Chez Bran"
    # Une seule commande en attente par boutique ; l'autre joueur ne la voit pas.
    assert commande(a["coin"], monde, ("torche1", 1)).status_code == 409
    assert b["coin"].get("/api/echoppe").json()["commandes"] == []
    assert b["coin"].delete(f"/api/commandes/{passee['id']}").status_code == 404
    vues = [c for c in atelier.get("/api/commandes").json() if c["id"] == passee["id"]]
    assert len(vues) == 1 and vues[0]["total"] == 6 and vues[0]["refus"] == [] and vues[0]["heros"]["or"] == 30
    vendue = atelier.post(f"/api/commandes/{a['joueur']['id']}/{passee['id']}/vendre", json={})
    assert vendue.status_code == 200, vendue.text
    assert vendue.json()["heros"]["or"] == 24 and vendue.json()["boutique"]["articles"][1]["stock"] == 2
    fiche = atelier.get(f"/api/aventuriers/{a['heros']['id']}").json()
    assert fiche["or"] == 24 and fiche["equipement"] == ["Cape", "Torche ×2", "Corde"]
    assert next(x for x in atelier.get(f"/api/boutiques/{monde['echoppe']['id']}").json()["articles"] if x["id"] == "corde1")["stock"] == 2
    # Le joueur voit sa commande vendue, et sa bourse à jour dans le carnet republié.
    suivie = a["coin"].get("/api/echoppe").json()
    assert [(c["statut"], c["montant"], c["heros"]) for c in suivie["commandes"]] == [("vendue", 6, "Ysolde Gris")]
    assert suivie["heros"]["or"] == 24 and a["coin"].get("/api/carnet").json()["heros"]["equipement"] == ["Cape", "Torche ×2", "Corde"]
    # Déjà traitée : ni revendue, ni retirée.
    assert atelier.post(f"/api/commandes/{a['joueur']['id']}/{passee['id']}/vendre", json={}).status_code == 409
    assert a["coin"].delete(f"/api/commandes/{passee['id']}").status_code == 409
    atelier.patch(f"/api/aventuriers/{a['heros']['id']}/sac", json={"or": {"avant": 24, "apres": 30}, "equipement": {
        "avant": ["Cape", "Torche ×2", "Corde"], "apres": ["Cape"]}})


def test_la_vente_grossit_une_ligne_deja_la(atelier, monde):
    """Les quantités : ce que le héros porte déjà n'ouvre pas une ligne de plus, sa quantité monte (« Torche » et
    deux torches vendues font « Torche ×3 »), sans égard à la casse ; le reste du sac ne bouge pas."""
    ouvrir_carnet(atelier)
    a = monde["a"]
    url = f"/api/aventuriers/{a['heros']['id']}/sac"
    avant = atelier.get(f"/api/aventuriers/{a['heros']['id']}").json()
    assert atelier.patch(url, json={"equipement": {"avant": avant["equipement"], "apres": ["Cape", "torche", "Corde x2"]}}).status_code == 200
    carnet_api.publier_carnet()
    vider_commandes(monde)
    try:
        passee = commande(a["coin"], monde, ("torche1", 2)).json()
        vendue = atelier.post(f"/api/commandes/{a['joueur']['id']}/{passee['id']}/vendre", json={})
        assert vendue.status_code == 200, vendue.text
        fiche = atelier.get(f"/api/aventuriers/{a['heros']['id']}").json()
        assert fiche["equipement"] == ["Cape", "torche ×3", "Corde x2"] and fiche["or"] == avant["or"] - 2
        assert a["coin"].get("/api/carnet").json()["heros"]["equipement"] == ["Cape", "torche ×3", "Corde x2"]
    finally:
        fiche = atelier.get(f"/api/aventuriers/{a['heros']['id']}").json()
        atelier.patch(url, json={"or": {"avant": fiche["or"], "apres": avant["or"]}, "equipement": {"avant": fiche["equipement"], "apres": avant["equipement"]}})
        vider_commandes(monde)


@pytest.mark.parametrize("lignes, statut", [
    ([("cache1", 1)], 404),  # caché : il n'est pas dans la boutique publiée
    ([("vide1", 1)], 409),  # épuisé
    ([("inconnu", 1)], 404),
    ([("../x", 1)], 404),
    ([("torche1", 0)], 400),
    ([("torche1", -1)], 400),
    ([("torche1", 21)], 400),
    ([("torche1", "2")], 400),
    ([("torche1", True)], 400),
    ([("torche1", 2.5)], 400),
    ([("torche1", None)], 400),
    ([("torche1", 1), ("torche1", 1)], 400),
    ([], 400),
    ([("epee1", 2)], 409),  # 50 po pour une bourse de 30
])
def test_une_commande_absurde_est_refusee(atelier, monde, lignes, statut):
    ouvrir_carnet(atelier)
    carnet_api.publier_carnet()
    vider_commandes(monde)
    r = commande(monde["a"]["coin"], monde, *lignes)
    assert r.status_code == statut, r.text
    assert carnet.lire_commandes(config.PROPOSITIONS, monde["a"]["joueur"]["id"]) == []


def test_une_boutique_fermee_ou_inventee_et_les_bornes(atelier, monde):
    ouvrir_carnet(atelier)
    carnet_api.publier_carnet()
    vider_commandes(monde)
    coin = monde["a"]["coin"]
    fermee = tv_cartes.jeton("boutiques", monde["fermee"]["id"])
    assert commande(coin, monde, ("x1", 1), boutique=fermee).status_code == 404
    for jeton in ("0123456789abcdef0123", "../../carnet", monde["echoppe"]["id"], "", 12):
        assert coin.post("/api/commandes", json={"boutique": jeton, "lignes": [{"article": "torche1", "quantite": 1}]}).status_code in (400, 404)
    assert coin.post("/api/commandes", json={"boutique": tv_cartes.jeton("boutiques", monde["echoppe"]["id"]),
                                             "lignes": [{"article": f"a{i}", "quantite": 1} for i in range(13)]}).status_code == 413
    assert coin.post("/api/commandes", json={"boutique": "x", "lignes": [], "remplissage": "x" * 9000}).status_code == 413
    # Une boutique refermée par le MJ : plus de commande.
    atelier.patch(f"/api/boutiques/{monde['echoppe']['id']}", json={"ouverte_joueurs": False})
    carnet_api.publier_carnet()
    assert commande(coin, monde, ("torche1", 1)).status_code == 404
    atelier.patch(f"/api/boutiques/{monde['echoppe']['id']}", json={"ouverte_joueurs": True})
    carnet_api.publier_carnet()
    # Le nombre de commandes gardées par joueur est borné : les plus anciennes traitées s'en vont.
    for _ in range(carnet.COMMANDES_MAX + 5):
        c = commande(coin, monde, ("torche1", 1)).json()
        atelier.post(f"/api/commandes/{monde['a']['joueur']['id']}/{c['id']}/refuser", json={"mot": ""})
    assert len(carnet.lire_commandes(config.PROPOSITIONS, monde["a"]["joueur"]["id"])) == carnet.COMMANDES_MAX
    vider_commandes(monde)


def test_le_mj_refuse_ou_ne_peut_pas_vendre(atelier, monde):
    ouvrir_carnet(atelier)
    carnet_api.publier_carnet()
    vider_commandes(monde)
    a = monde["a"]
    ident, boutique = a["joueur"]["id"], monde["echoppe"]["id"]
    c = commande(a["coin"], monde, ("torche1", 1), ("corde1", 1)).json()
    vendre = lambda **corps: atelier.post(f"/api/commandes/{ident}/{c['id']}/vendre", json=corps)
    articles = atelier.get(f"/api/boutiques/{boutique}").json()["articles"]

    def changer(ident_article, **champs):
        atelier.patch(f"/api/boutiques/{boutique}", json={"articles": [{**x, **champs} if x["id"] == ident_article else x for x in articles]})

    changer("corde1", cache=True)
    r = vendre()
    assert r.status_code == 409 and "caché" in r.json()["detail"]
    changer("corde1", stock=0)
    assert "épuisé" in vendre().json()["detail"]
    changer("corde1", stock=1)
    assert vendre(montant=-3).status_code == 400
    assert vendre(montant="beaucoup").status_code == 400
    r = vendre(montant=500)
    assert r.status_code == 409 and "n'a que 30 po" in r.json()["detail"]
    assert atelier.get(f"/api/aventuriers/{a['heros']['id']}").json()["or"] == 30
    # Refusée, avec un mot (masqué comme tout ce que lisent les joueurs).
    r = atelier.post(f"/api/commandes/{ident}/{c['id']}/refuser", json={"mot": "Torvin a fermé, comme à la Petite Fanfrelée."})
    assert r.status_code == 200
    vue = a["coin"].get("/api/echoppe").json()["commandes"][-1]
    assert vue["statut"] == "refusee" and vue["mot"] == "Torvin a fermé, comme à l'auberge."
    assert vendre().status_code == 409
    for chemin in (f"/api/commandes/{ident}/../vendre", f"/api/commandes/inconnu/{c['id']}/vendre", f"/api/commandes/{ident}/zzz/vendre"):
        assert atelier.post(chemin, json={}).status_code in (404, 405)
    atelier.put(f"/api/boutiques/{boutique}", json={**atelier.get(f"/api/boutiques/{boutique}").json(), "articles": articles})
    vider_commandes(monde)


def test_chemins_du_coin(atelier, monde):
    ouvrir_carnet(atelier)
    carnet_api.publier_carnet()
    coin = monde["a"]["coin"]
    for chemin in ("/carnet/media/../sommaire.json", "/carnet/media/x.jpg", "/carnet/media/%2e%2e%2fsommaire.json",
                   "/carnet/media/" + "A" * 24 + ".jpg", "/carnet/media/" + "a" * 24 + ".png", "/carnet/sommaire.json",
                   "/carnet/heros/x.json", "/static/joueurs/carnet.html", "/api/commandes"):
        assert coin.get(chemin).status_code in (404, 405), chemin
    for ident in ("../x", "a" * 12 + "/../b", "zzzzzzzzzzzz"):
        assert coin.delete(f"/api/commandes/{ident}").status_code in (404, 405)
    # Sans lien, rien du carnet.
    anonyme = TestClient(joueurs.app)
    assert anonyme.get("/api/carnet").status_code == 401 and anonyme.get("/api/echoppe").status_code == 401
    assert anonyme.get("/carnet", follow_redirects=False).status_code == 303
    nom = next(CARNET.joinpath("media").glob("*.jpg")).name
    assert anonyme.get(f"/carnet/media/{nom}").status_code == 401
    # Les modules de la page sont servis (le test des imports vérifie le reste).
    for f in ("js/joueurs/carnet.js", "js/joueurs/echoppe.js", "js/boutiques/objets.js", "css/carnet.css"):
        assert coin.get(f"/static/{f}").status_code == 200, f


def test_un_joueur_sans_heros_ne_commande_pas(atelier, monde, coin_pour):
    ouvrir_carnet(atelier)
    invite = atelier.post("/api/joueurs", json={"nom": "Corentin"}).json()
    carnet_api.publier_carnet()
    coin = coin_pour(invite)
    assert coin.get("/api/carnet").json()["heros"] is None
    assert commande(coin, monde, ("torche1", 1)).status_code == 409
    atelier.delete(f"/api/joueurs/{invite['id']}")


def test_les_bornes_partagees_avec_la_page():
    """Le panier du téléphone suit les bornes du serveur."""
    js = (Path(__file__).resolve().parent.parent / "app" / "static" / "js" / "joueurs" / "echoppe.js").read_text(encoding="utf-8")
    assert f"const QUANTITE_MAX = {carnet.QUANTITE_MAX};" in js and f"const LIGNES_MAX = {carnet.LIGNES_MAX};" in js
    for prix, montant in (("25", 25), (" 25 po ", 25), ("3 pièces d'or", 3), ("à partir de 150", None), ("15 / 120", None), ("", None), (None, None)):
        assert carnet.montant_du_prix(prix) == montant


# Les attaques de la relecture de sécurité (F1, F3, F4 ; F2 plus haut), rejouées.

def brut(coin, methode, url, contenu, **entetes):
    return coin.request(methode, url, content=contenu, headers={"Content-Type": "application/json", **entetes})


@pytest.mark.parametrize("contenu", ['{"nom":"X","sante":1e400}', '{"nom":"X","peuple":1e400}', '{"nom":"X","or":NaN}',
                                     '{"nom":"X","psy":Infinity}', '{"nom":"X","psy":-Infinity}', "[" * 100000 + "]" * 100000])
def test_un_nombre_infini_ou_un_corps_tordu_est_refuse(atelier, coin_pour, contenu):
    invite = atelier.post("/api/joueurs", json={"nom": "Hugues"}).json()
    coin = coin_pour(invite)
    assert brut(coin, "POST", "/api/moi/aventurier", contenu).status_code == 400
    assert coin.get("/api/moi").json()["aventurier"] is None
    assert brut(coin, "POST", "/api/commandes", '{"boutique":"0123456789abcdef0123","lignes":[{"article":"a1","quantite":1e400}]}').status_code == 400
    atelier.delete(f"/api/joueurs/{invite['id']}")


def test_la_fiche_du_createur_passe_telle_quelle():
    """Le typage ne change rien à ce qu'écrit vraiment le créateur (fiche de départ, prétiré, dons créés et améliorés)."""
    fiche = {
        "nom": "Vortan Aldrea", "genre": "h", "joueur": "Dario", "couleur": "#96d35f", "niveau": 1, "avant": "Voleur des rues.",
        "pourquoi": "Traqué.", "jamais": "Livrer quelqu'un.", "peuple": "Demi-élémentaire", "particularites": "", "peuple_cache": False,
        "vocations": ["Roublard", "Érudit"], "specialite": "", "physique": 75, "social": 25, "mental": 70,
        "competences": [{"nom": "Lames", "bonus": 15, "avec": "Physique"}, {"nom": "", "bonus": 15, "avec": "Physique"}],
        "sante": 5, "psy": 7, "dons": [{"nom": "Déplacement élémentaire"}, {"nom": "La Barrière", "cout": "3", "effet": "Un mur d'air.", "cree": True},
                                       {"nom": "Bourrasque", "cout": 2, "ameliore": "coût 2 au lieu de 3."}],
        "element": "Air", "posture": "focus", "themes": ["Survie", "Famille", ""], "armes": [{"nom": "Deux dagues", "competence": "Lames",
        "degats": "1D4", "notes": "Réagissent à la magie"}], "protection": {"nom": "Cuir souple", "indice": 1}, "bouclier": False,
        "equipement": ["Outils de crochetage", ""], "objets": ["Écharpe", "", ""], "or": 70, "langues": "Commun, argot des docks",
        "allure": "Grand.", "defaut": "Méfiant.", "lien": "Anita.", "lien_avec_nom": "Non", "contacts": "Anita Aldrea", "histoire": "Une histoire.",
        "conseils": ["Restez dans l'ombre."], "source": "pretire-vortan",
    }
    assert joueurs.nettoyer({**fiche, "secret": "S", "notes_mj": "N", "tablee": True, "progression": [], "lien_avec": "x"}) == fiche
    assert joueurs.nettoyer({**fiche, "or": None, "protection": None})["or"] is None


def test_la_fiche_d_un_joueur_est_typee_et_ne_bloque_rien(atelier, coin_pour):
    """« vocations » en nombre, un or démesuré, des listes tordues : la fiche est typée comme l'écrit le créateur, et le
    carnet se publie pour toute la table (relecture de sécurité, F1)."""
    invite = atelier.post("/api/joueurs", json={"nom": "Bertrand"}).json()
    coin = coin_pour(invite)
    a = coin.post("/api/moi/aventurier", json={
        "nom": "Bertrand", "vocations": 3, "or": 10 ** 30, "sante": "neuf", "physique": 2.6, "themes": ["Survie", 7, None],
        "competences": [{"nom": "Lames", "bonus": "15", "avec": 3, "pirate": "x"}, 4, None], "armes": {"nom": "épée"},
        "protection": [1], "dons": [{"nom": "Racines", "cout": 2, "valide_mj": True}], "histoire": "x" * 20000,
        "inconnu": {"profond": [1]}, "simple": "oui"}).json()
    assert a["vocations"] == [] and a["or"] == carnet.OR_MAX and a["sante"] == 9 and a["physique"] == 3 and a["themes"] == ["Survie"]
    assert a["competences"] == [{"nom": "Lames", "bonus": 0, "avec": ""}] and a["armes"] == [] and a["protection"] is None
    assert a["dons"] == [{"nom": "Racines", "cout": 2}] and len(a["histoire"]) == carnet.LONG
    assert "inconnu" not in a and a["simple"] == "oui"
    coin.post("/api/moi/envoyer")
    fiche = atelier.post(f"/api/joueurs/{invite['id']}/accueillir").json()
    assert atelier.put("/api/carnet-joueurs", json={"ouvert": True}).status_code == 200
    assert atelier.get("/api/joueurs").status_code == 200 and atelier.get("/api/aventuriers").status_code == 200
    assert coin.get("/api/carnet").json()["heros"]["nom"] == "Bertrand"
    atelier.delete(f"/api/joueurs/{invite['id']}")
    atelier.delete(f"/api/aventuriers/{fiche['id']}")


def test_une_proposition_abimee_ne_casse_pas_la_liste_des_joueurs(atelier):
    invite = atelier.post("/api/joueurs", json={"nom": "Isidore"}).json()
    # Une proposition écrite avant le typage, quand le coin acceptait tout : un nombre infini, des vocations en nombre.
    (config.PROPOSITIONS / f"{invite['id']}.json").write_text(
        '{"joueur":"isidore","aventurier":{"nom":"Isidore","peuple":Infinity,"vocations":3},"envoye":true}', encoding="utf-8")
    r = atelier.get("/api/joueurs")
    assert r.status_code == 200
    vue = next(j for j in r.json() if j["id"] == invite["id"])
    assert vue["aventurier"] == "Isidore" and vue["vocations"] == []
    fiche = atelier.post(f"/api/joueurs/{invite['id']}/accueillir").json()
    assert fiche["peuple"] == "" and fiche["vocations"] == []
    atelier.delete(f"/api/joueurs/{invite['id']}")
    atelier.delete(f"/api/aventuriers/{fiche['id']}")


def test_une_fiche_abimee_ne_bloque_pas_le_carnet(atelier, monde, caplog):
    """Une fiche de héros abîmée côté atelier (des compétences qui ne sont pas une liste) est laissée de côté : l'autre
    joueur garde la sienne, le carnet ses sections, le MJ en est averti, et le journal ne le dit qu'une fois."""
    ouvrir_carnet(atelier)
    a = monde["a"]["heros"]["id"]
    with caplog.at_level(logging.WARNING, logger="atelier"):
        atelier.patch(f"/api/aventuriers/{a}", json={"competences": 5})
        for _ in range(3):
            carnet_api.publier_carnet()
        r = atelier.put("/api/carnet-joueurs", json={"ouvert": True})
    assert r.status_code == 200
    assert "Le héros « Ysolde Gris » : pas dans le carnet, sa fiche contient une valeur illisible." in r.json()["retenus"]
    assert monde["a"]["coin"].get("/api/carnet").json()["heros"] is None
    assert monde["b"]["coin"].get("/api/carnet").json()["heros"]["nom"] == "Tavarède Lavelle"
    assert carnet.lire_publie(CARNET / "personnages.json")["elements"]
    assert len([x for x in caplog.records if "Ysolde Gris" in x.getMessage()]) == 1
    atelier.patch(f"/api/aventuriers/{a}", json={"competences": [{"nom": "Lames", "bonus": 15, "avec": "Physique"}]})
    carnet_api.publier_carnet()
    assert monde["a"]["coin"].get("/api/carnet").json()["heros"]["nom"] == "Ysolde Gris"


def test_la_tache_de_fond_ne_noie_pas_le_journal(monkeypatch, caplog):
    """Une publication en échec n'est retentée qu'au changement suivant des fiches, et la même erreur n'est notée qu'une
    fois (la tâche passe toutes les cinq secondes)."""
    ici = threading.get_ident()
    appels = []

    def en_panne():
        if threading.get_ident() == ici:
            appels.append(1)
        raise RuntimeError("disque plein")

    monkeypatch.setattr(carnet_api, "publier_carnet", en_panne)
    suivi = {}
    with caplog.at_level(logging.ERROR, logger="atelier"):
        for _ in range(4):
            carnet_api.tour_du_carnet(suivi)
        monkeypatch.setattr(carnet_api, "sources_du_carnet", lambda: 42)
        carnet_api.tour_du_carnet(suivi)
        carnet_api.tour_du_carnet(suivi)
    assert len(appels) == 2
    assert len([x for x in caplog.records if x.thread == ici and "non publié" in x.getMessage()]) == 1


def test_une_ecriture_venue_d_ailleurs_est_refusee(atelier, monde, monkeypatch):
    """Un formulaire en text/plain posé sur un sous-domaine frère (la barrière SameSite=Lax ne l'arrête pas) ne passe
    plus commande (relecture de sécurité, F3) ; les pages du coin, si."""
    ouvrir_carnet(atelier)
    carnet_api.publier_carnet()
    vider_commandes(monde)
    coin = monde["a"]["coin"]
    corps = json.dumps({"boutique": tv_cartes.jeton("boutiques", monde["echoppe"]["id"]), "lignes": [{"article": "torche1", "quantite": 1}]})
    pirate = "https://pirate.exemple.org"
    for entetes, statut in (({"Origin": pirate, "Content-Type": "text/plain"}, 403), ({"Origin": pirate}, 403), ({"Origin": "null"}, 403),
                            ({"Sec-Fetch-Site": "same-site"}, 403), ({"Sec-Fetch-Site": "cross-site"}, 403), ({"Content-Type": "text/plain"}, 415),
                            ({"Content-Type": "application/x-www-form-urlencoded"}, 415)):
        assert brut(coin, "POST", "/api/commandes", corps, **entetes).status_code == statut, entetes
    assert carnet.lire_commandes(config.PROPOSITIONS, monde["a"]["joueur"]["id"]) == []
    passee = brut(coin, "POST", "/api/commandes", corps, Origin="http://testserver", **{"Sec-Fetch-Site": "same-origin"})
    assert passee.status_code == 200
    ident = passee.json()["id"]
    assert coin.delete(f"/api/commandes/{ident}", headers={"Origin": pirate}).status_code == 403
    assert coin.delete(f"/api/commandes/{ident}", headers={"Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"}).status_code == 200
    # « Envoyer au MJ » sans corps passe toujours la garde (ici : déjà accueilli).
    assert coin.post("/api/moi/envoyer", headers={"Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"}).status_code == 423
    # En ligne, derrière le tunnel : seule l'adresse du coin écrit.
    monkeypatch.setattr(joueurs, "HOTES", {"joueurs.exemple.org"})
    en_ligne = {"Host": "joueurs.exemple.org", "Origin": "https://joueurs.exemple.org"}
    assert brut(coin, "POST", "/api/commandes", corps, **{**en_ligne, "Origin": pirate}).status_code == 403
    assert brut(coin, "POST", "/api/commandes", corps, **en_ligne).status_code == 200
    vider_commandes(monde)


def test_un_joueur_reinvite_n_herite_pas_des_commandes(atelier, monde, coin_pour):
    """Retiré puis réinvité sous le même prénom, un joueur ne voit ni ne retire les commandes de l'ancien (F4)."""
    ouvrir_carnet(atelier)
    invite = atelier.post("/api/joueurs", json={"nom": "Félix"}).json()
    coin = coin_pour(invite)
    coin.post("/api/moi/aventurier", json={"nom": "Félix le Roux", "or": 30, "sante": 9, "psy": 5})
    coin.post("/api/moi/envoyer")
    heros = atelier.post(f"/api/joueurs/{invite['id']}/accueillir").json()
    carnet_api.publier_carnet()
    c = commande(coin, monde, ("torche1", 1)).json()
    assert c["statut"] == "en-attente"
    assert atelier.delete(f"/api/joueurs/{invite['id']}").status_code == 200
    assert not (config.PROPOSITIONS / carnet.COMMANDES / f"{invite['id']}.json").exists()
    assert list((config.CORBEILLE / "commandes").glob(f"{invite['id']}-*.json"))
    nouveau = atelier.post("/api/joueurs", json={"nom": "Félix"}).json()
    assert nouveau["id"] == invite["id"]
    coin2 = coin_pour(nouveau)
    assert coin2.get("/api/echoppe").json()["commandes"] == []
    assert coin2.delete(f"/api/commandes/{c['id']}").status_code == 404
    assert all(x["id"] != c["id"] for x in atelier.get("/api/commandes").json())
    # Un fichier de commandes resté sans joueur : son identifiant n'est pas repris.
    carnet.ecrire_commandes(config.PROPOSITIONS, "gaspard", [c])
    gaspard = atelier.post("/api/joueurs", json={"nom": "Gaspard"}).json()
    assert gaspard["id"] != "gaspard" and gaspard["id"].startswith("gaspard-")
    for j in (nouveau, gaspard):
        atelier.delete(f"/api/joueurs/{j['id']}")
    carnet.fichier_commandes(config.PROPOSITIONS, "gaspard").unlink()
    atelier.delete(f"/api/aventuriers/{heros['id']}")


def test_un_personnage_mort_porte_sa_croix(atelier, monde):
    """Un PNJ connu passé en « Mort » : la croix au carnet des joueurs (choix du 19/11). Seul ce statut sort : « disparu » et
    « sort inconnu » restent à l'atelier."""
    bran = monde["bran"]["id"]
    ouvrir_carnet(atelier)
    try:
        for statut, mort in (("mort", True), ("disparu", False), ("inconnu", False), ("vivant", False)):
            assert atelier.patch(f"/api/pnj/{bran}", json={"statut": statut}).status_code == 200
            carnet_api.publier_carnet()
            [p] = [x for x in monde["a"]["coin"].get("/api/carnet").json()["personnages"] if x["nom"] == "Bran le Borgne"]
            assert p["mort"] is mort and "statut" not in p
            assert '"statut"' not in json.dumps(p)
    finally:
        atelier.patch(f"/api/pnj/{bran}", json={"statut": "vivant"})
