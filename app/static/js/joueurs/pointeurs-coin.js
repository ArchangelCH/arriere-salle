// Les pointeurs de la page Table du coin des joueurs (lot du 13/11).
//
//   - Le pointeur du MJ et sa règle (outil Mesurer), en lecture seule : l'atelier les écrit pour le coin quand la TV montre
//     ce plan ou cette carte (commun/pointeurs.py) ; le flux dit « pointeur », la page relit GET /api/pointeurs. Le point
//     est celui de la TV (pointeur-tv.js, un peu plus lissé : six positions par seconde arrivent, pas vingt) ; la règle est
//     un trait et sa mesure, posés sur le plan par la caméra du joueur.
//   - « Montrer au MJ » : le joueur touche le plan (ou la carte) pour signaler une envie d'action ; son pointeur paraît chez
//     le MJ, à la couleur de son héros. Un toucher fait une onde, un glissé promène le point, qui s'éteint seul. Le mode
//     prend les touchers du plan (plus de déplacement au doigt tant qu'il est pris) ; le bouton le quitte, et
//     le zoom reste aux boutons et à la molette.
//
// Rien de ce que le joueur envoie n'est un identifiant : le serveur sait quel plan la TV montre et qui est ce joueur.

import { api } from "../api.js";
import { PointeurTv } from "../ecran-tv/pointeur-tv.js";
import { ecouterFlux } from "./flux.js";

const AGE_MAX = 3.5; // secondes : au-delà, le point du MJ n'est plus à l'écran
const LISSAGE_COIN = 130; // millisecondes : le point rattrape sa position, six fois par seconde reçue
const PAS_ENVOI = 130; // millisecondes entre deux positions envoyées au MJ
const SEUIL_GLISSER = 8; // pixels : en deçà, un toucher qui tremble reste un toucher
const TOUCHER_MS = 450;
const LINGER_MS = 4000; // le point du joueur reste ce temps après le lever du doigt, puis s'éteint chez le MJ
const COULEUR_DEFAUT = "#e0b562";
const SVG = "http://www.w3.org/2000/svg";

// ---------------------------------------------------------------- la règle du MJ

class Regle {
  constructor(toile) {
    this.svg = document.createElementNS(SVG, "svg");
    this.svg.setAttribute("class", "regle-coin");
    this.svg.setAttribute("aria-hidden", "true");
    this.svg.hidden = true;
    this.trait = document.createElementNS(SVG, "line");
    this.trait.setAttribute("class", "regle-trait");
    this.bouts = [0, 1].map(() => {
      const c = document.createElementNS(SVG, "circle");
      c.setAttribute("class", "regle-bout");
      c.setAttribute("r", "5");
      return c;
    });
    this.texte = document.createElementNS(SVG, "text");
    this.texte.setAttribute("class", "regle-texte");
    this.texte.setAttribute("text-anchor", "middle");
    this.svg.append(this.trait, ...this.bouts, this.texte);
    toile.append(this.svg);
    this.vue = null;
    this.donnees = null; // { a: [x, y], b: [x, y], texte }
    this.raf = 0;
    this.ecrit = "";
  }

  montrer(donnees, vue) {
    this.donnees = donnees;
    this.vue = vue;
    this.svg.hidden = false;
    this.texte.textContent = donnees.texte || "";
    this.ecrit = "";
    this.demander();
  }

  cacher() {
    this.donnees = null;
    this.vue = null;
    this.svg.hidden = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  demander() {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.image());
  }

  // Le trait suit la caméra du joueur (qui bouge à son gré) : une image par rafraîchissement tant que la règle est là,
  // sans rien écrire dans la page quand rien ne bouge.
  image() {
    this.raf = 0;
    if (!this.donnees || !this.vue) return;
    const [ax, ay] = this.vue.versEcran(...this.donnees.a);
    const [bx, by] = this.vue.versEcran(...this.donnees.b);
    const cle = [ax, ay, bx, by].map((v) => v.toFixed(1)).join(",");
    if (cle !== this.ecrit) {
      this.ecrit = cle;
      this.trait.setAttribute("x1", ax.toFixed(1));
      this.trait.setAttribute("y1", ay.toFixed(1));
      this.trait.setAttribute("x2", bx.toFixed(1));
      this.trait.setAttribute("y2", by.toFixed(1));
      [[ax, ay], [bx, by]].forEach(([x, y], i) => {
        this.bouts[i].setAttribute("cx", x.toFixed(1));
        this.bouts[i].setAttribute("cy", y.toFixed(1));
      });
      // Le texte au milieu, au-dessus du trait (jamais à l'envers).
      this.texte.setAttribute("x", ((ax + bx) / 2).toFixed(1));
      this.texte.setAttribute("y", ((ay + by) / 2 - 12).toFixed(1));
    }
    this.demander();
  }
}

// ---------------------------------------------------------------- le point du joueur (retour local)

class MonPoint {
  constructor(toile) {
    this.el = document.createElement("i");
    this.el.className = "mon-pointeur";
    this.el.hidden = true;
    this.el.setAttribute("aria-hidden", "true");
    toile.append(this.el);
    this.vue = null;
    this.pos = null;
    this.raf = 0;
  }

  poser(vue, x, y, couleur, onde) {
    this.vue = vue;
    this.pos = [x, y];
    this.el.style.setProperty("--c", couleur);
    this.el.hidden = false;
    this.el.classList.remove("s-eteint");
    if (onde) {
      this.el.classList.remove("onde");
      void this.el.offsetWidth; // l'animation repart
      this.el.classList.add("onde");
    }
    this.placer();
  }

  placer() {
    if (!this.vue || !this.pos || this.el.hidden) return;
    const [px, py] = this.vue.versEcran(...this.pos);
    this.el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
    this.raf = requestAnimationFrame(() => this.placer());
  }

  eteindre() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.el.hidden = true;
    this.pos = null;
    this.vue = null;
  }
}

// ---------------------------------------------------------------- la page

// scene : la scène de la table ; toiles : { plan, carte } (leurs éléments) ; vueActive() : { genre, vue } de ce qui est à
// l'écran, ou null ; etat() : la dernière réponse de /api/table.
export function monter({ scene, toiles, vueActive, etat }) {
  const par = {};
  for (const genre of ["plan", "carte"]) {
    const toile = toiles[genre];
    const racine = document.createElement("div");
    racine.className = "pointeur-tv pointeur-coin";
    racine.setAttribute("aria-hidden", "true");
    toile.append(racine);
    par[genre] = { toile, point: new PointeurTv(racine, LISSAGE_COIN), regle: new Regle(toile), mien: new MonPoint(toile), vue: null };
  }

  // ---- ce que montre le MJ ----
  // Le plan ou la carte à l'écran, avec son jeton public : celui de la vue publiée, comme l'atelier l'écrit.
  const reference = () => {
    const r = etat();
    const v = r && r.ouverte ? r.vue : null;
    if (!v || (v.genre !== "plan" && v.genre !== "carte")) return null;
    const jeton = v.genre === "plan" ? v.plan && v.plan.id : v.ecran && v.ecran.etat && v.ecran.etat.carte;
    return typeof jeton === "string" ? { genre: v.genre, jeton } : null;
  };

  let dernier = { point: null, regle: null, lu: 0 };
  let derniereOnde = null;
  let numero = 0;

  function appliquer() {
    const ref = reference();
    const actif = vueActive();
    for (const genre of ["plan", "carte"]) {
      const { point, regle } = par[genre];
      const ici = ref && actif && ref.genre === genre && actif.genre === genre;
      // Un point qui n'a plus bougé depuis quelques secondes ne se rallume pas à chaque relecture (changement de vue).
      const vieux = dernier.point ? dernier.point.age + (performance.now() - dernier.lu) / 1000 : 0;
      const p = ici && dernier.point && dernier.point[genre] === ref.jeton && vieux < AGE_MAX ? dernier.point : null;
      if (p) {
        const nouvelle = p.onde !== derniereOnde && p.onde_age !== null && p.onde_age < 2;
        derniereOnde = p.onde;
        point.recevoir({ [genre]: ref.jeton, x: p.x, y: p.y, de: 1, ...(nouvelle ? { onde: true } : {}) }, actif.vue);
      } else point.recevoir({ efface: true, de: 1 }, null);
      const r = ici && dernier.regle && dernier.regle[genre] === ref.jeton ? dernier.regle : null;
      if (r) regle.montrer(r, actif.vue);
      else regle.cacher();
    }
  }

  async function lire() {
    const n = ++numero;
    try {
      const r = await api.get("/api/pointeurs");
      if (n !== numero) return;
      dernier = { point: r && r.point, regle: r && r.regle, lu: performance.now() };
      appliquer();
    } catch {
      // une coupure : le prochain événement du flux relit
    }
  }
  ecouterFlux("pointeur", lire);
  // La TV change de plan ou de carte : la règle et le point d'avant s'en vont, ceux d'après se relisent.
  ecouterFlux("table", () => setTimeout(lire, 250));
  lire();

  // ---- « Montrer au MJ » ----
  const bouton = scene.querySelector("[data-pointeur]");
  const indice = document.createElement("p");
  indice.className = "indice-pointeur";
  indice.hidden = true;
  indice.setAttribute("role", "status");
  indice.textContent = "Touchez le plan : le MJ voit où. Glissez pour promener le point.";
  scene.append(indice);
  if (!bouton) return { lire, appliquer };

  let mode = false;
  let enBas = null;
  let envoye = 0;
  let envoi = null; // le dernier message à envoyer, retenu entre deux envois
  let enVol = false;
  let eteint = 0;
  let retire = 0;

  const couleur = () => {
    const r = etat();
    const pions = r && r.vue && r.vue.plan && Array.isArray(r.vue.plan.pions) ? r.vue.plan.pions : [];
    const moi = pions.find((t) => t && t.id === r.pion);
    return moi && /^#[0-9a-f]{3,8}$/i.test(moi.couleur || "") ? moi.couleur : COULEUR_DEFAUT;
  };

  function regler(actif) {
    mode = actif;
    bouton.setAttribute("aria-pressed", String(actif));
    indice.hidden = !actif;
    for (const g of ["plan", "carte"]) par[g].toile.classList.toggle("mode-pointeur", actif);
    if (!actif) quitter();
  }

  function quitter() {
    clearTimeout(eteint);
    clearTimeout(retire);
    envoi = null;
    enBas = null;
    for (const g of ["plan", "carte"]) par[g].mien.eteindre();
    api.del("/api/pointeurs").catch(() => {});
  }

  async function partir() {
    if (enVol || !envoi) return;
    const m = envoi;
    envoi = null;
    enVol = true;
    envoye = performance.now();
    try {
      await api.post("/api/pointeurs", m);
    } catch (err) {
      // La table s'est fermée, ou la TV ne montre plus ni plan ni carte : le mode se quitte avec un mot.
      if (err && err.status === 409) {
        regler(false);
        indice.hidden = false;
        indice.textContent = err.message || "La TV ne montre plus rien à désigner.";
        setTimeout(() => {
          indice.hidden = true;
          indice.textContent = "Touchez le plan : le MJ voit où. Glissez pour promener le point.";
        }, 4000);
      }
    }
    enVol = false;
    if (envoi) setTimeout(partir, Math.max(0, PAS_ENVOI - (performance.now() - envoye)));
  }

  function envoyer(x, y, onde) {
    // Une onde passe toujours ; une position, au rythme des envois (la dernière n'est jamais perdue).
    envoi = { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, ...(onde ? { onde: true } : {}) };
    if (onde || performance.now() - envoye >= PAS_ENVOI) partir();
    else if (!enVol) setTimeout(partir, PAS_ENVOI - (performance.now() - envoye));
  }

  function surToile(genre, ev, type) {
    if (!mode) return;
    const actif = vueActive();
    if (!actif || actif.genre !== genre) return;
    // Ce toucher est au pointeur : ni déplacement ni double toucher de la vue.
    ev.stopImmediatePropagation();
    if (ev.cancelable) ev.preventDefault();
    const vue = actif.vue;
    const r = par[genre].toile.getBoundingClientRect();
    const px = ev.clientX - r.left;
    const py = ev.clientY - r.top;
    if (type === "bas") {
      if (!ev.isPrimary) return;
      try {
        par[genre].toile.setPointerCapture(ev.pointerId);
      } catch {
        // un pointeur déjà relâché
      }
      clearTimeout(eteint);
      enBas = { id: ev.pointerId, px, py, t: performance.now(), glisse: false };
      const [x, y] = vue.versCarte(px, py);
      par[genre].mien.poser(vue, x, y, couleur(), false);
      envoyer(x, y, false);
    } else if (type === "bouge" && enBas && enBas.id === ev.pointerId) {
      if (!enBas.glisse && Math.hypot(px - enBas.px, py - enBas.py) < SEUIL_GLISSER) return;
      enBas.glisse = true;
      const [x, y] = vue.versCarte(px, py);
      par[genre].mien.poser(vue, x, y, couleur(), false);
      envoyer(x, y, false);
    } else if (type === "haut" && enBas && enBas.id === ev.pointerId) {
      const bref = ev.type === "pointerup" && !enBas.glisse && performance.now() - enBas.t < TOUCHER_MS;
      enBas = null;
      if (bref) {
        const [x, y] = vue.versCarte(px, py);
        par[genre].mien.poser(vue, x, y, couleur(), true);
        envoyer(x, y, true);
      }
      // Le doigt levé, le point reste un instant chez le MJ, puis s'éteint (le serveur l'oublie de toute façon).
      clearTimeout(eteint);
      eteint = setTimeout(() => {
        par[genre].mien.eteindre();
        api.del("/api/pointeurs").catch(() => {});
      }, LINGER_MS);
    }
  }

  for (const genre of ["plan", "carte"]) {
    const toile = par[genre].toile;
    toile.addEventListener("pointerdown", (ev) => surToile(genre, ev, "bas"));
    toile.addEventListener("pointermove", (ev) => surToile(genre, ev, "bouge"));
    toile.addEventListener("pointerup", (ev) => surToile(genre, ev, "haut"));
    toile.addEventListener("pointercancel", (ev) => surToile(genre, ev, "haut"));
    toile.addEventListener("lostpointercapture", (ev) => {
      if (mode) ev.stopImmediatePropagation();
    });
  }
  bouton.addEventListener("click", () => regler(!mode));
  // La page cachée (téléphone en poche) : le pointeur s'efface chez le MJ.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && mode) regler(false);
  });
  window.addEventListener("pagehide", () => {
    if (mode) api.del("/api/pointeurs").catch(() => {});
  });
  return { lire, appliquer };
}
