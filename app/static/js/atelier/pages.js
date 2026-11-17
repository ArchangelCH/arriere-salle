// Les pages Lieux et Table, et la page fermée à l'invité.

import { api, echapper as e, toast } from "../api.js";
import { TYPES_LIEUX } from "../carte/biomes.js";
import { ajouterBlocDesAventure } from "../jets/reserve-table.js";
import { ouvrirNouveauLieu } from "../lieux/nouveau-lieu.js";
import { filtrerLieux } from "../chercher/listes.js";
import { ajouterBlocTelecommande } from "../ecran-tv/relais-telecommande.js";
import { parLaMain } from "../mj/main-tv.js";
import { estInvite } from "../mj/role.js";
import { htmlPastillePartage, partageeParUnAutre } from "../mj/partage.js";
import { suivreTvSurLaPage } from "../ecran-tv/table-tv.js";
import { questionTvNoire } from "../ecran-tv/tv-noire.js";
import { rienDeRevele } from "../ecran-tv/tv-commun.js";
import { S, onglet, page } from "./etat.js";
import { perimee } from "./routeur.js";
import { TITRE_PRECEDEMMENT } from "../campagne/nom.js";

async function pageLieux(n = S.navigation) {
  onglet("lieux");
  page.innerHTML = `<section class="page-liste"><div class="chargement">Chargement des lieux…</div></section>`;
  const [lieux, cartes] = await Promise.all([api.get("/api/lieux"), api.get("/api/cartes")]);
  if (perimee(n)) return;
  const nomsCartes = Object.fromEntries(cartes.map((c) => [c.id, c.nom]));
  // Un lieu sans carte (jamais posé, ou sa carte à la corbeille) ouvre sa propre fiche (lieux/fiche-lieu.js).
  const idsCartes = new Set(cartes.map((c) => c.id));
  // Un lieu partagé par l'autre MJ : sa carte n'est pas partagée, sa fiche s'ouvre seule, en lecture.
  const pose = (l) => Boolean(l.carte && idsCartes.has(l.carte)) && !partageeParUnAutre(l);
  const types = Object.fromEntries(TYPES_LIEUX.map((t) => [t.cle, t.nom]));
  lieux.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  page.innerHTML = `
    <section class="page-liste">
      <header class="titre-page">
        <p class="kicker">Répertoire</p>
        <h1>Les lieux</h1>
        <p class="chapo">Chaque lieu a sa fiche : ce que savent les joueurs, et ce que vous gardez pour vous.</p>
        <div class="actions"><button class="principal" data-action="nouveau-lieu">Nouveau lieu</button></div>
      </header>
      <div class="filtres">
        <input type="search" placeholder="Chercher un lieu" aria-label="Chercher un lieu" class="recherche">
        <select class="filtre-type" aria-label="Genre"><option value="">Tous les genres</option>${TYPES_LIEUX.map((t) => `<option value="${t.cle}">${e(t.nom)}</option>`).join("")}</select>
        <label class="case"><input type="checkbox" class="filtre-valider"> À valider seulement</label>
      </div>
      <ul class="repertoire">
        ${lieux.map((l) => `
          <li data-id="${e(l.id)}" data-nom="${e(l.nom.toLowerCase())}" data-type="${e(l.type)}" data-valider="${l.a_valider ? 1 : 0}">
            <a href="${pose(l) ? `#/carte/${e(l.carte)}?lieu=${e(l.id)}` : `#/lieu/${e(l.id)}`}">
              <span class="nom">${e(l.nom)}</span>
              <span class="meta">${e(types[l.type] || l.type)}${pose(l) ? ` · ${e(nomsCartes[l.carte] || "")}` : partageeParUnAutre(l) ? "" : " · sans carte"}</span>
              <span class="etiquettes">
                ${htmlPastillePartage(l)}
                ${l.etiquette ? `<span class="etiquette etiquette-${e(l.etiquette.normalize("NFD").replace(/[̀-ͯ]/g, ""))}">${e(l.etiquette)}</span>` : ""}
                ${l.connu ? "" : '<span class="etiquette secret">secret</span>'}
                ${l.a_valider ? '<span class="etiquette valider">à valider</span>' : ""}
              </span>
              <span class="resume">${e(l.resume || "")}</span>
            </a>
          </li>`).join("")}
      </ul>
      ${lieux.length ? "" : `<p class="vide">Aucun lieu pour l'instant : « Nouveau lieu » en crée un, ou l'outil Lieu d'une carte.</p>`}
    </section>`;
  // Le nom, le genre, le résumé, les notes et les secrets, sans accents : le nom d'abord, et ce qui répond surligné ou
  // rappelé sous le nom (chercher/listes.js).
  const filtrer = () => filtrerLieux(page, lieux);
  page.querySelector(".filtres").addEventListener("input", filtrer);
  // « Nouveau lieu » : sur une carte, ou sans carte (lieux/nouveau-lieu.js).
  page.querySelector('[data-action="nouveau-lieu"]').addEventListener("click", () => ouvrirNouveauLieu(cartes));
}

let demonterTable = () => {};

async function pageTable(n = S.navigation) {
  onglet("table");
  // Un MJ invité : la TV, ses plans, la télécommande ; ni la table publique, ni les cartes du MJ principal, ni les dés
  // d'aventure. Les réglages (la table publique, le coin des joueurs, le nom de l'auberge, la rédaction, la suite de
  // l'invité, ses appareils) sont dans la page Réglages (reglages/reglages.js).
  const invite = estInvite();
  const [etat, cartes, plans] = await Promise.all([api.get("/api/table"), invite ? [] : api.get("/api/cartes"), api.get("/api/plans").catch(() => [])]);
  if (perimee(n)) return;
  const adresse = `${location.protocol}//${location.host}/table`;
  const decrire = (t) => (t.vue === "carte" ? `la carte « ${cartes.find((c) => c.id === t.carte)?.nom || t.carte} »`
    : t.vue === "planche" ? "la planche à contrats" : t.vue === "precedemment" ? `le « ${TITRE_PRECEDEMMENT}… »`
    : t.vue === "episode" ? "le titre de l'épisode"
    : t.vue === "heros" ? "la tablée des aventuriers"
    : t.vue === "fiches" ? "les fiches de la tablée"
    : t.vue === "plan" ? `le plan « ${plans.find((p) => p.id === t.plan)?.nom || t.plan} »`
    : t.vue === "boutique" ? "une boutique"
    : t.vue === "sanctuaire" ? (t.batiment ? "un bâtiment du sanctuaire" : "le sanctuaire")
    : t.vue === "image" ? "une illustration" : "l'écran d'accueil");
  const pub = etat.publique || { ouverte: true };
  const branches = (n) => (n ? `${n} écran${n > 1 ? "s" : ""} branché${n > 1 ? "s" : ""}` : "aucun écran branché");
  page.innerHTML = `
    <section class="page-liste">
      <header class="titre-page">
        <p class="kicker">Pendant la partie</p>
        <h1>La table</h1>
        <p class="chapo">La TV du salon affiche ce que vous lui envoyez, sans jamais montrer vos secrets.</p>
        <p class="aide vers-reglages-page">${invite ? "Votre suite au carnet, vos appareils, la musique des combats et votre budget de rédaction" : "La table publique, le coin des joueurs, le nom de l'auberge, les dés d'aventure, la musique des combats et la rédaction"} : <a href="#/reglages">Réglages</a>.</p>
      </header>
      <div class="table-etat">
        <div class="bloc">
          <h2>Brancher la TV</h2>
          <p>Ouvrez cette adresse dans le navigateur de la TV (ou sur un iPad relié en AirPlay), puis cliquez une fois sur l'écran avec la télécommande (du doigt sur l'iPad) pour passer en plein écran :</p>
          <p class="adresse"><code>${e(adresse).replace("//", "//<wbr>").replace(/\/table$/, "<wbr>/table")}</code></p>
          <p class="aide">Sur une TV LG, le navigateur s'appelle « Navigateur Web ». Ajoutez l'adresse en favori pour les prochaines séances.</p>
        </div>
        <div class="bloc">
          <h2>En ce moment</h2>
          <p data-tv-dit>La TV montre ${e(decrire(etat))}.${parLaMain(etat) ? ` <span class="par-tv">${e(parLaMain(etat))}</span>` : ""}</p>
          <p class="ecrans-table" data-ecrans-dit><strong>Au salon : ${branches(etat.ecrans_salon || 0)}.</strong>
            Sur Internet : ${branches(etat.ecrans_internet || 0)}${etat.ecrans_internet && !pub.ouverte ? ", qui ne voient que l'accueil" : ""}.</p>
          <p class="aide">Au salon, c'est la maison et le VPN : ces écrans ont toujours leur place, ceux d'Internet ont leur propre limite.${invite ? "" : ` Table publique ${pub.ouverte ? "ouverte" : "fermée"} : <a href="#/reglages/table">Réglages</a>.`}</p>
          <div class="actions">
            <button data-action="accueil">Écran d'accueil</button>
            <a class="bouton" href="/table" target="_blank" rel="noopener">Ouvrir la vue de la table ici</a>
          </div>
        </div>
        ${invite ? "" : `<div class="bloc">
          <h2>Montrer une carte entière</h2>
          <ul class="liste-simple">
            ${cartes.map((c) => `<li><span>${e(c.nom)}</span><button data-montrer="${e(c.id)}">Montrer à la TV</button></li>`).join("") || "<li>Aucune carte.</li>"}
          </ul>
          <p class="aide">Pour zoomer sur un lieu, ouvrez la carte et utilisez « Montrer à la TV » ou le bouton de la fiche du lieu.</p>
        </div>`}
        <div class="bloc">
          <h2>Montrer un plan</h2>
          <ul class="liste-simple">
            ${plans.map((p) => `<li><span>${e(p.nom)}${rienDeRevele(p) ? ' <i class="rien-revele" title="Sous le brouillard, rien n\'est encore révélé : la TV resterait noire">rien de révélé</i>' : ""}</span><button data-montrer-plan="${e(p.id)}">Montrer à la TV</button></li>`).join("") || "<li>Aucun plan.</li>"}
          </ul>
          <p class="aide">La TV cadre ce qui est déjà révélé, et suit les pièces révélées ensuite. Pour révéler les pièces et poser les pions, ouvrez le plan.</p>
        </div>
      </div>
    </section>`;
  ajouterBlocTelecommande(page.querySelector(".table-etat"));
  // Les réserves des dés d'aventure et leurs gestes de jeu ; l'interrupteur et le total sont dans les Réglages.
  const arreterDes = invite ? null : ajouterBlocDesAventure(page.querySelector(".table-etat"));
  // « En ce moment » et les boutons des listes lisent la TV comme le témoin de l'en-tête (table-tv.js).
  const arreterTv = suivreTvSurLaPage(page, { publique: pub });
  // Quitter la page (ou la redessiner) cesse d'écouter la TV et les réserves : sans cela, chaque passage laissait ses
  // écouteurs et les éléments de l'ancienne page en mémoire.
  demonterTable();
  const demonter = () => {
    arreterTv();
    arreterDes?.();
    if (demonterTable === demonter) demonterTable = () => {};
    if (S.courant === pageDeLaTable) S.courant = null;
  };
  demonterTable = demonter;
  const pageDeLaTable = { demarrer() {}, async detruire() { demonter(); } };
  S.courant = pageDeLaTable;
  const envoyer = async (etat, message) => {
    try {
      await api.put("/api/table", etat);
      toast(message);
    } catch (err) {
      toast(err.status && err.status < 500 ? err.message : `La table ne répond pas : ${err.message}`, "erreur");
    }
    pageTable();
  };
  page.querySelector('[data-action="accueil"]').addEventListener("click", () => envoyer({ vue: "accueil" }, "À la TV : l'écran d'accueil."));
  for (const b of page.querySelectorAll("[data-montrer-plan]")) {
    b.addEventListener("click", async () => {
      const p = plans.find((x) => x.id === b.dataset.montrerPlan);
      if (b.classList.contains("montree")) return envoyer({ vue: "accueil" }, `Retiré de la TV : le plan « ${p.nom} ».`);
      // Rien de révélé sous le brouillard : la TV serait noire, la question d'abord.
      if (rienDeRevele(p)) {
        const choix = await questionTvNoire({ nom: p.nom, editeur: false });
        if (choix === "ouvrir") location.hash = `#/plan/${p.id}`;
        if (choix !== "noire") return;
      }
      envoyer({ vue: "plan", plan: p.id, camera: null, style: p.style || "couleur", version: p.modifie }, `À la TV : le plan « ${p.nom} »${rienDeRevele(p) ? ", encore noir" : ""}.`);
    });
  }
  for (const b of page.querySelectorAll("[data-montrer]")) {
    b.addEventListener("click", async () => {
      if (b.classList.contains("montree")) {
        return envoyer({ vue: "accueil" }, `Retiré de la TV : la carte « ${cartes.find((c) => c.id === b.dataset.montrer)?.nom || ""} ».`);
      }
      let c;
      try {
        c = await api.get(`/api/cartes/${b.dataset.montrer}`);
      } catch (err) {
        return toast(`Carte illisible : ${err.message}`, "erreur");
      }
      envoyer({ vue: "carte", carte: c.id, camera: null, style: c.style || "couleur", version: c.modifie, lieu: null }, `À la TV : la carte « ${c.nom} ».`);
    });
  }
}

// Une page qu'un MJ invité n'a pas : un mot, et ses onglets pour repartir.
function pageFermee() {
  onglet("");
  page.innerHTML = `<section class="page-liste"><p class="vide">Cette page n'est pas dans votre atelier. <a href="#/scenarios">Vos scénarios</a> · <a href="#/monde">Le monde</a></p></section>`;
}

export { pageFermee, pageLieux, pageTable };
