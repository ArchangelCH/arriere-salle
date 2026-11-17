"""La musique de fond : une liste d'ambiances, chacune un lien YouTube (une vidéo ou une playlist).

La lecture se fait dans l'atelier, sur l'ordinateur du MJ, par le lecteur intégré de YouTube. Le serveur garde la liste,
reconnaît les liens et demande à YouTube (oEmbed) le titre et si la vidéo accepte d'être lue hors de YouTube.
"""

import re
import secrets
from urllib.parse import parse_qs, urlsplit

import httpx

VIDEO = re.compile(r"^[A-Za-z0-9_-]{11}$")
LISTE = re.compile(r"^[A-Za-z0-9_-]{10,64}$")
HOTES_YOUTUBE = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com",
                 "www.youtube-nocookie.com"}
AMBIANCES_MAX = 60
NOM_MAX = 60
NOTE_MAX = 200


class LienInvalide(ValueError):
    pass


def analyser_lien(lien: str) -> dict:
    """{"video": id ou None, "liste": id ou None} d'après un lien YouTube collé tel quel."""
    lien = (lien or "").strip()
    if not lien:
        raise LienInvalide("Lien vide")
    if "://" not in lien:
        lien = "https://" + lien
    morceaux = urlsplit(lien)
    hote = (morceaux.hostname or "").lower()
    requete = parse_qs(morceaux.query)
    chemin = [m for m in morceaux.path.split("/") if m]
    video = None
    if hote in ("youtu.be", "www.youtu.be"):
        video = chemin[0] if chemin else None
    elif hote in HOTES_YOUTUBE:
        if chemin[:1] == ["watch"]:
            video = (requete.get("v") or [None])[0]
        elif len(chemin) >= 2 and chemin[0] in ("embed", "shorts", "live", "v"):
            video = None if chemin[1] == "videoseries" else chemin[1]
        elif chemin[:1] != ["playlist"]:
            raise LienInvalide("Ce lien YouTube ne mène ni à une vidéo ni à une playlist")
    else:
        raise LienInvalide("Seuls les liens YouTube sont acceptés")
    liste = (requete.get("list") or [None])[0]
    if video is not None and not VIDEO.match(video):
        raise LienInvalide("Identifiant de vidéo illisible")
    if liste is not None and not LISTE.match(liste):
        raise LienInvalide("Identifiant de playlist illisible")
    if not video and not liste:
        raise LienInvalide("Ce lien YouTube ne mène ni à une vidéo ni à une playlist")
    return {"video": video, "liste": liste}


def lien_canonique(source: dict) -> str:
    if source.get("liste"):
        return f"https://www.youtube.com/playlist?list={source['liste']}"
    return f"https://www.youtube.com/watch?v={source['video']}"


async def verifier(source: dict) -> dict:
    """Titre et auteur selon YouTube. "lisible" vaut False quand YouTube refuse la lecture hors de son site,
    None quand YouTube n'a pas répondu (la liste s'enregistre quand même)."""
    try:
        async with httpx.AsyncClient(timeout=6, follow_redirects=True) as client:
            r = await client.get("https://www.youtube.com/oembed", params={"url": lien_canonique(source), "format": "json"})
    except httpx.HTTPError:
        return {"lisible": None, "titre": "", "auteur": ""}
    if r.status_code == 200:
        try:
            d = r.json()
        except ValueError:
            return {"lisible": None, "titre": "", "auteur": ""}
        return {"lisible": True, "titre": str(d.get("title") or "")[:200], "auteur": str(d.get("author_name") or "")[:100]}
    if r.status_code in (401, 403):
        return {"lisible": False, "titre": "", "auteur": "", "raison": "YouTube refuse sa lecture hors de son site"}
    if r.status_code in (400, 404):
        return {"lisible": False, "titre": "", "auteur": "", "raison": "Introuvable sur YouTube (privée ou supprimée)"}
    return {"lisible": None, "titre": "", "auteur": ""}


def nettoyer_combat(valeur, ambiances: list, quoi: str = "de combat") -> str | None:
    """L'ambiance de combat (ou de boutique) choisie dans le panneau : l'identifiant d'une ambiance de la liste, ou None
    (aucune)."""
    if valeur is None or valeur == "":
        return None
    if not isinstance(valeur, str) or not any(isinstance(a, dict) and a.get("id") == valeur for a in ambiances):
        raise LienInvalide(f"Cette ambiance {quoi} n'est pas dans la liste")
    return valeur


def combat_retenu(valeur, ambiances: list) -> str | None:
    """L'ambiance de combat (ou de boutique) déjà enregistrée, tant qu'elle reste dans la liste (retirée de la liste :
    plus aucune)."""
    try:
        return nettoyer_combat(valeur, ambiances)
    except LienInvalide:
        return None


def nettoyer_boutique(valeur, ambiances: list) -> str | None:
    """L'ambiance jouée quand la TV montre une boutique (musique-boutique.js)."""
    return nettoyer_combat(valeur, ambiances, "de boutique")


def nettoyer(ambiances, anciennes: list) -> list:
    """La liste envoyée par l'atelier, vérifiée champ par champ. Le titre YouTube déjà connu est repris quand le lien
    n'a pas changé ; les autres sont à vérifier (champ "verifier")."""
    if not isinstance(ambiances, list):
        raise LienInvalide("Liste d'ambiances attendue")
    if len(ambiances) > AMBIANCES_MAX:
        raise LienInvalide(f"{AMBIANCES_MAX} ambiances au plus")
    connues = {(a.get("video"), a.get("liste")): a for a in anciennes if isinstance(a, dict)}
    propres, ids = [], set()
    for i, a in enumerate(ambiances, 1):
        if not isinstance(a, dict):
            raise LienInvalide(f"Ambiance n° {i} illisible")
        nom = " ".join(str(a.get("nom") or "").split())[:NOM_MAX]
        if not nom:
            raise LienInvalide(f"L'ambiance n° {i} n'a pas de nom")
        try:
            source = analyser_lien(str(a.get("lien") or ""))
        except LienInvalide as err:
            raise LienInvalide(f"« {nom} » : {err}") from None
        ident = re.sub(r"[^a-z0-9-]", "", str(a.get("id") or ""))[:40]
        while not ident or ident in ids:
            ident = "a-" + secrets.token_hex(3)
        ids.add(ident)
        ancienne = connues.get((source["video"], source["liste"]), {})
        propres.append({
            "id": ident,
            "nom": nom,
            "lien": lien_canonique(source) if not (source["video"] and source["liste"]) else
            f"https://www.youtube.com/watch?v={source['video']}&list={source['liste']}",
            "video": source["video"],
            "liste": source["liste"],
            "note": " ".join(str(a.get("note") or "").split())[:NOTE_MAX],
            "titre": ancienne.get("titre", ""),
            "auteur": ancienne.get("auteur", ""),
            "lisible": ancienne.get("lisible"),
            "raison": ancienne.get("raison", ""),
            "verifier": not ancienne or ancienne.get("lisible") is None,
        })
    return propres
