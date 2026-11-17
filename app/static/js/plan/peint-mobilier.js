// Mobilier et objets d'ambiance du style peint, vus de dessus : bois en planches, pierre, fer, tissu, flammes. Chaque
// dessin se fait dans un repère local centré, en cases (hw, hh : demi-largeur et demi-profondeur avant rotation).
// Les ombres ne se dessinent pas ici : le plan les pose d'un coup, sous tout le mobilier (voir peint.js).

import { MEUBLES, emprise, hache, teinteValide } from "./modele.js";
import { GRANDS_PLUS, PLATS_PLUS, meublesPeintsPlus, nuance } from "./peint-mobilier-plus.js";
import { GRANDS_DEHORS, PLATS_DEHORS, meublesPeintsDehors } from "./dehors-peint.js";

const h32 = hache;

function rr(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

export function rond(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function degrade(ctx, x, y, r, c0, c1, dx = -0.3, dy = -0.35) {
  const g = ctx.createRadialGradient(x + r * dx, y + r * dy, r * 0.05, x, y, r);
  g.addColorStop(0, c0);
  g.addColorStop(1, c1);
  return g;
}

function trait(ctx, couleur, l) {
  ctx.strokeStyle = couleur;
  ctx.lineWidth = l;
  ctx.stroke();
}

const BOIS = { clair: "#b07a46", moyen: "#8d5c32", sombre: "#5e3b1f", noir: "#3a2414", bord: "rgba(34,20,10,.85)" };
const FER = { clair: "#9a9c9a", moyen: "#5b5d5c", sombre: "#2c2e2e", bord: "rgba(16,16,16,.85)" };
const PIERRE = { clair: "#bdb6a8", moyen: "#8e877b", sombre: "#5d564d", bord: "rgba(30,24,18,.8)" };

// Planches parallèles sur un rectangle (x, y, w, h), le long de son grand côté.
function planches(ctx, x, y, w, h, n, base, graine) {
  const long = w >= h;
  for (let k = 0; k < n; k++) {
    const t0 = k / n;
    const t1 = (k + 1) / n;
    const v = h32(k, graine, 3);
    ctx.fillStyle = base;
    if (long) ctx.fillRect(x, y + h * t0, w, h * (t1 - t0));
    else ctx.fillRect(x + w * t0, y, w * (t1 - t0), h);
    ctx.fillStyle = v < 0.5 ? `rgba(40,20,6,${(0.5 - v) * 0.35})` : `rgba(255,230,190,${(v - 0.5) * 0.18})`;
    if (long) ctx.fillRect(x, y + h * t0, w, h * (t1 - t0));
    else ctx.fillRect(x + w * t0, y, w * (t1 - t0), h);
  }
  ctx.strokeStyle = "rgba(40,22,8,.55)";
  ctx.lineWidth = 0.018;
  ctx.beginPath();
  for (let k = 1; k < n; k++) {
    if (long) {
      ctx.moveTo(x, y + (h * k) / n);
      ctx.lineTo(x + w, y + (h * k) / n);
    } else {
      ctx.moveTo(x + (w * k) / n, y);
      ctx.lineTo(x + (w * k) / n, y + h);
    }
  }
  ctx.stroke();
  // Fil du bois.
  ctx.strokeStyle = "rgba(50,28,10,.22)";
  ctx.lineWidth = 0.01;
  ctx.beginPath();
  for (let k = 0; k < n * 3; k++) {
    const t = (k + 0.5) / (n * 3);
    const o = (h32(k, graine, 9) - 0.5) * 0.03;
    if (long) {
      ctx.moveTo(x + w * 0.05, y + h * t + o);
      ctx.bezierCurveTo(x + w * 0.35, y + h * t - o, x + w * 0.65, y + h * t + o * 2, x + w * 0.95, y + h * t);
    } else {
      ctx.moveTo(x + w * t + o, y + h * 0.05);
      ctx.bezierCurveTo(x + w * t - o, y + h * 0.35, x + w * t + o * 2, y + h * 0.65, x + w * t, y + h * 0.95);
    }
  }
  ctx.stroke();
}

function feu(ctx, x, y, r) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, "#fff3c0");
  g.addColorStop(0.3, "#ffc04a");
  g.addColorStop(0.7, "#e2621c");
  g.addColorStop(1, "rgba(150,30,10,0)");
  ctx.fillStyle = g;
  rond(ctx, x, y, r);
  ctx.fill();
}

// Brins de paille éparpillés autour de (x, y).
function pailleSur(ctx, x, y, r, n, graine) {
  ctx.lineCap = "round";
  for (let k = 0; k < n; k++) {
    const a = h32(k, graine, 1) * Math.PI * 2;
    const d = Math.sqrt(h32(k, graine, 2)) * r;
    const px = x + Math.cos(a) * d;
    const py = y + Math.sin(a) * d * 0.9;
    const b = h32(k, graine, 3) * Math.PI;
    const l = 0.06 + 0.1 * h32(k, graine, 4);
    ctx.strokeStyle = ["#f0d690", "#d6b064", "#b88d3e"][k % 3];
    ctx.lineWidth = 0.014;
    ctx.beginPath();
    ctx.moveTo(px - Math.cos(b) * l, py - Math.sin(b) * l);
    ctx.lineTo(px + Math.cos(b) * l, py + Math.sin(b) * l);
    ctx.stroke();
  }
  ctx.lineCap = "butt";
}

// Un bloc de pierre irrégulier (rocher, éboulis), éclairé du nord-ouest.
function caillou(ctx, x, y, r, graine, n = 8) {
  ctx.beginPath();
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const q = r * (0.78 + h32(k, graine, 13) * 0.32);
    if (k) ctx.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q);
    else ctx.moveTo(x + Math.cos(a) * q, y + Math.sin(a) * q);
  }
  ctx.closePath();
  ctx.fillStyle = degrade(ctx, x, y, r, "#a39a8c", "#4a443c");
  ctx.fill();
  trait(ctx, PIERRE.bord, Math.max(0.015, r * 0.06));
  ctx.strokeStyle = "rgba(30,24,18,.45)";
  ctx.lineWidth = r * 0.05;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.3, y - r * 0.1);
  ctx.lineTo(x + r * 0.05, y + r * 0.2);
  ctx.lineTo(x + r * 0.3, y + r * 0.15);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,248,230,.16)";
  rond(ctx, x - r * 0.3, y - r * 0.32, r * 0.3);
  ctx.fill();
}

function marches(ctx, hw, hh, descend) {
  // Marches de bois, de plus en plus claires vers le palier (en haut du dessin) ; vers le bas, de plus en plus sombres.
  const long = hh >= hw;
  ctx.fillStyle = "#2e1e12";
  ctx.fillRect(-hw + 0.04, -hh + 0.04, hw * 2 - 0.08, hh * 2 - 0.08);
  const L = (long ? hh : hw) * 2;
  const n = Math.round(L / 0.24);
  const pas = (L - 0.12) / n;
  for (let k = 0; k < n; k++) {
    const t = k / n;
    const clair = descend ? 0.45 + 0.7 * t : 1.15 - 0.6 * t;
    const c = (descend ? [150, 140, 126] : [168, 118, 70]).map((v) => Math.min(255, Math.round(v * clair)));
    ctx.fillStyle = `rgb(${c})`;
    if (long) {
      ctx.fillRect(-hw + 0.12, -hh + 0.06 + t * (L - 0.12), hw * 2 - 0.24, pas - 0.04);
      ctx.fillStyle = "rgba(255,230,190,.25)";
      ctx.fillRect(-hw + 0.12, -hh + 0.06 + t * (L - 0.12), hw * 2 - 0.24, 0.025);
    } else {
      ctx.fillRect(-hw + 0.06 + t * (L - 0.12), -hh + 0.12, pas - 0.04, hh * 2 - 0.24);
      ctx.fillStyle = "rgba(255,230,190,.25)";
      ctx.fillRect(-hw + 0.06 + t * (L - 0.12), -hh + 0.12, 0.025, hh * 2 - 0.24);
    }
  }
  ctx.fillStyle = descend ? "#3a3530" : BOIS.noir;
  if (long) {
    ctx.fillRect(-hw + 0.04, -hh + 0.04, 0.08, hh * 2 - 0.08);
    ctx.fillRect(hw - 0.12, -hh + 0.04, 0.08, hh * 2 - 0.08);
  } else {
    ctx.fillRect(-hw + 0.04, -hh + 0.04, hw * 2 - 0.08, 0.08);
    ctx.fillRect(-hw + 0.04, hh - 0.12, hw * 2 - 0.08, 0.08);
  }
  ctx.strokeStyle = BOIS.bord;
  ctx.lineWidth = 0.03;
  ctx.strokeRect(-hw + 0.04, -hh + 0.04, hw * 2 - 0.08, hh * 2 - 0.08);
  // Flèche discrète : vers le haut du dessin pour monter, vers le bas pour descendre.
  const s = descend ? 1 : -1;
  ctx.beginPath();
  if (long) {
    ctx.moveTo(0, s * (hh - 0.28));
    ctx.lineTo(-0.13, s * (hh - 0.5));
    ctx.lineTo(0.13, s * (hh - 0.5));
  } else {
    ctx.moveTo(s * (hw - 0.28), 0);
    ctx.lineTo(s * (hw - 0.5), -0.13);
    ctx.lineTo(s * (hw - 0.5), 0.13);
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(250,236,206,.7)";
  ctx.fill();
}

export const MEUBLES_PEINTS = {
  table(ctx, hw, hh) {
    rr(ctx, -hw + 0.06, -hh + 0.12, hw * 2 - 0.12, hh * 2 - 0.24, 0.06);
    ctx.save();
    ctx.clip();
    planches(ctx, -hw, -hh, hw * 2, hh * 2, 3, BOIS.moyen, 11);
    ctx.restore();
    rr(ctx, -hw + 0.06, -hh + 0.12, hw * 2 - 0.12, hh * 2 - 0.24, 0.06);
    trait(ctx, BOIS.bord, 0.03);
  },
  "table-ronde"(ctx, hw, hh) {
    const r = Math.min(hw, hh) - 0.08;
    rond(ctx, 0, 0, r);
    ctx.save();
    ctx.clip();
    planches(ctx, -r, -r, r * 2, r * 2, 4, BOIS.moyen, 13);
    ctx.restore();
    rond(ctx, 0, 0, r);
    trait(ctx, BOIS.bord, 0.03);
  },
  banc(ctx, hw, hh) {
    const long = hw >= hh;
    const [w, h] = long ? [hw * 2 - 0.12, 0.3] : [0.3, hh * 2 - 0.12];
    rr(ctx, -w / 2, -h / 2, w, h, 0.04);
    ctx.save();
    ctx.clip();
    planches(ctx, -w / 2, -h / 2, w, h, 2, BOIS.clair, 17);
    ctx.restore();
    rr(ctx, -w / 2, -h / 2, w, h, 0.04);
    trait(ctx, BOIS.bord, 0.025);
  },
  tabouret(ctx) {
    rond(ctx, 0, 0, 0.2);
    ctx.fillStyle = degrade(ctx, 0, 0, 0.2, BOIS.clair, BOIS.sombre);
    ctx.fill();
    trait(ctx, BOIS.bord, 0.022);
  },
  chaise(ctx) {
    rr(ctx, -0.2, -0.16, 0.4, 0.38, 0.05);
    ctx.fillStyle = BOIS.moyen;
    ctx.fill();
    trait(ctx, BOIS.bord, 0.022);
    rr(ctx, -0.22, -0.3, 0.44, 0.1, 0.03);
    ctx.fillStyle = BOIS.sombre;
    ctx.fill();
  },
  comptoir(ctx, hw, hh) {
    const long = hw >= hh;
    rr(ctx, -hw + 0.03, -hh + 0.06, hw * 2 - 0.06, hh * 2 - 0.12, 0.05);
    ctx.fillStyle = BOIS.noir;
    ctx.fill();
    // Plateau épais, en deux larges planches cirées.
    const [x, y, w, h] = long ? [-hw + 0.08, -hh + 0.14, hw * 2 - 0.16, hh * 2 - 0.36] : [-hw + 0.14, -hh + 0.08, hw * 2 - 0.36, hh * 2 - 0.16];
    ctx.save();
    rr(ctx, x, y, w, h, 0.04);
    ctx.clip();
    planches(ctx, x, y, w, h, 2, "#7a4a26", 23);
    const g = long ? ctx.createLinearGradient(0, y, 0, y + h) : ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, "rgba(255,220,170,.22)");
    g.addColorStop(1, "rgba(0,0,0,.1)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    rr(ctx, -hw + 0.03, -hh + 0.06, hw * 2 - 0.06, hh * 2 - 0.12, 0.05);
    trait(ctx, BOIS.bord, 0.03);
  },
  tonneau(ctx) {
    const r = 0.38;
    rond(ctx, 0, 0, r);
    ctx.fillStyle = "#6e4a2a";
    ctx.fill();
    // Couvercle en planches, cerclé de fer.
    rond(ctx, 0, 0, r * 0.82);
    ctx.save();
    ctx.clip();
    planches(ctx, -r, -r, r * 2, r * 2, 4, "#9a6a3c", 29);
    ctx.fillStyle = degrade(ctx, 0, 0, r, "rgba(255,230,180,.18)", "rgba(0,0,0,.25)");
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
    rond(ctx, 0, 0, r * 0.9);
    trait(ctx, "#3d3d3a", 0.05);
    rond(ctx, 0, 0, r * 0.9);
    trait(ctx, "rgba(200,200,190,.35)", 0.012);
    rond(ctx, 0, 0, r);
    trait(ctx, BOIS.bord, 0.025);
    rond(ctx, r * 0.35, r * 0.15, 0.05);
    ctx.fillStyle = "#2a1a0c";
    ctx.fill();
  },
  caisse(ctx) {
    const s = 0.36;
    ctx.fillStyle = BOIS.clair;
    ctx.fillRect(-s, -s, s * 2, s * 2);
    planches(ctx, -s, -s, s * 2, s * 2, 3, "#a77843", 31);
    ctx.strokeStyle = BOIS.sombre;
    ctx.lineWidth = 0.07;
    ctx.strokeRect(-s + 0.035, -s + 0.035, s * 2 - 0.07, s * 2 - 0.07);
    ctx.beginPath();
    ctx.moveTo(-s + 0.06, -s + 0.06);
    ctx.lineTo(s - 0.06, s - 0.06);
    ctx.lineWidth = 0.05;
    ctx.stroke();
    ctx.strokeStyle = BOIS.bord;
    ctx.lineWidth = 0.025;
    ctx.strokeRect(-s, -s, s * 2, s * 2);
    ctx.fillStyle = "#4a4a46";
    for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) ctx.fillRect(x * (s - 0.05) - 0.04, y * (s - 0.05) - 0.04, 0.08, 0.08);
  },
  etagere(ctx, hw, hh) {
    const long = hw >= hh;
    const [w, h] = long ? [hw * 2 - 0.08, 0.36] : [0.36, hh * 2 - 0.08];
    const x = -w / 2;
    const y = long ? -hh + 0.04 : -h / 2;
    ctx.fillStyle = BOIS.sombre;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = BOIS.bord;
    ctx.lineWidth = 0.025;
    ctx.strokeRect(x, y, w, h);
    // Pots, bouteilles, paquets.
    const n = Math.round((long ? w : h) / 0.16);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const px = long ? x + w * t : x + w / 2;
      const py = long ? y + h / 2 : y + h * t;
      const v = h32(k, 7, 41);
      if (v < 0.4) {
        rond(ctx, px, py, 0.07);
        ctx.fillStyle = degrade(ctx, px, py, 0.07, "#d9a873", "#7c4a26");
        ctx.fill();
      } else if (v < 0.7) {
        rond(ctx, px, py, 0.05);
        ctx.fillStyle = degrade(ctx, px, py, 0.05, "#9fc0a0", "#2c4a34");
        ctx.fill();
        rond(ctx, px, py, 0.018);
        ctx.fillStyle = "#c9b48a";
        ctx.fill();
      } else {
        ctx.fillStyle = ["#7b2a22", "#3d4f6a", "#c9b48a"][k % 3];
        ctx.fillRect(px - 0.06, py - 0.08, 0.12, 0.16);
      }
    }
  },
  cheminee(ctx, hw, hh) {
    // Massif de pierre, foyer noirci, braises et flammes.
    ctx.fillStyle = "#6f6860";
    ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(-hw, -hh, hw * 2, hh * 2);
    ctx.clip();
    for (let k = 0; k < 14; k++) {
      const x = -hw + (k % 7) * (hw / 3.5);
      const y = -hh + Math.floor(k / 7) * hh;
      const v = h32(k, 1, 5);
      ctx.fillStyle = `rgb(${110 + 30 * v},${104 + 28 * v},${96 + 24 * v})`;
      rr(ctx, x + 0.02 + (Math.floor(k / 7) % 2) * 0.12, y + 0.02, hw / 3.5 - 0.04, hh - 0.04, 0.04);
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(30,24,18,.8)";
    ctx.lineWidth = 0.03;
    ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
    const f = Math.min(0.32, hw * 0.3);
    rr(ctx, -hw + f, -hh + 0.12, hw * 2 - 2 * f, hh * 2 - 0.12, 0.12);
    ctx.fillStyle = "#1e1612";
    ctx.fill();
    // Bûches et braises.
    ctx.save();
    rr(ctx, -hw + f, -hh + 0.12, hw * 2 - 2 * f, hh * 2 - 0.12, 0.12);
    ctx.clip();
    feu(ctx, 0, 0.12, 0.5);
    ctx.restore();
    ctx.strokeStyle = "#3a2414";
    ctx.lineCap = "round";
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    ctx.moveTo(-0.32, 0.18);
    ctx.lineTo(0.28, 0.02);
    ctx.moveTo(-0.26, -0.02);
    ctx.lineTo(0.32, 0.2);
    ctx.stroke();
    ctx.lineCap = "butt";
    feu(ctx, 0.02, 0.1, 0.24);
  },
  four(ctx) {
    // Four à pain : un dôme de pierre, la gueule rougeoyante.
    rond(ctx, 0, -0.04, 0.44);
    ctx.fillStyle = degrade(ctx, 0, -0.04, 0.44, "#b3aa9c", "#5d564d");
    ctx.fill();
    ctx.strokeStyle = "rgba(40,34,28,.5)";
    ctx.lineWidth = 0.015;
    for (const r of [0.16, 0.28, 0.4]) {
      rond(ctx, 0, -0.04, r);
      ctx.stroke();
    }
    rond(ctx, 0, -0.04, 0.44);
    trait(ctx, "rgba(30,24,18,.85)", 0.025);
    rr(ctx, -0.17, 0.12, 0.34, 0.28, 0.1);
    ctx.fillStyle = "#1e1612";
    ctx.fill();
    feu(ctx, 0, 0.26, 0.16);
  },
  etabli(ctx, hw, hh) {
    MEUBLES_PEINTS.table(ctx, hw, hh);
    // Planche à découper et couteau.
    rr(ctx, -hw * 0.75, -0.16, 0.42, 0.3, 0.05);
    ctx.fillStyle = "#c79a62";
    ctx.fill();
    trait(ctx, BOIS.bord, 0.015);
    ctx.fillStyle = "#c9cdd0";
    ctx.fillRect(-hw * 0.7 + 0.46, -0.03, 0.24, 0.05);
    ctx.fillStyle = BOIS.noir;
    ctx.fillRect(-hw * 0.7 + 0.7, -0.035, 0.1, 0.06);
  },
  enclume(ctx) {
    // Un billot de bois, l'enclume de fer posée dessus.
    rond(ctx, 0, 0.04, 0.4);
    ctx.fillStyle = degrade(ctx, 0, 0.04, 0.4, "#9a6a3c", "#4e321a");
    ctx.fill();
    trait(ctx, BOIS.bord, 0.02);
    for (const r of [0.12, 0.22, 0.32]) {
      rond(ctx, 0, 0.04, r);
      trait(ctx, "rgba(50,28,10,.3)", 0.01);
    }
    ctx.beginPath();
    ctx.moveTo(-0.36, -0.12);
    ctx.lineTo(0.22, -0.12);
    ctx.quadraticCurveTo(0.44, -0.1, 0.44, 0);
    ctx.lineTo(0.2, 0.1);
    ctx.lineTo(0.2, 0.2);
    ctx.lineTo(-0.22, 0.2);
    ctx.lineTo(-0.22, 0.1);
    ctx.lineTo(-0.36, 0.06);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -0.12, 0, 0.2);
    g.addColorStop(0, "#8a8c8a");
    g.addColorStop(0.35, "#4a4c4c");
    g.addColorStop(1, "#242626");
    ctx.fillStyle = g;
    ctx.fill();
    trait(ctx, FER.bord, 0.02);
    ctx.fillStyle = "rgba(255,255,255,.18)";
    ctx.fillRect(-0.3, -0.1, 0.48, 0.035);
  },
  escalier(ctx, hw, hh) {
    marches(ctx, hw, hh, false);
  },
  "escalier-bas"(ctx, hw, hh) {
    marches(ctx, hw, hh, true);
  },
  echelle(ctx) {
    ctx.lineCap = "round";
    ctx.strokeStyle = BOIS.moyen;
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    for (let k = -3; k <= 3; k++) {
      ctx.moveTo(-0.18, k * 0.12);
      ctx.lineTo(0.18, k * 0.12);
    }
    ctx.stroke();
    ctx.lineWidth = 0.08;
    ctx.strokeStyle = BOIS.sombre;
    ctx.beginPath();
    ctx.moveTo(-0.2, -0.43);
    ctx.lineTo(-0.2, 0.43);
    ctx.moveTo(0.2, -0.43);
    ctx.lineTo(0.2, 0.43);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,226,180,.3)";
    ctx.lineWidth = 0.02;
    ctx.stroke();
    ctx.lineCap = "butt";
  },
  bouclier(ctx) {
    // Bouclier rond accroché au mur, cabossé.
    const y = -0.18;
    rond(ctx, 0, y, 0.27);
    ctx.fillStyle = degrade(ctx, 0, y, 0.27, "#a5743f", "#4e321a");
    ctx.fill();
    trait(ctx, "#3d3d3a", 0.04);
    rond(ctx, 0, y, 0.085);
    ctx.fillStyle = degrade(ctx, 0, y, 0.085, "#e6e2d6", "#6a6a64");
    ctx.fill();
    ctx.strokeStyle = "rgba(20,12,4,.7)";
    ctx.lineWidth = 0.018;
    ctx.beginPath();
    ctx.arc(-0.12, y - 0.1, 0.05, 0.3, 2.2);
    ctx.moveTo(0.14, y + 0.08);
    ctx.arc(0.1, y + 0.08, 0.04, 0, 2.6);
    ctx.stroke();
  },
  "planche-contrats"(ctx, hw, hh) {
    const long = hw >= hh;
    const [w, h] = long ? [hw * 2 - 0.16, 0.24] : [0.24, hh * 2 - 0.16];
    const y0 = long ? -hh + 0.05 : -h / 2;
    ctx.fillStyle = BOIS.moyen;
    ctx.fillRect(-w / 2, y0, w, h);
    ctx.strokeStyle = BOIS.bord;
    ctx.lineWidth = 0.02;
    ctx.strokeRect(-w / 2, y0, w, h);
    for (let k = 0; k < 5; k++) {
      const t = -((long ? w : h) / 2) + 0.14 + (k * ((long ? w : h) - 0.28)) / 4;
      ctx.save();
      ctx.translate(long ? t : 0, long ? y0 + h * 0.55 : t);
      ctx.rotate((h32(k, 3, 7) - 0.5) * 0.5);
      ctx.fillStyle = k % 2 ? "#efe3c6" : "#e6d6b0";
      ctx.fillRect(-0.1, -0.12, 0.2, 0.22);
      ctx.strokeStyle = "rgba(60,40,20,.5)";
      ctx.lineWidth = 0.01;
      ctx.beginPath();
      for (let l = 0; l < 4; l++) {
        ctx.moveTo(-0.07, -0.07 + l * 0.04);
        ctx.lineTo(0.06, -0.07 + l * 0.04);
      }
      ctx.stroke();
      rond(ctx, 0, -0.1, 0.022);
      ctx.fillStyle = "#8e1b17";
      ctx.fill();
      ctx.restore();
    }
  },
  trappe(ctx) {
    ctx.fillStyle = BOIS.sombre;
    ctx.fillRect(-0.36, -0.36, 0.72, 0.72);
    planches(ctx, -0.36, -0.36, 0.72, 0.72, 4, "#6e4626", 37);
    ctx.strokeStyle = "#2c2c2a";
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(-0.3, -0.2);
    ctx.lineTo(0.3, -0.2);
    ctx.moveTo(-0.3, 0.2);
    ctx.lineTo(0.3, 0.2);
    ctx.stroke();
    rond(ctx, 0, 0, 0.08);
    trait(ctx, "#8c9398", 0.03);
    ctx.strokeStyle = BOIS.bord;
    ctx.lineWidth = 0.025;
    ctx.strokeRect(-0.36, -0.36, 0.72, 0.72);
  },
  tapis(ctx, hw, hh, teinte) {
    // Laine rouge à bordure ocre, motif en losange, franges aux petits bouts ; la laine prend la teinte choisie.
    const long = hw >= hh;
    const x = -hw + 0.12;
    const y = -hh + 0.12;
    const w = hw * 2 - 0.24;
    const h = hh * 2 - 0.24;
    ctx.strokeStyle = "#cdb88a";
    ctx.lineWidth = 0.012;
    ctx.beginPath();
    const L = long ? h : w;
    for (let k = 0; k <= Math.round(L / 0.05); k++) {
      const t = (k * L) / Math.round(L / 0.05);
      if (long) {
        ctx.moveTo(x - 0.07, y + t);
        ctx.lineTo(x, y + t);
        ctx.moveTo(x + w, y + t);
        ctx.lineTo(x + w + 0.07, y + t);
      } else {
        ctx.moveTo(x + t, y - 0.07);
        ctx.lineTo(x + t, y);
        ctx.moveTo(x + t, y + h);
        ctx.lineTo(x + t, y + h + 0.07);
      }
    }
    ctx.stroke();
    ctx.fillStyle = degrade(ctx, 0, 0, Math.max(hw, hh), teinte || "#9c2c22", teinte ? nuance(teinte, -0.4) : "#5e1812", 0, 0);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#c9a052";
    ctx.lineWidth = 0.07;
    ctx.strokeRect(x + 0.1, y + 0.1, w - 0.2, h - 0.2);
    ctx.strokeStyle = "#2c3e58";
    ctx.lineWidth = 0.03;
    ctx.strokeRect(x + 0.18, y + 0.18, w - 0.36, h - 0.36);
    ctx.beginPath();
    ctx.moveTo(0, -h / 2 + 0.3);
    ctx.lineTo(w / 2 - 0.3, 0);
    ctx.lineTo(0, h / 2 - 0.3);
    ctx.lineTo(-w / 2 + 0.3, 0);
    ctx.closePath();
    ctx.fillStyle = "rgba(201,160,82,.55)";
    ctx.fill();
    ctx.strokeStyle = "#2c3e58";
    ctx.stroke();
    ctx.strokeStyle = "rgba(20,8,4,.5)";
    ctx.lineWidth = 0.02;
    ctx.strokeRect(x, y, w, h);
  },
  stalle(ctx, hw, hh) {
    // Cloisons de planches sur trois côtés, une mangeoire au fond.
    ctx.fillStyle = "#6e4a2a";
    ctx.fillRect(-hw + 0.12, -hh + 0.1, hw * 2 - 0.24, 0.26);
    ctx.fillStyle = "rgba(230,200,120,.9)";
    ctx.fillRect(-hw + 0.18, -hh + 0.15, hw * 2 - 0.36, 0.16);
    ctx.strokeStyle = BOIS.sombre;
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    ctx.moveTo(-hw + 0.06, hh - 0.08);
    ctx.lineTo(-hw + 0.06, -hh + 0.05);
    ctx.lineTo(hw - 0.06, -hh + 0.05);
    ctx.lineTo(hw - 0.06, hh - 0.08);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,220,170,.25)";
    ctx.lineWidth = 0.02;
    ctx.stroke();
  },
  foin(ctx) {
    ctx.beginPath();
    for (let k = 0; k <= 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const r = 0.38 * (0.85 + 0.2 * h32(k % 12, 4, 3));
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r * 0.85;
      if (k) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = degrade(ctx, 0, 0, 0.42, "#f2d78e", "#a9822f");
    ctx.fill();
    pailleSur(ctx, 0, 0, 0.32, 26, 47);
  },
  puits(ctx) {
    rond(ctx, 0, 0, 0.44);
    ctx.fillStyle = "#8b847a";
    ctx.fill();
    for (let k = 0; k < 10; k++) {
      const a0 = (k / 10) * Math.PI * 2;
      const a1 = ((k + 0.9) / 10) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(0, 0, 0.43, a0, a1);
      ctx.arc(0, 0, 0.29, a1, a0, true);
      ctx.closePath();
      const v = 120 + 50 * h32(k, 2, 9);
      ctx.fillStyle = `rgb(${v},${v * 0.96},${v * 0.9})`;
      ctx.fill();
    }
    rond(ctx, 0, 0, 0.28);
    ctx.fillStyle = degrade(ctx, 0, 0, 0.28, "#3d6f88", "#0e2230", 0.25, 0.3);
    ctx.fill();
    rond(ctx, -0.08, -0.08, 0.06);
    ctx.fillStyle = "rgba(220,240,250,.35)";
    ctx.fill();
    ctx.fillStyle = BOIS.moyen;
    ctx.fillRect(-0.5, -0.05, 1.0, 0.1);
    ctx.strokeStyle = BOIS.bord;
    ctx.lineWidth = 0.02;
    ctx.strokeRect(-0.5, -0.05, 1.0, 0.1);
  },
  charrette(ctx, hw, hh) {
    // Brancards vers le bas, roues de chaque côté, plateau de planches à ridelles.
    ctx.strokeStyle = BOIS.moyen;
    ctx.lineCap = "round";
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.moveTo(-0.28, hh - 0.75);
    ctx.lineTo(-0.24, hh - 0.04);
    ctx.moveTo(0.28, hh - 0.75);
    ctx.lineTo(0.24, hh - 0.04);
    ctx.stroke();
    ctx.lineCap = "butt";
    for (const x of [-hw + 0.08, hw - 0.2]) {
      rr(ctx, x, -0.38, 0.12, 0.76, 0.05);
      ctx.fillStyle = "#3a2414";
      ctx.fill();
      ctx.strokeStyle = "rgba(160,160,150,.6)";
      ctx.lineWidth = 0.015;
      ctx.stroke();
    }
    const [x, y, w, h] = [-hw + 0.22, -hh + 0.15, hw * 2 - 0.44, hh * 2 - 0.95];
    ctx.fillStyle = BOIS.moyen;
    ctx.fillRect(x, y, w, h);
    planches(ctx, x, y, w, h, 4, "#9b6a3a", 43);
    ctx.strokeStyle = BOIS.sombre;
    ctx.lineWidth = 0.07;
    ctx.strokeRect(x + 0.035, y + 0.035, w - 0.07, h - 0.07);
  },
  lit(ctx, hw, hh, teinte) {
    rr(ctx, -hw + 0.06, -hh + 0.04, hw * 2 - 0.12, hh * 2 - 0.08, 0.05);
    ctx.fillStyle = BOIS.sombre;
    ctx.fill();
    const long = hh >= hw;
    if (long) {
      rr(ctx, -hw + 0.12, -hh + 0.12, hw * 2 - 0.24, 0.36, 0.08);
      ctx.fillStyle = "#e9e0cc";
      ctx.fill();
      rr(ctx, -hw + 0.1, -hh + 0.55, hw * 2 - 0.2, hh * 2 - 0.66, 0.06);
    } else {
      rr(ctx, -hw + 0.12, -hh + 0.12, 0.36, hh * 2 - 0.24, 0.08);
      ctx.fillStyle = "#e9e0cc";
      ctx.fill();
      rr(ctx, -hw + 0.55, -hh + 0.1, hw * 2 - 0.66, hh * 2 - 0.2, 0.06);
    }
    ctx.fillStyle = teinte || "#6b3a2e";
    ctx.fill();
    ctx.strokeStyle = "rgba(230,200,150,.4)";
    ctx.lineWidth = 0.02;
    ctx.stroke();
  },
  coffre(ctx) {
    rr(ctx, -0.36, -0.26, 0.72, 0.52, 0.05);
    ctx.fillStyle = BOIS.moyen;
    ctx.fill();
    trait(ctx, BOIS.bord, 0.025);
    ctx.fillStyle = "#4a4a46";
    ctx.fillRect(-0.22, -0.26, 0.06, 0.52);
    ctx.fillRect(0.16, -0.26, 0.06, 0.52);
    rond(ctx, 0, 0.2, 0.045);
    ctx.fillStyle = "#c9a052";
    ctx.fill();
  },
  arbre(ctx, hw, hh) {
    // Houppier vu de dessus : des touffes sombres, plus claires au nord-ouest, quelques feuilles au soleil.
    const r = Math.min(hw, hh);
    const touffes = [[0, 0, 0.62], [-0.3, -0.22, 0.42], [0.32, -0.18, 0.4], [0.2, 0.3, 0.42], [-0.28, 0.26, 0.4], [0.02, -0.36, 0.34]];
    ctx.beginPath();
    for (const [x, y, k] of touffes) {
      ctx.moveTo(x * r + k * r * 1.04, y * r);
      ctx.arc(x * r, y * r, k * r * 1.04, 0, Math.PI * 2);
    }
    ctx.fillStyle = "#1f2d17";
    ctx.fill();
    for (const [x, y, k] of touffes) {
      rond(ctx, x * r, y * r, k * r);
      ctx.fillStyle = degrade(ctx, x * r, y * r, k * r, "#6d8a3e", "#2a3d1d", -0.4, -0.45);
      ctx.fill();
    }
    for (let n = 0; n < 26; n++) {
      const a = h32(n, 5, 61) * Math.PI * 2;
      const d = Math.sqrt(h32(n, 6, 61)) * r * 0.75;
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d;
      rond(ctx, x, y, r * (0.07 + 0.06 * h32(n, 7, 61)));
      ctx.fillStyle = x + y < 0 ? "rgba(160,190,100,.35)" : "rgba(20,32,14,.35)";
      ctx.fill();
    }
  },
  autel(ctx, hw, hh) {
    const long = hw >= hh;
    rr(ctx, -hw + 0.08, -hh + 0.12, hw * 2 - 0.16, hh * 2 - 0.24, 0.04);
    const g = ctx.createLinearGradient(-hw, -hh, hw, hh);
    g.addColorStop(0, PIERRE.clair);
    g.addColorStop(1, PIERRE.moyen);
    ctx.fillStyle = g;
    ctx.fill();
    trait(ctx, PIERRE.bord, 0.025);
    // Une nappe pourpre, deux cierges et un livre ouvert.
    ctx.fillStyle = "#6e1f2a";
    if (long) ctx.fillRect(-0.28, -hh + 0.12, 0.56, hh * 2 - 0.24);
    else ctx.fillRect(-hw + 0.08, -0.28, hw * 2 - 0.16, 0.56);
    ctx.fillStyle = "#c9a052";
    if (long) ctx.fillRect(-0.28, -hh + 0.12, 0.56, 0.03);
    else ctx.fillRect(-hw + 0.08, -0.28, hw * 2 - 0.16, 0.03);
    OBJETS_PEINTS.livre(ctx);
    for (const k of [-0.62, 0.62]) {
      const [x, y] = long ? [k * hw, 0] : [0, k * hh];
      OBJETS_PEINTS.chandelle(ctx, x, y);
    }
  },
  statue(ctx) {
    ctx.fillStyle = degrade(ctx, 0, 0, 0.6, PIERRE.clair, PIERRE.sombre);
    ctx.fillRect(-0.42, -0.42, 0.84, 0.84);
    ctx.strokeStyle = PIERRE.bord;
    ctx.lineWidth = 0.025;
    ctx.strokeRect(-0.42, -0.42, 0.84, 0.84);
    // Une silhouette vue d'en haut : épaules, bras, tête.
    ctx.beginPath();
    ctx.ellipse(0, 0.04, 0.3, 0.16, 0, 0, Math.PI * 2);
    ctx.fillStyle = degrade(ctx, 0, 0.04, 0.3, "#d8d2c6", "#7e776c");
    ctx.fill();
    trait(ctx, "rgba(40,34,28,.6)", 0.015);
    rond(ctx, 0, 0, 0.12);
    ctx.fillStyle = degrade(ctx, 0, 0, 0.12, "#e6e0d4", "#8a8378");
    ctx.fill();
    trait(ctx, "rgba(40,34,28,.6)", 0.015);
  },
  colonne(ctx) {
    rond(ctx, 0, 0, 0.4);
    ctx.fillStyle = degrade(ctx, 0, 0, 0.4, "#cfc8ba", "#6a645a");
    ctx.fill();
    trait(ctx, PIERRE.bord, 0.025);
    ctx.strokeStyle = "rgba(40,34,28,.35)";
    ctx.lineWidth = 0.012;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 0.22, Math.sin(a) * 0.22);
      ctx.lineTo(Math.cos(a) * 0.38, Math.sin(a) * 0.38);
      ctx.stroke();
    }
    rond(ctx, 0, 0, 0.2);
    ctx.fillStyle = degrade(ctx, 0, 0, 0.2, "#dcd6c8", "#9a9386");
    ctx.fill();
  },
  sarcophage(ctx, hw, hh) {
    const long = hh >= hw;
    ctx.save();
    if (!long) ctx.rotate(Math.PI / 2);
    const L = Math.max(hw, hh);
    ctx.beginPath();
    ctx.moveTo(-0.27, -L + 0.1);
    ctx.lineTo(0.27, -L + 0.1);
    ctx.lineTo(0.36, -L + 0.55);
    ctx.lineTo(0.24, L - 0.1);
    ctx.lineTo(-0.24, L - 0.1);
    ctx.lineTo(-0.36, -L + 0.55);
    ctx.closePath();
    const g = ctx.createLinearGradient(-0.36, -L, 0.36, L);
    g.addColorStop(0, "#c8c1b2");
    g.addColorStop(1, "#77705f");
    ctx.fillStyle = g;
    ctx.fill();
    trait(ctx, PIERRE.bord, 0.025);
    // Un gisant gravé : la tête, les mains jointes, une épée le long du corps.
    ctx.strokeStyle = "rgba(40,34,28,.55)";
    ctx.lineWidth = 0.02;
    rond(ctx, 0, -L + 0.42, 0.12);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -L + 0.62);
    ctx.lineTo(0, L - 0.3);
    ctx.moveTo(-0.13, -L + 0.85);
    ctx.lineTo(0.13, -L + 0.85);
    ctx.stroke();
    ctx.restore();
  },
  ossements(ctx) {
    ctx.lineCap = "round";
    for (const [x0, y0, x1, y1] of [[-0.3, 0.2, 0.1, 0.05], [-0.1, 0.3, 0.3, 0.28], [0.05, -0.25, 0.3, -0.05]]) {
      ctx.strokeStyle = "#6e675a";
      ctx.lineWidth = 0.075;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.strokeStyle = "#e6ddc8";
      ctx.lineWidth = 0.05;
      ctx.stroke();
      for (const [x, y] of [[x0, y0], [x1, y1]]) {
        rond(ctx, x, y, 0.04);
        ctx.fillStyle = "#e6ddc8";
        ctx.fill();
      }
    }
    ctx.lineCap = "butt";
    OBJETS_PEINTS.crane(ctx, -0.18, -0.16);
  },
  brasero(ctx) {
    rond(ctx, 0, 0, 0.34);
    ctx.fillStyle = degrade(ctx, 0, 0, 0.34, FER.clair, FER.sombre);
    ctx.fill();
    trait(ctx, FER.bord, 0.025);
    rond(ctx, 0, 0, 0.25);
    ctx.fillStyle = "#2a1a10";
    ctx.fill();
    for (let k = 0; k < 9; k++) {
      const a = h32(k, 3, 71) * Math.PI * 2;
      const d = 0.16 * Math.sqrt(h32(k, 4, 71));
      rond(ctx, Math.cos(a) * d, Math.sin(a) * d, 0.05);
      ctx.fillStyle = k % 3 ? "#b8401a" : "#ff9a3a";
      ctx.fill();
    }
    feu(ctx, 0, 0, 0.24);
  },
  cage(ctx) {
    ctx.fillStyle = "rgba(20,16,12,.55)";
    ctx.fillRect(-0.38, -0.38, 0.76, 0.76);
    ctx.lineCap = "round";
    for (const [c, l] of [[FER.sombre, 0.05], [FER.clair, 0.016]]) {
      ctx.strokeStyle = c;
      ctx.lineWidth = l;
      ctx.beginPath();
      for (let k = -2; k <= 2; k++) {
        ctx.moveTo(k * 0.15, -0.38);
        ctx.lineTo(k * 0.15, 0.38);
      }
      ctx.rect(-0.38, -0.38, 0.76, 0.76);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
  },
  rochers(ctx) {
    caillou(ctx, -0.12, 0.05, 0.26, 3);
    caillou(ctx, 0.2, -0.12, 0.18, 5);
    caillou(ctx, 0.16, 0.24, 0.13, 7);
  },
  "gros-rocher"(ctx, hw, hh) {
    const r = Math.min(hw, hh) - 0.1;
    caillou(ctx, 0, 0, r, 11, 10);
    caillou(ctx, r * 0.7, r * 0.55, r * 0.28, 13);
  },
  stalagmite(ctx) {
    rond(ctx, 0, 0, 0.32);
    ctx.fillStyle = degrade(ctx, 0, 0, 0.32, "#d4cbb8", "#4e463c", -0.25, -0.3);
    ctx.fill();
    trait(ctx, PIERRE.bord, 0.02);
    ctx.strokeStyle = "rgba(60,50,40,.35)";
    ctx.lineWidth = 0.012;
    for (const r of [0.1, 0.18, 0.25]) {
      rond(ctx, -0.02, -0.02, r);
      ctx.stroke();
    }
    rond(ctx, -0.05, -0.05, 0.05);
    ctx.fillStyle = "rgba(255,250,236,.55)";
    ctx.fill();
  },
  champignons(ctx) {
    for (const [x, y, r] of [[-0.15, -0.1, 0.14], [0.15, 0.05, 0.11], [-0.02, 0.22, 0.09], [0.22, -0.2, 0.06]]) {
      rond(ctx, x, y, r);
      ctx.fillStyle = degrade(ctx, x, y, r, "#cfe8dc", "#3e6e68");
      ctx.fill();
      trait(ctx, "rgba(20,40,36,.6)", 0.012);
      for (let k = 0; k < 3; k++) {
        rond(ctx, x + (h32(k, Math.round(x * 50), 81) - 0.5) * r, y + (h32(k, Math.round(y * 50), 83) - 0.5) * r, r * 0.12);
        ctx.fillStyle = "rgba(240,250,240,.7)";
        ctx.fill();
      }
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
    ctx.fillStyle = "#fbeee0";
    ctx.fillRect(-0.025, -0.14, 0.05, 0.22);
    rond(ctx, 0, 0.17, 0.03);
    ctx.fill();
  },
  tresor(ctx) {
    for (const [x, y] of [[-0.12, 0.08], [0.12, 0.1], [0, -0.1], [0.2, -0.14], [-0.2, -0.12], [0.02, 0.24]]) {
      rond(ctx, x, y, 0.12);
      ctx.fillStyle = degrade(ctx, x, y, 0.12, "#fff0a0", "#a07818");
      ctx.fill();
      trait(ctx, "#6a4a10", 0.02);
    }
    for (const [x, y, c] of [[-0.05, 0.02, "#c0283a"], [0.16, -0.02, "#2a7ac0"]]) {
      rond(ctx, x, y, 0.05);
      ctx.fillStyle = c;
      ctx.fill();
      rond(ctx, x - 0.015, y - 0.015, 0.015);
      ctx.fillStyle = "rgba(255,255,255,.7)";
      ctx.fill();
    }
  },
};

// ---------------------------------------------------------------- objets d'ambiance (habillage), repère local centré

export const OBJETS_PEINTS = {
  couvert(ctx) {
    rond(ctx, 0, 0, 0.13);
    ctx.fillStyle = degrade(ctx, 0, 0, 0.13, "#f4ecda", "#b9ac92");
    ctx.fill();
    trait(ctx, "rgba(60,40,20,.5)", 0.01);
    rond(ctx, 0.01, 0.01, 0.075);
    ctx.fillStyle = "#8c5a2e";
    ctx.fill();
    rond(ctx, -0.03, -0.02, 0.03);
    ctx.fillStyle = "#6f8a3a";
    ctx.fill();
    ctx.fillStyle = "#c9cdd0";
    ctx.fillRect(0.15, -0.09, 0.025, 0.17);
  },
  chope(ctx) {
    ctx.fillStyle = "#6e4a2a";
    ctx.fillRect(0.06, -0.025, 0.07, 0.05);
    rond(ctx, 0, 0, 0.075);
    ctx.fillStyle = "#7e5530";
    ctx.fill();
    trait(ctx, "#3d3d3a", 0.018);
    rond(ctx, 0, 0, 0.055);
    ctx.fillStyle = degrade(ctx, 0, 0, 0.055, "#fff4d6", "#d8b56c");
    ctx.fill();
  },
  pichet(ctx) {
    ctx.beginPath();
    ctx.moveTo(-0.13, -0.02);
    ctx.lineTo(-0.2, 0);
    ctx.lineTo(-0.13, 0.03);
    ctx.fillStyle = "#a8643a";
    ctx.fill();
    rond(ctx, 0, 0, 0.12);
    ctx.fillStyle = degrade(ctx, 0, 0, 0.12, "#d99a62", "#7a3f20");
    ctx.fill();
    rond(ctx, 0, 0, 0.06);
    ctx.fillStyle = "#3a1c0c";
    ctx.fill();
  },
  chandelle(ctx, x = 0, y = 0) {
    rond(ctx, x, y, 0.07);
    ctx.fillStyle = "#c9b48a";
    ctx.fill();
    rond(ctx, x, y, 0.045);
    ctx.fillStyle = "#f4ecd2";
    ctx.fill();
    feu(ctx, x, y, 0.05);
  },
  lanterne(ctx) {
    ctx.fillStyle = "#2c2c2a";
    ctx.fillRect(-0.1, -0.1, 0.2, 0.2);
    feu(ctx, 0, 0, 0.09);
    ctx.strokeStyle = "#1c1c1a";
    ctx.lineWidth = 0.025;
    ctx.strokeRect(-0.1, -0.1, 0.2, 0.2);
    ctx.beginPath();
    ctx.moveTo(-0.1, 0);
    ctx.lineTo(0.1, 0);
    ctx.moveTo(0, -0.1);
    ctx.lineTo(0, 0.1);
    ctx.lineWidth = 0.012;
    ctx.stroke();
  },
  buches(ctx) {
    for (let k = 0; k < 5; k++) {
      const y = -0.2 + (k % 3) * 0.13 + (k > 2 ? 0.06 : 0);
      const x = k > 2 ? 0.05 : 0;
      rr(ctx, -0.32 + x, y - 0.06, 0.62, 0.12, 0.06);
      ctx.fillStyle = k % 2 ? "#6e4a2a" : "#7e5634";
      ctx.fill();
      trait(ctx, BOIS.bord, 0.012);
      rond(ctx, 0.3 + x, y, 0.058);
      ctx.fillStyle = "#c79a62";
      ctx.fill();
      rond(ctx, 0.3 + x, y, 0.03);
      trait(ctx, "rgba(80,50,20,.6)", 0.01);
    }
  },
  seau(ctx) {
    rond(ctx, 0, 0, 0.15);
    ctx.fillStyle = "#7e5634";
    ctx.fill();
    trait(ctx, "#3d3d3a", 0.025);
    rond(ctx, 0, 0, 0.11);
    ctx.fillStyle = degrade(ctx, 0, 0, 0.11, "#4f7f95", "#1d3644", 0.3, 0.3);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 0.17, Math.PI * 1.1, Math.PI * 1.9);
    trait(ctx, "#5b5b56", 0.015);
  },
  des(ctx) {
    for (const [x, y, a] of [[0, 0, 0.3], [0.1, 0.06, -0.4]]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.fillStyle = "#efe6d2";
      ctx.fillRect(-0.035, -0.035, 0.07, 0.07);
      ctx.fillStyle = "#2a1a0c";
      rond(ctx, 0, 0, 0.01);
      ctx.fill();
      ctx.restore();
    }
  },
  marmite(ctx) {
    rond(ctx, 0, 0, 0.26);
    ctx.fillStyle = degrade(ctx, 0, 0, 0.26, "#55534e", "#151514");
    ctx.fill();
    rond(ctx, 0, 0, 0.2);
    ctx.fillStyle = degrade(ctx, 0, 0, 0.2, "#b98b4a", "#6b4420");
    ctx.fill();
    for (let k = 0; k < 5; k++) {
      rond(ctx, (h32(k, 1, 51) - 0.5) * 0.24, (h32(k, 2, 51) - 0.5) * 0.24, 0.025);
      ctx.fillStyle = k % 2 ? "#d07a2a" : "#7a9a3a";
      ctx.fill();
    }
    ctx.fillStyle = BOIS.moyen;
    ctx.save();
    ctx.rotate(0.6);
    ctx.fillRect(0.04, -0.015, 0.36, 0.03);
    ctx.restore();
  },
  pain(ctx) {
    for (const [x, y, a] of [[-0.12, 0, 0.3], [0.12, 0.04, -0.2]]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.12, 0.08, 0, 0, Math.PI * 2);
      ctx.fillStyle = degrade(ctx, 0, 0, 0.12, "#e0a85e", "#8a5224");
      ctx.fill();
      ctx.strokeStyle = "rgba(80,40,10,.6)";
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      for (const t of [-0.05, 0, 0.05]) {
        ctx.moveTo(t - 0.02, -0.04);
        ctx.lineTo(t + 0.02, 0.04);
      }
      ctx.stroke();
      ctx.restore();
    }
  },
  legumes(ctx) {
    rond(ctx, 0, 0, 0.2);
    ctx.fillStyle = "#9a7444";
    ctx.fill();
    ctx.strokeStyle = "rgba(60,40,20,.5)";
    ctx.lineWidth = 0.012;
    for (const r of [0.08, 0.14, 0.19]) {
      rond(ctx, 0, 0, r);
      ctx.stroke();
    }
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      rond(ctx, Math.cos(a) * 0.08, Math.sin(a) * 0.08, 0.05);
      ctx.fillStyle = ["#d97a2a", "#6f9a3a", "#c9b06a"][k % 3];
      ctx.fill();
    }
  },
  sac(ctx) {
    ctx.beginPath();
    ctx.moveTo(-0.2, -0.14);
    ctx.quadraticCurveTo(-0.28, 0.1, -0.16, 0.24);
    ctx.quadraticCurveTo(0, 0.3, 0.16, 0.24);
    ctx.quadraticCurveTo(0.28, 0.1, 0.2, -0.14);
    ctx.quadraticCurveTo(0, -0.2, -0.2, -0.14);
    ctx.fillStyle = degrade(ctx, 0, 0.04, 0.3, "#d8c79c", "#8c7a52");
    ctx.fill();
    trait(ctx, "rgba(70,56,30,.7)", 0.015);
    ctx.fillStyle = "#6e5a34";
    ctx.beginPath();
    ctx.ellipse(0, -0.17, 0.07, 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(90,74,44,.35)";
    ctx.lineWidth = 0.01;
    ctx.beginPath();
    for (let k = -2; k <= 2; k++) {
      ctx.moveTo(k * 0.06, -0.1);
      ctx.lineTo(k * 0.07, 0.24);
    }
    ctx.stroke();
  },
  jarre(ctx) {
    rond(ctx, 0, 0, 0.2);
    ctx.fillStyle = degrade(ctx, 0, 0, 0.2, "#d4875a", "#7a3a1e");
    ctx.fill();
    trait(ctx, "rgba(60,24,10,.6)", 0.015);
    rond(ctx, 0, 0, 0.08);
    ctx.fillStyle = "#4a2414";
    ctx.fill();
    rond(ctx, 0, 0, 0.1);
    trait(ctx, "#b8744a", 0.02);
  },
  botte(ctx) {
    rr(ctx, -0.36, -0.22, 0.72, 0.44, 0.06);
    ctx.fillStyle = degrade(ctx, 0, 0, 0.42, "#f0d48a", "#b08a3a");
    ctx.fill();
    ctx.save();
    rr(ctx, -0.36, -0.22, 0.72, 0.44, 0.06);
    ctx.clip();
    pailleSur(ctx, 0, 0, 0.36, 30, 61);
    ctx.restore();
    ctx.strokeStyle = "#6a4a22";
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    ctx.moveTo(-0.14, -0.22);
    ctx.lineTo(-0.14, 0.22);
    ctx.moveTo(0.14, -0.22);
    ctx.lineTo(0.14, 0.22);
    ctx.stroke();
  },
  selle(ctx) {
    ctx.fillStyle = BOIS.sombre;
    ctx.fillRect(-0.3, -0.04, 0.6, 0.08);
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.22, 0.15, 0, 0, Math.PI * 2);
    ctx.fillStyle = degrade(ctx, 0, 0, 0.22, "#9a5a32", "#4e2a14");
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-0.04, 0, 0.1, 0.07, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,210,160,.18)";
    ctx.fill();
  },
  abreuvoir(ctx) {
    rr(ctx, -0.42, -0.2, 0.84, 0.4, 0.05);
    ctx.fillStyle = BOIS.moyen;
    ctx.fill();
    trait(ctx, BOIS.bord, 0.025);
    rr(ctx, -0.35, -0.13, 0.7, 0.26, 0.03);
    ctx.fillStyle = degrade(ctx, 0, 0, 0.4, "#4f7f95", "#1d3644", 0.3, 0.3);
    ctx.fill();
  },
  "tas-bois"(ctx) {
    for (let r = 0; r < 2; r++) {
      for (let k = 0; k < 5; k++) {
        const x = -0.4 + k * 0.2 + r * 0.1;
        const y = -0.12 + r * 0.24;
        rond(ctx, x, y, 0.095);
        ctx.fillStyle = "#b8895a";
        ctx.fill();
        trait(ctx, "#5a3a1e", 0.02);
        rond(ctx, x, y, 0.04);
        trait(ctx, "rgba(90,58,30,.6)", 0.01);
      }
    }
  },
  borne(ctx) {
    rr(ctx, -0.14, -0.12, 0.28, 0.24, 0.08);
    ctx.fillStyle = degrade(ctx, 0, 0, 0.2, "#c8c2b4", "#76716a");
    ctx.fill();
    trait(ctx, "rgba(40,36,30,.7)", 0.015);
  },
  "table-ronde"(ctx) {
    MEUBLES_PEINTS["table-ronde"](ctx, 0.5, 0.5);
  },
  tabouret(ctx) {
    MEUBLES_PEINTS.tabouret(ctx);
  },
  "feu-de-camp"(ctx) {
    // Un cercle de pierres, des bûches croisées et les flammes.
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      caillou(ctx, Math.cos(a) * 0.33, Math.sin(a) * 0.33, 0.085, 20 + k, 6);
    }
    rond(ctx, 0, 0, 0.26);
    ctx.fillStyle = "#1e1612";
    ctx.fill();
    ctx.strokeStyle = "#3a2414";
    ctx.lineCap = "round";
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.moveTo(-0.2, 0.12);
    ctx.lineTo(0.18, -0.1);
    ctx.moveTo(-0.16, -0.14);
    ctx.lineTo(0.2, 0.12);
    ctx.stroke();
    ctx.lineCap = "butt";
    feu(ctx, 0, 0, 0.26);
  },
  flaque(ctx) {
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.4, 0.18, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(46,60,72,.75)";
    ctx.fill();
    ctx.strokeStyle = "rgba(160,190,210,.25)";
    ctx.lineWidth = 0.02;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-0.1, -0.05, 0.14, 0.04, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(200,220,235,.18)";
    ctx.fill();
  },
  crane(ctx, x = 0, y = 0) {
    ctx.beginPath();
    ctx.ellipse(x, y, 0.1, 0.12, 0, 0, Math.PI * 2);
    ctx.fillStyle = degrade(ctx, x, y, 0.12, "#f2ead6", "#a89c80");
    ctx.fill();
    trait(ctx, "rgba(60,50,30,.6)", 0.012);
    ctx.fillStyle = "#2a2218";
    rond(ctx, x - 0.04, y + 0.02, 0.025);
    ctx.fill();
    rond(ctx, x + 0.04, y + 0.02, 0.025);
    ctx.fill();
  },
  livre(ctx) {
    ctx.fillStyle = "#4a2418";
    ctx.fillRect(-0.15, -0.11, 0.3, 0.22);
    ctx.fillStyle = "#efe3c6";
    ctx.fillRect(-0.135, -0.095, 0.13, 0.19);
    ctx.fillRect(0.005, -0.095, 0.13, 0.19);
    ctx.strokeStyle = "rgba(60,40,20,.45)";
    ctx.lineWidth = 0.008;
    ctx.beginPath();
    for (let l = 0; l < 4; l++) {
      ctx.moveTo(-0.115, -0.06 + l * 0.04);
      ctx.lineTo(-0.025, -0.06 + l * 0.04);
      ctx.moveTo(0.025, -0.06 + l * 0.04);
      ctx.lineTo(0.115, -0.06 + l * 0.04);
    }
    ctx.stroke();
  },
  bouteille(ctx) {
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.16, 0.06, 0, 0, Math.PI * 2);
    ctx.fillStyle = degrade(ctx, 0, 0, 0.16, "#7fae86", "#1c3a24");
    ctx.fill();
    ctx.fillStyle = "#2c4a34";
    ctx.fillRect(0.14, -0.022, 0.1, 0.044);
    ctx.fillStyle = "#8a6a44";
    ctx.fillRect(0.235, -0.02, 0.03, 0.04);
    ctx.fillStyle = "rgba(230,250,230,.35)";
    ctx.fillRect(-0.1, -0.035, 0.16, 0.014);
  },
  paille(ctx) {
    // Paille éparse sur le sol (posée avant le brouillard et les ombres, voir peint.js).
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.62);
    g.addColorStop(0, "rgba(196,158,76,.75)");
    g.addColorStop(0.6, "rgba(186,148,70,.45)");
    g.addColorStop(1, "rgba(186,148,70,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.62, 0.5, 0.4, 0, Math.PI * 2);
    ctx.fill();
    pailleSur(ctx, 0, 0, 0.5, 90, 17);
  },
  toile(ctx) {
    // Toile d'araignée tendue dans un coin : le coin est au point posé, la toile s'ouvre selon la rotation.
    ctx.strokeStyle = "rgba(238,238,228,.6)";
    ctx.lineWidth = 0.011;
    const R = 0.75;
    ctx.beginPath();
    for (let k = 0; k <= 5; k++) {
      const a = (k / 5) * (Math.PI / 2);
      ctx.moveTo(0.12, 0.12);
      ctx.lineTo(0.12 + Math.cos(a) * R, 0.12 + Math.sin(a) * R);
    }
    for (let r = 0.14; r < R; r += 0.11) {
      ctx.moveTo(0.12 + r, 0.12);
      for (let k = 1; k <= 5; k++) {
        const a = (k / 5) * (Math.PI / 2);
        const m = ((k - 0.5) / 5) * (Math.PI / 2);
        ctx.quadraticCurveTo(0.12 + Math.cos(m) * r * 0.86, 0.12 + Math.sin(m) * r * 0.86, 0.12 + Math.cos(a) * r, 0.12 + Math.sin(a) * r);
      }
    }
    ctx.stroke();
  },
};

// Objets d'habillage qui se posent à même le sol (avant le brouillard), et ceux qui passent par-dessus tout le reste.
export const AU_SOL = new Set(["paille", "ornieres", "flaque"]);
export const PAR_DESSUS = new Set(["toile"]);
// Meubles plats : pas d'ombre portée, seulement un contact léger.
export const PLATS = new Set(["tapis", "trappe", "ossements", "escalier", "escalier-bas", "echelle", "piege", "tresor", "planche-contrats", "bouclier", "champignons"]);
// Grands : leur ombre tombe plus loin.
export const GRANDS = new Set(["arbre", "statue", "colonne", "gros-rocher", "stalagmite"]);

// Le mobilier ajouté le 09/11 (peint-mobilier-plus.js), peint avec les mêmes outils ; une clé d'avant ne change pas.
for (const [cle, f] of Object.entries(meublesPeintsPlus({ rr, rond, degrade, trait, planches, feu, pailleSur, caillou, BOIS, FER, PIERRE, MEUBLES_PEINTS, OBJETS_PEINTS }))) {
  if (!MEUBLES_PEINTS[cle]) MEUBLES_PEINTS[cle] = f;
}
for (const cle of PLATS_PLUS) PLATS.add(cle);
for (const cle of GRANDS_PLUS) GRANDS.add(cle);
// Celui des plans extérieurs (10/11, dehors-peint.js).
for (const [cle, f] of Object.entries(meublesPeintsDehors({ rr, rond, degrade, trait, PIERRE }))) if (!MEUBLES_PEINTS[cle]) MEUBLES_PEINTS[cle] = f;
for (const cle of PLATS_DEHORS) PLATS.add(cle);
for (const cle of GRANDS_DEHORS) GRANDS.add(cle);

// Un meuble du plan, à sa place. options.cache : vu du MJ seul (estompé, cerné de rouge). La teinte choisie (o.teinte)
// vaut pour les meubles qui en ont une (MOBILIER, « teinte »).
export function dessinerMeublePeint(ctx, o, options = {}) {
  const f = MEUBLES_PEINTS[o.cle];
  if (!f) return;
  const b = emprise(o);
  ctx.save();
  ctx.translate((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
  ctx.rotate(((o.rot || 0) * Math.PI) / 180);
  if (options.cache) ctx.globalAlpha = 0.55;
  f(ctx, o.l / 2, o.h / 2, MEUBLES[o.cle]?.teinte ? teinteValide(o.teinte) : null);
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

// Un objet d'habillage : centre en cases, rotation en degrés.
export function dessinerObjetPeint(ctx, cle, x, y, rot = 0, alpha = 1) {
  const f = OBJETS_PEINTS[cle];
  if (!f) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rot * Math.PI) / 180);
  if (alpha < 1) ctx.globalAlpha = alpha;
  f(ctx);
  ctx.restore();
}

// Vignette d'un meuble pour la palette de l'éditeur, avec une ombre légère.
export function vignetteMeublePeint(cle, taille = 44) {
  const m = MEUBLES[cle] || { l: 1, h: 1 };
  const o = { cle, x: 0, y: 0, l: m.l, h: m.h, rot: 0 };
  const dessin = document.createElement("canvas");
  dessin.width = dessin.height = taille;
  const k = (taille - 6) / Math.max(o.l, o.h);
  const g = dessin.getContext("2d");
  g.setTransform(k, 0, 0, k, (taille - o.l * k) / 2, (taille - o.h * k) / 2);
  dessinerMeublePeint(g, o);
  const toile = document.createElement("canvas");
  toile.width = toile.height = taille;
  const ctx = toile.getContext("2d");
  ctx.shadowColor = "rgba(0,0,0,.45)";
  ctx.shadowBlur = 0.08 * k;
  ctx.shadowOffsetX = 0.04 * k;
  ctx.shadowOffsetY = 0.05 * k;
  ctx.drawImage(dessin, 0, 0);
  return toile.toDataURL();
}
