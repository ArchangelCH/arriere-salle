// Ce que d'autres modules lisent de l'éditeur de carte sans le charger : les lettres de ses outils (la carte des touches,
// touches.js) et la taille d'icône d'un lieu posé (le dialogue des lieux d'une carte jetée, lieux/jeter-carte.js). L'éditeur
// importe les cartes du kit (carte/generateur.js et carte/saison4.js, qui lisent campagne/carte.js et campagne/pays.js),
// leurs lieux et leurs secrets : il ne se charge qu'à l'ouverture d'une carte, chez le MJ principal.

// Les lettres des outils, montrées aussi sur la carte des touches (touches.js).
export const OUTILS = [
  ["main", "Sélection et déplacement", "V"],
  ["terrain", "Peindre le terrain", "B"],
  ["lieu", "Poser un lieu", "L"],
  ["trace", "Rivière, route, frontière", "R"],
  // E comme écrire : T ouvre le Tableau partout dans l'atelier ; la même touche que le texte des plans.
  ["texte", "Nom de région", "E"],
  ["brouillard", "Terres connues des joueurs", "F"],
  // J comme jeton : la touche des pions des héros sur les plans.
  ["groupe", "Position du groupe", "J"],
  // G comme graduer : la même touche que sur les plans, où M pose le mobilier.
  ["mesure", "Mesurer une distance", "G"],
  // C comme cible : la même touche que sur les plans (où P trace une pièce).
  ["pointeur", "Pointeur pour la TV", "C"],
];

// La taille d'icône d'un lieu posé, selon son genre et la taille des textes de la carte (k).
export const tailleMarqueur = (type, k = 1) => +((({ capitale: 1.7, cite: 1.55, ville: 1.45 })[type] || 1.3) * k).toFixed(2);
