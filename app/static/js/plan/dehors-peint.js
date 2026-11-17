// Les sols et le mobilier ajoutés le 10/11 pour les plans extérieurs, dans le style peint : les textures (textures.js
// les ajoute à ses fabriques, avec ses outils), le relief des falaises (peint.js, après les rives), et le mobilier
// (peint-mobilier.js, avec ses outils ; lumière du nord-ouest). Du dessin seulement : aucune donnée de la campagne.

import { SOLS, hache } from "./modele.js";

const h32 = hache;

// Posés à même le sol : pas d'ombre portée. Grands : leur ombre tombe plus loin.
export const PLATS_DEHORS = ["roseaux", "dune"];
export const GRANDS_DEHORS = ["palmier"];

// ---------------------------------------------------------------- les textures

export function fabriquesDehors({ PX, fbmPeriodique, peindrePixels, cailloux, terre, contexte, alea }) {
  const profonde = (k) => {
    const T = PX * 4;
    const fond = fbmPeriodique(T, 3, 3, 211);
    const houle = fbmPeriodique(T, 4, 2, 213);
    const eclat = fbmPeriodique(T, 10, 2, 215);
    return peindrePixels(T, k, (x, y, d, o) => {
      // L'eau d'avant, en plus sombre et plus calme : peu de rides, rarement un reflet.
      const p = 0.5 + 0.5 * fond(x, y);
      const onde = Math.sin(((y + houle(x, y) * 30) / T) * Math.PI * 2 * 16);
      const crete = onde > 0.9 ? (onde - 0.9) / 0.1 : 0;
      const reflet = crete * Math.max(0, eclat(x, y) + 0.05) * 0.55;
      d[o] = 14 + 14 * p + 90 * reflet;
      d[o + 1] = 38 + 22 * p + 100 * reflet;
      d[o + 2] = 58 + 26 * p + 100 * reflet;
    });
  };
  const falaise = (k) => {
    const T = PX * 4;
    const t1 = fbmPeriodique(T, 3, 4, 221);
    const t2 = fbmPeriodique(T, 20, 2, 223);
    const fente = fbmPeriodique(T, 4, 3, 225);
    const strate = fbmPeriodique(T, 2, 2, 227);
    const c = peindrePixels(T, k, (x, y, d, o) => {
      // Un roc sombre, en strates penchées, fendu de failles profondes.
      const a = t1(x, y);
      let f = 0.78 + 0.26 * a + 0.08 * t2(x, y);
      const z = Math.abs(fente(x, y));
      if (z < 0.03) f *= 0.38 + 14 * z;
      const s = Math.sin(((x * 0.4 + y + strate(x, y) * 50) / T) * Math.PI * 2 * 7);
      if (s > 0.9) f *= 0.72;
      else if (s > 0.74) f *= 1.12;
      d[o] = (92 + 8 * a) * f;
      d[o + 1] = (88 + 6 * a) * f;
      d[o + 2] = (88 + 4 * a) * f;
    });
    cailloux(c, k, T, 30, 229, 1.6, 4.6, [70, 36]);
    return c;
  };
  const cultures = (k) => {
    // De la terre en sillons, et les tiges du blé en rangs (tous les cinquante centimètres).
    const T = PX * 4;
    const c = terre(k, 231, [112, 88, 56]);
    const g = contexte(c, k);
    const r = alea(233);
    const rangs = 12;
    g.lineCap = "round";
    for (let n = 0; n < rangs; n++) {
      const x0 = ((n + 0.5) * T) / rangs;
      g.fillStyle = "rgba(60,40,20,.35)";
      g.fillRect(x0 - T / rangs / 2, 0, 2.5, T);
      for (let m = 0; m < 70; m++) {
        const y = r() * T;
        const x = x0 + (r() - 0.5) * 8;
        const l = 5 + r() * 6;
        const v = r();
        g.strokeStyle = v < 0.4 ? "rgba(206,178,88,.95)" : v < 0.75 ? "rgba(176,156,70,.95)" : "rgba(128,140,58,.9)";
        g.lineWidth = 1.3;
        for (const oy of [0, T, -T]) {
          g.beginPath();
          g.moveTo(x, y + oy);
          g.lineTo(x + (r() - 0.5) * 3, y + oy - l);
          g.stroke();
        }
      }
    }
    return c;
  };
  return { "eau-profonde": profonde, falaise, cultures };
}

// ---------------------------------------------------------------- le relief des falaises

// Une falaise jette son ombre au sud-est sur ce qui la borde, et prend la lumière au nord-ouest de son rebord. v : la
// vision (peint.js, vision : les seules cases vues des joueurs dans leur vue).
export function reliefFalaises(ctx, v, x0, y0, x1, y1) {
  const { w, h } = v;
  const id = SOLS.findIndex((s) => s.cle === "falaise");
  const roc = (x, y) => x >= 0 && y >= 0 && x < w && y < h && v.sol[y * w + x] === id;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!v.sol[y * w + x] || roc(x, y)) continue;
      for (const [dx, dy, a] of [[0, -1, 0.6], [-1, 0, 0.46], [0, 1, 0.16], [1, 0, 0.14]]) {
        if (!roc(x + dx, y + dy)) continue;
        const ax = dx > 0 ? x + 1 : dx < 0 ? x : x + 0.5;
        const ay = dy > 0 ? y + 1 : dy < 0 ? y : y + 0.5;
        const g = ctx.createLinearGradient(ax, ay, ax - dx * 0.7, ay - dy * 0.7);
        g.addColorStop(0, `rgba(12,8,4,${a})`);
        g.addColorStop(1, "rgba(12,8,4,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!roc(x, y)) continue;
      for (const [dx, dy] of [[0, 1], [1, 0]]) {
        if (roc(x + dx, y + dy) || x + dx >= w || y + dy >= h || !v.sol[(y + dy) * w + x + dx]) continue;
        // Le rebord éclairé, côté sud et est.
        const ax = dx ? x + 1 : x + 0.5;
        const ay = dy ? y + 1 : y + 0.5;
        const g = ctx.createLinearGradient(ax, ay, ax - dx * 0.3, ay - dy * 0.3);
        g.addColorStop(0, "rgba(236,222,196,.2)");
        g.addColorStop(1, "rgba(236,222,196,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}

// ---------------------------------------------------------------- le mobilier

export function meublesPeintsDehors({ rr, rond, degrade, trait, PIERRE }) {
  return {
    palmier(ctx, hw, hh) {
      const r = Math.min(hw, hh) * 0.98;
      // Les palmes : une nervure claire, des folioles en éventail, plus claires au nord-ouest.
      for (let n = 0; n < 8; n++) {
        const a = (n / 8) * Math.PI * 2 + 0.25 + (h32(n, 1, 241) - 0.5) * 0.3;
        const l = r * (0.85 + 0.15 * h32(n, 2, 241));
        ctx.save();
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(l * 0.45, -l * 0.26, l, 0.05);
        ctx.quadraticCurveTo(l * 0.45, l * 0.24, 0, 0);
        const clair = Math.cos(a + 2.4) > 0;
        const g = ctx.createLinearGradient(0, 0, l, 0);
        g.addColorStop(0, clair ? "#5f7f32" : "#3d5824");
        g.addColorStop(1, clair ? "#9ab854" : "#5f7d34");
        ctx.fillStyle = g;
        ctx.fill();
        trait(ctx, "rgba(20,30,10,.6)", 0.015);
        ctx.strokeStyle = "rgba(30,44,16,.55)";
        ctx.lineWidth = 0.012;
        ctx.beginPath();
        for (let k = 1; k < 9; k++) {
          const t = (k / 9) * l;
          const e = Math.sin((k / 9) * Math.PI) * l * 0.2;
          ctx.moveTo(t, 0);
          ctx.lineTo(t + 0.04, -e);
          ctx.moveTo(t, 0);
          ctx.lineTo(t + 0.04, e);
        }
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(l * 0.5, -0.02, l * 0.96, 0.04);
        trait(ctx, "rgba(220,214,150,.55)", 0.018);
        ctx.restore();
      }
      rond(ctx, 0, 0, 0.12);
      ctx.fillStyle = degrade(ctx, 0, 0, 0.12, "#a07a4a", "#4a3220");
      ctx.fill();
      for (let k = 0; k < 4; k++) {
        rond(ctx, Math.cos(k * 1.6) * 0.1, Math.sin(k * 1.6) * 0.1, 0.045);
        ctx.fillStyle = "#6a4626";
        ctx.fill();
      }
    },
    roseaux(ctx) {
      ctx.lineCap = "round";
      for (let n = 0; n < 11; n++) {
        const x = (h32(n, 1, 251) - 0.5) * 0.76;
        const y = (h32(n, 2, 251) - 0.5) * 0.76;
        const a = (h32(n, 3, 251) - 0.5) * 0.8;
        ctx.beginPath();
        ctx.moveTo(x, y + 0.12);
        ctx.lineTo(x + Math.sin(a) * 0.22, y - 0.12);
        trait(ctx, n % 2 ? "#6f8a3a" : "#4f6a2a", 0.025);
        if (n % 3 === 0) {
          ctx.beginPath();
          ctx.ellipse(x + Math.sin(a) * 0.22, y - 0.13, 0.03, 0.07, a, 0, Math.PI * 2);
          ctx.fillStyle = "#6a4426";
          ctx.fill();
        }
      }
      ctx.lineCap = "butt";
    },
    dune(ctx, hw, hh) {
      // Un croissant de sable : le dos éclairé au nord-ouest, la crête, la pente sous le vent dans l'ombre.
      ctx.save();
      if (hh > hw) ctx.rotate(Math.PI / 2);
      const w = Math.max(hw, hh);
      const h = Math.min(hw, hh);
      const dos = () => {
        ctx.beginPath();
        ctx.moveTo(-w + 0.05, h * 0.5);
        ctx.quadraticCurveTo(0, -h * 1.3, w - 0.05, h * 0.5);
        ctx.quadraticCurveTo(0, -h * 0.6, -w + 0.05, h * 0.5);
      };
      dos();
      const g = ctx.createLinearGradient(0, -h, 0, h * 0.5);
      g.addColorStop(0, "rgba(255,240,200,.35)");
      g.addColorStop(1, "rgba(255,240,200,0)");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-w + 0.05, h * 0.5);
      ctx.quadraticCurveTo(0, -h * 0.6, w - 0.05, h * 0.5);
      ctx.quadraticCurveTo(0, h * 0.2, -w + 0.05, h * 0.5);
      ctx.fillStyle = "rgba(90,60,26,.28)";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-w + 0.05, h * 0.5);
      ctx.quadraticCurveTo(0, -h * 0.6, w - 0.05, h * 0.5);
      trait(ctx, "rgba(255,246,220,.55)", 0.035);
      ctx.restore();
    },
    fontaine(ctx, hw, hh) {
      const r = Math.min(hw, hh) - 0.05;
      const octogone = (q) => {
        ctx.beginPath();
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
          if (k) ctx.lineTo(Math.cos(a) * q, Math.sin(a) * q);
          else ctx.moveTo(Math.cos(a) * q, Math.sin(a) * q);
        }
        ctx.closePath();
      };
      octogone(r);
      const g = ctx.createLinearGradient(-r, -r, r, r);
      g.addColorStop(0, PIERRE.clair);
      g.addColorStop(1, PIERRE.sombre);
      ctx.fillStyle = g;
      ctx.fill();
      trait(ctx, PIERRE.bord, 0.03);
      octogone(r - 0.15);
      const e = ctx.createRadialGradient(-0.2, -0.25, 0.05, 0, 0, r - 0.15);
      e.addColorStop(0, "#4f8aa6");
      e.addColorStop(1, "#1d4256");
      ctx.fillStyle = e;
      ctx.fill();
      trait(ctx, "rgba(20,30,34,.6)", 0.02);
      ctx.strokeStyle = "rgba(210,236,246,.35)";
      ctx.lineWidth = 0.02;
      for (const q of [0.36, 0.52]) {
        ctx.beginPath();
        ctx.arc(0, 0, q, -2.4, -0.9);
        ctx.stroke();
      }
      rond(ctx, 0, 0, 0.2);
      ctx.fillStyle = degrade(ctx, 0, 0, 0.2, PIERRE.clair, PIERRE.sombre);
      ctx.fill();
      trait(ctx, PIERRE.bord, 0.02);
      rond(ctx, 0, 0, 0.07);
      ctx.fillStyle = "#cfe8f2";
      ctx.fill();
    },
    tombe(ctx) {
      rr(ctx, -0.26, -0.38, 0.52, 0.76, 0.2);
      const g = ctx.createLinearGradient(-0.26, -0.38, 0.26, 0.38);
      g.addColorStop(0, PIERRE.clair);
      g.addColorStop(1, PIERRE.sombre);
      ctx.fillStyle = g;
      ctx.fill();
      trait(ctx, PIERRE.bord, 0.025);
      ctx.beginPath();
      ctx.moveTo(0, -0.24);
      ctx.lineTo(0, 0.16);
      ctx.moveTo(-0.12, -0.1);
      ctx.lineTo(0.12, -0.1);
      trait(ctx, "rgba(40,34,28,.7)", 0.035);
      for (let k = 0; k < 5; k++) {
        rond(ctx, (h32(k, 1, 261) - 0.5) * 0.4, 0.22 + h32(k, 2, 261) * 0.1, 0.04);
        ctx.fillStyle = "rgba(90,120,50,.6)";
        ctx.fill();
      }
    },
  };
}
