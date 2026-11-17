// « Proposer les liens », dans Préparer : pour chaque scène du déroulé, ce que son titre et le scénario relié laissent
// deviner. Le plan et l'ambiance dont le nom répond au titre de la scène ; les PNJ, la rencontre et, s'il est seul, le plan
// que lie le chapitre du même titre. Rien ne se pose sans le MJ : chaque proposition attend sous sa scène, ce qui ne
// convient pas se décoche, « Accepter » pose le reste. Seul ce qui manque à la scène est proposé.

import { echapper as e, toast } from "../api.js";
import { scenarioDe, simplifier } from "./avant-de-jouer.js";
import { htmlLier, lier, liensDe, marqueSort } from "./liens-scene.js";

const MOTS_VIDES = new Set(`le la les de des du un une et au aux en sur sous dans avec pour par puis ou ni que qui dont ce cet
  cette ces son sa ses leur leurs il elle ils elles on nous vous pas plus tres apres avant chez vers entre contre sans scene
  scenes chapitre premier premiere seance fin pause installation suite partie`.split(/\s+/).filter(Boolean));

// Des mots de moment, trop courants pour qu'un seul suffise : « La nuit au camp » ne répond pas à « La nuit des cendres ».
const MOMENTS = new Set(["nuit", "soir", "soiree", "matin", "jour", "journee", "aube", "midi", "veille", "lendemain", "retour", "depart",
  "arrivee", "debut", "semaine"]);

// Les mots qui comptent : sans accents ni casse, trois lettres au moins, ni article ni mot du déroulé type.
export const motsUtiles = (t) => simplifier(t).split(" ").filter((m) => m.length >= 3 && !MOTS_VIDES.has(m));
const tete = (t) => simplifier(String(t || "").split(/[:,]/)[0]);

// Combien un nom répond au titre d'une scène, de 0 à 1 : tout le nom dans le titre, mot pour mot, vaut plus que 1 ;
// sinon la part de ses mots utiles que le titre contient, si l'un d'eux n'est pas un mot de moment. sauf : des mots du nom
// qui ne comptent pas (l'étage d'un plan).
export function score(nom, titre, sauf = "") {
  const n = simplifier(nom);
  const t = ` ${simplifier(titre)} `;
  if (!n) return 0;
  if (t.includes(` ${n} `)) return 1.01;
  const exclus = new Set(motsUtiles(sauf));
  const mots = [...new Set(motsUtiles(nom).filter((m) => !exclus.has(m)))];
  if (!mots.length) return 0;
  const dans = new Set(motsUtiles(titre));
  const communs = mots.filter((m) => dans.has(m));
  return communs.some((m) => !MOMENTS.has(m)) ? communs.length / mots.length : 0;
}

const SEUIL = 0.5;
const FORT = 0.75;
// À égalité, le plan du rez-de-chaussée (ou sans étage) d'abord : c'est là qu'on entre.
const rangEtage = (p) => (!p.etage ? 0 : /rez/i.test(p.etage) ? 1 : 2);

// Le meilleur candidat, s'il répond assez et sans ex aequo (départage : une fonction de rang, plus petit d'abord).
function meilleur(candidats, titre, { nom = (x) => x.nom, sauf = () => "", departage = null, seuil = SEUIL } = {}) {
  const notes = candidats.map((x) => ({ x, s: score(nom(x), titre, sauf(x)) })).filter((n) => n.s >= seuil);
  if (!notes.length) return null;
  const haut = Math.max(...notes.map((n) => n.s));
  let premiers = notes.filter((n) => n.s === haut);
  if (premiers.length > 1 && departage) {
    const bas = Math.min(...premiers.map((n) => departage(n.x)));
    premiers = premiers.filter((n) => departage(n.x) === bas);
  }
  return premiers.length === 1 ? premiers[0].x : null;
}

const TITRES = new Set(["frere", "soeur", "pere", "mere", "maitre", "dame", "sire", "messire", "seigneur", "capitaine"]);

// Un PNJ que le titre d'une scène nomme : son surnom, ou son prénom (« Ninette et le premier contrat » nomme Ninette Vernet,
// « Frère Anatole et son affiche » nomme Frère Anatole et pas Frère Odon, « Le moulin des Vernet » ne nomme personne).
export function nommePar(p, titre) {
  if (p?.surnom && score(p.surnom, titre) > 1) return true;
  const prenom = motsUtiles(p?.nom).find((m) => !TITRES.has(m));
  return Boolean(prenom) && motsUtiles(titre).includes(prenom);
}

// Le chapitre du scénario relié qui porte le titre de la scène : le titre de la scène commence par celui du chapitre, ou
// tous deux ont la même tête (avant « : »).
export function chapitreDe(titre, chapitres = []) {
  const t = ` ${simplifier(titre)} `;
  const trouves = chapitres.filter((ch) => {
    const c = simplifier(ch.titre);
    if (!c || !motsUtiles(ch.titre).length) return false;
    return t.startsWith(` ${c} `) || (tete(ch.titre) && tete(ch.titre) === tete(titre) && motsUtiles(tete(titre)).length > 0);
  });
  return trouves.length === 1 ? trouves[0] : null;
}

const LIEN = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

// Ce que lie le texte d'un chapitre, dans l'ordre : { pnj, rencontres, plans } (des identifiants, sans doublon).
export function liensDuChapitre(texte) {
  const sortie = { pnj: [], rencontres: [], plans: [] };
  for (const m of String(texte || "").matchAll(LIEN)) {
    const [chemin] = m[2].replace(/^#/, "").split("?");
    const [vide, page, id, reste] = chemin.split("/");
    if (vide !== "" || !id || reste !== undefined) continue;
    let ident;
    try {
      ident = decodeURIComponent(id);
    } catch {
      continue;
    }
    const genre = { pnj: "pnj", combats: "rencontres", plan: "plans" }[page];
    if (genre && !(genre === "pnj" && ident === "nouveau") && !sortie[genre].includes(ident)) sortie[genre].push(ident);
  }
  return sortie;
}

// Les propositions de toute la séance : Map(rang de la scène → { items, chapitre }). Un item : { genre, id, nom }.
// ctx : { plans, ambiances, pnj, rencontres, lieux, scenarios }.
export function proposerLiens(s, ctx) {
  const plans = ctx.plans || [];
  const ambiances = ctx.ambiances || [];
  const fiche = (liste, id) => (liste || []).find((x) => x.id === id) || null;
  const nomLieu = (id) => fiche(ctx.lieux, id)?.nom || "";
  const scenario = scenarioDe(s, ctx.scenarios || []);
  const chapitres = scenario?.chapitres || [];
  // Une rencontre déjà liée à une scène, ou proposée plus haut, ne l'est plus : chaque scène prend la suivante du chapitre.
  const prises = new Set((s.deroule || []).map((d) => liensDe(d).rencontre).filter(Boolean));
  const sortie = new Map();
  (s.deroule || []).forEach((d, i) => {
    const titre = (d.titre || "").trim();
    if (!motsUtiles(titre).length) return;
    const l = liensDe(d);
    const items = [];
    const ch = chapitreDe(titre, chapitres);
    const duChapitre = ch ? liensDuChapitre(ch.texte) : { pnj: [], rencontres: [], plans: [] };
    let plan = fiche(plans, l.plan);
    if (!l.plan) {
      // Le nom du plan, ou celui de son lieu ; sinon le plan du chapitre, s'il n'y en a qu'un.
      const parNom = meilleur(plans, titre, { sauf: (p) => p.etage || "", departage: rangEtage })
        || meilleur(plans.filter((p) => p.lieu && nomLieu(p.lieu)), titre, { nom: (p) => nomLieu(p.lieu), departage: rangEtage });
      plan = parNom || (duChapitre.plans.length === 1 ? fiche(plans, duChapitre.plans[0]) : null);
      if (plan) items.push({ genre: "plan", id: plan.id, nom: plan.nom || "Plan sans nom" });
    }
    if (!l.ambiance) {
      const a = meilleur(ambiances, titre);
      if (a) items.push({ genre: "ambiance", id: a.id, nom: a.nom });
    }
    if (!l.rencontre) {
      // Une rencontre au nom de la scène, ou à celui de son plan ; sinon la suivante du chapitre. Un seul mot commun ne suffit
      // pas : « La nuit au camp » n'appelle pas « La nuit : l'écurie ».
      const libres = (ctx.rencontres || []).filter((x) => !prises.has(x.id));
      const fort = (liste) => meilleur(liste, titre, { seuil: FORT });
      const duPlan = plan ? libres.find((x) => simplifier(x.nom) && simplifier(x.nom) === simplifier(plan.nom)) : null;
      const suivantes = duChapitre.rencontres.map((id) => fiche(libres, id)).filter(Boolean);
      const r = fort(libres) || duPlan || fort(suivantes) || suivantes[0] || null;
      if (r) {
        prises.add(r.id);
        items.push({ genre: "rencontre", id: r.id, nom: r.nom || "Rencontre" });
      }
    }
    // Les PNJ du chapitre, puis ceux que le titre nomme (son prénom au moins, ou son surnom).
    const nommes = (ctx.pnj || []).filter((p) => nommePar(p, titre)).map((p) => p.id);
    for (const id of [...new Set([...duChapitre.pnj, ...nommes])]) {
      const p = fiche(ctx.pnj, id);
      if (p && !l.pnj.includes(id)) items.push({ genre: "pnj", id, nom: p.nom + marqueSort(p) });
    }
    if (items.length) sortie.set(i, { items, chapitre: ch ? ch.titre || "" : "" });
  });
  return sortie;
}

const NOMS = { plan: "Plan", ambiance: "Ambiance", rencontre: "Rencontre", pnj: "PNJ" };
const TITRE_OUI = "Sera lié : cliquez pour l'écarter";
const TITRE_NON = "Écarté : cliquez pour le reprendre";
const cle = (x) => `${x.genre}:${x.id}`;

// Ce que la page Séances (seances.js) confie : la séance affichée, ses listes, l'enregistrement et les redessins.
export class ProposerLiens {
  constructor(page) {
    this.page = page;
    // Par ligne du déroulé (l'objet, qui suit la scène quand elle monte ou descend) : { items, coches, chapitre }.
    this.propositions = new WeakMap();
    this.compte = 0;
    this.seance = null;
  }

  contexte() {
    const p = this.page;
    return { plans: p.plans, ambiances: p.ambiances, pnj: p.pnj, rencontres: p.rencontres, lieux: p.lieux, scenarios: p.scenarios };
  }

  enAttente(s) {
    if (s !== this.seance) return [];
    return (s.deroule || []).filter((d) => this.propositions.has(d));
  }

  // Au-dessus du déroulé : le bouton, et ce qui attend.
  html(s) {
    if (s.close) return "";
    const attente = this.enAttente(s).length;
    return `
          <div class="proposer-liens">
            <button type="button" data-action="proposer-liens" title="Le plan et l'ambiance dont le nom répond au titre de chaque scène, les PNJ et la rencontre du chapitre du même titre dans le scénario relié">Proposer les liens</button>
            ${attente ? `<button type="button" class="principal" data-action="propositions-accepter">Tout accepter</button>
            <button type="button" class="lien" data-action="propositions-laisser">Tout laisser</button>
            <span class="aide">${attente > 1 ? `${attente} scènes ont` : "Une scène a"} des liens proposés, sous leur titre : décochez ce qui ne convient pas.</span>`
              : '<span class="aide">D\'après le titre des scènes et le scénario relié. Rien ne se pose sans vous.</span>'}
          </div>`;
  }

  // Sous une scène : ce qui lui est proposé.
  htmlScene(s, d, i) {
    const p = s === this.seance ? this.propositions.get(d) : null;
    if (!p) return "";
    return `
          <div class="proposition-scene" data-proposition="${i}" role="group" aria-label="Liens proposés pour cette scène">
            <span class="proposition-titre">Proposé</span>
            ${p.items.map((x) => {
              const oui = p.coches.has(cle(x));
              return `<button type="button" class="puce-proposee" data-proposee="${e(cle(x))}" data-i="${i}" aria-pressed="${oui}" title="${oui ? TITRE_OUI : TITRE_NON}"><i>${NOMS[x.genre]}</i> ${e(x.nom)}</button>`;
            }).join("")}
            ${p.chapitre ? `<span class="proposition-source">chapitre « ${e(p.chapitre)} »</span>` : ""}
            <span class="proposition-actions">
              <button type="button" data-action="proposition-accepter" data-i="${i}">Accepter</button>
              <button type="button" class="lien" data-action="proposition-laisser" data-i="${i}">Laisser</button>
            </span>
          </div>`;
  }

  async clic(b) {
    const s = this.page.seance;
    if (!s) return;
    const a = b.dataset.action;
    if (a === "proposer-liens") return this.proposer(s);
    if (b.dataset.proposee) {
      const d = s.deroule?.[+b.dataset.i];
      const p = d && this.propositions.get(d);
      if (!p) return;
      const k = b.dataset.proposee;
      if (p.coches.has(k)) p.coches.delete(k);
      else p.coches.add(k);
      b.setAttribute("aria-pressed", String(p.coches.has(k)));
      b.title = p.coches.has(k) ? TITRE_OUI : TITRE_NON;
      return;
    }
    if (a === "proposition-accepter" || a === "proposition-laisser") {
      const i = +b.dataset.i;
      const d = s.deroule?.[i];
      if (!d) return;
      const n = a === "proposition-accepter" ? this.accepter(d) : 0;
      this.propositions.delete(d);
      if (n) this.page.marquer("seance");
      return this.redessiner(i);
    }
    if (a === "propositions-accepter" || a === "propositions-laisser") {
      let n = 0;
      for (const d of this.enAttente(s)) {
        if (a === "propositions-accepter") n += this.accepter(d);
        this.propositions.delete(d);
      }
      if (n) {
        this.page.marquer("seance");
        toast(`${n} lien${n > 1 ? "s" : ""} posé${n > 1 ? "s" : ""} : « Sous la main » et la feuille de combat les lisent déjà.`);
      }
      return this.page.afficherOnglet();
    }
  }

  proposer(s) {
    const toutes = proposerLiens(s, this.contexte());
    this.seance = s;
    this.propositions = new WeakMap();
    for (const [i, p] of toutes) this.propositions.set(s.deroule[i], { ...p, coches: new Set(p.items.map(cle)) });
    if (!toutes.size) {
      const scenario = scenarioDe(s, this.page.scenarios || []);
      toast(`Rien à proposer : aucun plan ni aucune ambiance ne porte le nom d'une scène${scenario ? ", et aucun chapitre du scénario relié ne porte leur titre" : ", et la séance n'est reliée à aucun scénario"}.`);
    }
    this.page.afficherOnglet();
    this.page.racine.querySelector(".proposition-scene")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // Les liens cochés de la scène, posés comme dans « Lier » ; renvoie combien.
  accepter(d) {
    const p = this.propositions.get(d);
    if (!p) return 0;
    let n = 0;
    for (const x of p.items) {
      if (!p.coches.has(cle(x))) continue;
      lier(d, x.genre, x.id);
      n++;
    }
    return n;
  }

  // Une scène traitée : sa proposition s'en va, son « Lier » (fermé, il résume ses liens), « Sous la main » et « Avant de
  // jouer » suivent.
  redessiner(i) {
    const p = this.page;
    const s = p.seance;
    const d = s?.deroule?.[i];
    p.racine.querySelector(`[data-proposition="${i}"]`)?.remove();
    const lier = p.racine.querySelector(`details[data-liens="${i}"]`);
    if (d && lier) lier.outerHTML = htmlLier(d, i, p.contexteLiens(s), p.liensOuverts.has(d));
    p.majAvantDeJouer();
    p.majSousLaMain();
    const barre = p.racine.querySelector(".proposer-liens");
    if (barre && s) barre.outerHTML = this.html(s);
  }
}
