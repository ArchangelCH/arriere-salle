"""Les activités entre les séances dans l'atelier : le catalogue du MJ, le dé jeté pour chaque demande, la
section « activites » du carnet et ce que la boîte du MJ fait de l'or (activites.py, jets.py).

- Le catalogue, data/activites.json, s'écrit dans l'atelier (page « Les activités », depuis l'onglet Auberge) : la période
  (une semaine, ou l'intervalle entre deux séances), et chaque activité avec sa caractéristique, les compétences qui
  aident, son modificateur, l'or et sa destination pour chaque issue (une formule de dés, vers la bourse ou une cagnotte),
  le récit type de chaque issue, s'il est montré aux joueurs et combien de places il offre par période. Les petits
  contrats s'y écrivent à la main : rien n'est tiré des contrats de l'atelier ni de leurs champs secrets. Fermé aux
  joueurs tant que le MJ ne l'ouvre pas.
- Le dé se jette quand la boîte voit la demande (boite.preparer), sous le verrou de la file, sur la fiche de l'atelier :
  caractéristique, meilleur bonus parmi les compétences qui aident, modificateur, carton du héros sur la caractéristique
  (son état du moment, jets_distance.ajustements, comme les tests lancés du téléphone) ; rien de ce qu'envoie le coin. Le
  journal data/journal-activites.jsonl le garde, avec l'or proposé par la formule : lui seul fait foi (une demande
  réécrite par un coin indiscipliné ne fait pas un jet). Le joueur lit aussitôt son jet et le récit type de l'issue, au
  prénom et à l'accord de son héros, passé au masque et sans inconnu ; l'or attend le MJ.
- La réserve et le tableau (19/11) : chaque activité a un rythme (chaque semaine, souvent, parfois, rarement ; absent, chaque
  semaine : un catalogue d'avant reste tel quel). Au début de chaque période, l'atelier tire au tableau, selon le rythme,
  quelques activités qui ne sont pas de chaque semaine (« offres », 3 par défaut), en évitant celles de la période d'avant, et
  la première quête unique jamais proposée. Le tirage s'écrit une fois, à part (data/activites-tirages.json, jamais dans le
  catalogue) : retoucher la réserve en cours de période ne change pas le tableau, sauf qu'une activité cachée en sort et
  qu'une activité de chaque semaine y entre aussitôt. Le MJ peut changer, retirer ou ajouter une offre tant qu'elle n'est
  pas jouée. Seul le tableau de la période sort vers le coin : ni la réserve, ni ce qui n'est pas tiré.
- Chaque activité du tableau une fois par héros et par période, comptée sur ce journal ; les places d'une activité aussi. Le MJ peut rendre son
  tour à un joueur en refusant.
- Le MJ valide dans sa boîte (une carte, puis le détail) : le montant, modifiable, et sa destination (la bourse du héros,
  par la route du sac ; la cagnotte d'un chantier, par verser_don, qui ne débite aucune bourse), « ce que le héros
  apprend » (au masque, refusé s'il nomme un inconnu des joueurs), un objet glissé dans l'équipement de son sac (au masque
  aussi, avec l'or dans la même écriture), un mot. Ensuite : « Mon héros », le sanctuaire et la
  section republiés avant que le statut ne parte, le journal de la séance, la TV qui montre le sanctuaire, les pages de
  l'atelier. Les suites (une rumeur, une idée, un contrat en brouillon) passent par les routes de l'atelier, côté page.

Ce module ne connaît de l'atelier que les fonctions que main.py lui passe.
"""
import asyncio
import json
import logging
import re
import secrets
import threading
import unicodedata
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Awaitable, Callable

from fastapi import APIRouter, HTTPException, Request

from commun import activites
from commun import carnet
from commun import demandes
from commun import jets
from commun import jets_distance
from commun.demandes import Refus
from table.masque import masquer, masquer_tout, secrets_dans
from commun import stockage

journal = logging.getLogger("atelier.activites")

FICHIER = "activites.json"
JOURNAL = "journal-activites.jsonl"
TIRAGES = "activites-tirages.json"
TIRAGES_GARDES = 40  # les périodes gardées ; les quêtes déjà proposées, toutes
# Le rythme d'une activité dans la réserve : son poids au tirage ; « toujours » ne se tire pas, elle est au tableau chaque période.
RYTHMES = {"toujours": 0, "souvent": 3, "parfois": 2, "rarement": 1}
GAINS = ("or", "rumeur", "contact", "objet")  # ce que le MJ annonce, s'il le veut, sur une affiche
OFFRES_DEFAUT = 3
OFFRES_MAX = 8
ACCROCHE_MAX = 160
OBJET_MAX = 300  # une ligne de l'équipement (heros_etat.SAC_LIGNE_MAX)
JOURNAL_OCTETS_MAX = 4 * 1024 * 1024
MODES = ("semaine", "seance")
VERS = ("bourse", "cagnotte")
ACTIVITES_MAX = 60
NOM_MAX = 120
TEXTE_MAX = 1200
RECIT_MAX = 1200
NOTES_MAX = 4000
FORMULE_MAX = 40
COMPETENCES_MAX = 8
COMPETENCE_MAX = 60
PLACES_MAX = 20
APPREND_MAX = 1000
OR_MAX = 100_000  # par activité validée
ID_ACTIVITE = re.compile(r"^[a-z0-9-]{1,40}$")
ID_BATIMENT = re.compile(r"^[a-z0-9-]{1,60}$")
JOURS = ("lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche")
MOIS = ("janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre")
SANS_RECIT = "Votre MJ vous racontera la suite."


# ---------------------------------------------------------------- le catalogue de départ (à valider par le MJ principal)

def issue(formule: str, vers: str, recit: str) -> dict:
    return {"or": formule, "vers": vers, "recit": recit}


CATALOGUE_DE_DEPART = [
    {"id": "travailler-en-ville", "nom": "Travailler en ville", "carac": "physique", "competences": ["Athlétisme", "Artisanat"],
     "modificateur": 0, "places": None, "visible": True, "chantier": "", "notes_mj": "",
     "texte": "Décharger des chariots, porter des pierres sur un chantier, tenir un étal : quelques jours de travail honnête, "
              "payés à la journée. Peu d'or, mais sûr.",
     "issues": {
         "reussite-critique": issue("2D6 + 6", "bourse", "On remarque vite {prenom} : {il|elle} abat le travail de deux, et le "
                                    "contremaître {le|la} paie en conséquence, avec une tournée en prime."),
         "reussite": issue("1D6 + 4", "bourse", "{prenom} enchaîne les journées sans se plaindre. Le dos proteste, la bourse un peu moins."),
         "echec": issue("1D4", "bourse", "Le travail ne manque pas, la paie si. {prenom} rentre fourbu{|e}, avec quelques pièces à peine."),
         "echec-critique": issue("0", "bourse", "Une caisse mal arrimée, une dispute qui tourne mal : {prenom} est renvoyé{|e} avant "
                                 "la fin de la première journée, sans un sou."),
     }},
    {"id": "marchander", "nom": "Marchander au marché", "carac": "social", "competences": ["Négociation", "Baratin", "Étiquette"],
     "modificateur": 0, "places": None, "visible": True, "chantier": "", "notes_mj": "",
     "texte": "Acheter ici, revendre là, servir d'intermédiaire entre un marchand et un client méfiant. Ça peut rapporter, ou coûter.",
     "issues": {
         "reussite-critique": issue("2D6 + 10", "bourse", "{prenom} conclut l'affaire de la saison : les deux parties {le|la} "
                                    "remercient, et l'une d'elles sans savoir pourquoi."),
         "reussite": issue("2D6", "bourse", "Quelques bonnes affaires, aucune mauvaise : {prenom} revient avec un peu plus qu'au départ."),
         "echec": issue("0", "bourse", "Les marchands d'ici connaissent leur métier mieux que {prenom}. Pas de perte, pas de gain."),
         "echec-critique": issue("-1D6", "bourse", "{prenom} achète un lot que personne ne veut reprendre. La leçon coûte quelques pièces."),
     }},
    {"id": "enqueter", "nom": "Enquêter sur une rumeur", "carac": "mental", "competences": ["Perception", "Psychologie", "Érudition"],
     "modificateur": -10, "places": None, "visible": True, "chantier": "", "notes_mj": "",
     "texte": "Une rumeur du carnet vous intrigue ? Votre héros passe ces jours à la remonter : dites à votre MJ laquelle, en "
              "quelques mots. On en revient rarement plus riche, parfois mieux informé.",
     "issues": {
         "reussite-critique": issue("0", "bourse", "{prenom} remonte le fil jusqu'au bout, et trouve plus qu'{il|elle} ne cherchait. "
                                    "Votre MJ vous dira quoi."),
         "reussite": issue("0", "bourse", "Quelques questions au bon endroit, quelques silences qui en disent long : {prenom} en sait "
                           "un peu plus."),
         "echec": issue("0", "bourse", "Des on-dit, des contradictions, un ivrogne qui jure tout savoir : {prenom} n'en tire rien de solide."),
         "echec-critique": issue("0", "bourse", "{prenom} a posé trop de questions, et pas aux bonnes personnes. Quelqu'un, maintenant, "
                                 "s'intéresse à {lui|elle}."),
     }},
    {"id": "petit-contrat", "nom": "Un petit contrat", "carac": "physique", "competences": ["Lames", "Armes de tir", "Pugilat", "Esquive"],
     "modificateur": -10, "places": 2, "visible": True, "chantier": "", "notes_mj": "",
     "texte": "Chasser les rats d'une cave, escorter une charrette jusqu'au village voisin, retrouver une chèvre têtue : il y a "
              "toujours un petit travail pour qui porte une arme. Deux places, pas plus.",
     "issues": {
         "reussite-critique": issue("2D6 × 3", "bourse", "Le travail est fait proprement et vite. Le commanditaire paie, ajoute un "
                                    "petit quelque chose, et retient le nom de {prenom}."),
         "reussite": issue("2D6 + 5", "bourse", "Rien d'héroïque, mais c'est fait. {prenom} touche son dû."),
         "echec": issue("1D6", "bourse", "Le travail est à moitié fait, le commanditaire paie à moitié, en grommelant."),
         "echec-critique": issue("0", "bourse", "Ça tourne mal. {prenom} rentre bredouille et blessé{|e} : votre MJ dira à quel point."),
     }},
    {"id": "veillee", "nom": "Raconter ses exploits à la veillée", "carac": "social", "competences": ["Spectacle", "Charme", "Présence"],
     "modificateur": 0, "places": None, "visible": True, "chantier": "", "notes_mj": "",
     "texte": "Le soir, on aime les histoires d'aventuriers, surtout quand elles font peur. Votre héros raconte les siennes : une "
              "tournée offerte, une réputation qui grandit, ou des rires au mauvais moment.",
     "issues": {
         "reussite-critique": issue("1D6 + 6", "bourse", "La salle se tait, puis réclame la suite. On offre à boire à {prenom}, on "
                                    "{le|la} montre du doigt dans la rue le lendemain : admiré{|e}, un peu craint{|e} aussi."),
         "reussite": issue("1D6", "bourse", "{prenom} tient son public. Quelques pièces tombent dans le chapeau."),
         "echec": issue("0", "bourse", "L'histoire tombe à plat. Personne ne se souviendra de la soirée, et c'est peut-être mieux."),
         "echec-critique": issue("0", "bourse", "{prenom} en dit trop, ou se trompe de public. Le lendemain, on raconte une autre "
                                 "version de l'histoire, moins flatteuse."),
     }},
    {"id": "sanctuaire", "nom": "Prêter main-forte au sanctuaire", "carac": "physique",
     "competences": ["Artisanat", "Athlétisme", "Technologie"], "modificateur": 0, "places": None, "visible": False, "chantier": "",
     "notes_mj": "Cachée au départ : à montrer quand le sanctuaire l'est aux joueurs. L'or va à la cagnotte choisie à la validation.",
     "texte": "Déblayer, scier, monter un mur : votre héros passe ces jours au sanctuaire. Ce qu'il bâtit compte dans la cagnotte "
              "d'un chantier, pas dans sa bourse.",
     "issues": {
         "reussite-critique": issue("15", "cagnotte", "{prenom} travaille du matin au soir, et les autres suivent son exemple. Le "
                                    "chantier avance d'un bon pas."),
         "reussite": issue("10", "cagnotte", "Quelques jours de bon travail : le chantier avance."),
         "echec": issue("4", "cagnotte", "Le bois est humide, les outils manquent : {prenom} fait ce qu'{il|elle} peut, c'est peu."),
         "echec-critique": issue("0", "cagnotte", "Un échafaudage cède. Personne n'est blessé, mais le travail est à refaire."),
     }},
]


def depart() -> dict:
    return catalogue_valide({"ouvert": False, "periode": "semaine", "activites": json.loads(json.dumps(CATALOGUE_DE_DEPART))}) | {"modifie": None}


# ---------------------------------------------------------------- le catalogue, validé

def propre(v, maximum: int, lignes: bool = True) -> str:
    """Un texte du MJ : sans caractère de contrôle, coupé à sa borne (il s'enregistre pendant la frappe)."""
    if not isinstance(v, str):
        return ""
    t = unicodedata.normalize("NFC", v.replace("\r\n", "\n").replace("\r", "\n"))
    t = "".join(c for c in t if (c == "\n" and lignes) or unicodedata.category(c)[0] != "C")
    return t[:maximum]


def entier(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def activite_valide(x: dict, vus: set) -> dict:
    ident = x.get("id") if isinstance(x.get("id"), str) and ID_ACTIVITE.match(x["id"]) and x["id"] not in vus else None
    ident = ident or f"activite-{secrets.token_hex(4)}"
    vus.add(ident)
    comps, deja = [], set()
    for c in x.get("competences") if isinstance(x.get("competences"), list) else []:
        c = " ".join(propre(c, COMPETENCE_MAX, lignes=False).split())
        if c and jets.simple(c) not in deja:
            deja.add(jets.simple(c))
            comps.append(c)
    issues = x.get("issues") if isinstance(x.get("issues"), dict) else {}
    places = x.get("places")
    chantier = x.get("chantier") if isinstance(x.get("chantier"), str) and ID_BATIMENT.match(x["chantier"]) else ""
    return {
        "id": ident, "nom": " ".join(propre(x.get("nom"), NOM_MAX, lignes=False).split()),
        "texte": propre(x.get("texte"), TEXTE_MAX), "carac": x.get("carac") if isinstance(x.get("carac"), str) and x["carac"] in jets.CARACS else "physique",
        "competences": comps[:COMPETENCES_MAX],
        "modificateur": jets.entier(x.get("modificateur"), -jets.MODIFICATEUR_MAX, jets.MODIFICATEUR_MAX),
        "places": places if entier(places) and 1 <= places <= PLACES_MAX else None,
        "visible": x.get("visible") is True, "chantier": chantier, "notes_mj": propre(x.get("notes_mj"), NOTES_MAX),
        # La réserve (19/11) : absents, chaque semaine, pas une quête, sans accroche ni gain annoncé.
        "rythme": x.get("rythme") if x.get("rythme") in RYTHMES else "toujours", "unique": x.get("unique") is True,
        "accroche": " ".join(propre(x.get("accroche"), ACCROCHE_MAX, lignes=False).split()),
        "gains": [g for g in GAINS if g in (x.get("gains") if isinstance(x.get("gains"), list) else [])],
        "issues": {i: {"or": propre((issues.get(i) or {}).get("or") if isinstance(issues.get(i), dict) else "", FORMULE_MAX, lignes=False).strip(),
                       "vers": (issues.get(i) or {}).get("vers") if isinstance(issues.get(i), dict) and issues[i].get("vers") in VERS else "bourse",
                       "recit": propre((issues.get(i) or {}).get("recit") if isinstance(issues.get(i), dict) else "", RECIT_MAX)}
                   for i in jets.ISSUES},
    }


def catalogue_valide(corps: dict) -> dict:
    """Le catalogue envoyé par la page : l'interrupteur, la période, les activités (une formule illisible s'enregistre
    telle quelle, la page la signale ; le dé ne la tire pas)."""
    vus: set = set()
    liste = corps.get("activites") if isinstance(corps.get("activites"), list) else []
    offres = corps.get("offres")
    return {"ouvert": corps.get("ouvert") is True, "periode": corps.get("periode") if corps.get("periode") in MODES else "semaine",
            "offres": offres if entier(offres) and 0 <= offres <= OFFRES_MAX else OFFRES_DEFAUT,
            "annoncer_gains": corps.get("annoncer_gains") is True,
            "activites": [activite_valide(x, vus) for x in liste[:ACTIVITES_MAX] if isinstance(x, dict)]}


# ---------------------------------------------------------------- la période

def jour_fr(d: date) -> str:
    return f"{JOURS[d.weekday()]} {'1er' if d.day == 1 else d.day} {MOIS[d.month - 1]}"


def semaine(jour: date) -> dict:
    lundi = jour - timedelta(days=jour.weekday())
    dimanche = lundi + timedelta(days=6)
    an, numero, _ = jour.isocalendar()
    debut = jour_fr(lundi) if lundi.month != dimanche.month else f"{JOURS[0]} {'1er' if lundi.day == 1 else lundi.day}"
    return {"cle": f"semaine-{an}-{numero:02d}", "libelle": f"Semaine du {debut} au {jour_fr(dimanche)}", "court": "cette semaine"}


def renouvellement(c: dict, jour: date) -> str:
    """Quand le tableau change : « lundi 23 novembre » d'une semaine à l'autre, « à la prochaine séance » sinon."""
    if c.get("periode") == "semaine":
        return jour_fr(jour + timedelta(days=7 - jour.weekday()))
    return "à la prochaine séance"


def date_de(s: dict) -> date | None:
    try:
        return date.fromisoformat(s.get("date")) if isinstance(s.get("date"), str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", s["date"]) else None
    except ValueError:
        return None


def numero_de(s: dict) -> int:
    v = s.get("numero")
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 1 and float(v).is_integer() else 0


def entre_deux_seances(seances: list, jour: date, jeton: Callable[[str, str], str], prochaine: str = "") -> dict:
    """La période depuis la dernière séance jouée (close, ou datée d'avant aujourd'hui) jusqu'à la suivante. Sa clé est un
    jeton : elle ne dit rien de la séance."""
    passees = [s for s in seances or [] if isinstance(s, dict) and isinstance(s.get("id"), str) and s["id"]
               and (s.get("close") is True or ((d := date_de(s)) is not None and d < jour))]
    suite = f", jusqu'à {prochaine}" if prochaine else ""
    if not passees:
        return {"cle": "seance-debut", "libelle": f"Avant la première séance{suite}", "court": "cette période"}
    derniere = max(passees, key=lambda s: ((date_de(s) or date.min).isoformat(), numero_de(s), str(s.get("cree") or "")))
    n = numero_de(derniere)
    return {"cle": f"seance-{jeton('activites-periode', derniere['id'])[:12]}",
            "libelle": (f"Depuis la séance {n}" if n else "Depuis la dernière séance") + suite, "court": "cette période entre deux séances"}


# ---------------------------------------------------------------- le récit type

ACCORD = re.compile(r"\{([^{}|]*)\|([^{}|]*)\}")


def raconter(modele: str, prenom: str, genre) -> str:
    """Le récit type d'une issue pour ce héros : « {prenom} », et « {il|elle} » ou « fourbu{|e} » accordés."""
    t = ACCORD.sub(lambda m: m.group(2) if genre == "f" else m.group(1), modele or "")
    return re.sub(r"\{\s*pr[ée]nom\s*\}", lambda _: prenom, t, flags=re.IGNORECASE).strip()


def prenom_de(nom) -> str:
    mots = re.split(r"[\s,]+", nom.strip()) if isinstance(nom, str) else []
    return mots[0] if mots and mots[0] else "Votre héros"


def po(n: int) -> str:
    return f"{n} po"


# ---------------------------------------------------------------- le journal

class Journal:
    """data/journal-activites.jsonl : un jet par ligne (« jet »), puis la décision du MJ (« decision »). Relu seulement
    quand le fichier change."""

    def __init__(self, fichier: Path):
        self.fichier = fichier
        self.verrou = threading.Lock()
        self.cache = (None, {"jets": {}, "decisions": {}})

    def index(self) -> dict:
        try:
            st = self.fichier.stat()
        except OSError:
            return {"jets": {}, "decisions": {}}
        cle = (st.st_ino, st.st_size, st.st_mtime_ns)
        if self.cache[0] == cle:
            return self.cache[1]
        jets_, decisions = {}, {}
        try:
            with open(self.fichier, encoding="utf-8") as f:
                for ligne in f:
                    try:
                        e = json.loads(ligne)
                    except ValueError:
                        continue
                    if not isinstance(e, dict) or not isinstance(e.get("joueur"), str) or not isinstance(e.get("demande"), str):
                        continue
                    k = (e["joueur"], e["demande"])
                    if e.get("type") == "jet" and isinstance(e.get("jet"), dict) and k not in jets_:
                        jets_[k] = e
                    elif e.get("type") == "decision":
                        decisions[k] = e
        except OSError:
            return {"jets": {}, "decisions": {}}
        self.cache = (cle, {"jets": jets_, "decisions": decisions})
        return self.cache[1]

    def jet(self, joueur: str, demande: str) -> dict | None:
        return self.index()["jets"].get((joueur, demande))

    def decision(self, joueur: str, demande: str) -> dict | None:
        return self.index()["decisions"].get((joueur, demande))

    def de_la_periode(self, cle: str) -> list:
        """Les jets de cette période qui comptent : tous, sauf ceux dont le MJ a rendu le tour."""
        ix = self.index()
        return [e for k, e in ix["jets"].items() if e.get("periode") == cle and not (ix["decisions"].get(k) or {}).get("rendu")]

    def noter(self, entree: dict) -> None:
        with self.verrou:
            self.fichier.parent.mkdir(parents=True, exist_ok=True)
            ligne = json.dumps(entree, ensure_ascii=False, separators=(",", ":")) + "\n"
            try:
                trop = self.fichier.stat().st_size + len(ligne.encode()) > JOURNAL_OCTETS_MAX
            except OSError:
                trop = False
            if trop:
                garde = self.fichier.read_text(encoding="utf-8").splitlines(keepends=True)
                stockage.ecrire_texte(self.fichier, "".join(garde[len(garde) // 2:]) + ligne)
            else:
                with open(self.fichier, "a", encoding="utf-8") as f:
                    f.write(ligne)


# ---------------------------------------------------------------- l'atelier

class ActivitesMJ:
    def __init__(self, donnees: Path, depot: Path, *, jeton: Callable[[str, str], str], seances: Callable[[], list],
                 prochaine: Callable[[], str], heros_du_joueur: Callable[[str], dict | None], lire_heros: Callable[[str], dict | None],
                 sac_de: Callable, changer_sacs: Callable[[dict], dict], verser_don: Callable, lire_sanctuaire: Callable[[], dict],
                 prochain_niveau: Callable[[dict, dict], dict | None], candidats: Callable[[], list], noms_secrets: Callable[[list], str],
                 nettoyer_mot: Callable[[str], str], carnet_ouvert: Callable[[], bool], archiver: Callable[[Path], None],
                 publier_heros: Callable[[set], object], publier_sanctuaire: Callable[[], object], noter_seance: Callable[[list], None],
                 annoncer_sanctuaire: Callable[[], Awaitable[None]], signaler: Callable[[dict], Awaitable[None]],
                 cartons: Callable[[str], dict] = lambda _ident: {}):
        self.fichier = donnees / FICHIER
        self.tirages_fichier = donnees / TIRAGES
        self.depot = depot
        self.journal = Journal(donnees / JOURNAL)
        self.jeton = jeton
        self.seances = seances
        self.prochaine = prochaine
        self.heros_du_joueur = heros_du_joueur
        self.lire_heros = lire_heros
        self.sac_de = sac_de
        self.changer_sacs = changer_sacs
        self.verser_don = verser_don
        self.lire_sanctuaire = lire_sanctuaire
        self.prochain_niveau = prochain_niveau
        self.candidats = candidats
        self.noms_secrets = noms_secrets
        self.nettoyer_mot = nettoyer_mot
        self.carnet_ouvert = carnet_ouvert
        self.archiver = archiver
        self.publier_heros = publier_heros
        self.publier_sanctuaire = publier_sanctuaire
        self.noter_seance = noter_seance
        self.annoncer_sanctuaire = annoncer_sanctuaire
        self.signaler = signaler
        # Les cartons du moment d'un héros (etats-heros.json, comme le Tableau) : ils comptent dans son jet.
        self.cartons = cartons
        self.verrou = threading.RLock()
        self.boite = None
        # demande → ce qu'il reste à faire dans la boucle : les lignes du journal de la séance, les héros touchés, le sanctuaire.
        self.suites: dict[str, dict] = {}

    def brancher(self, boite) -> None:
        self.boite = boite
        boite.brancher(activites.GENRE, accepter=self.accepter_d_un_bloc, preparer=self.preparer, a_preparer=self.a_preparer,
                       apres=self.apres, dire=self.dire)

    @staticmethod
    def accepter_d_un_bloc(_j: dict, _d: dict, _mot: str):
        # Le bouton commun de la boîte n'a ni montant ni destination : une activité se valide depuis son détail.
        raise Refus(400, "Une activité se valide avec son or : ouvrez-la dans la boîte.")

    # ------------------------------------------------------------ le catalogue

    def lire(self) -> dict:
        try:
            c = stockage.lire_json(self.fichier)
        except (OSError, ValueError):
            return depart()
        if not isinstance(c, dict):
            return depart()
        return catalogue_valide(c) | {"modifie": c.get("modifie") if isinstance(c.get("modifie"), str) else None}

    def enregistrer(self, corps: dict) -> dict:
        with self.verrou:
            disque = self.lire()
            if corps.get("version_base") != disque.get("modifie"):
                raise HTTPException(409, "Le catalogue des activités a changé depuis un autre écran.")
            neuf = catalogue_valide(corps) | {"modifie": datetime.now().isoformat(timespec="milliseconds")}
            if self.fichier.exists():
                self.archiver(self.fichier)
            self.fichier.parent.mkdir(parents=True, exist_ok=True)
            stockage.ecrire_json_compact(self.fichier, neuf)
            return neuf

    def par_jeton(self, c: dict, ref: str) -> dict | None:
        return next((a for a in c["activites"] if self.jeton("activites", a["id"]) == ref), None)

    def periode(self, c: dict | None = None, jour: date | None = None) -> dict:
        c = c or self.lire()
        jour = jour or date.today()
        if c["periode"] == "semaine":
            return semaine(jour) | {"mode": "semaine"}
        try:
            prochaine = self.prochaine() or ""
        except Exception:
            prochaine = ""
        return entre_deux_seances(self.seances(), jour, self.jeton, prochaine) | {"mode": "seance"}

    # ------------------------------------------------------------ le tableau de la période

    def lire_tirages(self) -> dict:
        try:
            t = stockage.lire_json(self.tirages_fichier)
        except (OSError, ValueError):
            t = None
        t = t if isinstance(t, dict) else {}
        periodes = t.get("periodes") if isinstance(t.get("periodes"), dict) else {}
        quetes = t.get("quetes") if isinstance(t.get("quetes"), list) else []
        return {"periodes": {k: v for k, v in periodes.items() if isinstance(k, str) and isinstance(v, dict)},
                "quetes": [q for q in quetes if isinstance(q, str)]}

    def ecrire_tirages(self, t: dict) -> None:
        if len(t["periodes"]) > TIRAGES_GARDES:
            gardees = sorted(t["periodes"].items(), key=lambda kv: str(kv[1].get("fait") or ""))[-TIRAGES_GARDES:]
            t["periodes"] = dict(gardees)
        self.tirages_fichier.parent.mkdir(parents=True, exist_ok=True)
        stockage.ecrire_json_compact(self.tirages_fichier, t)

    @staticmethod
    def au_tableau(a: dict) -> bool:
        return bool(a["visible"] and a["nom"])

    @staticmethod
    def piocher(candidats: list, n: int, hasard) -> list:
        """n activités tirées sans remise, chacune au poids de son rythme (souvent 3, parfois 2, rarement 1)."""
        reste, tirees = list(candidats), []
        while reste and len(tirees) < n:
            total = sum(RYTHMES[a["rythme"]] for a in reste)
            v = hasard.randbelow(total)
            for a in reste:
                v -= RYTHMES[a["rythme"]]
                if v < 0:
                    tirees.append(a["id"])
                    reste.remove(a)
                    break
        return tirees

    def tirer(self, c: dict, t: dict, exclues: set, n: int, hasard) -> list:
        """n offres tirées dans la réserve : ni de chaque semaine, ni une quête, ni déjà exclue ; d'abord celles qui
        n'étaient pas au tableau de la période d'avant, puis les autres s'il en manque."""
        candidats = [a for a in c["activites"] if self.au_tableau(a) and not a["unique"] and a["rythme"] != "toujours" and a["id"] not in exclues]
        avant = max(t["periodes"].values(), key=lambda v: str(v.get("fait") or ""), default={}) if t["periodes"] else {}
        deja = set(avant.get("tirees") or [])
        tirees = self.piocher([a for a in candidats if a["id"] not in deja], n, hasard)
        if len(tirees) < n:
            tirees += self.piocher([a for a in candidats if a["id"] in deja], n - len(tirees), hasard)
        return tirees

    def quete_suivante(self, c: dict, t: dict, exclues: set) -> str | None:
        """La première quête unique du catalogue jamais proposée (une quête ne revient pas, même après le ménage des périodes)."""
        return next((a["id"] for a in c["activites"] if a["unique"] and self.au_tableau(a) and a["id"] not in t["quetes"] and a["id"] not in exclues), None)

    def offre(self, c: dict | None = None, p: dict | None = None, hasard=None) -> dict:
        """Le tableau de la période, seule source de ce qui est proposé (la section, le dé, la page du MJ) : le tirage écrit
        au premier besoin de la période, plus les activités de chaque semaine du moment, moins ce qui est caché ou retiré.
        Rend {cle, ids (ordre d'affichage : la quête, chaque semaine, les tirées), genres {id : quete | toujours | tiree},
        tourne (la réserve a de quoi changer le tableau)}."""
        c = c or self.lire()
        p = p or self.periode(c)
        with self.verrou:
            t = self.lire_tirages()
            per = t["periodes"].get(p["cle"])
            if per is None and not c["ouvert"]:
                # Fermées aux joueurs : rien ne s'écrit (une quête ne s'use pas sans avoir été vue) ; le tableau se tire à
                # l'ouverture, les activités de chaque semaine seules en attendant.
                per = {}
            elif per is None:
                toujours = [a["id"] for a in c["activites"] if self.au_tableau(a) and not a["unique"] and a["rythme"] == "toujours"]
                tirees = self.tirer(c, t, set(toujours), c["offres"], hasard or secrets)
                quete = self.quete_suivante(c, t, set())
                if quete:
                    t["quetes"].append(quete)
                per = {"offertes": toujours + tirees + ([quete] if quete else []), "tirees": tirees, "quete": quete,
                       "ajoutees": [], "retirees": [], "fait": datetime.now().isoformat(timespec="seconds")}
                t["periodes"][p["cle"]] = per
                self.ecrire_tirages(t)
        par_id = {a["id"]: a for a in c["activites"]}
        retirees = set(per.get("retirees") or [])
        dans = set(per.get("offertes") or []) | set(per.get("ajoutees") or [])
        dans |= {a["id"] for a in c["activites"] if a["rythme"] == "toujours" and not a["unique"]}
        genres = {}
        for a in c["activites"]:
            if a["id"] in dans and a["id"] not in retirees and self.au_tableau(a):
                genres[a["id"]] = "quete" if a["unique"] else "toujours" if a["rythme"] == "toujours" else "tiree"
        ordre = {"quete": 0, "toujours": 1, "tiree": 2}
        ids = sorted(genres, key=lambda i: (ordre[genres[i]], list(par_id).index(i)))
        tourne = any(a["unique"] or a["rythme"] != "toujours" for a in c["activites"] if self.au_tableau(a))
        return {"cle": p["cle"], "ids": ids, "genres": genres, "tourne": tourne, "quetes": list(t["quetes"])}

    def changer_tableau(self, corps: dict, hasard=None) -> dict:
        """Un geste du MJ sur le tableau de la période : retirer une offre, la changer pour une autre tirée, ou ajouter une
        activité de la réserve. Refusé pour une offre déjà jouée cette période."""
        action, ident = corps.get("action"), corps.get("activite")
        if action not in ("retirer", "changer", "ajouter") or not isinstance(ident, str):
            raise Refus(400, "Retirer, changer ou ajouter une activité du tableau.")
        c = self.lire()
        p = self.periode(c)
        a = next((x for x in c["activites"] if x["id"] == ident), None)
        if not a:
            raise Refus(404, "Cette activité n'est plus dans la réserve.")
        if not c["ouvert"]:
            raise Refus(409, "Ouvrez d'abord les activités aux joueurs : le tableau se tire à leur ouverture.")
        o = self.offre(c, p)
        with self.verrou:
            t = self.lire_tirages()
            per = t["periodes"][p["cle"]]
            for k in ("ajoutees", "retirees", "offertes", "tirees"):
                per[k] = list(per.get(k) or [])
            joue = self.prises(p["cle"]).get(ident, 0) > 0
            if action == "ajouter":
                if not self.au_tableau(a):
                    raise Refus(409, "Montrez d'abord cette activité aux joueurs (et donnez-lui un nom).")
                if ident in o["ids"]:
                    raise Refus(409, "Elle est déjà au tableau.")
                per["retirees"] = [x for x in per["retirees"] if x != ident]
                per["ajoutees"].append(ident)
                if a["unique"] and ident not in t["quetes"]:
                    t["quetes"].append(ident)
            else:
                if ident not in o["ids"]:
                    raise Refus(409, "Elle n'est pas au tableau en ce moment.")
                if joue:
                    raise Refus(409, "Un héros l'a déjà jouée cette période : elle reste au tableau.")
                per["retirees"].append(ident)
                per["ajoutees"] = [x for x in per["ajoutees"] if x != ident]
                if action == "changer":
                    exclues = set(o["ids"]) | set(per["retirees"])
                    if a["unique"]:
                        neuve = self.quete_suivante(c, t, exclues)
                        if neuve:
                            t["quetes"].append(neuve)
                        nouvelles = [neuve] if neuve else []
                    else:
                        nouvelles = self.tirer(c, t, exclues, 1, hasard or secrets)
                    if not nouvelles:
                        raise Refus(409, "Plus rien dans la réserve pour la remplacer : retirez-la, ou écrivez d'autres activités.")
                    per["ajoutees"] += nouvelles
            self.ecrire_tirages(t)
        self.publier_section()
        return self.etat()

    def prises(self, cle: str) -> dict:
        """{id d'activité : places prises} pour cette période."""
        n: dict = {}
        for e in self.journal.de_la_periode(cle):
            n[e.get("activite")] = n.get(e.get("activite"), 0) + 1
        return n

    # ------------------------------------------------------------ ce qu'un joueur ne doit pas lire

    def inconnus(self, heros_id: str, candidats: list | None = None) -> list:
        """Comme sacs.inconnus : les PNJ et lieux inconnus, le peuple caché d'un autre (le sien n'est pas un secret pour lui)."""
        return [(s, f) for s, f in (self.candidats() if candidats is None else candidats)
                if s.get("genre") in ("pnj", "lieu") or (s.get("genre") == "peuple" and heros_id not in s.get("ids", []))]

    def pour_le_joueur(self, texte_: str, inconnus: list, defaut: str = "") -> str:
        vu = masquer(texte_ or "")
        return defaut if not vu or secrets_dans(vu, inconnus) else vu

    # ------------------------------------------------------------ la section du carnet

    def section(self, candidats: list, retenus: list) -> list | None:
        """La section « activites » : None tant que le MJ ne les ouvre pas, ou que le tableau est vide. La période, puis
        chaque activité du tableau : son jeton, son nom, son texte, la caractéristique, les compétences qui aident, le
        modificateur, les places, sa place au tableau (quête, chaque semaine, tirée), l'accroche d'une quête et les gains
        annoncés si le MJ le veut ; jamais l'or, les récits, les notes du MJ, ni rien de la réserve. Au masque, et sans
        inconnu nommé."""
        c = self.lire()
        if not c["ouvert"]:
            return None
        p = self.periode(c)
        o = self.offre(c, p)
        par_id = {a["id"]: a for a in c["activites"]}
        montrees = [par_id[i] for i in o["ids"]]
        if not montrees:
            return None
        prises = self.prises(p["cle"])
        # Le tableau (19/11) : quand il change, seulement si la réserve a de quoi le changer.
        elements = [{"genre": "periode", "cle": p["cle"], "libelle": p["libelle"], "libelle_court": p["court"], "mode": p["mode"],
                     "renouvellement": renouvellement(c, date.today()) if o["tourne"] else ""}]
        for a in montrees:
            quoi = f"L'activité « {a['nom']} »"
            element = masquer_tout({"genre": "activite", "nom": a["nom"], "texte": a["texte"], "carac": a["carac"],
                                    "carac_nom": jets.CARACS[a["carac"]], "competences": a["competences"],
                                    "modificateur": a["modificateur"], "places": a["places"],
                                    "restantes": max(0, a["places"] - prises.get(a["id"], 0)) if a["places"] else None,
                                    "offre": o["genres"][a["id"]], "accroche": a["accroche"] if o["genres"][a["id"]] == "quete" else "",
                                    "gains": a["gains"] if c["annoncer_gains"] else []})
            if trouves := secrets_dans(element["nom"], candidats):
                retenus.append(f"{quoi} : absente du carnet, elle nomme {self.noms_secrets(trouves)}.")
                continue
            if element["texte"] and (trouves := secrets_dans(element["texte"], candidats)):
                retenus.append(f"{quoi} : son texte est retenu, il nomme {self.noms_secrets(trouves)}.")
                element["texte"] = ""
            if element["accroche"] and (trouves := secrets_dans(element["accroche"], candidats)):
                retenus.append(f"{quoi} : son accroche est retenue, elle nomme {self.noms_secrets(trouves)}.")
                element["accroche"] = ""
            element["competences"] = [x for x in element["competences"] if not secrets_dans(x, candidats)]
            element["id"] = self.jeton("activites", a["id"])
            elements.append(element)
        return elements

    def publier_section(self) -> int:
        """Après un jet ou une décision : la section tout de suite (les places restantes) ; le reste du carnet suit au
        passage suivant de la tâche de fond."""
        with carnet.PUBLICATION:
            if not (self.carnet_ouvert() and carnet.est_ouvert(self.depot)):
                return 0
            chemin = self.depot / carnet.CARNET / f"{activites.SECTION}.json"
            elements = self.section(self.candidats(), [])
            if elements is None:
                existait = chemin.exists()
                chemin.unlink(missing_ok=True)
                return int(existait)
            return int(carnet.ecrire_si_change(chemin, elements))

    # ------------------------------------------------------------ le dé (sous le verrou de la file)

    def public_du_jet(self, e: dict) -> dict:
        j = e["jet"]
        return {"periode": e.get("periode"), "periode_libelle": e.get("periode_libelle", ""), "activite": e.get("activite_vue", ""),
                "jet": {k: j.get(k) for k in ("de", "visee", "issue", "issue_nom", "carac_nom", "base", "competence", "bonus", "modificateur")}
                | {"ajustements": j.get("ajustements") or []},
                "recit": e.get("recit", "")}

    @staticmethod
    def phrase_du_jet(e: dict) -> str:
        j = e["jet"]
        return f"{j['carac_nom']} {j['visee']} % : le dé donne {j['de']:02d}, {j['issue_nom'].lower()}. L'or attend votre MJ."

    def a_preparer(self, j: dict, d: dict) -> bool:
        if d.get("genre") != activites.GENRE:
            return False
        e = self.journal.jet(j["id"], d["id"])
        return e is None or not d.get("fige") or activites.public(d) != self.public_du_jet(e)

    def preparer(self, j: dict, d: dict) -> None:
        e = self.journal.jet(j["id"], d["id"]) or self.jeter(j, d)
        d["public"] = self.public_du_jet(e)
        d["fige"] = True
        d["resultat"] = self.phrase_du_jet(e)[:demandes.RESULTAT_MAX]

    def jeter(self, j: dict, d: dict, hasard=None) -> dict:
        """Le jet d'une demande, sur la fiche de l'atelier, noté au journal ; Refus si l'activité ne se joue pas (la phrase
        va au joueur). Rien n'est écrit avant que tout soit vérifié."""
        if not self.carnet_ouvert():
            raise Refus(423, "Le carnet est fermé : votre MJ le rouvre entre les séances.")
        c = self.lire()
        if not c["ouvert"]:
            raise Refus(409, activites.FERME)
        a = self.par_jeton(c, d["corps"]["activite"])
        p = self.periode(c)
        if not a or not a["visible"] or a["id"] not in self.offre(c, p)["ids"]:
            raise Refus(409, "Cette activité n'est plus au tableau : choisissez-en une autre.")
        h = self.heros_du_joueur(j["id"])
        if not h:
            raise Refus(409, "Votre héros n'est pas à la tablée en ce moment : votre MJ s'en occupera.")
        faits = self.journal.de_la_periode(p["cle"])
        prenom = prenom_de(masquer(h.get("nom") or ""))
        if any(e.get("heros") == h["id"] and e.get("activite") == a["id"] for e in faits):
            raise Refus(409, f"{prenom} a déjà fait « {masquer(a['nom'])} » pour {p['court']} : choisissez-en une autre.")
        if a["places"] and sum(1 for e in faits if e.get("activite") == a["id"]) >= a["places"]:
            raise Refus(409, f"Plus de place pour « {masquer(a['nom'])} » : choisissez-en une autre.")
        cartons = self.cartons(h["id"])
        r = jets.jet(h, a["carac"], a["competences"], a["modificateur"],
                     jets_distance.ajustements({"cartons": cartons if isinstance(cartons, dict) else {}}, a["carac"]), hasard=hasard)
        cfg = a["issues"][r["issue"]]
        tire = jets.tirer(cfg["or"], hasard) if cfg["or"] else None
        candidats = self.candidats()
        inconnus = self.inconnus(h["id"], candidats)
        recit_brut = raconter(cfg["recit"], prenom, h.get("genre"))
        recit = self.pour_le_joueur(recit_brut, inconnus)
        retenu = ""
        if recit_brut and not recit:
            retenu = f"Le récit type nomme {self.noms_secrets(secrets_dans(masquer(recit_brut), inconnus))} : le joueur lit « {SANS_RECIT} »."
        competence = self.pour_le_joueur(r["competence"], inconnus, "une compétence") if r["competence"] else ""
        e = {"type": "jet", "quand": datetime.now().isoformat(timespec="seconds"), "joueur": j["id"], "demande": d["id"],
             "heros": h["id"], "heros_nom": str(h.get("nom") or ""), "genre": h.get("genre") if h.get("genre") in ("h", "f") else "",
             "periode": p["cle"], "periode_libelle": p["libelle"], "activite": a["id"], "activite_nom": a["nom"],
             "activite_vue": self.pour_le_joueur(a["nom"], inconnus, "Une activité"),
             "jet": {**{k: r[k] for k in ("carac", "carac_nom", "base", "bonus", "modificateur", "ajustements", "visee", "de", "issue", "issue_nom")},
                     "competence": competence, "competence_mj": r["competence"]},
             "proposition": {"formule": cfg["or"], "lisible": tire is not None or not cfg["or"], "montant": tire["total"] if tire else 0,
                             "des": tire["des"] if tire else [], "vers": cfg["vers"], "chantier": a["chantier"]},
             "recit": recit or SANS_RECIT, "recit_retenu": retenu, "mot": d["corps"].get("mot", "")}
        self.journal.noter(e)
        self.suites[d["id"]] = {"lignes": [], "heros": set(), "sanctuaire": False, "section": True}
        return e

    # ------------------------------------------------------------ la boîte du MJ

    def dire(self, j: dict, d: dict) -> str:
        """« Camille : Travailler en ville pour Aldo, réussite (34 pour 70) ; 8 po proposées pour sa bourse »."""
        qui = j.get("nom") or "Le joueur"
        e = self.journal.jet(j.get("id", ""), d.get("id", ""))
        if not e:
            if d.get("statut") == demandes.ECHEC:
                return f"{qui} voulait une activité : {d.get('resultat') or 'pas possible'}"
            c = self.lire()
            a = self.par_jeton(c, (d.get("corps") or {}).get("activite", ""))
            return f"{qui} choisit : {a['nom'] if a else 'une activité retirée du catalogue'} (le dé roule)"
        jet = e["jet"]
        pour = prenom_de(e.get("heros_nom"))
        tete = f"{qui} : {e.get('activite_nom')} pour {pour}, {jet['issue_nom'].lower()} ({jet['de']:02d} pour {jet['visee']})"
        dec = self.journal.decision(j.get("id", ""), d.get("id", ""))
        if d.get("statut") == demandes.EN_ATTENTE:
            prop = e["proposition"]
            if not prop["lisible"]:
                return f"{tete} ; formule d'or illisible ({prop['formule']}), à fixer"
            if not prop["montant"]:
                return f"{tete} ; pas d'or proposé"
            vers = "sa bourse" if prop["vers"] == "bourse" else "une cagnotte du sanctuaire"
            return f"{tete} ; {po(prop['montant'])} proposées pour {vers}"
        if dec and dec.get("decision") == "acceptee":
            m = dec.get("montant") or 0
            if not m:
                return f"{tete} ; validée sans or"
            return f"{tete} ; {po(m)} {'pour sa bourse' if dec.get('vers') == 'bourse' else 'pour ' + (dec.get('chantier_nom') or 'le sanctuaire')}"
        if dec and dec.get("decision") == "refusee":
            return f"{tete} ; refusée{', tour rendu' if dec.get('rendu') else ''}"
        return tete

    def destinations(self, heros: dict | None) -> list:
        """Où l'or peut aller : la bourse du héros, puis chaque chantier qui a un niveau à payer (caché compris : c'est
        l'atelier)."""
        liste = []
        if heros:
            liste.append({"cle": "bourse", "nom": f"La bourse de {prenom_de(heros.get('nom'))}", "detail": po(self.sac_de(heros, 'or') or 0)})
        try:
            s = self.lire_sanctuaire()
        except Exception:
            s = {}
        for b in s.get("batiments", []) if isinstance(s, dict) else []:
            if not isinstance(b, dict) or not isinstance(b.get("id"), str):
                continue
            n = self.prochain_niveau(s, b)
            if not n:
                continue
            reste = max(0, n.get("cout", 0) - b.get("cagnotte", 0))
            liste.append({"cle": f"batiment:{b['id']}", "nom": str(b.get("nom") or "Un chantier"), "reste": reste, "cache": bool(b.get("cache")),
                          "detail": f"niveau {n.get('rang')} ({n.get('nom', '')}) : il manque {po(reste)}"})
        return liste

    def demande(self, joueur: str, ident: str) -> tuple[dict, list, dict]:
        j = self.boite.joueur(joueur)
        liste = demandes.lire(self.depot, joueur)
        d = demandes.trouver(liste, ident)
        if d is None or d.get("genre") != activites.GENRE:
            raise Refus(404, "Cette activité n'existe plus.")
        return j, liste, d

    def destination_proposee(self, heros: dict | None, prop: dict) -> str:
        """Où va l'or d'une activité : la bourse, ou le chantier du catalogue (à défaut, le premier qui a un niveau à payer)."""
        cle = prop.get("vers") if prop.get("vers") == "bourse" else ""
        if prop.get("vers") == "cagnotte":
            dests = self.destinations(heros)
            voulu = next((x for x in dests if x["cle"] == f"batiment:{prop.get('chantier')}"), None)
            voulu = voulu or next((x for x in dests if x["cle"].startswith("batiment:") and x.get("reste") and not x.get("cache")), None)
            cle = voulu["cle"] if voulu else "bourse"
        return cle

    def detail(self, joueur: str, ident: str) -> dict:
        """Ce que le MJ lit avant de trancher : le jet (et de quoi la valeur visée est faite), le récit lu par le joueur, l'or
        proposé par le catalogue, les destinations possibles."""
        j, _, d = self.demande(joueur, ident)
        e = self.journal.jet(joueur, ident)
        heros = self.lire_heros(e["heros"]) if e else self.heros_du_joueur(joueur)
        prop = (e or {}).get("proposition") or {}
        cle = self.destination_proposee(heros, prop)
        c = self.lire()
        a = self.par_jeton(c, (d.get("corps") or {}).get("activite", ""))
        return {"id": d["id"], "version": d["version"], "statut": d["statut"], "statut_dit": demandes.statut_dit(d), "cree": d.get("cree"),
                "traitee": d.get("traitee"), "mot": d.get("mot") or "", "mot_joueur": (d.get("corps") or {}).get("mot", ""),
                "resultat": d.get("resultat") or "", "joueur": {"id": j["id"], "nom": j.get("nom", "")},
                "heros": {"id": heros["id"], "nom": str(heros.get("nom") or ""), "genre": heros.get("genre") if heros.get("genre") in ("h", "f") else "",
                          "or": self.sac_de(heros, "or") or 0} if heros else None,
                "pret": e is not None, "jet": (e or {}).get("jet"), "periode": {"cle": (e or {}).get("periode"), "libelle": (e or {}).get("periode_libelle", "")},
                "activite": {"nom": (e or {}).get("activite_nom") or (a or {}).get("nom", ""), "id": (e or {}).get("activite") or (a or {}).get("id", ""),
                             "competences": (a or {}).get("competences", []), "notes_mj": (a or {}).get("notes_mj", "")},
                "recit": (e or {}).get("recit", ""), "recit_retenu": (e or {}).get("recit_retenu", ""),
                "proposition": prop | {"destination": cle}, "destinations": self.destinations(heros),
                "decision": self.journal.decision(joueur, ident), "public": activites.public(d),
                "mot_max": demandes.MOT_MAX, "apprend_max": APPREND_MAX}

    def nettoyer_apprend(self, texte_, heros_id: str) -> str:
        """« Ce que le héros apprend » part vers le joueur : au masque, puis refusé s'il nomme un inconnu des joueurs (le MJ
        le retouche, ou rend d'abord connu ce qu'il nomme)."""
        if texte_ is None or texte_ == "":
            return ""
        t = masquer(demandes.texte_propre(texte_, APPREND_MAX, "Ce que le héros apprend"))
        if t and (trouves := secrets_dans(t, self.inconnus(heros_id))):
            raise Refus(409, f"« Ce que le héros apprend » nomme {self.noms_secrets(trouves)} : retouchez-le, ou rendez-le connu des joueurs d'abord.")
        return t

    def nettoyer_objet(self, texte_, heros_id: str) -> str:
        """L'objet glissé dans le sac (une ligne de l'équipement) : au masque, refusé s'il nomme un inconnu des joueurs."""
        if texte_ is None or texte_ == "":
            return ""
        t = " ".join(masquer(demandes.texte_propre(texte_, OBJET_MAX, "L'objet")).split())
        if t and (trouves := secrets_dans(t, self.inconnus(heros_id))):
            raise Refus(409, f"L'objet nomme {self.noms_secrets(trouves)} : retouchez-le, ou rendez-le connu des joueurs d'abord.")
        return t

    def trancher(self, joueur: str, ident: str, corps: dict) -> dict:
        """{decision : valider | refuser, version, montant, vers (bourse | batiment:<id>), apprend, objet, mot, rendre} :
        l'or et l'objet bougent, la demande passe, d'un seul geste sous le verrou de la file. Rend l'élément de la boîte."""
        decision = corps.get("decision")
        if decision not in ("valider", "refuser"):
            raise Refus(400, "Valider ou refuser ?")
        version = corps.get("version")
        if isinstance(version, bool) or not isinstance(version, int):
            raise Refus(400, "La version de la demande manque : relisez la boîte.")
        mot = corps.get("mot") or ""
        if not isinstance(mot, str):
            raise Refus(400, "Le mot doit être un texte.")
        mot = self.nettoyer_mot(mot) if mot.strip() else ""
        statut = demandes.ACCEPTEE if decision == "valider" else demandes.REFUSEE
        with demandes.verrou(self.depot):
            j, liste, d = self.demande(joueur, ident)
            demandes.verifier(d, statut, "mj", version=version)
            e = self.journal.jet(joueur, ident)
            if not e:
                raise Refus(409, "Le dé roule encore : la boîte se relit.")
            if self.journal.decision(joueur, ident):
                raise Refus(409, "Cette activité a déjà été tranchée : la boîte se relit.")
            prenom = prenom_de(masquer(e.get("heros_nom") or ""))
            suite = {"lignes": [], "heros": set(), "sanctuaire": False, "section": False}
            public = self.public_du_jet(e)
            noter = {"type": "decision", "quand": datetime.now().isoformat(timespec="seconds"), "joueur": joueur, "demande": ident,
                     "heros": e["heros"]}
            if decision == "refuser":
                rendre = corps.get("rendre") is True
                public |= {"or": None, "apprend": "", "rendu": rendre}
                resultat = "Votre MJ n'a pas retenu cette activité." + (" Il vous rend votre tour : choisissez-en une autre." if rendre else "")
                noter |= {"decision": "refusee", "rendu": rendre, "montant": 0}
                suite["section"] = rendre
            else:
                montant = corps.get("montant", 0)
                if isinstance(montant, bool) or not isinstance(montant, int) or not -OR_MAX <= montant <= OR_MAX:
                    raise Refus(400, f"Le montant est un nombre entier de pièces d'or, de -{OR_MAX} à {OR_MAX}.")
                apprend = self.nettoyer_apprend(corps.get("apprend"), e["heros"])
                objet = self.nettoyer_objet(corps.get("objet"), e["heros"])
                vers = corps.get("vers") or "bourse"
                ou = None
                if montant or objet:
                    ou = self.donner(e, montant, vers, prenom, suite, objet)
                public |= {"or": ou, "apprend": apprend, "objet": objet, "rendu": False}
                if not ou:
                    resultat = "Validée par votre MJ, sans or cette fois."
                elif ou["vers"] == "bourse":
                    resultat = (f"{po(ou['montant'])} dans la bourse de {prenom}." if ou["montant"] > 0
                                else f"{po(-ou['montant'])} perdues : la bourse de {prenom} s'allège.")
                else:
                    resultat = f"{po(ou['montant'])} pour {ou['chantier']}, au sanctuaire."
                if objet:
                    phrase = f" « {objet} » rejoint son sac."
                    resultat += phrase if len(resultat) + len(phrase) <= demandes.RESULTAT_MAX else " Un objet rejoint son sac."
                noter |= {"decision": "acceptee", "montant": ou["montant"] if ou else 0, "vers": ou["vers"] if ou else "",
                          "chantier": vers[9:] if ou and ou["vers"] == "cagnotte" else "", "chantier_nom": ou["chantier"] if ou else "",
                          "apprend": apprend, "objet": objet}
                ligne = f"{prenom}, entre les séances : {e.get('activite_nom')}, {e['jet']['issue_nom'].lower()}"
                suite["lignes"].append(ligne + (f", {resultat[:1].lower()}{resultat[1:]}" if ou or objet else "."))
            # « Mon héros » et le sanctuaire d'abord : quand le joueur lit « validée », sa bourse et la cagnotte le sont.
            self.republier(suite)
            d["public"] = public
            demandes.passer(d, statut, "mj", version=version, mot=mot, resultat=resultat)
            self.journal.noter(noter)
            demandes.ecrire(self.depot, joueur, liste)
        self.suites[ident] = suite
        return self.boite.element_demande(j, d)

    def objet_au_sac(self, heros: dict, objet: str) -> dict:
        """Le changement d'équipement qui ajoute l'objet (route du sac : avant, après)."""
        avant = self.sac_de(heros, "equipement")
        if len(avant) >= 80:
            raise Refus(409, "Le sac de ce héros est plein : retirez d'abord une ligne de son équipement.")
        return {"equipement": {"avant": avant, "apres": avant + [objet]}}

    def donner(self, e: dict, montant: int, vers: str, prenom: str, suite: dict, objet: str = "") -> dict | None:
        """L'or validé : dans la bourse du héros par la route du sac (une perte ne la fait pas passer sous zéro), ou dans la
        cagnotte d'un chantier par verser_don (aucune bourse débitée, jamais plus que ce qui manque au niveau). L'objet
        rejoint l'équipement dans la même écriture que la bourse ; avec une cagnotte, avant elle, et il est rendu si le
        chantier refuse. Rend l'or donné, ou None s'il n'y en a pas."""
        heros = self.lire_heros(e["heros"])
        if not heros:
            raise Refus(409, "Ce héros n'est plus dans l'atelier : refusez cette activité, ou mettez le montant à zéro.")
        sac = self.objet_au_sac(heros, objet) if objet else {}
        if not montant or vers != "bourse":
            if sac:
                try:
                    self.changer_sacs({heros["id"]: sac})
                except HTTPException as err:
                    raise Refus(409, f"L'objet n'a pas pu rejoindre le sac : {err.detail}")
                suite["heros"].add(heros["id"])
            if not montant:
                return None
            try:
                return self.verser(heros, montant, vers, suite)
            except Refus:
                if sac:
                    try:
                        self.changer_sacs({heros["id"]: {"equipement": {"avant": sac["equipement"]["apres"], "apres": sac["equipement"]["avant"]}}})
                    except HTTPException:
                        journal.exception("Objet d'une activité resté dans le sac après un refus du chantier")
                raise
        if vers == "bourse":
            bourse = self.sac_de(heros, "or") or 0
            if bourse + montant < 0:
                raise Refus(409, f"La bourse de {prenom} n'a que {po(bourse)} : la perte ne peut pas dépasser {bourse}.")
            try:
                self.changer_sacs({heros["id"]: {"or": {"avant": self.sac_de(heros, "or"), "apres": bourse + montant}} | sac})
            except HTTPException as err:
                raise Refus(409, f"La bourse n'a pas pu changer : {err.detail}")
            suite["heros"].add(heros["id"])
            return {"montant": montant, "vers": "bourse", "chantier": ""}
        return self.verser(heros, montant, vers, suite)

    def verser(self, heros: dict, montant: int, vers: str, suite: dict) -> dict:
        """L'or vers la cagnotte d'un chantier (vers = batiment:<id>)."""
        if vers == "bourse":
            raise Refus(400, "La bourse se donne avec la route du sac.")
        if not vers.startswith("batiment:") or not ID_BATIMENT.match(vers[9:]):
            raise Refus(400, "Destination inconnue : la bourse du héros, ou un chantier du sanctuaire.")
        if montant < 0:
            raise Refus(400, "Une cagnotte ne perd pas d'or : une perte va à la bourse du héros.")
        try:
            r = self.verser_don(vers[9:], heros["id"], montant, str(heros.get("nom") or ""))
        except HTTPException as err:
            if err.status_code == 404:
                raise Refus(409, "Ce chantier n'est plus au sanctuaire : choisissez une autre destination.")
            raise Refus(409, f"{err.detail} Changez le montant ou la destination.")
        b = next((x for x in r["sanctuaire"].get("batiments", []) if x.get("id") == vers[9:]), {})
        suite["lignes"] += r.get("lignes", [])
        suite["sanctuaire"] = True
        suite["heros"].add(heros["id"])
        nom = self.pour_le_joueur(str(b.get("nom") or ""), self.inconnus(heros["id"]), "un chantier")
        nom = nom if b.get("cache") is not True else "un chantier"
        return {"montant": r["pris"], "vers": "cagnotte", "chantier": re.sub(r"^(Le|La|Les|L['’]|Un|Une|Des)\b", lambda m: m.group(1).lower(), nom, count=1)}

    def republier(self, suite: dict) -> None:
        """Une publication manquée se rattrape au passage suivant de la tâche du carnet."""
        try:
            if suite["heros"]:
                self.publier_heros(set(suite["heros"]))
            if suite["sanctuaire"]:
                self.publier_sanctuaire()
            self.publier_section()
        except Exception:
            journal.exception("Carnet non republié après une activité")

    async def apres(self, liste: list) -> None:
        """Après un jet (une vague de la boîte) ou une décision du MJ, dans la boucle : la section (places restantes), le
        journal de la séance, la TV qui montre le sanctuaire, les pages de l'atelier."""
        lignes, heros, sanct, section = [], set(), False, False
        for _, d in liste:
            s = self.suites.pop(d.get("id"), None)
            if s:
                lignes += s["lignes"]
                heros |= s["heros"]
                sanct = sanct or s["sanctuaire"]
                section = section or s["section"]
        if section:
            try:
                await asyncio.to_thread(self.publier_section)
            except Exception:
                journal.exception("Section des activités non republiée")
        if lignes:
            try:
                self.noter_seance(lignes)
            except Exception:
                journal.exception("Activité non notée au journal de la séance")
        if sanct:
            await self.annoncer_sanctuaire()
        if heros or sanct:
            await self.signaler({"type": "sac", "heros": sorted(heros), "sanctuaire": sanct})

    # ------------------------------------------------------------ l'état de la période, pour la page du catalogue

    def etat(self) -> dict:
        c = self.lire()
        p = self.periode(c)
        ix = self.journal.index()
        jouees = []
        for k, e in ix["jets"].items():
            if e.get("periode") != p["cle"]:
                continue
            dec = ix["decisions"].get(k) or {}
            jouees.append({"heros": e.get("heros_nom", ""), "activite": e.get("activite_nom", ""), "activite_id": e.get("activite", ""),
                           "issue": e["jet"].get("issue_nom", ""), "de": e["jet"].get("de"), "visee": e["jet"].get("visee"),
                           "montant": dec.get("montant") or 0, "vers": dec.get("vers", ""), "chantier": dec.get("chantier_nom", ""),
                           "decision": dec.get("decision", ""), "rendu": bool(dec.get("rendu")), "quand": e.get("quand", "")})
        jouees.sort(key=lambda x: x["quand"])
        try:
            s = self.lire_sanctuaire()
        except Exception:
            s = {}
        o = self.offre(c, p)
        return {"periode": p, "jouees": jouees, "prises": self.prises(p["cle"]), "carnet_ouvert": self.carnet_ouvert(),
                "tableau": {"ids": o["ids"], "genres": o["genres"], "tourne": o["tourne"], "quetes_proposees": o["quetes"],
                            "renouvellement": renouvellement(c, date.today())},
                "batiments": [{"id": b["id"], "nom": str(b.get("nom") or ""), "cache": bool(b.get("cache"))}
                              for b in (s.get("batiments", []) if isinstance(s, dict) else []) if isinstance(b, dict) and isinstance(b.get("id"), str)],
                "formules": {a["id"]: {i: (a["issues"][i]["or"] == "" or jets.formule(a["issues"][i]["or"]) is not None) for i in jets.ISSUES}
                             for a in c["activites"]},
                "issues": [[i, jets.NOMS_ISSUES[i]] for i in jets.ISSUES], "caracs": [[k, v] for k, v in jets.CARACS.items()]}

    # ------------------------------------------------------------ les routes

    def routes(self, corps_objet) -> APIRouter:
        """Hors de /api/table/… : la garde de main.py les ferme à la table publique, et à Internet sans session."""
        r = APIRouter()

        @r.get("/api/activites")
        def lire_catalogue():
            return self.lire()

        @r.put("/api/activites")
        async def enregistrer_catalogue(requete: Request):
            corps = await corps_objet(requete)
            c = await asyncio.to_thread(self.enregistrer, corps)
            await asyncio.to_thread(self.publier_section)
            return c

        @r.get("/api/activites/etat")
        def etat_des_activites():
            return self.etat()

        @r.post("/api/activites/tableau")
        async def changer_le_tableau(requete: Request):
            corps = await corps_objet(requete)
            try:
                return await asyncio.to_thread(self.changer_tableau, corps)
            except Refus as refus:
                raise HTTPException(refus.statut, refus.message)

        @r.get("/api/activites/demandes/{joueur}/{ident}")
        async def detail_activite(joueur: str, ident: str):
            try:
                return await asyncio.to_thread(self.detail, joueur, ident)
            except Refus as refus:
                raise HTTPException(refus.statut, refus.message)

        @r.post("/api/activites/demandes/{joueur}/{ident}/trancher")
        async def trancher_activite(joueur: str, ident: str, requete: Request):
            corps = await corps_objet(requete)
            try:
                element = await asyncio.to_thread(self.trancher, joueur, ident, corps)
            except Refus as refus:
                raise HTTPException(refus.statut, refus.message)
            await self.apres([({"id": joueur}, element)])
            await self.boite.annoncer()
            return element

        return r
