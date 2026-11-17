// Les liens courts de la zone d'écriture : le MJ lit et écrit @[Basile Varenne], le fichier garde
// [Basile Varenne](#/pnj/basile-varenne). L'atelier passe de l'un à l'autre à chaque frappe, et le texte enregistré revient
// tel quel, octet pour octet : un chapitre qu'on ouvre ne change pas. Un @[Nom] tapé à la main se résout par le nom ;
// sans fiche de ce nom, il reste écrit ainsi jusqu'à ce qu'elle existe. Fonctions pures, vérifiées par
// outils/verifier_liens_scenario.mjs.

import { COURT, GENRES_FICHES, cibleLien } from "./fiches.js";
import { plier } from "./consignes.js";

const LIEN = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const CONSIGNE = /\[\[[\s\S]*?\]\]/g;

const plages = (t) => [...t.matchAll(CONSIGNE)].map((m) => [m.index, m.index + m[0].length]);
const dedans = (liste, a, b) => liste.some(([x, y]) => a < y && b > x);

// Le texte de la zone d'écriture, et la table des libellés raccourcis (libellé → adresse). Un lien se raccourcit s'il
// vise une fiche de l'atelier, hors d'une consigne, sans « ( » ni « ] » juste après ni crochet dans son libellé, et si son
// libellé ne désigne que cette adresse dans tout le chapitre (deux « Billy » différents restent écrits en entier).
export function versZone(fichier) {
  const t = String(fichier ?? "");
  const consignes = plages(t);
  const liens = [...t.matchAll(LIEN)].map((m) => ({ debut: m.index, fin: m.index + m[0].length, libelle: m[1], href: m[2] }))
    .filter((l) => cibleLien(l.href) && !dedans(consignes, l.debut, l.fin));
  const adresses = new Map();
  for (const l of [...t.matchAll(LIEN)].map((m) => ({ libelle: m[1], href: m[2] }))) {
    adresses.set(l.libelle, new Set([...(adresses.get(l.libelle) || []), l.href]));
  }
  // Un @[libellé] déjà écrit tel quel (une fiche pas encore trouvée) garde son libellé pour lui.
  const dejaCourts = new Set(liensCourts(t).map((l) => l.libelle));
  const table = new Map();
  let zone = "";
  let pos = 0;
  for (const l of liens) {
    const seul = adresses.get(l.libelle).size === 1 && !dejaCourts.has(l.libelle) && !l.libelle.includes("[");
    if (!seul || t[l.fin] === "(" || t[l.fin] === "]") continue;
    zone += `${t.slice(pos, l.debut)}@[${l.libelle}]`;
    pos = l.fin;
    table.set(l.libelle, l.href);
  }
  return { zone: zone + t.slice(pos), table };
}

// Le texte du fichier : chaque @[libellé] (hors d'une consigne, sans « ( » juste après) reprend son adresse, celle de la
// table, sinon celle de la fiche qui porte ce nom (resoudre). Introuvable, il reste tel quel.
export function versFichier(zone, table = new Map(), resoudre = () => null) {
  const t = String(zone ?? "");
  const consignes = plages(t);
  return t.replace(COURT, (tout, libelle, i) => {
    if (dedans(consignes, i, i + tout.length)) return tout;
    const href = table.get(libelle) || resoudre(libelle);
    return href ? `[${libelle}](${href})` : tout;
  });
}

// Les liens courts du texte de la zone : { debut, fin, libelle }.
export function liensCourts(zone) {
  const t = String(zone ?? "");
  const consignes = plages(t);
  return [...t.matchAll(COURT)].map((m) => ({ debut: m.index, fin: m.index + m[0].length, libelle: m[1] }))
    .filter((l) => !dedans(consignes, l.debut, l.fin));
}

// La fiche d'un @[Nom] tapé à la main : dans l'ordre PNJ, lieu, plan, rencontre, carte, le premier genre qui porte ce nom,
// s'il n'y a qu'une fiche. fiches : la liste de fichesDe() ; rend sa route, ou null.
export function resoudreNom(nom, fiches = []) {
  const cle = plier(nom);
  for (const genre of Object.keys(GENRES_FICHES)) {
    const trouvees = fiches.filter((f) => f.genre === genre && f.cle === cle);
    if (trouvees.length) return trouvees.length === 1 ? trouvees[0].route : null;
  }
  return null;
}

// Pour l'éditeur (scenarios.js) : la table des libellés de chaque chapitre, gardée tant que la page vit. Un lien effacé
// puis remis par Ctrl+Z retrouve ainsi son adresse, même si son libellé n'est pas le nom de la fiche.
export class LiensCourts {
  constructor(fiches = () => []) {
    this.fiches = fiches;
    this.tables = new Map();
  }

  table(chapitre) {
    if (!this.tables.has(chapitre)) this.tables.set(chapitre, new Map());
    return this.tables.get(chapitre);
  }

  // Le texte de la zone pour un chapitre ({ id, texte }) ; ce que le fichier dit de ses liens fait foi.
  zone(ch) {
    const { zone, table } = versZone(ch.texte || "");
    const memoire = this.table(ch.id);
    for (const [libelle, href] of table) memoire.set(libelle, href);
    return zone;
  }

  fichier(ch, zone) {
    return versFichier(zone, this.table(ch.id), (libelle) => resoudreNom(libelle, this.fiches() || []));
  }

  // Un lien inséré peut-il s'écrire court ? Oui si son libellé est libre dans ce chapitre, ou désigne déjà cette adresse ;
  // un libellé que le texte n'emploie plus change de sens. Le libellé retenu entre dans la table.
  retenir(ch, zone, libelle, href) {
    const memoire = this.table(ch.id);
    const ailleurs = memoire.get(libelle);
    if (ailleurs && ailleurs !== href && liensCourts(zone).some((l) => l.libelle === libelle)) return false;
    memoire.set(libelle, href);
    return true;
  }
}
