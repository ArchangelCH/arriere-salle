"""Les pointeurs de la table, entre le MJ et le coin des joueurs (lot du 13/11).

Deux sens, deux petits dossiers dans les propositions (hors de table/, dont chaque fichier fait relire toute la table) :

  - le pointeur du MJ et sa règle (outil Mesurer), vers le coin : l'atelier écrit `pointeurs/mj.json` quand la table du
    coin est ouverte et que la TV montre le plan ou la carte où il pointe ; la page Table du coin l'apprend par le flux
    (sujet « pointeur ») et le relit par GET /api/pointeurs. Position, jeton public du plan ou de la carte, texte de la
    mesure : rien qui ne soit déjà à la TV ;
  - le pointeur d'un joueur, vers le MJ : le coin écrit `pointeurs/joueurs/<joueur>.json` (sa session, jamais un
    identifiant venu de la requête) ; l'atelier le voit sur son plan ou sa carte, à la couleur de son héros.

Rien ne dure : un pointeur de plus de VIVANT secondes n'existe plus (le joueur a lâché, l'atelier a planté), la règle
tient REGLE_VIVANTE secondes sans nouvelle. Les âges se comptent à la lecture, de l'horloge du lecteur : celle d'un
téléphone ne compte pas.

Ce module ne lit rien de l'atelier : le coin (joueurs.py) et l'atelier (pointeurs_mj.py) l'importent tous deux.
"""
import math
import re
from datetime import datetime
from pathlib import Path

from commun import stockage

DOSSIER = "pointeurs"
MJ = "mj.json"
JOUEURS = "joueurs"
OCTETS_MAX = 4096
VIVANT = 10  # secondes : un point sans nouvelle de plus de dix secondes n'est plus montré
REGLE_VIVANTE = 15 * 60  # secondes : la règle reste tant que le MJ ne l'efface pas, sans dépasser un quart d'heure
BORNE = 1e5  # cases, ou pixels de carte : au-delà, la valeur n'est pas une position
GENRES = ("plan", "carte")
JETON = re.compile(r"^[a-f0-9]{20}$")
TEXTE_MAX = 40
ID_JOUEUR = re.compile(r"^[a-z0-9-]{1,60}$")


def maintenant() -> str:
    return datetime.now().isoformat(timespec="milliseconds")


def age(iso, instant: datetime | None = None) -> float | None:
    """Les secondes depuis cette date (None : illisible). Une date un peu en avance compte pour maintenant."""
    try:
        t = datetime.fromisoformat(iso) if isinstance(iso, str) else None
    except ValueError:
        t = None
    if t is None:
        return None
    return max(0.0, ((instant or datetime.now()) - t).total_seconds())


def nombre(v) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or abs(v) > BORNE:
        return None
    return round(float(v), 3)


def texte_court(v) -> str:
    """Le texte d'une mesure (« 4,5 m · 3 cases ») : une ligne, sans balise, courte. Il s'affiche en texte brut."""
    if not isinstance(v, str):
        return ""
    propre = " ".join(v.split())
    return "".join(c for c in propre if c not in "<>&\"`")[:TEXTE_MAX]


def cible(m) -> tuple[str, str] | None:
    """(genre, jeton) d'un message : « plan » ou « carte » portant un jeton public."""
    if not isinstance(m, dict):
        return None
    for genre in GENRES:
        if genre in m:
            j = m.get(genre)
            return (genre, j) if isinstance(j, str) and JETON.match(j) else None
    return None


# ------------------------------------------------------------ le pointeur du MJ, vers le coin

def point_valide(p) -> dict | None:
    c = cible(p)
    if c is None:
        return None
    x, y = nombre(p.get("x")), nombre(p.get("y"))
    if x is None or y is None:
        return None
    onde = p.get("onde")
    return {c[0]: c[1], "x": x, "y": y, "vu": p.get("vu") if isinstance(p.get("vu"), str) else None,
            "onde": onde if isinstance(onde, int) and not isinstance(onde, bool) and 0 <= onde < 10**9 else 0,
            "onde_vue": p.get("onde_vue") if isinstance(p.get("onde_vue"), str) else None}


def regle_valide(r) -> dict | None:
    c = cible(r)
    if c is None:
        return None
    ab = (r.get("a"), r.get("b"))
    if not all(isinstance(p, list) and len(p) == 2 for p in ab):
        return None
    xs = [nombre(v) for p in ab for v in p]
    if any(v is None for v in xs):
        return None
    return {c[0]: c[1], "a": xs[:2], "b": xs[2:], "texte": texte_court(r.get("texte"))}


def ecrire_mj(depot: Path, point: dict | None, regle: dict | None) -> None:
    """Ce que le MJ montre en ce moment. Rien à montrer : le fichier s'en va."""
    chemin = depot / DOSSIER / MJ
    if point is None and regle is None:
        chemin.unlink(missing_ok=True)
        return
    chemin.parent.mkdir(parents=True, exist_ok=True)
    stockage.ecrire_json_compact(chemin, {"maj": maintenant(), "point": point, "regle": regle}, mode=0o644)


def lire_mj(depot: Path, instant: datetime | None = None) -> dict:
    """{"point", "regle"} tels que la page les dessine : le point avec son âge et celui de sa dernière onde, la règle
    tant qu'elle est récente. Rien de lisible, ou périmé : {"point": None, "regle": None}."""
    vide = {"point": None, "regle": None}
    chemin = depot / DOSSIER / MJ
    try:
        if chemin.stat().st_size > OCTETS_MAX:
            return vide
        brut = stockage.lire_json(chemin)
    except (OSError, ValueError):
        return vide
    if not isinstance(brut, dict):
        return vide
    instant = instant or datetime.now()
    sortie = dict(vide)
    p = point_valide(brut.get("point"))
    a = age(p.get("vu"), instant) if p else None
    if p and a is not None and a < VIVANT:
        ond = age(p.get("onde_vue"), instant)
        sortie["point"] = {k: v for k, v in p.items() if k not in ("vu", "onde_vue")} | {
            "age": round(a, 2), "onde_age": None if ond is None else round(ond, 2)}
    r = regle_valide(brut.get("regle"))
    ar = age(brut.get("maj"), instant)
    if r and ar is not None and ar < REGLE_VIVANTE:
        sortie["regle"] = r
    return sortie


# ------------------------------------------------------------ le pointeur d'un joueur, vers l'atelier

def chemin_joueur(depot: Path, joueur: str) -> Path:
    return depot / DOSSIER / JOUEURS / f"{joueur}.json"


def jeton_de_la_vue(vue) -> tuple[str, str] | None:
    """(genre, jeton) du plan ou de la carte que montre la table du coin (la vue publiée), ou None : ce qu'un joueur peut
    désigner. Le plan porte son jeton ; la carte, celui de l'état public de la TV qui l'accompagne."""
    if not isinstance(vue, dict) or vue.get("genre") not in GENRES:
        return None
    genre = vue["genre"]
    contenu = vue.get(genre)
    etat = ((vue.get("ecran") or {}).get("etat") or {}) if isinstance(vue.get("ecran"), dict) else {}
    for j in (contenu.get("id") if isinstance(contenu, dict) else None, etat.get(genre)):
        if isinstance(j, str) and JETON.match(j):
            return genre, j
    return None


def poser_joueur(depot: Path, joueur: str, genre: str, jeton: str, x, y, onde: bool = False) -> dict | None:
    """Le joueur pointe en (x, y) du plan ou de la carte de ce jeton ; onde : un toucher bref, qui fait une onde. Rend ce
    qui est écrit, ou None si la position n'en est pas une."""
    if not ID_JOUEUR.match(joueur or "") or genre not in GENRES or not JETON.match(jeton or ""):
        return None
    chemin = chemin_joueur(depot, joueur)
    try:
        avant = stockage.lire_json(chemin) if chemin.stat().st_size <= OCTETS_MAX else None
    except (OSError, ValueError):
        avant = None
    avant = point_valide(avant) or {}
    maintenant_ = maintenant()
    p = point_valide({genre: jeton, "x": x, "y": y, "vu": maintenant_, "onde": avant.get("onde", 0) + (1 if onde else 0),
                      "onde_vue": maintenant_ if onde else avant.get("onde_vue")})
    if p is None:
        return None
    chemin.parent.mkdir(parents=True, exist_ok=True)
    stockage.ecrire_json_compact(chemin, p, mode=0o644)
    return p


def retirer_joueur(depot: Path, joueur: str) -> None:
    if ID_JOUEUR.match(joueur or ""):
        chemin_joueur(depot, joueur).unlink(missing_ok=True)


def lire_joueurs(depot: Path, instant: datetime | None = None) -> list:
    """Les pointeurs des joueurs encore vivants : [{joueur, plan|carte, x, y, onde, age, onde_age}], dans l'ordre des
    identifiants."""
    dossier = depot / DOSSIER / JOUEURS
    instant = instant or datetime.now()
    sortie = []
    try:
        fichiers = sorted(dossier.glob("*.json"))
    except OSError:
        return []
    for f in fichiers:
        if not ID_JOUEUR.match(f.stem):
            continue
        try:
            if f.stat().st_size > OCTETS_MAX:
                continue
            brut = stockage.lire_json(f)
        except (OSError, ValueError):
            continue
        p = point_valide(brut)
        a = age(p.get("vu"), instant) if p else None
        if p is None or a is None or a >= VIVANT:
            continue
        ond = age(p.get("onde_vue"), instant)
        sortie.append({"joueur": f.stem, **{k: v for k, v in p.items() if k not in ("vu", "onde_vue")},
                       "age": round(a, 2), "onde_age": None if ond is None else round(ond, 2)})
    return sortie
