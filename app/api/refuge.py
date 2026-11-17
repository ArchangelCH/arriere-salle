"""Le sanctuaire : bâtiments, chantiers, versements."""

import asyncio
import json
import re
import secrets
import threading
from datetime import datetime

from fastapi import HTTPException, Request, WebSocket, WebSocketDisconnect

from commun import cagnottes
from commun import carnet
from mj import cloisonnement
from mj import proprietes
from contenu import sanctuaire
from coin_mj import sanctuaire_joueurs

from api.application import app
from api import config


# Le sanctuaire (sanctuaire.py) : l'auberge à relever et le village autour, un seul document. L'atelier l'enregistre
# entier (version_base, 409 si un autre écran l'a changé) ; les versements ne passent que par leur route, qui prend l'or
# dans la bourse du héros et le verse dans la cagnotte d'un chantier d'un même geste. La TV n'en voit que
# sanctuaire_public (/api/table/sanctuaire).
SANCTUAIRE = config.DONNEES / "sanctuaire.json"
# Un verrou de fil, pas de boucle : la boîte du MJ (un fil à part, sous le verrou des demandes) verse et ouvre des
# chantiers par les mêmes cœurs que les routes (lot B2, sanctuaire_joueurs.py). Rien ne s'attend dessous : lire, changer,
# écrire, puis la TV est prévenue une fois le verrou rendu (annoncer_sanctuaire). Pris avant SAC_VERROU, jamais après.
VERROU_SANCTUAIRE = threading.RLock()


def lire_sanctuaire(strict: bool = False) -> dict:
    """Le sanctuaire enregistré, ou celui de départ (l'auberge en ruines, le catalogue proposé) tant qu'il n'existe pas."""
    if not SANCTUAIRE.exists():
        return sanctuaire.nouveau_sanctuaire() | {"modifie": None}
    try:
        s = utilitaires.lire(SANCTUAIRE)
    except (OSError, ValueError):
        if strict:
            raise HTTPException(500, "Fichier illisible : sanctuaire.json")
        return sanctuaire.nouveau_sanctuaire() | {"modifie": None}
    if not isinstance(s, dict):
        if strict:
            raise HTTPException(500, "Fichier invalide : sanctuaire.json")
        return sanctuaire.nouveau_sanctuaire() | {"modifie": None}
    return s


def enregistrer_sanctuaire(s: dict) -> dict:
    """Sous VERROU_SANCTUAIRE : la nouvelle version du sanctuaire, sur le disque."""
    s["modifie"] = utilitaires.maintenant()
    if SANCTUAIRE.exists():
        utilitaires.archiver(SANCTUAIRE, "sanctuaire")
    utilitaires.ecrire(SANCTUAIRE, s)
    return s


async def annoncer_sanctuaire() -> None:
    """La TV qui montre le sanctuaire le relit (sanctuaire_maj change sa version). Dans la boucle, hors du verrou."""
    etat = tv_ecran.etat_table()
    if etat.get("vue") == "sanctuaire":
        etat["sanctuaire_maj"] = lire_sanctuaire().get("modifie")
        utilitaires.ecrire(config.TABLE, etat)
        await tv_etat.diffusion.diffuser(etat)


@app.get("/api/sanctuaire")
def sanctuaire_lire():
    # Un MJ invité le lit tel que les joueurs le voient : sans les notes du MJ ni les bâtiments cachés.
    if cloisonnement.est_invite() and cloisonnement.refuse("sanctuaire-entier"):
        return tv_cartes.reponse_publique(sanctuaire.sanctuaire_public(lire_sanctuaire()))
    return lire_sanctuaire()


@app.put("/api/sanctuaire")
async def sanctuaire_changer(requete: Request):
    corps = await utilitaires.corps_objet(requete)
    with VERROU_SANCTUAIRE:
        disque = lire_sanctuaire(strict=True)
        if corps.get("version_base") != disque.get("modifie"):
            raise HTTPException(409, "Le sanctuaire a changé depuis un autre écran.")
        try:
            s = enregistrer_sanctuaire(sanctuaire.sanctuaire_valide(corps, disque))
        except ValueError as err:
            raise HTTPException(409, str(err))
    await annoncer_sanctuaire()
    return s


def ouvrir_chantier(type_, cache: bool, par: str = "") -> tuple[dict, dict]:
    """Le cœur de POST /api/sanctuaire/batiments, partagé avec la boîte du MJ (un projet de joueur accepté) : un bâtiment
    du catalogue, au niveau 0, sur une place libre du village. Rend (le sanctuaire, le bâtiment)."""
    with VERROU_SANCTUAIRE:
        s = lire_sanctuaire(strict=True)
        t = next((x for x in s.get("catalogue", []) if x.get("type") == type_), None)
        if not t:
            raise HTTPException(404, "Ce bâtiment n'est pas au catalogue")
        if t.get("unique") and any(b.get("type") == t["type"] for b in s.get("batiments", [])):
            raise HTTPException(409, f"« {t['nom']} » est déjà au sanctuaire.")
        if len(s.get("batiments", [])) >= sanctuaire.BATIMENTS_MAX:
            raise HTTPException(413, "Le village est plein")
        x, y = sanctuaire.place_libre(s, t["type"])
        b = {"id": sanctuaire.nouvel_id(s, t["type"]), "type": t["type"], "nom": t["nom"], "niveau": 0, "ruine": False,
             "cache": bool(cache), "x": x, "y": y, "cagnotte": 0, "versements": [], "notes_mj": "", "boutique": ""}
        s.setdefault("batiments", []).append(b)
        sanctuaire.noter(s, f"Chantier ouvert : {t['nom']}{par}.", utilitaires.maintenant())
        return enregistrer_sanctuaire(s), b


@app.post("/api/sanctuaire/batiments")
async def sanctuaire_batir(requete: Request):
    """Ouvre un chantier : un bâtiment du catalogue, au niveau 0, sur une place libre du village."""
    corps = await utilitaires.corps_objet(requete)
    s, b = ouvrir_chantier(corps.get("type"), bool(corps.get("cache")))
    await annoncer_sanctuaire()
    return {"sanctuaire": s, "batiment": b["id"]}


@app.patch("/api/sanctuaire/batiments/{ident}")
async def sanctuaire_corriger(ident: str, requete: Request):
    """Le MJ corrige un bâtiment sans toucher à l'or de personne : niveau (la cagnotte repart de zéro), cagnotte, ruines."""
    corps = await utilitaires.corps_objet(requete)
    with VERROU_SANCTUAIRE:
        s = lire_sanctuaire(strict=True)
        b = next((x for x in s.get("batiments", []) if x.get("id") == ident), None)
        if not b:
            raise HTTPException(404, "Bâtiment introuvable")
        changes = sanctuaire.corriger(s, b, corps)
        if not changes:
            return {"sanctuaire": s}
        sanctuaire.noter(s, f"Le MJ corrige {b.get('nom')} : {', '.join(changes)}.", utilitaires.maintenant())
        s = enregistrer_sanctuaire(s)
    await annoncer_sanctuaire()
    return {"sanctuaire": s}


@app.delete("/api/sanctuaire/batiments/{ident}")
async def sanctuaire_raser(ident: str):
    """Retire un bâtiment du village (l'or versé n'est pas rendu : le MJ le rend à la main s'il le faut)."""
    with VERROU_SANCTUAIRE:
        s = lire_sanctuaire(strict=True)
        b = next((x for x in s.get("batiments", []) if x.get("id") == ident), None)
        if not b:
            raise HTTPException(404, "Bâtiment introuvable")
        s["batiments"] = [x for x in s["batiments"] if x.get("id") != ident]
        sanctuaire.noter(s, f"{b.get('nom')} retiré du village.", utilitaires.maintenant())
        s = enregistrer_sanctuaire(s)
    await annoncer_sanctuaire()
    return {"sanctuaire": s}


def verser_au_sanctuaire(batiment, aventurier: str, montant: int) -> dict:
    """Le cœur de POST /api/sanctuaire/versements, partagé avec la boîte du MJ (le versement d'un joueur accepté) : l'or
    quitte la bourse du héros, la cagnotte monte, le niveau est construit s'il est payé. Jamais plus que ce qui manque au
    niveau, ni plus que l'or du héros (409), relu sous les verrous. Le journal du sanctuaire le note ; « lignes » sont
    celles du journal de la séance, telles que l'onglet Sanctuaire les écrit."""
    chemin = utilitaires.existant(config.AVENTURIERS, aventurier)
    with VERROU_SANCTUAIRE, heros_etat.SAC_VERROU:
        s = lire_sanctuaire(strict=True)
        b = next((x for x in s.get("batiments", []) if x.get("id") == batiment), None)
        if not b:
            raise HTTPException(404, "Bâtiment introuvable")
        n = sanctuaire.prochain(s, b)
        if not n:
            raise HTTPException(409, f"« {b.get('nom')} » est déjà à son plus haut niveau.")
        fiche = utilitaires.lire_fiche(chemin)
        bourse = heros_etat.sac_de(fiche, "or") or 0
        a_prendre = min(montant, max(0, n["cout"] - b.get("cagnotte", 0)))
        if a_prendre > bourse:
            raise HTTPException(409, f"{utilitaires.texte(fiche.get('nom')) or 'Ce héros'} n'a que {bourse} pièce{'s' if bourse > 1 else ''} d'or.")
        quand = utilitaires.maintenant()
        r = sanctuaire.verser(s, b, montant, {"id": fiche.get("id"), "nom": utilitaires.texte(fiche.get("nom"))}, quand)
        lignes = []
        if r["pris"] or r["construit"]:
            if r["pris"]:
                utilitaires.archiver(chemin, "aventuriers")
                fiche["or"] = bourse - r["pris"]
                fiche["modifie"] = quand
                utilitaires.ecrire(chemin, fiche)
                qui = re.split(r"[\s,]+", utilitaires.texte(fiche.get("nom")).strip())[0] or "Un héros"
                sanctuaire.noter(s, f"{qui} verse {r['pris']} po pour {b.get('nom')} ({n['nom']}).", quand)
                lignes.append(f"{qui} verse {r['pris']} po pour {b.get('nom')}.")
            if r["construit"]:
                sanctuaire.noter(s, f"{b.get('nom')} passe au niveau {n['rang']} : {n['nom']}.", quand)
                lignes.append(f"{b.get('nom')} passe au niveau {n['rang']} : {n['nom']}.")
            s = enregistrer_sanctuaire(s)
    return {"sanctuaire": s, "pris": r["pris"], "construit": r["construit"], "versement": r["versement"], "or": fiche.get("or"),
            "lignes": lignes}


@app.post("/api/sanctuaire/versements")
async def sanctuaire_verser(requete: Request):
    """Un héros verse de sa bourse dans la cagnotte d'un chantier : l'or quitte son sac, la cagnotte monte, le niveau est
    construit s'il est payé. Jamais plus que ce qui manque au niveau, ni plus que l'or du héros (409)."""
    corps = await utilitaires.corps_objet(requete)
    montant = heros_etat.entier_borne("or", corps.get("or"), 0, sanctuaire.COUT_MAX)
    if montant <= 0:
        raise HTTPException(400, "Un montant en pièces d'or est attendu")
    r = verser_au_sanctuaire(corps.get("batiment"), utilitaires.texte(corps.get("aventurier")), montant)
    await annoncer_sanctuaire()
    return {k: r[k] for k in ("sanctuaire", "pris", "construit", "versement", "or")}


def verser_don(batiment, aventurier: str, montant: int, nom: str = "") -> dict:
    """Comme verser_au_sanctuaire, sans débiter aucune bourse : l'or qu'un héros a gagné entre les séances (une activité
    validée par le MJ, lot D) va tout droit dans la cagnotte d'un chantier. Le donateur est noté comme pour un versement
    (son prénom paraît à la TV), le niveau est bâti s'il est payé ; jamais plus que ce qui manque au niveau (409)."""
    with VERROU_SANCTUAIRE:
        s = lire_sanctuaire(strict=True)
        b = next((x for x in s.get("batiments", []) if x.get("id") == batiment), None)
        if not b:
            raise HTTPException(404, "Bâtiment introuvable")
        n = sanctuaire.prochain(s, b)
        if not n:
            raise HTTPException(409, f"« {b.get('nom')} » est déjà à son plus haut niveau.")
        reste = max(0, n["cout"] - b.get("cagnotte", 0))
        if montant > reste:
            raise HTTPException(409, f"Il ne manque que {reste} po à « {b.get('nom')} ».")
        quand = utilitaires.maintenant()
        r = sanctuaire.verser(s, b, montant, {"id": aventurier, "nom": utilitaires.texte(nom)}, quand)
        if r["versement"]:
            r["versement"]["don"] = True
        qui = re.split(r"[\s,]+", utilitaires.texte(nom).strip())[0] or "Un héros"
        lignes = []
        if r["pris"]:
            sanctuaire.noter(s, f"{qui} apporte {r['pris']} po pour {b.get('nom')} ({n['nom']}), gagnées entre les séances.", quand)
            lignes.append(f"{qui} apporte {r['pris']} po pour {b.get('nom')}.")
        if r["construit"]:
            sanctuaire.noter(s, f"{b.get('nom')} passe au niveau {n['rang']} : {n['nom']}.", quand)
            lignes.append(f"{b.get('nom')} passe au niveau {n['rang']} : {n['nom']}.")
        if r["pris"] or r["construit"]:
            s = enregistrer_sanctuaire(s)
    return {"sanctuaire": s, "pris": r["pris"], "construit": r["construit"], "versement": r["versement"], "lignes": lignes}


@app.delete("/api/sanctuaire/versements/{vid}")
async def sanctuaire_rendre(vid: str):
    """Rend le dernier versement d'un chantier dont le niveau n'est pas encore bâti : l'or revient dans la bourse. Un don
    (l'or d'une activité entre les séances, verser_don) n'était jamais sorti d'une bourse : il quitte la cagnotte sans
    rien créditer."""
    with VERROU_SANCTUAIRE, heros_etat.SAC_VERROU:
        s = lire_sanctuaire(strict=True)
        for b in s.get("batiments", []):
            v = sanctuaire.annuler(b, vid, s)
            if v:
                break
        else:
            raise HTTPException(409, "Ce versement ne se rend plus (un autre est venu après, ou le niveau suivant est entamé).")
        chemin = config.AVENTURIERS / f"{v.get('aventurier')}.json"
        if v.get("don"):
            sanctuaire.noter(s, f"Don retiré : {v.get('or')} po de {v.get('nom')} (gagnées entre les séances).", utilitaires.maintenant())
        else:
            if config.ID_VALIDE.match(v.get("aventurier") or "") and chemin.is_file():
                fiche = utilitaires.lire_fiche(chemin)
                utilitaires.archiver(chemin, "aventuriers")
                fiche["or"] = (heros_etat.sac_de(fiche, "or") or 0) + v.get("or", 0)
                fiche["modifie"] = utilitaires.maintenant()
                utilitaires.ecrire(chemin, fiche)
            sanctuaire.noter(s, f"Versement rendu : {v.get('or')} po à {v.get('nom')}.", utilitaires.maintenant())
        if v.get("recul"):
            sanctuaire.noter(s, f"{b.get('nom')} revient au niveau {v['recul']['rang'] - 1}.", utilitaires.maintenant())
        s = enregistrer_sanctuaire(s)
    await annoncer_sanctuaire()
    return {"sanctuaire": s, "rendu": v}


# Le sanctuaire des joueurs (lot B2, cagnottes.py et sanctuaire_joueurs.py) : la section « sanctuaire » du carnet, quand
# le MJ l'a rendu visible des joueurs, et les versements et projets qu'ils demandent depuis le coin, que le MJ accepte
# dans sa boîte par les cœurs des routes ci-dessus.

def section_du_sanctuaire(candidats: list, retenus: list) -> list | None:
    """La section du carnet (elements_du_carnet) : None quand le sanctuaire est caché aux joueurs, ou illisible."""
    try:
        elements = sanctuaire_joueurs.section(lire_sanctuaire(), tv_cartes.jeton, candidats, retenus, carnet_api.noms_secrets)
        json.dumps(elements, allow_nan=False)
        return elements
    except Exception as err:
        retenus.append("Le sanctuaire : pas dans le carnet, son fichier contient une valeur illisible.")
        if ("sanctuaire", repr(err)) not in carnet_api.ERREURS_DU_CARNET:
            carnet_api.ERREURS_DU_CARNET.add(("sanctuaire", repr(err)))
            config.journal.warning("Carnet des joueurs : le sanctuaire laissé de côté (%r)", err)
        return None


def publier_sanctuaire_au_carnet() -> int:
    """Après un versement ou un projet accepté : la section du sanctuaire tout de suite ; le reste du carnet suit au passage
    suivant de la tâche de fond."""
    with carnet.PUBLICATION:
        if not (carnet_api.carnet_ouvert() and carnet.est_ouvert(config.PROPOSITIONS)):
            return 0
        chemin = config.PROPOSITIONS / carnet.CARNET / f"{cagnottes.SECTION}.json"
        elements = section_du_sanctuaire(noms_caches.secrets_des_joueurs(), [])
        if elements is None:
            existait = chemin.exists()
            chemin.unlink(missing_ok=True)
            return int(existait)
        return int(carnet.ecrire_si_change(chemin, elements))


def seances_de_la_campagne() -> list:
    """Les séances du compte principal : elles rythment la campagne (la période des activités entre deux séances, la
    séance en cours où le sanctuaire se note), quel que soit le MJ qui lit. Les quêtes annexes d'un invité n'y comptent
    pas."""
    return [s for s in utilitaires.lire_tout(config.SEANCES, tout=True) if proprietes.auteur_de(s) == proprietes.PRINCIPAL]


def noter_a_la_seance(lignes: list) -> None:
    """Le journal de la séance en cours, comme noter_au_journal : dans la boucle, sans rien attendre entre la lecture et
    l'écriture. Sans séance ouverte, rien."""
    seance = sanctuaire_joueurs.seance_en_cours(seances_de_la_campagne())
    if not seance or not config.ID_VALIDE.match(utilitaires.texte(seance.get("id"))):
        return
    chemin = config.SEANCES / f"{seance['id']}.json"
    if not chemin.is_file():
        return
    fiche = utilitaires.lire_fiche(chemin)
    journal_seance = fiche.get("journal") if isinstance(fiche.get("journal"), list) else []
    for ligne in lignes:
        contenu = " ".join(utilitaires.texte(ligne).split())[:seances_api.JOURNAL_LIGNE_MAX]
        if contenu:
            journal_seance.append({"id": secrets.token_hex(4), "t": datetime.now().strftime("%H:%M"), "texte": contenu})
    fiche["journal"] = journal_seance
    utilitaires.ecrire(chemin, fiche)


def empreinte_du_sanctuaire():
    try:
        st = SANCTUAIRE.stat()
    except OSError:
        return None
    return (st.st_mtime_ns, st.st_size, st.st_ino)


# L'adresse de chaque écran venu d'Internet, pour qu'une seule n'occupe pas toute la table publique.
ADRESSES_DES_ECRANS: dict[WebSocket, str] = {}


@app.websocket("/ws/table")
async def ws_table(ws: WebSocket):
    internet = portier.acces_table_seule(ws.headers)
    ecrans = tv_etat.diffusion.internet if internet else tv_etat.diffusion.salon
    await ws.accept()
    # Compté juste après l'acceptation, sans attente entre les deux : des connexions simultanées ne passent pas la limite.
    adresse = ws.headers.get("cf-connecting-ip") or (ws.client.host if ws.client else "?")
    if internet and (len(ecrans) >= config.ECRANS_MAX
                     or sum(1 for a in ADRESSES_DES_ECRANS.values() if a == adresse) >= config.ECRANS_PAR_ADRESSE):
        await ws.close(code=1013)
        return
    ecrans.add(ws)
    if internet:
        ADRESSES_DES_ECRANS[ws] = adresse
    try:
        public = tv_etat.etat_public(tv_ecran.etat_table())
        await ws.send_text(json.dumps({"type": "etat", "etat": tv_etat.etat_internet(public) if internet else public}, ensure_ascii=False))
        while True:
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=45)
            except asyncio.TimeoutError:
                await ws.send_text('{"type":"ping"}')
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        ecrans.discard(ws)
        ADRESSES_DES_ECRANS.pop(ws, None)


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import portier, utilitaires, seances_api, heros_etat, carnet_api, noms_caches, tv_cartes, tv_etat, tv_ecran  # noqa: E402
