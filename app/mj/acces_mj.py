"""Ce que le MJ invité pourra faire de chaque route de l'atelier (deuxième accès MJ) : la table des règles.

Une règle par route (méthode et gabarit, tels que les déclare app.routes) :
  - « principal_seul » : au compte principal seul ; l'invité reçoit 404, comme pour une route qui n'existe pas (les
    liens des joueurs, la boîte des demandes et Telegram, les réglages du coin, les secrets des héros, le nom de
    l'auberge, la gestion des comptes MJ…) ;
  - « a_soi » : la route lit ou écrit des fiches des collections à auteur (proprietes.py), ou ce qui en dépend
    (corbeille, versions, recherche, rédaction) : chacun n'y trouve que les siennes ;
  - « commune » : la même pour les deux MJ (la musique, le pointeur, l'état des héros, la télécommande…) ;
  - « projection » : l'invité n'en lit que la projection publique, ce que la TV ou les joueurs en voient (la table, les
    héros sans leurs secrets, la bible des joueurs) ; elle ne s'écrit pas ;
  - « statique » : les fichiers du code de l'atelier ; l'invité n'en reçoit que la liste des siens (STATIQUES_INVITE,
    lot MJ-6 : les fiches de départ du kit portent ses secrets) ;
  - « libre » : sans compte (la connexion, l'invitation).

La Garde de main.py la tient depuis le lot MJ-3 (cloisonnement.py : en veille, une violation est notée ; en strict,
refusée). Une route qui n'y est pas rangée répond 404 à l'invité ; un test vérifie que chaque route de app.routes y est
(tests/test_mj_routes.py) : toute nouvelle route se range ici en même temps qu'elle s'écrit.

Fonctions pures : ce module ne lit aucun fichier.
"""
import re

from starlette.routing import Mount, compile_path

PRINCIPAL_SEUL = "principal_seul"
A_SOI = "a_soi"
COMMUNE = "commune"
PROJECTION = "projection"
STATIQUE = "statique"
LIBRE = "libre"
REGLES_CONNUES = (PRINCIPAL_SEUL, A_SOI, COMMUNE, PROJECTION, STATIQUE, LIBRE)

# Les collections de routes_fiches (main.py) : lister, créer, lire, enregistrer, modifier, jeter.
FICHES = ("lieux", "pnj", "contrats", "rumeurs", "fils", "seances", "rencontres", "plans", "idees", "boutiques",
          "documents", "scenarios")
ILLUSTREES = ("lieux", "pnj")


def _fiches(prefixe: str, regle: str, illustrees: bool) -> dict:
    sortie = {f"GET /api/{prefixe}": regle, f"POST /api/{prefixe}": regle}
    for m in ("GET", "PUT", "PATCH", "DELETE"):
        sortie[f"{m} /api/{prefixe}/{{ident}}"] = regle
    if illustrees:
        sortie[f"POST /api/{prefixe}/{{ident}}/illustrations"] = regle
        sortie[f"DELETE /api/{prefixe}/{{ident}}/illustrations"] = regle
        sortie[f"PUT /api/{prefixe}/{{ident}}/illustration"] = regle
    return sortie


REGLES: dict[str, str] = {
    # ---- les fichiers de l'image et les médias
    "* /static": STATIQUE,
    # Les noms des images sont tirés au sort : l'invité n'en connaît que ceux que lui donnent ses fiches et les projections.
    "* /media": COMMUNE,

    # ---- les pages
    "GET /": COMMUNE,
    "GET /connexion": LIBRE,
    "POST /connexion": LIBRE,
    "GET /deconnexion": LIBRE,
    "GET /connexion/invitation": LIBRE,
    "POST /connexion/invitation": LIBRE,
    "POST /connexion/invitation/etat": LIBRE,
    "GET /table": PROJECTION,
    "GET /fiche-seance": COMMUNE,
    "GET /feuille-combat": COMMUNE,
    "GET /billets": COMMUNE,
    "GET /telecommande": COMMUNE,
    "GET /carte-x": COMMUNE,
    "GET /document-imprime": COMMUNE,
    "GET /documents-imprimes": COMMUNE,
    # La fiche d'un héros entière (son histoire, « Ne fera jamais ») : au principal.
    "GET /fiche-aventurier": PRINCIPAL_SEUL,
    "GET /fiche-aventurier.pdf": PRINCIPAL_SEUL,

    # ---- qui est connecté, les comptes MJ
    "GET /api/moi": COMMUNE,
    "GET /api/mj/comptes": PRINCIPAL_SEUL,
    "POST /api/mj/comptes": PRINCIPAL_SEUL,
    "POST /api/mj/comptes/{ident}/lien": PRINCIPAL_SEUL,
    "POST /api/mj/comptes/{ident}/fermer": PRINCIPAL_SEUL,
    # Le budget de rédaction du mois d'un invité (budget_mj.py, lot MJ-5) : le MJ principal le règle ; l'invité lit le sien par
    # /api/ia/couts.
    "PUT /api/mj/comptes/{ident}/budget": PRINCIPAL_SEUL,
    # Les appareils reconnus sur le réseau local (porte_lan.py) : chacun les siens, ceux du compte de la requête.
    "GET /api/mj/appareils": COMMUNE,
    "POST /api/mj/appareils": COMMUNE,
    "DELETE /api/mj/appareils/{ident}": COMMUNE,
    "POST /api/mj/appareils/relus": COMMUNE,
    # Le nom de la suite de ses séances : le sien ; le principal reçoit 400.
    "PUT /api/mj/suite": COMMUNE,
    # « Changer mon mot de passe » (page Réglages, mot_de_passe_mj.py) : chacun le sien, celui du compte de la requête.
    "POST /api/mj/mot-de-passe": COMMUNE,

    # ---- les cartes (routes à part : la carte du monde du MJ principal ne se lit, pour l'invité, qu'en projection)
    "GET /api/cartes": A_SOI,
    "POST /api/cartes": A_SOI,
    "GET /api/cartes/{ident}": A_SOI,
    "PUT /api/cartes/{ident}": A_SOI,
    "DELETE /api/cartes/{ident}": A_SOI,
    "GET /api/cartes/{ident}/publique": A_SOI,
    "PUT /api/cartes/{ident}/fond": A_SOI,
    "POST /api/cartes/{ident}/peupler": A_SOI,
    "POST /api/cartes/{ident}/habiller": A_SOI,

    # ---- ce qui pend aux fiches à auteur
    "POST /api/seances/{ident}/journal": A_SOI,
    "DELETE /api/seances/{ident}/journal/{ligne}": A_SOI,
    "POST /api/seances/{ident}/journal/remettre": A_SOI,
    "GET /api/seances/{ident}/combat": A_SOI,
    "PUT /api/seances/{ident}/combat": A_SOI,
    "DELETE /api/seances/{ident}/combat": A_SOI,
    "PUT /api/seances/{ident}/combat/tv": A_SOI,
    "GET /api/scenarios/{ident}/consignes": A_SOI,
    "POST /api/scenarios/{ident}/reponses": A_SOI,
    "PATCH /api/scenarios/{ident}/reponses/{rid}": A_SOI,
    "PUT /api/scenarios/{ident}/relectures/{chapitre}": A_SOI,
    "DELETE /api/scenarios/{ident}/relectures/{chapitre}": A_SOI,
    "POST /api/scenarios/{ident}/relectures/{chapitre}/differee": A_SOI,
    "POST /api/flux/scenarios/{ident}/consignes": A_SOI,
    "POST /api/flux/scenarios/{ident}/relectures/{chapitre}": A_SOI,
    # La mise en page proposée d'un chapitre (scenarios_api.py, ia_api.py) : celle de ses scénarios.
    "PUT /api/scenarios/{ident}/mises-en-page/{chapitre}": A_SOI,
    "DELETE /api/scenarios/{ident}/mises-en-page/{chapitre}": A_SOI,
    "POST /api/scenarios/{ident}/mises-en-page/{chapitre}/differee": A_SOI,
    "POST /api/flux/scenarios/{ident}/mises-en-page/{chapitre}": A_SOI,
    # Les squelettes proposés pour une idée (squelettes_api.py) : ceux de ses idées.
    "POST /api/flux/idees/{ident}/squelette": A_SOI,
    "GET /api/idees/{ident}/squelette/etat": A_SOI,
    "DELETE /api/idees/{ident}/squelettes/{sid}": A_SOI,
    "POST /api/idees/{ident}/squelettes/{sid}/scenario": A_SOI,
    "GET /api/pnj/{ident}/carton": A_SOI,
    "POST /api/pnj/{ident}/identifiant": A_SOI,
    "POST /api/lieux/{ident}/identifiant": A_SOI,
    "POST /api/lieux/{ident}/redaction": A_SOI,
    "GET /api/plans/{ident}/deplacements": A_SOI,
    "POST /api/plans/{ident}/habiller": A_SOI,
    "POST /api/plans/programme": A_SOI,
    "GET /api/documents/{ident}/inconnus": A_SOI,
    "GET /api/documents/{ident}/imprime": A_SOI,
    "GET /api/corbeille": A_SOI,
    "POST /api/corbeille/{nom}/{fichier}/remettre": A_SOI,
    "POST /api/corbeille/{nom}/{ident}/annuler": A_SOI,
    "GET /api/versions/{nom}/{ident}": A_SOI,
    "GET /api/versions/{nom}/{ident}/{estampille}": A_SOI,
    "POST /api/versions/{nom}/{ident}/{estampille}/remettre": A_SOI,
    "GET /api/recherche": A_SOI,
    "GET /api/mentions/{nom}/{ident}": A_SOI,
    "GET /api/renommages": A_SOI,
    # Le masque dit quels secrets nomme un texte : ceux du lecteur par leur nom, ceux de l'autre MJ anonymisés
    # (« un nom que l'autre MJ garde secret », cloisonnement.secret_vu), jamais leur fiche.
    "POST /api/masque": A_SOI,
    # Les billets privés aux joueurs et les horloges : chacun les siens.
    "GET /api/prives": A_SOI,
    "POST /api/prives/billet": A_SOI,
    "POST /api/prives/document": A_SOI,
    "DELETE /api/prives/{ident}": A_SOI,
    "GET /api/horloges": A_SOI,
    "POST /api/horloges": A_SOI,
    "POST /api/horloges/avancer": A_SOI,
    "PATCH /api/horloges/{ident}": A_SOI,
    "DELETE /api/horloges/{ident}": A_SOI,

    # ---- la rédaction et les images (le contexte donné au modèle est celui du lecteur, lot MJ-5)
    "POST /api/precedemment/redaction": A_SOI,
    "POST /api/pnj-proposition": A_SOI,
    "POST /api/pnj-variantes": A_SOI,
    "POST /api/illustrations/prompt": A_SOI,
    "POST /api/illustrations": A_SOI,
    "GET /api/illustrations": A_SOI,
    "GET /api/illustrations/style": COMMUNE,
    "POST /api/images": COMMUNE,
    "GET /api/ia/couts": A_SOI,
    "GET /api/ia/lots": A_SOI,
    "GET /api/ia/estimations": COMMUNE,
    "GET /api/charte-visuelle": COMMUNE,
    "PUT /api/charte-visuelle": PRINCIPAL_SEUL,
    # La bibliothèque d'images des plans : une par MJ (champ « auteur » de chaque image). Chacun n'y lit, n'y
    # importe, n'y renomme et n'y retire que les siennes ; les images du principal sont celles d'avant (sans auteur).
    "GET /api/bibliotheque-images": A_SOI,
    "POST /api/bibliotheque-images": A_SOI,
    "PATCH /api/bibliotheque-images/{ident}": A_SOI,
    "DELETE /api/bibliotheque-images/{ident}": A_SOI,
    "POST /api/aventurier/histoire": PRINCIPAL_SEUL,

    # ---- la tablée : les héros sans leurs secrets ; leur état et leur sac changent aussi en quête annexe
    "GET /api/aventuriers": PROJECTION,
    "GET /api/aventuriers/{ident}": PROJECTION,
    "POST /api/aventuriers": PRINCIPAL_SEUL,
    "PUT /api/aventuriers/{ident}": PRINCIPAL_SEUL,
    "PATCH /api/aventuriers/{ident}": PRINCIPAL_SEUL,
    "DELETE /api/aventuriers/{ident}": PRINCIPAL_SEUL,
    "POST /api/aventuriers/{ident}/illustrations": PRINCIPAL_SEUL,
    "DELETE /api/aventuriers/{ident}/illustrations": PRINCIPAL_SEUL,
    "PUT /api/aventuriers/{ident}/illustration": PRINCIPAL_SEUL,
    "PATCH /api/aventuriers/{ident}/sac": COMMUNE,
    # Ce qu'un joueur confie au MJ seul (confie_mj.py) : un secret du héros, au principal.
    "POST /api/aventuriers/{ident}/confie/lu": PRINCIPAL_SEUL,
    "GET /api/etats-heros": COMMUNE,
    "PATCH /api/etats-heros/{ident}": COMMUNE,

    # ---- les joueurs et leur coin : leurs liens, leurs comptes, leurs demandes, Telegram (au principal seul)
    "GET /api/joueurs": PRINCIPAL_SEUL,
    "POST /api/joueurs": PRINCIPAL_SEUL,
    "POST /api/joueurs/{ident}/provisoire": PRINCIPAL_SEUL,
    "DELETE /api/joueurs/{ident}": PRINCIPAL_SEUL,
    "POST /api/joueurs/{ident}/accueillir": PRINCIPAL_SEUL,
    "POST /api/joueurs/{ident}/relier": PRINCIPAL_SEUL,
    "DELETE /api/joueurs/{ident}/relier": PRINCIPAL_SEUL,
    "GET /api/joueurs/{ident}/apercu": PRINCIPAL_SEUL,
    "GET /api/carnet-joueurs/media/{nom}": PRINCIPAL_SEUL,
    "GET /api/carnet-joueurs": PRINCIPAL_SEUL,
    "PUT /api/carnet-joueurs": PRINCIPAL_SEUL,
    # La boîte des demandes et les commandes de l'échoppe : chaque MJ ne lit et ne tranche que ce qui lui revient
    # (boite.pour_qui : un mot qui lui est adressé, un déplacement sur son plan, une commande à sa boutique), le reste au
    # principal ; ses réglages (Telegram, la pause du coin) restent au principal.
    "GET /api/commandes": COMMUNE,
    "POST /api/commandes/{joueur}/{ident}/vendre": COMMUNE,
    "POST /api/commandes/{joueur}/{ident}/refuser": COMMUNE,
    "GET /api/demandes": COMMUNE,
    "GET /api/demandes/resume": COMMUNE,
    "POST /api/demandes/{joueur}/{ident}/accepter": COMMUNE,
    "POST /api/demandes/{joueur}/{ident}/refuser": COMMUNE,
    "POST /api/demandes/{joueur}/{ident}/annuler": COMMUNE,
    "GET /api/demandes/reglages": PRINCIPAL_SEUL,
    "PUT /api/demandes/reglages": PRINCIPAL_SEUL,
    "GET /api/lore/{joueur}/{ident}": PRINCIPAL_SEUL,
    "POST /api/lore/{joueur}/{ident}/trancher": PRINCIPAL_SEUL,
    "GET /api/aide-joueurs": PRINCIPAL_SEUL,
    "PUT /api/aide-joueurs": PRINCIPAL_SEUL,
    "GET /api/activites": PRINCIPAL_SEUL,
    "PUT /api/activites": PRINCIPAL_SEUL,
    "GET /api/activites/etat": PRINCIPAL_SEUL,
    "POST /api/activites/tableau": PRINCIPAL_SEUL,
    "GET /api/activites/demandes/{joueur}/{ident}": PRINCIPAL_SEUL,
    "GET /api/portraits-joueurs/{joueur}/{ident}/image": PRINCIPAL_SEUL,
    "POST /api/activites/demandes/{joueur}/{ident}/trancher": PRINCIPAL_SEUL,
    "GET /api/table-joueurs": PRINCIPAL_SEUL,
    "PUT /api/table-joueurs": PRINCIPAL_SEUL,
    "GET /api/bible-joueurs": PRINCIPAL_SEUL,
    "PUT /api/bible-joueurs": PRINCIPAL_SEUL,
    # Pendant une partie, l'un ou l'autre MJ voit les mains levées et demande un jet.
    "GET /api/salle": COMMUNE,
    "POST /api/salle/mains/{joueur}/{ident}": COMMUNE,
    "GET /api/jets": COMMUNE,
    "POST /api/jets/demander": COMMUNE,
    "POST /api/jets/mj": COMMUNE,
    "POST /api/jets/demandes/{joueur}/{ident}/retirer": COMMUNE,
    # Lot G : les dés d'aventure. Les gestes de jeu sont communs ; l'interrupteur et le total, un réglage de l'onglet Table
    # comme ceux du coin, au compte principal.
    "POST /api/jets/mesaventure": COMMUNE,
    "POST /api/jets/mesaventure/{joueur}/retirer": COMMUNE,
    "POST /api/jets/{ident}/aventure/annuler": COMMUNE,
    "POST /api/jets/{ident}/mesaventure/annuler": COMMUNE,
    "POST /api/des-aventure/passer": COMMUNE,
    "PUT /api/des-aventure": PRINCIPAL_SEUL,

    # ---- la campagne et ses réglages
    # La campagne : l'invité en lit la tablée et le niveau du groupe (main.campagne_pour_l_invite, lot MJ-6), pour mener
    # une quête annexe avec les mêmes héros ; il ne l'écrit pas.
    "GET /api/campagne": PROJECTION,
    "PUT /api/campagne": PRINCIPAL_SEUL,
    "GET /api/nom-auberge": PRINCIPAL_SEUL,
    "PUT /api/nom-auberge": PRINCIPAL_SEUL,
    # Les règles maison : les mêmes à la table pour les deux MJ ; l'invité les lit sans leur contexte, une note du MJ qui
    # cite ses scénarios (main.regle_vue), au masque.
    "GET /api/regles-maison": PROJECTION,
    "GET /api/regles-maison/{ident}": PROJECTION,
    "POST /api/regles-maison": PRINCIPAL_SEUL,
    "PATCH /api/regles-maison/{ident}": PRINCIPAL_SEUL,
    "DELETE /api/regles-maison/{ident}": PRINCIPAL_SEUL,
    # Les lignes et les voiles de la tablée : tout MJ qui la mène doit les connaître ; seul le principal les tient.
    "GET /api/confort": COMMUNE,
    "PUT /api/confort": PRINCIPAL_SEUL,
    "GET /api/sanctuaire": PROJECTION,
    "PUT /api/sanctuaire": PRINCIPAL_SEUL,
    "POST /api/sanctuaire/batiments": PRINCIPAL_SEUL,
    "PATCH /api/sanctuaire/batiments/{ident}": PRINCIPAL_SEUL,
    "DELETE /api/sanctuaire/batiments/{ident}": PRINCIPAL_SEUL,
    "POST /api/sanctuaire/versements": PRINCIPAL_SEUL,
    "DELETE /api/sanctuaire/versements/{vid}": PRINCIPAL_SEUL,

    # ---- le monde tel que les joueurs le connaissent : les PNJ et lieux connus, les cartes telles que la TV
    # les montrerait ; le même pour les deux MJ
    "GET /api/monde": PROJECTION,
    "GET /api/monde/cartes/{j}": PROJECTION,

    # ---- la bible : celle des joueurs pour l'invité, sans les Contrôles ni « Mystères et flottements »
    "GET /api/bible": PROJECTION,
    "GET /api/bible/document": PROJECTION,
    "GET /api/bible/recherche": PROJECTION,

    # ---- la TV : la tablée telle que la TV la voit ; la main sur l'écran (« par », la question « La reprendre ? ») et la
    # télécommande, communes
    "GET /api/table": PROJECTION,
    "PUT /api/table": COMMUNE,
    "PUT /api/table-publique": PRINCIPAL_SEUL,
    "GET /api/musique": COMMUNE,
    "PUT /api/musique": COMMUNE,
    "PUT /api/musique/ecoute": COMMUNE,
    # Le relais de la télécommande, un par MJ (main.relais_du_lecteur) : son téléphone ne voit que les écrans de son atelier
    # et ne confie ses commandes qu'à eux. Le canal des pages de l'atelier, adressé (adresses.py) : chaque page reçoit ce
    # que voit la TV et ce qui est commun, plus ce qui ne concerne que son MJ (sa boîte, son combat, ses plans, ses billets).
    "GET /api/telecommande": COMMUNE,
    "POST /api/telecommande/commandes": COMMUNE,
    "GET /api/telecommande/commandes/{numero}": COMMUNE,
    "DELETE /api/telecommande/commandes/{numero}": COMMUNE,
    "POST /api/telecommande/releve": COMMUNE,
    "POST /api/telecommande/commandes/{numero}/resultat": COMMUNE,
    "POST /api/telecommande/adieu": COMMUNE,
    "WS /ws/table": PROJECTION,
    "WS /ws/atelier": COMMUNE,
    "WS /ws/pointeur": COMMUNE,
}
for _prefixe in FICHES:
    REGLES.update(_fiches(_prefixe, A_SOI, _prefixe in ILLUSTREES))
# Ce que lit la TV : seulement ce qu'elle montre (lectures_publiques.py en ligne), sous des jetons opaques.
for _gabarit in ("/api/table/carte/{j}", "/api/table/carte/{j}/fond", "/api/table/pnj/{j}", "/api/table/planche",
                 "/api/table/rumeur/{j}", "/api/table/document/{j}", "/api/table/precedemment/{j}",
                 "/api/table/episode/{j}", "/api/table/aventurier/{j}", "/api/table/heros", "/api/table/fiches",
                 "/api/table/plan/{j}", "/api/table/plan/{j}/fond", "/api/table/plan/{j}/image/{oid}", "/api/table/vignette/{nom}",
                 "/api/table/lieu/{j}", "/api/table/boutique/{j}", "/api/table/combat/{j}", "/api/table/sanctuaire"):
    REGLES[f"GET {_gabarit}"] = PROJECTION


# Les fichiers de l'image que l'invité reçoit (« statique », lot MJ-6). D'abord ceux que la TV charge déjà en public (son
# script construit, ses polices, ses textures et ses images : main.STATIQUES_TABLE). Puis, nommés un à un comme FICHIERS au
# coin des joueurs, les modules et les feuilles de style des pages de son atelier : la page de l'atelier (atelier.js et tout
# ce qu'il importe, dont les modules des pages qui ne sont pas à lui, sans données), la télécommande, la fiche de séance, la
# feuille de combat, les billets, la carte X, les documents imprimés, la vue de la table, « Le monde » et ses appareils, le
# relief des cartes (peint-worker.js). Fermée par défaut : un module absent n'est pas servi. tests/test_mj_atelier_invite.py
# vérifie que chaque module de la liste trouve ses imports dans la liste et qu'aucun fichier servi ne porte un secret du kit.
#
# Jamais dans la liste : ce qui porte les fiches de départ du kit et ses secrets, que les modules communs chargent à la
# demande, chez le MJ principal seulement (import dynamique) : aventuriers/kit.js (les prétirés, leurs histoires et leurs « Ne fera
# jamais »), pnj/kit.js (les PNJ du kit, leurs secrets, le repère de l'auberge), auberge/kit.js (la campagne du kit : ses
# fils, ses affiches, ses rumeurs et leur fond, ses habitués, le nom caché de l'auberge), campagne/carte.js et
# campagne/pays.js (les lieux des cartes de la campagne, leurs secrets), carte/generateur.js et carte/saison4.js (qui les
# lisent), carte/editeur.js (qui les importe). Ni les pages
# du compte principal chargées à la demande : activites/catalogue.js, bible/joueurs-mj.js, charte.js, mj/les-mj.js,
# reglages/principal.js (les réglages du MJ principal dans la page Réglages, et les blocs qu'il importe : le coin, l'aide à
# l'écriture, la table et les pions des joueurs), et ce que charge le créateur des aventuriers.
MEDIAS_INVITE = re.compile(r"^/static/(?:tv|fonts|img|img/kit)/[\w-]+\.[\w.]+$")


def _noms(dossier: str, noms: str, extension: str) -> set:
    return {f"{dossier}/{nom}.{extension}" for nom in noms.split()}


STATIQUES_INVITE = frozenset(
    _noms("js", """api atelier carte-x telecommande""", "js")
    | _noms("js/commun", """accorder apercu-feuille clavier-editeur degats-doigt dialogue doigt echap estimation etat-jeu liens-atelier miniature onglets pointeurs-joueurs
        reessai temoin-enregistrement touches vierges""", "js")
    | _noms("js/corbeille", "corbeille corbeille-page", "js")
    | _noms("js/ecran-tv", "bouton-tv canal-table etat-tv pointeur relais-telecommande table-tv temoin-tv tv-commun tv-noire", "js")
    | _noms("js/horloges", "horloges", "js")
    | _noms("js/illustrations", "illustrations", "js")
    | _noms("js/jets", "des des-mj jets jets-tableau jets-telecommande reserve-table", "js")
    | _noms("js/musique", "musique musique-boutique musique-combat", "js")
    | _noms("js/pnj", "carnet carton-pnj tables", "js")
    | _noms("js/telecommande", "etat gestes notes rendu", "js")
    | _noms("js/tableau", "donnees etats-pions impro moments projecteur seance tableau tirages", "js")
    | _noms("js/atelier", "cartes etat pages routeur", "js")
    | _noms("js/auberge", "affiche auberge nom-auberge tables", "js")
    | _noms("js/aventuriers", "createur embleme etat regles tablee tables", "js")
    # Les données de la campagne que lisent les règles des aventuriers, leurs idées à tirer, le bestiaire et les tables de
    # tirage des PNJ et de la planche ; jamais le kit (campagne/pretires.js, que relaie aventuriers/kit.js,
    # campagne/auberge.js, campagne/pnj.js).
    | _noms("js/campagne", "bestiaire dons idees-heros nom noms planche regles", "js")
    | _noms("js/bible", "bible", "js")
    | _noms("js/boutiques", "boutiques commandes commun comptoir objets rayons-telecommande rayons-tv", "js")
    # Les libellés des cartes de la campagne, que la page des cartes (atelier/cartes.js) importe : ni lieu posé ni secret.
    | _noms("js/campagne", "cartes-libelles", "js")
    | _noms("js/carte", """biomes champs format geo noms outils peint-calcul peint-dessus peint-habillage peint-worker peint rendu
        symboles vue""", "js")
    | _noms("js/chercher", "chercher index-atelier listes moteur scenario", "js")
    | _noms("js/combats", """balance barre bestiaire combat composer fin flammes groupe plan-de-scene rencontre repere-mort retour-saisie
        simulation suivi""", "js")
    | _noms("js/confort", "confort themes", "js")
    | _noms("js/demandes", "activites boite confie lore portraits", "js")
    | _noms("js/documents", "documents imprime rendu seance tv", "js")
    | _noms("js/idees", "idees squelette", "js")
    | _noms("js/joueurs", "carte-coin etat-carnet", "js")
    | _noms("js/liens", "dans-les-scenarios", "js")
    | _noms("js/lieux", "fiche-lieu jeter-carte nouveau-lieu panneau-lieu", "js")
    | _noms("js/lore", "ecart", "js")
    | _noms("js/mj", "appareils etats-joueurs main-tv menu-invite monde partage role suite", "js")
    | _noms("js/plan", """brume dehors-dessin dehors-peint editeur-images editeur-pions editeur entrer feu figurine generateurs
        generateurs-dehors groupe-pions images importer-uvtt jauges mobilier-plus modele
        lumieres lumieres-menu mouvements-joueurs murs-plus palette-meubles peint-mobilier-plus peint-mobilier peint pions reglages-decor rendu
        sang sang-menu sols-plus textures uvtt vue""", "js")
    | _noms("js/prives", "telephone", "js")
    | _noms("js/regles", "aide-memoire commun rapide regles", "js")
    # La page Réglages : ce qu'y voit chaque MJ ; les réglages du principal (reglages/principal.js) n'y sont pas.
    | _noms("js/reglages", "mot-de-passe redaction reglages", "js")
    | _noms("js/salle", "mains-tableau mains-telecommande salle", "js")
    | _noms("js/sanctuaire", "dessin sanctuaire", "js")
    | _noms("js/scenarios", "consignes fiches liens-courts lier-en-ecrivant mise-en-page rendu scenarios", "js")
    | _noms("js/seances", """avant-de-jouer billets billets-page compagnie feuille-combat fiche fils jouer-scene
        journal liens-scene ouverture pour-le-carnet propose proposer-liens scene-suivante seance-en-cours
        seance-suivante seances sous-la-main""", "js")
    | _noms("css", """activites affiches atelier billets billets-suite boutiques carnet-mj carte-x carton-pnj chercher combat
        comptoir confie-mj confort corbeille createur demandes document-imprime documents documents-atelier doigt echoppe-tv
        editeurs entete etroit feuille-combat fiche fil-seance filets flammes horloges horloges-tv jet-tv jets jeu-correctifs jouer liens lieux
        lore-mj lumieres main-tv monde pions-images pointeurs-joueurs portraits-mj preparer prives-atelier reglages regles salle sang sanctuaire squelettes table tableau-aides
        telecommande telecommande-compact touches tv-atelier""", "css")
)


def statique_de_l_invite(chemin: str) -> bool:
    """Un fichier de l'image (« /static/… ») que reçoit un MJ invité."""
    return bool(MEDIAS_INVITE.match(chemin)) or (chemin.startswith("/static/") and chemin[len("/static/"):] in STATIQUES_INVITE)


def routes_a_plat(routes, contexte=None):
    """(route, chemin) de chaque route, y compris celles des routeurs inclus (include_router), dans l'ordre où l'appli
    les essaie. Les FastAPI récents gardent un routeur inclus entier (« _IncludedRouter ») ; les anciens en copiaient
    les routes."""
    for r in routes:
        if hasattr(r, "original_router") and hasattr(r, "include_context"):
            ctx = r.include_context if contexte is None else contexte.combine(r.include_context)
            yield from routes_a_plat(r.original_router.routes, ctx)
        else:
            yield r, (contexte.path_for(r) if contexte is not None and hasattr(contexte, "path_for") else r.path)


def cles_de(route, chemin: str) -> list[str]:
    """Les clés de la table pour une route : « MÉTHODE gabarit », « WS gabarit » ou « * préfixe » (un montage)."""
    if isinstance(route, Mount):
        return [f"* {chemin}"]
    methodes = getattr(route, "methods", None)
    if methodes:
        return [f"{m} {chemin}" for m in sorted(methodes) if m != "HEAD"]
    return [f"WS {chemin}"]


class Table:
    """La table compilée : (motif, méthodes, clé de la route, règle) dans l'ordre de l'appli. Une route sans règle y
    est avec None : elle répondra 404 à l'invité."""

    def __init__(self, entrees: list):
        self.entrees = entrees

    def trouver(self, methode: str, chemin: str) -> tuple | None:
        """(clé, règle) de la route qui servirait cette requête (HEAD comme GET ; « WS » pour un WebSocket), ou None."""
        methode = "GET" if methode.upper() == "HEAD" else methode.upper()
        for motif, methodes, cle, regle in self.entrees:
            if (methodes is None or methode in methodes) and motif.match(chemin):
                return cle, regle
        return None

    def regle(self, methode: str, chemin: str) -> str | None:
        """La règle de la route qui servirait cette requête, ou None."""
        trouvee = self.trouver(methode, chemin)
        return trouvee[1] if trouvee else None

    def cle(self, methode: str, chemin: str) -> str | None:
        """Le gabarit de la route (« GET /api/pnj/{ident} ») : ce que note le journal de veille, jamais l'adresse."""
        trouvee = self.trouver(methode, chemin)
        return trouvee[0] if trouvee else None

    def non_rangees(self) -> list[str]:
        return [cle for _m, _ms, cle, regle in self.entrees if regle is None]


def compiler(routes, regles: dict | None = None) -> Table:
    regles = REGLES if regles is None else regles
    entrees = []
    for route, chemin in routes_a_plat(routes):
        if isinstance(route, Mount):
            motif = re.compile(rf"^{re.escape(chemin.rstrip('/'))}(/.*)?$")
            entrees.append((motif, None, f"* {chemin}", regles.get(f"* {chemin}")))
            continue
        motif = compile_path(chemin)[0]
        for cle in cles_de(route, chemin):
            methode = cle.split(" ", 1)[0]
            entrees.append((motif, {methode}, cle, regles.get(cle)))
    return Table(entrees)


def en_trop(routes, regles: dict | None = None) -> list[str]:
    """Les clés de la table qu'aucune route ne porte plus (une route renommée ou retirée)."""
    regles = REGLES if regles is None else regles
    portees = {cle for route, chemin in routes_a_plat(routes) for cle in cles_de(route, chemin)}
    return sorted(set(regles) - portees)
