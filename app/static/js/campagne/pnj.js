// Les PNJ du kit (pnj/kit.js les importe) : les figures de la campagne d'exemple, autour de l'auberge du Gué, à
// l'entrée de la vallée de Valombre. Le champ lieu donne le repère de la fiche du lieu, qui survit à un renommage ou à
// une carte recréée ; un repère qu'aucun lieu ne porte laisse le PNJ sans lieu. Des secrets du kit : chargé à la
// demande, chez le MJ principal seulement ; jamais servi au coin, à la TV ni au MJ invité.

export const PNJ_DU_KIT = [
  {
    repere: "berthe", genre: "f", nom: "Berthe Gaudemar", role: "Aubergiste, ancienne mercenaire", peuple: "Humaine", age: "d'âge mûr",
    apparence: "Une femme large d'épaules, une balafre au front, qui tient le comptoir comme on tient une ligne de piquiers.",
    voix: "Sèche, juste, jamais pressée. « Ici, on paie d'avance et on se bat dehors. »",
    envie: "Que l'auberge tienne encore vingt ans, et que les jeunes qui en partent y reviennent.",
    secret: "Le vrai nom de l'auberge est celui de sa vieille compagnie de mercenaires, dissoute après une trahison. Elle attend toujours le traître.",
    offre: "Des contrats, un lit, un conseil, et parfois sa hallebarde.",
    faction: "Ancienne de la compagnie de la Lanterne", lieu: "auberge-du-gue",
    notes: "Elle a été capitaine : elle juge un groupe à la façon dont il entre.",
    rang: "heros", profil: { physique: 65, social: 55, mental: 55, sante: 16, psy: 5 },
    capacites: "Hallebarde (1D10), cuirasse 3. Posture défensive. Elle ne part plus à l'aventure.",
    connu: true, etiquette: "maison", attitude: "amical",
  },
  {
    repere: "odon", genre: "h", nom: "Odon", surnom: "le Petit", role: "Garçon de salle de l'auberge du Gué", peuple: "Humain", age: "jeune",
    apparence: "Maigre, rapide, une oreille toujours tournée vers la salle.",
    voix: "Pousse les inconnus vers la même table : « Vous regardez tous la même affiche. Ça s'appelle une compagnie. »",
    envie: "Partir un jour avec une compagnie d'aventuriers.", secret: "Il revend aux colporteurs ce qu'il entend en servant.",
    offre: "Une rumeur fraîche contre une pièce.", lieu: "auberge-du-gue", rang: "civil", connu: true, etiquette: "maison", attitude: "amical",
  },
  {
    repere: "heloise", genre: "f", nom: "Héloïse de Vaugris", role: "Prévôte de Valombre", peuple: "Humaine", age: "adulte",
    envie: "Une vallée en ordre, des routes sûres, et des impôts payés.", offre: "Des permis, des primes, et des ennemis.",
    secret: "Elle sait qui a trahi la compagnie de Berthe : c'est son propre père qui a payé le traître.",
    faction: "La prévôté de Valombre", lieu: "valombre", rang: "notable", profil: { escorte: "4 gardes de la prévôté" },
    connu: true, etiquette: "maison", attitude: "neutre",
  },
];
