// Les documents remis aux joueurs, dessinés d'une seule main pour la TV (table.js), l'aperçu de l'atelier, la page
// imprimée et le carnet des joueurs : le même papier partout (css/documents.css), mesuré en em, qui grandit d'un bloc
// avec la taille de police de son cadre. La TV (Chromium 79) le lit et le coin des joueurs le sert : rien que du DOM
// ancien, et chaque texte passe par echapper.

import { echapper as e } from "../api.js";

export const GENRES_DOCUMENT = [
  { cle: "lettre", nom: "Lettre manuscrite", court: "Lettre" },
  { cle: "affiche", nom: "Affiche", court: "Affiche" },
  { cle: "note", nom: "Note griffonnée", court: "Note" },
  { cle: "parchemin", nom: "Parchemin officiel", court: "Parchemin" },
  { cle: "plan", nom: "Plan griffonné", court: "Plan" },
];

export const genreDocument = (d) => GENRES_DOCUMENT.find((g) => g.cle === (d && d.genre)) || GENRES_DOCUMENT[0];
// L'affiche, le parchemin et le plan portent leur titre ; une lettre et une note n'en ont pas, le titre les légende.
export const titreSurLePapier = (d) => ["affiche", "parchemin", "plan"].indexOf(genreDocument(d).cle) >= 0;
// Le sceau de cire : celui que le MJ a choisi ; sans choix, seul le parchemin officiel en porte un (documents.py).
export const sceauDe = (d) => (d && typeof d.sceau === "boolean" ? d.sceau : genreDocument(d).cle === "parchemin");

// Au-delà, le texte coule sur deux colonnes : une longue lettre tient dans l'écran sans devenir minuscule.
const LONG = 1100;
// Le papier penche un peu, toujours du même côté pour le même document ; la note griffonnée, davantage.
const PENCHE = { lettre: 1.6, affiche: 2.4, note: 4, parchemin: 0.8, plan: 1.8 };

function penche(graine, amplitude) {
  let h = 0;
  const t = String(graine || "");
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
  return (((Math.abs(h) % 200) / 100 - 1) * amplitude).toFixed(2);
}

// Un paragraphe par ligne vide ; un simple retour à la ligne reste un retour à la ligne.
function paragraphes(texte) {
  return String(texte || "").replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${e(p).replace(/\n/g, "<br>")}</p>`).join("");
}

// d : { id, genre, nom, texte, signature, image, sceau } (la partie publique, ou la fiche de l'atelier) ; image(url) :
// l'adresse à charger (la table publique prend une image réduite). Le titre d'une lettre ou d'une note n'y est pas :
// l'appelant le pose en légende s'il le veut (titreSurLePapier).
export function htmlDocument(d, { image = (u) => u } = {}) {
  const g = genreDocument(d).cle;
  const titre = String(d.nom || "").trim();
  const texte = String(d.texte || "").trim();
  const signature = String(d.signature || "").trim();
  const url = d.image ? image(d.image) : "";
  const classes = ["document", `doc-${g}`, texte.length > LONG ? "doc-long" : "", url ? "avec-image" : "", url && !texte ? "image-seule" : ""];
  return `<article class="${classes.filter(Boolean).join(" ")}" style="--r:${penche(d.id || titre, PENCHE[g])}deg">
    ${g === "affiche" ? '<span class="doc-clou" aria-hidden="true"></span>' : ""}${g === "parchemin" ? '<span class="doc-rouleau haut" aria-hidden="true"></span><span class="doc-rouleau bas" aria-hidden="true"></span>' : ""}
    ${titreSurLePapier(d) && titre ? `<h2 class="doc-titre">${e(titre)}</h2>` : ""}${g === "parchemin" && titre ? '<span class="doc-filet" aria-hidden="true"></span>' : ""}
    ${url ? `<figure class="doc-image"><img src="${e(url)}" alt=""></figure>` : ""}
    ${texte ? `<div class="doc-texte">${paragraphes(texte)}</div>` : ""}
    ${signature ? `<p class="doc-signature">${e(signature)}</p>` : ""}
    ${sceauDe(d) ? '<span class="doc-sceau" aria-hidden="true"></span>' : ""}
    ${!titre && !texte && !signature && !url ? '<p class="doc-vide">Une feuille encore blanche.</p>' : ""}
  </article>`;
}

// La plus grande taille (en px) qui fait tenir le document dans largeur × hauteur : elle part de depart et descend d'un
// cran tant qu'il dépasse, sans passer sous min. el : l'article (.document). Rend la taille gardée.
export function ajusterDocument(el, largeur, hauteur, { depart = 24, min = 9 } = {}) {
  let taille = depart;
  el.style.fontSize = `${taille}px`;
  const deborde = () => el.offsetWidth > largeur + 1 || el.offsetHeight > hauteur + 1;
  for (let essai = 0; essai < 40 && taille > min && deborde(); essai++) {
    taille = Math.max(min, taille * 0.93);
    el.style.fontSize = `${taille.toFixed(2)}px`;
  }
  return taille;
}

// Une image qui ne vient pas laisse le papier sans cadre vide ; rend une promesse tenue quand toutes ont fini (ou au
// bout de delai), pour mesurer le document une fois ses images posées.
export function imagesPretes(racine, delai = 4000) {
  const images = Array.prototype.slice.call(racine.querySelectorAll(".doc-image img"));
  return Promise.all(images.map((img) => new Promise((fini) => {
    const fin = () => {
      if (!img.naturalWidth && img.parentNode) {
        const article = img.closest(".document");
        img.parentNode.remove();
        if (article) article.classList.remove("avec-image", "image-seule");
      }
      fini();
    };
    if (img.complete) return fin();
    img.addEventListener("load", fin, { once: true });
    img.addEventListener("error", fin, { once: true });
    setTimeout(fin, delai);
  })));
}
