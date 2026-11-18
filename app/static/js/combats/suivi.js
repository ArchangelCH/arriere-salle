// Le suivi d'un combat, selon le kit : l'ordre du tour (aucun jet d'initiative, le MJ annonce combien d'aventuriers
// agissent avant les ennemis, puis les ennemis, puis le reste du groupe, le même ordre à chaque tour), la Santé de chacun,
// la Psy et les cartons des héros, le coma, la mort et la fuite des sbires. Fonctions pures : la page du combat
// (combat.js) les appelle, outils/verifier_combat.mjs les vérifie.

// Qui commence, selon la situation (aide-mémoire du MJ) : le nombre d'aventuriers qui agissent avant l'ennemi.
export const SITUATIONS = [
  [0, "Embuscade : le groupe est surpris"],
  [1, "Combat attendu, ennemis avantagés"],
  [2, "Combat attendu, ennemis plus faibles"],
  [3, "Groupe vraiment préparé"],
];
export const ENNEMIS = "ennemis";
// « Aucune » : la posture perdue (un dé de mésaventure l'a cassée), à découvert : aucune défense, aucun effet.
export const POSTURES_COMBAT = [["offensive", "Offensive"], ["defensive", "Défensive"], ["focus", "Focus"], ["aucune", "Aucune"]];
export const CARACS_CARTON = [["physique", "Physique"], ["social", "Social"], ["mental", "Mental"]];
export const CARTONS = { jaune: "jaune, −10 %", rouge: "rouge, −30 %" };
// Le jeton du kit : un seul à la fois ; un avantage et un désavantage s'annulent.
export const AVANTAGES = { avantage: "Avantage", desavantage: "Désavantage" };
export const avantageDe = (x) => (AVANTAGES[x?.avantage] ? x.avantage : "");
// Le jeton après un geste : le même jeton se retire (il est joué), l'autre l'annule, sinon il se pose.
export function jetonApres(actuel, geste) {
  if (!AVANTAGES[geste]) return "";
  if (actuel === geste) return "";
  return AVANTAGES[actuel] ? "" : geste;
}
// « Si la table débat trop longtemps, le monstre rejoue » : le sablier, en secondes.
export const SABLIER = 60;

export const refHeros = (id) => `aventurier:${id}`;
export const prenom = (nom) => String(nom || "").trim().split(/[\s,]+/)[0] || "";
export const nomAdversaire = (a) => `${a.nom || "Adversaire"}${a.numero ? ` ${a.numero}` : ""}`;

export function herosDe(c, entree) {
  return (c.heros || []).find((h) => refHeros(h.id) === entree) || null;
}

// L'ordre du tour : les aventuriers qui agissent avant l'ennemi (ceux choisis par la table, complétés dans l'ordre de la
// liste s'il en manque), les ennemis, puis le reste du groupe.
export function composerOrdre(ids, avant, choisis = []) {
  const n = Math.max(0, Math.min(ids.length, Math.round(+avant || 0)));
  const premiers = choisis.filter((id, i) => ids.includes(id) && choisis.indexOf(id) === i).slice(0, n);
  for (const id of ids) if (premiers.length < n && !premiers.includes(id)) premiers.push(id);
  return [...premiers.map(refHeros), ENNEMIS, ...ids.filter((id) => !premiers.includes(id)).map(refHeros)];
}

// « Garin, puis les adversaires, puis Ysane et Hadrik »
export function phraseOrdre(c) {
  const morceaux = [];
  for (const entree of c.ordre || []) {
    if (entree === ENNEMIS) morceaux.push(null);
    else {
      const h = herosDe(c, entree);
      if (!h) continue;
      if (Array.isArray(morceaux[morceaux.length - 1])) morceaux[morceaux.length - 1].push(prenom(h.nom));
      else morceaux.push([prenom(h.nom)]);
    }
  }
  const liste = (noms) => (noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}` : noms[0]);
  const phrase = morceaux.map((m) => (m ? liste(m) : "les adversaires")).join(", puis ");
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

const entier = (v) => Math.max(0, Math.round(+v || 0));

// L'état du moment d'un héros (routes /api/etats-heros : ce que le combat d'avant ou la séance ont laissé) posé sur sa
// fiche : la fiche donne les maximums, l'état ce qui manque. Un champ absent, ou pas d'état : au maximum. Ni la Santé
// ni la Psy ne dépassent le maximum de la fiche ; la Santé payée en dons jamais plus que ce qui manque.
export function etatDuMoment(fiche, etat = null) {
  const max = Math.max(1, Math.round(+fiche?.sante || 0));
  const psyMax = entier(fiche?.psy);
  const x = etat || {};
  const sante = typeof x.sante === "number" ? Math.min(max, Math.round(x.sante)) : max;
  const psy = typeof x.psy === "number" ? Math.min(psyMax, entier(x.psy)) : psyMax;
  const cartons = Object.fromEntries(CARACS_CARTON.filter(([k]) => CARTONS[x.cartons?.[k]]).map(([k]) => [k, x.cartons[k]]));
  return { max, sante, psyMax, psy, santeDon: Math.min(entier(x.santeDon), Math.max(0, max - sante)), cartons, avantage: avantageDe(x) };
}

// Un héros tel qu'il entre au combat : sa Santé, sa Psy, la Santé payée en dons, ses cartons et son jeton d'avantage du
// moment (etat, sinon en pleine forme), sa posture de base. Sa fiche n'est pas touchée.
export function herosDepuis(fiche, couleur = "", etat = null) {
  const { max, sante, psyMax, psy, santeDon, cartons, avantage } = etatDuMoment(fiche, etat);
  const posture = POSTURES_COMBAT.some(([k]) => k === fiche.posture) ? fiche.posture : "focus";
  return {
    id: fiche.id, nom: fiche.nom || "Sans nom", couleur: fiche.couleur || couleur || "", max, sante, psyMax, psy, santeDon, posture, cartons,
    ...(avantage ? { avantage } : {}),
  };
}

// La Psy d'un héros au combat : celle qu'il lui reste (psy), le maximum de sa fiche (psyMax) et la Santé prise faute de
// Psy pour payer un don (santeDon : elle ne revient qu'après une journée entière de repos). Un combat commencé avant
// le suivi de la Psy la reprend pleine, de la fiche.
export function psyDe(h, fiche = null) {
  const psyMax = typeof h.psyMax === "number" ? entier(h.psyMax) : entier(fiche?.psy);
  return { psy: typeof h.psy === "number" ? entier(h.psy) : psyMax, psyMax, santeDon: entier(h.santeDon) };
}

// Les adversaires, un par combattant, depuis les groupes d'une rencontre (rencontre.js).
export function adversairesDepuis(liste) {
  let k = 0;
  return liste.flatMap((g) => g.membres.map((m) => {
    const a = g.a;
    return {
      id: `a${++k}`, nom: a.nom || "Adversaire", numero: m.numero || "", cle: a.cle || "", rang: a.rang || "", sansPeur: !!a.sansPeur,
      max: g.sante, sante: g.sante, fuite: false, att: +a.att || 0, attaques: +a.attaques || 1, degats: a.degats || "",
      armure: +a.armure || 0, bouclier: +a.bouclier || 0, nbDef: +a.nbDef || 0, defense: +a.defense || 0,
      ignoreArmure: !!a.ignoreArmure, capacites: a.capacites || "",
    };
  }));
}

export function nouveauCombat({ rencontre, heros, adversaires, avant, choisis = [], debut = new Date().toISOString(), id = "" }) {
  const n = Math.max(0, Math.min(3, Math.round(+avant || 0)));
  return {
    id: id || Math.random().toString(16).slice(2, 10),
    rencontre: rencontre.id, nom: rencontre.nom || "Rencontre", debut, avant: n, moral: rencontre.moral !== false,
    tour: 1, actif: 0, ordre: composerOrdre(heros.map((h) => h.id), n, choisis), heros, adversaires, strat: false, sablier: null,
  };
}

// « -4 » ou « 4 » retire, « +3 » rend, « =7 » fixe : le signe (« - » sans signe) et le nombre, ou null si illisible.
function lireGeste(texte) {
  const t = String(texte ?? "").replace(/\s+/g, "").replace(/[−–]/g, "-");
  const m = /^([-+=]?)(\d{1,3})$/.exec(t);
  return m ? { signe: m[1] || "-", v: +m[2] } : null;
}

// Renvoie la nouvelle Santé, ou null pour une saisie illisible.
export function lireSaisie(texte, sante) {
  const g = lireGeste(texte);
  if (!g) return null;
  if (g.signe === "=") return g.v;
  return g.signe === "+" ? sante + g.v : sante - g.v;
}

// La Psy : « -2 » ou « 2 » paie un don (dépensée même s'il rate), « +1 » rend sans dépasser le maximum, « =3 » fixe.
// S'il manque de la Psy, le reste est pris sur la Santé et noté dans santeDon (kit : Santé et Psy sont des vases
// communicants). Renvoie { psy, psyMax, santeDon, sante, preleve } (preleve : la Santé prise), ou null si illisible.
export function saisiePsy(texte, h, fiche = null) {
  const g = lireGeste(texte);
  if (!g) return null;
  const p = psyDe(h, fiche);
  if (g.signe === "=") return { ...p, psy: g.v, sante: h.sante, preleve: 0 };
  if (g.signe === "+") return { ...p, psy: Math.max(p.psy, Math.min(p.psyMax, p.psy + g.v)), sante: h.sante, preleve: 0 };
  const preleve = Math.max(0, g.v - p.psy);
  return { ...p, psy: Math.max(0, p.psy - g.v), sante: h.sante - preleve, santeDon: p.santeDon + preleve, preleve };
}

// La Santé payée en dons ne dépasse jamais ce qui manque : seul « =N » (le MJ, après une journée entière de repos) la
// fait baisser, puisque des soins s'arrêtent avant elle (saisieSante).
export const santeDonRestante = (h) => Math.min(entier(h.santeDon), Math.max(0, Math.round(+h.max || 0) - Math.round(+h.sante || 0)));

// La Santé d'un combattant après une saisie. « =N » fixe ce que veut le MJ. Des soins ne dépassent pas le maximum moins
// la Santé payée en dons (kit : elle ne revient qu'après une journée entière de repos) et ne la font jamais baisser.
// Renvoie { sante, retenu } (retenu : les soins que les dons ont arrêtés), ou null si illisible.
export function saisieSante(texte, x) {
  const g = lireGeste(texte);
  if (!g) return null;
  if (g.signe === "=") return { sante: g.v, retenu: 0 };
  if (g.signe === "-") return { sante: Math.min(x.max, x.sante - g.v), retenu: 0 };
  const soigne = (plafond) => Math.max(x.sante, Math.min(plafond, x.sante + g.v));
  const sante = soigne(x.max - santeDonRestante(x));
  return { sante, retenu: soigne(x.max) - sante };
}

// La nouvelle Santé d'un héros : remonté au-dessus de 0, un héros dans le coma se réveille avec un carton jaune en
// Physique (kit) ; la Santé payée en dons ne dépasse jamais ce qui manque (« =N » la fait baisser, des soins s'arrêtent
// avant elle : saisieSante). Renvoie { heros, coma, reveil } : coma, il y tombe ; reveil, il en sort.
export function santePosee(x, valeur) {
  const heros = { ...x, sante: valeur };
  const coma = valeur <= 0 && x.sante > 0;
  const reveil = valeur > 0 && x.sante <= 0;
  if (reveil && !CARTONS[x.cartons?.physique]) heros.cartons = { ...(x.cartons || {}), physique: "jaune" };
  if (x.santeDon) heros.santeDon = santeDonRestante(heros);
  return { heros, coma, reveil };
}

// Coma à 0 ou moins ; mort à moins la Santé maximum, et jamais avant -10 (repère du kit, le MJ tranche).
export const seuilMort = (max) => -Math.max(Math.round(+max || 0), 10);
export function etatHeros(h) {
  return h.sante <= seuilMort(h.max) ? "mort" : h.sante <= 0 ? "coma" : "debout";
}
export const horsDeCombat = (a) => a.sante <= 0 || !!a.fuite;

// Les sbires fuient quand la moitié d'entre eux est tombée (même règle que la simulation) ; les sans-peur restent.
// null quand la règle ne joue pas : la rencontre l'a retirée, ou il y a moins de deux sbires.
export function moralDuCombat(c) {
  const peureux = (c.adversaires || []).filter((a) => a.rang === "sbire" && !a.sansPeur);
  if (c.moral === false || peureux.length < 2) return null;
  const tombes = peureux.filter((a) => a.sante <= 0).length;
  const seuil = Math.ceil(peureux.length / 2);
  return { n: peureux.length, seuil, tombes, fuient: tombes >= seuil, restent: peureux.filter((a) => !horsDeCombat(a)) };
}

export function peutAgir(c, entree) {
  if (entree === ENNEMIS) return (c.adversaires || []).some((a) => !horsDeCombat(a));
  const h = herosDe(c, entree);
  return !!h && h.sante > 0;
}

// Le combattant suivant, qui sautera un héros dans le coma ou des ennemis tous hors de combat ; après le dernier, le tour
// suivant. Le sablier s'arrête.
export function suivant(c) {
  const n = (c.ordre || []).length;
  if (!n) return { ...c, sablier: null };
  let actif = Math.min(n - 1, Math.max(0, c.actif | 0));
  let tour = Math.max(1, c.tour | 0);
  for (let pas = 0; pas < n; pas++) {
    actif += 1;
    if (actif >= n) {
      actif = 0;
      tour += 1;
    }
    if (peutAgir(c, c.ordre[actif])) return { ...c, actif, tour, sablier: null };
  }
  // Personne ne peut agir : un pas, sans rien sauter.
  actif = (Math.max(0, c.actif | 0) + 1) % n;
  return { ...c, actif, tour: Math.max(1, c.tour | 0) + (actif === 0 ? 1 : 0), sablier: null };
}

// Retour au combattant d'avant (un clic de trop), sans revenir avant le premier tour.
export function precedent(c) {
  const n = (c.ordre || []).length;
  let actif = Math.max(0, c.actif | 0);
  let tour = Math.max(1, c.tour | 0);
  for (let pas = 0; pas < n; pas++) {
    if (actif === 0 && tour === 1) break;
    actif -= 1;
    if (actif < 0) {
      actif = n - 1;
      tour -= 1;
    }
    if (peutAgir(c, c.ordre[actif])) break;
  }
  return { ...c, actif, tour, sablier: null };
}

// La main a-t-elle bougé d'une version du combat à l'autre (le combattant actif ou le tour) ?
export const mainChangee = (a, b) => !!a && !!b && ((a.actif | 0) !== (b.actif | 0) || (a.tour | 0) !== (b.tour | 0));

// Deux écrans sur le même combat (le Mac et l'iPad) : ce que cet écran a changé depuis la dernière version connue du
// serveur passe par-dessus celle-ci, champ par champ, et combattant par combattant pour les héros et les adversaires.
// Un combat fini ou remplacé sur l'autre écran l'emporte. La main passée sur les deux écrans depuis la même version
// (la télécommande, puis Entrée sur l'ordinateur) : celle du serveur reste, un tour n'est jamais compté deux fois.
export function fusionnerCombat(base, local, serveur) {
  if (!serveur || !local || !base || serveur.id !== local.id || base.id !== local.id) return serveur;
  const differe = (x, y) => JSON.stringify(x) !== JSON.stringify(y);
  const deuxMains = mainChangee(base, local) && mainChangee(base, serveur);
  const r = { ...serveur };
  for (const cle of Object.keys(local)) {
    if (cle === "modifie" || cle === "heros" || cle === "adversaires") continue;
    if (deuxMains && (cle === "actif" || cle === "tour" || cle === "sablier")) continue;
    if (differe(local[cle], base[cle])) r[cle] = local[cle];
  }
  for (const genre of ["heros", "adversaires"]) {
    const avant = new Map((base[genre] || []).map((x) => [x.id, x]));
    const ici = new Map((local[genre] || []).map((x) => [x.id, x]));
    r[genre] = (serveur[genre] || []).map((s) => {
      const x = ici.get(s.id);
      const b = avant.get(s.id);
      if (!x || !b) return s;
      const f = { ...s };
      for (const k of Object.keys(x)) if (differe(x[k], b[k])) f[k] = x[k];
      return f;
    });
  }
  return r;
}

export const enListe = (noms) => (noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}` : noms[0] || "");

// La ligne du journal en fin de combat : tours, qui est tombé, qui a fui, qui reste debout, les héros à terre, leur Psy
// quand elle a changé, la Santé payée faute de Psy et les cartons reçus.
export function bilan(c) {
  const adv = c.adversaires || [];
  const phrases = [`Combat « ${c.nom || "Rencontre"} » : ${c.tour} tour${c.tour > 1 ? "s" : ""}.`];
  const tapis = adv.filter((a) => a.sante <= 0).map(nomAdversaire);
  const fuite = adv.filter((a) => a.sante > 0 && a.fuite).map(nomAdversaire);
  const debout = adv.filter((a) => !horsDeCombat(a)).map(nomAdversaire);
  if (tapis.length) phrases.push(`Au tapis : ${enListe(tapis)}.`);
  if (fuite.length) phrases.push(`En fuite : ${enListe(fuite)}.`);
  if (debout.length) phrases.push(`Encore debout : ${enListe(debout)}.`);
  for (const h of c.heros || []) {
    const etat = etatHeros(h);
    const cartons = CARACS_CARTON.filter(([k]) => CARTONS[h.cartons?.[k]]).map(([k, nom]) => `${h.cartons[k]} en ${nom}`);
    const morceaux = [];
    if (etat === "coma") morceaux.push(`dans le coma (${h.sante})`);
    if (etat === "mort") morceaux.push(`au repère de mort (${h.sante})`);
    if (etat === "debout" && h.sante < h.max) morceaux.push(`${h.sante} Santé sur ${h.max}`);
    const p = psyDe(h);
    if (typeof h.psy === "number" && p.psy !== p.psyMax) morceaux.push(`${p.psy} Psy sur ${p.psyMax}`);
    if (p.santeDon) morceaux.push(`${p.santeDon} point${p.santeDon > 1 ? "s" : ""} de Santé payé${p.santeDon > 1 ? "s" : ""} faute de Psy`);
    if (cartons.length) morceaux.push(`carton ${enListe(cartons)}`);
    if (morceaux.length) phrases.push(`${prenom(h.nom)} : ${morceaux.join(", ")}.`);
  }
  if (c.strat) phrases.push("Point strat pris.");
  return phrases.join(" ").slice(0, 1990);
}
