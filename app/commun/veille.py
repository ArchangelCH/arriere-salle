"""Surveiller un dossier : l'atelier, celui des demandes des joueurs ; le coin des joueurs, ses propres fichiers (le
seul canal entre les deux services est le dossier des propositions).

veiller() appelle rappel() à chaque vague de changements (watchfiles, regroupés sur quelques centaines de
millisecondes) et, de secours, toutes les `secours` secondes même sans rien voir : un changement manqué (une
notification perdue, un montage qui n'en donne pas) se rattrape. Le rappel compare lui-même ce qu'il relit à ce qu'il
connaît, et n'agit que si quelque chose a vraiment changé : ses propres écritures ne le relancent pas sans fin.
"""
import asyncio
import logging
from pathlib import Path
from typing import Awaitable, Callable

from watchfiles import awatch

journal = logging.getLogger("atelier.veille")


def empreinte(chemins) -> dict:
    """{chemin: (inode, taille, date)} des fichiers qui existent : une écriture atomique change l'inode, une autre la date."""
    vus = {}
    for f in chemins:
        try:
            st = f.stat()
        except OSError:
            continue
        vus[str(f)] = (st.st_ino, st.st_size, st.st_mtime_ns)
    return vus


async def veiller(dossier: Path, garder: Callable[[Path], bool], rappel: Callable[[], Awaitable[None]], *,
                  regroupement: int = 300, secours: float = 30.0, nom: str = "veille") -> None:
    """Tourne jusqu'à être annulée. garder(chemin) : ce changement compte-t-il ? (les fichiers temporaires, jamais)."""
    reveil = asyncio.Event()

    def filtre(_changement, chemin: str) -> bool:
        # Les fichiers temporaires d'une écriture atomique (.x.json.ab12.tmp) ne comptent pas : seul le nom final compte.
        p = Path(chemin)
        if p.suffix != ".json":
            return False
        return not p.name.startswith(".") or p.name == ".pause.json"

    async def guetter():
        polling = False
        while True:
            try:
                async for vague in awatch(dossier, watch_filter=lambda c, ch: filtre(c, ch) and garder(Path(ch)),
                                          debounce=regroupement, step=50, force_polling=polling or None,
                                          poll_delay_ms=1000, recursive=True, ignore_permission_denied=True):
                    if vague:
                        reveil.set()
            except asyncio.CancelledError:
                raise
            except Exception as err:
                # Plus de notifications du système (limite inotify atteinte, dossier remonté) : on passe à la lecture
                # régulière des dates, une seconde sur deux, plutôt que de tout attendre de la relecture de secours.
                if not polling:
                    journal.warning("%s : surveillance par notifications impossible (%s), lecture régulière à la place", nom, type(err).__name__)
                polling = True
                await asyncio.sleep(2)

    guet = asyncio.create_task(guetter())
    erreur = ""
    try:
        while True:
            try:
                await asyncio.wait_for(reveil.wait(), timeout=secours)
            except asyncio.TimeoutError:
                pass
            reveil.clear()
            try:
                await rappel()
                erreur = ""
            except asyncio.CancelledError:
                raise
            except Exception as err:
                # La même erreur n'est notée qu'une fois : la relecture suivante réessaie.
                if repr(err) != erreur:
                    erreur = repr(err)
                    journal.exception("%s : passage impossible", nom)
    finally:
        guet.cancel()
        try:
            await guet
        except (asyncio.CancelledError, Exception):
            pass
