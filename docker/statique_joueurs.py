"""Au moment de construire l'image du coin des joueurs : ne garder du dossier static que ce que ce service sert.

Le coin est le seul service public. Il sert ses pages (static/joueurs/*.html) et les fichiers de la liste FICHIERS de
joueurs.py, rien d'autre. Les autres fichiers (les modules de l'atelier, ses pages, les fiches de départ de la campagne et
leurs secrets) n'entrent donc pas dans son image. Usage : python statique_joueurs.py <dossier app> <dossier de sortie>
"""

import os
import shutil
import sys
from pathlib import Path

app, sortie = Path(sys.argv[1]), Path(sys.argv[2])
os.environ.setdefault("DEPOT_DIR", "/tmp/depot")
sys.path.insert(0, str(app))

import joueurs  # noqa: E402

statique = app / "static"
fichiers = [statique / "joueurs" / p.name for p in sorted((statique / "joueurs").glob("*.html"))]
# Les jingles des tests viennent du pack de campagne (docs/campagne.md) : sans pack, le coin se construit sans eux.
FACULTATIFS = ("sons/",)
manquants = []
for chemin in sorted(joueurs.FICHIERS):
    source = statique / chemin
    if source.is_file():
        fichiers.append(source)
    elif not chemin.startswith(FACULTATIFS):
        manquants.append(source)
if manquants:
    sys.exit("Fichiers de FICHIERS introuvables dans static/ : " + ", ".join(str(m.relative_to(statique)) for m in manquants))
for source in fichiers:
    cible = sortie / source.relative_to(statique)
    cible.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, cible)
print(f"{len(fichiers)} fichiers gardés pour le coin des joueurs")
