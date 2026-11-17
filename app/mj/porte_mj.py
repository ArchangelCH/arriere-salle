"""Les routes des comptes MJ (comptes_mj.py) : qui est connecté (/api/moi), les MJ de l'atelier (bloc « Les MJ » de
l'onglet Aventuriers, au compte principal seul) et la page d'invitation d'un MJ invité.

L'invitation : …/connexion/invitation#cle=… La page lit la clé dans le fragment (le navigateur ne l'envoie jamais au
serveur avec l'adresse : elle n'entre dans aucun journal), l'efface de la barre d'adresse et l'envoie dans le corps
d'une requête. Ni la clé ni une empreinte ne sortent dans une réponse : la clé est tirée au sort par la page du MJ principal,
qui la garde le temps de la copier.

La connexion elle-même (POST /connexion, identifiant et mot de passe) reste dans main.py, avec la Garde.
"""
import asyncio
import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from commun import acces
from mj import cloisonnement
from commun import comptes
from mj import comptes_mj
from mj import proprietes
from mj.proprietes import PRINCIPAL

journal = logging.getLogger("atelier")

ESSAIS_INVITATION = (10, 900)  # clés d'invitation fausses : 10 par adresse en un quart d'heure


def routes(*, donnees, empreinte_env, cle_session, cookie: str, duree: int, essais, plafond, attente, adresse_publique,
           page_invitation, corps_objet) -> APIRouter:
    """empreinte_env, cle_session, plafond, attente, adresse_publique : des fonctions (main.py les lit au moment de la
    requête) ; essais : les essais manqués de la connexion (acces.Essais) ; page_invitation : la page HTML."""
    r = APIRouter()

    def etat() -> dict:
        try:
            return comptes_mj.assurer_principal(donnees, empreinte_env())
        except comptes_mj.Illisible as err:
            journal.error("Comptes des MJ illisibles : %s", err)
            raise HTTPException(503, "Les comptes des MJ ne se lisent pas.")

    def exiger_principal() -> None:
        # Comme une route qui n'existe pas : l'invité n'apprend rien de la gestion des comptes.
        if proprietes.compte_courant() != PRINCIPAL:
            raise HTTPException(404, "Introuvable")

    def adresse_de(requete: Request) -> str:
        return requete.headers.get("cf-connecting-ip") or (requete.client.host if requete.client else "?")

    def liste() -> dict:
        sortie = {"invitations": comptes_mj.INVITATIONS_OUVERTES, "adresse": adresse_publique(),
                  "comptes": [comptes_mj.vu_par_le_principal(c) for c in etat()["comptes"]]}
        if comptes_mj.INVITATIONS_OUVERTES:
            # Le bloc « Les MJ » dit pourquoi personne n'entre tant que le cloisonnement est en veille.
            sortie["strict"] = cloisonnement.strict()
        return sortie

    @r.get("/api/moi")
    def moi():
        """Le compte MJ de cette requête : son identifiant de compte, son nom, son rôle. Sur le LAN, le principal."""
        try:
            c = comptes_mj.par_id(comptes_mj.lire(donnees), proprietes.compte_courant())
        except comptes_mj.Illisible:
            c = None
        return comptes_mj.moi(c)

    @r.put("/api/mj/suite")
    async def nommer_sa_suite(requete: Request):
        """Le nom de la suite de ses séances au carnet des joueurs et à la TV : un invité seulement, les
        séances du principal restent « Séance N »."""
        if proprietes.compte_courant() == PRINCIPAL:
            raise HTTPException(400, "Vos séances restent « Séance N » : seul un MJ invité nomme sa suite.")
        corps = await corps_objet(requete)
        c = await geste(comptes_mj.regler_suite, proprietes.compte_courant(), corps.get("suite"))
        return comptes_mj.moi(c)

    @r.get("/api/mj/comptes")
    def comptes_des_mj():
        exiger_principal()
        return liste()

    async def geste(fonction, *arguments):
        try:
            return await asyncio.to_thread(fonction, donnees, *arguments)
        except comptes.Refus as refus:
            raise HTTPException(refus.statut, refus.message)
        except comptes_mj.Illisible as err:
            journal.error("Comptes des MJ illisibles : %s", err)
            raise HTTPException(503, "Les comptes des MJ ne se lisent pas.")

    @r.post("/api/mj/comptes")
    async def inviter_un_mj(requete: Request):
        """Un MJ invité : la page envoie son prénom et la clé de son lien, qu'elle a tirée au sort et seule montre."""
        exiger_principal()
        corps = await corps_objet(requete)
        c = await geste(comptes_mj.creer_invite, corps.get("nom"), corps.get("cle"))
        journal.info("Invitation d'un MJ : compte %s", c["id"])
        return liste()

    @r.post("/api/mj/comptes/{ident}/lien")
    async def nouveau_lien(ident: str, requete: Request):
        exiger_principal()
        corps = await corps_objet(requete)
        await geste(comptes_mj.nouveau_lien, ident, corps.get("cle"))
        journal.info("Nouveau lien pour le MJ %s", ident)
        return liste()

    @r.post("/api/mj/comptes/{ident}/fermer")
    async def fermer(ident: str):
        exiger_principal()
        await geste(comptes_mj.fermer, ident)
        journal.info("Compte du MJ %s fermé", ident)
        return liste()

    # ---------------------------------------------------------------- la page d'invitation, sans session

    @r.get("/connexion/invitation")
    def page():
        return page_invitation()

    def reserver(requete: Request):
        cle_essai = ("invitation", adresse_de(requete))
        essai = essais.reserver((cle_essai,), {cle_essai: ESSAIS_INVITATION}, plafond())
        if essai is None:
            raise HTTPException(429, "Trop d'essais manqués : réessayez dans un quart d'heure.")
        return essai

    async def refuser(essai, refus: comptes.Refus):
        # Un lien faux ou périmé compte comme un essai manqué ; une règle d'identifiant ou de mot de passe, non.
        if refus.statut == 410 or (refus.statut == 400 and refus.message.startswith("Ce lien")):
            await asyncio.sleep(attente())
        else:
            essais.liberer(essai)
        raise HTTPException(refus.statut, refus.message)

    @r.post("/connexion/invitation/etat")
    async def etat_du_lien(requete: Request):
        """Ce que propose la page : créer son accès, ou choisir un nouveau mot de passe après un nouveau lien."""
        corps = await corps_objet(requete)
        essai = reserver(requete)
        try:
            reponse = comptes_mj.etat_invitation(donnees, corps.get("cle"))
        except comptes.Refus as refus:
            await refuser(essai, refus)
        except comptes_mj.Illisible:
            essais.liberer(essai)
            raise HTTPException(503, "Les comptes des MJ ne se lisent pas.")
        essais.liberer(essai)
        return reponse

    @r.post("/connexion/invitation")
    async def ouvrir_l_invitation(requete: Request):
        """L'invité choisit son identifiant (la première fois) et son mot de passe ; il entre aussitôt. Le lien ne
        resert pas."""
        corps = await corps_objet(requete)
        essai = reserver(requete)
        try:
            lien = comptes_mj.etat_invitation(donnees, corps.get("cle"))
            identifiant = lien["identifiant"] or comptes.identifiant_choisi(corps.get("identifiant"))
            mdp = comptes.mot_de_passe_choisi(corps.get("mot_de_passe"), corps.get("confirmation"), identifiant)
            empreinte = await acces.calculer(acces.empreinte, mdp)
            c = await asyncio.to_thread(comptes_mj.accepter, donnees, corps.get("cle"), identifiant, empreinte)
        except comptes.Refus as refus:
            await refuser(essai, refus)
        except comptes_mj.Illisible:
            essais.liberer(essai)
            raise HTTPException(503, "Les comptes des MJ ne se lisent pas.")
        essais.liberer(essai)
        journal.info("Invitation ouverte par le MJ %s depuis %s", c["id"], adresse_de(requete))
        reponse = JSONResponse({"ok": True, "suite": "/"}, headers={"Cache-Control": "no-store"})
        cle = cle_session()
        if cle:
            reponse.set_cookie(cookie, comptes_mj.jeton_de_session(c, cle, duree), max_age=duree, path="/", secure=True,
                               httponly=True, samesite="lax")
        return reponse

    return r
