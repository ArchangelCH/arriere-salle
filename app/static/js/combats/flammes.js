// Le feu qui compte en combat : quand la main passe à un combattant dont le pion se tient dans les flammes d'un plan, le
// suivi du combat et le tableau du MJ le rappellent pour ce tour, avec l'effet écrit dans l'outil Feu du plan
// (plan.feu_effet, vide par défaut). Seuls Flammes et Brasier comptent, dans le feu du moment (plan.feu : l'étape
// rappelée, retouches comprises, celui que voit la TV) ; ni les braises (le feu prend, ou retombe), ni le calciné.
// Les plans du combat : celui qu'une scène de la séance lie à sa rencontre (Préparer › Lier), celui de la TV, et les
// autres plans du même lieu qui ont du feu (les étages d'une maison qui brûle). Pas celui où les adversaires sont posés
// (planDe) : il se devine à leurs noms, et les mêmes troupes attendent parfois sur plusieurs plans. Un combattant sans
// pion sur ces plans, ou qui en a plus d'un (monté à l'étage et resté en bas), n'est pas rappelé : mieux vaut rien
// qu'un rappel faux. Fonctions pures, sauf FeuDuCombat ; outils/verifier_flammes.mjs les vérifie.

import { api, echapper as e } from "../api.js";
import { planCourant } from "../commun/etat-jeu.js";
import { casesSous } from "../plan/entrer.js";
import { adversairesSurPlan } from "../plan/jauges.js";
import { liensDe } from "../seances/liens-scene.js";
import { ENNEMIS, herosDe, horsDeCombat, nomAdversaire, prenom } from "./suivi.js";

// Les valeurs de plan.feu qui comptent (plan/modele.js, FEUX) : 2 flammes, 3 brasier.
export const FLAMMES = 2;
export const BRASIER = 3;
export const EFFET_MAX = 160;

const place = (t) => !!t && Number.isFinite(t.x) && Number.isFinite(t.y);

// Le feu sous un pion : la plus forte des flammes des cases qu'il couvre (un grand pion en couvre quatre ou neuf), sur un
// sol ; 0 s'il n'y en a pas. Un pion caché compte aussi : il est là, seulement invisible sur la TV.
export function flammesSous(plan, t) {
  const w = plan?.largeur;
  const h = plan?.hauteur;
  if (!place(t) || !Array.isArray(plan.feu) || plan.feu.length !== w * h) return 0;
  const sol = Array.isArray(plan.sol) ? plan.sol : [];
  let fort = 0;
  for (const [x, y] of casesSous(t)) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const v = plan.feu[y * w + x];
    if ((v === FLAMMES || v === BRASIER) && sol[y * w + x] && v > fort) fort = v;
  }
  return fort;
}

// Le plan que montre la TV : celui de la vue plan, ou celui qu'une image montrée depuis une fiche recouvre.
export function planDeLaTv(t) {
  if (!t || typeof t !== "object") return null;
  if (t.vue === "plan") return t.plan || null;
  if (t.vue === "image" && t.avant?.vue === "plan") return t.avant.plan || t.plan || null;
  return null;
}

// Le plan brûle-t-il, ou brûlera-t-il (une étape préparée) ?
function aDuFeu(p) {
  const grilles = [p.feu, ...(Array.isArray(p.etapes) ? p.etapes.map((et) => et?.feu) : [])];
  return grilles.some((f) => Array.isArray(f) && f.some((v) => v >= 1 && v <= 4));
}

// Les plans où chercher les combattants (voir en tête).
export function plansDuCombat(c, plans, { seance = null, tv = null } = {}) {
  const liste = Array.isArray(plans) ? plans.filter((p) => p && p.id) : [];
  const ids = new Set();
  for (const d of seance?.deroule || []) {
    const l = liensDe(d);
    if (l.plan && l.rencontre && l.rencontre === c.rencontre) ids.add(l.plan);
  }
  if (tv) ids.add(tv);
  const lieux = new Set(liste.filter((p) => ids.has(p.id) && p.lieu).map((p) => p.lieu));
  return liste.filter((p) => ids.has(p.id) || (p.lieu && lieux.has(p.lieu) && aDuFeu(p)));
}

export const effetDuFeu = (p) => (typeof p?.feu_effet === "string" ? p.feu_effet.trim().slice(0, EFFET_MAX) : "");

// L'étape rappelée en dernier, « retouchée » si le feu a changé depuis (comme la barre Étapes de l'éditeur).
function nomEtape(p) {
  const et = Number.isInteger(p.etape) && Array.isArray(p.etapes) ? p.etapes[p.etape] : null;
  if (!et) return "";
  const nom = typeof et.nom === "string" && et.nom.trim() ? et.nom.trim() : `Étape ${p.etape + 1}`;
  const meme = Array.isArray(et.feu) && Array.isArray(p.feu) && et.feu.length === p.feu.length && et.feu.every((v, k) => (v || 0) === (p.feu[k] || 0));
  return meme ? nom : `${nom}, retouchée`;
}

// Les rappels de la main en cours, un par plan : ceux qui agissent et se tiennent dans les flammes. Le héros à qui est la
// main ; quand elle est aux adversaires, ceux qui sont encore debout. Rend [{ noms, niveau, plan: { id, nom }, etape,
// effet }].
export function rappelsFlammes(c, plans, contexte = {}) {
  const entree = c?.ordre?.[c.actif];
  if (!entree) return [];
  const qui = entree === ENNEMIS
    ? (c.adversaires || []).filter((a) => !horsDeCombat(a)).map((a) => ({ adversaire: a, nom: nomAdversaire(a) }))
    : [herosDe(c, entree)].filter(Boolean).map((h) => ({ heros: h, nom: prenom(h.nom) || h.nom }));
  if (!qui.length) return [];
  const candidats = plansDuCombat(c, plans, contexte).map((p) => {
    const adv = new Map();
    for (const [id, a] of adversairesSurPlan(p, c)) adv.set(a.id, (p.pions || []).find((t) => t.id === id));
    return { p, adv };
  });
  const parPlan = new Map();
  for (const x of qui) {
    const places = [];
    for (const { p, adv } of candidats) {
      const siens = x.heros ? (p.pions || []).filter((t) => t.ref === `aventurier:${x.heros.id}`) : [adv.get(x.adversaire.id)];
      for (const t of siens) if (place(t)) places.push({ p, t });
    }
    // Aucun pion, ou plus d'un : rien plutôt qu'un rappel faux.
    if (places.length !== 1) continue;
    const { p, t } = places[0];
    const niveau = flammesSous(p, t);
    if (!niveau) continue;
    if (!parPlan.has(p.id)) parPlan.set(p.id, { noms: [], niveau: 0, p });
    const g = parPlan.get(p.id);
    g.noms.push(x.nom);
    g.niveau = Math.max(g.niveau, niveau);
  }
  return [...parPlan.values()].map(({ noms, niveau, p }) => ({
    noms, niveau, plan: { id: p.id, nom: typeof p.nom === "string" && p.nom.trim() ? p.nom.trim() : "Plan sans nom" }, etape: nomEtape(p), effet: effetDuFeu(p),
  }));
}

const enListe = (noms) => (noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}` : noms[0] || "");
export const phraseFlammes = (noms) => `${enListe(noms)} ${noms.length > 1 ? "sont" : "est"} dans les flammes`;

// Le rappel, sous le tour : la phrase, l'effet du plan s'il est écrit, puis d'où il vient (le plan, son étape, le
// brasier).
export function htmlFlammes(rappels) {
  return rappels.map((r) => {
    const ou = [`<a href="#/plan/${e(r.plan.id)}" title="Ouvrir le plan">${e(r.plan.nom)}</a>`, r.etape && e(r.etape), r.niveau === BRASIER && "brasier",
      !r.effet && "effet à écrire dans l'outil Feu du plan"].filter(Boolean).join(" · ");
    return `<p class="rappel flammes"><b>${e(phraseFlammes(r.noms))}</b>${r.effet ? ` : ${e(r.effet)}` : "."}<small class="origine">${ou}</small></p>`;
  }).join("");
}

// La main d'un combat : elle passe quand le rang ou le tour changent, ou quand un autre combat commence.
const main = (c) => (c && Array.isArray(c.ordre) && c.ordre.length ? `${c.id}:${c.tour}:${c.actif}` : "");

// Ce que le combat relit pour ses rappels : les plans et l'état de la TV, chaque fois que la main passe (ici ou sur un
// autre écran), à l'ouverture du combat et au retour sur la page. Le plan ouvert dans l'éditeur de cette page (le
// tableau du MJ à côté du plan) passe avant sa copie du serveur, et le rappel le suit : un pion qu'on vient de bouger,
// une étape rappelée ou l'effet réécrit comptent dans la seconde.
export class FeuDuCombat {
  constructor(surLecture) {
    this.surLecture = surLecture;
    this.lus = null; // { main, plans, tv }
    this.attendue = ""; // la main dont la lecture est en route
    this.montre = null; // le dernier rappel rendu : { c, contexte, html }
    this.veille = 0;
  }

  suivre(c, force = false) {
    const m = main(c);
    if (!m) {
      this.lus = null;
      this.attendue = "";
      return;
    }
    if (!force && (this.lus?.main === m || this.attendue === m)) return;
    this.attendue = m;
    Promise.all([api.get("/api/plans"), api.get("/api/table").catch(() => null)])
      .then(([plans, table]) => {
        if (this.attendue !== m) return;
        this.attendue = "";
        this.lus = { main: m, plans: Array.isArray(plans) ? plans : [], tv: planDeLaTv(table) };
        this.surLecture();
      })
      .catch(() => {
        if (this.attendue === m) this.attendue = "";
      });
  }

  calculer(c, contexte) {
    const vivant = planCourant();
    const plans = vivant ? this.lus.plans.map((p) => (p.id === vivant.id ? vivant : p)) : this.lus.plans;
    return htmlFlammes(rappelsFlammes(c, plans, { ...contexte, tv: this.lus.tv }));
  }

  html(c, contexte) {
    if (!this.lus || this.lus.main !== main(c)) {
      this.montre = null;
      return "";
    }
    const html = this.calculer(c, contexte);
    this.montre = { c, contexte, html };
    if (!this.veille) this.veille = setInterval(() => this.veiller(), 1000);
    return html;
  }

  // Une fois par seconde, si un plan est ouvert sur cette page : le rappel a-t-il changé avec lui ?
  veiller() {
    const m = this.montre;
    if (!m || !planCourant() || !this.lus || this.lus.main !== main(m.c)) return;
    if (this.calculer(m.c, m.contexte) !== m.html) this.surLecture();
  }

  arreter() {
    clearInterval(this.veille);
    this.veille = 0;
    this.montre = null;
  }
}
