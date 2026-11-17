"""Ce que la table publique (un écran venu d'Internet) peut lire de /api/table/… : seulement ce que la TV montre en ce
moment. La planche quand la TV montre la planche, le plan qu'elle montre et pas un autre, le carton d'un PNJ tant qu'il
est à l'écran. Le sanctuaire suivait déjà cette règle (il dévoilait la fin d'une séance) ; un joueur qui garde un jeton
ne relit plus une fiche le mardi, ni une vue que la TV ne montre pas.

La TV du salon, l'atelier en ligne et le réseau local ne passent pas par ici (main.py, Garde). Fonction pure : main.py
lui donne l'état de la table et sa fonction de jetons.
"""
import hmac
import re

# /api/table/<quoi>, /api/table/<quoi>/<jeton>, /api/table/<quoi>/<jeton>/fond, /api/table/plan/<jeton>/image/<objet>
CHEMIN = re.compile(r"^/api/table/(?P<quoi>[a-z]+)(?:/(?P<jeton>[^/]+)(?P<fond>/fond|/image/[A-Za-z0-9_-]{1,40})?)?$")

# Les vues entières, sans fiche : lisibles quand la TV les montre.
VUES = {"planche": "planche", "heros": "heros", "fiches": "fiches", "sanctuaire": "sanctuaire"}
# Une fiche désignée par son jeton : (clé de l'état, collection des jetons, vue qu'elle demande ; None : un carton posé
# par-dessus n'importe quelle vue). Le combat suit sa route : le bandeau que le MJ a montré, tant qu'il le montre.
FICHES = {
    "carte": ("carte", "cartes", "carte"),
    "plan": ("plan", "plans", "plan"),
    "lieu": ("lieu", "lieux", "carte"),
    "boutique": ("boutique", "boutiques", "boutique"),
    "precedemment": ("seance", "seances", "precedemment"),
    "episode": ("seance", "seances", "episode"),
    "pnj": ("pnj", "pnj", None),
    "rumeur": ("rumeur", "rumeurs", None),
    "document": ("document", "documents", "document"),
    "aventurier": ("aventurier", "aventuriers", None),
    "combat": ("combat", "seances", None),
}
# Les fonds d'image n'existent que pour la carte et le plan (et les images à demi révélées, pour le plan seul).
AVEC_FOND = {"carte", "plan"}
# Les portraits réduits de la table publique : seulement ceux d'une image que cite une lecture que la TV montre en ce
# moment (medias_cites sur les réponses de chemins_montres) ; main.py en donne la liste à montre().
LIBRES = {"vignette"}
MEDIA_CITE = re.compile(r"/media/([A-Za-z0-9][A-Za-z0-9._-]{0,120})")


def connues() -> set[str]:
    """Toutes les routes de lecture que la règle connaît : une route de la table ajoutée sans être rangée ici resterait
    fermée à Internet (les essais le vérifient)."""
    return set(VUES) | set(FICHES) | LIBRES


def montre(chemin: str, etat: dict, jeton, medias=None) -> bool:
    """Vrai si la TV montre en ce moment ce que lit ce chemin. etat : l'état de la table (vrais identifiants) ;
    jeton(collection, ident) : le jeton qu'en reçoit la TV ; medias : les noms d'images que citent les lectures
    montrées (pour une vignette ; sans eux, aucune)."""
    m = CHEMIN.match(chemin or "")
    if not m or not isinstance(etat, dict):
        return False
    quoi, j, fond = m.group("quoi"), m.group("jeton"), m.group("fond")
    if quoi in LIBRES:
        return bool(j) and not fond and medias is not None and j in medias
    if quoi in VUES:
        return j is None and etat.get("vue") == VUES[quoi]
    if quoi not in FICHES or not j or (fond and quoi not in AVEC_FOND):
        return False
    # Une image du MJ à demi révélée (main.py, table_plan_image) : seulement sur le plan que montre la TV.
    if fond and fond.startswith("/image/") and quoi != "plan":
        return False
    cle, collection, vue = FICHES[quoi]
    ident = etat.get(cle)
    if not isinstance(ident, str) or not ident or (vue and etat.get("vue") != vue):
        return False
    return hmac.compare_digest(jeton(collection, ident), j)


def chemins_montres(etat: dict, jeton) -> list:
    """Les lectures (sans fond ni image) que montre() laisse passer pour cet état : celles où la TV lit ce qu'elle montre."""
    if not isinstance(etat, dict):
        return []
    sortie = [f"/api/table/{quoi}" for quoi, vue in VUES.items() if etat.get("vue") == vue]
    for quoi, (cle, collection, vue) in FICHES.items():
        ident = etat.get(cle)
        if isinstance(ident, str) and ident and (not vue or etat.get("vue") == vue):
            sortie.append(f"/api/table/{quoi}/{jeton(collection, ident)}")
    return sortie


def medias_cites(texte: str) -> set:
    """Les noms d'images (/media/<nom>) que cite une réponse."""
    return set(MEDIA_CITE.findall(texte or ""))
