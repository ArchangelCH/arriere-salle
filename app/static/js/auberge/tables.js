// Tables de l'auberge : contrats tirés au sort pour la planche, rumeurs de comptoir maison (celles du kit : auberge/kit.js).
// Les récompenses suivent les prix du kit : un contrat simple paie de 20 à 50 pièces d'or par tête. Ce qui s'y tire
// (problèmes, contacts, mentions, ce qui se cache derrière, rumeurs) est une donnée de la campagne : campagne/planche.js.

import { CONTACTS, MENTIONS, PROBLEMES, RECOMPENSE_RARE, RUMEURS_MAISON, TOURNURES } from "../campagne/planche.js";

const au = (liste) => liste[Math.floor(Math.random() * liste.length)];

export const ETATS_CONTRAT = [
  ["brouillon", "Brouillon, pas affiché"],
  ["affiche", "Affiché sur la planche"],
  ["pris", "Pris par les héros"],
  ["reussi", "Réussi"],
  ["echoue", "Échoué"],
  ["retire", "Retiré"],
];

// Barème de l'aide-mémoire du MJ : ce qu'on met en face des aventuriers.
export const DANGERS = [
  ["", "Non précisé"],
  ["facile", "Facile : 1 sbire par PJ"],
  ["normal", "Normale : 1 soldat par PJ"],
  ["difficile", "Difficile : 1 élite pour 2 PJ, ou 1 boss"],
  ["epique", "Épique : 1 boss et 1 sbire pour 2 PJ"],
];

export const ETATS_RUMEUR = [
  ["a-placer", "À placer"],
  ["entendue", "Entendue par les héros"],
  ["verifiee", "Vérifiée"],
  ["dementie", "Démentie"],
];

export const VERITES = [
  ["", "Pas encore décidé"],
  ["vraie", "Vraie"],
  ["moitie", "À moitié vraie"],
  ["fausse", "Fausse"],
];

const NOMBRES = { 20: "Vingt", 25: "Vingt-cinq", 30: "Trente", 35: "Trente-cinq", 40: "Quarante", 45: "Quarante-cinq", 50: "Cinquante" };

export function tirerContrat() {
  const [nom, affiche, danger] = au(PROBLEMES);
  const somme = au([20, 25, 30, 35, 40, 45, 50]);
  return {
    genre: "contrat",
    nom,
    affiche,
    recompense: Math.random() < RECOMPENSE_RARE.part ? RECOMPENSE_RARE.texte : `${NOMBRES[somme]} pièces d'or par tête.`,
    contact: au(CONTACTS),
    mention: Math.random() < 0.3 ? au(MENTIONS) : "",
    danger,
    verite: au(TOURNURES),
    etat: "brouillon",
    delave: false,
    etiquette: "maison",
  };
}

// Une rumeur qui n'est pas encore dans le carnet ; celles du kit (duKit, auberge/kit.js) mêlées aux autres.
export function tirerRumeur(existantes, duKit = []) {
  const deja = new Set(existantes.map((r) => (r.texte || "").trim()));
  const libres = [...duKit, ...RUMEURS_MAISON].filter((r) => !deja.has(r.texte));
  if (!libres.length) return null;
  const r = au(libres);
  return { texte: r.texte, source: r.source, verite: r.verite || "", fond: r.fond || "", fil: r.fil || "", repere: r.repere, etat: "a-placer" };
}
