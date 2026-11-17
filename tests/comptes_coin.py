"""Pour les essais : entrer au coin des joueurs comme le fait un joueur (comptes.py, provisoires.py). Le MJ lui tire un
mot de passe provisoire, comme « Créer son compte » dans l'atelier ; le joueur se connecte avec, puis choisit le sien.
Un joueur qui a déjà son compte se connecte simplement. Plus aucun lien à clé : un joueur se désigne par son identifiant
de joueur (ou sa carte de l'atelier)."""
import re
import secrets

from commun import acces
from commun import comptes
import joueurs
from commun import provisoires

MOT_DE_PASSE = "lanterne et corbeau"


def ident_de(joueur) -> str:
    return joueur["id"] if isinstance(joueur, dict) else joueur


def provisoire(joueur, identifiant: str | None = None) -> str:
    """Ce que fait « Créer son compte » (ou « Nouveau mot de passe provisoire ») dans l'atelier : un provisoire tiré et
    posé pour ce joueur dans le dépôt du coin. Rendu en clair, comme le dialogue du MJ le montre une fois."""
    mot = provisoires.tirer()
    provisoires.poser(joueurs.DEPOT, ident_de(joueur), identifiant or f"essai-{secrets.token_hex(4)}",
                      acces.empreinte(provisoires.canonique(mot)))
    return mot


def entrer(client, joueur, identifiant: str | None = None, mot_de_passe: str = MOT_DE_PASSE) -> str:
    """Connecte ce client (son appareil). Sans compte : le provisoire du MJ, puis le choix du mot de passe. Avec : la
    connexion. Rend l'adresse où le coin envoie ensuite le joueur."""
    ident = ident_de(joueur)
    compte = comptes.lire(joueurs.DEPOT, ident)
    if compte and not provisoires.en_cours(joueurs.DEPOT, ident, compte):
        r = client.post("/api/connexion", json={"identifiant": compte["identifiant"], "mot_de_passe": mot_de_passe})
        assert r.status_code == 200, r.text
        return r.json()["suite"]
    mot = provisoire(ident, identifiant)
    r = client.post("/api/connexion", json={"identifiant": provisoires.lire(joueurs.DEPOT, ident)["identifiant"], "mot_de_passe": mot})
    assert r.status_code == 200 and r.json()["choisir"], r.text
    r = client.post("/api/compte", json={"mot_de_passe": mot_de_passe, "confirmation": mot_de_passe})
    assert r.status_code == 200, r.text
    return r.json()["suite"]


def jeton_de(joueur) -> str:
    """Le jeton interne du joueur (joueurs.json de l'atelier), pour les tests de fuite : il ne doit sortir nulle part."""
    import main  # noqa: F401
    from api import joueurs_mj
    return next(j["jeton"] for j in joueurs_mj.joueurs_lus() if j["id"] == ident_de(joueur))


def sans_version(texte: str) -> str:
    """Une page du coin met une empreinte dans l'adresse de ses fichiers (/static/v-<empreinte>/…) : ce que les essais lisent
    d'elle, c'est l'adresse sans l'empreinte."""
    return re.sub(r"/static/v-[0-9a-f]{10}/", "/static/", texte)
