// Les pions en figurines (19/11) : une figurine de papier debout sur son socle rond, comme sur une vraie table. Le socle
// prend la couleur du pion (celle du joueur pour un héros), le support porte le portrait ou les initiales dans un cadre
// de métal selon le genre ; à terre, la figurine se couche sur son socle. rendu.js l'appelle pour chaque pion (TV,
// atelier, coin des joueurs) et lit la place qu'il prend (silhouette, boitePlaque) ; le module dit aussi qui a la main
// (mainDuCombat) et si un toucher prend la figurine (dansFigurine).
// Rien ici d'un navigateur récent : la TV a Chromium 79 (ni roundRect, ni at()).

import { formeDuPion } from "./pions.js";
import { ecrire as ecrireTexte, rrect } from "./trace.js";

// Les proportions, en rayons de pion (le rayon d'avant : 0,42 case pour un pion moyen). Le socle est une ellipse sous le
// centre de la case ; le support debout monte un peu sur la case du dessus.
const SOCLE = { dy: 0.42, rx: 1.08, ry: 0.56, ep: 0.16 };
const SUPPORT = { l: 1.56, h: 1.98 };
const PIED = SOCLE.dy + SOCLE.ry * 0.1;

// La place que prend une figurine de rayon r autour du centre de sa case, en cases : le haut du support (négatif), le
// bas du socle et la demi-largeur. ep : l'épaisseur réglée du pion (fin, normal, épais).
export function silhouette(r, ep = 1) {
  return { haut: r * (PIED - SUPPORT.h), bas: r * (SOCLE.dy + SOCLE.ry + SOCLE.ep * ep), demi: r * SOCLE.rx };
}

// Le socle d'un pion sans couleur choisie : celle de son genre, plus sourde que l'anneau d'avant.
const SOCLES = { heros: "#c29b5c", ennemi: "#5a1410", pnj: "#7a5530", autre: "#55604a" };
// Le cadre du support, en trois tons (clair, moyen, sombre) : or pour les héros, fer pour les ennemis, bronze pour les
// PNJ, argent pour les familiers, étain pour le reste.
const METAL = {
  heros: ["#f6dc98", "#c99a45", "#6e4c17"],
  ennemi: ["#a9abb1", "#5c5e64", "#1e1f23"],
  pnj: ["#e3b282", "#a5683a", "#4f2d14"],
  familier: ["#f1f4f0", "#a9b7ae", "#4d5a52"],
  autre: ["#d9d3c2", "#8f8775", "#3d382d"],
};
const PAPIER = "#f3e9d2";
const ENCRE = "#2b1d12";

export const estFamilier = (t) => t.familier === true || String(t.ref || "").indexOf("familier:") === 0;

// Une couleur #rgb, #rrggbb ou #rrggbbaa en [r, g, b] ; null si elle ne se lit pas.
function rvb(c) {
  const m = /^#([0-9a-f]{3,8})$/i.exec(String(c || "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split("").map((x) => x + x).join("");
  if (h.length < 6) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
const melange = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const css = (c) => `rgb(${c.join(",")})`;
const clair = (c, k) => css(melange(c, [255, 255, 255], k));
const sombre = (c, k) => css(melange(c, [0, 0, 0], k));
const luminance = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
const SOMBRE = 0.14;
// Une couleur trop sombre pour se voir sur le sol (un joueur en noir) : elle prend un liseré clair.
export const tropSombre = (c) => {
  const v = rvb(c);
  return Boolean(v) && luminance(v) < SOMBRE;
};

// La couleur du socle : celle que le MJ a choisie (ou celle du joueur), sinon celle du genre.
function couleurSocle(t) {
  return rvb(t.couleur) || rvb(SOCLES[t.genre] || SOCLES.autre);
}

function ombre(ctx, x, y, rx, ry, a) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, rx * 0.35, 0, 0, rx);
  g.addColorStop(0, `rgba(0,0,0,${a})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function ellipse(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
}

// Le contour du support debout, posé sur y0 (son pied) : arrondi en haut pour un pion rond, droit pour un carré ou un
// blason (un blason a sa pointe en bas, que le socle cache).
function cheminSupport(ctx, forme, x, y0, l, h) {
  const d = l / 2;
  ctx.beginPath();
  if (forme === "carre" || forme === "blason") {
    const k = forme === "carre" ? d * 0.22 : d * 0.08;
    ctx.moveTo(x - d, y0);
    ctx.lineTo(x - d, y0 - h + k);
    ctx.quadraticCurveTo(x - d, y0 - h, x - d + k, y0 - h);
    ctx.lineTo(x + d - k, y0 - h);
    ctx.quadraticCurveTo(x + d, y0 - h, x + d, y0 - h + k);
    ctx.lineTo(x + d, y0);
    ctx.closePath();
    return;
  }
  ctx.moveTo(x - d, y0);
  ctx.lineTo(x - d, y0 - h + d);
  ctx.arc(x, y0 - h + d, d, Math.PI, 0);
  ctx.lineTo(x + d, y0);
  ctx.closePath();
}

// Les lettres d'une figurine (initiales, numéro) : Cinzel grasse, sans halo, resserrée au besoin.
const ecrire = (ctx, chaine, x, y, taille, couleur, largeurMax) =>
  ecrireTexte(ctx, chaine, x, y, { taille, police: "700 {t}px Cinzel", couleur, halo: null, largeurMax });

// Le losange des ennemis (celui du bandeau du combat) : un ennemi sans numéro ni nom, vu des joueurs.
function losange(ctx, x, y, a) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = "#b3261e";
  ctx.fillRect(-a / 2, -a / 2, a, a);
  ctx.strokeStyle = "#f4ead4";
  ctx.lineWidth = a * 0.16;
  ctx.strokeRect(-a * 0.3, -a * 0.3, a * 0.6, a * 0.6);
  ctx.restore();
}

// Une figurine de rayon r au centre (x, y) de sa case.
// o : img (l'image chargée, ou rien), initiales, numero (celui d'un ennemi), parchemin, mystere (le losange au lieu des
// lettres), ep (l'épaisseur réglée : 0,5, 1 ou 1,8), leve (0 à 1 : la figurine soulevée), eclat (0 à 1 : la lueur de qui
// a la main), flash ({ k, rvb } : un coup ou un soin), chute (0 à 1 : la figurine qui tombe), lisible (les tailles du
// canapé sur la TV).
export function dessinerFigurine(ctx, t, x, y, r, o = {}) {
  const forme = formeDuPion(t);
  const familier = estFamilier(t);
  let base = couleurSocle(t);
  if (t.tombe) base = melange(base, [90, 82, 75], 0.65);
  const sombreBase = luminance(base) < SOMBRE;
  const by = y + r * SOCLE.dy;
  const rx = r * SOCLE.rx;
  const ry = r * SOCLE.ry;
  const ep = r * SOCLE.ep * (o.ep || 1);
  const leve = o.leve || 0;

  // L'ombre portée, plus large et plus pâle quand la figurine est soulevée.
  ombre(ctx, x + r * 0.12, by + ep + r * 0.1, r * (1.25 + leve * 0.2), r * (0.62 + leve * 0.1), (o.parchemin ? 0.3 : 0.55) - leve * 0.15);

  // Le halo au sol de qui a la main, sous le socle.
  if (o.eclat > 0) {
    const teinte = t.genre === "ennemi" || sombreBase ? [255, 207, 112] : melange(base, [255, 240, 200], 0.25);
    ctx.save();
    ctx.translate(x, by);
    ctx.scale(1, ry / rx);
    const halo = ctx.createRadialGradient(0, 0, rx * 0.8, 0, 0, rx * (1.7 + 0.15 * o.eclat));
    halo.addColorStop(0, `rgba(${teinte.join(",")},${(0.3 + 0.3 * o.eclat).toFixed(3)})`);
    halo.addColorStop(1, `rgba(${teinte.join(",")},0)`);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, rx * 1.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Le socle : son flanc, puis le dessus, avec un liseré clair qui détache une couleur sombre du sol.
  ellipse(ctx, x, by + ep, rx, ry);
  ctx.fillStyle = sombre(base, 0.55);
  ctx.fill();
  ctx.fillRect(x - rx, by, 2 * rx, ep);
  const g = ctx.createLinearGradient(x - rx, by - ry, x + rx, by + ry);
  g.addColorStop(0, clair(base, 0.35));
  g.addColorStop(1, sombre(base, 0.2));
  ellipse(ctx, x, by, rx, ry);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(0.012, r * 0.045);
  ctx.strokeStyle = sombreBase ? "rgba(244,234,212,.7)" : "rgba(255,255,255,.38)";
  ctx.stroke();
  if (sombreBase) {
    // Une couleur très sombre (un joueur en noir) garde aussi un bord clair au flanc : le pion se voit sur un plan sombre.
    ellipse(ctx, x, by + ep, rx, ry);
    ctx.strokeStyle = "rgba(244,234,212,.35)";
    ctx.stroke();
  }
  // La lueur de qui a la main : un halo lent au sol, à la couleur du pion (d'or pour un ennemi ou une couleur trop
  // sombre), et un cercle d'or autour du socle, qui respirent. Sur la TV, le cercle garde l'épaisseur d'un anneau lisible.
  if (o.eclat > 0) {
    ellipse(ctx, x, by, rx * 1.1, ry * 1.14);
    ctx.strokeStyle = `rgba(255,214,120,${(0.45 + 0.45 * o.eclat).toFixed(3)})`;
    ctx.lineWidth = Math.max(0.03, r * 0.09, o.lisible ? o.lisible.anneau * 0.8 : 0);
    ctx.stroke();
  }

  // Le support : debout (et soulevé), ou couché sur le socle quand le pion est à terre.
  const l = r * SUPPORT.l;
  const h = r * SUPPORT.h;
  const pied = y + r * PIED;
  ctx.save();
  if (t.tombe) {
    // o.chute : la figurine qui bascule (de 0 à 1), une fois couchée elle le reste.
    const c = o.chute >= 0 && o.chute < 1 ? o.chute * o.chute : 1;
    ctx.translate(x, pied);
    ctx.rotate(-1.35 * c);
    ctx.scale(1, 1 - 0.38 * c);
    ctx.translate(-x, -pied);
  } else if (leve) {
    ctx.translate(0, -leve * r * 0.35);
  }
  ombre(ctx, x + r * 0.05, pied - r * 0.02, r * 0.75, r * 0.75, 0.5);
  const metal = METAL[familier ? "familier" : t.genre] || METAL.autre;
  cheminSupport(ctx, forme, x, pied, l, h);
  const mg = ctx.createLinearGradient(x - l / 2, 0, x + l / 2, 0);
  mg.addColorStop(0, metal[0]);
  mg.addColorStop(0.5, metal[1]);
  mg.addColorStop(1, metal[2]);
  ctx.fillStyle = mg;
  ctx.fill();
  ctx.strokeStyle = "rgba(20,12,4,.85)";
  ctx.lineWidth = Math.max(0.01, r * 0.04);
  ctx.stroke();
  // L'intérieur : le portrait (le visage est dans le haut de l'image), ou les initiales sur fond sombre.
  const m = r * 0.1;
  const li = l - 2 * m;
  const hi = h - 2 * m;
  const haut = pied - m - hi;
  ctx.save();
  cheminSupport(ctx, forme, x, pied - m, li, hi);
  ctx.clip();
  ctx.fillStyle = o.parchemin ? PAPIER : t.genre === "ennemi" ? "#2a0d0a" : "#2a2119";
  ctx.fillRect(x - l, haut - m, 2 * l, h + m);
  const im = o.img;
  const vu = !!(im && im.complete && im.naturalWidth);
  if (vu) {
    const k = Math.max(li / im.naturalWidth, hi / im.naturalHeight);
    const iw = im.naturalWidth * k;
    const ih = im.naturalHeight * k;
    ctx.drawImage(im, x - iw / 2, haut - (ih - hi) * 0.18, iw, ih);
    if (t.tombe) {
      ctx.globalCompositeOperation = "saturation";
      ctx.fillStyle = "rgba(60,60,60,.6)";
      ctx.fillRect(x - l, haut - m, 2 * l, h + m);
      ctx.globalCompositeOperation = "source-over";
    }
  } else if (o.mystere) {
    losange(ctx, x, haut + hi * 0.5, li * 0.42);
  } else if (o.numero) {
    // Un ennemi sans image : le losange des ennemis, son numéro est peint sur le socle.
    losange(ctx, x, haut + hi * 0.48, li * 0.36);
  } else if (o.initiales) {
    ecrire(ctx, o.initiales, x, haut + hi * 0.52, li * (o.initiales.length > 1 ? 0.62 : 0.78), o.parchemin ? ENCRE : "#f1dfb5", li * 0.9);
  }
  // Le relief : un reflet en haut, l'ombre en bas.
  const rg = ctx.createLinearGradient(0, haut, 0, pied);
  rg.addColorStop(0, "rgba(255,255,255,.14)");
  rg.addColorStop(0.55, "rgba(0,0,0,0)");
  rg.addColorStop(1, "rgba(0,0,0,.42)");
  ctx.fillStyle = rg;
  ctx.fillRect(x - l, haut - m, 2 * l, h + m);
  if (o.flash && o.flash.k > 0) {
    ctx.fillStyle = `rgba(${o.flash.rvb.join(",")},${(0.75 * o.flash.k).toFixed(3)})`;
    ctx.fillRect(x - l, haut - m, 2 * l, h + m);
  }
  ctx.restore();
  ctx.restore();

  // Le numéro d'un ennemi, peint sur une plaque au devant du socle : lisible du canapé sur la TV.
  if (o.numero) plaqueNumero(ctx, x, by + ry * PLAQUE_DY, r, o.numero, o.lisible);
}

// La plaque du numéro : au devant du socle (en hauteurs du socle sous son centre), la hauteur du chiffre, de la plaque
// et sa largeur. Sur la TV (lisible), le chiffre prend la taille du canapé, jamais plus que le pion ne le permet.
const PLAQUE_DY = 0.62;
function mesurePlaque(r, numero, lisible) {
  const hc = Math.min(Math.max(0.2, r * 0.55, lisible ? lisible.numero : 0), r * 1.25);
  const hp = hc * 1.02;
  return { hc, hp, lp: Math.max(hp * 1.05, hc * (0.62 * String(numero).length + 0.42)) };
}

// La boîte de la plaque du numéro d'un pion de rayon r au centre (x, y) de sa case, en cases : le nombre d'un groupe se
// pose à sa droite, le nom et l'étiquette dessous.
export function boitePlaque(x, y, r, numero, lisible) {
  const { hp, lp } = mesurePlaque(r, numero, lisible);
  const cy = y + r * (SOCLE.dy + SOCLE.ry * PLAQUE_DY);
  return { x0: x - lp / 2, x1: x + lp / 2, y0: cy - hp / 2, y1: cy + hp / 2 };
}

// La plaque du numéro, centrée en (x, y) : rouge sombre, liseré clair, le chiffre en Cinzel.
function plaqueNumero(ctx, x, y, r, numero, lisible) {
  const { hc, hp, lp } = mesurePlaque(r, numero, lisible);
  const n = String(numero);
  ctx.save();
  rrect(ctx, x - lp / 2, y - hp / 2, lp, hp, hp * 0.28);
  ctx.fillStyle = "rgba(0,0,0,.45)";
  ctx.translate(hp * 0.05, hp * 0.08);
  ctx.fill();
  ctx.translate(-hp * 0.05, -hp * 0.08);
  const g = ctx.createLinearGradient(0, y - hp / 2, 0, y + hp / 2);
  g.addColorStop(0, "#b8352b");
  g.addColorStop(1, "#6d140f");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "#e9c77b";
  ctx.lineWidth = hp * 0.09;
  ctx.stroke();
  ctx.restore();
  ecrire(ctx, n, x, y + hc * 0.04, hc * 0.86, "#fff3e0", lp * 0.86);
}

// Autour du socle : l'anneau doré du pion choisi dans l'éditeur, ou le pointillé d'un pion que la TV ne montre pas.
export function cernerSocle(ctx, x, y, r, ecart, couleur, largeur, tirets) {
  ellipse(ctx, x, y + r * SOCLE.dy, r * SOCLE.rx + ecart, r * SOCLE.ry + ecart);
  if (tirets) ctx.setLineDash(tirets);
  ctx.strokeStyle = couleur;
  ctx.lineWidth = largeur;
  ctx.stroke();
  if (tirets) ctx.setLineDash([]);
}

// La poussière qui retombe quand une figurine se pose (k : de 0 à 1, 600 ms).
export function dessinerPoussiere(ctx, x, y, r, k) {
  if (!(k >= 0 && k < 1)) return;
  ctx.save();
  ctx.fillStyle = "#d8c6a2";
  ctx.globalAlpha *= 0.45 * (1 - k);
  for (let i = 0; i < 9; i++) {
    const an = (i / 9) * Math.PI * 2 + i * 0.37;
    const d = r * (0.85 + (0.55 + (i % 3) * 0.2) * k);
    ctx.beginPath();
    ctx.arc(x + Math.cos(an) * d, y + r * SOCLE.dy + Math.sin(an) * d * SOCLE.ry, r * (0.11 + 0.09 * k), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Le fil pointillé qui relie un familier à son héros quand ils sont proches (moins de 2,6 cases), à la couleur du héros,
// d'un socle à l'autre.
const FIL_MAX = 2.6;
export function dessinerFil(ctx, f, m, couleur) {
  const d = Math.hypot(f.x - m.x, f.y - m.y);
  if (!(d > 0.3 && d < FIL_MAX)) return;
  const yf = f.y + 0.42 * (f.taille || 1) * SOCLE.dy;
  const ym = m.y + 0.42 * (m.taille || 1) * SOCLE.dy;
  ctx.save();
  ctx.setLineDash([0.07, 0.09]);
  ctx.lineCap = "round";
  ctx.strokeStyle = couleur;
  ctx.globalAlpha *= 0.75 * Math.min(1, (FIL_MAX - d) / 0.6);
  ctx.lineWidth = 0.045;
  ctx.beginPath();
  ctx.moveTo(f.x, yf);
  ctx.quadraticCurveTo((f.x + m.x) / 2, Math.max(yf, ym) + 0.35, m.x, ym);
  ctx.stroke();
  ctx.restore();
}

// Les pions qui ont la main, d'après le bandeau du combat que montre la TV (combat_public) : le héros dont c'est le tour
// (par son jeton, « heros », le même sur son pion), ou les ennemis debout quand c'est à eux. null hors combat.
export function mainDuCombat(pions, combat) {
  const x = combat && Array.isArray(combat.ordre) && Number.isInteger(combat.actif) ? combat.ordre[combat.actif] : null;
  if (!x) return null;
  const ids = new Set();
  for (const t of pions) {
    if (x.genre === "ennemis" ? t.genre === "ennemi" && !t.tombe : x.heros && t.heros === x.heros) ids.add(t.id);
  }
  return ids;
}

// Le point (x, y), en cases, touche-t-il la figurine ? Son support debout (le portrait, qui monte un peu sur la case du
// dessus) ou son socle : on la prend par la tête comme par le pied.
export function dansFigurine(t, x, y) {
  const r = 0.42 * (t.taille || 1);
  const dx = x - t.x;
  const dy = y - t.y;
  const pied = r * PIED;
  if (Math.abs(dx) <= (r * SUPPORT.l) / 2 && dy >= pied - r * SUPPORT.h && dy <= pied) return true;
  const ex = dx / (r * SOCLE.rx);
  const ey = (dy - r * SOCLE.dy) / (r * SOCLE.ry);
  return ex * ex + ey * ey <= 1 || Math.hypot(dx, dy) <= r * 1.07;
}
