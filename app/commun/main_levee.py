"""La main levée : pendant la partie, autour de la table ou en visio, un joueur lève la main depuis son téléphone (« Je
veux agir ») ; le MJ le voit aussitôt dans le Tableau, sur sa télécommande et dans l'en-tête de l'atelier, puis lui
donne la parole (le joueur lit « À vous ! ») ou la baisse sans un mot (« Plus tard »).

C'est une demande de la file (demandes.py), du genre « main » :
  - en attente du MJ ; « Donner la parole » l'accepte, « Plus tard » la refuse, le joueur la retire en la baissant ;
  - silencieuse pour Telegram, permise carnet fermé (on joue même carnet fermé) ;
  - ni dans la boîte des demandes, ni dans « Mes demandes » du joueur (Genre.liste) : elle vit à part ;
  - une seule levée à la fois par joueur : la lever de nouveau rend la même ;
  - personne n'y répond : elle retombe seule au bout de DUREE secondes.

La retombée se calcule (levee), des deux côtés à l'identique, d'après l'heure où la main s'est levée : personne n'a à
l'écrire à l'instant. Le coin range les mains retombées la fois suivante (lever, baisser), et ne garde que les
dernières mains closes : une partie animée ne remplit pas le fichier du joueur, ni ne chasse ses autres demandes.

Ce module ne lit rien de l'atelier : le coin (joueurs.py) et l'atelier (salle.py) l'importent tous deux.
"""
from datetime import datetime
from pathlib import Path

from commun import demandes

GENRE = "main"
DUREE = 300  # secondes : une main sans réponse retombe seule au bout de cinq minutes
DIT = 30  # secondes : la réponse du MJ (« À vous ! », « Plus tard ») ou la retombée, que la page du joueur peut encore dire
GARDEES = 2  # mains closes gardées dans le fichier du joueur, la plus récente dit ce que le MJ en a fait
PAR_HEURE = 60  # mains levées par joueur et par heure (une par minute), à part du plafond des autres demandes
RETOMBEE = "Personne n'y a répondu : votre main est retombée."
BAISSEE = "Vous avez baissé la main."


def valider(corps) -> dict:
    """Rien à dire en levant la main : un corps vide, ou rien."""
    if corps is None or corps == {}:
        return {}
    raise demandes.Refus(400, "Lever la main : rien d'autre à envoyer.")


demandes.enregistrer(demandes.Genre(
    GENRE, "Main levée", ("une main levée", "{n} mains levées"), attente=True, valider=valider, silencieux=True,
    liste=False, oui="Donner la parole", non="Plus tard",
    statuts={demandes.EN_ATTENTE: "main levée", demandes.ACCEPTEE: "à vous", demandes.REFUSEE: "plus tard",
             demandes.RETIREE: "baissée"}))


def instant_de(iso) -> datetime | None:
    try:
        return datetime.fromisoformat(iso) if isinstance(iso, str) else None
    except ValueError:
        return None


def age(d: dict, instant: datetime | None = None) -> float | None:
    """Les secondes depuis que la main s'est levée (None : date illisible)."""
    cree = instant_de(d.get("cree"))
    return None if cree is None else ((instant or datetime.now()) - cree).total_seconds()


def levee(d: dict, instant: datetime | None = None) -> bool:
    """Une main encore levée : ouverte, et levée il y a moins de DUREE secondes. Une date un peu en avance (deux horloges)
    compte comme levée à l'instant ; une date illisible, comme retombée."""
    if d.get("genre") != GENRE or d.get("statut") != demandes.EN_ATTENTE:
        return False
    a = age(d, instant)
    return a is not None and -60 < a < DUREE


def reste(d: dict, instant: datetime | None = None) -> float:
    """Les secondes avant qu'elle retombe."""
    a = age(d, instant)
    return 0.0 if a is None else round(max(0.0, min(DUREE, DUREE - a)), 1)


def mains(liste: list) -> list:
    return [d for d in liste if d.get("genre") == GENRE]


def ranger(liste: list, instant: datetime) -> tuple[list, bool]:
    """Sous le verrou : les mains ouvertes mais retombées passent pour baissées (avec leur phrase), et seules les GARDEES
    dernières mains closes restent ; une main encore levée ne bouge pas. Rend (la liste, a-t-elle changé)."""
    change = False
    for d in mains(liste):
        if d["statut"] == demandes.EN_ATTENTE and not levee(d, instant):
            demandes.passer(d, demandes.RETIREE, "joueur", resultat=RETOMBEE)
            change = True
    closes = [d for d in mains(liste) if d["statut"] not in demandes.OUVERTS]
    vieilles = {id(d) for d in closes[:-GARDEES]} if len(closes) > GARDEES else set()
    return [d for d in liste if id(d) not in vieilles], change or bool(vieilles)


def lever(depot: Path, joueur: str) -> tuple[dict, bool]:
    """Lève la main du joueur : (la demande, nouvelle ou non). Déjà levée, c'est la même qui revient (un double toucher ne
    lève pas deux mains)."""
    with demandes.verrou(depot):
        instant = datetime.now()
        liste = demandes.lire(depot, joueur)
        deja = next((d for d in liste if levee(d, instant)), None)
        if deja is not None:
            return deja, False
        liste, _ = ranger(liste, instant)
        d = demandes.nouvelle({"genre": GENRE, "corps": {}})
        demandes.ecrire(depot, joueur, [*liste, d])  # ecrire borne la liste (429 si trop attend)
    return d, True


def baisser(depot: Path, joueur: str) -> dict | None:
    """Le joueur baisse sa main (rien si elle ne l'était pas) : rend la main baissée, ou None."""
    with demandes.verrou(depot):
        instant = datetime.now()
        liste = demandes.lire(depot, joueur)
        ouverte = next((d for d in liste if levee(d, instant)), None)
        if ouverte is not None:
            demandes.passer(ouverte, demandes.RETIREE, "joueur", resultat=BAISSEE)
        liste, change = ranger(liste, instant)
        if ouverte is not None or change:
            demandes.ecrire(depot, joueur, liste)
    return ouverte


def etat(liste: list, instant: datetime | None = None) -> dict:
    """Ce que lit la page du joueur, de sa main seulement :
      - « levee » (et reste : les secondes avant qu'elle retombe) ;
      - « rendue » (le MJ lui donne la parole), « plus-tard » (le MJ l'a baissée), « retombee » : dans les DIT secondes ;
      - « repos » sinon (baissée par lui, ou plus rien à dire).
    L'identifiant de la main permet à la page de ne dire qu'une fois « À vous ! »."""
    instant = instant or datetime.now()
    m = mains(liste)
    d = m[-1] if m else None
    vide = {"etat": "repos", "id": None, "reste": 0, "duree": DUREE}
    if d is None:
        return vide
    if levee(d, instant):
        return {"etat": "levee", "id": d["id"], "reste": reste(d, instant), "duree": DUREE}
    if d["statut"] == demandes.ACCEPTEE and recent(d.get("traitee"), instant):
        return vide | {"etat": "rendue", "id": d["id"]}
    if d["statut"] == demandes.REFUSEE and recent(d.get("traitee"), instant):
        return vide | {"etat": "plus-tard", "id": d["id"]}
    a = age(d, instant)
    retombee = (d["statut"] == demandes.EN_ATTENTE or d.get("resultat") == RETOMBEE) and a is not None and DUREE <= a < DUREE + DIT
    return vide | {"etat": "retombee", "id": d["id"]} if retombee else vide


def recent(iso, instant: datetime) -> bool:
    t = instant_de(iso)
    return t is not None and -60 < (instant - t).total_seconds() < DIT


def levees(depot: Path, joueurs: list, instant: datetime | None = None) -> list:
    """Pour l'atelier : les mains encore levées des joueurs invités, la plus ancienne d'abord (l'ordre des mains).
    [{joueur, id, version, cree, reste}]."""
    instant = instant or datetime.now()
    sortie = []
    for j in joueurs:
        try:
            liste = demandes.lire(depot, j)
        except demandes.Refus:
            continue
        for d in liste:
            if levee(d, instant):
                sortie.append({"joueur": j, "id": d["id"], "version": d["version"], "cree": d["cree"], "reste": reste(d, instant)})
    return sorted(sortie, key=lambda x: (x["cree"], x["joueur"]))
