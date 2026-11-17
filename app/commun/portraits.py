"""Les portraits des joueurs : chacun voit le portrait de son héros, carnet ouvert ou fermé, en choisit un autre
parmi ceux que le MJ a fait peindre pour lui, ou envoie sa propre image, que le MJ accepte ou refuse.

Deux dossiers dans les propositions, un écrivain chacun :
  - portraits/<clé>/, écrit par l'atelier seul, sous la clé opaque du lien du joueur (carnet.cle_heros, comme « Mon
    héros ») : index.json (les portraits de son héros, le portrait du moment) et leurs miniatures, en JPEG sans
    métadonnées, sous un nom tiré de la clé et de l'image (rien du nom du fichier de l'atelier, aucune adresse /media/) ;
    publié carnet ouvert comme fermé, tant que son héros est à la tablée ;
  - portraits-envois/<joueur>/<envoi>.jpg, écrit par le coin seul, sous son verrou : les images envoyées par le joueur,
    déjà vérifiées et réécrites ici, que l'atelier relit (et revérifie) quand le MJ accepte.
Rien à la racine des propositions (lue comme des héros proposés), rien dans carnet/media/ (le carnet le purge).

Deux genres de demande (demandes.py) :
  - « portrait-choisi » {portrait : le nom d'une miniature de son index} : appliqué seul, annulable par le MJ ;
  - « portrait » {envoi : l'identifiant de l'image envoyée} : en attente du MJ ; accepté, l'image entre dans les
    illustrations de la fiche (source « joueur ») et devient le portrait.

Le coin ne choisit jamais un fichier d'après la requête : l'index se trouve par la clé du lien du joueur connecté, une
miniature par un nom qui y figure, une image envoyée par une demande de ce joueur.

Ce module ne lit rien de l'atelier : main.py (par portraits_mj.py) et joueurs.py l'importent tous deux.
"""
import hashlib
import io
import re
import secrets
import threading
from contextlib import contextmanager
from pathlib import Path

from PIL import Image, ImageCms, ImageOps

from commun import carnet
from commun import demandes
from commun import stockage

DOSSIER = "portraits"
ENVOIS = "portraits-envois"
INDEX = "index.json"
VERROU = ".verrou"
GENRE_CHOIX = "portrait-choisi"
GENRE_ENVOI = "portrait"
GENRES = (GENRE_CHOIX, GENRE_ENVOI)

CLE = carnet.CLE_HEROS
NOM = re.compile(r"^[a-f0-9]{24}\.jpg$")
ENVOI = re.compile(r"^[a-f0-9]{16}$")
ID_JOUEUR = demandes.ID_JOUEUR

OCTETS_MAX = 8 * 1024 * 1024  # une image envoyée, telle qu'elle arrive
EN_ATTENTE_MAX = 5  # images d'un joueur qui attendent le MJ
REFUSEES_GARDEES = 3  # images refusées que le joueur revoit encore
PORTRAITS_MAX = 24  # portraits publiés pour un héros
INDEX_OCTETS_MAX = 64 * 1024
COTE_MIN = 200  # pixels, le petit côté
COTE_MAX = 10_000
# Un JPEG se lit déjà réduit (draft) : une photo de 48 millions de pixels passe. PNG et WebP se lisent en entier.
PIXELS_MAX = 50_000_000
PIXELS_MAX_ENTIERS = 25_000_000
LECTURE_JPEG = (2400, 2400)  # la réduction d'un JPEG s'arrête au-dessus de cette taille
SORTIE = (900, 1200)  # le portrait envoyé, au plus
MINIATURE = (720, 960)  # ce que le coin sert de chaque portrait, au plus
FORMATS = ("JPEG", "MPO", "PNG", "WEBP")  # MPO : un JPEG d'iPhone à plusieurs images, on garde la première
FOND = (244, 234, 212)  # sous la transparence d'un PNG : le parchemin

FORMATS_ACCEPTES = "Formats acceptés : JPEG, PNG ou WebP, 8 Mo au plus."
ILLISIBLE = "Ce fichier n'est pas une image lisible. " + FORMATS_ACCEPTES
HEIC = ("Les photos HEIC de l'iPhone ne passent pas telles quelles : choisissez la photo depuis la photothèque (l'iPhone la "
        "convertit), ou réglez Appareil photo › Formats sur « Le plus compatible ».")
SVG = "Un dessin SVG ne passe pas : exportez-le en PNG ou en JPEG."
TROP_LOURDE = "Cette image est trop lourde : 8 Mo au plus."
TROP_GRANDE = f"Cette image est trop grande : {COTE_MAX} pixels de côté au plus, 50 millions de pixels en tout."
TROP_PETITE = f"Cette image est trop petite pour un portrait : {COTE_MIN} pixels de côté au moins."
PAR_LA_PAGE = "Une image s'envoie depuis « Changer de portrait »."

# Deux images traitées à la fois au plus, dans chaque service : une photo décodée tient des dizaines de mégaoctets.
TRAITEMENTS = threading.BoundedSemaphore(2)
ATTENTE_TRAITEMENT = 20  # secondes : au-delà, l'envoi est refusé plutôt que de retenir un fil du serveur
# Les envois d'un joueur, réussis ou non, en mémoire : 12 en 10 minutes au plus (une image refusée coûte aussi son décodage).
ESSAIS_PAR_JOUEUR = (12, 600)
# Une publication à la fois (la tâche de fond, un choix appliqué, une image acceptée).
PUBLICATION = threading.Lock()


# ---------------------------------------------------------------- les genres

def valider_choix(corps) -> dict:
    corps = demandes.seulement(corps, {"portrait"}, "Changer de portrait")
    nom = corps.get("portrait")
    if not isinstance(nom, str) or not NOM.match(nom):
        raise demandes.Refus(400, "Ce portrait est inconnu : la page se relit.")
    return {"portrait": nom}


def valider_envoi(corps) -> dict:
    corps = demandes.seulement(corps, {"envoi"}, "Portrait envoyé")
    envoi = corps.get("envoi")
    if not isinstance(envoi, str) or not ENVOI.match(envoi):
        raise demandes.Refus(400, "Cette image est inconnue.")
    return {"envoi": envoi}


# Choisir parmi les siens : appliqué seul (le MJ peut l'annuler), sans Telegram (rien à trancher, et un joueur qui hésite
# entre quatre portraits ne réveille pas le téléphone du MJ quatre fois).
demandes.enregistrer(demandes.Genre(
    GENRE_CHOIX, "Changer de portrait", ("un portrait changé", "{n} portraits changés"), attente=False, valider=valider_choix,
    silencieux=True, annulable=True,
    statuts={demandes.APPLIQUEE: "fait : c'est son portrait", demandes.ANNULEE: "annulé par le MJ, le portrait d'avant revient"}))
# Sa propre image : le MJ la regarde avant qu'elle devienne le portrait.
demandes.enregistrer(demandes.Genre(
    GENRE_ENVOI, "Portrait envoyé", ("un portrait à regarder", "{n} portraits à regarder"), attente=True, valider=valider_envoi,
    statuts={demandes.EN_ATTENTE: "envoyé, votre MJ va le regarder", demandes.ACCEPTEE: "accepté : c'est votre portrait",
             demandes.REFUSEE: "refusé par le MJ"}))


# ---------------------------------------------------------------- les images envoyées

def nature(octets: bytes) -> str:
    """Ce que dit le début du fichier, avant tout décodage : un format qu'on refuse avec un mot clair, ou ""."""
    tete = octets[:64]
    if tete[4:8] == b"ftyp" and tete[8:12] in (b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1"):
        return "heic"
    debut = octets[:1024].lstrip().lower()
    if debut.startswith(b"<") and b"<svg" in debut:
        return "svg"
    return ""


def cadre_valide(x, y, largeur) -> tuple | None:
    """Le cadre choisi à l'écran, en fractions de l'image (gauche, haut, largeur) ; None si un nombre manque ou déraille :
    le portrait est alors pris au centre."""
    try:
        v = tuple(float(n) for n in (x, y, largeur))
    except (TypeError, ValueError):
        return None
    if not all(0.0 <= n <= 1.0 for n in v) or v[2] <= 0:
        return None
    return v


def recadrage(largeur: int, hauteur: int, cadre: tuple | None) -> tuple[int, int, int, int]:
    """La boîte (gauche, haut, droite, bas) au format portrait (3 sur 4) dans l'image : celle du cadre, ramenée dans
    l'image, sinon la plus grande au centre."""
    plus_large = min(largeur, hauteur * 3 / 4)
    if cadre is None:
        cw = plus_large
        x, y = (largeur - cw) / 2, (hauteur - cw * 4 / 3) / 2
    else:
        cw = min(plus_large, max(min(COTE_MIN, plus_large), cadre[2] * largeur))
        x = min(max(0.0, cadre[0] * largeur), largeur - cw)
        y = min(max(0.0, cadre[1] * hauteur), hauteur - cw * 4 / 3)
    ch = cw * 4 / 3
    g, h = int(round(x)), int(round(y))
    return g, h, min(largeur, g + max(1, int(round(cw)))), min(hauteur, h + max(1, int(round(ch))))


def en_srgb(im: Image.Image, icc) -> Image.Image:
    """Une photo d'iPhone (Display P3) garde ses couleurs une fois son profil retiré : convertie en sRGB d'abord."""
    if not icc or im.mode not in ("RGB", "RGBA", "CMYK"):
        return im
    try:
        sortie = "RGBA" if im.mode == "RGBA" else "RGB"
        return ImageCms.profileToProfile(im, ImageCms.ImageCmsProfile(io.BytesIO(icc)), ImageCms.createProfile("sRGB"),
                                         outputMode=sortie)
    except Exception:
        return im


def sur_fond(im: Image.Image) -> Image.Image:
    """L'image en RGB : la transparence posée sur le parchemin."""
    if im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        fond = Image.new("RGB", im.size, FOND)
        fond.paste(im, mask=im.getchannel("A"))
        return fond
    return im.convert("RGB")


def jpeg_propre(im: Image.Image, taille: tuple[int, int] | None = None) -> bytes:
    """Une image neuve, pixel par pixel : ni EXIF (ni lieu, ni appareil), ni profil, ni XMP, ni commentaire."""
    if taille and (im.width > taille[0] or im.height > taille[1]):
        im = ImageOps.contain(im, taille, Image.Resampling.LANCZOS)
    neuve = Image.new("RGB", im.size)
    neuve.paste(im)
    sortie = io.BytesIO()
    neuve.save(sortie, "JPEG", quality=88, optimize=True, progressive=True)
    return sortie.getvalue()


def preparer_image(octets: bytes, cadre: tuple | None = None) -> bytes:
    """Une image envoyée par un joueur, vérifiée puis réécrite : format réel (JPEG, PNG ou WebP, pas celui qu'annonce le
    navigateur), dimensions bornées avant tout décodage (une bombe de décompression annonce les siennes), orientation
    appliquée, recadrée au format portrait, réduite, réencodée en JPEG sans métadonnées. Lève demandes.Refus avec la phrase
    à montrer. Le coin l'appelle à l'envoi, l'atelier de nouveau à l'acceptation."""
    if not octets:
        raise demandes.Refus(400, "Aucune image reçue.")
    if len(octets) > OCTETS_MAX:
        raise demandes.Refus(413, TROP_LOURDE)
    genre = nature(octets)
    if genre == "heic":
        raise demandes.Refus(415, HEIC)
    if genre == "svg":
        raise demandes.Refus(415, SVG)
    if not TRAITEMENTS.acquire(timeout=ATTENTE_TRAITEMENT):
        raise demandes.Refus(503, "D'autres images sont en cours de traitement : réessayez dans un instant.")
    try:
        try:
            with Image.open(io.BytesIO(octets)) as im:
                if im.format not in FORMATS:
                    raise demandes.Refus(415, f"Ce format d'image ne passe pas. {FORMATS_ACCEPTES}")
                largeur, hauteur = im.size
                jpeg = im.format in ("JPEG", "MPO")
                if max(largeur, hauteur) > COTE_MAX or largeur * hauteur > (PIXELS_MAX if jpeg else PIXELS_MAX_ENTIERS):
                    raise demandes.Refus(413, TROP_GRANDE)
                if min(largeur, hauteur) < COTE_MIN:
                    raise demandes.Refus(400, TROP_PETITE)
                if jpeg:
                    im.draft("RGB", LECTURE_JPEG)
                im.load()
                icc = im.info.get("icc_profile")
                vue = ImageOps.exif_transpose(im)
                vue = sur_fond(en_srgb(vue, icc))
                boite = recadrage(vue.width, vue.height, cadre)
                return jpeg_propre(vue.crop(boite), SORTIE)
        except demandes.Refus:
            raise
        except Image.DecompressionBombError:
            raise demandes.Refus(413, TROP_GRANDE)
        except (OSError, ValueError, SyntaxError, EOFError, MemoryError, Image.UnidentifiedImageError):
            raise demandes.Refus(415, ILLISIBLE)
    finally:
        TRAITEMENTS.release()


@contextmanager
def verrou(depot: Path):
    """Le verrou du dossier des images envoyées (le coin seul y écrit ; pris avant celui des demandes, jamais après)."""
    with stockage.verrou_de_dossier(depot / ENVOIS, VERROU):
        yield


def dossier_envois(depot: Path, joueur: str) -> Path:
    if not isinstance(joueur, str) or not ID_JOUEUR.match(joueur):
        raise demandes.Refus(403, "Accès invalide")
    return depot / ENVOIS / joueur


def chemin_envoi(depot: Path, joueur: str, envoi) -> Path | None:
    if not isinstance(envoi, str) or not ENVOI.match(envoi):
        return None
    return dossier_envois(depot, joueur) / f"{envoi}.jpg"


def ecrire_envoi(depot: Path, joueur: str, octets: bytes) -> str:
    """Sous le verrou : l'image déjà réécrite (preparer_image), sous un identifiant tiré au sort. Rend l'identifiant."""
    dossier = dossier_envois(depot, joueur)
    dossier.mkdir(parents=True, exist_ok=True)
    envoi = secrets.token_hex(8)
    chemin = dossier / f"{envoi}.jpg"
    stockage.ecrire_octets(chemin, octets, mode=0o644)
    return envoi


def envois_gardes(liste: list) -> set:
    """Les images qu'un joueur garde : celles qui attendent le MJ, et ses dernières refusées (il revoit ce qu'il a envoyé)."""
    miennes = [d for d in liste if d.get("genre") == GENRE_ENVOI and isinstance(d.get("corps"), dict)]
    gardes = {d["corps"].get("envoi") for d in miennes if d.get("statut") == demandes.EN_ATTENTE}
    refusees = [d["corps"].get("envoi") for d in miennes if d.get("statut") == demandes.REFUSEE]
    return {x for x in gardes | set(refusees[-REFUSEES_GARDEES:]) if isinstance(x, str) and ENVOI.match(x)}


def nettoyer_envois(depot: Path, joueur: str, liste: list) -> int:
    """Sous les verrous : les images qu'aucune demande ne garde s'en vont (acceptées, l'atelier les a recopiées ; retirées,
    refusées depuis longtemps). Rend le nombre de fichiers retirés."""
    dossier = dossier_envois(depot, joueur)
    if not dossier.is_dir():
        return 0
    gardes = envois_gardes(liste)
    retires = 0
    for f in dossier.iterdir():
        if f.suffix == ".jpg" and ENVOI.match(f.stem) and f.stem not in gardes:
            f.unlink(missing_ok=True)
            retires += 1
    return retires


def en_attente(liste: list) -> list:
    return [d for d in liste if d.get("genre") == GENRE_ENVOI and d.get("statut") == demandes.EN_ATTENTE]


# ---------------------------------------------------------------- ce que lit le joueur

def dossier_publie(depot: Path, cle: str) -> Path | None:
    return depot / DOSSIER / cle if isinstance(cle, str) and CLE.match(cle) else None


def lire_index(depot: Path, cle: str) -> dict | None:
    """Les portraits du héros de ce joueur, tels que l'atelier les a publiés : {actuel, portraits : [{nom, source,
    de_vous}]}, champ par champ. None si rien n'est publié (héros pas encore, ou plus, à la tablée)."""
    dossier = dossier_publie(depot, cle)
    contenu = carnet.lire_json(dossier / INDEX, INDEX_OCTETS_MAX) if dossier else None
    if not isinstance(contenu, dict) or not isinstance(contenu.get("elements"), list):
        return None
    portraits = []
    for e in contenu["elements"][:PORTRAITS_MAX]:
        if isinstance(e, dict) and isinstance(e.get("nom"), str) and NOM.match(e["nom"]):
            portraits.append({"nom": e["nom"], "source": "joueur" if e.get("source") == "joueur" else "mj",
                              "de_vous": e.get("de_vous") is True})
    actuel = contenu.get("actuel")
    return {"actuel": actuel if any(p["nom"] == actuel for p in portraits) else None, "portraits": portraits,
            "maj": contenu.get("maj") if isinstance(contenu.get("maj"), str) else None}


def media_publie(depot: Path, cle: str, nom: str) -> Path | None:
    """Une miniature du héros de ce joueur, et de lui seul : son nom doit figurer dans son index."""
    if not isinstance(nom, str) or not NOM.match(nom):
        return None
    index = lire_index(depot, cle)
    if not index or not any(p["nom"] == nom for p in index["portraits"]):
        return None
    chemin = dossier_publie(depot, cle) / nom
    return chemin if chemin.is_file() else None


# ---------------------------------------------------------------- publier (l'atelier)

def nom_publie(cle: str, source: Path) -> str | None:
    """Le nom de la miniature d'un portrait pour ce joueur : il change avec l'image, sans rien dire de son fichier, et
    diffère d'un joueur à l'autre."""
    try:
        st = source.stat()
    except OSError:
        return None
    return hashlib.sha256(f"portrait|{cle}|{source.name}|{st.st_size}|{st.st_mtime_ns}".encode()).hexdigest()[:24] + ".jpg"


def miniature(source: Path, cible: Path) -> bool:
    """La miniature d'un portrait de l'atelier, en JPEG sans métadonnées."""
    try:
        with Image.open(source) as im:
            if im.width * im.height > PIXELS_MAX:
                return False
            im.draft("RGB", (MINIATURE[0] * 2, MINIATURE[1] * 2))
            im.load()
            vue = sur_fond(ImageOps.exif_transpose(im))
            octets = jpeg_propre(vue, MINIATURE)
    except (OSError, ValueError, SyntaxError, EOFError, Image.DecompressionBombError):
        return False
    stockage.ecrire_octets(cible, octets, mode=0o644)
    return True


def publier(depot: Path, par_cle: dict) -> int:
    """Écrit les portraits de chaque joueur dont le héros est à la tablée. par_cle : {clé : {"actuel": nom, "portraits":
    [{"nom", "source": Path, "genre": "mj"|"joueur", "de_vous": bool}]}}. Les miniatures d'abord (l'index y renvoie), puis
    l'index, enfin ce qui n'est plus publié s'en va (une miniature, le dossier d'un joueur sans héros). Un fichier n'est
    réécrit que si son contenu change. Rend le nombre de fichiers écrits ou retirés."""
    racine = depot / DOSSIER
    with PUBLICATION:
        racine.mkdir(parents=True, exist_ok=True)
        ecrits = 0
        for cle, vu in par_cle.items():
            dossier = dossier_publie(depot, cle)
            if dossier is None:
                continue
            dossier.mkdir(parents=True, exist_ok=True)
            elements = []
            for p in vu.get("portraits", [])[:PORTRAITS_MAX]:
                if not NOM.match(p["nom"]):
                    continue
                if not (dossier / p["nom"]).exists():
                    if not miniature(p["source"], dossier / p["nom"]):
                        continue
                    ecrits += 1
                elements.append({"nom": p["nom"], "source": "joueur" if p.get("genre") == "joueur" else "mj",
                                 "de_vous": p.get("de_vous") is True})
            actuel = vu.get("actuel") if any(e["nom"] == vu.get("actuel") for e in elements) else None
            ecrits += carnet.ecrire_si_change(dossier / INDEX, elements, actuel=actuel)
            noms = {e["nom"] for e in elements}
            for f in dossier.iterdir():
                if f.name != INDEX and not f.name.startswith(".") and f.name not in noms:
                    f.unlink(missing_ok=True)
                    ecrits += 1
        for dossier in racine.iterdir():
            if dossier.is_dir() and CLE.match(dossier.name) and dossier.name not in par_cle:
                for f in dossier.iterdir():
                    f.unlink(missing_ok=True)
                dossier.rmdir()
                ecrits += 1
        return ecrits
