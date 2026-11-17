// Les plans intérieurs : une grille de cases (1,5 m par défaut), un sol et une pièce par case. Les murs ne se dessinent
// pas : ils se déduisent des pièces. Portes sur les arêtes, mobilier et pions posés par-dessus, brouillard, brume et feu
// par case.

export const SOLS = [
  { id: 0, cle: "vide", nom: "Vide" },
  { id: 1, cle: "pierre", nom: "Dalles de pierre", couleur: "#8a8177" },
  { id: 2, cle: "plancher", nom: "Plancher", couleur: "#936640" },
  { id: 3, cle: "terre", nom: "Terre battue", couleur: "#86694a" },
  { id: 4, cle: "paves", nom: "Pavés", couleur: "#7b766c" },
  { id: 5, cle: "herbe", nom: "Herbe", couleur: "#6a8243" },
  { id: 6, cle: "roche", nom: "Sol de grotte", couleur: "#645b51" },
  { id: 7, cle: "eau", nom: "Eau", couleur: "#3b6a88" },
  { id: 8, cle: "marbre", nom: "Marbre", couleur: "#d6cfc1" },
  { id: 9, cle: "paille", nom: "Paille", couleur: "#bc9c52" },
  { id: 10, cle: "sable", nom: "Sable", couleur: "#c9b081" },
  // Ajoutés le 09/11 : l'identifiant d'un sol est sa place dans la liste, il ne change jamais.
  { id: 11, cle: "parquet-clair", nom: "Parquet clair", couleur: "#bf9363" },
  { id: 12, cle: "parquet-sombre", nom: "Parquet sombre", couleur: "#5c3b23" },
  { id: 13, cle: "dalles", nom: "Grandes dalles", couleur: "#9b958b" },
  { id: 14, cle: "tomettes", nom: "Tomettes", couleur: "#a25a3c" },
  { id: 15, cle: "tapis", nom: "Tapis", couleur: "#7a2a23" },
  { id: 16, cle: "pont", nom: "Pont de navire", couleur: "#8a6a47" },
  { id: 17, cle: "gravier", nom: "Gravier", couleur: "#8d867a" },
  { id: 18, cle: "boue", nom: "Boue", couleur: "#594631" },
  { id: 19, cle: "feuilles", nom: "Feuilles mortes", couleur: "#875a2c" },
  { id: 20, cle: "mousse", nom: "Mousse", couleur: "#566d38" },
  { id: 21, cle: "neige", nom: "Neige", couleur: "#e4e9ee" },
  { id: 22, cle: "glace", nom: "Glace", couleur: "#a7c3d1" },
  // Ajoutés le 10/11 pour les plans extérieurs.
  { id: 23, cle: "eau-profonde", nom: "Eau profonde", couleur: "#27536e" },
  { id: 24, cle: "falaise", nom: "Falaise", couleur: "#544b42" },
  { id: 25, cle: "cultures", nom: "Champ cultivé", couleur: "#9c8b45" },
];

// Les sols où l'on ne marche pas (l'eau profonde, la falaise), sauf sur un pont, un ponton ou une barque (« passage ») :
// mêmes identifiants que le serveur (deplacement.py, SOLS_INFRANCHISSABLES).
export const SOLS_INFRANCHISSABLES = new Set([23, 24]);

// Les sols dans la palette de l'éditeur : ceux du dedans, puis ceux du dehors.
export const SOLS_DEDANS = new Set(["pierre", "plancher", "marbre", "paille", "parquet-clair", "parquet-sombre", "dalles", "tomettes", "tapis", "pont"]);

// La matière des murs d'une pièce (piece.mur) ; vide : selon la pièce (pierre dehors, colombage ou pierre dedans).
// Entre deux pièces, le mur prend la matière de la première des deux cases (en haut, ou à gauche) qui en a une.
export const MURS = [["", "Selon la pièce"], ["pierre", "Pierre"], ["torchis", "Colombage et torchis"], ["bois", "Planches"], ["roche", "Roche taillée"], ["palissade", "Palissade"]];
export const murValide = (m) => (MURS.some(([v]) => v && v === m) ? m : "");

// Les teintes proposées pour un sol de pièce, un tapis, une tenture : des couleurs de teinturier. Toute autre couleur
// se choisit au nuancier ; seule une couleur #rrggbb est lue, le reste est ignoré.
export const TEINTES = [
  ["#8e2a20", "Garance"], ["#5c2440", "Pourpre"], ["#2c3e66", "Guède"], ["#2e5a4a", "Vert sapin"], ["#6b7a30", "Mousse"],
  ["#b8862e", "Safran"], ["#a8602c", "Ocre rouge"], ["#5a3a22", "Brou de noix"], ["#2a2622", "Noir de fumée"], ["#d6cab0", "Écru"], ["#77766f", "Gris de lin"],
];
export const teinteValide = (t) => (typeof t === "string" && /^#[0-9a-fA-F]{6}$/.test(t) ? t.toLowerCase() : null);

// La teinte du sol de chaque pièce qui en a une (piece.teinte) ; null si aucune : le plan se dessine alors comme avant.
export function teintesDesPieces(p) {
  let res = null;
  for (const pc of p.pieces || []) {
    const t = pc && teinteValide(pc.teinte);
    if (!t) continue;
    if (!res) res = new Map();
    res.set(pc.id, t);
  }
  return res;
}

// La lumière d'un plan (plan.lumiere, style peint) : sans réglage, celle de l'habillage, sinon le soir.
export const LUMIERES = [["jour", "Jour"], ["crepuscule", "Crépuscule"], ["nuit", "Nuit"], ["torches", "Torches"]];
export const lumiereValide = (l) => (LUMIERES.some(([v]) => v === l) ? l : null);

// salle : murs droits tout autour ; grotte : paroi de roche vers le vide, rien entre deux zones de grotte ;
// extérieur : ni mur vers le vide, ni entre deux zones extérieures (une cour, une rue, une clairière).
export const GENRES_PIECES = [["salle", "Salle, entre des murs"], ["grotte", "Grotte, parois de roche"], ["exterieur", "Extérieur, sans murs"]];

export const PORTES = [
  ["porte", "Porte"], ["double", "Porte double"], ["arche", "Passage ouvert"], ["fenetre", "Fenêtre"], ["grille", "Grille"], ["secrete", "Porte secrète"],
];
export const ETATS_PORTE = [["fermee", "Fermée"], ["ouverte", "Ouverte"], ["verrouillee", "Verrouillée"]];

// Mobilier : taille en cases (largeur × hauteur avant rotation). « cache » : visible du MJ seul, par défaut.
// « franchissable » : on marche dessus ou il pend au mur (tapis, trappe, piège…) ; le reste barre le passage.
// « passage » : on y marche même par-dessus ce qui barre (le pont sur la rivière, la barque sur l'eau).
// « sol » : posé à même le sol, sous le reste du mobilier (tapis, rivière). « teinte » : sa couleur se règle (o.teinte).
// Les clés ne changent jamais : un plan enregistré les garde. Les familles ne servent qu'à ranger la palette.
export const MOBILIER = [
  { groupe: "Auberge et maison", liste: [
    { cle: "table", nom: "Table", l: 2, h: 1 },
    { cle: "table-ronde", nom: "Table ronde", l: 1, h: 1 },
    { cle: "table-banquet", nom: "Table de banquet", l: 4, h: 2 },
    { cle: "chaise", nom: "Chaise", l: 1, h: 1 },
    { cle: "tabouret", nom: "Tabouret", l: 1, h: 1 },
    { cle: "banc", nom: "Banc", l: 2, h: 1 },
    { cle: "comptoir", nom: "Comptoir", l: 4, h: 1 },
    { cle: "comptoir-angle", nom: "Angle de comptoir", l: 1, h: 1 },
    { cle: "tonneau", nom: "Tonneau", l: 1, h: 1 },
    { cle: "tonneau-couche", nom: "Tonneau en perce", l: 2, h: 1 },
    { cle: "tonneaux-empiles", nom: "Tonneaux empilés", l: 2, h: 2 },
    { cle: "caisse", nom: "Caisse", l: 1, h: 1 },
    { cle: "etagere", nom: "Étagère", l: 2, h: 1 },
    { cle: "etagere-bouteilles", nom: "Casier à bouteilles", l: 2, h: 1 },
    { cle: "cheminee", nom: "Cheminée", l: 2, h: 1 },
    { cle: "cheminee-angle", nom: "Cheminée d'angle", l: 2, h: 2 },
    { cle: "four", nom: "Four", l: 1, h: 1 },
    { cle: "lit", nom: "Lit", l: 1, h: 2, teinte: true },
    { cle: "lit-double", nom: "Grand lit", l: 2, h: 2, teinte: true },
    { cle: "armoire", nom: "Armoire", l: 2, h: 1 },
    { cle: "coffre", nom: "Coffre", l: 1, h: 1 },
    { cle: "baignoire", nom: "Cuve de bain", l: 1, h: 2 },
    { cle: "planche-contrats", nom: "Planche à contrats", l: 2, h: 1, franchissable: true },
  ] },
  { groupe: "Échoppe et forge", liste: [
    { cle: "etal", nom: "Étal", l: 2, h: 1, teinte: true },
    { cle: "presentoir", nom: "Présentoir", l: 2, h: 1 },
    { cle: "mannequin", nom: "Mannequin d'armure", l: 1, h: 1 },
    { cle: "ratelier", nom: "Râtelier d'armes", l: 2, h: 1 },
    { cle: "etabli", nom: "Établi", l: 2, h: 1 },
    { cle: "forge", nom: "Foyer de forge", l: 2, h: 2 },
    { cle: "enclume", nom: "Enclume", l: 1, h: 1 },
    { cle: "soufflet", nom: "Soufflet", l: 1, h: 1 },
    { cle: "bac-trempe", nom: "Bac de trempe", l: 1, h: 1 },
    { cle: "meule", nom: "Meule à aiguiser", l: 1, h: 1 },
  ] },
  { groupe: "Temple", liste: [
    { cle: "autel", nom: "Autel", l: 2, h: 1 },
    { cle: "banc-temple", nom: "Banc à dossier", l: 3, h: 1 },
    { cle: "lutrin", nom: "Lutrin", l: 1, h: 1 },
    { cle: "fonts", nom: "Fonts de pierre", l: 1, h: 1 },
    { cle: "candelabre", nom: "Candélabre", l: 1, h: 1 },
    { cle: "reliquaire", nom: "Reliquaire", l: 1, h: 1 },
    { cle: "statue", nom: "Statue", l: 1, h: 1 },
    { cle: "grande-statue", nom: "Grande statue", l: 2, h: 2 },
    { cle: "colonne", nom: "Colonne", l: 1, h: 1 },
    { cle: "brasero", nom: "Brasero", l: 1, h: 1 },
  ] },
  { groupe: "Donjon et crypte", liste: [
    { cle: "sarcophage", nom: "Sarcophage", l: 1, h: 2 },
    { cle: "sarcophage-ouvert", nom: "Sarcophage ouvert", l: 1, h: 2 },
    { cle: "cercueil", nom: "Cercueil", l: 1, h: 2 },
    { cle: "ossements", nom: "Ossements", l: 1, h: 1, franchissable: true },
    { cle: "cage", nom: "Cage", l: 1, h: 1 },
    { cle: "chaines", nom: "Chaînes au mur", l: 1, h: 1, franchissable: true },
    { cle: "pilori", nom: "Pilori", l: 1, h: 1 },
    { cle: "herse", nom: "Herse baissée", l: 1, h: 1 },
    { cle: "fosse", nom: "Fosse", l: 1, h: 1 },
    { cle: "grille-egout", nom: "Grille au sol", l: 1, h: 1, franchissable: true },
    { cle: "cercle-rituel", nom: "Cercle rituel", l: 2, h: 2, franchissable: true, sol: true },
    { cle: "toiles", nom: "Toiles d'araignée", l: 1, h: 1, franchissable: true },
  ] },
  { groupe: "Extérieur et nature", liste: [
    { cle: "arbre", nom: "Arbre", l: 2, h: 2 },
    { cle: "chene", nom: "Grand chêne", l: 3, h: 3 },
    { cle: "sapin", nom: "Sapin", l: 2, h: 2 },
    { cle: "bouleau", nom: "Bouleau", l: 1, h: 1 },
    { cle: "saule", nom: "Saule", l: 3, h: 3 },
    { cle: "arbre-mort", nom: "Arbre mort", l: 2, h: 2 },
    { cle: "buisson", nom: "Buisson", l: 1, h: 1 },
    { cle: "fougeres", nom: "Fougères", l: 1, h: 1, franchissable: true },
    { cle: "souche", nom: "Souche", l: 1, h: 1 },
    { cle: "tronc", nom: "Tronc couché", l: 1, h: 3 },
    { cle: "menhir", nom: "Pierre levée", l: 1, h: 1 },
    { cle: "riviere", nom: "Rivière", l: 2, h: 4, sol: true },
    { cle: "pont", nom: "Pont de bois", l: 2, h: 4, franchissable: true, passage: true },
    { cle: "cloture", nom: "Clôture", l: 3, h: 1 },
    { cle: "palissade", nom: "Palissade", l: 3, h: 1 },
    { cle: "feu-de-camp", nom: "Feu de camp", l: 1, h: 1 },
    { cle: "tente", nom: "Tente", l: 2, h: 2, teinte: true },
    { cle: "panneau", nom: "Poteau indicateur", l: 1, h: 1 },
    // Ajoutés le 10/11 pour les plans extérieurs.
    { cle: "palmier", nom: "Palmier", l: 2, h: 2 },
    { cle: "roseaux", nom: "Roseaux", l: 1, h: 1, franchissable: true },
    { cle: "dune", nom: "Dune", l: 3, h: 2, franchissable: true, sol: true },
  ] },
  { groupe: "Ville et village", liste: [
    { cle: "fontaine", nom: "Fontaine", l: 2, h: 2 },
    { cle: "tombe", nom: "Pierre tombale", l: 1, h: 1 },
  ] },
  { groupe: "Ferme et écurie", liste: [
    { cle: "puits", nom: "Puits", l: 1, h: 1 },
    { cle: "stalle", nom: "Stalle", l: 2, h: 2 },
    { cle: "foin", nom: "Foin", l: 1, h: 1 },
    { cle: "charrette", nom: "Charrette", l: 2, h: 3 },
    { cle: "potager", nom: "Potager", l: 2, h: 2, franchissable: true },
    { cle: "epouvantail", nom: "Épouvantail", l: 1, h: 1 },
  ] },
  { groupe: "Grotte", liste: [
    { cle: "rochers", nom: "Rochers", l: 1, h: 1 },
    { cle: "gros-rocher", nom: "Gros rocher", l: 2, h: 2 },
    { cle: "stalagmite", nom: "Stalagmite", l: 1, h: 1 },
    { cle: "champignons", nom: "Champignons", l: 1, h: 1, franchissable: true },
    { cle: "cristaux", nom: "Cristaux", l: 1, h: 1 },
  ] },
  { groupe: "Navire et quai", liste: [
    { cle: "ponton", nom: "Ponton", l: 2, h: 3, franchissable: true, passage: true },
    { cle: "passerelle", nom: "Passerelle", l: 1, h: 3, franchissable: true, passage: true },
    { cle: "barque", nom: "Barque", l: 1, h: 2, franchissable: true, passage: true },
    { cle: "mat", nom: "Mât", l: 1, h: 1 },
    { cle: "gouvernail", nom: "Gouvernail", l: 1, h: 1 },
    { cle: "bitte", nom: "Bitte d'amarrage", l: 1, h: 1 },
    { cle: "ancre", nom: "Ancre", l: 1, h: 1 },
    { cle: "cordages", nom: "Cordages", l: 1, h: 1, franchissable: true },
    { cle: "filet", nom: "Filet de pêche", l: 2, h: 2, franchissable: true },
  ] },
  { groupe: "Ruines", liste: [
    { cle: "mur-ruine", nom: "Pan de mur", l: 3, h: 1 },
    { cle: "colonne-brisee", nom: "Colonne brisée", l: 1, h: 1 },
    { cle: "colonne-couchee", nom: "Colonne couchée", l: 1, h: 3 },
    { cle: "statue-brisee", nom: "Statue brisée", l: 1, h: 1 },
    { cle: "eboulis", nom: "Éboulis", l: 2, h: 2 },
    { cle: "gravats", nom: "Gravats", l: 1, h: 1, franchissable: true },
  ] },
  { groupe: "Bureau et bibliothèque", liste: [
    { cle: "bibliotheque", nom: "Bibliothèque", l: 2, h: 1 },
    { cle: "bureau", nom: "Bureau", l: 2, h: 1 },
    { cle: "fauteuil", nom: "Fauteuil", l: 1, h: 1, teinte: true },
    { cle: "table-cartes", nom: "Table des cartes", l: 2, h: 2 },
    { cle: "table-alchimie", nom: "Table d'alchimiste", l: 2, h: 1 },
    { cle: "globe", nom: "Globe", l: 1, h: 1 },
    { cle: "pile-livres", nom: "Livres empilés", l: 1, h: 1, franchissable: true },
  ] },
  { groupe: "Mise en scène", liste: [
    { cle: "tapis", nom: "Tapis", l: 2, h: 3, franchissable: true, sol: true, teinte: true },
    { cle: "tapis-rond", nom: "Tapis rond", l: 2, h: 2, franchissable: true, sol: true, teinte: true },
    { cle: "tapis-long", nom: "Chemin de tapis", l: 1, h: 4, franchissable: true, sol: true, teinte: true },
    { cle: "tenture", nom: "Tenture au mur", l: 2, h: 1, franchissable: true, teinte: true },
    { cle: "banniere", nom: "Bannière", l: 1, h: 1, teinte: true },
    { cle: "torchere", nom: "Torche au mur", l: 1, h: 1, franchissable: true },
    { cle: "bouclier", nom: "Bouclier au mur", l: 1, h: 1, franchissable: true },
    { cle: "coffre-fer", nom: "Coffre ferré", l: 1, h: 1 },
    { cle: "coffre-ouvert", nom: "Coffre ouvert", l: 1, h: 1 },
    { cle: "sacs", nom: "Sacs", l: 1, h: 1 },
    { cle: "caisses", nom: "Caisses empilées", l: 2, h: 2 },
  ] },
  { groupe: "Passages", liste: [
    { cle: "escalier", nom: "Escalier qui monte", l: 1, h: 2, franchissable: true },
    { cle: "escalier-bas", nom: "Escalier qui descend", l: 1, h: 2, franchissable: true },
    { cle: "colimacon", nom: "Escalier en colimaçon", l: 2, h: 2, franchissable: true },
    { cle: "trappe", nom: "Trappe", l: 1, h: 1, franchissable: true },
    { cle: "echelle", nom: "Échelle", l: 1, h: 1, franchissable: true },
  ] },
  { groupe: "Pour le MJ", liste: [
    { cle: "piege", nom: "Piège", l: 1, h: 1, cache: true, franchissable: true },
    { cle: "tresor", nom: "Trésor", l: 1, h: 1, cache: true, franchissable: true },
  ] },
];
export const MEUBLES = Object.fromEntries(MOBILIER.flatMap((g) => g.liste).map((m) => [m.cle, m]));

// L'habillage d'un plan (plan.habillage, proposé par l'API, dessiné dans le style peint) : les objets d'ambiance que le
// code sait dessiner, leur nom et les genres de pièces où ils ont leur place (voir GENRES_PIECES). « sol » : posé à même
// le sol, sous les pions et le brouillard ; « lumiere » : l'objet éclaire autour de lui. Toute autre clé est ignorée.
export const KITS_HABILLAGE = [
  { cle: "abreuvoir", nom: "Abreuvoir", genres: ["exterieur", "salle"] },
  { cle: "borne", nom: "Borne de pierre", genres: ["exterieur"] },
  { cle: "botte", nom: "Botte de foin", genres: ["salle", "exterieur"] },
  { cle: "bouteille", nom: "Bouteille couchée", genres: ["salle", "grotte"] },
  { cle: "buches", nom: "Bûches", genres: ["salle", "exterieur"] },
  { cle: "chandelle", nom: "Chandelle", genres: ["salle", "grotte"], lumiere: true },
  { cle: "chope", nom: "Chope", genres: ["salle"] },
  { cle: "couvert", nom: "Assiette et couteau", genres: ["salle"] },
  { cle: "crane", nom: "Crâne", genres: ["grotte", "salle"] },
  { cle: "des", nom: "Dés", genres: ["salle"] },
  { cle: "feu-de-camp", nom: "Feu de camp", genres: ["exterieur", "grotte"], lumiere: true },
  { cle: "flaque", nom: "Flaque", genres: ["exterieur", "grotte"], sol: true },
  { cle: "jarre", nom: "Jarre", genres: ["salle", "grotte"] },
  { cle: "lanterne", nom: "Lanterne", genres: ["salle", "exterieur", "grotte"], lumiere: true },
  { cle: "legumes", nom: "Panier de légumes", genres: ["salle"] },
  { cle: "livre", nom: "Livre ouvert", genres: ["salle"] },
  { cle: "marmite", nom: "Marmite", genres: ["salle", "exterieur"] },
  { cle: "ornieres", nom: "Ornières et flaques le long d'un chemin", genres: ["exterieur"], sol: true },
  { cle: "paille", nom: "Paille éparse", genres: ["salle", "exterieur"], sol: true },
  { cle: "pain", nom: "Pains", genres: ["salle"] },
  { cle: "pichet", nom: "Pichet", genres: ["salle"] },
  { cle: "sac", nom: "Sac de grain", genres: ["salle", "exterieur", "grotte"] },
  { cle: "seau", nom: "Seau d'eau", genres: ["salle", "exterieur", "grotte"] },
  { cle: "selle", nom: "Selle", genres: ["salle"] },
  { cle: "table-ronde", nom: "Petite table ronde", genres: ["salle", "exterieur"] },
  { cle: "tabouret", nom: "Tabouret", genres: ["salle", "exterieur"] },
  { cle: "tas-bois", nom: "Tas de bois", genres: ["exterieur", "salle"] },
  { cle: "toile", nom: "Toile d'araignée (dans un coin)", genres: ["salle", "grotte"] },
];

export const COULEURS_PIONS = { heros: "#c29b5c", ennemi: "#b3261e", pnj: "#8a6a34", autre: "#6f8f4a" };

export const nouvelId = () => Math.random().toString(36).slice(2, 9);
export const idx = (p, x, y) => y * p.largeur + x;
export const dedans = (p, x, y) => x >= 0 && y >= 0 && x < p.largeur && y < p.hauteur;

export function nouveauPlan({ nom = "Nouveau plan", largeur = 36, hauteur = 26, m_case = 1.5 } = {}) {
  const n = largeur * hauteur;
  return {
    nom, lieu: "", etage: "", largeur, hauteur, m_case, style: "peint", quadrillage: true, brouillard_actif: true,
    sol: Array(n).fill(0), piece: Array(n).fill(0), brouillard: Array(n).fill(0), brume: Array(n).fill(0), feu: Array(n).fill(0),
    etapes: [], etape: null, pieces: [], portes: [], objets: [], pions: [], textes: [], fond: null, notes: "",
  };
}

export const piece = (p, id) => p.pieces.find((x) => x.id === id) || null;

// Les murs, case par case : bits 1 N, 2 E, 4 S, 8 O pour un mur droit ; 16, 32, 64, 128 pour une paroi de roche.
// Même règle que le serveur (api/tv_plans.py, murs_du_plan) : la TV reçoit les murs tout faits.
export function calculerMurs(p) {
  const { largeur: w, hauteur: h, sol, piece: pc } = p;
  const genres = new Map(p.pieces.map((x) => [x.id, x.genre || "salle"]));
  const g = (i) => genres.get(pc[i]) || "salle";
  const murs = new Uint8Array(w * h);
  const voisins = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!sol[i]) continue;
      const ga = g(i);
      let m = 0;
      for (const [dx, dy, bit] of voisins) {
        const nx = x + dx;
        const ny = y + dy;
        const j = ny * w + nx;
        const vide = nx < 0 || ny < 0 || nx >= w || ny >= h || !sol[j];
        if (vide) {
          if (ga === "salle") m |= bit;
          else if (ga === "grotte") m |= bit << 4;
        } else if (pc[j] !== pc[i] && (ga === "salle" || g(j) === "salle")) m |= bit;
      }
      murs[i] = m;
    }
  }
  return murs;
}

// Une porte est posée sur une arête : « v » à gauche de la case (x, y), « h » au-dessus.
export const cleArete = (sens, x, y) => `${sens}:${x}:${y}`;
export function casesArete(sens, x, y) {
  return sens === "v" ? [[x - 1, y], [x, y]] : [[x, y - 1], [x, y]];
}

// L'arête la plus proche d'un point (en cases), si le point en est assez près.
export function areteProche(px, py, seuil = 0.3) {
  const fx = px - Math.floor(px);
  const fy = py - Math.floor(py);
  const dv = Math.min(fx, 1 - fx);
  const dh = Math.min(fy, 1 - fy);
  if (Math.min(dv, dh) > seuil) return null;
  if (dv <= dh) return { sens: "v", x: Math.round(px), y: Math.floor(py) };
  return { sens: "h", x: Math.floor(px), y: Math.round(py) };
}

// Emprise d'un meuble, rotation comprise.
export function emprise(o) {
  const tourne = (o.rot || 0) % 180 !== 0;
  const l = tourne ? o.h : o.l;
  const h = tourne ? o.l : o.h;
  return { x0: o.x, y0: o.y, x1: o.x + l, y1: o.y + h, l, h };
}

export function reveleA(p, x, y) {
  if (!p.brouillard_actif) return true;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  return dedans(p, cx, cy) && p.brouillard[idx(p, cx, cy)] === 1;
}

// La brume (plan.brume, une valeur par case : 0 rien, 1 voile, 2 épaisse) : un effet que les joueurs voient, à ne pas
// confondre avec le brouillard (les cases cachées). Un plan d'avant la brume n'a pas ce champ : il est sans brume.
export const EPAISSE = 2;

export function brumeA(p, x, y) {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  return Array.isArray(p.brume) && dedans(p, cx, cy) ? p.brume[idx(p, cx, cy)] || 0 : 0;
}

// La brume que montre une vue : pour le MJ, toute celle du plan ; pour les joueurs, celle des seules cases révélées
// (posée sur une zone encore cachée, elle n'en dessine pas la forme). Même règle que le serveur, api/tv_plans.py, plan_public.
export function brumeVue(p, joueurs) {
  const b = p.brume;
  const actif = p.brouillard_actif === undefined || !!p.brouillard_actif;
  if (!joueurs || !actif || !Array.isArray(b)) return b;
  const vu = Array.isArray(p.brouillard) ? p.brouillard : [];
  return b.map((v, i) => (vu[i] === 1 ? v : 0));
}

// Dans la brume épaisse, les joueurs ne voient plus que les héros : un adversaire, un PNJ ou tout autre pion y disparaît
// de la TV (même règle que le serveur, api/tv_plans.py, plan_public).
export const cacheParLaBrume = (p, t) => t.genre !== "heros" && brumeA(p, t.x, t.y) === EPAISSE;

// Le feu (plan.feu, une valeur par case) : un incendie que les joueurs voient, comme la brume. 1 braises (le feu prend),
// 2 flammes, 3 brasier, 4 calciné (éteint, noirci, encore fumant). Il ne brûle que sur un sol. Un plan d'avant le feu
// n'a pas ce champ : rien ne brûle.
export const FEUX = [[1, "Braises"], [2, "Flammes"], [3, "Brasier"], [4, "Calciné"]];
export const CALCINE = 4;

// Le feu que montre une vue : pour le MJ, tout celui du plan ; pour les joueurs, celui des seules cases révélées (même
// règle que le serveur, api/tv_plans.py, plan_public). Toujours une valeur de 0 à 4 par case, 0 hors du sol ; null sans feu.
export function feuVue(p, joueurs) {
  const f = p.feu;
  const n = p.largeur * p.hauteur;
  if (!Array.isArray(f) || f.length !== n) return null;
  const actif = joueurs && (p.brouillard_actif === undefined || !!p.brouillard_actif);
  const vu = Array.isArray(p.brouillard) ? p.brouillard : [];
  const sol = Array.isArray(p.sol) ? p.sol : [];
  let rien = true;
  const res = new Array(n);
  for (let i = 0; i < n; i++) {
    const v = f[i];
    res[i] = v >= 1 && v <= CALCINE && v === Math.floor(v) && sol[i] && (!actif || vu[i] === 1) ? v : 0;
    if (res[i]) rien = false;
  }
  return rien ? null : res;
}

// La lumière que le feu jette sur le plan peint (peint.js) : une lumière par pièce et par carré de trois cases qui
// brûle, posée sur la case qui brûle la plus proche du centre, plus large et plus chaude là où le feu est fort, avec la
// force de son halo. Les cendres ne comptent plus.
export function lumieresDuFeu(p, joueurs) {
  const f = feuVue(p, joueurs);
  if (!f) return [];
  const w = p.largeur;
  const groupes = new Map();
  for (let i = 0; i < f.length; i++) {
    const v = f[i];
    if (v < 1 || v >= CALCINE) continue;
    const x = i % w;
    const y = (i - x) / w;
    const cle = `${p.piece[i]}:${Math.floor(x / 3)}:${Math.floor(y / 3)}`;
    let g = groupes.get(cle);
    if (!g) groupes.set(cle, (g = { cases: [], sx: 0, sy: 0, force: 0 }));
    g.cases.push([x, y]);
    g.sx += x;
    g.sy += y;
    g.force += v;
  }
  const res = [];
  for (const g of groupes.values()) {
    const n = g.cases.length;
    const [mx, my] = [g.sx / n, g.sy / n];
    let [x, y] = g.cases[0];
    for (const [cx, cy] of g.cases) if (Math.hypot(cx - mx, cy - my) < Math.hypot(x - mx, y - my)) [x, y] = [cx, cy];
    const moyenne = g.force / n;
    res.push({
      x: x + 0.5, y: y + 0.5, rayon: Math.min(8, 2.4 + 0.8 * moyenne + 0.3 * n), couleur: moyenne > 2.4 ? "#ff8636" : "#ff9c4c",
      intensite: Math.min(1.5, 0.5 + 0.28 * moyenne), halo: Math.min(2.4, 0.8 + 0.4 * moyenne),
    });
  }
  return res;
}

export function objetVisible(p, o) {
  if (o.cache) return false;
  if (!p.brouillard_actif) return true;
  const b = emprise(o);
  for (let y = Math.floor(b.y0); y < Math.ceil(b.y1); y++) for (let x = Math.floor(b.x0); x < Math.ceil(b.x1); x++) if (reveleA(p, x, y)) return true;
  return false;
}

export function porteVisible(p, d) {
  if (d.genre === "secrete" && !d.decouverte) return false;
  if (!p.brouillard_actif) return true;
  return casesArete(d.sens, d.x, d.y).some(([x, y]) => reveleA(p, x, y));
}

export function boitePiece(p, id) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (let y = 0; y < p.hauteur; y++) {
    for (let x = 0; x < p.largeur; x++) {
      if (p.piece[y * p.largeur + x] !== id || !p.sol[y * p.largeur + x]) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
    }
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

export function boiteRevelee(p) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (let y = 0; y < p.hauteur; y++) {
    for (let x = 0; x < p.largeur; x++) {
      const i = y * p.largeur + x;
      if (!p.sol[i] || (p.brouillard_actif && p.brouillard[i] !== 1)) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
    }
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

// Hachage stable d'une case : les motifs de sol ne bougent pas d'un rendu à l'autre.
export function hache(x, y, s = 0) {
  let t = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
  t = Math.imul(t ^ (t >>> 13), 1274126177);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}
