// Vérifie le style peint des plans sans navigateur : chaque meuble et chaque objet d'habillage a son dessin, la liste
// KITS_HABILLAGE est exacte, et la vue des joueurs ne laisse rien passer de caché. On rejoue les générateurs sur des
// centaines de graines, avec un brouillard et un habillage tirés au hasard (objets, lumières, légende, une partie cachée) :
// ni objet ni lumière ni légende hors d'une case révélée, rien de « cache », ni sol ni mur sous le brouillard.
// Usage : node outils/verifier_peint.mjs [nombre de graines, 200 par défaut]
import { MODELES, generer } from "../app/static/js/plan/generateurs.js";
import { GENRES_PIECES, KITS_HABILLAGE, LUMIERES, MEUBLES, MOBILIER, SOLS, calculerMurs, reveleA } from "../app/static/js/plan/modele.js";
import { AMBIANCES, fondPeint, habillageVu, lumieresVisibles, vision } from "../app/static/js/plan/peint.js";
import { MEUBLES_PEINTS, OBJETS_PEINTS } from "../app/static/js/plan/peint-mobilier.js";
import { FOYERS_PLUS } from "../app/static/js/plan/peint-mobilier-plus.js";
import { meubleDessine } from "../app/static/js/plan/rendu.js";

const N = +(process.argv[2] || 200);
const defauts = [];
const defaut = (texte) => {
  if (defauts.length < 30) defauts.push(texte);
  else if (defauts.length === 30) defauts.push("…");
};

// ---- les dessins
for (const cle of Object.keys(MEUBLES)) if (!MEUBLES_PEINTS[cle]) defaut(`meuble sans dessin peint : ${cle}`);
// Chaque pièce a aussi son dessin couleur et parchemin, une taille d'au moins une case, une clé unique ; ce qui se pose à
// même le sol ou sert de passage se traverse.
const vues = new Set();
for (const g of MOBILIER) {
  if (!g.groupe || !g.liste.length) defaut(`famille vide ou sans nom : ${g.groupe}`);
  for (const m of g.liste) {
    if (vues.has(m.cle)) defaut(`meuble en double : ${m.cle}`);
    vues.add(m.cle);
    if (!meubleDessine(m.cle)) defaut(`meuble sans dessin couleur : ${m.cle}`);
    if (!m.nom || !(m.l >= 1 && m.h >= 1 && m.l <= 12 && m.h <= 12)) defaut(`meuble mal décrit : ${m.cle}`);
    if (m.passage && !m.franchissable) defaut(`passage qui barre la route : ${m.cle}`);
  }
}
for (const cle of Object.keys(FOYERS_PLUS)) if (!MEUBLES[cle]) defaut(`foyer d'un meuble inconnu : ${cle}`);
for (const s of SOLS) if (s.id && !/^#[0-9a-f]{6}$/.test(s.couleur || "")) defaut(`sol sans couleur : ${s.cle}`);
const genres = new Set(GENRES_PIECES.map(([g]) => g));
const kits = new Set();
for (const k of KITS_HABILLAGE) {
  if (kits.has(k.cle)) defaut(`clé d'habillage en double : ${k.cle}`);
  kits.add(k.cle);
  if (!OBJETS_PEINTS[k.cle] && k.cle !== "ornieres") defaut(`objet d'habillage sans dessin : ${k.cle}`);
  if (!k.nom || !Array.isArray(k.genres) || !k.genres.length || k.genres.some((g) => !genres.has(g))) defaut(`objet d'habillage mal décrit : ${k.cle}`);
}
for (const cle of Object.keys(OBJETS_PEINTS)) if (!kits.has(cle)) defaut(`objet dessinable absent de KITS_HABILLAGE : ${cle}`);
for (const h of Object.keys(AMBIANCES)) {
  const c = fondPeint({ habillage: { heure: h } });
  const v = (c.match(/\d+/g) || []).map(Number);
  if (v.length !== 3 || v.some((x) => x > 40)) defaut(`fond de la TV trop clair (${h}) : ${c}`);
}
for (const [l] of LUMIERES) {
  const c = fondPeint({ lumiere: l, habillage: { heure: "jour" } });
  const v = (c.match(/\d+/g) || []).map(Number);
  if (v.length !== 3 || v.some((x) => x > 40)) defaut(`fond de la TV trop clair (lumière ${l}) : ${c}`);
}

// ---- le brouillard
function hasard(graine) {
  let a = graine >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cles = KITS_HABILLAGE.map((k) => k.cle);
let plans = 0;
let elements = 0;
for (const { cle: modele } of MODELES) {
  if (modele === "vierge") continue;
  for (let graine = 1; graine <= N; graine++) {
    const p = generer(modele, graine);
    const r = hasard(graine * 7 + modele.length);
    const { largeur: w, hauteur: h } = p;
    // Une pièce sur deux révélée, quelques cases en plus au pinceau ; un meuble sur six caché.
    const vues = new Set(p.pieces.filter(() => r() < 0.5).map((x) => x.id));
    p.brouillard = p.piece.map((v, i) => (p.sol[i] && (vues.has(v) || r() < 0.03) ? 1 : 0));
    for (const x of p.pieces) x.nom_visible = r() < 0.5;
    for (const o of p.objets) if (r() < 0.16) o.cache = true;
    // Le mobilier ajouté le 09/11, posé au hasard sur le sol : un sur quatre caché, une teinte sur deux ; les foyers
    // (forge, torches, candélabres…) n'éclairent pas les joueurs depuis une case cachée ni quand ils sont cachés.
    const nouveaux = Object.keys(MEUBLES).filter((c) => MEUBLES_PEINTS[c] && !["piege", "tresor"].includes(c));
    const sols = [];
    for (let i = 0; i < w * h; i++) if (p.sol[i]) sols.push(i);
    for (let k = 0; k < 12 && sols.length; k++) {
      const i = sols[Math.floor(r() * sols.length)];
      const cle = nouveaux[Math.floor(r() * nouveaux.length)];
      p.objets.push({ id: `n${k}`, cle, x: i % w, y: Math.floor(i / w), l: MEUBLES[cle].l, h: MEUBLES[cle].h, rot: Math.floor(r() * 4) * 90, cache: r() < 0.25, ...(r() < 0.5 ? { teinte: "#2c3e66" } : {}) });
    }
    for (const x of p.pieces) if (r() < 0.3) Object.assign(x, { teinte: "#a8602c", mur: ["pierre", "bois", "torchis", "roche", "palissade"][Math.floor(r() * 5)] });
    if (r() < 0.5) p.lumiere = LUMIERES[Math.floor(r() * LUMIERES.length)][0];
    const hab = { heure: "soir", objets: [], lumieres: [], legende: [] };
    for (let k = 0; k < 40; k++) {
      const x = Math.floor(r() * w);
      const y = Math.floor(r() * h);
      hab.objets.push({ id: `o${k}`, piece: p.piece[y * w + x], cle: cles[Math.floor(r() * cles.length)], case: [x, y], decalage: [r(), r()], rot: 0, cache: r() < 0.2 });
    }
    for (let k = 0; k < 8; k++) hab.lumieres.push({ id: `l${k}`, x: r() * w, y: r() * h, rayon: 1 + r() * 6, couleur: "#ffb15e", intensite: r(), cache: r() < 0.2 });
    for (const x of p.pieces) hab.legende.push({ piece: x.id, texte: x.nom, x: r() * w, y: r() * h, cache: r() < 0.1 });
    p.habillage = hab;
    plans++;

    const vu = habillageVu(p, true);
    for (const o of vu.objets) {
      elements++;
      if (o.cache) defaut(`${modele} ${graine} : objet caché montré aux joueurs (${o.cle})`);
      if (!reveleA(p, o.cx + 0.5, o.cy + 0.5)) defaut(`${modele} ${graine} : objet dans une case cachée (${o.cle} ${o.cx},${o.cy})`);
    }
    for (const l of vu.lumieres) if (!reveleA(p, l.x, l.y)) defaut(`${modele} ${graine} : lumière dans une case cachée`);
    for (const l of lumieresVisibles(p, true)) {
      elements++;
      if (!reveleA(p, l.x, l.y)) defaut(`${modele} ${graine} : lumière (habillage ou foyer) dans une case cachée (${l.x.toFixed(1)},${l.y.toFixed(1)})`);
    }
    const noms = new Map(p.pieces.map((x) => [x.id, x]));
    for (const l of vu.legende) {
      elements++;
      if (!reveleA(p, l.x, l.y)) defaut(`${modele} ${graine} : légende dans une case cachée`);
      if (!noms.get(l.piece)?.nom_visible) defaut(`${modele} ${graine} : légende d'une pièce au nom caché`);
    }
    // Les foyers du mobilier (forge, torches, candélabres…) : un meuble caché n'éclaire rien chez les joueurs, les
    // lumières sont les mêmes que si on l'avait retiré du plan.
    const seuls = { ...p, habillage: null };
    const sansCaches = { ...seuls, objets: p.objets.filter((o) => !o.cache) };
    if (JSON.stringify(lumieresVisibles(seuls, true)) !== JSON.stringify(lumieresVisibles(sansCaches, true))) defaut(`${modele} ${graine} : un meuble caché éclaire les joueurs`);
    if (p.objets.some((o) => FOYERS_PLUS[o.cle] && !o.cache) && !lumieresVisibles(seuls, false).length) defaut(`${modele} ${graine} : un foyer montré n'éclaire pas le MJ`);
    // Le MJ voit tout ce qui se dessine.
    const mj = habillageVu(p, false);
    if (mj.objets.length !== hab.objets.length) defaut(`${modele} ${graine} : le MJ ne voit pas tous les objets`);
    if (mj.lumieres.length !== hab.lumieres.length) defaut(`${modele} ${graine} : le MJ ne voit pas toutes les lumières`);
    // Ni sol ni mur sous le brouillard.
    const v = vision(p, calculerMurs(p), true);
    for (let i = 0; i < w * h; i++) {
      if (p.brouillard[i] === 1) continue;
      if (v.sol[i] || v.murs[i] || v.vu[i]) {
        defaut(`${modele} ${graine} : sol ou mur d'une case cachée gardé pour les joueurs`);
        break;
      }
    }
  }
}

if (defauts.length) {
  console.log(`${defauts.length} défaut(s) :\n${defauts.join("\n")}`);
  process.exit(1);
}
console.log(`Style peint : ${Object.keys(MEUBLES).length} meubles et ${KITS_HABILLAGE.length} objets d'habillage dessinés ; ${plans} plans, ${elements} éléments vus des joueurs, rien de caché.`);
