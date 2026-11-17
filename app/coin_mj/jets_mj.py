"""Les jets à distance dans l'atelier (lot F3, jets_distance.py, jets.py) : le dé jeté pour le test qu'un joueur lance de
son téléphone, le bandeau de la TV, les derniers jets et les tests demandés dans le Tableau et sur la télécommande.

- Le dé se jette quand la boîte voit la demande « jet » (boite.appliquer, sous le verrou de la file), sur la fiche de
  l'atelier : la caractéristique, le bonus de la compétence choisie si le héros l'a vraiment, le modificateur, puis les
  ajustements comptés (jets_distance.ajustements : le carton du héros, jamais la posture focus). En posture offensive
  (celle du combat en cours, sinon celle de la fiche), les critiques s'élargissent : 01 à 10 et 91 à 100. Rien de ce
  qu'envoie le coin n'y entre que ces trois choix ; pour un test demandé, la caractéristique et le modificateur viennent
  du registre de l'atelier (data/jets.json). Un jet arrivé trop tard (l'atelier arrêté), table fermée ou héros absent :
  la demande échoue avec sa phrase.
- Ce que lit le joueur s'écrit dans la demande (« public ») : au masque, sans compétence qui nommerait un inconnu pour lui.
- La TV reçoit un message à part de son canal (« jet »), comme le pointeur : rien ne s'écrit dans l'état de la table, une
  TV qui se rallume ne rejoue pas un vieux jet. Il ne porte que le prénom public du héros, sa couleur, la caractéristique,
  la compétence (sauf si elle nomme un secret des joueurs, le peuple caché du héros compris), le dé et l'issue. Ni la valeur
  visée, ni le modificateur du MJ : la table voit le dé et l'issue, le détail reste au joueur et au MJ. La table publique
  le reçoit seulement si elle est ouverte.
- Les pages de l'atelier reçoivent la vue des jets (message « jets » de /ws/atelier) à chaque jet, chaque test demandé ou
  retiré, et quand la table du coin ou la pause changent.
- La fiche de jet de chaque héros à la tablée (propositions/jets/<clé>.json) se publie table du coin ouverte, et s'en va
  quand elle se ferme : le coin y lit de quoi proposer le choix et dire les chances. Republiée dès que ses sources changent
  (fiches, état des héros, combats, joueurs, réglage de la table, secrets).

Lot G, les dés :
- des dés libres ou les dégâts d'une arme (genre « des ») : l'expression vient du coin, relue par des.lire ; pour une arme,
  le nom et les dégâts doivent être ceux de la fiche de l'atelier (le coin n'en a que la copie publiée). Les dés roulent ici ;
  le bandeau de la TV (message « des ») porte le prénom, la couleur, l'expression, les faces et le total, et le nom de l'arme
  s'il ne nomme aucun secret ;
- la réserve des dés d'aventure (reserve.py, data/des-aventure.json) : le dé d'aventure qu'un joueur ajoute à son test passe
  au MJ quand le dé roule ici (s'il en reste au groupe, sinon le test part sans et le joueur le lit) ; le MJ l'annule depuis
  le Tableau (le dé revient au groupe) ; le dé de mésaventure annoncé pour le prochain test d'un joueur roule avec lui et
  revient au groupe. Un désavantage laisse le MJ choisir la face (hors combat). La face et son effet sont annoncés, le
  résultat du test ne change jamais seul (In extremis : le MJ tranche, choix du 09/11).
- l'avantage du joueur, en combat comme hors combat, le jeton retiré là où il vit (le combat, sinon l'état du héros :
  la fonction depenser_jeton que l'atelier passe) : +10 % à un test (« avantage » dans le test), ou la face d'un dé d'aventure
  ou de mésaventure changée après le lancer, pour le dernier test du joueur (appliquer_face, genre « jet-face »). Jamais
  avant le lancer.

Les dés du MJ (lot du 12/11, POST /api/jets/mj) : des dés libres ou un D100 contre une valeur, lancés depuis l'atelier
(Tableau, combat compact). Le résultat revient au MJ dans tous les cas ; avec « tv », le bandeau part à la table aux formes
des jets des joueurs (« des », « jet »), sous le nom « Le MJ » ou celui qu'il donne s'il ne nomme aucun secret des joueurs.
La valeur visée ne sort jamais ; rien ne s'écrit dans le registre des jets des joueurs.

Verrous : le registre (data/jets.json) et la réserve (data/des-aventure.json) ne s'écrivent que sous le verrou de la file des
demandes (fcntl), pris par la boîte quand elle applique, et ici pour chaque geste du MJ : un dé joué, annulé, imposé ou réglé
à la main passent l'un après l'autre. Un seul verrou, jamais deux : rien ne s'attend dessous.

Ce module ne connaît de l'atelier que les fonctions que main.py lui passe.
"""
import asyncio
import hashlib
import json
import logging
import re
import secrets
import shutil
from datetime import datetime
from pathlib import Path
from typing import Awaitable, Callable

from fastapi import APIRouter, HTTPException, Request

from commun import carnet
from commun import demandes
from commun import des
from commun import jets
from commun import jets_distance as jd
from coin_mj import liens_joueurs
from contenu import reserve as rsv
from commun import veille
from commun.demandes import Refus
from table.masque import masquer, secrets_dans
from commun import stockage

journal = logging.getLogger("atelier.jets")

FICHIER = "jets.json"
JETS_GARDES = 60  # dans le registre
DEMANDES_GARDEES = 40
JETS_VUS = 12  # dans le Tableau et sur la télécommande
SOURCES_PERIODE = 1.0  # secondes entre deux regards sur les sources de la fiche de jet
FAITS_MAX = 50
COULEUR = re.compile(r"^#[0-9a-fA-F]{3,8}$")
ABSENT_MJ = "{nom} n'a pas de héros à la tablée."
FERMEE_MJ = "La table du coin est fermée : ouvrez-la (onglet Table) pour que les joueurs lancent."
PAUSE_MJ = "Le coin est en pause : rouvrez-le (onglet Table) pour que {nom} puisse lancer."
FACE_MJ = "Vous ne choisissez la face que pour un héros qui porte un désavantage, hors combat."
NOM_MJ = "Le MJ"
NOM_MJ_MAX = 60
LIBELLE_MJ_MAX = 40


def maintenant() -> str:
    return datetime.now().isoformat(timespec="milliseconds")


def prenom_de(nom) -> str:
    mots = re.split(r"[\s,]+", nom.strip()) if isinstance(nom, str) else []
    return mots[0] if mots and mots[0] else "Un héros"


def cle_de(j: dict) -> str | None:
    """La clé du lien du joueur (carnet.cle_heros), sous laquelle le coin cherche sa fiche de jet."""
    return carnet.cle_heros(hashlib.sha256(j["jeton"].encode()).hexdigest()) if isinstance(j.get("jeton"), str) and j["jeton"] else None


def sans_son_peuple(candidats: list, heros_id: str) -> list:
    """Ce que ce joueur ne sait pas : son propre peuple, même gardé secret, n'en est pas un pour lui."""
    return [(s, f) for s, f in candidats if not (s.get("genre") == "peuple" and heros_id in s.get("ids", []))]


def dit(texte, candidats: list, defaut: str = "") -> str:
    """Le texte au masque, ou defaut s'il nomme un secret."""
    vu = masquer(texte or "")
    return defaut if not vu or secrets_dans(vu, candidats) else vu


def armes_pour(f: dict, inconnus: list) -> list:
    """Les armes de la fiche de jet telles que les lit ce joueur (au masque, « Une arme » si le nom nomme un inconnu pour
    lui), avec le vrai nom à côté pour l'atelier. Le coin envoie le nom lu et les dégâts : l'atelier les retrouve ici."""
    vues, sortie = set(), []
    for w in f.get("armes") or []:
        nom = dit(w["nom"], inconnus, "Une arme")
        if (nom, w["degats"]) not in vues:
            vues.add((nom, w["degats"]))
            sortie.append({"nom": nom, "degats": w["degats"], "vrai": w["nom"]})
    return sortie


def vitalite_de(a: dict, etat: dict) -> dict:
    """La Santé et la Psy du moment d'un héros, comme les lit sa fiche (un champ absent de l'état : au maximum)."""
    sante_max = max(1, jets.entier(a.get("sante"), 0, 999))
    psy_max = max(0, jets.entier(a.get("psy"), 0, 999))
    sante = etat.get("sante") if isinstance(etat.get("sante"), int) and not isinstance(etat.get("sante"), bool) else sante_max
    psy = etat.get("psy") if isinstance(etat.get("psy"), int) and not isinstance(etat.get("psy"), bool) else psy_max
    don = etat.get("santeDon") if isinstance(etat.get("santeDon"), int) and not isinstance(etat.get("santeDon"), bool) else 0
    return {"sante": min(sante, sante_max), "sante_max": sante_max, "psy": max(0, min(psy, psy_max)), "psy_max": psy_max, "sante_don": max(0, don)}


def face_dite(x: dict | None) -> dict | None:
    """Un dé d'aventure ou de mésaventure tel que le lisent le joueur et la TV : la face, l'effet, et s'il a été choisi."""
    return {"face": x["face"], "effet": x["effet"], "choisie": bool(x.get("choisie"))} if x else None


class JetsMJ:
    def __init__(self, depot: Path, donnees: Path, *, joueurs_lus: Callable[[], list], heros_des_joueurs: Callable[[], dict],
                 etats_heros: Callable[[], dict], postures: Callable[[], dict], candidats: Callable[[], list],
                 table_ouverte: Callable[[], bool], sources: Callable[[], list],
                 envoyer_tv: Callable[[dict], Awaitable[None]], signaler: Callable[[dict], Awaitable[None]],
                 au_combat: Callable[[], dict] = dict, depenser_jeton: Callable[[str, str], bool] = lambda _h, _j: False,
                 jetons_changes: Callable[[], Awaitable[None]] | None = None, reserve_tv: Callable[[], Awaitable[None]] | None = None):
        self.depot = depot
        self.fichier = donnees / FICHIER
        self.joueurs_lus = joueurs_lus
        self.heros_des_joueurs = heros_des_joueurs
        self.etats_heros = etats_heros
        self.postures = postures
        self.candidats = candidats
        self.table_ouverte = table_ouverte
        self.sources = sources
        self.envoyer_tv = envoyer_tv
        self.signaler = signaler
        self.hasard = None  # un hasard semé pour les essais ; sinon secrets (jets.lancer)
        self.faits: dict[str, dict] = {}  # demande → le message de la TV, envoyé par la suite (apres)
        self.signature = None
        self.vu = None  # l'empreinte des sources à la dernière publication
        # Lot G : la réserve des dés d'aventure, les héros au combat (leur jeton vit dans le combat), le jeton dépensé
        # (main.py le retire de l'état du héros, dans la boucle d'événements), puis la TV et ses fiches à prévenir.
        self.reserve = rsv.Reserve(donnees)
        self.au_combat = au_combat
        self.depenser_jeton = depenser_jeton
        self.jetons_changes = jetons_changes
        self.reserve_tv = reserve_tv
        self.a_dire = {"reserve": False, "jetons": False}  # posé par appliquer (sous le verrou), dit par apres

    def brancher(self, boite) -> None:
        boite.brancher(jd.GENRE, appliquer=self.appliquer, apres=self.apres)
        boite.brancher(jd.GENRE_DES, appliquer=self.appliquer_des, apres=self.apres)
        boite.brancher(jd.GENRE_FACE, appliquer=self.appliquer_face, apres=self.apres)

    # ------------------------------------------------------------ le registre (data/jets.json)

    def lire_registre(self) -> dict:
        try:
            r = stockage.lire_json(self.fichier)
        except (OSError, ValueError):
            r = {}
        r = r if isinstance(r, dict) else {}
        return {k: [x for x in r.get(k) or [] if isinstance(x, dict)] for k in ("jets", "demandes")}

    def ecrire_registre(self, r: dict) -> None:
        """Sous le verrou de la file des demandes."""
        r = {"jets": r["jets"][-JETS_GARDES:], "demandes": r["demandes"][-DEMANDES_GARDEES:]}
        self.fichier.parent.mkdir(parents=True, exist_ok=True)
        stockage.ecrire_json_compact(self.fichier, r)

    # ------------------------------------------------------------ les joueurs et leurs héros

    def joueurs(self) -> dict:
        return {j["id"]: j for j in self.joueurs_lus()
                if isinstance(j, dict) and isinstance(j.get("id"), str) and demandes.ID_JOUEUR.match(j["id"])}

    def fiche_de_jet(self, a: dict, etat: dict | None, posture: str | None) -> dict:
        """La fiche de l'atelier réduite à ce que le jet lit : caractéristiques, compétences, cartons du moment, posture (celle
        du combat en cours, sinon celle de la fiche), et la couleur du héros pour la TV."""
        etat = etat if isinstance(etat, dict) else {}
        f = jd.fiche_valide({"nom": liens_joueurs.nom_de(a), **{k: a.get(k) for k in jets.CARACS}, "competences": a.get("competences"),
                             "cartons": etat.get("cartons"), "posture": posture or a.get("posture"), "armes": a.get("armes"),
                             "vitalite": vitalite_de(a, etat)})
        couleur = a.get("couleur") if isinstance(a.get("couleur"), str) and COULEUR.match(a["couleur"]) else ""
        return f | {"couleur": couleur}

    @staticmethod
    def pour_le_coin(f: dict, inconnus: list) -> dict:
        """La fiche de jet publiée pour le joueur : au masque, seulement les compétences qui aident (un bonus positif), sans
        celles qui nommeraient un inconnu pour lui."""
        competences = [{"nom": dit(c["nom"], inconnus), "bonus": c["bonus"]} for c in f["competences"] if c["bonus"] > 0]
        return {"nom": masquer(f["nom"]), **{k: f[k] for k in jets.CARACS}, "competences": [c for c in competences if c["nom"]],
                "cartons": f["cartons"], "posture": f["posture"], "vitalite": f["vitalite"],
                # Lot G : le nom et les dégâts de chaque arme, jamais ses notes.
                "armes": [{"nom": w["nom"], "degats": w["degats"]} for w in armes_pour(f, inconnus)]}

    @staticmethod
    def des_pour_le_coin(r: dict, joueur: str, jeton: str, combat: bool) -> dict:
        """Lot G, ce que la feuille de test du joueur sait des dés d'aventure : les deux réserves (règle en jeu), le dé de
        mésaventure annoncé pour son prochain test (sans la face que le MJ a pu choisir), son jeton d'avantage (en combat
        aussi depuis le 11/11 : l'état du héros suit le combat à chaque enregistrement)."""
        pub = rsv.publique(r)
        m = r["mesaventures"].get(joueur) if pub else None
        return {"reserve": {"actif": True, **pub} if pub else {"actif": False},
                "mesaventure": {"face_choisie": m["face"] is not None} if m else None,
                "jeton": jeton if jeton in ("avantage", "desavantage") else "", "combat": combat}

    # ------------------------------------------------------------ la fiche de jet publiée pour le coin

    def publier(self) -> int:
        """Écrit la fiche de jet de chaque héros à la tablée, table du coin ouverte ; table fermée, il n'en reste rien. Rend
        le nombre de fichiers écrits ou retirés."""
        dossier = self.depot / jd.DOSSIER
        if not self.table_ouverte():
            if dossier.exists():
                shutil.rmtree(dossier, ignore_errors=True)
                return 1
            return 0
        liens = self.heros_des_joueurs()
        etats, postures, candidats = self.etats_heros(), self.postures(), self.candidats()
        r, au_combat = self.reserve.lire(), self.au_combat()
        voulues = {}
        for j in self.joueurs().values():
            a, cle = liens.get(j["id"]), cle_de(j)
            if a and cle:
                f = self.fiche_de_jet(a, etats.get(a["id"]), postures.get(a["id"]))
                voulues[cle] = self.pour_le_coin(f, sans_son_peuple(candidats, a["id"])) | self.des_pour_le_coin(
                    r, j["id"], (etats.get(a["id"]) or {}).get("avantage"), a["id"] in au_combat)
        dossier.mkdir(parents=True, exist_ok=True)
        ecrits = 0
        for cle, f in voulues.items():
            ecrits += ecrire_si_change(dossier / f"{cle}.json", f)
        for f in dossier.glob("*.json"):
            if f.stem not in voulues:
                f.unlink(missing_ok=True)
                ecrits += 1
        return ecrits

    async def veiller(self) -> None:
        """La tâche de fond du cycle : un regard par seconde sur les dates des sources de la fiche de jet ; si l'une a
        changé, la fiche se republie et les pages de l'atelier relisent la vue (la table ouverte, la pause). Une même erreur
        n'est notée qu'une fois : elle se réessaie chaque seconde, le journal ne s'en remplit pas."""
        erreur = ""
        while True:
            try:
                empreinte = await asyncio.to_thread(lambda: veille.empreinte([*self.sources(), self.reserve.fichier]))
                if empreinte != self.vu:
                    await asyncio.to_thread(self.publier)
                    self.vu = empreinte
                    await self.annoncer()
                erreur = ""
            except asyncio.CancelledError:
                raise
            except Exception as err:
                if repr(err) != erreur:
                    erreur = repr(err)
                    journal.exception("Fiches de jet non publiées")
                self.vu = None
            await asyncio.sleep(SOURCES_PERIODE)

    # ------------------------------------------------------------ le dé (sous le verrou de la file)

    def appliquer(self, j: dict, d: dict) -> str:
        instant = datetime.now()
        age = jd.age(d, instant)
        if age is None or age >= jd.EN_ROUTE:
            raise Refus(409, jd.TROP_TARD)
        if not self.table_ouverte():
            raise Refus(409, jd.FERMEE)
        a = self.heros_des_joueurs().get(j["id"])
        if not a:
            raise Refus(409, jd.ABSENT)
        corps = d["corps"]
        carac, mod = corps["carac"], corps["modificateur"]
        registre = self.lire_registre()
        demande = None
        if corps.get("demande"):
            demande = next((x for x in registre["demandes"] if x.get("id") == corps["demande"] and x.get("joueur") == j["id"]), None)
            if demande is None or demande.get("etat") != "ouverte" or demande.get("carac") not in jets.CARACS:
                raise Refus(409, "Votre MJ ne demande plus ce test.")
            carac, mod = demande["carac"], jd.modificateur(demande.get("modificateur"))
        f = self.fiche_de_jet(a, self.etats_heros().get(a["id"]), self.postures().get(a["id"]))
        comptes = jd.ajustements(f, carac)
        notes_avantage = []
        # L'avantage dépensé pour ce test : +10 % si le héros le porte encore, en combat comme hors combat ; le
        # jeton s'en va ici, avant le dé. Sinon le test part sans, et le joueur le lit.
        if corps.get("avantage"):
            if self.depenser_jeton(a["id"], "avantage"):
                self.a_dire["jetons"] = True
                comptes = [*comptes, (jd.LIBELLE_AVANTAGE, jd.AVANTAGE)]
            else:
                notes_avantage.append("Votre avantage n'était plus là : le test est parti sans son +10 %.")
        # La posture offensive élargit les critiques : les seuils passent ici, jets.jet ne lit pas la fiche.
        seuils = jd.critiques(f["posture"])
        r = jets.jet(f, carac, [corps["competence"]] if corps["competence"] else [], mod, comptes, hasard=self.hasard,
                     seuils=(seuils["reussite"], seuils["echec"]))
        aventure, mesaventure, notes, reserve = self.des_du_test(j, a, corps)
        notes = [*notes_avantage, *notes]
        quand = maintenant()
        nom = masquer(f["nom"])
        candidats = self.candidats()
        champs = ("carac", "carac_nom", "base", "competence", "bonus", "modificateur", "ajustements", "visee", "de", "issue", "issue_nom", "reussi")
        # Le registre du MJ : tout, avec le nom de la fiche.
        registre["jets"].append({"id": d["id"], "quand": quand, "joueur": j["id"], "joueur_nom": str(j.get("nom") or ""), "heros": a["id"],
                                 "heros_nom": f["nom"], **{k: r[k] for k in champs},
                                 "demande": demande["id"] if demande else None, **({"critiques": seuils} if seuils["offensive"] else {}),
                                 **({"aventure": {**aventure, "annule": False}} if aventure else {}),
                                 **({"mesaventure": mesaventure} if mesaventure else {}), **({"notes": notes} if notes else {})})
        if demande is not None:
            demande.update(etat="repondue", jet=d["id"], repondue_le=quand)
        self.ecrire_registre(registre)
        # La réserve après le registre : un registre qui ne s'écrit pas ne laisse pas un dé passé d'une réserve à l'autre.
        if reserve is not None:
            self.reserve.ecrire(reserve)
            self.a_dire["reserve"] = True
        # Ce que lit le joueur : au masque, sans compétence qui nommerait un inconnu pour lui.
        d["public"] = {"nom": nom, **{k: r[k] for k in champs}, "competence": dit(r["competence"], sans_son_peuple(candidats, a["id"]), "une compétence") if r["competence"] else "",
                       "quand": quand, **({"critiques": seuils} if seuils["offensive"] else {}),
                       **({"aventure": face_dite(aventure)} if aventure else {}),
                       **({"mesaventure": face_dite(mesaventure)} if mesaventure else {}), **({"notes": notes} if notes else {})}
        # Ce que voit la TV : le prénom public, la couleur, le test, le dé, l'issue. La compétence tombe si elle nomme un
        # secret des joueurs, le peuple caché de ce héros compris (la tablée ne le sait pas).
        self.faits[d["id"]] = {"type": "jet", "id": secrets.token_hex(6), "nom": prenom_de(nom), "couleur": f["couleur"],
                               "carac": r["carac_nom"], "competence": dit(r["competence"], candidats) if r["competence"] else "",
                               "de": r["de"], "issue": r["issue"], "issue_nom": r["issue_nom"],
                               **({"aventure": face_dite(aventure)} if aventure else {}),
                               **({"mesaventure": face_dite(mesaventure)} if mesaventure else {})}
        while len(self.faits) > FAITS_MAX:
            self.faits.pop(next(iter(self.faits)))
        suite = "".join(f" Dé {nom_de} : {x['face']}, {x['effet']}." for nom_de, x in (("d'aventure", aventure), ("de mésaventure", mesaventure)) if x)
        return f"{r['carac_nom']} {r['visee']} % : le dé donne {r['de']:02d}, {r['issue_nom'].lower()}.{suite}"

    # ------------------------------------------------------------ le dé d'aventure et le dé de mésaventure (sous le verrou)

    def des_du_test(self, j: dict, a: dict, corps: dict) -> tuple[dict | None, dict | None, list, dict | None]:
        """Sous le verrou de la file, quand le test roule : le dé d'aventure que le joueur a ajouté (s'il en reste au groupe)
        et le dé de mésaventure annoncé pour lui (s'il en reste au MJ). Chacun passe d'une réserve à l'autre ici, une seule
        fois. La face : celle du MJ si le héros porte encore son désavantage, sinon le D6. Le joueur ne la choisit plus avant
        le lancer : son avantage la change après, le dé vu (appliquer_face). Rend (aventure, mésaventure, phrases pour le
        joueur, la réserve à écrire si elle a changé)."""
        r = self.reserve.lire()
        avant = json.dumps(r, sort_keys=True)
        notes = []
        aventure = mesaventure = None
        if corps.get("aventure"):
            if not r["actif"]:
                notes.append("La règle des dés d'aventure n'est plus en jeu : votre test est parti sans dé d'aventure.")
            elif not rsv.prendre(r):
                notes.append("Plus de dé d'aventure dans la réserve du groupe : votre test est parti sans.")
            else:
                face = des.rouler_d6(self.hasard)
                aventure = {"face": face, "effet": des.effet(face), "choisie": ""}
        m, roule = rsv.consommer(r, j["id"])
        if m is not None and not roule:
            notes.append("Le dé de mésaventure annoncé n'a pas roulé : la réserve de votre MJ était vide.")
        elif m is not None:
            par = ""
            # La face du MJ ne vaut que hors combat (règle d'avant le 11/11, inchangée) : au combat, le dé roule et le
            # désavantage reste dans le combat.
            if m["face"] is not None and a["id"] not in self.au_combat() and self.depenser_jeton(a["id"], "desavantage"):
                self.a_dire["jetons"] = True
                face, par = m["face"], "mj"
            else:
                face = des.rouler_d6(self.hasard)
            mesaventure = {"face": face, "effet": des.effet(face), "choisie": par}
        return aventure, mesaventure, notes, (r if json.dumps(r, sort_keys=True) != avant else None)

    # ------------------------------------------------------------ l'avantage après le lancer : changer la face d'un dé

    def message_tv(self, jet: dict, a: dict | None, candidats: list, rappel: bool = False) -> dict:
        """Le bandeau de la TV d'un test du registre : le prénom public, la couleur, le test, le dé, l'issue, ses dés
        d'aventure. « rappel » : le même test redit (une face changée), que la table montre sans rejouer son jingle."""
        couleur = a.get("couleur") if a and isinstance(a.get("couleur"), str) and COULEUR.match(a["couleur"]) else ""
        return {"type": "jet", "id": secrets.token_hex(6), "nom": prenom_de(masquer(jet.get("heros_nom") or "")), "couleur": couleur,
                "carac": jet.get("carac_nom") or "", "competence": dit(jet.get("competence"), candidats) if jet.get("competence") else "",
                "de": jet.get("de"), "issue": jet.get("issue"), "issue_nom": jet.get("issue_nom"),
                **({"aventure": face_dite(jet["aventure"])} if isinstance(jet.get("aventure"), dict) and not jet["aventure"].get("annule") else {}),
                **({"mesaventure": face_dite(jet["mesaventure"])} if isinstance(jet.get("mesaventure"), dict) else {}),
                **({"rappel": True} if rappel else {})}

    def appliquer_face(self, j: dict, d: dict) -> str:
        """« Mon avantage : changer l'effet », sous le verrou de la file : le dé d'aventure ou de mésaventure du
        dernier test du joueur, déjà lancé, prend la face qu'il choisit, et son jeton d'avantage s'en va. Refusé si le test
        n'est pas le sien ou n'est plus le dernier, s'il est trop ancien, si le dé n'a pas roulé, a été annulé ou déjà
        choisi (par lui, ou par le MJ sur un désavantage), ou si le héros ne porte plus d'avantage."""
        corps = d["corps"]
        a = self.heros_des_joueurs().get(j["id"])
        if not a:
            raise Refus(409, jd.ABSENT)
        registre = self.lire_registre()
        tests = [x for x in registre["jets"] if x.get("joueur") == j["id"] and x.get("genre") != jd.GENRE_DES]
        jet = tests[-1] if tests else None
        if jet is None or jet.get("id") != corps["jet"]:
            raise Refus(409, "Seul le dé de votre dernier test se change.")
        quand = jd.instant_de(jet.get("quand"))
        if quand is None or (datetime.now() - quand).total_seconds() > jd.DUREE_FACE:
            raise Refus(409, "Ce test est trop ancien : son dé ne se change plus.")
        x = jet.get(corps["de"]) if isinstance(jet.get(corps["de"]), dict) else None
        if x is None or x.get("annule"):
            raise Refus(409, "Ce dé n'a pas roulé avec ce test.")
        if x.get("choisie"):
            raise Refus(409, "L'effet de ce dé a déjà été choisi.")
        if not self.depenser_jeton(a["id"], "avantage"):
            raise Refus(409, "Votre héros ne porte plus d'avantage.")
        self.a_dire["jetons"] = True
        avant = x["face"]
        x.update(face=corps["face"], effet=des.effet(corps["face"]), choisie="joueur", avant=avant)
        self.ecrire_registre(registre)
        d["public"] = {"jet": jet["id"], "de": corps["de"], "face": x["face"], "effet": x["effet"]}
        self.faits[d["id"]] = self.message_tv(jet, a, self.candidats(), rappel=True)
        while len(self.faits) > FAITS_MAX:
            self.faits.pop(next(iter(self.faits)))
        nom = "Dé d'aventure" if corps["de"] == "aventure" else "Dé de mésaventure"
        return f"{nom} : {x['face']}, {x['effet']} (votre avantage)."

    # ------------------------------------------------------------ les dés libres et les dégâts des armes (sous le verrou)

    def appliquer_des(self, j: dict, d: dict) -> str:
        """« 2D6+1 », ou « Épée : 1D10 » : l'expression relue, l'arme retrouvée sur la fiche de l'atelier, les dés jetés ici."""
        instant = datetime.now()
        age = jd.age(d, instant)
        if age is None or age >= jd.EN_ROUTE:
            raise Refus(409, jd.TROP_TARD)
        if not self.table_ouverte():
            raise Refus(409, jd.FERMEE)
        a = self.heros_des_joueurs().get(j["id"])
        if not a:
            raise Refus(409, jd.ABSENT)
        corps = d["corps"]
        lu = des.lire(corps.get("des"))
        if lu is None:
            raise Refus(400, "Ces dés ne se lancent pas.")
        f = self.fiche_de_jet(a, self.etats_heros().get(a["id"]), self.postures().get(a["id"]))
        candidats = self.candidats()
        arme = None
        if corps.get("arme"):
            arme = next((w for w in armes_pour(f, sans_son_peuple(candidats, a["id"]))
                         if w["nom"] == corps["arme"] and w["degats"] == lu["texte"]), None)
            if arme is None:
                raise Refus(409, jd.ARME_PARTIE)
        res = des.lancer(lu, self.hasard)
        quand = maintenant()
        nom = masquer(f["nom"])
        champs = ("texte", "nombre", "faces", "bonus", "des", "total")
        registre = self.lire_registre()
        registre["jets"].append({"id": d["id"], "quand": quand, "genre": jd.GENRE_DES, "joueur": j["id"], "joueur_nom": str(j.get("nom") or ""),
                                 "heros": a["id"], "heros_nom": f["nom"], **{k: res[k] for k in champs}, "arme": arme["vrai"] if arme else ""})
        self.ecrire_registre(registre)
        d["public"] = {"genre": jd.GENRE_DES, "nom": nom, **{k: res[k] for k in champs}, "arme": arme["nom"] if arme else "", "quand": quand}
        # La TV : le nom de l'arme tombe s'il nomme un secret des joueurs (le peuple caché de ce héros compris).
        self.faits[d["id"]] = {"type": "des", "id": secrets.token_hex(6), "nom": prenom_de(nom), "couleur": f["couleur"],
                               **{k: res[k] for k in champs}, "arme": dit(arme["vrai"], candidats) if arme else ""}
        while len(self.faits) > FAITS_MAX:
            self.faits.pop(next(iter(self.faits)))
        bonus = f" {res['bonus']:+d}" if res["bonus"] else ""
        return f"{res['texte']} : {' + '.join(str(x) for x in res['des'])}{bonus}, total {res['total']}."

    async def apres(self, liste: list) -> None:
        """Hors du verrou : le bandeau de la TV, la réserve et le jeton dépensé s'il y a lieu, puis la vue des pages de
        l'atelier."""
        for _j, d in liste:
            message = self.faits.pop(d.get("id"), None)
            if message and d.get("statut") == demandes.APPLIQUEE:
                try:
                    await self.envoyer_tv(message)
                except Exception:
                    journal.exception("Jet non montré à la TV")
        if self.a_dire["jetons"]:
            self.a_dire["jetons"] = False
            if self.jetons_changes:
                try:
                    await self.jetons_changes()
                except Exception:
                    journal.exception("Jeton d'avantage non montré à la TV")
        if self.a_dire["reserve"]:
            self.a_dire["reserve"] = False
            await self.reserve_changee(annoncer=False)
        await self.annoncer()

    async def reserve_changee(self, annoncer: bool = True) -> dict | None:
        """Hors du verrou, après tout changement de la réserve : la TV relit son coin, la feuille de test des joueurs se
        republie (sans attendre le prochain regard sur les sources), et les pages de l'atelier relisent la vue."""
        if self.reserve_tv:
            try:
                await self.reserve_tv()
            except Exception:
                journal.exception("Réserve des dés non montrée à la TV")
        try:
            await asyncio.to_thread(self.publier)
        except Exception:
            journal.exception("Fiches de jet non publiées (réserve)")
        return await self.annoncer() if annoncer else None

    # ------------------------------------------------------------ les tests demandés par le MJ

    def demander(self, joueur: str, corps: dict, mesaventure: bool = False, face=None) -> dict:
        """« Léa : test de Mental » : posé dans le fichier du joueur, déjà appliqué ; un test encore ouvert pour lui est
        remplacé (un seul à la fois). Avec mesaventure, un dé de mésaventure est annoncé pour ce test, dans le
        même geste : si l'un ne peut pas, rien ne part."""
        j = self.joueurs().get(joueur)
        if not j:
            raise Refus(404, "Joueur inconnu.")
        propre = jd.valider_demande(corps)
        nom = str(j.get("nom") or "ce joueur")
        if not self.table_ouverte():
            raise Refus(409, FERMEE_MJ)
        if demandes.en_pause(self.depot):
            raise Refus(423, PAUSE_MJ.format(nom=nom))
        a = self.heros_des_joueurs().get(joueur)
        if not a:
            raise Refus(409, ABSENT_MJ.format(nom=nom))
        face = self.face_du_mj(a, face) if mesaventure else None
        quand = maintenant()
        instant = datetime.fromisoformat(quand)
        d = {"id": secrets.token_hex(6), "genre": jd.GENRE_DEMANDE, "statut": demandes.APPLIQUEE, "version": 1, "cree": quand,
             "modifie": quand, "corps": propre, "resultat": None, "mot": "", "traitee": quand, "par": "mj"}
        with demandes.verrou(self.depot):
            r = self.reserve.lire()
            if mesaventure:
                rsv.imposer(r, joueur, a["id"], face)
            liste = demandes.lire(self.depot, joueur)
            remplacees = set()
            for x in liste:
                if jd.ouverte(x, instant):
                    demandes.passer(x, demandes.ANNULEE, "mj", resultat="Remplacé par un autre test.")
                    remplacees.add(x["id"])
            demandes.ecrire(self.depot, joueur, [*jd.ranger(liste, instant), d])
            registre = self.lire_registre()
            for x in registre["demandes"]:
                if x.get("id") in remplacees:
                    x["etat"] = "remplacee"
            registre["demandes"].append({"id": d["id"], "joueur": joueur, **propre, "cree": quand, "etat": "ouverte"})
            self.ecrire_registre(registre)
            if mesaventure:
                self.reserve.ecrire(r)
        return d

    # ------------------------------------------------------------ la réserve, côté MJ (chaque geste sous le verrou)

    def face_du_mj(self, a: dict, face) -> int | None:
        """La face que le MJ impose à un dé de mésaventure : seulement pour un héros qui porte un désavantage, hors combat
        (le désavantage sera retiré quand le dé roulera)."""
        if face is None:
            return None
        if des.face(face) is None:
            raise Refus(400, "Une face de 1 à 6.")
        jeton = (self.etats_heros().get(a["id"]) or {}).get("avantage")
        if jeton != "desavantage" or a["id"] in self.au_combat():
            raise Refus(409, FACE_MJ)
        return face

    def imposer(self, joueur: str, face=None) -> dict:
        """« Dé de mésaventure au prochain test de Léa » : annoncé dans sa feuille avant qu'elle lance, consommé une fois."""
        j = self.joueurs().get(joueur)
        if not j:
            raise Refus(404, "Joueur inconnu.")
        nom = str(j.get("nom") or "ce joueur")
        if not self.table_ouverte():
            raise Refus(409, "La table du coin est fermée : {nom} ne verrait pas l'annonce. Passez le dé à la main.".format(nom=nom))
        a = self.heros_des_joueurs().get(joueur)
        if not a:
            raise Refus(409, ABSENT_MJ.format(nom=nom))
        face = self.face_du_mj(a, face)
        with demandes.verrou(self.depot):
            r = self.reserve.lire()
            m = rsv.imposer(r, joueur, a["id"], face)
            self.reserve.ecrire(r)
        return m

    def retirer_mesaventure(self, joueur: str) -> None:
        with demandes.verrou(self.depot):
            r = self.reserve.lire()
            if rsv.retirer(r, joueur) is None:
                raise Refus(404, "Aucun dé de mésaventure n'est annoncé pour ce joueur.")
            self.reserve.ecrire(r)

    def annuler_aventure(self, ident: str) -> dict:
        """« Annuler le dé » : le dé d'aventure d'un test revient au groupe ; le joueur le lit sous son résultat. Le jeton
        d'avantage dépensé pour en choisir la face ne revient pas seul : le MJ le rend d'un toucher dans le Tableau."""
        with demandes.verrou(self.depot):
            registre = self.lire_registre()
            x = next((x for x in registre["jets"] if x.get("id") == ident), None)
            if x is None or not isinstance(x.get("aventure"), dict):
                raise Refus(404, "Ce test n'a pas de dé d'aventure.")
            if x["aventure"].get("annule"):
                raise Refus(409, "Ce dé d'aventure est déjà revenu au groupe.")
            r = self.reserve.lire()
            rsv.rendre(r)
            x["aventure"]["annule"] = True
            self.ecrire_registre(registre)
            self.reserve.ecrire(r)
            try:
                liste = demandes.lire(self.depot, x.get("joueur"))
            except Refus:
                liste = []
            d = demandes.trouver(liste, ident)
            p = d.get("public") if d else None
            if isinstance(p, dict) and isinstance(p.get("aventure"), dict):
                p["aventure"]["annule"] = True
                demandes.ecrire(self.depot, x["joueur"], liste)
        return x

    def regler(self, corps: dict) -> dict:
        """L'interrupteur « Dés d'aventure », le total, et « Tout au groupe » (onglet Table)."""
        with demandes.verrou(self.depot):
            r = rsv.regler(self.reserve.lire(), corps.get("actif"), corps.get("total"), corps.get("remettre") is True)
            self.reserve.ecrire(r)
        return r

    def transferer(self, vers) -> dict:
        """Un dé d'une réserve à l'autre, à la main : on joue aussi avec de vrais dés à la table."""
        with demandes.verrou(self.depot):
            r = rsv.passer(self.reserve.lire(), vers)
            self.reserve.ecrire(r)
        return r

    def retirer(self, joueur: str, ident: str, version) -> dict:
        """« Retirer » : le test demandé n'attend plus le joueur, avec la version lue (le joueur a pu lancer entre-temps)."""
        j = self.joueurs().get(joueur)
        if not j:
            raise Refus(404, "Joueur inconnu.")
        if isinstance(version, bool) or not isinstance(version, int):
            raise Refus(400, "La version du test manque : relisez le Tableau.")
        with demandes.verrou(self.depot):
            liste = demandes.lire(self.depot, joueur)
            d = demandes.trouver(liste, ident)
            if d is None or d.get("genre") != jd.GENRE_DEMANDE:
                raise Refus(404, "Ce test n'est plus demandé.")
            if d.get("repondue"):
                raise Refus(409, f"{j.get('nom') or 'Le joueur'} a déjà lancé ce test.")
            demandes.passer(d, demandes.ANNULEE, "mj", version=version, resultat="Votre MJ a retiré sa demande.")
            demandes.ecrire(self.depot, joueur, liste)
            registre = self.lire_registre()
            for x in registre["demandes"]:
                if x.get("id") == ident and x.get("etat") == "ouverte":
                    x["etat"] = "retiree"
            self.ecrire_registre(registre)
        return d

    # ------------------------------------------------------------ la vue des pages de l'atelier

    def vue(self) -> dict:
        """Les derniers jets (le plus récent d'abord), les tests demandés encore ouverts (d'après le fichier de chaque joueur :
        il a pu lancer), les joueurs dont le héros est à la tablée (à qui demander), la table du coin et la pause.
        « reste » : les secondes avant qu'un test demandé passe, comptées au moment de la vue."""
        instant = datetime.now()
        js = self.joueurs()
        liens = self.heros_des_joueurs()
        heros = {jid: {"id": a["id"], "nom": liens_joueurs.nom_de(a)} for jid, a in liens.items() if jid in js}
        etats, au_combat = self.etats_heros(), self.au_combat()
        ouvertes = []
        for jid, j in js.items():
            try:
                liste = demandes.lire(self.depot, jid)
            except Refus:
                continue
            for d in liste:
                if jd.ouverte(d, instant):
                    c = d.get("corps") if isinstance(d.get("corps"), dict) else {}
                    ouvertes.append({"id": d["id"], "joueur": jid, "nom": str(j.get("nom") or ""), "heros": heros.get(jid),
                                     "carac": c.get("carac"), "carac_nom": jets.CARACS.get(c.get("carac"), ""),
                                     "modificateur": c.get("modificateur") or 0, "version": d["version"], "cree": d.get("cree"),
                                     "reste": jd.reste(d, instant)})
        registre = self.lire_registre()
        vus = []
        for x in reversed(registre["jets"][-JETS_VUS:]):
            if x.get("genre") == jd.GENRE_DES:
                vus.append({k: x.get(k) for k in ("id", "quand", "genre", "joueur", "joueur_nom", "heros", "heros_nom", "texte", "nombre",
                                                  "faces", "bonus", "des", "total", "arme")})
                continue
            vus.append({k: x.get(k) for k in ("id", "quand", "joueur", "joueur_nom", "heros", "heros_nom", "carac", "carac_nom", "base",
                                              "competence", "bonus", "modificateur", "ajustements", "visee", "de", "issue", "issue_nom",
                                              "reussi")} | {"genre": jd.GENRE, "demande": bool(x.get("demande"))}
                       | {k: x[k] for k in ("aventure", "mesaventure", "notes", "critiques") if x.get(k)})
        r = self.reserve.lire()
        reserve = {"actif": r["actif"], "groupe": r["groupe"], "mj": r["mj"], "total": rsv.total(r), "total_max": rsv.TOTAL_MAX,
                   "libres": max(0, rsv.libres(r)),
                   "mesaventures": sorted(({"joueur": jid, "nom": str(js[jid].get("nom") or ""), "heros": heros.get(jid), "face": m["face"],
                                            "pose": m["pose"]} for jid, m in r["mesaventures"].items() if jid in js), key=lambda x: x["pose"])}

        def jeton(jid: str) -> str:
            a = liens.get(jid)
            v = (etats.get(a["id"]) or {}).get("avantage") if a else ""
            return v if v in ("avantage", "desavantage") else ""

        return {"jets": vus, "demandes": sorted(ouvertes, key=lambda x: str(x["cree"])),
                "joueurs": sorted(({"joueur": jid, "nom": str(js[jid].get("nom") or ""), "heros": h, "jeton": jeton(jid),
                                    "combat": h["id"] in au_combat} for jid, h in heros.items()),
                                  key=lambda x: x["nom"].casefold()),
                "reserve": reserve,
                "ouvert": bool(self.table_ouverte()), "pause": demandes.en_pause(self.depot), "duree": jd.DUREE_DEMANDE,
                "par_heure": jd.PAR_HEURE}

    @staticmethod
    def empreinte(v: dict) -> str:
        utile = [[[x["id"], (x.get("aventure") or {}).get("annule")] for x in v["jets"]],
                 [{k: x[k] for k in ("id", "joueur", "version")} for x in v["demandes"]], v["joueurs"], v["ouvert"], v["pause"],
                 {k: v["reserve"][k] for k in ("actif", "groupe", "mj")}, [[m["joueur"], m["face"], m["pose"]] for m in v["reserve"]["mesaventures"]]]
        return hashlib.sha256(json.dumps(utile, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()[:20]

    def vue_signee(self) -> dict:
        v = self.vue()
        return v | {"signature": self.empreinte(v)}

    async def annoncer(self, v: dict | None = None) -> dict:
        """Refait la vue et la pousse vers les pages de l'atelier si elle a changé (ni la TV, ni la table publique, ni le
        coin : elle nomme les joueurs et leur fiche)."""
        v = v or await asyncio.to_thread(self.vue_signee)
        if v["signature"] != self.signature:
            self.signature = v["signature"]
            try:
                await self.signaler({"type": "jets", **v})
            except Exception:
                journal.exception("Pages de l'atelier non prévenues (jets)")
        return v

    # ------------------------------------------------------------ les dés du MJ (ni file, ni registre)

    def lancer_mj(self, corps: dict) -> tuple[dict, dict | None]:
        """Les dés du MJ : {"des": "2D6+1"} ou {"test": {"valeur", "libelle", "nom"}}, avec "tv" (« Montrer à la TV ») et
        un "nom" (celui d'un adversaire). Rend (ce que lit le MJ, le message de la table ou None). Le message ne porte ni la
        valeur visée, ni un nom ou un libellé qui nommerait un secret des joueurs : « Le MJ » à la place du nom, rien à la
        place du libellé."""
        if corps.get("tv") not in (None, True, False):
            raise Refus(400, "« tv » : oui ou non.")
        test = corps.get("test")
        if (corps.get("des") is None) == (test is None):
            raise Refus(400, "Des dés (« des ») ou un test (« test ») : l'un des deux.")
        source = test if test is not None else corps
        if not isinstance(source, dict):
            raise Refus(400, "Le test : demande illisible.")

        def texte(v, maximum: int, quoi: str) -> str:
            if v is None:
                return ""
            if not isinstance(v, str):
                raise Refus(400, f"{quoi} : un texte.")
            return " ".join(v.split())[:maximum]

        nom = texte(source.get("nom"), NOM_MJ_MAX, "Le nom")
        libelle = texte(source.get("libelle"), LIBELLE_MJ_MAX, "Le libellé")
        candidats = self.candidats()
        public = {"id": secrets.token_hex(6), "nom": dit(nom, candidats, NOM_MJ) if nom else NOM_MJ, "couleur": ""}
        if test is None:
            lu = des.lire(corps.get("des"))
            if lu is None:
                raise Refus(400, f"Ces dés ne se lancent pas : de 1 à {des.NOMBRE_MAX} dés (D4, D6, D8, D10, D12, D20 ou D100), "
                                 f"et un bonus de -{des.BONUS_MAX} à +{des.BONUS_MAX}.")
            res = des.lancer(lu, self.hasard)
            message = {"type": "des", **public, **res, "arme": dit(libelle, candidats) if libelle else ""}
            vu = {"genre": jd.GENRE_DES, **res, "nom": nom or NOM_MJ, "libelle": libelle}
        else:
            valeur = test.get("valeur")
            if isinstance(valeur, bool) or not isinstance(valeur, int) or not 0 <= valeur <= jets.VALEUR_MAX:
                raise Refus(400, f"La valeur visée : un entier de 0 à {jets.VALEUR_MAX}.")
            de = jets.lancer(self.hasard)
            issue = jets.issue(de, valeur)
            # Sans caractéristique : le bandeau dit « Le MJ, Attaque » (jet-tv.js), le libellé à la place de la compétence.
            message = {"type": "jet", **public, "carac": "", "competence": dit(libelle, candidats) if libelle else "",
                       "de": de, "issue": issue, "issue_nom": jets.NOMS_ISSUES[issue]}
            vu = {"genre": jd.GENRE, "de": de, "visee": valeur, "issue": issue, "issue_nom": jets.NOMS_ISSUES[issue],
                  "reussi": jets.reussi(issue), "nom": nom or NOM_MJ, "libelle": libelle}
        montre = corps.get("tv") is True
        return {**vu, "quand": maintenant(), "tv": montre, "nom_montre": public["nom"] if montre else ""}, (message if montre else None)

    # ------------------------------------------------------------ les routes

    def routes(self, corps_objet) -> APIRouter:
        """Hors de /api/table/… : la garde de main.py les ferme à la table publique, et à Internet sans session."""
        r = APIRouter()

        @r.get("/api/jets")
        async def les_jets():
            return await asyncio.to_thread(self.vue_signee)

        @r.post("/api/jets/demander")
        async def demander_un_test(requete: Request):
            corps = await corps_objet(requete)
            joueur = corps.get("joueur")
            if not isinstance(joueur, str):
                raise HTTPException(400, "Le joueur manque.")
            if corps.get("mesaventure") not in (None, True, False):
                raise HTTPException(400, "« mesaventure » : oui ou non.")
            try:
                await asyncio.to_thread(self.demander, joueur, {k: corps.get(k) for k in ("carac", "modificateur")},
                                        corps.get("mesaventure") is True, corps.get("face"))
            except Refus as refus:
                raise HTTPException(refus.statut, refus.message)
            if corps.get("mesaventure") is True:
                return await self.reserve_changee()
            return await self.annoncer()

        @r.post("/api/jets/mj")
        async def lancer_les_des_du_mj(requete: Request):
            corps = await corps_objet(requete)
            try:
                vu, message = await asyncio.to_thread(self.lancer_mj, corps)
            except Refus as refus:
                raise HTTPException(refus.statut, refus.message)
            if message is not None:
                try:
                    await self.envoyer_tv(message)
                except Exception:
                    journal.exception("Dés du MJ non montrés à la table")
                    vu["tv"] = False
            return vu

        # Lot G : la réserve des dés d'aventure. Chaque geste prend le verrou de la file (dans son fil), puis la TV, la
        # feuille des joueurs et les pages de l'atelier relisent.
        async def geste(fonction, *arguments) -> dict:
            try:
                await asyncio.to_thread(fonction, *arguments)
            except Refus as refus:
                raise HTTPException(refus.statut, refus.message)
            return await self.reserve_changee()

        @r.post("/api/jets/mesaventure")
        async def imposer_une_mesaventure(requete: Request):
            corps = await corps_objet(requete)
            if not isinstance(corps.get("joueur"), str):
                raise HTTPException(400, "Le joueur manque.")
            return await geste(self.imposer, corps["joueur"], corps.get("face"))

        @r.post("/api/jets/mesaventure/{joueur}/retirer")
        async def retirer_une_mesaventure(joueur: str):
            return await geste(self.retirer_mesaventure, joueur)

        @r.post("/api/jets/{ident}/aventure/annuler")
        async def annuler_un_de_d_aventure(ident: str):
            return await geste(self.annuler_aventure, ident)

        @r.put("/api/des-aventure")
        async def regler_les_des(requete: Request):
            corps = await corps_objet(requete)
            return await geste(self.regler, {k: corps.get(k) for k in ("actif", "total", "remettre")})

        @r.post("/api/des-aventure/passer")
        async def passer_un_de(requete: Request):
            corps = await corps_objet(requete)
            return await geste(self.transferer, corps.get("vers"))

        @r.post("/api/jets/demandes/{joueur}/{ident}/retirer")
        async def retirer_un_test(joueur: str, ident: str, requete: Request):
            corps = await corps_objet(requete)
            try:
                await asyncio.to_thread(self.retirer, joueur, ident, corps.get("version"))
            except Refus as refus:
                raise HTTPException(refus.statut, refus.message)
            return await self.annoncer()

        return r


def ecrire_si_change(chemin: Path, contenu: dict) -> int:
    """Écrit {"maj", ...} seulement si le contenu a changé : le flux du coin ne réveille les pages que pour du nouveau."""
    try:
        avant = stockage.lire_json(chemin)
    except (OSError, ValueError):
        avant = None
    if isinstance(avant, dict) and {k: v for k, v in avant.items() if k != "maj"} == contenu:
        return 0
    stockage.ecrire_json_compact(chemin, {"maj": maintenant(), **contenu}, mode=0o644)
    return 1
