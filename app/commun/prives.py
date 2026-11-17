"""Les billets privés : un billet secret d'une séance, ou un document, que le MJ fait parvenir sur le téléphone du seul
joueur concerné (au lieu du papier, ou en plus), et le moment où ce joueur l'a lu.

Deux dossiers dans les propositions, un écrivain chacun :
  - prives/<clé>.json, écrit par l'atelier seul : pour chaque joueur, sous la clé opaque de son lien (carnet.cle_heros,
    comme « Mon héros »), ce qu'il a reçu, déjà passé au masque ; prives/media/ : les images réduites des documents
    remis, que le coin ne sert qu'au joueur dont un billet les cite ;
  - prives-lus/<joueur>.json, écrit par le coin seul : {"maj", "lus": {identifiant du billet : heure de lecture}}.
Rien à la racine des propositions (lue comme des héros proposés), rien dans carnet/media/ (le carnet le purge).

Un billet publié : {id, nature : « billet » ou « document », pour, envoye, puis titre, texte, aussi (les autres héros qui
ont reçu le même billet, comme le dit le papier) ou, pour un document, genre, nom, texte, signature, image, sceau}.
L'identifiant est tiré au hasard à l'envoi : ni la séance, ni le billet, ni la fiche du document ne s'y lisent.

Le coin ne choisit jamais un fichier d'après la requête : le sien se trouve par la clé du lien du joueur connecté.

Ce module ne lit rien de l'atelier : main.py (par prives_mj.py) et joueurs.py l'importent tous deux.
"""
import re
import secrets
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from commun import carnet
from commun import stockage

DOSSIER = "prives"
MEDIA = "media"
LUS = "prives-lus"
VERROU = ".verrou"

ID = re.compile(r"^[a-f0-9]{24}$")
CLE = carnet.CLE_HEROS
NOM_MEDIA = re.compile(r"^[a-f0-9]{24}\.jpg$")
ADRESSE_MEDIA = re.compile(r"^/prives/media/([a-f0-9]{24}\.jpg)$")
ID_JOUEUR = re.compile(r"^[a-z0-9-]{1,60}$")
NATURES = ("billet", "document")
GENRES_DOCUMENT = ("lettre", "affiche", "note", "parchemin", "plan")

PAR_JOUEUR = 60  # billets gardés pour un joueur, les plus récents
OCTETS_MAX = 512 * 1024  # un fichier publié plus lourd n'est pas lu
LUS_MAX = 200  # lectures gardées par joueur
LUS_OCTETS_MAX = 32 * 1024
TITRE_MAX = 160
TEXTE_MAX = 6000
COURT_MAX = 160
# Une publication à la fois (un envoi, un retrait, la tâche de fond) : une image qu'une autre vient d'écrire n'est pas
# retirée comme périmée.
PUBLICATION = threading.Lock()


def maintenant() -> str:
    return datetime.now().isoformat(timespec="milliseconds")


def nouvel_id() -> str:
    return secrets.token_hex(12)


def court(valeur, maximum: int) -> str:
    return valeur.strip()[:maximum] if isinstance(valeur, str) else ""


# ---------------------------------------------------------------- ce que lit le joueur

def propre(element) -> dict | None:
    """Un billet publié, champ par champ (liste blanche) : un champ inconnu ne passe pas, une image qui n'est pas une
    miniature de prives/media/ devient vide. None pour un billet illisible."""
    if not isinstance(element, dict) or not isinstance(element.get("id"), str) or not ID.match(element["id"]):
        return None
    nature = element.get("nature")
    if nature not in NATURES:
        return None
    sortie = {"id": element["id"], "nature": nature, "pour": court(element.get("pour"), COURT_MAX),
              "envoye": court(element.get("envoye"), 40)}
    if nature == "billet":
        aussi = element.get("aussi") if isinstance(element.get("aussi"), list) else []
        sortie |= {"titre": court(element.get("titre"), TITRE_MAX), "texte": court(element.get("texte"), TEXTE_MAX),
                   "aussi": [court(x, COURT_MAX) for x in aussi if isinstance(x, str) and x.strip()][:8]}
    else:
        image = element.get("image")
        sortie |= {"genre": element.get("genre") if element.get("genre") in GENRES_DOCUMENT else "lettre",
                   "nom": court(element.get("nom"), TITRE_MAX), "texte": court(element.get("texte"), TEXTE_MAX),
                   "signature": court(element.get("signature"), COURT_MAX),
                   "image": image if isinstance(image, str) and ADRESSE_MEDIA.match(image) else None,
                   "sceau": element.get("sceau") is True}
    return sortie


def chemin_publie(depot: Path, cle: str) -> Path | None:
    return depot / DOSSIER / f"{cle}.json" if isinstance(cle, str) and CLE.match(cle) else None


def lire(depot: Path, cle: str) -> list:
    """Les billets d'un joueur, du plus récent au plus ancien, tels que l'atelier les a publiés sous la clé de son lien."""
    chemin = chemin_publie(depot, cle)
    contenu = carnet.lire_json(chemin, OCTETS_MAX) if chemin else None
    elements = contenu.get("elements") if isinstance(contenu, dict) else None
    if not isinstance(elements, list):
        return []
    liste = [x for x in (propre(e) for e in elements) if x is not None]
    return sorted(liste, key=lambda x: x["envoye"], reverse=True)[:PAR_JOUEUR]


def vue_coin(elements: list, lus: dict) -> list:
    """Ce que rend /api/prives du coin : ses billets, chacun avec l'heure où il l'a lu (ou rien)."""
    return [e | {"lu": lus.get(e["id"]) if isinstance(lus.get(e["id"]), str) else None} for e in elements]


def media_du_joueur(depot: Path, cle: str, nom: str) -> Path | None:
    """L'image d'un document remis à ce joueur, et à lui seul : son nom doit figurer dans l'un de ses billets."""
    if not isinstance(nom, str) or not NOM_MEDIA.match(nom):
        return None
    if not any(e.get("image") == f"/prives/media/{nom}" for e in lire(depot, cle)):
        return None
    chemin = depot / DOSSIER / MEDIA / nom
    return chemin if chemin.is_file() else None


# ---------------------------------------------------------------- publier (l'atelier)

def publier(depot: Path, par_cle: dict, images: dict) -> int:
    """Écrit les billets de chaque joueur (par_cle : {clé : [billets]}), les images d'abord (les billets y renvoient), puis
    retire ce qui n'est plus publié : le fichier d'un joueur qui n'a plus rien, une image qu'aucun billet ne cite. Un
    fichier n'est réécrit que si son contenu change. Rend le nombre de fichiers écrits ou retirés."""
    dossier = depot / DOSSIER
    with PUBLICATION:
        (dossier / MEDIA).mkdir(parents=True, exist_ok=True)
        ecrits = 0
        for nom, source in images.items():
            if NOM_MEDIA.match(nom) and not (dossier / MEDIA / nom).exists() and carnet.miniature(source, dossier / MEDIA / nom):
                ecrits += 1
        gardes = set()
        for cle, elements in par_cle.items():
            chemin = chemin_publie(depot, cle)
            if chemin is None or not elements:
                continue
            liste = sorted((x for x in (propre(e) for e in elements) if x is not None), key=lambda x: x["envoye"], reverse=True)
            ecrits += carnet.ecrire_si_change(chemin, liste[:PAR_JOUEUR])
            gardes.add(chemin.name)
        for f in dossier.glob("*.json"):
            if f.name not in gardes:
                f.unlink(missing_ok=True)
                ecrits += 1
        cites = {m.group(1) for liste in par_cle.values() for e in liste or []
                 if isinstance(e, dict) and isinstance(e.get("image"), str) and (m := ADRESSE_MEDIA.match(e["image"]))}
        for f in (dossier / MEDIA).iterdir():
            if f.name not in cites and not f.name.startswith("."):
                f.unlink(missing_ok=True)
                ecrits += 1
        return ecrits


# ---------------------------------------------------------------- les lectures (le coin)

@contextmanager
def verrou(depot: Path):
    with stockage.verrou_de_dossier(depot / LUS, VERROU):
        yield


def chemin_lus(depot: Path, joueur: str) -> Path:
    if not isinstance(joueur, str) or not ID_JOUEUR.match(joueur):
        raise ValueError("Joueur invalide")
    return depot / LUS / f"{joueur}.json"


def lire_lus(depot: Path, joueur: str) -> dict:
    """{identifiant du billet : heure de lecture} d'un joueur. Un fichier absent, illisible ou trop lourd ne dit rien."""
    try:
        contenu = carnet.lire_json(chemin_lus(depot, joueur), LUS_OCTETS_MAX)
    except ValueError:
        return {}
    lus = contenu.get("lus") if isinstance(contenu, dict) else None
    if not isinstance(lus, dict):
        return {}
    return {k: v[:40] for k, v in lus.items() if isinstance(k, str) and ID.match(k) and isinstance(v, str)}


def noter_lu(depot: Path, joueur: str, ident: str, connus: set) -> str:
    """Le joueur a ouvert ce billet : l'heure de la première lecture est gardée (une relecture ne la change pas). Seul un
    billet publié pour lui compte ; ceux que l'atelier a retirés depuis s'en vont du fichier. Rend l'heure notée."""
    if not isinstance(ident, str) or ident not in connus:
        raise KeyError(ident)
    with verrou(depot):
        lus = {k: v for k, v in lire_lus(depot, joueur).items() if k in connus}
        if ident in lus:
            return lus[ident]
        lus[ident] = maintenant()
        if len(lus) > LUS_MAX:
            lus = dict(sorted(lus.items(), key=lambda kv: kv[1])[-LUS_MAX:])
        chemin = chemin_lus(depot, joueur)
        stockage.ecrire_json(chemin, {"maj": maintenant(), "lus": lus}, mode=0o644, separators=(",", ":"))
        return lus[ident]
