// La carte de la région de la campagne (modèle « pays-castelblanc ») : ses formes de terrain, ses rivières, ses lieux,
// leurs fiches et leurs secrets. Des données seulement, lues par carte/saison4.js et carte/generateur.js. Jamais servies
// au coin, à la TV ni au MJ invité.
//
// Ici, la région de la campagne d'exemple : la vallée de Valombre, autour du lac Miroir. Coordonnées en pourcentage de la
// carte : x vers l'est, y vers le sud.

export const LARGEUR_KM = 240;
export const HAUTEUR_KM = 155;

// Formes du terrain, peintes dans l'ordre : une forme posée plus bas recouvre les précédentes. « biome » : la clé d'un
// terrain de carte/biomes.js ; « points » : un polygone, « ellipse » : [x, y, rayon en x, rayon en y]. Les champs
// (« cultures ») ne poussent que sur la plaine.
export const FORMES = [
  { biome: "collines", points: [[3, 28], [15, 24], [23, 34], [21, 50], [9, 55], [2, 45]] },
  { biome: "foret_profonde", points: [[20, 5], [34, 2], [48, 3], [60, 9], [58, 24], [46, 32], [32, 31], [19, 21]] },
  { biome: "montagnes", points: [[68, 4], [84, 1], [97, 3], [98, 42], [93, 62], [81, 58], [74, 42], [67, 22]] },
  { biome: "sommets", points: [[79, 9], [92, 8], [94, 34], [87, 46], [80, 30]] },
  { biome: "montagnes", points: [[2, 66], [17, 63], [29, 74], [27, 92], [11, 97], [2, 88]] },
  { biome: "sommets", points: [[6, 73], [16, 71], [21, 81], [13, 88]] },
  { biome: "marais", points: [[35, 67], [47, 65], [57, 68], [55, 77], [41, 78]] },
  { biome: "pins", points: [[58, 76], [74, 71], [86, 80], [81, 97], [63, 98], [55, 87]] },
  { biome: "cultures", ellipse: [60, 46, 8, 6] },
  { biome: "eau", ellipse: [45, 55, 10, 7] },
];

// Rivières : la Claire descend des collines de l'ouest jusqu'au lac, la Vive sort du lac à Valombre et file vers les pins
// du sud-est. Leur identifiant commence par « riviere- » ou « fleuve- » : « Relancer le relief » de l'éditeur reconnaît
// ainsi les tracés qu'il redessine.
export const RIVIERES = [
  { id: "riviere-claire", nom: "La Claire", points: [[8, 12], [10, 20], [14, 28], [18, 36], [22, 44], [27, 50], [31, 54], [35.5, 55]], largeur: [0.35, 0.9] },
  { id: "riviere-vive", nom: "La Vive", points: [[54.6, 56.5], [58, 58.5], [62, 60], [66, 61.2], [70, 63.5], [74, 67], [78, 71], [82, 75]], largeur: [1.0, 0.8] },
];

export const LIEUX = [
  { cle: "valombre", nom: "Valombre", type: "capitale", x: 56.5, y: 52.5 },
  { cle: "auberge-du-gue", nom: "L'auberge du Gué", type: "auberge", x: 62, y: 49 },
  { cle: "tour-de-guet", nom: "La Tour de Guet", type: "forteresse", x: 33.5, y: 55.5 },
  { cle: "les-saulaies", nom: "Les Saulaies", type: "village", x: 19, y: 40 },
  { cle: "tertre-du-roi", nom: "Le Tertre du Roi", type: "tombeau", x: 28, y: 18 },
  { cle: "pierrefeu", nom: "Pierrefeu", type: "ville", x: 71, y: 40 },
  { cle: "forge-rouge", nom: "La Forge-Rouge", type: "cite_naine", x: 84, y: 26 },
  { cle: "mine-de-la-forge", nom: "La Mine de la Forge", type: "mine", x: 79, y: 34 },
  { cle: "moulin-d-aval", nom: "Le Moulin d'Aval", type: "village", x: 67, y: 61.5 },
  { cle: "ronceboise", nom: "Ronceboise", type: "village", x: 50, y: 84 },
  { cle: "prieure-des-cimes", nom: "Le Prieuré des Cimes", type: "temple", x: 14, y: 79 },
];

// Routes : d'un lieu à l'autre, route ou chemin (le tracé exact suit le terrain).
export const ROUTES = [
  ["les-saulaies", "tour-de-guet", "route"], ["tour-de-guet", "valombre", "route"], ["les-saulaies", "tertre-du-roi", "chemin"],
  ["valombre", "pierrefeu", "route"], ["pierrefeu", "forge-rouge", "route"], ["forge-rouge", "mine-de-la-forge", "chemin"],
  ["moulin-d-aval", "pierrefeu", "chemin"], ["valombre", "ronceboise", "route"], ["tour-de-guet", "prieure-des-cimes", "chemin"],
];

// Fiches : ce que l'on sait de chaque lieu, et ce que le MJ garde pour lui.
export const FICHES = {
  valombre: { resume: "Petite ville de la prévôté, sur la rive est du lac Miroir, là où en sort la Vive : un port de pêche, une halle aux grains, le château de la prévôte posé sur un éperon.", secrets: "Le bailli de Valombre vend en secret les grains de réserve aux marchands de Pierrefeu." },
  "tour-de-guet": { resume: "Vieille tour carrée à la pointe ouest du lac, qui garde le gué de la Claire. Une poignée de gardes s'y relaient.", secrets: "La cave de la tour communique avec une ancienne galerie qui passe sous le lac." },
  "les-saulaies": { resume: "Village de vanniers et de passeurs sur la Claire, au pied des collines de l'ouest." },
  "tertre-du-roi": { resume: "Un grand tertre herbu au cœur de la forêt du nord, où dort, dit-on, un roi oublié.", secrets: "Le tertre est vide : le roi s'est relevé il y a longtemps et chasse la nuit dans la forêt." },
  pierrefeu: { resume: "Bourg de charbonniers au pied des Crêtes Grises, enfumé par ses fours, où se vendent l'étain et le charbon." },
  "forge-rouge": { resume: "Une cité naine creusée dans la montagne, au-dessus de Pierrefeu, autour de la forge Barbe-de-Fer. On n'y commerce qu'avec ceux qui paient d'avance." },
  "mine-de-la-forge": { resume: "La mine des nains de la Forge-Rouge, plus bas dans la montagne : des galeries d'étain et de fer.", secrets: "Les nains ont muré leur galerie la plus profonde : quelque chose y gratte la roche." },
  "moulin-d-aval": { resume: "Un hameau autour d'un grand moulin sur la Vive, à l'est de Valombre.", secrets: "Le meunier cache des contrebandiers dans son grenier contre une part du sel." },
  ronceboise: { resume: "Village de bûcherons au sud des Mouillères, à la lisière des pins." },
  "prieure-des-cimes": { resume: "Un prieuré de pierre accroché à la montagne du sud-ouest, où le prieur et ses frères soignent les blessés et copient de vieux livres." },
};

// Textes des fiches qui ne viennent pas de la carte : ce que la campagne ajoute (l'auberge des héros, un secret de plus).
export const FICHES_EN_PLUS = {
  valombre: { secrets: "Un messager porteur d'une lettre scellée est attendu depuis trois jours à la prévôté : il n'arrivera pas." },
  "auberge-du-gue": {
    resume: "L'auberge des héros, au gué de la route de Pierrefeu, à l'entrée de la vallée de Valombre. Une grande salle, une cheminée, une planche couverte d'affiches, une lanterne de fer qu'on n'allume jamais.",
    secrets: "Son vrai nom est une surprise pour les joueurs : la Lanterne Sourde, du nom de l'ancienne compagnie de mercenaires de Berthe, l'aubergiste. Pour le révéler, renommez cette fiche.",
  },
};

// L'origine des lieux de la région, pour leur fiche : leur étiquette (officiel, série ou maison) et la note du MJ.
export const ORIGINE = { etiquette: "officiel", note: "Position d'après la carte de la région." };

// L'auberge des héros se tient au bord de la route de Pierrefeu, à la sortie de Valombre : à « distance » cases du départ
// de la route, décalée de « decalage ». Sa fiche est une proposition de l'atelier, à valider.
export const LIEU_AU_BORD_DE_ROUTE = {
  lieu: "auberge-du-gue",
  route: ["valombre", "pierrefeu"],
  distance: 8,
  decalage: [1.2, -0.4],
  etiquette: "maison",
  note: "Emplacement proposé par l'atelier : au gué de la route de Pierrefeu, à la sortie de la ville.",
};

// Les noms de la carte de la région. « position » : en pourcentage de la carte.
export const ETIQUETTES = [
  { id: "e-lac", texte: "Lac Miroir", style: "mer", position: [44, 54], taille: 3.2, courbure: 0.2, angle: 0 },
  { id: "e-cretes", texte: "Les Crêtes Grises", style: "relief", position: [87, 20], taille: 3.2, courbure: 0, angle: 0 },
  { id: "e-ormoy", texte: "Forêt d'Ormoy", style: "foret", position: [40, 13], taille: 3.4, courbure: 0, angle: 0 },
  { id: "e-mouilleres", texte: "Les Mouillères", style: "petit", position: [46, 72], taille: 2.2, courbure: 0, angle: 0 },
  { id: "e-ouest", texte: "Marche de l'Ouest", style: "region", position: [11, 58], taille: 3, courbure: 0, angle: 0 },
  { id: "e-pinedes", texte: "Les Pinèdes", style: "region", position: [72, 92], taille: 2.8, courbure: 0, angle: 0 },
];

// Le cartouche de la carte de la région.
export const CARTOUCHE = { titre: "La vallée de Valombre", sous_titre: "Région de la campagne d'exemple" };
