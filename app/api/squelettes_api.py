"""Le squelette d'un scénario : à partir d'une idée, trois structures proposées (actes, scènes, fins), rangées à côté de
l'idée. Rien n'est écrit dans un scénario sans le geste du MJ : « Créer le scénario » en fait un NOUVEAU, un chapitre
par acte, une consigne prête sous chaque scène. Le texte du MJ n'est jamais touché."""

import asyncio
import secrets
import time
from pathlib import Path

from fastapi import HTTPException, Request

from campagne import univers
from api.application import app
from api import config, contexte_du_modele, ia_api, utilitaires
from ia import redaction

# Les propositions vivent dans le champ protégé `squelettes` de l'idée (fiches_api.py) : un enregistrement de l'idée
# entière ne les efface pas, et elles ne changent pas sa version (l'écran ouvert continue d'écrire).
CHAMP = "squelettes"
GARDES = 30
TYPES = {"combat": "Combat", "enquete": "Enquête", "social": "Social", "exploration": "Exploration", "autre": "Autre"}
MAX_ACTES, MAX_SCENES, MAX_LISTE = 8, 10, 6


SCHEMA_STRUCTURE = {
    "type": "object", "additionalProperties": False,
    "required": ["titre", "parti_pris", "accroche", "actes", "fins", "questions", "risques"],
    "properties": {
        "titre": {"type": "string"},
        "parti_pris": {"type": "string"},
        "accroche": {"type": "string"},
        "actes": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["titre", "but", "scenes"],
            "properties": {
                "titre": {"type": "string"}, "but": {"type": "string"},
                "scenes": {"type": "array", "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["titre", "type", "enjeu", "sortie", "indices", "pnj", "pnj_a_creer", "lieu"],
                    "properties": {
                        "titre": {"type": "string"}, "type": {"type": "string", "enum": list(TYPES)},
                        "enjeu": {"type": "string"}, "sortie": {"type": "string"}, "lieu": {"type": "string"},
                        "indices": {"type": "array", "items": {"type": "string"}},
                        "pnj": {"type": "array", "items": {"type": "string"}},
                        "pnj_a_creer": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False, "required": ["nom", "role"],
                            "properties": {"nom": {"type": "string"}, "role": {"type": "string"}}}},
                    }}},
            }}},
        "fins": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["titre", "description"],
            "properties": {"titre": {"type": "string"}, "description": {"type": "string"}}}},
        "questions": {"type": "array", "items": {"type": "string"}},
        "risques": {"type": "array", "items": {"type": "string"}},
    },
}
SCHEMA_UNE = {"type": "object", "additionalProperties": False, "required": ["structure"],
              "properties": {"structure": SCHEMA_STRUCTURE}}


# ---------------------------------------------------------------- ce que le modèle rend, remis au propre

def propre(valeur, limite: int) -> str:
    """Une chaîne du modèle : sans consigne ni lien qui se détacherait du texte, finie comme tout texte écrit pour le MJ."""
    t = contexte_du_modele.court(valeur, limite)
    t = t.replace("[[", "(").replace("]]", ")")
    return ia_api.finir_texte(t) if t else ""


def liste(valeurs, limite: int, maximum: int = MAX_LISTE) -> list[str]:
    brut = valeurs if isinstance(valeurs, list) else []
    return [p for p in (propre(v, limite) for v in brut[:maximum]) if p]


def nettoyer_structure(brut) -> dict:
    """Une structure bornée et sans surprise : types connus, longueurs limitées, rien de vide. Refuse ce qui n'a pas d'acte."""
    brut = brut if isinstance(brut, dict) else {}
    actes = []
    for a in (brut.get("actes") if isinstance(brut.get("actes"), list) else [])[:MAX_ACTES]:
        a = a if isinstance(a, dict) else {}
        scenes = []
        for s in (a.get("scenes") if isinstance(a.get("scenes"), list) else [])[:MAX_SCENES]:
            s = s if isinstance(s, dict) else {}
            titre = propre(s.get("titre"), 100)
            if not titre:
                continue
            creer = []
            for p in (s.get("pnj_a_creer") if isinstance(s.get("pnj_a_creer"), list) else [])[:4]:
                p = p if isinstance(p, dict) else {}
                if propre(p.get("nom"), 60):
                    creer.append({"nom": propre(p.get("nom"), 60), "role": propre(p.get("role"), 140)})
            scenes.append({
                "titre": titre, "type": s.get("type") if s.get("type") in TYPES else "autre",
                "enjeu": propre(s.get("enjeu"), 300), "sortie": propre(s.get("sortie"), 300), "lieu": propre(s.get("lieu"), 80),
                "indices": liste(s.get("indices"), 200), "pnj": liste(s.get("pnj"), 60), "pnj_a_creer": creer,
            })
        if scenes:
            actes.append({"titre": propre(a.get("titre"), 100) or "Acte", "but": propre(a.get("but"), 300), "scenes": scenes})
    if not actes:
        raise redaction.Indisponible("structure sans scène")
    fins = []
    for f in (brut.get("fins") if isinstance(brut.get("fins"), list) else [])[:5]:
        f = f if isinstance(f, dict) else {}
        if propre(f.get("titre"), 100):
            fins.append({"titre": propre(f.get("titre"), 100), "description": propre(f.get("description"), 400)})
    return {"titre": propre(brut.get("titre"), 100) or "Sans titre", "parti_pris": propre(brut.get("parti_pris"), 300),
            "accroche": propre(brut.get("accroche"), 600), "actes": actes, "fins": fins,
            "questions": liste(brut.get("questions"), 240), "risques": liste(brut.get("risques"), 240)}


def structures_de(donnees: dict, une: bool) -> list[dict]:
    brut = [donnees.get("structure")] if une else (donnees.get("structures") if isinstance(donnees.get("structures"), list) else [])
    sorties = []
    for b in brut[:3]:
        try:
            sorties.append(nettoyer_structure(b))
        except redaction.Indisponible:
            continue
    if not sorties:
        raise redaction.Indisponible("aucune structure exploitable")
    return sorties


# ---------------------------------------------------------------- la demande

def parametres_de(corps: dict) -> dict:
    return {k: contexte_du_modele.court(corps.get(k), 400 if k != "precision" else 600) for k in ("duree", "ton", "contraintes", "precision")}


def resume_structure(s: dict) -> str:
    lignes = [f"Titre : {s['titre']}", f"Parti pris : {s.get('parti_pris', '')}", f"Accroche : {s.get('accroche', '')}"]
    for i, a in enumerate(s["actes"], 1):
        lignes.append(f"Acte {i} : {a['titre']} ({a.get('but', '')})")
        for j, sc in enumerate(a["scenes"], 1):
            lignes.append(f"  {i}.{j} {sc['titre']} [{sc['type']}] enjeu : {sc['enjeu']} ; sortie : {sc['sortie']} ; lieu : {sc['lieu']} ; "
                          f"indices : {' | '.join(sc['indices'])} ; PNJ : {', '.join(sc['pnj'])} ; à créer : "
                          f"{', '.join(p['nom'] + ' (' + p['role'] + ')' for p in sc['pnj_a_creer'])}")
    lignes += [f"Fin : {f['titre']} : {f['description']}" for f in s["fins"]]
    lignes += [f"Question ouverte : {q}" for q in s["questions"]] + [f"Risque : {r}" for r in s["risques"]]
    return "\n".join(lignes)


# Une structure par appel, chacune avec son angle : trois appels en parallèle plutôt qu'un seul de 20 000 jetons (qui passait
# la limite de sortie, durait quatre minutes et perdait tout s'il échouait). Les angles garantissent des structures différentes.
ANGLES = (
    "une enquête ouverte : plusieurs pistes indépendantes, jouables dans n'importe quel ordre, qui convergent",
    "un huis clos ou un lieu unique : peu de décors, des suspects ou des protagonistes aux intérêts opposés, une tension qui monte",
    "une course contre la montre ou un voyage : une échéance, une poursuite ou un trajet, des choix qui coûtent du temps",
)


def demande_squelette(idee: dict, params: dict, base: dict | None = None, acte: int | None = None, angle: str = "") -> str:
    noms = [utilitaires.texte(s.get("nom")) for s in utilitaires.lire_tout(config.SCENARIOS) if utilitaires.texte(s.get("nom"))]
    lignes = ["# L'idée du MJ", utilitaires.texte(idee.get("texte")).strip()]
    if idee.get("mots"):
        lignes.append("Mots-clés : " + ", ".join(utilitaires.texte(m) for m in idee["mots"]))
    lignes += ["", "# Ce que le MJ demande"]
    for cle, libelle in (("duree", "Durée"), ("ton", "Ton"), ("contraintes", "Contraintes")):
        lignes.append(f"{libelle} : {params.get(cle) or 'non précisée (à toi de proposer)'}")
    if noms:
        lignes.append("Scénarios déjà écrits (ne pas les refaire) : " + " ; ".join(noms[:30]))
    extraits = ia_api.extraits_bible(f"{idee.get('texte', '')} {params.get('contraintes', '')} {params.get('precision', '')}")
    if extraits:
        lignes += ["", "# Passages de la bible liés à l'idée", extraits]
    regles = [
        "Tu proposes une STRUCTURE, pas un scénario rédigé : des actes, et dans chaque acte des scènes courtes (titre, type, enjeu, "
        "sortie, indices à glisser, PNJ présents, lieu). Pas de prose, pas de dialogues.",
        "Chaque scène doit avoir une sortie : ce qui se passe quand elle s'achève, ou ce qu'elle ouvre. Chaque indice doit mener "
        "quelque part dans la structure. Prévois plus d'une façon d'avancer quand une scène bloque tout le reste.",
        "Adapte la taille à la durée demandée (environ vingt à trente minutes par scène) et fais jouer la tablée : des scènes où chaque "
        "héros a quelque chose à faire, sans te servir des secrets de leurs fiches dans une scène publique.",
        "« pnj » : les personnages DÉJÀ connus de la campagne ou de " + univers.LA_SERIE + ", par leur nom. « pnj_a_creer » : seulement ceux à inventer, "
        "avec leur rôle en une ligne. « lieu » : un lieu de l'état de la campagne ou de la bible, jamais un lieu inventé dans la "
        "géographie du pays ; sinon laisse vide et note-le dans les risques.",
        "Le canon prime : ne tranche pas un flottement de " + univers.LA_SERIE + ", signale-le dans les risques comme une liberté du MJ.",
        "« questions » : ce que le MJ doit décider avant de jouer. « risques » : les points fragiles (canon, rythme, scène bloquante).",
        "Tout en français, sans tiret cadratin.",
    ]
    if base is None:
        lignes += ["", "# Ta tâche", f"Propose UNE structure. Son angle : {angle}. Adapte cet angle à l'idée ; s'il ne lui convient vraiment "
                   "pas, prends l'angle le plus proche qui la sert. Son « parti_pris » dit en une phrase ce qui la distingue. Pour la durée "
                   "demandée, en restant concis : cinq scènes par acte au plus, chaque champ en une ou deux phrases.", *regles]
        if params.get("precision"):
            lignes.append(f"Précision du MJ : {params['precision']}")
    else:
        lignes += ["", "# La structure à reprendre", resume_structure(base), "", "# Ta tâche"]
        if acte is not None and 0 <= acte < len(base["actes"]):
            lignes.append(f"Refais SEULEMENT l'acte {acte + 1} (« {base['actes'][acte]['titre']} ») ; rends la structure entière, les autres actes "
                          "recopiés tels quels, le reste cohérent avec le nouvel acte.")
        else:
            lignes.append("Reprends cette structure en tenant compte de la précision du MJ ; garde ce qui n'est pas concerné.")
        lignes.append(f"Précision du MJ : {params.get('precision') or 'aucune, propose une meilleure version'}")
        lignes += regles
    return "\n".join(lignes)


def fabriquer(structure: dict, params: dict, parent: str = "") -> dict:
    return {"id": secrets.token_hex(4), "date": utilitaires.maintenant(), "parametres": params, "statut": "proposee",
            **({"parent": parent} if parent else {}), **structure}


def ranger(chemin: Path, nouveaux: list[dict]) -> dict:
    """Dépose les structures dans l'idée, au rang des plus récentes, sans changer sa version."""
    idee = utilitaires.lire_fiche(chemin)
    gardes = [*nouveaux, *(idee.get(CHAMP) or [])][:GARDES]
    idee[CHAMP] = gardes
    utilitaires.archiver(chemin, "idees")
    utilitaires.ecrire(chemin, idee)
    return idee


# ---------------------------------------------------------------- les routes

# La demande dure deux à trois minutes (trois structures, réflexion poussée) : plus longtemps que ce qu'une connexion muette
# supporte (Cloudflare coupe vers 100 s, le navigateur dit « network error »). Le travail se fait donc dans une tâche
# à part, qui range le résultat dans l'idée même si l'écran est parti ; la réponse n'est qu'un fil de battements.
BATTEMENT = 10  # secondes entre deux nouvelles à l'écran
EN_COURS: dict[str, asyncio.Task] = {}


async def une_structure(demande: str) -> dict:
    donnees = await redaction.rediger_json("squelette", contexte_du_modele.contexte_ia("leger"), demande, SCHEMA_UNE, max_tokens=16000)
    return structures_de(donnees, une=True)[0]


async def produire(chemin: Path, idee: dict, params: dict, base: dict | None, acte: int | None) -> tuple[list[dict], dict, int]:
    """Trois structures (une par angle, en parallèle) ou la reprise d'une seule. Rend les structures rangées, l'idée, et
    le nombre de demandes qui ont échoué : une structure manquante n'emporte pas les autres."""
    demandes = ([demande_squelette(idee, params, base, acte)] if base else [demande_squelette(idee, params, angle=a) for a in ANGLES])
    resultats = await asyncio.gather(*[une_structure(d) for d in demandes], return_exceptions=True)
    bonnes = [r for r in resultats if isinstance(r, dict)]
    if not bonnes:
        erreur = next((r for r in resultats if isinstance(r, Exception)), None)
        raise erreur if isinstance(erreur, redaction.Indisponible) else redaction.Indisponible("aucune structure exploitable")
    nouveaux = [fabriquer(s, params, base["id"] if base else "") for s in bonnes]
    return nouveaux, ranger(chemin, nouveaux), len(resultats) - len(bonnes)


def lancer(ident: str, tache: asyncio.Task) -> None:
    EN_COURS[ident] = tache

    def fini(t: asyncio.Task) -> None:
        if EN_COURS.get(ident) is t:
            del EN_COURS[ident]
        if not t.cancelled():
            t.exception()  # lue ici : une erreur dont personne n'attend plus la réponse ne doit pas rester sans nom

    tache.add_done_callback(fini)


@app.get("/api/idees/{ident}/squelette/etat")
def etat_squelette(ident: str):
    """Une demande est-elle encore en route pour cette idée ? (l'écran qui a perdu sa connexion le demande avant de relire)."""
    utilitaires.existant(config.IDEES, ident)
    return {"en_cours": ident in EN_COURS}


@app.post("/api/flux/idees/{ident}/squelette")
async def proposer_squelette(ident: str, requete: Request):
    """Trois structures pour l'idée ; ou, avec `squelette` (et `acte` pour un seul), une nouvelle version d'une structure
    déjà proposée, à partir de la précision du MJ. Le résultat est rangé dans l'idée même si l'écran a lâché."""
    chemin = utilitaires.existant(config.IDEES, ident)
    corps = await utilitaires.corps_objet(requete)
    idee = utilitaires.lire_fiche(chemin)
    if not utilitaires.texte(idee.get("texte")).strip():
        raise HTTPException(400, "L'idée est vide")
    base = None
    if corps.get("squelette"):
        base = next((s for s in idee.get(CHAMP) or [] if s.get("id") == corps.get("squelette")), None)
        if not base:
            raise HTTPException(404, "Squelette introuvable")
    params = parametres_de(corps) if base is None else {**(base.get("parametres") or {}), "precision": parametres_de(corps)["precision"]}
    acte = corps.get("acte") if isinstance(corps.get("acte"), int) and not isinstance(corps.get("acte"), bool) else None
    ia_api.exiger_api()
    if ident in EN_COURS:
        raise HTTPException(409, "Une demande de squelette est déjà en cours pour cette idée : elle s'affichera ici d'elle-même.")
    tache = asyncio.create_task(produire(chemin, idee, params, base, acte))
    lancer(ident, tache)

    async def evenements():
        yield {"t": "etape", "d": "Les structures se dessinent…" if base is None else "La structure se reprend…"}
        debut = time.monotonic()
        while not tache.done():
            await asyncio.wait({tache}, timeout=BATTEMENT)
            if not tache.done():
                yield {"t": "attente", "s": int(time.monotonic() - debut)}
        nouveaux, idee_maj, echecs = tache.result()
        yield {"t": "fin", "squelettes": nouveaux, "idee": idee_maj, "echecs": echecs}

    return ia_api.flux_sse(evenements())


@app.delete("/api/idees/{ident}/squelettes/{sid}")
async def retirer_squelette(ident: str, sid: str):
    chemin = utilitaires.existant(config.IDEES, ident)
    idee = utilitaires.lire_fiche(chemin)
    restants = [s for s in idee.get(CHAMP) or [] if s.get("id") != sid]
    if len(restants) == len(idee.get(CHAMP) or []):
        raise HTTPException(404, "Squelette introuvable")
    idee[CHAMP] = restants
    utilitaires.ecrire(chemin, idee)
    return idee


# ---------------------------------------------------------------- du squelette au scénario

def sans_consigne(valeur: str) -> str:
    return " ".join(valeur.replace("[[", "(").replace("]]", ")").split())


def liste_md(titre: str, lignes: list[str]) -> list[str]:
    return [f"## {titre}", "", *[f"- {sans_consigne(x)}" for x in lignes], ""] if lignes else []


def chapitre_vue_d_ensemble(s: dict) -> str:
    morceaux = []
    if s.get("accroche"):
        morceaux += [sans_consigne(s["accroche"]), ""]
    if s.get("parti_pris"):
        morceaux += [f"*Parti pris : {sans_consigne(s['parti_pris'])}*", ""]
    morceaux += liste_md("Les fins possibles", [f"**{sans_consigne(f['titre'])}.** {sans_consigne(f['description'])}".strip() for f in s["fins"]])
    morceaux += liste_md("À décider avant de jouer", s["questions"])
    morceaux += liste_md("Points fragiles", s["risques"])
    return "\n".join(morceaux).strip()


def texte_scene(sc: dict) -> str:
    lignes = [f"## {sans_consigne(sc['titre'])}", "", f"*{TYPES[sc['type']]}{' · ' + sans_consigne(sc['lieu']) if sc['lieu'] else ''}*", ""]
    for libelle, valeur in (("Enjeu", sc["enjeu"]), ("Sortie", sc["sortie"])):
        if valeur:
            lignes += [f"**{libelle}.** {sans_consigne(valeur)}", ""]
    if sc["indices"]:
        lignes += ["**Indices.** " + " ; ".join(sans_consigne(i) for i in sc["indices"]), ""]
    if sc["pnj"]:
        lignes += ["**PNJ présents.** " + ", ".join(sans_consigne(p) for p in sc["pnj"]), ""]
    cadre = sans_consigne(f"{sc['titre']} : {sc['enjeu']}") if sc["enjeu"] else sans_consigne(sc["titre"])
    if sc["type"] == "combat":
        lignes += [f"[[combat : {cadre}]]", ""]
    else:
        lignes += [f"[[carte blanche : écrire la scène « {cadre} »]]", ""]
    for p in sc["pnj_a_creer"]:
        lignes += [f"[[pnj : {sans_consigne(p['nom'])}, {sans_consigne(p['role'])}]]" if p["role"] else f"[[pnj : {sans_consigne(p['nom'])}]]", ""]
    return "\n".join(lignes)


def scenario_depuis(s: dict, idee_id: str, nom: str = "") -> dict:
    chapitres = [{"id": f"c-{secrets.token_hex(3)}", "titre": "Vue d'ensemble", "texte": chapitre_vue_d_ensemble(s)}]
    for a in s["actes"]:
        entete = f"*{sans_consigne(a['but'])}*\n\n" if a.get("but") else ""
        chapitres.append({"id": f"c-{secrets.token_hex(3)}", "titre": sans_consigne(a["titre"]),
                          "texte": entete + "\n".join(texte_scene(sc) for sc in a["scenes"]).strip()})
    return {"nom": contexte_du_modele.court(nom, 100) or s["titre"], "resume": contexte_du_modele.court(s.get("accroche"), 400),
            "etat": "brouillon", "chapitres": chapitres, "corbeille": [], "reponses": [], "relectures": {}, "mises_en_page": {},
            "origine": {"idee": idee_id, "squelette": s["id"]}}


@app.post("/api/idees/{ident}/squelettes/{sid}/scenario")
async def creer_scenario(ident: str, sid: str, requete: Request):
    """Le squelette retenu devient un NOUVEAU scénario (brouillon) ; l'idée passe en « retenue »."""
    chemin = utilitaires.existant(config.IDEES, ident)
    corps = await utilitaires.corps_objet(requete)
    idee = utilitaires.lire_fiche(chemin)
    s = next((x for x in idee.get(CHAMP) or [] if x.get("id") == sid), None)
    if not s:
        raise HTTPException(404, "Squelette introuvable")
    scenario = ia_api.creer_fiche(config.SCENARIOS, scenario_depuis(s, ident, utilitaires.texte(corps.get("nom"))), "scenario")
    s["statut"], s["scenario"] = "retenu", scenario["id"]
    idee["etat"] = "retenue"
    idee["modifie"] = utilitaires.maintenant()
    utilitaires.archiver(chemin, "idees")
    utilitaires.ecrire(chemin, idee)
    return {"scenario": scenario, "idee": idee}
