// « Avant de jouer » : ce qui n'est pas encore prêt pour une séance, calculé avec ce que la page Séances a déjà chargé.
// Côté MJ seulement : rien n'est écrit ici, rien ne part vers la TV.

import { echapper as e } from "../api.js";
import { htmlLigneConfort, ligneConfort } from "../confort/confort.js";
import { reglageCombat } from "../musique/musique-combat.js";
import { rienDeRevele } from "../ecran-tv/tv-commun.js";
import { liensDe } from "./liens-scene.js";
import { idsSousLaMain, sousLaMain } from "./sous-la-main.js";

// Pour rapprocher deux noms : sans accents, sans casse ni ponctuation.
export const simplifier = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const lienLieu = (l) => (l.carte ? `#/carte/${l.carte}?lieu=${l.id}` : `#/lieu/${l.id}`);

// Le scénario d'une séance : par son identifiant, sinon (ancien champ texte) le scénario qui porte le même nom.
export function scenarioDe(s, scenarios) {
  const lie = s.scenario_id && scenarios.find((x) => x.id === s.scenario_id);
  if (lie) return lie;
  const nom = simplifier(s.scenario);
  return (nom && scenarios.find((x) => simplifier(x.nom) === nom)) || null;
}

// Les aventuriers attendus : les présents cochés, sinon la tablée active.
export function attendus(s, tablee = []) {
  const ids = new Set(tablee.map((j) => j.id));
  const presents = (s.presents || []).filter((id) => ids.has(id)).length;
  return presents ? { n: presents, presents: true } : { n: tablee.filter((j) => j.actif !== false).length, presents: false };
}

// Ce qui relie une rencontre à la séance : un adversaire qui est un PNJ de la séance (ou d'un de ses lieux),
// sinon le lieu lui-même (même identifiant, même nom, ou le champ lieu de la rencontre). Renvoie le nom du lien.
function lienRencontre(r, { pnj, idsPnj, lieuxSeance }) {
  for (const a of r.adversaires || []) {
    const id = String(a.cle || "").replace(/^pnj:/, "");
    const p = pnj.find((x) => x.id === id);
    if (p && (idsPnj.has(p.id) || lieuxSeance.some((l) => l.id === p.lieu))) return p.nom;
  }
  const nom = simplifier(r.nom);
  const l = lieuxSeance.find((x) => x.id === r.lieu || x.id === r.id || (nom && simplifier(x.nom) === nom));
  return l ? l.nom : null;
}

// Pourquoi un verdict ne vaut plus pour ce groupe ; rien s'il vaut encore.
function motifRepesee(v, n, niveau) {
  if (!v) return "pas encore pesée";
  const ecarts = [];
  if (n && +v.nbPj !== n) ecarts.push(`pour ${v.nbPj || "?"}`);
  if ((+v.niveau || 1) !== niveau) ecarts.push(`au niveau ${v.niveau || 1}`);
  return ecarts.length ? `pesée ${ecarts.join(" ")}, à repeser` : "";
}

// Les lignes possibles, dans l'ordre où les traiter. Une ligne sans rien à dire n'existe pas. musique : le réglage de
// la musique des combats (celui du panneau Musique, une fois sa liste lue) ; plans : pour signaler un plan lié sans
// pièce révélée ; confort : les lignes et les voiles de la tablée (/api/confort), scenarios : pour relire celui de la séance.
export function avantDeJouer(s, { pnj = [], lieux = [], rencontres = [], tablee = [], niveau = 1, musique = reglageCombat(), plans = [], confort = null, scenarios = [] }) {
  if (!s || s.close) return [];
  // « Sous la main » et ce que lient les scènes, ensemble, dans l'ordre du déroulé (sous-la-main.js) : une rencontre
  // liée à une scène est choisie.
  const sous = sousLaMain(s, { pnj, lieux, rencontres, plans });
  const pnjSeance = sous.pnj.map((x) => x.fiche);
  const lieuxSeance = sous.lieux.map((x) => x.fiche);
  const idsPnj = new Set(pnjSeance.map((p) => p.id));
  const choisies = new Set(idsSousLaMain(s, plans).rencontres.map((x) => x.id));
  const lignes = [];

  const aChoisir = rencontres
    .filter((r) => !choisies.has(r.id))
    .map((r) => ({ r, par: lienRencontre(r, { pnj, idsPnj, lieuxSeance }) }))
    .filter((x) => x.par);
  if (aChoisir.length) lignes.push({ genre: "rencontres", items: aChoisir });

  const groupe = attendus(s, tablee);
  const aRepeser = sous.rencontres
    .map((x) => x.fiche)
    .map((r) => ({ r, motif: motifRepesee(r.verdict, groupe.n, niveau) }))
    .filter((x) => x.motif);
  if (aRepeser.length) lignes.push({ genre: "verdicts", items: aRepeser, groupe, niveau });

  // Un plan lié à une scène à venir, sous le brouillard, sans pièce révélée : la TV resterait noire en le montrant.
  const noirs = [...new Set((s.deroule || []).filter((d) => !d.fait).map((d) => liensDe(d).plan).filter(Boolean))]
    .map((id) => plans.find((p) => p.id === id))
    .filter((p) => p && rienDeRevele(p));
  if (noirs.length) lignes.push({ genre: "plans", items: noirs });

  const pnjInconnus = pnjSeance.filter((p) => !p.connu);
  const lieuxInconnus = lieuxSeance.filter((l) => !l.connu);
  if (pnjInconnus.length || lieuxInconnus.length) lignes.push({ genre: "inconnus", pnj: pnjInconnus, lieux: lieuxInconnus });

  const sansPortrait = pnjSeance.filter((p) => !p.illustration);
  if (sansPortrait.length) lignes.push({ genre: "portraits", items: sansPortrait });

  // Des combats à jouer et une liste de musique, mais aucune ambiance de combat : la musique ne changerait pas.
  const combats = choisies.size > 0;
  if (combats && musique?.ambiances.length && !musique.combat) lignes.push({ genre: "musique", ambiances: musique.ambiances });

  // Le confort de la table, en dernier : un rappel, et un mot quand un texte préparé touche une ligne ou un voile.
  const confortTable = ligneConfort(s, confort, { sous, scenario: scenarioDe(s, scenarios) });
  if (confortTable) lignes.push(confortTable);
  return lignes;
}

const liens = (liste, lien, nom = (x) => x.nom) => liste.map((x) => `<a href="${e(lien(x))}">${e(nom(x))}</a>`).join(", ");
const lienPnj = (p) => `#/pnj/${p.id}`;

function htmlLigne(l) {
  if (l.genre === "rencontres") {
    return `
      <li><b>Rencontres non choisies</b><span class="detail">${l.items.map(({ r, par }) => `
        <span class="a-ajouter"><a href="#/combats/${e(r.id)}" title="Liée à ${e(par)}">${e(r.nom || "Rencontre")}</a><button data-action="rencontre-ajouter" data-id="${e(r.id)}" title="L'ajouter aux rencontres de la séance">Ajouter</button></span>`).join("")}
      </span></li>`;
  }
  if (l.genre === "verdicts") {
    const { n, presents } = l.groupe;
    const qui = presents ? `${n} présent${n > 1 ? "s" : ""}` : `${n} à la tablée`;
    const niveau = l.items.some(({ r }) => r.verdict && (+r.verdict.niveau || 1) !== l.niveau) ? `, niveau ${l.niveau}` : "";
    // Les rencontres qui ont le même motif tiennent dans une seule phrase.
    const parMotif = new Map();
    for (const { r, motif } of l.items) parMotif.set(motif, [...(parMotif.get(motif) || []), r]);
    const phrases = [...parMotif].map(([motif, rs]) => `${liens(rs, (r) => `#/combats/${r.id}`, (r) => r.nom || "Rencontre")} : ${e(rs.length > 1 ? motif.replace("pesée", "pesées") : motif)}`);
    return `
      <li><b>Verdicts</b><span class="detail" title="La balance repèse une rencontre dès qu'on l'ouvre">${e(qui + niveau)}. ${phrases.join(" ; ")}.</span></li>`;
  }
  if (l.genre === "plans") {
    const un = l.items.length === 1;
    return `
      <li><b>${un ? "Plan lié sans pièce révélée" : "Plans liés sans pièce révélée"}</b><span class="detail" title="Sous le brouillard, rien n'est encore révélé">${liens(l.items, (p) => `#/plan/${p.id}`)} : la TV restera noire. Révélez ${un ? "la pièce" : "dans chacun la pièce"} où entrent les héros.</span></li>`;
  }
  if (l.genre === "inconnus") {
    const parts = [];
    if (l.pnj.length) parts.push(`PNJ : ${liens(l.pnj, lienPnj)}`);
    if (l.lieux.length) parts.push(`${l.lieux.length > 1 ? "Lieux" : "Lieu"} : ${liens(l.lieux, lienLieu)}`);
    return `
      <li><b>À révéler en jeu</b><span class="detail" title="Encore inconnus des joueurs">${parts.join(". ")}.</span></li>`;
  }
  if (l.genre === "confort") return htmlLigneConfort(l);
  if (l.genre === "musique") {
    return `
      <li><b>Musique de combat</b><span class="detail">Aucune ambiance choisie : la musique ne changera pas quand un combat commence.<select data-m-combat aria-label="Ambiance de combat">
        <option value="">Choisir…</option>${l.ambiances.map((a) => `<option value="${e(a.id)}">${e(a.nom)}</option>`).join("")}</select></span></li>`;
  }
  return `
      <li><b>${l.items.length} PNJ sans portrait</b><span class="detail">${liens(l.items, lienPnj)}.</span></li>`;
}

// L'encadré disparaît quand il n'y a rien à signaler.
export function htmlAvantDeJouer(lignes) {
  if (!lignes.length) return "";
  return `
    <section class="avant-de-jouer" aria-label="Avant de jouer">
      <h2>Avant de jouer</h2>
      <ul>${lignes.map(htmlLigne).join("")}</ul>
    </section>`;
}
