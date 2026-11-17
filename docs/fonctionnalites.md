# Ce que fait l'Arrière-salle

Le détail, onglet par onglet. Le plan du code est dans `architecture.md`, l'exploitation dans `exploitation.md`.

**Cartes.** La carte du monde de la campagne (celle du pack, ou « Le Val Clos » de la campagne d'exemple) se génère
entière : relief, mers, rivières calculées par écoulement, routes tracées sur le relief, et les lieux de la campagne. Ce que la campagne ne situe pas est
posé en « position à valider » (cercle rouge pointillé, vue MJ seulement). Une carte vierge se peint à la main.
« Détailler une région » encadre une zone et en tire une carte plus fine (mêmes côtes, rivières, routes et lieux).

Outils : sélection (V), terrain (B), lieu (L), rivière, route, chemin ou frontière (R, route automatique qui suit le
terrain), nom de région (E), terres connues des joueurs (F), groupe et son voyage (J, comme les pions des plans), mesure
en jours de marche (G, comme sur les plans), pointeur pour la TV (C, comme sur les plans).
Ctrl+Z et Ctrl+Y, `0` pour recadrer, `[` et `]` pour la taille du pinceau, espace ou clic droit pour déplacer la vue.
Sur le pavé tactile, quel que soit l'outil (cartes et plans) : glisser à deux doigts déplace la vue, pincer zoome au
rythme des doigts, Cmd + deux doigts zoome aussi. Avec une souris, choisir « Souris » dans la barre (deux icônes à côté
de l'export, retenu sur ce navigateur ; par défaut pavé sur un Mac, souris ailleurs) : la molette zoome comme avant.
Ces deux icônes n'ont pas la place dans une fenêtre de 821 à 1199 px de large ni sur un écran tactile : le choix retenu
(ou celui par défaut) s'applique alors sans elles.
Au doigt (iPad, iPhone), cartes et plans : une action (révéler une pièce, poser des pions, une porte, un lieu, le groupe…)
part au lever du doigt, un trait au pinceau après un court instant ou un petit glissé, et un doigt qui glisse déplace la
vue. Un deuxième doigt (pincement) annule ce que le premier allait faire et défait le trait commencé, sans rien
enregistrer ni montrer à la TV. À la souris, Échap pendant un trait du plan le défait aussi.

**Deux rendus** du même plan : couleur (TV) et parchemin (impression). Export PNG en vue MJ ou joueurs.

**Plans intérieurs.** Sous les cartes, « Nouveau plan » : une auberge (rez-de-chaussée et étage, même emprise pour une même
graine), une maison, une crypte, une grotte, ou un plan vierge. On trace les pièces sur un quadrillage (1,5 m par case) et
les murs se posent seuls : droits pour une salle, parois de roche pour une grotte, aucun pour un extérieur. Portes (double,
passage, fenêtre, grille, secrète, verrouillée), une quarantaine de meubles, pions (la tablée, les adversaires du bestiaire
ou d'une rencontre, les PNJ du carnet), textes, mesure en mètres ; annulation, export PNG. Une image trouvée ailleurs peut
servir de fond, calée sur le quadrillage. « Révéler aux joueurs » ouvre une pièce d'un clic (ou au pinceau) : sur la TV,
seules les pièces révélées apparaissent, les pions glissent d'une case à l'autre et une pièce découverte se fond dans le
plan. Les prénoms et les numéros des pions y gardent une taille lisible depuis le canapé (24 et 20 px sur un écran 1080p)
et l'anneau de couleur s'épaissit ; quand deux héros sont trop près pour écrire leurs prénoms, une légende en bas de
l'écran donne la couleur et le prénom de chacun. Un PNJ garde toujours son nom sous le pion, écrit à la taille de
l'atelier quand la place manque. L'atelier garde son rendu. Les flèches du clavier déplacent le pion choisi. Dans
l'outil Pions, un héros visible posé (au glisser ou aux flèches) sur une case d'une pièce cachée révèle cette pièce, s'il
a changé de case (un clic qui tremble ou une flèche contre le bord du plan ne révèlent rien) : un seul Ctrl+Z annule les
deux, et la case « Entrer révèle la pièce » (cochée par défaut, retenue sur ce navigateur) coupe le geste. Si la pièce sort du cadre de la TV, celle-ci s'élargit pour
couvrir son cadre d'avant et la pièce ; le panneau du pion rappelle les notes du MJ de la pièce. Un pion caché (un héros au
fond de l'étang) ne révèle jamais rien (`node outils/verifier_entrer.mjs`). Le panneau
d'un lieu, sur la carte, liste ses plans ; la séance les propose dans « Jouer » quand leur lieu est prévu. Plans de
l'auberge de la campagne déjà posés (tout caché).

**Plusieurs pions à la fois.** Dans les outils Sélection et Pions : Maj + clic (ou Ctrl, Cmd) ajoute un pion à ceux qui sont
choisis, ou l'en retire ; Maj + glisser ailleurs que sur un pion trace un rectangle qui prend les pions qu'il couvre (sans
Maj, glisser sur le vide déplace toujours la vue). Sur iPad et téléphone, le bouton « Sélection multiple » (au bas de la barre
d'outils, et dans le panneau des pions) fait du toucher un ajout et du glisser un rectangle ; « Tous les héros » choisit les
héros que voient les joueurs. Chaque pion choisi est cerclé d'or, dans tous les styles. Glisser l'un d'eux les emmène tous,
montures et cavaliers compris, en gardant la formation : le groupe s'arrête en bloc au bord du plan. Les flèches le déplacent
d'une case, Suppr le retire après confirmation, Échap ou un autre outil le lâche ; le panneau dit « N pions sélectionnés » et
propose de les cacher, de les montrer ou de les retirer. Un seul Ctrl+Z, un seul enregistrement, et « Entrer révèle la pièce »
vaut pour chacun. Maj + glisser un héros, sans autre pion choisi, emmène toujours tous les héros visibles (dans les deux outils
désormais, et ils restent choisis). Le déplacement d'un joueur n'arrache au MJ aucun pion du groupe qu'il tient en main. Logique
dans `js/plan/groupe-pions.js` (`node outils/verifier_groupe_pions.mjs`) ; la sélection de l'éditeur vaut `{ genre: "pions", ids }`
et `VuePlan.selection` accepte une liste (ni la TV ni le coin n'en posent).

**Importer un plan UVTT.** « Nouveau plan » (« D'un autre outil », avec le choix du lieu) et, dans l'éditeur, « Image de fond »
proposent « Importer un plan UVTT » : un export Universal VTT de Dungeondraft, de Dungeon Alchemist ou d'un autre outil (`.dd2vtt`,
`.uvtt`, `.df2vtt`, ou le même JSON). Le fichier se lit dans le navigateur (il dépasse souvent ce que le serveur accepte) ; seule
son image part, par `POST /api/images`, réduite à 100 px par case et 4096 px de côté au plus (WebP, ou JPEG sous Safari). Elle
devient l'image de fond (jamais dessinée par-dessus, opacité entière, calée sur le quadrillage d'après `map_origin`), le plan
prend la taille de `map_size` (4 à 160 cases) et le quadrillage de l'atelier s'éteint (la case « Quadrillage sur la TV » le
remet). Les murs ne sont pas stockés : une arête entre deux cases est barrée si le segment qui joint leurs centres coupe un mur
(`line_of_sight`, `objects_line_of_sight`) ou une porte (`portals`), puis chaque zone fermée devient une pièce « Salle n », une
zone ouverte sur le bord une pièce « Extérieur », une case murée seule reste vide ; chaque arête coupée par une porte entre deux
pièces reçoit une porte, ouverte ou fermée comme au fichier. Révéler, « Entrer révèle la pièce », les déplacements des joueurs et
le cadrage de la TV marchent donc comme sur un plan tracé. Ce qui se perd est dit avant et après l'import : murs en biais ou hors
du quadrillage ramenés au bord de case voisin, bouts de mur qui ne ferment aucune pièce, portes isolées, lumières. Une barre
d'attente suit les gros fichiers ; un fichier illisible, sans image ou trop grand le dit. Dans l'éditeur, l'import remplace le
plan comme un plan généré (question s'il a été retouché, Ctrl+Z, et « Défaire l'import » sur le bilan). Conversion dans
`js/plan/uvtt.js`, page dans `js/plan/importer-uvtt.js` ; `node outils/verifier_uvtt.mjs` rejoue les fichiers de `tests/uvtt/`,
et `tests/uvtt-cas.json` porte les plans attendus, que `tests/test_uvtt.py` confronte à `murs_du_plan` et à `deplacement.py`.

**Plans extérieurs.** « Nouveau plan » range les modèles en intérieurs et extérieurs : ville (rues pavées, place et
fontaine, pâtés de maisons ; on entre dans la taverne, le temple, la forge, les échoppes, l'entrepôt et une maison sur
trois, les autres sont fermées à clé), village (maisons le long des chemins, puits, champs, enclos), forêt (sous-bois
serré, sentier, clairière, ruisseau passé sur un pont ou à gué), montagne (falaises, sentier en lacets, éboulis, col),
désert (dunes, rochers, oasis, ruines ensablées, piste), marais (eaux profondes, roseaux, chemin de planches, l'îlot et
sa cabane), rivière (un pont sur la route, un gué plus loin), côte (plage, cap, ponton et barques, cabane du pêcheur),
camp (palissade et sa porte, tentes, feu) et ruines (remparts écroulés, brèche, une tour debout). Même graine, même
plan ; « Relancer » en tire un autre. Le dehors se découpe en zones d'une centaine de cases (l'entrée est la première
pièce), chaque bâtiment est une salle avec sa porte : « Révéler aux joueurs » et « Entrer révèle la pièce » ne découvrent
jamais tout le dehors d'un coup, et un héros qui avance dans une zone extérieure n'en révèle que les cases à deux pas.
Un plan extérieur naît au jour, le camp au crépuscule (réglage Lumière). Trois sols nouveaux : l'eau profonde et la falaise, qu'on ne traverse
pas (sauf sur un pont, un ponton ou une barque), et le champ cultivé ; cinq meubles : palmier, roseaux, dune, fontaine,
pierre tombale. Un pas dans le noir sur de l'eau profonde ou une falaise cachées se refuse comme un mur ; seul le MJ
apprend ce que c'était. Le plan conçu par l'API (« Programmer le plan ») connaît aussi ces modèles. Générateurs : `js/plan/generateurs-dehors.js` ;
dessins : `js/plan/dehors-dessin.js` (couleur, parchemin) et `js/plan/dehors-peint.js` (peint).

**Lieux.** Chaque lieu a une fiche partagée entre toutes les cartes : ce que savent les joueurs, ce qui est réservé au MJ,
notes, source (officiel, série, maison), connu ou secret.

**Illustrations.** Dans la fiche d'un lieu : description en français, le modèle de langue local (Ollama, `qwen2.5:7b`)
écrit le prompt anglais, ComfyUI le peint (environ une minute par image sur une carte graphique de 6 Go). On peut aussi copier le prompt
pour ChatGPT, Gemini ou Midjourney, ou importer une image.

**Portraits et charte visuelle.** Un portrait (PNJ, aventurier) suit la charte visuelle de la campagne (bouton « Charte
visuelle » sous la description, `data/charte-visuelle.json`) : chaque repère (peuple, Église, ordre…) se déclenche par
des mots de la description (« nain », « inquisiteur ») et apporte son allure, ses couleurs, ses interdits, des mots
anglais appuyés en tête de consigne, `(dwarf:1.4)`, et parfois un cadrage (les nains en mi-corps). La charte de départ
(`app/campagne/univers.py`) suit la bible quand elle dit quelque chose ; le reste est marqué « À relire ». Le champ « Couleurs imposées » passe
avant tout. Le modèle de l'API écrit la consigne et ce qu'il faut éviter ; chaque variante reçoit son cadrage, son angle
et sa lumière (des lumières neutres quand des couleurs sont imposées). Après la peinture, le modèle léger de l'API
(`claude-haiku-5-5`, `CLAUDE_MODELE_REGARD`) regarde l'image : si elle s'écarte nettement de la description (peuple,
sexe, couleurs), elle est repeinte avec sa correction (deux fois au plus), et une image encore à côté est gardée avec la mention
« À vérifier ». Le contrôle coûte environ 0,03 centime par image (ligne « Contrôle des portraits » des coûts de l'IA, page Table).
Le générateur réglé pour aller vite (6 pas, cfg 2) tient peu compte des interdits : les portraits prennent donc un
guidage plus fort (`cfg_portrait` 3,5) adouci par APG (`apg_portrait`, nœud natif de ComfyUI) qui évite l'image brûlée.
Sans lui, « dwarf » donnait souvent des oreilles d'elfe ou des cornes. La consigne dit aussi ce qu'on veut voir.

**Carnet de PNJ.** Une fiche par personnage : identité, à quoi il ressemble, comment le jouer, ce qu'il veut, ce qu'il
cache, ce qu'il peut offrir ; lieu, faction, scénario ; rang de combat avec les valeurs du bestiaire du kit. Chaque champ
a son dé (tables accordées au genre du PNJ, noms par région de la campagne), « Un figurant » donne un PNJ improvisé en une
seconde, et l'IA peut remplir les champs vides à partir d'une idée. Portraits peints comme les illustrations.
« Ajouter les PNJ du kit » reprend les figures de la campagne de départ. Le panneau d'un
lieu, sur la carte, liste les PNJ qu'on y trouve.

**Les aventuriers.** Le créateur suit les dix étapes du guide de création du kit (une idée, le peuple, une ou deux
vocations, 170 % de caractéristiques, 4 compétences pour 60 %, 12 points de Santé et de Psy, les dons selon la Psy,
élément, posture et thèmes, équipement et bourse, finitions). Chaque règle est vérifiée en chemin, l'aperçu de la fiche se
met à jour à la frappe, et les dés proposent des idées tirées de la campagne. Les dons viennent de la liste du
livret, filtrés par peuple, vocations et élément ; on peut en créer avec le MJ d'après le barème. « Partir d'un prétiré »
reprend les six aventuriers du kit. La fiche A4 reprend le gabarit des prétirés (parchemin, emblème de l'élément ou
portrait peint) avec, au verso, l'histoire écrite sur les lignes et le carnet de campagne ; `?tablee=1` imprime toute la
tablée. Chaque aventurier a son joueur et la couleur de ses dés : il rejoint la tablée des séances, et la balance des
combats le lit dans sa fiche. L'aperçu de la fiche dit son état du jour (« Aujourd'hui : Santé 5/8, Psy 2/5, carton
jaune en Physique », note du MJ comprise), et la vue « La tablée » sa Santé et sa Psy du moment, sur la TV aussi
(« 5/8 », jamais la note). « Progression » applique le guide de progression niveau par niveau (points, dons, posture
élémentaire, +5 %), avec un journal et l'annulation du dernier niveau. « Pour le MJ » garde ce que la table ne voit pas.
L'IA peut rédiger l'histoire à partir des réponses du joueur. Sur la TV, un héros se présente en carton (nom,
titre, joueur, caractéristiques, thèmes) ou toute la tablée d'un coup ; un peuple gardé secret n'y apparaît jamais.
Les peuples, vocations, éléments, thèmes, langues, dons, prétirés et idées à tirer sont des données de la campagne
(`js/campagne/regles.js`, `dons.js`, `pretires.js`, `idees-heros.js` ; voir `docs/campagne.md`).

**L'auberge.** La planche à contrats de l'auberge de la campagne, telle que la TV la montre : affiches clouées, délavées par la
pluie ou fraîches, mention ajoutée à la main, tampon « Pris », avis officiels scellés. Chaque affiche a sa fiche MJ (ce qui
se passe vraiment, danger, commanditaire, lieu, fil). « Tirer un contrat » en propose un, récompense au barème du kit. Les
rumeurs de comptoir (celles de l'aide-mémoire, d'autres maison) sont « à placer » puis « entendues » ; « Raconter » les
affiche en carton sur la TV, sans jamais dire si elles sont vraies. À droite, les PNJ présents à l'auberge.

**Les boutiques.** Un onglet pour les marchands du MJ, liste à gauche et fiche à droite comme le carnet de PNJ : nom,
accroche (lue par les joueurs), marchand (un PNJ du carnet), lieu, ajustement des prix en pour cent (−10 pour une bonne
réputation, +20 pour des étrangers), notes du MJ, et les articles. Un article a son nom, son prix tel qu'on le tape
(« 25 », « à partir de 150 », « 15 / 120 / 600 », en pièces d'or), sa catégorie (libre, avec des suggestions), une
description pour les joueurs, une note du MJ, un stock (vide : sans limite ; 0 : épuisé) et une case « Caché aux
joueurs ». Les articles se rangent par catégorie, comme sur la TV ; on les monte, descend, duplique ou retire, et une
catégorie entière se déplace. L'ajustement s'applique à chaque nombre du prix, arrondi à la pièce et jamais sous 1 : le MJ
voit les deux prix. « Ajouter les prix du kit » pose les prix indicatifs du kit de règles qui manquent à la boutique
(une ligne du kit qui groupe plusieurs objets donne un article par objet). « Vendre à… » choisit un aventurier de la
tablée et le montant (proposé d'après le prix ajusté, à taper pour un prix libre) : l'or quitte sa bourse et l'article
rejoint son équipement en un seul geste par la route du sac (rejoué sur la fiche relue après un 409), le stock baisse
d'un, et le journal de la séance note « Hadrik achète Épée (23 po) chez Le Comptoir du Pont ». Une bourse trop maigre
est dite, rien ne part. « Montrer à la table » pose la carte du marchand sur la TV (`vue: "boutique"`, plein écran, sur le
comptoir de chêne : articles par catégorie, points de conduite, épuisé barré, plusieurs colonnes et texte qui rétrécit
jusqu'à tenir) ; « Montrer de près » y ajoute un article en grand (`article`, identifiant court tiré au sort) ;
« Retirer de la TV » revient à la vue d'avant (`avant`, comme pour une illustration). `GET /api/table/boutique/<jeton>`
ne renvoie que le nom, l'accroche, le nom du marchand s'il est connu des joueurs et les articles non cachés (nom, prix
ajusté, catégorie, description, épuisé ou non) : ni notes, ni stock chiffré, ni lieu. Le calcul des prix est le même
dans `js/boutiques/commun.js` et `prix_ajuste` (`api/tv_boutique_combat.py`).

**Le sanctuaire.** Onglet Sanctuaire : l'auberge détruite que les héros relèvent et le village qui pousse autour, refuge
des aventuriers et des demi-élémentaires, comme une base de jeu vidéo. Un seul document, `data/sanctuaire.json` (absent :
l'auberge en ruines au milieu et le catalogue proposé, `app/contenu/sanctuaire.py`). Le catalogue (14 bâtiments : auberge,
baraquements, maisons, échoppe, forge, infirmerie, autel des éléments, écuries, enceinte, tour de guet, jardins, puits,
entrepôt, salle des cartes) donne à chaque type son dessin, sa couleur de toit, son enseigne, s'il est unique, et 1 à 5
niveaux (nom, coût en pièces d'or, habitants, bonus) ; coûts tenus au barème du kit et bonus modestes, propositions
maison que le MJ change dans l'onglet. « Ouvrir un chantier » pose un bâtiment au niveau 0 sur une place libre
(`POST /api/sanctuaire/batiments`) ; on le glisse où l'on veut sur le dessin. Un héros verse de sa bourse dans la cagnotte
du niveau suivant (`POST /api/sanctuaire/versements` : l'or quitte son sac et entre dans la cagnotte d'un même geste,
jamais plus que ce qui manque ni plus que son or) ; le niveau est bâti dès qu'il est payé (choix du MJ), noté au journal
du sanctuaire et à celui de la séance. Le dernier versement d'un niveau pas encore bâti se rend
(`DELETE /api/sanctuaire/versements/<id>`, l'or revient). Le MJ corrige sans or (`PATCH /api/sanctuaire/batiments/<id>` :
niveau, cagnotte, ruines) et retire un bâtiment (`DELETE`). L'enregistrement entier (`PUT /api/sanctuaire`, avec
`version_base`) ne change que nom, accroche, notes, catalogue et, des bâtiments déjà là, nom, place, caché, notes et
boutique liée : niveau, cagnotte, versements et liste des bâtiments ne bougent que par leurs routes, si bien qu'un écran
resté ouvert ne peut effacer ni un chantier ni de l'or versé ; et après un refus 409, bâtiments et types du catalogue se
fusionnent un par un, champ par champ (`fusionner` de `api.js`, option `listes`), comme les articles d'une boutique : ce
qu'un écran a caché ne réapparaît pas parce qu'un autre a déplacé un bâtiment. Un catalogue qui retirerait un niveau déjà
bâti est refusé (409), un niveau déjà payé (coût baissé ou nul) se bâtit sans or (« Bâtir »), un double-clic ne verse
qu'une fois, et un bâtiment caché ne se montre pas de près. Le dessin (`js/sanctuaire/dessin.js`, SVG 1600 × 1000,
le même dans l'atelier et sur la TV) : une clairière au bord d'une rivière, la forêt qui déborde du cadre pour remplir
tout écran, l'auberge en ruines (cheminée debout, pans de mur, poutres noircies, enseigne à terre), relevée sous
échafaudage pendant qu'on paie, puis chaque bâtiment qui grandit de niveau en niveau, avec les sentiers qui y mènent et
l'enceinte (palissade, fossé et porte, rempart) autour du village. Sur la TV (vue `sanctuaire`, `batiment` pour un
bâtiment de près, `sanctuaire_maj` pour la relire après un versement) : le village à gauche, à droite les chantiers avec
leur cagnotte et les prénoms de ceux qui ont versé, et ce que le sanctuaire offre déjà ; jamais une note du MJ ni un
bâtiment caché (`GET /api/table/sanctuaire`, `sanctuaire_public`). Tests : `tests/test_sanctuaire.py`.

**Les séances.** La campagne : tablée (joueur, personnage, couleur des dés), niveau du groupe, réputation par région, et les
fils de la campagne, des horloges à étapes. À la clôture d'une séance, chaque fil dont les héros ne se sont pas mêlés avance
selon son rythme ; une étape franchie laisse une rumeur à placer à l'auberge, parfois une affiche sur la planche. Chaque
séance se prépare (objectif, déroulé minuté, PNJ, lieux, affiches, rumeurs sous la main), se joue (présents, scène en cours
et retard, journal horodaté, boutons pour la TV) et se clôt (résumé, « Précédemment… » rédigé au besoin par
l'IA, réputation, niveau, avancée du monde). Le journal se tient aussi depuis n'importe quel écran : bouton « Journal »
de l'en-tête ou touche N hors d'un champ, une ligne puis Entrée, l'heure du serveur se met seule ; il vise la séance du
jour, sinon la séance non close la plus proche. Une ligne s'ajoute ou se retire par sa route
(`POST /api/seances/<id>/journal`, `DELETE …/journal/<ligne>`) sans changer la version de la séance : l'enregistrement
de la fiche entière ne touche plus au journal, et deux écrans qui notent en même temps ne perdent rien. Le scénario se
choisit dans la liste des scénarios (`scenario_id`, le nom reste
dans `scenario` ; un ancien texte se rattache au scénario du même nom), et « Ouvrir le scénario » y mène depuis l'en-tête.
En tête de la préparation, l'encadré « Avant de jouer » signale, chaque ligne avec ses liens : les rencontres liées à un PNJ
ou un lieu de la séance mais pas encore choisies (« Ajouter »), les verdicts pesés pour un autre nombre d'aventuriers que
les présents ou à un autre niveau, les PNJ et lieux à révéler en jeu, les PNJ sans portrait ; il disparaît quand tout est
prêt. Sous chaque scène du déroulé, « Lier » (replié) attache un plan, des PNJ, une rencontre et une ambiance de la
musique de fond (`deroule[].liens` = `{plan, pnj, rencontre, ambiance}` ; heure, titre et note de la scène ne changent
pas). Dans Jouer, la scène en cours, la première non cochée, les reprend en boutons séparés : ouvrir ou montrer le plan,
montrer le carton d'un PNJ, ouvrir la rencontre, lancer l'ambiance (même fondu que le panneau Musique). Chacun attend un
clic du MJ, rien ne part seul ; cocher la scène passe les boutons à la suivante. « À montrer » liste aussi les rencontres
de la séance, avec « Ouvrir dans la balance ». « Fiche d'une page » donne une feuille A4 à imprimer, secrets compris ;
le texte se resserre jusqu'à tenir sur la page. « Feuille de combat » imprime un encadré par rencontre de la séance :
une ligne par adversaire, numérotée comme son pion sur le plan, avec attaque, dégâts, armure, défenses, capacités et une
rangée de cases de Santé à cocher, puis le verdict de la balance, le groupe pour lequel il a été pesé et la fuite des sbires. « Installer la campagne du kit » pose les fils de la campagne
de départ, la planche, les rumeurs et les habitués de l'auberge.

**Les règles maison.** Onglet « Règles maison » (famille Jouer) : le registre des
décisions de règle du MJ, pour rester cohérent d'une séance à l'autre. Une règle a un titre (80 caractères au plus), son
texte, un contexte réservé au MJ, un statut (« à trancher » ou « en vigueur », avec sa date d'entrée en vigueur), une
séance de rattachement facultative et un drapeau public. La liste montre d'abord ce qui reste à trancher ; « Trancher »
rouvre la règle pour écrire ce qui a été décidé, avec la séance en cours proposée et la ligne « Règle maison : … » à son
journal (cochée le jour de la séance), comme par la touche R. En jeu, la touche R (hors d'un champ) ouvre par-dessus n'importe quelle
page une recherche sans accents ni casse : les règles en vigueur d'abord, puis l'aide-mémoire du kit (tests et
critiques, cartons, coma, postures, sablier, Psy, qui commence, repos, tirés des listes du combat et du créateur,
`js/regles/aide-memoire.js`), et les questions à trancher repliées. « Nouvelle règle », et seulement ce bouton (un Entrée
dans la recherche ne crée rien), y note une décision en vigueur, rattachée à la séance en
cours (celle du combat en cours, sinon celle du journal), avec la ligne « Règle maison : … » au journal. R sert déjà aux
éditeurs : sur une carte, elle reste l'outil Rivière ; sur un plan, elle tourne le meuble quand son orientation est à
l'écran (`js/regles/`, `css/regles.css`, `node outils/verifier_regles.mjs`). Données dans `data/regles-maison/`
(historique et corbeille comme les autres fiches) ; routes `GET|POST /api/regles-maison` et
`GET|PATCH|DELETE /api/regles-maison/<id>`, champs vérifiés un à un (400 sinon), `version_base` (409). À chaque
changement, l'atelier récrit `data/propositions/carnet/regles.json` pour le coin des joueurs : les seules règles en
vigueur et publiques (`id` en jeton, `titre`, `texte`, `date`), sans contexte, passées par le filtre du nom caché.

**Les combats.** La balance pose le groupe sur un plateau et les adversaires sur l'autre (rangs, créatures et gens du
bestiaire, PNJ du carnet), puis joue la rencontre deux mille fois selon les règles du kit : qui commence, postures,
défenses, critiques, coma et mort, fuite des sbires. Verdict au barème du bestiaire (Facile, Normale, Difficile, Épique,
puis Mortelle et Perdue d'avance), chiffres (victoire, tours, aventuriers au tapis, risque de mort) et deux ajustements
proposés : un adversaire de moins, un de plus. Le groupe par défaut est la tablée (sinon trois prétirés du kit), au niveau
de la campagne ; un aventurier est relu dans sa fiche à chaque ouverture.
Les rencontres enregistrées se choisissent dans la préparation d'une séance et figurent sur sa fiche A4.
`node outils/verifier_balance.mjs` rejoue le barème du bestiaire pour vérifier le moteur.

**Le combat en cours.** « Lancer le combat » (dans la balance, et dans Jouer à côté de « Ouvrir la rencontre ») ouvre
`#/combat/<séance>?rencontre=<id>` dans la séance du jour (celle du journal). La préparation coche les présents (les
autres fiches restent proposées), reprend « Qui commence » de la rencontre et laisse cliquer les aventuriers que la
table envoie avant l'ennemi ; l'ordre du kit en découle (eux, les adversaires, le reste du groupe), le même à chaque
tour. Les adversaires viennent de la rencontre, complétés par le bestiaire et numérotés comme leurs pions
(`combats/rencontre.js`, partagé avec la feuille de combat). Pendant le combat : « Suivant » (ou Entrée, même juste
après un clic sur un bouton du combat, et dans une case de Santé ou de Psy vide) passe la main et compte les tours, en
sautant un héros dans le coma et les adversaires tous hors de combat ; la Santé se saisit « -4 » (ou « 4 »), « +3 »,
« =7 » ; la Psy de chaque héros a sa propre case : « -2 » (ou « 2 ») paie un don,
même raté, et ce qui manque est pris sur la Santé (toast, et noté à part dans `santeDon` : cette Santé ne revient
qu'après une journée entière de repos, donc des soins « +3 » s'arrêtent avant elle et seul « =7 » la rend), « +1 » rend
sans dépasser le maximum, « =3 » fixe ; en posture Focus, un rappel dit qu'un don coûte 1 Psy de moins (le MJ tape le
coût réel). Les cartons des héros se choisissent par caractéristique ;
posture, point strat (une fois par combat) et sablier d'une minute (« le monstre rejoue »). Rappels du kit : coma à 0,
repère de mort à moins la Santé maximum et jamais avant −10 (confirmation demandée, aussi quand un don le fait passer),
réveil avec un carton jaune en Physique, fuite des sbires à la moitié (bouton « Ils fuient »), et la capacité d'un chef
quand il tombe. Les fiches des héros ne changent pas : chacun entre au combat avec son état du moment (Santé, Psy, Santé
payée en dons, cartons, jeton d'avantage, voir « La compagnie » ; la préparation l'affiche, « Repartir en pleine forme » le laisse de côté),
et chaque enregistrement du combat le tient à jour côté serveur, si bien qu'il reste à la fin du combat ou quand un autre
le remplace ; un combat commencé avant le suivi de la Psy la reprend, pleine, de la fiche. Le combat vit avec la séance (champ `combat`, protégé comme le journal : `GET`, `PUT` avec `version_base`,
`DELETE /api/seances/<id>/combat`, sans changer la version de la séance) : un rechargement le reprend, deux écrans
fusionnent combattant par combattant. « Fin du combat » note son bilan au journal (avec la Psy restante d'un héros quand
elle a changé, et la Santé payée faute de Psy). « Montrer l'ordre à la TV » (`PUT /api/seances/<id>/combat/tv`) pose un
bandeau en haut de la TV sur un plan, une carte ou une image : prénom, couleur, posture, cartons et coma de chaque
héros, une case « Les ennemis », le tour, le point strat et le sablier, jamais la Santé ni la Psy d'un héros, ni le nom,
la Santé ou le nombre d'un adversaire (`GET /api/table/combat/<jeton>`, liste blanche `combat_public`, seulement tant
que le MJ le montre). Le plan se recadre sous le bandeau, où le carton d'un PNJ se fait plus étroit pour tenir dans
l'écran ; envoyer autre chose à la TV le garde (`combat`, `combat_maj` dans `data/table.json` ne bougent que par ces
routes). `node outils/verifier_combat.mjs data` vérifie l'ordre, les saisies, les rappels et la fusion.

**La compagnie.** Dans Jouer, sous « Qui est là », une ligne par héros présent (toute la tablée si personne n'est coché) :
Santé et Psy du moment avec les mêmes cases qu'au combat (« -4 », « +3 », « =7 » ; « -2 » paie un don, le manque pris sur
la Santé), la Santé payée faute de Psy, les trois cartons, une note du MJ (« empoisonné ») et, replié, le sac : l'or
(« +5 », « -3 », « =40 »), l'équipement (ajouter, changer, retirer une ligne), les trois objets personnels, et en lecture
les armes et la protection avec « Changer dans sa fiche ». « Nuit de repos » (+3 Santé sans rendre celle payée faute de
Psy, +1D6 Psy tiré par l'atelier pour chacun, cartons jaunes retirés, rouges gardés ; « dans de mauvaises conditions » :
la Psy seule), « Journée de repos » (la nuit, et la Santé payée faute de Psy revient) et « Remettre à neuf » (tout au
maximum, les notes restent) montrent d'abord, héros par héros, ce qui va changer, sur l'état relu du serveur ; en
l'appliquant, chaque héros part avec les valeurs d'avant des champs touchés (`avant` : 409 si un autre écran vient de les
changer, l'écran relit et recalcule) et la ligne du journal ne nomme que les héros dont le repos est bien enregistré.
Un héros encore dans le coma se réveille à 1 avant la nuit. L'état vit à part des fiches, dans `data/etats-heros.json`
(un champ absent : au maximum ; `GET /api/etats-heros` avec les héros d'un combat en cours, `PATCH /api/etats-heros/<id>`
qui ne fusionne que les champs envoyés, cartons un par un : le Mac et l'iPad notent ensemble sans conflit). Pendant un
combat, la Santé, la Psy et les cartons d'un héros qui s'y bat ne changent que dans le combat (le serveur refuse ailleurs,
« Suivre dans le combat » y mène) ; la note et le sac restent libres. Le sac s'écrit dans la fiche par
`PATCH /api/aventuriers/<id>/sac` (or, équipement, objets, chacun avec sa valeur d'avant ; 409 si un autre écran l'a
changé, et l'écran rejoue son geste sur la fiche relue ; historique et version de la fiche comme un enregistrement) : une
fiche ouverte ailleurs passe par le conflit habituel. **Les quantités du sac** : l'équipement reste une liste de
textes, et la quantité vit dans le texte, « Potion de soins ×3 » (un seul exemplaire s'écrit sans suffixe ; « x2 »,
« X 2 », « 2x », « 2 × Corde » se lisent aussi, et se réécrivent « ×N »). `quantite_de` et `ligne` de
`app/commun/inventaire.py` ont leurs jumelles `quantiteDe` et `ligneDe` dans `js/aventuriers/etat.js`, tenues à l'identique
par `tests/sac-cas.json` (`node outils/verifier_sac.mjs`, `tests/test_inventaire.py`). Chaque ligne d'équipement porte
« − », son nombre et « + » : dans « La compagnie », au créateur (étape 9) et dans le sac du coin des joueurs (geste
`quantite` du genre `sac`, un de plus ou un de moins, annulable par le journal comme les autres ; au dernier exemplaire la
ligne s'en va, et le joueur est d'abord interrogé). Ajouter un objet déjà là (même nom, sans égard à la casse ni aux
espaces) augmente sa quantité au lieu d'ouvrir une ligne : à la main, par « Vendre à… » d'une boutique (« Annuler la
vente » en reprend autant), par la vente d'une commande de l'échoppe et par un don reçu. Un joueur qui donne une ligne
comptée choisit « En donner 1 » ou « Tout donner » (`nombre` dans la demande `don-objet`). Les trois objets personnels ne se
comptent pas. Une ligne dont la quantité ne se lit pas sans risque (« Planche 2 x 4 », `inventaire.douteuse`) reste un
texte libre, sans compteur ni regroupement. Côté joueur, le regroupement ne regarde que les lignes qu'il lit (une ligne
retenue pour le MJ ne se devine pas en tapant son nom), une ligne grossie garde son vrai texte et son masque, et une ligne
qu'il a écrite lui-même se reconnaît à son nom, quel que soit son compte. La feuille imprimée, la tablée et le carnet
écrivent « Potion de soins ×3 » (`lisible`). Les sacs d'avant se regroupent avec `outils/fusionner_sacs.py` (essai à blanc
par défaut, `--appliquer`, par la route du sac ; les lignes ambiguës ne sont jamais touchées). Un enregistrement raté repart
seul (`js/commun/reessai.js`). La note ne
quitte jamais l'atelier ; la TV ne voit que la Santé et la Psy du moment dans « La tablée » (quand seules elles changent,
seules leurs cases se redessinent : les fiches ne rejouent pas leur entrée).

**Le jeton d'avantage.** Le jeton du kit (un seul à la fois ; un avantage et un désavantage s'annulent) fait partie de
l'état du moment (`avantage` : `"avantage"`, `"desavantage"`, absent sinon) : deux boutons ronds « + » et « − » dans la
compagnie, la page du combat et le tableau du MJ (le même jeton se retire quand il est joué, l'autre l'annule,
`jetonApres` dans `combats/suivi.js`). Comme les cartons, il se change dans le combat tant que le héros s'y bat ; un jeton
joué y reste en clé vide (`""`), pour que le serveur le retire aussi de l'état. Le bandeau du combat sur la TV le porte.

**Ce que le joueur règle lui-même.** Depuis la page Table du coin (`js/joueurs/etat-coin.js`, barre « Mon héros »),
table du coin ouverte : sa Santé et sa Psy (des écarts, « −3 », jamais une valeur) et sa posture. La boîte des demandes
l'applique seule (genre `etat-heros`, `commun/etat_joueur.py`, `coin_mj/etat_joueur_mj.py`,
`heros_etat.change_par_son_joueur`) : en combat dans le combat (écrit comme par un autre écran, « par » vaut « joueur »,
l'écran du MJ le relit et fusionne), sinon dans l'état des héros, et sur la fiche pour la posture. Bornes : la Santé entre
la mort (l'opposé du maximum, 10 au moins) et le maximum moins la Santé payée en dons ; la Psy entre 0 et son maximum.
Chaque geste est noté dans `data/journal-etats.jsonl` ; les pages de l'atelier le lisent en une ligne
(`js/mj/etats-joueurs.js`, message `etat-joueur` de `/ws/atelier`, jamais à la TV).

**L'avantage du joueur.** Deux usages, en combat comme hors combat, le jeton dépensé dans les deux cas
(`heros_etat.jeton_depense` : retiré du combat si le héros s'y bat, sinon de son état) : +10 % à un test (« Utiliser mon
avantage », `avantage: true` dans le test, `jets_distance.AVANTAGE`) ; ou changer l'effet d'un dé d'aventure ou de
mésaventure **après** le lancer, pour le dernier test seulement (genre `jet-face`, `POST /api/jets/face` du coin,
`JetsMJ.appliquer_face` ; le registre garde la face d'avant ; la table redit le test sans rejouer son jingle). Il ne choisit
plus la face avant le lancer : un `choix` envoyé avec le test est refusé. La face imposée par le MJ sur un désavantage reste
hors combat.

**La posture offensive dans les tests.** Un test lancé du téléphone par un héros en posture offensive (celle du
combat en cours, sinon celle de sa fiche) a des critiques élargis : réussite critique de 01 à 10, échec critique de 91 à
100, au lieu de 01 à 05 et 96 à 100. Les seuils se passent en paramètre (`jets.seuils_de(posture)`, `jets.issue`,
`jets.chances`, `jets.jet(..., seuils=)`) : `jets.jet` ne lit jamais la posture sur la fiche, donc les activités entre les
séances gardent les seuils ordinaires. `JetsMJ.appliquer` les prend sur sa fiche de jet ; le résultat du joueur et le
registre du MJ portent `critiques` quand ils sont élargis (dit sous le résultat au coin, dans le détail du jet au Tableau).
La feuille de test (`vue_fiche_de_jet` : `posture`, `critiques`) l'annonce avant le lancer et borne les chances dites à 10
et 90. Le focus ne compte toujours pas ; la défensive ne change rien.

**Les dés du MJ.** `POST /api/jets/mj` (`JetsMJ.lancer_mj`, règle `COMMUNE`) : des dés libres
(`{"des": "2D6+1"}`, lus par `commun/des.py`, avec `libelle` et `nom` au besoin) ou un D100 contre une valeur
(`{"test": {"valeur": 55, "libelle": "Attaque", "nom": "Gobelin 2"}}`), et `"tv": true` pour « Montrer à la TV ». Les dés
roulent sur le serveur ; le résultat revient toujours au MJ (avec la valeur visée, et `nom_montre` : le nom parti à la
table). Montré, le bandeau part par `actions_coin.jet_a_la_tv` aux formes des jets des joueurs (`des`, `jet` sans
caractéristique : « Le MJ, Attaque ») : le nom vaut « Le MJ » par défaut, et aussi quand il nomme un secret des joueurs
(`dit(nom, candidats, "Le MJ")`) ; un libellé qui en nomme un tombe ; la valeur visée ne sort jamais. Rien ne s'écrit dans le
registre des jets des joueurs. Interface (`js/jets/des-mj.js`) : l'aide « Dés du MJ » du Tableau, toujours visible sous les
tests à distance (D4 à D100, 1 à 5 dés, bonus, case « Montrer à la TV » retenue sur le navigateur, dernier résultat
affiché) ; les boutons « Attaque » (D100 contre `att`) et « Dégâts » (si `degats` se lit) sur la ligne de chaque adversaire
debout du combat compact ; le même lanceur au bas de l'onglet Combat de la télécommande.

**Les jets de la tablée sur la table du coin, en dés 3D.** Le bandeau d'un jet qui part à la TV
(`actions_coin.jet_a_la_tv` : tests et dés des joueurs, dés du MJ montrés) s'écrit aussi, table du coin ouverte, dans
`propositions/table/jets.json` (`table_joueurs.ajouter_jet` : les 8 derniers messages, tels que la TV les reçoit, avec leur
heure ; jamais dans `propositions/jets/`, que la publication des fiches de jet efface). Le flux du coin le dit par un sujet à
part, `jets-table` (la page ne relit pas le plan) ; `GET /api/table/jets` du coin rend ces messages avec leur âge et « frais »
(moins de 20 s, compté par le serveur). La page Table (`js/joueurs/jets-table-coin.js`) tient pour vus ceux de la première
lecture, ne joue chaque identifiant qu'une fois, et montre un `rappel` sans dés ni jingle. Les dés (`js/ecran-tv/des-3d.js`,
faits maison, un canvas, aucune bibliothèque) : de vrais polyèdres (D4, D6, D8, trapézoèdre du D10, D12, D20), deux D10 pour
un test (dizaines à la couleur du héros, unités en ivoire) comme pour un D100 libre ; ils roulent 1,5 s, s'arrêtent sur le
résultat du serveur, puis le bandeau (`jet-tv.js`) paraît avec le jingle. Avec « mouvements réduits », aucun dé : le bandeau
tout de suite. Les mêmes dés sur l'écran de la table (`js/table.js`). Géométrie contrôlée par `node outils/verifier_des3d.mjs`.
Le style du bandeau, des dés et de la jauge est dans `css/jet-tv.css` (liée par `table.html`, rangée dans `STATIQUES_TABLE`,
`STATIQUES_INVITE` et `FICHIERS`).

**Le volume des jingles, par appareil.** `creerSonsJets()` a gagné `regler(volume)` (de 0 à 1 ; 0 coupe).
`js/ecran-tv/volume-sons.js` pose un bouton rond (haut-parleur) qui déplie une jauge de 0 à 100 % ; le réglage reste sur
l'appareil (`localStorage`, clé `table.volume-sons`, sous try/catch), jamais sur le serveur ; la jauge lâchée joue un jingle
d'essai, et dit « Touchez la page une fois pour activer le son » tant que la sortie audio n'est pas ouverte. Sur la page
Table du coin (en bas à gauche), qui joue désormais les jingles (`sons/` dans `FICHIERS`, hors gzip), et sur l'écran de la
table (le bouton s'efface avec le curseur).

**Tout l'écran de la TV sur la table du coin.** La page Table ne montrait que le plan et la carte. Elle montre
maintenant chaque scène (accueil, image, document, boutique, tablée, fiches, planche, sanctuaire, « Précédemment », épisode)
et chaque couche posée sur le jeu (carton d'un PNJ, d'un héros ou d'un lieu, rumeur, bandeau du combat hors plan, horloges,
réserves, date de la prochaine séance sur l'accueil). Le coin n'atteint pas l'atelier : `tv_etat.ecran_pour_le_coin` publie
donc dans `vue.json`, sous `ecran`, l'état public de la table (`etat_public`, sans caméra ; sans version pour un plan ou
une carte) et, pour chaque lecture que la table publique laisserait faire en ce moment
(`lectures_publiques.chemins_montres` fait référence), la réponse de la fonction même de sa route (`LECTEURS_TV`), repassée
par `masquer_tout`. Ce que la TV refuse est refusé pareil (un PNJ ou un lieu inconnus, une rumeur pas encore entendue, un
document qui n'est plus à l'écran, un contrat pas affiché), et la référence refusée s'efface de l'état : même son jeton ne
sort pas. Le sablier du combat ne part pas. Chaque adresse `/media/…` est remplacée par une image réduite (1600 px au plus,
`grande_image`) publiée sous un nom tiré de son contenu dans `table/media/` : le coin ne sert pas `/media/`. Côté page : le
plan et la carte gardent leur rendu (le joueur les déplace, y bouge son pion) ; pour le reste, la page tient dans un cadre
la page même de la TV (`joueurs/ecran.html` : le corps de `table.html`, un test les compare ; `GET /table/ecran`, la seule
page du coin qui se laisse encadrer, et par le coin seul), dont les modules `js/table/*` lisent ce qui est publié au lieu du
serveur (`table/source-coin.js`, `poserSource` de `table/outils.js`, `html[data-source="coin"]`). Sur un plan ou une carte,
le cadre est transparent et ne prend aucun toucher : seuls les cartons, les horloges et les réserves s'y posent. Les jets,
les sons et le plein écran restent à la page du joueur ; la barre « Mon héros » et « Je veux agir » ne bougent pas (le cadre
s'arrête au-dessus des boutons flottants). Tests de fuite : `tests/test_table_joueurs_ecran.py`.

**Les jauges des pions.** Sur un plan, chaque pion d'aventurier porte deux barres sans graduation au-dessus de lui (Santé,
verte puis ambre puis rouge, et Psy en bleu ; la barre de Santé vide et cerclée de rouge dans le coma), ses cartons en
petites cartes jaunes ou rouges marquées P, S ou M, et son jeton en rond vert « + » ou rouge « − » (`dessinerJauges` dans
`plan/rendu.js`, tailles minimales pour le canapé sur la TV). La TV les reçoit avec les pions (`jauges_pion` dans
`api/tv_plans.py` : la part de Santé et de Psy au centième, jamais les chiffres, la note ni la Santé payée en dons ; rien pour un
adversaire ni un PNJ), et la version du plan en tient compte : un coup noté au combat ou dans la compagnie fait relire le
plan à la TV qui le montre. Dans l'éditeur, les jauges viennent de `plan/jauges.js` (le combat en cours pour un héros qui
s'y bat, sinon son état du moment) et, vue du MJ seulement, les adversaires du combat posés sur ce plan (même référence
et même numéro que dans la rencontre) ont aussi leur barre de Santé. Case « Jauges sur les pions » dans l'outil Pions
(retenue sur ce navigateur ; la TV les montre toujours).

**Le tableau du MJ.** Bouton « Tableau » de l'en-tête, sur toutes les pages (`js/tableau/tableau.js`, ouvert ou fermé retenu sur
ce navigateur) : un panneau de 360 px à droite qui pousse la page au lieu de la couvrir (au-dessus de 1100 px ; la barre
d'un éditeur passe alors sur deux lignes). Pendant un combat, le combat lui-même en version serrée (`Combat` en mode
`compact`) : à qui la main, Précédent et Suivant, sablier, ordre à la TV, rappels du kit, puis chaque héros (Santé et
Psy en barres avec leur case de saisie, cartons d'un clic, aucun puis jaune puis rouge, jeton, caractéristiques,
défense par tour, armure, armes) et chaque adversaire (Santé, Fuit, attaque, dégâts, armure, défense, capacités). Hors
combat : la compagnie (mêmes gestes, par `PATCH /api/etats-heros/<id>`) et, sur un plan ouvert, les adversaires qui y
sont posés avec leur profil du bestiaire ou de leur fiche de PNJ, Santé comptée pour la tablée et le niveau de la
campagne. Un nom touché choisit son pion sur le plan ouvert (et y recentre la vue s'il en sortait). Sur la page de ce
combat même, le tableau ne le tient pas une seconde fois (il y renvoie) ; ailleurs, chaque geste qu'il enregistre est
annoncé (`etat-jeu-change`) et la page du combat comme « La compagnie » se relisent aussitôt. Tout se lit dans
`js/commun/etat-jeu.js`, partagé avec les jauges de l'éditeur : relu toutes les cinq secondes tant que la page est visible, au
retour sur l'onglet, et tout de suite après un enregistrement fait sur cette page (un coup noté sur l'iPad paraît donc
en quelques secondes). La page du combat montre aussi, sous chaque héros, ses caractéristiques, sa défense, son armure
et ses armes.
Sous la compagnie, deux sections repliables (`js/tableau/`, styles dans `css/tableau-aides.css`, ouvertes ou repliées
retenues sur ce navigateur) :
- **Chacun son moment** (`projecteur.js`, calcul pur dans `moments.js`) : pour chaque héros présent à la séance du
  journal, depuis quand une ligne du journal ne le cite plus (prénom ou nom, sans accents ni casse ; les lignes que
  l'atelier écrit seul ne comptent pas : repos, ventes, versements au sanctuaire, PNJ improvisé) ou depuis quand il a eu
  la main au combat (le tableau retient l'heure de chacun pendant un combat de la séance, `tableau.moments.vus.<séance>`
  sur ce navigateur : le bilan noté à la fin ne cite que les blessés). Une barre douce, le plus oublié mis en avant
  au-delà de 20 minutes (« Hadrik attend son moment depuis 1 h 05. Une scène pour lui ? »), et sous chacun ce qu'il
  cherche (`pourquoi` de sa fiche, sinon `lien`, sinon le début de son `histoire`), en une ligne qui se déplie d'un clic.
  Rien ne part vers la TV.
- **Hors du scénario** (`impro.js`, partie pure dans `tirages.js`), pour le lieu courant : celui choisi à la main pour
  la séance (retenu sur ce navigateur), sinon celui du plan montré à la TV, du plan ouvert, du plan de la scène en cours,
  sinon le premier lieu de la séance. Qui est là (PNJ du lieu ni morts ni disparus : ceux de la scène, puis les connus ;
  voix d'un coup d'œil, voix, envie et offre d'un clic, repère « inconnu », « Montrer » son carton comme dans le déroulé,
  nom vers sa fiche), les rumeurs à placer (une rumeur n'a pas de lieu : toutes, celles de la séance d'abord ;
  « Entendue » fait la transition de l'Auberge, pendant la séance du journal), les boutiques du lieu (« Montrer » comme
  l'onglet Boutiques), « Tirer une rencontre » (Facile, Normale ou Difficile : une famille du bestiaire qui convient au
  type du lieu, son nombre cherché avec le moteur de la balance pour les héros de la séance au niveau de la campagne,
  verdict confirmé sur 2 000 combats ; « Enregistrer » la met dans l'onglet Combats, puis « Lancer le combat ») et
  « Trois noms » (tables des PNJ, région du lieu, jamais un prénom ou un nom déjà pris ; « Créer ce PNJ » : fiche
  minimale inconnue au lieu courant, et « PNJ improvisé : <nom> » au journal).
`node outils/verifier_aides_tableau.mjs [data]` vérifie les deux calculs.
`node outils/verifier_etat_heros.mjs` vérifie l'état, les repos et les gestes du sac.

**Les scénarios.** Le MJ écrit ses scénarios chapitre par chapitre (Markdown simple : intertitres `##`, encadré à lire
aux joueurs `>`, `#mots-clés` reliés aux idées, liens vers les fiches de l'atelier), en mode Écrire, Côte à côte ou
Aperçu, et peut tout imprimer. Là où il laisse carte blanche, il pose une consigne, avec le bouton ou à la main :
`[[carte blanche : …]]`, `[[pistes : …]]`, `[[vérifier : …]]`, `[[pnj : …]]`, `[[combat : …]]`. Seule sur sa ligne, elle
tient lieu de paragraphe ; dans une phrase, elle attend un mot. Les propositions (`POST /api/scenarios/<id>/reponses`,
par la référence de la consigne) et les relectures au regard du canon (`PUT …/relectures/<chapitre|ensemble>`) se rangent
à côté du texte, jamais dedans : le MJ intègre la proposition, la redemande (avec une précision) ou retire la consigne.
Une consigne se reconnaît à son contenu et à son rang parmi les identiques : sa proposition la suit d'un chapitre à
l'autre ; si le MJ la réécrit, l'ancienne proposition est signalée à part. `../outils/scenarios.py` lit les scénarios
et leurs consignes et dépose propositions et relectures. Les consignes sont lues de la même façon par `app/contenu/consignes.py`
et `js/scenarios/consignes.js` (`node outils/verifier_consignes.mjs`, cas communs dans `tests/consignes-cas.json`).
Le bouton « Fiche », ou `@` tapé en début de mot, cherche parmi les PNJ, lieux, plans, rencontres et cartes et insère
`[Nom](#/pnj/<id>)` (ou `#/carte/<carte>?lieu=<id>`, `#/plan/<id>`, `#/combats/<id>`, `#/carte/<id>`) au curseur ; un mot
choisi devient le libellé, tel quel. Rien d'autre du texte ne change (`insertionLien` de `js/scenarios/fiches.js`) : le
lien ne se pose jamais dans une consigne (sa proposition s'en détacherait) ni devant une marque de ligne ; au bout d'une
rangée, il va dans la dernière cellule ; à côté d'une consigne seule, d'un filet ou d'une séparation de tableau, sur sa
propre ligne. Dans l'aperçu, un lien vers une fiche disparue est barré. Le sommaire montre les intertitres du chapitre
ouvert (un clic y mène, dans le texte et dans l'aperçu), et la place dans le scénario (chapitre, défilement, curseur)
est gardée pour l'onglet (`sessionStorage`, `scenarios.place.<id>`) : revenir d'une fiche y ramène
(`node outils/verifier_liens_scenario.mjs`).

**L'aide à l'écriture.** Le modèle de langue de l'API (le modèle local `qwen2.5:7b` en secours pour les PNJ, le
« Précédemment », les histoires et les prompts d'image) reçoit à chaque demande le même contexte : consigne générale,
glossaire et ton de la table, état de la campagne (tablée, lieux, PNJ, fils, séances, idées, scénarios), et la bible
entière seulement pour vérifier le canon et relire. Un texte que les joueurs liront (le « Précédemment », l'histoire d'un
aventurier) part avec un état réduit à ce qu'ils savent (`contexte_ia("public")` : tablée sans peuple caché, lieux et PNJ
connus tels que la TV les montre, « Précédemment » déjà lus ; ni fils, ni idées, ni notes du MJ) ; consigne et canon
restent les mêmes, le cache aussi. Dans un scénario, chaque consigne a « Proposer » (et « Trois versions »
pour carte blanche et pistes) : le texte s'écrit au fil sous la consigne puis se range comme une proposition, sans changer
la version du scénario ; une consigne PNJ crée la fiche dans le carnet, une consigne combat crée la rencontre dans la
balance. Chaque chapitre et l'ensemble se relisent au regard du canon (la bible entière), tout de suite ou en différé
(lot de l'API, moitié prix et sans cache, déposé en général dans l'heure) ; un chapitre a aussi « Relecture rapide »
(`?rapide=true` : contexte léger et passages de la bible liés aux noms et aux mots du chapitre, 40 termes et
40 000 caractères au plus ; la relecture garde `rapide: true` et l'aperçu le dit).

**Relire et mettre en page un scénario.** « Relire et mettre en page » (au pied de chaque chapitre et sous son aperçu ;
« Tout le scénario » dans le sommaire) demande une version corrigée du chapitre : orthographe, grammaire, ponctuation,
typographie française, intertitres cohérents, listes, tableaux, encadrés à lire. **Elle est proposée, jamais écrite** :
le texte rendu se range à côté de celui du MJ (`mises_en_page: {<chapitre>: {texte, base, date}}`, champ protégé comme
`reponses` et `relectures` ; `base` est l'empreinte du texte relu, `scenarios_api.empreinte` et son jumeau
`js/scenarios/mise-en-page.js`, cas communs dans `tests/mise-en-page-cas.json`), sans changer la version du scénario
(l'écran ouvert enregistre sans 409). Un appel par chapitre (`POST /api/flux/scenarios/<id>/mises-en-page/<chapitre>`,
ou `ensemble` : tous, l'un après l'autre, le bilan de chacun à la fin), contexte léger (glossaire et noms propres, pas
la bible), fonction `mise-en-page` du journal des coûts, 48 000 jetons de sortie, chapitre de 50 000 caractères au plus ;
en différé, un lot par chapitre (`POST /api/scenarios/<id>/mises-en-page/<chapitre|ensemble>/differee`, cible de genre
`mise-en-page` : `deposer_lot` range une relecture ou une mise en page selon ce genre). Avant de proposer, des
garde-fous (`controler_mise_en_page`) : réponse entière (une réponse coupée n'est jamais proposée), longueur de 70 % à
140 % du chapitre, consignes `[[…]]` identiques et dans le même ordre, adresses des liens, `#mots-clés` et `@[Nom]`
tous présents et aucun de plus ; sinon rien n'est déposé et l'erreur dit pourquoi. Le texte rendu ne passe pas par
`finir_texte` (c'est le texte du MJ : ni lien retiré ni nom masqué) ; seuls les tirets cadratins en sortent. Dans
l'aperçu, « Mise en page proposée » compare mot à mot (`js/lore/ecart.js`), passage par passage : « Accepter tout le
chapitre », accepter ou refuser chaque passage puis « Appliquer mes choix », « Refuser », et « Le résultat mis en
page ». Accepter change le texte du chapitre dans l'éditeur, l'enregistre par sa voie habituelle, puis retire la
proposition (`DELETE …/mises-en-page/<chapitre>`) ; « Annuler » rend le texte d'avant. Si le chapitre a changé depuis la
relecture (empreinte différente), rien ne s'applique : l'aperçu le dit et propose de relancer. Une pastille « ¶ » marque
dans le sommaire les chapitres qui ont une proposition. `PUT …/mises-en-page/<chapitre>` dépose une proposition de
l'extérieur, avec les mêmes garde-fous. À l'impression, un scénario de plusieurs chapitres a son sommaire sous le titre
et un chapitre par page.

**Le sang d'un plan.** L'outil « Sang » de l'éditeur de plans (touche S ; `js/plan/sang.js` pour les données et le dessin,
`sang-menu.js` pour le panneau, `outils/verifier_sang.mjs`) pose et peint des taches de sang à même le sol : un pinceau qui mêle
flaques, gouttes et éclaboussures le long du trait, ou une forme à la fois (flaque, éclaboussure, gouttes, traînée de l'appui au
lâcher), de 0,3 à 4 cases, d'un sang frais (rouge vif, luisant) à un sang sec (brun, craquelé), en sang rouge, noir, vert ou
bleu (celui des monstres). Alt + glisser efface (la gomme a la taille du pinceau) ; « Caché aux joueurs » vaut pour ce qu'on
pose ensuite ; « Montrer tout aux joueurs », « Tout cacher », « Tout effacer ». Les taches sont dans `plan.habillage.sang`
(500 au plus, jamais sur autre chose que du sol : la structure du plan retire celles qui n'ont plus de sol) ; chacune se
dessine toujours pareil grâce à sa graine, sur la TV, au coin des joueurs et dans l'atelier, sous le mobilier, les pions et le
brouillard, détourée aux cases de sol. Seul le style Peint les dessine. `peint.sangVu` les lit à chaque dessin, hors de la
signature du plan : un coup de pinceau ne refait ni l'ombre ni la lumière. Pour les joueurs, rien de caché ni rien dans une case
non révélée (`habillage.plan_tv`, qui borne et nettoie chaque tache). Ce n'est pas un objet d'habillage : la rédaction n'en
pose pas, et le sang n'entre pas dans la liste des objets du plan.

**Les lumières d'un plan.** L'outil « Lumières » de l'éditeur de plans (touche O ; `js/plan/lumieres.js` pour la logique,
`lumieres-menu.js` pour le panneau, `outils/verifier_lumieres.mjs`) pose et règle les sources de lumière à la main : un type
(torche, bougie, lanterne, brasero, clair de lune, lueur froide, magie bleue, verte ou violette, lueur rouge, libre) qui
donne la couleur, la portée (0,8 à 10 cases) et l'intensité (0,1 à 1) d'origine, puis un nom (une note du MJ), une couleur
(nuancier ou libre), « Allumée » et « Cachée aux joueurs ». Un clic sur le sol d'une pièce en pose une (40 au plus, jamais
hors du sol : la structure du plan retire les lumières sans sol) ; le repère se glisse sur le plan ; la liste du panneau
allume, éteint, choisit (la vue s'y centre), duplique ; « Tout allumer » et « Tout éteindre » ; la lumière du plan (jour,
crépuscule, nuit, torches), la pénombre et les teintes sont dans le même menu. Ce sont les lumières de l'habillage
(`plan.habillage.lumieres`, avec `type` et `eteinte` en plus) : celles qu'avait proposées « Habiller le plan » y figurent
aussi. Une lumière éteinte garde sa place mais n'éclaire personne (`peint.habillageVu`, `habillage.plan_tv`) ; une lumière
cachée n'éclaire que le MJ ; la TV ne reçoit ni le nom, ni le type, ni l'état. Seul le style Peint dessine les lumières ; un
plan sans habillage en reçoit un, vide, à la première lumière posée (sans heure : le soir d'origine reste).

**Le squelette d'un scénario.** Sous chaque idée, « Squelette » (`js/idees/squelette.js`, `app/api/squelettes_api.py`) : durée, ton
et contraintes, puis « Proposer trois structures » (`POST /api/flux/idees/<id>/squelette`, un seul appel, fonction `squelette`
du journal des coûts, contexte léger et passages de la bible liés à l'idée). Chaque structure : un parti pris, une accroche,
des actes, des scènes (type, enjeu, sortie, indices, PNJ présents, PNJ à créer, lieu), des fins, des questions à trancher et
des points fragiles. Les structures sont rangées dans le champ protégé `squelettes` de l'idée (30 au plus, les plus récentes
d'abord) : ni un enregistrement de l'idée entière ne les efface, ni leur dépôt ne change la version de l'idée. Tout ce que
rend le modèle est borné et nettoyé (`nettoyer_structure` : types connus, longueurs, aucune `[[` ni `]]` qui se
détacherait d'une consigne). « Refaire avec une précision » (une structure, ou un seul acte avec `acte`) donne une version
fille (`parent`) ; « Retirer » la supprime (`DELETE /api/idees/<id>/squelettes/<sid>`). « Créer le scénario »
(`POST …/squelettes/<sid>/scenario`) crée un NOUVEAU scénario en brouillon : « Vue d'ensemble » (accroche, fins, questions,
points fragiles), un chapitre par acte, un intertitre par scène avec ses notes, puis une consigne prête (`[[carte blanche]]`,
`[[combat]]`, `[[pnj]]`) ; le squelette garde le lien (`scenario`), l'idée passe en « retenue ». Aucun PNJ ni rencontre n'est
créé avant « Proposer ». Un scénario existant n'est jamais modifié ; un invité ne travaille que sur ses idées (règles
`A_SOI`), avec son budget (`tests/test_squelettes.py`).

Ailleurs : trois versions d'un PNJ, la fiche d'un lieu, « Peupler une région »
sur une carte (l'image et la grille de terrain de la zone partent au modèle ; chaque lieu proposé se garde ou s'écarte),
et « Programmer avec l'IA » sur un plan (le modèle choisit le générateur et écrit chaque salle, le générateur trace).
L'habillage (`app/ia/habillage.py`) : sur une carte détaillée (1 km par case au plus), le modèle choisit champs, vergers, haies,
fermes, sentiers, ponts, gués et bâtiments autour des lieux d'après leur fiche visible ; sur un plan, objets, lumières,
ambiance (jour, soir, nuit) et étiquettes des pièces ; le serveur contrôle la réponse (bornes, eau, murs, clés connues,
ce qui touche un lieu inconnu caché d'office) et le style peint la dessine ; la TV n'en reçoit que la part visible.
« Habiller » (plan : une heure et une idée ; carte : une zone encadrée) montre la proposition avant qu'on la garde ; une
carte s'habille zone par zone ; chaque élément se retouche ensuite (caché aux joueurs, retiré), et l'habillage lié à un
lieu se montre aux joueurs depuis sa fiche.
Un lien vers une vidéo absent de la bible est retiré du texte rendu. L'onglet Table montre le coût du mois par usage.
Chaque bouton qui appelle l'API montre en petit son prix et son attente probables (« environ 0,30 $, 20 s », détail dans
l'info-bulle) : `GET /api/ia/estimations` les tire du journal des coûts (jetons médians des cinq derniers appels de l'usage,
aux tarifs du moment ; contexte à recharger quand son dernier usage date de plus de 55 minutes, cache d'une heure ;
attente mesurée, sinon déduite de la longueur des réponses à 100 jetons par seconde). Un usage jamais appelé n'annonce
que le chargement du contexte (« au moins 0,34 $ »). Les boutons portent `data-estimation="<usage>"`
(`ESTIMATIONS` dans `redaction.py`), `js/commun/estimation.js` les annote.

**La table.** « Montrer à la table » envoie la vue en cours ; « Suivre » fait suivre chaque déplacement ; la fiche d'un
lieu peut s'afficher en carton, une illustration en plein écran, un PNJ en portrait avec son nom, la planche à contrats (une affiche
de près), une rumeur, et le « Précédemment… » qui défile phrase après phrase sur les illustrations des lieux
visités. Pour ouvrir la séance, Séances › Jouer › À montrer › « Montrer le titre » joue le carton-titre d'épisode : fondu au
noir, « <nom de la campagne> · Épisode N », puis le titre, lettre après lettre, sur l'illustration de la séance, sinon celle du
premier de ses lieux connus qui en a une, sinon un fond sombre. Le titre est celui de « Titre montré aux joueurs » (Préparer,
champ `titre_episode`), sinon le nom de la séance, toujours passé au masque ; `GET /api/table/episode/<jeton>` ne renvoie
que `numero`, `titre` et `image`. « Retirer » rend à la TV ce qu'elle montrait avant. Sur un plan, le panneau d'un pion lié à un PNJ ou à un aventurier montre ou retire son carton (un PNJ inconnu
devient connu après confirmation, comme dans le carnet). Une illustration montrée depuis une fiche garde les cartons posés
et note la vue qu'elle recouvre (`avant` dans `data/table.json`, jamais envoyé à la TV) : le plan affiche alors « Revenir
au plan », qui le remet avec son cadrage d'avant l'image. La TV ne reçoit que ce qui est connu des joueurs : ni secrets, ni envies, ni valeurs de combat, ni le fond des
rumeurs, ni les notes de séance, ni les prompts des illustrations ; d'un plan, seulement les cases révélées et leurs murs,
jamais une porte secrète non découverte, un piège, un pion en embuscade ou perdu dans la brume épaisse, ni une note. Le vrai nom de l'auberge est une surprise : la fiche du
lieu porte le nom que les joueurs connaissent tant que le MJ ne l'a pas renommée, et l'IA ne le cite jamais dans le « Précédemment ».
Avant qu'un « Précédemment » parte (en quittant le champ, à « Copier le message aux joueurs », à « Montrer à la table »,
après la rédaction par l'IA), l'atelier signale le nom d'un PNJ ou d'un lieu encore inconnu et le peuple caché d'un
aventurier qu'on y trouve (`POST /api/masque`, champ `secrets`, sans accents ni casse ; un seul mot propre du nom suffit,
sauf s'il est aussi porté par un nom connu, et le surnom aussi). L'avis propose « Marquer connu » (le seul champ `connu` change) : rien n'est bloqué.
Chaque fiche a sa ligne et son bouton : trois PNJ nommés « Gaston » font trois lignes, distinguées comme dans le carnet
(métier · lieu, genre d'un lieu) ; deux fiches que rien ne distingue renvoient au carnet.

**Le pointeur.** Dans l'éditeur d'un plan ou d'une carte, l'outil Pointeur (C, cible ; P trace déjà une pièce) montre aux
joueurs où pointe le MJ : un point doré (2 % de la hauteur de l'écran, halo, courte traînée) suit sur la TV la souris, le
stylet ou le doigt qui glisse (un doigt posé un instant pointe aussi), et un clic ou un toucher bref y fait une onde de deux
cercles. Deux doigts déplacent ou zooment la vue sans pointer (un second doigt efface le point). Échap, la souris qui sort
du plan, un autre outil, une autre page ou un onglet caché l'effacent (fondu bref) ; immobile 4 s, il s'estompe et se
rallume au moindre mouvement. Rien ne s'enregistre ni ne se révèle : les positions partent en coordonnées du plan (cases)
ou de la carte par `/ws/pointeur` (20 par seconde au plus ; le serveur en accepte 40, hors de `/api/table/…` et fermé à
Internet), et le serveur ne les passe (`{"type": "pointeur", "de", "plan" ou "carte": jeton, "x", "y", "onde"?}`, ou
`efface`) qu'aux écrans de table qui montrent ce plan ou cette carte, à ceux d'Internet seulement si la table publique est
ouverte ; il répond à l'éditeur, quand cela change, si le point passe et sur combien d'écrans (ligne du panneau), et
au point qui suit chaque lecture de la table par l'éditeur (`{"relire": true}`) : entre-temps, le panneau parle d'après
la table relue (ce plan à la TV ou non, nombre d'écrans ouverts, « Aucun écran de table n'est ouvert » s'il n'y en a pas). Chaque
écran place le point avec son propre cadrage, sur un calque à part (`js/ecran-tv/pointeur-tv.js`, au-dessus du plan et de la carte,
sous les cartons, la légende et le bandeau du combat ; rien ne se repeint, aucune image demandée sans point) ; hors de
son cadre, rien (pas de flèche au bord : la souris du MJ parcourt une vue plus large que celle de la TV). La vue de la
table ouverte dans l'atelier le montre aussi.

**La brume.** Sur un plan, l'outil Brume (U ; B peint déjà le sol) pose une brume que les joueurs voient, à ne pas confondre
avec le brouillard des pièces cachées : l'aube sur l'étang, le don « Brume » d'un héros. Pinceau comme les autres (taille
de 1 à 11 cases, Alt + glisser efface, Ctrl+Z, au doigt comme les autres pinceaux) en deux densités : « Voile », on voit à
travers, sol et pions restent lisibles ; « Épaisse », on ne voit plus le sol, et sur la TV un adversaire, un PNJ ou tout
autre pion qui n'est pas un héros y disparaît (le serveur ne l'envoie pas, comme un pion en embuscade, et le renvoie quand
la brume se dissipe ; un grand pion compte par la case de son centre) ; les héros restent visibles, un peu estompés.
« Brume partout » pose un voile sur tout le plan (l'épaisse reste), « Dissiper la brume » retire tout. Le pinceau ne
révèle ni ne cache aucune pièce. Données : `brume` dans le plan, une valeur par case (0 rien, 1 voile, 2 épaisse) ; un
plan d'avant n'a pas ce champ et n'a pas de brume. La TV ne reçoit la brume que des cases révélées (une brume sur une
zone cachée n'en dessine pas la forme), et une liste vide quand il n'y en a pas. Rendu (`js/plan/brume.js`) : blanc-gris
légèrement bleuté, bords fondus et irréguliers, qui dérive lentement ; un calque à part posé sur le plan (sous le
pointeur, les cartons et la légende), peint en basse définition (la moitié des pixels dans l'atelier, le quart sur la TV)
à 20 images par seconde au plus dans l'atelier, 12 sur la TV, le plan ne se repeignant jamais pour elle ; sous chaque pion
vu, la brume s'éclaircit. Sur la TV, une brume qui change se fond dans la nouvelle en deux secondes ; un plan sans brume
ne fait rien tourner. Dans l'atelier, la brume reste pâle en vue du MJ (un pion qu'elle cache à la TV y est cerclé de
gris) et paraît telle quelle en « Vue joueurs » et dans l'export des joueurs, là aussi sur les seules cases révélées
(`brumeVue` dans `js/plan/modele.js`, même règle que le serveur ; `node outils/verifier_brume.mjs [data]`). Avec
« mouvements réduits » demandé par le système, elle reste immobile. Mesure, processeur ralenti 6 fois : pendant la
dérive, 14 à 23 % du temps de la TV (19 à 27 % la brume sur tout l'écran ; 30 % de plus au tiers de la définition),
aucune tâche longue ; une brume qui change, une tâche de 0,1 à 0,2 s ; un glissement de caméra coûte autant avec ou sans
brume. Dans l'éditeur, le calque n'existe qu'une fois qu'un plan a de la brume (`.scene canvas` désigne alors deux
toiles : celle du plan est `.scene canvas[aria-label="Plan"]`).

**Les horloges de la menace.** « Le toit va céder », « Les chasseurs approchent » : un cadran découpé en parts qui se
remplissent, que la TV montre aux joueurs. Dans le tableau du MJ, section « Horloges » entre le combat et la compagnie
(`js/horloges/horloges.js`) : un nom (40 caractères au plus) et 4, 6 ou 8 parts créent une horloge, vide et cachée ; + et − la
remplissent ou la vident d'une part, « À la TV » la montre ou la retire (un avis si son nom cite le nom caché de
l'auberge, ou un PNJ ou un lieu inconnus des joueurs), « Supprimer » l'efface ; trois au plus. Pleine, elle est échue (ligne
rouge, « Échue »). Touche H, sur toute page hors d'un champ de saisie : l'horloge montrée à la TV que le MJ a touchée en
dernier avance d'une part, Maj+H la recule (aucun éditeur n'emploie H, un test y veille). Données : `horloges` dans
`table.json` (`id`, `nom`, `parts`, `remplies`, `visible`, `touchee` : le rang du dernier geste du MJ), changées
seulement par `GET`/`POST /api/horloges`, `PATCH`/`DELETE /api/horloges/<id>` et `POST /api/horloges/avancer`
(`app/table/horloges.py`, validation stricte, tout ou rien ; hors de `/api/table/…`, fermées à Internet) : `PUT /api/table`
les garde, comme le bandeau du combat. La TV et la table publique ne reçoivent que les horloges montrées, réduites à
`id`, `nom` (passé par `masquer_tout`), `parts` et `remplies`, et aucune clé quand rien n'est montré. Sur la TV
(`js/ecran-tv/horloges-tv.js`, `css/horloges-tv.css`) : un cadran de parchemin cerclé d'or aux parts de sang, le nom dessous sur
une plaque sombre, en haut à gauche (sous le bandeau du combat quand il est là) ; plusieurs s'empilent, un peu plus
petites. Une part gagnée pousse depuis le centre, puis le cadran luit brièvement (en rouge, et le nom sur fond de sang,
quand elle est échue) : rien que du transform et de l'opacity, sans filtre. En grand sur le plan, la carte, l'accueil et
une image, sous le pointeur et les cartons ; réduites sur l'échoppe, la planche et le sanctuaire ; absentes du
carton-titre, du « Précédemment », de la tablée et des fiches, où elles reviennent là où elles en étaient (la part
gagnée entre-temps pousse au retour) ; sur un téléphone, absentes aussi des vues réduites, qui y défilent.

**Partager une fiche avec l'autre MJ**. Sur un PNJ ou un lieu, une case « Partager avec … » à côté de « Connu des
joueurs » (carnet des PNJ, fiche d'un lieu sans carte, panneau d'un lieu sur sa carte), montrée seulement quand un autre
MJ a un compte ouvert. Le champ `partage` (vrai, rien d'autre ; `proprietes.PARTAGEABLES = ("pnj", "lieux")`, ignoré et
retiré partout ailleurs) ne s'écrit que par l'auteur. L'autre MJ lit alors la fiche entière, secrets compris : elle est
dans ses listes avec la pastille « partagée par … », dans « Chercher », et s'ouvre en lecture seule (champs figés, ni
corbeille, ni versions, ni rédaction, ni portraits) ; il peut la montrer à la table (`PUT /api/table`, le carton d'un
PNJ), et son nom n'est plus anonymisé dans les avis (« ce que les joueurs ne connaissent pas encore » le nomme, marqué
`partage`). Il ne l'écrit jamais : toute écriture (PUT, PATCH, DELETE, illustrations, identifiant, rédaction, corbeille,
versions) répond 403 « Cette fiche est partagée en lecture : seul son auteur peut la modifier » (404 pour les versions et
la corbeille, comme pour toute fiche de l'autre). Rendre connu des joueurs un PNJ ou un lieu partagé reste donc à son
auteur : montrer le carton d'un PNJ encore inconnu est refusé avec un message, avant tout envoi. Côté serveur, la lecture
partagée est un mot explicite (`lecture=True` de `utilitaires.existant`, `lire_tout`, `cloisonnement.permis_chemin`),
permis seulement dans `cloisonnement.LECTURES_PARTAGEES` (un test sur l'AST le vérifie, et vérifie qu'aucune de ces
fonctions n'écrit) ; sans ce mot, tout appel reste fermé. La TV, la table publique et le coin ne lisent rien de plus.
Non retenu : scénarios, séances, fils, idées ; cartes et plans (leurs éditeurs écrivent en continu) ; boutiques, documents,
rencontres, contrats et rumeurs (les montrer ou les faire avancer écrit dans la fiche).

**Pointeurs entre le MJ et les joueurs**. Deux sens, de petits fichiers dans `propositions/pointeurs/` (hors de `table/`,
dont chaque fichier fait relire toute la table), `commun/pointeurs.py` pour les deux services.
- **Le MJ vers le coin** : ce que l'éditeur envoie déjà à la TV par `/ws/pointeur` (point, onde) et sa **règle** (outil
  Mesurer : `{"plan" ou "carte": id, "regle": [x0, y0, x1, y1], "texte"}` et `{"regle": false}`, `Pointeur.regle()` /
  `effacerRegle()` dans `ecran-tv/pointeur.js`, la mesure du plan « 4,5 m · 3 cases », celle de la carte « 12 km ») s'écrit
  aussi dans `pointeurs/mj.json` (`coin_mj/pointeurs_mj.py`, `VersLeCoin`, au plus 6 écritures par seconde, la dernière part
  toujours), **table du coin ouverte et TV sur ce plan ou cette carte seulement**. Le flux du coin dit « pointeur », la page
  Table relit `GET /api/pointeurs` (point avec son âge, règle) et dessine le point de la TV (`ecran-tv/pointeur-tv.js`, plus
  lissé) et un trait en tirets (`js/joueurs/pointeurs-coin.js`, `css/pointeurs-coin.css`). Jamais à la TV pour la règle. Un point
  de plus de 10 s n'existe plus, la règle tient au plus un quart d'heure, et s'efface quand l'éditeur se ferme ou change d'outil.
  Le jeton du plan est le jeton public ; le texte est nettoyé (`<>&"` retirés, 40 caractères).
- **Le joueur vers le MJ** : bouton « Montrer au MJ » (`data-pointeur`, page Table du coin). Un toucher fait une onde, un
  glissé promène le point ; le mode prend les touchers du plan. `POST /api/pointeurs {x, y, onde?}` (8 par seconde, réserve de
  10), `DELETE /api/pointeurs` ; le plan visé est celui de la vue publiée (jamais un jeton de la requête), la position doit
  être dans le plan, la session désigne le joueur. Fichier `pointeurs/joueurs/<joueur>.json` ; l'atelier le guette
  (`PointeursJoueurs`) et pousse la liste aux pages de l'atelier par `/ws/atelier` (`pointeurs-joueurs`, jamais la TV), qui la
  dessinent sur le plan ou la carte ouverts (`js/commun/pointeurs-joueurs.js`, `css/pointeurs-joueurs.css`) : point à la couleur
  du héros telle qu'à la TV (`couleurs_de_la_tv`), prénom, onde. Un pointeur qui ne vise pas le plan de la TV n'est pas
  transmis. Tests : `tests/test_pointeurs.py` (dont fuite et refus).
- Correctif en passant : l'outil Mesurer de l'éditeur de cartes ne suivait pas la souris (x1 et y1 jamais mis à jour).
