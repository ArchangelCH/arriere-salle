"""Les notes du joueur, prises depuis la table du coin (lot du 19/11) : un texte libre, à lui seul. Ni le MJ ni
la tablée ne les lisent : aucune route de l'atelier ne les sert, rien ne les publie.

- Elles vivent dans propositions/notes/<joueur>.json ({texte, modifie}), écrites par le coin seul, sous verrou, en 0600.
  Le fichier se trouve par la session du joueur (son identifiant), jamais d'après la requête.
- Un enregistrement porte la date de la version qu'il remplace (« base ») : changées entre-temps sur un autre appareil, le
  coin refuse (409) et la page relit avant de réécrire, sans rien perdre. Sans base (première écriture), elle passe.
- Un texte vide efface le fichier.

Ce module ne lit rien de l'atelier : seul joueurs.py l'importe.
"""
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from commun import demandes
from commun.demandes import Refus
from commun import stockage

DOSSIER = "notes"
VERROU = ".verrou"
TEXTE_MAX = 20000  # signes
OCTETS_MAX = 4 * TEXTE_MAX + 2048  # le fichier sur le disque, avec ses accents et sa date
ECRITURE_OCTETS_MAX = 4 * TEXTE_MAX + 1024  # le corps d'une écriture
CHANGEES = "Vos notes ont changé sur un autre appareil : elles se relisent."


@contextmanager
def verrou(depot: Path):
    with stockage.verrou_de_dossier(depot / DOSSIER, VERROU):
        yield


def fichier(depot: Path, joueur: str) -> Path:
    if not isinstance(joueur, str) or not demandes.ID_JOUEUR.match(joueur):
        raise Refus(403, "Accès invalide")
    return depot / DOSSIER / f"{joueur}.json"


def vide() -> dict:
    return {"texte": "", "modifie": None}


def lire(depot: Path, joueur: str) -> dict:
    """Les notes d'un joueur ; un fichier absent, abîmé ou trop lourd vaut des notes vides."""
    chemin = fichier(depot, joueur)
    try:
        if chemin.stat().st_size > OCTETS_MAX:
            return vide()
        n = stockage.lire_json(chemin)
    except (OSError, ValueError):
        return vide()
    if not isinstance(n, dict) or not isinstance(n.get("texte"), str) or len(n["texte"]) > TEXTE_MAX:
        return vide()
    return {"texte": n["texte"], "modifie": n.get("modifie") if isinstance(n.get("modifie"), str) else None}


def valider(corps) -> dict:
    """{texte, base} : le texte (sans caractère de contrôle autre que la fin de ligne et la tabulation), et la date de la
    version que la page avait lue (ou null)."""
    if not isinstance(corps, dict) or set(corps) - {"texte", "base"}:
        raise Refus(400, "Les notes : demande illisible.")
    texte = corps.get("texte")
    if not isinstance(texte, str):
        raise Refus(400, "Les notes : un texte est attendu.")
    texte = texte.replace("\r\n", "\n").replace("\r", "\n")
    texte = "".join(c for c in texte if c in "\n\t" or (ord(c) >= 32 and not 0x7F <= ord(c) <= 0x9F))
    if len(texte) > TEXTE_MAX:
        raise Refus(413, f"Vos notes dépassent {TEXTE_MAX} signes : rangez-en une partie ailleurs.")
    base = corps.get("base")
    if base is not None and (not isinstance(base, str) or len(base) > 40):
        raise Refus(400, "Les notes : version illisible.")
    return {"texte": texte, "base": base}


def ecrire(depot: Path, joueur: str, corps) -> dict:
    """Enregistre les notes, sous le verrou. 409 si elles ont changé depuis la version lue par la page."""
    propre = valider(corps)
    with verrou(depot):
        actuel = lire(depot, joueur)
        if propre["base"] is not None and actuel["modifie"] is not None and propre["base"] != actuel["modifie"]:
            raise Refus(409, CHANGEES)
        if propre["base"] is None and actuel["modifie"] is not None and actuel["texte"] != propre["texte"] and actuel["texte"]:
            raise Refus(409, CHANGEES)
        chemin = fichier(depot, joueur)
        if not propre["texte"].strip():
            chemin.unlink(missing_ok=True)
            return vide()
        n = {"texte": propre["texte"], "modifie": datetime.now().isoformat(timespec="milliseconds")}
        chemin.parent.mkdir(parents=True, exist_ok=True)
        stockage.ecrire_json_compact(chemin, n, mode=0o600)
        return n
