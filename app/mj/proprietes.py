"""À qui est une fiche : le champ « auteur » des collections que chaque MJ tient pour lui (deuxième accès MJ).

Le compte principal partage l'atelier avec un MJ invité qui mène à l'occasion des quêtes annexes. Chacun a ses
propres scénarios, séances, PNJ, lieux, plans… dans les dossiers de toujours : une fiche dit qui l'a écrite par son
champ « auteur », que le serveur pose à la création et qui ne bouge plus ensuite (un PATCH l'ignore, un PUT le reprend
du disque, revenir à une version le garde). Les identifiants restent uniques d'un MJ à l'autre : toute la machinerie
des joueurs (jetons de la TV, carnet, secrets des joueurs) reste celle d'un seul atelier.

Une fiche sans le champ (écrite avant ce lot, ou pas encore passée par outils/migrer_auteurs.py) est au compte
principal : rien ne change pour le MJ principal tant qu'aucun invité n'existe.

Le compte qui écrit vient de la requête (la Garde de main.py le pose ici) ; sans requête (une tâche de fond, un outil),
c'est le compte principal. Le cloisonnement lui-même (qui lit quoi) est dans cloisonnement.py (lot MJ-3) : ce module ne
filtre rien.

Fonctions pures : il ne lit aucun fichier.
"""
import os
import re
from contextvars import ContextVar

# L'identifiant du compte principal des MJ : le champ « auteur » de ses fiches (absent, c'est lui). Réglé par
# ATELIER_MJ_PRINCIPAL (docker-compose.yml, valeur dans .env), pour l'atelier comme pour le coin des joueurs
# (commun/demandes.py le relit) ; il ne change plus une fois des fiches écrites.
PRINCIPAL = os.environ.get("ATELIER_MJ_PRINCIPAL", "").strip().lower() or "mj"
if not re.fullmatch(r"[a-z0-9-]{1,40}", PRINCIPAL):
    raise ValueError(f"ATELIER_MJ_PRINCIPAL invalide : {PRINCIPAL!r} (lettres minuscules, chiffres, tirets)")
# Son nom affiché (« Les MJ », la boîte des demandes, les coûts) tant que le fichier des comptes n'en donne pas d'autre.
NOM_PRINCIPAL = os.environ.get("ATELIER_MJ_NOM", "").strip() or "Le MJ"

# Les politiques des collections à auteur, vues par l'autre MJ (la règle est symétrique) :
#  - « cloisonnee » : il n'en voit rien ; seulement ce que la TV montre à toute la tablée (une scène, un combat, la
#    planche, un document remis), par les projections publiques ;
#  - « monde » : ce que les joueurs en savent, en lecture (la projection publique : un PNJ ou un lieu connus, la carte
#    telle que la TV la montre) ; il ne les modifie jamais.
CLOISONNEE, MONDE = "cloisonnee", "monde"
POLITIQUES = {
    "scenarios": CLOISONNEE,
    "seances": CLOISONNEE,
    "idees": CLOISONNEE,
    "fils": CLOISONNEE,
    "rencontres": CLOISONNEE,
    "plans": CLOISONNEE,
    "contrats": CLOISONNEE,
    "rumeurs": CLOISONNEE,
    "boutiques": CLOISONNEE,
    "documents": CLOISONNEE,
    "pnj": MONDE,
    "lieux": MONDE,
    "cartes": MONDE,
}
COLLECTIONS = tuple(POLITIQUES)

# Ce qui reste commun, sans auteur : la tablée et ce qui la suit d'une séance à l'autre. Les secrets des héros (peuple
# caché, secret, notes du MJ, histoire, « Ne fera jamais », ce que le joueur a confié au MJ seul) restent au compte
# principal : l'invité joue aussi dans la campagne, il n'en lira qu'une projection.
PARTAGEES = {
    "aventuriers": "la tablée ; l'invité n'en lit qu'une projection, sans les secrets des héros",
    "etats-heros": "Santé, Psy et cartons des héros : les quêtes annexes les changent aussi",
    "regles-maison": "les règles de la table, lues par les deux MJ, écrites par le principal",
    "sanctuaire": "l'auberge et le village, tels que les joueurs les voient pour l'invité",
}

# Les champs d'une fiche de héros que l'invité ne lira jamais (sa projection les retire, lot MJ-3). « peuple_cache » est la
# case : quand elle est cochée, le peuple lui-même (« peuple ») et ce qui le trahit (dons, posture élémentaire) partent
# aussi, comme à la TV (main.aventurier_public). « confie_au_mj » : ce que le joueur confie au MJ seul (confie.py).
SECRETS_DES_HEROS = ("secret", "notes_mj", "histoire", "jamais", "confie_au_mj")

# « Partager avec l'autre MJ » : les collections dont une fiche peut porter « partage » (vrai, rien d'autre). L'autre MJ
# la lit alors entière et la montre à la table ; il ne l'écrit jamais (cloisonnement.py : lecture=True, et seulement là).
# Les autres collections ignorent le champ : il n'y est même pas gardé.
PARTAGE = "partage"
PARTAGEABLES = ("pnj", "lieux")

_COMPTE: ContextVar = ContextVar("compte_mj", default=None)


def a_auteur(collection: str) -> bool:
    return collection in POLITIQUES


def auteur_de(fiche) -> str:
    """L'auteur d'une fiche ; un champ absent ou vide vaut le compte principal."""
    a = fiche.get("auteur") if isinstance(fiche, dict) else None
    return a if isinstance(a, str) and a else PRINCIPAL


def poser_compte(compte):
    """Le compte MJ de la requête en cours (la Garde) ; rend le jeton à rendre à retirer_compte."""
    return _COMPTE.set(compte if isinstance(compte, str) and compte else None)


def retirer_compte(jeton) -> None:
    _COMPTE.reset(jeton)


def compte_courant() -> str:
    """Le compte MJ qui écrit : celui de la session, sinon le principal (le LAN, une tâche de fond, un outil)."""
    return _COMPTE.get() or PRINCIPAL


def poser_auteur(fiche: dict) -> dict:
    """À la création d'une fiche : son auteur est le compte qui la crée, jamais ce qu'envoie la page."""
    fiche["auteur"] = compte_courant()
    return fiche


def garder_auteur(fiche: dict, precedente: dict) -> dict:
    """À l'enregistrement d'une fiche entière (PUT) : l'auteur est celui du disque, jamais ce qu'envoie la page. Une fiche
    d'avant le champ reste sans lui (au compte principal), à l'octet près."""
    if isinstance(precedente, dict) and "auteur" in precedente:
        fiche["auteur"] = precedente["auteur"]
    else:
        fiche.pop("auteur", None)
    return fiche


def partageable(collection: str) -> bool:
    return collection in PARTAGEABLES


def partagee(collection: str, fiche) -> bool:
    """La fiche est-elle partagée avec l'autre MJ ? Seulement « partage » à vrai, dans une collection qui le permet."""
    return collection in PARTAGEABLES and isinstance(fiche, dict) and fiche.get(PARTAGE) is True


def partage_propre(collection: str, fiche: dict) -> dict:
    """À l'écriture : « partage » ne reste que vrai, et dans une collection qui le permet ; sinon le champ disparaît."""
    if PARTAGE in fiche and not partagee(collection, fiche):
        fiche.pop(PARTAGE, None)
    return fiche
