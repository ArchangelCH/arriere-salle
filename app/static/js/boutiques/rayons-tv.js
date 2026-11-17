// L'échoppe de la TV, rangée pour l'écran du moment : les rayons dans l'ordre du MJ, une rangée après l'autre, et la
// disposition qui donne les plus grands objets. Sans page : table.js s'en sert, outils/verifier_rayons.mjs le vérifie.

import { grouper } from "./commun.js";

// Les rayons dans l'ordre du MJ (celui de l'atelier), rangée après rangée, au plus `place` articles par rangée : un
// rayon qui ne tient plus dans la rangée commencée passe à la suivante, quitte à laisser une étagère moins pleine ; un
// rayon plus long qu'une rangée entière la remplit et continue sur la suivante, sa plaque répétée.
export function rangerRayons(articles, place) {
  const rangees = [];
  let morceaux = 0;
  let courante = null;
  for (const g of grouper(articles)) {
    let reste = g.articles;
    while (reste.length) {
      const libre = courante ? place - courante.n : 0;
      if (!courante || (libre < reste.length && reste.length <= place) || libre <= 0) {
        courante = { n: 0, morceaux: [] };
        rangees.push(courante);
      }
      const pris = reste.slice(0, place - courante.n);
      courante.morceaux.push({ categorie: g.categorie, articles: pris });
      courante.n += pris.length;
      reste = reste.slice(pris.length);
      morceaux++;
    }
  }
  return { rangees: rangees.map((r) => r.morceaux), morceaux };
}

// L'échoppe est dessinée pour un écran de 1080 pixels de haut : l'enseigne et l'accroche au-dessus des étagères, une
// rangée (objet, planche, étiquette), la largeur d'un article, les marges. --k la met à l'échelle de l'écran.
export const DESSIN = { haut: 214, bas: 62, marge: 56, rangee: 300, article: 222 };

// La disposition qui donne les plus grands objets : tant d'articles par rangée au plus, les rayons dans l'ordre du MJ.
// À taille égale (l'écran limite par la hauteur), le moins de rayons coupés, puis le moins de rangées. Sur un
// téléphone, deux articles par planche, et l'échoppe défile.
export function disposition(articles, largeur, hauteur) {
  const n = Math.max(1, articles.length);
  if (largeur < 700) {
    const r = rangerRayons(articles, 2);
    return { rangees: r.rangees, k: Math.min(1.1, largeur / (2 * DESSIN.marge + 2 * DESSIN.article)) };
  }
  let meilleure = null;
  for (let place = 1; place <= n; place++) {
    const r = rangerRayons(articles, place);
    if (r.rangees.length > 6) continue;
    const plus = Math.max.apply(null, r.rangees.map((x) => x.reduce((t, m) => t + m.articles.length, 0)));
    const k = Math.min(1.6, largeur / (2 * DESSIN.marge + plus * DESSIN.article), hauteur / (DESSIN.haut + DESSIN.bas + r.rangees.length * DESSIN.rangee));
    const mieux = !meilleure || k > meilleure.k + 0.005
      || (Math.abs(k - meilleure.k) <= 0.005 && (r.morceaux < meilleure.morceaux || (r.morceaux === meilleure.morceaux && r.rangees.length < meilleure.rangees.length)));
    if (mieux) meilleure = { rangees: r.rangees, morceaux: r.morceaux, k };
  }
  return meilleure;
}

// Une boutique trop grande pour un écran (E07) : la TV la montre par rayon, et le MJ fait défiler les rayons depuis
// l'atelier ou la télécommande, au lieu de tout serrer. « Trop grande » se juge sur une TV 1080p, la même pour tous
// les écrans : l'atelier, la télécommande et la TV comptent les mêmes pages. Au-dessous de cette échelle, les noms
// passent sous 22 pixels : l'échoppe de Torvin (18 articles, 0,92) tient sur un écran, 27 articles non.
export const ECHELLE_LISIBLE = 0.88;
const lisible = (articles) => disposition(articles, 1920, 1080).k >= ECHELLE_LISIBLE;

// Les articles que la TV reçoit, dans l'ordre de l'atelier : les visibles, nommés, le rayon aux blancs resserrés
// (boutique_publique de api/tv_boutique_combat.py). L'atelier et la télécommande partent de la fiche entière.
export const articlesDeLaTv = (articles) => (articles || []).filter((a) => a && !a.cache && String(a.nom || "").trim())
  .map((a) => ({ ...a, categorie: String(a.categorie || "").split(/\s+/).filter(Boolean).join(" ") }));

// Les pages de l'échoppe : les rayons dans l'ordre du MJ, groupés tant qu'ils tiennent ensemble sur un écran ; un rayon
// trop long à lui seul se coupe en morceaux qui tiennent (« Armes », puis « Armes, suite »). Une seule page quand tout
// tient. Chaque page : { articles, nom } ; nom dit ses rayons (« Armures · Montures »).
export function pagesEchoppe(articles) {
  const tous = articles || [];
  if (!tous.length || lisible(tous)) return [{ articles: tous, nom: "" }];
  const morceaux = [];
  for (const g of grouper(tous)) {
    let reste = g.articles;
    let n = 0;
    while (reste.length) {
      // Une page lisible tient moins de 40 articles (27 à l'échelle voulue) : la recherche part de là.
      let taille = Math.min(reste.length, 40);
      while (taille > 1 && !lisible(reste.slice(0, taille))) taille--;
      morceaux.push({ articles: reste.slice(0, taille), nom: `${g.categorie || "Le reste"}${n ? ", suite" : ""}` });
      reste = reste.slice(taille);
      n++;
    }
  }
  const pages = [];
  for (const m of morceaux) {
    const page = pages[pages.length - 1];
    if (page && lisible(page.articles.concat(m.articles))) {
      page.articles = page.articles.concat(m.articles);
      page.noms.push(m.nom);
    } else pages.push({ articles: m.articles, noms: [m.nom] });
  }
  return pages.map((p) => ({ articles: p.articles, nom: p.noms.join(" · ") }));
}

// La page à montrer : celle que demande l'état de la table (rayon), bornée ; la première sinon.
export const pageDemandee = (pages, rayon) => (Number.isInteger(rayon) ? Math.max(0, Math.min(pages.length - 1, rayon)) : 0);

// La page qui porte un article (pour le montrer de près sur son rayon) ; 0 s'il n'y est pas.
export const pageDeLArticle = (pages, id) => Math.max(0, pages.findIndex((p) => p.articles.some((a) => a.id === id)));
