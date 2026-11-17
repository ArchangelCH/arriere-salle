// Dessins à la plume : montagnes, arbres, collines, marais… et icônes des lieux. Unités : la case.

const fr = (v, k) => {
  const t = v * k;
  return t - Math.floor(t);
};

function montagne(ctx, x, y, s, v, st, genre) {
  const w = s * (1.02 + 0.42 * fr(v, 7.13));
  const px = x + (fr(v, 3.71) - 0.5) * w * 0.26;
  const py = y - s;
  const l = x - w / 2;
  const r = x + w / 2;
  const shx = l + (px - l) * 0.46;
  const shy = y - s * (0.4 + 0.16 * fr(v, 5.3));
  const rsx = px + (r - px) * 0.5;
  const rsy = y - s * (0.42 + 0.14 * fr(v, 9.1));
  const volcan = genre === "volcan";
  const cr = volcan ? w * 0.09 : 0;

  const silhouette = () => {
    ctx.moveTo(l, y);
    ctx.quadraticCurveTo(l + (shx - l) * 0.5, y - s * 0.1, shx, shy);
    ctx.quadraticCurveTo(shx + (px - cr - shx) * 0.4, py + s * 0.13, px - cr, py + (volcan ? s * 0.1 : 0));
    if (volcan) ctx.lineTo(px + cr, py + s * 0.1);
    ctx.quadraticCurveTo(px + cr + (rsx - px - cr) * 0.55, py + s * 0.12, rsx, rsy);
    ctx.quadraticCurveTo(rsx + (r - rsx) * 0.5, y - s * 0.12, r, y);
  };

  ctx.beginPath();
  silhouette();
  ctx.closePath();
  ctx.fillStyle = volcan ? st.volcanFond : st.montagneClair;
  ctx.fill();

  const bx = px + (r - px) * (0.1 + 0.14 * fr(v, 2.3));
  ctx.beginPath();
  ctx.moveTo(px + cr * 0.4, py + (volcan ? s * 0.1 : 0));
  ctx.quadraticCurveTo(px + (bx - px) * 0.25 + w * 0.05, y - s * 0.45, bx, y);
  ctx.lineTo(r, y);
  ctx.quadraticCurveTo(rsx + (r - rsx) * 0.5, y - s * 0.12, rsx, rsy);
  ctx.quadraticCurveTo(px + cr + (rsx - px - cr) * 0.55, py + s * 0.12, px + cr, py + (volcan ? s * 0.1 : 0));
  ctx.closePath();
  ctx.fillStyle = st.montagneOmbre;
  ctx.fill();

  if (genre === "sommet") {
    const nl = 0.3 + 0.08 * fr(v, 4.4);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - (px - shx) * nl * 1.9, py + s * nl);
    const n = 4;
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const xx = px - (px - shx) * nl * 1.9 + ((rsx - px) * nl * 1.7 + (px - shx) * nl * 1.9) * t;
      ctx.lineTo(xx, py + s * nl * (k % 2 ? 0.72 : 1.05));
    }
    ctx.lineTo(px + (rsx - px) * nl * 1.7, py + s * nl * 0.95);
    ctx.closePath();
    ctx.fillStyle = st.neigeSommet;
    ctx.fill();
  }

  ctx.strokeStyle = st.hachure;
  ctx.lineWidth = 0.045;
  ctx.beginPath();
  const nh = 3 + Math.floor(s * 1.4);
  for (let k = 1; k <= nh; k++) {
    const t = 0.15 + (k / (nh + 1)) * 0.72;
    const hx = px + (r - px) * t * 0.92;
    const hy = py + (y - py) * t;
    const long = (y - hy) * (0.35 + 0.25 * fr(v, 11 + k));
    ctx.moveTo(hx, hy + s * 0.04);
    ctx.lineTo(hx - long * 0.35, hy + long);
  }
  ctx.stroke();

  ctx.strokeStyle = st.encre;
  ctx.lineWidth = 0.1;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  silhouette();
  ctx.stroke();
  ctx.lineWidth = 0.06;
  ctx.beginPath();
  ctx.moveTo(px + cr * 0.4, py + (volcan ? s * 0.1 : 0));
  ctx.quadraticCurveTo(px + (bx - px) * 0.25 + w * 0.05, y - s * 0.45, bx - (bx - px) * 0.3, y - s * 0.3);
  ctx.stroke();

  if (volcan) {
    ctx.strokeStyle = st.lave;
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.moveTo(px - cr * 0.3, py + s * 0.12);
    ctx.quadraticCurveTo(px - w * 0.12, y - s * 0.55, px - w * 0.2 + fr(v, 6.1) * w * 0.1, y - s * 0.22);
    ctx.stroke();
    ctx.fillStyle = "#2b1d12";
    ctx.beginPath();
    ctx.ellipse(px, py + s * 0.1, cr * 1.05, s * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function colline(ctx, x, y, s, v, st) {
  const w = s * (1.45 + 0.35 * fr(v, 4.1));
  const hgt = s * (0.46 + 0.14 * fr(v, 6.7));
  const l = x - w / 2;
  const r = x + w / 2;
  const arc = () => {
    ctx.moveTo(l, y);
    ctx.bezierCurveTo(l + w * 0.18, y - hgt * 1.08, r - w * 0.32, y - hgt * 1.18, r, y);
  };
  ctx.beginPath();
  arc();
  ctx.closePath();
  ctx.fillStyle = st.collineFond;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + w * 0.1, y - hgt * 0.86);
  ctx.bezierCurveTo(r - w * 0.28, y - hgt * 0.92, r - w * 0.1, y - hgt * 0.45, r, y);
  ctx.lineTo(x + w * 0.24, y);
  ctx.closePath();
  ctx.fillStyle = st.collineOmbre;
  ctx.fill();
  ctx.strokeStyle = st.encre;
  ctx.lineWidth = 0.075;
  ctx.lineCap = "round";
  ctx.beginPath();
  arc();
  ctx.stroke();
  ctx.strokeStyle = st.hachure;
  ctx.lineWidth = 0.04;
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const hx = x + w * (0.14 + k * 0.1);
    const hy = y - hgt * (0.62 - k * 0.16);
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - w * 0.04, hy + hgt * 0.3);
  }
  ctx.stroke();
}

function arbre(ctx, x, y, s, v, st, sombre) {
  const fonds = sombre ? st.sombreFond : st.arbreFond;
  const r = s * 0.36;
  const cy = y - s * 0.55;
  ctx.fillStyle = st.arbreOmbre;
  ctx.beginPath();
  ctx.ellipse(x + r * 0.35, y - s * 0.02, r * 0.95, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = st.arbreTrait;
  ctx.lineWidth = 0.06;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, cy + r * 0.4);
  ctx.stroke();
  const couronne = () => {
    ctx.beginPath();
    ctx.arc(x - r * 0.45, cy + r * 0.18, r * 0.7, 0, Math.PI * 2);
    ctx.moveTo(x + r * 1.17, cy + r * 0.22);
    ctx.arc(x + r * 0.47, cy + r * 0.22, r * 0.7, 0, Math.PI * 2);
    ctx.moveTo(x + r * 0.82, cy - r * 0.3);
    ctx.arc(x, cy - r * 0.3, r * 0.82, 0, Math.PI * 2);
  };
  couronne();
  ctx.lineWidth = 0.12;
  ctx.stroke();
  ctx.fillStyle = fonds[Math.floor(fr(v, 5.7) * fonds.length)];
  ctx.fill();
}

function pin(ctx, x, y, s, v, st, sombre) {
  const fonds = sombre ? st.sombreFond : st.pinFond;
  const hgt = s;
  const w = s * (0.5 + 0.1 * fr(v, 3.3));
  ctx.fillStyle = st.arbreOmbre;
  ctx.beginPath();
  ctx.ellipse(x + w * 0.2, y - s * 0.02, w * 0.5, w * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = st.arbreTrait;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 0.06;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - hgt * 0.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - hgt);
  ctx.lineTo(x + w * 0.32, y - hgt * 0.58);
  ctx.lineTo(x + w * 0.16, y - hgt * 0.58);
  ctx.lineTo(x + w * 0.5, y - hgt * 0.18);
  ctx.lineTo(x - w * 0.5, y - hgt * 0.18);
  ctx.lineTo(x - w * 0.16, y - hgt * 0.58);
  ctx.lineTo(x - w * 0.32, y - hgt * 0.58);
  ctx.closePath();
  ctx.lineWidth = 0.11;
  ctx.stroke();
  ctx.fillStyle = fonds[Math.floor(fr(v, 4.9) * fonds.length)];
  ctx.fill();
}

function couronneRonde(ctx, x, cy, r) {
  ctx.moveTo(x - r * 0.45 + r * 0.7, cy + r * 0.18);
  ctx.arc(x - r * 0.45, cy + r * 0.18, r * 0.7, 0, Math.PI * 2);
  ctx.moveTo(x + r * 1.17, cy + r * 0.22);
  ctx.arc(x + r * 0.47, cy + r * 0.22, r * 0.7, 0, Math.PI * 2);
  ctx.moveTo(x + r * 0.82, cy - r * 0.3);
  ctx.arc(x, cy - r * 0.3, r * 0.82, 0, Math.PI * 2);
}

function silhouettePin(ctx, x, y, hgt, w) {
  ctx.moveTo(x, y - hgt);
  ctx.lineTo(x + w * 0.32, y - hgt * 0.58);
  ctx.lineTo(x + w * 0.16, y - hgt * 0.58);
  ctx.lineTo(x + w * 0.5, y - hgt * 0.18);
  ctx.lineTo(x - w * 0.5, y - hgt * 0.18);
  ctx.lineTo(x - w * 0.16, y - hgt * 0.58);
  ctx.lineTo(x - w * 0.32, y - hgt * 0.58);
  ctx.closePath();
}

const ARBRES = new Set(["arbre", "pin", "arbre_sombre"]);
export const estArbre = (t) => ARBRES.has(t);

// Les arbres d'une même rangée se dessinent ensemble : une poignée de tracés au lieu de quatre par arbre.
export function dessinerArbres(ctx, liste, st) {
  const ronds = new Map();
  const pointus = new Map();
  const ranger = (carte, cle, a) => {
    let g = carte.get(cle);
    if (!g) carte.set(cle, (g = []));
    g.push(a);
  };
  ctx.fillStyle = st.arbreOmbre;
  ctx.beginPath();
  for (const a of liste) {
    const sombre = a.t === "arbre_sombre";
    const pointu = a.t === "pin" || (sombre && fr(a.v, 3.3) > 0.45);
    if (pointu) {
      const s = sombre ? a.s * 1.1 : a.s;
      const w = s * (0.5 + 0.1 * fr(a.v, 3.3));
      ctx.moveTo(a.x + w * 0.7, a.y - s * 0.02);
      ctx.ellipse(a.x + w * 0.2, a.y - s * 0.02, w * 0.5, w * 0.14, 0, 0, Math.PI * 2);
      const fonds = sombre ? st.sombreFond : st.pinFond;
      ranger(pointus, fonds[Math.floor(fr(a.v, 4.9) * fonds.length)], { x: a.x, y: a.y, s, w });
    } else {
      const r = a.s * 0.36;
      ctx.moveTo(a.x + r * 1.3, a.y - a.s * 0.02);
      ctx.ellipse(a.x + r * 0.35, a.y - a.s * 0.02, r * 0.95, r * 0.28, 0, 0, Math.PI * 2);
      const fonds = sombre ? st.sombreFond : st.arbreFond;
      ranger(ronds, fonds[Math.floor(fr(a.v, 5.7) * fonds.length)], { x: a.x, y: a.y, s: a.s, r });
    }
  }
  ctx.fill();
  ctx.strokeStyle = st.arbreTrait;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 0.06;
  ctx.beginPath();
  for (const g of ronds.values()) {
    for (const a of g) {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x, a.y - a.s * 0.55 + a.r * 0.4);
    }
  }
  for (const g of pointus.values()) {
    for (const a of g) {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x, a.y - a.s * 0.2);
    }
  }
  ctx.stroke();
  for (const [couleur, g] of ronds) {
    ctx.beginPath();
    for (const a of g) couronneRonde(ctx, a.x, a.y - a.s * 0.55, a.r);
    ctx.lineWidth = 0.12;
    ctx.stroke();
    ctx.fillStyle = couleur;
    ctx.fill();
  }
  for (const [couleur, g] of pointus) {
    ctx.beginPath();
    for (const a of g) silhouettePin(ctx, a.x, a.y, a.s, a.w);
    ctx.lineWidth = 0.11;
    ctx.stroke();
    ctx.fillStyle = couleur;
    ctx.fill();
  }
}

function palmier(ctx, x, y, s, v, st) {
  const penche = (fr(v, 2.1) - 0.5) * 0.45 * s;
  const tx = x + penche;
  const ty = y - s * 0.82;
  ctx.fillStyle = st.arbreOmbre;
  ctx.beginPath();
  ctx.ellipse(x + s * 0.15, y - s * 0.02, s * 0.34, s * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = st.stipe;
  ctx.lineCap = "round";
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + penche * 0.15, y - s * 0.45, tx, ty);
  ctx.stroke();
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = -Math.PI / 2 + (k - 2.5) * 0.62 + (fr(v, 7 + k) - 0.5) * 0.3;
    const L = s * (0.42 + 0.12 * fr(v, 3 + k));
    const bx = tx + Math.cos(a) * L;
    const by = ty + Math.sin(a) * L * 0.75 + L * 0.25;
    const nx = -Math.sin(a) * L * 0.16;
    const ny = Math.cos(a) * L * 0.16;
    const mx = (tx + bx) / 2;
    const my = (ty + by) / 2 - L * 0.12;
    ctx.moveTo(tx, ty);
    ctx.quadraticCurveTo(mx + nx, my + ny, bx, by);
    ctx.quadraticCurveTo(mx - nx, my - ny, tx, ty);
  }
  ctx.strokeStyle = st.arbreTrait;
  ctx.lineWidth = 0.1;
  ctx.stroke();
  ctx.fillStyle = st.palme;
  ctx.fill();
}

function marais(ctx, x, y, s, v, st) {
  ctx.strokeStyle = st.marais;
  ctx.lineWidth = 0.055;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - s * 0.45, y);
  ctx.lineTo(x + s * 0.3, y);
  ctx.moveTo(x - s * 0.15, y + s * 0.2);
  ctx.lineTo(x + s * 0.5, y + s * 0.2);
  for (const k of [-0.22, 0, 0.18]) {
    ctx.moveTo(x + k * s, y);
    ctx.lineTo(x + k * s + k * 0.35 * s, y - s * (0.26 + 0.1 * fr(v, 9 + k)));
  }
  ctx.stroke();
}

function touffe(ctx, x, y, s, v, st, couleur) {
  ctx.strokeStyle = couleur;
  ctx.lineWidth = 0.05;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - s * 0.3, y - s * 0.4);
  ctx.lineTo(x - s * 0.05, y);
  ctx.moveTo(x, y - s * 0.55);
  ctx.lineTo(x, y);
  ctx.moveTo(x + s * 0.32, y - s * 0.38);
  ctx.lineTo(x + s * 0.06, y);
  ctx.stroke();
}

function dune(ctx, x, y, s, v, st) {
  ctx.strokeStyle = st.dune;
  ctx.lineWidth = 0.06;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - s * 0.62, y);
  ctx.quadraticCurveTo(x - s * 0.1, y - s * 0.36, x + s * 0.55, y - s * 0.04);
  ctx.moveTo(x - s * 0.3, y + s * 0.2);
  ctx.quadraticCurveTo(x + s * 0.05, y + s * 0.02, x + s * 0.34, y + s * 0.18);
  ctx.stroke();
  ctx.fillStyle = st.dune;
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    ctx.arc(x + (fr(v, 3 + k) - 0.5) * s, y + s * (0.3 + 0.1 * k), 0.035, 0, Math.PI * 2);
    ctx.fill();
  }
}

function champ(ctx, x, y, s, v, st) {
  const a = -0.3 + fr(v, 2.7) * 0.6;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.strokeStyle = st.champ;
  ctx.lineWidth = 0.045;
  ctx.beginPath();
  for (let k = 0; k < 4; k++) {
    ctx.moveTo(-s * 0.45, -s * 0.3 + k * s * 0.18);
    ctx.lineTo(s * 0.45, -s * 0.3 + k * s * 0.18);
  }
  ctx.stroke();
  ctx.restore();
}

function congere(ctx, x, y, s, v, st) {
  ctx.strokeStyle = "rgba(92,112,128,.45)";
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.5, y);
  ctx.quadraticCurveTo(x, y - s * 0.25, x + s * 0.5, y);
  ctx.stroke();
}

export function dessinerSymbole(ctx, sym, st) {
  const { t, x, y, s, v } = sym;
  switch (t) {
    case "montagne": return montagne(ctx, x, y, s, v, st, "montagne");
    case "sommet": return montagne(ctx, x, y, s, v, st, "sommet");
    case "volcan": return montagne(ctx, x, y, s, v, st, "volcan");
    case "colline": return colline(ctx, x, y, s, v, st);
    case "arbre": return arbre(ctx, x, y, s, v, st, false);
    case "pin": return pin(ctx, x, y, s, v, st, false);
    case "arbre_sombre": return fr(v, 3.3) > 0.45 ? pin(ctx, x, y, s * 1.1, v, st, true) : arbre(ctx, x, y, s, v, st, true);
    case "marais": return marais(ctx, x, y, s, v, st);
    case "touffe": return touffe(ctx, x, y, s, v, st, st.herbe);
    case "herbe": return touffe(ctx, x, y, s * 0.8, v, st, st.herbe);
    case "dune": return dune(ctx, x, y, s, v, st);
    case "champ": return champ(ctx, x, y, s, v, st);
    case "congere": return congere(ctx, x, y, s, v, st);
    case "palmier": return palmier(ctx, x, y, s, v, st);
  }
}

// Icônes des lieux, dessinées dans une boîte unité (base en y = 0, le haut vers les y négatifs).

const ENCRE = "#2b1d12";
const SANG = "#8e1b17";

function couleursIcones(style) {
  return style === "couleur"
    ? { mur: "#efe4cc", toit: "#9d3b2a", toit2: "#7c5a3a", ombre: "rgba(43,29,18,.28)", or: "#c9a24a", magie: "#5b7fd0", roche: "#a89a80", eau: "#6e9fb2" }
    : { mur: "#f6eedb", toit: "#d8c29a", toit2: "#cdb690", ombre: "rgba(43,29,18,.22)", or: "#c9a24a", magie: "#5b7fd0", roche: "#e3d6b8", eau: "#a9c3cc" };
}

function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
}

function plein(ctx, fond, trait = true) {
  ctx.fillStyle = fond;
  ctx.fill();
  if (trait) ctx.stroke();
}

function tourelle(ctx, x0, x1, haut, c, toitPointu = true) {
  poly(ctx, [x0, 0, x0, haut, x1, haut, x1, 0]);
  plein(ctx, c.mur);
  if (toitPointu) {
    poly(ctx, [x0 - 0.04, haut, (x0 + x1) / 2, haut - (x1 - x0) * 1.25, x1 + 0.04, haut]);
    plein(ctx, c.toit);
  } else {
    const n = 3;
    const pas = (x1 - x0) / (2 * n - 1);
    ctx.beginPath();
    ctx.moveTo(x0, haut);
    for (let k = 0; k < n; k++) {
      const a = x0 + 2 * k * pas;
      ctx.lineTo(a, haut - 0.08);
      ctx.lineTo(a + pas, haut - 0.08);
      ctx.lineTo(a + pas, haut);
      if (k < n - 1) ctx.lineTo(a + 2 * pas, haut);
    }
    ctx.lineTo(x1, haut);
    ctx.stroke();
  }
}

function maison(ctx, x, largeur, haut, c, toit) {
  poly(ctx, [x - largeur / 2, 0, x - largeur / 2, -haut, x + largeur / 2, -haut, x + largeur / 2, 0]);
  plein(ctx, c.mur);
  poly(ctx, [x - largeur / 2 - 0.05, -haut, x, -haut - largeur * 0.55, x + largeur / 2 + 0.05, -haut]);
  plein(ctx, toit || c.toit);
  poly(ctx, [x - 0.04, 0, x - 0.04, -haut * 0.45, x + 0.04, -haut * 0.45, x + 0.04, 0]);
  plein(ctx, ENCRE, false);
}

function drapeau(ctx, x, bas, haut) {
  ctx.beginPath();
  ctx.moveTo(x, bas);
  ctx.lineTo(x, haut);
  ctx.stroke();
  poly(ctx, [x, haut, x + 0.26, haut + 0.07, x, haut + 0.15]);
  plein(ctx, SANG, false);
}

const DESSINS = {
  capitale(ctx, c) {
    poly(ctx, [-0.62, 0, -0.62, -0.34, 0.62, -0.34, 0.62, 0]);
    plein(ctx, c.mur);
    tourelle(ctx, -0.72, -0.44, -0.62, c);
    tourelle(ctx, 0.44, 0.72, -0.62, c);
    tourelle(ctx, -0.18, 0.18, -0.86, c);
    drapeau(ctx, 0, -1.08, -1.42);
    ctx.beginPath();
    ctx.moveTo(-0.1, 0);
    ctx.lineTo(-0.1, -0.14);
    ctx.arc(0, -0.14, 0.1, Math.PI, 0);
    ctx.lineTo(0.1, 0);
    ctx.fillStyle = ENCRE;
    ctx.fill();
  },
  cite(ctx, c) {
    poly(ctx, [-0.5, 0, -0.5, -0.3, 0.5, -0.3, 0.5, 0]);
    plein(ctx, c.mur);
    tourelle(ctx, -0.58, -0.34, -0.56, c);
    tourelle(ctx, 0.34, 0.58, -0.56, c);
    tourelle(ctx, -0.14, 0.14, -0.72, c);
  },
  ville(ctx, c) {
    maison(ctx, -0.34, 0.34, 0.28, c);
    maison(ctx, 0.34, 0.32, 0.24, c, c.toit2);
    poly(ctx, [-0.1, 0, -0.1, -0.5, 0.1, -0.5, 0.1, 0]);
    plein(ctx, c.mur);
    poly(ctx, [-0.13, -0.5, 0, -0.95, 0.13, -0.5]);
    plein(ctx, c.toit);
  },
  village(ctx, c) {
    maison(ctx, -0.2, 0.32, 0.24, c);
    maison(ctx, 0.22, 0.28, 0.2, c, c.toit2);
  },
  auberge(ctx, c) {
    maison(ctx, 0, 0.56, 0.36, c);
    poly(ctx, [0.14, -0.5, 0.14, -0.72, 0.22, -0.72, 0.22, -0.56]);
    plein(ctx, c.mur);
    ctx.beginPath();
    ctx.moveTo(0.28, -0.3);
    ctx.lineTo(0.5, -0.3);
    ctx.stroke();
    poly(ctx, [0.36, -0.3, 0.36, -0.18, 0.5, -0.18, 0.5, -0.3]);
    plein(ctx, SANG);
  },
  tour(ctx, c) {
    poly(ctx, [-0.17, 0, -0.14, -0.92, 0.14, -0.92, 0.17, 0]);
    plein(ctx, c.mur);
    poly(ctx, [-0.22, -0.92, 0, -1.4, 0.22, -0.92]);
    plein(ctx, c.toit);
    ctx.fillStyle = ENCRE;
    ctx.fillRect(-0.04, -0.62, 0.08, 0.14);
    ctx.fillRect(-0.05, -0.2, 0.1, 0.2);
  },
  temple(ctx, c) {
    poly(ctx, [-0.58, 0, -0.58, -0.08, 0.58, -0.08, 0.58, 0]);
    plein(ctx, c.mur);
    for (const x of [-0.42, -0.14, 0.14, 0.42]) {
      poly(ctx, [x - 0.06, -0.08, x - 0.06, -0.5, x + 0.06, -0.5, x + 0.06, -0.08]);
      plein(ctx, c.mur);
    }
    poly(ctx, [-0.62, -0.5, 0, -0.86, 0.62, -0.5]);
    plein(ctx, c.mur);
    ctx.beginPath();
    ctx.arc(0, -0.62, 0.07, 0, Math.PI * 2);
    ctx.fillStyle = c.or;
    ctx.fill();
  },
  forteresse(ctx, c) {
    poly(ctx, [-0.34, 0, -0.34, -0.6, 0.34, -0.6, 0.34, 0]);
    plein(ctx, c.mur);
    tourelle(ctx, -0.5, -0.26, -0.78, c, false);
    tourelle(ctx, 0.26, 0.5, -0.78, c, false);
    drapeau(ctx, 0, -0.6, -0.98);
  },
  cite_naine(ctx, c) {
    poly(ctx, [-0.72, 0, -0.18, -0.9, 0.08, -0.62, 0.3, -1.02, 0.78, 0]);
    plein(ctx, c.roche);
    ctx.beginPath();
    ctx.moveTo(-0.22, 0);
    ctx.lineTo(-0.22, -0.3);
    ctx.arc(0, -0.3, 0.22, Math.PI, 0);
    ctx.lineTo(0.22, 0);
    ctx.closePath();
    plein(ctx, ENCRE);
    poly(ctx, [-0.32, 0, -0.32, -0.36, -0.24, -0.36, -0.24, 0]);
    plein(ctx, c.or);
    poly(ctx, [0.24, 0, 0.24, -0.36, 0.32, -0.36, 0.32, 0]);
    plein(ctx, c.or);
  },
  comptoir(ctx, c) {
    poly(ctx, [-0.44, 0, -0.44, -0.4, 0.44, -0.4, 0.44, 0]);
    plein(ctx, c.mur);
    ctx.beginPath();
    for (let k = -0.44; k <= 0.45; k += 0.11) {
      ctx.moveTo(k, -0.4);
      ctx.lineTo(k + 0.055, -0.5);
      ctx.lineTo(k + 0.11, -0.4);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -0.2, 0.13, 0, Math.PI * 2);
    plein(ctx, c.or);
  },
  port(ctx, c) {
    ctx.lineWidth *= 1.3;
    ctx.beginPath();
    ctx.arc(0, -0.72, 0.08, 0, Math.PI * 2);
    ctx.moveTo(0, -0.64);
    ctx.lineTo(0, -0.05);
    ctx.moveTo(-0.22, -0.52);
    ctx.lineTo(0.22, -0.52);
    ctx.moveTo(-0.34, -0.26);
    ctx.quadraticCurveTo(-0.3, -0.02, 0, -0.04);
    ctx.quadraticCurveTo(0.3, -0.02, 0.34, -0.26);
    ctx.stroke();
  },
  mine(ctx, c) {
    poly(ctx, [-0.6, 0, -0.3, -0.62, 0.3, -0.62, 0.6, 0]);
    plein(ctx, c.roche);
    ctx.beginPath();
    ctx.moveTo(-0.22, 0);
    ctx.lineTo(-0.22, -0.3);
    ctx.arc(0, -0.3, 0.22, Math.PI, 0);
    ctx.lineTo(0.22, 0);
    ctx.closePath();
    plein(ctx, ENCRE);
    ctx.strokeStyle = c.toit2;
    ctx.lineWidth *= 1.6;
    ctx.beginPath();
    ctx.moveTo(-0.26, 0);
    ctx.lineTo(-0.26, -0.44);
    ctx.lineTo(0.26, -0.44);
    ctx.lineTo(0.26, 0);
    ctx.stroke();
  },
  grotte(ctx, c) {
    ctx.beginPath();
    ctx.moveTo(-0.66, 0);
    ctx.quadraticCurveTo(-0.5, -0.66, 0, -0.66);
    ctx.quadraticCurveTo(0.52, -0.64, 0.66, 0);
    ctx.closePath();
    plein(ctx, c.roche);
    ctx.beginPath();
    ctx.moveTo(-0.26, 0);
    ctx.quadraticCurveTo(-0.24, -0.4, 0, -0.4);
    ctx.quadraticCurveTo(0.24, -0.4, 0.26, 0);
    ctx.closePath();
    plein(ctx, ENCRE);
  },
  ruine(ctx, c) {
    poly(ctx, [-0.5, 0, -0.5, -0.46, -0.4, -0.52, -0.34, -0.38, -0.26, -0.44, -0.2, 0]);
    plein(ctx, c.mur);
    poly(ctx, [-0.04, 0, -0.04, -0.7, 0.06, -0.78, 0.12, -0.6, 0.16, 0]);
    plein(ctx, c.mur);
    poly(ctx, [0.3, 0, 0.32, -0.22, 0.44, -0.3, 0.52, 0]);
    plein(ctx, c.mur);
  },
  tombeau(ctx, c) {
    poly(ctx, [-0.44, 0, -0.44, -0.44, 0.44, -0.44, 0.44, 0]);
    plein(ctx, c.mur);
    poly(ctx, [-0.52, -0.44, 0, -0.76, 0.52, -0.44]);
    plein(ctx, c.mur);
    poly(ctx, [-0.12, 0, -0.12, -0.28, 0.12, -0.28, 0.12, 0]);
    plein(ctx, ENCRE, false);
  },
  puits(ctx, c) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(0, -0.36, 0.62, 0, Math.PI * 2);
    ctx.fillStyle = c.magie;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      ctx.moveTo(Math.cos(a) * 0.3, -0.36 + Math.sin(a) * 0.3);
      ctx.lineTo(Math.cos(a) * 0.52, -0.36 + Math.sin(a) * 0.52);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -0.36, 0.24, 0.24, 0, 0, Math.PI * 2);
    plein(ctx, c.magie);
    poly(ctx, [0, -0.54, 0.12, -0.36, 0, -0.18, -0.12, -0.36]);
    plein(ctx, "#f6eedb", false);
  },
  ile_volante(ctx, c) {
    ctx.save();
    ctx.fillStyle = c.ombre;
    ctx.beginPath();
    ctx.ellipse(0, 0.35, 0.5, 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    poly(ctx, [-0.62, -0.42, 0.62, -0.42, 0.22, -0.08, 0.04, 0.12, -0.2, -0.1]);
    plein(ctx, c.roche);
    tourelle(ctx, -0.3, -0.12, -0.7, c);
    poly(ctx, [-0.1, -0.42, -0.1, -0.62, 0.3, -0.62, 0.3, -0.42]);
    plein(ctx, c.mur);
  },
  camp(ctx, c) {
    poly(ctx, [-0.46, 0, 0, -0.6, 0.46, 0]);
    plein(ctx, c.toit2);
    poly(ctx, [-0.1, 0, 0, -0.2, 0.1, 0]);
    plein(ctx, ENCRE, false);
  },
  point(ctx, c) {
    poly(ctx, [0, -0.62, 0.3, -0.32, 0, -0.02, -0.3, -0.32]);
    plein(ctx, SANG);
    poly(ctx, [0, -0.46, 0.14, -0.32, 0, -0.18, -0.14, -0.32]);
    plein(ctx, "#f4ead4", false);
  },
};

export function dessinerIcone(ctx, type, x, y, s, style) {
  const c = couleursIcones(style);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.strokeStyle = ENCRE;
  ctx.lineWidth = 0.055;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  (DESSINS[type] || DESSINS.point)(ctx, c);
  ctx.restore();
}

// Bannière du groupe d'aventuriers.
export function dessinerGroupe(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineJoin = "round";
  ctx.fillStyle = "rgba(43,29,18,.3)";
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.32, 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ENCRE;
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -1.3);
  ctx.stroke();
  poly(ctx, [0, -1.3, 0.72, -1.3, 0.56, -1.02, 0.72, -0.74, 0, -0.74]);
  ctx.fillStyle = SANG;
  ctx.fill();
  ctx.lineWidth = 0.05;
  ctx.stroke();
  poly(ctx, [0.3, -1.17, 0.43, -1.02, 0.3, -0.87, 0.17, -1.02]);
  ctx.fillStyle = "#f4ead4";
  ctx.fill();
  ctx.restore();
}
