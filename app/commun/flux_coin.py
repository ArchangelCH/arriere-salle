"""Le flux poussé du coin des joueurs : la page d'un joueur apprend qu'il y a du nouveau pour lui (le MJ a lu son mot,
une commande est vendue, le carnet a changé, le coin passe en pause) sans relire toutes les dix secondes.

Des événements envoyés par le serveur (SSE, GET /api/flux) plutôt qu'un WebSocket : une requête HTTP ordinaire, qui
reste sous la Garde du coin (hôte, en-têtes, Cache-Control). Un événement ne porte qu'un sujet (« demandes »,
« commandes », « carnet », « pause », « table », « prives », « jets-table », « pointeur », « musique »), jamais de contenu : la page relit par ses routes habituelles, qui
vérifient la session comme toujours. La session est revérifiée à chaque battement (environ 25 secondes) ; 3 flux par
joueur et 30 en tout.

Le coin n'a pas de réseau vers l'atelier : il apprend les changements en guettant ses propres fichiers dans le dossier
des propositions (veille.py), ceux que l'atelier y écrit.

Les flux ouverts disent aussi qui est au coin en ce moment (presence.py) : le coin publie leur liste pour l'atelier, à
chaque ouverture et fermeture, regroupées, puis de temps en temps tant que quelqu'un est là.
"""
import asyncio
import logging
import signal
import threading
import time
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

from commun import carnet
from commun import confie
from commun import demandes
from commun import jets_distance
from commun import musique_coin
from commun import pointeurs
from commun import portraits
from commun import presence
from commun import prives
from commun import table_joueurs
from commun import veille

journal = logging.getLogger("coin.flux")

SUJETS = ("demandes", "commandes", "carnet", "pause", "table", "prives", "jets", "portraits", "jets-table", "pointeur", "musique")
BATTEMENT = 25  # secondes : un commentaire pour tenir la liaison, et la session revérifiée
DUREE_MAX = 30 * 60  # un flux se referme au bout d'une demi-heure ; le navigateur le rouvre seul
PAR_JOUEUR = 3
EN_TOUT = 30
RELANCE_MS = 4000  # « retry » : le délai avant que le navigateur se reconnecte
SECOURS = 5  # secondes : relecture des dates de secours, si une notification du système s'est perdue
REGROUPEMENT_PRESENCE = 0.3  # secondes : des pages qui s'ouvrent ensemble ne publient qu'une fois


def origine_refusee(entetes) -> bool:
    """Un flux ne s'ouvre que depuis les pages du coin : ni une autre origine, ni un sous-domaine frère (il passe la
    barrière SameSite=Lax du cookie)."""
    site = entetes.get("sec-fetch-site")
    origine = entetes.get("origin")
    if site is not None and site != "same-origin":
        return True
    return origine is not None and urlsplit(origine).netloc.lower() != entetes.get("host", "").lower()


def sujet_du_fichier(relatif: tuple) -> tuple[str | None, str] | None:
    """(joueur ou None pour tous, sujet) d'un fichier du dossier des propositions qui a changé."""
    if len(relatif) == 2 and relatif[0] == demandes.DOSSIER:
        if relatif[1] == demandes.PAUSE:
            return None, "pause"
        ident = relatif[1][:-5]
        return (ident, "demandes") if demandes.ID_JOUEUR.match(ident) else None
    if len(relatif) == 2 and relatif[0] == carnet.COMMANDES:
        ident = relatif[1][:-5]
        return (ident, "commandes") if demandes.ID_JOUEUR.match(ident) else None
    # Le reçu de ce qu'un joueur a confié au MJ (confie.py) : lu ou non ; lui seul l'apprend, comme une demande.
    if len(relatif) == 2 and relatif[0] == confie.LUS:
        ident = relatif[1][:-5]
        return (ident, "demandes") if demandes.ID_JOUEUR.match(ident) else None
    if relatif and relatif[0] == carnet.CARNET and carnet.MEDIA not in relatif:
        return None, "carnet"
    # Les bandeaux des jets de la tablée (table/jets.json, lot du 12/11) : un sujet à part, léger ; la page Table ne relit
    # que les derniers jets, pas le plan.
    if relatif == (table_joueurs.DOSSIER, table_joueurs.JETS):
        return None, "jets-table"
    # Le pointeur et la règle du MJ (pointeurs.py, lot du 13/11) : un sujet à part, très léger, hors de table/ (chaque fichier
    # de table/ fait relire toute la table). Les pointeurs des joueurs, eux, ne vont qu'à l'atelier.
    if relatif == (pointeurs.DOSSIER, pointeurs.MJ):
        return None, "pointeur"
    # La musique du MJ (musique_coin.py, 19/11) : un sujet à part, hors de table/.
    if relatif == (musique_coin.DOSSIER, musique_coin.FICHIER):
        return None, "musique"
    # La table (table_joueurs.py) : la vue, ou le pion d'un joueur ; chaque page relit le sien.
    if relatif and relatif[0] == table_joueurs.DOSSIER and table_joueurs.MEDIA not in relatif:
        return None, "table"
    # Les billets privés (prives.py) : le fichier d'un joueur porte la clé de son lien, que Flux.relire rapporte à son
    # joueur ; ses lectures, notées depuis un appareil, se disent à ses autres appareils. Personne d'autre ne l'apprend.
    if len(relatif) == 2 and relatif[0] == prives.DOSSIER and prives.CLE.match(relatif[1][:-5]):
        return f"cle:{relatif[1][:-5]}", "prives"
    if len(relatif) == 2 and relatif[0] == prives.LUS:
        ident = relatif[1][:-5]
        return (ident, "prives") if demandes.ID_JOUEUR.match(ident) else None
    # La fiche de jet d'un héros (jets_distance.py) : chaque page relit la sienne.
    if len(relatif) == 2 and relatif[0] == jets_distance.DOSSIER:
        return None, "jets"
    # Les portraits d'un héros (portraits.py, lot P), sous la clé du lien de son joueur : lui seul l'apprend.
    if len(relatif) == 3 and relatif[0] == portraits.DOSSIER and portraits.CLE.match(relatif[1]) and relatif[2] == portraits.INDEX:
        return f"cle:{relatif[1]}", "portraits"
    return None


class Flux:
    def __init__(self, depot: Callable[[], Path]):
        # Le dossier, lu à chaque fois : les essais le remplacent.
        self.depot = depot
        self.abonnes: dict[str, set[asyncio.Queue]] = {}
        self.tache: asyncio.Task | None = None
        self.boucle = None
        self.connu: dict | None = None
        self.arret_branche = False
        # La présence (presence.py) : qui a fermé sa dernière page, et quand (le délai de grâce) ; la tâche qui publie.
        self.partis: dict[str, float] = {}
        self.reveil_presence: asyncio.Event | None = None
        self.tache_presence: asyncio.Task | None = None
        # {clé du lien : joueur}, posé par joueurs.py : un billet privé ne se dit qu'au joueur dont il porte la clé.
        self.joueurs_des_cles: Callable[[], dict] = dict

    # ------------------------------------------------------------ les places

    def nombre(self, joueur: str | None = None) -> int:
        if joueur is not None:
            return len(self.abonnes.get(joueur, ()))
        return sum(len(x) for x in self.abonnes.values())

    def ouvrir(self, joueur: str) -> asyncio.Queue:
        """Une place, prise sans rien attendre entre le compte et l'ajout : des flux ouverts au même instant ne passent
        pas la limite."""
        if self.nombre(joueur) >= PAR_JOUEUR:
            raise demandes.Refus(429, f"Déjà {PAR_JOUEUR} pages ouvertes : fermez-en une.")
        if self.nombre() >= EN_TOUT:
            raise demandes.Refus(429, "Trop de pages ouvertes en ce moment : réessayez dans un instant.")
        q: asyncio.Queue = asyncio.Queue(maxsize=8)
        self.abonnes.setdefault(joueur, set()).add(q)
        self.partis.pop(joueur, None)
        self.presence_changee()
        return q

    def fermer(self, joueur: str, q: asyncio.Queue) -> None:
        places = self.abonnes.get(joueur)
        if places is not None:
            places.discard(q)
            if not places:
                self.abonnes.pop(joueur, None)
                self.partis[joueur] = time.monotonic()
                self.presence_changee()

    def pousser(self, joueur: str | None, sujet) -> None:
        """Un sujet vers les flux d'un joueur (ou de tous). Une file pleine (une page qui ne lit plus) le perd : la page
        relira tout à son retour."""
        cibles = [q for j, places in self.abonnes.items() if joueur is None or j == joueur for q in places]
        for q in cibles:
            try:
                q.put_nowait(sujet)
            except asyncio.QueueFull:
                pass

    # ------------------------------------------------------------ guetter les fichiers

    def fichiers(self) -> list:
        d = self.depot()
        return [*(d / demandes.DOSSIER).glob("*.json"), d / demandes.DOSSIER / demandes.PAUSE, *(d / carnet.COMMANDES).glob("*.json"),
                *(d / carnet.CARNET).glob("*.json"), *(d / carnet.CARNET / carnet.HEROS).glob("*.json"),
                *(d / table_joueurs.DOSSIER).glob("*.json"), *(d / table_joueurs.DOSSIER / table_joueurs.PIONS).glob("*.json"),
                *(d / prives.DOSSIER).glob("*.json"), *(d / prives.LUS).glob("*.json"),
                *(d / jets_distance.DOSSIER).glob("*.json"), *(d / portraits.DOSSIER).glob(f"*/{portraits.INDEX}"),
                *(d / confie.LUS).glob("*.json"), d / pointeurs.DOSSIER / pointeurs.MJ, d / musique_coin.DOSSIER / musique_coin.FICHIER]

    def garder(self, chemin: Path) -> bool:
        try:
            relatif = chemin.relative_to(self.depot()).parts
        except ValueError:
            return False
        return sujet_du_fichier(relatif) is not None

    async def relire(self) -> None:
        """Ce qui a changé depuis la dernière fois, en sujets : chaque joueur n'apprend que ce qui le regarde."""
        depot = self.depot()
        empreinte = veille.empreinte(self.fichiers())
        avant, self.connu = self.connu, empreinte
        if avant is None:
            return
        sujets = set()
        for chemin in set(avant) | set(empreinte):
            if avant.get(chemin) != empreinte.get(chemin):
                s = sujet_du_fichier(Path(chemin).relative_to(depot).parts)
                if s:
                    sujets.add(s)
        cles = None
        for joueur, sujet in sorted(sujets, key=lambda s: (s[0] or "", s[1])):
            if joueur and joueur.startswith("cle:"):
                cles = self.joueurs_des_cles() if cles is None else cles
                joueur = cles.get(joueur[4:])
                if not joueur:
                    continue
            self.pousser(joueur, sujet)

    def demarrer(self) -> None:
        """La veille part avec le premier flux, dans la boucle qui le sert ; une boucle nouvelle (un redémarrage, un
        autre client d'essai) en relance une."""
        boucle = asyncio.get_running_loop()
        if self.tache is not None and not self.tache.done() and self.boucle is boucle:
            return
        self.boucle = boucle
        self.connu = veille.empreinte(self.fichiers())
        self.tache = boucle.create_task(veille.veiller(self.depot(), self.garder, self.relire, regroupement=200,
                                                        secours=SECOURS, nom="Flux du coin"))
        self.reveil_presence = asyncio.Event()
        self.tache_presence = boucle.create_task(self.tenir_presence())
        self.brancher_arret(boucle)

    def brancher_arret(self, boucle) -> None:
        """À l'arrêt du serveur (SIGTERM d'un redémarrage), les flux se ferment tout de suite : sans cela, le serveur les
        attendrait jusqu'à être tué. Le gestionnaire d'avant (celui d'uvicorn) est appelé ensuite, comme toujours."""
        if self.arret_branche or threading.current_thread() is not threading.main_thread():
            return
        for sig in (signal.SIGTERM, signal.SIGINT):
            avant = signal.getsignal(sig)
            if not callable(avant):
                continue

            def gestionnaire(numero, cadre, avant=avant):
                boucle.call_soon_threadsafe(self.pousser, None, None)
                avant(numero, cadre)
            signal.signal(sig, gestionnaire)
        self.arret_branche = True

    # ------------------------------------------------------------ la présence

    def en_ligne(self, instant: float) -> set:
        """Les joueurs qui tiennent un flux, et ceux qui ont fermé leur dernière page il y a moins de GRACE secondes."""
        for j, quand in list(self.partis.items()):
            if instant - quand >= presence.GRACE or j in self.abonnes:
                self.partis.pop(j, None)
        return set(self.abonnes) | set(self.partis)

    def presence_changee(self) -> None:
        """Un flux ouvert ou fermé : la tâche de présence se réveille (depuis la boucle qui la porte, ou d'ailleurs)."""
        boucle, reveil = self.boucle, self.reveil_presence
        if boucle is None or reveil is None or boucle.is_closed():
            return
        try:
            ici = asyncio.get_running_loop() is boucle
        except RuntimeError:
            ici = False
        if ici:
            reveil.set()
            return
        try:
            boucle.call_soon_threadsafe(reveil.set)
        except RuntimeError:
            pass  # la boucle se ferme : la présence repart avec la suivante

    async def tenir_presence(self) -> None:
        """Publie la liste des joueurs présents quand elle change (regroupé), et de nouveau toutes les BATTEMENT secondes
        tant qu'elle n'est pas vide : l'atelier sait que le fichier dit vrai. Une écriture ratée se retente au réveil
        suivant."""
        publie, quand, erreur = None, 0.0, False
        while True:
            instant = time.monotonic()
            delais = [presence.GRACE - (instant - t) for t in self.partis.values()]
            if publie:
                delais.append(presence.BATTEMENT - (instant - quand))
            attente = 0 if publie is None else (max(0.05, min(delais)) if delais else None)
            try:
                await asyncio.wait_for(self.reveil_presence.wait(), timeout=attente)
                await asyncio.sleep(REGROUPEMENT_PRESENCE)
            except asyncio.TimeoutError:
                pass
            self.reveil_presence.clear()
            instant = time.monotonic()
            liste = sorted(self.en_ligne(instant))
            if liste == publie and not (liste and instant - quand >= presence.BATTEMENT - 0.05):
                continue
            try:
                presence.ecrire(self.depot(), liste)
                publie, quand, erreur = liste, instant, False
            except OSError as err:
                if not erreur:
                    journal.warning("Présence des joueurs non publiée (%s)", type(err).__name__)
                erreur = True
                publie, quand = None, instant
                await asyncio.sleep(2)

    # ------------------------------------------------------------ un flux

    async def evenements(self, joueur: str, q: asyncio.Queue, session_tient: Callable[[], bool]):
        """Les lignes du flux d'un joueur : « retry », des sujets, un battement toutes les 25 secondes. Il se referme si
        la session ne tient plus (lien renouvelé, joueur retiré), au bout d'une demi-heure, ou à l'arrêt du serveur."""
        debut = verifiee = time.monotonic()
        try:
            yield f"retry: {RELANCE_MS}\n: bonjour\n\n"
            while time.monotonic() - debut < DUREE_MAX:
                try:
                    sujet = await asyncio.wait_for(q.get(), timeout=BATTEMENT)
                except asyncio.TimeoutError:
                    sujet = False
                if sujet is None:
                    return
                # La session se revérifie à chaque battement, même quand les sujets se suivent de près (le carnet republié
                # sans cesse pendant une séance) : un nouveau lien ou un joueur retiré ferme le flux à temps.
                if sujet is False or time.monotonic() - verifiee >= BATTEMENT:
                    if not session_tient():
                        return
                    verifiee = time.monotonic()
                if sujet is False:
                    yield ": battement\n\n"
                elif sujet in SUJETS:
                    yield f"data: {sujet}\n\n"
        finally:
            self.fermer(joueur, q)
