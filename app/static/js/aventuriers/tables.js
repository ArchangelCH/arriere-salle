// Des idées à tirer au sort quand un joueur sèche, écrites « {masculin|féminin} » et accordées à son aventurier. Les
// listes viennent de la campagne (campagne/idees-heros.js) : elles racontent son monde ; ici, seulement le tirage.

import { ALLURES, AVANT, DEFAUTS, JAMAIS, LIENS, NOMS_PAR_PEUPLE, POURQUOI } from "../campagne/idees-heros.js";
import { ORIGINES, accorder, tirerNom } from "../pnj/tables.js";
import { simple } from "./regles.js";

const au = (liste) => liste[Math.floor(Math.random() * liste.length)];

export const tirerAvant = (genre) => accorder(au(AVANT), genre);
export const tirerPourquoi = (genre) => accorder(au(POURQUOI), genre);
export const tirerJamais = (genre) => accorder(au(JAMAIS), genre);
export const tirerAllure = (genre) => accorder(au(ALLURES), genre);
export const tirerDefaut = (genre) => accorder(au(DEFAUTS), genre);

// {Il|Elle} s'accorde à l'aventurier, [battus|battues] aux deux (au féminin seulement si ce sont deux femmes) ;
// {autre} est le prénom de l'autre, ou « un autre aventurier » tant qu'il n'est pas choisi.
export function tirerLien(genre, autre, genreAutre) {
  const nom = autre || (genreAutre === "f" ? "une autre aventurière" : "un autre aventurier");
  const texte = accorder(au(LIENS), genre)
    .replace(/\[([^|\]]*)\|([^\]]*)\]/g, (_, h, f) => (genre === "f" && genreAutre === "f" ? f : h))
    .split("{autre}").join(nom)
    .replace(/\bque ([aeiouyàâéèêëîïôöùûœ])/gi, "qu'$1");
  return `${texte.charAt(0).toUpperCase()}${texte.slice(1)}`;
}

// Un nom qui colle au peuple : certains peuples ont leurs noms, les autres viennent d'une région de la campagne
// (NOMS_PAR_PEUPLE). Sans région nommée, une origine des tables des PNJ qui n'est celle d'aucun peuple ; une origine que
// ces tables ne connaissent pas les laisse en choisir une.
export function tirerNomAventurier(a) {
  const p = simple(a.peuple);
  const { peuples, regions } = NOMS_PAR_PEUPLE;
  const libres = () => ORIGINES.map((o) => o.cle).filter((cle) => !Object.values(peuples).includes(cle));
  const origine = Object.prototype.hasOwnProperty.call(peuples, p) ? peuples[p] : au(regions.length ? regions : libres());
  const connue = ORIGINES.some((o) => o.cle === origine);
  return tirerNom(connue ? origine : undefined, a.genre === "f" ? "f" : a.genre === "h" ? "h" : undefined);
}
