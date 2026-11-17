"""L'habillage d'une carte détaillée ou d'un plan : le modèle de l'API décide du contenu de petite échelle, le code dessine.

- Carte : champs, vergers, haies, hameaux, sentiers, ponts, gués et bâtiments autour des lieux.
- Plan : objets, lumières, ambiance et légende des pièces, selon l'heure (jour, soir, nuit).

Ici : les schémas, les demandes, le contrôle de la réponse (le modèle se trompe : bornes, eau, murs, polygones, nombres,
clés inconnues, lieux que les joueurs ignorent) et ce que la TV en reçoit. Rien n'est enregistré ici : l'éditeur montre
la proposition, le MJ la garde ou non.

Les secrets des lieux ne partent pas au modèle : l'habillage se voit sur la TV, et la fiche visible (nom, résumé) dit déjà
ce qui se dessine (le gué, la roue arrêtée, la grange noircie). Le nom caché de l'auberge est dans ses secrets.
"""
import math
import re
import unicodedata
from collections import Counter
from datetime import datetime
from typing import Callable

from commun import deplacement

# Au-delà, une parcelle de 400 m ne fait plus un pixel : les champs automatiques autour des lieux suffisent.
KM_CASE_MAX = 1.0

CULTURES = ("blé", "seigle", "orge", "avoine", "pré", "labour", "lin", "jachère")
SYNONYMES_CULTURES = {"froment": "blé", "prairie": "pré", "foin": "pré", "pature": "pré", "herbage": "pré", "friche": "jachère",
                      "laboure": "labour", "terre-labouree": "labour", "chanvre": "lin"}
BATIMENTS_FERME = ("logis", "grange", "etable")
GENRES_BATIMENTS = {
    "moulin": "moulin à eau au bord de la rivière, avec sa roue (roue : « tourne » ou « arrêtée »)",
    "ferme_brulee": "ferme ou grange incendiée, toit à moitié effondré",
    "ruine": "ruine de pierre",
    "grange": "grange isolée",
    "chapelle": "petite chapelle",
    "cabane": "cabane de bûcheron, de berger ou de pêcheur",
    "ponton": "ponton de bois au bord d'un étang ou d'une rivière",
}
ROUES = ("tourne", "arrêtée")
GENRES_CHEMINS = ("sentier", "chemin")
GENRES_PONTS = ("planches", "pierre")
MAX_CARTE = {"champs": 16, "vergers": 10, "haies": 24, "hameaux": 4, "fermes": 8, "chemins": 16, "ponts": 6, "gues": 6, "batiments": 10}
# Polygones : aire en km² (mini, maxi) et plus grande longueur en km ; et pas plus d'un tiers de la zone.
POLYGONES = {"champ": (0.05, 40.0, 16.0), "verger": (0.01, 2.5, 3.0)}

# Objets d'ambiance d'un plan : les clés de KITS_HABILLAGE (static/js/plan/modele.js, même liste, vérifiée par les tests),
# avec ce que le contrôle en attend et les genres de pièce où ils ont leur place. « table » sur un meuble porteur, « sol »
# par terre, « meuble » occupe sa case (ni sur un meuble, ni devant une porte), « libre » partout hors des murs, « coin »
# dans l'angle de deux murs, « route » une fois par pièce extérieure.
_S, _D, _G = ("salle",), ("exterieur",), ("grotte",)
OBJETS_PLAN = {
    "abreuvoir": ("meuble", "auge de pierre pour les bêtes", _D + _S),
    "borne": ("sol", "borne de pierre au bord de la route", _D),
    "botte": ("sol", "botte de foin", _S + _D),
    "bouteille": ("libre", "bouteille couchée", _S + _G),
    "buches": ("sol", "quelques bûches près d'un feu", _S + _D),
    "chandelle": ("libre", "chandelle allumée, sur une table ou un meuble", _S + _G),
    "chope": ("table", "chope de bière", _S),
    "couvert": ("table", "assiette garnie et couteau", _S),
    "crane": ("sol", "crâne", _G + _S),
    "des": ("table", "dés à jouer", _S),
    "feu-de-camp": ("meuble", "feu de camp", _D + _G),
    "flaque": ("sol", "flaque d'eau", _D + _G),
    "jarre": ("sol", "jarre de terre", _S + _G),
    "lanterne": ("libre", "lanterne allumée, posée ou pendue", _S + _D + _G),
    "legumes": ("table", "panier de légumes", _S),
    "livre": ("table", "livre ouvert", _S),
    "marmite": ("libre", "marmite, sur le feu ou une table", _S + _D),
    "ornieres": ("route", "ornières d'une route de terre, une seule par pièce extérieure", _D),
    "paille": ("sol", "paille éparse", _S + _D),
    "pain": ("table", "miche de pain", _S),
    "pichet": ("table", "pichet", _S),
    "sac": ("sol", "sac de grain ou de farine", _S + _D + _G),
    "seau": ("sol", "seau de bois", _S + _D + _G),
    "selle": ("sol", "selle de cheval", _S),
    "table-ronde": ("meuble", "petite table ronde d'une case", _S + _D),
    "tabouret": ("meuble", "tabouret", _S + _D),
    "tas-bois": ("meuble", "bûches empilées contre un mur", _D + _S),
    "toile": ("coin", "toile d'araignée dans un coin", _S + _G),
}
NOMS_GENRES = {"salle": "intérieur", "exterieur": "dehors", "grotte": "grotte"}
SYNONYMES_OBJETS = {"bougie": "chandelle", "assiette": "couvert", "verre": "chope", "biere": "chope", "cruche": "pichet",
                    "chaudron": "marmite", "foin": "botte", "bois": "tas-bois", "buche": "buches", "toile-d-araignee": "toile",
                    "panier": "legumes", "miche": "pain", "de": "des", "lampe": "lanterne"}
# Mobilier de l'atelier (plan/modele.js) : ce qui porte un objet de table, et ce qu'on enjambe ou qui pend au mur (la
# même liste que deplacement.py, vérifiée par les tests).
PORTEURS = {"table", "table-ronde", "comptoir", "etabli", "etagere", "tonneau", "caisse", "coffre", "four", "cheminee", "autel", "enclume",
            "table-banquet", "comptoir-angle", "tonneaux-empiles", "etagere-bouteilles", "bureau", "table-cartes", "table-alchimie",
            "etal", "coffre-fer"}
# Ce qui se traverse et les sols où rien ne se pose : les règles mêmes du déplacement des pions.
FRANCHISSABLES, SOLS_INFRANCHISSABLES = deplacement.FRANCHISSABLES, deplacement.SOLS_INFRANCHISSABLES
MAX_PLAN = {"objets": 160, "lumieres": 24, "par_case": 4}
HEURES = ("jour", "soir", "nuit")
AMBIANCES = {
    "jour": ({"interieur": "#b9a888", "exterieur": "#fff6e6", "force": 0.3}, (0.0, 0.45)),
    "soir": ({"interieur": "#4c5278", "exterieur": "#363f62", "force": 0.78}, (0.5, 0.9)),
    "nuit": ({"interieur": "#2a3150", "exterieur": "#1c2340", "force": 0.9}, (0.7, 0.95)),
}
COULEUR = re.compile(r"^#[0-9a-fA-F]{6}$")
RUDES, BOIS = {10, 11, 12, 13, 14}, {3, 4, 5, 15}  # montagnes, sommets, neiges, lave, terres inconnues ; forêts et jungle


# ---------------------------------------------------------------- petits outils

def num(valeur, defaut=None):
    try:
        n = float(valeur)
    except (TypeError, ValueError):
        return defaut
    return n if math.isfinite(n) else defaut


def borne(valeur, mini, maxi, defaut):
    n = num(valeur)
    return defaut if n is None else min(max(n, mini), maxi)


def angle_plie(valeur, demi_tour=False) -> float:
    """Un angle en degrés dans [-180, 180[, ou dans [-90, 90[ pour une orientation (un sillon n'a pas de sens)."""
    a = num(valeur, 0.0)
    tour = 180 if demi_tour else 360
    return round((a + tour / 2) % tour - tour / 2, 1)


def cle_simple(texte) -> str:
    t = unicodedata.normalize("NFD", str(texte or "")).encode("ascii", "ignore").decode().lower().strip()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def court(texte, limite: int) -> str:
    t = " ".join(str(texte or "").split())
    return t if len(t) <= limite else t[: limite - 1].rstrip() + "…"


def point(v):
    if isinstance(v, dict):
        v = [v.get("x"), v.get("y")]
    if isinstance(v, (list, tuple)) and len(v) >= 2:
        x, y = num(v[0]), num(v[1])
        if x is not None and y is not None:
            return (x, y)
    return None


def points(v, maxi: int) -> list:
    if not isinstance(v, list):
        return []
    sortie = []
    for brut in v[:maxi]:
        p = point(brut)
        if p and (not sortie or math.dist(p, sortie[-1]) > 0.05):
            sortie.append(p)
    return sortie


def arrondir(pts) -> list:
    return [[round(x, 2), round(y, 2)] for x, y in pts]


def aire(pts) -> float:
    n = len(pts)
    return abs(sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))) / 2


def dans_polygone(x, y, pts) -> bool:
    dedans = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            dedans = not dedans
        j = i
    return dedans


def echantillons(pts, pas: float):
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    sortie = []
    y = min(ys) + pas / 2
    while y < max(ys):
        x = min(xs) + pas / 2
        while x < max(xs):
            if dans_polygone(x, y, pts):
                sortie.append((x, y))
            x += pas
        y += pas
    return sortie


def intersection(a, b, c, d):
    """Le point où le segment ab coupe cd, ou None ; t est la position sur ab (0 en a, 1 en b)."""
    rx, ry = b[0] - a[0], b[1] - a[1]
    sx, sy = d[0] - c[0], d[1] - c[1]
    den = rx * sy - ry * sx
    if abs(den) < 1e-12:
        return None
    t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den
    u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den
    if 0 <= t <= 1 and 0 <= u <= 1:
        return (a[0] + t * rx, a[1] + t * ry, t)
    return None


def polygone_simple(pts) -> bool:
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            if intersection(a, b, pts[j], pts[(j + 1) % n]):
                return False
    return True


def enveloppe(pts) -> list:
    p = sorted(set(pts))
    if len(p) < 3:
        return p

    def tour(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    bas, haut = [], []
    for q in p:
        while len(bas) >= 2 and tour(bas[-2], bas[-1], q) <= 0:
            bas.pop()
        bas.append(q)
    for q in reversed(p):
        while len(haut) >= 2 and tour(haut[-2], haut[-1], q) <= 0:
            haut.pop()
        haut.append(q)
    return bas[:-1] + haut[:-1]


def projeter(x, y, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / l2))
    qx, qy = ax + t * dx, ay + t * dy
    return math.hypot(x - qx, y - qy), qx, qy


def chaikin(pts, iterations: int = 2) -> list:
    """Le lissage du dessin (geo.js) : les rivières et les routes passent là où elles sont peintes."""
    for _ in range(iterations):
        if len(pts) < 3:
            return pts
        q = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            q.append(tuple(0.75 * u + 0.25 * v for u, v in zip(a, b)))
            q.append(tuple(0.25 * u + 0.75 * v for u, v in zip(a, b)))
        q.append(pts[-1])
        pts = q
    return pts


def densifier(pts, pas: float = 0.8) -> list:
    sortie = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        n = max(1, math.ceil(math.dist(a, b) / pas))
        sortie += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(1, n + 1)]
    return sortie


def simplifier(pts, eps: float = 0.12) -> list:
    """Douglas-Peucker : la ligne contrôlée, sans les points ajoutés pour la vérifier."""
    if len(pts) < 3:
        return list(pts)
    garde = [False] * len(pts)
    garde[0] = garde[-1] = True
    pile = [(0, len(pts) - 1)]
    while pile:
        i, j = pile.pop()
        d, k = 0.0, -1
        for m in range(i + 1, j):
            dm = projeter(*pts[m], *pts[i], *pts[j])[0]
            if dm > d:
                d, k = dm, m
        if d > eps:
            garde[k] = True
            pile += [(i, k), (k, j)]
    return [p for p, g in zip(pts, garde) if g]


def longueur(pts) -> float:
    return sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))


class Segments:
    """Des segments rangés par carreaux de 4 cases, pour trouver vite le plus proche."""

    def __init__(self, taille: float = 4.0):
        self.taille, self.carreaux, self.tous = taille, {}, []

    def ajouter(self, a, b, info) -> None:
        seg = (a[0], a[1], b[0], b[1], info)
        self.tous.append(seg)
        t = self.taille
        for i in range(int(min(a[0], b[0]) // t), int(max(a[0], b[0]) // t) + 1):
            for j in range(int(min(a[1], b[1]) // t), int(max(a[1], b[1]) // t) + 1):
                self.carreaux.setdefault((i, j), []).append(seg)

    def proches(self, x, y, r):
        t, vus = self.taille, set()
        for i in range(int((x - r) // t), int((x + r) // t) + 1):
            for j in range(int((y - r) // t), int((y + r) // t) + 1):
                for seg in self.carreaux.get((i, j), ()):
                    if id(seg) not in vus:
                        vus.add(id(seg))
                        yield seg

    def plus_proche(self, x, y, r):
        """(distance, qx, qy, segment) du segment le plus proche à moins de r, ou None."""
        meilleur = None
        for seg in self.proches(x, y, r):
            d, qx, qy = projeter(x, y, *seg[:4])
            if d <= r and (meilleur is None or d < meilleur[0]):
                meilleur = (d, qx, qy, seg)
        return meilleur


# ---------------------------------------------------------------- la carte vue par le contrôle

class Terrain:
    """Ce que le contrôle sait d'une carte : biomes, rivières et voies telles qu'elles sont peintes, lieux posés."""

    def __init__(self, carte: dict, terrain: bytes, lieux: dict):
        self.w, self.h = int(num(carte.get("largeur"), 0)), int(num(carte.get("hauteur"), 0))
        self.km = num(carte.get("km_case"), 1.0) or 1.0
        self.terrain = terrain if len(terrain) >= self.w * self.h else b""
        self.rivieres, self.voies = Segments(), Segments()
        self.traces = []
        for tr in carte.get("traces") or []:
            if not isinstance(tr, dict) or tr.get("type") not in ("riviere", "route", "chemin"):
                continue
            brut = [tuple(num(v, 0.0) for v in p[:3]) for p in tr.get("points") or [] if isinstance(p, list) and len(p) >= 2]
            if len(brut) < 2:
                continue
            lisse = chaikin(brut)
            self.traces.append((tr["type"], tr.get("nom") or "", [(p[0], p[1]) for p in brut]))
            if tr["type"] == "riviere":
                larg = tr.get("largeur") if isinstance(tr.get("largeur"), list) and len(tr["largeur"]) >= 2 else [0.16, 0.42]
                l0, l1 = num(larg[0], 0.16), num(larg[1], 0.42)
                n = len(lisse)
                for i in range(n - 1):
                    larg = lisse[i][2] if len(lisse[i]) > 2 else l0 + (l1 - l0) * i / max(1, n - 1)
                    self.rivieres.ajouter(lisse[i][:2], lisse[i + 1][:2], max(0.05, larg) / 2)
            else:
                for i in range(len(lisse) - 1):
                    self.voies.ajouter(lisse[i][:2], lisse[i + 1][:2], tr["type"])
        # Les gués et ponts naturels : là où une voie de la carte passe une rivière ou la frôle (le lissage les écarte parfois).
        self.passages = []
        for ax, ay, bx, by, _ in self.voies.tous:
            n = max(1, math.ceil(math.dist((ax, ay), (bx, by)) / 0.25))
            for k in range(n + 1):
                r = self.rivieres.plus_proche(ax + (bx - ax) * k / n, ay + (by - ay) * k / n, 1.0)
                if r and r[0] < r[3][4] + 0.5 and all(math.dist(r[1:3], q) > 0.3 for q in self.passages[-6:]):
                    self.passages.append((r[1], r[2]))
        self.lieux = []
        for m in carte.get("marqueurs") or []:
            fiche = lieux.get(m.get("lieu")) if isinstance(m, dict) else None
            if fiche:
                self.lieux.append({"id": m["lieu"], "x": num(m.get("x"), 0.0), "y": num(m.get("y"), 0.0), "taille": num(m.get("taille"), 1.0) or 1.0,
                                   "fiche": fiche, "inconnu": not fiche.get("connu") or bool(m.get("cache"))})

    def biome(self, x, y):
        xi, yi = int(math.floor(x)), int(math.floor(y))
        if not self.terrain or not (0 <= xi < self.w and 0 <= yi < self.h):
            return None
        return self.terrain[yi * self.w + xi]

    def lac(self, x, y) -> bool:
        return self.biome(x, y) == 0

    def lac_proche(self, x, y, r: float):
        """Le centre de la case d'eau dormante la plus proche, à moins de r cases, ou None."""
        meilleur = None
        for yi in range(int(y - r), int(y + r) + 1):
            for xi in range(int(x - r), int(x + r) + 1):
                if self.biome(xi + 0.5, yi + 0.5) == 0:
                    d = math.hypot(xi + 0.5 - x, yi + 0.5 - y)
                    if d <= r and (meilleur is None or d < meilleur[0]):
                        meilleur = (d, (xi + 0.5, yi + 0.5))
        return meilleur[1] if meilleur else None

    def riviere(self, x, y, r: float = 4.0):
        return self.rivieres.plus_proche(x, y, r)

    def sur_eau(self, x, y, marge: float = 0.15) -> bool:
        if self.lac(x, y):
            return True
        r = self.riviere(x, y, 3.0)
        return bool(r and r[0] < r[3][4] + marge)

    def normale_riviere(self, seg) -> float:
        """L'angle (degrés) qui traverse la rivière à ce segment."""
        ax, ay, bx, by, _ = seg
        return math.degrees(math.atan2(bx - ax, -(by - ay)))

    def croisements(self, a, b) -> list:
        sortie = []
        for seg in self.rivieres.proches((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, math.dist(a, b) / 2 + 1):
            p = intersection(a, b, seg[:2], seg[2:4])
            if p:
                sortie.append((p[0], p[1], seg))
        return sortie


# ---------------------------------------------------------------- demande : carte

def _objet(proprietes: dict) -> dict:
    return {"type": "object", "additionalProperties": False, "required": list(proprietes), "properties": proprietes}


_NB, _TX = {"type": "number"}, {"type": "string"}
_PTS = {"type": "array", "items": {"type": "array", "items": _NB, "minItems": 2, "maxItems": 2}}

SCHEMA_CARTE = _objet({
    "taille_parcelle_m": _NB,
    "champs": {"type": "array", "items": _objet({"lieu": _TX, "zone": _PTS, "orientation": _NB, "cultures": {"type": "array", "items": {"type": "string", "enum": list(CULTURES)}},
                                                  "haies": _NB, "raison": _TX})},
    "vergers": {"type": "array", "items": _objet({"lieu": _TX, "zone": _PTS, "orientation": _NB, "essence": _TX, "raison": _TX})},
    "haies": {"type": "array", "items": _objet({"points": _PTS, "raison": _TX})},
    "hameaux": {"type": "array", "items": _objet({"nom": _TX, "lieu": _TX, "raison": _TX, "fermes": {"type": "array", "items": _objet({
        "x": _NB, "y": _NB, "angle": _NB, "batiments": {"type": "array", "items": {"type": "string", "enum": list(BATIMENTS_FERME)}}})}})},
    "chemins": {"type": "array", "items": _objet({"lieu": _TX, "genre": {"type": "string", "enum": list(GENRES_CHEMINS)}, "points": _PTS, "raison": _TX})},
    "ponts": {"type": "array", "items": _objet({"x": _NB, "y": _NB, "longueur": _NB, "genre": {"type": "string", "enum": list(GENRES_PONTS)}, "raison": _TX})},
    "gues": {"type": "array", "items": _objet({"x": _NB, "y": _NB, "raison": _TX})},
    "batiments": {"type": "array", "items": _objet({"lieu": _TX, "genre": {"type": "string", "enum": list(GENRES_BATIMENTS)}, "x": _NB, "y": _NB, "angle": _NB,
                                                     "roue": {"type": "string", "enum": ["", *ROUES]}, "raison": _TX})},
})


def grille_carte(t: Terrain, zone: dict, lettres: str, colonnes: int = 96) -> tuple[str, float]:
    """La zone en lettres de terrain, avec par-dessus les rivières (%), les routes (=), les chemins (:) et les lieux (@)."""
    x0, y0, x1, y1 = zone["x0"], zone["y0"], zone["x1"], zone["y1"]
    pas = next(p for p in (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 1e9) if (x1 - x0) / p <= colonnes + 8)
    lignes = []
    y = y0
    while y < y1:
        ligne = []
        x = x0
        while x < x1:
            cx, cy = x + pas / 2, y + pas / 2
            car = None
            if any(math.hypot(l["x"] - cx, l["y"] - cy) < pas * 0.6 for l in t.lieux):
                car = "@"
            elif t.riviere(cx, cy, pas * 0.55) is not None:
                car = "%"
            elif (v := t.voies.plus_proche(cx, cy, pas * 0.55)) is not None:
                car = "=" if v[3][4] == "route" else ":"
            if car is None:
                b = t.biome(cx, cy)
                car = lettres[b] if b is not None and b < len(lettres) else " "
            ligne.append(car)
            x += pas
        lignes.append(f"{y:6.1f} {''.join(ligne)}")
        y += pas
    return "\n".join(lignes), pas


def _trace_texte(pts, zone, maxi: int = 60) -> str:
    dedans = [p for p in pts if zone["x0"] - 2 <= p[0] <= zone["x1"] + 2 and zone["y0"] - 2 <= p[1] <= zone["y1"] + 2]
    if len(dedans) > maxi:
        dedans = dedans[:: math.ceil(len(dedans) / maxi)]
    return "[" + ", ".join(f"[{x:.1f}, {y:.1f}]" for x, y in dedans) + "]"


def demande_carte(t: Terrain, carte: dict, zone: dict, idee: str, lettres: str, noms_biomes: list, types_lieux: dict) -> tuple[str, dict]:
    """Le texte envoyé au modèle, et la table des références de lieux (L1, L2…) vers leurs identifiants."""
    grille, pas = grille_carte(t, zone, lettres)
    refs, lignes_lieux = {}, []
    marge = 6
    for l in t.lieux:
        if not (zone["x0"] - marge <= l["x"] <= zone["x1"] + marge and zone["y0"] - marge <= l["y"] <= zone["y1"] + marge):
            continue
        ref = f"L{len(refs) + 1}"
        refs[ref] = l["id"]
        f = l["fiche"]
        lignes_lieux.append(f"- {ref} « {court(f.get('nom'), 80)} » ({types_lieux.get(f.get('type'), f.get('type') or 'lieu')}), x {l['x']:.1f}, y {l['y']:.1f}, "
                            f"{'INCONNU des joueurs' if l['inconnu'] else 'connu des joueurs'} : {court(f.get('resume'), 500) or 'pas de description'}")
    noms_traces = {"route": "route", "chemin": "chemin", "riviere": "rivière"}
    traces = [f"- {noms_traces[genre]}{' « ' + court(nom, 40) + ' »' if nom else ''} : {_trace_texte(pts, zone)}"
              for genre, nom, pts in t.traces if any(zone["x0"] - 2 <= x <= zone["x1"] + 2 and zone["y0"] - 2 <= y <= zone["y1"] + 2 for x, y in pts)]
    km = t.km
    parcelle = 420 / (km * 1000)
    legende = ", ".join(f"{lettres[i]} {n.lower()}" for i, n in enumerate(noms_biomes))
    km2 = 1 / (km * km)

    # Les tailles qui se voient au dessin, comptées en parcelles de 420 m.
    def cases(n) -> str:
        return f"{max(1, round(n * parcelle))}"
    texte = "\n".join([
        f"Habille la carte détaillée « {court(carte.get('nom'), 80)} » ({km:g} km par case) : tu choisis les détails de petite échelle autour "
        "des lieux, le code les peint vus de dessus (relief peint, style battle map). Tu ne changes jamais la géographie : pas de rivière, "
        "de route, de forêt ni de lieu nouveaux ; seulement des champs, vergers, haies, hameaux de quelques fermes, sentiers, ponts, gués, "
        "et des bâtiments aux lieux existants, fidèles à leur fiche.",
        f"Zone à habiller : x de {zone['x0']:.1f} à {zone['x1']:.1f}, y de {zone['y0']:.1f} à {zone['y1']:.1f} (en cases ; x vers la droite, "
        f"y vers le bas, le nord en haut). Une case fait {km * 1000:.0f} m ; 1 km² = {km2:.1f} cases².",
        "", "Lieux :", *(lignes_lieux or ["- aucun lieu dans la zone"]),
        "", "Tracés de la carte (points en cases) :", *(traces or ["- aucun"]),
        "", f"Grille du terrain : une lettre pour {pas:.1f} case(s) de côté, chaque ligne commence par son y ; x croît de {pas:.1f} par lettre "
        f"à partir de {zone['x0']:.1f}. Légende : {legende} ; par-dessus : % rivière, = route, : chemin, @ lieu. Les cases c sont déjà "
        "cultivées par le dessin : un champ n'y sert qu'à choisir les cultures ou l'orientation.", "", grille, "",
        f"Idée du MJ : {court(idee, 600)}" if idee else "",
        "Règles :",
        "- Toutes les coordonnées en cases, une décimale, dans la zone. Jamais sur l'eau (~ et %), ni sur une route ; rien en terres inconnues (b).",
        "- Les champs vivent autour des lieux habités qui travaillent la terre (ferme, moulin, auberge, village), en bandes le long des routes ; "
        "pas de culture autour d'une ruine abandonnée (des jachères tout au plus). Un champ ne traverse ni une rivière ni une route : "
        "découpe la zone en polygones de part et d'autre.",
        f"- champs : polygone simple de 4 à 14 sommets ; une zone mesure {cases(6)} à {cases(25)} cases de long sur {cases(4)} à {cases(12)} "
        "de large (le dessin y range ses parcelles : en dessous, il n'en tient que deux ou trois). Préfère quelques grandes zones d'un seul "
        "tenant (les terres d'un lieu ou d'un hameau, de part et d'autre de la route) à beaucoup de petites ; deux zones ne se chevauchent pas. "
        f"orientation des sillons en degrés (souvent celle de la route voisine) ; cultures parmi {', '.join(CULTURES)} (répète une culture pour la rendre plus fréquente) ; haies de 0 (openfield) à 1 (bocage). "
        f"taille_parcelle_m : la largeur d'une parcelle en mètres, 300 à 600 (420 par défaut, soit {parcelle:.1f} case).",
        f"- vergers : clos de {cases(2)} à {cases(3)} cases de côté, tout près des maisons (essence : pommiers, poiriers, pruniers, noyers…).",
        "- haies : lignes de 2 à 15 points, le long des routes et entre les champs, à au moins une demi-case de la route.",
        "- hameaux : 2 à 6 fermes sans nom (nom vide, sauf si le MJ en donne un), chacune x, y au centre de sa cour, angle du logis en degrés, "
        "bâtiments parmi logis, grange, etable ; une ferme dessinée fait 3 cases de large : son centre à 2 cases au moins de la route et des "
        "rivières, à 3 cases au moins d'une autre ferme, jamais sur un lieu.",
        "- chemins : sentiers ou chemins de terre qui relient fermes, lieux et route ; là où un sentier passe une rivière, mets un pont ou un gué.",
        "- ponts et gues : x, y sur la rivière, là où passe une route ou un sentier ; longueur du pont en cases. Le code aligne l'ouvrage sur l'eau.",
        "- batiments : seulement pour un lieu existant dont la fiche décrit le bâtiment, à moins de deux cases de son repère ; genre parmi "
        + " ; ".join(f"{k} ({v})" for k, v in GENRES_BATIMENTS.items()) + ". roue : seulement pour un moulin, d'après sa fiche.",
        "- lieu : la référence (L1, L2…) du lieu auquel l'élément se rattache, vide sinon. Ce qui touche un lieu INCONNU des joueurs sera caché sur la TV : "
        "reste discret autour.",
        "- raison : une phrase courte pour le MJ (quinze mots au plus), tirée de la fiche quand c'est possible. Rien qui contredise une fiche ni le canon.",
        "- En tout, au plus 10 zones de champs, 6 vergers, 10 haies, 3 hameaux, 10 sentiers, 4 ponts, 4 gués et 6 bâtiments : peu de grandes "
        "zones valent mieux que beaucoup de petites.",
        f"- Densité : à moins de {cases(6)} cases d'un lieu habité ou d'un hameau, les champs couvrent l'essentiel de la plaine ; au-delà, "
        "prés, bosquets et bois. Les abords des villages sont déjà cultivés par le dessin ; ailleurs, tout vient de toi.",
    ])
    return texte, refs


# ---------------------------------------------------------------- contrôle : carte

class _Bilan:
    def __init__(self):
        self.ecartes, self.retouches = Counter(), Counter()

    def ecarter(self, raison: str) -> None:
        self.ecartes[raison] += 1

    def retoucher(self, raison: str) -> None:
        self.retouches[raison] += 1

    def remarques(self) -> list[str]:
        return ([f"{n} écarté{'s' if n > 1 else ''} : {r}" for r, n in self.ecartes.most_common()]
                + [f"{n} retouché{'s' if n > 1 else ''} : {r}" for r, n in self.retouches.most_common()])


def _liste(brut: dict, cle: str, maxi: int, bilan: _Bilan) -> list:
    v = brut.get(cle) if isinstance(brut, dict) else None
    v = [e for e in v if isinstance(e, dict)] if isinstance(v, list) else []
    if len(v) > maxi:
        bilan.ecarter(f"{cle} en trop")
    return v[:maxi]


def numero_suivant(habillage, prefixe: str) -> int:
    """Les identifiants continuent ceux de l'habillage déjà gardé : une proposition peut s'y ajouter sans collision."""
    plus = 0
    if isinstance(habillage, dict):
        for liste in habillage.values():
            for e in liste if isinstance(liste, list) else []:
                m = re.fullmatch(rf"{prefixe}(\d+)", str(e.get("id", ""))) if isinstance(e, dict) else None
                if m:
                    plus = max(plus, int(m.group(1)))
    return plus + 1


class ControleCarte:
    def __init__(self, t: Terrain, zone: dict, refs: dict, finir: Callable[[str], str]):
        self.t, self.zone, self.refs, self.finir = t, zone, refs, finir
        self.bilan = _Bilan()
        self.par_id = {l["id"]: l for l in t.lieux}
        self.par_nom = {cle_simple(l["fiche"].get("nom")): l["id"] for l in t.lieux}
        # Autour d'un lieu inconnu, ce qui le touche se cache : son repère et un rayon d'environ 400 m.
        self.rayon_secret = min(4.0, max(1.5, 0.4 / t.km))
        # Les tailles qui se voient au dessin, en parcelles de 420 m : 3 pour un verger, 20 pour une zone de champs.
        self.verger_min, self.champ_min = 3 * (0.42 / t.km) ** 2, 20 * (0.42 / t.km) ** 2

    def texte(self, valeur, limite: int = 240) -> str:
        return court(self.finir(str(valeur or "")), limite) if valeur else ""

    def lieu(self, valeur):
        v = str(valeur or "").strip()
        if not v:
            return None
        if v.upper() in self.refs:
            return self.refs[v.upper()]
        if v in self.par_id:
            return v
        return self.par_nom.get(cle_simple(v))

    def dans_zone(self, x, y, marge: float = 0.0) -> bool:
        z = self.zone
        return z["x0"] - marge <= x <= z["x1"] + marge and z["y0"] - marge <= y <= z["y1"] + marge

    def touche_secret(self, lieu, pts, polygone: bool = False) -> bool:
        if lieu and self.par_id.get(lieu, {}).get("inconnu"):
            return True
        for l in self.t.lieux:
            if not l["inconnu"]:
                continue
            r = self.rayon_secret + l["taille"] * 0.3
            if any(math.hypot(x - l["x"], y - l["y"]) < r for x, y in pts):
                return True
            if polygone and dans_polygone(l["x"], l["y"], pts):
                return True
            if len(pts) > 1 and any(projeter(l["x"], l["y"], *a, *b)[0] < r for a, b in zip(pts, pts[1:] + (pts[:1] if polygone else []))):
                return True
        return False

    def marquer(self, e: dict, pts, polygone: bool = False, cache=False) -> dict:
        if cache is True or self.touche_secret(e.get("lieu"), pts, polygone):
            e["cache"] = True
        if not e.get("lieu"):
            e.pop("lieu", None)
        if not e.get("raison"):
            e.pop("raison", None)
        return e

    def polygone(self, valeur, sorte: str, autres: list = ()):
        pts = points(valeur, 60)
        if len(pts) >= 2 and math.dist(pts[0], pts[-1]) < 0.05:
            pts.pop()
        if len(pts) < 3 or aire(pts) < 1e-6:
            self.bilan.ecarter("polygone invalide")
            return None
        if len(pts) > 40:
            pts = simplifier(pts + pts[:1], 0.25)[:-1]
        z = self.zone
        serre = [(min(max(x, z["x0"]), z["x1"]), min(max(y, z["y0"]), z["y1"])) for x, y in pts]
        if aire(serre) < 0.6 * aire(pts):
            self.bilan.ecarter("hors de la zone")
            return None
        if serre != pts:
            self.bilan.retoucher("ramené dans la zone")
        # Trop petit pour le dessin (deux ou trois parcelles, quelques arbres) : agrandi autour de son centre, sauf s'il
        # mord alors sur un autre champ.
        mini_dessin, k_max = (self.verger_min, 3.0) if sorte == "verger" else (self.champ_min, 1.5)
        if 0 < aire(serre) < mini_dessin:
            k = min(k_max, math.sqrt(mini_dessin / aire(serre)))
            cx, cy = sum(p[0] for p in serre) / len(serre), sum(p[1] for p in serre) / len(serre)
            grand = [(min(max(cx + (x - cx) * k, z["x0"]), z["x1"]), min(max(cy + (y - cy) * k, z["y0"]), z["y1"])) for x, y in serre]
            dedans = [(x, y) for x, y in echantillons(grand, 0.7)]
            if not dedans or sum(any(dans_polygone(x, y, a) for a in autres) for x, y in dedans) <= 0.15 * len(dedans):
                serre = grand
                self.bilan.retoucher(f"{sorte} agrandi pour se voir")
        pts = serre
        if not polygone_simple(pts):
            env = enveloppe(pts)
            if len(env) < 3 or aire(env) > 1.6 * aire(pts):
                self.bilan.ecarter("polygone croisé")
                return None
            pts = env
            self.bilan.retoucher("polygone redressé")
        km2 = aire(pts) * self.t.km ** 2
        mini, maxi, diam = POLYGONES[sorte]
        etendue = max(math.dist(a, b) for a in pts for b in pts) * self.t.km
        zone_aire = (z["x1"] - z["x0"]) * (z["y1"] - z["y0"])
        if km2 < mini:
            self.bilan.ecarter(f"{sorte} trop petit")
            return None
        if km2 > maxi or etendue > diam or aire(pts) > zone_aire / 3:
            self.bilan.ecarter(f"{sorte} démesuré")
            return None
        # Échantillons : un polygone sur l'eau, en montagne ou dans les bois n'est pas un champ.
        total = eau = rude = bois = 0
        for x, y in echantillons(pts, max(0.5, math.sqrt(aire(pts) / 1500))):
            total += 1
            b = self.t.biome(x, y)
            if b == 0 or self.t.sur_eau(x, y, 0.0):
                eau += 1
            elif b in RUDES:
                rude += 1
            elif b in BOIS:
                bois += 1
        if total and (eau / total > 0.25 or (eau + rude) / total > 0.4):
            self.bilan.ecarter(f"{sorte} sur l'eau ou en montagne")
            return None
        if total and bois / total > 0.6:
            self.bilan.ecarter(f"{sorte} dans les bois")
            return None
        if autres:
            dedans = echantillons(pts, max(0.5, math.sqrt(aire(pts) / 400)))
            if dedans and sum(any(dans_polygone(x, y, a) for a in autres) for x, y in dedans) > 0.5 * len(dedans):
                self.bilan.ecarter(f"{sorte} posé sur un autre")
                return None
        return pts

    def lignes(self, valeur, couper_rivieres: bool, eviter_routes: bool) -> list:
        """Une ligne contrôlée, coupée là où elle sort de la zone, passe sur l'eau (ou sur la route, pour une haie)."""
        pts = points(valeur, 60)
        if len(pts) < 2:
            self.bilan.ecarter("ligne invalide")
            return []
        dense = densifier(pts, 0.5)
        morceaux, courant, coupe = [], [], False

        def interdit(x, y) -> bool:
            if not self.dans_zone(x, y, 0.5) or self.t.lac(x, y):
                return True
            if couper_rivieres and self.t.sur_eau(x, y, 0.2):
                return True
            if eviter_routes:
                v = self.t.voies.plus_proche(x, y, 0.5)
                if v and v[3][4] == "route" and v[0] < 0.45:
                    return True
            return False
        for p in dense:
            if interdit(*p) or (couper_rivieres and courant and self.t.croisements(courant[-1], p)):
                coupe = True
                if len(courant) >= 2:
                    morceaux.append(courant)
                courant = [] if interdit(*p) else [p]
            else:
                courant.append(p)
        if len(courant) >= 2:
            morceaux.append(courant)
        morceaux = [simplifier(m) for m in morceaux if longueur(m) >= 1.0]
        if not morceaux:
            self.bilan.ecarter("ligne sur l'eau, sur la route ou hors de la zone")
        elif coupe:
            self.bilan.retoucher("ligne coupée au bord de l'eau ou de la zone")
        return morceaux

    def ecarter_point(self, x, y, d_eau: float, d_voie: float, d_lieu: float):
        """Pousse un bâtiment hors de l'eau, de la route et du repère des lieux (quelques passes)."""
        for _ in range(4):
            bouge = False
            r = self.t.riviere(x, y, d_eau + 1.5)
            if r and r[0] < r[3][4] + d_eau:
                x, y = self._pousser(x, y, r, r[3][4] + d_eau)
                bouge = True
            v = self.t.voies.plus_proche(x, y, d_voie)
            if v and v[0] < d_voie:
                x, y = self._pousser(x, y, v, d_voie)
                bouge = True
            for l in self.t.lieux:
                d = math.hypot(x - l["x"], y - l["y"])
                lim = d_lieu + l["taille"] * 0.3
                if d < lim:
                    ux, uy = ((x - l["x"]) / d, (y - l["y"]) / d) if d > 1e-6 else (0.0, 1.0)
                    x, y = l["x"] + ux * lim, l["y"] + uy * lim
                    bouge = True
            if not bouge:
                break
        return x, y

    @staticmethod
    def _pousser(x, y, proche, distance):
        d, qx, qy, seg = proche
        if d > 1e-6:
            ux, uy = (x - qx) / d, (y - qy) / d
        else:
            ax, ay, bx, by, _ = seg
            l = math.hypot(bx - ax, by - ay) or 1
            ux, uy = -(by - ay) / l, (bx - ax) / l
        return qx + ux * distance, qy + uy * distance

    def ouvrage(self, e: dict, chemins: list):
        """Un pont ou un gué : posé sur la rivière, de préférence là où passe une voie ; None s'il est loin de l'eau."""
        p = point([e.get("x"), e.get("y")])
        if not p or not self.dans_zone(*p):
            self.bilan.ecarter("ouvrage hors de la zone")
            return None
        x, y = p
        candidats = list(self.t.passages)
        for ch in chemins:
            for a, b in zip(ch, ch[1:]):
                candidats += [(cx, cy) for cx, cy, _ in self.t.croisements(a, b)]
        proche = min(candidats, key=lambda c: math.hypot(c[0] - x, c[1] - y), default=None)
        if proche and math.hypot(proche[0] - x, proche[1] - y) <= 2.5:
            x, y = proche
        r = self.t.riviere(x, y, 2.5)
        if not r:
            self.bilan.ecarter("ouvrage loin de l'eau")
            return None
        if math.hypot(r[1] - p[0], r[2] - p[1]) > 0.3:
            self.bilan.retoucher("ouvrage posé sur la rivière")
        return r[1], r[2], self.t.normale_riviere(r[3]), r[3][4] * 2


def controler_carte(brut: dict, t: Terrain, zone: dict, refs: dict, finir: Callable[[str], str], depart: int = 1,
                    idee: str = "") -> tuple[dict, list]:
    """La réponse du modèle, contrôlée : ce qui reste est sûr à dessiner. Renvoie l'habillage et les remarques pour le MJ."""
    c = ControleCarte(t, zone, refs, finir)
    b = c.bilan
    brut = brut if isinstance(brut, dict) else {}
    hab = {"cree": datetime.now().isoformat(timespec="minutes"),
           "zone": {k: round(v, 2) for k, v in zone.items()},
           "taille_parcelle_m": round(borne(brut.get("taille_parcelle_m"), 200, 800, 420))}

    champs = []
    for e in _liste(brut, "champs", MAX_CARTE["champs"], b):
        pts = c.polygone(e.get("zone"), "champ", [ch["zone"] for ch in champs])
        if not pts:
            continue
        cultures = []
        for v in e.get("cultures") or [] if isinstance(e.get("cultures"), list) else []:
            k = cle_simple(v).rstrip("s")
            nom = next((cu for cu in CULTURES if cle_simple(cu) == k), SYNONYMES_CULTURES.get(k))
            if nom:
                cultures.append(nom)
        champs.append(c.marquer({"lieu": c.lieu(e.get("lieu")), "zone": arrondir(pts), "orientation": angle_plie(e.get("orientation"), True),
                                 "cultures": cultures[:12] or ["blé", "pré"], "haies": round(borne(e.get("haies"), 0, 1, 0.3), 2),
                                 "raison": c.texte(e.get("raison"))}, pts, True, e.get("cache")))
    vergers = []
    for e in _liste(brut, "vergers", MAX_CARTE["vergers"], b):
        pts = c.polygone(e.get("zone"), "verger")
        if not pts:
            continue
        vergers.append(c.marquer({"lieu": c.lieu(e.get("lieu")), "zone": arrondir(pts), "orientation": angle_plie(e.get("orientation"), True),
                                  "essence": c.texte(e.get("essence"), 40) or "pommiers", "raison": c.texte(e.get("raison"))}, pts, True, e.get("cache")))

    haies = []
    for e in _liste(brut, "haies", MAX_CARTE["haies"], b):
        for m in c.lignes(e.get("points"), couper_rivieres=True, eviter_routes=True):
            haies.append(c.marquer({"points": arrondir(m), "raison": c.texte(e.get("raison"))}, m, False, e.get("cache")))

    chemins = []
    for e in _liste(brut, "chemins", MAX_CARTE["chemins"], b):
        genre = e.get("genre") if e.get("genre") in GENRES_CHEMINS else "sentier"
        for m in c.lignes(e.get("points"), couper_rivieres=False, eviter_routes=False):
            chemins.append((m, c.marquer({"lieu": c.lieu(e.get("lieu")), "genre": genre, "points": arrondir(m), "raison": c.texte(e.get("raison"))},
                                         m, False, e.get("cache"))))

    def loin_des_autres(x, y, liste, d=1.5) -> bool:
        return all(math.hypot(o["x"] - x, o["y"] - y) >= d for o in liste)

    ponts, gues = [], []
    for e in _liste(brut, "ponts", MAX_CARTE["ponts"], b):
        o = c.ouvrage(e, [m for m, _ in chemins])
        if not o:
            continue
        x, y, angle, large = o
        if not loin_des_autres(x, y, ponts + gues):
            b.ecarter("ouvrage en double")
            continue
        genre = e.get("genre") if e.get("genre") in GENRES_PONTS else ("pierre" if large > 1.0 else "planches")
        ponts.append(c.marquer({"x": round(x, 2), "y": round(y, 2), "angle": round(angle, 1),
                                "longueur": round(borne(e.get("longueur"), large + 0.9, 4.0, large + 1.2), 2), "genre": genre,
                                "raison": c.texte(e.get("raison"))}, [(x, y)], False, e.get("cache")))
    for e in _liste(brut, "gues", MAX_CARTE["gues"], b):
        o = c.ouvrage(e, [m for m, _ in chemins])
        if not o:
            continue
        x, y, angle, _ = o
        if not loin_des_autres(x, y, ponts + gues):
            b.ecarter("ouvrage en double")
            continue
        gues.append(c.marquer({"x": round(x, 2), "y": round(y, 2), "angle": round(angle, 1), "raison": c.texte(e.get("raison"))},
                              [(x, y)], False, e.get("cache")))
    # Un sentier qui passe une rivière sans ouvrage : une passerelle de planches là où il la coupe.
    for m, e in chemins:
        for a, bb in zip(m, m[1:]):
            for x, y, seg in t.croisements(a, bb):
                if loin_des_autres(x, y, ponts + gues):
                    large = seg[4] * 2
                    ponts.append(c.marquer({"x": round(x, 2), "y": round(y, 2), "angle": round(t.normale_riviere(seg), 1),
                                            "longueur": round(large + 1.2, 2), "genre": "planches" if large <= 1.0 else "pierre",
                                            "raison": "Passerelle ajoutée là où le sentier passe l'eau."}, [(x, y)], False, e.get("cache")))
                    b.retoucher("passerelle ajoutée sur un sentier")

    hameaux, fermes_posees = [], []
    for e in _liste(brut, "hameaux", MAX_CARTE["hameaux"], b):
        fermes = []
        for f in (e.get("fermes") if isinstance(e.get("fermes"), list) else [])[: MAX_CARTE["fermes"]]:
            p = point([f.get("x"), f.get("y")]) if isinstance(f, dict) else None
            if not p or not c.dans_zone(*p):
                b.ecarter("ferme hors de la zone")
                continue
            x, y = c.ecarter_point(*p, d_eau=1.8, d_voie=2.0, d_lieu=1.8)
            if math.dist((x, y), p) > 0.2:
                b.retoucher("ferme écartée de la route, de l'eau ou d'un lieu")
            if t.sur_eau(x, y, 0.5) or not c.dans_zone(x, y) or t.biome(x, y) in RUDES:
                b.ecarter("ferme sur l'eau ou en montagne")
                continue
            if not loin_des_autres(x, y, fermes_posees, 2.6):
                b.ecarter("ferme collée à une autre")
                continue
            bat = [v for v in (f.get("batiments") or []) if v in BATIMENTS_FERME][:3] if isinstance(f.get("batiments"), list) else []
            ferme = {"x": round(x, 2), "y": round(y, 2), "angle": angle_plie(f.get("angle")), "batiments": bat or ["logis", "grange"]}
            fermes.append(ferme)
            fermes_posees.append(ferme)
        if not fermes:
            continue
        # Pas de toponyme inventé : un hameau ne garde que le nom que le MJ a donné dans son idée.
        nom = c.texte(e.get("nom"), 40) or None
        if nom and cle_simple(nom) not in cle_simple(idee):
            nom = None
            b.retoucher("nom de hameau inventé retiré")
        hameaux.append(c.marquer({"lieu": c.lieu(e.get("lieu")), "nom": nom, "fermes": fermes, "raison": c.texte(e.get("raison"))},
                                 [(f["x"], f["y"]) for f in fermes], False, e.get("cache")))

    batiments = []
    for e in _liste(brut, "batiments", MAX_CARTE["batiments"], b):
        genre = e.get("genre")
        p = point([e.get("x"), e.get("y")])
        if genre not in GENRES_BATIMENTS or not p or not c.dans_zone(*p):
            b.ecarter("bâtiment inconnu ou hors de la zone")
            continue
        lieu = c.lieu(e.get("lieu"))
        if not lieu:
            proche = min(t.lieux, key=lambda l: math.hypot(l["x"] - p[0], l["y"] - p[1]), default=None)
            lieu = proche["id"] if proche and math.hypot(proche["x"] - p[0], proche["y"] - p[1]) <= 4 else None
        repere = c.par_id.get(lieu)
        if not repere or math.hypot(repere["x"] - p[0], repere["y"] - p[1]) > max(4.0, 1.0 / t.km):
            b.ecarter("bâtiment sans lieu ou loin de son lieu")
            continue
        x, y = p
        angle = angle_plie(e.get("angle"))
        if genre in ("moulin", "ponton"):
            # Le moulin a sa roue dans l'eau, le ponton s'avance dessus : on les cale contre la rivière la plus proche.
            r = t.riviere(x, y, 4.0)
            if r:
                d_voulue = r[3][4] + (0.75 if genre == "moulin" else 0.3)
                if abs(r[0] - d_voulue) > 0.3:
                    x, y = c._pousser(x, y, r, d_voulue)
                    b.retoucher(f"{genre} calé contre l'eau")
                # Une route qui longe la rivière : le bâtiment passe sur l'autre rive s'il y est plus au large.
                def voie(px, py):
                    v = t.voies.plus_proche(px, py, 2.0)
                    return v[0] if v else 2.0
                ox, oy = 2 * r[1] - x, 2 * r[2] - y
                if voie(x, y) < 0.8 and voie(ox, oy) > voie(x, y) and c.dans_zone(ox, oy) and not t.lac(ox, oy):
                    x, y = ox, oy
                    b.retoucher(f"{genre} passé sur l'autre rive, loin de la route")
                # La roue (côté nord du bâtiment, comme le dessine la maquette) regarde la rivière.
                angle = round(math.degrees(math.atan2(r[1] - x, -(r[2] - y))), 1)
            elif genre == "ponton" and (eau := t.lac_proche(x, y, 3)):
                # Au bord d'un étang : le ponton part de la rive et s'avance vers l'eau.
                ex, ey = eau
                d = math.hypot(ex - x, ey - y) or 1.0
                ux, uy = (ex - x) / d, (ey - y) / d
                x, y = ex - ux * 0.8, ey - uy * 0.8
                angle = round(math.degrees(math.atan2(uy, ux)), 1)
                b.retoucher("ponton posé sur la rive")
            else:
                b.ecarter(f"{genre} loin de l'eau")
                continue
        else:
            x, y = c.ecarter_point(x, y, d_eau=1.0, d_voie=0.9, d_lieu=0.0)
            if t.sur_eau(x, y, 0.3):
                b.ecarter("bâtiment sur l'eau")
                continue
        bat = {"lieu": lieu, "genre": genre, "x": round(x, 2), "y": round(y, 2), "angle": angle, "raison": c.texte(e.get("raison"))}
        if genre == "moulin":
            roue = cle_simple(e.get("roue"))
            bat["roue"] = "arrêtée" if roue.startswith(("arret", "immobile", "a-l-arret", "bloque")) else "tourne"
        batiments.append(c.marquer(bat, [(x, y)], False, e.get("cache")))

    hab |= {"champs": champs, "vergers": vergers, "haies": haies, "hameaux": hameaux, "chemins": [e for _, e in chemins],
            "ponts": ponts, "gues": gues, "batiments": batiments}
    n = depart
    for cle in ("champs", "vergers", "haies", "hameaux", "chemins", "ponts", "gues", "batiments"):
        for i, e in enumerate(hab[cle]):
            hab[cle][i] = {"id": f"h{n}", **e}
            n += 1
    return hab, b.remarques()


# ---------------------------------------------------------------- ce que la TV reçoit d'une carte

def _pts_surs(v, ferme: bool):
    pts = points(v, 80)
    return arrondir(pts) if len(pts) >= (3 if ferme else 2) else None


def carte_tv(hab, lieux_visibles: set, visible_a: Callable[[float, float], bool]):
    """Liste blanche : ni raison, ni élément caché, ni élément d'un lieu que la TV ne montre pas ; un repère ponctuel
    (ferme, pont, gué, bâtiment) seulement hors du brouillard."""
    if not isinstance(hab, dict):
        return None

    def montre(e) -> bool:
        return isinstance(e, dict) and not e.get("cache") and (not e.get("lieu") or e.get("lieu") in lieux_visibles)

    def liste(cle):
        v = hab.get(cle)
        return [e for e in v if montre(e)] if isinstance(v, list) else []

    def nombre(v, defaut=0.0):
        return round(num(v, defaut), 2)
    sortie = {"taille_parcelle_m": round(borne(hab.get("taille_parcelle_m"), 200, 800, 420))}
    sortie["champs"] = [{"id": str(e.get("id", "")), "zone": z, "orientation": nombre(e.get("orientation")),
                         "cultures": [c for c in e.get("cultures") or [] if c in CULTURES] if isinstance(e.get("cultures"), list) else [],
                         "haies": nombre(e.get("haies"), 0.3)}
                        for e in liste("champs") if (z := _pts_surs(e.get("zone"), True))]
    sortie["vergers"] = [{"id": str(e.get("id", "")), "zone": z, "orientation": nombre(e.get("orientation")), "essence": court(e.get("essence"), 40)}
                         for e in liste("vergers") if (z := _pts_surs(e.get("zone"), True))]
    sortie["haies"] = [{"id": str(e.get("id", "")), "points": p} for e in liste("haies") if (p := _pts_surs(e.get("points"), False))]
    sortie["chemins"] = [{"id": str(e.get("id", "")), "genre": e.get("genre") if e.get("genre") in GENRES_CHEMINS else "sentier", "points": p}
                         for e in liste("chemins") if (p := _pts_surs(e.get("points"), False))]
    hameaux = []
    for e in liste("hameaux"):
        fermes = []
        for f in e.get("fermes") if isinstance(e.get("fermes"), list) else []:
            p = point([f.get("x"), f.get("y")]) if isinstance(f, dict) else None
            if p and visible_a(*p):
                bat = [v for v in f.get("batiments") or [] if v in BATIMENTS_FERME] if isinstance(f.get("batiments"), list) else []
                fermes.append({"x": round(p[0], 2), "y": round(p[1], 2), "angle": nombre(f.get("angle")), "batiments": bat})
        if fermes:
            hameaux.append({"id": str(e.get("id", "")), "nom": court(e.get("nom"), 40) or None, "fermes": fermes})
    sortie["hameaux"] = hameaux

    def ponctuels(cle, champs):
        res = []
        for e in liste(cle):
            p = point([e.get("x"), e.get("y")])
            if p and visible_a(*p):
                res.append({"id": str(e.get("id", "")), "x": round(p[0], 2), "y": round(p[1], 2),
                            **{k: (nombre(e.get(k)) if k in ("angle", "longueur") else e.get(k)) for k in champs if k in e}})
        return res
    sortie["ponts"] = [o for o in ponctuels("ponts", ("angle", "longueur", "genre")) if o.get("genre", "planches") in GENRES_PONTS]
    sortie["gues"] = ponctuels("gues", ("angle",))
    sortie["batiments"] = [o for o in ponctuels("batiments", ("genre", "angle", "roue"))
                           if o.get("genre") in GENRES_BATIMENTS and o.get("roue", "tourne") in ROUES]
    return sortie


# ---------------------------------------------------------------- demande : plan

SCHEMA_PLAN = _objet({
    "ambiance": _objet({"interieur": _TX, "exterieur": _TX, "force": _NB}),
    "lumieres": {"type": "array", "items": _objet({"x": _NB, "y": _NB, "rayon": _NB, "couleur": _TX, "intensite": _NB, "source": _TX})},
    "objets": {"type": "array", "items": _objet({"piece": {"type": "integer"}, "cle": {"type": "string"}, "case": {"type": "array", "items": {"type": "integer"}},
                                                  "decalage": {"type": "array", "items": _NB}, "rot": _NB})},
    "legende": {"type": "array", "items": _objet({"piece": {"type": "integer"}, "x": _NB, "y": _NB})},
})


class Plan:
    """Ce que le contrôle sait d'un plan : sols, pièces, murs par case, mobilier visible, portes."""

    def __init__(self, p: dict, murs: list):
        self.w, self.h = int(p["largeur"]), int(p["hauteur"])
        self.sol, self.piece, self.murs = p["sol"], p["piece"], murs
        self.pieces = {x["id"]: x for x in p.get("pieces") or [] if isinstance(x, dict) and "id" in x}
        self.occupe: dict[tuple, set] = {}
        self.meubles = []
        for o in p.get("objets") or []:
            if not isinstance(o, dict) or o.get("cache"):
                continue
            try:
                tourne = num(o.get("rot"), 0) % 180 != 0
                l, h = (num(o["h"], 1), num(o["l"], 1)) if tourne else (num(o["l"], 1), num(o["h"], 1))
                ox, oy = num(o["x"]), num(o["y"])
                cases = [(x, y) for y in range(int(oy), int(oy + h + 0.999)) for x in range(int(ox), int(ox + l + 0.999))]
            except (KeyError, TypeError):
                continue
            self.meubles.append((o.get("cle"), cases))
            for c in cases:
                self.occupe.setdefault(c, set()).add(o.get("cle"))
        # L'eau profonde et la falaise d'un plan extérieur : rien ne s'y pose, comme sur un meuble qui barre.
        for i, v in enumerate(self.sol[: self.w * self.h]):
            if isinstance(v, int) and v in SOLS_INFRANCHISSABLES:
                self.occupe.setdefault((i % self.w, i // self.w), set()).add("eau-profonde" if v == 23 else "falaise")
        self.portes = []
        self.devant_porte = set()
        for d in p.get("portes") or []:
            if not isinstance(d, dict) or (d.get("genre") == "secrete" and not d.get("decouverte")):
                continue
            x, y = int(num(d.get("x"), -1)), int(num(d.get("y"), -1))
            cases = [(x - 1, y), (x, y)] if d.get("sens") == "v" else [(x, y - 1), (x, y)]
            self.portes.append((d, cases))
            if d.get("genre") != "fenetre":
                self.devant_porte.update(cases)

    def dedans(self, x, y) -> bool:
        return 0 <= x < self.w and 0 <= y < self.h

    def sol_en(self, x, y) -> int:
        return self.sol[y * self.w + x] if self.dedans(x, y) else 0

    def piece_en(self, x, y):
        return self.piece[y * self.w + x] if self.dedans(x, y) and self.sol_en(x, y) else None

    def mur(self, x, y) -> int:
        """Les côtés murés d'une case (1 N, 2 E, 4 S, 8 O), paroi de grotte comprise."""
        m = self.murs[y * self.w + x] if self.dedans(x, y) else 15
        return (m | (m >> 4)) & 15

    def cases_de(self, ident) -> list:
        return [(i % self.w, i // self.w) for i in range(self.w * self.h) if self.piece[i] == ident and self.sol[i]]


def grille_plan(pl: Plan, lettres: dict) -> str:
    """Une lettre par case : la pièce (majuscule si le sol est libre, minuscule sous un meuble), un point hors du plan."""
    dizaines = "".join(str(x // 10) if x % 10 == 0 else " " for x in range(pl.w))
    unites = "".join(str(x % 10) for x in range(pl.w))
    lignes = [f"    {dizaines}", f"    {unites}"]
    for y in range(pl.h):
        ligne = []
        for x in range(pl.w):
            pc = pl.piece_en(x, y)
            car = lettres.get(pc, "?") if pc is not None else "."
            if pc is not None and pl.occupe.get((x, y), set()) - FRANCHISSABLES:
                car = car.lower()
            ligne.append(car)
        lignes.append(f"{y:3d} {''.join(ligne)}")
    return "\n".join(lignes)


def demande_plan(pl: Plan, p: dict, lieu: dict | None, heure: str, idee: str, types_lieux: dict) -> str:
    ordre = sorted(pl.pieces)
    lettres = {ident: chr(65 + i) if i < 26 else "?" for i, ident in enumerate(ordre)}
    lignes_pieces = []
    for ident in ordre:
        pc = pl.pieces[ident]
        cases = pl.cases_de(ident)
        if not cases:
            continue
        xs, ys = [c[0] for c in cases], [c[1] for c in cases]
        genre = {"salle": "intérieur", "grotte": "grotte", "exterieur": "extérieur"}.get(pc.get("genre") or "salle", "intérieur")
        lignes_pieces.append(f"- {lettres[ident]} = pièce {ident} « {court(pc.get('nom'), 60)} » ({genre}, {len(cases)} cases, "
                             f"de x {min(xs)} à {max(xs)}, y {min(ys)} à {max(ys)})")
    meubles = []
    for cle, cases in pl.meubles:
        xs, ys = [c[0] for c in cases], [c[1] for c in cases]
        meubles.append(f"{cle} x {min(xs)}{'-' + str(max(xs)) if max(xs) > min(xs) else ''}, y {min(ys)}{'-' + str(max(ys)) if max(ys) > min(ys) else ''}")
    portes = []
    for d, ((ax, ay), (bx, by)) in pl.portes:
        genre = {"porte": "porte", "double": "porte double", "arche": "passage", "fenetre": "fenêtre", "grille": "grille"}.get(d.get("genre"), "porte")
        portes.append(f"{genre} entre ({ax},{ay}) et ({bx},{by})")
    fiche = ""
    if lieu:
        fiche = (f"Le lieu : « {court(lieu.get('nom'), 80)} » ({types_lieux.get(lieu.get('type'), lieu.get('type') or 'lieu')}) : "
                 f"{court(lieu.get('resume'), 600) or 'pas de description'}")
    m_case = num(p.get("m_case"), 1.5) or 1.5
    conseils_heure = {
        "jour": "plein jour : peu de lumières (les feux allumés seulement), pas de chandelle sur les tables.",
        "soir": "soir : feux, lanternes et chandelles allumés là où l'on vit.",
        "nuit": "nuit : quelques braises et une ou deux lanternes, tables desservies.",
    }[heure]
    ref = AMBIANCES[heure][0]
    conseils_heure += (f" Ambiance de référence du dessin : intérieur {ref['interieur']}, extérieur {ref['exterieur']}, force "
                       f"{ref['force']:g}".replace(".", ",") + " ; ne t'en écarte que si l'idée du MJ le demande (orage, incendie, aube…).")
    return "\n".join([
        f"Habille le plan « {court(p.get('nom'), 80)} » ({pl.w} × {pl.h} cases de {f'{m_case:g}'.replace('.', ',')} m) pour une scène de {heure} : tu poses les objets "
        "d'ambiance, les lumières, l'ambiance et la légende des pièces ; le code dessine (battle map vue de dessus). Le mobilier est déjà posé.",
        fiche,
        "", "Pièces (lettres de la grille) :", *lignes_pieces,
        "", "Grille : x en colonnes (repère en tête), y en lignes ; majuscule = sol libre de la pièce, minuscule = case occupée par un meuble, "
        "point = hors du plan. Deux pièces voisines « intérieur » sont séparées par un mur ; l'extérieur n'a pas de murs.", "", grille_plan(pl, lettres),
        "", f"Mobilier : {' ; '.join(meubles) or 'aucun'}.",
        f"Portes et fenêtres (sur l'arête entre deux cases) : {' ; '.join(portes) or 'aucune'}.",
        "", "Objets que le code sait dessiner (cle : ce que c'est, où il a sa place) : "
        + " ; ".join(f"{k} : {v[1]} ({', '.join(NOMS_GENRES[g] for g in v[2])})" for k, v in OBJETS_PLAN.items()) + ".",
        f"Idée du MJ : {court(idee, 600)}" if idee else "",
        "Règles :",
        "- objets : case [x, y] entière d'une pièce, decalage [dx, dy] dans la case (0 à 1, 0,5 au centre), rot en degrés, piece : le numéro de "
        "la pièce. Les objets de table (" + ", ".join(k for k, v in OBJETS_PLAN.items() if v[0] == "table") + ") sur une case de meuble "
        "porteur (table, comptoir, établi, tonneau, caisse) ou sur une table-ronde que tu poses ; le reste par terre sur une case libre ; "
        + ", ".join(k for k, v in OBJETS_PLAN.items() if v[0] == "meuble") + " occupent leur case, jamais devant une porte. "
        "Rien dans un mur : decalage entre 0,25 et 0,75 contre un mur. "
        "Une toile se pose dans un coin entre deux murs (decalage 0 ou 1). Plusieurs objets sur une même table : décalages différents.",
        "- lumieres : x, y en cases (décimales), rayon en cases (6 pour une cheminée, 3 à 4 pour un four ou une lanterne, 2 à 2,5 pour une "
        "chandelle), couleur hexadécimale chaude, intensite 0 à 1, source : quelques mots. Une lumière par feu de cheminée ou de four, par "
        "lanterne et par chandelle allumées ; la lumière reste dans sa pièce.",
        f"- ambiance : couleurs hexadécimales de la pénombre dedans et dehors, force de 0 (plein jour) à 0,95 (nuit noire). Ici, {conseils_heure}",
        "- Les tables servies portent couverts, chopes, pichet, pain ou chandelle selon l'heure ; chaque pièce vit de ce qu'on y fait.",
        "- legende : une étiquette par pièce qui mérite d'être nommée : piece, et x, y au milieu de la pièce sur une case libre. Son texte est le "
        "nom de la pièce tel que le MJ l'a écrit, posé par le code : tu ne choisis que la place.",
        "- Fidélité : ce que dit la fiche du lieu se voit ; rien qui la contredise. Densité : une table servie porte 3 à 6 objets ; chaque pièce "
        "habitée 3 à 10 objets ; en tout 30 à 80 objets.",
    ])


# ---------------------------------------------------------------- contrôle : plan

def _couleur(v, defaut: str) -> str:
    return v if isinstance(v, str) and COULEUR.match(v) else defaut


def controler_plan(brut: dict, pl: Plan, heure: str, finir: Callable[[str], str], depart_o: int = 1, depart_l: int = 1) -> tuple[dict, list]:
    b = _Bilan()
    brut = brut if isinstance(brut, dict) else {}
    defaut, (fmin, fmax) = AMBIANCES[heure]
    amb = brut.get("ambiance") if isinstance(brut.get("ambiance"), dict) else {}
    ambiance = {"interieur": _couleur(amb.get("interieur"), defaut["interieur"]), "exterieur": _couleur(amb.get("exterieur"), defaut["exterieur"]),
                "force": round(borne(amb.get("force"), fmin, fmax, defaut["force"]), 2)}

    def texte(v, limite):
        return court(finir(str(v or "")), limite) if v else ""

    def hors_des_murs(x, y, dx, dy, marge=0.25):
        m = pl.mur(x, y)
        if m & 1:
            dy = max(dy, marge)
        if m & 4:
            dy = min(dy, 1 - marge)
        if m & 8:
            dx = max(dx, marge)
        if m & 2:
            dx = min(dx, 1 - marge)
        return dx, dy

    def cle_objet(o) -> str:
        k = cle_simple(o.get("cle"))
        return SYNONYMES_OBJETS.get(k, k)

    objets, api_porteurs, par_case, routes = [], set(), Counter(), set()
    # Les meubles d'abord : une table ronde posée par le modèle porte ensuite ses chopes.
    brutes = sorted(_liste(brut, "objets", MAX_PLAN["objets"], b), key=lambda o: OBJETS_PLAN.get(cle_objet(o), ("",))[0] != "meuble")
    for o in brutes:
        cle = cle_objet(o)
        if cle not in OBJETS_PLAN:
            b.ecarter("objet inconnu")
            continue
        sorte, _, genres = OBJETS_PLAN[cle]
        case = o.get("case")
        p = point(case) if isinstance(case, list) else None
        if not p:
            b.ecarter("objet sans case")
            continue
        x, y = int(math.floor(p[0])), int(math.floor(p[1]))
        piece = pl.piece_en(x, y)
        if piece is None:
            b.ecarter("objet hors du plan")
            continue
        if (pl.pieces.get(piece, {}).get("genre") or "salle") not in genres:
            b.ecarter("objet hors de sa place (dedans, dehors, grotte)")
            continue
        dec = point(o.get("decalage")) or (0.5, 0.5)
        dx, dy = min(max(dec[0], 0.0), 1.0), min(max(dec[1], 0.0), 1.0)
        rot = round(num(o.get("rot"), 0.0) % 360, 1)
        sous = pl.occupe.get((x, y), set()) - FRANCHISSABLES
        if sorte == "coin":
            # Le coin le plus proche du point, s'il est fermé par deux murs ; la toile s'ouvre vers la pièce.
            cx, cy = round(dx), round(dy)
            m = pl.mur(x, y)
            if not (m & (1 if cy == 0 else 4)) or not (m & (8 if cx == 0 else 2)):
                b.ecarter("toile hors d'un coin")
                continue
            dx, dy = float(cx), float(cy)
            rot = {(0, 0): 0.0, (1, 0): 90.0, (1, 1): 180.0, (0, 1): 270.0}[(cx, cy)]
        elif sorte == "route":
            genre = pl.pieces.get(piece, {}).get("genre")
            if genre != "exterieur" or piece in routes:
                b.ecarter("ornières hors d'une route")
                continue
            routes.add(piece)
            dx, dy = 0.5, 0.5
        else:
            if sorte == "meuble":
                if sous or (x, y) in api_porteurs:
                    b.ecarter("meuble sur un autre meuble")
                    continue
                if (x, y) in pl.devant_porte:
                    b.ecarter("meuble devant une porte")
                    continue
                if cle == "table-ronde":
                    dx, dy = 0.5, 0.5
                    api_porteurs.add((x, y))
            elif sorte == "table" and not (sous & PORTEURS or (x, y) in api_porteurs):
                b.ecarter("objet de table posé par terre")
                continue
            elif sorte == "sol" and (sous - {"stalle"} or (x, y) in api_porteurs):
                b.ecarter("objet posé sur un meuble")
                continue
            ndx, ndy = hors_des_murs(x, y, dx, dy)
            if (ndx, ndy) != (dx, dy):
                b.retoucher("objet écarté du mur")
            dx, dy = ndx, ndy
        if par_case[(x, y)] >= MAX_PLAN["par_case"] or any(
                o2["cle"] == cle and o2["case"] == [x, y] and math.hypot(o2["decalage"][0] - dx, o2["decalage"][1] - dy) < 0.2 for o2 in objets):
            b.ecarter("objet en double")
            continue
        par_case[(x, y)] += 1
        objets.append({"piece": piece, "cle": cle, "case": [x, y], "decalage": [round(dx, 2), round(dy, 2)], "rot": rot})

    lumieres = []
    for l in _liste(brut, "lumieres", MAX_PLAN["lumieres"], b):
        p = point([l.get("x"), l.get("y")])
        if not p:
            b.ecarter("lumière sans position")
            continue
        if not (-0.5 <= p[0] <= pl.w + 0.5 and -0.5 <= p[1] <= pl.h + 0.5):
            b.ecarter("lumière hors du plan")
            continue
        x, y = min(max(p[0], 0.05), pl.w - 0.05), min(max(p[1], 0.05), pl.h - 0.05)
        cx, cy = int(x), int(y)
        piece = pl.piece_en(cx, cy)
        if piece is None:
            b.ecarter("lumière hors du plan")
            continue
        dx, dy = hors_des_murs(cx, cy, x - cx, y - cy, 0.2)
        x, y = cx + dx, cy + dy
        if any(math.hypot(l2["x"] - x, l2["y"] - y) < 0.4 for l2 in lumieres):
            b.ecarter("lumière en double")
            continue
        lumieres.append({"piece": piece, "x": round(x, 2), "y": round(y, 2), "rayon": round(borne(l.get("rayon"), 0.8, 8.0, 3.0), 2),
                         "couleur": _couleur(l.get("couleur"), "#ffb15e"), "intensite": round(borne(l.get("intensite"), 0.1, 1.0, 0.8), 2),
                         "source": texte(l.get("source"), 80)})

    legende, nommees = [], set()
    noms = {cle_simple(pc.get("nom")): ident for ident, pc in pl.pieces.items()}
    for e in _liste(brut, "legende", 40, b):
        ident = e.get("piece")
        if ident not in pl.pieces:
            ident = int(ident) if re.fullmatch(r"\d+", str(ident or "")) and int(ident) in pl.pieces else noms.get(cle_simple(ident))
        if ident is None or ident in nommees:
            b.ecarter("légende sans pièce ou en double")
            continue
        cases = pl.cases_de(ident)
        if not cases:
            continue
        p = point([e.get("x"), e.get("y")])
        if not p or pl.piece_en(int(p[0]), int(p[1])) != ident:
            mx, my = sum(c[0] for c in cases) / len(cases) + 0.5, sum(c[1] for c in cases) / len(cases) + 0.5
            c = min(cases, key=lambda c: math.hypot(c[0] + 0.5 - mx, c[1] + 0.5 - my))
            p = (c[0] + 0.5, c[1] + 0.5)
            b.retoucher("légende ramenée dans sa pièce")
        nommees.add(ident)
        # Le texte est le nom de la pièce écrit par le MJ, jamais un nom proposé par le modèle (il partirait sur la TV).
        legende.append({"piece": ident, "texte": court(pl.pieces[ident].get("nom"), 40), "x": round(p[0], 2), "y": round(p[1], 2)})

    objets = [{"id": f"o{depart_o + i}", **o} for i, o in enumerate(objets)]
    lumieres = [{"id": f"l{depart_l + i}", **{k: v for k, v in l.items() if k != "source" or v}} for i, l in enumerate(lumieres)]
    return ({"cree": datetime.now().isoformat(timespec="minutes"), "heure": heure, "ambiance": ambiance,
             "lumieres": lumieres, "objets": objets, "legende": legende}, b.remarques())


# Le sang d'un plan (plan.habillage.sang, posé à la main : static/js/plan/sang.js) : ces formes et ces teintes, pas d'autres.
FORMES_SANG = ("flaque", "eclaboussure", "gouttes", "trainee")
TEINTES_SANG = ("rouge", "noir", "vert", "bleu")
SANG_MAX = 500


def _sang_tv(hab: dict, revele: Callable[[float, float], bool]) -> list:
    """Les seules taches de sang visibles : dans une case révélée, pas cachées, bornées, au plus SANG_MAX."""
    sortie = []
    for s in hab.get("sang") if isinstance(hab.get("sang"), list) else []:
        p = point([s.get("x"), s.get("y")]) if isinstance(s, dict) else None
        if not p or s.get("cache") or not revele(*p) or s.get("type") not in FORMES_SANG or len(sortie) >= SANG_MAX:
            continue
        t = {"x": round(p[0], 2), "y": round(p[1], 2), "r": round(borne(s.get("r"), 0.1, 4, 0.5), 2), "type": s["type"],
             "age": round(borne(s.get("age"), 0, 1, 0.2), 2), "graine": int(abs(num(s.get("graine"), 0))) % 1000000,
             "rot": round(borne(s.get("rot"), -7, 7, 0.0), 2), "teinte": s.get("teinte") if s.get("teinte") in TEINTES_SANG else "rouge"}
        if s["type"] == "trainee":
            t["l"] = round(borne(s.get("l"), 0.2, 12, 2), 2)
        sortie.append(t)
    return sortie


# ---------------------------------------------------------------- ce que la TV reçoit d'un plan

def plan_tv(hab, revele: Callable[[float, float], bool], pieces_nommees: dict):
    """Liste blanche : seulement ce qui est dans une case révélée et non caché ; ni la source des lumières (une note), ni l'étiquette
    d'une pièce dont le MJ n'a pas rendu le nom visible. pieces_nommees : {id : nom} des pièces révélées au nom visible ; le
    texte d'une étiquette est toujours ce nom-là, jamais celui enregistré dans l'habillage."""
    if not isinstance(hab, dict):
        return None
    heure = hab.get("heure") if hab.get("heure") in HEURES else "soir"
    defaut = AMBIANCES[heure][0]
    amb = hab.get("ambiance") if isinstance(hab.get("ambiance"), dict) else {}
    sortie = {"heure": heure, "ambiance": {"interieur": _couleur(amb.get("interieur"), defaut["interieur"]),
                                           "exterieur": _couleur(amb.get("exterieur"), defaut["exterieur"]),
                                           "force": round(borne(amb.get("force"), 0, 1, defaut["force"]), 2)}}
    lumieres = []
    for l in hab.get("lumieres") if isinstance(hab.get("lumieres"), list) else []:
        p = point([l.get("x"), l.get("y")]) if isinstance(l, dict) else None
        if p and not l.get("cache") and not l.get("eteinte") and revele(*p):
            lumieres.append({"id": str(l.get("id", "")), "x": round(p[0], 2), "y": round(p[1], 2), "rayon": round(borne(l.get("rayon"), 0.5, 10, 3), 2),
                             "couleur": _couleur(l.get("couleur"), "#ffb15e"), "intensite": round(borne(l.get("intensite"), 0, 1, 0.8), 2)})
    objets = []
    for o in hab.get("objets") if isinstance(hab.get("objets"), list) else []:
        c = point(o.get("case")) if isinstance(o, dict) else None
        if not c or o.get("cache") or o.get("cle") not in OBJETS_PLAN or not revele(c[0], c[1]):
            continue
        d = point(o.get("decalage")) or (0.5, 0.5)
        objets.append({"id": str(o.get("id", "")), "piece": o.get("piece") if isinstance(o.get("piece"), int) else None, "cle": o["cle"],
                       "case": [int(c[0]), int(c[1])], "decalage": [round(min(max(d[0], 0), 1), 2), round(min(max(d[1], 0), 1), 2)],
                       "rot": round(num(o.get("rot"), 0.0), 1)})
    legende = []
    for e in hab.get("legende") if isinstance(hab.get("legende"), list) else []:
        p = point([e.get("x"), e.get("y")]) if isinstance(e, dict) else None
        if p and not e.get("cache") and e.get("piece") in pieces_nommees and revele(*p):
            legende.append({"piece": e["piece"], "texte": court(pieces_nommees[e["piece"]], 40), "x": round(p[0], 2), "y": round(p[1], 2)})
    sortie |= {"lumieres": lumieres, "objets": objets, "legende": legende, "sang": _sang_tv(hab, revele)}
    return sortie
