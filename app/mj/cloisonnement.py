"""Qui lit quoi dans l'atelier (deuxième accès MJ, lot MJ-3) : le lecteur de chaque requête, le filtre des collections à
auteur, les messages qui anonymisent, en veille puis en strict.

Le lecteur : une ContextVar posée par la Garde de main.py à chaque requête. C'est un compte MJ (« mj » par défaut, le compte
principal, ou un invité), PUBLIC (la TV, la table publique, une page sans session : rien que les projections publiques)
ou FOND (les tâches du cycle et leurs fils : le serveur pour lui-même ; ce qu'il écrit pour un MJ passe par une
projection ou par un message qui anonymise, et Telegram ne parle qu'au MJ principal).

Le filtre au plus bas : lire_tout() et existant() de main.py ne rendent, pour les collections à auteur
(proprietes.COLLECTIONS), que les fiches du lecteur ; une fiche sans auteur est au compte principal. Une fiche que son
auteur partage (« partage », proprietes.PARTAGEABLES) se lit aussi par l'autre MJ, là où l'appel dit lecture=True : les
listes, la lecture d'une fiche, ce qu'on envoie à la TV. Sans ce mot, tout appel reste fermé : aucune écriture ne l'a. L'union (tout=True)
n'est permise que dans les projections publiques, celles de PROJECTIONS_PUBLIQUES : un test sur l'AST refuse tout=True
partout ailleurs (tests/test_mj_cloisonnement.py).

Veille et strict (variable ATELIER_CLOISONNEMENT, « veille » par défaut) : en veille, une violation est seulement notée
(journal du conteneur et data/mj/cloisonnement.jsonl, sans nom ni identifiant de fiche) et rien ne change ; en strict,
elle est refusée (404, une liste sans la fiche, la projection au lieu de la fiche, un nom anonymisé). Un lecteur qui n'a
pas été posé est lui-même une violation : en strict, une erreur. Tant qu'aucun invité n'existe, la veille ne note que ce
qui casserait le strict pour le MJ principal (une projection qui oublie l'union, un fil sans lecteur) : c'est sa raison d'être.

Limite : le MJ principal administre le serveur. C'est un bouclier contre les spoilers dans l'atelier, pas un coffre.
"""
import json
import logging
import os
import threading
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime
from pathlib import Path

from mj import proprietes
from mj.proprietes import PRINCIPAL
from commun import stockage

journal = logging.getLogger("atelier")

VEILLE, STRICT = "veille", "strict"
MODES = (VEILLE, STRICT)
# Lu au démarrage ; les essais le changent sur le module (monkeypatch).
MODE = os.environ.get("ATELIER_CLOISONNEMENT", VEILLE).strip().lower()
if MODE not in MODES:
    journal.error("ATELIER_CLOISONNEMENT inconnu (%r) : veille", MODE)
    MODE = VEILLE

# Les lecteurs qui ne sont pas des comptes : un identifiant de compte (comptes_mj.ID_COMPTE) n'a jamais de « ~ ».
PUBLIC = "~public"
FOND = "~fond"

# Ce que lit un MJ à la place d'un secret de l'autre (un PNJ, un lieu), ou d'un secret de héros (un peuple caché) quand
# il n'est pas le compte principal : jamais le nom, ni l'identifiant, ni la fiche qui le porte.
AUTRE_MJ = "un nom que l'autre MJ garde secret"
SECRET_DE_HEROS = "un secret d'un autre héros"

# Les seules fonctions qui ont droit à l'union des MJ (tout=True), chacune une projection publique : ce que la TV, la
# table publique, le coin des joueurs ou le carnet montrent, la détection de ce que les joueurs ne savent pas, le combat
# en cours, la prochaine séance. « module.fonction » ou « module.Classe.méthode ». Le test sur l'AST refuse tout=True
# hors d'elles, et une entrée qui ne correspond plus à rien.
PROJECTIONS_PUBLIQUES = {
    # Ce que les joueurs ne savent pas encore (les PNJ et lieux inconnus de tous les MJ) : sans l'union, le carnet et la
    # TV laisseraient passer le secret d'un MJ dans le texte de l'autre.
    "noms_caches.secrets_des_joueurs": "les secrets à retenir, ceux de chaque MJ",
    "tv_cartes.lieux_connus": "les lieux connus des joueurs (carte de la TV, carnet, « Précédemment »)",
    "carnet_api.elements_du_carnet": "le carnet des joueurs",
    "contexte_du_modele.etat_campagne_public": "ce que savent les joueurs, pour un texte qu'ils liront",
    "tv_fiches.table_planche": "la planche à contrats de la TV",
    "tv_plans.fiche_du_pion": "le nom et le portrait d'un pion à la TV (un PNJ connu, un héros)",
    "tv_etat.etat_public": "la version de la carte ou du plan que montre la TV",
    "tv_etat.carte_pour_le_coin": "la carte que montre la TV, pour le coin",
    "tv_etat.table_pour_le_coin": "le plan et le combat que montre la TV, pour le coin",
    "tv_etat.plan_a_la_tv": "le plan que montre la TV (déplacements des joueurs)",
    "tv_etat.prochaine_seance": "la date de la prochaine séance, que lit la table publique fermée",
    "heros_etat.postures_au_combat": "la posture des héros au combat en cours, sur leurs pions",
    "heros_etat.combat_du_heros": "le combat où se bat un héros, pour y noter le geste de son joueur (Santé, Psy, posture, jeton)",
    "heros_etat.heros_au_combat": "les héros au combat en cours : leur Santé ne se change que là (le nom du combat d'un autre MJ ne sort pas)",
    "tv_etat.seances_en_jeu": "le combat en cours, pour le tour des joueurs qui bougent leur pion",
    "refuge.seances_de_la_campagne": "les séances du principal, qui rythment la campagne (activités, sanctuaire)",
    "commandes_api.boutiques_par_jeton": "les boutiques de l'échoppe des joueurs, désignées par leur jeton",
    "commandes_api.vendre_la_commande": "la boutique d'une commande de l'échoppe, trouvée par son jeton",
    "tv_medias.le_monde": "le monde tel que les joueurs le connaissent",
    "documents.Documents.au_carnet": "les documents montrés à la TV, gardés au carnet",
}

# Les seules fonctions qui lisent aussi les fiches que l'autre MJ partage (lecture=True) : aucune n'écrit la fiche qu'elle
# trouve ainsi. Le test sur l'AST refuse lecture=True hors d'elles, et vérifie qu'elles n'appellent ni ecrire() ni jeter().
LECTURES_PARTAGEES = {
    "fiches_api.routes_fiches.liste": "la liste d'une collection : les siennes et celles qu'on lui partage",
    "fiches_api.routes_fiches.lire_une": "la fiche partagée, entière, en lecture",
    "tv_fiches.carton_pnj_verifie": "les inconnus que nomme le carton d'un PNJ, avant de le montrer",
    "tv_ecran.table_vue_par_le_lecteur": "la fiche partagée que montre la TV, désignée en clair",
    "tv_ecran.table_envoyee_par_un_mj": "montrer à la table une fiche partagée",
    "contenus_mj.lire_pour_la_recherche": "« Chercher » trouve aussi les fiches partagées",
    "liens_fiches.routes.dans_les_scenarios": "les passages de ses propres scénarios qui citent la fiche partagée",
}

_LECTEUR: ContextVar = ContextVar("lecteur_mj", default=None)
# La route de la requête en cours, pour le journal de veille (méthode, chemin) : jamais l'adresse elle-même, qui peut
# porter l'identifiant d'une fiche.
_REQUETE: ContextVar = ContextVar("requete_mj", default=None)


class LecteurAbsent(RuntimeError):
    """En strict : une lecture faite hors de toute requête et de toute tâche du cycle (un fil sans lecteur)."""


# ---------------------------------------------------------------- le lecteur

def strict() -> bool:
    return MODE == STRICT


def poser_lecteur(lecteur):
    return _LECTEUR.set(lecteur if isinstance(lecteur, str) and lecteur else None)


def retirer_lecteur(jeton) -> None:
    _LECTEUR.reset(jeton)


def poser_requete(methode: str, chemin: str):
    return _REQUETE.set((methode, chemin))


def debut_de_requete() -> tuple:
    """Au seuil de la Garde : ni lecteur ni route tant qu'elle ne les a pas posés (une connexion gardée ouverte sert
    plusieurs requêtes). Rend de quoi les remettre à la fin (fin_de_requete)."""
    return _LECTEUR.set(None), _REQUETE.set(None)


def fin_de_requete(jetons: tuple) -> None:
    _REQUETE.reset(jetons[1])
    _LECTEUR.reset(jetons[0])


def lecteur():
    """Le lecteur posé, ou None."""
    return _LECTEUR.get()


def est_compte(l) -> bool:
    return isinstance(l, str) and bool(l) and not l.startswith("~")


def est_invite(l=None) -> bool:
    """Le lecteur (ou celui de la requête) est-il un MJ invité ?"""
    l = lecteur() if l is None else l
    return est_compte(l) and l != PRINCIPAL


def destinataire() -> str:
    """Le MJ qui lira ce que la requête écrit (un message, une liste de secrets) : le lecteur s'il est un compte, sinon le
    principal (une tâche de fond parle au MJ principal : le carnet, Telegram)."""
    l = lecteur()
    return l if est_compte(l) else PRINCIPAL


@contextmanager
def en_fond():
    """Le temps d'un bloc, le serveur lit pour lui-même (une publication pour le coin, une tâche lancée d'une requête)."""
    jeton = _LECTEUR.set(FOND)
    try:
        yield
    finally:
        _LECTEUR.reset(jeton)


@contextmanager
def ecrit_pour(compte):
    """Le temps d'un bloc, ce que prépare une tâche de fond est pour ce MJ (le motif d'un billet retenu, lu dans son
    atelier) : les secrets s'y nomment comme il a le droit de les lire."""
    jeton = _LECTEUR.set(compte if est_compte(compte) else PRINCIPAL)
    try:
        yield
    finally:
        _LECTEUR.reset(jeton)


def au_fond(fonction):
    """La fonction, appelée de n'importe où, lit comme une tâche de fond."""
    def appel(*args, **kwargs):
        with en_fond():
            return fonction(*args, **kwargs)
    appel.__name__ = getattr(fonction, "__name__", "appel")
    appel.__doc__ = getattr(fonction, "__doc__", None)
    return appel


# ---------------------------------------------------------------- le journal de veille

_JOURNAL: Path | None = None
_ROUTE = None  # (méthode, chemin) -> la clé de la route (« GET /api/pnj/{ident} »), posée par main.py
_VUES: set = set()
_VERROU = threading.Lock()
LIGNES_MAX = 2000  # par démarrage : une violation répétée ne remplit pas le disque


def regler_journal(dossier: Path) -> None:
    global _JOURNAL
    _JOURNAL = Path(dossier) / "cloisonnement.jsonl"


def regler_routes(fonction) -> None:
    global _ROUTE
    _ROUTE = fonction


def lecteur_dit(l) -> str:
    """Le lecteur tel que le journal le note : un compte, « public », « fond » ou « absent »."""
    if l is None:
        return "absent"
    return {PUBLIC: "public", FOND: "fond"}.get(l, l)


def route_en_cours() -> str:
    requete = _REQUETE.get()
    if not requete:
        return ""
    methode, chemin = requete
    try:
        cle = _ROUTE(methode, chemin) if _ROUTE else None
    except Exception:  # noqa: BLE001 : le journal ne fait jamais tomber une requête
        cle = None
    # Sans route reconnue, la méthode seule : l'adresse brute peut porter l'identifiant d'une fiche.
    return cle or f"{methode} ?"


def vues() -> list:
    """Les violations notées depuis le démarrage (pour les essais) : (genre, route, collection, lecteur)."""
    with _VERROU:
        return sorted(_VUES)


def oublier() -> None:
    with _VERROU:
        _VUES.clear()


_NOTEES = [0]


def notees() -> int:
    """Combien de violations ont été notées (doublons compris) : une liste gardée en mémoire (listes_json.py) ne se garde pas
    quand sa fabrication en a noté une, pour que chaque lecture fautive reste vue."""
    return _NOTEES[0]


def noter(genre: str, collection: str = "") -> None:
    """Une violation : une ligne par (genre, route, collection, lecteur) et par démarrage, sans nom ni identifiant de
    fiche."""
    _NOTEES[0] += 1
    cle = (genre, route_en_cours(), collection, lecteur_dit(lecteur()))
    with _VERROU:
        if cle in _VUES or len(_VUES) >= LIGNES_MAX:
            return
        _VUES.add(cle)
    journal.warning("Cloisonnement (%s) : %s, %s, %s, lecteur %s", MODE, *cle)
    if _JOURNAL is None:
        return
    ligne = {"quand": datetime.now().isoformat(timespec="seconds"), "mode": MODE, "genre": cle[0], "route": cle[1],
             "collection": cle[2], "lecteur": cle[3]}
    try:
        _JOURNAL.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd = os.open(_JOURNAL, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "a", encoding="utf-8") as f:
            f.write(json.dumps(ligne, ensure_ascii=False) + "\n")
    except OSError as err:
        journal.error("Journal du cloisonnement illisible : %s", err)


def refuse(genre: str, collection: str = "") -> bool:
    """Ce que le cloisonnement interdit : noté en veille (rien ne change : False), refusé en strict (True)."""
    noter(genre, collection)
    return strict()


def lecteur_sur() -> str:
    """Le lecteur posé ; sans lui, une violation (en strict, une erreur), et la lecture se fait comme avant : pour le
    serveur."""
    l = lecteur()
    if l is None:
        noter("lecteur-absent")
        if strict():
            raise LecteurAbsent("aucun lecteur posé")
        return FOND
    return l


# ---------------------------------------------------------------- le filtre des fiches

_AUTEURS: dict = {}
_AUTEURS_MAX = 4096


def etat_du_fichier(chemin: Path) -> tuple:
    """(auteur, partagée) d'une fiche sur le disque, gardé tant que le fichier ne change pas (chaque écriture le
    remplace : autre inode, autre date). Illisible : au principal, non partagée, comme une fiche sans les champs."""
    try:
        st = chemin.stat()
    except OSError:
        return PRINCIPAL, False
    cle = (str(chemin), st.st_mtime_ns, st.st_size, st.st_ino)
    etat = _AUTEURS.get(cle)
    if etat is None:
        try:
            fiche = stockage.lire_json(chemin)
            etat = (proprietes.auteur_de(fiche), isinstance(fiche, dict) and fiche.get(proprietes.PARTAGE) is True)
        except (OSError, ValueError):
            etat = (PRINCIPAL, False)
        if len(_AUTEURS) >= _AUTEURS_MAX:
            _AUTEURS.clear()
        _AUTEURS[cle] = etat
    return etat


def auteur_du_fichier(chemin: Path) -> str:
    """L'auteur d'une fiche sur le disque ; illisible : le principal, comme une fiche sans le champ."""
    return etat_du_fichier(chemin)[0]


def ouverte_en_lecture(collection: str, partagee: bool, compte=None) -> bool:
    """« Partager avec l'autre MJ » : une fiche partagée se lit par tout compte MJ (celui de la requête, ou compte). Jamais
    par la TV ni la table publique (leurs projections ne changent pas), et jamais pour écrire : seul un appel qui dit
    lecture=True passe par ici."""
    return partagee and proprietes.partageable(collection) and est_compte(lecteur() if compte is None else compte)


def permis_auteur(collection: str, auteur: str, tout: bool = False) -> bool:
    if tout or not proprietes.a_auteur(collection):
        return True
    l = lecteur_sur()
    if l == FOND:
        return True
    if l == PUBLIC:
        # Une page de la TV ou de la table publique qui lit sans passer par une projection publique.
        return not refuse("public-hors-projection", collection)
    if auteur == l:
        return True
    return not refuse("fiche-d-un-autre", collection)


def permis(collection: str, fiche, tout: bool = False, lecture: bool = False) -> bool:
    """Le lecteur peut-il lire cette fiche ? Toujours pour une collection sans auteur, dans une projection publique
    (tout) et pour une tâche de fond ; sinon, seulement la sienne. lecture : pour la lire sans rien y écrire, la fiche
    que l'autre MJ partage passe aussi (ouverte_en_lecture)."""
    if tout or not proprietes.a_auteur(collection):
        return True
    if lecture and ouverte_en_lecture(collection, proprietes.partagee(collection, fiche)):
        return True
    return permis_auteur(collection, proprietes.auteur_de(fiche), tout)


def permis_chemin(collection: str, chemin: Path, tout: bool = False, lecture: bool = False) -> bool:
    if tout or not proprietes.a_auteur(collection):
        return True
    l = lecteur_sur()
    if l == FOND:
        return True
    auteur, partagee = etat_du_fichier(Path(chemin))
    if lecture and ouverte_en_lecture(collection, partagee):
        return True
    return permis_auteur(collection, auteur, tout)


def partagee_par_un_autre(collection: str, chemin: Path, compte=None) -> bool:
    """Une fiche que ce compte (par défaut le lecteur) lit parce qu'un autre MJ la partage : elle existe pour lui, mais
    il ne l'écrit pas."""
    auteur, partagee = etat_du_fichier(Path(chemin))
    return auteur != (lecteur() if compte is None else compte) and ouverte_en_lecture(collection, partagee, compte)


def garder(collection: str, fiches: list, tout: bool = False, lecture: bool = False) -> list:
    """Les fiches que le lecteur peut lire, dans l'ordre. lecture : avec celles que l'autre MJ partage."""
    if tout or not proprietes.a_auteur(collection):
        return fiches
    return [f for f in fiches if permis(collection, f, lecture=lecture)]


# ---------------------------------------------------------------- les secrets nommés dans un texte

def auteur_du_secret(s: dict) -> str:
    """Un PNJ ou un lieu inconnu : l'auteur de sa fiche (main.secrets_des_joueurs ne pose « auteur » que pour un autre
    que le principal). Un peuple caché : un secret de héros, que seul le principal lit."""
    a = s.get("auteur") if isinstance(s, dict) else None
    return a if isinstance(a, str) and a else PRINCIPAL


def secret_vu(s: dict) -> dict:
    """Un secret tel que le lit le destinataire : le sien entier (sans « auteur »), celui d'un autre anonymisé, sans nom,
    ni identifiant, ni précision, ni les héros qui le portent. Le genre reste : il ne dit rien de la fiche."""
    qui = destinataire()
    if s.get("genre") == "peuple":
        a_lui = qui == PRINCIPAL
        cache = SECRET_DE_HEROS
    else:
        a_lui = auteur_du_secret(s) == qui
        cache = AUTRE_MJ
    if a_lui:
        return {k: v for k, v in s.items() if k not in ("auteur", "partage")}
    # Le PNJ ou le lieu que l'autre MJ partage : son nom se lit (la fiche aussi) ; « partage » dit à la page que le rendre
    # connu des joueurs revient à son auteur.
    if s.get("genre") != "peuple" and s.get("partage") is True:
        return {k: v for k, v in s.items() if k != "auteur"}
    if not refuse("secret-d-un-autre"):
        return {k: v for k, v in s.items() if k not in ("auteur", "partage")}
    return {"genre": s.get("genre"), "nom": cache, "ids": [], "autre": True}


def secrets_vus(liste) -> list:
    """Une liste de secrets pour une réponse : chacun vu par le destinataire, les anonymes une seule fois."""
    sortie, deja = [], set()
    for s in liste or []:
        vu = secret_vu(s)
        if vu.get("autre"):
            cle = (vu["genre"], vu["nom"])
            if cle in deja:
                continue
            deja.add(cle)
        sortie.append(vu)
    return sortie
