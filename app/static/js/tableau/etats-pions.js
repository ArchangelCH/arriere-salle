// Les états des pions dans le Tableau : ceux du pion d'un héros ou d'un adversaire sur le plan ouvert, en petites
// pastilles nommées, à côté de son nom. Ils se posent sur le plan (panneau du pion) ; le Tableau ne fait que les lire.

import { echapper as e } from "../api.js";
import { etatsDuPion, nomEtat, vignetteEtat } from "../plan/pions.js";

export function htmlEtatsPion(t) {
  if (!t) return "";
  const liste = etatsDuPion(t);
  if (!liste.length) return "";
  return `<span class="tc-etats">${liste.map((cle) => `<span title="${e(nomEtat(cle))}"><img src="${vignetteEtat(cle)}" alt="">${e(nomEtat(cle))}</span>`).join("")}</span>`;
}

// Le pion d'un héros sur le plan ouvert, s'il y est.
export const pionDuHeros = (plan, id) => (plan?.pions || []).find((t) => t.ref === `aventurier:${id}`) || null;
