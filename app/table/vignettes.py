"""Les portraits réduits de la table publique : sur un téléphone et un réseau lent, la tablée tirait près de 1 Mo de
portraits en taille réelle (832 × 1216, et un PNG de 2,4 Mo) pour des médaillons de 80 pixels. Une vignette en JPEG,
sans métadonnées, de 160, 320 ou 640 pixels de large, gardée en mémoire : le nom d'une image ne change jamais de contenu
(main.py, en-têtes de /media/), la vignette non plus. La TV du salon garde les images entières.
"""
import io
from collections import OrderedDict
from pathlib import Path

from PIL import Image, ImageOps

LARGEURS = (160, 320, 640)
GARDEES = 256  # vignettes en mémoire, les plus anciennes s'en vont d'abord
FOND = (244, 234, 212)  # le parchemin, sous une image transparente
PNG = b"\x89PNG\r\n\x1a\n"
RIFF = b"RIFF"
_cache: OrderedDict = OrderedDict()


def largeur(demandee) -> int:
    """La plus petite largeur permise qui couvre la demande (trois tailles seulement : peu de vignettes à garder)."""
    try:
        n = int(demandee)
    except (TypeError, ValueError):
        n = 320
    return next((x for x in LARGEURS if x >= n), LARGEURS[-1])


def vignette(chemin: Path, demandee=320, transparence: bool = False, webp: bool = False) -> bytes | None:
    """La vignette de l'image (au plus `largeur` de large et deux fois plus de haut), ou None si elle est illisible.
    transparence : une image du MJ posée sur un plan garde ses pixels transparents, en PNG ; sans un seul pixel
    transparent, elle reste un JPEG comme les portraits. webp : un WebP (le tiers de moins qu'un JPEG) au lieu du JPEG."""
    l = largeur(demandee)
    try:
        st = chemin.stat()
    except OSError:
        return None
    cle = (str(chemin), st.st_size, st.st_mtime_ns, l, bool(transparence), bool(webp))
    if cle in _cache:
        _cache.move_to_end(cle)
        return _cache[cle]
    try:
        with Image.open(chemin) as source:
            im = ImageOps.exif_transpose(source)
            im.thumbnail((l, 2 * l))
            sortie = io.BytesIO()
            if transparence and im.mode in ("RGBA", "LA", "PA", "P") and im.convert("RGBA").getchannel("A").getextrema()[0] < 255:
                # Une image neuve, faite des seuls pixels : le PNG garderait sinon le profil de couleur de l'original.
                propre = Image.new("RGBA", im.size)
                propre.paste(im.convert("RGBA"))
                propre.save(sortie, "PNG", optimize=True)
                return garder(cle, sortie.getvalue())
            if im.mode not in ("RGB", "L"):
                fond = Image.new("RGB", im.size, FOND)
                fond.paste(im, mask=im.convert("RGBA").getchannel("A"))
                im = fond
            if webp:
                im.convert("RGB").save(sortie, "WEBP", quality=78, method=4)
            else:
                im.convert("RGB").save(sortie, "JPEG", quality=80, optimize=True, progressive=True)
    except (OSError, ValueError, Image.DecompressionBombError):
        return None
    return garder(cle, sortie.getvalue())


def garder(cle, contenu: bytes) -> bytes:
    _cache[cle] = contenu
    while len(_cache) > GARDEES:
        _cache.popitem(last=False)
    return contenu
