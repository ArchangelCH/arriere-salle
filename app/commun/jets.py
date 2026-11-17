"""Le jet d'un test, lancé par le serveur : les activités entre les séances et les jets à distance s'en
servent.

Un test du jeu : un D100, réussi s'il tombe sur la valeur visée ou en dessous. 01 à 05 : réussite critique, quoi que
vaille la valeur ; 96 à 100 : échec critique. En posture offensive (choix du 12/11), les deux s'élargissent : 01 à
10 et 91 à 100. Les seuils se passent en paramètre (seuils_de) : jet() ne lit jamais la posture sur la fiche, les activités
entre les séances gardent donc toujours les seuils ordinaires. La valeur visée vaut la caractéristique de la fiche, plus le meilleur bonus
parmi les compétences du héros qui aident, plus un modificateur (la difficulté), plus des ajustements nommés (le carton du
héros, jets_distance.ajustements).

Rien ici ne vient du joueur : la fiche est celle que l'atelier tient, le dé sort de secrets. Le coin des joueurs s'en sert
pour dire ses chances au joueur, jamais pour lancer. Jamais de +5 % de focus dans ces jets (choix du 09/11).

Ce module ne lit rien : l'atelier et le coin l'importent tous deux.
"""
import re
import secrets
import unicodedata

CARACS = {"physique": "Physique", "social": "Social", "mental": "Mental"}
REUSSITE_CRITIQUE, REUSSITE, ECHEC, ECHEC_CRITIQUE = "reussite-critique", "reussite", "echec", "echec-critique"
ISSUES = (REUSSITE_CRITIQUE, REUSSITE, ECHEC, ECHEC_CRITIQUE)
NOMS_ISSUES = {REUSSITE_CRITIQUE: "Réussite critique", REUSSITE: "Réussite", ECHEC: "Échec", ECHEC_CRITIQUE: "Échec critique"}
CRITIQUE_REUSSI = 5  # 01 à 05
CRITIQUE_RATE = 96  # 96 à 100
SEUILS = (CRITIQUE_REUSSI, CRITIQUE_RATE)
SEUILS_OFFENSIFS = (10, 91)  # posture offensive : 01 à 10, 91 à 100
FACES = 100
VALEUR_MAX = 999  # comme les caractéristiques d'une fiche (carnet.NOMBRES)
MODIFICATEUR_MAX = 100
AJUSTEMENTS_MAX = 6


def simple(t) -> str:
    """Comme simple() de js/aventuriers/regles.js : sans accents, apostrophes droites, sans casse."""
    t = unicodedata.normalize("NFD", str(t or ""))
    t = "".join(c for c in t if not unicodedata.combining(c)).replace("’", "'")
    return " ".join(t.split()).lower()


def souche(nom) -> str:
    """Le nom d'une compétence sans sa précision : « Artisanat » pour « Artisanat (forge) » ou « Artisanat, fabriquer »."""
    return simple(re.split(r"[(,:]", str(nom or ""), maxsplit=1)[0])


def aide(nom_du_heros, nom_qui_aide) -> bool:
    """La compétence de la fiche est-elle l'une de celles qui aident ? Le même nom, ou la même souche : « Artisanat (forge) »
    aide quand « Artisanat » aide, et « Artisanat » aide quand « Artisanat (forge) » est demandé."""
    a, b = simple(nom_du_heros), simple(nom_qui_aide)
    return bool(a and b) and (a == b or souche(nom_du_heros) == souche(nom_qui_aide))


def entier(v, bas: int, haut: int, defaut: int = 0) -> int:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v in (float("inf"), float("-inf")):
        return defaut
    return int(round(min(haut, max(bas, v))))


def meilleure_aide(fiche: dict, competences) -> tuple[str, int]:
    """(nom, bonus) de la compétence de la fiche qui aide le plus ; ("", 0) si aucune n'aide. Un bonus négatif ne s'emploie
    pas : on ne prend pas une compétence qui gêne."""
    meilleur = ("", 0)
    demandees = [c for c in competences or [] if isinstance(c, str) and c.strip()]
    for c in (fiche or {}).get("competences") or []:
        if not isinstance(c, dict) or not isinstance(c.get("nom"), str) or not c["nom"].strip():
            continue
        bonus = entier(c.get("bonus"), -VALEUR_MAX, VALEUR_MAX)
        if bonus > meilleur[1] and any(aide(c["nom"], x) for x in demandees):
            meilleur = (c["nom"].strip(), bonus)
    return meilleur


def visee(fiche: dict, carac: str, competences=(), modificateur=0, ajustements=()) -> dict:
    """La valeur visée et de quoi elle est faite : la caractéristique de la fiche, la compétence qui aide le plus, le
    modificateur, puis chaque ajustement [(libellé, valeur)]."""
    if not isinstance(carac, str) or carac not in CARACS:
        raise ValueError(f"Caractéristique inconnue : {carac!r}")
    base = entier((fiche or {}).get(carac), 0, VALEUR_MAX)
    nom, bonus = meilleure_aide(fiche, competences)
    mod = entier(modificateur, -MODIFICATEUR_MAX, MODIFICATEUR_MAX)
    autres = [{"libelle": str(x)[:60], "valeur": entier(v, -MODIFICATEUR_MAX, MODIFICATEUR_MAX)}
              for x, v in list(ajustements or ())[:AJUSTEMENTS_MAX]]
    total = base + bonus + mod + sum(x["valeur"] for x in autres)
    return {"carac": carac, "carac_nom": CARACS[carac], "base": base, "competence": nom, "bonus": bonus, "modificateur": mod,
            "ajustements": autres, "visee": total}


def seuils_de(posture) -> tuple[int, int]:
    """(dernier dé d'une réussite critique, premier dé d'un échec critique) : élargis en posture offensive seulement. Le
    focus et la défensive n'y changent rien."""
    return SEUILS_OFFENSIFS if posture == "offensive" else SEUILS


def issue(de: int, valeur: int, seuils: tuple[int, int] = SEUILS) -> str:
    if de <= seuils[0]:
        return REUSSITE_CRITIQUE
    if de >= seuils[1]:
        return ECHEC_CRITIQUE
    return REUSSITE if de <= valeur else ECHEC


def reussi(i: str) -> bool:
    return i in (REUSSITE_CRITIQUE, REUSSITE)


def chances(valeur: int, seuils: tuple[int, int] = SEUILS) -> int:
    """Les chances de réussir, en pour cent : jamais moins que les réussites critiques (5, ou 10 en posture offensive),
    jamais plus que ce que laissent les échecs critiques (95, ou 90)."""
    return max(seuils[0], min(seuils[1] - 1, valeur))


def lancer(hasard=None, faces: int = FACES) -> int:
    """Un dé, de 1 à faces. hasard : un objet qui a randbelow (secrets par défaut ; un hasard semé pour les essais)."""
    return (hasard or secrets).randbelow(faces) + 1


def jet(fiche: dict, carac: str, competences=(), modificateur=0, ajustements=(), hasard=None, seuils: tuple[int, int] = SEUILS) -> dict:
    """Le test entier : la valeur visée, le dé, l'issue. Rien de ce qu'un joueur envoie n'y entre. Les seuils des critiques
    sont ceux qu'on passe (seuils_de(posture) pour un jet lancé à la table), jamais lus sur la fiche."""
    v = visee(fiche, carac, competences, modificateur, ajustements)
    de = lancer(hasard)
    i = issue(de, v["visee"], seuils)
    return {**v, "de": de, "issue": i, "issue_nom": NOMS_ISSUES[i], "reussi": reussi(i)}


# ---------------------------------------------------------------- une formule de dés (l'or d'une activité)

DES = (2, 3, 4, 6, 8, 10, 12, 20, 100)
FORMULE = re.compile(
    r"^\s*(?P<signe>[-−])?\s*(?:(?P<n>\d{1,2})?\s*[dD]\s*(?P<f>\d{1,3})|(?P<fixe>\d{1,6}))"
    r"(?:\s*[x×*]\s*(?P<fois>\d{1,3}))?(?:\s*(?P<op>[-+−])\s*(?P<plus>\d{1,5}))?\s*$")
NOMBRE_DE_DES_MAX = 20


def formule(texte) -> dict | None:
    """« 10 », « 2D6 », « 1D6 + 4 », « 2D6 × 5 », « -1D6 » (une perte) : la formule lue, ou None si elle ne se lit pas.
    {signe, des, faces, fixe, fois, plus, texte (écrite proprement)}."""
    m = FORMULE.match(str(texte or "")) if isinstance(texte, (str, int)) and not isinstance(texte, bool) else None
    if not m:
        return None
    signe = -1 if m.group("signe") else 1
    fois = int(m.group("fois") or 1)
    plus = int(m.group("plus") or 0) * (-1 if m.group("op") in ("-", "−") else 1)
    if m.group("fixe") is not None:
        valeur = int(m.group("fixe"))
        propre = f"{'-' if signe < 0 and valeur else ''}{valeur}"
        if fois != 1:
            propre += f" × {fois}"
        if plus:
            propre += f" {'+' if plus > 0 else '-'} {abs(plus)}"
        return {"signe": signe, "des": 0, "faces": 0, "fixe": valeur, "fois": fois, "plus": plus, "texte": propre}
    n, f = int(m.group("n") or 1), int(m.group("f"))
    if not 1 <= n <= NOMBRE_DE_DES_MAX or f not in DES or fois < 1:
        return None
    propre = f"{'-' if signe < 0 else ''}{n}D{f}" + (f" × {fois}" if fois != 1 else "") + (f" {'+' if plus > 0 else '-'} {abs(plus)}" if plus else "")
    return {"signe": signe, "des": n, "faces": f, "fixe": 0, "fois": fois, "plus": plus, "texte": propre}


def tirer(texte, hasard=None) -> dict | None:
    """La formule tirée : {total, des (chaque dé), texte} ; None si elle ne se lit pas. Le total d'une formule négative
    est négatif (une perte) ; celui d'une formule positive ne descend jamais sous zéro."""
    f = formule(texte)
    if f is None:
        return None
    des = [lancer(hasard, f["faces"]) for _ in range(f["des"])]
    brut = (sum(des) if des else f["fixe"]) * f["fois"] + f["plus"]
    total = -max(0, brut) if f["signe"] < 0 else max(0, brut)
    return {"total": total, "des": des, "texte": f["texte"]}
