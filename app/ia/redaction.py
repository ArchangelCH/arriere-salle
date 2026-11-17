"""Rédaction par le modèle de langue de l'API, partagée par tout l'atelier.

- Chaque appel reçoit le contexte de la campagne en blocs mis en cache (consigne générale, canon, état de la campagne) :
  le premier appel de l'heure paie le contexte, les suivants n'en paient qu'une fraction.
- Un refus du modèle est rejoué côté serveur sur le modèle de repli recommandé (paramètre « fallbacks »).
- Chaque appel est noté dans un journal des coûts (jetons et dollars).
- Les longs textes arrivent en flux ; les relectures peuvent partir en lot différé, à moitié prix et sans cache.
- Le journal donne aussi, avant chaque appel, son prix et son attente probables (estimations()).
- Un lien vers une vidéo n'est gardé que s'il figure tel quel dans la bible : le modèle ne doit pas en inventer.
- Deux MJ : chaque appel est noté pour le MJ de la requête (« qui » : « mj:<compte> » ; le joueur pour l'aide à
  l'écriture), chacun lit ses coûts, ses estimations et ses lots ; le budget du mois d'un MJ invité se vérifie avant
  l'appel (regler_garde), un appel qu'il ne permet pas ne part pas (BudgetAtteint).
"""
import asyncio
import base64
import json
import os
import re
import secrets
import time
from datetime import datetime
from statistics import median
from pathlib import Path
from typing import AsyncIterator, Callable

import anthropic
from commun import stockage

MODELE = os.environ.get("CLAUDE_MODELE", "claude-opus-5-5")
_CLE = os.environ.get("ANTHROPIC_API_KEY", "").strip()
CLIENT = anthropic.AsyncAnthropic(api_key=_CLE, timeout=600, max_retries=2) if _CLE else None
# Repli automatique en cas de refus : le serveur choisit le modèle selon la catégorie du refus.
BETAS_REPLI = ["server-side-fallback-2026-07-01"]

# Profondeur de réflexion selon l'usage : bas pour les petites tâches, haut pour l'écriture et les relectures.
EFFORTS = {
    "prompt-image": "low", "pnj": "medium", "pnj-variantes": "medium", "precedemment": "medium", "histoire": "medium",
    "consigne": "high", "relecture": "high", "lieu": "medium", "peupler": "medium", "plan": "medium",
    "habillage-carte": "medium", "habillage-plan": "medium", "controle-image": "low",
    # L'aide à l'écriture des joueurs (aide_mj.py) : une proposition va vite, une relecture pèse le canon.
    "aide-proposer": "low", "aide-relire": "medium",
    # Corriger et mettre en page un chapitre sans en changer le fond : un travail soigné, sans longue réflexion (elle
    # compte dans les jetons de sortie, qu'il faut laisser au chapitre).
    "mise-en-page": "medium",
    # Trois structures de scénario à partir d'une idée : il faut peser l'enchaînement des scènes.
    "squelette": "high",
}
NOMS_FONCTIONS = {
    "prompt-image": "Consignes d'illustration", "pnj": "PNJ", "pnj-variantes": "PNJ (variantes)",
    "precedemment": "« Précédemment »", "histoire": "Histoires d'aventuriers", "consigne": "Consignes de scénario",
    "relecture": "Relectures", "lieu": "Fiches de lieu", "peupler": "Régions peuplées", "plan": "Plans programmés",
    "habillage-carte": "Habillage des cartes", "habillage-plan": "Habillage des plans",
    "controle-image": "Contrôle des portraits",
    "aide-proposer": "Aide des joueurs : proposer", "aide-relire": "Aide des joueurs : relire",
    "mise-en-page": "Relecture et mise en page", "squelette": "Squelettes de scénario",
}
# Dollars par million de jetons (entrée, sortie, lecture du cache), relevés sur la page des tarifs de l'API le 01/11/2026.
# Écriture du cache : ×1,25 de l'entrée (5 min) ou ×2 (1 h). Un lot différé coûte moitié prix, cache compris.
# Haiku 5.5 : tarif des demandes de moins de 100 000 jetons (au-delà, il est cinq fois plus cher).
# Sonnet 5.5 : la lecture du cache coûte 0,20 $ (corrigé le 08/11, il était noté 0,10 $). Sonnet 5 a les mêmes tarifs :
# c'est le modèle de repli d'un refus de Sonnet 5.5, et sa réponse est notée sous son nom.
TARIFS = {
    "claude-opus-5-5": (4.0, 20.0, 0.20), "claude-opus-5": (5.0, 25.0, 0.50), "claude-opus-4-8": (5.0, 25.0, 0.50),
    "claude-sonnet-5-5": (2.0, 10.0, 0.20), "claude-sonnet-5": (2.0, 10.0, 0.20), "claude-haiku-5-5": (0.10, 0.50, 0.01),
}


class Indisponible(Exception):
    """Pas de clé, panne réseau, crédit épuisé ou refus : l'appelant le dit au MJ (ou se replie sur le modèle local)."""


class Refusee(Indisponible):
    """Le modèle a refusé la demande (après le repli) : la reformuler peut suffire, réessayer telle quelle non."""


class DepotRefuse(Exception):
    """Le texte d'un lot relevé ne peut pas être déposé tel quel (une mise en page qui ne passe pas ses garde-fous) : le
    lot finit en erreur, avec ce message pour le MJ."""


class BudgetAtteint(Indisponible):
    """Le budget de rédaction du mois d'un MJ invité ne permet pas cet appel : il n'est pas parti."""


def disponible() -> bool:
    return CLIENT is not None


# Le contexte commun (consigne générale, canon, état de la campagne) est fourni par le serveur, qui lit les données.
_CONTEXTE: Callable[[str], list[dict]] = lambda niveau: []


def regler_contexte(fournisseur: Callable[[str], list[dict]]) -> None:
    global _CONTEXTE
    _CONTEXTE = fournisseur


def contexte(niveau: str = "leger") -> list[dict]:
    """« leger » : consigne générale, glossaire, ton de la table, état de la campagne. « complet » : la bible entière en plus.
    « public » : comme « leger », mais l'état de la campagne se réduit à ce que savent les joueurs."""
    return _CONTEXTE(niveau)


# ---------------------------------------------------------------- pour qui part l'appel, et son budget

# Le MJ de la requête en cours (« mj:<compte> »), fourni par le serveur ; None hors d'une requête (une tâche de fond, qui
# donne le sien : un lot, le contrôle d'un portrait).
_QUI: Callable[[], str | None] = lambda: None
# La garde du budget, vérifiée avant chaque appel : elle lève BudgetAtteint, ou rend de quoi libérer ce qu'elle a réservé
# pour l'appel une fois son coût noté au journal (deux appels du même MJ en même temps ne passent pas tous deux sous le
# plafond).
_GARDE: Callable[[dict], Callable[[], None] | None] = lambda appel: None


def regler_qui(fournisseur: Callable[[], str | None]) -> None:
    global _QUI
    _QUI = fournisseur


def regler_garde(garde: Callable[[dict], Callable[[], None] | None]) -> None:
    global _GARDE
    _GARDE = garde


def pour_qui(qui: str | None = None) -> str | None:
    return qui or _QUI()


def _reserver(fonction: str, qui: str | None, systeme: list, contenu, modele: str | None = None, lot: bool = False) -> Callable[[], None]:
    return _GARDE({"fonction": fonction, "qui": qui, "systeme": systeme, "contenu": contenu, "modele": modele or MODELE,
                   "lot": lot}) or (lambda: None)


# Pour le prix minimal d'un appel avant de l'envoyer (plancher) : le français de la bible et des fiches compte environ deux
# caractères par jeton (mesuré le 09/11 : 87 844 caractères de contexte léger pour environ 44 600 jetons au journal, et
# 597 864 avec la bible pour environ 304 000) ; 1,8 compte large, le plancher ne sous-estime pas l'entrée.
CARACTERES_PAR_JETON = 1.8
JETONS_PAR_IMAGE = 1600


def jetons_de(contenu) -> int:
    if isinstance(contenu, str):
        return round(len(contenu) / CARACTERES_PAR_JETON)
    if isinstance(contenu, dict):
        if contenu.get("type") == "image":
            return JETONS_PAR_IMAGE
        return jetons_de(contenu.get("text") or "")
    if isinstance(contenu, list):
        return sum(jetons_de(x) for x in contenu)
    return 0


def plancher(systeme: list, contenu, modele: str | None = None, lot: bool = False, en_cache: bool = False) -> float:
    """Le prix minimal probable d'un appel, avant de l'envoyer : son entrée comptée large, le contexte mis en cache écrit
    (ou lu, s'il est encore en cache), la réponse non comptée. Un lot : moitié prix, sans cache."""
    entree, _sortie, lecture = tarif(modele or MODELE)
    if lot:
        return round((jetons_de(systeme) + jetons_de(contenu)) * entree / 2e6, 5)
    # Le cache garde tout ce qui précède une marque, au prix de cette marque (une heure : deux fois l'entrée ; cinq minutes :
    # 1,25 fois) ; ce qui suit la dernière marque, et la demande, au prix de l'entrée.
    dollars, attente = 0.0, 0
    for bloc in systeme or []:
        attente += jetons_de(bloc)
        ttl = (bloc.get("cache_control") or {}).get("ttl") if isinstance(bloc, dict) else None
        if ttl:
            dollars += attente * (lecture if en_cache else entree * (2 if ttl == "1h" else 1.25))
            attente = 0
    dollars += (attente + jetons_de(contenu)) * entree
    return round(dollars / 1e6, 5)


# ---------------------------------------------------------------- journal des coûts

JOURNAL: Path | None = None


def regler_journal(chemin: Path) -> None:
    global JOURNAL
    JOURNAL = chemin


def _jetons(usage, nom: str) -> int:
    return int(getattr(usage, nom, 0) or 0)


def tarif(modele: str) -> tuple[float, float, float]:
    return TARIFS.get(modele, TARIFS["claude-opus-5-5"])


def cout(modele: str, usage, lot: bool = False) -> float:
    entree, sortie, lecture = tarif(modele)
    creation = getattr(usage, "cache_creation", None)
    ecrit_1h = _jetons(creation, "ephemeral_1h_input_tokens") if creation else 0
    ecrit_5m = _jetons(usage, "cache_creation_input_tokens") - ecrit_1h
    dollars = (_jetons(usage, "input_tokens") * entree + ecrit_5m * entree * 1.25 + ecrit_1h * entree * 2
               + _jetons(usage, "cache_read_input_tokens") * lecture + _jetons(usage, "output_tokens") * sortie) / 1e6
    return round(dollars * (0.5 if lot else 1), 5)


def noter(fonction: str, message, lot: bool = False, debut: float | None = None, qui: str | None = None) -> float:
    """debut : l'heure (time.monotonic) où la demande est partie, pour noter l'attente en secondes (pas pour un lot).
    qui : le joueur pour qui l'appel est fait (l'aide à l'écriture), pour ses coûts et son quota du mois."""
    usage = getattr(message, "usage", None)
    if usage is None:
        return 0.0
    modele = getattr(message, "model", MODELE) or MODELE
    dollars = cout(modele, usage, lot)
    if JOURNAL is not None:
        ligne = {
            "date": datetime.now().isoformat(timespec="seconds"), "fonction": fonction, "modele": modele, "lot": lot,
            "entree": _jetons(usage, "input_tokens"), "sortie": _jetons(usage, "output_tokens"),
            "cache_ecrit": _jetons(usage, "cache_creation_input_tokens"), "cache_lu": _jetons(usage, "cache_read_input_tokens"),
            "cout": dollars,
        }
        if debut is not None:
            ligne["duree"] = round(time.monotonic() - debut, 1)
        if qui:
            ligne["qui"] = str(qui)[:60]
        JOURNAL.parent.mkdir(parents=True, exist_ok=True)
        with JOURNAL.open("a", encoding="utf-8") as f:
            f.write(json.dumps(ligne, ensure_ascii=False) + "\n")
    return dollars


def lignes_journal() -> list[dict]:
    lignes = []
    if JOURNAL is not None and JOURNAL.exists():
        for brut in JOURNAL.read_text(encoding="utf-8").splitlines():
            try:
                ligne = json.loads(brut)
            except ValueError:
                continue
            if isinstance(ligne, dict):
                lignes.append(ligne)
    return lignes


# Le nom de chaque joueur d'après son identifiant (noté « qui » au journal), fourni par le serveur.
_NOMS_QUI: Callable[[], dict] = lambda: {}


def regler_noms_qui(fournisseur: Callable[[], dict]) -> None:
    global _NOMS_QUI
    _NOMS_QUI = fournisseur


# Un appel fait pour un MJ est noté « mj:<compte> » ; sans « qui », il est au compte principal (les lignes d'avant le lot
# MJ-5, les tâches de fond).
PREFIXE_MJ = "mj:"


def couts(mois: str | None = None, garder=None) -> dict:
    """Le mois demandé (AAAA-MM, le mois en cours par défaut) : total, détail par usage, par joueur (les appels faits
    pour un joueur, « qui »), derniers appels. garder(ligne) : les seules lignes d'un MJ (budget_mj.py)."""
    mois = mois or datetime.now().strftime("%Y-%m")
    lignes = [x for x in lignes_journal() if str(x.get("date", "")).startswith(mois) and (garder is None or garder(x))]
    par_fonction: dict[str, dict] = {}
    par_qui: dict[str, dict] = {}
    for ligne in lignes:
        f = par_fonction.setdefault(ligne.get("fonction", "?"), {"appels": 0, "cout": 0.0})
        f["appels"] += 1
        f["cout"] += float(ligne.get("cout") or 0)
        if isinstance(ligne.get("qui"), str) and ligne["qui"] and not ligne["qui"].startswith(PREFIXE_MJ):
            q = par_qui.setdefault(ligne["qui"], {"appels": 0, "cout": 0.0})
            q["appels"] += 1
            q["cout"] += float(ligne.get("cout") or 0)
    detail = sorted(({"fonction": k, "nom": NOMS_FONCTIONS.get(k, k), "appels": v["appels"], "cout": round(v["cout"], 4)}
                     for k, v in par_fonction.items()), key=lambda x: -x["cout"])
    try:
        noms = _NOMS_QUI() or {}
    except Exception:  # noqa: BLE001 : un nom illisible ne cache pas les coûts
        noms = {}
    joueurs = sorted(({"qui": k, "nom": str(noms.get(k) or k), "appels": v["appels"], "cout": round(v["cout"], 4)}
                      for k, v in par_qui.items()), key=lambda x: -x["cout"])
    return {
        "mois": mois, "total": round(sum(float(x.get("cout") or 0) for x in lignes), 4), "appels": len(lignes),
        "detail": detail, "joueurs": joueurs, "derniers": [{**x, "nom": NOMS_FONCTIONS.get(x.get("fonction"), x.get("fonction"))} for x in lignes[-12:][::-1]],
        "disponible": disponible(),
    }


# ---------------------------------------------------------------- prix et attente probables

# Au-delà de ce nombre de jetons en cache, le contexte comprend la bible entière (environ 300 000 jetons, contre 42 000 sans).
SEUIL_BIBLE = 100_000
# Le contexte est gardé une heure en cache après son dernier usage ; la marge couvre la durée de l'appel (le journal note la fin).
GARDE_CACHE = 55 * 60
# Jetons produits par seconde, attente comprise, quand le journal ne note pas encore la durée (habillages du 31/10 lancés
# l'un après l'autre : environ 45 s pour 4 700 à 5 600 jetons).
DEBIT = 100
# Ce que chaque bouton annonce : l'usage noté au journal et le contexte qu'il emporte (aucun, léger ou bible entière).
ESTIMATIONS = {
    "prompt-image": ("prompt-image", "aucun"), "pnj": ("pnj", "leger"), "pnj-variantes": ("pnj-variantes", "leger"),
    "precedemment": ("precedemment", "leger"), "histoire": ("histoire", "leger"), "consigne": ("consigne", "leger"),
    "verifier": ("consigne", "bible"), "relecture": ("relecture", "bible"), "relecture-rapide": ("relecture", "leger"),
    "lieu": ("lieu", "leger"), "peupler": ("peupler", "leger"), "plan": ("plan", "leger"),
    "habillage-carte": ("habillage-carte", "leger"), "habillage-plan": ("habillage-plan", "leger"),
    "mise-en-page": ("mise-en-page", "leger"), "squelette": ("squelette", "leger"),
}
# Les boutons qui répondent encore sans clé d'API : le modèle local du serveur écrit à sa place (illustrations.py).
REPLI_LOCAL = ("pnj", "precedemment", "histoire")


def _contexte_de(ligne: dict) -> int:
    return int(ligne.get("cache_ecrit") or 0) + int(ligne.get("cache_lu") or 0)


def famille(ligne: dict) -> str:
    """Le contexte qu'un appel a emporté, d'après les jetons passés par le cache."""
    jetons = _contexte_de(ligne)
    return "bible" if jetons >= SEUIL_BIBLE else "leger" if jetons else "aucun"


def _date(ligne: dict) -> datetime | None:
    try:
        return datetime.fromisoformat(str(ligne.get("date")))
    except ValueError:
        return None


def estimations(maintenant: datetime | None = None, garder=None) -> dict:
    """Pour chaque bouton (clés d'ESTIMATIONS) : le prix et l'attente probables du prochain appel, d'après les derniers
    appels réels du journal (jetons médians, aux tarifs du moment), selon que le contexte est encore en cache ou à recharger.
    « differe » : la même demande en lot, sans cache, à moitié prix. Un usage jamais appelé n'a pas de prix, seulement le
    plancher du contexte (« minimum ») quand on le connaît. garder(ligne) : les seules lignes d'un MJ, dont le contexte et le
    cache sont les siens (budget_mj.py)."""
    maintenant = maintenant or datetime.now()
    lignes = [x for x in lignes_journal() if _date(x) and not x.get("lot") and (garder is None or garder(x))]
    entree_t, sortie_t, lecture_t = tarif(MODELE)
    # Taille actuelle du contexte de chaque famille (le dernier appel qui l'a emporté) et son dernier usage : tout contexte
    # commence par la consigne et le canon léger, la bible y ajoute son bloc.
    taille, dernier = {}, {}
    for x in lignes:
        f = famille(x)
        if f != "aucun":
            taille[f] = _contexte_de(x)
            dernier[f] = _date(x)
            dernier["leger"] = _date(x)
    usages = {}
    for cle, (fonction, fam) in ESTIMATIONS.items():
        siennes = [x for x in lignes if x.get("fonction") == fonction and famille(x) == fam][-5:]
        jetons = taille.get(fam, 0) if fam != "aucun" else 0
        en_cache = fam == "aucun" or (fam in dernier and (maintenant - dernier[fam]).total_seconds() < GARDE_CACHE)
        contexte_froid = jetons * entree_t * 2 / 1e6
        contexte = jetons * lecture_t / 1e6 if en_cache else contexte_froid
        if not siennes:
            usages[cle] = {"connu": False, "famille": fam, "minimum": round(contexte, 4) if jetons else None, "en_cache": en_cache}
            continue
        entree = median(int(x.get("entree") or 0) for x in siennes)
        sortie = median(int(x.get("sortie") or 0) for x in siennes)
        durees = [float(x["duree"]) for x in siennes if isinstance(x.get("duree"), (int, float))]
        variable = (entree * entree_t + sortie * sortie_t) / 1e6
        usages[cle] = {
            "connu": True, "famille": fam, "appels": len(siennes), "en_cache": en_cache,
            "cout": round(variable + contexte, 4), "cout_en_cache": round(variable + jetons * lecture_t / 1e6, 4),
            "contexte_a_charger": round(contexte_froid, 4) if not en_cache and jetons else 0,
            "sortie": round(sortie * sortie_t / 1e6, 4),
            "duree": round(median(durees) if durees else sortie / DEBIT),
            "duree_mesuree": bool(durees),
            "differe": round(((jetons + entree) * entree_t + sortie * sortie_t) / 2e6, 4),
        }
    return {"disponible": disponible(), "repli_local": list(REPLI_LOCAL), "modele": MODELE, "usages": usages}


# ---------------------------------------------------------------- liens vers les vidéos

LIEN_VIDEO = re.compile(r"https?://(?:youtu\.be/|(?:www\.)?youtube\.com/watch\?v=)[A-Za-z0-9_-]{6,}[^\s)\]>\"']*")
_LIENS_CONNUS: set[str] | None = None
SOURCES_LIENS: Callable[[], list[Path]] = lambda: []


def regler_sources_liens(fournisseur: Callable[[], list[Path]]) -> None:
    global SOURCES_LIENS, _LIENS_CONNUS
    SOURCES_LIENS, _LIENS_CONNUS = fournisseur, None


def liens_connus() -> set[str]:
    global _LIENS_CONNUS
    if _LIENS_CONNUS is None:
        connus = set()
        for f in SOURCES_LIENS():
            try:
                connus.update(LIEN_VIDEO.findall(f.read_text(encoding="utf-8")))
            except OSError:
                continue
        _LIENS_CONNUS = connus
    return _LIENS_CONNUS


def verifier_liens(texte: str) -> str:
    """Un lien absent de la bible et des fiches d'épisode est retiré : seul son libellé reste, suivi d'une marque."""
    connus = liens_connus()

    def remplacer_md(m: re.Match) -> str:
        return m.group(0) if m.group(2) in connus else f"{m.group(1)} *(source à vérifier)*"

    texte = re.sub(r"\[([^\]]+)\]\((" + LIEN_VIDEO.pattern + r")\)", remplacer_md, texte)
    return LIEN_VIDEO.sub(lambda m: m.group(0) if m.group(0) in connus else "*(source à vérifier)*", texte)


# ---------------------------------------------------------------- appels

def _requete(fonction: str, systeme: list[dict], contenu, max_tokens: int, modele: str | None = None) -> dict:
    # Pas de format imposé (output_config.format) : chaque schéma différent invaliderait le contexte mis en cache
    # (mesuré : réécriture complète d'un usage à l'autre). Le schéma voyage dans la demande, le JSON est vérifié ici.
    # L'effort, lui, peut changer d'un usage à l'autre sans rompre le cache. modele : un autre que celui de l'atelier
    # (MODELE_JOUEURS pour l'aide à l'écriture) ; le repli d'un refus (fallbacks) reste celui que choisit le serveur.
    return {
        "model": modele or MODELE, "max_tokens": max_tokens, "system": systeme,
        "messages": [{"role": "user", "content": contenu}], "output_config": {"effort": EFFORTS.get(fonction, "medium")},
    }


def _texte(message) -> str:
    return "".join(b.text for b in message.content if getattr(b, "type", "") == "text").strip()


def _verifier_arret(message) -> None:
    if message.stop_reason == "refusal":
        raise Refusee("le modèle a refusé cette demande ; reformulez-la")
    if message.stop_reason not in ("end_turn", "max_tokens"):
        raise Indisponible(f"réponse interrompue ({message.stop_reason})")


async def rediger(fonction: str, systeme: list[dict], contenu, max_tokens: int = 16000, *, modele: str | None = None,
                  qui: str | None = None) -> str:
    if CLIENT is None:
        raise Indisponible("aucune clé d'API configurée")
    qui = pour_qui(qui)
    liberer = _reserver(fonction, qui, systeme, contenu, modele)
    try:
        debut = time.monotonic()
        try:
            message = await CLIENT.beta.messages.create(**_requete(fonction, systeme, contenu, max_tokens, modele),
                                                        betas=BETAS_REPLI, fallbacks="default")
        except anthropic.APIError as err:
            raise Indisponible(f"l'API ne répond pas ({err.__class__.__name__})") from err
        noter(fonction, message, debut=debut, qui=qui)
    finally:
        liberer()
    _verifier_arret(message)
    return _texte(message)


def extraire_json(texte: str):
    """L'objet JSON d'une réponse, même entouré d'un bloc de code ou d'une phrase."""
    t = texte.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    debut, fin = t.find("{"), t.rfind("}")
    if debut < 0 or fin < debut:
        raise ValueError("aucun objet JSON")
    return json.loads(t[debut:fin + 1])


def _avec_schema(contenu, schema: dict, rappel: str = ""):
    consigne = (f"{rappel}Réponds uniquement par un objet JSON valide, sans texte autour ni bloc de code, conforme à ce schéma "
                f"(toutes les clés présentes, chaînes en français) :\n{json.dumps(schema, ensure_ascii=False)}")
    if isinstance(contenu, list):
        return [*contenu, {"type": "text", "text": consigne}]
    return f"{contenu}\n\n{consigne}"


async def rediger_json(fonction: str, systeme: list[dict], contenu, schema: dict, max_tokens: int = 16000, *,
                       qui: str | None = None) -> dict:
    if CLIENT is None:
        raise Indisponible("aucune clé d'API configurée")
    qui = pour_qui(qui)
    rappel = ""
    for essai in range(2):
        demande = _avec_schema(contenu, schema, rappel)
        liberer = _reserver(fonction, qui, systeme, demande)
        try:
            debut = time.monotonic()
            try:
                message = await CLIENT.beta.messages.create(**_requete(fonction, systeme, demande, max_tokens),
                                                            betas=BETAS_REPLI, fallbacks="default")
            except anthropic.APIError as err:
                raise Indisponible(f"l'API ne répond pas ({err.__class__.__name__})") from err
            noter(fonction, message, debut=debut, qui=qui)
        finally:
            liberer()
        _verifier_arret(message)
        if message.stop_reason == "max_tokens":
            raise Indisponible("réponse trop longue, coupée : demandez moins d'éléments")
        try:
            donnees = extraire_json(_texte(message))
            if isinstance(donnees, dict):
                return donnees
        except ValueError:
            pass
        rappel = "Ta réponse précédente n'était pas un objet JSON valide. "
    raise Indisponible("réponse illisible")


# Le contrôle d'une image peinte : un regard rapide et bon marché suffit (quelques dixièmes de centime par image).
MODELE_REGARD = os.environ.get("CLAUDE_MODELE_REGARD", "claude-haiku-5-5")
# L'aide à l'écriture des joueurs (aide_mj.py) : rapide et deux fois moins chère que l'atelier, au fil de la plume.
MODELE_JOUEURS = os.environ.get("CLAUDE_MODELE_JOUEURS", "claude-sonnet-5-5")


async def juger_image(fonction: str, consigne: str, jpeg: bytes, demande: str, max_tokens: int = 2000, *,
                      qui: str | None = None) -> dict:
    """Le modèle regarde une image JPEG et répond par l'objet JSON que décrit la consigne. Pas de repli serveur : Haiku
    n'en a pas, et un contrôle manqué n'empêche rien (l'image est gardée sans verdict). qui : le MJ qui a commandé le
    portrait (le contrôle part de la file des illustrations, hors de sa requête)."""
    if CLIENT is None:
        raise Indisponible("aucune clé d'API configurée")
    qui = pour_qui(qui)
    systeme = [{"type": "text", "text": consigne}]
    contenu = [{"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                            "data": base64.standard_b64encode(jpeg).decode("ascii")}},
               {"type": "text", "text": demande}]
    liberer = _reserver(fonction, qui, systeme, contenu, MODELE_REGARD)
    try:
        debut = time.monotonic()
        try:
            message = await CLIENT.messages.create(
                model=MODELE_REGARD, max_tokens=max_tokens, system=systeme,
                messages=[{"role": "user", "content": contenu}],
                output_config={"effort": EFFORTS.get(fonction, "low")})
        except anthropic.APIError as err:
            raise Indisponible(f"l'API ne répond pas ({err.__class__.__name__})") from err
        noter(fonction, message, debut=debut, qui=qui)
    finally:
        liberer()
    _verifier_arret(message)
    try:
        donnees = extraire_json(_texte(message))
    except ValueError as err:
        raise Indisponible("réponse illisible") from err
    if not isinstance(donnees, dict):
        raise Indisponible("réponse illisible")
    return donnees


async def rediger_en_flux(fonction: str, systeme: list[dict], contenu, max_tokens: int = 32000, *,
                          qui: str | None = None) -> AsyncIterator[dict]:
    """Événements {"t": "texte", "d": morceau}, puis {"t": "fin", "texte": tout, "cout": dollars, "coupe": bool}.
    Une panne lève Indisponible, éventuellement après des morceaux déjà envoyés."""
    if CLIENT is None:
        raise Indisponible("aucune clé d'API configurée")
    qui = pour_qui(qui)
    liberer = _reserver(fonction, qui, systeme, contenu)
    try:
        debut = time.monotonic()
        try:
            async with CLIENT.beta.messages.stream(**_requete(fonction, systeme, contenu, max_tokens),
                                                   betas=BETAS_REPLI, fallbacks="default") as flux:
                async for morceau in flux.text_stream:
                    yield {"t": "texte", "d": morceau}
                message = await flux.get_final_message()
        except anthropic.APIError as err:
            raise Indisponible(f"l'API ne répond pas ({err.__class__.__name__})") from err
        dollars = noter(fonction, message, debut=debut, qui=qui)
    finally:
        liberer()
    _verifier_arret(message)
    yield {"t": "fin", "texte": _texte(message), "cout": dollars, "coupe": message.stop_reason == "max_tokens"}


# ---------------------------------------------------------------- lots différés (moitié prix)

LOTS: Path | None = None


def regler_lots(chemin: Path) -> None:
    global LOTS
    LOTS = chemin


def lots() -> list[dict]:
    if LOTS is None or not LOTS.exists():
        return []
    try:
        contenu = stockage.lire_json(LOTS)
    except ValueError:
        return []
    return contenu if isinstance(contenu, list) else []


def _ecrire_lots(liste: list[dict]) -> None:
    if LOTS is None:
        return
    stockage.ecrire_json(LOTS, liste, ensure_ascii=False)


def sans_cache(blocs: list[dict]) -> list[dict]:
    """Les blocs du contexte sans leur marque de cache. Un lot part seul : il ne relirait jamais ce qu'il écrit dans le cache,
    et l'écriture coûte deux fois l'entrée (cache d'une heure). Sans marque, la bible d'une relecture coûte 0,61 $ au lieu de 1,22 $."""
    return [{k: v for k, v in b.items() if k != "cache_control"} if isinstance(b, dict) else b for b in blocs]


# Ce que garde un lot pour le serveur seul (budget_mj.py) : le MJ qui l'a lancé et son prix minimal, engagé jusqu'à son relevé.
CHAMPS_INTERNES_DES_LOTS = ("qui", "plancher")


async def lancer_lot(fonction: str, cible: dict, systeme: list[dict], contenu, max_tokens: int = 32000, *,
                     qui: str | None = None) -> dict:
    """Une demande différée : traitée en général dans l'heure, à moitié prix. Le résultat est déposé par surveiller_lots.
    Le lot garde le MJ qui l'a lancé (son coût lui est noté au relevé) et son prix minimal (engagé sur son budget d'ici là)."""
    if CLIENT is None:
        raise Indisponible("aucune clé d'API configurée")
    qui = pour_qui(qui)
    ident = f"{fonction}-{secrets.token_hex(4)}"
    params = _requete(fonction, sans_cache(systeme), contenu, max_tokens)
    liberer = _reserver(fonction, qui, systeme, contenu, lot=True)
    try:
        try:
            # Le repli automatique n'existe pas pour les lots : un refus y reste un refus, signalé au MJ.
            lot = await CLIENT.messages.batches.create(requests=[{"custom_id": ident, "params": params}])
        except anthropic.APIError as err:
            raise Indisponible(f"l'API ne répond pas ({err.__class__.__name__})") from err
        entree = {"id": lot.id, "fonction": fonction, "cible": cible, "cree": datetime.now().isoformat(timespec="seconds"), "etat": "en-cours"}
        if qui:
            entree |= {"qui": qui, "plancher": plancher(systeme, contenu, lot=True)}
        _ecrire_lots([*lots(), entree])
    finally:
        liberer()
    return entree


LOT_PERDU_APRES = 3 * 86400  # secondes


async def relever_lots(deposer: Callable[[dict, str], None]) -> int:
    """Relève les lots terminés et dépose leur texte. Renvoie le nombre de lots encore en cours. Une réponse coupée
    (limite de jetons atteinte) arrive avec « coupe » dans la cible donnée à deposer, qui peut la refuser (DepotRefuse)."""
    if CLIENT is None:
        return 0
    liste = lots()
    change: dict[str, dict] = {}
    for entree in liste:
        if entree.get("etat") != "en-cours":
            continue
        try:
            lot = await CLIENT.messages.batches.retrieve(entree["id"])
            if lot.processing_status != "ended":
                continue
            resultat = None
            async for r in await CLIENT.messages.batches.results(entree["id"]):
                resultat = r.result
            if resultat is not None and resultat.type == "succeeded":
                message = resultat.message
                noter(entree["fonction"], message, lot=True, qui=entree.get("qui"))
                if message.stop_reason == "refusal":
                    entree["etat"], entree["erreur"] = "erreur", "refusé par le modèle"
                else:
                    coupe = {"coupe": True} if message.stop_reason == "max_tokens" else {}
                    try:
                        deposer({**entree["cible"], **coupe}, _texte(message))
                        entree["etat"] = "fait"
                    except DepotRefuse as refus:
                        entree["etat"], entree["erreur"] = "erreur", str(refus)
            else:
                entree["etat"], entree["erreur"] = "erreur", getattr(resultat, "type", "sans résultat")
            entree["fini"] = datetime.now().isoformat(timespec="seconds")
            change[entree["id"]] = entree
        except anthropic.APIError as err:
            # Un lot que l'API ne connaît plus, ou qui ne répond toujours pas trois jours après (un lot finit en un jour) :
            # il ne reviendra pas. Le laisser « en cours » le ferait redemander toutes les cinq minutes, sans fin.
            perdu = isinstance(err, anthropic.NotFoundError)
            if perdu or time.time() - datetime.fromisoformat(entree["cree"]).timestamp() > LOT_PERDU_APRES:
                entree["etat"], entree["erreur"] = "erreur", "lot introuvable" if perdu else "sans réponse de l'API"
                entree["fini"] = datetime.now().isoformat(timespec="seconds")
                change[entree["id"]] = entree
            continue
        except Exception as err:  # noqa: BLE001 : un dépôt raté ne doit pas arrêter la surveillance des autres lots
            entree["etat"], entree["erreur"] = "erreur", f"dépôt impossible ({err})"
            change[entree["id"]] = entree
    if change:
        # La liste est relue : un lot lancé pendant les attentes du relevé y est, et ne doit pas en ressortir. Les lots
        # finis depuis plus d'un mois sortent de la liste.
        liste = [change.get(e.get("id"), e) for e in lots()]
        limite = time.time() - 31 * 86400
        garder = [e for e in liste if e.get("etat") == "en-cours" or datetime.fromisoformat(e.get("fini") or e["cree"]).timestamp() > limite]
        _ecrire_lots(garder)
    else:
        liste = lots()
    return sum(1 for e in liste if e.get("etat") == "en-cours")


async def surveiller_lots(deposer: Callable[[dict, str], None], intervalle: int = 300) -> None:
    while True:
        try:
            await relever_lots(deposer)
        except Exception as err:  # noqa: BLE001
            print(f"Relevé des lots impossible : {err}", flush=True)
        await asyncio.sleep(intervalle)
