"""Les comptes des MJ de l'atelier : data/mj/comptes.json (dossier 0700, fichier 0600), jamais sous propositions/ (le
coin des joueurs n'en voit rien).

Deux rôles : le compte principal (identifiant ATELIER_MJ_PRINCIPAL, « mj » par défaut, un seul) et les MJ invités, qui mènent à l'occasion
des quêtes annexes. Un compte : {id, identifiant, forme, nom, role, empreinte, generation, appareils, invitation,
budget_mois, cree, modifie}, plus « env » pour le principal et « ferme » pour un invité. « forme » est l'identifiant tel
qu'on le compare (comptes.forme : « Léa » et « léa » sont le même) ; « generation » monte à chaque nouveau mot de passe,
nouveau lien ou fermeture : les sessions d'avant tombent.

Le principal naît au premier démarrage depuis ATELIER_MDP_EMPREINTE (l'empreinte que tient
secrets/acces.env) : le mot de passe du MJ principal continue de marcher. Il suit cette empreinte quand
elle change (outils/mot-de-passe.py, puis « docker compose up -d ») ; « env » en garde une empreinte pour le savoir.
outils/mot-de-passe.py --compte mj écrit directement ici (secours).

Un invité naît d'une invitation : un lien …/connexion/invitation#cle=…, que la page du MJ principal tire au sort. La clé ne
passe que dans le fragment de l'adresse (jamais dans un journal du serveur) puis dans le corps d'une requête ; ce fichier
n'en garde que l'empreinte, sept jours. L'invité y choisit son identifiant et son mot de passe ; le lien ne sert qu'une
fois. « Nouveau lien » efface son mot de passe ; « Fermer » coupe ses sessions et ses connexions. Un compte fermé reste
dans le fichier : son identifiant ne resert jamais, ses fiches restent les siennes.

Le cloisonnement (cloisonnement.py, lot MJ-3) est installé en veille ; tant que les invitations restent fermées (lot MJ-7,
avec le strict réglé dans docker-compose.yml), aucun invité ne s'ouvre : INVITATIONS_OUVERTES reste faux, et un compte
invité ne peut ni naître, ni se connecter, ni garder une session. Même les invitations ouvertes, un invité n'entre qu'avec
le cloisonnement en strict (invites_permis) : en veille, il lirait tous les secrets du MJ principal. La garde se lit à chaque
requête, pas seulement au démarrage : ni lien, ni connexion, ni session, ni appareil reconnu (porte_lan.entre).

Les gestes sur les comptes (création, nouveau lien, fermeture, mot de passe) sont notés dans data/mj/journal.jsonl, sans
empreinte ni clé. Écritures sous un verrou fcntl, d'un coup (comptes.ecrire_prive).
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import unicodedata
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from commun import acces
from mj import cloisonnement
from commun import comptes
from mj.proprietes import NOM_PRINCIPAL, PRINCIPAL
from commun import stockage

# Le drapeau d'activation des invités : faux tant que docker-compose.yml ne porte pas ATELIER_INVITATIONS=ouvertes (ligne
# commentée jusqu'au lot MJ-7, à décommenter après ATELIER_CLOISONNEMENT=strict ; tests/test_mj_cloisonnement.py exige
# l'une avec l'autre). Lu au démarrage ; les tests l'activent sur le module.
INVITATIONS_OUVERTES = os.environ.get("ATELIER_INVITATIONS", "").strip().lower() == "ouvertes"
PAS_ENCORE = "Pas encore disponible : l'accès d'un deuxième MJ s'ouvrira avec le cloisonnement de l'atelier."
EN_VEILLE = ("Le cloisonnement de l'atelier est en veille : un MJ invité ne peut ni recevoir de lien, ni se connecter, tant "
             "qu'il n'est pas passé en strict.")
# Réservé aux essais du journal de veille (tests/deux_mj.py), qui ont besoin d'un invité dans un atelier en veille : jamais
# lu de l'environnement, rien dans l'atelier ne le change.
ESSAI_INVITE_EN_VEILLE = False

DOSSIER = "mj"
FICHIER = "comptes.json"
JOURNAL = "journal.jsonl"
FICHIER_MAX = 256 * 1024
ROLES = ("principal", "invite")
ID_COMPTE = re.compile(r"^[a-z0-9-]{1,40}$")
NOM_MAX = 60
DUREE_INVITATION = 7 * 86400
# L'ancien cookie de l'atelier en ligne (« échéance.signature », d'avant les comptes) vaut session du principal pendant
# 30 jours après le premier démarrage : le MJ principal n'est pas déconnecté à l'installation.
DUREE_ANCIEN_COOKIE = 30 * 86400
BUDGET_DEFAUT = 3.0  # dollars de rédaction par mois pour un invité (lot MJ-5, budget_mj.py), réglable par le MJ principal
# Les séances d'un invité se numérotent à part : au carnet des joueurs, dans les « croisés » et sur le carton
# d'épisode de la TV, « Quête annexe 2 » et non « Séance 2 », ou le nom qu'il donne à sa suite. Celles du principal
# restent « Séance N » et « Épisode N ».
SUITE_DEFAUT = "Quête annexe"
SUITE_MAX = 40
# Une clé d'invitation : 24 octets ou plus tirés au sort, en base64 sans remplissage.
CLE_INVITATION = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
# « MJ » était l'identifiant caché de l'ancienne page de connexion : les gestionnaires de mots de passe l'ont retenu. Il
# mène au principal, comme un identifiant laissé vide ; personne ne le choisit.
ALIAS_PRINCIPAL = ("", "mj")


class Illisible(Exception):
    """Le fichier des comptes existe mais ne se lit pas : rien ne l'écrase, personne n'entre par Internet."""


def maintenant() -> str:
    return datetime.now().isoformat(timespec="seconds")


def dossier(donnees: Path) -> Path:
    return Path(donnees) / DOSSIER


def chemin(donnees: Path) -> Path:
    return dossier(donnees) / FICHIER


@contextmanager
def verrou(donnees: Path):
    with stockage.verrou_de_dossier(dossier(donnees), ".verrou", mode_dossier=0o700, forcer_mode=True):
        yield


def compte_valide(c) -> bool:
    """Un compte entier : un seul principal possible, l'identifiant du compte principal, jamais un invité sous ce nom."""
    if not isinstance(c, dict) or not isinstance(c.get("id"), str) or not ID_COMPTE.fullmatch(c["id"]):
        return False
    if c.get("role") not in ROLES or (c["role"] == "principal") != (c["id"] == PRINCIPAL):
        return False
    if not isinstance(c.get("generation"), int) or isinstance(c.get("generation"), bool):
        return False
    return all(isinstance(c.get(k), str) for k in ("identifiant", "forme", "nom", "empreinte"))


def vide() -> dict:
    return {"comptes": []}


def lire(donnees: Path) -> dict:
    """L'état des comptes : {"comptes": [...], "ancien_cookie": {...}}. Sans fichier, vide ; un fichier illisible lève
    Illisible (il n'est jamais écrasé)."""
    f = chemin(donnees)
    try:
        if f.stat().st_size > FICHIER_MAX:
            raise Illisible(f"{f} : trop gros")
        etat = stockage.lire_json(f)
    except FileNotFoundError:
        return vide()
    except (OSError, ValueError) as err:
        raise Illisible(f"{f} : {err}") from err
    if not isinstance(etat, dict) or not isinstance(etat.get("comptes"), list):
        raise Illisible(f"{f} : forme inattendue")
    vus, propres = set(), []
    for c in etat["comptes"]:
        if compte_valide(c) and c["id"] not in vus:
            vus.add(c["id"])
            propres.append(c)
    return {**etat, "comptes": propres}


def verifier_principal(donnees: Path) -> None:
    """Au démarrage : le compte principal déjà écrit doit être celui que règle ATELIER_MJ_PRINCIPAL. Sinon l'atelier ne
    démarre pas, plutôt que d'oublier ce compte (compte_valide l'écarterait) et de rendre ses fiches à un autre."""
    try:
        etat = stockage.lire_json(chemin(donnees))
    except (OSError, ValueError):
        return
    comptes = etat.get("comptes") if isinstance(etat, dict) else None
    autres = sorted({str(c.get("id")) for c in comptes or [] if isinstance(c, dict) and c.get("role") == "principal"} - {PRINCIPAL})
    if autres:
        raise RuntimeError(f"Le compte principal des données est « {autres[0]} », ATELIER_MJ_PRINCIPAL vaut « {PRINCIPAL} » : "
                           f"régler ATELIER_MJ_PRINCIPAL={autres[0]} dans .env (docs/installation.md).")


def ecrire(donnees: Path, etat: dict) -> None:
    """Sous le verrou : le fichier d'un coup, lisible par son seul propriétaire. Jamais deux principaux."""
    if sum(1 for c in etat["comptes"] if c.get("role") == "principal") > 1:
        raise ValueError("un seul compte principal")
    comptes.ecrire_prive(chemin(donnees), etat)


def noter(donnees: Path, geste: str, compte: str, par: str = "") -> None:
    """La trace d'un geste sur un compte : quand, quoi, quel compte, par qui. Ni empreinte ni clé."""
    ligne = json.dumps({"quand": maintenant(), "geste": geste, "compte": compte, "par": par}, ensure_ascii=False)
    f = dossier(donnees) / JOURNAL
    f.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(f, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, "a", encoding="utf-8") as sortie:
        sortie.write(ligne + "\n")


def par_id(etat: dict, ident: str) -> dict | None:
    return next((c for c in etat["comptes"] if c["id"] == ident), None)


def principal(etat: dict) -> dict | None:
    c = par_id(etat, PRINCIPAL)
    return c if c and c["role"] == "principal" else None


def invites_permis() -> bool:
    """Un invité peut-il entrer ? Les invitations ouvertes, et le cloisonnement en strict."""
    return INVITATIONS_OUVERTES and (cloisonnement.strict() or ESSAI_INVITE_EN_VEILLE)


def ouvert(c) -> bool:
    """Un compte qui laisse entrer : un mot de passe choisi, pas fermé ; un invité seulement si les invitations sont
    ouvertes et le cloisonnement en strict."""
    if not isinstance(c, dict) or not c.get("empreinte") or c.get("ferme"):
        return False
    return c["role"] == "principal" or invites_permis()


def marque_env(empreinte_env: str) -> str:
    """Ce que le principal garde de l'empreinte de l'environnement qu'il a reprise : de quoi voir qu'elle a changé."""
    return hashlib.sha256(empreinte_env.encode()).hexdigest()[:32] if empreinte_env else ""


def nouveau_principal(empreinte: str, env: str, instant: str) -> dict:
    return {"id": PRINCIPAL, "identifiant": PRINCIPAL, "forme": PRINCIPAL, "nom": NOM_PRINCIPAL, "role": "principal",
            "empreinte": empreinte, "generation": 1, "appareils": [], "invitation": None, "budget_mois": None,
            "env": marque_env(env), "cree": instant, "modifie": instant}


def assurer_principal(donnees: Path, empreinte_env: str) -> dict:
    """L'état des comptes, le principal compris : créé au premier passage depuis l'empreinte de l'environnement, il la
    reprend quand elle change (et ses sessions tombent). Une empreinte d'environnement vide ne change rien."""
    etat = lire(donnees)
    p = principal(etat)
    if p is not None and (not empreinte_env or p.get("env") == marque_env(empreinte_env)):
        return etat
    with verrou(donnees):
        etat = lire(donnees)
        p = principal(etat)
        instant = maintenant()
        if p is None:
            etat["comptes"].insert(0, nouveau_principal(empreinte_env, empreinte_env, instant))
            # L'ancien cookie vaut session pendant 30 jours, tant que le mot de passe n'a pas changé (même génération).
            etat["ancien_cookie"] = {"fin": int(time.time()) + DUREE_ANCIEN_COOKIE, "generation": 1}
            geste = "principal-cree"
        elif empreinte_env and p.get("env") != marque_env(empreinte_env):
            p.update(empreinte=empreinte_env, env=marque_env(empreinte_env), modifie=instant,
                     generation=p["generation"] + (1 if p["empreinte"] else 0))
            geste = "mot-de-passe-environnement"
        else:
            return etat
        ecrire(donnees, etat)
    noter(donnees, geste, PRINCIPAL)
    return etat


def ancien_cookie_tient(etat: dict, empreinte_env: str) -> bool:
    """Le cookie d'avant les comptes (signé avec l'empreinte de l'environnement) vaut session du principal : pendant les
    30 jours qui suivent le premier démarrage, et tant que son mot de passe reste celui de l'environnement."""
    p, fenetre = principal(etat), etat.get("ancien_cookie")
    if not p or not ouvert(p) or not isinstance(fenetre, dict) or not empreinte_env:
        return False
    fin, generation = fenetre.get("fin"), fenetre.get("generation")
    return (isinstance(fin, int) and time.time() < fin and generation == p["generation"]
            and hmac.compare_digest(p["empreinte"], empreinte_env))


# ---------------------------------------------------------------- sessions

def signature(cle: bytes, champs: list, echeance: int) -> str:
    return acces.signer(cle, "|".join(["mj", *champs, str(echeance)]))


def jeton_de_session(compte: dict, cle: bytes, duree: int) -> str:
    """« compte.génération.appareil.échéance.signature » : l'appareil est tiré au sort à chaque connexion."""
    return acces.jeton_signe([compte["id"], compte["generation"], secrets.token_hex(6)], int(time.time()) + duree,
                             lambda champs, echeance: signature(cle, champs, echeance))


def compte_du_jeton(etat: dict, valeur: str, cle: bytes) -> dict | None:
    """Le compte d'une session encore bonne : signature, échéance, génération en cours, compte ouvert."""
    if not cle:
        return None
    champs = acces.jeton_valide(valeur, lambda c, e: signature(cle, c, e), 3)
    if not champs:
        return None
    c = par_id(etat, champs[0])
    return c if ouvert(c) and str(c["generation"]) == champs[1] else None


# ---------------------------------------------------------------- connexion

def forme_de_connexion(etat: dict, identifiant: str) -> str:
    """L'identifiant tel qu'on le compare ; vide ou « MJ », celui du principal."""
    voulu = comptes.forme(identifiant)
    if voulu in ALIAS_PRINCIPAL:
        p = principal(etat)
        return p["forme"] if p else PRINCIPAL
    return voulu


def pour_connexion(etat: dict, identifiant: str) -> dict | None:
    voulu = forme_de_connexion(etat, identifiant)
    return next((c for c in etat["comptes"] if c["forme"] and c["forme"] == voulu and ouvert(c)), None)


def leurre() -> str:
    # Un identifiant inconnu coûte le même calcul qu'un vrai : la durée de la réponse ne dit pas s'il existe.
    return f"scrypt:{acces.N}:{acces.R}:{acces.P}:{secrets.token_hex(16)}:{secrets.token_hex(32)}"


# ---------------------------------------------------------------- invitations

def empreinte_cle(cle: str) -> str:
    return hashlib.sha256(cle.encode()).hexdigest()


def cle_choisie(cle) -> str:
    if not isinstance(cle, str) or not CLE_INVITATION.fullmatch(cle):
        raise comptes.Refus(400, "Ce lien d'invitation est incomplet : recopiez-le en entier.")
    return cle


def nom_choisi(nom) -> str:
    propre = " ".join(unicodedata.normalize("NFC", nom).split())[:NOM_MAX] if isinstance(nom, str) else ""
    if not propre:
        raise comptes.Refus(400, "Le prénom du MJ, s'il vous plaît.")
    return propre


def slug(texte: str) -> str:
    t = unicodedata.normalize("NFKD", texte or "").encode("ascii", "ignore").decode().lower()
    t = re.sub(r"[^a-z0-9]+", "-", t).strip("-")
    return t[:32].strip("-") or "mj"


def invitation(cle: str) -> dict:
    return {"empreinte": empreinte_cle(cle), "fin": int(time.time()) + DUREE_INVITATION, "cree": maintenant()}


def exiger_ouvertes() -> None:
    if not INVITATIONS_OUVERTES:
        raise comptes.Refus(403, PAS_ENCORE)
    if not invites_permis():
        raise comptes.Refus(403, EN_VEILLE)


def creer_invite(donnees: Path, nom, cle, par: str = PRINCIPAL) -> dict:
    """Un compte invité, à ouvrir par son lien (sept jours). Son identifiant de compte (l'auteur de ses fiches) vient de
    son prénom et ne resert jamais."""
    exiger_ouvertes()
    nom, cle = nom_choisi(nom), cle_choisie(cle)
    with verrou(donnees):
        etat = lire(donnees)
        pris = {c["id"] for c in etat["comptes"]} | {PRINCIPAL, "mj"}
        base = slug(nom)
        ident = base
        while ident in pris:
            ident = f"{base}-{secrets.token_hex(2)}"
        instant = maintenant()
        compte = {"id": ident, "identifiant": "", "forme": "", "nom": nom, "role": "invite", "empreinte": "",
                  "generation": 1, "appareils": [], "invitation": invitation(cle), "budget_mois": BUDGET_DEFAUT,
                  "ferme": None, "cree": instant, "modifie": instant}
        etat["comptes"].append(compte)
        ecrire(donnees, etat)
    noter(donnees, "invitation", ident, par)
    return compte


def invite_de(etat: dict, ident: str) -> dict:
    c = par_id(etat, ident) if isinstance(ident, str) else None
    if not c or c["role"] != "invite":
        raise comptes.Refus(404, "Ce MJ n'existe pas.")
    return c


def nouveau_lien(donnees: Path, ident: str, cle, par: str = PRINCIPAL) -> dict:
    """Un nouveau lien pour un invité : l'ancien ne marche plus, son mot de passe non plus, ses sessions tombent. En
    l'ouvrant, il en choisit un autre (son identifiant ne change pas). Rouvre un compte fermé."""
    exiger_ouvertes()
    cle = cle_choisie(cle)
    with verrou(donnees):
        etat = lire(donnees)
        c = invite_de(etat, ident)
        c.update(empreinte="", invitation=invitation(cle), ferme=None, generation=c["generation"] + 1, modifie=maintenant())
        ecrire(donnees, etat)
    noter(donnees, "nouveau-lien", ident, par)
    return c


def fermer(donnees: Path, ident: str, par: str = PRINCIPAL) -> dict:
    """Un invité qui arrête : ses sessions tombent, son lien et son mot de passe ne marchent plus. Ses fiches restent les
    siennes, invisibles aux autres."""
    with verrou(donnees):
        etat = lire(donnees)
        c = invite_de(etat, ident)
        instant = maintenant()
        c.update(empreinte="", invitation=None, ferme=c.get("ferme") or instant, generation=c["generation"] + 1, modifie=instant)
        ecrire(donnees, etat)
    noter(donnees, "fermeture", ident, par)
    return c


def regler_budget(donnees: Path, ident: str, budget: float, par: str = PRINCIPAL) -> dict:
    """Le budget de rédaction du mois d'un invité (lot MJ-5, budget_mj.py), en dollars : la garde le lit avant chaque
    appel. Un compte fermé le garde, pour le jour où il rouvre."""
    with verrou(donnees):
        etat = lire(donnees)
        c = invite_de(etat, ident)
        c.update(budget_mois=budget, modifie=maintenant())
        ecrire(donnees, etat)
    noter(donnees, "budget", ident, par)
    return c


def suite_choisie(suite) -> str:
    """Le nom d'une suite tel qu'il s'enregistre : une ligne, sans caractère de contrôle ; vide, la suite par défaut."""
    propre = " ".join(unicodedata.normalize("NFC", suite).split()) if isinstance(suite, str) else ""
    propre = "".join(ch for ch in propre if ch.isprintable())
    if len(propre) > SUITE_MAX:
        raise comptes.Refus(400, f"Le nom de votre suite : {SUITE_MAX} caractères au plus.")
    return propre


def suite_de(c) -> str | None:
    """Le nom de la suite des séances de ce compte : None pour le principal (« Séance N »). Un auteur inconnu (compte
    effacé) ou un invité qui n'en a pas choisi : la suite par défaut."""
    if isinstance(c, dict) and c.get("role") == "principal":
        return None
    nom = c.get("suite") if isinstance(c, dict) else None
    return nom if isinstance(nom, str) and nom.strip() else SUITE_DEFAUT


def regler_suite(donnees: Path, ident: str, suite) -> dict:
    """Le nom que l'invité donne à sa suite (« Quête annexe » par défaut). Un compte fermé le garde."""
    suite = suite_choisie(suite)
    with verrou(donnees):
        etat = lire(donnees)
        c = invite_de(etat, ident)
        c.update(suite=suite or None, modifie=maintenant())
        ecrire(donnees, etat)
    noter(donnees, "suite", ident, ident)
    return c


def invite_par_cle(etat: dict, cle: str) -> dict | None:
    """Le compte dont l'invitation porte cette clé, encore valable ; sinon None (expirée, déjà servie, remplacée)."""
    voulue = empreinte_cle(cle)
    for c in etat["comptes"]:
        inv = c.get("invitation")
        if (c["role"] == "invite" and isinstance(inv, dict) and isinstance(inv.get("empreinte"), str)
                and hmac.compare_digest(inv["empreinte"], voulue)):
            return c if isinstance(inv.get("fin"), int) and time.time() < inv["fin"] and not c.get("ferme") else None
    return None


LIEN_PERIME = "Ce lien ne marche plus : il a déjà servi, il a expiré, ou un nouveau l'a remplacé. Demandez-en un autre."


def etat_invitation(donnees: Path, cle) -> dict:
    """Ce que la page d'invitation propose : créer son accès (identifiant et mot de passe) ou, après un nouveau lien,
    choisir un nouveau mot de passe. Jamais d'empreinte."""
    exiger_ouvertes()
    c = invite_par_cle(lire(donnees), cle_choisie(cle))
    if not c:
        raise comptes.Refus(410, LIEN_PERIME)
    return {"etat": "reinitialiser" if c["identifiant"] else "creer", "nom": c["nom"], "identifiant": c["identifiant"]}


def identifiant_libre(etat: dict, identifiant, compte: dict) -> str:
    propre = comptes.identifiant_choisi(identifiant)
    voulu = comptes.forme(propre)
    if voulu in ALIAS_PRINCIPAL or any(c["forme"] == voulu for c in etat["comptes"] if c is not compte):
        raise comptes.Refus(409, "Cet identifiant est déjà pris : choisissez-en un autre.")
    return propre


def accepter(donnees: Path, cle, identifiant, empreinte: str) -> dict:
    """L'invitation ouverte : l'identifiant choisi (s'il n'en a pas encore) et l'empreinte du mot de passe. Le lien ne
    resert pas ; la génération monte."""
    exiger_ouvertes()
    cle = cle_choisie(cle)
    with verrou(donnees):
        etat = lire(donnees)
        c = invite_par_cle(etat, cle)
        if not c:
            raise comptes.Refus(410, LIEN_PERIME)
        if not c["identifiant"]:
            propre = identifiant_libre(etat, identifiant, c)
            c.update(identifiant=propre, forme=comptes.forme(propre))
        c.update(empreinte=empreinte, invitation=None, generation=c["generation"] + 1, modifie=maintenant())
        ecrire(donnees, etat)
    noter(donnees, "invitation-ouverte", c["id"], c["id"])
    return c


# ---------------------------------------------------------------- ce qu'en voient les pages

def etat_dit(c: dict) -> str:
    if c["role"] == "principal":
        return "principal"
    if c.get("ferme"):
        return "ferme"
    inv = c.get("invitation")
    if isinstance(inv, dict):
        return "lien-a-ouvrir" if isinstance(inv.get("fin"), int) and time.time() < inv["fin"] else "lien-expire"
    return "actif" if c.get("empreinte") else "sans-acces"


def vu_par_le_principal(c: dict) -> dict:
    """Un compte tel que le montre l'atelier : ni empreinte, ni clé, ni génération."""
    inv = c.get("invitation") if isinstance(c.get("invitation"), dict) else None
    fin = inv.get("fin") if inv else None
    # Ni le nom de sa suite : tel qu'il l'a tapé, il pourrait nommer un de ses secrets (les joueurs et la TV en lisent la
    # forme publique, main.suite_publique).
    return {"id": c["id"], "nom": c["nom"], "identifiant": c["identifiant"], "role": c["role"], "etat": etat_dit(c),
            "invitation_jusqu_a": datetime.fromtimestamp(fin).isoformat(timespec="minutes") if isinstance(fin, int) else None,
            "budget_mois": c.get("budget_mois"), "ferme": c.get("ferme")}


def moi(c: dict | None) -> dict:
    """Le compte de la requête, pour /api/moi."""
    if not c:
        return {"compte": PRINCIPAL, "nom": NOM_PRINCIPAL, "role": "principal"}
    sortie = {"compte": c["id"], "nom": c["nom"], "role": c["role"]}
    if c["role"] == "invite":
        sortie["suite"] = suite_de(c)
    return sortie
