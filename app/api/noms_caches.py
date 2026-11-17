"""Les noms que les joueurs ne doivent pas connaître, le nom de l'auberge et les rédactions qui s'y rattachent."""

import asyncio
from collections import Counter

import httpx
from fastapi import HTTPException, Request

from ia.illustrations import proposer_pnj, rediger_histoire, rediger_precedemment
from mj import cloisonnement
from table import masque
from mj import proprietes
from table.masque import contient_nom_cache, forme_simple, formes_du_nom, masquer, mots_du_nom, secrets_dans

from api.application import app
from api import config, utilitaires


NOM_PNJ_DEFAUT = "nouveau pnj"  # le nom d'une fiche vierge du carnet, sans accents ni casse


def secrets_des_joueurs(pnj_connus: frozenset = frozenset()) -> list:
    """Ce que les joueurs ne savent pas encore, avec les formes sous lesquelles on le reconnaît dans un texte : les PNJ et
    les lieux inconnus, le peuple caché d'un aventurier. Chaque PNJ ou lieu a sa ligne, pour que « Marquer connu » ne vise
    que lui : quand plusieurs fiches portent le même nom (trois « Billy »), `precision` les distingue comme la liste du
    carnet (métier · lieu d'un PNJ, clé du type d'un lieu) et `ambigu` dit qu'elle n'y suffit pas. Un peuple caché ne fait
    qu'une ligne, avec les aventuriers qui le portent. `pnj_connus` : des PNJ tenus pour connus (celui dont le carton va
    partir, qui le devient).
    Ceux de chaque MJ (l'union) : un texte de l'un ne doit pas dévoiler aux joueurs le secret de l'autre. Le secret d'un
    autre que le principal porte « auteur » ; ce qui en sort vers un MJ passe par cloisonnement.secret_vu (le nom de
    l'autre MJ s'y anonymise). Les homonymes se départagent entre les fiches d'un même MJ."""
    pnj, lieux, aventuriers = utilitaires.lire_tout(config.PNJ, tout=True), utilitaires.lire_tout(config.LIEUX, tout=True), utilitaires.lire_tout(config.AVENTURIERS)
    pnj = [p | {"connu": True} if p.get("id") in pnj_connus else p for p in pnj]
    # Un mot déjà porté par un nom connu (« Varenne » de Lisette Varenne, du moulin des Varenne) ne désigne pas un secret à lui seul.
    connus = set()
    for nom in [*(p.get(k) for p in pnj if p.get("connu") for k in ("nom", "surnom")),
                *(l.get("nom") for l in lieux if l.get("connu")), *(a.get("nom") for a in aventuriers)]:
        connus |= mots_du_nom(nom)
    noms_lieux = {l.get("id"): utilitaires.texte(l.get("nom")).strip() for l in lieux if l.get("id")}
    fiches = []  # (genre, fiche, formes, précision)
    for p in pnj:
        if p.get("connu") or not p.get("id") or forme_simple(p.get("nom")) in ("", NOM_PNJ_DEFAUT):
            continue
        formes = formes_du_nom(utilitaires.texte(p.get("nom")), utilitaires.texte(p.get("surnom")), mots=True, deja_connus=connus)
        precision = " · ".join(x for x in (utilitaires.texte(p.get("role")).strip(), noms_lieux.get(p.get("lieu"), "")) if x)
        fiches.append(("pnj", p, formes, precision))
    for l in lieux:
        if not l.get("connu") and l.get("id") and utilitaires.texte(l.get("nom")).strip():
            fiches.append(("lieu", l, formes_du_nom(utilitaires.texte(l.get("nom"))), utilitaires.texte(l.get("type")).strip()))
    homonymes = Counter((proprietes.auteur_de(f), genre, forme_simple(f.get("nom"))) for genre, f, _, _ in fiches)
    jumelles = Counter((proprietes.auteur_de(f), genre, forme_simple(f.get("nom")), forme_simple(pr)) for genre, f, _, pr in fiches)
    liste = []
    for genre, f, formes, precision in fiches:
        auteur = proprietes.auteur_de(f)
        secret = {"genre": genre, "nom": utilitaires.texte(f.get("nom")).strip(), "ids": [f["id"]]}
        if homonymes[(auteur, genre, forme_simple(f.get("nom")))] > 1:
            secret["precision"] = precision
            if not precision or jumelles[(auteur, genre, forme_simple(f.get("nom")), forme_simple(precision))] > 1:
                secret["ambigu"] = True
        if auteur != proprietes.PRINCIPAL:
            secret["auteur"] = auteur
        # Partagé avec l'autre MJ : il en lit le nom (cloisonnement.secret_vu), comme il lit la fiche.
        if proprietes.partagee("lieux" if genre == "lieu" else "pnj", f):
            secret["partage"] = True
        liste.append((secret, formes))
    # Un peuple caché que porte aussi, à visage découvert, un autre aventurier n'est plus un secret en soi.
    publics = {forme_simple(utilitaires.texte(a.get("peuple"))) for a in aventuriers if not a.get("peuple_cache")}
    peuples: dict = {}
    for a in aventuriers:
        if a.get("peuple_cache") and a.get("id") and forme_simple(utilitaires.texte(a.get("peuple"))) not in ("", *publics):
            g = peuples.setdefault(utilitaires.texte(a.get("peuple")).strip(), {"formes": set(), "ids": [], "de": []})
            g["formes"] |= formes_du_nom(utilitaires.texte(a.get("peuple")))
            g["ids"].append(a["id"])
            g["de"].append(utilitaires.texte(a.get("nom")))
    return liste + [({"genre": "peuple", "nom": nom, "ids": g["ids"], "de": g["de"]}, g["formes"])
                    for nom, g in peuples.items()]


@app.post("/api/masque")
async def verifier_masque(requete: Request):
    """Pour l'atelier : le texte tel qu'il partirait vers les joueurs, s'il contenait le nom caché de l'auberge, et les
    PNJ, lieux ou peuples encore inconnus des joueurs qu'il nomme (un avertissement : rien n'est bloqué)."""
    t = utilitaires.texte((await utilitaires.corps_objet(requete)).get("texte"))
    return {"texte": masquer(t), "trouve": contient_nom_cache(t), "secrets": cloisonnement.secrets_vus(secrets_dans(t, secrets_des_joueurs()))}


# Le nom que lisent les joueurs à la place du nom caché de l'auberge (masque.py) : « l'auberge » tant que le MJ n'en a pas
# choisi un autre (onglet Table, js/auberge/nom-auberge.js). Hors de /api/table/… : la table publique ne le lit ni ne l'écrit.
# Les noms cachés eux-mêmes viennent de data/noms-caches.json (masque.py).
NOM_AUBERGE = config.DONNEES / "nom-auberge.json"


def lire_nom_auberge() -> str:
    """Le nom choisi par le MJ, ou "" (le nom par défaut) ; un réglage illisible ou refusé compte pour rien."""
    try:
        reglage = utilitaires.lire(NOM_AUBERGE) if NOM_AUBERGE.exists() else {}
        return masque.nom_valide(reglage.get("nom") if isinstance(reglage, dict) else "")
    except (OSError, ValueError):
        return ""


masque.regler_nom_public(lire_nom_auberge())


def nom_auberge_atelier() -> dict:
    return {"nom": lire_nom_auberge(), "defaut": masque.NOM_PAR_DEFAUT, "public": masque.nom_public(),
            "exemples": masque.exemples_du_nom_public()}


@app.get("/api/nom-auberge")
def lire_nom_de_l_auberge():
    return nom_auberge_atelier()


@app.put("/api/nom-auberge")
async def changer_nom_de_l_auberge(requete: Request):
    try:
        nom = masque.nom_valide((await utilitaires.corps_objet(requete)).get("nom"))
    except ValueError as err:
        raise HTTPException(400, str(err))
    utilitaires.ecrire(NOM_AUBERGE, {"nom": nom, "modifie": utilitaires.maintenant()})
    masque.regler_nom_public(nom)
    # Le carnet des joueurs et coin.json portent le nom choisi : republiés tout de suite (la tâche de fond le ferait au
    # prochain passage, et réessaie si ceci échoue : le réglage compte parmi les sources du carnet).
    try:
        await asyncio.to_thread(carnet_api.publier_carnet)
    except Exception:  # noqa: BLE001 : le réglage est enregistré, le carnet suivra
        config.journal.exception("Carnet des joueurs non republié après le changement du nom de l'auberge")
    # Un PNJ ou un lieu encore inconnu nommé dans le nom choisi : l'atelier le dit, comme ailleurs (rien n'est bloqué).
    return nom_auberge_atelier() | {"secrets": cloisonnement.secrets_vus(secrets_dans(nom, secrets_des_joueurs())) if nom else []}


def erreur_modele(err: Exception) -> HTTPException:
    return HTTPException(503, f"Le serveur de textes ne répond pas ({err.__class__.__name__})")


@app.post("/api/precedemment/redaction")
async def redaction_precedemment(requete: Request):
    corps = {k: utilitaires.texte(v) for k, v in (await utilitaires.corps_objet(requete)).items()}
    if not any(corps.get(k, "").strip() for k in ("journal", "resume")):
        raise HTTPException(400, "Notez d'abord ce qui s'est passé (journal ou résumé)")
    try:
        return {"texte": await rediger_precedemment(corps)}
    except (httpx.HTTPError, ValueError) as err:
        raise erreur_modele(err)


@app.post("/api/aventurier/histoire")
async def histoire_aventurier(requete: Request):
    corps = await utilitaires.corps_objet(requete)
    if not any(utilitaires.texte(corps.get(k)).strip() for k in ("avant", "pourquoi", "jamais")):
        raise HTTPException(400, "Répondez d'abord aux questions de l'étape 1")
    try:
        return {"texte": await rediger_histoire(corps)}
    except (httpx.HTTPError, ValueError) as err:
        raise erreur_modele(err)


@app.post("/api/pnj-proposition")
async def proposition_pnj(requete: Request):
    corps = await utilitaires.corps_objet(requete)
    fiche = corps.get("fiche") if isinstance(corps.get("fiche"), dict) else {}
    try:
        return await proposer_pnj(fiche, utilitaires.texte(corps.get("idee")).strip())
    except (httpx.HTTPError, ValueError) as err:
        raise erreur_modele(err)


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import carnet_api  # noqa: E402
