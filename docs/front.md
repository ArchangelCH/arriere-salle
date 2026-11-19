# Le front de l'atelier

Du JavaScript natif en modules ES, sans framework ni étape de construction côté atelier. Une seule exception : l'écran de
la TV (`js/table.js`), transpilé par esbuild pour Chromium 79 pendant la construction de l'image (voir `Dockerfile`).

## Points d'entrée (à la racine de `app/static/js/`)

| fichier | page | rôle |
|---|---|---|
| `atelier.js` | `index.html` | le routeur de l'atelier, les onglets et leurs pages |
| `table.js` | `table.html` | l'écran de la TV (aussi `table.exemple.org`, en lecture seule) |
| `telecommande.js` | `telecommande.html` | le téléphone du MJ qui pilote la TV, le combat, la musique |
| `carte-x.js` | `carte-x.html` | la carte seule |
| `api.js` | toutes | les appels au serveur, `echapper`, `toast` : importé presque partout |

Rien d'autre ne reste à la racine : un module qui n'est pas une page va dans un dossier (`tests/test_front_rangement.py`).

## Les dossiers

- `commun/` : l'outillage des pages de l'atelier (aperçu réduit des feuilles à imprimer sur petit écran, `apercu-feuille.js` ; boîte de dialogue maison, nouvel essai, touches, onglets, cibles au doigt, témoin « Enregistré à… »).
- `ecran-tv/` : tout ce qui touche la TV, côté TV comme côté atelier (état, canal `/ws/table`, témoin, boutons « Montrer à la TV », pointeur, relais de la télécommande). Tout module importé par `table.js` doit rester lisible par Chromium 79. Les jingles des tests (`ecran-tv/sons-jets.js`, fichiers dans `static/sons/`, dossier ouvert à la table publique par `STATIQUES_TABLE`) partent avec le bandeau du jet, après le premier toucher de la page. Au coin, page Table : `joueurs/etat-coin.js` (barre « Mon héros » : Santé, Psy, posture, dont « Aucune », et les boutons « Sac » et « Notes »), `joueurs/table-heros.js` et `css/table-heros.css` (fiche en résumé au médaillon en bas à gauche, sac et notes en tiroirs sous la barre), `joueurs/musique-coin.js` (la musique du MJ, dans le panneau du volume) et, dans `joueurs/jets-coin.js`, l'avantage (+10 % au test, ou l'effet d'un dé changé après le lancer) ; côté atelier, `mj/etats-joueurs.js` dit chaque geste d'un joueur en une ligne (à garder dans `STATIQUES_INVITE`).
- `jets/des-mj.js` : les dés du MJ (`LanceurMJ` dans le Tableau et la télécommande, boutons d'un adversaire dans le combat compact) ; à garder dans `STATIQUES_INVITE`, jamais dans `FICHIERS`.
- `ecran-tv/des-3d.js` (les dés en 3D d'un jet), `ecran-tv/volume-sons.js` (la jauge de volume des jingles) et `css/jet-tv.css` : partagés par l'écran de la table et la page Table du coin (`joueurs/jets-table-coin.js`). `table/source-coin.js` : l'écran de la table tenu dans un cadre par la page Table du coin (`joueurs/ecran.html`, même corps que `table.html` : un élément ajouté à l'une doit l'être à l'autre) ; un module ajouté au graphe de `js/table.js` doit rejoindre `FICHIERS`.
- `musique/` : la musique d'ambiance, de combat et de boutique.
- `plan/`, `carte/`, `lieux/` : les cartes, les plans intérieurs, leurs éditeurs et leurs rendus. Dans `plan/`, deux modules sans page, vérifiés sous node : `uvtt.js` (un export Universal VTT converti en pièces et en portes ; `importer-uvtt.js` lit le fichier, réduit et envoie l'image) et `groupe-pions.js` (plusieurs pions choisis et déplacés ensemble). Tous trois sont dans `STATIQUES_INVITE` ; `rendu.js` et `vue.js`, servis aussi à la TV et au coin, n'en importent aucun. Les pions se dessinent en figurines (`figurine.js`, importé par `rendu.js`, `editeur.js`, `table/carte-plan.js`, `joueurs/table-coin.js` et `joueurs/bouger.js` : dans `FICHIERS` et `STATIQUES_INVITE`). Les deux cartes de la campagne (modèles `cratere` et `pays-castelblanc`) ne portent que leur mécanique : leurs lieux, fiches, secrets, noms et relief viennent de `campagne/carte.js` et `campagne/pays.js` (lus par `carte/generateur.js` et `carte/saison4.js`, jamais dans `FICHIERS` ni `STATIQUES_INVITE`), leurs libellés de la page Cartes de `campagne/cartes-libelles.js` (dans `STATIQUES_INVITE` avec `atelier/cartes.js`).
- `seances/`, `combats/`, `scenarios/`, `tableau/`, `horloges/`, `jets/` : la préparation et la conduite d'une séance. Dans `scenarios/`, `mise-en-page.js` (fonctions pures, `node outils/verifier_mise_en_page.mjs`) : l'empreinte d'un chapitre, jumelle de `scenarios_api.empreinte`, et les passages qui changent entre le texte du MJ et la mise en page proposée ; `scenarios.js` les montre avec `lore/ecart.js` et n'applique rien sans un geste du MJ.
- `aventuriers/`, `pnj/`, `auberge/`, `boutiques/`, `documents/`, `sanctuaire/`, `bible/`, `lore/`, `idees/`, `regles/`, `liens/`, `chercher/` : les fiches et les contenus.
- Les tirages et le kit de l'auberge et des PNJ lisent leurs données dans `campagne/` (docs/campagne.md) : `campagne/noms.js` (origines, noms, métiers, traits, voix, envies, secrets et offres des PNJ, le figurant, le nom du rang des héros ; lu par `pnj/tables.js`, qui réexporte `ORIGINES` et `PEUPLES`, et par `tableau/tirages.js` ; dans `FICHIERS` et `STATIQUES_INVITE`, et dans le script de la TV par `aventuriers/regles.js`), `campagne/planche.js` (contrats et rumeurs de comptoir tirés au sort, lus par `auberge/tables.js` ; dans `STATIQUES_INVITE`), `campagne/auberge.js` et `campagne/pnj.js` (le kit : nom caché, règlement, rumeurs, fils, affiches, habitués de l'auberge, PNJ du kit ; lus par `auberge/kit.js` et `pnj/kit.js`, chargés à la demande chez le MJ principal, jamais dans une liste).
- `joueurs/` : le coin des joueurs (service public séparé : il ne sert que les fichiers de la liste `FICHIERS` de `app/joueurs.py`).
- `mj/`, `reglages/`, `corbeille/`, `confort/`, `demandes/`, `prives/`, `salle/`, `activites/`, `illustrations/` : les comptes et accès des MJ, les réglages, la corbeille, et les échanges avec les joueurs. `mj/partage.js` : la case « Partager avec l'autre MJ », la pastille « partagée par … » et la lecture seule (`figer`) d'une fiche partagée ; il lit le compte de la page et les autres MJ dans `<body data-compte data-autres-mj>`, posés par `api/pages.py` quand deux MJ sont ouverts (à garder dans `STATIQUES_INVITE`).

## Petits outils communs

- `commun/vierges.js` : les fiches créées d'un clic (« Vierge », « Nouveau contrat », « Nouvelle rumeur », « Nouvelle boutique ») sont suivies ; laissées intactes en quittant la page ou en passant à une autre fiche, elles repartent à la corbeille. Les tirages au sort ne sont pas concernés.
- `carte/noms.js` : avant de dessiner, écarte les noms de lieux (posés sans place fixée) des noms de régions et des autres noms ; un nom placé à la main (`nx`, `ny`) ne bouge pas.
- Le routeur (`atelier/routeur.js`) ferme les dialogues ouverts, remonte la page et dit clairement une adresse inconnue.

## Quatre listes à tenir à jour quand un module change de place

1. `STATIQUES_INVITE` dans `app/mj/acces_mj.py` : les fichiers qu'un MJ invité peut charger.
2. `FICHIERS` dans `app/joueurs.py` : ce que sert le coin des joueurs.
3. `STATIQUES_TABLE` dans `app/api/portier.py` : ce que la table publique peut lire depuis Internet.
4. Les chemins cités par les tests (`tests/test_*.py`) et les vérifieurs (`outils/verifier_*.mjs`).

Un test échoue si un import ne trouve pas son fichier ; pour le contrôler sans lancer toute la suite :
`node outils/verifier_imports.mjs` (résout tous les imports relatifs de `app/static/js/`).

## Les trois pages découpées

`table.js`, `telecommande.js` et `atelier.js` étaient des scripts à état partagé de 700 à 1 300 lignes. Chacun est maintenant
un court fichier d'entrée (les écouteurs, le démarrage) qui charge les modules de son dossier :

| entrée | dossier | modules |
|---|---|---|
| `table.js` (TV) | `table/` | `etat`, `outils`, `ecran`, `carte-plan`, `combat`, `cartons`, `boutique`, `sanctuaire`, `episode`, `fiches`, `image` |
| `telecommande.js` | `telecommande/` | `etat`, `rendu`, `gestes`, `notes` |
| `atelier.js` | `atelier/` | `etat`, `cartes`, `pages`, `routeur` |

La règle de chaque dossier : `etat.js` est chargé en premier. Il tient les éléments de la page, les constantes et un objet
`S` pour les variables que plusieurs modules lisent ou réaffectent (`S.vue`, `S.onglet`, `S.courant`...). Un module importe les
fonctions des autres par leur nom ; elles ne se parlent qu'à l'appel, jamais pendant le chargement. Une variable qu'un seul
module modifie reste locale à ce module. Dans `table/`, tout reste lisible par Chromium 79 (voir `Dockerfile`).

Le découpage a été fait par un outil qui lit le code (portées, références) plutôt qu'à la main, puis vérifié page par page
en comparant, dans un navigateur et sur des données identiques, le DOM, les canvas et les erreurs de console des deux
versions du front.

## Le carnet du coin des joueurs

Le carnet n'est plus une longue page : `js/joueurs/carnet-vue.js` en dessine des pages (`VUES`), choisies par l'adresse
(`/carnet#lieux`). L'accueil (`#carnet`) garde l'essentiel : la prochaine séance, le dernier « Précédemment », la fiche du héros
(Santé, Psy, défense, posture ; compétences, armes, dons, sac, histoire et conseils repliés, `details.repli-fiche`, dont
`carnet.js` retient ceux qu'on a ouverts), les billets et « Un mot au MJ », et des tuiles vers les autres pages : personnages,
lieux, contrats et rumeurs, documents, compagnie, règles, sanctuaire, activités ; les séances d'avant ont la leur
(`#precedemment`). Les anciennes ancres (`#heros`, `#lire-la-table`, `#aide-memoire`) mènent à leur page.

Le bouton « Menu » de la barre du haut (`menu-coin.js`, chargé par toutes les pages du coin) ouvre la liste de ces pages, de la
bible, du guide et du mot de passe. Un module de plus au coin : l'ajouter à `FICHIERS` dans `app/joueurs.py`. L'aperçu du MJ
(« Voir comme », `apercu.js`) dessine les mêmes pages avec sa propre barre.


## Chargement

- **Fichiers versionnés** (`app/api/statiques_versionnes.py`) : les pages HTML de l'atelier, de la télécommande et de la table sont servies avec leurs liens sous `/static/v-<empreinte>/…` (gardés un an, `immutable`) ; l'empreinte vient du nom, de la taille et de la date de chaque fichier de `static/` hors polices, donc modifier un fichier invalide tout. Les modules s'importent par des chemins relatifs (ils restent sous le préfixe) ; une adresse absolue `"/static/…"` dans un script ou une feuille est réécrite au service. Chaque page annonce son graphe de modules en `modulepreload` (plus de cascade). Rien à faire en écrivant du JS ou du CSS, sauf : jamais d'adresse construite en pièces (`"/sta" + "tic/"`).
- **Portraits des listes** : `commun/miniature.js` (`miniature`, `attributsMiniature`) donne un WebP de 160 ou 320 px par `/api/table/vignette/<nom>?l=…&f=webp` ; `aventuriers/embleme.js` fait de même pour ses médaillons (dans l'atelier seulement : `body.atelier`). Les grosses images de `/media/` partent en WebP à qui l'accepte (`api/medias_legers.py`), l'original reste intact.
- **Listes** : `GET /api/<collection>` est servi en JSON déjà écrit avec ETag (`api/listes_json.py`) ; `?resume=1` (plans) : sans les grilles, avec `nb_etapes`. Une page qui n'a besoin que du menu des plans demande `/api/plans?resume=1`.
- **Quitter une page** : une page qui s'abonne (`ecouterTv`, `ecouterLesJets`) se désabonne dans son `detruire()` ; la page Table le fait par `S.courant`.

## Les quantités du sac

`js/aventuriers/etat.js` porte les jumelles de `app/commun/inventaire.py` : `quantiteDe`, `ligneDe`, `douteuse`, `cleNom`,
`rangDuNom`, et le geste `quantite` de `corpsDuSac` (cas communs : `tests/sac-cas.json`, vérifieur
`outils/verifier_sac.mjs`). `reprisDuSac` reprend un article vendu (« Annuler la vente », `boutiques/boutiques.js`) et
`lisible` écrit une ligne sur une feuille (`aventuriers/fiche.js`, `aventuriers/tablee.js`, `joueurs/carnet-vue.js`). Le
compteur « − nombre + » se dessine à trois endroits : `seances/compagnie.js` (`htmlSac`, `.cp-quantite`, la case ne montre
que le nom), `aventuriers/createur.js` (`htmlQuantite`, `.equip-quantite` ; les doublons se réunissent au moment d'ajouter
une ligne, jamais pendant la frappe) et `joueurs/sac.js` (`.quantite-sac`, cibles de 44 px, `css/sac-coin.css`). Au doigt,
les compteurs de l'atelier prennent 44 px (`css/doigt.css`, `css/createur.css`). `etat.js` était déjà servi au coin des
joueurs (`FICHIERS`) et à l'invité (`STATIQUES_INVITE`) : aucun module nouveau, aucune liste à compléter. Dans le sac du
coin, l'aperçu d'un geste en route est rejoué en `strict` : une fiche relue qui porte déjà le geste ne le compte pas deux
fois.

## Les aventuriers, le bestiaire et leur campagne

Les règles des aventuriers (`aventuriers/regles.js`) gardent la mécanique : caractéristiques, compétences, postures, armes,
armures, barème, niveaux, étapes du guide, calculs et vérifications de la fiche. Ce qui raconte le monde vient des modules
de données de la campagne (`docs/campagne.md`), que `regles.js` relaie sous les mêmes noms : `campagne/regles.js` (peuples
et leurs traits, vocations, éléments, thèmes, langues, postures élémentaires, exemples du barème, armes des dons, aides des
compétences colorées par la campagne, et `GUIDE` : l'aventurier d'exemple et les phrases du créateur qui parlent du monde)
et `campagne/dons.js`. Les idées à tirer du créateur sont dans `campagne/idees-heros.js` (`aventuriers/tables.js` ne garde
que le tirage), les créatures et gens du bestiaire dans `campagne/bestiaire.js` (`combats/bestiaire.js` garde les rangs et
relaie le reste). Les prétirés (`campagne/pretires.js`, avec le groupe de départ de la balance) ne se chargent que par
`aventuriers/kit.js`, à la demande : jamais dans `STATIQUES_INVITE` ni dans ce qu'importe `table.js` ; le coin les reçoit
pour « Partir d'un prétiré », comme avant.
