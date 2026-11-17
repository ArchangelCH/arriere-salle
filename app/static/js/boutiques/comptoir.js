// Le comptoir d'une boutique (boutiques.js), pour jouer : une ligne par article, rangées par rayon comme une carte de
// marchand (le nom et ce qu'en lisent les joueurs, le prix pour la table, le stock, « Vendre à… », « Montrer de
// près ») ; l'éditeur complet d'un article se déplie sous sa ligne, et le mode « Préparer » les montre tous en entier.
// « Chercher un article » vaut dans les deux modes, sans accents ni majuscules. Côté MJ seulement : la TV ne reçoit que
// la partie publique de la boutique (/api/table/boutique/…).

import { echapper as e } from "../api.js";
import { mots, placesDesMots, propre, surligner } from "../chercher/moteur.js";
import { ajusterPrix, avecPo } from "./commun.js";
import { objetSvg } from "./objets.js";

const CLE_MODE = "boutiques.mode";
export const MODES_BOUTIQUE = { comptoir: "Comptoir", preparer: "Préparer" };

export function lireModeBoutique() {
  try {
    return localStorage.getItem(CLE_MODE) === "preparer" ? "preparer" : "comptoir";
  } catch {
    return "comptoir";
  }
}

export function garderModeBoutique(mode) {
  try {
    localStorage.setItem(CLE_MODE, mode);
  } catch {
    // préférence perdue, sans conséquence
  }
}

const texteArticle = (a) => [a.nom, a.description, a.categorie, a.note_mj].map(propre).filter(Boolean).join(" · ");

// Les articles qui répondent : chaque mot cherché au début d'un mot du nom, de ce qu'en lisent les joueurs, de la
// catégorie ou de la note du MJ. Un article encore sans nom reste en vue : on est en train de l'écrire.
export function articlesTrouves(articles, recherche) {
  const motsQ = mots(recherche);
  if (!motsQ.length) return articles;
  return articles.filter((a) => !propre(a.nom) || placesDesMots(texteArticle(a), motsQ).trouves.size === motsQ.length);
}

// La ligne qui dit combien d'articles répondent, ou qu'aucun ne répond.
export function htmlCompte(total, trouves, recherche) {
  if (!propre(recherche)) return "";
  if (!trouves) return `<p class="vide compte-articles">Aucun article ne répond à « ${e(recherche.trim())} ».</p>`;
  return `<p class="aide compte-articles">${trouves === total ? `Les ${total} articles répondent` : `${trouves} article${trouves > 1 ? "s" : ""} sur ${total}`} à « ${e(recherche.trim())} ».</p>`;
}

const epuise = (a) => typeof a.stock === "number" && a.stock <= 0;

function prixHtml(a, ajustement) {
  const base = String(a.prix || "").trim();
  if (!base) return '<span class="sans-prix">sans prix</span>';
  const table = ajusterPrix(base, ajustement);
  return table !== base ? `${e(avecPo(table))}<small title="Prix de base, avant l'ajustement de la boutique">${e(base)}</small>` : e(avecPo(base));
}

function stockHtml(a) {
  if (typeof a.stock !== "number") return "";
  return a.stock <= 0 ? '<span class="epuise-mot">épuisé</span>' : `${a.stock} en stock`;
}

function ligne(a, { ajustement, vu, recherche, deplie, editeur }) {
  const ici = a.id === vu;
  const nom = propre(a.nom);
  const vendable = nom && !epuise(a);
  const marque = (t) => (recherche ? surligner(propre(t), recherche) : e(propre(t)));
  return `
    <li class="comptoir-article${a.cache ? " cache" : ""}${epuise(a) ? " epuise" : ""}${ici ? " de-pres" : ""}" data-article="${e(a.id)}">
      <div class="ligne-comptoir">
        <span class="vignette-article" title="Son dessin sur les étagères de la TV">${objetSvg(a, "vignette")}</span>
        <span class="article-comptoir">
          <span class="nom">${nom ? marque(a.nom) : "<i>Sans nom</i>"}</span>${a.cache ? '<span class="marque-cache" title="Caché aux joueurs : ni la TV ni leur coin ne le montrent">caché</span>' : ""}
          ${propre(a.description) ? `<span class="lu">${marque(a.description)}</span>` : ""}${propre(a.note_mj) ? `<span class="note-mj" title="Note du MJ">${marque(a.note_mj)}</span>` : ""}
        </span>
        <span class="prix-comptoir">${prixHtml(a, ajustement)}</span>
        <span class="stock-comptoir">${stockHtml(a)}</span>
        <span class="gestes-comptoir">
          <button class="mini" data-action="vendre" ${vendable ? "" : "disabled"} title="${epuise(a) ? "Épuisé : remettez du stock pour le vendre" : "Retire le prix de l'or d'un aventurier et lui donne l'article"}">Vendre à…</button>
          <button class="lien" data-action="${ici ? "toute-la-boutique" : "montrer-article"}">${ici ? "Ne plus le montrer de près" : "Montrer de près"}</button>
          <button class="lien deplier" data-action="deplier" aria-expanded="${deplie}" title="${deplie ? "Replier l'article" : "Tous ses champs : prix, stock, catégorie, dessin, caché aux joueurs…"}">${deplie ? "Replier" : "Modifier"}</button>
        </span>
      </div>
      ${deplie ? `<ol class="articles-mj">${editeur(a)}</ol>` : ""}
    </li>`;
}

// Le comptoir : un rayon par catégorie, son nom à gauche, ses articles à droite, une ligne chacun. groupes : ceux de
// grouper() ; deplies : les articles dont l'éditeur est ouvert ; editeur(article) : son éditeur complet (boutiques.js).
export function htmlComptoir(groupes, { ajustement = 0, vu = null, recherche = "", deplies = new Set(), editeur }) {
  return `<div class="comptoir-boutique">${groupes.map((g) => `
    <section class="rayon-comptoir" data-categorie="${e(g.categorie)}">
      <h3>${e(g.categorie || "Sans catégorie")}<span class="compte">${g.articles.length}</span></h3>
      <ol class="lignes-comptoir">${g.articles.map((a) => ligne(a, { ajustement, vu, recherche, deplie: deplies.has(a.id), editeur })).join("")}</ol>
    </section>`).join("")}</div>`;
}
