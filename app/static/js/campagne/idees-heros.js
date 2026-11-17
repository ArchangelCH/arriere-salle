// Des idées à tirer au sort quand un joueur sèche, écrites « {masculin|féminin} » et accordées à son aventurier
// (aventuriers/tables.js). Ici, celles de la campagne d'exemple : une fantasy de routes, de fleuves et de temples.

export const AVANT = [
  "{Garde|Garde} de convoi sur les routes marchandes, pendant des années.",
  "{Apprenti|Apprentie} d'un alchimiste, {chassé|chassée} après un incendie dont on {l'a cru|l'a crue} coupable.",
  "{Novice|Novice} dans un temple de montagne, {parti|partie} avant de prononcer ses vœux.",
  "{Mineur|Mineuse} dans une mine d'argent, jusqu'à l'éboulement.",
  "{Passeur|Passeuse} sur le grand fleuve, avec une barque et des dettes.",
  "{Fils|Fille} d'aubergiste, {élevé|élevée} entre les tonneaux et les voyageurs.",
  "{Scribe|Scribe} chez un notaire de ville, à lire les secrets de tout le quartier.",
  "{Acrobate|Acrobate} dans une troupe de foire, jusqu'à la chute.",
  "{Berger|Bergère} dans les hautes vallées, {seul|seule} avec les loups et les étoiles.",
  "{Soldat|Soldate} d'une guerre que plus personne ne raconte, {rentré|rentrée} sans un mot.",
];

export const POURQUOI = [
  "Pour rembourser une dette avant que les créanciers ne frappent à la porte.",
  "Pour retrouver un frère parti un matin et jamais revenu.",
  "Pour laver son nom d'un crime {qu'il|qu'elle} n'a pas commis.",
  "Parce qu'une vieille carte a changé de main, et qu'elle est maintenant dans la sienne.",
  "Pour la gloire, et pour qu'on chante son nom dans les tavernes.",
  "Pour échapper à un mariage arrangé.",
  "Parce que la vie au village l'ennuyait à mourir.",
  "Pour comprendre un rêve qui revient chaque nuit.",
];

export const JAMAIS = [
  "Laisser un compagnon derrière {lui|elle}, quoi qu'il en coûte.",
  "Frapper quelqu'un qui ne peut pas se défendre.",
  "Revenir sur une parole donnée.",
  "Voler plus pauvre que soi.",
  "Tuer un ennemi qui s'est rendu.",
  "Mentir à un ami.",
  "Boire une goutte d'alcool.",
  "Laisser brûler un livre.",
];

export const ALLURES = [
  "Une cicatrice en étoile sur le front, cachée sous une mèche.",
  "Toujours un brin de paille entre les dents.",
  "Des cheveux tressés de perles de bois.",
  "Un sourire immense et des dents de travers.",
  "{Petit|Petite} et {râblé|râblée}, une démarche de marin.",
  "Des yeux très clairs qui ne cillent presque jamais.",
  "Un vieux chapeau à large bord, jamais quitté.",
  "Une voix grave, étonnante pour sa taille.",
];

export const DEFAUTS = [
  "{Il|Elle} parle {seul|seule} quand {il|elle} réfléchit.",
  "{Il|Elle} ne supporte pas qu'on touche à ses affaires.",
  "{Il|Elle} se vante, même quand personne n'écoute.",
  "{Il|Elle} a peur du noir, et refuse de l'avouer.",
  "{Il|Elle} ronfle comme une forge.",
  "{Il|Elle} oublie les noms, jamais les visages.",
  "{Il|Elle} ne sait pas refuser un pari.",
  "Sa main tremble quand {il|elle} est {fatigué|fatiguée}.",
];

// {Il|Elle} s'accorde à l'aventurier, [rencontrés|rencontrées] aux deux (au féminin seulement si ce sont deux femmes) ;
// {autre} est le prénom de l'autre, ou « un autre aventurier » tant qu'il n'est pas choisi.
export const LIENS = [
  "{Il|Elle} a sauvé la vie de {autre}, qui ne le lui pardonne pas.",
  "{autre} lui doit de l'argent, et fait semblant de l'oublier.",
  "{Il|Elle} et {autre} ont grandi dans la même rue.",
  "{Il|Elle} et {autre} se sont [rencontrés|rencontrées] en prison.",
  "{autre} connaît son vrai nom.",
  "{Il|Elle} a promis de veiller sur {autre}, sans lui dire pourquoi.",
];

// D'où viennent les noms des aventuriers : les origines des tables des PNJ (pnj/tables.js). Un peuple qui a ses noms
// (clé : son nom simplifié) ; les autres viennent d'une région, tirée dans cette liste (une région deux fois pèse double).
// Ici, aucune région nommée : une origine des tables des PNJ qui n'est celle d'aucun peuple.
export const NOMS_PAR_PEUPLE = {
  peuples: { nain: "nain", elfe: "elfe" },
  regions: [],
};
