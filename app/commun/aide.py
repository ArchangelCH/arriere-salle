"""L'aide à l'écriture, partagée par le coin des joueurs et l'atelier. Sous chaque passage de « L'histoire de
mon héros » (lore.py), le joueur demande :
  - « Proposer » : une suite, une variante ou une idée pour le passage qu'il écrit ;
  - « Relire » : une relecture au regard de la bible de la campagne et de ce que la compagnie a vécu, qui signale les
    contradictions avec le canon et suggère des liens.
Rien ne s'écrit seul dans son texte : il insère, remplace ou ignore, puis le passage suit le chemin de tous les autres
(brouillon, envoi au MJ, qui tranche).

Le circuit, sans que le coin touche jamais à l'API (il n'a ni Internet ni la clé) :
  - le coin écrit une demande « aide » {mode, champ, texte, question} dans la file du joueur (demandes.py) : appliquée
    par l'atelier, silencieuse pour Telegram, ni dans la boîte du MJ ni dans « Mes demandes » ; une seule en route par
    joueur ;
  - l'atelier (aide_mj.py) la traite à part, une à la fois pour toute la tablée, puis écrit la réponse dans la demande
    (« reponse ») ; le flux du coin pousse le sujet « demandes » au joueur, et sa page relit (GET /api/aide) ;
  - le quota du mois (10 aides par joueur par défaut, un plafond en dollars pour tous) se compte dans l'atelier, qui en
    publie l'état pour le coin (aide/etat.json) : le coin refuse d'avance ce que l'atelier refuserait, et l'atelier
    revérifie tout avant chaque appel.

Ce module ne lit rien de l'atelier : les bornes, la validation et ce que lit le joueur sont les mêmes des deux côtés.
"""
import json
from datetime import datetime
from pathlib import Path

from commun import demandes
from commun import lore
from commun.demandes import Genre, Refus
from commun import stockage

GENRE = "aide"
MODES = ("proposer", "relire")
DOSSIER = "aide"  # dans les propositions, écrit par l'atelier seul
ETAT = "etat.json"
ETAT_OCTETS_MAX = 64 * 1024

TEXTE_MAX = lore.LONG  # le passage envoyé, comme la fiche
QUESTION_MAX = 300
CORPS_OCTETS_MAX = 48 * 1024  # une requête d'aide : le passage entier, ses accents compris
PAR_HEURE = 20  # demandes d'aide par joueur et par heure, retirées comprises (le quota du mois ne compte que les réponses)
GARDEES = 2  # aides closes gardées dans la file du joueur : la page rappelle la dernière, elles ne chassent pas le reste
ATTENTE_MAX = 30 * 60  # secondes : une aide qui a attendu plus longtemps (atelier éteint) n'est plus traitée

# Les bornes de la réponse, dans la file du joueur.
NOTE_MAX = 400
PROPOSITION_MAX = 2000
REMARQUES_MAX = 6
REMARQUE_MAX = 700
CITATION_MAX = 300
BILAN_MAX = 400
VERSION_MAX = lore.LONG
GENRES_PROPOSITION = ("suite", "variante", "idee")
SORTES = ("contradiction", "lien", "ecriture", "a-verifier")

PAR_DEFAUT = 10  # aides par joueur et par mois
PLAFOND_DEFAUT = 5.0  # dollars par mois, pour toute la tablée

INDISPONIBLE = "Indisponible pour l'instant."
EN_ROUTE = "Une aide est déjà en route : attendez sa réponse, ou annulez-la."
EPUISE_TOUS = "L'aide est épuisée pour ce mois-ci : votre MJ peut la rouvrir."
CARNET_FERME = "Le carnet est fermé : votre MJ le rouvre entre les séances."
SANS_HEROS = "Votre héros doit d'abord être à la tablée, accueilli par le MJ."
TROP_SOUVENT = "Beaucoup d'aides demandées cette heure-ci : réessayez un peu plus tard."
PAR_LA_PAGE = "L'aide se demande depuis la page « L'histoire de mon héros »."


def mois_courant() -> str:
    return datetime.now().strftime("%Y-%m")


def epuise_joueur(n: int) -> str:
    return ("Vous avez utilisé votre aide de ce mois-ci : elle revient le mois prochain." if n == 1 else
            f"Vous avez utilisé vos {n} aides de ce mois-ci : elles reviennent le mois prochain.")


def valider(corps) -> dict:
    """{mode, champ, texte, question?} : le passage tel que le joueur l'a sous les yeux (propre, aux bornes de la fiche),
    et sa question éventuelle, sur une ligne. Relire un passage vide n'a pas de sens ; en proposer un, si."""
    corps = demandes.seulement(corps, {"mode", "champ", "texte", "question"}, "L'aide")
    mode = corps.get("mode")
    if mode not in MODES:
        raise Refus(400, "Cette aide n'existe pas.")
    champ = corps.get("champ")
    if champ not in lore.CHAMPS:
        raise Refus(400, "Ce passage ne s'écrit pas depuis le coin.")
    texte = lore.propre(corps.get("texte", ""), f"« {lore.nom(champ)} »")
    question = corps.get("question")
    question = demandes.texte_propre(question, QUESTION_MAX, "Le texte de votre question", lignes=False) if question else ""
    if mode == "relire" and not texte:
        raise Refus(400, "Écrivez d'abord quelques lignes à relire.")
    return {"mode": mode, "champ": champ, "texte": texte, "question": question}


# Appliquée par l'atelier, à part (aide_mj.py) ; carnet fermé, elle ne part pas. Silencieuse, et hors des listes : ni la
# boîte du MJ ni « Mes demandes » ne la montrent, la page de l'histoire seule la suit.
demandes.enregistrer(Genre(GENRE, "Aide à l'écriture", ("une aide à l'écriture", "{n} aides à l'écriture"), attente=False,
                           valider=valider, silencieux=True, carnet=True, liste=False))


# ---------------------------------------------------------------- la réponse

def _chaine(v, maximum: int) -> str:
    if not isinstance(v, str):
        return ""
    t = v.replace("\r\n", "\n").replace("\r", "\n").strip()
    return t if len(t) <= maximum else t[: maximum - 1].rstrip() + "…"


def reponse_sure(r, mode: str) -> dict | None:
    """La réponse telle qu'elle se lit, bornée et de la bonne forme ; None si elle est illisible. Le coin la repasse là
    en lisant la file : un fichier abîmé ne casse pas la page."""
    if not isinstance(r, dict):
        return None
    if mode == "proposer":
        texte = _chaine(r.get("texte"), PROPOSITION_MAX)
        if not texte:
            return None
        genre = r.get("genre") if r.get("genre") in GENRES_PROPOSITION else "suite"
        return {"genre": genre, "note": _chaine(r.get("note"), NOTE_MAX), "texte": texte}
    if mode == "relire":
        remarques = []
        for x in r.get("remarques") or [] if isinstance(r.get("remarques"), list) else []:
            if isinstance(x, dict) and _chaine(x.get("texte"), REMARQUE_MAX):
                remarques.append({"sorte": x.get("sorte") if x.get("sorte") in SORTES else "a-verifier",
                                  "citation": _chaine(x.get("citation"), CITATION_MAX), "texte": _chaine(x.get("texte"), REMARQUE_MAX)})
        bilan = _chaine(r.get("bilan"), BILAN_MAX)
        if not remarques and not bilan:
            return None
        return {"bilan": bilan, "remarques": remarques[:REMARQUES_MAX], "version": _chaine(r.get("version"), VERSION_MAX)}
    return None


# ---------------------------------------------------------------- l'état publié par l'atelier

def chemin_etat(depot: Path) -> Path:
    return depot / DOSSIER / ETAT


def lire_etat(depot: Path) -> dict:
    """{disponible, mois, par_joueur, joueurs: {id: {limite, utilisees}}, epuise}. Absent ou illisible : indisponible
    (un atelier qui n'a jamais publié ne répondra pas)."""
    try:
        chemin = chemin_etat(depot)
        if chemin.stat().st_size > ETAT_OCTETS_MAX:
            raise ValueError
        e = stockage.lire_json(chemin)
    except (OSError, ValueError):
        e = None
    if not isinstance(e, dict):
        return {"disponible": False, "mois": "", "par_joueur": 0, "joueurs": {}, "epuise": False}
    joueurs = e.get("joueurs") if isinstance(e.get("joueurs"), dict) else {}
    return {"disponible": e.get("disponible") is True, "mois": str(e.get("mois") or ""),
            "par_joueur": _entier(e.get("par_joueur"), 0), "joueurs": joueurs, "epuise": e.get("epuise") is True}


def ecrire_etat(depot: Path, etat: dict) -> bool:
    """Écrit par l'atelier seul ; rien n'est réécrit si rien n'a changé (le flux du coin n'est pas dérangé pour rien)."""
    chemin = chemin_etat(depot)
    contenu = json.dumps(etat, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    try:
        if chemin.read_text(encoding="utf-8") == contenu:
            return False
    except OSError:
        pass
    chemin.parent.mkdir(parents=True, exist_ok=True)
    stockage.ecrire_texte(chemin, contenu, mode=0o644)
    return True


def _entier(v, defaut: int) -> int:
    return v if isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 1000 else defaut


def compte(etat: dict, joueur: str, mois: str | None = None) -> tuple[int, int]:
    """(limite, utilisées) de ce joueur ce mois-ci. Un état d'un autre mois (l'atelier n'a pas encore republié) ne
    compte plus rien d'utilisé."""
    mois = mois or mois_courant()
    j = etat["joueurs"].get(joueur) if isinstance(etat["joueurs"].get(joueur), dict) else {}
    limite = _entier(j.get("limite"), etat["par_joueur"])
    utilisees = _entier(j.get("utilisees"), 0) if etat["mois"] == mois else 0
    return limite, utilisees


def aides(liste: list) -> list:
    return [d for d in liste if d.get("genre") == GENRE and isinstance(d.get("corps"), dict)]


def en_cours(liste: list) -> dict | None:
    return next((d for d in aides(liste) if d["statut"] in demandes.OUVERTS), None)


def restantes(etat: dict, joueur: str, liste: list, mois: str | None = None) -> int:
    """Ce qu'il reste ce mois-ci, l'aide en route comptée comme faite (elle le sera)."""
    limite, utilisees = compte(etat, joueur, mois)
    return max(0, limite - utilisees - (1 if en_cours(liste) else 0))


def peut_demander(etat: dict, joueur: str, liste: list, mois: str | None = None) -> None:
    """Refus d'avance de ce que l'atelier refuserait : rien n'est mis en file pour rien."""
    limite, _ = compte(etat, joueur, mois)
    if not etat["disponible"] or limite <= 0:
        raise Refus(503, INDISPONIBLE)
    if en_cours(liste):
        raise Refus(409, EN_ROUTE)
    if etat["epuise"]:
        raise Refus(429, EPUISE_TOUS)
    if restantes(etat, joueur, liste, mois) <= 0:
        raise Refus(429, epuise_joueur(limite))


def garder(liste: list) -> list:
    """La file du joueur avant d'y ajouter une aide, ou après en avoir clos une : seules les GARDEES dernières aides
    closes restent."""
    closes = [d for d in aides(liste) if d["statut"] not in demandes.OUVERTS]
    partent = {id(d) for d in closes[:-GARDEES]} if len(closes) > GARDEES else set()
    return [d for d in liste if id(d) not in partent]


# ---------------------------------------------------------------- ce que lit le joueur

def vue_aide(d: dict) -> dict:
    c = d["corps"]
    mode = c.get("mode") if c.get("mode") in MODES else "proposer"
    return {"id": d["id"], "mode": mode, "champ": c.get("champ") if c.get("champ") in lore.CHAMPS else "",
            "statut": d["statut"], "cree": d.get("cree"), "traitee": d.get("traitee"), "resultat": d.get("resultat") or "",
            "texte": c.get("texte") if isinstance(c.get("texte"), str) else "", "question": c.get("question") or "",
            "reponse": reponse_sure(d.get("reponse"), mode) if d["statut"] == demandes.APPLIQUEE else None}


def vue(liste: list, etat: dict, joueur: str, pause: bool, mois: str | None = None) -> dict:
    """Ce que la page de l'histoire montre de l'aide : si elle répond, ce qui reste ce mois-ci, l'aide en route, et les
    dernières réponses (les siennes seulement : c'est sa propre file)."""
    limite, utilisees = compte(etat, joueur, mois)
    ouverte = etat["disponible"] and limite > 0
    route = en_cours(liste)
    closes = [d for d in reversed(aides(liste)) if d["statut"] in (demandes.APPLIQUEE, demandes.ECHEC)]
    return {"ouvert": True, "pause": pause, "disponible": ouverte, "epuise": bool(ouverte and etat["epuise"]),
            "limite": limite, "utilisees": utilisees, "restantes": restantes(etat, joueur, liste, mois) if ouverte else 0,
            "en_cours": vue_aide(route) if route else None, "reponses": [vue_aide(d) for d in closes[:GARDEES]],
            "question_max": QUESTION_MAX, "attente_max": ATTENTE_MAX}
