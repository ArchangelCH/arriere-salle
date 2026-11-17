"""Les horloges de la menace : « Le toit va céder », « Les chasseurs approchent ». Un cadran découpé en 4, 6 ou 8 parts
que le MJ remplit une à une ; montré à la TV, il fait sentir aux joueurs que le temps file.

Trois au plus par MJ (lot MJ-4 : chacun voit et règle les siennes, « auteur » ; absent : le principal), rangées dans
l'état de la table (table.json, clé « horloges ») et changées seulement par leurs routes :
un écran qui renvoie la table, ou l'accueil seul, les garde. « touchee » est le rang du dernier geste du MJ sur
chacune (1, 2, 3… : un compteur, deux gestes rapprochés ne se confondent pas) ; la touche H avance l'horloge montrée
touchée en dernier, ou la dernière touchée quand aucune n'est montrée. Fonctions pures : main.py lit, écrit et
diffuse ; la TV et la table publique ne reçoivent que publiques() : trois au plus, celles qui sont montrées, quel que soit
le MJ, les plus récemment touchées quand les deux en montrent plus.
"""
import re
import secrets

from table.masque import masquer_tout

MAX = 3
PARTS = (4, 6, 8)
NOM_MAX = 40
ID = re.compile(r"^[a-z0-9]{1,12}$")
CHAMPS_PUBLICS = ("id", "nom", "parts", "remplies")
AUTEUR = re.compile(r"[a-z0-9-]{1,40}")


class Refus(ValueError):
    """Une demande refusée ; statut : le code HTTP que main.py renvoie."""

    def __init__(self, message: str, statut: int = 400):
        super().__init__(message)
        self.statut = statut


def _entier(v):
    # Un vrai entier JSON : ni booléen, ni nombre à virgule, ni chaîne.
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def nom(v) -> str:
    if not isinstance(v, str):
        raise Refus("Le nom de l'horloge est attendu.")
    propre = " ".join(v.split())
    if not propre:
        raise Refus("Donnez un nom à l'horloge.")
    if len(propre) > NOM_MAX:
        raise Refus(f"Nom trop long : {NOM_MAX} caractères au plus.")
    return propre


def parts(v) -> int:
    if _entier(v) not in PARTS:
        raise Refus("Une horloge a 4, 6 ou 8 parts.")
    return v


def remplies(v, n: int) -> int:
    k = _entier(v)
    if k is None or not 0 <= k <= n:
        raise Refus(f"Parts remplies : un entier de 0 à {n}.")
    return k


def visible(v) -> bool:
    if not isinstance(v, bool):
        raise Refus("Champ « visible » attendu : vrai ou faux.")
    return v


def de_l_etat(etat: dict) -> list:
    """Les horloges de l'état de la table, sûres : une entrée abîmée (fichier retouché à la main) est laissée de côté,
    ses parts remplies ramenées dans leurs bornes."""
    brutes = etat.get("horloges") if isinstance(etat, dict) else None
    liste, vus, par_auteur = [], set(), {}
    for h in brutes if isinstance(brutes, list) else []:
        if not isinstance(h, dict) or not isinstance(h.get("id"), str) or not ID.match(h["id"]) or h["id"] in vus:
            continue
        try:
            propre = {"id": h["id"], "nom": nom(h.get("nom")), "parts": parts(h.get("parts"))}
        except Refus:
            continue
        propre["remplies"] = max(0, min(propre["parts"], _entier(h.get("remplies")) or 0))
        propre["visible"] = h.get("visible") is True
        propre["touchee"] = max(0, _entier(h.get("touchee")) or 0)
        # L'horloge d'un MJ invité porte son compte (absent : le principal) ; seul son MJ la relit (main.py).
        if isinstance(h.get("auteur"), str) and AUTEUR.fullmatch(h["auteur"]):
            propre["auteur"] = h["auteur"]
        # Trois au plus par MJ : au-delà (un fichier retouché), les suivantes sont laissées de côté.
        auteur = propre.get("auteur", "")
        if par_auteur.get(auteur, 0) == MAX:
            continue
        par_auteur[auteur] = par_auteur.get(auteur, 0) + 1
        vus.add(h["id"])
        liste.append(propre)
    return liste


def nouvel_id(liste: list) -> str:
    pris = {h["id"] for h in liste}
    while True:
        ident = secrets.token_hex(3)
        if ident not in pris:
            return ident


def rang_suivant(liste: list) -> int:
    return 1 + max((h["touchee"] for h in liste), default=0)


def creer(liste: list, corps: dict) -> dict:
    """Ajoute une horloge : un nom, 4, 6 ou 8 parts ; vide et cachée sauf demande contraire."""
    if len(liste) >= MAX:
        raise Refus("Trois horloges au plus : supprimez-en une d'abord.", 409)
    n = parts(corps.get("parts"))
    h = {"id": nouvel_id(liste), "nom": nom(corps.get("nom")), "parts": n, "remplies": remplies(corps.get("remplies", 0), n),
         "visible": visible(corps.get("visible", False)), "touchee": rang_suivant(liste)}
    liste.append(h)
    return h


def modifier(liste: list, h: dict, corps: dict) -> dict:
    """Applique les champs reçus (nom, parts, remplies, pas, visible), tous valides ou aucun. pas : +1 ou -1, sans sortir
    de 0 ni du nombre de parts (touches H et Maj+H) ; moins de parts ramène les parts remplies dans la borne. Chaque
    geste en fait la dernière touchée, même sans effet (un clic sur une horloge déjà pleine)."""
    neuf = dict(h)
    if "nom" in corps:
        neuf["nom"] = nom(corps["nom"])
    if "parts" in corps:
        neuf["parts"] = parts(corps["parts"])
        neuf["remplies"] = min(neuf["remplies"], neuf["parts"])
    if "remplies" in corps:
        neuf["remplies"] = remplies(corps["remplies"], neuf["parts"])
    if "pas" in corps:
        pas = _entier(corps["pas"])
        if pas not in (-1, 1):
            raise Refus("Champ « pas » attendu : 1 ou -1.")
        neuf["remplies"] = max(0, min(neuf["parts"], neuf["remplies"] + pas))
    if "visible" in corps:
        neuf["visible"] = visible(corps["visible"])
    neuf["touchee"] = rang_suivant(liste)
    h.update(neuf)
    return h


def trouver(liste: list, ident: str) -> dict:
    h = next((x for x in liste if x["id"] == ident), None)
    if not h:
        raise Refus("Cette horloge n'existe plus : elle a été supprimée depuis un autre écran.", 404)
    return h


def avancer(liste: list, corps: dict) -> dict:
    """Touche H (Maj+H : pas -1) : l'horloge montrée à la TV que le MJ a touchée en dernier avance d'une part. Aucune
    n'est montrée (elles naissent cachées) : la dernière touchée avance quand même, et l'atelier propose de la montrer."""
    h = la_plus_recente(liste) or (max(liste, key=lambda x: x["touchee"]) if liste else None)
    if not h:
        raise Refus("Aucune horloge pour l'instant : créez-en une dans le Tableau.", 409)
    return modifier(liste, h, {"pas": corps.get("pas", 1)})


def retirer(liste: list, ident: str) -> None:
    # Déjà supprimée depuis un autre écran : rien ne change.
    liste[:] = [h for h in liste if h["id"] != ident]


def la_plus_recente(liste: list) -> dict | None:
    """L'horloge montrée à la TV que le MJ a touchée en dernier (celle que H avance), ou None."""
    montrees = [h for h in liste if h["visible"]]
    return max(montrees, key=lambda h: h["touchee"]) if montrees else None


def publiques(liste: list) -> list:
    """Ce que voient la TV et la table publique : les horloges montrées, rien d'autre que leur identifiant, leur nom
    (passé par masquer_tout : le nom caché de l'auberge devient « l'auberge »), leurs parts et leurs parts remplies. Trois
    au plus, comme la TV en montre : avec deux MJ, les plus récemment touchées, dans l'ordre de la liste."""
    montrees = [h for h in liste if h["visible"]]
    if len(montrees) > MAX:
        gardees = {id(h) for h in sorted(montrees, key=lambda h: h["touchee"], reverse=True)[:MAX]}
        montrees = [h for h in montrees if id(h) in gardees]
    return masquer_tout([{k: h[k] for k in CHAMPS_PUBLICS} for h in montrees])
