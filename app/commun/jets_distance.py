"""Les jets à distance, partagés par le coin des joueurs et l'atelier : en visio comme autour de la table, un
joueur lance un test depuis son téléphone, et le MJ peut lui en demander un (« Léa : test de Mental »).

Deux genres de la file des demandes (demandes.py), appliqués seuls, silencieux pour Telegram, hors de la boîte du MJ et de
« Mes demandes » (ils vivent dans le Tableau, la télécommande et sous le pouce du joueur) :
  - « jet » : le joueur lance. Il n'envoie que la caractéristique, le nom de la compétence qui aide et un modificateur
    (ou, pour un test demandé, l'identifiant de la demande et la compétence) : le dé se jette dans l'atelier, sur la fiche
    de l'atelier (jets.py), quand la boîte voit la demande. L'atelier écrit le résultat dans « public » ;
  - « jet-demande » : le MJ demande un test. L'atelier seul l'écrit, déjà appliqué (le coin le refuse : son validateur ne
    laisse rien passer). Le joueur la voit tant qu'elle est ouverte : ni répondue, ni retirée par le MJ, ni passée (DUREE_DEMANDE).
    Le coin la marque « repondue » quand le joueur lance ; la caractéristique et le modificateur viennent alors du registre
    de l'atelier (jets_mj.py), jamais du coin.

Depuis le 11/11 : « avantage » vrai dans un test dépense le jeton d'avantage du héros pour +10 % (AVANTAGE), en combat
comme hors combat ; et l'avantage ne choisit plus la face d'un dé d'aventure avant le lancer, il la change après, le dé vu
(genre « jet-face », appliqué seul : changer_face ici, appliquer_face dans jets_mj.py).

Lot G, les dés : un troisième genre, « des » (des dés libres, « 2D6+1 », ou les dégâts d'une arme de la fiche), appliqué
seul comme « jet », compté avec lui dans PAR_HEURE, un seul des deux en route à la fois (des.py). Et le dé d'aventure (règle du
kit, reserve.py) : le joueur coche « aventure » dans son test, et peut dépenser son avantage pour choisir la face d'un dé
d'aventure ou de mésaventure (« choix ») ; l'atelier seul décide, au moment où il lance, si le dé est là et si le jeton aussi.

Ce que le coin lit pour proposer le choix : la fiche de jet que l'atelier publie pour chaque héros à la tablée, table du coin
ouverte, sous la clé du lien de son joueur (propositions/jets/<clé>.json) : ses trois caractéristiques, ses compétences qui
aident, ses cartons et sa posture. Le coin ne s'en sert que pour dire les chances au joueur, jamais pour lancer.

Depuis le 12/11, la posture offensive élargit les critiques des tests lancés d'ici : réussite critique de 01 à 10, échec
critique de 91 à 100 (jets.seuils_de). L'atelier lit la posture du moment sur sa fiche de jet ; le coin l'annonce d'après la
fiche publiée (critiques). Les activités entre les séances n'en tiennent pas compte ; le focus ne compte toujours pas.

Un seul endroit pour ce qui change la valeur visée en plus (les cartons) : ajustements(), appelé par l'atelier qui lance
et par le coin qui dit les chances, pour les tests comme pour les activités entre les séances (activites_mj.py).

Ce module ne lit rien de l'atelier : joueurs.py et jets_mj.py l'importent tous deux.
"""
import re
from datetime import datetime
from pathlib import Path

from commun import demandes
from commun import des
from commun import jets
from commun.demandes import Genre, Refus
from commun import stockage

GENRE = "jet"
GENRE_DEMANDE = "jet-demande"
GENRE_DES = "des"  # lot G : des dés libres, ou les dégâts d'une arme
# L'avantage dépensé après le lancer pour changer la face d'un dé d'aventure ou de mésaventure de son dernier test.
GENRE_FACE = "jet-face"
DES_DU_TEST = ("aventure", "mesaventure")
DUREE_FACE = 600  # secondes : au-delà, le dé d'un test ne se change plus
AVANTAGE = 10  # % ajoutés à la valeur visée par un avantage dépensé pour le test
LIBELLE_AVANTAGE = "Avantage"
LANCES = (GENRE, GENRE_DES)  # ce qui roule depuis le téléphone : un seul en route à la fois, un seul plafond
DOSSIER = "jets"  # propositions/jets/<clé>.json : la fiche de jet de chaque héros, écrite par l'atelier seul
CLE = re.compile(r"^[a-f0-9]{32}$")
FICHE_OCTETS_MAX = 16 * 1024

PAR_HEURE = 60  # tests lancés par joueur et par heure (un par minute en moyenne) ; ceux que le MJ demande n'y comptent pas
EN_ROUTE = 60  # secondes : un jet que l'atelier n'a pas lancé à temps ne l'est plus (il échoue, le joueur relance)
DUREE_DEMANDE = 600  # secondes : un test demandé par le MJ attend dix minutes, puis passe
GARDES = 3  # jets et demandes clos gardés dans le fichier du joueur : une partie animée ne chasse pas ses autres demandes
COMPETENCE_MAX = 60
MODIFICATEUR_MAX = 50  # au-delà, ce n'est plus un test : le MJ le dit de vive voix
COMPETENCES_MAX = 40
ARMES_MAX = 12
ARME_MAX = 60
ARME_PARTIE = "Cette arme n'est plus sur votre fiche, ou ses dégâts ont changé : rouvrez la feuille."
FERMEE = "La table est fermée : les tests se lancent pendant la partie, quand votre MJ ouvre la table."
ABSENT = "Votre héros n'est pas à la tablée en ce moment : votre MJ s'en occupera."
TROP_TARD = "Ce test est arrivé trop tard chez votre MJ : relancez-le."
SEUL_LE_MJ = "Seul votre MJ demande un test."


# ---------------------------------------------------------------- les genres

def modificateur(v) -> int:
    if v is None:
        return 0
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v in (float("inf"), float("-inf")):
        raise Refus(400, "Le modificateur est illisible.")
    return jets.entier(v, -MODIFICATEUR_MAX, MODIFICATEUR_MAX)


def caracteristique(v) -> str:
    # Un texte d'abord : une liste ou un objet ne se cherche pas dans un dict (TypeError, une erreur 500).
    if not isinstance(v, str) or v not in jets.CARACS:
        raise Refus(400, "Choisissez Physique, Social ou Mental.")
    return v


def avec_les_des(corps: dict, propre: dict) -> dict:
    """Le dé d'aventure : « aventure » vrai pour en ajouter un. Et l'avantage du héros dépensé pour ce test
    (« avantage » vrai : +10 % à la valeur visée, le jeton s'en va quand le dé roule). Absents, rien ne s'ajoute au corps.

    Depuis le 11/11, l'avantage ne choisit plus la face d'un dé d'aventure avant le lancer : il la change après, une fois
    le dé vu (genre « jet-face », plus bas). Un « choix » envoyé avec le test est refusé (une page restée ouverte)."""
    aventure = corps.get("aventure")
    if aventure not in (None, True, False):
        raise Refus(400, "« aventure » : oui ou non.")
    if aventure:
        propre["aventure"] = True
    avantage = corps.get("avantage")
    if avantage not in (None, True, False):
        raise Refus(400, "« avantage » : oui ou non.")
    if avantage:
        propre["avantage"] = True
    if corps.get("choix") is not None:
        raise Refus(400, "L'avantage se joue maintenant après le lancer du dé d'aventure : rechargez la page.")
    return propre


def valider_jet(corps) -> dict:
    """{carac, competence, modificateur} ; ou {demande, competence} pour un test demandé par le MJ ; et, au besoin, le dé
    d'aventure (avec_les_des). Tout autre champ (un dé, une valeur visée, une issue) est ignoré : le test se jette dans
    l'atelier, sur la fiche de l'atelier."""
    if not isinstance(corps, dict):
        raise Refus(400, "Le test : demande illisible.")
    competence = corps.get("competence")
    competence = demandes.texte_propre(competence if competence is not None else "", COMPETENCE_MAX, "Le nom de la compétence", lignes=False)
    ref = corps.get("demande")
    if ref is not None:
        if not isinstance(ref, str) or not demandes.ID_DEMANDE.match(ref):
            raise Refus(400, "Ce test demandé n'existe pas.")
        # La caractéristique et le modificateur sont ceux du MJ : le coin les recopie de sa demande, l'atelier les reprend
        # de son registre.
        return avec_les_des(corps, {"demande": ref, "carac": caracteristique(corps.get("carac")), "competence": competence,
                                    "modificateur": modificateur(corps.get("modificateur"))})
    return avec_les_des(corps, {"carac": caracteristique(corps.get("carac")), "competence": competence,
                                "modificateur": modificateur(corps.get("modificateur"))})


def valider_des(corps) -> dict:
    """{des} : l'expression des dés libres (« 2D6+1 ») ; ou {arme, des} pour les dégâts d'une arme de la fiche, que l'atelier
    relit sur sa fiche à lui (le nom et les dégâts doivent y être, tels que publiés). Jamais un résultat."""
    if not isinstance(corps, dict):
        raise Refus(400, "Les dés : demande illisible.")
    lu = des.lire(corps.get("des"))
    if lu is None:
        raise Refus(400, f"Ces dés ne se lancent pas : de 1 à {des.NOMBRE_MAX} dés (D4, D6, D8, D10, D12, D20 ou D100), "
                         f"et un bonus de -{des.BONUS_MAX} à +{des.BONUS_MAX}.")
    propre = {"des": lu["texte"]}
    if corps.get("arme") is not None:
        propre["arme"] = demandes.texte_propre(corps["arme"], ARME_MAX, "Le nom de l'arme", lignes=False)
        if not propre["arme"]:
            raise Refus(400, "Le nom de l'arme manque.")
    return propre


def valider_demande(corps) -> dict:
    """Le test que demande le MJ (l'atelier seul) : {carac, modificateur}."""
    if not isinstance(corps, dict):
        raise Refus(400, "Le test demandé : demande illisible.")
    return {"carac": caracteristique(corps.get("carac")), "modificateur": modificateur(corps.get("modificateur"))}


def refuser_du_coin(_corps) -> dict:
    raise Refus(403, SEUL_LE_MJ)


def valider_face(corps) -> dict:
    """{jet, de, face} : le test (son identifiant), le dé d'aventure ou de mésaventure de ce test, et la face voulue."""
    if not isinstance(corps, dict):
        raise Refus(400, "Le dé à changer : demande illisible.")
    ref = corps.get("jet")
    if not isinstance(ref, str) or not demandes.ID_DEMANDE.match(ref):
        raise Refus(400, "Ce test n'existe pas.")
    if corps.get("de") not in DES_DU_TEST or des.face(corps.get("face")) is None:
        raise Refus(400, "La face choisie : le dé d'aventure ou de mésaventure, et une face de 1 à 6.")
    return {"jet": ref, "de": corps["de"], "face": corps["face"]}


demandes.enregistrer(Genre(GENRE_FACE, "Un dé d'aventure changé", ("un dé d'aventure changé", "{n} dés d'aventure changés"),
                           attente=False, valider=valider_face, silencieux=True, liste=False,
                           statuts={demandes.A_APPLIQUER: "en route", demandes.APPLIQUEE: "changé"}))
demandes.enregistrer(Genre(GENRE, "Un test lancé", ("un test lancé", "{n} tests lancés"), attente=False, valider=valider_jet,
                           silencieux=True, liste=False, statuts={demandes.A_APPLIQUER: "le dé roule", demandes.APPLIQUEE: "lancé"}))
demandes.enregistrer(Genre(GENRE_DES, "Des dés lancés", ("des dés lancés", "{n} lancers de dés"), attente=False, valider=valider_des,
                           silencieux=True, liste=False, statuts={demandes.A_APPLIQUER: "les dés roulent", demandes.APPLIQUEE: "lancés"}))
demandes.enregistrer(Genre(GENRE_DEMANDE, "Un test demandé par le MJ", ("un test demandé", "{n} tests demandés"), attente=False,
                           valider=refuser_du_coin, silencieux=True, liste=False,
                           statuts={demandes.APPLIQUEE: "demandé par le MJ", demandes.ANNULEE: "retiré par le MJ"}))


# ---------------------------------------------------------------- la valeur visée : le seul endroit des ajustements

# Les cartons du héros, comme en jeu (CARTONS de js/combats/suivi.js) : sur la caractéristique cartonnée seulement.
CARTONS = {"jaune": -10, "rouge": -30}


def ajustements(fiche: dict, carac: str) -> list:
    """Ce qui change la valeur visée en plus de la caractéristique, de la compétence et du modificateur, [(libellé,
    valeur)] pour jets.visee : le carton du héros sur cette caractéristique (jaune -10 %, rouge -30 %), lu dans son état
    du moment. L'atelier lance avec, le coin dit les chances avec les mêmes.

    choix du 09/11 : les cartons comptent dans les jets lancés du téléphone ; la posture focus n'y compte jamais
    (ni son +5 %, ni une phrase pour le dire). La règle générale du focus hors combat n'est pas tranchée ici.
    La posture offensive ne change pas la valeur visée : elle élargit les critiques (jets.seuils_de, critiques() ici)."""
    cartons = fiche.get("cartons") if isinstance(fiche, dict) and isinstance(fiche.get("cartons"), dict) else {}
    carton = cartons.get(carac) if isinstance(carac, str) else None
    if carton not in CARTONS:
        return []
    return [(f"Carton {carton} en {jets.CARACS.get(carac, carac)}", CARTONS[carton])]


def critiques(posture) -> dict:
    """Les seuils des critiques d'un jet lancé à la table, tels que la page les dit : {reussite: 5, echec: 96}, ou
    {reussite: 10, echec: 91, offensive: True} en posture offensive."""
    bas, haut = jets.seuils_de(posture)
    return {"reussite": bas, "echec": haut, "offensive": (bas, haut) != jets.SEUILS}


def chances(fiche: dict, carac: str, competence: str = "", mod: int = 0) -> dict:
    """La valeur visée et les chances, d'après la fiche de jet : ce que dit la page, ce que lance l'atelier."""
    v = jets.visee(fiche, carac, [competence] if competence else [], mod, ajustements(fiche, carac))
    seuils = jets.seuils_de(fiche.get("posture") if isinstance(fiche, dict) else None)
    return {"visee": v["visee"], "chances": jets.chances(v["visee"], seuils), "competence": v["competence"], "bonus": v["bonus"],
            "ajustements": v["ajustements"]}


# ---------------------------------------------------------------- la fiche de jet publiée

def chemin_fiche(depot: Path, cle: str) -> Path | None:
    return depot / DOSSIER / f"{cle}.json" if isinstance(cle, str) and CLE.match(cle) else None


def armes_lisibles(armes) -> list:
    """Les armes dont les dégâts se lisent (des.lire) : {nom, degats} seulement, jamais les notes ; une même arme deux fois
    sur la fiche ne fait qu'un bouton."""
    vues, sortie = set(), []
    for w in armes or [] if isinstance(armes, list) else []:
        if not isinstance(w, dict) or not isinstance(w.get("nom"), str) or not w["nom"].strip():
            continue
        lu = des.lire(w.get("degats"))
        nom = " ".join(w["nom"].split())[:ARME_MAX]
        if lu is None or (nom, lu["texte"]) in vues:
            continue
        vues.add((nom, lu["texte"]))
        sortie.append({"nom": nom, "degats": lu["texte"]})
    return sortie[:ARMES_MAX]


def reserve_valide(r) -> dict:
    """Les réserves publiées : la règle en jeu, et les deux nombres."""
    if not isinstance(r, dict) or r.get("actif") is not True:
        return {"actif": False}
    return {"actif": True, **{k: jets.entier(r.get(k), 0, 99) for k in ("aventure", "mesaventure")}}


def vitalite_valide(v) -> dict | None:
    """La Santé et la Psy du moment, avec leurs maximums et la Santé payée en dons (elle ne se soigne pas) : ce que le
    joueur règle depuis la table du coin (etat_joueur.py). Absente d'une fiche d'avant le 11/11."""
    if not isinstance(v, dict):
        return None
    sante_max = jets.entier(v.get("sante_max"), 1, 999)
    psy_max = jets.entier(v.get("psy_max"), 0, 999)
    return {"sante": jets.entier(v.get("sante"), -999, sante_max), "sante_max": sante_max,
            "psy": jets.entier(v.get("psy"), 0, psy_max), "psy_max": psy_max,
            "sante_don": jets.entier(v.get("sante_don"), 0, 999)}


def fiche_valide(f) -> dict | None:
    """La fiche de jet telle qu'elle se relit : les trois caractéristiques en entiers, des compétences {nom, bonus}, les
    cartons et la posture ; et depuis le lot G, les armes {nom, degats}, le jeton d'avantage du héros (hors combat), les
    réserves de dés d'aventure et le dé de mésaventure annoncé. Tout le reste est laissé de côté."""
    if not isinstance(f, dict) or not isinstance(f.get("nom"), str):
        return None
    competences = []
    for c in f.get("competences") or []:
        if isinstance(c, dict) and isinstance(c.get("nom"), str) and c["nom"].strip():
            competences.append({"nom": c["nom"].strip()[:COMPETENCE_MAX], "bonus": jets.entier(c.get("bonus"), -jets.VALEUR_MAX, jets.VALEUR_MAX)})
    cartons = f.get("cartons") if isinstance(f.get("cartons"), dict) else {}
    return {"nom": f["nom"][:120], **{k: jets.entier(f.get(k), 0, jets.VALEUR_MAX) for k in jets.CARACS},
            "competences": competences[:COMPETENCES_MAX],
            "cartons": {k: cartons[k] for k in jets.CARACS if cartons.get(k) in ("jaune", "rouge")},
            "posture": f.get("posture") if f.get("posture") in ("offensive", "defensive", "focus") else "",
            "armes": armes_lisibles(f.get("armes")),
            "jeton": f.get("jeton") if f.get("jeton") in ("avantage", "desavantage") else "", "combat": f.get("combat") is True,
            "vitalite": vitalite_valide(f.get("vitalite")),
            "reserve": reserve_valide(f.get("reserve")),
            "mesaventure": {"face_choisie": f["mesaventure"].get("face_choisie") is True} if isinstance(f.get("mesaventure"), dict) else None}


def fiche_publiee(depot: Path, cle: str) -> dict | None:
    """La fiche de jet du héros de cette clé (celle du lien du joueur, jamais une clé venue de la requête), ou None."""
    chemin = chemin_fiche(depot, cle)
    if chemin is None:
        return None
    try:
        if chemin.stat().st_size > FICHE_OCTETS_MAX:
            return None
        return fiche_valide(stockage.lire_json(chemin))
    except (OSError, ValueError):
        return None


# ---------------------------------------------------------------- le fichier du joueur

def instant_de(iso) -> datetime | None:
    try:
        return datetime.fromisoformat(iso) if isinstance(iso, str) else None
    except ValueError:
        return None


def age(d: dict, instant: datetime) -> float | None:
    cree = instant_de(d.get("cree"))
    return None if cree is None else (instant - cree).total_seconds()


def en_route(d: dict, instant: datetime) -> bool:
    """Un jet (test ou dés) que l'atelier n'a pas encore lancé, et qu'il lancera encore."""
    if d.get("genre") not in LANCES or d.get("statut") != demandes.A_APPLIQUER:
        return False
    a = age(d, instant)
    return a is not None and -60 < a < EN_ROUTE


def ouverte(d: dict, instant: datetime) -> bool:
    """Un test demandé par le MJ, que le joueur peut encore lancer : posé par l'atelier, ni répondu, ni retiré, ni passé.
    Une date un peu en avance (deux horloges) compte comme posée à l'instant ; une date illisible, comme passée."""
    if d.get("genre") != GENRE_DEMANDE or d.get("statut") != demandes.APPLIQUEE or d.get("par") != "mj" or d.get("repondue"):
        return False
    a = age(d, instant)
    return a is not None and -60 < a < DUREE_DEMANDE


def reste(d: dict, instant: datetime) -> float:
    a = age(d, instant)
    return 0.0 if a is None else round(max(0.0, min(DUREE_DEMANDE, DUREE_DEMANDE - a)), 1)


def ranger(liste: list, instant: datetime) -> list:
    """Sous le verrou : seuls les GARDES derniers jets clos et les GARDES dernières demandes closes restent ; un jet en
    route et une demande ouverte ne bougent pas."""
    # Un jet pas encore lancé, même trop vieux (l'atelier arrêté), reste jusqu'à ce que l'atelier le passe en échec.
    jets_clos = [d for d in liste if d.get("genre") in LANCES and d.get("statut") != demandes.A_APPLIQUER]
    demandes_closes = [d for d in liste if d.get("genre") == GENRE_DEMANDE and not ouverte(d, instant)]
    vieux = {id(d) for groupe in (jets_clos, demandes_closes) for d in groupe[:-GARDES]}
    return [d for d in liste if id(d) not in vieux]


def lancer(depot: Path, joueur: str, corps: dict) -> dict:
    """Le coin écrit le jet du joueur, sous le verrou : un seul en route à la fois (test ou dés) ; pour un test demandé, la
    demande doit être ouverte, et elle est marquée répondue (le MJ ne la retire plus, le joueur ne la relance pas). Un corps
    avec « des » : des dés libres ou les dégâts d'une arme (genre « des »)."""
    instant = datetime.now()
    with demandes.verrou(depot):
        liste = demandes.lire(depot, joueur)
        if any(en_route(d, instant) for d in liste):
            raise Refus(409, "Votre test précédent roule encore : un instant.")
        if isinstance(corps, dict) and "des" in corps:
            d = demandes.nouvelle({"genre": GENRE_DES, "corps": {k: corps[k] for k in ("des", "arme") if k in corps}})
            demandes.ecrire(depot, joueur, [*ranger(liste, instant), d])
            return d
        ref = corps.get("demande") if isinstance(corps, dict) else None
        demande = None
        if ref is not None:
            demande = demandes.trouver(liste, ref) if isinstance(ref, str) else None
            if demande is None or demande.get("genre") != GENRE_DEMANDE:
                raise Refus(404, "Ce test demandé n'existe pas.")
            if not ouverte(demande, instant):
                raise Refus(409, "Votre MJ ne demande plus ce test." if demande.get("statut") == demandes.ANNULEE or not demande.get("repondue")
                            else "Vous avez déjà lancé ce test.")
            c = demande.get("corps") if isinstance(demande.get("corps"), dict) else {}
            corps = {**corps, "carac": c.get("carac"), "modificateur": c.get("modificateur")}
        d = demandes.nouvelle({"genre": GENRE, "corps": corps})
        if demande is not None:
            demande.update(repondue=d["id"], version=demande["version"] + 1, modifie=d["cree"])
        demandes.ecrire(depot, joueur, [*ranger(liste, instant), d])
    return d


def changer_face(depot: Path, joueur: str, corps: dict, jeton: str) -> dict:
    """Le coin écrit le changement de face, sous le verrou : seulement pour le dernier test du joueur, lancé depuis moins de
    DUREE_FACE, dont ce dé a roulé et n'a été ni choisi ni annulé ; le héros doit porter son avantage (la fiche publiée) ;
    un seul changement en route à la fois. L'atelier revérifie tout sur son registre et retire le jeton."""
    propre = valider_face(corps)
    instant = datetime.now()
    with demandes.verrou(depot):
        liste = demandes.lire(depot, joueur)
        if any(d.get("genre") == GENRE_FACE and d.get("statut") == demandes.A_APPLIQUER and (age(d, instant) or 0) < EN_ROUTE for d in liste):
            raise Refus(409, "Votre changement précédent est en route : un instant.")
        tests = [d for d in liste if d.get("genre") == GENRE and d.get("statut") == demandes.APPLIQUEE]
        jet = tests[-1] if tests else None
        if jet is None or jet.get("id") != propre["jet"]:
            raise Refus(409, "Seul le dé de votre dernier test se change.")
        a = age(jet, instant)
        if a is None or a > DUREE_FACE:
            raise Refus(409, "Ce test est trop ancien : son dé ne se change plus.")
        x = de_du_test(liste, jet, propre["de"])
        if x is None or x.get("annule"):
            raise Refus(409, "Ce dé n'a pas roulé avec ce test.")
        if x.get("choisie"):
            raise Refus(409, "L'effet de ce dé a déjà été choisi.")
        if jeton != "avantage":
            raise Refus(409, "Votre héros ne porte pas d'avantage.")
        d = demandes.nouvelle({"genre": GENRE_FACE, "corps": propre})
        clos = [x for x in liste if x.get("genre") == GENRE_FACE and x.get("statut") != demandes.A_APPLIQUER]
        vieux = {id(x) for x in clos[:-GARDES]}
        demandes.ecrire(depot, joueur, [*[x for x in liste if id(x) not in vieux], d])
    return d


def de_du_test(liste: list, jet: dict, de: str) -> dict | None:
    """Le dé d'aventure ou de mésaventure d'un test tel que le joueur le lit : celui que l'atelier a écrit avec le test, ou
    la face que le joueur a choisie ensuite en dépensant son avantage (la dernière demande « jet-face » appliquée)."""
    p = jet.get("public") if isinstance(jet.get("public"), dict) else {}
    x = p.get(de) if isinstance(p.get(de), dict) else None
    if x is None:
        return None
    for d in liste:
        c = d.get("corps") if isinstance(d.get("corps"), dict) else {}
        pub = d.get("public") if isinstance(d.get("public"), dict) else None
        if d.get("genre") == GENRE_FACE and d.get("statut") == demandes.APPLIQUEE and c.get("jet") == jet.get("id") and c.get("de") == de and pub:
            x = {**x, "face": pub.get("face"), "effet": pub.get("effet"), "choisie": True}
    return x


def resultat(d: dict, liste: list | None = None) -> dict:
    """Ce que le joueur relit d'un de ses jets : son état, et le résultat écrit par l'atelier (déjà au masque, sans inconnu)."""
    p = d.get("public") if isinstance(d.get("public"), dict) else {}
    if p and liste and d.get("genre") == GENRE:
        p = {**p, **{k: de_du_test(liste, d, k) for k in DES_DU_TEST if isinstance(p.get(k), dict)}}
    return {"id": d["id"], "genre": d.get("genre"), "statut": d["statut"], "cree": d.get("cree"), "traitee": d.get("traitee"),
            "phrase": d.get("resultat") if d["statut"] == demandes.ECHEC else "", "demande": bool((d.get("corps") or {}).get("demande")),
            **({"public": p} if p else {})}


def etat(liste: list, instant: datetime | None = None) -> dict:
    """Ce que lit la page du joueur, de ses jets seulement : celui qui roule, le dernier lancé (ou refusé), le test que son MJ
    lui demande."""
    instant = instant or datetime.now()
    mes_jets = [d for d in liste if d.get("genre") in LANCES]
    route = next((d for d in reversed(mes_jets) if en_route(d, instant)), None)
    fini = next((d for d in reversed(mes_jets) if d.get("statut") in (demandes.APPLIQUEE, demandes.ECHEC)), None)
    demande = next((d for d in reversed(liste) if ouverte(d, instant)), None)
    vue_demande = None
    if demande is not None:
        c = demande.get("corps") if isinstance(demande.get("corps"), dict) else {}
        vue_demande = {"id": demande["id"], "carac": c.get("carac"), "carac_nom": jets.CARACS.get(c.get("carac"), ""),
                       "modificateur": c.get("modificateur") or 0, "cree": demande.get("cree"), "reste": reste(demande, instant),
                       "duree": DUREE_DEMANDE}
    return {"en_route": {"id": route["id"], "cree": route.get("cree")} if route else None,
            "dernier": resultat(fini, liste) if fini else None, "demande": vue_demande,
            # Le changement de face en route, ou le dernier refusé (sa phrase), pour la feuille du résultat.
            "face": etat_face(liste, instant)}


def etat_face(liste: list, instant: datetime) -> dict | None:
    faces = [d for d in liste if d.get("genre") == GENRE_FACE]
    if not faces:
        return None
    d = faces[-1]
    c = d.get("corps") if isinstance(d.get("corps"), dict) else {}
    en_cours = d.get("statut") == demandes.A_APPLIQUER and (age(d, instant) or 0) < EN_ROUTE
    return {"id": d["id"], "jet": c.get("jet"), "de": c.get("de"), "en_route": en_cours,
            "phrase": d.get("resultat") if d.get("statut") == demandes.ECHEC else ""}
