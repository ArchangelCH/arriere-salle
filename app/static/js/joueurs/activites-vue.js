// Les activités entre les séances dans le carnet des joueurs : la période en cours, puis chaque activité que le
// MJ propose, comme une notice du registre (sa caractéristique en marge, les compétences qui aident, la difficulté, les
// places). Le carnet (carnet-vue.js) et l'aperçu du MJ la dessinent telle quelle ; dans le coin, activites-coin.js y
// ajoute les chances du héros, le choix, le jet et ce que le MJ en a fait. Tout texte passe par echapper ; le serveur
// n'envoie que ce que l'atelier a publié, jamais l'or promis ni les récits.

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

// « Physique, avec Athlétisme ou Artisanat, −10 % » ; puis les places.
export function rubrique(a) {
  const morceaux = [a.carac_nom || ""];
  if ((a.competences || []).length) morceaux.push(`avec ${ou(a.competences)}`);
  if (a.modificateur) morceaux.push(`${signe(a.modificateur)}\u00a0%`);
  return morceaux.filter(Boolean).join(", ");
}

export function places(a) {
  if (!a.places) return "";
  if (typeof a.restantes !== "number") return `${a.places} place${a.places > 1 ? "s" : ""}`;
  if (!a.restantes) return "complet pour cette période";
  return `${a.restantes} place${a.restantes > 1 ? "s" : ""} sur ${a.places}`;
}

// ctx (coin seulement) : les chances du héros et le geste de choisir (activites-coin.js).
export function htmlActivite(a, ctx = null) {
  const complet = a.places && a.restantes === 0;
  return `
    <article class="activite-coin carac-${e(a.carac || "")}${complet ? " complete" : ""}" id="activite-${e(a.id)}" data-activite="${e(a.id)}">
      <p class="marge-activite" aria-hidden="true">${e(a.carac_nom || "")}</p>
      <div class="corps-activite">
        <h3>${e(a.nom)}</h3>
        <p class="rubrique-activite">${e(rubrique(a))}${places(a) ? `<span class="places-activite">${e(places(a))}</span>` : ""}</p>
        ${a.texte ? `<div class="texte-activite">${paragraphes(a.texte)}</div>` : ""}
        ${ctx ? ctx.gestes(a) : ""}
      </div>
    </article>`;
}

// La valeur visée, en clair : « Physique 60, Athlétisme +15, −5, carton −30 : 40 % ».
export function compoVisee(j) {
  const morceaux = [`${j.carac_nom} ${j.base}`];
  if (j.competence && j.bonus) morceaux.push(`${j.competence} ${signe(j.bonus)}`);
  if (j.modificateur) morceaux.push(signe(j.modificateur));
  // Les ajustements ne sont que des cartons (jets_distance.ajustements) : htmlAjustements les dit en entier.
  for (const a of j.ajustements || []) morceaux.push(`carton ${signe(a.valeur)}`);
  return `${morceaux.join(", ")} : ${j.visee}\u00a0%`;
}

// Ce qui a changé la valeur visée en plus, compté par l'atelier : « Carton rouge en Physique : −30 % ».
export function htmlAjustements(liste, balise = "p") {
  return liste?.length ? `<${balise} class="ajustements-activite">${liste.map((a) => `${e(a.libelle)}\u00a0: ${signe(a.valeur)}\u00a0%`).join(" · ")}</${balise}>` : "";
}

const CLASSES = { "reussite-critique": "reussite critique", reussite: "reussite", echec: "echec", "echec-critique": "echec critique" };

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

export function htmlSansGestes(elements) {
  const { periode, activites } = lireSection(elements);
  if (!periode) return '<p class="vide">Les activités ne sont pas ouvertes pour l\'instant.</p>';
  return `
    <p class="periode-activites"><span class="lbl">En ce moment</span>${e(periode.libelle || "")}</p>
    <div class="activites-liste">${activites.map((a) => htmlActivite(a)).join("") || '<p class="vide">Aucune activité proposée pour l\'instant.</p>'}</div>`;
}

export const nombreDActivites = (elements) => lireSection(elements).activites.length;
