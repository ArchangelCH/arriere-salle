// La matière des murs (piece.mur, voir MURS dans modele.js) : pierre, colombage, planches, roche taillée, palissade.
// Sans matière choisie, rien ne change : rendu.js et peint.js dessinent les murs comme avant. Un mur entre deux pièces
// prend la matière de la première de ses deux cases (en haut, ou à gauche) qui en a une.

import { casesArete, murValide } from "./modele.js";
import { motif } from "./textures.js";

// La matière de chaque pièce qui en a une ; null si aucune n'en a (le plan se dessine alors comme avant).
export function matieresDesPieces(p) {
  let res = null;
  for (const pc of p.pieces || []) {
    const m = pc && murValide(pc.mur);
    if (!m) continue;
    if (!res) res = new Map();
    res.set(pc.id, m);
  }
  return res;
}

// La matière d'une arête : celle de sa première case (en haut ou à gauche) qui en a une, sinon "". vu(i) : pour la vue
// des joueurs, une case cachée ne donne pas la matière de sa pièce.
export function matiereArete(p, matieres, sens, x, y, vu = null) {
  if (!matieres) return "";
  const w = p.largeur;
  for (const [cx, cy] of casesArete(sens, x, y)) {
    if (cx < 0 || cy < 0 || cx >= w || cy >= p.hauteur) continue;
    const i = cy * w + cx;
    if (!p.sol[i] || (vu && !vu(i))) continue;
    const m = matieres.get(p.piece[i]);
    if (m) return m;
  }
  return "";
}

function segment(ctx, sens, x, y, e) {
  if (sens === "h") ctx.rect(x - e / 2, y - e / 2, 1 + e, e);
  else ctx.rect(x - e / 2, y - e / 2, e, 1 + e);
}

// Les rondins d'une palissade, le long d'une arête.
function rondins(ctx, sens, x, y, r) {
  for (let t = 0; t <= 1.001; t += 0.2) {
    const [cx, cy] = sens === "h" ? [x + t, y] : [x, y + t];
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
}

const COULEURS = { pierre: "#3a3028", torchis: "#6a5844", bois: "#4b2f1a", roche: "#29231e", palissade: "#4a301a" };

// Couleur et parchemin : les murs droits d'une matière choisie, après l'ombre commune. aretes : [sens, x, y].
export function dessinerMursMatiere(ctx, mat, aretes, c, parchemin, e) {
  if (mat === "palissade") {
    ctx.beginPath();
    for (const a of aretes) rondins(ctx, ...a, e * 0.55);
    ctx.fillStyle = parchemin ? "#f3e9d2" : "#8b5a2e";
    ctx.fill();
    ctx.strokeStyle = c.mur;
    ctx.lineWidth = parchemin ? 0.035 : 0.03;
    ctx.stroke();
    return;
  }
  ctx.fillStyle = parchemin ? c.mur : COULEURS[mat] || c.mur;
  ctx.beginPath();
  for (const a of aretes) segment(ctx, ...a, e);
  ctx.fill();
  if (parchemin) return;
  // Un fil clair le long du mur : le bois des planches, les poutres du colombage.
  if (mat === "bois" || mat === "torchis") {
    ctx.strokeStyle = mat === "bois" ? "rgba(200,150,90,.35)" : "rgba(40,24,12,.7)";
    ctx.lineWidth = mat === "bois" ? 0.02 : 0.05;
    ctx.beginPath();
    for (const [sens, x, y] of aretes) {
      for (const d of mat === "bois" ? [-e / 4, e / 4] : [0]) {
        if (sens === "h") {
          ctx.moveTo(x - e / 2, y + d);
          ctx.lineTo(x + 1 + e / 2, y + d);
        } else {
          ctx.moveTo(x + d, y - e / 2);
          ctx.lineTo(x + d, y + 1 + e / 2);
        }
      }
    }
    ctx.stroke();
  }
}

// La couleur d'un mur sous une fenêtre (rendu.js la repeint dessous).
export const couleurMur = (mat, c, parchemin) => (parchemin || !COULEURS[mat] ? c.mur : COULEURS[mat]);

// ---------------------------------------------------------------- style peint

// La matière d'un pan peint (peint.js, pansDeMurs) pour une matière choisie : la pierre garde ses deux épaisseurs
// (dehors, cloison), les autres se dessinent ici.
export function matierePeinte(mur, dehors) {
  if (mur === "pierre") return dehors ? "pierre" : "cloison";
  return { torchis: "torchis", bois: "planches", roche: "taillee", palissade: "palissade" }[mur] || null;
}
export const MATIERES_PEINTES = new Set(["torchis", "planches", "taillee", "palissade"]);

// Les pans de planches, de roche taillée et de palissade (le colombage choisi se dessine avec celui d'avant, peint.js).
export function peindreMursPlus(ctx, liste, S, hautes) {
  const lw = 0.03;
  for (const mat of ["planches", "taillee", "palissade"]) {
    const pans = liste[mat];
    if (!pans || !pans.length) continue;
    const chemin = new Path2D();
    for (const pn of pans) chemin.rect(...pn.r);
    if (mat === "palissade") {
      // Une file de rondins serrés, leur bout taillé plus clair.
      const bouts = new Path2D();
      const coeurs = new Path2D();
      for (const pn of pans) {
        const [x, y, w, h] = pn.r;
        const e = Math.min(w, h);
        const r = e * 0.5;
        const L = Math.max(w, h);
        const n = Math.max(1, Math.round(L / (r * 1.8)));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          const [cx, cy] = pn.sens === "h" ? [x + w * t, y + h / 2] : [x + w / 2, y + h * t];
          const rr = r * (0.9 + 0.12 * Math.sin(k * 2.3 + cx + cy));
          bouts.moveTo(cx + rr, cy);
          bouts.arc(cx, cy, rr, 0, Math.PI * 2);
          coeurs.moveTo(cx + rr * 0.45, cy);
          coeurs.arc(cx, cy, rr * 0.45, 0, Math.PI * 2);
        }
      }
      ctx.fillStyle = "#3a2414";
      ctx.fill(chemin);
      ctx.fillStyle = "#8a5c34";
      ctx.fill(bouts);
      ctx.strokeStyle = "rgba(24,14,6,.85)";
      ctx.lineWidth = lw;
      ctx.stroke(bouts);
      ctx.fillStyle = "rgba(214,170,112,.55)";
      ctx.fill(coeurs);
      continue;
    }
    ctx.strokeStyle = "rgba(24,16,8,.85)";
    ctx.lineWidth = lw * 2;
    ctx.stroke(chemin);
    if (mat === "taillee") {
      ctx.fillStyle = motif(ctx, "roche", S, hautes);
      ctx.fill(chemin);
      ctx.fillStyle = "rgba(20,16,12,.28)";
      ctx.fill(chemin);
      continue;
    }
    // Planches : des madriers posés le long du mur, joints sombres, bouts sciés à chaque case.
    ctx.fillStyle = "#5e3b1f";
    ctx.fill(chemin);
    ctx.strokeStyle = "rgba(20,10,4,.6)";
    ctx.lineWidth = 0.014;
    ctx.beginPath();
    for (const pn of pans) {
      const [x, y, w, h] = pn.r;
      for (const f of [1 / 3, 2 / 3]) {
        if (pn.sens === "h") {
          ctx.moveTo(x, y + h * f);
          ctx.lineTo(x + w, y + h * f);
        } else {
          ctx.moveTo(x + w * f, y);
          ctx.lineTo(x + w * f, y + h);
        }
      }
      for (let t = pn.de + 1; t < pn.a; t++) {
        if (pn.sens === "h") {
          ctx.moveTo(t, y);
          ctx.lineTo(t, y + h);
        } else {
          ctx.moveTo(x, t);
          ctx.lineTo(x + w, t);
        }
      }
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,220,170,.14)";
    ctx.lineWidth = 0.012;
    ctx.beginPath();
    for (const pn of pans) {
      const [x, y, w, h] = pn.r;
      if (pn.sens === "h") {
        ctx.moveTo(x, y + h * 0.16);
        ctx.lineTo(x + w, y + h * 0.16);
      } else {
        ctx.moveTo(x + w * 0.16, y);
        ctx.lineTo(x + w * 0.16, y + h);
      }
    }
    ctx.stroke();
  }
}
