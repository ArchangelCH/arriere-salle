// Rejoue les générateurs de plans sur des centaines de graines : toute case de sol libre s'atteint depuis l'entrée
// (un mur ne se passe que par une porte ; l'eau profonde et la falaise, par un pont ou une barque), aucun meuble qui
// barre le passage ne bouche une porte, et dans la crypte le trésor est un cul-de-sac derrière sa seule porte secrète,
// qui ne s'ouvre pas au bout d'un couloir sans issue. Pour les plans extérieurs, en plus : la même graine donne le même
// plan, l'entrée est la pièce 1, chaque bâtiment a sa porte (qui ne donne ni sur l'eau ni sur la falaise), chaque zone
// est d'un seul tenant, et le dehors se découpe en zones de taille raisonnable (on ne le révèle jamais d'un coup).
// Usage : node outils/verifier_plans.mjs [nombre de graines, 500 par défaut] [nombre pour les extérieurs, 300 par défaut]
import { MODELES, generer } from "../app/static/js/plan/generateurs.js";
import { MEUBLES, SOLS_INFRANCHISSABLES, calculerMurs, casesArete, cleArete, emprise } from "../app/static/js/plan/modele.js";
import { atteignables } from "../app/static/js/plan/deplacement.js";

const N = +(process.argv[2] || 500);
const N_DEHORS = +(process.argv[3] || 300);
const ZONE_MAX = 240; // cases d'une zone extérieure, au plus
const COTES = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];

function analyser(p, estDehors = false) {
  const { largeur: w, hauteur: h } = p;
  const n = w * h;
  const murs = calculerMurs(p);
  const bloque = new Uint8Array(n);
  const defauts = {};
  const compter = (k) => (defauts[k] = (defauts[k] || 0) + 1);
  for (const o of p.objets) {
    if (MEUBLES[o.cle]?.franchissable) continue;
    const b = emprise(o);
    for (let y = b.y0; y < b.y1; y++) {
      for (let x = b.x0; x < b.x1; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h || !p.sol[y * w + x]) compter("meuble hors du sol");
        else if (bloque[y * w + x]) compter("meubles l'un sur l'autre");
        else bloque[y * w + x] = 1;
      }
    }
  }
  // Sous un pont, un ponton, une barque : on marche, même sur l'eau profonde.
  const dessus = new Uint8Array(n);
  for (const o of p.objets) {
    if (!MEUBLES[o.cle]?.passage) continue;
    const b = emprise(o);
    for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) if (x >= 0 && y >= 0 && x < w && y < h) dessus[y * w + x] = 1;
  }
  const portes = new Map(p.portes.map((d) => [cleArete(d.sens, d.x, d.y), d]));
  const libre = (i) => p.sol[i] && !bloque[i] && (!SOLS_INFRANCHISSABLES.has(p.sol[i]) || dessus[i]);
  const passe = (x, y, dx, dy, bit, secretes) => {
    if (!(murs[y * w + x] & bit)) return true;
    const d = portes.get(dx ? cleArete("v", Math.max(x, x + dx), y) : cleArete("h", x, Math.max(y, y + dy)));
    return !!d && d.genre !== "fenetre" && (secretes || d.genre !== "secrete");
  };
  let depart = p.piece.findIndex((v, i) => v === 1 && libre(i));
  if (depart < 0) depart = p.sol.findIndex((v, i) => libre(i));
  const parcourir = (secretes) => {
    const vu = new Uint8Array(n);
    const pile = [depart];
    vu[depart] = 1;
    while (pile.length) {
      const i = pile.pop();
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy, bit] of COTES) {
        const nx = x + dx;
        const ny = y + dy;
        const j = ny * w + nx;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || vu[j] || !libre(j) || !passe(x, y, dx, dy, bit, secretes)) continue;
        vu[j] = 1;
        pile.push(j);
      }
    }
    return vu;
  };
  const tout = parcourir(true);
  for (let i = 0; i < n; i++) if (libre(i) && !tout[i]) compter("case de sol inaccessible");
  for (const d of p.portes) {
    if (d.genre === "fenetre") continue;
    for (const [x, y] of casesArete(d.sens, d.x, d.y)) if (x >= 0 && y >= 0 && x < w && y < h && p.sol[y * w + x] && bloque[y * w + x]) compter("porte bouchée");
  }
  for (const d of p.portes) {
    if (d.genre === "fenetre") continue;
    for (const [x, y] of casesArete(d.sens, d.x, d.y)) if (x >= 0 && y >= 0 && x < w && y < h && p.sol[y * w + x] && SOLS_INFRANCHISSABLES.has(p.sol[y * w + x]) && !dessus[y * w + x]) compter("porte sur l'eau ou la falaise");
  }
  const genre = new Map(p.pieces.map((q) => [q.id, q.genre || "salle"]));
  if (estDehors) dehors(p, genre, portes, bloque, compter);
  const nom = (i) => p.pieces.find((q) => q.id === p.piece[i])?.nom || "";
  const tresor = p.pieces.find((q) => q.nom === "Trésor");
  if (tresor) {
    const sansSecret = parcourir(false);
    for (let i = 0; i < n; i++) {
      if (!libre(i) || sansSecret[i] || !tout[i]) continue;
      if (!["Trésor", "Passage secret"].includes(nom(i))) compter("salle ou couloir derrière le trésor");
    }
    for (let i = 0; i < n; i++) if (p.piece[i] === tresor.id && sansSecret[i]) compter("trésor atteint sans la porte secrète");
    const secretes = p.portes.filter((d) => d.genre === "secrete");
    if (secretes.length !== 1) compter("pas une seule porte secrète");
    for (const d of secretes) {
      for (const [x, y] of casesArete(d.sens, d.x, d.y)) {
        const i = y * w + x;
        if (!sansSecret[i] || !/^Couloir/.test(nom(i))) continue;
        // Du côté ordinaire, le couloir doit continuer ailleurs que vers la porte secrète.
        let sorties = 0;
        for (const [dx, dy, bit] of COTES) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !p.sol[ny * w + nx]) continue;
          if (cleArete(...(dx ? ["v", Math.max(x, nx), y] : ["h", x, Math.max(y, ny)])) === cleArete(d.sens, d.x, d.y)) continue;
          if (passe(x, y, dx, dy, bit, false)) sorties++;
        }
        if (sorties <= 1) compter("porte secrète au bout d'un couloir sans issue");
      }
    }
    // Un couloir se révèle d'un clic : chaque pièce de couloir est d'un seul tenant.
    for (const q of p.pieces.filter((z) => /^Couloir|^Passage/.test(z.nom))) {
      const cases = [];
      for (let i = 0; i < n; i++) if (p.sol[i] && p.piece[i] === q.id) cases.push(i);
      const dans = new Set(cases);
      const vu = new Set([cases[0]]);
      const pile = [cases[0]];
      while (pile.length) {
        const i = pile.pop();
        for (const [dx, dy] of COTES) {
          const x = (i % w) + dx;
          const y = Math.floor(i / w) + dy;
          const j = y * w + x;
          if (x >= 0 && y >= 0 && x < w && y < h && dans.has(j) && !vu.has(j)) {
            vu.add(j);
            pile.push(j);
          }
        }
      }
      if (vu.size !== cases.length) compter("couloir en morceaux");
    }
  }
  return defauts;
}

// Les plans extérieurs : chaque bâtiment (une salle) a une porte sur son pourtour, chaque pièce est d'un seul tenant,
// aucune zone extérieure n'est trop grande, l'entrée (pièce 1) est dehors, et aucun meuble qui barre ne chevauche deux
// pièces dont une salle (il passerait le mur).
function dehors(p, genre, portes, bloque, compter) {
  const { largeur: w, hauteur: h } = p;
  const n = w * h;
  if (genre.get(1) !== "exterieur") compter("l'entrée n'est pas la pièce 1, dehors");
  const cases = new Map();
  for (let i = 0; i < n; i++) if (p.sol[i]) (cases.get(p.piece[i]) || cases.set(p.piece[i], []).get(p.piece[i])).push(i);
  const zones = [...cases.keys()].filter((id) => genre.get(id) === "exterieur");
  if (zones.length < 3) compter("moins de trois zones dehors");
  for (const [id, liste] of cases) {
    if (genre.get(id) === "exterieur" && liste.length > ZONE_MAX) compter("zone extérieure trop grande");
    const dans = new Set(liste);
    const vu = new Set([liste[0]]);
    const pile = [liste[0]];
    while (pile.length) {
      const i = pile.pop();
      for (const [dx, dy] of COTES) {
        const x = (i % w) + dx;
        const y = Math.floor(i / w) + dy;
        const j = y * w + x;
        if (x >= 0 && y >= 0 && x < w && y < h && dans.has(j) && !vu.has(j)) {
          vu.add(j);
          pile.push(j);
        }
      }
    }
    if (vu.size !== liste.length) compter("pièce en morceaux");
    if (genre.get(id) !== "salle") continue;
    // Une porte (pas une fenêtre) sur une arête entre cette salle et autre chose.
    let porte = false;
    for (const d of p.portes) {
      if (d.genre === "fenetre") continue;
      const [[ax, ay], [bx, by]] = casesArete(d.sens, d.x, d.y);
      const a = ax >= 0 && ay >= 0 && ax < w && ay < h ? p.piece[ay * w + ax] : 0;
      const b = bx >= 0 && by >= 0 && bx < w && by < h ? p.piece[by * w + bx] : 0;
      if ((a === id) !== (b === id)) porte = true;
    }
    if (!porte) compter("bâtiment sans porte");
  }
  for (const o of p.objets) {
    if (MEUBLES[o.cle]?.franchissable) continue;
    const b = emprise(o);
    const ids = new Set();
    for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) if (x >= 0 && y >= 0 && x < w && y < h) ids.add(p.piece[y * w + x]);
    if (ids.size > 1 && [...ids].some((id) => genre.get(id) === "salle")) compter("meuble à cheval sur un mur");
  }
  void portes;
  void bloque;
}

const sansIds = (q) => JSON.stringify({ ...q, portes: q.portes.map(({ id, ...d }) => d), objets: q.objets.map(({ id, ...o }) => o) });

let echecs = 0;
const tailles = {};
for (const { cle, dehors: estDehors } of MODELES.filter((m) => m.cle !== "vierge")) {
  const plans = {};
  const exemples = {};
  for (let k = 1; k <= (estDehors ? N_DEHORS : N); k++) {
    const graine = (k * 7919) % 1000003;
    const p = generer(cle, graine);
    const defauts = analyser(p, estDehors);
    if (estDehors) {
      if (sansIds(p) !== sansIds(generer(cle, graine))) defauts["la même graine donne un autre plan"] = 1;
      const t = (tailles[cle] ||= { cases: 0, zones: 0, batiments: 0, meubles: 0, n: 0, max: 0 });
      t.n++;
      t.cases = Math.max(t.cases, p.largeur * p.hauteur);
      t.zones += p.pieces.filter((q) => q.genre === "exterieur").length;
      t.batiments += p.pieces.filter((q) => q.genre === "salle").length;
      t.meubles += p.objets.length;
    }
    for (const defaut of Object.keys(defauts)) {
      plans[defaut] = (plans[defaut] || 0) + 1;
      exemples[defaut] ??= graine;
    }
  }
  const liste = Object.entries(plans);
  echecs += liste.length;
  const t = tailles[cle];
  const moyennes = t ? ` (${t.cases} cases au plus, en moyenne ${(t.zones / t.n).toFixed(1)} zones, ${(t.batiments / t.n).toFixed(1)} bâtiments, ${Math.round(t.meubles / t.n)} meubles)` : "";
  console.log(`${cle.padEnd(14)} ${estDehors ? N_DEHORS : N} graines${moyennes} : ${liste.length ? liste.map(([d, c]) => `${d} dans ${c} plan${c > 1 ? "s" : ""} (graine ${exemples[d]})`).join(" ; ") : "rien à signaler"}`);
}
// Chaque pièce du mobilier dans un couloir d'une case de large, sur la projection publique : celle qui barre le passage
// (pas « franchissable ») coupe le couloir, les autres se traversent ; un pont ou une barque (« passage ») posés sur
// une rivière la font franchir ; une pièce cachée n'est pas dans la projection, elle ne barre rien.
const couloir = (objets) => ({
  largeur: 9, hauteur: 1, sol: Array(9).fill(2), murs: [9, 5, 5, 5, 5, 5, 5, 5, 7], brouillard: Array(9).fill(1), brouillard_actif: true,
  portes: [], objets: objets.filter((o) => !o.cache), pions: [{ id: "moi", genre: "heros", x: 0.5, y: 0.5 }],
});
const auBout = (objets) => atteignables(couloir(objets), { pion: "moi", depart: [0, 0] }).has("8,0");
const mobilier = [];
for (const [cle, m] of Object.entries(MEUBLES)) {
  const o = { id: "o", cle, x: 4, y: 0, l: 1, h: 1 };
  if (auBout([o]) !== !!m.franchissable) mobilier.push(`${cle} ${m.franchissable ? "barre" : "se traverse"} à tort`);
  if (auBout([{ ...o, cache: true }]) !== true) mobilier.push(`${cle} caché barre le couloir`);
  if (m.passage && !auBout([{ id: "r", cle: "riviere", x: 4, y: 0, l: 1, h: 1 }, o])) mobilier.push(`${cle} n'enjambe pas la rivière`);
}
echecs += mobilier.length;
console.log(`mobilier       ${Object.keys(MEUBLES).length} pièces dans un couloir : ${mobilier.length ? mobilier.join(" ; ") : "chacune barre ou laisse passer comme le dit MOBILIER"}`);
process.exit(echecs ? 1 : 0);
