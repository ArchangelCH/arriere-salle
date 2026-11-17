"""L'état du moment des héros (Santé, Psy, cartons) et leur sac."""

import threading

from fastapi import HTTPException, Request

from mj import cloisonnement
from mj import proprietes

from api.application import app
from api import config


# L'état du moment de chaque héros, d'un combat et d'une scène à l'autre : la Santé et la Psy qui lui restent, la Santé
# payée faute de Psy (santeDon, elle ne revient qu'après une journée entière de repos), ses cartons et une note du MJ
# (« empoisonné »). Rangé à part de la fiche, qui garde ses maximums : un champ absent veut dire au maximum, un héros
# absent en pleine forme. Chaque écriture ne vise qu'un héros et ne change que les champs envoyés : le Mac et l'iPad
# notent en même temps sans conflit. Le combat en cours le tient à jour à chaque enregistrement (une seule vérité) :
# pendant ce temps, la Santé, la Psy, les cartons et le jeton d'avantage d'un héros qui s'y bat ne changent que là.
# Vers la TV ne partent que la Santé et la Psy du moment dans les fiches de la tablée (fiche_publique), et les jauges des
# pions des héros sur un plan (jauges_pion) ; jamais la note.
ETATS_HEROS = config.DONNEES / "etats-heros.json"
CHAMPS_ETAT = ("sante", "psy", "santeDon", "cartons", "avantage", "notes")
CHAMPS_DU_COMBAT = ("sante", "psy", "santeDon", "cartons", "avantage")
CARACS_ETAT = ("physique", "social", "mental")
CARTONS_ETAT = ("jaune", "rouge")
# Le jeton du kit : un seul à la fois, un avantage et un désavantage s'annulent (absent : aucun).
AVANTAGES = ("avantage", "desavantage")
# La posture d'un héros sur son pion : celle du combat en cours, sinon celle de sa fiche (postures_au_combat). Elle ne
# s'écrit pas dans l'état : un héros en pleine forme n'en a pas.
POSTURES_ETAT = ("offensive", "defensive", "focus")
SANTE_ETAT_MAX = 999
NOTES_ETAT_MAX = 300


def etats_heros(strict: bool = False) -> dict:
    """Les états, par identifiant d'aventurier. Un fichier illisible se lit vide, mais strict (avant d'écrire) refuse :
    il ne doit pas être écrasé."""
    try:
        etats = utilitaires.lire(ETATS_HEROS)
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as err:
        if strict:
            raise HTTPException(500, "Fichier illisible : etats-heros.json")
        config.journal.warning("État des héros illisible : %s", err)
        return {}
    if not isinstance(etats, dict):
        if strict:
            raise HTTPException(500, "Fichier invalide : etats-heros.json")
        return {}
    return {k: v for k, v in etats.items() if isinstance(k, str) and config.ID_VALIDE.match(k) and isinstance(v, dict)}


def entier_borne(cle: str, v, bas: int, haut: int) -> int:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
        raise HTTPException(400, f"Champ « {cle} » invalide")
    return int(round(min(haut, max(bas, v))))


def champs_etat(corps: dict) -> dict:
    """Les champs reçus, chacun de son type. None remet un champ au maximum (il disparaît) ; les cartons se fusionnent
    caractéristique par caractéristique, un carton vide ou inconnu retire le sien."""
    champs = {}
    for cle in CHAMPS_ETAT:
        if cle not in corps:
            continue
        v = corps[cle]
        if v is None:
            champs[cle] = None
        elif cle == "sante":
            champs[cle] = entier_borne(cle, v, -SANTE_ETAT_MAX, SANTE_ETAT_MAX)
        elif cle in ("psy", "santeDon"):
            champs[cle] = entier_borne(cle, v, 0, seances_api.PSY_MAX)
        elif cle == "cartons":
            if not isinstance(v, dict):
                raise HTTPException(400, "Champ « cartons » invalide")
            champs[cle] = {k: (c if c in CARTONS_ETAT else None) for k, c in v.items() if k in CARACS_ETAT}
        elif cle == "avantage":
            if v not in (*AVANTAGES, ""):
                raise HTTPException(400, "Champ « avantage » invalide")
            champs[cle] = v or None
        else:
            if not isinstance(v, str):
                raise HTTPException(400, "Champ « notes » invalide")
            if len(v) > NOTES_ETAT_MAX:
                raise HTTPException(413, "Note trop longue")
            champs[cle] = " ".join(v.split())
    return champs


def poser_etat(etats: dict, ident: str, champs: dict) -> bool:
    """Fusionne les champs dans l'état du héros ; vrai s'il a changé. Un état revenu à rien disparaît."""
    avant = {k: v for k, v in (etats.get(ident) or {}).items() if k in CHAMPS_ETAT}
    apres = dict(avant)
    for cle, v in champs.items():
        if cle == "cartons" and v is not None:
            cartons = dict(apres["cartons"]) if isinstance(apres.get("cartons"), dict) else {}
            for k, c in v.items():
                if c:
                    cartons[k] = c
                else:
                    cartons.pop(k, None)
            v = cartons
        if v is None or v == "" or v == {} or (cle == "santeDon" and v == 0):
            apres.pop(cle, None)
        else:
            apres[cle] = v
    if apres == avant:
        return False
    if apres:
        etats[ident] = {**apres, "modifie": utilitaires.maintenant()}
    else:
        etats.pop(ident, None)
    return True


def enregistrer_etats(etats: dict) -> None:
    utilitaires.archiver(ETATS_HEROS, "etats-heros")
    utilitaires.ecrire(ETATS_HEROS, etats)


def etat_depuis_combat(combat: dict) -> bool:
    """Le combat enregistré tient l'état de ses héros : Santé et Psy (retirées au maximum), Santé payée en dons, cartons,
    jeton d'avantage. Un combat d'avant le suivi de la Psy n'y touche pas. Vrai si ce que montre la TV a changé : Santé,
    Psy, cartons ou jeton (les fiches de la tablée, les pions des plans)."""
    changements = []
    for h in combat.get("heros") or []:
        ident = h.get("id")
        if not isinstance(ident, str) or not config.ID_VALIDE.match(ident) or not (config.AVENTURIERS / f"{ident}.json").is_file():
            continue
        champs = {}
        for cle, maximum in (("sante", "max"), ("psy", "psyMax"), ("santeDon", None)):
            v = h.get(cle)
            if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
                continue
            m = h.get(maximum) if maximum else None
            plein = isinstance(m, (int, float)) and not isinstance(m, bool) and v >= m
            champs[cle] = None if plein else int(round(min(SANTE_ETAT_MAX, max(-SANTE_ETAT_MAX, v))))
        if isinstance(h.get("cartons"), dict):
            champs["cartons"] = {k: (h["cartons"].get(k) if h["cartons"].get(k) in CARTONS_ETAT else None) for k in CARACS_ETAT}
        if "avantage" in h:
            champs["avantage"] = h["avantage"] if h["avantage"] in AVANTAGES else None
        changements.append((ident, champs))
    if not changements:
        return False
    try:
        etats = etats_heros(strict=True)
    except HTTPException:
        config.journal.warning("État des héros illisible : le combat ne le tient pas à jour")
        return False
    avant = {i: dict(etats.get(i) or {}) for i, _ in changements}
    change = False
    for i, c in changements:
        change = poser_etat(etats, i, c) or change
    if not change:
        return False
    enregistrer_etats(etats)
    return any(avant[i].get(k) != (etats.get(i) or {}).get(k) for i in avant for k in CHAMPS_TV_ETAT)


def postures_au_combat() -> dict:
    """La posture de chaque héros d'un combat en cours (le premier combat trouvé l'emporte)."""
    postures = {}
    for s in utilitaires.lire_tout(config.SEANCES, tout=True):
        for h in (seances_api.combat_de(s) or {}).get("heros") or []:
            if isinstance(h, dict) and isinstance(h.get("id"), str) and h.get("posture") in POSTURES_ETAT:
                postures.setdefault(h["id"], h["posture"])
    return postures


def heros_au_combat() -> dict:
    """Les héros d'un combat en cours, avec sa séance et son nom : leur Santé, leur Psy et leurs cartons se changent là,
    quel que soit le MJ qui le mène. Une séance d'un autre que le principal porte « auteur » : ce qui en sort vers un MJ
    passe par au_combat_vu."""
    au_combat = {}
    for s in utilitaires.lire_tout(config.SEANCES, tout=True):
        c = seances_api.combat_de(s)
        for h in (c or {}).get("heros") if isinstance((c or {}).get("heros"), list) else []:
            if isinstance(h, dict) and isinstance(h.get("id"), str):
                vu = {"seance": s.get("id"), "combat": utilitaires.texte(c.get("nom"))}
                if proprietes.auteur_de(s) != proprietes.PRINCIPAL:
                    vu["auteur"] = proprietes.auteur_de(s)
                au_combat.setdefault(h["id"], vu)
    return au_combat


AUTRE_COMBAT = "un combat de l'autre MJ"


def au_combat_vu(au_combat: dict) -> dict:
    """Les héros au combat, pour le MJ qui lit : la séance et le nom d'un combat de l'autre MJ ne sortent pas."""
    sortie = {}
    for ident, c in au_combat.items():
        if cloisonnement.permis_auteur("seances", c.get("auteur") or proprietes.PRINCIPAL):
            sortie[ident] = {k: v for k, v in c.items() if k != "auteur"}
        else:
            sortie[ident] = {"seance": None, "combat": AUTRE_COMBAT}
    return sortie


# Ce que la TV montre de l'état d'un héros : un changement d'un de ces champs la fait relire.
CHAMPS_TV_ETAT = ("sante", "psy", "cartons", "avantage")


async def fiches_tv_a_jour() -> None:
    """La TV relit l'état des héros : les fiches de la tablée (Santé et Psy du moment), ou le plan, dont les pions des
    héros portent leurs jauges (la version du plan en tient compte)."""
    etat = tv_ecran.etat_table()
    if etat.get("vue") in ("fiches", "plan"):
        await tv_etat.diffusion.diffuser(etat)


# Hors de /api/table/… : depuis Internet, la garde les refuse.
@app.get("/api/etats-heros")
def lire_etats_heros():
    return {"etats": etats_heros(), "au_combat": au_combat_vu(heros_au_combat())}


def etat_comme_lu(etat: dict, attendu: dict) -> bool:
    """Les champs de l'état ont-ils encore les valeurs que l'écran a lues (absent ou None : au maximum, sans carton,
    sans note) ? Les cartons se comparent caractéristique par caractéristique."""
    for cle, v in attendu.items():
        actuel = etat.get(cle)
        if cle == "cartons":
            cartons = actuel if isinstance(actuel, dict) else {}
            vus = v if v is not None else {k: None for k in CARACS_ETAT}
            if any((cartons.get(k) if cartons.get(k) in CARTONS_ETAT else None) != c for k, c in vus.items()):
                return False
        elif cle in ("santeDon", "notes", "avantage"):
            if (actuel or None) != (v or None):
                return False
        elif actuel != v:
            return False
    return True


@app.patch("/api/etats-heros/{ident}")
async def changer_etat_heros(ident: str, requete: Request):
    """Change quelques champs de l'état d'un héros, à fusionner avec ce qu'un autre écran a noté. En async : lecture et
    écriture se suivent sans qu'un autre envoi passe entre les deux. Avec « avant » (les valeurs lues par l'écran pour
    un repos, calculé sur elles) : 409 si un autre écran les a changées entre-temps, l'écran relit et recalcule."""
    utilitaires.existant(config.AVENTURIERS, ident)
    corps = await utilitaires.corps_objet(requete)
    if "avant" in corps and not isinstance(corps["avant"], dict):
        raise HTTPException(400, "Champ « avant » invalide")
    attendu = champs_etat(corps["avant"]) if "avant" in corps else None
    champs = champs_etat(corps)
    au_combat = heros_au_combat()
    if ident in au_combat and set(champs) & set(CHAMPS_DU_COMBAT):
        raise HTTPException(409, "Ce héros se bat : sa Santé, sa Psy et ses cartons se changent dans le combat.")
    etats = etats_heros(strict=True)
    avant = dict(etats.get(ident) or {})
    if attendu is not None and not etat_comme_lu(avant, attendu):
        raise HTTPException(409, "L'état de ce héros vient de changer sur un autre écran.")
    if poser_etat(etats, ident, champs):
        enregistrer_etats(etats)
        if any(avant.get(k) != (etats.get(ident) or {}).get(k) for k in CHAMPS_TV_ETAT):
            await fiches_tv_a_jour()
    return {"etat": etats.get(ident) or {}, "au_combat": au_combat_vu(au_combat)}


# Le sac d'un aventurier (or, équipement, objets personnels), tenu pendant la séance sans renvoyer la fiche entière.
# Chaque champ part avec sa valeur d'avant : si ce n'est plus celle du serveur (un autre écran, une fiche ouverte dans
# l'onglet Aventuriers), refus 409 et l'écran rejoue son geste sur la fiche relue ; déjà appliqué (un nouvel essai après
# une réponse perdue), rien ne change. Les objets personnels restent trois cases, vides comprises.
SAC_LIGNES_MAX = 80
SAC_LIGNE_MAX = 300
OR_MAX = 10_000_000


def sac_de(fiche: dict, cle: str):
    """Un champ du sac tel qu'il se compare : l'or en entier (ou None), les listes en textes, les objets en trois cases."""
    v = fiche.get(cle)
    if cle == "or":
        return int(round(v)) if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v else None
    liste = [x if isinstance(x, str) else utilitaires.texte(x) for x in v] if isinstance(v, list) else []
    return (liste + ["", "", ""])[:max(3, len(liste))] if cle == "objets" else liste


def sac_valide(cle: str, v, avant: bool):
    if cle == "or":
        if v is None and avant:
            return None
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v < 0:
            raise HTTPException(400, "Pas d'or en dessous de zéro")
        return entier_borne("or", v, 0, OR_MAX)
    if not isinstance(v, list) or len(v) > SAC_LIGNES_MAX or not all(isinstance(x, str) for x in v):
        raise HTTPException(400, f"Champ « {cle} » invalide")
    if any(len(x) > SAC_LIGNE_MAX for x in v):
        raise HTTPException(413, "Ligne trop longue")
    return sac_de({cle: v}, cle)


# Une écriture de sac à la fois : la route (dans la boucle) et la boîte du MJ (« Annuler », « Accepter » un don d'or,
# dans un fil à part) ne se croisent pas entre la lecture d'une fiche et son écriture.
SAC_VERROU = threading.RLock()


def changer_les_sacs(corps_par_heros: dict) -> dict:
    """Le cœur de la route du sac, partagé avec la file des joueurs (sacs.py) : {id du héros : {champ : {avant, apres}}}.
    Tout ou rien : chaque sac est lu et vérifié avant que le premier ne s'écrive ; si l'un a changé, rien ne bouge (409).
    Rend {id : la fiche entière}, que seul l'atelier lit."""
    with SAC_VERROU:
        lus = []
        for ident, corps in corps_par_heros.items():
            chemin = utilitaires.existant(config.AVENTURIERS, ident)
            fiche = utilitaires.lire_fiche(chemin)
            changes = {}
            for cle in ("or", "equipement", "objets"):
                if cle not in corps:
                    continue
                v = corps[cle]
                if not isinstance(v, dict) or "avant" not in v or "apres" not in v:
                    raise HTTPException(400, f"Champ « {cle} » invalide : avant et après attendus")
                avant, apres = sac_valide(cle, v["avant"], True), sac_valide(cle, v["apres"], False)
                actuel = sac_de(fiche, cle)
                if actuel == apres:
                    continue
                if actuel != avant:
                    raise HTTPException(409, "Le sac a changé depuis un autre écran.")
                changes[cle] = apres
            lus.append((ident, chemin, fiche, changes))
        for _, chemin, fiche, changes in lus:
            if changes:
                utilitaires.archiver(chemin, "aventuriers")
                fiche.update(changes)
                fiche["modifie"] = utilitaires.maintenant()
                utilitaires.ecrire(chemin, fiche)
        return {ident: fiche for ident, _, fiche, _ in lus}


@app.patch("/api/aventuriers/{ident}/sac")
async def changer_sac(ident: str, requete: Request):
    utilitaires.existant(config.AVENTURIERS, ident)
    corps = await utilitaires.corps_objet(requete)
    fiche = changer_les_sacs({ident: corps})[ident]
    # Commune aux deux MJ : l'invité en relit la projection, sans les secrets du héros.
    if cloisonnement.est_invite() and cloisonnement.refuse("fiche-commune-entiere", "aventuriers"):
        return tv_fiches.heros_pour_l_invite(fiche)
    return fiche


# ---------------------------------------------------------------- les gestes des joueurs depuis le coin
#
# Depuis la table du coin, un joueur règle la Santé, la Psy et la posture de son héros (etat_joueur.py), et dépense son
# jeton d'avantage pour un test ou pour changer la face d'un dé d'aventure (jets_mj.py). La boîte des demandes applique ces
# gestes dans la boucle d'événements, là où vit l'état : le combat en cours si le héros s'y bat (une seule vérité, comme
# pour le MJ), sinon l'état des héros, et sa fiche pour la posture. Le combat est écrit comme par un autre écran (« par »
# vaut « joueur », sa version monte) : l'écran du MJ le relit et fusionne, comme avec la télécommande.

ECRAN_JOUEUR = "joueur"
# Les séances dont un geste de joueur a changé le combat : leurs écrans sont prévenus hors du verrou (suites_des_joueurs).
COMBATS_TOUCHES: set[str] = set()


def combat_du_heros(ident: str):
    """(chemin de la séance, séance, combat, héros dans le combat) du combat en cours où ce héros se bat, quel que soit
    le MJ qui le mène ; None s'il ne se bat pas. La séance est relue de son fichier, prête à être réécrite."""
    for s in utilitaires.lire_tout(config.SEANCES, tout=True):
        c = seances_api.combat_de(s)
        if not c or not isinstance(c.get("heros"), list) or not isinstance(s.get("id"), str):
            continue
        if not any(isinstance(h, dict) and h.get("id") == ident for h in c["heros"]):
            continue
        chemin = utilitaires.fichier(config.SEANCES, s["id"])
        seance = utilitaires.lire_fiche(chemin)
        combat = seances_api.combat_de(seance)
        h = next((x for x in (combat or {}).get("heros") or [] if isinstance(x, dict) and x.get("id") == ident), None)
        if h is not None:
            return chemin, seance, combat, h
    return None


def ecrire_combat_touche(chemin, seance: dict, combat: dict) -> None:
    """Le combat changé par un joueur : sa version monte, l'état des héros le suit, ses écrans seront prévenus."""
    combat["modifie"] = utilitaires.maintenant()
    combat["par"] = ECRAN_JOUEUR
    seance["combat"] = combat
    utilitaires.ecrire(chemin, seance)
    etat_depuis_combat(combat)
    COMBATS_TOUCHES.add(seance["id"])


def nombre(v, defaut):
    return defaut if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v else int(round(v))


def jeton_depense(ident: str, jeton: str) -> bool:
    """Le jeton d'avantage (ou de désavantage) qu'un héros dépense : retiré de là où il vit, s'il le porte encore. En combat,
    du combat ; sinon de l'état du héros. Vrai s'il y était."""
    ici = combat_du_heros(ident)
    if ici is not None:
        chemin, seance, combat, h = ici
        if h.get("avantage") != jeton:
            return False
        h["avantage"] = ""
        ecrire_combat_touche(chemin, seance, combat)
        return True
    try:
        etats = etats_heros(strict=True)
    except HTTPException:
        return False
    if (etats.get(ident) or {}).get("avantage") != jeton or not poser_etat(etats, ident, {"avantage": None}):
        return False
    enregistrer_etats(etats)
    return True


def change_par_son_joueur(ident: str, corps: dict) -> dict:
    """Le geste d'un joueur sur son héros (etat_joueur.valider) : des points de Santé ou de Psy, ou sa posture. Rend
    {vitalite, posture, combat, avant, apres}. Lève demandes.Refus avec la phrase pour le joueur."""
    try:
        fiche = utilitaires.lire_fiche(utilitaires.existant(config.AVENTURIERS, ident))
    except HTTPException:
        raise demandes.Refus(409, etat_joueur.ABSENT)
    ici = combat_du_heros(ident)
    posture_fiche = fiche.get("posture") if fiche.get("posture") in POSTURES_ETAT else ""
    if ici is not None:
        chemin, seance, combat, h = ici
        psy_max = nombre(h.get("psyMax"), nombre(fiche.get("psy"), 0))
        v = etat_joueur.vitalite(nombre(h.get("max"), nombre(fiche.get("sante"), 1)), h.get("sante"), psy_max, h.get("psy"), h.get("santeDon"))
        posture = h.get("posture") if h.get("posture") in POSTURES_ETAT else posture_fiche
        if "posture" in corps:
            avant, apres = posture, corps["posture"]
            if apres != avant:
                h["posture"] = apres
                ecrire_combat_touche(chemin, seance, combat)
            return {"vitalite": v, "posture": apres, "combat": True, "avant": avant, "apres": apres}
        w = etat_joueur.calculer(v, corps["champ"], corps["delta"])
        avant, apres = v[corps["champ"]], w[corps["champ"]]
        if apres != avant:
            if corps["champ"] == "psy":
                h["psy"], h["psyMax"] = apres, psy_max
            else:
                h["sante"] = apres
            ecrire_combat_touche(chemin, seance, combat)
        return {"vitalite": w, "posture": posture, "combat": True, "avant": avant, "apres": apres}
    if "posture" in corps:
        avant, apres = posture_fiche, corps["posture"]
        with SAC_VERROU:
            chemin = utilitaires.existant(config.AVENTURIERS, ident)
            fiche = utilitaires.lire_fiche(chemin)
            if fiche.get("posture") != apres:
                utilitaires.archiver(chemin, "aventuriers")
                fiche["posture"] = apres
                fiche["modifie"] = utilitaires.maintenant()
                utilitaires.ecrire(chemin, fiche)
        etat = etats_heros().get(ident) or {}
        v = etat_joueur.vitalite(fiche.get("sante"), etat.get("sante"), fiche.get("psy"), etat.get("psy"), etat.get("santeDon"))
        return {"vitalite": v, "posture": apres, "combat": False, "avant": avant, "apres": apres}
    try:
        etats = etats_heros(strict=True)
    except HTTPException:
        raise demandes.Refus(409, "L'atelier n'a pas pu le noter : votre MJ regardera.")
    etat = etats.get(ident) or {}
    v = etat_joueur.vitalite(fiche.get("sante"), etat.get("sante"), fiche.get("psy"), etat.get("psy"), etat.get("santeDon"))
    w = etat_joueur.calculer(v, corps["champ"], corps["delta"])
    champ = corps["champ"]
    avant, apres = v[champ], w[champ]
    if apres != avant:
        plein = apres >= (w["sante_max"] if champ == "sante" else w["psy_max"])
        if poser_etat(etats, ident, {champ: None if plein else apres}):
            enregistrer_etats(etats)
    return {"vitalite": w, "posture": posture_fiche, "combat": False, "avant": avant, "apres": apres}


async def suites_des_joueurs() -> None:
    """Hors du verrou de la file, après les gestes des joueurs : l'écran du combat et son bandeau à la TV relisent le
    combat changé, la table du coin dit l'état du moment, et la TV relit les fiches ou les jauges des pions."""
    touches = sorted(COMBATS_TOUCHES)
    COMBATS_TOUCHES.clear()
    for ident in touches:
        try:
            seance = utilitaires.lire_fiche(utilitaires.fichier(config.SEANCES, ident))
        except HTTPException:
            continue
        combat = seances_api.combat_de(seance)
        await seances_api.combat_sur_tv(ident, combat)
        await tv_etat.diffusion.signaler_combat(ident, combat)
    tv_etat.table_coin.signaler()
    await fiches_tv_a_jour()


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from commun import demandes, etat_joueur  # noqa: E402
from api import utilitaires, seances_api, tv_fiches, tv_etat, tv_ecran  # noqa: E402
