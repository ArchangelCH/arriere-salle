"""Les routes de rédaction par le modèle : coûts, scénarios, PNJ, lieux, cartes et plans."""

import base64
import json
import re
import secrets
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse

from campagne import univers
from ia.illustrations import proposer_pnj_variantes
from contenu import consignes
from ia import habillage
from mj import proprietes
from ia import redaction
from table.masque import masquer

from api.application import app
from api import contexte_du_modele


def finir_texte(contenu: str) -> str:
    """Ce que le modèle a écrit, prêt à déposer : liens vérifiés, nom caché masqué, pas de tiret cadratin."""
    contenu = redaction.verifier_liens(contenu.strip())
    return masquer(contenu.replace(" — ", ", ").replace("—", ","))


def flux_sse(evenements) -> StreamingResponse:
    async def corps():
        try:
            async for ev in evenements:
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
        except redaction.Indisponible as err:
            yield f"data: {json.dumps({'t': 'erreur', 'message': str(err)}, ensure_ascii=False)}\n\n"
        except HTTPException as err:
            yield f"data: {json.dumps({'t': 'erreur', 'message': str(err.detail)}, ensure_ascii=False)}\n\n"
    return StreamingResponse(corps(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def exiger_api() -> None:
    if not redaction.disponible():
        raise HTTPException(503, "Aucune clé d'API n'est configurée sur le serveur")
    contexte_du_modele.budgets.exiger()


def erreur_api(err: Exception) -> HTTPException:
    if isinstance(err, redaction.BudgetAtteint):
        return HTTPException(402, str(err))
    return HTTPException(503, f"Rédaction impossible : {err}")


@app.get("/api/ia/couts")
def couts_ia(mois: str = ""):
    if mois and not re.fullmatch(r"\d{4}-\d{2}", mois):
        raise HTTPException(400, "Mois attendu : AAAA-MM")
    # Chacun ses appels (budget_mj.py, lot MJ-5) : un invité, les siens et son budget ; le MJ principal, les siens et ceux faits pour
    # les joueurs, plus le total et la part de chaque invité.
    return contexte_du_modele.budgets.couts(mois or None)


@app.get("/api/ia/lots")
def lots_ia():
    """Les relectures différées lancées par le MJ qui lit (budget_mj.py), sans ce que le serveur en garde pour lui."""
    return [{k: v for k, v in x.items() if k not in redaction.CHAMPS_INTERNES_DES_LOTS} for x in redaction.lots()
            if isinstance(x, dict) and contexte_du_modele.budgets.lot_au_lecteur(x)]


@app.get("/api/ia/estimations")
def estimations_ia():
    """Prix et attente probables de chaque bouton qui appelle l'API, lus dans le journal des coûts (aucun appel), d'après
    les appels du MJ qui lit."""
    return contexte_du_modele.budgets.estimations()


# ---- Scénarios : consignes et relectures

def texte_scenario(scenario: dict, chapitre_vise: str | None = None) -> str:
    morceaux = [f"# Scénario « {utilitaires.texte(scenario.get('nom'))} »"]
    if scenario.get("resume"):
        morceaux.append(f"Résumé du MJ : {utilitaires.texte(scenario['resume'])}")
    for i, ch in enumerate(scenario.get("chapitres") or [], 1):
        marque = "  ← le chapitre concerné" if chapitre_vise and ch.get("id") == chapitre_vise else ""
        morceaux.append(f"## Chapitre {i} : {utilitaires.texte(ch.get('titre')) or 'sans titre'}{marque}\n\n{utilitaires.texte(ch.get('texte'))}")
    return "\n\n".join(morceaux)


ATTENTES_CONSIGNES = {
    "rediger": ("Écris le passage demandé, prêt à intégrer, dans le style du MJ (regarde le texte autour), cohérent avec le canon, la "
                "tablée et ce qui précède. Ce que le MJ lit aux joueurs va dans un encadré « > ». Un à quatre paragraphes au plus."),
    "pistes": ("Propose trois à cinq pistes nettement différentes, en liste : pour chacune, ce qui se passe, pourquoi c'est intéressant "
               "pour cette tablée, et ce que ça ouvre ensuite (une à trois phrases). Termine par une ligne : celle que tu préfères et pourquoi."),
    "verifier": ("Vérifie le passage ou l'affirmation indiqués au regard du canon. Commence par un verdict en gras parmi : Conforme ; "
                 "Non-dit (champ libre) ; Flottement de " + univers.LA_SERIE + " ; Écart au canon ; À vérifier. Explique ensuite en quelques lignes, "
                 "avec les liens de la bible recopiés à l'identique. Un flottement se présente comme une liberté du MJ."),
    "pnj": ("Crée le personnage non joueur demandé, cohérent avec le canon et la campagne, sans reprendre un personnage connu de " + univers.LA_SERIE + " "
            "sauf si la consigne le demande. Remplis la fiche ; « presentation » (jamais vide) dit en deux ou trois phrases comment il entre "
            "en scène ici, prêtes à intégrer au scénario."),
    "combat": ("Prépare la rencontre demandée pour cette tablée, équilibrée selon les règles ci-dessous, et adaptée aux indications du MJ. "
               "« presentation » dit en deux ou trois phrases comment elle commence et ce qui la rend intéressante.\n\n" + contexte_du_modele.REGLES_COMBAT),
}
SCHEMA_PNJ_CONSIGNE = {
    "type": "object", "additionalProperties": False, "required": ["pnj", "presentation"],
    "properties": {
        "presentation": {"type": "string"},
        "pnj": {"type": "object", "additionalProperties": False,
                "required": ["nom", "surnom", "genre", "age", "peuple", "role", "faction", "rang", "apparence", "voix", "envie", "secret", "offre"],
                "properties": {**{k: {"type": "string"} for k in ("nom", "surnom", "age", "peuple", "role", "faction", "apparence", "voix", "envie", "secret", "offre")},
                               "genre": {"type": "string", "enum": ["h", "f"]},
                               "rang": {"type": "string", "enum": ["civil", "notable", "sbire", "soldat", "elite", "boss", "heros"]}}},
    },
}
SCHEMA_COMBAT_CONSIGNE = {
    "type": "object", "additionalProperties": False, "required": ["rencontre", "presentation"],
    "properties": {
        "presentation": {"type": "string"},
        "rencontre": {"type": "object", "additionalProperties": False, "required": ["nom", "notes", "avant", "adversaires"],
                      "properties": {
                          "nom": {"type": "string"}, "notes": {"type": "string"},
                          "avant": {"type": "integer", "enum": [0, 1, 2, 3]},
                          "adversaires": {"type": "array", "items": {
                              "type": "object", "additionalProperties": False, "required": ["nom", "rang", "n", "capacites"],
                              "properties": {"nom": {"type": "string"}, "rang": {"type": "string", "enum": list(contexte_du_modele.RANGS_COMBAT)},
                                             "n": {"type": "integer"}, "capacites": {"type": "string"}}}}}},
    },
}


def creer_fiche(dossier: Path, fiche: dict, nom_defaut: str) -> dict:
    fiche = {**fiche, "id": utilitaires.nouvel_id(dossier, utilitaires.texte(fiche.get("nom")) or nom_defaut), "illustrations": [], "illustration": None}
    fiche["cree"] = fiche["modifie"] = utilitaires.maintenant()
    if proprietes.a_auteur(dossier.name):
        proprietes.poser_auteur(fiche)
    utilitaires.ecrire(dossier / f"{fiche['id']}.json", fiche)
    return fiche


def creer_pnj_depuis(donnees: dict, scenario_id: str) -> str:
    p = donnees.get("pnj") if isinstance(donnees.get("pnj"), dict) else {}
    fiche = {k: masquer(" ".join(utilitaires.texte(p.get(k)).split())) for k in ("nom", "surnom", "age", "peuple", "role", "faction", "apparence", "voix", "envie", "secret", "offre")}
    fiche.update({"genre": p.get("genre") if p.get("genre") in ("h", "f") else "", "rang": p.get("rang") or "civil", "connu": False,
                  "statut": "vivant", "etiquette": "maison", "scenario": scenario_id, "notes": ""})
    cree = creer_fiche(config.PNJ, fiche, "pnj")
    presentation = utilitaires.texte(donnees.get("presentation")).strip() or " ".join(x for x in (fiche["apparence"], fiche["envie"]) if x)
    return f"[{cree['nom'] or 'Le PNJ'}](#/pnj/{cree['id']}) : {presentation}"


def creer_rencontre_depuis(donnees: dict) -> str:
    r = donnees.get("rencontre") if isinstance(donnees.get("rencontre"), dict) else {}
    adversaires = []
    for a in r.get("adversaires") or []:
        rang = a.get("rang") if a.get("rang") in contexte_du_modele.RANGS_COMBAT else "soldat"
        base = {k: v for k, v in contexte_du_modele.RANGS_COMBAT[rang].items() if k != "nom"}
        adversaires.append({"cle": rang, "nom": utilitaires.texte(a.get("nom")) or contexte_du_modele.RANGS_COMBAT[rang]["nom"], "rang": rang, **base,
                            "capacites": utilitaires.texte(a.get("capacites")), "n": max(1, min(12, int(utilitaires.nombre(a.get("n"), 1))))})
    fiche = {"nom": utilitaires.texte(r.get("nom")) or "Rencontre", "notes": utilitaires.texte(r.get("notes")), "adversaires": adversaires,
             "avant": r.get("avant") if r.get("avant") in (0, 1, 2, 3) else 2, "style": "fiches", "moral": True}
    cree = creer_fiche(config.RENCONTRES, fiche, "rencontre")
    liste = "\n".join(f"- {a['n']} × {a['nom']} ({contexte_du_modele.RANGS_COMBAT[a['rang']]['nom'].lower()}){' : ' + a['capacites'] if a['capacites'] else ''}" for a in adversaires)
    return f"[{cree['nom']}](#/combats/{cree['id']}) : {utilitaires.texte(donnees.get('presentation')).strip()}\n\n{liste}"


MOTS_VIDES = {"alors", "apres", "autre", "autres", "avant", "avoir", "cette", "comme", "dans", "depuis", "donc", "elles", "encore", "entre",
              "faire", "leurs", "mais", "meme", "pour", "quand", "quelque", "sans", "selon", "sont", "sous", "tout", "toute", "toutes",
              "tous", "veut", "vient", "vers", "voila", "aussi", "chez", "deux", "trois", "petit", "petite", "grand", "grande"}


def extraits_bible(requete: str, plafond: int = 9000, termes: int = 10, chercher=None) -> str:
    """Les passages de la bible qui parlent des noms et des mots d'une demande : le canon utile, sans payer la bible entière.
    chercher(mot) : une autre recherche que celle de l'atelier (celle des seuls documents ouverts aux joueurs)."""
    chercher = chercher or (lambda mot: bible_api.bible_recherche(mot, limite=4))
    noms = re.findall(r"\b[A-ZÉÈÀÂÎÔÛÇ][\w'’-]{2,}", requete)
    mots = [m for m in re.findall(r"[\w'’-]{5,}", requete.lower()) if bible_api.sans_accents(m) not in MOTS_VIDES]
    morceaux, vus, taille = [], set(), 0
    for mot in list(dict.fromkeys([*noms, *mots]))[:termes]:
        for r in chercher(mot)["resultats"][:3]:
            for ligne in r["lignes"][:2]:
                bloc = f"- ({r['titre']}) {ligne}"
                if (r["chemin"], ligne) in vus or taille + len(bloc) > plafond:
                    continue
                vus.add((r["chemin"], ligne))
                morceaux.append(bloc)
                taille += len(bloc)
    return "\n".join(morceaux)


def demande_consigne(scenario: dict, c: dict, variantes: int, precision: str) -> str:
    avant, apres = consignes.contexte(next(ch.get("texte") or "" for ch in scenario.get("chapitres") or [] if ch.get("id") == c["chapitre"]["id"]), c["debut"], c["fin"])
    forme = "seule sur sa ligne : un passage complet est attendu" if c["bloc"] else "au milieu d'une phrase : un mot ou une courte expression qui s'insère tel quel"
    lignes = [texte_scenario(scenario, c["chapitre"]["id"]), "---", "# La consigne à traiter",
              f"Genre : {consignes.GENRES[c['genre']]}. Indications du MJ : « {c['indications']} ».",
              f"Elle est placée {forme}, dans le chapitre {c['chapitre']['numero']} « {c['chapitre']['titre']} ».",
              f"Juste avant : « …{avant[-500:]} »", f"Juste après : « {apres[:300]}… »", "", ATTENTES_CONSIGNES[c["genre"]]]
    if variantes > 1 and c["genre"] in ("rediger", "pistes"):
        lignes.append(f"Propose {variantes} versions nettement différentes, chacune sous un intertitre « ### Version 1 », « ### Version 2 »…")
    if precision:
        lignes.append(f"Précision du MJ pour cette demande : {precision}")
    if c["genre"] != "verifier":
        extraits = extraits_bible(f"{c['indications']} {precision} {c['chapitre']['titre']}")
        if extraits:
            lignes += ["", "# Passages de la bible liés à la consigne", extraits]
    lignes.append("Réponds uniquement par la proposition, sans titre ni préambule.")
    return "\n".join(lignes)


def trouver_consigne(scenario: dict, cle: str, rang: int) -> dict | None:
    return next((c for c in consignes.consignes_du_scenario(scenario) if c["cle"] == cle and c["rang"] == rang), None)


def scenario_et_consigne(ident: str, cle: str, rang: int) -> tuple[Path, dict, dict]:
    chemin = utilitaires.existant(config.SCENARIOS, ident)
    scenario = utilitaires.lire_fiche(chemin)
    c = trouver_consigne(scenario, cle, rang)
    if not c:
        raise HTTPException(404, "Consigne introuvable : le texte a changé depuis")
    return chemin, scenario, c


def enregistrer_reponse(chemin: Path, cle: str, rang: int, contenu: str, version: bool = True) -> dict:
    scenario = utilitaires.lire_fiche(chemin)
    c = trouver_consigne(scenario, cle, rang)
    if not c:
        raise HTTPException(404, "Consigne introuvable : le texte a changé pendant la rédaction")
    date = utilitaires.maintenant()
    reponses = scenario.get("reponses") or []
    for r in reponses:
        if r.get("cle") == c["cle"] and r.get("rang") == c["rang"] and r.get("statut") == "proposee":
            r["statut"], r["statut_date"] = "remplacee", date
    reponses.append({"id": secrets.token_hex(4), "cle": c["cle"], "rang": c["rang"], "genre": c["genre"],
                     "indications": c["indications"], "texte": contenu[:scenarios_api.PROPOSITION_MAX], "date": date, "statut": "proposee"})
    scenario["reponses"] = reponses
    if version:
        scenario["modifie"] = date
    utilitaires.archiver(chemin, "scenarios", 200)
    utilitaires.ecrire(chemin, scenario)
    return scenario


def enregistrer_relecture(chemin: Path, chapitre: str, contenu: str, version: bool = True, rapide: bool = False) -> dict:
    """rapide : relu avec les seuls passages de la bible liés au chapitre (l'atelier le dit au-dessus de la relecture)."""
    scenario = utilitaires.lire_fiche(chemin)
    date = utilitaires.maintenant()
    relectures = scenario.get("relectures") or {}
    relectures[scenarios_api.chapitre_relu(scenario, chapitre)] = {"texte": contenu[:scenarios_api.PROPOSITION_MAX], "date": date, **({"rapide": True} if rapide else {})}
    scenario["relectures"] = relectures
    if version:
        scenario["modifie"] = date
    utilitaires.archiver(chemin, "scenarios", 200)
    utilitaires.ecrire(chemin, scenario)
    return scenario


@app.post("/api/flux/scenarios/{ident}/consignes")
async def proposer_consigne_ia(ident: str, requete: Request):
    """La proposition pour une consigne (désignée par sa clé et son rang, comme dans le navigateur), écrite au fur et à
    mesure puis déposée à côté du texte, sans changer la version du scénario : l'écran du MJ peut continuer d'écrire.
    Un PNJ ou une rencontre demandés sont créés dans leur onglet."""
    corps = await utilitaires.corps_objet(requete)
    chemin, scenario, c = scenario_et_consigne(ident, utilitaires.texte(corps.get("cle")), int(utilitaires.nombre(corps.get("rang"), 1)))
    exiger_api()
    variantes = max(1, min(3, int(utilitaires.nombre(corps.get("variantes"), 1))))
    demande = demande_consigne(scenario, c, variantes, contexte_du_modele.court(corps.get("precision"), 600))
    # La bible entière (environ 260 000 jetons, gardés une heure en cache) pour vérifier le canon ; pour écrire, le contexte
    # léger et les passages de la bible liés à la consigne suffisent, pour dix fois moins cher.
    niveau = "complet" if c["genre"] == "verifier" else "leger"

    async def evenements():
        if c["genre"] in ("pnj", "combat"):
            yield {"t": "etape", "d": "Le PNJ prend forme…" if c["genre"] == "pnj" else "La rencontre se prépare…"}
            schema = SCHEMA_PNJ_CONSIGNE if c["genre"] == "pnj" else SCHEMA_COMBAT_CONSIGNE
            donnees = await redaction.rediger_json("consigne", contexte_du_modele.contexte_ia(niveau), demande, schema)
            contenu = finir_texte(creer_pnj_depuis(donnees, ident) if c["genre"] == "pnj" else creer_rencontre_depuis(donnees))
            yield {"t": "texte", "d": contenu}
        else:
            contenu, coupe = "", False
            async for ev in redaction.rediger_en_flux("consigne", contexte_du_modele.contexte_ia(niveau), demande):
                if ev["t"] == "texte":
                    yield ev
                else:
                    contenu, coupe = ev["texte"], ev["coupe"]
            contenu = finir_texte(contenu) + ("\n\n*(texte coupé : trop long)*" if coupe else "")
        if not contenu.strip():
            raise redaction.Indisponible("réponse vide")
        yield {"t": "fin", "texte": contenu, "scenario": enregistrer_reponse(chemin, c["cle"], c["rang"], contenu, version=False)}

    return flux_sse(evenements())


def demande_relecture(scenario: dict, chapitre: str, rapide: bool = False) -> str:
    """rapide (un chapitre seulement) : le canon arrive par les passages de la bible liés aux noms et aux mots du chapitre,
    au lieu de la bible entière (environ 2,40 $ à charger quand elle n'est plus en cache)."""
    extraits = ""
    if chapitre == "ensemble":
        cible = "l'ensemble du scénario"
    else:
        numero, ch = next((i, ch) for i, ch in enumerate(scenario.get("chapitres") or [], 1) if ch.get("id") == chapitre)
        cible = f"le chapitre {numero} « {utilitaires.texte(ch.get('titre'))} » (les autres chapitres ne sont là que pour le contexte)"
        if rapide:
            extraits = extraits_bible(f"{utilitaires.texte(ch.get('titre'))}\n{utilitaires.texte(ch.get('texte'))}", plafond=PLAFOND_RELECTURE_RAPIDE,
                                      termes=TERMES_RELECTURE_RAPIDE)
    canon = (["", "# Passages de la bible liés au chapitre",
              extraits or "(aucun passage trouvé)",
              "La bible entière n'est pas fournie : un fait du canon absent de ces passages n'est pas une erreur du MJ. "
              "Signale-le comme « À vérifier » plutôt que de l'affirmer."] if rapide and chapitre != "ensemble" else [])
    return "\n".join([
        texte_scenario(scenario, None if chapitre == "ensemble" else chapitre), *canon, "---",
        f"Relis {cible} au regard du canon, de la tablée, de l'état de la campagne et des idées du MJ.",
        "Liste les points à reprendre, du plus important au moins important. Pour chacun : la phrase en cause (courte citation en "
        "italique), le problème, la source (lien de la bible recopié à l'identique) et une suggestion en une phrase. Signale aussi ce "
        "qui pourrait trahir un peuple secret dans un encadré lu aux joueurs, et les incohérences internes au scénario.",
        "Un flottement de " + univers.LA_SERIE + " se présente comme une liberté du MJ. Ne réécris pas le texte.",
        "Termine par « **Ce qui tient** » : deux ou trois lignes sur ce qui est solide.",
        "Réponds uniquement par la relecture, sans titre ni préambule.",
    ])


# Relecture rapide d'un chapitre : plus de termes et de passages que pour une consigne (un chapitre entier en contient
# beaucoup), environ 10 000 jetons au plus au lieu des 260 000 de la bible.
TERMES_RELECTURE_RAPIDE = 40
PLAFOND_RELECTURE_RAPIDE = 40000


@app.post("/api/flux/scenarios/{ident}/relectures/{chapitre}")
async def relire_ia(ident: str, chapitre: str, rapide: bool = False):
    """La relecture d'un chapitre ou de l'ensemble au regard de la bible entière ; « rapide » (un chapitre) : le contexte léger
    et les passages de la bible liés au chapitre. La relecture d'ensemble garde toujours la bible entière."""
    chemin = utilitaires.existant(config.SCENARIOS, ident)
    scenario = utilitaires.lire_fiche(chemin)
    scenarios_api.chapitre_relu(scenario, chapitre)
    exiger_api()
    rapide = rapide and chapitre != "ensemble"
    demande = demande_relecture(scenario, chapitre, rapide)

    async def evenements():
        contenu, coupe = "", False
        async for ev in redaction.rediger_en_flux("relecture", contexte_du_modele.contexte_ia("leger" if rapide else "complet"), demande):
            if ev["t"] == "texte":
                yield ev
            else:
                contenu, coupe = ev["texte"], ev["coupe"]
        contenu = finir_texte(contenu) + ("\n\n*(relecture coupée : trop longue)*" if coupe else "")
        if not contenu.strip():
            raise redaction.Indisponible("réponse vide")
        yield {"t": "fin", "texte": contenu, "scenario": enregistrer_relecture(chemin, chapitre, contenu, version=False, rapide=rapide)}

    return flux_sse(evenements())


@app.post("/api/scenarios/{ident}/relectures/{chapitre}/differee")
async def relire_differe(ident: str, chapitre: str):
    """La même relecture en lot : moitié prix, déposée en général dans l'heure par la surveillance des lots."""
    chemin = utilitaires.existant(config.SCENARIOS, ident)
    scenario = utilitaires.lire_fiche(chemin)
    scenarios_api.chapitre_relu(scenario, chapitre)
    exiger_api()
    try:
        return await redaction.lancer_lot("relecture", {"scenario": ident, "chapitre": chapitre}, contexte_du_modele.contexte_ia("complet"),
                                          demande_relecture(scenario, chapitre))
    except redaction.Indisponible as err:
        raise erreur_api(err)


def deposer_lot(cible: dict, contenu: str) -> None:
    """Le texte d'un lot relevé, déposé selon son genre : une relecture (sans genre, comme avant), ou la mise en page
    proposée d'un chapitre, qui passe ses garde-fous (une réponse coupée arrive avec « coupe », redaction.relever_lots)."""
    if not cible.get("scenario"):
        return
    chemin = utilitaires.existant(config.SCENARIOS, cible["scenario"])
    if cible.get("genre") == GENRE_MISE_EN_PAGE:
        try:
            scenarios_api.proposer_mise_en_page(chemin, utilitaires.texte(cible.get("chapitre")), contenu,
                                                utilitaires.texte(cible.get("base")), coupe=bool(cible.get("coupe")))
        except scenarios_api.MiseEnPageRefusee as refus:
            raise redaction.DepotRefuse(f"mise en page refusée : {refus}")
        except HTTPException:
            raise redaction.DepotRefuse("mise en page sans objet : le chapitre n'existe plus")
        return
    enregistrer_relecture(chemin, cible.get("chapitre") or "ensemble", finir_texte(contenu), version=False)


# ---- Scénarios : relire et mettre en page un chapitre, ou tous (la proposition attend à côté du texte du MJ)

GENRE_MISE_EN_PAGE = "mise-en-page"
# La réflexion compte dans les jetons de sortie : de quoi rendre un chapitre de CHAPITRE_MAX caractères en entier.
JETONS_MISE_EN_PAGE = 48000


def demande_mise_en_page(scenario: dict, chapitre: str) -> str:
    """Le chapitre seul, avec les titres des autres pour la cohérence des intertitres : ni le reste du scénario ni la
    bible (le contexte léger apporte le glossaire et les noms propres)."""
    numero, ch = scenarios_api.chapitre_du(scenario, chapitre)
    chapitres = scenario.get("chapitres") or []
    titres = "\n".join(f"{i}. {utilitaires.texte(c.get('titre')) or 'sans titre'}" for i, c in enumerate(chapitres, 1))
    return "\n".join([
        f"# Scénario « {utilitaires.texte(scenario.get('nom'))} » : chapitre {numero} sur {len(chapitres)}, "
        f"« {utilitaires.texte(ch.get('titre')) or 'sans titre'} »",
        "", "Les titres des chapitres, pour la cohérence des intertitres :", titres, "",
        "<chapitre>", utilitaires.texte(ch.get("texte")), "</chapitre>", "", "---",
        "Relis ce chapitre comme un correcteur d'édition et rends-le corrigé et mis en page. Le MJ comparera ta version à la "
        "sienne mot à mot, puis acceptera ou refusera chaque changement : moins tu touches à ce qui est juste, plus sa "
        "relecture est simple.",
        "",
        "Ce que tu corriges : l'orthographe, la grammaire, les accords, la ponctuation et la typographie française (espace "
        "avant « : ; ! ? », guillemets français « », apostrophes, majuscules accentuées, points de suspension, nombres et "
        "abréviations).",
        "",
        "Ce que tu mets en page, dans le Markdown de l'atelier (rien d'autre n'y est rendu) :",
        "- les intertitres : « ## » pour une scène ou une partie, « ### » et « #### » en dessous ; le titre du chapitre "
        "s'affiche à part, ne le répète pas ; des niveaux et une formulation cohérents d'un intertitre à l'autre ;",
        "- une ligne vide entre deux paragraphes ; une liste (« - » ou « 1. ») pour ce qui est une énumération ; un tableau "
        "(« | a | b | » et sa ligne « |---|---| ») pour ce qui est déjà un tableau de fait (prix, valeurs, "
        "caractéristiques) ; « --- » seul sur sa ligne pour une rupture ;",
        "- « > » en début de ligne pour ce qui se lit à voix haute aux joueurs, et pour cela seulement (une ligne « > » "
        "vide sépare deux paragraphes d'un même encadré) ;",
        "- « **gras** » pour un nom ou un chiffre à retrouver d'un coup d'œil en jeu, « *italique* » pour un titre "
        "d'œuvre ou un mot étranger ; avec retenue.",
        "",
        "Ce qui ne change pas : le fond, le sens, le style et la voix du MJ, l'ordre des passages. Tu n'ajoutes ni ne "
        "retires aucune information, tu ne reformules pas une phrase correcte, tu ne résumes pas, tu ne complètes pas. Une "
        "phrase maladroite mais correcte reste telle quelle.",
        "",
        "À recopier au caractère près : l'atelier s'en sert de repères et écarterait ta version sinon.",
        "- les consignes entre doubles crochets « [[…]] » : ne les traite pas, ne les corrige pas, ne les déplace pas ;",
        "- l'adresse des liens « [libellé](#/…) » et « [libellé](https://…) » ;",
        "- les « #mots-clés » et les « @[Nom] » ;",
        "- les noms propres (personnages, lieux, peuples) tels que le MJ les écrit, même s'ils diffèrent du glossaire.",
        "N'ajoute aucun lien, aucun « #mot-clé », aucun « @[Nom] », aucune consigne. Pas de tiret cadratin.",
        "",
        "Réponds uniquement par le texte du chapitre, en entier, sans son titre, sans préambule, sans commentaire ni bloc "
        "de code. Si rien n'est à corriger, rends-le tel quel.",
    ])


def chapitres_a_mettre_en_page(scenario: dict, chapitre: str) -> tuple[list[str], list[dict]]:
    """(identifiants des chapitres à relire, chapitres écartés avec leur raison). Un seul chapitre : vide ou trop long,
    l'erreur le dit ; « ensemble » : ceux-là sont écartés, les autres partent."""
    if chapitre != scenarios_api.ENSEMBLE:
        _, ch = scenarios_api.chapitre_du(scenario, chapitre)
        contenu = utilitaires.texte(ch.get("texte"))
        if not contenu.strip():
            raise HTTPException(400, "Ce chapitre est vide : rien à relire.")
        if len(contenu) > scenarios_api.CHAPITRE_MAX:
            raise HTTPException(413, "Ce chapitre est trop long pour être relu d'un seul tenant : coupez-le en deux chapitres.")
        return [chapitre], []
    retenus, ecartes = [], []
    for ch in scenario.get("chapitres") or []:
        contenu = utilitaires.texte(ch.get("texte"))
        if len(contenu) > scenarios_api.CHAPITRE_MAX:
            ecartes.append({"chapitre": ch.get("id"), "etat": "refusee", "message": "chapitre trop long pour être relu d'un seul tenant : coupez-le en deux"})
        elif contenu.strip():
            retenus.append(ch.get("id"))
    if not retenus and not ecartes:
        raise HTTPException(400, "Ce scénario n'a encore aucun texte à relire.")
    return retenus, ecartes


@app.post("/api/flux/scenarios/{ident}/mises-en-page/{chapitre}")
async def mettre_en_page_ia(ident: str, chapitre: str):
    """Relire et mettre en page un chapitre, ou tous (« ensemble », l'un après l'autre : un appel par chapitre). Le texte
    arrive au fil, puis passe ses garde-fous et se dépose à côté de celui du MJ, sans changer la version du scénario.
    Un seul chapitre : un refus est une erreur. Tous : le bilan de chacun arrive à la fin, avec ce qui a arrêté la série
    (le budget du mois, une panne) ; ce qui est déjà déposé le reste."""
    chemin = utilitaires.existant(config.SCENARIOS, ident)
    a_relire, ecartes = chapitres_a_mettre_en_page(utilitaires.lire_fiche(chemin), chapitre)
    exiger_api()
    seul = chapitre != scenarios_api.ENSEMBLE

    async def evenements():
        bilan, arret = list(ecartes), None
        for rang, cid in enumerate(a_relire, 1):
            # Relu à son tour : le chapitre tel qu'il est maintenant, s'il existe encore et s'il a toujours du texte.
            scenario = utilitaires.lire_fiche(chemin)
            ch = next((c for c in scenario.get("chapitres") or [] if c.get("id") == cid), None)
            source = utilitaires.texte(ch.get("texte")) if ch else ""
            if not source.strip() or len(source) > scenarios_api.CHAPITRE_MAX:
                continue
            yield {"t": "chapitre", "chapitre": cid, "rang": rang, "sur": len(a_relire)}
            contenu, coupe = "", False
            try:
                async for ev in redaction.rediger_en_flux(GENRE_MISE_EN_PAGE, contexte_du_modele.contexte_ia("leger"),
                                                          demande_mise_en_page(scenario, cid), JETONS_MISE_EN_PAGE):
                    if ev["t"] == "texte":
                        yield {**ev, "chapitre": cid}
                    else:
                        contenu, coupe = ev["texte"], ev["coupe"]
            except redaction.Indisponible as err:
                if seul:
                    raise
                arret = str(err)
                break
            try:
                _, deposee = scenarios_api.proposer_mise_en_page(chemin, cid, contenu, scenarios_api.empreinte(source), coupe)
                etat = {"chapitre": cid, "etat": "proposee" if deposee else "inchange"}
            except scenarios_api.MiseEnPageRefusee as refus:
                if seul:
                    raise HTTPException(422, f"Mise en page refusée : {refus}")
                etat = {"chapitre": cid, "etat": "refusee", "message": str(refus)}
            bilan.append(etat)
            yield {"t": "depose", **etat}
        yield {"t": "fin", "scenario": utilitaires.lire_fiche(chemin), "bilan": bilan, "arret": arret}

    return flux_sse(evenements())


@app.post("/api/scenarios/{ident}/mises-en-page/{chapitre}/differee")
async def mettre_en_page_differe(ident: str, chapitre: str):
    """La même relecture en lots (un par chapitre) : moitié prix, déposée en général dans l'heure par la surveillance des
    lots. Un chapitre qui a déjà un lot en cours n'en reçoit pas un second."""
    chemin = utilitaires.existant(config.SCENARIOS, ident)
    scenario = utilitaires.lire_fiche(chemin)
    a_relire, ecartes = chapitres_a_mettre_en_page(scenario, chapitre)
    exiger_api()
    en_cours = {x["cible"].get("chapitre") for x in redaction.lots()
                if isinstance(x, dict) and x.get("etat") == "en-cours" and isinstance(x.get("cible"), dict)
                and x["cible"].get("scenario") == ident and x["cible"].get("genre") == GENRE_MISE_EN_PAGE}
    lances, arret = [], None
    for cid in a_relire:
        if cid in en_cours:
            continue
        _, ch = scenarios_api.chapitre_du(scenario, cid)
        cible = {"scenario": ident, "chapitre": cid, "genre": GENRE_MISE_EN_PAGE, "base": scenarios_api.empreinte(utilitaires.texte(ch.get("texte")))}
        try:
            lot = await redaction.lancer_lot(GENRE_MISE_EN_PAGE, cible, contexte_du_modele.contexte_ia("leger"),
                                             demande_mise_en_page(scenario, cid), JETONS_MISE_EN_PAGE)
        except redaction.Indisponible as err:
            if not lances:
                raise erreur_api(err)
            arret = str(err)
            break
        lances.append({k: v for k, v in lot.items() if k not in redaction.CHAMPS_INTERNES_DES_LOTS})
    return {"lots": lances, "ecartes": ecartes, "arret": arret}


# ---- PNJ : plusieurs versions en un appel

@app.post("/api/pnj-variantes")
async def variantes_pnj(requete: Request):
    corps = await utilitaires.corps_objet(requete)
    exiger_api()
    fiche = corps.get("fiche") if isinstance(corps.get("fiche"), dict) else {}
    try:
        return {"variantes": await proposer_pnj_variantes(fiche, utilitaires.texte(corps.get("idee")).strip(), 3)}
    except redaction.Indisponible as err:
        raise erreur_api(err)


# ---- Cartes : la fiche d'un lieu, et une région à peupler

def terrain_carte(carte: dict) -> bytes:
    try:
        return base64.b64decode(carte.get("terrain") or "")
    except ValueError:
        return b""


def biome_en(carte: dict, terrain: bytes, x: float, y: float) -> int | None:
    largeur, hauteur = int(utilitaires.nombre(carte.get("largeur"))), int(utilitaires.nombre(carte.get("hauteur")))
    xi, yi = int(x), int(y)
    if not (0 <= xi < largeur and 0 <= yi < hauteur) or len(terrain) < largeur * hauteur:
        return None
    return terrain[yi * largeur + xi]


def grille_texte(carte: dict, terrain: bytes, zone: dict, colonnes: int = 60) -> tuple[str, float]:
    """La zone en lettres (une lettre par paquet de cases) : le modèle y place ses lieux à la bonne case."""
    x0, y0, x1, y1 = zone["x0"], zone["y0"], zone["x1"], zone["y1"]
    pas = max(1.0, (x1 - x0) / colonnes)
    lignes = []
    y = y0
    while y < y1:
        ligne = ""
        x = x0
        while x < x1:
            b = biome_en(carte, terrain, x + pas / 2, y + pas / 2)
            ligne += contexte_du_modele.LETTRES_BIOMES[b] if b is not None and b < len(contexte_du_modele.LETTRES_BIOMES) else " "
            x += pas
        lignes.append(f"{y:7.1f} {ligne}")
        y += pas
    return "\n".join(lignes), pas


def lieux_de_la_carte(carte: dict) -> list[dict]:
    lieux = {l.get("id"): l for l in utilitaires.lire_tout(config.LIEUX)}
    sortie = []
    for m in carte.get("marqueurs") or []:
        l = lieux.get(m.get("lieu"))
        if l:
            sortie.append({"nom": utilitaires.texte(l.get("nom")), "type": l.get("type"), "x": round(utilitaires.nombre(m.get("x")), 1), "y": round(utilitaires.nombre(m.get("y")), 1)})
    return sortie


SCHEMA_LIEU = {"type": "object", "additionalProperties": False, "required": ["resume", "secrets", "notes"],
               "properties": {"resume": {"type": "string"}, "secrets": {"type": "string"}, "notes": {"type": "string"}}}


@app.post("/api/lieux/{ident}/redaction")
async def rediger_lieu(ident: str, requete: Request):
    """La fiche d'un lieu : ce que savent les joueurs, ce qui est réservé au MJ, et les notes de jeu (ambiance, PNJ présents,
    accroches). Le front ne remplit que les champs vides, sauf accord du MJ."""
    corps = await utilitaires.corps_objet(requete)
    lieu = utilitaires.lire_fiche(utilitaires.existant(config.LIEUX, ident))
    # L'éditeur envoie la fiche telle qu'elle est à l'écran : une frappe pas encore enregistrée compte aussi.
    local = corps.get("fiche") if isinstance(corps.get("fiche"), dict) else {}
    lieu |= {k: local[k] for k in ("nom", "type", "connu", "resume", "secrets", "notes") if k in local}
    exiger_api()
    voisins, terrain_autour = [], ""
    # Sa carte, si le MJ qui écrit peut la lire : ni le terrain ni les voisins d'une carte de l'autre MJ ne partent.
    carte = tv_fiches.fiche_ou_rien(config.CARTES, lieu.get("carte"))
    if carte is not None:
        m = next((m for m in carte.get("marqueurs") or [] if m.get("lieu") == ident), None)
        if m:
            terrain = terrain_carte(carte)
            autour = {contexte_du_modele.NOMS_BIOMES[b] for dx in (-3, 0, 3) for dy in (-3, 0, 3)
                      if (b := biome_en(carte, terrain, utilitaires.nombre(m.get("x")) + dx, utilitaires.nombre(m.get("y")) + dy)) is not None and b < len(contexte_du_modele.NOMS_BIOMES)}
            terrain_autour = ", ".join(sorted(autour))
            km = utilitaires.nombre(carte.get("km_case"), 1)
            for v in lieux_de_la_carte(carte):
                d = ((v["x"] - utilitaires.nombre(m.get("x"))) ** 2 + (v["y"] - utilitaires.nombre(m.get("y"))) ** 2) ** 0.5
                if 0 < d * km <= 60 and v["nom"] != lieu.get("nom"):
                    voisins.append(f"{v['nom']} ({contexte_du_modele.TYPES_LIEUX_IA.get(v['type'], v['type'])}, à environ {round(d * km)} km)")
    demande = "\n".join([
        "Écris la fiche de ce lieu de la campagne, cohérente avec le canon et les lieux voisins.",
        f"Lieu : {utilitaires.texte(lieu.get('nom'))} ({contexte_du_modele.TYPES_LIEUX_IA.get(lieu.get('type'), utilitaires.texte(lieu.get('type')))}), "
        f"{'connu' if lieu.get('connu') else 'inconnu'} des joueurs, origine : {utilitaires.texte(lieu.get('etiquette')) or 'maison'}.",
        f"Terrain autour : {terrain_autour or 'inconnu'}. Voisins : {'; '.join(voisins[:12]) or 'aucun noté'}.",
        f"Déjà écrit par le MJ (à respecter, à compléter) : ce que savent les joueurs : « {contexte_du_modele.court(lieu.get('resume'), 800)} » ; "
        f"réservé au MJ : « {contexte_du_modele.court(lieu.get('secrets'), 800)} » ; notes : « {contexte_du_modele.court(lieu.get('notes'), 800)} ».",
        f"Idée du MJ : {contexte_du_modele.court(corps.get('idee'), 400)}" if corps.get("idee") else "",
        "resume : ce que les joueurs en savent ou en voient, deux à quatre phrases concrètes. secrets : ce qui est caché, une ou deux "
        "révélations utilisables en jeu. notes : l'ambiance en une phrase, deux PNJ présents (nom et rôle), deux accroches d'aventure "
        "et une rumeur qui court, en liste courte.",
    ])
    try:
        donnees = await redaction.rediger_json("lieu", contexte_du_modele.contexte_ia("leger"), demande, SCHEMA_LIEU)
    except redaction.Indisponible as err:
        raise erreur_api(err)
    return {k: finir_texte(utilitaires.texte(donnees.get(k))) for k in ("resume", "secrets", "notes")}


SCHEMA_PEUPLER = {
    "type": "object", "additionalProperties": False, "required": ["lieux"],
    "properties": {"lieux": {"type": "array", "items": {
        "type": "object", "additionalProperties": False,
        "required": ["nom", "type", "x", "y", "resume", "secrets", "accroche", "rumeur"],
        "properties": {"nom": {"type": "string"}, "type": {"type": "string", "enum": list(contexte_du_modele.TYPES_LIEUX_IA)},
                       "x": {"type": "number"}, "y": {"type": "number"}, "resume": {"type": "string"},
                       "secrets": {"type": "string"}, "accroche": {"type": "string"}, "rumeur": {"type": "string"}}}}},
}


@app.post("/api/cartes/{ident}/peupler")
async def peupler_region(ident: str, requete: Request):
    """Des lieux proposés pour une zone de la carte : le modèle voit l'image de la zone et sa grille de terrain, et place
    chaque lieu à une case précise. Rien n'est créé ici : le MJ garde ou écarte chaque proposition dans l'éditeur."""
    corps = await utilitaires.corps_objet(requete)
    carte = utilitaires.lire_fiche(utilitaires.existant(config.CARTES, ident))
    exiger_api()
    z = corps.get("zone") if isinstance(corps.get("zone"), dict) else {}
    largeur, hauteur = utilitaires.nombre(carte.get("largeur")), utilitaires.nombre(carte.get("hauteur"))
    zone = {"x0": max(0, utilitaires.nombre(z.get("x0"))), "y0": max(0, utilitaires.nombre(z.get("y0"))),
            "x1": min(largeur, utilitaires.nombre(z.get("x1"))), "y1": min(hauteur, utilitaires.nombre(z.get("y1")))}
    if zone["x1"] - zone["x0"] < 4 or zone["y1"] - zone["y0"] < 4:
        raise HTTPException(400, "Zone trop petite")
    nombre_lieux = max(1, min(8, int(utilitaires.nombre(corps.get("nombre"), 5))))
    terrain = terrain_carte(carte)
    grille, pas = grille_texte(carte, terrain, zone)
    dedans = [l for l in lieux_de_la_carte(carte) if zone["x0"] <= l["x"] <= zone["x1"] and zone["y0"] <= l["y"] <= zone["y1"]]
    autour = [l for l in lieux_de_la_carte(carte) if l not in dedans]
    legende = ", ".join(f"{contexte_du_modele.LETTRES_BIOMES[i]} {n.lower()}" for i, n in enumerate(contexte_du_modele.NOMS_BIOMES))
    demande = "\n".join([
        f"Peuple cette région de la carte « {utilitaires.texte(carte.get('nom'))} » ({carte.get('km_case') or 1} km par case) : propose exactement "
        f"{nombre_lieux} lieux nouveaux, variés et plausibles pour le terrain, cohérents avec le canon et la campagne.",
        f"La zone va de x = {zone['x0']:.1f} à {zone['x1']:.1f} et de y = {zone['y0']:.1f} à {zone['y1']:.1f} (en cases). "
        f"L'image jointe la montre ; la grille ci-dessous donne le terrain, une lettre pour {pas:.1f} case(s) de côté, "
        f"chaque ligne commençant par son y ; x croît vers la droite à partir de {zone['x0']:.1f}.",
        f"Légende : {legende}.", "", grille, "",
        f"Déjà dans la zone : {'; '.join(f'{l['nom']} ({l['type']}, x {l['x']}, y {l['y']})' for l in dedans) or 'rien'}.",
        f"Ailleurs sur la carte : {'; '.join(l['nom'] for l in autour[:40]) or 'rien'}.",
        f"Idée du MJ : {contexte_du_modele.court(corps.get('idee'), 400)}" if corps.get("idee") else "",
        "Règles : jamais sur l'eau (~) ni en terres inconnues (b) ; un port au bord de l'eau ; une mine en collines ou montagnes ; "
        "au moins deux cases d'écart avec les lieux existants et entre eux ; pas de ville ni de capitale sauf demande du MJ. "
        "resume : ce que les joueurs en savent, deux phrases. secrets : une révélation pour le MJ. accroche : une amorce d'aventure. "
        "rumeur : une phrase qu'on entend à l'auberge, vraie ou fausse.",
    ])
    contenu: list | str = demande
    image = utilitaires.texte(corps.get("image"))
    if image.startswith("data:image/png;base64,") and len(image) < 8_000_000:
        contenu = [{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": image.split(",", 1)[1]}},
                   {"type": "text", "text": demande}]
    try:
        donnees = await redaction.rediger_json("peupler", contexte_du_modele.contexte_ia("leger"), contenu, SCHEMA_PEUPLER)
    except redaction.Indisponible as err:
        raise erreur_api(err)
    proposes = []
    for l in donnees.get("lieux") or []:
        x = min(max(utilitaires.nombre(l.get("x")), zone["x0"]), zone["x1"])
        y = min(max(utilitaires.nombre(l.get("y")), zone["y0"]), zone["y1"])
        b = biome_en(carte, terrain, x, y)
        if b in (0, 14):
            continue
        proposes.append({"nom": finir_texte(utilitaires.texte(l.get("nom"))), "type": l.get("type") if l.get("type") in contexte_du_modele.TYPES_LIEUX_IA else "point",
                         "x": round(x, 2), "y": round(y, 2), "terrain": contexte_du_modele.NOMS_BIOMES[b] if b is not None and b < len(contexte_du_modele.NOMS_BIOMES) else "",
                         **{k: finir_texte(utilitaires.texte(l.get(k))) for k in ("resume", "secrets", "accroche", "rumeur")}})
    return {"lieux": proposes}


# ---- Plans : le contenu par le modèle, la géométrie par le générateur

SCHEMA_PLAN = {
    "type": "object", "additionalProperties": False, "required": ["modele", "nom", "notes", "salles"],
    "properties": {
        "modele": {"type": "string", "enum": list(contexte_du_modele.MODELES_PLAN_IA)}, "nom": {"type": "string"}, "notes": {"type": "string"},
        "salles": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["nom", "role", "joueurs", "notes", "piege", "indice", "rencontre"],
            "properties": {k: {"type": "string"} for k in ("nom", "role", "joueurs", "notes", "piege", "indice", "rencontre")}}},
    },
}


@app.post("/api/plans/programme")
async def programmer_plan(requete: Request):
    """Le programme d'un plan : le modèle choisit le générateur et décrit chaque salle (ce que voient les joueurs, notes du
    MJ, piège, indice, rencontre) ; l'éditeur génère la géométrie et y range ces descriptions, salle par salle."""
    corps = await utilitaires.corps_objet(requete)
    voulu = contexte_du_modele.court(corps.get("demande"), 1500)
    if not voulu:
        raise HTTPException(400, "Décrivez d'abord le plan voulu")
    exiger_api()
    lieu = ""
    # Le lieu du plan, s'il est au MJ qui écrit : les secrets d'un lieu de l'autre MJ ne partent pas vers le modèle.
    if (l := tv_fiches.fiche_ou_rien(config.LIEUX, corps.get("lieu"))) is not None:
        lieu = f"Le plan se trouve à {utilitaires.texte(l.get('nom'))} : {contexte_du_modele.court(l.get('resume'), 400)} Réservé au MJ : {contexte_du_modele.court(l.get('secrets'), 400)}"
    demande = "\n".join([
        f"Le MJ veut ce plan : « {voulu} ».", lieu,
        "Choisis le générateur qui convient parmi : " + " ; ".join(contexte_du_modele.MODELES_PLAN_IA.values()) + ".",
        "Décris ensuite les salles principales dans l'ordre du générateur (sans les couloirs), en respectant son nombre de salles. "
        "nom : court, tel qu'il peut s'afficher sur la TV. role : à quoi sert la salle dans l'aventure. joueurs : ce que voient les "
        "joueurs en entrant, deux phrases. notes : ce que le MJ doit savoir. piege, indice, rencontre : vides s'il n'y en a pas ; une "
        "rencontre suit les règles ci-dessous et nomme les adversaires avec leur rang. notes (du plan) : le fil de l'exploration en "
        "trois phrases.", "", contexte_du_modele.REGLES_COMBAT,
    ])
    try:
        donnees = await redaction.rediger_json("plan", contexte_du_modele.contexte_ia("leger"), demande, SCHEMA_PLAN)
    except redaction.Indisponible as err:
        raise erreur_api(err)
    salles = [{k: finir_texte(utilitaires.texte(s.get(k))) for k in ("nom", "role", "joueurs", "notes", "piege", "indice", "rencontre")}
              for s in donnees.get("salles") or [] if isinstance(s, dict)][:10]
    return {"modele": donnees.get("modele") if donnees.get("modele") in contexte_du_modele.MODELES_PLAN_IA else "crypte",
            "nom": finir_texte(utilitaires.texte(donnees.get("nom"))), "notes": finir_texte(utilitaires.texte(donnees.get("notes"))), "salles": salles}


# ---- Habillage : le modèle choisit les détails de petite échelle, le code les dessine (habillage.py)

@app.post("/api/cartes/{ident}/habiller")
async def habiller_carte(ident: str, requete: Request):
    """Champs, vergers, haies, hameaux, sentiers, ponts, gués et bâtiments proposés pour une zone d'une carte détaillée,
    contrôlés avant d'être rendus. Rien n'est enregistré : l'éditeur montre la proposition, le MJ la garde ou non."""
    corps = await utilitaires.corps_objet(requete)
    carte = utilitaires.lire_fiche(utilitaires.existant(config.CARTES, ident))
    km = habillage.num(carte.get("km_case"), 1.0) or 1.0
    if km > habillage.KM_CASE_MAX:
        raise HTTPException(400, f"Carte trop vaste pour l'habillage ({km:g} km par case) : un champ n'y serait qu'un point, et les champs "
                                 "se dessinent déjà d'eux-mêmes autour des lieux. Habillez plutôt une carte détaillée (1 km par case au plus).")
    largeur, hauteur = habillage.num(carte.get("largeur"), 0.0), habillage.num(carte.get("hauteur"), 0.0)
    z = corps.get("zone") if isinstance(corps.get("zone"), dict) else {}
    zone = {"x0": max(0.0, habillage.num(z.get("x0"), 0.0)), "y0": max(0.0, habillage.num(z.get("y0"), 0.0)),
            "x1": min(largeur, habillage.num(z.get("x1"), largeur)), "y1": min(hauteur, habillage.num(z.get("y1"), hauteur))}
    if zone["x1"] - zone["x0"] < 4 or zone["y1"] - zone["y0"] < 4:
        raise HTTPException(400, "Zone trop petite")
    exiger_api()
    lieux = {}
    for m in carte.get("marqueurs") or []:
        ref = utilitaires.texte(m.get("lieu")) if isinstance(m, dict) else ""
        # Les seuls lieux que lit le MJ qui écrit (cloisonnement.py) : un repère vers un lieu de l'autre ne dit rien.
        if (l := tv_fiches.fiche_ou_rien(config.LIEUX, ref)) is not None:
            lieux[ref] = l
    terrain = habillage.Terrain(carte, terrain_carte(carte), lieux)
    demande, refs = habillage.demande_carte(terrain, carte, zone, contexte_du_modele.court(corps.get("idee"), 600), contexte_du_modele.LETTRES_BIOMES, contexte_du_modele.NOMS_BIOMES, contexte_du_modele.TYPES_LIEUX_IA)
    contenu: list | str = demande
    image = utilitaires.texte(corps.get("image"))
    if image.startswith("data:image/png;base64,") and len(image) < 8_000_000:
        contenu = [{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": image.split(",", 1)[1]}},
                   {"type": "text", "text": demande}]
    try:
        # La réflexion et les polygones d'une grande zone dépassent les 16 000 jetons par défaut (mesuré : réponse coupée).
        donnees = await redaction.rediger_json("habillage-carte", contexte_du_modele.contexte_ia("leger"), contenu, habillage.SCHEMA_CARTE, max_tokens=32000)
    except redaction.Indisponible as err:
        raise erreur_api(err)
    hab, remarques = habillage.controler_carte(donnees, terrain, zone, refs, finir_texte, habillage.numero_suivant(carte.get("habillage"), "h"),
                                               utilitaires.texte(corps.get("idee")))
    return {"habillage": hab, "remarques": remarques}


@app.post("/api/plans/{ident}/habiller")
async def habiller_plan(ident: str, requete: Request):
    """Objets d'ambiance, lumières, ambiance et légende d'un plan pour une heure (jour, soir, nuit), contrôlés avant
    d'être rendus. Rien n'est enregistré : l'éditeur montre la proposition, le MJ la garde ou non."""
    corps = await utilitaires.corps_objet(requete)
    p = utilitaires.lire_fiche(utilitaires.existant(config.PLANS, ident))
    heure = corps.get("heure") if corps.get("heure") in habillage.HEURES else "soir"
    try:
        w, h = int(p["largeur"]), int(p["hauteur"])
        valide = w > 0 and h > 0 and len(p["sol"]) == w * h and len(p["piece"]) == w * h and any(p["sol"])
    except (KeyError, TypeError, ValueError):
        valide = False
    if not valide:
        raise HTTPException(400, "Ce plan n'a encore aucune case à habiller")
    exiger_api()
    lieu = tv_fiches.fiche_ou_rien(config.LIEUX, p.get("lieu"))
    plan = habillage.Plan(p, tv_plans.murs_du_plan(p))
    demande = habillage.demande_plan(plan, p, lieu, heure, contexte_du_modele.court(corps.get("idee"), 600), contexte_du_modele.TYPES_LIEUX_IA)
    try:
        donnees = await redaction.rediger_json("habillage-plan", contexte_du_modele.contexte_ia("leger"), demande, habillage.SCHEMA_PLAN, max_tokens=24000)
    except redaction.Indisponible as err:
        raise erreur_api(err)
    avant = p.get("habillage")
    hab, remarques = habillage.controler_plan(donnees, plan, heure, finir_texte, habillage.numero_suivant(avant, "o"),
                                              habillage.numero_suivant(avant, "l"))
    return {"habillage": hab, "remarques": remarques}


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import config, utilitaires, scenarios_api, bible_api, tv_fiches, tv_plans  # noqa: E402
