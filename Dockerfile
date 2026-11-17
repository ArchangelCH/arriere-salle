# Deux images, une par service (docker-compose.yml) :
#   joueurs : le coin des joueurs, seul service public. Son code (joueurs.py et commun/), ses fichiers statiques et rien de
#             l'atelier : ni les modules des MJ, ni la rédaction par le modèle, ni les fiches de départ de la campagne.
#   atelier : l'atelier du MJ (dernière étape : sans cible, c'est celle-ci). Hors du compose, le contexte « campagne » se
#             donne à la main : docker build --build-context campagne=docker/campagne-vide .

# Le code de app/, recouvert par le pack de campagne (docs/campagne.md) : le contexte nommé « campagne » (docker-compose.yml,
# CAMPAGNE_DIR ; sans lui, docker/campagne-vide, qui ne remplace rien). Toutes les étapes partent de là.
FROM scratch AS source
COPY app/ /app/
COPY --from=campagne app/ /app/

# L'écran de la TV : un seul script, transpilé pour son navigateur (LG webOS 6, Chromium 79). L'atelier garde ses modules.
FROM node:22.23.3-alpine3.24 AS tv
WORKDIR /construction
RUN npm install --no-audit --no-fund --no-save esbuild@0.28.2
COPY --from=source /app/static/js ./js
RUN ./node_modules/.bin/esbuild js/table.js --bundle --format=iife --target=chrome79 --minify --sourcemap --outfile=tv/table.js
# Le relief des cartes peintes se calcule dans un worker : script classique lui aussi (Chromium 79 n'a pas de worker en module).
RUN ./node_modules/.bin/esbuild js/carte/peint-worker.js --bundle --format=iife --target=chrome79 --minify --sourcemap --outfile=tv/peint-worker.js

# Le socle des deux services : Python et Chromium sans écran (les fiches partent en PDF, rendues comme à l'impression).
FROM python:3.12-slim AS socle
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
VOLUME /data
EXPOSE 8000

FROM socle AS joueurs-dependances
COPY requirements-joueurs.txt .
RUN pip install --no-cache-dir -r requirements-joueurs.txt

# Les seuls fichiers statiques que sert le coin (docker/statique_joueurs.py lit la liste FICHIERS de joueurs.py).
FROM joueurs-dependances AS joueurs-statique
COPY --from=source /app/ /source/
COPY docker/statique_joueurs.py /statique_joueurs.py
RUN python /statique_joueurs.py /source /statique

FROM joueurs-dependances AS joueurs
COPY --from=source /app/joueurs.py .
COPY --from=source /app/commun ./commun
COPY --from=joueurs-statique /statique ./static
CMD ["uvicorn", "joueurs:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--no-server-header"]

FROM socle AS atelier
COPY requirements.txt requirements-joueurs.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=source /app/ .
COPY --from=tv /construction/tv/ static/tv/
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
