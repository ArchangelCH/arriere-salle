"""La TV lisible du canapé et la table publique : des portraits réduits pour un écran d'Internet (la TV du salon garde
les siens), la lettre courte d'un pion qui ne dit plus qui il est, des couleurs de héros distinctes et visibles, un nom
de l'auberge choisi par le MJ (le vrai reste caché partout), le témoin qui dit quand l'ordre du combat est à la TV, et
l'accueil de la TV (indice du plein écran, plan tout noir)."""

import io
import os
import re
import sys
import tempfile
import time
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from table import couleurs_tv  # noqa: E402
import main  # noqa: E402
from api import application, config, noms_caches, tv_cartes, utilitaires  # noqa: E402
from table import masque  # noqa: E402
from sources_front import source_page  # noqa: E402

J = tv_cartes.jeton
CF = {"CF-Connecting-IP": "203.0.113.7"}
STATIQUE = Path(__file__).resolve().parent.parent / "app" / "static"
W, H = 4, 2


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture(autouse=True)
def table_ouverte(client):
    config.TABLE_OUVERTURE.unlink(missing_ok=True)
    yield
    config.TABLE_OUVERTURE.unlink(missing_ok=True)
    client.put("/api/table", json={"vue": "accueil"})


@pytest.fixture()
def portrait():
    """Un grand portrait en PNG avec transparence, comme ceux que tire la tablée."""
    nom = "portrait-essai-canape.png"
    chemin = config.IMAGES / nom
    config.IMAGES.mkdir(parents=True, exist_ok=True)
    bruit = Image.effect_noise((832, 1216), 60).convert("RGB")  # du grain : une image lourde, comme un vrai portrait
    bruit.putalpha(220)
    bruit.save(chemin)
    yield nom
    chemin.unlink(missing_ok=True)


# ---------------------------------------------------------------- portraits réduits

def test_une_vignette_legere_pour_la_table_publique(client, portrait):
    entier = (config.IMAGES / portrait).stat().st_size
    # Depuis Internet, la vignette d'un portrait que la TV montre (lectures_publiques.medias_cites) : la tablée.
    heros = client.post("/api/aventuriers", json={"nom": "Vignette Canapé", "tablee": True, "sante": 8, "psy": 4}).json()
    fiche = utilitaires.lire(config.AVENTURIERS / f"{heros['id']}.json")
    fiche.update(illustration=f"/media/{portrait}", illustrations=[{"url": f"/media/{portrait}"}])
    utilitaires.ecrire(config.AVENTURIERS / f"{heros['id']}.json", fiche)
    client.put("/api/table", json={"vue": "heros"})
    r = client.get(f"/api/table/vignette/{portrait}?l=300", headers=CF)
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert "immutable" in r.headers["cache-control"] and "gzip" not in r.headers.get("content-encoding", "")
    with Image.open(io.BytesIO(r.content)) as im:
        assert im.width == 320 and im.height <= 640  # la largeur permise qui couvre la demande
    assert len(r.content) * 5 < entier
    # Trois largeurs seulement ; rien d'autre que les images de l'atelier, et rien qui remonte d'un dossier.
    with Image.open(io.BytesIO(client.get(f"/api/table/vignette/{portrait}?l=5000").content)) as im:
        assert im.width == 640
    for nom in ("..%2Ftable.json", "table.json", "inconnue.jpg", ".cache"):
        assert client.get(f"/api/table/vignette/{nom}").status_code == 404, nom
    # La table publique fermée n'en lit aucune.
    client.put("/api/table-publique", json={"ouverte": False})
    assert client.get(f"/api/table/vignette/{portrait}", headers=CF).status_code == 404
    client.put("/api/table-publique", json={"ouverte": True})
    client.delete(f"/api/aventuriers/{heros['id']}")


def test_l_ecran_d_internet_sait_qu_il_vient_d_internet(client):
    client.put("/api/table", json={"vue": "heros"})
    with client.websocket_connect("/ws/table", headers=CF) as dehors, client.websocket_connect("/ws/table") as salon:
        assert dehors.receive_json()["etat"]["internet"] is True
        assert "internet" not in salon.receive_json()["etat"]
    table = source_page("table")
    # Les portraits passent par leur version réduite seulement pour un écran d'Internet.
    assert "internet = etat.internet === true;" in table and "/api/table/vignette/" in table
    for appel in ("medaillonTv(a)", "leger(p.illustration, 640)", "leger(lieu.illustration, 640)", "leger(b.portrait, 320)",
                  # Les pions et les images posées sur le plan : allegerPlan, dans tv-commun.js.
                  "allegerPlan(p, leger);"):
        assert appel in table, appel
    commun = (STATIQUE / "js" / "ecran-tv/tv-commun.js").read_text(encoding="utf-8")
    # Une image du MJ garde sa transparence : la vignette en PNG (a=1) ; posée sur le plan, 640 px comme au coin.
    for appel in ("t.image = leger(t.image, 160, t.image_libre === true)", 'if (o && o.cle === "image") o.image = leger(o.image, 640, true)'):
        assert appel in commun, appel


# ---------------------------------------------------------------- la lettre courte des pions

def test_la_lettre_courte_ne_dit_plus_qui_est_le_pion(client):
    inconnue = client.post("/api/pnj", json={"nom": "Aude Secrète", "connu": False}).json()
    connue = client.post("/api/pnj", json={"nom": "Odile Connue", "connu": True}).json()
    heros = client.post("/api/aventuriers", json={"nom": "Vortan Lettre", "sante": 8, "psy": 4, "tablee": True}).json()
    pions = [
        {"id": "a", "genre": "ennemi", "ref": f"pnj:{inconnue['id']}", "nom": "Aude Secrète", "court": "Au", "x": 0.5, "y": 0.5},
        {"id": "b", "genre": "ennemi", "ref": "bestiaire:brigand", "nom": "Brigand", "court": "B", "x": 1.5, "y": 0.5},
        {"id": "c", "genre": "ennemi", "ref": "bestiaire:brigand", "nom": "Brigand", "court": "2", "x": 2.5, "y": 0.5},
        {"id": "d", "genre": "ennemi", "ref": "bestiaire:brigand", "nom": "Homme de Clémence", "court": "G1", "x": 3.5, "y": 0.5},
        {"id": "e", "genre": "ennemi", "ref": f"pnj:{connue['id']}", "nom": "Odile Connue", "court": "O", "x": 0.5, "y": 1.5},
        {"id": "f", "genre": "pnj", "ref": f"pnj:{inconnue['id']}", "nom": "Aude Secrète", "court": "AS", "x": 1.5, "y": 1.5},
        {"id": "g", "genre": "heros", "ref": f"aventurier:{heros['id']}", "nom": "Vortan Lettre", "court": "V", "x": 2.5, "y": 1.5},
    ]
    plan = client.post("/api/plans", json={"nom": "Lettres", "largeur": W, "hauteur": H, "brouillard_actif": False,
                                           "sol": [2] * (W * H), "piece": [1] * (W * H), "pions": pions}).json()
    recu = {t["id"]: t for t in client.get(f"/api/table/plan/{J('plans', plan['id'])}").json()["pions"]}
    assert recu["a"]["court"] == "" and recu["b"]["court"] == "" and recu["f"]["court"] == ""
    assert recu["c"]["court"] == "2" and recu["d"]["court"] == "G1"
    assert recu["e"]["court"] == "O" and recu["g"]["court"] == "V"  # leur nom est déjà montré
    texte = client.get(f"/api/table/plan/{J('plans', plan['id'])}").text
    assert "Aude" not in texte and '"Au"' not in texte
    # Sur la TV, un ennemi sans numéro ni nom porte le losange des ennemis, aucune lettre.
    rendu = (STATIQUE / "js" / "plan" / "rendu.js").read_text(encoding="utf-8")
    assert "joueurs && t.genre === \"ennemi\" && !numero && !t.nom" in rendu and "losangeEnnemi(ctx" in rendu
    for collection, ident in (("plans", plan["id"]), ("pnj", inconnue["id"]), ("pnj", connue["id"]), ("aventuriers", heros["id"])):
        client.delete(f"/api/{collection}/{ident}")


# ---------------------------------------------------------------- les couleurs des héros

def test_une_couleur_sombre_s_eclaircit_et_deux_heros_ne_partagent_pas_la_leur():
    assert couleurs_tv.lisible("#01006e") != "#01006e" and couleurs_tv.luminance(couleurs_tv.rvb(couleurs_tv.lisible("#01006e"))) >= couleurs_tv.LUMINANCE_MIN
    for couleur in ("#b3261e", "#ae00ff", "#96d35f"):
        assert couleurs_tv.lisible(couleur) == couleur  # visible déjà : telle quelle
    assert couleurs_tv.lisible("rouge") == "" and couleurs_tv.lisible("") == ""
    choix = couleurs_tv.distinctes([{"id": "velora", "couleur": "#b3261e"}, {"id": "gerd", "couleur": "#b3261e"}, {"id": "sans", "couleur": ""}])
    assert choix["velora"] == "#b3261e" and choix["gerd"] != "#b3261e" and "sans" not in choix
    assert couleurs_tv.ecart(couleurs_tv.rvb(choix["gerd"]), couleurs_tv.rvb("#b3261e")) >= couleurs_tv.ECART_MIN
    # Une teinte proche (un autre rouge) se départage aussi ; la couleur libre ne prend pas celle d'un autre héros.
    choix = couleurs_tv.distinctes([{"id": "a", "couleur": "#b3261e"}, {"id": "b", "couleur": "#c0392b"}, {"id": "c", "couleur": "#d9a21b"}])
    assert choix["b"] not in ("#c0392b", "#d9a21b", "#b3261e")


def test_la_tv_montre_partout_la_meme_couleur_d_un_heros(client):
    creer = lambda nom, couleur: client.post("/api/aventuriers", json={"nom": nom, "couleur": couleur, "sante": 8, "psy": 4, "tablee": True}).json()  # noqa: E731
    nuit = creer("Eloran Nuit", "#01006e")
    time.sleep(0.01)  # l'ordre d'arrivée à la tablée départage deux couleurs pareilles (date au millième)
    rouge = creer("Velora Rouge", "#b3261e")
    time.sleep(0.01)
    double = creer("Gerd Double", "#b3261e")
    heros = {h["nom"]: h["couleur"] for h in client.get("/api/table/heros").json()}
    fiches = {h["nom"]: h["couleur"] for h in client.get("/api/table/fiches").json()}
    assert heros["Eloran Nuit"] == couleurs_tv.lisible("#01006e") and heros["Velora Rouge"] == "#b3261e"
    assert heros["Gerd Double"] not in ("#b3261e", "") and fiches == {k: v for k, v in heros.items() if k in fiches}
    assert client.get(f"/api/table/aventurier/{J('aventuriers', double['id'])}").json()["couleur"] == heros["Gerd Double"]
    # Le pion d'un héros prend la même couleur que sa ligne de la tablée.
    pions = [{"id": "e", "genre": "heros", "ref": f"aventurier:{nuit['id']}", "nom": "Eloran Nuit", "couleur": "#01006e", "x": 0.5, "y": 0.5}]
    plan = client.post("/api/plans", json={"nom": "Couleurs", "largeur": W, "hauteur": H, "brouillard_actif": False,
                                           "sol": [2] * (W * H), "piece": [1] * (W * H), "pions": pions}).json()
    pion = client.get(f"/api/table/plan/{J('plans', plan['id'])}").json()["pions"][0]
    assert pion["couleur"] == heros["Eloran Nuit"]
    # L'atelier garde la couleur choisie.
    assert client.get(f"/api/aventuriers/{nuit['id']}").json()["couleur"] == "#01006e"
    for collection, ident in (("plans", plan["id"]), ("aventuriers", nuit["id"]), ("aventuriers", rouge["id"]), ("aventuriers", double["id"])):
        client.delete(f"/api/{collection}/{ident}")


# ---------------------------------------------------------------- le nom de l'auberge pour les joueurs

@pytest.fixture()
def nom_par_defaut(client):
    yield
    client.put("/api/nom-auberge", json={"nom": ""})
    noms_caches.NOM_AUBERGE.unlink(missing_ok=True)


def test_l_apposition_du_mj_remplace_le_nom_cache():
    assert masque.masquer("Trois inconnus se sont rencontrés à la Petite Fanfrelée, l'auberge de Toma.") \
        == "Trois inconnus se sont rencontrés à l'auberge de Toma."
    assert masque.masquer("Le patron de la Petite Fanfrelée, l'auberge de la ville basse.") == "Le patron de l'auberge de la ville basse."
    assert masque.masquer("À la Petite Fanfrelée, l'auberge de Toma, ils ont bu.") == "À l'auberge de Toma, ils ont bu."
    # Sans apposition, rien ne change.
    assert masque.masquer("Ils ont dormi à la Petite Fanfrelée.") == "Ils ont dormi à l'auberge."


def test_le_mj_choisit_le_nom_que_lisent_les_joueurs(client, nom_par_defaut):
    assert client.get("/api/nom-auberge").json() == {"nom": "", "defaut": "l'auberge", "public": "l'auberge",
                                                      "exemples": ["L'auberge", "Ils ont dormi à l'auberge.", "Le comptoir de l'auberge"]}
    lieu = client.post("/api/lieux", json={"nom": "La Petite Fanfrelée", "type": "auberge", "connu": True,
                                           "resume": "On boit à la Petite Fanfrelée."}).json()
    seance = client.post("/api/seances", json={"nom": "Séance du nom", "precedemment": "Ils ont dormi à la Petite Fanfrelée."}).json()
    r = client.put("/api/nom-auberge", json={"nom": "  le   Chaudron  "})
    assert r.status_code == 200 and r.json()["nom"] == "le Chaudron" and r.json()["exemples"][1] == "Ils ont dormi au Chaudron."
    carton = client.get(f"/api/table/lieu/{J('lieux', lieu['id'])}").json()
    assert carton["nom"] == "Le Chaudron" and carton["resume"] == "On boit au Chaudron."
    recit = client.get(f"/api/table/precedemment/{J('seances', seance['id'])}").json()["texte"]
    assert recit == "Ils ont dormi au Chaudron." and "Fanfrel" not in client.get(f"/api/table/lieu/{J('lieux', lieu['id'])}").text
    # Gardé sur le disque : relu au démarrage.
    assert noms_caches.lire_nom_auberge() == "le Chaudron"
    # Le vrai nom ne passe jamais, même glissé dans le nom choisi ; rien de trop long ni d'étrange non plus.
    for refuse in ("La Petite Fanfrelée", "Chez la Fanfrelée", "x" * 61, "<b>Auberge</b>", "1234"):
        assert client.put("/api/nom-auberge", json={"nom": refuse}).status_code == 400, refuse
    assert client.get("/api/nom-auberge").json()["nom"] == "le Chaudron"
    # Vide : de nouveau « l'auberge ».
    assert client.put("/api/nom-auberge", json={"nom": ""}).json()["public"] == "l'auberge"
    assert client.get(f"/api/table/lieu/{J('lieux', lieu['id'])}").json()["nom"] == "L'auberge"
    client.delete(f"/api/lieux/{lieu['id']}")
    client.delete(f"/api/seances/{seance['id']}")


def test_le_nom_de_l_auberge_se_regle_du_salon_seulement(client, nom_par_defaut):
    assert client.get("/api/nom-auberge", headers=CF).status_code == 404
    assert client.put("/api/nom-auberge", json={"nom": "La Taverne"}, headers=CF).status_code == 404
    assert client.get("/api/nom-auberge").json()["nom"] == ""
    # Un inconnu nommé dans le nom choisi : l'atelier le dit.
    pnj = client.post("/api/pnj", json={"nom": "Corentin Vasselin", "connu": False}).json()
    r = client.put("/api/nom-auberge", json={"nom": "l'auberge de Corentin Vasselin"}).json()
    assert ("Corentin Vasselin" in [x["nom"] for x in r["secrets"]])
    client.delete(f"/api/pnj/{pnj['id']}")
    bloc = (STATIQUE / "js" / "auberge/nom-auberge.js").read_text(encoding="utf-8")
    # Le bloc vit dans la page Réglages, section Table et TV (reglages/principal.js), chez le compte principal.
    reglages = (STATIQUE / "js" / "reglages" / "principal.js").read_text(encoding="utf-8")
    assert 'api.put("/api/nom-auberge"' in bloc and "ajouterBlocNomAuberge(table)" in reglages
    assert "Fanfrel" not in bloc


# ---------------------------------------------------------------- le témoin, l'accueil et l'échoppe

def test_le_temoin_dit_quand_l_ordre_du_combat_est_a_la_tv():
    commun = (STATIQUE / "js" / "ecran-tv/tv-commun.js").read_text(encoding="utf-8")
    etat = (STATIQUE / "js" / "ecran-tv/etat-tv.js").read_text(encoding="utf-8")
    temoin = (STATIQUE / "js" / "ecran-tv/temoin-tv.js").read_text(encoding="utf-8")
    assert '"titre", "combat"]' in commun and "export const combatTv" in commun
    assert "combat: combatTv(t)" in etat and "avec l'ordre du combat en haut" in etat
    assert '" · combat"' in temoin and "z.dataset.combat" in temoin


def test_l_accueil_de_la_tv():
    table = source_page("table")
    html = (STATIQUE / "table.html").read_text(encoding="utf-8")
    # La LG se pilote d'une télécommande à pointeur : l'indice dit le bon geste, et s'efface au premier envoi du MJ.
    assert "Cliquez avec la télécommande pour passer en plein écran" in table and 'if (quoi !== "accueil") indice.classList.add("cache");' in table
    assert "!possible || deja" in table
    # Un plan tout noir porte le losange et « … ».
    assert "montrerAttente(rienDeRevele(S.vuePlan.plan))" in table and 'class="attente-tv"' in html and "…" in html
    # Sur un téléphone tenu en hauteur, le plan demande qu'on tourne le téléphone.
    assert "Tournez votre téléphone" in html
    css = (STATIQUE / "css" / "table.css").read_text(encoding="utf-8")
    assert re.search(r"@media \(max-width: 599px\) and \(orientation: portrait\) \{\s*body\[data-vue=\"plan\"\] \.tourner", css)


def test_l_echoppe_a_trois_metres():
    table = source_page("table")
    article = re.search(r"function htmlArticleTv\(a, k\) \{(.*?)\n\}", table, flags=re.S).group(1)
    # Le nom et le prix seulement : la description attend « de près ».
    assert "a.description" not in article and "a.description" in re.search(r"function htmlArticleDePres\(a\) \{(.*?)\n\}", table, flags=re.S).group(1)
    assert 'import { DESSIN, disposition, pageDemandee, pagesEchoppe } from "../boutiques/rayons-tv.js";' in table


def test_le_carton_d_un_lieu_tient_sur_un_telephone():
    """Sur la table publique d'un téléphone en portrait, le carton d'un lieu prend la largeur de l'écran comme celui d'un
    PNJ : « Clairefonds » ne déborde plus du parchemin (le nom gardait sa taille de TV, 28 px au moins)."""
    css = (STATIQUE / "css" / "table.css").read_text(encoding="utf-8")
    tel = css[css.index("@media (max-width: 599px) {"):]
    tel = tel[:tel.index("\n}\n")]
    assert ".carton { right: 4vw; bottom: 2.5vh; left: 4vw; max-width: none;" in tel
    assert ".carton .texte { flex: 1 1 auto; min-width: 0; overflow: hidden;" in tel
    assert ".carton .nom { font-size: 6vw; overflow-wrap: break-word; }" in tel
    # La TV (Chromium 79) ne lit ni gap en flexbox, ni inset, ni :has, ni aspect-ratio.
    assert not re.search(r"\binset:|:has\(|aspect-ratio", tel)
