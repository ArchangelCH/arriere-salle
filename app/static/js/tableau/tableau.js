// Le tableau du MJ : un panneau ouvert depuis l'en-tête (bouton « Tableau »), sur n'importe quelle page, qui pousse la
// page sur le côté au lieu de la couvrir (plan et TV restent sous les yeux). Pendant un combat, le combat lui-même en
// version serrée (combats/combat.js, mode compact) : la main, la Santé et la Psy en barres, les cartons et le jeton
// d'un clic, ce que chacun vaut en combat ; hors combat, l'état du moment de la tablée, et les adversaires posés sur le
// plan ouvert, avec leur profil du bestiaire. Tout se lit dans etat-jeu.js, relu toutes les cinq secondes : un coup
// noté sur l'iPad paraît ici. Un nom touché retrouve son pion sur le plan ouvert.

import { accorderEnfants } from "../commun/accorder.js";
import { api, echapper as e, toast } from "../api.js";
import { champsChanges, corpsDuSac, poserEtat } from "../aventuriers/etat.js";
import { ecouterSacs } from "../ecran-tv/canal-table.js";
import { cartonApres, htmlCartons } from "../combats/barre.js";
import { Combat, htmlJeton, statsHeros } from "../combats/combat.js";
import { accepterMort } from "../combats/repere-mort.js";
import { NOMS_RANGS } from "../combats/bestiaire.js";
import { accord, profil } from "../combats/rencontre.js";
import { santeAdversaire } from "../combats/simulation.js";
import {
  AVANTAGES, POSTURES_COMBAT, jetonApres, prenom, saisiePsy, saisieSante, santePosee, seuilMort,
} from "../combats/suivi.js";
import { annoncerEtatJeu, ecouterEtatJeu, planCourant, relireEtatJeu } from "../commun/etat-jeu.js";
import { Horloges } from "../horloges/horloges.js";
import { etatHerosDuJeu } from "../plan/jauges.js";
// Lot H2 : les états des pions, lus sur le plan ouvert.
import { htmlEtatsPion, pionDuHeros } from "./etats-pions.js";
import { MainsDuTableau } from "../salle/mains-tableau.js";
// ---- Les jets à distance ----
import { JetsDuTableau } from "../jets/jets-tableau.js";
import { LanceurMJ } from "../jets/des-mj.js";
import { Impro } from "./impro.js";
import { Projecteur } from "./projecteur.js";
import { SeanceDuTableau } from "./seance.js";

const MEMOIRE = "tableau.ouvert";
const signe = (n) => String(n).replace("-", "−");
const couleurSure = (c) => (/^#[0-9a-fA-F]{3,8}$/.test(c || "") ? c : "#8a6a34");
const couleurSante = (k) => (k > 0.6 ? "#6aa84f" : k > 0.3 ? "#d9a13b" : "#c8372d");
const part = (v, max) => (max > 0 ? Math.max(0, Math.min(1, v / max)) : 0);
const NOMS_POSTURES = Object.fromEntries(POSTURES_COMBAT);

function lireMemoire() {
  try {
    return localStorage.getItem(MEMOIRE) === "oui";
  } catch {
    return false;
  }
}

function garderMemoire(oui) {
  try {
    localStorage.setItem(MEMOIRE, oui ? "oui" : "non");
  } catch {
    // préférence perdue, sans conséquence
  }
}

// La barre, le chiffre et la case de saisie d'une Santé ou d'une Psy (mêmes classes que le combat compact).
function htmlJauge(genre, v, max, cle, nom, extra = "") {
  const k = part(v, max);
  const libelle = genre === "psy" ? "Psy" : "Santé";
  const aide = genre === "psy" ? `Psy de ${nom} : -2 paie un don, +1 rend, =3 fixe` : `Santé de ${nom} : -4, +3 ou =7`;
  return `<div class="tc-jauge ${genre}">
        <span class="libelle">${libelle}</span>
        <span class="tc-barre" aria-hidden="true"><i style="width:${Math.round(k * 100)}%;background:${genre === "psy" ? "#5b8fe0" : couleurSante(k)}"></i></span>
        <output>${e(signe(v))}<small>/${max}</small></output>
        ${cle ? `<input class="saisie" type="text" inputmode="text" autocomplete="off" data-tb-saisie="${cle}" placeholder="${genre === "psy" ? "ex. -2" : "ex. -4"}" aria-label="${e(aide)}">` : ""}${extra}
      </div>`;
}

// L'or de la bourse, hors combat, comme dans le sac de « La compagnie » : « +5 » ajoute, « -3 » retire, « =40 » fixe.
function htmlOr(fiche, nom) {
  const or = typeof fiche.or === "number" && Number.isFinite(fiche.or) ? Math.round(fiche.or) : 0;
  return `<div class="tc-jauge or">
        <span class="libelle">Or</span>
        <span class="tc-or-unite">pièces d'or</span>
        <output>${e(or)}</output>
        <input class="saisie" type="text" inputmode="text" autocomplete="off" data-tb-or placeholder="ex. +5" aria-label="${e(`Or de ${nom} : +5 ajoute, -3 retire, =40 fixe`)}">
      </div>`;
}

export class Tableau {
  constructor(entete) {
    this.bouton = entete.querySelector(".ouvrir-tableau");
    if (!this.bouton) return;
    this.jeu = null;
    this.combat = null; // le combat compact monté, pour sa séance
    this.seanceMontee = "";
    this.montage = Promise.resolve();
    this.envois = Promise.resolve();
    this.campagne = null;
    this.pnj = null;
    this.panneau = document.createElement("aside");
    this.panneau.className = "tableau-mj";
    this.panneau.id = "tableau-mj";
    this.panneau.setAttribute("aria-label", "Tableau du MJ");
    this.panneau.hidden = true;
    this.panneau.innerHTML = `
      <header class="tableau-tete">
        <h2>Tableau</h2>
        <button type="button" class="fermer" data-tb="fermer" title="Fermer le tableau" aria-label="Fermer le tableau">×</button>
      </header>
      <div class="tableau-seance" hidden></div>
      <div class="tableau-combat" hidden></div>
      <div class="tableau-horloges"></div>
      <div class="tableau-hors"></div>`;
    document.body.append(this.panneau);
    this.zoneCombat = this.panneau.querySelector(".tableau-combat");
    this.zoneHors = this.panneau.querySelector(".tableau-hors");
    // Les horloges de la menace (horloges.js), entre le combat et la compagnie ; leur touche H vaut sur toute page.
    this.horloges = new Horloges(this.panneau.querySelector(".tableau-horloges"));
    // Sous la compagnie : qui attend son moment, et de quoi improviser quand la table sort du scénario (tableau/).
    this.aides = [new Projecteur(this.panneau), new Impro(this.panneau)];
    // En tête, le fil de la séance du jour : la scène en cours, la suivante et « Jouer » (tableau/seance.js).
    this.aides.push(new SeanceDuTableau(this.panneau.querySelector(".tableau-seance")));
    // Tout en tête, les mains levées depuis le coin des joueurs et qui y est en ligne ; leur signe sur le bouton Tableau
    // se voit Tableau fermé (salle/mains-tableau.js).
    this.aides.push(new MainsDuTableau(this.panneau, this.bouton));
    // ---- Les jets à distance : sous les mains levées, les derniers tests et « Demander un test » (jets/). ----
    this.aides.push(new JetsDuTableau(this.panneau));
    // Les dés du MJ (lot du 12/11, jets/des-mj.js) : toujours là, sous les tests à distance (qui, eux, se retirent).
    this.aides.push(new LanceurMJ(this.panneau, { avant: this.panneau.querySelector(".jets-tableau") }));
    // Le pied du Tableau, que d'autres modules remplissent (rappel des touches…), toujours en dernier.
    this.pied = document.createElement("footer");
    this.pied.className = "tableau-pied";
    this.pied.hidden = true;
    this.panneau.append(this.pied);
    this.bouton.setAttribute("aria-controls", "tableau-mj");
    this.bouton.setAttribute("aria-expanded", "false");
    this.bouton.addEventListener("click", () => (this.ouvert ? this.fermer() : this.ouvrir()));
    this.panneau.querySelector('[data-tb="fermer"]').addEventListener("click", () => this.fermer());
    this.zoneHors.addEventListener("click", (ev) => this.clic(ev));
    this.zoneHors.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.isComposing && ev.target.dataset.tbSaisie) {
        ev.preventDefault();
        this.saisir(ev.target);
      }
      if (ev.key === "Enter" && !ev.isComposing && ev.target.dataset.tbOr !== undefined) {
        ev.preventDefault();
        this.payer(ev.target);
      }
    });
    this.zoneHors.addEventListener("change", (ev) => {
      if (ev.target.dataset.tbSaisie && ev.target.value.trim()) this.saisir(ev.target);
      if (ev.target.dataset.tbOr !== undefined && ev.target.value.trim()) this.payer(ev.target);
    });
    // La page change : la section « Sur ce plan » suit, et le combat compact se retire de sa propre page.
    window.addEventListener("hashchange", () => this.ouvert && setTimeout(() => this.jeu && this.recu(this.jeu), 400));
    if (lireMemoire()) this.ouvrir();
  }

  ouvrir() {
    this.ouvert = true;
    this.panneau.hidden = false;
    document.body.classList.add("tableau-ouvert");
    this.bouton.setAttribute("aria-expanded", "true");
    this.bouton.setAttribute("aria-pressed", "true");
    garderMemoire(true);
    if (!this.campagne) api.get("/api/campagne").then((c) => { this.campagne = c; this.afficherHors(); }).catch(() => {});
    for (const a of this.aides) a.ouvrir();
    if (!this.fin) this.fin = ecouterEtatJeu((jeu) => this.recu(jeu));
    // Un joueur a changé un sac depuis son téléphone (une bourse, par un don d'or) : les fiches se relisent.
    if (!this.finSacs) this.finSacs = ecouterSacs(() => relireEtatJeu({ fiches: true }));
    this.afficherHors();
    this.horloges.ouvrir();
  }

  async fermer() {
    this.ouvert = false;
    this.fin?.();
    this.fin = null;
    this.finSacs?.();
    this.finSacs = null;
    this.panneau.hidden = true;
    document.body.classList.remove("tableau-ouvert");
    this.bouton.setAttribute("aria-expanded", "false");
    this.bouton.setAttribute("aria-pressed", "false");
    garderMemoire(false);
    this.horloges.fermer();
    for (const a of this.aides) a.fermer();
    await this.demonter();
  }

  // ---------------------------------------------------------------- le combat compact

  recu(jeu) {
    this.jeu = jeu;
    const seance = jeu?.combat ? jeu.seance : "";
    this.montage = this.montage.then(() => this.monter(seance)).catch((err) => console.error(err));
    this.afficherHors();
    for (const a of this.aides) a.recu(jeu);
  }

  // Sur la page de ce combat, le tableau ne le tient pas une seconde fois (deux copies se contrediraient) : il y renvoie.
  surSaPage(seance) {
    return !!seance && decodeURIComponent((location.hash.split("?")[0] || "")) === `#/combat/${seance}`;
  }

  async monter(seance) {
    if (!this.ouvert) return;
    if (this.surSaPage(seance)) {
      await this.demonter();
      this.zoneCombat.hidden = false;
      this.zoneCombat.innerHTML = '<p class="tc-calme">Le combat est ouvert sur cette page : le tableau le reprend dès que vous la quittez.</p>';
      return;
    }
    if (seance && seance === this.seanceMontee && this.combat) {
      // Le même combat : il se relit s'il a changé ailleurs (il garde ce qu'il n'a pas encore envoyé).
      return this.combat.relire();
    }
    await this.demonter();
    if (!seance || !this.ouvert) return;
    this.seanceMontee = seance;
    this.zoneCombat.hidden = false;
    this.combat = new Combat(this.zoneCombat, { seance, compact: true });
    try {
      await this.combat.demarrer();
    } catch (err) {
      this.zoneCombat.innerHTML = `<p class="vide">Combat illisible : ${e(err.message)}</p>`;
    }
  }

  async demonter() {
    const c = this.combat;
    this.combat = null;
    this.seanceMontee = "";
    this.zoneCombat.hidden = true;
    if (c) {
      try {
        await c.detruire();
      } catch (err) {
        toast(`Combat non enregistré : ${err.message}`, "erreur");
      }
    }
    this.zoneCombat.innerHTML = "";
  }

  // ---------------------------------------------------------------- hors combat

  afficherHors() {
    if (!this.ouvert) return;
    const neuf = document.createElement("div");
    neuf.innerHTML = this.htmlHors();
    accorderEnfants(this.zoneHors, neuf);
    // Une case vidée par l'accord garde ce qu'on y tape ; une case quittée reprend sa valeur vide.
    for (const el of this.zoneHors.querySelectorAll("input.saisie")) if (el !== document.activeElement) el.value = "";
  }

  // Les héros de la tablée (ceux du combat en cours sont dans le combat) et, sur un plan, les adversaires qui y sont posés.
  tablee() {
    return (this.jeu?.fiches || []).filter((a) => a.tablee !== false).sort((a, b) => (a.cree || "").localeCompare(b.cree || ""));
  }

  htmlHors() {
    const jeu = this.jeu;
    if (!jeu) return '<p class="vide">Lecture…</p>';
    const enCombat = !!jeu.combat;
    const auCombat = new Set((jeu.combat?.heros || []).map((h) => h.id));
    const heros = this.tablee().filter((a) => !auCombat.has(a.id));
    const plan = planCourant();
    const adversaires = !enCombat && plan ? this.adversairesDuPlan(plan) : [];
    return `
      ${enCombat ? "" : `<p class="tc-calme">Aucun combat en cours. Il se lance depuis Séances › Jouer ou l'onglet Combats, et paraît ici aussitôt.</p>`}
      ${heros.length ? `
      <section class="tc-groupe">
        <h3>${enCombat ? "Hors du combat" : "La compagnie"}</h3>
        ${heros.map((a) => this.htmlHeros(a)).join("")}
      </section>` : enCombat ? "" : '<p class="vide">La tablée est vide.</p>'}
      ${adversaires.length ? `
      <section class="tc-groupe">
        <h3>Sur ce plan</h3>
        ${adversaires.map((x) => this.htmlAdversaire(x)).join("")}
        <p class="aide">Profils du bestiaire pour ${this.nbPj()} aventurier${this.nbPj() > 1 ? "s" : ""}, niveau ${this.niveau()}. La Santé se suit une fois le combat lancé.</p>
      </section>` : ""}`;
  }

  nbPj() {
    return Math.max(1, this.tablee().length);
  }

  niveau() {
    return Math.max(1, +this.campagne?.niveau || 1);
  }

  htmlHeros(fiche) {
    const x = etatHerosDuJeu(fiche.id, this.jeu);
    if (!x) return "";
    const nom = fiche.nom || "Sans nom";
    const etat = x.sante <= seuilMort(x.max) ? "mort" : x.sante <= 0 ? "coma" : "debout";
    const libelle = { coma: "Coma", mort: "Repère de mort" }[etat] || "";
    const stats = statsHeros(fiche, x.posture);
    return `
      <article class="tc-ligne etat-${etat}" data-tb-heros="${e(fiche.id)}">
        <button type="button" class="tc-qui" data-tb="pion" title="Retrouver son pion sur le plan">
          <span class="puce-heros" style="background:${e(couleurSure(fiche.couleur))}"></span><b>${e(nom)}</b>${NOMS_POSTURES[x.posture] ? `<small>${e(NOMS_POSTURES[x.posture])}</small>` : ""}${libelle ? `<span class="etat">${libelle}</span>` : ""}${htmlEtatsPion(pionDuHeros(planCourant(), fiche.id))}
        </button>
        ${htmlJauge("sante", x.sante, x.max, "sante", nom, x.santeDon ? `<small class="don" title="Payés faute de Psy : ils ne reviennent qu'après une journée entière de repos.">dont ${x.santeDon} en dons</small>` : "")}
        ${x.psyMax ? htmlJauge("psy", x.psy, x.psyMax, "psy", nom) : ""}
        ${htmlOr(fiche, nom)}
        <div class="tc-marques">
          ${htmlCartons(fiche.id, nom, x.cartons)}
          ${htmlJeton(fiche.id, nom, AVANTAGES[x.avantage] ? x.avantage : "")}
        </div>
        ${stats ? `<p class="tc-stats">${e([stats.caracs.join(" · "), stats.defense, stats.armure].join(" · "))}${stats.armes.length ? `<br>${e(stats.armes.join(" ; "))}` : ""}</p>` : ""}
      </article>`;
  }

  // Les adversaires posés sur le plan, chacun avec son profil : celui du bestiaire (pion posé depuis le bestiaire ou une
  // rencontre), ou celui de sa fiche de PNJ.
  adversairesDuPlan(plan) {
    const liste = [];
    for (const t of plan.pions || []) {
      if (t.genre !== "ennemi") continue;
      const [genre, cle] = String(t.ref || "").split(":");
      let a = null;
      if (genre === "bestiaire" && cle) a = profil({ cle });
      else if (genre === "pnj" && cle) {
        if (this.pnj === null) {
          this.pnj = [];
          api.get("/api/pnj").then((l) => { this.pnj = l; this.afficherHors(); }).catch(() => {});
        }
        const q = this.pnj.find((x) => x.id === cle);
        const pr = q?.profil || {};
        a = q ? { nom: q.nom, rang: q.rang || "", att: +pr.attaque || 0, degats: pr.degats || "", armure: +pr.armure || 0, sante: String(pr.sante ?? ""), defenseTexte: pr.defense || "", capacites: "" } : null;
      }
      if (!a) a = { nom: t.nom || "Adversaire" };
      liste.push({ t, a });
    }
    return liste;
  }

  htmlAdversaire({ t, a }) {
    const { sante } = a.sante ? santeAdversaire(a.sante, this.nbPj(), this.niveau()) : { sante: 0 };
    const defense = a.defenseTexte || (+a.nbDef ? `${+a.nbDef} × ${+a.defense || 0} %` : "aucune");
    const profilTexte = a.att ? [`Att. ${+a.att} %${(+a.attaques || 1) > 1 ? ` ×${+a.attaques}` : ""}`, `${a.degats || "?"}${a.ignoreArmure ? ", ignore l'armure" : ""}`,
      `Arm. ${+a.armure || 0}${+a.bouclier ? ` +${+a.bouclier}` : ""}`, `Déf. ${defense}`].join(" · ") : "Pas de profil : posez-le depuis le bestiaire ou une rencontre.";
    return `
      <article class="tc-ligne tc-adversaire${t.tombe ? " etat-tapis" : ""}" data-tb-pion="${e(t.id)}">
        <button type="button" class="tc-qui" data-tb="pion" title="Retrouver son pion sur le plan">
          ${t.court ? `<span class="pion">${e(t.court)}</span>` : ""}<b>${e(t.nom || a.nom || "Adversaire")}</b>${NOMS_RANGS[a.rang] ? `<small>${e(NOMS_RANGS[a.rang])}</small>` : ""}${t.cache ? '<span class="cache">caché</span>' : ""}${htmlEtatsPion(t)}
        </button>
        ${sante ? `<p class="tc-stats"><b>Santé ${sante}</b> · ${e(profilTexte)}</p>` : `<p class="tc-stats">${e(profilTexte)}</p>`}
        ${a.capacites ? `<p class="tc-capacites">${e(a.capacites)}</p>` : ""}
      </article>`;
  }

  // ---------------------------------------------------------------- gestes hors combat

  ficheDe(el) {
    const id = el.closest("[data-tb-heros]")?.dataset.tbHeros;
    return id ? this.tablee().find((a) => a.id === id) || null : null;
  }

  clic(ev) {
    const b = ev.target.closest("button");
    if (!b) return;
    // Touché à la souris, le bouton ne garde pas le focus : Entrée ne rejoue pas le geste.
    if (ev.detail) b.blur();
    if (b.dataset.tb === "pion") {
      const id = b.closest("[data-tb-heros]")?.dataset.tbHeros;
      const pion = b.closest("[data-tb-pion]")?.dataset.tbPion;
      if (id) window.dispatchEvent(new CustomEvent("tableau-pion", { detail: { heros: id } }));
      else if (pion) window.dispatchEvent(new CustomEvent("tableau-pion", { detail: { pion } }));
      return;
    }
    const fiche = this.ficheDe(b);
    if (!fiche) return;
    const x = etatHerosDuJeu(fiche.id, this.jeu);
    if (!x || x.auCombat) return;
    if (b.dataset.action === "carton") {
      const k = b.dataset.carac;
      const v = cartonApres(x.cartons?.[k]);
      const apres = { ...x, cartons: { ...x.cartons } };
      if (v) apres.cartons[k] = v;
      else delete apres.cartons[k];
      return this.noter(fiche, champsChanges(x, apres));
    }
    if (b.dataset.action === "jeton") return this.noter(fiche, champsChanges(x, { ...x, avantage: jetonApres(x.avantage, b.dataset.jeton) }));
  }

  // L'or hors combat : le geste du sac de « La compagnie » (corpsDuSac), envoyé avec la valeur d'avant. Refusé parce
  // qu'un autre écran a changé la bourse entre-temps, il se rejoue sur la fiche relue (trois fois au plus).
  async payer(champ) {
    const texte = champ.value.trim();
    let fiche = this.ficheDe(champ);
    if (!fiche || !texte || champ.dataset.envoi) return;
    champ.dataset.envoi = "1";
    champ.value = "";
    try {
      for (let essai = 0; essai < 3; essai++) {
        const corps = corpsDuSac(fiche, { genre: "or", texte });
        if (corps.erreur) return toast(corps.erreur, "erreur");
        if (!corps.or) return;
        try {
          const lue = await api.patch(`/api/aventuriers/${encodeURIComponent(fiche.id)}/sac`, corps);
          this.poserFiche(lue);
          toast(`${prenom(lue.nom || fiche.nom)} : ${corps.or.avant ?? 0} → ${lue.or} pièces d'or.`);
          // Les autres vues de la page (« La compagnie ») relisent la bourse ; l'état du jeu relit les fiches.
          window.dispatchEvent(new CustomEvent("etat-jeu-change", { detail: { source: this } }));
          relireEtatJeu({ fiches: true });
          return;
        } catch (err) {
          if (err.status !== 409 || essai === 2) return toast(`Or non enregistré : ${err.message}`, "erreur");
          fiche = await api.get(`/api/aventuriers/${encodeURIComponent(fiche.id)}`);
          this.poserFiche(fiche);
        }
      }
    } catch (err) {
      toast(`Or non enregistré : ${err.message}`, "erreur");
    } finally {
      delete champ.dataset.envoi;
    }
  }

  // Une fiche relue ou renvoyée par le serveur prend sa place dans l'état lu, et la ligne se redessine.
  poserFiche(fiche) {
    const liste = this.jeu?.fiches;
    if (!fiche?.id || !Array.isArray(liste)) return;
    const i = liste.findIndex((a) => a.id === fiche.id);
    if (i >= 0) liste[i] = fiche;
    this.afficherHors();
  }

  // La Santé et la Psy hors combat : les mêmes saisies et les mêmes rappels du kit que dans la compagnie.
  async saisir(champ) {
    const fiche = this.ficheDe(champ);
    const x = fiche && etatHerosDuJeu(fiche.id, this.jeu);
    if (!x || x.auCombat) return;
    const qui = prenom(fiche.nom);
    let apres;
    if (champ.dataset.tbSaisie === "psy") {
      const lu = saisiePsy(champ.value, x, fiche);
      if (!lu) return toast("Saisie illisible : « -2 » ou « 2 » paie un don, « +1 » rend, « =3 » fixe.", "erreur");
      const { sante, preleve, ...psy } = lu;
      apres = { ...x, ...psy };
      if (preleve) {
        if (!(await this.accepteMort(qui, x, sante, " en payant ce don", champ))) return;
        toast(`${x.psy ? `${qui} paie ${x.psy} Psy et ${preleve} Santé` : `${qui} n'a plus de Psy : ${preleve} Santé en moins`}. Cette Santé ne revient qu'après une journée entière de repos.`);
        apres = this.poserSante(qui, apres, sante);
      }
    } else {
      const lu = saisieSante(champ.value, x);
      if (!lu) return toast("Saisie illisible : « -4 » ou « 4 » retire, « +3 » rend, « =7 » fixe.", "erreur");
      if (!(await this.accepteMort(qui, x, lu.sante, "", champ))) return;
      apres = this.poserSante(qui, x, lu.sante);
    }
    champ.value = "";
    this.noter(fiche, champsChanges(x, apres));
  }

  accepteMort(qui, x, valeur, pourquoi = "", champ = null) {
    return accepterMort(qui, x, valeur, pourquoi, champ);
  }

  poserSante(qui, x, valeur) {
    const { heros, coma, reveil } = santePosee(x, valeur);
    if (coma) toast(`${qui} tombe dans le coma.`);
    if (reveil) toast(`${qui} se réveille, avec un carton jaune en Physique.`);
    return heros;
  }

  // Le geste paraît tout de suite (ici et sur les pions), puis part ; un héros entré au combat ailleurs entre-temps : refus 409.
  noter(fiche, champs) {
    if (!Object.keys(champs).length) return;
    const etats = { ...(this.jeu?.etats || {}), [fiche.id]: poserEtat(this.jeu?.etats?.[fiche.id], champs) };
    annoncerEtatJeu({ etats }, { relire: false, source: this });
    this.envois = this.envois.then(async () => {
      try {
        await api.patch(`/api/etats-heros/${encodeURIComponent(fiche.id)}`, champs);
      } catch (err) {
        toast(`${prenom(fiche.nom)} : ${err.message}`, "erreur");
      }
      annoncerEtatJeu({}, { source: this });
    });
  }
}
