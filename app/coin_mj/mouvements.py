"""Les déplacements des joueurs dans l'atelier : ce que la file des demandes (boite.py) fait d'un
« deplacement » (deplacement.py), le journal des mouvements de chaque plan, la case du début du tour en combat, et le rejeu
qui évite au MJ de perdre son travail quand son éditeur enregistre un plan en retard.

- Pions libres : la demande s'applique seule (« Annuler » dans la boîte). Pions à valider : elle attend le MJ, qui
  l'accepte ou la refuse dans la boîte (ou d'un clic sur le plan). Pions figés : refusée.
- Avant de poser le pion, tout se revérifie sur la projection publique du plan du moment (plan_public) : le plan que
  montre la TV, le pion du héros de ce joueur, la case où le joueur le voyait (si le MJ l'a bougé entre-temps, c'est son
  geste qui gagne), le tour au combat, le chemin et la distance : les refus du coin, et eux seuls.
- Puis le même parcours sur le vrai plan (deplacement.plan_vrai : la projection avec les vraies portes). Deux refus, et
  deux seulement, en dépendent : une porte verrouillée (VERROUILLEE) et un mur que le joueur ne pouvait pas voir (MUR :
  une porte secrète non découverte, ou un pas dans le noir sur une case sans sol, d'eau profonde ou de falaise). Une porte
  secrète se refuse donc exactement comme un mur : même phrase, mêmes calculs, même trace ; seul le MJ apprend ce que
  c'était (tentatives, lues par la boîte et l'éditeur, jamais par le coin).
- Si le MJ le permet (« entrer », lot E4), le héros ouvre les portes fermées de son chemin (le plus court, qui en ouvre le
  moins : elles passent à « ouverte ») et la case cachée où il arrive se révèle (a_reveler) : toute la pièce si elle était
  entièrement cachée (une salle, une grotte, comme plan/entrer.js) ; sinon (une pièce déjà entamée au pinceau, une zone
  extérieure) les seules cases de la même pièce à deux cases au plus de lui, sans franchir de porte fermée.
- Ce que le joueur ne voit pas ne refuse rien d'autre, mais le MJ en est prévenu : un pion caché sur la case d'arrivée,
  une porte qui donnait sur le vide, un meuble dans le noir (la boîte et l'éditeur le disent).
- Chaque mouvement est note dans data/plans-mouvements/<plan>.json, avec la version du plan d'avant et d'après, les
  cases révélées et les portes ouvertes. Quand l'éditeur du MJ enregistre une version en retard et que tout ce qui a
  changé depuis n'est que des mouvements notes, rejouer() les réapplique sur ce qu'il envoie (aux pions et aux portes
  qu'il n'a pas touchés : son geste gagne) au lieu d'un conflit.
- Après un mouvement, la TV relit le plan (diffusion), la table du coin est republiée, et les pages de l'atelier
  reçoivent {"type": "plan", "plan", "mouvements"} : l'éditeur ouvert sur ce plan pose le pion sans recharger.

Ce module ne connaît de l'atelier que les fonctions que main.py lui passe.
"""
import asyncio
import logging
import math
import secrets
import threading
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Awaitable, Callable

from commun import deplacement as dp
from table import pions_plan
from commun.demandes import Refus
from commun import stockage

journal = logging.getLogger("atelier.mouvements")

DOSSIER = "plans-mouvements"
GARDES = 200  # mouvements gardés par plan : assez pour rejouer un éditeur resté longtemps en retard
TOURS = "tours-combat.json"
TENTATIVES = "plans-tentatives.json"  # ce qui a arrêté un héros sur le vrai plan : pour le MJ seul
TENTATIVES_GARDEES = 200
RAYON = 2  # cases révélées autour d'un héros qui avance dans une pièce déjà entamée ou une zone extérieure
DIRECTIONS = {(0, -1): "le nord", (1, -1): "le nord-est", (1, 0): "l'est", (1, 1): "le sud-est", (0, 1): "le sud",
              (-1, 1): "le sud-ouest", (-1, 0): "l'ouest", (-1, -1): "le nord-ouest"}
PLUS_LA, TABLE_FERMEE = dp.PLUS_LA, dp.TABLE_FERMEE
A_VALIDER = "Votre MJ valide maintenant chaque déplacement : touchez de nouveau la case."


def plus_tard(avant, instant: str) -> str:
    """Une version strictement après la précédente : deux mouvements dans la même milliseconde ne portent jamais la même
    version (sinon un éditeur à jour de l'un écraserait l'autre)."""
    if isinstance(avant, str) and instant <= avant:
        try:
            return (datetime.fromisoformat(avant) + timedelta(milliseconds=1)).isoformat(timespec="milliseconds")
        except ValueError:
            pass
    return instant


def meme_place(a, b) -> bool:
    return (isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)) and len(a) == 2 and len(b) == 2
            and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (*a, *b))
            and abs(a[0] - b[0]) < 1e-6 and abs(a[1] - b[1]) < 1e-6)


def place(t: dict) -> list:
    return [t.get("x"), t.get("y")]


def porte_de_l_arete(p: dict, x: int, y: int, dx: int, dy: int) -> dict | None:
    """La porte posée entre (x, y) et son voisin orthogonal (dx, dy), comme deplacement.Grille.porte."""
    cle = ("v", x + 1 if dx > 0 else x, y) if dx else ("h", x, y + 1 if dy > 0 else y)
    return next((d for d in p.get("portes") or [] if isinstance(d, dict) and (d.get("sens"), d.get("x"), d.get("y")) == cle), None)


def a_reveler(p: dict, case: tuple) -> tuple[list, str | None]:
    """(cases, comment) : ce que révèle un héros qui arrive sur cette case encore cachée. « piece » : toute la pièce, si elle
    était entièrement cachée et n'est pas une zone extérieure (la règle d'avant, celle de plan/entrer.js). « autour » :
    sinon (une pièce déjà entamée au pinceau, une cour, un pré), les cases de la même pièce à RAYON cases au plus du héros,
    reliées à lui sans franchir de porte qui ne soit pas ouverte : une grande zone ne se révèle jamais d'un pas, et rien
    d'une autre pièce ni de derrière une porte. Rien sur une case sans sol, déjà révélée, ou sans brouillard."""
    if not p.get("brouillard_actif", True):
        return [], None
    w, h = int(p["largeur"]), int(p["hauteur"])
    sol, piece, vu = p.get("sol") or [], p.get("piece") or [], p.get("brouillard") or []
    n = w * h
    x, y = case
    if len(sol) != n or len(piece) != n or len(vu) != n or not (0 <= x < w and 0 <= y < h):
        return [], None
    i = y * w + x
    if vu[i] == 1 or not sol[i]:
        return [], None
    ident = piece[i]
    genres = {pc.get("id"): pc.get("genre") or "salle" for pc in p.get("pieces") or [] if isinstance(pc, dict)}
    meme = [k for k in range(n) if sol[k] and piece[k] == ident]
    if ident and genres.get(ident, "salle") != "exterieur" and not any(vu[k] == 1 for k in meme):
        return [k for k in meme if vu[k] != 1], "piece"
    vus, file, res = {(x, y)}, deque([(x, y)]), []
    while file:
        cx, cy = file.popleft()
        if vu[cy * w + cx] != 1:
            res.append(cy * w + cx)
        for dx, dy in ((0, -1), (1, 0), (0, 1), (-1, 0)):
            nx, ny = cx + dx, cy + dy
            if (nx, ny) in vus or not (0 <= nx < w and 0 <= ny < h) or max(abs(nx - x), abs(ny - y)) > RAYON:
                continue
            j = ny * w + nx
            if not sol[j] or piece[j] != ident:
                continue
            d = porte_de_l_arete(p, cx, cy, dx, dy)
            if d is not None and dp.etat_porte(d) != dp.OUVERTE:
                continue
            vus.add((nx, ny))
            file.append((nx, ny))
    return sorted(res), "autour"


def meuble_dans_le_noir(p: dict, case: tuple) -> str | None:
    """Le meuble (ou l'image du MJ) qui barre cette case cachée, que la projection ne montrait pas (même emprise que
    deplacement.Grille) : le MJ en est prévenu, rien n'est refusé. Rien sous un pont, un ponton, une barque."""
    x, y = case
    meuble, dessus = None, False
    for o in p.get("objets") or []:
        if not isinstance(o, dict):
            continue
        tourne = dp.nombre(o.get("rot")) % 180 != 0
        l, hh = (dp.nombre(o.get("h"), 1), dp.nombre(o.get("l"), 1)) if tourne else (dp.nombre(o.get("l"), 1), dp.nombre(o.get("h"), 1))
        x0, y0 = dp.nombre(o.get("x")), dp.nombre(o.get("y"))
        if not (math.floor(x0) <= x < math.ceil(x0 + l) and math.floor(y0) <= y < math.ceil(y0 + hh)):
            continue
        if o.get("cle") in dp.PASSAGES_MEUBLES:
            dessus = True
        elif not dp.franchissable(o) and meuble is None:
            meuble = str(o.get("cle") or "un meuble")[:60]
    return None if dessus else meuble


def sur_un_passage(p: dict, case: tuple) -> bool:
    """Un pont, un ponton ou une barque que les joueurs pourraient voir couvre-t-il cette case ? (On y marche, même
    par-dessus l'eau profonde.)"""
    x, y = case
    for o in p.get("objets") or []:
        if not isinstance(o, dict) or o.get("cache") or o.get("cle") not in dp.PASSAGES_MEUBLES:
            continue
        tourne = dp.nombre(o.get("rot")) % 180 != 0
        l, hh = (dp.nombre(o.get("h"), 1), dp.nombre(o.get("l"), 1)) if tourne else (dp.nombre(o.get("l"), 1), dp.nombre(o.get("h"), 1))
        x0, y0 = dp.nombre(o.get("x")), dp.nombre(o.get("y"))
        if math.floor(x0) <= x < math.ceil(x0 + l) and math.floor(y0) <= y < math.ceil(y0 + hh):
            return True
    return False


def caches_sur(p: dict, t: dict, case: tuple) -> list:
    """Les pions que les joueurs ne voient pas, sur cette case : cachés, dans le noir d'une case encore cachée (la pièce
    où le héros entre par une porte), ou perdus dans la brume épaisse (sauf un héros)."""
    w = int(p["largeur"])
    brume = p.get("brume") if isinstance(p.get("brume"), list) else []
    vu = p.get("brouillard") if isinstance(p.get("brouillard"), list) else []
    actif = p.get("brouillard_actif", True) is not False
    noms = []
    for x in p.get("pions") or []:
        if x is t or not isinstance(x, dict) or "x" not in x or "y" not in x or case not in dp.cases_sous(x):
            continue
        i = case[1] * w + case[0]
        epaisse = x.get("genre") != "heros" and 0 <= i < len(brume) and brume[i] == 2
        sombre = actif and not (0 <= i < len(vu) and vu[i] == 1)
        if x.get("cache") or pions_plan.invisible(x) or epaisse or sombre:
            noms.append(str(x.get("nom") or x.get("court") or "un pion")[:60])
    return noms


@dataclass
class Fait:
    """Un mouvement posé pendant une vague, en attente de ses suites (TV, coin, éditeur)."""
    plan: str
    mouvement: dict


class Mouvements:
    def __init__(self, donnees: Path, *, reglage: Callable[[], dict], plan_montre: Callable[[], tuple | None],
                 plan_par_id: Callable[[str], tuple | None], ecrire_plan: Callable[[Path, dict], None],
                 projection: Callable[[dict, str], dict], heros_du_joueur: Callable[[str], dict | None],
                 seances: Callable[[], list], diffuser: Callable[[], Awaitable[None]], publier_coin: Callable[[], object],
                 signaler: Callable[[dict], Awaitable[None]], maintenant: Callable[[], str]):
        self.dossier = donnees / DOSSIER
        self.fichier_tours = donnees / TOURS
        self.fichier_tentatives = donnees / TENTATIVES
        self.reglage = reglage
        self.plan_montre = plan_montre
        self.plan_par_id = plan_par_id
        self.ecrire_plan = ecrire_plan
        self.projection = projection
        self.heros_du_joueur = heros_du_joueur
        self.seances = seances
        self.diffuser = diffuser
        self.publier_coin = publier_coin
        self.signaler = signaler
        self.maintenant = maintenant
        # Toute écriture d'un plan par ce module, et l'enregistrement d'un plan par l'éditeur (main.py, routes_fiches) :
        # un « Accepter » de la boîte (dans un fil à part) ne passe jamais entre la lecture et l'écriture de l'éditeur.
        self.verrou = threading.RLock()
        self.faits: dict[str, Fait] = {}
        self.journaux: dict[str, tuple] = {}  # plan → (empreinte du fichier, ses mouvements)
        self.tentatives_lues: tuple | None = None  # (empreinte du fichier, son contenu)

    def brancher(self, boite) -> None:
        boite.brancher(dp.GENRE, appliquer=self.appliquer, accepter=self.accepter, annuler=self.annuler, apres=self.apres,
                       dire=self.dire)

    # ------------------------------------------------------------ le journal des mouvements

    def fichier(self, plan: str) -> Path:
        return self.dossier / f"{plan}.json"

    def lire_journal(self, plan: str) -> list:
        """Le journal d'un plan, gardé en mémoire tant que son fichier ne bouge pas : la boîte relit la ligne de chaque
        déplacement (dire) à chaque passage, dans la boucle, et cherche dans tous les journaux. Ne pas modifier la liste
        rendue."""
        chemin = self.fichier(plan)
        try:
            st = chemin.stat()
        except OSError:
            return []
        cle = (st.st_ino, st.st_size, st.st_mtime_ns)
        deja = self.journaux.get(plan)
        if deja and deja[0] == cle:
            return deja[1]
        try:
            liste = stockage.lire_json(chemin)
        except (OSError, ValueError):
            return []
        propre = [m for m in liste if isinstance(m, dict) and isinstance(m.get("id"), str)] if isinstance(liste, list) else []
        self.journaux[plan] = (cle, propre)
        return propre

    def noter(self, plan: str, m: dict) -> None:
        liste = [*self.lire_journal(plan), m][-GARDES:]
        chemin = self.fichier(plan)
        chemin.parent.mkdir(parents=True, exist_ok=True)
        stockage.ecrire_json_compact(chemin, liste)

    def du_journal(self, demande: str) -> dict | None:
        """Le mouvement qu'a posé cette demande (le plus récent), où qu'il soit."""
        if not self.dossier.exists():
            return None
        for f in self.dossier.glob("*.json"):
            for m in reversed(self.lire_journal(f.stem)):
                if m.get("demande") == demande and m.get("genre") != "annulation":
                    return m
        return None

    def poser(self, chemin: Path, p: dict, t: dict, apres: list, cases: list, valeur: int, *, genre: str, demande: str | None,
              joueur: str | None, alertes: list, portes: list = (), revele: str | None = None) -> dict:
        """Pose le pion, change ces cases du brouillard et l'état de ces portes ({sens, x, y, avant, apres} : seulement
        celles qui sont encore dans l'état d'avant), enregistre le plan sous une version nouvelle, note le mouvement. À
        appeler sous le verrou."""
        avant_version = p.get("modifie")
        avant = place(t)
        t["x"], t["y"] = apres
        if cases:
            vu = p["brouillard"]
            for i in cases:
                vu[i] = valeur
        faites = []
        for c in portes:
            d = next((x for x in p.get("portes") or [] if isinstance(x, dict) and (x.get("sens"), x.get("x"), x.get("y")) == (c["sens"], c["x"], c["y"])), None)
            if d is not None and (d.get("etat") or "fermee") == c["avant"]:
                d["etat"] = c["apres"]
                faites.append(dict(c))
        p["modifie"] = plus_tard(avant_version, self.maintenant())
        self.ecrire_plan(chemin, p)
        m = {"id": secrets.token_hex(6), "plan": p["id"], "genre": genre, "demande": demande, "joueur": joueur, "pion": t.get("id"),
             "avant": avant, "apres": list(apres), "cases": cases, "brouillard": valeur, "portes": faites, "revele": revele,
             "w": p["largeur"], "h": p["hauteur"], "version_avant": avant_version, "version_apres": p["modifie"],
             "quand": self.maintenant(), "alertes": alertes}
        self.noter(p["id"], m)
        return m

    # ------------------------------------------------------------ ce qui a arrêté un héros (le MJ seul le lit)

    def lire_tentatives(self) -> dict:
        """Gardées en mémoire tant que le fichier ne bouge pas : la boîte relit la ligne de chaque déplacement en échec à
        chaque passage. Ne pas modifier le dictionnaire rendu."""
        try:
            st = self.fichier_tentatives.stat()
        except OSError:
            return {}
        cle = (st.st_ino, st.st_size, st.st_mtime_ns)
        if self.tentatives_lues and self.tentatives_lues[0] == cle:
            return self.tentatives_lues[1]
        try:
            v = stockage.lire_json(self.fichier_tentatives)
        except (OSError, ValueError):
            return {}
        v = v if isinstance(v, dict) else {}
        self.tentatives_lues = (cle, v)
        return v

    def noter_tentative(self, demande: str, plan: str, raison: str, joueur: str | None) -> None:
        """Ce qui a vraiment arrêté le héros : « verrouillee », « secrete » ou « mur ». Dans les données de l'atelier, jamais
        dans les propositions que lit le coin. Noté pour chacun des trois, du même geste : le refus prend le même temps."""
        tout = dict(self.lire_tentatives())
        tout[demande] = {"plan": plan, "raison": raison, "joueur": joueur, "quand": self.maintenant()}
        tout = dict(sorted(tout.items(), key=lambda kv: str((kv[1] or {}).get("quand")))[-TENTATIVES_GARDEES:])
        try:
            stockage.ecrire_json_compact(self.fichier_tentatives, tout)
        except OSError:
            journal.warning("Tentative d'un joueur non notee")

    def tentatives(self, plan: str, depuis_secondes: int = 600) -> list:
        """Ce qui a arrêté les héros sur ce plan ces dernières minutes, pour l'éditeur du MJ (un mot à chaque nouvelle)."""
        limite = (datetime.now() - timedelta(seconds=depuis_secondes)).isoformat(timespec="milliseconds")
        res = []
        for demande, x in self.lire_tentatives().items():
            if isinstance(x, dict) and x.get("plan") == plan and str(x.get("quand") or "") >= limite:
                res.append({"id": demande, "raison": x.get("raison"), "phrase": self.phrase_tentative(x), "quand": x.get("quand")})
        return sorted(res, key=lambda x: str(x["quand"]))

    def phrase_tentative(self, x: dict) -> str:
        heros = self.heros_du_joueur(x["joueur"]) if isinstance(x.get("joueur"), str) else None
        nom = str((heros or {}).get("nom") or "Un héros").split(" ")[0]
        e = "e" if (heros or {}).get("genre") == "f" else ""
        return {"secrete": f"{nom} a tâté votre porte secrète sans la trouver : refusé comme un mur.",
                "verrouillee": f"{nom} a trouvé la porte fermée à clé.",
                "mur": f"{nom} s'est heurté{e} à un mur dans le noir : la case visée n'a pas de sol.",
                "infranchissable": f"{nom} a buté dans le noir sur de l'eau profonde ou une falaise : refusé comme un mur."}.get(x.get("raison"), "")

    # ------------------------------------------------------------ le tour au combat

    def lire_tours(self) -> dict:
        try:
            v = stockage.lire_json(self.fichier_tours)
        except (OSError, ValueError):
            return {}
        return v if isinstance(v, dict) else {}

    def ecrire_tours(self, tours: dict) -> None:
        stockage.ecrire_json_compact(self.fichier_tours, tours)

    def combat_du_heros(self, heros: str) -> dict:
        """{combat, mon_tour, cle} : le héros est-il dans le combat d'une séance non close (le premier trouvé), et a-t-il la
        main ? Une séance close garde parfois un combat périmé : il ne compte pas. cle : ce tour-ci de ce héros."""
        ref = f"aventurier:{heros}"
        for s in self.seances():
            if s.get("close") is True or not isinstance(s.get("combat"), dict):
                continue
            c = s["combat"]
            ordre = c.get("ordre") if isinstance(c.get("ordre"), list) else []
            if ref not in ordre:
                continue
            actif = c.get("actif")
            main = dp.entier(actif) and 0 <= actif < len(ordre) and ordre[actif] == ref
            tour = c.get("tour") if dp.entier(c.get("tour")) else 1
            return {"combat": True, "mon_tour": bool(main), "cle": f"{s.get('id')}:{c.get('id')}:{tour}:{actif}" if main else None}
        return {"combat": False, "mon_tour": False, "cle": None}

    def tour_du_heros(self, heros: str, plan: str, case: tuple | None, cle: str | None = None) -> dict:
        """{combat, mon_tour, debut} pour le parcours : en combat et à son tour, debut est la case où son tour a commencé,
        notee au premier regard sur ce tour (son pion là où il est, s'il n'y a rien de note pour ce tour et ce plan)."""
        c = self.combat_du_heros(heros)
        tour = {"combat": c["combat"], "mon_tour": c["mon_tour"], "debut": None}
        if not c["mon_tour"] or case is None:
            return tour
        # Un familier (19/11) a sa propre case de début, notée sous « <héros>#<pion> » : il bouge au tour de son héros.
        cle = cle or heros
        with self.verrou:
            tours = self.lire_tours()
            note = tours.get(cle) if isinstance(tours.get(cle), dict) else {}
            if note.get("cle") != c["cle"] or note.get("plan") != plan or not isinstance(note.get("case"), list):
                tours[cle] = {"cle": c["cle"], "plan": plan, "case": list(case)}
                try:
                    self.ecrire_tours(tours)
                except OSError:
                    journal.warning("Case du début du tour non notee pour %s", cle)
                note = tours[cle]
        tour["debut"] = list(note["case"])
        return tour

    def tour_change(self, combat: dict | None) -> None:
        """Un combat enregistré (main.py, PUT du combat) : le héros qui a la main voit son tour commencer là où est son pion
        sur le plan de la TV (s'il y est ; sinon, au premier regard sur ce tour)."""
        ordre = (combat or {}).get("ordre") if isinstance((combat or {}).get("ordre"), list) else []
        actif = (combat or {}).get("actif")
        ref = ordre[actif] if dp.entier(actif) and 0 <= actif < len(ordre) else None
        if not isinstance(ref, str) or not ref.startswith("aventurier:"):
            return
        montre = self.plan_montre()
        if not montre:
            return
        p = montre[1]
        t = next((x for x in p.get("pions") or [] if isinstance(x, dict) and x.get("ref") == ref), None)
        if t is not None and "x" in t and "y" in t:
            self.tour_du_heros(ref.split(":", 1)[1], p["id"], dp.case_du_pion(t))

    def tour_publie(self, heros: str, plan: dict, pion: dict | None, familier: bool = False) -> dict:
        """Ce que la table du coin publie pour le pion d'un joueur (table_joueurs.py, pions/<clé>.json) : son tour au combat
        et la case du début de ce tour, rien d'autre. familier : celui d'un de ses familiers, noté à part."""
        case = dp.case_du_pion(pion) if pion and "x" in pion and "y" in pion else None
        return self.tour_du_heros(heros, plan.get("id"), case, f"{heros}#{pion.get('id')}" if familier and pion else None)

    # ------------------------------------------------------------ appliquer, accepter, annuler

    def regles(self) -> dict:
        r = self.reglage()
        return {k: r[k] for k in ("ouverte", "pions", "distance", "distance_combat", "entrer")}

    def appliquer(self, j: dict, d: dict) -> str:
        """Pions libres : posé seul. Le réglage se relit ici : à valider ou figés entre-temps, la demande échoue."""
        r = self.regles()
        if not r["ouverte"]:
            raise Refus(423, TABLE_FERMEE)
        if r["pions"] == "figes":
            raise Refus(423, dp.FIGES)
        if r["pions"] == "a-valider":
            raise Refus(409, A_VALIDER)
        return self.deplacer(j, d, r)

    def accepter(self, j: dict, d: dict, mot: str) -> str:
        """Le MJ accepte : son geste passe outre le réglage (figés compris), pas le chemin ni le tour."""
        return self.deplacer(j, d, {**self.regles(), "pions": "libres"})

    def deplacer(self, j: dict, d: dict, regles: dict) -> str:
        corps = d["corps"]
        with self.verrou:
            montre = self.plan_montre()
            if not montre or montre[2] != corps["plan"]:
                raise Refus(409, PLUS_LA)
            chemin, p, jeton = montre
            heros = self.heros_du_joueur(j["id"])
            ref = f"aventurier:{heros['id']}" if heros else None
            t = next((x for x in p.get("pions") or [] if isinstance(x, dict) and ref and x.get("ref") == ref), None)
            # Ou l'un de ses familiers (19/11) : un pion « familier:<son héros> », désigné par son id.
            familier = next((x for x in p.get("pions") or [] if isinstance(x, dict) and heros and x.get("ref") == f"familier:{heros['id']}"
                             and x.get("id") == corps["pion"]), None)
            if familier is not None:
                t = familier
            if t is None or t.get("id") != corps["pion"]:
                raise Refus(409, dp.PAS_SUR_LE_PLAN)
            public = self.projection(p, jeton)
            tour = self.tour_du_heros(heros["id"], p["id"], dp.case_du_pion(t), f"{heros['id']}#{t['id']}" if familier is not None else None)
            # D'abord ce que voit le joueur : les mêmes refus que le coin. Puis le vrai plan, qui décide.
            dp.verifier(public, corps, regles, tour)
            res = self.sur_le_vrai_plan(p, public, corps, regles, tour, d["id"], j.get("id"))
            vx, vy = corps["vers"]
            alertes = [f"Un pion que les joueurs ne voient pas est sur cette case : {', '.join(n)}." for n in [caches_sur(p, t, (vx, vy))] if n]
            w = int(p["largeur"])
            if res["entree"] and not (p.get("sol") or [0] * (w * int(p["hauteur"])))[vy * w + vx]:
                alertes.append("La porte donnait sur une case sans sol : le pion y est, hors de la vue des joueurs.")
            meuble = meuble_dans_le_noir(p, (vx, vy)) if res["entree"] else None
            if meuble:
                alertes.append(f"Le héros est entré dans le noir sur une case où se tient un meuble ({meuble}).")
            portes = [{"sens": x.get("sens"), "x": x.get("x"), "y": x.get("y"), "avant": x.get("etat") or "fermee", "apres": "ouverte"}
                      for x in res["portes"]]
            cases, revele = a_reveler(p, (vx, vy)) if regles.get("entrer") and res["entree"] and t.get("genre") == "heros" else ([], None)
            m = self.poser(chemin, p, t, [vx + 0.5, vy + 0.5], cases, 1, genre="joueur", demande=d["id"], joueur=j["id"],
                           alertes=alertes, portes=portes, revele=revele if cases else None)
        self.faits[d["id"]] = Fait(p["id"], m)
        n = res["distance"]
        ouvertes = len(m["portes"])
        return (f"Fait : {n} case{'s' if n > 1 else ''}"
                + (f", {'une porte ouverte' if ouvertes == 1 else f'{ouvertes} portes ouvertes'}" if ouvertes else "")
                + (", et la pièce se révèle." if revele == "piece" and cases else ", et les alentours se révèlent." if cases else "."))

    def sur_le_vrai_plan(self, p: dict, public: dict, corps: dict, regles: dict, tour: dict, demande: str, joueur) -> dict:
        """Le même parcours, sur la projection avec les vraies portes (deplacement.plan_vrai) : rend son verdict (le chemin
        retenu, les vraies portes à ouvrir), ou lève VERROUILLEE ou MUR. Une porte secrète non découverte et un mur que le
        joueur ne voit pas se refusent avec la même phrase, après les mêmes calculs et la même écriture : ni le texte, ni
        le statut, ni le temps ne les distinguent. Seul le MJ apprend ce que c'était (noter_tentative)."""
        portes = [x for x in p.get("portes") or [] if isinstance(x, dict)]
        vrai = dp.plan_vrai(public, portes)

        def passe(plan: dict) -> dict | None:
            try:
                return dp.verifier(plan, corps, regles, tour)
            except Refus:
                return None

        res = passe(vrai)
        vide = infranchissable = False
        if res is not None and res["entree"] and len(res["chemin"]) >= 2:
            # Un pas dans le noir sans porte, sur une case sans sol : rien où poser le pied, le héros bute comme sur un mur.
            # Par une porte, c'est une sortie (le pion y va, le MJ est prévenu), comme avant.
            (ax, ay), (vx, vy) = res["chemin"][-2], res["chemin"][-1]
            w, h = int(p["largeur"]), int(p["hauteur"])
            sol = p.get("sol") or []
            vide = porte_de_l_arete(p, ax, ay, vx - ax, vy - ay) is None and not (len(sol) == w * h and sol[vy * w + vx])
            # De même l'eau profonde ou la falaise d'un extérieur (sans pont dessus), par une porte ou sans : on n'y pose pas
            # le pied (une porte de cabane tracée par le MJ au bord de l'eau). Il bute, refusé comme un mur, et seul le MJ
            # apprend que c'était de l'eau ou du roc.
            infranchissable = (not vide and len(sol) == w * h and dp.sol_infranchissable(sol[vy * w + vx])
                               and not sur_un_passage(p, (vx, vy)))
        if res is not None and not vide and not infranchissable:
            return res
        # Un refus. Le même calcul de plus, quelle qu'en soit la raison (une porte verrouillée, une porte secrète, une case
        # sans sol) : le temps de la réponse n'en dit rien. Seules les vraies portes diffèrent de la projection : si le héros
        # passait avec les portes verrouillées ouvertes, c'est une serrure ; sinon une porte secrète non découverte.
        sans_verrou = passe(dp.plan_vrai(public, [{**x, "etat": "fermee"} if x.get("etat") == "verrouillee" else x for x in portes]))
        raison = "mur" if vide else "infranchissable" if infranchissable else "verrouillee" if sans_verrou is not None else "secrete"
        self.noter_tentative(demande, p["id"], raison, joueur)
        raise Refus(409, dp.VERROUILLEE if raison == "verrouillee" else dp.MUR)

    def annuler(self, j: dict, d: dict) -> str:
        """« Annuler » de la boîte : le pion revient à sa case d'avant, les portes qu'il avait ouvertes se referment, et ce
        que son entrée avait révélé se cache de nouveau, sauf là où un autre héros se tient désormais, et sauf ce que le MJ
        a déjà recaché lui-même. Ce que le MJ a changé entre-temps (une porte refermée ou verrouillée, d'autres cases
        révélées) reste comme il l'a laissé. Refusé si le pion a bougé depuis."""
        with self.verrou:
            m = self.du_journal(d["id"])
            lu = self.plan_par_id(m["plan"]) if m and isinstance(m.get("plan"), str) else None
            if not m or not lu:
                raise Refus(409, "Ce déplacement n'est plus dans le journal du plan : déplacez le pion depuis l'éditeur.")
            chemin, p = lu
            t = next((x for x in p.get("pions") or [] if isinstance(x, dict) and x.get("id") == m["pion"]), None)
            if t is None:
                raise Refus(409, "Ce pion n'est plus sur le plan.")
            if not meme_place(place(t), m["apres"]):
                raise Refus(409, "Le pion a bougé depuis : déplacez-le depuis l'éditeur.")
            cases = []
            if m.get("cases") and p.get("largeur") == m.get("w") and p.get("hauteur") == m.get("h"):
                w = int(p["largeur"])
                tenues = set()
                for x in p.get("pions") or []:
                    if x is not t and isinstance(x, dict) and x.get("genre") == "heros" and not x.get("cache") and "x" in x:
                        tenues.update(cy * w + cx for cx, cy in dp.cases_sous(x))
                cases = [i for i in m["cases"] if i not in tenues and p["brouillard"][i] == 1]
            # Les portes que ce déplacement a ouvertes se referment, si elles sont encore ouvertes : une porte que le MJ a
            # refermée, verrouillée ou ôtée depuis reste comme il l'a laissée (poser ne change que l'état attendu).
            portes = [{**c, "avant": c["apres"], "apres": c["avant"]} for c in m.get("portes") or [] if isinstance(c, dict)]
            r = self.poser(chemin, p, t, list(m["avant"]), cases, 0, genre="annulation", demande=d["id"], joueur=j.get("id"),
                           alertes=[], portes=portes)
        self.faits[d["id"]] = Fait(p["id"], r)
        return "Votre MJ a remis votre pion à sa place."

    async def apres(self, liste: list) -> None:
        """Après une vague (ou un geste du MJ dans la boîte) : la TV relit le plan, la table du coin se republie tout de
        suite (le joueur voit son pion bouger), puis les pages de l'atelier reçoivent les mouvements de chaque plan."""
        par_plan: dict[str, list] = {}
        for _, d in liste:
            f = self.faits.pop(d.get("id"), None) if isinstance(d, dict) else None
            if f:
                par_plan.setdefault(f.plan, []).append(f.mouvement)
        if not par_plan:
            return
        await self.diffuser()
        try:
            await asyncio.to_thread(self.publier_coin)
        except Exception:
            journal.exception("Table du coin non republiée après un déplacement")
        for plan, mouvements in par_plan.items():
            await self.signaler({"type": "plan", "plan": plan, "mouvements": [self.pour_l_editeur(m) for m in mouvements]})

    @staticmethod
    def pour_l_editeur(m: dict) -> dict:
        return {k: m.get(k) for k in ("id", "genre", "pion", "avant", "apres", "cases", "brouillard", "portes", "revele", "w", "h",
                                      "version_avant", "version_apres", "alertes", "joueur")}

    # ------------------------------------------------------------ ce que lit le MJ

    def dire(self, j: dict, d: dict) -> str:
        """La ligne de la boîte : « Aude veut aller à 4 cases vers le nord-est. », et ce que les joueurs ne voient pas."""
        heros = self.heros_du_joueur(j["id"]) if isinstance(j.get("id"), str) else None
        nom = str((heros or {}).get("nom") or j.get("nom") or "Le joueur").split(" ")[0]
        c = d.get("corps") or {}
        depuis, vers = c.get("depuis") or [0, 0], c.get("vers") or [0, 0]
        dx, dy = vers[0] - depuis[0], vers[1] - depuis[1]
        n = max(abs(dx), abs(dy))
        sens = DIRECTIONS.get(((dx > 0) - (dx < 0), (dy > 0) - (dy < 0)), "")
        loin = f"à {n} case{'s' if n > 1 else ''}" + (f" vers {sens}" if sens else "")
        m = self.du_journal(d.get("id")) if d.get("statut") in ("appliquee", "acceptee", "annulee") else None
        if m:
            phrase = f"{nom} est allé{'e' if (heros or {}).get('genre') == 'f' else ''} {loin}."
            n = len(m.get("portes") or [])
            if n:
                pronom = "Elle" if (heros or {}).get("genre") == "f" else "Il"
                phrase += f" {pronom} ouvre une porte." if n == 1 else f" {pronom} ouvre {n} portes."
            if m.get("cases"):
                phrase += " Ses alentours se sont révélés." if m.get("revele") == "autour" else " Sa pièce s'est révélée."
            return " ".join([phrase, *(m.get("alertes") or [])])
        phrase = f"{nom} veut aller {loin}."
        if d.get("statut") == "echec":
            x = self.lire_tentatives().get(d.get("id"))
            # Une serrure, la raison du refus la dit déjà sous la ligne (dp.VERROUILLEE) : pas deux fois. Une porte secrète
            # ou un mur, que la raison tait (« un mur »), le MJ seul l'apprend ici.
            if isinstance(x, dict) and x.get("raison") != "verrouillee":
                phrase += " " + self.phrase_tentative(x)
            return phrase
        montre = self.plan_montre()
        if montre and montre[2] == c.get("plan") and d.get("statut") == "en-attente":
            _, p, _ = montre
            t = next((x for x in p.get("pions") or [] if isinstance(x, dict) and x.get("id") == c.get("pion")), None)
            caches = caches_sur(p, t, tuple(vers)) if t else []
            if caches:
                phrase += f" Attention, sur cette case, un pion que les joueurs ne voient pas : {', '.join(caches)}."
        elif d.get("statut") == "en-attente":
            phrase += " La TV ne montre plus ce plan."
        return phrase

    def en_attente(self, boite, plan: str) -> list:
        """Les déplacements qui attendent le MJ sur ce plan (s'il est à la TV) : l'éditeur montre leur pion fantôme et les
        accepte d'un clic."""
        montre = self.plan_montre()
        if not montre or montre[1].get("id") != plan:
            return []
        jeton = montre[2]
        attente, _ = boite.elements()
        return [{"joueur": x["joueur"], "joueur_nom": x["joueur_nom"], "id": x["id"], "version": x["version"],
                 "pion": x["corps"].get("pion"), "depuis": x["corps"].get("depuis"), "vers": x["corps"].get("vers"),
                 "phrase": x.get("phrase") or ""}
                for x in attente if x["genre"] == dp.GENRE and x["statut"] == "en-attente" and x["corps"].get("plan") == jeton]

    # ------------------------------------------------------------ le rejeu pour l'éditeur en retard

    def rejouer(self, fiche: dict, base, precedente: dict) -> list | None:
        """L'éditeur enregistre le plan depuis la version base, mais le plan est à precedente : si tout ce qui s'est passé
        entre les deux n'est que des mouvements notes ici (une chaîne de versions sans trou), ils se rejouent sur fiche
        et l'enregistrement passe. Un pion que l'éditeur a bougé de son côté garde la place que lui a donnée le MJ. Rend
        les mouvements rejoués, ou None (un autre écran est passé : le conflit d'avant reste le dernier recours)."""
        journal_plan = self.lire_journal(str(precedente.get("id")))
        depart = next((k for k, m in enumerate(journal_plan) if m.get("version_avant") == base), None)
        if depart is None or not isinstance(base, str):
            return None
        chaine = journal_plan[depart:]
        for a, b in zip(chaine, chaine[1:]):
            if a.get("version_apres") != b.get("version_avant"):
                return None
        if chaine[-1].get("version_apres") != precedente.get("modifie"):
            return None
        if any(m.get("w") != fiche.get("largeur") or m.get("h") != fiche.get("hauteur") for m in chaine):
            return None
        pions = {t.get("id"): t for t in fiche.get("pions") or [] if isinstance(t, dict)}
        portes = {(x.get("sens"), x.get("x"), x.get("y")): x for x in reversed(fiche.get("portes") or []) if isinstance(x, dict)}
        vu = fiche.get("brouillard")
        n = int(fiche.get("largeur") or 0) * int(fiche.get("hauteur") or 0)
        for m in chaine:
            t = pions.get(m.get("pion"))
            if t is not None and meme_place(place(t), m.get("avant")):
                t["x"], t["y"] = m["apres"]
            if isinstance(vu, list) and len(vu) == n:
                for i in m.get("cases") or []:
                    if isinstance(i, int) and 0 <= i < n:
                        vu[i] = m.get("brouillard", 1)
            # Une porte ouverte (ou refermée par « Annuler ») par un joueur : seulement si l'éditeur l'a laissée dans l'état
            # d'avant (une porte que le MJ a changée de son côté garde son geste).
            for c in m.get("portes") or []:
                x = portes.get((c.get("sens"), c.get("x"), c.get("y"))) if isinstance(c, dict) else None
                if x is not None and (x.get("etat") or "fermee") == c.get("avant"):
                    x["etat"] = c.get("apres")
        return [self.pour_l_editeur(m) for m in chaine]
