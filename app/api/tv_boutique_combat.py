"""Ce que la TV reçoit des boutiques et du combat."""

import math
import re
import time

from fastapi import HTTPException

from api.application import app


# Une boutique telle que la TV la montre : son nom, sa phrase d'accroche, le nom du marchand s'il est connu des joueurs,
# et les articles qui ne sont pas cachés, au prix ajusté pour la tablée. Ni les notes du MJ (de la boutique ou d'un
# article), ni le stock chiffré (seulement « épuisé »), ni le lieu. Même calcul des prix que js/boutiques/commun.js.
ARTICLE_VALIDE = re.compile(r"^[a-z0-9]{1,24}$")
NOMBRE_DU_PRIX = re.compile(r"\d+(?:[.,]\d+)?")
AJUSTEMENT_MIN, AJUSTEMENT_MAX = -100, 1000


def ajustement_boutique(b: dict) -> float:
    a = b.get("ajustement")
    a = utilitaires.nombre(a, 0.0) if not isinstance(a, bool) else 0.0
    return max(AJUSTEMENT_MIN, min(AJUSTEMENT_MAX, a)) if math.isfinite(a) else 0.0


def prix_ajuste(prix: str, ajustement: float) -> str:
    """Chaque nombre du prix tel que le MJ l'a tapé (« 25 », « à partir de 150 », « 15 / 120 / 600 ») passe à
    l'ajustement en pour cent, arrondi à l'entier (la moitié vers le haut), jamais sous 1 pour un prix non nul."""
    prix = prix.strip()
    if not ajustement:
        return prix

    def un(m: re.Match) -> str:
        n = float(m.group(0).replace(",", "."))
        return m.group(0) if not n else str(max(1, math.floor(n * (100 + ajustement) / 100 + 0.5)))
    return NOMBRE_DU_PRIX.sub(un, prix)


# Les dessins d'article que la TV sait peindre (static/js/boutiques/objets.js, NOMS_DESSINS) : celui que le MJ a choisi
# part avec l'article ; vide, la TV le devine d'après le nom.
DESSINS_ARTICLE = ("fiole", "trousse", "dague", "epee", "hache", "baton", "arc", "arbalete", "fleches", "lance", "marteau",
                   "bouclier", "cuir", "mailles", "plaques", "cheval", "gemme", "corde", "torche", "lanterne", "livre", "outre",
                   "vivres", "cle", "sac", "coffret")


def article_public(a: dict, ajustement: float) -> dict:
    stock = a.get("stock")
    ident = a.get("id")
    dessin = a.get("dessin")
    return {
        "id": ident if isinstance(ident, str) and ARTICLE_VALIDE.match(ident) else "",
        "nom": " ".join(utilitaires.texte(a.get("nom")).split()),
        "prix": prix_ajuste(utilitaires.texte(a.get("prix")), ajustement),
        "categorie": " ".join(utilitaires.texte(a.get("categorie")).split()),
        "description": utilitaires.texte(a.get("description")).strip(),
        "epuise": isinstance(stock, (int, float)) and not isinstance(stock, bool) and stock <= 0,
        "dessin": dessin if isinstance(dessin, str) and dessin in DESSINS_ARTICLE else "",
    }


def boutique_publique(b: dict, j: str) -> dict:
    """La boutique vue par la table : son nom, son accroche, le nom et le portrait de son marchand s'il est connu des
    joueurs, ses articles visibles (prix ajustés, épuisés, dessins)."""
    marchand = ""
    portrait = None
    ident = b.get("marchand")
    if isinstance(ident, str) and config.ID_VALIDE.match(ident) and (config.PNJ / f"{ident}.json").exists():
        pnj = utilitaires.lire_fiche(config.PNJ / f"{ident}.json")
        if pnj.get("connu"):
            marchand = " ".join(utilitaires.texte(pnj.get("nom")).split())
            portrait = tv_cartes.url_publique(pnj)
    ajustement = ajustement_boutique(b)
    articles = [article_public(a, ajustement) for a in b.get("articles") or []
                if isinstance(a, dict) and not a.get("cache") and utilitaires.texte(a.get("nom")).strip()]
    return {"id": j, "nom": " ".join(utilitaires.texte(b.get("nom")).split()), "accroche": utilitaires.texte(b.get("accroche")).strip(),
            "marchand": marchand, "portrait": portrait, "articles": articles}


@app.get("/api/table/boutique/{j}")
def table_boutique(j: str):
    # Rien ne renvoie les joueurs à leur téléphone pendant la partie : l'échoppe de la TV ne parle que d'elle-même.
    return tv_cartes.reponse_publique(boutique_publique(utilitaires.lire_fiche(tv_cartes.par_jeton(config.BOUTIQUES, "boutiques", j)), j))


# L'état de la table vu par la TV : seulement les champs qu'elle lit, chaque fiche désignée par son jeton.
REFS_TABLE = {"carte": "cartes", "plan": "plans", "lieu": "lieux", "pnj": "pnj", "rumeur": "rumeurs", "contrat": "contrats",
              "seance": "seances", "aventurier": "aventuriers", "combat": "seances", "boutique": "boutiques", "document": "documents"}
CLES_TABLE = ("vue", "camera", "style", "version", "aventurier_maj", "seance_maj", "combat_maj", "sanctuaire_maj", "document_maj")
# Le bandeau du combat (la séance dont la TV montre l'ordre du tour) ne se pose et ne se retire que par les routes du
# combat : un écran qui envoie autre chose à la TV, un plan ou l'accueil, le garde.
CHAMPS_COMBAT_TABLE = ("combat", "combat_maj")
POSTURES_TV = ("offensive", "defensive", "focus")
CARACS_TV = ("physique", "social", "mental")
COULEUR_VALIDE = re.compile(r"#[0-9a-fA-F]{3,8}")


def combat_public(c: dict, j: str) -> dict:
    """Le bandeau du combat sur la TV : l'ordre du tour avec le prénom, la couleur, la posture, les cartons et le coma
    de chaque héros (nom et couleur lus dans sa fiche), une seule case « Les ennemis », le tour, le point strat et le
    sablier. Rien d'un adversaire : ni son nom, ni sa Santé, ni leur nombre ; ni la Santé d'un héros."""
    heros = {}
    for h in c.get("heros") if isinstance(c.get("heros"), list) else []:
        if isinstance(h, dict) and isinstance(h.get("id"), str) and config.ID_VALIDE.match(h["id"]):
            heros.setdefault(f"aventurier:{h['id']}", h)
    actif_mj = c.get("actif") if isinstance(c.get("actif"), int) and not isinstance(c.get("actif"), bool) else None
    ordre, actif, vus = [], None, set()
    couleurs = tv_fiches.couleurs_de_la_tv()
    for rang, x in enumerate(c.get("ordre") if isinstance(c.get("ordre"), list) else []):
        if not isinstance(x, str) or x in vus:
            continue
        if x == "ennemis":
            entree = {"genre": "ennemis"}
        elif x in heros:
            fiche = tv_plans.fiche_du_pion({"ref": x})
            if not fiche:
                continue
            h = heros[x]
            cartons = h.get("cartons") if isinstance(h.get("cartons"), dict) else {}
            couleur = couleurs.get(fiche.get("id")) or utilitaires.texte(fiche.get("couleur"))
            entree = {
                "genre": "heros", "nom": re.split(r"[\s,]+", utilitaires.texte(fiche.get("nom")).strip())[0],
                "couleur": couleur if COULEUR_VALIDE.fullmatch(couleur) else "",
                "posture": h.get("posture") if h.get("posture") in POSTURES_TV else "",
                "coma": utilitaires.nombre(h.get("sante"), 1) <= 0,
                "cartons": [{"carac": k, "couleur": cartons[k]} for k in CARACS_TV if cartons.get(k) in ("jaune", "rouge")],
                "avantage": h.get("avantage") if h.get("avantage") in heros_etat.AVANTAGES else "",
            }
        else:
            continue
        vus.add(x)
        if rang == actif_mj:
            actif = len(ordre)
        ordre.append(entree)
    sablier = None
    s = c.get("sablier")
    if isinstance(s, dict) and isinstance(s.get("fin"), (int, float)) and isinstance(s.get("duree"), (int, float)):
        duree = max(1, min(seances_api.SABLIER_MAX, int(s["duree"])))
        sablier = {"duree": duree, "reste": round(max(0.0, min(duree, s["fin"] - time.time())), 1)}
    tour = int(max(1, min(999, utilitaires.nombre(c.get("tour"), 1))))
    return {"id": j, "tour": tour, "ordre": ordre, "actif": actif, "strat": c.get("strat") is True, "sablier": sablier}


@app.get("/api/table/combat/{j}")
def table_combat(j: str):
    chemin = tv_cartes.par_jeton(config.SEANCES, "seances", j)
    combat = seances_api.combat_de(utilitaires.lire_fiche(chemin))
    # Seulement le combat que le MJ a montré, tant qu'il le montre.
    if not combat or tv_ecran.etat_table().get("combat") != chemin.stem:
        raise HTTPException(404, "Introuvable")
    return tv_cartes.reponse_publique(combat_public(combat, j))


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import config, utilitaires, seances_api, heros_etat, tv_cartes, tv_fiches, tv_plans, tv_ecran  # noqa: E402
