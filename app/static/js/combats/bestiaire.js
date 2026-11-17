// Le bestiaire : les rangs de combat (des règles), et les créatures et gens de la campagne (campagne/bestiaire.js, relayés
// ici). Ce que la simulation sait jouer est codé (régénération, attaques multiples, meute…) ; le reste est rappelé au MJ
// dans « capacites ».

import { CREATURES, GENS, TITRES_BESTIAIRE } from "../campagne/bestiaire.js";

export { CREATURES, GENS, TITRES_BESTIAIRE };

export const RANGS = [
  { cle: "sbire", nom: "Sbire", rang: "sbire", att: 45, degats: "1D6", armure: 0, sante: "5", defense: 0, nbDef: 0 },
  { cle: "soldat", nom: "Soldat", rang: "soldat", att: 55, degats: "1D8", armure: 1, sante: "10", defense: 0, nbDef: 0 },
  { cle: "elite", nom: "Élite", rang: "elite", att: 65, degats: "1D10", armure: 2, sante: "16", defense: 50, nbDef: 1 },
  { cle: "boss", nom: "Boss", rang: "boss", att: 70, degats: "2D6", armure: 2, sante: "8 × PJ", defense: 50, nbDef: 1, attaques: 2, capacites: "Attaque deux fois par tour." },
];

export const NOMS_RANGS = { sbire: "sbire", soldat: "soldat", elite: "élite", boss: "boss", dragon: "hors rang" };

// La défense écrite dans le carnet : « 1 par tour, 50 % », « aucune », ou une valeur seule (une défense par tour).
// Rien d'écrit : celle du rang.
function lireDefense(texte, rang) {
  const t = String(texte ?? "").trim();
  if (!t) return { defense: rang.defense || 0, nbDef: rang.nbDef || 0 };
  const m = /(\d+)\s*(?:par tour)?\s*[,;:]\s*(\d+)/.exec(t) || /(\d+)\s*par tour\D+(\d+)/.exec(t);
  if (m) return { nbDef: +m[1], defense: +m[2] };
  if (/aucun/i.test(t)) return { defense: 0, nbDef: 0 };
  const k = parseInt(t, 10);
  return Number.isFinite(k) ? { defense: k, nbDef: k ? Math.max(1, rang.nbDef || 0) : 0 } : { defense: rang.defense || 0, nbDef: rang.nbDef || 0 };
}

// Un PNJ du carnet qui a un rang de combat devient un adversaire. Ce que sa fiche ne précise pas vient du rang.
export function depuisPnj(p, rangs = RANGS) {
  const rang = rangs.find((r) => r.cle === p.rang);
  if (!rang) return null;
  const profil = p.profil || {};
  const attaque = String(profil.attaque ?? rang.att);
  const nombre = /×\s*(\d)/.exec(attaque);
  const armure = parseInt(profil.armure, 10);
  return {
    cle: `pnj:${p.id}`, nom: p.nom, rang: rang.rang, att: parseInt(attaque, 10) || rang.att,
    attaques: nombre ? +nombre[1] : rang.attaques || 1,
    degats: profil.degats || rang.degats, armure: Number.isFinite(armure) ? armure : rang.armure || 0,
    sante: String(profil.sante ?? rang.sante), ...lireDefense(profil.defense, rang), capacites: p.capacites || "",
  };
}
