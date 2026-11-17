"""La boîte « Demandes des joueurs » de l'atelier : ce que les joueurs demandent depuis le coin (demandes.py), leurs
commandes à l'échoppe (carnet.py, format inchangé) et les aventuriers qu'ils ont envoyés, rassemblés pour le MJ.

Une tâche de fond (surveiller, lancée dans le cycle de main.py) guette le dossier des propositions. À chaque vague :
  1. elle applique, dans la boucle d'événements et sous le verrou des demandes, ce qui s'applique sans le MJ ;
  2. elle recompte la boîte ;
  3. elle prévient les pages de l'atelier (/ws/atelier, message {"type": "demandes"}) si la boîte a changé ;
  4. elle met en file une notification Telegram (telegram.py) pour ce qui est nouveau, une seule par vague.
Ce qui a déjà été notifié est gardé dans data/demandes-vues.json : rien ne part deux fois, même après un redémarrage.

Ses propres écritures (un statut) la relancent une fois, sans rien à refaire : une demande appliquée n'est plus « à
appliquer », le passage suivant ne réécrit rien et s'arrête là.

Un genre qui agit dans l'atelier s'y branche (brancher) : appliquer (genres appliqués seuls), accepter (genres qui
attendent le MJ, quand « Accepter » fait quelque chose), annuler (l'« Annuler » de la boîte), apres (une suite
asynchrone, hors du verrou : prévenir la TV, après une vague appliquée comme après un « Accepter » ou un « Annuler »
du MJ), dire (la ligne lisible de la boîte : « Dario a ajouté « Corde de 15 m » »). Ces fonctions reçoivent le joueur et
la demande, tournent sous le verrou sans rien attendre, et lèvent demandes.Refus pour un échec dont la phrase va au
joueur.

Un genre trop lent pour le verrou (l'aide à l'écriture : un appel à l'API) se branche avec reveiller : la vague ne
l'applique pas, elle réveille seulement son ouvrier, qui le traite à son rythme et écrit lui-même le statut.

preparer (genres qui attendent le MJ, quand l'atelier a quelque chose à faire dès qu'il les voit : jeter le dé d'une
activité) : appelé une fois, sous le verrou, pour chaque demande en attente dont a_preparer(joueur, demande) dit qu'elle
ne l'est pas encore. Il écrit dans la demande ce que le joueur doit lire ; la version monte, la demande attend toujours le
MJ. Un Refus la met en échec, avec sa phrase.

Deux MJ : chaque élément de la boîte revient à un MJ (pour_qui) : le principal, sauf un mot que le joueur a
adressé à l'autre MJ, un genre adressé par adresser (un déplacement va au MJ du plan) et une commande à l'échoppe, qui va
à l'auteur de la boutique (adresser_commandes). Chacun ne lit, ne tranche et n'est prévenu que de ce qui lui revient ; la
liste de ceux à qui un joueur peut écrire est publiée pour le coin (demandes.ecrire_destinataires). Telegram ne parle que
de ce qui revient au principal. « Pour le MJ seulement » lui reste toujours. Sans comptes (les essais d'avant ce lot), la
boîte est celle d'un seul MJ, comme avant.
"""
import asyncio
import hashlib
import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Awaitable, Callable

from fastapi import APIRouter, HTTPException, Request

from commun import carnet
from mj import cloisonnement
from commun import confie
from commun import demandes
from coin_mj import liens_joueurs
from contenu import telegram as tg
from commun import veille
from mj.proprietes import PRINCIPAL
from commun import stockage

journal = logging.getLogger("atelier.demandes")

LIEN_BOITE = os.environ.get("LIEN_ATELIER", "http://localhost:8323").rstrip("/") + "/#/demandes"
HISTORIQUE_MAX = 40  # demandes traitées montrées dans la boîte
VUES_MAX = 3000  # identifiants gardés dans demandes-vues.json
VUES_JOURS = 30  # un identifiant qui n'existe plus est oublié après ce délai
REGROUPEMENT = 300  # millisecondes
SECOURS = 30  # secondes entre deux relectures de secours
# Ce que disent les notifications pour ce qui n'est pas une demande de la file.
TELEGRAM_COMMANDE = ("commande à l'échoppe", "{n} commandes à l'échoppe")
TELEGRAM_AVENTURIER = ("un aventurier à accueillir", "{n} aventuriers à accueillir")


@dataclass
class Branchement:
    appliquer: Callable[[dict, dict], str] | None = None
    accepter: Callable[[dict, dict, str], str | None] | None = None
    annuler: Callable[[dict, dict], str] | None = None
    apres: Callable[[list], Awaitable[None]] | None = None
    dire: Callable[[dict, dict], str] | None = None
    reveiller: Callable[[], None] | None = None  # genre traité à part (voir plus haut) : prévenu à chaque vague
    preparer: Callable[[dict, dict], None] | None = None
    a_preparer: Callable[[dict, dict], bool] | None = None


def dit(formes: tuple, n: int) -> str:
    return formes[0] if n <= 1 else formes[1].format(n=n)


def refus_http(refus: demandes.Refus) -> HTTPException:
    return HTTPException(refus.statut, refus.message)


class Boite:
    def __init__(self, depot: Path, donnees: Path, *, joueurs_lus: Callable[[], list], nettoyer_mot: Callable[[str], str],
                 signaler: Callable[..., Awaitable[None]], telegram: tg.Telegram | None = None, lien: str = LIEN_BOITE,
                 comptes: Callable[[], list] | None = None, connus: Callable[[], set] | None = None,
                 fichier_comptes: Path | None = None):
        """comptes() : les MJ qui ouvrent l'atelier, [{"id", "nom"}], le principal d'abord ; connus() : tous les comptes,
        fermés compris ; avec eux, signaler(message, compte) ne prévient que les pages de ce compte. fichier_comptes : suivi
        par la surveillance (un MJ qui ouvre ou ferme son compte change la liste publiée pour le coin)."""
        self.depot = depot
        self.fichier_vues = donnees / "demandes-vues.json"
        self.fichier_reglages = donnees / "demandes-reglages.json"
        self.joueurs_lus = joueurs_lus
        self.nettoyer_mot = nettoyer_mot
        self.signaler = signaler
        self.telegram = telegram or tg.Telegram()
        self.lien = lien
        self.branchements: dict[str, Branchement] = {}
        self.vu = None  # l'empreinte des sources au dernier passage
        self.signature = None  # la dernière boîte annoncée aux pages de l'atelier (celle du principal)
        self.signatures: dict[str, str] = {}  # la même, compte par compte
        self.comptes = comptes
        self.connus = connus
        self.fichier_comptes = fichier_comptes
        self.destinataires: dict[str, Callable[[dict, dict], str]] = {}
        self.destinataire_commande: Callable[[dict], str] | None = None
        self.file: asyncio.Queue | None = None
        self.passages = 0  # pour les essais : combien de passages ont vraiment relu

    # ------------------------------------------------------------ branchements et réglages

    def brancher(self, genre: str, **fonctions) -> None:
        if genre not in demandes.GENRES:
            raise ValueError(f"Genre inconnu : {genre}")
        self.branchements[genre] = Branchement(**fonctions)

    def adresser(self, genre: str, fonction: Callable[[dict, dict], str]) -> None:
        """Le MJ à qui revient une demande de ce genre : fonction(joueur, demande) rend son compte. Sans elle, le principal."""
        if genre not in demandes.GENRES:
            raise ValueError(f"Genre inconnu : {genre}")
        self.destinataires[genre] = fonction

    def adresser_commandes(self, fonction: Callable[[dict], str]) -> None:
        """Le MJ à qui revient une commande à l'échoppe : fonction(commande) rend son compte (l'auteur de la boutique)."""
        self.destinataire_commande = fonction

    @staticmethod
    def compte_ou_principal(compte) -> str:
        return compte if isinstance(compte, str) and compte else PRINCIPAL

    def pour_qui(self, j: dict, d: dict, connus: set) -> str:
        """Le MJ à qui revient cette demande. Un mot adressé à un compte inconnu revient au principal ; à un compte fermé, il
        reste à ce compte (le joueur l'a écrit pour lui, l'autre ne le lit pas)."""
        if d["genre"] == confie.GENRE:
            return PRINCIPAL
        if d["genre"] == "message":
            mj = (d.get("corps") or {}).get("mj")
            return mj if isinstance(mj, str) and mj in connus else PRINCIPAL
        f = self.destinataires.get(d["genre"])
        if f is None:
            return PRINCIPAL
        try:
            return self.compte_ou_principal(f(j, d))
        except Exception:
            journal.exception("Destinataire d'une demande %s illisible : au principal", d.get("genre"))
            return PRINCIPAL

    def pour_la_commande(self, c: dict) -> str:
        if self.destinataire_commande is None:
            return PRINCIPAL
        try:
            return self.compte_ou_principal(self.destinataire_commande(c))
        except Exception:
            journal.exception("Destinataire d'une commande illisible : au principal")
            return PRINCIPAL

    @staticmethod
    def a_lui(element: dict, pour) -> bool:
        """Cet élément est-il dans la boîte de ce compte ? pour None : toute la boîte (la surveillance, Telegram). Celui de
        l'autre MJ : noté en veille (rien ne change), retiré en strict."""
        return pour is None or element.get("_pour", PRINCIPAL) == pour or not cloisonnement.refuse("demande-d-un-autre")

    @staticmethod
    def lecteur() -> str:
        """Le MJ qui lit la boîte (la requête) ; une tâche de fond lit pour le principal."""
        return cloisonnement.destinataire()

    def lire_json(self, chemin: Path, defaut):
        try:
            v = stockage.lire_json(chemin)
        except (OSError, ValueError):
            return defaut
        return v if isinstance(v, type(defaut)) else defaut

    def ecrire_json(self, chemin: Path, contenu) -> None:
        chemin.parent.mkdir(parents=True, exist_ok=True)
        stockage.ecrire_json_compact(chemin, contenu)

    def reglages(self) -> dict:
        r = self.lire_json(self.fichier_reglages, {})
        return {"telegram": r.get("telegram") is not False}

    def etat_reglages(self) -> dict:
        return self.reglages() | {"telegram_configure": self.telegram.configure()} | demandes.lire_pause(self.depot)

    # ------------------------------------------------------------ lectures

    def joueurs(self) -> list:
        return [j for j in self.joueurs_lus() if isinstance(j, dict) and isinstance(j.get("id"), str) and demandes.ID_JOUEUR.match(j["id"])]

    def sources(self) -> list:
        """Les fichiers que la boîte lit : les demandes, les commandes et les propositions de héros des joueurs."""
        d = self.depot
        comptes = [self.fichier_comptes] if self.fichier_comptes is not None else []
        return sorted([*(d / demandes.DOSSIER).glob("*.json"), *(d / carnet.COMMANDES).glob("*.json"), *d.glob("*.json"), *comptes])

    @staticmethod
    def garder(chemin: Path, depot: Path) -> bool:
        try:
            relatif = chemin.relative_to(depot)
        except ValueError:
            return False
        parties = relatif.parts
        if len(parties) == 1:
            return not parties[0].startswith(".")
        return len(parties) == 2 and parties[0] in (demandes.DOSSIER, carnet.COMMANDES) and not parties[1].startswith(".")

    def proposition(self, ident: str) -> dict:
        try:
            p = stockage.lire_json((self.depot / f"{ident}.json"))
        except (OSError, ValueError):
            return {}
        return p if isinstance(p, dict) else {}

    def element_demande(self, j: dict, d: dict) -> dict:
        g = demandes.GENRES.get(d["genre"])
        b = self.branchements.get(d["genre"])
        return {"type": "demande", "joueur": j["id"], "joueur_nom": j.get("nom", ""), "id": d["id"], "genre": d["genre"],
                "genre_nom": g.nom if g else "Demande", "statut": d["statut"], "statut_dit": demandes.statut_dit(d),
                "version": d["version"], "cree": d.get("cree"), "modifie": d.get("modifie"), "traitee": d.get("traitee"),
                # Un passage confié au MJ seul ne se lit que sur la fiche du héros, jamais dans la boîte (ni retiré, ni en échec).
                "corps": confie.apres_application(d.get("corps")) if d["genre"] == confie.GENRE else d.get("corps"),
                "resultat": d.get("resultat"), "mot": d.get("mot") or "", "par": d.get("par"),
                "oui": g.oui if g else "Accepter", "non": g.non if g else "Refuser",
                "annulable": bool(g and g.annulable and b and b.annuler and d["statut"] == demandes.APPLIQUEE),
                "phrase": self.phrase(b, j, d)}

    @staticmethod
    def phrase(b: "Branchement | None", j: dict, d: dict) -> str:
        if not (b and b.dire):
            return ""
        try:
            return str(b.dire(j, d) or "")[:400]
        except Exception:
            journal.exception("Ligne de la boîte illisible pour une demande %s", d.get("genre"))
            return ""

    def elements(self, pour=None) -> tuple[list, list]:
        """(ce qui attend le MJ, ce qui a été traité), pour chaque joueur invité. pour : le compte dont c'est la boîte (None :
        toute). Chaque élément porte « _pour », le MJ à qui il revient, que vue() retire."""
        attente, traitees = [], []
        connus = self.connus() if self.connus is not None else {PRINCIPAL}
        for j in self.joueurs():
            for d in demandes.lire(self.depot, j["id"]):
                if not demandes.dans_la_liste(d):
                    continue
                (attente if d["statut"] in demandes.OUVERTS else traitees).append(
                    self.element_demande(j, d) | {"_pour": self.pour_qui(j, d, connus)})
            try:
                commandes = carnet.lire_commandes(self.depot, j["id"])
            except carnet.Refus:
                commandes = []
            for c in commandes:
                if c.get("statut") == "en-attente":
                    lignes = [x for x in c.get("lignes") or [] if isinstance(x, dict)]
                    attente.append({"type": "commande", "joueur": j["id"], "joueur_nom": j.get("nom", ""), "id": c["id"],
                                    "genre": "commande", "genre_nom": "Commande à l'échoppe", "statut": "en-attente",
                                    "cree": c.get("cree"), "boutique_nom": str(c.get("boutique_nom") or ""),
                                    "articles": sum(x.get("quantite", 0) for x in lignes if isinstance(x.get("quantite"), int)),
                                    "total": c.get("total"), "a_fixer": bool(c.get("a_fixer")), "_pour": self.pour_la_commande(c)})
            p = self.proposition(j["id"])
            a = p.get("aventurier") if isinstance(p.get("aventurier"), dict) else {}
            if p.get("envoye") and a and not p.get("accueilli") and not liens_joueurs.heros_relie(j):
                attente.append({"type": "aventurier", "joueur": j["id"], "joueur_nom": j.get("nom", ""),
                                "id": str(p.get("envoye_le") or ""), "genre": "aventurier", "genre_nom": "Aventurier envoyé",
                                "statut": "en-attente", "cree": p.get("envoye_le"), "aventurier": str(a.get("nom") or "")[:120],
                                "retouche": p.get("version_envoyee") != a.get("modifie"), "_pour": PRINCIPAL})
        if pour is not None:
            attente = [x for x in attente if self.a_lui(x, pour)]
            traitees = [x for x in traitees if self.a_lui(x, pour)]
        return attente, traitees

    def tout(self, pour=None) -> tuple[list, list]:
        """(ce qui attend, rangé par joueur puis par genre, le plus ancien d'abord ; tout ce qui a été traité, le plus
        récent d'abord)."""
        attente, traitees = self.elements(pour)
        attente.sort(key=lambda x: (x["joueur_nom"].casefold(), x["genre"], str(x.get("cree") or "")))
        traitees.sort(key=lambda x: str(x.get("traitee") or x.get("modifie") or ""), reverse=True)
        return attente, traitees

    def vue(self, tout: tuple | None = None, pour=None) -> dict:
        """La boîte : ce qui attend, puis l'historique récent. Seul ce qui attend le MJ compte pour la pastille (pas ce
        que l'atelier applique seul). pour : le compte qui la lit, sinon celui de la requête ; Telegram ne concerne que le
        principal."""
        pour = self.lecteur() if pour is None else pour
        attente, traitees = tout or self.tout(pour)
        attente = [{k: v for k, v in x.items() if k != "_pour"} for x in attente]
        traitees = [{k: v for k, v in x.items() if k != "_pour"} for x in traitees[:HISTORIQUE_MAX]]
        compte = sum(1 for x in attente if x["statut"] == "en-attente")
        reglages = self.etat_reglages()
        if pour != PRINCIPAL:
            reglages |= {"telegram": False, "telegram_configure": False}
        return {"compte": compte, "attente": attente, "historique": traitees} | reglages

    def filtrer(self, tout: tuple, pour: str) -> tuple[list, list]:
        return [x for x in tout[0] if self.a_lui(x, pour)], [x for x in tout[1] if self.a_lui(x, pour)]

    def resume(self, v: dict | None = None) -> dict:
        v = v or self.vue()
        signature = hashlib.sha256(json.dumps([v["attente"], v["historique"], v["pause"]], ensure_ascii=False,
                                              sort_keys=True, default=str).encode()).hexdigest()[:20]
        return {"compte": v["compte"], "pause": v["pause"], "signature": signature}

    # ------------------------------------------------------------ appliquer ce qui s'applique seul

    def a_preparer(self, j: dict, d: dict) -> bool:
        b = self.branchements.get(d["genre"])
        if d["statut"] != demandes.EN_ATTENTE or not (b and b.preparer and b.a_preparer):
            return False
        try:
            return bool(b.a_preparer(j, d))
        except Exception:
            journal.exception("Demande %s de %s : impossible de savoir si elle est prête", d["genre"], j["id"])
            return False

    def preparer(self, j: dict, d: dict) -> bool:
        """Sous le verrou : une demande en attente que l'atelier prépare (preparer). Rend vrai si elle a changé."""
        if not self.a_preparer(j, d):
            return False
        g = demandes.GENRES.get(d["genre"])
        try:
            d["corps"] = g.valider(d["corps"])
            self.branchements[d["genre"]].preparer(j, d)
            d.update(version=d["version"] + 1, modifie=demandes.maintenant())
        except demandes.Refus as refus:
            demandes.passer(d, demandes.ECHEC, "atelier", resultat=refus.message)
        except Exception:
            journal.exception("Demande %s de %s non préparée", d["genre"], j["id"])
            demandes.passer(d, demandes.ECHEC, "atelier", resultat="L'atelier n'a pas pu le faire : votre MJ regardera.")
        return True

    def appliquer_tout(self) -> list:
        """Sous le verrou, joueur par joueur : chaque demande « à appliquer » est revalidée puis appliquée, ou passe en
        échec avec sa phrase ; chaque demande en attente que l'atelier prépare l'est (preparer). Rend [(joueur, demande)]
        de ce qui s'est appliqué ou préparé, pour les suites."""
        faites = []
        for j in self.joueurs():
            if not any(d["statut"] == demandes.A_APPLIQUER or self.a_preparer(j, d) for d in demandes.lire(self.depot, j["id"])):
                continue
            with demandes.verrou(self.depot):
                liste = demandes.lire(self.depot, j["id"])
                change = False
                for d in liste:
                    if self.preparer(j, d):
                        faites.append((j, d))
                        change = True
                        continue
                    if d["statut"] != demandes.A_APPLIQUER:
                        continue
                    g = demandes.GENRES.get(d["genre"])
                    b = self.branchements.get(d["genre"])
                    if b is not None and b.reveiller is not None:
                        continue
                    try:
                        if g is None or b is None or b.appliquer is None:
                            raise demandes.Refus(409, "L'atelier ne sait pas encore faire cela : votre MJ s'en occupera.")
                        d["corps"] = g.valider(d["corps"])
                        phrase = b.appliquer(j, d)
                        demandes.passer(d, demandes.APPLIQUEE, "atelier", resultat=phrase or "")
                        faites.append((j, d))
                    except demandes.Refus as refus:
                        demandes.passer(d, demandes.ECHEC, "atelier", resultat=refus.message)
                    except Exception:
                        journal.exception("Demande %s de %s non appliquée", d["genre"], j["id"])
                        demandes.passer(d, demandes.ECHEC, "atelier", resultat="L'atelier n'a pas pu le faire : votre MJ regardera.")
                    change = True
                if change:
                    demandes.ecrire(self.depot, j["id"], liste)
        return faites

    async def suites(self, faites: list) -> None:
        par_genre: dict[str, list] = {}
        for j, d in faites:
            par_genre.setdefault(d["genre"], []).append((j, d))
        for genre, liste in par_genre.items():
            b = self.branchements.get(genre)
            if b and b.apres:
                try:
                    await b.apres(liste)
                except Exception:
                    journal.exception("Suite des demandes %s impossible", genre)

    # ------------------------------------------------------------ prévenir

    @staticmethod
    def cles_presentes(attente: list, traitees: list) -> dict:
        """{clé : (prénom, ce qu'en dit Telegram, faut-il le dire)} de tout ce qui est dans la boîte en ce moment."""
        presentes = {}
        for x in attente + traitees:
            # Telegram ne parle qu'au MJ principal : ce qui revient à l'autre MJ compte pour vu, sans se dire.
            au_principal = x.get("_pour", PRINCIPAL) == PRINCIPAL
            if x["type"] == "demande":
                g = demandes.GENRES.get(x["genre"])
                cle = f"d:{x['joueur']}:{x['id']}"
                # Retirée avant d'avoir été vue, elle ne dérange personne ; appliquée seule (déjà faite quand la boîte la
                # découvre), elle se dit comme les autres, sauf si son genre est silencieux.
                dire = bool(g and not g.silencieux and x["statut"] != demandes.RETIREE and au_principal)
                presentes[cle] = (x["joueur_nom"], ("demande", x["genre"]), dire)
            elif x["type"] == "commande":
                presentes[f"c:{x['joueur']}:{x['id']}"] = (x["joueur_nom"], ("commande", ""), au_principal)
            elif x["type"] == "aventurier":
                presentes[f"h:{x['joueur']}:{x['id']}"] = (x["joueur_nom"], ("aventurier", ""), au_principal)
        return presentes

    def nouveautes(self, tout: tuple) -> list:
        """Ce qui est apparu depuis la dernière fois, à dire au MJ : [(prénom, ce qu'en dit Telegram)]. Les clés vues sont
        gardées sur le disque ; au tout premier passage (aucun fichier), tout ce qui est là compte pour déjà vu."""
        presentes = self.cles_presentes(*tout)
        premier = not self.fichier_vues.exists()
        vues = self.lire_json(self.fichier_vues, {})
        vues = vues.get("cles") if isinstance(vues.get("cles"), dict) else {}
        instant = datetime.now().isoformat(timespec="seconds")
        nouvelles = [(cle, x) for cle, x in presentes.items() if cle not in vues]
        if not nouvelles and not premier:
            return []
        oubli = (datetime.now() - timedelta(days=VUES_JOURS)).isoformat(timespec="seconds")
        vues = {cle: quand for cle, quand in vues.items() if cle in presentes or str(quand) >= oubli}
        vues.update({cle: instant for cle, _ in nouvelles})
        if len(vues) > VUES_MAX:
            vues = dict(sorted(vues.items(), key=lambda kv: str(kv[1]))[-VUES_MAX:])
        self.ecrire_json(self.fichier_vues, {"cles": vues})
        if premier:
            return []
        comptes: dict[tuple, int] = {}
        ordre = []
        for _, (nom, quoi, dire) in nouvelles:
            if dire:
                k = (nom, quoi)
                if k not in comptes:
                    ordre.append(k)
                comptes[k] = comptes.get(k, 0) + 1
        sortie = []
        for nom, (genre, cle) in ordre:
            n = comptes[(nom, (genre, cle))]
            formes = (demandes.GENRES[cle].telegram if genre == "demande" and cle in demandes.GENRES
                      else TELEGRAM_COMMANDE if genre == "commande" else TELEGRAM_AVENTURIER if genre == "aventurier" else ("une demande", "{n} demandes"))
            sortie.append((nom, dit(formes, n)))
        return sortie

    async def annoncer(self) -> None:
        """Recompte la boîte, prévient les pages de l'atelier si elle a changé, met en file ce qui est à notifier. Avec
        deux MJ, chacun sa boîte : seules ses pages sont prévenues, de ce qui a changé dans la sienne."""
        tout = self.tout()
        if self.comptes is None:
            r = self.resume(self.vue(tout, pour=PRINCIPAL))
            if r["signature"] != self.signature:
                self.signature = r["signature"]
                try:
                    await self.signaler({"type": "demandes", **r})
                except Exception:
                    journal.exception("Pages de l'atelier non prévenues")
        else:
            comptes = self.comptes()
            for c in comptes:
                r = self.resume(self.vue(self.filtrer(tout, c["id"]), pour=c["id"]))
                if c["id"] == PRINCIPAL:
                    self.signature = r["signature"]
                if r["signature"] == self.signatures.get(c["id"]):
                    continue
                self.signatures[c["id"]] = r["signature"]
                try:
                    await self.signaler({"type": "demandes", **r}, c["id"])
                except Exception:
                    journal.exception("Pages de l'atelier non prévenues")
            try:
                await asyncio.to_thread(demandes.ecrire_destinataires, self.depot, comptes)
            except OSError:
                journal.exception("Liste des MJ non publiée pour le coin")
        vague = self.nouveautes(tout)
        if vague and self.reglages()["telegram"] and self.telegram.configure() and self.file is not None:
            try:
                self.file.put_nowait(tg.message(vague, self.lien))
            except asyncio.QueueFull:
                pass

    async def passage(self) -> None:
        """Une vague : rien si les fichiers n'ont pas bougé depuis le passage précédent. L'empreinte est prise avant de
        relire : ce qui change pendant le passage (le coin qui écrit) donnera le suivant."""
        empreinte = veille.empreinte(self.sources())
        if empreinte == self.vu:
            return
        self.vu = empreinte
        self.passages += 1
        try:
            faites = self.appliquer_tout()
            await self.suites(faites)
            await self.annoncer()
            for b in self.branchements.values():
                if b.reveiller is not None:
                    b.reveiller()
        except Exception:
            # Raté (un fichier pris, un disque plein) : la relecture de secours refera tout le passage.
            self.vu = None
            raise

    async def notifier(self) -> None:
        while True:
            texte = await self.file.get()
            await asyncio.to_thread(self.telegram.envoyer, texte)

    async def surveiller(self) -> None:
        """La tâche de fond du cycle de l'atelier."""
        self.file = asyncio.Queue(maxsize=20)
        self.vu = self.signature = None
        self.signatures = {}
        # Les dossiers que le coin remplit existent d'avance : créé par lui à la première demande (ou commande), un dossier
        # neuf échapperait aux notifications le temps que la surveillance le découvre, et la demande attendrait la relecture
        # de secours (30 s).
        for dossier in (demandes.DOSSIER, carnet.COMMANDES):
            try:
                (self.depot / dossier).mkdir(parents=True, exist_ok=True)
            except OSError:
                journal.warning("Dossier %s des propositions impossible à créer", dossier)
        envoi = asyncio.create_task(self.notifier())
        try:
            try:
                await self.passage()
            except Exception:
                journal.exception("Demandes des joueurs : premier passage impossible")
            await veille.veiller(self.depot, lambda p: self.garder(p, self.depot), self.passage, regroupement=REGROUPEMENT,
                                 secours=SECOURS, nom="Demandes des joueurs")
        finally:
            envoi.cancel()
            self.file = None

    # ------------------------------------------------------------ les gestes du MJ

    def joueur(self, ident: str) -> dict:
        j = next((x for x in self.joueurs() if x["id"] == ident), None)
        if not j:
            raise demandes.Refus(404, "Joueur inconnu.")
        return j

    def trancher(self, joueur: str, ident: str, statut: str, version, mot: str) -> dict:
        """Accepter, refuser ou annuler, d'un bloc et sous le verrou : la version lue par l'écran du MJ doit être celle du
        fichier, sinon un autre écran (ou le joueur) est passé avant. Rien ne s'écrit si quoi que ce soit échoue."""
        j = self.joueur(joueur)
        if isinstance(version, bool) or not isinstance(version, int):
            raise demandes.Refus(400, "La version de la demande manque : relisez la boîte.")
        propre = self.nettoyer_mot(mot) if mot else ""
        with demandes.verrou(self.depot):
            liste = demandes.lire(self.depot, joueur)
            d = demandes.trouver(liste, ident)
            # Celle de l'autre MJ : comme une demande qui n'existe pas (notée en veille, refusée en strict).
            connus = self.connus() if self.connus is not None else {PRINCIPAL}
            if d is None or not self.a_lui({"_pour": self.pour_qui(j, d, connus)}, self.lecteur()):
                raise demandes.Refus(404, "Cette demande n'existe plus.")
            g = demandes.GENRES.get(d["genre"])
            b = self.branchements.get(d["genre"]) or Branchement()
            demandes.verifier(d, statut, "mj", version=version)
            resultat = None
            if statut == demandes.REFUSEE and g is not None and g.non is None:
                raise demandes.Refus(400, f"« {g.nom} » ne se refuse pas : répondez-y d'un mot.")
            if statut == demandes.ACCEPTEE:
                if g is None:
                    raise demandes.Refus(409, "Ce genre de demande est inconnu de l'atelier.")
                d["corps"] = g.valider(d["corps"])
                if b.accepter:
                    resultat = b.accepter(j, d, propre)
            if statut == demandes.ANNULEE:
                if not (g and g.annulable and b.annuler):
                    raise demandes.Refus(400, "Cette demande ne s'annule pas depuis la boîte.")
                resultat = b.annuler(j, d)
            demandes.passer(d, statut, "mj", version=version, mot=propre, resultat=resultat)
            demandes.ecrire(self.depot, joueur, liste)
        return self.element_demande(j, d)

    # ------------------------------------------------------------ les routes

    def routes(self, corps_objet) -> APIRouter:
        """Hors de /api/table/… : la garde de main.py les ferme à la table publique, et à Internet sans session."""
        r = APIRouter()

        @r.get("/api/demandes")
        async def boite_des_demandes():
            return await asyncio.to_thread(self.vue)

        @r.get("/api/demandes/resume")
        async def resume_des_demandes():
            # La boîte du MJ qui lit : le fil copie le lecteur de la requête (asyncio.to_thread).
            return await asyncio.to_thread(self.resume)

        async def geste(joueur: str, ident: str, statut: str, requete: Request):
            corps = await corps_objet(requete)
            mot = corps.get("mot", "")
            if mot is None:
                mot = ""
            if not isinstance(mot, str):
                raise HTTPException(400, "Le mot doit être un texte.")
            try:
                element = await asyncio.to_thread(self.trancher, joueur, ident, statut, corps.get("version"), mot)
            except demandes.Refus as refus:
                raise refus_http(refus)
            # Accepter ou annuler a pu changer l'atelier (un sac, une bourse) : la suite du genre, comme après une vague.
            if statut in (demandes.ACCEPTEE, demandes.ANNULEE):
                await self.suites([({"id": joueur, "nom": element.get("joueur_nom", "")}, element)])
            await self.annoncer()
            return element

        @r.post("/api/demandes/{joueur}/{ident}/accepter")
        async def accepter_demande(joueur: str, ident: str, requete: Request):
            return await geste(joueur, ident, demandes.ACCEPTEE, requete)

        @r.post("/api/demandes/{joueur}/{ident}/refuser")
        async def refuser_demande(joueur: str, ident: str, requete: Request):
            return await geste(joueur, ident, demandes.REFUSEE, requete)

        @r.post("/api/demandes/{joueur}/{ident}/annuler")
        async def annuler_demande(joueur: str, ident: str, requete: Request):
            return await geste(joueur, ident, demandes.ANNULEE, requete)

        @r.get("/api/demandes/reglages")
        def lire_reglages():
            return self.etat_reglages()

        @r.put("/api/demandes/reglages")
        async def changer_reglages(requete: Request):
            """{"telegram": oui ou non} : « Me prévenir sur Telegram » ; {"pause": oui ou non} : « Coin en pause »."""
            corps = await corps_objet(requete)
            if not corps or set(corps) - {"telegram", "pause"} or any(not isinstance(v, bool) for v in corps.values()):
                raise HTTPException(400, "Réglages attendus : « telegram » et « pause », vrai ou faux.")
            if "telegram" in corps:
                self.ecrire_json(self.fichier_reglages, {"telegram": corps["telegram"], "modifie": demandes.maintenant()})
            if "pause" in corps:
                await asyncio.to_thread(demandes.ecrire_pause, self.depot, corps["pause"])
            await self.annoncer()
            return self.etat_reglages()

        return r
