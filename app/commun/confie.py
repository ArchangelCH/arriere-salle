"""« Pour le MJ seulement », partagé par le coin des joueurs et l'atelier : au bas de « L'histoire de mon héros »,
le joueur confie à son MJ ce que lui seul doit savoir (un secret, une peur, une envie d'intrigue, une limite). Un seul
passage libre, aux bornes des autres (lore.LONG). Pas de validation : « Envoyer au MJ » le dépose sur la fiche du héros,
dans un champ que seul l'atelier lit (CHAMP).

Le circuit, un écrivain par fichier :
  - propositions/confie/<joueur>.json, écrit par le coin seul, sous son verrou : le brouillon (enregistré au fil de la
    frappe) et ce que le joueur a envoyé en dernier, pour qu'il le relise : {ref, brouillon, envoye, modifie} ;
  - « Envoyer au MJ » écrit une demande « confie » {ref, passage} dans la file du joueur (demandes.py), appliquée seule
    par l'atelier (confie_mj.py) : le texte va sur la fiche, puis la demande n'en garde que la longueur ; le texte ne
    reste pas dans la file, que la boîte du MJ lit en entier ;
  - propositions/confie-lu/<joueur>.json, écrit par l'atelier seul : le reçu de ce qui est sur la fiche, {envoi, lu},
    jamais le texte. Le coin y lit « lu par votre MJ ».

Ce texte ne va nulle part ailleurs : ni carnet (pas même « Mon héros »), ni TV, ni table publique, ni bible, ni PDF, ni
aide à l'écriture (aucune aide sur ce passage, et le genre « aide » n'accepte que les passages du récit), ni Telegram (le
prénom et le genre seulement). Dans l'atelier, il est traité comme le secret d'un héros.

Ce module ne lit rien de l'atelier : joueurs.py et confie_mj.py l'importent tous deux.
"""
from contextlib import contextmanager
from pathlib import Path

from commun import demandes
from commun import lore
from commun.demandes import Genre, Refus
from commun import stockage

GENRE = "confie"
DOSSIER = "confie"  # le brouillon et l'envoi, écrits par le coin
LUS = "confie-lu"  # les reçus, écrits par l'atelier
VERROU = ".verrou"
# Le champ de la fiche du héros, réservé au MJ : {texte, envoye, lu, envoi, joueur}.
CHAMP = "confie_au_mj"
LONG = lore.LONG
ECRITURE_OCTETS_MAX = 48 * 1024  # une requête (enregistrer ou envoyer) : le passage entier, ses accents compris
FICHIER_OCTETS_MAX = 160 * 1024
RECU_OCTETS_MAX = 4 * 1024
REF = lore.REF
ID_ENVOI = demandes.ID_DEMANDE

VIDE = "Écrivez quelques mots pour votre MJ."
PAR_LA_PAGE = "Ce passage s'envoie depuis la page « L'histoire de mon héros »."
AUTRE_HEROS = "Votre héros a changé depuis : rien n'a été déposé, la page se relit."


def valider(corps) -> dict:
    """{ref, passage} : ref, le jeton du héros dans la compagnie publiée ; passage, le texte du joueur, propre et aux
    bornes des autres passages. Vide, il ne part pas."""
    corps = demandes.seulement(corps, {"ref", "passage"}, "Pour le MJ seulement")
    ref = corps.get("ref")
    if not isinstance(ref, str) or not REF.match(ref):
        raise Refus(400, AUTRE_HEROS)
    passage = lore.propre(corps.get("passage", ""), "Ce passage")
    if not passage:
        raise Refus(400, VIDE)
    return {"ref": ref, "passage": passage}


# Appliqué seul par l'atelier (pas de validation du MJ) ; carnet fermé, il ne part pas (comme l'histoire). Telegram dit le
# prénom et le genre, jamais le texte.
demandes.enregistrer(Genre(GENRE, "Pour le MJ seulement", ("un passage pour toi seul", "{n} passages pour toi seul"), attente=False,
                           valider=valider, carnet=True,
                           statuts={demandes.APPLIQUEE: "déposé sur la fiche", demandes.ECHEC: "pas déposé"}))


def apres_application(corps) -> dict:
    """Ce que la file garde d'un envoi une fois traité (ou retiré) : la longueur du texte, rien de lui. Un corps déjà réduit
    garde sa longueur."""
    if isinstance(corps, dict) and "passage" not in corps and isinstance(corps.get("signes"), int):
        return {"signes": corps["signes"]}
    texte = corps.get("passage") if isinstance(corps, dict) else None
    return {"signes": len(texte) if isinstance(texte, str) else 0}


# ---------------------------------------------------------------- les fichiers

@contextmanager
def verrou(depot: Path):
    with stockage.verrou_de_dossier(depot / DOSSIER, VERROU):
        yield


def _chemin(depot: Path, dossier: str, joueur: str) -> Path:
    if not isinstance(joueur, str) or not demandes.ID_JOUEUR.match(joueur):
        raise Refus(403, "Accès invalide")
    return depot / dossier / f"{joueur}.json"


def fichier(depot: Path, joueur: str) -> Path:
    return _chemin(depot, DOSSIER, joueur)


def fichier_recu(depot: Path, joueur: str) -> Path:
    return _chemin(depot, LUS, joueur)


def _ecrire(chemin: Path, contenu: dict) -> None:
    chemin.parent.mkdir(parents=True, exist_ok=True)
    stockage.ecrire_json_compact(chemin, contenu, mode=0o600)


def _lire(chemin: Path, maximum: int):
    try:
        if chemin.stat().st_size > maximum:
            return None
        return stockage.lire_json(chemin)
    except (OSError, ValueError):
        return None


def vide() -> dict:
    return {"ref": None, "brouillon": None, "envoye": None, "modifie": None}


def lire(depot: Path, joueur: str) -> dict:
    """Le fichier du joueur ; abîmé, trop lourd ou absent, il vaut un fichier vide, une entrée abîmée s'en va."""
    f = _lire(fichier(depot, joueur), FICHIER_OCTETS_MAX)
    if not isinstance(f, dict):
        return vide()
    b, e = f.get("brouillon"), f.get("envoye")
    brouillon = ({"texte": b["texte"], "modifie": str(b.get("modifie") or "")}
                 if isinstance(b, dict) and isinstance(b.get("texte"), str) and len(b["texte"]) <= LONG else None)
    envoye = ({"id": e["id"], "texte": e["texte"], "quand": str(e.get("quand") or "")}
              if isinstance(e, dict) and isinstance(e.get("id"), str) and ID_ENVOI.match(e["id"]) and isinstance(e.get("texte"), str)
              and len(e["texte"]) <= LONG else None)
    ref = f.get("ref") if isinstance(f.get("ref"), str) and REF.match(f["ref"]) else None
    return {"ref": ref, "brouillon": brouillon, "envoye": envoye, "modifie": f.get("modifie") if isinstance(f.get("modifie"), str) else None}


def ecrire(depot: Path, joueur: str, f: dict) -> None:
    """À appeler sous le verrou. Sans brouillon ni envoi, le fichier s'efface."""
    chemin = fichier(depot, joueur)
    if not f.get("brouillon") and not f.get("envoye"):
        chemin.unlink(missing_ok=True)
        return
    _ecrire(chemin, f)


def lire_recu(depot: Path, joueur: str) -> dict | None:
    """Le reçu publié par l'atelier : {envoi, lu}, ou None."""
    r = _lire(fichier_recu(depot, joueur), RECU_OCTETS_MAX)
    if not isinstance(r, dict) or not isinstance(r.get("envoi"), str) or not ID_ENVOI.match(r["envoi"]):
        return None
    lu = r.get("lu") if isinstance(r.get("lu"), str) and len(r["lu"]) <= 40 else None
    return {"envoi": r["envoi"], "lu": lu}


def ecrire_recu(depot: Path, joueur: str, envoi: str, lu: str | None) -> None:
    """Écrit par l'atelier seul : jamais le texte."""
    if not isinstance(envoi, str) or not ID_ENVOI.match(envoi):
        raise ValueError("Envoi invalide")
    _ecrire(fichier_recu(depot, joueur), {"envoi": envoi, "lu": lu if isinstance(lu, str) else None})


def oublier(depot: Path, joueur: str) -> None:
    """Le joueur retiré : son reçu s'efface (son brouillon part à la corbeille de l'atelier, main.py)."""
    fichier_recu(depot, joueur).unlink(missing_ok=True)


# ---------------------------------------------------------------- le brouillon

def courant(f: dict, ref: str) -> dict:
    """Le fichier de ce héros-ci : écrit pour un autre (le MJ a confié un autre héros au joueur), il ne compte plus."""
    return f if f.get("ref") == ref else vide() | {"ref": ref}


def enregistrer(f: dict, ref: str, texte, instant: str) -> dict:
    """Le fichier après une frappe du joueur : le texte tapé devient le brouillon, sauf s'il redit ce qui est déjà
    confié (le brouillon s'efface). Trop long, il est refusé plutôt que coupé."""
    t = lore.brut(texte)
    if len(t) > LONG:
        raise Refus(413, f"Ce passage est trop long : {LONG} signes au plus.")
    f = courant(f, ref)
    envoye = f["envoye"]
    if (envoye and lore.propre(t) == envoye["texte"]) or (not envoye and not lore.propre(t)):
        brouillon = None
    else:
        brouillon = {"texte": t, "modifie": instant}
    return f | {"brouillon": brouillon, "modifie": instant}


def effacer_brouillon(f: dict, ref: str, instant: str) -> dict:
    return courant(f, ref) | {"brouillon": None, "modifie": instant}


def apres_envoi(f: dict, ref: str, d: dict) -> dict:
    """Le fichier après « Envoyer au MJ » : ce qui part devient ce que le joueur relit, le brouillon s'efface."""
    return courant(f, ref) | {"brouillon": None, "envoye": {"id": d["id"], "texte": d["corps"]["passage"], "quand": d["cree"]},
                              "modifie": d["cree"]}


# ---------------------------------------------------------------- ce que la page du joueur montre

def etat_envoi(envoye: dict, liste: list, recu: dict | None) -> tuple[str, str | None, str]:
    """(état, lu, phrase d'un échec) du dernier envoi : « depose » quand l'atelier en a publié le reçu (ou appliqué la
    demande), « en-route » tant qu'il ne l'a pas vu, « pas-depose » (un échec, sa phrase), « retire ». Une demande
    sortie de la file sans reçu : « envoye », sans plus."""
    if recu and recu["envoi"] == envoye["id"]:
        return "depose", recu["lu"], ""
    d = demandes.trouver(liste, envoye["id"])
    if d is None:
        return "envoye", None, ""
    if d["statut"] == demandes.APPLIQUEE:
        return "depose", None, ""
    if d["statut"] == demandes.ECHEC:
        return "pas-depose", None, str(d.get("resultat") or "")[:demandes.RESULTAT_MAX]
    if d["statut"] == demandes.RETIREE:
        return "retire", None, ""
    return "en-route", None, ""


def vue(f: dict, ref: str, liste: list, recu: dict | None, pause: bool) -> dict:
    """Le passage « Pour le MJ seulement » : le brouillon en cours, et ce qui a été confié en dernier (son texte, que le
    joueur relit ; où il en est ; lu ou non par le MJ). Seulement le sien : la page ne le lit que par sa session."""
    f = courant(f, ref)
    envoye = None
    if f["envoye"]:
        etat, lu, resultat = etat_envoi(f["envoye"], liste, recu)
        envoye = {"id": f["envoye"]["id"], "texte": f["envoye"]["texte"], "quand": f["envoye"]["quand"], "etat": etat,
                  "lu": lu, "resultat": resultat}
    b = f["brouillon"]
    return {"ouvert": True, "pause": pause, "heros": True, "max": LONG, "brouillon": b["texte"] if b else None,
            "modifie": b["modifie"] if b else f.get("modifie"), "envoye": envoye}
