// La barre du combat, dessinée une fois et posée telle quelle sur la page du combat (combat.js), dans le Tableau (le
// combat compact) et sur la télécommande (telecommande.js) : qui a la main et l'ordre du tour, Précédent et Suivant, le
// Point strat, le sablier, l'ordre à la TV, puis « Fin du combat » au bout, à l'écart des autres. Les mêmes mots sur
// les trois écrans. Ici, seulement le dessin : chaque écran tient ses gestes (data-action) avec suivi.js. Aussi la
// posture en trois pastilles (épée, écu, œil, comme sur les pions) et les cartons en boutons P, S, M.

import { echapper as e } from "../api.js";
import { CARACS_CARTON, CARTONS, ENNEMIS, POSTURES_COMBAT, SABLIER, herosDe, peutAgir, prenom, suivant } from "./suivi.js";

const couleurSure = (c) => (/^#[0-9a-fA-F]{3,8}$/.test(c || "") ? c : "#8a6a34");

// Les mots de la barre, choisis une fois.
export const MOTS = {
  precedent: "Précédent",
  suivant: "Suivant",
  strat: "Point strat",
  stratPris: "Point strat pris",
  sablier: `Sablier ${Math.round(SABLIER / 60)} min`,
  sablierArret: "Arrêter le sablier",
  tv: "Montrer l'ordre à la TV",
  tvRetirer: "Retirer l'ordre de la TV",
  fin: "Fin du combat",
  rouvrir: "Rouvrir le combat",
  seance: "Retour à la séance",
};

export function minutes(s) {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

// Le nom d'une case de l'ordre : le prénom du héros, ou « Les adversaires ».
export const nomEntree = (c, x, dans = false) => (x === ENNEMIS ? `${dans ? "l" : "L"}es adversaires` : prenom(herosDe(c, x)?.nom) || "?");

// « à Ysane » ou « aux adversaires » : à qui va la main.
export const versQui = (c) => {
  const x = c?.ordre?.[c.actif];
  return x === ENNEMIS ? "aux adversaires" : `à ${nomEntree(c, x)}`;
};

// Le lien d'une séance, ouverte sur Jouer.
export const lienSeance = (id) => `#/seances/${encodeURIComponent(id)}?onglet=jouer`;

const puce = (couleur) => `<span class="bc-puce" style="background:${e(couleurSure(couleur))}"></span>`;
const losange = '<span class="bc-losange" aria-hidden="true"></span>';

// surface : « page », « tableau » ou « telecommande » (la même barre, plus ou moins serrée) ; tv : l'ordre est à la
// TV ; reste : les secondes du sablier ; milieu : ce qu'un écran glisse entre la main et les boutons (la Santé du héros
// qui a la main, sur la télécommande) ; occupe : un geste part (télécommande).
export function htmlBarre(c, { surface = "page", tv = false, reste = null, milieu = "", occupe = false } = {}) {
  const ordre = Array.isArray(c.ordre) ? c.ordre : [];
  const entree = ordre[c.actif];
  const ennemis = entree === ENNEMIS;
  const h = ennemis ? null : herosDe(c, entree);
  const apres = suivant(c);
  const ensuite = nomEntree(apres, apres.ordre?.[apres.actif], true);
  const tourSuivant = apres.tour > (c.tour || 1);
  const s = c.sablier;
  const attente = occupe ? ' aria-busy="true"' : "";
  const clavier = surface === "telecommande" ? "" : " Ou la touche Entrée, hors d'une case de saisie.";
  const cases = ordre.map((x, i) => {
    const heros = x === ENNEMIS ? null : herosDe(c, x);
    if (x !== ENNEMIS && !heros) return "";
    const classes = [i === c.actif ? "actif" : "", peutAgir(c, x) ? "" : "hors", heros ? "" : "ennemis"].filter(Boolean).join(" ");
    return `<li><button type="button" class="${classes}" data-action="aller" data-rang="${i}" aria-current="${i === c.actif}" title="Donner la main ${heros ? `à ${e(prenom(heros.nom))}` : "aux adversaires"}"${attente}>${heros ? puce(heros.couleur) : losange}${e(nomEntree(c, x))}</button></li>`;
  }).join("");
  return `
    <section class="barre-combat barre-${surface}" aria-label="Le tour du combat">
      <div class="bc-main">
        <p class="bc-tour"><span>Tour</span><b>${c.tour || 1}</b></p>
        <div class="bc-qui">
          <p class="bc-phrase"><b class="bc-nom">${h ? puce(h.couleur) : ennemis ? losange : ""}${e(nomEntree(c, entree))}</b> <span class="bc-a">${ennemis ? "ont" : "a"} la main.</span> <span class="bc-ensuite">Ensuite : ${e(ensuite)}${tourSuivant ? ", au tour suivant" : ""}.</span></p>
          <ol class="bc-ordre" aria-label="Ordre du tour">${cases}</ol>
        </div>
        ${milieu ? `<div class="bc-milieu">${milieu}</div>` : ""}
        <div class="bc-passer">
          <button type="button" class="touche" data-action="precedent" title="Revenir au combattant d'avant"${attente}>${MOTS.precedent}</button>
          <button type="button" class="touche bc-suivant" data-action="suivant" title="Passer la main ${e(ensuite === "les adversaires" ? "aux adversaires" : `à ${ensuite}`)}.${clavier}"${attente}>${MOTS.suivant}</button>
        </div>
      </div>
      <div class="bc-kit">
        <button type="button" class="touche bc-strat" data-action="strat" aria-pressed="${!!c.strat}" title="Une fois par combat : le temps s'arrête, les joueurs se concertent une ou deux minutes"${attente}>${c.strat ? MOTS.stratPris : MOTS.strat}</button>
        <button type="button" class="touche bc-sablier" data-action="sablier" aria-pressed="${!!s}" title="La table traîne : à zéro, le monstre rejoue"${attente}>${s ? MOTS.sablierArret : MOTS.sablier}</button>
        <span class="sablier-mj${s && reste !== null && reste <= 0 ? " vide" : ""}" ${s ? "" : "hidden"} aria-live="off">${s && reste !== null ? minutes(reste) : ""}</span>
        <button type="button" class="touche bc-tv" data-action="tv" aria-pressed="${!!tv}" title="Les prénoms des héros et une case « Les ennemis », sans nom ni Santé d'adversaire"${attente}>${tv ? MOTS.tvRetirer : MOTS.tv}</button>
        <p class="bc-bout"><button type="button" class="bc-fin" data-action="fin" title="Le combat quitte la séance${tv ? " et la TV" : ""}, son bilan va au journal. « ${MOTS.rouvrir} » le reprend pendant quelques secondes."${attente}>${MOTS.fin}</button></p>
      </div>
    </section>`;
}

// Les signes des postures, dessinés comme sur les pions (plan/rendu.js) : une épée, un écu, un œil.
const SIGNES = {
  offensive: '<g transform="rotate(-45)"><line x1="0" y1="-6.2" x2="0" y2="3" stroke-width="2"/><line x1="-3" y1="3" x2="3" y2="3" stroke-width="1.6"/><circle cx="0" cy="5.2" r="1.3" stroke="none"/></g>',
  defensive: '<path d="M-4.6 -5H4.6V-.5Q4.2 4.2 0 6.2Q-4.2 4.2 -4.6 -.5Z" stroke="none"/>',
  focus: '<path d="M-6.2 0Q0 -6.2 6.2 0Q0 6.2 -6.2 0Z" fill="none" stroke-width="1.4"/><circle r="2" stroke="none"/>',
  aucune: '<circle r="5" fill="none" stroke-width="1.6"/><line x1="-3.6" y1="3.6" x2="3.6" y2="-3.6" stroke-width="1.6"/>',
};
const REGLES_POSTURES = {
  offensive: "dégâts au maximum, critique de 01 à 10 ; aucune défense",
  defensive: "une défense par tour (esquiver, parer, protéger un allié) ; bouclier compté",
  focus: "+5 % à tous les tests, chaque don coûte 1 Psy de moins ; aucune défense",
  aucune: "à découvert : aucune défense, aucun effet",
};

export const signePosture = (k) => `<svg class="signe-posture" viewBox="-9 -9 18 18" aria-hidden="true" fill="currentColor" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${SIGNES[k] || ""}</svg>`;

// La posture d'un héros au combat : trois pastilles, celle qu'il tient pleine de sa couleur.
export function htmlPostures(id, nom, posture) {
  return `<span class="postures-combat" role="group" aria-label="Posture de ${e(nom)}">${POSTURES_COMBAT.map(([k, libelle]) => `<button type="button" class="posture-${k}" data-action="posture" data-id="${e(id)}" data-posture="${k}" aria-pressed="${posture === k}" aria-label="${libelle}" title="${libelle} : ${REGLES_POSTURES[k]}">${signePosture(k)}</button>`).join("")}</span>`;
}

// Le tour suivant d'un carton : aucun, jaune, rouge, aucun.
export const CYCLE_CARTON = { "": "jaune", jaune: "rouge", rouge: "" };
export const cartonApres = (actuel) => CYCLE_CARTON[CARTONS[actuel] ? actuel : ""];

// Les cartons d'un héros : P, S, M, un clic fait tourner aucun, jaune, rouge. inactif : ils se changent ailleurs.
export function htmlCartons(id, nom, cartons = {}, { inactif = false, pourquoi = "" } = {}) {
  return `<span class="tc-cartons" role="group" aria-label="Cartons de ${e(nom)}">${CARACS_CARTON.map(([k, nomCarac]) => {
    const v = CARTONS[cartons?.[k]] ? cartons[k] : "";
    const etat = v ? `carton ${CARTONS[v]}` : "aucun carton";
    const suite = inactif ? (pourquoi ? ` (${pourquoi})` : "") : ` (cliquer : ${CYCLE_CARTON[v] ? `carton ${CYCLE_CARTON[v]}` : "aucun"})`;
    return `<button type="button" class="carton-${v || "aucun"}" data-action="carton" data-id="${e(id)}" data-carac="${k}" aria-label="${nomCarac} : ${etat}" title="${nomCarac} : ${e(etat)}${e(suite)}" ${inactif ? "disabled" : ""}>${nomCarac.charAt(0)}</button>`;
  }).join("")}</span>`;
}
