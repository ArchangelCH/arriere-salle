"""Les portraits des joueurs dans l'atelier : ce que l'atelier publie pour le coin (portraits.py) et ce que la
boîte du MJ fait des deux genres de demande.

- Publication : pour chaque joueur dont le héros est à la tablée, les portraits de ce héros (ses illustrations, sauf celles
  gardées secrètes) en miniatures, sous la clé de son lien, carnet ouvert ou fermé. Une tâche de fond guette les fiches et
  les joueurs, comme celle des fiches de jet.
- « portrait-choisi » s'applique seul : le nom reçu est retrouvé parmi les portraits de CE héros (jamais un autre fichier),
  la fiche prend ce portrait (sans changer sa version : l'écran du MJ ouvert dessus ne tombe pas en conflit), le choix est
  noté dans data/portraits-joueurs.json pour l'« Annuler » de la boîte.
- « portrait » attend le MJ, qui voit l'image dans sa boîte ; à l'acceptation, l'image est relue et revérifiée, copiée dans
  data/images, entre dans les illustrations de la fiche (source « joueur ») et devient le portrait. Un refus n'a rien à
  faire ici : le coin efface l'image à son heure.
- Après un choix, une annulation ou une acceptation : les portraits du joueur sont republiés tout de suite, puis la TV
  relit ce qu'elle montre (le carton du héros, la tablée, les fiches, le plan et ses pions).

Le MJ garde la main : « Choisir » dans la galerie de la fiche change le portrait quand il veut ; un portrait venu d'un
joueur y est marqué.

Ce module ne connaît de l'atelier que les fonctions que main.py lui passe.
"""
import asyncio
import hashlib
import logging
import secrets
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Awaitable, Callable

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from commun import carnet
from commun import demandes
from commun import portraits
from commun import veille
from commun.demandes import Refus
from commun import stockage

journal = logging.getLogger("atelier.portraits")

JOURNAL_MAX = 300  # choix notés pour l'« Annuler »
SOURCES_PERIODE = 1.0  # secondes entre deux regards sur les sources de la publication
NOMS_DUREE = 2.0  # secondes : les prénoms des héros de la boîte se relisent au plus aussi souvent


def maintenant() -> str:
    return datetime.now().isoformat(timespec="milliseconds")


def prenom(nom) -> str:
    return (str(nom or "").split() or ["son héros"])[0]


class PortraitsMJ:
    def __init__(self, depot: Path, donnees: Path, images: Path, *, joueurs_lus: Callable[[], list],
                 heros_des_joueurs: Callable[[], dict], chemin_heros: Callable[[str], Path], lire: Callable[[Path], dict],
                 ecrire: Callable[[Path, dict], None], verrou, media_existant: Callable[[str], bool],
                 url_publique: Callable[[dict], str | None], a_la_tv: Callable[[set], Awaitable[None]],
                 sources: Callable[[], list]):
        self.depot = depot
        self.fichier = donnees / "portraits-joueurs.json"
        self.images = images
        self.joueurs_lus = joueurs_lus
        self.heros_des_joueurs = heros_des_joueurs
        self.chemin_heros = chemin_heros
        self.lire = lire
        self.ecrire = ecrire
        self.verrou = verrou  # celui des écritures de fiches d'aventurier (SAC_VERROU de main.py)
        self.media_existant = media_existant
        self.url_publique = url_publique
        self.a_la_tv = a_la_tv
        self.sources = sources
        self.vu = None
        self.touches: dict[str, str] = {}  # demande → héros touché, pour la TV ensuite
        self.verrou_journal = threading.Lock()
        self.noms = (0.0, {})

    def brancher(self, boite) -> None:
        self.boite = boite
        boite.brancher(portraits.GENRE_CHOIX, appliquer=self.appliquer_choix, annuler=self.annuler_choix, apres=self.apres,
                       dire=self.dire)
        boite.brancher(portraits.GENRE_ENVOI, accepter=self.accepter_envoi, apres=self.apres, dire=self.dire)

    # ------------------------------------------------------------ ce que le coin lit

    @staticmethod
    def cle_de(j: dict) -> str | None:
        jeton = j.get("jeton") if isinstance(j, dict) else None
        return carnet.cle_heros(hashlib.sha256(jeton.encode()).hexdigest()) if isinstance(jeton, str) and jeton else None

    def source(self, url) -> Path | None:
        return self.images / url.split("/media/", 1)[1] if self.media_existant(url) else None

    def portraits_de(self, a: dict, cle: str, joueur: str) -> list:
        """Les portraits de ce héros que son joueur peut voir et choisir : ses illustrations, sauf celles gardées secrètes,
        dont l'image existe. [{nom, url, source, genre, de_vous}]."""
        vus, sortie = set(), []
        for i in a.get("illustrations") or []:
            url = i.get("url") if isinstance(i, dict) else None
            if not isinstance(url, str) or i.get("secrete") or url in vus:
                continue
            source = self.source(url)
            nom = portraits.nom_publie(cle, source) if source else None
            if not nom:
                continue
            vus.add(url)
            joueur_de = i.get("source") == "joueur"
            sortie.append({"nom": nom, "url": url, "source": source, "genre": "joueur" if joueur_de else "mj",
                           "de_vous": joueur_de and i.get("joueur") == joueur})
        return sortie[:portraits.PORTRAITS_MAX]

    def publier(self) -> int:
        """Les portraits de chaque joueur dont le héros est à la tablée, sous la clé de son lien ; les autres dossiers s'en
        vont. Rend le nombre de fichiers écrits ou retirés."""
        heros = self.heros_des_joueurs()
        par_cle = {}
        for j in self.joueurs_lus():
            a = heros.get(j.get("id")) if isinstance(j, dict) else None
            cle = self.cle_de(j)
            if not a or not cle:
                continue
            liste = self.portraits_de(a, cle, j["id"])
            actuel = self.url_publique(a)
            par_cle[cle] = {"portraits": liste, "actuel": next((p["nom"] for p in liste if p["url"] == actuel), None)}
        return portraits.publier(self.depot, par_cle)

    async def veiller(self) -> None:
        """La tâche de fond du cycle : un regard par seconde sur les dates des sources (les fiches, les joueurs, leurs héros
        accueillis) ; si l'une a changé, les portraits se republient."""
        while True:
            try:
                empreinte = await asyncio.to_thread(lambda: veille.empreinte(self.sources()))
                if empreinte != self.vu:
                    await asyncio.to_thread(self.publier)
                    self.vu = empreinte
            except asyncio.CancelledError:
                raise
            except Exception:
                journal.exception("Portraits des joueurs non publiés")
                self.vu = None
            await asyncio.sleep(SOURCES_PERIODE)

    # ------------------------------------------------------------ le journal des choix (l'« Annuler »)

    def journal_lire(self) -> dict:
        try:
            v = stockage.lire_json(self.fichier)
        except (OSError, ValueError):
            return {}
        return v if isinstance(v, dict) else {}

    def noter(self, cle: str, entree: dict) -> None:
        with self.verrou_journal:
            notes = self.journal_lire()
            notes[cle] = entree
            if len(notes) > JOURNAL_MAX:
                notes = dict(sorted(notes.items(), key=lambda kv: str((kv[1] or {}).get("le") or ""))[-JOURNAL_MAX:])
            self.fichier.parent.mkdir(parents=True, exist_ok=True)
            stockage.ecrire_json_compact(self.fichier, notes)

    # ------------------------------------------------------------ les gestes (sous le verrou de la file)

    def heros_de(self, j: dict, mj: bool = False) -> dict:
        a = self.heros_des_joueurs().get(j["id"])
        if not a:
            raise Refus(409, "Le héros de ce joueur n'est plus à la tablée : refusez cette image." if mj
                        else "Votre héros n'est plus à la tablée : votre MJ s'en occupera.")
        return a

    def changer(self, ident: str, url: str, attendu: str | None = None, ajout: dict | None = None) -> dict:
        """Le portrait de la fiche devient url (ajout : une illustration à ajouter d'abord). attendu : le portrait que la
        fiche doit avoir encore (l'« Annuler »). Sa version ne change pas, comme « Choisir » dans la galerie."""
        with self.verrou:
            try:
                chemin = self.chemin_heros(ident)
                fiche = self.lire(chemin)
            except HTTPException:
                raise Refus(409, "La fiche de ce héros est introuvable : votre MJ s'en occupera.")
            if attendu is not None and self.url_publique(fiche) != attendu:
                raise Refus(409, "Le portrait a changé depuis : rien à annuler.")
            if ajout:
                fiche.setdefault("illustrations", []).append(ajout)
            if url not in [i.get("url") for i in fiche.get("illustrations") or [] if isinstance(i, dict) and not i.get("secrete")]:
                raise Refus(409, "Ce portrait n'est plus dans la fiche de votre héros : la page se relit.")
            fiche["illustration"] = url
            self.ecrire(chemin, fiche)
            return fiche

    def appliquer_choix(self, j: dict, d: dict) -> str:
        a = self.heros_de(j)
        cle = self.cle_de(j)
        voulu = next((p for p in self.portraits_de(a, cle, j["id"]) if p["nom"] == d["corps"]["portrait"]), None) if cle else None
        if voulu is None:
            raise Refus(409, "Ce portrait n'est plus dans la fiche de votre héros : la page se relit.")
        avant = self.url_publique(a)
        if voulu["url"] == avant:
            raise Refus(409, "C'est déjà son portrait.")
        self.changer(a["id"], voulu["url"])
        self.noter(f"{j['id']}:{d['id']}", {"heros": a["id"], "avant": avant, "apres": voulu["url"], "le": maintenant()})
        self.touches[d["id"]] = a["id"]
        self.publier_vite()
        return f"C'est maintenant le portrait de {prenom(a.get('nom'))}, à la TV aussi."

    def annuler_choix(self, j: dict, d: dict) -> str:
        note = self.journal_lire().get(f"{j['id']}:{d['id']}")
        if not isinstance(note, dict) or not isinstance(note.get("heros"), str):
            raise Refus(409, "Ce changement n'a pas été noté : choisissez le portrait dans la fiche du héros.")
        if not note.get("avant"):
            raise Refus(409, "Son héros n'avait pas de portrait avant : choisissez-en un dans sa fiche.")
        self.changer(note["heros"], note["avant"], attendu=note.get("apres"))
        self.touches[d["id"]] = note["heros"]
        self.publier_vite()
        return "Votre MJ a remis le portrait d'avant."

    def accepter_envoi(self, j: dict, d: dict, _mot: str) -> str:
        a = self.heros_de(j, mj=True)
        chemin = portraits.chemin_envoi(self.depot, j["id"], d["corps"]["envoi"])
        try:
            octets = chemin.read_bytes() if chemin and chemin.stat().st_size <= portraits.OCTETS_MAX else b""
        except OSError:
            octets = b""
        if not octets:
            raise Refus(409, "Cette image n'est plus là : refusez cette demande.")
        # Venue du coin, elle est revérifiée et réécrite ici comme à l'envoi.
        propre = portraits.preparer_image(octets)
        nom = f"portrait-joueur-{secrets.token_hex(8)}.jpg"
        cible = self.images / nom
        stockage.ecrire_octets(cible, propre)
        url = f"/media/{nom}"
        try:
            self.changer(a["id"], url, ajout={"url": url, "source": "joueur", "joueur": j["id"], "joueur_nom": str(j.get("nom") or "")[:60],
                                              "prompt": "", "format": "portrait", "cree": maintenant()})
        except Exception:
            cible.unlink(missing_ok=True)
            raise
        # Noté aussi : la boîte remontre l'image acceptée, que le coin efface ensuite de son dossier.
        self.noter(f"{j['id']}:{d['id']}", {"heros": a["id"], "avant": None, "apres": url, "le": maintenant(), "accepte": True})
        self.touches[d["id"]] = a["id"]
        self.publier_vite()
        return f"Votre image est maintenant le portrait de {prenom(a.get('nom'))}, à la TV aussi."

    def publier_vite(self) -> None:
        """Tout de suite, avant même que le statut de la demande ne parte : quand le joueur lit « fait », son portrait est
        déjà là. Un raté sera repris par la tâche de fond."""
        try:
            self.publier()
        except Exception:
            journal.exception("Portraits des joueurs non republiés")

    async def apres(self, liste: list) -> None:
        ids = {self.touches.pop(d["id"]) for _, d in liste if d.get("id") in self.touches}
        if ids:
            await self.a_la_tv(ids)

    def nom_du_heros(self, joueur: str) -> str:
        """Le prénom du héros d'un joueur, pour les lignes de la boîte : relus au plus toutes les deux secondes (la boîte
        se redessine souvent, et chaque lecture parcourt toutes les fiches)."""
        instant = time.monotonic()
        if instant - self.noms[0] > NOMS_DUREE:
            self.noms = (instant, {ident: prenom(a.get("nom")) for ident, a in self.heros_des_joueurs().items()})
        return self.noms[1].get(joueur) or "son héros"

    def dire(self, j: dict, d: dict) -> str:
        nom = self.nom_du_heros(j["id"])
        if d["genre"] == portraits.GENRE_CHOIX:
            return f"{j.get('nom', '')} a choisi un autre portrait pour {nom}."
        return f"{j.get('nom', '')} propose sa propre image comme portrait de {nom}."

    # ------------------------------------------------------------ l'image, pour la boîte du MJ

    def image(self, joueur: str, ident: str) -> Path:
        """L'image d'une demande de portrait : celle que le joueur a envoyée (tant que le coin la garde, puis la copie
        acceptée), ou le portrait qu'il a choisi."""
        j = self.boite.joueur(joueur)
        d = demandes.trouver(demandes.lire(self.depot, joueur), ident)
        if d is None or d.get("genre") not in portraits.GENRES or not isinstance(d.get("corps"), dict):
            raise Refus(404, "Introuvable")
        note = self.journal_lire().get(f"{joueur}:{ident}")
        dans_l_atelier = self.source(note.get("apres")) if isinstance(note, dict) else None
        if d["genre"] == portraits.GENRE_ENVOI:
            chemin = portraits.chemin_envoi(self.depot, joueur, d["corps"].get("envoi"))
            if (chemin is None or not chemin.is_file()) and dans_l_atelier:
                chemin = dans_l_atelier
        elif dans_l_atelier:
            chemin = dans_l_atelier
        else:
            cle = self.cle_de(j)
            nom = d["corps"].get("portrait")
            chemin = portraits.dossier_publie(self.depot, cle) / nom if cle and isinstance(nom, str) and portraits.NOM.match(nom) else None
        if chemin is None or not chemin.is_file():
            raise Refus(404, "Cette image n'est plus là.")
        return chemin

    def routes(self) -> APIRouter:
        """Hors de /api/table/… : la garde de main.py les ferme à la table publique, et à Internet sans session."""
        r = APIRouter()

        @r.get("/api/portraits-joueurs/{joueur}/{ident}/image")
        def image_de_la_demande(joueur: str, ident: str):
            try:
                chemin = self.image(joueur, ident)
            except Refus as refus:
                raise HTTPException(refus.statut, refus.message)
            return FileResponse(chemin, media_type="image/jpeg", headers={"Cache-Control": "private, no-store"})

        return r
