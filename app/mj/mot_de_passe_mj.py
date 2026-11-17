"""« Changer mon mot de passe » (page Réglages de l'atelier, section Accès) : le MJ connecté change le sien, l'actuel
d'abord. Chacun le sien : la route ne prend aucun compte en paramètre, c'est celui de la requête (sur le réseau local
porte endormie, le principal).

Le nouveau mot de passe s'écrit dans data/mj/comptes.json (comptes_mj.py), en scrypt comme tous les comptes ; la
génération du compte monte : toutes ses sessions en ligne et tous ses appareils reconnus tombent, comme pour un nouveau
mot de passe tiré par outils/mot-de-passe.py ; ses pages ouvertes cessent d'écouter l'atelier (/ws/atelier fermé). L'appareil qui fait le geste reste dans l'atelier : une session neuve en
ligne, ou, sur le réseau local, le même appareil reconnu de nouveau sous son nom.

Avec ATELIER_MDP_EMPREINTE (l'empreinte que tient secrets/acces.env, outils/mot-de-passe.py) : le compte principal garde la
marque de l'empreinte de l'environnement qu'il a déjà reprise (« env »), il ne la reprend donc pas au démarrage suivant.
Le dernier geste l'emporte : un nouveau mot de passe tiré ensuite par outils/mot-de-passe.py (puis « docker compose up
-d ») remplace celui-ci, et outils/mot-de-passe.py --compte mj reste le secours. Si data/mj/comptes.json se perdait,
le principal renaîtrait de l'environnement, avec l'ancien mot de passe.

Les essais manqués se comptent avec ceux de la connexion (même adresse, même identifiant) : la page ne sert pas à
deviner un mot de passe plus vite que la porte d'entrée. Le geste est noté dans data/mj/journal.jsonl, sans empreinte.
"""
import asyncio
import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from commun import acces
from commun import comptes
from mj import comptes_mj
from mj import porte_lan
from mj import proprietes

journal = logging.getLogger("atelier")

# Comme outils/mot-de-passe.py : l'atelier entier est derrière ce mot de passe.
MDP_MIN_MJ = 12
CHANGE_ENTRE_TEMPS = "Votre compte a changé entre-temps sur un autre appareil : rechargez la page et recommencez."
SANS_MOT_DE_PASSE = ("Ce compte n'a pas encore de mot de passe : il se règle sur le serveur "
                     "(outils/mot-de-passe.py, puis docker compose up -d aventures-atelier).")


def nouveau_choisi(nouveau, confirmation, identifiant: str) -> str:
    """Le nouveau mot de passe, ou un refus qui dit la règle (celles des comptes, et 12 caractères au moins)."""
    propre = comptes.mot_de_passe_choisi(nouveau, confirmation, identifiant)
    if len(propre) < MDP_MIN_MJ:
        raise comptes.Refus(400, f"Le mot de passe de l'atelier doit faire au moins {MDP_MIN_MJ} caractères.")
    return propre


def changer(donnees, ident: str, generation: int, empreinte: str) -> dict:
    """Sous le verrou des comptes : la nouvelle empreinte, la génération suivante (sessions et appareils tombent). Le
    compte doit être celui qu'on a vérifié : même génération, toujours ouvert."""
    with comptes_mj.verrou(donnees):
        etat = comptes_mj.lire(donnees)
        c = comptes_mj.par_id(etat, ident)
        if not c or not comptes_mj.ouvert(c) or c["generation"] != generation:
            raise comptes.Refus(409, CHANGE_ENTRE_TEMPS)
        c.update(empreinte=empreinte, generation=c["generation"] + 1, modifie=comptes_mj.maintenant())
        comptes_mj.ecrire(donnees, etat)
    comptes_mj.noter(donnees, "mot-de-passe", ident, ident)
    return c


def routes(*, donnees, empreinte_env, cle_session, cookie: str, duree: int, essais, limites, plafond, attente, porte,
           en_ligne, corps_objet, couper_canaux=None) -> APIRouter:
    """empreinte_env, cle_session, limites, plafond, attente : des fonctions (main.py les lit au moment de la requête) ;
    limites() rend ((essais, secondes) par adresse, (essais, secondes) par identifiant), ceux de la connexion ; essais :
    les essais manqués de la connexion (acces.Essais) ; porte : la porte du réseau local ; en_ligne(entêtes) : vrai pour
    l'atelier en ligne ; couper_canaux(compte) : ferme les WebSockets déjà ouverts des pages de ce compte (une session
    coupée n'écoute plus l'atelier ; la page de ce geste se relie seule, avec sa session neuve)."""
    r = APIRouter()

    def adresse_de(requete: Request) -> str:
        return requete.headers.get("cf-connecting-ip") or (requete.client.host if requete.client else "?")

    @r.post("/api/mj/mot-de-passe")
    async def changer_mon_mot_de_passe(requete: Request):
        ident = proprietes.compte_courant()
        corps = await corps_objet(requete)
        try:
            etat = await asyncio.to_thread(comptes_mj.assurer_principal, donnees, empreinte_env())
        except comptes_mj.Illisible as err:
            journal.error("Comptes des MJ illisibles : %s", err)
            raise HTTPException(503, "Les comptes des MJ ne se lisent pas.")
        c = comptes_mj.par_id(etat, ident)
        if not c or not c.get("empreinte") or not comptes_mj.ouvert(c):
            raise HTTPException(409, SANS_MOT_DE_PASSE)
        try:
            nouveau = nouveau_choisi(corps.get("nouveau"), corps.get("confirmation"), c["identifiant"])
        except comptes.Refus as refus:
            raise HTTPException(refus.statut, refus.message)
        par_adresse, par_identifiant = limites()
        cles = (("adresse", adresse_de(requete)), ("identifiant", c["forme"]))
        essai = essais.reserver(cles, {cles[0]: par_adresse, cles[1]: par_identifiant}, plafond())
        if essai is None:
            raise HTTPException(429, "Trop d'essais manqués : réessayez dans un quart d'heure.")
        actuel = corps.get("actuel")
        actuel = actuel[:256] if isinstance(actuel, str) else ""
        if not await acces.calculer(acces.verifier, c["empreinte"], actuel):
            journal.warning("Mot de passe actuel incorrect au changement (compte %s) depuis %s", ident, adresse_de(requete))
            await asyncio.sleep(attente())
            raise HTTPException(403, "Mot de passe actuel incorrect.")
        essais.liberer(essai)
        essais.oublier(*cles)
        if nouveau == actuel:
            raise HTTPException(400, "Choisissez un mot de passe différent de l'actuel.")
        # Cet appareil, reconnu sur le réseau local pour ce compte : il le sera de nouveau, sous le même nom (le changement
        # coupe tous les appareils, celui-ci compris).
        cet = None
        if not en_ligne(requete.headers):
            trouve = porte.appareil(acces.lire_cookie(requete.headers.get("cookie", ""), porte_lan.COOKIE))
            cet = trouve[1] if trouve and trouve[0]["id"] == ident else None
        empreinte = await acces.calculer(acces.empreinte, nouveau)
        try:
            c = await asyncio.to_thread(changer, donnees, ident, c["generation"], empreinte)
        except comptes.Refus as refus:
            raise HTTPException(refus.statut, refus.message)
        except comptes_mj.Illisible as err:
            journal.error("Comptes des MJ illisibles : %s", err)
            raise HTTPException(503, "Les comptes des MJ ne se lisent pas.")
        journal.info("Mot de passe changé depuis l'atelier (compte %s) depuis %s", ident, adresse_de(requete))
        if couper_canaux is not None:
            await couper_canaux(ident)
        reponse = JSONResponse({"ok": True, "en_ligne": bool(en_ligne(requete.headers))}, headers={"Cache-Control": "no-store"})
        if en_ligne(requete.headers):
            cle = cle_session()
            if cle:
                reponse.set_cookie(cookie, comptes_mj.jeton_de_session(c, cle, duree), max_age=duree, path="/", secure=True,
                                   httponly=True, samesite="lax")
        elif cet is not None:
            try:
                _, valeur = await asyncio.to_thread(porte.reconnaitre, ident, cet.get("nom") or "",
                                                    requete.headers.get("user-agent", ""))
                reponse.headers.append("set-cookie", porte_lan.entete_cookie(valeur))
            except (OSError, comptes.Refus, comptes_mj.Illisible) as err:
                journal.error("Appareil non reconnu de nouveau après le changement de mot de passe : %s", err)
        return reponse

    return r
