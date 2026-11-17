"""Les dés libres : « 2D6+1 », lu, validé et lancé par l'atelier. Le joueur jette depuis la feuille « Lancer un
test » du coin des D4, D6, D8, D10, D12, D20 ou D100, de un à cinq dés, avec un bonus ; ou les dégâts d'une arme de sa
fiche (« Épée : 1D10 »). Il n'envoie que l'expression, jamais un résultat : les dés roulent ici, comme le D100 des tests.

Aussi le D6 des dés d'aventure et de mésaventure (règle du kit, chapitre 08) : sa face et son effet.

Le jumeau de la page est js/jets/des.js : mêmes bornes, même lecture. Les cas communs sont dans tests/des-cas.json
(outils/verifier_des.mjs, tests/test_des.py).

Ce module ne lit rien : l'atelier et le coin l'importent tous deux.
"""
import re
import secrets

FACES = (4, 6, 8, 10, 12, 20, 100)
NOMBRE_MAX = 5
BONUS_MAX = 20
TEXTE_MAX = 30
# Les espaces permis dans une expression : l'espace, l'insécable et l'insécable fine (un clavier français en met). Écrits un
# par un : \s et \d n'ont pas les mêmes ensembles en Python et en JavaScript.
_ESP = "[   ]*"
EXPRESSION = re.compile(rf"^{_ESP}([0-9]{{1,2}})?{_ESP}[dD]{_ESP}([0-9]{{1,3}}){_ESP}(?:([-+−]){_ESP}([0-9]{{1,3}}))?{_ESP}$")

# Le D6 d'aventure : 1-2 Mouvement, 3-4 Posture, 5-6 In extremis. L'effet est annoncé, jamais calculé (choix du MJ du
# 09/11) : le MJ tranche.
FACES_AVENTURE = 6
EFFETS = {1: "Mouvement", 2: "Mouvement", 3: "Posture", 4: "Posture", 5: "In extremis", 6: "In extremis"}


def ecrire(nombre: int, faces: int, bonus: int = 0) -> str:
    """L'expression écrite proprement : « 2D6+1 », « 1D4-1 », « 3D8 »."""
    return f"{nombre}D{faces}" + (f"+{bonus}" if bonus > 0 else f"-{-bonus}" if bonus < 0 else "")


def lire(texte) -> dict | None:
    """{nombre, faces, bonus, texte} d'une expression lisible et dans les bornes, sinon None. « D6 » vaut « 1D6 »."""
    if not isinstance(texte, str) or len(texte) > TEXTE_MAX:
        return None
    m = EXPRESSION.fullmatch(texte)
    if not m:
        return None
    nombre = int(m.group(1)) if m.group(1) is not None else 1
    faces = int(m.group(2))
    bonus = int(m.group(4) or 0) * (-1 if m.group(3) in ("-", "−") else 1)
    if not 1 <= nombre <= NOMBRE_MAX or faces not in FACES or abs(bonus) > BONUS_MAX:
        return None
    return {"nombre": nombre, "faces": faces, "bonus": bonus, "texte": ecrire(nombre, faces, bonus)}


def lancer(expression: dict, hasard=None) -> dict:
    """Les dés de l'expression lue (lire), tirés par l'atelier : {texte, nombre, faces, bonus, des, total}. Le total est la
    somme des dés plus le bonus, tel quel (un bonus négatif peut le mener sous zéro : c'est le choix du joueur)."""
    des = [(hasard or secrets).randbelow(expression["faces"]) + 1 for _ in range(expression["nombre"])]
    return {**{k: expression[k] for k in ("texte", "nombre", "faces", "bonus")}, "des": des, "total": sum(des) + expression["bonus"]}


def face(v) -> int | None:
    """Une face de D6 choisie (un avantage dépensé, le désavantage du héros) : un entier de 1 à 6, sinon None."""
    return v if isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= FACES_AVENTURE else None


def rouler_d6(hasard=None) -> int:
    return (hasard or secrets).randbelow(FACES_AVENTURE) + 1


def effet(f: int) -> str:
    return EFFETS.get(f, "")
