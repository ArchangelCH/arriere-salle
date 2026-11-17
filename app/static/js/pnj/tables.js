// Tables de tirage des PNJ : le tirage lui-même. Les tables (origines et noms, métiers, peuples, traits, voix, envies,
// secrets, offres) sont des données de la campagne, campagne/noms.js ; ORIGINES et PEUPLES restent exportés d'ici.

import {
  DETAILS, ENVIES, FIGURANT, METIERS, NOMS, NOM_DU_RANG_HEROS, OFFRES, ORIGINES, ORIGINES_TIRAGE, ORIGINE_PAR_DEFAUT,
  PART_DES_RELIGIEUX, PEUPLES, PRENOMS, SECRETS, TRAITS, VOIX,
} from "../campagne/noms.js";

export { ORIGINES, PEUPLES };

const au = (liste) => liste[Math.floor(Math.random() * liste.length)];

// Les tables s'écrivent « {masculin|féminin} » ; accorder() garde la forme qui convient au PNJ.
export function accorder(texte, genre) {
  return String(texte).replace(/\{([^|{}]*)\|([^{}]*)\}/g, (_, h, f) => (genre === "f" ? f : h));
}
const majuscule = (t) => `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
export const tirerGenre = () => (Math.random() < 0.5 ? "h" : "f");

export const GENRES = [["h", "Masculin"], ["f", "Féminin"]];

const AGES_TIRAGE = ["jeune", "adulte", "d'âge mûr", "{âgé|âgée}", "{très vieux|très vieille}"];
export const AGES = ["jeune", "adulte", "d'âge mûr", "âgé", "âgée", "très vieux", "très vieille"];

export const ATTITUDES = [
  { cle: "allie", nom: "Allié" },
  { cle: "amical", nom: "Amical" },
  { cle: "neutre", nom: "Neutre" },
  { cle: "mefiant", nom: "Méfiant" },
  { cle: "hostile", nom: "Hostile" },
];

// Sans genre connu, le tirage en choisit un (le nom et les phrases doivent s'accorder entre eux).
const ou = (genre) => (genre === "h" || genre === "f" ? genre : tirerGenre());
// Une origine que les tables ne connaissent pas (une fiche faite avec une autre campagne, une région demandée par un
// autre module) : les noms de l'origine par défaut, sans hasard de plus. hasOwnProperty plutôt que Object.hasOwn : la
// TV (Chromium 79) charge ce module.
const porte = (objet, cle) => Object.prototype.hasOwnProperty.call(objet, cle);
const connue = (origine) => (porte(PRENOMS, origine) && porte(NOMS, origine) ? origine : ORIGINE_PAR_DEFAUT);

export function tirerNom(origine = au(ORIGINES).cle, genre) {
  const o = connue(origine);
  const g = ou(genre);
  const prenom = au(PRENOMS[o][g]);
  const nom = au(NOMS[o]);
  // Certaines origines donnent parfois un religieux : « Frère Anatole » plutôt qu'un nom de famille.
  if (porte(PART_DES_RELIGIEUX, o) && Math.random() < PART_DES_RELIGIEUX[o]) return `${g === "h" ? "Frère" : "Sœur"} ${prenom}`;
  return `${prenom} ${nom}`;
}

const phrase = (table, genre) => `${majuscule(accorder(au(table), ou(genre)))}.`;
export const tirerMetier = (genre) => accorder(au(METIERS), ou(genre));
export const tirerAge = (genre) => accorder(au(AGES_TIRAGE), ou(genre));
export const tirerApparence = (genre) => {
  const g = ou(genre);
  return `${majuscule(accorder(au(TRAITS), g))}, ${accorder(au(DETAILS), g)}.`;
};
export const tirerVoix = (genre) => phrase(VOIX, genre);
export const tirerEnvie = (genre) => phrase(ENVIES, genre);
export const tirerSecret = (genre) => phrase(SECRETS, genre);
export const tirerOffre = (genre) => phrase(OFFRES, genre);

// Un PNJ complet en un clic ; les champs déjà remplis sont gardés.
export function tirerPnj(base = {}) {
  const origine = base.origine || au(ORIGINES_TIRAGE);
  const o = ORIGINES.find((x) => x.cle === origine) || ORIGINES.find((x) => x.cle === ORIGINE_PAR_DEFAUT);
  const genre = ou(base.genre);
  return {
    nom: base.nom || tirerNom(origine, genre),
    genre,
    role: base.role || tirerMetier(genre),
    peuple: base.peuple || accorder(o.peuple, genre),
    age: base.age || tirerAge(genre),
    apparence: base.apparence || tirerApparence(genre),
    voix: base.voix || tirerVoix(genre),
    envie: base.envie || tirerEnvie(genre),
    secret: base.secret || tirerSecret(genre),
    offre: base.offre || tirerOffre(genre),
    origine,
  };
}

// Le figurant de la campagne (campagne/noms.js, FIGURANT) : en pleine partie, un passant prêt en une seconde, toujours
// du même nom, avec un métier, un âge, une allure, une voix et une envie.
export function tirerFigurant() {
  const g = FIGURANT.genre;
  return {
    nom: FIGURANT.nom,
    role: au(FIGURANT.roles),
    genre: g,
    peuple: FIGURANT.peuple,
    age: tirerAge(g),
    apparence: tirerApparence(g),
    voix: tirerVoix(g),
    envie: tirerEnvie(g),
    secret: "",
    offre: "",
    rang: "sbire",
    origine: FIGURANT.origine,
  };
}

// Rangs du bestiaire du kit (calibrés par simulation), et celui des héros de légende que la campagne fait croiser (son
// nom : campagne/noms.js). Le civil est une valeur maison : le bestiaire ne prévoit que le notable, qui ne se bat pas
// et paie quelqu'un pour le faire.
export const RANGS = [
  { cle: "civil", nom: "Civil", profil: { social: 45, mental: 45, sante: 5 } },
  { cle: "notable", nom: "Notable (intendant, noble, marchand)", profil: { social: 70, mental: 60, sante: 6, escorte: "2 gardes" } },
  { cle: "sbire", nom: "Sbire", profil: { attaque: 45, degats: "1D6", armure: 0, sante: 5, defense: "aucune", test: 40 } },
  { cle: "soldat", nom: "Soldat", profil: { attaque: 55, degats: "1D8", armure: 1, sante: 10, defense: "aucune", test: 50 } },
  { cle: "elite", nom: "Élite", profil: { attaque: 65, degats: "1D10", armure: 2, sante: 16, defense: "1 par tour, 50 %", test: 65 } },
  { cle: "boss", nom: "Boss", profil: { attaque: "70 % ×2", degats: "2D6", armure: 2, sante: "8 × PJ", defense: "1 par tour, 50 %", test: 75 } },
  { cle: "heros", nom: NOM_DU_RANG_HEROS, profil: { physique: 70, social: 50, mental: 65, sante: 18, psy: 6 } },
];

export const CHAMPS_PROFIL = {
  attaque: "Attaque", degats: "Dégâts", armure: "Armure", sante: "Santé", defense: "Défense", test: "Test",
  social: "Social", mental: "Mental", physique: "Physique", psy: "Psy", escorte: "Escorte",
};
