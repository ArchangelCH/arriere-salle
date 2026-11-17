"""Les activités entre les séances, partagées par le coin des joueurs et l'atelier : le genre de demande
« activite », son validateur, la section « activites » du carnet telle que le coin la lit, et ce qu'il vérifie avant
d'écrire.

Entre deux séances, chaque joueur peut faire faire à son héros toutes les activités du catalogue, chacune une fois par
période (une semaine, ou l'intervalle entre deux séances) ; le catalogue que le MJ écrit dans l'atelier (activites_mj.py). Le joueur n'envoie que le jeton de
l'activité et, s'il veut, quelques mots : le dé se jette dans l'atelier, sur la fiche de l'atelier, quand il voit la
demande. Le joueur lit aussitôt son jet et le récit que le MJ a écrit pour cette issue ; l'or attend le MJ.

Ce que l'atelier écrit pour le joueur dans sa demande, une fois le dé jeté (demandes.vue_joueur le rend tel quel) :
  public = {periode, periode_libelle, activite, jet: {de, visee, issue, issue_nom, carac_nom, base, competence, bonus,
            modificateur}, recit, puis, après le MJ : or: {montant, vers, chantier} ou None, apprend, rendu}
et « fige » : le dé est jeté, la demande ne se retire plus (sinon un joueur retirerait un échec pour relancer).

Le joueur ne connaît du catalogue que la section publiée : chaque activité y est un jeton opaque, sans formule de gain,
sans récit, sans note du MJ. Ce module ne lit rien : joueurs.py et l'atelier l'importent tous deux.
"""
import re

from commun import demandes
from commun.demandes import Genre, Refus

GENRE = "activite"
SECTION = "activites"
REF = re.compile(r"^[a-f0-9]{20}$")
MOT_MAX = 300  # « Comment votre héros s'y prend », facultatif
FERME = "Les activités ne sont pas ouvertes en ce moment : votre MJ les ouvre entre les séances."


def valider_activite(corps) -> dict:
    """{activite : son jeton, mot : quelques mots pour le MJ, facultatifs}. Tout autre champ (un dé, une valeur visée, une
    issue) est ignoré : le test se jette dans l'atelier, sur la fiche de l'atelier, jamais d'après ce qu'envoie le coin."""
    if not isinstance(corps, dict):
        raise Refus(400, "L'activité : demande illisible.")
    ref = corps.get("activite")
    if not isinstance(ref, str) or not REF.match(ref):
        raise Refus(400, "Activité inconnue.")
    mot = corps.get("mot", "")
    mot = demandes.texte_propre(mot if mot is not None else "", MOT_MAX, "Votre mot")
    return {"activite": ref, "mot": mot}


# Attend le MJ (l'or) et le prévient sur Telegram, le prénom et le genre seulement. Carnet fermé, fermée aussi.
demandes.enregistrer(Genre(GENRE, "Une activité entre les séances", ("une activité entre les séances", "{n} activités entre les séances"),
                           attente=True, valider=valider_activite, carnet=True, oui="Valider",
                           statuts={demandes.EN_ATTENTE: "en attente du MJ", demandes.ACCEPTEE: "validée par le MJ",
                                    demandes.REFUSEE: "refusée par le MJ"}))


# ---------------------------------------------------------------- la section publiée

def lire_section(elements) -> dict:
    """La section « activites » du carnet, rangée : la période en cours, puis les activités montrées aux joueurs."""
    liste = [x for x in elements or [] if isinstance(x, dict)]
    return {"periode": next((x for x in liste if x.get("genre") == "periode" and isinstance(x.get("cle"), str)), None),
            "activites": [x for x in liste if x.get("genre") == "activite" and isinstance(x.get("id"), str)]}


def public(d: dict) -> dict:
    p = d.get("public") if isinstance(d, dict) else None
    return p if isinstance(p, dict) else {}


def compte(d: dict, cle: str) -> bool:
    """Cette demande compte-t-elle pour la période (son activité est faite, ou va l'être) ? Oui tant que le dé n'est pas jeté (il va l'être), puis
    pour la période où il l'a été ; non pour un échec de l'atelier (rien n'a été jeté) ni quand le MJ rend son tour."""
    if not isinstance(d, dict) or d.get("genre") != GENRE or d.get("statut") == demandes.ECHEC:
        return False
    p = public(d)
    if p.get("rendu") is True:
        return False
    if d.get("statut") == demandes.RETIREE and not d.get("fige"):
        return False
    return not p or p.get("periode") == cle


def de_la_periode(liste: list, cle: str) -> list:
    return [d for d in liste or [] if compte(d, cle)]


def verifier(corps: dict, elements: list, liste: list) -> None:
    """Le coin, avant d'écrire : l'activité est-elle dans la section, reste-t-il une place, le héros l'a-t-il déjà faite
    pour cette période ? L'atelier revérifie tout au moment de jeter le dé, sur son catalogue et son journal."""
    s = lire_section(elements)
    if not s["periode"]:
        raise Refus(409, FERME)
    a = next((x for x in s["activites"] if x["id"] == corps["activite"]), None)
    if not a:
        raise Refus(409, "Cette activité n'est plus proposée : la page se relit.")
    if any((d.get("corps") or {}).get("activite") == corps["activite"] for d in de_la_periode(liste, s["periode"]["cle"])):
        raise Refus(409, f"Votre héros a déjà fait « {a.get('nom') or 'cette activité'} » pour {s['periode'].get('libelle_court') or 'cette période'} : choisissez-en une autre.")
    restantes = a.get("restantes")
    if isinstance(restantes, int) and not isinstance(restantes, bool) and restantes <= 0:
        raise Refus(409, f"Plus de place pour « {a.get('nom') or 'cette activité'} » : choisissez-en une autre.")
