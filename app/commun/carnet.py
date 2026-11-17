"""Le carnet de la compagnie et les commandes des joueurs, entre l'atelier et le coin des joueurs.

L'atelier publie dans le dossier des propositions (carnet/) ce que les joueurs ont le droit de savoir, déjà passé par
les projections publiques de la TV et par le masque : le coin des joueurs ne lit que ces fichiers. Chacun contient
{"maj", "elements"} et n'est réécrit que si son contenu change. Les commandes passées depuis l'échoppe du téléphone
vont dans commandes/, un fichier par joueur, que les deux services lisent et écrivent sous un verrou.

Ce module ne lit rien de l'atelier : main.py lui passe ce qu'il publie, joueurs.py l'importe aussi. Les bornes et la
validation d'une commande sont donc les mêmes des deux côtés.
"""
import hashlib
import json
import math
import re
import secrets
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageOps
from commun import stockage

CARNET = "carnet"
COMMANDES = "commandes"
HEROS = "heros"
MEDIA = "media"
SOMMAIRE = "sommaire"
# Ce que le coin sait toujours, carnet ouvert ou fermé (coin.json) : la date de la prochaine séance, les couleurs de la
# tablée et, par la clé du lien de leur joueur, les héros qui y sont en ce moment.
COIN = "coin"
# Les sections publiées par l'atelier (une par fichier) ; regles.json vient de l'onglet des règles de la table. Le
# sanctuaire n'est publié que si le MJ l'a rendu visible des joueurs, les activités que s'il les a ouvertes.
SECTIONS = ("precedemment", "personnages", "lieux", "contrats", "rumeurs", "boutiques", "compagnie", "documents", "sanctuaire",
            "activites")
REGLES = "regles"

CLE_HEROS = re.compile(r"^[a-f0-9]{32}$")
NOM_MEDIA = re.compile(r"^[a-f0-9]{24}\.jpg$")
ADRESSE_MEDIA = re.compile(r"^/carnet/media/([a-f0-9]{24}\.jpg)$")
JETON_BOUTIQUE = re.compile(r"^[a-f0-9]{20}$")
ARTICLE = re.compile(r"^[a-z0-9]{1,24}$")
ID_JOUEUR = re.compile(r"^[a-z0-9-]{1,60}$")
ID_COMMANDE = re.compile(r"^[a-f0-9]{12}$")

FICHIER_MAX = 2 * 1024 * 1024  # un fichier publié plus lourd n'est pas lu
MINIATURE = (480, 640)
BOUTIQUES_MAX = 12  # ouvertes aux joueurs en même temps
LIGNES_MAX = 12  # articles différents par commande
QUANTITE_MAX = 20  # d'un même article
COMMANDES_MAX = 30  # par joueur, en attente et traitées
COMMANDES_OCTETS_MAX = 128 * 1024
MOT_MAX = 200  # le mot du MJ qui refuse
STATUTS = ("en-attente", "vendue", "refusee")
# Une publication à la fois (la tâche de fond, un interrupteur, une vente) : une image qu'une autre vient de recopier
# n'est pas retirée comme périmée.
PUBLICATION = threading.Lock()


class Refus(Exception):
    """Une demande refusée, avec le statut HTTP et la phrase à montrer."""

    def __init__(self, statut: int, message: str):
        super().__init__(message)
        self.statut = statut
        self.message = message


def maintenant() -> str:
    return datetime.now().isoformat(timespec="milliseconds")


def cle_heros(empreinte_du_lien: str) -> str:
    """Le nom du fichier de la fiche d'un joueur. Tiré de l'empreinte de son lien, que les deux services connaissent
    (.acces.json), il ne dit ni le joueur ni le héros, et change quand le MJ renouvelle le lien."""
    return hashlib.sha256(f"carnet/{empreinte_du_lien}".encode()).hexdigest()[:32]


def ecrire_atomique(chemin: Path, contenu) -> None:
    chemin.parent.mkdir(parents=True, exist_ok=True)
    stockage.ecrire_json_compact(chemin, contenu, mode=0o644)


def lire_json(chemin: Path, maximum: int = FICHIER_MAX):
    try:
        if chemin.stat().st_size > maximum:
            return None
        return stockage.lire_json(chemin)
    except (OSError, ValueError):
        return None


def lire_publie(chemin: Path) -> dict | None:
    contenu = lire_json(chemin)
    return contenu if isinstance(contenu, dict) and isinstance(contenu.get("elements"), list) else None


def ecrire_si_change(chemin: Path, elements: list, **en_plus) -> bool:
    """Écrit {"maj", ..., "elements"} seulement si le contenu a changé : « maj » reste la date du dernier vrai
    changement, et le disque n'est pas réécrit à chaque passage de la tâche de fond."""
    elements = json.loads(json.dumps(elements, ensure_ascii=False))
    avant = lire_publie(chemin)
    if avant is not None and avant["elements"] == elements and all(avant.get(k) == v for k, v in en_plus.items()):
        return False
    ecrire_atomique(chemin, {"maj": maintenant(), **en_plus, "elements": elements})
    return True


def nom_media(source: Path) -> str | None:
    """Le nom de la miniature d'une image de l'atelier : il change avec l'image, sans rien dire de son nom d'origine."""
    try:
        st = source.stat()
    except OSError:
        return None
    return hashlib.sha256(f"{source.name}|{st.st_size}|{st.st_mtime_ns}".encode()).hexdigest()[:24] + ".jpg"


def miniature(source: Path, cible: Path) -> bool:
    """Une copie réduite en JPEG, sans métadonnées : assez pour un téléphone, légère pour le coin des joueurs."""
    try:
        with Image.open(source) as im:
            im = ImageOps.exif_transpose(im)
            im.thumbnail(MINIATURE)
            if im.mode not in ("RGB", "L"):
                fond = Image.new("RGB", im.size, (244, 234, 212))
                fond.paste(im, mask=im.convert("RGBA").getchannel("A"))
                im = fond
            stockage.ecrire_par(cible, lambda tmp: im.convert("RGB").save(tmp, "JPEG", quality=82, optimize=True, progressive=True),
                                mode=0o644)
        return True
    except (OSError, ValueError, Image.DecompressionBombError):
        return False


def publier(depot: Path, sections: dict, heros: dict, images: dict, ouvert: bool) -> dict:
    """Écrit le carnet : les images d'abord (les fiches y renvoient), puis les sections, les fiches des héros et le
    sommaire ; enfin, ce qui n'est plus publié s'en va. Fermé, il ne reste que le sommaire qui le dit. Rend le nombre
    de fichiers réécrits."""
    dossier = depot / CARNET
    for d in (dossier, dossier / HEROS, dossier / MEDIA):
        d.mkdir(parents=True, exist_ok=True)
    ecrits = 0
    if not ouvert:
        sections, heros, images = {}, {}, {}
    for nom, source in images.items():
        if NOM_MEDIA.match(nom) and not (dossier / MEDIA / nom).exists() and miniature(source, dossier / MEDIA / nom):
            ecrits += 1
    for nom in SECTIONS:
        if nom in sections:
            ecrits += ecrire_si_change(dossier / f"{nom}.json", sections[nom])
        elif (dossier / f"{nom}.json").exists():
            (dossier / f"{nom}.json").unlink()
            ecrits += 1
    for cle, fiche in heros.items():
        if CLE_HEROS.match(cle):
            ecrits += ecrire_si_change(dossier / HEROS / f"{cle}.json", [fiche])
    for f in (dossier / HEROS).glob("*.json"):
        if f.stem not in heros:
            f.unlink(missing_ok=True)
            ecrits += 1
    for f in (dossier / MEDIA).iterdir():
        if f.name not in images and not f.name.startswith("."):
            f.unlink(missing_ok=True)
            ecrits += 1
    resume = [{"section": nom, "nombre": len(sections[nom])} for nom in SECTIONS if nom in sections]
    ecrits += ecrire_si_change(dossier / f"{SOMMAIRE}.json", resume + ([{"section": HEROS, "nombre": len(heros)}] if ouvert else []),
                               ouvert=ouvert)
    return {"ecrits": ecrits}


def publier_coin(depot: Path, prochaine: str, couleurs: list, presents: list) -> bool:
    """coin.json, écrit carnet ouvert comme fermé : « Prochaine séance : … » (la phrase de la table publique fermée), les
    couleurs de la tablée (le créateur du joueur barre celles qui sont prises), et pour chaque joueur dont le héros est
    à la tablée, {cle : la clé de son lien (cle_heros), nom, genre} : le coin ne dit « X a rejoint la tablée » que si
    c'est vrai. Rien d'autre d'aucune séance ni d'aucun héros."""
    propres = [{"cle": p["cle"], "nom": str(p.get("nom") or "")[:120], "genre": p.get("genre") if p.get("genre") in ("h", "f") else ""}
               for p in presents if isinstance(p, dict) and isinstance(p.get("cle"), str) and CLE_HEROS.match(p["cle"])]
    teintes = sorted({c.lower() for c in couleurs if isinstance(c, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", c)})
    return ecrire_si_change(depot / CARNET / f"{COIN}.json", propres, prochaine=str(prochaine or "")[:80], couleurs=teintes)


# Ce que lit un joueur, tel que l'atelier l'a publié : le coin des joueurs le sert, l'aperçu du MJ (« Voir comme Léa »)
# le montre à l'identique. Une image ne peut être qu'une miniature du carnet.

def images_sures(valeur, cle=None):
    """Toute adresse d'image qui n'est pas une miniature du carnet devient vide."""
    if cle in ("illustration", "portrait", "image"):
        return valeur if isinstance(valeur, str) and ADRESSE_MEDIA.match(valeur) else None
    if isinstance(valeur, dict):
        return {k: images_sures(v, k) for k, v in valeur.items()}
    if isinstance(valeur, list):
        return [images_sures(v) for v in valeur]
    return valeur


def publie(depot: Path, nom: str) -> dict | None:
    return lire_publie(depot / CARNET / f"{nom}.json")


def est_ouvert(depot: Path) -> bool:
    sommaire = publie(depot, SOMMAIRE)
    return bool(sommaire) and sommaire.get("ouvert") is True


def section_publiee(depot: Path, nom: str) -> list:
    return [images_sures(e) for e in (publie(depot, nom) or {}).get("elements", []) if isinstance(e, dict)]


def heros_publie(depot: Path, empreinte_du_lien: str) -> dict | None:
    fichier = lire_publie(depot / CARNET / HEROS / f"{cle_heros(empreinte_du_lien)}.json")
    fiche = (fichier or {}).get("elements") or []
    return images_sures(fiche[0]) if fiche and isinstance(fiche[0], dict) else None


def vue_du_carnet(sections: dict, heros: dict | None, maj, joueur: str, cle: str = "") -> dict:
    """Le carnet d'un joueur : les sections, sa fiche (ou rien), le nombre de boutiques ouvertes. Dans la compagnie, la clé
    du lien de chaque joueur devient « moi » (son propre héros, cle : celle du sien) et ne sort pas."""
    contenu = {"ouvert": True, "maj": maj, "joueur": joueur}
    for nom in (*SECTIONS, REGLES):
        if nom != "boutiques":
            contenu[nom] = sections.get(nom) or []
    contenu["compagnie"] = [{k: v for k, v in h.items() if k != "cle"} | {"moi": bool(cle) and h.get("cle") == cle}
                            for h in contenu["compagnie"]]
    contenu["heros"] = heros
    contenu["boutiques"] = len(sections.get("boutiques") or [])
    return contenu


def carnet_du_joueur(depot: Path, joueur: str, empreinte_du_lien: str) -> dict:
    """Ce que /api/carnet du coin rend à ce joueur, carnet ouvert."""
    sections = {nom: section_publiee(depot, nom) for nom in (*SECTIONS, REGLES)}
    return vue_du_carnet(sections, heros_publie(depot, empreinte_du_lien), (publie(depot, SOMMAIRE) or {}).get("maj"), joueur,
                         cle_heros(empreinte_du_lien))


def vue_commande(c: dict) -> dict:
    return {k: c.get(k) for k in ("id", "boutique", "boutique_nom", "lignes", "total", "a_fixer", "statut", "cree", "traitee",
                                  "montant", "heros", "mot")}


def vue_echoppe(boutiques: list, heros: dict | None, commandes: list) -> dict:
    """Les boutiques ouvertes aux joueurs, la bourse de son héros et ses commandes (les siennes seulement)."""
    return {"ouvert": True, "boutiques": boutiques, "heros": {"nom": heros.get("nom", ""), "or": heros.get("or")} if heros else None,
            "commandes": [vue_commande(c) for c in commandes]}


# La fiche qu'un joueur propose depuis son coin, typée champ par champ comme le créateur l'écrit (js/aventuriers/
# createur.js) : des textes bornés, des listes de textes ou d'objets connus, des nombres finis et bornés. Une valeur d'un
# autre type prend la valeur neutre du champ : la fiche reste lisible partout (l'atelier, le carnet) sans que le joueur
# perde sa saisie. Le coin la type avant de l'écrire, l'atelier avant de l'accueillir.
COURT, LONG = 300, 8000
OR_MAX = 10_000_000
TEXTES_COURTS = ("nom", "genre", "joueur", "couleur", "peuple", "specialite", "element", "posture", "langues", "source", "lien_avec_nom")
TEXTES_LONGS = ("avant", "pourquoi", "jamais", "particularites", "allure", "defaut", "lien", "contacts", "histoire")
BOOLEENS = ("bouclier", "peuple_cache")
NOMBRES = {"physique": (0, 999, 55), "social": (0, 999, 55), "mental": (0, 999, 55), "sante": (0, 999, 9), "psy": (0, 999, 3),
           "niveau": (1, 99, 1)}
LISTES_DE_TEXTES = {"vocations": 6, "themes": 6, "equipement": 80, "objets": 12, "conseils": 20}
# Les objets d'une liste : (nombre au plus, {champ: genre}). Un champ absent le reste ; un champ inconnu s'en va.
LISTES_D_OBJETS = {
    "competences": (30, {"nom": "court", "bonus": (-999, 999, 0), "avec": "court"}),
    "armes": (30, {"nom": "court", "competence": "court", "degats": "court", "notes": "court"}),
    "dons": (60, {"nom": "court", "cout": "court ou nombre", "effet": "long", "cree": "booleen", "ameliore": "long"}),
    "familiers": (3, {"nom": "court", "espece": "court", "element": "court", "taille": "court", "aspect": "long", "humeurs": "long",
                      "caractere": "long", "lien": "long", "regles": "long", "image": "court"}),
}


def nombre_borne(v, bas, haut, defaut):
    """Un nombre fini, arrondi et borné ; defaut pour tout le reste (texte, booléen, infini, NaN)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or (isinstance(v, float) and not math.isfinite(v)):
        return defaut
    return int(round(min(haut, max(bas, v))))


def valeur_typee(v, genre):
    if isinstance(genre, tuple):
        return nombre_borne(v, *genre)
    if genre == "booleen":
        return v if isinstance(v, bool) else False
    if genre == "court ou nombre" and isinstance(v, (int, float)) and not isinstance(v, bool):
        return nombre_borne(v, -999, 999, "")
    return v[:LONG if genre == "long" else COURT] if isinstance(v, str) else ""


def fiche_typee(fiche: dict) -> dict:
    propre = {}
    for cle, v in fiche.items():
        if not isinstance(cle, str) or len(cle) > 60:
            continue
        if cle in TEXTES_COURTS or cle in TEXTES_LONGS:
            propre[cle] = valeur_typee(v, "long" if cle in TEXTES_LONGS else "court")
        elif cle in BOOLEENS:
            propre[cle] = valeur_typee(v, "booleen")
        elif cle in NOMBRES:
            propre[cle] = nombre_borne(v, *NOMBRES[cle])
        elif cle == "or":
            propre[cle] = nombre_borne(v, 0, OR_MAX, None)
        elif cle == "protection":
            propre[cle] = ({"nom": valeur_typee(v.get("nom"), "court"), "indice": nombre_borne(v.get("indice"), 0, 99, 0)}
                           if isinstance(v, dict) else None)
        elif cle in LISTES_DE_TEXTES:
            propre[cle] = [x[:COURT] for x in v if isinstance(x, str)][:LISTES_DE_TEXTES[cle]] if isinstance(v, list) else []
        elif cle in LISTES_D_OBJETS:
            maximum, champs = LISTES_D_OBJETS[cle]
            propre[cle] = ([{k: valeur_typee(x[k], g) for k, g in champs.items() if k in x} for x in v if isinstance(x, dict)][:maximum]
                           if isinstance(v, list) else [])
        elif v is None or isinstance(v, (bool, str)) or (isinstance(v, (int, float)) and math.isfinite(v) and abs(v) <= 1e6):
            # Un champ simple que le créateur ajouterait plus tard : gardé, borné.
            propre[cle] = v[:COURT] if isinstance(v, str) else v
    return propre


# Les commandes : un fichier par joueur (ses commandes en attente et les dernières traitées), écrit par le coin des
# joueurs (passer, retirer) et par l'atelier (vendre, refuser), toujours sous le verrou du dossier.

@contextmanager
def verrou(depot: Path):
    with stockage.verrou_de_dossier(depot / COMMANDES, ".verrou"):
        yield


def fichier_commandes(depot: Path, joueur: str) -> Path:
    if not isinstance(joueur, str) or not ID_JOUEUR.match(joueur):
        raise Refus(403, "Accès invalide")
    return depot / COMMANDES / f"{joueur}.json"


def lire_commandes(depot: Path, joueur: str) -> list:
    liste = lire_json(fichier_commandes(depot, joueur), COMMANDES_OCTETS_MAX)
    if not isinstance(liste, list):
        return []
    return [c for c in liste if isinstance(c, dict) and isinstance(c.get("id"), str) and ID_COMMANDE.match(c["id"])
            and c.get("statut") in STATUTS][-COMMANDES_MAX:]


def ecrire_commandes(depot: Path, joueur: str, liste: list) -> None:
    chemin = fichier_commandes(depot, joueur)
    if liste:
        ecrire_atomique(chemin, liste)
    else:
        chemin.unlink(missing_ok=True)


def montant_du_prix(prix) -> int | None:
    """Le montant d'un prix fait d'un seul nombre (« 25 », « 25 po ») ; None pour un prix libre ou à plusieurs nombres.
    Même règle que montantDuPrix (static/js/boutiques/commun.js)."""
    m = re.fullmatch(r"\s*(\d+)\s*(?:po|pièces? d'or)?\s*", prix if isinstance(prix, str) else "", flags=re.IGNORECASE)
    return int(m.group(1)) if m else None


def total_des_lignes(lignes: list) -> tuple[int, bool]:
    """Le total des prix simples, et s'il reste un prix à fixer avec le MJ (« à partir de 150 »)."""
    total, a_fixer = 0, False
    for ligne in lignes:
        m = montant_du_prix(ligne.get("prix"))
        if m is None:
            a_fixer = True
        else:
            total += m * ligne["quantite"]
    return total, a_fixer


def nouvelle_commande(corps: dict, boutiques: list, bourse: int, deja: list) -> dict:
    """La commande d'un joueur, vérifiée contre les boutiques publiées (ouvertes, articles visibles, épuisés) : seuls
    l'identifiant de la boutique, ceux des articles et les quantités viennent de lui, tout le reste du carnet."""
    jeton = corps.get("boutique")
    if not isinstance(jeton, str) or not JETON_BOUTIQUE.match(jeton):
        raise Refus(400, "Boutique inconnue.")
    b = next((x for x in boutiques if isinstance(x, dict) and x.get("id") == jeton), None)
    if not b:
        raise Refus(404, "Cette boutique n'est pas ouverte aux joueurs.")
    if any(c.get("boutique") == jeton and c.get("statut") == "en-attente" for c in deja):
        raise Refus(409, "Une commande vous attend déjà chez ce marchand : retirez-la pour en passer une autre.")
    lignes = corps.get("lignes")
    if not isinstance(lignes, list) or not lignes:
        raise Refus(400, "Votre panier est vide.")
    if len(lignes) > LIGNES_MAX:
        raise Refus(413, f"Pas plus de {LIGNES_MAX} articles différents par commande.")
    articles = {a["id"]: a for a in b.get("articles") or []
                if isinstance(a, dict) and isinstance(a.get("id"), str) and ARTICLE.match(a["id"])}
    propres, vus = [], set()
    for ligne in lignes:
        if not isinstance(ligne, dict):
            raise Refus(400, "Ligne de commande illisible.")
        ident, quantite = ligne.get("article"), ligne.get("quantite")
        if not isinstance(ident, str) or ident not in articles:
            raise Refus(404, "Cet article n'est pas en vente ici.")
        if ident in vus:
            raise Refus(400, "Un même article apparaît deux fois.")
        if isinstance(quantite, bool) or not isinstance(quantite, int) or not 1 <= quantite <= QUANTITE_MAX:
            raise Refus(400, f"La quantité va de 1 à {QUANTITE_MAX}.")
        a = articles[ident]
        if a.get("epuise"):
            raise Refus(409, f"« {a.get('nom', '')} » est épuisé.")
        vus.add(ident)
        propres.append({"article": ident, "nom": str(a.get("nom") or ""), "prix": str(a.get("prix") or ""), "quantite": quantite})
    total, a_fixer = total_des_lignes(propres)
    if total > bourse:
        raise Refus(409, f"Il vous manque {total - bourse} po : votre bourse en a {bourse}.")
    instant = maintenant()
    return {"id": secrets.token_hex(6), "boutique": jeton, "boutique_nom": str(b.get("nom") or ""), "lignes": propres,
            "total": total, "a_fixer": a_fixer, "statut": "en-attente", "cree": instant, "modifie": instant}


def ajouter_commande(deja: list, commande: dict) -> list:
    """La liste du joueur avec sa nouvelle commande ; les plus anciennes déjà traitées s'en vont au-delà de la borne."""
    liste = [*deja, commande]
    while len(liste) > COMMANDES_MAX:
        vieille = next((c for c in liste if c.get("statut") != "en-attente"), None)
        if vieille is None:
            raise Refus(429, "Trop de commandes en attente.")
        liste.remove(vieille)
    return liste
