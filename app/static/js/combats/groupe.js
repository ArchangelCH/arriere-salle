// Les aventuriers de la balance. Chacun garde ses valeurs à son niveau de base ; la balance les calcule au niveau choisi,
// à l'affichage et pour la simulation, sans jamais les réécrire (auNiveau).
// Prétirés du kit et aventuriers de la tablée sont lus dans leur fiche (profilDeCombat) : attaque = caractéristique +
// compétence de l'arme principale, défense = Physique + Esquive, Bouclier ou arme de contact. Profils types : le groupe
// de niveau 2 qui a servi à calibrer le bestiaire.

import { NIVEAUX, defense, lireDes, valeurArme } from "../aventuriers/regles.js";
import { estInvite } from "../mj/role.js";

export const POSTURES = [["focus", "Focus"], ["defensive", "Défensive"], ["offensive", "Offensive"]];

// Le profil de combat d'une fiche d'aventurier (créateur ou prétiré du kit), à son niveau : l'arme principale (la première
// qui fait des dégâts), l'armure, le bouclier, la Santé, la défense et la posture de base.
export function profilDeCombat(a) {
  const principale = (a.armes || []).find((w) => (w.nom || "").trim() && lireDes(w.degats) !== null);
  const posture = a.posture || "focus";
  const degats = principale?.degats || "1D4";
  const arme = principale ? principale.nom : "Mains nues";
  return {
    att: principale ? valeurArme(a, principale) : valeurArme(a, { competence: "Pugilat" }),
    degats,
    armure: +a.protection?.indice || 0, bouclier: a.bouclier ? 2 : 0,
    sante: Math.max(1, +a.sante || 1), psy: +a.psy || 0, defense: defense(a), posture,
    base: a.niveau || 1,
    note: posture === "offensive" ? `${arme}, ${lireDes(degats)} en offensive` : arme,
  };
}

// Les prétirés du kit, lus dans leur fiche (aventuriers/kit.js) : leurs valeurs suivent le kit. Le kit porte aussi
// leurs histoires, des secrets pour un MJ invité : la liste se remplit par chargerPretires(), à l'ouverture de la balance,
// chez le MJ principal seulement ; chez l'invité, elle reste vide. GROUPE_DE_DEPART, chargé avec eux : les
// clés des prétirés dont part la balance quand la tablée est vide (le choix de la campagne).
export const PRETIRES = [];
export const GROUPE_DE_DEPART = [];
const sansPrefixe = (cle) => cle.replace(/^pretire-/, "");
export async function chargerPretires() {
  if (PRETIRES.length || estInvite()) return PRETIRES;
  const { PRETIRES: duKit, GROUPE_DE_DEPART: groupe } = await import("../aventuriers/kit.js");
  if (!PRETIRES.length) {
    PRETIRES.push(...duKit.map((p) => ({ ...profilDeCombat(p), cle: sansPrefixe(p.cle), nom: p.nom })));
    GROUPE_DE_DEPART.push(...(groupe || []).map(sansPrefixe));
  }
  return PRETIRES;
}

export const PROFILS_TYPES = [
  { cle: "type-paladin", nom: "Paladin", att: 80, degats: "1D10", armure: 5, bouclier: 2, sante: 13, psy: 2, defense: 80, posture: "defensive", base: 2 },
  { cle: "type-archer", nom: "Archer", att: 85, degats: "1D8", armure: 1, bouclier: 0, sante: 10, psy: 5, defense: 65, posture: "focus", base: 2 },
  { cle: "type-cogneur", nom: "Cogneur nain", att: 80, degats: "1D8", armure: 2, bouclier: 0, sante: 11, psy: 4, defense: 60, posture: "focus", base: 2 },
  { cle: "type-mage", nom: "Mage", att: 75, degats: "1D6+1", armure: 0, bouclier: 0, sante: 8, psy: 7, defense: 30, posture: "focus", base: 2 },
  { cle: "type-roublard", nom: "Roublard", att: 75, degats: "1D6", armure: 1, bouclier: 0, sante: 11, psy: 4, defense: 70, posture: "focus", base: 2 },
  { cle: "type-pretre", nom: "Prêtre", att: 60, degats: "1D6", armure: 3, bouclier: 0, sante: 12, psy: 3, defense: 50, posture: "defensive", base: 2 },
];

// Ce que les niveaux entre « de » (exclu) et « a » (inclus) apportent au combat, d'après le guide de progression :
// les points de Santé et de Psy (niveaux 2 à 5, 7 et 9), +5 % aux caractéristiques (toutes au 5 et au 10, une au 8,
// comptée sur celle qui sert à se battre) et +10 % de compétences au 7 et au 9 (comptés moitié sur l'arme, moitié sur la défense).
function gains(de, a) {
  const passes = NIVEAUX.filter((x) => x.n > de && x.n <= a);
  const somme = (f) => passes.reduce((s, x) => s + f(x), 0);
  return { points: somme((x) => x.points || 0), caracs: somme((x) => (x.toutes || 0) + (x.une || 0)), competences: somme((x) => x.competences || 0) };
}

// Les valeurs d'un aventurier de la balance au niveau voulu. Rend un nouvel objet : les valeurs de base ne bougent pas,
// si bien qu'un aller-retour de niveau retombe exactement sur ses pieds. Les points gagnés se répartissent entre Santé et
// Psy comme à la création.
export function auNiveau(p, niveau) {
  const base = Math.min(10, Math.max(1, p.base || 1));
  const cible = Math.min(10, Math.max(1, +niveau || 1));
  if (cible === base) return { ...p };
  const sens = cible > base ? 1 : -1;
  const g = sens > 0 ? gains(base, cible) : gains(cible, base);
  const sante = +p.sante || 1;
  const psy = +p.psy || 0;
  const pourSante = Math.round(g.points * (sante / Math.max(1, sante + psy)));
  const pourcents = g.caracs + g.competences / 2;
  return {
    ...p,
    sante: Math.max(1, sante + sens * pourSante),
    psy: Math.max(0, psy + sens * (g.points - pourSante)),
    att: Math.max(0, (+p.att || 0) + sens * pourcents),
    defense: +p.defense ? Math.max(0, +p.defense + sens * pourcents) : 0,
  };
}

export function nouvelAventurier(modele) {
  return { id: Math.random().toString(36).slice(2, 8), ...modele };
}

// Un aventurier de la tablée, lu dans sa fiche (à son niveau).
export function depuisAventurier(a) {
  const profil = profilDeCombat(a);
  return {
    ...profil,
    cle: `aventurier:${a.id}`, aventurier: a.id, nom: a.nom || "Sans nom",
    note: `${profil.note}, d'après sa fiche (niveau ${a.niveau || 1})`,
  };
}
