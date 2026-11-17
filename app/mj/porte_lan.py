"""La porte du réseau local (deuxième accès MJ, lot MJ-2).

Aujourd'hui, l'atelier s'ouvre à tout appareil du réseau local et du VPN : sur le LAN, c'est le MJ principal. Décision du MJ
(09/11) : le LAN se ferme dès qu'un compte de MJ invité existe (data/mj/comptes.json, quel que soit son état, même
fermé). La porte « s'éveille » alors, et sur le LAN n'entrent plus que :
  - les appareils reconnus : un cookie de 400 jours (le plus long que garde Chrome), signé, rattaché à un compte MJ
    (« appareils » de son compte) ; « Oublier », ou une nouvelle génération du compte (mot de passe changé, nouveau lien,
    fermeture), le coupe ;
  - les outils du serveur, les scripts qui appellent l'atelier en 127.0.0.1 : l'en-tête X-Atelier-Outil porte le jeton
    du fichier data/mj/jeton-outils (0600, lisible par l'utilisateur du serveur) ;
  - le rendu PDF : Chromium, lancé par l'atelier, ouvre la page avec un jeton à usage unique, échangé aussitôt contre un
    cookie qui ne vaut que le temps du rendu, et seulement depuis la boucle locale ;
  - et pour tous : la TV (/table, /ws/table, ce que lit son script, les mêmes chemins que la table publique), la sonde
    d'Uptime Kuma (/table) et la page de connexion.
Un appareil non reconnu est renvoyé à la connexion, comme en ligne ; se connecter sur le LAN le reconnaît.

Tant qu'aucun invité n'existe, la porte dort : rien ne change, le LAN reste le MJ principal. ATELIER_PORTE_LAN=eveillee l'éveille
sans invité, pour les tests et les essais ; rien dans l'interface ne la règle. Éveillée une fois, elle le reste : elle
le note dans data/mj/porte-eveillee, qui la tient fermée même si le fichier des comptes devient illisible ou perd ses
invités (pour rouvrir le LAN : effacer ce fichier, à la main). Avant le premier invité, un fichier des comptes illisible
ne change rien au LAN, comme au lot MJ-1.

Un cookie se rattache à un nom d'hôte, pas à un port : les autres services du serveur à la même adresse le reçoivent
aussi. D'où la signature (clé data/mj/cle-appareils, 0600), le rattachement au compte et sa génération, et la liste où
l'oublier. Un même appareil se reconnaît une fois par adresse (192.168.1.20, serveur.local…).

Ni le cookie, ni le jeton des outils, ni celui du rendu n'entrent dans un journal : le journal des accès de uvicorn
écrit l'adresse demandée (d'où le filtre qui y masque « rendu= »), jamais les en-têtes.
"""
import asyncio
import hmac
import logging
import os
import re
import secrets
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlencode

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from commun import acces
from commun import comptes
from mj import comptes_mj
from mj import proprietes
from mj.proprietes import PRINCIPAL

journal = logging.getLogger("atelier")

COOKIE = "arriere-salle-appareil"
COOKIE_RENDU = "arriere-salle-rendu"
ENTETE_OUTIL = "x-atelier-outil"
DUREE = 400 * 86400
# Un appareil qui revient alors qu'il lui reste moins de 300 jours repart pour 400 : reconnu une fois, pour de bon. Safari
# ramène tout cookie à un an au plus : revenu au moins tous les 265 jours, il ne perd jamais le sien.
RENOUVELER = 300 * 86400
VU_TOUS_LES = 12 * 3600  # « vu le » s'écrit au plus deux fois par jour et par appareil
APPAREILS_MAX = 30
MEME_NOM_MAX = 3  # reconnus d'office à la connexion, au plus trois appareils du même nom (les plus récemment vus) : pas de liste qui gonfle
NOM_MAX = 40
ID_APPAREIL = re.compile(r"^[0-9a-f]{16}$")
CLE = "cle-appareils"
JETON_OUTILS = "jeton-outils"
MARQUE = "porte-eveillee"
# Dans le compte principal (comptes.json) : la porte s'est éveillée à cette date, et ses appareils sont à relire.
A_RELIRE = "appareils_a_relire"
EVEILLEE = "eveillee"
# L'interrupteur de test : lu au démarrage (les tests changent porte_lan.FORCAGE).
FORCAGE = os.environ.get("ATELIER_PORTE_LAN", "").strip().lower()
# Un jeton de rendu attend au plus 3 minutes que Chromium ouvre la page (pdf.py ne rend qu'une page à la fois, 45 s
# chacune au plus) ; le cookie qu'il devient tient 2 minutes, et tombe dès que le PDF est fait.
RENDU_OUVRIR = 180
RENDU_TENIR = 120
PAGES_DE_RENDU = ("/fiche-aventurier",)
BOUCLE = ("127.0.0.1", "::1")
PAGES = ("/api/", "/media/", "/static/", "/ws/")


def maintenant() -> str:
    return datetime.now().isoformat(timespec="seconds")


def signature(cle: str, compte: str, appareil: str, generation, echeance: int) -> str:
    return acces.signer(cle.encode(), f"appareil|{compte}|{appareil}|{generation}|{echeance}")


def entete_cookie(valeur: str, duree: int = DUREE) -> str:
    """Le cookie d'un appareil reconnu : sans « Secure » (le LAN est en http), jamais lisible par un script. Lax : un lien
    ouvert depuis Telegram ou une page de liens arrive reconnu."""
    return f"{COOKIE}={valeur}; Max-Age={duree}; Path=/; HttpOnly; SameSite=Lax"


def entre(c) -> bool:
    """Un compte dont les appareils entrent : le principal, ou un invité ouvert (comptes_mj.ouvert, donc jamais tant que
    les invitations restent fermées)."""
    return isinstance(c, dict) and (c.get("role") == "principal" or comptes_mj.ouvert(c))


def nom_propose(agent: str) -> str:
    """Un nom lisible pour un appareil, tiré de son navigateur (« Mac, Chrome ») ; la page le corrige (un iPad en Safari
    se dit Mac) et le MJ peut le changer."""
    a = agent or ""
    appareil = ("TV LG" if "Web0S" in a or "webOS" in a else "iPhone" if "iPhone" in a else "iPad" if "iPad" in a
                else "Android" if "Android" in a else "Mac" if "Macintosh" in a else "PC" if "Windows" in a
                else "Linux" if "Linux" in a else "Appareil")
    navigateur = ("Edge" if "Edg/" in a else "Firefox" if "Firefox/" in a or "FxiOS" in a
                  else "Chrome" if "Chrome/" in a or "CriOS" in a else "Safari" if "Safari/" in a else "")
    return f"{appareil}, {navigateur}" if navigateur else appareil


def nom_choisi(nom, agent: str = "") -> str:
    propre = " ".join(unicodedata.normalize("NFC", nom).split())[:NOM_MAX] if isinstance(nom, str) else ""
    propre = "".join(ch for ch in propre if ch.isprintable())
    return propre or nom_propose(agent)


def apres(iso, secondes: int) -> bool:
    """Vrai si l'instant iso est plus vieux que tant de secondes (ou illisible)."""
    try:
        return (datetime.now() - datetime.fromisoformat(iso)).total_seconds() > secondes
    except (TypeError, ValueError):
        return True


class MasqueDuRendu(logging.Filter):
    """Le journal des accès de uvicorn écrit l'adresse demandée : le jeton de rendu (« rendu=… ») n'y paraît pas, même
    servi et périmé."""

    MOTIF = re.compile(r"(rendu=)[^&\s]*")

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and any(isinstance(x, str) and "rendu=" in x for x in args):
            record.args = tuple(self.MOTIF.sub(r"\1…", x) if isinstance(x, str) else x for x in args)
        if isinstance(record.msg, str) and "rendu=" in record.msg:
            record.msg = self.MOTIF.sub(r"\1…", record.msg)
        return True


logging.getLogger("uvicorn.access").addFilter(MasqueDuRendu())


@dataclass
class Passage:
    """Ce que la porte dit d'une requête du LAN : refusée, ou passée (avec le compte à poser quand elle est éveillée,
    et les cookies à poser sur la réponse)."""
    refuse: bool = False
    compte: str | None = None
    cookies: list = field(default_factory=list)

    def envelopper(self, send):
        if not self.cookies:
            return send

        async def envoyer(message):
            if message["type"] == "http.response.start":
                message = {**message, "headers": [*message.get("headers", []),
                                                  *((b"set-cookie", c.encode("latin-1")) for c in self.cookies)]}
            await send(message)
        return envoyer


class PorteLan:
    """chemins_tv : les chemins de la TV (main.CHEMINS_TABLE) ; libres : ceux de la connexion (main.LIBRES_SANS_SESSION) ;
    empreinte_env : une fonction qui rend l'empreinte du mot de passe du MJ principal (le compte principal s'en assure)."""

    def __init__(self, donnees: Path, *, chemins_tv, libres, empreinte_env):
        self.donnees = Path(donnees)
        self.chemins_tv = chemins_tv
        self.libres = libres
        self.empreinte_env = empreinte_env
        self._lu = (None, comptes_mj.vide())
        self._secrets: dict = {}
        self._cri = 0.0
        self.rendus: dict = {}  # jeton de l'adresse -> (compte, échéance)
        self.en_rendu: dict = {}  # jeton du cookie -> (compte, échéance, jeton de l'adresse)

    # ---------------------------------------------------------------- les fichiers de data/mj/

    def secret(self, nom: str) -> str:
        """Le secret d'un fichier de data/mj/ (0600), tiré au sort la première fois ; écrit d'un coup (un lien vers un
        fichier déjà plein), il n'est jamais lu à moitié. Relu quand le fichier change (le remplacer suffit à le changer)."""
        f = comptes_mj.dossier(self.donnees) / nom
        try:
            s = f.stat()
        except FileNotFoundError:
            self._creer(f)
            s = f.stat()
        signe = (s.st_ino, s.st_mtime_ns, s.st_size)
        connu = self._secrets.get(nom)
        if connu and connu[0] == signe:
            return connu[1]
        try:
            valeur = f.read_text(encoding="ascii").strip()
        except UnicodeDecodeError as err:
            raise OSError(f"{f} : illisible") from err
        if len(valeur) < 32:
            raise OSError(f"{f} : secret trop court")
        self._secrets[nom] = (signe, valeur)
        return valeur

    @staticmethod
    def _creer(f: Path) -> None:
        f.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        tmp = f.with_name(f".{f.name}.{secrets.token_hex(4)}.tmp")
        try:
            with os.fdopen(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="ascii") as sortie:
                sortie.write(secrets.token_urlsafe(32) + "\n")
            try:
                os.link(tmp, f)
            except FileExistsError:
                pass
        finally:
            tmp.unlink(missing_ok=True)

    def preparer(self) -> None:
        """Au démarrage : la clé des appareils et le jeton des outils existent avant que la porte s'éveille (les scripts du
        serveur lisent le jeton dès maintenant)."""
        try:
            self.secret(CLE)
            self.secret(JETON_OUTILS)
        except OSError as err:
            journal.error("Porte du réseau local : secrets impossibles à préparer (%s)", err)

    def comptes(self) -> dict:
        """L'état des comptes MJ, relu seulement quand le fichier change (chaque requête du LAN le consulte). Lève
        comptes_mj.Illisible."""
        f = comptes_mj.chemin(self.donnees)
        try:
            s = f.stat()
        except FileNotFoundError:
            self._lu = (None, comptes_mj.vide())
            return self._lu[1]
        signe = (s.st_ino, s.st_mtime_ns, s.st_size)
        if signe != self._lu[0]:
            self._lu = (signe, comptes_mj.lire(self.donnees))
        return self._lu[1]

    # ---------------------------------------------------------------- l'état de la porte

    def eveillee(self) -> bool:
        """Éveillée dès qu'un compte invité existe (ouvert, en attente de son lien ou fermé), puis pour de bon (la marque
        data/mj/porte-eveillee) ; ou par l'interrupteur de test."""
        if FORCAGE == EVEILLEE:
            return True
        marque = comptes_mj.dossier(self.donnees) / MARQUE
        if marque.exists():
            return True
        try:
            invite = any(c.get("role") == "invite" for c in self.comptes()["comptes"])
        except comptes_mj.Illisible as err:
            if time.monotonic() - self._cri > 60:
                self._cri = time.monotonic()
                journal.error("Comptes des MJ illisibles, porte du réseau local encore endormie : %s", err)
            return False
        if invite:
            try:
                comptes.ecrire_prive(marque, {"depuis": maintenant()})
                journal.warning("Un MJ invité existe : le réseau local se ferme aux appareils non reconnus.")
            except OSError as err:
                journal.error("Porte du réseau local : marque impossible à écrire (%s)", err)
            self.a_relire_au_reveil()
        return invite

    def a_relire_au_reveil(self) -> None:
        """La porte s'éveille : le compte principal relira ses appareils. Ceux qu'il a reconnus pendant qu'elle dormait
        l'ont été quand le LAN était ouvert à tous (un appareil prêté, celui d'un ami au salon) ; rien n'est oublié tout
        seul, la liste paraît en tête de l'atelier avec un avis jusqu'à « C'est relu » (js/mj/appareils.js)."""
        try:
            with comptes_mj.verrou(self.donnees):
                etat = comptes_mj.lire(self.donnees)
                p = comptes_mj.principal(etat)
                if not p or p.get(A_RELIRE):
                    return
                p[A_RELIRE] = maintenant()
                comptes_mj.ecrire(self.donnees, etat)
        except (OSError, ValueError, comptes_mj.Illisible) as err:
            journal.error("Porte du réseau local : avis « Relisez vos appareils » non posé (%s)", err)

    def a_relire(self, compte: str) -> str | None:
        """La date du réveil de la porte si ce compte n'a pas encore relu ses appareils, sinon None. Porte endormie
        (rouverte à la main), plus rien à relire."""
        try:
            c = comptes_mj.par_id(self.comptes(), compte)
        except comptes_mj.Illisible:
            return None
        quand = (c or {}).get(A_RELIRE)
        return quand if isinstance(quand, str) and quand and self.eveillee() else None

    def relus(self, compte: str) -> None:
        with comptes_mj.verrou(self.donnees):
            etat = comptes_mj.lire(self.donnees)
            c = comptes_mj.par_id(etat, compte)
            if not c or not c.get(A_RELIRE):
                return
            c.pop(A_RELIRE, None)
            c["modifie"] = maintenant()
            comptes_mj.ecrire(self.donnees, etat)
        comptes_mj.noter(self.donnees, "appareils-relus", compte, compte)

    # ---------------------------------------------------------------- les appareils

    def jeton(self, compte: str, appareil: str, generation, echeance: int) -> str:
        cle = self.secret(CLE)
        return acces.jeton_signe([compte, appareil], echeance,
                                 lambda champs, e: signature(cle, champs[0], champs[1], generation, e))

    def appareil(self, valeur: str):
        """(compte, appareil, échéance) d'un cookie d'appareil encore bon : signature, échéance, appareil encore dans la
        liste de son compte, génération du compte, compte qui entre. Sinon None."""
        if not valeur:
            return None
        try:
            etat, cle = self.comptes(), self.secret(CLE)
        except (comptes_mj.Illisible, OSError):
            return None

        def sig(champs, echeance):
            c = comptes_mj.par_id(etat, champs[0])
            if not c or not ID_APPAREIL.fullmatch(champs[1]):
                return ""
            return signature(cle, champs[0], champs[1], c["generation"], echeance)

        champs = acces.jeton_valide(valeur, sig, 2)
        if not champs:
            return None
        c = comptes_mj.par_id(etat, champs[0])
        a = next((x for x in c.get("appareils") or [] if isinstance(x, dict) and x.get("id") == champs[1]), None)
        if not a or a.get("generation") != c["generation"] or not entre(c):
            return None
        return c, a, int(valeur.split(".")[2])

    def liste(self, compte: str) -> list:
        """Les appareils reconnus d'un compte, tels que les montre l'atelier : nom, dates ; ni clé ni génération."""
        try:
            c = comptes_mj.par_id(self.comptes(), compte)
        except comptes_mj.Illisible:
            raise HTTPException(503, "Les comptes des MJ ne se lisent pas.")
        if not c:
            return []
        vus = [a for a in c.get("appareils") or [] if isinstance(a, dict) and a.get("generation") == c["generation"]
               and ID_APPAREIL.fullmatch(str(a.get("id")))]
        return [{"id": a["id"], "nom": a.get("nom") or "Appareil", "cree": a.get("cree"), "vu": a.get("vu")}
                for a in sorted(vus, key=lambda x: x.get("vu") or "", reverse=True)]

    def reconnaitre(self, compte: str, nom, agent: str = "", remplace: str = "") -> tuple[dict, str]:
        """Un appareil de plus pour ce compte (au-delà de APPAREILS_MAX, le moins récemment vu sort ; « remplace » : celui
        que cet appareil portait déjà). Rend (l'appareil, la valeur de son cookie)."""
        if compte == PRINCIPAL:
            # Le compte principal naît de l'environnement (comptes_mj.py) ; avant le verrou, qu'il prend lui-même.
            comptes_mj.assurer_principal(self.donnees, self.empreinte_env())
        automatique = not (isinstance(nom, str) and nom.strip())
        nom = nom_choisi(nom, agent)
        with comptes_mj.verrou(self.donnees):
            etat = comptes_mj.lire(self.donnees)
            c = comptes_mj.par_id(etat, compte)
            if not entre(c):
                raise comptes.Refus(403, "Ce compte ne peut pas reconnaître d'appareil.")
            instant = maintenant()
            a = {"id": secrets.token_hex(8), "nom": nom, "cree": instant, "vu": instant, "generation": c["generation"]}
            gardes = [x for x in c.get("appareils") or [] if isinstance(x, dict) and x.get("generation") == c["generation"]
                      and ID_APPAREIL.fullmatch(str(x.get("id"))) and x.get("id") != remplace]
            if automatique:
                # Un appareil reconnu d'office porte le nom de son navigateur : chaque nouveau contexte (cookies effacés,
                # navigation privée) en ajouterait un. Les plus anciens du même nom s'effacent.
                memes = sorted((x for x in gardes if x.get("nom") == nom), key=lambda x: x.get("vu") or "")[:-(MEME_NOM_MAX - 1)]
                gardes = [x for x in gardes if not any(x is m for m in memes)]
            gardes = sorted(gardes, key=lambda x: x.get("vu") or "")[-(APPAREILS_MAX - 1):]
            c["appareils"] = [*gardes, a]
            c["modifie"] = instant
            generation = c["generation"]
            comptes_mj.ecrire(self.donnees, etat)
        comptes_mj.noter(self.donnees, "appareil-reconnu", compte, compte)
        journal.info("Appareil reconnu sur le réseau local pour le compte %s : %s", compte, nom)
        return a, self.jeton(compte, a["id"], generation, int(time.time()) + DUREE)

    def oublier(self, compte: str, appareil: str, par: str) -> bool:
        with comptes_mj.verrou(self.donnees):
            etat = comptes_mj.lire(self.donnees)
            c = comptes_mj.par_id(etat, compte)
            avant = (c or {}).get("appareils") or []
            gardes = [x for x in avant if not (isinstance(x, dict) and x.get("id") == appareil)]
            if not c or len(gardes) == len(avant):
                return False
            c["appareils"] = gardes
            c["modifie"] = maintenant()
            comptes_mj.ecrire(self.donnees, etat)
        comptes_mj.noter(self.donnees, "appareil-oublie", compte, par)
        journal.info("Appareil oublié pour le compte %s", compte)
        return True

    def noter_vu(self, compte: str, appareil: str) -> None:
        try:
            with comptes_mj.verrou(self.donnees):
                etat = comptes_mj.lire(self.donnees)
                c = comptes_mj.par_id(etat, compte)
                a = next((x for x in (c or {}).get("appareils") or [] if isinstance(x, dict) and x.get("id") == appareil), None)
                if not a or not apres(a.get("vu"), VU_TOUS_LES):
                    return
                a["vu"] = maintenant()
                comptes_mj.ecrire(self.donnees, etat)
        except (OSError, ValueError, comptes_mj.Illisible) as err:
            journal.warning("« Vu le » d'un appareil non noté : %s", err)

    async def apres_connexion(self, reponse, compte: str, entetes, lan: bool) -> None:
        """Une connexion réussie sur le réseau local, porte éveillée : l'appareil est reconnu (le cookie de session de
        l'atelier en ligne, « Secure », ne tient pas en http). Porte endormie, rien ne change."""
        if not lan or not self.eveillee():
            return
        try:
            _, valeur = await asyncio.to_thread(self.reconnaitre, compte, "", entetes.get("user-agent", ""))
        except (OSError, comptes.Refus, comptes_mj.Illisible) as err:
            journal.error("Appareil non reconnu à la connexion sur le réseau local : %s", err)
            return
        reponse.headers.append("set-cookie", entete_cookie(valeur))

    # ---------------------------------------------------------------- les outils du serveur et le rendu PDF

    def outil(self, valeur: str) -> bool:
        try:
            attendu = self.secret(JETON_OUTILS)
        except OSError:
            return False
        return hmac.compare_digest(valeur.strip().encode("latin-1"), attendu.encode("latin-1"))

    def _purger(self) -> None:
        instant = time.monotonic()
        for k in [k for k, v in self.rendus.items() if v[1] < instant]:
            self.rendus.pop(k, None)
        for k in [k for k, v in self.en_rendu.items() if v[1] < instant]:
            self.en_rendu.pop(k, None)

    def jeton_de_rendu(self, compte: str) -> str:
        """Le jeton que Chromium porte dans l'adresse de la page à rendre : une seule ouverture, pour ce compte."""
        self._purger()
        j = secrets.token_urlsafe(24)
        self.rendus[j] = (compte, time.monotonic() + RENDU_OUVRIR)
        return j

    def fin_de_rendu(self, jeton: str) -> None:
        self.rendus.pop(jeton, None)
        for k in [k for k, v in self.en_rendu.items() if v[2] == jeton]:
            self.en_rendu.pop(k, None)

    def rendu(self, scope, cookies: str, passage: Passage) -> str | None:
        """Le compte d'une requête de Chromium en plein rendu, sinon None. Seulement depuis la boucle locale."""
        client = (scope.get("client") or ("",))[0]
        if client not in BOUCLE:
            return None
        self._purger()
        valeur = acces.lire_cookie(cookies, COOKIE_RENDU)
        if valeur and valeur in self.en_rendu:
            return self.en_rendu[valeur][0]
        if scope["type"] != "http" or scope["path"] not in PAGES_DE_RENDU:
            return None
        jeton = parse_qs(scope.get("query_string", b"").decode("latin-1")).get("rendu", [""])[0]
        entree = self.rendus.pop(jeton, None) if jeton else None
        if not entree:
            return None
        cle = secrets.token_urlsafe(24)
        self.en_rendu[cle] = (entree[0], time.monotonic() + RENDU_TENIR, jeton)
        passage.cookies.append(f"{COOKIE_RENDU}={cle}; Max-Age={RENDU_TENIR}; Path=/; HttpOnly; SameSite=Strict")
        return entree[0]

    # ---------------------------------------------------------------- la Garde

    def libre(self, scope) -> bool:
        """La TV, la sonde et la connexion : ouvertes à tout appareil du LAN, porte éveillée ou non."""
        chemin = scope["path"]
        if scope["type"] == "websocket":
            return chemin == "/ws/table"
        if self.libres.match(chemin):
            return True
        return scope.get("method", "GET") in ("GET", "HEAD") and bool(self.chemins_tv.match(chemin)) and chemin != "/ws/table"

    async def passage(self, scope, entetes: dict) -> Passage:
        """Ce que la porte fait d'une requête du réseau local. Endormie, elle laisse tout passer (et entretient seulement
        les cookies d'appareil présentés) ; éveillée, seuls passent un appareil reconnu, un outil, un rendu, ou un
        chemin libre."""
        p = Passage()
        cookies = entetes.get("cookie", "")
        rendu = self.rendu(scope, cookies, p)
        trouve = self.appareil(acces.lire_cookie(cookies, COOKIE))
        if trouve and scope["type"] == "http":
            await self.entretenir(scope, trouve, p)
        if not self.eveillee():
            return p
        if rendu:
            p.compte = rendu
        elif trouve:
            p.compte = trouve[0]["id"]
        elif entetes.get(ENTETE_OUTIL) and self.outil(entetes[ENTETE_OUTIL]):
            p.compte = PRINCIPAL
        elif not self.libre(scope):
            p.refuse = True
        return p

    async def entretenir(self, scope, trouve, passage: Passage) -> None:
        """Un appareil reconnu qui revient : « vu le » (deux fois par jour au plus), et, à l'ouverture d'une page, un cookie
        neuf de 400 jours quand il lui en reste moins de 300."""
        c, a, echeance = trouve
        if apres(a.get("vu"), VU_TOUS_LES):
            await asyncio.to_thread(self.noter_vu, c["id"], a["id"])
        page = scope.get("method") == "GET" and not scope["path"].startswith(PAGES)
        if page and echeance - time.time() < RENOUVELER:
            passage.cookies.append(entete_cookie(self.jeton(c["id"], a["id"], c["generation"], int(time.time()) + DUREE)))

    @staticmethod
    async def renvoyer(scope, send, refuser) -> None:
        """Un appareil non reconnu, porte éveillée : une page renvoie à la connexion (puis y revient), le reste répond 401
        (api.js mène alors à la connexion), un WebSocket se ferme."""
        chemin, methode = scope["path"], scope.get("method", "GET")
        if scope["type"] == "http" and methode in ("GET", "HEAD") and not chemin.startswith(PAGES):
            requete = scope.get("query_string", b"").decode("latin-1")
            suite = chemin + ("?" + requete if requete else "")
            destination = "/connexion" + ("?" + urlencode({"suite": suite}) if suite != "/" else "")
            await send({"type": "http.response.start", "status": 303,
                        "headers": [(b"location", destination.encode("latin-1")), (b"content-length", b"0"),
                                    (b"cache-control", b"no-store")]})
            await send({"type": "http.response.body", "body": b""})
            return
        await refuser(scope, send, 401, "Connexion requise")


# ---------------------------------------------------------------- « Vos appareils » (onglet Aventuriers)

def routes(porte: PorteLan, *, corps_objet, sur_le_lan) -> APIRouter:
    """Chacun ses appareils : ceux du compte de la requête (sur le LAN porte endormie, le principal). sur_le_lan(entêtes) :
    vrai si la requête vient du réseau local (ni l'atelier en ligne, ni la table publique)."""
    r = APIRouter()

    def cet_appareil(requete: Request, compte: str) -> str | None:
        trouve = porte.appareil(acces.lire_cookie(requete.headers.get("cookie", ""), COOKIE))
        return trouve[1]["id"] if trouve and trouve[0]["id"] == compte else None

    def vue(requete: Request, compte: str, cet: str | None) -> dict:
        sortie = {"porte": EVEILLEE if porte.eveillee() else "dormante", "lan": sur_le_lan(requete.headers),
                  "cet_appareil": cet, "nom_propose": nom_propose(requete.headers.get("user-agent", "")),
                  "appareils": porte.liste(compte)}
        if quand := porte.a_relire(compte):
            # Seulement à relire : sans avis, la réponse reste celle d'avant le lot MJ-7.
            sortie["a_relire"] = quand
        return sortie

    def reponse(corps: dict, *cookies: str) -> JSONResponse:
        rep = JSONResponse(corps, headers={"Cache-Control": "no-store"})
        for c in cookies:
            rep.headers.append("set-cookie", c)
        return rep

    @r.get("/api/mj/appareils")
    def appareils(requete: Request):
        compte = proprietes.compte_courant()
        return reponse(vue(requete, compte, cet_appareil(requete, compte)))

    @r.post("/api/mj/appareils")
    async def reconnaitre(requete: Request):
        """Reconnaître cet appareil : sur le réseau local seulement (le cookie se rattache à l'adresse du LAN)."""
        if not sur_le_lan(requete.headers):
            raise HTTPException(400, "Un appareil se reconnaît depuis le réseau local : à la maison, ou par le VPN.")
        corps = await corps_objet(requete)
        compte = proprietes.compte_courant()
        avant = cet_appareil(requete, compte) or ""
        try:
            a, valeur = await asyncio.to_thread(porte.reconnaitre, compte, corps.get("nom"),
                                                requete.headers.get("user-agent", ""), avant)
        except comptes.Refus as refus:
            raise HTTPException(refus.statut, refus.message)
        except (comptes_mj.Illisible, OSError) as err:
            journal.error("Appareil non reconnu : %s", err)
            raise HTTPException(503, "Les comptes des MJ ne se lisent pas.")
        return reponse(vue(requete, compte, a["id"]), entete_cookie(valeur))

    @r.post("/api/mj/appareils/relus")
    async def relus(requete: Request):
        """« C'est relu » : l'avis du réveil de la porte ne paraît plus pour ce compte."""
        compte = proprietes.compte_courant()
        try:
            await asyncio.to_thread(porte.relus, compte)
        except (comptes_mj.Illisible, OSError) as err:
            journal.error("Avis des appareils non retiré : %s", err)
            raise HTTPException(503, "Les comptes des MJ ne se lisent pas.")
        return reponse(vue(requete, compte, cet_appareil(requete, compte)))

    @r.delete("/api/mj/appareils/{ident}")
    async def oublier(ident: str, requete: Request):
        """Oublier un appareil : son cookie ne vaut plus rien. Celui de la requête perd aussi le sien."""
        compte = proprietes.compte_courant()
        cet = cet_appareil(requete, compte)
        if not ID_APPAREIL.fullmatch(ident):
            raise HTTPException(404, "Cet appareil n'est pas reconnu.")
        try:
            fait = await asyncio.to_thread(porte.oublier, compte, ident, compte)
        except (comptes_mj.Illisible, OSError) as err:
            journal.error("Appareil non oublié : %s", err)
            raise HTTPException(503, "Les comptes des MJ ne se lisent pas.")
        if not fait:
            raise HTTPException(404, "Cet appareil n'est pas reconnu.")
        if cet == ident:
            return reponse(vue(requete, compte, None), entete_cookie("", 0))
        return reponse(vue(requete, compte, cet))

    return r
