"""La télécommande du MJ (static/telecommande.html) : un téléphone en main, le MJ pilote la TV, le combat et le journal
par les routes de l'atelier. Trois gestes ne partent pas du téléphone seul : la musique joue dans le navigateur du Mac,
une étape du feu se rappelle par l'éditeur qui tient le plan (sinon son prochain enregistrement tomberait en conflit),
et la scène suivante se joue sur l'ordinateur, avec son ambiance, par la page Séances quand elle tient la séance. Ils passent
par ce relais : chaque écran de l'atelier (js/ecran-tv/relais-telecommande.js) le relève toutes les trois secondes en disant ce
qu'il joue et quel plan il tient ; chaque commande, numérotée, n'est confiée qu'à un seul écran, qui ne l'applique
qu'une fois et rend son résultat au téléphone.

Tout vit en mémoire : un redémarrage n'oublie que des commandes de toute façon périmées. Fonctions pures, l'heure en
argument : main.py sert les routes."""

import itertools
import math
import re
import time

ECRAN_VALIDE = re.compile(r"^[a-z0-9]{8,32}$")
# Le jeton d'un geste du téléphone : renvoyé après une réponse perdue, il ne crée pas une seconde commande.
JETON_VALIDE = re.compile(r"^[a-z0-9]{8,32}$")
AMBIANCE_VALIDE = re.compile(r"^[a-z0-9-]{1,40}$")
PLAN_VALIDE = re.compile(r"^[a-z0-9-]{1,60}$")
ACTIONS_MUSIQUE = ("pause", "reprendre", "morceau", "choisir")
PERIODE_ACTIVE = 3000  # millisecondes
PERIODE_AU_REPOS = 10000
VIVANT = 20  # secondes : un écran qui n'a rien relevé depuis est fermé ou endormi
ATTENTE = 45  # secondes : une commande qu'aucun écran n'a prise est périmée
OUBLI = 3600  # secondes : un écran parti depuis une heure sort de la liste
ECRANS_MAX = 20
COMMANDES_MAX = 60
EN_ATTENTE_MAX = 12
TOUCHE_MAX = 7 * 86400
MESSAGE_MAX = 200


class Refus(ValueError):
    """Une commande qu'aucun écran ne peut prendre maintenant : son message est dit au MJ."""


def chaine(valeur, longueur: int) -> str:
    return " ".join(valeur.split())[:longueur] if isinstance(valeur, str) else ""


def secondes(valeur) -> float | None:
    if isinstance(valeur, bool) or not isinstance(valeur, (int, float)) or not math.isfinite(valeur):
        return None
    return min(TOUCHE_MAX, max(0.0, float(valeur)))


def musique_lue(m) -> dict | None:
    """Ce qu'un écran dit de sa musique, borné champ par champ ; None : son lecteur n'est pas prêt."""
    if not isinstance(m, dict):
        return None
    courante = m.get("courante")
    courante = courante if isinstance(courante, str) and AMBIANCE_VALIDE.match(courante) else None
    ici = courante is not None
    return {"courante": courante, "nom": chaine(m.get("nom"), 60) if ici else "", "titre": chaine(m.get("titre"), 200) if ici else "",
            "enPause": ici and m.get("enPause") is True, "liste": ici and m.get("liste") is True,
            "joue": ici and m.get("joue") is True, "attenteGeste": m.get("attenteGeste") is True}


class Relais:
    def __init__(self):
        self.ecrans: dict[str, dict] = {}
        self.commandes: list[dict] = []
        self.dernier_lecteur = ""
        # Le dernier signe d'un téléphone (il lit l'état ou envoie une commande) : sans lui, les écrans de l'atelier relèvent
        # au ralenti (periode_de_releve).
        self.telephone = -math.inf
        # Des numéros qui ne reviennent pas après un redémarrage (ils partent de l'heure, à la milliseconde) : un écran ne
        # confond jamais une nouvelle commande avec une qu'il a déjà appliquée.
        self.numeros = itertools.count(int(time.time() * 1000))

    def signe_du_telephone(self, instant: float) -> None:
        self.telephone = instant

    def periode_de_releve(self, instant: float) -> int:
        """Dans combien de millisecondes un écran de l'atelier relève à nouveau : vite (3 s) tant qu'un téléphone a donné signe
        de vie depuis une minute ou qu'une commande attend, lentement (10 s, moins que VIVANT) quand personne n'écoute : la
        radio d'un ordinateur portable ou d'une tablette ne se réveille plus toutes les trois secondes pour rien."""
        actif = instant - self.telephone < 60 or any(c["etat"] in ("attente", "prise") for c in self.commandes)
        return PERIODE_ACTIVE if actif else PERIODE_AU_REPOS

    def vivants(self, instant: float) -> list[dict]:
        return [e for e in self.ecrans.values() if instant - e["vu"] < VIVANT]

    @staticmethod
    def recence(e: dict, instant: float) -> float:
        """Secondes depuis le dernier geste du MJ sur cet écran (l'infini : jamais touché)."""
        return e["touche"] + (instant - e["vu"]) if e["touche"] is not None else math.inf

    def lecteur(self, instant: float) -> dict | None:
        """L'écran qui joue la musique : celui dont le lecteur tient une ambiance, sinon le dernier qui en a joué une,
        sinon le dernier touché (un navigateur ne lance le son qu'après un geste sur la page)."""
        vivants = self.vivants(instant)
        plus_recent = lambda liste: min(liste, key=lambda e: self.recence(e, instant))  # noqa: E731
        en_musique = [e for e in vivants if e["musique"] and e["musique"]["courante"]]
        if en_musique:
            return plus_recent(en_musique)
        dernier = next((e for e in vivants if e["id"] == self.dernier_lecteur), None)
        if dernier:
            return dernier
        prets = [e for e in vivants if e["musique"] is not None] or vivants
        touches = [e for e in prets if e["geste"]] or prets
        return plus_recent(touches) if touches else None

    def cible(self, c: dict, instant: float) -> str | None:
        """L'écran à qui revient une commande maintenant : pour une étape, l'éditeur qui tient ce plan ; pour la
        musique et la scène suivante (son ambiance joue là où joue la musique), le lecteur."""
        if c["genre"] == "etape":
            tenants = [e for e in self.vivants(instant) if e["plan"] == c["plan"]]
            return min(tenants, key=lambda e: self.recence(e, instant))["id"] if tenants else None
        e = self.lecteur(instant)
        return e["id"] if e else None

    def nettoyer(self, instant: float) -> None:
        for c in self.commandes:
            if c["etat"] == "attente" and instant - c["cree"] > ATTENTE:
                c["etat"] = "perimee"
        for ident in [i for i, e in self.ecrans.items() if instant - e["vu"] > OUBLI]:
            del self.ecrans[ident]

    def trouver(self, numero: int) -> dict | None:
        return next((c for c in self.commandes if c["numero"] == numero), None)

    @staticmethod
    def publique(c: dict) -> dict:
        # libre : l'écran n'a pas pris la commande (le plan n'y est plus ouvert), le téléphone peut faire le geste lui-même.
        return {"numero": c["numero"], "genre": c["genre"], "etat": c["etat"], "message": c["message"], "libre": c.get("libre", False)}

    def ajouter(self, commande: dict, instant: float) -> dict | None:
        """Numérote et garde une commande déjà vérifiée par main.py. Refus quand aucun écran ne peut la prendre ; None
        pour une étape dont aucun éditeur ne tient le plan, ou une scène sans atelier ouvert (le téléphone fait alors le
        geste lui-même)."""
        self.nettoyer(instant)
        jeton = commande.get("jeton")
        deja = next((c for c in self.commandes if jeton and c.get("jeton") == jeton), None)
        if deja:
            return self.publique(deja)
        if sum(c["etat"] == "attente" for c in self.commandes) >= EN_ATTENTE_MAX:
            raise Refus("Trop de commandes attendent déjà l'atelier : patientez quelques secondes.")
        if commande["genre"] == "musique":
            lecteur = self.lecteur(instant)
            if not lecteur:
                raise Refus("Aucun atelier ouvert pour jouer la musique : ouvrez l'atelier sur l'ordinateur.")
            if commande["action"] != "choisir" and not (lecteur["musique"] and lecteur["musique"]["courante"]):
                raise Refus("Aucune musique ne joue sur l'atelier.")
        elif not self.cible(commande, instant):
            return None
        c = {**commande, "numero": next(self.numeros), "etat": "attente", "pour": "", "cree": instant, "message": ""}
        self.commandes.append(c)
        del self.commandes[:-COMMANDES_MAX]
        return self.publique(c)

    def releve(self, ident: str, etat: dict, instant: float) -> list[dict]:
        """Un écran de l'atelier se signale. Il reçoit les commandes qui lui reviennent maintenant, et celles déjà prises
        par lui dont il n'a pas rendu le résultat : sa réponse a pu se perdre, il les reconnaît à leur numéro."""
        self.nettoyer(instant)
        e = self.ecrans.get(ident)
        if e is None:
            if len(self.ecrans) >= ECRANS_MAX:
                del self.ecrans[min(self.ecrans.values(), key=lambda x: x["vu"])["id"]]
            e = self.ecrans[ident] = {"id": ident}
        plan = etat.get("plan")
        e.update(vu=instant, musique=musique_lue(etat.get("musique")), touche=secondes(etat.get("touche")),
                 plan=plan if isinstance(plan, str) and PLAN_VALIDE.match(plan) else None, geste=etat.get("geste") is True)
        if e["musique"] and e["musique"]["courante"]:
            self.dernier_lecteur = ident
        rendues = []
        for c in self.commandes:
            if c["etat"] == "attente" and self.cible(c, instant) == ident:
                c.update(etat="prise", pour=ident)
            if c["etat"] == "prise" and c["pour"] == ident:
                rendues.append({k: c[k] for k in ("numero", "genre", "action", "ambiance", "plan", "etape", "seance", "de", "vers", "titre")
                                if k in c})
        return rendues

    def resultat(self, ident: str, numero: int, ok: bool, message, instant: float, libre: bool = False) -> bool:
        """Le résultat rendu par l'écran qui tient la commande ; ignoré de tout autre écran, ou rendu deux fois."""
        c = self.trouver(numero)
        if not c or c["pour"] != ident or c["etat"] != "prise":
            return False
        c.update(etat="faite" if ok else "echec", message=chaine(message, MESSAGE_MAX), libre=libre and not ok)
        return True

    def annuler(self, numero: int, instant: float) -> bool:
        """Le téléphone renonce à une commande qu'aucun écran n'a encore prise (vrai), sinon elle suit son cours."""
        self.nettoyer(instant)
        c = self.trouver(numero)
        if not c or c["etat"] != "attente":
            return False
        c["etat"] = "annulee"
        return True

    def lire(self, numero: int, instant: float) -> dict | None:
        self.nettoyer(instant)
        c = self.trouver(numero)
        return self.publique(c) if c else None

    def adieu(self, ident: str) -> None:
        """Un écran se ferme : ce qu'il tenait sans l'avoir fini est dit perdu, et rien ne lui sera plus confié."""
        self.ecrans.pop(ident, None)
        for c in self.commandes:
            if c["pour"] == ident and c["etat"] == "prise":
                c.update(etat="echec", message="l'atelier s'est fermé avant de répondre")

    def etat(self, instant: float) -> dict:
        """Pour le téléphone : combien d'écrans de l'atelier sont ouverts, ce que joue le lecteur, les plans tenus."""
        self.nettoyer(instant)
        vivants = self.vivants(instant)
        lecteur = self.lecteur(instant)
        return {"ecrans": len(vivants), "musique": lecteur["musique"] if lecteur else None,
                "plans": sorted({e["plan"] for e in vivants if e["plan"]})}
