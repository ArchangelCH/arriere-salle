"""La recherche de l'atelier (js/chercher/) : un index léger de ce qui se cherche, lu d'un coup par « Chercher » dans
l'en-tête. Les textes seulement : ni les cases d'un plan, ni le terrain d'une carte, ni les illustrations, ni les
propositions d'un scénario. Le moteur est côté navigateur (js/chercher/moteur.js, celui de « Lier une fiche ») ; ici,
on ne fait que lire. Pour le MJ seul : sous /api/ hors de /api/table/, la garde de main.py la ferme à la table
publique, et le coin des joueurs (joueurs.py) ne l'a pas."""

from pathlib import Path
from typing import Callable

from fastapi import APIRouter

# Ce que chaque collection donne à la recherche. Une clé simple : un texte, un nombre, un booléen ou une liste de
# textes ; un couple (clé, champs) : une liste d'objets réduits à ces champs. « id » et « modifie » viennent toujours.
CHAMPS = {
    "pnj": ("nom", "surnom", "role", "lieu", "faction", "peuple", "apparence", "voix", "envie", "secret", "offre",
            "capacites", "notes", "scenario", "connu"),
    "lieux": ("nom", "type", "carte", "resume", "notes", "secrets", "connu"),
    "plans": ("nom", "lieu", "etage", "notes", ("pieces", ("nom", "notes")), ("textes", ("texte",))),
    "rencontres": ("nom", "notes", ("adversaires", ("nom", "capacites"))),
    "cartes": ("nom", ("etiquettes", ("texte",))),
    "boutiques": ("nom", "accroche", "marchand", "lieu", "notes_mj",
                  ("articles", ("id", "nom", "description", "categorie", "note_mj"))),
    "aventuriers": ("nom", "genre", "joueur", "tablee", "peuple", "specialite", "avant", "allure", "defaut", "contacts",
                    "histoire", "equipement", "objets", ("armes", ("nom",)), ("dons", ("nom",)), "secret", "notes_mj"),
    "contrats": ("nom", "genre", "affiche", "recompense", "contact", "verite"),
    "rumeurs": ("texte", "source", "fond"),
    "documents": ("nom", "genre", "texte", "signature", "notes_mj"),
    "seances": ("nom", "numero", "date", "close", "objectif", "notes", "scenario", ("deroule", ("titre", "note"))),
    "regles": ("titre", "statut", "texte", "contexte"),
    "idees": ("texte", "mots", "etat"),
    "scenarios": ("nom", "resume", ("chapitres", ("id", "titre", "texte"))),
}
SIMPLES = (str, int, float, bool)


def simple(v):
    """Un texte, un nombre ou un booléen tel quel ; une liste, ses seuls textes ; le reste n'existe pas."""
    if isinstance(v, SIMPLES):
        return v
    if isinstance(v, list):
        return [x for x in v if isinstance(x, str)]
    return None


def leger(fiche: dict, champs: tuple) -> dict:
    sortie = {"id": fiche.get("id"), "modifie": fiche.get("modifie") if isinstance(fiche.get("modifie"), str) else None}
    for champ in champs:
        if isinstance(champ, tuple):
            cle, sous = champ
            liste = fiche.get(cle)
            if isinstance(liste, list):
                sortie[cle] = [{k: x[k] for k in sous if isinstance(x.get(k), SIMPLES)} for x in liste if isinstance(x, dict)]
            continue
        v = simple(fiche.get(champ))
        if v is not None:
            sortie[champ] = v
    return sortie


def routes(collections: dict[str, Path], *, lire_tout: Callable[[Path], list]) -> APIRouter:
    """collections : { "pnj": dossier, … }, chacune parmi CHAMPS ; lire_tout : celui de main.py (une fiche illisible
    est passée)."""
    r = APIRouter()

    @r.get("/api/recherche")
    def index_recherche():
        return {nom: [leger(f, CHAMPS[nom]) for f in lire_tout(dossier) if isinstance(f.get("id"), str)]
                for nom, dossier in collections.items()}

    return r
