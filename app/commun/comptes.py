"""Les comptes des joueurs du coin : un identifiant et un mot de passe, un fichier par joueur dans propositions/comptes/.

Le coin des joueurs les écrit, seul et sous un verrou : deux créations du même identifiant ne passent pas toutes les
deux. L'atelier les lit pour dire au MJ qui a un compte, jamais l'empreinte du mot de passe, et n'y écrit qu'une chose,
sous le même verrou : la fermeture du compte d'un joueur qu'il retire. Le compte s'efface (un joueur réinvité sous le
même prénom reprend l'identifiant de joueur de l'ancien, jamais son compte) ; son identifiant de connexion va dans
.retires.json et ne resert plus. Les mots de passe provisoires du MJ, l'atelier les tire sous ce même verrou, dans un
dossier à lui (provisoires.py).

Un compte : {"joueur", "identifiant", "forme", "empreinte", "lien", "generation", "cree", "modifie"}, et
« provisoire_utilise » quand un mot de passe provisoire du MJ l'a ouvert (provisoires.py). « lien » est l'empreinte du
jeton du joueur (celle de .acces.json), qui ne change plus depuis la fin des liens à clé : une session ne vaut que pour
ce jeton. « forme » est l'identifiant tel qu'on le compare (« Léa » et « léa » sont le même).

Ce module ne lit rien de l'atelier ni du coin : les deux l'importent, avec les mêmes bornes.
"""
import json
import os
import re
import secrets
import time
import unicodedata
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from commun import stockage

DOSSIER = "comptes"
ID_JOUEUR = re.compile(r"^[a-z0-9-]{1,60}$")
# Lettres (accents compris), chiffres, point, tiret et trait bas, sans espace : ce qu'on tape sans hésiter au téléphone.
IDENTIFIANT = re.compile(r"^[^\W_][\w.-]*$")
IDENTIFIANT_MIN, IDENTIFIANT_MAX = 3, 32
MDP_MIN, MDP_MAX = 8, 128
FICHIER_MAX = 16 * 1024
RETIRES = ".retires.json"
RETIRES_MAX = 256 * 1024
# Les cookies d'avant les comptes valent invitation pendant 30 jours après la mise en service (joueurs.py) : la date de
# départ est notée ici au premier passage.
MIGRATION = ".migration"
DUREE_MIGRATION = 30 * 86400
_FIN_MIGRATION: dict[str, float] = {}


class Refus(Exception):
    """Une demande refusée, avec le statut HTTP et la phrase à montrer au joueur."""

    def __init__(self, statut: int, message: str):
        super().__init__(message)
        self.statut = statut
        self.message = message


def maintenant() -> str:
    return datetime.now().isoformat(timespec="seconds")


def dossier(depot: Path) -> Path:
    return depot / DOSSIER


@contextmanager
def verrou(depot: Path):
    with stockage.verrou_de_dossier(dossier(depot), ".verrou", mode_dossier=0o700):
        yield


def fichier(depot: Path, joueur: str) -> Path:
    if not isinstance(joueur, str) or not ID_JOUEUR.fullmatch(joueur):
        raise Refus(403, "Accès invalide")
    return dossier(depot) / f"{joueur}.json"


def ouvert(compte) -> bool:
    """Un compte entier, qui laisse entrer : aucun champ ne manque ni n'a un type inattendu."""
    return (isinstance(compte, dict) and isinstance(compte.get("generation"), int)
            and all(isinstance(compte.get(k), str) and compte[k] for k in ("joueur", "identifiant", "forme", "empreinte", "lien")))


def lire(depot: Path, joueur: str) -> dict | None:
    """Le compte d'un joueur ; None s'il n'en a pas, ou s'il est illisible (son lien le refait)."""
    try:
        chemin = fichier(depot, joueur)
        if chemin.stat().st_size > FICHIER_MAX:
            return None
        contenu = stockage.lire_json(chemin)
    except (OSError, ValueError, Refus):
        return None
    return contenu if ouvert(contenu) and contenu["joueur"] == joueur else None


def retires(depot: Path) -> set:
    """Les identifiants des comptes fermés : ils ne resservent jamais."""
    try:
        chemin = dossier(depot) / RETIRES
        liste = stockage.lire_json(chemin) if chemin.stat().st_size <= RETIRES_MAX else []
    except (OSError, ValueError):
        return set()
    return {x for x in liste if isinstance(x, str)} if isinstance(liste, list) else set()


def tous(depot: Path) -> list:
    """Tous les comptes ouverts."""
    try:
        noms = sorted(f.stem for f in dossier(depot).glob("*.json"))
    except OSError:
        return []
    return [c for c in (lire(depot, n) for n in noms if ID_JOUEUR.fullmatch(n)) if c is not None]


def forme(identifiant) -> str:
    return unicodedata.normalize("NFKC", identifiant if isinstance(identifiant, str) else "").strip().casefold()


def identifiant_choisi(texte) -> str:
    """L'identifiant tel qu'il s'affichera, ou un refus qui dit la règle."""
    propre = unicodedata.normalize("NFC", texte).strip() if isinstance(texte, str) else ""
    if not (IDENTIFIANT_MIN <= len(propre) <= IDENTIFIANT_MAX) or not IDENTIFIANT.fullmatch(propre):
        raise Refus(400, f"Choisissez un identifiant de {IDENTIFIANT_MIN} à {IDENTIFIANT_MAX} caractères : lettres, chiffres, "
                         "point, tiret ou trait bas, sans espace.")
    return propre


def mot_de_passe_choisi(mot_de_passe, confirmation, identifiant: str = "") -> str:
    if not isinstance(mot_de_passe, str) or not isinstance(confirmation, str):
        raise Refus(400, "Le mot de passe, deux fois, s'il vous plaît.")
    if len(mot_de_passe) < MDP_MIN or not mot_de_passe.strip():
        raise Refus(400, f"Le mot de passe doit faire au moins {MDP_MIN} caractères.")
    if len(mot_de_passe) > MDP_MAX:
        raise Refus(400, f"Le mot de passe est trop long : {MDP_MAX} caractères au plus.")
    if mot_de_passe != confirmation:
        raise Refus(400, "Les deux mots de passe ne sont pas les mêmes.")
    if identifiant and forme(mot_de_passe) == forme(identifiant):
        raise Refus(400, "Le mot de passe ne peut pas être votre identifiant.")
    return mot_de_passe


def pris(depot: Path, voulu: str) -> bool:
    """Un identifiant déjà porté, aujourd'hui ou par un compte fermé (il ne resert jamais), ou promis à un joueur par un
    mot de passe provisoire en cours (provisoires.py)."""
    from commun import provisoires  # il importe ce module-ci : importé ici, à l'appel
    return voulu in retires(depot) or any(c["forme"] == voulu for c in tous(depot)) or provisoires.promis(depot, voulu)


def par_identifiant(depot: Path, voulu: str) -> dict | None:
    """Le compte ouvert qui porte cet identifiant (déjà mis en forme)."""
    return next((c for c in tous(depot) if ouvert(c) and c["forme"] == voulu), None) if voulu else None


def ecrire(depot: Path, joueur: str, compte: dict) -> None:
    """Sous le verrou : le compte d'un coup (un fichier temporaire renommé), lisible par son seul propriétaire."""
    ecrire_prive(fichier(depot, joueur), compte)


def ecrire_prive(chemin: Path, contenu) -> None:
    chemin.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    tmp = chemin.with_name(f".{chemin.name}.{secrets.token_hex(4)}.tmp")
    try:
        with os.fdopen(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as f:
            json.dump(contenu, f, ensure_ascii=False, separators=(",", ":"))
        tmp.replace(chemin)
    finally:
        tmp.unlink(missing_ok=True)


def creer(depot: Path, joueur: str, lien: str, identifiant: str, empreinte: str) -> dict:
    """Le compte qu'un joueur crée lui-même, depuis un appareil qui gardait un cookie d'avant les comptes (les 30 jours de
    la migration). L'état est relu sous le verrou : un compte déjà là, ou un provisoire du MJ en cours, ne se doublent pas
    ainsi ; seul un mot de passe provisoire remet un compte à zéro (provisoires.py)."""
    from commun import provisoires  # il importe ce module-ci : importé ici, à l'appel
    with verrou(depot):
        if lire(depot, joueur) is not None:
            raise Refus(409, "Votre compte existe déjà : connectez-vous avec votre identifiant et votre mot de passe.")
        if provisoires.en_cours(depot, joueur, None):
            raise Refus(409, "Votre MJ vous a donné un mot de passe provisoire : connectez-vous avec.")
        voulu = forme(identifiant)
        if pris(depot, voulu):
            raise Refus(409, "Cet identifiant est déjà pris : choisissez-en un autre.")
        instant = maintenant()
        compte = {"joueur": joueur, "identifiant": identifiant, "forme": voulu, "empreinte": empreinte, "lien": lien,
                  "generation": 1, "cree": instant, "modifie": instant}
        ecrire(depot, joueur, compte)
    return compte


def changer(depot: Path, joueur: str, generation: int, empreinte: str) -> dict:
    """Un nouveau mot de passe choisi par le joueur connecté : ses autres appareils sont déconnectés."""
    with verrou(depot):
        avant = lire(depot, joueur)
        if not ouvert(avant) or avant["generation"] != generation:
            raise Refus(409, "Votre compte vient de changer sur un autre appareil : reconnectez-vous.")
        compte = {**avant, "empreinte": empreinte, "generation": generation + 1, "modifie": maintenant()}
        ecrire(depot, joueur, compte)
    return compte


def fermer(depot: Path, joueur: str) -> bool:
    """Le compte d'un joueur que le MJ retire (l'atelier) : effacé, empreinte et lien compris ; son identifiant rejoint
    ceux qui ne resservent plus."""
    chemin = fichier(depot, joueur)
    with verrou(depot):
        if not chemin.exists():
            return False
        avant = lire(depot, joueur)
        if avant:
            ecrire_prive(dossier(depot) / RETIRES, sorted(retires(depot) | {avant["forme"]}))
        chemin.unlink(missing_ok=True)
    return True


def fin_migration(depot: Path) -> float:
    """La fin des 30 jours pendant lesquels un cookie d'avant les comptes invite encore à créer le sien."""
    cle = str(depot)
    if cle in _FIN_MIGRATION:
        return _FIN_MIGRATION[cle]
    chemin = dossier(depot) / MIGRATION
    debut = time.time()
    try:
        with verrou(depot):
            try:
                debut = datetime.fromisoformat(chemin.read_text(encoding="utf-8").strip()).timestamp()
            except (OSError, ValueError):
                chemin.write_text(datetime.fromtimestamp(debut).isoformat(timespec="seconds"), encoding="utf-8")
    except OSError:
        return debut + DUREE_MIGRATION
    _FIN_MIGRATION[cle] = debut + DUREE_MIGRATION
    return _FIN_MIGRATION[cle]
