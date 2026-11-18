"""Les réglages de l'écran de la table, les mains, les horloges et la musique."""

import asyncio
import hmac
import time

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from mj import adresses
from mj import cloisonnement
from table import horloges
from table import musique
from mj import proprietes
from commun import musique_coin
from commun import table_joueurs

from api.application import app


# Hors de /api/table/… : depuis Internet, la garde de la table publique la refuse.
@app.put("/api/table-joueurs")
async def changer_table_joueurs(requete: Request):
    corps = await utilitaires.corps_objet(requete)
    try:
        reglage = table_joueurs.changer(tv_etat.reglage_table_joueurs(), corps)
    except table_joueurs.Refus as refus:
        raise HTTPException(refus.statut, refus.message)
    reglage["modifie"] = utilitaires.maintenant()
    utilitaires.ecrire(tv_etat.TABLE_JOUEURS, reglage)
    # La musique au coin coupée, ou la table fermée : ce qui jouait au coin s'arrête.
    if not (reglage["ouverte"] and reglage["musique"]):
        musique_coin.effacer(config.PROPOSITIONS)
    return reglage | {"publie": await asyncio.to_thread(tv_etat.table_coin.tout_de_suite)}


def ecrans_branches() -> dict:
    # « ecrans » : ceux qui voient ce que le MJ envoie (le salon, et Internet si la table publique est ouverte).
    salon, internet = len(tv_etat.diffusion.salon), len(tv_etat.diffusion.internet)
    return {"ecrans": salon + (internet if tv_etat.table_publique()["ouverte"] else 0), "ecrans_salon": salon, "ecrans_internet": internet}


# Ce que GET /api/table ajoute à l'état : jamais enregistré, même renvoyé par un écran qui l'a relu.
CHAMPS_LUS = ("ecrans", "ecrans_salon", "ecrans_internet", "publique", "jetons")


def etat_table() -> dict:
    if not config.TABLE.exists():
        return {"vue": "accueil"}
    try:
        etat = utilitaires.lire(config.TABLE)
    except (OSError, ValueError):
        return {"vue": "accueil"}
    return etat if isinstance(etat, dict) else {"vue": "accueil"}


@app.get("/api/table")
def lire_table():
    etat = etat_table()
    for cle in CHAMPS_LUS:
        etat.pop(cle, None)
    main_ailleurs = main_de_l_autre(etat)
    etat.pop("par", None)
    etat = table_vue_par_le_lecteur(etat)
    # Pour l'onglet Table : l'adresse publiée, et la date qu'un écran d'Internet lit quand la table est fermée.
    publique = tv_etat.table_publique() | {"prochaine": tv_etat.prochaine_seance(), "adresse": portier.ADRESSE_PUBLIQUE}
    return etat | main_ailleurs | ecrans_branches() | {"publique": publique}


# La main sur la TV (lot MJ-4, adresses.py) : « par » dans l'état de la table, le compte qui y a envoyé ce qu'elle montre.
def main_de_l_autre(etat: dict) -> dict:
    """{"par", "par_nom"} quand un autre MJ que le lecteur a la main sur la TV, pour l'onglet Table et la télécommande ;
    rien sinon (sans invité, jamais)."""
    autre = adresses.tenant(etat)
    if autre == cloisonnement.destinataire():
        return {}
    nom = adresses.nom_ouvert(config.DONNEES, autre)
    return {"par": autre, "par_nom": nom} if nom else {}


def question_de_la_main(actuel: dict, reprendre: bool) -> JSONResponse | None:
    """La question « La reprendre ? » (409, adresses.question) quand un autre MJ ouvert a la main, sauf réponse déjà
    donnée (reprendre) ; sinon None."""
    tenant = adresses.tenant(actuel)
    if tenant == proprietes.compte_courant() or reprendre:
        return None
    nom = adresses.nom_ouvert(config.DONNEES, tenant)
    return JSONResponse(adresses.question(tenant, nom), status_code=409) if nom else None


def prendre_la_main(nouveau: dict, actuel: dict, reprendre: bool) -> JSONResponse | None:
    """Ce qu'un MJ envoie à la TV : s'il change ce qu'elle montre, la main passe à lui, après la question quand l'autre MJ
    l'avait ; un même écran (un cadrage, une version relue) la laisse où elle est, sauf à la reprendre expressément.
    Rend la réponse 409, ou None."""
    if adresses.vue_de(nouveau) == adresses.vue_de(actuel):
        adresses.poser_par(nouveau, proprietes.compte_courant() if reprendre else adresses.tenant(actuel))
        return None
    question = question_de_la_main(actuel, reprendre)
    if question is None:
        adresses.poser_par(nouveau, proprietes.compte_courant())
    return question


def table_vue_par_le_lecteur(etat: dict) -> dict:
    """L'état de la table pour le MJ qui lit (cloisonnement.py) : ses fiches sous leur identifiant, celles de l'autre MJ sous
    le jeton que reçoit la TV, ses seules horloges (celles de l'autre ne se voient qu'à la TV, quand il les y montre). Un
    invité n'en lit que la liste blanche de la TV (etat_public), ses fiches désignées en clair.
    « jetons » : les références données sous leur jeton. La page en lit le nom comme la TV (/api/table/…), jamais
    par les routes de l'atelier, qui répondraient 404. Absent quand il n'y en a pas : sans autre MJ, rien ne change."""
    if cloisonnement.est_invite() and cloisonnement.refuse("table-entiere"):
        vue = tv_etat.etat_public(etat)
        for cle, collection in tv_boutique_combat.REFS_TABLE.items():
            v = etat.get(cle)
            chemin = config.DONNEES / collection / f"{v}.json" if isinstance(v, str) and config.ID_VALIDE.match(v) else None
            # Les siennes, et celles que l'autre MJ partage avec lui (il les lit déjà entières).
            if chemin and chemin.is_file() and (cloisonnement.auteur_du_fichier(chemin) == cloisonnement.lecteur()
                                                or cloisonnement.partagee_par_un_autre(collection, chemin)):
                vue[cle] = v
        jetons = [cle for cle in tv_boutique_combat.REFS_TABLE if isinstance(vue.get(cle), str) and vue[cle] != etat.get(cle)]
        return vue | ({"jetons": jetons} if jetons else {})
    etat = dict(etat)
    jetons = []
    for cle, collection in tv_boutique_combat.REFS_TABLE.items():
        v = etat.get(cle)
        chemin = config.DONNEES / collection / f"{v}.json" if isinstance(v, str) and config.ID_VALIDE.match(v) else None
        if chemin and chemin.is_file() and not cloisonnement.permis_chemin(collection, chemin, lecture=True):
            etat[cle] = tv_cartes.jeton(collection, v)
            jetons.append(cle)
    if jetons:
        etat["jetons"] = jetons
    if isinstance(etat.get("horloges"), list):
        etat["horloges"] = [h for h in etat["horloges"] if not isinstance(h, dict) or horloge_au_lecteur(h)]
    return etat


def table_envoyee_par_un_mj(etat: dict, actuel: dict) -> None:
    """Ce qu'un MJ envoie à la TV ne désigne que ses fiches, celles que l'autre MJ partage, ou ce qu'elle montre déjà, qu'un invité ne connaît que par
    son jeton (celui de GET /api/table : il redevient ici l'identifiant). Une fiche de l'autre MJ : comme une fiche qui
    n'existe pas (404). Une fiche absente passe, comme avant : la TV n'en montre rien."""
    for cle, collection in tv_boutique_combat.REFS_TABLE.items():
        v = etat.get(cle)
        # Le bandeau du combat ne vient jamais de la page (CHAMPS_COMBAT_TABLE) : la route le reprend de l'état.
        if cle in tv_boutique_combat.CHAMPS_COMBAT_TABLE or not isinstance(v, str) or not config.ID_VALIDE.match(v):
            continue
        deja = actuel.get(cle)
        if (tv_cartes.JETON_VALIDE.match(v) and isinstance(deja, str) and config.ID_VALIDE.match(deja)
                and hmac.compare_digest(tv_cartes.jeton(collection, deja), v)):
            etat[cle] = deja
            continue
        chemin = config.DONNEES / collection / f"{v}.json"
        if chemin.is_file():
            # Montrer n'écrit rien dans la fiche : celle que l'autre MJ partage passe aussi.
            if not cloisonnement.permis_chemin(collection, chemin, lecture=True):
                raise HTTPException(404, "Introuvable")
        # Pour un MJ invité, une fiche absente (autre que celle que montre déjà la TV) est refusée comme celle de l'autre MJ :
        # sinon le seul refus dirait qu'une fiche du MJ principal porte l'identifiant essayé (les siens suivent les noms).
        elif v != deja and proprietes.a_auteur(collection) and cloisonnement.est_invite() \
                and cloisonnement.refuse("fiche-absente-a-la-tv", collection):
            raise HTTPException(404, "Introuvable")


@app.put("/api/table")
async def changer_table(requete: Request):
    etat = await utilitaires.corps_objet(requete)
    for cle in CHAMPS_LUS:
        etat.pop(cle, None)
    # La main sur la TV ne vient jamais de la page : la réponse à « La reprendre ? » seulement (prendre_la_main).
    reprendre = etat.pop("reprendre", None) is True
    etat.pop("par", None)
    etat.pop("par_nom", None)
    actuel = etat_table()
    for cle in tv_boutique_combat.CHAMPS_COMBAT_TABLE:
        etat.pop(cle, None)
        if cle in actuel:
            etat[cle] = actuel[cle]
    # De même, les horloges ne changent que par leurs routes (plus bas) : un écran qui renvoie la table les garde.
    etat.pop("horloges", None)
    if "horloges" in actuel:
        etat["horloges"] = actuel["horloges"]
    if cloisonnement.est_compte(cloisonnement.lecteur()):
        table_envoyee_par_un_mj(etat, actuel)
    question = prendre_la_main(etat, actuel, reprendre)
    if question is not None:
        return question
    etat["maj"] = time.time()
    # Un document que la TV va montrer : la première fois est notée, il entre au carnet des joueurs (documents.py).
    tv_fiches.remis.noter_montre(etat)
    utilitaires.ecrire(config.TABLE, etat)
    await tv_etat.diffusion.diffuser(etat)
    return {"ok": True} | ecrans_branches()


# Hors de /api/table/… : le tunnel ne la laisse pas passer, et la garde la refuse à qui vient d'Internet.
@app.put("/api/table-publique")
async def changer_table_publique(requete: Request):
    corps = await utilitaires.corps_objet(requete)
    if not isinstance(corps.get("ouverte"), bool):
        raise HTTPException(400, "Champ « ouverte » attendu : vrai ou faux")
    reglage = {"ouverte": corps["ouverte"], "modifie": utilitaires.maintenant()}
    utilitaires.ecrire(config.TABLE_OUVERTURE, reglage)
    # Les écrans d'Internet déjà branchés passent tout de suite à l'accueil, ou retrouvent la table.
    if tv_etat.diffusion.internet:
        await tv_etat.diffusion.envoyer(tv_etat.diffusion.internet, {"type": "etat", "etat": tv_etat.etat_internet(tv_etat.etat_public(etat_table()))})
    return reglage | ecrans_branches()


# Les horloges de la menace (horloges.py) : trois au plus, dans l'état de la table, changées seulement ici. Hors de
# /api/table/… : depuis Internet, la garde refuse ces chemins (rien des horloges cachées n'y passe).
def horloge_au_lecteur(h: dict) -> bool:
    """Une horloge du MJ qui lit (« auteur » ; absent : le principal). Celles de l'autre MJ ne se lisent qu'à la TV,
    quand il les y montre (horloges.publiques)."""
    return (h.get("auteur") or proprietes.PRINCIPAL) == cloisonnement.destinataire() or not cloisonnement.refuse("horloge-d-un-autre")


async def changer_horloges(geste, creation: bool = False) -> dict:
    """geste(liste) change une copie des horloges du MJ qui lit et rend l'identifiant de celle qu'il a touchée ; un refus
    de horloges.py devient l'erreur HTTP qu'il porte. La liste s'enregistre avec l'état de la table (celles de l'autre MJ
    restent telles quelles), et les écrans ne le relisent que si ce qu'ils montrent a changé (une horloge cachée qui
    avance ne les dérange pas). Rend les horloges du MJ, telles que son écran les affiche."""
    etat = etat_table()
    avant = horloges.de_l_etat(etat)
    autres = [h for h in avant if not horloge_au_lecteur(h)]
    liste = [dict(h) for h in avant if h not in autres]
    # Trois au plus par MJ : celles de l'autre ne comptent pas, et ne se devinent pas à un refus.
    try:
        touchee = geste(liste)
    except horloges.Refus as err:
        raise HTTPException(err.statut, str(err))
    if autres:
        # Les rangs de l'autre MJ comptent aussi : la TV montre les trois touchées en dernier, de l'un ou de l'autre. Un
        # identifiant tiré au sort qui serait déjà le sien se retire.
        h = next((x for x in liste if x["id"] == touchee), None)
        if h is not None:
            h["touchee"] = max(h["touchee"], 1 + max(x["touchee"] for x in autres))
            if creation and any(x["id"] == touchee for x in autres):
                h["id"] = touchee = horloges.nouvel_id(autres + liste)
    # L'ordre de la liste reste celui d'avant (la TV les montre dans cet ordre), les nouvelles à la fin.
    miens = {h["id"]: h for h in liste}
    entiere = [h if h in autres else miens.pop(h["id"]) for h in avant if h in autres or h["id"] in miens]
    entiere += [h for h in liste if h["id"] in miens]
    if entiere != avant:
        etat["horloges"] = entiere
        etat["maj"] = time.time()
        utilitaires.ecrire(config.TABLE, etat)
        if horloges.publiques(entiere) != horloges.publiques(avant):
            await tv_etat.diffusion.diffuser(etat)
    return {"horloges": liste, "horloge": touchee} | ecrans_branches()


@app.get("/api/horloges")
def horloges_lire():
    return {"horloges": [h for h in horloges.de_l_etat(etat_table()) if horloge_au_lecteur(h)]} | ecrans_branches()


def horloge_creee(liste: list, corps: dict) -> str:
    h = horloges.creer(liste, corps)
    if proprietes.compte_courant() != proprietes.PRINCIPAL:
        h["auteur"] = proprietes.compte_courant()
    return h["id"]


@app.post("/api/horloges")
async def horloges_creer(requete: Request):
    corps = await utilitaires.corps_objet(requete)
    return await changer_horloges(lambda liste: horloge_creee(liste, corps), creation=True)


@app.post("/api/horloges/avancer")
async def horloges_avancer(requete: Request):
    corps = await utilitaires.corps_objet(requete)
    return await changer_horloges(lambda liste: horloges.avancer(liste, corps)["id"])


@app.patch("/api/horloges/{ident}")
async def horloges_modifier(ident: str, requete: Request):
    corps = await utilitaires.corps_objet(requete)
    return await changer_horloges(lambda liste: horloges.modifier(liste, horloges.trouver(liste, ident), corps)["id"])


@app.delete("/api/horloges/{ident}")
async def horloges_supprimer(ident: str):
    return await changer_horloges(lambda liste: horloges.retirer(liste, ident))


# La musique de fond : la liste des ambiances (liens YouTube). Elle se joue sur l'ordinateur du MJ, pas sur la TV.
def lire_musique() -> dict:
    try:
        contenu = utilitaires.lire(config.MUSIQUE) if config.MUSIQUE.exists() else {}
    except (OSError, ValueError):
        contenu = {}
    if not isinstance(contenu, dict) or not isinstance(contenu.get("ambiances"), list):
        contenu = {"ambiances": [], "modifie": None}
    # L'ambiance jouée pendant les combats (musique-combat.js) : absente ou retirée de la liste, aucune.
    contenu["combat"] = musique.combat_retenu(contenu.get("combat"), contenu["ambiances"])
    # L'ambiance jouée quand la TV montre une boutique (musique-boutique.js), sur la même règle.
    contenu["boutique"] = musique.combat_retenu(contenu.get("boutique"), contenu["ambiances"])
    return contenu


@app.get("/api/musique")
def musique_lire():
    return lire_musique()


# Ce que joue le lecteur du MJ (musique.js), pour la table du coin (musique_coin.py) : la vidéo, sa position, joue ou en
# pause. Rien ne part quand la table du coin est fermée ou que le MJ a coupé sa musique au coin.
@app.put("/api/musique/ecoute")
async def musique_ecoute(requete: Request):
    corps = await utilitaires.corps_objet(requete)
    try:
        ecoute = musique_coin.valider(corps)
    except musique_coin.Refus as refus:
        raise HTTPException(refus.statut, refus.message)
    reglage = tv_etat.reglage_table_joueurs()
    if not (reglage["ouverte"] and reglage["musique"]):
        musique_coin.effacer(config.PROPOSITIONS)
        return {"publie": False}
    musique_coin.ecrire(config.PROPOSITIONS, ecoute)
    return {"publie": ecoute["etat"] != "arret"}


@app.put("/api/musique")
async def musique_changer(requete: Request):
    corps = await utilitaires.corps_objet(requete)
    actuel = lire_musique()
    if "version_base" in corps and corps["version_base"] != actuel.get("modifie"):
        raise HTTPException(409, "La liste de musique a été modifiée depuis un autre écran.")
    try:
        # Seul un réglage envoyé (combat, boutique) : la liste reste telle quelle, sans rien redemander à YouTube.
        seul_reglage = ("combat" in corps or "boutique" in corps) and "ambiances" not in corps
        ambiances = actuel["ambiances"] if seul_reglage else musique.nettoyer(corps.get("ambiances"), actuel["ambiances"])
        combat = (musique.nettoyer_combat(corps["combat"], ambiances) if "combat" in corps
                  else musique.combat_retenu(actuel.get("combat"), ambiances))
        boutique = (musique.nettoyer_boutique(corps["boutique"], ambiances) if "boutique" in corps
                    else musique.combat_retenu(actuel.get("boutique"), ambiances))
    except musique.LienInvalide as err:
        raise HTTPException(422, str(err))
    a_verifier = [a for a in ambiances if a.pop("verifier", False)]
    file = asyncio.Semaphore(6)

    async def verifier(a):
        async with file:
            return await musique.verifier({"video": a["video"], "liste": a["liste"]})

    for a, r in zip(a_verifier, await asyncio.gather(*(verifier(a) for a in a_verifier))):
        a.update(titre=r["titre"], auteur=r["auteur"], lisible=r["lisible"], raison=r.get("raison", ""))
    nouveau = {"ambiances": ambiances, "combat": combat, "boutique": boutique, "modifie": utilitaires.maintenant()}
    utilitaires.ecrire(config.MUSIQUE, nouveau)
    return nouveau


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import config, portier, utilitaires, tv_cartes, tv_fiches, tv_boutique_combat, tv_etat  # noqa: E402
