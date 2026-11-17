// La campagne du kit, prête à jouer (auberge/kit.js l'installe). Campagne d'exemple : l'auberge du Gué, à l'entrée de
// la vallée de Valombre, sa planche, ses rumeurs, deux fils découpés en étapes et deux habitués. Des secrets du kit :
// chargé à la demande, chez le MJ principal seulement ; jamais servi au coin, à la TV ni au MJ invité.

// L'auberge du kit, repérée par sa clé (le repère de sa fiche de lieu) ou par son nom (des débuts de nom, sans
// majuscules), et le nom que les joueurs ne connaissent pas encore : la page de l'auberge le montre en titre au MJ.
// Pour les joueurs, c'est « l'auberge du Gué ».
export const NOM_CACHE_DE_L_AUBERGE = "La Lanterne Sourde";
export const REPERE_DE_L_AUBERGE = "auberge-du-gue";
export const NOMS_DE_L_AUBERGE = ["lanterne sourde", "auberge du gu"];

// Le comptoir de l'auberge du kit : son règlement et ce qu'on y voit.
export const REGLEMENT_DE_L_AUBERGE = [
  "On ne se bat pas à l'intérieur.",
  "On paie d'avance : un repas et un lit, une pièce d'or.",
  "On ne demande pas à Berthe d'où vient la lanterne.",
];

export const DECOR_DE_L_AUBERGE = "Au-dessus du comptoir pend une lanterne de fer aux vitres noircies, qu'on n'allume jamais. Près de la cheminée, une planche couverte d'affiches clouées les unes sur les autres.";

// Les rumeurs du kit, avec leur fond et leur vérité : des secrets du kit (« Tirer une rumeur » les reçoit de ce module,
// chez le MJ principal).
export const RUMEURS_DU_KIT = [
  { repere: "rumeur-lanterne", texte: "La lanterne du comptoir n'est pas une décoration. Berthe l'a rapportée d'une guerre.", source: "un vieux soldat", verite: "vraie", fond: "C'est la lanterne de sa compagnie, éteinte le soir de la trahison. Elle la rallumera quand le traître sera mort.", fil: "trahison" },
  { repere: "rumeur-mine", texte: "Les nains de la Forge-Rouge ont muré une galerie entière, la semaine dernière.", source: "un porteur de charbon", verite: "moitie", fond: "Ils l'ont murée, mais pas assez vite : ce qui creusait dessous est déjà passé.", fil: "mine" },
  { repere: "rumeur-prevote", texte: "La prévôte paie double pour qui lui ramène un ancien mercenaire de la Lanterne.", source: "une colporteuse", verite: "", fond: "À décider : elle veut les faire taire, ou les entendre.", fil: "trahison" },
];

export const FILS_DU_KIT = [
  {
    repere: "trahison", nom: "La compagnie trahie", faction: "La prévôté de Valombre", rythme: "seance",
    but: "La prévôte veut enterrer pour de bon la trahison de la compagnie de la Lanterne, et ceux qui s'en souviennent.",
    fin: "Les gardes de la prévôté viennent chercher Berthe à l'auberge. Elle se rend, ou elle rallume la lanterne.",
    etapes: [
      { texte: "Un avis de la prévôté est cloué à la porte de l'auberge.", rumeur: "La prévôté cherche les anciens de la Lanterne. Elle ne dit pas pourquoi.", afficher: "avis-prevote" },
      { texte: "Un ancien de la compagnie arrive à l'auberge, blessé, et demande Berthe.", rumeur: "Un borgne est arrivé à l'auberge cette nuit. Berthe a fermé la salle pour lui parler." },
      { texte: "On retrouve l'ancien noyé dans le gué.", rumeur: "Le borgne de l'auberge s'est noyé dans le gué. À un pied de fond." },
      { texte: "La prévôte vient dîner à l'auberge et regarde longtemps la lanterne.", rumeur: "La prévôte a dîné au Gué. Berthe ne lui a pas adressé un mot." },
    ],
  },
  {
    repere: "mine", nom: "La mine qui gratte", faction: "La forge Barbe-de-Fer", rythme: "deux",
    but: "Les nains veulent rouvrir leur mine sans avouer ce qu'ils y ont réveillé.",
    fin: "Ce qui creusait sous la mine sort par les puits du village, une nuit sans lune.",
    etapes: [
      { texte: "Les nains cherchent des volontaires pour une descente discrète.", rumeur: "Les nains paient en argent, cette fois. Pour une seule descente.", afficher: "volontaires-mine" },
      { texte: "Les puits du village donnent une eau tiède qui sent la pierre chaude.", rumeur: "L'eau du puits est tiède depuis trois jours. Le prieur dit que ce n'est rien." },
      { texte: "Des galeries s'ouvrent sous les champs ; une vache disparaît dans la nuit.", rumeur: "Un trou s'est ouvert dans le pré des Vernet. On n'en voit pas le fond." },
      { texte: "Les nains murent l'entrée de la mine et quittent la vallée.", rumeur: "Les nains sont partis avant l'aube, sans payer leur ardoise." },
    ],
  },
];

export const CONTRATS_DU_KIT = [
  {
    repere: "escorte-salant", genre: "contrat", nom: "Escorte vers Salant", etat: "affiche", delave: true, danger: "normal",
    affiche: "Caravane de laine pour le port de Salant, départ à la prochaine lune. Quatre jours de route.", recompense: "Vingt-cinq pièces d'or par tête, nourris.",
    contact: "Demander maître Coudray, à l'auberge.", mention: "", lieu: "salant", fil: "", etiquette: "maison", ordre: 1,
    verite: "Coudray fait passer sous la laine des lettres pour un ancien de la Lanterne. Quelqu'un l'a dénoncé à la prévôté.",
  },
  {
    repere: "avis-prevote", genre: "avis", nom: "Avis de la prévôté", etat: "brouillon", delave: false,
    affiche: "Par ordre de la prévôté de Valombre, tout ancien de la compagnie de la Lanterne se présentera au bailli. Qui en signale un touche la prime.",
    recompense: "Vingt pièces d'or par renseignement vérifié.", contact: "Fait à Valombre, pour la prévôte Héloïse de Vaugris.", mention: "",
    fil: "trahison", etiquette: "maison", ordre: 0,
    verite: "Berthe a refusé de l'afficher. Les gardes l'ont cloué eux-mêmes, à la porte de son auberge.",
  },
  {
    repere: "volontaires-mine", genre: "contrat", nom: "Volontaires pour la mine", etat: "brouillon", delave: false, danger: "difficile",
    affiche: "La forge Barbe-de-Fer cherche des gens solides pour une descente d'une nuit. Pas de questions.",
    recompense: "Généreuse. En argent.", contact: "Se présenter à la forge Barbe-de-Fer.", mention: "La dernière équipe n'a rien voulu raconter.",
    commanditaire: "heloise", lieu: "mine-de-la-forge", fil: "mine", etiquette: "maison", ordre: 2,
    verite: "La prévôte paie la moitié de la prime en secret : elle veut savoir ce que les nains cachent sous sa vallée.",
  },
];

export const HABITUES = [
  {
    repere: "habitue-colporteuse", genre: "f", nom: "La colporteuse", role: "Colporteuse qui vend de tout", peuple: "Halfeline", age: "d'âge mûr",
    voix: "Tout a un prix, et le prix change selon la tête du client.", envie: "Savoir avant tout le monde ce qui va se vendre.",
    offre: "Des cordes, des lanternes, des rumeurs, à un prix « d'amie ».", secret: "Elle porte les lettres de Coudray dans le double fond de sa hotte.",
    lieu: "auberge-du-gue", rang: "civil", connu: true, etiquette: "maison", attitude: "amical",
  },
  {
    repere: "habitue-vieux-soldat", genre: "h", nom: "Le vieux soldat", role: "Vétéran qui boit seul", peuple: "Humain", age: "âgé",
    voix: "Boit seul, écoute beaucoup, salue Berthe d'un signe de tête, comme un ancien camarade.",
    envie: "Qu'on le laisse boire en paix.", secret: "Il était de la compagnie de la Lanterne, et c'est lui qui a ouvert la porte, ce soir-là, payé par le père de la prévôte.",
    offre: "Un avertissement, une fois, à qui le mérite.", lieu: "auberge-du-gue", rang: "soldat", connu: true, etiquette: "maison", attitude: "mefiant",
  },
];
