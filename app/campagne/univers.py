"""L'univers de la campagne, tel que le lisent les modèles de rédaction et d'images (docs/campagne.md) : seulement des
constantes, que les consignes de l'atelier insèrent à leur place. Un pack de campagne remplace ce fichier par le sien,
avec les mêmes noms.

Ici, la campagne d'exemple : un monde de fantasy médiévale inventé, sans nom propre.
"""

# Ce dont vient le canon, nommé comme les consignes le citent après « de » ou « avec » (« un flottement de l'univers »,
# « un personnage connu de l'univers »).
LA_SERIE = "l'univers"

# L'auberge dont le vrai nom est caché aux joueurs (data/noms-caches.json), comme les consignes la désignent : « Le nom
# de l'auberge de la campagne est une surprise pour les joueurs ».
AUBERGE_CACHEE = "l'auberge de la campagne"

# La consigne générale de l'aide à l'écriture du MJ (contexte_du_modele.py) : la suite de « Tu assistes le meneur de jeu
# (MJ) d'une campagne de jeu de rôle », puis le canon et le ton, chacun son paragraphe.
CONSIGNE_MONDE = """de fantasy médiévale, dans un monde inventé par son MJ :
un royaume de vallées et de forêts bordé de montagnes, où les cités marchandes, les temples et les vieilles familles se disputent l'influence."""

CONSIGNE_CANON = """Le canon, ce sont la bible de la campagne et le glossaire ci-dessous, écrits par le MJ ; rien d'autre. Ils font foi, avec
leurs sources. Quand la bible ne dit rien, c'est un non-dit : le MJ est libre, dis-le. Un « flottement » (deux versions
contradictoires d'un même fait) ne se tranche jamais à la place du MJ : présente-le comme une liberté. Si tu n'es pas sûr d'un
fait, dis-le plutôt que de l'affirmer."""

CONSIGNE_TON = """Le ton de la campagne : de l'aventure héroïque, avec de l'humour. Le monde reste sérieux ; l'humour vient des personnages et de la table."""

# Les PNJ proposés (illustrations.py) : la suite de « préparer un personnage non joueur pour », jusqu'au ton.
PNJ_CAMPAGNE = """une campagne de fantasy médiévale :
un royaume de vallées et de forêts bordé de montagnes. Les temples et les guildes marchandes se disputent l'influence,
la magie est rare et chère, les aventuriers sont admirés et craints.
Le ton : le monde est sérieux ; le personnage se joue au premier degré."""

# Le résumé lu aux joueurs en début de séance (illustrations.py) : son titre, que le modèle n'a pas à recopier, et la
# ligne qui situe la campagne.
TITRE_PRECEDEMMENT = "Précédemment dans la campagne"
PRECEDEMMENT_UNIVERS = "dans une campagne de fantasy médiévale, où le monde est sérieux et l'humour vient des personnages."

# L'histoire d'un aventurier (illustrations.py) : la suite de « en tête de la fiche d'un personnage joueur, pour », puis
# deux exemples de ton, sur d'autres personnages (un par ligne).
HISTOIRE_UNIVERS = """un jeu de rôle de fantasy médiévale :
un royaume de vallées et de forêts bordé de montagnes, où les temples et les guildes marchandes se disputent l'influence
et où la magie est rare."""

HISTOIRE_EXEMPLES = """Ancien passeur du grand fleuve, renvoyé après une crue « qu'il avait pourtant annoncée », Aldo garde une rame brisée au-dessus de son lit. Il veut prouver qu'il avait raison. Il ne sait pas encore à qui.
Apprentie herboriste, Isaure s'est perdue trois nuits en forêt à chercher une fleur qui ne s'ouvre qu'au clair de lune. Elle en est revenue avec la fleur, et une voix qu'elle seule entend."""

# L'aide à l'écriture des joueurs (aide_mj.py) : la suite de « Tu aides un joueur de ».
AIDE_CAMPAGNE = "la campagne de jeu de rôle de fantasy médiévale de son MJ"

# La charte visuelle des portraits avant que le MJ ne l'enregistre (charte.py) : des repères déclenchés par les mots de
# la description du personnage (sans accents ni majuscules). Mêmes clés pour chaque repère.
CHARTE_DEPART = [
    {"id": "nain", "type": "peuple", "nom": "Nains", "mots": ["nain", "naine", "nains", "naines"],
     "appuyer": "dwarf", "cadrage": "mi-corps",
     "allure": "Petit et trapu (environ 1,30 m), très large d'épaules, torse en tonneau, cou épais, grosse tête, nez large, "
               "arcades lourdes, mains énormes, oreilles humaines. Les hommes portent une barbe longue et fournie, souvent "
               "tressée.",
     "couleurs": "", "interdits": "grand, élancé, cou long, oreilles pointues, cornes, casque à cornes, visage fin de jeune premier",
     "a_valider": True},
    {"id": "elfe", "type": "peuple", "nom": "Elfes", "mots": ["elfe", "elfes"], "appuyer": "elf", "cadrage": "",
     "allure": "Élancé, traits fins et allongés, longues oreilles pointues, regard qui a vu passer beaucoup d'années.",
     "couleurs": "", "interdits": "trapu, barbe épaisse, oreilles rondes", "a_valider": True},
    {"id": "orc", "type": "peuple", "nom": "Orcs", "mots": ["orc", "orcs", "orque", "orques"], "appuyer": "orc",
     "cadrage": "mi-corps",
     "allure": "Carrure massive, peau grise ou verdâtre, mâchoire lourde, crocs inférieurs.",
     "couleurs": "", "interdits": "", "a_valider": True},
    {"id": "temple-aube", "type": "faction", "nom": "Temple de l'Aube",
     "mots": ["de l'aube", "temple de l aube"], "appuyer": "", "cadrage": "",
     "allure": "Tenue du Temple de l'Aube : blanc et ivoire, ornements dorés, soleil levant en emblème.",
     "couleurs": "blanc, ivoire, or", "interdits": "rouge, noir dominant", "a_valider": True},
    {"id": "tour-noire", "type": "faction", "nom": "Gardes de la Tour noire", "mots": ["tour noire"], "appuyer": "",
     "cadrage": "", "allure": "Gardes d'élite en armure noire, cape gris fer.",
     "couleurs": "noir, acier sombre, gris fer", "interdits": "armure blanche, couleurs vives", "a_valider": True},
    {"id": "guilde-marchande", "type": "faction", "nom": "Guilde des marchands", "mots": ["guilde des marchands"],
     "appuyer": "", "cadrage": "", "allure": "", "couleurs": "", "interdits": "", "a_valider": True},
]
