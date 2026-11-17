"""Les joueurs du coin vus de l'atelier : invitation, mots de passe, liens avec les héros."""

import asyncio
import hashlib
import re
import secrets
import threading
from urllib.parse import urlsplit

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

from commun import acces
from commun import bible
from commun import carnet
from commun import comptes
from commun import confie
from commun import confort
from table import couleurs_tv
from commun import demandes
from coin_mj import liens_joueurs
from commun import lore
from commun import provisoires
from table.masque import masquer

from api.application import app


# Le coin des joueurs. Chaque joueur invité a un jeton, tiré ici ; seule son empreinte part dans le dossier des
# propositions, que lit le service public. Le jeton lui-même ne quitte pas l'atelier, et n'ouvre plus rien depuis les
# mots de passe provisoires : il ne sert qu'à ranger, sous une clé tirée de lui, ce que le coin publie pour ce joueur.

def joueurs_lus() -> list:
    try:
        liste = utilitaires.lire(config.JOUEURS)
    except (OSError, ValueError):
        return []
    return liste if isinstance(liste, list) else []


# Une écriture de joueurs.json à la fois, de la lecture à l'écriture : « Retirer » (un fil) ne passe plus entre la lecture
# et l'écriture d'une invitation ou d'un lien (la boucle), et l'un n'efface plus l'autre. Rien d'attendu dessous.
VERROU_JOUEURS = threading.RLock()


def ecrire_joueurs_sous_verrou(liste: list) -> None:
    utilitaires.ecrire(config.JOUEURS, liste)
    config.JOUEURS.chmod(0o600)
    acces = [{"id": j["id"], "nom": j["nom"], "jeton": hashlib.sha256(j["jeton"].encode()).hexdigest(), **relie_pour_le_coin(j)}
             for j in liste]
    utilitaires.ecrire(config.PROPOSITIONS / ".acces.json", {"joueurs": acces})


def relie_pour_le_coin(j: dict) -> dict:
    """Ce que le coin des joueurs apprend d'un héros relié depuis l'atelier (liens_joueurs.py) : le créateur du joueur se
    ferme et dit qui l'attend à la tablée. Le nom passe au masque, comme tout ce que lisent les joueurs."""
    aid = liens_joueurs.heros_relie(j)
    if not aid:
        return {}
    try:
        a = utilitaires.lire(config.AVENTURIERS / f"{aid}.json")
    except (OSError, ValueError):
        a = {}
    # Une autre fiche venue depuis sous le même identifiant ne lui donne pas son nom.
    a = a if liens_joueurs.meme_heros(j, a) else {}
    return {"relie": {"nom": masquer(liens_joueurs.nom_de(a)), "genre": a.get("genre") if a.get("genre") in ("h", "f") else "",
                      "le": utilitaires.texte(j.get("relie_le"))}}


def proposition(ident: str) -> dict:
    try:
        p = utilitaires.lire(config.PROPOSITIONS / f"{ident}.json")
    except (OSError, ValueError):
        return {}
    return p if isinstance(p, dict) else {}


def etat_joueur(j: dict, liens: dict | None = None, aventuriers: dict | None = None) -> dict:
    p = proposition(j["id"])
    # Lue telle qu'elle est sur le disque : une valeur d'un type inattendu ne casse pas la liste des joueurs.
    a = p.get("aventurier") if isinstance(p.get("aventurier"), dict) else {}
    if aventuriers is None:
        aventuriers = carnet_api.tous_les_aventuriers()
    liens = carnet_api.heros_des_joueurs(aventuriers) if liens is None else liens
    heros, relie = liens.get(j["id"]), liens_joueurs.heros_relie(j)
    if relie:
        # Relié depuis l'atelier : la carte parle du héros de la tablée, pas d'un brouillon resté de côté ; ni d'une autre
        # fiche venue sous son identifiant après lui (« relie-perdu » : la carte le dit et garde « Défaire le lien »).
        a = aventuriers.get(relie) if liens_joueurs.meme_heros(j, aventuriers.get(relie)) else {}
        etat, relie = ("relie", a["id"]) if a else ("relie-perdu", None)
    elif p.get("accueilli"):
        etat = "accueilli"
    elif p.get("envoye"):
        etat = "envoye" if p.get("version_envoyee") == a.get("modifie") else "retouche"
    else:
        etat = "en-cours" if a else "invite"
    vocations = a.get("vocations") if isinstance(a.get("vocations"), list) else []
    couleur = utilitaires.texte(a.get("couleur"))
    return {"id": j["id"], "nom": j["nom"], "cree": j.get("cree"), "etat": etat,
            "couleur": couleur, "couleur_tv": couleur_a_l_accueil(couleur, aventuriers) if etat in ("envoye", "retouche") else None,
            "aventurier": utilitaires.texte(a.get("nom")), "vocations": [v for v in vocations if isinstance(v, str)], "peuple": utilitaires.texte(a.get("peuple")),
            "genre": utilitaires.texte(a.get("genre")), "specialite": utilitaires.texte(a.get("specialite")), "element": utilitaires.texte(a.get("element")),
            "modifie": a.get("modifie"), "envoye_le": p.get("envoye_le"),
            "accueilli": relie if etat.startswith("relie") else p.get("accueilli"),
            "relie": etat.startswith("relie"), "heros": {"id": heros["id"], "nom": liens_joueurs.nom_de(heros)} if heros else None,
            **compte_pour_le_mj(j)}


def compte_pour_le_mj(j: dict) -> dict:
    """Son compte du coin (comptes.py) et son mot de passe provisoire en attente (provisoires.py), lus sans y écrire :
    l'identifiant et les dates, jamais d'empreinte ni le provisoire. Sans rien encore, l'identifiant que proposera
    « Créer son compte » : son prénom en forme simple."""
    compte = provisoires.pour_le_mj(config.PROPOSITIONS, j["id"], hashlib.sha256(j["jeton"].encode()).hexdigest())
    return {"compte": compte, "identifiant_propose": "" if compte else provisoires.identifiant_propose(config.PROPOSITIONS, j["id"], j["nom"])}


def couleur_a_l_accueil(couleur: str, aventuriers: dict) -> dict | None:
    """Ce que la TV fera de la couleur d'un aventurier envoyé s'il est accueilli maintenant (couleurs_tv.py) : il arrive
    après toute la tablée. « comme » nomme le héros dont la couleur est trop proche, avec son joueur (E06)."""
    tous = sorted((a for a in aventuriers.values() if a.get("id")), key=lambda a: utilitaires.texte(a.get("cree")))
    avis = couleurs_tv.pour_un_nouveau([a for a in tous if a.get("tablee") is not False], couleur, [a for a in tous if a.get("tablee") is False])
    if avis and avis["comme"]:
        autre = aventuriers.get(avis["comme"]) or {}
        joueur = " ".join(utilitaires.texte(autre.get("joueur")).split())
        avis["comme"] = f"{liens_joueurs.nom_de(autre) or 'un autre héros'}{f' ({joueur})' if joueur else ''}"
    return avis


def joueur_invite(ident: str) -> tuple[list, dict]:
    liste = joueurs_lus()
    j = next((x for x in liste if x["id"] == ident), None)
    if not j:
        raise HTTPException(404, "Joueur inconnu")
    return liste, j


@app.get("/api/joueurs")
def liste_joueurs():
    aventuriers = carnet_api.tous_les_aventuriers()
    liens = carnet_api.heros_des_joueurs(aventuriers)
    joueurs = joueurs_lus()
    # Un provisoire qui a servi n'a plus rien à garder (provisoires.py) : effacé quand le MJ revoit ses joueurs.
    provisoires.ranger(config.PROPOSITIONS, [j["id"] for j in joueurs])
    return [etat_joueur(j, liens, aventuriers) for j in joueurs]


@app.post("/api/joueurs")
async def inviter_joueur(requete: Request):
    nom = utilitaires.texte((await utilitaires.corps_objet(requete)).get("nom")).strip()[:60]
    if not nom:
        raise HTTPException(400, "Le prénom du joueur, s'il vous plaît")
    with VERROU_JOUEURS:
        liste = joueurs_lus()
        base = utilitaires.slug(nom)
        ident = base
        # Ni l'identifiant d'un joueur retiré dont il resterait la proposition, des commandes, des limites ou un compte :
        # le nouveau n'en hérite pas.
        while (any(j["id"] == ident for j in liste) or (config.PROPOSITIONS / f"{ident}.json").exists()
               or (config.PROPOSITIONS / carnet.COMMANDES / f"{ident}.json").exists()
               or (config.PROPOSITIONS / confort.DOSSIER / f"{ident}.json").exists()
               or (config.PROPOSITIONS / comptes.DOSSIER / f"{ident}.json").exists()
               or (config.PROPOSITIONS / provisoires.DOSSIER / f"{ident}.json").exists()
               or (config.PROPOSITIONS / demandes.DOSSIER / f"{ident}.json").exists()):
            ident = f"{base}-{secrets.token_hex(2)}"
        j = {"id": ident, "nom": nom, "jeton": secrets.token_urlsafe(18), "cree": utilitaires.maintenant()}
        ecrire_joueurs_sous_verrou(liste + [j])
    return etat_joueur(j)


@app.post("/api/joueurs/{ident}/provisoire")
async def provisoire_du_joueur(ident: str, requete: Request):
    """« Créer son compte », ou « Nouveau mot de passe provisoire » (provisoires.py) : le serveur tire un mot de passe à
    dicter et n'en garde que l'empreinte. Il n'est rendu qu'ici, une fois, avec la phrase à transmettre au joueur ; jamais
    dans une autre réponse ni un journal. Dès qu'il est écrit, l'ancien mot de passe et toutes les sessions du joueur
    tombent. L'identifiant, choisi par le MJ à la création, ne change plus ensuite."""
    corps = await utilitaires.corps_objet(requete)
    _, j = joueur_invite(ident)
    try:
        # Vérifié avant le calcul (une faute de frappe répond tout de suite), puis de nouveau sous le verrou.
        provisoires.identifiant_pour(config.PROPOSITIONS, j["id"], corps.get("identifiant"))
        mot = provisoires.tirer()
        empreinte = await acces.calculer(acces.empreinte, provisoires.canonique(mot))
        p = await asyncio.to_thread(provisoires.poser, config.PROPOSITIONS, j["id"], corps.get("identifiant"), empreinte)
    except comptes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)
    adresse = urlsplit(config.LIEN_JOUEURS).netloc or config.LIEN_JOUEURS
    return JSONResponse({**etat_joueur(j), "provisoire": mot, "adresse": adresse,
                         "phrase": f"Va sur {adresse}, identifiant {p['identifiant']}, mot de passe provisoire {mot}"},
                        headers={"Cache-Control": "no-store"})


@app.delete("/api/joueurs/{ident}")
def retirer_joueur(ident: str):
    with VERROU_JOUEURS:
        liste, j = joueur_invite(ident)
        ecrire_joueurs_sous_verrou([x for x in liste if x["id"] != ident])
    chemin = config.PROPOSITIONS / f"{ident}.json"
    if chemin.exists():
        utilitaires.jeter(chemin, "propositions")
    # Ses commandes partent avec lui, sous le verrou que tient aussi le coin des joueurs.
    with carnet.verrou(config.PROPOSITIONS):
        commandes = config.PROPOSITIONS / carnet.COMMANDES / f"{ident}.json"
        if commandes.exists():
            utilitaires.jeter(commandes, "commandes")
    # Ses demandes aussi, sous le verrou de la file.
    with demandes.verrou(config.PROPOSITIONS):
        sa_file = config.PROPOSITIONS / demandes.DOSSIER / f"{ident}.json"
        if sa_file.exists():
            utilitaires.jeter(sa_file, "demandes")
    confort.oublier(config.PROPOSITIONS, ident)
    # Le brouillon de son histoire (lore.py), sous le verrou que tient le coin.
    with lore.verrou(config.PROPOSITIONS):
        brouillon = lore.fichier(config.PROPOSITIONS, ident)
        if brouillon.exists():
            utilitaires.jeter(brouillon, "lore")
    # Ce qu'il confiait au MJ (confie.py) : son brouillon de même, et le reçu publié pour lui.
    with confie.verrou(config.PROPOSITIONS):
        brouillon = confie.fichier(config.PROPOSITIONS, ident)
        if brouillon.exists():
            utilitaires.jeter(brouillon, "confie")
    confie.oublier(config.PROPOSITIONS, ident)
    # Son compte est fermé : ni empreinte ni lien n'y restent, son identifiant ne resert plus (comptes.py). Son mot de
    # passe provisoire, s'il en attendait un, s'efface aussi.
    comptes.fermer(config.PROPOSITIONS, ident)
    provisoires.effacer(config.PROPOSITIONS, ident)
    return {"ok": True}


@app.post("/api/joueurs/{ident}/accueillir")
async def accueillir_joueur(ident: str, requete: Request):
    """L'aventurier envoyé par le joueur entre dans l'atelier (et la tablée) ; côté joueur, il ne se modifie plus. Avec
    {"couleur"}, il prend celle-ci : celle que la TV lui donnera, quand la sienne est prise ou trop sombre (E06)."""
    # Sans corps (l'ancien bouton, un essai) : sa propre couleur.
    corps = await utilitaires.corps_objet(requete) if await requete.body() else {}
    couleur = corps.get("couleur")
    if couleur is not None and not (isinstance(couleur, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", couleur)):
        raise HTTPException(400, "Couleur invalide : #rrggbb attendu")
    _, j = joueur_invite(ident)
    p = proposition(ident)
    a = p.get("aventurier")
    if not a or not isinstance(a, dict):
        raise HTTPException(404, "Ce joueur n'a pas encore d'aventurier")
    if p.get("accueilli"):
        raise HTTPException(409, "Cet aventurier est déjà dans l'atelier")
    if liens_joueurs.heros_relie(j):
        raise HTTPException(409, "Ce joueur est relié à un héros de l'atelier : défaites ce lien d'abord.")
    # Typée comme le coin la type à l'écriture : une proposition plus ancienne entre propre dans l'atelier.
    fiche = carnet.fiche_typee({k: v for k, v in a.items() if k not in ("id", "cree", "modifie", "version_base", confie.CHAMP)})
    fiche.update(tablee=True, secret="", notes_mj="", illustrations=[], illustration=None, source=f"joueur:{ident}",
                 joueur=fiche.get("joueur") or j["nom"])
    if couleur:
        fiche["couleur"] = couleur.lower()
    fiche["id"] = utilitaires.nouvel_id(config.AVENTURIERS, utilitaires.texte(fiche.get("nom")) or "aventurier")
    fiche["cree"] = fiche["modifie"] = utilitaires.maintenant()
    utilitaires.ecrire(config.AVENTURIERS / f"{fiche['id']}.json", fiche)
    p.update(accueilli=fiche["id"], accueilli_le=fiche["cree"])
    utilitaires.ecrire(config.PROPOSITIONS / f"{ident}.json", p)
    return fiche


@app.post("/api/joueurs/{ident}/relier")
async def relier_joueur(ident: str, requete: Request):
    """Relie au joueur un héros de la tablée créé dans l'atelier (liens_joueurs.py) : il lit sa fiche dans le carnet et
    commande pour lui, et pour lui seul. Son brouillon éventuel reste de côté, son créateur se ferme."""
    heros = (await utilitaires.corps_objet(requete)).get("heros")
    with VERROU_JOUEURS:
        liste, j = joueur_invite(ident)
        aventuriers = carnet_api.tous_les_aventuriers()
        accueillis = {x["id"]: proposition(x["id"]).get("accueilli") for x in liste}
        try:
            a = liens_joueurs.verifier_lien(liste, ident, heros, accueillis, aventuriers)
        except liens_joueurs.Refus as refus:
            raise HTTPException(refus.statut, str(refus))
        j.update(heros=heros, heros_cree=liens_joueurs.empreinte(a), relie_le=utilitaires.maintenant())
        ecrire_joueurs_sous_verrou(liste)
    await asyncio.to_thread(carnet_api.publier_carnet)
    return etat_joueur(j)


@app.delete("/api/joueurs/{ident}/relier")
async def delier_joueur(ident: str):
    """Défait le lien posé depuis l'atelier : le héros redevient sans joueur, le créateur du joueur se rouvre."""
    with VERROU_JOUEURS:
        liste, j = joueur_invite(ident)
        if not liens_joueurs.heros_relie(j):
            raise HTTPException(404, "Aucun héros n'est relié à ce joueur depuis l'atelier.")
        j.pop("heros", None)
        j.pop("heros_cree", None)
        j.pop("relie_le", None)
        ecrire_joueurs_sous_verrou(liste)
    await asyncio.to_thread(carnet_api.publier_carnet)
    return etat_joueur(j)


def images_de_l_atelier(valeur, adresse, cle=None):
    """Les images d'un carnet de joueur, servies par l'atelier pour l'aperçu du MJ (adresse : l'image du carnet → la
    sienne dans l'atelier, ou None)."""
    if cle in ("illustration", "portrait", "image"):
        return adresse(valeur) if isinstance(valeur, str) else None
    if isinstance(valeur, dict):
        return {k: images_de_l_atelier(v, adresse, k) for k, v in valeur.items()}
    if isinstance(valeur, list):
        return [images_de_l_atelier(v, adresse) for v in valeur]
    return valeur


@app.get("/api/joueurs/{ident}/apercu")
def apercu_joueur(ident: str):
    """« Voir comme Léa » (d27) : le carnet et l'échoppe tels que ce joueur les lit, sa fiche et ses commandes comprises,
    en lecture seule ; rien ne s'écrit chez lui. Carnet ouvert : les fichiers mêmes que sert le coin des joueurs
    (carnet.py). Fermé : ce qu'il lirait à l'ouverture, calculé sans être écrit, comme l'avis donné avant d'ouvrir."""
    _, j = joueur_invite(ident)
    empreinte = hashlib.sha256(j["jeton"].encode()).hexdigest()
    ouvert = carnet_api.carnet_ouvert() and carnet.est_ouvert(config.PROPOSITIONS)
    if ouvert:
        contenu = carnet.carnet_du_joueur(config.PROPOSITIONS, j["nom"], empreinte)
        boutiques = carnet.section_publiee(config.PROPOSITIONS, "boutiques")

        def adresse(url):
            m = carnet.ADRESSE_MEDIA.match(url)
            return f"/api/carnet-joueurs/media/{m.group(1)}" if m else None
    else:
        sections, fiches, images, _ = carnet_api.elements_du_carnet()
        sections = carnet.images_sures(sections) | {carnet.REGLES: carnet.section_publiee(config.PROPOSITIONS, carnet.REGLES)}
        contenu = carnet.vue_du_carnet(sections, carnet.images_sures(fiches.get(carnet.cle_heros(empreinte))), None, j["nom"],
                                       carnet.cle_heros(empreinte))
        boutiques = sections.get("boutiques") or []

        def adresse(url):
            m = carnet.ADRESSE_MEDIA.match(url)
            source = images.get(m.group(1)) if m else None
            return f"/media/{source.name}" if source else None
    etat = etat_joueur(j)
    heros = contenu["heros"]
    absent = ({"nom": etat["aventurier"], "genre": etat["genre"]}
              if not heros and etat["etat"] in ("accueilli", "relie", "relie-perdu") else None)
    return images_de_l_atelier({
        "joueur": j["nom"], "ouvert": ouvert, "etat": etat["etat"],
        # Le renvoi vers la bible des joueurs, comme le coin le donne (bible.py).
        "carnet": contenu | {"prochaine": tv_etat.prochaine_seance(), "absent": absent, "bible": bible.index_publie(config.PROPOSITIONS) is not None},
        "echoppe": carnet.vue_echoppe(boutiques, heros, carnet.lire_commandes(config.PROPOSITIONS, j["id"])),
    }, adresse)


@app.get("/api/carnet-joueurs/media/{nom}")
def media_carnet_joueurs(nom: str):
    """Les miniatures du carnet publié, pour l'aperçu du MJ."""
    chemin = config.PROPOSITIONS / carnet.CARNET / carnet.MEDIA / nom
    if not carnet.NOM_MEDIA.match(nom) or not chemin.is_file():
        raise HTTPException(404, "Introuvable")
    return FileResponse(chemin, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import config, utilitaires, carnet_api, tv_etat  # noqa: E402
