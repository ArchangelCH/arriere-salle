"""Les images du MJ pour ses plans : importées une fois, rangées et nommées dans une petite bibliothèque,
réutilisées d'un plan à l'autre comme pion (portrait d'un PNJ, image libre) ou comme meuble et décor posé sur le plan.

Une image importée est vérifiée par Pillow avant d'être gardée :
  - son format réel (PNG, JPEG ou WebP), jamais celui qu'annonce le navigateur ni l'extension du fichier ;
  - ses dimensions bornées avant tout décodage (ni bombe de décompression, ni image géante) ;
  - réécrite pixel par pixel, sans métadonnées (EXIF, texte caché d'un PNG, profil, XMP) ni ce qui suivrait l'image
    dans le fichier ; la transparence d'un PNG ou d'un WebP est gardée ;
  - réduite à COTE_MAX pixels de côté au plus.
Elle va dans data/images, sous un nom tiré au sort, comme les illustrations : ni son nom d'origine ni celui que lui
donne le MJ n'apparaissent dans son adresse.

La bibliothèque (data/bibliotheque-images.json) ne part jamais vers la TV ni vers le coin : seule l'adresse /media/
d'une image posée sur un plan, et visible des joueurs, sort par la projection publique (plan_public).

Un objet image d'un plan : {id, cle: "image", image, x, y, l, h, rot, dessus, franchissable, cache, nom, note}. Les
moteurs de rendu d'avant l'ignorent (clé inconnue) ; js/plan/images.js le dessine, sous les pions ou au-dessus.
"""
import hashlib
import io
import math
import re
import secrets
import threading
import time
from pathlib import Path

from PIL import Image, ImageOps
from commun import stockage
from mj import proprietes

CLE = "image"
FORMATS = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp"}
OCTETS_MAX = 15 * 1024 * 1024
COTE_SOURCE_MAX = 8000  # pixels : au-delà, l'image est refusée sans être décodée
PIXELS_MAX = 40_000_000
COTE_MAX = 2048  # pixels : l'image gardée, réduite au besoin (un pion, un meuble, un décor de quelques cases)
COTE_MIN = 4
NOM_MAX = 60
RAYON_MAX = 40
IMAGES_MAX = 500
ID_IMAGE = re.compile(r"^img-[a-f0-9]{10}$")
MEDIA = re.compile(r"^/media/([A-Za-z0-9][A-Za-z0-9._-]{0,120})$")
RAYON_DEFAUT = "Sans rayon"


class Refus(Exception):
    def __init__(self, statut: int, message: str):
        super().__init__(message)
        self.statut = statut
        self.message = message


# ---------------------------------------------------------------- vérifier et réécrire une image

def transparente(im: Image.Image) -> bool:
    """Vrai si l'image a au moins un pixel qui n'est pas entièrement opaque."""
    if im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info):
        alpha = im.convert("RGBA").getchannel("A")
        return alpha.getextrema()[0] < 255
    return False


def nettoyer(contenu: bytes) -> tuple[bytes, str, dict]:
    """(octets réécrits, extension, {largeur, hauteur, transparente}) ; Refus si ce n'est pas une image acceptable."""
    if not contenu:
        raise Refus(400, "Aucune image reçue.")
    if len(contenu) > OCTETS_MAX:
        raise Refus(413, "Image trop lourde (15 Mo au plus).")
    try:
        with Image.open(io.BytesIO(contenu)) as im:
            format_ = im.format
            if format_ not in FORMATS:
                raise Refus(415, "Formats acceptés : PNG, JPEG ou WebP.")
            l, h = im.size
            if l > COTE_SOURCE_MAX or h > COTE_SOURCE_MAX or l * h > PIXELS_MAX:
                raise Refus(413, f"Image trop grande ({COTE_SOURCE_MAX} pixels de côté au plus).")
            if l < COTE_MIN or h < COTE_MIN:
                raise Refus(415, "Image trop petite.")
            # Une image animée : sa première vue seulement.
            im.seek(0)
            im.load()
            im = ImageOps.exif_transpose(im)
            alpha = transparente(im)
            im = im.convert("RGBA" if alpha else "RGB")
            if max(im.size) > COTE_MAX:
                im.thumbnail((COTE_MAX, COTE_MAX), Image.LANCZOS)
            # Une image neuve, faite des seuls pixels : aucune métadonnée de l'original ne la suit.
            propre = Image.new(im.mode, im.size)
            propre.paste(im)
            sortie = io.BytesIO()
            if format_ == "JPEG":
                propre.save(sortie, "JPEG", quality=90, optimize=True, progressive=True)
                extension = ".jpg"
            elif format_ == "WEBP":
                propre.save(sortie, "WEBP", quality=90, method=4, exact=alpha)
                extension = ".webp"
            else:
                propre.save(sortie, "PNG", optimize=True)
                extension = ".png"
            return sortie.getvalue(), extension, {"largeur": propre.width, "hauteur": propre.height, "transparente": alpha}
    except Refus:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        # Pillow refuse lui-même, dès l'en-tête, une image démesurée.
        raise Refus(413, f"Image trop grande ({COTE_SOURCE_MAX} pixels de côté au plus).")
    except (OSError, ValueError, SyntaxError):
        raise Refus(415, "Image illisible (PNG, JPEG ou WebP attendu).")


# ---------------------------------------------------------------- la bibliothèque

def nom_propre(v, maximum: int) -> str:
    return " ".join((v if isinstance(v, str) else "").split())[:maximum]


class Bibliotheque:
    """Les images rangées du MJ, dans un seul fichier, sous un verrou (Mac et iPad peuvent importer en même temps)."""

    def __init__(self, fichier: Path, images: Path):
        self.fichier = fichier
        self.images = images
        self.verrou = threading.Lock()

    def lire(self, compte: str | None = None) -> list:
        """Toutes les images ; avec `compte`, seulement celles de ce MJ (une image sans « auteur » est au principal)."""
        toutes = self._lire_tout()
        return toutes if compte is None else [x for x in toutes if proprietes.auteur_de(x) == compte]

    def _lire_tout(self) -> list:
        try:
            v = stockage.lire_json(self.fichier)
        except (OSError, ValueError):
            return []
        liste = v.get("images") if isinstance(v, dict) else None
        return [x for x in liste if isinstance(x, dict) and ID_IMAGE.match(str(x.get("id", "")))] if isinstance(liste, list) else []

    def ecrire(self, liste: list) -> None:
        stockage.ecrire_json(self.fichier, {"images": liste}, ensure_ascii=False, indent=1)

    def empreinte_de(self, image: dict) -> str:
        """L'empreinte d'une image de la bibliothèque : notée à l'import, sinon celle de son fichier (une image d'avant)."""
        if isinstance(image.get("empreinte"), str):
            return image["empreinte"]
        m = MEDIA.match(str(image.get("url") or ""))
        try:
            return hashlib.sha256((self.images / m.group(1)).read_bytes()).hexdigest() if m else ""
        except OSError:
            return ""

    def ajouter(self, contenu: bytes, nom, rayon, compte: str = proprietes.PRINCIPAL) -> dict:
        """Range l'image ; la même image (mêmes pixels une fois réécrite) déjà rangée n'entre pas deux fois : sa fiche
        revient, marquée « deja » (un double clic, la même image sous un autre nom)."""
        propre, extension, mesure = nettoyer(contenu)
        empreinte = hashlib.sha256(propre).hexdigest()
        nom_fichier = f"{secrets.token_hex(8)}{extension}"
        with self.verrou:
            liste = self._lire_tout()
            # Les images d'avant cette règle reçoivent leur empreinte une fois pour toutes (un fichier lu par image).
            notees = 0
            for x in liste:
                if not isinstance(x.get("empreinte"), str) and (e := self.empreinte_de(x)):
                    x["empreinte"] = e
                    notees += 1
            deja = next((x for x in liste if x.get("empreinte") == empreinte and proprietes.auteur_de(x) == compte), None)
            if deja is not None:
                if notees:
                    self.ecrire(liste)
                return {**deja, "deja": True}
            if len([x for x in liste if proprietes.auteur_de(x) == compte]) >= IMAGES_MAX:
                raise Refus(409, f"La bibliothèque est pleine ({IMAGES_MAX} images) : retirez-en d'abord.")
            (self.images / nom_fichier).write_bytes(propre)
            image = {
                "id": f"img-{secrets.token_hex(5)}", "nom": nom_propre(nom, NOM_MAX) or "Image",
                "rayon": nom_propre(rayon, RAYON_MAX) or RAYON_DEFAUT, "url": f"/media/{nom_fichier}", **mesure,
                "ajoute": time.strftime("%Y-%m-%dT%H:%M:%S"), "empreinte": empreinte,
            }
            if compte != proprietes.PRINCIPAL:
                image["auteur"] = compte
            liste.append(image)
            self.ecrire(liste)
        return image

    def modifier(self, ident: str, corps: dict, compte: str = proprietes.PRINCIPAL) -> dict:
        if not isinstance(corps, dict) or not {"nom", "rayon"} & set(corps):
            raise Refus(400, "Rien à changer : un nom ou un rayon.")
        with self.verrou:
            liste = self._lire_tout()
            image = next((x for x in liste if x.get("id") == ident and proprietes.auteur_de(x) == compte), None)
            if image is None:
                raise Refus(404, "Image introuvable.")
            if "nom" in corps:
                image["nom"] = nom_propre(corps["nom"], NOM_MAX) or image.get("nom") or "Image"
            if "rayon" in corps:
                image["rayon"] = nom_propre(corps["rayon"], RAYON_MAX) or RAYON_DEFAUT
            self.ecrire(liste)
        return image

    def retirer(self, ident: str, compte: str = proprietes.PRINCIPAL) -> None:
        """Retire l'image de la bibliothèque. Son fichier reste : les plans qui l'utilisent la gardent."""
        with self.verrou:
            liste = self._lire_tout()
            reste = [x for x in liste if not (x.get("id") == ident and proprietes.auteur_de(x) == compte)]
            if len(reste) == len(liste):
                raise Refus(404, "Image introuvable.")
            self.ecrire(reste)


# ---------------------------------------------------------------- ce qui sort vers la table

def est_image(o) -> bool:
    return isinstance(o, dict) and o.get("cle") == CLE


def objet_public(o: dict, media_existant) -> dict:
    """Les champs qu'ajoute à un objet public (déjà jugé visible) un objet image : son adresse /media/ si le fichier
    existe, sa couche (au-dessus des pions ou dessous) et s'il se franchit. Rien pour un meuble d'avant."""
    if not est_image(o):
        return {}
    url = o.get("image")
    return {"image": url if isinstance(url, str) and MEDIA.match(url) and media_existant(url) else "",
            "dessus": o.get("dessus") is True, "franchissable": o.get("franchissable") is True}


# Une image à cheval sur des cases révélées et des cases cachées : comme le fond du plan, elle ne sort que masquée. Le
# dessin la pose par-dessus le brouillard (plan/rendu.js, plan/peint.js) : entière, elle montrerait la partie cachée.
ID_OBJET = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
PIXELS_PAR_CASE = 8  # finesse du masque : la limite d'une case cachée tombe à un huitième de case près


def nombre(v, defaut: float = 0.0) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
        return defaut
    return float(v)


def masquer(chemin: Path, o: dict, vu: list, largeur_plan: int, hauteur_plan: int, largeur: int | None = None) -> bytes | None:
    """L'image d'un objet image, transparente partout où les joueurs n'ont rien vu (hors du plan compris), en PNG sans
    métadonnées ; None si elle ne se lit pas. vu : une valeur par case du plan (1 : révélée). largeur : réduite d'abord à
    cette largeur au plus (le coin des joueurs). Même géométrie que le dessin (plan/images.js) : l × h cases avant
    rotation, tournée autour du centre de son emprise."""
    l, h = max(nombre(o.get("l"), 1), 0.01), max(nombre(o.get("h"), 1), 0.01)
    rot = nombre(o.get("rot")) % 360
    bl, bh = (h, l) if rot % 180 != 0 else (l, h)
    x0, y0 = nombre(o.get("x")), nombre(o.get("y"))
    try:
        with Image.open(chemin) as source:
            source.seek(0)
            source.load()
            im = ImageOps.exif_transpose(source).convert("RGBA")
    except (OSError, ValueError, SyntaxError, EOFError, Image.DecompressionBombError):
        return None
    if largeur and im.width > largeur:
        im.thumbnail((largeur, 2 * largeur), Image.LANCZOS)
    k = PIXELS_PAR_CASE
    gx0, gy0 = math.floor(x0) - 1, math.floor(y0) - 1
    gw, gh = math.ceil(x0 + bl) + 1 - gx0, math.ceil(y0 + bh) + 1 - gy0
    grille = Image.new("L", (gw, gh), 0)
    grille.putdata([255 if 0 <= gx0 + i < largeur_plan and 0 <= gy0 + j < hauteur_plan
                    and vu[(gy0 + j) * largeur_plan + gx0 + i] == 1 else 0 for j in range(gh) for i in range(gw)])
    grille = grille.resize((gw * k, gh * k), Image.NEAREST)
    # Un pixel (u, v) de l'image tombe sur la case centre + R(rot)·(u·l/W − l/2, v·h/H − h/2), comme ctx.rotate.
    c, s = round(math.cos(math.radians(rot)), 12), round(math.sin(math.radians(rot)), 12)
    W, H = im.size
    cx, cy = x0 + bl / 2 - gx0, y0 + bh / 2 - gy0
    affine = (k * c * l / W, -k * s * h / H, k * (cx - c * l / 2 + s * h / 2),
              k * s * l / W, k * c * h / H, k * (cy - s * l / 2 - c * h / 2))
    masque = grille.transform((W, H), Image.AFFINE, affine, resample=Image.NEAREST, fillcolor=0)
    # Une image neuve, faite des seuls pixels (aucune métadonnée de l'original ne la suit) ; le caché y est vide, couleur
    # comprise : un pixel seulement transparent garderait sa couleur, qu'on retrouverait en ôtant la transparence.
    propre = Image.composite(im, Image.new("RGBA", im.size, (0, 0, 0, 0)), masque)
    sortie = io.BytesIO()
    propre.save(sortie, "PNG", compress_level=6)
    return sortie.getvalue()


def routes(bibliotheque: Bibliotheque, corps_objet):
    """Les routes de la bibliothèque, dans l'atelier seul (hors de /api/table/… : la garde de la table publique les
    refuse depuis Internet, et le coin des joueurs ne les a pas)."""
    from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
    import asyncio

    r = APIRouter()

    def refus(err: Refus):
        return HTTPException(err.statut, err.message)

    @r.get("/api/bibliotheque-images")
    def lister():
        return {"images": bibliotheque.lire(proprietes.compte_courant())}

    @r.post("/api/bibliotheque-images")
    async def importer(image: UploadFile = File(...), nom: str = Form(""), rayon: str = Form("")):
        contenu = bytearray()
        while morceau := await image.read(1024 * 1024):
            contenu += morceau
            if len(contenu) > OCTETS_MAX:
                raise HTTPException(413, "Image trop lourde (15 Mo au plus).")
        try:
            return await asyncio.to_thread(bibliotheque.ajouter, bytes(contenu), nom, rayon, proprietes.compte_courant())
        except Refus as err:
            raise refus(err)

    @r.patch("/api/bibliotheque-images/{ident}")
    async def modifier(ident: str, requete: Request):
        if not ID_IMAGE.match(ident):
            raise HTTPException(404, "Image introuvable.")
        try:
            return bibliotheque.modifier(ident, await corps_objet(requete), proprietes.compte_courant())
        except Refus as err:
            raise refus(err)

    @r.delete("/api/bibliotheque-images/{ident}")
    def retirer(ident: str):
        if not ID_IMAGE.match(ident):
            raise HTTPException(404, "Image introuvable.")
        try:
            bibliotheque.retirer(ident, proprietes.compte_courant())
        except Refus as err:
            raise refus(err)
        return {"ok": True}

    return r
