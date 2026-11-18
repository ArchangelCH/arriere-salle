"""L'état de son héros, réglé par le joueur depuis la table du coin : sa Santé, sa Psy et sa posture, pendant la
partie, autour de la table comme en visio. Appliqué tout de suite (choix du MJ), en combat comme hors combat ; le MJ le
voit dans son Tableau et sur l'écran du combat, et garde la main pour corriger.

Un genre de la file des demandes (demandes.py), « etat-heros », appliqué seul, silencieux pour Telegram, hors de la boîte
du MJ et de « Mes demandes » (il vit sous le pouce du joueur et dans le Tableau) :
  - {champ: "sante" | "psy", delta} : des points en plus ou en moins. Un écart, jamais une valeur : deux écrans qui
    notent en même temps (le joueur et le MJ) ne s'écrasent pas ;
  - {posture: "offensive" | "defensive" | "focus" | "aucune"}.
Le coin n'envoie que cela ; l'atelier calcule sur sa fiche et sur l'état du moment (etat_joueur_mj.py), et écrit dans
« public » ce que le joueur relit aussitôt.

Les bornes (calculer), les mêmes des deux côtés : la Santé ne remonte pas au-dessus de son maximum moins la Santé payée
faute de Psy pour un don (elle ne revient qu'après une journée de repos, règle du kit) et ne descend pas sous la mort
(l'opposé du maximum, 10 au moins) ; la Psy reste entre 0 et son maximum.

Ce module ne lit rien de l'atelier : joueurs.py et etat_joueur_mj.py l'importent tous deux.
"""
from datetime import datetime
from pathlib import Path

from commun import demandes
from commun.demandes import Genre, Refus

GENRE = "etat-heros"
CHAMPS = {"sante": "Santé", "psy": "Psy"}
# « Aucune » : la posture perdue (un dé de mésaventure l'a cassée) ; à découvert, aucune défense, aucun effet.
POSTURES = {"offensive": "Offensive", "defensive": "Défensive", "focus": "Focus", "aucune": "Aucune"}
DELTA_MAX = 99
PAR_HEURE = 240  # gestes par joueur et par heure : la page regroupe les touchers rapprochés en un seul envoi
EN_ROUTE = 60  # secondes : un geste que l'atelier n'a pas appliqué à temps ne l'est plus
GARDES = 3  # gestes clos gardés dans le fichier du joueur
FERMEE = "La table est fermée : votre héros se règle pendant la partie, quand votre MJ ouvre la table."
ABSENT = "Votre héros n'est pas à la tablée en ce moment : votre MJ s'en occupera."
TROP_TARD = "Ce changement est arrivé trop tard chez votre MJ : refaites-le."


def valider(corps) -> dict:
    """{champ, delta} ou {posture}, l'un ou l'autre ; tout autre champ (une valeur, un maximum) est refusé."""
    if not isinstance(corps, dict):
        raise Refus(400, "Le changement : demande illisible.")
    if "posture" in corps:
        if set(corps) != {"posture"} or not isinstance(corps["posture"], str) or corps["posture"] not in POSTURES:
            raise Refus(400, "La posture : offensive, défensive, focus ou aucune.")
        return {"posture": corps["posture"]}
    champ, delta = corps.get("champ"), corps.get("delta")
    if set(corps) != {"champ", "delta"} or not isinstance(champ, str) or champ not in CHAMPS:
        raise Refus(400, "Santé ou Psy, et le nombre de points en plus ou en moins.")
    if isinstance(delta, bool) or not isinstance(delta, int) or delta == 0 or abs(delta) > DELTA_MAX:
        raise Refus(400, f"De 1 à {DELTA_MAX} points, en plus ou en moins.")
    return {"champ": champ, "delta": delta}


demandes.enregistrer(Genre(GENRE, "L'état de son héros", ("un héros réglé par son joueur", "{n} réglages de héros"), attente=False,
                           valider=valider, silencieux=True, liste=False,
                           statuts={demandes.A_APPLIQUER: "en route", demandes.APPLIQUEE: "noté"}))


def entier(v, defaut: int) -> int:
    return defaut if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or abs(v) > 1e6 else int(round(v))


def vitalite(sante_max, sante, psy_max, psy, sante_don) -> dict:
    """La Santé et la Psy du moment, rangées : des entiers, la Psy dans ses bornes, la Santé jamais au-dessus du maximum."""
    sante_max = max(1, entier(sante_max, 1))
    psy_max = max(0, entier(psy_max, 0))
    sante = min(sante_max, entier(sante, sante_max))
    return {"sante": sante, "sante_max": sante_max, "psy": max(0, min(psy_max, entier(psy, psy_max))), "psy_max": psy_max,
            "sante_don": max(0, min(entier(sante_don, 0), sante_max - sante))}


def plancher_sante(v: dict) -> int:
    """La mort : l'opposé de la Santé maximale, 10 au moins (règle du kit)."""
    return -max(v["sante_max"], 10)


def plafond_sante(v: dict) -> int:
    """Jusqu'où un soin remonte la Santé : son maximum, moins ce qui a été payé faute de Psy."""
    return v["sante_max"] - v["sante_don"]


def calculer(v: dict, champ: str, delta: int) -> dict:
    """L'état après le geste, borné. Un soin ne fait jamais baisser une Santé déjà au-dessus de son plafond."""
    apres = dict(v)
    if champ == "psy":
        apres["psy"] = max(0, min(v["psy_max"], v["psy"] + delta))
    else:
        voulu = v["sante"] + delta
        apres["sante"] = max(plancher_sante(v), voulu) if delta < 0 else min(voulu, max(v["sante"], plafond_sante(v)))
    return apres


# ---------------------------------------------------------------- le fichier du joueur

def instant_de(iso) -> datetime | None:
    try:
        return datetime.fromisoformat(iso) if isinstance(iso, str) else None
    except ValueError:
        return None


def age(d: dict, instant: datetime) -> float | None:
    cree = instant_de(d.get("cree"))
    return None if cree is None else (instant - cree).total_seconds()


def en_route(d: dict, instant: datetime) -> bool:
    if d.get("genre") != GENRE or d.get("statut") != demandes.A_APPLIQUER:
        return False
    a = age(d, instant)
    return a is not None and -60 < a < EN_ROUTE


def deposer(depot: Path, joueur: str, corps: dict) -> dict:
    """Le coin écrit le geste du joueur, sous le verrou ; les gestes clos les plus anciens s'en vont."""
    with demandes.verrou(depot):
        liste = demandes.lire(depot, joueur)
        d = demandes.nouvelle({"genre": GENRE, "corps": corps})
        clos = [x for x in liste if x.get("genre") == GENRE and x.get("statut") != demandes.A_APPLIQUER]
        vieux = {id(x) for x in clos[:-GARDES]}
        demandes.ecrire(depot, joueur, [*[x for x in liste if id(x) not in vieux], d])
    return d


def etat(liste: list, instant: datetime | None = None) -> dict:
    """Ce que lit la page du joueur de ses gestes : s'il en reste en route, et le dernier clos (ce que l'atelier a noté,
    ou la phrase de son refus)."""
    instant = instant or datetime.now()
    miens = [d for d in liste if d.get("genre") == GENRE]
    clos = next((d for d in reversed(miens) if d.get("statut") in (demandes.APPLIQUEE, demandes.ECHEC)), None)
    dernier = None
    if clos is not None:
        p = clos.get("public") if isinstance(clos.get("public"), dict) else None
        dernier = {"id": clos["id"], "statut": clos["statut"], "traitee": clos.get("traitee"),
                   "phrase": clos.get("resultat") if clos["statut"] == demandes.ECHEC else "", **({"public": p} if p else {})}
    return {"en_route": sum(1 for d in miens if en_route(d, instant)), "dernier": dernier}
