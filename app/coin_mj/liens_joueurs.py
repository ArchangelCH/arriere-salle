"""Le lien entre un joueur invité et son héros de la tablée : quelle fiche il lit dans le carnet, pour qui partent ses
commandes. Deux façons d'être relié. Soit le MJ a accueilli l'aventurier envoyé depuis le lien du joueur : la proposition
note l'aventurier accueilli, la fiche garde sa source (« joueur:<id> »), et les deux doivent s'accorder. Soit le MJ a
relié depuis l'atelier un héros qu'il avait créé lui-même (Isaure pour Sacha) : c'est noté dans joueurs.json, que le coin
des joueurs ne voit pas, avec la date de création du héros (empreinte) : une fiche nouvelle qui reprendrait plus tard son
identifiant (Isaure jetée, puis un aventurier commencé sans nom) n'hérite pas du lien. Un héros n'a qu'un joueur, un
joueur qu'un héros ; au moindre doute, personne ne le lit.

Fonctions pures : main.py lit les fichiers et sert les routes.
"""
import re

ID = re.compile(r"^[a-z0-9-]{1,60}$")


class Refus(ValueError):
    """Un lien refusé ; statut : le code HTTP que main.py renvoie."""

    def __init__(self, message: str, statut: int = 409):
        super().__init__(message)
        self.statut = statut


def nom_de(a: dict) -> str:
    return " ".join(a.get("nom").split()) if isinstance(a.get("nom"), str) else ""


def heros_relie(j: dict) -> str | None:
    """L'aventurier relié à ce joueur depuis l'atelier, s'il y en a un."""
    h = j.get("heros") if isinstance(j, dict) else None
    return h if isinstance(h, str) and ID.match(h) else None


def a_la_tablee(a) -> bool:
    return isinstance(a, dict) and a.get("tablee") is not False


def empreinte(a) -> str:
    """Ce qui distingue un héros d'une fiche qui reprendrait un jour son identifiant : sa date de création, que ni un
    enregistrement, ni la corbeille, ni une version remise ne changent."""
    cree = a.get("cree") if isinstance(a, dict) else None
    return cree if isinstance(cree, str) else ""


def meme_heros(j: dict, a) -> bool:
    """La fiche a est bien le héros que le MJ a relié à ce joueur, et pas une autre venue après lui sous son identifiant."""
    note = j.get("heros_cree") if isinstance(j, dict) else None
    return isinstance(a, dict) and isinstance(note, str) and note == empreinte(a)


def heros_des_joueurs(joueurs: list, accueillis: dict, aventuriers: dict) -> dict:
    """{id du joueur : fiche de son héros}. accueillis : {id du joueur : l'aventurier noté accueilli dans sa proposition}.
    Le lien posé depuis l'atelier passe avant l'accueil, et le héros doit être à la tablée et porter l'empreinte notée
    au lien. Un héros que deux joueurs réclameraient (un fichier retouché à la main) n'est lu par aucun des deux."""
    relies: dict = {}
    for j in joueurs:
        h = heros_relie(j)
        if h and isinstance(j.get("id"), str) and meme_heros(j, aventuriers.get(h)):
            relies.setdefault(h, []).append(j["id"])
    liens = {}
    for h, qui in relies.items():
        if len(qui) == 1 and a_la_tablee(aventuriers.get(h)):
            liens[qui[0]] = aventuriers[h]
    for j in joueurs:
        ident = j.get("id")
        if not isinstance(ident, str) or heros_relie(j):
            continue
        aid = accueillis.get(ident)
        a = aventuriers.get(aid) if isinstance(aid, str) and ID.match(aid) else None
        # Un héros relié à quelqu'un d'autre n'est plus lu par celui qui l'avait envoyé.
        if a_la_tablee(a) and a.get("source") == f"joueur:{ident}" and aid not in relies:
            liens[ident] = a
    return liens


def sans_lien(aventuriers: dict, liens: dict) -> list:
    """Les héros nommés de la tablée qu'aucun joueur ne lit, du plus ancien au plus récent."""
    pris = {a.get("id") for a in liens.values()}
    libres = [a for a in aventuriers.values() if a_la_tablee(a) and nom_de(a) and a.get("id") not in pris]
    return sorted(libres, key=lambda a: str(a.get("cree") or ""))


def verifier_lien(joueurs: list, ident: str, heros, accueillis: dict, aventuriers: dict) -> dict:
    """Le héros à relier au joueur, s'il peut l'être : nommé, à la tablée, sans autre joueur ; le joueur n'en a pas déjà
    un. Rend sa fiche, ou lève Refus."""
    if not isinstance(heros, str) or not ID.match(heros):
        raise Refus("Choisissez un héros de la tablée.", 400)
    a = aventuriers.get(heros)
    if not a_la_tablee(a):
        raise Refus("Ce héros n'est pas à la tablée.", 404)
    if not nom_de(a):
        raise Refus("Donnez d'abord un nom à cet aventurier.")
    liens = heros_des_joueurs(joueurs, accueillis, aventuriers)
    j = next((x for x in joueurs if x.get("id") == ident), {})
    if ident in liens:
        raise Refus(f"{j.get('nom') or 'Ce joueur'} joue déjà {nom_de(liens[ident]) or 'un héros'}.")
    autre = next((x for x in joueurs if liens.get(x.get("id"), {}).get("id") == heros), None)
    if autre:
        raise Refus(f"{nom_de(a)} est déjà {'reliée' if a.get('genre') == 'f' else 'relié'} à {autre.get('nom') or 'un autre joueur'}.")
    return a
