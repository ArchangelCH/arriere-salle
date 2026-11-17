// Le bestiaire de la campagne : créatures et gens, chacun d'un rang de combat. Ce que la simulation sait jouer est codé
// (régénération, attaques multiples, meute…) ; le reste est rappelé au MJ dans « capacites ». Les rangs eux-mêmes, et la
// lecture d'un PNJ du carnet, sont des règles : combats/bestiaire.js. Ici, une fantasy sans nom ; les clés (« cle ») sont
// celles que lisent les familles de rencontres du Tableau (tableau/tirages.js) et les pions déjà posés (bestiaire:<cle>).

export const CREATURES = [
  { cle: "jeune-araignee", nom: "Jeune araignée", rang: "sbire", att: 45, degats: "1D6", armure: 0, sante: "5", defense: 0, nbDef: 0, capacites: "Grimpeuse. Venin : sur une réussite critique, carton jaune en Physique." },
  { cle: "araignee-geante", nom: "Araignée géante", rang: "soldat", att: 55, degats: "1D8", armure: 1, sante: "10", defense: 0, nbDef: 0, capacites: "Venin (01 à 10 : carton jaune en Physique). Toile : englue au lieu d'attaquer. Peur du feu." },
  { cle: "reine-araignee", nom: "Reine araignée", rang: "boss", att: 70, degats: "2D6", armure: 2, sante: "8 × PJ", defense: 50, nbDef: 1, attaques: 2, capacites: "Ponte : au lieu d'une attaque, 1D3 jeunes araignées (non simulée). Toile en nappe. Venin. Le feu lui fait +2." },
  { cle: "loup", nom: "Loup", rang: "soldat", att: 55, degats: "1D6", armure: 0, sante: "8", defense: 0, nbDef: 0, meute: true, capacites: "Meute : +10 % par autre loup (au plus +20). Fuite si le chef tombe." },
  { cle: "loup-druidique", nom: "Loup druidique", rang: "elite", att: 65, degats: "1D10", armure: 1, sante: "16", defense: 50, nbDef: 1, capacites: "Fondu dans les bois : Perception −20 pour le suivre." },
  { cle: "gobelin", nom: "Gobelin", rang: "sbire", att: 45, degats: "1D6", armure: 0, sante: "4", defense: 0, nbDef: 0, capacites: "Pièges : 1D6, test de Perception pour les voir." },
  { cle: "orc", nom: "Orc", rang: "soldat", att: 55, degats: "1D10", armure: 2, sante: "12", defense: 0, nbDef: 0, capacites: "Haine des nains : +10 % contre un nain, qu'il choisit en premier." },
  { cle: "ogre", nom: "Ogre", rang: "elite", att: 65, degats: "2D6", armure: 2, sante: "22", defense: 0, nbDef: 0, capacites: "Terreur : Mental ou carton jaune en Mental. Talon d'Achille." },
  { cle: "troll", nom: "Troll", rang: "boss", att: 70, degats: "2D6", armure: 3, sante: "8 × PJ", defense: 50, nbDef: 1, attaques: 2, regen: 3, capacites: "Régénération : +3 Santé par tour, sauf s'il a été brûlé (simulée sans feu). Lancer." },
  { cle: "gargouille", nom: "Gargouille", rang: "elite", att: 65, degats: "1D10", armure: 4, sante: "14", defense: 50, nbDef: 1, capacites: "Statue : Perception −20 pour la repérer. Vol : +2 dégâts au premier coup." },
  { cle: "armure-enchantee", nom: "Armure enchantée", rang: "soldat", att: 55, degats: "1D10", armure: 4, sante: "10", defense: 0, nbDef: 0, sansPeur: true, capacites: "Sans chair : ni poison, ni peur, ni carton. La rune qui l'anime : qui la vise ignore l'armure." },
  { cle: "golem", nom: "Golem", rang: "boss", att: 70, degats: "2D6", armure: 4, sante: "8 × PJ", defense: 0, nbDef: 0, attaques: 2, lent: true, capacites: "Lent : agit après tous les aventuriers. Une rune au front : l'effacer l'arrête." },
  { cle: "elementaire-mineur", nom: "Élémentaire mineur", rang: "elite", att: 65, degats: "1D10", armure: 2, sante: "16", defense: 50, nbDef: 1, ignoreArmure: true, capacites: "Ses coups ignorent l'armure ordinaire. Insensible à son élément. Effet selon l'élément." },
  { cle: "squelette", nom: "Squelette", rang: "sbire", att: 45, degats: "1D6", armure: 1, sante: "5", defense: 0, nbDef: 0, sansPeur: true, capacites: "Insensible à la magie : il faut des armes. Sans peur : ne fuit jamais." },
  { cle: "zombie", nom: "Zombie", rang: "sbire", att: 40, degats: "1D6", armure: 0, sante: "8", defense: 0, nbDef: 0, sansPeur: true, capacites: "Morsure : carton jaune en Physique. Lent : on le fuit sans test. Sans peur : ne fuit jamais." },
  { cle: "succube", nom: "Succube", rang: "elite", att: 65, degats: "1D8", armure: 1, sante: "16", defense: 50, nbDef: 1, capacites: "Charme : Mental opposé, la cible la protège un tour. Ailes." },
  { cle: "dragon", nom: "Dragon", rang: "dragon", att: 80, degats: "3D6", armure: 5, sante: "100", defense: 60, nbDef: 2, attaques: 3, souffle: "4D6", capacites: "Souffle : tous les trois tours, 4D6 à tous, armure ignorée. On ne le combat pas : on le fuit, on le trompe, on négocie." },
];

export const GENS = [
  { cle: "billy", nom: "Villageois", rang: "sbire", att: 35, degats: "1D4", armure: 0, sante: "5", defense: 0, nbDef: 0, capacites: "Se bat mal, fuit vite, et appelle à l'aide." },
  { cle: "brigand", nom: "Brigand", rang: "sbire", att: 45, degats: "1D6", armure: 1, sante: "5", defense: 0, nbDef: 0, capacites: "Racket : il menace plutôt que de se battre, et fuit dès que ça tourne mal." },
  { cle: "garde", nom: "Garde, mercenaire, pirate", rang: "soldat", att: 55, degats: "1D8", armure: 2, sante: "10", defense: 0, nbDef: 0, capacites: "En renfort : un garde qui siffle fait venir 1D4 collègues en deux tours." },
  { cle: "arbaletrier", nom: "Arbalétrier", rang: "soldat", att: 55, degats: "1D10", armure: 1, sante: "10", defense: 0, nbDef: 0, recharge: true, capacites: "Recharger : tire un tour sur deux." },
  { cle: "chef-mercenaire", nom: "Chef mercenaire", rang: "elite", att: 65, degats: "1D10", armure: 3, sante: "16", defense: 50, nbDef: 1, capacites: "Ordres : tant qu'il est debout, ses hommes ne fuient pas et ont +10 % (non simulé). On peut l'acheter." },
  { cle: "paladin", nom: "Paladin", rang: "elite", att: 65, degats: "1D10", armure: 5, bouclier: 2, sante: "16", defense: 60, nbDef: 2, capacites: "Posture défensive : deux défenses, bouclier compté. Soigne 1D6 Santé une fois par combat." },
  { cle: "inquisiteur", nom: "Inquisiteur", rang: "elite", att: 70, degats: "1D10", armure: 5, sante: "18", defense: 60, nbDef: 1, jugement: 10, capacites: "Jugement : une fois par combat, +10 aux dégâts d'un coup. Sent la magie." },
  { cle: "mage-tour", nom: "Mage de guerre", rang: "elite", att: 70, degats: "1D6+1", armure: 0, sante: "12", defense: 40, nbDef: 1, ignoreArmure: true, capacites: "Ses sorts ignorent l'armure ordinaire. Trois dons de son élément, 10 Psy." },
  { cle: "assassin", nom: "Assassin", rang: "elite", att: 70, degats: "1D6", armure: 1, sante: "14", defense: 70, nbDef: 1, capacites: "Coup en traître : sur une cible surprise, dégâts maximum, armure ignorée. Disparaître." },
];

// Les titres de ces deux listes dans le menu « Ajouter un adversaire » de la balance.
export const TITRES_BESTIAIRE = { creatures: "Créatures du bestiaire", gens: "Gens du pays" };
