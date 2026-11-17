"""Les dossiers de données, les constantes et les réglages de l'environnement de l'atelier."""

import logging
import mimetypes
import os
import re
from pathlib import Path


journal = logging.getLogger("atelier")

ICI = Path(__file__).parent.parent
DONNEES = Path(os.environ.get("DATA_DIR", "/data"))
CARTES = DONNEES / "cartes"
LIEUX = DONNEES / "lieux"
PNJ = DONNEES / "pnj"
CONTRATS = DONNEES / "contrats"
RUMEURS = DONNEES / "rumeurs"
FILS = DONNEES / "fils"
SEANCES = DONNEES / "seances"
RENCONTRES = DONNEES / "rencontres"
AVENTURIERS = DONNEES / "aventuriers"
PLANS = DONNEES / "plans"
IDEES = DONNEES / "idees"
SCENARIOS = DONNEES / "scenarios"
# Les boutiques du MJ (marchands, échoppes) : leurs articles et leurs prix, montrés à la TV sur demande.
BOUTIQUES = DONNEES / "boutiques"
# Les documents remis aux joueurs (documents.py) : lettres, affiches, notes, parchemins, plans.
DOCUMENTS = DONNEES / "documents"
# Le coin des joueurs : leurs propositions (seul dossier que voit le service public) et leurs liens (ici seulement).
PROPOSITIONS = DONNEES / "propositions"
JOUEURS = DONNEES / "joueurs.json"
LIEN_JOUEURS = os.environ.get("LIEN_JOUEURS", "http://localhost:8324").rstrip("/")
CAMPAGNE = DONNEES / "campagne.json"
IMAGES = DONNEES / "images"
HISTORIQUE = DONNEES / "historique"
CORBEILLE = DONNEES / "corbeille"
TABLE = DONNEES / "table.json"
TABLE_OUVERTURE = DONNEES / "table-publique.json"
MUSIQUE = DONNEES / "musique.json"
CLE_JETONS = DONNEES / ".cle-jetons"

for dossier in (CARTES, LIEUX, PNJ, CONTRATS, RUMEURS, FILS, SEANCES, RENCONTRES, AVENTURIERS, PLANS, IDEES, BOUTIQUES, DOCUMENTS, PROPOSITIONS, IMAGES, HISTORIQUE, CORBEILLE):
    dossier.mkdir(parents=True, exist_ok=True)

ID_VALIDE = re.compile(r"^[a-z0-9-]{1,60}$")
MEDIA_VALIDE = re.compile(r"^/media/([A-Za-z0-9][A-Za-z0-9._-]{0,120})$")
ARCHIVE_DELAI = 300  # une version archivée toutes les 5 minutes d'édition au plus
ARCHIVES_MAX = 40
FORMATS_IMAGES = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp"}
IMAGE_MAX = 25 * 1024 * 1024
PIXELS_MAX = 40_000_000
CORPS_MAX = 16 * 1024 * 1024
# Écrans de table venus d'Internet ; ceux du réseau local (la TV du salon) n'ont pas de limite. Une même adresse n'en
# ouvre que quelques-uns : à elle seule, elle ne prend pas toutes les places.
ECRANS_MAX = 24
ECRANS_PAR_ADRESSE = 4

mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/ttf", ".ttf")
