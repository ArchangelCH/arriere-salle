"""La file des demandes des joueurs, entre le coin des joueurs et l'atelier.

Le coin écrit dans propositions/demandes/<joueur>.json ce que le joueur demande ou fait (un mot au MJ, plus tard un
geste du sac, un versement au sanctuaire, un déplacement) ; l'atelier surveille ce dossier, applique seul ce qui peut
l'être et laisse au MJ ce qu'il doit trancher, puis écrit le statut dans la même entrée. Les deux services écrivent le
même fichier, toujours sous le verrou du dossier (fcntl).

Chaque entrée : {id, genre, statut, version, cree, modifie, corps, resultat, mot, traitee, par}. La version monte à
chaque changement : le Mac et l'iPad du MJ ne traitent pas deux fois la même demande.

Ce module ne lit rien de l'atelier : main.py (par boite.py) et joueurs.py l'importent tous deux. Les genres, leurs
validateurs, les passages permis et les bornes sont donc les mêmes des deux côtés. Un genre se valide sur ce que le
joueur envoie et sur ce qui est publié pour lui, jamais sur un secret du MJ.
"""
import json
import os
import re
import secrets
import unicodedata
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable
from commun import stockage

DOSSIER = "demandes"
# L'interrupteur « Coin en pause » de l'atelier, publié pour le coin (jamais à la racine des propositions, lue comme des
# héros proposés). Un nom qui ne peut pas être celui d'un joueur.
PAUSE = ".pause.json"
VERROU = ".verrou"

ENTREES_MAX = 60  # par joueur, en attente et traitées
OCTETS_MAX = 128 * 1024  # un fichier plus lourd n'est pas lu
CORPS_OCTETS_MAX = 8 * 1024  # une requête de demande : au-delà, refusée avant d'être lue
PAR_HEURE = 30  # nouvelles demandes par joueur
MOT_MAX = 300  # le mot du MJ qui répond, accepte ou refuse
RESULTAT_MAX = 300  # la phrase d'une demande appliquée ou d'un échec
MESSAGE_MAX = 800  # « Un mot au MJ » : quelques lignes
LIGNES_MAX = 20

ID_JOUEUR = re.compile(r"^[a-z0-9-]{1,60}$")
ID_MJ = re.compile(r"^[a-z0-9-]{1,40}$")  # comme comptes_mj.ID_COMPTE (le coin n'importe pas ce module)
PRINCIPAL = os.environ.get("ATELIER_MJ_PRINCIPAL", "").strip().lower() or "mj"  # comme mj/proprietes.PRINCIPAL
ID_DEMANDE = re.compile(r"^[a-f0-9]{12}$")
CLE_GENRE = re.compile(r"^[a-z][a-z-]{0,30}$")

A_APPLIQUER, EN_ATTENTE = "a-appliquer", "en-attente"
APPLIQUEE, ACCEPTEE, REFUSEE, ECHEC, RETIREE, ANNULEE = "appliquee", "acceptee", "refusee", "echec", "retiree", "annulee"
OUVERTS = (A_APPLIQUER, EN_ATTENTE)
STATUTS = (*OUVERTS, APPLIQUEE, ACCEPTEE, REFUSEE, ECHEC, RETIREE, ANNULEE)
# Les passages permis, et qui les fait : le joueur retire tant que rien n'est fait, l'atelier applique (ou échoue), le
# MJ tranche ce qui l'attend et annule ce qui s'est appliqué seul.
TRANSITIONS = {
    A_APPLIQUER: {APPLIQUEE: "atelier", ECHEC: "atelier", RETIREE: "joueur"},
    # L'atelier peut aussi mettre en échec ce qui attend le MJ, quand il le prépare (le dé d'une activité, activites_mj.py).
    EN_ATTENTE: {ACCEPTEE: "mj", REFUSEE: "mj", RETIREE: "joueur", ECHEC: "atelier"},
    APPLIQUEE: {ANNULEE: "mj"},
}
# Ce que lit le joueur, quel que soit le genre (un genre peut dire autrement, Genre.statuts).
STATUTS_DITS = {A_APPLIQUER: "en route", EN_ATTENTE: "en attente du MJ", APPLIQUEE: "fait", ACCEPTEE: "accepté par le MJ",
                REFUSEE: "refusé par le MJ", ECHEC: "pas possible", RETIREE: "retiré", ANNULEE: "annulé par le MJ"}


class Refus(Exception):
    """Une demande refusée, avec le statut HTTP et la phrase à montrer."""

    def __init__(self, statut: int, message: str):
        super().__init__(message)
        self.statut = statut
        self.message = message


def maintenant() -> str:
    return datetime.now().isoformat(timespec="milliseconds")


# ---------------------------------------------------------------- les genres

@dataclass(frozen=True)
class Genre:
    """Un genre de demande. valider(corps) rend le corps tel qu'il s'enregistre, ou lève Refus : le coin l'appelle avant
    d'écrire, l'atelier de nouveau avant d'appliquer ou de laisser trancher. Ce qu'il fait dans l'atelier (appliquer,
    accepter, annuler) se branche dans boite.py, qui seul touche aux fiches."""
    cle: str
    nom: str  # dans la boîte du MJ et le carnet du joueur : « Un mot au MJ »
    telegram: tuple  # (un, plusieurs) : « un mot pour toi », « {n} mots pour toi » ; jamais un texte du joueur
    attente: bool  # vrai : le MJ tranche (en-attente) ; faux : l'atelier applique seul (a-appliquer)
    valider: Callable[[dict], dict]
    silencieux: bool = False  # aucune notification Telegram (les déplacements)
    carnet: bool = False  # refusé quand le carnet est fermé (sac, sanctuaire, activités)
    annulable: bool = False  # appliqué seul : le MJ peut l'annuler depuis la boîte
    # Faux : ni dans la boîte du MJ, ni dans « Mes demandes » du joueur (la main levée vit dans le Tableau et sous son pouce).
    liste: bool = True
    oui: str = "Accepter"  # le bouton du MJ
    non: str | None = "Refuser"  # None : pas de refus (un mot se lit, il ne se refuse pas)
    statuts: dict = field(default_factory=dict)  # ce que lit le joueur, quand le mot commun ne va pas


GENRES: dict[str, Genre] = {}


def enregistrer(genre: Genre) -> Genre:
    if not CLE_GENRE.match(genre.cle):
        raise ValueError(f"Clé de genre invalide : {genre.cle}")
    GENRES[genre.cle] = genre
    return genre


def texte_propre(valeur, maximum: int, nom: str = "Ce texte", lignes: bool = True) -> str:
    """Un texte écrit par le joueur : sans caractère de contrôle ni invisible, lignes resserrées, deux sauts au plus.
    Trop long, il est refusé plutôt que coupé : le joueur garde la main sur ce qu'il envoie."""
    if not isinstance(valeur, str):
        raise Refus(400, f"{nom} est illisible.")
    t = unicodedata.normalize("NFC", valeur.replace("\r\n", "\n").replace("\r", "\n"))
    t = "".join(c for c in t if c == "\n" or unicodedata.category(c)[0] != "C")
    rangs = [" ".join(r.split()) for r in t.split("\n")] if lignes else [" ".join(t.split())]
    t = re.sub(r"\n{3,}", "\n\n", "\n".join(rangs)).strip()
    if len(t) > maximum:
        raise Refus(413, f"{nom} est trop long : {maximum} signes au plus.")
    if t.count("\n") >= LIGNES_MAX:
        raise Refus(413, f"{nom} a trop de lignes : {LIGNES_MAX} au plus.")
    return t


def seulement(corps, permis: set, nom: str) -> dict:
    if not isinstance(corps, dict):
        raise Refus(400, f"{nom} : demande illisible.")
    inconnus = sorted(str(k)[:30] for k in corps if k not in permis)
    if inconnus:
        raise Refus(400, f"{nom} : champ inconnu ({', '.join(inconnus)}).")
    return corps


def valider_message(corps) -> dict:
    corps = seulement(corps, {"texte", "mj"}, "Un mot au MJ")
    t = texte_propre(corps.get("texte"), MESSAGE_MAX, "Votre mot")
    if not t:
        raise Refus(400, "Écrivez quelques mots au MJ.")
    propre = {"texte": t}
    # Le MJ choisi par le joueur quand deux mènent la campagne ; absent : le principal. Le coin le vérifie sur
    # la liste publiée (lire_destinataires), l'atelier sur ses comptes (boite.py).
    mj = corps.get("mj")
    if mj is not None and mj != PRINCIPAL:
        if not isinstance(mj, str) or not ID_MJ.fullmatch(mj):
            raise Refus(400, "Un mot au MJ : destinataire illisible.")
        propre["mj"] = mj
    return propre


# « Un mot au MJ » : quelques lignes écrites depuis le carnet. Le MJ le lit (« Lu ») ou y répond d'un mot.
enregistrer(Genre("message", "Un mot au MJ", ("un mot pour toi", "{n} mots pour toi"), attente=True, valider=valider_message,
                  oui="Lu", non=None, statuts={EN_ATTENTE: "envoyé, pas encore lu", ACCEPTEE: "lu par le MJ"}))


def dans_la_liste(d: dict) -> bool:
    """Cette demande paraît-elle dans la boîte du MJ et dans « Mes demandes » ? Un genre inconnu de cette version, oui."""
    g = GENRES.get(d.get("genre"))
    return g is None or g.liste


def statut_dit(d: dict) -> str:
    g = GENRES.get(d.get("genre"))
    return (g.statuts.get(d.get("statut")) if g else None) or STATUTS_DITS.get(d.get("statut"), "")


# ---------------------------------------------------------------- le fichier d'un joueur

@contextmanager
def verrou(depot: Path):
    """Le verrou du dossier des demandes, pris par le coin (nouvelle demande, retrait) comme par l'atelier (statuts)."""
    with stockage.verrou_de_dossier(depot / DOSSIER, VERROU):
        yield


def fichier(depot: Path, joueur: str) -> Path:
    if not isinstance(joueur, str) or not ID_JOUEUR.match(joueur):
        raise Refus(403, "Accès invalide")
    return depot / DOSSIER / f"{joueur}.json"


def entree_valide(d) -> bool:
    return (isinstance(d, dict) and isinstance(d.get("id"), str) and bool(ID_DEMANDE.match(d["id"]))
            and isinstance(d.get("genre"), str) and bool(CLE_GENRE.match(d["genre"])) and d.get("statut") in STATUTS
            and isinstance(d.get("version"), int) and not isinstance(d.get("version"), bool) and d["version"] >= 1
            and isinstance(d.get("corps"), dict) and isinstance(d.get("cree"), str))


def lire(depot: Path, joueur: str) -> list:
    """Les demandes d'un joueur, dans l'ordre où il les a faites. Un fichier trop lourd ou illisible ne se lit pas ; une
    entrée abîmée est laissée de côté. Un genre inconnu de cette version reste (une version plus récente l'a écrit)."""
    chemin = fichier(depot, joueur)
    try:
        if chemin.stat().st_size > OCTETS_MAX:
            return []
        liste = stockage.lire_json(chemin)
    except (OSError, ValueError):
        return []
    return [d for d in liste if entree_valide(d)][-ENTREES_MAX:] if isinstance(liste, list) else []


def taille(liste: list) -> int:
    return len(json.dumps(liste, ensure_ascii=False, separators=(",", ":")).encode())


def borner(liste: list) -> list:
    """La liste dans ses bornes : les plus anciennes déjà traitées s'en vont d'abord ; ce qui attend encore ne s'en va
    jamais (Refus 429 : le joueur attend que le MJ en traite)."""
    liste = list(liste)
    while len(liste) > ENTREES_MAX or taille(liste) > OCTETS_MAX:
        vieille = next((d for d in liste if d.get("statut") not in OUVERTS), None)
        if vieille is None:
            raise Refus(429, "Trop de demandes en attente : laissez au MJ le temps d'en traiter.")
        liste.remove(vieille)
    return liste


def ecrire(depot: Path, joueur: str, liste: list) -> None:
    """À appeler sous le verrou. Écriture atomique : l'autre service ne lit jamais un fichier à moitié écrit."""
    chemin = fichier(depot, joueur)
    liste = borner(liste)
    if not liste:
        chemin.unlink(missing_ok=True)
        return
    chemin.parent.mkdir(parents=True, exist_ok=True)
    stockage.ecrire_json_compact(chemin, liste, mode=0o644)


def trouver(liste: list, ident: str) -> dict | None:
    if not isinstance(ident, str) or not ID_DEMANDE.match(ident):
        return None
    return next((d for d in liste if d["id"] == ident), None)


def recentes(liste: list, depuis: datetime) -> int:
    """Les demandes faites depuis cet instant (le plafond horaire)."""
    borne = depuis.isoformat(timespec="milliseconds")
    return sum(1 for d in liste if str(d.get("cree") or "") >= borne)


# ---------------------------------------------------------------- les gestes

def nouvelle(corps, carnet_ouvert: bool = True) -> dict:
    """Une demande du joueur, validée par son genre : seuls le genre et le corps viennent de lui, le reste du serveur."""
    if not isinstance(corps, dict):
        raise Refus(400, "Demande illisible.")
    g = GENRES.get(corps.get("genre")) if isinstance(corps.get("genre"), str) else None
    if g is None:
        raise Refus(400, "Ce genre de demande n'existe pas.")
    if set(corps) - {"genre", "corps"}:
        raise Refus(400, "Demande illisible : champ inconnu.")
    if g.carnet and not carnet_ouvert:
        raise Refus(423, "Le carnet est fermé : votre MJ le rouvre entre les séances.")
    propre = g.valider(corps.get("corps"))
    instant = maintenant()
    return {"id": secrets.token_hex(6), "genre": g.cle, "statut": EN_ATTENTE if g.attente else A_APPLIQUER, "version": 1,
            "cree": instant, "modifie": instant, "corps": propre, "resultat": None, "mot": "", "traitee": None, "par": "joueur"}


def ajouter(deja: list, demande: dict, plafond: int = PAR_HEURE) -> list:
    """La liste du joueur avec sa nouvelle demande, dans les bornes ; 429 au-delà du plafond horaire."""
    if recentes(deja, datetime.now() - timedelta(hours=1)) >= plafond:
        raise Refus(429, f"Pas plus de {plafond} demandes par heure : réessayez un peu plus tard.")
    return borner([*deja, demande])


def verifier(d: dict, statut: str, par: str, *, version=None) -> None:
    """Le passage est-il permis, et fait par qui il faut ? version : celle que l'écran du MJ a lue ; une autre (un autre
    écran est passé avant, ou le joueur a retiré sa demande) refuse le geste."""
    if version is not None and version != d.get("version"):
        if d.get("statut") == RETIREE:
            raise Refus(409, "Le joueur a retiré cette demande.")
        raise Refus(409, "Cette demande a changé depuis : un autre écran l'a traitée, ou le joueur l'a retirée.")
    permis = TRANSITIONS.get(d.get("statut"), {})
    if statut not in permis:
        if d.get("statut") == RETIREE:
            raise Refus(409, "Le joueur a retiré cette demande.")
        raise Refus(409, "Cette demande a déjà été traitée.")
    if permis[statut] != par:
        raise Refus(403, "Ce geste ne vous revient pas.")
    # « fige » : l'atelier a fait ce qui ne se défait pas (le dé d'une activité est jeté) ; le joueur ne la retire plus.
    if statut == RETIREE and d.get("fige"):
        raise Refus(409, "Le dé est jeté : cette demande ne se retire plus, votre MJ tranche.")


def passer(d: dict, statut: str, par: str, *, version=None, mot: str = "", resultat: str | None = None) -> dict:
    """Le passage d'une demande à un nouveau statut (verifier d'abord) : la version monte d'un cran."""
    verifier(d, statut, par, version=version)
    instant = maintenant()
    d.update(statut=statut, version=d["version"] + 1, modifie=instant, par=par)
    if statut != RETIREE:
        d["traitee"] = instant
    if mot:
        d["mot"] = mot[:MOT_MAX]
    if resultat is not None:
        d["resultat"] = str(resultat)[:RESULTAT_MAX]
    return d


def vue_joueur(d: dict) -> dict:
    """Ce que le joueur relit de sa demande : son propre corps, le statut en clair, le mot du MJ (déjà passé au masque et
    retenu par l'atelier) et la phrase d'un échec. « public » : ce que l'atelier y a écrit pour lui (le jet d'une activité),
    déjà passé au masque. Rien d'autre."""
    g = GENRES.get(d.get("genre"))
    vue = {"id": d["id"], "genre": d["genre"], "genre_nom": g.nom if g else "Demande", "statut": d["statut"],
           "statut_dit": statut_dit(d), "cree": d.get("cree"), "modifie": d.get("modifie"), "traitee": d.get("traitee"),
           "corps": d.get("corps"), "resultat": d.get("resultat"), "mot": d.get("mot") or "",
           "retirable": d["statut"] in OUVERTS and not d.get("fige")}
    if isinstance(d.get("public"), dict):
        vue["public"] = d["public"]
    return vue


# ---------------------------------------------------------------- « Coin en pause »

def lire_pause(depot: Path) -> dict:
    """Coin en pause : aucune écriture des joueurs. Sans réglage, le coin est ouvert ; un réglage illisible le met en pause,
    par prudence (le MJ le voit dans l'onglet Table et le rouvre d'un geste)."""
    chemin = depot / DOSSIER / PAUSE
    if not chemin.exists():
        return {"pause": False, "modifie": None}
    try:
        reglage = stockage.lire_json(chemin)
    except (OSError, ValueError):
        return {"pause": True, "modifie": None}
    if not isinstance(reglage, dict) or not isinstance(reglage.get("pause"), bool):
        return {"pause": True, "modifie": None}
    return {"pause": reglage["pause"], "modifie": reglage.get("modifie") if isinstance(reglage.get("modifie"), str) else None}


def en_pause(depot: Path) -> bool:
    return lire_pause(depot)["pause"]


def ecrire_pause(depot: Path, pause: bool) -> dict:
    """Écrit par l'atelier seul."""
    reglage = {"pause": bool(pause), "modifie": maintenant()}
    chemin = depot / DOSSIER / PAUSE
    chemin.parent.mkdir(parents=True, exist_ok=True)
    stockage.ecrire_json(chemin, reglage, mode=0o644)
    return reglage


# ---------------------------------------------------------------- à quel MJ écrire

# Les MJ à qui un joueur peut écrire « Un mot au MJ », publiés par l'atelier (boite.py) quand un MJ invité ouvert existe ;
# sans lui, pas de fichier : le coin ne propose aucun choix, le mot va au principal comme toujours. Un nom qui ne peut pas
# être celui d'un joueur, comme la pause.
DESTINATAIRES = ".destinataires.json"


def lire_destinataires(depot: Path) -> list:
    """[{"id", "nom"}] des MJ à qui écrire, le principal d'abord ; [] s'il n'y en a qu'un (ou un fichier illisible)."""
    try:
        contenu = stockage.lire_json((depot / DOSSIER / DESTINATAIRES))
    except (OSError, ValueError):
        return []
    liste = contenu.get("mj") if isinstance(contenu, dict) else None
    propres = [{"id": x["id"], "nom": " ".join(x["nom"].split())[:60]} for x in liste or []
               if isinstance(x, dict) and isinstance(x.get("id"), str) and ID_MJ.fullmatch(x["id"]) and isinstance(x.get("nom"), str)]
    return propres if len(propres) > 1 and propres[0]["id"] == PRINCIPAL else []


def ecrire_destinataires(depot: Path, liste: list) -> bool:
    """Écrit par l'atelier seul : la liste si elle a plus d'un MJ, sinon rien (le fichier s'efface). Vrai si elle a changé."""
    chemin = depot / DOSSIER / DESTINATAIRES
    if len(liste) < 2:
        if not chemin.exists():
            return False
        chemin.unlink(missing_ok=True)
        return True
    texte = json.dumps({"mj": [{"id": x["id"], "nom": x["nom"]} for x in liste]}, ensure_ascii=False)
    try:
        if chemin.read_text(encoding="utf-8") == texte:
            return False
    except OSError:
        pass
    chemin.parent.mkdir(parents=True, exist_ok=True)
    stockage.ecrire_texte(chemin, texte, mode=0o644)
    return True


MOT_PAUSE = "Le coin est en pause pour un moment : votre MJ le rouvrira. Rien n'est perdu, réessayez un peu plus tard."
