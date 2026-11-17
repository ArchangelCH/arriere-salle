#!/usr/bin/env python3
"""Regroupe les doublons de l'équipement des aventuriers : « Potion de soins ×2 » et « Potion de soins » sur deux lignes
deviennent « Potion de soins ×3 » sur la première.

Depuis les quantités du sac, ajouter un objet déjà là augmente sa ligne ; les sacs d'avant peuvent encore porter le
même objet sur plusieurs lignes. Cet outil les réunit, une fiche après l'autre :

- deux lignes du même nom (sans égard à la casse ni aux espaces) n'en font qu'une, à la place de la première et sous le nom
  qu'elle portait, avec la somme des quantités (« Corde x2 » compte pour deux) ;
- une ligne seule de son nom ne change pas, même écrite « Corde x2 » ;
- une ligne ambiguë (« Planche 2 x 4 », « Corde ×0 », « 2x Corde ×3 » : inventaire.douteuse) n'est jamais touchée ;
- un regroupement qui dépasserait 999 est laissé tel quel, et dit ;
- les trois objets personnels, l'or et le reste de la fiche ne bougent pas.

Il passe par l'atelier en marche (GET /api/aventuriers, puis la route du sac, PATCH /api/aventuriers/{id}/sac, avec la
liste d'avant : si le sac a changé entre-temps, l'atelier refuse et rien n'est écrit pour cette fiche). L'atelier garde
une version de chaque fiche changée (historique). La porte du réseau local reconnaît l'outil à l'en-tête X-Atelier-Outil
(data/mj/jeton-outils), lu à chaque appel, jamais affiché.

Usage, depuis le dossier de l'atelier :
    python3 outils/fusionner_sacs.py                      # essai à blanc : montre ce qui serait fait, n'écrit rien
    python3 outils/fusionner_sacs.py --heros vortan       # une seule fiche (identifiant, ou début du nom)
    python3 outils/fusionner_sacs.py --appliquer          # le fait

Variables : ATELIER (http://127.0.0.1:8323 par défaut), ATELIER_JETON_OUTILS (data/mj/jeton-outils par défaut).
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RACINE / "app"))

from commun import inventaire  # noqa: E402

ATELIER = os.environ.get("ATELIER", "http://127.0.0.1:8323")
JETON_OUTILS = Path(os.environ.get("ATELIER_JETON_OUTILS") or RACINE / "data" / "mj" / "jeton-outils")


def entetes() -> dict:
    sortie = {"Content-Type": "application/json"}
    try:
        jeton = JETON_OUTILS.read_text(encoding="ascii").strip()
    except (OSError, UnicodeDecodeError):
        jeton = ""
    if jeton:
        sortie["X-Atelier-Outil"] = jeton
    return sortie


def appel(methode: str, chemin: str, corps=None):
    donnees = json.dumps(corps).encode() if corps is not None else None
    requete = urllib.request.Request(ATELIER + chemin, data=donnees, method=methode, headers=entetes())
    try:
        with urllib.request.urlopen(requete, timeout=10) as r:
            return json.loads(r.read() or "null")
    except urllib.error.HTTPError as err:
        if err.code == 401:
            sys.exit(f"401 : l'atelier ne reconnaît pas cet outil (jeton des outils absent, illisible ou changé : {JETON_OUTILS})")
        raise


def regrouper(equipement: list) -> tuple[list, list]:
    """(la liste regroupée, les phrases de ce qui change ou de ce qui est laissé). Fonction pure : ne lit ni n'écrit rien."""
    lignes = [x if isinstance(x, str) else "" for x in equipement]
    groupes: dict[str, list] = {}
    for i, x in enumerate(lignes):
        if x.strip() and not inventaire.douteuse(x):
            groupes.setdefault(inventaire.cle_nom(inventaire.quantite_de(x)[0]), []).append(i)
    apres, retirees, phrases = list(lignes), set(), []
    for rangs in groupes.values():
        if len(rangs) < 2:
            continue
        nom = inventaire.quantite_de(lignes[rangs[0]])[0]
        total = sum(inventaire.quantite_de(lignes[i])[1] for i in rangs)
        reunies = " + ".join(f"« {lignes[i]} »" for i in rangs)
        neuve = inventaire.ligne(nom, total)
        if total > inventaire.QUANTITE_MAX or len(neuve) > inventaire.LIGNE_MAX:
            phrases.append(f"laissé : {reunies} (plus de {inventaire.QUANTITE_MAX}, ou ligne trop longue)")
            continue
        apres[rangs[0]] = neuve
        retirees.update(rangs[1:])
        phrases.append(f"{reunies} → « {neuve} »")
    douteuses = sorted({x for x in lignes if x.strip() and inventaire.douteuse(x) and lignes.count(x) > 1})
    phrases += [f"laissé : « {x} » en plusieurs lignes (quantité ambiguë, à regrouper à la main)" for x in douteuses]
    return [x for i, x in enumerate(apres) if i not in retirees], phrases


def choisies(fiches: list, heros: str) -> list:
    if not heros:
        return fiches
    vise = heros.strip().lower()
    return [f for f in fiches if f.get("id") == heros or str(f.get("nom") or "").lower().startswith(vise)]


def principal(arguments=None) -> int:
    lecteur = argparse.ArgumentParser(description="Regroupe les doublons de l'équipement des aventuriers (essai à blanc par défaut).")
    lecteur.add_argument("--heros", default="", help="une seule fiche : son identifiant, ou le début de son nom")
    lecteur.add_argument("--appliquer", action="store_true", help="écrit les regroupements (sinon rien n'est écrit)")
    options = lecteur.parse_args(arguments)
    fiches = [f for f in appel("GET", "/api/aventuriers") or [] if isinstance(f, dict) and isinstance(f.get("id"), str)]
    visees = choisies(fiches, options.heros)
    if options.heros and not visees:
        print(f"Aucun aventurier ne correspond à « {options.heros} ».")
        return 1
    changees = refusees = 0
    for f in visees:
        avant = [x if isinstance(x, str) else "" for x in f.get("equipement") or []] if isinstance(f.get("equipement"), list) else []
        apres, phrases = regrouper(avant)
        if not phrases:
            continue
        print(f"{f.get('nom') or f['id']} ({f['id']})")
        for phrase in phrases:
            print(f"  {phrase}")
        if apres == avant:
            continue
        changees += 1
        if options.appliquer:
            try:
                appel("PATCH", f"/api/aventuriers/{urllib.parse.quote(f['id'], safe='')}/sac", {"equipement": {"avant": avant, "apres": apres}})
                print("  écrit.")
            except urllib.error.HTTPError as err:
                refusees += 1
                print(f"  NON ÉCRIT ({err.code}) : le sac a changé entre-temps, ou l'atelier refuse. Relancez l'outil.")
    if not changees:
        print("Rien à regrouper.")
    elif options.appliquer:
        print(f"{changees - refusees} fiche(s) regroupée(s){f', {refusees} refusée(s)' if refusees else ''}.")
    else:
        print(f"Essai à blanc : {changees} fiche(s) à regrouper, rien n'est écrit. Relancez avec --appliquer.")
    return 1 if refusees else 0


if __name__ == "__main__":
    sys.exit(principal())
