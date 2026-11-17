# Fonctionnement

Les mécanismes et les règles de l'atelier, dans l'ordre où ils ont été posés.

- FastAPI : `app/main.py` charge les modules de `app/api/` (voir `architecture.md`), fichiers statiques servis tels quels à l'atelier (`app/static/`, modules ES).
- Barre des onglets en trois familles, sur deux lignes : Préparer (Scénarios, Cartes, Lieux, PNJ, Idées, Bible), La
  compagnie (Aventuriers, Auberge, Boutiques, Sanctuaire) et Jouer (Séances, Combats, Table, Règles maison) en Cinzel
  sur la première, les onglets de la famille ouverte dessous, toujours dans le même ordre et à la même place (MacBook,
  iPad, iPhone déplié). La famille ouverte est celle de la page ; un clic sur un autre mot montre ses onglets sans
  quitter la page (Échap ou un clic ailleurs y remettent celle de la page). Le jour d'une séance (datée d'aujourd'hui,
  pas close), « Jouer · ce soir » : ses onglets restent au bout de la seconde ligne, après « Ce soir », si la place le
  permet (`js/commun/onglets.js`, `css/entete.css`, `node outils/verifier_onglets.mjs`). Flèches entre les mots et les onglets,
  arrêtées là : elles ne déplacent pas le pion choisi dans un plan. La hauteur de l'en-tête vit dans `--haut-entete`
  (84 px dans l'atelier, 52 au coin des joueurs) : toute page pleine hauteur s'y règle (`calc(100vh - var(--haut-entete))`).
- Touches (`js/commun/touches.js`, `js/commun/echap.js`) : hors d'un champ, N journal, R règles, H horloge, T Tableau, I idée, et « ? »
  ou le lien « Touches » à côté du nom de l'atelier pour la carte des raccourcis sur parchemin (une par écran :
  l'atelier, la carte, le plan ; les outils lus dans les listes des éditeurs). La lettre est écrite sur les boutons
  Tableau, Journal et Idée, et en 11 px sur les outils ; le pied du Tableau rappelle « N journal · R règles · H horloge ·
  Entrée main suivante ». Échap, partout pareil : dans un dialogue, il le ferme du premier coup (même depuis une
  recherche remplie) ; dans un champ, il rend la main à la page ; sinon il ferme un menu (familles, Exporter, Musique,
  sommaire), puis le Tableau, qui sur une carte ou un plan ne se ferme ainsi que si on vient de le toucher.
- Une TV LG sous webOS 6 a un navigateur Chromium 79. La construction de l'image transpile pour elle
  `table.js` et ses modules en un seul script (esbuild, cible `chrome79`, dans `app/static/tv/`, non versionné) ;
  `compat-tv.js` lui apporte les fonctions plus récentes (`structuredClone`, `.at()`, `replaceAll`…). Lancée sans
  construction, `table.html` se rabat sur les modules sources, pour un navigateur récent. `table.css` et `affiches.css`
  restent lisibles par Chromium 79 : ni `inset`, ni `gap` dans une flexbox (celui d'une grille passe), ni
  `aspect-ratio`, ni `:has()` (le corps de page reçoit `avec-pnj`, `avec-heros`), ni `outline` autour d'un bord arrondi.
  `tests/test_tv.py` le vérifie.
- La TV ne recharge une carte entière que si son fond change (terrain, dimensions, graine, style) : brouillard, tracés,
  lieux, noms et groupe sont repris sur place. Ses requêtes abandonnent au bout de 8 secondes, une réponse arrivée après
  un état plus récent est ignorée, et le « Précédemment » comme le carton-titre ne sont relus que pour une autre séance ou
  un nouveau `seance_maj`.
- Style peint des cartes (`js/carte/peint*.js`) : relief calculé par zone dans des Web Workers (`tv/peint-worker.js` pour
  la TV, repli sans worker) ; champs et habillage seulement autour de ce que voient les joueurs, le reste plus pâle pour le
  MJ. Fond de la TV : l'éditeur le peint d'après la carte publique et le dépose (`PUT /api/cartes/<id>/fond`, PNG vérifié,
  `data/fonds-peints/`) ; la TV le reçoit par jeton et ne repeint que ce qui s'est ajouté depuis, et une image d'où quelque
  chose a disparu n'est plus servie (la TV peint alors elle-même).
- Polices en WOFF2 réduites au latin du projet (pyftsubset, axes variables gardés). Pour ajouter un caractère, repartir
  des TTF d'origine (dans l'historique git, avant le passage au WOFF2) :
  `pyftsubset X.ttf --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+25C6,U+FEFF,U+FFFD" --layout-features+=lnum,tnum,onum,pnum --flavor=woff2`
  (paquets `fonttools` et `brotli`).
- Données en JSON dans `data/` (volume) : `cartes/`, `plans/`, `lieux/`, `pnj/`, `aventuriers/`, `contrats/`, `rumeurs/`, `fils/`,
  `seances/`, `rencontres/`, `idees/`, `scenarios/`, `boutiques/`, `sanctuaire.json`, `campagne.json`, `images/`, `table.json`. Chaque fiche s'enregistre avec sa version : un
  écran en retard reçoit un refus (409), puis l'atelier fusionne (ce que cet écran a changé passe par-dessus, le reste
  vient du serveur) ; seule une carte demande de recharger. Montrer une fiche à la table ne change que ses champs
  (`PATCH`). Les illustrations ne changent pas la version d'une fiche. Une version de chaque carte et de
  chaque fiche est gardée toutes les 5 minutes d'édition dans `data/historique/` (40 au plus, 200 pour un scénario) ; les suppressions vont dans
  `data/corbeille/`. La file des illustrations survit à un redémarrage (`data/file-illustrations.json`).
- Serveur qui ne répond pas (arrêté, en train de redémarrer, réseau coupé : statut 0, 502 à 504 et les codes de
  Cloudflare) : l'enregistrement raté repart seul à 3 s, à 10 s, puis toutes les 30 s, et tout de suite quand le réseau
  revient ou qu'on revient sur l'onglet (`js/commun/reessai.js`, branché sur les plans, les cartes et leurs lieux, les PNJ, les
  aventuriers, le coin des joueurs, les scénarios, les séances, l'auberge, la balance et le combat). L'état affiché le dit
  (« Non enregistré, nouvel essai dans 8 s », puis « Nouvel essai… ») et un seul toast l'annonce, un autre quand le
  serveur répond de nouveau. Jamais après un conflit (409) ni un autre refus. Une page quittée garde ses essais ; tant
  que quelque chose n'est pas enregistré (en attente, en cours, raté), fermer ou recharger l'onglet demande confirmation.
- Ce qui part vers la TV (`/api/table/*` et le WebSocket) passe par des listes blanches, et chaque fiche y est
  désignée par un jeton opaque (HMAC, clé dans `data/.cle-jetons`) : ni identifiant, ni repère, ni nom d'image. Les
  images portent des noms tirés au sort ; le fond d'un plan arrive noirci hors des cases révélées ; un PNJ inconnu n'a
  ni nom ni portrait. Le nom caché de l'auberge est filtré à la sortie de toutes ces routes et de tout texte écrit par
  le modèle de rédaction (`app/table/masque.py`, qui en lit la liste dans `data/noms-caches.json`), même avec des
  caractères invisibles (trait d'union conditionnel, espaces de largeur nulle) qu'un copier-coller de PDF glisse dans un mot ou entre deux mots, et même collé au mot
  d'avant ; les invisibles sont retirés du texte public ; « l'auberge » suivie du nom ou du surnom
  caché devient « l'auberge » seule, plus « l'auberge l'auberge ».
- Table publique : le nom de `TABLE_PUBLIQUE` (et toute requête passée par Cloudflare) ne
  sert que la vue TV, en lecture. L'onglet Table l'ouvre ou la ferme (`PUT /api/table-publique`, `data/table-publique.json` ;
  sans réglage, elle est ouverte ; un réglage illisible la ferme). Fermée, un écran venu d'Internet ne reçoit que l'accueil,
  avec « Prochaine séance : dimanche 1er novembre à 14 h » (la plus proche séance non close datée, rien d'autre d'elle),
  et ses `/api/table/*` répondent 404 ; la TV du salon ne voit aucune différence. Les écrans du réseau local (maison, VPN)
  n'ont pas de limite, ceux d'Internet ont la leur (`ECRANS_MAX`, 24, et `ECRANS_PAR_ADRESSE`, 4 pour une même adresse) : la TV du salon a toujours sa place.
  `GET /api/table` donne `ecrans_salon`, `ecrans_internet` et `ecrans` (ceux qui voient ce que le MJ envoie).
- Garde-fous du serveur : requêtes d'écriture et WebSocket d'une autre origine refusés (dont `/ws/pointeur`, qui ne
  s'ouvre jamais à Internet ; ce qu'un écran envoie sur `/ws/table` ne pilote rien), nom d'hôte inconnu refusé
  (rebinding DNS ; ajouter un nom dans `ATELIER_HOTES` si besoin), corps limités en taille, images téléversées
  vérifiées, bornées à 40 Mpx et réécrites sans métadonnées, pas de `/docs`.
- Porte du réseau local (`app/mj/porte_lan.py`) : tant qu'aucun MJ invité n'existe, le LAN reste ouvert à tout appareil.
  Dès le premier invité (et pour de bon : `data/mj/porte-eveillee`), n'y entrent plus que les appareils reconnus
  (« Reconnaître cet appareil », bloc « Vos appareils » de l'onglet Aventuriers, ou une connexion sur le LAN : cookie
  `arriere-salle-appareil` de 400 jours, signé par `data/mj/cle-appareils`, rattaché au compte et à sa génération,
  « Oublier » le coupe), les outils du serveur (en-tête `X-Atelier-Outil`, le jeton de `data/mj/jeton-outils`, 0600)
  et le rendu PDF (jeton à usage unique, depuis la boucle locale) ; la TV, `/ws/table`, la sonde et la connexion
  restent libres, le reste renvoie à la connexion. Un script qui appelle l'atelier en `127.0.0.1:8323` ajoute
  l'en-tête : `{"X-Atelier-Outil": Path("data/mj/jeton-outils").read_text().strip()}`.
  `ATELIER_PORTE_LAN=eveillee` l'éveille sans invité (tests, essais).
- Cloisonnement des deux MJ (`app/mj/cloisonnement.py`, règles des routes dans `app/mj/acces_mj.py`) : chaque fiche des
  collections à auteur porte son champ `auteur` (absent : le MJ principal ; `outils/migrer_auteurs.py [--appliquer]` le pose,
  fiches, corbeille et versions) ; chaque MJ ne lit que les siennes, et de l'autre seulement ce que les joueurs en
  savent (`GET /api/monde`, la TV). Exception voulue : un PNJ ou un lieu que son auteur partage (`partage`, case « Partager avec l'autre MJ ») se lit
  entier chez l'autre MJ et se montre à la table, sans jamais s'y écrire (`lecture=True`, `cloisonnement.LECTURES_PARTAGEES`). `ATELIER_CLOISONNEMENT` : `veille` par défaut (une lecture interdite est notée dans
  `data/mj/cloisonnement.jsonl`, sans nom ni identifiant, rien n'est refusé), `strict` la refuse. Le strict avant tout
  compte invité. Toute nouvelle route se range dans `acces_mj.REGLES` (un test l'exige).
- Ce qui reste commun aux deux MJ (`app/mj/adresses.py`) : `/ws/atelier` porte à chaque page ce que voit la TV et ce qui
  est commun (sacs, salle, jets), et seulement à celles du MJ concerné sa boîte, le combat de sa séance, les pions bougés
  sur son plan, ses billets privés ; un relais de télécommande par compte (`pilotage.relais_du_lecteur`). L'état de la table
  porte `par`, le compte qui y a la main (absent : le MJ principal, jamais envoyé à la TV) : changer ce qu'elle montre quand
  l'autre l'a renvoie 409 avec `question`, que l'atelier et la télécommande posent (« La reprendre ? »,
  `js/mj/main-tv.js`) avant de renvoyer la requête avec `reprendre`. La boîte des demandes adresse chaque élément
  (`boite.pour_qui`) : un mot au MJ que le joueur a choisi (liste publiée pour le coin dans
  `propositions/demandes/.destinataires.json`, seulement quand un invité ouvert existe), un déplacement au MJ du plan,
  une commande à l'auteur de la boutique, le reste au principal ; Telegram ne parle que de ce qui revient au MJ principal. Trois
  horloges par MJ ; la TV montre les trois montrées touchées en dernier.
- L'atelier d'un MJ invité : la page de l'atelier porte son rôle (`<body data-role="invite">`, `js/mj/role.js`) ; son
  menu (`js/mj/menu-invite.js`) n'a que ses onglets (Plans au lieu de Cartes, « Le monde » en lecture, `js/mj/monde.js`,
  la tablée en lecture), ni campagne du MJ principal, ni joueurs et coin, ni sanctuaire, ni règles maison, ni réglages du compte
  principal. Il ne reçoit des fichiers de l'image que la liste fermée `acces_mj.STATIQUES_INVITE` (plus ce que la TV charge
  déjà en public) ; un test vérifie que chaque module y trouve ses imports et qu'aucun ne porte un secret du kit. Ce qui
  porte les fiches de départ du kit et ses secrets (`aventuriers/kit.js` et `campagne/pretires.js` qu'il relaie : les
  prétirés, à part des dons du livret, `campagne/dons.js` ; `pnj/kit.js` ; `auberge/kit.js` : la campagne, les rumeurs de l'aide-mémoire, le nom caché de
  l'auberge ; `carte/editeur.js`, `generateur.js`, `saison4.js`) n'est importé d'avance par aucun module commun : les
  pages du MJ principal le chargent à l'ouverture ou au clic. `GET /api/campagne` lui rend la tablée et le niveau, sans nom ni
  réputation (`campagne_api.campagne_pour_l_invite`) ; `GET /api/table` nomme dans `jetons` les références données sous leur
  jeton (la fiche de l'autre MJ), que les pages lisent comme la TV (`/api/table/…`).
- L'ouverture d'un MJ invité : un invité n'entre qu'avec les invitations ouvertes (`ATELIER_INVITATIONS=ouvertes`
  dans docker-compose.yml, `comptes_mj.INVITATIONS_OUVERTES`) **et** le
  cloisonnement en strict (`comptes_mj.invites_permis`, lu à chaque requête) : en veille, ni lien, ni connexion, ni
  session, ni appareil reconnu, et « Les MJ » le dit ; fermer un invité reste possible. Au réveil de la porte du LAN,
  le compte principal relit ses appareils : `appareils_a_relire` dans `data/mj/comptes.json`, la page marquée
  `data-appareils="a-relire"`, « Vos appareils » en tête avec l'avis jusqu'à « C'est relu »
  (`POST /api/mj/appareils/relus`) ; rien n'est oublié tout seul. Les séances d'un invité se numérotent à part :
  `suite` (« Quête annexe » par défaut, `PUT /api/mj/suite`, bloc « Votre suite au carnet » de son onglet Table,
  `js/mj/suite.js`) au carnet des joueurs, dans les « croisés », sur le carton d'épisode de la TV et dans le contexte de
  rédaction ; un nom qui dirait ce que les joueurs ne savent pas y reste « Quête annexe » (`carnet_api.suite_publique`). Sans
  invité, aucune réponse ne change.
- Surveillance : une sonde (Uptime Kuma, par exemple) peut ouvrir chaque minute l'atelier (`/table`, par l'adresse IP
  du serveur : la garde refuse le nom du conteneur), le coin des joueurs (`/`) et la table publique (`/table`), et
  chercher un mot de la page (« la table », titre de `table.html` ; « coin des joueurs », dans
  `joueurs/sans-lien.html`) pour qu'une page d'erreur en 200 ne passe pas pour une réponse : qui change ces mots change
  aussi la sonde (`tests/test_sondes.py` le rappelle).
- Terrain : une grille de cases (`terrain`, base64), lue avec un décalage de bruit pour des limites organiques
  (`app/static/js/carte/champs.js`) ; montagnes, arbres et icônes dessinés à la plume (`symboles.js`).
- Plans peints (`plan/peint.js`, `peint-mobilier.js`, `textures.js`) : murs en pans, ombres et lumière (foyers du mobilier, `plan.habillage`, clés dans `KITS_HABILLAGE`)
  se calculent une fois par état du plan puis se posent sur chaque tuile ; pour les joueurs, une case cachée n'a ni sol, ni mur, ni lumière, ni objet.
- Rédaction : `app/ia/redaction.py` (appels, journal des coûts `data/journal-ia.jsonl` avec l'attente `duree` en secondes
  depuis le 01/11, lots différés `data/lots-ia.json` relevés toutes les 5 minutes et envoyés sans marque de cache, liens
  vérifiés ; tarifs dans `TARIFS`, lecture du cache comprise : 0,05 × l'entrée sur Opus 5.5) et la fin de `app/api/ia_api.py` (contexte de campagne et routes). Le
  contexte est mis en cache (une heure pour la consigne et le canon, cinq minutes pour l'état de la campagne) ; le
  format JSON n'est pas imposé par l'API, car chaque schéma différent romprait ce cache : le schéma voyage dans la
  demande et le serveur vérifie le JSON reçu. Un refus du modèle est rejoué sur le modèle de repli recommandé.
- Rédaction de deux MJ (`app/ia/budget_mj.py`) : chaque appel est noté pour le MJ de la requête (`qui` : `mj:<compte>` ;
  le joueur pour l'aide à l'écriture ; sans `qui`, le MJ principal). Un invité reçoit son propre contexte (ses fiches, la tablée
  sans ses secrets, le monde que connaissent les joueurs, la bible des joueurs, au masque), dont le début diffère de
  celui du MJ principal : leurs caches ne se mêlent jamais. Chacun lit ses coûts, ses estimations et ses lots ; le MJ principal voit en
  plus le total et la part de chaque invité. Le budget du mois d'un invité (`budget_mois` de `data/mj/comptes.json`,
  3 $ par défaut, réglé dans « Les MJ ») se vérifie avant chaque appel, prix minimal de l'appel compris
  (`redaction.plancher`) : au-delà, l'appel ne part pas (402, ou le modèle local pour les PNJ, le « Précédemment » et
  les consignes d'image). Le MJ principal n'a pas de budget.
- Illustrations : `app/ia/illustrations.py`, charte des portraits dans `app/ia/charte.py`, réglages du modèle dans
  `app/comfy/reglages.json`. ComfyUI tourne sur l'hôte
  (port 8188) ; le conteneur le joint par `host.docker.internal` (installation : `docs/installation.md`).

