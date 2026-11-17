// « Chacun son moment » dans le tableau du MJ : depuis quand chaque héros n'a rien fait de marquant, d'après les lignes
// du journal de la séance qui citent son prénom ou son nom, et ses tours dans le combat en cours. Fonctions pures :
// tableau/projecteur.js les affiche, outils/verifier_aides_tableau.mjs les vérifie.

import { REPOS } from "../aventuriers/etat.js";
import { plat } from "../combats/rencontre.js";

// Une ligne plus vieille vient d'une autre séance (le journal ne garde que l'heure).
export const FENETRE = 12 * 3600000;
// En dessous, personne n'est mis en avant : la séance vient de commencer, ou tout le monde a eu son tour.
export const SEUIL_OUBLI = 20;
const TITRES = new Set(["frere", "sœur", "soeur", "maitre", "pere", "mere", "dame", "sire", "messire"]);
const REPOS_NOMS = Object.values(REPOS).map((r) => plat(r.nom));
const echapper = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Les mots par lesquels le journal désigne un héros : ceux de son nom qui portent une majuscule (« Ilian de la maison
// Corval » : Ilian et Corval), sans titre ni mot de moins de trois lettres ; à défaut, le premier mot. Sans accents
// ni casse, comme le journal est lu.
export function nomsDuHeros(nom) {
  const mots = String(nom || "").split(/[\s,]+/).map((m) => m.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")).filter(Boolean);
  const choisis = mots.filter((m) => /^\p{Lu}/u.test(m) && m.length >= 3 && !TITRES.has(plat(m)));
  return [...new Set((choisis.length ? choisis : mots.slice(0, 1)).map(plat))];
}

// Le motif qui trouve ces mots entiers dans une ligne (« d'Ilian » oui, « Ilians » non).
export function motifDuHeros(nom) {
  const noms = nomsDuHeros(nom);
  if (!noms.length) return null;
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${noms.map(echapper).join("|")})(?![\\p{L}\\p{N}])`, "u");
}

export const citeLeHeros = (texte, motif) => !!motif && motif.test(plat(texte));

// Les lignes que l'atelier écrit seul et qui ne disent rien du moment de chacun : un repos cite toute la compagnie, une
// vente ou un versement au sanctuaire n'est pas une scène, un PNJ improvisé n'est pas un héros. Le bilan d'un combat
// compte : il cite ceux qui y ont pris des coups.
export function ligneMecanique(texte) {
  const t = plat(texte);
  if (REPOS_NOMS.some((n) => t.startsWith(n))) return true;
  if (/^pnj improvise\s*:/.test(t)) return true;
  if (/^.+ (achete .+ \(\d+ po\)|recoit .+ \(offert\)) chez .+$/.test(t)) return true;
  return /^.+ verse \d+ po pour .+$/.test(t);
}

// L'heure d'une ligne (« 14:46 »), posée sur le jour de maintenant, au milieu de sa minute (le journal ne garde pas les
// secondes) ; une heure à venir est celle de la veille (une séance qui passe minuit). Rend des millisecondes, ou null
// pour une heure illisible.
export function instantDeLigne(t, maintenant) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? "").trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  const d = new Date(maintenant);
  d.setHours(+m[1], +m[2], 30, 0);
  if (d.getTime() - maintenant > 5 * 60000) d.setDate(d.getDate() - 1);
  return d.getTime();
}

// Les héros de la séance : ceux de la tablée cochés présents (toute la tablée active si personne ne l'est), comme
// « La compagnie » de Séances › Jouer ; sans tablée, les fiches de la tablée. Rangés comme dans le tableau.
export function herosDeLaSeance({ tablee = [], seance = null, fiches = [] } = {}) {
  const presents = new Set(Array.isArray(seance?.presents) ? seance.presents : []);
  const actifs = (Array.isArray(tablee) ? tablee : []).filter((j) => j && j.actif !== false && j.aventurier);
  const choisis = presents.size && actifs.some((j) => presents.has(j.id)) ? actifs.filter((j) => presents.has(j.id)) : actifs;
  const liste = choisis.length ? choisis.map((j) => fiches.find((a) => a.id === j.aventurier)).filter(Boolean) : fiches.filter((a) => a.tablee !== false);
  return [...new Set(liste)].sort((a, b) => String(a.cree || "").localeCompare(String(b.cree || "")));
}

// Les héros qui ont déjà eu la main dans le combat en cours (au premier tour, ceux qui sont passés ou à qui elle est) :
// leur moment, c'est maintenant.
export function herosAuCombat(combat) {
  const ids = new Set();
  if (!combat || !Array.isArray(combat.ordre)) return ids;
  const tour = Math.max(1, combat.tour | 0);
  const actif = Math.max(0, combat.actif | 0);
  const dedans = new Set((combat.heros || []).map((h) => h?.id));
  combat.ordre.forEach((x, i) => {
    if (typeof x !== "string" || !x.startsWith("aventurier:") || (tour < 2 && i > actif)) return;
    const id = x.slice("aventurier:".length);
    if (dedans.has(id)) ids.add(id);
  });
  return ids;
}

// Ce que le tableau retient d'un combat qu'il voit passer : l'heure où chacun y avait la main. Le bilan noté à la fin
// ne cite que les héros blessés ; ainsi ceux qui s'en sortent indemnes ont eu leur moment eux aussi.
export function retenirCombat(vus, combat, maintenant) {
  const ids = herosAuCombat(combat);
  if (!ids.size) return vus || {};
  const r = { ...(vus || {}) };
  for (const id of ids) r[id] = maintenant;
  return r;
}

// Pour chaque héros ({ id, nom }) : minutes depuis son dernier moment (ou depuis le début de la séance s'il n'en a pas
// eu), et d'où vient ce moment (« journal », « combat », « debut » ; null sans rien pour en juger). journal : les
// lignes de la séance ({ t: "14:46", texte }) ; combat : celui en cours ; vus : { id: millisecondes } retenus des
// combats d'avant (retenirCombat). Rend aussi les plus oubliés (au-delà de SEUIL_OUBLI minutes, à égalité tous) et
// l'échelle des barres (une heure au moins).
export function moments({ journal = [], heros = [], maintenant = Date.now(), combat = null, vus = {} } = {}) {
  const lignes = [];
  for (const l of Array.isArray(journal) ? journal : []) {
    if (!l || typeof l.texte !== "string") continue;
    const quand = instantDeLigne(l.t, maintenant);
    if (quand === null || maintenant - quand > FENETRE) continue;
    lignes.push({ quand, texte: l.texte, mecanique: ligneMecanique(l.texte), plat: plat(l.texte) });
  }
  const vusValides = Object.entries(vus || {}).filter(([, v]) => Number.isFinite(v) && v <= maintenant + 60000 && maintenant - v <= FENETRE);
  const auCombat = herosAuCombat(combat);
  const departs = [...lignes.map((l) => l.quand), ...vusValides.map(([, v]) => v)];
  const debut = departs.length ? Math.min(...departs) : auCombat.size ? maintenant : null;
  const minutesDepuis = (t) => Math.max(0, Math.floor((maintenant - t) / 60000));
  const liste = heros.map((h) => {
    const motif = motifDuHeros(h.nom);
    let dernier = null;
    let ligne = "";
    let depuis = null;
    for (const l of lignes) {
      if (l.mecanique || !motif || !motif.test(l.plat) || (dernier !== null && l.quand < dernier)) continue;
      [dernier, ligne, depuis] = [l.quand, l.texte, "journal"];
    }
    const vu = vusValides.find(([id]) => id === h.id)?.[1];
    if (vu !== undefined && (dernier === null || vu > dernier)) [dernier, ligne, depuis] = [vu, "", "combat"];
    if (auCombat.has(h.id)) [dernier, ligne, depuis] = [maintenant, "", "combat"];
    if (dernier === null && debut !== null) [dernier, depuis] = [debut, "debut"];
    return {
      id: h.id, nom: h.nom, minutes: dernier === null ? null : minutesDepuis(dernier), depuis, ligne, auCombat: auCombat.has(h.id),
    };
  });
  // À attente égale, celui que le journal n'a jamais cité passe devant celui qu'il a cité au tout début.
  const poids = (x) => x.minutes + (x.depuis === "debut" ? 0.5 : 0);
  const comptes = liste.filter((x) => x.minutes !== null);
  const pire = comptes.length ? Math.max(...comptes.map(poids)) : 0;
  const oublies = pire >= SEUIL_OUBLI ? comptes.filter((x) => poids(x) === pire).map((x) => x.id) : [];
  return { heros: liste, oublies, echelle: Math.max(60, Math.floor(pire)), debut: debut === null ? null : minutesDepuis(debut) };
}

// « à l'instant », « il y a 12 min », « il y a 1 h 05 » (au-delà d'une heure, à cinq minutes près).
export function depuisEnClair(minutes) {
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "à l'instant";
  return `il y a ${duree(minutes)}`;
}

export function duree(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const arrondi = Math.round(m / 5) * 5;
  const h = Math.floor(arrondi / 60);
  const reste = arrondi % 60;
  return reste ? `${h} h ${String(reste).padStart(2, "0")}` : `${h} h`;
}

// Ce que le héros cherche, en une ligne : pourquoi il est devenu aventurier (sa fiche), sinon son lien avec un autre,
// sinon le début de son histoire. La première phrase seulement ; le texte entier reste pour l'info-bulle.
export function envieDuHeros(fiche) {
  for (const cle of ["pourquoi", "lien", "histoire"]) {
    const entier = String(fiche?.[cle] ?? "").replace(/\s+/g, " ").trim();
    if (!entier) continue;
    const phrase = /^.+?[.!?…](?=\s|$)/.exec(entier)?.[0] || entier;
    return { ligne: phrase.replace(/[.\s]+$/, ""), entier, champ: cle };
  }
  return null;
}
