"""Les scénarios : consignes, réponses, relectures, mises en page proposées."""

import re
import secrets
from collections import Counter

from fastapi import HTTPException, Request

from contenu import consignes

from api.application import app
from api import config, utilitaires, fiches_api
from api import tv_ecran  # noqa: F401  (chargé avant : routes_fiches y trouve ce qu'il appelle à l'import)


# Les scénarios du MJ, en chapitres : jamais envoyés à la TV. Les propositions faites pour leurs consignes et les
# relectures « au regard du canon » vivent à côté du texte et ne passent que par leurs routes : aucune ne réécrit le
# texte du MJ, c'est lui qui intègre une proposition s'il la garde. De même la mise en page proposée d'un chapitre (le
# texte corrigé et mis en page, à côté de celui du MJ) : il l'accepte, en entier ou bloc par bloc, ou la refuse.
fiches_api.routes_fiches("scenarios", config.SCENARIOS, "scenario", "scenario",
                         proteges={"reponses": [], "relectures": {}, "mises_en_page": {}}, archives=200)

STATUTS_CHOISIS = ("integree", "retiree", "ecartee")
PROPOSITION_MAX = 200_000


def consigne_lue(scenario: dict, c: dict) -> dict:
    chapitre = (scenario.get("chapitres") or [])[c["chapitre"]["numero"] - 1]
    avant, apres = consignes.contexte(chapitre.get("texte") or "", c["debut"], c["fin"])
    proposition = consignes.proposition_de(scenario, c)
    return {
        "ref": c["ref"], "genre": c["genre"], "libelle": consignes.GENRES[c["genre"]], "indications": c["indications"],
        "cle": c["cle"], "rang": c["rang"], "bloc": c["bloc"], "chapitre": c["chapitre"], "avant": avant, "apres": apres,
        "etat": "proposee" if proposition else "ouverte", "proposition": proposition,
    }


@app.get("/api/scenarios/{ident}/consignes")
def consignes_scenario(ident: str):
    """Chaque consigne du document avec ce qui l'entoure, et les propositions dont la consigne a changé ou disparu."""
    scenario = utilitaires.lire_fiche(utilitaires.existant(config.SCENARIOS, ident))
    lues = [consigne_lue(scenario, c) for c in consignes.consignes_du_scenario(scenario)]
    presentes = {(c["cle"], c["rang"]) for c in lues}
    orphelines = [r for r in scenario.get("reponses") or []
                  if r.get("statut") == "proposee" and (r.get("cle"), r.get("rang")) not in presentes]
    return {"consignes": lues, "orphelines": orphelines}


@app.post("/api/scenarios/{ident}/reponses")
async def proposer_reponse(ident: str, requete: Request):
    """Dépose la proposition faite pour une consigne (désignée par sa référence) ; la précédente est remplacée."""
    chemin = utilitaires.existant(config.SCENARIOS, ident)
    corps = await utilitaires.corps_objet(requete)
    contenu = utilitaires.texte(corps.get("texte")).strip()
    if not contenu:
        raise HTTPException(400, "Proposition vide")
    if len(contenu) > PROPOSITION_MAX:
        raise HTTPException(413, "Proposition trop longue")
    scenario = utilitaires.lire_fiche(chemin)
    c = next((c for c in consignes.consignes_du_scenario(scenario) if c["ref"] == corps.get("ref")), None)
    if not c:
        raise HTTPException(404, "Consigne introuvable : le texte a changé depuis")
    date = utilitaires.maintenant()
    reponses = scenario.get("reponses") or []
    for r in reponses:
        if r.get("cle") == c["cle"] and r.get("rang") == c["rang"] and r.get("statut") == "proposee":
            r["statut"], r["statut_date"] = "remplacee", date
    reponses.append({"id": secrets.token_hex(4), "cle": c["cle"], "rang": c["rang"], "genre": c["genre"],
                     "indications": c["indications"], "texte": contenu, "date": date, "statut": "proposee"})
    scenario["reponses"] = reponses
    scenario["modifie"] = date
    utilitaires.archiver(chemin, "scenarios", 200)
    utilitaires.ecrire(chemin, scenario)
    return scenario


@app.patch("/api/scenarios/{ident}/reponses/{rid}")
async def choisir_reponse(ident: str, rid: str, requete: Request):
    """Ce que le MJ fait d'une proposition : intégrée au texte, consigne retirée, ou écartée (la consigne reste)."""
    chemin = utilitaires.existant(config.SCENARIOS, ident)
    statut = (await utilitaires.corps_objet(requete)).get("statut")
    if statut not in STATUTS_CHOISIS:
        raise HTTPException(400, "Statut inconnu")
    scenario = utilitaires.lire_fiche(chemin)
    r = next((r for r in scenario.get("reponses") or [] if r.get("id") == rid), None)
    if not r:
        raise HTTPException(404, "Proposition introuvable")
    r["statut"], r["statut_date"] = statut, utilitaires.maintenant()
    # Comme pour les illustrations, la version de la fiche ne bouge pas : l'écran qui l'a ouverte peut continuer.
    utilitaires.ecrire(chemin, scenario)
    return scenario


def chapitre_relu(scenario: dict, chapitre: str) -> str:
    if chapitre != "ensemble" and chapitre not in [c.get("id") for c in scenario.get("chapitres") or []]:
        raise HTTPException(404, "Chapitre introuvable")
    return chapitre


@app.put("/api/scenarios/{ident}/relectures/{chapitre}")
async def deposer_relecture(ident: str, chapitre: str, requete: Request):
    """La relecture d'un chapitre (ou de l'ensemble, « ensemble ») au regard du canon et des idées."""
    chemin = utilitaires.existant(config.SCENARIOS, ident)
    contenu = utilitaires.texte((await utilitaires.corps_objet(requete)).get("texte")).strip()
    if not contenu:
        raise HTTPException(400, "Relecture vide")
    if len(contenu) > PROPOSITION_MAX:
        raise HTTPException(413, "Relecture trop longue")
    scenario = utilitaires.lire_fiche(chemin)
    date = utilitaires.maintenant()
    relectures = scenario.get("relectures") or {}
    relectures[chapitre_relu(scenario, chapitre)] = {"texte": contenu, "date": date}
    scenario["relectures"] = relectures
    scenario["modifie"] = date
    utilitaires.archiver(chemin, "scenarios", 200)
    utilitaires.ecrire(chemin, scenario)
    return scenario


@app.delete("/api/scenarios/{ident}/relectures/{chapitre}")
async def effacer_relecture(ident: str, chapitre: str):
    # Sur la boucle, comme toutes les écritures d'une fiche : dans un fil à part, un enregistrement de l'éditeur pouvait
    # passer entre la lecture et l'écriture, et le texte du MJ repartait à sa version d'avant.
    chemin = utilitaires.existant(config.SCENARIOS, ident)
    scenario = utilitaires.lire_fiche(chemin)
    relectures = scenario.get("relectures") or {}
    relectures.pop(chapitre, None)
    scenario["relectures"] = relectures
    utilitaires.ecrire(chemin, scenario)
    return scenario


# ---- La mise en page proposée d'un chapitre : le texte relu, corrigé et mis en page, déposé à côté de celui du MJ

ENSEMBLE = "ensemble"
CHAPITRE_MAX = 50_000  # caractères : au-delà, la réponse ne tiendrait pas d'un seul tenant
# La longueur de la proposition, de 70 % à 140 % de celle du chapitre. Vers le haut, un texte court garde une marge fixe
# (un intertitre ajouté à trois lignes les allonge de bien plus que 40 %) ; vers le bas, aucune : corriger ne raccourcit pas.
LONGUEUR_MIN, LONGUEUR_MAX, MARGE_COURTE = 0.7, 1.4, 80
CONSIGNE = re.compile(r"\[\[[\s\S]*?\]\]")
LIEN = re.compile(r"\[([^\]\n]+)\]\(([^)\s]+)\)")
LIEN_COURT = re.compile(r"@\[([^\[\]\n]+)\](?!\()")
# Comme js/scenarios/rendu.js : un « # » collé à un mot, hors d'une adresse (#/pnj/…) et d'un intertitre (« ## Titre »).
MOT_CLE = re.compile(r"(?:^|[^\w&/#])#([^\W_][\w'’-]*)", re.M)
BLOC_DE_CODE = re.compile(r"^```[\w-]*\n([\s\S]*?)\n```$")


class MiseEnPageRefusee(Exception):
    """La proposition ne passe pas les garde-fous : rien n'est déposé, le message dit pourquoi."""


def empreinte(texte: str) -> str:
    """L'empreinte d'un texte (sa longueur en octets et un FNV-1a de 32 bits), la même que js/scenarios/mise-en-page.js
    (tests/mise-en-page-cas.json) : l'éditeur sait ainsi si le chapitre a changé depuis la relecture, sans chiffrement
    du navigateur (indisponible en http sur le réseau local)."""
    octets = (texte or "").encode("utf-8", "replace")
    h = 0x811C9DC5
    for o in octets:
        h = ((h ^ o) * 0x01000193) & 0xFFFFFFFF
    return f"{len(octets)}-{h:08x}"


def chapitre_du(scenario: dict, chapitre: str) -> tuple[int, dict]:
    """(numéro, chapitre) ; 404 s'il n'existe pas."""
    for i, ch in enumerate(scenario.get("chapitres") or [], 1):
        if isinstance(ch, dict) and ch.get("id") == chapitre:
            return i, ch
    raise HTTPException(404, "Chapitre introuvable")


def sans_cadratin(texte: str) -> str:
    """Les tirets cadratins retirés, sauf dans une consigne (elle reste au caractère près)."""
    morceaux, pos = [], 0
    for m in CONSIGNE.finditer(texte):
        morceaux += [texte[pos:m.start()].replace(" — ", ", ").replace("—", ","), m.group(0)]
        pos = m.end()
    return "".join([*morceaux, texte[pos:].replace(" — ", ", ").replace("—", ",")])


def nettoyer_mise_en_page(contenu: str, source: str) -> str:
    """Ce qui a été rendu, prêt à comparer : sans bloc de code autour, sans tiret cadratin, avec les blancs de début et
    de fin du chapitre. Rien d'autre : ni liens vérifiés ni nom masqué, c'est le texte du MJ, dans son atelier."""
    corps = (contenu or "").replace("\r\n", "\n").strip()
    bloc = BLOC_DE_CODE.match(corps)
    if bloc and not source.lstrip().startswith("```"):
        corps = bloc.group(1).strip()
    corps = sans_cadratin(corps)
    if not corps:
        return ""
    return source[:len(source) - len(source.lstrip())] + corps + source[len(source.rstrip()):]


def reperes(texte: str) -> dict:
    """Ce qui doit se retrouver tel quel d'un texte à l'autre : consignes (dans l'ordre), adresses des liens, mots-clés
    et liens courts (comptés)."""
    hors = CONSIGNE.sub(" ", texte)
    return {"consignes": CONSIGNE.findall(texte), "liens": Counter(m.group(2) for m in LIEN.finditer(hors)),
            "mots": Counter(m.group(1).rstrip("'’-") for m in MOT_CLE.finditer(hors)),
            "courts": Counter(m.group(1) for m in LIEN_COURT.finditer(hors))}


def _ecart(nom_un: str, nom_plusieurs: str, avant: Counter, apres: Counter) -> list[str]:
    perdus, ajoutes = list((avant - apres).elements()), list((apres - avant).elements())
    dire = lambda liste: ", ".join(f"« {x} »" for x in liste[:3]) + ("…" if len(liste) > 3 else "")  # noqa: E731
    sortie = []
    if perdus:
        sortie.append(f"{nom_un if len(perdus) == 1 else nom_plusieurs} manquant{'s' if len(perdus) > 1 else ''} : {dire(perdus)}")
    if ajoutes:
        sortie.append(f"{nom_un if len(ajoutes) == 1 else nom_plusieurs} ajouté{'s' if len(ajoutes) > 1 else ''} : {dire(ajoutes)}")
    return sortie


def controler_mise_en_page(source: str, propose: str, coupe: bool = False) -> list[str]:
    """Les raisons de ne pas proposer ce texte (aucune : il peut l'être). La comparaison mot à mot reste au MJ ; ici, ce
    qu'une machine peut garantir : la réponse est entière, de longueur voisine, et les repères de l'atelier (consignes,
    liens, mots-clés, liens courts) y sont tous, sans un de plus."""
    if coupe:
        return ["la réponse a été coupée avant la fin du chapitre"]
    if not propose.strip():
        return ["la réponse est vide"]
    raisons = []
    n, m = len(source.strip()), len(propose.strip())
    if m < n * LONGUEUR_MIN:
        raisons.append(f"le texte rendu est bien plus court que le chapitre ({m} caractères pour {n})")
    elif m > max(n * LONGUEUR_MAX, n + MARGE_COURTE):
        raisons.append(f"le texte rendu est bien plus long que le chapitre ({m} caractères pour {n})")
    avant, apres = reperes(source), reperes(propose)
    if avant["consignes"] != apres["consignes"]:
        raisons.append("les consignes entre doubles crochets ne sont plus les mêmes, ou plus dans le même ordre")
    raisons += _ecart("lien", "liens", avant["liens"], apres["liens"])
    raisons += _ecart("mot-clé", "mots-clés", avant["mots"], apres["mots"])
    raisons += _ecart("lien court", "liens courts", avant["courts"], apres["courts"])
    return raisons


def proposer_mise_en_page(chemin, chapitre: str, contenu: str, base: str, coupe: bool = False) -> tuple[dict, bool]:
    """Dépose la mise en page proposée d'un chapitre, relu quand son texte avait l'empreinte `base`. Rend (scénario,
    déposée) : rien n'est déposé quand la relecture ne change rien (une proposition plus ancienne est alors retirée).
    Lève MiseEnPageRefusee quand un garde-fou s'y oppose, ou quand le chapitre a changé depuis la relecture. La version
    du scénario ne bouge pas : l'écran qui l'a ouvert peut continuer d'écrire et d'enregistrer."""
    scenario = utilitaires.lire_fiche(chemin)
    _, ch = chapitre_du(scenario, chapitre)
    source = utilitaires.texte(ch.get("texte"))
    if empreinte(source) != base:
        raise MiseEnPageRefusee("le chapitre a changé depuis la relecture : relancez-la")
    propose = nettoyer_mise_en_page(contenu, source)
    raisons = controler_mise_en_page(source, propose, coupe)
    if raisons:
        raise MiseEnPageRefusee("rien n'est proposé, " + " ; ".join(raisons))
    mises = scenario.get("mises_en_page") if isinstance(scenario.get("mises_en_page"), dict) else {}
    deposee = propose != source
    if deposee:
        mises[chapitre] = {"texte": propose, "base": base, "date": utilitaires.maintenant()}
    elif chapitre not in mises:
        return scenario, False
    else:
        mises.pop(chapitre)
    scenario["mises_en_page"] = mises
    utilitaires.ecrire(chemin, scenario)
    return scenario, deposee


@app.put("/api/scenarios/{ident}/mises-en-page/{chapitre}")
async def deposer_mise_en_page(ident: str, chapitre: str, requete: Request):
    """La mise en page proposée d'un chapitre, déposée de l'extérieur (l'outil du serveur) : mêmes garde-fous que celle
    de l'atelier. `base` : l'empreinte du texte relu, quand l'outil l'a ; sans elle, le chapitre tel qu'il est."""
    chemin = utilitaires.existant(config.SCENARIOS, ident)
    corps = await utilitaires.corps_objet(requete)
    contenu = utilitaires.texte(corps.get("texte"))
    if not contenu.strip():
        raise HTTPException(400, "Mise en page vide")
    if len(contenu) > PROPOSITION_MAX:
        raise HTTPException(413, "Mise en page trop longue")
    _, ch = chapitre_du(utilitaires.lire_fiche(chemin), chapitre)
    base = utilitaires.texte(corps.get("base")) or empreinte(utilitaires.texte(ch.get("texte")))
    try:
        scenario, _ = proposer_mise_en_page(chemin, chapitre, contenu, base)
    except MiseEnPageRefusee as refus:
        raise HTTPException(422, f"Mise en page refusée : {refus}")
    return scenario


@app.delete("/api/scenarios/{ident}/mises-en-page/{chapitre}")
async def effacer_mise_en_page(ident: str, chapitre: str):
    """Refusée, ou acceptée et intégrée par le MJ : la proposition quitte le scénario (« ensemble » : toutes). Sur la
    boucle, comme toute écriture d'une fiche, et sans changer sa version."""
    chemin = utilitaires.existant(config.SCENARIOS, ident)
    scenario = utilitaires.lire_fiche(chemin)
    mises = scenario.get("mises_en_page") if isinstance(scenario.get("mises_en_page"), dict) else {}
    if chapitre == ENSEMBLE:
        mises = {}
    else:
        mises.pop(chapitre, None)
    scenario["mises_en_page"] = mises
    utilitaires.ecrire(chemin, scenario)
    return scenario
