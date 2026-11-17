"""La rédaction par l'API pour chaque MJ (deuxième accès MJ, lot MJ-5) : à qui est chaque appel, ce qu'il coûte à chacun
ce mois-ci, et la garde qui refuse, avant l'appel, ce que le budget d'un MJ invité ne permet plus.

- Chaque appel est noté au journal des coûts (redaction.py) pour le MJ de la requête : « qui » vaut « mj:<compte> ». Le
  joueur pour qui part l'aide à l'écriture garde son identifiant (aide_mj.py, ses quotas à part). Une ligne sans « qui »
  est au compte principal : le journal d'avant ce lot, une tâche de fond.
- Le compte principal n'a pas de budget. Un invité a celui de son compte (« budget_mois » de comptes_mj.py, 3 $
  par mois par défaut, réglé par le MJ principal dans « Les MJ »). Ce qu'il a dépensé ce mois-ci, ses lots pas encore relevés et
  ses appels en cours, plus le prix minimal de l'appel (redaction.plancher), ne doivent pas le dépasser ; sinon l'appel
  ne part pas (redaction.BudgetAtteint), avec un message qui dit où il en est et quand le budget revient.
- Chacun lit ses coûts, ses estimations (d'après ses seules lignes : son contexte et son cache sont les siens) et ses
  lots. Le MJ principal lit en plus le total du mois et la part de chaque invité, jamais le détail de ses appels. Telegram n'en
  dit rien.
"""
import asyncio
import threading
from datetime import date, datetime

from fastapi import APIRouter, HTTPException, Request

from mj import cloisonnement
from commun import comptes
from mj import comptes_mj
from mj import proprietes
from ia import redaction
from mj.proprietes import PRINCIPAL

PREFIXE = redaction.PREFIXE_MJ
BUDGET_MAX = 100.0  # dollars par mois : au-delà, une faute de frappe
MOIS = ("janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre")


def qui_de(compte: str) -> str:
    return f"{PREFIXE}{compte}"


def mj_de(ligne) -> str | None:
    """Le MJ d'une ligne du journal (ou d'un lot) : le compte de « mj:<compte> », le principal sans « qui » ; None pour
    un joueur (l'aide à l'écriture)."""
    q = ligne.get("qui") if isinstance(ligne, dict) else None
    if not isinstance(q, str) or not q:
        return PRINCIPAL
    if q.startswith(PREFIXE):
        return q[len(PREFIXE):] or PRINCIPAL
    return None


def garder_pour(compte: str):
    """Les lignes que lit ce MJ : les siennes ; pour le principal, toutes sauf celles des autres MJ (les joueurs compris,
    comme avant ce lot : sans invité, rien ne change pour le MJ principal)."""
    if compte == PRINCIPAL:
        return lambda ligne: mj_de(ligne) in (PRINCIPAL, None)
    return lambda ligne: mj_de(ligne) == compte


def qui_courant() -> str | None:
    """Le MJ de la requête en cours (cloisonnement.py) ; None hors d'une requête (une tâche de fond donne le sien)."""
    l = cloisonnement.lecteur()
    return qui_de(l) if cloisonnement.est_compte(l) else None


def budget_valide(valeur) -> float:
    if isinstance(valeur, (int, float)) and not isinstance(valeur, bool) and 0 <= valeur <= BUDGET_MAX:
        return float(valeur)
    return comptes_mj.BUDGET_DEFAUT


def dollars(x: float) -> str:
    return f"{x:.2f}".replace(".", ",") + " $"


def mois_courant() -> str:
    return datetime.now().strftime("%Y-%m")


def retour_du_budget(jour: date | None = None) -> str:
    """« 1er décembre » : le jour où le budget du mois revient."""
    jour = jour or date.today()
    return f"1er {MOIS[jour.month % 12]}"


class Budgets:
    """Les budgets des MJ invités, lus dans comptes.json à chaque appel, et ce que chacun a en cours."""

    def __init__(self, donnees):
        self.donnees = donnees
        self.reserves: dict[str, float] = {}
        self.verrou = threading.Lock()

    # ------------------------------------------------------------ comptes et dépenses

    def comptes(self) -> list | None:
        try:
            return comptes_mj.lire(self.donnees)["comptes"]
        except comptes_mj.Illisible:
            return None

    def invites(self) -> list:
        return [c for c in self.comptes() or [] if c.get("role") == "invite"]

    def nom_du_principal(self) -> str:
        p = next((c for c in self.comptes() or [] if c.get("role") == "principal"), None)
        return str(p.get("nom") or proprietes.NOM_PRINCIPAL) if p else proprietes.NOM_PRINCIPAL

    def budget_de(self, compte: str) -> float | None:
        """Le budget du mois d'un MJ ; None pour le principal. Un compte inconnu ou un fichier illisible : 0, rien ne part."""
        if compte == PRINCIPAL:
            return None
        cs = self.comptes()
        c = next((c for c in cs or [] if c.get("id") == compte), None)
        return 0.0 if c is None else budget_valide(c.get("budget_mois"))

    def depense(self, compte: str, mois: str | None = None) -> float:
        """Ce que ce MJ a dépensé ce mois-ci d'après le journal, plus le prix minimal de ses lots pas encore relevés (leur
        coût ne sera noté qu'au relevé)."""
        mois, q = mois or mois_courant(), qui_de(compte)
        total = sum(float(l.get("cout") or 0) for l in redaction.lignes_journal()
                    if l.get("qui") == q and str(l.get("date", "")).startswith(mois))
        total += sum(float(e.get("plancher") or 0) for e in redaction.lots()
                     if isinstance(e, dict) and e.get("etat") == "en-cours" and e.get("qui") == q)
        return round(total, 5)

    def etat(self, compte: str, mois: str | None = None) -> dict | None:
        """Où en est le budget d'un invité : {budget, depense, reste, atteint, revient} ; None pour le principal."""
        b = self.budget_de(compte)
        if b is None:
            return None
        d = self.depense(compte, mois)
        return {"budget": round(b, 2), "depense": round(d, 4), "reste": round(max(0.0, b - d), 4), "atteint": d >= b,
                "revient": retour_du_budget()}

    # ------------------------------------------------------------ la garde, avant chaque appel

    def message_atteint(self, engage: float, budget: float) -> str:
        return (f"Budget de rédaction du mois atteint : {dollars(engage)} sur {dollars(budget)}. Il revient le "
                f"{retour_du_budget()} ; {self.nom_du_principal()} peut le relever d'ici là.")

    def cache_chaud(self, compte: str, appel: dict) -> bool:
        """Le contexte de cet appel est-il encore en cache, d'après les derniers appels de ce MJ (chacun a le sien) ?"""
        if appel.get("lot"):
            return False
        marque = 0
        jetons = 0
        for bloc in appel.get("systeme") or []:
            jetons += redaction.jetons_de(bloc)
            if isinstance(bloc, dict) and bloc.get("cache_control"):
                marque = jetons
        if not marque:
            return False
        bible = marque >= redaction.SEUIL_BIBLE
        garder, maintenant = garder_pour(compte), datetime.now()
        for ligne in reversed(redaction.lignes_journal()):
            if ligne.get("lot") or not garder(ligne):
                continue
            famille = redaction.famille(ligne)
            if famille == "aucun" or (bible and famille != "bible"):
                continue
            quand = redaction._date(ligne)
            return quand is not None and (maintenant - quand).total_seconds() < redaction.GARDE_CACHE
        return False

    def garde(self, appel: dict):
        """Avant un appel (redaction.regler_garde) : rien pour le principal, un joueur ou une tâche de fond ; pour un invité,
        BudgetAtteint si son budget ne permet plus cet appel, sinon de quoi libérer ce qui est réservé pour lui."""
        q = appel.get("qui")
        if not isinstance(q, str) or not q.startswith(PREFIXE):
            return None
        compte = q[len(PREFIXE):]
        budget = self.budget_de(compte)
        if budget is None:
            return None
        prix = redaction.plancher(appel.get("systeme") or [], appel.get("contenu"), appel.get("modele"), bool(appel.get("lot")),
                                  en_cache=self.cache_chaud(compte, appel))
        with self.verrou:
            engage = self.depense(compte) + self.reserves.get(compte, 0.0)
            if engage >= budget:
                raise redaction.BudgetAtteint(self.message_atteint(engage, budget))
            if engage + prix > budget:
                raise redaction.BudgetAtteint(
                    f"Cette demande coûterait au moins {dollars(prix)}, et il reste {dollars(budget - engage)} de budget de "
                    f"rédaction ce mois-ci (sur {dollars(budget)}). Une demande plus courte passera peut-être ; sinon, il "
                    f"revient le {retour_du_budget()}.")
            self.reserves[compte] = self.reserves.get(compte, 0.0) + prix

        def liberer():
            with self.verrou:
                reste = self.reserves.get(compte, 0.0) - prix
                if reste > 1e-9:
                    self.reserves[compte] = reste
                else:
                    self.reserves.pop(compte, None)
        return liberer

    def exiger(self) -> None:
        """Avant une rédaction en flux : un invité dont le budget du mois est déjà atteint reçoit 402 tout de suite (le prix
        de l'appel lui-même se vérifie juste avant qu'il parte)."""
        l = cloisonnement.lecteur()
        if not cloisonnement.est_invite(l):
            return
        e = self.etat(l)
        if e and e["atteint"]:
            raise HTTPException(402, self.message_atteint(e["depense"], e["budget"]))

    # ------------------------------------------------------------ ce que lit chaque MJ

    def couts(self, mois: str | None = None) -> dict:
        """/api/ia/couts : un invité, ses seuls appels et son budget ; le MJ principal, ses appels et ceux faits pour les joueurs,
        plus, dès qu'un invité existe, le total du mois et la part de chaque invité (sans le détail de ses appels)."""
        lecteur = cloisonnement.lecteur()
        if cloisonnement.est_invite(lecteur) and cloisonnement.refuse("couts-d-un-autre"):
            vue = redaction.couts(mois, garder=garder_pour(lecteur))
            return vue | {"budget": self.etat(lecteur, vue["mois"])}
        mois = mois or mois_courant()
        lignes = [l for l in redaction.lignes_journal() if str(l.get("date", "")).startswith(mois)]
        autres = [l for l in lignes if mj_de(l) not in (PRINCIPAL, None)]
        invites = self.invites()
        if not invites and not autres:
            return redaction.couts(mois)
        vue = redaction.couts(mois, garder=garder_pour(PRINCIPAL))
        parts: dict[str, dict] = {}
        for l in autres:
            p = parts.setdefault(mj_de(l), {"appels": 0, "cout": 0.0})
            p["appels"] += 1
            p["cout"] += float(l.get("cout") or 0)
        noms = {c["id"]: c.get("nom") or c["id"] for c in invites}
        mj = []
        for compte in [*noms, *sorted(set(parts) - set(noms))]:
            p = parts.get(compte, {"appels": 0, "cout": 0.0})
            mj.append({"compte": compte, "nom": str(noms.get(compte, compte)), "appels": p["appels"],
                       "cout": round(p["cout"], 4), "budget": self.etat(compte, mois)})
        vue["total"] = round(sum(float(l.get("cout") or 0) for l in lignes), 4)
        vue["appels"] = len(lignes)
        vue["mj"] = mj
        return vue

    def estimations(self) -> dict:
        """/api/ia/estimations : d'après les seuls appels du MJ qui lit (son cache n'est pas celui de l'autre) ; un invité
        y lit aussi son budget, pour que ses boutons le disent."""
        lecteur = cloisonnement.lecteur()
        if cloisonnement.est_invite(lecteur) and cloisonnement.refuse("couts-d-un-autre"):
            return redaction.estimations(garder=garder_pour(lecteur)) | {"budget": self.etat(lecteur)}
        return redaction.estimations(garder=garder_pour(PRINCIPAL))

    def lot_au_lecteur(self, lot) -> bool:
        """Un lot lancé par le MJ qui lit (sans « qui » : au principal, comme avant ce lot)."""
        return mj_de(lot) == cloisonnement.destinataire() or not cloisonnement.refuse("lot-d-un-autre")


def routes(budgets: Budgets, corps_objet) -> APIRouter:
    r = APIRouter()

    @r.put("/api/mj/comptes/{ident}/budget")
    async def regler_budget(ident: str, requete: Request):
        """Le budget de rédaction du mois d'un MJ invité, réglé par le MJ principal dans « Les MJ »."""
        # Comme une route qui n'existe pas : l'invité n'apprend rien de la gestion des comptes.
        if proprietes.compte_courant() != PRINCIPAL:
            raise HTTPException(404, "Introuvable")
        valeur = (await corps_objet(requete)).get("budget_mois")
        if not isinstance(valeur, (int, float)) or isinstance(valeur, bool) or not 0 <= valeur <= BUDGET_MAX:
            raise HTTPException(400, f"Un budget entre 0 et {BUDGET_MAX:g} $ par mois, s'il vous plaît.")
        try:
            c = await asyncio.to_thread(comptes_mj.regler_budget, budgets.donnees, ident, round(float(valeur), 2))
        except comptes.Refus as refus:
            raise HTTPException(refus.statut, refus.message)
        except comptes_mj.Illisible:
            raise HTTPException(503, "Les comptes des MJ ne se lisent pas.")
        return {"compte": c["id"], "budget_mois": c["budget_mois"], "budget": budgets.etat(c["id"])}

    return r
