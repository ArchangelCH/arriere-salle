"""Les pions enrichis d'un plan, tels que les voit la table : tailles, formes et cadres, états posés d'un clic,
groupes, montures, étiquettes, nom visible ou non, et l'image choisie par le MJ.

Partagé par l'atelier (main.py, plan_public) et ses déplacements (mouvements.py) ; jumeau des constantes de
js/plan/pions.js. Tout champ absent garde le pion d'avant : un plan d'avant ce lot sort à l'identique.

Ce qui ne sort jamais vers la TV ni vers le coin :
  - un pion « invisible » : il suit la règle du pion caché (absent de la projection, il ne barre ni ne trahit rien) ;
  - le nom, l'étiquette et l'image d'un PNJ que les joueurs ne connaissent pas (la règle des PNJ inconnus reste) ;
  - la monture d'un cavalier quand elle n'est pas montrée elle-même (son identifiant dirait qu'elle est là) ;
  - la note du MJ, le nom de l'image dans la bibliothèque, son fichier d'origine.
"""
import re

from table import masque

# Les états posés d'un clic (js/plan/pions.js, ETATS_PION). « À terre » reste le champ « tombe » d'avant.
ETATS = ("empoisonne", "en-feu", "etourdi", "entrave", "effraye", "concentre", "beni", "maudit", "invisible")
INVISIBLE = "invisible"
FORMES = ("carre", "blason")  # « rond », la forme d'avant, ne s'écrit pas
EPAISSEURS = (0.5, 1.8)  # fin, épais ; 1 (normal) ne s'écrit pas
GROUPE_MAX = 99
ETIQUETTE_MAX = 24
MEDIA = re.compile(r"^/media/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$")


def chaine(v) -> str:
    return v if isinstance(v, str) else ""


def etats_du_pion(t: dict) -> list:
    """Les états connus du pion, sans doublon, dans l'ordre de la liste."""
    v = t.get("etats")
    if not isinstance(v, list):
        return []
    return [e for e in ETATS if e in v]


def invisible(t: dict) -> bool:
    return isinstance(t, dict) and INVISIBLE in etats_du_pion(t)


def nom_secret(t: dict, genre_ref: str, fiche: dict | None) -> bool:
    """Un PNJ que les joueurs ne connaissent pas (par sa fiche, ou un pion de PNJ sans fiche) : ni nom, ni étiquette, ni
    image ne sortent, quoi qu'en dise le pion."""
    if genre_ref == "pnj":
        return not (fiche and fiche.get("connu"))
    return t.get("genre") == "pnj"


def plus_public(t: dict, pub: dict, genre_ref: str, fiche: dict | None, media_existant) -> dict:
    """Les champs du lot H2 que reçoit la table pour ce pion, à fusionner dans pion_public avant la règle de la lettre
    courte. Rien pour un pion d'avant : un dictionnaire vide."""
    plus: dict = {}
    secret = nom_secret(t, genre_ref, fiche)
    # Le nom visible des joueurs ou non, par pion : caché, il ne part pas (même d'un héros) ; montré, un adversaire le
    # porte aussi. Un PNJ inconnu reste sans nom.
    if t.get("nom_visible") is False and pub.get("nom"):
        plus["nom"] = ""
    elif t.get("nom_visible") is True and not pub.get("nom") and not secret and t.get("genre") == "ennemi":
        plus["nom"] = chaine(t.get("nom")).strip()[:80]
        if plus["nom"]:
            # Le dessin n'écrit le nom d'un adversaire que si le MJ l'a rendu visible (js/plan/rendu.js).
            plus["nom_visible"] = True
    # L'image choisie par le MJ (bibliothèque ou import) : à la place du portrait de la fiche, sauf pour un PNJ inconnu.
    image = t.get("image_libre")
    if isinstance(image, str) and MEDIA.match(image) and not secret and media_existant(image):
        plus["image"] = image
        plus["image_libre"] = True
    if t.get("forme") in FORMES:
        plus["forme"] = t["forme"]
    e = t.get("epaisseur")
    if isinstance(e, (int, float)) and not isinstance(e, bool) and e in EPAISSEURS:
        plus["epaisseur"] = e
    etats = [x for x in etats_du_pion(t) if x != INVISIBLE]
    if etats:
        plus["etats"] = etats
    g = t.get("groupe")
    if isinstance(g, int) and not isinstance(g, bool) and 2 <= g <= GROUPE_MAX:
        plus["groupe"] = g
    # Masquée avant d'être coupée : un nom caché coupé en route ne se reconnaîtrait plus.
    etiquette = masque.masquer(" ".join(chaine(t.get("etiquette")).split()))[:ETIQUETTE_MAX].strip()
    if etiquette and not secret:
        plus["etiquette"] = etiquette
    return plus


def lier_familiers(publics: list, pions: list) -> None:
    """Le familier d'un héros (ref « familier:<aventurier> ») et son maître : l'identifiant du pion de son héros, seulement
    si celui-ci est montré lui aussi (le fil qui les relie sur la TV ne trahit pas un héros caché)."""
    par_id = {t.get("id"): t for t in pions if isinstance(t, dict)}
    heros = {}
    for pub in publics:
        genre, _, ident = chaine((par_id.get(pub.get("id")) or {}).get("ref")).partition(":")
        if genre == "aventurier" and ident:
            heros.setdefault(ident, pub.get("id"))
    for pub in publics:
        genre, _, ident = chaine((par_id.get(pub.get("id")) or {}).get("ref")).partition(":")
        if genre == "familier" and ident in heros and heros[ident] != pub.get("id"):
            pub["maitre"] = heros[ident]


def lier_montures(publics: list, pions: list) -> None:
    """La monture d'un cavalier, seulement si elle est montrée elle aussi (sur place, dans la liste publique)."""
    montres = {t.get("id") for t in publics}
    par_id = {t.get("id"): t for t in pions if isinstance(t, dict)}
    for pub in publics:
        t = par_id.get(pub.get("id")) or {}
        m = t.get("monture")
        if isinstance(m, str) and m != pub.get("id") and m in montres:
            pub["monture"] = m
