// Le texte d'un scénario mis en page : Markdown simple (intertitres, listes, tableaux, filets), « > » pour le texte à
// lire aux joueurs, #mots-clés vers les idées, liens vers les fiches de l'atelier (#/pnj/…) ou la série. Les consignes
// [[…]] sont rendues par la page, qui sait où en est chacune.

import { echapper as e } from "../api.js";

const CONSIGNE = /\[\[[\s\S]*?\]\]/g;
const MARQUE = /\u0001(\d+)\u0001/g;
const SEULE = /^\s*\u0001(\d+)\u0001\s*$/;

function enLigne(texte, consigne) {
  const liens = [];
  const garder = (html) => `\u0002${liens.push(html) - 1}\u0002`;
  let h = e(texte);
  h = h.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (tout, lib, url) => {
    if (/^https?:\/\//.test(url)) return garder(`<a href="${url}" target="_blank" rel="noopener">${lib}</a>`);
    if (/^#\/[\w\-/?=&;%.]*$/.test(url)) return garder(`<a href="${url}">${lib}</a>`);
    return tout;
  });
  // Un lien court dont la fiche n'existe pas encore (liens-courts.js) : son nom, marqué, en attendant qu'elle existe.
  h = h.replace(/@\[([^[\]\n]+)\](?!\()/g, (tout, lib) => garder(`<span class="lien-court" title="Aucune fiche ne porte encore ce nom : « Lier une fiche » peut la créer.">${lib}</span>`));
  h = h.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, (_, av, url) => `${av}${garder(`<a href="${url}" target="_blank" rel="noopener">${url.replace(/^https?:\/\//, "")}</a>`)}`);
  h = h.replace(/(^|[^\p{L}\p{N}&/#])#([\p{L}\p{N}][\p{L}\p{N}_'’-]*)/gu, (_, av, mot) => {
    const propre = mot.replace(/['’-]+$/, "");
    return `${av}${garder(`<a class="mot" href="#/idees?mot=${encodeURIComponent(propre)}">#${propre}</a>`)}${mot.slice(propre.length)}`;
  });
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  h = h.replace(/\u0002(\d+)\u0002/g, (_, i) => liens[+i]);
  return h.replace(MARQUE, (_, i) => consigne(+i));
}

// Une liste et ses sous-listes : un élément plus en retrait (deux espaces ou plus) que le précédent lui appartient ;
// une liste numérotée garde son premier numéro, même coupée par une sous-liste.
function rendreListe(items, ligne) {
  const sortie = [];
  let i = 0;
  while (i < items.length) {
    const tete = items[i];
    const lis = [];
    while (i < items.length && items[i].retrait <= tete.retrait + 1 && items[i].genre === tete.genre) {
      const item = items[i++];
      const enfants = [];
      while (i < items.length && items[i].retrait > item.retrait + 1) enfants.push(items[i++]);
      lis.push(`<li>${ligne(item.texte)}${enfants.length ? rendreListe(enfants, ligne) : ""}</li>`);
    }
    const debut = tete.genre === "ol" && tete.numero !== 1 ? ` start="${tete.numero}"` : "";
    sortie.push(`<${tete.genre}${debut}>${lis.join("")}</${tete.genre}>`);
  }
  return sortie.join("");
}

// consigne(i, bloc) rend la i-ème consigne du texte : { html, apres } ; « apres » (la proposition d'une consigne prise
// dans une phrase) se place sous le paragraphe qui la contient.
export function rendre(texte, { consigne = () => ({ html: "" }) } = {}) {
  let n = 0;
  const source = (texte || "").replace(CONSIGNE, () => `\u0001${n++}\u0001`);
  const lignes = source.split("\n");
  const sortie = [];
  let apres = [];
  const ligne = (t) => enLigne(t, (i) => {
    const r = consigne(i, false) || {};
    if (r.apres) apres.push(r.apres);
    return r.html || "";
  });
  const deposer = (html) => {
    sortie.push(html);
    if (apres.length) sortie.push(...apres);
    apres = [];
  };
  let para = [];
  let liste = null;
  const fermerPara = () => {
    if (para.length) deposer(`<p>${para.map(ligne).join("<br>")}</p>`);
    para = [];
  };
  const fermerListe = () => {
    if (liste) deposer(rendreListe(liste, ligne));
    liste = null;
  };
  const fermer = () => {
    fermerPara();
    fermerListe();
  };
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];
    const seule = SEULE.exec(l);
    const titre = /^(#{1,4})\s+(.*)$/.exec(l);
    const puce = /^(\s*)[-*]\s+(.*)$/.exec(l);
    const numero = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(l);
    if (seule) {
      fermer();
      const r = consigne(+seule[1], true) || {};
      deposer(r.html || "");
    } else if (titre) {
      fermer();
      const niveau = Math.min(5, titre[1].length + 1);
      deposer(`<h${niveau}>${ligne(titre[2])}</h${niveau}>`);
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) {
      fermer();
      sortie.push("<hr>");
    } else if (/^\s*\|.*\|\s*$/.test(l)) {
      fermer();
      const rangs = [];
      while (i < lignes.length && /^\s*\|.*\|\s*$/.test(lignes[i])) rangs.push(lignes[i++]);
      i--;
      const cellules = (r) => r.trim().slice(1, -1).split("|").map((c) => c.trim());
      const [tete, ...reste] = rangs.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      // Une ligne de séparation seule (tableau en cours d'écriture) : rien à montrer, et l'aperçu ne doit pas tomber.
      if (!tete) continue;
      deposer(`<table><thead><tr>${cellules(tete).map((c) => `<th>${ligne(c)}</th>`).join("")}</tr></thead><tbody>${reste
        .map((r) => `<tr>${cellules(r).map((c) => `<td>${ligne(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
    } else if (/^\s*>/.test(l)) {
      // Les lignes « > » qui se suivent font un seul encadré, ses paragraphes séparés par une ligne « > » vide.
      fermer();
      const bloc = [];
      while (i < lignes.length && /^\s*>/.test(lignes[i])) bloc.push(lignes[i++].replace(/^\s*>\s?/, ""));
      i--;
      const paras = bloc.join("\n").split(/\n\s*\n/).map((p) => p.split("\n").map(ligne).join("<br>"));
      deposer(`<blockquote class="a-lire">${paras.map((p) => `<p>${p}</p>`).join("")}</blockquote>`);
    } else if (puce || numero) {
      fermerPara();
      (liste ||= []).push(puce ? { retrait: puce[1].length, genre: "ul", texte: puce[2] }
        : { retrait: numero[1].length, genre: "ol", numero: +numero[2], texte: numero[3] });
    } else if (!l.trim()) {
      fermer();
    } else if (liste && /^\s{2,}\S/.test(l)) {
      liste[liste.length - 1].texte += ` ${l.trim()}`;
    } else {
      fermerListe();
      para.push(l.trim());
    }
  }
  fermer();
  return sortie.join("\n");
}
