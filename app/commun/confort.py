"""Le confort de la table : les lignes (ce qui n'arrive jamais en jeu) et les voiles (ce qui reste hors champ) de chaque
joueur, notées dans son carnet entre deux séances, et celles que le MJ a convenues à voix haute avec la tablée.

Le coin des joueurs écrit les limites d'un joueur dans propositions/limites/<id du joueur>.json, et seulement les
siennes (son cookie). L'atelier les lit toutes, mais ne les rend au MJ que rassemblées, sans le nom de qui les a notées,
sauf pour le joueur qui l'a accepté (« nommer »). Rien de tout cela ne va au carnet publié, à la TV ni à la table
publique : les routes de l'atelier sont hors de /api/table/ (fermées à Internet par la garde de main.py), celles du coin
ne lisent que le fichier du joueur connecté.

Ce module ne lit rien de l'atelier : main.py et joueurs.py l'importent tous deux, les bornes sont donc les mêmes."""
import re
import unicodedata
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from commun import nom_campagne
from commun import stockage

DOSSIER = "limites"
# Les clés des thèmes à cocher, dans l'ordre du carnet : les mêmes que static/js/confort/themes.js.
THEMES = ("araignees", "serpents", "insectes", "noyade", "torture", "enfants", "violences-sexuelles", "sexe", "gore", "suicide",
          "esclavage", "brules-vifs")
NIVEAUX = ("voile", "ligne")
LIBRE_MAX = 80  # signes d'une limite écrite avec ses mots
LIBRES_MAX = 8  # limites écrites par liste
OCTETS_MAX = 8 * 1024  # une requête de limites : au-delà, refusée avant d'être lue
FICHIER_MAX = 16 * 1024  # un fichier plus lourd n'est pas lu
ID_JOUEUR = re.compile(r"^[a-z0-9-]{1,60}$")
# Sous ce nombre de joueurs qui ont répondu sans leur nom, leur compte n'est pas donné au MJ : avec un seul, tout ce qui
# n'a pas de nom serait à lui ; avec deux, le MJ n'aurait que deux joueurs à soupçonner.
SEUIL_ANONYMES = 3


def maintenant() -> str:
    return datetime.now().isoformat(timespec="milliseconds")


def vides(joueur: bool = True) -> dict:
    return {"themes": {}, "lignes": [], "voiles": [], **({"nommer": False} if joueur else {})}


def propre(texte: str) -> str:
    """Une limite écrite à la main, sur une ligne : ni caractère de contrôle ni invisible, les espaces resserrés."""
    return " ".join("".join(c for c in texte if unicodedata.category(c)[0] != "C" or c in " \t\n").split())


def forme(texte: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texte.casefold()) if not unicodedata.combining(c))


def limites(corps, joueur: bool = True, strict: bool = True) -> dict:
    """Les limites telles qu'elles s'enregistrent. strict : un champ inconnu, un type faux, une limite trop longue ou trop
    nombreuse lèvent ValueError, et rien n'est écrit ; sinon (un fichier relu), ce qui ne va pas est laissé de côté."""
    def refus(message: str):
        if strict:
            raise ValueError(message)

    if not isinstance(corps, dict):
        if strict:
            raise ValueError("Limites illisibles.")
        corps = {}
    permis = {"themes", "lignes", "voiles", "modifie"} | ({"nommer"} if joueur else set())
    inconnus = sorted(k for k in corps if k not in permis)
    if inconnus:
        refus(f"Champ inconnu : {', '.join(map(str, inconnus))}.")
    themes = corps.get("themes", {})
    if not isinstance(themes, dict):
        refus("Thèmes illisibles.")
        themes = {}
    for cle, niveau in themes.items():
        if cle not in THEMES:
            refus("Thème inconnu.")
        elif niveau not in NIVEAUX and niveau not in (None, ""):
            refus("Ligne ou voile, rien d'autre.")
    sortie = vides(joueur)
    sortie["themes"] = {cle: themes[cle] for cle in THEMES if themes.get(cle) in NIVEAUX}
    vus = set()
    for liste in ("lignes", "voiles"):
        valeurs = corps.get(liste, [])
        if not isinstance(valeurs, list):
            refus("Une liste de limites est attendue.")
            valeurs = []
        if len(valeurs) > LIBRES_MAX:
            refus(f"{LIBRES_MAX} limites au plus par liste.")
        for v in valeurs[:LIBRES_MAX * 4]:
            if not isinstance(v, str):
                refus("Une limite s'écrit en toutes lettres.")
                continue
            texte = propre(v)
            if len(texte) > LIBRE_MAX:
                refus(f"Une limite tient en {LIBRE_MAX} signes au plus.")
                continue
            # Écrite deux fois, ou dans les deux listes : la première l'emporte, les lignes passent avant les voiles.
            if texte and forme(texte) not in vus:
                vus.add(forme(texte))
                sortie[liste].append(texte)
        sortie[liste] = sortie[liste][:LIBRES_MAX]
    if joueur:
        nommer = corps.get("nommer", False)
        if not isinstance(nommer, bool):
            refus("La case du nom : oui ou non.")
        sortie["nommer"] = nommer is True
    return sortie


def a_des_limites(lim: dict) -> bool:
    return bool(lim.get("themes") or lim.get("lignes") or lim.get("voiles"))


def fichier(depot: Path, joueur: str) -> Path:
    if not isinstance(joueur, str) or not ID_JOUEUR.match(joueur):
        raise ValueError("Accès invalide")
    return depot / DOSSIER / f"{joueur}.json"


def lire(depot: Path, joueur: str) -> dict:
    """Les limites d'un joueur, relues et retypées ; vides s'il n'en a pas noté."""
    chemin = fichier(depot, joueur)
    try:
        if chemin.stat().st_size > FICHIER_MAX:
            return vides()
        brut = stockage.lire_json(chemin)
    except (OSError, ValueError):
        return vides()
    lim = limites(brut, strict=False)
    if isinstance(brut, dict) and isinstance(brut.get("modifie"), str):
        lim["modifie"] = brut["modifie"][:40]
    return lim


def ecrire(depot: Path, joueur: str, lim: dict) -> dict:
    """Écrit les limites d'un joueur (déjà vérifiées) ; sans aucune limite ni case cochée, le fichier s'en va."""
    chemin = fichier(depot, joueur)
    if not a_des_limites(lim) and not lim.get("nommer"):
        chemin.unlink(missing_ok=True)
        return vides()
    chemin.parent.mkdir(parents=True, exist_ok=True)
    contenu = {**lim, "modifie": maintenant()}
    stockage.ecrire_json_compact(chemin, contenu)
    return contenu


def oublier(depot: Path, joueur: str) -> None:
    """Un joueur retiré emporte ses limites : effacées, pas mises à la corbeille (elles y porteraient son identifiant)."""
    try:
        fichier(depot, joueur).unlink(missing_ok=True)
    except ValueError:
        pass


def tablee(des_joueurs: list, du_mj: dict) -> dict:
    """Les limites de la tablée rassemblées pour le MJ : chaque thème ou limite écrite une seule fois, en ligne si
    quelqu'un en a fait une ligne, sinon en voile. Un nom ne paraît que pour le joueur qui l'a accepté ; l'ordre (celui du
    carnet pour les thèmes, l'alphabet pour le reste) ne dit rien de qui a noté quoi. des_joueurs : [(prénom, limites)]."""
    themes, libres = {}, {}
    reponses = nommes = 0

    def noter(table: dict, cle: str, niveau: str, nom: str, mj: bool, texte: str = ""):
        x = table.setdefault(cle, {"niveau": niveau, "noms": set(), "mj": False, "texte": texte})
        if niveau == "ligne":
            x["niveau"] = "ligne"
        if nom:
            x["noms"].add(nom)
        x["mj"] = x["mj"] or mj
        # Deux graphies d'une même limite : la plus petite, pas celle du premier joueur de la liste.
        if texte and texte < x["texte"]:
            x["texte"] = texte

    sources = [(nom, limites(lim, strict=False), False) for nom, lim in des_joueurs]
    sources.append(("", limites(du_mj, joueur=False, strict=False), True))
    for nom, lim, mj in sources:
        if not a_des_limites(lim):
            continue
        signe = " ".join(str(nom or "").split())[:60] if not mj and lim.get("nommer") is True else ""
        if not mj:
            reponses += 1
            nommes += bool(signe)
        for cle, niveau in lim["themes"].items():
            noter(themes, cle, niveau, signe, mj)
        for niveau, liste in (("ligne", "lignes"), ("voile", "voiles")):
            for texte in lim[liste]:
                noter(libres, forme(texte), niveau, signe, mj, texte)

    def item(x: dict, **cle) -> dict:
        return {**cle, "noms": sorted(x["noms"], key=forme), "mj": x["mj"]}

    # reponses : None quand peu de joueurs ont répondu sans leur nom (SEUIL_ANONYMES), le nombre resterait une signature.
    anonymes = reponses - nommes
    sortie = {"lignes": [], "voiles": [], "reponses": None if 0 < anonymes < SEUIL_ANONYMES else reponses, "nommes": nommes}
    for cle in THEMES:
        if cle in themes:
            sortie[themes[cle]["niveau"] + "s"].append(item(themes[cle], cle=cle))
    for f in sorted(libres):
        sortie[libres[f]["niveau"] + "s"].append(item(libres[f], texte=libres[f]["texte"]))
    return sortie


def routes(depot: Path, du_mj: Path, page: Path, *, joueurs_lus, corps_objet, lire_json, ecrire_json) -> APIRouter:
    """Les routes de l'atelier : le confort de la table pour le MJ (lecture rassemblée, ses propres limites) et la carte
    X à imprimer. Aucune n'est sous /api/table/ : la garde les ferme à la table publique."""
    r = APIRouter()

    def les_siennes() -> dict:
        try:
            return limites(lire_json(du_mj), joueur=False, strict=False)
        except (OSError, ValueError):
            return vides(joueur=False)

    def vue() -> dict:
        joueurs = [j for j in joueurs_lus() if isinstance(j, dict) and isinstance(j.get("id"), str) and ID_JOUEUR.match(j["id"])]
        mj = les_siennes()
        return tablee([(j.get("nom"), lire(depot, j["id"])) for j in joueurs], mj) | {"invites": len(joueurs), "mj": mj}

    @r.get("/api/confort")
    def lire_confort():
        return vue()

    @r.put("/api/confort")
    async def noter_les_siennes(requete: Request):
        try:
            lim = limites(await corps_objet(requete), joueur=False)
        except ValueError as err:
            raise HTTPException(400, str(err))
        ecrire_json(du_mj, {**lim, "modifie": maintenant()})
        return vue()

    @r.get("/carte-x")
    def carte_x():
        return HTMLResponse(nom_campagne.nommer(page.read_text(encoding="utf-8")), headers={"Cache-Control": "no-cache"})

    return r
