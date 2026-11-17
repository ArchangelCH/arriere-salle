# La campagne : le contenu hors du code

L'Arrière-salle est un atelier de MJ pour un jeu de rôle au D100 (Santé, Psy, postures, dés d'aventure). Le code ne
porte aucune campagne : les textes, les noms propres, les personnages, la carte, le kit de départ et les sons vivent dans
un **pack de campagne**, un dossier à part qui recouvre quelques fichiers de `app/` au moment de construire l'image.

Sans pack, l'atelier tourne avec la petite campagne d'exemple livrée ici (neutre, inventée pour l'exemple).

## Ce qui est du contenu (et seulement cela)

| chemin dans `app/` | ce que c'est |
|---|---|
| `static/js/campagne/*.js` | modules de données purs : aucun `import`, aucune fonction qui touche au DOM ou à l'API ; seulement des `export const` (tableaux, objets, chaînes) |
| `campagne/*.py` | données Python pures pour l'atelier (textes des consignes au modèle, univers) : aucun import de l'atelier |
| `commun/campagne.py` | le peu de contenu dont le coin des joueurs a besoin (la structure de la bible), constantes seules : `commun/` ne dépend jamais de l'atelier |
| `static/sons/` | les jingles des tests (facultatifs : sans eux, la table reste muette) |
| `campagne/__init__.py` | `NOM` : le nom du pack, lu à l'installation pour vérifier que l'image porte le bon contenu |
| `commun/campagne.py` | la structure de la bible, et `NOM`, `SOUS_TITRE`, `DEVISE` : le nom de la campagne dans les titres des pages, le logo de la table, l'accueil de la TV (repères `{{campagne.nom}}`… des pages HTML, remplacés en servant : `commun/nom_campagne.py`) |
| `static/js/campagne/nom.js` | les mêmes côté navigateur (logo de la fiche imprimée, carnet, carton d'épisode, « Précédemment ») |

Règle : un fichier de contenu ne contient que des données. Toute logique reste dans le code public, qui importe ces
données. Ainsi la copie d'un fichier dans un pack ne vieillit pas quand le code évolue.

Chaque module de contenu du dépôt et son pendant dans un pack ont **les mêmes exports, de même nature** (même nom, même
type : tableau, objet, chaîne, nombre). `node outils/verifier_campagne.mjs <pack>` le contrôle.

Ce qui n'est pas du contenu et reste dans le code : la mécanique (caractéristiques, postures, barèmes, seuils, dés), les
identifiants que les données enregistrées utilisent déjà, les armes et objets génériques de fantasy.

Ce qui n'est ni code ni pack : le **masquage des noms cachés aux joueurs** (le vrai nom d'un lieu que la tablée ne doit
pas lire, filtré de tout ce qui part vers la TV et le coin) se règle dans une donnée de l'atelier,
`data/noms-caches.json`, et non dans le pack : une image construite sans pack, ou avec un autre, masque toujours ce que
le MJ a réglé. Le pack peut nommer ce lieu dans son kit (fiches de MJ, jamais servies à la TV ni au coin). Sans ce
fichier, rien n'est masqué. C'est une liste d'entrées, chacune avec `nom` (le nom tel qu'on l'écrit) ou `motif` (une
expression pour les variantes plus libres), et au besoin `lettres` (ce que le nom choisi pour les joueurs ne doit pas
contenir) et `remplacement` (`auberge` par défaut) ; le détail est en tête de `app/table/masque.py`. Par exemple :

```
[{"nom": "la Lanterne d'Ysembrin"},
 {"motif": "\\bjamais{sep}ne{sep}dort", "lettres": "jamaisnedort"}]
```

L'atelier le relit quand il change. Faux au démarrage, il l'empêche de démarrer ; changé en cours de route et faux,
l'ancienne liste reste en place. Il doit être là avant le premier démarrage d'une image qui ne porte plus les noms dans
son code, et se remplace par copie, jamais en l'effaçant d'abord (effacé, plus rien n'est masqué).

## Un pack

Un dossier qui reproduit l'arborescence du dépôt, avec seulement les fichiers qu'il remplace :

```
ma-campagne/
  app/campagne/__init__.py          # NOM = "Ma campagne"
  app/campagne/univers.py
  app/static/js/campagne/carte.js
  app/static/js/campagne/...
  app/static/sons/jet-reussite.mp3  # facultatif
  tests/                            # facultatif : tests qui lisent le contenu du pack
```

Construire avec un pack :

```
CAMPAGNE_DIR=../ma-campagne docker compose build
```

Sans `CAMPAGNE_DIR`, le compose prend `docker/campagne-vide` (aucun fichier : le contenu d'exemple du dépôt reste).

Tester un pack : `python3 outils/superposer_campagne.py <pack> <dossier>` fabrique une copie du dépôt recouverte par le
pack, où lancer les tests et les vérifieurs.
