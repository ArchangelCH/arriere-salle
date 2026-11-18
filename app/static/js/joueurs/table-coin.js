// La table, dans le coin des joueurs : le plan que montre la TV, tel que la TV le reçoit (rien de plus), que chacun
// déplace et zoome à sa guise, sans suivre la caméra du MJ. Un doigt (ou la souris) déplace la vue, deux doigts (ou la
// molette) zooment, deux touchers rapides recentrent sur son héros, mis en évidence par un anneau doré. Le bandeau du
// combat dit à qui c'est le tour. Une carte du monde (lot E3, carte-coin.js) s'y montre aussi, en navigation seule.
//
// Tout le reste de ce que montre la TV (lot du 12/11) : une image, un document, une boutique, la tablée, les fiches, la
// planche, le sanctuaire, le « Précédemment », le titre de l'épisode, l'accueil ; et ce qui se pose sur le jeu (le carton
// d'un PNJ, d'un héros ou d'un lieu, une rumeur, les horloges, les réserves de dés). La page tient dans un cadre la page
// même de la TV (joueurs/ecran.html) et lui passe ce que l'atelier a publié pour le coin (vue.ecran : l'état public et ce
// que la TV lirait) : même rendu qu'à la TV, sans rien demander à l'atelier. Sur un plan ou une carte, le cadre est
// transparent et ne prend aucun toucher.
//
// La page relit /api/table quand le flux le dit (flux.js, sujet « table »). Le serveur ne sert que ce que l'atelier a
// publié pour le coin (table_joueurs.py). « Je veux agir » (main-levee.js) flotte par-dessus. Bouger son pion (lot E2,
// joueurs/bouger.js) se branche sur VueTableCoin : surToucher reçoit chaque toucher bref, en cases, sousLesPions dessine
// les cases atteignables, et l'anneau suit le pion désigné par monPion.

import { api, echapper as e } from "../api.js";
import { chargerImage, gesteMolette, lireDefilement } from "../carte/vue.js";
import { boiteRevelee } from "../plan/modele.js";
import { fondPeint } from "../plan/peint.js";
import { VuePlan, signatureStructure } from "../plan/vue.js";
import { Bouger } from "./bouger.js";
import { CarteCoin } from "./carte-coin.js";
import { ecouterFlux } from "./flux.js";
import { monter as monterMainLevee } from "./main-levee.js";
import { monter as monterBillets } from "./prives.js";
// ---- Les jets à distance ----
import { monter as monterJets } from "./jets-coin.js";
// « Mon héros » : la Santé, la Psy et la posture que le joueur règle lui-même (etat-coin.js).
import { monter as monterEtat } from "./etat-coin.js";
import { monter as monterTableHeros } from "./table-heros.js";
// ---- Les portraits des joueurs : son portrait sur sa ligne de la légende. ----
import { suivreMonPortrait } from "./portrait-coin.js";
// ---- Les jets des autres, en dés 3D, avec le bandeau et le jingle de la TV (lot du 12/11). ----
import { monter as monterJetsDeLaTable } from "./jets-table-coin.js";
// ---- Le pointeur du MJ et sa règle, et « Montrer au MJ » (lot du 13/11). ----
import { monter as monterPointeurs } from "./pointeurs-coin.js";

const page = document.getElementById("page");
const zone = page.querySelector(".zone-table");
const cadre = page.querySelector(".ecran-coin");
const scene = page.querySelector(".scene-table");
const toile = scene.querySelector(".toile-table");
const repere = scene.querySelector(".repere-pion");
const noir = scene.querySelector(".noir-table");
const bandeau = scene.querySelector(".combat-coin");
const legende = scene.querySelector(".legende-coin");
const boutonHeros = scene.querySelector('[data-geste="heros"]');

// Le feu, plus léger qu'à l'atelier : un téléphone le peint au tiers de ses pixels, comme la TV, en un peu plus fin.
const FEU_COIN = { echelle: 1 / 2, images: 16, sprite: 64, flammes: 360, escarbilles: 60 };
// Pas plus de pixels qu'un écran 1080p, des tuiles pour deux écrans et demi (comme la TV) : un téléphone garde sa mémoire.
const REGLAGES = { pixelsMax: 2.1e6, ecransTuiles: 2.5 };
// Ce que montre « Recentrer » autour du héros : une dizaine de cases de haut, assez pour voir où il est.
const HAUTEUR_HEROS = 12;
const TOUCHER_MS = 350; // au-delà, ce n'est plus un toucher bref
const DOUBLE_MS = 320; // entre deux touchers d'un double toucher
const SEUIL_GLISSER = 8; // pixels : en deçà, le doigt n'a pas glissé (un toucher qui tremble)

// ---------------------------------------------------------------- la vue du plan

export class VueTableCoin extends VuePlan {
  constructor(canvas, options = {}) {
    super(canvas, { ...REGLAGES, ...options, joueurs: true, tv: true });
    this.repere = options.repere || null;
    // L'id public du pion du joueur (celui que l'atelier a publié sous la clé de son lien), ou null.
    this.monPion = null;
    // Un toucher bref sur le plan, en cases : rien encore (le lot suivant y choisira son pion et sa case).
    this.surToucher = null;
    this.placeRepere = "";
  }

  // Les noms et les numéros des pions, à la taille d'un téléphone ou d'une tablette tenus en main (environ 13 à 15 px
  // pour un prénom, au lieu des 24 px d'un écran 1080p vu du canapé) : chacun zoome, ils restent lisibles.
  hauteurLisible() {
    return Math.max(560, Math.min(680, Math.min(this.lw, this.lh) * 1.4));
  }

  dessiner() {
    super.dessiner();
    this.placerRepere();
  }

  // ---- Bouger son pion : les cases atteignables se peignent sous les pions (bouger.js). ----
  peindreDessus(ctx, zone, o = {}) {
    if (this.sousLesPions) this.sousLesPions(ctx, zone);
    super.peindreDessus(ctx, zone, o);
  }

  // Le pion du joueur tel qu'il est dessiné (il glisse vers sa nouvelle case), ou celui du plan.
  pionDuJoueur() {
    if (!this.monPion || !this.plan) return null;
    const liste = this.pionsDessines || this.plan.pions || [];
    return liste.find((t) => t.id === this.monPion) || null;
  }

  // L'anneau doré, posé au-dessus du canvas (une pulsation en CSS ne coûte pas d'image au plan).
  placerRepere() {
    if (!this.repere) return;
    const t = this.enSommeil || this.detruite ? null : this.pionDuJoueur();
    if (!t) {
      if (this.placeRepere !== "") {
        this.repere.hidden = true;
        this.placeRepere = "";
      }
      return;
    }
    const [x, y] = this.versEcran(t.x, t.y);
    const d = Math.max(28, 2 * 0.42 * (t.taille || 1) * this.cam.z + 16);
    const place = `${x.toFixed(1)}:${y.toFixed(1)}:${d.toFixed(1)}`;
    if (place === this.placeRepere) return;
    this.placeRepere = place;
    this.repere.hidden = false;
    this.repere.style.setProperty("--d", `${d.toFixed(1)}px`);
    this.repere.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  // La caméra posée sur le héros : il reste au centre, assez grand pour voir où il est (sans dézoomer qui l'est déjà).
  cameraHeros() {
    const t = this.monPion && this.plan && (this.plan.pions || []).find((p) => p.id === this.monPion);
    if (!t) return null;
    const hv = Math.max(6, Math.min(this.lh / this.cam.z, HAUTEUR_HEROS));
    return { x: t.x, y: t.y, hv };
  }
}

// ---------------------------------------------------------------- les gestes

// Un doigt (ou la souris, bouton gauche) déplace la vue ; deux doigts zooment autour d'eux et la déplacent ; la molette
// zoome (ou déplace, pavé tactile d'un Mac) ; deux touchers rapides appellent surDouble. surBouge : le joueur a pris la
// main sur la caméra.
function brancherGestes(el, vue, { surBouge, surDouble }) {
  const doigts = new Map();
  let pince = null;
  let depart = null; // le premier doigt posé : un toucher bref, ou un glissé dès qu'il dépasse le seuil
  let dernier = { t: 0, x: 0, y: 0 };
  const position = (ev) => {
    const r = el.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  const mesure = () => {
    const [a, b] = [...doigts.values()];
    return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  el.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    try {
      el.setPointerCapture(ev.pointerId);
    } catch {
      // un pointeur déjà relâché : rien à capturer
    }
    const ici = position(ev);
    doigts.set(ev.pointerId, ici);
    if (doigts.size === 1) depart = { ...ici, t: performance.now(), glisse: false };
    else {
      depart = null;
      if (doigts.size === 2) pince = mesure();
    }
    el.classList.add("en-main");
  });
  el.addEventListener("pointermove", (ev) => {
    const avant = doigts.get(ev.pointerId);
    if (!avant) return;
    const ici = position(ev);
    doigts.set(ev.pointerId, ici);
    if (doigts.size === 1) {
      if (depart && !depart.glisse) {
        if (Math.hypot(ici.x - depart.x, ici.y - depart.y) < SEUIL_GLISSER) return;
        depart.glisse = true;
        vue.deplacer(ici.x - depart.x, ici.y - depart.y);
      } else vue.deplacer(ici.x - avant.x, ici.y - avant.y);
      surBouge();
    } else if (doigts.size === 2 && pince) {
      const m = mesure();
      vue.zoomer(m.d / pince.d, m.x, m.y);
      vue.deplacer(m.x - pince.x, m.y - pince.y);
      pince = m;
      surBouge();
    }
  });
  const lacher = (ev) => {
    if (!doigts.has(ev.pointerId)) return;
    const ici = position(ev);
    doigts.delete(ev.pointerId);
    if (doigts.size < 2) pince = null;
    if (!doigts.size) el.classList.remove("en-main");
    const bref = ev.type === "pointerup" && depart && !depart.glisse && !doigts.size && performance.now() - depart.t < TOUCHER_MS;
    if (doigts.size === 0) depart = null;
    if (!bref) return;
    const t = performance.now();
    if (t - dernier.t < DOUBLE_MS && Math.hypot(ici.x - dernier.x, ici.y - dernier.y) < 30) {
      dernier = { t: 0, x: 0, y: 0 };
      surDouble();
      return;
    }
    dernier = { t, ...ici };
    if (vue.surToucher) vue.surToucher(...vue.versCarte(ici.x, ici.y));
  };
  el.addEventListener("pointerup", lacher);
  el.addEventListener("pointercancel", lacher);
  el.addEventListener("lostpointercapture", lacher);
  el.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const r = el.getBoundingClientRect();
    const g = gesteMolette(ev, lireDefilement(), vue.lh);
    if (g.glisser) vue.deplacer(g.glisser[0], g.glisser[1]);
    else vue.zoomer(g.zoom, ev.clientX - r.left, ev.clientY - r.top);
    surBouge();
  }, { passive: false });
  // Safari : le pincement ne zoome jamais la page, seulement le plan.
  for (const nom of ["gesturestart", "gesturechange", "gestureend"]) el.addEventListener(nom, (ev) => ev.preventDefault());
  el.addEventListener("contextmenu", (ev) => ev.preventDefault());
}

// ---------------------------------------------------------------- la page

// Safari sur iPhone : un pincement parti d'ailleurs que du plan (la légende, les boutons, « Mon héros », l'écran de la TV
// dans son cadre) zoomait toute la page. Aucun pincement ne la zoome plus ; le plan et la carte gardent leurs gestes.
export function sansZoomDePage(doc) {
  for (const nom of ["gesturestart", "gesturechange", "gestureend"]) doc.addEventListener(nom, (ev) => ev.preventDefault(), { passive: false });
  doc.addEventListener("touchmove", (ev) => {
    if (ev.touches.length > 1 && ev.cancelable) ev.preventDefault();
  }, { passive: false });
}
sansZoomDePage(document);

let vue = null;
let texture = null;
let affiche = { plan: null, signature: null, style: null };
// Tant que le joueur n'a pas touché à la caméra, elle cadre ce qui est révélé, et suit chaque pièce révélée ; dès qu'il
// la déplace, elle reste où il l'a mise (« Voir tout » la lui rend).
let auto = true;
let dernier = null; // la dernière réponse de /api/table
let pointeursCoin = null; // le pointeur et la règle du MJ (pointeurs-coin.js), redessinés après chaque lecture
let bouger = null; // bouger son pion (lot E2, bouger.js), créé avec la vue
// ---- Les cartes : la carte du monde, dans son propre cadre (.toile-carte), avec les gestes et les boutons du plan.
const carteCoin = new CarteCoin({ scene, texture: () => texture, brancher: brancherGestes, boutonGroupe: boutonHeros });
// ---- fin du bloc E3

function creerVue(style) {
  vue = new VueTableCoin(scene.querySelector(".plan-coin"), {
    style, texture, fond: "#0b0806", repere, surLegende: montrerLegende,
    brume: () => scene.querySelector(".brume-coin"), feu: () => scene.querySelector(".feu-coin"), reglagesFeu: FEU_COIN,
  });
  brancherGestes(toile, vue, {
    surBouge: () => {
      auto = false;
    },
    surDouble: () => {
      bouger.double();
      recentrer();
    },
  });
  // ---- Bouger son pion : un toucher sur son pion, puis sur une case. ----
  bouger = new Bouger({
    vue, scene, relire: () => lire(),
    // La vue remontée au-dessus de l'avis : elle reste où Bouger l'a mise, comme après un geste du joueur.
    surCadre: () => {
      auto = false;
    },
  });
  vue.surToucher = (x, y) => bouger.toucher(x, y);
}

function cadrer(duree) {
  if (!vue || !vue.plan) return;
  vue.animerVers(vue.cameraRevelee(), duree);
}

function recentrer() {
  if (!vue) return;
  const cam = vue.cameraHeros();
  if (!cam) return cadrer(700);
  auto = false;
  vue.animerVers(cam, 700);
}

// Les héros dont le prénom ne tient plus sous leur pion (le plan vu de loin) : une ligne en bas, comme à la TV. Sur la
// sienne, son portrait dans l'anneau de sa couleur.
let legendeVue = [];
let monPortrait = null;
function montrerLegende(liste) {
  legendeVue = liste;
  legende.hidden = !liste.length;
  legende.innerHTML = liste.map((h) => {
    const c = /^#[0-9a-f]{3,8}$/i.test(h.couleur) ? h.couleur : "#e0b562";
    const moi = vue && h.id === vue.monPion;
    const pastille = moi && monPortrait ? `<img class="portrait-legende" src="${e(monPortrait)}" alt="" style="--c:${c}">` : `<span class="pastille" style="--c:${c}"></span>`;
    return `<li${moi ? ' class="moi"' : ""}>${pastille}${e(h.nom)}</li>`;
  }).join("");
}
suivreMonPortrait((url) => {
  monPortrait = url;
  if (legendeVue.length) montrerLegende(legendeVue);
});

function montrerCombat(combat, monTour) {
  if (!combat || !Array.isArray(combat.ordre) || !combat.ordre.length) {
    bandeau.hidden = true;
    bandeau.innerHTML = "";
    return;
  }
  const actif = Number.isInteger(combat.actif) ? combat.ordre[combat.actif] : null;
  const qui = !actif ? "" : monTour ? "À vous de jouer" : actif.genre === "ennemis" ? "Aux ennemis de jouer" : `À ${actif.nom} de jouer`;
  const cases = combat.ordre.map((x, i) => {
    const classe = [x.genre === "ennemis" ? "ennemis" : "heros", i === combat.actif ? "actif" : "", x.coma ? "coma" : ""].filter(Boolean).join(" ");
    const couleur = x.genre === "heros" && /^#[0-9a-f]{3,8}$/i.test(x.couleur || "") ? ` style="--c:${x.couleur}"` : "";
    return `<li class="${classe}"${couleur}${i === combat.actif ? ' aria-current="true"' : ""}>${x.genre === "ennemis" ? "Les ennemis" : e(x.nom)}</li>`;
  }).join("");
  bandeau.hidden = false;
  bandeau.classList.toggle("mon-tour", !!monTour);
  bandeau.innerHTML = `<p class="tour-coin"><span>Tour ${Number(combat.tour) || 1}</span>${combat.strat ? '<span class="strat">Point strat</span>' : ""}</p>
    <ol class="ordre-coin">${cases}</ol>${qui ? `<p class="main-coin" role="status">${e(qui)}</p>` : ""}`;
}

// ---------------------------------------------------------------- l'écran de la TV, dans son cadre

// La page de la TV se charge à la première vue publiée ; elle dit quand elle est prête, et reçoit alors ce que la page a
// déjà lu, puis chaque nouvelle lecture. plein : l'écran prend la place du plan (toute vue qui n'est ni plan ni carte).
let ecranPret = false;
let ecranVu = null; // la dernière vue.ecran à montrer
window.addEventListener("message", (ev) => {
  if (ev.origin !== location.origin || ev.source !== cadre.contentWindow || ev.data?.type !== "ecran-coin-pret") return;
  ecranPret = true;
  envoyerEcran();
});

function envoyerEcran() {
  if (!ecranPret || !ecranVu || !cadre.contentWindow) return;
  cadre.contentWindow.postMessage({ type: "table-coin", etat: ecranVu.etat, lectures: ecranVu.lectures || {} }, location.origin);
}

function montrerEcran(ecran, plein) {
  if (!ecran || typeof ecran.etat !== "object" || !ecran.etat) {
    cadre.hidden = true;
    ecranVu = null;
    return false;
  }
  ecranVu = ecran;
  zone.hidden = false;
  cadre.hidden = false;
  cadre.dataset.calques = plein ? "non" : "oui";
  if (!cadre.getAttribute("src")) cadre.src = "/table/ecran";
  envoyerEcran();
  return true;
}

function message(titre, texte = "", actions = "") {
  zone.hidden = true;
  cadre.hidden = true;
  ecranVu = null;
  scene.hidden = true;
  if (vue) vue.alleger();
  carteCoin.cacher(); // ---- les cartes
  page.querySelector(".chargement")?.remove();
  let m = page.querySelector(".message-table");
  if (!m) {
    m = document.createElement("section");
    m.className = "feuille-coin message-coin message-table";
    page.append(m);
  }
  m.hidden = false;
  m.innerHTML = `<p class="kicker">La table</p><h1>${e(titre)}</h1>${texte ? `<p>${e(texte)}</p>` : ""}${actions}`;
}

async function montrerPlan(r) {
  const v = r.vue;
  const p = v.plan;
  if (!p || !p.largeur || !p.hauteur) return message("La TV montre : un plan", "Ce plan ne s'affiche pas ici pour l'instant.");
  const style = v.style || p.style || "couleur";
  page.querySelector(".chargement")?.remove();
  const m = page.querySelector(".message-table");
  if (m) m.hidden = true;
  // ---- Les cartes : la carte quittée, le plan reprend sa place.
  carteCoin.cacher();
  toile.hidden = false;
  // ---- fin du bloc E3
  // Visible avant la vue : elle prend la taille de son canvas.
  zone.hidden = false;
  scene.hidden = false;
  montrerEcran(v.ecran, false);
  if (!vue) creerVue(style);
  vue.reveiller();
  // Bouger son pion : avant le dessin, un pion parti mais pas encore posé par l'atelier garde sa case d'arrivée.
  bouger.maj(r);
  const signature = signatureStructure(p);
  const meme = affiche.plan === p.id;
  if (meme && signature === affiche.signature && style === affiche.style) {
    vue.majPions(p.pions || []);
    vue.majBrume(p.brume || [], p.brume_teinte);
    vue.majFeu(p.feu || []);
  } else {
    if (meme) vue.fondu();
    vue.style = style;
    // Hors du plan, la couleur de son vide : aucune bordure ne trahit la taille du plan.
    vue.fond = style === "parchemin" ? "#c7b48e" : style === "peint" ? fondPeint(p) : "#0f0c0a";
    vue.charger(p);
  }
  // Un autre plan : la caméra s'y pose d'un coup, sur ce qui est révélé ; le même, elle suit les pièces révélées tant que
  // le joueur ne l'a pas prise en main.
  if (!meme) {
    auto = true;
    cadrer(1);
  } else if (auto) cadrer(900);
  affiche = { plan: p.id, signature, style };
  vue.monPion = r.pion || null;
  vue.placeRepere = "-";
  vue.demander();
  boutonHeros.hidden = !vue.cameraHeros();
  noir.hidden = !!boiteRevelee(p);
  montrerCombat(v.combat, r.mon_tour);
}

// ---- Les cartes : la carte du monde que montre la TV, à la place du plan (carte-coin.js). Ni cases, ni
// « Bouger », ni bandeau du combat : le groupe, s'il est montré, c'est le MJ qui le déplace.
async function montrerCarte(r) {
  page.querySelector(".chargement")?.remove();
  const m = page.querySelector(".message-table");
  if (m) m.hidden = true;
  zone.hidden = false;
  scene.hidden = false;
  montrerEcran(r.vue.ecran, false);
  if (vue) vue.alleger();
  bouger?.cacherAvis();
  toile.hidden = true;
  noir.hidden = true;
  legende.hidden = true;
  montrerCombat(null);
  await carteCoin.montrer(r.vue);
}
// ---- fin du bloc E3

// Toute autre vue : le plan et la carte se retirent, l'écran de la TV prend le cadre.
function montrerPlein(r) {
  page.querySelector(".chargement")?.remove();
  const m = page.querySelector(".message-table");
  if (m) m.hidden = true;
  scene.hidden = true;
  if (vue) vue.alleger();
  bouger?.cacherAvis();
  carteCoin.cacher();
  montrerCombat(null);
  montrerEcran(r.vue.ecran, true);
}

function montrer(r) {
  dernier = r;
  if (!(r.ouverte && r.vue && r.vue.genre === "plan")) bouger?.maj(null);
  if (!r.ouverte) {
    affiche = { plan: null, signature: null, style: null };
    return message("La table n'est pas ouverte", "Votre MJ l'ouvre pendant la partie : le plan que montre la TV paraîtra ici. Le bouton « Je veux agir » reste là : il lève votre main chez le MJ, table ouverte ou non (en visio, par exemple).");
  }
  if (r.vue && r.vue.genre === "plan") return montrerPlan(r);
  if (r.vue && r.vue.genre === "carte" && r.vue.carte) return montrerCarte(r); // ---- les cartes
  // Autre chose qu'un plan ou une carte : l'écran même de la TV, à la place du plan.
  if (r.vue?.ecran) return montrerPlein(r);
  // Une vue publiée sans son écran (un atelier d'avant le 12/11) : seulement ce que c'est.
  return message(`La TV montre : ${r.vue?.titre || "l'écran d'accueil"}`);
}

// ---------------------------------------------------------------- lire

let numero = 0;
let relance = 0;
let attente = 0;
let luLe = 0;

async function lire() {
  const n = ++numero;
  clearTimeout(relance);
  try {
    const r = await api.get("/api/table");
    if (n !== numero) return;
    luLe = Date.now();
    await montrer(r);
    if (pointeursCoin) pointeursCoin.appliquer();
  } catch (err) {
    if (n !== numero) return;
    if (err.status === 401 || err.status === 403) {
      return message("Vous n'êtes plus connecté", "", '<p><a href="/connexion?suite=%2Ftable">Se connecter</a> avec votre identifiant et votre mot de passe.</p>');
    }
    // Une coupure : ce qui est à l'écran reste, la page réessaie seule.
    if (!dernier) message("La table ne répond pas", `Nouvel essai dans un instant (${err.message}).`);
    relance = setTimeout(lire, 5000);
  }
}

// Plusieurs nouvelles de suite (un plan réenregistré, le pion d'un joueur) : une seule relecture.
function bientot() {
  clearTimeout(attente);
  attente = setTimeout(lire, 80);
}

scene.querySelector(".commandes-table").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-geste]");
  if (b && carteCoin.visible) return carteCoin.geste(b.dataset.geste); // ---- les cartes
  if (!b || !vue) return;
  const g = b.dataset.geste;
  if (g === "plus" || g === "moins") {
    auto = false;
    const cam = vue.cameraPartagee();
    // Les mêmes bornes que le pincement (VuePlan.limiter) : sinon « Dézoomer » éloigne sans fin, le plan devient un point.
    const z = Math.min(vue.zoomMax, Math.max(vue.zoomCadre() * 0.4, (vue.lh / cam.hv) * (g === "plus" ? 1.6 : 1 / 1.6)));
    vue.animerVers({ ...cam, hv: vue.lh / z }, 300);
  } else if (g === "tout") {
    auto = true;
    cadrer(700);
  } else if (g === "heros") recentrer();
});

// Le téléphone tourné, la fenêtre redimensionnée : la caméra automatique cadre de nouveau ce qui est révélé.
window.addEventListener("resize", () => {
  if (auto && vue && !scene.hidden) setTimeout(() => cadrer(1), 60);
});

ecouterFlux("table", bientot);
// « Je veux agir » (main-levee.js) : c'est ici que les joueurs sont pendant la partie, table ouverte ou non. Le bouton
// flotte en bas à droite ; les boutons du plan et la légende des héros lui laissent sa place (table-coin.css).
monterMainLevee();
// Un billet privé du MJ (prives.js) : l'avis paraît aussi par-dessus le plan.
monterBillets();
// ---- Les jets à distance : « Lancer un test », à gauche de « Je veux agir » ; sa feuille couvre le plan le
// temps du choix (jets-coin.js). ----
monterJets();
monterEtat(page);
// Son héros sous la main (19/11) : la fiche en résumé en bas à gauche, le sac et les notes en tiroirs sous « Mon héros ».
monterTableHeros(page);
// Le pointeur et la règle du MJ en lecture seule, et le pointeur du joueur vers le MJ (pointeurs-coin.js).
pointeursCoin = monterPointeurs({
  scene,
  toiles: { plan: toile, carte: scene.querySelector(".toile-carte") },
  vueActive: () => (scene.hidden ? null : carteCoin.visible ? (carteCoin.vue ? { genre: "carte", vue: carteCoin.vue } : null) : vue && !toile.hidden ? { genre: "plan", vue } : null),
  etat: () => dernier,
});
// Les jets de toute la tablée et les dés du MJ montrés à la table : dés en 3D, bandeau, jingle au volume de cet appareil.
const jetsDeLaTable = monterJetsDeLaTable();
// L'écran de la TV dans son cadre (même origine) : pas de zoom de page de là non plus, et un toucher dans le cadre
// ouvre la sortie audio comme un toucher sur la page.
cadre.addEventListener("load", () => {
  try {
    sansZoomDePage(cadre.contentDocument);
    for (const geste of ["touchend", "click"]) cadre.contentWindow.addEventListener(geste, () => jetsDeLaTable.sons.reveiller(), { passive: true });
  } catch {
    // cadre illisible : la page garde ses propres gardes
  }
});
// Ce que le flux n'a pas pu dire : un changement publié entre la première lecture et l'ouverture du flux, une nouvelle
// perdue en route. Une relecture peu après l'ouverture, puis de loin en loin tant que la page est à l'écran.
setTimeout(bientot, 1500);
setInterval(() => {
  if (document.visibilityState === "visible" && Date.now() - luLe > 25000) lire();
}, 30000);

(async () => {
  try {
    texture = await chargerImage("/static/img/carte-parchemin.jpg");
  } catch {
    // sans texture, le style parchemin se peint sur un fond uni
  }
  lire();
})();
