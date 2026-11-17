// « Un mot au MJ » et « Mes demandes », dans le carnet du coin des joueurs : le joueur écrit quelques lignes à son MJ,
// puis relit ce qu'il a demandé et ce que le MJ en a fait (« lu », une réponse d'un mot). La section se relit d'elle-même
// quand l'atelier change un statut (flux.js, sujet « demandes »), et dit quand le coin est en pause (sujet « pause »).
// Le serveur ne rend que les demandes du joueur connecté ; tout texte passe par echapper. Quand deux MJ mènent la campagne
//, le serveur donne la liste des MJ à qui écrire, et le joueur choisit le sien ; sans elle, aucun choix.

import { echapper as e } from "../api.js";
import { dateFr, demander, heureFr } from "./carnet-vue.js";
import { ecouterFlux } from "./flux.js";

const MESSAGE_MAX = 800;
const quand = (iso) => [dateFr(iso), heureFr(iso)].filter(Boolean).join(" à ");
const lignes = (t) => String(t || "").split(/\n/).map((l) => e(l)).join("<br>");
const PAUSE = "Le coin est en pause pour un moment : votre MJ le rouvrira. Vous pouvez tout lire ; ce que vous écrivez attendra la réouverture.";

export class MesDemandes {
  constructor() {
    this.section = null;
    this.etat = null; // la dernière réponse de GET /api/demandes
    this.brouillon = "";
    this.pour = ""; // le MJ choisi, quand il y en a deux ("" : le premier, le MJ de la campagne)
    this.envoi = false;
    this.avis = null;
    this.lecture = 0;
    ecouterFlux("demandes", () => this.relire({ dire: true }));
    ecouterFlux("pause", () => this.relire());
  }

  // Pose la section à la fin du carnet (ou sous la page « carnet fermé »), et sa ligne au sommaire s'il y en a un.
  monter(conteneur, { sommaire = null, seule = false } = {}) {
    if (!conteneur) return;
    const s = document.createElement("section");
    s.className = seule ? "feuille-coin mes-demandes seule" : "section-coin mes-demandes";
    s.id = "mot-au-mj";
    s.innerHTML = `
      <header class="tete-section"><h2>Un mot au MJ</h2><span class="filet" aria-hidden="true"></span>
        <p class="sous-titre">Une question, une idée pour votre héros, un empêchement : votre MJ le lit dans son atelier, et vous répond ici.</p></header>
      <p class="pause-coin" role="status" hidden></p>
      <form class="mot-au-mj">
        <label for="mot-au-mj-texte">Votre mot</label>
        <textarea id="mot-au-mj-texte" name="texte" rows="4" maxlength="${MESSAGE_MAX}" placeholder="Quelques lignes pour votre MJ…"></textarea>
        <fieldset class="pour-mj" hidden><legend>Pour</legend><div class="choix-mj"></div></fieldset>
        <div class="pied-mot"><span class="reste" aria-live="polite"></span><button type="submit" class="envoyer-coin">Envoyer au MJ</button></div>
        <p class="refus-coin" role="alert" hidden></p>
      </form>
      <h3 class="intertitre">Mes demandes</h3>
      <div class="liste-demandes"><p class="vide">Lecture…</p></div>`;
    conteneur.append(s);
    this.section = s;
    const champ = s.querySelector("textarea");
    champ.value = this.brouillon;
    this.compter();
    champ.addEventListener("input", () => {
      this.brouillon = champ.value;
      this.compter();
    });
    s.querySelector("form").addEventListener("submit", (ev) => this.envoyer(ev));
    s.querySelector(".pour-mj").addEventListener("change", (ev) => {
      if (ev.target.name === "pour-mj") this.pour = ev.target.value;
    });
    s.addEventListener("click", (ev) => this.clic(ev));
    if (sommaire) {
      sommaire.insertAdjacentHTML("beforeend", `<li><a href="#carnet" data-aller="mot-au-mj"><span>Un mot au MJ</span><span class="points" aria-hidden="true"></span><span class="compte"></span></a></li>`);
      this.ligneSommaire = sommaire.lastElementChild;
    } else this.ligneSommaire = null;
    if (this.etat) this.dessiner();
    this.relire();
  }

  compter() {
    const s = this.section;
    if (!s) return;
    const n = s.querySelector("textarea").value.length;
    s.querySelector(".reste").textContent = n > MESSAGE_MAX - 120 ? `${MESSAGE_MAX - n} signes restants` : "";
  }

  async relire({ dire = false } = {}) {
    if (!this.section?.isConnected) return;
    const n = ++this.lecture;
    let r;
    try {
      r = await demander("GET", "/api/demandes");
    } catch {
      return; // le carnet dit déjà si le lien ne vaut plus
    }
    if (n !== this.lecture || !this.section?.isConnected) return;
    const avant = this.etat;
    this.etat = r;
    this.dessiner();
    if (dire && avant) this.direCeQuiAChange(avant.demandes || [], r.demandes || []);
  }

  dessiner() {
    const s = this.section;
    const r = this.etat;
    if (!s || !r) return;
    const pause = s.querySelector(".pause-coin");
    pause.hidden = !r.pause;
    pause.textContent = r.pause ? PAUSE : "";
    s.querySelector(".envoyer-coin").disabled = this.envoi || r.pause;
    this.dessinerChoix(r.destinataires || []);
    const liste = r.demandes || [];
    const ouvertes = liste.filter((d) => d.retirable).length;
    if (this.ligneSommaire) this.ligneSommaire.querySelector(".compte").textContent = ouvertes ? String(ouvertes) : "";
    // Les trois dernières se lisent d'emblée ; les plus anciennes se replient (le carnet ne s'allonge pas de séance en séance).
    const VISIBLES = 3;
    const ligne = (d) => this.htmlDemande(d, r.pause);
    const reste = liste.slice(VISIBLES);
    s.querySelector(".liste-demandes").innerHTML = liste.length
      ? `<ol class="historique-coin">${liste.slice(0, VISIBLES).map(ligne).join("")}</ol>${reste.length ? `<details class="demandes-suite"${this.depliees ? " open" : ""}>
          <summary>${reste.length > 1 ? `Voir les ${reste.length} plus anciennes` : "Voir la plus ancienne"}</summary>
          <ol class="historique-coin">${reste.map(ligne).join("")}</ol></details>` : ""}`
      : '<p class="vide">Rien encore. Ce que vous écrivez à votre MJ, et ce qu\'il en fait, paraîtra ici.</p>';
    const suite = s.querySelector(".demandes-suite");
    if (suite) suite.addEventListener("toggle", () => { this.depliees = suite.open; });
  }

  // À qui écrire : seulement quand le serveur donne plus d'un MJ. Le choix tient tant que ce MJ reste dans la liste.
  dessinerChoix(mjs) {
    const zone = this.section.querySelector(".pour-mj");
    if (mjs.length < 2) {
      zone.hidden = true;
      this.pour = "";
      return;
    }
    if (!mjs.some((m) => m.id === this.pour)) this.pour = mjs[0].id;
    const cle = mjs.map((m) => `${m.id}:${m.nom}`).join("|");
    if (zone.dataset.cle !== cle) {
      zone.dataset.cle = cle;
      zone.querySelector(".choix-mj").innerHTML = mjs.map((m) => `<label class="mj-choisi"><input type="radio" name="pour-mj" value="${e(m.id)}"><span>${e(m.nom)}</span></label>`).join("");
    }
    for (const r of zone.querySelectorAll("input")) r.checked = r.value === this.pour;
    zone.hidden = false;
  }

  htmlDemande(d, pause) {
    const c = d.corps || {};
    const mj = c.mj ? (this.etat?.destinataires || []).find((m) => m.id === c.mj) : null;
    return `<li class="demande-coin statut-${e(d.statut)}" data-id="${e(d.id)}">
      <p class="tete-demande"><b>${e(d.genre_nom)}${mj ? ` pour ${e(mj.nom)}` : ""}</b><span class="quand">${e(quand(d.cree))}</span><span class="statut">${e(d.statut_dit)}</span></p>
      ${c.texte ? `<blockquote>${lignes(c.texte)}</blockquote>` : ""}
      ${d.mot ? `<p class="mot-du-mj"><span class="lbl">Votre MJ</span>${e(d.mot)}</p>` : ""}
      ${d.resultat ? `<p class="resultat-demande">${e(d.resultat)}</p>` : ""}
      ${d.genre === "lore" ? '<p class="resultat-demande"><a href="/histoire">Voir dans « L\'histoire de mon héros »</a></p>' : ""}
      ${d.genre === "confie" ? '<p class="resultat-demande"><a href="/histoire#confie-mj">Relire ce que vous avez confié</a></p>' : ""}
      ${d.retirable ? `<button type="button" class="secondaire" data-retirer="${e(d.id)}" ${pause ? "disabled" : ""}>Retirer</button>` : ""}
    </li>`;
  }

  // Une demande que le MJ vient de traiter : un petit avis au bas de l'écran, où que le joueur lise.
  direCeQuiAChange(avant, apres) {
    const statuts = new Map(avant.map((d) => [d.id, d.statut]));
    // Appliquée seule (un geste du sac) : le joueur vient de la faire, rien à lui annoncer ; un échec, si.
    const traitee = apres.find((d) => statuts.get(d.id) && statuts.get(d.id) !== d.statut && !["retiree", "a-appliquer", "en-attente", "appliquee"].includes(d.statut));
    if (!traitee) return;
    const texte = traitee.genre === "message"
      ? traitee.mot ? "Votre MJ vous a répondu." : "Votre MJ a lu votre mot."
      : `${traitee.genre_nom} : ${traitee.statut_dit}.`;
    this.avis?.remove();
    const a = document.createElement("div");
    a.className = "avis-coin";
    a.setAttribute("role", "status");
    a.innerHTML = `<span>${e(texte)}</span><a href="#carnet" data-aller="mot-au-mj">Voir</a>`;
    a.addEventListener("click", (ev) => {
      if (!ev.target.closest("[data-aller]")) return;
      ev.preventDefault();
      document.getElementById("mot-au-mj")?.scrollIntoView({ behavior: "smooth", block: "start" });
      a.remove();
    });
    document.body.append(a);
    this.avis = a;
    setTimeout(() => a.remove(), 9000);
  }

  refus(message) {
    const p = this.section?.querySelector(".refus-coin");
    if (!p) return;
    p.textContent = message;
    p.hidden = !message;
  }

  async envoyer(ev) {
    ev.preventDefault();
    if (this.envoi) return;
    const champ = this.section.querySelector("textarea");
    const texte = champ.value.trim();
    if (!texte) return this.refus("Écrivez quelques mots avant d'envoyer.");
    this.envoi = true;
    this.section.querySelector(".envoyer-coin").disabled = true;
    this.refus("");
    try {
      const mjs = this.etat?.destinataires || [];
      const corps = mjs.length > 1 && this.pour && this.pour !== mjs[0].id ? { texte, mj: this.pour } : { texte };
      await demander("POST", "/api/demandes", { genre: "message", corps });
      champ.value = this.brouillon = "";
      this.compter();
      this.envoi = false;
      await this.relire();
    } catch (err) {
      this.envoi = false;
      this.refus(err.status === 423 && !this.etat?.pause ? err.message : `Mot non envoyé : ${err.message}`);
      if (err.status === 423) await this.relire();
      else this.dessiner();
    }
  }

  async clic(ev) {
    const b = ev.target.closest("[data-retirer]");
    if (!b || b.disabled) return;
    b.disabled = true;
    try {
      await demander("DELETE", `/api/demandes/${encodeURIComponent(b.dataset.retirer)}`);
    } catch (err) {
      b.disabled = false;
      this.refus(`Rien de retiré : ${err.message}`);
    }
    this.relire();
  }
}

// Le bandeau « Coin en pause » des autres pages du coin (le créateur d'aventurier) : il dit pourquoi rien ne s'enregistre,
// et disparaît quand le MJ rouvre le coin.
export function bandeauPause() {
  const b = document.createElement("p");
  b.className = "bandeau-pause-coin";
  b.setAttribute("role", "status");
  b.hidden = true;
  b.textContent = PAUSE;
  const tete = document.querySelector("body > header");
  if (tete) tete.after(b);
  else document.body.prepend(b);
  const lire = () => demander("GET", "/api/demandes").then((r) => { b.hidden = !r.pause; }).catch(() => {});
  ecouterFlux("pause", lire);
  lire();
}
