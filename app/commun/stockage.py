"""L'écriture et la lecture des fichiers de données, au même endroit pour tout le serveur.

Une écriture est atomique : le contenu va dans un fichier temporaire voisin (`.nom.xxxx.tmp`, propre à chaque appel, de
sorte que deux écritures simultanées ne se marchent pas dessus), puis prend la place du fichier d'un seul coup. Un lecteur
voit donc l'ancien contenu entier ou le nouveau, jamais un fichier à moitié écrit. `mode` fixe les droits du fichier avant
qu'il prenne sa place. Le verrou de dossier sert aux dossiers que l'atelier et le coin des joueurs écrivent tous les deux
(deux processus : un verrou de fil ne suffit pas).
"""

import fcntl
import json
import os
import secrets
from contextlib import contextmanager
from pathlib import Path

COMPACT = {"ensure_ascii": False, "separators": (",", ":")}


def _temporaire(chemin: Path) -> Path:
    return chemin.with_name(f".{chemin.name}.{secrets.token_hex(4)}.tmp")


def ecrire_par(chemin: Path, ecrire, mode: int | None = None) -> None:
    """`ecrire(tmp)` remplit le fichier temporaire de la façon qu'il veut (une image, par exemple)."""
    tmp = _temporaire(chemin)
    try:
        ecrire(tmp)
        if mode is not None:
            tmp.chmod(mode)
        tmp.replace(chemin)
    finally:
        tmp.unlink(missing_ok=True)


def ecrire_texte(chemin: Path, texte: str, mode: int | None = None) -> None:
    ecrire_par(chemin, lambda tmp: tmp.write_text(texte, encoding="utf-8"), mode)


def ecrire_octets(chemin: Path, octets: bytes, mode: int | None = None) -> None:
    ecrire_par(chemin, lambda tmp: tmp.write_bytes(octets), mode)


def ecrire_json(chemin: Path, contenu, mode: int | None = None, **dumps) -> None:
    """Le JSON tel que `json.dumps(contenu, **dumps)` l'écrit : aucun réglage par défaut, pour garder les octets de chaque
    fichier tels qu'ils étaient."""
    ecrire_texte(chemin, json.dumps(contenu, **dumps), mode)


def ecrire_json_compact(chemin: Path, contenu, mode: int | None = None) -> None:
    """Le cas courant : compact, accents écrits tels quels."""
    ecrire_json(chemin, contenu, mode, **COMPACT)


def lire_json(chemin: Path):
    return json.loads(chemin.read_text(encoding="utf-8"))


@contextmanager
def verrou_de_dossier(dossier: Path, nom: str = ".verrou", mode_dossier: int | None = None, forcer_mode: bool = False):
    """Un verrou exclusif entre processus sur un fichier du dossier (créé au besoin, avec `mode_dossier` s'il est donné ;
    `forcer_mode` rétablit ces droits même sur un dossier qui existait déjà)."""
    if mode_dossier is None:
        dossier.mkdir(parents=True, exist_ok=True)
    else:
        dossier.mkdir(mode=mode_dossier, parents=True, exist_ok=True)
        if forcer_mode:
            os.chmod(dossier, mode_dossier)
    with open(dossier / nom, "a") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)
