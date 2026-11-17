"""La charte visuelle des portraits : ce que le peintre doit savoir du monde de la campagne pour qu'un nain soit un nain
et qu'un prêtre vêtu de blanc ne sorte pas en rouge.

Chaque repère (un peuple, un temple, un ordre…) se déclenche par des mots de la description du personnage. Il apporte
une allure, des couleurs et des interdits, en français : le modèle de l'API les traduit dans la consigne. « appuyer »
donne des mots anglais, séparés par des virgules, que l'atelier met en tête de consigne avec du poids, (dwarf:1.4) :
il vaut mieux dire au générateur ce qu'on veut voir. « dwarf » seul lui fait peindre des oreilles d'elfe ou des cornes
(mesuré le 02/11) : c'est le guidage des portraits (cfg_portrait et APG, dans comfy/reglages.json) qui rend les
interdits efficaces, pas une coiffe imposée. « cadrage » impose un cadrage (un nain en buste ressemble à un humain
barbu : en mi-corps, sa carrure se voit).

La charte de départ vient de la campagne (campagne/univers.py) : elle suit sa bible quand elle dit quelque chose (la
tenue d'un ordre, la couleur d'un temple) ; le reste est une proposition, marquée « à valider » jusqu'à ce que le MJ la
relise.
"""
import re
import secrets
import unicodedata

from campagne import univers

TYPES = ("peuple", "faction", "lieu", "autre")
CADRAGES = ("", "buste", "mi-corps", "trois-quarts")
LONGUEURS = {"nom": 80, "allure": 600, "couleurs": 200, "interdits": 300, "appuyer": 120}
MAX_ENTREES = 80
MAX_MOTS = 20

CHARTE_DEPART = univers.CHARTE_DEPART


def sans_accents(t: str) -> str:
    t = re.sub(r"[’ʼ`]", "'", t or "")
    return unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower()


def _texte(v, n: int) -> str:
    return " ".join(str(v or "").split())[:n] if isinstance(v, (str, int, float)) else ""


def _id(nom: str, pris: set) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", sans_accents(nom)).strip("-")[:40] or "repere"
    ident = base
    while ident in pris:
        ident = f"{base}-{secrets.token_hex(2)}"
    return ident


def nettoyer(entrees) -> list[dict]:
    """La charte telle qu'on l'enregistre : champs connus, longueurs bornées, mots en minuscules sans accents."""
    if not isinstance(entrees, list):
        raise ValueError("La charte doit être une liste de repères")
    propres, pris = [], set()
    for brut in entrees[:MAX_ENTREES]:
        if not isinstance(brut, dict):
            continue
        nom = _texte(brut.get("nom"), LONGUEURS["nom"])
        mots = brut.get("mots")
        if isinstance(mots, str):
            mots = mots.split(",")
        mots = [m for m in (" ".join(sans_accents(str(x)).split()) for x in (mots or []) if isinstance(x, str)) if m][:MAX_MOTS]
        ident = brut.get("id") if isinstance(brut.get("id"), str) and re.fullmatch(r"[a-z0-9-]{1,48}", brut["id"]) else ""
        if not ident or ident in pris:
            ident = _id(nom, pris)
        pris.add(ident)
        appuyer = ", ".join(x for x in (" ".join(m.split()) for m in re.sub(r"[^a-z ,-]", "", _texte(brut.get("appuyer"), LONGUEURS["appuyer"]).lower()).split(",")) if x)
        propres.append({
            "id": ident, "type": brut.get("type") if brut.get("type") in TYPES else "autre", "nom": nom, "mots": mots,
            "appuyer": appuyer, "cadrage": brut.get("cadrage") if brut.get("cadrage") in CADRAGES else "",
            "allure": _texte(brut.get("allure"), LONGUEURS["allure"]),
            "couleurs": _texte(brut.get("couleurs"), LONGUEURS["couleurs"]),
            "interdits": _texte(brut.get("interdits"), LONGUEURS["interdits"]),
            "a_valider": bool(brut.get("a_valider")),
        })
    return propres


def reperes(description: str, entrees: list[dict]) -> list[dict]:
    """Les repères dont un mot apparaît dans la description (mot entier, sans tenir compte des accents ni des majuscules)."""
    texte = " ".join(sans_accents(description).split())
    trouves = []
    for e in entrees or []:
        for mot in e.get("mots") or []:
            m = re.escape(mot).replace(r"\ ", r"\s+")
            if re.search(rf"(?<![a-z0-9]){m}(?![a-z0-9])", texte):
                trouves.append(e)
                break
    return trouves


def a_quelque_chose(e: dict) -> bool:
    return any(e.get(k) for k in ("allure", "couleurs", "interdits", "appuyer", "cadrage"))


def en_texte(trouves: list[dict]) -> str:
    """Les repères tels que le modèle de l'API les lit, en français."""
    lignes = []
    for e in trouves:
        if not a_quelque_chose(e):
            continue
        morceaux = [f"- {e['nom']}"]
        if e.get("allure"):
            morceaux.append(f"allure : {e['allure']}")
        if e.get("couleurs"):
            morceaux.append(f"couleurs : {e['couleurs']}")
        if e.get("interdits"):
            morceaux.append(f"à ne jamais montrer : {e['interdits']}")
        lignes.append(" ; ".join(morceaux))
    return "\n".join(lignes)


def cadrage(trouves: list[dict]) -> str:
    return next((e["cadrage"] for e in trouves if e.get("cadrage")), "")


def appuis(trouves: list[dict]) -> list[str]:
    vus = []
    for e in trouves:
        for mot in (m.strip() for m in (e.get("appuyer") or "").split(",")):
            if mot and mot not in vus:
                vus.append(mot)
    return vus


def impose_couleurs(trouves: list[dict]) -> bool:
    return any(e.get("couleurs") for e in trouves)
