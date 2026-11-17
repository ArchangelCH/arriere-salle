"""La garde de l'atelier : noms d'hôte, sessions, mot de passe, table publique et accès des MJ invités."""

import json
import os
import re
from urllib.parse import urlencode, urlsplit

from fastapi import HTTPException
from starlette.datastructures import MutableHeaders
from starlette.middleware.gzip import GZipMiddleware

from commun import acces
from mj import acces_mj
from mj import cloisonnement
from mj import comptes_mj
from table import lectures_publiques
from contenu import liens_fiches
from mj import porte_lan
from mj import proprietes

from api.application import app
from api import config, statiques_versionnes


# Noms d'hôte acceptés : toute adresse IP (le rebinding DNS passe forcément par un nom), plus ces noms-là.
HOTES = {"localhost", "testserver"} | {
    h.strip().lower() for h in os.environ.get("ATELIER_HOTES", "").split(",") if h.strip()}
IP = re.compile(r"^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$")

# La table publiée sur Internet (tunnel Cloudflare) : ces noms-là, et toute requête passée par Cloudflare (elle porte
# CF-Connecting-IP) hors de ATELIER_PUBLIC, n'ont droit qu'à la vue TV, en lecture : ni fiches, ni secrets, ni IA, ni
# changement de ce qu'affiche la TV depuis l'extérieur.
TABLE_PUBLIQUE = {h.strip().lower() for h in os.environ.get("TABLE_PUBLIQUE", "").split(",") if h.strip()}
HOTES |= TABLE_PUBLIQUE
ADRESSE_PUBLIQUE = f"https://{min(TABLE_PUBLIQUE)}" if TABLE_PUBLIQUE else None
# Des fichiers de l'image, seulement ce que charge la page de la TV (table.html, son script construit, ses feuilles, ses
# polices et ses textures) : le reste du code de l'atelier porte les fiches de départ de la campagne, avec leurs secrets.
# Un nom de fichier sans barre ni « .. » : rien ne remonte vers un autre dossier.
STATIQUES_TABLE = r"static/(?:tv|fonts|img|img/kit|sons)/[\w-]+\.[\w.]+|static/css/(?:table|affiches|horloges-tv|echoppe-tv|jet-tv|documents)\.css"
CHEMINS_TABLE = re.compile(rf"^/(table|ws/table|api/table/.+|{STATIQUES_TABLE}|media/.+)$")


def nom_hote(hote: str) -> str:
    return hote.lower().rsplit(":", 1)[0] if not hote.startswith("[") else hote.lower().split("]")[0] + "]"


def hote_autorise(hote: str) -> bool:
    nom = nom_hote(hote)
    return bool(nom) and (nom in HOTES or bool(IP.match(nom)))


# L'atelier entier publié par le tunnel (atelier.exemple.org), derrière un mot de passe. L'empreinte du mot de
# passe et la clé des sessions viennent de secrets/acces.env (outils/mot-de-passe.py), hors du
# dépôt ; sans elles, personne n'entre par ce nom. Sur le LAN, rien ne change.
ATELIER_PUBLIC = {h.strip().lower() for h in os.environ.get("ATELIER_PUBLIC", "").split(",") if h.strip()}
HOTES |= ATELIER_PUBLIC
EMPREINTE_MDP = os.environ.get("ATELIER_MDP_EMPREINTE", "")  # scrypt:n:r:p:sel:empreinte (hexadécimal)
CLE_SESSION = os.environ.get("ATELIER_CLE_SESSION", "").encode()
COOKIE_SESSION = "__Host-arriere-salle"
DUREE_SESSION = 30 * 86400
# Sans session, seules la page de connexion, celle d'une invitation de MJ et leurs polices répondent.
LIBRES_SANS_SESSION = re.compile(r"^/(connexion|connexion/invitation|connexion/invitation/etat|deconnexion|static/fonts/[\w.-]+)$")
# Essais manqués : 5 par adresse en 15 minutes, 10 par identifiant en une heure ; passé 50 en une heure en tout, une
# adresse n'a plus droit qu'à deux essais manqués par heure (acces.Essais), sans fermer la porte aux autres.
ECHECS_CONNEXION = acces.Essais()
ECHECS_PAR_ADRESSE, ECHECS_PAR_IDENTIFIANT, ECHECS_EN_TOUT = 5, 10, 50
ATTENTE_ECHEC = 1  # secondes, après chaque essai manqué
# La porte du réseau local (porte_lan.py) : dormante tant qu'aucun MJ invité n'existe, le LAN reste alors le MJ principal.
PORTE_LAN = porte_lan.PorteLan(config.DONNEES, chemins_tv=CHEMINS_TABLE, libres=LIBRES_SANS_SESSION,
                               empreinte_env=lambda: EMPREINTE_MDP)
PORTE_LAN.preparer()


def acces_atelier_public(entetes) -> bool:
    return nom_hote(entetes.get("host", "")) in ATELIER_PUBLIC


def signature_session(expire: int) -> str:
    # Le cookie d'avant les comptes MJ (« échéance.signature ») : l'empreinte entre dans la signature, changer le mot
    # de passe le rend caduc.
    return acces.signer(CLE_SESSION, f"{expire}|{EMPREINTE_MDP}")


lire_cookie = acces.lire_cookie


def comptes_mj_lus() -> dict | None:
    """Les comptes des MJ (comptes_mj.py), le principal assuré depuis l'environnement ; None si le fichier ne se lit
    pas : personne n'entre alors par Internet (le LAN ne change pas)."""
    try:
        return comptes_mj.assurer_principal(config.DONNEES, EMPREINTE_MDP)
    except comptes_mj.Illisible as err:
        config.journal.error("Comptes des MJ illisibles, l'atelier en ligne reste fermé : %s", err)
        return None


def compte_de_session(entetes) -> dict | None:
    """Le compte MJ de la session de cette requête, ou None. Comme avant les comptes, sans l'empreinte et la clé de
    l'environnement personne n'entre. L'ancien cookie vaut session du principal pendant 30 jours (comptes_mj.py)."""
    if not (CLE_SESSION and EMPREINTE_MDP):
        return None
    valeur = lire_cookie(entetes.get("cookie", ""), COOKIE_SESSION)
    etat = comptes_mj_lus() if valeur else None
    if etat is None:
        return None
    if valeur.count(".") == 1:
        if acces.jeton_valide(valeur, lambda _, expire: signature_session(expire)) is None:
            return None
        return comptes_mj.principal(etat) if comptes_mj.ancien_cookie_tient(etat, EMPREINTE_MDP) else None
    return comptes_mj.compte_du_jeton(etat, valeur, CLE_SESSION)


def session_valide(entetes) -> bool:
    return compte_de_session(entetes) is not None


def acces_table_seule(entetes) -> bool:
    if acces_atelier_public(entetes) and session_valide(entetes):
        return False
    return "cf-connecting-ip" in entetes or nom_hote(entetes.get("host", "")) in TABLE_PUBLIQUE


class Garde:
    """Devant toute l'application : refuse un nom d'hôte inconnu (rebinding DNS), une écriture ou un WebSocket venus
    d'une autre origine (un site ouvert dans le même navigateur), un corps trop gros ; compresse ce qui gagne à
    l'être ; pose les en-têtes de cache."""

    def __init__(self, app):
        self.app = app
        self.gzip = GZipMiddleware(app, minimum_size=1024, compresslevel=6)

    @staticmethod
    async def refuser(scope, send, statut: int, message: str):
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008, "reason": message})
            return
        corps = json.dumps({"detail": message}, ensure_ascii=False).encode()
        await send({"type": "http.response.start", "status": statut,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(corps)).encode())]})
        await send({"type": "http.response.body", "body": corps})

    async def __call__(self, scope, receive, send):
        # Le compte MJ de la requête (proprietes.py), l'auteur des fiches qu'elle crée : celui de la session en ligne,
        # sinon le principal. Et son lecteur (cloisonnement.py), posé plus bas. Rendus à la fin de la requête.
        jeton_compte = proprietes.poser_compte(None)
        jetons_lecteur = cloisonnement.debut_de_requete()
        try:
            return await self.garder(scope, receive, send)
        finally:
            cloisonnement.fin_de_requete(jetons_lecteur)
            proprietes.retirer_compte(jeton_compte)

    async def garder(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            cloisonnement.poser_lecteur(cloisonnement.FOND)
            return await self.app(scope, receive, send)
        entetes = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        hote = entetes.get("host", "")
        if not hote_autorise(hote):
            return await self.refuser(scope, send, 400, "Hôte inconnu")
        # Un fichier sous /static/v-<empreinte>/… (statiques_versionnes.py) : toute la garde le voit à son adresse d'origine.
        versionne = None
        if scope["type"] == "http" and scope["path"].startswith("/static/v-"):
            versionne = statiques_versionnes.decouper(scope["path"])
            if versionne:
                scope = {**scope, "path": versionne[0], "raw_path": versionne[0].encode("latin-1", "ignore")}
        origine = entetes.get("origin")
        methode = scope.get("method", "GET")
        if origine and (scope["type"] == "websocket" or methode not in ("GET", "HEAD", "OPTIONS")):
            if urlsplit(origine).netloc.lower() != hote.lower():
                return await self.refuser(scope, send, 403, "Origine refusée")
        # Sans compte MJ (la table publique, l'atelier en ligne sans session), la requête lit en public (cloisonnement.py).
        public = False
        if acces_atelier_public(entetes):
            chemin = scope["path"]
            compte = compte_de_session(entetes)
            public = compte is None
            if compte is not None:
                proprietes.poser_compte(compte["id"])
            if compte is None and not (scope["type"] == "http" and LIBRES_SANS_SESSION.match(chemin)):
                if (scope["type"] == "http" and methode in ("GET", "HEAD")
                        and not chemin.startswith(("/api/", "/media/", "/static/", "/ws/"))):
                    requete = scope.get("query_string", b"").decode("latin-1")
                    suite = chemin + ("?" + requete if requete else "")
                    destination = "/connexion" + ("?" + urlencode({"suite": suite}) if suite != "/" else "")
                    await send({"type": "http.response.start", "status": 303,
                                "headers": [(b"location", destination.encode("latin-1")), (b"content-length", b"0"),
                                            (b"cache-control", b"no-store")]})
                    await send({"type": "http.response.body", "body": b""})
                    return
                return await self.refuser(scope, send, 401, "Connexion requise")
        elif acces_table_seule(entetes):
            chemin = scope["path"]
            public = True
            if scope["type"] == "http" and chemin == "/" and methode in ("GET", "HEAD"):
                await send({"type": "http.response.start", "status": 307,
                            "headers": [(b"location", b"/table"), (b"content-length", b"0")]})
                await send({"type": "http.response.body", "body": b""})
                return
            if (not CHEMINS_TABLE.match(chemin)
                    or (scope["type"] == "http" and methode not in ("GET", "HEAD"))
                    or (scope["type"] == "websocket" and chemin != "/ws/table")):
                return await self.refuser(scope, send, 404, "Introuvable")
            # Table publique fermée : l'écran garde l'accueil (le WebSocket le lui envoie), rien d'autre de la table.
            if chemin.startswith("/api/table/") and not tv_etat.table_publique()["ouverte"]:
                return await self.refuser(scope, send, 404, "Introuvable")
            # Ouverte, seulement ce que la TV montre en ce moment : une autre vue, une fiche retirée, rien (lectures_publiques.py).
            if chemin.startswith("/api/table/") and not lectures_publiques.montre(chemin, tv_ecran.etat_table(), tv_cartes.jeton, await tv_medias.medias_pour(chemin)):
                return await self.refuser(scope, send, 404, "Introuvable")
        else:
            # Le réseau local (porte_lan.py) : ouvert à tous tant qu'aucun MJ invité n'existe ; ensuite, seuls les appareils
            # reconnus, les outils du serveur et le rendu PDF y entrent. La TV, la sonde et la connexion restent libres.
            passage = await PORTE_LAN.passage(scope, entetes)
            if passage.refuse:
                return await PORTE_LAN.renvoyer(scope, send, self.refuser)
            if passage.compte is not None:
                proprietes.poser_compte(passage.compte)
            elif PORTE_LAN.eveillee():
                # Porte éveillée, chemin libre sans appareil reconnu (la TV, la sonde, la connexion) : il lit en public, et
                # de la table seulement ce qu'elle montre en ce moment, comme la table publique ouverte. Sinon un appareil
                # quelconque du salon lirait par un jeton retenu plus que ce qu'un MJ en lit par le sien (table_au_compte).
                public = True
                if scope["path"].startswith("/api/table/") and not lectures_publiques.montre(scope["path"], tv_ecran.etat_table(), tv_cartes.jeton,
                                                                                         await tv_medias.medias_pour(scope["path"])):
                    return await self.refuser(scope, send, 404, "Introuvable")
            send = passage.envelopper(send)
        if lecteur_de_la_requete(scope, methode, public):
            return await self.refuser(scope, send, 404, "Introuvable")
        if scope["type"] == "websocket":
            return await self.app(scope, receive, send)
        chemin = scope["path"]
        longueur = entetes.get("content-length", "")
        limite = config.IMAGE_MAX + 1024 * 1024 if chemin == "/api/images" else config.CORPS_MAX
        if longueur.isdigit() and int(longueur) > limite:
            return await self.refuser(scope, send, 413, "Requête trop volumineuse")

        # Versionné et à jour : gardé un an ; « private » sauf pour ce que la table publique charge (tout l'atelier est derrière
        # un mot de passe, aucun intermédiaire n'en garde une copie).
        portee = "public" if CHEMINS_TABLE.match(chemin) else "private"

        async def envoyer(message):
            if message["type"] == "http.response.start":
                h = MutableHeaders(raw=message["headers"])
                h["X-Content-Type-Options"] = "nosniff"
                if versionne and chemin.startswith("/static/") and not chemin.startswith("/static/fonts/") and message["status"] == 200:
                    h["Cache-Control"] = statiques_versionnes.cache_control(versionne[1], portee)
                    await send(message)
                    return
                if chemin.startswith("/media/"):
                    # Les noms d'images sont uniques : une image ne change jamais sous le même nom.
                    h["Cache-Control"] = "public, max-age=31536000, immutable"
                elif chemin.startswith("/static/fonts/"):
                    h["Cache-Control"] = "public, max-age=2592000"
                elif chemin.startswith("/static/"):
                    h["Cache-Control"] = "no-cache"
            await send(message)

        if versionne and methode in ("GET", "HEAD"):
            reecrit = statiques_versionnes.reponse(chemin, versionne[1], portee)
            if reecrit is not None:
                return await GZipMiddleware(reecrit, minimum_size=1024, compresslevel=6)(scope, receive, envoyer)
        if (chemin.startswith(("/media/", "/static/img/", "/static/fonts/", "/api/table/vignette/")) or chemin.endswith("/fond")
                or (chemin.startswith("/api/table/plan/") and "/image/" in chemin)):
            return await self.app(scope, receive, envoyer)
        return await self.gzip(scope, receive, envoyer)


# Les lectures de la TV : elles lisent en public (cloisonnement.py), qu'elles viennent du salon, d'Internet ou d'un MJ.
CHEMINS_TV = re.compile(r"^/(table|ws/table|api/table/.+)$")
_TABLE_DES_ROUTES: list = []


def table_des_routes() -> acces_mj.Table:
    """La table des règles de l'invité (acces_mj.py), compilée une fois depuis les routes de l'appli."""
    if not _TABLE_DES_ROUTES:
        _TABLE_DES_ROUTES.append(acces_mj.compiler(app.routes))
    return _TABLE_DES_ROUTES[0]


cloisonnement.regler_routes(lambda methode, chemin: table_des_routes().cle(methode, chemin))
cloisonnement.regler_journal(comptes_mj.dossier(config.DONNEES))


def lecteur_de_la_requete(scope, methode: str, public: bool) -> bool:
    """Pose le lecteur de la requête (cloisonnement.py) : public pour la TV et qui n'a pas de compte, sinon le compte MJ.
    Pour un MJ invité, applique acces_mj.REGLES ; pour tout MJ, une lecture de la TV par jeton ne vise que ce qu'elle
    montre ou ses propres fiches. Vrai si la requête est refusée (404, comme une route qui n'existe pas)."""
    chemin = scope["path"]
    sorte = "WS" if scope["type"] == "websocket" else methode.upper()
    cloisonnement.poser_requete(sorte, chemin)
    compte = None if public else proprietes.compte_courant()
    cloisonnement.poser_lecteur(cloisonnement.PUBLIC if compte is None or CHEMINS_TV.match(chemin) else compte)
    if compte is None:
        return False
    if cloisonnement.est_invite(compte) and refus_pour_l_invite(sorte, chemin):
        return True
    # Les lectures de la TV par jeton : ce qu'elle montre en ce moment, ou une fiche du MJ lui-même (l'aperçu de son
    # atelier). Pas la projection d'une fiche de l'autre MJ qu'elle ne montre pas.
    return chemin.startswith("/api/table/") and not table_au_compte(chemin, compte) and cloisonnement.refuse("table-hors-ecran")


def refus_pour_l_invite(sorte: str, chemin: str) -> bool:
    """La règle de la route pour un MJ invité (acces_mj.py) : une route non rangée ou au principal seul, un fichier de
    l'image hors de sa liste. Notée en veille, refusée en strict."""
    trouvee = table_des_routes().trouver(sorte, chemin)
    if trouvee is None:
        return False  # aucune route : l'appli répond 404 (ou 405) d'elle-même
    regle = trouvee[1]
    if regle is None or regle == acces_mj.PRINCIPAL_SEUL:
        return cloisonnement.refuse("route-fermee")
    if regle == acces_mj.STATIQUE and not acces_mj.statique_de_l_invite(chemin):
        return cloisonnement.refuse("statique-fermee")
    return False


def table_au_compte(chemin: str, compte: str) -> bool:
    """Une lecture de /api/table/… que la TV montre en ce moment (lectures_publiques.py), une vue entière (la planche, la
    tablée), ou une fiche désignée par son jeton qui est à ce compte."""
    if lectures_publiques.montre(chemin, tv_ecran.etat_table(), tv_cartes.jeton):
        return True
    m = lectures_publiques.CHEMIN.match(chemin)
    if not m:
        return False  # une adresse que la règle ne connaît pas : comme pour la table publique, rien
    if m.group("quoi") not in lectures_publiques.FICHES or not m.group("jeton"):
        return True  # une vue entière, une vignette : des projections de tous les MJ
    collection = lectures_publiques.FICHES[m.group("quoi")][1]
    if not proprietes.a_auteur(collection):
        return True
    try:
        trouve = tv_cartes.par_jeton(config.DONNEES / collection, collection, m.group("jeton"))
    except HTTPException:
        return True  # aucune fiche : la route répond 404 d'elle-même
    # La sienne, ou celle que l'autre MJ partage avec lui : sa projection ne lui apprend rien qu'il ne lise déjà.
    return cloisonnement.auteur_du_fichier(trouve) == compte or cloisonnement.partagee_par_un_autre(collection, trouve, compte)


# Le suivi des renommages (liens_fiches.py) derrière la Garde : une adresse qu'elle refuse (table publique, atelier en
# ligne sans session) ne dit rien d'un renommage, pas même par l'en-tête X-Identifiant. add_middleware place le
# dernier ajouté devant les autres.
app.add_middleware(liens_fiches.SuiviDesRenommages)
app.add_middleware(Garde)


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import tv_cartes, tv_medias, tv_etat, tv_ecran  # noqa: E402
