"""Le contenu de la campagne dont le coin des joueurs a besoin (docs/campagne.md) : seulement des constantes, sans import.
Un pack de campagne remplace ce fichier par le sien, avec les mêmes noms. commun/ ne dépend jamais de l'atelier : le contenu
de l'atelier vit à part, dans campagne/.

Ici, la campagne d'exemple.
"""

# La bible de la campagne (notes/lore, bible.py) : ses fiches d'épisode et ses synthèses se rangent par groupe, un dossier
# episodes/<groupe>/ et une synthèse saisons/<groupe>.md (avec ses arbitrages, saisons/<groupe>-arbitrages.md). Les groupes
# dans l'ordre de lecture, puis leur nom à l'écran. Seuls ces groupes s'ouvrent aux joueurs.
ORDRE_GROUPES_BIBLE = ["saison-1", "saison-2", "hors-serie"]
NOMS_GROUPES_BIBLE = {"saison-1": "Saison 1", "saison-2": "Saison 2", "hors-serie": "Hors-série"}

# Le nom de la campagne et ce qui l'accompagne à l'écran : titres des pages, logo de la table et de la fiche imprimée
# (commun/nom_campagne.py, js/campagne/nom.js), sous-titre de l'accueil de la table et du carton d'épisode, devise.
NOM = "L'Arrière-salle"
SOUS_TITRE = "La campagne"
DEVISE = "« Il y a toujours une table de libre au fond de la salle. »"
