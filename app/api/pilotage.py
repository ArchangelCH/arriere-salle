"""La télécommande du MJ."""

import time

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from mj import cloisonnement
from mj import proprietes
from table import telecommande

from api.application import app
from api import statiques_versionnes


# La télécommande du MJ sur téléphone (static/telecommande.html), derrière la même garde que l'atelier : mot de passe par
# Internet, fermée à la table publique. Elle pilote la TV, le combat et le journal par leurs routes ; seules la musique et
# l'étape du feu d'un plan ouvert dans un éditeur passent par le relais (telecommande.py), relevé par l'atelier.
relais = telecommande.Relais()
# Un relais par MJ : le téléphone d'un MJ ne voit que les écrans de son atelier (leurs séances, leurs scènes, les
# plans qu'ils tiennent) et ne confie ses commandes qu'à eux. « relais » reste celui du principal.
relais_des_invites: dict[str, telecommande.Relais] = {}


def relais_du_lecteur() -> telecommande.Relais:
    compte = cloisonnement.destinataire()
    if compte == proprietes.PRINCIPAL:
        return relais
    return relais_des_invites.setdefault(compte, telecommande.Relais())


@app.get("/telecommande")
def page_telecommande():
    return statiques_versionnes.page_html("telecommande.html")


def ecran_relais(corps: dict) -> str:
    ident = corps.get("ecran")
    if not isinstance(ident, str) or not telecommande.ECRAN_VALIDE.match(ident):
        raise HTTPException(400, "Écran de l'atelier inconnu")
    return ident


# Les routes du relais sont asynchrones : elles passent l'une après l'autre, sans qu'un écran prenne la commande d'un autre.
def plan_tenu_au_lecteur(ident) -> bool:
    """Un plan ouvert dans un éditeur de l'atelier, que le lecteur peut lire (chaque MJ a son relais : une garde de plus)."""
    return isinstance(ident, str) and bool(config.ID_VALIDE.match(ident)) and cloisonnement.permis_chemin("plans", config.PLANS / f"{ident}.json")


@app.get("/api/telecommande")
async def telecommande_etat(de: str = ""):
    # Le téléphone qui lit l'état est un signe de vie (les écrans de l'atelier relèvent vite) ; pas l'atelier qui lit l'adresse à donner.
    if de != "atelier":
        relais_du_lecteur().signe_du_telephone(time.monotonic())
    etat = relais_du_lecteur().etat(time.monotonic())
    # Les plans que tiennent les éditeurs ouverts : un MJ ne lit que les siens.
    etat["plans"] = [x for x in etat["plans"] if plan_tenu_au_lecteur(x)]
    # L'adresse par Internet, que l'onglet Table donne à ouvrir sur le téléphone.
    return etat | {"en_ligne": f"https://{min(portier.ATELIER_PUBLIC)}/telecommande" if portier.ATELIER_PUBLIC else None}


def commande_scene(corps: dict) -> dict:
    """« Scène suivante » : {"genre": "scene", "seance", "de", "vers", "titre"}, la scène en cours (-1 : aucune) et celle
    qui va se jouer, telles que le téléphone les montre. L'atelier qui la prend revérifie la séance avant de jouer."""
    seance = corps.get("seance")
    fiche = utilitaires.lire_fiche(utilitaires.existant(config.SEANCES, seance if isinstance(seance, str) else ""))
    deroule = fiche.get("deroule") if isinstance(fiche.get("deroule"), list) else []
    de, vers = corps.get("de"), corps.get("vers")
    if not all(isinstance(v, int) and not isinstance(v, bool) for v in (de, vers)) or not (-1 <= de < len(deroule) and 0 <= vers < len(deroule)) or de == vers:
        raise HTTPException(400, "Cette séance n'a pas cette scène")
    return {"genre": "scene", "seance": seance, "de": de, "vers": vers, "titre": telecommande.chaine(corps.get("titre"), 200)}


@app.post("/api/telecommande/commandes")
async def telecommande_commander(requete: Request):
    """Une commande du téléphone : {"genre": "musique", "action", "ambiance"?}, {"genre": "etape", "plan", "etape"} ou
    {"genre": "scene", …} (commande_scene). Rend son numéro (relais vrai), ou relais faux pour une étape qu'aucun éditeur
    ne tient, ou une scène sans atelier ouvert (le téléphone fait le geste lui-même)."""
    relais_du_lecteur().signe_du_telephone(time.monotonic())
    corps = await utilitaires.corps_objet(requete)
    genre = corps.get("genre")
    if genre == "musique":
        action = corps.get("action")
        if action not in telecommande.ACTIONS_MUSIQUE:
            raise HTTPException(400, "Commande de musique inconnue")
        commande = {"genre": "musique", "action": action}
        if action == "choisir":
            ambiance = corps.get("ambiance")
            if not isinstance(ambiance, str) or not any(isinstance(a, dict) and a.get("id") == ambiance for a in tv_ecran.lire_musique()["ambiances"]):
                raise HTTPException(404, "Cette ambiance n'est plus dans la liste de musique")
            commande["ambiance"] = ambiance
    elif genre == "etape":
        plan, etape = corps.get("plan"), corps.get("etape")
        p = utilitaires.lire_fiche(utilitaires.existant(config.PLANS, plan if isinstance(plan, str) else ""))
        etapes = p.get("etapes") if isinstance(p.get("etapes"), list) else []
        if isinstance(etape, bool) or not isinstance(etape, int) or not 0 <= etape < len(etapes):
            raise HTTPException(400, "Ce plan n'a pas cette étape")
        commande = {"genre": "etape", "plan": plan, "etape": etape}
    elif genre == "scene":
        commande = commande_scene(corps)
    else:
        raise HTTPException(400, "Commande inconnue")
    jeton = corps.get("jeton")
    if isinstance(jeton, str) and telecommande.JETON_VALIDE.match(jeton):
        commande["jeton"] = jeton
    try:
        c = relais_du_lecteur().ajouter(commande, time.monotonic())
    except telecommande.Refus as err:
        raise HTTPException(409, str(err))
    return c | {"relais": True} if c else {"relais": False}


@app.get("/api/telecommande/commandes/{numero}")
async def telecommande_suivre(numero: int):
    c = relais_du_lecteur().lire(numero, time.monotonic())
    if not c:
        raise HTTPException(404, "Commande inconnue")
    return c


@app.delete("/api/telecommande/commandes/{numero}")
async def telecommande_annuler(numero: int):
    annulee = relais_du_lecteur().annuler(numero, time.monotonic())
    c = relais_du_lecteur().lire(numero, time.monotonic())
    if not c:
        raise HTTPException(404, "Commande inconnue")
    return c | {"annulee": annulee}


@app.post("/api/telecommande/releve")
async def telecommande_relever(requete: Request):
    corps = await utilitaires.corps_objet(requete)
    relais = relais_du_lecteur()
    commandes = relais.releve(ecran_relais(corps), corps, time.monotonic())
    # Le rythme du prochain relevé, en en-tête : le corps reste celui d'avant.
    return JSONResponse({"commandes": commandes}, headers={"X-Prochain-Releve": str(relais.periode_de_releve(time.monotonic()))})


@app.post("/api/telecommande/commandes/{numero}/resultat")
async def telecommande_resultat(numero: int, requete: Request):
    corps = await utilitaires.corps_objet(requete)
    return {"pris": relais_du_lecteur().resultat(ecran_relais(corps), numero, corps.get("ok") is True, corps.get("message"),
                                                time.monotonic(), libre=corps.get("libre") is True)}


@app.post("/api/telecommande/adieu")
async def telecommande_adieu(requete: Request):
    relais_du_lecteur().adieu(ecran_relais(await utilitaires.corps_objet(requete)))
    return {"ok": True}


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import config, portier, utilitaires, tv_ecran  # noqa: E402
