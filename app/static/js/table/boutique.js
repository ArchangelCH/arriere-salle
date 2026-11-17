// L'échoppe à la TV.

import { echapper } from "../api.js";
import { avecPo } from "../boutiques/commun.js";
import { DESSIN, disposition, pageDemandee, pagesEchoppe } from "../boutiques/rayons-tv.js";
import { objetSvg } from "../boutiques/objets.js";
import { afficher, cacher } from "./ecran.js";
import { boutiqueTv } from "./etat.js";
import { leger, lireJson, numeroter } from "./outils.js";

// Une boutique du MJ : l'échoppe du marchand (table.css) : l'enseigne, le marchand s'il est connu, puis les étagères où
// chaque article est peint (boutiques/objets.js) avec son étiquette de prix, un article épuisé grisé et barré. Relue à
// chaque état reçu, comme la planche (un prix changé dans l'atelier change aussitôt ici), redessinée seulement si elle
// a changé. Avec `article`, cet article en grand par-dessus.
let boutiqueVue = "";
let articleVu = "";
let articlesBoutique = [];
let rayonVu = -1;

// La pancarte en haut à gauche de l'échoppe : « Rayon 1 sur 3 » quand la boutique se montre par rayon (E07). Rien n'y
// renvoie les joueurs à leur téléphone : pendant la partie, tout passe par la TV, le papier et le MJ.
function majPancarte(pages, rayon) {
  const pancarte = boutiqueTv.querySelector(".pancarte-tv");
  const page = pancarte.querySelector(".page-rayon-tv");
  page.hidden = pages.length < 2;
  if (pages.length > 1) {
    page.querySelector("b").textContent = `Rayon ${rayon + 1} sur ${pages.length}`;
    page.querySelector(".ensuite").textContent = pages[rayon + 1] ? `ensuite : ${pages[rayon + 1].nom}` : "le dernier rayon";
  }
  pancarte.classList.toggle("sans-rayon", pages.length < 2);
  pancarte.hidden = pages.length < 2;
}

const PENCHES = [-3.5, 2, -1.5, 3, -2.5, 1.5];

// À trois mètres, l'étiquette ne porte que le nom et le prix, en grand ; la description attend que le MJ montre
// l'article de près.
function htmlArticleTv(a, k) {
  return `<div class="article-tv${a.epuise ? " epuise" : ""}">${objetSvg(a)}${a.epuise ? '<i class="mention">épuisé</i>' : ""}
      <div class="etiquette-tv" style="transform:rotate(${PENCHES[k % PENCHES.length]}deg)"><b>${echapper(a.nom)}</b><span class="prix">${echapper(avecPo(a.prix))}</span></div>
    </div>`;
}

// Les chiffres de Cinzel font d'un 1 un I : dans le nom en grand (« Potion de soins (1D6+2) »), ils passent en Garamond.
const chiffresGaramond = (texte) => String(texte || "").split(/(\d+)/).map((x, i) => (i % 2 ? `<span class="chiffres">${x}</span>` : echapper(x))).join("");

// De près : l'objet en grand, puis son étiquette.
function htmlArticleDePres(a) {
  return `${objetSvg(a)}${a.categorie ? `<p class="categorie">${echapper(a.categorie)}</p>` : ""}
    <h2 class="nom">${chiffresGaramond(a.nom)}</h2>
    <span class="filet" aria-hidden="true"></span>
    <p class="prix${a.epuise ? " epuise" : ""}">${echapper(avecPo(a.prix))}${a.epuise ? '<i class="mention">épuisé</i>' : ""}</p>
    ${a.description ? `<p class="description">${echapper(a.description)}</p>` : ""}`;
}

// Une étiquette qui descend jusqu'aux objets de la rangée du dessous (un nom long sur trois lignes) ou sous le bas de
// l'échoppe, ou un objet de la première rangée qui monte sur l'accroche. Tout se mesure dans l'échoppe, qui glisse
// pendant son entrée.
function debordeBoutique(etageres) {
  const lignes = etageres.querySelectorAll(".rangee-tv");
  const fond = boutiqueTv.querySelector(".echoppe").getBoundingClientRect().bottom;
  for (let i = 0; i < lignes.length; i++) {
    let bas = 0;
    const etiquettes = lignes[i].querySelectorAll(".etiquette-tv");
    for (let j = 0; j < etiquettes.length; j++) bas = Math.max(bas, etiquettes[j].getBoundingClientRect().bottom);
    let limite = fond - 4;
    if (i + 1 < lignes.length) {
      const objets = lignes[i + 1].querySelectorAll(".objet");
      for (let j = 0; j < objets.length; j++) limite = Math.min(limite, objets[j].getBoundingClientRect().top - 4);
    }
    if (bas > limite) return true;
  }
  const haut = etageres.getBoundingClientRect().top;
  const premiers = lignes.length ? lignes[0].querySelectorAll(".objet") : [];
  for (let j = 0; j < premiers.length; j++) if (premiers[j].getBoundingClientRect().top < haut - 1) return true;
  return false;
}

// Les étagères rangées pour l'écran du moment, puis l'échelle réduite d'un cran tant qu'une étiquette déborde.
function ajusterBoutique() {
  const echoppe = boutiqueTv.querySelector(".echoppe");
  const etageres = echoppe.querySelector(".etageres-tv");
  const largeur = echoppe.clientWidth || window.innerWidth;
  if (!articlesBoutique.length) {
    boutiqueTv.style.setProperty("--k", Math.min(1, largeur / 1200, window.innerHeight / 1080).toFixed(3));
    etageres.innerHTML = '<p class="rien">Rien à vendre pour l\'instant.</p>';
    return;
  }
  const d = disposition(articlesBoutique, largeur, window.innerHeight);
  etageres.style.bottom = "";
  let rang = 0;
  etageres.innerHTML = d.rangees.map((morceaux) => `<section class="rangee-tv">${morceaux.map((m) => `<div class="rayon-tv" style="--n:${m.articles.length}">
      <span class="planche-tv"></span>${m.categorie ? `<span class="plaque-tv">${echapper(m.categorie)}</span>` : ""}${m.articles.map((a) => htmlArticleTv(a, rang++)).join("")}</div>`).join("")}</section>`).join("");
  let k = d.k;
  boutiqueTv.style.setProperty("--k", k.toFixed(3));
  if (largeur < 700) return;
  // Sous la dernière rangée, la place de ses étiquettes les plus longues (elles suivent l'échelle : la réduire n'y
  // changerait rien).
  const lignes = etageres.querySelectorAll(".rangee-tv");
  const derniere = lignes[lignes.length - 1];
  if (derniere) {
    const fond = derniere.getBoundingClientRect().bottom;
    let bas = fond;
    const etiquettes = derniere.querySelectorAll(".etiquette-tv");
    for (let j = 0; j < etiquettes.length; j++) bas = Math.max(bas, etiquettes[j].getBoundingClientRect().bottom);
    etageres.style.bottom = `calc(var(--k) * ${Math.max(DESSIN.bas, Math.ceil((bas - fond) / k) + 12)}px)`;
  }
  for (let essai = 0; essai < 8 && debordeBoutique(etageres); essai++) {
    k *= 0.95;
    boutiqueTv.style.setProperty("--k", k.toFixed(3));
  }
}

async function montrerBoutique(etat) {
  const actuel = numeroter("boutique");
  if (!etat) {
    boutiqueVue = articleVu = "";
    rayonVu = -1;
    return cacher(boutiqueTv, 900);
  }
  const b = await lireJson(`/api/table/boutique/${encodeURIComponent(etat.boutique)}`);
  if (!actuel()) return;
  if (!b || !Array.isArray(b.articles)) {
    boutiqueVue = articleVu = "";
    return cacher(boutiqueTv, 900);
  }
  const echoppe = boutiqueTv.querySelector(".echoppe");
  const entree = !boutiqueTv.classList.contains("visible");
  // Trop grande pour un écran : un rayon à la fois, celui que le MJ fait défiler (rayons-tv.js).
  const pages = pagesEchoppe(b.articles);
  const rayon = pageDemandee(pages, etat.rayon);
  const html = JSON.stringify([b.nom, b.accroche, b.marchand, b.portrait || "", b.articles, rayon]);
  if (html !== boutiqueVue || entree) {
    const autreRayon = !entree && pages.length > 1 && rayon !== rayonVu;
    boutiqueVue = html;
    rayonVu = rayon;
    const chez = echoppe.querySelector(".chez");
    // « Chez le marchand nain » : l'article du nom suit « chez » en minuscule.
    chez.textContent = b.marchand ? `Chez ${b.marchand.replace(/^(Le|La|Les|L')(?=[\s'’])/, (m) => m.toLowerCase())}` : "";
    chez.hidden = !b.marchand;
    echoppe.querySelector(".nom-boutique").textContent = b.nom || "";
    const accroche = echoppe.querySelector(".accroche");
    accroche.textContent = b.accroche || "";
    accroche.hidden = !b.accroche;
    // Le marchand dans son cadre, seulement s'il est connu des joueurs et qu'il a un portrait.
    const marchand = echoppe.querySelector(".marchand-tv");
    const avecPortrait = Boolean(b.marchand && b.portrait);
    marchand.hidden = !avecPortrait;
    marchand.querySelector(".cadre").style.backgroundImage = avecPortrait ? `url("${leger(b.portrait, 320)}")` : "";
    marchand.querySelector("figcaption").textContent = avecPortrait ? b.marchand.replace(/^(Le|La|Les|L')(?=[\s'’])\s*/, "").split(/\s+/)[0] : "";
    articlesBoutique = pages[rayon].articles;
    majPancarte(pages, rayon);
    boutiqueTv.hidden = false; // encore transparente : mesurable sans être vue
    ajusterBoutique();
    if (autreRayon) {
      const etageres = echoppe.querySelector(".etageres-tv");
      etageres.classList.remove("autre-rayon");
      void etageres.offsetWidth; // le rayon suivant glisse à sa place
      etageres.classList.add("autre-rayon");
    }
    // Une police arrivée après la mesure (l'écriture de l'enseigne, de « épuisé ») : l'échoppe se range de nouveau.
    if (document.fonts) document.fonts.ready.then(() => {
      if (boutiqueVue === html) ajusterBoutique();
    });
  }
  const zoom = boutiqueTv.querySelector(".zoom-article");
  const fiche = zoom.querySelector(".article-de-pres");
  const choisi = etat.article ? b.articles.find((a) => a.id && a.id === etat.article) : null;
  boutiqueTv.classList.toggle("focus", Boolean(choisi));
  if (choisi) {
    const contenu = htmlArticleDePres(choisi);
    if (zoom.hidden || zoom.dataset.article !== choisi.id) {
      fiche.innerHTML = contenu;
      fiche.classList.remove("approche");
      void fiche.offsetWidth; // l'article approche de nouveau
      fiche.classList.add("approche");
    } else if (contenu !== articleVu) fiche.innerHTML = contenu;
    articleVu = contenu;
    zoom.dataset.article = choisi.id;
    zoom.hidden = false;
  } else {
    zoom.hidden = true;
    zoom.dataset.article = articleVu = "";
  }
  if (entree) {
    echoppe.classList.remove("entree");
    void echoppe.offsetWidth; // l'échoppe monte de nouveau à chaque fois qu'on la montre
    echoppe.classList.add("entree");
    afficher(boutiqueTv);
  }
}

export { ajusterBoutique, montrerBoutique };
