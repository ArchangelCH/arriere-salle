// Le menu du sang dans le panneau de l'éditeur de plans (outil « Sang », touche S) : la forme (pinceau, flaque,
// éclaboussure, gouttes, traînée), la teinte, la taille, la fraîcheur, cachée aux joueurs ou non, et ce qu'il y a sur le plan.
// Du HTML seulement : l'éditeur reçoit les clics (data-opt-bouton, data-sang) et les saisies (data-sang-reglage).
// La logique (poser, peindre, effacer) est dans sang.js.

import { echapper as e } from "../api.js";
import { TAILLE, TEINTES_SANG, TYPES_SANG, compter, couleursSang } from "./sang.js";

const virgule = (x) => String(Math.round(x * 10) / 10).replace(".", ",");
const rvb = (c) => `rgb(${c.join(",")})`;
const fraicheur = (a) => (a < 0.25 ? "frais" : a < 0.65 ? "récent" : "sec");

const AIDE = {
  pinceau: "Glissez sur le sol : le sang s'éclabousse le long du trait, en gouttes, en flaques et en éclaboussures.",
  flaque: "Un clic pose une flaque ; glissez pour en poser plusieurs.",
  eclaboussure: "Un clic pose une éclaboussure, avec ses gouttes ; glissez pour en semer.",
  gouttes: "Un clic pose quelques gouttes ; glissez pour une piste de gouttes.",
  trainee: "Glissez : la traînée part de l'endroit où vous appuyez et va jusqu'où vous lâchez (un clic en pose une courte).",
};

export function htmlSang(plan, opt, { peint = false, apercu = false } = {}) {
  const c = compter(plan);
  const frais = couleursSang(opt.teinte, opt.age);
  return `
    <h2>Sang</h2>
    ${peint ? "" : `<p class="aide alerte-lumiere" role="status">Le sang ne se dessine que dans le style Peint (celui de la TV pour cette ambiance). <button type="button" class="lien" data-sang="peint">Passer en Peint</button></p>`}
    ${apercu ? '<p class="aide">Une proposition d\'habillage est affichée : gardez-la ou écartez-la avant de poser du sang.</p>' : ""}
    <div class="palette formes-sang" role="radiogroup" aria-label="Forme">${TYPES_SANG.map(([k, n]) => `<button type="button" role="radio" aria-checked="${opt.forme === k}" data-opt-bouton="sang.forme" data-valeur="${k}">${e(n)}</button>`).join("")}</div>
    <p class="aide">${e(AIDE[opt.forme] || "")} Alt + glisser efface (la gomme a la taille du pinceau). Le sang ne tombe que sur le sol d'une pièce.</p>
    <div class="palette teintes-sang" role="radiogroup" aria-label="Teinte">${TEINTES_SANG.map(([k, n]) => `<button type="button" role="radio" aria-checked="${opt.teinte === k}" data-opt-bouton="sang.teinte" data-valeur="${k}"><span class="pastille" style="background:${rvb(couleursSang(k, opt.age).bord)}"></span>${e(n)}</button>`).join("")}</div>
    <label class="champ">Taille <output>${virgule(opt.taille)}</output><input type="range" min="${TAILLE.min}" max="${TAILLE.max}" step="0.1" data-sang-reglage="taille" value="${e(opt.taille)}"></label>
    <label class="champ">Fraîcheur <output>${fraicheur(opt.age)}</output><input type="range" min="0" max="1" step="0.05" data-sang-reglage="age" value="${e(opt.age)}" class="curseur-fraicheur" style="--frais:${rvb(couleursSang(opt.teinte, 0).bord)};--sec:${rvb(couleursSang(opt.teinte, 1).bord)}"></label>
    <label class="case"><input type="checkbox" data-sang-reglage="cache" ${opt.cache ? "checked" : ""}> Caché aux joueurs (ce que vous posez ensuite)</label>
    <h3>Sur ce plan <span class="secret">${c.total ? `${c.total} tache${c.total > 1 ? "s" : ""}${c.caches ? `, ${c.caches} cachée${c.caches > 1 ? "s" : ""}` : ""}` : "rien"}</span></h3>
    ${c.total ? `
      <div class="actions">
        <button type="button" data-sang="reveler-tout" ${c.caches === 0 ? "disabled" : ""}>Montrer tout aux joueurs</button>
        <button type="button" data-sang="cacher-tout" ${c.caches === c.total ? "disabled" : ""}>Tout cacher</button>
        <button type="button" class="danger" data-sang="tout-effacer">Tout effacer</button>
      </div>` : '<p class="aide">Aucune tache de sang pour l\'instant.</p>'}
    <span class="apercu-sang" style="--centre:${rvb(frais.centre)};--bord:${rvb(frais.bord)}" aria-hidden="true"></span>`;
}
