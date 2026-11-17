// La page Réglages (#/reglages, lien « Réglages » à côté du nom de l'atelier) : tous les paramètres et les accès en un
// seul endroit, en sections (#/reglages/coin, /table, /regles, /acces, /redaction). Avant, ils vivaient un peu partout
// (onglets Table, Aventuriers, Bible, Sanctuaire, page des activités, panneau Musique) ; à ces endroits, un lien discret
// mène ici. Les commandes de jeu (montrer à la TV, Tableau, combat, la boîte des demandes) restent où elles sont.
//
// Par rôle : un MJ invité ne voit que ce qui le concerne (son mot de passe, ses appareils, sa suite au carnet, la
// musique commune, son budget en lecture). Les réglages du compte principal se chargent au clic, chez lui seulement
// (reglages/principal.js, absent de acces_mj.STATIQUES_INVITE) ; le serveur refuse de toute façon leurs routes à
// l'invité.

import { api, echapper as e } from "../api.js";
import { estInvite } from "../mj/role.js";

const SECTIONS = {
  coin: ["Le coin des joueurs", "Ce que les joueurs voient et peuvent faire depuis leur téléphone : leur carnet, la table, la bible, le sanctuaire, les activités, et la pause."],
  table: ["Table et TV", "Ce que montrent la TV du salon et la table publique, et la musique qui accompagne la partie."],
  regles: ["Règles de jeu", "Les règles optionnelles, les déplacements des joueurs et le confort de la table."],
  acces: ["Accès", "Qui entre dans l'atelier et dans le coin : votre mot de passe, vos appareils, les autres MJ, les comptes des joueurs."],
  redaction: ["Rédaction", "Ce que coûte la rédaction ce mois-ci, et ce que chacun peut y dépenser."],
};
const INVITE = {
  acces: "Votre mot de passe et vos appareils.",
  table: "Le nom de votre suite au carnet et à la TV, et la musique qui accompagne la partie.",
  redaction: "Ce que vous avez dépensé ce mois-ci, sur le budget que vous donne le MJ principal.",
};
const ORDRE_PRINCIPAL = ["coin", "table", "regles", "acces", "redaction"];
const ORDRE_INVITE = ["acces", "table", "redaction"];

export class Reglages {
  constructor(racine, { section = "", parametres = new URLSearchParams() } = {}) {
    this.racine = racine;
    this.section = section;
    this.parametres = parametres;
    this.invite = estInvite();
    this.ordre = this.invite ? ORDRE_INVITE : ORDRE_PRINCIPAL;
    this.detruit = false;
    this.principal = null;
    this.lien = null;
    this.surClic = (ev) => this.clic(ev);
  }

  async demarrer() {
    this.racine.innerHTML = this.gabarit();
    this.grilles = Object.fromEntries(this.ordre.map((s) => [s, this.racine.querySelector(`[data-grille="${s}"]`)]));
    this.racine.querySelector(".page-reglages").addEventListener("click", this.surClic);
    // Le lien de l'en-tête dit qu'on est ici (liens-atelier.js).
    this.lien = document.querySelector('.liens-atelier a[href="#/reglages"]');
    this.lien?.setAttribute("aria-current", "page");
    this.monterCommuns();
    if (!this.invite) {
      try {
        const m = await import("./principal.js");
        if (this.detruit) return;
        this.principal = m.monterReglagesDuPrincipal(this.grilles, { confort: this.parametres.has("confort") });
      } catch (err) {
        this.grilles.coin.innerHTML = `<p class="alerte">Les réglages ne se chargent pas : ${e(err.message)}</p>`;
      }
    }
    // « Avant de jouer » mène au confort de la table (#/reglages/regles?confort) : le panneau s'ouvre, et reste en vue.
    const confort = this.parametres.has("confort") && this.racine.querySelector("#confort");
    if (confort) this.tenir(confort);
    else if (this.section) this.aller(this.section, false);
  }

  detruire() {
    this.detruit = true;
    this.lien?.removeAttribute("aria-current");
    this.principal?.detruire();
  }

  gabarit() {
    return `
      <section class="page-liste page-reglages">
        <header class="titre-page">
          <p class="kicker">L'atelier</p>
          <h1>Réglages</h1>
          <p class="chapo">${this.invite ? "Vos accès et ce que vous réglez vous-même." : "Les paramètres de l'atelier, du coin des joueurs et de la table, et qui y entre."}</p>
          <p class="aide vers-corbeille">Ce qui a été jeté, prêt à revenir : <a href="#/corbeille">la corbeille</a>.</p>
        </header>
        <nav class="sommaire-reglages" aria-label="Sections des réglages">
          ${this.ordre.map((s) => `<a href="#/reglages/${s}" data-vers="${s}">${e(SECTIONS[s][0])}</a>`).join("")}
        </nav>
        ${this.ordre.map((s) => `
        <section class="section-reglages" id="reglages-${s}" data-section="${s}" aria-labelledby="titre-reglages-${s}">
          <h2 class="titre-section-reglages" id="titre-reglages-${s}">${e(SECTIONS[s][0])}</h2>
          <p class="aide intro-reglages">${e(this.invite ? INVITE[s] : SECTIONS[s][1])}</p>
          <div class="table-etat grille-reglages" data-grille="${s}"></div>
        </section>`).join("")}
      </section>`;
  }

  // Ce que les deux MJ ont, chacun pour soi : le mot de passe, les appareils, la musique, la rédaction ; la suite au
  // carnet pour un invité.
  monterCommuns() {
    const { acces, table, redaction } = this.grilles;
    const zone = (grille, classe = "") => {
      const z = document.createElement("div");
      if (classe) z.className = classe;
      grille.append(z);
      return z;
    };
    const motDePasse = zone(acces);
    let appareils = zone(acces);
    import("./mot-de-passe.js").then((m) => m.blocMotDePasse(motDePasse, {
      // Le changement coupe tous les appareils ; celui-ci, reconnu de nouveau, revient seul dans la liste, relue dans une
      // zone neuve (le bloc attache ses écouteurs à sa zone).
      apres: () => import("../mj/appareils.js").then((a) => {
        const neuve = document.createElement("div");
        appareils.replaceWith(neuve);
        appareils = neuve;
        a.blocDesAppareils(neuve);
      }),
    })).catch(() => {});
    import("../mj/appareils.js").then((m) => m.blocDesAppareils(appareils)).catch(() => {});
    if (this.invite) import("../mj/suite.js").then((m) => m.blocSuite(zone(table))).catch(() => {});
    this.blocMusique(zone(table, "bloc bloc-musique-reglages"));
    const couts = zone(redaction);
    Promise.all([api.get("/api/ia/couts"), import("./redaction.js")]).then(([c, m]) => {
      if (couts.isConnected) couts.outerHTML = m.blocCouts(c);
    }).catch(() => {});
  }

  // Les ambiances de combat et des boutiques : le choix passe par la musique de l'en-tête (musique-combat.js et
  // musique-boutique.js écoutent ces deux listes partout dans la page), qui l'enregistre et le dit.
  async blocMusique(bloc) {
    bloc.innerHTML = '<h2>La musique</h2><p class="aide">Lecture de la liste…</p>';
    let d;
    let combat;
    let boutique;
    try {
      [d, combat, boutique] = await Promise.all([api.get("/api/musique"), import("../musique/musique-combat.js"), import("../musique/musique-boutique.js")]);
    } catch {
      bloc.innerHTML = '<h2>La musique</h2><p class="aide">La liste de musique ne se lit pas pour l\'instant.</p>';
      return;
    }
    if (!bloc.isConnected) return;
    const ambiances = d.ambiances || [];
    bloc.innerHTML = `
      <h2>La musique</h2>
      ${ambiances.length ? `${combat.htmlReglageCombat(ambiances, d.combat ?? null)}${boutique.htmlReglageBoutique(ambiances, d.boutique ?? null)}`
        : "<p>Aucune ambiance encore : la liste se remplit dans le panneau Musique de l'en-tête.</p>"}
      <p class="aide">Les ambiances elles-mêmes, et ce qui joue : le panneau Musique, en haut de l'atelier.</p>`;
  }

  // Les liens vers une autre section de la page la font défiler, sans recharger les réglages.
  clic(ev) {
    const a = ev.target.closest('a[href^="#/reglages"]');
    if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
    const [chemin] = a.getAttribute("href").slice(2).split("?");
    const section = chemin.split("/")[1] || "";
    if (section && !this.grilles[section]) return;
    ev.preventDefault();
    history.replaceState(null, "", a.getAttribute("href"));
    this.aller(section, true);
  }

  // Une section en tête de page, et marquée dans le sommaire.
  aller(section, doux) {
    const cible = section ? this.racine.querySelector(`[data-section="${section}"]`) : this.racine.querySelector(".page-reglages");
    if (!cible) return;
    for (const a of this.racine.querySelectorAll(".sommaire-reglages a")) a.setAttribute("aria-current", a.dataset.vers === section ? "true" : "false");
    cible.scrollIntoView({ block: "start", behavior: doux ? "smooth" : "auto" });
    if (!doux && section) this.tenir(cible);
  }

  // À l'ouverture, les blocs au-dessus de la section finissent de se lire et la poussent vers le bas : elle reste en tête
  // un instant, tant que le MJ ne fait pas défiler lui-même.
  tenir(cible) {
    cible.scrollIntoView({ block: "start" });
    let bouge = false;
    const lui = () => { bouge = true; };
    const gestes = ["wheel", "touchstart", "keydown", "pointerdown"];
    for (const g of gestes) addEventListener(g, lui, { once: true, passive: true });
    for (const ms of [250, 700, 1500]) {
      setTimeout(() => {
        if (!bouge && !this.detruit && cible.isConnected) cible.scrollIntoView({ block: "start" });
        if (ms === 1500) for (const g of gestes) removeEventListener(g, lui);
      }, ms);
    }
  }
}
