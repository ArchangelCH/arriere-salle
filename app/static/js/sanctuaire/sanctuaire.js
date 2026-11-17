// L'onglet Sanctuaire : l'auberge détruite que les héros relèvent, et le village qui pousse autour, refuge des
// aventuriers et des demi-élémentaires. À gauche le village dessiné (dessin.js : on y choisit un bâtiment, on le glisse
// à sa place) ; à droite le bâtiment choisi (cagnotte, versements depuis la bourse d'un héros, niveaux et bonus,
// corrections du MJ) ou, sans choix, le sanctuaire entier (nom, bonus gagnés, journal, catalogue des bâtiments).
// Le niveau est construit dès qu'il est payé. Niveau, cagnotte, versements et liste des bâtiments ne passent que par
// leurs routes ; le reste s'enregistre avec la version du sanctuaire (fusion à trois sur 409). Sur la TV : la vue
// « sanctuaire » (/api/table/sanctuaire), sans les notes du MJ ni les bâtiments cachés.
// Les joueurs : « Sanctuaire visible des joueurs » (page Réglages, section Coin des joueurs) le publie dans
// leur carnet, avec les seuls types cochés « Proposé aux joueurs » ; leurs versements et leurs projets arrivent dans la
// boîte Demandes. Quand le MJ en accepte un, l'onglet se relit (message « sac » du canal de l'atelier, marqué sanctuaire).

import { api, copie, differer, echapper as e, enregistrerAvecVersion, toast } from "../api.js";
import { BoutonTv } from "../ecran-tv/bouton-tv.js";
import { demander } from "../commun/dialogue.js";
import { afficherTemoin, htmlTemoin } from "../commun/temoin-enregistrement.js";
import { ecouterTv } from "../ecran-tv/etat-tv.js";
import { ecouterSacs } from "../ecran-tv/canal-table.js";
import { noterAuJournal, retirerDuJournal, seanceDuJournal } from "../seances/journal.js";
import { Reessai } from "../commun/reessai.js";
import { batimentsVus, svgVillage } from "./dessin.js";

// Une vue plein écran (ou une image) sous le sanctuaire : on y revient en le retirant de la TV, sinon à l'accueil.
const SANS_RETOUR = ["planche", "precedemment", "episode", "heros", "fiches", "image", "boutique", "sanctuaire", "document"];
const VUE_AVANT = ["vue", "plan", "carte", "camera", "style", "version", "lieu", "url", "titre"];
const FORMES = [["auberge", "Auberge"], ["maison", "Maison"], ["long", "Long bâtiment"], ["atelier", "Atelier, échoppe"], ["tour", "Tour"],
  ["autel", "Cercle de pierres"], ["champ", "Champs"], ["puits", "Puits, place"], ["enceinte", "Enceinte du village"]];
const EMBLEMES = [["", "Aucune enseigne"], ["lit", "Lit (auberge)"], ["piece", "Pièce (commerce)"], ["enclume", "Enclume (forge)"], ["feuille", "Feuille (soins)"],
  ["losange", "Losange des éléments"], ["fer", "Fer à cheval"], ["coffre", "Coffre"], ["parchemin", "Parchemin"], ["epi", "Épi"]];
const ROMAINS = ["0", "I", "II", "III", "IV", "V"];
const NIVEAUX_MAX = 5;
const prenom = (nom) => String(nom || "").trim().split(/[\s,]+/)[0] || "";
const orDe = (fiche) => (typeof fiche?.or === "number" && Number.isFinite(fiche.or) ? Math.round(fiche.or) : 0);
const heure = (t) => (t ? String(t).slice(11, 16).replace(":", " h ") : "");
const pieces = (n) => `${n} po`;
const libelleVerser = (n) => (n > 0 ? `Verser ${pieces(n)}` : "Verser");
const de = (nom) => (/^[aeiouyàâéèêëîïôûü]/i.test(nom) ? `d'${nom}` : `de ${nom}`);

export class Sanctuaire {
  constructor(racine, { id } = {}) {
    this.racine = racine;
    this.selection = id || null;
    this.s = null;
    this.bases = {};
    this.heros = [];
    this.boutiques = [];
    this.seances = [];
    this.table = null;
    this.ouverts = new Set(); // les types du catalogue dépliés
    this.sauver = differer(() => this.enregistrer(), 700);
    // Serveur injoignable : ce qui n'est pas parti repart seul (3 s, 10 s, puis toutes les 30 s), comme sur les fiches.
    this.reessai = new Reessai(() => this.enregistrer(), () => {
      if (this.etatAffiche === "erreur") this.etat("erreur");
    });
    this.chaine = Promise.resolve();
    this.fileTable = Promise.resolve();
    this.envois = 0;
    this.modifie = false;
    this.detruit = false;
    this.glisse = null;
  }

  async demarrer() {
    const [s, aventuriers, boutiques, seances, table] = await Promise.all([
      api.get("/api/sanctuaire"), api.get("/api/aventuriers").catch(() => []), api.get("/api/boutiques").catch(() => []),
      api.get("/api/seances").catch(() => []), api.get("/api/table").catch(() => null),
    ]);
    if (this.detruit) return;
    this.recu(s);
    this.heros = aventuriers.filter((a) => a.tablee !== false).sort((a, b) => (a.cree || "").localeCompare(b.cree || ""));
    this.boutiques = boutiques.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));
    this.seances = seances;
    this.table = table;
    this.racine.innerHTML = `<section class="sanctuaire-page"></section>`;
    this.dom = this.racine.querySelector(".sanctuaire-page");
    this.dom.innerHTML = this.gabarit();
    this.dessin = this.dom.querySelector(".sc-dessin");
    this.panneau = this.dom.querySelector(".sc-panneau");
    this.dom.addEventListener("click", (ev) => this.clic(ev));
    this.dom.addEventListener("input", (ev) => this.saisie(ev));
    this.dom.addEventListener("change", (ev) => this.choix(ev));
    this.dom.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && ev.target.matches("[data-sc-montant]")) {
        ev.preventDefault();
        if (!ev.repeat) this.verser();
      }
    });
    this.dessin.addEventListener("pointerdown", (ev) => this.basPointeur(ev));
    this.dessin.addEventListener("pointermove", (ev) => this.bouge(ev));
    this.dessin.addEventListener("pointerup", (ev) => this.haut(ev));
    this.dessin.addEventListener("pointercancel", () => this.annulerGlisse());
    this.auRetour = () => this.relireHeros();
    window.addEventListener("focus", this.auRetour);
    // Un versement ou un projet de joueur accepté dans la boîte : le sanctuaire et les bourses se relisent.
    this.finSacs = ecouterSacs((signal) => {
      if (signal?.sanctuaire) this.relireSanctuaire();
    });
    // Un seul bouton pour la TV, qui bascule ; il lit l'état réel de la table, comme le témoin de l'en-tête.
    this.boutonTv = new BoutonTv({
      estIci: (t) => t.vue === "sanctuaire",
      montrer: () => this.montrer(null),
      retirer: () => this.retirerTv(),
      principal: false,
      titre: "Le village et ses chantiers sur la TV, sans les notes du MJ ni les bâtiments cachés",
      titreIci: "La TV montre le sanctuaire : le retirer, elle revient à ce qu'elle montrait avant",
    });
    this.dom.querySelector(".sc-barre .actions").append(this.boutonTv.el);
    this.afficher();
    this.finTv = ecouterTv((t) => {
      const avant = this.table;
      this.table = t;
      if (this.detruit) return;
      this.afficherTable();
      // Le bouton « de près » du bâtiment ouvert suit, sans réécrire un panneau en cours de frappe.
      if (this.selection && (avant?.vue !== t.vue || avant?.batiment !== t.batiment)) this.afficherPanneau();
    });
  }

  // L'or des héros a pu changer ailleurs (une vente, la compagnie) : la liste et les montants proposés suivent.
  async relireHeros() {
    const aventuriers = await api.get("/api/aventuriers").catch(() => null);
    if (!aventuriers || this.detruit) return;
    this.heros = aventuriers.filter((a) => a.tablee !== false).sort((a, b) => (a.cree || "").localeCompare(b.cree || ""));
    this.afficherPanneau();
  }

  // Changé par la boîte des demandes : rien en cours ici, la version du serveur s'affiche (sinon la fusion à trois
  // de l'enregistrement suivant la réunira).
  async relireSanctuaire() {
    await this.relireHeros();
    if (this.detruit || this.aEnregistrer()) return;
    const s = await api.get("/api/sanctuaire").catch(() => null);
    if (!s || this.detruit || this.aEnregistrer()) return;
    this.recu(s);
    this.afficher();
  }

  detruire() {
    this.detruit = true;
    window.removeEventListener("focus", this.auRetour);
    this.finSacs?.();
    this.boutonTv?.detruire();
    this.finTv?.();
    return this.vider();
  }

  vider() {
    if (this.sauver.enAttente()) return this.sauver.maintenant();
    // Un envoi resté sans réponse repart tout de suite (sa série de nouveaux essais continue sinon).
    if (this.modifie) return this.enregistrer();
    return this.chaine;
  }

  aEnregistrer() {
    return this.modifie || this.envois > 0 || this.sauver.enAttente();
  }

  recu(s) {
    this.s = s;
    this.bases.s = copie(s);
  }

  // ---------------------------------------------------------------- affichage

  gabarit() {
    return `
      <div class="sc-carte">
        <header class="sc-barre">
          <div class="titre">
            <p class="kicker">Le refuge des aventuriers et des demi-élémentaires</p>
            <div class="titre-avec-temoin"><h1 class="sc-nom"></h1>${htmlTemoin()}</div>
          </div>
          <div class="actions">
            <button class="principal" data-sc="chantier">Ouvrir un chantier</button>
          </div>
        </header>
        <div class="sc-dessin" aria-label="Le village, glisser un bâtiment pour le déplacer"></div>
        <p class="aide sc-aide">Touchez un bâtiment pour le choisir, glissez-le pour le déplacer. Le village vide (hors des bâtiments) ramène au sanctuaire entier.</p>
      </div>
      <aside class="sc-panneau"></aside>`;
  }

  vus() {
    return batimentsVus(this.s);
  }

  batiment(id = this.selection) {
    return (this.s.batiments || []).find((b) => b.id === id) || null;
  }

  typeDe(b) {
    return (this.s.catalogue || []).find((t) => t.type === b?.type) || null;
  }

  afficher() {
    if (this.detruit || !this.dom) return;
    if (this.selection && !this.batiment()) this.selection = null;
    this.dom.querySelector(".sc-nom").textContent = this.s.nom || "Le sanctuaire";
    if (!this.modifie && !this.envois && !this.sauver.enAttente()) this.etat("ok");
    this.afficherDessin();
    this.afficherPanneau();
    this.afficherTable();
  }

  afficherDessin() {
    this.dessin.innerHTML = svgVillage(this.vus(), { selection: this.selection });
  }

  afficherPanneau() {
    const actif = document.activeElement;
    // Un texte en cours de frappe dans le panneau n'est pas effacé par une relecture (le montant d'un versement, si).
    if (actif && this.panneau.contains(actif) && actif.matches("[data-sc-champ], [data-b-champ], [data-t-champ], [data-n-champ]") && actif.type !== "checkbox"
      && actif.tagName !== "SELECT") return;
    const b = this.batiment();
    this.panneau.innerHTML = b ? this.htmlBatiment(b) : this.htmlSanctuaire();
  }

  afficherTable() {
    this.boutonTv?.maj(this.table);
  }

  // Le sanctuaire entier : son nom, ce qu'il offre, son journal, le catalogue.
  htmlSanctuaire() {
    const s = this.s;
    const vus = this.vus().filter((b) => !b.cache);
    const habitants = this.habitants();
    const bonus = this.bonus();
    return `
      <h2>${e(s.nom || "Le sanctuaire")}</h2>
      <p class="sc-chiffres"><b>${vus.filter((b) => b.niveau).length}</b> bâtiment${vus.filter((b) => b.niveau).length > 1 ? "s" : ""} debout · <b>${habitants}</b> habitant${habitants > 1 ? "s" : ""} · <b>${bonus.length}</b> bonus</p>
      <div class="sc-joueurs">
        <p class="aide">${s.joueurs ? `<b>Visible des joueurs</b> : dans leur carnet, le village, chaque bâtiment non caché avec sa cagnotte et son prochain niveau, et ${e(this.proposes())}.`
          : "<b>Caché aux joueurs</b> : leur carnet n'en dit rien."} <a class="vers-reglages" href="#/reglages/coin">Réglages</a></p>
      </div>
      <label class="champ">Nom du sanctuaire<input type="text" data-sc-champ="nom" maxlength="120" value="${e(s.nom || "")}"></label>
      <label class="champ">Ce qu'en lisent les joueurs<textarea data-sc-champ="accroche" maxlength="600" rows="2">${e(s.accroche || "")}</textarea></label>
      <h3>Ce que le sanctuaire offre</h3>
      ${bonus.length ? `<ul class="sc-bonus">${bonus.map((x) => `<li><b>${e(x.batiment)}</b> <small>niveau ${ROMAINS[x.niveau]}</small><span>${e(x.bonus)}</span></li>`).join("")}</ul>`
        : '<p class="vide">Rien encore : l\'auberge est en ruines. Chaque niveau bâti ajoute son bonus ici et sur la TV.</p>'}
      <h3>Les chantiers</h3>
      <ul class="sc-chantiers">${this.vus().map((b) => `<li><button class="lien" data-sc-choisir="${e(b.id)}">${e(b.nom)}</button> <span>${b.niveau ? `niveau ${ROMAINS[b.niveau]}` : b.ruine ? "en ruines" : "à bâtir"}${b.prochain ? ` · ${pieces(b.cagnotte)} sur ${pieces(b.prochain.cout)}` : " · au plus haut"}${b.cache ? " · caché" : ""}</span></li>`).join("")}</ul>
      <label class="champ">Notes du MJ<textarea data-sc-champ="notes_mj" rows="3" placeholder="Qui a détruit l'auberge, ce que les Églises savent du refuge…">${e(s.notes_mj || "")}</textarea></label>
      <h3>Le journal du sanctuaire</h3>
      ${(s.journal || []).length ? `<ol class="sc-journal">${[...s.journal].reverse().slice(0, 20).map((l) => `<li><time>${e(String(l.t || "").slice(8, 10))}.${e(String(l.t || "").slice(5, 7))} ${e(heure(l.t))}</time> ${e(l.texte)}</li>`).join("")}</ol>` : '<p class="vide">Rien encore.</p>'}
      <h3>Le catalogue des bâtiments</h3>
      <p class="aide">Propositions maison, à changer à votre guise : coûts en pièces d'or tenus au barème du kit, bonus que vous appliquez à la main. Un niveau est bâti dès qu'il est payé.</p>
      ${(s.catalogue || []).map((t, i) => this.htmlType(t, i)).join("")}
      <div class="actions"><button data-sc="nouveau-type">Nouveau type de bâtiment</button></div>`;
  }

  // « les projets cochés : la forge, l'autel » ; « aucun projet » sans type coché.
  proposes() {
    const noms = (this.s.catalogue || []).filter((t) => t.joueurs).map((t) => t.nom);
    return noms.length ? `les projets cochés au catalogue (${noms.join(", ")})` : "aucun projet (cochez « Proposé aux joueurs » sur un type du catalogue)";
  }

  htmlType(t, i) {
    const utilise = (this.s.batiments || []).some((b) => b.type === t.type);
    return `
      <details class="sc-type" data-t="${i}" ${this.ouverts.has(t.type) ? "open" : ""}>
        <summary><span class="pastille" style="background:${e(t.toit)}"></span><b>${e(t.nom)}</b> <small>${t.niveaux.length} niveau${t.niveaux.length > 1 ? "x" : ""}${t.unique ? " · unique" : ""}${t.joueurs ? " · proposé aux joueurs" : ""}</small></summary>
        <label class="champ">Nom<input type="text" data-t-champ="nom" maxlength="120" value="${e(t.nom)}"></label>
        <label class="champ">Description<textarea data-t-champ="description" rows="2" maxlength="600">${e(t.description || "")}</textarea></label>
        <div class="sc-deux">
          <label class="champ">Dessin<select data-t-champ="forme">${FORMES.map(([k, nom]) => `<option value="${k}" ${t.forme === k ? "selected" : ""}>${nom}</option>`).join("")}</select></label>
          <label class="champ">Enseigne<select data-t-champ="embleme">${EMBLEMES.map(([k, nom]) => `<option value="${k}" ${t.embleme === k ? "selected" : ""}>${nom}</option>`).join("")}</select></label>
        </div>
        <div class="sc-deux">
          <label class="champ">Couleur du toit<input type="color" data-t-champ="toit" value="${e(t.toit)}"></label>
          <label class="case"><input type="checkbox" data-t-champ="unique" ${t.unique ? "checked" : ""}> Un seul au sanctuaire</label>
        </div>
        <label class="case"><input type="checkbox" data-t-champ="joueurs" ${t.joueurs ? "checked" : ""}> Proposé aux joueurs : un projet qu'ils peuvent vous demander d'ouvrir, depuis leur carnet</label>
        <ol class="sc-niveaux-edition">${t.niveaux.map((n, k) => `
          <li data-n="${k}">
            <div class="sc-niveau-tete"><b>${ROMAINS[k + 1]}</b><input type="text" data-n-champ="nom" maxlength="120" value="${e(n.nom)}" aria-label="Nom du niveau ${k + 1}">
              <label>Coût<input type="number" min="0" step="5" data-n-champ="cout" value="${n.cout}"></label>
              <label>Habitants<input type="number" min="0" step="1" data-n-champ="habitants" value="${n.habitants}"></label>
              ${t.niveaux.length > 1 ? `<button class="retirer" data-sc="retirer-niveau" title="Retirer ce niveau" aria-label="Retirer le niveau ${k + 1}">×</button>` : ""}</div>
            <textarea data-n-champ="bonus" rows="2" maxlength="600" placeholder="Le bonus gagné à ce niveau" aria-label="Bonus du niveau ${k + 1}">${e(n.bonus || "")}</textarea>
          </li>`).join("")}
        </ol>
        <div class="actions">
          ${t.niveaux.length < NIVEAUX_MAX ? '<button data-sc="ajouter-niveau">Ajouter un niveau</button>' : ""}
          <button class="danger" data-sc="retirer-type" ${utilise ? "disabled title=\"Un bâtiment de ce type est au sanctuaire\"" : ""}>Retirer du catalogue</button>
        </div>
      </details>`;
  }

  // Le bâtiment choisi : où il en est, la cagnotte et les versements, ses niveaux, les gestes du MJ.
  htmlBatiment(b) {
    const t = this.typeDe(b);
    if (!t) return '<p class="vide">Type inconnu.</p>';
    const k = +b.niveau || 0;
    const actuel = k ? t.niveaux[k - 1] : null;
    const n = k < t.niveaux.length ? t.niveaux[k] : null;
    const cagnotte = +b.cagnotte || 0;
    const reste = n ? Math.max(0, n.cout - cagnotte) : 0;
    const pourCeNiveau = (b.versements || []).filter((v) => v.pour === k + 1);
    const dernier = (b.versements || [])[(b.versements || []).length - 1];
    // Rien encore pour le niveau suivant : les versements du dernier niveau bâti restent là, le dernier se rend.
    const pourLeBati = !pourCeNiveau.length && k && !cagnotte ? (b.versements || []).filter((v) => v.pour === k) : [];
    const propose = this.montantPropose(b);
    const versements = (liste, titre) => (liste.length ? `${titre ? `<p class="sc-bati-par">${e(titre)}</p>` : ""}<ul class="sc-versements">${liste.map((v) => `<li><span>${e(prenom(v.nom))}</span><b>${pieces(v.or)}</b><time>${e(heure(v.t))}</time>${v === dernier ? `<button class="lien" data-sc-rendre="${e(v.id)}" title="${v.pour === k ? "L'or revient dans sa bourse, le bâtiment redescend d'un niveau" : "L'or revient dans sa bourse"}">Rendre</button>` : ""}</li>`).join("")}</ul>` : "");
    const boutique = this.boutiques.find((x) => x.id === b.boutique);
    const tvIci = this.table?.vue === "sanctuaire" && this.table?.batiment === b.id;
    return `
      <p class="sc-retour"><button class="lien" data-sc="tout">‹ Le sanctuaire entier</button></p>
      <h2>${e(b.nom || t.nom)}</h2>
      <p class="sc-etat">${k ? `Niveau ${ROMAINS[k]} sur ${ROMAINS[t.niveaux.length]} : <b>${e(actuel.nom)}</b>` : b.ruine ? "En ruines" : "À bâtir"}${b.cache ? " · <i>caché aux joueurs</i>" : ""}</p>
      ${t.description ? `<p class="aide">${e(t.description)}</p>` : ""}
      ${n ? `
      <section class="sc-cagnotte">
        <h3>Niveau ${ROMAINS[k + 1]} : ${e(n.nom)}</h3>
        <div class="sc-jauge" role="progressbar" aria-valuemin="0" aria-valuemax="${n.cout}" aria-valuenow="${cagnotte}"><i style="width:${n.cout ? Math.round((100 * cagnotte) / n.cout) : 100}%"></i></div>
        <p class="sc-somme"><b>${pieces(cagnotte)}</b> sur ${pieces(n.cout)}${reste ? ` · il manque ${pieces(reste)}` : ""}</p>
        ${n.bonus ? `<p class="sc-bonus-suivant">${e(n.bonus)}</p>` : ""}
        ${this.heros.length ? `
        <div class="sc-verser">
          <select data-sc-heros aria-label="Le héros qui verse">${this.heros.map((h) => `<option value="${e(h.id)}" ${h.id === this.herosChoisi ? "selected" : ""}>${e(prenom(h.nom))} (${pieces(orDe(h))})</option>`).join("")}</select>
          <input type="number" min="1" step="1" data-sc-montant value="${propose || ""}" aria-label="Montant en pièces d'or" ${reste ? "" : "disabled"}>
          <button class="principal" data-sc="verser" ${this.enVersement ? "disabled" : ""} title="${reste ? "L'or quitte la bourse du héros" : "Déjà payé : le niveau se bâtit sans or"}">${reste ? libelleVerser(propose) : "Bâtir"}</button>
        </div>
        <p class="aide">L'or quitte la bourse du héros. Jamais plus que ce qui manque : le niveau est bâti dès qu'il est payé.</p>` : '<p class="vide">Aucun aventurier dans la tablée.</p>'}
        ${versements(pourCeNiveau, "")}${versements(pourLeBati, `Niveau ${ROMAINS[k]} bâti grâce à :`)}
      </section>` : `<p class="sc-somme">Au plus haut niveau.</p>${versements(pourLeBati, `Niveau ${ROMAINS[k]} bâti grâce à :`)}`}
      <h3>Les niveaux</h3>
      <ol class="sc-niveaux">${t.niveaux.map((x, i) => `<li class="${i < k ? "bati" : i === k ? "suivant" : ""}"><b>${ROMAINS[i + 1]}</b><span><b>${e(x.nom)}</b> · ${pieces(x.cout)}${x.habitants ? ` · +${x.habitants} habitant${x.habitants > 1 ? "s" : ""}` : ""}${i < k ? " · <i>bâti</i>" : ""}<small>${e(x.bonus || "")}</small></span></li>`).join("")}</ol>
      <h3>Pour le MJ</h3>
      <div class="actions"><button data-sc="montrer-batiment" aria-pressed="${tvIci}" ${b.cache ? 'disabled title="Caché aux joueurs : décochez « Caché » pour le montrer"' : ""}>${tvIci ? "Montré de près à la TV" : "Montrer de près à la TV"}</button></div>
      <label class="champ">Nom<input type="text" data-b-champ="nom" maxlength="120" value="${e(b.nom || "")}"></label>
      <label class="case"><input type="checkbox" data-b-champ="cache" ${b.cache ? "checked" : ""}> Caché aux joueurs (un projet que la table ne connaît pas encore)</label>
      ${!k ? `<label class="case"><input type="checkbox" data-sc-ruine ${b.ruine ? "checked" : ""}> En ruines</label>` : ""}
      <label class="champ">Niveau, sans or (correction ou récompense)<select data-sc-niveau>${Array.from({ length: t.niveaux.length + 1 }, (_, i) => `<option value="${i}" ${i === k ? "selected" : ""}>${i ? `${ROMAINS[i]} · ${e(t.niveaux[i - 1].nom)}` : "0 · pas encore bâti"}</option>`).join("")}</select></label>
      ${t.embleme === "piece" || b.type === "boutique" ? `
      <label class="champ">Sa boutique<select data-b-champ="boutique"><option value="">Aucune</option>${this.boutiques.map((x) => `<option value="${e(x.id)}" ${x.id === b.boutique ? "selected" : ""}>${e(x.nom || "Sans nom")}</option>`).join("")}</select></label>
      ${boutique ? `<p class="aide"><a href="#/boutiques/${e(boutique.id)}">Ouvrir « ${e(boutique.nom)} »</a></p>` : ""}` : ""}
      <label class="champ">Notes du MJ<textarea data-b-champ="notes_mj" rows="3">${e(b.notes_mj || "")}</textarea></label>
      <div class="actions"><button class="danger" data-sc="raser">Retirer du village</button></div>`;
  }

  habitants() {
    let total = 0;
    for (const b of this.s.batiments || []) {
      const t = this.typeDe(b);
      if (t && !b.cache) total += t.niveaux.slice(0, +b.niveau || 0).reduce((x, n) => x + (+n.habitants || 0), 0);
    }
    return total;
  }

  bonus() {
    const liste = [];
    for (const b of this.s.batiments || []) {
      const t = this.typeDe(b);
      if (!t || b.cache) continue;
      t.niveaux.slice(0, +b.niveau || 0).forEach((n, i) => n.bonus && liste.push({ batiment: b.nom || t.nom, niveau: i + 1, bonus: n.bonus }));
    }
    return liste;
  }

  // ---------------------------------------------------------------- le dessin : choisir, glisser

  versVillage(ev) {
    const svg = this.dessin.querySelector("svg");
    const m = svg?.getScreenCTM();
    if (!m) return null;
    const p = svg.createSVGPoint();
    p.x = ev.clientX;
    p.y = ev.clientY;
    const q = p.matrixTransform(m.inverse());
    return { x: q.x, y: q.y };
  }

  basPointeur(ev) {
    if (ev.button !== 0) return;
    const g = ev.target.closest("[data-batiment]");
    const p = this.versVillage(ev);
    if (!g || !p) {
      this.glisse = { vide: true, x: ev.clientX, y: ev.clientY };
      return;
    }
    this.glisse = { id: g.dataset.batiment, depart: p, x: ev.clientX, y: ev.clientY, bouge: false };
    this.dessin.setPointerCapture?.(ev.pointerId);
  }

  bouge(ev) {
    const g = this.glisse;
    if (!g || g.vide) return;
    if (!g.bouge && Math.hypot(ev.clientX - g.x, ev.clientY - g.y) < 6) return;
    const b = this.batiment(g.id);
    if (!b || this.typeDe(b)?.forme === "enceinte") return;
    g.bouge = true;
    const p = this.versVillage(ev);
    if (!p) return;
    g.dx = p.x - g.depart.x;
    g.dy = p.y - g.depart.y;
    for (const el of this.dessin.querySelectorAll(`[data-batiment="${CSS.escape(g.id)}"]`)) el.setAttribute("transform", `translate(${g.dx.toFixed(1)},${g.dy.toFixed(1)})`);
  }

  haut(ev) {
    const g = this.glisse;
    this.glisse = null;
    if (!g) return;
    if (g.vide) {
      if (Math.hypot(ev.clientX - g.x, ev.clientY - g.y) < 6 && this.selection) this.choisir(null);
      return;
    }
    const b = this.batiment(g.id);
    if (!b) return;
    if (!g.bouge) return this.choisir(g.id);
    b.x = Math.round(Math.max(40, Math.min(1560, b.x + g.dx)));
    b.y = Math.round(Math.max(60, Math.min(970, b.y + g.dy)));
    this.selection = g.id;
    this.changer();
    this.afficher();
  }

  annulerGlisse() {
    this.glisse = null;
    this.afficherDessin();
  }

  choisir(id) {
    this.selection = id;
    history.replaceState(null, "", id ? `#/sanctuaire/${encodeURIComponent(id)}` : "#/sanctuaire");
    this.afficherDessin();
    const b = this.batiment();
    this.panneau.innerHTML = b ? this.htmlBatiment(b) : this.htmlSanctuaire();
    this.panneau.scrollTop = 0;
  }

  // ---------------------------------------------------------------- saisies

  champType(el) {
    const d = el.closest("[data-t]");
    return d ? this.s.catalogue[+d.dataset.t] : null;
  }

  saisie(ev) {
    const el = ev.target;
    const d = el.dataset;
    if (d.scMontant !== undefined) return this.majBoutonVerser();
    if (d.scChamp) {
      this.s[d.scChamp] = el.value;
      if (d.scChamp === "nom") this.dom.querySelector(".sc-nom").textContent = el.value || "Le sanctuaire";
      return this.changer();
    }
    if (d.bChamp && el.type !== "checkbox" && el.tagName !== "SELECT") {
      const b = this.batiment();
      if (!b) return;
      b[d.bChamp] = el.value;
      this.changer();
      if (d.bChamp === "nom") this.afficherDessin();
      return;
    }
    const t = this.champType(el);
    if (!t) return;
    if (d.tChamp && el.type !== "checkbox" && el.tagName !== "SELECT") {
      t[d.tChamp] = el.value;
      this.changer();
      if (d.tChamp === "toit") this.afficherDessin();
      return;
    }
    if (d.nChamp) {
      const n = t.niveaux[+el.closest("[data-n]").dataset.n];
      if (!n) return;
      n[d.nChamp] = el.type === "number" ? Math.max(0, Math.round(+el.value || 0)) : el.value;
      this.changer();
    }
  }

  async choix(ev) {
    const el = ev.target;
    const d = el.dataset;
    if (d.scHeros !== undefined) {
      this.herosChoisi = el.value;
      const champ = this.panneau.querySelector("[data-sc-montant]");
      const propose = this.montantPropose(this.batiment());
      if (champ && !champ.disabled) champ.value = propose || "";
      this.majBoutonVerser();
      return;
    }
    if (d.scNiveau !== undefined) {
      const b = this.batiment();
      const cagnotte = +b?.cagnotte || 0;
      const niveau = +el.value;
      if (cagnotte && !(await demander({ titre: "Changer le niveau sans or", texte: `Les ${cagnotte} po de la cagnotte en cours repartent à zéro et ne sont pas rendus.`, oui: "Changer le niveau", non: "Garder la cagnotte", danger: true }))) {
        el.value = String(+b.niveau || 0);
        return;
      }
      if (this.batiment() !== b) return;
      return this.corriger({ niveau });
    }
    if (d.scRuine !== undefined) return this.corriger({ ruine: el.checked });
    if (d.bChamp && (el.type === "checkbox" || el.tagName === "SELECT")) {
      const b = this.batiment();
      if (!b) return;
      b[d.bChamp] = el.type === "checkbox" ? el.checked : el.value;
      this.changer();
      this.afficher();
      return;
    }
    const t = this.champType(el);
    if (t && d.tChamp && (el.type === "checkbox" || el.tagName === "SELECT")) {
      t[d.tChamp] = el.type === "checkbox" ? el.checked : el.value;
      this.changer();
      this.afficherDessin();
      // Le résumé du type et la phrase sur ce que lisent les joueurs suivent la case.
      if (d.tChamp === "joueurs") {
        this.ouverts.add(t.type);
        this.afficherPanneau();
      }
    }
  }

  async clic(ev) {
    const sommaire = ev.target.closest(".sc-type > summary");
    if (sommaire) {
      const t = this.champType(sommaire);
      // Le dépliage se lit après le geste du navigateur.
      setTimeout(() => {
        if (!t) return;
        if (sommaire.parentElement.open) this.ouverts.add(t.type);
        else this.ouverts.delete(t.type);
      });
      return;
    }
    const b = ev.target.closest("button");
    if (!b || this.detruit) return;
    if (b.dataset.scChoisir) return this.choisir(b.dataset.scChoisir);
    if (b.dataset.scRendre) return this.rendre(b.dataset.scRendre);
    const a = b.dataset.sc;
    try {
      if (a === "tout") return this.choisir(null);
      if (a === "chantier") return this.ouvrirChantier();
      if (a === "verser") return await this.verser();
      if (a === "montrer-batiment") return await this.montrer(this.selection);
      if (a === "raser") return await this.raser();
      if (a === "nouveau-type") return this.nouveauType();
      const t = this.champType(b);
      if (a === "ajouter-niveau" && t && t.niveaux.length < NIVEAUX_MAX) {
        const dernier = t.niveaux[t.niveaux.length - 1];
        t.niveaux.push({ nom: `Niveau ${t.niveaux.length + 1}`, cout: Math.round(((dernier?.cout || 100) * 2.5) / 10) * 10, habitants: 0, bonus: "" });
        this.ouverts.add(t.type);
        this.changer();
        return this.afficherPanneau();
      }
      if (a === "retirer-niveau" && t && t.niveaux.length > 1) {
        const k = +b.closest("[data-n]").dataset.n;
        const bati = (this.s.batiments || []).filter((x) => x.type === t.type && (+x.niveau || 0) > k);
        if (bati.length) return toast(`« ${bati[0].nom} » a déjà bâti ce niveau : baissez d'abord son niveau (sans or) avant de le retirer du catalogue.`, "erreur");
        t.niveaux.splice(k, 1);
        this.changer();
        return this.afficherPanneau();
      }
      if (a === "retirer-type" && t) {
        if (!(await demander({ titre: `Retirer « ${t.nom} » du catalogue`, texte: "Ses niveaux, ses coûts et ses bonus quittent le catalogue des bâtiments.", oui: "Retirer du catalogue", danger: true }))) return;
        this.s.catalogue = this.s.catalogue.filter((x) => x !== t);
        this.changer();
        return this.afficherPanneau();
      }
    } catch (err) {
      toast(`Impossible : ${err.message}`, "erreur");
    }
  }

  nouveauType() {
    const pris = new Set((this.s.catalogue || []).map((t) => t.type));
    let id = "batiment";
    for (let k = 2; pris.has(id); k++) id = `batiment-${k}`;
    this.s.catalogue.push({ type: id, nom: "Nouveau bâtiment", forme: "maison", unique: false, toit: "#55463b", embleme: "", description: "",
      niveaux: [{ nom: "Niveau 1", cout: 100, habitants: 0, bonus: "" }] });
    this.ouverts.add(id);
    this.changer();
    this.afficherPanneau();
  }

  // ---------------------------------------------------------------- enregistrement

  changer() {
    this.modifie = true;
    this.etat("modifie");
    this.sauver();
  }

  // Son nom, son accroche, ses notes et le catalogue s'enregistrent à la frappe : l'état se lit à droite du titre.
  etat(quoi) {
    this.etatAffiche = quoi;
    if (this.detruit) return;
    afficherTemoin(this.dom?.querySelector(".sc-barre .temoin-enregistrement"), quoi, { reessai: this.reessai, modifie: this.s?.modifie });
  }

  enregistrer() {
    if (!this.modifie) return this.chaine;
    this.modifie = false;
    this.envois++;
    this.chaine = this.chaine.then(async () => {
      try {
        const fusion = await enregistrerAvecVersion("/api/sanctuaire", this.s, this.bases, "s", { listes: { batiments: "id", catalogue: "type" } });
        // Le serveur garde niveau, cagnotte et bâtiments : on reprend sa version pour ces champs.
        const srv = this.bases.s;
        this.s.batiments = (srv.batiments || []).map((b) => ({ ...b, ...((this.s.batiments || []).find((x) => x.id === b.id) || {}), niveau: b.niveau, cagnotte: b.cagnotte, ruine: b.ruine, versements: b.versements }));
        this.s.journal = srv.journal;
        if (fusion) {
          toast("Le sanctuaire a changé aussi sur un autre écran : les deux sont réunis.");
          this.afficher();
        }
        this.reessai.reussite();
        if (!this.modifie && !this.sauver.enAttente()) this.etat("ok");
      } catch (err) {
        this.modifie = true;
        this.reessai.echec(err);
        this.etat("erreur");
        this.reessai.signaler(err, "Sanctuaire non enregistré");
      } finally {
        this.envois--;
      }
    });
    return this.chaine;
  }

  // Une route qui change le sanctuaire sur le serveur (verser, corriger, ouvrir, retirer) : ce qui attend part d'abord,
  // puis on reprend sa réponse.
  async apresRoute(appel) {
    await this.vider();
    const r = await appel();
    if (this.detruit) return r;
    this.recu(r.sanctuaire);
    this.afficher();
    return r;
  }

  async ouvrirChantier() {
    const presents = new Set((this.s.batiments || []).map((b) => b.type));
    const d = document.createElement("dialog");
    d.className = "sc-dialogue";
    d.innerHTML = `
      <h2>Ouvrir un chantier</h2>
      <p class="aide">Le bâtiment se pose sur une place libre du village, au niveau 0 : glissez-le où vous voulez. Les héros le bâtissent en versant dans sa cagnotte.</p>
      <label class="case"><input type="checkbox" data-cache> Caché aux joueurs pour l'instant (cochez avant de choisir)</label>
      <ul class="sc-catalogue">${(this.s.catalogue || []).map((t) => {
        const pris = t.unique && presents.has(t.type);
        return `<li><button data-type="${e(t.type)}" ${pris ? "disabled" : ""}><span class="pastille" style="background:${e(t.toit)}"></span><span><b>${e(t.nom)}</b>${pris ? " <i>(déjà là)</i>" : ""}<small>${e(t.description || "")}</small><small>Niveau I : ${e(t.niveaux[0]?.nom || "")}, ${pieces(t.niveaux[0]?.cout || 0)}</small></span></button></li>`;
      }).join("")}</ul>
      <div class="actions"><button data-fermer>Annuler</button></div>`;
    document.body.append(d);
    d.addEventListener("close", () => d.remove());
    d.addEventListener("click", async (ev) => {
      if (ev.target.closest("[data-fermer]")) return d.close();
      const b = ev.target.closest("[data-type]");
      if (!b) return;
      const cache = d.querySelector("[data-cache]").checked;
      d.close();
      try {
        const r = await this.apresRoute(() => api.post("/api/sanctuaire/batiments", { type: b.dataset.type, cache }));
        this.choisir(r.batiment);
        toast("Chantier ouvert.");
      } catch (err) {
        toast(err.message, "erreur");
      }
    });
    d.showModal();
  }

  async verser() {
    const b = this.batiment();
    const t = this.typeDe(b);
    const n = t?.niveaux[+b.niveau || 0];
    const choix = this.panneau.querySelector("[data-sc-heros]");
    const champ = this.panneau.querySelector("[data-sc-montant]");
    if (!b || !n || !choix) return;
    // Un seul versement à la fois : un double-clic ne verse pas deux fois.
    if (this.enVersement) return;
    const h = this.heros.find((x) => x.id === choix.value);
    const reste = Math.max(0, n.cout - (+b.cagnotte || 0));
    // Déjà payé (coût baissé, niveau offert) : on le bâtit sans prendre d'or. Sinon, le montant écrit dans le champ.
    const montant = reste ? Math.round(+champ.value || 0) : 1;
    if (!h || montant <= 0) return toast("Un montant en pièces d'or est attendu.", "erreur");
    if (Math.min(montant, reste) > orDe(h)) return toast(`${prenom(h.nom)} n'a que ${pieces(orDe(h))}.`, "erreur");
    this.herosChoisi = h.id;
    this.enVersement = true;
    for (const bouton of this.panneau.querySelectorAll('[data-sc="verser"]')) bouton.disabled = true;
    let r;
    try {
      r = await this.apresRoute(() => api.post("/api/sanctuaire/versements", { batiment: b.id, aventurier: h.id, or: montant }));
      champ.value = "";
    } catch (err) {
      return toast(err.message, "erreur");
    } finally {
      this.enVersement = false;
      if (!this.detruit) this.afficherPanneau();
    }
    if (typeof r.or === "number") h.or = r.or;
    const nom = b.nom || t.nom;
    const lignes = [`${prenom(h.nom)} verse ${r.pris} po pour ${nom}.`];
    if (r.construit) lignes.push(`${nom} passe au niveau ${r.construit.rang} : ${r.construit.nom}.`);
    if (!r.pris) lignes.shift();
    this.afficher();
    const seance = seanceDuJournal(this.seances);
    // Les lignes du journal, gardées pour qu'« Annuler » les efface aussi.
    const notees = seance ? Promise.all(lignes.map((l) => noterAuJournal(seance.id, l)
      .then((x) => [...(x.journal || [])].reverse().find((j) => j.texte === l)).catch(() => null))) : Promise.resolve([]);
    const message = [r.construit ? `${nom} : niveau ${ROMAINS[r.construit.rang]}, ${r.construit.nom} !` : `${prenom(h.nom)} verse ${r.pris} po.`,
      reste && r.pris < montant ? `Seuls ${r.pris} po étaient nécessaires : le reste reste dans sa bourse.` : ""].filter(Boolean).join(" ");
    toast(message, "info", r.versement ? {
      action: { libelle: "Annuler", faire: () => this.annulerVersement(r.versement, seance, notees) },
    } : {});
  }

  // Le montant proposé : ce qui manque au niveau, sans dépasser la bourse du héros choisi.
  montantPropose(b) {
    const t = this.typeDe(b);
    const n = t?.niveaux[+b?.niveau || 0];
    if (!n) return 0;
    const h = this.heros.find((x) => x.id === this.herosChoisi) || this.heros[0];
    return Math.max(0, Math.min(Math.max(0, n.cout - (+b.cagnotte || 0)), orDe(h)));
  }

  // Le bouton dit ce qui partira : « Verser 100 po ».
  majBoutonVerser() {
    const champ = this.panneau.querySelector("[data-sc-montant]");
    const bouton = this.panneau.querySelector('[data-sc="verser"]');
    if (champ && bouton && !champ.disabled) bouton.textContent = libelleVerser(Math.round(+champ.value || 0));
  }

  // « Annuler » juste après un versement : il est rendu sans question (l'or revient, le niveau qu'il a bâti redescend),
  // et ses lignes du journal de la séance s'effacent.
  async annulerVersement(v, seance, notees) {
    try {
      const r = await this.apresRoute(() => api.del(`/api/sanctuaire/versements/${encodeURIComponent(v.id)}`));
      const h = this.heros.find((x) => x.id === r.rendu?.aventurier);
      if (h) h.or = orDe(h) + (r.rendu.or || 0);
      if (!this.detruit) this.afficher();
      toast(`Versement annulé : ${pieces(r.rendu.or)} reviennent à ${prenom(r.rendu.nom)}${r.rendu.recul ? `, le niveau ${ROMAINS[r.rendu.recul.rang]} n'est plus bâti` : ""}.`);
    } catch (err) {
      return toast(`Versement non annulé : ${err.message}`, "erreur");
    }
    if (!seance) return;
    for (const ligne of await notees) if (ligne?.id) retirerDuJournal(seance.id, ligne, -1).catch(() => {});
  }

  async rendre(vid) {
    const b = this.batiment();
    const v = (b?.versements || []).find((x) => x.id === vid);
    const t = this.typeDe(b);
    const recule = v && v.pour === (+b.niveau || 0);
    if (!(await demander(recule
      ? { titre: `Rendre les ${pieces(v.or)} ${de(prenom(v.nom))}`, texte: `${b.nom || t?.nom || "Le bâtiment"} redescend au niveau ${ROMAINS[v.pour - 1]}${v.pour > 1 ? ` (${t?.niveaux[v.pour - 2]?.nom || ""})` : ""}.`, oui: "Rendre l'or" }
      : { titre: "Rendre ce versement", texte: "L'or revient dans la bourse du héros.", oui: "Rendre l'or" }))) return;
    try {
      const r = await this.apresRoute(() => api.del(`/api/sanctuaire/versements/${encodeURIComponent(vid)}`));
      const h = this.heros.find((x) => x.id === r.rendu?.aventurier);
      if (h) h.or = orDe(h) + (r.rendu.or || 0);
      this.afficher();
      toast(`${pieces(r.rendu.or)} rendus à ${prenom(r.rendu.nom)}.`);
    } catch (err) {
      toast(err.message, "erreur");
    }
  }

  async corriger(champs) {
    const b = this.batiment();
    if (!b) return;
    try {
      await this.apresRoute(() => api.patch(`/api/sanctuaire/batiments/${encodeURIComponent(b.id)}`, champs));
    } catch (err) {
      toast(err.message, "erreur");
      this.afficher();
    }
  }

  async raser() {
    const b = this.batiment();
    if (!b) return;
    const verse = (b.versements || []).reduce((x, v) => x + (+v.or || 0), 0);
    if (!(await demander({ titre: `Retirer « ${b.nom} » du village`, texte: verse ? `Les ${verse} po versés ne sont pas rendus.` : "Le bâtiment quitte le plan du sanctuaire.", oui: "Retirer du village", danger: true }))) return;
    try {
      await this.apresRoute(() => api.del(`/api/sanctuaire/batiments/${encodeURIComponent(b.id)}`));
      this.choisir(null);
    } catch (err) {
      toast(err.message, "erreur");
    }
  }

  // ---------------------------------------------------------------- la TV

  envoyerTable(fabrique, message) {
    this.fileTable = this.fileTable.then(async () => {
      try {
        const etat = await api.get("/api/table");
        for (const k of ["ecrans", "ecrans_salon", "ecrans_internet", "publique"]) delete etat[k];
        const nouveau = fabrique(etat);
        if (!nouveau) {
          this.table = etat;
          toast("La TV montre déjà autre chose.");
        } else {
          const r = await api.put("/api/table", nouveau);
          this.table = nouveau;
          toast(r.ecrans ? message : "Envoyé, mais aucun écran de table n'est ouvert.");
        }
      } catch (err) {
        toast(err.status && err.status < 500 ? err.message : `La table ne répond pas : ${err.message}`, "erreur");
      }
      if (!this.detruit) this.afficher();
    });
    return this.fileTable;
  }

  async montrer(batiment) {
    await this.vider();
    return this.envoyerTable((etat) => {
      const avant = SANS_RETOUR.includes(etat.vue) ? etat.avant || null : Object.fromEntries(VUE_AVANT.map((k) => [k, etat[k] ?? null]));
      return { ...etat, vue: "sanctuaire", batiment: batiment || null, avant, lieu: null };
    }, batiment ? `À la TV, de près : «\u00a0${this.batiment(batiment)?.nom || "le bâtiment"}\u00a0».` : "À la TV : le sanctuaire.");
  }

  retirerTv() {
    return this.envoyerTable((etat) => {
      if (etat.vue !== "sanctuaire") return null;
      const avant = etat.avant && !SANS_RETOUR.includes(etat.avant.vue) ? etat.avant : { vue: "accueil" };
      return { ...etat, ...avant, batiment: null, avant: null };
    }, "Retiré de la TV : le sanctuaire.");
  }
}
