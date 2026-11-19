// Vérifie les pions en figurines sans navigateur (app/static/js/plan/figurine.js, rendu.js) : la place qu'elles prennent,
// l'ordre de dessin (à terre d'abord, de haut en bas, un cavalier après sa monture), qui a la main au combat, et un dessin
// complet de chaque sorte de pion sur un faux canvas qui refuse ce que Chromium 79 (la TV) n'a pas.
// Usage : node outils/verifier_figurines.mjs
import { dessinerFigurine, mainDuCombat, silhouette } from "../app/static/js/plan/figurine.js";
import { dessinerPions, ordreDesFigurines } from "../app/static/js/plan/rendu.js";
import { poserCavaliers } from "../app/static/js/plan/pions.js";

let defauts = 0;
let verifications = 0;
const verifier = (ok, message) => {
  verifications++;
  if (!ok) {
    defauts++;
    console.log(`DÉFAUT : ${message}`);
  }
};
const proche = (a, b) => Math.abs(a - b) < 1e-3;

// ---- La place d'une figurine moyenne : un peu sur la case du dessus, le socle dans la sienne.
const s = silhouette(0.42);
verifier(s.haut < -0.5 && s.haut > -0.7, `le haut du support monte un peu sur la case du dessus (${s.haut.toFixed(3)})`);
verifier(s.bas > 0.42 && s.bas < 0.5, `le bas du socle reste dans sa case (${s.bas.toFixed(3)})`);
verifier(s.demi < 0.5, `le socle tient dans la largeur de sa case (${s.demi.toFixed(3)})`);
verifier(silhouette(0.42, 1.8).bas > s.bas && silhouette(0.42, 0.5).bas < s.bas, "l'épaisseur réglée change le socle");
verifier(proche(silhouette(0.84).haut, 2 * s.haut), "un grand pion, deux fois plus grand");

// ---- L'ordre de dessin.
const pions = [
  { id: "bas", genre: "heros", x: 1.5, y: 3.5 },
  { id: "haut", genre: "ennemi", x: 1.5, y: 1.5 },
  { id: "terre", genre: "ennemi", x: 1.5, y: 5.5, tombe: true },
  { id: "cheval", genre: "autre", x: 4, y: 4, taille: 2 },
  { id: "cavalier", genre: "heros", x: 4, y: 4, monture: "cheval" },
];
const ordre = ordreDesFigurines(poserCavaliers(pions)).map((t) => t.id);
verifier(ordre[0] === "terre", `une figurine à terre se dessine d'abord (${ordre})`);
verifier(ordre.indexOf("haut") < ordre.indexOf("bas"), `de haut en bas (${ordre})`);
verifier(ordre.indexOf("cavalier") === ordre.indexOf("cheval") + 1, `le cavalier juste après sa monture (${ordre})`);

// ---- Qui a la main, d'après le bandeau du combat.
const surPlan = [
  { id: "a", genre: "heros", heros: "j1" }, { id: "b", genre: "heros", heros: "j2" },
  { id: "e1", genre: "ennemi" }, { id: "e2", genre: "ennemi", tombe: true },
];
const ordreTv = [{ genre: "heros", heros: "j1" }, { genre: "ennemis" }, { genre: "heros", heros: "j2" }];
const ids = (x) => (x ? [...x].sort().join(",") : "null");
verifier(ids(mainDuCombat(surPlan, { ordre: ordreTv, actif: 0 })) === "a", "le héros dont c'est le tour");
verifier(ids(mainDuCombat(surPlan, { ordre: ordreTv, actif: 1 })) === "e1", "les ennemis debout quand c'est à eux");
verifier(ids(mainDuCombat(surPlan, { ordre: ordreTv, actif: null })) === "null" && mainDuCombat(surPlan, null) === null, "hors combat, personne");
verifier(ids(mainDuCombat(surPlan, { ordre: [{ genre: "heros" }], actif: 0 })) === "", "un héros sans jeton ne fait luire personne");

// ---- Un faux canvas : il note les appels et refuse ce que la TV n'a pas.
const INTERDITS = new Set(["roundRect", "reset", "letterSpacing"]);
function fauxCanvas() {
  const appels = new Map();
  const degrade = { addColorStop() {} };
  const cible = {
    measureText: (t) => ({ width: String(t).length * 18 }),
    createLinearGradient: () => degrade,
    createRadialGradient: () => degrade,
    createPattern: () => ({}),
    getLineDash: () => [],
  };
  const ctx = new Proxy(cible, {
    get(o, k) {
      if (INTERDITS.has(k)) throw new Error(`${String(k)} : absent de Chromium 79`);
      if (k in o) return o[k];
      return (...args) => {
        appels.set(k, (appels.get(k) || 0) + 1);
        return args.length ? undefined : undefined;
      };
    },
    set(o, k, v) {
      if (INTERDITS.has(k)) throw new Error(`${String(k)} : absent de Chromium 79`);
      o[k] = v;
      return true;
    },
  });
  return { ctx, appels };
}

const image = { complete: true, naturalWidth: 300, naturalHeight: 400 };
const sortes = [
  [{ genre: "heros", couleur: "#000000", nom: "Héros" }, { img: image, eclat: 0.7, leve: 0.4 }],
  [{ genre: "heros", couleur: "#ae00ff", tombe: true }, { img: image, chute: 0.5 }],
  [{ genre: "ennemi", court: "12", forme: "carre" }, { numero: "12", lisible: { numero: 0.6, anneau: 0.15 } }],
  [{ genre: "ennemi", forme: "blason" }, { mystere: true, parchemin: true }],
  [{ genre: "pnj", couleur: "#abc" }, { initiales: "AB", flash: { k: 0.5, rvb: [220, 40, 30] } }],
  [{ genre: "autre", ref: "familier:x", couleur: "#2f7de1" }, { initiales: "L", ep: 1.8 }],
  [{ genre: "autre", familier: true, couleur: "pas une couleur" }, { initiales: "?", ep: 0.5 }],
];
for (const [t, o] of sortes) {
  const { ctx, appels } = fauxCanvas();
  let erreur = null;
  try {
    dessinerFigurine(ctx, { id: "p", x: 1, y: 1, ...t }, 1, 1, 0.42, o);
  } catch (e) {
    erreur = e.message;
  }
  verifier(!erreur, `la figurine ${JSON.stringify(t)} se dessine (${erreur})`);
  verifier((appels.get("fill") || 0) > 3 && (appels.get("ellipse") || 0) >= 2, `la figurine ${JSON.stringify(t)} a un socle et un support`);
}

// ---- Un plan entier, vu du MJ puis de la TV, avec ce que la maquette ne montrait pas.
const plan = {
  largeur: 10, hauteur: 8, brouillard_actif: false, pions: [
    { id: "h", genre: "heros", nom: "Tavarède", couleur: "#ae00ff", heros: "j1", x: 1.5, y: 1.5, jauges: { sante: 0.5, psy: 0.2, coma: false, cartons: [{ carac: "physique", couleur: "jaune" }], avantage: "avantage", posture: "focus" } },
    { id: "f", genre: "autre", nom: "Brindille", familier: true, maitre: "h", couleur: "#ae00ff", x: 2.5, y: 1.5, taille: 0.6 },
    { id: "g", genre: "ennemi", court: "3", x: 4.5, y: 2.5, groupe: 5, etats: ["en-feu", "etourdi", "maudit", "entrave"] },
    { id: "c", genre: "ennemi", court: "4", x: 5.5, y: 2.5, cache: true },
    { id: "m", genre: "autre", nom: "Cheval", x: 7, y: 5, taille: 2 },
    { id: "r", genre: "heros", nom: "Cavalier", x: 7, y: 5, monture: "m" },
    { id: "e", genre: "pnj", nom: "Aubergiste", etiquette: "chef", x: 2.5, y: 6.5, taille: 3, forme: "blason", epaisseur: 0.5 },
  ],
};
const zone = { x0: 0, y0: 0, x1: 10, y1: 8 };
for (const [nom, o] of [
  ["vue du MJ", { joueurs: false, selection: ["h", "g"] }],
  ["TV", { joueurs: true, lisible: { nom: 0.8, nomMin: 0.6, numero: 0.6, anneau: 0.15, barre: 0.3, carton: 0.8, jeton: 0.8 }, noms: new Map([["h", 0.8]]) }],
  ["parchemin", { joueurs: false, style: "parchemin" }],
  ["animée", { joueurs: true, animations: new Map([["h", { eclat: 1, leve: 0.3, flash: { k: 1, rvb: [70, 190, 90] } }], ["g", { secousse: 0.5, poussiere: 0.4, chute: 0.2 }]]) }],
]) {
  const { ctx } = fauxCanvas();
  let erreur = null;
  let barres = null;
  try {
    barres = dessinerPions(ctx, { ...plan, pions: poserCavaliers(plan.pions) }, zone, o);
  } catch (e) {
    erreur = e.stack;
  }
  verifier(!erreur, `le plan se dessine (${nom}) : ${erreur}`);
  verifier(Array.isArray(barres) && barres.length === 1, `une plaque de barres, celle du héros (${nom})`);
}

console.log(defauts ? `${defauts} défaut(s) sur ${verifications} vérifications` : `Aucun défaut (${verifications} vérifications)`);
process.exit(defauts ? 1 : 0);
