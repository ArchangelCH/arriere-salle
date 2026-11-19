// Les activités entre les séances dans le carnet des joueurs : le tableau de l'auberge (19/11). Les offres de la période y
// sont des affiches clouées, un peu de travers ; celles de chaque semaine des planches peintes ; la quête unique prend toute
// la largeur sous un sceau rouge. Une affiche faite porte le sceau du dé, une affiche complète une bande « Complet ». Le
// carnet (carnet-vue.js) et l'aperçu du MJ dessinent le tableau tel quel, chaque texte en entier ; dans le coin,
// activites-coin.js y ajoute les chances du héros, l'affiche qui s'ouvre, le jet et ce que le MJ en a fait. Tout texte
// passe par echapper ; le serveur n'envoie que ce que l'atelier a mis au tableau, jamais l'or promis, les récits ni la réserve.

import { echapper as e } from "../api.js";

export const po = (n) => `${n} po`;
const signe = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");
const ou = (l) => (l.length > 1 ? `${l.slice(0, -1).join(", ")} ou ${l[l.length - 1]}` : l[0] || "");
const paragraphes = (t) => String(t || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${e(x)}</p>`).join("");

// La section publiée, rangée : la période, les activités.
export function lireSection(elements) {
  const liste = (elements || []).filter((x) => x && typeof x === "object");
  return {
    periode: liste.find((x) => x.genre === "periode" && typeof x.cle === "string") || null,
    activites: liste.filter((x) => x.genre === "activite" && typeof x.id === "string"),
  };
}

// « Physique, avec Athlétisme ou Artisanat, −10 % ».
export function rubrique(a) {
  const morceaux = [a.carac_nom || ""];
  if ((a.competences || []).length) morceaux.push(`avec ${ou(a.competences)}`);
  if (a.modificateur) morceaux.push(`${signe(a.modificateur)} %`);
  return morceaux.filter(Boolean).join(", ");
}

export function places(a) {
  if (!a.places) return "";
  if (typeof a.restantes !== "number") return `${a.places} place${a.places > 1 ? "s" : ""}`;
  if (!a.restantes) return "complet pour cette période";
  return `${a.restantes} place${a.restantes > 1 ? "s" : ""} sur ${a.places}`;
}

// Ce que le MJ annonce qu'on peut y gagner (s'il le veut), de petits signes dessinés et le nom en clair.
const GAINS = {
  or: ["de l'or", '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="#d9a43c" stroke="#7a5418"/><circle cx="8" cy="8" r="3.8" fill="none" stroke="#7a5418" stroke-width=".9"/></svg>'],
  rumeur: ["une rumeur", '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h8l2 2v8H3z" fill="#efe1c0" stroke="#5a4426" stroke-width="1.1"/><path d="M5 7h6M5 9.5h4" stroke="#5a4426" stroke-width="1"/></svg>'],
  contact: ["un contact", '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5.5" cy="5.5" r="2.4" fill="#8a6a4a"/><circle cx="11" cy="6.5" r="2" fill="#5a4426"/><path d="M1.5 14c.5-3 2-4.5 4-4.5s3.5 1.5 4 4.5M8.5 14c.3-2 1.3-3.4 2.6-3.4S13.8 12 14.2 14" fill="none" stroke="#5a4426" stroke-width="1.2"/></svg>'],
  objet: ["un objet", '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6h8l1 8H3z" fill="#9c6a3a" stroke="#4a2e17" stroke-width="1.1"/><path d="M6 6c0-2 .8-3 2-3s2 1 2 3" fill="none" stroke="#4a2e17" stroke-width="1.1"/></svg>'],
};
export function htmlGains(a) {
  const liste = (a.gains || []).filter((g) => GAINS[g]);
  return liste.length ? `<ul class="gains-affiche" aria-label="Ce qu'on peut y gagner">${liste.map((g) => `<li>${GAINS[g][1]}${e(GAINS[g][0])}</li>`).join("")}</ul>` : "";
}

const CARACS = { physique: "Physique", social: "Social", mental: "Mental" };
// La place d'une affiche au tableau. Tant que rien ne tourne (toutes les activités de chaque semaine, comme avant la
// réserve), pas de planche : des affiches de papier, comme le jour où le tableau a été posé.
export const offreDe = (a, tourne = true) => (a.offre === "quete" ? "quete" : a.offre === "toujours" && tourne ? "toujours" : "tiree");
// De petits angles, fixes pour une affiche donnée : le tableau ne bouge pas d'une lecture à l'autre.
function penche(id, i) {
  let h = i;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 997;
  return [-1.6, 1.2, -.6, 1.8, -1.1, .7, -1.9, 1.4][h % 8];
}

// Une affiche du tableau. ctx (coin seulement) : chances(a) (la ligne écrite à la main), sceau(a) (le dé d'une activité
// faite), bouton (le geste qui ouvre l'affiche). Sans ctx (carnet avant le coin, aperçu du MJ) : le texte entier.
export function htmlAffiche(a, i = 0, ctx = null, tourne = true) {
  const genre = offreDe(a, tourne);
  const complet = a.places && a.restantes === 0;
  const sceau = ctx ? ctx.sceau(a) : "";
  const classes = ["affiche", `carac-${a.carac || "physique"}`, `offre-${genre}`, sceau ? "faite" : "", complet ? "complete" : ""].filter(Boolean).join(" ");
  const angle = genre === "toujours" ? 0 : genre === "quete" ? penche(a.id, i) * 0.4 : penche(a.id, i);
  const tete = genre === "quete" ? `<span class="sceau-quete" aria-hidden="true">Quête<br>unique</span><span class="tampon-affiche">${e(a.carac_nom || CARACS[a.carac] || "")}</span>`
    : genre === "toujours" ? '<span class="chaque-semaine">Chaque semaine</span>' : `<span class="tampon-affiche">${e(a.carac_nom || CARACS[a.carac] || "")}</span>`;
  const reste = places(a);
  const titre = `titre-affiche-${e(a.id)}`;
  return `
    <article class="${classes}" style="--penche:${angle}deg;--i:${i}" data-affiche="${e(a.id)}" aria-labelledby="${titre}">
      <span class="clou" aria-hidden="true"></span>${tete}
      <h4 id="${titre}">${e(a.nom)}</h4>
      ${genre === "quete" && a.accroche ? `<p class="accroche-affiche">${e(a.accroche)}</p>` : ""}
      ${a.texte ? `<div class="texte-affiche">${paragraphes(a.texte)}</div>` : ""}
      <p class="rubrique-affiche">${e(rubrique(a))}</p>
      ${ctx ? ctx.chances(a) : ""}
      ${reste && !complet ? `<p class="places-affiche">${e(reste)}</p>` : ""}
      ${htmlGains(a)}${sceau}
      ${ctx ? ctx.bouton(a) : ""}
    </article>`;
}

// Le fronton du tableau : la période, et quand les affiches changent (seulement si la réserve les fait changer).
export function htmlFronton(periode) {
  const quand = periode?.renouvellement
    ? periode.mode === "semaine" ? `Nouvelles affiches ${periode.renouvellement}` : "Nouvelles affiches à la prochaine séance"
    : periode?.mode === "seance" ? "Jusqu'à la prochaine séance" : "Affiché pour la semaine";
  return `<div class="fronton-activites"><span class="k">Le tableau de l'auberge</span><h3>${e(periode?.libelle || "")}</h3><p>${e(quand)}</p></div>`;
}

export function htmlTableau(periode, activites, ctx = null) {
  return `
    <div class="tableau-activites${ctx ? "" : " lecture"}">
      ${htmlFronton(periode)}
      <div class="affiches">${activites.map((a, i) => htmlAffiche(a, i, ctx, Boolean(periode?.renouvellement))).join("") || '<p class="vide">Aucune affiche au tableau pour l\'instant.</p>'}</div>
    </div>`;
}

// La valeur visée, en clair : « Physique 60, Athlétisme +15, −5, carton −30 : 40 % ».
export function compoVisee(j) {
  const morceaux = [`${j.carac_nom} ${j.base}`];
  if (j.competence && j.bonus) morceaux.push(`${j.competence} ${signe(j.bonus)}`);
  if (j.modificateur) morceaux.push(signe(j.modificateur));
  // Les ajustements ne sont que des cartons (jets_distance.ajustements) : htmlAjustements les dit en entier.
  for (const a of j.ajustements || []) morceaux.push(`carton ${signe(a.valeur)}`);
  return `${morceaux.join(", ")} : ${j.visee} %`;
}

// Ce qui a changé la valeur visée en plus, compté par l'atelier : « Carton rouge en Physique : −30 % ».
export function htmlAjustements(liste, balise = "p") {
  return liste?.length ? `<${balise} class="ajustements-activite">${liste.map((a) => `${e(a.libelle)} : ${signe(a.valeur)} %`).join(" · ")}</${balise}>` : "";
}

export const CLASSES = { "reussite-critique": "reussite critique", reussite: "reussite", echec: "echec", "echec-critique": "echec critique" };

// Le jet tel que l'atelier l'a écrit : le dé dans son sceau, l'issue, de quoi la valeur visée est faite.
export function htmlJet(j, { annonce = false } = {}) {
  if (!j) return "";
  const de = String(j.de ?? "").padStart(2, "0");
  return `
    <div class="jet-activite ${e(CLASSES[j.issue] || "")}${annonce ? " annonce" : ""}">
      <span class="de-activite" role="img" aria-label="Le dé : ${e(de)}">${e(de)}</span>
      <p><b class="issue-activite">${e(j.issue_nom || "")}</b><span class="visee-activite">${e(compoVisee(j))}</span>${htmlAjustements(j.ajustements, "span")}</p>
    </div>`;
}

// Ce que le MJ a fait de l'or.
export function phraseOr(d) {
  const p = d.public || {};
  if (d.statut === "en-attente") return { attente: true, texte: "L'or : en attente du MJ." };
  if (d.statut === "refusee") return { attente: false, texte: p.rendu ? "Votre MJ n'a pas retenu cette activité et vous rend votre tour." : "Votre MJ n'a pas retenu cette activité." };
  if (!p.or) return { attente: false, texte: "Pas d'or cette fois." };
  if (p.or.vers === "cagnotte") return { attente: false, texte: `${po(p.or.montant)} pour ${p.or.chantier || "un chantier"}, au sanctuaire.` };
  return { attente: false, texte: p.or.montant >= 0 ? `${po(p.or.montant)} dans votre bourse.` : `${po(-p.or.montant)} perdues.` };
}

// Le carnet avant que le coin ne monte ses gestes, et l'aperçu du MJ : le tableau, chaque affiche en entier.
export function htmlSansGestes(elements) {
  const { periode, activites } = lireSection(elements);
  if (!periode) return '<p class="vide">Les activités ne sont pas ouvertes pour l\'instant.</p>';
  return htmlTableau(periode, activites);
}

export const nombreDActivites = (elements) => lireSection(elements).activites.length;
