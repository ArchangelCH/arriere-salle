// Les liens d'une scène du déroulé : un plan, des PNJ, une rencontre, une ambiance de musique, des documents à remettre
// aux joueurs (documents/). Ils se choisissent dans
// Préparer (« Lier », replié sous la scène) et se retrouvent dans Jouer sous la scène en cours, en boutons séparés :
// chacun attend un clic du MJ, rien ne part seul vers la TV ni dans les haut-parleurs. « Jouer la scène », en tête, en
// réunit trois sur un seul clic : le plan, l'ambiance et le journal (jouer-scene.js).
// Le texte de la scène (heure, titre, durée, note) n'est jamais touché : les liens vivent à part, dans `liens`.

import { echapper as e } from "../api.js";
import { VERDICTS } from "../combats/simulation.js";
import { htmlGeste, ligneEnCours } from "./jouer-scene.js";

const tronquer = (t, n) => (t && t.length > n ? `${t.slice(0, n - 1)}…` : t || "");
const ident = (v) => (typeof v === "string" && v ? v : null);

// Un PNJ mort ou disparu se signale partout où on le choisit : on ne lie ni ne montre un mort sans le savoir.
export function sortDuPnj(p) {
  if (p?.statut === "mort") return p.genre === "f" ? "morte" : "mort";
  if (p?.statut === "disparu") return p.genre === "f" ? "disparue" : "disparu";
  return "";
}
export const marqueSort = (p) => (sortDuPnj(p) ? ` (${sortDuPnj(p)})` : "");

// La scène en cours : celle que « Jouer la scène » a marquée, tant qu'elle n'est pas cochée ; sinon la première non
// cochée (-1 quand tout est joué). Le bandeau de Séances, l'horaire de Jouer et la télécommande disent la même.
export const sceneEnCours = (s) => {
  const marquee = ligneEnCours(s);
  return marquee >= 0 ? marquee : (s?.deroule || []).findIndex((d) => !d.fait);
};

// Les liens d'une ligne du déroulé, toujours complets : { plan, pnj: [], rencontre, ambiance, documents: [] }.
export function liensDe(d) {
  const l = d && d.liens && typeof d.liens === "object" ? d.liens : {};
  const liste = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => ident(x)))] : []);
  return { plan: ident(l.plan), pnj: liste(l.pnj), rencontre: ident(l.rencontre), ambiance: ident(l.ambiance), documents: liste(l.documents) };
}

// Une ligne sans aucun lien perd son champ : le déroulé d'avant reste tel quel sur le disque.
function ranger(d, l) {
  const propre = {};
  if (l.plan) propre.plan = l.plan;
  if (l.pnj.length) propre.pnj = l.pnj;
  if (l.rencontre) propre.rencontre = l.rencontre;
  if (l.ambiance) propre.ambiance = l.ambiance;
  if (l.documents.length) propre.documents = l.documents;
  if (Object.keys(propre).length) d.liens = propre;
  else delete d.liens;
}

// Plan, rencontre, ambiance : un identifiant, ou rien pour défaire. PNJ, documents : un de plus (sans doublon).
export function lier(d, genre, valeur) {
  const l = liensDe(d);
  if (genre === "pnj" || genre === "documents") {
    if (ident(valeur) && !l[genre].includes(valeur)) l[genre].push(valeur);
  } else if (genre === "plan" || genre === "rencontre" || genre === "ambiance") l[genre] = ident(valeur);
  ranger(d, l);
}

export function delier(d, genre, valeur) {
  const l = liensDe(d);
  if (genre === "pnj" || genre === "documents") l[genre] = l[genre].filter((x) => x !== valeur);
  else if (genre in l) l[genre] = null;
  ranger(d, l);
}

const trouver = (liste, id) => (id ? (liste || []).find((x) => x.id === id) || null : null);
const nomDocument = (x) => String(x?.nom || "").trim() || "Document sans titre";
const nomRencontre = (r) => `${r.nom || "Rencontre"}${r.verdict && VERDICTS[r.verdict.cle] ? ` (${VERDICTS[r.verdict.cle].nom.toLowerCase()})` : ""}`;

// Ce que les liens désignent encore : une fiche retirée depuis ne donne plus de bouton.
export function liensResolus(d, ctx) {
  const l = liensDe(d);
  return {
    plan: trouver(ctx.plans, l.plan),
    pnj: l.pnj.map((id) => trouver(ctx.pnj, id)).filter(Boolean),
    rencontre: trouver(ctx.rencontres, l.rencontre),
    ambiance: trouver(ctx.ambiances, l.ambiance),
    documents: l.documents.map((id) => trouver(ctx.documents, id)).filter(Boolean),
  };
}

// Une liste de choix : d'abord ce que la séance a sous la main, puis le reste. Un lien vers une fiche disparue reste
// affiché (« introuvable ») tant qu'on ne le change pas.
function options(liste, valeur, { proches, titreProches, titreAutres, libelle, vide }) {
  const opt = (x) => `<option value="${e(x.id)}" ${x.id === valeur ? "selected" : ""}>${e(tronquer(libelle(x), 64))}</option>`;
  const pres = liste.filter((x) => proches.has(x.id));
  const autres = liste.filter((x) => !proches.has(x.id));
  const perdu = valeur && !liste.some((x) => x.id === valeur) ? `<option value="${e(valeur)}" selected>Introuvable (retiré depuis)</option>` : "";
  const groupes = pres.length && autres.length
    ? `<optgroup label="${e(titreProches)}">${pres.map(opt).join("")}</optgroup><optgroup label="${e(titreAutres)}">${autres.map(opt).join("")}</optgroup>`
    : liste.map(opt).join("");
  return `<option value="">${e(vide)}</option>${perdu}${groupes}`;
}

function resume(r) {
  const parts = [];
  if (r.plan) parts.push(`<i>Plan</i> ${e(tronquer(r.plan.nom, 40))}`);
  if (r.pnj.length) parts.push(`<i>PNJ</i> ${e(tronquer(r.pnj.map((p) => p.nom + marqueSort(p)).join(", "), 50))}`);
  if (r.rencontre) parts.push(`<i>Rencontre</i> ${e(tronquer(r.rencontre.nom || "Rencontre", 40))}`);
  if (r.ambiance) parts.push(`<i>Ambiance</i> ${e(tronquer(r.ambiance.nom, 30))}`);
  if (r.documents?.length) parts.push(`<i>${r.documents.length > 1 ? "Documents" : "Document"}</i> ${e(tronquer(r.documents.map(nomDocument).join(", "), 50))}`);
  return parts.join(" · ");
}

// Préparer : « Lier », replié par défaut, sous une scène du déroulé.
export function htmlLier(d, i, ctx, ouvert = false) {
  const s = ctx.seance;
  const l = liensDe(d);
  const r = liensResolus(d, ctx);
  const lieux = new Set(s.lieux || []);
  const plansProches = new Set((ctx.plans || []).filter((p) => p.lieu && lieux.has(p.lieu)).map((p) => p.id));
  const pnjRestants = (ctx.pnj || []).filter((p) => !l.pnj.includes(p.id));
  // « Sous la main » compte aussi ce que lient les autres scènes (sous-la-main.js).
  const autres = (s.deroule || []).map(liensDe);
  const pnjProches = new Set([...(s.pnj || []), ...autres.flatMap((x) => x.pnj)]);
  const rencontresProches = new Set([...(s.rencontres || []), ...autres.map((x) => x.rencontre).filter(Boolean)]);
  const resumeLiens = resume(r);
  return `
          <details class="liens-scene" data-liens="${i}" ${ouvert ? "open" : ""}>
            <summary><span class="lier">Lier</span>${resumeLiens ? `<span class="resume-liens">${resumeLiens}</span>` : ""}</summary>
            <div class="liens-choix">
              <label class="champ">Plan<select data-ls="${i}" data-lien="plan">${options(ctx.plans || [], l.plan, {
                proches: plansProches, titreProches: "Plans des lieux de la séance", titreAutres: "Autres plans", libelle: (p) => p.nom || "Plan sans nom", vide: "Aucun plan",
              })}</select></label>
              <label class="champ">Rencontre<select data-ls="${i}" data-lien="rencontre">${options(ctx.rencontres || [], l.rencontre, {
                proches: rencontresProches, titreProches: "Rencontres de la séance", titreAutres: "Autres rencontres", libelle: nomRencontre, vide: "Aucune rencontre",
              })}</select></label>
              <label class="champ">Ambiance<select data-ls="${i}" data-lien="ambiance" ${(ctx.ambiances || []).length || l.ambiance ? "" : "disabled"}>${options(ctx.ambiances || [], l.ambiance, {
                proches: new Set(), libelle: (a) => a.nom, vide: (ctx.ambiances || []).length ? "Aucune ambiance" : "Aucune ambiance dans le panneau Musique",
              })}</select></label>
              <div class="champ pnj-scene"><span>PNJ</span>
                ${r.pnj.length ? `<ul class="puces">${r.pnj.map((p) => `
                  <li><a href="#/pnj/${e(p.id)}">${e(tronquer(p.nom, 40) + marqueSort(p))}</a><button class="retirer-puce" data-action="lien-retirer" data-ls="${i}" data-genre="pnj" data-id="${e(p.id)}" aria-label="Retirer ${e(tronquer(p.nom, 40))} de la scène">×</button></li>`).join("")}
                </ul>` : ""}
                ${pnjRestants.length ? `<select data-ls="${i}" data-lien="pnj" aria-label="Ajouter un PNJ à la scène">${options(pnjRestants, null, {
                  proches: pnjProches, titreProches: "Sous la main", titreAutres: "Autres PNJ", libelle: (p) => p.nom + (p.role ? `, ${p.role}` : "") + marqueSort(p), vide: "Ajouter…",
                })}</select>` : ""}
              </div>
              ${htmlDocumentsALier(d, i, ctx, r)}
            </div>
            <p class="aide">Tout est facultatif. Dans Jouer, la scène en cours montre ces liens en boutons, chacun à lancer au bon moment.</p>
          </details>`;
}

// Les documents à remettre pendant la scène (la lettre trouvée sur le cadavre) : comme les PNJ, un de plus à chaque
// choix. Rien quand l'atelier n'a encore aucun document.
function htmlDocumentsALier(d, i, ctx, r) {
  const tous = ctx.documents || [];
  const lies = liensDe(d).documents;
  if (!tous.length && !lies.length) return "";
  const restants = tous.filter((x) => !lies.includes(x.id));
  const s = ctx.seance;
  const proches = new Set([...(s.documents || []), ...(s.deroule || []).flatMap((x) => liensDe(x).documents)]);
  return `
              <div class="champ pnj-scene documents-scene"><span>Documents</span>
                ${r.documents.length ? `<ul class="puces">${r.documents.map((x) => `
                  <li><a href="#/documents/${e(x.id)}">${e(tronquer(nomDocument(x), 40))}</a><button class="retirer-puce" data-action="lien-retirer" data-ls="${i}" data-genre="documents" data-id="${e(x.id)}" aria-label="Retirer ${e(tronquer(nomDocument(x), 40))} de la scène">×</button></li>`).join("")}
                </ul>` : ""}
                ${restants.length ? `<select data-ls="${i}" data-lien="documents" aria-label="Ajouter un document à la scène">${options(restants, null, {
                  proches, titreProches: "Sous la main", titreAutres: "Autres documents", libelle: nomDocument, vide: "Ajouter…",
                })}</select>` : ""}
              </div>`;
}

// Le suivi du combat d'une rencontre dans cette séance : repris s'il est en cours, sinon à préparer.
export function lienCombat(s, rencontre) {
  const base = `#/combat/${encodeURIComponent(s?.id || "")}`;
  return s?.combat?.rencontre === rencontre.id ? base : `${base}?rencontre=${encodeURIComponent(rencontre.id)}`;
}

// Jouer : sous la scène en cours (la ligne i), « Jouer la scène » en tête (jouer-scene.js), puis un bouton par lien.
// ctx.table : ce que la TV montre ; ctx.musique : { courante, enPause } du lecteur de l'en-tête.
export function htmlLiensJeu(d, ctx, i) {
  const r = liensResolus(d, ctx);
  const t = ctx.table || {};
  const m = ctx.musique || {};
  const lignes = [htmlGeste(d, i, r)];
  if (r.plan) {
    const p = r.plan;
    lignes.push(`
              <li><span><i>Plan</i> ${e(p.nom)}</span><span class="boutons">
                <a class="bouton" href="#/plan/${e(p.id)}" title="Révéler les pièces, poser et bouger les pions">Ouvrir le plan</a>
                ${t.vue === "plan" && t.plan === p.id ? '<button data-action="accueil">Retirer</button>' : `<button data-action="plan-montrer" data-plan="${e(p.id)}">Montrer</button>`}</span></li>`);
  }
  for (const p of r.pnj) {
    lignes.push(`
              <li><span><i>PNJ</i> ${e(p.nom + marqueSort(p))}${p.connu ? "" : ' <span class="inconnu" title="Inconnu des joueurs"></span>'}</span>
                ${t.pnj === p.id ? '<button data-action="pnj-retirer">Retirer le carton</button>' : `<button data-action="pnj-montrer" data-pnj="${e(p.id)}">Montrer son carton</button>`}</li>`);
  }
  if (r.rencontre) {
    const encours = ctx.seance?.combat?.rencontre === r.rencontre.id;
    lignes.push(`
              <li><span><i>Rencontre</i> ${e(nomRencontre(r.rencontre))}</span><span class="boutons">
                <a class="bouton" href="#/combats/${e(r.rencontre.id)}" title="Les adversaires et leur verdict, dans l'onglet Combats">Ouvrir la rencontre</a>
                <a class="bouton" href="${e(lienCombat(ctx.seance, r.rencontre))}" title="Ordre du tour, Santé, cartons et rappels du kit">${encours ? "Reprendre le combat" : "Lancer le combat"}</a></span></li>`);
  }
  for (const x of r.documents || []) {
    const montre = t.vue === "document" && t.document === x.id;
    lignes.push(`
              <li><span><i>Document</i> ${e(nomDocument(x))}</span>
                ${montre ? `<button data-action="document-retirer" data-document="${e(x.id)}">Retirer de la TV</button>` : `<button data-action="document-montrer" data-document="${e(x.id)}" title="Le document en grand sur la TV ; il entre ensuite dans le carnet des joueurs">Montrer à la TV</button>`}</li>`);
  }
  if (r.ambiance) {
    const a = r.ambiance;
    const enCours = m.courante === a.id && !m.enPause;
    const enPause = m.courante === a.id && m.enPause;
    lignes.push(`
              <li><span><i>Ambiance</i> ${e(a.nom)}</span>
                <button data-action="ambiance-jouer" data-ambiance="${e(a.id)}" ${enCours ? 'disabled title="Cette ambiance joue déjà"' : 'title="Fondu vers cette ambiance, comme dans le panneau Musique"'}>${enCours ? "En cours" : enPause ? "Reprendre" : "Lancer l'ambiance"}</button></li>`);
  }
  return `
            <ul class="liens-jeu" aria-label="Sous la main pour cette scène">${lignes.join("")}
            </ul>`;
}
