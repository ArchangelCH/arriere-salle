"""Le sanctuaire : l'auberge détruite que les héros relèvent, et le village qui pousse autour d'elle, refuge des
aventuriers et des demi-élémentaires. Comme une base de jeu vidéo : chaque bâtiment a ses niveaux, chaque niveau son
coût en pièces d'or, ses habitants et son bonus ; les héros versent de leur bourse dans la cagnotte d'un chantier et le
niveau est construit dès qu'il est payé. Le catalogue de départ est une proposition maison, que le MJ change à sa guise
dans l'atelier. Fonctions pures : main.py lit, écrit et sert ; la TV ne reçoit que sanctuaire_public.

Le carnet des joueurs n'en reçoit que pour_les_joueurs : rien tant que le MJ n'a pas rendu le sanctuaire
visible des joueurs (champ « joueurs » du sanctuaire, faux par défaut), puis ce que voit la TV et les seuls types du
catalogue qu'il coche pour eux (champ « joueurs » de chaque type, faux par défaut) : les projets qu'ils peuvent
proposer."""

import copy
import re
import secrets

NIVEAUX_MAX = 5
COUT_MAX = 1_000_000
HABITANTS_MAX = 999
TEXTE_COURT = 120
TEXTE_LONG = 600
NOTES_MAX = 4000
BATIMENTS_MAX = 80
TYPES_MAX = 60
VERSEMENTS_MAX = 400
ID_COURT = re.compile(r"^[a-z0-9-]{1,40}$")
# Les formes que l'atelier sait dessiner (js/sanctuaire/dessin.js).
FORMES = ("auberge", "maison", "long", "atelier", "tour", "autel", "champ", "puits", "enceinte")
EMBLEMES = ("", "piece", "enclume", "feuille", "losange", "fer", "coffre", "parchemin", "lit", "epi")
TOITS = ("#8e3b2a", "#6b4a2e", "#4f5d6b", "#5d6b3a", "#7a2f4f", "#3f4f6b", "#8a6a34", "#55463b")
# Le plan du village : 1600 × 1000, l'auberge au milieu.
LARGEUR, HAUTEUR = 1600, 1000
CENTRE = (800, 470)
EMPLACEMENTS = [
    (520, 330), (1080, 330), (450, 600), (1150, 600), (640, 770), (960, 770), (300, 430), (1300, 430),
    (800, 225), (290, 760), (1310, 760), (520, 900), (1080, 900), (800, 900), (230, 220), (1370, 220),
]
# Là où se posent d'abord le puits (devant l'auberge) et la tour (au bord), s'ils sont libres.
PLACES_PREFEREES = {"puits": (800, 655), "tour": (1370, 220)}


def niveau(nom, cout, habitants, bonus):
    return {"nom": nom, "cout": cout, "habitants": habitants, "bonus": bonus}


# Proposition maison : coûts tenus au barème du kit (repas et lit 1 po, épée 25, mailles 120, cheval 80, potion 30,
# contrat de 20 à 50 po par tête), bonus modestes que le MJ applique à la main. À valider par le MJ.
CATALOGUE_DEPART = [
    {"type": "auberge", "nom": "L'auberge", "forme": "auberge", "unique": True, "toit": "#8e3b2a", "embleme": "lit",
     "description": "Le cœur du sanctuaire. Détruite, elle se relève pierre à pierre.",
     "niveaux": [
         niveau("La salle commune", 150, 2, "Repas et lit offerts aux membres du sanctuaire ; la planche à contrats retrouve son clou."),
         niveau("Les chambres de l'étage", 400, 2, "Une nuit de repos à l'auberge rend 2 Santé de plus."),
         niveau("La grande auberge", 1000, 4, "Son nom court les routes : un contrat de plus sur la planche à chaque séance, +10 aux tests de Social dans la région."),
     ]},
    {"type": "baraquements", "nom": "Les baraquements", "forme": "long", "unique": True, "toit": "#6b4a2e", "embleme": "",
     "description": "Des lits pour les aventuriers de passage, puis une salle d'armes et une garde.",
     "niveaux": [
         niveau("Un dortoir", 100, 6, "Six lits : le sanctuaire peut fournir un compagnon d'armes pour une mission."),
         niveau("Les baraquements", 250, 6, "Une salle d'armes : une fois par séance, un héros s'entraîne et commence le premier combat avec un avantage."),
         niveau("La caserne", 600, 8, "Quatre gardes (profil Garde du bestiaire) défendent les lieux en l'absence des héros."),
     ]},
    {"type": "maison", "nom": "Une maison", "forme": "maison", "unique": False, "toit": "#55463b", "embleme": "",
     "description": "Une famille de réfugiés s'installe : des bras, des voix, un village.",
     "niveaux": [
         niveau("Une maisonnette", 60, 3, "Une famille s'installe au sanctuaire."),
         niveau("Une maison", 140, 3, "Un artisan parmi eux : un objet simple du kit à moitié prix, une fois par séance."),
         niveau("Une maison de maître", 300, 4, "Un notable : +10 aux tests de Social pour parler au nom du sanctuaire."),
     ]},
    {"type": "boutique", "nom": "L'échoppe", "forme": "atelier", "unique": False, "toit": "#3f4f6b", "embleme": "piece",
     "description": "Un marchand pose son étal ; sa boutique se tient dans l'onglet Boutiques.",
     "niveaux": [
         niveau("Un étal", 120, 1, "Une boutique ouvre au sanctuaire, aux prix du kit."),
         niveau("L'échoppe", 300, 1, "Prix réduits de 10 % pour les membres du sanctuaire."),
         niveau("Le comptoir", 700, 2, "Des caravanes passent : une fois par séance, un objet rare hors du catalogue."),
     ]},
    {"type": "forge", "nom": "La forge", "forme": "atelier", "unique": True, "toit": "#4f5d6b", "embleme": "enclume",
     "description": "Le marteau sonne : armes réparées, armures forgées.",
     "niveaux": [
         niveau("Une forge de campagne", 150, 1, "Réparer et affûter : +1 aux dégâts d'une arme pour la prochaine aventure, une par séance."),
         niveau("La forge", 400, 1, "Armures de cuir et de mailles à moitié prix."),
         niveau("La forge du maître", 900, 2, "Une arme de maître sur commande : +5 % à ses attaques."),
     ]},
    {"type": "infirmerie", "nom": "L'infirmerie", "forme": "atelier", "unique": True, "toit": "#5d6b3a", "embleme": "feuille",
     "description": "Des herbes qui sèchent, des lits propres, quelqu'un qui sait recoudre.",
     "niveaux": [
         niveau("Une herboristerie", 100, 1, "Trousses de soins à 5 po."),
         niveau("L'infirmerie", 300, 1, "Une journée de repos au sanctuaire change aussi un carton rouge en jaune."),
         niveau("La maison de soins", 700, 2, "Une potion de soins offerte à chaque héros, une fois par séance."),
     ]},
    {"type": "autel", "nom": "L'autel des éléments", "forme": "autel", "unique": True, "toit": "#7a2f4f", "embleme": "losange",
     "description": "Un refuge pour les demi-élémentaires, loin des Églises qui les traquent.",
     "niveaux": [
         niveau("Le cercle de pierres", 200, 0, "La rumeur se répand : un refuge existe. D'autres demi-élémentaires viendront."),
         niveau("L'autel", 500, 3, "Méditer une nuit ici rend 2 Psy de plus."),
         niveau("Le sanctuaire des éléments", 1200, 5, "Une fois par séance, un héros relance un test de don raté."),
     ]},
    {"type": "ecuries", "nom": "Les écuries", "forme": "long", "unique": True, "toit": "#8a6a34", "embleme": "fer",
     "description": "Des montures gardées, puis un relais de poste.",
     "niveaux": [
         niveau("Un enclos", 80, 0, "Les montures sont gardées et soignées."),
         niveau("Les écuries", 200, 1, "Un cheval prêté au groupe pour chaque voyage."),
         niveau("Le relais", 500, 2, "Un messager porte une lettre partout dans la région en deux jours."),
     ]},
    {"type": "enceinte", "nom": "L'enceinte", "forme": "enceinte", "unique": True, "toit": "#6b4a2e", "embleme": "",
     "description": "Une palissade, puis un fossé, puis un rempart autour du village.",
     "niveaux": [
         niveau("La palissade", 150, 0, "Le sanctuaire n'est plus jamais pris par surprise."),
         niveau("Le fossé et la porte", 400, 0, "Qui l'attaque a un désavantage pour entrer."),
         niveau("Le rempart", 1000, 0, "Le sanctuaire tient un siège."),
     ]},
    {"type": "tour", "nom": "La tour de guet", "forme": "tour", "unique": True, "toit": "#4f5d6b", "embleme": "",
     "description": "Voir venir, de loin, les amis comme les chasseurs.",
     "niveaux": [
         niveau("Un mirador", 80, 0, "On voit venir les visiteurs une heure à l'avance."),
         niveau("La tour de guet", 250, 1, "Un guetteur : les chasseurs de demi-élémentaires sont repérés avant d'arriver."),
         niveau("La tour de signal", 600, 1, "Un feu de signal : les alliés de la région accourent."),
     ]},
    {"type": "jardins", "nom": "Les jardins", "forme": "champ", "unique": True, "toit": "#5d6b3a", "embleme": "epi",
     "description": "Un potager, des champs, un verger : le sanctuaire se nourrit seul.",
     "niveaux": [
         niveau("Un potager", 50, 0, "Plus besoin d'acheter des vivres au sanctuaire."),
         niveau("Les champs", 150, 2, "Le sanctuaire nourrit deux familles de plus."),
         niveau("Le verger et les ruches", 350, 2, "Des herbes rares : une potion de soins offerte au groupe à chaque séance."),
     ]},
    {"type": "puits", "nom": "La place du puits", "forme": "puits", "unique": True, "toit": "#55463b", "embleme": "",
     "description": "L'eau, puis la place où l'on se retrouve.",
     "niveaux": [
         niveau("Le puits", 40, 0, "L'eau ne manque plus."),
         niveau("La place", 150, 1, "Un marché chaque semaine : on y vend son butin au prix du kit."),
         niveau("La fontaine", 400, 1, "Une fête par saison : la réputation du sanctuaire grandit dans la région."),
     ]},
    {"type": "entrepot", "nom": "L'entrepôt", "forme": "long", "unique": True, "toit": "#55463b", "embleme": "coffre",
     "description": "Ce que le groupe rapporte, à l'abri.",
     "niveaux": [
         niveau("Une remise", 60, 0, "Un coffre du groupe : ce qu'on y laisse est en sûreté."),
         niveau("L'entrepôt", 180, 0, "Les marchands y déposent : l'échoppe a deux articles de plus."),
         niveau("La chambre forte", 450, 0, "Les objets dangereux y sont scellés, comme à la banque des Fils du Savoir."),
     ]},
    {"type": "bibliotheque", "nom": "La salle des cartes", "forme": "atelier", "unique": True, "toit": "#3f4f6b", "embleme": "parchemin",
     "description": "Cartes, rumeurs et livres : savoir avant de partir.",
     "niveaux": [
         niveau("Une table des cartes", 120, 0, "Les rumeurs se recoupent : une rumeur vraie de plus à chaque séance."),
         niveau("La bibliothèque", 350, 1, "+10 aux tests d'Érudition faits au sanctuaire."),
         niveau("La salle des cartes", 800, 1, "Un lieu inconnu de la région révélé à chaque séance."),
     ]},
]


def nouveau_sanctuaire() -> dict:
    """Le sanctuaire de départ : l'auberge en ruines au milieu, rien d'autre ; le catalogue proposé. Caché des joueurs,
    et aucun type proposé : le MJ décide de ce qu'ils voient."""
    return {
        "nom": "Le sanctuaire",
        "accroche": "Sur les ruines de l'auberge, un refuge pour les aventuriers et les demi-élémentaires.",
        "notes_mj": "",
        "joueurs": False,
        "catalogue": [t | {"joueurs": False} for t in copy.deepcopy(CATALOGUE_DEPART)],
        "batiments": [{"id": "auberge", "type": "auberge", "nom": "L'auberge", "niveau": 0, "ruine": True, "cache": False,
                       "x": CENTRE[0], "y": CENTRE[1], "cagnotte": 0, "versements": [], "notes_mj": "", "boutique": ""}],
        "journal": [],
    }


# ---------------------------------------------------------------- validation


def _texte(v, maximum: int) -> str:
    return " ".join(str(v).split())[:maximum] if isinstance(v, str) else ""


def _entier(v, bas: int, haut: int, defaut: int = 0) -> int:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
        return defaut
    return int(round(min(haut, max(bas, v))))


def _id(v, defaut: str) -> str:
    v = v if isinstance(v, str) else ""
    return v if ID_COURT.match(v) else defaut


def type_valide(t) -> dict | None:
    if not isinstance(t, dict):
        return None
    ident = _id(t.get("type"), "")
    if not ident:
        return None
    niveaux = []
    for n in (t.get("niveaux") if isinstance(t.get("niveaux"), list) else [])[:NIVEAUX_MAX]:
        if isinstance(n, dict):
            niveaux.append({"nom": _texte(n.get("nom"), TEXTE_COURT) or f"Niveau {len(niveaux) + 1}",
                            "cout": _entier(n.get("cout"), 0, COUT_MAX),
                            "habitants": _entier(n.get("habitants"), 0, HABITANTS_MAX),
                            "bonus": _texte(n.get("bonus"), TEXTE_LONG)})
    if not niveaux:
        niveaux = [{"nom": "Niveau 1", "cout": 100, "habitants": 0, "bonus": ""}]
    toit = t.get("toit") if isinstance(t.get("toit"), str) and re.fullmatch(r"#[0-9a-fA-F]{6}", t.get("toit") or "") else TOITS[0]
    return {
        "type": ident, "nom": _texte(t.get("nom"), TEXTE_COURT) or "Bâtiment",
        "forme": t.get("forme") if t.get("forme") in FORMES else "maison", "unique": bool(t.get("unique")),
        "toit": toit, "embleme": t.get("embleme") if t.get("embleme") in EMBLEMES else "",
        "description": _texte(t.get("description"), TEXTE_LONG), "niveaux": niveaux,
        # Proposé aux joueurs : le type paraît dans leur carnet parmi les projets possibles (liste blanche du MJ).
        "joueurs": t.get("joueurs") is True,
    }


# Ce que l'enregistrement de tout le sanctuaire peut changer d'un bâtiment. Son niveau, sa cagnotte, ses ruines et ses
# versements ne bougent que par leurs routes (verser, rendre, corriger) ; un bâtiment ne s'ajoute et ne se retire que
# par les siennes : un écran resté ouvert sur une vieille version n'efface ni un chantier ni de l'or versé.
CHAMPS_LIBRES = ("nom", "cache", "x", "y", "notes_mj", "boutique")


def batiment_libre(b: dict, t: dict) -> dict:
    return {
        "nom": _texte(b.get("nom"), TEXTE_COURT) or t["nom"], "cache": bool(b.get("cache")),
        "x": _entier(b.get("x"), 40, LARGEUR - 40, CENTRE[0]), "y": _entier(b.get("y"), 60, HAUTEUR - 30, CENTRE[1]),
        "notes_mj": _texte(b.get("notes_mj"), NOTES_MAX), "boutique": _id(b.get("boutique"), ""),
    }


def sanctuaire_valide(corps: dict, disque: dict) -> dict:
    """Le sanctuaire envoyé par l'atelier : nom, accroche, notes, visibilité pour les joueurs, catalogue, et les champs
    libres des bâtiments déjà là (CHAMPS_LIBRES). Le reste vient du disque. Un type du catalogue encore bâti ne
    disparaît pas. Un écran qui n'envoie pas « joueurs » ne le change pas."""
    types = [x for x in (type_valide(t) for t in (corps.get("catalogue") if isinstance(corps.get("catalogue"), list) else [])[:TYPES_MAX]) if x]
    catalogue, vus = [], set()
    for t in types:
        if t["type"] not in vus:
            vus.add(t["type"])
            catalogue.append(t)
    for t in disque.get("catalogue", []):
        if t.get("type") not in vus and any(b.get("type") == t.get("type") for b in disque.get("batiments", [])):
            vus.add(t["type"])
            catalogue.append(t)
    par_type = {t["type"]: t for t in catalogue}
    envoyes = {b.get("id"): b for b in (corps.get("batiments") if isinstance(corps.get("batiments"), list) else []) if isinstance(b, dict)}
    batiments = []
    for b in disque.get("batiments", []):
        t = par_type.get(b.get("type"))
        if not t:
            continue
        b = dict(b)
        # Un catalogue qui retirerait un niveau déjà bâti est refusé (l'atelier le dit avant d'envoyer).
        if _entier(b.get("niveau"), 0, NIVEAUX_MAX) > len(t["niveaux"]):
            raise ValueError(f"« {b.get('nom')} » a déjà bâti un niveau que ce catalogue retire.")
        if b.get("id") in envoyes:
            b.update(batiment_libre(envoyes[b["id"]], t))
        batiments.append(b)
    return {
        "nom": _texte(corps.get("nom"), TEXTE_COURT) or "Le sanctuaire", "accroche": _texte(corps.get("accroche"), TEXTE_LONG),
        "notes_mj": _texte(corps.get("notes_mj"), NOTES_MAX),
        "joueurs": (corps.get("joueurs") if "joueurs" in corps else disque.get("joueurs")) is True,
        "catalogue": catalogue, "batiments": batiments,
        "journal": disque.get("journal", []) if isinstance(disque.get("journal"), list) else [],
    }


def corriger(s: dict, b: dict, corps: dict) -> list:
    """Le MJ corrige un bâtiment sans or : niveau, cagnotte, ruines. Rend les morceaux de phrase du journal."""
    t = type_de(s, b)
    changes = []
    if "niveau" in corps and t:
        k = _entier(corps.get("niveau"), 0, len(t["niveaux"]), b.get("niveau", 0))
        if k != b.get("niveau", 0):
            b["niveau"] = k
            b["cagnotte"] = 0
            if k:
                b["ruine"] = False
            changes.append(f"niveau {k}" + (f" ({t['niveaux'][k - 1]['nom']})" if k else ""))
    if "cagnotte" in corps:
        n = prochain(s, b)
        v = _entier(corps.get("cagnotte"), 0, max(0, (n["cout"] - 1) if n else 0), b.get("cagnotte", 0))
        if v != b.get("cagnotte", 0):
            b["cagnotte"] = v
            changes.append(f"cagnotte {v} po")
    if "ruine" in corps and bool(corps["ruine"]) != bool(b.get("ruine")) and not b.get("niveau"):
        b["ruine"] = bool(corps["ruine"])
        changes.append("en ruines" if b["ruine"] else "déblayé")
    return changes


# ---------------------------------------------------------------- jeu


def type_de(s: dict, b: dict) -> dict | None:
    return next((t for t in s.get("catalogue", []) if t.get("type") == b.get("type")), None)


def prochain(s: dict, b: dict) -> dict | None:
    """Le niveau à construire (avec son rang, 1 pour le premier), ou None au plus haut."""
    t = type_de(s, b)
    if not t or b.get("niveau", 0) >= len(t["niveaux"]):
        return None
    return {**t["niveaux"][b.get("niveau", 0)], "rang": b.get("niveau", 0) + 1}


def place_libre(s: dict, type_: str = "") -> tuple:
    """Un emplacement libre du plan du village (le préféré du type d'abord), sinon un peu à côté du dernier."""
    pris = [(b.get("x"), b.get("y")) for b in s.get("batiments", [])]
    loin = lambda p: all((p[0] - x) ** 2 + (p[1] - y) ** 2 > 90 ** 2 for x, y in pris)  # noqa: E731
    prefere = PLACES_PREFEREES.get(type_)
    for p in ([prefere] if prefere else []) + EMPLACEMENTS:
        if loin(p):
            return p
    return (CENTRE[0] + secrets.randbelow(500) - 250, CENTRE[1] + secrets.randbelow(300) + 150)


def nouvel_id(s: dict, base: str) -> str:
    ids = {b.get("id") for b in s.get("batiments", [])}
    if base not in ids:
        return base
    k = 2
    while f"{base}-{k}" in ids:
        k += 1
    return f"{base}-{k}"


def verser(s: dict, b: dict, montant: int, qui: dict, quand: str) -> dict:
    """Verse dans la cagnotte du prochain niveau, sans dépasser ce qui manque ; le niveau est construit dès qu'il est
    payé (règle choisie par le MJ). Rend { pris, construit (le niveau atteint ou None), versement }."""
    n = prochain(s, b)
    if not n:
        return {"pris": 0, "construit": None, "versement": None}
    reste = max(0, n["cout"] - b.get("cagnotte", 0))
    pris = max(0, min(montant, reste))
    # pris peut valoir 0 : un niveau déjà payé (coût baissé ou nul) se bâtit sans or.
    b["cagnotte"] = b.get("cagnotte", 0) + pris
    construit = None
    en_ruines = bool(b.get("ruine"))
    if b["cagnotte"] >= n["cout"]:
        b["cagnotte"] = 0
        b["niveau"] = n["rang"]
        b["ruine"] = False
        construit = n
    # pour : le niveau que ce versement finance ; niveau : celui du bâtiment juste après.
    v = {"id": secrets.token_hex(4), "aventurier": qui.get("id", ""), "nom": qui.get("nom", ""), "or": pris,
         "pour": n["rang"], "niveau": b["niveau"], "t": quand}
    # Rendu plus tard, ce versement remettra les ruines qu'il a relevées.
    if construit and en_ruines:
        v["ruine"] = True
    if pris:
        b.setdefault("versements", []).append(v)
        b["versements"] = b["versements"][-VERSEMENTS_MAX:]
    return {"pris": pris, "construit": construit, "versement": v if pris else None}


def annulable(b: dict, v: dict) -> bool:
    """Un versement se rend tant qu'il est le dernier du bâtiment : le niveau qu'il finançait n'est pas encore bâti, ou
    c'est le dernier bâti et rien n'est encore versé pour le suivant (le bâtiment recule alors d'un niveau)."""
    vs = b.get("versements") or []
    if not vs or vs[-1].get("id") != v.get("id"):
        return False
    niveau, pour = b.get("niveau", 0), v.get("pour", 0)
    if niveau == pour - 1:
        return b.get("cagnotte", 0) >= v.get("or", 0)
    return niveau == pour and not b.get("cagnotte", 0)


def annuler(b: dict, vid: str, s: dict | None = None) -> dict | None:
    """Retire le dernier versement (annulable) ; rend le versement, ou None. S'il avait bâti le niveau en place, le
    bâtiment recule d'un niveau et sa cagnotte revient à ce qu'elle était juste avant lui (« recul » : le niveau défait)."""
    v = next((x for x in b.get("versements") or [] if x.get("id") == vid), None)
    if not v or not annulable(b, v):
        return None
    b["versements"] = b["versements"][:-1]
    if b.get("niveau", 0) != v.get("pour", 0):
        b["cagnotte"] = b.get("cagnotte", 0) - v.get("or", 0)
        return v
    t = type_de(s or {}, b)
    rang = v.get("pour", 0)
    n = t["niveaux"][rang - 1] if t and 0 < rang <= len(t["niveaux"]) else None
    cout = n["cout"] if n else v.get("or", 0)
    b["niveau"] = rang - 1
    b["cagnotte"] = max(0, min(cout - 1, cout - v.get("or", 0)))
    if v.get("ruine") and not b["niveau"]:
        b["ruine"] = True
    return {**v, "recul": {"rang": rang, "nom": n["nom"] if n else ""}}


def noter(s: dict, texte_: str, quand: str) -> None:
    s.setdefault("journal", []).append({"t": quand, "texte": texte_[:TEXTE_LONG]})
    s["journal"] = s["journal"][-300:]


# ---------------------------------------------------------------- ce que voit la table


def habitants(s: dict) -> int:
    total = 0
    for b in s.get("batiments", []):
        t = type_de(s, b)
        if t and not b.get("cache"):
            total += sum(n.get("habitants", 0) for n in t["niveaux"][: b.get("niveau", 0)])
    return total


def bonus_actifs(s: dict, cache: bool = False) -> list:
    """Les bonus gagnés, bâtiment par bâtiment et niveau par niveau : ils s'ajoutent, comme dans une base de jeu vidéo."""
    liste = []
    for b in s.get("batiments", []):
        t = type_de(s, b)
        if not t or (b.get("cache") and not cache):
            continue
        for rang, n in enumerate(t["niveaux"][: b.get("niveau", 0)], start=1):
            if n.get("bonus"):
                liste.append({"id": b.get("id"), "batiment": b.get("nom") or t["nom"], "niveau": rang, "nom": n["nom"], "bonus": n["bonus"]})
    return liste


def sanctuaire_public(s: dict) -> dict:
    """Ce que voit la TV : les bâtiments montrés (forme, niveau, place, cagnotte et prochain niveau, prénoms de ceux qui
    ont versé), les bonus gagnés, les habitants. Jamais une note du MJ, un bâtiment caché, ni le catalogue entier."""
    batiments = []
    for b in s.get("batiments", []):
        t = type_de(s, b)
        if not t or b.get("cache"):
            continue
        n = prochain(s, b)
        actuel = t["niveaux"][b["niveau"] - 1] if b.get("niveau", 0) > 0 else None
        donateurs = {}
        for v in b.get("versements", []):
            if v.get("nom") and v.get("pour") == b.get("niveau", 0) + 1:
                prenom = re.split(r"[\s,]+", v["nom"].strip())[0]
                donateurs[prenom] = donateurs.get(prenom, 0) + v.get("or", 0)
        batiments.append({
            "id": b["id"], "nom": b.get("nom") or t["nom"], "forme": t["forme"], "toit": t["toit"], "embleme": t["embleme"],
            "niveau": b.get("niveau", 0), "niveaux": len(t["niveaux"]), "ruine": bool(b.get("ruine")), "x": b.get("x"), "y": b.get("y"),
            "etat": actuel["nom"] if actuel else ("En ruines" if b.get("ruine") else "À bâtir"),
            "cagnotte": b.get("cagnotte", 0),
            "prochain": {"nom": n["nom"], "cout": n["cout"], "bonus": n["bonus"], "rang": n["rang"]} if n else None,
            "donateurs": [{"nom": k, "or": v} for k, v in donateurs.items()],
        })
    return {"nom": s.get("nom") or "Le sanctuaire", "accroche": s.get("accroche") or "", "batiments": batiments,
            "habitants": habitants(s), "bonus": bonus_actifs(s)}


# ---------------------------------------------------------------- ce que lisent les joueurs


def projets_ouverts(s: dict) -> list:
    """Les types que le MJ propose aux joueurs (« joueurs » coché), qu'ils peuvent demander d'ouvrir. Un type unique déjà
    au village n'en est plus un ; un bâtiment caché ne compte pas : son absence de la liste dirait qu'il existe."""
    montres = {b.get("type") for b in s.get("batiments", []) if not b.get("cache")}
    projets = []
    for t in s.get("catalogue", []):
        if t.get("joueurs") is not True or (t.get("unique") and t.get("type") in montres):
            continue
        projets.append({
            "type": t["type"], "nom": t.get("nom") or "Bâtiment", "forme": t.get("forme"), "toit": t.get("toit"),
            "embleme": t.get("embleme", ""), "unique": bool(t.get("unique")), "description": t.get("description", ""),
            "niveaux": [{"nom": n.get("nom", ""), "cout": n.get("cout", 0), "habitants": n.get("habitants", 0), "bonus": n.get("bonus", "")}
                        for n in t.get("niveaux", [])],
        })
    return projets


def pour_les_joueurs(s: dict) -> dict | None:
    """Ce que le carnet des joueurs publie du sanctuaire : rien (None) tant qu'il est caché d'eux ; sinon ce que voit la
    TV (sanctuaire_public : ni notes du MJ, ni bâtiment caché, ni journal) et les projets ouverts."""
    if s.get("joueurs") is not True:
        return None
    return {"public": sanctuaire_public(s), "projets": projets_ouverts(s)}
