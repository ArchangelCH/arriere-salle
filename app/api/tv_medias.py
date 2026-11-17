"""Les médias montrés à la TV, le monde et ses cartes."""

import asyncio
import json
import time
from contextlib import AsyncExitStack

from fastapi import HTTPException
from fastapi.responses import Response

from mj import cloisonnement
from table import lectures_publiques
from table import vignettes
from table.masque import forme_simple, masquer, masquer_tout

from api.application import app


# Les portraits réduits de la table publique (vignettes.py) : un téléphone sur un réseau lent tire des médaillons de
# quelques dizaines de Ko, plus leur image entière. Depuis Internet, seulement une image que cite ce que la TV montre en
# ce moment (medias_montres) ; la TV du salon et les MJ, toutes.
MEDIAS_MONTRES_DUREE = 2.0  # secondes : une page de héros tire six vignettes d'un coup, la liste ne se refait qu'une fois
# Une image absente d'une liste encore fraîche : la fiche montrée a pu changer sans que table.json bouge (un pion ajouté au
# plan que la TV montre, un portrait choisi) ; la liste se refait alors, mais pas plus souvent que ceci.
MEDIAS_MONTRES_RELECTURE = 0.25
_medias_montres: dict = {"cle": None, "quand": 0.0, "noms": frozenset()}


async def lire_en_interne(chemin: str) -> str:
    """Le corps d'une lecture GET de l'appli, demandée sans repasser par la Garde, en lecteur public (comme la TV) ; ""
    si elle ne répond pas 200."""
    morceaux, statut = [], []
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET", "scheme": "http",
             "path": chemin, "raw_path": chemin.encode(), "root_path": "", "query_string": b"", "headers": [],
             "client": None, "server": None, "app": app}

    async def recevoir():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def envoyer(message):
        if message["type"] == "http.response.start":
            statut.append(message["status"])
        elif message["type"] == "http.response.body":
            morceaux.append(message.get("body", b""))

    jeton_lecteur = cloisonnement.poser_lecteur(cloisonnement.PUBLIC)
    try:
        # La pile que la pile de l'appli (AsyncExitStackMiddleware) pose d'ordinaire pour les routes de FastAPI.
        async with AsyncExitStack() as pile:
            scope["fastapi_middleware_astack"] = pile
            await app.router(scope, recevoir, envoyer)
    except Exception:  # noqa: BLE001 : une lecture refusée (404) ou cassée ne cite aucune image
        return ""
    finally:
        cloisonnement.retirer_lecteur(jeton_lecteur)
    return b"".join(morceaux).decode("utf-8", "replace") if statut[:1] == [200] else ""


async def medias_montres(voulu: str | None = None) -> frozenset:
    """Les noms des images que citent les lectures que la TV montre en ce moment (lectures_publiques.chemins_montres).
    voulu : l'image demandée ; absente d'une liste fraîche, la liste se refait (au plus tous les MEDIAS_MONTRES_RELECTURE)."""
    etat = tv_ecran.etat_table()
    cle = json.dumps(etat, sort_keys=True, ensure_ascii=False, default=str)
    age = time.monotonic() - _medias_montres["quand"]
    if (_medias_montres["cle"] == cle and age < MEDIAS_MONTRES_DUREE
            and (voulu is None or voulu in _medias_montres["noms"] or age < MEDIAS_MONTRES_RELECTURE)):
        return _medias_montres["noms"]
    noms: set = set()
    for chemin in lectures_publiques.chemins_montres(etat, tv_cartes.jeton):
        noms |= lectures_publiques.medias_cites(await lire_en_interne(chemin))
    _medias_montres.update(cle=cle, quand=time.monotonic(), noms=frozenset(noms))
    return _medias_montres["noms"]


async def medias_pour(chemin: str):
    """Pour une vignette lue sans compte : les images que la TV montre ; None pour toute autre lecture."""
    prefixe = "/api/table/vignette/"
    return await medias_montres(chemin[len(prefixe):]) if chemin.startswith(prefixe) else None


@app.get("/api/table/vignette/{nom}")
async def table_vignette(nom: str, l: int = 320, a: int = 0, f: str = ""):
    m = config.MEDIA_VALIDE.match(f"/media/{nom}")
    chemin = config.IMAGES / m.group(1) if m else None
    if not chemin or not chemin.is_file():
        raise HTTPException(404, "Introuvable")
    # a=1 : une image du MJ garde sa transparence, en PNG.
    contenu = await asyncio.to_thread(vignettes.vignette, chemin, l, transparence=a == 1, webp=f == "webp")
    if not contenu:
        raise HTTPException(404, "Introuvable")
    genre = "image/png" if contenu[:8] == vignettes.PNG else "image/webp" if contenu[:4] == vignettes.RIFF else "image/jpeg"
    return Response(contenu, media_type=genre, headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.get("/api/table/lieu/{j}")
def table_lieu(j: str):
    lieu = utilitaires.lire_fiche(tv_cartes.par_jeton(config.LIEUX, "lieux", j))
    if not lieu.get("connu"):
        raise HTTPException(404, "Introuvable")
    return tv_cartes.reponse_publique(tv_cartes.lieu_public(lieu))


# Le monde tel que les joueurs le connaissent (deuxième accès MJ, lot MJ-3) : les PNJ et les lieux connus, comme le carnet
# les publie (au masque, sans un champ qui nomme ce qu'ils ne savent pas), et les cartes où les joueurs connaissent au moins
# un lieu, telles que la TV les montrerait (une carte sans lieu connu, un souterrain pas encore trouvé, reste à son MJ).
# Le même pour les deux MJ : c'est ainsi que l'invité voit le monde du MJ principal, et le MJ principal celui de l'invité. Rien n'y désigne
# une fiche autrement que par son jeton.
def carte_du_monde_connue(carte: dict) -> dict | None:
    publique = tv_cartes.carte_publique(carte)
    return publique if publique.get("marqueurs") else None


@app.get("/api/monde")
def le_monde():
    candidats = noms_caches.secrets_des_joueurs()
    pnj = []
    for p in utilitaires.lire_tout(config.PNJ, tout=True):
        if p.get("connu") is True and p.get("id") and forme_simple(p.get("nom")) not in ("", noms_caches.NOM_PNJ_DEFAUT):
            vu = carnet_api.retenir(masquer_tout(tv_fiches.pnj_public(p)), "nom", ("", False), candidats, [])
            if vu is not None:
                pnj.append(vu)
    lieux = [vu for l in tv_cartes.lieux_connus().values() if utilitaires.texte(l.get("nom")).strip()
             if (vu := carnet_api.retenir(masquer_tout(tv_cartes.lieu_public(l)), "nom", ("", False), candidats, [])) is not None]
    cartes = []
    for c in utilitaires.lire_tout(config.CARTES, tout=True):
        if not isinstance(c.get("id"), str) or not config.ID_VALIDE.match(c["id"]) or carte_du_monde_connue(c) is None:
            continue
        parent = c.get("parent") if isinstance(c.get("parent"), dict) else None
        cartes.append({"id": tv_cartes.jeton("cartes", c["id"]), "nom": masquer(" ".join(utilitaires.texte(c.get("nom")).split())),
                       "largeur": c.get("largeur"), "hauteur": c.get("hauteur"), "km_case": c.get("km_case"),
                       "parent": ({"carte": tv_cartes.jeton("cartes", parent["carte"]), **{k: parent.get(k) for k in ("x0", "y0", "x1", "y1")}}
                                  if parent and isinstance(parent.get("carte"), str) and config.ID_VALIDE.match(parent["carte"]) else None)})
    return {"pnj": sorted(pnj, key=lambda x: forme_simple(x.get("nom"))), "lieux": sorted(lieux, key=lambda x: forme_simple(x.get("nom"))),
            "cartes": sorted(cartes, key=lambda x: forme_simple(x.get("nom")))}


@app.get("/api/monde/cartes/{j}")
def carte_du_monde(j: str):
    """Une carte du monde, telle que la TV la montrerait (carte_publique) : sans son fond peint, qui ne se lit qu'à la TV."""
    publique = carte_du_monde_connue(utilitaires.lire_fiche(tv_cartes.par_jeton(config.CARTES, "cartes", j)))
    if publique is None:
        raise HTTPException(404, "Introuvable")
    return tv_cartes.reponse_publique(publique)


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import config, utilitaires, carnet_api, noms_caches, tv_cartes, tv_fiches, tv_ecran  # noqa: E402
