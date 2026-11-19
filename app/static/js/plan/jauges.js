// Les jauges des pions d'un plan dans l'atelier (dessinées par rendu.js) : pour un héros, la part de Santé et de Psy
// qui lui reste, le coma, ses cartons et son jeton d'avantage, lus dans le combat en cours s'il s'y bat, sinon dans son
// état du moment ; pour un adversaire du combat en cours, posé sur ce plan, sa Santé. La TV reçoit celles des héros du
// serveur (jauges_pion), calculées de la même façon.

import { accord } from "../combats/rencontre.js";
import { AVANTAGES, CARACS_CARTON, CARTONS, etatDuMoment, psyDe } from "../combats/suivi.js";

const POSTURES = new Set(["offensive", "defensive", "focus"]);
const part = (v, max) => (max > 0 ? Math.round(Math.max(0, Math.min(1, v / max)) * 100) / 100 : null);

function jaugesHeros(x) {
  return {
    sante: part(x.sante, x.max), psy: part(x.psy, x.psyMax), coma: x.sante <= 0,
    cartons: CARACS_CARTON.filter(([k]) => CARTONS[x.cartons?.[k]]).map(([k]) => ({ carac: k, couleur: x.cartons[k] })),
    avantage: AVANTAGES[x.avantage] ? x.avantage : "",
    posture: POSTURES.has(x.posture) ? x.posture : "",
  };
}

// L'état d'un héros pour les jauges et le tableau : celui du combat s'il s'y bat, sinon son état du moment.
export function etatHerosDuJeu(id, jeu) {
  const fiche = (jeu?.fiches || []).find((a) => a.id === id) || null;
  const h = (jeu?.combat?.heros || []).find((x) => x.id === id);
  if (h) {
    const p = psyDe(h, fiche);
    return { fiche, auCombat: true, max: h.max, sante: h.sante, psy: p.psy, psyMax: p.psyMax, santeDon: p.santeDon, cartons: h.cartons || {}, avantage: h.avantage || "", posture: h.posture };
  }
  if (!fiche) return null;
  return { fiche, auCombat: false, ...etatDuMoment(fiche, jeu?.etats?.[id]), posture: fiche.posture };
}

// Les adversaires du combat posés sur ce plan : même référence (accord de rencontre.js) et même numéro ; un pion ne
// sert qu'une fois. Rend Map id du pion → adversaire.
export function adversairesSurPlan(plan, combat) {
  const r = new Map();
  if (!combat) return r;
  const pris = new Set();
  for (const a of combat.adversaires || []) {
    const t = (plan.pions || []).find((p) => !pris.has(p.id) && accord(p, a) && (!a.numero || String(p.court || "").trim() === a.numero));
    if (t) {
      pris.add(t.id);
      r.set(t.id, a);
    }
  }
  return r;
}

// Les pions qui ont la main dans le combat en cours (Set d'identifiants) : le héros dont c'est le tour, ou les
// adversaires du combat posés sur ce plan, debout, quand c'est aux ennemis. null hors combat.
export function mainDuPlan(plan, combat) {
  const x = combat && Array.isArray(combat.ordre) && Number.isInteger(combat.actif) ? combat.ordre[combat.actif] : null;
  if (!plan || typeof x !== "string") return null;
  if (x === "ennemis") {
    const ids = new Set();
    for (const id of adversairesSurPlan(plan, combat).keys()) if (!(plan.pions || []).some((t) => t.id === id && t.tombe)) ids.add(id);
    return ids;
  }
  return new Set((plan.pions || []).filter((t) => t.ref === x).map((t) => t.id));
}

// Map id du pion → jauges, pour la vue du plan.
export function jaugesDuPlan(plan, jeu) {
  const r = new Map();
  if (!plan || !jeu) return r;
  for (const t of plan.pions || []) {
    const [genre, id] = String(t.ref || "").split(":");
    if (genre !== "aventurier" || !id) continue;
    const x = etatHerosDuJeu(id, jeu);
    if (x) r.set(t.id, jaugesHeros(x));
  }
  for (const [id, a] of adversairesSurPlan(plan, jeu.combat)) {
    r.set(id, { sante: part(a.sante, a.max), psy: null, coma: a.sante <= 0, cartons: [], avantage: "" });
  }
  return r;
}
