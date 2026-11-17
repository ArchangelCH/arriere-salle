# Architecture

L'Arrière-salle est une appli FastAPI (Python 3.12) et un front en JavaScript natif. Deux services tournent depuis le même
dépôt : l'**atelier** du MJ (réseau local, ou Internet derrière un mot de passe) et le **coin des joueurs**, seul service
public, qui n'a accès qu'à son propre dossier de données.

## Les dossiers

```
app/
  main.py           point d'entrée de l'atelier (uvicorn main:app) : charge les modules de api/
  joueurs.py        point d'entrée du coin des joueurs (uvicorn joueurs:app)
  api/              les routes de l'atelier et leur logique, par domaine (35 modules)
  commun/           ce que l'atelier ET le coin des joueurs partagent
  mj/               les comptes, l'accès et le cloisonnement des MJ
  coin_mj/          l'atelier vu des demandes des joueurs (la boîte, les sacs, les jets, les portraits...)
  table/            ce que la TV et la télécommande reçoivent (masque des secrets, couleurs, musique...)
  ia/               rédaction par le modèle de langue, illustrations, habillage des cartes
  contenu/          corbeille, recherche, liens des fiches, règles maison, sanctuaire, réserve
  campagne/         les textes d'univers de la campagne (données pures, remplacées par un pack : campagne.md)
  comfy/            les réglages du moteur d'illustration (modèle, pas, styles)
  static/           le front (voir front.md)
docker/             construction de l'image du coin des joueurs ; campagne-vide/ et bible-vide/, les défauts sans pack ni bible
secrets/            les clés de l'installation (jamais versionné : installation.md)
outils/             contrôles et générateurs (Python et Node)
tests/              la suite (pytest)
docs/               ces documents
```

### La règle qui compte : `commun/` ne dépend jamais de l'atelier

Le coin des joueurs charge `joueurs.py` et `commun/`, rien d'autre. Un import de `api`, `mj`, `ia`, `table`, `coin_mj`
ou `contenu` dans `commun/` ferait entrer du code, et un jour des secrets, de l'atelier dans le service exposé sur
Internet. `tests/test_paquets.py` le vérifie, et l'image du coin ne contient de toute façon que `commun/`.

## `app/api/` : les modules de l'atelier

`main.py` importe les modules de `api/` dans un ordre qui compte (les routes se déclarent à l'import) :

| module | contenu |
|---|---|
| `config` | dossiers de données, constantes, réglages d'environnement |
| `application` | l'application FastAPI, son cycle de vie, les fichiers servis |
| `portier` | la garde : noms d'hôte, sessions, mot de passe, table publique, accès des MJ invités |
| `utilitaires` | lecture et écriture des fiches, identifiants, archives |
| `pages` | les pages HTML, la connexion, les comptes MJ |
| `cartes_api`, `fiches_api` | les cartes, et les collections de fiches (lieux, PNJ, contrats, séances, plans...) |
| `seances_api`, `heros_etat`, `scenarios_api` | journal et combat, état des héros et sacs, scénarios |
| `squelettes_api` | trois structures de scénario proposées pour une idée, et leur passage en scénario |
| `joueurs_mj`, `carnet_api`, `commandes_api`, `actions_coin` | les joueurs du coin vus de l'atelier, le carnet, les commandes, la boîte des demandes |
| `campagne_api`, `contenus_mj`, `noms_caches`, `illustrations_api`, `bible_api` | campagne et règles maison, corbeille et recherche, noms cachés, illustrations, bible |
| `tv_*`, `pilotage`, `tv_temps_reel` | tout ce que reçoit la TV (cartes, fiches, plans, médias, combat, état), la télécommande, les WebSocket |
| `refuge` | le sanctuaire |
| `contexte_du_modele`, `ia_api` | le contexte donné au modèle de langue, les routes de rédaction |

Les modules se parlent par `module.nom` (jamais `from api.x import nom`) : ainsi un test qui remplace une valeur, ou un
module qui en appelle un autre avant qu'il ait fini de se charger, voit toujours la valeur à jour. Les imports que d'autres
modules ne demandent qu'à l'appel d'une route sont placés en bas de fichier, sous un commentaire, pour éviter les cycles.

## Les données

Un fichier JSON par objet dans `data/` (une fiche, une collection, un état). Tout passe par `commun/stockage.py` :

- `ecrire_json_compact`, `ecrire_json`, `ecrire_texte`, `ecrire_octets` : écriture atomique (fichier temporaire voisin
  puis remplacement), droits fixés avant le remplacement ;
- `lire_json` ;
- `verrou_de_dossier` : le verrou entre processus des dossiers que l'atelier et le coin écrivent tous les deux.

Deux écritures n'y passent pas, à dessein : celles qui créent un fichier secret avec ses droits dès sa création
(`commun/comptes.py`, `mj/porte_lan.py`).

## Les secrets

Ce qui ne doit jamais sortir de l'atelier (notes du MJ, secrets des fiches, pions cachés, nom de l'auberge...) passe par
`table/masque.py` avant d'aller à la TV, par `table/lectures_publiques.py` pour la table publique, et par la liste
`FICHIERS` de `joueurs.py` pour le coin. Toute nouveauté qui touche la TV ou le coin a son test de fuite.

## Où ajouter quoi

- une route de l'atelier : le module `api/` de son domaine, puis `REGENERER_ROUTES=1` pour la carte des routes ;
- une règle partagée avec le coin des joueurs : `commun/` (et rien de l'atelier dedans) ;
- un fichier de données : `commun/stockage.py`, pas un nouvel `open()` ;
- un module du front : un dossier de `app/static/js/` (voir `front.md`), puis les listes citées là-bas.
