"""La salle, vue de l'atelier : les mains levées par les joueurs (main_levee.py) et qui est au coin en ce moment
(presence.py), pour le Tableau, la télécommande et l'en-tête de l'atelier.

Une tâche de fond (surveiller, lancée dans le cycle de main.py) guette les demandes des joueurs et le fichier de présence
que publie le coin. À chaque changement, et de secours toutes les SECOURS secondes (une main qui retombe, un coin qui se
tait), elle refait la vue ; si elle a changé, les pages de l'atelier la reçoivent aussitôt par leur canal (/ws/atelier,
message {"type": "salle", ...}), sans relire. Ni la TV, ni la table publique, ni le coin ne la reçoivent : elle nomme les
joueurs et leurs héros.

Les gestes du MJ (« Donner la parole », « Plus tard ») passent par la file, avec la version lue : le Mac, l'iPad et la
télécommande ne traitent pas deux fois la même main, et une main baissée entre-temps par le joueur ne se rend pas.
"""
import asyncio
import hashlib
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Awaitable, Callable

from fastapi import APIRouter, HTTPException, Request

from commun import demandes
from commun import main_levee
from commun import presence
from commun import veille

journal = logging.getLogger("atelier.salle")

REGROUPEMENT = 80  # millisecondes : la main d'un joueur paraît chez le MJ en moins d'une seconde
SECOURS = 5  # secondes : une main retombe, un coin se tait, un héros relié à son joueur
GESTES = {"parole": demandes.ACCEPTEE, "plus-tard": demandes.REFUSEE}


class Salle:
    def __init__(self, depot: Path, *, joueurs_lus: Callable[[], list], heros_lus: Callable[[], dict],
                 signaler: Callable[[dict], Awaitable[None]]):
        self.depot = depot
        self.joueurs_lus = joueurs_lus
        # {id du joueur : {"id", "nom"} de son héros à la tablée} (liens_joueurs.py, lu par main.py)
        self.heros_lus = heros_lus
        self.signaler = signaler
        self.signature = None
        self.passages = 0

    def joueurs(self) -> dict:
        return {j["id"]: j for j in self.joueurs_lus()
                if isinstance(j, dict) and isinstance(j.get("id"), str) and demandes.ID_JOUEUR.match(j["id"])}

    def vue(self) -> dict:
        """Les mains levées, dans l'ordre où elles se sont levées, et les joueurs en ligne, avec le prénom et le héros de
        chacun. « reste » : les secondes avant qu'une main retombe, comptées au moment de la vue (la page compte ensuite
        avec sa propre horloge)."""
        instant = datetime.now()
        js = self.joueurs()
        levees = main_levee.levees(self.depot, list(js), instant)
        p = presence.lire(self.depot, instant)
        en_ligne = [j for j in p["joueurs"] if j in js]
        heros = {}
        if levees or en_ligne:
            try:
                heros = self.heros_lus()
            except Exception:
                journal.exception("Héros des joueurs illisibles")
        qui = lambda j: {"joueur": j, "nom": str(js[j].get("nom") or ""), "heros": heros.get(j)}  # noqa: E731
        return {"mains": [qui(m["joueur"]) | {"id": m["id"], "version": m["version"], "cree": m["cree"], "reste": m["reste"], "rang": i + 1}
                          for i, m in enumerate(levees)],
                "en_ligne": [qui(j) for j in en_ligne],
                "presence": {"a_jour": p["a_jour"], "maj": p["maj"]},
                "invites": len(js), "duree": main_levee.DUREE}

    @staticmethod
    def empreinte(v: dict) -> str:
        """Ce qui compte pour dire que la vue a changé : pas les secondes qui restent, qui changent sans cesse."""
        utile = [[{k: m[k] for k in ("joueur", "nom", "heros", "id", "version")} for m in v["mains"]], v["en_ligne"],
                 v["presence"]["a_jour"], v["invites"]]
        return hashlib.sha256(json.dumps(utile, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()[:20]

    def vue_signee(self) -> dict:
        v = self.vue()
        return v | {"signature": self.empreinte(v)}

    async def annoncer(self, v: dict | None = None) -> dict:
        """Refait la vue et la pousse vers les pages de l'atelier si elle a changé."""
        v = v or await asyncio.to_thread(self.vue_signee)
        if v["signature"] != self.signature:
            self.signature = v["signature"]
            try:
                await self.signaler({"type": "salle", **v})
            except Exception:
                journal.exception("Pages de l'atelier non prévenues (salle)")
        return v

    async def passage(self) -> None:
        self.passages += 1
        await self.annoncer()

    def garder(self, chemin: Path) -> bool:
        try:
            parties = chemin.relative_to(self.depot).parts
        except ValueError:
            return False
        if len(parties) != 2 or parties[1].startswith("."):
            return False
        return parties[0] == demandes.DOSSIER or parties == (presence.DOSSIER, presence.FICHIER)

    async def surveiller(self) -> None:
        """La tâche de fond du cycle de l'atelier."""
        self.signature = None
        try:
            await self.passage()
        except Exception:
            journal.exception("Salle : premier passage impossible")
        await veille.veiller(self.depot, self.garder, self.passage, regroupement=REGROUPEMENT, secours=SECOURS,
                             nom="Mains levées et présence")

    # ------------------------------------------------------------ les gestes du MJ

    def trancher(self, joueur: str, ident: str, geste: str, version) -> dict:
        """« Donner la parole » ou « Plus tard », sous le verrou, avec la version lue par l'écran du MJ."""
        if geste not in GESTES:
            raise demandes.Refus(400, "Geste attendu : « parole » ou « plus-tard ».")
        if isinstance(version, bool) or not isinstance(version, int):
            raise demandes.Refus(400, "La version de la main manque : relisez le Tableau.")
        if joueur not in self.joueurs():
            raise demandes.Refus(404, "Joueur inconnu.")
        with demandes.verrou(self.depot):
            liste = demandes.lire(self.depot, joueur)
            d = demandes.trouver(liste, ident)
            if d is None or d["genre"] != main_levee.GENRE:
                raise demandes.Refus(404, "Cette main n'est plus levée.")
            if d["statut"] == demandes.RETIREE:
                raise demandes.Refus(409, "Le joueur a baissé sa main entre-temps.")
            demandes.passer(d, GESTES[geste], "mj", version=version)
            demandes.ecrire(self.depot, joueur, liste)
        return d

    # ------------------------------------------------------------ les routes

    def routes(self, corps_objet) -> APIRouter:
        """Hors de /api/table/… : la garde de main.py les ferme à la table publique, et à Internet sans session."""
        r = APIRouter()

        @r.get("/api/salle")
        async def la_salle():
            return await asyncio.to_thread(self.vue_signee)

        @r.post("/api/salle/mains/{joueur}/{ident}")
        async def repondre_a_une_main(joueur: str, ident: str, requete: Request):
            corps = await corps_objet(requete)
            try:
                await asyncio.to_thread(self.trancher, joueur, ident, corps.get("geste"), corps.get("version"))
            except demandes.Refus as refus:
                raise HTTPException(refus.statut, refus.message)
            # La vue part tout de suite vers les autres écrans du MJ (l'iPad, la télécommande), et revient à celui-ci.
            return await self.annoncer()

        return r
