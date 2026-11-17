"""Lecture et écriture des fiches JSON, identifiants, archives : l'outillage commun des routes."""

import re
import secrets
import shutil
import time
import unicodedata
from datetime import datetime
from pathlib import Path

from fastapi import HTTPException, Request

from mj import cloisonnement
from contenu import corbeille
from contenu import liens_fiches
from mj import proprietes

from api import config
from commun import stockage


def maintenant() -> str:
    # Au millième de seconde : c'est aussi la version qui départage deux écrans.
    return datetime.now().isoformat(timespec="milliseconds")


def slug(texte: str) -> str:
    t = unicodedata.normalize("NFKD", texte or "").encode("ascii", "ignore").decode().lower()
    t = re.sub(r"[^a-z0-9]+", "-", t).strip("-")
    return t[:40].strip("-") or "sans-nom"


def lire(chemin: Path):
    return stockage.lire_json(chemin)


def lire_tout(dossier: Path, tout: bool = False, lecture: bool = False) -> list:
    """Toutes les fiches d'un dossier. Un fichier illisible est signalé dans le journal et laissé de côté :
    il ne doit pas rendre tout l'atelier inutilisable. Pour une collection à auteur, les seules fiches du lecteur
    (cloisonnement.py) ; tout : l'union des MJ, réservée aux projections publiques (cloisonnement.PROJECTIONS_PUBLIQUES) ;
    lecture : avec les fiches que l'autre MJ partage, pour les lire seulement (jamais avant une écriture)."""
    fiches = []
    for f in sorted(dossier.glob("*.json")):
        try:
            fiche = lire(f)
        except (OSError, ValueError) as err:
            config.journal.warning("Fiche illisible ignorée : %s (%s)", f, err)
            continue
        if isinstance(fiche, dict):
            fiches.append(fiche)
    return cloisonnement.garder(dossier.name, fiches, tout, lecture=lecture)


def ecrire(chemin: Path, contenu) -> None:
    chemin.parent.mkdir(parents=True, exist_ok=True)
    stockage.ecrire_json_compact(chemin, contenu)


async def corps_objet(requete: Request) -> dict:
    try:
        corps = await requete.json()
    except ValueError:
        raise HTTPException(400, "Corps de requête illisible (JSON attendu)")
    if not isinstance(corps, dict):
        raise HTTPException(400, "Corps de requête invalide (objet JSON attendu)")
    return corps


def texte(valeur) -> str:
    if valeur is None:
        return ""
    if isinstance(valeur, list):
        return "\n".join(texte(v) for v in valeur)
    return valeur if isinstance(valeur, str) else str(valeur)


def nombre(valeur, defaut=0) -> float:
    try:
        return float(valeur)
    except (TypeError, ValueError):
        return defaut


def fichier(dossier: Path, ident: str) -> Path:
    if not config.ID_VALIDE.match(ident):
        raise HTTPException(400, "Identifiant invalide")
    return dossier / f"{ident}.json"


def nouvel_id(dossier: Path, nom: str) -> str:
    # Un MJ invité reçoit des identifiants opaques (« i-… ») : ni l'identifiant de sa fiche ne dit son nom, ni un suffixe
    # ajouté ne trahit qu'une fiche de l'autre MJ porte déjà ce nom (cloisonnement.py).
    opaque = proprietes.a_auteur(dossier.name) and proprietes.compte_courant() != proprietes.PRINCIPAL
    base = "i" if opaque else slug(nom)
    ident = f"i-{secrets.token_hex(6)}" if opaque else base
    # Ni une fiche existante, ni l'ancien identifiant d'une fiche renommée (liens_fiches.py) : un écran resté dessus le suit.
    while (dossier / f"{ident}.json").exists() or liens_fiches.pris_par_un_renommage(dossier, ident):
        ident = f"{base}-{secrets.token_hex(2)}"
    return ident


PARTAGEE_EN_LECTURE = "Cette fiche est partagée en lecture : seul son auteur peut la modifier."


def existant(dossier: Path, ident: str, tout: bool = False, lecture: bool = False) -> Path:
    """Le chemin d'une fiche ; 404 si elle n'existe pas, ou (collection à auteur) si elle n'est pas au lecteur : pour lui,
    une fiche de l'autre MJ n'existe pas. tout : comme lire_tout. lecture : la route ne fait que lire ; la fiche que
    l'autre MJ partage passe alors aussi. Sans lecture (toute écriture), elle est refusée par un 403 qui le dit : le
    lecteur sait déjà qu'elle existe."""
    chemin = fichier(dossier, ident)
    if not chemin.exists():
        raise HTTPException(404, "Introuvable")
    if not cloisonnement.permis_chemin(dossier.name, chemin, tout, lecture=lecture):
        if not lecture and not tout and cloisonnement.partagee_par_un_autre(dossier.name, chemin):
            raise HTTPException(403, PARTAGEE_EN_LECTURE)
        raise HTTPException(404, "Introuvable")
    return chemin


def lire_fiche(chemin: Path) -> dict:
    try:
        fiche = lire(chemin)
    except (OSError, ValueError):
        raise HTTPException(500, f"Fichier illisible : {chemin.name}")
    if not isinstance(fiche, dict):
        raise HTTPException(500, f"Fichier invalide : {chemin.name}")
    return fiche


def media_existant(url) -> bool:
    m = config.MEDIA_VALIDE.match(url or "") if isinstance(url, str) else None
    return bool(m) and (config.IMAGES / m.group(1)).is_file()


def archiver(chemin: Path, sous_dossier: str, maximum: int = config.ARCHIVES_MAX) -> None:
    """Garde une copie de la version précédente, au plus une toutes les 5 minutes, les `maximum` dernières."""
    if not chemin.exists():
        return
    dossier = config.HISTORIQUE / sous_dossier / chemin.stem
    dossier.mkdir(parents=True, exist_ok=True)
    versions = sorted(dossier.glob("*.json"))
    if versions and time.time() - versions[-1].stat().st_mtime < config.ARCHIVE_DELAI:
        return
    # copyfile et non copy2 : la date de la copie doit être celle de l'archivage, pas celle du fichier d'origine.
    shutil.copyfile(chemin, dossier / f"{time.strftime('%Y%m%d-%H%M%S')}.json")
    for ancienne in versions[: max(0, len(versions) + 1 - maximum)]:
        ancienne.unlink(missing_ok=True)


def jeter(chemin: Path, sous_dossier: str) -> None:
    cible = config.CORBEILLE / sous_dossier
    cible.mkdir(parents=True, exist_ok=True)
    chemin.replace(corbeille.place_jetee(cible, chemin.stem))
