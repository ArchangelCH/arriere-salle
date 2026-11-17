"""Deux MJ pour les essais du cloisonnement : Alban, le compte principal, et Léa, une MJ invitée, chacun avec
sa session de l'atelier en ligne. Moyen réservé aux essais : le compte invité est écrit directement dans
data/mj/comptes.json (comptes_mj.py), jamais par l'interface, puisque les invitations restent fermées jusqu'au lot MJ-7.

Usage, dans un fixture qui tient un pytest.MonkeyPatch :
    alban, lea = deux_mj.ouvrir(monkeypatch)
    client.get("/api/pnj", headers=lea)

Depuis le lot MJ-7, un invité n'entre qu'avec le cloisonnement en strict (comptes_mj.invites_permis). Les essais du
journal de veille ont besoin de Léa dans un atelier en veille : ouvrir() la laisse entrer en veille, sauf
garde_stricte=True, qui éprouve la garde elle-même.
"""
import hashlib
import shutil

from mj import comptes_mj
import main
from api import config, portier  # noqa: E402

HOTE = "atelier-deux-mj.example.ch"
IP = "203.0.113.31"
MDP = "fougere-lanterne-corbeau-91"
CLE = b"cle-de-session-des-essais-mj3"
INVITE = "lea"


def empreinte(mdp: str) -> str:
    sel = b"fedcba9876543210"
    h = hashlib.scrypt(mdp.encode(), salt=sel, n=2 ** 10, r=8, p=1, dklen=32)
    return f"scrypt:{2 ** 10}:8:1:{sel.hex()}:{h.hex()}"


def entetes(compte: dict) -> dict:
    """Les en-têtes d'une requête de ce compte : l'atelier en ligne, sa session, son origine (pour écrire)."""
    jeton = comptes_mj.jeton_de_session(compte, CLE, 3600)
    return {"Host": HOTE, "CF-Connecting-IP": IP, "Origin": f"https://{HOTE}", "Cookie": f"{portier.COOKIE_SESSION}={jeton}"}


def ouvrir(mp, garde_stricte: bool = False) -> tuple[dict, dict]:
    """Les en-têtes d'Alban et de Léa. mp : un pytest.MonkeyPatch (défait à la fin du fixture)."""
    mp.setattr(portier, "ATELIER_PUBLIC", {HOTE})
    mp.setattr(portier, "HOTES", portier.HOTES | {HOTE})
    mp.setattr(portier, "EMPREINTE_MDP", empreinte(MDP))
    mp.setattr(portier, "CLE_SESSION", CLE)
    mp.setattr(comptes_mj, "INVITATIONS_OUVERTES", True)
    mp.setattr(comptes_mj, "ESSAI_INVITE_EN_VEILLE", not garde_stricte)
    shutil.rmtree(comptes_mj.dossier(config.DONNEES), ignore_errors=True)
    etat = comptes_mj.assurer_principal(config.DONNEES, portier.EMPREINTE_MDP)
    with comptes_mj.verrou(config.DONNEES):
        etat = comptes_mj.lire(config.DONNEES)
        instant = comptes_mj.maintenant()
        etat["comptes"].append({"id": INVITE, "identifiant": "lea", "forme": "lea", "nom": "Léa", "role": "invite",
                                "empreinte": empreinte("cire-et-chandelle-12"), "generation": 1, "appareils": [],
                                "invitation": None, "budget_mois": comptes_mj.BUDGET_DEFAUT, "ferme": None,
                                "cree": instant, "modifie": instant})
        comptes_mj.ecrire(config.DONNEES, etat)
    return entetes(comptes_mj.principal(etat)), entetes(comptes_mj.par_id(etat, INVITE))


def fermer() -> None:
    shutil.rmtree(comptes_mj.dossier(config.DONNEES), ignore_errors=True)
