// Le sang sur un plan (plan.habillage.sang) : des taches posées ou peintes au pinceau à même le sol (flaque, éclaboussure,
// gouttes, traînée), avec leur taille, leur fraîcheur (rouge vif et luisant, puis brun sec et craquelé) et leur teinte
// (sang rouge, noir, vert, bleu : celui des monstres). Chaque tache se dessine toujours pareil (sa « graine »), sur la TV,
// au coin des joueurs et dans l'atelier. Ce module sert le dessin (peint.js, importé par la TV et le coin) et la logique de
// l'éditeur (outils/verifier_sang.mjs) : il ne touche à aucune donnée de la campagne. Le menu est dans sang-menu.js.
// Les taches ne se voient que dans le style Peint ; elles ne tombent que sur du sol et sous le brouillard.

export const TYPES_SANG = [
  ["pinceau", "Pinceau"], ["flaque", "Flaque"], ["eclaboussure", "Éclaboussure"], ["gouttes", "Gouttes"], ["trainee", "Traînée"],
];
// Ce qu'une tache peut être (le pinceau en mêle plusieurs).
export const FORMES_SANG = ["flaque", "eclaboussure", "gouttes", "trainee"];
export const TEINTES_SANG = [["rouge", "Sang rouge"], ["noir", "Sang noir"], ["vert", "Sang vert"], ["bleu", "Sang bleu"]];
export const SANG_MAX = 500;
export const TAILLE = { min: 0.3, max: 4 };

// Les couleurs d'une teinte : au centre et au bord, fraîches puis sèches.
const COULEURS = {
  rouge: { frais: ["#8a0f12", "#b3171c"], sec: ["#3d0d0c", "#54160f"] },
  noir: { frais: ["#0d0b10", "#221b28"], sec: ["#0a0808", "#181313"] },
  vert: { frais: ["#3f8f1f", "#74bd3c"], sec: ["#2b4616", "#3d5d20"] },
  bleu: { frais: ["#1f4fb5", "#4080e6"], sec: ["#1b2d57", "#2b4478"] },
};

const borne = (v, min, max, defaut) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defaut;
};
const deux = (x) => Math.round(x * 100) / 100;

export const teinteValide = (t) => (COULEURS[t] ? t : "rouge");
export const formeValide = (f) => (FORMES_SANG.includes(f) ? f : "flaque");

// Un hasard qui se rejoue : la même graine, le même dessin (mulberry32).
export function hasard(graine) {
  let a = (Number(graine) || 0) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const melange = (a, b, t) => rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t));

// Le centre et le bord d'une tache selon sa teinte et son âge (0 : fraîche, 1 : sèche).
export function couleursSang(teinte, age) {
  const c = COULEURS[teinteValide(teinte)];
  const t = borne(age, 0, 1, 0.2);
  return { centre: melange(c.frais[0], c.sec[0], t), bord: melange(c.frais[1], c.sec[1], t), luisant: 1 - t };
}

// ---------------------------------------------------------------- les données

export function habillageDe(plan, creer = false) {
  if (!plan.habillage || typeof plan.habillage !== "object") {
    if (!creer) return null;
    plan.habillage = { cree: new Date().toISOString().slice(0, 16), lumieres: [], objets: [], legende: [] };
  }
  if (!Array.isArray(plan.habillage.sang)) plan.habillage.sang = [];
  return plan.habillage;
}

export const sangDe = (plan) => (Array.isArray(plan.habillage?.sang) ? plan.habillage.sang.filter((s) => s && typeof s === "object") : []);

// Une tache lue dans un plan, ramenée aux bornes (rien si elle n'a pas de position).
export function tacheValide(s) {
  const x = Number(s?.x);
  const y = Number(s?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const forme = formeValide(s.type);
  const t = {
    x, y, r: borne(s.r, 0.1, TAILLE.max, 0.5), type: forme, age: borne(s.age, 0, 1, 0.2), graine: Math.abs(Math.floor(Number(s.graine) || 0)) % 1000000,
    rot: borne(s.rot, -7, 7, 0), teinte: teinteValide(s.teinte), cache: !!s.cache,
  };
  if (forme === "trainee") t.l = borne(s.l, 0.2, 12, 2);
  return t;
}

export const sol = (plan, x, y) => {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  return cx >= 0 && cy >= 0 && cx < plan.largeur && cy < plan.hauteur && !!plan.sol[cy * plan.largeur + cx];
};

// Une tache neuve, d'après les réglages du pinceau (opt : forme, taille, age, teinte, cache) et un hasard.
export function tache(forme, x, y, opt, rnd, extra = {}) {
  const s = {
    x: deux(x), y: deux(y), r: deux(borne(extra.r ?? opt.taille, 0.1, TAILLE.max, 1)), type: formeValide(forme), age: deux(borne(opt.age, 0, 1, 0.2)),
    graine: Math.floor(rnd() * 1000000), rot: deux(extra.rot ?? rnd() * Math.PI * 2), teinte: teinteValide(opt.teinte),
  };
  if (opt.cache) s.cache = true;
  if (s.type === "trainee") s.l = deux(borne(extra.l, 0.2, 12, s.r * 3));
  return s;
}

// Un coup de pinceau de (x0, y0) à (x, y) : des taches de formes mêlées le long du trait, serrées d'autant plus que le
// pinceau est petit. Ne tombe que sur du sol ; rend le nombre de taches posées (le trait s'arrête au maximum).
export function peindre(plan, x0, y0, x, y, opt, rnd = Math.random) {
  const hab = habillageDe(plan, true);
  const pas = Math.max(0.1, opt.taille * 0.3);
  const d = Math.hypot(x - x0, y - y0);
  const n = Math.max(1, Math.ceil(d / pas));
  let posees = 0;
  for (let k = 1; k <= n; k++) {
    if (hab.sang.length >= SANG_MAX) break;
    const t = n === 1 ? 1 : k / n;
    const a = rnd() * Math.PI * 2;
    const ecart = rnd() * opt.taille * 0.5;
    const px = x0 + (x - x0) * t + Math.cos(a) * ecart;
    const py = y0 + (y - y0) * t + Math.sin(a) * ecart;
    if (!sol(plan, px, py)) continue;
    const choix = rnd();
    const forme = choix < 0.45 ? "flaque" : choix < 0.8 ? "gouttes" : "eclaboussure";
    hab.sang.push(tache(forme, px, py, opt, rnd, { r: opt.taille * (0.35 + rnd() * 0.45) }));
    posees++;
  }
  return posees;
}

// Une tache posée d'un clic (ou d'un glissé pour la traînée : de (x0, y0) à (x, y)).
export function poser(plan, forme, x0, y0, x, y, opt, rnd = Math.random) {
  if (!sol(plan, x0, y0)) return { erreur: "Le sang tombe sur le sol d'une pièce." };
  const hab = habillageDe(plan, true);
  if (hab.sang.length >= SANG_MAX) return { erreur: `Au plus ${SANG_MAX} taches de sang par plan.` };
  const d = Math.hypot(x - x0, y - y0);
  const extra = forme === "trainee" ? (d > 0.3 ? { rot: Math.atan2(y - y0, x - x0), l: d } : { l: opt.taille * 2.2 }) : {};
  const s = tache(forme, x0, y0, opt, rnd, extra);
  hab.sang.push(s);
  return { tache: s };
}

// La gomme : retire les taches dont le centre est dans le rayon (plus la moitié de leur propre rayon).
export function effacer(plan, x, y, rayon) {
  const hab = habillageDe(plan);
  if (!hab || !Array.isArray(hab.sang)) return 0;
  const avant = hab.sang.length;
  hab.sang = hab.sang.filter((s) => Math.hypot(s.x - x, s.y - y) > rayon + (Number(s.r) || 0.5) * 0.5);
  return avant - hab.sang.length;
}

export function toutEffacer(plan) {
  const hab = habillageDe(plan);
  const n = hab?.sang?.length || 0;
  if (hab) hab.sang = [];
  return n;
}

// Montre ou cache aux joueurs tout le sang du plan ; rend le nombre de taches changées.
export function reveler(plan, oui) {
  let n = 0;
  for (const s of sangDe(plan)) {
    if (!!s.cache === !oui) continue;
    if (oui) delete s.cache;
    else s.cache = true;
    n++;
  }
  return n;
}

export const compter = (plan) => {
  const l = sangDe(plan);
  return { total: l.length, caches: l.filter((s) => s.cache).length };
};

// ---------------------------------------------------------------- le dessin

// Un contour irrégulier et doux autour de (0, 0) : n points à des rayons tirés, joints par des courbes.
function contour(ctx, rnd, r, n, etire = 1) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = r * (0.62 + rnd() * 0.48);
    pts.push([Math.cos(a) * k * etire, Math.sin(a) * k]);
  }
  ctx.beginPath();
  const m = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const dep = m(pts[n - 1], pts[0]);
  ctx.moveTo(dep[0], dep[1]);
  for (let i = 0; i < n; i++) {
    const fin = m(pts[i], pts[(i + 1) % n]);
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], fin[0], fin[1]);
  }
  ctx.closePath();
}

const css = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function goutte(ctx, x, y, r, c, a) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.008, r), 0, Math.PI * 2);
  ctx.fillStyle = css(c, a);
  ctx.fill();
}

function flaque(ctx, rnd, t, c) {
  const r = t.r;
  contour(ctx, rnd, r, 13, 0.85 + rnd() * 0.5);
  const g = ctx.createRadialGradient(0, 0, r * 0.05, 0, 0, r * 1.05);
  g.addColorStop(0, css(c.centre, 0.94));
  g.addColorStop(1, css(c.bord, 0.8));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = css(c.centre, 0.45);
  ctx.lineWidth = Math.max(0.01, r * 0.05);
  ctx.stroke();
  // Une flaque plus épaisse en son milieu, et quelques gouttes qui s'en détachent.
  contour(ctx, rnd, r * 0.55, 9);
  ctx.fillStyle = css(c.centre, 0.55);
  ctx.fill();
  for (let i = 0; i < 2 + Math.floor(rnd() * 3); i++) {
    const a = rnd() * Math.PI * 2;
    goutte(ctx, Math.cos(a) * r * (1.05 + rnd() * 0.4), Math.sin(a) * r * (1.05 + rnd() * 0.4), r * (0.03 + rnd() * 0.06), c.bord, 0.85);
  }
  if (c.luisant > 0.35) {
    // Le reflet d'un sang encore frais.
    ctx.beginPath();
    ctx.ellipse(-r * 0.25, -r * 0.28, r * 0.3, r * 0.14, -0.6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,235,230,${0.22 * c.luisant})`;
    ctx.fill();
  } else if (c.luisant < 0.25) {
    // Un sang sec craquelle.
    ctx.strokeStyle = "rgba(10,4,2,.32)";
    ctx.lineWidth = Math.max(0.006, r * 0.02);
    for (let i = 0; i < 5; i++) {
      const a = rnd() * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.1, Math.sin(a) * r * 0.1);
      ctx.lineTo(Math.cos(a + 0.3) * r * 0.45, Math.sin(a + 0.3) * r * 0.45);
      ctx.lineTo(Math.cos(a - 0.1) * r * 0.85, Math.sin(a - 0.1) * r * 0.85);
      ctx.stroke();
    }
  }
}

function eclaboussure(ctx, rnd, t, c) {
  const r = t.r;
  contour(ctx, rnd, r * 0.4, 9);
  ctx.fillStyle = css(c.centre, 0.92);
  ctx.fill();
  const rayons = 7 + Math.floor(rnd() * 6);
  for (let i = 0; i < rayons; i++) {
    const a = (i / rayons) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    const long = r * (0.55 + rnd() * 0.65);
    const large = r * (0.05 + rnd() * 0.07);
    const px = Math.cos(a + Math.PI / 2) * large;
    const py = Math.sin(a + Math.PI / 2) * large;
    ctx.beginPath();
    ctx.moveTo(px * 1.5, py * 1.5);
    ctx.quadraticCurveTo(Math.cos(a) * long * 0.5 + px, Math.sin(a) * long * 0.5 + py, Math.cos(a) * long, Math.sin(a) * long);
    ctx.quadraticCurveTo(Math.cos(a) * long * 0.5 - px, Math.sin(a) * long * 0.5 - py, -px * 1.5, -py * 1.5);
    ctx.closePath();
    ctx.fillStyle = css(c.bord, 0.88);
    ctx.fill();
    goutte(ctx, Math.cos(a) * long * (1.12 + rnd() * 0.2), Math.sin(a) * long * (1.12 + rnd() * 0.2), r * (0.03 + rnd() * 0.05), c.centre, 0.9);
  }
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2;
    const d = r * (0.7 + rnd() * 0.7);
    goutte(ctx, Math.cos(a) * d, Math.sin(a) * d, r * (0.015 + rnd() * 0.035), c.bord, 0.85);
  }
}

function gouttes(ctx, rnd, t, c) {
  const n = 3 + Math.floor(rnd() * 6);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * t.r;
    const gr = t.r * (0.05 + rnd() * 0.13);
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    if (rnd() < 0.3) {
      ctx.beginPath();
      ctx.ellipse(x, y, gr * 1.7, gr, rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fillStyle = css(c.centre, 0.9);
      ctx.fill();
    } else goutte(ctx, x, y, gr, rnd() < 0.5 ? c.centre : c.bord, 0.9);
  }
}

function trainee(ctx, rnd, t, c) {
  const L = t.l || t.r * 3;
  const largeur = t.r * 0.5;
  const haut = [];
  const bas = [];
  const pas = 8;
  for (let i = 0; i <= pas; i++) {
    const u = i / pas;
    const w = largeur * (1 - u * 0.75) * (0.8 + rnd() * 0.4);
    const x = u * L;
    haut.push([x, -w + (rnd() - 0.5) * largeur * 0.2]);
    bas.push([x, w + (rnd() - 0.5) * largeur * 0.2]);
  }
  ctx.beginPath();
  ctx.moveTo(haut[0][0], haut[0][1]);
  for (const p of haut) ctx.lineTo(p[0], p[1]);
  for (let i = bas.length - 1; i >= 0; i--) ctx.lineTo(bas[i][0], bas[i][1]);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, L, 0);
  g.addColorStop(0, css(c.centre, 0.95));
  g.addColorStop(1, css(c.bord, 0.5));
  ctx.fillStyle = g;
  ctx.fill();
  // Les traces de doigts et de tissu le long de la traînée, et la flaque où elle commence.
  ctx.strokeStyle = css(c.centre, 0.4);
  ctx.lineWidth = Math.max(0.006, largeur * 0.06);
  for (let i = 0; i < 5; i++) {
    const y = (rnd() - 0.5) * largeur * 1.2;
    ctx.beginPath();
    ctx.moveTo(L * 0.05, y);
    ctx.lineTo(L * (0.5 + rnd() * 0.45), y * 0.6);
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(0, 0);
  contour(ctx, rnd, t.r * 0.7, 10);
  ctx.fillStyle = css(c.centre, 0.9);
  ctx.fill();
  ctx.restore();
}

// Une tache à sa place : x, y, rotation et forme ; alpha : la transparence du tout (le MJ voit plus faible ce qui est caché).
export function dessinerSang(ctx, t, alpha = 1) {
  const c = couleursSang(t.teinte, t.age);
  const rnd = hasard(t.graine);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(t.x, t.y);
  ctx.rotate(t.rot || 0);
  if (t.type === "eclaboussure") eclaboussure(ctx, rnd, t, c);
  else if (t.type === "gouttes") gouttes(ctx, rnd, t, c);
  else if (t.type === "trainee") trainee(ctx, rnd, t, c);
  else flaque(ctx, rnd, t, c);
  ctx.restore();
}

// Le sang d'une zone du plan (cases x0..x1, y0..y1) : seulement sur les cases de sol (le sang ne déborde ni sur un mur ni
// dehors), à même le sol, sous le mobilier, les pions et le brouillard. taches : celles que voit celui qui regarde.
export function dessinerSangPlan(ctx, plan, taches, zone) {
  if (!taches.length) return;
  const w = plan.largeur;
  const zx0 = Math.max(0, Math.floor(zone.x0));
  const zy0 = Math.max(0, Math.floor(zone.y0));
  const zx1 = Math.min(w, Math.ceil(zone.x1));
  const zy1 = Math.min(plan.hauteur, Math.ceil(zone.y1));
  const sols = new Path2D();
  for (let y = zy0; y < zy1; y++) for (let x = zx0; x < zx1; x++) if (plan.sol[y * w + x]) sols.rect(x - 0.01, y - 0.01, 1.02, 1.02);
  ctx.save();
  ctx.clip(sols);
  for (const t of taches) {
    const etendue = t.type === "trainee" ? (t.l || 2) + t.r : t.r * 1.9;
    if (t.x + etendue < zone.x0 || t.x - etendue > zone.x1 || t.y + etendue < zone.y0 || t.y - etendue > zone.y1) continue;
    dessinerSang(ctx, t, t.cache ? 0.55 : 1);
  }
  ctx.restore();
}
