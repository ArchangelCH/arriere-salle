// Les dons du livret de la campagne : des règles, sans secret, lues partout (créateur, fiches, TV, coin). Chaque don
// appartient à une liste, celle d'un peuple, d'une vocation ou d'un élément (campagne/regles.js) ; « heros », facultatif,
// nomme le personnage qui l'a rendu célèbre. Ici, ceux de la campagne d'exemple, inventés pour elle.

export const DONS = [
 { "nom": "Vision dans le noir", "cout": "1", "effet": "Voit sans lumière jusqu'à la fin de la scène.", "liste": "Nain" },
 { "nom": "Gantelet runique", "cout": "0", "effet": "Un gantelet gravé de runes, qu'il ne perd jamais : il frappe à 1D8 avec Pugilat.", "liste": "Nain" },
 { "nom": "Mémoire des anciens", "cout": "1", "effet": "Une question au MJ sur l'histoire d'un lieu ou d'un objet : il y répond franchement.", "liste": "Elfe" },
 { "nom": "Souffle de l'élément", "cout": "2", "effet": "Une gerbe de son élément frappe une cible à 10 m (test de Mental) : 1D6 dégâts.", "liste": "Marqué" },
 { "nom": "Frappe assurée", "cout": "1", "effet": "Son prochain coup de la scène fait +2 dégâts.", "liste": "Combattant" },
 { "nom": "Mains qui soignent", "cout": "2", "effet": "Rend 1D6 Santé à un blessé au contact.", "liste": "Prêtre" },
 { "nom": "Lecture des runes", "cout": "1", "effet": "Déchiffre une inscription ou un sort écrit, même dans une langue oubliée.", "liste": "Érudit" },
 { "nom": "Langue d'argent", "cout": "1", "effet": "+20 % à son prochain test de Social pour convaincre ou marchander.", "liste": "Politicien" },
 { "nom": "Ami des bêtes", "cout": "0", "effet": "Un animal fidèle (chien, faucon ou renard) le suit et lui obéit : il flaire, guette et prévient.", "liste": "Rôdeur" },
 { "nom": "Ombre parmi les ombres", "cout": "1", "effet": "Pendant une scène, +20 % en Discrétion, et personne ne l'entend marcher.", "liste": "Roublard" },
 { "nom": "Égide", "cout": "X", "effet": "Un bouclier de lumière : +X d'armure pour lui ou un allié au contact, jusqu'à son prochain tour.", "liste": "Lumière" },
 { "nom": "Manteau d'ombre", "cout": "3", "effet": "Une nuit épaisse de 5 m autour de lui pendant un tour : personne n'y voit, sauf lui.", "liste": "Ténèbres" },
 { "nom": "Flammèche", "cout": "1", "effet": "Une flamme au bout des doigts : elle allume, éclaire, ou ajoute +2 dégâts à un coup.", "liste": "Feu" },
 { "nom": "Rideau de pluie", "cout": "3", "effet": "Une pluie drue sur 10 m pendant une scène : on n'y voit plus à deux pas, les flammes s'éteignent.", "liste": "Eau" },
 { "nom": "Pas du vent", "cout": "2", "effet": "Pendant une scène, il saute trois fois plus loin et tombe de haut sans se blesser.", "liste": "Air" },
 { "nom": "Cuirasse de roche", "cout": "2", "effet": "+2 d'armure jusqu'à la fin du combat.", "liste": "Terre" },
 { "nom": "Mur de pierre", "cout": "4", "effet": "Un mur de pierre de 5 m sur 2 jaillit du sol et tient jusqu'à la fin de la scène.", "liste": "Terre" },
];
