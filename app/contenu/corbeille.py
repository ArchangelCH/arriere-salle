"""La corbeille et les versions : remettre ce qui a été jeté ou remplacé. Une fiche supprimée dort dans
corbeille/<collection>/<id>-<AAAAMMJJ-HHMMSS>.json ; chaque version remplacée d'une fiche, dans
historique/<collection>/<id>/<AAAAMMJJ-HHMMSS>.json (main.py les y range). Ces routes les relisent, les remettent en
place et ramènent une ligne retirée du journal d'une séance. Aucune ne sert la TV : sous /api/ hors de /api/table/,
la garde de main.py les ferme à la table publique, et le coin des joueurs ne les a pas.

Deuxième accès MJ (cloisonnement.py) : chaque MJ ne voit, ne remet et ne relit que ses fiches (« auteur » de la fiche
jetée, en place ou gardée). Les collections sans auteur (la tablée, les règles maison) restent au compte principal : leurs
versions portent les secrets des héros."""

import re
import shutil
from contextlib import nullcontext
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from mj import cloisonnement
from mj import proprietes
from contenu.liens_fiches import pris_par_un_renommage, suites_du_renommage

ID = re.compile(r"^[a-z0-9-]{1,60}$")
DATE = re.compile(r"^\d{8}-\d{6}$")
JETEE = re.compile(r"^([a-z0-9-]{1,60})-(\d{8}-\d{6})$")
# Tenus par le serveur ou par leurs propres routes : revenir à une version ne les touche pas (comme un enregistrement).
# L'auteur d'une fiche (proprietes.py) ne bouge jamais.
GARDES = ("id", "cree", "illustrations", "illustration", "auteur")
INTITULE_MAX = 90


def date_iso(estampille: str) -> str:
    return datetime.strptime(estampille, "%Y%m%d-%H%M%S").isoformat()


def place_jetee(dossier: Path, ident: str) -> Path:
    """Où dort une fiche qu'on jette : <id>-<AAAAMMJJ-HHMMSS>.json, jamais par-dessus une fiche du même identifiant
    jetée à la même seconde (celle-ci prend la seconde suivante) : les deux restent dans la corbeille."""
    instant = datetime.now()
    cible = dossier / f"{ident}-{instant:%Y%m%d-%H%M%S}.json"
    while cible.exists():
        instant += timedelta(seconds=1)
        cible = dossier / f"{ident}-{instant:%Y%m%d-%H%M%S}.json"
    return cible


def intitule(collection: str, fiche: dict) -> str:
    """Le nom sous lequel le MJ reconnaît la fiche : son nom, le titre d'une règle, le début d'une rumeur…"""
    def propre(v) -> str:
        return " ".join(str(v or "").split())
    if collection == "seances":
        numero = fiche.get("numero")
        nom = " · ".join(x for x in (f"Séance {numero}" if numero not in (None, "") else "Séance", propre(fiche.get("nom"))) if x)
    else:
        nom = propre(fiche.get("nom")) or propre(fiche.get("titre")) or propre(fiche.get("texte"))
    if len(nom) > INTITULE_MAX:
        nom = nom[: INTITULE_MAX - 1].rstrip() + "…"
    return nom


def detail(collection: str, fiche: dict) -> str:
    """Une précision pour départager deux fiches au nom voisin : rôle, genre de lieu, joueur, date de séance…"""
    for cle in {"pnj": ("role",), "lieux": ("type",), "aventuriers": ("joueur",), "seances": ("date",), "plans": ("etage",),
                "boutiques": ("accroche",), "contrats": ("recompense",), "rumeurs": ("source",), "fils": ("faction",),
                "regles-maison": ("texte",), "documents": ("signature", "texte")}.get(collection, ()):
        v = " ".join(str(fiche.get(cle) or "").split())
        if v:
            return v[:INTITULE_MAX - 1] + "…" if len(v) > INTITULE_MAX else v
    return ""


def a_lui(nom: str, fiche) -> bool:
    """La fiche (jetée, en place ou gardée) est-elle au MJ qui lit ? Une collection sans auteur : au principal seul."""
    if proprietes.a_auteur(nom):
        return cloisonnement.permis(nom, fiche)
    return not cloisonnement.est_invite() or not cloisonnement.refuse("corbeille-commune", nom)


def routes(collections: dict, corbeille: Path, historique: Path, seances: Path, *, lire, ecrire, maintenant,
           nouvel_id, corps_objet, verrou=None) -> APIRouter:
    """collections : { "pnj": (dossier, champs protégés, apres), … }, où apres (ou None) republie ce qui dépend de la
    collection une fois une fiche remise ; seances : le dossier des séances (journal). lire, ecrire, maintenant,
    nouvel_id, corps_objet : ceux de main.py. verrou(nom) : celui que prennent les autres écritures de la collection
    (SAC_VERROU des fiches illustrées, celui du rejeu des plans), tenu de la lecture à l'écriture ; sans, aucun."""
    r = APIRouter()

    def verrou_de(nom: str):
        return verrou(nom) if verrou else nullcontext()

    def collection(nom: str) -> tuple:
        if nom not in collections:
            raise HTTPException(404, "Collection inconnue")
        return collections[nom]

    def identifiant(ident: str) -> str:
        if not ID.match(ident):
            raise HTTPException(400, "Identifiant invalide")
        return ident

    def lire_ou_rien(chemin: Path):
        try:
            fiche = lire(chemin)
        except (OSError, ValueError):
            return None
        return fiche if isinstance(fiche, dict) else None

    def jetees(nom: str):
        """[(id, estampille, chemin)] de la corbeille d'une collection, sans les fichiers qui n'y ont pas leur place."""
        dossier = corbeille / nom
        if not dossier.is_dir():
            return []
        sortie = []
        for f in dossier.glob("*.json"):
            m = JETEE.match(f.stem)
            if m:
                sortie.append((m[1], m[2], f))
        return sortie

    def garder_version(nom: str, chemin: Path) -> str:
        """La version en place part dans l'historique, sans attendre les cinq minutes d'un enregistrement ordinaire ;
        jamais par-dessus une version déjà gardée à la même seconde. Rend son estampille."""
        dossier = historique / nom / chemin.stem
        dossier.mkdir(parents=True, exist_ok=True)
        instant = datetime.now()
        cible = dossier / f"{instant:%Y%m%d-%H%M%S}.json"
        while cible.exists():
            instant += timedelta(seconds=1)
            cible = dossier / f"{instant:%Y%m%d-%H%M%S}.json"
        shutil.copyfile(chemin, cible)
        return cible.stem

    @r.get("/api/corbeille")
    def lire_corbeille():
        """Tout ce qui dort dans la corbeille, du plus récent au plus ancien, avec ce qui occupe sa place aujourd'hui."""
        elements = []
        for nom, (dossier, _, _) in collections.items():
            for ident, estampille, chemin in jetees(nom):
                fiche = lire_ou_rien(chemin)
                if fiche is None or not a_lui(nom, fiche):
                    continue
                actuelle = lire_ou_rien(dossier / f"{ident}.json") if (dossier / f"{ident}.json").exists() else None
                # La fiche qui a repris sa place, si elle est à l'autre MJ : son nom ne sort pas.
                if actuelle is not None and not a_lui(nom, actuelle):
                    actuelle = {}
                elements.append({
                    "collection": nom, "fichier": chemin.stem, "id": ident, "jete": date_iso(estampille),
                    "nom": intitule(nom, fiche), "detail": detail(nom, fiche),
                    "repris": (dossier / f"{ident}.json").exists() or pris_par_un_renommage(dossier, ident),
                    "repris_par": intitule(nom, actuelle) if actuelle else "",
                })
        elements.sort(key=lambda x: x["jete"], reverse=True)
        return {"elements": elements}

    def remettre_fichier(nom: str, chemin: Path, a_cote: bool) -> dict:
        with verrou_de(nom):
            sortie = remettre_sous_verrou(nom, chemin, a_cote)
        apres = collection(nom)[2]
        if apres:
            apres()
        return sortie

    def remettre_sous_verrou(nom: str, chemin: Path, a_cote: bool) -> dict:
        dossier = collection(nom)[0]
        fiche = lire_ou_rien(chemin)
        if fiche is None:
            raise HTTPException(500, f"Fichier illisible : {chemin.name}")
        if not a_lui(nom, fiche):
            raise HTTPException(404, "Plus dans la corbeille")
        ident = JETEE.match(chemin.stem)[1]
        place = dossier / f"{ident}.json"
        # Un identifiant qu'une autre fiche a porté avant d'être renommée (liens_fiches.py) : un écran resté dessus la
        # suit encore. La fiche jetée revient donc à côté.
        if place.exists() or pris_par_un_renommage(dossier, ident):
            if not a_cote:
                raise HTTPException(409, "Une autre fiche porte déjà cet identifiant : elle peut revenir à côté, sous un "
                                         "nouvel identifiant.")
            ident = nouvel_id(dossier, intitule(nom, fiche) or ident)
            fiche["id"] = ident
            # Une fiche neuve, mais celle de son auteur : la remise ne la donne pas à qui la remet.
            if proprietes.a_auteur(nom):
                fiche["auteur"] = proprietes.auteur_de(fiche)
            ecrire(dossier / f"{ident}.json", fiche)
            chemin.unlink(missing_ok=True)
        else:
            # Telle qu'elle a été jetée, à la lettre : même identifiant, même version.
            dossier.mkdir(parents=True, exist_ok=True)
            chemin.replace(place)
        return {"collection": nom, "id": ident, "nom": intitule(nom, fiche), "a_cote": ident != JETEE.match(chemin.stem)[1]}

    @r.post("/api/corbeille/{nom}/{fichier}/remettre")
    async def remettre(nom: str, fichier: str, requete: Request):
        """Remet une fiche de la corbeille à sa place ; « a_cote » la remet sous un nouvel identifiant quand le sien
        est repris entre-temps."""
        collection(nom)
        a_cote = False
        if requete.headers.get("content-type", "").startswith("application/json"):
            a_cote = bool((await corps_objet(requete)).get("a_cote"))
        if not JETEE.match(fichier):
            raise HTTPException(400, "Fichier invalide")
        chemin = corbeille / nom / f"{fichier}.json"
        if not chemin.is_file():
            raise HTTPException(404, "Plus dans la corbeille")
        return remettre_fichier(nom, chemin, a_cote)

    @r.post("/api/corbeille/{nom}/{ident}/annuler")
    def annuler(nom: str, ident: str):
        """« Annuler » juste après une mise à la corbeille : la dernière fiche jetée sous cet identifiant revient."""
        dossier = collection(nom)[0]
        identifiant(ident)
        # Jetée depuis un écran resté sur un ancien identifiant (liens_fiches.py) : elle dort sous celui qu'elle portait.
        siens = {ident, *suites_du_renommage(dossier, ident)}
        candidates = sorted((e, c) for i, e, c in jetees(nom) if i in siens and a_lui(nom, lire_ou_rien(c) or {}))
        if not candidates:
            raise HTTPException(404, "Plus dans la corbeille")
        return remettre_fichier(nom, candidates[-1][1], False)

    @r.get("/api/versions/{nom}/{ident}")
    def versions(nom: str, ident: str):
        """Les versions gardées d'une fiche, de la plus récente à la plus ancienne, avec le nom qu'elle portait."""
        dossier, _, _ = collection(nom)
        identifiant(ident)
        actuelle = lire_ou_rien(dossier / f"{ident}.json")
        if actuelle is None or not a_lui(nom, actuelle):
            raise HTTPException(404, "Introuvable")
        sortie = []
        for f in sorted((historique / nom / ident).glob("*.json"), reverse=True) if (historique / nom / ident).is_dir() else []:
            if not DATE.match(f.stem):
                continue
            fiche = lire_ou_rien(f)
            if fiche is None:
                continue
            sortie.append({"version": f.stem, "date": date_iso(f.stem), "nom": intitule(nom, fiche),
                           "modifie": fiche.get("modifie"), "taille": f.stat().st_size})
        return {"collection": nom, "id": ident, "nom": intitule(nom, actuelle), "modifie": actuelle.get("modifie"),
                "versions": sortie}

    def version(nom: str, ident: str, estampille: str) -> tuple:
        dossier, proteges, _ = collection(nom)
        identifiant(ident)
        if not DATE.match(estampille):
            raise HTTPException(400, "Version invalide")
        chemin = historique / nom / ident / f"{estampille}.json"
        fiche = lire_ou_rien(chemin) if chemin.is_file() else None
        # Une version, et la fiche en place s'il y en a une, au MJ qui lit ; sinon, comme une version qui n'existe pas.
        actuelle = lire_ou_rien(dossier / f"{ident}.json")
        if fiche is None or not a_lui(nom, fiche) or (actuelle is not None and not a_lui(nom, actuelle)):
            raise HTTPException(404, "Cette version n'est plus gardée")
        return dossier, proteges, fiche

    @r.get("/api/versions/{nom}/{ident}/{estampille}")
    def lire_version(nom: str, ident: str, estampille: str):
        return version(nom, ident, estampille)[2]

    @r.post("/api/versions/{nom}/{ident}/{estampille}/remettre")
    async def revenir(nom: str, ident: str, estampille: str):
        """Revient à une version : celle en place part d'abord dans l'historique (« gardee », pour revenir en arrière),
        rien ne se perd. Comme un enregistrement, les illustrations et les champs tenus par leurs propres routes
        (journal, combat…) restent."""
        dossier, proteges, ancienne = version(nom, ident, estampille)
        chemin = dossier / f"{ident}.json"
        # Sous le verrou des autres écritures de la fiche : un portrait accepté depuis la boîte (un fil) ne passe pas entre
        # la lecture des champs gardés et l'écriture.
        with verrou_de(nom):
            actuelle = lire_ou_rien(chemin)
            if actuelle is None:
                raise HTTPException(404, "Introuvable")
            fiche = {k: v for k, v in ancienne.items() if k not in GARDES and k not in proteges}
            for cle in (*GARDES, *proteges):
                if cle in actuelle:
                    fiche[cle] = actuelle[cle]
            fiche["id"] = ident
            fiche["modifie"] = maintenant()
            gardee = garder_version(nom, chemin)
            ecrire(chemin, fiche)
        apres = collection(nom)[2]
        if apres:
            apres()
        return {"fiche": fiche, "gardee": gardee}

    @r.post("/api/seances/{ident}/journal/remettre")
    async def remettre_ligne(ident: str, requete: Request):
        """Remet une ligne retirée du journal à sa place, avec son heure : juste après la ligne qui la précédait
        (« apres »), sinon à son rang. Déjà revenue (même identifiant) : rien ne change. En async, sans attente entre la
        lecture et l'écriture, comme les autres routes du journal."""
        identifiant(ident)
        corps = await corps_objet(requete)
        chemin = seances / f"{ident}.json"
        seance = lire_ou_rien(chemin) if chemin.is_file() else None
        if seance is None or not a_lui("seances", seance):
            raise HTTPException(404, "Introuvable")
        ligne = corps.get("ligne")
        if not isinstance(ligne, dict) or not isinstance(ligne.get("texte"), str) or not ligne["texte"].strip():
            raise HTTPException(400, "Ligne attendue")
        ligne = {k: v for k, v in ligne.items() if isinstance(k, str) and isinstance(v, (str, int, float, bool)) and len(str(v)) <= 2000}
        lignes = seance.get("journal") if isinstance(seance.get("journal"), list) else []
        if ligne.get("id") and any(isinstance(j, dict) and j.get("id") == ligne["id"] for j in lignes):
            return seance
        apres = corps.get("apres")
        rang = next((i + 1 for i, j in enumerate(lignes) if apres and isinstance(j, dict) and j.get("id") == apres), None)
        if rang is None:
            voulu = corps.get("rang")
            rang = voulu if isinstance(voulu, int) and not isinstance(voulu, bool) and 0 <= voulu <= len(lignes) else len(lignes)
        lignes.insert(rang, ligne)
        seance["journal"] = lignes
        ecrire(chemin, seance)
        return seance

    return r
