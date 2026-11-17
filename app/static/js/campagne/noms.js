// Les tables de tirage des PNJ (pnj/tables.js) : les origines et leurs noms, les métiers, les peuples, les traits, les
// voix, les envies, les secrets et les offres. Campagne d'exemple : la vallée de Valombre, les fjords de Hautefage, les
// nains, la côte de Salant, les elfes. Servi au coin des joueurs, à la TV et au MJ invité avec pnj/tables.js : rien du
// kit ici. Les tables s'écrivent « {masculin|féminin} » (accorder(), pnj/tables.js).

export const ORIGINES = [
  { cle: "valombre", nom: "Valombre", peuple: "{Humain|Humaine}" },
  { cle: "hautefage", nom: "Hautefage", peuple: "{Humain|Humaine}" },
  { cle: "nain", nom: "Nain", peuple: "{Nain|Naine}" },
  { cle: "salant", nom: "Salant", peuple: "{Humain|Humaine}" },
  { cle: "elfe", nom: "Elfe", peuple: "Elfe" },
];

// Le tirage d'un PNJ : la vallée d'abord, puis les fjords, les nains, la côte, les elfes (aussi les trois noms du
// tableau du MJ).
export const ORIGINES_TIRAGE = ["valombre", "valombre", "valombre", "hautefage", "nain", "nain", "salant", "elfe"];
// L'origine d'un nom tiré sans région connue.
export const ORIGINE_PAR_DEFAUT = "valombre";
// La part des noms tirés qui prennent « Frère » ou « Sœur » au lieu d'un nom de famille, par origine : la vallée a
// son prieuré.
export const PART_DES_RELIGIEUX = { valombre: 0.15 };
// Les noms d'une région, dans le tableau du MJ : les nains chez eux (le type du lieu), Hautefage et Salant chez eux
// (son nom ou son identifiant les cite).
export const ORIGINES_PAR_TYPE_DE_LIEU = { cite_naine: "nain" };
export const ORIGINES_PAR_NOM_DE_LIEU = ["hautefage", "salant"];

export const PRENOMS = {
  valombre: {
    h: ["Aubin", "Gautier", "Jehan", "Thibaut", "Firmin", "Lambert", "Urbain", "Hugues", "Mathis", "Odon", "Clément", "Josse"],
    f: ["Isaure", "Perrine", "Odile", "Colette", "Margot", "Berthe", "Jeanne", "Sidonie", "Bertille", "Aude", "Mahaut"],
  },
  hautefage: {
    h: ["Arvid", "Halvard", "Sten", "Ivar", "Bjarni", "Ragnvald", "Olaf", "Eskil"],
    f: ["Sigrid", "Ingrid", "Solveig", "Ylva", "Tove", "Liv", "Freja", "Maren"],
  },
  nain: {
    h: ["Brannoc", "Ulrik", "Haldor", "Gorm", "Varn", "Skeld", "Korgan", "Dolgar"],
    f: ["Brynja", "Hulda", "Gerda", "Ketta", "Runhild", "Dagny", "Herdis"],
  },
  salant: {
    h: ["Marin", "Loïc", "Yvon", "Corentin", "Tanguy", "Ronan", "Malo", "Goulven"],
    f: ["Soizic", "Gwenola", "Nolwenn", "Rozenn", "Annaïg", "Morgane", "Enora", "Katell"],
  },
  elfe: {
    h: ["Aelion", "Thalor", "Ilian", "Sorel", "Vaelith", "Elandor"],
    f: ["Liriel", "Sylvaine", "Ysmera", "Aubeline", "Néalis", "Orwenn"],
  },
};

export const NOMS = {
  valombre: ["Vernet", "Tournebroche", "Clairbois", "Mortier", "Fauchet", "Lavandier", "Pierrefonde", "Bellerive", "Coudray", "Grandpré", "du Moulin"],
  hautefage: ["Brandvik", "Skarholm", "Isfjell", "Torvik", "Grimstad", "Vedmark", "Hallberg"],
  nain: ["Barbe-de-Fer", "Pic-Sûr", "Marteau-Clair", "Forge-Rouge", "Roc-Têtu", "Chope-Pleine", "Mine-Profonde", "Enclume-d'Or"],
  salant: ["Le Goff", "Kerbrat", "Penhoat", "des Grèves", "du Phare", "Le Bihan", "Tréguier", "des Embruns"],
  elfe: ["du Bois-Dormant", "Chant-d'Aube", "des Hautes-Ramures", "Feuille-Claire", "de la Rosée", "Œil-de-Lune"],
};

export const METIERS = [
  "Aubergiste", "{Serveur|Serveuse}", "{Forgeron|Forgeronne}", "{Marchand ambulant|Marchande ambulante}", "Garde", "Sergent du guet",
  "{Prêtre|Prêtresse}", "{Moine|Moniale}", "{Contrebandier|Contrebandière}", "{Chasseur|Chasseresse}", "{Mineur|Mineuse}",
  "{Batelier|Batelière}", "{Meunier|Meunière}", "Herboriste", "{Ménestrel|Ménestrelle}", "{Mendiant|Mendiante}",
  "{Noble désargenté|Noble désargentée}", "{Caravanier|Caravanière}", "Mercenaire", "{Fermier|Fermière}", "{Fossoyeur|Fossoyeuse}",
  "Cartographe", "Alchimiste", "{Pêcheur|Pêcheuse}", "{Gardien|Gardienne} de phare", "{Ancien aventurier|Ancienne aventurière}",
];

export const PEUPLES = ["Humain", "Humaine", "Nain", "Naine", "Elfe", "Halfelin", "Halfeline", "Demi-orc"];

export const TRAITS = [
  "une cicatrice lui barre le menton", "des mains énormes et très propres", "le nez cassé plusieurs fois", "une tresse grise jusqu'à la taille",
  "des yeux très clairs qui ne clignent presque pas", "des taches d'encre jusqu'aux coudes", "une dent en argent",
  "une carrure de lutteur et un regard d'enfant", "des cheveux coupés au couteau", "une jambe de bois sculptée avec soin",
  "une toux qui ne {le|la} lâche pas", "un sourire qui arrive toujours un peu trop tard", "le visage couvert de taches de rousseur",
  "une silhouette sèche et nerveuse", "des gestes lents, comme {s'il|si elle} comptait chacun",
];

export const DETAILS = [
  "un manteau trop grand, pris à un mort", "un tablier de cuir couvert de brûlures", "des lunettes de laiton rafistolées",
  "une bourse qui tinte beaucoup trop", "des bottes neuves, beaucoup trop belles pour {lui|elle}", "un chapeau à plume de héron",
  "un chien maigre qui ne {le|la} quitte pas", "un carnet où {il|elle} note tout", "une pipe éteinte qu'{il|elle} mâchonne",
  "un collier de dents de loup", "des gants qu'{il|elle} n'enlève jamais", "un luth sans cordes", "une lettre cachetée qu'{il|elle} touche sans arrêt",
  "une robe de voyage tachée de boue jusqu'aux genoux", "un médaillon de cuivre qu'{il|elle} ouvre sans cesse",
];

export const VOIX = [
  "parle en chuchotant, même pour dire bonjour", "répète la dernière phrase qu'on lui dit, lentement", "ponctue tout d'un claquement de langue",
  "compte tout sur ses doigts, même les compliments", "ne regarde jamais son interlocuteur en face", "rit avant de répondre, jamais après",
  "vouvoie tout le monde, même son chien", "tutoie tout le monde dès la première phrase", "parle {de lui|d'elle} à la troisième personne",
  "sifflote quand {il|elle} ment", "parle vite, très vite, puis se tait d'un coup", "appelle tout le monde « mon brave », même les nains",
  "choisit chaque mot comme s'il coûtait une pièce d'or", "commence toutes ses phrases par « à vrai dire »", "demande le prix de tout, même des conseils",
];

export const ENVIES = [
  "rembourser une dette avant la prochaine lune", "retrouver son frère, parti sur un contrat il y a trois semaines",
  "quitter le village sans que personne ne le sache", "devenir {aventurier|aventurière}, malgré son âge", "marier sa fille à un noble, n'importe lequel",
  "ouvrir une auberge plus belle que celle du Gué", "récupérer un objet volé par des gobelins", "faire taire une rumeur qui court sur {lui|elle}",
  "qu'on retrouve le corps de son fils, pour l'enterrer", "racheter le moulin de son père", "qu'on escorte sa mule jusqu'à la côte",
  "apprendre à lire avant de mourir", "faire fortune avant l'hiver", "être {oublié|oubliée} de tout le monde", "voir un vrai dragon",
];

export const SECRETS = [
  "{il|elle} porte un faux nom depuis dix ans", "{il|elle} cache un enfant recherché dans sa cave", "{il|elle} n'a jamais vu la bataille qu'{il|elle} raconte si bien",
  "{ancien aventurier, il|ancienne aventurière, elle} a fui un contrat et laissé mourir ses compagnons", "{il|elle} vole les offrandes du temple pour nourrir des orphelins",
  "{il a un frère jumeau|elle a une sœur jumelle} dont personne ne connaît l'existence", "{il est ruiné|elle est ruinée}, et tout ce qu'{il|elle} porte est emprunté",
  "{il|elle} a déjà tué, et ne le regrette pas", "{il|elle} a volé l'identité d'un mort", "{il|elle} espionne pour un seigneur voisin",
  "{il|elle} empoisonne lentement son maître", "{il|elle} est de sang noble et renie sa famille", "{il|elle} n'a plus que quelques mois à vivre",
  "{il|elle} ne sait pas lire, et personne ne doit le savoir", "{il|elle} a caché un déserteur dans sa grange",
];

export const OFFRES = [
  "une rumeur fraîche sur un contrat bien payé", "un lit sec et une soupe chaude", "une carte, fausse à moitié",
  "le nom de quelqu'un qui peut ouvrir une porte fermée", "un raccourci par les marais", "un objet ancien dont {il|elle} ignore la valeur",
  "des vivres à prix d'ami", "une escorte jusqu'à la prochaine ville", "un secret sur un notable", "des soins, sans questions",
  "une dette qu'{il|elle} pourra rendre plus tard", "un avertissement, à prendre au sérieux",
];

// Le figurant de la campagne : en pleine partie, tout passant sans nom s'appelle Gaston. Le bouton du carnet, son
// explication, et ce que le tirage lui donne.
export const FIGURANT = {
  nom: "Gaston",
  bouton: "Un Gaston",
  titre: "Tout passant sans nom s'appelle Gaston",
  aide: "Ici, tout passant sans nom s'appelle Gaston.",
  roles: ["Villageois", "Garde", "Palefrenier", "Commis", "Colporteur", "Pêcheur", "Gamin des rues", "Porteur", "Garçon d'écurie", "Bûcheron"],
  genre: "h",
  peuple: "Humain",
  origine: "valombre",
};

// Le rang des héros de légende dans le bestiaire des PNJ (pnj/tables.js, RANGS).
export const NOM_DU_RANG_HEROS = "Héros de légende";
