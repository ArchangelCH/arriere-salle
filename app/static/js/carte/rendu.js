// Rendu d'une carte : le fond (terrain, eaux, symboles), puis ce qui se pose dessus (lieux, noms, décor).
// Toutes les coordonnées sont en cases ; le contexte reçoit la transformation case → pixel.

import { PALETTES } from "./biomes.js";
import { chaikin } from "./geo.js";
import { decalagesDesNoms } from "./noms.js";
import { dessinerArbres, dessinerGroupe, dessinerIcone, dessinerSymbole, estArbre } from "./symboles.js";

const ENCRE = "#2b1d12";
const SANG = "#8e1b17";
const HALO = "rgba(246,238,219,.82)";

function croise(b, z) {
  return b.x1 >= z.x0 && b.x0 <= z.x1 && b.y1 >= z.y0 && b.y0 <= z.y1;
}

function tracer(ctx, pts, ferme) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (ferme) ctx.closePath();
}

function lignes(ctx, liste, zone) {
  ctx.beginPath();
  for (const l of liste) if (croise(l.boite, zone)) tracer(ctx, l.points, l.ferme);
  ctx.stroke();
}

export function pointsLisses(trace) {
  return trace.points.length > 2 ? chaikin(trace.points, false, 2) : trace.points;
}

function dessinerRiviere(ctx, trace, pal) {
  const pts = pointsLisses(trace);
  const n = pts.length;
  if (n < 2) return;
  const [l0, l1] = trace.largeur || [0.16, 0.42];
  const morceau = 6;
  for (const passe of [0, 1]) {
    ctx.strokeStyle = passe ? pal.riviere : pal.riviereBord;
    for (let i = 0; i < n - 1; i += morceau) {
      const fin = Math.min(n - 1, i + morceau);
      const milieu = pts[Math.round((i + fin) / 2)];
      const l = milieu.length > 2 ? milieu[2] : l0 + (l1 - l0) * ((i + fin) / 2 / (n - 1));
      ctx.lineWidth = passe ? l : l + 0.11;
      ctx.beginPath();
      ctx.moveTo(pts[i][0], pts[i][1]);
      for (let k = i + 1; k <= fin; k++) ctx.lineTo(pts[k][0], pts[k][1]);
      ctx.stroke();
    }
  }
}

function dessinerVoie(ctx, trace, pal) {
  const pts = pointsLisses(trace);
  if (pts.length < 2) return;
  ctx.beginPath();
  tracer(ctx, pts, false);
  if (trace.type === "frontiere") {
    ctx.save();
    ctx.strokeStyle = pal.frontiere;
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = 0.9;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 0.15;
    ctx.setLineDash([0.9, 0.32, 0.14, 0.32]);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.strokeStyle = pal.route;
  if (trace.type === "route") {
    ctx.lineWidth = 0.13;
    ctx.setLineDash([0.55, 0.28]);
  } else {
    ctx.lineWidth = 0.09;
    ctx.setLineDash([0.16, 0.26]);
  }
  ctx.stroke();
  ctx.restore();
}

function boiteTrace(trace) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of trace.points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0: x0 - 1, y0: y0 - 1, x1: x1 + 1, y1: y1 + 1 };
}

export function dessinerTraces(ctx, carte, pal, zone, types, filtre) {
  for (const t of carte.traces || []) {
    if (!types.includes(t.type) || !t.points || t.points.length < 2) continue;
    if (filtre && !filtre(t)) continue;
    if (!croise(boiteTrace(t), zone)) continue;
    if (t.type === "riviere") dessinerRiviere(ctx, t, pal);
    else dessinerVoie(ctx, t, pal);
  }
}

// Fond de carte : ce qui change seulement quand on peint le terrain ou qu'on trace une voie.
export function dessinerFond(ctx, carte, champs, style, zone, texture, options = {}) {
  const pal = PALETTES[style];
  const { w, h } = champs;
  const filtre = options.joueurs ? (t) => !t.cache : null;
  ctx.save();
  ctx.beginPath();
  ctx.rect(Math.max(0, zone.x0), Math.max(0, zone.y0), Math.min(w, zone.x1) - Math.max(0, zone.x0), Math.min(h, zone.y1) - Math.max(0, zone.y0));
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (texture) ctx.drawImage(texture, 0, 0, w, h);
  else {
    ctx.fillStyle = "#f1e6cc";
    ctx.fillRect(0, 0, w, h);
  }
  const lavis = champs.lavis(style);
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(lavis.terre, 0, 0, w, h);
  ctx.globalAlpha = pal.relief;
  ctx.drawImage(champs.relief(), 0, 0, w, h);
  ctx.globalAlpha = 1;
  ctx.drawImage(lavis.eau, 0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(lavis.neige, 0, 0, w, h);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = pal.vague;
  const epaisseurs = [0.075, 0.06, 0.05];
  const opacites = [0.85, 0.55, 0.32];
  champs.vagues.forEach((liste, k) => {
    ctx.globalAlpha = opacites[k];
    ctx.lineWidth = epaisseurs[k];
    lignes(ctx, liste, zone);
  });
  ctx.globalAlpha = 1;

  dessinerTraces(ctx, carte, pal, zone, ["riviere"], filtre);
  ctx.strokeStyle = pal.cote;
  ctx.lineWidth = 0.15;
  lignes(ctx, champs.cotes, zone);

  dessinerTraces(ctx, carte, pal, zone, ["route", "chemin"], filtre);
  const symboles = champs.symbolesZone(zone.x0, zone.y0, zone.x1, zone.y1);
  for (let i = 0; i < symboles.length; ) {
    if (estArbre(symboles[i].t)) {
      const haut = symboles[i].y + 0.35;
      let j = i;
      while (j < symboles.length && estArbre(symboles[j].t) && symboles[j].y < haut) j++;
      dessinerArbres(ctx, symboles.slice(i, j), pal);
      i = j;
    } else {
      dessinerSymbole(ctx, symboles[i], pal);
      i++;
    }
  }
  dessinerTraces(ctx, carte, pal, zone, ["frontiere"], filtre);
  const brume = carte.decor?.brume;
  if (brume) {
    ctx.save();
    ctx.translate(brume.x, brume.y);
    ctx.scale(brume.rx, brume.ry);
    const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 1.75);
    const c = style === "couleur" ? "226,216,190" : "238,228,204";
    g.addColorStop(0, `rgba(${c},0)`);
    g.addColorStop(0.35, `rgba(${c},.42)`);
    g.addColorStop(1, `rgba(${c},.9)`);
    ctx.fillStyle = g;
    ctx.fillRect(-brume.x / brume.rx, -brume.y / brume.ry, w / brume.rx, h / brume.ry);
    ctx.restore();
  }
  ctx.restore();
}

// Chrome perd des lettres et les espace mal quand une police de quelques fractions de pixel est agrandie par la
// transformation (tailles en cases) : tout s'écrit et se mesure en 32 px, dans un contexte réduit d'autant.
const F = 32;

// Texte espacé, droit ou en arc (courbure = angle total de l'arc, en radians). degrade : [[position, couleur]…], un
// dégradé vertical sur la hauteur des lettres, à la place de couleur.
export function texte(ctx, chaine, x, y, o) {
  const { taille, police, couleur = ENCRE, degrade, espacement = 0, courbure = 0, angle = 0, halo = HALO, epaisseurHalo = 0.35, alpha = 1, aligne } = o;
  const k = taille / F;
  ctx.save();
  ctx.font = `${police.replace("{t}", F)}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.globalAlpha = alpha;
  const car = [...chaine];
  const larg = car.map((c) => ctx.measureText(c).width);
  const esp = espacement * F;
  const total = larg.reduce((a, b) => a + b, 0) + esp * (car.length - 1);
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
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(k, k);
  let remplissage = couleur;
  if (degrade) {
    remplissage = ctx.createLinearGradient(0, -F * 0.5, 0, F * 0.5);
    for (const [t, c] of degrade) remplissage.addColorStop(t, c);
  }
  for (const passe of halo ? [0, 1] : [1]) {
    for (let i = 0; i < car.length; i++) {
      const [px, py, a] = places[i];
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(a);
      if (passe === 0) {
        ctx.strokeStyle = halo;
        ctx.lineWidth = epaisseurHalo * F;
        ctx.lineJoin = "round";
        ctx.strokeText(car[i], 0, 0);
      } else {
        ctx.fillStyle = remplissage;
        ctx.fillText(car[i], 0, 0);
      }
      ctx.restore();
    }
  }
  ctx.restore();
  return total * k;
}

export const STYLES_TEXTE = {
  region: { police: "600 {t}px Cinzel", couleur: "rgba(43,29,18,.78)", espacement: 0.32, majuscules: true, taille: 3 },
  mer: { police: "italic 500 {t}px 'EB Garamond'", couleur: "rgba(34,62,76,.85)", espacement: 0.26, majuscules: true, taille: 2.6 },
  relief: { police: "600 {t}px Cinzel", couleur: "rgba(84,58,34,.85)", espacement: 0.22, majuscules: true, taille: 1.8 },
  foret: { police: "italic 500 {t}px 'EB Garamond'", couleur: "rgba(38,60,30,.9)", espacement: 0.08, majuscules: false, taille: 2 },
  petit: { police: "italic 500 {t}px 'EB Garamond'", couleur: "rgba(43,29,18,.88)", espacement: 0.03, majuscules: false, taille: 1.25 },
};

// min : la taille la plus petite permise, en cases (la TV, pour une lecture du canapé).
export function dessinerEtiquette(ctx, e, min = 0) {
  const st = STYLES_TEXTE[e.style] || STYLES_TEXTE.region;
  const taille = Math.max(e.taille || st.taille, min);
  const chaine = st.majuscules ? (e.texte || "").toLocaleUpperCase("fr") : e.texte || "";
  return texte(ctx, chaine, e.x, e.y, {
    taille,
    police: st.police,
    couleur: st.couleur,
    espacement: e.espacement ?? st.espacement,
    courbure: e.courbure || 0,
    angle: e.angle || 0,
    epaisseurHalo: 0.28,
  });
}

export function styleNomLieu(type) {
  if (type === "capitale") return { police: "700 {t}px Cinzel", taille: 1.45, espacement: 0.06 };
  if (["cite", "cite_naine", "ile_volante"].includes(type)) return { police: "600 {t}px Cinzel", taille: 1.15, espacement: 0.05 };
  if (["ville", "tour", "temple", "forteresse", "port"].includes(type)) return { police: "500 {t}px 'EB Garamond'", taille: 1.2, espacement: 0.02 };
  return { police: "italic 500 {t}px 'EB Garamond'", taille: 1.05, espacement: 0.01 };
}

export function positionNom(m) {
  const s = m.taille || 1.6;
  return { x: m.x + (m.nx ?? s * 0.62), y: m.y + (m.ny ?? -s * 0.34) };
}

export function dessinerMarqueur(ctx, m, lieu, style, options = {}) {
  const k = options.k || 1;
  const type = lieu?.type || m.type || "point";
  const s = m.taille || 1.6;
  if (options.propose && lieu?.a_valider) {
    ctx.save();
    ctx.strokeStyle = SANG;
    ctx.lineWidth = 0.1 * k;
    ctx.setLineDash([0.3 * k, 0.22 * k]);
    ctx.beginPath();
    ctx.arc(m.x, m.y - s * 0.4, s * 0.85, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  dessinerIcone(ctx, type, m.x, m.y, s, style);
  const nom = lieu?.nom || m.nom;
  if (!nom || m.sans_nom) return;
  const st = styleNomLieu(type);
  const p = positionNom(m);
  const taille = Math.max(st.taille * k * (m.taille_nom || 1), options.min || 0);
  if (m.nom_gauche && m.nx === undefined) p.x = m.x - s * 0.62 - largeurTexte(ctx, nom, taille, st.police, st.espacement);
  if (options.decal) {
    p.x += options.decal.dx;
    p.y += options.decal.dy;
  }
  texte(ctx, nom, p.x, p.y, { taille, police: st.police, espacement: st.espacement, couleur: ENCRE, epaisseurHalo: 0.32, aligne: "gauche", alpha: options.discret ? 0.55 : 1 });
}

// Largeur d'un texte (en unités de ctx), mesurée en 32 px puis ramenée à sa taille.
export function largeurTexte(ctx, chaine, taille, police, espacement = 0) {
  ctx.save();
  ctx.font = police.replace("{t}", F);
  const car = [...chaine];
  const l = car.reduce((a, c) => a + ctx.measureText(c).width, 0);
  ctx.restore();
  return (l * taille) / F + espacement * taille * (car.length - 1);
}

function losange(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fillStyle = SANG;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y - r * 0.45);
  ctx.lineTo(x + r * 0.45, y);
  ctx.lineTo(x, y + r * 0.45);
  ctx.lineTo(x - r * 0.45, y);
  ctx.closePath();
  ctx.fillStyle = "#f4ead4";
  ctx.fill();
}

export function dessinerCadre(ctx, w, h, k = 1) {
  ctx.save();
  ctx.strokeStyle = ENCRE;
  ctx.lineWidth = 0.24 * k;
  ctx.strokeRect(0.55 * k, 0.55 * k, w - 1.1 * k, h - 1.1 * k);
  ctx.lineWidth = 0.08 * k;
  ctx.strokeRect(1.25 * k, 1.25 * k, w - 2.5 * k, h - 2.5 * k);
  const m = 0.9 * k;
  for (const [x, y] of [[m, m], [w - m, m], [m, h - m], [w - m, h - m], [w / 2, m], [w / 2, h - m], [m, h / 2], [w - m, h / 2]]) losange(ctx, x, y, 0.62 * k);
  ctx.restore();
}

export function dessinerRose(ctx, r) {
  const t = r.taille || 8;
  ctx.save();
  ctx.translate(r.x, r.y);
  ctx.lineJoin = "round";
  ctx.strokeStyle = ENCRE;
  ctx.lineWidth = 0.07;
  ctx.fillStyle = "rgba(246,238,219,.55)";
  ctx.beginPath();
  ctx.arc(0, 0, t * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, t * 0.36, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (let k = 0; k < 32; k++) {
    const a = (k * Math.PI) / 16;
    const r1 = t * (k % 4 === 0 ? 0.3 : 0.33);
    ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
    ctx.lineTo(Math.cos(a) * t * 0.36, Math.sin(a) * t * 0.36);
  }
  ctx.stroke();
  const pointe = (a, long, larg, clair, sombre) => {
    const cx = Math.cos(a);
    const sy = Math.sin(a);
    const px = -sy;
    const py = cx;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(cx * long, sy * long);
    ctx.lineTo(px * larg, py * larg);
    ctx.closePath();
    ctx.fillStyle = clair;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(cx * long, sy * long);
    ctx.lineTo(-px * larg, -py * larg);
    ctx.closePath();
    ctx.fillStyle = sombre;
    ctx.fill();
    ctx.stroke();
  };
  for (let k = 0; k < 4; k++) pointe(Math.PI / 4 + (k * Math.PI) / 2, t * 0.3, t * 0.06, "#f4ead4", "#8a6a34");
  for (let k = 0; k < 4; k++) pointe(-Math.PI / 2 + (k * Math.PI) / 2, t * 0.5, t * 0.085, "#f4ead4", ENCRE);
  ctx.beginPath();
  ctx.arc(0, 0, t * 0.04, 0, Math.PI * 2);
  ctx.fillStyle = SANG;
  ctx.fill();
  texte(ctx, "N", 0, -t * 0.6, { taille: t * 0.16, police: "700 {t}px Cinzel", couleur: SANG, halo: HALO, epaisseurHalo: 0.3 });
  ctx.restore();
}

export function dessinerCartouche(ctx, c) {
  const titre = (c.titre || "").toLocaleUpperCase("fr");
  const tt = c.taille || 4;
  const lt = largeurTexte(ctx, titre, tt, "700 {t}px 'Cinzel Decorative'", 0.08);
  const ls = c.sous_titre ? largeurTexte(ctx, c.sous_titre, tt * 0.34, "italic 500 {t}px 'EB Garamond'", 0.02) : 0;
  const w = Math.max(lt, ls) + tt * 2.2;
  const h = tt * (c.sous_titre ? 2.35 : 1.8);
  const x0 = c.x - w / 2;
  const y0 = c.y - h / 2;
  ctx.save();
  ctx.fillStyle = "rgba(248,241,224,.9)";
  ctx.strokeStyle = ENCRE;
  ctx.shadowColor = "rgba(43,29,18,.35)";
  ctx.shadowBlur = 0.8;
  ctx.shadowOffsetY = 0.25;
  ctx.fillRect(x0, y0, w, h);
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 0.2;
  ctx.strokeRect(x0, y0, w, h);
  ctx.lineWidth = 0.07;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
  for (const [x, y] of [[x0, y0], [x0 + w, y0], [x0, y0 + h], [x0 + w, y0 + h]]) losange(ctx, x, y, 0.7);
  const ty = c.sous_titre ? c.y - tt * 0.28 : c.y;
  const degrade = [[0, "#5a1210"], [0.5, SANG], [1, "#4a0f0d"]];
  texte(ctx, titre, c.x, ty, { taille: tt, police: "700 {t}px 'Cinzel Decorative'", degrade, espacement: 0.08, halo: null });
  if (c.sous_titre) texte(ctx, c.sous_titre, c.x, c.y + tt * 0.62, { taille: tt * 0.34, police: "italic 500 {t}px 'EB Garamond'", couleur: ENCRE, espacement: 0.02, halo: null });
  ctx.restore();
}

// Barre d'échelle graduée en lieues (une lieue = 4 km), avec les journées de marche.
export function dessinerEchelle(ctx, e, kmCase, k = 1) {
  const km = kmCase || 8;
  const lieuesParCase = km / 4;
  const cible = 34 * lieuesParCase;
  const pas = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((p) => p >= cible / 4) || 1000;
  const lieues = pas * 4;
  const L = lieues / lieuesParCase;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.scale(k, k);
  const Lk = L / k;
  ctx.fillStyle = ENCRE;
  ctx.strokeStyle = ENCRE;
  ctx.lineWidth = 0.08;
  ctx.fillRect(0, 0, Lk, 0.14);
  for (let i = 0; i <= 4; i++) {
    const x = (i * Lk) / 4;
    const haut = i % 2 === 0 ? 0.9 : 0.55;
    ctx.fillRect(x - 0.06, -haut + 0.14, 0.12, haut);
    if (i < 4) {
      ctx.fillStyle = i % 2 === 0 ? SANG : "rgba(246,238,219,.9)";
      ctx.fillRect(x, 0.14, Lk / 4, 0.42);
      ctx.strokeRect(x, 0.14, Lk / 4, 0.42);
      ctx.fillStyle = ENCRE;
    }
    texte(ctx, String(i * pas), x, -1.15, { taille: 0.95, police: "600 {t}px Cinzel", espacement: 0.02 });
  }
  texte(ctx, "lieues", Lk + 2.3, 0.3, { taille: 1.05, police: "italic 500 {t}px 'EB Garamond'" });
  const jours = (lieues * 4) / 30;
  const nJours = jours >= 10 ? Math.round(jours) : +jours.toFixed(1);
  texte(ctx, `soit ${String(nJours).replace(".", ",")} ${nJours < 2 ? "jour" : "jours"} de marche`, Lk / 2, 1.65, { taille: 0.9, police: "italic 500 {t}px 'EB Garamond'" });
  ctx.restore();
}

export function dessinerDessus(ctx, carte, lieux, champs, style, zone, options = {}) {
  const joueurs = options.joueurs;
  if (joueurs && carte.brouillard_actif) {
    ctx.drawImage(champs.brouillard(options.texture), 0, 0, champs.w, champs.h);
  }
  const d = carte.decor || {};
  const k = carte.taille_textes || 1;
  if (d.cadre !== false) dessinerCadre(ctx, champs.w, champs.h, k);
  for (const e of carte.etiquettes || []) {
    if (joueurs && (e.cache || !champs.connuA(e.x, e.y))) continue;
    if (e.x < zone.x0 - 60 || e.x > zone.x1 + 60 || e.y < zone.y0 - 20 || e.y > zone.y1 + 20) continue;
    dessinerEtiquette(ctx, e, options.minNom || 0);
  }
  const marqueurs = [...(carte.marqueurs || [])].sort((a, b) => a.y - b.y);
  const decalages = decalagesDesNoms(carte, lieux, { joueurs, champs, k, min: options.minNom || 0, lieuxPublics: options.lieuxPublics });
  for (const m of marqueurs) {
    const lieu = lieux[m.lieu];
    if (joueurs && (m.cache || !champs.connuA(m.x, m.y) || (lieu && !lieu.connu && !options.lieuxPublics))) continue;
    if (m.x < zone.x0 - 20 || m.x > zone.x1 + 20 || m.y < zone.y0 - 5 || m.y > zone.y1 + 5) continue;
    dessinerMarqueur(ctx, m, lieu, style, { propose: !joueurs, k, discret: !joueurs && lieu && !lieu.connu, min: options.minNom || 0, decal: decalages.get(m) });
  }
  dessinerGroupeCarte(ctx, carte, joueurs, k);
  dessinerDecor(ctx, carte, k);
}

// Le groupe des héros et son trajet, s'il est montré.
export function dessinerGroupeCarte(ctx, carte, joueurs, k) {
  if (!carte.groupe?.visible || (joueurs && carte.groupe.montrer === false)) return;
  const g = carte.groupe;
  if (g.trajet?.length > 1) {
    ctx.save();
    ctx.strokeStyle = SANG;
    ctx.lineWidth = 0.16 * k;
    ctx.lineCap = "round";
    ctx.setLineDash([0.05 * k, 0.45 * k]);
    ctx.beginPath();
    tracer(ctx, g.trajet, false);
    ctx.stroke();
    ctx.restore();
  }
  dessinerGroupe(ctx, g.x, g.y, 1.4 * k);
}

// Cartouche, rose des vents et échelle.
export function dessinerDecor(ctx, carte, k) {
  const d = carte.decor || {};
  if (d.cartouche?.visible !== false && d.cartouche) dessinerCartouche(ctx, d.cartouche);
  if (d.rose?.visible !== false && d.rose) dessinerRose(ctx, d.rose);
  if (d.echelle?.visible !== false && d.echelle) dessinerEchelle(ctx, d.echelle, carte.km_case, k);
}
