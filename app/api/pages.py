"""Les pages HTML de l'atelier, la connexion et les routes des comptes MJ."""

import asyncio
import json
from html import escape as echapper_html
from urllib.parse import urlencode

from fastapi import HTTPException, Request
from fastapi.responses import Response

from commun import acces
from mj import adresses
from mj import cloisonnement
from mj import comptes_mj
from mj import mot_de_passe_mj
from mj import porte_lan
from mj import porte_mj
from mj import proprietes
from commun.pdf import RenduImpossible, nom_de_fichier, page_en_pdf

from api.application import app
from api import config, portier, statiques_versionnes, utilitaires


page_statique = statiques_versionnes.page_html


# La page de l'atelier. Pour un MJ invité, marquée de son rôle (lot MJ-6, js/mj/role.js) : son menu ne montre que ses
# onglets, ses pages ne demandent rien de ce qui lui est fermé. Le compte principal reçoit le fichier tel quel.
@app.get("/")
def accueil():
    # Au réveil de la porte du LAN : « Vos appareils » en tête, avec l'avis « Relisez vos appareils ».
    marques = ([' data-role="invite"'] if cloisonnement.est_invite() else []) + \
        ([' data-appareils="a-relire"'] if portier.PORTE_LAN.a_relire(proprietes.compte_courant()) else []) + marques_des_mj()
    return page_statique("index.html", "".join(marques))


def marques_des_mj() -> list:
    """Avec deux MJ ouverts seulement : le compte de la page et les autres MJ (identifiant et nom), pour la case « Partager
    avec l'autre MJ » et la pastille « partagée par … » (js/mj/partage.js). Sans invité, la page reste telle quelle."""
    ouverts = adresses.ouverts(config.DONNEES)
    moi = proprietes.compte_courant()
    autres = [m for m in ouverts if m["id"] != moi]
    if len(ouverts) < 2 or not autres:
        return []
    return [f' data-compte="{echapper_html(moi, quote=True)}"',
            f' data-autres-mj="{echapper_html(json.dumps(autres, ensure_ascii=False), quote=True)}"']


def suite_sure(suite: str) -> str:
    # Seulement une adresse de l'atelier : jamais « //ailleurs.example » ni une adresse complète. Le navigateur retire
    # tabulations et sauts de ligne d'une adresse avant de la lire (« /<tab>/ailleurs » devient « //ailleurs ») et lit
    # « \ » comme « / » : ni les uns ni l'autre n'entrent.
    if not suite.startswith("/") or suite.startswith("//") or "\\" in suite or any(ord(c) < 32 or ord(c) == 127 for c in suite):
        return "/"
    return suite


def page_connexion(message: str = "", suite: str = "/", statut: int = 200, identifiant: str = "") -> Response:
    page = (config.ICI / "connexion.html").read_text(encoding="utf-8")
    page = page.replace("{{message}}", echapper_html(message)).replace("{{suite}}", echapper_html(suite))
    page = page.replace("{{identifiant}}", echapper_html(identifiant))
    return Response(page, status_code=statut, media_type="text/html; charset=utf-8",
                    headers={"Cache-Control": "no-store", "X-Frame-Options": "DENY", "X-Robots-Tag": "noindex"})


@app.get("/connexion")
def connexion_page(suite: str = "/"):
    return page_connexion(suite=suite_sure(suite))


@app.post("/connexion")
async def connexion(request: Request):
    """Identifiant et mot de passe d'un compte MJ (comptes_mj.py). Sans identifiant (ou « MJ », celui que retenaient
    les navigateurs), le compte principal : le mot de passe du MJ principal suffit, comme avant. Rien ne dit si un identifiant
    existe ; les essais manqués se comptent par adresse et par identifiant."""
    formulaire = await request.form()
    identifiant = str(formulaire.get("identifiant", ""))[:64]
    mot_de_passe = str(formulaire.get("mot_de_passe", ""))[:256]
    suite = suite_sure(str(formulaire.get("suite", "/")))
    adresse = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "?")
    etat = portier.comptes_mj_lus() or comptes_mj.vide()
    cles = (("adresse", adresse), ("identifiant", comptes_mj.forme_de_connexion(etat, identifiant)))
    essai = portier.ECHECS_CONNEXION.reserver(cles, {cles[0]: (portier.ECHECS_PAR_ADRESSE, 900), cles[1]: (portier.ECHECS_PAR_IDENTIFIANT, 3600)},
                                      portier.ECHECS_EN_TOUT)
    if essai is None:
        config.journal.warning("Connexion refusée à %s : trop d'essais", adresse)
        return page_connexion("Trop d'essais manqués. Réessayez dans un quart d'heure.", suite, 429, identifiant)
    compte = comptes_mj.pour_connexion(etat, identifiant) if portier.CLE_SESSION and portier.EMPREINTE_MDP else None
    bon = await acces.calculer(acces.verifier, compte["empreinte"] if compte else comptes_mj.leurre(), mot_de_passe)
    if not (bon and compte):
        config.journal.warning("Identifiant ou mot de passe incorrect depuis %s", adresse)
        await asyncio.sleep(portier.ATTENTE_ECHEC)
        return page_connexion("Identifiant ou mot de passe incorrect.", suite, 401, identifiant)
    portier.ECHECS_CONNEXION.liberer(essai)
    portier.ECHECS_CONNEXION.oublier(*cles)
    config.journal.info("Connexion à l'atelier (%s) depuis %s", compte["id"], adresse)
    reponse = Response(status_code=303, headers={"Location": suite, "Cache-Control": "no-store"})
    reponse.set_cookie(portier.COOKIE_SESSION, comptes_mj.jeton_de_session(compte, portier.CLE_SESSION, portier.DUREE_SESSION), max_age=portier.DUREE_SESSION,
                       path="/", secure=True, httponly=True, samesite="lax")
    # Sur le réseau local, porte éveillée (porte_lan.py) : se connecter reconnaît cet appareil, pour 400 jours.
    await portier.PORTE_LAN.apres_connexion(reponse, compte["id"], request.headers, lan=not portier.acces_atelier_public(request.headers))
    return reponse


# Les comptes MJ (porte_mj.py) : /api/moi, le bloc « Les MJ » de l'onglet Aventuriers, la page d'invitation d'un MJ.
def page_invitation() -> Response:
    return Response((config.ICI / "invitation.html").read_text(encoding="utf-8"), media_type="text/html; charset=utf-8",
                    headers={"Cache-Control": "no-store", "X-Frame-Options": "DENY", "X-Robots-Tag": "noindex",
                             "Referrer-Policy": "no-referrer"})


app.include_router(porte_mj.routes(
    donnees=config.DONNEES, empreinte_env=lambda: portier.EMPREINTE_MDP, cle_session=lambda: portier.CLE_SESSION, cookie=portier.COOKIE_SESSION,
    duree=portier.DUREE_SESSION, essais=portier.ECHECS_CONNEXION, plafond=lambda: portier.ECHECS_EN_TOUT, attente=lambda: portier.ATTENTE_ECHEC,
    adresse_publique=lambda: f"https://{min(portier.ATELIER_PUBLIC)}" if portier.ATELIER_PUBLIC else None, page_invitation=page_invitation,
    corps_objet=utilitaires.corps_objet))
# « Vos appareils » : les appareils reconnus sur le réseau local (porte_lan.py).
app.include_router(porte_lan.routes(portier.PORTE_LAN, corps_objet=utilitaires.corps_objet,
                                    sur_le_lan=lambda e: not portier.acces_atelier_public(e) and not portier.acces_table_seule(e)))
# « Changer mon mot de passe » (page Réglages) : chacun le sien, l'actuel d'abord (mot_de_passe_mj.py).
app.include_router(mot_de_passe_mj.routes(
    donnees=config.DONNEES, empreinte_env=lambda: portier.EMPREINTE_MDP, cle_session=lambda: portier.CLE_SESSION, cookie=portier.COOKIE_SESSION,
    duree=portier.DUREE_SESSION, essais=portier.ECHECS_CONNEXION, limites=lambda: ((portier.ECHECS_PAR_ADRESSE, 900), (portier.ECHECS_PAR_IDENTIFIANT, 3600)),
    plafond=lambda: portier.ECHECS_EN_TOUT, attente=lambda: portier.ATTENTE_ECHEC, porte=portier.PORTE_LAN, en_ligne=portier.acces_atelier_public,
    corps_objet=utilitaires.corps_objet, couper_canaux=lambda compte: tv_etat.diffusion.couper(compte)))


@app.get("/deconnexion")
def deconnexion():
    reponse = Response(status_code=303, headers={"Location": "/connexion", "Cache-Control": "no-store"})
    reponse.delete_cookie(portier.COOKIE_SESSION, path="/", secure=True, httponly=True, samesite="lax")
    return reponse


@app.get("/table")
def page_table():
    return page_statique("table.html")


@app.get("/fiche-seance")
def page_fiche_seance():
    return page_statique("fiche-seance.html")


@app.get("/feuille-combat")
def page_feuille_combat():
    return page_statique("feuille-combat.html")


# Les billets secrets d'une séance, à imprimer et découper : une page de l'atelier, fermée à la table publique (Garde).
@app.get("/billets")
def page_billets():
    return page_statique("billets.html")


@app.get("/fiche-aventurier.pdf")
async def fiche_aventurier_pdf(requete: Request):
    """La fiche en PDF, rendue par le serveur : le même résultat depuis un téléphone, un iPad ou un ordinateur."""
    params = {k: v for k, v in requete.query_params.items() if k in ("id", "ids", "tablee", "verso", "eco")}
    ids = [x for x in (params.get("ids") or params.get("id") or "").split(",") if x]
    if not ids and not params.get("tablee"):
        raise HTTPException(400, "Quelle fiche ?")
    for ident in ids:
        utilitaires.existant(config.AVENTURIERS, ident)
    nom = utilitaires.lire_fiche(utilitaires.fichier(config.AVENTURIERS, ids[0])).get("nom") if len(ids) == 1 else "Tablée"
    # Chromium passe la porte du réseau local par un jeton de rendu à usage unique (porte_lan.py).
    rendu = portier.PORTE_LAN.jeton_de_rendu(proprietes.compte_courant())
    try:
        contenu = await page_en_pdf(f"http://127.0.0.1:8000/fiche-aventurier?{urlencode({**params, 'rendu': rendu})}")
    except RenduImpossible as err:
        raise HTTPException(503, f"PDF impossible : {err}")
    finally:
        portier.PORTE_LAN.fin_de_rendu(rendu)
    return Response(contenu, media_type="application/pdf", headers={"Content-Disposition": nom_de_fichier(nom), "Cache-Control": "no-store"})


@app.get("/fiche-aventurier")
def page_fiche_aventurier():
    return page_statique("fiche-aventurier.html")


@app.get("/api/cartes")
def liste_cartes():
    cartes = [{k: c.get(k) for k in ("id", "nom", "largeur", "hauteur", "km_case", "modifie", "parent")} for c in utilitaires.lire_tout(config.CARTES)]
    return sorted(cartes, key=lambda c: c.get("modifie") or "", reverse=True)


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import tv_etat  # noqa: E402
