"""Qui est au coin des joueurs en ce moment : un joueur dont une page du coin est ouverte, c'est-à-dire qui tient au
moins un flux poussé (flux_coin.py ; la page le referme quand elle passe en arrière-plan).

Le coin, seul écrivain, publie presence/coin.json dans le dossier des propositions, à l'ouverture et à la fermeture des
flux (regroupées), puis toutes les BATTEMENT secondes tant que quelqu'un est là. Rien d'autre que les identifiants des
joueurs et l'heure : {"maj": "2026-11-08T20:14:03", "joueurs": ["dario", "yuna"]}. L'atelier le lit (salle.py), ne
retient que les joueurs qu'il a invités, et ne croit plus un fichier qui n'a pas été tenu à jour depuis PERIME secondes
(le coin arrêté ne laisse pas croire que toute la tablée est là).

Ce module ne lit rien de l'atelier : le coin et l'atelier l'importent tous deux.
"""
from datetime import datetime
from pathlib import Path

from commun import demandes
from commun import stockage

DOSSIER = "presence"
FICHIER = "coin.json"
BATTEMENT = 15  # secondes : le coin republie tant que quelqu'un est là
PERIME = 45  # secondes : au-delà, l'atelier ne croit plus un fichier qui nomme quelqu'un
GRACE = 4  # secondes : un joueur qui ferme sa dernière page reste là un instant (une page rechargée, du carnet à la bible)
OCTETS_MAX = 8 * 1024
JOUEURS_MAX = 60


def chemin(depot: Path) -> Path:
    return depot / DOSSIER / FICHIER


def ecrire(depot: Path, joueurs) -> dict:
    """Écrit par le coin seul, d'un coup (l'atelier ne lit jamais un fichier à moitié écrit). Les identifiants sont ceux des
    sessions ouvertes : rangés, sans doublon, bornés."""
    ids = sorted({j for j in joueurs if isinstance(j, str) and demandes.ID_JOUEUR.match(j)})[:JOUEURS_MAX]
    contenu = {"maj": datetime.now().isoformat(timespec="seconds"), "joueurs": ids}
    cible = chemin(depot)
    cible.parent.mkdir(parents=True, exist_ok=True)
    stockage.ecrire_json(cible, contenu, mode=0o644, separators=(",", ":"))
    return contenu


def lire(depot: Path, instant: datetime | None = None) -> dict:
    """Pour l'atelier : {joueurs, maj, a_jour}. Un fichier absent, illisible, trop lourd ou d'une autre forme ne nomme
    personne. Trop vieux alors qu'il nomme quelqu'un (le coin s'est arrêté sans le dire) : personne, et a_jour faux.
    Trop vieux et vide, il dit vrai : le coin n'a rien à republier quand personne n'est là."""
    instant = instant or datetime.now()
    personne = {"joueurs": [], "maj": None, "a_jour": True}
    try:
        cible = chemin(depot)
        if cible.stat().st_size > OCTETS_MAX:
            return personne
        contenu = stockage.lire_json(cible)
    except (OSError, ValueError):
        return personne
    if not isinstance(contenu, dict) or set(contenu) != {"maj", "joueurs"} or not isinstance(contenu["joueurs"], list):
        return personne
    try:
        maj = datetime.fromisoformat(contenu["maj"]) if isinstance(contenu["maj"], str) else None
    except ValueError:
        maj = None
    if maj is None:
        return personne
    ids = sorted({j for j in contenu["joueurs"] if isinstance(j, str) and demandes.ID_JOUEUR.match(j)})[:JOUEURS_MAX]
    age = (instant - maj).total_seconds()
    if ids and not -60 < age < PERIME:
        return {"joueurs": [], "maj": contenu["maj"], "a_jour": False}
    return {"joueurs": ids, "maj": contenu["maj"], "a_jour": True}
