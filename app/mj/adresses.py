"""À qui revient quoi entre les deux MJ (deuxième accès MJ, lot MJ-4) : ce que le lot MJ-3 avait fermé au compte
principal faute de savoir le partager, rouvert à chacun pour ce qui le concerne.

- Les MJ qui ouvrent l'atelier (ouverts) : le principal toujours, un invité dont le compte laisse entrer
  (comptes_mj.ouvert). Tant qu'il n'y en a pas d'autre, tout revient au principal, comme avant.
- Le canal des pages de l'atelier (/ws/atelier, main.Diffusion) : un message part à toutes les pages (l'état public de
  la TV, les sacs, la salle, les jets) ou seulement à celles du MJ qu'il concerne (pour) : sa boîte des demandes, le
  combat de sa séance, les pions bougés sur son plan, ses billets privés. adresse_a le dit, page par page.
- La main sur la TV : l'état de la table porte « par », le compte qui y a envoyé ce qu'elle montre (absent : le
  principal, comme le champ « auteur » des fiches). Changer ce qu'elle montre quand l'autre MJ l'a la main demande
  « reprendre » (la page a posé la question « La reprendre ? ») ; un cadrage, une version relue ne prennent rien.
  « par » reste dans l'atelier : etat_public (la TV, la table publique, le coin) ne le connaît pas.

Le relais de la télécommande, un par compte, est dans main.py (relais_du_lecteur). Seules ouverts, connus et nom_ouvert
lisent un fichier (data/mj/comptes.json, sans rien écrire) ; le reste est pur.
"""
from pathlib import Path

from mj import cloisonnement
from mj import comptes_mj
from mj.proprietes import NOM_PRINCIPAL, PRINCIPAL


def _comptes(donnees: Path) -> list:
    try:
        return comptes_mj.lire(donnees)["comptes"]
    except comptes_mj.Illisible:
        return []


def ouverts(donnees: Path) -> list[dict]:
    """Les MJ qui ouvrent l'atelier, le principal d'abord : [{"id", "nom"}]. Un fichier illisible : le principal seul."""
    comptes = _comptes(donnees)
    p = next((c for c in comptes if c["id"] == PRINCIPAL), None)
    sortie = [{"id": PRINCIPAL, "nom": (p or {}).get("nom") or NOM_PRINCIPAL}]
    sortie += [{"id": c["id"], "nom": c["nom"]} for c in comptes if c["role"] == "invite" and comptes_mj.ouvert(c)]
    return sortie


def connus(donnees: Path) -> set[str]:
    """Tous les comptes, fermés compris : un mot adressé à un MJ qui a fermé reste à lui, il ne passe pas à l'autre."""
    return {PRINCIPAL} | {c["id"] for c in _comptes(donnees)}


def nom_ouvert(donnees: Path, compte: str) -> str:
    """Le nom d'un MJ qui ouvre l'atelier, sinon "" (un compte fermé ne tient plus la main sur la TV)."""
    return next((c["nom"] for c in ouverts(donnees) if c["id"] == compte), "")


# ---------------------------------------------------------------- le canal des pages de l'atelier

def adresse_a(pour, compte: str) -> bool:
    """Une page de ce compte reçoit-elle ce message ? Oui s'il part à tous (pour None) ou s'il est le sien ; celui de
    l'autre MJ, noté en veille (il arrive quand même, rien ne change), refusé en strict."""
    return pour is None or pour == compte or not cloisonnement.refuse("message-d-un-autre")


# ---------------------------------------------------------------- la main sur la TV

# Ce qui ne change pas ce que montre la TV : un cadrage, un style, une version relue, l'heure du dernier envoi, et ce que
# le serveur tient lui-même (les horloges, le bandeau du combat, la main).
RAFRAICHIS = ("maj", "version", "camera", "style", "horloges", "combat", "combat_maj", "par", "par_nom", "reprendre")


def vue_de(etat: dict) -> dict:
    """Ce que montre la TV, sans ce qui ne fait que le rafraîchir : deux états égaux ici, la main ne change pas."""
    return {k: v for k, v in (etat or {}).items()
            if v is not None and k not in RAFRAICHIS and not k.endswith("_maj") and k not in ("ecrans", "ecrans_salon",
                                                                                              "ecrans_internet", "publique")}


def tenant(etat: dict) -> str:
    """Le compte qui a la main sur la TV : « par », sinon le principal."""
    par = (etat or {}).get("par")
    return par if isinstance(par, str) and comptes_mj.ID_COMPTE.fullmatch(par) else PRINCIPAL


def poser_par(etat: dict, compte: str) -> dict:
    """Le principal ne s'écrit pas (absent vaut lui) : sans invité, l'état de la table reste à l'octet près."""
    if compte == PRINCIPAL:
        etat.pop("par", None)
    else:
        etat["par"] = compte
    return etat


def question(autre: str, nom: str) -> dict:
    """La réponse 409 d'un envoi à la TV quand l'autre MJ a la main : la page pose « La reprendre ? » (api.js, mj/main-tv.js)
    et renvoie la même requête avec « reprendre »."""
    return {"detail": f"{nom} garde la main sur la TV.", "question": {"genre": "main-tv", "par": autre, "nom": nom}}
