// L'onglet où s'ouvre une séance sans onglet dans l'adresse : le dernier vu depuis moins de trois heures, sinon Jouer
// le jour où on la joue (seance-en-cours.js), sinon Préparer. Retenu sur ce navigateur seulement.

import { seanceDuJour } from "./seance-en-cours.js";

const CLE = "seances.onglets";
const DUREE = 3 * 3600 * 1000;
const ONGLETS = ["preparer", "jouer", "clore"];

function lire() {
  try {
    const vus = JSON.parse(localStorage.getItem(CLE) || "{}");
    return vus && typeof vus === "object" ? vus : {};
  } catch {
    return {}; // navigation privée : rien de retenu
  }
}

export function ongletOuvrant(s, maintenant = Date.now()) {
  if (!s) return "preparer";
  const vu = lire()[s.id];
  if (vu && ONGLETS.includes(vu.onglet) && maintenant - (+vu.quand || 0) < DUREE) return vu.onglet;
  return seanceDuJour(s) ? "jouer" : "preparer";
}

export function retenirOnglet(s, onglet, maintenant = Date.now()) {
  if (!s || !ONGLETS.includes(onglet)) return;
  const vus = lire();
  // Les séances vues il y a plus de trois heures s'oublient : la liste reste courte.
  for (const [id, vu] of Object.entries(vus)) if (!(maintenant - (+vu?.quand || 0) < DUREE)) delete vus[id];
  vus[s.id] = { onglet, quand: maintenant };
  try {
    localStorage.setItem(CLE, JSON.stringify(vus));
  } catch {
    // préférence perdue, sans conséquence
  }
}
