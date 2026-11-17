// Le « Précédemment », l'épisode, les rumeurs et les documents.

import { echapper } from "../api.js";
import { ajusterDocument, htmlDocument, imagesPretes, titreSurLePapier } from "../documents/rendu.js";
import { afficher, cacher } from "./ecran.js";
import { S, cartonRumeur, episode, feuilleTv, precedemment, telephone } from "./etat.js";
import { change, demandes, leger, lireJson, numeroter } from "./outils.js";
import { SOUS_TITRE } from "../campagne/nom.js";

// Le « Précédemment » n'est relu que pour une autre séance, ou quand son texte a changé (seance_maj).
async function montrerPrecedemment(etat) {
  if (!change("precedemment", etat ? [etat.seance, etat.seance_maj ?? null] : null)) return;
  const actuel = numeroter("precedemment");
  clearInterval(S.minuterieFonds);
  if (!etat) return cacher(precedemment, 1200);
  const d = await lireJson(`/api/table/precedemment/${encodeURIComponent(etat.seance)}`);
  if (!actuel()) return;
  if (!d) {
    delete demandes.precedemment;
    return cacher(precedemment, 1200);
  }
  const images = d.images || [];
  const fonds = precedemment.querySelector(".fonds");
  fonds.innerHTML = images.map((im, i) => `<img src="${echapper(im.url)}" alt="" class="${i ? "" : "actif"}">`).join("");
  precedemment.classList.toggle("sans-image", !images.length);
  if (images.length > 1) {
    let i = 0;
    S.minuterieFonds = setInterval(() => {
      const imgs = fonds.querySelectorAll("img");
      imgs[i].classList.remove("actif");
      i = (i + 1) % imgs.length;
      imgs[i].classList.add("actif");
    }, 9000);
  }
  // Le récit arrive phrase après phrase, comme lu par un narrateur.
  const phrases = String(d.texte || "").split(/(?<=[.!?…»])\s+(?=[A-ZÀ-ÝÉÈÊ«])/u);
  let delai = 1.8;
  precedemment.querySelector(".recit").innerHTML = phrases.map((p) => {
    const html = `<span style="animation-delay:${delai.toFixed(1)}s">${echapper(p)}</span>`;
    delai += Math.min(7, 1.4 + p.length * 0.05);
    return html;
  }).join(" ");
  afficher(precedemment);
}

// Le carton-titre d'épisode : fondu au noir, puis l'image de fond, « <sous-titre de la campagne> · Épisode N » et le titre, lettre
// après lettre. Relu pour une autre séance, ou quand le MJ le renvoie après avoir changé la séance (seance_maj).
async function montrerEpisode(etat) {
  if (!change("episode", etat ? [etat.seance, etat.seance_maj ?? null] : null)) return;
  const actuel = numeroter("episode");
  const img = episode.querySelector(".fond img");
  img.onload = img.onerror = null;
  if (!etat) return cacher(episode, 1200);
  const debut = Date.now();
  const d = await lireJson(`/api/table/episode/${encodeURIComponent(etat.seance)}`);
  if (!actuel()) return;
  if (!d) {
    delete demandes.episode;
    return cacher(episode, 1200);
  }
  // Sur un écran étroit, « · Épisode N » passe entier à la ligne. La séance d'un autre MJ : « · Quête annexe N ».
  episode.querySelector(".serie").innerHTML = `<span>${echapper(SOUS_TITRE)}</span>${d.numero ? ` <span>· ${echapper(d.suite || "Épisode")} ${echapper(d.numero)}</span>` : d.suite ? ` <span>· ${echapper(d.suite)}</span>` : ""}`;
  // Un mot ne se coupe jamais en fin de ligne ; le titre entier est écrit en moins de 2,4 s.
  const mots = String(d.titre || "").split(/\s+/).filter(Boolean);
  const pas = Math.min(0.08, 2.4 / Math.max(1, Array.from(mots.join("")).length));
  let rang = 0;
  const zoneTitre = episode.querySelector(".titre-episode");
  zoneTitre.setAttribute("aria-label", mots.join(" "));
  zoneTitre.innerHTML = mots.map((mot) => `<span class="mot" aria-hidden="true">${Array.from(mot)
    .map((l) => `<span style="animation-delay:${(3.4 + pas * rang++).toFixed(2)}s">${echapper(l)}</span>`).join("")}</span>`).join(" ");
  // L'image s'allume une fois le noir posé, même arrivée plus tôt ; une image injoignable laisse le fond sombre.
  img.classList.remove("pret");
  episode.classList.toggle("sans-image", !d.image);
  const allumer = () => {
    if (!actuel()) return;
    img.style.transitionDelay = `${Math.max(0, 1.4 - (Date.now() - debut) / 1000).toFixed(2)}s`;
    img.classList.add("pret");
  };
  episode.classList.remove("joue");
  void episode.offsetWidth; // les animations du générique repartent de zéro
  episode.classList.add("joue");
  afficher(episode);
  if (!d.image) return img.removeAttribute("src");
  img.onerror = () => {
    if (actuel()) episode.classList.add("sans-image");
  };
  img.onload = allumer;
  if (img.getAttribute("src") === d.image && img.complete && img.naturalWidth) allumer();
  else img.src = d.image;
}

async function montrerRumeur(id) {
  if (!change("rumeur", id || null)) return;
  const actuel = numeroter("rumeur");
  if (!id) return cacher(cartonRumeur, 700);
  let x = await lireJson(`/api/table/rumeur/${encodeURIComponent(id)}`);
  if (!actuel()) return;
  if (!x) {
    // Un premier refus peut n'être que l'écart entre l'envoi du carton et l'enregistrement de la fiche : un second essai.
    await new Promise((fini) => setTimeout(fini, 700));
    if (!actuel()) return;
    x = await lireJson(`/api/table/rumeur/${encodeURIComponent(id)}`);
    if (!actuel()) return;
  }
  if (!x) {
    delete demandes.rumeur;
    return cacher(cartonRumeur, 700);
  }
  cartonRumeur.querySelector(".texte").textContent = `« ${x.texte || ""} »`;
  cartonRumeur.querySelector(".source").textContent = x.source ? `Raconté par ${x.source}` : "Entendu au comptoir";
  cartonRumeur.classList.remove("visible");
  afficher(cartonRumeur);
}

// La feuille tient dans l'écran, à la taille de l'écran d'à présent : refaite à chaque redimensionnement (une fenêtre qu'on
// rétrécit, une tablette qu'on tourne), sans quoi le titre ou le sceau sortiraient du cadre.
function ajusterPapier() {
  if (feuilleTv.hidden) return;
  const article = feuilleTv.querySelector(".papier-tv .document");
  if (!article) return;
  if (telephone()) {
    article.style.fontSize = "";
    article.style.width = "";
    const t = article.querySelector(".doc-texte");
    if (t) t.style.columnCount = "";
    feuilleTv.classList.remove("defile");
    return;
  }
  const legende = feuilleTv.querySelector(".legende-doc").offsetHeight;
  const k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  const hauteur = window.innerHeight * 0.94 - legende - 24;
  const reglages = { depart: 36 * Math.max(k, 0.5), min: 7 };
  const texte = article.querySelector(".doc-texte");
  if (article.classList.contains("doc-long") && texte && window.innerWidth >= 700) {
    // Un long texte : deux colonnes sur une feuille étroite, ou trois sur une feuille large (un écran en largeur) ; on garde
    // la mise en page qui laisse le texte le plus grand.
    let meilleure = null;
    for (const [colonnes, largeur] of [[2, 50], [3, 78]]) {
      article.style.width = `${largeur}em`;
      texte.style.columnCount = colonnes;
      const taille = ajusterDocument(article, window.innerWidth * 0.94, hauteur, reglages);
      if (!meilleure || taille > meilleure.taille * 1.03) meilleure = { colonnes, largeur, taille };
    }
    article.style.width = `${meilleure.largeur}em`;
    texte.style.columnCount = meilleure.colonnes;
  }
  ajusterDocument(article, window.innerWidth * 0.94, hauteur, reglages);
  // Un document démesuré, qui ne tient pas même en petit : la feuille défile plutôt que de sortir de l'écran.
  feuilleTv.classList.toggle("defile", article.offsetHeight > hauteur + 1);
}

// Un document remis aux joueurs (documents/rendu.js) : la lettre, l'affiche ou le plan en grand sur la table de chêne, à
// la plus grande taille qui tient dans l'écran, une fois ses images posées. Le serveur ne le donne que tant que la TV le
// montre, sans les notes du MJ ; relu quand le MJ le retouche (document_maj). Sur un téléphone (la table publique), il
// prend la largeur de l'écran et défile.
async function montrerDocument(etat) {
  if (!change("document", etat ? [etat.document, etat.document_maj ?? null] : null)) return;
  const actuel = numeroter("document");
  if (!etat) return cacher(feuilleTv, 900);
  const d = await lireJson(`/api/table/document/${encodeURIComponent(etat.document)}`);
  if (!actuel()) return;
  if (!d) {
    delete demandes.document;
    return cacher(feuilleTv, 900);
  }
  const papier = feuilleTv.querySelector(".papier-tv");
  const entree = !feuilleTv.classList.contains("visible");
  papier.innerHTML = htmlDocument(d, { image: (u) => leger(u, 640) });
  feuilleTv.querySelector(".legende-doc").textContent = titreSurLePapier(d) ? "" : d.nom || "";
  feuilleTv.hidden = false; // encore transparent : mesurable sans être vu
  await imagesPretes(papier);
  if (document.fonts) await document.fonts.ready;
  if (!actuel()) return;
  const article = papier.querySelector(".document");
  ajusterPapier();
  if (!entree) article.style.animation = "none"; // retouché pendant qu'il est montré : il change sans revenir
  afficher(feuilleTv);
}

export { ajusterPapier, montrerDocument, montrerEpisode, montrerPrecedemment, montrerRumeur };
