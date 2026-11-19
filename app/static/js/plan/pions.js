// Les pions enrichis : tailles, formes et cadres, états posés d'un clic, groupes, montures, étiquettes et image
// choisie par le MJ. Tout champ absent garde le pion d'avant : rond, anneau normal, sans état ni étiquette. Ce module ne
// fait que dessiner (rendu.js l'appelle, sur la TV comme dans l'atelier et le coin) ; le serveur dit ce que les joueurs
// en voient (app/table/pions_plan.py, mêmes listes).

import { ecrire, rond } from "./trace.js";

// Les tailles en cases : un petit pion tient dans sa case, un grand en couvre 2 × 2, un énorme 3 × 3, un gigantesque 4 × 4.
export const TAILLES_PION = [[0.6, "Petit"], [1, "Moyen"], [2, "Grand (2 × 2)"], [3, "Énorme (3 × 3)"], [4, "Gigantesque (4 × 4)"]];
export const FORMES_PION = [["rond", "Rond"], ["carre", "Carré"], ["blason", "Blason"]];
export const EPAISSEURS_PION = [[0.5, "Fin"], [1, "Normal"], [1.8, "Épais"]];
export const GROUPE_MAX = 99;
export const ETIQUETTE_MAX = 24;

// Les états, dans l'ordre où ils se montrent autour du pion. « À terre » reste le champ « tombe » d'avant (le disque
// grisé et barré). « Invisible » : pour le MJ seul, le pion disparaît de la TV comme un pion caché.
export const ETATS_PION = [
  { cle: "empoisonne", nom: "Empoisonné", couleur: "#3f7f35" },
  { cle: "en-feu", nom: "En feu", couleur: "#c8461b" },
  { cle: "etourdi", nom: "Étourdi", couleur: "#b8860b" },
  { cle: "entrave", nom: "Entravé", couleur: "#6b5a48" },
  { cle: "effraye", nom: "Effrayé", couleur: "#6a3f9c" },
  { cle: "concentre", nom: "Concentré", couleur: "#23629e" },
  { cle: "beni", nom: "Béni", couleur: "#b98a1e" },
  { cle: "maudit", nom: "Maudit", couleur: "#4a1430" },
  { cle: "invisible", nom: "Invisible", couleur: "#5d7187", mj: true },
];
const PAR_CLE = Object.fromEntries(ETATS_PION.map((x) => [x.cle, x]));
export const nomEtat = (cle) => PAR_CLE[cle]?.nom || cle;

// Les états d'un pion, connus et sans doublon, dans l'ordre de la liste ; joueurs : sans ceux du MJ seul.
export function etatsDuPion(t, joueurs = false) {
  const v = Array.isArray(t.etats) ? t.etats : [];
  return ETATS_PION.filter((x) => v.includes(x.cle) && !(joueurs && x.mj)).map((x) => x.cle);
}
export const invisible = (t) => Array.isArray(t.etats) && t.etats.includes("invisible");

// L'image que montre le pion : celle que le MJ lui a choisie (bibliothèque ou import), sinon le portrait de sa fiche.
// Sur la TV, l'adresse publique arrive dans « image », et « image_libre » vaut vrai.
export const imageDuPion = (t) => (typeof t.image_libre === "string" && t.image_libre ? t.image_libre : t.image);

// ---------------------------------------------------------------- formes
export const formeDuPion = (t) => (t.forme === "carre" || t.forme === "blason" ? t.forme : "rond");
export const epaisseurDuPion = (t) => (t.epaisseur === 0.5 || t.epaisseur === 1.8 ? t.epaisseur : 1);

// ---------------------------------------------------------------- les pastilles des états

// Le signe d'un état, dessiné (pas de police ni d'emoji), clair sur la couleur de sa pastille de rayon b.
function signe(ctx, cle, b) {
  const clair = "#fbf3e2";
  ctx.fillStyle = clair;
  ctx.strokeStyle = clair;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (cle === "empoisonne") {
    // Une goutte.
    ctx.moveTo(0, -b * 0.66);
    ctx.bezierCurveTo(b * 0.18, -b * 0.36, b * 0.42, -b * 0.08, b * 0.42, b * 0.16);
    ctx.arc(0, b * 0.16, b * 0.42, 0, Math.PI);
    ctx.bezierCurveTo(-b * 0.42, -b * 0.08, -b * 0.18, -b * 0.36, 0, -b * 0.66);
    ctx.fill();
  } else if (cle === "en-feu") {
    // Une flamme qui lèche vers la droite.
    ctx.moveTo(b * 0.04, -b * 0.7);
    ctx.bezierCurveTo(b * 0.6, -b * 0.22, b * 0.56, b * 0.32, 0, b * 0.6);
    ctx.bezierCurveTo(-b * 0.56, b * 0.32, -b * 0.46, -b * 0.12, -b * 0.16, -b * 0.34);
    ctx.bezierCurveTo(-b * 0.14, -b * 0.08, -b * 0.04, b * 0.02, b * 0.06, b * 0.04);
    ctx.bezierCurveTo(b * 0.14, -b * 0.22, b * 0.12, -b * 0.48, b * 0.04, -b * 0.7);
    ctx.fill();
  } else if (cle === "etourdi") {
    // Une spirale.
    ctx.lineWidth = b * 0.16;
    for (let a = 0; a <= Math.PI * 4.2; a += 0.2) {
      const rr = b * (0.06 + (0.5 * a) / (Math.PI * 4.2));
      if (a === 0) ctx.moveTo(rr, 0);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.stroke();
  } else if (cle === "entrave") {
    // Deux maillons d'une chaîne.
    ctx.lineWidth = b * 0.16;
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * b * 0.2, -s * b * 0.2);
      ctx.rotate(-Math.PI / 4);
      ctx.beginPath();
      const lw = b * 0.36;
      const lh = b * 0.2;
      ctx.moveTo(-lw + lh, -lh);
      ctx.lineTo(lw - lh, -lh);
      ctx.arc(lw - lh, 0, lh, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(-lw + lh, lh);
      ctx.arc(-lw + lh, 0, lh, Math.PI / 2, Math.PI * 1.5);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  } else if (cle === "effraye") {
    // Un point d'exclamation.
    ctx.moveTo(-b * 0.11, -b * 0.58);
    ctx.lineTo(b * 0.11, -b * 0.58);
    ctx.lineTo(b * 0.07, b * 0.16);
    ctx.lineTo(-b * 0.07, b * 0.16);
    ctx.closePath();
    ctx.fill();
    rond(ctx, 0, b * 0.42, b * 0.12);
    ctx.fill();
  } else if (cle === "concentre") {
    // Une cible.
    ctx.lineWidth = b * 0.13;
    rond(ctx, 0, 0, b * 0.5);
    ctx.stroke();
    rond(ctx, 0, 0, b * 0.26);
    ctx.stroke();
    rond(ctx, 0, 0, b * 0.08);
    ctx.fill();
  } else if (cle === "beni") {
    // Un soleil rayonnant.
    rond(ctx, 0, 0, b * 0.22);
    ctx.fill();
    ctx.lineWidth = b * 0.12;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      ctx.moveTo(Math.cos(a) * b * 0.34, Math.sin(a) * b * 0.34);
      ctx.lineTo(Math.cos(a) * b * 0.62, Math.sin(a) * b * 0.62);
    }
    ctx.stroke();
  } else if (cle === "maudit") {
    // Une tête à cornes.
    rond(ctx, 0, b * 0.14, b * 0.28);
    ctx.fill();
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * b * 0.12, -b * 0.06);
      ctx.quadraticCurveTo(s * b * 0.5, -b * 0.18, s * b * 0.46, -b * 0.64);
      ctx.quadraticCurveTo(s * b * 0.3, -b * 0.3, s * b * 0.26, -b * 0.14);
      ctx.closePath();
      ctx.fill();
    }
  } else if (cle === "invisible") {
    // Un œil barré.
    ctx.lineWidth = b * 0.12;
    ctx.moveTo(-b * 0.56, 0);
    ctx.quadraticCurveTo(0, -b * 0.56, b * 0.56, 0);
    ctx.quadraticCurveTo(0, b * 0.56, -b * 0.56, 0);
    ctx.closePath();
    ctx.stroke();
    rond(ctx, 0, 0, b * 0.15);
    ctx.fill();
    ctx.beginPath();
    ctx.lineWidth = b * 0.14;
    ctx.moveTo(-b * 0.48, b * 0.48);
    ctx.lineTo(b * 0.48, -b * 0.48);
    ctx.stroke();
  }
}

// Une pastille : l'ombre, le disque de couleur, son liseré clair (il la détache d'un portrait ou d'un sol sombre), le signe.
export function pastilleEtat(ctx, cle, x, y, b) {
  const e = PAR_CLE[cle];
  ctx.save();
  rond(ctx, x + b * 0.08, y + b * 0.12, b);
  ctx.fillStyle = "rgba(0,0,0,.45)";
  ctx.fill();
  rond(ctx, x, y, b);
  ctx.fillStyle = e ? e.couleur : "#2a1d10";
  ctx.fill();
  ctx.strokeStyle = "#f4ead4";
  ctx.lineWidth = b * 0.16;
  ctx.stroke();
  ctx.translate(x, y);
  if (e) signe(ctx, cle, b);
  ctx.restore();
}

// La taille d'une pastille : celle du jeton d'avantage (plan/rendu.js), lisible du canapé sur la TV (26 pixels d'un écran
// 1080p), jamais plus grande que le pion ne le permet (la moitié de son rayon sur la TV).
export const rayonPastille = (r, lisible) => Math.min(Math.max(0.15, (lisible?.jeton || 0) / 2), r * (lisible ? 0.5 : 0.42));

// Les états d'un pion en pastilles sur le bord gauche de son disque, de haut en bas (le jeton d'avantage, les cartons et
// la posture gardent leurs places) : trois au plus, la troisième dit « +n » quand il y en a davantage.
export function dessinerEtats(ctx, t, r, liste, lisible) {
  if (!liste.length) return;
  const b = rayonPastille(r, lisible);
  const orbite = r + b * 0.15;
  const pas = 2 * Math.asin(Math.min(0.95, (b * 1.12) / orbite));
  const montres = liste.length > 3 ? liste.slice(0, 2) : liste;
  const n = liste.length > 3 ? 3 : liste.length;
  for (let k = 0; k < n; k++) {
    const a = Math.PI + (k - (n - 1) / 2) * pas * -1;
    const x = t.x + Math.cos(a) * orbite;
    const y = t.y + Math.sin(a) * orbite;
    if (k < montres.length) pastilleEtat(ctx, montres[k], x, y, b);
    else {
      rond(ctx, x + b * 0.08, y + b * 0.12, b);
      ctx.fillStyle = "rgba(0,0,0,.45)";
      ctx.fill();
      rond(ctx, x, y, b);
      ctx.fillStyle = "#2a1d10";
      ctx.fill();
      ctx.strokeStyle = "#f4ead4";
      ctx.lineWidth = b * 0.16;
      ctx.stroke();
      ecrire(ctx, `+${liste.length - 2}`, x, y + b * 0.06, { taille: b * 1.05, police: "700 {t}px Cinzel", couleur: "#fbf3e2", halo: null, largeurMax: b * 1.6 });
    }
  }
}

// La pastille d'une seule couleur pour les listes de l'éditeur : une image de 40 pixels.
const vignettes = new Map();
export function vignetteEtat(cle, taille = 40) {
  if (vignettes.has(cle)) return vignettes.get(cle);
  const c = document.createElement("canvas");
  c.width = c.height = taille;
  const ctx = c.getContext("2d");
  pastilleEtat(ctx, cle, taille / 2 - 1, taille / 2 - 1, taille / 2 - 4);
  const url = c.toDataURL();
  vignettes.set(cle, url);
  return url;
}

// ---------------------------------------------------------------- groupe et étiquette

// Le nombre d'un groupe (« un groupe de 5 gobelins » en un seul pion) : « ×5 » en bas à droite du pion.
// plaque : la boîte de la plaque du numéro (figurine.js, boitePlaque) ; le nombre se pose alors à sa droite, sans la
// couvrir, au lieu du bas du socle.
export function dessinerGroupe(ctx, t, r, n, lisible, plaque = null) {
  if (!(n >= 2)) return;
  const b = Math.min(Math.max(0.17, (lisible?.numero || 0) * 0.62, r * 0.36), r * 0.55);
  const l = b * (String(n).length > 1 ? 1.75 : 1.4);
  const x = plaque ? plaque.x1 + l + b * 0.15 : t.x + r * 0.74;
  const y = plaque ? (plaque.y0 + plaque.y1) / 2 : t.y + r * 0.72;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x - l + b, y - b);
  ctx.lineTo(x + l - b, y - b);
  ctx.arc(x + l - b, y, b, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x - l + b, y + b);
  ctx.arc(x - l + b, y, b, Math.PI / 2, Math.PI * 1.5);
  ctx.closePath();
  ctx.fillStyle = "#2a1d10";
  ctx.fill();
  ctx.strokeStyle = "#e0b562";
  ctx.lineWidth = b * 0.16;
  ctx.stroke();
  ctx.restore();
  ecrire(ctx, `×${n}`, x, y + b * 0.06, { taille: b * 1.3, police: "700 {t}px Cinzel", couleur: "#fbf3e2", halo: null, largeurMax: l * 1.75 });
}

// L'étiquette d'un pion (« chef », « archer »…) : un petit cartouche sous le pion, sous son nom s'il en a un.
export function dessinerEtiquette(ctx, t, y, chaine, taille) {
  if (!chaine) return;
  ctx.save();
  ctx.font = "italic 600 32px 'EB Garamond'";
  const l = (ctx.measureText(chaine).width * taille) / 32 + taille * 0.7;
  ctx.restore();
  const h = taille * 1.25;
  ctx.save();
  ctx.beginPath();
  const x0 = t.x - l / 2;
  const k = h * 0.35;
  ctx.moveTo(x0 + k, y - h / 2);
  ctx.arcTo(x0 + l, y - h / 2, x0 + l, y + h / 2, k);
  ctx.arcTo(x0 + l, y + h / 2, x0, y + h / 2, k);
  ctx.arcTo(x0, y + h / 2, x0, y - h / 2, k);
  ctx.arcTo(x0, y - h / 2, x0 + l, y - h / 2, k);
  ctx.closePath();
  ctx.fillStyle = "rgba(20,14,10,.78)";
  ctx.fill();
  ctx.strokeStyle = "rgba(214,180,118,.6)";
  ctx.lineWidth = h * 0.06;
  ctx.stroke();
  ctx.restore();
  ecrire(ctx, chaine, t.x, y + taille * 0.02, { taille, police: "italic 600 {t}px 'EB Garamond'", couleur: "#f4ead4", halo: null });
}

// ---------------------------------------------------------------- montures

// Les pions tels qu'ils se dessinent : un cavalier (champ « monture », l'id d'un autre pion) se pose sur sa monture, plus
// petit, vers le haut à gauche, et se dessine après elle. Sans cavalier, la liste revient telle quelle (rien ne change
// pour un plan d'avant).
export function poserCavaliers(pions) {
  if (!pions || !pions.some((t) => typeof t.monture === "string")) return pions;
  const par = new Map(pions.map((t) => [t.id, t]));
  const autres = [];
  const cavaliers = [];
  for (const t of pions) {
    const m = typeof t.monture === "string" && t.monture !== t.id ? par.get(t.monture) : null;
    if (m && typeof m.monture !== "string") cavaliers.push([t, m]);
    else autres.push(t);
  }
  if (!cavaliers.length) return pions;
  return autres.concat(cavaliers.map(([t, m]) => {
    const tm = m.taille || 1;
    const taille = Math.min(t.taille || 1, Math.max(0.6, tm * 0.66));
    const decal = 0.42 * (tm - taille) * 0.62;
    return Object.assign({}, t, { x: m.x - decal, y: m.y - decal, taille, enSelle: true });
  }));
}

// Les pions qui vont avec celui-ci quand on le déplace : sa monture et ses autres cavaliers s'il est en selle, ses
// cavaliers s'il porte quelqu'un.
export function compagnonsDeSelle(pions, t) {
  const m = typeof t.monture === "string" ? pions.find((x) => x.id === t.monture && x !== t) : null;
  const base = m || t;
  return pions.filter((x) => x !== t && (x === base || (x.monture === base.id && x !== base)));
}

// ---------------------------------------------------------------- numéros

// Le premier numéro libre parmi les pions de même sorte (même fiche du bestiaire, ou même nom pour un pion libre).
export const memeSorte = (a, b) => (a.ref ? a.ref === b.ref : !b.ref && (a.nom || "").trim().toLowerCase() === (b.nom || "").trim().toLowerCase());
export function numeroLibre(pions, modele, pris = []) {
  const deja = new Set(pions.filter((t) => memeSorte(modele, t)).map((t) => +t.court).filter((n) => Number.isInteger(n)).concat(pris));
  let n = 1;
  while (deja.has(n)) n++;
  return n;
}
