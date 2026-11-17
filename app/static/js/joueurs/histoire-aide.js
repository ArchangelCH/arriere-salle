// L'aide à l'écriture, sous chaque passage de « L'histoire de mon héros » (histoire.js) : « Proposer » (une suite,
// une variante, une idée) et « Relire » (au regard de la bible de la campagne et de ce que la compagnie a vécu). La demande part
// dans la file du joueur (POST /api/aide) ; l'atelier la traite, une à la fois pour toute la tablée, et y écrit la réponse ;
// le flux pousse le sujet « demandes » et la page relit (GET /api/aide). Rien ne s'écrit seul dans le passage : le joueur
// insère, remplace ou ignore, et peut défaire tant que le billet est ouvert. Tout texte passe par echapper.
//
// histoire.js appelle AIDE.monter(zone, passage) pour chaque passage que le joueur peut écrire :
//   zone : l'emplacement sous le champ, caché tant que rien n'y est posé ;
//   passage : { cle, nom, lire() : le texte du champ, ecrire(texte) : le remplace comme une frappe du joueur }.

import { echapper as e } from "../api.js";
import { ecart, htmlEcart } from "../lore/ecart.js";
import { demander } from "./carnet-vue.js";
import { ecouterFlux } from "./flux.js";

export const AIDE = { monter: null };

const LONGUE = 90; // secondes d'attente au-delà desquelles la page dit que c'est plus long que d'habitude
const SECOURS = 20000; // millisecondes : relecture de secours tant qu'une aide est en route (le flux peut s'être coupé)
const FRAICHE = 30 * 60 * 1000; // une réponse plus ancienne ne se rouvre pas d'elle-même au chargement
const ECARTEES = "aide-ecartees"; // les réponses que le joueur a ignorées, sur cet appareil
const ATTENTES = { proposer: "Une proposition se prépare", relire: "La relecture est en cours" };
const GENRES = { suite: "Une suite", variante: "Une variante", idee: "Une idée" };
const SORTES = { contradiction: "Contradiction", lien: "Lien possible", ecriture: "Écriture", "a-verifier": "À voir avec votre MJ" };
const paragraphes = (t) => String(t || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${e(x)}</p>`).join("");
const net = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

function lireEcartees() {
  try {
    const v = JSON.parse(localStorage.getItem(ECARTEES) || "[]");
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

class Plume {
  constructor() {
    this.etat = null; // la dernière réponse de GET /api/aide
    this.passages = new Map(); // cle -> { zone, passage }
    this.ecartees = lireEcartees();
    this.attendues = new Set(); // les aides vues en route depuis cette page : leur réponse s'ouvre à son arrivée
    this.faits = new Map(); // cle -> { avant, quoi } : ce que « Défaire » rétablit
    this.erreurs = new Map(); // cle -> phrase d'un refus
    this.envoi = null; // le passage dont la demande part en ce moment
    this.mode = ""; // et ce qu'elle demande
    this.lecture = 0;
    this.minuterie = 0;
    this.horloge = 0;
    for (const sujet of ["demandes", "carnet", "pause"]) ecouterFlux(sujet, () => this.relire());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.etat) this.relire();
    });
  }

  // ------------------------------------------------------------ lecture

  async relire() {
    const n = ++this.lecture;
    let r;
    try {
      r = await demander("GET", "/api/aide");
    } catch {
      return; // la page de l'histoire dit déjà ce qui ne va pas ; l'aide attend la relecture suivante
    }
    if (n !== this.lecture) return;
    this.prendre(r);
  }

  prendre(r) {
    if (r.en_cours) this.attendues.add(r.en_cours.id);
    this.etat = r;
    this.toutDessiner();
    clearTimeout(this.minuterie);
    if (r.en_cours) this.minuterie = setTimeout(() => this.relire(), SECOURS);
    clearInterval(this.horloge);
    this.horloge = r.en_cours ? setInterval(() => this.majAttente(), 5000) : 0;
  }

  // La réponse à montrer sous ce passage : la plus récente, si le joueur ne l'a pas ignorée, et qu'elle vient d'arriver
  // (attendue par cette page) ou date de moins d'une demi-heure.
  reponseDe(cle) {
    const d = (this.etat?.reponses || []).find((x) => x.champ === cle);
    if (!d || this.ecartees.has(d.id)) return null;
    const recente = Date.now() - new Date(d.traitee || d.cree || 0).getTime() < FRAICHE;
    return this.attendues.has(d.id) || recente ? d : null;
  }

  // ------------------------------------------------------------ dessin

  monter(zone, passage) {
    this.passages.set(passage.cle, { zone, passage });
    zone.innerHTML = `
      <div class="plume-barre">
        <button type="button" class="plume-bouton" data-plume="proposer">Proposer</button>
        <button type="button" class="plume-bouton" data-plume="relire">Relire</button>
        <button type="button" class="plume-lien" data-plume="question" aria-expanded="false">Préciser</button>
        <span class="plume-etat" aria-live="polite"></span>
      </div>
      <p class="plume-question" hidden>
        <label>Votre question, ou ce que vous cherchez
          <input type="text" maxlength="300" autocomplete="off" enterkeyhint="send" placeholder="Comment a-t-il connu le forgeron ?"></label>
      </p>
      <div class="plume-billet" aria-live="polite" hidden></div>`;
    zone.hidden = false;
    zone.addEventListener("click", (ev) => this.clic(ev, passage.cle));
    zone.querySelector(".plume-question input").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        this.demander(passage.cle, "proposer");
      }
    });
    // La page redessinée (histoire.js) recrée sa tête et ses zones : le compteur et le billet reviennent.
    if (this.etat) {
      this.compteur();
      this.dessiner(passage.cle);
    } else if (this.passages.size === 1) this.relire();
  }

  toutDessiner() {
    this.compteur();
    for (const cle of this.passages.keys()) this.dessiner(cle);
  }

  // Ce qui empêche de demander maintenant, en clair ; "" si rien.
  frein() {
    const r = this.etat;
    if (!r) return "Un instant…";
    if (!r.ouvert) return "Le carnet est fermé";
    if (r.pause) return "Coin en pause";
    if (!r.disponible) return "Indisponible pour l'instant";
    if (r.epuise) return "Plus d'aide ce mois-ci";
    if (r.restantes <= 0 && !r.en_cours) return "Plus d'aide ce mois-ci";
    return "";
  }

  // La ligne sous le titre de la page : ce qui reste ce mois-ci.
  compteur() {
    const tete = document.querySelector(".titre-histoire");
    if (!tete) return;
    let p = tete.querySelector(".plume-compteur");
    if (!p) {
      p = document.createElement("p");
      p.className = "plume-compteur";
      const temoin = tete.querySelector(".ligne-temoin");
      if (temoin) temoin.before(p);
      else tete.append(p);
    }
    const r = this.etat;
    if (!r || !r.ouvert) {
      p.hidden = true;
      return;
    }
    p.hidden = false;
    p.textContent = !r.disponible ? "« Proposer » et « Relire », sous chaque passage : indisponibles pour l'instant."
      : r.epuise ? "« Proposer » et « Relire » : l'aide est épuisée pour ce mois-ci."
      : `« Proposer » et « Relire », sous chaque passage : ${this.reste(r.restantes)} ce mois-ci.`;
  }

  reste(n) {
    return n > 0 ? `${pluriel(n, "aide restante", "aides restantes")}` : "plus aucune aide";
  }

  dessiner(cle) {
    const lieu = this.passages.get(cle);
    if (!lieu || !lieu.zone.isConnected) return;
    const { zone } = lieu;
    const r = this.etat;
    const route = r?.en_cours || null;
    const frein = this.frein();
    const occupe = Boolean(route) || this.envoi !== null;
    for (const b of zone.querySelectorAll(".plume-bouton")) {
      b.disabled = Boolean(frein) || occupe;
      b.classList.toggle("attenue", Boolean(frein));
    }
    zone.querySelector("[data-plume=question]").disabled = Boolean(frein);
    const etat = zone.querySelector(".plume-etat");
    etat.textContent = frein || (route && route.champ !== cle ? "Une aide est en route pour un autre passage" : "");
    const billet = zone.querySelector(".plume-billet");
    let html = "";
    if (route && route.champ === cle) html = this.htmlAttente(route);
    else if (this.envoi === cle) html = `<p class="plume-attente">${e(ATTENTES[this.mode] || "Un instant")}<span class="plume-points" aria-hidden="true"></span></p>`;
    else if (this.faits.has(cle)) html = this.htmlFait(this.faits.get(cle));
    else {
      const d = this.reponseDe(cle);
      if (d) html = d.statut === "appliquee" && d.reponse ? this.htmlReponse(d, lieu.passage) : this.htmlEchec(d);
    }
    if (this.erreurs.has(cle)) html += `<p class="refus-coin" role="alert">${e(this.erreurs.get(cle))}</p>`;
    billet.hidden = !html;
    if (billet.dataset.html !== html) {
      billet.innerHTML = html;
      billet.dataset.html = html;
    }
  }

  htmlAttente(route) {
    const depuis = (Date.now() - new Date(route.cree).getTime()) / 1000;
    const longue = depuis > LONGUE
      ? `<span class="plume-longue">${depuis > (this.etat?.attente_max || 1800) ? "L'atelier de votre MJ ne répond pas pour l'instant : votre demande attend son tour." : "C'est plus long que d'habitude : d'autres attendent peut-être leur tour."}</span>`
      : "";
    return `<div class="plume-attente" data-depuis="${e(route.cree)}">
        <p>${e(ATTENTES[route.mode] || "Un instant")}<span class="plume-points" aria-hidden="true"></span></p>${longue}
        <button type="button" class="lien-passage" data-plume="annuler" data-id="${e(route.id)}">Annuler</button></div>`;
  }

  majAttente() {
    const route = this.etat?.en_cours;
    if (route) this.dessiner(route.champ);
  }

  htmlEchec(d) {
    return `<div class="plume-echec"><p>${e(d.resultat || "Cette aide n'a pas abouti.")}</p>
      <p class="plume-actions"><button type="button" class="lien-passage" data-plume="ignorer" data-id="${e(d.id)}">Fermer</button></p></div>`;
  }

  htmlReste() {
    const r = this.etat;
    return r?.disponible ? `<p class="plume-reste">${e(this.reste(r.restantes).replace(/^./, (c) => c.toUpperCase()))} ce mois-ci.</p>` : "";
  }

  htmlReponse(d, passage) {
    const r = d.reponse;
    const actuel = passage.lire();
    if (d.mode === "proposer") {
      const vide = !net(actuel);
      const variante = r.genre === "variante" && !vide;
      const inserer = `<button type="button" class="${variante ? "secondaire" : "envoyer-coin"}" data-plume="inserer" data-id="${e(d.id)}">${vide ? "Insérer dans le passage" : "Insérer à la suite"}</button>`;
      const remplacer = vide ? "" : `<button type="button" class="${variante ? "envoyer-coin" : "secondaire"}" data-plume="remplacer" data-id="${e(d.id)}">Remplacer le passage</button>`;
      return `<article class="plume-reponse" data-mode="proposer" aria-label="Proposition pour ce passage">
          <p class="plume-tete"><span class="plume-sorte">${e(GENRES[r.genre] || "Une proposition")}</span>${d.question ? `<span class="plume-pour">${e(d.question)}</span>` : ""}</p>
          ${r.note ? `<p class="plume-note">${e(r.note)}</p>` : ""}
          <div class="plume-texte">${paragraphes(r.texte)}</div>
          <p class="plume-actions">${variante ? remplacer + inserer : inserer + remplacer}
            <button type="button" class="lien-passage" data-plume="ignorer" data-id="${e(d.id)}">Ignorer</button></p>
          ${this.htmlReste()}
        </article>`;
    }
    const change = r.version && net(actuel) !== net(d.texte);
    const version = r.version ? `
        <details class="plume-version"><summary>Ce que changerait la version relue</summary>
          <div class="ecart-passage">${htmlEcart(ecart(actuel, r.version), e)}</div>
          ${change ? '<p class="plume-change">Votre passage a changé depuis la relecture : la version relue ne suit pas vos derniers changements.</p>' : ""}
        </details>` : "";
    return `<article class="plume-reponse" data-mode="relire" aria-label="Relecture de ce passage">
        <p class="plume-tete"><span class="plume-sorte">La relecture</span>${d.question ? `<span class="plume-pour">${e(d.question)}</span>` : ""}</p>
        ${r.bilan ? `<p class="plume-note">${e(r.bilan)}</p>` : ""}
        ${r.remarques.length ? `<ol class="plume-remarques">${r.remarques.map((x) => `
          <li data-sorte="${e(x.sorte)}"><span class="plume-etiquette">${e(SORTES[x.sorte] || "Remarque")}</span>
            ${x.citation ? `<q>${e(x.citation)}</q>` : ""}<span class="plume-remarque">${e(x.texte)}</span></li>`).join("")}</ol>` : ""}
        ${version}
        <p class="plume-actions">${r.version ? `<button type="button" class="secondaire" data-plume="remplacer" data-id="${e(d.id)}">Remplacer le passage</button>` : ""}
          <button type="button" class="lien-passage" data-plume="ignorer" data-id="${e(d.id)}">Ignorer</button></p>
        ${this.htmlReste()}
      </article>`;
  }

  htmlFait(f) {
    return `<div class="plume-fait"><p>${e(f.quoi)} Il s'enregistre avec votre brouillon ; rien ne part au MJ sans vous.</p>
      <p class="plume-actions"><button type="button" class="secondaire" data-plume="defaire">Défaire</button>
        <button type="button" class="lien-passage" data-plume="fermer">Fermer</button></p></div>`;
  }

  // ------------------------------------------------------------ gestes

  async clic(ev, cle) {
    const b = ev.target.closest("[data-plume]");
    if (!b || b.disabled) return;
    const lieu = this.passages.get(cle);
    if (!lieu) return;
    const geste = b.dataset.plume;
    if (geste === "proposer" || geste === "relire") return this.demander(cle, geste);
    if (geste === "question") {
      const q = lieu.zone.querySelector(".plume-question");
      q.hidden = !q.hidden;
      b.setAttribute("aria-expanded", String(!q.hidden));
      if (!q.hidden) q.querySelector("input").focus();
      return;
    }
    if (geste === "annuler") {
      b.disabled = true;
      try {
        await demander("DELETE", `/api/demandes/${encodeURIComponent(b.dataset.id)}`);
      } catch (err) {
        this.erreurs.set(cle, `Rien d'annulé : ${err.message}`);
      }
      return this.relire();
    }
    if (geste === "ignorer") {
      this.ecarter(b.dataset.id);
      return this.dessiner(cle);
    }
    if (geste === "fermer") {
      this.faits.delete(cle);
      return this.dessiner(cle);
    }
    if (geste === "defaire") {
      const f = this.faits.get(cle);
      if (f) lieu.passage.ecrire(f.avant);
      this.faits.delete(cle);
      return this.dessiner(cle);
    }
    if (geste === "inserer" || geste === "remplacer") return this.poser(cle, geste, b.dataset.id);
  }

  ecarter(id) {
    if (!id) return;
    this.ecartees.add(id);
    try {
      localStorage.setItem(ECARTEES, JSON.stringify([...this.ecartees].slice(-30)));
    } catch {
      // stockage refusé (navigation privée) : ignorée pour cette page seulement
    }
  }

  // Insérer ou remplacer : le texte entre dans le champ comme une frappe du joueur (histoire.js l'enregistre), et
  // « Défaire » rétablit celui d'avant.
  poser(cle, geste, id) {
    const lieu = this.passages.get(cle);
    const d = (this.etat?.reponses || []).find((x) => x.id === id);
    if (!lieu || !d?.reponse) return;
    const avant = lieu.passage.lire();
    const ajout = d.mode === "proposer" ? d.reponse.texte : d.reponse.version;
    if (!ajout) return;
    const apres = geste === "inserer" && net(avant) ? `${avant.replace(/\s+$/, "")}\n\n${ajout}` : ajout;
    const max = Number(lieu.zone.closest(".passage")?.querySelector("textarea")?.maxLength) || 8000;
    if (apres.length > max) {
      this.erreurs.set(cle, `Votre passage dépasserait ${max} signes : raccourcissez-le d'abord, ou remplacez-le.`);
      return this.dessiner(cle);
    }
    this.erreurs.delete(cle);
    lieu.passage.ecrire(apres);
    this.ecarter(id);
    this.faits.set(cle, { avant, quoi: geste === "inserer" ? "Ajouté à votre passage." : "Votre passage est remplacé." });
    this.dessiner(cle);
  }

  async demander(cle, mode) {
    const lieu = this.passages.get(cle);
    if (!lieu || this.envoi !== null || this.frein() || this.etat?.en_cours) return;
    const champQuestion = lieu.zone.querySelector(".plume-question input");
    const question = lieu.zone.querySelector(".plume-question").hidden ? "" : champQuestion.value.trim();
    this.envoi = cle;
    this.mode = mode;
    this.erreurs.delete(cle);
    this.faits.delete(cle);
    this.toutDessiner();
    try {
      const r = await demander("POST", "/api/aide", { mode, champ: cle, texte: lieu.passage.lire(), question });
      this.envoi = null;
      // La question part avec la demande : sa ligne se referme, vide, pour la suivante.
      champQuestion.value = "";
      lieu.zone.querySelector(".plume-question").hidden = true;
      lieu.zone.querySelector("[data-plume=question]").setAttribute("aria-expanded", "false");
      this.prendre(r);
    } catch (err) {
      this.envoi = null;
      this.erreurs.set(cle, err.status === 0 ? "Le coin ne répond pas : vérifiez la connexion, puis réessayez." : err.message);
      await this.relire();
      this.toutDessiner();
    }
  }
}

const plume = new Plume();
AIDE.monter = (zone, passage) => plume.monter(zone, passage);
