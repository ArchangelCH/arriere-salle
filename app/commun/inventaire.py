"""L'inventaire des joueurs, partagé par le coin des joueurs et l'atelier : les trois genres de demande qui
touchent un sac, leurs validateurs, le rejeu d'un geste sur le sac tel qu'il est, et l'or « engagé ».

Le joueur gère depuis son téléphone l'équipement et les trois objets personnels de son héros (genre « sac », appliqué
seul, que le MJ peut annuler), donne une ligne de son sac à un compagnon (« don-objet », appliqué seul et annulable) ou
lui propose de l'or (« don-or », que le MJ accepte ou refuse). L'or ne bouge pas autrement : un geste de sac sur l'or est
refusé, la bourse ne change que par l'échoppe et par le MJ.

Le joueur ne voit de son sac que ce que l'atelier publie (sa fiche « Mon héros ») : sans les lignes vides, au masque, sans
ce qui nomme un inconnu. Un geste désigne donc une ligne par son rang dans ce qu'il voit et par le texte qu'il y lit ;
l'atelier la retrouve dans ce même découpage (ligne_visee), jamais dans la fiche complète : une ligne retenue pour le MJ
reste introuvable, et rien de ce qu'il répond ne dépend d'un secret.

Ce module ne lit rien : joueurs.py et l'atelier (sacs.py) l'importent tous deux, les bornes sont donc les mêmes des deux
côtés.

Les quantités : le sac reste une liste de textes, et la quantité vit dans le texte, « Potion de soins ×3 ».
quantite_de et ligne lisent et écrivent cette convention ; elles ont leurs jumelles dans js/aventuriers/etat.js
(quantiteDe, ligneDe), tenues à l'identique par les cas communs de tests/sac-cas.json. Ajouter un objet déjà là augmente
sa quantité au lieu d'ouvrir une ligne ; le geste « quantite » en prend ou en retire. Seul l'équipement se compte : les
trois objets personnels restent des textes libres.
"""
import re

from commun import cagnottes
from commun import demandes
from commun.demandes import Genre, Refus

LISTES = ("equipement", "objets")
NOMS_LISTES = {"equipement": "votre équipement", "objets": "vos objets personnels"}
LIGNE_MAX = 300  # comme la route du sac de l'atelier (SAC_LIGNE_MAX)
LIGNES_MAX = 80
OBJETS = 3
OR_MAX = 10_000_000
# Le texte qu'un joueur lit d'une ligne : celui de la fiche, au masque. Un peu plus long que la ligne elle-même quand le
# masque remplace un nom court par un plus long.
VU_MAX = 600
GESTES = ("ajouter", "changer", "retirer", "quantite")
QUANTITE_MAX = 999
REF = re.compile(r"^[a-f0-9]{20}$")
GENRES_DU_SAC = ("sac", "don-objet", "don-or")

MOT_OR = "L'or ne change pas d'ici : il passe par l'échoppe, ou par votre MJ. Pour en donner à un compagnon, « Donner de l'or »."
PLUS_LA = "Cette ligne n'est plus dans votre sac : la page se relit."
OBJETS_PRIS = "Les trois objets personnels sont pris : changez-en un, ou retirez-en un d'abord."
SAC_PLEIN = "Le sac est plein : retirez une ligne d'abord."
TROP = f"Pas plus de {QUANTITE_MAX} dans une même ligne."
NE_SE_COMPTE_PAS = "Cette ligne ne se compte pas telle qu'elle est écrite : renommez-la d'abord (« Corde ×2 »)."
OBJETS_SANS_COMPTE = "Les objets personnels ne se comptent pas."
PLUS_AUTANT = "Vous n'en avez plus autant : la page se relit."


# ---------------------------------------------------------------- les quantités (jumelles : js/aventuriers/etat.js)

# « Corde ×2 » (ce que l'atelier écrit), « Corde x2 », « Corde X 2 », « Corde 2x », « 2x Corde », « 2 × Corde ».
MARQUE_SIGNE = re.compile(r"^(.*\S)\s*×\s*([0-9]{1,3})$")
MARQUE_LETTRE = re.compile(r"^(.*\S)\s+[xX]\s*([0-9]{1,3})$")
MARQUE_APRES = re.compile(r"^(.*\S)\s+([0-9]{1,3})\s*[xX×]$")
MARQUE_DEVANT = re.compile(r"^([0-9]{1,3})\s*(?:×\s*|[xX]\s+)(\S.*)$")


def chiffre(c: str) -> bool:
    return "0" <= c <= "9"


def marques(t: str) -> list:
    """Les lectures possibles d'une marque de quantité dans ce texte : [(nom, n)]. Écrite avec la lettre x, une marque
    collée à un autre nombre n'en est pas une (« Planche 2 x 4 » est une mesure) ; « ×N » en fin de ligne, la forme
    écrite par l'atelier, se lit toujours."""
    lues = []
    m = MARQUE_SIGNE.match(t)
    if m:
        lues.append((m.group(1), int(m.group(2))))
    for motif in (MARQUE_LETTRE, MARQUE_APRES):
        m = motif.match(t)
        if m and not chiffre(m.group(1)[-1]):
            lues.append((m.group(1), int(m.group(2))))
    m = MARQUE_DEVANT.match(t)
    if m and not chiffre(m.group(2)[0]):
        lues.append((m.group(2), int(m.group(1))))
    return lues


def marquee(t: str) -> bool:
    """Ce texte a-t-il l'air de porter une quantité, lisible ou non ?"""
    return any(motif.match(t) for motif in (MARQUE_SIGNE, MARQUE_LETTRE, MARQUE_APRES, MARQUE_DEVANT))


def quantite_de(ligne) -> tuple[str, int]:
    """(nom, n) d'une ligne du sac : « Potion de soins ×3 » rend (« Potion de soins », 3), « Cape » rend (« Cape », 1).
    Une marque ne compte que de 1 à 999 et si le nom qui reste n'en porte pas une autre ; sinon la ligne entière est le
    nom, en un exemplaire (voir douteuse)."""
    t = " ".join(ligne.split()) if isinstance(ligne, str) else ""
    for nom, n in marques(t):
        if 1 <= n <= QUANTITE_MAX and not marquee(nom):
            return nom, n
    return t, 1


def ligne(nom: str, n: int = 1) -> str:
    """La ligne du sac pour n exemplaires : « Nom ×N », le nom seul pour un exemplaire."""
    return nom if n <= 1 else f"{nom} ×{n}"


def douteuse(texte) -> bool:
    """Une ligne qui a l'air de porter une quantité que quantite_de ne sait pas lire sans risque (« Planche 2 x 4 »,
    « Corde ×0 », « 2x Corde ×3 ») : elle reste un texte libre, qui ne se compte ni ne se regroupe."""
    return marquee(quantite_de(texte)[0])


def cle_nom(nom: str) -> str:
    """Le nom tel qu'il se compare : sans égard à la casse ni aux espaces."""
    return " ".join(nom.split()).lower()


def rang_du_nom(vues: list, nom: str) -> int | None:
    """vues : [(rang dans la fiche, texte lu)]. Le rang de la première ligne qui porte ce nom et qui se compte."""
    cle = cle_nom(nom)
    return next((i for i, vu in vues if vu.strip() and not douteuse(vu) and cle_nom(quantite_de(vu)[0]) == cle), None)


def comptee(texte: str, de: int) -> str:
    """La ligne avec de exemplaires en plus (ou en moins) : « » quand il n'en reste pas. Refus quand elle ne se compte pas."""
    if douteuse(texte):
        raise Refus(409, NE_SE_COMPTE_PAS)
    nom, n = quantite_de(texte)
    if n + de > QUANTITE_MAX:
        raise Refus(409, TROP)
    apres = ligne(nom, n + de) if n + de > 0 else ""
    if len(apres) > LIGNE_MAX:
        raise Refus(413, "Le texte de la ligne est trop long.")
    return apres


def avec(brute: list, texte: str, vues: list | None = None) -> list:
    """L'équipement avec cet objet en plus. Déjà là (même nom, parmi les lignes de vues : toutes par défaut), sa quantité
    monte ; sinon il prend la première ligne vide, ou une ligne de plus. « Torche x3 » s'écrit « Torche ×3 »."""
    apres = list(brute)
    if not douteuse(texte):
        nom, k = quantite_de(texte)
        i = rang_du_nom(list(enumerate(apres)) if vues is None else vues, nom)
        if i is not None and not douteuse(apres[i]):
            apres[i] = comptee(apres[i], k)
            return apres
        texte = ligne(nom, k)
    libre = next((i for i, x in enumerate(apres) if not x.strip()), None)
    if libre is None and len(apres) >= LIGNES_MAX:
        raise Refus(409, SAC_PLEIN)
    if libre is None:
        apres.append(texte)
    else:
        apres[libre] = texte
    return apres


def entier(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def liste_choisie(corps: dict) -> str:
    cle = corps.get("liste")
    if cle == "or":
        raise Refus(400, MOT_OR)
    if cle not in LISTES:
        raise Refus(400, "Liste du sac inconnue.")
    return cle


def ligne_lue(corps: dict) -> tuple[int, str]:
    """Le rang et le texte de la ligne que le joueur a sous les yeux."""
    rang, avant = corps.get("rang"), corps.get("avant")
    if not entier(rang) or not 0 <= rang < LIGNES_MAX:
        raise Refus(400, "Ligne du sac illisible.")
    if not isinstance(avant, str) or not avant.strip() or len(avant) > VU_MAX:
        raise Refus(400, "Ligne du sac illisible.")
    return rang, avant


def valider_sac(corps) -> dict:
    """{geste : ajouter, liste, ligne} ; {geste : changer, liste, rang, avant, ligne} ; {geste : retirer, liste, rang,
    avant} ; {geste : quantite, liste : equipement, rang, avant, de : 1 ou -1}. La ligne nouvelle passe au propre et sur
    une seule ligne, comme le sac de « La compagnie » l'écrit ; dans l'équipement, sa quantité s'écrit « ×N »."""
    if isinstance(corps, dict) and (corps.get("geste") == "or" or corps.get("liste") == "or" or "or" in corps):
        raise Refus(400, MOT_OR)
    corps = demandes.seulement(corps, {"geste", "liste", "rang", "avant", "ligne", "de"}, "Le sac")
    geste = corps.get("geste")
    if geste not in GESTES:
        raise Refus(400, "Geste du sac inconnu.")
    propre = {"geste": geste, "liste": liste_choisie(corps)}
    if geste != "ajouter":
        propre["rang"], propre["avant"] = ligne_lue(corps)
    elif "rang" in corps or "avant" in corps:
        raise Refus(400, "Le sac : demande illisible.")
    if geste == "quantite":
        if "ligne" in corps or corps.get("de") not in (1, -1) or isinstance(corps.get("de"), bool):
            raise Refus(400, "Le sac : demande illisible.")
        if propre["liste"] != "equipement":
            raise Refus(400, OBJETS_SANS_COMPTE)
        propre["de"] = corps["de"]
        return propre
    if "de" in corps:
        raise Refus(400, "Le sac : demande illisible.")
    if geste == "retirer":
        if "ligne" in corps:
            raise Refus(400, "Le sac : demande illisible.")
        return propre
    texte = demandes.texte_propre(corps.get("ligne"), LIGNE_MAX, "Le texte de la ligne", lignes=False)
    if not texte:
        raise Refus(400, "Écrivez ce qui entre dans le sac." if geste == "ajouter" else "Écrivez le nouveau nom, ou retirez la ligne.")
    propre["ligne"] = ecrite(propre["liste"], texte)
    return propre


def ecrite(cle: str, texte: str) -> str:
    """Le texte d'une ligne tel qu'il entre dans le sac : dans l'équipement, la quantité s'écrit « ×N »."""
    return ligne(*quantite_de(texte)) if cle == "equipement" and not douteuse(texte) else texte


def ref_lue(corps: dict) -> str:
    ref = corps.get("ref")
    if not isinstance(ref, str) or not REF.match(ref):
        raise Refus(400, "Compagnon inconnu.")
    return ref


def valider_don_objet(corps) -> dict:
    """{liste, rang, avant, ref} : la ligne quitte ce sac et entre dans l'équipement du compagnon désigné par ref.
    Avec nombre (équipement seulement) : ce nombre d'exemplaires seulement, le reste demeure dans ce sac."""
    corps = demandes.seulement(corps, {"liste", "rang", "avant", "ref", "nombre"}, "Le don")
    propre = {"liste": liste_choisie(corps)}
    propre["rang"], propre["avant"] = ligne_lue(corps)
    propre["ref"] = ref_lue(corps)
    if "nombre" in corps:
        nombre = corps["nombre"]
        if not entier(nombre) or not 1 <= nombre <= QUANTITE_MAX:
            raise Refus(400, "Le nombre à donner est un entier, au moins un.")
        if propre["liste"] != "equipement":
            raise Refus(400, OBJETS_SANS_COMPTE)
        propre["nombre"] = nombre
    return propre


def valider_don_or(corps) -> dict:
    """{ref, montant} : des pièces d'or pour un compagnon, que le MJ accepte ou refuse."""
    corps = demandes.seulement(corps, {"ref", "montant"}, "Le don d'or")
    montant = corps.get("montant")
    if not entier(montant) or not 1 <= montant <= OR_MAX:
        raise Refus(400, "Le montant est un nombre entier de pièces d'or, au moins une.")
    return {"ref": ref_lue(corps), "montant": montant}


# Le sac se gère librement : appliqué seul, sans notification, annulable par le MJ. Le carnet fermé ferme l'inventaire.
demandes.enregistrer(Genre("sac", "Le sac", ("un geste sur un sac", "{n} gestes sur des sacs"), attente=False,
                           valider=valider_sac, silencieux=True, carnet=True, annulable=True))
demandes.enregistrer(Genre("don-objet", "Un objet donné", ("un objet donné", "{n} objets donnés"), attente=False,
                           valider=valider_don_objet, silencieux=True, carnet=True, annulable=True))
# L'or donné passe par le MJ, et le prévient.
demandes.enregistrer(Genre("don-or", "Un don d'or", ("un don d'or à valider", "{n} dons d'or à valider"), attente=True,
                           valider=valider_don_or, carnet=True, oui="Accepter", non="Refuser",
                           statuts={demandes.ACCEPTEE: "donné, accepté par le MJ"}))


# ---------------------------------------------------------------- le rejeu

def ligne_visee(vues: list, rang, avant: str) -> int | None:
    """vues : les lignes que voit le joueur, [(rang dans la fiche, texte vu)]. La ligne visée à son rang avec son texte,
    sinon la première où ce texte paraît (une ligne ajoutée ou retirée plus haut depuis) ; None si elle n'y est plus."""
    if entier(rang) and 0 <= rang < len(vues) and vues[rang][1] == avant:
        return vues[rang][0]
    return next((i for i, vu in vues if vu == avant), None)


def rejouer(brute: list, vues: list, corps: dict) -> dict:
    """Portage de corpsDuSac (js/aventuriers/etat.js) pour le geste d'un joueur, rejoué sur la liste telle qu'elle est
    (brute : la liste de la fiche, les objets en trois cases au moins ; vues : ce qu'en voit le joueur). Rend
    {liste : {avant, apres}} pour la route du sac, {} s'il n'y a rien à changer ; Refus quand il ne s'applique plus."""
    cle = corps["liste"]
    avant, apres = list(brute), list(brute)
    if corps["geste"] == "ajouter" and cle == "equipement":
        # Déjà dans le sac : la quantité monte. Seulement parmi les lignes que voit le joueur : une ligne retenue pour le
        # MJ ne se devine pas en tapant son nom.
        apres = avec(apres, corps["ligne"], vues)
    elif corps["geste"] == "ajouter":
        # Refusé sur ce que voit le joueur : une case prise par une ligne retenue ne se dit pas, la ligne s'ajoute après.
        if len(vues) >= OBJETS:
            raise Refus(409, OBJETS_PRIS)
        libre = next((i for i, x in enumerate(apres) if not x.strip()), None)
        if libre is None and len(apres) >= LIGNES_MAX:
            raise Refus(409, SAC_PLEIN)
        if libre is None:
            apres.append(corps["ligne"])
        else:
            apres[libre] = corps["ligne"]
    else:
        i = ligne_visee(vues, corps.get("rang"), corps["avant"])
        if i is None and corps["geste"] == "quantite":
            # La quantité a pu changer depuis (un autre geste en route, le MJ) : un de plus ou de moins vaut pour la ligne
            # de ce nom, quel que soit son compte du moment.
            i = rang_du_nom(vues, quantite_de(corps["avant"])[0])
        if i is None:
            raise Refus(409, PLUS_LA)
        if corps["geste"] == "quantite":
            if cle != "equipement":
                raise Refus(400, OBJETS_SANS_COMPTE)
            texte = comptee(apres[i], corps["de"])
        else:
            texte = "" if corps["geste"] == "retirer" else ecrite(cle, corps["ligne"])
        if texte == apres[i]:
            return {}
        if not texte and cle == "equipement":
            del apres[i]
        else:
            apres[i] = texte
    return {cle: {"avant": avant, "apres": apres}}


def verifier_sur_la_fiche(heros: dict, corps: dict, geste: str) -> None:
    """Le coin, avant d'écrire : le geste s'applique-t-il à la fiche publiée (celle que lit le joueur) ? L'atelier le
    revérifie toujours, sur le sac du moment."""
    liste = [x for x in heros.get(corps["liste"]) or [] if isinstance(x, str) and x.strip()]
    vues = list(enumerate(liste))
    if geste == "ajouter":
        if corps["liste"] == "objets" and len(liste) >= OBJETS:
            raise Refus(409, OBJETS_PRIS)
        deja = corps["liste"] == "equipement" and not douteuse(corps["ligne"]) and rang_du_nom(vues, quantite_de(corps["ligne"])[0]) is not None
        if len(liste) >= LIGNES_MAX and not deja:
            raise Refus(409, SAC_PLEIN)
    else:
        i = ligne_visee(vues, corps.get("rang"), corps["avant"])
        if i is None and geste == "quantite":
            i = rang_du_nom(vues, quantite_de(corps["avant"])[0])
        if i is None:
            raise Refus(409, PLUS_LA)
        # Un don de quelques exemplaires : pas plus qu'il n'en lit.
        if "nombre" in corps and (douteuse(liste[i]) or corps["nombre"] > quantite_de(liste[i])[1]):
            raise Refus(409, PLUS_AUTANT)


def touchee(change: dict) -> tuple[str, str]:
    """(la ligne d'avant, la ligne d'après) du premier rang qu'un geste a changé dans une liste ({avant, apres}) ; « »
    pour une ligne née du geste, ou partie avec lui."""
    avant, apres = change["avant"], change["apres"]
    for i in range(max(len(avant), len(apres))):
        a, b = (avant[i] if i < len(avant) else ""), (apres[i] if i < len(apres) else "")
        if a != b:
            return (a, b) if len(apres) >= len(avant) else (a, "")
    return "", ""


# ---------------------------------------------------------------- l'or engagé

def or_engage(commandes: list, liste: list) -> dict:
    """Ce qui attend sur la bourse : les commandes de l'échoppe en attente du MJ, les dons d'or proposés et les versements
    au sanctuaire (lot B2, cagnottes.py)."""
    cmd = sum(c["total"] for c in commandes if isinstance(c, dict) and c.get("statut") == "en-attente"
              and entier(c.get("total")) and c["total"] > 0)
    dons = sum(d["corps"]["montant"] for d in liste if isinstance(d, dict) and d.get("genre") == "don-or"
               and d.get("statut") in demandes.OUVERTS and isinstance(d.get("corps"), dict) and entier(d["corps"].get("montant")))
    versements = cagnottes.verse_en_attente(liste)
    return {"commandes": cmd, "dons": dons, "versements": versements, "total": cmd + dons + versements}


def bourse_de(heros: dict | None) -> int:
    v = (heros or {}).get("or")
    return v if entier(v) and v > 0 else 0


def disponible(heros: dict | None, engage: dict) -> int:
    return max(0, bourse_de(heros) - engage["total"])


def prenom(nom) -> str:
    """« Aldo » pour « Aldo Ferrant » : ce que la boîte du MJ et les phrases du joueur disent d'un héros."""
    mots = re.split(r"[\s,]+", nom.strip()) if isinstance(nom, str) else []
    return mots[0] if mots and mots[0] else "un compagnon"
