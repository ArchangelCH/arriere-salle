// Habillage d'une carte détaillée (carte.habillage, rédigé par l'API, validé par le MJ) dans le style « relief peint » :
// champs, vergers, haies, hameaux, sentiers, ponts, gués, bâtiments. L'API décide quoi poser et où ; ce module dessine.
// Vue des joueurs : rien de caché (cache) ni de lié à un lieu qu'ils ne connaissent pas. Vue du MJ : tout, ces
// éléments-là plus pâles. Carte publique (TV) : ce que le serveur a laissé passer, tel quel. La raison est une note du
// MJ : elle ne se dessine jamais.

import { hacher } from "./geo.js";
import { boitePoints, dessinerChemin } from "./peint.js";

const GENRES = ["champs", "vergers", "haies", "hameaux", "chemins", "ponts", "gues", "batiments"];
const rad = (d) => ((Number(d) || 0) * Math.PI) / 180;
const nombre = (v) => typeof v === "number" && isFinite(v);
const point = (p) => Array.isArray(p) && nombre(p[0]) && nombre(p[1]);
const croise = (a, b) => a.x1 > b.x0 && a.x0 < b.x1 && a.y1 > b.y0 && a.y0 < b.y1;
const autour = (x, y, r) => ({ x0: x - r, y0: y - r, x1: x + r, y1: y + r });

export function dansPolygone(x, y, pts) {
  let dedans = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

function centre(pts) {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

function hacherTexte(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

// La boîte d'un élément (en cases), ou null si sa géométrie est inutilisable.
function boiteElement(genre, el) {
  if (genre === "champs" || genre === "vergers") {
    return Array.isArray(el.zone) && el.zone.length >= 3 && el.zone.every(point) ? boitePoints(el.zone, 1) : null;
  }
  if (genre === "haies" || genre === "chemins") {
    return Array.isArray(el.points) && el.points.length >= 2 && el.points.every(point) ? boitePoints(el.points, 1) : null;
  }
  if (genre === "hameaux") {
    const fermes = (Array.isArray(el.fermes) ? el.fermes : []).filter((f) => f && nombre(f.x) && nombre(f.y));
    if (!fermes.length) return null;
    return boitePoints(fermes.map((f) => [f.x, f.y]), 2.6);
  }
  if (!nombre(el.x) || !nombre(el.y)) return null;
  if (genre === "ponts") return autour(el.x, el.y, (nombre(el.longueur) ? el.longueur : 1.4) / 2 + 0.6);
  return autour(el.x, el.y, genre === "gues" ? 1.2 : 1.6);
}

// Ce que la vue montre de l'habillage : [{ genre, el, pale, boite, cle }]. Mêmes règles que la TV (carte_tv, côté
// serveur) : un élément rattaché à un lieu ne se montre que si ce lieu est montré sur cette carte ; une ferme, un pont,
// un gué ou un bâtiment, seulement hors du brouillard.
export function habillageVu(hab, fond) {
  const res = [];
  if (!hab || typeof hab !== "object") return res;
  let lieuMontre = null;
  let horsBrume = null;
  if (!fond.publiques) {
    const montres = new Set();
    for (const m of fond.carte.marqueurs || []) {
      const vu = m.lieu ? fond.vuMarqueur(m) : null;
      if (vu && !vu.pale) montres.add(m.lieu);
    }
    lieuMontre = (id) => montres.has(id);
    horsBrume = (x, y) => fond.champs.connuA(x, y);
  }
  for (const genre of GENRES) {
    const liste = genre === "hameaux" && !Array.isArray(hab.hameaux) && hab.hameau ? [hab.hameau] : hab[genre];
    if (!Array.isArray(liste)) continue;
    for (let el of liste) {
      if (!el || typeof el !== "object") continue;
      const boite = boiteElement(genre, el);
      if (!boite) continue;
      let pale = false;
      if (lieuMontre) {
        let secret = el.cache === true || Boolean(el.lieu && !lieuMontre(el.lieu));
        if (genre === "hameaux") {
          // Chaque ferme suit le brouillard ; la vue du MJ pâlit celles que les joueurs ne voient pas.
          const fermes = (el.fermes || []).filter((f) => f && nombre(f.x) && nombre(f.y)).map((f) => ({ ...f, pale: secret || !horsBrume(f.x, f.y) }));
          if (fond.joueurs) {
            if (secret) continue;
            el = { ...el, fermes: fermes.filter((f) => !f.pale) };
            if (!el.fermes.length) continue;
          } else {
            el = { ...el, fermes };
            secret = fermes.every((f) => f.pale);
          }
        } else if (genre === "ponts" || genre === "gues" || genre === "batiments") {
          secret = secret || !horsBrume(el.x, el.y);
        }
        if (secret) {
          if (fond.joueurs) continue;
          pale = true;
        }
      }
      res.push({ genre, el, pale, boite, cle: JSON.stringify([genre, el, pale]) });
    }
  }
  return res;
}

const TYPE_CULTURE = { "blé": 0, seigle: 1, orge: 1, "pré": 2, "jachère": 3, labour: 4, avoine: 5, lin: 6 };

function cercle(x, y, r) {
  const pts = [];
  for (let k = 0; k < 12; k++) pts.push([x + Math.cos((k * Math.PI) / 6) * r, y + Math.sin((k * Math.PI) / 6) * r]);
  return pts;
}

// Prépare l'habillage vu : les zones de champs deviennent des groupes de parcelles, les vergers des arbres, les sentiers
// et les cours de ferme des voies (arbres et parcelles s'en écartent) ; le reste se dessine aux étapes du fond.
export function preparerHabillage(liste, hab, fond) {
  const km = fond.carte.km_case || 1;
  // Comme le serveur (carte_tv) : 420 m sans indication, entre 200 et 800 m.
  const metres = hab && nombre(hab.taille_parcelle_m) ? Math.max(200, Math.min(800, hab.taille_parcelle_m)) : 420;
  const taille = Math.max(1, metres / (km * 1000));
  const exclusions = [];
  const groupes = [];
  const arbres = [];
  const tampons = [];
  for (const x of liste) {
    const { genre, el, pale } = x;
    if (genre === "champs") {
      exclusions.push({ pts: el.zone, boite: x.boite });
      const types = (Array.isArray(el.cultures) && el.cultures.length ? el.cultures : ["blé"]).map((c) => (TYPE_CULTURE[c] !== undefined ? TYPE_CULTURE[c] : 0));
      groupes.push({
        cle: x.cle,
        portee: x.boite,
        parceller(f) {
          const [cx, cy] = centre(el.zone);
          const rayon = Math.max(...el.zone.map(([px, py]) => Math.hypot(px - cx, py - cy))) + taille;
          const ps = f.parceller({
            cx, cy, rayon, angle: rad(el.orientation), taille, graine: 300 + (hacherTexte(el.id ? String(el.id) : `${cx.toFixed(1)}:${cy.toFixed(1)}`) % 997) * 17,
            coins: (px, py) => dansPolygone(px, py, el.zone) && f.terreCultivable(px, py, true),
            accepte: (px, py) => dansPolygone(px, py, el.zone) && f.terreCultivable(px, py),
          });
          for (const p of ps) {
            p.type = types[Math.floor(p.culture * types.length) % types.length];
            p.haies = nombre(el.haies) ? el.haies : 0.3;
            if (pale) p.pale = true;
          }
          return ps;
        },
      });
    } else if (genre === "vergers") {
      exclusions.push({ pts: el.zone, boite: x.boite });
      // Des rangées d'arbres ronds, plus petits que ceux des bois.
      const [cx, cy] = centre(el.zone);
      const a = rad(el.orientation);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const pas = 0.6;
      const n = Math.ceil(Math.max(...el.zone.map(([px, py]) => Math.hypot(px - cx, py - cy))) / (pas * 0.9)) + 1;
      for (let j = -n; j <= n; j++) {
        for (let i = -n; i <= n; i++) {
          const u = i * pas + (j % 2 ? pas / 2 : 0);
          const w = j * pas * 0.9;
          const px = cx + u * ca - w * sa;
          const py = cy + u * sa + w * ca;
          if (!dansPolygone(px, py, el.zone)) continue;
          arbres.push({ t: "verger", x: px, y: py, r: 0.22 + 0.05 * hacher(i, j, 71), v: hacher(i, j, 72), pale });
        }
      }
    } else if (genre === "chemins") {
      const pts = el.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.25));
        for (let q = 0; q <= k; q++) tampons.push([ax + ((bx - ax) * q) / k, ay + ((by - ay) * q) / k, 0.3]);
      }
    } else if (genre === "hameaux") {
      for (const f of el.fermes || []) {
        if (!f || !nombre(f.x) || !nombre(f.y)) continue;
        tampons.push([f.x, f.y, 1.7]);
        exclusions.push({ pts: cercle(f.x, f.y, 2.0), boite: autour(f.x, f.y, 2.0) });
      }
    } else if (genre === "batiments") {
      tampons.push([el.x, el.y, 0.9]);
    }
  }
  const de = (genre) => liste.filter((x) => x.genre === genre);
  const vergers = de("vergers");
  const haies = de("haies");
  const chemins = de("chemins");
  const ponts = de("ponts");
  const gues = de("gues");
  const hameaux = de("hameaux");
  const batiments = de("batiments");
  // Chaque élément se dessine s'il touche la zone, plus pâle s'il est caché aux joueurs (vue du MJ).
  const poser = (ctx, zone, liste_, dessin) => {
    for (const x of liste_) {
      if (!croise(x.boite, zone)) continue;
      ctx.save();
      if (x.pale) ctx.globalAlpha = 0.5;
      dessin(x.el);
      ctx.restore();
    }
  };
  return {
    groupes,
    arbres,
    exclu(px, py) {
      for (const e of exclusions) if (px > e.boite.x0 && px < e.boite.x1 && py > e.boite.y0 && py < e.boite.y1 && dansPolygone(px, py, e.pts)) return true;
      return false;
    },
    tamponner(f) {
      for (const [px, py, r] of tampons) f(px, py, r);
    },
    // Sous l'ombrage du relief : herbe des vergers et haies.
    avantRelief(ctx, zone) {
      poser(ctx, zone, vergers, (el) => {
        ctx.beginPath();
        el.zone.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.closePath();
        ctx.fillStyle = "rgba(150,176,82,.85)";
        ctx.fill();
        ctx.strokeStyle = "rgba(110,84,50,.55)";
        ctx.lineWidth = 0.05;
        ctx.setLineDash([0.12, 0.08]);
        ctx.stroke();
      });
      poser(ctx, zone, haies, (el) => dessinerHaie(ctx, el.points));
    },
    apresRivieres(ctx, zone) {
      poser(ctx, zone, chemins, (el) => dessinerChemin(ctx, { type: "chemin", points: el.points }, fond.echelleVoies));
      poser(ctx, zone, ponts, (el) => dessinerPont(ctx, el));
    },
    apresRoutes(ctx, zone) {
      poser(ctx, zone, gues, (el) => dessinerGue(ctx, el));
      for (const x of hameaux) {
        if (!croise(x.boite, zone)) continue;
        for (const f of x.el.fermes || []) {
          if (!f || !nombre(f.x) || !nombre(f.y)) continue;
          ctx.save();
          if (f.pale || x.pale) ctx.globalAlpha = 0.5;
          dessinerFerme(ctx, f);
          ctx.restore();
        }
      }
      poser(ctx, zone, batiments, (el) => dessinerBatiment(ctx, el));
    },
  };
}

// Haie vive : une ligne de touffes rondes, avec son ombre au sud-est.
function dessinerHaie(ctx, points) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const chemin = new Path2D();
  points.forEach(([x, y], i) => (i ? chemin.lineTo(x, y) : chemin.moveTo(x, y)));
  ctx.setLineDash([0.001, 0.2]);
  ctx.strokeStyle = "rgba(20,40,20,.45)";
  ctx.lineWidth = 0.3;
  ctx.save();
  ctx.translate(0.05, 0.06);
  ctx.stroke(chemin);
  ctx.restore();
  ctx.strokeStyle = "#3f6a2c";
  ctx.lineWidth = 0.27;
  ctx.stroke(chemin);
  ctx.strokeStyle = "rgba(150,186,96,.55)";
  ctx.lineWidth = 0.11;
  ctx.save();
  ctx.translate(-0.03, -0.03);
  ctx.stroke(chemin);
  ctx.restore();
  ctx.setLineDash([]);
}

// Toit vu de dessus : deux pans, celui qui regarde le nord-ouest éclairé, et l'ombre portée au sud-est.
function toit(ctx, x, y, l, h, angle, clair, sombre) {
  ctx.save();
  ctx.translate(x + 0.09, y + 0.11);
  ctx.rotate(angle);
  ctx.fillStyle = "rgba(24,18,10,.38)";
  ctx.fillRect(-l / 2, -h / 2, l, h);
  ctx.restore();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const hautEclaire = Math.cos(angle) - Math.sin(angle) > 0;
  ctx.fillStyle = hautEclaire ? clair : sombre;
  ctx.fillRect(-l / 2, -h / 2, l, h / 2);
  ctx.fillStyle = hautEclaire ? sombre : clair;
  ctx.fillRect(-l / 2, 0, l, h / 2);
  ctx.strokeStyle = "rgba(40,26,14,.7)";
  ctx.lineWidth = 0.035;
  ctx.strokeRect(-l / 2, -h / 2, l, h);
  ctx.beginPath();
  ctx.moveTo(-l / 2, 0);
  ctx.lineTo(l / 2, 0);
  ctx.stroke();
  ctx.restore();
}

const TOITS = {
  logis: { l: 1.45, h: 0.72, clair: "#c3714c", sombre: "#8a4630" },
  grange: { l: 1.8, h: 0.86, clair: "#d6b675", sombre: "#977544" },
  etable: { l: 1.3, h: 0.62, clair: "#cdac6e", sombre: "#8a6e42" },
  chapelle: { l: 1.6, h: 0.8, clair: "#b9b2a6", sombre: "#7c766c" },
  cabane: { l: 0.9, h: 0.6, clair: "#9a7a50", sombre: "#5e4628" },
  forge: { l: 1.2, h: 0.7, clair: "#9c8a78", sombre: "#5e5246" },
};

// Une ferme : une cour de terre, le logis au fond, grange et étable en retour, un potager et une meule.
function dessinerFerme(ctx, f) {
  const a = rad(f.angle);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const pt = (u, v) => [f.x + u * ca - v * sa, f.y + u * sa + v * ca];
  ctx.beginPath();
  [[-1.25, -0.9], [1.3, -0.95], [1.35, 0.9], [-1.2, 1.0]].forEach(([u, v], i) => {
    const [x, y] = pt(u, v);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = "rgba(206,184,134,.9)";
  ctx.fill();
  // Potager : des planches rayées.
  const [gx, gy] = pt(-1.85, 0.2);
  ctx.save();
  ctx.translate(gx, gy);
  ctx.rotate(a);
  ctx.fillStyle = "#7c6a40";
  ctx.fillRect(-0.45, -0.6, 0.9, 1.2);
  ctx.strokeStyle = "#5f8a3a";
  ctx.lineWidth = 0.09;
  ctx.beginPath();
  for (let k = -4; k <= 4; k++) {
    ctx.moveTo(-0.4, k * 0.13);
    ctx.lineTo(0.4, k * 0.13);
  }
  ctx.stroke();
  ctx.restore();
  const places = [[0.05, -0.92, 0], [-0.92, 0.18, Math.PI / 2], [1.02, 0.26, Math.PI / 2]];
  (Array.isArray(f.batiments) && f.batiments.length ? f.batiments : ["logis"]).slice(0, 3).forEach((g, i) => {
    const t = TOITS[g] || TOITS.logis;
    const [u, v, r] = places[i];
    const [x, y] = pt(u, v);
    toit(ctx, x, y, t.l, t.h, a + r, t.clair, t.sombre);
  });
  // Meule de foin.
  const [mx, my] = pt(0.3, 0.62);
  ctx.beginPath();
  ctx.arc(mx + 0.07, my + 0.08, 0.25, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(24,18,10,.35)";
  ctx.fill();
  const g = ctx.createRadialGradient(mx - 0.08, my - 0.08, 0.02, mx, my, 0.25);
  g.addColorStop(0, "#f0d58c");
  g.addColorStop(1, "#b88f3e");
  ctx.beginPath();
  ctx.arc(mx, my, 0.24, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
}

// Pont de planches (ou de pierre) : un tablier posé sur le ruisseau, ses garde-corps et son ombre sur l'eau.
function dessinerPont(ctx, p) {
  const L = nombre(p.longueur) ? p.longueur : 1.4;
  const W = 0.46;
  const pierre = p.genre === "pierre";
  ctx.translate(p.x, p.y);
  ctx.rotate(rad(p.angle));
  ctx.fillStyle = "rgba(10,30,40,.4)";
  ctx.fillRect(-L / 2 + 0.06, -W / 2 + 0.1, L, W);
  ctx.fillStyle = pierre ? "#b8ad98" : "#a27a4c";
  ctx.fillRect(-L / 2, -W / 2, L, W);
  ctx.strokeStyle = pierre ? "rgba(80,72,60,.6)" : "rgba(60,38,18,.75)";
  ctx.lineWidth = 0.025;
  ctx.beginPath();
  for (let k = -L / 2 + 0.12; k < L / 2; k += pierre ? 0.24 : 0.12) {
    ctx.moveTo(k, -W / 2);
    ctx.lineTo(k, W / 2);
  }
  ctx.stroke();
  ctx.fillStyle = pierre ? "#8c826f" : "#6b4a2a";
  ctx.fillRect(-L / 2, -W / 2 - 0.04, L, 0.06);
  ctx.fillRect(-L / 2, W / 2 - 0.02, L, 0.06);
}

// Gué : un haut-fond clair et des pierres de passage en travers du ruisseau.
function dessinerGue(ctx, g) {
  ctx.translate(g.x, g.y);
  ctx.rotate(rad(g.angle));
  const gr = ctx.createRadialGradient(0, 0, 0.05, 0, 0, 1.0);
  gr.addColorStop(0, "rgba(214,218,184,.85)");
  gr.addColorStop(0.6, "rgba(190,206,176,.5)");
  gr.addColorStop(1, "rgba(190,206,176,0)");
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.ellipse(0, 0, 1.05, 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let k = -3; k <= 3; k++) {
    const u = k * 0.26;
    const v = (k % 2 ? 0.14 : -0.12) + (hacher(k, 2, 9) - 0.5) * 0.1;
    ctx.beginPath();
    ctx.ellipse(u + 0.03, v + 0.04, 0.12, 0.09, 0.4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(20,30,30,.45)";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(u, v, 0.12, 0.09, 0.4, 0, Math.PI * 2);
    ctx.fillStyle = "#c2bba9";
    ctx.fill();
    ctx.strokeStyle = "rgba(60,54,46,.6)";
    ctx.lineWidth = 0.02;
    ctx.stroke();
  }
}

// Bâtiment isolé : moulin (et sa roue), ruine ou ferme incendiée, sinon un toit simple.
function dessinerBatiment(ctx, b) {
  const genre = String(b.genre || "");
  if (genre === "moulin") return dessinerMoulin(ctx, b);
  if (/brul|ruine|incend/.test(genre)) return dessinerRuine(ctx, b);
  if (genre === "ponton") return dessinerPont(ctx, { ...b, longueur: 1.2 });
  const t = TOITS[genre] || TOITS.logis;
  toit(ctx, b.x, b.y, t.l, t.h, rad(b.angle), t.clair, t.sombre);
}

// Le moulin : le bâtiment au bord de l'eau et sa roue.
function dessinerMoulin(ctx, b) {
  const a = rad(b.angle);
  toit(ctx, b.x, b.y, 1.9, 1.0, a, "#c9a46a", "#8f6f40");
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  // La roue, côté ruisseau (à gauche du faîtage).
  ctx.translate(b.x - 0.2 * ca + 0.72 * sa, b.y - 0.2 * sa - 0.72 * ca);
  ctx.rotate(a);
  ctx.fillStyle = "rgba(10,30,40,.45)";
  ctx.fillRect(-0.56 + 0.06, -0.14 + 0.07, 1.12, 0.28);
  ctx.fillStyle = "#5a3e22";
  ctx.fillRect(-0.56, -0.14, 1.12, 0.28);
  ctx.strokeStyle = "#2e2012";
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  for (let k = -0.5; k <= 0.52; k += 0.125) {
    ctx.moveTo(k, -0.14);
    ctx.lineTo(k, 0.14);
  }
  ctx.stroke();
}

// Bâtiment incendié : toit noirci, à moitié effondré.
function dessinerRuine(ctx, b) {
  ctx.translate(b.x, b.y);
  ctx.rotate(rad(b.angle));
  ctx.fillStyle = "rgba(24,18,10,.4)";
  ctx.fillRect(-0.9 + 0.08, -0.45 + 0.1, 1.8, 0.9);
  ctx.fillStyle = "#3b322b";
  ctx.fillRect(-0.9, -0.45, 1.8, 0.9);
  ctx.fillStyle = "#8a6a44";
  ctx.fillRect(0.08, -0.45, 0.82, 0.45);
  ctx.fillStyle = "#1b1612";
  ctx.beginPath();
  ctx.moveTo(-0.75, -0.15);
  ctx.lineTo(-0.22, -0.36);
  ctx.lineTo(0.0, 0.3);
  ctx.lineTo(-0.52, 0.38);
  ctx.closePath();
  ctx.fill();
}
