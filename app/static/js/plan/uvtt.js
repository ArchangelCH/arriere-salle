// Importer un plan au format Universal VTT (.dd2vtt de Dungeondraft, .uvtt, .df2vtt, ou le même JSON) : une image, des
// murs en polylignes (line_of_sight, objects_line_of_sight), des portes (portals), des lumières, le tout en cases.
// Un plan d'ici ne garde pas de murs : ils se déduisent des pièces (modele.js, calculerMurs). La conversion ramène donc
// les murs du fichier au quadrillage, puis remplit des pièces entre eux :
//   - une arête entre deux cases voisines est barrée si le segment qui joint leurs centres coupe un mur ou une porte ;
//   - chaque zone fermée par des arêtes barrées devient une pièce « salle » avec un sol ; une zone ouverte sur le bord
//     du plan devient une pièce « extérieur » ; une case seule, murée de toutes parts et sans porte, reste vide ;
//   - une arête coupée par une porte entre deux pièces différentes reçoit une porte, ouverte ou fermée comme au fichier.
// Ce qui se perd : un mur en biais ou hors du quadrillage est ramené au bord de case voisin, un bout de mur qui ne ferme
// aucune pièce disparaît, les lumières ne sont pas reprises.
// Fonctions sans page (outils/verifier_uvtt.mjs les rejoue) : la lecture du fichier, l'image et l'envoi sont dans
// importer-uvtt.js.

export const COTE_MIN = 4;
export const COTE_MAX = 160;
// L'image envoyée : au plus 100 px par case et 4096 px de côté (le serveur refuse au-delà de 25 Mo et de 40 Mpx).
export const PX_PAR_CASE = 100;
export const COTE_IMAGE = 4096;
export const POIDS_IMAGE = 24 * 1024 * 1024;
// Au-delà, le navigateur ne tient pas le fichier en mémoire.
export const POIDS_FICHIER = 300 * 1024 * 1024;

export const AIDE_UVTT = "Un plan exporté de Dungeondraft, Dungeon Alchemist ou d'un autre outil au format Universal VTT (.dd2vtt, .uvtt, .df2vtt) : son image devient le fond, ses murs délimitent les pièces à révéler, ses portes sont posées.";
export const PERTES_UVTT = "Ce qui se perd : les murs en biais ou hors du quadrillage sont ramenés au bord de case le plus proche, et les lumières du fichier ne sont pas reprises.";

// Une erreur à dire telle quelle au MJ.
export class ErreurUvtt extends Error {}

const EPS = 1e-9;
const fini = (v) => typeof v === "number" && Number.isFinite(v);

// Un point du fichier : { x, y }, ou [x, y].
function point(v) {
  if (Array.isArray(v) && fini(v[0]) && fini(v[1])) return [v[0], v[1]];
  if (v && typeof v === "object" && fini(v.x) && fini(v.y)) return [v.x, v.y];
  return null;
}

// Les polylignes d'un champ : une liste de listes de points ; une liste de points seule compte pour une polyligne.
function polylignes(champ) {
  if (!Array.isArray(champ)) return [];
  const listes = champ.length && point(champ[0]) ? [champ] : champ;
  return listes.map((l) => (Array.isArray(l) ? l.map(point).filter(Boolean) : [])).filter((l) => l.length > 1);
}

// Le fichier lu (son texte, ou l'objet déjà déchiffré) : taille en cases, segments de murs, portes, image. Lève
// ErreurUvtt si ce n'est pas un plan UVTT, s'il n'a pas d'image ou s'il est trop grand.
export function lireUvtt(source) {
  let brut = source;
  if (typeof source === "string") {
    try {
      brut = JSON.parse(source);
    } catch {
      throw new ErreurUvtt("Fichier illisible : ce n'est pas un plan Universal VTT (.dd2vtt, .uvtt, .df2vtt).");
    }
  }
  const res = brut && typeof brut === "object" ? brut.resolution : null;
  const taille = res && point(res.map_size);
  if (!taille || !(taille[0] > 0 && taille[1] > 0)) {
    throw new ErreurUvtt("Ce fichier ne dit pas la taille du plan en cases : ce n'est pas un plan Universal VTT (.dd2vtt, .uvtt, .df2vtt).");
  }
  const image = typeof brut.image === "string" ? brut.image.replace(/^data:[^,]*,/, "").replace(/\s+/g, "") : "";
  if (image.length < 32) throw new ErreurUvtt("Ce plan n'a pas d'image : exportez-le de nouveau avec son image.");
  const origine = point(res.map_origin) || [0, 0];
  // L'image se cale sur le quadrillage : une origine à cheval sur une case la décale d'autant.
  const dx = origine[0] - Math.floor(origine[0]);
  const dy = origine[1] - Math.floor(origine[1]);
  const largeur = Math.max(COTE_MIN, Math.ceil(dx + taille[0] - 1e-6));
  const hauteur = Math.max(COTE_MIN, Math.ceil(dy + taille[1] - 1e-6));
  if (largeur > COTE_MAX || hauteur > COTE_MAX) {
    throw new ErreurUvtt(`Plan trop grand : ${Math.ceil(taille[0])} × ${Math.ceil(taille[1])} cases, pour ${COTE_MAX} de côté au plus dans l'atelier.`);
  }
  const lignes = [...polylignes(brut.line_of_sight), ...polylignes(brut.objects_line_of_sight)];
  const portails = (Array.isArray(brut.portals) ? brut.portals : []).map((q) => {
    const b = q && Array.isArray(q.bounds) ? q.bounds.map(point).filter(Boolean) : [];
    return b.length > 1 ? { a: b[0], b: b[b.length - 1], ferme: q.closed !== false } : null;
  }).filter(Boolean);
  // Les points sont comptés depuis le coin de l'image, ou depuis l'origine du monde de l'outil : selon les exports. On
  // garde la lecture qui met le plus de points dans l'image (la même quand l'origine est à zéro).
  const points = [...lignes.flat(), ...portails.flatMap((q) => [q.a, q.b])];
  const dedans = (ox, oy) => points.filter(([x, y]) => x - ox >= -0.01 && y - oy >= -0.01 && x - ox <= taille[0] + 0.01 && y - oy <= taille[1] + 0.01).length;
  const [ox, oy] = dedans(origine[0], origine[1]) >= dedans(0, 0) ? origine : [0, 0];
  const place = ([x, y]) => [x - ox + dx, y - oy + dy];
  const murs = [];
  for (const l of lignes) for (let i = 0; i + 1 < l.length; i++) murs.push([...place(l[i]), ...place(l[i + 1])]);
  return {
    format: brut.format, largeur, hauteur, cases: { l: taille[0], h: taille[1] }, px_par_case: fini(res.pixels_per_grid) && res.pixels_per_grid > 0 ? res.pixels_per_grid : 0,
    fond: { x: Math.round(dx * 100) / 100, y: Math.round(dy * 100) / 100, l: Math.round(taille[0] * 100) / 100, h: Math.round(taille[1] * 100) / 100 },
    murs, portails: portails.map((q) => ({ segment: [...place(q.a), ...place(q.b)], ferme: q.ferme })),
    lumieres: Array.isArray(brut.lights) ? brut.lights.length : 0, image,
  };
}

// Le segment de centre à centre A → B coupe-t-il le segment C → D ? Le centre de départ compte, pas celui d'arrivée :
// un mur tracé au milieu des cases barre une seule arête, celle d'après, au lieu de deux ou d'aucune. bout : le dernier
// point de C → D compte (un mur, dont les tronçons se suivent) ; sans lui, une porte large d'une case tracée au milieu
// des cases ne donne qu'une porte.
function coupe(ax, ay, bx, by, cx, cy, ddx, ddy, bout = true) {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = ddx - cx;
  const sy = ddy - cy;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < EPS) return false;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / denom;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / denom;
  return t >= -EPS && t < 1 - EPS && u >= -EPS && (bout ? u <= 1 + EPS : u < 1 - EPS);
}

// Les arêtes que barre un segment : V[y * (w + 1) + x] à gauche de la case (x, y), H[y * w + x] au-dessus (les sens
// « v » et « h » des portes, modele.js). Les arêtes du bord du plan comptent : un mur d'enceinte ferme sa pièce.
// surArete(sens, x, y) est appelée pour chacune.
function barrer([x0, y0, x1, y1], w, h, surArete, bout = true) {
  const cxMin = Math.max(-1, Math.floor(Math.min(x0, x1)) - 1);
  const cxMax = Math.min(w, Math.floor(Math.max(x0, x1)) + 1);
  const cyMin = Math.max(-1, Math.floor(Math.min(y0, y1)) - 1);
  const cyMax = Math.min(h, Math.floor(Math.max(y0, y1)) + 1);
  for (let cy = cyMin; cy <= cyMax; cy++) {
    for (let cx = cxMin; cx <= cxMax; cx++) {
      // Vers la case de droite : l'arête « v » de la case (cx + 1, cy).
      if (cy >= 0 && cy < h && cx + 1 <= w && coupe(cx + 0.5, cy + 0.5, cx + 1.5, cy + 0.5, x0, y0, x1, y1, bout)) surArete("v", cx + 1, cy);
      // Vers la case du dessous : l'arête « h » de la case (cx, cy + 1).
      if (cx >= 0 && cx < w && cy + 1 <= h && coupe(cx + 0.5, cy + 0.5, cx + 0.5, cy + 1.5, x0, y0, x1, y1, bout)) surArete("h", cx, cy + 1);
    }
  }
}

// Un mur qui suit le quadrillage : vertical sur une abscisse entière, ou horizontal sur une ordonnée entière.
const surQuadrillage = ([x0, y0, x1, y1]) => {
  const entier = (v) => Math.abs(v - Math.round(v)) < 0.02;
  return (Math.abs(x0 - x1) < 0.02 && entier(x0)) || (Math.abs(y0 - y1) < 0.02 && entier(y0));
};

// Les arêtes barrées d'un plan lu (lireUvtt) : { V, H, portes } ; portes : clé d'arête → fermée ?
export function aretesBarrees(u) {
  const { largeur: w, hauteur: h } = u;
  const V = new Uint8Array((w + 1) * h);
  const H = new Uint8Array(w * (h + 1));
  const poser = (sens, x, y) => {
    if (sens === "v") V[y * (w + 1) + x] = 1;
    else H[y * w + x] = 1;
  };
  for (const m of u.murs) barrer(m, w, h, poser);
  const portes = new Map();
  for (const q of u.portails) {
    barrer(q.segment, w, h, (sens, x, y) => {
      poser(sens, x, y);
      const cle = `${sens}:${x}:${y}`;
      // Deux portes sur la même arête : fermée si l'une l'est.
      portes.set(cle, portes.get(cle) || q.ferme);
    }, false);
  }
  return { V, H, portes };
}

// Le plan tiré d'un fichier lu (lireUvtt) : { largeur, hauteur, sol, piece, pieces, portes, bilan }. id : de quoi donner
// un identifiant à chaque porte (modele.js, nouvelId). Sols : dalles pour une salle, terre battue dehors (l'image de fond
// les couvre tant que « Dessiner les sols et les murs par-dessus » n'est pas coché).
export function convertir(u, id = () => Math.random().toString(36).slice(2, 9)) {
  const { largeur: w, hauteur: h } = u;
  const n = w * h;
  const { V, H, portes: aretesPortes } = aretesBarrees(u);
  const barreeV = (x, y) => V[y * (w + 1) + x] === 1;
  const barreeH = (x, y) => H[y * w + x] === 1;
  // Les zones : un remplissage de proche en proche par les arêtes libres.
  const zone = new Int32Array(n).fill(-1);
  const zones = [];
  for (let depart = 0; depart < n; depart++) {
    if (zone[depart] !== -1) continue;
    const z = { cases: [], ouverte: false };
    const k = zones.length;
    zones.push(z);
    zone[depart] = k;
    const pile = [depart];
    while (pile.length) {
      const i = pile.pop();
      z.cases.push(i);
      const x = i % w;
      const y = (i - x) / w;
      // gauche, droite, haut, bas : l'arête à franchir, puis la case d'à côté (hors du plan : la zone donne sur le bord).
      const pas = [[barreeV(x, y), x - 1, y], [barreeV(x + 1, y), x + 1, y], [barreeH(x, y), x, y - 1], [barreeH(x, y + 1), x, y + 1]];
      for (const [barree, nx, ny] of pas) {
        if (barree) continue;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
          z.ouverte = true;
          continue;
        }
        const j = ny * w + nx;
        if (zone[j] === -1) {
          zone[j] = k;
          pile.push(j);
        }
      }
    }
  }
  // Les zones qui se touchent par une arête barrée, et celles qui ont une porte.
  const voisines = zones.map(() => new Set());
  const avecPorte = new Set();
  let perdus = 0;
  const entre = (sens, x, y) => {
    const [ax, ay, bx, by] = sens === "v" ? [x - 1, y, x, y] : [x, y - 1, x, y];
    const a = ax >= 0 && ay >= 0 && ax < w && ay < h ? zone[ay * w + ax] : -1;
    const b = bx >= 0 && by >= 0 && bx < w && by < h ? zone[by * w + bx] : -1;
    return [a, b];
  };
  const chaqueArete = (f) => {
    for (let y = 0; y < h; y++) for (let x = 0; x <= w; x++) if (barreeV(x, y)) f("v", x, y);
    for (let y = 0; y <= h; y++) for (let x = 0; x < w; x++) if (barreeH(x, y)) f("h", x, y);
  };
  chaqueArete((sens, x, y) => {
    const [a, b] = entre(sens, x, y);
    if (a === -1 || b === -1) return;
    if (a === b) {
      perdus += 1;
      return;
    }
    voisines[a].add(b);
    voisines[b].add(a);
    if (aretesPortes.has(`${sens}:${x}:${y}`)) {
      avecPorte.add(a);
      avecPorte.add(b);
    }
  });
  // Le genre de chaque zone. Deux pièces extérieures voisines n'auraient pas de mur entre elles (modele.js) : de deux
  // zones ouvertes qui se touchent par un mur, seule la plus grande reste dehors, l'autre devient une salle.
  const ordre = zones.map((z, k) => k).filter((k) => zones[k].ouverte).sort((a, b) => zones[b].cases.length - zones[a].cases.length || a - b);
  const dehors = new Set();
  for (const k of ordre) if (![...voisines[k]].some((v) => dehors.has(v))) dehors.add(k);
  const sol = new Array(n).fill(0);
  const piece = new Array(n).fill(0);
  const pieces = [];
  const idPiece = new Map();
  let salles = 0;
  let exterieurs = 0;
  let enfermees = 0;
  zones.forEach((z, k) => {
    if (!z.ouverte && z.cases.length === 1 && !avecPorte.has(k)) {
      enfermees += 1;
      return;
    }
    const pid = pieces.length + 1;
    idPiece.set(k, pid);
    if (dehors.has(k)) {
      exterieurs += 1;
      pieces.push({ id: pid, nom: exterieurs > 1 ? `Extérieur ${exterieurs}` : "Extérieur", genre: "exterieur", notes: "", nom_visible: false });
    } else {
      salles += 1;
      pieces.push({ id: pid, nom: `Salle ${salles}`, genre: "salle", notes: "", nom_visible: false });
    }
    const s = dehors.has(k) ? 3 : 1;
    for (const i of z.cases) {
      sol[i] = s;
      piece[i] = pid;
    }
  });
  // Les portes : une par arête coupée par une porte du fichier, entre deux pièces différentes.
  const portes = [];
  let portesPerdues = 0;
  for (const [cle, ferme] of aretesPortes) {
    const [sens, xs, ys] = cle.split(":");
    const x = +xs;
    const y = +ys;
    const [a, b] = entre(sens, x, y);
    const pa = a === -1 ? 0 : idPiece.get(a) || 0;
    const pb = b === -1 ? 0 : idPiece.get(b) || 0;
    if (!pa || !pb || pa === pb) {
      portesPerdues += 1;
      continue;
    }
    portes.push({ id: id(), sens, x, y, genre: "porte", etat: ferme ? "fermee" : "ouverte" });
  }
  portes.sort((p, q) => p.y - q.y || p.x - q.x || p.sens.localeCompare(q.sens));
  return {
    largeur: w, hauteur: h, sol, piece, pieces, portes,
    bilan: {
      salles, exterieurs, portes: portes.length, portes_perdues: portesPerdues, murs: u.murs.length,
      biais: u.murs.filter((m) => !surQuadrillage(m)).length, perdus, enfermees, lumieres: u.lumieres,
    },
  };
}

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

// Ce que l'import a donné et ce qui s'est perdu, en phrases pour le MJ.
export function phrasesBilan(b) {
  const fait = [b.salles ? pluriel(b.salles, "salle", "salles") : "", b.exterieurs ? pluriel(b.exterieurs, "zone extérieure", "zones extérieures") : "", b.portes ? pluriel(b.portes, "porte posée", "portes posées") : ""].filter(Boolean);
  const phrases = [`Plan importé : ${fait.join(", ")}. Chaque pièce se révèle d'un clic (outil Révéler) ; renommez-les à votre guise.`];
  const pertes = [];
  if (b.biais) pertes.push(`${pluriel(b.biais, "mur en biais ou hors du quadrillage a été ramené", "murs en biais ou hors du quadrillage ont été ramenés")} au bord de case le plus proche`);
  if (b.perdus) pertes.push(`${pluriel(b.perdus, "bout de mur qui ne ferme aucune pièce n'est pas repris", "bouts de mur qui ne ferment aucune pièce ne sont pas repris")}`);
  if (b.portes_perdues) pertes.push(`${pluriel(b.portes_perdues, "porte isolée (hors d'un mur entre deux pièces) n'est pas reprise", "portes isolées (hors d'un mur entre deux pièces) ne sont pas reprises")}`);
  if (b.lumieres) pertes.push(`${pluriel(b.lumieres, "lumière du fichier n'est pas reprise", "lumières du fichier ne sont pas reprises")}`);
  if (pertes.length) phrases.push(`Ce qui se perd : ${pertes.join(" ; ")}.`);
  if (!b.salles) phrases.push("Aucun mur du fichier ne ferme de pièce : tout le plan est une seule zone. Tracez des pièces sur l'image pour les révéler une à une.");
  phrases.push("Le quadrillage de l'atelier est éteint, l'image ayant souvent le sien : la case « Quadrillage sur la TV » le remet.");
  return phrases;
}

// ---------------------------------------------------------------- l'image

// Le type d'une image d'après ses premiers octets ; null si ce n'est ni un PNG, ni un JPEG, ni un WebP.
export function typeImage(o) {
  if (o.length > 8 && o[0] === 0x89 && o[1] === 0x50 && o[2] === 0x4e && o[3] === 0x47) return "image/png";
  if (o.length > 3 && o[0] === 0xff && o[1] === 0xd8) return "image/jpeg";
  if (o.length > 12 && o[0] === 0x52 && o[1] === 0x49 && o[2] === 0x46 && o[3] === 0x46 && o[8] === 0x57 && o[9] === 0x45 && o[10] === 0x42 && o[11] === 0x50) return "image/webp";
  return null;
}

// Les octets d'un texte en base64, par morceaux (une image de plusieurs dizaines de Mo ne se décode pas d'un bloc).
export function octetsDeBase64(texte) {
  const propre = texte.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const taille = Math.floor((propre.length * 3) / 4);
  const octets = new Uint8Array(taille);
  const PAS = 4 * 16384;
  let o = 0;
  try {
    for (let i = 0; i < propre.length; i += PAS) {
      const bin = atob(propre.slice(i, i + PAS));
      for (let k = 0; k < bin.length; k++) octets[o++] = bin.charCodeAt(k);
    }
  } catch {
    throw new ErreurUvtt("L'image de ce plan est illisible (PNG, JPEG ou WebP attendu).");
  }
  return o === taille ? octets : octets.subarray(0, o);
}

// La taille à laquelle envoyer une image de l × h pixels qui couvre « cases » cases de large : null si elle part telle
// quelle.
export function tailleReduite(l, h, cases) {
  const parCase = cases > 0 ? l / cases : 0;
  const echelle = Math.min(1, parCase > PX_PAR_CASE ? PX_PAR_CASE / parCase : 1, COTE_IMAGE / Math.max(l, h));
  if (echelle >= 1) return null;
  return { l: Math.max(1, Math.round(l * echelle)), h: Math.max(1, Math.round(h * echelle)) };
}
