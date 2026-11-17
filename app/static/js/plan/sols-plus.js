// Les sols ajoutés le 09/11, dans les styles couleur et parchemin (rendu.js pose l'aplat de la case, puis appelle ces
// marques dans le chemin en cours, qu'il trace ensuite). Les motifs suivent la grille du plan : un dallage ou un parquet
// se poursuit d'une case à l'autre sans couture.

import { hache } from "./modele.js";
import { solDehorsCouleur, solDehorsParchemin } from "./dehors-dessin.js";

function ligne(ctx, x0, y0, x1, y1) {
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
}

function point(ctx, x, y, r) {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

// Des taches posées au hasard (fixe) dans la case.
function taches(ctx, x, y, n, graine, r0, r1, couleurs) {
  for (let k = 0; k < n; k++) {
    ctx.beginPath();
    point(ctx, x + 0.08 + hache(x, y, k + graine) * 0.84, y + 0.08 + hache(x, y, k + graine + 40) * 0.84, r0 + hache(x, y, k + graine + 80) * (r1 - r0));
    ctx.fillStyle = couleurs[k % couleurs.length];
    ctx.fill();
  }
  ctx.beginPath();
}

// Les hexagones des tomettes : un réseau commun à tout le plan, coupé au bord de la case.
function hexagones(ctx, x, y, r) {
  const dx = Math.sqrt(3) * r;
  const dy = 1.5 * r;
  for (let j = Math.floor(y / dy) - 1; j <= Math.ceil((y + 1) / dy) + 1; j++) {
    for (let i = Math.floor(x / dx) - 1; i <= Math.ceil((x + 1) / dx) + 1; i++) {
      const cx = (i + (j % 2 ? 0.5 : 0)) * dx;
      const cy = j * dy;
      for (let k = 0; k <= 6; k++) {
        const a = Math.PI / 6 + (k / 6) * Math.PI * 2;
        if (k) ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        else ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
    }
  }
}

function lames(ctx, x, y, n, sombre, graine) {
  for (let k = 0; k < n; k++) {
    const t = hache(x, y * n + k, graine);
    ctx.fillStyle = t < 0.5 ? `rgba(40,20,5,${((0.5 - t) * sombre).toFixed(3)})` : `rgba(255,235,200,${((t - 0.5) * 0.12).toFixed(3)})`;
    ctx.fillRect(x, y + k / n, 1, 1 / n);
    ligne(ctx, x, y + k / n, x + 1, y + k / n);
    // Les bouts de lames, décalés d'un rang à l'autre.
    const b = (hache(Math.floor(x / 2), y * n + k, graine + 1) + (x % 2) * 0.5) % 1;
    if (b < 0.5) ligne(ctx, x + 0.1 + b * 1.6, y + k / n, x + 0.1 + b * 1.6, y + (k + 1) / n);
  }
}

// Couleur : les joints et les marques d'un sol, après l'aplat de sa couleur (ou de sa teinte).
export function solPlusCouleur(ctx, cle, x, y, c) {
  switch (cle) {
    case "parquet-clair":
      lames(ctx, x, y, 5, 0.2, 6);
      break;
    case "parquet-sombre":
      lames(ctx, x, y, 5, 0.34, 7);
      break;
    case "pont":
      lames(ctx, x, y, 5, 0.22, 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.strokeStyle = "rgba(20,12,6,.55)";
      for (let k = 1; k < 5; k++) ligne(ctx, x, y + k / 5, x + 1, y + k / 5);
      break;
    case "dalles": {
      ligne(ctx, x, y, x + 1, y);
      ligne(ctx, x, y + 0.5, x + 1, y + 0.5);
      ligne(ctx, x, y, x, y + 0.5);
      ligne(ctx, x + 0.5, y, x + 0.5, y + 0.5);
      const d = y % 2 ? 0.25 : 0.75;
      ligne(ctx, x + d, y + 0.5, x + d, y + 1);
      break;
    }
    case "tomettes":
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, 1, 1);
      ctx.clip();
      ctx.beginPath();
      hexagones(ctx, x, y, 0.19);
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      break;
    case "tapis":
      ctx.strokeStyle = "rgba(230,190,110,.28)";
      ligne(ctx, x, y + 0.5, x + 0.5, y);
      ligne(ctx, x + 0.5, y + 1, x + 1, y + 0.5);
      ligne(ctx, x, y + 0.5, x + 0.5, y + 1);
      ligne(ctx, x + 0.5, y, x + 1, y + 0.5);
      ctx.stroke();
      ctx.beginPath();
      point(ctx, x + 0.5, y + 0.5, 0.05);
      point(ctx, x, y, 0.05);
      ctx.fillStyle = "rgba(230,190,110,.35)";
      ctx.fill();
      ctx.beginPath();
      break;
    case "gravier":
      taches(ctx, x, y, 14, 3, 0.02, 0.05, ["rgba(40,34,26,.35)", "rgba(230,224,210,.3)", "rgba(80,70,58,.3)"]);
      break;
    case "boue":
      taches(ctx, x, y, 4, 5, 0.08, 0.2, ["rgba(30,20,10,.25)", "rgba(60,44,28,.25)"]);
      if (hache(x, y, 9) > 0.55) taches(ctx, x, y, 1, 11, 0.1, 0.16, ["rgba(170,180,170,.18)"]);
      break;
    case "feuilles":
      for (let k = 0; k < 7; k++) {
        ctx.beginPath();
        ctx.ellipse(x + 0.1 + hache(x, y, k + 3) * 0.8, y + 0.1 + hache(x, y, k + 13) * 0.8, 0.07, 0.035, hache(x, y, k + 23) * Math.PI, 0, Math.PI * 2);
        ctx.fillStyle = ["#b8742c", "#9a5222", "#c9a040", "#6e4420"][k % 4];
        ctx.fill();
      }
      ctx.beginPath();
      break;
    case "mousse":
      taches(ctx, x, y, 8, 7, 0.05, 0.12, ["rgba(30,46,18,.35)", "rgba(150,180,90,.25)"]);
      break;
    case "neige":
      taches(ctx, x, y, 3, 9, 0.1, 0.22, ["rgba(140,160,190,.12)"]);
      taches(ctx, x, y, 4, 13, 0.01, 0.02, ["rgba(255,255,255,.9)"]);
      break;
    case "glace":
      ctx.strokeStyle = "rgba(255,255,255,.4)";
      if (hache(x, y, 4) > 0.4) {
        ligne(ctx, x + 0.1, y + hache(x, y, 5), x + 0.5, y + 0.5);
        ctx.lineTo(x + 0.9, y + hache(x, y, 6));
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.strokeStyle = c.joint;
      ligne(ctx, x + 0.2, y + 0.8, x + 0.75, y + 0.25);
      break;
    default:
      // Les sols des plans extérieurs.
      solDehorsCouleur(ctx, cle, x, y);
  }
}

// Parchemin : quelques marques à la plume, dans le chemin en cours ; rien pour les sols d'avant (rendu.js s'en charge).
export function solPlusParchemin(ctx, cle, x, y) {
  if (cle === "parquet-clair" || cle === "parquet-sombre" || cle === "pont") {
    ligne(ctx, x, y + 1 / 3, x + 1, y + 1 / 3);
    ligne(ctx, x, y + 2 / 3, x + 1, y + 2 / 3);
  } else if (cle === "dalles") {
    ligne(ctx, x, y, x + 1, y);
    ligne(ctx, x, y, x, y + 1);
    ligne(ctx, x, y + 0.5, x + 1, y + 0.5);
  } else if (cle === "tomettes") {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, 1, 1);
    ctx.clip();
    ctx.beginPath();
    hexagones(ctx, x, y, 0.19);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
  } else if (cle === "tapis") {
    ligne(ctx, x, y + 0.5, x + 0.5, y);
    ligne(ctx, x + 0.5, y + 1, x + 1, y + 0.5);
  } else if (cle === "glace") {
    ligne(ctx, x + 0.2, y + 0.8, x + 0.75, y + 0.25);
  } else if (cle === "gravier" || cle === "boue" || cle === "feuilles" || cle === "mousse") {
    for (let k = 0; k < 3; k++) {
      const px = x + 0.15 + hache(x, y, k + 3) * 0.7;
      const py = y + 0.15 + hache(x, y, k + 9) * 0.7;
      point(ctx, px, py, cle === "feuilles" ? 0.04 : 0.02);
    }
  } else solDehorsParchemin(ctx, cle, x, y);
}
