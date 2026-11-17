// L'écran de la table dans la page Table du coin des joueurs (joueurs/ecran.html, html[data-source="coin"]) : la même page
// que la TV, mais sans liaison avec l'atelier, que le coin n'atteint pas. La page Table (joueurs/table-coin.js), qui la
// tient dans un cadre, lui passe ce que l'atelier a publié pour le coin (tv_etat.ecran_pour_le_coin) : l'état public de la
// table, et pour chaque lecture que ferait la TV (/api/table/…), sa réponse. Les modules de table/ lisent donc ici ce
// qu'ils liraient au serveur ; une lecture absente (refusée à la TV) répond comme un refus.
//
// Importé par table.js, donc transpilé pour l'écran de la table : rien au-delà d'ES2019 ici.

import { poserSource } from "./outils.js";

export function brancherCoin(recevoir) {
  let lectures = {};
  // Une copie à chaque lecture : les modules retouchent ce qu'ils lisent.
  poserSource((url) => Promise.resolve(Object.prototype.hasOwnProperty.call(lectures, url) ? JSON.parse(JSON.stringify(lectures[url])) : null));
  window.addEventListener("message", (ev) => {
    if (ev.origin !== location.origin || ev.source !== window.parent) return;
    const m = ev.data;
    if (!m || m.type !== "table-coin" || !m.etat || typeof m.etat !== "object") return;
    lectures = m.lectures && typeof m.lectures === "object" ? m.lectures : {};
    recevoir(m.etat);
  });
  // La page qui tient le cadre attend ce signal pour envoyer ce qu'elle a déjà lu.
  if (window.parent !== window) window.parent.postMessage({ type: "ecran-coin-pret" }, location.origin);
}
