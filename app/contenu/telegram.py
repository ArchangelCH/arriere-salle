"""Les notifications Telegram du MJ : « Camille : un mot pour toi. Sacha : commande à l'échoppe. », avec le lien de la
boîte des demandes. Utilisé par l'atelier seul (le coin des joueurs n'a pas Internet).

Au mieux : jamais d'exception, un délai court, 12 messages par heure au plus, un seul message par vague. Le message ne
porte que le prénom du joueur tel que le MJ l'a tapé et le genre de la demande, échappés pour le HTML de Telegram :
jamais un nom de héros, jamais un texte de joueur.

Le jeton et le chat viennent de l'environnement (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID : secrets/telegram.env,
passé au seul service de l'atelier). Sans eux, rien ne part, en silence. Le jeton fait partie de l'adresse de l'API :
il n'apparaît jamais dans un journal (urllib ne journalise rien, et le journal d'httpx, qui écrit les adresses au
niveau INFO, est relevé à WARNING par prudence).
"""
import json
import logging
import os
import threading
import time
import unicodedata
from collections import deque
from html import escape
from urllib.parse import urlencode
from urllib.request import Request, urlopen

journal = logging.getLogger("atelier.telegram")
logging.getLogger("httpx").setLevel(logging.WARNING)

PLAFOND = 12  # messages par heure
DELAI = 4  # secondes pour joindre l'API
TEXTE_MAX = 1500
PRENOM_MAX = 40


def prenom(nom) -> str:
    """Le prénom du joueur tel que le MJ l'a tapé, sur une ligne, sans caractère de contrôle, borné."""
    t = "".join(c for c in str(nom or "") if unicodedata.category(c)[0] != "C")
    return " ".join(t.split())[:PRENOM_MAX] or "Un joueur"


def message(vague: list, lien: str = "") -> str:
    """Le message d'une vague : [(prénom, genre dit)], groupés par joueur dans l'ordre d'arrivée, en HTML échappé."""
    par_joueur: dict[str, list[str]] = {}
    for nom, quoi in vague:
        par_joueur.setdefault(prenom(nom), [])
        if quoi not in par_joueur[prenom(nom)]:
            par_joueur[prenom(nom)].append(quoi)
    # Le HTML de Telegram n'attend que <, > et & échappés, hors des attributs : les apostrophes restent lisibles.
    lignes = [f"<b>{escape(nom, quote=False)}</b> : {escape(', '.join(quoi), quote=False)}." for nom, quoi in par_joueur.items()]
    # Coupé ligne à ligne, jamais au milieu d'une balise : un message mal formé serait refusé par l'API.
    gardees = []
    for ligne in lignes:
        if sum(len(x) + 1 for x in gardees) + len(ligne) > TEXTE_MAX:
            gardees.append("Et d'autres encore.")
            break
        gardees.append(ligne)
    texte = "\n".join(gardees)
    return f"{texte}\n{escape(lien, quote=False)}" if lien else texte


class Telegram:
    """L'envoi au mieux. ouvrir : la fonction qui joint l'API (urlopen ; les tests en passent une fausse)."""

    def __init__(self, plafond: int = PLAFOND, delai: float = DELAI, horloge=time.monotonic, ouvrir=urlopen):
        self.plafond = plafond
        self.delai = delai
        self.horloge = horloge
        self.ouvrir = ouvrir
        self.envois: deque = deque()
        self.verrou = threading.Lock()
        self.plafond_dit = 0.0

    @staticmethod
    def identifiants() -> tuple[str, str]:
        return os.environ.get("TELEGRAM_BOT_TOKEN", "").strip(), os.environ.get("TELEGRAM_CHAT_ID", "").strip()

    def configure(self) -> bool:
        jeton, chat = self.identifiants()
        return bool(jeton and chat)

    def place(self) -> bool:
        """Une place libre dans l'heure glissante ; la prend si oui."""
        with self.verrou:
            instant = self.horloge()
            while self.envois and instant - self.envois[0] > 3600:
                self.envois.popleft()
            if len(self.envois) >= self.plafond:
                if instant - self.plafond_dit > 3600:
                    self.plafond_dit = instant
                    journal.info("Telegram : %s messages dans l'heure, les suivants attendront", self.plafond)
                return False
            self.envois.append(instant)
            return True

    def envoyer(self, texte: str) -> bool:
        """Vrai si l'API a accepté le message. Jamais d'exception, jamais le jeton au journal."""
        jeton, chat = self.identifiants()
        if not (jeton and chat and texte):
            return False
        if not self.place():
            return False
        corps = urlencode({"chat_id": chat, "text": texte, "parse_mode": "HTML",
                           "link_preview_options": json.dumps({"is_disabled": True})}).encode()
        base = os.environ.get("TELEGRAM_API", "https://api.telegram.org").rstrip("/")
        try:
            requete = Request(f"{base}/bot{jeton}/sendMessage", data=corps, method="POST",
                              headers={"Content-Type": "application/x-www-form-urlencoded"})
            with self.ouvrir(requete, timeout=self.delai) as reponse:
                ok = 200 <= getattr(reponse, "status", 200) < 300
            if not ok:
                journal.warning("Telegram : message refusé par l'API")
            return ok
        except Exception as err:  # au mieux : rien ne remonte, et seul le genre de l'erreur est noté
            code = getattr(err, "code", None)
            journal.warning("Telegram : message non envoyé (%s%s)", type(err).__name__, f" {code}" if isinstance(code, int) else "")
            return False
