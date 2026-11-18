"""Le coin des joueurs : chacun crée son aventurier depuis chez lui et l'envoie au MJ ; entre les séances, il relit le
carnet de la compagnie et passe commande dans les boutiques ouvertes aux joueurs. Il entre avec son identifiant et son
mot de passe, depuis n'importe quel appareil. Le MJ lui donne son identifiant et un mot de passe provisoire, qui sert
une fois, à choisir le sien (comptes.py, provisoires.py) ; plus aucun lien à clé n'ouvre quoi que ce soit.

Ce service est le seul exposé sur Internet. Il ne voit que le dossier des propositions (monté seul dans le conteneur) :
ni l'atelier, ni ses fiches, ni ses secrets. Il ne sert qu'une liste fermée de fichiers de l'image, et du carnet que ce
que l'atelier y a publié (carnet.py). Il n'écrit que les propositions, les commandes, les limites (confort.py) et les
comptes (comptes.py) de chacun.
"""
import asyncio
import functools
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode, urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware import Middleware
from starlette.middleware.gzip import GZipMiddleware

# « acces » est déjà, plus bas, la liste des joueurs invités : le module partagé avec l'atelier s'appelle ici « porte ».
from commun import acces as porte
from commun import activites
from commun import nom_campagne
from commun import bible
from commun import cagnottes
from commun import carnet
from commun import comptes
from commun import confort
from commun import demandes
from commun import deplacement
from commun import flux_coin
from commun import inventaire
from commun import jets
from commun import jets_distance
from commun import lore
from commun import main_levee
from commun import pointeurs
from commun import provisoires
from commun import table_joueurs
from commun.pdf import RenduImpossible, nom_de_fichier, page_en_pdf
from commun import stockage

ICI = Path(__file__).parent
STATIQUE = ICI / "static"
DEPOT = Path(os.environ.get("DEPOT_DIR", "/propositions"))
HOTES = {h.strip() for h in os.environ.get("HOTES", "").split(",") if h.strip()}
# Le rendu PDF passe par Chromium dans le conteneur même : il appelle ce service sous le nom « localhost ».
HOTES_INTERNES = {"localhost", "127.0.0.1"}
COOKIE_SUR = os.environ.get("COOKIE_SECURE", "1") == "1"
# La session d'un joueur (« v2.<joueur>.<generation>.<échéance>.<signature> ») ; le même nom portait avant les comptes
# « <joueur>.<signature> », qui ne vaut plus qu'invitation à créer son compte.
COOKIE = "aventurier"
DUREE = 180 * 24 * 3600
# Posée par une connexion au mot de passe provisoire, le temps de choisir le sien (une heure au plus).
INVITATION = "invitation"
DUREE_INVITATION = 3600
# Essais manqués : 5 par adresse en 15 minutes, 10 par identifiant en une heure ; passé 50 en une heure en tout, une
# adresse n'a plus droit qu'à deux essais manqués par heure (porte.Essais), sans fermer la porte aux autres.
ESSAIS = porte.Essais()
ECHECS_PAR_ADRESSE = (5, 900)
ECHECS_PAR_IDENTIFIANT = (10, 3600)
ECHECS_EN_TOUT = 50
ATTENTE_ECHEC = 1  # seconde, après chaque essai manqué
CORPS_MAX = 256 * 1024
# Les routes qui reçoivent une image brute plutôt que du JSON (le portrait envoyé par un joueur, lot P) : {chemin : octets
# au plus}. Rien d'autre n'échappe au corps JSON de 256 Ko.
ENVOIS_BRUTS: dict[str, int] = {}
ID_VALIDE = re.compile(r"^[a-z0-9-]{1,40}$")
# Jetons de rendu PDF : à usage unique, valables une minute, connus du seul serveur et de son Chromium.
RENDUS: dict[str, tuple[str, float]] = {}

# Tout ce qui sort de l'image : les pages du coin des joueurs, les modules du créateur, du carnet et de l'échoppe.
FICHIERS = {
    "css/atelier.css", "css/fiche-aventurier.css", "css/carnet.css", "css/createur.css", "css/filets.css", "css/documents.css",
    "fonts/Cinzel-VF.woff2", "fonts/CinzelDecorative-Black.woff2", "fonts/CinzelDecorative-Bold.woff2",
    "fonts/EBGaramond-VF.woff2", "fonts/EBGaramond-Italic-VF.woff2", "fonts/GrenzeGotisch-VF.woff2", "fonts/Zeyada.woff2",
    "img/planche-chene.jpg", "img/carte-parchemin.jpg", "img/parchemin.jpg", "img/kit/parchemin-clair.jpg", "img/kit/sang-1.svg", "img/kit/sang-2.svg", "img/kit/sang-3.svg",
    "js/api.js", "js/illustrations/illustrations.js", "js/pnj/tables.js", "js/joueurs/joueur.js", "js/commun/reessai.js",
    "js/commun/dialogue.js", "js/commun/temoin-enregistrement.js", "js/mj/role.js",
    "js/aventuriers/createur.js", "js/aventuriers/regles.js", "js/aventuriers/kit.js",
    "js/aventuriers/tables.js",
    # Les données de la campagne que lisent les règles des aventuriers, leurs idées à tirer, et les prétirés que relaie
    # aventuriers/kit.js (chargés à la demande par le créateur, comme avant) ; les tables de tirage des PNJ (origines,
    # noms) que lit js/pnj/tables.js.
    "js/campagne/regles.js", "js/campagne/dons.js", "js/campagne/idees-heros.js", "js/campagne/pretires.js",
    "js/campagne/noms.js",
    # Le nom de la campagne (logo de la fiche, carnet, carton d'épisode de la table).
    "js/campagne/nom.js",
    "js/aventuriers/embleme.js", "js/aventuriers/fiche.js", "js/aventuriers/etat.js", "js/combats/suivi.js",
    "js/joueurs/carnet.js", "js/joueurs/carnet-vue.js", "js/joueurs/echoppe.js", "js/boutiques/objets.js", "js/boutiques/commun.js", "js/carte/biomes.js",
    "js/regles/aide-memoire.js", "js/documents/rendu.js",
    "js/joueurs/compte.js", "js/joueurs/pied-coin.js", "js/joueurs/menu-coin.js", "js/joueurs/suite.js", "css/compte-coin.css",
    "js/joueurs/onglet-table.js", "css/introuvable-coin.css",
    # La bible des joueurs : le module de l'atelier tel quel, sa page et sa feuille.
    "js/bible/bible.js", "js/joueurs/bible-coin.js", "css/bible-coin.css",
}
# Une commande tient en quelques lignes : au-delà, elle est refusée avant même d'être lue.
COMMANDE_OCTETS_MAX = 8 * 1024

# Ce que le joueur ne peut pas écrire : ce que tient le serveur, et ce qui revient au MJ.
RESERVES = ("id", "cree", "modifie", "secret", "notes_mj", "illustrations", "illustration", "tablee", "progression",
            "lien_avec", "posture_elementaire", "confie_au_mj")

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
# L'écran de la table, que la page Table du coin tient dans un cadre (lot du 12/11) : la seule page du coin qui se laisse
# encadrer, et seulement par le coin lui-même.
ECRAN_TABLE = "/table/ecran"
PAGE_TABLE = "/table"


class Garde:
    """Hôte attendu, corps limité, en-têtes de sécurité sur toutes les réponses."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        entetes = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        hote = entetes.get("host", "").split(":")[0]
        if HOTES and hote not in HOTES | HOTES_INTERNES:
            return await JSONResponse({"detail": "Hôte inconnu"}, status_code=421)(scope, receive, send)
        longueur = entetes.get("content-length", "")
        longueur = int(longueur) if longueur.isdigit() else 0
        brut = ENVOIS_BRUTS.get(scope["path"]) if scope.get("method") == "POST" else None
        corps_max = brut or CORPS_MAX
        if longueur > corps_max:
            return await JSONResponse({"detail": "Requête trop lourde"}, status_code=413)(scope, receive, send)
        if scope.get("method") in ("POST", "PUT", "PATCH", "DELETE"):
            # Une écriture ne vient que des pages du coin : ni d'une autre origine (un sous-domaine frère passe la barrière
            # SameSite=Lax du cookie), ni d'un formulaire en text/plain qui cacherait du JSON.
            origine = entetes.get("origin")
            site = entetes.get("sec-fetch-site")
            if (origine is not None and urlsplit(origine).netloc.lower() != entetes.get("host", "").lower()) or site not in (None, "same-origin"):
                return await JSONResponse({"detail": "Origine refusée"}, status_code=403)(scope, receive, send)
            type_corps = entetes.get("content-type", "").split(";")[0].strip().lower()
            image = bool(brut) and (type_corps.startswith("image/") or type_corps == "application/octet-stream")
            if (longueur or "transfer-encoding" in entetes) and type_corps != "application/json" and not image:
                return await JSONResponse({"detail": "Corps JSON attendu"}, status_code=415)(scope, receive, send)
        recu = 0

        async def recevoir():
            nonlocal recu
            message = await receive()
            if message["type"] == "http.request":
                recu += len(message.get("body", b""))
                if recu > corps_max:
                    raise HTTPException(413, "Requête trop lourde")
            return message

        async def envoyer(message):
            if message["type"] == "http.response.start":
                h = MutableHeaders(raw=message["headers"])
                h["X-Content-Type-Options"] = "nosniff"
                h["Referrer-Policy"] = "no-referrer"
                # Aucune page du coin ne se laisse encadrer, sauf l'écran de la table, par la page Table du coin elle-même.
                cadre = scope["path"] == ECRAN_TABLE
                h["X-Frame-Options"] = "SAMEORIGIN" if cadre else "DENY"
                # La page Table seule joue la musique du MJ (musique-coin.js) : le lecteur de YouTube y entre, nulle part ailleurs.
                youtube = scope["path"] == PAGE_TABLE
                # blob: : l'image que le joueur choisit sur son appareil, montrée pour la cadrer avant l'envoi.
                h["Content-Security-Policy"] = ("default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
                                                f"script-src 'self'{" https://www.youtube.com" if youtube else ""}; connect-src 'self'; font-src 'self'; "
                                                f"{"frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com; " if youtube else ""}"
                                                f"frame-ancestors {"'self'" if cadre else "'none'"}; base-uri 'none'; form-action 'self'")
                if scope["path"].startswith("/api/"):
                    h["Cache-Control"] = "no-store"
            await send(message)

        await self.app(scope, recevoir, envoyer)


app.add_middleware(Garde)


class GzipSaufFlux:
    """La compression des réponses (pages, feuilles, scripts, JSON) : jamais le flux poussé (SSE), qui doit partir octet par
    octet, ni les PDF et images (déjà compressés). Les en-têtes de cache de la réponse (immutable) restent ceux de la route :
    seuls Content-Encoding, Vary et Content-Length changent."""

    def __init__(self, app):
        self.app = app
        self.gzip = GZipMiddleware(app, minimum_size=600, compresslevel=6)

    async def __call__(self, scope, receive, send):
        chemin = scope.get("path", "")
        compresse = (chemin == "/api/flux" or chemin.endswith(".pdf") or "/media/" in chemin or "/fonts/" in chemin
                     or "/img/" in chemin or "/sons/" in chemin or chemin.startswith("/portraits/"))
        if scope["type"] == "http" and not compresse:
            return await self.gzip(scope, receive, send)
        return await self.app(scope, receive, send)


app.add_middleware(GzipSaufFlux)


def maintenant() -> str:
    return datetime.now().isoformat(timespec="milliseconds")


def empreinte(jeton: str) -> str:
    return hashlib.sha256(jeton.encode()).hexdigest()


def cle_session() -> bytes:
    """Propre à ce service, dans le dossier des propositions : les cookies survivent aux redémarrages."""
    chemin = DEPOT / ".cle-session"
    if not chemin.exists():
        chemin.write_text(secrets.token_hex(32), encoding="utf-8")
        chemin.chmod(0o600)
    return bytes.fromhex(chemin.read_text(encoding="utf-8").strip())


def acces() -> list:
    """Les joueurs invités, tenus par l'atelier : identifiant, prénom, empreinte de leur lien."""
    try:
        return stockage.lire_json((DEPOT / ".acces.json")).get("joueurs", [])
    except (OSError, ValueError):
        return []


def invite_par_id(ident: str) -> dict | None:
    return next((x for x in acces() if x.get("id") == ident), None) if ident else None


def signature(joueur: dict) -> str:
    """Le cookie d'avant les comptes, lié à l'empreinte du lien : il ne sert plus qu'à inviter à créer son compte."""
    return hmac.new(cle_session(), f"{joueur['id']}.{joueur['jeton']}".encode(), hashlib.sha256).hexdigest()[:40]


def signature_session(j: dict, compte: dict, champs: list, echeance: int) -> str:
    # Liée à l'empreinte du mot de passe et à celle du lien en cours : un nouveau mot de passe, ou un nouveau lien envoyé
    # par le MJ, déconnecte tous les appareils du joueur.
    return porte.signer(cle_session(), "|".join([*champs, str(echeance), compte["empreinte"], j["jeton"]]))


def session(j: dict, compte: dict, duree: int = DUREE) -> str:
    return porte.jeton_signe(["v2", j["id"], compte["generation"]], int(time.time()) + duree,
                             lambda champs, echeance: signature_session(j, compte, champs, echeance))


def poser_session(reponse: Response, j: dict, compte: dict, duree: int = DUREE) -> None:
    reponse.set_cookie(COOKIE, session(j, compte, duree), max_age=duree, httponly=True, secure=COOKIE_SUR, samesite="lax")


def joueur_du_cookie(requete: Request):
    """Le joueur connecté sur cet appareil, ou None : session signée, encore valable, de la génération en cours de son
    compte, lien du compte toujours celui que tient l'atelier, et aucun mot de passe provisoire en cours (le MJ en a tiré
    un : toutes ses sessions tombent)."""
    valeur = requete.cookies.get(COOKIE, "")
    morceaux = valeur.split(".")
    if len(morceaux) != 5 or morceaux[0] != "v2":
        return None
    j = invite_par_id(morceaux[1])
    compte = comptes.lire(DEPOT, j["id"]) if j else None
    if not comptes.ouvert(compte) or compte["lien"] != j.get("jeton") or str(compte["generation"]) != morceaux[2]:
        return None
    if provisoires.en_cours(DEPOT, j["id"], compte):
        return None
    ok = porte.jeton_valide(valeur, lambda champs, echeance: signature_session(j, compte, champs, echeance), 3)
    return j if ok is not None else None


def connecte(requete: Request) -> dict:
    """Le joueur connecté, ou 401. La seule garde des routes du coin : toute nouvelle route d'un joueur l'appelle (ou la
    prend en dépendance, Depends(connecte))."""
    j = joueur_du_cookie(requete)
    if not j:
        raise HTTPException(401, "Connectez-vous avec votre identifiant et votre mot de passe.")
    return j


def fichier_joueur(j: dict) -> Path:
    if not ID_VALIDE.match(j.get("id", "")):
        raise HTTPException(403, "Accès invalide")
    return DEPOT / f"{j['id']}.json"


def lire_proposition(j: dict) -> dict:
    chemin = fichier_joueur(j)
    try:
        return stockage.lire_json(chemin)
    except (OSError, ValueError):
        return {"joueur": j["id"], "aventurier": None, "envoye": False, "envoye_le": None, "accueilli": None, "modifie": None}


def ecrire_proposition(j: dict, proposition: dict) -> None:
    chemin = fichier_joueur(j)
    stockage.ecrire_json(chemin, proposition, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def nettoyer(aventurier: dict) -> dict:
    """La fiche du joueur, typée champ par champ comme l'écrit le créateur (carnet.fiche_typee), sans ce qui revient au
    MJ : ni la validation d'un don, ni le niveau."""
    propre = carnet.fiche_typee({k: v for k, v in aventurier.items() if k not in RESERVES and k != "version_base"})
    propre["niveau"] = 1
    return propre


def relie(j: dict) -> dict | None:
    """Le héros que le MJ a relié à ce joueur depuis l'atelier (.acces.json, liens_joueurs.py de l'atelier)."""
    r = j.get("relie")
    return r if isinstance(r, dict) else None


def accueilli(j: dict, p: dict) -> bool:
    """Le MJ a accueilli son aventurier, ou lui a relié un héros de la tablée : la suite se fait avec lui, plus rien ne
    s'écrit ici."""
    return bool(p.get("accueilli") or relie(j))


def refus_accueilli(j: dict) -> str:
    """Le mot d'un refus (423) une fois la fiche chez le MJ : accueillie, ou un héros de la tablée confié au joueur."""
    r = relie(j)
    if r:
        nom = " ".join(str(r.get("nom") or "").split())
        return f"Votre MJ vous a confié {nom or 'un héros de la tablée'} : la suite se fait avec lui."
    return "Votre MJ a accueilli cet aventurier : la suite se fait avec lui."


def coin() -> dict | None:
    """Ce que l'atelier publie pour le coin, carnet ouvert comme fermé (carnet.publier_coin)."""
    return carnet.publie(DEPOT, carnet.COIN)


def couleurs_prises(c: dict | None) -> list:
    return [x for x in (c or {}).get("couleurs") or [] if isinstance(x, str)][:24]


def prochaine(c: dict | None) -> str:
    quand = (c or {}).get("prochaine")
    return quand[:80] if isinstance(quand, str) else ""


def place_a_la_tablee(j: dict, p: dict, c: dict | None = None):
    """Le héros de ce joueur tel qu'il est à la tablée en ce moment, {nom, genre} ; False s'il n'y est pas (mis de côté
    par le MJ, à la corbeille, ou jamais accueilli) ; None quand on ne sait pas : l'atelier n'a encore rien publié, ou
    il a accueilli (ou relié) ce héros après sa dernière publication, qu'il refait dans les cinq secondes."""
    c = coin() if c is None else c
    if c is None:
        return None
    cle = carnet.cle_heros(j.get("jeton", ""))
    place = next((e for e in c["elements"] if isinstance(e, dict) and e.get("cle") == cle), False)
    depuis = str((relie(j) or {}).get("le") or p.get("accueilli_le") or "")
    return None if place is False and str(c.get("maj") or "") < depuis else place


def qui_attend(j: dict, p: dict, place=None) -> dict:
    """Le nom et le genre du héros qui attend le joueur à la tablée : celui que l'atelier y voit, sa fiche du carnet s'il
    est ouvert, sinon le héros relié par le MJ, sinon l'aventurier envoyé."""
    for source in (place if isinstance(place, dict) else None, heros_publie(j) if carnet_ouvert() else None, relie(j), p.get("aventurier")):
        nom = source.get("nom") if isinstance(source, dict) else None
        if isinstance(nom, str) and nom.strip():
            return {"nom": " ".join(nom.split())[:120], "genre": source.get("genre") if source.get("genre") in ("h", "f") else ""}
    return {"nom": "", "genre": ""}


def vue(j: dict, p: dict) -> dict:
    ferme = accueilli(j, p)
    c = coin()
    place = place_a_la_tablee(j, p, c) if ferme else None
    return {"joueur": j.get("nom", ""), "aventurier": p.get("aventurier"), "envoye": bool(p.get("envoye")),
            "envoye_le": p.get("envoye_le"), "accueilli": ferme,
            "accueilli_le": ((relie(j) or {}).get("le") or p.get("accueilli_le")) if ferme else None,
            "heros": qui_attend(j, p, place) if ferme else None, "carnet": carnet_ouvert(),
            # Accueilli puis plus à la tablée : le coin ne promet plus une fiche que le carnet ne montre pas.
            "relie": bool(relie(j)), "present": (place is not False) if ferme else None,
            "couleurs_prises": couleurs_prises(c), "prochaine": prochaine(c)}


def nombre_fini(texte: str) -> float:
    v = float(texte)
    if not math.isfinite(v):
        raise ValueError("Nombre hors limites")
    return v


def refuser_constante(nom: str):
    raise ValueError(f"Nombre invalide : {nom}")


async def objet(requete: Request) -> dict:
    # Ni NaN, ni Infinity, ni un nombre trop grand pour un flottant (1e400) : aucun ne se relirait en JSON valide.
    try:
        corps = json.loads(await requete.body(), parse_constant=refuser_constante, parse_float=nombre_fini)
    except (ValueError, RecursionError):
        raise HTTPException(400, "Corps de requête illisible")
    if not isinstance(corps, dict):
        raise HTTPException(400, "Objet JSON attendu")
    return corps


@functools.cache
def version_statique() -> str:
    """Une empreinte de ce que le coin sert (ses pages et la liste FICHIERS). Les pages la mettent dans l'adresse de leurs
    fichiers (/static/v-<empreinte>/…) : Cloudflare fait garder un fichier statique quatre heures dans le navigateur, et un
    joueur resterait sur l'ancien code après chaque mise en service. Une adresse nouvelle ne s'est jamais vue : il la lit."""
    h = hashlib.sha1()
    for chemin in [*sorted(FICHIERS), *sorted(f"joueurs/{p.name}" for p in (STATIQUE / "joueurs").glob("*.html"))]:
        try:
            h.update(chemin.encode())
            h.update((STATIQUE / chemin).read_bytes())
        except OSError:
            continue
    return h.hexdigest()[:10]


def page(nom: str, statut: int = 200) -> HTMLResponse:
    texte = nom_campagne.nommer((STATIQUE / "joueurs" / nom).read_text(encoding="utf-8"))
    texte = re.sub(r'(href|src)="/static/', rf'\1="/static/v-{version_statique()}/', texte)
    return HTMLResponse(texte, status_code=statut, headers={"Cache-Control": "no-cache"})


def vers_connexion(requete: Request) -> RedirectResponse:
    """Une page protégée ouverte sans session : la connexion, qui dit pourquoi et ramène ensuite à cette page."""
    return RedirectResponse(f"/connexion?raison=session&{urlencode({'suite': requete.url.path})}", status_code=303)


# Une adresse qui n'existe pas, ouverte dans un navigateur : une page du coin (logo, retour), pas du JSON brut. Les routes
# d'API, les fichiers et les images gardent leur réponse JSON.
@app.exception_handler(StarletteHTTPException)
async def erreur_http(requete: Request, exc: StarletteHTTPException):
    chemin = requete.url.path
    if (exc.status_code == 404 and requete.method == "GET" and "text/html" in requete.headers.get("accept", "")
            and not chemin.startswith(("/api/", "/static/")) and not chemin.endswith("/media") and "/media/" not in chemin):
        return page("introuvable.html", 404)
    return await http_exception_handler(requete, exc)


@app.get("/")
def accueil(requete: Request, cle: str = ""):
    if cle:
        return ouvrir_lien(requete, cle)
    # Le premier passage après la mise en service ouvre les 30 jours de la migration (la sonde passe ici).
    comptes.fin_migration(DEPOT)
    if j := joueur_du_cookie(requete):
        # Son héros à la tablée : l'onglet « Héros » montre sa fiche et son portrait, plus le créateur.
        return page(page_du_heros(j))
    if invite(requete):
        return RedirectResponse("/compte", status_code=303)
    return page("connexion.html")


@app.get("/fiche")
def fiche(requete: Request, rendu: str = ""):
    if rendu:
        # Chromium, lancé par /fiche.pdf, ouvre la fiche avec un jeton de rendu : il reçoit une session de cinq minutes.
        ident, echeance = RENDUS.pop(rendu, ("", 0.0))
        j = invite_par_id(ident)
        compte = comptes.lire(DEPOT, j["id"]) if j else None
        if not j or not comptes.ouvert(compte) or echeance < time.monotonic():
            raise HTTPException(403, "Rendu refusé")
        r = page("fiche.html")
        poser_session(r, j, compte, 300)
        return r
    if not joueur_du_cookie(requete):
        return vers_connexion(requete)
    return page("fiche.html")


PDF_PAR_HEURE = 12
PDF_RECENTS: dict[str, list[float]] = {}


@app.get("/fiche.pdf")
async def fiche_pdf(requete: Request):
    j = connecte(requete)
    a = lire_proposition(j).get("aventurier")
    if not a:
        raise HTTPException(404, "Pas encore d'aventurier")
    for perime in [k for k, (_, t) in RENDUS.items() if t < time.monotonic()]:
        RENDUS.pop(perime, None)
    # Chaque rendu lance Chromium, un à la fois pour tout le coin : un joueur n'en demande pas sans fin.
    instant = time.monotonic()
    recents = [t for t in PDF_RECENTS.get(j["id"], ()) if instant - t < 3600]
    if len(recents) >= PDF_PAR_HEURE:
        raise HTTPException(429, "Beaucoup de PDF en peu de temps : réessayez dans un moment.")
    PDF_RECENTS[j["id"]] = [*recents, instant]
    jeton = secrets.token_urlsafe(24)
    RENDUS[jeton] = (j["id"], time.monotonic() + 60)
    options = {k: v for k, v in requete.query_params.items() if k in ("verso", "eco")}
    try:
        contenu = await page_en_pdf(f"http://localhost:8000/fiche?{urlencode({'rendu': jeton, **options})}")
    except RenduImpossible as err:
        raise HTTPException(503, f"PDF impossible : {err}")
    finally:
        RENDUS.pop(jeton, None)
    return Response(contenu, media_type="application/pdf",
                    headers={"Content-Disposition": nom_de_fichier(a.get("nom") or j.get("nom")), "Cache-Control": "no-store"})


# Les comptes (comptes.py, provisoires.py). Le MJ tire dans l'atelier un mot de passe provisoire ; le joueur entre avec,
# une fois, et choisit le sien avant toute autre chose ; ensuite, il entre par son identifiant et son mot de passe. Un
# nouveau provisoire du MJ coupe toutes ses sessions. Rien ne dit si un identifiant existe ; les essais manqués sont
# comptés (porte.Essais), et scrypt tourne hors de la boucle, deux calculs à la fois au plus.

def suite_du_joueur(j: dict) -> str:
    """Où arrive un joueur qui vient d'entrer : une fois son héros à la tablée, dans le carnet, sur sa fiche."""
    p = lire_proposition(j)
    a_la_tablee = accueilli(j, p) and place_a_la_tablee(j, p) is not False
    return "/carnet#heros" if a_la_tablee and carnet_ouvert() else "/"


def signature_invitation(j: dict, prov: dict, champs: list, echeance: int) -> str:
    # Liée à l'empreinte du provisoire et à sa génération : un provisoire refait entre-temps par le MJ la rend caduque.
    return porte.signer(cle_session(), "|".join(["provisoire", *champs, str(echeance), prov["empreinte"], j["jeton"]]))


def poser_invitation(reponse: Response, j: dict, prov: dict) -> None:
    # Une heure, ou moins si le provisoire expire avant.
    instant = int(time.time())
    duree = max(1, min(DUREE_INVITATION, provisoires.echeance(prov) - instant))
    valeur = porte.jeton_signe([j["id"], prov["generation"]], instant + duree,
                               lambda champs, e: signature_invitation(j, prov, champs, e))
    reponse.set_cookie(INVITATION, valeur, max_age=duree, httponly=True, secure=COOKIE_SUR, samesite="lax")


def entre_par_provisoire(requete: Request) -> tuple[dict, dict] | None:
    """(joueur, provisoire) d'un appareil qui vient d'entrer par le mot de passe provisoire et doit choisir le sien : rien
    d'autre ne s'ouvre avant. Caduc dès que le provisoire a servi, expire ou est refait."""
    valeur = requete.cookies.get(INVITATION, "")
    morceaux = valeur.split(".")
    if len(morceaux) != 4:
        return None
    j = invite_par_id(morceaux[0])
    prov = provisoires.en_cours(DEPOT, j["id"], comptes.lire(DEPOT, j["id"])) if j else None
    if not prov or str(prov["generation"]) != morceaux[1] or provisoires.expire(prov):
        return None
    ok = porte.jeton_valide(valeur, lambda champs, e: signature_invitation(j, prov, champs, e), 2)
    return (j, prov) if ok is not None else None


def invite_d_avant(requete: Request) -> dict | None:
    """Un cookie d'avant les comptes (« <joueur>.<signature> »), encore bon, sans compte ni provisoire du MJ en cours : il
    vaut invitation à créer le sien pendant les 30 jours de la migration. C'est une session ouverte avant le 08/11 sur un
    appareil du joueur, pas un lien : il ne s'envoie ni ne se recopie d'un message."""
    valeur = requete.cookies.get(COOKIE, "")
    ident, _, sig = valeur.partition(".")
    j = invite_par_id(ident) if valeur.count(".") == 1 and sig.isascii() else None
    if not j or not hmac.compare_digest(signature(j), sig) or comptes.lire(DEPOT, j["id"]) is not None:
        return None
    if provisoires.en_cours(DEPOT, j["id"], None):
        return None
    return j if time.time() < comptes.fin_migration(DEPOT) else None


def invite(requete: Request):
    """Cet appareil a un mot de passe à choisir : après le provisoire du MJ, ou par un cookie d'avant les comptes."""
    return entre_par_provisoire(requete) or invite_d_avant(requete)


def ouvrir_lien(requete: Request, cle: str):
    """Un lien personnel d'avant les mots de passe provisoires, resté dans une messagerie. Il ne crée plus de compte et
    n'ouvre rien : il mène à la page de connexion, qui dit de demander au MJ son identifiant et un mot de passe
    provisoire. La clé ne reste pas dans l'adresse, et rien ne dit si elle était bonne."""
    return RedirectResponse("/connexion?lien=ancien", status_code=303)


def adresse_du_client(requete: Request) -> str:
    return requete.headers.get("cf-connecting-ip") or (requete.client.host if requete.client else "?")


def texte_court(valeur, maximum: int) -> str:
    return valeur[:maximum] if isinstance(valeur, str) else ""


@app.get("/connexion")
def page_connexion(requete: Request):
    if joueur_du_cookie(requete):
        return RedirectResponse("/", status_code=303)
    return page("connexion.html")


# Le guide du coin : une page statique, sans rien de la campagne, lisible avant même la première connexion (la page de
# connexion y renvoie).
FICHIERS |= {"css/guide-coin.css"}


@app.get("/guide")
def page_guide():
    return page("guide.html")


@app.get("/compte")
def page_compte(requete: Request):
    if invite(requete) or joueur_du_cookie(requete):
        return page("compte.html")
    return RedirectResponse("/connexion", status_code=303)


@app.get("/api/compte")
def etat_compte(requete: Request):
    """Ce que la page du compte doit proposer : choisir son mot de passe (après le provisoire du MJ), créer son compte
    (cookie d'avant les comptes), ou changer son mot de passe. Jamais l'empreinte, ni le provisoire."""
    entre = entre_par_provisoire(requete)
    if entre:
        j, prov = entre
        return {"etat": "choisir", "joueur": j.get("nom", ""), "identifiant": prov["identifiant"]}
    j = invite_d_avant(requete)
    if j:
        return {"etat": "creer", "joueur": j.get("nom", "")}
    j = connecte(requete)
    return {"etat": "connecte", "joueur": j.get("nom", ""), "identifiant": (comptes.lire(DEPOT, j["id"]) or {}).get("identifiant", "")}


@app.post("/api/compte")
async def creer_compte(requete: Request):
    corps = await objet(requete)
    entre = entre_par_provisoire(requete)
    if entre:
        return await choisir_apres_provisoire(*entre, corps)
    j = invite_d_avant(requete)
    if not j:
        if requete.cookies.get(INVITATION):
            # Entré par un provisoire que le MJ a refait depuis : la page renvoie à la connexion, avec le dernier reçu.
            reponse = JSONResponse({"detail": provisoires.CADUC}, status_code=401)
            reponse.delete_cookie(INVITATION, httponly=True, secure=COOKIE_SUR, samesite="lax")
            return reponse
        raise HTTPException(401, "Connectez-vous avec l'identifiant et le mot de passe provisoire que votre MJ vous a donnés.")
    try:
        identifiant = comptes.identifiant_choisi(corps.get("identifiant"))
        mdp = comptes.mot_de_passe_choisi(corps.get("mot_de_passe"), corps.get("confirmation"), identifiant)
    except comptes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)
    # Comme la connexion : les essais manqués comptent (un identifiant pris en est un, il dirait qui a un compte), par
    # adresse et par joueur ; une forme refusée plus haut ne coûte rien et ne compte pas.
    cles = (("adresse", adresse_du_client(requete)), ("creation", j["id"]))
    essai = ESSAIS.reserver(cles, {cles[0]: ECHECS_PAR_ADRESSE, cles[1]: ECHECS_PAR_IDENTIFIANT}, ECHECS_EN_TOUT)
    if essai is None:
        raise HTTPException(429, "Trop d'essais manqués : réessayez dans un quart d'heure.")
    try:
        if comptes.pris(DEPOT, comptes.forme(identifiant)):
            raise comptes.Refus(409, "Cet identifiant est déjà pris : choisissez-en un autre.")
        empr = await porte.calculer(porte.empreinte, mdp)
        compte = await asyncio.to_thread(comptes.creer, DEPOT, j["id"], j["jeton"], identifiant, empr)
    except comptes.Refus as refus:
        await asyncio.sleep(ATTENTE_ECHEC)
        raise HTTPException(refus.statut, refus.message)
    ESSAIS.liberer(essai)
    ESSAIS.oublier(*cles)
    reponse = JSONResponse({"ok": True, "identifiant": compte["identifiant"], "suite": suite_du_joueur(j)})
    poser_session(reponse, j, compte)
    return reponse


async def choisir_apres_provisoire(j: dict, prov: dict, corps: dict):
    """Le joueur entré par son provisoire choisit son mot de passe : le provisoire ne sert plus, la session s'ouvre."""
    try:
        mdp = comptes.mot_de_passe_choisi(corps.get("mot_de_passe"), corps.get("confirmation"), prov["identifiant"])
        # Pas le provisoire lui-même : le MJ le connaît, et il a pu passer par une messagerie.
        if await porte.calculer(porte.verifier, prov["empreinte"], provisoires.canonique(mdp)):
            raise comptes.Refus(400, "Choisissez un mot de passe à vous, pas le provisoire de votre MJ.")
        empr = await porte.calculer(porte.empreinte, mdp)
        compte = await asyncio.to_thread(provisoires.utiliser, DEPOT, j["id"], prov["generation"], empr, j["jeton"])
    except comptes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)
    reponse = JSONResponse({"ok": True, "identifiant": compte["identifiant"], "suite": suite_du_joueur(j)})
    poser_session(reponse, j, compte)
    reponse.delete_cookie(INVITATION, httponly=True, secure=COOKIE_SUR, samesite="lax")
    return reponse


def leurre() -> str:
    # Un identifiant inconnu coûte le même calcul qu'un vrai : la durée de la réponse ne dit pas s'il existe.
    return f"scrypt:{porte.N}:{porte.R}:{porte.P}:{secrets.token_hex(16)}:{secrets.token_hex(32)}"


@app.post("/api/connexion")
async def se_connecter(requete: Request):
    corps = await objet(requete)
    voulu = comptes.forme(texte_court(corps.get("identifiant"), 64))
    mdp = texte_court(corps.get("mot_de_passe"), 256)
    cles = (("adresse", adresse_du_client(requete)), ("identifiant", voulu))
    essai = ESSAIS.reserver(cles, {cles[0]: ECHECS_PAR_ADRESSE, cles[1]: ECHECS_PAR_IDENTIFIANT}, ECHECS_EN_TOUT)
    if essai is None:
        raise HTTPException(429, "Trop d'essais manqués : réessayez dans un quart d'heure.")
    # Un seul calcul, quel que soit le cas : le provisoire en cours s'il y en a un (l'ancien mot de passe ne vaut plus),
    # sinon le mot de passe du compte, sinon un leurre.
    compte, prov = provisoires.pour_la_connexion(DEPOT, voulu)
    # Le compte d'un joueur retiré ne rouvre pas : sans lui dans .acces.json, le bon mot de passe échoue comme un faux.
    porteur = prov or compte
    j = invite_par_id(porteur["joueur"]) if porteur else None
    if prov:
        bon = await porte.calculer(porte.verifier, prov["empreinte"], provisoires.canonique(mdp))
    else:
        bon = await porte.calculer(porte.verifier, compte["empreinte"] if compte else leurre(), mdp)
    if not (bon and j):
        await asyncio.sleep(ATTENTE_ECHEC)
        raise HTTPException(401, "Identifiant ou mot de passe incorrect.")
    ESSAIS.liberer(essai)
    if prov:
        if provisoires.expire(prov):
            raise HTTPException(403, "Ce mot de passe provisoire a expiré : demandez-en un nouveau à votre MJ.")
        ESSAIS.oublier(*cles)
        # Rien d'autre ne s'ouvre avant le choix de son mot de passe : pas de session, seulement l'invitation à choisir.
        reponse = JSONResponse({"ok": True, "suite": "/compte", "choisir": True})
        poser_invitation(reponse, j, prov)
        reponse.delete_cookie(COOKIE, httponly=True, secure=COOKIE_SUR, samesite="lax")
        return reponse
    if compte["lien"] != j["jeton"]:
        raise HTTPException(403, "Votre compte attend un mot de passe provisoire : demandez-le à votre MJ.")
    ESSAIS.oublier(*cles)
    reponse = JSONResponse({"ok": True, "suite": suite_du_joueur(j)})
    poser_session(reponse, j, compte)
    return reponse


@app.post("/api/deconnexion")
def se_deconnecter():
    reponse = JSONResponse({"ok": True})
    for nom in (COOKIE, INVITATION):
        reponse.delete_cookie(nom, httponly=True, secure=COOKIE_SUR, samesite="lax")
    return reponse


@app.post("/api/compte/mot-de-passe")
async def changer_mot_de_passe(requete: Request):
    """Le joueur connecté change son mot de passe (l'actuel d'abord) : ses autres appareils sont déconnectés, celui-ci
    reçoit une session neuve."""
    j = connecte(requete)
    corps = await objet(requete)
    compte = comptes.lire(DEPOT, j["id"])
    try:
        nouveau = comptes.mot_de_passe_choisi(corps.get("nouveau"), corps.get("confirmation"), compte["identifiant"])
    except comptes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)
    cles = (("adresse", adresse_du_client(requete)), ("identifiant", compte["forme"]))
    essai = ESSAIS.reserver(cles, {cles[0]: ECHECS_PAR_ADRESSE, cles[1]: ECHECS_PAR_IDENTIFIANT}, ECHECS_EN_TOUT)
    if essai is None:
        raise HTTPException(429, "Trop d'essais manqués : réessayez dans un quart d'heure.")
    if not await porte.calculer(porte.verifier, compte["empreinte"], texte_court(corps.get("actuel"), 256)):
        await asyncio.sleep(ATTENTE_ECHEC)
        raise HTTPException(403, "Mot de passe actuel incorrect.")
    ESSAIS.liberer(essai)
    ESSAIS.oublier(*cles)
    try:
        compte = await asyncio.to_thread(comptes.changer, DEPOT, j["id"], compte["generation"],
                                         await porte.calculer(porte.empreinte, nouveau))
    except comptes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)
    reponse = JSONResponse({"ok": True})
    poser_session(reponse, j, compte)
    return reponse


@app.get("/static/{chemin:path}")
def statique(chemin: str):
    # Sous /static/v-<empreinte>/ : la même chose, gardée un an quand l'empreinte est celle du moment ; une page ouverte avant
    # une mise en service, qui demande encore l'ancienne empreinte, reçoit les fichiers d'aujourd'hui, sans cache.
    versionne = False
    m = re.match(r"v-[0-9a-f]{10}/(.+)$", chemin)
    if m:
        versionne = chemin[2:12] == version_statique()
        chemin = m.group(1)
    # Un fichier de la liste peut manquer : les jingles (sons/) viennent du pack de campagne, facultatif.
    if chemin not in FICHIERS or not (STATIQUE / chemin).is_file():
        raise HTTPException(404, "Introuvable")
    if versionne:
        duree = "public, max-age=31536000, immutable"
    else:
        duree = "public, max-age=2592000" if chemin.startswith(("fonts/", "img/", "sons/")) else "no-cache"
    return FileResponse(STATIQUE / chemin, headers={"Cache-Control": duree})


@app.get("/api/moi")
def moi(requete: Request):
    j = connecte(requete)
    return vue(j, lire_proposition(j))


@app.get("/api/moi/aventurier")
def lire_aventurier(requete: Request):
    j = connecte(requete)
    p = lire_proposition(j)
    if not p.get("aventurier"):
        raise HTTPException(404, "Pas encore d'aventurier")
    return p["aventurier"]


@app.post("/api/moi/aventurier")
async def creer_aventurier(requete: Request):
    j = connecte(requete)
    p = lire_proposition(j)
    if relie(j):
        raise HTTPException(423, refus_accueilli(j))
    if p.get("aventurier"):
        raise HTTPException(409, "Vous avez déjà un aventurier : rechargez la page.")
    a = nettoyer(await objet(requete))
    a["id"] = j["id"]
    a["cree"] = a["modifie"] = maintenant()
    a["joueur"] = (a.get("joueur") or j.get("nom") or "")[:60]
    p.update(aventurier=a, modifie=a["modifie"])
    ecrire_proposition(j, p)
    return a


@app.put("/api/moi/aventurier")
async def enregistrer_aventurier(requete: Request):
    j = connecte(requete)
    corps = await objet(requete)
    p = lire_proposition(j)
    avant = p.get("aventurier")
    if not avant:
        raise HTTPException(404, "Pas encore d'aventurier")
    if accueilli(j, p):
        raise HTTPException(423, refus_accueilli(j))
    if "version_base" in corps and corps["version_base"] != avant.get("modifie"):
        raise HTTPException(409, "Cette fiche a été modifiée depuis un autre écran.")
    a = nettoyer(corps)
    a.update(id=avant["id"], cree=avant.get("cree"), modifie=maintenant())
    p.update(aventurier=a, modifie=a["modifie"])
    ecrire_proposition(j, p)
    return a


@app.post("/api/moi/envoyer")
def envoyer(requete: Request):
    j = connecte(requete)
    p = lire_proposition(j)
    if not p.get("aventurier"):
        raise HTTPException(404, "Pas encore d'aventurier")
    if accueilli(j, p):
        raise HTTPException(423, refus_accueilli(j))
    p.update(envoye=True, envoye_le=maintenant(), version_envoyee=p["aventurier"].get("modifie"))
    ecrire_proposition(j, p)
    return vue(j, p)


# Le carnet de la compagnie et l'échoppe, tels que l'atelier les a publiés (carnet.py). Rien ici ne choisit un fichier
# d'après la requête : les sections ont des noms fixes, la fiche du héros se trouve par la clé du lien du joueur (son
# cookie), une image par un nom vérifié. Fermé par le MJ, le carnet ne montre rien, boutiques comprises.

def publie(nom: str) -> dict | None:
    return carnet.publie(DEPOT, nom)


def carnet_ouvert() -> bool:
    return carnet.est_ouvert(DEPOT)


def section(nom: str) -> list:
    return carnet.section_publiee(DEPOT, nom)


def heros_publie(j: dict) -> dict | None:
    return carnet.heros_publie(DEPOT, j.get("jeton", ""))


def commandes_du_joueur(j: dict) -> list:
    try:
        return carnet.lire_commandes(DEPOT, j["id"])
    except carnet.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


@app.get("/carnet")
def page_carnet(requete: Request):
    if not joueur_du_cookie(requete):
        return vers_connexion(requete)
    return page("carnet.html")


@app.get("/api/carnet")
def lire_carnet(requete: Request):
    j = connecte(requete)
    c = coin()
    quand = prochaine(c)
    if not carnet_ouvert():
        return {"ouvert": False, "prochaine": quand}
    contenu = carnet.carnet_du_joueur(DEPOT, j.get("nom", ""), j.get("jeton", ""))
    p = lire_proposition(j)
    # Accueilli, mais plus à la tablée (mis de côté par le MJ, ou à la corbeille) : la page le dit au lieu d'attendre.
    place = place_a_la_tablee(j, p, c) if accueilli(j, p) else None
    return contenu | {"prochaine": quand, "absent": qui_attend(j, p) if place is False and not contenu["heros"] else None,
                      "bible": bible.index_publie(DEPOT) is not None}


@app.get("/carnet/media/{nom}")
def media_carnet(nom: str, requete: Request):
    connecte(requete)
    if not carnet.NOM_MEDIA.match(nom) or not carnet_ouvert():
        raise HTTPException(404, "Introuvable")
    chemin = DEPOT / carnet.CARNET / carnet.MEDIA / nom
    if not chemin.is_file():
        raise HTTPException(404, "Introuvable")
    return FileResponse(chemin, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


@app.get("/api/echoppe")
def echoppe(requete: Request):
    """Les boutiques ouvertes aux joueurs, la bourse de son héros et ses commandes (les siennes seulement)."""
    j = connecte(requete)
    if not carnet_ouvert():
        return {"ouvert": False}
    return carnet.vue_echoppe(section("boutiques"), heros_publie(j), commandes_du_joueur(j))


def passer(j: dict, corps: dict) -> dict:
    if not carnet_ouvert():
        raise carnet.Refus(423, "Le carnet est fermé : les boutiques aussi.")
    h = heros_publie(j)
    if not h:
        raise carnet.Refus(409, "Votre héros doit d'abord être accueilli dans la tablée par le MJ.")
    bourse = h.get("or") if isinstance(h.get("or"), int) and not isinstance(h.get("or"), bool) else 0
    boutiques = section("boutiques")
    with carnet.verrou(DEPOT):
        deja = carnet.lire_commandes(DEPOT, j["id"])
        c = carnet.nouvelle_commande(corps, boutiques, bourse, deja)
        carnet.ecrire_commandes(DEPOT, j["id"], carnet.ajouter_commande(deja, c))
    return carnet.vue_commande(c)


@app.post("/api/commandes")
async def passer_commande(requete: Request):
    j = connecte(requete)
    if int(requete.headers.get("content-length") or 0) > COMMANDE_OCTETS_MAX:
        raise HTTPException(413, "Commande trop longue")
    corps = await objet(requete)
    if len(json.dumps(corps)) > COMMANDE_OCTETS_MAX:
        raise HTTPException(413, "Commande trop longue")
    try:
        return await asyncio.to_thread(passer, j, corps)
    except carnet.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


@app.delete("/api/commandes/{ident}")
def retirer_commande(ident: str, requete: Request):
    j = connecte(requete)
    if not carnet.ID_COMMANDE.match(ident):
        raise HTTPException(404, "Commande introuvable")
    try:
        with carnet.verrou(DEPOT):
            deja = carnet.lire_commandes(DEPOT, j["id"])
            c = next((x for x in deja if x["id"] == ident), None)
            if not c:
                raise HTTPException(404, "Commande introuvable")
            if c.get("statut") != "en-attente":
                raise HTTPException(409, "Le MJ a déjà traité cette commande.")
            carnet.ecrire_commandes(DEPOT, j["id"], [x for x in deja if x is not c])
    except carnet.Refus as refus:
        raise HTTPException(refus.statut, refus.message)
    return {"ok": True}


# « Mes limites » (confort.py) : les lignes et les voiles du joueur connecté, et les siennes seulement (son cookie, jamais
# un identifiant venu de la requête). Écrites entre deux séances, lues par le MJ sans son nom, sauf s'il l'accepte.

@app.get("/api/moi/limites")
def lire_limites(requete: Request):
    j = connecte(requete)
    try:
        return confort.lire(DEPOT, j["id"])
    except ValueError:
        raise HTTPException(403, "Accès invalide")


@app.put("/api/moi/limites")
async def noter_limites(requete: Request):
    j = connecte(requete)
    if int(requete.headers.get("content-length") or 0) > confort.OCTETS_MAX:
        raise HTTPException(413, "Trop long pour des limites")
    corps = await objet(requete)
    if len(json.dumps(corps, ensure_ascii=False).encode()) > confort.OCTETS_MAX:
        raise HTTPException(413, "Trop long pour des limites")
    try:
        lim = confort.limites(corps)
        return confort.ecrire(DEPOT, j["id"], lim)
    except ValueError as err:
        raise HTTPException(400, str(err))


# La bible des joueurs (bible.py) : ce que l'atelier a publié dans bible/, liste blanche et masque déjà passés. Le chemin
# demandé n'est qu'une clé de l'index publié : tout le reste répond 404, et /lore n'est pas monté ici. Fermée par le MJ,
# elle ne montre rien. La recherche parcourt toute la bible : 30 par minute et par joueur.
RECHERCHES_BIBLE = bible.Cadence(30, 60)


def bible_des_joueurs(requete: Request) -> tuple[dict, dict]:
    j = connecte(requete)
    index = bible.index_publie(DEPOT)
    if index is None:
        raise HTTPException(423, bible.FERMEE)
    return j, index


@app.get("/bible")
def page_bible(requete: Request):
    if not joueur_du_cookie(requete):
        return vers_connexion(requete)
    return page("bible.html")


@app.get("/api/bible/ouverte")
def bible_ouverte(requete: Request):
    """Seulement : la bible est-elle ouverte ? La page le demande d'abord, pour ne pas ouvrir sur une réponse 423."""
    connecte(requete)
    return {"ouverte": bible.index_publie(DEPOT) is not None}


@app.get("/api/bible")
def sommaire_bible(requete: Request):
    _, index = bible_des_joueurs(requete)
    return bible.catalogue_publie(index)


@app.get("/api/bible/document")
def document_bible(requete: Request, chemin: str = ""):
    _, index = bible_des_joueurs(requete)
    try:
        return bible.document_publie(DEPOT, index, chemin)
    except bible.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


@app.get("/api/bible/recherche")
def recherche_bible(requete: Request, q: str = "", limite: int = 80):
    j, index = bible_des_joueurs(requete)
    if not RECHERCHES_BIBLE.accepter(j["id"]):
        raise HTTPException(429, "Trop de recherches d'un coup : attendez un instant.")
    return bible.chercher_publie(DEPOT, index, q[:200], limite)


# La table (table_joueurs.py) : ce que l'atelier a publié de ce que montre la TV, et le pion du joueur, trouvé par la clé
# de son lien (son cookie), jamais par la requête. Une image n'est servie que par un nom vérifié. Fermée par le MJ, rien.
FICHIERS |= {
    "js/joueurs/table-coin.js", "css/table-coin.css",
    # La vue d'un plan (plan/vue.js) et ce qu'elle importe : du dessin seulement, aucune donnée de la campagne.
    "js/plan/vue.js", "js/plan/brume.js", "js/plan/feu.js", "js/plan/modele.js", "js/plan/peint.js", "js/plan/peint-mobilier.js", "js/plan/sang.js",
    "js/plan/rendu.js", "js/plan/textures.js", "js/carte/vue.js", "js/carte/champs.js", "js/carte/format.js", "js/carte/geo.js",
    "js/carte/peint.js", "js/carte/peint-calcul.js", "js/carte/peint-dessus.js", "js/carte/noms.js", "js/carte/peint-habillage.js", "js/carte/rendu.js",
    "js/carte/symboles.js",
    # Le mobilier, les sols et les murs ajoutés le 09/11 : du dessin seulement.
    "js/plan/mobilier-plus.js", "js/plan/peint-mobilier-plus.js", "js/plan/murs-plus.js", "js/plan/sols-plus.js",
}


# Les jets de la tablée sur la page Table (lot du 12/11) : le bandeau de la TV (jet-tv.js), les dés en 3D (des-3d.js), les
# jingles des tests (sons-jets.js, sons/) et la jauge de volume de chaque appareil (volume-sons.js) ; jets-table-coin.js
# les réunit. Du dessin et du son seulement.
FICHIERS |= {"js/joueurs/jets-table-coin.js", "js/ecran-tv/jet-tv.js", "js/ecran-tv/des-3d.js", "js/ecran-tv/sons-jets.js",
             "js/ecran-tv/volume-sons.js", "css/jet-tv.css",
             "sons/jet-reussite.mp3", "sons/jet-reussite-critique.mp3", "sons/jet-echec.mp3", "sons/jet-echec-critique.mp3"}
# Les cartes : la carte du monde que montre la TV, sur la même page. Sa vue (carte/vue.js) est déjà servie avec
# celle des plans ; s'y ajoutent la page de la carte et le worker de son relief peint, du calcul seulement. Rien de la
# campagne : ni campagne/carte.js ni campagne/pays.js (lieux, secrets et nom de l'auberge), ni carte/saison4.js, ni le
# générateur, ni l'éditeur.
FICHIERS |= {"js/joueurs/carte-coin.js", "js/carte/peint-worker.js"}
# Les pions enrichis et les images posées sur le plan : du dessin seulement, importés par plan/rendu.js.
FICHIERS |= {"js/plan/pions.js", "js/plan/images.js"}
# Les sols et le mobilier des plans extérieurs, importés par plan/rendu.js, peint.js et textures.js : du dessin
# seulement (le générateur, lui, reste à l'atelier).
FICHIERS |= {"js/plan/dehors-dessin.js", "js/plan/dehors-peint.js"}


@app.get("/table")
def page_table(requete: Request):
    if not joueur_du_cookie(requete):
        return vers_connexion(requete)
    return page("table.html")


# Tout l'écran de la TV sur la page Table (lot du 12/11) : pour ce qui n'est ni un plan ni une carte (une image, un
# document, une boutique, la tablée, le sanctuaire…) et pour ce qui se pose dessus (cartons, horloges, réserve), la page
# Table tient dans un cadre la page même de la TV (joueurs/ecran.html : le corps de table.html, les modules de js/table/),
# et lui passe ce que l'atelier a publié pour le coin (vue.ecran : tv_etat.ecran_pour_le_coin). Ces modules ne sont que du
# dessin : ceux que la table publique sert déjà sur Internet. Aucun ne lit le serveur ici (table/source-coin.js).
FICHIERS |= {
    "js/table.js", "js/table/etat.js", "js/table/outils.js", "js/table/ecran.js", "js/table/carte-plan.js", "js/table/combat.js",
    "js/table/cartons.js", "js/table/boutique.js", "js/table/sanctuaire.js", "js/table/episode.js", "js/table/fiches.js",
    "js/table/image.js", "js/table/source-coin.js",
    "js/ecran-tv/compat-tv.js", "js/ecran-tv/eveil.js", "js/ecran-tv/horloges-tv.js", "js/ecran-tv/pointeur-tv.js",
    "js/ecran-tv/reserve-tv.js", "js/ecran-tv/tv-commun.js", "js/auberge/affiche.js", "js/boutiques/rayons-tv.js",
    "css/table.css", "css/affiches.css", "css/horloges-tv.css", "css/echoppe-tv.css",
}


@app.get(ECRAN_TABLE)
def page_ecran_table(requete: Request):
    if not joueur_du_cookie(requete):
        raise HTTPException(401, "Session requise")
    return page("ecran.html")


@app.get("/api/table/ouverte")
def table_ouverte(requete: Request):
    """Seulement : la table est-elle ouverte ? La barre du haut (onglet-table.js) cache l'onglet Table sinon."""
    connecte(requete)
    return {"ouverte": table_joueurs.vue_publiee(DEPOT) is not None}


@app.get("/api/table")
def lire_table(requete: Request):
    j = connecte(requete)
    vue = table_joueurs.vue_publiee(DEPOT)
    if vue is None:
        return {"ouverte": False}
    return {"ouverte": True, "vue": vue} | table_joueurs.pion_publie(DEPOT, carnet.cle_heros(j.get("jeton", "")), vue)


@app.get("/api/table/jets")
def lire_jets_de_la_table(requete: Request):
    """Les derniers bandeaux de jets de la tablée (table_joueurs.jets_publies), tels que la TV les reçoit : la page Table
    montre les dés et le bandeau des jets des autres. Table fermée : rien."""
    connecte(requete)
    return {"jets": table_joueurs.jets_publies(DEPOT)}


@app.get("/table/media/{nom}")
def media_table(nom: str, requete: Request):
    connecte(requete)
    chemin = table_joueurs.media_publie(DEPOT, nom)
    if chemin is None:
        raise HTTPException(404, "Introuvable")
    # Le nom vient du contenu : il ne change jamais d'image. Un PNG garde la transparence d'une image du MJ.
    genre = "image/png" if chemin.suffix == ".png" else "image/jpeg"
    return FileResponse(chemin, media_type=genre, headers={"Cache-Control": "private, max-age=86400"})
# Les demandes du joueur (demandes.py), le flux poussé vers sa page (flux_coin.py) et « Coin en pause ». Le joueur ne lit
# et n'écrit que son propre fichier de demandes (sa session, jamais un identifiant venu de la requête) ; l'atelier y
# écrit les statuts. Rien de ce que le flux envoie ne porte de contenu : la page relit par les routes habituelles.

FICHIERS |= {"js/joueurs/flux.js", "js/joueurs/demandes.js", "css/demandes-coin.css"}
FLUX = flux_coin.Flux(lambda: DEPOT)
# Les demandes faites dans l'heure, par joueur, en mémoire : le plafond tient même si le fichier a perdu ses plus
# anciennes demandes traitées (borner).
DEMANDES_FAITES: dict[str, list[float]] = {}
# En pause, ces routes restent ouvertes : entrer dans son compte n'écrit rien du jeu.
LIBRES_EN_PAUSE = ("/api/connexion", "/api/deconnexion", "/api/compte")
# Le créateur d'aventurier lit déjà un 423 comme « accueilli par le MJ » (il se ferme) : en pause, il reçoit un 503, qu'il
# traite comme une coupure. Il garde la saisie, la renvoie seul, et la pause levée, rien n'est perdu.
CREATEUR_EN_PAUSE = ("/api/moi/aventurier", "/api/moi/envoyer")


# Les gestes du sac (ranger, renommer, donner un objet) vont vite pendant une séance d'inventaire : ils ont leur propre
# compte, plus large, et n'entament pas celui des autres demandes (un mot au MJ, un don d'or).
GESTES_DU_SAC = ("sac", "don-objet")
GESTES_DU_SAC_PAR_HEURE = 150


def compte_horaire(joueur: str, genre: str = "") -> tuple[str, int]:
    return (f"{joueur}:sac", GESTES_DU_SAC_PAR_HEURE) if genre in GESTES_DU_SAC else (joueur, demandes.PAR_HEURE)


def plafond_horaire(joueur: str, genre: str = "") -> bool:
    cle, plafond = compte_horaire(joueur, genre)
    instant = time.monotonic()
    faites = [t for t in DEMANDES_FAITES.get(cle, []) if instant - t < 3600]
    DEMANDES_FAITES[cle] = faites
    return len(faites) >= plafond


# Ce qu'un genre vérifie en plus sur ce qui est publié pour ce joueur (sa fiche, la compagnie, ses autres demandes) :
# {genre : prealable(joueur, corps, ses demandes) → corps}, appelé sous le verrou. L'inventaire s'y branche (plus bas).
PREALABLES: dict = {}


def mot_adresse(_j: dict, corps: dict, _deja: list) -> dict:
    """« Un mot au MJ » adressé à un autre MJ que le principal : seulement à un MJ de la liste que l'atelier
    publie quand deux mènent la campagne ; sans liste, aucun choix."""
    mj = corps.get("mj")
    if mj is not None and mj not in {x["id"] for x in demandes.lire_destinataires(DEPOT)}:
        raise demandes.Refus(409, "Ce MJ ne reçoit plus de mots : choisissez-en un autre.")
    return corps


PREALABLES["message"] = mot_adresse


def demander_ici(j: dict, corps: dict) -> dict:
    d = demandes.nouvelle(corps, carnet_ouvert())
    if d["genre"] == main_levee.GENRE:
        # Une seule main levée à la fois, par quelque route qu'elle arrive (main_levee.lever).
        return demandes.vue_joueur(lever_ici(j))
    if d["genre"] == deplacement.GENRE:
        # Un déplacement à la fois, son propre plafond, et seulement les derniers gardés (deplacer_ici, plus bas).
        return demandes.vue_joueur(deplacer_ici(j, d))
    with demandes.verrou(DEPOT):
        if plafond_horaire(j["id"], d["genre"]):
            raise demandes.Refus(429, f"Pas plus de {compte_horaire(j['id'], d['genre'])[1]} demandes de ce genre par heure : "
                                      "réessayez un peu plus tard.")
        deja = demandes.lire(DEPOT, j["id"])
        if d["genre"] in PREALABLES:
            d["corps"] = PREALABLES[d["genre"]](j, d["corps"], deja)
        # Le plafond relu sur le disque compte, lui aussi, les seules demandes du même compte (les mains levées ont le leur) :
        # trente gestes du sac n'empêchent pas un mot au MJ.
        cle, plafond = compte_horaire(j["id"], d["genre"])
        demandes.ajouter([x for x in deja if x.get("genre") != main_levee.GENRE
                          and compte_horaire(j["id"], str(x.get("genre") or ""))[0] == cle], d, plafond)
        liste = demandes.borner([*deja, d])
        demandes.ecrire(DEPOT, j["id"], liste)
        DEMANDES_FAITES[compte_horaire(j["id"], d["genre"])[0]].append(time.monotonic())
    return demandes.vue_joueur(d)


def retirer_ici(j: dict, ident: str) -> dict:
    with demandes.verrou(DEPOT):
        liste = demandes.lire(DEPOT, j["id"])
        d = demandes.trouver(liste, ident)
        if d is None:
            raise demandes.Refus(404, "Demande introuvable.")
        demandes.passer(d, demandes.RETIREE, "joueur")
        if d.get("genre") == confie.GENRE:
            # Un passage « Pour le MJ seulement » retiré avant d'être déposé : le MJ ne doit pas le lire dans sa boîte, la
            # file n'en garde que la longueur (le joueur le relit dans sa page, confie/<joueur>.json).
            d["corps"] = confie.apres_application(d.get("corps"))
        demandes.ecrire(DEPOT, j["id"], liste)
    return demandes.vue_joueur(d)


@app.get("/api/demandes")
def lire_demandes(requete: Request):
    j = connecte(requete)
    try:
        liste = demandes.lire(DEPOT, j["id"])
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)
    # Les MJ à qui écrire, seulement quand deux mènent la campagne : sans invité, rien ne change.
    destinataires = demandes.lire_destinataires(DEPOT)
    return {"demandes": [demandes.vue_joueur(d) for d in reversed(liste) if demandes.dans_la_liste(d)], "pause": demandes.en_pause(DEPOT),
            "carnet": carnet_ouvert(), "message_max": demandes.MESSAGE_MAX, "par_heure": demandes.PAR_HEURE} | (
                {"destinataires": destinataires} if destinataires else {})


@app.post("/api/demandes")
async def faire_demande(requete: Request):
    j = connecte(requete)
    if int(requete.headers.get("content-length") or 0) > demandes.CORPS_OCTETS_MAX:
        raise HTTPException(413, "Demande trop longue")
    corps = await objet(requete)
    if len(json.dumps(corps, ensure_ascii=False).encode()) > demandes.CORPS_OCTETS_MAX:
        raise HTTPException(413, "Demande trop longue")
    try:
        return await asyncio.to_thread(demander_ici, j, corps)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


@app.delete("/api/demandes/{ident}")
async def retirer_demande(ident: str, requete: Request):
    j = connecte(requete)
    try:
        return await asyncio.to_thread(retirer_ici, j, ident)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


def session_tient(requete: Request, ident: str) -> bool:
    """La session du flux vaut-elle encore ? La même vérification que toute route du coin (connecte)."""
    try:
        return connecte(requete).get("id") == ident
    except HTTPException:
        return False


class ReponseFlux(StreamingResponse):
    """Le flux rend sa place quoi qu'il arrive, même si le navigateur est parti avant la première ligne."""

    def __init__(self, contenu, liberer, **options):
        super().__init__(contenu, **options)
        self.liberer = liberer

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            self.liberer()


@app.get("/api/flux")
async def flux_du_joueur(requete: Request):
    if flux_coin.origine_refusee(requete.headers):
        raise HTTPException(403, "Origine refusée")
    j = connecte(requete)
    try:
        q = FLUX.ouvrir(j["id"])
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)
    FLUX.demarrer()
    return ReponseFlux(FLUX.evenements(j["id"], q, lambda: session_tient(requete, j["id"])), lambda: FLUX.fermer(j["id"], q),
                       media_type="text/event-stream", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


# La main levée (main_levee.py) : « Je veux agir », pendant la partie, depuis les pages du coin où l'on joue
# (js/joueurs/main-levee.js). Le joueur ne lève et ne baisse que sa propre main (sa session) ; l'atelier lui donne la
# parole ou la baisse, et la page l'apprend par le flux (sujet « demandes »). Jamais « carnet requis » ; la pause, elle,
# fige aussi la main (PauseDuCoin).
FICHIERS |= {"js/joueurs/main-levee.js", "css/main-levee.css"}
# Les mains levées dans l'heure, par joueur : à part du plafond des autres demandes (une partie animée ne bloque pas
# « Un mot au MJ »), et en mémoire, puisque le fichier ne garde que les dernières.
MAINS_LEVEES: dict[str, list[float]] = {}


def lever_ici(j: dict) -> dict:
    instant = time.monotonic()
    faites = [t for t in MAINS_LEVEES.get(j["id"], []) if instant - t < 3600]
    MAINS_LEVEES[j["id"]] = faites
    if len(faites) >= main_levee.PAR_HEURE:
        raise demandes.Refus(429, "Vous avez beaucoup levé la main cette heure-ci : parlez-en de vive voix à votre MJ.")
    d, nouvelle = main_levee.lever(DEPOT, j["id"])
    if nouvelle:
        faites.append(instant)
    return d


def main_du_joueur(j: dict) -> dict:
    return main_levee.etat(demandes.lire(DEPOT, j["id"])) | {"pause": demandes.en_pause(DEPOT)}


@app.get("/api/main")
def etat_de_la_main(requete: Request):
    j = connecte(requete)
    try:
        return main_du_joueur(j)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


@app.post("/api/main")
async def lever_la_main(requete: Request):
    j = connecte(requete)
    try:
        await asyncio.to_thread(lever_ici, j)
        return await asyncio.to_thread(main_du_joueur, j)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


@app.delete("/api/main")
async def baisser_la_main(requete: Request):
    j = connecte(requete)
    try:
        await asyncio.to_thread(main_levee.baisser, DEPOT, j["id"])
        return await asyncio.to_thread(main_du_joueur, j)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


class PauseDuCoin:
    """« Coin en pause » (onglet Table de l'atelier) : toute écriture des joueurs est refusée, avec un mot clair. Placée
    sous la Garde (en dernier dans la pile), elle ne voit que des requêtes déjà admises."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if (scope["type"] == "http" and scope.get("method") in ("POST", "PUT", "PATCH", "DELETE")
                and not scope["path"].startswith(LIBRES_EN_PAUSE) and demandes.en_pause(DEPOT)):
            createur = scope["path"] in CREATEUR_EN_PAUSE
            reponse = JSONResponse({"detail": demandes.MOT_PAUSE, "pause": True}, status_code=503 if createur else 423,
                                   headers={"X-Coin-En-Pause": "1", **({"Retry-After": "60"} if createur else {})})
            return await reponse(scope, receive, send)
        await self.app(scope, receive, send)


# Sous la Garde : add_middleware place le dernier ajouté devant les autres, la pause va donc au bout de la liste.
app.user_middleware.append(Middleware(PauseDuCoin))


# L'inventaire (inventaire.py) : le joueur gère le sac de son héros et donne à un compagnon, par la file des demandes ;
# l'atelier rejoue chaque geste sur le sac du moment (sacs.py). Le coin ne lit que la fiche « Mon héros » publiée et la
# compagnie du carnet, où chaque compagnon n'est qu'un jeton (ref) ; l'or « engagé » se compte sur ses commandes et ses
# dons d'or en attente. Carnet fermé, l'inventaire l'est aussi.

FICHIERS |= {"js/joueurs/sac.js", "css/sac-coin.css"}
SAC_DEMANDES = 8  # les derniers gestes que la section du sac rappelle


def compagnons(j: dict) -> list:
    """Les autres héros de la compagnie, tels que le carnet les publie : leur jeton, leur nom, leur genre."""
    moi = carnet.cle_heros(j.get("jeton", ""))
    return [{"ref": h["ref"], "nom": str(h.get("nom") or "")[:120], "genre": h.get("genre") if h.get("genre") in ("h", "f") else ""}
            for h in section("compagnie")
            if isinstance(h.get("ref"), str) and inventaire.REF.match(h["ref"]) and h.get("cle") != moi]


def or_du_joueur(j: dict, h: dict | None, liste: list | None = None) -> dict:
    engage = inventaire.or_engage(carnet.lire_commandes(DEPOT, j["id"]), demandes.lire(DEPOT, j["id"]) if liste is None else liste)
    return {"bourse": inventaire.bourse_de(h), **engage, "disponible": inventaire.disponible(h, engage)}


def prealable_du_sac(j: dict, corps: dict, liste: list, don: str = "") -> dict:
    """Le geste s'applique-t-il à la fiche publiée ? Refusé ici sur ce que lit le joueur ; l'atelier revérifie toujours."""
    h = heros_publie(j)
    if not h:
        raise demandes.Refus(409, "Votre héros doit d'abord être à la tablée, accueilli par le MJ.")
    if don:
        if corps["ref"] not in {c["ref"] for c in compagnons(j)}:
            raise demandes.Refus(409, "Ce compagnon n'est pas dans la compagnie : la page se relit.")
        if don == "or":
            reste = or_du_joueur(j, h, liste)["disponible"]
            if corps["montant"] > reste:
                raise demandes.Refus(409, f"Vous avez {reste} po disponibles : le reste est déjà engagé, ou n'est pas dans la bourse.")
            return corps
    inventaire.verifier_sur_la_fiche(h, corps, corps.get("geste", "donner"))
    return corps


PREALABLES.update({"sac": prealable_du_sac, "don-objet": lambda j, c, l: prealable_du_sac(j, c, l, don="objet"),
                   "don-or": lambda j, c, l: prealable_du_sac(j, c, l, don="or")})


@app.get("/api/sac")
def lire_sac(requete: Request):
    """Le sac du héros de ce joueur, tel que l'atelier le publie (sa fiche « Mon héros » seulement), son or disponible et
    engagé, les compagnons à qui donner, et ses derniers gestes avec leur statut."""
    j = connecte(requete)
    if not carnet_ouvert():
        return {"ouvert": False}
    h = heros_publie(j)
    try:
        liste = demandes.lire(DEPOT, j["id"])
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)
    miens = [demandes.vue_joueur(d) for d in reversed(liste) if d["genre"] in inventaire.GENRES_DU_SAC]
    recents = [d for d in miens if d["retirable"]] + [d for d in miens if not d["retirable"]][:SAC_DEMANDES]
    sac = {k: [x for x in h.get(k) or [] if isinstance(x, str)] for k in inventaire.LISTES} if h else None
    return {"ouvert": True, "pause": demandes.en_pause(DEPOT),
            "heros": {"nom": str(h.get("nom") or ""), "genre": h.get("genre") if h.get("genre") in ("h", "f") else "", **sac} if h else None,
            "or": or_du_joueur(j, h, liste), "compagnons": compagnons(j) if h else [], "demandes": recents,
            "ligne_max": inventaire.LIGNE_MAX, "objets": inventaire.OBJETS}


# Le lore du héros (lore.py) : le joueur étoffe le récit de « Mon héros » depuis sa page « L'histoire de mon héros »
# (js/joueurs/histoire.js), à son rythme, puis l'envoie au MJ, qui tranche passage par passage dans sa boîte. Le brouillon
# (lore/<joueur>.json) n'est écrit que d'ici, sous son verrou, et ne se trouve que par la session du joueur. Le coin ne lit
# que la fiche publiée et la compagnie du carnet (le jeton de son héros) : jamais le texte d'un passage tenu par le MJ.
# Carnet fermé, la page le dit et rien ne s'écrit.

FICHIERS |= {"js/joueurs/histoire.js", "js/joueurs/histoire-aide.js", "js/joueurs/vers-histoire.js", "js/lore/ecart.js",
             "css/histoire-coin.css"}


def heros_et_ref(j: dict) -> tuple[dict | None, str | None]:
    """« Mon héros » publié, et le jeton de ce héros dans la compagnie (celui que l'atelier revérifie)."""
    h = heros_publie(j)
    moi = carnet.cle_heros(j.get("jeton", ""))
    ref = next((x["ref"] for x in section("compagnie") if x.get("cle") == moi and isinstance(x.get("ref"), str)
                and lore.REF.match(x["ref"])), None)
    return h, ref


def lore_ouvert(j: dict) -> tuple[dict, str]:
    if not carnet_ouvert():
        raise demandes.Refus(423, "Le carnet est fermé : votre MJ le rouvre entre les séances.")
    h, ref = heros_et_ref(j)
    if not h or not ref:
        raise demandes.Refus(409, "Votre héros doit d'abord être à la tablée, accueilli par le MJ.")
    return h, ref


def etat_lore(j: dict) -> dict:
    if not carnet_ouvert():
        return {"ouvert": False, "pause": demandes.en_pause(DEPOT)}
    h, ref = heros_et_ref(j)
    if not h or not ref:
        return {"ouvert": True, "pause": demandes.en_pause(DEPOT), "heros": None}
    return lore.vue(lore.lire_brouillon(DEPOT, j["id"]), h, ref, demandes.lire(DEPOT, j["id"]), demandes.en_pause(DEPOT))


def enregistrer_lore(j: dict, corps: dict) -> dict:
    corps = demandes.seulement(corps, {"champs", "bases", "effacer", "relus"}, "L'histoire")
    h, ref = lore_ouvert(j)
    with lore.verrou(DEPOT):
        b = lore.enregistrer(lore.lire_brouillon(DEPOT, j["id"]), h, ref, corps.get("champs", {}), corps.get("effacer", []),
                             corps.get("relus", []), maintenant(), corps.get("bases", {}))
        lore.ecrire_brouillon(DEPOT, j["id"], b)
    return etat_lore(j) | {"enregistre": b.get("modifie")}


def envoyer_lore(j: dict) -> dict:
    """« Envoyer au MJ » : le brouillon devient une demande en attente du MJ. Un envoi qui attend encore est remplacé
    (retiré par le joueur) ; le même envoi, refait, ne repart pas."""
    h, ref = lore_ouvert(j)
    with lore.verrou(DEPOT), demandes.verrou(DEPOT):
        liste = demandes.lire(DEPOT, j["id"])
        corps = lore.corps_envoi(lore.lire_brouillon(DEPOT, j["id"]), h, ref, liste)
        ouverts = lore.en_attente(liste)
        if ouverts and lore.meme_envoi(ouverts[-1], corps):
            return etat_lore(j) | {"deja": True}
        if plafond_horaire(j["id"], lore.GENRE):
            raise demandes.Refus(429, f"Pas plus de {demandes.PAR_HEURE} demandes par heure : réessayez un peu plus tard.")
        d = demandes.nouvelle({"genre": lore.GENRE, "corps": corps}, carnet_ouvert())
        for vieux in ouverts:
            demandes.passer(vieux, demandes.RETIREE, "joueur")
        # Le plafond horaire est celui de la mémoire du coin (plafond_horaire), pas celui des gestes du sac du fichier.
        demandes.ecrire(DEPOT, j["id"], demandes.borner([*liste, d]))
        DEMANDES_FAITES.setdefault(compte_horaire(j["id"], lore.GENRE)[0], []).append(time.monotonic())
    return etat_lore(j) | {"envoye": d["id"]}


def lore_par_la_file(j: dict, corps: dict, liste: list) -> dict:
    # Une histoire part de sa page (envoyer_lore), avec le texte que le joueur lisait : jamais écrite à la main dans la file.
    raise demandes.Refus(400, "Une histoire s'envoie depuis la page « L'histoire de mon héros ».")


PREALABLES[lore.GENRE] = lore_par_la_file


@app.get("/histoire")
def page_histoire(requete: Request):
    if not joueur_du_cookie(requete):
        return vers_connexion(requete)
    return page("histoire.html")


@app.get("/api/lore")
def lire_lore(requete: Request):
    j = connecte(requete)
    try:
        return etat_lore(j)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


@app.put("/api/lore")
async def ecrire_lore(requete: Request):
    j = connecte(requete)
    if int(requete.headers.get("content-length") or 0) > lore.ECRITURE_OCTETS_MAX:
        raise HTTPException(413, "Trop long d'un coup : enregistrez passage par passage.")
    corps = await objet(requete)
    if len(json.dumps(corps, ensure_ascii=False).encode()) > lore.ECRITURE_OCTETS_MAX:
        raise HTTPException(413, "Trop long d'un coup : enregistrez passage par passage.")
    try:
        return await asyncio.to_thread(enregistrer_lore, j, corps)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


@app.post("/api/lore/envoyer")
async def envoyer_lore_au_mj(requete: Request):
    j = connecte(requete)
    await objet(requete)
    try:
        return await asyncio.to_thread(envoyer_lore, j)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


# L'aide à l'écriture (aide.py, lot C3) : « Proposer » et « Relire » sous chaque passage de l'histoire du héros. Le coin ne
# fait que mettre la demande en file (une à la fois par joueur, au quota du mois que l'atelier publie dans aide/etat.json)
# et relire la réponse que l'atelier y écrit : il ne parle jamais à l'API. Le joueur ne lit que sa propre file (sa
# session) ; une aide en route se retire comme toute demande (DELETE /api/demandes/{id}).
from commun import aide  # noqa: E402

FICHIERS |= {"css/aide-coin.css"}
# Les aides demandées dans l'heure, par joueur, en mémoire : retirer puis redemander ne passe pas le plafond.
AIDES_FAITES: dict[str, list[float]] = {}


def etat_aide(j: dict) -> dict:
    if not carnet_ouvert():
        return {"ouvert": False, "pause": demandes.en_pause(DEPOT), "disponible": False}
    return aide.vue(demandes.lire(DEPOT, j["id"]), aide.lire_etat(DEPOT), j["id"], demandes.en_pause(DEPOT))


def demander_aide(j: dict, corps: dict) -> dict:
    lore_ouvert(j)  # carnet ouvert, héros à la tablée
    d = demandes.nouvelle({"genre": aide.GENRE, "corps": corps}, carnet_ouvert())
    etat = aide.lire_etat(DEPOT)
    instant = time.monotonic()
    with demandes.verrou(DEPOT):
        liste = demandes.lire(DEPOT, j["id"])
        aide.peut_demander(etat, j["id"], liste)
        faites = [t for t in AIDES_FAITES.get(j["id"], []) if instant - t < 3600]
        if len(faites) >= aide.PAR_HEURE:
            raise demandes.Refus(429, aide.TROP_SOUVENT)
        demandes.ecrire(DEPOT, j["id"], demandes.borner([*aide.garder(liste), d]))
        AIDES_FAITES[j["id"]] = [*faites, instant]
    return etat_aide(j)


def aide_par_la_file(j: dict, corps: dict, liste: list) -> dict:
    raise demandes.Refus(400, aide.PAR_LA_PAGE)


PREALABLES[aide.GENRE] = aide_par_la_file


@app.get("/api/aide")
def lire_aide(requete: Request):
    j = connecte(requete)
    try:
        return etat_aide(j)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


@app.post("/api/aide")
async def demander_une_aide(requete: Request):
    j = connecte(requete)
    if int(requete.headers.get("content-length") or 0) > aide.CORPS_OCTETS_MAX:
        raise HTTPException(413, "Ce passage est trop long pour une aide.")
    corps = await objet(requete)
    if len(json.dumps(corps, ensure_ascii=False).encode()) > aide.CORPS_OCTETS_MAX:
        raise HTTPException(413, "Ce passage est trop long pour une aide.")
    try:
        return await asyncio.to_thread(demander_aide, j, corps)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


# « Pour le MJ seulement » (confie.py, lot C4), au bas de la page de l'histoire : ce que le joueur confie à son MJ seul.
# Le brouillon et le dernier envoi sont dans confie/<joueur>.json, que seule la session du joueur trouve ; « Envoyer au
# MJ » écrit une demande que l'atelier applique seule (le texte va sur la fiche, la file n'en garde que la longueur). Le
# coin ne lit de l'atelier que le reçu (confie-lu/<joueur>.json : lu ou non), jamais un texte. Aucune aide à l'écriture
# ici. Mêmes conditions que l'histoire : carnet ouvert, héros à la tablée.
from commun import confie  # noqa: E402

FICHIERS |= {"js/joueurs/histoire-confie.js", "css/confie-coin.css"}


def etat_confie(j: dict) -> dict:
    if not carnet_ouvert():
        return {"ouvert": False, "pause": demandes.en_pause(DEPOT)}
    _, ref = heros_et_ref(j)
    if not ref:
        return {"ouvert": True, "pause": demandes.en_pause(DEPOT), "heros": None}
    return confie.vue(confie.lire(DEPOT, j["id"]), ref, demandes.lire(DEPOT, j["id"]), confie.lire_recu(DEPOT, j["id"]),
                      demandes.en_pause(DEPOT))


def enregistrer_confie(j: dict, corps: dict) -> dict:
    corps = demandes.seulement(corps, {"texte", "effacer"}, "Pour le MJ seulement")
    _, ref = lore_ouvert(j)
    with confie.verrou(DEPOT):
        f = confie.lire(DEPOT, j["id"])
        f = (confie.effacer_brouillon(f, ref, maintenant()) if corps.get("effacer") is True
             else confie.enregistrer(f, ref, corps.get("texte"), maintenant()))
        confie.ecrire(DEPOT, j["id"], f)
    return etat_confie(j) | {"enregistre": f.get("modifie")}


def envoyer_confie(j: dict, corps: dict) -> dict:
    """« Envoyer au MJ » : le texte de la page (jamais celui d'un autre, jamais un autre héros que le sien) devient une
    demande appliquée seule ; le même texte, déjà en route ou déposé, ne repart pas."""
    corps = demandes.seulement(corps, {"texte"}, "Pour le MJ seulement")
    _, ref = lore_ouvert(j)
    with confie.verrou(DEPOT), demandes.verrou(DEPOT):
        liste = demandes.lire(DEPOT, j["id"])
        d = demandes.nouvelle({"genre": confie.GENRE, "corps": {"ref": ref, "passage": corps.get("texte", "")}}, carnet_ouvert())
        f = confie.courant(confie.lire(DEPOT, j["id"]), ref)
        if f["envoye"] and f["envoye"]["texte"] == d["corps"]["passage"]:
            etat, _, _ = confie.etat_envoi(f["envoye"], liste, confie.lire_recu(DEPOT, j["id"]))
            if etat in ("depose", "en-route", "envoye"):
                confie.ecrire(DEPOT, j["id"], confie.effacer_brouillon(f, ref, maintenant()))
                return etat_confie(j) | {"deja": True}
        if plafond_horaire(j["id"], confie.GENRE):
            raise demandes.Refus(429, f"Pas plus de {demandes.PAR_HEURE} demandes par heure : réessayez un peu plus tard.")
        demandes.ecrire(DEPOT, j["id"], demandes.borner([*liste, d]))
        confie.ecrire(DEPOT, j["id"], confie.apres_envoi(f, ref, d))
        DEMANDES_FAITES.setdefault(compte_horaire(j["id"], confie.GENRE)[0], []).append(time.monotonic())
    return etat_confie(j) | {"envoye_id": d["id"]}


def confie_par_la_file(j: dict, corps: dict, liste: list) -> dict:
    # Il part de sa page (envoyer_confie), avec le héros du joueur : jamais écrit à la main dans la file.
    raise demandes.Refus(400, confie.PAR_LA_PAGE)


PREALABLES[confie.GENRE] = confie_par_la_file


async def corps_confie(requete: Request) -> dict:
    if int(requete.headers.get("content-length") or 0) > confie.ECRITURE_OCTETS_MAX:
        raise HTTPException(413, f"Ce passage est trop long : {confie.LONG} signes au plus.")
    corps = await objet(requete)
    if len(json.dumps(corps, ensure_ascii=False).encode()) > confie.ECRITURE_OCTETS_MAX:
        raise HTTPException(413, f"Ce passage est trop long : {confie.LONG} signes au plus.")
    return corps


@app.get("/api/confie")
def lire_confie(requete: Request):
    j = connecte(requete)
    try:
        return etat_confie(j)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


@app.put("/api/confie")
async def ecrire_confie(requete: Request):
    j = connecte(requete)
    corps = await corps_confie(requete)
    try:
        return await asyncio.to_thread(enregistrer_confie, j, corps)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


@app.post("/api/confie/envoyer")
async def envoyer_confie_au_mj(requete: Request):
    j = connecte(requete)
    corps = await corps_confie(requete)
    try:
        return await asyncio.to_thread(envoyer_confie, j, corps)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


# Bouger son pion (lot E2, deplacement.py) : le joueur touche son pion sur la table, puis une case. Le coin prévalide sur ce
# qu'il a publié pour ce joueur (le plan de la TV, son pion, son tour, le réglage du MJ), puis écrit une demande
# « deplacement », appliquée seule (pions libres) ou laissée au MJ (à valider) ; l'atelier revérifie tout sur le plan du
# moment. Un déplacement à la fois : une nouvelle case remplace celle qui attend encore le MJ.

FICHIERS |= {"js/plan/deplacement.js", "js/joueurs/bouger.js", "css/bouger-coin.css"}
DEPLACEMENTS_PAR_HEURE = 600  # une partie animée, à part du plafond des autres demandes
DEPLACEMENTS_GARDES = 6  # déplacements clos gardés dans le fichier du joueur : ils ne chassent pas ses autres demandes
EN_ROUTE_MAX = 10  # secondes : un déplacement que l'atelier n'a toujours pas posé ne bloque plus le suivant
DEPLACEMENTS_FAITS: dict[str, list[float]] = {}


def depuis_quand(d: dict) -> float:
    try:
        return (datetime.now() - datetime.fromisoformat(d.get("cree") or "")).total_seconds()
    except (TypeError, ValueError):
        return 0.0


def deplacer_ici(j: dict, d: dict) -> dict:
    vue = table_joueurs.vue_publiee(DEPOT)
    if vue is None:
        raise demandes.Refus(423, deplacement.TABLE_FERMEE)
    plan = vue.get("plan") if vue.get("genre") == "plan" else None
    if not isinstance(plan, dict) or plan.get("id") != d["corps"]["plan"]:
        raise demandes.Refus(409, deplacement.PLUS_LA)
    pion = table_joueurs.pion_publie(DEPOT, carnet.cle_heros(j.get("jeton", "")), vue)
    # Son héros, ou l'un de ses familiers (19/11), qui a sa propre case de début de tour.
    familier = next((f for f in pion["familiers"] if f["id"] == d["corps"]["pion"]), None)
    if familier is not None:
        pion = {**pion, "debut": familier["debut"]}
    elif pion["pion"] is None or pion["pion"] != d["corps"]["pion"]:
        raise demandes.Refus(409, deplacement.PAS_SUR_LE_PLAN)
    # Le réglage publié, champ par champ (un champ abîmé reprend sa valeur par défaut) ; « ouverte » : la vue l'est.
    regles = table_joueurs.reglage({**(vue.get("regles") if isinstance(vue.get("regles"), dict) else {}), "ouverte": True})
    deplacement.verifier(plan, d["corps"], regles, pion)
    instant = time.monotonic()
    with demandes.verrou(DEPOT):
        faits = [t for t in DEPLACEMENTS_FAITS.get(j["id"], []) if instant - t < 3600]
        DEPLACEMENTS_FAITS[j["id"]] = faits
        if len(faits) >= DEPLACEMENTS_PAR_HEURE:
            raise demandes.Refus(429, "Beaucoup de déplacements cette heure-ci : demandez à votre MJ de bouger votre pion.")
        deja = demandes.lire(DEPOT, j["id"])
        for x in deja:
            if x["genre"] != deplacement.GENRE or x["statut"] not in demandes.OUVERTS:
                continue
            if x["statut"] == demandes.A_APPLIQUER and depuis_quand(x) < EN_ROUTE_MAX:
                raise demandes.Refus(409, "Votre pion est déjà en route : un instant.")
            demandes.passer(x, demandes.RETIREE, "joueur")
        clos = [x for x in deja if x["genre"] == deplacement.GENRE and x["statut"] not in demandes.OUVERTS]
        partis = {id(x) for x in clos[:-DEPLACEMENTS_GARDES]} if len(clos) > DEPLACEMENTS_GARDES else set()
        d["statut"] = demandes.EN_ATTENTE if regles["pions"] == "a-valider" else demandes.A_APPLIQUER
        liste = demandes.borner([*(x for x in deja if id(x) not in partis), d])
        demandes.ecrire(DEPOT, j["id"], liste)
        faits.append(instant)
    return d


@app.get("/sante")
def sante():
    return Response("ok", media_type="text/plain")


# Le sanctuaire (cagnottes.py, lot B2) : le village de la compagnie tel que l'atelier le publie dans le carnet (section
# « sanctuaire », seulement quand le MJ l'a rendu visible), où le joueur verse de l'or dans une cagnotte et propose un
# projet, par la file des demandes ; le MJ accepte ou refuse. Bâtiments et projets n'y sont que des jetons publiés. Carnet
# fermé, le sanctuaire l'est aussi.
FICHIERS |= {"js/joueurs/sanctuaire-coin.js", "js/joueurs/sanctuaire-vue.js", "js/sanctuaire/dessin.js", "css/sanctuaire-coin.css"}
SANCTUAIRE_DEMANDES = 8  # les dernières demandes traitées que la section rappelle


def prealable_du_sanctuaire(j: dict, corps: dict, liste: list, genre: str) -> dict:
    """Le versement ou le projet tient-il sur ce que lit le joueur (la section publiée, son or disponible) ? L'atelier
    revérifie tout à l'acceptation."""
    elements = section(cagnottes.SECTION)
    if genre == "projet":
        cagnottes.verifier_projet(corps, elements, liste)
        return corps
    h = heros_publie(j)
    if not h:
        raise demandes.Refus(409, "Votre héros doit d'abord être à la tablée, accueilli par le MJ.")
    cagnottes.verifier_versement(corps, elements, or_du_joueur(j, h, liste)["disponible"])
    return corps


PREALABLES.update({g: (lambda j, c, l, g=g: prealable_du_sanctuaire(j, c, l, g)) for g in cagnottes.GENRES_DU_SANCTUAIRE})


@app.get("/api/sanctuaire")
def lire_sanctuaire(requete: Request):
    """La section du sanctuaire telle que l'atelier la publie, l'or disponible et engagé du héros de ce joueur, et ses
    versements et projets avec leur statut."""
    j = connecte(requete)
    if not carnet_ouvert():
        return {"ouvert": False}
    elements = section(cagnottes.SECTION)
    if not cagnottes.lire_section(elements)["village"]:
        return {"ouvert": True, "visible": False}
    h = heros_publie(j)
    try:
        liste = demandes.lire(DEPOT, j["id"])
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)
    miens = [demandes.vue_joueur(d) for d in reversed(liste) if d["genre"] in cagnottes.GENRES_DU_SANCTUAIRE]
    recents = [d for d in miens if d["retirable"]] + [d for d in miens if not d["retirable"]][:SANCTUAIRE_DEMANDES]
    return {"ouvert": True, "visible": True, "pause": demandes.en_pause(DEPOT), "elements": elements,
            "heros": {"nom": str(h.get("nom") or ""), "genre": h.get("genre") if h.get("genre") in ("h", "f") else ""} if h else None,
            "or": or_du_joueur(j, h, liste), "demandes": recents, "mot_max": cagnottes.MOT_MAX}


# Les activités entre les séances (activites.py, lot D) : le catalogue tel que l'atelier le publie dans le carnet (section
# « activites », seulement quand le MJ les a ouvertes), où le joueur choisit l'activité de son héros pour la période, par
# la file des demandes. Le coin n'envoie que le jeton de l'activité : le dé se jette dans l'atelier, sur sa fiche ; le coin
# ne calcule les chances que pour les dire. Une par héros et par période ; carnet fermé, fermées aussi.
FICHIERS |= {"js/joueurs/activites-coin.js", "js/joueurs/activites-vue.js", "css/activites-coin.css"}
ACTIVITES_PASSEES = 8  # les dernières activités tranchées que la section rappelle


def prealable_des_activites(j: dict, corps: dict, liste: list) -> dict:
    """L'activité tient-elle sur ce que lit le joueur (la section publiée, ses demandes) ? L'atelier revérifie tout au
    moment de jeter le dé."""
    if not heros_publie(j):
        raise demandes.Refus(409, "Votre héros doit d'abord être à la tablée, accueilli par le MJ.")
    activites.verifier(corps, section(activites.SECTION), liste)
    return corps


PREALABLES[activites.GENRE] = prealable_des_activites


def chances_du_heros(h: dict, a: dict) -> dict | None:
    """Ce que le joueur lit de ses chances : la valeur visée sur sa fiche publiée, faite de quoi, son carton compris (les
    cartons de « Mon héros », ceux que l'atelier compte en jetant le dé). Rien n'en part."""
    try:
        v = jets.visee(h, a.get("carac"), a.get("competences") or [], a.get("modificateur") or 0,
                       jets_distance.ajustements(h, a.get("carac")))
    except ValueError:
        return None
    return {k: v[k] for k in ("carac_nom", "base", "competence", "bonus", "modificateur", "ajustements", "visee")} | {"chances": jets.chances(v["visee"])}


@app.get("/api/activites")
def lire_activites(requete: Request):
    """La section des activités telle que l'atelier la publie, les chances du héros de ce joueur pour chacune, son activité
    de la période (son jet, le récit, l'or quand le MJ l'a validé) et ses dernières activités tranchées."""
    j = connecte(requete)
    if not carnet_ouvert():
        return {"ouvert": False}
    s = activites.lire_section(section(activites.SECTION))
    if not s["periode"]:
        return {"ouvert": True, "visible": False}
    h = heros_publie(j)
    try:
        liste = demandes.lire(DEPOT, j["id"])
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)
    cle = s["periode"]["cle"]
    miennes = [d for d in reversed(liste) if d["genre"] == activites.GENRE]
    courantes = [d for d in miennes if activites.compte(d, cle)]
    faites = {(d.get("corps") or {}).get("activite") for d in courantes}
    passees = [demandes.vue_joueur(d) for d in miennes if d not in courantes and d["statut"] in (demandes.ACCEPTEE, demandes.REFUSEE)]
    echec = next((d for d in miennes if d["statut"] == demandes.ECHEC), None)
    return {"ouvert": True, "visible": True, "pause": demandes.en_pause(DEPOT), "periode": s["periode"],
            "activites": [a | ({"chances": c} if h and (c := chances_du_heros(h, a)) else {}) | {"faite": a["id"] in faites} for a in s["activites"]],
            "heros": {"nom": str(h.get("nom") or ""), "genre": h.get("genre") if h.get("genre") in ("h", "f") else ""} if h else None,
            "courantes": [demandes.vue_joueur(d) for d in courantes],
            "echec": demandes.vue_joueur(echec) if echec and echec is miennes[0] else None,
            "passees": passees[:ACTIVITES_PASSEES], "mot_max": activites.MOT_MAX}


# Les billets privés (prives.py, lot F2) : ce que le MJ a fait parvenir au seul joueur connecté, un billet secret ou un
# document, publié par l'atelier sous la clé de son lien (comme « Mon héros ») : le fichier se trouve par sa session,
# jamais par la requête, et une image ne sort que si l'un de ses billets la cite. Le coin note seul la lecture, dans le
# fichier de ce joueur (prives-lus/), que l'atelier guette pour dire au MJ « lu à 21 h 04 ».
# Carnet fermé, les billets passent quand même : ils servent pendant la séance, quand le carnet l'est souvent. En pause,
# on les lit et la lecture se note encore : elle ne change rien au jeu, et le MJ qui fige le coin veut savoir qui a lu.
from commun import prives  # noqa: E402

FICHIERS |= {"js/joueurs/prives.js", "css/prives-coin.css"}
LIBRES_EN_PAUSE = (*LIBRES_EN_PAUSE, "/api/prives/")
FLUX.joueurs_des_cles = lambda: {carnet.cle_heros(j["jeton"]): j["id"] for j in acces()
                                 if isinstance(j, dict) and isinstance(j.get("jeton"), str) and isinstance(j.get("id"), str)}


def billets_du_joueur(j: dict) -> list:
    return prives.lire(DEPOT, carnet.cle_heros(j.get("jeton", "")))


@app.get("/api/prives")
def lire_prives(requete: Request):
    j = connecte(requete)
    try:
        lus = prives.lire_lus(DEPOT, j["id"])
    except ValueError:
        raise HTTPException(403, "Accès invalide")
    return {"billets": prives.vue_coin(billets_du_joueur(j), lus), "pause": demandes.en_pause(DEPOT)}


@app.post("/api/prives/{ident}/lu")
async def noter_lecture(ident: str, requete: Request):
    j = connecte(requete)
    connus = {b["id"] for b in billets_du_joueur(j)}
    try:
        quand = await asyncio.to_thread(prives.noter_lu, DEPOT, j["id"], ident, connus)
    except KeyError:
        raise HTTPException(404, "Ce billet n'est plus là : votre MJ l'a repris.")
    except ValueError:
        raise HTTPException(403, "Accès invalide")
    return {"id": ident, "lu": quand}


@app.get("/prives/media/{nom}")
def media_prive(nom: str, requete: Request):
    j = connecte(requete)
    chemin = prives.media_du_joueur(DEPOT, carnet.cle_heros(j.get("jeton", "")), nom)
    if chemin is None:
        raise HTTPException(404, "Introuvable")
    return FileResponse(chemin, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


# Les jets à distance (jets_distance.py, lot F3) : « Lancer un test », sur la page Table et dans le carnet
# (js/joueurs/jets-coin.js). Le joueur choisit la caractéristique, la compétence qui aide et un modificateur ; l'atelier jette
# le dé sur sa fiche et écrit le résultat dans la demande, que la page relit au sujet « demandes » du flux. La fiche de jet
# (jets/<clé>.json) se trouve par la clé du lien du joueur, jamais par la requête. Table du coin fermée, rien ne se lance ; en
# pause, rien non plus (PauseDuCoin). Un jet à la fois, et PAR_HEURE par heure (les tests que demande le MJ n'y comptent pas).
FICHIERS |= {"js/joueurs/jets-coin.js", "css/jets-coin.css"}
# Lot G : les dés libres et les dégâts des armes (genre « des »), le dé d'aventure ; la lecture des dés, jumelle de des.py.
FICHIERS |= {"js/jets/des.js"}
JETS_LANCES: dict[str, list[float]] = {}


def prealable_des_jets(_j: dict, _corps: dict, _liste: list) -> dict:
    """Un test ne passe pas par « Un mot au MJ » ni par la route commune : il a la sienne (un à la fois, son plafond)."""
    raise demandes.Refus(409, "Un test se lance par « Lancer un test ».")


PREALABLES[jets_distance.GENRE] = prealable_des_jets
PREALABLES[jets_distance.GENRE_DES] = prealable_des_jets
PREALABLES[jets_distance.GENRE_FACE] = prealable_des_jets


def table_du_coin_ouverte() -> bool:
    return table_joueurs.vue_publiee(DEPOT) is not None


def fiche_de_jet(j: dict) -> dict | None:
    return jets_distance.fiche_publiee(DEPOT, carnet.cle_heros(j.get("jeton", ""))) if table_du_coin_ouverte() else None


def vue_fiche_de_jet(f: dict) -> dict:
    """Ce que la page propose : chaque caractéristique avec sa valeur, son carton et ce qu'il retire (compté par l'atelier
    comme ici) ; les compétences qui aident ; la posture du héros et les seuils des critiques qu'elle donne (élargis en
    posture offensive : 01 à 10, 91 à 100)."""
    caracs = []
    for cle, nom in jets.CARACS.items():
        comptes = jets_distance.ajustements(f, cle)
        caracs.append({"cle": cle, "nom": nom, "valeur": f[cle], "carton": f["cartons"].get(cle), "ajustement": sum(v for _, v in comptes),
                       "ajustements": [{"libelle": x, "valeur": v} for x, v in comptes]})
    # Lot G : les armes (nom et dégâts), le jeton d'avantage hors combat, les réserves de dés d'aventure et le dé de
    # mésaventure annoncé, tels que l'atelier les a publiés.
    return {"nom": f["nom"], "caracs": caracs, "competences": f["competences"], "avantage": jets_distance.AVANTAGE,
            "posture": f["posture"], "critiques": jets_distance.critiques(f["posture"]),
            **{k: f[k] for k in ("armes", "jeton", "combat", "reserve", "mesaventure")}}


def jets_du_joueur(j: dict) -> dict:
    ouverte = table_du_coin_ouverte()
    f = fiche_de_jet(j) if ouverte else None
    return {"ouvert": ouverte, "pause": demandes.en_pause(DEPOT), "heros": vue_fiche_de_jet(f) if f else None,
            **jets_distance.etat(demandes.lire(DEPOT, j["id"])), "par_heure": jets_distance.PAR_HEURE,
            "modificateur_max": jets_distance.MODIFICATEUR_MAX}


def lancer_ici(j: dict, corps: dict) -> dict:
    if not table_du_coin_ouverte():
        raise demandes.Refus(409, jets_distance.FERMEE)
    if not fiche_de_jet(j):
        raise demandes.Refus(409, jets_distance.ABSENT)
    corps = {k: corps[k] for k in ("carac", "competence", "modificateur", "demande", "aventure", "mesaventure", "avantage", "choix", "des", "arme") if k in corps}
    demande = corps.get("demande") is not None
    instant = time.monotonic()
    faits = [t for t in JETS_LANCES.get(j["id"], []) if instant - t < 3600]
    JETS_LANCES[j["id"]] = faits
    if not demande and len(faits) >= jets_distance.PAR_HEURE:
        raise demandes.Refus(429, f"Pas plus de {jets_distance.PAR_HEURE} tests par heure : demandez à votre MJ de vive voix.")
    d = jets_distance.lancer(DEPOT, j["id"], corps)
    if not demande:
        faits.append(instant)
    return d


@app.get("/api/jets")
def lire_jets(requete: Request):
    j = connecte(requete)
    try:
        return jets_du_joueur(j)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


@app.post("/api/jets")
async def lancer_un_test(requete: Request):
    j = connecte(requete)
    if int(requete.headers.get("content-length") or 0) > demandes.CORPS_OCTETS_MAX:
        raise HTTPException(413, "Demande trop longue")
    corps = await objet(requete)
    try:
        d = await asyncio.to_thread(lancer_ici, j, corps)
        return {"lance": d["id"]} | await asyncio.to_thread(jets_du_joueur, j)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


def changer_la_face(j: dict, corps: dict) -> dict:
    if not table_du_coin_ouverte():
        raise demandes.Refus(409, jets_distance.FERMEE)
    f = fiche_de_jet(j)
    if not f:
        raise demandes.Refus(409, jets_distance.ABSENT)
    return jets_distance.changer_face(DEPOT, j["id"], corps, f["jeton"])


@app.post("/api/jets/face")
async def changer_la_face_d_un_de(requete: Request):
    """« Mon avantage : changer l'effet » : après le lancer, le dé d'aventure ou de mésaventure de son dernier test
    prend la face que le joueur choisit ; son jeton d'avantage s'en va quand l'atelier l'applique."""
    j = connecte(requete)
    if int(requete.headers.get("content-length") or 0) > demandes.CORPS_OCTETS_MAX:
        raise HTTPException(413, "Demande trop longue")
    corps = await objet(requete)
    try:
        d = await asyncio.to_thread(changer_la_face, j, corps)
        return {"change": d["id"]} | await asyncio.to_thread(jets_du_joueur, j)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


# L'état de son héros réglé par le joueur (etat_joueur.py, 11/11), sur la page Table (js/joueurs/etat-coin.js) : sa Santé,
# sa Psy et sa posture, pendant la partie. Il n'envoie qu'un écart ou une posture ; l'atelier l'applique seul, en combat
# comme hors combat, et écrit ce que la page relit au sujet « demandes » du flux. Ce qu'elle montre vient de la fiche de jet
# publiée (trouvée par la clé du lien du joueur). Table du coin fermée, rien ne part.
from commun import etat_joueur  # noqa: E402

FICHIERS |= {"js/joueurs/etat-coin.js", "css/etat-coin.css"}
ETATS_REGLES: dict[str, list[float]] = {}


def prealable_de_l_etat(_j: dict, _corps: dict, _liste: list) -> dict:
    raise demandes.Refus(409, "L'état de votre héros se règle sur la page Table.")


PREALABLES[etat_joueur.GENRE] = prealable_de_l_etat


def etat_du_heros(j: dict) -> dict:
    ouverte = table_du_coin_ouverte()
    f = fiche_de_jet(j) if ouverte else None
    heros = None
    if f and f.get("vitalite"):
        heros = {"nom": f["nom"], "vitalite": f["vitalite"], "posture": f["posture"], "jeton": f["jeton"], "combat": f["combat"]}
    return {"ouvert": ouverte, "pause": demandes.en_pause(DEPOT), "heros": heros, "postures": etat_joueur.POSTURES,
            "delta_max": etat_joueur.DELTA_MAX, **etat_joueur.etat(demandes.lire(DEPOT, j["id"]))}


def regler_ici(j: dict, corps: dict) -> dict:
    if not table_du_coin_ouverte():
        raise demandes.Refus(409, etat_joueur.FERMEE)
    if not fiche_de_jet(j):
        raise demandes.Refus(409, etat_joueur.ABSENT)
    instant = time.monotonic()
    faits = [t for t in ETATS_REGLES.get(j["id"], []) if instant - t < 3600]
    ETATS_REGLES[j["id"]] = faits
    if len(faits) >= etat_joueur.PAR_HEURE:
        raise demandes.Refus(429, "Beaucoup de changements en peu de temps : dites-le à votre MJ de vive voix.")
    d = etat_joueur.deposer(DEPOT, j["id"], corps)
    faits.append(instant)
    return d


@app.get("/api/etat-heros")
def lire_l_etat_du_heros(requete: Request):
    j = connecte(requete)
    try:
        return etat_du_heros(j)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


@app.post("/api/etat-heros")
async def regler_son_heros(requete: Request):
    j = connecte(requete)
    if int(requete.headers.get("content-length") or 0) > demandes.CORPS_OCTETS_MAX:
        raise HTTPException(413, "Demande trop longue")
    corps = await objet(requete)
    try:
        d = await asyncio.to_thread(regler_ici, j, corps)
        return {"regle": d["id"]} | await asyncio.to_thread(etat_du_heros, j)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


# Les pointeurs de la table (pointeurs.py, lot du 13/11), sur la page Table : le pointeur et la règle du MJ en lecture seule
# (GET, relu quand le flux dit « pointeur »), et le pointeur du joueur vers le MJ (POST, DELETE) : « Montrer au MJ », un doigt
# posé sur le plan ou la carte que montre la TV, à la couleur de son héros chez le MJ. Le joueur ne pointe que sous sa
# session ; le plan ou la carte visé est celui de la vue publiée, jamais un jeton venu de la requête ; une position hors du
# plan est refusée. Rien ne se garde : un pointeur sans nouvelle s'éteint au bout de dix secondes.
FICHIERS |= {"js/joueurs/pointeurs-coin.js", "css/pointeurs-coin.css"}
POINTEURS_PAR_SECONDE = 8
POINTEURS_RESERVES: dict[str, list[float]] = {}  # joueur : [jetons restants, instant de la dernière lecture]


def pointeur_permis(joueur: str) -> bool:
    """Au plus POINTEURS_PAR_SECONDE positions par seconde et par joueur (une réserve de dix, qui se refait)."""
    instant = time.monotonic()
    reste, avant = POINTEURS_RESERVES.get(joueur, [10.0, instant])
    reste = min(10.0, reste + (instant - avant) * POINTEURS_PAR_SECONDE)
    POINTEURS_RESERVES[joueur] = [reste - 1 if reste >= 1 else reste, instant]
    return reste >= 1


@app.get("/api/pointeurs")
def lire_les_pointeurs(requete: Request):
    connecte(requete)
    if table_joueurs.vue_publiee(DEPOT) is None:
        return {"point": None, "regle": None}
    return pointeurs.lire_mj(DEPOT)


def poser_ici(j: dict, corps: dict) -> dict:
    vue = table_joueurs.vue_publiee(DEPOT)
    cible = pointeurs.jeton_de_la_vue(vue)
    if cible is None:
        raise demandes.Refus(409, "La TV ne montre ni plan ni carte : rien à désigner.")
    genre, jeton = cible
    x, y = corps.get("x"), corps.get("y")
    if genre == "plan":
        plan = vue.get("plan") or {}
        largeur, hauteur = plan.get("largeur"), plan.get("hauteur")
        if isinstance(largeur, (int, float)) and isinstance(hauteur, (int, float)) and pointeurs.nombre(x) is not None and pointeurs.nombre(y) is not None \
                and not (-1 <= x <= largeur + 1 and -1 <= y <= hauteur + 1):
            raise demandes.Refus(400, "Ce point est hors du plan.")
    if pointeurs.poser_joueur(DEPOT, j["id"], genre, jeton, x, y, corps.get("onde") is True) is None:
        raise demandes.Refus(400, "Position illisible.")
    return {"ok": True}


@app.post("/api/pointeurs")
async def pointer_vers_le_mj(requete: Request):
    j = connecte(requete)
    if int(requete.headers.get("content-length") or 0) > 512:
        raise HTTPException(413, "Demande trop longue")
    corps = await objet(requete)
    if not pointeur_permis(j["id"]):
        raise HTTPException(429, "Trop de positions à la fois.")
    if not table_du_coin_ouverte():
        raise HTTPException(409, "La table n'est pas ouverte.")
    try:
        return await asyncio.to_thread(poser_ici, j, corps)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


@app.delete("/api/pointeurs")
async def retirer_son_pointeur(requete: Request):
    j = connecte(requete)
    await asyncio.to_thread(pointeurs.retirer_joueur, DEPOT, j["id"])
    return {"ok": True}


# Les portraits des joueurs (portraits.py, lot P) : le joueur voit le portrait de son héros, carnet ouvert ou fermé (l'onglet
# « Héros », « Mon héros » du carnet, sa ligne sur la page Table), en choisit un autre parmi ceux de ce héros (une demande
# « portrait-choisi », appliquée seule, annulable par le MJ) ou envoie sa propre image (« portrait », en attente du MJ).
# Tout se trouve par sa session : son index sous la clé de son lien, ses images envoyées sous son identifiant. Une image
# envoyée est vérifiée et réécrite ici (preparer_image) avant d'être écrite, sous les verrous, puis de nouveau dans l'atelier.
from commun import portraits  # noqa: E402

FICHIERS |= {"js/joueurs/portrait-coin.js", "js/joueurs/heros-coin.js", "css/portrait-coin.css"}
ROUTE_ENVOI = "/api/portraits/envoi"
ENVOIS_BRUTS[ROUTE_ENVOI] = portraits.OCTETS_MAX
CHOIX_EN_ROUTE = 10  # secondes : un choix que l'atelier n'a pas encore appliqué retient le suivant
ENVOIS_ESSAYES: dict[str, list[float]] = {}  # les envois d'image de chaque joueur, réussis ou non (portraits.ESSAIS_PAR_JOUEUR)


def heros_a_la_tablee(j: dict) -> dict | None:
    """Le héros de ce joueur s'il est à la tablée ({nom, genre}, ou {} tant que l'atelier ne l'a pas encore publié) ;
    None sinon (jamais accueilli, mis de côté, à la corbeille)."""
    p = lire_proposition(j)
    if not accueilli(j, p):
        return None
    place = place_a_la_tablee(j, p)
    return None if place is False else (place or {})


def page_du_heros(j: dict) -> str:
    return "heros.html" if heros_a_la_tablee(j) is not None else "index.html"


def cle_du_joueur(j: dict) -> str:
    return carnet.cle_heros(j.get("jeton", ""))


def image_gardee(j: dict, d: dict, gardes: set) -> str | None:
    envoi = (d.get("corps") or {}).get("envoi")
    if envoi not in gardes:
        return None
    chemin = portraits.chemin_envoi(DEPOT, j["id"], envoi)
    return f"/portraits/envoi/{envoi}.jpg" if chemin and chemin.is_file() else None


def etat_portraits(j: dict) -> dict:
    """Ce que lit la page : le héros, ses portraits (le sien marqué), ses images envoyées avec leur statut, ses choix en
    route. Rien ne nomme un fichier de l'atelier."""
    place = heros_a_la_tablee(j)
    if place is None:
        return {"heros": None, "pause": demandes.en_pause(DEPOT)}
    index = portraits.lire_index(DEPOT, cle_du_joueur(j))
    liste = demandes.lire(DEPOT, j["id"])
    gardes = portraits.envois_gardes(liste)
    envois = [demandes.vue_joueur(d) | {"image": image_gardee(j, d, gardes)}
              for d in reversed(liste) if d["genre"] == portraits.GENRE_ENVOI and d["statut"] != demandes.RETIREE][:8]
    choix = [demandes.vue_joueur(d) for d in reversed(liste) if d["genre"] == portraits.GENRE_CHOIX][:3]
    vus = (index or {}).get("portraits", [])
    return {"heros": {"nom": str(place.get("nom") or ""), "genre": place.get("genre") if place.get("genre") in ("h", "f") else ""},
            "publie": index is not None, "actuel": f"/portraits/media/{index['actuel']}" if index and index["actuel"] else None,
            "portraits": [p | {"url": f"/portraits/media/{p['nom']}", "actuel": p["nom"] == (index or {}).get("actuel")} for p in vus],
            "envois": envois, "choix": choix, "pause": demandes.en_pause(DEPOT), "attente_max": portraits.EN_ATTENTE_MAX,
            "en_attente": len(portraits.en_attente(liste)), "octets_max": portraits.OCTETS_MAX}


def prealable_du_choix(j: dict, corps: dict, liste: list) -> dict:
    """Le portrait choisi est-il l'un de ceux de son héros, publiés pour lui ? L'atelier le retrouve de nouveau parmi les
    illustrations de ce héros avant de l'appliquer."""
    if heros_a_la_tablee(j) is None:
        raise demandes.Refus(409, "Votre héros doit d'abord être à la tablée, accueilli par le MJ.")
    index = portraits.lire_index(DEPOT, cle_du_joueur(j))
    if not index or not any(p["nom"] == corps["portrait"] for p in index["portraits"]):
        raise demandes.Refus(409, "Ce portrait n'est pas l'un de ceux de votre héros : la page se relit.")
    if corps["portrait"] == index["actuel"]:
        raise demandes.Refus(409, "C'est déjà son portrait.")
    if any(d["genre"] == portraits.GENRE_CHOIX and d["statut"] == demandes.A_APPLIQUER and depuis_quand(d) < CHOIX_EN_ROUTE
           for d in liste):
        raise demandes.Refus(409, "Un changement de portrait est déjà en route : un instant.")
    return corps


def envoi_par_la_file(_j: dict, _corps: dict, _liste: list) -> dict:
    raise demandes.Refus(400, portraits.PAR_LA_PAGE)


PREALABLES.update({portraits.GENRE_CHOIX: prealable_du_choix, portraits.GENRE_ENVOI: envoi_par_la_file})


def envoyer_portrait_ici(j: dict, octets: bytes, cadre: tuple | None) -> dict:
    """L'image d'un joueur : vérifiée et réécrite d'abord (hors des verrous, c'est le plus long), puis écrite avec sa
    demande, sous les verrous, dans ses bornes (5 images en attente, le plafond horaire des demandes)."""
    if heros_a_la_tablee(j) is None:
        raise demandes.Refus(409, "Votre héros doit d'abord être à la tablée, accueilli par le MJ.")
    nombre, fenetre = portraits.ESSAIS_PAR_JOUEUR
    instant = time.monotonic()
    essais = [t for t in ENVOIS_ESSAYES.get(j["id"], []) if instant - t < fenetre]
    if len(essais) >= nombre:
        raise demandes.Refus(429, "Beaucoup d'images d'un coup : attendez quelques minutes avant d'en envoyer une autre.")
    ENVOIS_ESSAYES[j["id"]] = [*essais, instant]
    propre = portraits.preparer_image(octets, cadre)
    with portraits.verrou(DEPOT), demandes.verrou(DEPOT):
        liste = demandes.lire(DEPOT, j["id"])
        if len(portraits.en_attente(liste)) >= portraits.EN_ATTENTE_MAX:
            raise demandes.Refus(429, f"Vous avez déjà {portraits.EN_ATTENTE_MAX} images qui attendent votre MJ : retirez-en une, "
                                      "ou attendez sa réponse.")
        if plafond_horaire(j["id"], portraits.GENRE_ENVOI):
            raise demandes.Refus(429, f"Pas plus de {demandes.PAR_HEURE} demandes par heure : réessayez un peu plus tard.")
        envoi = portraits.ecrire_envoi(DEPOT, j["id"], propre)
        try:
            d = demandes.nouvelle({"genre": portraits.GENRE_ENVOI, "corps": {"envoi": envoi}}, carnet_ouvert())
            liste = demandes.borner([*liste, d])
            demandes.ecrire(DEPOT, j["id"], liste)
        except BaseException:
            portraits.chemin_envoi(DEPOT, j["id"], envoi).unlink(missing_ok=True)
            raise
        DEMANDES_FAITES.setdefault(compte_horaire(j["id"], portraits.GENRE_ENVOI)[0], []).append(time.monotonic())
        portraits.nettoyer_envois(DEPOT, j["id"], liste)
    return d


def lire_ses_portraits(j: dict) -> dict:
    # Les images que plus aucune demande ne garde (acceptées et recopiées par l'atelier, retirées) s'en vont au passage.
    dossier = portraits.dossier_envois(DEPOT, j["id"])
    if dossier.is_dir():
        # Sans rien à effacer (le plus souvent), aucun verrou n'est pris : la page Table relit souvent.
        gardes = portraits.envois_gardes(demandes.lire(DEPOT, j["id"]))
        if any(f.suffix == ".jpg" and f.stem not in gardes for f in dossier.iterdir()):
            with portraits.verrou(DEPOT), demandes.verrou(DEPOT):
                portraits.nettoyer_envois(DEPOT, j["id"], demandes.lire(DEPOT, j["id"]))
    return etat_portraits(j)


@app.get("/fiche-envoyee")
def page_fiche_envoyee(requete: Request):
    """Le créateur, en lecture : la fiche que le joueur avait envoyée avant que son héros rejoigne la tablée."""
    if not joueur_du_cookie(requete):
        return vers_connexion(requete)
    return page("index.html")


@app.get("/api/portraits")
def lire_portraits(requete: Request):
    j = connecte(requete)
    try:
        return lire_ses_portraits(j)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


@app.get("/portraits/media/{nom}")
def media_portrait(nom: str, requete: Request):
    """Un portrait du héros de ce joueur, carnet ouvert ou fermé : son index se trouve par la clé de son lien."""
    j = connecte(requete)
    chemin = portraits.media_publie(DEPOT, cle_du_joueur(j), nom)
    if chemin is None:
        raise HTTPException(404, "Introuvable")
    # Le nom vient de l'image : il ne change jamais de contenu.
    return FileResponse(chemin, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


@app.get("/portraits/envoi/{fichier}")
def media_envoi(fichier: str, requete: Request):
    """Une image que ce joueur a envoyée, et lui seul : une de ses demandes doit encore la garder."""
    j = connecte(requete)
    envoi = fichier[:-4] if fichier.endswith(".jpg") else ""
    try:
        gardes = portraits.envois_gardes(demandes.lire(DEPOT, j["id"]))
        chemin = portraits.chemin_envoi(DEPOT, j["id"], envoi) if envoi in gardes else None
    except demandes.Refus:
        chemin = None
    if chemin is None or not chemin.is_file():
        raise HTTPException(404, "Introuvable")
    return FileResponse(chemin, media_type="image/jpeg", headers={"Cache-Control": "private, no-store"})


@app.post(ROUTE_ENVOI)
async def envoyer_un_portrait(requete: Request, x: str = "", y: str = "", l: str = ""):  # noqa: E741
    """Le corps est l'image elle-même (JPEG, PNG ou WebP, 8 Mo au plus) ; x, y, l : le cadre choisi à l'écran, en fractions
    de l'image (sans lui, le portrait est pris au centre)."""
    j = connecte(requete)
    if int(requete.headers.get("content-length") or 0) > portraits.OCTETS_MAX:
        raise HTTPException(413, portraits.TROP_LOURDE)
    octets = await requete.body()
    try:
        d = await asyncio.to_thread(envoyer_portrait_ici, j, octets, portraits.cadre_valide(x, y, l) if x or y or l else None)
        return {"envoye": d["id"]} | await asyncio.to_thread(etat_portraits, j)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


# Son héros sous la main à la table du coin (19/11, js/joueurs/table-heros.js) : la fiche en résumé, le sac en tiroir (les
# routes du carnet), et les notes du joueur (notes.py), à lui seul : rien ne les publie, aucune route de l'atelier ne les
# lit. Le fichier se trouve par la session, jamais d'après la requête.
from commun import notes  # noqa: E402

FICHIERS |= {"js/joueurs/table-heros.js", "css/table-heros.css"}
NOTES_ECRITES: dict[str, list[float]] = {}
NOTES_PAR_HEURE = 900  # une écriture toutes les quatre secondes en moyenne : la page enregistre à la pause de la saisie


@app.get("/api/notes")
def lire_mes_notes(requete: Request):
    j = connecte(requete)
    try:
        return notes.lire(DEPOT, j["id"])
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


@app.put("/api/notes")
async def ecrire_mes_notes(requete: Request):
    j = connecte(requete)
    if int(requete.headers.get("content-length") or 0) > notes.ECRITURE_OCTETS_MAX:
        raise HTTPException(413, f"Vos notes dépassent {notes.TEXTE_MAX} signes.")
    corps = await objet(requete)
    instant = time.monotonic()
    faites = [t for t in NOTES_ECRITES.get(j["id"], []) if instant - t < 3600]
    NOTES_ECRITES[j["id"]] = faites
    if len(faites) >= NOTES_PAR_HEURE:
        raise HTTPException(429, "Beaucoup d'enregistrements en peu de temps : vos notes repartiront dans un moment.")
    faites.append(instant)
    try:
        return await asyncio.to_thread(notes.ecrire, DEPOT, j["id"], corps)
    except demandes.Refus as refus:
        raise HTTPException(refus.statut, refus.message)


# La musique du MJ à la table du coin (musique_coin.py, 19/11) : la page Table la relit quand le flux dit « musique » et la
# joue sur cet appareil si le joueur l'a choisi (js/joueurs/musique-coin.js, lecteur de YouTube, sur cette page seule).
from commun import musique_coin  # noqa: E402

FICHIERS |= {"js/joueurs/musique-coin.js"}


@app.get("/api/musique-table")
def lire_la_musique_du_mj(requete: Request):
    connecte(requete)
    if table_joueurs.vue_publiee(DEPOT) is None:
        return {"etat": "arret", "video": None, "position": 0.0}
    return musique_coin.lire(DEPOT)
