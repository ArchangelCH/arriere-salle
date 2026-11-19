"""Ce que la TV reçoit des plans : murs, brume, feu, pions, fonds et images."""

import asyncio
import io
import json
import re

from fastapi import HTTPException
from fastapi.responses import Response
from PIL import Image

from table import couleurs_tv
from table import decor_plan
from ia import habillage
from ia import images_plan
from table import pions_plan

from api.application import app


def murs_du_plan(p: dict) -> list:
    """Les murs d'un plan, case par case (même règle que calculerMurs dans plan/modele.js) : bits 1 N, 2 E, 4 S, 8 O
    pour un mur droit, les mêmes décalés de 4 pour une paroi de grotte."""
    w, h = p["largeur"], p["hauteur"]
    sol, pc = p["sol"], p["piece"]
    genres = {x["id"]: x.get("genre") or "salle" for x in p.get("pieces", [])}
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


def murs_des_secretes(p: dict, murs: list) -> list:
    """Les murs que voient les joueurs : une porte secrète qu'ils n'ont pas trouvée y est un mur, même posée là où le plan
    n'en a pas (entre deux grottes, dans une cour, au milieu d'un couloir). Sans cela, le héros qui s'y heurte (lot E4,
    « Un mur vous arrête ») apprendrait qu'un obstacle invisible est là, ou un détour lui dirait la même chose ; dessinée en
    mur, elle se refuse au coin comme n'importe quel mur. Sur un mur (le cas de tous les plans d'avant), rien ne change.
    Une paroi dans une grotte, un mur droit ailleurs."""
    w, h = int(p["largeur"]), int(p["hauteur"])
    sol, pc = p.get("sol") or [], p.get("piece") or []
    if len(sol) != w * h or len(pc) != w * h:
        return murs
    genres = {x.get("id"): x.get("genre") or "salle" for x in p.get("pieces", []) if isinstance(x, dict)}
    murs = list(murs)
    for d in p.get("portes", []):
        if not isinstance(d, dict) or d.get("genre") != "secrete" or d.get("decouverte"):
            continue
        x, y = d.get("x"), d.get("y")
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and v == int(v) for v in (x, y)):
            continue
        x, y = int(x), int(y)
        cotes = {"v": (((x - 1, y), 2), ((x, y), 8)), "h": (((x, y - 1), 4), ((x, y), 1))}.get(d.get("sens"), ())
        for (cx, cy), bit in cotes:
            i = cy * w + cx
            if 0 <= cx < w and 0 <= cy < h and sol[i] and not murs[i] & (bit | bit << 4):
                murs[i] |= bit << 4 if genres.get(pc[i], "salle") == "grotte" else bit
    return murs


def cases_vues(p: dict) -> list:
    w, h = int(p["largeur"]), int(p["hauteur"])
    n = w * h
    if not p.get("brouillard_actif", True):
        return [1] * n
    brume = list(p.get("brouillard") or [])
    brume += [0] * (n - len(brume))
    return [1 if brume[i] == 1 else 0 for i in range(n)]


def cases_brume(p: dict) -> list:
    """La brume du plan, une valeur par case : 0 rien, 1 voile, 2 épaisse. Un plan d'avant la brume n'en a pas ; toute
    autre valeur compte pour rien."""
    n = int(p["largeur"]) * int(p["hauteur"])
    brume = p.get("brume")
    if not isinstance(brume, list):
        return [0] * n
    brume = brume[:n] + [0] * (n - len(brume))
    return [2 if v == 2 else 1 if v == 1 else 0 for v in brume]


def cases_feu(p: dict) -> list:
    """Le feu du plan, une valeur par case : 0 rien, 1 braises, 2 flammes, 3 brasier, 4 calciné, seulement sur un sol. Un
    plan d'avant le feu n'en a pas ; toute autre valeur compte pour rien. Les étapes préparées (plan.etapes) ne sortent
    jamais d'ici : seul le feu du moment compte."""
    n = int(p["largeur"]) * int(p["hauteur"])
    feu = p.get("feu")
    if not isinstance(feu, list):
        return [0] * n
    feu = feu[:n] + [0] * (n - len(feu))
    sol = list(p.get("sol") or [])
    sol += [0] * (n - len(sol))
    def valeur(v) -> int:
        entier = isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and 1 <= v <= 4 and v == int(v)
        return int(v) if entier else 0

    return [valeur(v) if sol[i] else 0 for i, v in enumerate(feu)]


def ref_du_pion(t: dict) -> tuple[str, str]:
    genre, _, ident = utilitaires.texte(t.get("ref")).partition(":")
    return genre, ident


def fiche_du_pion(t: dict) -> dict | None:
    genre, ident = ref_du_pion(t)
    dossier = {"pnj": config.PNJ, "aventurier": config.AVENTURIERS}.get(genre)
    if not dossier or not config.ID_VALIDE.match(ident or ""):
        return None
    try:
        return utilitaires.lire_fiche(utilitaires.existant(dossier, ident, tout=True))
    except HTTPException:
        return None


def jauges_pion(fiche: dict, etat: dict, posture: str = "") -> dict:
    """Les jauges d'un héros posé sur un plan, telles que les voit la table : la part de Santé et de Psy qui lui reste
    (au centième, sans les chiffres ; None sans maximum sur la fiche), le coma, ses cartons, son jeton d'avantage et sa
    posture (celle du combat en cours, sinon celle de sa fiche). Jamais la note du MJ ni la Santé payée faute de Psy."""
    def part(cle: str):
        m = fiche.get(cle)
        if isinstance(m, bool) or not isinstance(m, (int, float)) or m != m or m <= 0:
            return None
        v = etat.get(cle)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
            v = m
        return round(max(0.0, min(1.0, v / m)), 2)

    sante = etat.get("sante")
    cartons = etat.get("cartons") if isinstance(etat.get("cartons"), dict) else {}
    return {
        "sante": part("sante"), "psy": part("psy"),
        "coma": not isinstance(sante, bool) and isinstance(sante, (int, float)) and sante <= 0,
        "cartons": [{"carac": k, "couleur": cartons[k]} for k in heros_etat.CARACS_ETAT if cartons.get(k) in heros_etat.CARTONS_ETAT],
        "avantage": etat.get("avantage") if etat.get("avantage") in heros_etat.AVANTAGES else "",
        "posture": posture if posture in heros_etat.POSTURES_ETAT else fiche.get("posture") if fiche.get("posture") in heros_etat.POSTURES_ETAT else "",
    }


def jeton_heros(ident: str) -> str:
    """Le jeton opaque d'un héros sur un plan et dans l'ordre du combat (les figurines qui luisent à son tour)."""
    return tv_cartes.jeton("heros-pion", ident)


def pion_public(t: dict, etats: dict | None = None, postures: dict | None = None, couleurs: dict | None = None) -> dict:
    """Un pion tel que le voit la table : un PNJ que les joueurs ne connaissent pas n'a ni nom ni portrait, un ennemi
    n'a que son numéro ; le nom d'un aventurier ou d'un PNJ connu vient de sa fiche du moment, et un aventurier porte
    ses jauges (jauges_pion) et sa couleur de la TV (couleurs_de_la_tv)."""
    pub = {k: t.get(k) for k in ("id", "genre", "court", "x", "y", "taille", "tombe")}
    couleur = utilitaires.texte(t.get("couleur"))
    pub["couleur"] = couleur if re.fullmatch(r"#[0-9a-fA-F]{3,8}", couleur) else ""
    pub["nom"], pub["image"] = "", ""
    genre, ident = ref_du_pion(t)
    fiche = fiche_du_pion(t)
    if genre == "aventurier" and fiche:
        pub["nom"], pub["image"] = utilitaires.texte(fiche.get("nom")), tv_cartes.url_publique(fiche) or ""
        pub["jauges"] = jauges_pion(fiche, (etats if etats is not None else heros_etat.etats_heros()).get(ident) or {},
                                    (postures if postures is not None else heros_etat.postures_au_combat()).get(ident, ""))
    elif genre == "pnj":
        if fiche and fiche.get("connu"):
            pub["nom"], pub["image"] = utilitaires.texte(fiche.get("nom")), tv_cartes.url_publique(fiche) or ""
    elif t.get("genre") not in ("ennemi", "pnj", "heros"):
        pub["nom"] = utilitaires.texte(t.get("nom"))
    if genre == "aventurier" and fiche:
        pub["couleur"] = (couleurs if couleurs is not None else tv_fiches.couleurs_de_la_tv()).get(ident) or couleurs_tv.lisible(pub["couleur"])
        # Les figurines (19/11) : le jeton du héros, le même que dans l'ordre du combat (combat_public), pour que la TV et le
        # coin fassent luire celui qui a la main ; un jeton à part, qui n'ouvre aucune fiche.
        pub["heros"] = jeton_heros(ident)
    elif genre == "familier":
        pub["familier"] = True
    # Lot H2 : forme, cadre, états, groupe, étiquette, nom visible ou non, image choisie par le MJ (pions_plan.py).
    pub.update(pions_plan.plus_public(t, pub, genre, fiche, utilitaires.media_existant))
    # La lettre courte dit qui est le pion (« Au » pour Aude de Valcombe, « M » pour le Pinson) : un numéro part toujours,
    # des lettres seulement quand son nom est déjà montré (un héros, un PNJ connu).
    court = utilitaires.texte(pub.get("court"))
    if court and not pub["nom"] and not re.search(r"\d", court):
        pub["court"] = ""
    return pub


def version_plan(p: dict) -> str:
    """La version du plan vu par la table : ses pions, les fiches qu'ils montrent et les jauges des héros."""
    etats = []
    du_moment = postures = None
    for t in p.get("pions", []):
        fiche = fiche_du_pion(t)
        if fiche:
            jauges = None
            if ref_du_pion(t)[0] == "aventurier":
                if du_moment is None:
                    du_moment, postures = heros_etat.etats_heros(), heros_etat.postures_au_combat()
                jauges = json.dumps(jauges_pion(fiche, du_moment.get(fiche.get("id")) or {}, postures.get(fiche.get("id"), "")), sort_keys=True)
            etats.append((utilitaires.texte(t.get("ref")), fiche.get("modifie"), fiche.get("connu"), tv_cartes.url_publique(fiche), jauges))
    return tv_cartes.signature(p.get("modifie"), sorted(etats, key=lambda x: json.dumps(x, default=str)))


def plan_public(p: dict, j: str) -> dict:
    """Ce que la TV reçoit d'un plan : les cases révélées seulement, leurs murs tout faits, les portes, meubles, pions et
    textes visibles, la brume qui les couvre et le feu qui y brûle. Jamais une note, une porte secrète encore cachée, un
    piège, un pion en embuscade ou perdu dans la brume épaisse, une étape du feu préparée pour plus tard, ni le lieu, ni
    même le nom du plan."""
    w, h = int(p["largeur"]), int(p["hauteur"])
    n = w * h
    actif = p.get("brouillard_actif", True)
    vu = cases_vues(p)
    # La brume des seules cases révélées : posée sur une zone encore cachée, elle n'en dessine pas la forme.
    brume = [b if vu[i] else 0 for i, b in enumerate(cases_brume(p))]
    # Le feu aussi : celui d'une pièce encore cachée n'en dessine pas la forme.
    feu = [f if vu[i] else 0 for i, f in enumerate(cases_feu(p))]

    def revele(x, y) -> bool:
        cx, cy = int(utilitaires.nombre(x) // 1), int(utilitaires.nombre(y) // 1)
        return 0 <= cx < w and 0 <= cy < h and vu[cy * w + cx] == 1

    def dans_l_epaisse(t: dict) -> bool:
        """Dans la brume épaisse, les joueurs ne voient plus que les héros : tout autre pion y est caché, comme en
        embuscade, et reparaît quand elle se dissipe (même règle que l'atelier, plan/modele.js)."""
        cx, cy = int(utilitaires.nombre(t["x"]) // 1), int(utilitaires.nombre(t["y"]) // 1)
        return t.get("genre") != "heros" and 0 <= cx < w and 0 <= cy < h and brume[cy * w + cx] == 2

    murs = murs_des_secretes(p, murs_du_plan(p))
    pieces_vues ={p["piece"][i] for i in range(n) if vu[i] and p["sol"][i]}
    portes = []
    for d in p.get("portes", []):
        try:
            if d.get("genre") == "secrete" and not d.get("decouverte"):
                continue
            cases = [(d["x"] - 1, d["y"]), (d["x"], d["y"])] if d.get("sens") == "v" else [(d["x"], d["y"] - 1), (d["x"], d["y"])]
            if not any(revele(x, y) for x, y in cases):
                continue
            portes.append({"id": d.get("id"), "sens": d.get("sens"), "x": d["x"], "y": d["y"],
                           "genre": "porte" if d.get("genre") == "secrete" else d.get("genre", "porte"),
                           "etat": "fermee" if d.get("etat") == "verrouillee" else d.get("etat", "fermee")})
        except (KeyError, TypeError):
            continue
    objets = []
    for o in p.get("objets", []):
        if o.get("cache"):
            continue
        try:
            tourne = utilitaires.nombre(o.get("rot")) % 180 != 0
            l, hh = (utilitaires.nombre(o["h"], 1), utilitaires.nombre(o["l"], 1)) if tourne else (utilitaires.nombre(o["l"], 1), utilitaires.nombre(o["h"], 1))
            ox, oy = utilitaires.nombre(o["x"]), utilitaires.nombre(o["y"])
            cases = [(x, y) for y in range(int(oy), int(oy + hh + 0.999)) for x in range(int(ox), int(ox + l + 0.999))]
        except (KeyError, TypeError):
            continue
        if any(revele(x, y) for x, y in cases):
            pub = ({k: o.get(k) for k in ("id", "cle", "x", "y", "l", "h", "rot")} | images_plan.objet_public(o, utilitaires.media_existant)
                   | decor_plan.extras_objet(o))
            if pub.get("image") and not all(revele(x, y) for x, y in cases):
                # Une image du MJ à demi révélée : comme le fond, seulement ce que les joueurs ont vu, le reste transparent
                # (images_plan.masquer). Entière, le dessin la poserait par-dessus le brouillard.
                pub["image"] = (f"/api/table/plan/{j}/image/{pub['id']}?v={tv_cartes.signature(p.get('modifie'), vu, o)}"
                                if isinstance(pub.get("id"), str) and images_plan.ID_OBJET.match(pub["id"]) else "")
            objets.append(pub)
    etats, postures, couleurs = heros_etat.etats_heros(), heros_etat.postures_au_combat(), tv_fiches.couleurs_de_la_tv()
    # Un pion « invisible » suit la règle du pion caché.
    pions = [pion_public(t, etats, postures, couleurs) for t in p.get("pions", [])
             if not t.get("cache") and not pions_plan.invisible(t) and "x" in t and "y" in t and revele(t["x"], t["y"]) and not dans_l_epaisse(t)]
    pions_plan.lier_montures(pions, p.get("pions", []))
    pions_plan.lier_familiers(pions, p.get("pions", []))
    textes = [{k: t.get(k) for k in ("id", "texte", "x", "y", "taille")} for t in p.get("textes", [])
              if not t.get("mj") and "x" in t and "y" in t and revele(t["x"], t["y"])]
    fond = p.get("fond")
    version = version_plan(p)
    fond_public = None
    if isinstance(fond, dict) and utilitaires.media_existant(fond.get("url")):
        # L'image de fond passe par une route qui noircit tout ce qui n'est pas encore révélé.
        fond_public = {k: fond.get(k) for k in ("x", "y", "l", "h", "opacite", "dessiner")}
        fond_public["url"] = f"/api/table/plan/{j}/fond?v={tv_cartes.signature(version, vu, fond)}"
    return {
        "id": j, "largeur": w, "hauteur": h, "m_case": p.get("m_case", 1.5),
        "style": p.get("style", "couleur"), "quadrillage": p.get("quadrillage", True), "brouillard_actif": actif,
        "sol": [p["sol"][i] if vu[i] else 0 for i in range(n)],
        "piece": [p["piece"][i] if vu[i] else 0 for i in range(n)],
        "brouillard": vu,
        # Sans brume, une liste vide plutôt qu'une case à zéro par case.
        "brume": brume if any(brume) else [],
        "brume_teinte": "fumee" if p.get("brume_teinte") == "fumee" else "brume",
        "feu": feu if any(feu) else [],
        "murs": [murs[i] if vu[i] else 0 for i in range(n)],
        "pieces": [{"id": x["id"], "genre": x.get("genre", "salle"), "nom": x.get("nom", "") if x.get("nom_visible") else "",
                    "nom_visible": bool(x.get("nom_visible"))} | decor_plan.extras_piece(x) for x in p.get("pieces", []) if x.get("id") in pieces_vues],
        "portes": portes, "objets": objets, "pions": pions, "textes": textes,
        "fond": fond_public,
        # L'habillage : objets, lumières et étiquettes des seules cases révélées ; l'étiquette suit « nom visible » et porte
        # le nom de la pièce.
        "habillage": habillage.plan_tv(p.get("habillage"), revele,
                                       {x["id"]: utilitaires.texte(x.get("nom")) for x in p.get("pieces", []) if x.get("id") in pieces_vues and x.get("nom_visible")}),
        "modifie": version,
        **decor_plan.extras_plan(p),
    }


@app.get("/api/table/plan/{j}")
def table_plan(j: str):
    return tv_cartes.reponse_publique(plan_public(utilitaires.lire_fiche(tv_cartes.par_jeton(config.PLANS, "plans", j)), j))


FONDS_MASQUES: dict[str, bytes] = {}


def fond_masque(p: dict) -> bytes:
    """L'image de fond d'un plan, noire partout où les joueurs n'ont rien vu (hors du plan compris)."""
    fond = p["fond"]
    vu = cases_vues(p)
    cle = tv_cartes.signature(p.get("modifie"), vu, fond)
    if cle in FONDS_MASQUES:
        return FONDS_MASQUES[cle]
    w, h = int(p["largeur"]), int(p["hauteur"])
    chemin = config.IMAGES / config.MEDIA_VALIDE.match(fond["url"]).group(1)
    with Image.open(chemin) as source:
        image = source.convert("RGB")
    lc = utilitaires.nombre(fond.get("l"), w) or w
    hc = utilitaires.nombre(fond.get("h"), h) or h
    sx, sy = image.width / lc, image.height / hc
    grille = Image.new("L", (w, h))
    grille.putdata([255 if v else 0 for v in vu])
    masque = Image.new("L", image.size, 0)
    masque.paste(grille.resize((max(1, round(w * sx)), max(1, round(h * sy))), Image.NEAREST),
                 (round(-utilitaires.nombre(fond.get("x")) * sx), round(-utilitaires.nombre(fond.get("y")) * sy)))
    noir = Image.new("RGB", image.size, (0, 0, 0))
    sortie = io.BytesIO()
    Image.composite(image, noir, masque).save(sortie, "JPEG", quality=88, optimize=True)
    if len(FONDS_MASQUES) > 8:
        FONDS_MASQUES.pop(next(iter(FONDS_MASQUES)))
    FONDS_MASQUES[cle] = sortie.getvalue()
    return FONDS_MASQUES[cle]


IMAGES_MASQUEES: dict[str, bytes] = {}


def image_masquee(p: dict, oid: str, largeur: int | None = None) -> bytes | None:
    """L'image d'un objet image du plan, transparente là où les joueurs n'ont rien vu (images_plan.masquer) ; None si
    l'objet n'est pas une image visible des joueurs."""
    o = next((x for x in p.get("objets", []) if isinstance(x, dict) and x.get("id") == oid and images_plan.est_image(x)
              and not x.get("cache") and utilitaires.media_existant(x.get("image"))), None)
    if o is None:
        return None
    vu = cases_vues(p)
    cle = tv_cartes.signature(p.get("modifie"), vu, o, largeur)
    if cle not in IMAGES_MASQUEES:
        contenu = images_plan.masquer(config.IMAGES / config.MEDIA_VALIDE.match(o["image"]).group(1), o, vu, int(p["largeur"]),
                                      int(p["hauteur"]), largeur)
        if contenu is None:
            return None
        if len(IMAGES_MASQUEES) > 16:
            IMAGES_MASQUEES.pop(next(iter(IMAGES_MASQUEES)))
        IMAGES_MASQUEES[cle] = contenu
    return IMAGES_MASQUEES[cle]


@app.get("/api/table/plan/{j}/image/{oid}")
async def table_plan_image(j: str, oid: str):
    """Une image du MJ à demi révélée, telle que la projection publique la désigne, et elle seule."""
    p = utilitaires.lire_fiche(tv_cartes.par_jeton(config.PLANS, "plans", j))
    voulue = f"/api/table/plan/{j}/image/{oid}?"
    if not any(isinstance(o.get("image"), str) and o["image"].startswith(voulue) for o in plan_public(p, j)["objets"]):
        raise HTTPException(404, "Introuvable")
    contenu = await asyncio.to_thread(image_masquee, p, oid)
    if not contenu:
        raise HTTPException(404, "Introuvable")
    return Response(contenu, media_type="image/png", headers={"Cache-Control": "private, max-age=86400"})


@app.get("/api/table/plan/{j}/fond")
async def table_plan_fond(j: str):
    p = utilitaires.lire_fiche(tv_cartes.par_jeton(config.PLANS, "plans", j))
    if not isinstance(p.get("fond"), dict) or not utilitaires.media_existant(p["fond"].get("url")):
        raise HTTPException(404, "Introuvable")
    contenu = await asyncio.to_thread(fond_masque, p)
    return Response(contenu, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import config, utilitaires, heros_etat, tv_cartes, tv_fiches  # noqa: E402
