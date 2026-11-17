"""Le sanctuaire des joueurs, partagé par le coin des joueurs et l'atelier : les deux genres de demande, leurs
validateurs, et ce que le coin vérifie sur la section publiée avant d'écrire.

- « versement » : de l'or de la bourse de son héros pour la cagnotte d'un chantier, {batiment, or}. Il attend le MJ ; à
  l'acceptation, l'atelier le verse par le cœur de la route des versements (la bourse revérifiée). En attendant, l'or
  compte comme « engagé » (inventaire.or_engage).
- « projet » : proposer d'ouvrir un chantier d'un type que le MJ montre aux joueurs, {type, mot}. Il attend le MJ ; à
  l'acceptation, l'atelier ouvre le chantier, que le MJ place ensuite dans son onglet.

Le joueur ne connaît du sanctuaire que la section « sanctuaire » du carnet (carnet.py), publiée par l'atelier : un
bâtiment et un projet n'y sont désignés que par un jeton opaque, jamais par l'identifiant de l'atelier. Une demande ne
porte ni héros ni joueur : le versement part toujours de la bourse du héros de celui qui le demande (sa session).

Ce module ne lit rien : joueurs.py et l'atelier (sanctuaire_joueurs.py) l'importent tous deux, les bornes sont donc les
mêmes des deux côtés.
"""
import re

from commun import demandes
from commun.demandes import Genre, Refus

SECTION = "sanctuaire"
GENRES_DU_SANCTUAIRE = ("versement", "projet")
REF = re.compile(r"^[a-f0-9]{20}$")
OR_MAX = 1_000_000  # comme sanctuaire.COUT_MAX
MOT_MAX = 300  # le mot du joueur qui propose un projet


def entier(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def ref_lue(corps: dict, cle: str, quoi: str) -> str:
    ref = corps.get(cle)
    if not isinstance(ref, str) or not REF.match(ref):
        raise Refus(400, f"{quoi} inconnu.")
    return ref


def valider_versement(corps) -> dict:
    """{batiment : son jeton, or : des pièces, au moins une}."""
    corps = demandes.seulement(corps, {"batiment", "or"}, "Le versement")
    montant = corps.get("or")
    if not entier(montant) or not 1 <= montant <= OR_MAX:
        raise Refus(400, "Le montant est un nombre entier de pièces d'or, au moins une.")
    return {"batiment": ref_lue(corps, "batiment", "Chantier"), "or": montant}


def valider_projet(corps) -> dict:
    """{type : le jeton d'un projet, mot : quelques mots pour le MJ, facultatifs}."""
    corps = demandes.seulement(corps, {"type", "mot"}, "Le projet")
    mot = corps.get("mot", "")
    mot = demandes.texte_propre(mot if mot is not None else "", MOT_MAX, "Votre mot")
    return {"type": ref_lue(corps, "type", "Projet"), "mot": mot}


# Les deux attendent le MJ et le préviennent sur Telegram (le prénom et le genre seulement). Carnet fermé, fermés aussi.
demandes.enregistrer(Genre("versement", "Un versement au sanctuaire", ("un versement au sanctuaire", "{n} versements au sanctuaire"),
                           attente=True, valider=valider_versement, carnet=True,
                           statuts={demandes.ACCEPTEE: "versé, accepté par le MJ"}))
demandes.enregistrer(Genre("projet", "Un projet pour le sanctuaire", ("un projet pour le sanctuaire", "{n} projets pour le sanctuaire"),
                           attente=True, valider=valider_projet, carnet=True,
                           statuts={demandes.ACCEPTEE: "chantier ouvert par le MJ"}))


# ---------------------------------------------------------------- la section publiée

def lire_section(elements) -> dict:
    """La section « sanctuaire » du carnet, rangée : le village (nom, accroche, habitants, bonus), les bâtiments, les
    projets. Vide quand le MJ ne l'a pas rendue visible."""
    liste = [x for x in elements or [] if isinstance(x, dict)]
    return {"village": next((x for x in liste if x.get("genre") == "village"), None),
            "batiments": [x for x in liste if x.get("genre") == "batiment" and isinstance(x.get("id"), str)],
            "projets": [x for x in liste if x.get("genre") == "projet" and isinstance(x.get("id"), str)]}


def verse_en_attente(liste: list) -> int:
    """L'or que ses versements en attente du MJ engagent (inventaire.or_engage)."""
    return sum(d["corps"]["or"] for d in liste if isinstance(d, dict) and d.get("genre") == "versement"
               and d.get("statut") in demandes.OUVERTS and isinstance(d.get("corps"), dict) and entier(d["corps"].get("or")))


def reste_a_payer(b: dict) -> int | None:
    """Ce qui manque au prochain niveau d'un bâtiment publié ; None au plus haut."""
    p = b.get("prochain")
    if not isinstance(p, dict) or not entier(p.get("cout")):
        return None
    cagnotte = b.get("cagnotte") if entier(b.get("cagnotte")) else 0
    return max(0, p["cout"] - cagnotte)


FERME = "Le sanctuaire n'est pas ouvert aux joueurs en ce moment : votre MJ le montre quand il le souhaite."


def verifier_versement(corps: dict, elements: list, disponible: int) -> None:
    """Le coin, avant d'écrire : le chantier est-il dans la section, a-t-il un niveau à payer, l'or est-il disponible ?
    L'atelier revérifie tout à l'acceptation, sur le sanctuaire et la bourse du moment."""
    section = lire_section(elements)
    if not section["village"]:
        raise Refus(409, FERME)
    b = next((x for x in section["batiments"] if x["id"] == corps["batiment"]), None)
    if not b:
        raise Refus(409, "Ce chantier n'est plus dans le carnet : la page se relit.")
    reste = reste_a_payer(b)
    if reste is None:
        raise Refus(409, f"« {b.get('nom') or 'Ce bâtiment'} » est à son plus haut niveau.")
    if reste <= 0:
        raise Refus(409, "Ce niveau est déjà payé : votre MJ le bâtit.")
    if corps["or"] > reste:
        raise Refus(409, f"Il ne manque que {reste} po à ce niveau.")
    if corps["or"] > disponible:
        raise Refus(409, f"Vous avez {disponible} po disponibles : le reste est déjà engagé, ou n'est pas dans la bourse.")


def verifier_projet(corps: dict, elements: list, liste: list) -> None:
    """Le coin, avant d'écrire : ce projet est-il de ceux que le MJ montre, et pas déjà proposé par ce joueur ?"""
    section = lire_section(elements)
    if not section["village"]:
        raise Refus(409, FERME)
    if not any(p["id"] == corps["type"] for p in section["projets"]):
        raise Refus(409, "Ce projet n'est pas parmi ceux que votre MJ propose : la page se relit.")
    if any(d.get("genre") == "projet" and d.get("statut") in demandes.OUVERTS and (d.get("corps") or {}).get("type") == corps["type"]
           for d in liste if isinstance(d, dict)):
        raise Refus(409, "Vous avez déjà proposé ce projet : votre MJ y répondra.")
