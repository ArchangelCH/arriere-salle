"""Les commandes des joueurs, la boîte des demandes et ce qui s'y branche."""

import asyncio
import hashlib

from fastapi import HTTPException, Request

from mj import adresses
from commun import bible
from commun import carnet
from mj import cloisonnement
from mj import comptes_mj
from commun import demandes
from commun import inventaire
from coin_mj import liens_joueurs
from mj import proprietes
from ia import redaction
from coin_mj.boite import Boite
from coin_mj.confie_mj import ConfieMJ
from coin_mj.lore_mj import LoreMJ
from coin_mj.sacs import Sacs
from coin_mj.salle import Salle
from table.masque import masquer, secrets_dans
from coin_mj.aide_mj import AideMJ, EXTRAITS_MAX as EXTRAITS_AIDE
from ia.illustrations import sans_adresse_ni_balise

from api.application import app
from api import config, utilitaires, heros_etat, joueurs_mj, carnet_api


# Les commandes passées depuis l'échoppe du coin des joueurs (carnet.py) : le MJ les lit d'après ses boutiques
# d'aujourd'hui, puis vend (l'or quitte la bourse du héros, les articles entrent dans son sac, le stock baisse) ou
# refuse avec un mot. Une commande ne change plus une fois passée : le joueur la retire, ou en passe une autre.

def analyser_commande(c: dict, b: dict | None) -> tuple[list, int | None, list]:
    """Les lignes d'une commande face à la boutique : chacune avec son prix ajusté d'aujourd'hui, le total (None si un
    prix est à fixer), et ce qui empêche la vente (article retiré, caché, épuisé, stock trop court)."""
    if b is None:
        return [], None, ["cette boutique n'existe plus"]
    ajustement = tv_boutique_combat.ajustement_boutique(b)
    articles = {a.get("id"): a for a in b.get("articles") or [] if isinstance(a, dict) and isinstance(a.get("id"), str)}
    lignes, refus, total = [], [], 0
    for ligne in c.get("lignes") or []:
        if not isinstance(ligne, dict):
            continue
        q = ligne.get("quantite")
        q = q if isinstance(q, int) and not isinstance(q, bool) and 1 <= q <= carnet.QUANTITE_MAX else 0
        ident = ligne.get("article") if isinstance(ligne.get("article"), str) else ""
        a = articles.get(ident) if carnet.ARTICLE.match(ident) else None
        vue = {"article": ident, "nom": " ".join(utilitaires.texte((a or ligne).get("nom")).split()), "quantite": q, "prix": "", "montant": None, "probleme": ""}
        if not q:
            vue["probleme"] = "quantité invalide"
        elif a is None or not utilitaires.texte(a.get("nom")).strip():
            vue["probleme"] = "n'est plus en vente"
        elif a.get("cache"):
            vue["probleme"] = "caché aux joueurs"
        else:
            stock = a.get("stock")
            if isinstance(stock, (int, float)) and not isinstance(stock, bool) and stock < q:
                vue["probleme"] = "épuisé" if stock <= 0 else f"il n'en reste que {int(stock)}"
            vue["prix"] = tv_boutique_combat.prix_ajuste(utilitaires.texte(a.get("prix")), ajustement)
            m = carnet.montant_du_prix(vue["prix"])
            vue["montant"] = None if m is None else m * q
        if vue["probleme"]:
            refus.append(f"« {vue['nom'] or 'un article'} » : {vue['probleme']}")
        total = None if total is None or vue["montant"] is None else total + vue["montant"]
        lignes.append(vue)
    if not lignes:
        refus.append("la commande est vide")
    return lignes, total, refus


def commande_vue(j: dict, c: dict, a: dict | None, b: dict | None) -> dict:
    lignes, total, refus = analyser_commande(c, b)
    bourse = (heros_etat.sac_de(a, "or") or 0) if a else None
    attente = c.get("statut") == "en-attente"
    if attente and not a:
        refus.append(f"{j.get('nom')} n'a pas de héros à la tablée")
    elif attente and total is not None and total > bourse:
        refus.append(f"{utilitaires.texte(a.get('nom')).split(' ')[0]} n'a que {bourse} po pour {total}")
    return {"id": c["id"], "joueur": j["id"], "joueur_nom": j.get("nom", ""), "statut": c.get("statut"),
            "heros": {"id": a["id"], "nom": utilitaires.texte(a.get("nom")), "or": bourse} if a else None,
            "boutique": {"id": b["id"], "nom": utilitaires.texte(b.get("nom"))} if b else None, "boutique_nom": utilitaires.texte(c.get("boutique_nom")),
            "lignes": lignes, "total": total, "refus": refus if attente else [], "cree": c.get("cree"), "traitee": c.get("traitee"),
            "montant": c.get("montant"), "mot": utilitaires.texte(c.get("mot"))}


def boutiques_par_jeton() -> dict:
    return {tv_cartes.jeton("boutiques", b["id"]): b for b in utilitaires.lire_tout(config.BOUTIQUES, tout=True) if isinstance(b.get("id"), str) and config.ID_VALIDE.match(b["id"])}


@app.get("/api/commandes")
def liste_commandes():
    """Les commandes en attente (les plus anciennes d'abord), puis les vingt dernières traitées."""
    boutiques = boutiques_par_jeton()
    aventuriers = {a["id"]: a for a in utilitaires.lire_tout(config.AVENTURIERS) if isinstance(a.get("id"), str)}
    vues, liens = [], carnet_api.heros_des_joueurs(aventuriers)
    for j in joueurs_mj.joueurs_lus():
        a = liens.get(j["id"])
        for c in carnet.lire_commandes(config.PROPOSITIONS, j["id"]):
            # Chaque MJ, les commandes de ses boutiques.
            if commande_au_lecteur(c):
                vues.append(commande_vue(j, c, a, boutiques.get(c.get("boutique"))))
    attente = sorted((v for v in vues if v["statut"] == "en-attente"), key=lambda v: utilitaires.texte(v["cree"]))
    traitees = sorted((v for v in vues if v["statut"] != "en-attente"), key=lambda v: utilitaires.texte(v["traitee"]), reverse=True)
    return attente + traitees[:20]


def commande_du_joueur(joueur: str, ident: str) -> tuple[dict, list, dict]:
    """(joueur, ses commandes, la commande en attente visée) ; à appeler sous le verrou des commandes."""
    _, j = joueurs_mj.joueur_invite(joueur)
    commandes = carnet.lire_commandes(config.PROPOSITIONS, joueur) if carnet.ID_COMMANDE.match(ident) else []
    c = next((x for x in commandes if x["id"] == ident), None)
    # Celle d'une boutique de l'autre MJ : comme une commande qui n'existe pas.
    if not c or not commande_au_lecteur(c):
        raise HTTPException(404, "Cette commande n'existe plus : le joueur l'a peut-être retirée.")
    if c.get("statut") != "en-attente":
        raise HTTPException(409, "Cette commande a déjà été traitée.")
    return j, commandes, c


def ligne_du_sac(nom: str, quantite: int) -> str:
    """La ligne qu'un article vendu en quantite exemplaires écrit dans le sac : « Torche ×2 ». Un article qui se vend
    déjà par lot (« Flèches ×20 ») compte ses lots (deux lots : « Flèches ×40 »)."""
    nom = nom[:heros_etat.SAC_LIGNE_MAX - 5]
    if inventaire.douteuse(nom):
        return nom if quantite == 1 else f"{nom} ×{quantite}"
    seul, lot = inventaire.quantite_de(nom)
    if lot * quantite > inventaire.QUANTITE_MAX:
        return nom if quantite == 1 else f"{nom} ×{quantite}"
    return inventaire.ligne(seul, lot * quantite)


def vendre_la_commande(joueur: str, ident: str, montant) -> dict:
    """La vente, d'un bloc et sous le verrou : tout est vérifié avant la moindre écriture. L'or quitte la bourse (le
    montant tapé par le MJ, sinon le total des prix), chaque article entre dans l'équipement comme pour « Vendre à… »,
    le stock baisse, la commande passe à « vendue »."""
    # Le verrou du sac aussi : la boîte (un don d'or accepté, un geste du joueur) écrit la même fiche dans un autre fil, et
    # l'une des deux écritures effacerait l'autre (l'or donné resterait des deux côtés).
    with carnet.verrou(config.PROPOSITIONS), heros_etat.SAC_VERROU:
        j, commandes, c = commande_du_joueur(joueur, ident)
        boutiques = boutiques_par_jeton()
        b = boutiques.get(c.get("boutique"))
        lignes, total, refus = analyser_commande(c, b)
        if refus:
            raise HTTPException(409, f"Vente impossible : {' ; '.join(refus)}.")
        if montant is None:
            if total is None:
                raise HTTPException(400, "Un prix est à fixer : indiquez le montant payé.")
            montant = total
        if isinstance(montant, (int, float)) and not isinstance(montant, bool) and montant < 0:
            raise HTTPException(400, "Le montant payé ne peut pas être négatif.")
        montant = heros_etat.entier_borne("montant", montant, 0, heros_etat.OR_MAX)
        a = carnet_api.heros_du_joueur(joueur)
        if not a:
            raise HTTPException(409, f"{j['nom']} n'a pas de héros à la tablée : rien à lui vendre.")
        chemin = utilitaires.existant(config.AVENTURIERS, a["id"])
        fiche = utilitaires.lire_fiche(chemin)
        qui = utilitaires.texte(fiche.get("nom")).split(" ")[0] or "Ce héros"
        bourse = heros_etat.sac_de(fiche, "or") or 0
        if montant > bourse:
            raise HTTPException(409, f"{qui} n'a que {bourse} po : il en faut {montant}." if bourse else f"{qui} n'a pas d'or : il en faut {montant}.")
        equipement = heros_etat.sac_de(fiche, "equipement")
        try:
            for ligne in lignes:
                # Déjà dans le sac : la quantité de sa ligne monte (inventaire.avec), sinon une ligne « Nom ×N ».
                equipement = inventaire.avec(equipement, ligne_du_sac(ligne["nom"], ligne["quantite"]))
        except demandes.Refus as refus:
            if refus.message == inventaire.SAC_PLEIN:
                raise HTTPException(409, f"Le sac de {qui} est plein : faites-y de la place d'abord.")
            raise HTTPException(409, f"Vente impossible : {refus.message}")
        if len(equipement) > heros_etat.SAC_LIGNES_MAX:
            raise HTTPException(409, f"Le sac de {qui} est plein : faites-y de la place d'abord.")
        utilitaires.archiver(chemin, "aventuriers")
        if montant:
            fiche["or"] = bourse - montant
        fiche["equipement"] = equipement
        fiche["modifie"] = utilitaires.maintenant()
        utilitaires.ecrire(chemin, fiche)
        quantites = {ligne["article"]: ligne["quantite"] for ligne in lignes}
        comptes = [x for x in b.get("articles") or [] if isinstance(x, dict) and x.get("id") in quantites
                   and isinstance(x.get("stock"), (int, float)) and not isinstance(x.get("stock"), bool)]
        if comptes:
            chemin_b = utilitaires.existant(config.BOUTIQUES, b["id"], tout=True)
            utilitaires.archiver(chemin_b, "boutiques")
            for x in comptes:
                x["stock"] = max(0, int(x["stock"]) - quantites[x["id"]])
            b["modifie"] = utilitaires.maintenant()
            utilitaires.ecrire(chemin_b, b)
        c.update(statut="vendue", montant=montant, heros=utilitaires.texte(fiche.get("nom")), traitee=utilitaires.maintenant())
        carnet.ecrire_commandes(config.PROPOSITIONS, joueur, commandes)
    carnet_api.publier_carnet()
    return {"commande": commande_vue(j, c, fiche, b), "heros": {"id": fiche["id"], "nom": utilitaires.texte(fiche.get("nom")), "or": heros_etat.sac_de(fiche, "or")},
            "boutique": b if comptes else None}


@app.post("/api/commandes/{joueur}/{ident}/vendre")
async def vendre_commande(joueur: str, ident: str, requete: Request):
    montant = (await utilitaires.corps_objet(requete)).get("montant")
    return await asyncio.to_thread(vendre_la_commande, joueur, ident, montant)


@app.post("/api/commandes/{joueur}/{ident}/refuser")
async def refuser_commande(joueur: str, ident: str, requete: Request):
    # Le mot du MJ part vers le joueur : il passe au masque comme tout ce que lisent les joueurs.
    mot = masquer(" ".join(utilitaires.texte((await utilitaires.corps_objet(requete)).get("mot")).split())[:carnet.MOT_MAX])

    def refuser():
        with carnet.verrou(config.PROPOSITIONS):
            j, commandes, c = commande_du_joueur(joueur, ident)
            c.update(statut="refusee", mot=mot, traitee=utilitaires.maintenant())
            carnet.ecrire_commandes(config.PROPOSITIONS, joueur, commandes)
            return commande_vue(j, c, None, boutiques_par_jeton().get(c.get("boutique")))
    return await asyncio.to_thread(refuser)


# Les demandes des joueurs (demandes.py) et la boîte du MJ (boite.py) : la file que le coin écrit, surveillée par une
# tâche du cycle ; la pastille « Demandes » de l'en-tête et la page #/demandes ; les notifications Telegram (telegram.py).

def mot_pour_le_coin(mot: str) -> str:
    """Le mot du MJ qui répond, accepte ou refuse part vers le joueur : il passe au masque (le nom caché de l'auberge),
    puis à retenir. Un mot qui nomme un inconnu des joueurs ne part pas : le MJ le retouche."""
    propre = masquer(demandes.texte_propre(mot, demandes.MOT_MAX, "Votre mot"))
    candidats, retenus = noms_caches.secrets_des_joueurs(), []
    if propre and carnet_api.retenir({"mot": propre}, "mot", ("Votre mot", False), candidats, retenus) is None:
        raise demandes.Refus(409, f"Ce mot nomme {carnet_api.noms_secrets(secrets_dans(propre, candidats))} : retouchez-le avant de l'envoyer.")
    return propre


async def signaler_demandes(message: dict, pour: str | None = None) -> None:
    """La boîte a changé : les pages de l'atelier relisent (pastille, page #/demandes). Ni la TV ni la table publique ne
    reçoivent ce signal (modèle : signaler_combat) ; pour : le seul MJ que le message concerne (lot MJ-4)."""
    if tv_etat.diffusion.atelier:
        await tv_etat.diffusion.vers_atelier(message, pour)


def destinataire_commande(c: dict) -> str:
    """Une commande à l'échoppe revient à l'auteur de la boutique."""
    b = boutiques_par_jeton().get(c.get("boutique")) if isinstance(c, dict) else None
    return proprietes.auteur_de(b) if b else proprietes.PRINCIPAL


def commande_au_lecteur(c: dict) -> bool:
    return destinataire_commande(c) == cloisonnement.destinataire() or not cloisonnement.refuse("commande-d-un-autre")


boite = Boite(config.PROPOSITIONS, config.DONNEES, joueurs_lus=joueurs_mj.joueurs_lus, nettoyer_mot=mot_pour_le_coin, signaler=signaler_demandes,
              comptes=lambda: adresses.ouverts(config.DONNEES), connus=lambda: adresses.connus(config.DONNEES),
              fichier_comptes=comptes_mj.chemin(config.DONNEES))
boite.adresser_commandes(destinataire_commande)
app.include_router(boite.routes(utilitaires.corps_objet))


# L'inventaire des joueurs (inventaire.py, sacs.py) : les gestes du sac et les dons, rejoués par la route du sac ; le
# Tableau et « La compagnie » relisent les sacs touchés à leur message {"type": "sac"} (ni la TV ni la table publique).
async def signaler_sacs(message: dict) -> None:
    # Les sacs des héros sont communs aux deux MJ : toutes les pages.
    if tv_etat.diffusion.atelier:
        await tv_etat.diffusion.vers_atelier(message)


sacs = Sacs(config.DONNEES, sac_de=heros_etat.sac_de, changer=heros_etat.changer_les_sacs, heros_du_joueur=lambda ident: carnet_api.heros_du_joueur(ident),
            tablee=lambda: [a for a in tv_fiches.tablee_des_aventuriers() if liens_joueurs.nom_de(a)], ref=carnet_api.ref_compagnon,
            candidats=lambda: noms_caches.secrets_des_joueurs(), noms_secrets=carnet_api.noms_secrets, publier=lambda ids: carnet_api.publier_heros(ids),
            carnet_ouvert=lambda: carnet_api.carnet_ouvert(), signaler=signaler_sacs)
sacs.brancher(boite)
# Les mains levées depuis le coin (main_levee.py) et qui y est connecté (presence.py), vues par le Tableau, la
# télécommande et l'en-tête de l'atelier (salle.py). Seules les pages de l'atelier reçoivent la salle.

def heros_pour_la_salle() -> dict:
    return {j: {"id": a["id"], "nom": liens_joueurs.nom_de(a)} for j, a in carnet_api.heros_des_joueurs().items()}


salle = Salle(config.PROPOSITIONS, joueurs_lus=joueurs_mj.joueurs_lus, heros_lus=heros_pour_la_salle, signaler=signaler_demandes)
app.include_router(salle.routes(utilitaires.corps_objet))
# Le lore du personnage (lore.py, lore_mj.py) : l'histoire qu'un joueur propose depuis le coin, que la boîte ouvre sur la
# comparaison passage par passage ; ce qui est accepté s'écrit dans la fiche, puis « Mon héros » est republié.
histoires = LoreMJ(config.PROPOSITIONS, heros_du_joueur=lambda ident: carnet_api.heros_du_joueur(ident), ref=carnet_api.ref_compagnon, projection=carnet_api.recit_publie,
                   candidats=lambda: noms_caches.secrets_des_joueurs(), ecrire_recit=carnet_api.ecrire_recit, publier=lambda ids: carnet_api.publier_heros(ids))
histoires.brancher(boite)
app.include_router(histoires.routes())
# « Pour le MJ seulement » (confie.py, confie_mj.py) : ce qu'un joueur confie au MJ seul, déposé sans validation sur la fiche
# de son héros (confie_au_mj), lu dans la page « Pour le MJ » de la fiche ; la boîte le signale, sans le texte.
confidences = ConfieMJ(config.PROPOSITIONS, heros_du_joueur=lambda ident: carnet_api.heros_du_joueur(ident), ref=carnet_api.ref_compagnon,
                       chemin_heros=lambda ident: utilitaires.existant(config.AVENTURIERS, ident), lire=utilitaires.lire_fiche, ecrire=utilitaires.ecrire, verrou=heros_etat.SAC_VERROU,
                       maintenant=utilitaires.maintenant)
confidences.brancher(boite)
app.include_router(confidences.routes(utilitaires.corps_objet))


def contexte_aide_joueurs() -> list[dict]:
    # Gardés cinq minutes : un joueur qui écrit demande souvent deux ou trois aides de suite, rarement une par heure.
    return [contexte_du_modele.bloc_texte(masquer(contexte_du_modele.canon_leger()), "5m"), contexte_du_modele.bloc_texte(contexte_du_modele.etat_campagne_public(joueurs=True), "5m")]


def extraits_bible_joueurs(requete: str) -> str:
    cat = bible.pour_les_joueurs(bible.catalogue(bible_api.LORE))

    def lire_ouvert(relatif: str):
        return bible_api.lecture(bible_api.LORE / relatif)[1:] if bible.ouvert_aux_joueurs(relatif) else None

    return masquer(ia_api.extraits_bible(requete, plafond=EXTRAITS_AIDE, chercher=lambda mot: bible.chercher(cat, mot, lire_ouvert, limite=4)))


def fiche_pour_l_aide(j: dict) -> dict | None:
    """« Mon héros » tel que le carnet le publie pour ce joueur (au masque, sans ce qui nomme un inconnu)."""
    if not isinstance(j.get("jeton"), str):
        return None
    return carnet.heros_publie(config.PROPOSITIONS, hashlib.sha256(j["jeton"].encode()).hexdigest())


def secrets_pour_le_joueur(j: dict) -> list:
    """Ce que ce joueur ne sait pas : son propre peuple, même gardé secret, n'en est pas un pour lui."""
    a = carnet_api.heros_du_joueur(j["id"])
    aid = a.get("id") if a else None
    return [(s, f) for s, f in noms_caches.secrets_des_joueurs() if not (s.get("genre") == "peuple" and aid in s.get("ids", []))]


aides_joueurs = AideMJ(config.PROPOSITIONS, config.DONNEES, joueurs_lus=joueurs_mj.joueurs_lus, fiche_publiee=fiche_pour_l_aide,
                       contexte=contexte_aide_joueurs, extraits=extraits_bible_joueurs, candidats=secrets_pour_le_joueur,
                       carnet_ouvert=lambda: carnet_api.carnet_ouvert(), finir=lambda t: ia_api.finir_texte(t), sans_balise=sans_adresse_ni_balise)
aides_joueurs.brancher(boite)
app.include_router(aides_joueurs.routes(utilitaires.corps_objet))
redaction.regler_noms_qui(lambda: {j["id"]: str(j.get("nom") or "") for j in joueurs_mj.joueurs_lus() if isinstance(j, dict) and isinstance(j.get("id"), str)})


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import noms_caches, bible_api, tv_cartes, tv_fiches, tv_boutique_combat, tv_etat, contexte_du_modele, ia_api  # noqa: E402
