// Les adversaires d'une rencontre tels qu'on les joue : le profil de la rencontre, tel que la balance l'a pesé, complété
// par le bestiaire, et le numéro de chacun, celui de son pion sur le plan. Partagé par la feuille de combat à imprimer
// et le suivi du combat.

import { CREATURES, GENS, RANGS } from "./bestiaire.js";
import { santeAdversaire } from "./simulation.js";

const CATALOGUE = [...RANGS, ...CREATURES, ...GENS];

export const plat = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Le profil d'un adversaire : celui de la rencontre, et pour ce qu'elle ne dit pas, celui du bestiaire (ou de son rang).
export function profil(a) {
  const base = CATALOGUE.find((x) => x.cle === a.cle) || RANGS.find((x) => x.cle === a.rang) || {};
  return { ...base, ...a };
}

// 1 si le pion est celui de l'adversaire sous le même nom, 2 si son nom commence pareil (« Vadim, dit le Pinson »
// pour « Vadim »), 0 sinon. Un pion posé depuis la rencontre porte bestiaire:<clé> ; un PNJ du carnet, pnj:<id>.
export function accord(t, a) {
  if (![`bestiaire:${a.cle}`, a.cle, `pnj:${a.cle}`].includes(t.ref)) return 0;
  const nom = plat(a.nom);
  const sien = plat(t.nom);
  if (sien === nom) return 1;
  return nom && sien.startsWith(nom) && !/[a-z0-9]/.test(sien[nom.length]) ? 2 : 0;
}

// Les pions du plan pour chaque adversaire, dans l'ordre du plan : un pion ne sert qu'une fois, un nom exact passe
// avant un nom qui commence pareil.
export function pionsDe(r, plan) {
  const pris = new Set();
  return (r.adversaires || []).map((a) => {
    const candidats = (plan?.pions || []).map((t, i) => ({ t, i, juste: accord(t, a) })).filter((c) => c.juste && !pris.has(c.i));
    const siens = candidats.sort((x, y) => x.juste - y.juste || x.i - y.i).slice(0, Math.max(0, a.n || 0));
    for (const c of siens) pris.add(c.i);
    return siens.sort((x, y) => x.i - y.i).map((c) => c.t);
  });
}

// Le plan où la rencontre est posée : celui qui porte le plus de ses adversaires ; à égalité, celui qui porte son nom.
export function planDe(r, plans) {
  let meilleur = null;
  let score = 0;
  for (const p of plans) {
    const n = pionsDe(r, p).reduce((t, liste) => t + liste.length, 0);
    if (n > score || (n && n === score && p.id === r.id)) {
      meilleur = p;
      score = n;
    }
  }
  return meilleur;
}

// Les adversaires de la rencontre, chacun avec ses combattants et le numéro de leur pion (sinon 1, 2, 3 dans l'ordre).
export function groupes(r, plan, nbPj, niveau) {
  const pions = pionsDe(r, plan);
  return (r.adversaires || []).map((brut, i) => {
    const a = profil(brut);
    const n = Math.max(0, a.n || 0);
    const { sante, parPJ } = santeAdversaire(a.sante, nbPj, niveau);
    const membres = Array.from({ length: n }, (_, k) => ({ numero: String(pions[i][k]?.court || "").trim() || (n > 1 ? String(k + 1) : "") }));
    return { a, membres, sante, parPJ, depuisPlan: pions[i].length > 0 };
  }).filter((g) => g.membres.length);
}
