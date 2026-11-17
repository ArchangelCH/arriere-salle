// La carte du monde de la campagne (modèle « cratere ») : ses lieux, leurs fiches et leurs secrets, ses noms, son relief et
// ses routes. Des données seulement, lues par carte/generateur.js. Jamais servies au coin, à la TV ni au MJ invité.
//
// Ici, le monde de la campagne d'exemple : le Val Clos, une grande vallée fermée par un cercle de montagnes, autour de la
// Mer Close. Coordonnées du monde : u vers l'est, v vers le sud, le centre en (0, 0), le cercle de montagnes en d = 1. Une
// position « region » est en pourcentage de la carte de la région (campagne/pays.js).

// Où se trouve la région (la vallée de Valombre) dans le monde. « ancre » : le lieu de la carte de la région posé en (u, v).
// « lieux » : les lieux de la région repris sur la carte du monde (les autres ne figurent que sur la carte de la région).
// « largeurs_rivieres » : la largeur, au départ et à l'arrivée, des rivières de la région redessinées sur le monde.
export const REGION_SUR_LE_MONDE = {
  ancre: "valombre",
  u: 0.1,
  v: 0.5,
  lieux: ["valombre", "tour-de-guet", "forge-rouge", "prieure-des-cimes"],
  largeurs_rivieres: { "riviere-claire": [0.2, 0.32], "riviere-vive": [0.42, 0.34] },
};

// Lieux du reste du monde. « origine » : « propose » pour une position choisie par l'atelier, à déplacer librement.
// « etiquette » : officiel, série ou maison. « cote » : au bord de l'eau ; « ile » : sur l'île qui sort de la mer (un seul
// lieu) ; « surEau » : posé sur l'eau ; « nomGauche » : le nom à gauche de l'icône ; « taille » : la taille de l'icône.
export const LIEUX_MONDE = [
  { cle: "salant", nom: "Salant", type: "cite", u: -0.27, v: -0.08, origine: "propose", etiquette: "officiel", connu: true, cote: true, nomGauche: true,
    resume: "Port de la rive ouest de la Mer Close, à quatre jours de route de Valombre, où se vendent le sel, la laine et les nouvelles de tout le Val.",
    secrets: "La guilde des sauniers paie des pirates pour faire monter le prix du sel." },
  { cle: "ile-aux-phares", nom: "L'Île aux Phares", type: "forteresse", u: -0.12, v: -0.14, origine: "propose", etiquette: "officiel", connu: true, ile: true, taille: 2.3,
    resume: "Un rocher fortifié au large de Salant, dont les feux guident les navires par gros temps.",
    secrets: "Le gardien du grand phare éteint parfois son feu, contre paiement, pour qu'un navire se brise sur les récifs." },
  { cle: "epave-du-heron", nom: "L'Épave du Héron", type: "point", u: 0.16, v: -0.12, origine: "propose", etiquette: "officiel", connu: true, surEau: true,
    resume: "La carcasse d'un grand navire marchand, échouée sur un haut-fond au milieu de la mer.",
    secrets: "Sa cale n'a jamais été vidée : personne n'ose toucher à la cargaison, qu'on dit maudite." },
  { cle: "hautefage", nom: "Hautefage", type: "ville", u: 0.22, v: -0.66, origine: "propose", etiquette: "officiel", connu: true,
    resume: "Ville fortifiée du nord, au pied des Monts de Givre, qui vit de la fourrure, de l'étain et des caravanes d'hiver." },
  { cle: "abbaye-de-bresille", nom: "L'Abbaye de Brésille", type: "temple", u: -0.62, v: -0.3, origine: "propose", etiquette: "officiel", connu: true,
    resume: "Une abbaye isolée dans les terres de l'ouest, où des copistes gardent les chroniques du Val.",
    secrets: "Une des chroniques raconte ce qu'il y a au-delà des cimes, et l'abbé la garde sous clé." },
  { cle: "relais-du-carrefour", nom: "Le Relais du Carrefour", type: "village", u: -0.08, v: 0.27, origine: "propose", etiquette: "maison", connu: true, taille: 2.2,
    resume: "Un relais fortifié où se croisent la route de la côte et celle du sud, avec une écurie et un tableau de contrats." },
  { cle: "ruines-d-ostre", nom: "Les Ruines d'Ostre", type: "ruine", u: 0.52, v: 0.24, origine: "propose", etiquette: "officiel", connu: false,
    resume: "Les restes d'une cité ancienne, à moitié enfouis sous les sables de l'est.",
    secrets: "Sous les dunes, la bibliothèque d'Ostre est intacte, et elle n'est pas abandonnée." },
];

// Les noms du monde. « region » : position en pourcentage de la carte de la région, pour les noms qui la concernent.
export const ETIQUETTES_MONDE = [
  { id: "e-mer", texte: "La Mer Close", style: "mer", u: 0.04, v: -0.03, taille: 6.2, courbure: 0.3 },
  { id: "e-dehors-o", texte: "Au-delà des cimes", style: "region", u: -1.24, v: 0.0, taille: 4.9, angle: -Math.PI / 2 },
  { id: "e-dehors-e", texte: "Au-delà des cimes", style: "region", u: 1.24, v: 0.0, taille: 4.9, angle: Math.PI / 2 },
  { id: "e-ouest", texte: "Les Terres de l'Ouest", style: "region", u: -0.58, v: -0.08, taille: 4.4, courbure: 0.2 },
  { id: "e-cretes", texte: "Les Crêtes Grises", style: "relief", region: [88, -6], taille: 2.6 },
  { id: "e-ormoy", texte: "Forêt d'Ormoy", style: "foret", region: [40, 14], taille: 2.1 },
  { id: "e-givre", texte: "Monts de Givre", style: "relief", u: -0.08, v: -0.86, taille: 3.0 },
  { id: "e-cendre", texte: "Monts de Cendre", style: "relief", u: -0.6, v: 0.62, taille: 3.2, angle: 0.18 },
  { id: "e-col", texte: "Le Col aux Loups", style: "petit", u: -0.45, v: -0.46, taille: 2.4 },
  { id: "e-sables", texte: "Les Sables d'Ostre", style: "region", u: 0.56, v: 0.4, taille: 3.0 },
];

// Les routes du monde, d'un lieu à l'autre (lieux du monde ou de la région) : route ou chemin. Le tracé suit le terrain.
export const ROUTES_MONDE = [
  ["valombre", "relais-du-carrefour", "route"], ["relais-du-carrefour", "salant", "route"], ["tour-de-guet", "relais-du-carrefour", "chemin"],
  ["salant", "abbaye-de-bresille", "route"], ["salant", "hautefage", "route"], ["valombre", "ruines-d-ostre", "chemin"],
];

// Le relief du monde, par-dessus le cercle de montagnes et les collines tirées au hasard.
// - mer : [u, v, rayon est-ouest, rayon nord-sud] de la mer intérieure ;
// - formes : dans l'ordre, des bosses (« bosse » : [u, v, rayon]) qui lèvent ou creusent le terrain selon le signe de
//   « force », et des crêtes (« crete » : leurs deux bouts ; « crete_region » : un départ sur la carte de la région et
//   « vers », le chemin jusqu'à l'autre bout), qu'une « breche » peut ouvrir d'un col ;
// - humidite : des bosses qui mouillent ou assèchent le terrain (forêts, désert) ;
// - volcan, desert : [u, v, rayon] des terres de lave et du désert.
export const RELIEF_MONDE = {
  mer: [0.04, -0.08, 0.27, 0.22],
  formes: [
    // Les plaines de l'ouest, un peu plus basses.
    { bosse: [-0.5, -0.05, 0.3], force: -0.12 },
    // Les Crêtes Grises, qui montent au nord-est de la région.
    { crete_region: [88, 4], vers: [0.04, -0.26], largeur: 0.06, force: 0.8 },
    // Les Monts de Givre, au nord.
    { crete: [[-0.2, -0.97], [-0.02, -0.74]], largeur: 0.06, force: 0.85 },
    // Les Monts de Cendre, au sud-ouest, et leur volcan.
    { crete: [[-0.76, 0.5], [-0.46, 0.66]], largeur: 0.065, force: 0.72 },
    // Une crête de l'ouest, ouverte par le Col aux Loups.
    { crete: [[-0.62, -0.5], [-0.28, -0.44]], largeur: 0.055, force: 0.7, breche: { bosse: [-0.45, -0.47, 0.05], force: 0.85 } },
    // Les collines de l'est.
    { bosse: [0.62, -0.1, 0.13], force: 0.2 },
  ],
  humidite: [
    // Les bois humides de l'ouest, le nord boisé, les Sables d'Ostre.
    { bosse: [-0.55, -0.25, 0.2], force: 0.9 },
    { bosse: [0.1, -0.7, 0.3], force: 0.45 },
    { bosse: [0.56, 0.36, 0.2], force: -1.1 },
  ],
  volcan: [-0.6, 0.58, 0.2],
  desert: [0.56, 0.36, 0.2],
};

// Le cartouche de la carte du monde (un titre court : il est centré sur une abscisse fixe).
export const CARTOUCHE_MONDE = { titre: "Le Val Clos", sous_titre: "Le monde de la campagne d'exemple" };
