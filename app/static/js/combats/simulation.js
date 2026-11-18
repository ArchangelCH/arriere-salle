// Simulation de combats selon les règles du kit : D100 sous la valeur, défenses selon la posture, critique au maximum
// et impossible à parer, coma à 0, mort à moins la Santé maximum (jamais avant -10). Des milliers de combats pour une moyenne.
// Ne sont pas simulés : dons, soins, dés d'aventure, avantages, terrain. Ils jouent presque tous pour le groupe.
// Le hasard se passe en option (hasard : une fonction qui rend un nombre entre 0 et 1) pour rejouer une étude à l'identique.

export function lireDes(expr) {
  const m = /^\s*(\d*)\s*[dD]\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/.exec(String(expr ?? ""));
  if (m) return { n: +(m[1] || 1), f: +m[2], b: m[3] ? (m[3] === "-" ? -1 : 1) * +m[4] : 0 };
  const k = parseInt(expr, 10);
  return Number.isFinite(k) ? { n: 0, f: 0, b: k } : { n: 1, f: 6, b: 0 };
}
const maximum = (d) => d.n * d.f + d.b;

// Un générateur à graine (mulberry32) : même graine, mêmes combats.
export function hasardAGraine(graine) {
  let s = graine >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// « 8 × PJ » : Santé d'un boss selon le nombre d'aventuriers.
export function lireSante(v) {
  const m = /(\d+)\s*[×x*]\s*PJ/i.exec(String(v ?? ""));
  if (m) return { parPJ: +m[1] };
  return { fixe: Math.max(1, parseInt(v, 10) || 1) };
}

// La Santé d'un adversaire face à ce groupe. Contre des aventuriers de niveau 1, un boss n'a que 7 Santé par
// aventurier (bestiaire du kit).
export function santeAdversaire(v, nbPj, niveau) {
  const s = lireSante(v);
  const parPJ = s.parPJ ? (niveau <= 1 && s.parPJ === 8 ? 7 : s.parPJ) : 0;
  return { sante: parPJ ? parPJ * nbPj : s.fixe, parPJ };
}

// Règle du MJ : une défense en défensive, aucune en offensive ni en focus ; +5 % à tous les tests en focus.
const DEFENSES_POSTURE = { offensive: 0, defensive: 1, focus: 0, aucune: 0 };
const BONUS_FOCUS = 5;

function preparerPj(p, style) {
  const posture = style === "offensif" ? "offensive" : p.posture || "focus";
  const sante = Math.max(1, Math.round(+p.sante || 1));
  return {
    pj: true, nom: p.nom, att: (+p.att || 0) + (posture === "focus" ? BONUS_FOCUS : 0), des: lireDes(p.degats), armure: +p.armure || 0, bouclier: +p.bouclier || 0,
    defense: +p.defense || 0, nbDef: DEFENSES_POSTURE[posture] ?? 0, posture, sante, max: sante, attaques: 1,
  };
}

function preparerAdversaire(a, nbPj, niveau) {
  const { sante } = santeAdversaire(a.sante, nbPj, niveau);
  return {
    pj: false, nom: a.nom, cle: a.cle, rang: a.rang, att: +a.att || 0, des: lireDes(a.degats), armure: +a.armure || 0, bouclier: +a.bouclier || 0,
    // Un adversaire à bouclier se bat en posture défensive (le Paladin du bestiaire) : le bouclier compte dans son armure.
    defense: +a.defense || 0, nbDef: +a.nbDef || 0, posture: a.posture || (+a.bouclier ? "defensive" : "focus"), sante, max: sante,
    attaques: +a.attaques || 1, regen: +a.regen || 0, ignoreArmure: !!a.ignoreArmure, recharge: !!a.recharge, lent: !!a.lent,
    meute: !!a.meute, drain: +a.drain || 0, jugement: +a.jugement || 0, souffle: a.souffle || "", sbire: a.rang === "sbire",
    sansPeur: !!a.sansPeur,
  };
}

const debout = (c) => c.sante > 0 && !c.enFuite;

function attaquer(h, a, c, bonus = 0) {
  const offensive = a.posture === "offensive";
  const r = 1 + Math.floor(h() * 100);
  if (r >= (offensive ? 91 : 96)) return;
  const critique = r <= (offensive ? 10 : 5);
  if (!critique && r > a.att + bonus) return;
  if (!critique && c.restantes > 0 && c.defense > 0) {
    c.restantes--;
    const rd = 1 + Math.floor(h() * 100);
    if (rd <= 5 || (rd <= c.defense && rd < 96)) return;
  }
  let degats = offensive || critique ? maximum(a.des) : lancer(h, a.des);
  if (a.jugement && !a.jugementFait) {
    degats += a.jugement;
    a.jugementFait = true;
  }
  const armure = a.ignoreArmure ? 0 : c.armure + (c.posture === "defensive" ? c.bouclier : 0);
  const perte = Math.max(0, degats - armure);
  c.sante -= perte;
  if (a.drain && perte > 0) a.sante = Math.min(a.max, a.sante + a.drain);
}

function lancer(h, d) {
  let t = d.b;
  for (let i = 0; i < d.n; i++) t += 1 + Math.floor(h() * d.f);
  return t;
}

// Un combat : renvoie { victoire, indecis, tours, auTapis, morts }. Un combat qui dure encore après toursMax tours est
// indécis : ni victoire, ni défaite (un troll qui régénère plus vite qu'on ne le blesse, par exemple).
export function combat(groupe, adversaires, { avant = 2, style = "fiches", moral = true, niveau = 1, toursMax = 40, hasard = Math.random } = {}) {
  const h = hasard;
  const pjs = groupe.map((p) => preparerPj(p, style));
  const nbPj = pjs.length;
  const ennemis = adversaires.flatMap((a) => Array.from({ length: Math.max(0, a.n | 0) }, () => preparerAdversaire(a, nbPj, niveau)));
  // Les joueurs choisissent qui agit avant l'ennemi : les plus dangereux.
  const force = (p) => (p.att / 100) * maximum(p.des);
  const ordrePj = pjs.slice().sort((a, b) => force(b) - force(a));
  // Le moral des sbires : ils fuient quand la moitié d'entre eux tombe. Les morts-vivants et les armures animées, sans peur, restent.
  const peureux = ennemis.filter((e) => e.sbire && !e.sansPeur);
  const fini = () => !ennemis.some(debout) || !pjs.some(debout);
  const auHasard = (liste) => liste[Math.floor(h() * liste.length)];
  let tour = 0;
  while (tour < toursMax && !fini()) {
    tour++;
    for (const c of [...pjs, ...ennemis]) c.restantes = c.nbDef;
    for (const e of ennemis) if (e.regen && e.sante > 0) e.sante = Math.min(e.max, e.sante + e.regen);
    // Une bête de meute choisit sa proie pour le tour : son bonus compte les autres, debout, au contact de la même cible.
    for (const e of ennemis) if (e.meute) e.cible = debout(e) ? auHasard(pjs.filter(debout)) : null;
    const agirPj = (p) => {
      if (!debout(p)) return;
      const cibles = ennemis.filter(debout);
      if (!cibles.length) return;
      attaquer(h, p, cibles.reduce((a, b) => (b.sante < a.sante ? b : a)));
      if (moral && peureux.length >= 2) {
        const tombes = peureux.filter((e) => e.sante <= 0).length;
        if (tombes * 2 >= peureux.length) for (const e of peureux) if (e.sante > 0) e.enFuite = true;
      }
    };
    const agirEnnemi = (e) => {
      if (!debout(e) || (e.recharge && tour % 2 === 0)) return;
      // Le souffle du dragon est magique : l'armure ordinaire n'y peut rien.
      if (e.souffle && tour % 3 === 0) {
        const d = lireDes(e.souffle);
        for (const p of pjs.filter(debout)) p.sante -= lancer(h, d);
        return;
      }
      for (let k = 0; k < e.attaques; k++) {
        const cibles = pjs.filter(debout);
        if (!cibles.length) return;
        if (!e.meute) {
          attaquer(h, e, auHasard(cibles));
          continue;
        }
        if (!e.cible || !debout(e.cible)) e.cible = auHasard(cibles);
        const autour = ennemis.filter((x) => x !== e && x.meute && debout(x) && x.cible === e.cible).length;
        attaquer(h, e, e.cible, Math.min(20, 10 * autour));
      }
    };
    const vivants = ordrePj.filter(debout);
    for (const p of vivants.slice(0, avant)) agirPj(p);
    for (const e of ennemis) if (!e.lent) agirEnnemi(e);
    for (const p of vivants.slice(avant)) agirPj(p);
    for (const e of ennemis) if (e.lent) agirEnnemi(e);
  }
  const victoire = !ennemis.some(debout) && pjs.some(debout);
  return {
    victoire,
    indecis: !victoire && pjs.some(debout),
    tours: tour,
    auTapis: pjs.filter((p) => p.sante <= 0).length,
    morts: pjs.filter((p) => p.sante <= -Math.max(p.max, 10)).length,
  };
}

export function etudier(groupe, adversaires, options = {}, n = 2000) {
  let victoires = 0;
  let indecis = 0;
  let tours = 0;
  let tapis = 0;
  let avecMort = 0;
  const repartition = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const r = combat(groupe, adversaires, options);
    victoires += r.victoire;
    indecis += r.indecis;
    tours += r.tours;
    tapis += r.auTapis;
    avecMort += r.morts > 0;
    repartition[Math.min(3, r.auTapis)]++;
  }
  return {
    n, victoire: victoires / n, indecis: indecis / n, defaite: (n - victoires - indecis) / n,
    tours: tours / n, auTapis: tapis / n, mort: avecMort / n,
    repartition: repartition.map((x) => x / n),
  };
}

// Le barème du bestiaire : Facile, Normale, Difficile, Épique ; au-delà, Mortelle, puis Perdue d'avance.
export const VERDICTS = {
  facile: { nom: "Facile", attendre: "Deux à trois tours, presque sans bobo.", angle: -12 },
  normale: { nom: "Normale", attendre: "Quatre à cinq tours, quelques blessures.", angle: -6 },
  difficile: { nom: "Difficile", attendre: "Cinq à six tours, un aventurier au tapis en moyenne.", angle: 1 },
  epique: { nom: "Épique", attendre: "Six à huit tours, deux aventuriers au tapis, une mort possible.", angle: 7 },
  mortelle: { nom: "Mortelle", attendre: "Le groupe gagne le plus souvent, mais quelqu'un risque fort d'y rester.", angle: 12 },
  perdue: { nom: "Perdue d'avance", attendre: "Le groupe perd plus d'une fois sur deux : il lui faut une autre issue que le combat.", angle: 17 },
};

// La part des combats perdus ; une étude enregistrée avant le compte des combats indécis n'a que la victoire.
const defaite = (r) => (r.defaite ?? 1 - r.victoire);

// Chaque critère du barème donne un niveau ; le plus sévère l'emporte. Durée et nombre d'aventuriers au tapis suivent
// les descriptions du bestiaire ; la défaite et la mort ajoutent ce que le barème ne dit pas. Un combat indécis
// (encore en cours après 40 tours) ne compte pas comme perdu.
const NIVEAUX = ["facile", "normale", "difficile", "epique", "mortelle", "perdue"];
export function verdict(r) {
  const d = defaite(r);
  const parDefaite = d > 0.5 ? 5 : d > 0.25 ? 4 : d > 0.1 ? 3 : d > 0.03 ? 2 : 0;
  const t = r.auTapis;
  const parTapis = t < 0.15 ? 0 : t < 0.6 ? 1 : t < 1.4 ? 2 : t < 2.5 ? 3 : 4;
  const m = r.mort;
  const parMort = m < 0.005 ? 0 : m < 0.01 ? 1 : m < 0.04 ? 2 : m < 0.15 ? 3 : 4;
  const parDuree = r.tours < 3.5 ? 0 : r.tours < 5.25 ? 1 : r.tours < 6.5 ? 2 : 3;
  return NIVEAUX[Math.max(parDefaite, parTapis, parMort, parDuree)];
}

// Une note continue pour classer les variantes (plus haut = plus dur).
export function severite(r) {
  return NIVEAUX.indexOf(verdict(r)) * 10 + defaite(r) * 10 + r.auTapis * 1.2 + r.mort * 20 + r.tours * 0.15;
}
