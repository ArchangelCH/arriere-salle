// Les activités entre les séances dans le coin des joueurs : la section du carnet (activites-vue.js) avec les gestes
// du joueur. Il choisit l'activité de son héros pour la période, avec quelques mots s'il veut ; la demande part par la
// file (POST /api/demandes) avec le seul jeton de l'activité. L'atelier jette le dé sur sa fiche et écrit le jet et le récit
// dans la demande : la section se relit dès que le flux le dit (GET /api/activites) et montre le dé, l'issue, le récit,
// puis l'or quand le MJ l'a validé et ce que le héros apprend. Les chances affichées ne sont qu'un calcul pour lire.
// Tout texte passe par echapper.

import { echapper as e } from "../api.js";
import { demander } from "./carnet-vue.js";
import { ecouterFlux } from "./flux.js";
import { htmlActivite, htmlAjustements, htmlJet, phraseOr } from "./activites-vue.js";

const MOT_MAX = 300;
const paragraphes = (t) => String(t || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${e(x)}</p>`).join("");
const prenom = (nom) => String(nom || "").split(/[\s,]+/)[0] || "votre héros";
const ROULE_MS = 1500; // le dé tarde : la section se relit d'elle-même, flux ou pas

export class MesActivites {
  constructor() {
    this.zone = null;
    this.resume = null; // l'accueil du carnet : les dés de la période, en bref
    this.etat = null; // la dernière réponse de GET /api/activites
    this.ouverte = null; // le jeton de l'activité dont le petit formulaire est ouvert
    this.envoi = false;
    this.message = "";
    this.brouillons = {};
    this.vus = new Set(); // les jets déjà montrés : seul un jet neuf s'annonce
    this.enCours = null;
    this.encore = false;
    this.minuterie = 0;
    for (const sujet of ["carnet", "demandes", "pause"]) ecouterFlux(sujet, () => this.relire());
  }

  // Posé dans la section que carnet-vue.js a dessinée (recréée à chaque affichage du carnet).
  monter(zone) {
    if (!zone) return;
    this.zone = zone;
    zone.addEventListener("click", (ev) => this.clic(ev));
    zone.addEventListener("submit", (ev) => this.soumettre(ev));
    zone.addEventListener("input", (ev) => {
      if (ev.target.name) this.brouillons[ev.target.name] = ev.target.value;
    });
    if (this.etat) this.dessiner();
    this.relire();
  }

  // L'accueil du carnet : ce que le héros a fait cette période, avec ses dés, et la porte vers les autres activités.
  monterResume(zone) {
    if (!zone) return;
    this.resume = zone;
    if (this.etat) this.dessinerResume();
    this.relire();
  }

  relire() {
    if (!this.zone?.isConnected && !this.resume?.isConnected) return Promise.resolve();
    if (this.enCours) {
      this.encore = true;
      return this.enCours;
    }
    this.enCours = (async () => {
      try {
        const r = await demander("GET", "/api/activites");
        if (this.zone?.isConnected || this.resume?.isConnected) {
          this.etat = r;
          this.dessiner();
          this.dessinerResume();
        }
      } catch {
        // le carnet dit déjà si la session ne vaut plus
      }
    })().finally(() => {
      this.enCours = null;
      if (this.encore) {
        this.encore = false;
        this.relire();
      }
    });
    return this.enCours;
  }

  bloque() {
    return this.envoi || Boolean(this.etat?.pause);
  }

  // ------------------------------------------------------------ dessin

  dessiner() {
    const z = this.zone;
    const r = this.etat;
    if (!z?.isConnected || !r) return;
    clearTimeout(this.minuterie);
    if (!r.ouvert || !r.visible) {
      z.innerHTML = '<p class="vide">Les activités ne sont plus ouvertes pour l\'instant : votre MJ les rouvre entre les séances.</p>';
      return;
    }
    const champ = z.querySelector("textarea:focus");
    const garde = champ ? { nom: champ.name, debut: champ.selectionStart } : null;
    const activites = (r.activites || []).filter((a) => a && typeof a.id === "string");
    const courantes = r.courantes || [];
    z.innerHTML = `
      <p class="periode-activites"><span class="lbl">En ce moment</span>${e(r.periode?.libelle || "")}</p>
      ${r.pause ? '<p class="pause-sac">Le coin est en pause : les activités se lisent, rien ne part pour l\'instant.</p>' : ""}
      <p class="refus-coin refus-activites" role="alert"${this.message ? "" : " hidden"}>${e(this.message)}</p>
      ${!r.heros ? '<p class="vide">Votre héros choisira son activité une fois accueilli à la tablée par le MJ.</p>' : ""}
      ${r.heros ? this.htmlInvite() : ""}
      <h3 class="intertitre">Les activités de la période</h3>
      <div class="activites-liste">${activites.map((a) => htmlActivite(a, this)).join("") || '<p class="vide">Aucune activité proposée pour l\'instant.</p>'}</div>
      ${this.htmlPassees()}`;
    for (const x of z.querySelectorAll("textarea[name]")) if (x.name in this.brouillons) x.value = this.brouillons[x.name];
    if (garde) {
      const neuf = z.querySelector(`[name="${CSS.escape(garde.nom)}"]`);
      neuf?.focus();
      try {
        neuf?.setSelectionRange(garde.debut, garde.debut);
      } catch {
        // rien à replacer
      }
    }
    // Le dé n'est pas encore jeté (l'atelier le fait dans l'instant) : la section se relit seule.
    if (courantes.some((d) => !d.public)) this.minuterie = setTimeout(() => this.relire(), ROULE_MS);
  }

  dessinerResume() {
    const z = this.resume;
    const r = this.etat;
    if (!z?.isConnected || !r) return;
    if (!r.ouvert || !r.visible || !r.heros) {
      z.hidden = true;
      return;
    }
    const courantes = r.courantes || [];
    z.hidden = false;
    z.innerHTML = `
      <header class="tete-section" id="mes-activites"><h2>Mes activités</h2><span class="filet" aria-hidden="true"></span><p class="sous-titre">${e(r.periode?.libelle || "")}</p></header>
      ${courantes.length ? courantes.map((d) => this.htmlCourante(d, "compacte")).join("") : `<p class="vide">${e(prenom(r.heros?.nom))} n'a pas encore d'activité cette période.</p>`}
      <p class="vers-suite"><a href="#activites">${courantes.length ? "Les autres activités de la période" : "Choisir une activité"}</a></p>`;
    clearTimeout(this.minuterieResume);
    if (courantes.some((d) => !d.public)) this.minuterieResume = setTimeout(() => this.relire(), ROULE_MS);
  }

  htmlInvite() {
    const r = this.etat;
    const echec = r.echec ? `<p class="echec-activite"><span class="lbl">Votre dernière demande</span>${e(r.echec.resultat || "Elle n'a pas pu se faire.")}</p>` : "";
    return `${echec}<p class="invite-activites">Choisissez ce que fait ${e(prenom(r.heros?.nom))} pour cette période : toutes les activités sont à sa portée, chacune une fois. Le dé se jette aussitôt, sur sa fiche ; votre MJ valide l'or ensuite.</p>`;
  }

  // L'activité de la période : le dé, le récit, l'or, ce que le héros apprend.
  // variante : "" (le résultat en grand), "compacte" (l'accueil du carnet : avec le nom de l'activité), "carte" (dans la carte de
  // l'activité, qui porte déjà son nom).
  htmlCourante(d, variante = "") {
    const r = this.etat;
    const a = (r.activites || []).find((x) => x.id === d.corps?.activite);
    const p = d.public;
    if (!p) {
      return `<article class="mon-activite roule${variante ? ` ${variante}` : ""}" aria-live="polite">
        ${variante === "carte" ? "" : `<p class="kicker">Activité de la période</p><h3>${e(a?.nom || "Votre activité")}</h3>`}
        <p class="roule-activite">Le dé roule…</p></article>`;
    }
    const neuf = !this.vus.has(d.id);
    this.vus.add(d.id);
    const or = phraseOr(d);
    const nom = prenom(r.heros?.nom);
    return `
      <article class="mon-activite${variante ? ` ${variante}` : ""}" aria-live="polite">
        ${variante === "carte" ? "" : `<p class="kicker">Activité de la période</p>
        <h3>${e(p.activite || a?.nom || "Votre activité")}</h3>`}
        ${htmlJet(p.jet, { annonce: neuf && d.statut === "en-attente" })}
        ${p.recit && variante !== "compacte" ? `<blockquote class="recit-activite">${paragraphes(p.recit)}</blockquote>` : ""}
        <p class="or-activite${or.attente ? " attente" : ""}">${e(or.texte)}</p>
        ${p.apprend ? `<div class="apprend-activite"><span class="lbl">Ce que ${e(nom)} apprend</span>${paragraphes(p.apprend)}</div>` : ""}
        ${d.mot ? `<p class="mot-du-mj"><span class="lbl">Votre MJ</span>${e(d.mot)}</p>` : ""}
      </article>`;
  }

  htmlPassees() {
    const liste = this.etat?.passees || [];
    if (!liste.length) return "";
    return `<div class="gestes-sac passees-activites"><h5>Vos dernières activités</h5><ol>${liste.map((d) => {
      const p = d.public || {};
      const j = p.jet || {};
      return `<li class="geste-sac statut-${e(d.statut)}">
        <p><span class="quoi">${e(p.activite || "Une activité")}</span><span class="statut">${e(j.issue_nom || d.statut_dit)}</span></p>
        <p class="periode-passee">${e(p.periode_libelle || "")}</p>
        <p class="resultat-demande">${e(phraseOr(d).texte)}</p>
        ${p.apprend ? `<p class="apprend-passe"><span class="lbl">Appris</span>${e(p.apprend)}</p>` : ""}
        ${d.mot ? `<p class="mot-du-mj"><span class="lbl">Votre MJ</span>${e(d.mot)}</p>` : ""}
      </li>`;
    }).join("")}</ol></div>`;
  }

  // Sous chaque activité : les chances du héros, puis « Choisir » ou le petit formulaire.
  gestes(a) {
    const r = this.etat;
    const ch = a.chances;
    const chances = ch ? `<p class="chances-activite" title="${e(`${ch.carac_nom} ${ch.base}${ch.competence ? `, ${ch.competence} +${ch.bonus}` : ""}${ch.modificateur ? `, ${ch.modificateur}` : ""}`)}">Chances de ${e(prenom(r.heros?.nom))} : <b>${e(ch.chances)}\u00a0%</b>${ch.competence ? ` <small>avec ${e(ch.competence)}</small>` : ""}</p>${htmlAjustements(ch.ajustements)}` : "";
    if (!r.heros) return chances;
    // Faite pour cette période : son résultat et son gain restent sur la carte, et rien ne se choisit.
    if (a.faite) {
      const d = (r.courantes || []).find((x) => x.corps?.activite === a.id);
      return d ? this.htmlCourante(d, "carte") : `${chances}<p class="gestes-activite"><span class="aide-sac">Déjà faite pour cette période.</span></p>`;
    }
    const complet = a.places && a.restantes === 0;
    if (this.ouverte === a.id) {
      const nom = `mot-${a.id}`;
      return `${chances}
        <form class="choisir-activite" data-form="activite" data-id="${e(a.id)}">
          <label>Comment ${e(prenom(r.heros?.nom))} s'y prend <small>facultatif, pour votre MJ</small>
            <textarea name="${e(nom)}" rows="2" maxlength="${e(r.mot_max || MOT_MAX)}" placeholder="Où, avec qui, quelle rumeur…"></textarea></label>
          <p class="aide-sac">Le dé se jette dès que vous lancez.</p>
          <div class="actions-sac">
            <button type="button" class="secondaire" data-laisser>Laisser</button>
            <button type="submit" class="envoyer-coin"${this.bloque() ? " disabled" : ""}>Lancer le dé</button>
          </div>
        </form>`;
    }
    return `${chances}<p class="gestes-activite"><button type="button" class="secondaire" data-choisir="${e(a.id)}"${this.bloque() || complet ? " disabled" : ""}>Choisir</button>${complet ? '<span class="aide-sac">Plus de place pour cette période.</span>' : ""}</p>`;
  }

  // ------------------------------------------------------------ gestes

  dire(message) {
    this.message = message || "";
    const p = this.zone?.querySelector(".refus-activites");
    if (p) {
      p.textContent = this.message;
      p.hidden = !this.message;
      if (this.message) p.scrollIntoView({ block: "nearest" });
    }
  }

  clic(ev) {
    const b = ev.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.choisir) {
      this.ouverte = b.dataset.choisir;
      this.dire("");
      this.dessiner();
      // Le formulaire au milieu de l'écran : ni sous le clavier, ni sous le bouton flottant « Je veux agir ».
      const form = this.zone.querySelector('[data-form="activite"]');
      form?.scrollIntoView({ block: "center" });
      form?.querySelector("textarea")?.focus({ preventScroll: true });
      return;
    }
    if (b.dataset.laisser !== undefined) {
      this.ouverte = null;
      this.dire("");
      this.dessiner();
    }
  }

  async soumettre(ev) {
    const form = ev.target.closest('[data-form="activite"]');
    if (!form) return;
    ev.preventDefault();
    if (this.bloque()) return;
    const champ = form.querySelector("textarea");
    this.envoi = true;
    this.dire("");
    let ok = false;
    try {
      const d = await demander("POST", "/api/demandes", { genre: "activite", corps: { activite: form.dataset.id, mot: champ.value.trim() } });
      if (this.etat) {
        this.etat.courantes = [d, ...(this.etat.courantes || [])];
        const faite = (this.etat.activites || []).find((x) => x.id === form.dataset.id);
        if (faite) faite.faite = true;
      }
      delete this.brouillons[champ.name];
      this.ouverte = null;
      ok = true;
    } catch (err) {
      this.message = err.status === 423 ? err.message : `Rien n'est parti : ${err.message}`;
    } finally {
      this.envoi = false;
      this.dessiner();
      if (ok) this.zone?.querySelector(".mon-activite")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      this.relire();
    }
  }
}
