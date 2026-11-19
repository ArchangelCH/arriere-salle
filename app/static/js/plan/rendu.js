// Rendu d'un plan intérieur, en cases : le vide, les sols, le quadrillage, le brouillard des joueurs, les murs, les portes,
// le mobilier et les noms ; les pions se posent par-dessus à chaque image. Trois styles : couleur, parchemin (impression)
// et peint (battle map du soir, voir peint.js).

import { texte } from "../carte/rendu.js";
import { COULEURS_PIONS, MEUBLES, SOLS, cacheParLaBrume, cleArete, emprise, hache, objetVisible, porteVisible, reveleA, teinteValide, teintesDesPieces } from "./modele.js";
import { dessinerPlanPeint } from "./peint.js";
import { vignetteMeublePeint } from "./peint-mobilier.js";
import { TEINTE_COULEUR, meublesPlus } from "./mobilier-plus.js";
import { meublesDehors } from "./dehors-dessin.js";
import { couleurMur, dessinerMursMatiere, matiereArete, matieresDesPieces } from "./murs-plus.js";
import { solPlusCouleur, solPlusParchemin } from "./sols-plus.js";
// Lot H2 : les pions enrichis et les images du MJ posées sur le plan.
import { dessinerImagesPlan } from "./images.js";
import { dessinerEtats, dessinerEtiquette, dessinerGroupe, epaisseurDuPion, etatsDuPion, imageDuPion, invisible } from "./pions.js";
// Les pions en figurines sur leur socle (19/11) : leur dessin et la place qu'elles prennent.
import { cernerSocle, dessinerFigurine, dessinerFil, dessinerPoussiere, estFamilier, silhouette } from "./figurine.js";

const ENCRE = "#2b1d12";
const PAPIER = "#f3e9d2";

const PAL = {
  couleur: {
    vide: "#15110d", mur: "#3a3028", ombre: "rgba(0,0,0,.34)", roche: "#261f19", paroi: "#3b322a", brume: "#0f0c0a",
    grille: "rgba(18,11,6,.2)", grilleImage: "rgba(255,248,230,.22)", joint: "rgba(28,18,10,.34)",
    trait: "rgba(26,15,7,.78)", lw: 0.035, bois: "#8b5a2e", boisClair: "#a9763f", boisSombre: "#5a381a", pierre: "#8e877d",
    pierreClair: "#aaa397", pierreSombre: "#5d564d", metal: "#8c9398", tissu: "#8e1b17", tissu2: "#2f4a64", paille: "#c9a55a",
    feu: "#e37626", feuClair: "#ffd27a", eau: "#3e7da3", vert: "#4e6c31", vertClair: "#6f8f45", os: "#e6ddc8", or: "#d8b04a", papier: "#efe3c6",
  },
  parchemin: {
    vide: "rgba(120,88,48,.2)", mur: ENCRE, ombre: null, roche: "rgba(43,29,18,.12)", paroi: ENCRE, brume: "#c7b48e",
    grille: "rgba(43,29,18,.2)", grilleImage: "rgba(43,29,18,.3)", joint: "rgba(43,29,18,.16)",
    trait: ENCRE, lw: 0.045, bois: PAPIER, boisClair: PAPIER, boisSombre: "#d9c9a6", pierre: PAPIER, pierreClair: PAPIER,
    pierreSombre: "#d9c9a6", metal: "#d9c9a6", tissu: "#e2cfa9", tissu2: "#e2cfa9", paille: "#eadbb6", feu: PAPIER, feuClair: PAPIER,
    eau: "#dfe3dd", vert: "#e3dcc0", vertClair: PAPIER, os: PAPIER, or: "#eadbb6", papier: PAPIER,
  },
};

const EP = 0.22; // épaisseur d'un mur, en cases

// Chrome perd des lettres quand une police de moins d'un pixel est agrandie par la transformation : on écrit en 32 px
// et on réduit le contexte.
function ecrire(ctx, chaine, x, y, o) {
  const f = 32;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(o.taille / f, o.taille / f);
  // largeurMax (en cases) : un texte trop large se resserre au lieu de déborder.
  if (o.largeurMax) {
    ctx.font = o.police.replace("{t}", f);
    const l = (ctx.measureText(chaine).width * o.taille) / f;
    if (l > o.largeurMax) ctx.scale(o.largeurMax / l, 1);
  }
  texte(ctx, chaine, 0, 0, { ...o, taille: f });
  ctx.restore();
}

function rrect(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

function rond(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function remplir(ctx, fond, c) {
  ctx.fillStyle = fond;
  ctx.fill();
  ctx.strokeStyle = c.trait;
  ctx.lineWidth = c.lw;
  ctx.stroke();
}

function ligne(ctx, x0, y0, x1, y1) {
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
}

// ---------------------------------------------------------------- sols

// teinte : la couleur choisie pour le sol de la pièce (couleur seulement), à la place de celle du sol.
function dessinerSol(ctx, t, x, y, c, parchemin, teinte) {
  const s = SOLS[t];
  if (!s) return;
  const v = hache(x, y, 1);
  if (parchemin) {
    ctx.fillStyle = "rgba(255,250,236,.55)";
    ctx.fillRect(x, y, 1, 1);
    ctx.strokeStyle = "rgba(43,29,18,.45)";
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    if (s.cle === "eau") {
      ctx.fillStyle = "rgba(120,150,170,.25)";
      ctx.fillRect(x, y, 1, 1);
      for (const k of [0.3, 0.7]) {
        ctx.moveTo(x + 0.15, y + k);
        ctx.quadraticCurveTo(x + 0.3, y + k - 0.08, x + 0.45, y + k);
        ctx.quadraticCurveTo(x + 0.6, y + k + 0.08, x + 0.75, y + k);
      }
    } else if (s.cle === "herbe") {
      for (let k = 0; k < 3; k++) {
        const px = x + 0.2 + hache(x, y, k + 3) * 0.6;
        const py = y + 0.3 + hache(x, y, k + 7) * 0.5;
        ligne(ctx, px, py, px - 0.05, py - 0.12);
        ligne(ctx, px, py, px + 0.05, py - 0.12);
      }
    } else if (s.cle === "paille" || s.cle === "sable" || s.cle === "terre") {
      for (let k = 0; k < 3; k++) {
        const px = x + 0.15 + hache(x, y, k + 3) * 0.7;
        const py = y + 0.15 + hache(x, y, k + 9) * 0.7;
        ctx.moveTo(px, py);
        ctx.arc(px, py, 0.02, 0, Math.PI * 2);
      }
    } else if (s.cle === "plancher") {
      ligne(ctx, x, y + 0.5, x + 1, y + 0.5);
    } else solPlusParchemin(ctx, s.cle, x, y);
    ctx.stroke();
    return;
  }
  ctx.fillStyle = teinte || s.couleur;
  ctx.fillRect(x, y, 1, 1);
  ctx.fillStyle = v < 0.5 ? `rgba(0,0,0,${((0.5 - v) * 0.16).toFixed(3)})` : `rgba(255,255,255,${((v - 0.5) * 0.1).toFixed(3)})`;
  ctx.fillRect(x, y, 1, 1);
  ctx.strokeStyle = c.joint;
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  switch (s.cle) {
    case "pierre": {
      const a = 0.3 + hache(x, y, 2) * 0.4;
      const b = 0.3 + hache(x, y, 3) * 0.4;
      ligne(ctx, x, y + 0.5, x + 1, y + 0.5);
      ligne(ctx, x + a, y, x + a, y + 0.5);
      ligne(ctx, x + b, y + 0.5, x + b, y + 1);
      ligne(ctx, x, y, x + 1, y);
      ligne(ctx, x, y, x, y + 1);
      break;
    }
    case "plancher": {
      for (let k = 0; k < 4; k++) {
        const t2 = hache(x, y * 4 + k, 4);
        ctx.fillStyle = t2 < 0.5 ? `rgba(40,20,5,${(0.5 - t2) * 0.22})` : `rgba(255,235,200,${(t2 - 0.5) * 0.12})`;
        ctx.fillRect(x, y + k * 0.25, 1, 0.25);
        ligne(ctx, x, y + k * 0.25, x + 1, y + k * 0.25);
        if (t2 < 0.35) ligne(ctx, x + 0.2 + t2 * 1.6, y + k * 0.25, x + 0.2 + t2 * 1.6, y + (k + 1) * 0.25);
      }
      break;
    }
    case "paves": {
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const t2 = hache(x * 3 + i, y * 3 + j, 5);
          ctx.fillStyle = t2 < 0.5 ? "rgba(0,0,0,.12)" : "rgba(255,255,255,.07)";
          rrect(ctx, x + i / 3 + 0.03, y + j / 3 + 0.03, 1 / 3 - 0.06, 1 / 3 - 0.06, 0.08);
          ctx.fill();
        }
      }
      ctx.beginPath();
      break;
    }
    case "terre":
    case "sable":
    case "roche": {
      ctx.fillStyle = s.cle === "roche" ? "rgba(0,0,0,.18)" : "rgba(40,24,10,.2)";
      for (let k = 0; k < (s.cle === "roche" ? 2 : 5); k++) {
        const px = x + 0.1 + hache(x, y, k + 3) * 0.8;
        const py = y + 0.1 + hache(x, y, k + 9) * 0.8;
        const r = s.cle === "roche" ? 0.12 + hache(x, y, k) * 0.12 : 0.025;
        ctx.moveTo(px + r, py);
        ctx.arc(px, py, r, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.beginPath();
      if (s.cle === "roche" && v > 0.6) ligne(ctx, x + 0.2, y + 0.3, x + 0.55, y + 0.62);
      break;
    }
    case "herbe": {
      ctx.strokeStyle = "rgba(40,62,22,.55)";
      for (let k = 0; k < 6; k++) {
        const px = x + 0.1 + hache(x, y, k + 3) * 0.8;
        const py = y + 0.15 + hache(x, y, k + 9) * 0.75;
        ligne(ctx, px, py, px + (hache(x, y, k) - 0.5) * 0.12, py - 0.13);
      }
      break;
    }
    case "eau": {
      ctx.strokeStyle = "rgba(210,235,250,.28)";
      ctx.lineWidth = 0.035;
      const k = 0.3 + v * 0.4;
      ctx.moveTo(x + 0.1, y + k);
      ctx.quadraticCurveTo(x + 0.3, y + k - 0.08, x + 0.5, y + k);
      ctx.quadraticCurveTo(x + 0.7, y + k + 0.08, x + 0.9, y + k);
      break;
    }
    case "marbre": {
      if ((x + y) % 2) {
        ctx.fillStyle = "rgba(60,50,40,.16)";
        ctx.fillRect(x, y, 1, 1);
      }
      ctx.strokeStyle = "rgba(90,80,70,.2)";
      if (v > 0.55) {
        ctx.moveTo(x + 0.1, y + v);
        ctx.quadraticCurveTo(x + 0.5, y + 0.2, x + 0.9, y + 1 - v);
      }
      ligne(ctx, x, y, x + 1, y);
      ligne(ctx, x, y, x, y + 1);
      break;
    }
    case "paille": {
      ctx.strokeStyle = "rgba(110,80,20,.45)";
      for (let k = 0; k < 8; k++) {
        const px = x + hache(x, y, k + 3);
        const py = y + hache(x, y, k + 9);
        const a = hache(x, y, k + 20) * Math.PI;
        ligne(ctx, px, py, px + Math.cos(a) * 0.25, py + Math.sin(a) * 0.25);
      }
      break;
    }
    default:
      solPlusCouleur(ctx, s.cle, x, y, c);
  }
  ctx.stroke();
}

// ---------------------------------------------------------------- murs et portes

function segmentMur(ctx, sens, x, y, e = EP) {
  if (sens === "h") ctx.rect(x - e / 2, y - e / 2, 1 + e, e);
  else ctx.rect(x - e / 2, y - e / 2, e, 1 + e);
}

// Une paroi de grotte : ligne brisée dont les sommets tombent aux mêmes endroits d'une arête à l'autre.
function paroi(ctx, sens, x, y) {
  const coin = (cx, cy) => [cx + (hache(cx, cy, 31) - 0.5) * 0.18, cy + (hache(cx, cy, 37) - 0.5) * 0.18];
  const a = coin(x, y);
  const b = sens === "h" ? coin(x + 1, y) : coin(x, y + 1);
  const m = sens === "h"
    ? [x + 0.5 + (hache(x, y, 41) - 0.5) * 0.2, y + (hache(x, y, 43) - 0.5) * 0.26]
    : [x + (hache(x, y, 47) - 0.5) * 0.26, y + 0.5 + (hache(x, y, 53) - 0.5) * 0.2];
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(m[0], m[1]);
  ctx.lineTo(b[0], b[1]);
}

function aretesDeCase(x, y, bits) {
  const a = [];
  if (bits & 1) a.push(["h", x, y]);
  if (bits & 4) a.push(["h", x, y + 1]);
  if (bits & 8) a.push(["v", x, y]);
  if (bits & 2) a.push(["v", x + 1, y]);
  return a;
}

function dessinerPorte(ctx, d, c, parchemin, mj) {
  const h = d.sens === "h";
  const [ax, ay] = [d.x, d.y];
  const long = (t, ep, dec = 0) => (h ? [ax + t, ay - ep / 2 + dec] : [ax - ep / 2 + dec, ay + t]);
  const genre = d.genre === "secrete" && (!mj || d.decouverte) ? "porte" : d.genre;
  ctx.save();
  if (genre === "fenetre") {
    ctx.fillStyle = parchemin ? PAPIER : "#9fc3d8";
    ctx.strokeStyle = c.trait;
    ctx.lineWidth = 0.025;
    const [x, y] = long(0.2, 0.08);
    ctx.beginPath();
    if (h) ctx.rect(x, y, 0.6, 0.08);
    else ctx.rect(x, y, 0.08, 0.6);
    ctx.fill();
    ctx.stroke();
  } else if (genre === "grille") {
    ctx.fillStyle = parchemin ? ENCRE : "#2c2e31";
    for (let k = 0; k < 6; k++) {
      const t = 0.12 + k * 0.152;
      const [x, y] = h ? [ax + t, ay] : [ax, ay + t];
      rond(ctx, x, y, 0.045);
      ctx.fill();
    }
    ctx.strokeStyle = parchemin ? ENCRE : "#2c2e31";
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    if (h) ligne(ctx, ax + 0.1, ay, ax + 0.9, ay);
    else ligne(ctx, ax, ay + 0.1, ax, ay + 0.9);
    ctx.stroke();
  } else if (genre === "secrete") {
    // Vue du MJ : le mur reste, marqué d'un S rouge.
    ctx.setLineDash([0.08, 0.06]);
    ctx.strokeStyle = "#e0584c";
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    if (h) ligne(ctx, ax + 0.15, ay, ax + 0.85, ay);
    else ligne(ctx, ax, ay + 0.15, ax, ay + 0.85);
    ctx.stroke();
    ctx.setLineDash([]);
    ecrire(ctx, "S", h ? ax + 0.5 : ax + 0.22, h ? ay - 0.24 : ay + 0.5, { taille: 0.34, police: "700 {t}px Cinzel", couleur: "#b3261e", halo: "rgba(246,238,219,.9)" });
  } else if (genre !== "arche") {
    const ouverte = d.etat === "ouverte";
    const battants = genre === "double" ? [[0.1, 0.4], [0.5, 0.4]] : [[0.12, 0.76]];
    for (const [t, lg] of battants) {
      ctx.fillStyle = c.boisClair;
      ctx.strokeStyle = c.trait;
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      if (!ouverte) {
        const [x, y] = long(t, 0.12);
        if (h) ctx.rect(x, y, lg, 0.12);
        else ctx.rect(x, y, 0.12, lg);
        ctx.fill();
        ctx.stroke();
      } else {
        // Battant ouvert à angle droit, charnière au bout, avec l'arc de son ouverture.
        const pivot = genre === "double" && t > 0.3 ? t + lg : t;
        const signe = genre === "double" && t > 0.3 ? -1 : 1;
        const [px, py] = h ? [ax + pivot, ay] : [ax, ay + pivot];
        if (h) ctx.rect(px - (signe < 0 ? 0.12 : 0), py, 0.12, lg);
        else ctx.rect(px, py - (signe < 0 ? 0.12 : 0), lg, 0.12);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.setLineDash([0.05, 0.05]);
        ctx.lineWidth = 0.02;
        if (h) ctx.arc(px, py, lg, signe > 0 ? 0 : Math.PI / 2, signe > 0 ? Math.PI / 2 : Math.PI);
        else ctx.arc(px, py, lg, signe > 0 ? 0 : -Math.PI / 2, signe > 0 ? Math.PI / 2 : 0, signe < 0);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (mj && d.etat === "verrouillee") {
      const [x, y] = h ? [ax + 0.5, ay + 0.26] : [ax + 0.26, ay + 0.5];
      ctx.fillStyle = "#b3261e";
      ctx.beginPath();
      ctx.rect(x - 0.08, y - 0.02, 0.16, 0.12);
      ctx.fill();
      ctx.strokeStyle = "#b3261e";
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      ctx.arc(x, y - 0.02, 0.05, Math.PI, 0);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- mobilier

function flamme(ctx, x, y, r, c, parchemin) {
  if (!parchemin) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
    g.addColorStop(0, "rgba(255,190,90,.45)");
    g.addColorStop(1, "rgba(255,150,60,0)");
    ctx.fillStyle = g;
    rond(ctx, x, y, r * 2.4);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + r, y, x, y + r * 0.8);
  ctx.quadraticCurveTo(x - r, y, x, y - r);
  remplir(ctx, c.feu, c);
  if (!parchemin) {
    rond(ctx, x, y + r * 0.2, r * 0.4);
    ctx.fillStyle = c.feuClair;
    ctx.fill();
  }
}

const MEUBLE = {
  table(ctx, hw, hh, c) {
    rrect(ctx, -hw + 0.08, -hh + 0.12, hw * 2 - 0.16, hh * 2 - 0.24, 0.08);
    remplir(ctx, c.bois, c);
    ctx.beginPath();
    ctx.strokeStyle = c.trait;
    ctx.lineWidth = 0.018;
    const long = hw >= hh;
    for (const k of [-1 / 3, 1 / 3]) {
      if (long) ligne(ctx, -hw + 0.12, k * (hh - 0.12), hw - 0.12, k * (hh - 0.12));
      else ligne(ctx, k * (hw - 0.12), -hh + 0.12, k * (hw - 0.12), hh - 0.12);
    }
    ctx.stroke();
  },
  "table-ronde"(ctx, hw, hh, c) {
    const r = Math.min(hw, hh) - 0.1;
    rond(ctx, 0, 0, r);
    remplir(ctx, c.bois, c);
    rond(ctx, 0, 0, r * 0.7);
    ctx.lineWidth = 0.015;
    ctx.stroke();
  },
  chaise(ctx, hw, hh, c) {
    rrect(ctx, -0.2, -0.16, 0.4, 0.38, 0.05);
    remplir(ctx, c.bois, c);
    rrect(ctx, -0.22, -0.3, 0.44, 0.1, 0.03);
    remplir(ctx, c.boisSombre, c);
  },
  banc(ctx, hw, hh, c) {
    const long = hw >= hh;
    if (long) rrect(ctx, -hw + 0.08, -0.15, hw * 2 - 0.16, 0.3, 0.05);
    else rrect(ctx, -0.15, -hh + 0.08, 0.3, hh * 2 - 0.16, 0.05);
    remplir(ctx, c.bois, c);
  },
  comptoir(ctx, hw, hh, c) {
    rrect(ctx, -hw + 0.02, -hh + 0.1, hw * 2 - 0.04, hh * 2 - 0.2, 0.06);
    remplir(ctx, c.boisSombre, c);
    ctx.beginPath();
    const long = hw >= hh;
    if (long) ctx.rect(-hw + 0.08, -hh + 0.16, hw * 2 - 0.16, 0.14);
    else ctx.rect(-hw + 0.16, -hh + 0.08, 0.14, hh * 2 - 0.16);
    ctx.fillStyle = c.boisClair;
    ctx.fill();
    for (const k of [-0.5, 0.3]) {
      const [x, y] = long ? [k * hw, 0.06] : [0.06, k * hh];
      rond(ctx, x, y, 0.09);
      remplir(ctx, c.metal, c);
    }
  },
  tonneau(ctx, hw, hh, c) {
    rond(ctx, 0, 0, 0.38);
    remplir(ctx, c.bois, c);
    ctx.lineWidth = 0.03;
    ctx.strokeStyle = c.trait;
    rond(ctx, 0, 0, 0.3);
    ctx.stroke();
    rond(ctx, 0, 0, 0.14);
    ctx.stroke();
  },
  caisse(ctx, hw, hh, c) {
    ctx.beginPath();
    ctx.rect(-0.35, -0.35, 0.7, 0.7);
    remplir(ctx, c.boisClair, c);
    ctx.beginPath();
    ctx.lineWidth = 0.025;
    ligne(ctx, -0.35, -0.35, 0.35, 0.35);
    ligne(ctx, 0.35, -0.35, -0.35, 0.35);
    ctx.rect(-0.28, -0.28, 0.56, 0.56);
    ctx.stroke();
  },
  etagere(ctx, hw, hh, c) {
    const long = hw >= hh;
    const [w, h] = long ? [hw * 2 - 0.1, 0.34] : [0.34, hh * 2 - 0.1];
    ctx.beginPath();
    ctx.rect(-w / 2, long ? -hh + 0.06 : -h / 2, w, h);
    remplir(ctx, c.boisSombre, c);
    const n = Math.round((long ? w : h) / 0.14);
    for (let k = 0; k < n; k++) {
      const t = -((long ? w : h) / 2) + 0.06 + k * 0.14;
      ctx.beginPath();
      if (long) ctx.rect(t, -hh + 0.1, 0.09, 0.26);
      else ctx.rect(-0.13, t, 0.26, 0.09);
      ctx.fillStyle = [c.tissu, c.tissu2, c.papier, c.vert][k % 4];
      ctx.fill();
    }
  },
  lit(ctx, hw, hh, c) {
    rrect(ctx, -hw + 0.08, -hh + 0.06, hw * 2 - 0.16, hh * 2 - 0.12, 0.06);
    remplir(ctx, c.bois, c);
    ctx.beginPath();
    ctx.rect(-hw + 0.14, -hh + 0.55, hw * 2 - 0.28, hh * 2 - 0.66);
    remplir(ctx, c.tissu2, c);
    rrect(ctx, -hw + 0.2, -hh + 0.14, hw * 2 - 0.4, 0.3, 0.08);
    remplir(ctx, c.papier, c);
  },
  cheminee(ctx, hw, hh, c, parchemin) {
    ctx.beginPath();
    ctx.rect(-hw + 0.02, -hh + 0.04, hw * 2 - 0.04, hh * 2 - 0.08);
    remplir(ctx, c.pierreSombre, c);
    rrect(ctx, -hw + 0.3, -hh + 0.2, hw * 2 - 0.6, hh * 2 - 0.36, 0.1);
    remplir(ctx, parchemin ? PAPIER : "#231a14", c);
    flamme(ctx, 0, 0.05, 0.16, c, parchemin);
  },
  coffre(ctx, hw, hh, c) {
    rrect(ctx, -0.36, -0.26, 0.72, 0.52, 0.06);
    remplir(ctx, c.bois, c);
    for (const x of [-0.2, 0.2]) {
      ctx.beginPath();
      ctx.rect(x - 0.03, -0.26, 0.06, 0.52);
      ctx.fillStyle = c.or;
      ctx.fill();
    }
    rond(ctx, 0, 0.02, 0.05);
    remplir(ctx, c.metal, c);
  },
  tapis(ctx, hw, hh, c) {
    ctx.beginPath();
    ctx.rect(-hw + 0.1, -hh + 0.1, hw * 2 - 0.2, hh * 2 - 0.2);
    remplir(ctx, c.tissu, c);
    ctx.beginPath();
    ctx.rect(-hw + 0.22, -hh + 0.22, hw * 2 - 0.44, hh * 2 - 0.44);
    ctx.strokeStyle = c.or;
    ctx.lineWidth = 0.04;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -hh * 0.5);
    ctx.lineTo(hw * 0.5, 0);
    ctx.lineTo(0, hh * 0.5);
    ctx.lineTo(-hw * 0.5, 0);
    ctx.closePath();
    ctx.stroke();
  },
  four(ctx, hw, hh, c, parchemin) {
    rrect(ctx, -0.4, -0.4, 0.8, 0.8, 0.3);
    remplir(ctx, c.pierreSombre, c);
    rrect(ctx, -0.2, -0.05, 0.4, 0.3, 0.15);
    remplir(ctx, parchemin ? PAPIER : "#231a14", c);
    flamme(ctx, 0, 0.1, 0.09, c, parchemin);
  },
  etabli(ctx, hw, hh, c) {
    MEUBLE.table(ctx, hw, hh, c);
    ctx.beginPath();
    ctx.rect(-hw * 0.5, -0.08, 0.3, 0.08);
    ctx.fillStyle = c.metal;
    ctx.fill();
    rond(ctx, hw * 0.4, 0.05, 0.07);
    ctx.fill();
  },
  enclume(ctx, hw, hh, c) {
    ctx.beginPath();
    ctx.moveTo(-0.38, -0.12);
    ctx.lineTo(0.24, -0.12);
    ctx.quadraticCurveTo(0.42, -0.1, 0.42, 0);
    ctx.lineTo(0.2, 0.1);
    ctx.lineTo(0.2, 0.22);
    ctx.lineTo(-0.22, 0.22);
    ctx.lineTo(-0.22, 0.1);
    ctx.lineTo(-0.38, 0.06);
    ctx.closePath();
    remplir(ctx, c.pierreSombre, c);
  },
  "planche-contrats"(ctx, hw, hh, c) {
    const long = hw >= hh;
    const [w, h] = long ? [hw * 2 - 0.2, 0.26] : [0.26, hh * 2 - 0.2];
    ctx.beginPath();
    ctx.rect(-w / 2, long ? -hh + 0.06 : -h / 2, w, h);
    remplir(ctx, c.bois, c);
    for (let k = 0; k < 4; k++) {
      const t = -((long ? w : h) / 2) + 0.12 + k * ((long ? w : h) - 0.24) / 3;
      ctx.save();
      ctx.translate(long ? t : 0, long ? -hh + 0.19 : t);
      ctx.rotate((hache(k, 3, 7) - 0.5) * 0.4);
      ctx.beginPath();
      ctx.rect(-0.1, -0.09, 0.2, 0.18);
      remplir(ctx, c.papier, c);
      ctx.restore();
    }
  },
  bouclier(ctx, hw, hh, c) {
    rond(ctx, 0, -0.2, 0.26);
    remplir(ctx, c.bois, c);
    rond(ctx, 0, -0.2, 0.08);
    remplir(ctx, c.metal, c);
    ctx.beginPath();
    ctx.strokeStyle = c.trait;
    ctx.lineWidth = 0.02;
    ligne(ctx, -0.14, -0.36, -0.05, -0.28);
    ctx.stroke();
  },
  escalier(ctx, hw, hh, c, parchemin, bas = false) {
    const long = hh >= hw;
    ctx.beginPath();
    ctx.rect(-hw + 0.06, -hh + 0.06, hw * 2 - 0.12, hh * 2 - 0.12);
    if (!parchemin) {
      const g = long ? ctx.createLinearGradient(0, -hh, 0, hh) : ctx.createLinearGradient(-hw, 0, hw, 0);
      g.addColorStop(0, bas ? c.pierreClair : c.pierreSombre);
      g.addColorStop(1, bas ? "#2a241f" : c.pierreClair);
      ctx.fillStyle = g;
    } else ctx.fillStyle = PAPIER;
    ctx.fill();
    ctx.strokeStyle = c.trait;
    ctx.lineWidth = c.lw;
    ctx.stroke();
    ctx.beginPath();
    ctx.lineWidth = 0.025;
    const n = Math.round((long ? hh : hw) * 2 / 0.25);
    for (let k = 1; k < n; k++) {
      const t = -(long ? hh : hw) + 0.06 + k * ((long ? hh : hw) * 2 - 0.12) / n;
      if (long) ligne(ctx, -hw + 0.06, t, hw - 0.06, t);
      else ligne(ctx, t, -hh + 0.06, t, hh - 0.06);
    }
    ctx.stroke();
    // Flèche : vers le haut du dessin pour monter, vers le bas pour descendre.
    ctx.beginPath();
    ctx.fillStyle = parchemin ? ENCRE : "rgba(250,240,220,.85)";
    const s = bas ? 1 : -1;
    if (long) {
      ctx.moveTo(0, s * (hh - 0.3));
      ctx.lineTo(-0.15, s * (hh - 0.55));
      ctx.lineTo(0.15, s * (hh - 0.55));
    } else {
      ctx.moveTo(s * (hw - 0.3), 0);
      ctx.lineTo(s * (hw - 0.55), -0.15);
      ctx.lineTo(s * (hw - 0.55), 0.15);
    }
    ctx.closePath();
    ctx.fill();
  },
  "escalier-bas"(ctx, hw, hh, c, parchemin) {
    MEUBLE.escalier(ctx, hw, hh, c, parchemin, true);
  },
  trappe(ctx, hw, hh, c) {
    ctx.beginPath();
    ctx.rect(-0.34, -0.34, 0.68, 0.68);
    remplir(ctx, c.boisSombre, c);
    ctx.beginPath();
    ctx.lineWidth = 0.02;
    for (const k of [-0.11, 0.11]) ligne(ctx, k, -0.34, k, 0.34);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0.18, 0, 0.07, 0, Math.PI * 2);
    ctx.strokeStyle = c.metal;
    ctx.lineWidth = 0.035;
    ctx.stroke();
  },
  echelle(ctx, hw, hh, c) {
    ctx.beginPath();
    ctx.strokeStyle = c.trait;
    ctx.lineWidth = 0.05;
    ligne(ctx, -0.18, -0.42, -0.18, 0.42);
    ligne(ctx, 0.18, -0.42, 0.18, 0.42);
    for (let k = -3; k <= 3; k++) ligne(ctx, -0.18, k * 0.12, 0.18, k * 0.12);
    ctx.stroke();
  },
  puits(ctx, hw, hh, c) {
    rond(ctx, 0, 0, 0.42);
    remplir(ctx, c.pierre, c);
    rond(ctx, 0, 0, 0.27);
    remplir(ctx, c.eau, c);
  },
  arbre(ctx, hw, hh, c, parchemin) {
    const r = Math.min(hw, hh);
    const pts = [[0, 0, 0.62], [-0.3, -0.22, 0.42], [0.32, -0.18, 0.4], [0.2, 0.3, 0.42], [-0.28, 0.26, 0.4]];
    for (const [x, y, k] of pts) {
      rond(ctx, x * r, y * r, k * r);
      ctx.fillStyle = c.vert;
      ctx.fill();
    }
    ctx.beginPath();
    for (const [x, y, k] of pts) ctx.arc(x * r, y * r, k * r, 0, Math.PI * 2);
    ctx.strokeStyle = c.trait;
    ctx.lineWidth = c.lw;
    if (parchemin) ctx.stroke();
    if (!parchemin) {
      rond(ctx, -0.18 * r, -0.2 * r, 0.25 * r);
      ctx.fillStyle = "rgba(170,200,110,.35)";
      ctx.fill();
    }
  },
  stalle(ctx, hw, hh, c) {
    ctx.beginPath();
    ctx.rect(-hw + 0.1, -hh + 0.1, hw * 2 - 0.2, hh * 2 - 0.2);
    ctx.fillStyle = c.paille;
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = c.boisSombre;
    ctx.lineWidth = 0.1;
    ctx.moveTo(-hw + 0.08, hh - 0.1);
    ctx.lineTo(-hw + 0.08, -hh + 0.08);
    ctx.lineTo(hw - 0.08, -hh + 0.08);
    ctx.lineTo(hw - 0.08, hh - 0.1);
    ctx.stroke();
  },
  foin(ctx, hw, hh, c) {
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.4, 0.3, 0.3, 0, Math.PI * 2);
    remplir(ctx, c.paille, c);
    ctx.beginPath();
    ctx.lineWidth = 0.015;
    for (let k = 0; k < 6; k++) ligne(ctx, -0.25 + k * 0.1, -0.15, -0.2 + k * 0.1, 0.18);
    ctx.stroke();
  },
  charrette(ctx, hw, hh, c) {
    ctx.beginPath();
    ctx.rect(-hw + 0.25, -hh + 0.2, hw * 2 - 0.5, hh * 2 - 0.9);
    remplir(ctx, c.bois, c);
    for (const x of [-hw + 0.1, hw - 0.22]) {
      ctx.beginPath();
      ctx.rect(x, -0.3, 0.12, 0.6);
      remplir(ctx, c.boisSombre, c);
    }
    ctx.beginPath();
    ctx.strokeStyle = c.trait;
    ctx.lineWidth = 0.05;
    ligne(ctx, -0.25, hh - 0.7, -0.25, hh - 0.05);
    ligne(ctx, 0.25, hh - 0.7, 0.25, hh - 0.05);
    ctx.stroke();
  },
  autel(ctx, hw, hh, c) {
    ctx.beginPath();
    ctx.rect(-hw + 0.08, -hh + 0.14, hw * 2 - 0.16, hh * 2 - 0.28);
    remplir(ctx, c.pierreClair, c);
    ctx.beginPath();
    const long = hw >= hh;
    if (long) ctx.rect(-0.25, -hh + 0.14, 0.5, hh * 2 - 0.28);
    else ctx.rect(-hw + 0.08, -0.25, hw * 2 - 0.16, 0.5);
    ctx.fillStyle = c.tissu;
    ctx.fill();
    for (const k of [-0.6, 0.6]) {
      const [x, y] = long ? [k * hw, 0] : [0, k * hh];
      rond(ctx, x, y, 0.05);
      ctx.fillStyle = c.or;
      ctx.fill();
    }
  },
  statue(ctx, hw, hh, c, parchemin) {
    ctx.beginPath();
    ctx.rect(-0.4, -0.4, 0.8, 0.8);
    remplir(ctx, c.pierreSombre, c);
    rond(ctx, 0, 0, 0.26);
    remplir(ctx, c.pierreClair, c);
    rond(ctx, 0, -0.04, 0.1);
    remplir(ctx, parchemin ? PAPIER : "#c4bdb0", c);
  },
  colonne(ctx, hw, hh, c) {
    rond(ctx, 0, 0, 0.36);
    remplir(ctx, c.pierre, c);
    rond(ctx, 0, 0, 0.26);
    ctx.lineWidth = 0.02;
    ctx.stroke();
  },
  sarcophage(ctx, hw, hh, c) {
    const long = hh >= hw;
    ctx.save();
    if (!long) ctx.rotate(Math.PI / 2);
    const L = Math.max(hw, hh);
    ctx.beginPath();
    ctx.moveTo(-0.26, -L + 0.1);
    ctx.lineTo(0.26, -L + 0.1);
    ctx.lineTo(0.34, -L + 0.55);
    ctx.lineTo(0.22, L - 0.1);
    ctx.lineTo(-0.22, L - 0.1);
    ctx.lineTo(-0.34, -L + 0.55);
    ctx.closePath();
    remplir(ctx, c.pierreClair, c);
    ctx.beginPath();
    ctx.lineWidth = 0.03;
    ligne(ctx, 0, -L + 0.3, 0, L - 0.35);
    ligne(ctx, -0.16, -L + 0.65, 0.16, -L + 0.65);
    ctx.stroke();
    ctx.restore();
  },
  ossements(ctx, hw, hh, c) {
    ctx.strokeStyle = c.os;
    ctx.lineCap = "round";
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ligne(ctx, -0.3, 0.2, 0.1, 0.05);
    ligne(ctx, -0.1, 0.3, 0.3, 0.28);
    ligne(ctx, 0.05, -0.25, 0.3, -0.05);
    ctx.stroke();
    ctx.lineCap = "butt";
    rond(ctx, -0.18, -0.18, 0.13);
    remplir(ctx, c.os, c);
  },
  brasero(ctx, hw, hh, c, parchemin) {
    rond(ctx, 0, 0, 0.3);
    remplir(ctx, c.metal, c);
    flamme(ctx, 0, 0, 0.16, c, parchemin);
  },
  cage(ctx, hw, hh, c) {
    ctx.beginPath();
    ctx.rect(-0.38, -0.38, 0.76, 0.76);
    ctx.strokeStyle = c.trait;
    ctx.lineWidth = 0.05;
    ctx.stroke();
    ctx.beginPath();
    ctx.lineWidth = 0.025;
    for (let k = -2; k <= 2; k++) ligne(ctx, k * 0.13, -0.38, k * 0.13, 0.38);
    ctx.stroke();
  },
  rochers(ctx, hw, hh, c) {
    for (const [x, y, r] of [[-0.12, 0.05, 0.26], [0.2, -0.12, 0.18], [0.16, 0.24, 0.13]]) {
      ctx.beginPath();
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const rr = r * (0.8 + hache(k, Math.round(x * 10), 11) * 0.35);
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        if (k) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
      remplir(ctx, c.pierreSombre, c);
    }
  },
  "gros-rocher"(ctx, hw, hh, c) {
    const r = Math.min(hw, hh) - 0.12;
    ctx.beginPath();
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      const rr = r * (0.78 + hache(k, 5, 13) * 0.3);
      if (k) ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    remplir(ctx, c.pierreSombre, c);
    ctx.beginPath();
    ctx.lineWidth = 0.025;
    ligne(ctx, -r * 0.4, -r * 0.2, r * 0.1, r * 0.25);
    ctx.stroke();
  },
  stalagmite(ctx, hw, hh, c, parchemin) {
    rond(ctx, 0, 0, 0.3);
    if (!parchemin) {
      const g = ctx.createRadialGradient(-0.06, -0.06, 0.02, 0, 0, 0.3);
      g.addColorStop(0, c.pierreClair);
      g.addColorStop(1, c.pierreSombre);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = c.trait;
      ctx.lineWidth = c.lw;
      ctx.stroke();
    } else remplir(ctx, PAPIER, c);
    rond(ctx, -0.04, -0.04, 0.07);
    ctx.lineWidth = 0.02;
    ctx.stroke();
  },
  champignons(ctx, hw, hh, c, parchemin) {
    for (const [x, y, r] of [[-0.15, -0.1, 0.13], [0.15, 0.05, 0.1], [-0.02, 0.22, 0.08]]) {
      rond(ctx, x, y, r);
      remplir(ctx, parchemin ? PAPIER : "#7fa6a0", c);
    }
  },
  piege(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, -0.34);
    ctx.lineTo(0.34, 0.28);
    ctx.lineTo(-0.34, 0.28);
    ctx.closePath();
    ctx.fillStyle = "rgba(179,38,30,.85)";
    ctx.fill();
    ecrire(ctx, "!", 0, 0.06, { taille: 0.42, police: "700 {t}px Cinzel", couleur: "#fbeee0", halo: null });
  },
  tresor(ctx) {
    for (const [x, y] of [[-0.12, 0.08], [0.12, 0.1], [0, -0.1], [0.2, -0.14], [-0.2, -0.12]]) {
      rond(ctx, x, y, 0.12);
      ctx.fillStyle = "#e0b847";
      ctx.fill();
      ctx.strokeStyle = "#7a5a14";
      ctx.lineWidth = 0.025;
      ctx.stroke();
    }
  },
};

// Le mobilier ajouté le 09/11 (mobilier-plus.js), dessiné de la même main.
Object.assign(MEUBLE, meublesPlus({ rrect, rond, remplir, ligne, flamme }));
// Celui des plans extérieurs (10/11, dehors-dessin.js).
for (const [cle, f] of Object.entries(meublesDehors({ rrect, rond, remplir }))) if (!MEUBLE[cle]) MEUBLE[cle] = f;
export const meubleDessine = (cle) => !!MEUBLE[cle];

export function dessinerMeuble(ctx, o, c, parchemin, options = {}) {
  const b = emprise(o);
  const f = MEUBLE[o.cle];
  if (!f) return;
  // Une teinte choisie remplace le tissu du meuble, en couleur seulement (le parchemin s'imprime).
  const t = !parchemin && MEUBLES[o.cle]?.teinte && teinteValide(o.teinte);
  if (t) c = { ...c, teinte: t, ...(TEINTE_COULEUR[o.cle] ? { [TEINTE_COULEUR[o.cle]]: t } : {}) };
  ctx.save();
  ctx.translate((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
  ctx.rotate(((o.rot || 0) * Math.PI) / 180);
  if (options.cache) ctx.globalAlpha = 0.55;
  if (!parchemin && !options.sansOmbre) {
    const s = Math.abs(ctx.getTransform().a);
    ctx.shadowColor = "rgba(0,0,0,.38)";
    ctx.shadowBlur = 0.12 * s;
    ctx.shadowOffsetX = 0.05 * s;
    ctx.shadowOffsetY = 0.06 * s;
  }
  f(ctx, o.l / 2, o.h / 2, c, parchemin);
  ctx.restore();
  if (options.cache) {
    ctx.save();
    ctx.setLineDash([0.1, 0.08]);
    ctx.strokeStyle = "#e0584c";
    ctx.lineWidth = 0.04;
    ctx.strokeRect(b.x0 + 0.04, b.y0 + 0.04, b.l - 0.08, b.h - 0.08);
    ctx.restore();
  }
}

// Vignette d'un meuble pour la palette de l'éditeur.
export function vignetteMeuble(cle, taille = 44, style = "couleur") {
  if (style === "peint") return vignetteMeublePeint(cle, taille);
  const m = MEUBLES[cle] || { l: 1, h: 1 };
  const o = { cle, x: 0, y: 0, l: m.l, h: m.h, rot: 0 };
  const toile = document.createElement("canvas");
  toile.width = toile.height = taille;
  const ctx = toile.getContext("2d");
  const k = (taille - 6) / Math.max(o.l, o.h);
  ctx.setTransform(k, 0, 0, k, (taille - o.l * k) / 2, (taille - o.h * k) / 2);
  dessinerMeuble(ctx, o, PAL[style], style === "parchemin", { sansOmbre: true });
  return toile.toDataURL();
}

// ---------------------------------------------------------------- le plan

// Le nom d'une pièce s'écrit au centre de sa boîte, sauf si ce centre tombe hors d'elle (un couloir en L) : il va alors
// sur sa case la plus proche du centre, là où il se lit et où la révélation le découvre. Calculé une fois par jeu de
// centres (la vue les refait à chaque changement de structure), pas à chaque tuile.
const centresPlaces = new WeakMap();
function centresSurPieces(p, centres) {
  if (!(centres instanceof Map)) return centres || null;
  const cle = JSON.stringify([...centres]);
  const deja = centresPlaces.get(centres);
  if (deja && deja.cle === cle) return deja.res;
  const res = new Map(centres);
  const w = p.largeur;
  const dehors = new Set();
  for (const [id, [cx, cy]] of centres) {
    const x = Math.floor(cx);
    const y = Math.floor(cy);
    const i = y * w + x;
    if (!(x >= 0 && y >= 0 && x < w && y < p.hauteur && p.sol[i] && p.piece[i] === id)) dehors.add(id);
  }
  if (dehors.size) {
    const meilleur = new Map();
    for (let i = 0; i < p.sol.length; i++) {
      const id = p.piece[i];
      if (!p.sol[i] || !dehors.has(id)) continue;
      const [cx, cy] = centres.get(id);
      const x = (i % w) + 0.5;
      const y = Math.floor(i / w) + 0.5;
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (!meilleur.has(id) || d < meilleur.get(id)[0]) meilleur.set(id, [d, x, y]);
    }
    for (const [id, [, x, y]] of meilleur) res.set(id, [x, y]);
  }
  centresPlaces.set(centres, { cle, res });
  return res;
}

// o : style, joueurs (vue des joueurs), image (fond importé déjà chargé), texture (parchemin), mj (repères du MJ) ;
// pour le style peint, etat (précalcul tenu par la vue) et hautes (textures fines au zoom fort).
export function dessinerPlan(ctx, p, murs, zone, o = {}) {
  if (o.style === "peint") return dessinerPlanPeint(ctx, p, murs, zone, { ...o, centres: centresSurPieces(p, o.centres) });
  const parchemin = o.style === "parchemin";
  const c = PAL[parchemin ? "parchemin" : "couleur"];
  const joueurs = !!o.joueurs;
  const { largeur: w, hauteur: h } = p;
  const x0 = Math.max(0, Math.floor(zone.x0) - 1);
  const y0 = Math.max(0, Math.floor(zone.y0) - 1);
  const x1 = Math.min(w, Math.ceil(zone.x1) + 1);
  const y1 = Math.min(h, Math.ceil(zone.y1) + 1);
  const vu = (i) => !joueurs || !p.brouillard_actif || p.brouillard[i] === 1;
  const structure = !p.fond || p.fond.dessiner;

  if (parchemin) {
    ctx.fillStyle = "#efe3c6";
    ctx.fillRect(zone.x0, zone.y0, zone.x1 - zone.x0, zone.y1 - zone.y0);
    if (o.texture) ctx.drawImage(o.texture, 0, 0, w, h);
  } else {
    ctx.fillStyle = c.vide;
    ctx.fillRect(zone.x0, zone.y0, zone.x1 - zone.x0, zone.y1 - zone.y0);
  }
  if (p.fond && o.image) {
    ctx.save();
    ctx.globalAlpha = p.fond.opacite ?? 1;
    ctx.drawImage(o.image, p.fond.x || 0, p.fond.y || 0, p.fond.l || w, p.fond.h || h);
    ctx.restore();
  }

  // Le vide, les sols (une pièce peut teinter le sien).
  const teintes = parchemin ? null : teintesDesPieces(p);
  if (structure) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        const s = p.sol[i];
        if (s && vu(i)) dessinerSol(ctx, s, x, y, c, parchemin, teintes && teintes.get(p.piece[i]));
        else if (parchemin && !s) {
          ctx.fillStyle = c.vide;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    // Hachures du rocher, le long des murs, à la plume.
    if (parchemin) {
      ctx.strokeStyle = "rgba(43,29,18,.5)";
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          if (p.sol[i]) continue;
          let proche = false;
          for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h && p.sol[ny * w + nx] && murs[ny * w + nx] && vu(ny * w + nx)) proche = true;
          }
          if (!proche) continue;
          for (let k = 0; k < 4; k++) {
            const t = 0.1 + k * 0.25 + (hache(x, y, k) - 0.5) * 0.08;
            ctx.moveTo(x + t, y + 0.05);
            ctx.lineTo(x + t - 0.25, y + 0.95);
          }
        }
      }
      ctx.stroke();
    }
  }

  // Le quadrillage.
  if (o.quadrillage ?? p.quadrillage) {
    ctx.strokeStyle = p.fond && !structure ? c.grilleImage : c.grille;
    ctx.lineWidth = 0.022;
    ctx.beginPath();
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        const ici = (p.fond && !structure) || (p.sol[i] && vu(i));
        if (!ici) continue;
        ligne(ctx, x, y, x + 1, y);
        ligne(ctx, x, y, x, y + 1);
        if (x === w - 1 || !(p.sol[i + 1] && vu(i + 1))) ligne(ctx, x + 1, y, x + 1, y + 1);
        if (y === h - 1 || !(p.sol[i + w] && vu(i + w))) ligne(ctx, x, y + 1, x + 1, y + 1);
      }
    }
    ctx.stroke();
  }

  // Le brouillard des joueurs, sous les murs : les murs d'une pièce révélée restent nets.
  if (joueurs && p.brouillard_actif) {
    ctx.fillStyle = c.brume;
    for (let y = y0; y < y1; y++) {
      let debut = -1;
      for (let x = x0; x <= x1; x++) {
        const cache = x < x1 && p.brouillard[y * w + x] !== 1;
        if (cache && debut < 0) debut = x;
        if (!cache && debut >= 0) {
          ctx.fillRect(debut, y, x - debut, 1);
          debut = -1;
        }
      }
    }
    // Bord adouci là où la brume touche un sol révélé sans mur entre les deux.
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        if (p.brouillard[i] !== 1 || !p.sol[i]) continue;
        const m = murs[i] | (murs[i] >> 4);
        for (const [dx, dy, bit] of [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || p.brouillard[ny * w + nx] === 1 || m & bit) continue;
          const g = ctx.createLinearGradient(x + (dx > 0 ? 1 : dx < 0 ? 0 : 0.5), y + (dy > 0 ? 1 : dy < 0 ? 0 : 0.5), x + (dx > 0 ? 0.6 : dx < 0 ? 0.4 : 0.5), y + (dy > 0 ? 0.6 : dy < 0 ? 0.4 : 0.5));
          g.addColorStop(0, parchemin ? "rgba(199,180,142,1)" : "rgba(15,12,10,.95)");
          g.addColorStop(1, parchemin ? "rgba(199,180,142,0)" : "rgba(15,12,10,0)");
          ctx.fillStyle = g;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  // Portes, par arête.
  const portes = new Map();
  for (const d of p.portes || []) {
    if (joueurs && !porteVisible(p, d)) continue;
    portes.set(cleArete(d.sens, d.x, d.y), d);
  }
  const coupe = (sens, x, y) => {
    const d = portes.get(cleArete(sens, x, y));
    return d && d.genre !== "fenetre" && !(d.genre === "secrete" && !joueurs && !d.decouverte);
  };

  // Les murs droits, avec leur ombre portée sur le sol ; les parois de grotte, brisées.
  if (structure) {
    const droits = [];
    const roches = [];
    // Les murs d'une matière choisie (murs-plus.js) se mettent à part ; les autres se dessinent comme avant.
    const matieres = matieresDesPieces(p);
    const choisis = new Map();
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        const m = murs[i];
        if (!m || !vu(i)) continue;
        for (const a of aretesDeCase(x, y, m & 15)) {
          if (coupe(...a)) continue;
          const mat = matiereArete(p, matieres, ...a, vu);
          if (!mat) droits.push(a);
          else (choisis.get(mat) || choisis.set(mat, []).get(mat)).push(a);
        }
        for (const a of aretesDeCase(x, y, m >> 4)) if (!coupe(...a)) roches.push(a);
      }
    }
    if (roches.length) {
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      if (!parchemin) {
        ctx.strokeStyle = c.roche;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (const a of roches) paroi(ctx, ...a);
        ctx.stroke();
      }
      ctx.strokeStyle = c.paroi;
      ctx.lineWidth = parchemin ? 0.14 : 0.2;
      ctx.beginPath();
      for (const a of roches) paroi(ctx, ...a);
      ctx.stroke();
      ctx.lineCap = "butt";
    }
    if (droits.length || choisis.size) {
      if (c.ombre) {
        ctx.save();
        ctx.translate(0.06, 0.07);
        ctx.fillStyle = c.ombre;
        ctx.beginPath();
        for (const a of droits) segmentMur(ctx, ...a);
        for (const liste of choisis.values()) for (const a of liste) segmentMur(ctx, ...a);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = c.mur;
      ctx.beginPath();
      for (const a of droits) segmentMur(ctx, ...a, parchemin ? 0.24 : EP);
      ctx.fill();
      for (const [mat, liste] of choisis) dessinerMursMatiere(ctx, mat, liste, c, parchemin, parchemin ? 0.24 : EP);
    }
  }
  for (const d of portes.values()) {
    if (d.x < x0 - 1 || d.x > x1 + 1 || d.y < y0 - 1 || d.y > y1 + 1) continue;
    if (d.genre === "fenetre" || (d.genre === "secrete" && !joueurs && !d.decouverte)) {
      // La fenêtre et la porte secrète vivent dans le mur : on le repeint dessous.
      ctx.fillStyle = couleurMur(matiereArete(p, matieresDesPieces(p), d.sens, d.x, d.y, vu), c, parchemin);
      ctx.beginPath();
      segmentMur(ctx, d.sens, d.x, d.y, parchemin ? 0.24 : EP);
      ctx.fill();
    }
    dessinerPorte(ctx, d, c, parchemin, !joueurs);
  }

  // Les images du MJ posées sous les pions (lot H2, images.js), avant le mobilier : un tapis ou une tache sous la table.
  dessinerImagesPlan(ctx, p, zone, o.imagesPlan, { joueurs });

  // Le mobilier, les tapis d'abord (et tout ce qui est posé à même le sol, « sol » dans MOBILIER) : un lit ou une table
  // posés dessus restent visibles, même dans les plans anciens.
  const objets = p.objets || [];
  const auSol = (o) => !!MEUBLES[o.cle]?.sol;
  for (const ob of [...objets.filter(auSol), ...objets.filter((o) => !auSol(o))]) {
    const b = emprise(ob);
    if (b.x1 < zone.x0 - 1 || b.x0 > zone.x1 + 1 || b.y1 < zone.y0 - 1 || b.y0 > zone.y1 + 1) continue;
    if (joueurs && !objetVisible(p, ob)) continue;
    dessinerMeuble(ctx, ob, c, parchemin, { cache: !joueurs && ob.cache });
  }

  // Les textes posés sur le plan, et les noms des pièces pour le MJ.
  for (const t of p.textes || []) {
    if (joueurs && (t.mj || !reveleA(p, t.x, t.y))) continue;
    ecrire(ctx, t.texte, t.x, t.y, {
      taille: t.taille || 0.6, police: "600 {t}px Cinzel", couleur: t.mj ? "#b3261e" : parchemin ? ENCRE : "#f4ead4",
      halo: parchemin ? "rgba(246,238,219,.85)" : "rgba(20,14,10,.8)", espacement: 0.08,
    });
  }
  // Les noms des pièces : tous pour le MJ, ceux qu'il a rendus visibles pour les joueurs, une fois la pièce révélée.
  if (o.mj || joueurs) {
    const centres = centresSurPieces(p, o.centres);
    for (const pc of p.pieces || []) {
      const centre = centres?.get(pc.id);
      if (!pc.nom || !centre) continue;
      if (joueurs && (!pc.nom_visible || !reveleA(p, centre[0], centre[1]))) continue;
      ecrire(ctx, pc.nom, centre[0], centre[1], {
        taille: 0.42, police: "italic 600 {t}px 'EB Garamond'", couleur: parchemin ? "rgba(142,27,23,.9)" : "rgba(244,234,212,.92)",
        halo: parchemin ? "rgba(246,238,219,.85)" : "rgba(20,14,10,.75)", alpha: 0.95,
      });
    }
  }
}

// Le brouillard vu par le MJ : un voile sépia et hachuré, qui laisse tout voir mais ne ressemble plus à ce qui est révélé.
export function dessinerVoileMJ(ctx, p, zone) {
  if (!p.brouillard_actif) return;
  const { largeur: w, hauteur: h } = p;
  const x0 = Math.max(0, Math.floor(zone.x0));
  const y0 = Math.max(0, Math.floor(zone.y0));
  const x1 = Math.min(w, Math.ceil(zone.x1));
  const y1 = Math.min(h, Math.ceil(zone.y1));
  // Les cases cachées, en un seul chemin : un seul remplissage, sans filet entre deux rangées. Le vide autour des pièces
  // n'est voilé que sous une image de fond (sans sol tracé, c'est elle que cache le brouillard).
  const cache = new Path2D();
  let vide = true;
  for (let y = y0; y < y1; y++) {
    let debut = -1;
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      const c = x < x1 && p.brouillard[i] !== 1 && (p.sol[i] || p.fond);
      if (c && debut < 0) debut = x;
      if (!c && debut >= 0) {
        cache.rect(debut, y, x - debut, 1);
        vide = false;
        debut = -1;
      }
    }
  }
  if (vide) return;
  // Ce que les joueurs ne voient pas se lit d'un coup d'œil : passé au sépia (les couleurs s'en vont, le dessin reste),
  // assombri, puis hachuré. Les hachures gardent leur finesse à l'écran quel que soit le zoom, et restent attachées au plan.
  ctx.save();
  ctx.globalCompositeOperation = "color";
  ctx.fillStyle = "#86663f";
  ctx.fill(cache);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(10,8,6,.34)";
  ctx.fill(cache);
  const m = ctx.getTransform ? ctx.getTransform() : null;
  const k = (m && Math.hypot(m.a, m.b)) || 24;
  const pas = 10 / k;
  ctx.clip(cache);
  ctx.beginPath();
  for (let c = Math.floor((x0 - y1) / pas) * pas; c < x1 - y0; c += pas) {
    ctx.moveTo(c + y0, y0);
    ctx.lineTo(c + y1, y1);
  }
  ctx.strokeStyle = "rgba(224,181,98,.2)";
  ctx.lineWidth = 1.2 / k;
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- pions

// Ce que voient les joueurs d'un pion : ni embuscade, ni case cachée, ni adversaire dans la brume épaisse (brume.js
// éclaircit la brume sous les mêmes pions).
// Un pion « invisible » suit la règle du pion caché.
export const pionMontre = (p, t, joueurs) => !joueurs || (!t.cache && !invisible(t) && reveleA(p, t.x, t.y) && !cacheParLaBrume(p, t));
// La boîte d'une figurine en cases : son socle en largeur, du haut de son support au bas de son socle.
const boiteFigurine = (t) => {
  const s = silhouette(0.42 * (t.taille || 1), epaisseurDuPion(t));
  return { x0: t.x - s.demi, x1: t.x + s.demi, y0: t.y + s.haut, y1: t.y + s.bas };
};
const horsZone = (t, zone) => {
  const b = boiteFigurine(t);
  return b.x1 < zone.x0 || b.x0 > zone.x1 || b.y1 < zone.y0 || b.y0 > zone.y1;
};
// Le prénom sous un pion : le premier mot de son nom, sans l'article d'un nom commun (« Le ménestrel » donne
// « ménestrel », « L'inquisiteur qui boit seul », « inquisiteur ») ni un titre (« Frère Anatole » donne « Anatole »,
// « Dame Mélisande », « Mélisande ») ; un nom qui n'est qu'un article ou qu'un titre reste tel quel.
const ARTICLE = /^(?:(?:le|la|les|un|une)\s+|l['’])/i;
const TITRE = /^(?:frère|sœur|soeur|père|mère|maître|maîtresse|dame|sire|messire|seigneur|dom|abbé|abbesse)\s+(?=\S)/i;
export const prenom = (t) => {
  const nom = (t.nom || "").trim();
  const sans = nom.replace(ARTICLE, "");
  return (sans.replace(TITRE, "") || sans || nom).split(/[\s,]+/)[0];
};
// Le nom écrit sous un pion : jamais celui d'un adversaire (son numéro suffit), sauf si le MJ l'a rendu visible ; pour les
// joueurs, rien quand le MJ l'a caché (lot H2 : sur la TV, un nom caché n'arrive même pas).
const nomEcrit = (t, joueurs) => (t.genre === "ennemi" ? (t.nom_visible === true ? prenom(t) : "") : joueurs && t.nom_visible === false ? "" : prenom(t));
// lisible (TV) : tailles minimales à l'écran, en cases ({ nom, numero, anneau, nomMin }), pour une lecture depuis le
// canapé ; nomMin : la taille d'un nom serré contre d'autres, qui ne descend plus à celle de l'atelier.
const PRENOM_ATELIER = 0.26; // taille d'un prénom dans l'atelier, en cases
const taillePrenom = (lisible) => Math.max(PRENOM_ATELIER, lisible?.nom || 0);
const prenomSerre = (lisible) => Math.max(PRENOM_ATELIER, lisible?.nomMin || 0);
// dx : le pas de côté d'un nom qu'un pion voisin gênerait (placerNoms, sur la TV), en cases.
// Le prénom s'écrit sous le socle de la figurine.
const centrePrenom = (t, taille, dx = 0) => [t.x + dx, boiteFigurine(t).y1 + Math.max(0.15, 0.04 + taille * 0.6)];

// Sur la TV, les prénoms s'écrivent en grand quand la place le permet. Un héros qui chevaucherait un autre prénom ou un
// autre pion perd le sien au profit de la légende ; un PNJ ou un autre pion, que la légende ne nomme pas, garde toujours
// son nom, écrit alors à la taille de l'atelier, comme avant. Le nom d'un PNJ passe avant le prénom d'un héros.
// Renvoie la taille de chaque prénom écrit (ecrits : id → taille en cases), le pas de côté d'un nom qu'un pion voisin
// couvrirait d'un seul côté (decales : id → décalage en cases) et, dès qu'un héros à l'écran a perdu le sien, la
// légende : chaque héros à l'écran, sa couleur et son prénom.
export function placerNoms(ctx, p, zone, lisible) {
  const grand = taillePrenom(lisible);
  const vus = (p.pions || []).filter((t) => pionMontre(p, t, true) && !horsZone(t, zone));
  const nommes = [];
  ctx.save();
  ctx.font = "600 32px Cinzel";
  for (const t of vus) {
    const nom = nomEcrit(t, true);
    // Largeur écrite en 32 px, espacement de 0,06 compris.
    if (nom) nommes.push({ t, mesure: ctx.measureText(nom).width + 0.06 * 32 * ([...nom].length - 1) });
  }
  ctx.restore();
  // La place que prend un prénom de cette taille, halo compris.
  const boite = ({ t, mesure }, taille) => {
    const l = (mesure * taille) / 32 + taille * 0.5;
    const [x, y] = centrePrenom(t, taille);
    return { t, mesure, taille, x0: x - l / 2, x1: x + l / 2, y0: y - taille * 0.6, y1: y + taille * 0.6 };
  };
  const croise = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const disque = boiteFigurine;
  // Les barres d'un héros, peintes par-dessus tout (dessinerPions) : un prénom ne s'écrit pas dessous.
  const plaques = vus.filter((t) => t.genre === "heros" && t.jauges).map((t) => {
    const m = barresTv(ctx, p, t, 0.42 * (t.taille || 1), t.jauges, lisible);
    return m && { t, ...m.plaque };
  }).filter(Boolean);
  const gene = (b, prenoms) => prenoms.some((c) => c.t !== b.t && croise(b, c)) || vus.some((t) => t !== b.t && croise(b, disque(t)))
    || plaques.some((q) => q.t !== b.t && croise(b, q));
  const ecrits = new Map();
  // D'abord les noms que la légende ne reprend pas : ils ne cèdent la grande taille qu'à un pion ou à un autre nom.
  const autres = nommes.filter((n) => n.t.genre !== "heros");
  const enGrand = autres.map((n) => boite(n, grand));
  const places = enGrand.map((b) => (gene(b, enGrand) ? boite(b, prenomSerre(lisible)) : b));
  for (const b of places) ecrits.set(b.t.id, b.taille);
  // Sur la TV, un nom serré qu'un pion voisin couvre d'un seul côté fait un pas vers l'autre (au plus la moitié de sa
  // largeur) : il ne cache plus le numéro d'un ennemi (« G2 »).
  const decales = new Map();
  if (lisible) {
    for (const b of places) {
      const gens = vus.filter((t) => t !== b.t).map(disque).filter((d) => croise(b, d));
      if (!gens.length) continue;
      const milieu = (b.x0 + b.x1) / 2;
      const gauche = gens.filter((d) => (d.x0 + d.x1) / 2 < milieu);
      if (gauche.length && gauche.length < gens.length) continue;
      const marge = b.taille * 0.2;
      const dx = gauche.length ? Math.max(...gauche.map((d) => d.x1)) - b.x0 + marge : Math.min(...gens.map((d) => d.x0)) - b.x1 - marge;
      if (Math.abs(dx) <= (b.x1 - b.x0) / 2) decales.set(b.t.id, dx);
    }
  }
  // Puis les héros : un prénom qui ne tient pas passe dans la légende.
  const heros = nommes.filter((n) => n.t.genre === "heros").map((n) => boite(n, grand));
  let manque = false;
  for (const b of heros) {
    if (gene(b, heros) || places.some((c) => croise(b, c))) manque = true;
    else ecrits.set(b.t.id, grand);
  }
  const legende = manque
    ? vus.filter((t) => t.genre === "heros" && prenom(t)).map((t) => ({ id: t.id, nom: prenom(t), couleur: t.couleur || COULEURS_PIONS.heros }))
    : [];
  return { ecrits, legende, decales };
}

// Dans la vue du MJ, les prénoms gardent la taille de l'atelier, mais deux prénoms ne se chevauchent plus : celui du
// pion choisi ou survolé s'écrit d'abord, puis ceux des PNJ et des autres pions, puis ceux des héros ; un prénom qui
// toucherait un prénom déjà écrit se tait, le pion garde son portrait ou ses initiales. Renvoie id → taille, 0 pour un
// prénom tu (dessinerPions, o.noms). La TV a sa règle, placerNoms, et sa légende.
export function placerNomsMJ(ctx, p, zone, pions, avant = [], joueurs = false) {
  const rang = (t) => (avant.includes(t.id) ? avant.indexOf(t.id) : avant.length + (t.genre === "heros" ? 1 : 0));
  const liste = pions.filter((t) => nomEcrit(t, joueurs) && pionMontre(p, t, joueurs) && !horsZone(t, zone))
    .map((t, i) => ({ t, i, r: rang(t) })).sort((a, b) => a.r - b.r || a.i - b.i);
  const noms = new Map();
  const ecrits = [];
  const taille = PRENOM_ATELIER;
  ctx.save();
  ctx.font = "600 32px Cinzel";
  for (const { t } of liste) {
    const nom = nomEcrit(t, joueurs);
    const l = ((ctx.measureText(nom).width + 0.06 * 32 * ([...nom].length - 1)) * taille) / 32 + taille * 0.5;
    const [x, y] = centrePrenom(t, taille);
    const b = { x0: x - l / 2, x1: x + l / 2, y0: y - taille * 0.6, y1: y + taille * 0.6 };
    const libre = avant.includes(t.id) || !ecrits.some((c) => b.x0 < c.x1 && c.x0 < b.x1 && b.y0 < c.y1 && c.y0 < b.y1);
    noms.set(t.id, libre ? taille : 0);
    if (libre) ecrits.push(b);
  }
  ctx.restore();
  return noms;
}

// ---------------------------------------------------------------- jauges des pions

// Les jauges d'un pion : { sante, psy } en part du maximum (0 à 1 ; null : pas de barre), coma, cartons
// [{ carac, couleur }], avantage ("avantage", "desavantage" ou "") et posture ("offensive", "defensive", "focus" ou "").
// La TV les reçoit du serveur avec les pions des héros (jauges_pion) ; l'atelier les calcule de l'état du moment et du
// combat en cours (plan/jauges.js).
const LETTRES_CARTONS = { physique: "P", social: "S", mental: "M" };
const couleurSante = (k) => (k > 0.6 ? "#6aa84f" : k > 0.3 ? "#d9a13b" : "#c8372d");

const POSTURES_PION = { offensive: "#9b2c22", defensive: "#2f5d8a", focus: "#6b4a9a" };

// Le signe de la posture, dessiné (pas de police), dans un rond de rayon b.
function dessinerPosture(ctx, posture, x, y, b) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = "#f4ead4";
  ctx.fillStyle = "#f4ead4";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (posture === "offensive") {
    // Une épée en diagonale : lame, garde, pommeau.
    ctx.rotate(-Math.PI / 4);
    ctx.lineWidth = b * 0.2;
    ctx.beginPath();
    ligne(ctx, 0, -b * 0.62, 0, b * 0.3);
    ctx.stroke();
    ctx.lineWidth = b * 0.16;
    ctx.beginPath();
    ligne(ctx, -b * 0.3, b * 0.3, b * 0.3, b * 0.3);
    ctx.stroke();
    rond(ctx, 0, b * 0.52, b * 0.12);
    ctx.fill();
  } else if (posture === "defensive") {
    // Un écu.
    ctx.beginPath();
    ctx.moveTo(-b * 0.46, -b * 0.5);
    ctx.lineTo(b * 0.46, -b * 0.5);
    ctx.lineTo(b * 0.46, -b * 0.05);
    ctx.quadraticCurveTo(b * 0.42, b * 0.42, 0, b * 0.62);
    ctx.quadraticCurveTo(-b * 0.42, b * 0.42, -b * 0.46, -b * 0.05);
    ctx.closePath();
    ctx.fill();
  } else {
    // Un œil : l'amande et la pupille.
    ctx.lineWidth = b * 0.14;
    ctx.beginPath();
    ctx.moveTo(-b * 0.62, 0);
    ctx.quadraticCurveTo(0, -b * 0.62, b * 0.62, 0);
    ctx.quadraticCurveTo(0, b * 0.62, -b * 0.62, 0);
    ctx.closePath();
    ctx.stroke();
    rond(ctx, 0, 0, b * 0.2);
    ctx.fill();
  }
  ctx.restore();
}

// Deux barres sans graduation au-dessus du pion (Santé, puis Psy), en cases : leur hauteur, leur largeur, leur écart, le
// haut de la première et la plaque sombre qui les porte (sa boîte : le feu et la brume s'y ouvrent) ; null sans barre.
// La hauteur reste celle que le pion permet ; o.grand : sur la TV (lisible), celle du canapé, jusqu'à 0,6 rayon ;
// o.serre : posées sur l'anneau du pion, sans écart (voir barresTv).
const BARRE_TV_MAX = 0.6;
function mesureBarres(t, r, j, lisible, o = {}) {
  const barres = [["sante", j.sante], ["psy", j.psy]].filter(([, v]) => typeof v === "number");
  if (!barres.length) return null;
  const largeur = Math.max(2 * r, 0.84);
  const base = Math.min(Math.max(0.085, lisible?.barre || 0), r * 0.32);
  const h = o.grand && lisible ? Math.max(base, Math.min(lisible.barre || 0, r * BARRE_TV_MAX)) : base;
  const ecart = h * 0.45;
  // Au-dessus de la tête de la figurine.
  const y = t.y + silhouette(r).haut - (o.serre ? 0 : Math.max(0.1, h * 0.9)) - barres.length * h - (barres.length - 1) * ecart;
  const x0 = t.x - largeur / 2;
  const bord = h * 0.3;
  const haut = barres.length * h + (barres.length - 1) * ecart;
  return { barres, largeur, h, ecart, x0, y, plaque: { x0: x0 - bord, y0: y - bord, x1: x0 + largeur + bord, y1: y + haut + bord } };
}

// Sur la TV, un plan entier cadré a des cases de 30 à 40 pixels, où les barres n'auraient que 4 ou 5 pixels. Elles
// grandissent donc jusqu'à la taille lisible du canapé quand leur plaque ne couvre ni le disque d'un autre pion, ni le
// nom qu'écrit un PNJ ou un autre pion (le prénom d'un autre héros, lui, cède la place : la légende le reprend,
// placerNoms). Sinon, elles gardent leur taille, posées sur l'anneau : le numéro d'un ennemi au contact reste lisible.
function barresTv(ctx, p, t, r, j, lisible) {
  const base = mesureBarres(t, r, j, lisible);
  const grand = base && mesureBarres(t, r, j, lisible, { grand: true });
  if (!grand || grand.h <= base.h) return base;
  const q = grand.plaque;
  const demi = taillePrenom(lisible) / 2;
  for (const o of p.pions || []) {
    if (o === t || o.id === t.id || !pionMontre(p, o, true)) continue;
    // La figurine voisine, son support et son socle : un voisin en diagonale ne gêne pas.
    const f = boiteFigurine(o);
    const mi = (f.x1 - f.x0) * 0.15;
    if (q.x0 < f.x1 - mi && f.x0 + mi < q.x1 && q.y0 < f.y1 && f.y0 < q.y1) return mesureBarres(t, r, j, lisible, { serre: true });
    // Le nom en grand, lettres seules (sans le cartouche qu'il prend sur le feu), d'un pion un peu au-dessus (mesuré
    // seulement là : la TV refait ce calcul à chaque image).
    if (o.y > t.y || o.y < t.y - 4 || Math.abs(o.x - t.x) > 8) continue;
    const nom = o.genre === "heros" ? "" : nomEcrit(o, true);
    const b = nom && boitePrenom(ctx, o, nom, taillePrenom(lisible));
    const yn = b && (b.y0 + b.y1) / 2;
    if (b && b.x0 < q.x1 && q.x0 < b.x1 && yn - demi < q.y1 && q.y0 < yn + demi) return mesureBarres(t, r, j, lisible, { serre: true });
  }
  return grand;
}

// Les barres mesurées (mesureBarres) : une seule plaque sombre derrière elles, elles se lisent sur n'importe quel sol.
function dessinerBarres(ctx, m, coma) {
  const { barres, largeur, h, ecart, x0, plaque } = m;
  rrect(ctx, plaque.x0, plaque.y0, plaque.x1 - plaque.x0, plaque.y1 - plaque.y0, h * 0.55);
  ctx.fillStyle = "rgba(14,10,8,.82)";
  ctx.fill();
  let y = m.y;
  for (const [genre, v] of barres) {
    const k = Math.max(0, Math.min(1, v));
    rrect(ctx, x0, y, largeur, h, h * 0.5);
    ctx.fillStyle = "rgba(255,255,255,.07)";
    ctx.fill();
    if (k > 0) {
      rrect(ctx, x0, y, largeur * k, h, h * 0.5);
      ctx.fillStyle = genre === "psy" ? "#5b8fe0" : couleurSante(k);
      ctx.fill();
    }
    if (genre === "sante" && coma) {
      rrect(ctx, x0 - h * 0.1, y - h * 0.1, largeur + h * 0.2, h * 1.2, h * 0.6);
      ctx.strokeStyle = "#e0584c";
      ctx.lineWidth = h * 0.35;
      ctx.stroke();
    }
    y += h + ecart;
  }
}

// Autour du pion : les cartons en petites cartes à sa droite, le jeton d'avantage en bas à gauche, la posture en bas à
// droite (les barres, au-dessus, se peignent à part : dessinerBarres). Sur la TV (lisible), des tailles minimales.
function dessinerJauges(ctx, t, r, j, lisible) {
  // Les cartons : jaune ou rouge, la lettre de la caractéristique dessus.
  const cartons = (j.cartons || []).filter((c) => LETTRES_CARTONS[c.carac] && (c.couleur === "jaune" || c.couleur === "rouge"));
  if (cartons.length) {
    const ch = Math.min(Math.max(0.24, lisible?.carton || 0), r * 0.75);
    const cw = ch * 0.72;
    let cx = t.x + r * 0.62;
    const cy = t.y - r * 0.92;
    for (const c of cartons) {
      ctx.save();
      ctx.translate(cx + cw / 2, cy + ch / 2);
      ctx.rotate(0.12);
      rrect(ctx, -cw / 2 + 0.02, -ch / 2 + 0.03, cw, ch, ch * 0.12);
      ctx.fillStyle = "rgba(0,0,0,.45)";
      ctx.fill();
      rrect(ctx, -cw / 2, -ch / 2, cw, ch, ch * 0.12);
      ctx.fillStyle = c.couleur === "rouge" ? "#c62f26" : "#f2c230";
      ctx.fill();
      ctx.strokeStyle = "rgba(20,14,10,.75)";
      ctx.lineWidth = ch * 0.06;
      ctx.stroke();
      ctx.restore();
      ecrire(ctx, LETTRES_CARTONS[c.carac], cx + cw / 2, cy + ch / 2 + ch * 0.03, {
        taille: ch * 0.62, police: "700 {t}px Cinzel", couleur: c.couleur === "rouge" ? "#fbeee0" : "#2a1d10", halo: null,
      });
      cx += cw * 1.08;
    }
  }
  // La posture en bas à droite : une épée (offensive), un bouclier (défensive), un œil (focus).
  if (POSTURES_PION[j.posture]) {
    const b = Math.min(Math.max(0.15, (lisible?.jeton || 0) / 2), r * 0.42);
    const px = t.x + r * 0.78;
    const py = t.y + r * 0.7;
    rond(ctx, px + 0.02, py + 0.03, b);
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.fill();
    rond(ctx, px, py, b);
    ctx.fillStyle = POSTURES_PION[j.posture];
    ctx.fill();
    ctx.strokeStyle = "#f4ead4";
    ctx.lineWidth = b * 0.16;
    ctx.stroke();
    dessinerPosture(ctx, j.posture, px, py, b);
  }
  // Le jeton du kit : un rond vert « + » (avantage) ou rouge « − » (désavantage).
  if (j.avantage === "avantage" || j.avantage === "desavantage") {
    const b = Math.min(Math.max(0.15, (lisible?.jeton || 0) / 2), r * 0.42);
    const bx = t.x - r * 0.78;
    const by = t.y + r * 0.7;
    rond(ctx, bx + 0.02, by + 0.03, b);
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.fill();
    rond(ctx, bx, by, b);
    ctx.fillStyle = j.avantage === "avantage" ? "#3f8f4a" : "#8e1b17";
    ctx.fill();
    ctx.strokeStyle = "#f4ead4";
    ctx.lineWidth = b * 0.18;
    ctx.stroke();
    // La croix ou le trait, dessinés (pas de police) : nets à toutes les tailles.
    ctx.beginPath();
    ligne(ctx, bx - b * 0.5, by, bx + b * 0.5, by);
    if (j.avantage === "avantage") ligne(ctx, bx, by - b * 0.5, bx, by + b * 0.5);
    ctx.strokeStyle = "#f4ead4";
    ctx.lineWidth = b * 0.24;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.lineCap = "butt";
  }
}

// La boîte d'un prénom écrit sous un pion (en cases) : son cartouche sur la TV, et la place que le feu et la brume lui
// laissent (feu.js, brume.js).
export function boitePrenom(ctx, t, nom, taille, dx = 0) {
  ctx.save();
  ctx.font = "600 32px Cinzel";
  const l = ((ctx.measureText(nom).width + 0.06 * 32 * ([...nom].length - 1)) * taille) / 32 + taille * 0.8;
  ctx.restore();
  const [x, y] = centrePrenom(t, taille, dx);
  const h = taille * 1.3;
  return { x0: x - l / 2, y0: y - h / 2, x1: x + l / 2, y1: y + h / 2 };
}

// Les prénoms que la TV écrit, comme dessinerPions les pose : [{ t, nom, boite }]. noms : la taille de chaque prénom
// (placerNoms) ; un héros absent est dans la légende, un autre pion garde un nom serré ; decales : leurs pas de côté.
export function prenomsEcrits(ctx, p, pions, noms, lisible, decales) {
  const liste = [];
  for (const t of pions) {
    if (!pionMontre(p, t, true)) continue;
    const nom = nomEcrit(t, true);
    const taille = !nom ? 0 : noms.get(t.id) || (t.genre === "heros" ? 0 : prenomSerre(lisible));
    if (taille) liste.push({ t, nom, boite: boitePrenom(ctx, t, nom, taille, (decales && decales.get(t.id)) || 0) });
  }
  return liste;
}

// La trouée d'un prénom dans le calque du feu ou de la brume (en « destination-out ») : nette sur son cartouche, adoucie
// autour. Le nom et son cartouche, peints sur le plan dessous, restent lisibles au cœur du brasier.
export function trouerPrenom(ctx, b) {
  const h = b.y1 - b.y0;
  const m = h * 0.35;
  ctx.fillStyle = "#000";
  ctx.globalAlpha = 0.5;
  rrect(ctx, b.x0 - m, b.y0 - m, b.x1 - b.x0 + 2 * m, h + 2 * m, h * 0.6);
  ctx.fill();
  ctx.globalAlpha = 0.96;
  rrect(ctx, b.x0, b.y0, b.x1 - b.x0, h, h * 0.3);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// Le cartouche sombre d'un prénom, sous la figurine : il se lit sur tout sol, au cœur du feu comme dans la brume. Celui
// d'un héros est bordé de la couleur de son joueur (liseré clair autour d'une couleur trop sombre pour se voir).
function cartouche(ctx, b, couleur) {
  const h = b.y1 - b.y0;
  rrect(ctx, b.x0, b.y0, b.x1 - b.x0, h, h * 0.22);
  ctx.fillStyle = "rgba(18,12,8,.86)";
  ctx.fill();
  const sombre = couleur && /^#[0-9a-f]{6}$/i.test(couleur) && luminanceHex(couleur) < 0.14;
  ctx.lineWidth = h * (couleur ? 0.09 : 0.05);
  ctx.strokeStyle = !couleur ? "rgba(214,180,118,.55)" : sombre ? "rgba(244,234,212,.75)" : couleur;
  ctx.stroke();
}
const luminanceHex = (c) => [1, 3, 5].reduce((s, i, k) => s + [0.2126, 0.7152, 0.0722][k] * parseInt(c.slice(i, i + 2), 16), 0) / 255;

// L'ordre de dessin des figurines : celles à terre d'abord, puis de haut en bas (une figurine monte sur la case du
// dessus et passe devant le socle de son voisin) ; un cavalier juste après sa monture.
export function ordreDesFigurines(pions) {
  const par = new Map(pions.map((t) => [t.id, t]));
  const cle = (t) => {
    const m = t.enSelle && par.get(t.monture);
    return m ? m.y + 1e-4 : t.y;
  };
  return pions.slice().sort((a, b) => (a.tombe ? 0 : 1) - (b.tombe ? 0 : 1) || cle(a) - cle(b));
}

// o.noms : faux pour n'écrire aucun prénom, ou la taille de chaque prénom écrit (placerNoms sur la TV, placerNomsMJ dans
// la vue du MJ, où 0 tait un prénom) ; o.decales :
// le pas de côté de certains d'entre eux.
// o.jauges : les jauges de chaque pion (Map id → jauges) que l'atelier calcule ; sinon celles reçues avec le pion (TV).
// o.animations : ce qui bouge sur un pion (Map id → { eclat, leve, flash, secousse, chute, poussiere }, vue.js).
// Les joueurs ne voient que celles des héros. Renvoie la boîte de chaque plaque de barres peinte ([{ boite }], en
// cases) : le feu et la brume s'y ouvrent, comme sur un prénom.
export function dessinerPions(ctx, p, zone, o = {}) {
  const joueurs = !!o.joueurs;
  const parchemin = o.style === "parchemin";
  const lisible = o.lisible;
  const barres = [];
  // Le fil d'un familier à son héros, sous les figurines : son maître sur la TV (« maitre », envoyé seulement s'il est
  // montré), sa référence dans l'atelier.
  const montres = (p.pions || []).filter((t) => pionMontre(p, t, joueurs));
  for (const f of montres) {
    if (!estFamilier(f)) continue;
    const aid = String(f.ref || "").split(":")[1];
    const m = montres.find((t) => t !== f && (f.maitre ? t.id === f.maitre : aid && t.ref === `aventurier:${aid}`));
    if (m && !(horsZone(f, zone) && horsZone(m, zone))) dessinerFil(ctx, f, m, m.couleur || COULEURS_PIONS.heros);
  }
  for (const t of ordreDesFigurines(p.pions || [])) {
    if (!pionMontre(p, t, joueurs) || horsZone(t, zone)) continue;
    const r = 0.42 * (t.taille || 1);
    ctx.save();
    if (!joueurs && (t.cache || invisible(t))) ctx.globalAlpha = 0.55;
    const src = imageDuPion(t);
    const img = src && o.images?.get(src);
    const numero = t.genre === "ennemi" && t.court ? String(t.court) : "";
    const initiales = (t.court || (t.nom || "").trim().replace(ARTICLE, "") || t.nom || "?").split(/[\s,]+/).filter(Boolean).slice(0, 2).map((m) => m[0]).join("").toUpperCase();
    // L'animation du pion (vue.js) : soulevé quand il glisse, la lueur de qui a la main, l'éclair d'un coup ou d'un soin.
    const a = (o.animations && o.animations.get(t.id)) || null;
    // Un coup secoue la figurine.
    const x = a && a.secousse ? t.x + a.secousse * r * 0.16 : t.x;
    if (a && a.poussiere >= 0) dessinerPoussiere(ctx, t.x, t.y, r, a.poussiere);
    dessinerFigurine(ctx, t, x, t.y, r, {
      img, initiales, numero, parchemin, lisible, ep: epaisseurDuPion(t),
      // Un ennemi sans numéro, vu des joueurs : le losange des ennemis du bandeau, aucune lettre (elle dirait qui il est).
      mystere: joueurs && t.genre === "ennemi" && !numero && !t.nom,
      leve: Math.max(t.leve || 0, a ? a.leve || 0 : 0), eclat: a ? a.eclat : 0, flash: a ? a.flash : null, chute: a ? a.chute : 1,
    });
    // Le MJ voit ce que la TV ne montre pas : l'embuscade cerclée de rouge, le pion perdu dans la brume épaisse de gris.
    const brume = !joueurs && !t.cache && cacheParLaBrume(p, t);
    // Un pion invisible : cerclé de bleu pour le MJ, absent de la TV.
    const invis = !joueurs && !t.cache && !brume && invisible(t);
    if (!joueurs && (t.cache || brume || invis)) cernerSocle(ctx, t.x, t.y, r, 0.08, brume ? "#c9d3df" : invis ? "#8fb3e8" : "#e0584c", 0.04, [0.08, 0.06]);
    // Le pion choisi dans l'éditeur, ou chacun des pions choisis ensemble (o.selection : un identifiant ou une liste).
    if (Array.isArray(o.selection) ? o.selection.includes(t.id) : o.selection === t.id) cernerSocle(ctx, t.x, t.y, r, 0.12, "#e0b562", 0.06);
    // Les états en pastilles à gauche du support, le nombre d'un groupe en bas à droite du socle ; cartons, jeton et
    // posture autour du support (relevés avec lui).
    const haut = { x: t.x, y: t.y - r * 0.2 };
    dessinerEtats(ctx, haut, r, etatsDuPion(t, joueurs), lisible);
    dessinerGroupe(ctx, t, r, t.groupe, lisible);
    const jauges = o.jauges ? o.jauges.get(t.id) : t.jauges;
    if (jauges && (!joueurs || t.genre === "heros")) {
      dessinerJauges(ctx, haut, r, jauges, lisible);
      const m = lisible ? barresTv(ctx, p, t, r, jauges, lisible) : mesureBarres(t, r, jauges, lisible);
      if (m) barres.push({ m, coma: !!jauges.coma, alpha: ctx.globalAlpha });
    }
    const nom = nomEcrit(t, joueurs);
    // Sur la TV, placerNoms a choisi la taille de chaque prénom ; un héros absent de la liste est dans la légende, un
    // autre pion (qui glisse hors de sa case d'arrivée) garde son nom à la taille de l'atelier.
    const taille = !nom
      ? 0
      : o.noms instanceof Map
        ? o.noms.has(t.id) ? o.noms.get(t.id) : t.genre === "heros" ? 0 : prenomSerre(lisible)
        : (o.noms ?? true) ? taillePrenom(lisible) : 0;
    if (taille) {
      const dx = (o.decales && o.decales.get(t.id)) || 0;
      const [x, y] = centrePrenom(t, taille, dx);
      cartouche(ctx, boitePrenom(ctx, t, nom, taille, dx), t.genre === "heros" ? t.couleur || COULEURS_PIONS.heros : "");
      ecrire(ctx, nom, x, y, { taille, police: "600 {t}px Cinzel", couleur: "#f4ead4", halo: "rgba(20,14,10,.85)", espacement: 0.06, epaisseurHalo: 0.5 });
    }
    // Lot H2 : l'étiquette, sous le nom s'il est écrit, sinon juste sous le pion.
    if (t.etiquette) {
      const te = Math.max(0.22, lisible?.nomMin ? lisible.nomMin * 0.9 : 0);
      const dx = (o.decales && o.decales.get(t.id)) || 0;
      const ye = taille ? centrePrenom(t, taille, dx)[1] + taille * 0.62 + te * 0.72 : t.y + r + te * 0.85;
      dessinerEtiquette(ctx, t, ye, String(t.etiquette).slice(0, 24), te);
    }
    ctx.restore();
  }
  // Les barres de Santé et de Psy en dernier : celles d'un héros juste sous un autre pion ne passent plus sous le disque
  // de celui-ci.
  for (const b of barres) {
    ctx.save();
    ctx.globalAlpha = b.alpha;
    dessinerBarres(ctx, b.m, b.coma);
    ctx.restore();
  }
  return barres.map((b) => ({ boite: b.m.plaque }));
}

export function palette(style) {
  return PAL[style === "parchemin" ? "parchemin" : "couleur"];
}
