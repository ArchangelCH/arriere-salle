"""Les WebSocket de la table, de l'atelier et du pointeur."""

import asyncio
import itertools
import json
import math
import time

from fastapi import WebSocket, WebSocketDisconnect

from commun import pointeurs
from mj import cloisonnement
from mj import proprietes

from api.application import app


@app.websocket("/ws/atelier")
async def ws_atelier(ws: WebSocket):
    """L'atelier écoute la table : l'état que reçoit la TV du salon, au même instant, pour le témoin de l'en-tête ou un
    geste de la télécommande vu tout de suite sur l'ordinateur. Il ne compte pas parmi les écrans branchés, et ne s'ouvre
    jamais à la table publique (la garde ferme déjà ce chemin à Internet sans session)."""
    if portier.acces_table_seule(ws.headers):
        await ws.close(code=1008)
        return
    await ws.accept()
    # Le compte MJ de la page (posé par la Garde) : elle ne reçoit que ce qui est commun et ce qui la concerne.
    tv_etat.diffusion.atelier[ws] = proprietes.compte_courant()
    try:
        await ws.send_text(json.dumps({"type": "etat", "etat": tv_etat.etat_pour_l_atelier(tv_ecran.etat_table())}, ensure_ascii=False))
        while True:
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=45)
            except asyncio.TimeoutError:
                await ws.send_text('{"type":"ping"}')
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        tv_etat.diffusion.atelier.pop(ws, None)


# Le pointeur du MJ : la position de sa souris (ou de son doigt) sur le plan ou la carte ouverts dans l'éditeur, montrée
# en direct sur la TV par un point doré. Rien ne s'écrit, ni sur le disque ni dans l'état de la table. Les positions
# arrivent par un WebSocket propre à l'atelier (/ws/pointeur, hors de CHEMINS_TABLE : fermé à Internet) et ne repartent
# que vers les écrans qui montrent ce plan ou cette carte, ceux d'Internet seulement si la table publique est ouverte.
# Un écran de table ne pilote rien : /ws/table ne lit ce qu'il reçoit que pour tenir la liaison.
POINTEUR_PAR_SECONDE = 40  # au plus, par écran du MJ (l'éditeur en envoie 20)
POINTEUR_BORNE = 1e6
SOURCES_POINTEUR = itertools.count(1)
# Un écran qui n'a pas lu une position à temps ne reçoit plus le pointeur pendant quelques secondes : il ne ralentit
# ni les autres écrans ni le MJ.
LENTS_POINTEUR: dict[WebSocket, float] = {}


def lire_pointeur(brut: str) -> dict | None:
    """Ce qu'envoie l'éditeur : {"plan" ou "carte": id, "x", "y", "onde"?} en coordonnées du plan (cases) ou de la carte,
    {"efface": true}, {"relire": true} (il vient de lire la table), ou la règle de l'outil Mesurer : {"plan" ou "carte": id,
    "regle": [x0, y0, x1, y1], "texte"?} et {"regle": false} pour la retirer. Tout le reste est ignoré."""
    if len(brut) > 400:
        return None
    try:
        m = json.loads(brut)
    except ValueError:
        return None
    if not isinstance(m, dict):
        return None
    if m.get("efface") is True:
        return {"efface": True}
    if m.get("relire") is True:
        return {"relire": True}
    if m.get("regle") is False:
        return {"regle_efface": True}
    genre = "plan" if "plan" in m else "carte" if "carte" in m else None
    ident = m.get(genre) if genre else None
    if not isinstance(ident, str) or not config.ID_VALIDE.match(ident):
        return None
    if "regle" in m:
        bouts = m["regle"]
        valeurs = [pointeurs.nombre(v) for v in bouts] if isinstance(bouts, list) and len(bouts) == 4 else []
        if len(valeurs) != 4 or any(v is None for v in valeurs):
            return None
        return {"genre": genre, "id": ident, "regle": valeurs, "texte": pointeurs.texte_court(m.get("texte"))}
    x, y = m.get("x"), m.get("y")
    for v in (x, y):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or abs(v) > POINTEUR_BORNE:
            return None
    return {"genre": genre, "id": ident, "x": round(x, 3), "y": round(y, 3), "onde": m.get("onde") is True}


def ecrans_du_pointeur(genre: str | None = None, ident: str | None = None) -> tuple[bool, set]:
    """La TV montre-t-elle ce plan (ou cette carte) ? Et les écrans à qui passer le point. Sans plan ni carte (pour
    effacer) : tous les écrans qui voient ce que le MJ envoie."""
    ecrans = set(tv_etat.diffusion.salon)
    if tv_etat.diffusion.internet and tv_etat.table_publique()["ouverte"]:
        ecrans |= tv_etat.diffusion.internet
    if genre is None:
        return True, ecrans
    etat = tv_ecran.etat_table()
    ici = etat.get("vue") == genre and etat.get(genre) == ident
    return ici, ecrans if ici else set()


async def pointer_vers(ecrans: set, message: dict) -> None:
    instant = time.monotonic()
    branches = tv_etat.diffusion.salon | tv_etat.diffusion.internet
    for ecran in [e for e, fin in LENTS_POINTEUR.items() if fin < instant or e not in branches]:
        del LENTS_POINTEUR[ecran]
    vises = [e for e in ecrans if e not in LENTS_POINTEUR]
    texte_ = json.dumps(message, ensure_ascii=False)
    resultats = await asyncio.gather(*(tv_etat.diffusion.envoyer_un(e, texte_, delai=0.5) for e in vises))
    for ecran, ok in zip(vises, resultats):
        if not ok:
            LENTS_POINTEUR[ecran] = instant + 5


@app.websocket("/ws/pointeur")
async def ws_pointeur(ws: WebSocket):
    # La garde ferme déjà ce chemin à qui vient d'Internet ; par prudence, il ne s'y ouvre jamais.
    if portier.acces_table_seule(ws.headers):
        await ws.close(code=1008)
        return
    await ws.accept()
    de = next(SOURCES_POINTEUR)
    montre = False  # un point de cet écran est peut-être à la TV : il s'efface quand l'éditeur se ferme
    portee = None
    reserve, depuis = float(POINTEUR_PAR_SECONDE), time.monotonic()
    try:
        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                break
            # Un message binaire, ou illisible : ignoré.
            m = lire_pointeur(message.get("text") or "")
            # Un plan ou une carte du MJ qui pointe (cloisonnement.py) : ni le point, ni la portée (« ici ») ne disent rien
            # d'une fiche de l'autre MJ.
            if m is None or ("id" in m and not cloisonnement.permis_chemin(tv_boutique_combat.REFS_TABLE[m["genre"]], config.DONNEES / tv_boutique_combat.REFS_TABLE[m["genre"]] / f"{m['id']}.json")):
                continue
            if m.get("efface"):
                if montre:
                    await pointer_vers(ecrans_du_pointeur()[1], {"type": "pointeur", "de": de, "efface": True})
                    montre = False
                await actions_coin.pointeurs_vers_le_coin.efface_point(de)
                continue
            # La règle de l'outil Mesurer part vers la table du coin des joueurs, jamais vers la TV (lot du 13/11).
            if m.get("regle_efface"):
                await actions_coin.pointeurs_vers_le_coin.efface_regle(de)
                continue
            # L'éditeur a lu la table et parle d'après elle : il réapprend la portée au point suivant, même inchangée
            # pour nous (la TV a pu partir et revenir entre-temps).
            if m.get("relire"):
                portee = None
                continue
            instant = time.monotonic()
            reserve = min(float(POINTEUR_PAR_SECONDE), reserve + (instant - depuis) * POINTEUR_PAR_SECONDE)
            depuis = instant
            if reserve < 1:
                continue
            reserve -= 1
            ici, ecrans = ecrans_du_pointeur(m["genre"], m["id"])
            jeton = tv_cartes.jeton(tv_boutique_combat.REFS_TABLE[m["genre"]], m["id"])
            if "regle" in m:
                if ici:
                    await actions_coin.pointeurs_vers_le_coin.mesure(de, m["genre"], jeton, m["regle"][:2], m["regle"][2:], m["texte"])
                continue
            # Vers la table du coin : le point, seulement là où la TV est (ce que le coin montre, c'est la TV).
            if ici:
                await actions_coin.pointeurs_vers_le_coin.pointe(de, m["genre"], jeton, m["x"], m["y"], m["onde"])
            else:
                await actions_coin.pointeurs_vers_le_coin.efface_point(de)
            if ecrans:
                envoi = {"type": "pointeur", "de": de, m["genre"]: tv_cartes.jeton(tv_boutique_combat.REFS_TABLE[m["genre"]], m["id"]), "x": m["x"], "y": m["y"]}
                if m["onde"]:
                    envoi["onde"] = True
                await pointer_vers(ecrans, envoi)
                montre = True
            # L'éditeur apprend si le point passe, et sur combien d'écrans, à chaque changement seulement.
            if (ici, len(ecrans)) != portee:
                portee = (ici, len(ecrans))
                await ws.send_text(json.dumps({"type": "portee", "ici": ici, "ecrans": len(ecrans)}))
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        if montre:
            await pointer_vers(ecrans_du_pointeur()[1], {"type": "pointeur", "de": de, "efface": True})
        await actions_coin.pointeurs_vers_le_coin.efface(de)


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import config, portier, tv_cartes, tv_boutique_combat, tv_etat, tv_ecran  # noqa: E402
from api import actions_coin  # noqa: E402
