"""La charte visuelle, les illustrations et le téléversement d'images."""

import asyncio
import io
import secrets

import httpx
from fastapi import File, HTTPException, Request, UploadFile
from PIL import Image, ImageOps

from ia.illustrations import FORMATS, FilePleine, comfy_disponible, ecrire_portrait, ecrire_prompt, reglages
from ia import charte
from mj import cloisonnement
from ia import images_plan
from ia import budget_mj

from api.application import app
from api import config, application, utilitaires


# La charte visuelle des portraits (charte.py) : un seul document, enregistré entier avec sa version (409 si un autre
# écran l'a changé). Tant que le MJ ne l'a pas enregistrée, c'est la charte de départ.
CHARTE = config.DONNEES / "charte-visuelle.json"


def lire_charte() -> dict:
    try:
        contenu = utilitaires.lire(CHARTE) if CHARTE.exists() else None
    except (OSError, ValueError):
        contenu = None
    if not isinstance(contenu, dict) or not isinstance(contenu.get("entrees"), list):
        return {"entrees": charte.nettoyer(charte.CHARTE_DEPART), "modifie": None}
    return contenu


@app.get("/api/charte-visuelle")
def charte_lire():
    return lire_charte()


@app.put("/api/charte-visuelle")
async def charte_changer(requete: Request):
    corps = await utilitaires.corps_objet(requete)
    actuel = lire_charte()
    if "version_base" in corps and corps["version_base"] != actuel.get("modifie"):
        raise HTTPException(409, "La charte a été modifiée depuis un autre écran.")
    try:
        entrees = charte.nettoyer(corps.get("entrees"))
    except ValueError as err:
        raise HTTPException(422, str(err))
    nouveau = {"entrees": entrees, "modifie": utilitaires.maintenant()}
    utilitaires.ecrire(CHARTE, nouveau)
    return nouveau


def reperes_du_portrait(description: str) -> list[dict]:
    return [e for e in charte.reperes(description, lire_charte()["entrees"]) if charte.a_quelque_chose(e)]


@app.post("/api/illustrations/prompt")
async def prompt_illustration(requete: Request):
    corps = await utilitaires.corps_objet(requete)
    description = utilitaires.texte(corps.get("description")).strip()
    if not description:
        raise HTTPException(400, "Décrivez d'abord ce qu'on voit")
    try:
        if utilitaires.texte(corps.get("genre")) != "portrait":
            return {"prompt": await ecrire_prompt(description)}
        trouves = reperes_du_portrait(description)
        r = await ecrire_portrait(description, utilitaires.texte(corps.get("couleurs"))[:200], charte.en_texte(trouves), charte.appuis(trouves))
        return {**r, "reperes": [e["nom"] for e in trouves]}
    except (httpx.HTTPError, ValueError) as err:
        raise noms_caches.erreur_modele(err)


@app.post("/api/illustrations")
async def commander_illustrations(requete: Request):
    corps = await utilitaires.corps_objet(requete)
    cible = corps.get("cible") or "lieu"
    ident = corps.get("fiche") or corps.get("lieu") or ""
    if cible not in application.DOSSIERS or not isinstance(ident, str):
        raise HTTPException(400, "Fiche inconnue")
    # Les portraits des héros restent au compte principal, comme leurs illustrations (acces_mj.py).
    if cible == "aventurier" and cloisonnement.est_invite() and cloisonnement.refuse("heros-illustre", "aventuriers"):
        raise HTTPException(404, "Introuvable")
    utilitaires.existant(application.DOSSIERS[cible], ident)
    prompt = utilitaires.texte(corps.get("prompt")).strip()
    if not prompt:
        raise HTTPException(400, "Il faut une consigne d'image")
    genre = "portrait" if cible in ("pnj", "aventurier") or corps.get("genre") == "portrait" else "lieu"
    description = utilitaires.texte(corps.get("description"))
    options = {}
    if genre == "portrait":
        # La charte décide du cadrage (un nain en mi-corps) ; des couleurs imposées gardent des lumières neutres ; le
        # modèle de l'API contrôle chaque image d'après la description, les repères et les couleurs.
        couleurs = " ".join(utilitaires.texte(corps.get("couleurs")).split())[:200]
        trouves = reperes_du_portrait(description)
        options = {"negatif": " ".join(utilitaires.texte(corps.get("negatif")).split())[:400], "cadrage": charte.cadrage(trouves),
                   "sobre": bool(couleurs) or charte.impose_couleurs(trouves),
                   "controle": {"description": description[:1500], "reperes": charte.en_texte(trouves), "couleurs": couleurs}}
    try:
        travaux = application.atelier.ajouter(cible, ident, prompt, utilitaires.texte(corps.get("format")) or "paysage", int(utilitaires.nombre(corps.get("nombre"), 1)),
                                  description, genre, qui=budget_mj.qui_courant(), **options)
    except FilePleine as err:
        raise HTTPException(429, str(err))
    return {"travaux": [t["id"] for t in travaux]}


@app.get("/api/illustrations/style")
def style_illustrations(genre: str = "lieu"):
    r = reglages()
    s = "_portrait" if genre == "portrait" else ""
    return {k: r.get(k + s, r.get(k, "")) for k in ("prefixe", "suffixe", "negatif")}


def travail_au_lecteur(t: dict) -> bool:
    """Un portrait ou un paysage en cours pour une fiche que le lecteur peut lire (pour un invité : ni un héros, ni une
    fiche de l'autre MJ, dont la consigne d'image dirait le contenu)."""
    if not cloisonnement.est_invite():
        return True
    if t.get("cible") == "aventurier":
        return not cloisonnement.refuse("heros-illustre", "aventuriers")
    dossier = application.DOSSIERS.get(t.get("cible"))
    ident = t.get("fiche")
    if dossier is None or not isinstance(ident, str) or not config.ID_VALIDE.match(ident):
        return not cloisonnement.refuse("travail-sans-fiche")
    return cloisonnement.permis_chemin(dossier.name, dossier / f"{ident}.json")


@app.get("/api/illustrations")
async def file_illustrations():
    return {"travaux": [t for t in application.atelier.etat() if travail_au_lecteur(t)], "moteur": await comfy_disponible(), "formats": list(FORMATS)}


def reencoder(contenu: bytes) -> tuple[bytes, str]:
    """Une image téléversée est vérifiée et réécrite : format réel (pas celui qu'annonce le navigateur), taille en
    pixels bornée, métadonnées retirées (un texte caché dans un PNG n'arrive pas jusqu'à la TV)."""
    try:
        with Image.open(io.BytesIO(contenu)) as im:
            format_ = im.format
            if format_ not in config.FORMATS_IMAGES:
                raise HTTPException(415, "Formats acceptés : PNG, JPEG, WebP")
            if im.width * im.height > config.PIXELS_MAX:
                raise HTTPException(413, "Image trop grande (40 millions de pixels au plus)")
            im.load()
            im = ImageOps.exif_transpose(im)
            sortie = io.BytesIO()
            if format_ == "JPEG":
                im.convert("RGB").save(sortie, "JPEG", quality=92, optimize=True, progressive=True)
            elif format_ == "WEBP":
                im.save(sortie, "WEBP", quality=92)
            else:
                if im.mode not in ("RGB", "RGBA", "L", "LA", "P"):
                    im = im.convert("RGBA")
                im.save(sortie, "PNG", optimize=True)
            return sortie.getvalue(), config.FORMATS_IMAGES[format_]
    except HTTPException:
        raise
    except (OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(415, "Image illisible (PNG, JPEG ou WebP attendu)")


@app.post("/api/images")
async def televerser_image(image: UploadFile = File(...)):
    contenu = bytearray()
    while morceau := await image.read(1024 * 1024):
        contenu += morceau
        if len(contenu) > config.IMAGE_MAX:
            raise HTTPException(413, "Image trop lourde (25 Mo au plus)")
    propre, extension = await asyncio.to_thread(reencoder, bytes(contenu))
    # Nom tiré au sort : ni le nom du fichier d'origine ni celui de la fiche n'apparaissent dans l'adresse.
    nom = f"{secrets.token_hex(8)}{extension}"
    (config.IMAGES / nom).write_bytes(propre)
    return {"url": f"/media/{nom}", "nom": nom}


# La bibliothèque d'images du MJ pour ses plans (lot H2, images_plan.py) : pions et décors importés, rangés et nommés,
# vérifiés par Pillow et réécrits sans métadonnées dans data/images. Rien de la bibliothèque ne part vers la table.
BIBLIOTHEQUE_IMAGES = images_plan.Bibliotheque(config.DONNEES / "bibliotheque-images.json", config.IMAGES)
app.include_router(images_plan.routes(BIBLIOTHEQUE_IMAGES, utilitaires.corps_objet))


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import noms_caches  # noqa: E402
