// « Sous la main » réunit ce que le MJ y a choisi et ce que lient les scènes du déroulé : un PNJ, une rencontre, le lieu
// du plan d'une scène, un document à remettre aux joueurs. Rien n'est écrit dans la séance : défaire le lien d'une scène le retire d'ici. « Avant de jouer »,
// la feuille de combat, la fiche d'une page, À montrer, le combat et la clôture lisent les mêmes listes, dans l'ordre du
// déroulé : ce que lient les scènes, scène après scène, puis ce qui n'est choisi qu'à la main.

import { echapper as e } from "../api.js";
import { VERDICTS } from "../combats/simulation.js";
import { liensDe, marqueSort } from "./liens-scene.js";
import { htmlProposes, proposesDe } from "./propose.js";

export const GENRES_SOUS_LA_MAIN = ["pnj", "lieux", "rencontres", "documents"];
export { marqueSort };

const heureFr = (h) => (h ? h.replace(/^0(\d)/, "$1").replace(":", " h ").replace(/ h 00$/, " h") : "");
const tronquer = (t, n) => (t && t.length > n ? `${t.slice(0, n - 1)}…` : t || "");
const ident = (v) => (typeof v === "string" && v ? v : null);

// Les identifiants seuls : { pnj, lieux, rencontres, documents }, chacun une liste de { id, choisi, scenes } (scenes : les rangs
// des lignes du déroulé qui le lient). plans : pour trouver le lieu du plan d'une scène.
export function idsSousLaMain(s, plans = []) {
  const genres = Object.fromEntries(GENRES_SOUS_LA_MAIN.map((g) => [g, new Map()]));
  const noter = (genre, id, scene = null) => {
    if (!ident(id)) return;
    const x = genres[genre].get(id) || { id, choisi: false, scenes: [] };
    if (scene === null) x.choisi = true;
    else if (!x.scenes.includes(scene)) x.scenes.push(scene);
    genres[genre].set(id, x);
  };
  (s?.deroule || []).forEach((d, i) => {
    const l = liensDe(d);
    for (const id of l.pnj) noter("pnj", id, i);
    for (const id of l.documents) noter("documents", id, i);
    if (l.rencontre) noter("rencontres", l.rencontre, i);
    if (l.plan) noter("lieux", (plans || []).find((p) => p.id === l.plan)?.lieu, i);
  });
  for (const g of GENRES_SOUS_LA_MAIN) for (const id of Array.isArray(s?.[g]) ? s[g] : []) noter(g, id);
  return Object.fromEntries(GENRES_SOUS_LA_MAIN.map((g) => [g, [...genres[g].values()]]));
}

// Les mêmes, avec leur fiche ; une fiche retirée depuis disparaît de la liste.
export function sousLaMain(s, { pnj = [], lieux = [], rencontres = [], plans = [], documents = [] } = {}) {
  const ids = idsSousLaMain(s, plans);
  const listes = { pnj, lieux, rencontres, documents };
  return Object.fromEntries(GENRES_SOUS_LA_MAIN.map((g) => [g, ids[g]
    .map((x) => ({ ...x, fiche: (listes[g] || []).find((f) => f.id === x.id) || null }))
    .filter((x) => x.fiche)]));
}

// Les plans à montrer pendant la séance : ceux que lient les scènes, puis ceux des lieux sous la main. sous : ce que rend
// sousLaMain (ou idsSousLaMain), pour ne pas le recalculer.
export function plansDeLaSeance(s, plans = [], sous = idsSousLaMain(s, plans)) {
  const deScene = new Set((s?.deroule || []).map((d) => liensDe(d).plan).filter(Boolean));
  const lieux = new Set(sous.lieux.map((x) => x.id));
  return (plans || []).filter((p) => deScene.has(p.id) || (p.lieu && lieux.has(p.lieu)));
}

// « 18 h 15 », ou le titre de la scène quand elle n'a pas d'heure.
export function nomDeScene(d, i) {
  const h = heureFr(d?.heure || "");
  return h ? `de ${h}` : `« ${tronquer((d?.titre || "").trim() || `scène ${i + 1}`, 40)} »`;
}

// La mention discrète d'une entrée liée par des scènes : « par la scène de 18 h 15 », « par les scènes de 15 h et
// 17 h 35 », « par 4 scènes, dès 14 h 10 ».
export function parLesScenes(s, scenes) {
  const d = s?.deroule || [];
  const noms = scenes.filter((i) => d[i]).map((i) => nomDeScene(d[i], i));
  if (!noms.length) return "";
  if (noms.length === 1) return `par la scène ${noms[0]}`;
  if (noms.length === 2) return `par les scènes ${noms[0]} et ${noms[1].replace(/^de /, "")}`;
  return `par ${noms.length} scènes, dès ${noms[0].replace(/^de /, "")}`;
}

const nomRencontre = (r) => `${r.nom || "Rencontre"}${r.verdict && VERDICTS[r.verdict.cle] ? ` (${VERDICTS[r.verdict.cle].nom.toLowerCase()})` : ""}`;
const lienLieu = (l) => (l.carte ? `#/carte/${l.carte}?lieu=${l.id}` : `#/lieu/${l.id}`);

export const FORMES = {
  pnj: { titre: "PNJ", libelle: (p) => `${p.nom}${p.role ? `, ${p.role}` : ""}${marqueSort(p)}`, lien: (p) => `#/pnj/${p.id}` },
  lieux: { titre: "Lieux", libelle: (l) => l.nom || "Lieu sans nom", lien: lienLieu },
  rencontres: { titre: "Rencontres", libelle: nomRencontre, lien: (r) => `#/combats/${r.id}` },
  // Les documents de la séance s'impriment d'un coup, un par page, pour les tendre à table.
  documents: {
    titre: "Documents à remettre", libelle: (x) => String(x.nom || "").trim() || "Document sans titre", lien: (x) => `#/documents/${x.id}`,
    vide: '<p class="aide">Aucun document pour l\'instant. Écrivez-en un dans <a href="#/documents">Documents</a>, puis rattachez-le à une scène avec « Lier » (ou choisissez-le ici une fois créé).</p>',
    pied: (s, entrees) => (entrees.length ? `<p class="aide imprimer-documents"><a href="/documents-imprimes?seance=${encodeURIComponent(s.id)}" target="_blank" rel="noopener">Imprimer ${entrees.length > 1 ? `les ${entrees.length} documents` : "le document"} de la séance</a></p>` : ""),
  },
};

// Préparer : une rubrique de « Sous la main ». Ce qu'une scène lie porte « par la scène de 18 h 15 » (un clic ouvre son
// « Lier ») ; seul ce qui n'est choisi qu'ici se retire d'ici. listes : { pnj, lieux, rencontres, plans }.
export function htmlRubrique(s, genre, listes) {
  const f = FORMES[genre];
  const entrees = sousLaMain(s, listes)[genre];
  const presents = new Set(entrees.map((x) => x.id));
  const reste = (listes[genre] || []).filter((x) => !presents.has(x.id));
  // Une ligne proposée à la clôture de la séance d'avant (choisie à la main, liée à aucune scène) attend sous les puces.
  const proposes = proposesDe(s, genre);
  const enAttente = (x) => x.id in proposes && x.choisi && !x.scenes.length;
  return `
      <div class="choix" data-choix="${genre}">
        <h3>${f.titre} <span class="compte">${entrees.length || ""}</span></h3>
        <ul class="puces">${entrees.filter((x) => !enAttente(x)).map((x) => {
          const par = x.scenes.length ? parLesScenes(s, x.scenes) : "";
          const mention = `<button type="button" class="mention-scene" data-action="voir-lier" data-i="${x.scenes[0]}" title="Ouvrir le « Lier » de cette scène : c'est là que ce lien se défait">${e(par)}</button>`;
          const retirer = `<button class="retirer-puce" data-action="puce-retirer" data-cle="${genre}" data-id="${e(x.id)}" aria-label="Retirer ${e(tronquer(f.libelle(x.fiche), 40))}">×</button>`;
          return `
          <li${par ? ' class="par-scene"' : ""}><a href="${e(f.lien(x.fiche))}">${e(tronquer(f.libelle(x.fiche), 64))}</a>${par ? mention : x.choisi ? retirer : ""}</li>`;
        }).join("")}
        </ul>
        ${htmlProposes(s, genre, entrees.filter(enAttente).map((x) => ({ id: x.id, libelle: tronquer(f.libelle(x.fiche), 64), lien: f.lien(x.fiche) })))}
        ${reste.length ? `<select data-ajouter="${genre}" aria-label="Ajouter : ${e(f.titre)}"><option value="">Ajouter…</option>${reste.map((x) => `<option value="${e(x.id)}">${e(tronquer(f.libelle(x), 72))}</option>`).join("")}</select>` : ""}
        ${f.vide && !entrees.length && !reste.length && !Object.keys(proposes).length ? f.vide : ""}
        ${f.pied ? f.pied(s, entrees) : ""}
      </div>`;
}
