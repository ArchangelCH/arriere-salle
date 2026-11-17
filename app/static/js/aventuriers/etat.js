// L'état du moment d'un héros, d'un combat et d'une scène à l'autre (Séances › Jouer › « La compagnie », le combat, sa
// fiche) : la Santé et la Psy qui lui restent, la Santé payée faute de Psy (santeDon), ses cartons et une note du MJ.
// Il vit à part de la fiche, qui garde ses maximums (routes /api/etats-heros) : un champ absent veut dire au maximum.
// Les repos suivent le kit (règles, « Santé, soins et cartons » ; aide-mémoire, « Psy et dons »). Le sac (or,
// équipement, objets personnels) s'écrit dans la fiche par sa route étroite. Fonctions pures : la séance, le combat
// et la fiche les appellent, outils/verifier_etat_heros.mjs les vérifie.

import { AVANTAGES, CARACS_CARTON, CARTONS, etatDuMoment, prenom, santeDonRestante } from "../combats/suivi.js";

const signe = (n) => String(n).replace("-", "−");
const enListe = (noms) => (noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}` : noms[0] || "");
const accord = (n, un, plusieurs) => (n > 1 ? plusieurs : un);

// L'état complet d'un héros sur sa fiche : celui du combat (etatDuMoment) et la note du MJ.
export function etatComplet(fiche, etat = null) {
  return { ...etatDuMoment(fiche, etat), notes: typeof etat?.notes === "string" ? etat.notes : "" };
}

export const enPleineForme = (x) => x.sante >= x.max && x.psy >= x.psyMax && !x.santeDon && !Object.keys(x.cartons || {}).length && !x.avantage;

// « carton jaune en Physique et rouge en Mental », ou rien.
export function texteCartons(cartons) {
  const liste = CARACS_CARTON.filter(([k]) => CARTONS[cartons?.[k]]).map(([k, nom]) => `${cartons[k]} en ${nom}`);
  return liste.length ? `carton ${enListe(liste)}` : "";
}

// « Santé 5/8, Psy 2/5, carton jaune en Physique ». La note du MJ seulement si on la demande : elle ne quitte pas
// l'atelier.
export function resumeEtat(x, { sep = ", ", notes = false } = {}) {
  const don = x.santeDon ? ` dont ${x.santeDon} ${accord(x.santeDon, "payé", "payés")} faute de Psy` : "";
  const morceaux = [`Santé ${signe(x.sante)}/${x.max}${don}${x.sante <= 0 ? ", dans le coma" : ""}`, `Psy ${x.psy}/${x.psyMax}`];
  const cartons = texteCartons(x.cartons);
  if (cartons) morceaux.push(cartons);
  if (AVANTAGES[x.avantage]) morceaux.push(`jeton ${AVANTAGES[x.avantage].toLowerCase()}`);
  if (notes && x.notes) morceaux.push(x.notes);
  return morceaux.join(sep);
}

// Les champs que le serveur garde pour cet état : au maximum, un champ part vide (null) et disparaît.
export function champsDe(x) {
  return {
    sante: x.sante >= x.max ? null : x.sante,
    psy: x.psy >= x.psyMax ? null : x.psy,
    santeDon: x.santeDon || null,
    cartons: Object.fromEntries(CARACS_CARTON.map(([k]) => [k, CARTONS[x.cartons?.[k]] ? x.cartons[k] : null])),
    avantage: AVANTAGES[x.avantage] ? x.avantage : null,
  };
}

// Seulement ce qui a changé d'un état à l'autre (un carton à la fois) : l'autre écran garde ce qu'il vient de noter.
export function champsChanges(avant, apres) {
  const a = champsDe(avant);
  const b = champsDe(apres);
  const r = {};
  for (const k of ["sante", "psy", "santeDon", "avantage"]) if (a[k] !== b[k]) r[k] = b[k];
  const cartons = Object.fromEntries(Object.entries(b.cartons).filter(([k, v]) => a.cartons[k] !== v));
  if (Object.keys(cartons).length) r.cartons = cartons;
  return r;
}

// Les valeurs enregistrées (etat : tel que le serveur l'a rendu, absent : null) des champs qu'un repos change : elles
// partent avec lui (« avant »), et le serveur le refuse si un autre écran les a changées entre-temps.
export function valeursAvant(etat, champs) {
  const r = {};
  for (const k of Object.keys(champs)) {
    if (k === "cartons") r.cartons = Object.fromEntries(Object.keys(champs.cartons || {}).map((c) => [c, CARTONS[etat?.cartons?.[c]] ? etat.cartons[c] : null]));
    else r[k] = etat?.[k] ?? null;
  }
  return r;
}

// Deux lots de champs à envoyer pour le même héros : les plus récents l'emportent, carton par carton.
export function reunirChamps(vieux = {}, neufs = {}) {
  const r = { ...vieux, ...neufs };
  if (vieux.cartons && neufs.cartons) r.cartons = { ...vieux.cartons, ...neufs.cartons };
  return r;
}

// Des champs posés sur un état reçu du serveur, comme il les fusionne lui-même : null retire, les cartons un à un.
export function poserEtat(etat, champs = {}) {
  const r = { ...(etat || {}) };
  for (const [cle, v] of Object.entries(champs)) {
    if (cle === "cartons" && v) {
      const cartons = { ...(r.cartons || {}) };
      for (const [k, c] of Object.entries(v)) {
        if (CARTONS[c]) cartons[k] = c;
        else delete cartons[k];
      }
      if (Object.keys(cartons).length) r.cartons = cartons;
      else delete r.cartons;
    } else if (v === null || v === "" || (cle === "santeDon" && v === 0)) delete r[cle];
    else r[cle] = v;
  }
  return r;
}

// ---------------------------------------------------------------- les repos

export const REPOS = {
  nuit: {
    nom: "Nuit de repos",
    regle: "Une nuit complète : +3 Santé, sans rendre celle payée faute de Psy (elle attend une journée entière de repos) ; +1D6 Psy, sans dépasser le maximum ; les cartons jaunes s'en vont, les rouges restent.",
  },
  journee: {
    nom: "Journée de repos",
    regle: "Une journée entière de repos : comme une nuit, et la Santé payée faute de Psy revient.",
  },
  neuf: {
    nom: "Remettre à neuf",
    regle: "Tout revient au maximum de la fiche : Santé, Psy, cartons retirés, Santé payée faute de Psy rendue. Les notes restent.",
  },
};

export const de6 = (hasard = Math.random) => 1 + Math.floor(hasard() * 6);

// Ce qu'un repos change pour un héros (x : son état complet). Nuit et journée : un héros encore dans le coma se
// réveille d'abord à 1 Santé, avec un carton jaune en Physique (kit : une heure après le combat) ; puis +3 Santé, sans
// dépasser le maximum moins la Santé payée faute de Psy ; +de Psy (le 1D6 tiré par l'appelant), sans dépasser le
// maximum ; les cartons jaunes retirés, les rouges gardés. Dans de mauvaises conditions, ni Santé ni cartons : la Psy
// seule. La journée rend en plus la Santé payée faute de Psy. Remettre à neuf : tout au maximum.
// Renvoie { apres, changements } (changements : des morceaux de phrase, vide si rien ne bouge).
export function repos(genre, x, { de = 0, mauvaises = false } = {}) {
  const apres = { ...x, cartons: { ...(x.cartons || {}) } };
  const changements = [];
  let reveil = false;
  if (genre === "neuf") Object.assign(apres, { sante: x.max, psy: x.psyMax, santeDon: 0, cartons: {} });
  else {
    if (apres.sante <= 0) {
      reveil = true;
      apres.sante = 1;
      if (!CARTONS[apres.cartons.physique]) apres.cartons.physique = "jaune";
    }
    if (!mauvaises) {
      const rendu = genre === "journee" ? santeDonRestante(apres) : 0;
      if (genre === "journee") apres.santeDon = 0;
      const plafond = apres.max - santeDonRestante(apres);
      apres.sante = Math.max(apres.sante, Math.min(plafond, apres.sante + 3 + rendu));
      for (const [k] of CARACS_CARTON) if (apres.cartons[k] === "jaune") delete apres.cartons[k];
    }
    apres.psy = Math.max(apres.psy, Math.min(apres.psyMax, apres.psy + Math.max(0, Math.round(+de || 0))));
  }
  apres.santeDon = santeDonRestante(apres);

  if (reveil) changements.push("sort du coma à 1");
  const attente = apres.santeDon
    ? ` (${apres.santeDon} ${accord(apres.santeDon, "point payé", "points payés")} faute de Psy ${accord(apres.santeDon, "attend", "attendent")} une journée de repos)` : "";
  if (apres.sante !== x.sante) changements.push(`Santé ${signe(x.sante)} → ${apres.sante} sur ${x.max}${attente}`);
  else if (attente) changements.push(`Santé ${apres.sante} sur ${x.max}${attente}`);
  const tirage = genre === "neuf" ? "" : ` (1D6 : ${de})`;
  if (apres.psy !== x.psy) changements.push(`Psy ${x.psy} → ${apres.psy} sur ${x.psyMax}${tirage}`);
  else if (genre !== "neuf") changements.push(`Psy déjà pleine${tirage}`);
  const nomCarac = Object.fromEntries(CARACS_CARTON);
  const retires = CARACS_CARTON.filter(([k]) => CARTONS[x.cartons?.[k]] && !apres.cartons[k]).map(([k]) => `${x.cartons[k]} en ${nomCarac[k]}`);
  const gardes = CARACS_CARTON.filter(([k]) => CARTONS[x.cartons?.[k]] && apres.cartons[k] === x.cartons[k]).map(([k]) => `${x.cartons[k]} en ${nomCarac[k]}`);
  const recus = CARACS_CARTON.filter(([k]) => !CARTONS[x.cartons?.[k]] && apres.cartons[k]).map(([k]) => `${apres.cartons[k]} en ${nomCarac[k]}`);
  if (retires.length) changements.push(`${accord(retires.length, "carton", "cartons")} ${enListe(retires)} ${accord(retires.length, "retiré", "retirés")}`);
  if (recus.length) changements.push(`carton ${enListe(recus)} au réveil`);
  if (gardes.length && !mauvaises) changements.push(`${accord(gardes.length, "carton", "cartons")} ${enListe(gardes)} ${accord(gardes.length, "gardé", "gardés")}`);
  return { apres, changements };
}

// La ligne du journal : « Nuit de repos. Garin : Santé 3 → 6 sur 7, Psy 1 → 5 sur 5 (1D6 : 4). »
export function ligneRepos(genre, liste, { mauvaises = false } = {}) {
  const titre = `${REPOS[genre]?.nom || "Repos"}${mauvaises && genre !== "neuf" ? ", dans de mauvaises conditions" : ""}.`;
  const phrases = liste.map(({ nom, changements }) => `${prenom(nom)} : ${changements.length ? changements.join(", ") : "rien ne change"}.`);
  return [titre, ...phrases].join(" ").slice(0, 1990);
}

// ---------------------------------------------------------------- le sac

const OR_MAX = 10000000;
const LIGNE_MAX = 300;
const propre = (t) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, LIGNE_MAX);

// ---- Les quantités. Le sac reste une liste de textes : la quantité vit dans le texte, « Potion de soins ×3 ». Jumelles
// de commun/inventaire.py (quantite_de, ligne, douteuse, cle_nom, rang_du_nom, comptee), tenues à l'identique par les
// cas communs de tests/sac-cas.json (outils/verifier_sac.mjs). Seul l'équipement se compte.

export const QUANTITE_MAX = 999;
// « Corde ×2 » (ce que l'atelier écrit), « Corde x2 », « Corde X 2 », « Corde 2x », « 2x Corde », « 2 × Corde ».
const MARQUE_SIGNE = /^(.*\S)\s*×\s*([0-9]{1,3})$/;
const MARQUE_LETTRE = /^(.*\S)\s+[xX]\s*([0-9]{1,3})$/;
const MARQUE_APRES = /^(.*\S)\s+([0-9]{1,3})\s*[xX×]$/;
const MARQUE_DEVANT = /^([0-9]{1,3})\s*(?:×\s*|[xX]\s+)(\S.*)$/;
const chiffre = (c) => c >= "0" && c <= "9";

// Les lectures possibles d'une marque de quantité : [[nom, n]]. Écrite avec la lettre x, une marque collée à un autre
// nombre n'en est pas une (« Planche 2 x 4 » est une mesure) ; « ×N » en fin de ligne se lit toujours.
function marques(t) {
  const lues = [];
  let m = MARQUE_SIGNE.exec(t);
  if (m) lues.push([m[1], +m[2]]);
  for (const motif of [MARQUE_LETTRE, MARQUE_APRES]) {
    m = motif.exec(t);
    if (m && !chiffre(m[1].slice(-1))) lues.push([m[1], +m[2]]);
  }
  m = MARQUE_DEVANT.exec(t);
  if (m && !chiffre(m[2][0])) lues.push([m[2], +m[1]]);
  return lues;
}

const marquee = (t) => [MARQUE_SIGNE, MARQUE_LETTRE, MARQUE_APRES, MARQUE_DEVANT].some((motif) => motif.test(t));

// [nom, n] d'une ligne du sac : « Potion de soins ×3 » rend [« Potion de soins », 3], « Cape » rend [« Cape », 1]. Une
// marque ne compte que de 1 à 999 et si le nom qui reste n'en porte pas une autre ; sinon la ligne entière est le nom.
export function quantiteDe(ligne) {
  const t = typeof ligne === "string" ? ligne.replace(/\s+/g, " ").trim() : "";
  for (const [nom, n] of marques(t)) if (n >= 1 && n <= QUANTITE_MAX && !marquee(nom)) return [nom, n];
  return [t, 1];
}

// La ligne du sac pour n exemplaires : « Nom ×N », le nom seul pour un exemplaire.
export const ligneDe = (nom, n = 1) => (n <= 1 ? nom : `${nom} ×${n}`);

// Une ligne qui a l'air de porter une quantité qu'on ne sait pas lire sans risque (« Planche 2 x 4 », « Corde ×0 ») :
// elle reste un texte libre, qui ne se compte ni ne se regroupe.
export const douteuse = (texte) => marquee(quantiteDe(texte)[0]);

// Le nom tel qu'il se compare : sans égard à la casse ni aux espaces.
export const cleNom = (nom) => String(nom ?? "").replace(/\s+/g, " ").trim().toLowerCase();

// Le rang de la première ligne de la liste qui porte ce nom et qui se compte ; -1 sinon.
export function rangDuNom(liste, nom) {
  const cle = cleNom(nom);
  return liste.findIndex((x) => x.trim() && !douteuse(x) && cleNom(quantiteDe(x)[0]) === cle);
}

// La ligne avec « de » exemplaires en plus ou en moins : { ligne } (vide quand il n'en reste pas) ou { erreur }.
function comptee(texte, de) {
  if (douteuse(texte)) return { erreur: "Cette ligne ne se compte pas telle qu'elle est écrite : renommez-la d'abord (« Corde ×2 »)." };
  const [nom, n] = quantiteDe(texte);
  if (n + de > QUANTITE_MAX) return { erreur: `Pas plus de ${QUANTITE_MAX} dans une même ligne.` };
  const ligne = n + de > 0 ? ligneDe(nom, n + de) : "";
  return ligne.length > LIGNE_MAX ? { erreur: "Le texte de la ligne est trop long." } : { ligne };
}

// Le texte d'une ligne tel qu'il entre dans le sac : dans l'équipement, la quantité s'écrit « ×N ».
const ecrite = (cle, texte) => (cle === "equipement" && !douteuse(texte) ? ligneDe(...quantiteDe(texte)) : texte);

// Une ligne telle qu'elle se lit sur une feuille : « Potion de soins ×3 », le compte tenu à son nom (espace insécable).
export function lisible(texte) {
  if (typeof texte !== "string" || douteuse(texte)) return texte;
  const [nom, n] = quantiteDe(texte);
  return n > 1 ? `${nom}\u00a0×${n}` : texte;
}

// L'or : « +5 » ajoute, « -3 » retire, « =40 » fixe. Renvoie { or } ou { erreur }.
export function saisieOr(texte, actuel) {
  const t = String(texte ?? "").replace(/\s+/g, "").replace(/[−–]/g, "-");
  const m = /^([-+=])(\d{1,7})$/.exec(t);
  if (!m) return { erreur: "Pour l'or : « +5 » ajoute, « -3 » retire, « =40 » fixe." };
  const avant = Math.max(0, Math.round(+actuel || 0));
  const or = m[1] === "=" ? +m[2] : m[1] === "+" ? avant + +m[2] : avant - +m[2];
  if (or < 0) return { erreur: `La bourse n'a que ${avant} ${accord(avant, "pièce", "pièces")} d'or.` };
  return { or: Math.min(OR_MAX, or) };
}

// Une liste du sac telle que la route la compare : des textes, les objets personnels toujours en trois cases.
export function listeDuSac(fiche, cle) {
  const l = Array.isArray(fiche?.[cle]) ? fiche[cle].map((x) => (typeof x === "string" ? x : String(x ?? ""))) : [];
  return cle === "objets" ? [...l, "", "", ""].slice(0, Math.max(3, l.length)) : l;
}

const orDe = (fiche) => (typeof fiche?.or === "number" && Number.isFinite(fiche.or) ? Math.round(fiche.or) : null);

// Un geste sur le sac, joué sur la fiche telle qu'elle est (après un refus 409, sur la fiche relue du serveur) :
// { genre: "or", texte } ; { genre: "ajouter", liste, texte } ; { genre: "changer", liste, rang, avant, texte } ;
// { genre: "retirer", liste, rang, avant } ; { genre: "quantite", liste: "equipement", rang, avant, de } (de : +1, -1,
// ou tout autre entier ; à zéro la ligne s'en va). La ligne visée se retrouve à sa place avec son texte, sinon au premier
// endroit où ce texte paraît ; pour une quantité, à défaut, la ligne du même nom (son compte a changé entre-temps).
// (Avec strict, sans ce repli : l'aperçu d'un geste déjà parti ne le compte pas deux fois quand la fiche relue le porte déjà.)
// Ajouter à l'équipement un objet déjà là augmente sa quantité. Renvoie le corps de la route du sac
// ({ champ: { avant, apres } }), {} s'il n'y a rien à changer, ou { erreur } quand le geste ne s'applique plus.
export function corpsDuSac(fiche, geste) {
  if (geste.genre === "or") {
    const avant = orDe(fiche);
    const r = saisieOr(geste.texte, avant);
    if (r.erreur) return r;
    return r.or === avant ? {} : { or: { avant, apres: r.or } };
  }
  const cle = geste.liste;
  if (cle !== "equipement" && cle !== "objets") return { erreur: "Liste inconnue." };
  const avant = listeDuSac(fiche, cle);
  const apres = [...avant];
  if (geste.genre === "ajouter") {
    let texte = propre(geste.texte);
    if (!texte) return {};
    if (cle === "equipement" && !douteuse(texte)) {
      const [nom, k] = quantiteDe(texte);
      const deja = rangDuNom(apres, nom);
      if (deja >= 0) {
        const r = comptee(apres[deja], k);
        if (r.erreur) return r;
        apres[deja] = r.ligne;
        return { [cle]: { avant, apres } };
      }
      texte = ligneDe(nom, k);
    }
    const libre = apres.findIndex((x) => !x.trim());
    if (cle === "objets" && libre < 0) return { erreur: "Les trois objets personnels sont pris : changez-en un." };
    if (libre >= 0) apres[libre] = texte;
    else apres.push(texte);
  } else {
    let i = apres[geste.rang] === geste.avant ? geste.rang : apres.indexOf(geste.avant);
    if (i < 0 && geste.genre === "quantite" && !geste.strict) i = rangDuNom(apres, quantiteDe(geste.avant)[0]);
    if (i < 0) return { erreur: "Cette ligne du sac a changé sur un autre écran." };
    let texte = "";
    if (geste.genre === "quantite") {
      if (cle !== "equipement") return { erreur: "Les objets personnels ne se comptent pas." };
      if (!Number.isInteger(geste.de) || !geste.de) return { erreur: "Quantité illisible." };
      const r = comptee(apres[i], geste.de);
      if (r.erreur) return r;
      texte = r.ligne;
    } else if (geste.genre !== "retirer") texte = ecrite(cle, propre(geste.texte));
    if (texte === apres[i]) return {};
    if (!texte && cle === "equipement") apres.splice(i, 1);
    else apres[i] = texte;
  }
  return { [cle]: { avant, apres } };
}

// Un objet repris dans l'équipement (« Annuler la vente » de la boutique) : le corps de la route du sac, ou null s'il n'y
// est plus. Une ligne qui se compte perd ce qui y était entré (un « Flèches ×20 » en reprend vingt, la ligne s'en va au
// dernier) ; une ligne qui ne se compte pas s'en va entière, la dernière de ce texte.
export function reprisDuSac(fiche, nom) {
  const liste = listeDuSac(fiche, "equipement");
  const texte = propre(nom);
  if (!texte) return null;
  if (douteuse(texte)) {
    const rang = liste.lastIndexOf(texte);
    return rang < 0 ? null : corpsDuSac(fiche, { genre: "retirer", liste: "equipement", rang, avant: liste[rang] });
  }
  const [seul, lot] = quantiteDe(texte);
  const rang = rangDuNom(liste, seul);
  return rang < 0 ? null : corpsDuSac(fiche, { genre: "quantite", liste: "equipement", rang, avant: liste[rang], de: -lot });
}

// La fiche telle qu'elle sera une fois le geste passé (pour l'afficher tout de suite) ; inchangée s'il ne s'applique pas.
export function avecGeste(fiche, geste) {
  const corps = corpsDuSac(fiche, geste);
  if (corps.erreur) return fiche;
  return { ...fiche, ...Object.fromEntries(Object.entries(corps).map(([k, v]) => [k, v.apres])) };
}

// « 110 pièces d'or, 5 objets »
export function resumeSac(fiche) {
  const or = orDe(fiche);
  const n = listeDuSac(fiche, "equipement").filter((x) => x.trim()).reduce((s, x) => s + (douteuse(x) ? 1 : quantiteDe(x)[1]), 0)
    + listeDuSac(fiche, "objets").filter((x) => x.trim()).length;
  return [or === null ? "" : `${or} ${accord(or, "pièce", "pièces")} d'or`, `${n || "aucun"} ${accord(n, "objet", "objets")}`].filter(Boolean).join(", ");
}
