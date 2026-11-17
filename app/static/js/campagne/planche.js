// Les tables de la planche de l'auberge (auberge/tables.js) : les contrats tirés au sort (le problème, le contact, la
// mention griffonnée, ce qui se cache derrière), la récompense rare, et les rumeurs de comptoir maison, sans lien avec
// les fils (celles du kit : campagne/auberge.js). Servi au MJ invité avec auberge/tables.js : rien du kit ici.

// [titre de l'affiche, son texte, sa difficulté : une clé de DANGERS (auberge/tables.js)]
export const PROBLEMES = [
  ["Loups au col", "Des loups dans les bergeries du col. Trois brebis en deux nuits.", "facile"],
  ["Caravane perdue", "Caravane de laine attendue depuis cinq jours. La retrouver, ou ce qu'il en reste.", "normal"],
  ["La cloche du prieuré", "Des gobelins ont volé la cloche du prieuré. La rapporter, entière si possible.", "facile"],
  ["Tombe ouverte", "Une tombe a été ouverte au cimetière de Valombre. Trouver qui, et pourquoi.", "normal"],
  ["La tour de guet", "Nettoyer la tour de guet abandonnée avant l'hiver.", "normal"],
  ["Le pont emporté", "La crue a emporté le pont. Protéger les ouvriers qui le rebâtissent.", "facile"],
  ["La bête du marais", "Une bête tue le bétail la nuit et ne laisse que des traces de griffes.", "difficile"],
  ["Le phare éteint", "Le phare de Salant ne s'allume plus et le gardien a disparu.", "normal"],
  ["L'entrepôt", "Garder un entrepôt trois nuits. Ne pas ouvrir les caisses.", "normal"],
  ["La mine effondrée", "Des mineurs nains sont bloqués sous l'éboulement. Quelque chose gratte de l'autre côté.", "difficile"],
];

export const CONTACTS = [
  "Voir le sergent du guet, à la porte de Valombre.",
  "S'adresser au prieur, au prieuré de la vallée.",
  "Demander maître Coudray, marchand de laine, à l'auberge.",
  "Laisser un mot à Berthe, au comptoir.",
  "Voir la gardienne du port de Salant.",
  "Se présenter à la forge Barbe-de-Fer.",
];

export const MENTIONS = [
  "Déjà deux équipes parties.",
  "Il ment.",
  "Moitié d'avance, pas plus.",
  "Allez-y de jour.",
  "Ils sont plus de deux.",
  "Trop tard.",
];

export const TOURNURES = [
  "Le commanditaire est lui-même le coupable.",
  "C'est une diversion : l'essentiel se passe ailleurs pendant que les aventuriers sont occupés.",
  "Un autre groupe d'aventuriers a pris le même contrat.",
  "La cible a de bonnes raisons, et les donnera si on l'écoute.",
  "La récompense n'existe pas : le commanditaire est ruiné.",
  "L'affaire touche un fil de la campagne, à choisir.",
  "Tout est vrai, rien n'est caché : parfois, un loup n'est qu'un loup.",
];

// Une fois sur huit environ, la récompense n'est pas en pièces d'or.
export const RECOMPENSE_RARE = { part: 0.12, texte: "Un collier d'ambre, à partager." };

export const RUMEURS_MAISON = [
  { texte: "Le vieux pont du col ne tiendra pas l'hiver. Le bailli dit que si.", source: "un charretier" },
  { texte: "Une pierre est tombée du ciel dans un champ. Le fermier la garde sous son lit.", source: "un colporteur" },
  { texte: "Il y a un trésor sous l'auberge du Gué. Berthe le sait et fait semblant.", source: "un habitué qui a trop bu" },
  { texte: "Un dragon dort sous les montagnes du nord. Il ronfle quand le vent vient du bon côté.", source: "un vieux berger" },
  { texte: "On a vu une elfe à la foire de Salant. Une vraie.", source: "une marchande de poisson" },
  { texte: "Le puits du prieuré murmure, la nuit. Les moines ont interdit d'en parler.", source: "un pèlerin" },
  { texte: "Les ménestrels paient pour les histoires vraies. Encore mieux pour les fausses.", source: "la serveuse" },
  { texte: "Un aventurier est revenu riche des fjords. Personne ne sait ce qu'il a trouvé.", source: "un palefrenier" },
];
