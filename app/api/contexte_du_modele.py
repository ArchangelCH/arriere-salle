"""Le contexte de la campagne donné au modèle de langue."""

from pathlib import Path

from campagne import univers
from ia.illustrations import nom_de_joueur
from commun import bible
from mj import cloisonnement
from mj import proprietes
from ia import redaction
from ia import budget_mj
from table.masque import contient_nom_cache, masquer, secrets_dans

from api.application import app
from api import config, utilitaires


# L'aide à l'écriture par le modèle de l'API (redaction.py). Chaque demande reçoit le même contexte, mis en cache :
# une consigne générale, le canon (glossaire et ton de la table ; la bible entière pour les scénarios) et l'état de la
# campagne. Les propositions s'affichent à côté du texte du MJ, jamais dedans ; tout texte produit passe par masquer().

# Les mots de l'univers (son monde, son canon, son ton) viennent de la campagne (campagne/univers.py) ; le reste est la
# règle du jeu de l'atelier, la même pour toute campagne.
CONSIGNE_GENERALE = ("Tu assistes le meneur de jeu (MJ) d'une campagne de jeu de rôle " + univers.CONSIGNE_MONDE + "\n\n"
                     + univers.CONSIGNE_CANON + "\n\n"
                     "Un lien vers une vidéo ne se recopie que tel qu'il figure dans la bible, à l'identique : n'en fabrique jamais. "
                     "Le nom de " + univers.AUBERGE_CACHEE + "\nest une surprise pour les joueurs : ne l'écris jamais, dis « l'auberge ».\n\n"
                     + univers.CONSIGNE_TON + "\n\n"
                     """Tu proposes, le MJ décide : tes propositions s'affichent à côté de son texte, il les intègre lui-même. Écris en français, en Markdown
simple (intertitres ##, listes, gras, encadré « > » pour ce que le MJ lit aux joueurs), sans tiret cadratin, sans formule d'introduction
ni de conclusion. Les héros des joueurs (la tablée) et l'état de la campagne sont donnés plus bas : un peuple marqué « secret » n'est
connu que de son joueur et du MJ ; il ne doit jamais apparaître dans un texte destiné aux joueurs.""")

NOMS_BIOMES = ["Mer ou lac", "Plaine", "Champs", "Forêt", "Forêt de pins", "Forêt profonde", "Marais", "Lande", "Désert", "Collines",
               "Montagnes", "Hauts sommets", "Neiges", "Terres de lave", "Terres inconnues", "Jungle"]
LETTRES_BIOMES = "~pcfFPmldkMSnvbj"
TYPES_LIEUX_IA = {
    "capitale": "Capitale", "cite": "Cité", "ville": "Ville", "village": "Village", "auberge": "Auberge", "tour": "Tour",
    "temple": "Temple", "forteresse": "Forteresse", "cite_naine": "Cité naine", "comptoir": "Comptoir d'or", "port": "Port",
    "mine": "Mine", "grotte": "Grotte, antre", "ruine": "Ruines", "tombeau": "Tombeau", "puits": "Puits de magie",
    "ile_volante": "Île volante", "camp": "Camp", "point": "Lieu-dit",
}
MODELES_PLAN_IA = {
    "crypte": "crypte : jusqu'à 7 salles reliées par des couloirs, plus une salle du trésor derrière une porte secrète (la dernière)",
    "grotte": "grotte : 4 à 8 zones naturelles, l'entrée en premier",
    "maison": "maison : 3 ou 4 pièces, jardin compris",
    "auberge": "auberge, rez-de-chaussée : salle commune, comptoir, cuisine, réserve, cour et écurie (environ 6 pièces)",
    "auberge-etage": "auberge, étage : un couloir et des chambres (environ 5 pièces)",
    # Les plans extérieurs (generateurs-dehors.js) : des zones à révéler une à une, l'entrée d'abord, puis les lieux
    # remarquables, puis les bâtiments.
    "ville": "ville : l'entrée, la place, les rues, puis les bâtiments (taverne, temple, forge, échoppes, entrepôt, maisons)",
    "village": "village : le chemin d'entrée, la place du puits, les champs, l'enclos, les prés, puis les maisons (forge, grange, chapelle)",
    "foret": "forêt : l'orée du bois, le pont ou le gué du ruisseau, la clairière, puis le sous-bois en zones",
    "montagne": "montagne : le pied de la montagne, le col, les lacets, la corniche, l'éboulis, puis les pentes en zones",
    "desert": "désert : la piste, l'oasis, les ruines ensablées, puis les dunes et les rochers en zones",
    "marais": "marais : le bord du marais, l'îlot, puis les eaux et les roselières en zones, et la cabane de l'îlot",
    "riviere": "rivière : la route, le pont, le gué, puis les rives en zones",
    "cote": "côte : le chemin côtier, le ponton, la plage, puis les dunes, les rochers et le large, et la cabane du pêcheur",
    "camp": "camp : le camp et les tentes dans la palissade, le sentier, devant la porte, puis les bois en zones",
    "ruines": "ruines : la cour, la place d'armes, le chemin, la brèche, puis les abords, et la tour encore debout",
}
RANGS_COMBAT = {
    "sbire": {"nom": "Sbire", "att": 45, "degats": "1D6", "armure": 0, "sante": "5", "defense": 0, "nbDef": 0},
    "soldat": {"nom": "Soldat", "att": 55, "degats": "1D8", "armure": 1, "sante": "10", "defense": 0, "nbDef": 0},
    "elite": {"nom": "Élite", "att": 65, "degats": "1D10", "armure": 2, "sante": "16", "defense": 50, "nbDef": 1},
    "boss": {"nom": "Boss", "att": 70, "degats": "2D6", "armure": 2, "sante": "8 × PJ", "defense": 50, "nbDef": 1, "attaques": 2},
}
REGLES_COMBAT = """Règles de rencontre de l'atelier (bestiaire du kit, calibré par simulation) :
- rangs : sbire (attaque 45 %, 1D6, armure 0, Santé 5, aucune défense) ; soldat (55 %, 1D8, armure 1, Santé 10, aucune défense) ;
  élite (65 %, 1D10, armure 2, Santé 16, une défense par tour à 50 %) ; boss (70 %, deux attaques par tour, 2D6, armure 2,
  Santé 8 par aventurier, 7 au niveau 1, une défense par tour à 50 %) ;
- compositions de référence pour n aventuriers : facile = n sbires ; normale = n soldats ; difficile = n/2 élites ;
  épique = un boss et n/2 sbires. Au-delà, la rencontre devient mortelle ;
- les capacités particulières (régénération, meute, venin, peur…) s'écrivent en clair pour le MJ."""


def bloc_texte(contenu: str, cache: str | None = None) -> dict:
    bloc = {"type": "text", "text": contenu}
    if cache:
        bloc["cache_control"] = {"type": "ephemeral", "ttl": cache}
    return bloc


def fichiers_bible() -> list[Path]:
    return sorted((bible_api.LORE / "bible").glob("*.md"), key=lambda f: (bible_api.ORDRE_BIBLE.index(f.stem) if f.stem in bible_api.ORDRE_BIBLE else 99, f.stem))


def canon_leger() -> str:
    morceaux = []
    for titre, chemin in (("Glossaire du canon", bible_api.LORE / "glossaire.md"), ("Le ton et la table", bible_api.LORE / "bible" / "ton-et-table.md")):
        if chemin.is_file():
            morceaux.append(f"# {titre}\n\n{bible_api.lire_lore(chemin)}")
    return "\n\n".join(morceaux) or "(canon indisponible)"


def canon_complet() -> str:
    morceaux = [f"# Bible : {bible_api.titre_md(bible_api.lire_lore(f), f.stem)}\n\n{bible_api.lire_lore(f)}" for f in fichiers_bible() if f.stem != "ton-et-table"]
    return "\n\n".join(morceaux) or "(bible indisponible)"


def court(valeur, limite: int = 220) -> str:
    t = " ".join(utilitaires.texte(valeur).split())
    return t if len(t) <= limite else t[: limite - 1].rstrip() + "…"


def resume_aventurier(a: dict) -> str:
    caracs = {"Physique": a.get("physique"), "Social": a.get("social"), "Mental": a.get("mental")}
    comps = []
    for c in a.get("competences") or []:
        if not isinstance(c, dict) or not utilitaires.texte(c.get("nom")).strip():
            continue
        avec = utilitaires.texte(c.get("avec")) or "Physique"
        total = int(utilitaires.nombre(caracs.get(avec))) + int(utilitaires.nombre(c.get("bonus")))
        comps.append(f"{utilitaires.texte(c.get('nom')).strip()} {total} % (+{int(utilitaires.nombre(c.get('bonus')))} {avec.lower()})")
    armes = [f"{utilitaires.texte(w.get('nom'))} {utilitaires.texte(w.get('degats'))}".strip() for w in a.get("armes") or [] if isinstance(w, dict) and utilitaires.texte(w.get("nom")).strip()]
    dons = [utilitaires.texte(d.get("nom")) for d in a.get("dons") or [] if isinstance(d, dict) and utilitaires.texte(d.get("nom")).strip()]
    peuple = utilitaires.texte(a.get("peuple")) + (" (secret : inconnu des autres joueurs)" if a.get("peuple_cache") else "")
    metier = utilitaires.texte(a.get("specialite")) or ", ".join(utilitaires.texte(v) for v in a.get("vocations") or [])
    lignes = [f"- **{utilitaires.texte(a.get('nom')) or 'Sans nom'}**, joué par {utilitaires.texte(a.get('joueur')) or '?'} : {peuple}, {metier}, élément {utilitaires.texte(a.get('element')) or 'aucun'}, niveau {a.get('niveau') or 1}.",
              f"  Physique {caracs['Physique']}, Social {caracs['Social']}, Mental {caracs['Mental']} ; Santé {a.get('sante')}, Psy {a.get('psy')} ; posture {utilitaires.texte(a.get('posture')) or '?'}.",
              f"  Compétences : {', '.join(comps) or 'aucune'}. Armes : {', '.join(armes) or 'aucune'}. Dons : {', '.join(dons) or 'aucun'}."]
    for cle, titre in (("pourquoi", "Pourquoi il part à l'aventure"), ("jamais", "Ne fera jamais"), ("themes", "Thèmes")):
        if a.get(cle):
            lignes.append(f"  {titre} : {court(a[cle], 200)}")
    return "\n".join(lignes)


def etat_campagne() -> str:
    try:
        campagne = utilitaires.lire(config.CAMPAGNE) if config.CAMPAGNE.exists() else {}
    except (OSError, ValueError):
        campagne = {}
    aventuriers = {a.get("id"): a for a in utilitaires.lire_tout(config.AVENTURIERS)}
    lieux = {l.get("id"): l for l in utilitaires.lire_tout(config.LIEUX)}
    # Un MJ invité (cloisonnement.py) : ses fiches seulement (lire_tout), la tablée sans les secrets des héros, ni le nom
    # de la campagne du MJ principal ni ses réputations ; puis le monde tel que les joueurs le connaissent, au masque.
    invite = cloisonnement.est_invite() and cloisonnement.refuse("contexte-entier")
    if invite:
        aventuriers = {i: tv_fiches.heros_pour_l_invite(a) for i, a in aventuriers.items()}
        campagne = {"niveau": campagne.get("niveau"), "tablee": campagne.get("tablee")}
    parties = [f"# État de la campagne\n\nCampagne « {utilitaires.texte(campagne.get('nom')) or 'sans nom'} », niveau {campagne.get('niveau') or 1}."]
    if invite:
        parties = [f"# L'atelier du MJ invité\n\nLe groupe est de niveau {campagne.get('niveau') or 1}. Ses quêtes annexes et ses fiches suivent."]
    tablee = [aventuriers[t["aventurier"]] for t in campagne.get("tablee") or [] if isinstance(t, dict) and t.get("actif") is not False and t.get("aventurier") in aventuriers]
    if not tablee:
        tablee = [a for a in aventuriers.values() if a.get("tablee") is not False]
    parties.append("## La tablée\n\n" + ("\n".join(resume_aventurier(a) for a in tablee) or "Personne pour l'instant."))
    if campagne.get("reputations"):
        parties.append("## Réputations\n\n" + "\n".join(f"- {utilitaires.texte(r.get('region'))} : {court(r.get('souvenir'))}" for r in campagne["reputations"] if isinstance(r, dict)))
    if lieux:
        parties.append("## Lieux de l'atelier\n\n" + "\n".join(
            f"- {utilitaires.texte(l.get('nom'))} ({TYPES_LIEUX_IA.get(l.get('type'), utilitaires.texte(l.get('type')))}, {'connu des joueurs' if l.get('connu') else 'inconnu des joueurs'}) : {court(l.get('resume'), 160)}"
            for _, l in sorted(lieux.items())))
    pnj = utilitaires.lire_tout(config.PNJ)
    if pnj:
        parties.append("## PNJ du carnet\n\n" + "\n".join(
            f"- {utilitaires.texte(p.get('nom'))}{' « ' + utilitaires.texte(p.get('surnom')) + ' »' if p.get('surnom') else ''} : {utilitaires.texte(p.get('role'))}"
            f"{', ' + utilitaires.texte(lieux.get(p.get('lieu'), {}).get('nom')) if p.get('lieu') in lieux else ''}, {utilitaires.texte(p.get('statut')) or 'vivant'},"
            f" {'connu' if p.get('connu') else 'inconnu'} des joueurs. Envie : {court(p.get('envie'), 140)}" for p in pnj))
    fils = [f for f in utilitaires.lire_tout(config.FILS) if f.get("actif") is not False]
    if fils:
        parties.append("## Fils d'intrigue en cours\n\n" + "\n".join(f"- {utilitaires.texte(f.get('nom'))} ({utilitaires.texte(f.get('faction'))}) : {court(f.get('but'), 200)}" for f in fils))
    seances = sorted(utilitaires.lire_tout(config.SEANCES), key=lambda s: utilitaires.nombre(s.get("numero")))
    if seances:
        # Les séances d'un MJ invité portent le nom de sa suite, comme au carnet des joueurs.
        suite_de = carnet_api.suites_des_seances()
        parties.append("## Séances\n\n" + "\n".join(
            f"- {suite_de(s) or 'Séance'} {s.get('numero') or '?'} ({utilitaires.texte(s.get('date')) or 'sans date'}{', close' if s.get('close') else ''}) : "
            f"{court(s.get('resume') or s.get('objectif'), 400)}" for s in seances))
    idees = [i for i in utilitaires.lire_tout(config.IDEES) if i.get("etat") != "ecartee"]
    if idees:
        parties.append("## Idées du MJ (à creuser ou retenues)\n\n" + "\n".join(f"- {court(i.get('texte'), 300)}" for i in idees[:80]))
    rencontres = utilitaires.lire_tout(config.RENCONTRES)
    if rencontres:
        parties.append("## Rencontres préparées\n\n" + "\n".join(f"- {utilitaires.texte(r.get('nom'))}" for r in rencontres))
    scenarios = utilitaires.lire_tout(config.SCENARIOS)
    if scenarios:
        parties.append("## Scénarios en cours d'écriture\n\n" + "\n".join(f"- {utilitaires.texte(s.get('nom'))} : {court(s.get('resume'), 300)}" for s in scenarios))
    if invite:
        parties.append(monde_pour_l_invite())
        return masquer("\n\n".join(p for p in parties if p))
    return "\n\n".join(parties)


def monde_pour_l_invite() -> str:
    """Pour le contexte d'un MJ invité : le monde tel que les joueurs le connaissent (le_monde, la projection qu'il lit par
    GET /api/monde : PNJ et lieux connus, au masque, sans ce qui nomme un secret), sans ses propres fiches, déjà dites."""
    monde = tv_medias.le_monde()
    siens = {tv_cartes.jeton("pnj", p["id"]) for p in utilitaires.lire_tout(config.PNJ) if p.get("id")} | {tv_cartes.jeton("lieux", l["id"]) for l in utilitaires.lire_tout(config.LIEUX) if l.get("id")}
    lieux = [l for l in monde["lieux"] if l.get("id") not in siens]
    pnj = [p for p in monde["pnj"] if p.get("id") not in siens]
    parties = []
    if lieux:
        parties.append("## Lieux connus des joueurs, dans le reste de la campagne\n\n" + "\n".join(
            f"- {utilitaires.texte(l.get('nom'))} ({TYPES_LIEUX_IA.get(l.get('type'), utilitaires.texte(l.get('type')))}) : {court(l.get('resume'), 160)}" for l in lieux))
    if pnj:
        parties.append("## PNJ connus des joueurs, dans le reste de la campagne\n\n" + "\n".join(
            f"- {utilitaires.texte(p.get('nom'))}{' « ' + utilitaires.texte(p.get('surnom')) + ' »' if p.get('surnom') else ''} : "
            f"{', '.join(x for x in (utilitaires.texte(p.get('role')), utilitaires.texte(p.get('peuple'))) if x) or 'rôle non dit'}" for p in pnj))
    return "\n\n".join(parties)


def secrets_de_l_autre() -> list:
    """Les secrets que le MJ qui lit ne tient pas : un PNJ ou un lieu inconnu de l'autre MJ, et pour un invité un peuple
    caché (cloisonnement.secret_vu). Sans invité, le MJ principal les tient tous : aucun."""
    qui = cloisonnement.destinataire()
    return [(s, f) for s, f in noms_caches.secrets_des_joueurs()
            if (qui != proprietes.PRINCIPAL if s.get("genre") == "peuple" else cloisonnement.auteur_du_secret(s) != qui)]


def sans_secret_d_un_autre(contenu: str, autres: list | None = None) -> str:
    """Le texte sans les lignes qui nomment un secret que le MJ qui lit ne tient pas (secrets_de_l_autre). Sans invité,
    le MJ principal les tient tous : rien ne bouge."""
    autres = secrets_de_l_autre() if autres is None else autres
    if not autres:
        return contenu
    return "\n".join(l for l in contenu.split("\n") if not secrets_dans(l, autres))


def etat_campagne_public(joueurs: bool = False) -> str:
    """L'état de la campagne tel que les joueurs le connaissent, pour les textes qu'ils liront (« Précédemment », histoire
    d'un aventurier) : la tablée sans peuple caché, les lieux et PNJ connus avec ce que la TV en montre, les « Précédemment »
    déjà lus. Ni PNJ ni lieu inconnu, ni fils, ni idées, ni rencontres, ni scénarios, ni notes du MJ.
    joueurs : pour une réponse qui va droit au joueur, sans relecture du MJ (l'aide à l'écriture). Ni le nom de la campagne
    (le titre du MJ peut annoncer l'intrigue), ni les réputations (des notes du MJ), et toute ligne qui nomme ce que les
    joueurs ne savent pas (un résumé de lieu, un rôle, un « Précédemment ») s'en va."""
    try:
        campagne = utilitaires.lire(config.CAMPAGNE) if config.CAMPAGNE.exists() else {}
    except (OSError, ValueError):
        campagne = {}
    aventuriers = {a.get("id"): a for a in utilitaires.lire_tout(config.AVENTURIERS) if a.get("id")}
    # Pour un MJ invité, ni le nom de la campagne du MJ principal ni ses réputations (des notes du MJ).
    if cloisonnement.est_invite() and cloisonnement.refuse("contexte-entier"):
        campagne = {"niveau": campagne.get("niveau"), "tablee": campagne.get("tablee")}
    tete = (f"Le groupe est de niveau {campagne.get('niveau') or 1}. " if joueurs else
            f"Campagne « {utilitaires.texte(campagne.get('nom')) or 'sans nom'} », niveau {campagne.get('niveau') or 1}. ")
    parties = [f"# Ce que savent les joueurs\n\n{tete}"
               "Les joueurs ne connaissent que ce qui suit et ce que disent les notes du meneur : tout autre personnage, lieu ou "
               "secret reste caché, ne le nomme pas."]
    tablee = [aventuriers[t["aventurier"]] for t in campagne.get("tablee") or [] if isinstance(t, dict) and t.get("actif") is not False and t.get("aventurier") in aventuriers]
    if not tablee:
        tablee = [a for a in aventuriers.values() if a.get("tablee") is not False]
    lignes = []
    for a in tablee:
        # Ce que la TV montre d'un aventurier : un peuple gardé secret n'y figure pas.
        pub = tv_fiches.aventurier_public(a)
        metier = utilitaires.texte(pub.get("specialite")) or ", ".join(utilitaires.texte(v) for v in pub.get("vocations") or [])
        traits = [x for x in (utilitaires.texte(pub.get("peuple")), metier, f"élément {utilitaires.texte(pub.get('element'))}" if pub.get("element") else "") if x]
        nom, joueur = utilitaires.texte(pub.get("nom")) or "Sans nom", utilitaires.texte(pub.get("joueur")) or "?"
        if joueurs:
            # Écrits par chaque joueur, lus par le modèle pour un autre, dont la réponse ne repasse pas par le MJ : ce qui ne
            # ressemble pas à un nom (une consigne glissée dans le nom d'un héros ou son peuple) n'y va pas.
            nom, joueur = nom_de_joueur(nom) or "Un héros", nom_de_joueur(joueur) or "?"
            traits = [t for t in (", ".join(m for m in (nom_de_joueur(v, 8, 60) for v in x.split(",")) if m) for x in traits) if t]
        lignes.append(f"- **{nom}**, joué par {joueur}"
                      f"{' : ' + ', '.join(traits) if traits else ''}, niveau {pub.get('niveau') or 1}.")
    parties.append("## La tablée\n\n" + ("\n".join(lignes) or "Personne pour l'instant."))
    if campagne.get("reputations") and not joueurs:
        parties.append("## Réputations\n\n" + "\n".join(f"- {utilitaires.texte(r.get('region'))} : {court(r.get('souvenir'))}" for r in campagne["reputations"] if isinstance(r, dict)))
    lieux = sorted(tv_cartes.lieux_connus().values(), key=lambda l: l["id"])
    if lieux:
        parties.append("## Lieux connus des joueurs\n\n" + "\n".join(
            f"- {utilitaires.texte(l.get('nom'))} ({TYPES_LIEUX_IA.get(l.get('type'), utilitaires.texte(l.get('type')))}) : {court(l.get('resume'), 160)}" for l in lieux))
    pnj = [tv_fiches.pnj_public(p) for p in utilitaires.lire_tout(config.PNJ, tout=True) if p.get("connu") and p.get("id")]
    if pnj:
        parties.append("## PNJ connus des joueurs\n\n" + "\n".join(
            f"- {utilitaires.texte(p['nom'])}{' « ' + utilitaires.texte(p['surnom']) + ' »' if p.get('surnom') else ''} : "
            f"{', '.join(x for x in (utilitaires.texte(p['role']), utilitaires.texte(p['peuple'])) if x) or 'rôle non dit'}" for p in pnj))
    lus = [s for s in sorted(utilitaires.lire_tout(config.SEANCES, tout=True), key=lambda s: utilitaires.nombre(s.get("numero"))) if s.get("close") and utilitaires.texte(s.get("precedemment")).strip()]
    if joueurs:
        # Comme le carnet (recit_a_relire) : un « Précédemment » qui reprend un nom piégé ou porte une adresse attend le MJ.
        pieges = carnet_api.noms_pieges(aventuriers.values())
        lus = [s for s in lus if not carnet_api.recit_a_relire(utilitaires.texte(s.get("precedemment")), pieges)]
    if lus:
        # Deux suites : celle du principal d'abord, puis chaque suite d'invité, sous son nom public.
        suite_de = carnet_api.suites_des_seances()
        suites = {s["id"]: suite_de(s) for s in lus if isinstance(s.get("id"), str)}
        if any(suites.values()):
            candidats_suite = noms_caches.secrets_des_joueurs()
            suites = {k: carnet_api.suite_publique(v, candidats_suite) for k, v in suites.items()}
            lus.sort(key=lambda s: suites.get(s.get("id")) or "")
        parties.append("## Ce qui a déjà été lu aux joueurs\n\n" + "\n".join(
            f"- {suites.get(s.get('id')) or 'Séance'} {s.get('numero') or '?'} ({utilitaires.texte(s.get('date')) or 'sans date'}) : {court(s.get('precedemment'), 400)}" for s in lus))
    if not joueurs:
        # Ce que savent les joueurs vient des deux MJ (l'union) : une ligne qui nomme un secret de l'autre ne part pas.
        return sans_secret_d_un_autre(masquer("\n\n".join(parties)))
    candidats = noms_caches.secrets_des_joueurs()
    lignes = [l for l in masquer("\n\n".join(parties)).split("\n") if not secrets_dans(l, candidats) and not contient_nom_cache(l)]
    return "\n".join(lignes)


# Ce que le modèle apprend de plus pour un MJ invité. Ce paragraphe sépare aussi son cache de celui du MJ principal :
# le cache se lit par début identique, l'un ne profite jamais du contexte de l'autre ni ne le prolonge.
CONSIGNE_INVITE = """Tu assistes ici un second meneur, invité par le MJ de la campagne à mener des quêtes annexes dans le même
monde, avec la même tablée. Ses quêtes comptent pour l'or, les objets et l'état des héros, pas pour leur niveau. Il ne connaît de
la campagne que ce qu'en savent les joueurs, plus ses propres fiches, données plus bas : ne présume rien d'autre. Un personnage,
un lieu ou un secret absent de ce qui t'est donné t'est inconnu ; tu n'inventes que ce qu'on te demande d'inventer."""


def canon_des_joueurs() -> str:
    """La bible telle qu'un MJ invité la lit (bible.py, liste blanche des joueurs) : ni « Mystères et flottements », ni
    rien qu'elle ne nomme pas."""
    morceaux = [f"# Bible : {bible_api.titre_md(bible_api.lire_lore(f), f.stem)}\n\n{bible_api.lire_lore(f)}" for f in fichiers_bible()
                if f.stem != "ton-et-table" and bible.ouvert_aux_joueurs(f"bible/{f.name}")]
    return "\n\n".join(morceaux) or "(bible indisponible)"


def contexte_de_l_invite(niveau: str) -> list[dict]:
    """Le préfixe d'un MJ invité, mêmes blocs et mêmes durées de cache que celui du MJ principal : la consigne et ce paragraphe,
    le canon léger au masque, la bible des joueurs (« complet »), puis son état de la campagne (etat_campagne,
    etat_campagne_public : ses fiches, la tablée sans ses secrets, le monde que connaissent les joueurs)."""
    blocs = [bloc_texte(f"{CONSIGNE_GENERALE}\n\n{CONSIGNE_INVITE}"), bloc_texte(masquer(canon_leger()), "1h")]
    if niveau == "complet":
        blocs.append(bloc_texte(masquer(canon_des_joueurs()), "1h"))
    blocs.append(bloc_texte(etat_campagne_public() if niveau == "public" else etat_campagne(), "5m"))
    return blocs


def contexte_ia(niveau: str = "leger") -> list[dict]:
    """Le préfixe commun, du plus stable au plus changeant : la consigne et le canon gardés une heure en cache, l'état de
    la campagne cinq minutes (il change dès qu'une fiche bouge). « public », pour un texte que les joueurs liront : la
    même consigne et le même canon (le cache reste commun), puis l'état de la campagne réduit à ce qu'ils savent.
    Pour un MJ invité, le sien (contexte_de_l_invite) : son cache est à part."""
    if cloisonnement.est_invite() and cloisonnement.refuse("contexte-entier"):
        return contexte_de_l_invite(niveau)
    blocs = [bloc_texte(CONSIGNE_GENERALE), bloc_texte(canon_leger(), "1h")]
    if niveau == "complet":
        blocs.append(bloc_texte(canon_complet(), "1h"))
    blocs.append(bloc_texte(etat_campagne_public() if niveau == "public" else etat_campagne(), "5m"))
    return blocs


def sources_des_liens() -> list[Path]:
    return [*fichiers_bible(), bible_api.LORE / "glossaire.md", *[f for _, f in bible_api.fiches_episodes()], *(bible_api.LORE / "saisons").glob("*.md")]


redaction.regler_contexte(contexte_ia)
redaction.regler_journal(config.DONNEES / "journal-ia.jsonl")
redaction.regler_lots(config.DONNEES / "lots-ia.json")
redaction.regler_sources_liens(sources_des_liens)
# Deux MJ (budget_mj.py, lot MJ-5) : chaque appel est noté pour le MJ de la requête, le budget d'un invité se vérifie avant.
budgets = budget_mj.Budgets(config.DONNEES)
redaction.regler_qui(budget_mj.qui_courant)
redaction.regler_garde(budgets.garde)
app.include_router(budget_mj.routes(budgets, utilitaires.corps_objet))


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import carnet_api, noms_caches, bible_api, tv_cartes, tv_fiches, tv_medias  # noqa: E402
