// La feuille des billets secrets d'une séance, à imprimer et découper (/billets?seance=<id>). Un billet par héros
// destinataire, dans l'ordre du déroulé : le prénom en tête (il reste dehors une fois plié), le texte au parchemin,
// puis le rabat qui se replie sur lui. Le repère de la scène est discret (son rang et son heure, pas son titre).
// Une page de l'atelier : elle lit la séance et la tablée par les routes de l'atelier, fermées à la table publique.

import { api, echapper as e } from "../api.js";
import { billetsOrdonnes, destinataires, prenom, repereDeScene } from "./billets.js";

const page = document.getElementById("page");
const id = new URLSearchParams(location.search).get("seance") || "";
const MM = 96 / 25.4;
// Un billet ne doit jamais être coupé entre deux pages, et ne doit pas non plus prendre une page à lui seul : au-delà d'un
// tiers de page il passe sur toute la largeur, puis son texte se resserre (jamais sous 0,82 fois sa taille), jusqu'à tenir
// dans ce que la page imprimée offre (277 mm de haut, 190 mm de large, marges de 10 mm).
const HAUT_CARTE = (277 / 3) * MM;
const HAUT_PAGE = 270 * MM;
const TAILLES_TEXTE = [1.2, 1.12, 1.05, 1, .94, .88, .82];

// Un exemplaire : pour un héros (j), ou sans destinataire encore (une ligne à remplir à la main).
function htmlExemplaire(s, b, j, autres) {
  const repere = repereDeScene(s, b);
  const titre = (b.titre || "").trim();
  return `
    <article class="billet-papier">
      <header class="dehors">
        <span class="sceau" aria-hidden="true"></span>
        <p class="pour"><span>Pour</span>${j ? `<b>${e(prenom(j))}</b>` : '<b class="a-remplir"></b>'}</p>
        <p class="qui">${j?.joueur ? e(j.joueur) : ""}${repere ? `<small>${e(repere)}</small>` : ""}</p>
      </header>
      <div class="dedans">
        ${titre ? `<h2>${e(titre)}</h2>` : ""}
        <p class="texte">${e((b.texte || "").trim())}</p>
        ${autres.length ? `<p class="aussi">Aussi remis à ${e(autres.map(prenom).join(", ").replace(/, ([^,]*)$/, " et $1"))}.</p>` : ""}
      </div>
      <div class="rabat"><p>Repliez ce rabat sur le texte.</p></div>
    </article>`;
}

// Mesure chaque billet tel qu'il sera imprimé (page A4 de 190 mm de large utile, hors de l'écran, quelle que soit la largeur de
// l'écran) et décide : pleine largeur et taille du texte. Rend les billets qui ne tiennent pas même au plus petit texte.
function ajusterBillets(exemplaires) {
  const mesure = document.createElement("div");
  mesure.className = "mesure-billets";
  mesure.innerHTML = `<div class="grille-billets">${exemplaires.join("")}</div>`;
  document.body.appendChild(mesure);
  const reels = Array.prototype.slice.call(page.querySelectorAll(".billet-papier"));
  const modeles = Array.prototype.slice.call(mesure.querySelectorAll(".billet-papier"));
  const trop = [];
  modeles.forEach((m, i) => {
    const reglages = { large: false, taille: TAILLES_TEXTE[0] };
    const mesurer = () => {
      m.classList.toggle("large", reglages.large);
      m.style.setProperty("--taille-texte", `${reglages.taille}em`);
      return m.offsetHeight;
    };
    let h = mesurer();
    if (h > HAUT_CARTE) {
      reglages.large = true;
      h = mesurer();
    }
    for (let t = 1; h > HAUT_PAGE * (reglages.large ? 0.6 : 1) && t < TAILLES_TEXTE.length; t++) {
      reglages.taille = TAILLES_TEXTE[t];
      h = mesurer();
    }
    // Encore trop haut : tout ce que la page peut porter, texte au plus petit.
    for (let t = 1; h > HAUT_PAGE && t < TAILLES_TEXTE.length; t++) {
      reglages.taille = TAILLES_TEXTE[t];
      h = mesurer();
    }
    if (h > HAUT_PAGE) trop.push(i);
    reels[i].classList.toggle("large", reglages.large);
    reels[i].style.setProperty("--taille-texte", `${reglages.taille}em`);
    reels[i].dataset.reduit = reglages.taille < TAILLES_TEXTE[0] ? "1" : "";
  });
  // Les pages d'après la mesure : les rangées (deux billets, ou un billet pleine largeur) se posent l'une sous l'autre, et une
  // rangée qui ne tient pas dans le reste de la page passe à la suivante.
  const rangees = [];
  let ouverte = null;
  for (const m of modeles) {
    if (m.classList.contains("large")) {
      rangees.push(m.offsetHeight);
      ouverte = null;
    } else if (ouverte !== null) {
      rangees[ouverte] = Math.max(rangees[ouverte], m.offsetHeight);
      ouverte = null;
    } else {
      rangees.push(m.offsetHeight);
      ouverte = rangees.length - 1;
    }
  }
  const pageUtile = 277 * MM;
  const ecart = 5 * MM;
  let pages = 1;
  let y = 0;
  for (const h of rangees) {
    if (y > 0 && y + ecart + h > pageUtile) {
      pages++;
      y = h;
    } else y += (y > 0 ? ecart : 0) + h;
  }
  mesure.remove();
  return { trop, pages, reduits: reels.filter((r) => r.dataset.reduit).length };
}

async function construire() {
  if (!id) throw new Error("aucune séance demandée");
  const [s, campagne] = await Promise.all([`/api/seances/${encodeURIComponent(id)}`, "/api/campagne"].map((u) => api.get(u)));
  const tablee = campagne.tablee || [];
  document.title = `Séance ${s.numero ?? ""} · billets secrets`;
  document.querySelector(".retour").href = `/#/seances/${encodeURIComponent(s.id)}`;
  const billets = billetsOrdonnes(s);
  const ecrits = billets.filter((b) => (b.texte || "").trim());
  const sansTexte = billets.length - ecrits.length;
  const exemplaires = ecrits.flatMap((b) => {
    const heros = destinataires(b, tablee);
    return heros.length ? heros.map((j) => htmlExemplaire(s, b, j, heros.filter((x) => x !== j))) : [htmlExemplaire(s, b, null, [])];
  });
  const sansHeros = ecrits.filter((b) => !destinataires(b, tablee).length).length;
  page.innerHTML = exemplaires.length ? `
    <p class="tete-billets">Séance ${e(s.numero ?? "")}${s.nom ? ` · ${e(s.nom)}` : ""} · billets secrets</p>
    <div class="grille-billets">${exemplaires.join("")}</div>` : `
    <p class="aucun">Aucun billet écrit pour cette séance. Dans <a href="/#/seances/${e(encodeURIComponent(s.id))}">Préparer</a>, « Ajouter un billet » sous « Sous la main », puis rouvrez cette feuille.</p>`;
  await document.fonts.ready;
  const avis = [];
  const bouton = document.querySelector('[data-action="imprimer"]');
  // Rien à imprimer : le bouton reste éteint, plutôt qu'une page A4 blanche.
  bouton.disabled = !exemplaires.length;
  bouton.title = exemplaires.length ? "" : "Aucun billet écrit : rien à imprimer.";
  if (exemplaires.length) {
    const { trop, pages, reduits } = ajusterBillets(exemplaires);
    avis.push(`${exemplaires.length} billet${exemplaires.length > 1 ? "s" : ""}, ${pages > 1 ? `sur ${pages} pages A4` : "sur une page A4"}, aucun coupé entre deux pages.`);
    if (reduits) avis.push(`${reduits > 1 ? `${reduits} billets longs ont` : "Un billet long a"} un texte resserré pour tenir sur la page.`);
    if (trop.length) avis.push(`${trop.length > 1 ? `${trop.length} billets sont` : "Un billet est"} trop long${trop.length > 1 ? "s" : ""} même en petit : raccourcissez le texte, il serait coupé.`);
  }
  if (sansHeros) avis.push(`${sansHeros > 1 ? `${sansHeros} billets n'ont` : "Un billet n'a"} pas de destinataire : le prénom s'écrit à la main.`);
  if (sansTexte) avis.push(`${sansTexte > 1 ? `${sansTexte} billets sans texte ne sont` : "Un billet sans texte n'est"} pas imprimé${sansTexte > 1 ? "s" : ""}.`);
  document.querySelector(".taille").textContent = avis.join(" ");
}

document.querySelector('[data-action="imprimer"]').addEventListener("click", () => window.print());

construire().catch((err) => {
  page.innerHTML = `<p class="chargement">Impossible de préparer les billets : ${e(err.message)}.</p>`;
});
