// Les activités entre les séances dans le coin des joueurs : le tableau de l'auberge (activites-vue.js) avec les gestes du
// joueur. Il touche une affiche : elle s'ouvre en volet, avec ses chances, quelques mots s'il veut, et « Prendre l'affiche ».
// La demande part par la file (POST /api/demandes) avec le seul jeton de l'activité ; l'atelier jette le dé sur sa fiche et
// écrit le jet et le récit dans la demande : le volet et l'affiche se relisent dès que le flux le dit (GET /api/activites)
// et montrent le dé, l'issue, le récit, puis l'or, l'objet et ce que le héros apprend quand le MJ l'a validé. Les chances
// affichées ne sont qu'un calcul pour lire. Tout texte passe par echapper.

import { echapper as e } from "../api.js";
import { demander } from "./carnet-vue.js";
import { ecouterFlux } from "./flux.js";
import { CLASSES, htmlAjustements, htmlGains, htmlJet, htmlTableau, offreDe, paragraphes, phraseOr, places, rubrique } from "./activites-vue.js";

const MOT_MAX = 300;
const prenom = (nom) => String(nom || "").split(/[\s,]+/)[0] || "votre héros";
const ROULE_MS = 1500; // le dé tarde : la section se relit d'elle-même, flux ou pas
const VU = "activites-tableau-vu"; // la dernière période dont ce joueur a vu le tableau : les affiches neuves se clouent

function lireVu() {
  try {
    return localStorage.getItem(VU) || "";
  } catch {
    return "";
  }
}
// Une période que ce joueur n'a pas encore vue : ses affiches se clouent (cette fois seulement).
function aClouer(r) {
  const cle = r?.periode?.cle || "";
  return Boolean(cle) && lireVu() !== cle;
}
function noterVu(cle) {
  try {
    localStorage.setItem(VU, cle);
  } catch {
    // rien : l'animation se rejouera
  }
}

export class MesActivites {
  constructor() {
    this.zone = null;
    this.resume = null; // l'accueil du carnet : les affiches prises de la période, en bref
    this.etat = null; // la dernière réponse de GET /api/activites
    this.ouverte = null; // le jeton de l'affiche ouverte en volet
    this.voletNeuf = false; // le volet vient de s'ouvrir : il monte (une fois, pas à chaque relecture)
    this.envoi = false;
    this.message = "";
    this.brouillons = {};
    this.vus = new Set(); // les jets déjà montrés : seul un jet neuf s'annonce
    this.enCours = null;
    this.encore = false;
    this.minuterie = 0;
    for (const sujet of ["carnet", "demandes", "pause"]) ecouterFlux(sujet, () => this.relire());
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && this.ouverte) this.fermer();
    });
    // Une autre page du carnet : le volet se referme.
    window.addEventListener("hashchange", () => {
      if (this.ouverte) this.fermer();
    });
  }

  // Le volet vit hors de la page du carnet (sa section est un contexte d'empilement) : par-dessus les boutons flottants.
  hote() {
    if (this.hoteVolet?.isConnected) return this.hoteVolet;
    const h = document.createElement("div");
    h.className = "hote-volet-activite";
    h.addEventListener("click", (ev) => this.clic(ev));
    h.addEventListener("submit", (ev) => this.soumettre(ev));
    h.addEventListener("input", (ev) => {
      if (ev.target.name) this.brouillons[ev.target.name] = ev.target.value;
    });
    document.body.appendChild(h);
    this.hoteVolet = h;
    return h;
  }

  // Posé dans la section que carnet-vue.js a dessinée (recréée à chaque affichage du carnet).
  monter(zone) {
    if (!zone) return;
    this.zone = zone;
    // Les gestes du tableau (ouvrir une affiche) ; le formulaire vit dans le volet, qui a ses propres écouteurs.
    zone.addEventListener("click", (ev) => this.clic(ev));
    // Les affiches à clouer attendent la réponse fraîche : dessinées d'abord depuis la mémoire, la relecture qui suit
    // couperait leur animation.
    if (this.etat && !aClouer(this.etat)) this.dessiner();
    this.relire();
  }

  // L'accueil du carnet : ce que le héros a pris au tableau cette période, avec ses dés, et la porte vers le tableau.
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

  activites() {
    return (this.etat?.activites || []).filter((a) => a && typeof a.id === "string");
  }

  courante(a) {
    return (this.etat?.courantes || []).find((x) => x.corps?.activite === a.id) || null;
  }

  // ------------------------------------------------------------ dessin

  dessiner() {
    const z = this.zone;
    const r = this.etat;
    if (!z?.isConnected || !r) return;
    clearTimeout(this.minuterie);
    if (!r.ouvert || !r.visible) {
      this.ouverte = null;
      this.dessinerVolet();
      z.innerHTML = '<p class="vide">Les activités ne sont plus ouvertes pour l\'instant : votre MJ les rouvre entre les séances.</p>';
      return;
    }
    if (this.ouverte && !this.activites().some((a) => a.id === this.ouverte)) this.ouverte = null;
    const clouer = aClouer(r);
    if (clouer) noterVu(r.periode.cle);
    z.innerHTML = `
      ${r.pause ? '<p class="pause-sac">Le coin est en pause : le tableau se lit, rien ne part pour l\'instant.</p>' : ""}
      <p class="refus-coin refus-activites" role="alert"${this.message && !this.ouverte ? "" : " hidden"}>${e(this.message)}</p>
      ${!r.heros ? '<p class="vide">Votre héros prendra ses affiches une fois accueilli à la tablée par le MJ.</p>' : this.htmlInvite()}
      ${htmlTableau(r.periode, this.activites(), this, { cloue: clouer })}
      ${this.htmlPassees()}`;
    this.dessinerVolet();
    // Le dé n'est pas encore jeté (l'atelier le fait dans l'instant) : la section se relit seule.
    if ((r.courantes || []).some((d) => !d.public)) this.minuterie = setTimeout(() => this.relire(), ROULE_MS);
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
    const n = this.activites().length;
    const nom = prenom(r.heros?.nom);
    const fait = courantes.length === 0 ? `${nom} n'a pris aucune affiche` : `${nom} a pris ${courantes.length === 1 ? "une affiche" : `${courantes.length} affiches`}`;
    z.hidden = false;
    z.innerHTML = `
      <header class="tete-section" id="mes-activites"><h2>Le tableau de l'auberge</h2><span class="filet" aria-hidden="true"></span><p class="sous-titre">${e(r.periode?.libelle || "")}</p></header>
      <div class="resume-tableau">
        <p>${e(fait)} sur ${n} ${e(r.periode?.libelle_court || "cette période")}.${r.periode?.renouvellement ? ` Nouvelles affiches ${e(r.periode.mode === "semaine" ? r.periode.renouvellement : "à la prochaine séance")}.` : ""}</p>
        ${courantes.map((d) => this.htmlCourante(d, "compacte")).join("")}
        <p class="vers-suite"><a href="#activites">${courantes.length ? "Retourner au tableau" : "Aller au tableau"}</a></p>
      </div>`;
    clearTimeout(this.minuterieResume);
    if (courantes.some((d) => !d.public)) this.minuterieResume = setTimeout(() => this.relire(), ROULE_MS);
  }

  htmlInvite() {
    const r = this.etat;
    const echec = r.echec ? `<p class="echec-activite"><span class="lbl">Votre dernière demande</span>${e(r.echec.resultat || "Elle n'a pas pu se faire.")}</p>` : "";
    return `${echec}<p class="invite-activites">Touchez une affiche pour la lire. ${e(prenom(r.heros?.nom))} peut prendre chacune une fois ${e(r.periode?.libelle_court || "cette période")} ; le dé se jette aussitôt, sur sa fiche, et votre MJ valide l'or ensuite.</p>`;
  }

  // ------------------------------------------------------------ ce que le coin ajoute aux affiches (activites-vue.js)

  // Les chances, au crayon sur l'affiche.
  chances(a) {
    if (!a.chances || !this.etat?.heros) return "";
    return `<p class="chances-affiche">${e(prenom(this.etat.heros.nom))} : ${e(a.chances.chances)} %</p>`;
  }

  // Le sceau d'une affiche prise : le dé et l'issue, ou le dé qui roule encore.
  sceau(a) {
    if (!a.faite) return "";
    const d = this.courante(a);
    const j = d?.public?.jet;
    if (!j) return '<span class="sceau-affiche roule" aria-label="Le dé roule"><span class="de-activite">··</span></span>';
    const neuf = !this.vus.has(`sceau-${d.id}`);
    this.vus.add(`sceau-${d.id}`);
    return `<span class="sceau-affiche ${e(CLASSES[j.issue] || "")}${neuf && d.statut === "en-attente" ? " annonce" : ""}"><span class="de-activite" aria-hidden="true">${e(String(j.de ?? "").padStart(2, "0"))}</span><span class="issue-sceau">${e(j.issue_nom || "")}</span></span>`;
  }

  bouton(a) {
    return `<button type="button" class="ouvrir-affiche" data-ouvrir="${e(a.id)}" aria-haspopup="dialog"><span class="pour-lecteur">Lire l'affiche « ${e(a.nom)} »</span></button>`;
  }

  // ------------------------------------------------------------ le volet d'une affiche

  dessinerVolet() {
    const ouvert = Boolean(this.ouverte) && Boolean(this.zone?.isConnected);
    document.documentElement.classList.toggle("volet-activite-ouvert", ouvert);
    if (!ouvert && !this.hoteVolet?.isConnected) return;
    const h = this.hote();
    const champ = h.querySelector("textarea:focus");
    const garde = champ ? { nom: champ.name, debut: champ.selectionStart } : null;
    const avaitLaMain = !garde && h.contains(document.activeElement);
    const haut = h.querySelector(".volet-affiche")?.scrollTop || 0;
    h.innerHTML = ouvert ? this.htmlVolet(this.voletNeuf) : "";
    this.voletNeuf = false;
    const v = h.querySelector(".volet-affiche");
    if (v && !garde) v.scrollTop = haut;
    // Redessiné (le dé, le flux) : le volet garde la main au clavier.
    if (v && avaitLaMain) v.focus({ preventScroll: true });
    for (const x of h.querySelectorAll("textarea[name]")) if (x.name in this.brouillons) x.value = this.brouillons[x.name];
    if (garde) {
      const neuf = h.querySelector(`[name="${CSS.escape(garde.nom)}"]`);
      neuf?.focus();
      try {
        neuf?.setSelectionRange(garde.debut, garde.debut);
      } catch {
        // rien à replacer
      }
    }
  }

  htmlVolet(monte = false) {
    const r = this.etat;
    const a = this.ouverte && this.activites().find((x) => x.id === this.ouverte);
    if (!a) return "";
    const genre = offreDe(a, Boolean(r.periode?.renouvellement));
    const kicker = [genre === "quete" ? "Quête unique" : genre === "toujours" ? "Chaque semaine" : "", a.carac_nom].filter(Boolean).join(" · ");
    const reste = places(a);
    return `
      <div class="voile-affiche" data-fermer></div>
      <section class="volet-affiche carac-${e(a.carac || "physique")} offre-${genre}${monte ? " monte" : ""}" role="dialog" aria-modal="true" aria-labelledby="volet-affiche-titre" tabindex="-1">
        <button type="button" class="fermer-affiche" data-fermer>Fermer</button>
        <p class="kicker">${e(kicker)}</p>
        <h3 id="volet-affiche-titre">${e(a.nom)}</h3>
        ${genre === "quete" && a.accroche ? `<p class="accroche-affiche">${e(a.accroche)}</p>` : ""}
        <p class="rubrique-affiche">${e(rubrique(a))}${reste ? `<span class="places-affiche">${e(reste)}</span>` : ""}</p>
        ${a.texte ? `<div class="texte-affiche">${paragraphes(a.texte)}</div>` : ""}
        ${htmlGains(a)}
        ${this.corpsDuVolet(a)}
      </section>`;
  }

  corpsDuVolet(a) {
    const r = this.etat;
    const ch = a.chances;
    const nom = prenom(r.heros?.nom);
    const chances = ch ? `<p class="chances-activite" title="${e(`${ch.carac_nom} ${ch.base}${ch.competence ? `, ${ch.competence} +${ch.bonus}` : ""}${ch.modificateur ? `, ${ch.modificateur}` : ""}`)}">Chances de ${e(nom)} : <b>${e(ch.chances)} %</b>${ch.competence ? ` <small>avec ${e(ch.competence)}</small>` : ""}</p>${htmlAjustements(ch.ajustements)}` : "";
    const refus = `<p class="refus-coin refus-activites" role="alert"${this.message ? "" : " hidden"}>${e(this.message)}</p>`;
    if (!r.heros) return `${chances}<p class="aide-sac">Votre héros prendra ses affiches une fois accueilli à la tablée par le MJ.</p>`;
    // Prise cette période : le dé, le récit, l'or et la suite restent dans le volet.
    if (a.faite) {
      const d = this.courante(a);
      return d ? this.htmlCourante(d, "carte") : `${chances}<p class="aide-sac">${e(nom)} l'a déjà prise pour cette période.</p>`;
    }
    if (a.places && a.restantes === 0) return `${chances}<p class="aide-sac">Plus de place pour cette période.</p>`;
    const champ = `mot-${a.id}`;
    return `${chances}
      <form class="choisir-activite" data-form="activite" data-id="${e(a.id)}">
        <label>Comment ${e(nom)} s'y prend <small>facultatif, pour votre MJ</small>
          <textarea name="${e(champ)}" rows="2" maxlength="${e(r.mot_max || MOT_MAX)}" placeholder="Où, avec qui, quelle rumeur…"></textarea></label>
        ${refus}
        <p class="aide-sac">Le dé se jette dès que vous prenez l'affiche.</p>
        <div class="actions-sac">
          <button type="button" class="secondaire" data-fermer>Laisser</button>
          <button type="submit" class="envoyer-coin"${this.bloque() ? " disabled" : ""}>Prendre l'affiche</button>
        </div>
      </form>`;
  }

  // L'activité de la période : le dé, le récit, l'or, l'objet, ce que le héros apprend.
  // variante : "compacte" (l'accueil du carnet : avec le nom de l'activité), "carte" (dans le volet, qui porte déjà son nom).
  htmlCourante(d, variante = "") {
    const r = this.etat;
    const a = (r.activites || []).find((x) => x.id === d.corps?.activite);
    const p = d.public;
    if (!p) {
      return `<article class="mon-activite roule${variante ? ` ${variante}` : ""}" aria-live="polite">
        ${variante === "carte" ? "" : `<h3>${e(a?.nom || "Votre activité")}</h3>`}
        <div class="jet-activite roule"><span class="de-activite" aria-hidden="true">··</span><p class="roule-activite">Le dé roule…</p></div></article>`;
    }
    const neuf = !this.vus.has(d.id);
    this.vus.add(d.id);
    const or = phraseOr(d);
    const nom = prenom(r.heros?.nom);
    return `
      <article class="mon-activite${variante ? ` ${variante}` : ""}" aria-live="polite">
        ${variante === "carte" ? "" : `<h3>${e(p.activite || a?.nom || "Votre activité")}</h3>`}
        ${htmlJet(p.jet, { annonce: neuf && d.statut === "en-attente" })}
        ${p.recit && variante !== "compacte" ? `<blockquote class="recit-activite">${paragraphes(p.recit)}</blockquote>` : ""}
        <p class="or-activite${or.attente ? " attente" : ""}">${e(or.texte)}</p>
        ${p.objet ? `<p class="objet-activite"><span class="lbl">Dans le sac de ${e(nom)}</span>${e(p.objet)}</p>` : ""}
        ${p.apprend ? `<div class="apprend-activite"><span class="lbl">Ce que ${e(nom)} apprend</span>${paragraphes(p.apprend)}</div>` : ""}
        ${d.mot ? `<p class="mot-du-mj"><span class="lbl">Votre MJ</span>${e(d.mot)}</p>` : ""}
      </article>`;
  }

  htmlPassees() {
    const liste = this.etat?.passees || [];
    if (!liste.length) return "";
    return `<div class="gestes-sac passees-activites"><h5>Vos affiches d'avant</h5><ol>${liste.map((d) => {
      const p = d.public || {};
      const j = p.jet || {};
      return `<li class="geste-sac statut-${e(d.statut)}">
        <p><span class="quoi">${e(p.activite || "Une activité")}</span><span class="statut">${e(j.issue_nom || d.statut_dit)}</span></p>
        <p class="periode-passee">${e(p.periode_libelle || "")}</p>
        <p class="resultat-demande">${e(phraseOr(d).texte)}</p>
        ${p.objet ? `<p class="apprend-passe"><span class="lbl">Dans le sac</span>${e(p.objet)}</p>` : ""}
        ${p.apprend ? `<p class="apprend-passe"><span class="lbl">Appris</span>${e(p.apprend)}</p>` : ""}
        ${d.mot ? `<p class="mot-du-mj"><span class="lbl">Votre MJ</span>${e(d.mot)}</p>` : ""}
      </li>`;
    }).join("")}</ol></div>`;
  }

  // ------------------------------------------------------------ gestes

  dire(message) {
    this.message = message || "";
    for (const p of [...(this.zone?.querySelectorAll(".refus-activites") || []), ...(this.hoteVolet?.querySelectorAll(".refus-activites") || [])]) {
      const ici = Boolean(this.ouverte) === Boolean(p.closest(".volet-affiche"));
      p.textContent = this.message;
      p.hidden = !this.message || !ici;
    }
  }

  ouvrir(id) {
    this.ouverte = id;
    this.voletNeuf = true;
    this.message = "";
    this.dessiner();
    // Le volet prend la main au clavier ; le champ attend un toucher (le clavier du téléphone ne s'ouvre pas tout seul).
    this.hoteVolet?.querySelector(".volet-affiche")?.focus({ preventScroll: true });
  }

  fermer() {
    const id = this.ouverte;
    this.ouverte = null;
    this.message = "";
    this.dessiner();
    this.dessinerVolet();
    if (id) this.zone?.querySelector(`[data-ouvrir="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }

  clic(ev) {
    if (ev.target.closest("[data-fermer]")) return this.fermer();
    const b = ev.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.ouvrir) this.ouvrir(b.dataset.ouvrir);
  }

  async soumettre(ev) {
    const form = ev.target.closest('[data-form="activite"]');
    if (!form) return;
    ev.preventDefault();
    if (this.bloque()) return;
    const champ = form.querySelector("textarea");
    this.envoi = true;
    this.dire("");
    try {
      const d = await demander("POST", "/api/demandes", { genre: "activite", corps: { activite: form.dataset.id, mot: champ.value.trim() } });
      if (this.etat) {
        this.etat.courantes = [d, ...(this.etat.courantes || [])];
        const faite = (this.etat.activites || []).find((x) => x.id === form.dataset.id);
        if (faite) faite.faite = true;
      }
      delete this.brouillons[champ.name];
    } catch (err) {
      this.message = err.status === 423 ? err.message : `Rien n'est parti : ${err.message}`;
    } finally {
      this.envoi = false;
      // Le volet reste ouvert : le dé y roule, puis le récit y tombe.
      this.dessiner();
      this.relire();
    }
  }
}
