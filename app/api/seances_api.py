"""Le journal de séance et le combat en cours."""

import json
import re
import secrets
import time
from datetime import datetime

from fastapi import HTTPException, Request

from mj import adresses
from mj import proprietes

from api.application import app


JOURNAL_LIGNE_MAX = 2000


@app.post("/api/seances/{ident}/journal")
async def noter_au_journal(ident: str, requete: Request):
    """Ajoute une ligne au journal de la séance, à l'heure du serveur. Comme pour les illustrations, la version de la
    fiche ne bouge pas : l'écran qui l'a ouverte continue d'enregistrer le reste sans conflit."""
    chemin = utilitaires.existant(config.SEANCES, ident)
    contenu = " ".join(utilitaires.texte((await utilitaires.corps_objet(requete)).get("texte")).split())
    if not contenu:
        raise HTTPException(400, "Ligne vide")
    if len(contenu) > JOURNAL_LIGNE_MAX:
        raise HTTPException(413, "Ligne trop longue")
    seance = utilitaires.lire_fiche(chemin)
    lignes = seance.get("journal") if isinstance(seance.get("journal"), list) else []
    lignes.append({"id": secrets.token_hex(4), "t": datetime.now().strftime("%H:%M"), "texte": contenu})
    seance["journal"] = lignes
    utilitaires.ecrire(chemin, seance)
    return seance


@app.delete("/api/seances/{ident}/journal/{ligne}")
async def retirer_du_journal(ident: str, ligne: str, texte_ligne: str = ""):
    """Retire une ligne, désignée par son identifiant. Une ligne d'avant les identifiants se désigne par sa place
    (« n3 ») et son texte : si un autre écran a changé le journal entre-temps, rien n'est retiré à l'aveugle.
    En async, comme l'ajout : lecture et écriture se suivent sans qu'un autre envoi passe entre les deux."""
    chemin = utilitaires.existant(config.SEANCES, ident)
    seance = utilitaires.lire_fiche(chemin)
    lignes = seance.get("journal") if isinstance(seance.get("journal"), list) else []
    rang = next((i for i, j in enumerate(lignes) if isinstance(j, dict) and j.get("id") == ligne), None)
    ancienne = re.fullmatch(r"n(\d+)", ligne)
    if rang is None and ancienne and int(ancienne[1]) < len(lignes):
        j = lignes[int(ancienne[1])]
        if isinstance(j, dict) and not j.get("id") and j.get("texte") == texte_ligne:
            rang = int(ancienne[1])
    if rang is None:
        raise HTTPException(404, "Cette ligne n'est plus dans le journal : il a changé depuis un autre écran")
    utilitaires.archiver(chemin, "seances")
    del lignes[rang]
    seance["journal"] = lignes
    utilitaires.ecrire(chemin, seance)
    return seance


# Le combat en cours d'une séance, tenu par le MJ (combats/combat.js) : l'ordre du tour, la Santé de chacun, la Psy et
# les cartons des héros, le point strat et le sablier. Comme le journal, il ne s'écrit que par ses routes : la version
# de la séance ne bouge pas, et l'onglet Séances resté ouvert ne l'efface pas en enregistrant la fiche entière. Sa
# propre version (« modifie ») départage deux écrans. Rien de lui ne va à la TV sans le geste du MJ (« Montrer l'ordre à
# la TV »), et alors seulement ce que filtre combat_public.
COMBAT_MAX = 200_000
SABLIER_MAX = 600
TYPES_COMBAT = {"rencontre": str, "nom": str, "debut": str, "avant": int, "moral": bool, "tour": int, "actif": int,
                "ordre": list, "heros": list, "adversaires": list, "strat": bool, "par": str}
ID_COMBAT = re.compile(r"^[a-z0-9]{1,16}$")
# L'écran qui a écrit le combat en dernier : l'atelier dit « La télécommande a déjà passé la main » quand c'est elle.
# « joueur » : un geste venu du coin (sa Santé, sa Psy, sa posture, son jeton dépensé : heros_etat.ecrire_combat_touche).
ECRANS_COMBAT = ("atelier", "telecommande", "joueur")
# La Psy d'un héros au combat (celle qui lui reste, le maximum de sa fiche) et la Santé prise faute de Psy pour payer un
# don : des entiers de 0 à PSY_MAX. Un combat d'avant la Psy n'en a pas : ils restent absents.
CHAMPS_PSY = ("psy", "psyMax", "santeDon")
PSY_MAX = 999


def combat_de(seance: dict) -> dict | None:
    return seance.get("combat") if isinstance(seance.get("combat"), dict) else None


def heros_combat(h: dict) -> dict:
    """Un héros du combat, ses champs de Psy bornés (un nombre est attendu)."""
    h = dict(h)
    # Le jeton du kit : "" quand il a été joué (l'état du héros le perd aussi), une valeur inconnue ne s'enregistre pas.
    if "avantage" in h and h["avantage"] not in (*heros_etat.AVANTAGES, ""):
        h.pop("avantage")
    for cle in CHAMPS_PSY:
        if cle not in h:
            continue
        v = h[cle]
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise HTTPException(400, f"Champ « {cle} » invalide")
        h[cle] = int(round(min(PSY_MAX, max(0, v))))
    return h


def combat_valide(corps: dict) -> dict:
    """Le combat tel qu'il s'enregistre : les seuls champs connus, chacun de son type. Le sablier reçu sans fin part
    maintenant, à l'heure du serveur."""
    combat = {}
    for cle, genre in TYPES_COMBAT.items():
        v = corps.get(cle)
        if v is None:
            continue
        if genre is int:
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                raise HTTPException(400, f"Champ « {cle} » invalide")
            v = int(v)
        elif not isinstance(v, genre):
            raise HTTPException(400, f"Champ « {cle} » invalide")
        combat[cle] = v
    if not all(isinstance(x, str) for x in combat.get("ordre", [])):
        raise HTTPException(400, "Champ « ordre » invalide")
    if not all(isinstance(x, dict) for x in combat.get("heros", []) + combat.get("adversaires", [])):
        raise HTTPException(400, "Combattant invalide")
    if "heros" in combat:
        combat["heros"] = [heros_combat(h) for h in combat["heros"]]
    if combat.get("par") not in ECRANS_COMBAT:
        combat.pop("par", None)
    ident = utilitaires.texte(corps.get("id"))
    combat["id"] = ident if ID_COMBAT.match(ident) else secrets.token_hex(4)
    sablier = corps.get("sablier")
    combat["sablier"] = None
    if isinstance(sablier, dict):
        duree = int(min(SABLIER_MAX, max(5, utilitaires.nombre(sablier.get("duree"), 60))))
        fin = sablier.get("fin")
        if isinstance(fin, bool) or not isinstance(fin, (int, float)):
            fin = time.time() + duree
        combat["sablier"] = {"duree": duree, "fin": float(fin)}
    return combat


def reponse_combat(ident: str, seance: dict) -> dict:
    # « horloge » : l'heure du serveur, pour que l'écran du MJ compte le sablier comme lui.
    return {"combat": combat_de(seance), "tv": tv_ecran.etat_table().get("combat") == ident, "horloge": time.time()}


async def combat_sur_tv(ident: str, combat: dict | None) -> None:
    """Le combat que montre la TV a changé : elle relit son bandeau, ou le retire (combat fini ou remplacé)."""
    etat = tv_ecran.etat_table()
    if etat.get("combat") != ident:
        return
    if combat:
        etat["combat_maj"] = combat.get("modifie")
    else:
        etat.pop("combat", None)
        etat.pop("combat_maj", None)
    etat["maj"] = time.time()
    utilitaires.ecrire(config.TABLE, etat)
    await tv_etat.diffusion.diffuser(etat)


@app.get("/api/seances/{ident}/combat")
def lire_combat(ident: str):
    return reponse_combat(ident, utilitaires.lire_fiche(utilitaires.existant(config.SEANCES, ident)))


@app.put("/api/seances/{ident}/combat")
async def enregistrer_combat(ident: str, requete: Request):
    """Commence ou tient le combat de la séance. La version d'avant (version_base, null pour un premier combat) doit
    être celle du serveur : sinon 409, et l'écran fusionne. Un autre combat (autre id) remplace celui-ci et quitte la TV."""
    chemin = utilitaires.existant(config.SEANCES, ident)
    corps = await utilitaires.corps_objet(requete)
    if len(json.dumps(corps, ensure_ascii=False)) > COMBAT_MAX:
        raise HTTPException(413, "Combat trop volumineux")
    seance = utilitaires.lire_fiche(chemin)
    actuel = combat_de(seance)
    if corps.pop("version_base", None) != (actuel or {}).get("modifie"):
        raise HTTPException(409, "Ce combat a changé depuis un autre écran.")
    combat = combat_valide(corps)
    remplace = bool(actuel) and actuel.get("id") != combat["id"]
    combat["modifie"] = utilitaires.maintenant()
    seance["combat"] = combat
    utilitaires.ecrire(chemin, seance)
    # Le héros qui prend la main commence son tour là où est son pion (ses déplacements depuis le coin s'y comptent), et la
    # table du coin dit à qui c'est le tour, même quand la TV ne montre pas l'ordre.
    tv_etat.mouvements_joueurs.tour_change(combat)
    tv_etat.table_coin.signaler()
    jauges = heros_etat.etat_depuis_combat(combat)
    await combat_sur_tv(ident, None if remplace else combat)
    await tv_etat.diffusion.signaler_combat(ident, combat)
    postures = lambda c: {h.get("id"): h.get("posture") for h in (c or {}).get("heros") or [] if isinstance(h, dict)}  # noqa: E731
    if jauges or postures(actuel) != postures(combat):
        await heros_etat.fiches_tv_a_jour()
    return reponse_combat(ident, seance)


@app.delete("/api/seances/{ident}/combat")
async def finir_combat(ident: str):
    chemin = utilitaires.existant(config.SEANCES, ident)
    seance = utilitaires.lire_fiche(chemin)
    fini = combat_de(seance)
    if fini:
        utilitaires.archiver(chemin, "seances")
        seance["combat"] = None
        utilitaires.ecrire(chemin, seance)
    await combat_sur_tv(ident, None)
    if fini:
        await tv_etat.diffusion.signaler_combat(ident, None)
        # Hors combat, les joueurs bougent de nouveau sans attendre leur tour (table du coin, lot E2).
        tv_etat.table_coin.signaler()
    # Hors combat, un héros reprend la posture de sa fiche : la TV qui montre un plan relit ses pions.
    if fini and fini.get("heros"):
        await heros_etat.fiches_tv_a_jour()
    # Le combat tel qu'il était : l'écran qui l'a fini peut le rouvrir quelques secondes (« Rouvrir le combat »).
    return reponse_combat(ident, seance) | {"fini": fini}


# Hors de /api/table/… : depuis Internet, la garde la refuse (seules les lectures de la table y passent).
@app.put("/api/seances/{ident}/combat/tv")
async def montrer_combat(ident: str, requete: Request):
    chemin = utilitaires.existant(config.SEANCES, ident)
    corps = await utilitaires.corps_objet(requete)
    if not isinstance(corps.get("montrer"), bool):
        raise HTTPException(400, "Champ « montrer » attendu : vrai ou faux")
    seance = utilitaires.lire_fiche(chemin)
    combat = combat_de(seance)
    etat = tv_ecran.etat_table()
    if corps["montrer"]:
        if not combat:
            raise HTTPException(404, "Aucun combat en cours dans cette séance")
        # Montrer l'ordre de son combat, c'est prendre la main sur la TV ; le retirer ne la prend pas.
        if etat.get("combat") != ident:
            question = tv_ecran.question_de_la_main(etat, corps.get("reprendre") is True)
            if question is not None:
                return question
            adresses.poser_par(etat, proprietes.compte_courant())
        etat["combat"], etat["combat_maj"] = ident, combat.get("modifie")
    elif etat.get("combat") == ident:
        etat.pop("combat", None)
        etat.pop("combat_maj", None)
    else:
        return reponse_combat(ident, seance) | tv_ecran.ecrans_branches()
    etat["maj"] = time.time()
    utilitaires.ecrire(config.TABLE, etat)
    await tv_etat.diffusion.diffuser(etat)
    return reponse_combat(ident, seance) | tv_ecran.ecrans_branches()


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import config, utilitaires, heros_etat, tv_etat, tv_ecran  # noqa: E402
