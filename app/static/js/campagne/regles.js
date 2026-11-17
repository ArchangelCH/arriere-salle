// Le monde de la campagne vu par les règles des aventuriers : peuples, vocations, éléments, thèmes, langues, ce que les
// dons arment ou illustrent, et le guide de création (son exemple suivi d'étape en étape, les phrases du créateur qui
// parlent du monde). Données seules : la mécanique reste dans aventuriers/regles.js, qui les importe.
// Ici, la campagne d'exemple : une fantasy sans nom, de quoi faire tourner chaque écran. Une campagne à soi remplace ce
// fichier par le sien (docs/campagne.md), avec les mêmes exports.

export const PEUPLES = [
  { nom: "Humain", f: "Humaine", texte: "Le peuple le plus nombreux, des grandes villes aux hameaux perdus." },
  { nom: "Nain", f: "Naine", texte: "Forgeron et mineur, têtu, fidèle à son clan et à sa parole.", dons: "Nain" },
  { nom: "Elfe", f: "Elfe", texte: "Vit plusieurs siècles, se souvient de tout, parle peu.", dons: "Elfe" },
  { nom: "Halfelin", f: "Halfeline", texte: "Petit, vif et gourmand, plus courageux qu'il n'y paraît." },
  { nom: "Orc", f: "Orc", texte: "Fort et fier, souvent craint, rarement compris." },
  { nom: "Marqué", f: "Marquée", texte: "Né avec la marque d'un élément, qui lui obéit parfois. On le craint et on le chasse : il se cache.", dons: "Marqué" },
  { nom: "Changelin", f: "Changeline", texte: "Échangé au berceau par les fées, il passe pour humain et doit le rester." },
];

// Ce qu'un peuple a de particulier pour l'atelier, par nom : secret (gardé caché d'office, la TV ne l'affiche pas),
// element (son titre dit son élément : « Marquée de l'air »), conseil (sa phrase de « Pour bien jouer »).
export const TRAITS_PEUPLES = {
  "Marqué": { secret: true, element: true, conseil: "On craint ceux que marque un élément : ce que vous êtes doit rester caché." },
  "Changelin": { secret: true, conseil: "Un changelin démasqué perd son foyer : ce que vous êtes doit rester caché." },
};

// source : d'où vient la vocation (ici, le livret de la campagne d'exemple). bourse : 2 pour une bourse de départ doublée.
export const VOCATIONS = [
  {
    nom: "Combattant", f: "Combattante", exemples: "soldat, mercenaire, garde, duelliste", source: "livret",
    competences: ["Lames", "Armes lourdes", "Armes d'hast", "Bouclier", "Esquive", "Athlétisme"],
    equipement: "Une arme principale et une de secours, cotte de mailles (3) et bouclier.",
    kit: { armes: ["Épée", "Dague"], protection: "Cotte de mailles", bouclier: true, objets: [] },
  },
  {
    nom: "Prêtre", f: "Prêtresse", exemples: "prêtre de village, moine, templier", source: "livret",
    competences: ["Présence", "Médecine", "Concentration", "Érudition", "Armes lourdes", "Bouclier"],
    equipement: "Symbole sacré, masse, cuir souple (1), trousse de soins.",
    kit: { armes: ["Masse"], protection: "Cuir souple", objets: ["Symbole sacré", "Trousse de soins (5 usages)"] },
  },
  {
    nom: "Érudit", f: "Érudite", exemples: "mage, sage, alchimiste", source: "livret",
    competences: ["Érudition", "Concentration", "Alchimie", "Langues anciennes", "Bâton"],
    equipement: "Bâton, grimoire, encre et plumes, robe.",
    kit: { armes: ["Bâton"], protection: "Vêtements épais", objets: ["Grimoire", "Encre et plumes"] },
  },
  {
    nom: "Politicien", f: "Politicienne", exemples: "marchand, héraut, petit noble", source: "livret",
    competences: ["Négociation", "Baratin", "Psychologie", "Étiquette", "Présence"],
    equipement: "Beaux habits, sceau de sa maison, dague, bourse doublée.",
    kit: { armes: ["Dague"], protection: "Vêtements épais", objets: ["Beaux habits", "Sceau de sa maison"] },
    bourse: 2,
  },
  {
    nom: "Rôdeur", f: "Rôdeuse", exemples: "chasseur, guide, éclaireur", source: "livret",
    competences: ["Vie en nature", "Pistage", "Armes de tir", "Discrétion", "Perception"],
    equipement: "Arc long, couteau, cuir souple (1), matériel de camp.",
    kit: { armes: ["Arc long", "Couteau"], protection: "Cuir souple", objets: ["Matériel de camp"] },
  },
  {
    nom: "Roublard", f: "Roublarde", exemples: "voleur, espion, contrebandier", source: "livret",
    competences: ["Discrétion", "Escamotage", "Crochetage", "Baratin", "Lames"],
    equipement: "Deux dagues, outils de crochetage, cape sombre, cuir souple (1).",
    kit: { armes: ["Deux dagues"], protection: "Cuir souple", objets: ["Outils de crochetage", "Cape sombre"] },
  },
];

// L'aide des compétences que la campagne colore à sa façon (par nom de compétence) ; les autres gardent celle des règles.
export const AIDES_COMPETENCES = {
  "Langues anciennes": "runes naines, inscriptions elfiques, textes oubliés.",
};

// Teintes du médaillon (clair, milieu, sombre) et liste de dons de l'élément. embleme, facultatif : l'emblème d'un autre
// élément à dessiner (aventuriers/embleme.js connaît Lumière, Feu, Eau, Air, Terre, Métal, Ténèbres, Son, Nature, Sang
// et Temps).
export const ELEMENTS = [
  { nom: "Lumière", de: "de la lumière", liste: "Lumière", teintes: ["#fbe7a8", "#b88a2e", "#3e2a0c"] },
  { nom: "Ténèbres", de: "des ténèbres", liste: "Ténèbres", teintes: ["#b3b8c9", "#353b4f", "#0a0c13"] },
  { nom: "Feu", de: "du feu", liste: "Feu", teintes: ["#ffd08a", "#c0391b", "#2e0905"] },
  { nom: "Eau", de: "de l'eau", liste: "Eau", teintes: ["#d9eef9", "#3f7297", "#0d2231"] },
  { nom: "Air", de: "de l'air", liste: "Air", teintes: ["#eef6fb", "#7ea6c4", "#1e3344"] },
  { nom: "Terre", de: "de la terre", liste: "Terre", teintes: ["#ecd9b8", "#8a6a3c", "#2a1d0e"] },
];

export const THEMES = ["Vengeance", "Justice", "Rédemption", "Foi", "Honneur", "Loyauté", "Liberté", "Gloire", "Fortune", "Savoir",
  "Curiosité", "Famille", "Amitié", "Amour", "Devoir", "Pouvoir", "Ambition", "Survie", "Héritage", "Aventure", "Voyage",
  "Secret", "Courage", "Pardon"];

// Les armes que donne un don de la campagne : elles se rangent entre les armes de contact et celles de tir.
export const ARMES_DE_DONS = [
  { nom: "Gantelet runique", degats: "1D8", competence: "Pugilat", notes: "don de nain" },
];

export const LANGUES = ["elfique", "nain", "halfelin", "orc", "argot des voleurs"];

// Les dons du livret à chaque prix du barème (0, 1, 2, 3, 4 et +, X), dans l'ordre du barème.
export const EXEMPLES_BAREME = [
  "Ami des bêtes, Gantelet runique",
  "Langue d'argent, Vision dans le noir",
  "Mains qui soignent, Cuirasse de roche",
  "Rideau de pluie, Manteau d'ombre",
  "Mur de pierre",
  "Égide",
];

// La posture élémentaire (niveau 4), par élément : ce que devient l'aventurier le temps d'un combat.
export const POSTURES_ELEM = {
  Lumière: "Un halo l'entoure : ses alliés proches voient clair et ne connaissent plus la peur.",
  Ténèbres: "Il se fond dans l'ombre et passe d'une ombre à l'autre.",
  Feu: "Des flammes courent sur sa peau : qui le frappe au contact se brûle.",
  Eau: "Une armure d'eau vive l'enveloppe et détourne les flèches.",
  Air: "Le vent le porte : il bondit, plane et retombe sans se blesser.",
  Terre: "Sa peau devient roche, et le sol tremble sous ses pas.",
};

// Le guide de création : l'aventurier d'exemple et ses dix étapes, les peuples qu'il cite, et les phrases du créateur
// qui parlent du monde (indices des champs, aides).
export const GUIDE = {
  exemple: "Garin Lebrun",
  exemples: [
    "Garin était passeur sur le grand fleuve, jusqu'au soir où un noyé qu'il avait repêché lui a confié une carte avant de mourir. Il veut savoir où elle mène. Il ne laissera jamais quelqu'un se noyer.",
    "Garin est humain. Le MJ ne lui accorde rien de spécial.",
    "Rôdeur (passeur) et Politicien (marchand).",
    "Physique 60, Social 55, Mental 55. Total : 170.",
    "Vie en nature +20 avec le Mental : 75 %. Négociation +15 avec le Social : 70 %. Armes de tir +15 avec le Physique : 75 %. Perception +10 avec le Mental : 65 %. Total des bonus : 60.",
    "Santé 9, Psy 3. Garin est solide : il encaisse, mais ses dons seront rares.",
    "Psy 3, donc 3 dons : Ami des bêtes (Rôdeur), Langue d'argent (Politicien), Rideau de pluie (Eau).",
    "Élément Eau : patient et changeant. Posture défensive : il protège les autres. Thèmes : Curiosité, Loyauté, Fortune.",
    "Arc long (Armes de tir 75 %, 1D8), couteau, cuir souple (armure 1), une barque, la carte du noyé, 120 pièces d'or. Commun et elfique.",
    "Large d'épaules, la peau tannée, une corde toujours enroulée au bras. Il parle aux rivières comme à des personnes. Lien : il soupçonne Ysane de savoir d'où vient la carte.",
  ],
  peuples: "Humain, nain, elfe, halfelin, orc, ou un autre : la liste n'en donne que quelques exemples, et vous pouvez en inventer avec le MJ.",
  pretires: "Les deux aventuriers prêts à jouer du kit",
  des: "Chaque joueur a la couleur de ses dés",
  avant: "passeur sur le fleuve, apprentie d'un mage, novice d'un temple…",
  jamais: "abandonner un compagnon, trahir sa parole…",
  idees: "Le dé propose une idée au hasard : gardez-la, changez-la, ou relancez.",
  peupleSecret: "Les marqués et les changelins se cachent : pour eux, la case se coche d'elle-même. Décochez-la si toute la table peut le savoir.",
  elements: "Même un guerrier sans magie a un élément : il colore son caractère. Chacun a sa liste de dons ; pour un élément inventé, on crée les dons avec le MJ.",
  themes: "Par exemple : Curiosité, Loyauté, Fortune pour un passeur qui suit une carte de noyé.",
  lien: "il soupçonne Ysane de savoir d'où vient la carte",
  secret: "Il est marqué par l'eau et ne l'a dit à personne ; il fuit un ancien maître…",
};
