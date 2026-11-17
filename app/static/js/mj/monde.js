// « Le monde » : la campagne telle que les joueurs la connaissent, en lecture seulement, pour un MJ invité qui
// prépare une quête annexe. Les cartes du monde telles que la TV les montrerait (sous le brouillard des joueurs, ni lieu
// caché ni repère), les lieux et les PNJ connus (GET /api/monde, ses projections publiques, sous des jetons). Aucun geste
// d'écriture : la carte se regarde (glisser, pincer, molette), elle ne se modifie pas, et rien ne part à la TV d'ici. Les
// lieux et les PNJ de l'invité se tiennent dans leurs onglets.
//
// La carte se dessine comme au coin des joueurs (joueurs/carte-coin.js) : sans le fond peint de la TV, que cette route ne
// donne pas, le relief se peint ici, plus grossier qu'à l'atelier, puis s'affine au zoom.

import { api, echapper as e } from "../api.js";
import { miniature } from "../commun/miniature.js";
import { decoderCarte } from "../carte/format.js";
import { chargerImage, gesteMolette, lireDefilement } from "../carte/vue.js";
import { TYPES_LIEUX } from "../carte/biomes.js";
import { VueCarteCoin } from "../joueurs/carte-coin.js";

const FEUILLE = "/static/css/monde.css";
const SEUIL_GLISSER = 6; // pixels avant qu'un toucher devienne un glissé
const sansAccent = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const TYPES = Object.fromEntries(TYPES_LIEUX.map((t) => [t.cle, t.nom]));
let texture = null;

// La feuille de la page, attendue avant de dessiner : la carte se cadre sur la taille de son cadre.
function poserFeuille() {
  if (document.querySelector(`link[href="${FEUILLE}"]`)) return Promise.resolve();
  return new Promise((ok) => {
    const lien = document.createElement("link");
    lien.rel = "stylesheet";
    lien.href = FEUILLE;
    lien.onload = lien.onerror = () => ok();
    document.head.append(lien);
  });
}

// La carte du monde la plus large d'abord (sans carte parente), puis par nom.
const rangerCartes = (cartes) => [...cartes].sort((a, b) => Number(!!a.parent) - Number(!!b.parent) || a.nom.localeCompare(b.nom, "fr"));

export class Monde {
  constructor(racine) {
    this.racine = racine;
    this.ecoute = new AbortController();
    this.vue = null;
    this.numero = 0;
    // Tant que la vue n'a pas été touchée, elle montre toute la carte, même tournée ou redimensionnée.
    this.auto = true;
  }

  async demarrer() {
    const [monde] = await Promise.all([api.get("/api/monde"), poserFeuille()]);
    if (this.detruit) return;
    this.cartes = rangerCartes(monde.cartes || []);
    this.lieux = monde.lieux || [];
    this.pnj = monde.pnj || [];
    this.racine.innerHTML = this.gabarit();
    const r = this.racine.querySelector(".page-monde");
    r.addEventListener("click", (ev) => this.clic(ev), { signal: this.ecoute.signal });
    r.addEventListener("input", (ev) => this.filtrer(ev), { signal: this.ecoute.signal });
    if (this.cartes.length) await this.montrer(this.cartes[0].id);
  }

  detruire() {
    this.detruit = true;
    this.numero++;
    this.ecoute.abort();
    this.observateur?.disconnect();
    this.vue?.detruire();
    this.vue = null;
  }

  gabarit() {
    const n = (liste, un, plusieurs) => `${liste.length} ${liste.length > 1 ? plusieurs : un}`;
    return `
    <section class="page-liste page-monde">
      <header class="titre-page">
        <p class="kicker">Ce que savent les joueurs</p>
        <h1>Le monde</h1>
        <p class="chapo">Les cartes, les lieux et les personnages de la campagne tels que les joueurs les connaissent. En lecture seulement : vos lieux et vos PNJ se tiennent dans leurs onglets.</p>
      </header>
      <section class="bloc monde-cartes">
        <h2>Les cartes</h2>
        ${this.cartes.length ? `
        <div class="choix-cartes" role="group" aria-label="Choisir une carte">${this.cartes.map((c) => `
          <button type="button" data-carte="${e(c.id)}" aria-pressed="false">${e(c.nom || "Sans nom")}</button>`).join("")}
        </div>
        <div class="cadre-monde">
          <canvas class="carte-monde"></canvas>
          <p class="attente-carte" role="status" hidden>La carte se dessine…</p>
          <div class="gestes-monde">
            <button type="button" data-geste="plus" aria-label="Zoomer" title="Zoomer">+</button>
            <button type="button" data-geste="moins" aria-label="Dézoomer" title="Dézoomer">−</button>
            <button type="button" data-geste="tout" title="Toute la carte">Tout voir</button>
          </div>
        </div>
        <p class="aide">Telle que la TV la montrerait : seulement ce que les joueurs en ont vu. Glissez pour déplacer la vue ; pincez, ou la molette, pour zoomer.</p>`
        : '<p class="vide">Aucune carte n\'est encore connue des joueurs.</p>'}
      </section>
      <div class="grille-monde">
        <section class="bloc monde-lieux">
          <h2>Les lieux connus <small>${e(n(this.lieux, "lieu", "lieux"))}</small></h2>
          ${this.lieux.length ? `<input type="search" class="recherche" data-filtre="lieux" placeholder="Chercher un lieu" aria-label="Chercher un lieu">` : ""}
          <ul class="liste-monde">${this.lieux.map((l) => `
            <li data-nom="${e(sansAccent(l.nom))}">
              ${l.illustration ? `<img class="vignette-monde" src="${e(miniature(l.illustration, 160))}" alt="" width="56" height="56" loading="lazy" decoding="async">` : '<span class="vignette-monde vide" aria-hidden="true"></span>'}
              <span class="texte"><b>${e(l.nom)}</b><span class="meta">${e(TYPES[l.type] || l.type || "")}</span>${l.resume ? `<span class="resume">${e(l.resume)}</span>` : ""}</span>
            </li>`).join("") || '<li class="vide">Aucun lieu n\'est encore connu des joueurs.</li>'}
          </ul>
        </section>
        <section class="bloc monde-pnj">
          <h2>Les personnages connus <small>${e(n(this.pnj, "personnage", "personnages"))}</small></h2>
          ${this.pnj.length ? `<input type="search" class="recherche" data-filtre="pnj" placeholder="Chercher un personnage" aria-label="Chercher un personnage">` : ""}
          <ul class="liste-monde">${this.pnj.map((p) => `
            <li data-nom="${e(sansAccent([p.nom, p.surnom, p.role].join(" ")))}">
              ${p.illustration ? `<img class="vignette-monde" src="${e(miniature(p.illustration, 160))}" alt="" width="56" height="56" loading="lazy" decoding="async">` : '<span class="vignette-monde vide" aria-hidden="true"></span>'}
              <span class="texte"><b>${e(p.nom)}${p.surnom ? ` <i>« ${e(p.surnom)} »</i>` : ""}</b><span class="meta">${e([p.role, p.peuple].filter(Boolean).join(" · "))}</span>${p.apparence ? `<span class="resume">${e(p.apparence)}</span>` : ""}</span>
            </li>`).join("") || '<li class="vide">Aucun personnage n\'est encore connu des joueurs.</li>'}
          </ul>
        </section>
      </div>
    </section>`;
  }

  filtrer(ev) {
    const champ = ev.target.closest("[data-filtre]");
    if (!champ) return;
    const q = sansAccent(champ.value.trim());
    for (const li of champ.closest(".bloc").querySelectorAll(".liste-monde li[data-nom]")) li.hidden = Boolean(q) && !li.dataset.nom.includes(q);
  }

  clic(ev) {
    const b = ev.target.closest("button");
    if (!b || this.detruit) return;
    if (b.dataset.carte) return this.montrer(b.dataset.carte);
    if (b.dataset.geste && this.vue?.champs) {
      if (b.dataset.geste === "tout") {
        this.auto = true;
        return this.vue.animerVers({}, 500);
      }
      this.auto = false;
      const cam = this.vue.cameraPartagee();
      this.vue.animerVers({ ...cam, hv: cam.hv * (b.dataset.geste === "plus" ? 1 / 1.6 : 1.6) }, 300);
    }
  }

  async montrer(j) {
    const n = ++this.numero;
    for (const b of this.racine.querySelectorAll("[data-carte]")) b.setAttribute("aria-pressed", String(b.dataset.carte === j));
    const cadre = this.racine.querySelector(".cadre-monde");
    const attente = cadre.querySelector(".attente-carte");
    attente.hidden = false;
    let json;
    try {
      [json] = await Promise.all([api.get(`/api/monde/cartes/${encodeURIComponent(j)}`), texture ? null : chargerImage("/static/img/carte-parchemin.jpg").then((t) => { texture = t; }, () => {})]);
    } catch (err) {
      if (n !== this.numero) return;
      attente.textContent = `La carte ne se lit pas : ${err.message}.`;
      return;
    }
    if (n !== this.numero || this.detruit) return;
    const toile = cadre.querySelector(".carte-monde");
    toile.setAttribute("aria-label", `Carte « ${this.cartes.find((c) => c.id === j)?.nom || ""} »`);
    if (!this.vue) {
      this.vue = new VueCarteCoin(toile, { texture, fond: "#140f0b" });
      brancherGestes(toile, this.vue, this.ecoute.signal, () => { this.auto = false; });
      this.observateur = new ResizeObserver(() => {
        if (this.auto && this.vue?.champs) requestAnimationFrame(() => this.vue?.cadrer());
      });
      this.observateur.observe(toile);
    }
    const carte = decoderCarte(json);
    const lieux = json.lieux || {};
    for (const l of Object.values(lieux)) l.connu = true;
    // Deux images d'écran : le mot d'attente paraît avant que le relief ne prenne la main.
    await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    if (n !== this.numero || this.detruit) return;
    this.vue.style = json.style || "couleur";
    this.vue.surLeFond = false;
    this.vue.charger(carte, lieux, { fond: null });
    this.auto = true;
    this.vue.cadrer();
    this.vue.demander();
    attente.hidden = true;
  }
}

// Un doigt (ou la souris) déplace la vue, deux doigts zooment autour d'eux, la molette zoome (ou déplace, pavé tactile).
function brancherGestes(el, vue, signal, surBouge) {
  const doigts = new Map();
  let pince = null;
  let depart = null;
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
    depart = doigts.size === 1 ? { ...ici, glisse: false } : null;
    if (doigts.size === 2) pince = mesure();
    el.classList.add("en-main");
  }, { signal });
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
  }, { signal });
  const lacher = (ev) => {
    if (!doigts.delete(ev.pointerId)) return;
    if (doigts.size < 2) pince = null;
    if (!doigts.size) {
      depart = null;
      el.classList.remove("en-main");
    }
  };
  for (const nom of ["pointerup", "pointercancel", "lostpointercapture"]) el.addEventListener(nom, lacher, { signal });
  el.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const r = el.getBoundingClientRect();
    const g = gesteMolette(ev, lireDefilement(), vue.lh);
    if (g.glisser) vue.deplacer(g.glisser[0], g.glisser[1]);
    else vue.zoomer(g.zoom, ev.clientX - r.left, ev.clientY - r.top);
    surBouge();
  }, { passive: false, signal });
  // Safari : le pincement ne zoome jamais la page, seulement la carte.
  for (const nom of ["gesturestart", "gesturechange", "gestureend"]) el.addEventListener(nom, (ev) => ev.preventDefault(), { signal });
}
