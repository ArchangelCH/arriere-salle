"""Bouger son pion, partagé par le coin des joueurs et l'atelier : jusqu'où un héros peut aller sur le plan
que montre la TV, et la demande « deplacement » qui l'y emmène.

Le parcours se calcule sur la seule projection publique du plan (plan_public, ce que reçoivent la TV et le coin) :
  - un parcours en largeur, 8 voisins, sans couper les coins (une diagonale passe seulement si les deux chemins en
    équerre passent aussi, sans porte à ouvrir) ;
  - un mur ne se franchit que par une porte ouverte, une grille ouverte ou un passage ; une fenêtre ne se franchit pas ;
  - un meuble qui barre le passage (MOBILIER sans « franchissable ») bloque, sauf sous un pont, un ponton ou une barque
    (« passage ») ;
  - l'eau profonde et la falaise (SOLS_INFRANCHISSABLES) ne se traversent pas, sauf, là aussi, sous un pont, un ponton ou
    une barque ; on passe à travers un héros (ou un PNJ), jamais à travers un adversaire debout ;
  - seules les cases révélées comptent ;
  - seul un pion d'une case se déplace ainsi, et jamais un cavalier en selle (son MJ déplace sa monture) ;
  - une image posée par le MJ (lot H2, cle « image ») barre le passage, sauf s'il l'a dite franchissable.
Si le MJ le permet (« entrer », lot E4), le héros tente aussi sa chance :
  - une porte fermée (porte, double, grille) se franchit en l'ouvrant ; parmi les plus courts chemins, celui qui ouvre le
    moins de portes ;
  - depuis une case atteinte, une case encore cachée voisine (en ligne droite, jamais en diagonale) se vise en dernier
    pas, « dans le noir », par une porte ou là où la projection ne montre pas de mur.
La projection dit fermée une porte verrouillée, et n'a pas de porte secrète que les joueurs n'ont pas trouvée : le coin
ne peut donc refuser ni l'une ni l'autre. L'atelier refait le même parcours sur la même projection, où il remet les
vraies portes (verrouillee bloque, secrete non découverte bloque comme un mur) : ces deux refus-là, et eux seuls,
dépendent du vrai plan (VERROUILLEE, MUR ; mouvements.py). Une porte secrète posée là où le plan n'a pas de mur, la
projection la dessine en mur (main.murs_des_secretes) : le coin la refuse alors comme tout mur, et MUR ne reste, pour
elle, qu'une garde de l'atelier. Un pion caché n'est pas dans la projection : il ne barre rien, et la case où il se tient
reste libre pour le joueur.

La distance se compte en cases (un pas en diagonale vaut une case) : celle du réglage du MJ hors combat, pour chaque
déplacement ; en combat, celle du tour, comptée depuis la case du début du tour (plusieurs petits pas sont permis tant
que la case d'arrivée reste à portée de la case de départ).

Jumeau de js/plan/deplacement.js : les cas communs (tests/deplacement-cas.json) passent à l'identique des deux côtés
(tests/test_deplacement.py, outils/verifier_deplacement.mjs). Ce module ne lit rien : le coin (joueurs.py) et
l'atelier (mouvements.py) l'importent tous deux.
"""
import math
import re
from collections import deque

from commun import demandes
from commun.demandes import Genre, Refus

GENRE = "deplacement"
COTE_MAX = 400  # cases de côté au plus : au-delà, le plan n'est pas lu
ID_PION = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
JETON_PLAN = re.compile(r"^[a-f0-9]{20}$")

# Le mobilier qu'on traverse (plan/modele.js, MOBILIER, « franchissable ») ; tout autre meuble connu barre le passage.
FRANCHISSABLES = frozenset({
    "planche-contrats", "ossements", "chaines", "grille-egout", "cercle-rituel", "toiles", "fougeres", "pont", "potager",
    "champignons", "ponton", "passerelle", "barque", "cordages", "filet", "gravats", "pile-livres", "tapis", "tapis-rond",
    "tapis-long", "tenture", "torchere", "bouclier", "escalier", "escalier-bas", "colimacon", "trappe", "echelle", "piege",
    "tresor", "roseaux", "dune"})
# Ceux où l'on marche même par-dessus ce qui barre (« passage ») : le pont sur la rivière, la barque sur l'eau.
PASSAGES_MEUBLES = frozenset({"pont", "ponton", "passerelle", "barque"})
# Les sols où l'on ne marche pas (plan/modele.js, SOLS_INFRANCHISSABLES) : l'eau profonde (23) et la falaise (24).
SOLS_INFRANCHISSABLES = frozenset({23, 24})
MEUBLES = frozenset({
    "table", "table-ronde", "table-banquet", "chaise", "tabouret", "banc", "comptoir", "comptoir-angle", "tonneau",
    "tonneau-couche", "tonneaux-empiles", "caisse", "etagere", "etagere-bouteilles", "cheminee", "cheminee-angle", "four",
    "lit", "lit-double", "armoire", "coffre", "baignoire", "planche-contrats",
    "etal", "presentoir", "mannequin", "ratelier", "etabli", "forge", "enclume", "soufflet", "bac-trempe", "meule",
    "autel", "banc-temple", "lutrin", "fonts", "candelabre", "reliquaire", "statue", "grande-statue", "colonne", "brasero",
    "sarcophage", "sarcophage-ouvert", "cercueil", "ossements", "cage", "chaines", "pilori", "herse", "fosse",
    "grille-egout", "cercle-rituel", "toiles",
    "arbre", "chene", "sapin", "bouleau", "saule", "arbre-mort", "buisson", "fougeres", "souche", "tronc", "menhir",
    "riviere", "pont", "cloture", "palissade", "feu-de-camp", "tente", "panneau", "palmier", "roseaux", "dune",
    "fontaine", "tombe",
    "puits", "stalle", "foin", "charrette", "potager", "epouvantail",
    "rochers", "gros-rocher", "stalagmite", "champignons", "cristaux",
    "ponton", "passerelle", "barque", "mat", "gouvernail", "bitte", "ancre", "cordages", "filet",
    "mur-ruine", "colonne-brisee", "colonne-couchee", "statue-brisee", "eboulis", "gravats",
    "bibliotheque", "bureau", "fauteuil", "table-cartes", "table-alchimie", "globe", "pile-livres",
    "tapis", "tapis-rond", "tapis-long", "tenture", "banniere", "torchere", "bouclier", "coffre-fer", "coffre-ouvert",
    "sacs", "caisses",
    "escalier", "escalier-bas", "colimacon", "trappe", "echelle",
    "piege", "tresor"})


def sol_infranchissable(v) -> bool:
    """L'eau profonde, la falaise : un nombre de la liste (comme Set.has du navigateur, 23.0 compte pour 23)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v in SOLS_INFRANCHISSABLES


def franchissable(o: dict) -> bool:
    """Un meuble qu'on traverse ; une image du MJ se traverse seulement s'il l'a dit."""
    if o.get("cle") == "image":
        return o.get("franchissable") is True
    return o.get("cle") in FRANCHISSABLES


# Les portes qui laissent passer quand elles sont ouvertes (et qu'un héros ouvre, lot E4) ; le passage (arche) laisse
# toujours passer.
PORTES_QUI_S_OUVRENT = ("porte", "double", "grille")
PASSAGES = ("arche",)
# Ce qu'une porte fait d'un héros : elle le laisse passer, il l'ouvre en passant (« entrer »), ou elle l'arrête.
OUVERTE, A_OUVRIR, BLOQUE = "ouverte", "a-ouvrir", "bloque"
# Les bits des murs (main.py, murs_du_plan) vers chaque voisin : un mur droit, ou une paroi de grotte (les mêmes << 4).
BITS = {(0, -1): 1, (1, 0): 2, (0, 1): 4, (-1, 0): 8}
VOISINS = ((0, -1), (1, 0), (0, 1), (-1, 0), (1, -1), (1, 1), (-1, 1), (-1, -1))

# Les phrases d'un refus : les mêmes des deux côtés, sur la seule projection publique.
FIGES = "Votre MJ a figé les pions : demandez-lui de vive voix."
PAS_TON_TOUR = "Ce n'est pas votre tour."
PAS_SUR_LE_PLAN = "Votre héros n'est pas sur le plan que montre la TV."
TROP_GRAND = "Votre pion est trop grand pour bouger d'ici : demandez à votre MJ."
EN_SELLE = "Votre héros est en selle : demandez à votre MJ de déplacer sa monture."
A_BOUGE = "Votre pion a bougé entre-temps : la page se relit."
DEJA_LA = "Votre pion y est déjà."
HORS_DU_PLAN = "Cette case est hors du plan."
PAS_REVELEE = "Cette case n'est pas encore révélée."
PAS_DE_SOL = "Il n'y a pas de sol à cet endroit."
MEUBLE = "Un meuble occupe cette case."
INFRANCHISSABLE = "On n'avance pas là : eau profonde ou falaise."
PRISE = "Cette case est déjà prise."
SANS_PASSAGE = "Aucun passage jusque-là : un mur, une porte fermée ou un adversaire barre la route."
# Quand le héros ouvre les portes (« entrer ») : une porte fermée ne barre plus la route, le noir se tente d'un pas.
SANS_PASSAGE_ENTRER = "Aucun passage jusque-là : un mur ou un adversaire barre la route."
NOIR = "Cette case est dans le noir : on n'y avance que d'un pas depuis une case voisine, et jamais à travers un mur."
# Les deux seuls refus que décide le vrai plan (l'atelier, mouvements.py) : le héros essaie la poignée, tâte le mur. Une
# porte secrète que les joueurs n'ont pas trouvée se refuse avec MUR, mot pour mot.
VERROUILLEE = "Cette porte est fermée à clé."
MUR = "Un mur vous arrête."
PLUS_LA = "La TV ne montre plus ce plan : la page se relit."
TABLE_FERMEE = "La table n'est pas ouverte aux joueurs pour l'instant."


def trop_loin(limite: int, combat: bool) -> str:
    if combat:
        return f"Trop loin pour ce tour : {limite} case{'s' if limite > 1 else ''} au plus depuis votre place au début du tour."
    return f"Trop loin : {limite} case{'s' if limite > 1 else ''} au plus d'un coup."


def entier(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def nombre(v, defaut=0.0) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
        return defaut
    return float(v)


def arrondi(v: float) -> int:
    """Math.round du navigateur (0,5 monte toujours), et non l'arrondi au pair de Python."""
    return math.floor(v + 0.5)


def cases_sous(t: dict) -> list:
    """Les cases sous un pion (plan/entrer.js, casesSous) : une pour un pion normal, 2 × 2 ou 3 × 3 pour les grands."""
    n = max(1, arrondi(nombre(t.get("taille"), 1)))
    x0 = arrondi(nombre(t.get("x")) - n / 2)
    y0 = arrondi(nombre(t.get("y")) - n / 2)
    return [(x, y) for y in range(y0, y0 + n) for x in range(x0, x0 + n)]


def case_du_pion(t: dict) -> tuple:
    return cases_sous({**t, "taille": 1})[0]


def taille_du_pion(t: dict) -> int:
    return max(1, arrondi(nombre(t.get("taille"), 1)))


def etat_porte(d: dict) -> str:
    """OUVERTE, A_OUVRIR ou BLOQUE. Une porte secrète découverte est une porte comme une autre ; non découverte, elle
    bloque comme un mur, ouverte ou non (jamais dans la projection : seul le vrai plan de l'atelier en a). Une porte
    verrouillée bloque (la projection la dit fermée). Un état inconnu compte pour fermé, comme dans la projection."""
    genre = d.get("genre")
    if genre == "secrete":
        if not d.get("decouverte"):
            return BLOQUE
        genre = "porte"
    if genre in PASSAGES:
        return OUVERTE
    if genre not in PORTES_QUI_S_OUVRENT:
        return BLOQUE
    etat = d.get("etat")
    return OUVERTE if etat == "ouverte" else BLOQUE if etat == "verrouillee" else A_OUVRIR


# ---------------------------------------------------------------- la grille du plan public

class Grille:
    """Ce que le parcours lit du plan public, une fois pour toutes : sol révélé, murs, portes par arête, meubles qui
    barrent, adversaires debout, cases prises par un autre pion."""

    def __init__(self, plan: dict, pion: str | None):
        self.w, self.h = int(nombre(plan.get("largeur"))), int(nombre(plan.get("hauteur")))
        if not (0 < self.w <= COTE_MAX and 0 < self.h <= COTE_MAX):
            raise Refus(409, PAS_SUR_LE_PLAN)
        n = self.w * self.h

        def liste(cle):
            v = plan.get(cle)
            return list(v[:n]) + [0] * (n - len(v[:n])) if isinstance(v, list) else [0] * n

        self.sol = liste("sol")
        self.murs = [int(m) if entier(m) else 0 for m in liste("murs")]
        actif = plan.get("brouillard_actif", True) is not False
        vu = liste("brouillard")
        self.vu = [1] * n if not actif else [1 if v == 1 else 0 for v in vu]
        self.portes = {}
        for d in plan.get("portes") or []:
            if not isinstance(d, dict) or d.get("sens") not in ("v", "h") or not entier(d.get("x")) or not entier(d.get("y")):
                continue
            self.portes.setdefault((d["sens"], d["x"], d["y"]), d)
        self.meubles = set()
        dessus = set()  # les cases d'un pont, d'un ponton, d'une barque : on y marche, même par-dessus la rivière
        for o in plan.get("objets") or []:
            if not isinstance(o, dict) or (franchissable(o) and o.get("cle") not in PASSAGES_MEUBLES):
                continue
            tourne = nombre(o.get("rot")) % 180 != 0
            l, hh = (nombre(o.get("h"), 1), nombre(o.get("l"), 1)) if tourne else (nombre(o.get("l"), 1), nombre(o.get("h"), 1))
            x0, y0 = nombre(o.get("x")), nombre(o.get("y"))
            for y in range(math.floor(y0), math.ceil(y0 + hh)):
                for x in range(math.floor(x0), math.ceil(x0 + l)):
                    (dessus if o.get("cle") in PASSAGES_MEUBLES else self.meubles).add((x, y))
        self.meubles -= dessus
        self.dessus = dessus
        self.ennemis, self.prises = set(), set()
        self.moi = None
        for t in plan.get("pions") or []:
            if not isinstance(t, dict) or "x" not in t or "y" not in t:
                continue
            if t.get("id") == pion and pion is not None:
                self.moi = t
                continue
            if t.get("tombe"):
                continue
            cases = cases_sous(t)
            self.prises.update(cases)
            if t.get("genre") == "ennemi":
                self.ennemis.update(cases)

    def dedans(self, x: int, y: int) -> bool:
        return 0 <= x < self.w and 0 <= y < self.h

    def i(self, x: int, y: int) -> int:
        return y * self.w + x

    def revelee(self, x: int, y: int) -> bool:
        return self.dedans(x, y) and self.vu[self.i(x, y)] == 1

    def praticable(self, x: int, y: int) -> bool:
        """Une case où l'on peut se tenir ou passer : révélée, avec un sol où l'on marche (ou un pont par-dessus), sans meuble
        qui barre ni adversaire debout."""
        sol = self.sol[self.i(x, y)] if self.dedans(x, y) else 0
        return (self.revelee(x, y) and bool(sol) and (not sol_infranchissable(sol) or (x, y) in self.dessus)
                and (x, y) not in self.meubles and (x, y) not in self.ennemis)

    def porte(self, x: int, y: int, dx: int, dy: int) -> dict | None:
        """La porte posée sur l'arête entre (x, y) et son voisin orthogonal (dx, dy) : « v » à gauche d'une case, « h »
        au-dessus."""
        if dx:
            return self.portes.get(("v", x + 1 if dx > 0 else x, y))
        return self.portes.get(("h", x, y + 1 if dy > 0 else y))

    @staticmethod
    def ouverte(d: dict) -> bool:
        return etat_porte(d) == OUVERTE

    def mur(self, x: int, y: int, dx: int, dy: int) -> bool:
        bit = BITS[(dx, dy)]
        oppose = BITS[(-dx, -dy)]
        m = self.murs[self.i(x, y)] if self.dedans(x, y) else 0
        nx, ny = x + dx, y + dy
        n = self.murs[self.i(nx, ny)] if self.dedans(nx, ny) else 0
        return bool(m & (bit | bit << 4)) or bool(n & (oppose | oppose << 4))

    def arete(self, x: int, y: int, dx: int, dy: int) -> bool:
        """L'arête se franchit-elle sans rien ouvrir ? Une porte décide d'elle-même (ouverte, elle passe ; fermée, elle
        bloque, même sans mur) ; sans porte, seul un mur bloque."""
        return self.passage(x, y, dx, dy, False) == 0

    def passage(self, x: int, y: int, dx: int, dy: int, entrer: bool) -> int | None:
        """L'arête orthogonale vers (dx, dy) : 0, elle se franchit librement ; 1, en ouvrant une porte fermée (seulement si
        entrer) ; None, elle arrête le héros (un mur, une fenêtre, une porte verrouillée ou secrète)."""
        d = self.porte(x, y, dx, dy)
        if d is None:
            return None if self.mur(x, y, dx, dy) else 0
        e = etat_porte(d)
        if e == OUVERTE:
            return 0
        return 1 if e == A_OUVRIR and entrer else None


def parcours(plan: dict, pion: str | None, depart: tuple, entrer: bool = False, limite: int | None = None,
             grille: Grille | None = None) -> tuple[dict, dict]:
    """({(x, y): (distance, entree, portes)}, {(x, y): case d'où l'on y vient}) des cases que le pion peut atteindre depuis
    depart (comprise, à 0, sans case d'avant). entree : la case est encore cachée, atteinte en dernier pas (seulement si
    entrer). portes : les portes fermées à ouvrir en chemin, le moins possible parmi les plus courts chemins (seulement si
    entrer). limite : rien au-delà de cette distance (None : tout le plan). Les cases prises par un autre pion y sont (on
    passe à travers un héros) : à l'arrivée, verifier les refuse.

    Un parcours en largeur, couche par couche : toutes les cases à la distance d sont vues avant la première à d + 1, donc
    le nombre de portes d'une case est le bon quand elle est reprise dans la file. À égalité, la première trouvée garde
    sa place (l'ordre de VOISINS, le même des deux côtés)."""
    g = grille or Grille(plan, pion)
    sx, sy = depart
    vus = {(sx, sy): (0, False, 0)}
    avant = {(sx, sy): None}
    file = deque([(sx, sy)])
    while file:
        x, y = file.popleft()
        d, _, n = vus[(x, y)]
        if limite is not None and d >= limite:
            continue
        for dx, dy in VOISINS:
            nx, ny = x + dx, y + dy
            deja = vus.get((nx, ny))
            # Déjà vue plus près, ou à la même distance sans qu'on puisse ouvrir moins de portes : rien à faire (le gros du
            # parcours, à couper avant tout calcul).
            if (deja is not None and (deja[0] <= d or n >= deja[2])) or not g.dedans(nx, ny):
                continue
            if dx and dy:
                # En diagonale : les deux cases d'angle doivent se traverser, et les quatre arêtes des deux équerres aussi,
                # sans porte à ouvrir (une porte se franchit de face).
                if not (g.praticable(nx, ny) and g.praticable(nx, y) and g.praticable(x, ny)
                        and g.arete(x, y, dx, 0) and g.arete(nx, y, 0, dy) and g.arete(x, y, 0, dy) and g.arete(x, ny, dx, 0)):
                    continue
                cout, entree = 0, False
            elif g.praticable(nx, ny):
                cout, entree = g.passage(x, y, dx, dy, entrer), False
            elif entrer and not g.revelee(nx, ny) and (nx, ny) not in g.prises:
                # Une case cachée : on y entre (par une porte, ou là où rien ne montre de mur), on ne va pas plus loin (rien
                # d'elle n'est connu).
                cout, entree = g.passage(x, y, dx, dy, entrer), True
            else:
                continue
            if cout is None:
                continue
            if deja is None:
                vus[(nx, ny)] = (d + 1, entree, n + cout)
                avant[(nx, ny)] = (x, y)
                if not entree:
                    file.append((nx, ny))
            elif deja[0] == d + 1 and n + cout < deja[2]:
                vus[(nx, ny)] = (d + 1, entree, n + cout)
                avant[(nx, ny)] = (x, y)
    return vus, avant


def atteignables(plan: dict, pion: str | None, depart: tuple, entrer: bool = False, limite: int | None = None,
                 grille: Grille | None = None) -> dict:
    """{(x, y): (distance, entree, portes)} : parcours, sans les cases d'avant."""
    return parcours(plan, pion, depart, entrer, limite, grille)[0]


def chemin(avant: dict, vers: tuple) -> list:
    """Les cases du chemin retenu, du départ à vers compris."""
    res = [tuple(vers)]
    while avant.get(res[-1]) is not None:
        res.append(avant[res[-1]])
    return res[::-1]


def portes_du_chemin(g: Grille, cases: list) -> list:
    """Les portes à ouvrir le long de ce chemin, dans l'ordre (les objets mêmes du plan lu)."""
    res = []
    for (x, y), (nx, ny) in zip(cases, cases[1:]):
        if (nx - x) and (ny - y):
            continue
        d = g.porte(x, y, nx - x, ny - y)
        if d is not None and etat_porte(d) == A_OUVRIR:
            res.append(d)
    return res


def verifier(plan: dict, corps: dict, regles: dict, tour: dict) -> dict:
    """Le déplacement demandé (corps : pion, depuis, vers) passe-t-il sur ce plan public ? Rend {distance, entree,
    depart, limite, portes, chemin} (portes : celles à ouvrir en chemin, les objets mêmes du plan lu ; chemin : ses cases)
    ou lève Refus avec la phrase à montrer. regles : le réglage du MJ (pions, distance, distance_combat, entrer) ; tour :
    {combat, mon_tour, debut} du héros (debut : la case du début de son tour, en combat)."""
    if regles.get("pions") == "figes":
        raise Refus(423, FIGES)
    combat = tour.get("combat") is True
    if combat and tour.get("mon_tour") is not True:
        raise Refus(409, PAS_TON_TOUR)
    g = Grille(plan, corps.get("pion"))
    if g.moi is None:
        raise Refus(409, PAS_SUR_LE_PLAN)
    if taille_du_pion(g.moi) > 1:
        raise Refus(409, TROP_GRAND)
    if isinstance(g.moi.get("monture"), str):
        raise Refus(409, EN_SELLE)
    ici = case_du_pion(g.moi)
    if tuple(corps.get("depuis") or ()) != ici:
        raise Refus(409, A_BOUGE)
    vx, vy = corps["vers"]
    if (vx, vy) == ici:
        raise Refus(409, DEJA_LA)
    if not g.dedans(vx, vy):
        raise Refus(409, HORS_DU_PLAN)
    entrer = regles.get("entrer") is True
    if (vx, vy) in g.prises:
        raise Refus(409, PRISE)
    debut = tour.get("debut") if combat else None
    depart = tuple(debut) if (isinstance(debut, (list, tuple)) and len(debut) == 2 and all(entier(v) for v in debut)
                              and g.dedans(*debut)) else ici
    limite = regles.get("distance_combat" if combat else "distance")
    limite = limite if entier(limite) and limite > 0 else 1
    vus, avant = parcours(plan, corps.get("pion"), depart, entrer, grille=g)
    if (vx, vy) not in vus:
        if not g.revelee(vx, vy):
            raise Refus(409, NOIR if entrer else PAS_REVELEE)
        if not g.sol[g.i(vx, vy)]:
            raise Refus(409, PAS_DE_SOL)
        if (vx, vy) in g.meubles:
            raise Refus(409, MEUBLE)
        if sol_infranchissable(g.sol[g.i(vx, vy)]) and (vx, vy) not in g.dessus:
            raise Refus(409, INFRANCHISSABLE)
        raise Refus(409, SANS_PASSAGE_ENTRER if entrer else SANS_PASSAGE)
    distance, entree, _ = vus[(vx, vy)]
    if distance > limite:
        raise Refus(409, trop_loin(limite, combat))
    cases = chemin(avant, (vx, vy))
    return {"distance": distance, "entree": entree, "depart": list(depart), "limite": limite,
            "portes": portes_du_chemin(g, cases), "chemin": [list(c) for c in cases]}


def plan_vrai(public: dict, portes) -> dict:
    """La projection publique avec les vraies portes du plan, pour l'atelier seul (mouvements.py) : même sol, mêmes murs,
    mêmes meubles et pions (ce qui est caché ne barre toujours rien), mais une porte verrouillée l'est, et une porte
    secrète non découverte y est (elle bloque comme un mur). Jamais rendu au coin."""
    return {**public, "portes": [d for d in portes or [] if isinstance(d, dict)]}


# ---------------------------------------------------------------- la demande

def couple(v, nom: str) -> list:
    if not (isinstance(v, list) and len(v) == 2 and all(entier(x) and 0 <= x < COTE_MAX for x in v)):
        raise Refus(400, f"Déplacement : case {nom} illisible.")
    return [v[0], v[1]]


def valider(corps) -> dict:
    """{plan : le jeton public du plan, pion : son id public, depuis : la case où le joueur le voit, vers : la case visée}.
    Rien d'autre : la forme seulement ; le parcours se vérifie sur le plan publié (coin) puis sur le plan du moment
    (atelier)."""
    corps = demandes.seulement(corps, {"plan", "pion", "depuis", "vers"}, "Déplacement")
    plan, pion = corps.get("plan"), corps.get("pion")
    if not isinstance(plan, str) or not JETON_PLAN.match(plan):
        raise Refus(400, "Déplacement : plan illisible.")
    if not isinstance(pion, str) or not ID_PION.match(pion):
        raise Refus(400, "Déplacement : pion illisible.")
    return {"plan": plan, "pion": pion, "depuis": couple(corps.get("depuis"), "de départ"), "vers": couple(corps.get("vers"), "visée")}


# Appliqué seul quand le MJ laisse les pions libres, en attente quand il veut valider : le coin choisit le statut d'après le
# réglage publié (joueurs.py), l'atelier le revérifie toujours. Jamais sur Telegram ; « Annuler » dans la boîte.
GENRE_DEPLACEMENT = demandes.enregistrer(Genre(
    GENRE, "Déplacement", ("un déplacement", "{n} déplacements"), attente=False, valider=valider, silencieux=True,
    annulable=True, oui="Accepter", non="Refuser",
    statuts={demandes.A_APPLIQUER: "en route", demandes.EN_ATTENTE: "le MJ valide", demandes.APPLIQUEE: "fait",
             demandes.ACCEPTEE: "accepté par le MJ", demandes.REFUSEE: "refusé par le MJ", demandes.ECHEC: "pas possible",
             demandes.RETIREE: "retiré", demandes.ANNULEE: "annulé par le MJ"}))
