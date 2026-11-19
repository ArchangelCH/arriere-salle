"""Les pions enrichis et les images du MJ : tailles, formes, états, groupes, montures, étiquettes, nom visible
ou non ; la bibliothèque d'images (vérifiées par Pillow, réécrites sans métadonnées, transparence gardée), posées comme
pion ou comme décor.

Les fuites : un pion invisible, le nom d'un PNJ inconnu sur un pion numéroté, une image cachée, un nom de fichier interne
(ni celui d'origine ni celui de la bibliothèque), le nom caché de l'auberge dans une étiquette, la monture cachée d'un
cavalier. Ni la TV (et la table publique), ni le coin des joueurs n'en reçoivent rien."""
import io
import json
import os
import struct
import sys
import tempfile
import zlib
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image, PngImagePlugin  # noqa: E402

from ia import images_plan  # noqa: E402
import joueurs  # noqa: E402
import main  # noqa: E402
from api import application, config, tv_cartes, tv_etat, tv_plans, utilitaires  # noqa: E402
from coin_mj import mouvements  # noqa: E402
from table import pions_plan  # noqa: E402
from commun import table_joueurs  # noqa: E402
from table import vignettes  # noqa: E402
from comptes_coin import entrer as entrer_au_coin  # noqa: E402

TABLE = config.PROPOSITIONS / table_joueurs.DOSSIER
INTERNET = {"CF-Connecting-IP": "203.0.113.7"}


def png(taille=(40, 30), couleur=(200, 40, 40, 255), **info) -> bytes:
    im = Image.new("RGBA", taille, couleur)
    im.putpixel((0, 0), (0, 0, 0, 0))
    sortie = io.BytesIO()
    meta = PngImagePlugin.PngInfo()
    for k, v in info.items():
        meta.add_text(k, v)
    im.save(sortie, "PNG", pnginfo=meta)
    return sortie.getvalue()


def jpeg_avec_exif(texte: str) -> bytes:
    im = Image.new("RGB", (50, 40), (30, 90, 160))
    exif = Image.Exif()
    exif[0x010E] = texte  # ImageDescription
    sortie = io.BytesIO()
    im.save(sortie, "JPEG", exif=exif.tobytes())
    return sortie.getvalue()


def png_geant(l: int, h: int) -> bytes:
    """Un PNG dont l'en-tête annonce l × h pixels, avec une seule ligne de données : une bombe qu'il ne faut pas décoder."""
    def bloc(genre, donnees):
        return struct.pack(">I", len(donnees)) + genre + donnees + struct.pack(">I", zlib.crc32(genre + donnees) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", l, h, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + bloc(b"IHDR", ihdr) + bloc(b"IDAT", zlib.compress(b"\x00" * 64)) + bloc(b"IEND", b"")


# ---------------------------------------------------------------- vérifier et réécrire une image

def test_une_image_transparente_garde_sa_transparence():
    for format_ in ("PNG", "WEBP"):
        im = Image.new("RGBA", (20, 20), (0, 200, 0, 255))
        im.putpixel((3, 3), (0, 0, 0, 0))
        b = io.BytesIO()
        im.save(b, format_, lossless=True) if format_ == "WEBP" else im.save(b, format_)
        octets, ext, mesure = images_plan.nettoyer(b.getvalue())
        assert ext == {"PNG": ".png", "WEBP": ".webp"}[format_] and mesure["transparente"] is True
        relue = Image.open(io.BytesIO(octets))
        assert relue.mode == "RGBA" and relue.getpixel((3, 3))[3] == 0 and relue.getpixel((10, 10))[3] == 255
    # Une image opaque reste opaque (aucun canal alpha inutile).
    b = io.BytesIO()
    Image.new("RGB", (20, 20), (9, 9, 9)).save(b, "PNG")
    assert images_plan.nettoyer(b.getvalue())[2]["transparente"] is False


def test_les_metadonnees_ne_suivent_pas():
    secret = "Petite Fanfrelee NOTE-DU-MJ"
    for contenu in (jpeg_avec_exif(secret), png(Comment=secret, Description=secret)):
        octets, _, _ = images_plan.nettoyer(contenu)
        assert secret.encode() not in octets and b"Fanfrelee" not in octets and b"NOTE-DU-MJ" not in octets
        relue = Image.open(io.BytesIO(octets))
        # Seuls restent les champs de structure du format (JFIF, progressif) : ni EXIF, ni profil, ni texte.
        assert not dict(relue.getexif()) and not {k for k in relue.info if not k.startswith(("jfif", "progress", "dpi"))}
    # Ce qui suit l'image dans le fichier (un PNG qui cache une page) ne reste pas.
    polyglotte = png() + b"<html><script>alert(1)</script></html>"
    assert b"<script>" not in images_plan.nettoyer(polyglotte)[0]


def test_ni_faux_fichier_ni_bombe():
    for contenu, statut in ((b"<html>pas une image</html>", 415), (b"<svg xmlns='http://www.w3.org/2000/svg'/>", 415),
                            (b"GIF89a" + b"\x00" * 40, 415), (b"", 400), (png_geant(30000, 30000), 413),
                            (png_geant(9000, 10), 413), (png((2, 2)), 415)):
        with pytest.raises(images_plan.Refus) as err:
            images_plan.nettoyer(contenu)
        assert err.value.statut == statut, contenu[:20]
    b = io.BytesIO()
    Image.new("RGB", (60, 60)).save(b, "GIF")
    with pytest.raises(images_plan.Refus):
        images_plan.nettoyer(b.getvalue())


def test_les_dimensions_sont_bornees():
    b = io.BytesIO()
    Image.new("RGB", (5000, 1000), (50, 50, 50)).save(b, "JPEG")
    octets, ext, mesure = images_plan.nettoyer(b.getvalue())
    assert ext == ".jpg" and (mesure["largeur"], mesure["hauteur"]) == (2048, 410)
    assert Image.open(io.BytesIO(octets)).size == (2048, 410)


# ---------------------------------------------------------------- la bibliothèque

@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


def importer(atelier, contenu: bytes, nom_fichier="image.png", nom="", rayon=""):
    return atelier.post("/api/bibliotheque-images", files={"image": (nom_fichier, contenu, "image/png")}, data={"nom": nom, "rayon": rayon})


def test_la_bibliotheque_range_et_nomme(atelier):
    r = importer(atelier, png(), "le-traitre-du-moulin.png", "Le traître du moulin", "PNJ secrets")
    assert r.status_code == 200, r.text
    im = r.json()
    assert im["nom"] == "Le traître du moulin" and im["rayon"] == "PNJ secrets" and im["transparente"] is True
    # Un nom tiré au sort : ni le nom du fichier ni celui de la bibliothèque dans l'adresse.
    assert images_plan.MEDIA.match(im["url"]) and "traitre" not in im["url"] and im["url"].endswith(".png")
    assert (config.IMAGES / im["url"].removeprefix("/media/")).is_file()
    assert any(x["id"] == im["id"] for x in atelier.get("/api/bibliotheque-images").json()["images"])
    r = atelier.patch(f"/api/bibliotheque-images/{im['id']}", json={"nom": "  Le   meunier ", "rayon": ""}).json()
    assert (r["nom"], r["rayon"]) == ("Le meunier", images_plan.RAYON_DEFAUT)
    # Un faux fichier est refusé, rien n'est rangé.
    avant = len(atelier.get("/api/bibliotheque-images").json()["images"])
    assert importer(atelier, b"<script>alert(1)</script>", "image.png").status_code == 415
    assert len(atelier.get("/api/bibliotheque-images").json()["images"]) == avant
    # Retirée de la bibliothèque, l'image reste pour les plans qui l'utilisent.
    assert atelier.delete(f"/api/bibliotheque-images/{im['id']}").status_code == 200
    assert (config.IMAGES / im["url"].removeprefix("/media/")).is_file()
    assert atelier.delete(f"/api/bibliotheque-images/{im['id']}").status_code == 404
    for ident in ("../x", "img-zz"):
        assert atelier.patch(f"/api/bibliotheque-images/{ident}", json={"nom": "x"}).status_code in (404, 405)


def test_la_bibliotheque_reste_dans_l_atelier(atelier):
    # Depuis Internet (la table publique), ni lecture ni import.
    assert atelier.get("/api/bibliotheque-images", headers=INTERNET).status_code == 404
    r = atelier.post("/api/bibliotheque-images", files={"image": ("a.png", png(), "image/png")}, headers=INTERNET)
    assert r.status_code == 404
    # Le coin des joueurs n'a pas ces routes.
    coin = TestClient(joueurs.app)
    assert coin.get("/api/bibliotheque-images").status_code in (401, 403, 404)


# ---------------------------------------------------------------- ce qui sort vers la TV et le coin

W, H = 8, 4
SECRETS = ("Le Pinson", "Pinson", "INVISIBLE-", "IMAGE-CACHEE", "Fanfrel", "fanfrel", "le-traitre", "Le traitre", "traitre",
           "Traître", "PNJ secrets", "NOTE-", "MONTURE-CACHEE", "cheval-cache", "pion-invisible")


def grille(cases: dict, defaut=0) -> list:
    return [cases.get((x, y), defaut) for y in range(H) for x in range(W)]


@pytest.fixture()
def monde(atelier, monkeypatch):
    """Un PNJ inconnu, une image importée sous un nom qui trahit, un plan où tout se mélange ; un joueur au coin."""
    crees = []

    def creer(collection, **fiche):
        f = atelier.post(f"/api/{collection}", json=fiche).json()
        crees.append((collection, f["id"]))
        return f

    pinson = creer("pnj", nom="Le Pinson", connu=False, illustrations=[{"url": "/media/rien.png"}], notes="NOTE-PINSON")
    bruno = creer("pnj", nom="Bruno le passeur", connu=True)
    secrete = importer(atelier, png((30, 30), (10, 10, 200, 255)), "le-traitre-du-moulin.png", "Le traître du moulin", "PNJ secrets").json()
    decor = importer(atelier, png((60, 30), (0, 120, 0, 200)), "fontaine.png", "Fontaine", "Décors").json()
    cachee = importer(atelier, png((20, 20)), "IMAGE-CACHEE.png", "IMAGE-CACHEE").json()
    heros = creer("aventuriers", nom="Aude de Valcombe", genre="f", tablee=True, couleur="#2e7d32")
    plan = creer("plans", nom="Plan des pions enrichis", largeur=W, hauteur=H, m_case=1.5, brouillard_actif=True, style="couleur",
                 sol=[2] * (W * H), piece=[1] * (W * H), brouillard=grille({(x, y): 1 for y in range(H) for x in range(W)}),
                 pieces=[{"id": 1, "nom": "Cour", "genre": "exterieur"}], portes=[], textes=[], notes="NOTE-PLAN",
                 objets=[
                     {"id": "o-fontaine", "cle": "image", "image": decor["url"], "x": 1, "y": 1, "l": 2, "h": 1, "rot": 0, "dessus": True,
                      "franchissable": False, "nom": "le-traitre", "note": "NOTE-FONTAINE"},
                     {"id": "o-cachee", "cle": "image", "image": cachee["url"], "x": 4, "y": 1, "l": 1, "h": 1, "cache": True,
                      "nom": "IMAGE-CACHEE", "note": "NOTE-CACHEE"},
                     {"id": "o-table", "cle": "table", "x": 6, "y": 0, "l": 2, "h": 1, "rot": 0, "note": "NOTE-TABLE"}],
                 pions=[
                     {"id": "t-aude", "genre": "heros", "nom": "Aude", "ref": f"aventurier:{heros['id']}", "x": 0.5, "y": 0.5,
                      "etats": ["empoisonne", "en-feu", "inconnu"], "forme": "blason", "epaisseur": 1.8, "taille": 1},
                     {"id": "t-pinson-1", "genre": "pnj", "nom": "Le Pinson", "ref": f"pnj:{pinson['id']}", "court": "1", "x": 2.5, "y": 2.5,
                      "etiquette": "Le Pinson, chef", "image_libre": secrete["url"], "nom_visible": True, "groupe": 3},
                     {"id": "t-pinson-2", "genre": "pnj", "nom": "Le Pinson", "ref": f"pnj:{pinson['id']}", "court": "Me", "x": 3.5, "y": 2.5},
                     {"id": "pion-invisible", "genre": "ennemi", "nom": "INVISIBLE-ASSASSIN", "court": "2", "x": 5.5, "y": 2.5,
                      "etats": ["invisible", "concentre"], "etiquette": "INVISIBLE-DAGUE"},
                     {"id": "t-gobelin", "genre": "ennemi", "nom": "Gobelin", "court": "3", "x": 6.5, "y": 2.5, "etiquette": "Garde de la Petite Fanfrelée",
                      "nom_visible": True, "taille": 0.6, "forme": "carre", "groupe": 5},
                     {"id": "t-bruno", "genre": "pnj", "nom": "Bruno le passeur", "ref": f"pnj:{bruno['id']}", "x": 7.5, "y": 3.5, "nom_visible": False},
                     {"id": "cheval-cache", "genre": "autre", "nom": "MONTURE-CACHEE", "x": 0.5, "y": 3.5, "cache": True},
                     {"id": "t-cavalier", "genre": "autre", "nom": "Cavalier", "x": 0.5, "y": 3.5, "monture": "cheval-cache"},
                     {"id": "t-ane", "genre": "autre", "nom": "Âne", "x": 1.5, "y": 3.5, "taille": 4},
                     {"id": "t-meunier", "genre": "autre", "nom": "Meunier", "x": 1.5, "y": 3.5, "monture": "t-ane"}])
    invite = atelier.post("/api/joueurs", json={"nom": "Léa"}).json()
    atelier.post(f"/api/joueurs/{invite['id']}/relier", json={"heros": heros["id"]})
    monkeypatch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    monkeypatch.setattr(joueurs, "COOKIE_SUR", False)
    monkeypatch.setattr(joueurs, "HOTES", set())
    coin = TestClient(joueurs.app)
    entrer_au_coin(coin, invite)
    yield {"plan": plan, "secrete": secrete, "decor": decor, "cachee": cachee, "coin": coin, "pinson": pinson}
    atelier.put("/api/table-joueurs", json={"ouverte": False})
    atelier.put("/api/table", json={"vue": "accueil"})
    atelier.delete(f"/api/joueurs/{invite['id']}")
    for collection, ident in crees:
        atelier.delete(f"/api/{collection}/{ident}")
    for im in (secrete, decor, cachee):
        atelier.delete(f"/api/bibliotheque-images/{im['id']}")
    tv_etat.TABLE_JOUEURS.unlink(missing_ok=True)
    table_joueurs.fermer(config.PROPOSITIONS)


def plan_tv(atelier, plan, entetes=None) -> dict:
    assert atelier.put("/api/table", json={"vue": "plan", "plan": plan["id"], "style": "couleur"}).status_code == 200
    r = atelier.get(f"/api/table/plan/{tv_cartes.jeton('plans', plan['id'])}", headers=entetes or {})
    assert r.status_code == 200, r.text
    return r.json()


def sans_fuite(texte: str, en_plus=()) -> None:
    for interdit in (*SECRETS, *en_plus):
        assert interdit not in texte, interdit


def test_ce_que_la_tv_recoit(atelier, monde):
    p = plan_tv(atelier, monde["plan"])
    sans_fuite(json.dumps(p, ensure_ascii=False), (monde["secrete"]["url"], monde["cachee"]["url"]))
    pions = {t["id"]: t for t in p["pions"]}
    # Le pion invisible suit la règle du pion caché ; la monture cachée ne se devine pas par son cavalier.
    assert "pion-invisible" not in pions and "cheval-cache" not in pions and "monture" not in pions["t-cavalier"]
    # Un cavalier sur une monture montrée la porte.
    assert pions["t-meunier"]["monture"] == "t-ane" and pions["t-ane"]["taille"] == 4
    # Les états connus, sans « invisible » ; la forme et l'épaisseur.
    aude = pions["t-aude"]
    assert aude["etats"] == ["empoisonne", "en-feu"] and aude["forme"] == "blason" and aude["epaisseur"] == 1.8
    # Le PNJ inconnu numéroté : son numéro, rien d'autre (ni nom, ni étiquette, ni image, ni lettres qui le nomment).
    m1, m2 = pions["t-pinson-1"], pions["t-pinson-2"]
    assert (m1["nom"], m1["image"], m1["court"], m1["groupe"]) == ("", "", "1", 3) and "etiquette" not in m1 and "image_libre" not in m1
    assert (m2["nom"], m2["court"]) == ("", "")
    # L'adversaire au nom rendu visible, son étiquette au nom de l'auberge masqué, son groupe.
    g = pions["t-gobelin"]
    assert (g["nom"], g.get("nom_visible"), g["etiquette"], g["groupe"], g["taille"], g["forme"]) == (
        "Gobelin", True, "Garde de l'auberge", 5, 0.6, "carre")
    # Le PNJ connu dont le MJ cache le nom.
    assert pions["t-bruno"]["nom"] == ""
    # Les images : celle du décor avec sa couche et son « franchissable », jamais la cachée, ni nom ni note.
    objets = {o["id"]: o for o in p["objets"]}
    assert set(objets) == {"o-fontaine", "o-table"}
    assert objets["o-fontaine"] == {"id": "o-fontaine", "cle": "image", "x": 1, "y": 1, "l": 2, "h": 1, "rot": 0,
                                    "image": monde["decor"]["url"], "dessus": True, "franchissable": False}
    assert set(objets["o-table"]) == {"id", "cle", "x", "y", "l", "h", "rot"}


def test_un_pion_d_avant_sort_a_l_identique(atelier):
    """Un pion sans champ du lot H2 : pion_public rend exactement les clés d'avant."""
    for t in ({"id": "a", "genre": "ennemi", "nom": "Gobelin", "court": "2", "x": 1.5, "y": 1.5, "taille": 1, "tombe": False},
              {"id": "b", "genre": "autre", "nom": "Cheval", "x": 1.5, "y": 1.5}):
        pub = tv_plans.pion_public(t, {}, {}, {})
        assert set(pub) == {"id", "genre", "court", "x", "y", "taille", "tombe", "couleur", "nom", "image"}
        assert pions_plan.plus_public(t, pub, "", None, utilitaires.media_existant) == {}
    assert images_plan.objet_public({"id": "o", "cle": "table"}, utilitaires.media_existant) == {}


def test_la_table_publique_ne_recoit_rien_de_plus(atelier, monde):
    config.TABLE_OUVERTURE.unlink(missing_ok=True)  # sans réglage, la table publique est ouverte
    p = plan_tv(atelier, monde["plan"], INTERNET)
    sans_fuite(json.dumps(p, ensure_ascii=False), (monde["secrete"]["url"], monde["cachee"]["url"]))
    assert "pion-invisible" not in {t["id"] for t in p["pions"]}
    # La vignette d'une image transparente du MJ : un PNG qui garde ses pixels transparents (a=1), un JPEG sinon.
    nom = monde["decor"]["url"].removeprefix("/media/")
    r = atelier.get(f"/api/table/vignette/{nom}?l=160&a=1", headers=INTERNET)
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert Image.open(io.BytesIO(r.content)).getpixel((0, 0))[3] == 0
    r = atelier.get(f"/api/table/vignette/{nom}?l=160", headers=INTERNET)
    assert r.headers["content-type"] == "image/jpeg"


def test_ce_que_le_coin_recoit(atelier, monde):
    atelier.put("/api/table", json={"vue": "plan", "plan": monde["plan"]["id"], "style": "couleur"})
    atelier.put("/api/table-joueurs", json={"ouverte": True})
    tv_etat.table_coin.tout_de_suite()
    vue = monde["coin"].get("/api/table").json()["vue"]
    texte = json.dumps(vue, ensure_ascii=False)
    sans_fuite(texte, ('"/media/', monde["decor"]["url"], monde["secrete"]["url"]))
    for f in TABLE.rglob("*.json"):
        sans_fuite(f.read_text(encoding="utf-8"), ('"/media/',))
    p = vue["plan"]
    pions = {t["id"]: t for t in p["pions"]}
    assert "pion-invisible" not in pions and "monture" not in pions["t-cavalier"] and pions["t-pinson-1"]["image"] == ""
    fontaine = next(o for o in p["objets"] if o["id"] == "o-fontaine")
    assert fontaine["image"].startswith("/table/media/") and fontaine["image"].endswith(".png")
    assert not any(o["id"] == "o-cachee" for o in p["objets"])
    # L'image du décor, réduite, garde sa transparence ; le coin la sert en PNG à un joueur connecté, à personne d'autre.
    r = monde["coin"].get(fontaine["image"])
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    im = Image.open(io.BytesIO(r.content))
    assert im.mode == "RGBA" and im.getpixel((0, 0))[3] == 0
    assert TestClient(joueurs.app).get(fontaine["image"]).status_code in (401, 403, 303, 404)
    # Le nom de l'image publiée vient de son contenu, jamais de son nom dans l'atelier.
    for f in (TABLE / table_joueurs.MEDIA).iterdir():
        assert table_joueurs.NOM_MEDIA.match(f.name)


def test_le_mj_est_prevenu_d_un_pion_invisible(atelier, monde):
    p = utilitaires.lire_fiche(utilitaires.existant(config.PLANS, monde["plan"]["id"]))
    aude = next(t for t in p["pions"] if t["id"] == "t-aude")
    assert mouvements.caches_sur(p, aude, (5, 2)) == ["INVISIBLE-ASSASSIN"]
    # Le refus d'un joueur ne dépend jamais d'un secret : la case du pion invisible est libre dans la projection.
    publique = tv_plans.plan_public(p, tv_cartes.jeton("plans", p["id"]))
    from commun import deplacement as dp
    assert (5, 2) not in dp.Grille(publique, "t-aude").prises
    # Une image infranchissable barre ses cases ; un pion d'aventurier en selle ne bouge pas seul.
    assert {(1, 1), (2, 1)} <= dp.Grille(publique, "t-aude").meubles


def test_vignette_d_avant_inchangee(tmp_path):
    """Sans transparence demandée, la vignette reste le JPEG d'avant sur parchemin ; une image opaque reste un JPEG même
    quand on la demande."""
    chemin = tmp_path / "detouree.png"
    chemin.write_bytes(png((50, 50), (0, 0, 0, 0)))
    avant = vignettes.vignette(chemin, 160)
    assert avant[:3] == b"\xff\xd8\xff" and Image.open(io.BytesIO(avant)).getpixel((5, 5)) == pytest.approx(vignettes.FOND, abs=4)
    assert vignettes.vignette(chemin, 160, transparence=True)[:8] == vignettes.PNG
    opaque = tmp_path / "opaque.png"
    Image.new("RGBA", (40, 40), (1, 2, 3, 255)).save(opaque)
    assert vignettes.vignette(opaque, 160, transparence=True)[:3] == b"\xff\xd8\xff"


def test_les_modules_du_dessin_sont_servis_au_coin():
    for m in ("js/plan/pions.js", "js/plan/images.js", "js/plan/figurine.js"):
        assert m in joueurs.FICHIERS
    # Les modules de l'éditeur, eux, ne sortent pas.
    for m in ("js/plan/editeur-pions.js", "js/plan/editeur-images.js"):
        assert m not in joueurs.FICHIERS


# ---------------------------------------------------------------- une image du MJ à demi révélée

def deux_moities(taille, gauche, droite, sens="h") -> bytes:
    """Un PNG opaque en deux moitiés de couleur : gauche/droite (sens « h ») ou haut/bas (sens « v »)."""
    im = Image.new("RGBA", taille, gauche)
    l, h = taille
    im.paste(Image.new("RGBA", (l // 2, h) if sens == "h" else (l, h // 2), droite), (l // 2, 0) if sens == "h" else (0, h // 2))
    sortie = io.BytesIO()
    im.save(sortie, "PNG")
    return sortie.getvalue()


VERT, ROUGE, BLEU = (0, 160, 0, 255), (200, 0, 0, 255), (0, 0, 200, 255)


@pytest.fixture()
def demi(atelier, monkeypatch):
    """Un plan dont seules les colonnes 0 à 3 sont révélées : une fresque à cheval (vert révélé, rouge caché), une image
    tournée d'un quart à cheval (rouge en bas révélé, bleu en haut caché), une image entière dans le révélé ; un joueur."""
    fresque = importer(atelier, deux_moities((80, 40), VERT, ROUGE), "salle-du-tresor.png", "FRESQUE-SECRETE").json()
    tournee = importer(atelier, deux_moities((20, 40), BLEU, ROUGE, "v"), "b.png", "Tournée").json()
    entiere = importer(atelier, png((20, 20)), "c.png", "Entière").json()
    heros = atelier.post("/api/aventuriers", json={"nom": "Brune Demi", "tablee": True}).json()
    plan = atelier.post("/api/plans", json={
        "nom": "Plan à demi révélé", "largeur": W, "hauteur": H, "brouillard_actif": True, "style": "couleur",
        "sol": [2] * (W * H), "piece": [1] * (W * H), "brouillard": grille({(x, y): 1 for y in range(H) for x in range(4)}),
        "pieces": [{"id": 1, "nom": "Cour", "genre": "exterieur"}], "portes": [], "textes": [],
        "objets": [{"id": "o-fresque", "cle": "image", "image": fresque["url"], "x": 2, "y": 0, "l": 4, "h": 2, "rot": 0},
                   {"id": "o-tournee", "cle": "image", "image": tournee["url"], "x": 3, "y": 3, "l": 1, "h": 2, "rot": 90, "dessus": True},
                   {"id": "o-entiere", "cle": "image", "image": entiere["url"], "x": 0, "y": 2, "l": 1, "h": 1},
                   {"id": "o-cachee", "cle": "image", "image": fresque["url"], "x": 3, "y": 2, "l": 2, "h": 1, "cache": True}],
        "pions": [{"id": "t-brune", "genre": "heros", "ref": f"aventurier:{heros['id']}", "x": 0.5, "y": 0.5}]}).json()
    invite = atelier.post("/api/joueurs", json={"nom": "Iris"}).json()
    atelier.post(f"/api/joueurs/{invite['id']}/relier", json={"heros": heros["id"]})
    monkeypatch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    monkeypatch.setattr(joueurs, "COOKIE_SUR", False)
    monkeypatch.setattr(joueurs, "HOTES", set())
    coin = TestClient(joueurs.app)
    entrer_au_coin(coin, invite)
    yield {"plan": plan, "fresque": fresque, "tournee": tournee, "entiere": entiere, "coin": coin}
    atelier.put("/api/table-joueurs", json={"ouverte": False})
    atelier.put("/api/table", json={"vue": "accueil"})
    atelier.delete(f"/api/joueurs/{invite['id']}")
    atelier.delete(f"/api/plans/{plan['id']}")
    atelier.delete(f"/api/aventuriers/{heros['id']}")
    for im in (fresque, tournee, entiere):
        atelier.delete(f"/api/bibliotheque-images/{im['id']}")
    tv_etat.TABLE_JOUEURS.unlink(missing_ok=True)
    table_joueurs.fermer(config.PROPOSITIONS)


def pixel(im, fx, fy):
    return im.getpixel((int(fx * im.width), int(fy * im.height)))


def test_une_image_a_demi_revelee_ne_montre_que_le_revele(atelier, demi):
    """Le dessin pose les images du MJ par-dessus le brouillard : entière, la fresque montrerait à la TV sa moitié cachée.
    Elle sort masquée, comme le fond du plan ; l'adresse de son fichier ne sort pas."""
    p = plan_tv(atelier, demi["plan"])
    j = tv_cartes.jeton("plans", demi["plan"]["id"])
    objets = {o["id"]: o for o in p["objets"]}
    assert "o-cachee" not in objets and objets["o-entiere"]["image"] == demi["entiere"]["url"]
    texte = json.dumps(p, ensure_ascii=False)
    sans_fuite(texte, (demi["fresque"]["url"], demi["tournee"]["url"], "FRESQUE", "tresor"))
    for oid in ("o-fresque", "o-tournee"):
        assert objets[oid]["image"].startswith(f"/api/table/plan/{j}/image/{oid}?v="), objets[oid]
    r = atelier.get(objets["o-fresque"]["image"])
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    im = Image.open(io.BytesIO(r.content))
    assert im.mode == "RGBA" and not {k for k in im.info if k not in ("dpi",)}
    # Colonnes 2 et 3 révélées (la moitié verte), 4 et 5 cachées (la moitié rouge) : transparentes.
    assert pixel(im, 0.25, 0.5) == VERT and pixel(im, 0.45, 0.2) == VERT
    # Vides, couleur comprise : ôter la transparence n'y retrouverait rien.
    assert pixel(im, 0.55, 0.5) == (0, 0, 0, 0) and pixel(im, 0.9, 0.9) == (0, 0, 0, 0)
    assert ROUGE[:3] not in {c[:3] for _, c in im.getcolors(maxcolors=100000)}
    # Tournée d'un quart (sens des aiguilles d'une montre, comme ctx.rotate) : son haut (bleu) tombe à droite, sur la case cachée.
    im = Image.open(io.BytesIO(atelier.get(objets["o-tournee"]["image"]).content))
    assert pixel(im, 0.5, 0.75) == ROUGE and pixel(im, 0.5, 0.25) == (0, 0, 0, 0)
    assert BLEU[:3] not in {c[:3] for _, c in im.getcolors(maxcolors=100000)}
    # Rien d'autre ne sort par cette route : une image entière, une image cachée, un autre plan, un objet inconnu.
    for oid in ("o-entiere", "o-cachee", "inconnu", "o-fresque%2F..", "../o-fresque"):
        assert atelier.get(f"/api/table/plan/{j}/image/{oid}").status_code == 404, oid
    assert atelier.get(f"/api/table/plan/{tv_cartes.jeton('plans', 'autre-plan')}/image/o-fresque").status_code == 404


def test_l_image_masquee_suit_le_brouillard_et_la_table_publique(atelier, demi):
    config.TABLE_OUVERTURE.unlink(missing_ok=True)  # sans réglage, la table publique est ouverte
    p = plan_tv(atelier, demi["plan"], INTERNET)
    adresse = next(o["image"] for o in p["objets"] if o["id"] == "o-fresque")
    assert atelier.get(adresse, headers=INTERNET).status_code == 200
    # La TV montre autre chose : Internet ne la lit plus.
    atelier.put("/api/table", json={"vue": "accueil"})
    assert atelier.get(adresse, headers=INTERNET).status_code == 404
    # Tout révélé : l'image d'origine, comme avant ce correctif.
    plan = atelier.get(f"/api/plans/{demi['plan']['id']}").json()
    plan["brouillard"] = [1] * (W * H)
    assert atelier.put(f"/api/plans/{plan['id']}", json=plan).status_code == 200
    p = plan_tv(atelier, demi["plan"])
    assert next(o["image"] for o in p["objets"] if o["id"] == "o-fresque") == demi["fresque"]["url"]


def test_le_coin_recoit_l_image_masquee(atelier, demi):
    atelier.put("/api/table", json={"vue": "plan", "plan": demi["plan"]["id"], "style": "couleur"})
    atelier.put("/api/table-joueurs", json={"ouverte": True})
    tv_etat.table_coin.tout_de_suite()
    vue = demi["coin"].get("/api/table").json()["vue"]
    sans_fuite(json.dumps(vue, ensure_ascii=False), ('"/media/', "/api/table/", demi["fresque"]["url"], "FRESQUE"))
    fresque = next(o for o in vue["plan"]["objets"] if o["id"] == "o-fresque")
    assert fresque["image"].startswith("/table/media/") and fresque["image"].endswith(".png")
    im = Image.open(io.BytesIO(demi["coin"].get(fresque["image"]).content))
    assert pixel(im, 0.25, 0.5) == VERT and pixel(im, 0.75, 0.5) == (0, 0, 0, 0)


def test_la_vignette_transparente_ne_garde_aucune_metadonnee(tmp_path):
    """Une image d'avant la bibliothèque (jamais réécrite) servie en vignette PNG : ni texte, ni XMP, ni EXIF, ni profil."""
    from PIL import ImageCms
    im = Image.new("RGBA", (300, 300), (200, 30, 30, 255))
    im.paste(Image.new("RGBA", (40, 300), (0, 0, 0, 0)), (0, 0))
    meta = PngImagePlugin.PngInfo()
    meta.add_text("Comment", "NOTE-DU-MJ")
    meta.add_itxt("XML:com.adobe.xmp", "<x:xmpmeta>NOTE-XMP</x:xmpmeta>")
    exif = Image.Exif()
    exif[0x010E] = "NOTE-EXIF"
    chemin = tmp_path / "ancienne.png"
    im.save(chemin, "PNG", pnginfo=meta, exif=exif.tobytes(),
            icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())
    contenu = vignettes.vignette(chemin, 160, transparence=True)
    relue = Image.open(io.BytesIO(contenu))
    assert contenu[:8] == vignettes.PNG and relue.getpixel((0, 0))[3] == 0
    assert not set(relue.info) and not dict(relue.getexif())
    for interdit in (b"NOTE-", b"iCCP", b"eXIf", b"xmpmeta"):
        assert interdit not in contenu, interdit
