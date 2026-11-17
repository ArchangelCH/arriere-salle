# L'Arrière-salle

Un atelier de meneur de jeu pour le jeu de rôle sur table, et l'écran que la tablée regarde.

- **L'atelier** prépare et mène la partie : cartes du monde et plans intérieurs (peints, éclairés, révélés pièce par
  pièce), lieux, carnet de PNJ, aventuriers, séances et scénarios, combats et balance des rencontres, boutiques, bible
  de la campagne, musique d'ambiance, rédaction et illustrations assistées (facultatives).
- **L'écran de table** (`/table`) montre aux joueurs ce que le MJ choisit, et seulement cela : les secrets ne quittent
  jamais l'atelier.
- **Le coin des joueurs**, un second service, laisse chacun créer son aventurier, tenir son carnet et son inventaire,
  lancer ses dés, suivre la table depuis son téléphone et écrire au MJ.

Le système de jeu est un D100 sous la valeur : caractéristiques et compétences en pourcentages, Santé et Psy, postures
de combat, dés d'aventure. Le monde, les personnages, la carte et le kit de départ viennent d'un pack de campagne
(`docs/campagne.md`) ; sans pack, une petite campagne d'exemple. Outil de fan né autour d'une campagne dans l'univers de
la web-série *Aventures* : quelques identifiants de données en gardent la trace, aucun texte de la série n'y figure.

## Démarrer

```
cp .env.example .env
mkdir -p data/propositions secrets
docker compose up -d --build
```

Atelier sur `http://localhost:8323`, écran de table sur `http://localhost:8323/table`, coin des joueurs sur
`http://localhost:8324`. Installation complète, secrets et outils de rédaction et d'illustration : `docs/installation.md`.

## Lire la suite

| document | pour savoir |
|---|---|
| [docs/installation.md](docs/installation.md) | installer, régler les secrets, activer la rédaction et les illustrations, ouvrir sur Internet |
| [docs/campagne.md](docs/campagne.md) | brancher sa propre campagne |
| [docs/architecture.md](docs/architecture.md) | comment le code est rangé, et la règle entre l'atelier et le coin des joueurs |
| [docs/front.md](docs/front.md) | le JavaScript : dossiers, points d'entrée, listes à tenir à jour |
| [docs/fonctionnalites.md](docs/fonctionnalites.md) | ce que fait chaque onglet |
| [docs/fonctionnement.md](docs/fonctionnement.md) | les mécanismes et les règles posées au fil du temps |
| [docs/exploitation.md](docs/exploitation.md) | construire, tester, déployer, contrôler |

Code sous licence MIT (`LICENSE`). Les polices sont sous SIL Open Font License (`app/static/fonts/OFL.txt`).
