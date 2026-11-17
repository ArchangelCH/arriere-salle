"""Les portraits des joueurs (portraits.py, portraits_mj.py, lot P) : chacun voit le portrait de son héros, carnet ouvert ou
fermé, en choisit un autre parmi ceux de ce héros (appliqué seul, annulable par le MJ), ou envoie sa propre image, que le
MJ accepte ou refuse dans sa boîte.

Fuite : un joueur ne voit ni ne choisit le portrait d'un autre héros ; aucun nom de fichier de l'atelier, aucune adresse
/media/ ne sort ; une illustration gardée secrète ne sort pas ; les métadonnées d'une image envoyée (lieu, appareil,
profil, commentaire) sont retirées ; une image envoyée n'est visible que de son joueur et du MJ tant qu'elle n'est pas
acceptée. Images piégées : faux PNG, image géante, bombe de décompression, SVG, HEIC, trop petite, trop lourde."""
import io
import json
import os
import re
import struct
import sys
import tempfile
import time
import zlib
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image, ImageCms  # noqa: E402

from commun import carnet  # noqa: E402
from commun import demandes  # noqa: E402
from commun import flux_coin  # noqa: E402
import joueurs  # noqa: E402
from commun import portraits  # noqa: E402
from comptes_coin import entrer, sans_version  # noqa: E402
import main  # noqa: E402
from api import actions_coin, application, carnet_api, config, tv_cartes, utilitaires  # noqa: E402

TRACE = "TRACE-SECRETE-GPS"


def attendre(condition, delai=6.0):
    fin = time.monotonic() + delai
    while time.monotonic() < fin:
        r = condition()
        if r:
            return r
        time.sleep(0.05)
    return None


def image(fmt="JPEG", taille=(600, 800), couleur=(150, 90, 40), **options) -> bytes:
    sortie = io.BytesIO()
    Image.new("RGB", taille, couleur).save(sortie, fmt, **options)
    return sortie.getvalue()


def image_atelier(couleur) -> str:
    """Une image déposée dans l'atelier, comme un portrait peint : rend son adresse /media/."""
    nom = f"portrait-essai-{os.urandom(6).hex()}.jpg"
    Image.new("RGB", (300, 400), couleur).save(config.IMAGES / nom, "JPEG")
    return f"/media/{nom}"


@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture(scope="module")
def tablee(atelier):
    """Deux joueurs dont les héros sont à la tablée : Ysolde (Aube) a trois portraits, dont un gardé secret ; Tavarède
    (Basile) en a deux. Tout est retiré à la fin."""
    patch = pytest.MonkeyPatch()
    patch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    patch.setattr(joueurs, "COOKIE_SUR", False)
    patch.setattr(joueurs, "HOTES", set())
    patch.setattr(joueurs, "DEMANDES_FAITES", {})
    t = {}
    for code, nom, heros, couleurs in (("a", "Aube", "Ysolde Gris", [(200, 30, 30), (30, 200, 30), (30, 30, 200)]),
                                       ("b", "Basile", "Tavarède Brume", [(220, 220, 30), (30, 220, 220)])):
        invite = atelier.post("/api/joueurs", json={"nom": nom}).json()
        coin = TestClient(joueurs.app)
        entrer(coin, invite)
        coin.post("/api/moi/aventurier", json={"nom": heros, "sante": 9, "psy": 5})
        coin.post("/api/moi/envoyer")
        fiche = atelier.post(f"/api/joueurs/{invite['id']}/accueillir").json()
        urls = [image_atelier(c) for c in couleurs]
        for url in urls:
            r = atelier.post(f"/api/aventuriers/{fiche['id']}/illustrations", json={"url": url, "source": "ia", "prompt": "a secret prompt"})
            assert r.status_code == 200, r.text
        t[code] = {"joueur": invite, "coin": coin, "heros": fiche, "urls": urls}
    # Le dernier portrait d'Ysolde est gardé secret par le MJ : il ne sort pas.
    chemin = config.AVENTURIERS / f"{t['a']['heros']['id']}.json"
    f = utilitaires.lire(chemin)
    f["illustrations"][-1]["secrete"] = True
    utilitaires.ecrire(chemin, f)
    avant = carnet_api.carnet_ouvert()
    atelier.put("/api/carnet-joueurs", json={"ouvert": True})
    actions_coin.portraits_joueurs.publier()
    yield t
    for code in ("a", "b"):
        t[code]["coin"].close()
        atelier.delete(f"/api/joueurs/{t[code]['joueur']['id']}")
        atelier.delete(f"/api/aventuriers/{t[code]['heros']['id']}")
    atelier.put("/api/carnet-joueurs", json={"ouvert": avant})
    demandes.ecrire_pause(config.PROPOSITIONS, False)
    actions_coin.portraits_joueurs.publier()
    patch.undo()


@pytest.fixture()
def neuf(atelier, tablee):
    """Chaque essai part d'une file vide, sans image envoyée, de son premier portrait, et d'un plafond horaire vide."""
    for code in ("a", "b"):
        jid = tablee[code]["joueur"]["id"]
        with demandes.verrou(config.PROPOSITIONS):
            demandes.fichier(config.PROPOSITIONS, jid).unlink(missing_ok=True)
        dossier = config.PROPOSITIONS / portraits.ENVOIS / jid
        if dossier.is_dir():
            for f in dossier.iterdir():
                f.unlink()
        r = atelier.put(f"/api/aventuriers/{tablee[code]['heros']['id']}/illustration", json={"url": tablee[code]["urls"][0]})
        assert r.status_code == 200, r.text
    joueurs.DEMANDES_FAITES.clear()
    joueurs.ENVOIS_ESSAYES.clear()
    demandes.ecrire_pause(config.PROPOSITIONS, False)
    actions_coin.portraits_joueurs.publier()
    yield


def etat(t, code) -> dict:
    r = t[code]["coin"].get("/api/portraits")
    assert r.status_code == 200, r.text
    return r.json()


def cle(t, code) -> str:
    invites = json.loads((config.PROPOSITIONS / ".acces.json").read_text(encoding="utf-8"))["joueurs"]
    return carnet.cle_heros(next(j["jeton"] for j in invites if j["id"] == t[code]["joueur"]["id"]))


def fiche(atelier, t, code) -> dict:
    return atelier.get(f"/api/aventuriers/{t[code]['heros']['id']}").json()


def traitee(t, code, ident):
    def lue():
        d = demandes.trouver(demandes.lire(config.PROPOSITIONS, t[code]["joueur"]["id"]), ident)
        return d if d and d["statut"] != demandes.A_APPLIQUER else None
    d = attendre(lue)
    assert d, "l'atelier n'a pas traité la demande"
    return d


def envoyer(t, code, octets: bytes, type_="image/jpeg", requete=""):
    return t[code]["coin"].post(f"/api/portraits/envoi{requete}", content=octets, headers={"Content-Type": type_})


# ---------------------------------------------------------------- voir son portrait, carnet ouvert ou fermé

def test_le_heros_voit_son_portrait_carnet_ouvert_ou_ferme(atelier, tablee, neuf):
    e = etat(tablee, "a")
    assert e["heros"]["nom"] == "Ysolde Gris" and e["publie"] is True
    assert len(e["portraits"]) == 2 and e["actuel"] == e["portraits"][0]["url"] and e["portraits"][0]["actuel"] is True
    r = tablee["a"]["coin"].get(e["actuel"])
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    # L'onglet « Héros » montre la fiche et le portrait, plus le créateur ; la fiche envoyée se relit à part.
    page = tablee["a"]["coin"].get("/").text
    assert "/static/js/joueurs/heros-coin.js" in sans_version(page) and "joueur.js" not in page
    assert "/static/js/joueurs/joueur.js" in sans_version(tablee["a"]["coin"].get("/fiche-envoyee").text)
    for chemin in ("/static/js/joueurs/heros-coin.js", "/static/js/joueurs/portrait-coin.js", "/static/css/portrait-coin.css"):
        assert tablee["a"]["coin"].get(chemin).status_code == 200, chemin
    try:
        atelier.put("/api/carnet-joueurs", json={"ouvert": False})
        assert not carnet.est_ouvert(config.PROPOSITIONS)
        ferme = etat(tablee, "a")
        assert ferme["actuel"] == e["actuel"]
        assert tablee["a"]["coin"].get(ferme["actuel"]).status_code == 200
        assert "heros-coin.js" in tablee["a"]["coin"].get("/").text
    finally:
        atelier.put("/api/carnet-joueurs", json={"ouvert": True})


def test_un_joueur_sans_heros_garde_le_createur(tablee):
    coin = TestClient(joueurs.app)
    invite = TestClient(application.app).post("/api/joueurs", json={"nom": "Camille"}).json()
    try:
        entrer(coin, invite)
        assert "/static/js/joueurs/joueur.js" in sans_version(coin.get("/").text)
        assert coin.get("/api/portraits").json()["heros"] is None
        r = coin.post("/api/portraits/envoi", content=image(), headers={"Content-Type": "image/jpeg"})
        assert r.status_code == 409
    finally:
        coin.close()
        TestClient(application.app).delete(f"/api/joueurs/{invite['id']}")


# ---------------------------------------------------------------- fuite

def test_rien_de_l_atelier_ne_sort(atelier, tablee, neuf):
    for code in ("a", "b"):
        brut = json.dumps(etat(tablee, code))
        index = (config.PROPOSITIONS / portraits.DOSSIER / cle(tablee, code) / portraits.INDEX).read_text(encoding="utf-8")
        for texte in (brut, index):
            # Une adresse de l'atelier (/media/…) ; celles du coin (/portraits/media/…) ne sont que des noms tirés de la clé.
            assert not re.search(r"(?<![a-z])/media/", texte) and "portrait-essai" not in texte and "secret prompt" not in texte
            assert all(Path(u).name not in texte for c in ("a", "b") for u in tablee[c]["urls"])
        dossier = config.PROPOSITIONS / portraits.DOSSIER / cle(tablee, code)
        assert all(portraits.NOM.match(f.name) or f.name == portraits.INDEX for f in dossier.iterdir())
        # Les miniatures sont réécrites sans métadonnées.
        for f in dossier.glob("*.jpg"):
            with Image.open(f) as im:
                assert "exif" not in im.info and "icc_profile" not in im.info
    # Le portrait gardé secret ne sort pas.
    assert len(etat(tablee, "a")["portraits"]) == 2
    # Rien sous carnet/media ni à la racine des propositions.
    assert not list((config.PROPOSITIONS / carnet.CARNET / carnet.MEDIA).glob("portrait*"))


def test_un_joueur_ne_voit_ni_ne_choisit_le_portrait_d_un_autre(atelier, tablee, neuf):
    a, b = etat(tablee, "a"), etat(tablee, "b")
    noms_b = {p["nom"] for p in b["portraits"]}
    assert noms_b and not noms_b & {p["nom"] for p in a["portraits"]}
    for nom in noms_b:
        assert tablee["a"]["coin"].get(f"/portraits/media/{nom}").status_code == 404
        r = tablee["a"]["coin"].post("/api/demandes", json={"genre": "portrait-choisi", "corps": {"portrait": nom}})
        assert r.status_code == 409, r.text
    # Même écrite à la main dans la file, l'atelier ne trouve ce nom que parmi les portraits de CE héros.
    d = demandes.nouvelle({"genre": "portrait-choisi", "corps": {"portrait": next(iter(noms_b))}})
    with demandes.verrou(config.PROPOSITIONS):
        demandes.ecrire(config.PROPOSITIONS, tablee["a"]["joueur"]["id"], [d])
    assert traitee(tablee, "a", d["id"])["statut"] == demandes.ECHEC
    assert fiche(atelier, tablee, "a")["illustration"] == tablee["a"]["urls"][0]
    # Ni chemin détourné ni nom mal formé.
    for nom in ("../index.json", "index.json", "%2e%2e%2findex.json", "a" * 24 + ".png"):
        assert tablee["a"]["coin"].get(f"/portraits/media/{nom}").status_code == 404, nom
    for corps in ({"portrait": "../../x"}, {"portrait": "f" * 24 + ".jpg", "url": "/media/x.jpg"}, {"url": "/media/x.jpg"}):
        r = tablee["a"]["coin"].post("/api/demandes", json={"genre": "portrait-choisi", "corps": corps})
        assert r.status_code in (400, 409), corps


# ---------------------------------------------------------------- choisir parmi les siens

def compagnon(code_nom: str):
    """L'image d'un héros dans la compagnie publiée du carnet (ce que lisent les autres joueurs)."""
    s = carnet.publie(config.PROPOSITIONS, "compagnie") or {}
    return next((x.get("illustration") for x in s.get("elements", []) if x.get("nom") == code_nom), None)


def test_choisir_un_portrait_puis_le_mj_annule(atelier, tablee, neuf):
    carnet_api.publier_carnet()
    e = etat(tablee, "a")
    autre = e["portraits"][1]
    avant = compagnon("Ysolde Gris")
    assert avant and avant.startswith("/carnet/media/")
    r = tablee["a"]["coin"].post("/api/demandes", json={"genre": "portrait-choisi", "corps": {"portrait": autre["nom"]}})
    assert r.status_code == 200 and r.json()["statut"] == "a-appliquer", r.text
    d = traitee(tablee, "a", r.json()["id"])
    assert d["statut"] == demandes.APPLIQUEE, d
    f = fiche(atelier, tablee, "a")
    assert f["illustration"] == tablee["a"]["urls"][1]
    assert etat(tablee, "a")["actuel"] == f"/portraits/media/{autre['nom']}"
    # La TV montre le nouveau portrait.
    tv = atelier.get(f"/api/table/aventurier/{tv_cartes.jeton('aventuriers', tablee['a']['heros']['id'])}").json()
    assert tv["illustration"] == tablee["a"]["urls"][1]
    # La compagnie du carnet est republiée aussitôt : les autres joueurs voient le nouveau portrait.
    assert attendre(lambda: compagnon("Ysolde Gris") not in (None, avant), 3.0)
    # Le même, de nouveau : refusé d'emblée.
    r = tablee["a"]["coin"].post("/api/demandes", json={"genre": "portrait-choisi", "corps": {"portrait": autre["nom"]}})
    assert r.status_code == 409
    # La boîte le montre, annulable ; son image se lit dans l'atelier.
    boite = atelier.get("/api/demandes").json()
    x = next(x for x in boite["historique"] if x["id"] == d["id"])
    assert x["annulable"] is True and "Ysolde" in x["phrase"]
    img = atelier.get(f"/api/portraits-joueurs/{tablee['a']['joueur']['id']}/{d['id']}/image")
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"
    r = atelier.post(f"/api/demandes/{tablee['a']['joueur']['id']}/{d['id']}/annuler", json={"version": x["version"]})
    assert r.status_code == 200, r.text
    assert fiche(atelier, tablee, "a")["illustration"] == tablee["a"]["urls"][0]
    assert etat(tablee, "a")["actuel"] == e["actuel"]


def test_annuler_refuse_si_le_mj_a_change_depuis(atelier, tablee, neuf):
    e = etat(tablee, "b")
    r = tablee["b"]["coin"].post("/api/demandes", json={"genre": "portrait-choisi", "corps": {"portrait": e["portraits"][1]["nom"]}})
    d = traitee(tablee, "b", r.json()["id"])
    # Le MJ garde la main : il remet un autre portrait depuis la fiche ; l'« Annuler » ne l'écrase pas.
    atelier.put(f"/api/aventuriers/{tablee['b']['heros']['id']}/illustration", json={"url": tablee["b"]["urls"][0]})
    r = atelier.post(f"/api/demandes/{tablee['b']['joueur']['id']}/{d['id']}/annuler", json={"version": d["version"]})
    assert r.status_code == 409 and "changé" in r.json()["detail"]


# ---------------------------------------------------------------- envoyer sa propre image

def jpeg_avec_traces() -> bytes:
    """Une photo comme celles d'un téléphone : orientée par l'EXIF (couchée), lieu GPS, appareil, profil de couleur."""
    im = Image.new("RGB", (1600, 1200), (120, 60, 30))
    exif = Image.Exif()
    exif[0x010F] = "Apple"  # appareil
    exif[0x0110] = TRACE
    exif[0x0112] = 6  # à tourner d'un quart
    exif.get_ifd(0x8825)[2] = (46.0, 13.0, 30.0)  # latitude
    profil = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    sortie = io.BytesIO()
    im.save(sortie, "JPEG", exif=exif.tobytes(), icc_profile=profil, comment=TRACE.encode())
    return sortie.getvalue()


def test_envoyer_une_image_sans_ses_metadonnees_puis_le_mj_accepte(atelier, tablee, neuf):
    octets = jpeg_avec_traces()
    assert TRACE.encode() in octets
    r = envoyer(tablee, "a", octets)
    assert r.status_code == 200, r.text
    e = r.json()
    [envoi] = e["envois"]
    assert envoi["statut"] == "en-attente" and envoi["retirable"] and envoi["image"].startswith("/portraits/envoi/")
    jid = tablee["a"]["joueur"]["id"]
    fichier = config.PROPOSITIONS / portraits.ENVOIS / jid / f"{envoi['corps']['envoi']}.jpg"
    brut = fichier.read_bytes()
    assert TRACE.encode() not in brut and b"Apple" not in brut and b"Exif" not in brut and b"ICC_PROFILE" not in brut
    with Image.open(fichier) as im:
        assert im.format == "JPEG" and "exif" not in im.info and "icc_profile" not in im.info and "comment" not in im.info
        assert not im.getexif()
        # L'EXIF disait « couchée » : redressée (1200 × 1600), puis recadrée au format portrait et réduite.
        assert im.width * 4 == im.height * 3 and im.width <= portraits.SORTIE[0]
    # Son joueur la voit, l'autre non ; elle n'est pas dans ses portraits tant que le MJ ne l'a pas acceptée.
    assert tablee["a"]["coin"].get(envoi["image"]).status_code == 200
    assert tablee["b"]["coin"].get(envoi["image"]).status_code == 404
    assert all(p["source"] == "mj" for p in etat(tablee, "a")["portraits"])
    # Le MJ la voit dans sa boîte.
    boite = atelier.get("/api/demandes").json()
    x = next(x for x in boite["attente"] if x["id"] == envoi["id"])
    assert x["genre_nom"] == "Portrait envoyé" and "Ysolde" in x["phrase"]
    assert atelier.get(f"/api/portraits-joueurs/{jid}/{envoi['id']}/image").content == brut
    assert atelier.get(f"/api/portraits-joueurs/{jid}/{'0' * 12}/image").status_code == 404
    r = atelier.post(f"/api/demandes/{jid}/{envoi['id']}/accepter", json={"version": x["version"], "mot": "Superbe"})
    assert r.status_code == 200, r.text
    f = fiche(atelier, tablee, "a")
    venue = f["illustrations"][-1]
    assert venue["source"] == "joueur" and venue["joueur"] == jid and venue["joueur_nom"] == "Aube"
    assert f["illustration"] == venue["url"] and utilitaires.media_existant(venue["url"])
    apres = etat(tablee, "a")
    moi = next(p for p in apres["portraits"] if p["actuel"])
    assert moi["source"] == "joueur" and moi["de_vous"] is True
    assert apres["envois"][0]["statut"] == "acceptee" and apres["envois"][0]["mot"] == "Superbe"
    # Acceptée et recopiée par l'atelier : le coin l'efface de son dossier ; la boîte la remontre encore.
    assert not fichier.exists()
    assert atelier.get(f"/api/portraits-joueurs/{jid}/{envoi['id']}/image").status_code == 200


def test_le_mj_refuse_avec_un_mot(atelier, tablee, neuf):
    r = envoyer(tablee, "b", image("PNG", (500, 500), (10, 120, 10)), "image/png")
    assert r.status_code == 200, r.text
    envoi = r.json()["envois"][0]
    x = next(x for x in atelier.get("/api/demandes").json()["attente"] if x["id"] == envoi["id"])
    r = atelier.post(f"/api/demandes/{tablee['b']['joueur']['id']}/{envoi['id']}/refuser", json={"version": x["version"], "mot": "Trop sombre"})
    assert r.status_code == 200
    vu = etat(tablee, "b")["envois"][0]
    assert vu["statut"] == "refusee" and vu["mot"] == "Trop sombre" and vu["image"]
    assert fiche(atelier, tablee, "b")["illustration"] == tablee["b"]["urls"][0]


def test_retirer_son_image(tablee, neuf):
    envoi = envoyer(tablee, "b", image()).json()["envois"][0]
    r = tablee["b"]["coin"].delete(f"/api/demandes/{envoi['id']}")
    assert r.status_code == 200 and r.json()["statut"] == "retiree"
    e = etat(tablee, "b")
    assert e["envois"] == [] and tablee["b"]["coin"].get(envoi["image"]).status_code == 404
    assert not (config.PROPOSITIONS / portraits.ENVOIS / tablee["b"]["joueur"]["id"] / f"{envoi['corps']['envoi']}.jpg").exists()


def test_le_cadre_choisi_a_l_ecran(tablee, neuf):
    # Une image en deux moitiés : à gauche rouge, à droite bleue ; le cadre pris à droite donne du bleu.
    im = Image.new("RGB", (1200, 800), (220, 20, 20))
    im.paste((20, 20, 220), (600, 0, 1200, 800))
    sortie = io.BytesIO()
    im.save(sortie, "PNG")
    r = envoyer(tablee, "a", sortie.getvalue(), "image/png", "?x=0.6&y=0&l=0.4")
    assert r.status_code == 200, r.text
    envoi = r.json()["envois"][0]
    with Image.open(config.PROPOSITIONS / portraits.ENVOIS / tablee["a"]["joueur"]["id"] / f"{envoi['corps']['envoi']}.jpg") as fait:
        rouge, _, bleu = fait.convert("RGB").getpixel((fait.width // 2, fait.height // 2))
        assert bleu > 150 and rouge < 80


def test_cinq_images_en_attente_au_plus(tablee, neuf):
    for _ in range(portraits.EN_ATTENTE_MAX):
        assert envoyer(tablee, "b", image()).status_code == 200
    r = envoyer(tablee, "b", image())
    assert r.status_code == 429 and "5 images" in r.json()["detail"]
    assert len(list((config.PROPOSITIONS / portraits.ENVOIS / tablee["b"]["joueur"]["id"]).glob("*.jpg"))) == portraits.EN_ATTENTE_MAX


def test_les_essais_rates_comptent_aussi(tablee, neuf):
    # Une image refusée coûte son décodage : douze essais en dix minutes, puis le coin attend.
    for _ in range(portraits.ESSAIS_PAR_JOUEUR[0]):
        assert envoyer(tablee, "b", b"pas une image" * 30).status_code == 415
    r = envoyer(tablee, "b", image())
    assert r.status_code == 429 and "quelques minutes" in r.json()["detail"]


def test_le_plafond_horaire_vaut_aussi(tablee, neuf, monkeypatch):
    monkeypatch.setattr(demandes, "PAR_HEURE", 2)
    assert envoyer(tablee, "a", image()).status_code == 200
    assert envoyer(tablee, "a", image()).status_code == 200
    assert envoyer(tablee, "a", image()).status_code == 429


# ---------------------------------------------------------------- images piégées

def png_annonce(largeur: int, hauteur: int) -> bytes:
    """Un PNG minuscule qui annonce des dimensions démesurées : une bombe de décompression."""
    def morceau(genre, donnees):
        return struct.pack(">I", len(donnees)) + genre + donnees + struct.pack(">I", zlib.crc32(genre + donnees) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", largeur, hauteur, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + morceau(b"IHDR", ihdr) + morceau(b"IDAT", zlib.compress(b"\0" * 4096, 9)) + morceau(b"IEND", b"")


@pytest.mark.parametrize("nom, octets, type_, statut, mot", [
    ("faux PNG", b"\x89PNG\r\n\x1a\n" + b"ceci n'est pas une image" * 40, "image/png", 415, "pas une image lisible"),
    ("texte", b"bonjour, je suis un texte" * 20, "image/jpeg", 415, "pas une image lisible"),
    ("bombe", png_annonce(60_000, 60_000), "image/png", 413, "trop grande"),
    ("géante", png_annonce(12_000, 300), "image/png", 413, "trop grande"),
    ("SVG", b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><script>alert(1)</script></svg>',
     "image/svg+xml", 415, "SVG"),
    ("HEIC", b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" + b"\x00" * 400, "image/heic", 415, "HEIC"),
    ("GIF", image("GIF", (400, 400)), "image/gif", 415, "format"),
    ("trop petite", image("JPEG", (120, 160)), "image/jpeg", 400, "trop petite"),
    ("vide", b"", "image/jpeg", 400, "Aucune image"),
    ("JSON", json.dumps({"image": "x"}).encode(), "application/json", 415, "pas une image lisible"),
])
def test_images_piegees_refusees_avec_un_mot_clair(tablee, neuf, nom, octets, type_, statut, mot):
    r = envoyer(tablee, "a", octets, type_)
    assert r.status_code == statut, (nom, r.text)
    assert mot in r.json()["detail"], (nom, r.json())
    assert not list((config.PROPOSITIONS / portraits.ENVOIS / tablee["a"]["joueur"]["id"]).glob("*.jpg"))
    assert demandes.lire(config.PROPOSITIONS, tablee["a"]["joueur"]["id"]) == []


def test_trop_lourde_avant_meme_d_etre_lue(tablee, neuf):
    r = envoyer(tablee, "a", b"\xff\xd8" + b"\0" * (portraits.OCTETS_MAX + 10))
    assert r.status_code == 413


def test_la_garde_ne_s_ouvre_qu_ici(tablee, neuf):
    coin = tablee["a"]["coin"]
    # Ailleurs, toujours du JSON et 256 Ko au plus.
    assert coin.post("/api/demandes", content=image(), headers={"Content-Type": "image/jpeg"}).status_code == 415
    assert coin.post("/api/demandes", content=b"x" * (300 * 1024), headers={"Content-Type": "application/json"}).status_code == 413
    # Ici aussi, une autre origine est refusée.
    r = coin.post("/api/portraits/envoi", content=image(), headers={"Content-Type": "image/jpeg", "Origin": "https://ailleurs.example"})
    assert r.status_code == 403
    # Sans session, rien.
    assert TestClient(joueurs.app).post("/api/portraits/envoi", content=image(), headers={"Content-Type": "image/jpeg"}).status_code == 401
    assert TestClient(joueurs.app).get("/api/portraits").status_code == 401


def test_par_la_file_commune_une_image_ne_passe_pas(tablee, neuf):
    r = tablee["a"]["coin"].post("/api/demandes", json={"genre": "portrait", "corps": {"envoi": "a" * 16}})
    assert r.status_code == 400 and "Changer de portrait" in r.json()["detail"]


def test_en_pause_rien_ne_change(tablee, neuf):
    demandes.ecrire_pause(config.PROPOSITIONS, True)
    try:
        assert envoyer(tablee, "a", image()).status_code == 423
        nom = etat(tablee, "a")["portraits"][1]["nom"]
        assert tablee["a"]["coin"].post("/api/demandes", json={"genre": "portrait-choisi", "corps": {"portrait": nom}}).status_code == 423
        assert etat(tablee, "a")["pause"] is True
    finally:
        demandes.ecrire_pause(config.PROPOSITIONS, False)


# ---------------------------------------------------------------- le flux, Telegram

def test_le_flux_ne_le_dit_qu_a_son_joueur():
    cle_ = "c" * 32
    assert flux_coin.sujet_du_fichier((portraits.DOSSIER, cle_, portraits.INDEX)) == (f"cle:{cle_}", "portraits")
    assert flux_coin.sujet_du_fichier((portraits.DOSSIER, cle_, "a" * 24 + ".jpg")) is None
    assert flux_coin.sujet_du_fichier((portraits.ENVOIS, "aube", "a" * 16 + ".jpg")) is None
    assert "portraits" in flux_coin.SUJETS


def test_telegram_pour_une_image_jamais_pour_un_choix():
    assert demandes.GENRES[portraits.GENRE_CHOIX].silencieux is True and demandes.GENRES[portraits.GENRE_CHOIX].annulable is True
    assert demandes.GENRES[portraits.GENRE_ENVOI].silencieux is False and demandes.GENRES[portraits.GENRE_ENVOI].attente is True


# ---------------------------------------------------------------- le module seul

def test_preparer_une_image_png_transparente_et_webp():
    im = Image.new("RGBA", (800, 800), (0, 0, 0, 0))
    sortie = io.BytesIO()
    im.save(sortie, "PNG")
    fait = portraits.preparer_image(sortie.getvalue())
    with Image.open(io.BytesIO(fait)) as r:
        assert r.format == "JPEG" and r.size == (600, 800)
        assert r.getpixel((10, 10)) == pytest.approx(portraits.FOND, abs=4)
    fait = portraits.preparer_image(image("WEBP", (900, 1200)))
    with Image.open(io.BytesIO(fait)) as r:
        assert r.size == (900, 1200)


def test_recadrage_toujours_au_format_portrait():
    for largeur, hauteur, cadre in ((1000, 1000, None), (400, 1600, None), (1600, 400, None), (1000, 1000, (0.9, 0.9, 0.5)),
                                    (1000, 1000, (0.0, 0.0, 5.0)), (300, 300, (0.5, 0.5, 0.0001))):
        g, h, d, b = portraits.recadrage(largeur, hauteur, cadre)
        assert 0 <= g < d <= largeur and 0 <= h < b <= hauteur
        assert abs((d - g) * 4 - (b - h) * 3) <= 4, (largeur, hauteur, cadre)
    assert portraits.cadre_valide("0.2", "0.1", "0.5") == (0.2, 0.1, 0.5)
    for mauvais in (("nan", "0", "1"), ("-1", "0", "0.5"), ("0", "0", "0"), ("a", "b", "c"), ("0", "0", "inf")):
        assert portraits.cadre_valide(*mauvais) is None
