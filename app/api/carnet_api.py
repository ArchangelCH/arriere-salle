"""Le carnet de la compagnie et ce que le coin des joueurs en reçoit."""

import asyncio
import hashlib
import json
import re
import time

from fastapi import HTTPException, Request

from ia.illustrations import ADRESSE_OU_BALISE, nom_de_joueur
from commun import activites
from commun import cagnottes
from commun import carnet
from mj import cloisonnement
from mj import comptes_mj
from commun import demandes
from commun import inventaire
from coin_mj import liens_joueurs
from mj import proprietes
from coin_mj.lore_mj import empreinte as empreinte_recit
from table.masque import contient_nom_cache, forme_simple, masquer, masquer_tout, secrets_dans

from api.application import app
from api import config


# Le carnet de la compagnie (carnet.py) : ce que les joueurs ont le droit de savoir, publié dans le dossier des
# propositions pour le coin des joueurs, qui ne lit rien d'autre. Tout y passe par les projections de la TV et par le
# masque ; chaque joueur accueilli dans la tablée y trouve sa propre fiche, dans un fichier à lui. Une tâche de fond le
# tient à jour (surveiller_carnet, lancée par cycle). Fermé, il n'en reste que le sommaire qui le dit.
CARNET_JOUEURS = config.DONNEES / "carnet-joueurs.json"
CONTRATS_DU_CARNET = ("pris", "reussi", "echoue")
CARNET_INTERVALLE = 5  # secondes entre deux regards sur les fiches dont il est tiré
CARNET_RELECTURE = 600  # publié en entier au moins toutes les dix minutes


def carnet_ouvert() -> bool:
    try:
        return utilitaires.lire(CARNET_JOUEURS).get("ouvert") is True
    except (OSError, ValueError, AttributeError):
        return False


def tous_les_aventuriers() -> dict:
    return {a["id"]: a for a in utilitaires.lire_tout(config.AVENTURIERS) if isinstance(a.get("id"), str)}


def heros_des_joueurs(aventuriers: dict | None = None) -> dict:
    """{id du joueur : son héros}, pour tous les joueurs invités : celui que le MJ a accueilli depuis leur lien, ou celui
    qu'il leur a relié depuis l'atelier (liens_joueurs.py). Le héros doit être à la tablée, et n'a qu'un joueur."""
    liste = [j for j in joueurs_mj.joueurs_lus() if isinstance(j, dict) and isinstance(j.get("id"), str)]
    accueillis = {j["id"]: joueurs_mj.proposition(j["id"]).get("accueilli") for j in liste}
    return liens_joueurs.heros_des_joueurs(liste, accueillis, tous_les_aventuriers() if aventuriers is None else aventuriers)


def heros_du_joueur(ident: str, aventuriers: dict | None = None) -> dict | None:
    return heros_des_joueurs(aventuriers).get(ident)


RECIT_DU_HEROS = ("histoire", "avant", "pourquoi", "jamais", "allure", "defaut", "lien", "contacts", "particularites")


def fiche_du_joueur(a: dict, etat: dict, image, aventuriers: dict | None = None) -> dict:
    """Sa fiche, pour lui seul : ce qu'il lit sur sa feuille imprimée (caractéristiques, compétences, armes, dons, posture,
    thèmes, son histoire et ses liens), la Santé et la Psy du moment avec ses cartons, son sac. Coût et effet d'un don du
    kit se relisent dans le livret, côté page, comme à la TV. Liste blanche : ni ce qui est « pour le MJ » (secret,
    notes), ni la note du MJ sur l'état, ni la validation d'un don, ni le journal des niveaux (il garde l'ancienne fiche)."""
    def lignes(cle: str, champs: tuple) -> list:
        return [{k: x.get(k) for k in champs} for x in a.get(cle) or [] if isinstance(x, dict) and utilitaires.texte(x.get("nom")).strip()]

    def entier(v, defaut=0) -> int:
        return carnet.nombre_borne(v, -1_000_000, 1_000_000, defaut)

    sante_max, psy_max = max(1, entier(a.get("sante"))), max(0, entier(a.get("psy")))
    protection = a.get("protection") if isinstance(a.get("protection"), dict) else {}
    cartons = etat.get("cartons") if isinstance(etat.get("cartons"), dict) else {}
    couleur = utilitaires.texte(a.get("couleur"))
    dons = [{**d, "cree": d.get("cree") is True, "ameliore": utilitaires.texte(d.get("ameliore"))}
            for d in lignes("dons", ("nom", "cout", "effet", "cree", "ameliore"))]
    avec = (aventuriers or {}).get(a.get("lien_avec")) if isinstance(a.get("lien_avec"), str) else None
    return {
        "nom": utilitaires.texte(a.get("nom")), "joueur": utilitaires.texte(a.get("joueur")), "genre": utilitaires.texte(a.get("genre")),
        "couleur": couleur if tv_boutique_combat.COULEUR_VALIDE.fullmatch(couleur) else "", "peuple": utilitaires.texte(a.get("peuple")),
        "vocations": [utilitaires.texte(v) for v in a.get("vocations") or [] if utilitaires.texte(v).strip()], "specialite": utilitaires.texte(a.get("specialite")),
        "element": utilitaires.texte(a.get("element")), "niveau": entier(a.get("niveau"), 1), **{k: entier(a.get(k)) for k in heros_etat.CARACS_ETAT},
        "competences": lignes("competences", ("nom", "bonus", "avec")), "armes": lignes("armes", ("nom", "competence", "degats", "notes")),
        "protection": {"nom": utilitaires.texte(protection.get("nom")), "indice": entier(protection.get("indice"))},
        "bouclier": bool(a.get("bouclier")), "dons": dons, "langues": utilitaires.texte(a.get("langues")),
        "posture": a.get("posture") if a.get("posture") in ("offensive", "defensive", "focus", "aucune") else "",
        "posture_elementaire": utilitaires.texte(a.get("posture_elementaire")),
        "themes": [utilitaires.texte(t) for t in a.get("themes") or [] if utilitaires.texte(t).strip()],
        "conseils": [utilitaires.texte(c) for c in a.get("conseils") or [] if utilitaires.texte(c).strip()],
        **{k: utilitaires.texte(a.get(k)) for k in RECIT_DU_HEROS},
        "lien_avec": utilitaires.texte(avec.get("nom")) if isinstance(avec, dict) else utilitaires.texte(a.get("lien_avec_nom")),
        "sante_max": sante_max, "sante": min(sante_max, entier(etat.get("sante"), sante_max)),
        "psy_max": psy_max, "psy": min(psy_max, max(0, entier(etat.get("psy"), psy_max))),
        "cartons": {k: c for k, c in cartons.items() if k in heros_etat.CARACS_ETAT and c in heros_etat.CARTONS_ETAT},
        "or": heros_etat.sac_de(a, "or"), "equipement": [x for x in heros_etat.sac_de(a, "equipement") if x.strip()],
        "objets": [x for x in heros_etat.sac_de(a, "objets") if x.strip()], "illustration": image(tv_cartes.url_publique(a)),
    }


# Ce que la fiche d'un héros dit de lui seul, sans texte écrit à la main : rien à y chercher.
SANS_RECIT = ("nom", "joueur", "genre", "couleur", "peuple", "illustration")


def retenir_recit(fiche: dict, quoi: str, candidats: list, retenus: list, aid: str = "") -> dict:
    """La fiche d'un héros sans ce qui nomme un PNJ ou un lieu encore inconnu des joueurs, ou le peuple caché d'un autre
    aventurier : son récit (histoire, liens, contacts), mais aussi un conseil, un thème, une note d'arme, un don, une
    ligne du sac. Écrite par le joueur ou retouchée par le MJ, elle ne doit pas en dévoiler un autre. Un texte entier
    s'efface, une ligne d'une liste s'en va. Son propre peuple (aid : son identifiant), même gardé secret, n'est pas un
    secret pour lui."""
    inconnus = [(secret, formes) for secret, formes in candidats
                if secret.get("genre") in ("pnj", "lieu") or (secret.get("genre") == "peuple" and aid not in secret.get("ids", []))]
    trouves, hors_recit = [], False

    def nomme(valeur) -> bool:
        dans = secrets_dans(valeur, inconnus) if isinstance(valeur, str) else []
        trouves.extend(x for x in dans if x not in trouves)
        return bool(dans)

    def effacer(ligne: dict) -> bool:
        effaces = [k for k, v in ligne.items() if nomme(v)]
        ligne.update(dict.fromkeys(effaces, ""))
        return bool(effaces)

    for cle, valeur in list(fiche.items()):
        if cle in SANS_RECIT:
            continue
        touche = False
        if isinstance(valeur, str) and nomme(valeur):
            fiche[cle], touche = "", True
        elif isinstance(valeur, list):
            garde = [x for x in valeur if not (isinstance(x, str) and nomme(x))]
            touche = len(garde) != len(valeur)
            for x in garde:
                touche |= isinstance(x, dict) and effacer(x)
            fiche[cle] = garde
        elif isinstance(valeur, dict):
            touche = effacer(valeur)
        hors_recit |= touche and cle not in (*RECIT_DU_HEROS, "lien_avec")
    if trouves:
        retenus.append(f"{quoi} : une partie de {'sa fiche' if hors_recit else 'son histoire'} est retenue, elle nomme {noms_secrets(trouves)}.")
    return fiche


# Ce que le carnet retient : un champ de texte qui nomme ce que les joueurs ne savent pas encore (un PNJ ou un lieu
# inconnu, le peuple caché d'un aventurier : la détection des avis de l'atelier, secrets_des_joueurs) n'est pas publié ;
# si c'est le nom même de l'élément, ou le texte d'une rumeur ou d'un « Précédemment », l'élément entier reste dehors.
# Le MJ le lit dans la section du carnet, avant d'ouvrir comme après. Une fiche abîmée (une valeur d'un type inattendu)
# est laissée de côté sans rien bloquer, et notée une seule fois au journal.
SANS_TEXTE_CARNET = ("id", "illustration", "portrait", "image", "date", "type", "etat", "dessin", "genre")
CHAMPS_DU_CARNET = {"nom": ("nom", False), "surnom": ("surnom", False), "role": ("rôle", False), "peuple": ("peuple", False),
                    "apparence": ("apparence", True), "resume": ("résumé", False), "titre": ("titre", False),
                    "texte": ("texte", False), "affiche": ("affiche", True), "recompense": ("récompense", True),
                    "contact": ("contact", False), "mention": ("mention", True), "source": ("source", True),
                    "accroche": ("accroche", True), "marchand": ("marchand", False), "description": ("description", True),
                    "categorie": ("catégorie", True), "prix": ("prix", False), "rencontre": ("rencontre", True),
                    "allure": ("allure", True), "specialite": ("spécialité", True), "joueur": ("joueur", False),
                    "signature": ("signature", True)}
GENRES_SECRETS = {"pnj": "personnage inconnu des joueurs", "lieu": "lieu inconnu des joueurs", "peuple": "peuple caché d'un aventurier"}
ERREURS_DU_CARNET: set = set()  # les fiches abîmées déjà notées au journal


def noms_secrets(trouves: list) -> str:
    """Les secrets nommés, pour un message au MJ : ceux de l'autre MJ (et, pour un invité, ceux des héros) sans leur nom
    (cloisonnement.secret_vu)."""
    noms = [x["nom"] if x.get("autre") else f"{x['nom']} ({GENRES_SECRETS.get(x['genre'], 'inconnu des joueurs')})"
            for x in cloisonnement.secrets_vus(trouves)]
    return noms[0] if len(noms) == 1 else f"{', '.join(noms[:-1])} et {noms[-1]}"


def retenir(element: dict, essentiel: str, quoi: tuple, candidats: list, retenus: list) -> dict | None:
    """L'élément sans ses champs de texte qui nomment un secret ; None si c'est son champ essentiel. quoi : comment le
    MJ le reconnaît, et s'il est féminin (pour accorder la phrase)."""
    nom, feminin = quoi
    propre = {}
    for cle, valeur in element.items():
        trouves = secrets_dans(valeur, candidats) if isinstance(valeur, str) and cle not in SANS_TEXTE_CARNET else []
        if not trouves:
            propre[cle] = valeur
        elif cle == essentiel:
            retenus.append(f"{nom} : {'absente' if feminin else 'absent'} du carnet, {'elle' if feminin else 'il'} nomme {noms_secrets(trouves)}.")
            return None
        else:
            champ, f = CHAMPS_DU_CARNET.get(cle, (cle, False))
            retenus.append(f"{nom} : {champ} {'retenue' if f else 'retenu'}, {'elle' if f else 'il'} nomme {noms_secrets(trouves)}.")
            propre[cle] = ""
    return propre


def au_lieu(nom: str) -> str:
    """« au moulin des Varenne », « à l'étang des Roseaux », « à la Ferme », « à Ormont »."""
    nom = " ".join(nom.split())
    m = re.match(r"^(?:(les|le|la)\s+|l['’]\s*)(.+)$", nom, flags=re.IGNORECASE)
    if not nom or not m:
        return f"à {nom}" if nom else ""
    return {"le": "au ", "les": "aux ", "la": "à la "}.get((m.group(1) or "").lower(), "à l'") + m.group(2)


def suites_des_seances():
    """La suite d'une séance : None pour celles du principal (« Séance N », « Épisode N »), le nom de la suite
    de son auteur pour un invité (comptes_mj.suite_de). Les comptes lus une fois pour toutes les séances."""
    try:
        etat = comptes_mj.lire(config.DONNEES)
    except comptes_mj.Illisible:
        etat = comptes_mj.vide()

    def suite(s: dict) -> str | None:
        auteur = proprietes.auteur_de(s)
        return None if auteur == proprietes.PRINCIPAL else comptes_mj.suite_de(comptes_mj.par_id(etat, auteur))
    return suite


def suite_publique(nom: str | None, candidats: list) -> str | None:
    """Le nom d'une suite tel que le lisent les joueurs et la TV : passé au masque ; s'il nomme ce qu'ils ne savent pas
    (un PNJ ou un lieu inconnu, l'auberge), la suite par défaut. Choisi par l'invité, il ne retient jamais un récit."""
    if nom is None:
        return None
    propre = masquer(nom)
    if propre != nom or secrets_dans(propre, candidats) or contient_nom_cache(propre):
        return comptes_mj.SUITE_DEFAUT
    return propre


def recit_du_carnet(s: dict) -> str:
    """Le récit d'une séance close que montre le carnet : le texte écrit pour lui à la clôture (« Pour le carnet des
    joueurs »), sinon le « Précédemment » de la TV."""
    return utilitaires.texte(s.get("precedemment_carnet")).strip() or utilitaires.texte(s.get("precedemment")).strip()


def noms_pieges(aventuriers) -> list:
    """Les noms d'aventuriers et de joueurs qui ne sont pas des noms (une phrase, une consigne glissée par un joueur) : le
    modèle ne les lit pas (illustrations.nom_de_joueur), et un récit qui en reprend un morceau attend le MJ. Chacun en
    suites de quatre mots, sans accents ni casse."""
    suites = []
    for a in aventuriers:
        for n in (a.get("nom"), a.get("joueur")):
            mots = forme_simple(n).split()
            if mots and not nom_de_joueur(n):
                suites += [" ".join(mots[i:i + 4]) for i in range(max(1, len(mots) - 3))]
    return suites


def recit_a_relire(recit: str, pieges: list) -> str:
    """Pourquoi un récit ne part pas seul vers les joueurs : une adresse web, un courriel ou une balise, ou un morceau de
    nom piégé (noms_pieges). "" s'il peut partir."""
    if ADRESSE_OU_BALISE.search(recit):
        return "il contient une adresse web ou une balise"
    lu = f" {forme_simple(recit)} "
    if any(f" {p} " in lu for p in pieges):
        return "il reprend le nom d'un aventurier qui ressemble à une consigne"
    return ""


def elements_du_carnet() -> tuple[dict, dict, dict, list]:
    """Le carnet, section par section, par les projections publiques de la TV, passé au masque puis à la détection des
    secrets ; les fiches des héros des joueurs, par la clé de leur lien ; les images à recopier en miniature (nom →
    fichier de l'atelier) ; ce qui a été retenu, pour le MJ. Ne lit que : sert aussi à l'avis donné avant d'ouvrir."""
    images, retenus, vues = {}, [], {}
    candidats = noms_caches.secrets_des_joueurs()

    def image(url):
        if not utilitaires.media_existant(url):
            return None
        source = config.IMAGES / config.MEDIA_VALIDE.match(url).group(1)
        nom = carnet.nom_media(source)
        if not nom:
            return None
        vues[nom] = source
        return f"/carnet/media/{nom}"

    def garder(quoi: str, fabrique) -> list:
        """[l'élément que rend fabrique], ou rien s'il est retenu : une fiche abîmée ne bloque ni les autres ni le carnet.
        Ses images ne partent que s'il est publié."""
        vues.clear()
        try:
            element = fabrique()
            json.dumps(element, allow_nan=False)
        except Exception as err:
            retenus.append(f"{quoi} : pas dans le carnet, sa fiche contient une valeur illisible.")
            if (quoi, repr(err)) not in ERREURS_DU_CARNET:
                ERREURS_DU_CARNET.add((quoi, repr(err)))
                config.journal.warning("Carnet des joueurs : %s laissé de côté (%r)", quoi, err)
            return []
        if element is None:
            return []
        images.update(vues)
        return [element]

    def public(element: dict, essentiel: str, quoi: tuple):
        return retenir(masquer_tout(element), essentiel, quoi, candidats, retenus)

    connus = {k: v for k, v in tv_cartes.lieux_connus().items() if v.get("connu") is True}
    pieges = noms_pieges(utilitaires.lire_tout(config.AVENTURIERS))
    # Les séances d'un MJ invité, numérotées à part : « Quête annexe 2 », jamais « Séance 2 ».
    suite_de = suites_des_seances()

    def suite_de_seance(s):
        return suite_publique(suite_de(s), candidats)

    def chronique(s):
        numero = utilitaires.nombre(s.get("numero"), 0.0)
        numero = int(numero) if numero >= 1 and numero.is_integer() else None
        vus = [tv_cartes.lieu_public(connus[lid]) for lid in s.get("lieux") or [] if isinstance(lid, str) and lid in connus]
        date = s.get("date") if isinstance(s.get("date"), str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", s["date"]) else ""
        recit = "texte pour le carnet" if utilitaires.texte(s.get("precedemment_carnet")).strip() else "« Précédemment »"
        suite = suite_de_seance(s)
        quoi = (f"Le {recit} de la séance {numero or utilitaires.texte(s.get('nom'))}" if suite is None
                else f"Le {recit} de « {suite} {numero or utilitaires.texte(s.get('nom'))} »")
        # Écrit en partie par le modèle, d'après des noms venus des joueurs : vérifié avant de partir, le MJ relit sinon.
        if raison := recit_a_relire(recit_du_carnet(s), pieges):
            retenus.append(f"{quoi} : absent du carnet, {raison}. Relisez-le dans Séances, à l'onglet Clore.")
            return None
        element = {"id": tv_cartes.jeton("seances", s["id"]), "numero": numero, "titre": tv_fiches.titre_episode(s), "date": date,
                   "texte": recit_du_carnet(s),
                   "images": [{"image": u, "nom": lieu["nom"]} for lieu in vus if (u := image(lieu["illustration"]))]}
        if suite is not None:
            element["suite"] = suite
        propre = public(element, "texte", (quoi, False))
        if propre is not None:
            # La légende d'une image (le nom d'un lieu connu) passe à la même détection que le reste.
            propre["images"] = [x for x in propre["images"]
                                if retenir(x, "nom", (f"L'image « {x['nom']} » du {quoi[3:]}", True), candidats, retenus) is not None]
        return propre

    # Croisés en jouant (E21) : les PNJ et les lieux des séances closes, avec le numéro des séances ; le lieu d'un PNJ s'y
    # ajoute s'il est connu et que les héros y étaient ce soir-là (« Séance 1, au moulin des Varenne »). Le texte passe au
    # masque et à la détection des noms inconnus comme le reste.
    # Une séance d'un MJ invité compte avec sa suite : « Séance 1, Quête annexe 2, au moulin des Varenne ». Les
    # numéros de « seances » (l'ordre des croisés au coin) restent ceux du principal.
    vus_pnj, vus_lieux = {}, {}
    for s in utilitaires.lire_tout(config.SEANCES, tout=True):
        if s.get("close") is not True:
            continue
        n = utilitaires.nombre(s.get("numero"), 0.0)
        n = int(n) if n >= 1 and n.is_integer() else 0
        suite = suite_de_seance(s)
        soir = {x for x in s.get("lieux") or [] if isinstance(x, str)}
        for pid in s.get("pnj") or []:
            if isinstance(pid, str):
                vus_pnj.setdefault(pid, []).append(((n, suite), soir))
        for lid in soir:
            vus_lieux.setdefault(lid, []).append((n, suite))

    def numeros_dits(numeros: list) -> str:
        return str(numeros[0]) if len(numeros) == 1 else f"{', '.join(map(str, numeros[:-1]))} et {numeros[-1]}"

    def croise(vus: list, ou: str = "") -> dict:
        numeros = sorted({n for n, suite in vus if n and suite is None})
        quand = (f"Séance {numeros[0]}" if len(numeros) == 1 else f"Séances {numeros_dits(numeros)}"
                 if numeros else "")
        suites = sorted({suite for n, suite in vus if n and suite is not None})
        quand = ", ".join([quand] * bool(quand) + [f"{suite} {numeros_dits(sorted({n for n, x in vus if n and x == suite}))}"
                                                   for suite in suites])
        quand = quand or ("Lors d'une séance" if vus else "")
        return {"croise": bool(vus), "seances": numeros, "rencontre": f"{quand}, {ou}" if quand and ou else quand}

    def personnage(p):
        nom = " ".join(utilitaires.texte(p.get("nom")).split())
        vus = vus_pnj.get(p["id"], [])
        chez = connus.get(p.get("lieu")) if isinstance(p.get("lieu"), str) and any(p["lieu"] in soir for _, soir in vus) else None
        rencontre = croise([n for n, _ in vus], au_lieu(utilitaires.texte(chez.get("nom"))) if chez else "")
        # Mort : la croix du carnet des joueurs, dès que le MJ passe la fiche en « Mort » (choix du 19/11). Seul ce statut
        # sort, jamais « disparu » ni « sort inconnu ».
        return public(tv_fiches.pnj_public(p) | {"illustration": image(tv_cartes.url_publique(p)), "mort": p.get("statut") == "mort"}
                      | rencontre, "nom", (nom, False))

    def lieu(l):
        return public({k: v for k, v in tv_cartes.lieu_public(l).items() if k != "illustrations"} | {"illustration": image(tv_cartes.url_publique(l))}
                      | croise(vus_lieux.get(l["id"], [])), "nom", (f"Le lieu « {utilitaires.texte(l.get('nom'))} »", False))

    def rumeur(r):
        element = {"id": tv_cartes.jeton("rumeurs", r["id"]), "texte": utilitaires.texte(r.get("texte")).strip(), "source": utilitaires.texte(r.get("source")).strip()}
        mots = element["texte"].split()
        return public(element, "texte", (f"La rumeur « {' '.join(mots[:6])}{'…' if len(mots) > 6 else ''} »", True))

    def document(d):
        # Montré à la TV, gardé dans le carnet : la même projection que la TV, le jour où elle l'a montré pour la première fois.
        element = tv_fiches.remis.public(d) | {"date": d["montre"][:10]}
        element["image"] = image(element["image"])
        return public(element, "texte", (f"Le document « {utilitaires.texte(d.get('nom')).strip() or 'sans titre'} »", False))

    def boutique(b):
        tout = tv_boutique_combat.boutique_publique(b, tv_cartes.jeton("boutiques", b["id"]))
        nom = " ".join(utilitaires.texte(b.get("nom")).split())
        propre = public({k: v for k, v in tout.items() if k != "articles"} | {"portrait": image(tout["portrait"])}, "nom",
                        (f"La boutique « {nom} »", True))
        if propre is not None:
            propre["articles"] = [x for a in tout["articles"]
                                  if (x := public(a, "nom", (f"L'article « {a['nom']} » de « {nom} »", False))) is not None]
        return propre

    seances = [s for s in utilitaires.lire_tout(config.SEANCES, tout=True) if s.get("close") is True and s.get("id") and recit_du_carnet(s)]
    seances.sort(key=lambda s: (utilitaires.nombre(s.get("numero")), utilitaires.texte(s.get("date")), utilitaires.texte(s.get("cree"))), reverse=True)
    if any(suite_de(s) is not None for s in seances):
        # Deux suites numérotées chacune depuis 1 : le numéro ne dit plus l'ordre, la date le dit (la création,
        # pour une séance sans date) ; à date égale, l'ordre d'avant.
        seances.sort(key=lambda s: utilitaires.texte(s.get("date")) or utilitaires.texte(s.get("cree"))[:10], reverse=True)
    pnj = [p for p in utilitaires.lire_tout(config.PNJ, tout=True) if p.get("connu") is True and p.get("id") and forme_simple(p.get("nom")) not in ("", noms_caches.NOM_PNJ_DEFAUT)]
    pris = [c for c in utilitaires.lire_tout(config.CONTRATS, tout=True) if c.get("id") and c.get("etat") in CONTRATS_DU_CARNET]
    pris.sort(key=lambda c: (CONTRATS_DU_CARNET.index(c["etat"]), utilitaires.nombre(c.get("ordre")), utilitaires.texte(c.get("cree"))))
    entendues = [r for r in utilitaires.lire_tout(config.RUMEURS, tout=True) if r.get("id") and r.get("etat") not in (None, "", "a-placer") and utilitaires.texte(r.get("texte")).strip()]
    entendues.sort(key=lambda r: utilitaires.texte(r.get("modifie")), reverse=True)
    ouvertes = sorted((b for b in utilitaires.lire_tout(config.BOUTIQUES, tout=True) if b.get("ouverte_joueurs") is True and b.get("id")),
                      key=lambda b: forme_simple(b.get("nom")))
    sections = {
        "precedemment": [x for s in seances for x in garder(f"La séance « {utilitaires.texte(s.get('nom'))} »", lambda: chronique(s))],
        "personnages": sorted((x for p in pnj for x in garder(f"Le personnage « {utilitaires.texte(p.get('nom'))} »", lambda: personnage(p))),
                              key=lambda x: forme_simple(x.get("nom"))),
        "lieux": sorted((x for l in connus.values() if utilitaires.texte(l.get("nom")).strip()
                         for x in garder(f"Le lieu « {utilitaires.texte(l.get('nom'))} »", lambda: lieu(l))), key=lambda x: forme_simple(x.get("nom"))),
        "contrats": [x for c in pris for x in garder(f"Le contrat « {utilitaires.texte(c.get('nom'))} »",
                                                     lambda: public(tv_fiches.contrat_public(c), "nom", (f"Le contrat « {utilitaires.texte(c.get('nom'))} »", False)))],
        "rumeurs": [x for r in entendues for x in garder("Une rumeur entendue", lambda: rumeur(r))],
        "boutiques": [x for b in ouvertes for x in garder(f"La boutique « {utilitaires.texte(b.get('nom'))} »", lambda: boutique(b))][:carnet.BOUTIQUES_MAX],
        "documents": [x for d in tv_fiches.remis.au_carnet() for x in garder(f"Le document « {utilitaires.texte(d.get('nom'))} »", lambda: document(d))],
    }
    etats = heros_etat.etats_heros()
    aventuriers = {a["id"]: a for a in utilitaires.lire_tout(config.AVENTURIERS) if isinstance(a.get("id"), str)}
    heros, liens, cles = {}, heros_des_joueurs(aventuriers), {}
    for j in joueurs_mj.joueurs_lus():
        a = liens.get(utilitaires.texte(j.get("id")))
        if a and isinstance(j.get("jeton"), str):
            cles[a["id"]] = carnet.cle_heros(hashlib.sha256(j["jeton"].encode()).hexdigest())
            for fiche in garder(f"Le héros « {utilitaires.texte(a.get('nom'))} »",
                               lambda: fiche_publiee(a, etats, image, aventuriers, candidats, retenus, j["id"])):
                heros[cles[a["id"]]] = fiche
    couleurs = tv_fiches.couleurs_de_la_tv()
    sections["compagnie"] = [x for a in tv_fiches.tablee_des_aventuriers() if liens_joueurs.nom_de(a)
                             for x in garder(f"{liens_joueurs.nom_de(a)} (la compagnie)", lambda: compagnon(a, couleurs, cles, image, public, candidats))]
    # Le sanctuaire : seulement quand le MJ l'a rendu visible des joueurs.
    if (vu := refuge.section_du_sanctuaire(candidats, retenus)) is not None:
        sections[cagnottes.SECTION] = vu
    # Les activités entre les séances : seulement quand le MJ les a ouvertes.
    if (vu := actions_coin.activites_mj.section(candidats, retenus)) is not None:
        sections[activites.SECTION] = vu
    return sections, heros, images, retenus


def fiche_publiee(a: dict, etats: dict, image, aventuriers: dict, candidats: list, retenus: list, joueur: str) -> dict:
    """« Mon héros » tel que le carnet le publie pour son joueur : sa fiche au masque, sans ce qui nomme un inconnu. Le sac
    suit le découpage même sur lequel l'atelier rejoue les gestes du joueur (sacs.vues). « tenus » : les passages du récit
    que le carnet garde (champs_tenus)."""
    quoi = f"Le héros « {utilitaires.texte(a.get('nom'))} »"
    fiche = masquer_tout(fiche_du_joueur(a, etats.get(a["id"]) or {}, image, aventuriers))
    fiche = retenir_recit({k: v for k, v in fiche.items() if k not in inventaire.LISTES}, quoi, candidats, retenus, a["id"])
    return fiche | commandes_api.sacs.publiees(a, candidats, retenus, quoi, joueur) | {"tenus": champs_tenus(a, fiche)}


# Le lore du personnage (lore.py, lore_mj.py) : le joueur étoffe le récit de son héros depuis le coin, le MJ tranche passage
# par passage. Un passage que le carnet garde (vidé parce qu'il nomme un inconnu, ou changé par le masque : le vrai nom de
# l'auberge) est dit « tenu » : le coin le montre en lecture seule, sinon accepter le texte du joueur effacerait celui du MJ.

def champs_tenus(a: dict, fiche: dict) -> list:
    return [k for k in RECIT_DU_HEROS
            if utilitaires.texte(a.get(k)).strip() and (not utilitaires.texte(fiche.get(k)).strip() or contient_nom_cache(utilitaires.texte(a.get(k))))]


def recit_publie(a: dict, candidats: list) -> dict:
    """Le récit de ce héros tel que « Mon héros » le publierait maintenant, et ses passages tenus : ce que la comparaison
    du MJ met en face de ce que le joueur lisait."""
    vu = retenir_recit(masquer_tout({k: utilitaires.texte(a.get(k)) for k in RECIT_DU_HEROS}), "", candidats, [], a.get("id", ""))
    return {"champs": vu, "tenus": champs_tenus(a, vu)}


def ecrire_recit(ident: str, changes: dict) -> dict:
    """Les passages acceptés par le MJ, {champ : (empreinte du texte de la fiche qu'il lisait, nouveau texte)}, tout ou
    rien : si l'un a changé entre-temps, rien ne s'écrit. L'ancienne version va à l'historique."""
    with heros_etat.SAC_VERROU:
        chemin = config.AVENTURIERS / f"{ident}.json" if config.ID_VALIDE.match(ident) else None
        if not chemin or not chemin.exists():
            raise demandes.Refus(409, "Ce héros n'est plus dans l'atelier : refusez cette histoire.")
        fiche = utilitaires.lire_fiche(chemin)
        if any(cle not in RECIT_DU_HEROS for cle in changes):
            raise demandes.Refus(400, "Ce passage ne s'écrit pas par l'histoire du joueur.")
        if any(empreinte != empreinte_recit(utilitaires.texte(fiche.get(cle))) for cle, (empreinte, _) in changes.items()):
            raise demandes.Refus(409, "La fiche a changé pendant votre lecture : la comparaison se relit.")
        utilitaires.archiver(chemin, "aventuriers")
        fiche.update({cle: neuf for cle, (_, neuf) in changes.items()})
        fiche["modifie"] = utilitaires.maintenant()
        utilitaires.ecrire(chemin, fiche)
        return fiche


def publier_heros(ids: set) -> int:
    """Après un geste d'un joueur sur un sac (sacs.py) : seules les fiches « Mon héros » de ces héros sont republiées, tout
    de suite ; le reste du carnet suit au passage suivant de la tâche de fond. Rend le nombre de fiches réécrites."""
    with carnet.PUBLICATION:
        if not (carnet_ouvert() and carnet.est_ouvert(config.PROPOSITIONS)):
            return 0
        aventuriers = tous_les_aventuriers()
        liens, etats, candidats, ecrites = heros_des_joueurs(aventuriers), heros_etat.etats_heros(), noms_caches.secrets_des_joueurs(), 0

        def image(url):
            # La miniature existe déjà (le portrait ne change pas avec le sac) ; sinon elle est faite ici.
            if not utilitaires.media_existant(url):
                return None
            source = config.IMAGES / config.MEDIA_VALIDE.match(url).group(1)
            nom = carnet.nom_media(source)
            cible = config.PROPOSITIONS / carnet.CARNET / carnet.MEDIA / nom if nom else None
            if not cible or not (cible.exists() or carnet.miniature(source, cible)):
                return None
            return f"/carnet/media/{nom}"

        for j in joueurs_mj.joueurs_lus():
            a = liens.get(utilitaires.texte(j.get("id"))) if isinstance(j, dict) else None
            if not a or a["id"] not in ids or not isinstance(j.get("jeton"), str):
                continue
            fiche = fiche_publiee(a, etats, image, aventuriers, candidats, [], j["id"])
            json.dumps(fiche, allow_nan=False)
            cle = carnet.cle_heros(hashlib.sha256(j["jeton"].encode()).hexdigest())
            ecrites += carnet.ecrire_si_change(config.PROPOSITIONS / carnet.CARNET / carnet.HEROS / f"{cle}.json", [fiche])
        return ecrites


# La compagnie du carnet (E22) : chaque héros de la tablée tel que la TV le présente sur son carton (aventurier_public :
# ni histoire, ni dons, ni peuple gardé secret, ni rien « pour le MJ »), avec la couleur de son pion à la TV. « cle » est
# celle du lien de son joueur : carnet.vue_du_carnet la remplace par « moi » avant de répondre, elle ne sort jamais.
COMPAGNIE_TEXTES = ("nom", "genre", "joueur", "specialite", "allure", "peuple")
COMPAGNIE_NOMBRES = ("niveau", "physique", "social", "mental", "sante", "psy")


def compagnon(a: dict, couleurs: dict, cles: dict, image, public, candidats: list) -> dict | None:
    """Un héros de la compagnie, passé au masque et à la détection des inconnus comme le reste du carnet (public) : un
    texte qui en nomme un s'efface, un thème ou une vocation s'en va."""
    # L'allure n'est pas retenue d'avance : public() la retient avec le reste, et le dit au MJ dans l'onglet Carnet.
    tv = tv_fiches.couleur_tv(tv_fiches.aventurier_public(a, []), a, couleurs)

    def sans_secret(liste) -> list:
        return [x for x in (utilitaires.texte(v) for v in liste or []) if x.strip() and not secrets_dans(x, candidats)][:6]

    element = {k: " ".join(utilitaires.texte(tv.get(k)).split()) for k in COMPAGNIE_TEXTES}
    element |= {k: carnet.nombre_borne(tv.get(k), 0, 999, None) for k in COMPAGNIE_NOMBRES}
    # L'élément ne sert qu'au titre d'un demi-élémentaire : rien quand le peuple est gardé secret.
    element["element"] = "" if a.get("peuple_cache") else " ".join(utilitaires.texte(tv.get("element")).split())
    element["vocations"], element["themes"] = sans_secret(tv.get("vocations")), sans_secret(tv.get("themes"))
    couleur = utilitaires.texte(tv.get("couleur"))
    element["couleur"] = couleur if tv_boutique_combat.COULEUR_VALIDE.fullmatch(couleur) else ""
    element["illustration"] = image(tv.get("illustration"))
    element["cle"] = cles.get(a["id"], "")
    propre = public(element, "nom", (f"{liens_joueurs.nom_de(a)} (la compagnie)", False))
    # Le jeton qui désigne ce compagnon pour un don (inventaire.py) : opaque, jamais l'identifiant de sa fiche.
    if propre is not None:
        propre["ref"] = ref_compagnon(a["id"])
    return propre


def ref_compagnon(ident: str) -> str:
    return tv_cartes.jeton("compagnie", ident)


def publier_carnet() -> dict:
    with carnet.PUBLICATION:
        ouvert = carnet_ouvert()
        sections, heros, images, retenus = elements_du_carnet() if ouvert else ({}, {}, {}, [])
        ecrits = carnet.publier(config.PROPOSITIONS, sections, heros, images, ouvert)
        carnet.publier_coin(config.PROPOSITIONS, **ce_que_le_coin_sait())
        return ecrits | {"retenus": retenus}


def ce_que_le_coin_sait() -> dict:
    """Ce que le coin des joueurs sait, carnet ouvert ou fermé (carnet.publier_coin) : la date de la prochaine séance,
    déjà lue par la table publique fermée ; les couleurs des héros de la tablée, déjà vues à la TV ; et pour chaque
    joueur dont le héros est à la tablée en ce moment, son nom masqué, sous la clé de son lien."""
    aventuriers = tous_les_aventuriers()
    couleurs = [utilitaires.texte(a.get("couleur")) for a in aventuriers.values() if liens_joueurs.a_la_tablee(a) and liens_joueurs.nom_de(a)]
    liens, presents = heros_des_joueurs(aventuriers), []
    for j in joueurs_mj.joueurs_lus():
        a = liens.get(utilitaires.texte(j.get("id"))) if isinstance(j, dict) else None
        if a and isinstance(j.get("jeton"), str):
            presents.append({"cle": carnet.cle_heros(hashlib.sha256(j["jeton"].encode()).hexdigest()),
                             "nom": masquer(liens_joueurs.nom_de(a)), "genre": a.get("genre")})
    return {"prochaine": tv_etat.prochaine_seance(), "couleurs": couleurs, "presents": presents}


def sources_du_carnet() -> int:
    """L'empreinte des fichiers dont le carnet est tiré (dates et tailles) : tant qu'elle ne bouge pas, rien n'est relu."""
    vus = []
    # Le nom de l'auberge pour les joueurs aussi : chaque texte du carnet le porte, masqué.
    for f in [*(f for d in (config.PNJ, config.LIEUX, config.CONTRATS, config.RUMEURS, config.SEANCES, config.AVENTURIERS, config.BOUTIQUES, config.DOCUMENTS, config.PROPOSITIONS) for f in d.glob("*.json")),
              heros_etat.ETATS_HEROS, config.JOUEURS, CARNET_JOUEURS, config.PROPOSITIONS / ".acces.json", noms_caches.NOM_AUBERGE, refuge.SANCTUAIRE, actions_coin.activites_mj.fichier,
              actions_coin.activites_mj.journal.fichier]:
        try:
            st = f.stat()
        except OSError:
            continue
        vus.append((str(f), st.st_mtime_ns, st.st_size))
    return hash(tuple(sorted(vus)))


def tour_du_carnet(suivi: dict) -> None:
    """Un passage de la tâche de fond : rien tant que les sources n'ont pas bougé (sauf toutes les dix minutes). Un échec
    n'est retenté qu'au changement suivant, et la même erreur n'est notée qu'une fois au journal."""
    try:
        sources = sources_du_carnet()
        if sources == suivi.get("vue") and time.monotonic() - suivi.get("depuis", 0.0) < CARNET_RELECTURE:
            return
        suivi.update(vue=sources, depuis=time.monotonic())
        publier_carnet()
        suivi["erreur"] = ""
    except Exception as err:
        if repr(err) != suivi.get("erreur"):
            suivi["erreur"] = repr(err)
            config.journal.exception("Carnet des joueurs non publié")


async def surveiller_carnet() -> None:
    suivi: dict = {}
    while True:
        await asyncio.to_thread(tour_du_carnet, suivi)
        await asyncio.sleep(CARNET_INTERVALLE)


@app.get("/api/carnet-joueurs")
def lire_carnet_joueurs():
    """L'interrupteur, ce que lisent les joueurs en ce moment, section par section, et ce que le carnet retient : le MJ
    le voit avant d'ouvrir (le carnet est alors calculé sans être écrit) comme après."""
    dossier = config.PROPOSITIONS / carnet.CARNET
    sommaire = carnet.lire_publie(dossier / f"{carnet.SOMMAIRE}.json") or {}
    sections = {e.get("section"): e.get("nombre") for e in sommaire.get("elements", []) if isinstance(e, dict)}
    if sommaire.get("ouvert"):
        sections[carnet.REGLES] = len((carnet.lire_publie(dossier / f"{carnet.REGLES}.json") or {}).get("elements") or [])
    # Les héros de la tablée qu'aucun joueur ne lit : le carnet ne leur montre pas leur fiche, l'échoppe ne prend rien pour eux.
    aventuriers = tous_les_aventuriers()
    libres = liens_joueurs.sans_lien(aventuriers, heros_des_joueurs(aventuriers))
    return {"ouvert": carnet_ouvert(), "maj": sommaire.get("maj"), "sections": sections, "retenus": elements_du_carnet()[3],
            "sans_lien": [{"id": a["id"], "nom": liens_joueurs.nom_de(a), "joueur": " ".join(utilitaires.texte(a.get("joueur")).split())} for a in libres]}


@app.put("/api/carnet-joueurs")
async def changer_carnet_joueurs(requete: Request):
    ouvert = (await utilitaires.corps_objet(requete)).get("ouvert")
    if not isinstance(ouvert, bool):
        raise HTTPException(400, "Champ « ouvert » invalide")
    utilitaires.ecrire(CARNET_JOUEURS, {"ouvert": ouvert, "modifie": utilitaires.maintenant()})
    await asyncio.to_thread(publier_carnet)
    return await asyncio.to_thread(lire_carnet_joueurs)


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import utilitaires, heros_etat, joueurs_mj, commandes_api, noms_caches, tv_cartes, tv_fiches, tv_boutique_combat, tv_etat, refuge, actions_coin  # noqa: E402
