"""Les pointeurs, vus de l'atelier (lot du 13/11) : le pointeur du MJ et sa règle partent vers le coin des joueurs, et le
pointeur d'un joueur arrive sur le plan ou la carte du MJ, à la couleur de son héros. Les fichiers et leurs règles sont
dans commun/pointeurs.py.

  - VersLeCoin : ce que l'éditeur envoie par /ws/pointeur (api/tv_temps_reel.py) s'écrit aussi pour le coin, table du coin
    ouverte et TV sur ce plan ou cette carte seulement. Au plus une écriture toutes les INTERVALLE secondes, la dernière
    position part toujours ; effacer écrit tout de suite. Le coin lit ce fichier à chaque nouvelle du flux.
  - PointeursJoueurs : une tâche de fond guette les fichiers que le coin écrit, et pousse la liste des pointeurs vivants
    vers les pages de l'atelier (message « pointeurs-joueurs » de /ws/atelier), jamais vers la TV : elle nomme les joueurs.
    Un pointeur qui ne vise pas ce que montre la TV en ce moment n'est pas transmis.
"""
import asyncio
import hashlib
import json
import logging
import time
from pathlib import Path
from typing import Awaitable, Callable

from commun import pointeurs
from commun import veille

journal = logging.getLogger("atelier.pointeurs")

INTERVALLE = 0.15  # secondes entre deux écritures du pointeur du MJ : environ 6 par seconde vers le coin
REGROUPEMENT = 40  # millisecondes : le pointeur d'un joueur paraît chez le MJ en un clin d'œil
SECOURS = 2  # secondes : un pointeur qui s'éteint sans rien écrire (le joueur a fermé sa page)


class VersLeCoin:
    def __init__(self, depot: Path, *, table_ouverte: Callable[[], bool]):
        self.depot = depot
        self.table_ouverte = table_ouverte
        self.point: dict | None = None
        self.regle: dict | None = None
        self.de_point = self.de_regle = None
        self.onde = 0
        self.dernier = 0.0
        self.tache: asyncio.Task | None = None

    def ecrire(self) -> None:
        pointeurs.ecrire_mj(self.depot, self.point, self.regle)

    async def pousser(self, tout_de_suite: bool = False) -> None:
        reste = self.dernier + INTERVALLE - time.monotonic()
        if reste > 0 and not tout_de_suite:
            if self.tache is None or self.tache.done():
                self.tache = asyncio.create_task(self.plus_tard(reste))
            return
        if self.tache is not None and not self.tache.done() and self.tache is not asyncio.current_task():
            self.tache.cancel()
        self.dernier = time.monotonic()
        try:
            await asyncio.to_thread(self.ecrire)
        except OSError:
            journal.warning("Pointeur du MJ non publié pour le coin")

    async def plus_tard(self, attente: float) -> None:
        await asyncio.sleep(attente)
        await self.pousser(True)

    async def pointe(self, de: int, genre: str, jeton: str, x: float, y: float, onde: bool) -> None:
        if not self.table_ouverte():
            return
        maintenant = pointeurs.maintenant()
        if onde:
            self.onde += 1
        avant = self.point or {}
        self.de_point = de
        self.point = {genre: jeton, "x": x, "y": y, "vu": maintenant, "onde": self.onde,
                      "onde_vue": maintenant if onde else avant.get("onde_vue")}
        await self.pousser(bool(onde))

    async def mesure(self, de: int, genre: str, jeton: str, a: list, b: list, texte: str) -> None:
        if not self.table_ouverte():
            return
        regle = pointeurs.regle_valide({genre: jeton, "a": a, "b": b, "texte": texte})
        if regle is None:
            return
        self.de_regle = de
        self.regle = regle
        await self.pousser()

    async def efface_point(self, de: int) -> None:
        if self.de_point != de or self.point is None:
            return
        self.point = None
        await self.pousser(True)

    async def efface_regle(self, de: int) -> None:
        if self.de_regle != de or self.regle is None:
            return
        self.regle = None
        await self.pousser(True)

    async def efface(self, de: int) -> None:
        """Tout ce que cette liaison montrait (elle se ferme, l'éditeur s'en va)."""
        if self.de_point == de and self.point is not None:
            self.point = None
        if self.de_regle == de and self.regle is not None:
            self.regle = None
        if self.point is None and self.regle is None:
            await self.pousser(True)


class PointeursJoueurs:
    def __init__(self, depot: Path, *, joueurs_lus: Callable[[], list], heros_des_joueurs: Callable[[], dict],
                 couleurs: Callable[[], dict], resoudre: Callable[[str, str], str | None],
                 signaler: Callable[[dict], Awaitable[None]]):
        self.depot = depot
        self.joueurs_lus = joueurs_lus
        self.heros_des_joueurs = heros_des_joueurs  # {joueur : fiche de son héros}
        self.couleurs = couleurs  # {aventurier : couleur à la TV}
        self.resoudre = resoudre  # (genre, jeton) -> identifiant du plan ou de la carte que la TV montre, sinon None
        self.signaler = signaler
        self.signature = None

    def vue(self) -> list:
        noms = {j["id"]: str(j.get("nom") or "") for j in self.joueurs_lus() if isinstance(j, dict) and isinstance(j.get("id"), str)}
        vivants = [p for p in pointeurs.lire_joueurs(self.depot) if p["joueur"] in noms]
        if not vivants:
            return []
        heros, couleurs = self.heros_des_joueurs(), self.couleurs()
        sortie = []
        for p in vivants:
            genre = "plan" if "plan" in p else "carte"
            ident = self.resoudre(genre, p[genre])
            if ident is None:
                continue
            h = heros.get(p["joueur"]) or {}
            sortie.append({"joueur": p["joueur"], "nom": noms[p["joueur"]] or str(h.get("nom") or ""), "couleur": couleurs.get(h.get("id")) or h.get("couleur") or "#e0b562",
                           "genre": genre, "id": ident, "x": p["x"], "y": p["y"], "onde": p["onde"], "onde_age": p["onde_age"]})
        return sortie

    @staticmethod
    def empreinte(liste: list) -> str:
        utile = [[p["joueur"], p["genre"], p["id"], p["x"], p["y"], p["onde"], p["couleur"]] for p in liste]
        return hashlib.sha256(json.dumps(utile, sort_keys=True).encode()).hexdigest()[:20]

    async def annoncer(self) -> None:
        liste = await asyncio.to_thread(self.vue)
        signature = self.empreinte(liste)
        if signature != self.signature:
            self.signature = signature
            try:
                await self.signaler({"type": "pointeurs-joueurs", "pointeurs": liste})
            except Exception:
                journal.exception("Pages de l'atelier non prévenues (pointeurs des joueurs)")

    def garder(self, chemin: Path) -> bool:
        try:
            parties = chemin.relative_to(self.depot).parts
        except ValueError:
            return False
        return len(parties) == 3 and parties[0] == pointeurs.DOSSIER and parties[1] == pointeurs.JOUEURS and parties[2].endswith(".json")

    async def veiller(self) -> None:
        """La tâche de fond du cycle de l'atelier."""
        await veille.veiller(self.depot, self.garder, self.annoncer, regroupement=REGROUPEMENT, secours=SECOURS,
                             nom="Pointeurs des joueurs")
