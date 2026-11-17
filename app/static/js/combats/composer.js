// « Composer : Difficile » (balance.js) : une composition d'adversaires dont la simulation tombe sur le niveau demandé pour
// CE groupe. On part du barème du bestiaire (depart), puis on cherche, parmi des compositions simples (un rang principal
// de 1 à 2n+2, complété de figurants d'un rang plus bas, ou un boss seul ou escorté), celles que la simulation range au
// niveau voulu ; la plus proche du barème (même nombre d'adversaires, sinon le moins) l'emporte. Sans exacte, la plus proche.
// Le barème du bestiaire suppose 4 à 6 aventuriers de niveau 1 ; une table en compte souvent moins, parfois plus.

import { RANGS } from "./bestiaire.js";
import { etudier, hasardAGraine, severite, verdict } from "./simulation.js";

const NIVEAUX = ["facile", "normale", "difficile", "epique", "mortelle", "perdue"];

// groupe : les aventuriers au niveau de la balance ; options : celles de la rencontre (avant, style, moral, niveau) ;
// depart : la composition du barème. Rend la liste des adversaires { ...rang, n }.
export function composer(niveau, groupe, options, depart, { combats = 400, graine = 7 } = {}) {
  const nb = groupe.length;
  if (!nb) return depart;
  const r = (cle, k) => ({ ...RANGS.find((x) => x.cle === cle), n: k });
  const maxi = nb * 2 + 2;
  // Le nombre de l'adversaire principal varie de 1 à deMax, complété de 0 à nb figurants d'un rang plus bas.
  const piles = (principal, figurants, deMax = maxi) => {
    const liste = [];
    for (let k = 1; k <= deMax; k++) for (const f of figurants) for (let m = 0; m <= (f ? nb : 0); m++) liste.push([r(principal, k), ...(m ? [r(f, m)] : [])]);
    return liste;
  };
  const candidates = {
    facile: piles("sbire", [null]),
    normale: piles("soldat", [null, "sbire"]),
    difficile: [...piles("elite", [null, "soldat"], nb + 2), ...piles("boss", [null, "sbire", "soldat"], 1)],
    epique: [...piles("boss", [null, "sbire", "soldat", "elite"], 1), ...piles("elite", [null, "soldat"], maxi)],
  }[niveau] || [depart];
  const cible = NIVEAUX.indexOf(niveau);
  const notes = candidates.map((adv) => {
    const res = etudier(groupe, adv, { ...options, hasard: hasardAGraine(graine) }, combats);
    return { adv, ecart: Math.abs(NIVEAUX.indexOf(verdict(res)) - cible), s: severite(res) };
  });
  const total = (adv) => adv.reduce((t, x) => t + x.n, 0);
  const visee = total(depart);
  const justes = notes.filter((x) => x.ecart === 0)
    .sort((x, y) => Math.abs(total(x.adv) - visee) - Math.abs(total(y.adv) - visee) || total(x.adv) - total(y.adv));
  // Un verdict au bord de deux niveaux ne tient pas d'une pesée à l'autre : les meilleurs sont revérifiés sur plus de
  // combats, avec d'autres dés ; le premier qui tient l'emporte.
  const tient = (x) => NIVEAUX.indexOf(verdict(etudier(groupe, x.adv, { ...options, hasard: hasardAGraine(graine + 4) }, combats * 4))) === cible;
  for (const x of justes.slice(0, 8)) if (tient(x)) return x.adv;
  if (justes.length) return justes[0].adv;
  notes.sort((x, y) => x.ecart - y.ecart || Math.abs(x.s - 25) - Math.abs(y.s - 25));
  return notes[0].adv;
}
