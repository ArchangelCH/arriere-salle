"""Les images de /media/ : un navigateur qui lit le WebP reçoit les grosses images (PNG ou JPEG de plus de 400 Ko) en WebP
de qualité 88, trois à sept fois plus légères ; l'original reste intact dans data/images/. La version légère est gardée
dans le dossier temporaire du serveur, nommée d'après le fichier, sa taille et sa date : elle se refait seule si l'original
change ou si le dossier disparaît. Même adresse pour les deux versions (en-tête Vary: Accept)."""

import asyncio
import hashlib
import tempfile
from pathlib import Path

from PIL import Image, ImageOps
from starlette.responses import FileResponse
from starlette.staticfiles import StaticFiles

SEUIL = 400 * 1024
QUALITE = 88
DOSSIER = Path(tempfile.gettempdir()) / "arriere-salle-medias-legers"


def version_legere(source: Path) -> Path | None:
    """Le WebP de l'image (créé au besoin), ou None si l'image reste telle quelle (petite, illisible, déjà WebP)."""
    try:
        st = source.stat()
    except OSError:
        return None
    if source.suffix.lower() not in (".png", ".jpg", ".jpeg") or st.st_size < SEUIL:
        return None
    cible = DOSSIER / (hashlib.sha1(f"{source.name}|{st.st_size}|{st.st_mtime_ns}".encode()).hexdigest()[:20] + ".webp")
    if cible.is_file():
        return cible
    try:
        DOSSIER.mkdir(parents=True, exist_ok=True)
        with Image.open(source) as image:
            image = ImageOps.exif_transpose(image)
            if image.mode not in ("RGB", "RGBA"):
                image = image.convert("RGBA" if "A" in image.getbands() or "transparency" in image.info else "RGB")
            provisoire = cible.with_suffix(f".{hashlib.sha1(str(id(image)).encode()).hexdigest()[:6]}.tmp")
            image.save(provisoire, "WEBP", quality=QUALITE, method=4)
        provisoire.replace(cible)
    except (OSError, ValueError, Image.DecompressionBombError):
        return None
    if cible.stat().st_size >= st.st_size:
        return None
    return cible


class MediasLegers(StaticFiles):
    async def get_response(self, path, scope):
        reponse = await super().get_response(path, scope)
        if not isinstance(reponse, FileResponse) or reponse.status_code != 200 or scope.get("method") not in ("GET", "HEAD"):
            return reponse
        accepte = dict((k.decode("latin-1").lower(), v.decode("latin-1")) for k, v in scope.get("headers", [])).get("accept", "")
        if "image/webp" in accepte:
            legere = await asyncio.to_thread(version_legere, Path(reponse.path))
            if legere is not None:
                nouvelle = FileResponse(legere, media_type="image/webp")
                nouvelle.headers["Vary"] = "Accept"
                return nouvelle
        reponse.headers["Vary"] = "Accept"
        return reponse
