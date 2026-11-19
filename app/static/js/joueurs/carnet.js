// Le carnet de la compagnie, dans le coin des joueurs : ses pages (carnet-vue.js les dessine : l'accueil, l'univers, la
// compagnie, les règles, le sanctuaire, les activités, les séances d'avant), puis les boutiques ouvertes entre les séances
// (echoppe.js). L'adresse choisit la page ; le menu (menu-coin.js) les ouvre toutes. Ce qui s'écrit d'ici : une commande, un mot au MJ, les gestes du sac de son héros
// (sac.js). Le serveur ne sert que ce qui est publié.
// Les limites des joueurs ne figurent pas au carnet : le MJ connaît sa tablée (le Confort de la table reste côté MJ).

import { afficherCarnet, demander, pageErreur, pageFermee, vueDuHash } from "./carnet-vue.js";
import { Echoppe } from "./echoppe.js";
import "./pied-coin.js";
import { bandeauPause, MesDemandes } from "./demandes.js";
import { ecouterFlux } from "./flux.js";
import { MonSac } from "./sac.js";
import { MonSanctuaire } from "./sanctuaire-coin.js";
import { MesActivites } from "./activites-coin.js";
import { poserVersHistoire } from "./vers-histoire.js";
import { monter as monterMainLevee } from "./main-levee.js";
import { monter as monterBillets } from "./prives.js";
// ---- Les jets à distance ----
import { monter as monterJets } from "./jets-coin.js";
// ---- Les portraits des joueurs : « Changer de portrait » dans « Mon héros » ; carnet fermé, le portrait reste. ----
import { MonPortrait, poserPortraitFerme } from "./portrait-coin.js";

// Les blocs de la fiche qu'on a ouverts (compétences, sac…) le restent d'un affichage à l'autre, le temps de la visite.
function souvenirDesReplis(fiche) {
  let ouverts = [];
  try {
    ouverts = JSON.parse(sessionStorage.getItem("coin.replis") || "[]");
  } catch {
    // stockage indisponible : les blocs restent fermés
  }
  for (const d of fiche.querySelectorAll("details.repli-fiche")) {
    d.open = ouverts.includes(d.dataset.cle);
    d.addEventListener("toggle", () => {
      const reste = ouverts.filter((c) => c !== d.dataset.cle);
      ouverts = d.open ? [...reste, d.dataset.cle] : reste;
      try {
        sessionStorage.setItem("coin.replis", JSON.stringify(ouverts));
      } catch {
        // idem
      }
    });
  }
}

const page = document.getElementById("page");
// La date de la prochaine séance, lue avec le carnet : la page « fermé » la redit.
let prochaine = "";
const echoppe = new Echoppe(page, { demander, pageErreur: (err) => pageErreur(page, err), pageFermee: () => pageFermee(page, prochaine) });
let jeton = 0;
// « Un mot au MJ » et « Mes demandes » (demandes.js), au bout du carnet, et sous la page « carnet fermé » : le joueur peut
// toujours écrire à son MJ. Ce que montre la page : « carnet », « ferme », « boutiques ».
const mesDemandes = new MesDemandes();
// Le sac de « Mon héros » (sac.js) : posé dans sa section à chaque affichage du carnet, il se relit seul par le flux.
const monSac = new MonSac();
// Le sanctuaire (sanctuaire-coin.js, lot B2) : verser dans une cagnotte, proposer un projet ; il se relit seul par le flux.
const monSanctuaire = new MonSanctuaire();
// Les activités entre les séances (activites-coin.js, lot D) : choisir celle de son héros, lire son jet ; relues par le flux.
const mesActivites = new MesActivites();
let montre = "";
bandeauPause();
// « Je veux agir » (main-levee.js) : pendant la partie, la main levée vers le MJ, carnet ouvert ou fermé.
monterMainLevee();
// Les billets privés (prives.js) : l'avis « Votre MJ vous a glissé un billet », et « Mes billets », carnet ouvert ou fermé.
const mesBillets = monterBillets();
// ---- Les jets à distance : « Lancer un test », à gauche de « Je veux agir » (jets-coin.js). ----
monterJets();
const monPortrait = new MonPortrait();

async function montrer() {
  const n = ++jeton;
  const boutiques = location.hash.startsWith("#boutique");
  const { vue, ancre } = vueDuHash(location.hash);
  // L'onglet du haut qui porte la page : le carnet pour l'accueil, l'échoppe, les quêtes de la semaine, le menu pour
  // toutes les autres.
  const onglet = boutiques ? "boutiques" : vue === "accueil" ? "carnet" : vue === "activites" ? "activites" : "menu";
  for (const a of document.querySelectorAll(".onglets-coin [data-vue]")) a.setAttribute("aria-current", String(a.dataset.vue === onglet));
  if (boutiques) {
    montre = "boutiques";
    return echoppe.afficher(location.hash.slice(1));
  }
  echoppe.quitter();
  try {
    const c = await demander("GET", "/api/carnet");
    if (n !== jeton) return;
    prochaine = c.prochaine || "";
    if (!c.ouvert) {
      montre = "ferme";
      pageFermee(page, prochaine);
      poserPortraitFerme(page.querySelector(".message-coin"));
      mesBillets.section(page, { seule: true });
      return mesDemandes.monter(page, { seule: true });
    }
    montre = "carnet";
    afficherCarnet(page, c, vue, ancre);
    if (vue === "accueil") {
      const fiche = page.querySelector(".fiche-coin");
      if (fiche) souvenirDesReplis(fiche);
      monSac.monter(page.querySelector(".fiche-coin .sac-coin"));
      // « Étoffer mon histoire » (vers-histoire.js) : l'histoire du héros s'écrit sur sa propre page.
      poserVersHistoire(page.querySelector(".fiche-coin"));
      monPortrait.monterDansFiche(page.querySelector(".fiche-coin"));
      mesActivites.monterResume(page.querySelector(".section-resume-activites"));
      // Les billets et « Un mot au MJ » : au bout de l'accueil, là où le joueur écrit à son MJ.
      mesBillets.section(page.querySelector(".carnet-coin"));
      mesDemandes.monter(page.querySelector(".carnet-coin"));
      // Le lien d'un joueur dont le héros est à la tablée mène ici, sur sa fiche (#heros).
      if (location.hash === "#heros") document.getElementById("heros")?.scrollIntoView({ block: "start" });
    } else if (vue === "sanctuaire") monSanctuaire.monter(page.querySelector(".section-sanctuaire .sanctuaire-coin"));
    else if (vue === "activites") mesActivites.monter(page.querySelector(".section-activites .activites-coin"));
  } catch (err) {
    if (n === jeton) pageErreur(page, err);
  }
}

window.addEventListener("hashchange", () => {
  window.scrollTo(0, 0);
  montrer();
});
// Revenu sur l'onglet après un moment (téléphone en poche) : le carnet et l'échoppe se relisent.
let cache = 0;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") cache = Date.now();
  else if (cache && Date.now() - cache > 60000 && !echoppe.occupe()) montrer();
});
// Le flux poussé (flux.js) : une commande vendue ou refusée se voit dans l'échoppe ouverte ; le carnet qui s'ouvre ou se
// ferme change la page. Le reste ne se redessine pas sous les yeux du joueur (sa lecture, sa recherche, son panier).
ecouterFlux("commandes", () => {
  if (montre === "boutiques" && !echoppe.occupe()) montrer();
});
ecouterFlux("carnet", async () => {
  if (montre === "boutiques") return;
  try {
    const c = await demander("GET", "/api/carnet");
    if (Boolean(c.ouvert) !== (montre === "carnet")) montrer();
  } catch {
    // le carnet dira lui-même ce qui ne va pas à la prochaine lecture
  }
});
montrer();
