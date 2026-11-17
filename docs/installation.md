# Installer

L'atelier et le coin des joueurs tournent dans Docker, sur n'importe quelle machine Linux ou macOS du réseau de la
table.

**À savoir avant tout** : sur le réseau local, l'atelier s'ouvre sans mot de passe (c'est l'ordinateur du MJ, la TV, son
téléphone). Ses ports écoutent par défaut sur toutes les interfaces de la machine : sur un serveur joignable depuis
Internet, régler `ATELIER_ADRESSE` et `JOUEURS_ADRESSE` dans `.env` sur l'adresse du réseau local (Docker passe outre la
plupart des pare-feu de l'hôte). Pour ouvrir quelque chose à Internet, voir plus bas.

## Démarrer

Il faut Docker et Docker Compose 2.24 ou plus récent ; Node 22 ou plus seulement pour lancer les vérifieurs de `outils/`.

```
git clone <adresse du dépôt> arriere-salle && cd arriere-salle
cp .env.example .env                  # facultatif : ports, pack de campagne, adresses
mkdir -p data/propositions secrets
docker compose up -d --build
```

- Atelier du MJ : `http://<machine>:8323` (sur le réseau local, sans mot de passe).
- Écran de table : `http://<machine>:8323/table`, à ouvrir sur la TV, une tablette ou un ordinateur relié à l'écran.
- Coin des joueurs : `http://<machine>:8324`. Chaque joueur reçoit un identifiant et un mot de passe provisoire depuis
  l'onglet Aventuriers de l'atelier.

Les conteneurs tournent sous l'utilisateur 1000 : `data/` doit lui appartenir (`sudo chown -R 1000:1000 data` si besoin).
Tout ce que l'atelier enregistre est dans `data/` : c'est le dossier à sauvegarder.

Sans pack de campagne, l'atelier démarre avec une petite campagne d'exemple. Pour jouer la sienne : `docs/campagne.md`.

## Les secrets

Ils vivent dans `secrets/` (jamais versionné), un fichier par usage, tous facultatifs. Le coin des joueurs n'en reçoit
aucun.

| fichier | contenu | sans lui |
|---|---|---|
| `secrets/redaction.env` | `ANTHROPIC_API_KEY=...` | la rédaction passe par le modèle local, ou se tait |
| `secrets/acces.env` | écrit par `python3 outils/mot-de-passe.py` | l'atelier ne s'ouvre pas depuis Internet |
| `secrets/telegram.env` | `TELEGRAM_BOT_TOKEN=...` et `TELEGRAM_CHAT_ID=...` | aucune alerte au MJ |

Après un changement : `docker compose up -d aventures-atelier`.

Les autres clés (sessions, jetons de la TV) naissent seules au premier démarrage dans `data/` : rien à fournir.

## Les outils de rédaction et d'illustration

Trois moteurs, indépendants et facultatifs. L'atelier marche sans aucun : les boutons qui en dépendent le disent.

### La rédaction : l'API d'Anthropic

Elle écrit les fiches de PNJ, le « Précédemment », les histoires d'aventuriers, les consignes et relectures de
scénario, les squelettes de scénario, les fiches de lieu, l'habillage des cartes et des plans, les consignes
d'illustration, le contrôle des portraits et l'aide à l'écriture des joueurs.

1. Créer une clé sur la console de l'API d'Anthropic et y prévoir un crédit (paiement à l'usage).
2. L'écrire dans `secrets/redaction.env` :

   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

3. `docker compose up -d aventures-atelier`. L'onglet Réglages, rubrique Rédaction, montre alors les coûts du mois et
   les estimations.

Modèles par défaut, à changer au besoin dans le même fichier : `CLAUDE_MODELE` (la rédaction du MJ,
`claude-opus-5-5`), `CLAUDE_MODELE_JOUEURS` (l'aide à l'écriture des joueurs, `claude-sonnet-5-5`),
`CLAUDE_MODELE_REGARD` (le contrôle des portraits, `claude-haiku-5-5`). Les tarifs servent au journal des coûts
(`TARIFS` dans `app/ia/redaction.py`).

Garde-fous : l'aide des joueurs a un quota par joueur et par mois et un plafond en dollars (Réglages, Coin des
joueurs) ; un MJ invité a son budget du mois (3 $ par défaut). Un texte destiné aux joueurs ne part vers l'API qu'avec
ce qu'ils savent déjà.

Sans clé : PNJ, « Précédemment » et histoires passent par le modèle local s'il répond ; les autres boutons répondent
« Aucune clé d'API n'est configurée sur le serveur ».

### Le modèle local : Ollama

Le secours de la rédaction, et l'auteur des consignes d'illustration quand l'API manque.

1. Installer Ollama sur la machine hôte, puis `ollama pull qwen2.5:7b`.
2. Le rendre joignable depuis Docker : `OLLAMA_HOST=0.0.0.0:11434` dans le service d'Ollama, et, si un pare-feu tourne,
   ouvrir le port 11434 aux réseaux Docker (`172.16.0.0/12`).
3. Autre adresse ou autre modèle : `OLLAMA_URL` et `OLLAMA_MODELE` dans `secrets/redaction.env`.
   Si le pare-feu jette les paquets au lieu de les refuser, chaque rédaction attend jusqu'à quatre minutes avant de
   rendre la main : ouvrir le port, ou laisser Ollama éteint (la réponse est alors immédiate).

### Les illustrations : ComfyUI

Portraits, illustrations de lieux et de scènes, cartes et plans peints. Il faut une carte graphique NVIDIA d'au moins
6 Go de mémoire.

1. Installer ComfyUI sur la machine hôte (une version qui a le nœud `APG`, présent depuis 2025).
2. Déposer le modèle `DreamShaperXL_Lightning.safetensors` dans `ComfyUI/models/checkpoints/`.
3. Lancer ComfyUI en écoute pour Docker : `python main.py --listen 0.0.0.0 --port 8188` (pare-feu : port 8188 ouvert à
   `172.16.0.0/12`).
4. Autre adresse : `COMFY_URL` dans `secrets/redaction.env`. Autre modèle, pas, échantillonneur, styles :
   `app/comfy/reglages.json`, lu dans l'image : reconstruire après l'avoir changé (`docker compose up -d --build aventures-atelier`).

L'onglet Illustrations dit si le moteur répond. Avec une clé d'API, chaque portrait est relu par un modèle qui vérifie
qu'il suit sa description ; sans clé, il est gardé tel quel.

## Ouvrir sur Internet (facultatif)

Trois portes, chacune derrière https (un tunnel comme Cloudflare Tunnel, ou un proxy inverse qui transmet le nom
d'hôte public tel quel) :

- **le coin des joueurs** : le seul service fait pour Internet. `JOUEURS_HOTES` = son nom ; `LIEN_JOUEURS` = son adresse.
  Pour qu'il n'ait aucun port ouvert, déclarer son réseau interne dans un `docker-compose.override.yml` et n'y brancher
  que le tunnel ;
- **la table en lecture seule** : `TABLE_PUBLIQUE` = son nom. Le reste de l'atelier y répond 404 ;
- **l'atelier entier**, derrière un mot de passe : `python3 outils/mot-de-passe.py --generer` écrit `secrets/acces.env`,
  puis `ATELIER_PUBLIC` = son nom. L'identifiant du MJ principal est `MJ` (ou vide).

Un `docker-compose.override.yml` (jamais versionné) garde ce qui ne vaut que pour un serveur : réseau du tunnel, ports
fermés, sous-réseau fixe pour le pare-feu.

Le coin des joueurs compte les essais de connexion par adresse, lue dans l'en-tête `CF-Connecting-IP` quand il y en a un :
c'est juste derrière Cloudflare. Derrière un autre proxy, ne publier le coin que par lui (port fermé ou réseau interne),
pour qu'un client ne puisse pas forger cet en-tête.

## Tester

```
docker run --rm -e PYTHONDONTWRITEBYTECODE=1 -v "$PWD":/src -w /src aventures-atelier:latest \
  sh -c "pip install -q pytest && python -m pytest tests -q -p no:cacheprovider"
node outils/verifier_imports.mjs
```

La suite complète, les vérifieurs et le contrôle avant un déploiement : `docs/exploitation.md`.
