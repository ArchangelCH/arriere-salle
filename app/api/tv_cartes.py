"""Ce que la TV reçoit des cartes : jetons, brume, habillage, fonds peints."""

import asyncio
import base64
import hashlib
import hmac
import io
import json
import re
import secrets
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, Response
from PIL import Image

from ia import habillage
from table.masque import masquer_tout

from api.application import app
from api import config
from commun import stockage


# Vue des joueurs : ce qui part vers la TV ne contient jamais les secrets du MJ, ni même un identifiant de fiche.
# Chaque fiche y est désignée par un jeton opaque, tiré d'une clé propre à cette installation.

def cle_jetons() -> bytes:
    if not config.CLE_JETONS.exists():
        config.CLE_JETONS.write_text(secrets.token_hex(32), encoding="utf-8")
        config.CLE_JETONS.chmod(0o600)
    return bytes.fromhex(config.CLE_JETONS.read_text(encoding="utf-8").strip())


CLE = cle_jetons()
JETON_VALIDE = re.compile(r"^[a-f0-9]{20}$")


def jeton(collection: str, ident: str) -> str:
    return hmac.new(CLE, f"{collection}/{ident}".encode(), hashlib.sha256).hexdigest()[:20]


def par_jeton(dossier: Path, collection: str, j: str) -> Path:
    if JETON_VALIDE.match(j or ""):
        for f in dossier.glob("*.json"):
            if hmac.compare_digest(jeton(collection, f.stem), j):
                return f
    raise HTTPException(404, "Introuvable")


def reponse_publique(contenu) -> JSONResponse:
    return JSONResponse(masquer_tout(contenu))


def lieux_connus() -> dict:
    return {lieu["id"]: lieu for lieu in utilitaires.lire_tout(config.LIEUX, tout=True) if lieu.get("connu") and lieu.get("id")}


def url_publique(fiche: dict):
    illustrations = [i.get("url") for i in fiche.get("illustrations", []) if not i.get("secrete") and i.get("url")]
    return fiche.get("illustration") if fiche.get("illustration") in illustrations else (illustrations[0] if illustrations else None)


def lieu_public(lieu: dict) -> dict:
    # Des illustrations, la TV ne reçoit que l'adresse : les prompts et descriptions sont des notes du MJ.
    illustrations = [{"url": i["url"]} for i in lieu.get("illustrations", []) if not i.get("secrete") and i.get("url")]
    return {
        "id": jeton("lieux", lieu["id"]),
        "nom": lieu.get("nom", ""),
        "type": lieu.get("type", "point"),
        "resume": lieu.get("resume", ""),
        "illustrations": illustrations,
        "illustration": url_publique(lieu),
    }


def connu_a(brume: bytes | None, largeur: int, hauteur: int, x, y) -> bool:
    if brume is None:
        return True
    cx = min(max(int(utilitaires.nombre(x) // 1), 0), largeur - 1)
    cy = min(max(int(utilitaires.nombre(y) // 1), 0), hauteur - 1)
    i = cy * largeur + cx
    return i < len(brume) and brume[i] == 1


def brume_carte(carte: dict) -> bytes | None:
    """Les cases connues des joueurs (1), ou None si le brouillard est éteint."""
    if not carte.get("brouillard_actif"):
        return None
    try:
        return base64.b64decode(carte.get("brouillard") or "")
    except ValueError:
        return b""


def signature(*morceaux) -> str:
    return hashlib.sha1(json.dumps(morceaux, ensure_ascii=False, default=str).encode()).hexdigest()[:16]


def habillage_public(carte: dict, connus: dict) -> dict | None:
    """L'habillage vu par la TV : rien de caché ni d'un lieu qu'elle ne montre pas, aucun repère sous le brouillard."""
    w, h = int(carte.get("largeur") or 0), int(carte.get("hauteur") or 0)
    brume = brume_carte(carte)
    montres = {m.get("lieu") for m in carte.get("marqueurs", [])
               if m.get("lieu") in connus and not m.get("cache") and connu_a(brume, w, h, m.get("x"), m.get("y"))}
    return habillage.carte_tv(carte.get("habillage"), montres, lambda x, y: connu_a(brume, w, h, x, y))


def version_carte(carte: dict, connus: dict) -> str:
    # La carte publique change aussi quand un lieu devient connu, change de nom ou d'illustration, ou que son habillage
    # visible change.
    lieux = sorted({m.get("lieu") for m in carte.get("marqueurs", []) if m.get("lieu")})
    return signature(carte.get("modifie"), [(l, connus[l].get("modifie"), url_publique(connus[l])) for l in lieux if l in connus],
                     *([habillage_public(carte, connus)] if carte.get("habillage") else []))


CHAMPS_MARQUEUR = ("x", "y", "taille", "taille_nom", "nx", "ny", "type", "sans_nom", "nom_gauche", "nom")
CHAMPS_ETIQUETTE = ("texte", "x", "y", "taille", "style", "espacement", "courbure", "angle")


def carte_publique(carte: dict) -> dict:
    """Liste blanche : seulement ce que dessine la TV. Pas d'identifiant, pas de repère, pas de note ; ni lieu, ni
    étiquette sous le brouillard ; le groupe seulement s'il est montré aux joueurs."""
    connus = lieux_connus()
    w, h = int(carte.get("largeur") or 0), int(carte.get("hauteur") or 0)
    brume = brume_carte(carte)
    publique = {k: carte.get(k) for k in ("nom", "largeur", "hauteur", "km_case", "taille_textes", "taille_symboles", "graine",
                                          "style", "terrain", "brouillard", "brouillard_actif", "decor")}
    publique["modifie"] = version_carte(carte, connus)
    marqueurs = [m for m in carte.get("marqueurs", []) if m.get("lieu") in connus and not m.get("cache") and connu_a(brume, w, h, m.get("x"), m.get("y"))]
    publique["marqueurs"] = [{k: m[k] for k in CHAMPS_MARQUEUR if k in m} | {"lieu": jeton("lieux", m["lieu"])} for m in marqueurs]
    publique["lieux"] = {jeton("lieux", m["lieu"]): lieu_public(connus[m["lieu"]]) for m in marqueurs}
    publique["etiquettes"] = [{k: e[k] for k in CHAMPS_ETIQUETTE if k in e} for e in carte.get("etiquettes", [])
                              if not e.get("cache") and connu_a(brume, w, h, e.get("x"), e.get("y"))]
    publique["traces"] = [{k: t[k] for k in ("type", "points", "largeur") if k in t} for t in carte.get("traces", []) if not t.get("cache")]
    if carte.get("habillage"):
        publique["habillage"] = habillage_public(carte, connus)
    g = carte.get("groupe")
    if isinstance(g, dict) and g.get("visible") and g.get("montrer") is not False:
        publique["groupe"] = {k: g.get(k) for k in ("x", "y", "visible", "montrer", "trajet")}
    return publique


@app.get("/api/table/carte/{j}")
def table_carte(j: str):
    chemin = par_jeton(config.CARTES, "cartes", j)
    return reponse_publique(carte_pour_table(chemin, j))


# ---- Fond peint des cartes pour la TV : l'atelier le peint (la TV est lente) d'après la carte publique et le confie au
# serveur, qui le garde avec ce dont il est tiré. La TV le reçoit par jeton, puis ne repeint que ce qui s'est ajouté
# depuis. Une image tirée d'une carte où quelque chose a disparu depuis (lieu caché, tracé retiré) n'est plus servie :
# elle le montrerait encore.

FONDS_PEINTS = config.DONNEES / "fonds-peints"
FONDS_PEINTS.mkdir(parents=True, exist_ok=True)
FOND_PEINT_COTE_MAX = 4096


def carte_pour_table(chemin: Path, j: str) -> dict:
    publique = carte_publique(utilitaires.lire_fiche(chemin))
    annonce = annonce_fond_peint(chemin.stem, j, publique)
    if annonce:
        publique["fond_peint"] = annonce
    return publique


def empreinte(x) -> str:
    return hashlib.sha1(json.dumps(x, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()[:16]


def base_du_fond(publique: dict) -> dict:
    """Ce dont dépend le fond peint d'une carte publique : le terrain, et ce qui se pose dessus élément par élément
    (ni les noms, ni le décor hors du cadre et de la brume)."""
    decor = publique.get("decor") or {}
    hab = publique.get("habillage") if isinstance(publique.get("habillage"), dict) else {}
    types = {j: (l or {}).get("type") for j, l in (publique.get("lieux") or {}).items()}
    return {
        "fond": signature(publique.get("largeur"), publique.get("hauteur"), publique.get("graine"), publique.get("km_case"),
                          publique.get("terrain"), decor.get("brume"), decor.get("cadre"), hab.get("taille_parcelle_m")),
        "traces": [empreinte(t) for t in publique.get("traces") or []],
        "marqueurs": [empreinte([m.get("x"), m.get("y"), m.get("taille"), types.get(m.get("lieu")) or m.get("type")])
                      for m in publique.get("marqueurs") or []],
        "habillage": {g: [empreinte(e) for e in v] for g, v in hab.items() if isinstance(v, list)},
    }


def ajouts(avant: list, apres: list) -> list | None:
    """Indices des éléments de apres absents de avant, ou None si un élément de avant a disparu."""
    reste: dict = {}
    for k in avant:
        reste[k] = reste.get(k, 0) + 1
    nouveaux = []
    for i, k in enumerate(apres):
        if reste.get(k):
            reste[k] -= 1
        else:
            nouveaux.append(i)
    return None if any(reste.values()) else nouveaux


def annonce_fond_peint(ident: str, j: str, publique: dict) -> dict | None:
    """Ce que la TV apprend du fond peint : son adresse (par jeton), son échelle et les éléments ajoutés depuis."""
    try:
        meta = stockage.lire_json((FONDS_PEINTS / f"{ident}.json"))
    except (OSError, ValueError):
        return None
    if not (FONDS_PEINTS / f"{ident}.png").exists() or not isinstance(meta, dict):
        return None
    base, source = base_du_fond(publique), meta.get("base") or {}
    if source.get("fond") != base["fond"]:
        return None
    nouveaux = {"traces": ajouts(source.get("traces") or [], base["traces"]),
                "marqueurs": ajouts(source.get("marqueurs") or [], base["marqueurs"]), "habillage": {}}
    if nouveaux["traces"] is None or nouveaux["marqueurs"] is None:
        return None
    hab_source = source.get("habillage") or {}
    for genre in set(hab_source) | set(base["habillage"]):
        n = ajouts(hab_source.get(genre) or [], base["habillage"].get(genre) or [])
        if n is None:
            return None
        if n:
            nouveaux["habillage"][genre] = n
    return {"url": f"/api/table/carte/{j}/fond?v={meta.get('empreinte', '')}", "echelle": meta.get("echelle"), "nouveaux": nouveaux}


def fond_peint_verifie(contenu: bytes, largeur: int, hauteur: int) -> bytes:
    """Le fond reçu : un PNG aux dimensions attendues, vérifié et réécrit comme toute image reçue (sans métadonnées)."""
    try:
        with Image.open(io.BytesIO(contenu)) as im:
            if im.format != "PNG":
                raise HTTPException(415, "Fond peint : PNG attendu")
            if im.size != (largeur, hauteur):
                raise HTTPException(400, "Fond peint : dimensions inattendues")
            im.load()
            sortie = io.BytesIO()
            im.convert("RGB").save(sortie, "PNG", compress_level=6)
            return sortie.getvalue()
    except HTTPException:
        raise
    except (OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(415, "Fond peint illisible (PNG attendu)")


@app.get("/api/cartes/{ident}/publique")
def carte_publique_atelier(ident: str):
    """La carte telle que la TV la reçoit (même sortie que /api/table/carte), pour l'atelier qui lui peint son fond."""
    chemin = utilitaires.existant(config.CARTES, ident)
    return reponse_publique(carte_pour_table(chemin, jeton("cartes", chemin.stem)))


@app.put("/api/cartes/{ident}/fond")
async def deposer_fond_peint(ident: str, requete: Request, version: str = "", echelle: int = 0):
    chemin = utilitaires.existant(config.CARTES, ident)
    contenu = bytearray()
    async for morceau in requete.stream():
        contenu += morceau
        if len(contenu) > config.CORPS_MAX:
            raise HTTPException(413, "Fond peint trop lourd")
    carte = utilitaires.lire_fiche(chemin)
    largeur, hauteur = int(utilitaires.nombre(carte.get("largeur"))), int(utilitaires.nombre(carte.get("hauteur")))
    if not 2 <= echelle <= 16 or not 0 < largeur * echelle <= FOND_PEINT_COTE_MAX or not 0 < hauteur * echelle <= FOND_PEINT_COTE_MAX:
        raise HTTPException(400, "Fond peint : échelle refusée")
    propre = await asyncio.to_thread(fond_peint_verifie, bytes(contenu), largeur * echelle, hauteur * echelle)
    # Le fond doit venir de la carte publique d'aujourd'hui : sinon l'atelier le refera après le prochain enregistrement.
    publique = carte_publique(utilitaires.lire_fiche(chemin))
    if version != publique.get("modifie"):
        raise HTTPException(409, "La carte a changé depuis : fond à refaire")
    stockage.ecrire_octets(FONDS_PEINTS / f"{ident}.png", propre)
    utilitaires.ecrire(FONDS_PEINTS / f"{ident}.json", {"version": version, "echelle": echelle, "empreinte": hashlib.sha1(propre).hexdigest()[:16],
                                             "base": base_du_fond(publique), "cree": utilitaires.maintenant()})
    # Les cartes : la table du coin prend aussitôt le nouveau fond (le téléphone ne peint pas le relief lui-même).
    tv_etat.table_coin.signaler()
    return {"ok": True, "octets": len(propre)}


@app.get("/api/table/carte/{j}/fond")
def table_carte_fond(j: str):
    chemin = par_jeton(config.CARTES, "cartes", j)
    if not annonce_fond_peint(chemin.stem, j, carte_publique(utilitaires.lire_fiche(chemin))):
        raise HTTPException(404, "Introuvable")
    try:
        contenu = (FONDS_PEINTS / f"{chemin.stem}.png").read_bytes()
    except OSError:
        raise HTTPException(404, "Introuvable")
    return Response(contenu, media_type="image/png", headers={"Cache-Control": "private, max-age=86400"})


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import utilitaires, tv_etat  # noqa: E402
