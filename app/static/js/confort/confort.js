// Le confort de la table, côté MJ : les lignes et les voiles que le MJ a convenues à voix haute avec la tablée,
// rassemblées par le serveur (/api/confort). Les joueurs ne les notent plus dans leur carnet ;
// celles qu'ils y auraient notées avant restent lues ici, sans leur nom sauf accord.
// Deux places : une ligne dans « Avant de jouer », avec un mot discret quand un texte préparé de la séance touche une de
// ces limites, et un panneau dans la page Réglages (section Règles de jeu), où le MJ les lit toutes et tient les siennes
// à jour.
// Rien d'ici ne part vers la TV, la table publique ou le coin des joueurs.

import { api, echapper as e } from "../api.js";
import { LIBRE_MAX, LIBRES_MAX, NIVEAUX, THEMES, chercheur, deQuoi, forme, nomCourt } from "./themes.js";

export const chargerConfort = () => api.get("/api/confort").catch(() => null);

const heureFr = (h) => (h ? h.replace(/^0(\d)/, "$1").replace(":", " h ").replace(/ h 00$/, " h") : "");
const majuscule = (t) => t.replace(/^./, (x) => x.toUpperCase());

// « les araignées (Léa) », « « la mort d'un animal » » : une limite dans une phrase, avec le nom de qui l'a acceptée.
// Les guillemets tiennent à leurs mots (espaces insécables).
function htmlItem(x) {
  const nom = x.cle ? e(nomCourt(x)) : `«\u00a0${e(x.texte)}\u00a0»`;
  return `${nom}${x.noms?.length ? ` <span class="ct-noms">(${e(x.noms.join(", "))})</span>` : ""}`;
}

function enPhrase(liste) {
  if (liste.length < 2) return liste.join("");
  return `${liste.slice(0, -1).join(", ")} et ${liste[liste.length - 1]}`;
}

// Les textes d'une fiche à relire : tous ses champs écrits, sans les identifiants, les dates ni les images.
const CHAMPS_TECHNIQUES = /^(id|cree|modifie|illustrations?|portrait|image|prompt|negatif|url|carte|lieu|cle|jeton|couleur|verdict|source)$/;
function textesDe(valeur, cle = "", profondeur = 0) {
  if (typeof valeur === "string") return CHAMPS_TECHNIQUES.test(cle) ? [] : [valeur];
  if (profondeur > 4 || !valeur || typeof valeur !== "object") return [];
  if (Array.isArray(valeur)) return valeur.flatMap((v) => textesDe(v, cle, profondeur + 1));
  return Object.entries(valeur).flatMap(([k, v]) => textesDe(v, k, profondeur + 1));
}

// Un même texte n'est mis en forme qu'une fois tant que la page vit (un scénario fait des dizaines de milliers de signes).
const formes = new Map();
function formeDe(textes) {
  const brut = textes.filter(Boolean).join("\n");
  if (!formes.has(brut)) {
    if (formes.size > 400) formes.clear();
    formes.set(brut, forme(brut));
  }
  return formes.get(brut);
}

// Ce que la séance a de préparé : les scènes à venir, ses notes, les chapitres de son scénario et ce qui est « sous la
// main » (PNJ, lieux, rencontres). Chaque source a son genre, un nom court pour la phrase, et un lien quand c'est une
// autre page.
const guillemets = (t) => `«\u00a0${String(t || "").trim() || "sans nom"}\u00a0»`;
function sourcesDe(s, { sous, scenario }) {
  const sources = [];
  for (const d of s.deroule || []) {
    if (d.fait || !(d.titre || d.note)) continue;
    sources.push({ genre: "scene", court: d.heure ? `de ${heureFr(d.heure)}` : guillemets(d.titre), textes: [d.titre, d.note] });
  }
  sources.push({ genre: "notes", court: "", textes: [s.objectif, s.notes, s.conseils, s.fin, s.questions] });
  for (const c of scenario?.chapitres || []) {
    sources.push({ genre: "chapitre", court: guillemets(c.titre), lien: `#/scenarios/${scenario.id}?chapitre=${c.id}`, textes: [c.titre, c.texte] });
  }
  for (const p of sous?.pnj || []) sources.push({ genre: "pnj", court: p.fiche.nom || "sans nom", lien: `#/pnj/${p.fiche.id}`, textes: textesDe(p.fiche) });
  for (const l of sous?.lieux || []) {
    sources.push({ genre: "lieu", court: guillemets(l.fiche.nom), lien: l.fiche.carte ? `#/carte/${l.fiche.carte}?lieu=${l.fiche.id}` : `#/lieu/${l.fiche.id}`, textes: textesDe(l.fiche) });
  }
  for (const r of sous?.rencontres || []) sources.push({ genre: "rencontre", court: guillemets(r.fiche.nom), lien: `#/combats/${r.fiche.id}`, textes: textesDe(r.fiche) });
  return sources;
}

// Comment se nomment les sources d'un même genre : « la scène de 15 h 25 », « les chapitres « A » et « B » »…
const GENRES = {
  scene: ["la scène", "les scènes"],
  notes: ["les notes de la séance", "les notes de la séance"],
  chapitre: ["le chapitre", "les chapitres"],
  pnj: ["la fiche de", "les fiches de"],
  lieu: ["le lieu", "les lieux"],
  rencontre: ["la rencontre", "les rencontres"],
};
const PAR_GENRE_MAX = 3;

// Les limites de la tablée que touchent les textes préparés de la séance : [{ item, niveau, sources }].
export function alertesConfort(s, confort, contexte) {
  const limites = [...(confort?.lignes || []).map((x) => [x, "ligne"]), ...(confort?.voiles || []).map((x) => [x, "voile"])]
    .map(([item, niveau]) => ({ item, niveau, cherche: chercheur(item) }))
    .filter((x) => x.cherche);
  if (!limites.length) return [];
  const sources = sourcesDe(s, contexte).map((src) => ({ ...src, forme: formeDe(src.textes) })).filter((src) => src.forme);
  return limites
    .map(({ item, niveau, cherche }) => ({ item, niveau, sources: sources.filter((src) => cherche(src.forme)) }))
    .filter((x) => x.sources.length);
}

// La ligne de « Avant de jouer » ; rien quand personne n'a noté de limite.
export function ligneConfort(s, confort, contexte) {
  if (!confort || !(confort.lignes?.length || confort.voiles?.length)) return null;
  return { genre: "confort", confort, alertes: alertesConfort(s, confort, contexte) };
}

// « La scène de 15 h 25, les chapitres « A » et « B » et la fiche de Frère Ysmar parlent de torture : une ligne de la tablée. »
function htmlAlerte({ item, niveau, sources }) {
  const groupes = Object.entries(GENRES).map(([genre, [un, plusieurs]]) => {
    const liste = sources.filter((src) => src.genre === genre);
    if (!liste.length) return "";
    const noms = liste.slice(0, PAR_GENRE_MAX).map((src) => (src.lien ? `<a href="${e(src.lien)}">${e(src.court)}</a>` : e(src.court)));
    const reste = liste.length - PAR_GENRE_MAX;
    if (reste > 0) noms.push(`${reste} autre${reste > 1 ? "s" : ""}`);
    return genre === "notes" ? un : `${liste.length > 1 ? plusieurs : un} ${enPhrase(noms)}`;
  }).filter(Boolean);
  // Les genres liés par « et » ; une virgule de plus avant le dernier quand un groupe a déjà le sien.
  const dernier = groupes.pop();
  const phrase = majuscule(groupes.length ? `${groupes.join(", ")}${[...groupes, dernier].some((g) => g.includes(" et ")) ? ", et " : " et "}${dernier}` : dernier);
  return `<span class="alerte-confort niveau-${niveau}">${phrase} ${sources.length > 1 ? "parlent" : "parle"} ${e(deQuoi(item))} : ${niveau === "voile" ? "un" : "une"} <b>${niveau}</b> de la tablée.</span>`;
}

export function htmlLigneConfort(l) {
  const { lignes = [], voiles = [] } = l.confort;
  const parts = [];
  if (lignes.length) parts.push(`Lignes : ${lignes.map(htmlItem).join(", ")}.`);
  if (voiles.length) parts.push(`Voiles : ${voiles.map(htmlItem).join(", ")}.`);
  return `
      <li class="ligne-confort"><b>Confort de la table</b><span class="detail">${parts.join(" ")}
        <span class="ct-liens"><a href="#/reglages/regles?confort">Les tenir à jour</a> · <a href="/carte-x" target="_blank" rel="noopener">Imprimer la carte X</a></span>
        ${l.alertes.map(htmlAlerte).join("")}</span></li>`;
}

// ---- Le panneau des Règles maison ----

const CHOIX = [["", "Ça va"], ["voile", NIVEAUX.voile], ["ligne", NIVEAUX.ligne]];
let ouvert = false;

function quand(iso) {
  const d = new Date(iso || "");
  return Number.isNaN(d.getTime()) ? "" : `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
}

export class PanneauConfort {
  constructor(racine, { ouvrir = false } = {}) {
    this.racine = racine;
    this.ouvrir = ouvrir;
    this.vue = null;
    this.minuterie = 0;
    this.envoi = Promise.resolve();
  }

  async demarrer() {
    this.vue = await chargerConfort();
    if (!this.racine.isConnected) return;
    if (!this.vue) {
      this.racine.innerHTML = '<p class="vide">Le confort de la table ne se lit pas pour l\'instant.</p>';
      return;
    }
    this.mj = { themes: { ...this.vue.mj.themes }, lignes: [...this.vue.mj.lignes], voiles: [...this.vue.mj.voiles] };
    if (this.ouvrir) ouvert = true;
    this.racine.innerHTML = this.gabarit();
    this.lier();
    if (this.ouvrir) this.racine.scrollIntoView({ block: "start" });
  }

  detruire() {
    if (this.minuterie) this.enregistrer();
  }

  resume() {
    const v = this.vue;
    const n = v.reponses;
    const total = [v.lignes.length ? `${v.lignes.length} ligne${v.lignes.length > 1 ? "s" : ""}` : "", v.voiles.length ? `${v.voiles.length} voile${v.voiles.length > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ");
    let qui;
    let signes;
    if (v.invites && n === null) {
      // Peu de réponses sans nom : le serveur tait leur nombre, il dirait qui a noté quoi.
      qui = "Des joueurs ont noté des limites";
      signes = v.nommes ? `, dont ${v.nommes} avec ${v.nommes > 1 ? "leur" : "son"} nom` : "";
    } else {
      qui = n ? `${n} joueur${n > 1 ? "s" : ""} sur ${v.invites} ${n > 1 ? "ont" : "a"} noté des limites` : "";
      signes = v.nommes ? `, ${v.nommes === n ? (n > 1 ? "tous avec leur nom" : "avec son nom") : `dont ${v.nommes} avec son nom`}` : "";
    }
    return [qui + signes, total].filter(Boolean).join(" · ") || "Aucune limite notée";
  }

  htmlTablee() {
    const colonne = (titre, aide, liste) => `
      <section class="ct-colonne">
        <h3>${titre}</h3><p class="aide">${aide}</p>
        ${liste.length ? `<ul class="ct-liste">${liste.map((x) => `<li>${htmlItem(x)}${x.mj && !x.noms.length ? ' <span class="ct-noms">(convenue à la table)</span>' : ""}</li>`).join("")}</ul>` : '<p class="vide">Aucune pour l\'instant.</p>'}
      </section>`;
    return `<div class="ct-colonnes">${colonne("Lignes", "Elles n'arrivent jamais en jeu.", this.vue.lignes)}${colonne("Voiles", "Ils restent hors champ : on ferme la porte.", this.vue.voiles)}</div>`;
  }

  htmlLibres(cle, titre, exemple) {
    const valeurs = this.mj[cle];
    return `
      <div class="ct-libre" data-ct-liste="${cle}">
        <p class="ct-libelle">${titre}</p>
        ${valeurs.length ? `<ul class="puces">${valeurs.map((v, i) => `<li><span>${e(v)}</span><button class="retirer-puce" type="button" data-ct-retirer="${i}" aria-label="Retirer « ${e(v)} »">×</button></li>`).join("")}</ul>` : ""}
        ${valeurs.length < LIBRES_MAX ? `<form class="ct-ajout"><input type="text" maxlength="${LIBRE_MAX}" placeholder="${e(exemple)}" aria-label="${e(titre)}" autocomplete="off"><button type="submit">Ajouter</button></form>` : ""}
      </div>`;
  }

  gabarit() {
    return `
      <details class="confort-table"${ouvert ? " open" : ""}>
        <summary><span class="ct-titre">Confort de la table</span><span class="ct-resume">${e(this.resume())}</span></summary>
        <div class="ct-corps">
          <p class="ct-intro">Les lignes et les voiles de la tablée, convenues à voix haute. « Avant de jouer » les rappelle, et signale une scène préparée qui en parle.${this.vue.reponses === null ? " Tant que moins de trois joueurs ont répondu sans leur nom, leur nombre n'est pas affiché : il dirait qui a noté quoi." : ""}</p>
          <div class="ct-tablee">${this.htmlTablee()}</div>
          <h3 class="ct-sous-titre">Les vôtres, convenues avec la tablée</h3>
          <p class="aide">Celles que la table a décidées à voix haute, en début de campagne. <span class="ct-etat" aria-live="polite"></span></p>
          <ul class="ct-themes">${THEMES.map((t) => `
            <li><span id="ct-${e(t.cle)}">${e(t.nom)}</span>
              <span class="segments" role="group" aria-labelledby="ct-${e(t.cle)}">${CHOIX.map(([v, libelle]) => `<button type="button" data-ct-theme="${e(t.cle)}" data-niveau="${v}" aria-pressed="${(this.mj.themes[t.cle] || "") === v}">${libelle}</button>`).join("")}</span></li>`).join("")}
          </ul>
          <div class="ct-libres">${this.htmlLibres("lignes", "D'autres lignes", "La mort d'un animal…")}${this.htmlLibres("voiles", "D'autres voiles", "Les maladies…")}</div>
          <p class="ct-pied"><a class="bouton" href="/carte-x" target="_blank" rel="noopener">Imprimer la carte X</a><span class="aide">Une carte en papier au milieu de la table : qui la touche fait passer à autre chose, sans avoir à se justifier.</span></p>
        </div>
      </details>`;
  }

  lier() {
    const d = this.racine.querySelector(".confort-table");
    d.addEventListener("toggle", () => {
      ouvert = d.open;
    });
    d.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-ct-theme]");
      if (b) {
        const cle = b.dataset.ctTheme;
        if (b.dataset.niveau) this.mj.themes[cle] = b.dataset.niveau;
        else delete this.mj.themes[cle];
        for (const x of d.querySelectorAll(`[data-ct-theme="${cle}"]`)) x.setAttribute("aria-pressed", String(x === b));
        return this.changer();
      }
      const r = ev.target.closest("[data-ct-retirer]");
      if (r) {
        const cle = r.closest("[data-ct-liste]").dataset.ctListe;
        this.mj[cle] = this.mj[cle].filter((_, i) => i !== +r.dataset.ctRetirer);
        this.redessinerLibres(cle);
        this.changer(true);
      }
    });
    d.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const cle = ev.target.closest("[data-ct-liste]")?.dataset.ctListe;
      const texte = ev.target.querySelector("input").value.replace(/\s+/g, " ").trim();
      if (!cle || !texte) return;
      if (![...this.mj.lignes, ...this.mj.voiles].some((x) => forme(x) === forme(texte))) this.mj[cle] = [...this.mj[cle], texte];
      this.redessinerLibres(cle);
      this.changer(true);
    });
  }

  redessinerLibres(cle) {
    const zone = this.racine.querySelector(`[data-ct-liste="${cle}"]`);
    zone.outerHTML = this.htmlLibres(cle, cle === "lignes" ? "D'autres lignes" : "D'autres voiles", cle === "lignes" ? "La mort d'un animal…" : "Les maladies…");
    this.racine.querySelector(`[data-ct-liste="${cle}"] input`)?.focus();
  }

  changer(aussitot = false) {
    this.dire("Envoi…");
    clearTimeout(this.minuterie);
    this.minuterie = setTimeout(() => this.enregistrer(), aussitot ? 0 : 400);
  }

  enregistrer() {
    clearTimeout(this.minuterie);
    this.minuterie = 0;
    const corps = { themes: { ...this.mj.themes }, lignes: [...this.mj.lignes], voiles: [...this.mj.voiles] };
    this.envoi = this.envoi.then(() => api.put("/api/confort", corps)).then(
      (vue) => {
        this.vue = vue;
        if (!this.racine.isConnected) return;
        this.racine.querySelector(".ct-tablee").innerHTML = this.htmlTablee();
        this.racine.querySelector(".ct-resume").textContent = this.resume();
        if (!this.minuterie) this.dire(`Enregistré à ${quand(vue.mj?.modifie || new Date().toISOString())}.`);
      },
      (err) => this.dire(`Pas enregistré : ${err.message}.`, true),
    );
    return this.envoi;
  }

  dire(texte, erreur = false) {
    const el = this.racine.querySelector(".ct-etat");
    if (!el) return;
    el.textContent = texte;
    el.classList.toggle("erreur", erreur);
  }
}
