// Les sols et le mobilier ajoutés le 10/11 pour les plans extérieurs, dans les styles couleur et parchemin (la même main
// que rendu.js et mobilier-plus.js : aplats cernés d'un trait, vus de dessus, dans un repère centré en cases). Le style
// peint est dans dehors-peint.js. Du dessin seulement : aucune donnée de la campagne.

import { hache } from "./modele.js";

function ligne(ctx, x0, y0, x1, y1) {
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
}

// Couleur : les marques d'un sol après l'aplat de sa couleur (rendu.js, dessinerSol). Rend faux si le sol n'est pas
// d'ici.
export function solDehorsCouleur(ctx, cle, x, y) {
  if (cle === "eau-profonde") {
    ctx.fillStyle = "rgba(6,18,30,.22)";
    ctx.fillRect(x, y, 1, 1);
    ctx.strokeStyle = "rgba(190,220,240,.2)";
    ctx.lineWidth = 0.03;
    const k = 0.25 + hache(x, y, 2) * 0.5;
    ctx.moveTo(x + 0.15, y + k);
    ctx.quadraticCurveTo(x + 0.35, y + k - 0.07, x + 0.55, y + k);
    ctx.quadraticCurveTo(x + 0.7, y + k + 0.06, x + 0.85, y + k);
    return true;
  }
  if (cle === "falaise") {
    ctx.fillStyle = "rgba(0,0,0,.2)";
    for (let k = 0; k < 3; k++) {
      const px = x + 0.12 + hache(x, y, k + 3) * 0.76;
      const py = y + 0.12 + hache(x, y, k + 9) * 0.76;
      const r = 0.1 + hache(x, y, k) * 0.12;
      ctx.moveTo(px + r, py);
      ctx.arc(px, py, r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = "rgba(20,14,10,.55)";
    ctx.lineWidth = 0.04;
    const a = hache(x, y, 5);
    ligne(ctx, x + 0.1, y + 0.2 + a * 0.3, x + 0.5, y + 0.5);
    ctx.lineTo(x + 0.85, y + 0.35 + a * 0.4);
    return true;
  }
  if (cle === "cultures") {
    // Des sillons, et les tiges du blé en rangs.
    ctx.strokeStyle = "rgba(70,50,20,.35)";
    ctx.lineWidth = 0.03;
    for (const k of [0.17, 0.5, 0.83]) ligne(ctx, x + k, y, x + k, y + 1);
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = "rgba(220,200,110,.6)";
    for (const k of [0.17, 0.5, 0.83]) {
      for (let n = 0; n < 4; n++) {
        const py = y + 0.1 + n * 0.24 + hache(x * 3 + k * 6, y, n) * 0.08;
        ligne(ctx, x + k - 0.05, py, x + k + 0.05, py - 0.1);
      }
    }
    return true;
  }
  return false;
}

export function solDehorsParchemin(ctx, cle, x, y) {
  if (cle === "eau-profonde") {
    ctx.fillStyle = "rgba(110,140,160,.38)";
    ctx.fillRect(x, y, 1, 1);
    for (const k of [0.25, 0.5, 0.75]) {
      ctx.moveTo(x + 0.1, y + k);
      ctx.quadraticCurveTo(x + 0.3, y + k - 0.07, x + 0.5, y + k);
      ctx.quadraticCurveTo(x + 0.7, y + k + 0.07, x + 0.9, y + k);
    }
    return true;
  }
  if (cle === "falaise") {
    // Des hachures serrées, comme le relief d'une carte gravée.
    ctx.fillStyle = "rgba(43,29,18,.14)";
    ctx.fillRect(x, y, 1, 1);
    for (let k = 0; k < 4; k++) ligne(ctx, x + 0.1 + k * 0.24, y + 0.1, x + k * 0.24 - 0.05, y + 0.9);
    return true;
  }
  if (cle === "cultures") {
    for (const k of [0.25, 0.75]) ligne(ctx, x + k, y + 0.05, x + k, y + 0.95);
    return true;
  }
  return false;
}

// Le mobilier, pour rendu.js (MEUBLE) : mêmes outils que mobilier-plus.js.
export function meublesDehors({ rrect, rond, remplir }) {
  const tracer = (ctx, couleur, l) => {
    ctx.strokeStyle = couleur;
    ctx.lineWidth = l;
    ctx.stroke();
  };
  const papier = (c, parchemin, couleur) => (parchemin ? c.papier : couleur);
  return {
    palmier(ctx, hw, hh, c, parchemin) {
      const r = Math.min(hw, hh) * 0.95;
      // Sept palmes en étoile, une nervure au milieu de chacune.
      for (let n = 0; n < 7; n++) {
        const a = (n / 7) * Math.PI * 2 + 0.3;
        ctx.save();
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(r * 0.45, -r * 0.22, r, 0.04);
        ctx.quadraticCurveTo(r * 0.45, r * 0.2, 0, 0);
        remplir(ctx, papier(c, parchemin, n % 2 ? c.vert : c.vertClair), c);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(r * 0.5, -0.02, r * 0.95, 0.03);
        tracer(ctx, c.trait, c.lw * 0.6);
        ctx.restore();
      }
      rond(ctx, 0, 0, 0.13);
      remplir(ctx, papier(c, parchemin, c.boisSombre), c);
    },
    roseaux(ctx, hw, hh, c, parchemin) {
      for (let n = 0; n < 7; n++) {
        const x = (hache(n, 1, 71) - 0.5) * 0.7;
        const y = (hache(n, 2, 71) - 0.5) * 0.7;
        ctx.beginPath();
        ctx.moveTo(x, y + 0.14);
        ctx.lineTo(x + 0.04, y - 0.14);
        tracer(ctx, parchemin ? c.trait : c.vert, 0.03);
        ctx.beginPath();
        ctx.ellipse(x + 0.04, y - 0.16, 0.035, 0.075, 0.2, 0, Math.PI * 2);
        remplir(ctx, papier(c, parchemin, c.boisSombre), c);
      }
    },
    dune(ctx, hw, hh, c, parchemin) {
      // Un croissant de sable : le dos au vent, la crête, l'ombre au pied.
      const w = Math.max(hw, hh);
      const h = Math.min(hw, hh);
      ctx.save();
      if (hh > hw) ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(-w + 0.1, h * 0.4);
      ctx.quadraticCurveTo(0, -h * 1.2, w - 0.1, h * 0.4);
      ctx.quadraticCurveTo(0, -h * 0.3, -w + 0.1, h * 0.4);
      ctx.fillStyle = parchemin ? "rgba(43,29,18,.12)" : "rgba(80,56,24,.22)";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-w + 0.1, h * 0.4);
      ctx.quadraticCurveTo(0, -h * 1.2, w - 0.1, h * 0.4);
      tracer(ctx, parchemin ? c.trait : "rgba(250,236,200,.7)", parchemin ? c.lw : 0.05);
      ctx.restore();
    },
    fontaine(ctx, hw, hh, c, parchemin) {
      const r = Math.min(hw, hh) - 0.06;
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
        if (k) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      remplir(ctx, c.pierre, c);
      rond(ctx, 0, 0, r - 0.16);
      remplir(ctx, parchemin ? "#dfe3dd" : c.eau, c);
      rond(ctx, 0, 0, 0.2);
      remplir(ctx, c.pierreClair, c);
      rond(ctx, 0, 0, 0.08);
      remplir(ctx, parchemin ? c.papier : "#9fc8de", c);
    },
    tombe(ctx, hw, hh, c) {
      rrect(ctx, -0.26, -0.38, 0.52, 0.76, 0.2);
      remplir(ctx, c.pierreClair, c);
      ctx.beginPath();
      ctx.moveTo(0, -0.24);
      ctx.lineTo(0, 0.16);
      ctx.moveTo(-0.12, -0.1);
      ctx.lineTo(0.12, -0.1);
      tracer(ctx, c.trait, c.lw);
    },
  };
}
