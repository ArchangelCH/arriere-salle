"""Les liens vers une fiche de PNJ ou de lieu, vus depuis la fiche : les passages des scénarios qui la citent (« Dans les
scénarios »), et son identifiant, qui suit son nom tant que rien ne la cite. Les scénarios se lisent tels quels : rien
n'est réécrit. Un lien s'écrit en entier dans le fichier ([Nom](#/pnj/id)), ou court (@[Nom]) quand l'atelier n'a pas
encore trouvé la fiche : il se résout alors par le nom, comme dans l'éditeur (js/scenarios/liens-courts.js).
Ces routes ne servent que l'atelier : sous /api/ hors de /api/table/, la garde de main.py les ferme à la table publique,
et le coin des joueurs ne les a pas.

Un renommage est gardé (renommages.json : ancien identifiant vers nouveau, par collection) : un écran resté sur l'ancien
identifiant lit et enregistre toujours la bonne fiche (SuiviDesRenommages réécrit l'adresse), un lien écrit depuis une
liste pas encore relue y mène encore, et aucune nouvelle fiche ne reprend un identifiant qui a servi."""

import json
import re
import secrets
import shutil
import unicodedata
from pathlib import Path
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException, Request

from mj import cloisonnement
from mj import proprietes
from commun import stockage

LIEN = re.compile(r"\[([^\]\n]+)\]\(([^)\s]+)\)")
COURT = re.compile(r"@\[([^[\]\n]+)\](?!\()")
EXTRAIT_MAX = 170
# Là où une fiche n'est jamais citée : les images, les fonds peints, le coin des joueurs, la trace des renommages. Les
# versions gardées et la corbeille comptent : une version qu'on remet, une fiche qu'on ressort ramèneraient un lien vers
# l'ancien identifiant.
RENOMMAGES = "renommages.json"
HORS_CITATIONS = ("images", "fonds-peints", "propositions", RENOMMAGES)
ID_CARTE = re.compile(r"^[a-z0-9-]{1,80}$")
ID_FICHE = re.compile(r"^[a-z0-9-]{1,60}$")  # comme ID_VALIDE de main.py
GENRES = {"pnj": "pnj", "lieux": "lieu"}
ORDRE = ("pnj", "lieu", "plan", "rencontre", "carte")
# Les adresses qui désignent une fiche de PNJ ou de lieu par son identifiant : la fiche et ses routes, « Dans les
# scénarios », « Versions précédentes ».
ADRESSE_FICHE = re.compile(r"^/api/(?:mentions/|versions/)?(pnj|lieux)/([^/]+)(/.*)?$")


class Renommages:
    """La trace des renommages d'identifiant : {collection: {ancien: nouveau}}. Elle ne s'efface pas : un écran ouvert
    hier, un lien écrit depuis une liste ancienne retrouvent la fiche, même renommée plusieurs fois depuis."""

    def __init__(self, fichier: Path, dossiers: dict, ecrire):
        self.fichier, self.dossiers, self.ecrire = fichier, dossiers, ecrire

    def lire(self) -> dict:
        try:
            trace = stockage.lire_json(self.fichier) if self.fichier.is_file() else {}
        except (OSError, ValueError):
            return {}
        return trace if isinstance(trace, dict) else {}

    def de(self, nom: str, trace: dict | None = None) -> dict:
        c = (self.lire() if trace is None else trace).get(nom)
        return {k: v for k, v in c.items() if isinstance(k, str) and isinstance(v, str)} if isinstance(c, dict) else {}

    def suivre(self, nom: str, ident: str, trace: dict | None = None):
        """L'identifiant actuel d'une fiche désignée par un ancien identifiant, ou None : la fiche existe déjà sous ce
        nom, la trace ne la connaît pas, ou elle mène à une fiche jetée depuis. trace : celle de la collection, déjà lue."""
        dossier = self.dossiers.get(nom)
        if dossier is None or not ID_FICHE.match(ident) or (dossier / f"{ident}.json").exists():
            return None
        trace, vus = self.de(nom) if trace is None else trace, {ident}
        while ident in trace:
            ident = trace[ident]
            if ident in vus or not ID_FICHE.match(ident):
                return None
            vus.add(ident)
            if (dossier / f"{ident}.json").exists():
                return ident
        return None

    def anciens(self, nom: str, ident: str) -> set:
        """Les anciens identifiants qui mènent aujourd'hui à cette fiche."""
        trace = self.de(nom)
        return {a for a in trace if self.suivre(nom, a, trace) == ident}

    def suites(self, nom: str, ident: str) -> list:
        """Les identifiants qu'a portés ensuite la fiche désignée par celui-ci, dans l'ordre, même jetée depuis."""
        trace, vus, suite = self.de(nom), {ident}, []
        while trace.get(ident) and trace[ident] not in vus:
            ident = trace[ident]
            vus.add(ident)
            suite.append(ident)
        return suite

    def pris(self, nom: str, ident: str, pour: str = "") -> bool:
        """Un identifiant qui a servi à une fiche renommée depuis : aucune autre fiche ne le reprend (pour : la fiche
        elle-même, qui peut revenir à un ancien nom)."""
        return ident in self.de(nom) and not (pour and self.suivre(nom, ident) == pour)

    def noter(self, nom: str, ancien: str, neuf: str) -> None:
        trace = self.lire()
        c = self.de(nom, trace)
        c.pop(neuf, None)  # il porte de nouveau une fiche : rien à suivre sous ce nom
        c[ancien] = neuf
        trace[nom] = c
        self.ecrire(self.fichier, trace)


# La trace de l'atelier, posée par routes() : main.py la consulte pour donner un identifiant neuf (pris_par_un_renommage).
TRACE: Renommages | None = None


def pris_par_un_renommage(dossier: Path, ident: str) -> bool:
    if TRACE is None:
        return False
    nom = next((n for n, d in TRACE.dossiers.items() if d == dossier), None)
    return bool(nom) and TRACE.pris(nom, ident)


def suites_du_renommage(dossier: Path, ident: str) -> list:
    """Les identifiants pris ensuite par une fiche renommée (corbeille.py : « Annuler » depuis un écran resté sur l'ancien)."""
    if TRACE is None:
        return []
    nom = next((n for n, d in TRACE.dossiers.items() if d == dossier), None)
    return TRACE.suites(nom, ident) if nom else []


class SuiviDesRenommages:
    """Devant les routes : une adresse qui désigne une fiche par un ancien identifiant (un écran resté ouvert pendant le
    renommage, un lien écrit depuis une liste ancienne) est réécrite vers l'actuel. Lire, enregistrer, illustrer, jeter :
    tout atteint la bonne fiche, et sa réponse porte le nouvel identifiant, que l'écran adopte. L'en-tête
    X-Identifiant le redit pour une réponse sans fiche."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        m = ADRESSE_FICHE.match(scope.get("path", "")) if scope["type"] == "http" and TRACE is not None else None
        neuf = TRACE.suivre(m.group(1), m.group(2)) if m else None
        # Seulement vers une fiche du MJ qui lit (cloisonnement.py) : l'ancien identifiant d'une fiche de l'autre ne mène à
        # rien, comme une fiche qui n'existe pas.
        if neuf and not cloisonnement.permis_chemin(m.group(1), TRACE.dossiers[m.group(1)] / f"{neuf}.json"):
            neuf = None
        if not neuf:
            return await self.app(scope, receive, send)
        debut, fin = m.span(2)
        chemin = scope["path"][:debut] + neuf + scope["path"][fin:]
        scope = {**scope, "path": chemin, "raw_path": chemin.encode()}

        async def envoyer(message):
            if message["type"] == "http.response.start":
                message = {**message, "headers": [*message.get("headers", []), (b"x-identifiant", neuf.encode())]}
            await send(message)

        await self.app(scope, receive, envoyer)


def plier(t) -> str:
    """Comme plier() de js/scenarios/consignes.js : sans accents ni casse, les blancs resserrés."""
    t = unicodedata.normalize("NFKD", str(t or ""))
    return " ".join("".join(c for c in t if not unicodedata.combining(c)).lower().split())


def cible(href: str):
    """La fiche que vise un lien de l'atelier, (genre, identifiant, lieu) ; None s'il vise autre chose."""
    chemin, _, requete = str(href or "").lstrip("#").partition("?")
    morceaux = chemin.split("/")
    if len(morceaux) != 3 or morceaux[0] != "":
        return None
    genre = {"pnj": "pnj", "plan": "plan", "combats": "rencontre", "carte": "carte", "lieu": "lieu"}.get(morceaux[1])
    try:
        ident = unquote(morceaux[2], errors="strict")
        lieu = None
        if genre == "carte":
            for morceau in requete.split("&"):
                cle, _, valeur = morceau.partition("=")
                if cle == "lieu" and valeur:
                    lieu = unquote(valeur, errors="strict")
    except UnicodeDecodeError:
        return None
    if not genre or not ident or (genre == "pnj" and ident == "nouveau"):
        return None
    return genre, ident, lieu


def resoudre(nom: str, fiches: dict):
    """La fiche d'un lien court @[Nom] : dans l'ordre PNJ, lieu, plan, rencontre, carte, le premier genre qui a ce nom, s'il
    n'y en a qu'une. fiches : {genre: [fiche, …]}."""
    cle = plier(nom)
    for genre in ORDRE:
        trouvees = [f for f in fiches.get(genre) or [] if plier(f.get("nom")) == cle]
        if trouvees:
            return (genre, trouvees[0]["id"]) if len(trouvees) == 1 else None
    return None


def lisible(texte: str) -> str:
    """Un passage en texte simple : les liens réduits à leur libellé, sans marques d'intertitre, d'encadré ni de tableau."""
    t = LIEN.sub(r"\1", texte)
    t = COURT.sub(r"\1", t)
    t = re.sub(r"\[\[[\s\S]*?\]\]", "…", t)
    t = re.sub(r"^\s*(#{1,4}|>|[-*]|\d+[.)])\s+", "", t)
    t = " · ".join(c.strip() for c in t.strip().strip("|").split("|")) if t.lstrip().startswith("|") else t
    return " ".join(t.replace("**", "").split())


def extrait(texte: str, debut: int, fin: int) -> str:
    """La ligne où tombe le lien (une rangée de tableau en cellules séparées), coupée autour de lui à EXTRAIT_MAX
    caractères."""
    a = texte.rfind("\n", 0, debut) + 1
    b = texte.find("\n", fin)
    ligne = texte[a: b if b >= 0 else len(texte)]
    pos = debut - a
    tableau = ligne.lstrip().startswith("|")
    gauche = lisible(ligne[:pos] + ("|" if tableau else "")).rstrip(" ·") if pos else ""
    droite = lisible(("|" if tableau else "") + ligne[pos:]).lstrip(" ·")
    if len(gauche) > EXTRAIT_MAX // 2:
        gauche = "…" + gauche[-(EXTRAIT_MAX // 2):].split(" ", 1)[-1]
    morceau = f"{gauche}{' · ' if tableau and gauche else ' '}{droite}".strip()
    return morceau if len(morceau) <= EXTRAIT_MAX else morceau[:EXTRAIT_MAX - 1].rsplit(" ", 1)[0] + "…"


def citations(texte: str, fiches: dict):
    """Chaque lien du texte vers une fiche, dans l'ordre : (genre, identifiant, lieu, début, fin, lien) ; lien : l'adresse
    écrite, ou le lien court tel quel."""
    trouves = []
    for m in LIEN.finditer(texte or ""):
        c = cible(m.group(2))
        if c:
            trouves.append((*c, m.start(), m.end(), m.group(2)))
    for m in COURT.finditer(texte or ""):
        r = resoudre(m.group(1), fiches)
        if r:
            trouves.append((r[0], r[1], None, m.start(), m.end(), m.group(0)))
    return sorted(trouves, key=lambda x: x[3])


def mentions(scenarios: list, genre: str, ident: str, fiches: dict, anciens=()) -> list:
    """Les chapitres qui citent la fiche, scénario par scénario (le plus récemment modifié d'abord), chacun une fois :
    combien de fois, l'extrait de la première citation et, pour un lieu cité par l'un de ses plans, le nom du plan.
    anciens : les identifiants qu'elle a portés (un lien écrit avant son renommage la cite aussi)."""
    plans = {p["id"]: p for p in fiches.get("plan") or [] if isinstance(p, dict) and p.get("id")}
    siens = {ident, *anciens}
    sortie = []
    for s in sorted(scenarios, key=lambda x: str(x.get("modifie") or ""), reverse=True):
        for n, ch in enumerate(s.get("chapitres") or [], start=1):
            if not isinstance(ch, dict):
                continue
            texte = ch.get("texte") or ""
            if not isinstance(texte, str):
                continue
            fois, premier, par = 0, None, []
            for g, i, lieu, debut, fin, lien in citations(texte, fiches):
                via = None
                if genre == "pnj":
                    vise = g == "pnj" and i in siens
                else:
                    vise = (g == "lieu" and i in siens) or (g == "carte" and lieu in siens)
                    if not vise and g == "plan" and (plans.get(i) or {}).get("lieu") in siens:
                        vise, via = True, plans[i].get("nom") or "un plan"
                if not vise:
                    continue
                fois += 1
                premier = premier or (debut, fin, lien)
                if via and via not in par:
                    par.append(via)
            if fois:
                sortie.append({"scenario": s.get("id"), "nom": s.get("nom") or "Sans titre", "etat": s.get("etat") or "brouillon",
                               "chapitre": ch.get("id"), "numero": n, "titre": ch.get("titre") or "Sans titre", "fois": fois,
                               "extrait": extrait(texte, premier[0], premier[1]), "lien": premier[2], "par": par})
    return sortie


def motif_identifiant(ident: str) -> re.Pattern:
    """L'identifiant en entier, hors d'un mot plus long."""
    return re.compile(rf"(?<![a-z0-9-]){re.escape(ident)}(?![a-z0-9-])")


def trace_propre(relatif: Path, collection: str, ident: str) -> bool:
    """Ce qui n'est pas une citation de la fiche : ses propres versions gardées, et les fiches jetées sous le même
    identifiant dans sa collection (<id>-AAAAMMJJ-HHMMSS.json), qui ne disent que leur propre identifiant."""
    parts = relatif.parts
    if len(parts) >= 3 and parts[:3] == ("historique", collection, ident):
        return True
    return (len(parts) == 3 and parts[:2] == ("corbeille", collection)
            and re.fullmatch(rf"{re.escape(ident)}-\d{{8}}-\d{{6}}\.json", parts[2]) is not None)


def cite_ailleurs(donnees: Path, ident: str, ignores: set, collection: str = "") -> list:
    """Les fichiers de données qui nomment cet identifiant (en entier, hors d'un mot plus long), hors des fichiers ignores
    (la fiche elle-même), de ses propres traces (trace_propre) et des dossiers HORS_CITATIONS. Prudent : un mot du même
    nom dans un texte, une ancienne version d'une autre fiche suffisent à garder l'identifiant."""
    motif = motif_identifiant(ident)
    trouves = []
    for f in sorted(donnees.rglob("*.json")):
        relatif = f.relative_to(donnees)
        if relatif.parts[0] in HORS_CITATIONS or f in ignores or f.name.startswith("."):
            continue
        if collection and trace_propre(relatif, collection, ident):
            continue
        try:
            texte = f.read_text(encoding="utf-8")
            if collection and relatif.parts[0] in ("historique", "corbeille") and relatif.parts[1:2] == (collection,):
                # Une version ou une fiche jetée de la même collection porte son propre identifiant d'alors (une fiche
                # renommée depuis, une autre jetée) : ce n'est pas une citation. Le reste de la fiche compte.
                try:
                    contenu = json.loads(texte)
                    if isinstance(contenu, dict):
                        texte = json.dumps({k: v for k, v in contenu.items() if k != "id"}, ensure_ascii=False)
                except ValueError:
                    pass
            if motif.search(texte):
                trouves.append(str(relatif))
        except (OSError, UnicodeDecodeError):
            trouves.append(str(relatif))
    return trouves


def routes(dossiers: dict, donnees: Path, historique: Path, scenarios: Path, *, lire_tout, lire_fiche, existant, ecrire,
           slug, nouvel_id, maintenant) -> APIRouter:
    """dossiers : {"pnj": dossier, "lieux": …, "plans": …, "rencontres": …, "cartes": …}. Les autres : ceux de main.py
    (nouvel_id n'y sert plus : un identifiant neuf doit aussi être libre dans l'historique et la corbeille)."""
    global TRACE
    r = APIRouter()
    corbeille = donnees / "corbeille"
    TRACE = trace = Renommages(donnees / RENOMMAGES, {nom: dossiers[nom] for nom in GENRES}, ecrire)

    def fiches_des_liens() -> dict:
        return {"pnj": lire_tout(dossiers["pnj"]), "lieu": lire_tout(dossiers["lieux"]), "plan": lire_tout(dossiers["plans"]),
                "rencontre": lire_tout(dossiers["rencontres"]), "carte": lire_tout(dossiers["cartes"])}

    def collection(nom: str) -> Path:
        if nom not in GENRES:
            raise HTTPException(404, "Introuvable")
        return dossiers[nom]

    @r.get("/api/mentions/{nom}/{ident}")
    def dans_les_scenarios(nom: str, ident: str):
        """Les passages des scénarios qui citent ce PNJ ou ce lieu."""
        lire_fiche(existant(collection(nom), ident, lecture=True))
        tous = lire_tout(scenarios)
        # Les noms des scénarios : un ancien champ « Scénario » qui porte un identifiant se lit sous son nom.
        return {"passages": mentions(tous, GENRES[nom], ident, fiches_des_liens(), trace.anciens(nom, ident)),
                "noms": {s["id"]: s.get("nom") or "Sans titre" for s in tous if isinstance(s.get("id"), str)}}

    @r.get("/api/renommages")
    def renommages():
        """Les anciens identifiants et la fiche où ils mènent aujourd'hui : un lien écrit avant un renommage n'est pas mort."""
        sortie = {}
        for nom in GENRES:
            c = trace.de(nom)
            # Chacun les renommages de ses fiches (cloisonnement.py).
            sortie[nom] = {a: n for a in c if (n := trace.suivre(nom, a, c))
                           and cloisonnement.permis_chemin(nom, dossiers[nom] / f"{n}.json")}
        return sortie

    def libre(nom: str, ident: str, pour: str) -> bool:
        """Un identifiant que rien n'a jamais porté dans la collection : ni une fiche, ni des versions gardées, ni une fiche
        jetée, ni une fiche renommée depuis (sauf celle-ci, pour : elle revient à un ancien nom). Une fiche renommée
        n'hérite pas de l'histoire d'une autre, une fiche jetée revient à sa place, un écran resté sur l'ancien
        identifiant d'une autre fiche ne tombe jamais sur celle-ci."""
        if (dossiers[nom] / f"{ident}.json").exists() or (historique / nom / ident).exists() or trace.pris(nom, ident, pour):
            return False
        return not any(re.fullmatch(rf"{re.escape(ident)}-\d{{8}}-\d{{6}}", f.stem) for f in (corbeille / nom).glob(f"{ident}-*.json"))

    def deplacer_versions(nom: str, ident: str, neuf: str, cree) -> None:
        """Les versions gardées suivent la fiche : « Versions précédentes » les retrouve sous le nouvel identifiant. Celles
        d'une autre fiche jetée autrefois sous le même identifiant (une autre date de création) restent où elles sont."""
        ancien = historique / nom / ident
        if not ancien.is_dir():
            return
        cible = historique / nom / neuf
        cible.mkdir(parents=True, exist_ok=True)
        for version in sorted(ancien.glob("*.json")):
            if cree:
                try:
                    autre = stockage.lire_json(version).get("cree")
                except (OSError, ValueError, AttributeError):
                    autre = None
                if autre != cree:
                    continue
            shutil.move(str(version), str(cible / version.name))
        try:
            ancien.rmdir()
        except OSError:
            pass  # il garde les versions d'une autre fiche

    def remplacer_lieu(valeur, ancien: str, neuf: str):
        """Ce qu'une carte dit d'un lieu (« lieu » : son identifiant), partout où elle le dit : marqueurs, habillage."""
        if isinstance(valeur, dict):
            return {k: (neuf if k == "lieu" and v == ancien else remplacer_lieu(v, ancien, neuf)) for k, v in valeur.items()}
        if isinstance(valeur, list):
            return [remplacer_lieu(v, ancien, neuf) for v in valeur]
        return valeur

    def fixer_identifiant(nom: str, ident: str, carte=None, version_carte=None):
        """L'identifiant d'une fiche suit son nom tant que rien ne la cite (a02) : « nouveau-pnj » devient « gaspard-tourbe »
        au premier vrai nom. Dès qu'un lien, une séance, un plan, la TV ou une version gardée la nomme, il ne bouge plus.
        carte, version_carte : pour un lieu nommé sur sa carte, la carte et la version qu'en a l'éditeur ouvert. Si c'est
        celle du disque, le serveur réécrit lui-même ce que la carte dit du lieu, dans le même geste : la carte ne pointe
        jamais vers un identifiant disparu, même si l'éditeur se ferme ou qu'un autre écran l'enregistre. Sinon, la carte
        compte comme une citation. Rend la fiche, sous son identifiant d'avant ou le nouveau (et la version de la carte
        réécrite)."""
        dossier = collection(nom)
        chemin = existant(dossier, ident)
        fiche = lire_fiche(chemin)
        reste = {"id": ident, "fiche": fiche, "change": False}
        # La fiche d'un MJ invité garde son identifiant opaque (main.nouvel_id) : il ne suit jamais son nom.
        if proprietes.auteur_de(fiche) != proprietes.PRINCIPAL:
            return reste
        base = slug(str(fiche.get("nom") or ""))
        if base == "sans-nom" or ident == base or re.fullmatch(rf"{re.escape(base)}-[0-9a-f]{{4}}", ident):
            return reste
        ignores, chemin_carte, contenu_carte = {chemin}, None, None
        if (nom == "lieux" and isinstance(carte, str) and ID_CARTE.match(carte) and carte == fiche.get("carte")
                and isinstance(version_carte, str) and (dossiers["cartes"] / f"{carte}.json").is_file()):
            chemin_carte = dossiers["cartes"] / f"{carte}.json"
            contenu_carte = lire_fiche(chemin_carte)
            if contenu_carte.get("modifie") != version_carte:
                return reste  # enregistrée depuis par un autre écran : le lieu garde son identifiant
            ignores.add(chemin_carte)
        if cite_ailleurs(donnees, ident, ignores, nom):
            return reste
        neuf = base
        while not libre(nom, neuf, ident):
            neuf = f"{base}-{secrets.token_hex(2)}"
        if chemin_carte:
            contenu_carte = remplacer_lieu(contenu_carte, ident, neuf)
            # Ce qu'elle dirait encore de l'ancien identifiant, ailleurs que sous « lieu » : la carte le cite, rien ne bouge.
            if motif_identifiant(ident).search(json.dumps(contenu_carte, ensure_ascii=False)):
                return reste
        fiche["id"] = neuf
        fiche["modifie"] = maintenant()
        ecrire(dossier / f"{neuf}.json", fiche)
        reponse = {"id": neuf, "fiche": fiche, "change": True}
        if chemin_carte:
            contenu_carte["modifie"] = maintenant()
            ecrire(chemin_carte, contenu_carte)
            reponse["carte"] = {"id": carte, "modifie": contenu_carte["modifie"]}
        # La trace d'abord : entre l'effacement de l'ancien fichier et elle, un écran resté dessus ne trouverait rien.
        trace.noter(nom, ident, neuf)
        chemin.unlink()
        deplacer_versions(nom, ident, neuf, fiche.get("cree"))
        return reponse

    def route_identifiant(nom: str):
        async def fixer(ident: str, requete: Request):
            try:
                corps = await requete.json()
            except ValueError:
                corps = {}
            corps = corps if isinstance(corps, dict) else {}
            return fixer_identifiant(nom, ident, corps.get("carte"), corps.get("version_carte"))
        return fixer

    for nom in GENRES:
        r.add_api_route(f"/api/{nom}/{{ident}}/identifiant", route_identifiant(nom), methods=["POST"], name=f"identifiant_{nom}")
    return r
