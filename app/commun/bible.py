"""La bible de la campagne (notes/lore), lue par l'atelier et par le coin des joueurs.

L'atelier lit /lore, monté en lecture seule, et y voit tout, Contrôles compris. Pour les joueurs, il en publie une copie
dans le dossier des propositions (bible/) : seulement la liste blanche (ouvert_aux_joueurs), chaque document passé par le
masque du nom caché de l'auberge, avec un index. Le coin des joueurs ne lit que cette copie, et seulement par les clés de
l'index : /lore n'y est pas monté.

Le sommaire, la lecture et la recherche sont les mêmes des deux côtés : chacun passe à chercher() son catalogue, la liste
des documents qu'il a le droit de montrer, et sa façon de les lire. Ce module ne lit rien de l'atelier.
"""
import hashlib
import posixpath
import re
import threading
import time
import unicodedata
from collections import deque
from pathlib import Path

from commun import campagne
from commun import carnet
from commun import stockage

CHEMIN_LORE = re.compile(r"^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*\.md$")
ORDRE_BIBLE = ["etat-du-monde", "chronologie", "personnages", "lieux", "factions", "magie-cosmologie", "objets-bestiaire",
               "mysteres-et-flottements", "ton-et-table"]
# Les groupes de fiches d'épisode et de synthèses, et leur nom : la structure de la bible de la campagne (commun/campagne.py).
ORDRE_GROUPES = campagne.ORDRE_GROUPES_BIBLE
NOMS_GROUPES = campagne.NOMS_GROUPES_BIBLE
LECTURES: dict[Path, tuple[tuple[int, int], str, list[tuple[str, str]]]] = {}


class Refus(Exception):
    """Une demande refusée, avec le statut HTTP et la phrase à montrer."""

    def __init__(self, statut: int, message: str):
        super().__init__(message)
        self.statut = statut
        self.message = message


# ---------------------------------------------------------------- lire et chercher

def sans_accents(texte: str) -> str:
    texte = texte.replace("œ", "oe").replace("Œ", "Oe").replace("æ", "ae").replace("Æ", "Ae")
    return unicodedata.normalize("NFKD", texte).encode("ascii", "ignore").decode().casefold()


RENVOI_MD = re.compile(r"^\s{0,3}\[[^\]]+\]:\s+\S")
LIEN_MD = re.compile(r"\[([^\]]+)\]\([^)\s]*\)|\[([^\]]+)\]\[[^\]]*\]")
PUCE_MD = re.compile(r"^\s*(?:[-*+]|\d+[.)]|>)\s+")
ORNEMENT_MD = re.compile(r"\*\*|__|`|(?<![\w*])\*(?=\S)|(?<=\S)\*(?![\w*])")


def paragraphes(texte: str) -> list[str]:
    """Les paragraphes, éléments de liste et rangs de tableau, recollés : les synthèses coupent leurs lignes à
    120 signes, deux mots d'une même phrase peuvent tomber sur deux lignes."""
    blocs, courant = [], []
    for ligne in texte.splitlines():
        brut = ligne.strip()
        hors_texte = not brut or ligne.startswith("#") or RENVOI_MD.match(ligne)
        if courant and (hors_texte or PUCE_MD.match(ligne) or brut.startswith("|")):
            blocs.append(" ".join(courant))
            courant = []
        if hors_texte:
            continue
        if brut.startswith("|"):
            blocs.append(brut)
        else:
            courant.append(brut)
    if courant:
        blocs.append(" ".join(courant))
    return blocs


def lecture(chemin: Path) -> tuple[tuple[int, int], str, list[tuple[str, str]]]:
    """Un fichier de la bible, gardé en mémoire tant qu'il ne change pas, avec ses paragraphes déjà ramenés
    sans accents ni majuscules : la recherche parcourt tout à chaque requête."""
    st = chemin.stat()
    date = (st.st_mtime_ns, st.st_size)
    if chemin not in LECTURES or LECTURES[chemin][0] != date:
        texte = chemin.read_text(encoding="utf-8")
        LECTURES[chemin] = (date, texte, [(b, sans_accents(b)) for b in paragraphes(texte)])
    return LECTURES[chemin]


def lire(chemin: Path) -> str:
    return lecture(chemin)[1]


def titre_md(texte: str, defaut: str) -> str:
    for ligne in texte.splitlines():
        if ligne.startswith("# "):
            return ligne[2:].strip()
    return defaut


def extrait(ligne: str, mots: list[str], avant: int = 90, apres: int = 260) -> str:
    """La ligne en texte simple (liens réduits à leur libellé), coupée autour du premier mot trouvé."""
    brut = ORNEMENT_MD.sub("", PUCE_MD.sub("", LIEN_MD.sub(lambda m: m.group(1) or m.group(2), ligne))).strip()
    if len(brut) <= avant + apres:
        return brut
    plie, places = "", []
    for i, c in enumerate(brut):
        f = sans_accents(c)
        plie += f
        places += [i] * len(f)
    trouves = [plie.find(m) for m in mots if m in plie]
    centre = places[min(trouves)] if trouves else 0
    debut, fin = max(0, centre - avant), min(len(brut), centre + apres)
    if debut > 0:
        espace = brut.find(" ", debut, centre)
        debut = espace + 1 if espace >= 0 else debut
    if fin < len(brut):
        espace = brut.rfind(" ", centre, fin)
        fin = espace if espace > centre else fin
    return ("… " if debut > 0 else "") + brut[debut:fin].strip() + (" …" if fin < len(brut) else "")


def mots_de(q: str) -> list[str]:
    """Les mots d'une recherche : lettres et chiffres sans accents, deux au moins, six mots au plus (comme bible.js)."""
    return list(dict.fromkeys(m for m in re.findall(r"[a-z0-9]+", sans_accents(q or "")) if len(m) >= 2))[:6]


def fichier_sous(racine: Path, relatif: str) -> Path:
    """Un document de l'atelier : tout fichier .md de /lore, sans remonter au-dessus."""
    if not CHEMIN_LORE.match(relatif or ""):
        raise Refus(400, "Chemin invalide")
    chemin = (racine / relatif).resolve()
    if racine.resolve() not in chemin.parents or not chemin.is_file():
        raise Refus(404, "Introuvable")
    return chemin


def vue_document(chemin: str, texte: str, defaut: str) -> dict:
    return {"chemin": chemin, "titre": titre_md(texte, defaut), "markdown": texte}


# ---------------------------------------------------------------- le catalogue : ce qu'un côté a le droit de montrer

def documents(lore: Path) -> list[dict]:
    """Les documents à lire, par rubrique : la bible thématique, puis les synthèses et arbitrages, puis les références."""
    docs = []
    bible = sorted((lore / "bible").glob("*.md"), key=lambda f: (ORDRE_BIBLE.index(f.stem) if f.stem in ORDRE_BIBLE else 99, f.stem))
    for f in bible:
        docs.append({"chemin": f"bible/{f.name}", "titre": titre_md(lire(f), f.stem), "rubrique": "La bible"})
    for groupe in ORDRE_GROUPES:
        for suffixe, rubrique in (("", "Synthèses"), ("-arbitrages", "Arbitrages")):
            f = lore / "saisons" / f"{groupe}{suffixe}.md"
            if f.is_file():
                docs.append({"chemin": f"saisons/{f.name}", "titre": NOMS_GROUPES.get(groupe, groupe), "rubrique": rubrique})
    for nom, titre in (("glossaire.md", "Glossaire des noms propres"), ("inventaire.md", "Inventaire des épisodes")):
        if (lore / nom).is_file():
            docs.append({"chemin": nom, "titre": titre, "rubrique": "Références"})
    # Contrôles de la bible (examen) et des documents du kit (Chronique) : à lire, hors de la recherche.
    for dossier in ("chronique", "kit", "examen"):
        for f in sorted((lore / dossier).glob("*.md")):
            docs.append({"chemin": f"{dossier}/{f.name}", "titre": titre_md(lire(f), f.stem), "rubrique": "Contrôles"})
    return docs


def fiches_episodes(lore: Path) -> list[tuple[str, Path]]:
    return [(g, f) for g in ORDRE_GROUPES for f in sorted((lore / "episodes" / g).glob("*.md"))]


def catalogue(lore: Path) -> dict:
    """Tout ce que l'atelier montre au MJ : {documents, episodes}, la réponse de /api/bible."""
    episodes = {}
    for g, f in fiches_episodes(lore):
        episodes.setdefault(g, []).append({"chemin": f"episodes/{g}/{f.name}", "titre": titre_md(lire(f), f.stem)})
    return {"documents": documents(lore), "episodes": [{"groupe": g, "nom": NOMS_GROUPES.get(g, g), "fiches": episodes[g]}
                                                       for g in ORDRE_GROUPES if g in episodes]}


def sources(cat: dict) -> list[tuple[str, str]]:
    """Ce que parcourt la recherche, dans l'ordre : la bible thématique, les synthèses, les arbitrages et le glossaire,
    puis les fiches d'épisode dans l'ordre des groupes. Ni l'inventaire ni les Contrôles."""
    liste = [(d["chemin"], d["rubrique"]) for d in cat["documents"] if d["chemin"] != "inventaire.md" and d["rubrique"] != "Contrôles"]
    return liste + [(f["chemin"], g["nom"]) for g in cat["episodes"] for f in g["fiches"]]


def chercher(cat: dict, q: str, lire_lignes, limite: int = 80) -> dict:
    """Chaque mot cherché doit figurer dans la ligne, sans tenir compte des accents ni des majuscules. Seuls les documents
    du catalogue sont lus, par lire_lignes(chemin) -> (texte, lignes), ou None pour un document devenu illisible."""
    mots = mots_de(q)
    if not mots:
        return {"resultats": [], "total": 0}
    resultats, total = [], 0
    for relatif, rubrique in sources(cat):
        lu = lire_lignes(relatif)
        if lu is None:
            continue
        texte, lignes = lu
        trouves = [l for l, base in lignes if all(m in base for m in mots)]
        if not trouves:
            continue
        total += len(trouves)
        if len(resultats) < max(1, min(limite, 300)):
            resultats.append({"chemin": relatif, "titre": titre_md(texte, relatif), "rubrique": rubrique,
                              "lignes": [extrait(l, mots) for l in trouves[:3]], "autres": max(0, len(trouves) - 3)})
    return {"resultats": resultats, "total": total}


# ---------------------------------------------------------------- la liste blanche des joueurs

# Une liste blanche, jamais une liste noire : un fichier nouveau dans /lore (un chapitre, une synthèse de travail) reste
# au MJ tant qu'il n'est pas nommé ici. Restent fermés : les Contrôles (chronique/, kit/, examen/, qui parlent de la
# campagne du MJ), « Mystères et flottements » (retenu pour le MJ), bible/verifications/, les fusions de travail
# (-fiches, -noms), les essais, lots/, archives/ et les transcriptions.
CHAPITRES_JOUEURS = frozenset(f"bible/{c}.md" for c in ("etat-du-monde", "chronologie", "personnages", "lieux", "factions",
                                                        "magie-cosmologie", "objets-bestiaire", "ton-et-table"))
SAISONS_JOUEURS = frozenset(f"saisons/{g}{s}.md" for g in ORDRE_GROUPES for s in ("", "-arbitrages"))
REFERENCES_JOUEURS = frozenset({"glossaire.md", "inventaire.md"})
FICHE_EPISODE = re.compile(rf"^episodes/(?:{'|'.join(map(re.escape, ORDRE_GROUPES))})/\d{{1,4}}-[A-Za-z0-9_-]{{1,40}}\.md$")


def ouvert_aux_joueurs(chemin) -> bool:
    return isinstance(chemin, str) and (chemin in CHAPITRES_JOUEURS or chemin in SAISONS_JOUEURS or chemin in REFERENCES_JOUEURS
                                        or bool(FICHE_EPISODE.match(chemin)))


def pour_les_joueurs(cat: dict) -> dict:
    """Le catalogue de l'atelier réduit à la liste blanche."""
    docs = [d for d in cat["documents"] if ouvert_aux_joueurs(d["chemin"]) and d["rubrique"] != "Contrôles"]
    groupes = [{**g, "fiches": [f for f in g["fiches"] if ouvert_aux_joueurs(f["chemin"])]} for g in cat["episodes"]]
    return {"documents": docs, "episodes": [g for g in groupes if g["fiches"]]}


# ---------------------------------------------------------------- la copie publiée pour le coin des joueurs

BIBLE = "bible"  # dans le dossier des propositions
INDEX = "index.json"
DOCS = "docs"
NOM_PUBLIE = re.compile(r"^[a-f0-9]{24}\.md$")
DOCUMENT_MAX = 4 * 1024 * 1024  # un document plus lourd n'est ni publié ni lu
# Change quand la forme publiée change (masque, nettoyage des liens) : tout est alors republié.
FORMAT = 1
FERMEE = "La bible n'est pas ouverte : votre MJ l'ouvrira pour vous."
# Une publication à la fois (la tâche de fond, l'interrupteur du MJ).
PUBLICATION = threading.Lock()

LIEN_EN_LIGNE = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
RENVOI = re.compile(r"^[ \t]{0,3}\[([^\]]+)\]:[ \t]+(\S+).*(?:\n|$)", re.M)
LIEN_RENVOYE = re.compile(r"\[([^\]]+)\]\[([^\]]*)\]")
COMMENTAIRE = re.compile(r"<!--[\s\S]*?-->")


def nom_publie(chemin: str) -> str:
    """Le nom du fichier publié : il ne dit pas le chemin et reste le même tant que le document existe."""
    return hashlib.sha256(f"bible/{chemin}".encode()).hexdigest()[:24] + ".md"


def cible_du_lien(dossier: str, url: str) -> str | None:
    """Le document que vise un lien relatif, résolu comme dans bible.js ; None pour une adresse web, "" pour ce qui ne
    mène à aucun document."""
    if re.match(r"^https?://", url):
        return None
    morceaux = dossier.split("/") if dossier else []
    for m in url.split("#")[0].split("/"):
        if m == "..":
            if not morceaux:
                return ""
            morceaux.pop()
        elif m and m != ".":
            morceaux.append(m)
    chemin = "/".join(morceaux)
    return chemin if CHEMIN_LORE.match(chemin) else ""


def sans_liens_fermes(texte: str, chemin: str, ouverts: set) -> str:
    """La copie des joueurs ne garde que les liens vers une vidéo ou un document qu'ils peuvent ouvrir : un renvoi vers
    « Mystères et flottements » ou un fichier de travail devient son seul libellé. Les commentaires s'en vont."""
    dossier = posixpath.dirname(chemin)
    texte = COMMENTAIRE.sub("", texte)
    ferme = lambda url: (c := cible_du_lien(dossier, url)) is not None and c not in ouverts  # noqa: E731
    fermes = {m.group(1).lower() for m in RENVOI.finditer(texte) if ferme(m.group(2))}
    texte = RENVOI.sub(lambda m: "" if m.group(1).lower() in fermes else m.group(0), texte)
    texte = LIEN_RENVOYE.sub(lambda m: m.group(1) if (m.group(2) or m.group(1)).lower() in fermes else m.group(0), texte)
    return LIEN_EN_LIGNE.sub(lambda m: m.group(1) if ferme(m.group(2)) else m.group(0), texte)


def a_lire(cat: dict) -> list[dict]:
    """Le catalogue à plat, dans l'ordre : {chemin, titre, rubrique, groupe} ; groupe est vide hors des fiches d'épisode."""
    plat = [{"chemin": d["chemin"], "titre": d["titre"], "rubrique": d["rubrique"], "groupe": ""} for d in cat["documents"]]
    return plat + [{"chemin": f["chemin"], "titre": f["titre"], "rubrique": g["nom"], "groupe": g["groupe"]}
                   for g in cat["episodes"] for f in g["fiches"]]


def candidats(lore: Path) -> list[Path]:
    """Les fichiers où la liste blanche puise : un regard sur leurs dates suffit à savoir s'il faut republier."""
    return [*(lore / "bible").glob("*.md"), *(lore / "saisons").glob("*.md"), lore / "glossaire.md", lore / "inventaire.md",
            *(f for g in ORDRE_GROUPES for f in (lore / "episodes" / g).glob("*.md"))]


def etat_des_sources(lore: Path, nom_public: str = "") -> str:
    """L'empreinte de ce qui serait publié : dates et tailles des fichiers ouverts, le nom que lisent les joueurs à la
    place du nom caché, la forme de la copie. Tant qu'elle ne bouge pas, rien n'est relu."""
    vus = []
    for f in candidats(lore):
        relatif = f.relative_to(lore).as_posix()
        if not ouvert_aux_joueurs(relatif):
            continue
        try:
            st = f.stat()
        except OSError:
            continue
        vus.append(f"{relatif}|{st.st_mtime_ns}|{st.st_size}")
    return hashlib.sha256("\n".join([f"{FORMAT}", nom_public, *sorted(vus)]).encode()).hexdigest()[:32]


def ecrire_texte_si_change(chemin: Path, texte: str) -> bool:
    try:
        if chemin.read_text(encoding="utf-8") == texte:
            return False
    except (OSError, ValueError):
        pass
    chemin.parent.mkdir(parents=True, exist_ok=True)
    stockage.ecrire_texte(chemin, texte, mode=0o644)
    return True


def lire_index(depot: Path) -> dict | None:
    return carnet.lire_publie(depot / BIBLE / INDEX)


def fermer(depot: Path) -> dict:
    """Fermée, la bible des joueurs n'existe plus dans les propositions : l'index d'abord (le coin la voit fermée aussitôt),
    puis les documents."""
    dossier, ecrits = depot / BIBLE, 0
    if (dossier / INDEX).exists():
        (dossier / INDEX).unlink(missing_ok=True)
        ecrits += 1
    if (dossier / DOCS).is_dir():
        for f in (dossier / DOCS).iterdir():
            f.unlink(missing_ok=True)
            ecrits += 1
    for d in (dossier / DOCS, dossier):
        try:
            d.rmdir()
        except OSError:
            pass
    return {"ecrits": ecrits, "documents": 0, "octets": 0, "retenus": []}


def publier(depot: Path, lore: Path, ouverte: bool, masquer, contient_nom_cache, nom_public: str = "") -> dict:
    """Écrit la bible des joueurs : chaque document de la liste blanche, liens fermés retirés et nom caché masqué, puis
    l'index ; enfin, ce qui n'est plus publié s'en va. Un document n'est relu que si sa source a changé, et réécrit que
    si sa copie change. Un document où le nom caché résisterait au masque n'est pas publié : il est rendu dans
    « retenus ». Rend aussi le nombre de documents et la taille publiée, en octets."""
    with PUBLICATION:
        if not ouverte:
            return fermer(depot)
        dossier = depot / BIBLE
        etat = etat_des_sources(lore, nom_public)
        avant = lire_index(depot) or {}
        vieux = {e.get("chemin"): e for e in avant.get("elements", []) if isinstance(e, dict)}
        cat = pour_les_joueurs(catalogue(lore))
        plat = a_lire(cat)
        ouverts = {e["chemin"] for e in plat}
        globale = hashlib.sha256(f"{FORMAT}|{nom_public}|{'|'.join(sorted(ouverts))}".encode()).hexdigest()
        entrees, retenus, ecrits, octets = [], [], 0, 0
        for e in plat:
            source = lore / e["chemin"]
            try:
                st = source.stat()
            except OSError:
                continue
            empreinte = hashlib.sha256(f"{globale}|{e['chemin']}|{st.st_mtime_ns}|{st.st_size}".encode()).hexdigest()[:24]
            cible = dossier / DOCS / nom_publie(e["chemin"])
            titre = masquer(e["titre"])
            attendue = {**e, "titre": titre, "fichier": cible.name, "source": empreinte}
            if vieux.get(e["chemin"]) == attendue and cible.is_file():
                entrees.append(attendue)
                octets += cible.stat().st_size
                continue
            copie = masquer(sans_liens_fermes(lire(source), e["chemin"], ouverts))
            if contient_nom_cache(copie) or contient_nom_cache(titre) or len(copie.encode()) > DOCUMENT_MAX:
                retenus.append(titre if not contient_nom_cache(titre) else e["chemin"])
                continue
            ecrits += ecrire_texte_si_change(cible, copie)
            octets += len(copie.encode())
            entrees.append(attendue)
        ecrits += carnet.ecrire_si_change(dossier / INDEX, entrees, ouverte=True, etat=etat, octets=octets)
        gardes = {e["fichier"] for e in entrees}
        for f in (dossier / DOCS).iterdir() if (dossier / DOCS).is_dir() else ():
            if f.name not in gardes and not f.name.startswith("."):
                f.unlink(missing_ok=True)
                ecrits += 1
        taille = (dossier / INDEX).stat().st_size if (dossier / INDEX).exists() else 0
        return {"ecrits": ecrits, "documents": len(entrees), "octets": octets + taille, "retenus": retenus}


def a_republier(depot: Path, lore: Path, ouverte: bool, nom_public: str = "") -> bool:
    """Vrai si la copie publiée ne correspond plus à /lore (ou à l'interrupteur) : la tâche de fond ne publie qu'alors."""
    index = lire_index(depot)
    if not ouverte:
        return index is not None or (depot / BIBLE).exists()
    return index is None or index.get("etat") != etat_des_sources(lore, nom_public)


# ---------------------------------------------------------------- ce que lit le coin des joueurs

_INDEX: dict = {}


def index_publie(depot: Path) -> dict | None:
    """{chemin: entrée} de la bible publiée, ou None si elle est fermée. Le coin y reprend la liste blanche : même un
    index faux ne lui ferait pas servir un Contrôle."""
    chemin = depot / BIBLE / INDEX
    try:
        st = chemin.stat()
    except OSError:
        return None
    cle = (str(chemin), st.st_mtime_ns, st.st_size)
    deja = _INDEX.get("lu")
    if deja and deja[0] == cle:
        return deja[1]
    contenu = carnet.lire_publie(chemin)
    entrees = None
    if contenu is not None and contenu.get("ouverte") is True:
        entrees = {}
        for e in contenu["elements"]:
            if (isinstance(e, dict) and ouvert_aux_joueurs(e.get("chemin")) and isinstance(e.get("fichier"), str)
                    and NOM_PUBLIE.match(e["fichier"]) and all(isinstance(e.get(k), str) for k in ("titre", "rubrique", "groupe"))):
                entrees[e["chemin"]] = e
    _INDEX["lu"] = (cle, entrees)
    return entrees


def catalogue_publie(index: dict) -> dict:
    """La réponse de /api/bible, comme celle de l'atelier, tirée de l'index publié."""
    docs = [{"chemin": e["chemin"], "titre": e["titre"], "rubrique": e["rubrique"]} for e in index.values() if not e["groupe"]]
    groupes = {}
    for e in index.values():
        if e["groupe"]:
            groupes.setdefault(e["groupe"], {"groupe": e["groupe"], "nom": e["rubrique"], "fiches": []})["fiches"].append(
                {"chemin": e["chemin"], "titre": e["titre"]})
    return {"documents": docs, "episodes": list(groupes.values())}


def lire_publie(depot: Path, index: dict, chemin: str):
    """(texte, lignes) d'un document publié, trouvé par sa seule clé dans l'index ; None s'il n'y est pas ou ne se lit pas."""
    e = index.get(chemin) if isinstance(chemin, str) else None
    if e is None:
        return None
    f = depot / BIBLE / DOCS / e["fichier"]
    try:
        if f.stat().st_size > DOCUMENT_MAX:
            return None
        _, texte, lignes = lecture(f)
    except (OSError, ValueError):
        return None
    return texte, lignes


def document_publie(depot: Path, index: dict, chemin: str) -> dict:
    lu = lire_publie(depot, index, chemin)
    if lu is None:
        raise Refus(404, "Ce document n'est pas dans la bible des joueurs.")
    return vue_document(chemin, lu[0], index[chemin]["titre"])


def chercher_publie(depot: Path, index: dict, q: str, limite: int = 80) -> dict:
    return chercher(catalogue_publie(index), q, lambda c: lire_publie(depot, index, c), limite)


class Cadence:
    """Au plus `nombre` passages en `duree` secondes par clé : la recherche du coin, 30 par minute et par joueur."""

    def __init__(self, nombre: int, duree: float):
        self.nombre, self.duree = nombre, duree
        self.passages: dict[str, deque] = {}
        self.verrou = threading.Lock()

    def accepter(self, cle: str, maintenant: float | None = None) -> bool:
        t = time.monotonic() if maintenant is None else maintenant
        with self.verrou:
            for k in [k for k, f in self.passages.items() if k != cle and (not f or f[-1] <= t - self.duree)]:
                del self.passages[k]
            file = self.passages.setdefault(cle, deque())
            while file and file[0] <= t - self.duree:
                file.popleft()
            if len(file) >= self.nombre:
                return False
            file.append(t)
            return True
