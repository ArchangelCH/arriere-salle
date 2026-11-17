// Le dessin du sanctuaire, en SVG (1600 × 1000) : une clairière au bord d'une rivière, l'auberge au milieu, chaque
// bâtiment à sa place, qui change d'aspect avec son niveau (ruines, terrain jalonné, chantier, puis construit et agrandi
// de niveau en niveau), les chemins qui mènent à chacun et l'enceinte autour du village. Le même dessin pour l'atelier
// (mj : bâtiments cachés en transparence, choix) et pour la TV (sanctuaire_public). Rien de plus récent que Chromium 79.

export const LARGEUR = 1600;
export const HAUTEUR = 1000;
const CENTRE = { x: 800, y: 470 };
const ENCEINTE = { x: 800, y: 545, rx: 655, ry: 405 };
const DEBORD_X = 420;
const DEBORD_Y = 300;
const TRAIT = "#2a1d12";
const MUR = "#d8c49c";
const PIERRE = "#a59a88";
const BOIS = "#5a3d26";
const FENETRE = "#f2c45a";
const PORTE = "#4a2f1d";

const e = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const n = (v) => Math.round(v * 10) / 10;
const pts = (liste) => liste.map(([x, y]) => `${n(x)},${n(y)}`).join(" ");
const couleurSure = (c) => (/^#[0-9a-fA-F]{6}$/.test(c || "") ? c : "#8e3b2a");
const ROMAINS = ["", "I", "II", "III", "IV", "V"];

// Le même tirage à chaque dessin : la forêt ne bouge pas d'un écran à l'autre.
function hasard(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assombrir(hex, k) {
  const v = parseInt(couleurSure(hex).slice(1), 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => Math.max(0, Math.min(255, Math.round(x * k))));
  return `#${c.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

// ---------------------------------------------------------------- le terrain

function terrain(batiments) {
  const r = hasard(7);
  const morceaux = [];
  // Le terrain déborde du cadre : sur un écran d'une autre forme, la forêt remplit les bords (svg en overflow visible).
  morceaux.push(`<rect x="${-DEBORD_X}" y="${-DEBORD_Y}" width="${LARGEUR + 2 * DEBORD_X}" height="${HAUTEUR + 2 * DEBORD_Y}" fill="url(#sc-herbe)"/>`);
  // Taches d'herbe plus claires ou plus sombres.
  for (let i = 0; i < 70; i++) {
    const x = r() * LARGEUR;
    const y = r() * HAUTEUR;
    morceaux.push(`<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(30 + r() * 90)}" ry="${n(14 + r() * 40)}" fill="${r() < 0.5 ? "#5f7f3c" : "#3f5a2a"}" opacity="${n(0.18 + r() * 0.2)}"/>`);
  }
  // La clairière battue autour de l'auberge.
  morceaux.push(`<ellipse cx="${CENTRE.x}" cy="${CENTRE.y + 60}" rx="560" ry="360" fill="url(#sc-clairiere)"/>`);
  // La rivière, à gauche, et son gué.
  const riviere = "M 40,-420 C 110,-200 40,-80 70,-20 C 150,160 40,320 120,470 S 60,800 150,1020 S 120,1250 190,1440";
  morceaux.push(`<path d="${riviere}" fill="none" stroke="#2f4f5f" stroke-width="58" stroke-linecap="round" opacity=".55"/>`);
  morceaux.push(`<path d="${riviere}" fill="none" stroke="#4f7f97" stroke-width="40" stroke-linecap="round"/>`);
  morceaux.push(`<path d="${riviere}" fill="none" stroke="#8fb7c4" stroke-width="3" stroke-dasharray="18 42" opacity=".6"/>`);
  // Les chemins : la route qui descend vers le sud et passe la porte, et un sentier vers chaque bâtiment debout.
  const chemins = [`M ${CENTRE.x},${CENTRE.y + 40} C 820,720 760,860 790,1020`, `M ${CENTRE.x + 60},${CENTRE.y} C 1100,470 1300,520 1620,500`,
    `M ${CENTRE.x - 60},${CENTRE.y + 10} C 520,480 300,470 130,470`];
  // Les sentiers partent du bord de la place, devant l'auberge, et s'incurvent : pas d'étoile autour d'elle.
  const sentiers = [];
  for (const b of batiments) {
    if (b.forme === "enceinte" || (Math.abs(b.x - CENTRE.x) < 40 && Math.abs(b.y - CENTRE.y) < 40)) continue;
    if (!b.niveau && !b.cagnotte && !b.ruine) continue;
    const a = Math.atan2(b.y + 8 - (CENTRE.y + 70), b.x - CENTRE.x);
    const x0 = CENTRE.x + Math.cos(a) * 170;
    const y0 = CENTRE.y + 70 + Math.sin(a) * 95;
    const mx = (b.x + x0) / 2 + (b.y - y0) * 0.22;
    const my = (b.y + y0) / 2 - (b.x - x0) * 0.12;
    sentiers.push(`M ${n(x0)},${n(y0)} Q ${n(mx)},${n(my)} ${b.x},${b.y + 8}`);
  }
  // La place devant l'auberge.
  morceaux.push(`<ellipse cx="${CENTRE.x}" cy="${CENTRE.y + 70}" rx="175" ry="98" fill="#a88a5c" opacity=".55"/>`);
  for (const d of chemins) morceaux.push(`<path d="${d}" fill="none" stroke="#6e5537" stroke-width="26" stroke-linecap="round" opacity=".35"/>`);
  for (const d of chemins) morceaux.push(`<path d="${d}" fill="none" stroke="#a88a5c" stroke-width="16" stroke-linecap="round" opacity=".85"/>`);
  for (const d of sentiers) morceaux.push(`<path d="${d}" fill="none" stroke="#a88a5c" stroke-width="9" stroke-linecap="round" opacity=".7"/>`);
  return morceaux.join("");
}

// La forêt autour : des arbres tirés au sort hors de la clairière, du village et de la rivière.
function foret(batiments) {
  const r = hasard(23);
  const arbres = [];
  const libre = (x, y) => {
    const dx = (x - ENCEINTE.x) / (ENCEINTE.rx + 40);
    const dy = (y - ENCEINTE.y) / (ENCEINTE.ry + 35);
    if (dx * dx + dy * dy < 1) return false;
    if (Math.abs(x - (110 + Math.sin(y / 140) * 40)) < 75) return false;
    return batiments.every((b) => Math.hypot(b.x - x, b.y - y) > 95);
  };
  for (let i = 0; arbres.length < 120 && i < 2000; i++) {
    const x = r() * (LARGEUR + 60) - 30;
    const y = r() * (HAUTEUR + 60) - 30;
    if (libre(x, y)) arbres.push({ x, y, t: 22 + r() * 22, v: r() });
  }
  // Les bois hors du cadre, plus serrés : ils ne se voient que sur un écran d'une autre forme.
  const r2 = hasard(41);
  for (let i = 0; i < 170; i++) {
    const x = r2() * (LARGEUR + 2 * DEBORD_X) - DEBORD_X;
    const y = r2() * (HAUTEUR + 2 * DEBORD_Y) - DEBORD_Y;
    if ((x < -20 || x > LARGEUR + 20 || y < -20 || y > HAUTEUR + 20) && Math.abs(x - (110 + Math.sin(y / 140) * 40)) > 75) arbres.push({ x, y, t: 26 + r2() * 20, v: r2() });
  }
  arbres.sort((a, b) => a.y - b.y);
  return arbres.map(({ x, y, t, v }) => {
    const fonce = v < 0.5 ? "#2c4520" : "#334f25";
    const clair = v < 0.5 ? "#4d7233" : "#58803a";
    return `<g><ellipse cx="${n(x + 6)}" cy="${n(y + t * 0.7)}" rx="${n(t * 1.05)}" ry="${n(t * 0.45)}" fill="#000" opacity=".22"/>`
      + `<circle cx="${n(x)}" cy="${n(y)}" r="${n(t)}" fill="${fonce}" stroke="#1d2e16" stroke-width="2"/>`
      + `<circle cx="${n(x - t * 0.35)}" cy="${n(y - t * 0.3)}" r="${n(t * 0.55)}" fill="${clair}"/>`
      + `<circle cx="${n(x + t * 0.3)}" cy="${n(y - t * 0.15)}" r="${n(t * 0.4)}" fill="${clair}" opacity=".7"/></g>`;
  }).join("");
}

// ---------------------------------------------------------------- les pièces d'un bâtiment

function ombre(x, y, w) {
  return `<ellipse cx="${n(x + 6)}" cy="${n(y + 4)}" rx="${n(w * 0.62)}" ry="${n(Math.max(10, w * 0.12))}" fill="#000" opacity=".28"/>`;
}

// Une maison vue de face, un peu d'en haut : mur, toit, porte, fenêtres allumées, cheminée.
function maisonnette({ x, y, w, h, toit, mur = MUR, etages = 1, colombages = true, cheminee = true, porte = true, fenetres = 2 }) {
  const t = couleurSure(toit);
  const r = Math.max(26, h * 0.62);
  const g = [];
  g.push(`<rect x="${n(x - w / 2)}" y="${n(y - h)}" width="${n(w)}" height="${n(h)}" fill="${mur}" stroke="${TRAIT}" stroke-width="2.5"/>`);
  if (colombages) {
    for (let i = 1; i < 4; i++) g.push(`<line x1="${n(x - w / 2 + (w * i) / 4)}" y1="${n(y - h)}" x2="${n(x - w / 2 + (w * i) / 4)}" y2="${n(y)}" stroke="${BOIS}" stroke-width="3"/>`);
    for (let k = 1; k < etages; k++) g.push(`<line x1="${n(x - w / 2)}" y1="${n(y - (h * k) / etages)}" x2="${n(x + w / 2)}" y2="${n(y - (h * k) / etages)}" stroke="${BOIS}" stroke-width="4"/>`);
  }
  // Fenêtres, rangée par étage.
  for (let k = 0; k < etages; k++) {
    const yf = y - (h * (k + 0.62)) / etages;
    const nb = k === 0 && porte ? fenetres : fenetres + 1;
    for (let i = 0; i < nb; i++) {
      const xf = x - w / 2 + ((i + 1) * w) / (nb + 1);
      if (k === 0 && porte && Math.abs(xf - x) < 16) continue;
      g.push(`<rect x="${n(xf - 7)}" y="${n(yf - 8)}" width="14" height="16" fill="${FENETRE}" stroke="${TRAIT}" stroke-width="2"/>`);
    }
  }
  if (porte) g.push(`<path d="M ${n(x - 11)},${n(y)} V ${n(y - 22)} Q ${n(x)},${n(y - 32)} ${n(x + 11)},${n(y - 22)} V ${n(y)} Z" fill="${PORTE}" stroke="${TRAIT}" stroke-width="2"/>`);
  // Le toit : un pan vu d'en haut, ses rangs de tuiles.
  const toitPts = [[x - w / 2 - 12, y - h + 2], [x + w / 2 + 12, y - h + 2], [x + w / 2 - 10, y - h - r], [x - w / 2 + 10, y - h - r]];
  if (cheminee) g.push(`<rect x="${n(x + w * 0.22)}" y="${n(y - h - r - 14)}" width="14" height="30" fill="${PIERRE}" stroke="${TRAIT}" stroke-width="2"/>`);
  g.push(`<polygon points="${pts(toitPts)}" fill="${t}" stroke="${TRAIT}" stroke-width="2.5" stroke-linejoin="round"/>`);
  for (let i = 1; i < 4; i++) {
    const yy = y - h + 2 - (r * i) / 4;
    const marge = 12 - (22 * i) / 4;
    g.push(`<line x1="${n(x - w / 2 - marge)}" y1="${n(yy)}" x2="${n(x + w / 2 + marge)}" y2="${n(yy)}" stroke="${assombrir(t, 0.72)}" stroke-width="2"/>`);
  }
  g.push(`<line x1="${n(x - w / 2 + 10)}" y1="${n(y - h - r)}" x2="${n(x + w / 2 - 10)}" y2="${n(y - h - r)}" stroke="${assombrir(t, 0.55)}" stroke-width="4" stroke-linecap="round"/>`);
  return g.join("");
}

// L'enseigne pendue à côté de la porte, avec un petit dessin du métier.
function enseigne(x, y, embleme) {
  if (!embleme) return "";
  const c = "#f0dfb5";
  const dessin = {
    piece: `<circle cx="0" cy="0" r="6" fill="none" stroke="${c}" stroke-width="2.5"/><circle cx="0" cy="0" r="2" fill="${c}"/>`,
    enclume: `<path d="M -8,-3 H 7 Q 9,-3 9,-1 L 4,1 V 4 H 6 V 6 H -6 V 4 H -4 V 1 L -8,-1 Z" fill="${c}"/>`,
    feuille: `<path d="M -7,6 Q -8,-6 7,-7 Q 7,6 -7,6 Z M -7,6 L 4,-4" fill="${c}" stroke="#7a5a36" stroke-width="1"/>`,
    losange: `<polygon points="0,-8 8,0 0,8 -8,0" fill="#c2402f"/><polygon points="0,-8 8,0 0,0" fill="#4f8fd0"/><polygon points="0,8 -8,0 0,0" fill="#6aa84f"/><polygon points="-8,0 0,-8 0,0" fill="#e8d36a"/>`,
    fer: `<path d="M -6,6 V -1 A 6,6 0 0 1 6,-1 V 6" fill="none" stroke="${c}" stroke-width="3"/>`,
    coffre: `<rect x="-7" y="-4" width="14" height="10" fill="${c}"/><rect x="-7" y="-6" width="14" height="4" fill="${c}"/><rect x="-1.5" y="-2" width="3" height="4" fill="#7a5a36"/>`,
    parchemin: `<rect x="-6" y="-6" width="12" height="12" fill="${c}"/><line x1="-3" y1="-2" x2="3" y2="-2" stroke="#7a5a36" stroke-width="1.5"/><line x1="-3" y1="2" x2="3" y2="2" stroke="#7a5a36" stroke-width="1.5"/>`,
    lit: `<rect x="-8" y="0" width="16" height="4" fill="${c}"/><rect x="-8" y="-5" width="4" height="9" fill="${c}"/><rect x="-3" y="-3" width="6" height="3" fill="${c}"/>`,
    epi: `<path d="M 0,7 V -7 M 0,-3 L -4,-6 M 0,-3 L 4,-6 M 0,1 L -4,-2 M 0,1 L 4,-2" stroke="${c}" stroke-width="2" fill="none"/>`,
  }[embleme] || "";
  return `<g transform="translate(${n(x)},${n(y)})"><line x1="-12" y1="-16" x2="0" y2="-16" stroke="${TRAIT}" stroke-width="3"/><line x1="-6" y1="-16" x2="-6" y2="-12" stroke="${TRAIT}" stroke-width="1.5"/><line x1="6" y1="-16" x2="6" y2="-12" stroke="${TRAIT}" stroke-width="1.5"/><rect x="-14" y="-12" width="28" height="22" rx="2" fill="#7a5a36" stroke="${TRAIT}" stroke-width="2"/>${dessin}</g>`;
}

function drapeau(x, y, couleur) {
  return `<line x1="${n(x)}" y1="${n(y)}" x2="${n(x)}" y2="${n(y - 46)}" stroke="${TRAIT}" stroke-width="3"/><path d="M ${n(x)},${n(y - 46)} L ${n(x + 30)},${n(y - 39)} L ${n(x)},${n(y - 30)} Z" fill="${couleurSure(couleur)}" stroke="${TRAIT}" stroke-width="1.5"/>`;
}

// ---------------------------------------------------------------- les formes, niveau par niveau

const FORMES = {
  auberge(b, x, y, k) {
    const w = [0, 170, 190, 210][Math.min(3, k)];
    const h = k >= 2 ? 110 : 72;
    const g = [ombre(x, y, w + (k >= 3 ? 120 : 0))];
    if (k >= 3) g.push(maisonnette({ x: x + w / 2 + 50, y, w: 100, h: 66, toit: b.toit, fenetres: 2, porte: false }));
    g.push(maisonnette({ x, y, w, h, toit: b.toit, etages: k >= 2 ? 2 : 1, fenetres: k >= 2 ? 3 : 2 }));
    g.push(enseigne(x - 30, y - 30, b.embleme || "lit"));
    if (k >= 3) g.push(drapeau(x - w / 2 + 8, y - h - 30, "#b3261e"));
    return g.join("");
  },
  maison(b, x, y, k) {
    if (k >= 3) return ombre(x, y, 110) + maisonnette({ x, y, w: 110, h: 86, toit: b.toit, etages: 2, fenetres: 2 }) + enseigne(x + 34, y - 26, b.embleme);
    const w = k >= 2 ? 92 : 72;
    const h = k >= 2 ? 60 : 46;
    return ombre(x, y, w) + maisonnette({ x, y, w, h, toit: b.toit, cheminee: k >= 2, fenetres: k >= 2 ? 2 : 1 }) + enseigne(x + w / 2 - 4, y - 20, b.embleme);
  },
  long(b, x, y, k) {
    const w = k >= 2 ? 190 : 150;
    const g = [ombre(x, y, w + (k >= 3 ? 60 : 0))];
    if (k >= 3) g.push(maisonnette({ x: x - w / 2 - 20, y: y - 26, w: 90, h: 50, toit: assombrir(b.toit, 0.85), fenetres: 1, porte: false, cheminee: false }));
    g.push(maisonnette({ x, y, w, h: 56, toit: b.toit, colombages: false, mur: "#b9a27a", fenetres: k >= 2 ? 4 : 3, cheminee: k >= 2 }));
    for (let i = 0; i < 6; i++) g.push(`<line x1="${n(x - w / 2 + (w * (i + 0.5)) / 6)}" y1="${n(y - 56)}" x2="${n(x - w / 2 + (w * (i + 0.5)) / 6)}" y2="${n(y)}" stroke="#8a7350" stroke-width="2"/>`);
    g.push(enseigne(x + w / 2 - 22, y - 30, b.embleme));
    return g.join("");
  },
  atelier(b, x, y, k) {
    const w = k >= 2 ? 116 : 96;
    const g = [ombre(x, y, w + (k >= 3 ? 70 : 0))];
    if (k >= 3) g.push(maisonnette({ x: x + w / 2 + 34, y: y - 4, w: 70, h: 48, toit: assombrir(b.toit, 0.85), fenetres: 1, porte: false, cheminee: false }));
    g.push(maisonnette({ x, y, w, h: k >= 2 ? 66 : 56, toit: b.toit, fenetres: 2, cheminee: b.embleme === "enclume" || k >= 2 }));
    // L'auvent rayé de l'étal, ou la lueur de la forge.
    if (k >= 2 && b.embleme === "piece") {
      g.push(`<polygon points="${pts([[x - w / 2 - 6, y - 40], [x + w / 2 + 6, y - 40], [x + w / 2 + 16, y - 24], [x - w / 2 - 16, y - 24]])}" fill="#e9dcc0" stroke="${TRAIT}" stroke-width="2"/>`);
      for (let i = 0; i < 6; i++) g.push(`<polygon points="${pts([[x - w / 2 - 6 + ((w + 12) * i) / 6, y - 40], [x - w / 2 - 6 + ((w + 12) * (i + 0.5)) / 6, y - 40], [x - w / 2 - 16 + ((w + 32) * (i + 0.5)) / 6, y - 24], [x - w / 2 - 16 + ((w + 32) * i) / 6, y - 24]])}" fill="#3f4f6b"/>`);
    }
    if (b.embleme === "enclume") g.push(`<ellipse cx="${n(x - w / 2 - 14)}" cy="${n(y - 6)}" rx="18" ry="9" fill="#f08a3a" opacity=".55"/><rect x="${n(x - w / 2 - 22)}" y="${n(y - 14)}" width="16" height="12" fill="#3a3a3a" stroke="${TRAIT}" stroke-width="2"/>`);
    g.push(enseigne(x + w / 2 - 18, y - 28, b.embleme));
    return g.join("");
  },
  tour(b, x, y, k) {
    if (k <= 1) {
      // Le mirador : quatre pieds, une plateforme, un toit pointu.
      return ombre(x, y, 60)
        + `<line x1="${x - 22}" y1="${y}" x2="${x - 16}" y2="${y - 100}" stroke="${BOIS}" stroke-width="6"/><line x1="${x + 22}" y1="${y}" x2="${x + 16}" y2="${y - 100}" stroke="${BOIS}" stroke-width="6"/>`
        + `<line x1="${x - 20}" y1="${y - 20}" x2="${x + 18}" y2="${y - 70}" stroke="${BOIS}" stroke-width="3"/><line x1="${x + 20}" y1="${y - 20}" x2="${x - 18}" y2="${y - 70}" stroke="${BOIS}" stroke-width="3"/>`
        + `<rect x="${x - 26}" y="${y - 118}" width="52" height="20" fill="#7a5a36" stroke="${TRAIT}" stroke-width="2.5"/>`
        + `<polygon points="${pts([[x - 32, y - 118], [x + 32, y - 118], [x, y - 156]])}" fill="${couleurSure(b.toit)}" stroke="${TRAIT}" stroke-width="2.5"/>`;
    }
    const h = k >= 3 ? 170 : 140;
    const g = [ombre(x, y, 70), `<rect x="${x - 30}" y="${y - h}" width="60" height="${h}" fill="${PIERRE}" stroke="${TRAIT}" stroke-width="2.5"/>`];
    for (let i = 1; i < 6; i++) g.push(`<line x1="${x - 30}" y1="${n(y - (h * i) / 6)}" x2="${x + 30}" y2="${n(y - (h * i) / 6)}" stroke="#8a8072" stroke-width="2"/>`);
    g.push(`<rect x="${x - 6}" y="${n(y - h * 0.6)}" width="12" height="18" fill="${FENETRE}" stroke="${TRAIT}" stroke-width="2"/>`);
    g.push(`<path d="M ${x - 9},${y} V ${y - 20} Q ${x},${y - 28} ${x + 9},${y - 20} V ${y} Z" fill="${PORTE}" stroke="${TRAIT}" stroke-width="2"/>`);
    g.push(`<path d="M ${x - 38},${y - h} H ${x + 38} V ${y - h - 16} H ${x + 26} V ${y - h - 8} H ${x + 12} V ${y - h - 16} H ${x - 2} V ${y - h - 8} H ${x - 16} V ${y - h - 16} H ${x - 38} Z" fill="${PIERRE}" stroke="${TRAIT}" stroke-width="2.5"/>`);
    if (k >= 3) g.push(`<ellipse cx="${x}" cy="${y - h - 22}" rx="22" ry="14" fill="#ffb347" opacity=".45"/><path d="M ${x - 8},${y - h - 14} Q ${x - 10},${y - h - 30} ${x},${y - h - 40} Q ${x + 10},${y - h - 28} ${x + 8},${y - h - 14} Z" fill="#f08a3a"/>`);
    return g.join("");
  },
  autel(b, x, y, k) {
    const g = [`<ellipse cx="${x}" cy="${y - 10}" rx="${86 + k * 6}" ry="${40 + k * 3}" fill="#6e5537" opacity=".35"/>`];
    if (k >= 2) g.push(`<ellipse cx="${x}" cy="${y - 12}" rx="${50 + k * 10}" ry="${24 + k * 5}" fill="url(#sc-lueur)"/>`);
    const pierres = 7;
    const pieces = [];
    for (let i = 0; i < pierres; i++) {
      const a = (i / pierres) * Math.PI * 2 - Math.PI / 2;
      pieces.push({ px: x + Math.cos(a) * 74, py: y - 10 + Math.sin(a) * 34 });
    }
    pieces.sort((p, q) => p.py - q.py);
    for (const { px, py } of pieces) g.push(`<polygon points="${pts([[px - 9, py], [px - 7, py - 34], [px, py - 40], [px + 7, py - 33], [px + 9, py]])}" fill="${PIERRE}" stroke="${TRAIT}" stroke-width="2"/>`);
    if (k >= 2) {
      g.push(`<rect x="${x - 26}" y="${y - 30}" width="52" height="20" fill="#8f8577" stroke="${TRAIT}" stroke-width="2.5"/>`);
      g.push(`<g transform="translate(${x},${y - 46})"><polygon points="0,-14 14,0 0,14 -14,0" fill="#c2402f"/><polygon points="0,-14 14,0 0,0" fill="#4f8fd0"/><polygon points="0,14 -14,0 0,0" fill="#6aa84f"/><polygon points="-14,0 0,-14 0,0" fill="#e8d36a"/><polygon points="0,-14 14,0 0,14 -14,0" fill="none" stroke="${TRAIT}" stroke-width="2"/></g>`);
    }
    if (k >= 3) g.push(`<path d="M ${x - 60},${y - 12} V ${y - 86} Q ${x},${y - 130} ${x + 60},${y - 86} V ${y - 12}" fill="none" stroke="${PIERRE}" stroke-width="14"/><path d="M ${x - 60},${y - 12} V ${y - 86} Q ${x},${y - 130} ${x + 60},${y - 86} V ${y - 12}" fill="none" stroke="${TRAIT}" stroke-width="2" opacity=".6"/>`);
    return g.join("");
  },
  champ(b, x, y, k) {
    const g = [];
    const parcelle = (cx, cy, w, h, couleur) => {
      g.push(`<rect x="${n(cx - w / 2)}" y="${n(cy - h)}" width="${w}" height="${h}" fill="#7a5f3c" stroke="${TRAIT}" stroke-width="2"/>`);
      for (let i = 1; i < Math.floor(h / 10); i++) g.push(`<line x1="${n(cx - w / 2 + 5)}" y1="${n(cy - h + i * 10)}" x2="${n(cx + w / 2 - 5)}" y2="${n(cy - h + i * 10)}" stroke="${couleur}" stroke-width="5" stroke-linecap="round"/>`);
    };
    parcelle(x - (k >= 2 ? 50 : 0), y, 90, 60, "#6aa84f");
    if (k >= 2) parcelle(x + 52, y, 90, 60, "#d9b84a");
    if (k >= 3) {
      for (const [dx, dy] of [[-80, -82], [-30, -92], [30, -88], [82, -80]]) g.push(`<circle cx="${x + dx}" cy="${y + dy}" r="16" fill="#4d7233" stroke="#1d2e16" stroke-width="2"/><circle cx="${x + dx - 4}" cy="${y + dy - 4}" r="3" fill="#c2402f"/>`);
      for (const dx of [-110, 112]) g.push(`<path d="M ${x + dx - 10},${y} Q ${x + dx},${y - 26} ${x + dx + 10},${y} Z" fill="#d9a13b" stroke="${TRAIT}" stroke-width="2"/>`);
    }
    // La palissade basse du potager.
    g.push(`<rect x="${x - (k >= 2 ? 102 : 52)}" y="${y - 66}" width="${k >= 2 ? 204 : 104}" height="68" fill="none" stroke="${BOIS}" stroke-width="3" stroke-dasharray="6 4"/>`);
    return g.join("");
  },
  puits(b, x, y, k) {
    const g = [];
    if (k >= 2) g.push(`<ellipse cx="${x}" cy="${y - 10}" rx="${k >= 3 ? 110 : 90}" ry="${k >= 3 ? 50 : 42}" fill="#b8a684" stroke="#8a7a5c" stroke-width="3"/><ellipse cx="${x}" cy="${y - 10}" rx="${k >= 3 ? 110 : 90}" ry="${k >= 3 ? 50 : 42}" fill="none" stroke="#9c8a68" stroke-width="2" stroke-dasharray="10 8"/>`);
    if (k >= 3) {
      g.push(`<ellipse cx="${x}" cy="${y - 8}" rx="46" ry="20" fill="${PIERRE}" stroke="${TRAIT}" stroke-width="2.5"/><ellipse cx="${x}" cy="${y - 12}" rx="38" ry="14" fill="#5f97b0"/>`);
      g.push(`<rect x="${x - 6}" y="${y - 46}" width="12" height="36" fill="${PIERRE}" stroke="${TRAIT}" stroke-width="2"/><path d="M ${x},${y - 46} Q ${x - 22},${y - 50} ${x - 26},${y - 16} M ${x},${y - 46} Q ${x + 22},${y - 50} ${x + 26},${y - 16}" fill="none" stroke="#8fc7dc" stroke-width="3"/>`);
      return g.join("");
    }
    g.push(ombre(x, y, 40), `<ellipse cx="${x}" cy="${y - 8}" rx="26" ry="11" fill="#2b221b" stroke="${TRAIT}" stroke-width="2"/><path d="M ${x - 26},${y - 8} V ${y - 22} A 26,11 0 0 1 ${x + 26},${y - 22} V ${y - 8}" fill="${PIERRE}" stroke="${TRAIT}" stroke-width="2.5"/>`);
    g.push(`<line x1="${x - 22}" y1="${y - 20}" x2="${x - 22}" y2="${y - 58}" stroke="${BOIS}" stroke-width="4"/><line x1="${x + 22}" y1="${y - 20}" x2="${x + 22}" y2="${y - 58}" stroke="${BOIS}" stroke-width="4"/><polygon points="${pts([[x - 32, y - 56], [x + 32, y - 56], [x, y - 76]])}" fill="${couleurSure(b.toit)}" stroke="${TRAIT}" stroke-width="2.5"/>`);
    return g.join("");
  },
};

// Avant le premier niveau : des ruines (l'auberge détruite), un terrain jalonné, ou un chantier qui monte avec la cagnotte.
function ruines(b, x, y) {
  if (b.forme === "auberge") return ruinesAuberge(b, x, y);
  const w = 110;
  const g = [`<ellipse cx="${x}" cy="${y - 4}" rx="${w * 0.62}" ry="${w * 0.2}" fill="#2b221b" opacity=".55"/>`];
  const morceaux = [[-0.5, -0.32, 46], [-0.32, -0.12, 70], [-0.1, 0.1, 30], [0.12, 0.3, 58], [0.32, 0.5, 38]];
  for (const [a, z, hm] of morceaux) {
    const x0 = x + w * a;
    const x1 = x + w * z;
    g.push(`<polygon points="${pts([[x0, y], [x0, y - hm * 0.7], [x0 + (x1 - x0) * 0.3, y - hm], [x0 + (x1 - x0) * 0.55, y - hm * 0.6], [x0 + (x1 - x0) * 0.8, y - hm * 0.85], [x1, y - hm * 0.5], [x1, y]])}" fill="${PIERRE}" stroke="${TRAIT}" stroke-width="2.5"/>`);
  }
  g.push(`<line x1="${n(x - w * 0.42)}" y1="${y - 6}" x2="${n(x + w * 0.1)}" y2="${y - 58}" stroke="#1d1510" stroke-width="7" stroke-linecap="round"/>`);
  g.push(`<line x1="${n(x - w * 0.05)}" y1="${y - 4}" x2="${n(x + w * 0.38)}" y2="${y - 44}" stroke="#1d1510" stroke-width="6" stroke-linecap="round"/>`);
  for (const [dx, dy, r] of [[-0.45, 6, 9], [-0.2, 10, 7], [0.05, 8, 10], [0.28, 9, 8], [0.46, 5, 7]]) g.push(`<circle cx="${n(x + w * dx)}" cy="${n(y + dy)}" r="${r}" fill="#8a8072" stroke="${TRAIT}" stroke-width="1.5"/>`);
  // Un reste de fumée.
  g.push(`<circle cx="${x + 10}" cy="${y - 80}" r="16" fill="#cfc6b8" opacity=".14"/><circle cx="${x + 24}" cy="${y - 104}" r="22" fill="#cfc6b8" opacity=".1"/>`);
  return g.join("");
}

function ruinesAuberge(b, x, y) {
  const w = 210;
  const d = 70;
  const g = [`<ellipse cx="${x + 6}" cy="${y - 20}" rx="170" ry="68" fill="#1e1712" opacity=".55"/>`];
  // Le sol de la salle, noirci, et ses fondations.
  const sol = [[x - w / 2, y], [x + w / 2, y], [x + w / 2 - 22, y - d], [x - w / 2 + 22, y - d]];
  g.push(`<polygon points="${pts(sol)}" fill="#3a2e24" stroke="${TRAIT}" stroke-width="2.5"/>`);
  for (let i = 1; i < 5; i++) g.push(`<line x1="${n(x - w / 2 + 6 + i * 4)}" y1="${n(y - (d * i) / 5)}" x2="${n(x + w / 2 - 6 - i * 4)}" y2="${n(y - (d * i) / 5)}" stroke="#2a211a" stroke-width="2"/>`);
  // Le mur du fond, à moitié tombé, avec le trou d'une fenêtre.
  g.push(`<polygon points="${pts([[x - w / 2 + 22, y - d], [x - w / 2 + 22, y - d - 62], [x - 50, y - d - 74], [x - 30, y - d - 40], [x + 10, y - d - 52], [x + 40, y - d - 20], [x + w / 2 - 22, y - d - 30], [x + w / 2 - 22, y - d]])}" fill="${PIERRE}" stroke="${TRAIT}" stroke-width="2.5" stroke-linejoin="round"/>`);
  g.push(`<rect x="${x - 72}" y="${y - d - 50}" width="16" height="20" fill="#2b221b"/><rect x="${x + 2}" y="${y - d - 38}" width="16" height="18" fill="#2b221b"/>`);
  // La cheminée, seule debout.
  g.push(`<rect x="${x + 44}" y="${y - d - 120}" width="30" height="120" fill="#968b7b" stroke="${TRAIT}" stroke-width="2.5"/>`);
  for (let i = 1; i < 7; i++) g.push(`<line x1="${x + 44}" y1="${y - d - 120 + i * 17}" x2="${x + 74}" y2="${y - d - 120 + i * 17}" stroke="#7a7062" stroke-width="2"/>`);
  g.push(`<rect x="${x + 40}" y="${y - d - 126}" width="38" height="9" fill="#7a7062" stroke="${TRAIT}" stroke-width="2"/>`);
  // Un pan du mur de façade, à gauche, et un angle à droite.
  g.push(`<polygon points="${pts([[x - w / 2, y], [x - w / 2, y - 58], [x - w / 2 + 18, y - 70], [x - w / 2 + 34, y - 40], [x - w / 2 + 52, y - 48], [x - w / 2 + 66, y - 14], [x - w / 2 + 70, y]])}" fill="${MUR}" stroke="${TRAIT}" stroke-width="2.5" stroke-linejoin="round"/>`);
  g.push(`<line x1="${x - w / 2 + 20}" y1="${y}" x2="${x - w / 2 + 20}" y2="${y - 66}" stroke="#2e2118" stroke-width="5"/>`);
  g.push(`<polygon points="${pts([[x + w / 2, y], [x + w / 2, y - 44], [x + w / 2 - 14, y - 52], [x + w / 2 - 24, y - 26], [x + w / 2 - 40, y - 18], [x + w / 2 - 44, y]])}" fill="${MUR}" stroke="${TRAIT}" stroke-width="2.5" stroke-linejoin="round"/>`);
  // Les poutres du toit tombées, noircies.
  for (const [x0, y0, x1, y1] of [[-70, -12, 30, -84], [-20, -6, 80, -60], [-96, -30, -10, -40], [10, -20, 96, -8]]) {
    g.push(`<line x1="${x + x0}" y1="${y + y0}" x2="${x + x1}" y2="${y + y1}" stroke="#16100c" stroke-width="8" stroke-linecap="round"/><line x1="${x + x0}" y1="${y + y0}" x2="${x + x1}" y2="${y + y1}" stroke="#3b2a1e" stroke-width="3" stroke-linecap="round"/>`);
  }
  // Des gravats, l'enseigne tombée devant la porte.
  for (const [dx, dy, r] of [[-110, 8, 10], [-80, 14, 7], [-30, 10, 9], [30, 12, 8], [70, 9, 11], [112, 6, 8], [96, 16, 6]]) g.push(`<circle cx="${x + dx}" cy="${y + dy}" r="${r}" fill="#8a8072" stroke="${TRAIT}" stroke-width="1.5"/>`);
  g.push(`<g transform="translate(${x - 18},${y + 22}) rotate(-24)"><rect x="-20" y="-11" width="40" height="22" rx="2" fill="#5e4329" stroke="${TRAIT}" stroke-width="2"/><rect x="-12" y="-1" width="24" height="5" fill="#a88a5c"/><rect x="-12" y="-7" width="6" height="11" fill="#a88a5c"/></g>`);
  g.push(`<circle cx="${x + 59}" cy="${y - d - 150}" r="14" fill="#cfc6b8" opacity=".16"/><circle cx="${x + 70}" cy="${y - d - 176}" r="20" fill="#cfc6b8" opacity=".11"/>`);
  return g.join("");
}

function parcelle(b, x, y) {
  const w = b.forme === "long" || b.forme === "auberge" ? 150 : b.forme === "tour" ? 60 : 100;
  const h = 50;
  const coins = [[x - w / 2, y], [x + w / 2, y], [x + w / 2 - 12, y - h], [x - w / 2 + 12, y - h]];
  return `<polygon points="${pts(coins)}" fill="#8a6f4a" opacity=".55"/>`
    + `<polygon points="${pts(coins.map(([a, c]) => [a, c - 10]))}" fill="none" stroke="#e9dcc0" stroke-width="1.5" stroke-dasharray="5 4"/>`
    + coins.map(([a, c]) => `<line x1="${n(a)}" y1="${n(c)}" x2="${n(a)}" y2="${n(c - 18)}" stroke="${BOIS}" stroke-width="4" stroke-linecap="round"/>`).join("");
}

function chantier(b, x, y, part) {
  const w = b.forme === "long" || b.forme === "auberge" ? 160 : b.forme === "tour" ? 64 : 104;
  const hMax = b.forme === "tour" ? 120 : 64;
  const h = Math.max(8, hMax * Math.min(1, part));
  const g = [`<rect x="${n(x - w / 2 - 6)}" y="${y - 10}" width="${w + 12}" height="14" fill="${PIERRE}" stroke="${TRAIT}" stroke-width="2"/>`];
  g.push(`<rect x="${n(x - w / 2)}" y="${n(y - 10 - h)}" width="${w}" height="${n(h)}" fill="#c9b58c" stroke="${TRAIT}" stroke-width="2"/>`);
  for (let i = 0; i <= 4; i++) g.push(`<line x1="${n(x - w / 2 + (w * i) / 4)}" y1="${n(y - 10 - h)}" x2="${n(x - w / 2 + (w * i) / 4)}" y2="${y - 10}" stroke="${BOIS}" stroke-width="3"/>`);
  g.push(echafaudage(x + w / 2 + 10, y, hMax + 20));
  // Une pile de planches et des pierres prêtes.
  g.push(`<rect x="${n(x - w / 2 - 50)}" y="${y - 14}" width="40" height="6" fill="#9a7650" stroke="${TRAIT}" stroke-width="1.5"/><rect x="${n(x - w / 2 - 46)}" y="${y - 20}" width="36" height="6" fill="#a8845c" stroke="${TRAIT}" stroke-width="1.5"/>`);
  return g.join("");
}

function relevement(b, x, y, part) {
  const w = b.forme === "auberge" ? 150 : 90;
  const h = Math.max(10, 70 * Math.min(1, part));
  const g = [];
  // La charpente neuve, en bois clair, au-dessus des pans tombés.
  for (let i = 0; i <= 5; i++) g.push(`<line x1="${n(x - w / 2 + (w * i) / 5)}" y1="${n(y - 70)}" x2="${n(x - w / 2 + (w * i) / 5)}" y2="${n(y - 70 - h)}" stroke="#d2ad72" stroke-width="5" stroke-linecap="round"/>`);
  g.push(`<line x1="${n(x - w / 2)}" y1="${n(y - 70 - h)}" x2="${n(x + w / 2)}" y2="${n(y - 70 - h)}" stroke="#d2ad72" stroke-width="5" stroke-linecap="round"/>`);
  g.push(`<line x1="${n(x - w / 2)}" y1="${n(y - 70)}" x2="${n(x + w / 2)}" y2="${n(y - 70)}" stroke="#b8925a" stroke-width="6"/>`);
  g.push(echafaudage(x - w / 2 - 44, y, 70 + h + 16));
  g.push(`<rect x="${n(x + w / 2 + 34)}" y="${y + 4}" width="46" height="7" fill="#c9a26a" stroke="${TRAIT}" stroke-width="1.5"/><rect x="${n(x + w / 2 + 38)}" y="${y - 3}" width="40" height="7" fill="#d8b47c" stroke="${TRAIT}" stroke-width="1.5"/>`);
  return g.join("");
}

function echafaudage(x, y, h) {
  const g = [];
  for (const dx of [0, 26]) g.push(`<line x1="${n(x + dx)}" y1="${n(y)}" x2="${n(x + dx)}" y2="${n(y - h)}" stroke="#8a6a44" stroke-width="4"/>`);
  for (let i = 1; i <= 3; i++) g.push(`<line x1="${n(x - 4)}" y1="${n(y - (h * i) / 3.3)}" x2="${n(x + 30)}" y2="${n(y - (h * i) / 3.3)}" stroke="#8a6a44" stroke-width="3"/>`);
  g.push(`<line x1="${n(x)}" y1="${n(y - 6)}" x2="${n(x + 26)}" y2="${n(y - h * 0.6)}" stroke="#8a6a44" stroke-width="2"/>`);
  return g.join("");
}

// L'enceinte, autour de tout le village : jalonnée, palissade, fossé et porte, rempart.
function enceinte(b) {
  const { x, y, rx, ry } = ENCEINTE;
  // L'ellipse ouverte au sud, là où passe la route.
  const a0 = Math.PI / 2 + 0.07;
  const a1 = Math.PI / 2 - 0.07 + Math.PI * 2;
  const p = (a, k = 1) => [x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k];
  const arc = (k) => {
    const [x0, y0] = p(a0, k);
    const [xm, ym] = p(a0 + Math.PI, k);
    const [x1, y1] = p(a1, k);
    return `M ${n(x0)},${n(y0)} A ${n(rx * k)},${n(ry * k)} 0 0 1 ${n(xm)},${n(ym)} A ${n(rx * k)},${n(ry * k)} 0 0 1 ${n(x1)},${n(y1)}`;
  };
  const k = b.niveau;
  if (!k) return `<path d="${arc(1)}" fill="none" stroke="#e9dcc0" stroke-width="2" stroke-dasharray="6 10" opacity=".7"/>`;
  const g = [];
  if (k >= 2) g.push(`<path d="${arc(1.05)}" fill="none" stroke="#3d5566" stroke-width="18" opacity=".7"/>`);
  if (k >= 3) {
    g.push(`<path d="${arc(1)}" fill="none" stroke="${TRAIT}" stroke-width="20"/><path d="${arc(1)}" fill="none" stroke="#9a9184" stroke-width="16"/><path d="${arc(1)}" fill="none" stroke="#6f675c" stroke-width="16" stroke-dasharray="10 8"/>`);
    for (const a of [Math.PI * 0.15, Math.PI * 0.85, Math.PI * 1.25, Math.PI * 1.75]) {
      const [tx, ty] = p(a);
      g.push(`<circle cx="${n(tx)}" cy="${n(ty)}" r="22" fill="#9a9184" stroke="${TRAIT}" stroke-width="3"/><circle cx="${n(tx)}" cy="${n(ty)}" r="13" fill="#6f675c"/>`);
    }
  } else {
    g.push(`<path d="${arc(1)}" fill="none" stroke="${TRAIT}" stroke-width="12"/><path d="${arc(1)}" fill="none" stroke="#7a5a36" stroke-width="9"/><path d="${arc(1)}" fill="none" stroke="#a07a4c" stroke-width="9" stroke-dasharray="3 7"/>`);
  }
  // La porte, de part et d'autre de la route.
  for (const s of [-1, 1]) {
    const [px, py] = p(Math.PI / 2 + s * 0.07);
    g.push(k >= 2
      ? `<rect x="${n(px - 14)}" y="${n(py - 40)}" width="28" height="44" fill="${k >= 3 ? "#9a9184" : "#7a5a36"}" stroke="${TRAIT}" stroke-width="2.5"/><polygon points="${pts([[px - 18, py - 40], [px + 18, py - 40], [px, py - 62]])}" fill="${couleurSure(b.toit)}" stroke="${TRAIT}" stroke-width="2"/>`
      : `<line x1="${n(px)}" y1="${n(py)}" x2="${n(px)}" y2="${n(py - 34)}" stroke="${TRAIT}" stroke-width="6"/>`);
  }
  return g.join("");
}

// ---------------------------------------------------------------- le village

// Un bâtiment à sa place : son dessin, ses travaux en cours, et ce qui le désigne (data-batiment) pour l'atelier.
function batiment(b, o) {
  const x = Math.round(+b.x || CENTRE.x);
  const y = Math.round(+b.y || CENTRE.y);
  const cout = b.prochain ? b.prochain.cout : 0;
  const part = cout ? Math.min(1, (b.cagnotte || 0) / cout) : 0;
  let dessin;
  if (!b.niveau) {
    // Des ruines qu'on relève : elles restent, la charpente neuve et l'échafaudage montent avec la cagnotte.
    if (b.ruine && b.cagnotte) dessin = ruines(b, x, y) + relevement(b, x, y, part);
    else if (b.ruine) dessin = ruines(b, x, y);
    else dessin = b.cagnotte ? chantier(b, x, y, part) : parcelle(b, x, y);
  }
  else {
    const forme = FORMES[b.forme] || FORMES.maison;
    dessin = forme(b, x, y, Math.max(1, Math.min(3, b.niveau)));
    // Le niveau suivant déjà entamé : un échafaudage contre le mur.
    if (b.cagnotte && b.prochain && b.forme !== "champ" && b.forme !== "puits" && b.forme !== "autel") dessin += echafaudage(x - 110, y, 90);
  }
  const choisi = o.selection === b.id || o.focus === b.id;
  const halo = choisi ? `<ellipse cx="${x}" cy="${y - 4}" rx="${b.forme === "auberge" ? 150 : 100}" ry="${b.forme === "auberge" ? 46 : 34}" fill="none" stroke="#e0b562" stroke-width="5" stroke-dasharray="14 8"/>` : "";
  return `<g class="sc-batiment${choisi ? " choisi" : ""}${b.cache ? " cache" : ""}" data-batiment="${e(b.id)}"${b.cache ? ' opacity=".45"' : ""}>${halo}${dessin}</g>`;
}

function etiquette(b, o) {
  const x = Math.round(+b.x || CENTRE.x);
  const y = Math.round(+b.y || CENTRE.y);
  const dy = b.forme === "champ" ? 26 : b.forme === "autel" ? 40 : 34;
  const sous = !b.niveau ? (b.cagnotte && b.prochain ? `chantier ${Math.round((100 * b.cagnotte) / b.prochain.cout)} %` : b.ruine ? "en ruines" : "à bâtir")
    : `niveau ${ROMAINS[b.niveau] || b.niveau}`;
  const taille = o.tv ? 26 : 22;
  return `<g class="sc-etiquette" data-batiment="${e(b.id)}"${b.cache ? ' opacity=".55"' : ""}>`
    + `<text x="${x}" y="${y + dy}" text-anchor="middle" font-family="Cinzel, Georgia, serif" font-weight="700" font-size="${taille}" fill="#f4ead4" stroke="#1a120c" stroke-width="6" stroke-linejoin="round" paint-order="stroke">${e(b.nom)}${b.cache ? " (caché)" : ""}</text>`
    + `<text x="${x}" y="${y + dy + taille * 0.95}" text-anchor="middle" font-family="EB Garamond, Georgia, serif" font-style="italic" font-size="${taille * 0.8}" fill="#e0c79a" stroke="#1a120c" stroke-width="5" stroke-linejoin="round" paint-order="stroke">${e(sous)}</text></g>`;
}

const DEFS = `<defs>
  <radialGradient id="sc-herbe" gradientUnits="userSpaceOnUse" cx="800" cy="470" r="1250"><stop offset="0" stop-color="#5a7a38"/><stop offset=".7" stop-color="#435f2c"/><stop offset="1" stop-color="#2e4420"/></radialGradient>
  <radialGradient id="sc-clairiere" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#9c8158" stop-opacity=".75"/><stop offset=".65" stop-color="#8a7350" stop-opacity=".45"/><stop offset="1" stop-color="#7a6a48" stop-opacity="0"/></radialGradient>
  <radialGradient id="sc-lueur" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#e8d9ff" stop-opacity=".85"/><stop offset=".5" stop-color="#9fb8ff" stop-opacity=".35"/><stop offset="1" stop-color="#6a8cff" stop-opacity="0"/></radialGradient>
</defs>`;

// batiments : au format de sanctuaire_public (id, nom, forme, toit, embleme, niveau, niveaux, ruine, x, y, cagnotte,
// prochain), avec cache pour l'atelier. o : { tv, selection, focus }.
export function svgVillage(batiments, o = {}) {
  const liste = (batiments || []).filter((b) => b && b.forme);
  const murs = liste.filter((b) => b.forme === "enceinte");
  const debout = liste.filter((b) => b.forme !== "enceinte").sort((a, b) => a.y - b.y);
  return `<svg class="sc-village" viewBox="0 0 ${LARGEUR} ${HAUTEUR}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" overflow="visible" role="img" aria-label="Le sanctuaire">
    ${DEFS}${terrain(debout)}${murs.map((b) => `<g class="sc-batiment${o.selection === b.id || o.focus === b.id ? " choisi" : ""}" data-batiment="${e(b.id)}"${b.cache ? ' opacity=".45"' : ""}>${enceinte(b)}</g>`).join("")}${foret(debout)}
    ${debout.map((b) => batiment(b, o)).join("")}
    ${debout.map((b) => etiquette(b, o)).join("")}
  </svg>`;
}

// Les bâtiments du sanctuaire complet (atelier) au format du dessin : comme sanctuaire_public, cachés compris.
export function batimentsVus(s) {
  const types = new Map((s?.catalogue || []).map((t) => [t.type, t]));
  return (s?.batiments || []).map((b) => {
    const t = types.get(b.type);
    if (!t) return null;
    const k = Math.max(0, Math.min(t.niveaux.length, +b.niveau || 0));
    const n2 = k < t.niveaux.length ? { ...t.niveaux[k], rang: k + 1 } : null;
    return {
      id: b.id, nom: b.nom || t.nom, forme: t.forme, toit: t.toit, embleme: t.embleme, niveau: k, niveaux: t.niveaux.length,
      ruine: !!b.ruine, x: b.x, y: b.y, cagnotte: +b.cagnotte || 0, prochain: n2, cache: !!b.cache,
    };
  }).filter(Boolean);
}
