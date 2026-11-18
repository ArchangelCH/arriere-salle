"""La réserve des dés d'aventure (lot G, règle optionnelle du kit, chapitre 08).

Le groupe possède quatre D6, les dés d'aventure ; le MJ commence sans rien. Chaque dé qu'un joueur ajoute à son test passe
dans la réserve du MJ, où il devient un dé de mésaventure ; chaque dé de mésaventure que le MJ fait rouler revient au
groupe. Le total ne change pas, sauf quand le MJ le règle (à la table, on joue aussi avec de vrais dés).

L'état tient dans data/des-aventure.json, écrit par l'atelier seul (le coin n'y a pas accès) et toujours sous le verrou
de la file des demandes (demandes.verrou) : le dé jeté par la boîte, l'annulation du MJ, le réglage à la main et le dé de
mésaventure imposé passent l'un après l'autre, et le total tient. Les fonctions de ce module qui changent l'état ne
prennent pas ce verrou : celui qui les appelle le tient déjà (la boîte quand elle applique, les routes du MJ autrement),
et un second flock du même processus sur le même fichier attendrait pour toujours.

  - actif : la règle est en jeu (interrupteur « Dés d'aventure » de l'onglet Table), éteinte par défaut ;
  - groupe, mj : les deux réserves ;
  - mesaventures : {joueur : {id, heros, face, pose}}, le dé de mésaventure annoncé pour le prochain test de ce joueur.
    face : celle que le MJ a choisie parce que le héros porte un désavantage, sinon None (le dé roulera).

Ce que voient la TV, le coin et le Tableau (publique) : les deux nombres, rien d'autre.
"""
import secrets
from datetime import datetime
from pathlib import Path

from commun import demandes
from commun import des
from commun.demandes import Refus
from commun import stockage

FICHIER = "des-aventure.json"
TOTAL_DEFAUT = 4
TOTAL_MAX = 12
ETEINTE = "La règle des dés d'aventure est éteinte : activez-la dans l'onglet Table."
GROUPE_VIDE = "Le groupe n'a plus de dé d'aventure."
MJ_VIDE = "Votre réserve de dés de mésaventure est vide."


def maintenant() -> str:
    return datetime.now().isoformat(timespec="milliseconds")


def _compte(v) -> int:
    return v if isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= TOTAL_MAX else 0


def normaliser(r) -> dict:
    """L'état tel qu'il se relit : un fichier absent ou abîmé donne la règle éteinte, quatre dés au groupe."""
    r = r if isinstance(r, dict) else {}
    if not isinstance(r.get("groupe"), int) and not isinstance(r.get("mj"), int):
        groupe, mj = TOTAL_DEFAUT, 0
    else:
        groupe, mj = _compte(r.get("groupe")), _compte(r.get("mj"))
    mesaventures = {}
    for joueur, m in (r.get("mesaventures") or {}).items() if isinstance(r.get("mesaventures"), dict) else ():
        if isinstance(joueur, str) and demandes.ID_JOUEUR.match(joueur) and isinstance(m, dict) and isinstance(m.get("id"), str):
            mesaventures[joueur] = {"id": m["id"][:24], "heros": m.get("heros") if isinstance(m.get("heros"), str) else "",
                                    "face": des.face(m.get("face")),
                                    "pose": m.get("pose") if isinstance(m.get("pose"), str) else ""}
    return {"actif": r.get("actif") is True, "groupe": groupe, "mj": mj, "mesaventures": mesaventures}


def total(r: dict) -> int:
    return r["groupe"] + r["mj"]


def libres(r: dict, sauf: str = "") -> int:
    """Les dés de mésaventure que le MJ peut encore annoncer : sa réserve, moins ceux déjà annoncés (sauf pour ce joueur,
    dont l'annonce serait remplacée)."""
    return r["mj"] - sum(1 for j in r["mesaventures"] if j != sauf)


def publique(r: dict) -> dict | None:
    """Ce que voient la TV, le coin et la table publique : les deux réserves, quand la règle est en jeu."""
    return {"aventure": r["groupe"], "mesaventure": r["mj"]} if r["actif"] else None


# ---------------------------------------------------------------- les gestes (sous le verrou de la file)

def regler(r: dict, actif=None, nouveau_total=None, remettre=False) -> dict:
    """L'interrupteur et le total. Un total plus grand ajoute des dés au groupe ; plus petit, il en retire au groupe
    d'abord, puis au MJ. Éteinte, la règle oublie les dés de mésaventure annoncés. remettre : tous les dés au groupe, comme
    au début d'une séance (le MJ commence sans rien), et plus aucune annonce."""
    if actif is not None:
        if not isinstance(actif, bool):
            raise Refus(400, "« actif » : vrai ou faux.")
        r["actif"] = actif
        if not actif:
            r["mesaventures"] = {}
    if nouveau_total is not None:
        if isinstance(nouveau_total, bool) or not isinstance(nouveau_total, int) or not 1 <= nouveau_total <= TOTAL_MAX:
            raise Refus(400, f"Le total des dés d'aventure va de 1 à {TOTAL_MAX}.")
        ecart = nouveau_total - total(r)
        if ecart > 0:
            r["groupe"] += ecart
        else:
            moins = min(r["groupe"], -ecart)
            r["groupe"] -= moins
            r["mj"] -= -ecart - moins
    if remettre is True:
        r["groupe"], r["mj"], r["mesaventures"] = total(r), 0, {}
    return r


def passer(r: dict, vers: str) -> dict:
    """Un dé passe à la main d'une réserve à l'autre : « mj » (un dé d'aventure joué à la table) ou « groupe »."""
    if vers == "mj":
        if r["groupe"] < 1:
            raise Refus(409, GROUPE_VIDE)
        r["groupe"] -= 1
        r["mj"] += 1
    elif vers == "groupe":
        if r["mj"] < 1:
            raise Refus(409, MJ_VIDE)
        r["mj"] -= 1
        r["groupe"] += 1
    else:
        raise Refus(400, "« vers » : « mj » ou « groupe ».")
    return r


def prendre(r: dict) -> bool:
    """Un joueur ajoute un dé d'aventure à son test : il passe au MJ. Faux si la règle est éteinte ou le groupe à sec."""
    if not r["actif"] or r["groupe"] < 1:
        return False
    r["groupe"] -= 1
    r["mj"] += 1
    return True


def prendre_mesaventure(r: dict) -> bool:
    """Un joueur ajoute à son test le dé de mésaventure que son MJ lui demande : un dé libre de la réserve du MJ (pas un
    de ceux qu'il a annoncés à d'autres) roule et revient au groupe, comme un dé de mésaventure joué. Faux si la règle est
    éteinte ou si aucun dé n'est libre."""
    if not r["actif"] or libres(r) < 1:
        return False
    r["mj"] -= 1
    r["groupe"] += 1
    return True


def rendre_mesaventure(r: dict) -> None:
    """Le MJ annule le dé de mésaventure qu'un joueur a ajouté : il revient dans sa réserve."""
    if r["groupe"] < 1:
        raise Refus(409, "La réserve du groupe est vide : ce dé ne peut plus revenir chez vous. Réglez les réserves à la main.")
    r["groupe"] -= 1
    r["mj"] += 1


def rendre(r: dict) -> None:
    """Le MJ annule un dé d'aventure joué : il revient au groupe. Refus si la réserve du MJ est vide entre-temps."""
    if r["mj"] < 1:
        raise Refus(409, "Votre réserve est vide : ce dé ne peut plus revenir au groupe. Réglez les réserves à la main.")
    r["mj"] -= 1
    r["groupe"] += 1


def imposer(r: dict, joueur: str, heros: str, face: int | None) -> dict:
    """« Dé de mésaventure au prochain test de X » : un seul par joueur (une nouvelle annonce remplace l'ancienne), et pas
    plus que la réserve du MJ."""
    if not r["actif"]:
        raise Refus(409, ETEINTE)
    if libres(r, sauf=joueur) < 1:
        raise Refus(409, MJ_VIDE if r["mj"] < 1 else "Chaque dé de votre réserve est déjà annoncé.")
    m = {"id": secrets.token_hex(6), "heros": heros, "face": face, "pose": maintenant()}
    r["mesaventures"][joueur] = m
    return m


def retirer(r: dict, joueur: str) -> dict | None:
    return r["mesaventures"].pop(joueur, None)


def consommer(r: dict, joueur: str) -> tuple[dict | None, bool]:
    """Le test du joueur roule : le dé de mésaventure annoncé pour lui, consommé une seule fois. (annonce, roule) : roule
    est faux quand la réserve du MJ s'est vidée entre-temps (le test part sans, et le dit)."""
    m = r["mesaventures"].pop(joueur, None) if r["actif"] else None
    if m is None:
        return None, False
    if r["mj"] < 1:
        return m, False
    r["mj"] -= 1
    r["groupe"] += 1
    return m, True


# ---------------------------------------------------------------- le fichier

class Reserve:
    def __init__(self, donnees: Path):
        self.fichier = donnees / FICHIER

    def lire(self) -> dict:
        try:
            return normaliser(stockage.lire_json(self.fichier))
        except (OSError, ValueError):
            return normaliser(None)

    def ecrire(self, r: dict) -> None:
        """Sous le verrou de la file des demandes. Écriture atomique : la TV et le coin ne lisent jamais un état à moitié."""
        self.fichier.parent.mkdir(parents=True, exist_ok=True)
        stockage.ecrire_json_compact(self.fichier, {**normaliser(r), "modifie": maintenant()})


_CACHE: dict = {}


def publique_du_fichier(donnees: Path) -> dict | None:
    """Les deux réserves pour l'état public de la TV (main.etat_public, appelé à chaque envoi, 220 ms en mode « Suivre ») :
    relues seulement quand le fichier a bougé."""
    chemin = donnees / FICHIER
    try:
        st = chemin.stat()
        cle = (str(chemin), st.st_ino, st.st_size, st.st_mtime_ns)
    except OSError:
        return None
    if _CACHE.get("cle") != cle:
        _CACHE.clear()
        _CACHE.update(cle=cle, valeur=publique(Reserve(donnees).lire()))
    return dict(_CACHE["valeur"]) if _CACHE["valeur"] else None
