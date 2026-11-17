"""La bible de la campagne dans l'atelier et ce que les joueurs en voient."""

import asyncio
import os
import time
from pathlib import Path

from fastapi import HTTPException, Request

from commun import bible
from mj import cloisonnement
from table import masque
from table.masque import contient_nom_cache, masquer, masquer_tout

from api.application import app
from api import config


# La bible de la campagne (notes/lore, montée en lecture seule) : fiches d'épisode, synthèses, arbitrages, bible thématique.
# Lecture et recherche dans bible.py, partagées avec le coin des joueurs. L'atelier voit tout ; rien ne part vers la TV.

LORE = Path(os.environ.get("LORE_DIR", "/lore"))
ORDRE_BIBLE, NOMS_GROUPES = bible.ORDRE_BIBLE, bible.NOMS_GROUPES
lecture, lire_lore, titre_md, sans_accents, extrait = bible.lecture, bible.lire, bible.titre_md, bible.sans_accents, bible.extrait


def fichier_lore(relatif: str) -> Path:
    try:
        return bible.fichier_sous(LORE, relatif)
    except bible.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


def documents_bible() -> list[dict]:
    return bible.documents(LORE)


def fiches_episodes() -> list[tuple[str, Path]]:
    return bible.fiches_episodes(LORE)


# Un MJ invité lit la bible des joueurs (la liste blanche de bible.py : ni les Contrôles, ni « Mystères et flottements »),
# passée au masque comme celle du coin : le nom caché de l'auberge est un secret du kit.
def bible_des_joueurs_pour_l_invite() -> bool:
    return cloisonnement.est_invite() and cloisonnement.refuse("bible-entiere")


@app.get("/api/bible")
def sommaire_bible():
    if bible_des_joueurs_pour_l_invite():
        return masquer_tout(bible.pour_les_joueurs(bible.catalogue(LORE)))
    return bible.catalogue(LORE)


@app.get("/api/bible/document")
def bible_document(chemin: str):
    if bible_des_joueurs_pour_l_invite():
        if not bible.ouvert_aux_joueurs(chemin):
            raise HTTPException(404, "Introuvable")
        f = fichier_lore(chemin)
        return masquer_tout(bible.vue_document(chemin, lire_lore(f), f.stem))
    f = fichier_lore(chemin)
    return bible.vue_document(chemin, lire_lore(f), f.stem)


@app.get("/api/bible/recherche")
def bible_recherche(q: str, limite: int = 80):
    if bible_des_joueurs_pour_l_invite():
        def lire_ouvert(relatif: str):
            return lecture(LORE / relatif)[1:] if bible.ouvert_aux_joueurs(relatif) else None
        return masquer_tout(bible.chercher(bible.pour_les_joueurs(bible.catalogue(LORE)), q, lire_ouvert, limite))
    return bible.chercher(bible.catalogue(LORE), q, lambda relatif: lecture(LORE / relatif)[1:], limite)


# La bible des joueurs : l'interrupteur du MJ (onglet Bible), fermé tant qu'il ne l'a pas ouvert. Ouverte, l'atelier
# publie dans les propositions la seule liste blanche de bible.py, passée par le masque ; une tâche de fond la refait
# quand /lore change (un regard sur les dates chaque minute). Fermée, rien n'en reste dans les propositions.
BIBLE_JOUEURS = config.DONNEES / "bible-joueurs.json"
BIBLE_INTERVALLE = 60
BIBLE_RELECTURE = 3600


def bible_ouverte() -> bool:
    try:
        return utilitaires.lire(BIBLE_JOUEURS).get("ouverte") is True
    except (OSError, ValueError, AttributeError):
        return False


def publier_bible() -> dict:
    return bible.publier(config.PROPOSITIONS, LORE, bible_ouverte(), masquer, contient_nom_cache, masque.nom_public())


def tour_de_la_bible(suivi: dict) -> None:
    try:
        if (bible.a_republier(config.PROPOSITIONS, LORE, bible_ouverte(), masque.nom_public())
                or time.monotonic() - suivi.get("depuis", 0.0) > BIBLE_RELECTURE):
            suivi["depuis"] = time.monotonic()
            suivi["dernier"] = publier_bible()
        suivi["erreur"] = ""
    except Exception as err:
        if repr(err) != suivi.get("erreur"):
            suivi["erreur"] = repr(err)
            config.journal.exception("Bible des joueurs non publiée")


async def surveiller_bible() -> None:
    suivi: dict = {}
    while True:
        await asyncio.to_thread(tour_de_la_bible, suivi)
        await asyncio.sleep(BIBLE_INTERVALLE)


@app.get("/api/bible-joueurs")
def lire_bible_joueurs():
    """L'interrupteur, ce que lisent les joueurs (documents, taille, date) et ce qui leur reste fermé."""
    index = bible.lire_index(config.PROPOSITIONS) or {}
    fermes = [{"titre": d["titre"], "rubrique": d["rubrique"]} for d in documents_bible() if not bible.ouvert_aux_joueurs(d["chemin"])]
    return {"ouverte": bible_ouverte(), "maj": index.get("maj"), "documents": len(index.get("elements") or []),
            "octets": index.get("octets") or 0, "fermes": fermes}


@app.put("/api/bible-joueurs")
async def changer_bible_joueurs(requete: Request):
    ouverte = (await utilitaires.corps_objet(requete)).get("ouverte")
    if not isinstance(ouverte, bool):
        raise HTTPException(400, "Champ « ouverte » invalide")
    utilitaires.ecrire(BIBLE_JOUEURS, {"ouverte": ouverte, "modifie": utilitaires.maintenant()})
    publie = await asyncio.to_thread(publier_bible)
    return lire_bible_joueurs() | {"retenus": publie["retenus"]}


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import utilitaires  # noqa: E402
