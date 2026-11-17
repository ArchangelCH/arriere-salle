"""La campagne et le registre des règles maison."""

import asyncio
from contextlib import nullcontext
from datetime import datetime

from fastapi import HTTPException, Request

from commun.campagne import SOUS_TITRE
from mj import cloisonnement
from contenu import regles_maison
from table.masque import masquer_tout

from api.application import app
from api import config


def campagne() -> dict:
    if config.CAMPAGNE.exists():
        return utilitaires.lire_fiche(config.CAMPAGNE)
    return {"nom": SOUS_TITRE, "niveau": 1, "tablee": [], "reputations": [], "modifie": None}


# Ce qu'un MJ invité lit de la campagne : le niveau du groupe et la tablée telle que la TV la montre (joueur,
# personnage, couleur, vocation ; le peuple seulement si celui du héros n'est pas gardé secret), pour mener une quête annexe
# avec les mêmes héros. Comme pour la rédaction (etat_campagne) : ni le nom de la campagne (le titre du MJ peut annoncer
# l'intrigue), ni les réputations (des notes du MJ), ni le groupe de la balance ; passé au masque. Il ne l'écrit pas.
CHAMPS_TABLEE_INVITE = ("id", "actif", "aventurier", "joueur", "couleur", "personnage", "vocation")


def campagne_pour_l_invite(c: dict) -> dict:
    heros = {a["id"]: a for a in utilitaires.lire_tout(config.AVENTURIERS) if isinstance(a.get("id"), str)}
    tablee = []
    for j in c.get("tablee") or []:
        if not isinstance(j, dict):
            continue
        vu = {k: j[k] for k in CHAMPS_TABLEE_INVITE if k in j}
        a = heros.get(j.get("aventurier")) if isinstance(j.get("aventurier"), str) else None
        # Un joueur sans fiche : son peuple n'a pas de réglage qui dise s'il est secret, il ne part pas.
        vu["peuple"] = utilitaires.texte(j.get("peuple")) if a is not None and not a.get("peuple_cache") else ""
        tablee.append(vu)
    niveau = c.get("niveau")
    return masquer_tout({"niveau": niveau if isinstance(niveau, int) and not isinstance(niveau, bool) else 1, "tablee": tablee,
                         "reputations": [], "modifie": c.get("modifie")})


@app.get("/api/campagne")
def lire_campagne():
    if cloisonnement.est_invite() and cloisonnement.refuse("campagne-entiere"):
        return campagne_pour_l_invite(campagne())
    return campagne()


@app.put("/api/campagne")
async def enregistrer_campagne(requete: Request):
    doc = await utilitaires.corps_objet(requete)
    precedente = campagne()
    if "version_base" in doc and doc.pop("version_base") != precedente.get("modifie"):
        raise HTTPException(409, "La campagne a été modifiée depuis un autre écran.")
    doc["modifie"] = utilitaires.maintenant()
    utilitaires.archiver(config.CAMPAGNE, "campagne")
    utilitaires.ecrire(config.CAMPAGNE, doc)
    return doc


# Les règles maison (regles_maison.py) : une fiche par règle, avec historique et corbeille comme les autres collections,
# mais des champs vérifiés un à un. Chaque changement réécrit le carnet des joueurs (propositions/carnet/regles.json),
# que sert le coin des joueurs : les seules règles en vigueur et publiques, sans contexte, passées par masquer_tout.
REGLES = config.DONNEES / "regles-maison"
CARNET_REGLES = config.PROPOSITIONS / "carnet" / "regles.json"
VERROU_REGLES = asyncio.Lock()


def seance_existe(ident: str) -> bool:
    return bool(config.ID_VALIDE.match(ident)) and (config.SEANCES / f"{ident}.json").is_file()


def regle_envoyee(corps: dict, avant: dict | None) -> dict:
    try:
        return regles_maison.regle_valide(corps, avant, seance_existe, datetime.now().date())
    except ValueError as err:
        raise HTTPException(400, str(err))


def publier_regles() -> None:
    elements = regles_maison.regles_publiques(utilitaires.lire_tout(REGLES), lambda ident: tv_cartes.jeton("regles-maison", ident))
    utilitaires.ecrire(CARNET_REGLES, {"maj": utilitaires.maintenant(), "elements": masquer_tout(elements)})


def regle_vue(r: dict, autres: list | None = None) -> dict:
    """Une règle maison, commune aux deux MJ : la séance où elle est née ne se nomme qu'à son MJ (son identifiant dit le
    nom de la séance). Un MJ invité la lit sans son contexte, une note du MJ qui cite ses scénarios et ses séances, sans
    les lignes qui nomment un secret du MJ principal (une règle gardée pour le MJ peut nommer un PNJ inconnu des joueurs), et au
    masque comme le carnet des joueurs. autres : secrets_de_l_autre(), lu une fois pour toute une liste."""
    s = r.get("seance")
    if s and isinstance(s, str) and config.ID_VALIDE.match(s) and (config.SEANCES / f"{s}.json").is_file() \
            and not cloisonnement.permis_chemin("seances", config.SEANCES / f"{s}.json"):
        r = {**r, "seance": ""}
    if cloisonnement.est_invite() and cloisonnement.refuse("regle-entiere"):
        autres = contexte_du_modele.secrets_de_l_autre() if autres is None else autres
        # Le masque d'abord, comme pour la rédaction : le nom caché de l'auberge devient « l'auberge », sa ligne reste.
        vue = masquer_tout({**r, "contexte": "", "seance": ""})
        for cle in ("titre", "texte"):
            if isinstance(vue.get(cle), str):
                vue[cle] = contexte_du_modele.sans_secret_d_un_autre(vue[cle], autres)
        return vue
    return r


def regles_vues(regles: list) -> list:
    autres = contexte_du_modele.secrets_de_l_autre() if cloisonnement.est_invite() else None
    return [regle_vue(r, autres) for r in regles]


@app.get("/api/regles-maison")
def liste_regles():
    return regles_vues(regles_maison.trier(utilitaires.lire_tout(REGLES)))


@app.post("/api/regles-maison")
async def creer_regle(requete: Request):
    corps = await utilitaires.corps_objet(requete)
    corps.pop("version_base", None)
    async with VERROU_REGLES:
        regle = regle_envoyee(corps, None)
        regle["id"] = utilitaires.nouvel_id(REGLES, regle["titre"])
        regle["cree"] = regle["modifie"] = utilitaires.maintenant()
        utilitaires.ecrire(REGLES / f"{regle['id']}.json", regle)
        publier_regles()
    return regle


@app.get("/api/regles-maison/{ident}")
def lire_regle(ident: str):
    return regle_vue(utilitaires.lire_fiche(utilitaires.existant(REGLES, ident)))


@app.patch("/api/regles-maison/{ident}")
async def modifier_regle(ident: str, requete: Request):
    """Change les champs envoyés, et eux seuls ; une page qui envoie sa version ne passe pas sur un autre écran (409)."""
    corps = await utilitaires.corps_objet(requete)
    async with VERROU_REGLES:
        chemin = utilitaires.existant(REGLES, ident)
        avant = utilitaires.lire_fiche(chemin)
        if "version_base" in corps and corps.pop("version_base") != avant.get("modifie"):
            raise HTTPException(409, "Cette règle a été modifiée depuis un autre écran.")
        regle = {**regle_envoyee(corps, avant), "id": ident, "cree": avant.get("cree"), "modifie": utilitaires.maintenant()}
        utilitaires.archiver(chemin, "regles-maison")
        utilitaires.ecrire(chemin, regle)
        publier_regles()
    return regle


@app.delete("/api/regles-maison/{ident}")
async def supprimer_regle(ident: str):
    async with VERROU_REGLES:
        utilitaires.jeter(utilitaires.existant(REGLES, ident), "regles-maison")
        publier_regles()
    return {"ok": True}


def verrou_de_collection(nom: str):
    """Le verrou des écritures d'une collection, comme celui de son éditeur (routes_fiches) : SAC_VERROU pour les fiches
    illustrées, celui du rejeu pour les plans ; aucun pour les autres."""
    if nom == "plans":
        return tv_etat.mouvements_joueurs.verrou
    return heros_etat.SAC_VERROU if nom in ("lieux", "pnj", "aventuriers") else nullcontext()


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import utilitaires, heros_etat, tv_cartes, tv_etat, contexte_du_modele  # noqa: E402
