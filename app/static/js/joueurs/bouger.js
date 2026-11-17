// Bouger son pion, sur la table du coin des joueurs. Le joueur touche son pion (ou le bouton « Bouger ») :
// les cases qu'il peut atteindre s'éclairent. Il touche l'une d'elles (une confirmation légère si c'est loin) : pions
// libres, son pion y glisse aussitôt ; pions à valider, un pion fantôme attend avec « Le MJ valide… ». En combat, hors de
// son tour : « Ce n'est pas votre tour ». Au doigt comme à la souris ; Échap renonce.
// Si le MJ le permet (« entrer », lot E4), certaines cases sont des tentatives, en pointillés : derrière une porte fermée
// (le héros l'ouvre en passant), ou un pas dans le noir. Le joueur confirme qu'il tente ; l'atelier seul sait si la porte
// est fermée à clé ou si un mur l'arrête, et le pion ne part qu'une fois la réponse venue.
//
// Les cases se calculent sur ce que la page a reçu (plan/deplacement.js, la projection publique que voit la TV), avec le
// réglage du MJ et le tour du héros publiés par l'atelier ; le coin le revérifie avant d'écrire la demande, l'atelier
// sur le plan du moment avant de poser le pion. La page apprend la suite par le flux (sujets « table » et « demandes »).

import { api, echapper as e } from "../api.js";
import { GENRE, Grille, caseDuPion, casesAtteignables, verifierDeplacement } from "../plan/deplacement.js";
import { ecouterFlux } from "./flux.js";

const LOIN = 6; // cases : à partir de là, le joueur confirme d'un second geste
const DOUBLE_MS = 330; // un double toucher recentre la vue : la case touchée attend de savoir si c'en est un
const SECOURS_MS = 4000; // sans nouvelle de l'atelier, la page relit la table
const FINS = { echec: "Pas possible", refusee: "Le MJ a refusé", retiree: "Retiré", annulee: "Le MJ a annulé ce déplacement" };
// Une case qu'on tente plutôt qu'on atteint : une porte fermée à ouvrir en chemin, ou un pas dans le noir.
const tentee = (v) => !!v && (v.entree || v.portes > 0);

const ICONE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/></svg>';

export class Bouger {
  // vue : la VueTableCoin ; scene : la scène de la page ; relire() : relit /api/table ; surCadre() : la vue a été
  // déplacée pour le joueur (la page ne la recadre plus d'elle-même).
  constructor({ vue, scene, relire, surCadre = null }) {
    this.vue = vue;
    this.scene = scene;
    this.relire = relire;
    this.surCadre = surCadre;
    this.r = null; // la dernière réponse de /api/table montrant un plan
    this.choix = false; // les cases atteignables sont-elles montrées ?
    this.cases = new Map();
    this.attente = null; // { id, vers, statut, depuis, t } : le déplacement envoyé, jusqu'à ce que la table le montre
    this.confirmer = null; // { vers, distance }
    this.toucherDiffere = 0;
    this.secours = 0;
    this.envoi = false;
    this.bouton = document.createElement("button");
    Object.assign(this.bouton, { type: "button", hidden: true, innerHTML: ICONE });
    this.bouton.dataset.geste = "bouger";
    this.bouton.setAttribute("aria-label", "Bouger mon pion");
    this.bouton.title = "Bouger mon pion";
    this.bouton.addEventListener("click", () => (this.choix ? this.renoncer() : this.activer()));
    scene.querySelector(".commandes-table")?.prepend(this.bouton);
    this.avis = document.createElement("div");
    this.avis.className = "avis-bouger";
    this.avis.setAttribute("role", "status");
    this.avis.hidden = true;
    this.avis.addEventListener("click", (ev) => this.clicAvis(ev));
    scene.querySelector(".toile-table")?.after(this.avis);
    vue.sousLesPions = (ctx) => this.dessinerCases(ctx);
    vue.dessusEditeur = (ctx) => this.dessinerFantome(ctx);
    window.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && (this.choix || this.confirmer)) this.renoncer();
    });
    ecouterFlux("demandes", () => this.suivre());
    // L'avis se replace quand ce qui occupe le bas du plan change de taille : la légende des héros, « Je veux agir » (qui
    // grandit main levée), l'écran tourné.
    const replacer = () => this.placerAvis();
    window.addEventListener("resize", replacer);
    this.observe = typeof ResizeObserver === "function" ? new ResizeObserver(replacer) : null;
    const legende = scene.querySelector(".legende-coin");
    if (legende) this.observe?.observe(legende);
  }

  // ---------------------------------------------------------------- ce que dit la table

  get plan() {
    return this.r?.vue?.plan || null;
  }

  get regles() {
    return this.r?.vue?.regles || {};
  }

  get tour() {
    return { combat: this.r?.combat === true, mon_tour: this.r?.mon_tour === true, debut: this.r?.debut || null };
  }

  monPion() {
    const id = this.r?.pion;
    return id && this.plan ? (this.plan.pions || []).find((t) => t.id === id) || null : null;
  }

  // Chaque lecture de la table (un plan), avant que la page ne la dessine : le pion a pu arriver, le tour passer, le MJ
  // changer le réglage. Un pion libre parti mais pas encore posé par l'atelier reste dessiné à son arrivée (r change).
  maj(r) {
    this.r = r && r.vue && r.vue.genre === "plan" ? r : null;
    const t = this.monPion();
    this.bouton.hidden = !t || this.regles.pions === "figes";
    if (this.attente) {
      const ici = t ? caseDuPion(t) : null;
      const a = this.attente;
      const memeCase = (c) => ici && ici[0] === c[0] && ici[1] === c[1];
      if (!t || memeCase(a.vers)) this.finir("");
      else if (a.statut === "a-appliquer" && memeCase(a.depuis)) {
        if (!a.tente) this.poserEnAvance(false);
      } else if (a.statut === "a-appliquer") this.finir("");
    }
    // Un « pourquoi pas » dit plus tôt (pas votre tour, pions figés…) qui ne tient plus ne reste pas affiché : le tour
    // arrivé, l'avis le dit ; sinon il s'efface.
    if (this.raison && !this.choix && !this.attente && !this.confirmer && this.pourquoiPas() !== this.raison) {
      const etait = this.raison;
      if (etait === "Ce n'est pas votre tour." && this.tour.combat && this.tour.mon_tour) {
        this.dire("À vous de jouer : touchez votre pion pour bouger.", '<button type="button" data-avis="fermer">Compris</button>');
      } else this.cacherAvis();
    }
    if (this.choix) {
      this.calculer();
      if (!this.cases.size) {
        this.choix = false;
        this.dire(this.pourquoiPas() || "Plus aucune case à portée.");
      }
    }
    this.vue.demander();
  }

  // Pourquoi le pion ne peut pas bouger maintenant (rien : il le peut).
  pourquoiPas() {
    const t = this.monPion();
    if (!t) return "Votre héros n'est pas sur le plan que montre la TV.";
    if (this.regles.pions === "figes") return "Votre MJ a figé les pions : demandez-lui de vive voix.";
    if (this.tour.combat && !this.tour.mon_tour) return "Ce n'est pas votre tour.";
    if (Math.round(t.taille || 1) > 1) return "Votre pion est trop grand pour bouger d'ici : demandez à votre MJ.";
    return "";
  }

  calculer() {
    const t = this.monPion();
    this.cases = t ? casesAtteignables(this.plan, t.id, this.regles, this.tour) : new Map();
  }

  // ---------------------------------------------------------------- les gestes

  // Un toucher bref sur le plan, en cases. Rend vrai s'il a servi (le pion, une case, ou un renoncement).
  toucher(x, y) {
    const t = this.monPion();
    if (!t || !this.plan) return false;
    const c = [Math.floor(x), Math.floor(y)];
    const ici = caseDuPion(t);
    const surMoi = c[0] === ici[0] && c[1] === ici[1];
    if (this.attente) {
      if (surMoi || this.surFantome(c)) this.dire(this.texteAttente(), this.boutonsAttente());
      return surMoi;
    }
    if (this.confirmer) {
      this.confirmer = null;
      this.cacherAvis();
    }
    if (!this.choix) {
      if (!surMoi) return false;
      this.activer();
      return true;
    }
    if (surMoi) {
      this.renoncer();
      return true;
    }
    const v = this.cases.get(`${c[0]},${c[1]}`);
    clearTimeout(this.toucherDiffere);
    if (!v) {
      // Une case hors d'atteinte : la raison, sur ce que voit le joueur.
      const verdict = verifierDeplacement(this.plan, { pion: t.id, depuis: ici, vers: c }, this.regles, this.tour);
      this.dire(verdict.ok ? "Cette case n'est pas à portée." : verdict.refus, '<button type="button" data-avis="renoncer">Ne pas bouger</button>');
      return true;
    }
    this.toucherDiffere = setTimeout(() => this.choisir(c, v), DOUBLE_MS);
    return true;
  }

  // Un double toucher : il recentre la vue, il ne déplace rien.
  double() {
    clearTimeout(this.toucherDiffere);
  }

  activer() {
    if (this.attente) return this.dire(this.texteAttente(), this.boutonsAttente());
    const non = this.pourquoiPas();
    if (non) {
      this.dire(non);
      this.raison = non;
      return;
    }
    this.calculer();
    if (!this.cases.size) {
      return this.dire(this.regles.entrer === true ? "Aucune case à portée : un mur ou un adversaire vous retient."
        : "Aucune case à portée : un mur, une porte fermée ou un adversaire vous retient.");
    }
    this.choix = true;
    this.bouton.setAttribute("aria-pressed", "true");
    const combat = this.tour.combat;
    const limite = this.regles[combat ? "distance_combat" : "distance"];
    const tentatives = [...this.cases.values()].some(tentee);
    this.dire(`Touchez une case éclairée (${limite} case${limite > 1 ? "s" : ""} au plus${combat ? " pour ce tour" : ""}).`
      // Court : sur un téléphone, l'avis couvre le bas du plan, là où se tient souvent le héros. « Tenter » dit le reste.
      + (tentatives ? " En pointillés, vous tentez votre chance." : ""),
      '<button type="button" data-avis="renoncer">Ne pas bouger</button>');
    this.degager();
    this.vue.demander();
  }

  renoncer() {
    clearTimeout(this.toucherDiffere);
    this.choix = false;
    this.confirmer = null;
    this.bouton.setAttribute("aria-pressed", "false");
    this.cacherAvis();
    this.vue.demander();
  }

  choisir(vers, v) {
    // Une tentative se confirme toujours : le joueur sait qu'il ouvre une porte, ou qu'il avance dans le noir.
    if (tentee(v)) {
      this.confirmer = { vers, distance: v.d, tente: true };
      this.dire(this.texteTentative(vers, v),
        '<button type="button" class="principal" data-avis="aller">Tenter</button><button type="button" data-avis="renoncer">Non</button>');
      this.degager();
      this.vue.demander();
      return;
    }
    if (v.d >= LOIN) {
      this.confirmer = { vers, distance: v.d };
      this.dire(`Aller jusque-là, à ${v.d} cases ?`,
        '<button type="button" class="principal" data-avis="aller">Y aller</button><button type="button" data-avis="renoncer">Non</button>');
      this.vue.demander();
      return;
    }
    this.envoyer(vers);
  }

  // Ce que le joueur tente : ouvrir une ou plusieurs portes, entrer derrière, ou avancer d'un pas dans le noir.
  texteTentative(vers, v) {
    const loin = `à ${v.d} case${v.d > 1 ? "s" : ""}`;
    const portes = v.portes > 1 ? `ouvrir ${v.portes} portes` : "ouvrir la porte";
    if (v.entree && v.portes) return `Tenter d'${portes} et d'entrer, ${loin} ? Vous ne savez pas ce qu'il y a derrière.`;
    if (v.entree) {
      const g = this.plan ? new Grille(this.plan, this.r?.pion) : null;
      const de = v.de ? v.de.split(",").map(Number) : null;
      const parPorte = g && de && g.porte(de[0], de[1], vers[0] - de[0], vers[1] - de[1]);
      return parPorte ? `Entrer, ${loin} ? Vous ne savez pas ce qu'il y a derrière.`
        : `Avancer d'un pas dans le noir, ${loin} ? Un mur peut vous arrêter.`;
    }
    return `Tenter d'${portes} et d'aller jusque-là, ${loin} ? ${v.portes > 1 ? "Elles peuvent être fermées" : "Elle peut être fermée"} à clé.`;
  }

  clicAvis(ev) {
    const b = ev.target.closest("[data-avis]");
    if (!b) return;
    const a = b.dataset.avis;
    if (a === "renoncer") this.renoncer();
    else if (a === "aller" && this.confirmer) this.envoyer(this.confirmer.vers, this.confirmer.tente === true);
    else if (a === "retirer") this.retirer();
    else if (a === "fermer") this.cacherAvis();
  }

  // tente : une porte à ouvrir ou un pas dans le noir ; le pion attend la réponse de l'atelier avant de partir.
  async envoyer(vers, tente = false) {
    const t = this.monPion();
    if (!t || this.envoi) return;
    const depuis = caseDuPion(t);
    this.envoi = true;
    this.confirmer = null;
    this.choix = false;
    this.bouton.setAttribute("aria-pressed", "false");
    try {
      const d = await api.post("/api/demandes", { genre: GENRE, corps: { plan: this.plan.id, pion: t.id, depuis, vers } });
      this.attente = { id: d.id, vers, depuis, statut: d.statut, t: Date.now(), tente };
      if (d.statut === "a-appliquer" && tente) this.dire("Vous tentez votre chance…");
      else if (d.statut === "a-appliquer") {
        // Pions libres : il glisse tout de suite ; la table de l'atelier le confirme dans la seconde.
        this.poserEnAvance(true);
        this.dire("En route…");
      } else this.dire(this.texteAttente(), this.boutonsAttente());
      clearTimeout(this.secours);
      this.secours = setTimeout(() => this.relire(), SECOURS_MS);
    } catch (err) {
      this.dire(err.status === 423 && /pause/i.test(err.message) ? err.message : err.message || "Déplacement impossible pour l'instant.",
        '<button type="button" data-avis="fermer">Bien</button>');
      if (err.status === 409) this.relire();
    } finally {
      this.envoi = false;
      this.vue.demander();
    }
  }

  // Le pion du joueur à sa case d'arrivée, dans ce que montre la page, sans attendre la table de l'atelier : le plan reçu
  // le porte déjà là (la page le dessine sans le faire revenir) ; glisser : il y glisse tout de suite.
  poserEnAvance(glisser) {
    const a = this.attente;
    const p = this.plan;
    if (!a || !p) return;
    p.pions = (p.pions || []).map((x) => (x.id === this.r.pion ? { ...x, x: a.vers[0] + 0.5, y: a.vers[1] + 0.5 } : x));
    if (glisser) this.vue.majPions(p.pions.slice());
  }

  async retirer() {
    const a = this.attente;
    if (!a) return;
    try {
      await api.del(`/api/demandes/${encodeURIComponent(a.id)}`);
      this.finir("Vous avez retiré ce déplacement.");
    } catch (err) {
      this.dire(err.message, '<button type="button" data-avis="fermer">Bien</button>');
    }
  }

  // Ce que l'atelier a fait de la demande : posée (la table la montrera), refusée, en échec.
  async suivre() {
    const a = this.attente;
    if (!a) return;
    let r;
    try {
      r = await api.get("/api/demandes");
    } catch {
      return;
    }
    if (this.attente !== a) return;
    const d = (r.demandes || []).find((x) => x.id === a.id);
    if (!d) return;
    a.statut = d.statut;
    if (FINS[d.statut]) {
      const mot = d.mot ? ` : « ${d.mot} »` : "";
      this.finir(d.statut === "echec" ? d.resultat || FINS.echec : `${FINS[d.statut]}${mot}.`, true);
      this.relire();
    } else if (d.statut === "appliquee" || d.statut === "acceptee") this.relire();
  }

  finir(texte, garder = false) {
    clearTimeout(this.secours);
    this.attente = null;
    if (texte) this.dire(texte, garder ? '<button type="button" data-avis="fermer">Bien</button>' : "");
    else this.cacherAvis();
    this.vue.demander();
  }

  texteAttente() {
    return this.attente?.statut === "en-attente" ? "Le MJ valide…" : this.attente?.tente ? "Vous tentez votre chance…" : "En route…";
  }

  boutonsAttente() {
    return this.attente?.statut === "en-attente" ? '<button type="button" data-avis="retirer">Retirer</button>' : "";
  }

  surFantome(c) {
    return !!this.attente && c[0] === this.attente.vers[0] && c[1] === this.attente.vers[1];
  }

  // ---------------------------------------------------------------- l'avis, sous le plan

  dire(texte, boutons = "") {
    this.raison = null;
    this.avis.hidden = false;
    this.avis.classList.toggle("attente", !!this.attente && this.attente.statut === "en-attente");
    this.avis.innerHTML = `<p>${e(texte)}</p>${boutons ? `<div class="gestes-avis">${boutons}</div>` : ""}`;
    this.placerAvis();
  }

  // Au-dessus de ce qui occupe déjà le bas du plan : la légende des héros (une à trois lignes, plus haut quand « Je veux
  // agir » est là) et « Je veux agir », posé par-dessus tout en bas à droite (un doigt qui viserait « Non » lèverait la main).
  placerAvis() {
    if (this.avis.hidden) return;
    const cadre = this.avis.offsetParent;
    if (!cadre) return;
    const bas = cadre.getBoundingClientRect().bottom;
    const main = document.querySelector(".main-levee");
    if (main && this.observe && !this.mainObservee) {
      this.observe.observe(main);
      this.mainObservee = true;
    }
    let haut = Infinity;
    for (const el of [this.scene.querySelector(".legende-coin"), main]) {
      if (!el || el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (r.height) haut = Math.min(haut, r.top);
    }
    this.avis.style.bottom = Number.isFinite(haut) && haut < bas ? `${Math.max(12, Math.ceil(bas - haut) + 8)}px` : "";
  }

  // Au téléphone, l'avis couvre le bas du plan, là où se tient souvent le héros : la vue remonte le plan (sans changer de
  // zoom) pour que son pion, son nom et une case autour restent au-dessus de l'avis. Rien s'il s'y voit déjà.
  degager() {
    const t = this.vue.pionDuJoueur?.() || this.monPion();
    if (!t || this.avis.hidden || !this.vue.lh || !this.vue.canvas) return;
    const toile = this.vue.canvas.getBoundingClientRect();
    const libre = this.avis.getBoundingClientRect().top - toile.top - 8; // le haut de l'avis, en pixels de la vue
    if (!(libre > 0)) return;
    const z = this.vue.cam.z;
    const y = this.vue.versEcran(t.x, t.y)[1];
    const marge = (0.5 * (t.taille || 1) + 1) * z + 20;
    if (y - marge >= 0 && y + marge <= libre) return;
    // Au milieu de la place libre ; si elle est trop courte pour la marge entière, le pion juste au-dessus de l'avis.
    const voulu = libre >= 2 * marge ? libre / 2 : Math.max(libre / 2, libre - marge);
    const cam = this.vue.cameraPartagee();
    this.vue.animerVers({ x: cam.x, y: t.y + (this.vue.lh / 2 - voulu) / z, hv: cam.hv }, 450);
    this.surCadre?.();
  }

  cacherAvis() {
    this.raison = null;
    this.avis.hidden = true;
    this.avis.innerHTML = "";
  }

  // ---------------------------------------------------------------- le dessin, dans le repère du plan

  // Les cases atteignables, sous les pions : un voile doré, la case visée cerclée. Les tentatives en pointillés : un pas
  // dans le noir, sans voile (rien de la case n'est connu) ; derrière une porte à ouvrir, un voile pâle.
  dessinerCases(ctx) {
    if (!this.choix && !this.confirmer) return;
    const z = this.vue.cam.z;
    ctx.save();
    ctx.lineWidth = Math.max(1.5 / z, 0.03);
    for (const [cle, v] of this.cases) {
      const [x, y] = cle.split(",").map(Number);
      if (tentee(v)) {
        if (!v.entree) {
          ctx.fillStyle = "rgba(240, 203, 120, .12)";
          ctx.fillRect(x + 0.04, y + 0.04, 0.92, 0.92);
        }
        ctx.setLineDash([0.12, 0.1]);
        ctx.strokeStyle = "rgba(240, 203, 120, .85)";
        ctx.strokeRect(x + 0.08, y + 0.08, 0.84, 0.84);
        ctx.setLineDash([]);
        continue;
      }
      ctx.fillStyle = "rgba(240, 203, 120, .3)";
      ctx.fillRect(x + 0.04, y + 0.04, 0.92, 0.92);
      ctx.strokeStyle = "rgba(240, 203, 120, .7)";
      ctx.strokeRect(x + 0.06, y + 0.06, 0.88, 0.88);
    }
    if (this.confirmer) {
      const [x, y] = this.confirmer.vers;
      ctx.lineWidth = Math.max(3 / z, 0.07);
      ctx.strokeStyle = "#f0cb78";
      ctx.strokeRect(x + 0.03, y + 0.03, 0.94, 0.94);
    }
    ctx.restore();
  }

  // Le pion fantôme qui attend le MJ : un disque pâle à la case visée, relié à sa case d'origine.
  dessinerFantome(ctx) {
    const a = this.attente;
    if (!a || a.statut !== "en-attente") return;
    const t = this.monPion();
    const z = this.vue.cam.z;
    const [x, y] = [a.vers[0] + 0.5, a.vers[1] + 0.5];
    ctx.save();
    if (t) {
      ctx.setLineDash([0.18, 0.14]);
      ctx.lineWidth = Math.max(2 / z, 0.05);
      ctx.strokeStyle = "rgba(240, 203, 120, .7)";
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = /^#[0-9a-f]{3,8}$/i.test(t?.couleur || "") ? t.couleur : "#c29b5c";
    ctx.beginPath();
    ctx.arc(x, y, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.setLineDash([0.12, 0.09]);
    ctx.lineWidth = Math.max(2.5 / z, 0.06);
    ctx.strokeStyle = "#f0cb78";
    ctx.stroke();
    ctx.restore();
  }
}
