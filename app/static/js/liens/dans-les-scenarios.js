// « Dans les scénarios », sur la fiche d'un PNJ et dans le panneau d'un lieu : les chapitres qui le citent, calculés à
// partir des liens écrits (liens_fiches.py), et un clic ouvre le passage. Il remplace l'ancien champ libre « Scénario »
// du PNJ, dont le texte reste lisible tant qu'il en a un. « Retour au chapitre » ramène au chapitre d'où l'on a suivi le
// lien. Côté MJ seulement : rien de cela ne part vers la TV.

import { api, echapper as e } from "../api.js";
import { cibleLien } from "../scenarios/fiches.js";

const CLE_DEPART = "liens.depuis";
// Le temps de suivre un lien : au-delà, la fiche ouverte ne vient plus du scénario.
const DELAI_DEPART = 90_000;
const RELIRE = 20_000;
const cache = new Map();

const court = (t, n) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

// Un PNJ ou un lieu, quel que soit le lien qui le vise : { genre: "pnj" | "lieu", id }.
function ficheDuLien(href) {
  const c = cibleLien(href);
  if (!c) return null;
  if (c.genre === "pnj") return { genre: "pnj", id: c.id };
  if (c.genre === "lieu") return { genre: "lieu", id: c.id };
  if (c.genre === "carte" && c.lieu) return { genre: "lieu", id: c.lieu };
  return null;
}

// L'aperçu d'un scénario note d'où part un lien suivi (scenarios.js) : la fiche qui s'ouvre propose d'y revenir.
export function noterDepart({ scenario, chapitre, titre, href }) {
  try {
    sessionStorage.setItem(CLE_DEPART, JSON.stringify({ scenario, chapitre, titre, href, quand: Date.now() }));
  } catch {
    // sans retour au chapitre, le bouton Retour du navigateur y ramène aussi
  }
}

// Le chapitre d'où l'on vient, si c'est bien vers cette fiche que menait le lien, il y a peu ; tant qu'on y reste, le
// retour reste proposé.
export function departVers(genre, id) {
  let d = null;
  try {
    d = JSON.parse(sessionStorage.getItem(CLE_DEPART) || "null");
  } catch {
    return null;
  }
  const vise = d && ficheDuLien(d.href);
  if (!vise || vise.genre !== genre || vise.id !== id || Date.now() - (+d.quand || 0) > DELAI_DEPART) return null;
  d.quand = Date.now();
  try {
    sessionStorage.setItem(CLE_DEPART, JSON.stringify(d));
  } catch {
    // le retour reste proposé pour cet affichage
  }
  return d;
}

export function htmlRetour(genre, id) {
  const d = departVers(genre, id);
  if (!d?.scenario) return "";
  return `<a class="retour retour-chapitre" href="#/scenarios/${e(encodeURIComponent(d.scenario))}?chapitre=${e(encodeURIComponent(d.chapitre || ""))}">Retour au chapitre «&nbsp;${e(court(d.titre || "sans titre", 48))}&nbsp;»</a>`;
}

// La place du bloc, à remplir par monter() : genre « pnj » ou « lieux ».
export const placeMentions = (genre, id) => `<section class="dans-les-scenarios" data-mentions="${e(genre)}:${e(id)}" aria-label="Dans les scénarios"></section>`;

async function lire(genre, id) {
  const cle = `${genre}:${id}`;
  const connu = cache.get(cle);
  if (connu && Date.now() - connu.quand < RELIRE) return connu.reponse;
  const reponse = await api.get(`/api/mentions/${encodeURIComponent(genre)}/${encodeURIComponent(id)}`);
  cache.set(cle, { reponse, quand: Date.now() });
  return reponse;
}

// L'ancien champ libre « Scénario » : un identifiant de scénario (une consigne [[pnj]] l'y a mis) se lit sous son nom.
function htmlAncien(ancien, noms, avecVerser) {
  const t = String(ancien || "").trim();
  if (!t) return "";
  const texte = noms[t] ? `Créé par une consigne de « ${noms[t]} »` : `Noté à la main : « ${t} »`;
  return `
      <p class="ancien-scenario"><span>${e(texte)}</span>${avecVerser && !noms[t] ? '<button type="button" class="lien" data-action="verser-scenario" title="Ce texte passe dans les Notes de la fiche, et ce rappel disparaît">Verser dans les notes</button>' : ""}</p>`;
}

function html(genre, id, reponse, { ancien = "", avecVerser = false, vide = "" } = {}) {
  const passages = reponse?.passages || [];
  const parScenario = new Map();
  for (const p of passages) parScenario.set(p.scenario, [...(parScenario.get(p.scenario) || []), p]);
  const voir = (p) => `#/scenarios/${encodeURIComponent(p.scenario)}?chapitre=${encodeURIComponent(p.chapitre || "")}&voir=${encodeURIComponent(p.lien || "")}`;
  return `
      <h3>Dans les scénarios ${passages.length ? `<span class="compte">${passages.length}</span>` : ""}</h3>
      ${passages.length ? [...parScenario.values()].map((liste) => `
      <p class="scenario-cite">${e(liste[0].nom)}</p>
      <ul class="passages">${liste.map((p) => `
        <li><a href="${e(voir(p))}" title="Ouvrir le passage dans le scénario"><span class="numero">${p.numero}</span><span class="titre">${e(p.titre)}</span>${p.fois > 1 ? `<span class="fois">${p.fois} fois</span>` : ""}</a>
          ${p.par?.length ? `<span class="par">par le plan ${e(p.par.map((x) => `« ${x} »`).join(", "))}</span>` : ""}
          ${p.extrait ? `<span class="extrait">${e(p.extrait)}</span>` : ""}</li>`).join("")}
      </ul>`).join("") : `<p class="aide">${e(vide || "Aucun scénario ne le cite encore. Un lien « @ » écrit dans un chapitre l'ajoute ici.")}</p>`}
      ${htmlAncien(ancien, reponse?.noms || {}, avecVerser)}`;
}

// Remplit la place du bloc (placeMentions) dans racine : tout de suite avec ce qui est déjà connu, puis à jour.
// options : ancien (le champ libre « Scénario »), avecVerser (le bouton « Verser dans les notes »), vide (le mot sans
// passage).
export async function monterMentions(racine, genre, id, options = {}) {
  const cle = `${genre}:${id}`;
  const trouver = () => [...(racine?.querySelectorAll(".dans-les-scenarios[data-mentions]") || [])].find((z) => z.dataset.mentions === cle);
  const connu = cache.get(cle);
  if (trouver()) trouver().innerHTML = html(genre, id, connu?.reponse, { ...options, vide: connu ? options.vide : "Lecture des scénarios…" });
  try {
    const reponse = await lire(genre, id);
    const zone = trouver();
    if (zone) zone.innerHTML = html(genre, id, reponse, options);
  } catch {
    const zone = trouver();
    if (zone && !connu) zone.innerHTML = html(genre, id, null, { ...options, vide: "Les scénarios ne répondent pas : réessayez dans un instant." });
  }
}

// Une fiche renommée ou rendue à un autre identifiant : ce qu'on savait d'elle ne vaut plus.
export function oublierMentions(genre, id) {
  cache.delete(`${genre}:${id}`);
}
