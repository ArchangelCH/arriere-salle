// Les prétirés de la campagne : des fiches d'aventurier prêtes à jouer, au format du créateur. Leurs histoires et leurs
// « Ne fera jamais » sont des secrets pour un MJ invité : aucun module commun ne les importe d'avance, les pages qui les
// montrent les chargent (import dynamique de aventuriers/kit.js, qui les relaie). Ici, les deux de la campagne d'exemple.
// Leurs pièces d'or se notent en dernière ligne d'équipement (« 45 pièces d'or ») : le créateur les range dans la bourse.

export const PRETIRES = [
 {
  "cle": "pretire-ysane",
  "nom": "Ysane Corbel",
  "genre": "f",
  "niveau": 1,
  "histoire": "Fille de meunier confiée enfant au temple de sa vallée, Ysane a appris à soigner avant d'apprendre à se battre. Le jour où des pillards ont brûlé le village voisin, elle a pris la masse de son maître, et n'est jamais revenue au cloître.",
  "peuple": "Humain",
  "vocations": ["Prêtre", "Combattant"],
  "specialite": "prêtresse guerrière",
  "physique": 60,
  "social": 55,
  "mental": 55,
  "competences": [
   { "nom": "Armes lourdes", "bonus": 20, "avec": "Physique" },
   { "nom": "Bouclier", "bonus": 15, "avec": "Physique" },
   { "nom": "Médecine", "bonus": 15, "avec": "Mental" },
   { "nom": "Présence", "bonus": 10, "avec": "Social" }
  ],
  "sante": 8,
  "psy": 4,
  "dons": [{ "nom": "Mains qui soignent" }, { "nom": "Frappe assurée" }, { "nom": "Égide" }],
  "element": "Lumière",
  "posture": "defensive",
  "themes": ["Foi", "Devoir", "Pardon"],
  "langues": "Commun, elfique",
  "armes": [
   { "nom": "Masse", "competence": "Armes lourdes", "degats": "1D10", "notes": "" },
   { "nom": "Bouclier (parade)", "competence": "Bouclier", "degats": "", "notes": "+2 d'armure en défensive" }
  ],
  "protection": { "nom": "Cotte de mailles", "indice": 3 },
  "bouclier": true,
  "equipement": ["Symbole sacré", "Trousse de soins (5 usages)", "Lettre de son temple", "45 pièces d'or"],
  "jamais": "Laisser un blessé derrière elle, même un ennemi.",
  "defaut": "Elle croit sur parole quiconque prie le même dieu qu'elle.",
  "lien": "Elle a recousu Hadrik après une rixe de taverne, et il ne l'a jamais remerciée.",
  "conseils": [
   "Votre posture défensive vous donne une défense par tour : protégez le plus fragile du groupe.",
   "Mains qui soignent rend 1D6 Santé : gardez 2 Psy pour le moment où quelqu'un tombe.",
   "Égide se paie comme vous voulez : 1 Psy pour un coup léger, plus pour un coup qui tuerait."
  ]
 },
 {
  "cle": "pretire-hadrik",
  "nom": "Hadrik Cendrefer",
  "genre": "h",
  "niveau": 1,
  "histoire": "Hadrik a quitté la forge de son clan avec une hache, un gantelet gravé et une dette de jeu. Depuis, il loue son bras à qui paie, et rêve de rentrer assez riche pour qu'on oublie pourquoi il est parti.",
  "peuple": "Nain",
  "vocations": ["Combattant"],
  "specialite": "mercenaire",
  "physique": 75,
  "social": 40,
  "mental": 55,
  "competences": [
   { "nom": "Armes lourdes", "bonus": 25, "avec": "Physique" },
   { "nom": "Esquive", "bonus": 15, "avec": "Physique" },
   { "nom": "Intimidation", "bonus": 10, "avec": "Social" },
   { "nom": "Perception", "bonus": 10, "avec": "Mental" }
  ],
  "sante": 10,
  "psy": 2,
  "dons": [{ "nom": "Vision dans le noir" }, { "nom": "Gantelet runique" }, { "nom": "Flammèche" }],
  "element": "Feu",
  "posture": "offensive",
  "themes": ["Fortune", "Fierté", "Loyauté"],
  "langues": "Commun, nain",
  "armes": [
   { "nom": "Hache", "competence": "Armes lourdes", "degats": "1D10", "notes": "" },
   { "nom": "Gantelet runique", "competence": "Pugilat", "degats": "1D8", "notes": "don de nain" }
  ],
  "protection": { "nom": "Armure de cuir", "indice": 2 },
  "bouclier": false,
  "equipement": ["Pierre à aiguiser", "Une chope d'étain gravée à son nom", "30 pièces d'or"],
  "jamais": "Rompre un contrat signé, même avec un menteur.",
  "defaut": "Il compte tout à voix haute, l'or comme les ennemis.",
  "lien": "Il doit la vie à Ysane, et refuse de l'avouer.",
  "conseils": [
   "En posture offensive, votre hache frappe toujours au maximum : 10. Mais vous ne pouvez ni esquiver ni parer.",
   "Vision dans le noir : dans une mine ou une crypte, c'est vous qui passez devant.",
   "Votre Psy est maigre : gardez-la pour Flammèche, au moment où un coup de plus fait tomber l'ennemi."
  ]
 }
];

// Les prétirés dont part la balance des combats quand la tablée est vide.
export const GROUPE_DE_DEPART = ["pretire-ysane", "pretire-hadrik"];
