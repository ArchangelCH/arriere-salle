"""Écrit tests/deplacement-cas.json : les cas communs du parcours d'un pion (app/commun/deplacement.py et
js/plan/deplacement.js), dessinés ici en petites cartes lisibles.

Chaque carte : une lettre par case. Minuscule : un sol révélé, de la pièce de cette lettre (a = 1, b = 2…) ; majuscule :
le même sol, encore caché ; « # » : pas de sol (révélé) ; « % » : pas de sol (caché) ; « ~ » : eau profonde de la pièce a
(« = » : cachée) ; « ^ » : falaise de la pièce a. Les portes se posent à part
(porte(x, y, genre, etat, sens, decouverte=…)) : « fermee », « ouverte », « verrouillee » ; genre « secrete » avec ou sans
« decouverte ». La projection publique se calcule comme api/tv_plans.py (plan_public) : cases cachées sans sol ni pièce ni mur,
porte secrète non découverte retirée, porte verrouillée dite fermée, pion ou meuble caché retiré, pion « invisible »
retiré, image du MJ avec sa couche et son « franchissable », monture d'un cavalier seulement si elle est montrée.
Un cas « vrai » lit la même projection avec les vraies portes (deplacement.plan_vrai) : ce que l'atelier
revérifie.

Chaque cas dit ce qu'il attend (une distance, une entrée, les portes à ouvrir, ou la phrase d'un refus) ; le générateur y
ajoute toutes les cases atteignables calculées par app/commun/deplacement.py, que le navigateur doit retrouver à l'identique.
  python3 outils/cas_deplacement.py
"""
import json
import string
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
sys.path.insert(0, str(ICI.parent / "app"))

from commun import deplacement as dp  # noqa: E402


def murs_du_plan(w, h, sol, pc, genres):
    """La règle de api/tv_plans.py, murs_du_plan (et de calculerMurs, plan/modele.js)."""
    murs = [0] * (w * h)
    for y in range(h):
        for x in range(w):
            i = y * w + x
            if not sol[i]:
                continue
            ga = genres.get(pc[i], "salle")
            m = 0
            for dx, dy, bit in ((0, -1, 1), (1, 0, 2), (0, 1, 4), (-1, 0, 8)):
                nx, ny = x + dx, y + dy
                j = ny * w + nx
                if nx < 0 or ny < 0 or nx >= w or ny >= h or not sol[j]:
                    if ga == "salle":
                        m |= bit
                    elif ga == "grotte":
                        m |= bit << 4
                elif pc[j] != pc[i] and (ga == "salle" or genres.get(pc[j], "salle") == "salle"):
                    m |= bit
            murs[i] = m
    return murs


def projection(carte, portes=(), objets=(), pions=(), genres=None, brouillard_actif=True):
    lignes = [l for l in carte]
    h, w = len(lignes), len(lignes[0])
    assert all(len(l) == w for l in lignes), carte
    sol, pc, vu = [], [], []
    for l in lignes:
        for c in l:
            if c in "#%":
                sol.append(0)
                pc.append(0)
                vu.append(1 if c == "#" else 0)
            elif c in "~^=":
                # L'eau profonde (« ~ », « = » cachée) et la falaise (« ^ ») d'un extérieur : la pièce a, sol infranchissable.
                sol.append(24 if c == "^" else 23)
                pc.append(1)
                vu.append(0 if c == "=" else 1)
            else:
                sol.append(2)
                pc.append(string.ascii_lowercase.index(c.lower()) + 1)
                vu.append(1 if c.islower() else 0)
    if not brouillard_actif:
        vu = [1] * (w * h)
    numeros = {string.ascii_lowercase.index(k) + 1: v for k, v in (genres or {}).items()}
    murs = murs_du_plan(w, h, sol, pc, numeros)

    def revele(x, y):
        return 0 <= x < w and 0 <= y < h and vu[y * w + x] == 1

    pub_portes = []
    for d in portes:
        if d.get("genre") == "secrete" and not d.get("decouverte"):
            continue
        cases = [(d["x"] - 1, d["y"]), (d["x"], d["y"])] if d["sens"] == "v" else [(d["x"], d["y"] - 1), (d["x"], d["y"])]
        if not any(revele(*c) for c in cases):
            continue
        pub_portes.append({"id": d.get("id", f"p{len(pub_portes)}"), "sens": d["sens"], "x": d["x"], "y": d["y"],
                           "genre": "porte" if d.get("genre") == "secrete" else d.get("genre", "porte"),
                           "etat": "fermee" if d.get("etat") == "verrouillee" else d.get("etat", "fermee")})
    pub_objets = []
    for o in objets:
        if o.get("cache"):
            continue
        tourne = (o.get("rot") or 0) % 180 != 0
        l, hh = (o["h"], o["l"]) if tourne else (o["l"], o["h"])
        if any(revele(x, y) for y in range(o["y"], o["y"] + hh) for x in range(o["x"], o["x"] + l)):
            pub = {k: o.get(k) for k in ("id", "cle", "x", "y", "l", "h", "rot")}
            if o.get("cle") == "image":
                pub.update({"image": "/media/essai.png", "dessus": o.get("dessus") is True, "franchissable": o.get("franchissable") is True})
            pub_objets.append(pub)
    pub_pions = []
    for t in pions:
        if t.get("cache") or "invisible" in (t.get("etats") or []):
            continue
        x, y = t["x"] + (t.get("taille", 1)) / 2, t["y"] + (t.get("taille", 1)) / 2
        if not revele(int(x // 1), int(y // 1)):
            continue
        pub_pions.append({"id": t["id"], "genre": t.get("genre", "heros"), "court": "", "x": x, "y": y,
                          "taille": t.get("taille", 1), "tombe": bool(t.get("tombe")), **({"monture": t["monture"]} if t.get("monture") else {})})
    montres = {t["id"] for t in pub_pions}
    for t in pub_pions:
        if t.get("monture") not in montres:
            t.pop("monture", None)
    return {
        "largeur": w, "hauteur": h, "brouillard_actif": brouillard_actif,
        "sol": [s if vu[i] else 0 for i, s in enumerate(sol)], "piece": [p if vu[i] else 0 for i, p in enumerate(pc)],
        "brouillard": vu, "murs": [m if vu[i] else 0 for i, m in enumerate(murs)],
        "portes": pub_portes, "objets": pub_objets, "pions": pub_pions,
    }


MOI = {"id": "moi", "genre": "heros"}
LIBRES = {"pions": "libres", "distance": 12, "distance_combat": 6, "entrer": True}
SANS_ENTRER = {**LIBRES, "entrer": False}
HORS_COMBAT = {"combat": False, "mon_tour": False, "debut": None}

SALLE_5 = ["aaaaa", "aaaaa", "aaaaa", "aaaaa", "aaaaa"]
DEUX_SALLES = ["aaabbb", "aaabbb", "aaabbb"]  # un mur entre x = 2 et x = 3
SALLE_ET_CACHEE = ["aaaBBB", "aaaBBB", "aaaBBB"]
COULOIR = ["aaaaaaa"]


def moi(x, y, **plus):
    return {**MOI, "x": x, "y": y, **plus}


def porte(x, y, genre="porte", etat="ouverte", sens="v", **plus):
    return {"sens": sens, "x": x, "y": y, "genre": genre, "etat": etat, **plus}


CAS = []


def cas(nom, carte, depuis, vers, attendu, regles=LIBRES, tour=HORS_COMBAT, portes=(), objets=(), pions=(), genres=None,
        brouillard_actif=True, pion="moi", taille=1, vrai=False):
    pions = [moi(*depuis, taille=taille), *pions] if pion == "moi" else list(pions)
    plan = projection(carte, portes, objets, pions, genres, brouillard_actif)
    if vrai:
        plan = dp.plan_vrai(plan, [{"id": d.get("id", f"p{k}"), **d} for k, d in enumerate(portes)])
    CAS.append({"nom": nom, "carte": carte, "regles": regles, "tour": tour, **({"vrai": True} if vrai else {}), "plan": plan,
                "corps": {"pion": "moi", "depuis": list(depuis), "vers": list(vers)}, "attendu": attendu})


R = dp
ok = lambda d, entree=False, portes=0: {"distance": d, "entree": entree, "portes": portes}  # noqa: E731
non = lambda phrase: {"refus": phrase}  # noqa: E731

cas("ligne droite dans une salle", SALLE_5, (0, 2), (4, 2), ok(4))
cas("une diagonale vaut une case", SALLE_5, (0, 0), (3, 3), ok(3))
cas("trop loin hors combat", SALLE_5, (0, 0), (4, 4), non(R.trop_loin(2, False)), regles={**LIBRES, "distance": 2})
cas("juste à la distance permise", SALLE_5, (0, 0), (2, 4), ok(4), regles={**LIBRES, "distance": 4})
cas("un mur sans porte", DEUX_SALLES, (0, 1), (4, 1), non(R.SANS_PASSAGE_ENTRER))
cas("une porte ouverte", DEUX_SALLES, (0, 1), (4, 1), ok(4), portes=[porte(3, 1)])
cas("une porte fermée, sans « entrer »", DEUX_SALLES, (0, 1), (4, 1), non(R.SANS_PASSAGE), regles=SANS_ENTRER,
    portes=[porte(3, 1, etat="fermee")])
cas("une porte verrouillée, le même refus", DEUX_SALLES, (0, 1), (4, 1), non(R.SANS_PASSAGE), regles=SANS_ENTRER,
    portes=[porte(3, 1, etat="verrouillee")])
cas("une porte double ouverte", DEUX_SALLES, (0, 1), (4, 1), ok(4), portes=[porte(3, 1, genre="double")])
cas("un passage reste ouvert", DEUX_SALLES, (0, 1), (4, 1), ok(4), portes=[porte(3, 1, genre="arche", etat="fermee")])
cas("une grille ouverte", DEUX_SALLES, (0, 1), (4, 1), ok(4), portes=[porte(3, 1, genre="grille")])
cas("une grille fermée", DEUX_SALLES, (0, 1), (4, 1), non(R.SANS_PASSAGE), regles=SANS_ENTRER,
    portes=[porte(3, 1, genre="grille", etat="fermee")])
cas("une fenêtre ouverte ne se franchit pas", DEUX_SALLES, (0, 1), (4, 1), non(R.SANS_PASSAGE_ENTRER), portes=[porte(3, 1, genre="fenetre")])
cas("une porte secrète découverte et ouverte", DEUX_SALLES, (0, 1), (4, 1), ok(4),
    portes=[porte(3, 1, genre="secrete", decouverte=True)])
cas("une porte secrète non découverte n'ouvre aucun chemin, même ouverte", DEUX_SALLES, (0, 1), (4, 1), non(R.SANS_PASSAGE_ENTRER),
    portes=[porte(3, 1, genre="secrete", etat="ouverte", decouverte=False)])
cas("une porte posée sans mur, fermée, bloque", SALLE_5, (1, 2), (2, 2), non(R.SANS_PASSAGE), regles=SANS_ENTRER,
    portes=[porte(2, 0, etat="fermee"), porte(2, 1, etat="fermee"), porte(2, 2, etat="fermee"), porte(2, 3, etat="fermee"), porte(2, 4, etat="fermee")])
cas("pas de diagonale par une porte : on ne coupe pas le coin du mur", DEUX_SALLES, (2, 0), (3, 1), non(R.trop_loin(1, False)),
    regles={**LIBRES, "distance": 1}, portes=[porte(3, 1)])
cas("par la porte, en équerre", DEUX_SALLES, (2, 0), (3, 1), ok(2), regles={**LIBRES, "distance": 2}, portes=[porte(3, 1)])
cas("pas de diagonale au bord du vide", ["aa", "a#"], (1, 0), (0, 1), ok(2))
cas("un meuble occupe la case", SALLE_5, (0, 2), (2, 2), non(R.MEUBLE), objets=[{"id": "o1", "cle": "table", "x": 2, "y": 2, "l": 2, "h": 1}])
cas("on contourne un meuble, sans en couper les coins", ["aaaaa", "aaaaa"], (0, 0), (4, 0), ok(6), objets=[{"id": "o1", "cle": "comptoir", "x": 1, "y": 0, "l": 3, "h": 1}])
cas("un meuble tourné barre sa nouvelle emprise", SALLE_5, (0, 0), (1, 1), non(R.MEUBLE),
    objets=[{"id": "o1", "cle": "banc", "x": 1, "y": 0, "l": 2, "h": 1, "rot": 90}])
cas("un tapis se traverse", COULOIR, (0, 0), (6, 0), ok(6), objets=[{"id": "o1", "cle": "tapis", "x": 2, "y": 0, "l": 2, "h": 1}])
cas("un meuble en travers du couloir barre la route", COULOIR, (0, 0), (6, 0), non(R.SANS_PASSAGE_ENTRER),
    objets=[{"id": "o1", "cle": "tonneau", "x": 3, "y": 0, "l": 1, "h": 1}])
cas("un meuble caché ne barre rien", COULOIR, (0, 0), (6, 0), ok(6), objets=[{"id": "o1", "cle": "coffre", "x": 3, "y": 0, "l": 1, "h": 1, "cache": True}])
cas("un meuble inconnu barre la route", COULOIR, (0, 0), (6, 0), non(R.SANS_PASSAGE_ENTRER),
    objets=[{"id": "o1", "cle": "machine-inconnue", "x": 3, "y": 0, "l": 1, "h": 1}])
# Le mobilier ajouté le 09/11 : la rivière barre la route, le pont et la barque l'enjambent, l'éboulis bouche, les
# gravats se traversent.
GUE = ["aaaaaaa", "aaaaaaa", "aaaaaaa"]
RIVIERE = {"id": "r1", "cle": "riviere", "x": 3, "y": 0, "l": 1, "h": 3}
cas("une rivière barre la route", GUE, (0, 1), (6, 1), non(R.SANS_PASSAGE_ENTRER), objets=[RIVIERE])
cas("un pont enjambe la rivière", GUE, (0, 1), (6, 1), ok(6),
    objets=[RIVIERE, {"id": "p1", "cle": "pont", "x": 2, "y": 1, "l": 1, "h": 3, "rot": 90}])
cas("on peut s'arrêter sur le pont", GUE, (0, 1), (3, 1), ok(3),
    objets=[RIVIERE, {"id": "p1", "cle": "pont", "x": 2, "y": 1, "l": 1, "h": 3, "rot": 90}])
cas("un pont caché n'enjambe rien", GUE, (0, 1), (6, 1), non(R.SANS_PASSAGE_ENTRER),
    objets=[RIVIERE, {"id": "p1", "cle": "pont", "x": 2, "y": 1, "l": 1, "h": 3, "rot": 90, "cache": True}])
cas("une barque sur la rivière", GUE, (0, 0), (3, 0), ok(3), objets=[RIVIERE, {"id": "b1", "cle": "barque", "x": 3, "y": 0, "l": 1, "h": 2}])
# Les plans extérieurs : l'eau profonde et la falaise barrent la route, sauf sous un pont ou une barque.
LAC = ["aa~aa", "aa~aa", "aa~aa"]
EXT = {"a": "exterieur"}
cas("l'eau profonde barre la route", LAC, (0, 1), (4, 1), non(R.SANS_PASSAGE_ENTRER), genres=EXT)
cas("on n'entre pas dans l'eau profonde", LAC, (0, 1), (2, 1), non(R.INFRANCHISSABLE), genres=EXT)
cas("la falaise barre la route", ["aa^aa", "aa^aa"], (0, 0), (4, 1), non(R.SANS_PASSAGE_ENTRER), genres=EXT)
cas("on ne monte pas sur la falaise", ["aa^aa"], (0, 0), (2, 0), non(R.INFRANCHISSABLE), genres=EXT)
cas("un pont enjambe l'eau profonde", LAC, (0, 1), (4, 1), ok(4), genres=EXT,
    objets=[{"id": "p1", "cle": "pont", "x": 1, "y": 1, "l": 1, "h": 3, "rot": 90}])
cas("on s'arrête sur le pont au-dessus de l'eau profonde", LAC, (0, 1), (2, 1), ok(2), genres=EXT,
    objets=[{"id": "p1", "cle": "pont", "x": 1, "y": 1, "l": 1, "h": 3, "rot": 90}])
cas("une barque sur l'eau profonde", LAC, (1, 0), (2, 0), ok(1), genres=EXT, objets=[{"id": "b1", "cle": "barque", "x": 2, "y": 0, "l": 1, "h": 2}])
cas("un pont caché n'enjambe pas l'eau profonde", LAC, (0, 1), (4, 1), non(R.SANS_PASSAGE_ENTRER), genres=EXT,
    objets=[{"id": "p1", "cle": "pont", "x": 1, "y": 1, "l": 1, "h": 3, "rot": 90, "cache": True}])
cas("pas de diagonale entre deux eaux profondes", ["a~", "~a"], (0, 0), (1, 1), non(R.SANS_PASSAGE_ENTRER), genres=EXT)
cas("l'eau profonde cachée se vise dans le noir comme une case cachée", ["aa=aa"], (1, 0), (2, 0), ok(1, entree=True), genres=EXT)
cas("un gué d'eau peu profonde se traverse", ["aa~aa", "aaaaa", "aa~aa"], (0, 0), (4, 0), ok(4), genres=EXT)
cas("des roseaux se traversent, une dune aussi", ["aaaaa"], (0, 0), (4, 0), ok(4), genres=EXT,
    objets=[{"id": "r1", "cle": "roseaux", "x": 1, "y": 0, "l": 1, "h": 1}, {"id": "d1", "cle": "dune", "x": 2, "y": 0, "l": 2, "h": 1}])
cas("une fontaine barre la route", ["aaaaaaa"], (0, 0), (6, 0), non(R.SANS_PASSAGE_ENTRER), genres=EXT,
    objets=[{"id": "f1", "cle": "fontaine", "x": 1, "y": 0, "l": 1, "h": 1}])
# Contrôle de la vague 5 : les ponts et les barques de H1 croisés avec les images du MJ de H2.
PONT_90 = {"id": "p1", "cle": "pont", "x": 2, "y": 1, "l": 1, "h": 3, "rot": 90}
IMAGE_SUR_RIVIERE = {"id": "i1", "cle": "image", "x": 3, "y": 0, "l": 1, "h": 3}
cas("une image du MJ posée sur la rivière barre toujours", GUE, (0, 1), (6, 1), non(R.SANS_PASSAGE_ENTRER), objets=[RIVIERE, IMAGE_SUR_RIVIERE])
cas("une image franchissable posée sur la rivière ne fait pas un gué", GUE, (0, 1), (6, 1), non(R.SANS_PASSAGE_ENTRER),
    objets=[RIVIERE, {**IMAGE_SUR_RIVIERE, "franchissable": True}])
cas("une image franchissable seule, à la place de la rivière, se traverse", GUE, (0, 1), (6, 1), ok(6),
    objets=[{**IMAGE_SUR_RIVIERE, "franchissable": True}])
cas("un pont par-dessus une image du MJ laisse passer", GUE, (0, 1), (6, 1), ok(6), objets=[IMAGE_SUR_RIVIERE, PONT_90])
cas("un pont par-dessus une image du MJ et la rivière laisse passer", GUE, (0, 1), (6, 1), ok(6),
    objets=[RIVIERE, IMAGE_SUR_RIVIERE, PONT_90])
cas("un pont caché par-dessus une image du MJ ne laisse rien passer", GUE, (0, 1), (6, 1), non(R.SANS_PASSAGE_ENTRER),
    objets=[IMAGE_SUR_RIVIERE, {**PONT_90, "cache": True}])
cas("un pont tourné de 270 degrés enjambe aussi la rivière", GUE, (0, 1), (6, 1), ok(6), objets=[RIVIERE, {**PONT_90, "rot": 270}])
cas("un pont non tourné ne couvre que sa colonne", GUE, (0, 1), (6, 1), non(R.SANS_PASSAGE_ENTRER),
    objets=[RIVIERE, {"id": "p1", "cle": "pont", "x": 2, "y": 0, "l": 1, "h": 3}])
RIVIERE_H = {"id": "r2", "cle": "riviere", "x": 0, "y": 1, "l": 7, "h": 1}
cas("une barque tournée sur une rivière en travers", GUE, (3, 0), (3, 2), ok(2),
    objets=[RIVIERE_H, {"id": "b1", "cle": "barque", "x": 3, "y": 1, "l": 1, "h": 2, "rot": 90}])
cas("on s'arrête dans la barque", GUE, (3, 0), (4, 1), ok(1),
    objets=[RIVIERE_H, {"id": "b1", "cle": "barque", "x": 3, "y": 1, "l": 1, "h": 2, "rot": 90}])
GUE_CACHE = ["aaaaAAA", "aaaaAAA", "aaaaAAA"]
PONTON = {"id": "pt", "cle": "ponton", "x": 2, "y": 1, "l": 3, "h": 1}
cas("un ponton à demi révélé : on marche sur sa partie révélée", GUE_CACHE, (0, 1), (3, 1), ok(3), objets=[RIVIERE, PONTON])
cas("un ponton à demi révélé : sa partie cachée reste hors d'atteinte", GUE_CACHE, (0, 1), (4, 1), non(R.PAS_REVELEE),
    regles=SANS_ENTRER, objets=[RIVIERE, PONTON])
cas("un ponton à demi révélé : un pas dans le noir sur sa partie cachée", GUE_CACHE, (0, 1), (4, 1), ok(4, True),
    objets=[RIVIERE, PONTON])
cas("un éboulis bouche le couloir", COULOIR, (0, 0), (6, 0), non(R.SANS_PASSAGE_ENTRER),
    objets=[{"id": "e1", "cle": "eboulis", "x": 3, "y": 0, "l": 1, "h": 1}])
cas("des gravats se traversent", COULOIR, (0, 0), (6, 0), ok(6), objets=[{"id": "g1", "cle": "gravats", "x": 3, "y": 0, "l": 1, "h": 1}])
cas("on traverse un héros", COULOIR, (0, 0), (6, 0), ok(6), pions=[{"id": "h2", "genre": "heros", "x": 3, "y": 0}])
cas("on traverse un PNJ", COULOIR, (0, 0), (6, 0), ok(6), pions=[{"id": "p1", "genre": "pnj", "x": 3, "y": 0}])
cas("la case d'un héros est prise", COULOIR, (0, 0), (3, 0), non(R.PRISE), pions=[{"id": "h2", "genre": "heros", "x": 3, "y": 0}])
cas("jamais à travers un adversaire", COULOIR, (0, 0), (6, 0), non(R.SANS_PASSAGE_ENTRER), pions=[{"id": "e1", "genre": "ennemi", "x": 3, "y": 0}])
cas("la case d'un adversaire est prise", COULOIR, (0, 0), (3, 0), non(R.PRISE), pions=[{"id": "e1", "genre": "ennemi", "x": 3, "y": 0}])
cas("un adversaire à terre se traverse", COULOIR, (0, 0), (6, 0), ok(6), pions=[{"id": "e1", "genre": "ennemi", "x": 3, "y": 0, "tombe": True}])
cas("un grand adversaire barre ses quatre cases", ["aaaaa", "aaaaa"], (0, 0), (4, 1), non(R.SANS_PASSAGE_ENTRER),
    pions=[{"id": "e1", "genre": "ennemi", "x": 2, "y": 0, "taille": 2}])
cas("un adversaire caché ne barre pas la route", COULOIR, (0, 0), (6, 0), ok(6),
    pions=[{"id": "e1", "genre": "ennemi", "x": 3, "y": 0, "cache": True}])
cas("la case d'un pion caché reste libre", COULOIR, (0, 0), (3, 0), ok(3),
    pions=[{"id": "e1", "genre": "ennemi", "x": 3, "y": 0, "cache": True}])
# Lot H2 : les images posées par le MJ, les états, les tailles et les montures.
IMAGE = {"id": "i1", "cle": "image", "x": 3, "y": 0, "l": 1, "h": 1}
cas("une image du MJ barre la route par défaut", COULOIR, (0, 0), (6, 0), non(R.SANS_PASSAGE_ENTRER), objets=[IMAGE])
cas("une image du MJ occupe sa case", COULOIR, (0, 0), (3, 0), non(R.MEUBLE), objets=[IMAGE])
cas("une image franchissable se traverse", COULOIR, (0, 0), (6, 0), ok(6), objets=[{**IMAGE, "franchissable": True}])
cas("une image franchissable au-dessus des pions se traverse", COULOIR, (0, 0), (3, 0), ok(3),
    objets=[{**IMAGE, "franchissable": True, "dessus": True}])
cas("une grande image barre toute son emprise", SALLE_5, (0, 2), (4, 2), non(R.SANS_PASSAGE_ENTRER),
    objets=[{**IMAGE, "x": 2, "y": 0, "l": 1, "h": 5}])
cas("une image tournée barre sa nouvelle emprise", SALLE_5, (0, 0), (1, 1), non(R.MEUBLE),
    objets=[{**IMAGE, "x": 1, "y": 0, "l": 2, "h": 1, "rot": 90}])
cas("une image cachée ne barre rien", COULOIR, (0, 0), (6, 0), ok(6), objets=[{**IMAGE, "cache": True}])
cas("un adversaire invisible ne barre pas la route", COULOIR, (0, 0), (6, 0), ok(6),
    pions=[{"id": "e1", "genre": "ennemi", "x": 3, "y": 0, "etats": ["invisible"]}])
cas("la case d'un adversaire invisible reste libre", COULOIR, (0, 0), (3, 0), ok(3),
    pions=[{"id": "e1", "genre": "ennemi", "x": 3, "y": 0, "etats": ["invisible", "empoisonne"]}])
cas("un adversaire empoisonné barre toujours", COULOIR, (0, 0), (6, 0), non(R.SANS_PASSAGE_ENTRER),
    pions=[{"id": "e1", "genre": "ennemi", "x": 3, "y": 0, "etats": ["empoisonne", "en-feu"]}])
cas("un héros invisible n'est pas sur le plan", SALLE_5, (1, 1), (3, 3), non(R.PAS_SUR_LE_PLAN), pion="",
    pions=[moi(1, 1, etats=["invisible"])])
cas("un héros empoisonné bouge", SALLE_5, (1, 1), (3, 3), ok(2), pion="", pions=[moi(1, 1, etats=["empoisonne"])])
cas("un petit pion bouge comme un moyen", SALLE_5, (1, 1), (3, 3), ok(2), taille=0.6)
cas("un pion énorme ne bouge pas d'ici", SALLE_5, (1, 1), (4, 4), non(R.TROP_GRAND), taille=3)
cas("un adversaire gigantesque barre ses seize cases", ["aaaaaa", "aaaaaa", "aaaaaa", "aaaaaa"], (0, 0), (5, 3), non(R.SANS_PASSAGE_ENTRER),
    pions=[{"id": "e1", "genre": "ennemi", "x": 1, "y": 0, "taille": 4}])
cas("un petit adversaire barre sa case", COULOIR, (0, 0), (6, 0), non(R.SANS_PASSAGE_ENTRER),
    pions=[{"id": "e1", "genre": "ennemi", "x": 3, "y": 0, "taille": 0.6}])
cas("un héros en selle ne bouge pas seul", SALLE_5, (1, 1), (3, 3), non(R.EN_SELLE), pion="",
    pions=[{"id": "cheval", "genre": "autre", "x": 1, "y": 1}, moi(1, 1, monture="cheval")])
cas("un héros sur une monture cachée bouge (la monture n'est pas montrée)", SALLE_5, (1, 1), (3, 3), ok(2), pion="",
    pions=[{"id": "cheval", "genre": "autre", "x": 1, "y": 1, "cache": True}, moi(1, 1, monture="cheval")])
cas("on contourne un adversaire dans une salle", SALLE_5, (0, 2), (4, 2), ok(4), pions=[{"id": "e1", "genre": "ennemi", "x": 2, "y": 2}])
cas("une case cachée de la même pièce reste hors d'atteinte", ["aaaAA"], (0, 0), (3, 0), non(R.PAS_REVELEE), regles=SANS_ENTRER)
cas("entrer par une porte ouverte", SALLE_ET_CACHEE, (0, 1), (3, 1), ok(3, True), portes=[porte(3, 1)])
cas("sans « entrer », la case derrière la porte reste hors d'atteinte", SALLE_ET_CACHEE, (0, 1), (3, 1), non(R.PAS_REVELEE),
    regles=SANS_ENTRER, portes=[porte(3, 1)])
cas("on entre d'un pas, pas plus loin", SALLE_ET_CACHEE, (0, 1), (4, 1), non(R.NOIR), portes=[porte(3, 1)])
cas("pas d'entrée par une porte fermée, sans « entrer »", SALLE_ET_CACHEE, (0, 1), (3, 1), non(R.PAS_REVELEE), regles=SANS_ENTRER,
    portes=[porte(3, 1, etat="fermee")])
cas("pas d'entrée par une porte secrète non découverte", SALLE_ET_CACHEE, (0, 1), (3, 1), non(R.NOIR),
    portes=[porte(3, 1, genre="secrete", decouverte=False)])
cas("entrer par un passage", SALLE_ET_CACHEE, (2, 1), (3, 1), ok(1, True), portes=[porte(3, 1, genre="arche", etat="fermee")])
cas("entrer compte dans la distance", SALLE_ET_CACHEE, (0, 1), (3, 1), non(R.trop_loin(2, False)),
    regles={**LIBRES, "distance": 2}, portes=[porte(3, 1)])
cas("pas de sol", ["aa#aa"], (0, 0), (2, 0), non(R.PAS_DE_SOL))
cas("du vide entre deux sols", ["aa#aa"], (0, 0), (4, 0), non(R.SANS_PASSAGE_ENTRER))
cas("hors du plan", SALLE_5, (0, 0), (5, 0), non(R.HORS_DU_PLAN))
cas("déjà là", SALLE_5, (1, 1), (1, 1), non(R.DEJA_LA))
cas("le pion a bougé entre-temps", SALLE_5, (1, 1), (3, 3), non(R.A_BOUGE))
CAS[-1]["corps"]["depuis"] = [0, 0]
cas("un héros caché n'est pas sur le plan", SALLE_5, (1, 1), (3, 3), non(R.PAS_SUR_LE_PLAN), pion="", pions=[moi(1, 1, cache=True)])
cas("un pion de deux cases ne bouge pas d'ici", SALLE_5, (1, 1), (4, 4), non(R.TROP_GRAND), taille=2)
cas("pions figés", SALLE_5, (0, 0), (1, 1), non(R.FIGES), regles={**LIBRES, "pions": "figes"})
cas("en combat, pas votre tour", SALLE_5, (0, 0), (1, 1), non(R.PAS_TON_TOUR), tour={"combat": True, "mon_tour": False, "debut": [0, 0]})
COMBAT = {"combat": True, "mon_tour": True, "debut": [0, 0]}
cas("en combat, le tour se compte depuis sa case de départ", COULOIR, (3, 0), (4, 0), ok(4), regles={**LIBRES, "distance_combat": 4}, tour=COMBAT)
cas("en combat, la distance du tour dépassée en plusieurs fois", COULOIR, (3, 0), (5, 0), non(R.trop_loin(4, True)),
    regles={**LIBRES, "distance_combat": 4}, tour=COMBAT)
cas("en combat, revenir sur ses pas", COULOIR, (3, 0), (1, 0), ok(1), regles={**LIBRES, "distance_combat": 4}, tour=COMBAT)
cas("en combat, la distance hors combat ne compte pas", COULOIR, (0, 0), (6, 0), non(R.trop_loin(2, True)),
    regles={**LIBRES, "distance": 12, "distance_combat": 2}, tour=COMBAT)
cas("en combat, une case de départ hors du plan compte depuis le pion", COULOIR, (2, 0), (4, 0), ok(2),
    regles={**LIBRES, "distance_combat": 2}, tour={"combat": True, "mon_tour": True, "debut": [40, 40]})
cas("deux zones de grotte sans paroi entre elles", ["aaabbb"], (0, 0), (5, 0), ok(5), genres={"a": "grotte", "b": "grotte"})
cas("une cour contre une salle : le mur compte", ["aaabbb"], (0, 0), (5, 0), non(R.SANS_PASSAGE_ENTRER), genres={"a": "exterieur"})
cas("deux cours côte à côte", ["aaabbb"], (0, 0), (5, 0), ok(5), genres={"a": "exterieur", "b": "exterieur"})
cas("sans brouillard, tout compte pour révélé", ["aaaBBB"], (0, 0), (5, 0), ok(5), genres={"a": "exterieur", "b": "exterieur"},
    brouillard_actif=False)


# Lot E4 : le héros ouvre les portes fermées et fait un pas dans le noir (« entrer »). Le coin ne voit que la projection :
# une porte verrouillée y est fermée, une porte secrète non découverte n'y est pas. Les cas « vrai » refont le même parcours
# avec les vraies portes, comme l'atelier : là, une porte verrouillée et une porte secrète non découverte arrêtent le héros
# (l'atelier dit alors VERROUILLEE ou MUR, mouvements.py).
cas("on ouvre une porte fermée", DEUX_SALLES, (0, 1), (4, 1), ok(4, portes=1), portes=[porte(3, 1, etat="fermee")])
cas("on ouvre une grille fermée", DEUX_SALLES, (0, 1), (4, 1), ok(4, portes=1), portes=[porte(3, 1, genre="grille", etat="fermee")])
cas("on ouvre une porte double fermée", DEUX_SALLES, (0, 1), (4, 1), ok(4, portes=1), portes=[porte(3, 1, genre="double", etat="fermee")])
cas("une porte verrouillée paraît fermée au coin : il tente", DEUX_SALLES, (0, 1), (4, 1), ok(4, portes=1),
    portes=[porte(3, 1, etat="verrouillee")])
cas("une porte posée sans mur, fermée, s'ouvre", SALLE_5, (1, 2), (2, 2), ok(1, portes=1),
    portes=[porte(2, 0, etat="fermee"), porte(2, 1, etat="fermee"), porte(2, 2, etat="fermee"), porte(2, 3, etat="fermee"), porte(2, 4, etat="fermee")])
cas("une fenêtre fermée ne s'ouvre jamais", DEUX_SALLES, (0, 1), (4, 1), non(R.SANS_PASSAGE_ENTRER),
    portes=[porte(3, 1, genre="fenetre", etat="fermee")])
cas("une porte secrète découverte et fermée s'ouvre", DEUX_SALLES, (0, 1), (4, 1), ok(4, portes=1),
    portes=[porte(3, 1, genre="secrete", etat="fermee", decouverte=True)])
cas("deux portes fermées de suite", ["aabbcc"], (0, 0), (5, 0), ok(5, portes=2), portes=[porte(2, 0, etat="fermee"), porte(4, 0, etat="fermee")])
cas("pas de diagonale à travers une porte à ouvrir", DEUX_SALLES, (2, 0), (3, 1), ok(2, portes=1), regles={**LIBRES, "distance": 2},
    portes=[porte(3, 1, etat="fermee")])
TROIS_RANGS = ["aaabbb", "aaabbb", "aaabbb"]
cas("parmi les plus courts chemins, celui qui n'ouvre aucune porte", TROIS_RANGS, (0, 1), (5, 1), ok(5),
    portes=[porte(3, 0, etat="fermee"), porte(3, 2)])
cas("parmi les plus courts chemins, le même dans l'autre sens", TROIS_RANGS, (0, 1), (5, 1), ok(5),
    portes=[porte(3, 0), porte(3, 2, etat="fermee")])
LONGUE = ["aaabbb", "aaabbb", "aaabbb", "aaabbb", "aaabbb"]
cas("le plus court d'abord, même s'il faut ouvrir une porte", LONGUE, (2, 0), (3, 0), ok(1, portes=1),
    portes=[porte(3, 0, etat="fermee"), porte(3, 4)])
cas("ouvrir une porte compte dans la distance comme un pas", DEUX_SALLES, (0, 1), (4, 1), non(R.trop_loin(3, False)),
    regles={**LIBRES, "distance": 3}, portes=[porte(3, 1, etat="fermee")])
cas("entrer par une porte fermée, qui s'ouvre", SALLE_ET_CACHEE, (0, 1), (3, 1), ok(3, True, portes=1), portes=[porte(3, 1, etat="fermee")])
cas("entrer par une porte verrouillée : le coin tente", SALLE_ET_CACHEE, (0, 1), (3, 1), ok(3, True, portes=1),
    portes=[porte(3, 1, etat="verrouillee")])
cas("un pas dans le noir, dans la même salle", ["aaaAA"], (0, 0), (3, 0), ok(3, True))
cas("un pas dans le noir, pas deux", ["aaaAAA"], (0, 0), (4, 0), non(R.NOIR))
cas("un pas dans le noir d'une grotte à demi révélée", ["aaaAA", "aaaAA"], (0, 0), (3, 1), ok(3, True), genres={"a": "grotte"})
cas("le noir d'une cour à une autre", ["aaaBBB"], (2, 0), (3, 0), ok(1, True), genres={"a": "exterieur", "b": "exterieur"})
cas("le noir d'une cour à une grotte", ["aaaBBB"], (2, 0), (3, 0), ok(1, True), genres={"a": "exterieur", "b": "grotte"})
cas("jamais dans le noir à travers un mur", SALLE_ET_CACHEE, (0, 1), (3, 1), non(R.NOIR))
cas("une cour contre une salle cachée : le mur compte", ["aaaBBB"], (2, 0), (3, 0), non(R.NOIR), genres={"a": "exterieur"})
cas("jamais dans le noir par une fenêtre", SALLE_ET_CACHEE, (2, 1), (3, 1), non(R.NOIR), portes=[porte(3, 1, genre="fenetre")])
cas("jamais dans le noir en diagonale : il faut deux pas", ["aaa", "aaA"], (1, 0), (2, 1), non(R.trop_loin(1, False)),
    regles={**LIBRES, "distance": 1})
cas("le noir en ligne droite, d'une case voisine", ["aaa", "aaA"], (1, 0), (2, 1), ok(2, True), regles={**LIBRES, "distance": 2})
cas("le noir au bord d'une grotte : la paroi arrête", ["aa%"], (0, 0), (2, 0), non(R.NOIR), genres={"a": "grotte"})
cas("le noir compte dans la distance", ["aaaAA"], (0, 0), (3, 0), non(R.trop_loin(2, False)), regles={**LIBRES, "distance": 2})
cas("sans « entrer », pas de pas dans le noir", ["aaaAA"], (0, 0), (3, 0), non(R.PAS_REVELEE), regles=SANS_ENTRER)
cas("en combat, le noir à son tour, depuis la case du début du tour", ["aaaAA"], (2, 0), (3, 0), ok(3, True),
    regles={**LIBRES, "distance_combat": 3}, tour={"combat": True, "mon_tour": True, "debut": [0, 0]})
cas("en combat, le noir hors de portée du tour", ["aaaAA"], (2, 0), (3, 0), non(R.trop_loin(2, True)),
    regles={**LIBRES, "distance_combat": 2}, tour={"combat": True, "mon_tour": True, "debut": [0, 0]})
cas("en combat, pas votre tour : ni porte ni noir", SALLE_ET_CACHEE, (0, 1), (3, 1), non(R.PAS_TON_TOUR), portes=[porte(3, 1, etat="fermee")],
    tour={"combat": True, "mon_tour": False, "debut": [0, 1]})
# Une porte secrète non découverte posée là où rien ne montre de mur : le coin ne la voit pas, l'atelier, si.
COULOIR_NOIR = ["aaAAAA"]
cas("une porte secrète sans mur : le coin ne la voit pas", COULOIR, (0, 0), (5, 0), ok(5),
    portes=[porte(3, 0, genre="secrete", etat="fermee", decouverte=False)])
cas("le noir derrière une porte secrète sans mur : le coin ne la voit pas", COULOIR_NOIR, (0, 0), (2, 0), ok(2, True),
    portes=[porte(2, 0, genre="secrete", etat="ouverte", decouverte=False)])
cas("vrai plan : une porte verrouillée arrête", DEUX_SALLES, (0, 1), (4, 1), non(R.SANS_PASSAGE_ENTRER), vrai=True,
    portes=[porte(3, 1, etat="verrouillee")])
cas("vrai plan : une porte verrouillée vers le noir arrête", SALLE_ET_CACHEE, (0, 1), (3, 1), non(R.NOIR), vrai=True,
    portes=[porte(3, 1, etat="verrouillee")])
cas("vrai plan : une porte fermée s'ouvre", DEUX_SALLES, (0, 1), (4, 1), ok(4, portes=1), vrai=True, portes=[porte(3, 1, etat="fermee")])
cas("vrai plan : une porte secrète non découverte arrête comme un mur", COULOIR, (0, 0), (5, 0), non(R.SANS_PASSAGE_ENTRER), vrai=True,
    portes=[porte(3, 0, genre="secrete", etat="fermee", decouverte=False)])
cas("vrai plan : même ouverte, une porte secrète non découverte arrête", COULOIR, (0, 0), (5, 0), non(R.SANS_PASSAGE_ENTRER), vrai=True,
    portes=[porte(3, 0, genre="secrete", etat="ouverte", decouverte=False)])
cas("vrai plan : le noir derrière une porte secrète non découverte reste fermé", COULOIR_NOIR, (0, 0), (2, 0), non(R.NOIR), vrai=True,
    portes=[porte(2, 0, genre="secrete", etat="ouverte", decouverte=False)])
cas("vrai plan : une porte secrète découverte s'ouvre", DEUX_SALLES, (0, 1), (4, 1), ok(4, portes=1), vrai=True,
    portes=[porte(3, 1, genre="secrete", etat="fermee", decouverte=True)])
cas("vrai plan : une porte verrouillée contournée par une autre porte", LONGUE, (2, 0), (3, 0), ok(9, portes=1), vrai=True,
    portes=[porte(3, 0, etat="verrouillee"), porte(3, 4, etat="fermee")])
cas("vrai plan : la porte verrouillée contournée, trop loin", LONGUE, (2, 0), (3, 0), non(R.trop_loin(6, False)), vrai=True,
    regles={**LIBRES, "distance": 6}, portes=[porte(3, 0, etat="verrouillee"), porte(3, 4, etat="fermee")])


def complets():
    """Toutes les cases atteignables de chaque cas (sans limite), telles que les trouve app/commun/deplacement.py, et le chemin
    retenu d'un déplacement permis (les portes qu'il ouvre en dépendent : le même des deux côtés)."""
    for c in CAS:
        try:
            c["chemin"] = dp.verifier(c["plan"], c["corps"], c["regles"], c["tour"])["chemin"]
        except dp.Refus:
            c["chemin"] = None
        try:
            g = dp.Grille(c["plan"], c["corps"]["pion"])
        except dp.Refus:
            c["atteignables"] = []
            continue
        if g.moi is None:
            c["atteignables"] = []
            continue
        depart = dp.case_du_pion(g.moi)
        vus = dp.atteignables(c["plan"], "moi", depart, c["regles"].get("entrer") is True)
        c["atteignables"] = sorted(ligne(x, y, d, e, n) for (x, y), (d, e, n) in vus.items())


def ligne(x, y, d, entree, portes) -> str:
    """Une case atteignable, comme la lisent les deux côtés : « x,y,distance », « ,e » si cachée, « ,pN » si N portes."""
    return f"{x},{y},{d}{',e' if entree else ''}{f',p{portes}' if portes else ''}"


if __name__ == "__main__":
    complets()
    noms = [c["nom"] for c in CAS]
    assert len(noms) == len(set(noms)), "deux cas du même nom"
    sortie = ICI.parent / "tests" / "deplacement-cas.json"
    lignes = ",\n".join("    " + json.dumps(c, ensure_ascii=False, separators=(",", ":")) for c in CAS)
    sortie.write_text('{\n  "cas": [\n' + lignes + "\n  ]\n}\n", encoding="utf-8")
    print(f"{len(CAS)} cas écrits dans {sortie.relative_to(ICI.parent)}")
