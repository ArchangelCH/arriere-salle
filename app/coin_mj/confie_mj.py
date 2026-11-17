"""« Confié au MJ » dans l'atelier : ce que l'atelier fait d'un passage « Pour le MJ seulement » envoyé depuis
le coin (confie.py).

- La boîte l'applique seule, sans le MJ : le texte va sur la fiche du héros de ce joueur, dans le champ confie_au_mj
  {texte, envoye, lu, envoi, joueur}, sous SAC_VERROU (celui des écritures de fiche des joueurs). Un nouvel envoi remplace
  le précédent et le remet « nouveau ». Ni « modifie » ni l'historique ne bougent : la fiche ouverte dans l'éditeur ne
  prend pas de conflit, et un joueur qui renvoie souvent ne chasse pas les versions gardées du MJ. Le champ est tenu par
  ces routes seules : un enregistrement de la fiche entière, une version remise ou une création ne le touchent pas.
- La demande ne garde ensuite que la longueur du texte (confie.apres_application) : la boîte, qui lit les files en
  entier, n'en a jamais le texte.
- Le reçu, sans le texte, est publié pour le joueur (propositions/confie-lu/<joueur>.json) : déposé, puis lu.
- La ligne de la boîte dit qui a confié quoi pour quel héros, et si le MJ l'a lu ; Telegram, le prénom et le genre.
- « Lu » (POST /api/aventuriers/{ident}/confie/lu) se fait depuis la fiche, page « Pour le MJ », avec l'envoi que la page
  a sous les yeux : un texte arrivé entre-temps reste « nouveau ».

Ce texte est un secret du héros : il ne part ni vers le carnet, ni vers la TV, ni vers la table publique, ni vers un
contexte de rédaction (toutes ces projections sont des listes blanches qui l'ignorent), et l'invité du deuxième accès MJ
ne le lira pas (proprietes.SECRETS_DES_HEROS).

Ce module ne connaît de l'atelier que les fonctions que main.py lui passe.
"""
import asyncio
import hmac
import logging
from datetime import datetime
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, HTTPException, Request

from commun import confie
from commun import demandes
from commun import inventaire
from commun.demandes import Refus

journal = logging.getLogger("atelier.confie")
NOUVEAU = "Un nouveau texte est arrivé pendant votre lecture : relisez-le."
MOIS = ("janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre")


def le_jour(iso) -> str:
    """« le 9 novembre » ; vide pour une date illisible."""
    try:
        d = datetime.fromisoformat(str(iso))
    except ValueError:
        return ""
    return f"le {'1er' if d.day == 1 else d.day} {MOIS[d.month - 1]}"


def valeur_lisible(c) -> dict | None:
    """Le champ de la fiche tel que l'atelier le lit ; None s'il est absent ou abîmé."""
    if not isinstance(c, dict) or not isinstance(c.get("texte"), str) or not isinstance(c.get("envoi"), str):
        return None
    return c


class ConfieMJ:
    def __init__(self, depot: Path, *, heros_du_joueur: Callable[[str], dict | None], ref: Callable[[str], str],
                 chemin_heros: Callable[[str], Path], lire: Callable[[Path], dict], ecrire: Callable[[Path, dict], None],
                 verrou, maintenant: Callable[[], str]):
        self.depot = depot
        self.heros_du_joueur = heros_du_joueur
        self.ref = ref
        self.chemin_heros = chemin_heros
        self.lire = lire
        self.ecrire = ecrire
        self.verrou = verrou
        self.maintenant = maintenant
        # Le dossier des reçus existe d'avance : le flux du coin le guette dès sa première page ouverte.
        try:
            (depot / confie.LUS).mkdir(parents=True, exist_ok=True)
        except OSError:
            journal.warning("Dossier des reçus « Pour le MJ seulement » impossible à créer")

    def brancher(self, boite) -> None:
        boite.brancher(confie.GENRE, appliquer=self.appliquer, dire=self.dire)

    # ------------------------------------------------------------ déposer sur la fiche

    def chemin(self, ident: str) -> Path:
        try:
            return self.chemin_heros(ident)
        except HTTPException:
            raise Refus(409, "Ce héros n'est plus dans l'atelier.")

    def appliquer(self, j: dict, d: dict) -> str:
        """Sous le verrou des demandes (boîte) : le texte sur la fiche du héros de ce joueur, puis le reçu. Quoi qu'il
        arrive, la demande n'en garde ensuite que la longueur."""
        corps = d["corps"]
        try:
            a = self.heros_du_joueur(j["id"])
            if not a or not hmac.compare_digest(self.ref(a["id"]), str(corps.get("ref") or "")):
                raise Refus(409, confie.AUTRE_HEROS)
            with self.verrou:
                chemin = self.chemin(a["id"])
                fiche = self.lire(chemin)
                fiche[confie.CHAMP] = {"texte": corps["passage"], "envoye": d.get("cree") or self.maintenant(), "lu": None,
                                       "envoi": d["id"], "joueur": j["id"]}
                self.ecrire(chemin, fiche)
            confie.ecrire_recu(self.depot, j["id"], d["id"], None)
            return ""
        finally:
            d["corps"] = confie.apres_application(corps)

    # ------------------------------------------------------------ « Lu »

    def marquer_lu(self, ident: str, envoi) -> dict:
        """Le MJ a lu le texte que sa page montre (envoi) ; un texte plus récent reste nouveau (409)."""
        if not isinstance(envoi, str) or not confie.ID_ENVOI.match(envoi):
            raise Refus(400, "Quel texte avez-vous lu ? La fiche se relit.")
        with self.verrou:
            chemin = self.chemin(ident)
            fiche = self.lire(chemin)
            c = valeur_lisible(fiche.get(confie.CHAMP))
            if c is None:
                raise Refus(404, "Rien n'est confié sur cette fiche.")
            if c["envoi"] != envoi:
                raise Refus(409, NOUVEAU)
            if not c.get("lu"):
                c["lu"] = self.maintenant()
                fiche[confie.CHAMP] = c
                self.ecrire(chemin, fiche)
        joueur = c.get("joueur")
        if isinstance(joueur, str) and demandes.ID_JOUEUR.match(joueur):
            try:
                confie.ecrire_recu(self.depot, joueur, c["envoi"], c["lu"])
            except OSError:
                journal.warning("Reçu « Pour le MJ seulement » non publié pour un joueur")
        return {confie.CHAMP: c}

    # ------------------------------------------------------------ la boîte

    def dire(self, j: dict, d: dict) -> str:
        """« Aube vous a confié un passage pour Ysolde : à lire sur sa fiche (« Pour le MJ »), pas encore lu. » Jamais le
        texte."""
        a = self.heros_du_joueur(j.get("id", ""))
        pour = f" pour {inventaire.prenom(a.get('nom'))}" if a else ""
        qui = j.get("nom") or "Le joueur"
        statut = d.get("statut")
        if statut == demandes.A_APPLIQUER:
            return f"{qui} vous confie un passage{pour}."
        if statut == demandes.ECHEC:
            return f"{qui} a voulu vous confier un passage{pour} : il n'a pas été déposé."
        if statut == demandes.RETIREE:
            return f"{qui} a retiré un passage{pour} avant qu'il soit déposé."
        c = valeur_lisible((a or {}).get(confie.CHAMP))
        if c is None or c["envoi"] != d.get("id"):
            return f"{qui} vous a confié un passage{pour} ; un texte plus récent l'a remplacé sur sa fiche."
        lu = f"lu {le_jour(c['lu'])}".rstrip() if c.get("lu") else "pas encore lu"
        return f"{qui} vous a confié un passage{pour} : à lire sur sa fiche (page « Pour le MJ »), {lu}."

    def routes(self, corps_objet) -> APIRouter:
        """Hors de /api/table/… : la garde de main.py la ferme à la table publique, et à Internet sans session."""
        r = APIRouter()

        @r.post("/api/aventuriers/{ident}/confie/lu")
        async def confie_lu(ident: str, requete: Request):
            corps = await corps_objet(requete)
            try:
                return await asyncio.to_thread(self.marquer_lu, ident, corps.get("envoi"))
            except Refus as refus:
                raise HTTPException(refus.statut, refus.message)

        return r
