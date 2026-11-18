"""La musique du MJ à la table du coin (lot du 19/11) : ce que joue le lecteur de l'atelier (musique.js, sur
l'ordinateur du MJ) s'entend aussi sur la page Table des joueurs, en visio comme autour de la table.

- L'atelier écrit `musique/ecoute.json` quand son lecteur change (morceau, pause, arrêt) et de loin en loin pendant la
  lecture : seulement la vidéo YouTube qui joue, l'endroit où elle en est, et si elle joue. Jamais le nom de l'ambiance
  ni sa note (elles nomment des lieux), jamais la liste. Rien n'est écrit quand la table du coin est fermée ou que le MJ
  a coupé « Votre musique à la table du coin » (réglage de la table, champ « musique ») : le fichier s'efface.
- Le coin l'apprend par le flux (sujet « musique ») et le relit par GET /api/musique-table, qui dit où en est la vidéo
  à cet instant (l'âge se compte sur l'horloge du serveur, jamais celle d'un téléphone).
- Chaque appareil choisit d'écouter ou non (autour de la vraie table, les haut-parleurs du MJ suffisent).

Ce module ne lit rien de l'atelier : le coin (joueurs.py) et l'atelier (tv_ecran.py) l'importent tous deux.
"""
import re
from datetime import datetime
from pathlib import Path

from commun import stockage
from commun.demandes import Refus

DOSSIER = "musique"
FICHIER = "ecoute.json"
OCTETS_MAX = 1024
ETATS = ("joue", "pause", "arret")
VIDEO = re.compile(r"^[A-Za-z0-9_-]{11}$")
TEMPS_MAX = 7 * 24 * 3600  # secondes : une vidéo d'ambiance de dix heures y tient largement
VIEILLE = 15 * 60  # secondes : une lecture sans nouvelle depuis un quart d'heure n'est plus suivie (l'atelier s'est tu)


def maintenant() -> str:
    return datetime.now().isoformat(timespec="milliseconds")


def valider(corps) -> dict:
    """{etat, video, temps} venus du lecteur du MJ : « arret » n'a ni vidéo ni temps."""
    if not isinstance(corps, dict) or corps.get("etat") not in ETATS:
        raise Refus(400, "La musique : « joue », « pause » ou « arret ».")
    if corps["etat"] == "arret":
        return {"etat": "arret", "video": None, "temps": 0.0}
    video = corps.get("video")
    if not isinstance(video, str) or not VIDEO.match(video):
        raise Refus(400, "La musique : vidéo YouTube illisible.")
    temps = corps.get("temps", 0)
    if isinstance(temps, bool) or not isinstance(temps, (int, float)) or temps != temps or not 0 <= temps <= TEMPS_MAX:
        raise Refus(400, "La musique : position illisible.")
    return {"etat": corps["etat"], "video": video, "temps": round(float(temps), 1)}


def chemin(depot: Path) -> Path:
    return depot / DOSSIER / FICHIER


def ecrire(depot: Path, ecoute: dict) -> None:
    """Ce que joue le MJ, daté par l'atelier. Un arrêt efface le fichier."""
    c = chemin(depot)
    if ecoute["etat"] == "arret":
        c.unlink(missing_ok=True)
        return
    c.parent.mkdir(parents=True, exist_ok=True)
    stockage.ecrire_json_compact(c, {**ecoute, "depuis": maintenant()})


def effacer(depot: Path) -> bool:
    c = chemin(depot)
    if not c.exists():
        return False
    c.unlink(missing_ok=True)
    return True


def lire(depot: Path, instant: datetime | None = None) -> dict:
    """Ce que le coin doit jouer à cet instant : {etat, video, position}. Rien de lisible, ou trop vieux : l'arrêt."""
    arret = {"etat": "arret", "video": None, "position": 0.0}
    c = chemin(depot)
    try:
        if c.stat().st_size > OCTETS_MAX:
            return arret
        e = stockage.lire_json(c)
        propre = valider(e)
        depuis = datetime.fromisoformat(e.get("depuis"))
    except (OSError, ValueError, TypeError, Refus):
        return arret
    age = max(0.0, ((instant or datetime.now()) - depuis).total_seconds())
    if propre["etat"] == "arret" or age > VIEILLE:
        return arret
    position = propre["temps"] + (age if propre["etat"] == "joue" else 0.0)
    return {"etat": propre["etat"], "video": propre["video"], "position": round(position, 1)}
