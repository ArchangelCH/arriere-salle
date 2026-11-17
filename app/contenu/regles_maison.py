"""Le registre des règles maison : chaque décision de règle du MJ, prise à la table ou en préparant, pour rester cohérent
d'une séance à l'autre et ne plus rouvrir le débat. Une règle est « en vigueur » ou « à trancher » ; son contexte
(pourquoi, quand, remarques) est une note du MJ. Fonctions pures : main.py lit, écrit et sert ; le carnet des joueurs ne
reçoit que regles_publiques (ni contexte, ni règle à trancher, ni règle gardée pour le MJ)."""

import re
from datetime import date

TITRE_MAX = 80
TEXTE_MAX = 2000
CONTEXTE_MAX = 4000
STATUTS = ("a-trancher", "en-vigueur")
CHAMPS = ("titre", "texte", "contexte", "statut", "depuis", "seance", "publique")
# Tenus par le serveur : un écran qui renvoie la règle entière peut les laisser, ils ne sont jamais repris de lui.
GERES = ("id", "cree", "modifie")
ID_SEANCE = re.compile(r"^[a-z0-9-]{1,60}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _paragraphes(v: str) -> str:
    """Une règle tient en quelques lignes : les retours à la ligne restent, les espaces de fin de ligne et les lignes
    vides en trop s'en vont."""
    lignes = [ligne.rstrip() for ligne in v.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lignes)).strip()


def _texte(corps: dict, cle: str, maximum: int, nom: str, ligne: bool = False) -> str:
    v = corps[cle]
    if not isinstance(v, str):
        raise ValueError(f"{nom} : du texte est attendu.")
    v = " ".join(v.split()) if ligne else _paragraphes(v)
    if len(v) > maximum:
        raise ValueError(f"{nom} : {maximum} caractères au plus ({len(v)} ici).")
    return v


def _date(v) -> str | None:
    if v is None or v == "":
        return None
    if not isinstance(v, str) or not DATE.match(v):
        raise ValueError("Date d'entrée en vigueur illisible (AAAA-MM-JJ attendu).")
    try:
        d = date.fromisoformat(v)
    except ValueError:
        raise ValueError("Date d'entrée en vigueur impossible.")
    if not 2000 <= d.year <= 2100:
        raise ValueError("Date d'entrée en vigueur hors de portée.")
    return v


def regle_valide(corps: dict, avant: dict | None, seance_existe, aujourdhui: date) -> dict:
    """La règle telle qu'elle s'enregistre : celle d'avant (None à la création) avec les champs envoyés, vérifiés un à un.
    Un champ inconnu, un type faux, un texte trop long, une séance qui n'existe pas : ValueError, et rien n'est écrit.
    `depuis` (entrée en vigueur) se pose seul : aujourd'hui quand la règle est créée en vigueur ou tranchée, rien tant
    qu'elle est à trancher ; le MJ peut le corriger."""
    inconnus = sorted(k for k in corps if k not in CHAMPS and k not in GERES)
    if inconnus:
        raise ValueError(f"Champ inconnu : {', '.join(inconnus)}.")
    avant = avant or {}
    r = {
        "titre": avant.get("titre", ""), "texte": avant.get("texte", ""), "contexte": avant.get("contexte", ""),
        "statut": avant.get("statut") if avant.get("statut") in STATUTS else "en-vigueur", "depuis": avant.get("depuis"),
        "seance": avant.get("seance") or "", "publique": avant.get("publique", True) is not False,
    }
    if "titre" in corps:
        r["titre"] = _texte(corps, "titre", TITRE_MAX, "Titre", ligne=True)
    if not r["titre"]:
        raise ValueError("Une règle a besoin d'un titre.")
    if "texte" in corps:
        r["texte"] = _texte(corps, "texte", TEXTE_MAX, "Texte de la règle")
    if "contexte" in corps:
        r["contexte"] = _texte(corps, "contexte", CONTEXTE_MAX, "Contexte")
    if "statut" in corps:
        if corps["statut"] not in STATUTS:
            raise ValueError("Statut inconnu : « en-vigueur » ou « a-trancher ».")
        r["statut"] = corps["statut"]
    if "publique" in corps:
        if not isinstance(corps["publique"], bool):
            raise ValueError("Publique : vrai ou faux.")
        r["publique"] = corps["publique"]
    if "seance" in corps:
        s = "" if corps["seance"] is None else corps["seance"]
        if not isinstance(s, str) or (s and not ID_SEANCE.match(s)):
            raise ValueError("Séance : identifiant invalide.")
        # Une séance partie à la corbeille depuis ne bloque pas la règle qui la nommait déjà.
        if s and s != (avant.get("seance") or "") and not seance_existe(s):
            raise ValueError("Cette séance n'existe pas, ou plus.")
        r["seance"] = s
    depuis = _date(corps["depuis"]) if "depuis" in corps else None
    if r["statut"] == "a-trancher":
        r["depuis"] = None
    elif depuis:
        r["depuis"] = depuis
    elif avant.get("statut") != "en-vigueur" or not r["depuis"] or "depuis" in corps:
        r["depuis"] = aujourdhui.isoformat()
    return r


def date_de(r: dict) -> str:
    """La date d'une règle en vigueur : son entrée en vigueur, sinon le jour où elle a été notée."""
    return r.get("depuis") or str(r.get("cree") or "")[:10]


def trier(regles: list) -> list:
    """À trancher d'abord, puis en vigueur ; les plus récentes en tête de chaque groupe."""
    a_trancher = sorted((r for r in regles if r.get("statut") == "a-trancher"),
                        key=lambda r: str(r.get("cree") or ""), reverse=True)
    en_vigueur = sorted((r for r in regles if r.get("statut") != "a-trancher"),
                        key=lambda r: (date_de(r), str(r.get("cree") or "")), reverse=True)
    return a_trancher + en_vigueur


def regles_publiques(regles: list, jeton) -> list:
    """Ce que lit le carnet des joueurs : les règles en vigueur et publiques, les plus récentes d'abord, sans contexte ni
    séance. L'identifiant est un jeton opaque : celui de la fiche vient du titre, qui peut porter un nom caché."""
    elements = []
    for r in regles:
        if r.get("statut") != "en-vigueur" or r.get("publique", True) is not True or not isinstance(r.get("id"), str):
            continue
        titre, texte = r.get("titre"), r.get("texte")
        if not isinstance(titre, str) or not titre.strip():
            continue
        elements.append({"id": jeton(r["id"]), "titre": titre, "texte": texte if isinstance(texte, str) else "",
                         "date": date_de(r)})
    elements.sort(key=lambda x: x["titre"].casefold())
    elements.sort(key=lambda x: x["date"], reverse=True)
    return elements
