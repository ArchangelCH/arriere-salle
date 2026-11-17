"""Les mots de passe provisoires des joueurs du coin. Le MJ en tire un dans l'onglet Aventuriers (« Créer son compte »,
« Nouveau mot de passe provisoire ») et le transmet au joueur ; celui-ci s'en sert une fois, sur l'adresse du coin des joueurs,
pour entrer et choisir le sien. Plus aucun lien à clé : l'identifiant et ce mot de passe sont la seule entrée.

Un fichier par joueur dans propositions/comptes-provisoires/, écrit par l'atelier seul, sous le verrou des comptes :
{"joueur", "identifiant", "forme", "empreinte", "generation", "cree", "expire"}. Seule l'empreinte (scrypt, acces.py)
est gardée : le provisoire lui-même n'est montré qu'une fois au MJ.

Le coin le lit et ne l'écrit jamais. Quand le joueur a choisi son mot de passe, le coin note dans son compte (comptes.py,
« provisoire_utilise ») la génération du provisoire qui a servi. Un provisoire est « en cours » tant que sa génération
dépasse celle que le compte a notée. Tant qu'il y en a un, ni l'ancien mot de passe ni aucune session du joueur ne valent :
seul le provisoire ouvre, sur le choix d'un mot de passe, puis il ne sert plus. Deux mots de passe ne valent donc jamais en
même temps, même si le MJ en refait un pendant que le joueur se connecte : le nouveau a une génération plus haute que
celle que le coin note, et le mot de passe choisi entre-temps tombe aussitôt.

Ce module ne lit rien de l'atelier ni du coin : les deux l'importent, avec les mêmes bornes.
"""
import secrets
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path

from commun import comptes
from commun.comptes import Refus
from commun import stockage

DOSSIER = "comptes-provisoires"
DUREE = timedelta(days=7)
FICHIER_MAX = 4 * 1024

# Des mots courts, sans accent, qui s'écrivent comme ils se disent : le MJ peut les dicter. Deux chiffres de 2 à 9 :
# ni 0 ni 1, qui se confondent avec o et l. Trois mots parmi plus de deux cents et deux chiffres : environ 2^29
# possibilités, pour 10 essais par heure et par identifiant pendant 7 jours au plus.
MOTS = tuple("""
abricot amande ancre ardoise argent avoine bague balai baleine banane barque bassin bateau baume biche bijou biscuit
bison bocal bonnet bougie boule bouquet boussole branche brebis brioche brique brume bulle buisson cabane cabri cactus
cadran caillou camion canard canne canot cape caramel carafe carotte carpe carte cascade castor cerise chaise chandelle
chapeau charbon chardon chariot chaton cheval chien cidre cigale citron clairon cloche clou cocon coffre colline
concombre corbeau corde cornet coton coude coupe crabe crayon cristal cuivre dague dauphin dentelle domino dragon dune
encre falaise fanal fanion farine faucon fenouil figue flamme fleuve flocon foin fontaine forge fourmi fraise framboise
frelon fromage fusain galet gant gazelle girafe girouette givre gland glaive gourde graine grelot grenade grenier grive
grotte guitare hache hamac hermine hibou huile ivoire jardin jasmin javelot jument lame lampe lance lanterne lapin
laurier lavande licorne lierre lime lion loutre lune lutin malle manche mangue manteau marbre marmite marmotte marron
massue melon merle miel miroir moineau mouette moulin mouton mulet muraille muscade navet neige noisette nuage olive
ombre orage orange orme orque ortie outil paille pain palette palmier panda panier papier parfum pastel pavot pelle
perle pigeon pingouin pinceau pirate pivoine plume poire poivre pomme pont porte potiron poule prune radis raisin
rameau renard renne requin rivage robe roche rocher roseau rubis ruche sabot sabre sable safran salade sapin sardine
saule sentier serpent sirop soleil sorbet source sucre tambour tapis tasse taupe tigre tilleul tissu toile tomate
tonneau topaze torche tortue toupie tour tuile tulipe tunnel turban vache vague valise vallon vanille velours vent
verger violette violon voile volant volcan
""".split())
CHIFFRES = "23456789"
# Un appareil entré par un provisoire que le MJ a refait (ou qui a servi ailleurs, ou expiré) entre-temps.
CADUC = "Ce mot de passe provisoire ne vaut plus : votre MJ en a peut-être donné un autre. Reconnectez-vous avec le dernier reçu."


def tirer() -> str:
    """« lune-tigre-sable-47 » : trois mots et deux chiffres, tirés par secrets."""
    return "-".join([*(secrets.choice(MOTS) for _ in range(3)), "".join(secrets.choice(CHIFFRES) for _ in range(2))])


def canonique(texte) -> str:
    """Le provisoire tel qu'on le compare : lettres et chiffres seuls, en minuscules, sans accent. « Lune tigre sable 47 »,
    dicté, vaut « lune-tigre-sable-47 ». Seul le provisoire se compare ainsi ; un mot de passe choisi, jamais."""
    if not isinstance(texte, str):
        return ""
    sans_accent = "".join(c for c in unicodedata.normalize("NFKD", texte) if not unicodedata.combining(c))
    return "".join(c for c in sans_accent.casefold() if c.isascii() and c.isalnum())


def maintenant() -> datetime:
    return datetime.now().astimezone()


def fichier(depot: Path, joueur: str) -> Path:
    if not isinstance(joueur, str) or not comptes.ID_JOUEUR.fullmatch(joueur):
        raise Refus(403, "Accès invalide")
    return depot / DOSSIER / f"{joueur}.json"


def date(texte) -> datetime | None:
    try:
        d = datetime.fromisoformat(texte)
    except (TypeError, ValueError):
        return None
    return d if d.tzinfo else d.astimezone()


def entier(p) -> bool:
    return (isinstance(p, dict) and isinstance(p.get("generation"), int) and not isinstance(p["generation"], bool)
            and p["generation"] >= 1 and date(p.get("expire")) is not None
            and all(isinstance(p.get(k), str) and p[k] for k in ("joueur", "identifiant", "forme", "empreinte", "cree")))


def lire(depot: Path, joueur: str) -> dict | None:
    """Le dernier provisoire tiré pour ce joueur, qu'il ait servi ou non ; None s'il n'y en a pas, ou s'il est illisible."""
    try:
        chemin = fichier(depot, joueur)
        if chemin.stat().st_size > FICHIER_MAX:
            return None
        p = stockage.lire_json(chemin)
    except (OSError, ValueError, Refus):
        return None
    return p if entier(p) and p["joueur"] == joueur else None


def utilise(compte) -> int:
    """La génération du dernier provisoire qui a servi à ce compte (0 : aucun, comme les comptes créés par lien)."""
    g = compte.get("provisoire_utilise") if isinstance(compte, dict) else None
    return g if isinstance(g, int) and not isinstance(g, bool) else 0


def en_cours(depot: Path, joueur: str, compte) -> dict | None:
    """Le provisoire qui n'a pas encore servi, expiré ou non : tant qu'il est là, l'ancien mot de passe et les sessions
    du joueur ne valent plus."""
    p = lire(depot, joueur)
    return p if p and p["generation"] > utilise(compte) else None


def expire(p: dict, instant: datetime | None = None) -> bool:
    fin = date(p.get("expire"))
    return fin is None or (instant or maintenant()) >= fin


def echeance(p: dict) -> int:
    """L'échéance du provisoire, en secondes depuis l'époque (celle d'un cookie)."""
    fin = date(p.get("expire"))
    return int(fin.timestamp()) if fin else 0


def tous(depot: Path) -> list:
    try:
        noms = sorted(f.stem for f in (depot / DOSSIER).glob("*.json"))
    except OSError:
        return []
    return [p for p in (lire(depot, n) for n in noms if comptes.ID_JOUEUR.fullmatch(n)) if p is not None]


def promis(depot: Path, voulu: str, sauf: str = "") -> bool:
    """Un identifiant promis à un autre joueur par un provisoire en cours, même expiré : « Nouveau provisoire » le redonne
    au même joueur, et la connexion ne doit trouver qu'un provisoire sous un identifiant."""
    for p in tous(depot):
        if p["joueur"] != sauf and p["forme"] == voulu and en_cours(depot, p["joueur"], comptes.lire(depot, p["joueur"])):
            return True
    return False


def pris(depot: Path, voulu: str, joueur: str) -> bool:
    """Un identifiant qui ne peut pas aller à ce joueur : fermé (il ne resert jamais), porté par un autre compte, ou promis
    à un autre par un provisoire en cours."""
    return (voulu in comptes.retires(depot) or any(c["forme"] == voulu and c["joueur"] != joueur for c in comptes.tous(depot))
            or promis(depot, voulu, sauf=joueur))


def simple(prenom) -> str:
    """« Jean-Noël Brière » donne « jean-noelbriere » : sans accent ni espace, en minuscules, ce que permet un identifiant."""
    texte = "".join(c for c in unicodedata.normalize("NFKD", prenom if isinstance(prenom, str) else "") if not unicodedata.combining(c))
    propre = "".join(c for c in texte.casefold() if c.isascii() and (c.isalnum() or c in ".-_"))
    return propre.strip(".-_")[:comptes.IDENTIFIANT_MAX - 3]


def identifiant_propose(depot: Path, joueur: str, prenom) -> str:
    """L'identifiant que la carte du joueur propose au MJ : son prénom en forme simple, suivi d'un chiffre s'il est pris."""
    base = simple(prenom) or "joueur"
    for n in range(1, 1000):
        candidat = base if n == 1 else f"{base}{n}"
        if len(candidat) >= comptes.IDENTIFIANT_MIN and comptes.IDENTIFIANT.fullmatch(candidat) and not pris(depot, candidat, joueur):
            return candidat
    return ""


def identifiant_pour(depot: Path, joueur: str, identifiant) -> str:
    """L'identifiant que recevra ce joueur : celui de son compte s'il en a un (il ne change pas), sinon celui que choisit le
    MJ, s'il est libre ; sans choix (« Nouveau provisoire »), celui du provisoire d'avant. Refus qui dit la règle sinon."""
    compte = comptes.lire(depot, joueur)
    if compte:
        return compte["identifiant"]
    avant = lire(depot, joueur)
    if not (isinstance(identifiant, str) and identifiant.strip()) and avant:
        identifiant = avant["identifiant"]
    choisi = comptes.identifiant_choisi(identifiant)
    if pris(depot, comptes.forme(choisi), joueur):
        raise Refus(409, "Cet identifiant est déjà pris : choisissez-en un autre.")
    return choisi


def poser(depot: Path, joueur: str, identifiant, empreinte: str) -> dict:
    """L'atelier, seul : un nouveau provisoire pour ce joueur, qui remplace le précédent. Sa génération dépasse tout ce qui
    a servi : dès qu'il est écrit, l'ancien mot de passe et toutes les sessions du joueur tombent."""
    with comptes.verrou(depot):
        ident = identifiant_pour(depot, joueur, identifiant)
        compte, avant = comptes.lire(depot, joueur), lire(depot, joueur)
        instant = maintenant()
        p = {"joueur": joueur, "identifiant": ident, "forme": comptes.forme(ident), "empreinte": empreinte,
             "generation": max(avant["generation"] if avant else 0, utilise(compte)) + 1,
             "cree": instant.isoformat(timespec="seconds"), "expire": (instant + DUREE).isoformat(timespec="seconds")}
        comptes.ecrire_prive(fichier(depot, joueur), p)
    return p


def effacer(depot: Path, joueur: str) -> None:
    """L'atelier, seul : le provisoire d'un joueur qu'il retire."""
    with comptes.verrou(depot):
        fichier(depot, joueur).unlink(missing_ok=True)


def ranger(depot: Path, joueurs: list) -> None:
    """L'atelier, seul : un provisoire qui a servi n'a plus rien à garder, pas même son empreinte. Sa génération reste
    notée dans le compte : le suivant la dépassera quand même."""
    for joueur in joueurs:
        try:
            if not fichier(depot, joueur).exists():
                continue
        except Refus:
            continue
        with comptes.verrou(depot):
            p = lire(depot, joueur)
            if p and p["generation"] <= utilise(comptes.lire(depot, joueur)):
                fichier(depot, joueur).unlink(missing_ok=True)


def pour_la_connexion(depot: Path, voulu: str) -> tuple[dict | None, dict | None]:
    """(compte, provisoire en cours) de l'identifiant tapé, déjà mis en forme : un compte sans provisoire, un compte que le
    MJ a remis à zéro, ou un joueur qui n'a encore que son provisoire. (None, None) si personne ne le porte."""
    if not voulu:
        return None, None
    compte = comptes.par_identifiant(depot, voulu)
    if compte:
        return compte, en_cours(depot, compte["joueur"], compte)
    for p in tous(depot):
        if p["forme"] == voulu:
            c = comptes.lire(depot, p["joueur"])
            if p["generation"] > utilise(c):
                return c, p
    return None, None


def utiliser(depot: Path, joueur: str, generation: int, empreinte: str, lien: str) -> dict:
    """Le coin, seul : le joueur entré par son provisoire choisit son mot de passe. Relu sous le verrou : un provisoire
    refait, expiré ou déjà servi entre-temps refuse. Le compte note la génération qui a servi : le provisoire ne rouvre
    plus rien, et ses autres sessions restent coupées (generation + 1)."""
    with comptes.verrou(depot):
        avant = comptes.lire(depot, joueur)
        p = en_cours(depot, joueur, avant)
        if not p or p["generation"] != generation or expire(p):
            raise Refus(409, CADUC)
        if any(c["forme"] == p["forme"] and c["joueur"] != joueur for c in comptes.tous(depot)):
            raise Refus(409, "Cet identifiant vient d'être pris : demandez à votre MJ un nouveau mot de passe provisoire.")
        instant = comptes.maintenant()
        base = avant or {"joueur": joueur, "generation": 0, "cree": instant}
        compte = {**base, "identifiant": p["identifiant"], "forme": p["forme"], "empreinte": empreinte, "lien": lien,
                  "generation": base["generation"] + 1, "provisoire_utilise": p["generation"], "modifie": instant}
        comptes.ecrire(depot, joueur, compte)
    return compte


def pour_le_mj(depot: Path, joueur: str, lien: str) -> dict | None:
    """Ce que la carte du joueur montre au MJ : l'identifiant, s'il a un compte, et le provisoire en attente (depuis quand,
    jusqu'à quand). Jamais d'empreinte. « bloque » : un compte d'avant dont le dernier lien n'a jamais été ouvert ; il ne
    rouvre que par un provisoire."""
    compte = comptes.lire(depot, joueur)
    p = en_cours(depot, joueur, compte)
    if not compte and not p:
        return None
    vue = {"identifiant": (p or compte)["identifiant"], "compte": compte is not None,
           "bloque": bool(compte) and not p and compte["lien"] != lien, "provisoire": None}
    if p:
        vue["provisoire"] = {"depuis": p["cree"], "jusqu_au": p["expire"], "expire": expire(p)}
    return vue
