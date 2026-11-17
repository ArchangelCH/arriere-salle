// Écran de la table (TV) : suit l'état envoyé par le MJ, sans jamais recevoir ses secrets.
// La TV du salon (LG webOS 6, navigateur Chromium 79) reçoit ce module transpilé en un seul script (voir table.html et le
// Dockerfile) ; compat-tv.js lui apporte les fonctions plus récentes que son navigateur.

import "./ecran-tv/compat-tv.js";
import "./table/etat.js";
import "./table/outils.js";
import "./table/ecran.js";
import "./table/carte-plan.js";
import "./table/combat.js";
import "./table/cartons.js";
import "./table/boutique.js";
import "./table/sanctuaire.js";
import "./table/episode.js";
import "./table/fiches.js";
import "./table/image.js";

import { VueCarte, chargerImage, chargerPolices } from "./carte/vue.js";
import { creerEveil } from "./ecran-tv/eveil.js";
import { creerSonsJets } from "./ecran-tv/sons-jets.js";
import { creerDes3d } from "./ecran-tv/des-3d.js";
import { monterVolume } from "./ecran-tv/volume-sons.js";
import { ajusterBoutique, montrerBoutique } from "./table/boutique.js";
import { appliquerCarte, appliquerPlan, montrerAttente } from "./table/carte-plan.js";
import { montrerCarton, montrerPlanche, montrerPnj } from "./table/cartons.js";
import { majBandeau, montrerCombat } from "./table/combat.js";
import { montrerAccueil, montrerPlanTv, montrerProchaine, remesurerEcran } from "./table/ecran.js";
import { ajusterPapier, montrerDocument, montrerEpisode, montrerPrecedemment, montrerRumeur } from "./table/episode.js";
import { PEINT_TV, REGLAGES_TV, S, TV_SALON, boutiqueTv, canvas, connexion, horlogesTv, indice, jetTv, pointeurTv, reserveTv } from "./table/etat.js";
import { montrerAventurier, montrerFiches, montrerTablee, reajusterVues } from "./table/fiches.js";
import { montrerImage, vuePointee } from "./table/image.js";
import { montrerSanctuaire } from "./table/sanctuaire.js";
import { brancherCoin } from "./table/source-coin.js";

// L'écran tenu dans la page Table du coin des joueurs (joueurs/ecran.html) : pas de liaison avec l'atelier, la page lui
// passe ce qui est publié (source-coin.js) ; le plan et la carte s'y dessinent dans la page du joueur, qui les déplace, et
// l'écran n'en garde que les couches (cartons, horloges, réserve) ; les jets, les sons et le plein écran restent à la page.
const COIN = document.documentElement.getAttribute("data-source") === "coin";

let minuterieBoutique = 0;
window.addEventListener("resize", () => {
  clearTimeout(minuterieBoutique);
  minuterieBoutique = setTimeout(() => {
    if (boutiqueTv.classList.contains("visible")) ajusterBoutique();
    // Le document, la tablée et les fiches se remesurent à la taille de l'écran d'à présent (fenêtre, rotation).
    ajusterPapier();
    reajusterVues();
    // Le bandeau du combat, la légende et la rumeur n'ont plus la même hauteur : le plan se recadre.
    S.bandeau = -1;
    majBandeau();
    remesurerEcran();
  }, 200);
});
// Les polices posées, les mesures de la première vue (faites avec une police de repli) se refont.
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { ajusterPapier(); reajusterVues(); });

// ---------------------------------------------------------------- états

async function appliquer(etat) {
  const precedent = S.dernierEtat;
  S.dernierEtat = etat;
  S.internet = etat.internet === true;
  // Une autre vue, un autre plan ou une autre carte : le point du MJ s'efface.
  pointeurTv.garder(etat.vue === "plan" && etat.plan ? `plan:${etat.plan}` : etat.vue === "carte" && etat.carte ? `carte:${etat.carte}` : null);
  montrerProchaine(typeof etat.prochaine === "string" ? etat.prochaine : "");
  // Les cartons posés par-dessus la vue.
  montrerPnj(etat.pnj);
  montrerRumeur(etat.rumeur);
  montrerAventurier(etat.aventurier, etat.aventurier_maj);
  const quoi = etat.vue === "heros" ? "heros"
    : etat.vue === "fiches" ? "fiches"
    : etat.vue === "plan" && etat.plan ? "plan"
    : etat.vue === "planche" ? "planche"
    : etat.vue === "boutique" && etat.boutique ? "boutique"
    : etat.vue === "sanctuaire" ? "sanctuaire"
    : etat.vue === "precedemment" && etat.seance ? "precedemment"
    : etat.vue === "episode" && etat.seance ? "episode"
    : etat.vue === "image" && etat.url ? "image"
    : etat.vue === "document" && etat.document ? "document"
    : etat.vue === "carte" && etat.carte ? "carte"
    : "accueil";
  // Le premier envoi du MJ efface l'indice du plein écran ; la vue du moment règle la page (« Tournez votre téléphone »).
  if (quoi !== "accueil") indice.classList.add("cache");
  document.body.setAttribute("data-vue", quoi);
  if (quoi !== "plan") montrerAttente(false);
  montrerCombat(etat, quoi);
  horlogesTv.montrer(etat.horloges, quoi);
  reserveTv.montrer(etat.reserve, quoi);
  // Ce qui n'est pas la vue demandée s'efface.
  if (quoi !== "heros") montrerTablee(null);
  if (quoi !== "fiches") montrerFiches(null);
  if (quoi !== "planche") montrerPlanche(null);
  if (quoi !== "boutique") montrerBoutique(null);
  if (quoi !== "sanctuaire") montrerSanctuaire(null);
  if (quoi !== "precedemment") montrerPrecedemment(null);
  if (quoi !== "episode") montrerEpisode(null);
  if (quoi !== "image") montrerImage(null);
  if (quoi !== "document") montrerDocument(null);
  if (quoi !== "carte") montrerCarton(null);
  if (quoi !== "plan") montrerPlanTv(false);
  const calques = COIN && (quoi === "plan" || quoi === "carte");
  document.documentElement.classList.toggle("calques", calques);
  if (calques) {
    // Au coin, la page du joueur dessine le plan et la carte : ici, seulement ce qui se pose dessus.
    montrerAccueil(false);
    if (quoi === "carte") montrerCarton(etat.lieu || null, [etat.lieu, etat.carte, etat.version == null ? null : etat.version]);
    return;
  }
  if (quoi === "plan") return appliquerPlan(etat, precedent);
  if (quoi === "carte") return appliquerCarte(etat, precedent);
  // Les vues plein écran ne retiennent pas les états suivants : leurs réponses tardives seront ignorées.
  if (quoi === "heros") montrerTablee(etat);
  else if (quoi === "fiches") montrerFiches(etat);
  else if (quoi === "planche") montrerPlanche(etat);
  else if (quoi === "boutique") montrerBoutique(etat);
  else if (quoi === "sanctuaire") montrerSanctuaire(etat);
  else if (quoi === "precedemment") montrerPrecedemment(etat);
  else if (quoi === "episode") montrerEpisode(etat);
  else if (quoi === "image") montrerImage(etat);
  else if (quoi === "document") montrerDocument(etat);
  else montrerAccueil(true);
}

// Les états s'appliquent un par un ; s'il en arrive plusieurs pendant qu'une carte se charge, seul le dernier compte.
let enAttente = null;
let occupe = false;
async function recevoir(etat) {
  enAttente = etat;
  if (occupe) return;
  occupe = true;
  while (enAttente) {
    const suivant = enAttente;
    enAttente = null;
    try {
      await appliquer(suivant);
    } catch (err) {
      console.error(err);
    }
  }
  occupe = false;
}

function ecouter() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/table`);
  let vivant = true;
  let dernierMessage = Date.now();
  const relancer = () => {
    if (!vivant) return;
    vivant = false;
    clearInterval(garde);
    connexion.hidden = false;
    try {
      ws.close();
    } catch {
      // déjà fermée
    }
    setTimeout(ecouter, 2500);
  };
  // Le serveur écrit au moins toutes les 45 secondes : deux minutes de silence, et la liaison est tenue pour morte.
  const garde = setInterval(() => {
    if (Date.now() - dernierMessage > 120000) relancer();
  }, 30000);
  ws.onopen = () => {
    connexion.hidden = true;
  };
  ws.onmessage = (ev) => {
    dernierMessage = Date.now();
    let msg = null;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "etat" && msg.etat) recevoir(msg.etat);
    else if (msg.type === "pointeur") pointeurTv.recevoir(msg, vuePointee(msg));
    // ---- Les jets à distance, et les dés libres ----
    else if (msg.type === "jet" || msg.type === "des") {
      // Un rappel (le même test redit : un joueur vient de changer l'effet d'un dé d'aventure) : le bandeau seul, sans
      // dés ni jingle.
      if (msg.rappel) jetTv.recevoir(msg);
      else {
        // Les dés roulent en 3D et s'arrêtent sur le résultat reçu (des-3d.js), puis le bandeau paraît avec le jingle de
        // l'issue (sons-jets.js) ; les dés libres n'ont pas de jingle. Sans animation (mouvements réduits), tout de suite.
        des3d.lancer(msg).then(() => {
          jetTv.recevoir(msg);
          if (msg.type === "jet") sonsJets.jouer(msg.issue);
        });
      }
    }
  };
  ws.onclose = relancer;
  ws.onerror = () => ws.close();
}

// L'écran gardé allumé (eveil.js) : l'iPad posé sur la table ne se met pas en veille ; la TV du salon garde son réglage.
const eveil = creerEveil({ tv: TV_SALON });
// Les sons des tests (sons-jets.js) : le même premier toucher leur ouvre la sortie audio.
const sonsJets = COIN ? null : creerSonsJets();
// Les dés en 3D des jets (des-3d.js) et la jauge de volume des jingles, gardée sur cet appareil (volume-sons.js).
const des3d = COIN ? null : creerDes3d();
if (!COIN) monterVolume(sonsJets);

document.addEventListener("click", async () => {
  if (COIN) return;
  // D'abord, dans le geste même : sans verrou d'écran (http), la vidéo qui garde l'écran allumé doit partir du toucher.
  eveil.garder();
  sonsJets.reveiller();
  indice.classList.add("cache");
  const racine = document.documentElement;
  const plein = racine.requestFullscreen || racine.webkitRequestFullscreen;
  try {
    if (!document.fullscreenElement && !document.webkitFullscreenElement && plein) await plein.call(racine);
  } catch {
    // certains navigateurs de TV refusent le plein écran : l'affichage reste utilisable
  }
});

// L'indice du plein écran dit le bon geste : la TV LG se pilote d'une télécommande à pointeur, un téléphone au doigt,
// un ordinateur à la souris. Un navigateur qui ne sait pas passer en plein écran (iPhone), ou une TV déjà en plein
// écran, n'en affiche aucun.
function preparerIndice() {
  const racine = document.documentElement;
  const possible = Boolean(racine.requestFullscreen || racine.webkitRequestFullscreen);
  const deja = Boolean(document.fullscreenElement) || (window.innerWidth >= screen.width && window.innerHeight >= screen.height);
  if (COIN || !possible || deja) return indice.classList.add("cache");
  indice.textContent = TV_SALON ? "Cliquez avec la télécommande pour passer en plein écran"
    : window.matchMedia && matchMedia("(pointer: coarse)").matches ? "Touchez l'écran pour passer en plein écran et activer le son"
    : "Cliquez pour passer en plein écran et activer le son";
}
preparerIndice();

let minuterieCurseur = 0;
document.addEventListener("mousemove", () => {
  if (COIN) return;
  document.body.classList.remove("sans-curseur");
  clearTimeout(minuterieCurseur);
  minuterieCurseur = setTimeout(() => document.body.classList.add("sans-curseur"), 2500);
});

setTimeout(() => indice.classList.add("cache"), 9000);

// Pas d'attente au niveau du module, que Chromium 79 ne connaît pas : la préparation lance l'écoute une fois finie.
async function demarrer() {
  try {
    await chargerPolices();
    S.texture = await chargerImage("/static/img/carte-parchemin.jpg");
  } catch (err) {
    console.error(err); // sans texture, la carte se peint sur un fond uni
  }
  S.vue = new VueCarte(canvas, { style: "couleur", joueurs: true, tv: true, texture: S.texture, fond: "#140f0b", ...REGLAGES_TV, ...PEINT_TV });
  if (COIN) brancherCoin(recevoir);
  else ecouter();
}

demarrer();
