"""Les joueurs et la TV (finitions) : la compagnie du carnet montre les héros de la tablée tels que la TV les présente, et
rien de plus (ni secret, ni note, ni peuple caché, ni ce qui nomme un inconnu, ni la clé du lien d'un autre) ; le
carnet sert l'aide-mémoire de l'atelier ; l'échoppe trop grande se montre par rayon et rappelle aux joueurs qu'elle
est aussi sur leur téléphone ; l'accueil d'un aventurier dit la couleur que la TV lui donnera, et peut la lui donner."""
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

from commun import carnet  # noqa: E402
from table import couleurs_tv  # noqa: E402
import joueurs  # noqa: E402
from comptes_coin import entrer, jeton_de  # noqa: E402
import main  # noqa: E402
import hashlib  # noqa: E402
from api import application, carnet_api, config, tv_cartes, tv_ecran, tv_etat  # noqa: E402
from sources_front import source_page  # noqa: E402

CARNET = config.PROPOSITIONS / carnet.CARNET
STATIQUE = Path(__file__).resolve().parent.parent / "app" / "static"
CF = {"CF-Connecting-IP": "203.0.113.7"}
# Tout ce que la compagnie peut dire d'un héros : ce que montre son carton à la TV. Une clé de plus s'ajoute ici, en
# connaissance de cause : « ref », le jeton opaque qui désigne un compagnon pour un don (lot B1, test_inventaire.py).
CLES_DU_COMPAGNON = {"nom", "genre", "joueur", "specialite", "allure", "peuple", "niveau", "physique", "social", "mental", "sante",
                     "psy", "element", "vocations", "themes", "couleur", "illustration", "moi", "ref"}



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
def compagnie(atelier, coin_pour):
    """Mila, accueillie depuis son lien avec Ondine ; Sacha, relié à Corvin (peuple gardé secret, notes du MJ) ; Hors,
    hors de la tablée ; un brouillon sans nom ; un lieu inconnu. Tout est retiré à la fin."""
    crees = []

    def creer(collection, **fiche):
        f = atelier.post(f"/api/{collection}", json=fiche).json()
        crees.append((collection, f["id"]))
        return f

    m = {
        "repaire": creer("lieux", nom="Le Gouffre-aux-Corbeaux", type="ruine", connu=False),
        "corvin": creer("aventuriers", nom="Corvin Noir-Plumage", genre="h", joueur="Sacha", tablee=True, couleur="#2e7d32",
                        peuple="Fils des Cendres", peuple_cache=True, element="Ténèbres", physique=60, social=45, mental=70,
                        sante=8, psy=5, themes=["Vengeance"], allure="Un manteau de plumes, revenu de la Petite Fanfrelée.",
                        histoire="HISTOIRE-CORVIN", secret="SECRET-CORVIN", notes_mj="NOTE-CORVIN",
                        dons=[{"nom": "Ombre portée", "cout": 2, "effet": "DON-CORVIN"}]),
        "hors": creer("aventuriers", nom="Ludovic Hors-Tablée", tablee=False, couleur="#7b1fa2"),
        "brouillon": creer("aventuriers", nom="", tablee=True),
    }
    mila = atelier.post("/api/joueurs", json={"nom": "Mila"}).json()
    coin_mila = coin_pour(mila)
    coin_mila.post("/api/moi/aventurier", json={"nom": "Ondine Clairbief", "genre": "f", "couleur": "#e0b562", "peuple": "Elfe",
                                                "vocations": ["Guerrier"], "allure": "Elle cherche le Gouffre-aux-Corbeaux.",
                                                "physique": 65, "social": 50, "mental": 55, "sante": 9, "psy": 3})
    coin_mila.post("/api/moi/envoyer")
    m["ondine"] = atelier.post(f"/api/joueurs/{mila['id']}/accueillir").json()
    crees.append(("aventuriers", m["ondine"]["id"]))
    sacha = atelier.post("/api/joueurs", json={"nom": "Sacha"}).json()
    assert atelier.post(f"/api/joueurs/{sacha['id']}/relier", json={"heros": m["corvin"]["id"]}).status_code == 200
    m.update(mila=mila, coin_mila=coin_mila, sacha=sacha, coin_sacha=coin_pour(sacha))
    ouvrir_carnet(atelier)
    carnet_api.publier_carnet()
    yield m
    ouvrir_carnet(atelier, False)
    for j in (mila, sacha):
        atelier.delete(f"/api/joueurs/{j['id']}")
    for collection, ident in reversed(crees):
        atelier.delete(f"/api/{collection}/{ident}")
    carnet_api.publier_carnet()


def mes_heros(lu):
    return {h["nom"]: h for h in lu["compagnie"]}


def test_la_compagnie_montre_la_tablee_comme_la_tv(atelier, compagnie):
    lu = compagnie["coin_mila"].get("/api/carnet").json()
    heros = mes_heros(lu)
    # Les héros de la tablée, dans l'ordre d'arrivée ; ni celui hors de la tablée, ni le brouillon sans nom.
    noms = [h["nom"] for h in lu["compagnie"]]
    assert noms.index("Corvin Noir-Plumage") < noms.index("Ondine Clairbief")
    assert "Ludovic Hors-Tablée" not in noms and "" not in noms
    for h in lu["compagnie"]:
        assert set(h) <= CLES_DU_COMPAGNON, set(h) - CLES_DU_COMPAGNON
    # Ce que dit le carton de la TV : la couleur de son pion à la TV, ses chiffres, ses thèmes.
    tv = {a["nom"]: a for a in atelier.get("/api/table/heros").json()}
    for nom in ("Corvin Noir-Plumage", "Ondine Clairbief"):
        assert heros[nom]["couleur"] == tv[nom]["couleur"]
        assert all(heros[nom][k] == tv[nom][k] for k in ("physique", "social", "mental", "sante", "psy", "joueur"))
    assert heros["Corvin Noir-Plumage"]["themes"] == ["Vengeance"]
    # Son propre héros marqué, celui d'un autre non ; la clé du lien ne sort jamais.
    assert heros["Ondine Clairbief"]["moi"] is True and heros["Corvin Noir-Plumage"]["moi"] is False
    assert mes_heros(compagnie["coin_sacha"].get("/api/carnet").json())["Corvin Noir-Plumage"]["moi"] is True
    brut = json.dumps(lu, ensure_ascii=False)
    for j in (compagnie["mila"], compagnie["sacha"]):
        empreinte = hashlib.sha256(jeton_de(j).encode()).hexdigest()
        assert carnet.cle_heros(empreinte) not in brut
    # Le fichier publié garde la clé (le coin seul la lit), jamais un identifiant d'aventurier ni un nom de joueur invité.
    publie = (CARNET / "compagnie.json").read_text(encoding="utf-8")
    assert compagnie["corvin"]["id"] not in publie and compagnie["ondine"]["id"] not in publie


def test_la_compagnie_ne_dit_rien_de_secret(atelier, compagnie):
    lu = compagnie["coin_mila"].get("/api/carnet").json()
    corvin, ondine = mes_heros(lu)["Corvin Noir-Plumage"], mes_heros(lu)["Ondine Clairbief"]
    # Le peuple gardé secret, et l'élément qui le trahirait, ne partent pas ; le nom de l'auberge passe au masque.
    assert corvin["peuple"] == "" and corvin["element"] == ""
    assert "Fanfrelée" not in corvin["allure"] and "auberge" in corvin["allure"]
    # Une allure qui nomme un lieu inconnu est retenue, et le MJ le lit.
    assert ondine["allure"] == ""
    assert any(x.startswith("Ondine Clairbief (la compagnie) : allure retenue, elle nomme Le Gouffre-aux-Corbeaux")
               for x in atelier.get("/api/carnet-joueurs").json()["retenus"])
    tout = "".join(f.read_text(encoding="utf-8") for f in CARNET.glob("compagnie.json")) + json.dumps(lu["compagnie"], ensure_ascii=False)
    for interdit in ("SECRET-", "NOTE-", "HISTOIRE-", "DON-", "Ombre portée", "Fils des Cendres", "Ténèbres", "Gouffre", "Fanfrelée",
                     "Hors-Tablée", "#7b1fa2"):
        assert interdit not in tout, interdit


def test_la_compagnie_suit_le_carnet_et_l_apercu(atelier, compagnie):
    # « Voir comme Mila » : la même compagnie, carnet ouvert comme fermé.
    ouvert = atelier.get(f"/api/joueurs/{compagnie['mila']['id']}/apercu").json()["carnet"]["compagnie"]
    assert [(h["nom"], h["moi"]) for h in ouvert] == [(h["nom"], h["moi"]) for h in compagnie["coin_mila"].get("/api/carnet").json()["compagnie"]]
    ouvrir_carnet(atelier, False)
    try:
        carnet_api.publier_carnet()
        assert not (CARNET / "compagnie.json").exists()
        assert compagnie["coin_mila"].get("/api/carnet").json() == {"ouvert": False, "prochaine": tv_etat.prochaine_seance()}
        ferme = atelier.get(f"/api/joueurs/{compagnie['mila']['id']}/apercu").json()["carnet"]["compagnie"]
        assert "Ondine Clairbief" in {h["nom"] for h in ferme} and not any("cle" in h for h in ferme)
    finally:
        ouvrir_carnet(atelier)
        carnet_api.publier_carnet()
    # Le MJ voit ce qui est publié, section par section.
    assert atelier.get("/api/carnet-joueurs").json()["sections"]["compagnie"] >= 2


def test_le_carnet_sert_l_aide_memoire_de_l_atelier(compagnie):
    coin = compagnie["coin_mila"]
    assert "js/regles/aide-memoire.js" in joueurs.FICHIERS
    assert coin.get("/static/js/regles/aide-memoire.js").status_code == 200
    vue = (STATIQUE / "js/joueurs/carnet-vue.js").read_text(encoding="utf-8")
    assert 'from "../regles/aide-memoire.js"' in vue and "AIDE_MEMOIRE.map" in vue and "htmlCompagnie(c.compagnie" in vue
    # Le même aide-mémoire que la touche R, la règle des postures du MJ comprise (une défense, +5 % en focus).
    aide = (STATIQUE / "js/regles/aide-memoire.js").read_text(encoding="utf-8")
    for theme in ("kit-tests", "kit-cartons", "kit-coma", "kit-postures", "kit-sablier", "kit-psy", "kit-repos"):
        assert f'id: "{theme}"' in aide
    regles = (STATIQUE / "js/aventuriers/regles.js").read_text(encoding="utf-8")
    assert "Une défense par tour" in regles and "+5 % à tous les tests" in regles
    # Ni l'aide-mémoire ni le carnet ne servent un module de l'atelier qui ne serait pas dans la liste du coin.
    for chemin in ("/static/js/regles/regles.js", "/static/js/regles/rapide.js"):
        assert coin.get(chemin).status_code == 404


# ---- L'échoppe à la TV (E07)

@pytest.fixture()
def bazar(atelier):
    articles = [{"id": f"a{i:02d}", "nom": f"Article {i}", "prix": str(i), "categorie": ["Armes", "Armures", "Curiosités"][i % 3]}
                for i in range(30)]
    b = atelier.post("/api/boutiques", json={"nom": "Le Bazar d'essai", "articles": articles, "ouverte_joueurs": True}).json()
    yield b
    atelier.put("/api/table", json={"vue": "accueil"})
    atelier.delete(f"/api/boutiques/{b['id']}")


def test_le_rayon_ne_part_qu_avec_une_boutique(atelier, bazar):
    j = tv_cartes.jeton("boutiques", bazar["id"])
    assert tv_etat.etat_public({"vue": "boutique", "boutique": bazar["id"], "rayon": 1})["rayon"] == 1
    for tordu in (True, -1, 100, "1", 1.5, None):
        assert "rayon" not in tv_etat.etat_public({"vue": "boutique", "boutique": bazar["id"], "rayon": tordu}), tordu
    assert "rayon" not in tv_etat.etat_public({"vue": "plan", "plan": "x", "rayon": 1})
    # Par le canal de la TV : le jeton de la boutique et le numéro du rayon, rien d'autre de la fiche.
    atelier.put("/api/table", json={"vue": "boutique", "boutique": bazar["id"], "rayon": 1, "article": None})
    public = tv_etat.etat_public(tv_ecran.etat_table())
    assert public["boutique"] == j and public["rayon"] == 1 and bazar["id"] not in json.dumps(public)


def test_l_echoppe_ne_renvoie_jamais_au_telephone(atelier, bazar):
    """Règle d'Alban : pendant la partie, rien ne demande aux joueurs de sortir leur téléphone. Boutique ouverte aux
    joueurs et carnet ouvert, l'échoppe de la TV ne le rappelle plus : ni la route, ni la page."""
    j = tv_cartes.jeton("boutiques", bazar["id"])
    ouvrir_carnet(atelier)
    try:
        assert "telephone" not in atelier.get(f"/api/table/boutique/{j}").json()
        # La table publique lit la même échoppe quand la TV la montre, et rien quand elle ne la montre pas.
        atelier.put("/api/table", json={"vue": "accueil"})
        assert atelier.get(f"/api/table/boutique/{j}", headers=CF).status_code != 200
        atelier.put("/api/table", json={"vue": "boutique", "boutique": bazar["id"], "rayon": 0})
        lu = atelier.get(f"/api/table/boutique/{j}", headers=CF)
        assert lu.status_code == 200 and "telephone" not in lu.json() and len(lu.json()["articles"]) == 30
    finally:
        ouvrir_carnet(atelier, False)
    for fichier in ("table.html", "js/table.js", "css/echoppe-tv.css"):
        texte = (STATIQUE / fichier).read_text(encoding="utf-8")
        assert "telephone-tv" not in texte and "Aussi sur votre téléphone" not in texte, fichier
    # La pancarte « Rayon 1 sur 2 » reste.
    assert 'class="page-rayon-tv"' in (STATIQUE / "table.html").read_text(encoding="utf-8")


def test_la_tv_et_l_atelier_comptent_les_memes_rayons():
    """Les pages sont calculées par un seul module, que lisent la TV, l'atelier et la télécommande."""
    table = source_page("table")
    assert "pagesEchoppe(b.articles)" in table and "pageDemandee(pages, etat.rayon)" in table
    for fichier in ("js/boutiques/boutiques.js", "js/boutiques/rayons-telecommande.js"):
        assert "pagesEchoppe(articlesDeLaTv(" in (STATIQUE / fichier).read_text(encoding="utf-8"), fichier
    telecommande = source_page("telecommande")
    for nom in ("htmlRayons", "lireBoutiqueMontree", "rayonApres"):
        assert re.search(rf'import \{{[^}}]*\b{nom}\b[^}}]*\}} from "\.\./boutiques/rayons-telecommande\.js"', telecommande), nom
    assert '"rayon"' in re.search(r"const DESIGNE = \[[^\]]*\]", (STATIQUE / "js/ecran-tv/tv-commun.js").read_text(encoding="utf-8")).group(0)
    assert "/static/css/echoppe-tv.css" in (STATIQUE / "table.html").read_text(encoding="utf-8")
    css = (STATIQUE / "css/echoppe-tv.css").read_text(encoding="utf-8")
    sans_commentaires = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    for interdit in (r"\bgap\s*:", r"\binset\s*:", r":has\(", r"aspect-ratio"):
        assert not re.search(interdit, sans_commentaires), interdit


# ---- La couleur à l'accueil (E06)

def test_la_couleur_que_la_tv_donnera():
    velora = {"id": "velora", "couleur": "#b3261e"}
    eloran = {"id": "eloran", "couleur": "#01006e"}
    prise = couleurs_tv.pour_un_nouveau([velora, eloran], "#b3261e")
    assert prise["pourquoi"] == "prise" and prise["comme"] == "velora" and prise["tv"] in couleurs_tv.PALETTE
    # Elle est la couleur que la TV montrera vraiment, une fois le héros accueilli.
    assert couleurs_tv.distinctes([velora, eloran, {"id": "gerd", "couleur": "#b3261e"}])["gerd"] == prise["tv"]
    sombre = couleurs_tv.pour_un_nouveau([velora], "#1a0d05")
    assert sombre["pourquoi"] == "sombre" and sombre["comme"] == "" and sombre["tv"] == couleurs_tv.lisible("#1a0d05")
    # Le bleu nuit d'Eloran, éclairci pour lui à la TV : un nouveau du même bleu se heurte à lui.
    assert couleurs_tv.pour_un_nouveau([velora, eloran], "#01006e")["comme"] == "eloran"
    assert couleurs_tv.pour_un_nouveau([velora, eloran], "#16a085") is None
    for illisible in ("", "rouge", None, "#12"):
        assert couleurs_tv.pour_un_nouveau([velora], illisible) is None


def test_l_accueil_dit_et_donne_la_couleur_de_la_tv(atelier, coin_pour):
    crees = []
    pris = atelier.post("/api/aventuriers", json={"nom": "Aldwin Rougeterre", "joueur": "Nora", "tablee": True, "couleur": "#c62828"}).json()
    crees.append(pris["id"])
    invites = []
    try:
        for nom, couleur in (("Ilan", "#c62828"), ("Jade", "#c62828"), ("Pia", "#f48fb1")):
            j = atelier.post("/api/joueurs", json={"nom": nom}).json()
            invites.append(j)
            coin = coin_pour(j)
            coin.post("/api/moi/aventurier", json={"nom": f"Héros de {nom}", "couleur": couleur})
            coin.post("/api/moi/envoyer")
        cartes = {j["nom"]: j for j in atelier.get("/api/joueurs").json()}
        avis = cartes["Ilan"]["couleur_tv"]
        assert avis["pourquoi"] == "prise" and avis["comme"] == "Aldwin Rougeterre (Nora)" and avis["tv"] != "#c62828"
        assert cartes["Ilan"]["couleur"] == "#c62828"
        # Accueilli avec la couleur de la TV : l'atelier la garde, la TV la montre telle quelle.
        a = atelier.post(f"/api/joueurs/{invites[0]['id']}/accueillir", json={"couleur": avis["tv"]}).json()
        crees.append(a["id"])
        assert a["couleur"] == avis["tv"]
        assert {h["nom"]: h["couleur"] for h in atelier.get("/api/table/heros").json()}["Héros de Ilan"] == avis["tv"]
        # Avec sa couleur : il la garde dans l'atelier, la TV en montre une autre.
        b = atelier.post(f"/api/joueurs/{invites[1]['id']}/accueillir").json()
        crees.append(b["id"])
        assert b["couleur"] == "#c62828"
        assert {h["nom"]: h["couleur"] for h in atelier.get("/api/table/heros").json()}["Héros de Jade"] != "#c62828"
        # Une couleur libre n'appelle aucun avis ; une couleur tordue est refusée.
        assert {j["nom"]: j for j in atelier.get("/api/joueurs").json()}["Pia"]["couleur_tv"] is None
        for tordue in ("rouge", "#c62", 12, "#c62828; x"):
            assert atelier.post(f"/api/joueurs/{invites[2]['id']}/accueillir", json={"couleur": tordue}).status_code == 400, tordue
        # Les invitations et l'accueil restent à l'atelier.
        assert atelier.get("/api/joueurs", headers=CF).status_code == 404
        assert atelier.post(f"/api/joueurs/{invites[2]['id']}/accueillir", json={}, headers=CF).status_code == 404
    finally:
        for j in invites:
            atelier.delete(f"/api/joueurs/{j['id']}")
        for ident in crees:
            atelier.delete(f"/api/aventuriers/{ident}")


def test_le_createur_choisit_la_caracteristique_en_p_s_m():
    createur = (STATIQUE / "js/aventuriers/createur.js").read_text(encoding="utf-8")
    assert 'data-cc="avec" aria-label="Caractéristique"' not in createur and '<select data-comp="${i}" data-cc="avec"' not in createur
    assert 'type="radio" name="avec-${i}"' in createur and 'role="radiogroup"' in createur and 'class="nom-psm"' in createur
    assert 'el.type === "radio"' in createur
