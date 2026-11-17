// Ce qui se pose sur le relief peint, à chaque image : noms au halo doux (une lueur floue, pas un contour), icônes des
// lieux avec leur ombre au sol, cadre, cartouche, rose et échelle de l'atelier, brouillard des joueurs.
// Le halo coûte cher (flou d'ombre) : il est peint une fois par nom et par cran d'échelle dans une petite toile, puis
// posé en image ; les lettres, elles, se tracent nettes à chaque image.

import { STYLES_TEXTE, dessinerDecor, dessinerGroupeCarte, styleNomLieu } from "./rendu.js";
import { decalagesDesNoms } from "./noms.js";
import { dessinerIcone } from "./symboles.js";

const ENCRE = "#22180f";
const HALO = "rgba(252,246,228,.95)";
const SANG = "#8e1b17";
const F = 32; // taille de mise en page : Chrome perd des lettres écrites trop petit, tout s'écrit en 32 px puis se réduit

let ctxMesure = null;
const mises = new Map();
const halos = new Map();
// Halos nouveaux peints par image : au-delà de ce temps (ms), un halo d'un autre cran attend l'image suivante (la TV est
// lente, un zoom en demande des dizaines d'un coup). null : sans limite (export, capture).
const BUDGET_HALOS = 6;
let finBudget = null;
let enRetard = false;

// Place de chaque lettre (en unités de la police à 32 px), droite ou en arc, et boîte de l'ensemble.
function miseEnPage(chaine, police, espacement, courbure, aligne) {
  const cle = [chaine, police, espacement, courbure, aligne].join("|");
  let m = mises.get(cle);
  if (m) return m;
  if (!ctxMesure) ctxMesure = document.createElement("canvas").getContext("2d");
  ctxMesure.font = police.replace("{t}", F);
  const car = Array.from(chaine);
  const larg = car.map((c) => ctxMesure.measureText(c).width);
  const esp = espacement * F;
  const total = larg.reduce((a, b) => a + b, 0) + esp * Math.max(0, car.length - 1);
  const places = [];
  if (Math.abs(courbure) < 0.01) {
    let cx = aligne === "gauche" ? 0 : -total / 2;
    for (let i = 0; i < car.length; i++) {
      places.push([cx + larg[i] / 2, 0, 0]);
      cx += larg[i] + esp;
    }
  } else {
    const R = total / courbure;
    let s = 0;
    for (let i = 0; i < car.length; i++) {
      const a = (s + larg[i] / 2 - total / 2) / R;
      places.push([R * Math.sin(a), R - R * Math.cos(a), a]);
      s += larg[i] + esp;
    }
  }
  let x0 = 0;
  let y0 = -0.75 * F;
  let x1 = 0;
  let y1 = 0.75 * F;
  places.forEach(([px, py], i) => {
    const r = Math.max(larg[i] / 2, 0.75 * F);
    x0 = Math.min(x0, px - r);
    x1 = Math.max(x1, px + r);
    y0 = Math.min(y0, py - r);
    y1 = Math.max(y1, py + r);
  });
  m = { cle, car, places, total, boite: { x0, y0, x1, y1 }, police };
  if (mises.size > 1500) mises.clear();
  mises.set(cle, m);
  return m;
}

function lettres(ctx, m, style) {
  ctx.fillStyle = style;
  for (let i = 0; i < m.car.length; i++) {
    const [px, py, a] = m.places[i];
    if (a) {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(a);
      ctx.fillText(m.car[i], 0, 0);
      ctx.restore();
    } else ctx.fillText(m.car[i], px, py);
  }
}

// Le halo d'un texte à l'échelle e (pixels par unité de police), arrondie à un cran (un tiers d'octave) et plafonnée :
// un halo est flou, l'agrandir ne se voit pas. rapide : pendant un mouvement, un halo d'un autre cran fait l'affaire.
function halo(m, o, e, rapide) {
  const base = [m.cle, o.halo, o.douceur, o.force].join("|");
  let crans = halos.get(base);
  if (!crans) {
    crans = new Map();
    halos.set(base, crans);
    if (halos.size > 900) halos.delete(halos.keys().next().value);
  }
  const cran = Math.max(-9, Math.min(1, Math.round(Math.log2(Math.max(e, 1e-3)) * 3)));
  let v = crans.get(cran);
  if (v) return v;
  const presse = finBudget !== null && performance.now() > finBudget;
  if ((rapide || presse) && crans.size) {
    if (presse) enRetard = true;
    let meilleur = null;
    for (const [c, x] of crans) if (!meilleur || Math.abs(c - cran) < Math.abs(meilleur[0] - cran)) meilleur = [c, x];
    return meilleur[1];
  }
  if (presse) {
    enRetard = true;
    return null;
  }
  const ev = 2 ** (cran / 3);
  const marge = F * (o.douceur + 0.15);
  const b = m.boite;
  const l = b.x1 - b.x0 + 2 * marge;
  const h = b.y1 - b.y0 + 2 * marge;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(l * ev));
  c.height = Math.max(1, Math.ceil(h * ev));
  const g = c.getContext("2d");
  g.setTransform(ev, 0, 0, ev, (marge - b.x0) * ev, (marge - b.y0) * ev);
  g.font = m.police.replace("{t}", F);
  g.textBaseline = "middle";
  g.textAlign = "center";
  g.shadowColor = o.halo;
  g.shadowBlur = F * o.douceur * ev;
  for (let p = 0; p < o.force; p++) lettres(g, m, o.halo);
  g.shadowBlur = F * o.douceur * 0.35 * ev;
  lettres(g, m, o.halo);
  lettres(g, m, o.halo);
  v = { c, x: b.x0 - marge, y: b.y0 - marge, l, h };
  crans.set(cran, v);
  return v;
}

// Texte espacé, droit ou en arc, sur un halo doux. Renvoie sa largeur (en unités de ctx).
export function texteDoux(ctx, chaine, x, y, o) {
  const opts = { couleur: ENCRE, espacement: 0, courbure: 0, angle: 0, halo: HALO, douceur: 0.42, force: 2, alpha: 1, ...o };
  const m = miseEnPage(chaine, opts.police, opts.espacement, opts.courbure, opts.aligne);
  const k = opts.taille / F;
  const t = ctx.getTransform();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(opts.angle);
  ctx.scale(k, k);
  ctx.globalAlpha *= opts.alpha;
  if (opts.halo) {
    const v = halo(m, opts, Math.hypot(t.a, t.b) * k, opts.rapide);
    if (v) ctx.drawImage(v.c, v.x, v.y, v.l, v.h);
  }
  ctx.font = opts.police.replace("{t}", F);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  lettres(ctx, m, opts.couleur);
  ctx.restore();
  return m.total * k;
}

export function largeurDouce(chaine, taille, police, espacement = 0) {
  return (miseEnPage(chaine, police, espacement, 0, "gauche").total * taille) / F;
}

// Couleurs des étiquettes, plus soutenues que sur le parchemin pour tenir sur la peinture.
const COULEURS_ETIQUETTES = {
  region: "rgba(52,30,18,.9)",
  mer: "rgba(18,52,72,.92)",
  relief: "rgba(58,40,26,.92)",
  foret: "rgba(22,44,20,.95)",
  petit: "rgba(40,28,16,.92)",
};

// w : largeur de la carte ; un nom droit posé trop près du bord rentre dans le cadre. min : la taille la plus petite
// permise, en cases (la TV, pour une lecture du canapé).
export function dessinerEtiquettePeinte(ctx, e, w, rapide, min = 0) {
  const st = STYLES_TEXTE[e.style] || STYLES_TEXTE.region;
  const chaine = st.majuscules ? (e.texte || "").toLocaleUpperCase("fr") : e.texte || "";
  if (!chaine) return;
  const taille = Math.max(e.taille || st.taille, min);
  const espacement = e.espacement !== undefined ? e.espacement : st.espacement;
  let x = e.x;
  if (w && !e.courbure && !e.angle) {
    const l = largeurDouce(chaine, taille, st.police, espacement);
    const marge = 2.2 + taille * 0.3;
    if (x - l / 2 < marge) x = marge + l / 2;
    if (x + l / 2 > w - marge) x = w - marge - l / 2;
  }
  texteDoux(ctx, chaine, x, e.y, {
    taille, police: st.police, couleur: COULEURS_ETIQUETTES[e.style] || st.couleur,
    espacement, courbure: e.courbure || 0, angle: e.angle || 0,
    halo: e.style === "mer" ? "rgba(226,246,246,.85)" : e.style === "foret" ? "rgba(240,244,220,.95)" : HALO,
    douceur: 0.6, force: e.style === "mer" ? 3 : 4, rapide,
  });
}

let ombreLieu = null;

// Icône d'un lieu posée sur son ombre, et son nom. o.discret : nom pâli (lieu inconnu des joueurs, vue du MJ) ;
// o.propose : cercle des emplacements à valider ; o.min : la taille la plus petite permise pour le nom (la TV).
export function dessinerLieuPeint(ctx, m, lieu, k, o = {}) {
  const type = (lieu && lieu.type) || m.type || "point";
  const s = m.taille || 1.6;
  if (!ombreLieu) {
    ombreLieu = document.createElement("canvas");
    ombreLieu.width = ombreLieu.height = 64;
    const g = ombreLieu.getContext("2d");
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(24,18,10,.42)");
    gr.addColorStop(1, "rgba(24,18,10,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  }
  if (o.propose) {
    ctx.save();
    ctx.strokeStyle = SANG;
    ctx.lineWidth = 0.1 * k;
    ctx.setLineDash([0.3 * k, 0.22 * k]);
    ctx.beginPath();
    ctx.arc(m.x, m.y - s * 0.4, s * 0.85, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.drawImage(ombreLieu, m.x + s * 0.12 - s * 0.62, m.y + s * 0.02 - s * 0.2, s * 1.24, s * 0.4);
  dessinerIcone(ctx, type, m.x, m.y, s, "couleur");
  const nom = (lieu && lieu.nom) || m.nom;
  if (!nom || m.sans_nom) return;
  const st = styleNomLieu(type);
  const t = Math.max(st.taille * k * (m.taille_nom || 1), o.min || 0);
  let px = m.x + (m.nx !== undefined ? m.nx : s * 0.62);
  let py = m.y + (m.ny !== undefined ? m.ny : -s * 0.34);
  if (m.nom_gauche && m.nx === undefined) px = m.x - s * 0.62 - largeurDouce(nom, t, st.police, st.espacement);
  if (o.decal) {
    px += o.decal.dx;
    py += o.decal.dy;
  }
  texteDoux(ctx, nom, px, py, { taille: t, police: st.police, espacement: st.espacement, couleur: ENCRE, aligne: "gauche", douceur: 0.5, force: 4, alpha: o.discret ? 0.55 : 1, rapide: o.rapide });
}

// Cadre : une marge brune et un filet d'or sombre (l'assombrissement des bords est peint dans le fond).
export function dessinerCadrePeint(ctx, w, h, k = 1) {
  ctx.save();
  const m = 0.75 * k;
  ctx.fillStyle = "#2a1d12";
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.rect(m, h - m, w - 2 * m, -(h - 2 * m));
  ctx.fill("evenodd");
  ctx.strokeStyle = "#b8955a";
  ctx.lineWidth = 0.14 * k;
  ctx.strokeRect(m + 0.12 * k, m + 0.12 * k, w - 2 * m - 0.24 * k, h - 2 * m - 0.24 * k);
  ctx.strokeStyle = "rgba(184,149,90,.6)";
  ctx.lineWidth = 0.05 * k;
  ctx.strokeRect(m - 0.3 * k, m - 0.3 * k, w - 2 * m + 0.6 * k, h - 2 * m + 0.6 * k);
  ctx.restore();
}

// Le dessus d'une carte peinte : mêmes règles que le rendu des autres styles (dessinerDessus) pour ce que voient les
// joueurs. options : joueurs, texture (brouillard), rapide (caméra en mouvement), complet (tous les halos tout de suite),
// lieuxPublics. Renvoie vrai si des halos attendent l'image suivante.
export function dessinerDessusPeint(ctx, carte, lieux, champs, zone, options = {}) {
  finBudget = options.complet ? null : performance.now() + BUDGET_HALOS;
  enRetard = false;
  dessus(ctx, carte, lieux, champs, zone, options);
  finBudget = null;
  return enRetard;
}

function dessus(ctx, carte, lieux, champs, zone, options) {
  const joueurs = options.joueurs;
  if (joueurs && carte.brouillard_actif) ctx.drawImage(champs.brouillard(options.texture), 0, 0, champs.w, champs.h);
  const d = carte.decor || {};
  const k = carte.taille_textes || 1;
  if (d.cadre !== false) dessinerCadrePeint(ctx, champs.w, champs.h, k);
  for (const e of carte.etiquettes || []) {
    if (joueurs && (e.cache || !champs.connuA(e.x, e.y))) continue;
    if (e.x < zone.x0 - 60 || e.x > zone.x1 + 60 || e.y < zone.y0 - 20 || e.y > zone.y1 + 20) continue;
    dessinerEtiquettePeinte(ctx, e, champs.w, options.rapide, options.minNom || 0);
  }
  const marqueurs = (carte.marqueurs || []).slice().sort((a, b) => a.y - b.y);
  const decalages = decalagesDesNoms(carte, lieux, { joueurs, champs, k, min: options.minNom || 0, lieuxPublics: options.lieuxPublics, peint: true });
  for (const m of marqueurs) {
    const lieu = lieux[m.lieu];
    if (joueurs && (m.cache || !champs.connuA(m.x, m.y) || !lieu || (!lieu.connu && !options.lieuxPublics))) continue;
    if (m.x < zone.x0 - 20 || m.x > zone.x1 + 20 || m.y < zone.y0 - 5 || m.y > zone.y1 + 5) continue;
    dessinerLieuPeint(ctx, m, lieu, k, { propose: !joueurs && lieu && lieu.a_valider, discret: !joueurs && (m.cache || !lieu || !lieu.connu), rapide: options.rapide, min: options.minNom || 0, decal: decalages.get(m) });
  }
  dessinerGroupeCarte(ctx, carte, joueurs, k);
  dessinerDecor(ctx, carte, k);
}
