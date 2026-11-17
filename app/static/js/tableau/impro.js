// « Hors du scénario », dans le tableau du MJ : quand la table sort du scénario, ce qu'un MJ aguerri a sous la main pour
// le lieu où sont les héros. Qui s'y trouve (voix, envie, offre, son carton à la TV, sa fiche), les rumeurs à placer,
// les boutiques du lieu, une rencontre du bestiaire pesée par la balance pour la tablée, et trois noms prêts à servir.
// Ce qui part vers la TV passe par /api/table, comme depuis Séances ou Boutiques (un PNJ inconnu n'y va qu'après
// confirmation). Le lieu, les tris et les tirages sont dans tirages.js.

import { accorderEnfants } from "../commun/accorder.js";
import { api, echapper as e, toast } from "../api.js";
import { cartonVerifie } from "../pnj/carton-pnj.js";
import { VERITES } from "../auberge/tables.js";
import { SANS_RETOUR, VUE_AVANT } from "../boutiques/boutiques.js";
import { resumeAdversaires } from "../combats/balance.js";
import { VERDICTS } from "../combats/simulation.js";
import { planCourant } from "../commun/etat-jeu.js";
import { noterAuJournal, seanceDuJournal } from "../seances/journal.js";
import { garderCle, lire, lireCle, oublier } from "./donnees.js";
import { herosDeLaSeance } from "./moments.js";
import {
  SOURCES_LIEU, boutiquesDuLieu, groupeDeLaTablee, lieuCourant, origineDuLieu, plansAConnaitre, pnjDuLieu, rencontreAEnregistrer,
  rumeursAPlacer, tirerRencontre, troisNoms,
} from "./tirages.js";
import { marqueSort } from "../seances/liens-scene.js";

const MEMOIRE = "tableau.impro.ouvert";
const LIEU = "tableau.impro.lieu.";
const DIFFICULTE = "tableau.impro.difficulte";
const DIFFICULTES = [["facile", "Facile"], ["normale", "Normale"], ["difficile", "Difficile"]];
const PNJ_EN_VUE = 4;
const RUMEURS_EN_VUE = 2;
const NOMS_VERITES = Object.fromEntries(VERITES);
// Ce que la section lit, et combien de temps une lecture reste bonne.
const LECTURES = [
  ["seances", "/api/seances", 15000], ["campagne", "/api/campagne", 60000], ["pnj", "/api/pnj", 30000],
  ["lieux", "/api/lieux", 120000], ["rumeurs", "/api/rumeurs", 30000], ["boutiques", "/api/boutiques", 60000],
];
const pc = (x) => `${Math.round(x * 100)} %`;
const virgule = (x) => (Math.round(x * 10) / 10).toFixed(1).replace(".", ",").replace(",0", "");
const autres = (n, un, plusieurs) => `Voir ${n > 1 ? `les ${n} ${plusieurs}` : `l'${un}`}`;

export class Impro {
  constructor(panneau) {
    this.section = document.createElement("section");
    this.section.className = "ta-aide ta-impro";
    this.section.setAttribute("aria-label", "Hors du scénario");
    this.ouverte = lireCle(MEMOIRE) !== "non";
    this.actif = false;
    this.jeu = null;
    this.d = { seances: null, campagne: null, pnj: [], lieux: [], rumeurs: [], boutiques: [] };
    this.table = null;
    this.tableLue = 0;
    this.plans = new Map(); // id → { lieu, quand } : les plans lus un à un (celui de la TV, celui de la scène)
    this.choixSansSeance = "";
    this.pnjOuvert = "";
    this.tousPnj = false;
    this.toutesRumeurs = false;
    this.difficulte = DIFFICULTES.some(([k]) => k === lireCle(DIFFICULTE)) ? lireCle(DIFFICULTE) : "normale";
    this.tirage = null;
    this.noms = [];
    this.occupe = new Set(); // les gestes en route : un double clic ne part qu'une fois
    this.fileTable = Promise.resolve();
    panneau.append(this.section);
    this.section.addEventListener("click", (ev) => this.clic(ev));
    this.section.addEventListener("change", (ev) => this.changer(ev));
  }

  ouvrir() {
    this.actif = true;
    this.relire();
    this.afficher();
  }

  fermer() {
    this.actif = false;
  }

  recu(jeu) {
    this.jeu = jeu;
    this.relire();
    this.afficher();
  }

  relire() {
    if (!this.actif || !this.ouverte) return Promise.resolve();
    if (this.lecture) return this.lecture;
    this.lecture = (async () => {
      const lus = await Promise.all(LECTURES.map(([, url, age]) => lire(url, age).catch(() => null)));
      LECTURES.forEach(([cle], i) => {
        if (lus[i]) this.d[cle] = lus[i];
      });
      // L'état de la TV, relu à chaque passage (toutes les cinq secondes) : un carton montré ailleurs se voit ici.
      if (Date.now() - this.tableLue > 4000) {
        try {
          this.table = await api.get("/api/table");
          this.tableLue = Date.now();
        } catch {
          // serveur muet : on garde ce qu'on savait
        }
      }
      await this.lirePlans();
    })().finally(() => {
      this.lecture = null;
      this.afficher();
    });
    return this.lecture;
  }

  async lirePlans() {
    const ouvert = planCourant();
    for (const id of plansAConnaitre({ table: this.table, seance: this.seance() })) {
      const x = this.plans.get(id);
      // Le lieu d'un plan bouge rarement : relu toutes les cinq minutes au plus.
      if (ouvert?.id === id || (x && Date.now() - x.quand < 300000)) continue;
      try {
        const p = await api.get(`/api/plans/${encodeURIComponent(id)}`);
        this.plans.set(id, { lieu: p.lieu || "", quand: Date.now() });
      } catch {
        this.plans.set(id, { lieu: x?.lieu || "", quand: Date.now() });
      }
    }
  }

  lieuDuPlan(id) {
    const ouvert = planCourant();
    return ouvert?.id === id ? ouvert.lieu || "" : this.plans.get(id)?.lieu || "";
  }

  seance() {
    return this.d.seances ? seanceDuJournal(this.d.seances) : null;
  }

  choix() {
    const s = this.seance();
    return s ? lireCle(LIEU + s.id) || "" : this.choixSansSeance;
  }

  lieu(choix = this.choix()) {
    return lieuCourant({
      choix, table: this.table, planOuvert: planCourant(), lieuDuPlan: (id) => this.lieuDuPlan(id), seance: this.seance(), lieux: this.d.lieux,
    });
  }

  ficheLieu(id) {
    return (this.d.lieux || []).find((l) => l.id === id) || null;
  }

  heros() {
    return herosDeLaSeance({ tablee: this.d.campagne?.tablee, seance: this.seance(), fiches: this.jeu?.fiches || [] });
  }

  niveau() {
    return Math.min(10, Math.max(1, +this.d.campagne?.niveau || 1));
  }

  afficher() {
    if (!this.actif) return;
    const neuf = document.createElement("div");
    neuf.innerHTML = this.html();
    accorderEnfants(this.section, neuf);
  }

  html() {
    const lieu = this.d.lieux.length ? this.lieu() : { id: "", source: "" };
    const nom = this.ficheLieu(lieu.id)?.nom || "";
    return `
      <h3 class="ta-tete">
        <button type="button" data-ta="replier" aria-expanded="${this.ouverte}">Hors du scénario</button>
        ${!this.ouverte && nom ? `<small>${e(nom)}</small>` : ""}
      </h3>
      ${this.ouverte ? `<div class="ta-corps">${this.htmlCorps(lieu)}</div>` : ""}`;
  }

  htmlCorps(lieu) {
    if (!this.d.seances && !this.d.lieux.length) return '<p class="vide">Lecture…</p>';
    const s = this.seance();
    return `
        ${this.htmlLieu(lieu)}
        ${this.htmlPnjs(lieu, s)}
        ${this.htmlRumeurs(s)}
        ${this.htmlBoutiques(lieu)}
        ${this.htmlRencontre()}
        ${this.htmlNoms()}`;
  }

  htmlLieu(lieu) {
    const choix = this.choix();
    const auto = this.lieu("");
    const lieux = [...this.d.lieux].sort((a, b) => String(a.nom || "").localeCompare(String(b.nom || ""), "fr"));
    const premier = auto.id ? `Selon le jeu : ${this.ficheLieu(auto.id)?.nom || ""}` : "Choisir un lieu…";
    const source = lieu.id ? SOURCES_LIEU[lieu.source] : "Ni plan ni scène n'indique où sont les héros : choisissez le lieu.";
    return `
        <div class="ta-lieu">
          <label><span class="ta-libelle">Lieu</span>
            <select data-ta-champ="lieu" aria-label="Lieu où sont les héros">
              <option value="" ${choix && lieu.source === "choisi" ? "" : "selected"}>${e(premier)}</option>
              ${lieux.map((l) => `<option value="${e(l.id)}" ${lieu.source === "choisi" && l.id === choix ? "selected" : ""}>${e(l.nom || l.id)}</option>`).join("")}
            </select>
          </label>
          <p class="ta-source">${e(source)}</p>
        </div>`;
  }

  htmlPnjs(lieu, s) {
    // Sans lieu connu, la scène en cours dit encore qui est là.
    const tous = pnjDuLieu(this.d.pnj, lieu.id, s);
    if (!lieu.id && !tous.length) return "";
    const vus = this.tousPnj ? tous : tous.slice(0, PNJ_EN_VUE);
    const reste = tous.length - vus.length;
    return `
        <div class="ta-bloc">
          <h4>Qui est là${tous.length ? ` <small>${tous.length}</small>` : ""}</h4>
          ${tous.length ? `<ul class="ta-liste">${vus.map((p) => this.htmlPnj(p)).join("")}</ul>` : '<p class="ta-vide">Aucun PNJ rattaché à ce lieu. Trois noms, plus bas, en donnent un tout de suite.</p>'}
          ${reste > 0 ? `<button type="button" class="lien ta-plus" data-ta="tous-pnj">${autres(reste, "autre", "autres")}</button>`
            : this.tousPnj && tous.length > PNJ_EN_VUE ? '<button type="button" class="lien ta-plus" data-ta="tous-pnj">Moins</button>' : ""}
        </div>`;
  }

  htmlPnj(p) {
    const montre = this.table?.pnj === p.id;
    const ouvert = this.pnjOuvert === p.id;
    const details = [["Voix", p.voix], ["Envie", p.envie], ["Offre", p.offre]].map(([k, v]) => [k, String(v || "").trim()]).filter(([, v]) => v);
    const occupe = this.occupe.has(`pnj:${p.id}`);
    return `
            <li class="ta-pnj${ouvert ? " ouvert" : ""}" data-pnj="${e(p.id)}">
              <div class="ta-pnj-tete">
                <a class="ta-nom" href="#/pnj/${e(encodeURIComponent(p.id))}" title="Ouvrir sa fiche">${e((p.nom || "Sans nom") + marqueSort(p))}</a>
                ${p.connu ? "" : '<span class="inconnu" title="Inconnu des joueurs" aria-label="Inconnu des joueurs"></span>'}
                <small>${e(p.role || "")}</small>
                ${montre
                  ? `<button type="button" data-ta="carton-retirer" ${occupe ? "disabled" : ""} title="Retirer son carton de la TV">Retirer</button>`
                  : `<button type="button" data-ta="carton" ${occupe ? "disabled" : ""} title="Montrer son carton à la TV${p.connu ? "" : " (il deviendra connu des joueurs)"}">Montrer</button>`}
              </div>
              ${details.length ? `
              <button type="button" class="ta-accroche" data-ta="pnj-ouvrir" aria-expanded="${ouvert}" title="${ouvert ? "Replier" : `Sa voix, son envie, ce qu'${p.genre === "f" ? "elle" : "il"} offre`}">${ouvert
                ? details.map(([k, v]) => `<span class="ta-detail"><i>${k}</i>${e(v)}</span>`).join("")
                : e(details[0][1])}</button>` : ""}
            </li>`;
  }

  htmlRumeurs(s) {
    const toutes = rumeursAPlacer(this.d.rumeurs, s);
    if (!toutes.length) return "";
    const vues = this.toutesRumeurs ? toutes : toutes.slice(0, RUMEURS_EN_VUE);
    const reste = toutes.length - vues.length;
    const prevues = new Set(Array.isArray(s?.rumeurs) ? s.rumeurs : []);
    return `
        <div class="ta-bloc">
          <h4>Rumeurs à placer <small>${toutes.length}</small></h4>
          <ul class="ta-liste">${vues.map((r) => `
            <li class="ta-rumeur" data-rumeur="${e(r.id)}">
              <div>
                <p class="ta-texte">«&nbsp;${e(r.texte)}&nbsp;»</p>
                <p class="ta-meta">${prevues.has(r.id) ? '<b title="Prévue pour cette séance">prévue</b> · ' : ""}${e([r.source, r.verite ? NOMS_VERITES[r.verite].toLowerCase() : ""].filter(Boolean).join(" · "))}</p>
              </div>
              <button type="button" data-ta="entendue" ${this.occupe.has(`rumeur:${r.id}`) ? "disabled" : ""} title="Les héros l'ont entendue : elle passe dans les rumeurs entendues de l'Auberge">Entendue</button>
            </li>`).join("")}
          </ul>
          ${reste > 0 ? `<button type="button" class="lien ta-plus" data-ta="toutes-rumeurs">${autres(reste, "autre", "autres")}</button>`
            : this.toutesRumeurs && toutes.length > RUMEURS_EN_VUE ? '<button type="button" class="lien ta-plus" data-ta="toutes-rumeurs">Moins</button>' : ""}
        </div>`;
  }

  htmlBoutiques(lieu) {
    const liste = boutiquesDuLieu(this.d.boutiques, lieu.id);
    if (!liste.length) return "";
    const t = this.table || {};
    return `
        <div class="ta-bloc">
          <h4>Boutiques</h4>
          <ul class="ta-liste">${liste.map((b) => {
            const marchand = this.d.pnj.find((p) => p.id === b.marchand)?.nom || "";
            const montree = t.vue === "boutique" && t.boutique === b.id;
            const occupe = this.occupe.has(`boutique:${b.id}`);
            return `
            <li class="ta-boutique" data-boutique="${e(b.id)}">
              <a class="ta-nom" href="#/boutiques/${e(encodeURIComponent(b.id))}" title="Ouvrir la boutique">${e(b.nom || "Boutique")}</a>
              <small>${e(marchand)}</small>
              ${montree
                ? `<button type="button" data-ta="boutique-retirer" ${occupe ? "disabled" : ""} title="Retirer la boutique de la TV">Retirer</button>`
                : `<button type="button" data-ta="boutique" ${occupe ? "disabled" : ""} title="Montrer la boutique à la TV">Montrer</button>`}
            </li>`;
          }).join("")}
          </ul>
        </div>`;
  }

  htmlRencontre() {
    const t = this.tirage;
    const s = this.seance();
    let resultat = "";
    if (t?.vide) resultat = '<p class="ta-vide">Personne à la tablée : la balance ne peut rien peser.</p>';
    else if (t) {
      const v = VERDICTS[t.cle];
      const r = t.resultat;
      resultat = `
          <div class="ta-tirage">
            <p class="ta-tirage-tete"><b>${e(t.nom)}</b><span class="verdict-${e(t.cle)}">${e(v.nom)}</span></p>
            <p class="ta-meta">${e(resumeAdversaires(t.adversaires))}</p>
            <p class="ta-meta">Victoire ${pc(r.victoire)}, ${virgule(r.tours)} tours, ${virgule(r.auTapis)} héros au tapis en moyenne${t.cle !== t.cible ? `. Rien de plus juste ici pour « ${e(VERDICTS[t.cible].nom.toLowerCase())} »` : ""}.</p>
            <div class="ta-actions">${t.id
              ? `${s ? `<a class="bouton" href="#/combat/${e(encodeURIComponent(s.id))}?rencontre=${e(encodeURIComponent(t.id))}" title="Ordre du tour, Santé, cartons et rappels du kit">Lancer le combat</a>` : ""}
                <a class="bouton" href="#/combats/${e(encodeURIComponent(t.id))}" title="La rencontre dans l'onglet Combats">Ouvrir</a>`
              : `<button type="button" data-ta="enregistrer-rencontre" ${this.occupe.has("rencontre") ? "disabled" : ""} title="Dans l'onglet Combats, pour la lancer ou l'ajuster">Enregistrer</button>
                <button type="button" class="lien" data-ta="effacer-rencontre">Effacer</button>`}
            </div>
          </div>`;
    }
    return `
        <div class="ta-bloc ta-rencontre">
          <div class="ta-titre-bloc">
            <h4>Rencontre</h4>
            <span class="ta-difficultes" role="group" aria-label="Difficulté visée">${DIFFICULTES.map(([k, nom]) => `<button type="button" data-ta="difficulte" data-difficulte="${k}" aria-pressed="${this.difficulte === k}">${nom}</button>`).join("")}</span>
          </div>
          <button type="button" class="ta-large" data-ta="tirer-rencontre" ${this.occupe.has("tirage") ? "disabled" : ""} title="Des adversaires du bestiaire qui conviennent au lieu, pesés par la balance pour la tablée">${this.occupe.has("tirage") ? "Pesée…" : "Tirer une rencontre"}</button>
          ${resultat}
        </div>`;
  }

  htmlNoms() {
    return `
        <div class="ta-bloc ta-noms">
          <div class="ta-titre-bloc">
            <h4>Trois noms</h4>
            <button type="button" data-ta="noms" title="Tirés dans les tables des PNJ, selon la région du lieu">${this.noms.length ? "D'autres" : "Tirer"}</button>
          </div>
          ${this.noms.length ? `<ul class="ta-liste">${this.noms.map((n, i) => `
            <li class="ta-nom-tire">${n.id
              ? `<a class="ta-nom" href="#/pnj/${e(encodeURIComponent(n.id))}" title="Ouvrir sa fiche">${e(n.nom)}</a><small>fiche créée</small>`
              : `<span class="ta-nom">${e(n.nom)}</span><small>${e(n.peuple)}</small>
                <button type="button" data-ta="creer-pnj" data-i="${i}" ${this.occupe.has(`nom:${i}`) ? "disabled" : ""} title="Une fiche au lieu courant, notée au journal de la séance">Créer ce PNJ</button>`}
            </li>`).join("")}
          </ul>` : ""}
        </div>`;
  }

  changer(ev) {
    const el = ev.target;
    if (el.dataset.taChamp !== "lieu") return;
    const s = this.seance();
    // Un choix fait à la main prime sur le plan et la scène, pour toute la séance ; « Selon le jeu » le défait.
    if (s) garderCle(LIEU + s.id, el.value);
    else this.choixSansSeance = el.value;
    this.pnjOuvert = "";
    this.tousPnj = false;
    this.afficher();
  }

  async clic(ev) {
    const b = ev.target.closest("button[data-ta]");
    if (!b || b.disabled) return;
    // Touché à la souris, le bouton ne garde pas le focus : Entrée ne rejoue pas le geste.
    if (ev.detail) b.blur();
    const a = b.dataset.ta;
    const pnj = () => this.d.pnj.find((p) => p.id === b.closest("[data-pnj]")?.dataset.pnj);
    if (a === "replier") {
      this.ouverte = !this.ouverte;
      garderCle(MEMOIRE, this.ouverte ? "oui" : "non");
      this.relire();
      return this.afficher();
    }
    if (a === "pnj-ouvrir") {
      const id = b.closest("[data-pnj]")?.dataset.pnj || "";
      this.pnjOuvert = this.pnjOuvert === id ? "" : id;
      return this.afficher();
    }
    if (a === "tous-pnj") {
      this.tousPnj = !this.tousPnj;
      return this.afficher();
    }
    if (a === "toutes-rumeurs") {
      this.toutesRumeurs = !this.toutesRumeurs;
      return this.afficher();
    }
    if (a === "carton") return this.geste(`pnj:${pnj()?.id}`, () => this.montrerCarton(pnj()));
    if (a === "carton-retirer") return this.geste(`pnj:${pnj()?.id}`, () => this.retirerCarton());
    if (a === "entendue") {
      const r = this.d.rumeurs.find((x) => x.id === b.closest("[data-rumeur]")?.dataset.rumeur);
      return r && this.geste(`rumeur:${r.id}`, () => this.entendue(r));
    }
    const boutique = this.d.boutiques.find((x) => x.id === b.closest("[data-boutique]")?.dataset.boutique);
    if (a === "boutique" && boutique) return this.geste(`boutique:${boutique.id}`, () => this.montrerBoutique(boutique));
    if (a === "boutique-retirer" && boutique) return this.geste(`boutique:${boutique.id}`, () => this.retirerBoutique(boutique));
    if (a === "difficulte") {
      this.difficulte = b.dataset.difficulte;
      garderCle(DIFFICULTE, this.difficulte);
      return this.afficher();
    }
    if (a === "tirer-rencontre") return this.geste("tirage", () => this.tirerRencontre());
    if (a === "effacer-rencontre") {
      this.tirage = null;
      return this.afficher();
    }
    if (a === "enregistrer-rencontre") return this.geste("rencontre", () => this.enregistrerRencontre());
    if (a === "noms") return this.tirerNoms();
    if (a === "creer-pnj") return this.geste(`nom:${b.dataset.i}`, () => this.creerPnj(+b.dataset.i));
  }

  async geste(cle, travail) {
    if (this.occupe.has(cle)) return;
    this.occupe.add(cle);
    this.afficher();
    try {
      await travail();
    } catch (err) {
      toast(`Impossible : ${err.message}`, "erreur");
    } finally {
      this.occupe.delete(cle);
      this.afficher();
    }
  }

  // L'état de la table est relu juste avant chaque envoi : ce qu'un autre écran y a posé reste. fabrique rend l'état à
  // envoyer, ou null pour ne rien envoyer (la TV montre déjà autre chose). Un envoi à la fois, dans l'ordre des clics.
  envoyerTable(fabrique, message, sinon = "") {
    this.fileTable = this.fileTable.then(async () => {
      try {
        const etat = await api.get("/api/table");
        delete etat.ecrans;
        const nouveau = fabrique(etat);
        if (!nouveau) {
          this.table = etat;
          if (sinon) toast(sinon);
        } else {
          const r = await api.put("/api/table", nouveau);
          this.table = nouveau;
          if (message) toast(r.ecrans ? message : "Envoyé, mais aucun écran de table n'est ouvert.");
        }
        this.tableLue = Date.now();
      } catch (err) {
        toast(`La table ne répond pas : ${err.message}`, "erreur");
      }
    });
    return this.fileTable;
  }

  // Comme le déroulé de séance : un PNJ inconnu des joueurs devient connu avant que son carton parte, après le « oui »
  // de la seule question du carton.
  async montrerCarton(p) {
    if (!p) return;
    if (!(await cartonVerifie(p.id, p.nom, { secret: !p.connu }))) return;
    if (!p.connu) {
      Object.assign(p, await api.patch(`/api/pnj/${encodeURIComponent(p.id)}`, { connu: true }));
      oublier("/api/pnj");
    }
    return this.envoyerTable((etat) => ({ ...etat, pnj: p.id }), `Le carton de ${p.nom} est sur la TV.`);
  }

  retirerCarton() {
    return this.envoyerTable((etat) => (etat.pnj ? { ...etat, pnj: null } : null), "Carton retiré de la TV.");
  }

  // La même transition que l'Auberge et le déroulé : « à placer » devient « entendue », pendant la séance du journal.
  async entendue(r) {
    const s = this.seance();
    Object.assign(r, await api.patch(`/api/rumeurs/${encodeURIComponent(r.id)}`, { etat: "entendue", seance: s?.id || r.seance || "" }));
    oublier("/api/rumeurs");
    toast("Rumeur entendue par les héros : elle quitte les rumeurs à placer.");
  }

  // Comme l'onglet Boutiques : la vue d'avant est gardée pour y revenir en retirant la boutique.
  montrerBoutique(b) {
    return this.envoyerTable((etat) => {
      const avant = SANS_RETOUR.includes(etat.vue) ? etat.avant || null : Object.fromEntries(VUE_AVANT.map((k) => [k, etat[k] ?? null]));
      return { ...etat, vue: "boutique", boutique: b.id, article: null, avant, lieu: null };
    }, `${b.nom || "La boutique"} : sur la TV.`);
  }

  retirerBoutique(b) {
    return this.envoyerTable((etat) => {
      if (etat.vue !== "boutique" || etat.boutique !== b.id) return null;
      const avant = etat.avant && !SANS_RETOUR.includes(etat.avant.vue) ? etat.avant : { vue: "accueil" };
      return { ...etat, ...avant, boutique: null, article: null, avant: null };
    }, "Boutique retirée de la table.", "La TV montre déjà autre chose.");
  }

  // La pesée prend quelques dizaines de millisecondes : le bouton dit « Pesée… » le temps qu'elle se fasse.
  async tirerRencontre() {
    await new Promise((fin) => setTimeout(fin, 30));
    const heros = this.heros();
    if (!heros.length) {
      this.tirage = { vide: true };
      return;
    }
    const niveau = this.niveau();
    const lieu = this.ficheLieu(this.lieu().id);
    const t = tirerRencontre({ groupe: groupeDeLaTablee(heros, niveau), niveau, cible: this.difficulte, lieu, sauf: this.tirage?.famille || "" });
    this.tirage = t ? { ...t, nbPj: heros.length, niveau, lieu: lieu?.id || "" } : { vide: true };
  }

  async enregistrerRencontre() {
    const t = this.tirage;
    if (!t || t.vide || t.id) return;
    const r = await api.post("/api/rencontres", rencontreAEnregistrer(t, { lieu: this.ficheLieu(t.lieu), seance: this.seance(), nbPj: t.nbPj, niveau: t.niveau }));
    if (this.tirage === t) t.id = r.id;
    oublier("/api/rencontres");
    toast(`« ${r.nom} » est dans l'onglet Combats.`);
  }

  tirerNoms() {
    const lieu = this.ficheLieu(this.lieu().id);
    const eviter = [...this.d.pnj.map((p) => p.nom), ...(this.jeu?.fiches || []).map((a) => a.nom)];
    this.noms = troisNoms({ origine: origineDuLieu(lieu), eviter });
    this.afficher();
  }

  // Une fiche minimale au lieu courant, par la même route que l'onglet PNJ ; la séance du journal en garde la trace.
  async creerPnj(i) {
    const n = this.noms[i];
    if (!n || n.id) return;
    const lieu = this.lieu().id;
    const s = this.seance();
    const p = await api.post("/api/pnj", {
      statut: "vivant", attitude: "neutre", etiquette: "maison", connu: false, rang: "civil",
      nom: n.nom, genre: n.genre, peuple: n.peuple, origine: n.origine, lieu,
    });
    n.id = p.id;
    this.d.pnj = [...this.d.pnj, p];
    oublier("/api/pnj");
    const ou = this.ficheLieu(lieu)?.nom;
    if (!s) return toast(`${p.nom} : fiche créée${ou ? ` (${ou})` : ""}. Aucune séance ouverte : rien au journal.`);
    try {
      await noterAuJournal(s.id, `PNJ improvisé : ${p.nom}`);
      toast(`${p.nom} : fiche créée${ou ? ` (${ou})` : ""}, notée au journal.`);
    } catch (err) {
      toast(`${p.nom} : fiche créée, mais rien au journal (${err.message}).`, "erreur");
    }
  }
}
