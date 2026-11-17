// Le combat en cours d'une séance, tenu par le MJ : l'ordre du tour selon le kit, la Santé de chacun (saisie « -4 »),
// la Psy et les cartons des héros, les rappels du kit (coma, mort, fuite des sbires) et, sur un clic, l'ordre du tour
// sur la TV. Lancé depuis une rencontre (onglet Combats, ou Jouer dans la séance). Tout vit sur le serveur avec la
// séance (routes /api/seances/<id>/combat) : un rechargement reprend où l'on en était. Les fiches des héros ne sont pas
// touchées : chacun entre au combat avec son état du moment (Santé, Psy, cartons, laissés par le combat d'avant ou par
// Séances › Jouer, routes /api/etats-heros), que le serveur tient à jour à chaque enregistrement du combat.

import { accorderEnfants } from "../commun/accorder.js";
import { api, copie, differer, echapper as e, toast } from "../api.js";
import { ecouterCombats } from "../ecran-tv/canal-table.js";
import { Reessai } from "../commun/reessai.js";
import { etatComplet, resumeEtat } from "../aventuriers/etat.js";
import { DEFENSES_PAR_TOUR, essentiel } from "../aventuriers/regles.js";
import { annoncerEtatJeu, ecouterEtatJeu } from "../commun/etat-jeu.js";
import { htmlReglageCombat } from "../musique/musique-combat.js";
import { MOTS, cartonApres, htmlBarre, htmlCartons, htmlPostures, lienSeance, minutes, versQui } from "./barre.js";
import { NOMS_RANGS } from "./bestiaire.js";
import { finirCombat, rouvrirCombat } from "./fin.js";
import { accepterMort } from "./repere-mort.js";
import { exemple, htmlRetour, noterRetour } from "./retour-saisie.js";
import { demander } from "../commun/dialogue.js";
import { htmlDesAdversaire, lancerPourAdversaire } from "../jets/des-mj.js";
import { FeuDuCombat } from "./flammes.js";
import { groupes } from "./rencontre.js";
import { manquants, planDeLaScene, planDesNumeros, poserAdversaires } from "./plan-de-scene.js";
import {
  AVANTAGES, CARACS_CARTON, ENNEMIS, POSTURES_COMBAT, SABLIER, SITUATIONS, adversairesDepuis, composerOrdre, enListe, etatHeros,
  fusionnerCombat, herosDepuis, horsDeCombat, mainChangee, moralDuCombat, nomAdversaire, nouveauCombat, phraseOrdre,
  jetonApres, precedent, prenom, psyDe, saisiePsy, saisieSante, santeDonRestante, santePosee, seuilMort, suivant,
} from "./suivi.js";
import { idsSousLaMain } from "../seances/sous-la-main.js";

// Les vues de la TV sous lesquelles le bandeau paraît (table.js) : le jeu, pas les écrans de présentation.
const VUES_BANDEAU = ["plan", "carte", "image"];
const signe = (n) => String(n).replace("-", "−");
const couleurSure = (c) => (/^#[0-9a-fA-F]{3,8}$/.test(c || "") ? c : "#8a6a34");

const pctTexte = (v) => `${Math.round(+v || 0)} %`;
const NOMS_POSTURES = Object.fromEntries(POSTURES_COMBAT);
// Deux versions du combat qui ne diffèrent que par leur version et l'écran qui l'a écrite.
const sansVersion = ({ modifie, par, ...reste }) => reste;
const pareilCombat = (a, b) => JSON.stringify(sansVersion(a || {})) === JSON.stringify(sansVersion(b || {}));
const NOMS_CARACS = Object.fromEntries(CARACS_CARTON);
const couleurSante = (k) => (k > 0.6 ? "#6aa84f" : k > 0.3 ? "#d9a13b" : "#c8372d");
const part = (v, max) => (max > 0 ? Math.max(0, Math.min(1, v / max)) : 0);

// Ce qu'un héros vaut en combat, lu dans sa fiche : caractéristiques, défense (et combien par tour dans sa posture du
// moment), armure (bouclier compté en défensive, comme sur la TV) et armes.
export function statsHeros(fiche, posture) {
  if (!fiche) return null;
  const x = essentiel(fiche);
  const p = posture || x.posture?.cle || "";
  const parTour = DEFENSES_PAR_TOUR[p];
  return {
    caracs: x.caracs.map((c) => `${c.nom.charAt(0)} ${c.valeur}`),
    // Comme pour les adversaires : « Déf. 1 × 40 % », le nombre de défenses par tour dans sa posture.
    defense: parTour === 0 ? `Déf. aucune${p ? ` (${p === "focus" ? "focus, +5 % aux tests" : p})` : ""}` : `Déf. ${typeof parTour === "number" ? `${parTour} × ` : ""}${pctTexte(x.defense)}`,
    armure: `Arm. ${x.protection.indice + (x.bouclier && p === "defensive" ? 2 : 0)}`,
    armes: x.armes.map((w) => `${w.nom}${w.nombre > 1 ? ` ×${w.nombre}` : ""} ${w.degats ? `${w.degats} ` : ""}(${pctTexte(w.valeur)})`.replace(/\s+/g, " ")),
  };
}

// Les deux boutons du jeton du kit (un seul à la fois ; l'autre l'annule).
export function htmlJeton(id, nom, actuel) {
  return `<span class="jeton-combat" role="group" aria-label="Jeton de ${e(nom)}">${Object.entries(AVANTAGES).map(([k, libelle]) => `<button type="button" class="jeton-${k}" data-action="jeton" data-id="${e(id)}" data-jeton="${k}" aria-pressed="${actuel === k}" title="${libelle}${actuel === k ? " : cliquer quand il est joué" : actuel ? " : annule l'autre jeton" : ""}">${k === "avantage" ? "+" : "−"}</button>`).join("")}</span>`;
}

// « Rouvrir le combat », depuis le message qui suit la fin : le combat revient tel qu'il était, sur sa page comme dans
// le Tableau (l'état du jeu annonce son retour), même si l'écran qui l'a fini a changé de page depuis.
async function rouvrir(infos) {
  try {
    const c = await rouvrirCombat(infos);
    toast(`« ${c.nom} » reprend : la main est ${versQui(c)}, tour ${c.tour}.`);
  } catch (err) {
    toast(`Combat non rouvert : ${err.message}.`, "erreur");
  }
}

// Le message de la fin : « Rouvrir le combat » pendant dix secondes, et « Retour à la séance » à côté.
function annoncerFin(seance, { fini, ligne, erreur }, tv) {
  const message = erreur ? `Combat fini. Bilan non noté au journal : ${erreur.message}.` : "Combat fini, bilan noté au journal.";
  const action = fini ? { libelle: MOTS.rouvrir, faire: () => rouvrir({ seance, fini, ligne, tv, par: "atelier" }) } : null;
  const t = toast(message, erreur ? "erreur" : "info", { action, duree: 10000 });
  if (!t?.append) return;
  const lien = document.createElement("a");
  lien.className = "toast-action";
  lien.href = lienSeance(seance);
  lien.textContent = MOTS.seance;
  // Une fois à la séance, le lien n'a plus lieu d'être : « Rouvrir » reste seul, le temps qu'il reste.
  lien.addEventListener("click", () => lien.remove(), { once: true });
  t.append(lien);
}

export class Combat {
  // compact : le combat dans le tableau du MJ (tableau.js), sur une autre page ; ni préparation, ni touche Entrée hors
  // de ses cases.
  constructor(racine, { seance, parametres, compact = false }) {
    this.racine = racine;
    this.idSeance = seance;
    this.compact = !!compact;
    this.idRencontre = this.compact ? "" : parametres?.get("rencontre") || "";
    this.url = `/api/seances/${encodeURIComponent(seance)}/combat`;
    this.sauver = differer(() => this.enregistrer(), 250);
    this.fileEnvois = Promise.resolve();
    this.aEnvoyer = false;
    this.enVol = 0; // envois partis, sans réponse encore
    // Serveur injoignable : le combat repart seul (3 s, 10 s, puis toutes les 30 s).
    this.reessai = new Reessai(() => this.enregistrer());
    this.combat = null;
    this.base = null; // dernière version connue du serveur
    this.tv = false;
    this.decalage = 0; // heure du serveur moins celle de cet écran, en ms
    this.prep = null;
    this.plans = null;
    this.etats = {}; // l'état du moment de chaque héros, par identifiant de fiche
    this.sablierVide = false;
    this.fini = null; // { nom, ailleurs } : le combat qui vient de finir, ici ou sur un autre écran
    this.musique = null; // { ambiances, combat } : le réglage de la musique des combats, pour la préparation
    this.detruit = false;
    this.clavier = false; // le dernier geste est une touche Tab plutôt qu'un clic : voir touche()
    // Qui se tient dans les flammes d'un plan quand la main passe (flammes.js) : relu à chaque main.
    this.flammes = new FeuDuCombat(() => this.afficher());
    this.ecoute = new AbortController();
  }

  async demarrer() {
    const id = encodeURIComponent(this.idSeance);
    const [srv, seance, rencontres, campagne, aventuriers, etats] = await Promise.all([
      ...[this.url, `/api/seances/${id}`, "/api/rencontres", "/api/campagne", "/api/aventuriers"].map((u) => api.get(u)),
      api.get("/api/etats-heros").catch(() => null),
    ]);
    if (this.detruit) return;
    this.etats = etats?.etats || {};
    this.seance = seance;
    this.rencontres = rencontres;
    this.campagne = campagne;
    this.aventuriers = aventuriers;
    this.recu(srv);
    this.combat = copie(srv.combat);
    this.base = copie(srv.combat);
    if (this.enPreparation()) await this.preparer();
    if (this.detruit) return;
    this.racine.innerHTML = `<section class="combat-page${this.compact ? " combat-compact" : ""}"></section>`;
    const zone = this.racine.querySelector(".combat-page");
    const option = { signal: this.ecoute.signal };
    zone.addEventListener("click", (ev) => this.clic(ev), option);
    zone.addEventListener("change", (ev) => this.choix(ev), option);
    zone.addEventListener("keydown", (ev) => this.toucheSaisie(ev), option);
    if (!this.compact) {
      document.addEventListener("keydown", (ev) => this.touche(ev), option);
      window.addEventListener("etat-jeu-change", (ev) => ev.detail?.source !== this && this.relire(), option);
      // Un coup joué sur un autre écran (la télécommande, l'iPad) paraît ici à la relecture suivante de l'état du jeu.
      this.finEcoute = ecouterEtatJeu((jeu) => {
        const vu = jeu?.seance === this.idSeance ? jeu.combat : null;
        if (JSON.stringify(vu) !== JSON.stringify(this.base)) this.relire();
      });
    }
    // Un geste de la télécommande ou de l'iPad : le serveur le dit tout de suite aux pages de l'atelier (canal-table.js),
    // le combat se relit sans attendre la relecture suivante de l'état du jeu.
    this.finCombats = ecouterCombats((s) => {
      if (s.seance === this.idSeance && (s.modifie ?? null) !== (this.base?.modifie ?? null)) this.relire();
    });
    this.zone = zone;
    document.addEventListener("pointerdown", () => (this.clavier = false), option);
    window.addEventListener("focus", () => this.relire(), option);
    // De retour d'un plan où l'on a bougé un pion ou rappelé une étape : les flammes se relisent.
    window.addEventListener("focus", () => this.flammes.suivre(this.vuePreparation() ? null : this.combat, true), option);
    this.minuterie = setInterval(() => this.majSablier(), 500);
    this.afficher();
  }

  detruire() {
    this.detruit = true;
    this.finEcoute?.();
    this.finCombats?.();
    clearInterval(this.minuterie);
    this.flammes.arreter();
    this.ecoute.abort();
    return this.vider();
  }

  vider() {
    if (this.aEnvoyer) this.sauver.maintenant();
    else this.sauver.annuler();
    return this.fileEnvois;
  }

  // Reste-t-il quelque chose qui n'est pas enregistré ? (l'onglet ne se ferme pas sans prévenir)
  aEnregistrer() {
    return this.aEnvoyer || this.enVol > 0 || this.sauver.enAttente();
  }

  recu(srv) {
    this.tv = !!srv.tv;
    if (typeof srv.horloge === "number") this.decalage = srv.horloge * 1000 - Date.now();
  }

  // Une rencontre demandée qui n'est pas celle du combat en cours (ou pas de combat) : on prépare.
  enPreparation() {
    return this.idRencontre ? !this.combat || this.combat.rencontre !== this.idRencontre : false;
  }

  // La préparation ne s'affiche qu'une fois prête (preparer() a lu les plans) : un combat fini ou remplacé ailleurs
  // pendant qu'on le suivait ramène à la liste des rencontres de la séance.
  vuePreparation() {
    return this.enPreparation() && !!this.prep;
  }

  rencontre() {
    return this.rencontres.find((r) => r.id === this.idRencontre) || null;
  }

  ficheDe(id) {
    return this.aventuriers.find((a) => a.id === id) || null;
  }

  // Les héros qui peuvent se battre : la tablée de la campagne (les présents de la séance cochés), puis les autres fiches.
  candidats() {
    const tablee = (this.campagne.tablee || []).filter((j) => j.actif !== false && j.aventurier);
    const presents = new Set(this.seance.presents || []);
    const deLaTablee = tablee.map((j) => {
      const fiche = this.aventuriers.find((a) => a.id === j.aventurier);
      return fiche && { fiche, couleur: fiche.couleur || j.couleur || "", present: presents.size ? presents.has(j.id) : true };
    }).filter(Boolean);
    const vus = new Set(deLaTablee.map((x) => x.fiche.id));
    const autres = this.aventuriers.filter((a) => !vus.has(a.id)).sort((a, b) => (a.cree || "").localeCompare(b.cree || ""))
      .map((fiche) => ({ fiche, couleur: fiche.couleur || "", present: false, autre: true }));
    return [...deLaTablee, ...autres];
  }

  async preparer() {
    const r = this.rencontre();
    if (!this.plans) this.plans = await api.get("/api/plans").catch(() => []);
    // La musique des combats se choisit aussi ici (même réglage que le panneau Musique).
    if (!this.musique) {
      const m = await api.get("/api/musique").catch(() => null);
      if (m) this.musique = { ambiances: Array.isArray(m.ambiances) ? m.ambiances : [], combat: m.combat ?? null };
    }
    const candidats = this.candidats();
    // Un héros dans le coma (ou au repère de mort) ne se bat pas : il n'est pas coché d'office.
    const debout = (x) => etatHeros(herosDepuis(x.fiche, x.couleur, this.etats[x.fiche.id])) === "debout";
    this.prep = {
      heros: candidats.filter((x) => x.present && debout(x)).map((x) => x.fiche.id), avant: r ? Math.max(0, Math.min(3, +r.avant || 0)) : 2, choisis: [],
      pleineForme: false,
    };
  }

  // Un héros tel qu'il entre au combat : son état du moment, ou au maximum de sa fiche si la case est cochée.
  herosPrepare(x) {
    return herosDepuis(x.fiche, x.couleur, this.prep?.pleineForme ? null : this.etats[x.fiche.id]);
  }

  // Le plan des numéros : celui de la scène qui lie la rencontre, que montre la TV, sinon celui de son lieu qui porte
  // ses adversaires (planDesNumeros, la même règle que la feuille de combat).
  planDuCombat(r) {
    return planDesNumeros(this.seance, r, this.plans || []);
  }

  // Le plan de la scène sans pion pour certains adversaires : les y poser, cachés.
  htmlPoser(r) {
    const p = planDeLaScene(this.seance, r, this.plans || []);
    const n = p ? manquants(r, p) : 0;
    if (!n) return "";
    return `
          <p class="aide">Il manque ${n} pion${n > 1 ? "s" : ""} sur « ${e(p.nom || "le plan")} », le plan de la scène. Posés cachés, ils n'apparaissent à la TV qu'une fois « Caché aux joueurs » décoché dans le plan.</p>
          <div class="actions"><button data-action="poser-adversaires" data-plan="${e(p.id)}">Poser les adversaires sur ce plan, cachés</button></div>`;
  }

  async poserSurLePlan(b) {
    const r = this.rencontre();
    if (!r) return;
    b.disabled = true;
    try {
      const { plan, poses } = await poserAdversaires(b.dataset.plan, r);
      this.plans = (this.plans || []).map((p) => (p.id === plan.id ? plan : p));
      toast(poses ? `${poses} pion${poses > 1 ? "s" : ""} posé${poses > 1 ? "s" : ""}, caché${poses > 1 ? "s" : ""}, sur « ${plan.nom} ».` : `Les adversaires sont déjà sur « ${plan.nom} ».`);
    } finally {
      b.disabled = false;
      this.afficher();
    }
  }

  // ---------------------------------------------------------------- affichage

  libelleSeance() {
    const s = this.seance;
    return [`Séance ${s.numero ?? ""}`.trim(), s.nom].filter(Boolean).join(" · ");
  }

  // Le sur-titre de la page : un lien vers la séance, ouverte sur Jouer.
  kicker(debut = "Combat") {
    return `<p class="kicker"><a class="vers-seance" href="${e(lienSeance(this.idSeance))}" title="${MOTS.seance}, onglet Jouer">${e(debut)} · ${e(this.libelleSeance())}</a></p>`;
  }

  afficher() {
    const zone = this.racine.querySelector(".combat-page");
    if (this.detruit || !zone) return;
    const neuf = document.createElement("section");
    neuf.innerHTML = this.compact ? (this.combat ? this.htmlCompact() : '<p class="vide">Le combat est fini.</p>')
      : this.vuePreparation() ? this.htmlPreparation() : this.combat ? this.htmlCombat() : this.htmlAucun();
    accorderEnfants(zone, neuf);
    this.majSablier();
    this.flammes.suivre(this.vuePreparation() ? null : this.combat);
  }

  // Plus de combat : celui qui vient de finir (ici ou sur un autre écran), et le chemin du retour vers la séance.
  htmlAucun() {
    // Celles que lient les scènes, dans l'ordre du déroulé, puis celles de « Sous la main » (seances/sous-la-main.js).
    const liste = idsSousLaMain(this.seance).rencontres.map((x) => this.rencontres.find((r) => r.id === x.id)).filter(Boolean);
    const f = this.fini;
    return `
      <header class="tete-combat">
        <div class="titre">
          ${this.kicker()}
          <h1>${f ? `« ${e(f.nom || "Le combat")} » est fini` : "Aucun combat en cours"}</h1>
          ${f ? `<p class="ordre-prevu">${f.ailleurs ? "Fini sur un autre écran. " : ""}Son bilan est noté au journal de la séance.</p>` : ""}
        </div>
        <div class="actions"><a class="bouton principal" href="${e(lienSeance(this.idSeance))}">${MOTS.seance}</a></div>
      </header>
      ${f?.combat ? this.htmlBilanFin(f.combat) : ""}
      ${liste.length ? `
      <p class="sous-titre">Les rencontres de la séance</p>
      <ul class="liste-simple rencontres-a-lancer">${liste.map((r) => `
        <li><span>${e(r.nom || "Rencontre")}</span><a class="bouton" href="#/combat/${e(this.idSeance)}?rencontre=${e(r.id)}">Préparer le combat</a></li>`).join("")}
      </ul>` : f ? `<p class="aide">Aucune autre rencontre n'est liée aux scènes de cette séance. Pour en lancer une : <a href="#/combats">Combats</a>, ou « Lier » une rencontre à une scène dans <a href="#/seances/${e(this.idSeance)}">Préparer</a>.</p>` : `<p class="vide">Aucune rencontre n'est liée à cette séance. Liez-en une à une scène dans <a href="#/seances/${e(this.idSeance)}">Préparer</a>, ou lancez un combat depuis l'onglet <a href="#/combats">Combats</a>.</p>`}`;
  }

  // Le bilan du combat qui vient de finir : durée, adversaires tombés ou en fuite ou debout, état de chaque héros. Le
  // même que celui du journal, lisible sans l'ouvrir.
  htmlBilanFin(c) {
    const adv = c.adversaires || [];
    const noms = (liste) => liste.map(nomAdversaire);
    const tapis = adv.filter((a) => a.sante <= 0);
    const fuite = adv.filter((a) => a.sante > 0 && a.fuite);
    const debout = adv.filter((a) => !horsDeCombat(a));
    const ligneAdv = (titre, liste) => (liste.length ? `<li><b>${titre}</b> ${e(enListe(noms(liste)))}</li>` : "");
    const heros = (c.heros || []).map((h) => {
      const etat = etatHeros(h);
      const p = psyDe(h, this.ficheDe(h.id));
      const cartons = CARACS_CARTON.filter(([k]) => h.cartons?.[k]).map(([k, nom]) => `carton ${h.cartons[k]} en ${nom}`);
      const morceaux = [`${signe(h.sante)} / ${h.max} Santé`, ...(p.psyMax ? [`${p.psy} / ${p.psyMax} Psy`] : []), ...cartons];
      return `<li class="etat-${etat}"><span class="puce-heros" style="background:${e(couleurSure(h.couleur))}"></span><b>${e(prenom(h.nom))}</b>${etat !== "debout" ? `<span class="etat">${etat === "mort" ? "Repère de mort" : "Coma"}</span>` : ""}<span>${e(morceaux.join(" · "))}</span></li>`;
    }).join("");
    return `
      <section class="bilan-fin" aria-label="Bilan du combat">
        <h2>Le bilan</h2>
        <p class="chiffre-fin"><b>${c.tour}</b> tour${c.tour > 1 ? "s" : ""}</p>
        <ul class="adversaires-fin">${ligneAdv("Au tapis :", tapis)}${ligneAdv("En fuite :", fuite)}${ligneAdv("Encore debout :", debout)}${adv.length ? "" : "<li>Aucun adversaire.</li>"}</ul>
        ${heros ? `<ul class="heros-fin">${heros}</ul>` : ""}
        <p class="aide">Santé, Psy et cartons restent aux héros pour la suite de la séance. Le texte complet est au journal (touche N).</p>
      </section>`;
  }

  htmlPreparation() {
    const r = this.rencontre();
    if (!r) {
      return `
        <header class="tete-combat"><div class="titre"><p class="kicker">Combat · ${e(this.libelleSeance())}</p><h1>Rencontre introuvable</h1></div></header>
        <p class="vide">Cette rencontre n'existe plus. <a href="#/combats">Retour aux combats</a></p>`;
    }
    const p = this.prep;
    const candidats = this.candidats();
    const choisis = p.heros.map((id) => candidats.find((x) => x.fiche.id === id)).filter(Boolean);
    const heros = choisis.map((x) => this.herosPrepare(x));
    const plan = this.planDuCombat(r);
    const liste = groupes(r, plan, Math.max(1, heros.length), +this.campagne.niveau || 1);
    const adversaires = adversairesDepuis(liste);
    const essai = { ordre: composerOrdre(heros.map((h) => h.id), p.avant, p.choisis), heros };
    const n = Math.min(p.avant, heros.length);
    // Ceux qui agissent avant les adversaires, tels que l'ordre du tour les posera : marqués, même sans choix explicite.
    const premiers = essai.ordre.slice(0, n).map((x) => x.replace(/^aventurier:/, ""));
    // Ce que le MJ doit savoir avant de commencer : un héros à terre qui se bat, ou laissé de côté parce qu'il l'est.
    const aTerre = (h) => etatHeros(h) !== "debout";
    const kos = heros.filter(aTerre);
    const ecartes = candidats.filter((x) => x.present && !p.heros.includes(x.fiche.id)
      && aTerre(herosDepuis(x.fiche, x.couleur, p.pleineForme ? null : this.etats[x.fiche.id])));
    const avertissements = [
      ...kos.map((h) => `${prenom(h.nom)} est ${etatHeros(h) === "mort" ? "au repère de mort" : "dans le coma"} (${signe(h.sante)} Santé) et se bat pourtant : il commencera à terre, sans pouvoir agir.${premiers.includes(h.id) ? ` Il est aussi désigné pour agir avant les adversaires.` : ""}`),
      ...ecartes.map((x) => `${prenom(x.fiche.nom)} est dans le coma : il n'est pas coché. Cochez-le s'il se bat quand même, ou cochez « Repartir en pleine forme ».`),
      ...(adversaires.length ? [] : ["Cette rencontre n'a aucun adversaire : le combat ne peut pas commencer."]),
    ];
    const moral = moralDuCombat({ adversaires, moral: r.moral !== false });
    const ligneCandidat = (x) => `
          <li><label class="case"><input type="checkbox" data-prep-heros="${e(x.fiche.id)}" ${p.heros.includes(x.fiche.id) ? "checked" : ""}>
            <span class="puce-heros" style="background:${e(couleurSure(x.couleur))}"></span><span class="nom-prep">${e(x.fiche.nom || "Sans nom")}<small class="etat-prep">${e(resumeEtat(etatComplet(x.fiche, p.pleineForme ? null : this.etats[x.fiche.id]), { sep: " · " }))}</small></span></label></li>`;
    const avert = avertissements.length ? `<ul class="avertissements-combat" role="status">${avertissements.map((t) => `<li>${e(t)}</li>`).join("")}</ul>` : "";
    return `
      <header class="tete-combat">
        <div class="titre">
          ${this.kicker("Préparer le combat")}
          <h1>${e(r.nom || "Rencontre")}</h1>
        </div>
        <div class="actions"><a class="bouton" href="#/combats/${e(r.id)}">Ouvrir la rencontre</a></div>
      </header>
      ${avert}
      ${this.combat ? `<p class="alerte-combat">Un combat est déjà en cours : « ${e(this.combat.nom)} », tour ${this.combat.tour}. Commencer celui-ci le remplace. <a href="#/combat/${e(this.idSeance)}">Reprendre « ${e(this.combat.nom)} »</a></p>` : ""}
      <div class="preparation-combat">
        <section class="bloc-combat">
          <h2>Qui se bat</h2>
          <ul class="choix-heros">${candidats.filter((x) => !x.autre).map(ligneCandidat).join("")}</ul>
          ${candidats.some((x) => x.autre) ? `<p class="sous-titre">Autres aventuriers</p><ul class="choix-heros">${candidats.filter((x) => x.autre).map(ligneCandidat).join("")}</ul>` : ""}
          <label class="case pleine-forme"><input type="checkbox" data-prep-pleine-forme ${p.pleineForme ? "checked" : ""}> Repartir en pleine forme</label>
          <p class="aide">${this.seance.presents?.length ? "Les présents de la séance sont cochés" : "Toute la tablée est cochée"}${ecartes.length ? ", sauf ceux dans le coma" : ""}. Chacun garde la Santé, la Psy et les cartons du combat d'avant ou de la séance (Jouer › La compagnie) : le combat les tient à jour et ils restent après lui. Les maximums de sa fiche ne bougent pas.</p>
        </section>
        <section class="bloc-combat">
          <h2>Qui agit avant les adversaires</h2>
          <label class="champ">Situation<select data-prep-avant>${SITUATIONS.map(([v, nom]) => `<option value="${v}" ${p.avant === v ? "selected" : ""}>${e(nom)} (${v === 0 ? "aucun" : v === 3 ? "3 et plus" : v})</option>`).join("")}</select></label>
          ${n > 0 && n < heros.length ? `
          <p class="aide">Les joueurs choisissent ensemble, en moins d'une minute, ${n === 1 ? "celui qui agit" : `les ${n} qui agissent`} avant les adversaires.</p>
          <div class="choix-avant" role="group" aria-label="Avant les adversaires">${heros.map((h) => `<button type="button" data-prep-avant-heros="${e(h.id)}" aria-pressed="${premiers.includes(h.id)}">${e(prenom(h.nom))}${premiers.includes(h.id) ? '<span class="choisi"> · agit avant</span>' : ""}</button>`).join("")}</div>` : ""}
          <p class="ordre-prevu"><span>Ordre du tour</span>${heros.length ? `${e(phraseOrdre(essai))}. Le même à chaque tour.` : "Cochez au moins un aventurier."}</p>
        </section>
        <section class="bloc-combat">
          <h2>Les adversaires</h2>
          <ul class="liste-adversaires">${adversaires.map((a) => `<li><b>${e(a.nom)}</b>${a.numero ? ` <span class="pion">${e(a.numero)}</span>` : ""}<span>${a.max} Santé</span></li>`).join("") || '<li class="vide">Aucun adversaire dans cette rencontre.</li>'}</ul>
          ${plan && liste.some((g) => g.depuisPlan) ? `<p class="aide">Numéros des pions du plan ${e(plan.nom || "")}.</p>` : ""}
          ${this.htmlPoser(r)}
          ${moral ? `<p class="aide">Les sbires fuient dès que ${moral.seuil === 1 ? "l'un d'eux tombe" : `${moral.seuil} d'entre eux sont tombés`}.</p>` : r.moral === false ? '<p class="aide">Dans cette rencontre, les sbires ne fuient pas à la moitié.</p>' : ""}
        </section>
      </div>
      <div class="actions preparation-fin">
        ${this.musique?.ambiances.length ? `<div class="musique-prep">${htmlReglageCombat(this.musique.ambiances, this.musique.combat)}</div>` : ""}
        <button class="principal" data-action="commencer" ${heros.length && adversaires.length ? "" : "disabled"}>Commencer le combat</button>
      </div>`;
  }

  htmlCombat() {
    const c = this.combat;
    const entree = c.ordre[c.actif];
    const tourEnnemis = entree === ENNEMIS;
    return `
      <header class="tete-combat">
        <div class="titre">
          ${this.kicker()}
          <h1>${e(c.nom)}</h1>
          <p class="ordre-prevu"><span>Ordre du tour</span>${e(phraseOrdre(c))}. Le même à chaque tour.</p>
        </div>
        <div class="actions">
          <a class="bouton" href="#/combats/${e(c.rencontre)}">Ouvrir la rencontre</a>
        </div>
      </header>
      ${htmlBarre(c, { surface: "page", tv: this.tv, reste: c.sablier ? this.resteSablier() : null })}
      <div class="rappels" aria-live="polite">${this.htmlRappels(c)}</div>
      <div class="combattants">
        <section class="bloc-combat heros-combat${tourEnnemis ? "" : " a-eux"}">
          <h2>Les héros</h2>
          ${c.heros.map((h) => this.htmlHeros(c, h, entree)).join("")}
          <p class="aide">Santé : « -4 » ou « 4 » retire, « +3 » rend, « =7 » fixe, puis Entrée (une seconde Entrée passe la main). Psy : « -2 » ou « 2 » paie un don, même raté (ce qui manque est pris sur la Santé et ne revient qu'après une journée entière de repos), « +1 » rend, « =3 » fixe. Un carton de plus sur une caractéristique déjà rouge coûte 1D6 Santé.</p>
        </section>
        <section class="bloc-combat adversaires-combat${tourEnnemis ? " a-eux" : ""}">
          <h2>Les adversaires${tourEnnemis ? " <small>à eux de jouer</small>" : ""}</h2>
          ${c.adversaires.map((a) => this.htmlAdversaire(a)).join("") || '<p class="vide">Aucun adversaire.</p>'}
        </section>
      </div>`;
  }

  // La ligne d'un héros : Santé et Psy, chacune avec sa case, puis la posture en trois pastilles et les cartons en
  // boutons P, S, M, comme dans le Tableau. En Focus, un rappel discret : chaque don coûte 1 Psy de moins (le MJ tape le
  // coût réel).
  htmlHeros(c, h, entree) {
    const etat = etatHeros(h);
    const libelle = { coma: "Coma", mort: "Repère de mort" }[etat] || "";
    const p = psyDe(h, this.ficheDe(h.id));
    const don = p.santeDon;
    return `
          <article class="ligne-combat ligne-heros etat-${etat}${entree === `aventurier:${h.id}` ? " actif" : ""}">
            <div class="qui"><span class="puce-heros" style="background:${e(couleurSure(h.couleur))}"></span><b>${e(h.nom)}</b>${NOMS_POSTURES[h.posture] ? `<span class="rang">${e(NOMS_POSTURES[h.posture])}</span>` : ""}${libelle ? `<span class="etat">${libelle}</span>` : ""}</div>
            <p class="sante-combat"${don ? ` title="Dont ${don} payé${don > 1 ? "s" : ""} faute de Psy : ${don > 1 ? "ils ne reviennent" : "il ne revient"} qu'après une journée entière de repos."` : ""}><output>${e(signe(h.sante))}</output><span>/ ${h.max}</span>${don ? `<small>dont ${don} en dons</small>` : ""}</p>
            <input class="saisie" type="text" inputmode="text" autocomplete="off" data-saisie="h:${e(h.id)}" placeholder="${exemple("sante")}" aria-label="Santé de ${e(h.nom)} : -4, +3 ou =7">${htmlRetour(`h:${h.id}`)}
            <p class="psy-combat"><span class="libelle">Psy</span><output>${p.psy}</output><span>/ ${p.psyMax}</span>${h.posture === "focus" ? `<small title="En posture Focus : +5 % à tous les tests, aucune défense ; chaque don coûte 1 Psy de moins (à 0, il s'active sans test, une fois par scène). Tapez le coût réel.">Focus : −1 par don, +5 %</small>` : ""}</p>
            <input class="saisie" type="text" inputmode="text" autocomplete="off" data-saisie="p:${e(h.id)}" placeholder="${exemple("psy")}" aria-label="Psy de ${e(h.nom)} : -2 paie un don, +1 rend, =3 fixe">${htmlRetour(`p:${h.id}`)}
            <div class="cartons-combat">${htmlPostures(h.id, h.nom, h.posture)}${htmlCartons(h.id, h.nom, h.cartons)}${htmlJeton(h.id, h.nom, AVANTAGES[h.avantage] ? h.avantage : "")}</div>
            ${this.htmlStats(h)}
          </article>`;
  }

  // Une ligne : caractéristiques, défense, armure, armes (rien sans fiche).
  htmlStats(h) {
    const x = statsHeros(this.ficheDe(h.id), h.posture);
    if (!x) return "";
    return `<p class="profil-combat stats-heros">${e([x.caracs.join(" · "), x.defense, x.armure].join(" · "))}${x.armes.length ? `<br>${e(x.armes.join(" ; "))}` : ""}</p>`;
  }

  // ---------------------------------------------------------------- le tableau du MJ (compact)

  // La même barre que sur la page du combat, plus serrée ; « Fin du combat » au bout, sous les autres commandes.
  htmlCompact() {
    const c = this.combat;
    const entree = c.ordre[c.actif];
    return `
      <header class="tc-tete">
        <div class="tc-titre">
          <p class="kicker">Combat</p>
          <h2><a href="#/combat/${e(this.idSeance)}" title="Ouvrir la page du combat">${e(c.nom)}</a></h2>
        </div>
      </header>
      ${htmlBarre(c, { surface: "tableau", tv: this.tv, reste: c.sablier ? this.resteSablier() : null })}
      <div class="rappels" aria-live="polite">${this.htmlRappels(c)}</div>
      <section class="tc-groupe">
        <h3>Les héros</h3>
        ${c.heros.map((x) => this.htmlHerosCompact(x, entree)).join("")}
      </section>
      <section class="tc-groupe${entree === ENNEMIS ? " a-eux" : ""}">
        <h3>Les adversaires${entree === ENNEMIS ? " <small>à eux</small>" : ""}</h3>
        ${c.adversaires.map((a) => this.htmlAdversaireCompact(a)).join("") || '<p class="vide">Aucun adversaire.</p>'}
      </section>`;
  }

  htmlJauge(genre, v, max, id, nom, extra = "") {
    const k = part(v, max);
    const couleur = genre === "psy" ? "#5b8fe0" : couleurSante(k);
    const libelle = genre === "psy" ? "Psy" : "Santé";
    const aide = genre === "psy" ? `Psy de ${nom} : -2 paie un don, +1 rend, =3 fixe` : `Santé de ${nom} : -4, +3 ou =7`;
    return `<div class="tc-jauge ${genre}">
          <span class="libelle">${libelle}</span>
          <span class="tc-barre" aria-hidden="true"><i style="width:${Math.round(k * 100)}%;background:${couleur}"></i></span>
          <output>${e(signe(v))}<small>/${max}</small></output>
          <input class="saisie" type="text" inputmode="text" autocomplete="off" data-saisie="${id}" placeholder="${exemple(genre)}" aria-label="${e(aide)}">${extra}
        </div>`;
  }

  htmlHerosCompact(h, entree) {
    const etat = etatHeros(h);
    const libelle = { coma: "Coma", mort: "Repère de mort" }[etat] || "";
    const p = psyDe(h, this.ficheDe(h.id));
    const x = statsHeros(this.ficheDe(h.id), h.posture);
    const jeton = AVANTAGES[h.avantage] ? h.avantage : "";
    return `
        <article class="tc-ligne etat-${etat}${entree === `aventurier:${h.id}` ? " actif" : ""}">
          <button type="button" class="tc-qui" data-action="montrer-pion" data-heros="${e(h.id)}" title="Retrouver son pion sur le plan">
            <span class="puce-heros" style="background:${e(couleurSure(h.couleur))}"></span><b>${e(h.nom)}</b>${NOMS_POSTURES[h.posture] ? `<small>${e(NOMS_POSTURES[h.posture])}</small>` : ""}${libelle ? `<span class="etat">${libelle}</span>` : ""}
          </button>
          ${this.htmlJauge("sante", h.sante, h.max, `h:${h.id}`, h.nom, p.santeDon ? `<small class="don" title="Payés faute de Psy : ils ne reviennent qu'après une journée entière de repos.">dont ${p.santeDon} en dons</small>` : "")}
          ${p.psyMax ? this.htmlJauge("psy", p.psy, p.psyMax, `p:${h.id}`, h.nom) : ""}
          <div class="tc-marques">
            ${htmlPostures(h.id, h.nom, h.posture)}
            ${htmlCartons(h.id, h.nom, h.cartons)}
            ${htmlJeton(h.id, h.nom, jeton)}
          </div>
          ${x ? `<p class="tc-stats">${e([x.caracs.join(" · "), x.defense, x.armure].join(" · "))}${x.armes.length ? `<br>${e(x.armes.join(" ; "))}` : ""}</p>` : ""}
        </article>`;
  }

  htmlAdversaireCompact(a) {
    const etat = a.sante <= 0 ? "tapis" : a.fuite ? "fuite" : "debout";
    const defense = +a.nbDef ? `${+a.nbDef} × ${+a.defense || 0} %` : "aucune";
    const profil = [`Att. ${+a.att || 0} %${(+a.attaques || 1) > 1 ? ` ×${+a.attaques}` : ""}`, `${a.degats || "?"}${a.ignoreArmure ? ", ignore l'armure" : ""}`,
      `Arm. ${+a.armure || 0}${+a.bouclier ? ` +${+a.bouclier}` : ""}`, `Déf. ${defense}`].join(" · ");
    return `
        <article class="tc-ligne tc-adversaire etat-${etat}">
          <button type="button" class="tc-qui" data-action="montrer-pion" data-adversaire="${e(a.id)}" title="Retrouver son pion sur le plan">
            ${a.numero ? `<span class="pion">${e(a.numero)}</span>` : ""}<b>${e(a.nom)}</b>${NOMS_RANGS[a.rang] ? `<small>${e(NOMS_RANGS[a.rang])}</small>` : ""}${etat !== "debout" ? `<span class="etat">${etat === "tapis" ? "Au tapis" : "En fuite"}</span>` : ""}
          </button>
          ${this.htmlJauge("sante", a.sante, a.max, `a:${a.id}`, nomAdversaire(a), `<button data-action="fuite" data-id="${e(a.id)}" aria-pressed="${!!a.fuite}" ${a.sante <= 0 ? "disabled" : ""}>${a.fuite ? "Revient" : "Fuit"}</button>`)}
          <p class="tc-stats">${e(profil)}</p>
          ${etat === "debout" ? htmlDesAdversaire(a) : ""}
          ${a.capacites ? `<p class="tc-capacites">${e(a.capacites)}</p>` : ""}
        </article>`;
  }

  htmlAdversaire(a) {
    const etat = a.sante <= 0 ? "tapis" : a.fuite ? "fuite" : "debout";
    const defense = +a.nbDef ? `${+a.nbDef} × ${+a.defense || 0} %` : "aucune";
    const profil = [`Att. ${+a.att || 0} %${(+a.attaques || 1) > 1 ? ` ×${+a.attaques}` : ""}`, `${a.degats || "?"}${a.ignoreArmure ? ", ignore l'armure" : ""}`,
      `Arm. ${+a.armure || 0}${+a.bouclier ? ` +${+a.bouclier}` : ""}`, `Déf. ${defense}`].join(" · ");
    return `
          <article class="ligne-combat etat-${etat}">
            <div class="qui"><b>${e(a.nom)}</b>${a.numero ? `<span class="pion">${e(a.numero)}</span>` : ""}${NOMS_RANGS[a.rang] ? `<span class="rang">${e(NOMS_RANGS[a.rang])}</span>` : ""}${etat !== "debout" ? `<span class="etat">${etat === "tapis" ? "Au tapis" : "En fuite"}</span>` : ""}</div>
            <p class="sante-combat"><output>${e(signe(a.sante))}</output><span>/ ${a.max}</span></p>
            <input class="saisie" type="text" inputmode="text" autocomplete="off" data-saisie="a:${e(a.id)}" placeholder="${exemple("sante")}" aria-label="Santé de ${e(nomAdversaire(a))} : -4, +3 ou =7">${htmlRetour(`a:${a.id}`)}
            <button data-action="fuite" data-id="${e(a.id)}" aria-pressed="${!!a.fuite}" ${a.sante <= 0 ? "disabled" : ""}>${a.fuite ? "Revient" : "Fuit"}</button>
            <p class="profil-combat">${e(profil)}</p>
            ${a.capacites ? `<p class="capacites">${e(a.capacites)}</p>` : ""}
          </article>`;
  }

  // Ce que le kit rappelle au MJ, d'après l'état du combat.
  htmlRappels(c) {
    const lignes = [this.flammes.html(c, { seance: this.seance })];
    const m = moralDuCombat(c);
    if (m && m.fuient && m.restent.length) {
      lignes.push(`<p class="rappel fort">Les sbires fuient : ${m.tombes} sur ${m.n} sont tombés. <button data-action="fuir-sbires">Ils fuient</button></p>`);
    } else if (m && !m.fuient) {
      lignes.push(`<p class="rappel">Les sbires fuient dès que ${m.seuil === 1 ? "l'un d'eux tombe" : `${m.seuil} d'entre eux sont tombés`} (${m.tombes} pour l'instant).</p>`);
    }
    for (const a of c.adversaires) {
      if (a.sante <= 0 && a.rang !== "sbire" && a.capacites) lignes.push(`<p class="rappel fort">${e(nomAdversaire(a))} est au tapis. Sa fiche : « ${e(a.capacites)} »</p>`);
    }
    for (const h of c.heros) {
      const etat = etatHeros(h);
      const p = e(prenom(h.nom));
      if (etat === "coma") lignes.push(`<p class="rappel fort">${p} est dans le coma : plus d'action, chaque coup reçu compte encore. Mort vers ${signe(seuilMort(h.max))}. Soigné au-dessus de 0, réveil aussitôt, avec un carton jaune en Physique.</p>`);
      if (etat === "mort") lignes.push(`<p class="rappel fort">${p} a passé le repère de mort du kit (${signe(seuilMort(h.max))}) : à vous de trancher.</p>`);
    }
    if (c.adversaires.length && !c.adversaires.some((a) => !horsDeCombat(a))) lignes.push('<p class="rappel">Plus aucun adversaire debout : le combat peut finir.</p>');
    if (c.sablier && this.resteSablier() <= 0) lignes.push('<p class="rappel fort">Le sablier est vide : le monstre rejoue.</p>');
    return lignes.join("");
  }

  resteSablier() {
    const s = this.combat?.sablier;
    if (!s) return 0;
    if (typeof s.fin !== "number") return s.duree || SABLIER;
    return Math.max(0, (s.fin * 1000 - (Date.now() + this.decalage)) / 1000);
  }

  majSablier() {
    const zone = this.racine.querySelector(".sablier-mj");
    if (!zone || !this.combat?.sablier) {
      this.sablierVide = false;
      return;
    }
    const reste = this.resteSablier();
    zone.textContent = minutes(reste);
    zone.classList.toggle("vide", reste <= 0);
    const vide = reste <= 0;
    if (vide !== this.sablierVide) {
      this.sablierVide = vide;
      const rappels = this.racine.querySelector(".rappels");
      if (rappels) rappels.innerHTML = this.htmlRappels(this.combat);
    }
  }

  // ---------------------------------------------------------------- gestes

  changer(nouveau) {
    this.combat = nouveau;
    this.aEnvoyer = true;
    this.afficher();
    this.sauver();
  }

  touche(ev) {
    if (ev.key === "Tab") this.clavier = true;
    if (ev.key !== "Enter" || ev.repeat || ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey || !this.combat || this.vuePreparation()) return;
    if (document.querySelector("dialog[open]")) return;
    // Chrome laisse le focus sur le bouton ou la liste qu'on vient de toucher à la souris : Entrée referait ce geste
    // (point strat repris, ordre retiré de la TV, sablier arrêté). Sur la page du combat, Entrée passe alors la main ;
    // un bouton atteint au clavier (Tab) garde son usage.
    const cible = ev.target;
    const aLaSouris = !this.clavier && !!cible.matches?.("button, select") && cible.closest(".combat-page") === this.zone;
    if (!aLaSouris && cible.closest?.("input, select, textarea, button, a, dialog, [contenteditable]")) return;
    ev.preventDefault();
    this.changer(suivant(this.combat));
  }

  toucheSaisie(ev) {
    const champ = ev.target.closest("[data-saisie]");
    if (!champ || ev.key !== "Enter" || ev.isComposing) return;
    ev.preventDefault();
    if (champ.value.trim()) return this.saisir(champ);
    // Case vide : Entrée passe la main, comme hors d'un champ (« -4 », Entrée, puis Entrée pour le suivant).
    if (!ev.repeat && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && this.combat && !this.vuePreparation()) this.changer(suivant(this.combat));
  }

  async saisir(champ) {
    const texte = champ.value.trim();
    if (!texte || !this.combat) return;
    const [genre, id] = champ.dataset.saisie.split(":");
    let c = copie(this.combat);
    let x = (genre === "a" ? c.adversaires : c.heros).find((y) => y.id === id);
    if (!x) return;
    if (genre === "p") return this.payer(champ, c, x);
    // Des soins ne dépassent pas le maximum, moins la Santé payée en dons ; « = » fixe ce que le MJ veut.
    const lu = saisieSante(texte, x);
    if (!lu) return toast("Saisie illisible : « -4 » ou « 4 » retire, « +3 » rend, « =7 » fixe.", "erreur");
    const valeur = lu.sante;
    if (genre === "h") {
      if (!(await this.accepteMort(x, valeur, "", champ))) return;
      // Le combat a pu bouger pendant la question (la télécommande) : le chiffre accepté se pose sur le dernier état.
      c = copie(this.combat || {});
      x = (c.heros || []).find((y) => y.id === id);
      if (!x) return;
      if (lu.retenu) {
        const don = santeDonRestante(x);
        toast(`${prenom(x.nom)} ${valeur > x.sante ? "remonte" : "reste"} à ${signe(valeur)} sur ${x.max} : ${don > 1 ? `les ${don} points de Santé payés faute de Psy ne reviennent` : "le point de Santé payé faute de Psy ne revient"} qu'après une journée entière de repos (« =${x.max} » ${don > 1 ? "les" : "le"} rend).`);
      }
      noterRetour(`h:${id}`, x.sante, valeur);
      this.poserSante(x, valeur);
    } else {
      if (valeur <= 0 && x.sante > 0) toast(`${nomAdversaire(x)} au tapis.`);
      noterRetour(`a:${id}`, x.sante, valeur);
      x.sante = valeur;
    }
    champ.value = "";
    const fuyaient = moralDuCombat(this.combat)?.fuient;
    const m = moralDuCombat(c);
    if (m && m.fuient && !fuyaient && m.restent.length) toast("La moitié des sbires est tombée : les autres fuient.");
    this.changer(c);
  }

  // La Psy d'un héros : un don se paie même raté ; ce qui manque est pris sur la Santé, avec les rappels de la Santé.
  async payer(champ, c, x) {
    const fiche = this.ficheDe(x.id);
    const lu = saisiePsy(champ.value, x, fiche);
    if (!lu) return toast("Saisie illisible : « -2 » ou « 2 » paie un don, « +1 » rend, « =3 » fixe.", "erreur");
    const { sante, preleve, ...psy } = lu;
    if (preleve) {
      if (!(await this.accepteMort(x, sante, " en payant ce don", champ))) return;
      const id = x.id;
      c = copie(this.combat || {});
      x = (c.heros || []).find((y) => y.id === id);
      if (!x) return;
    }
    if (preleve) {
      const avait = psyDe(x, fiche).psy;
      const qui = prenom(x.nom);
      toast(`${avait ? `${qui} paie ${avait} Psy et ${preleve} Santé` : `${qui} n'a plus de Psy : ${preleve} Santé en moins`}. Cette Santé ne revient qu'après une journée entière de repos.`);
    }
    noterRetour(`p:${x.id}`, psyDe(x, fiche).psy, psy.psy, "Psy");
    Object.assign(x, psy);
    if (preleve) this.poserSante(x, sante);
    champ.value = "";
    this.changer(c);
  }

  // Le repère de mort du kit : le MJ confirme avant de le noter (faux s'il renonce).
  accepteMort(x, valeur, pourquoi = "", champ = null) {
    return accepterMort(prenom(x.nom), x, valeur, pourquoi, champ);
  }

  // La nouvelle Santé d'un héros, avec les rappels du coma et du réveil (carton jaune en Physique). La Santé payée en
  // dons ne dépasse jamais ce qui manque : « =N » la fait baisser, des soins s'arrêtent avant elle (saisieSante).
  poserSante(x, valeur) {
    const { heros, coma, reveil } = santePosee(x, valeur);
    if (coma) toast(`${prenom(x.nom)} tombe dans le coma.`);
    if (reveil) toast(`${prenom(x.nom)} se réveille, avec un carton jaune en Physique.`);
    Object.assign(x, heros);
  }

  choix(ev) {
    const el = ev.target;
    const d = el.dataset;
    if (d.saisie !== undefined) return this.saisir(el);
    if (d.prepHeros !== undefined && this.prep) {
      const ids = this.candidats().map((x) => x.fiche.id).filter((id) => (id === d.prepHeros ? el.checked : this.prep.heros.includes(id)));
      this.prep.heros = ids;
      this.prep.choisis = this.prep.choisis.filter((id) => ids.includes(id));
      return this.afficher();
    }
    if (d.prepPleineForme !== undefined && this.prep) {
      this.prep.pleineForme = el.checked;
      return this.afficher();
    }
    if (d.prepAvant !== undefined && this.prep) {
      this.prep.avant = Math.max(0, Math.min(3, +el.value || 0));
      this.prep.choisis = this.prep.choisis.slice(0, this.prep.avant);
      return this.afficher();
    }
    // La musique des combats : le réglage part par la musique de l'en-tête (musique-combat.js), la préparation le retient.
    if (d.mCombat !== undefined && this.musique) this.musique.combat = el.value || null;
  }

  async clic(ev) {
    const b = ev.target.closest("button");
    if (!b || this.detruit) return;
    // Dans le tableau, un bouton touché à la souris ne garde pas le focus : Entrée ne rejoue pas son geste.
    if (this.compact && ev.detail) b.blur();
    const a = b.dataset.action;
    try {
      if (b.dataset.prepAvantHeros !== undefined && this.prep) {
        const id = b.dataset.prepAvantHeros;
        const p = this.prep;
        // On part de ce qui est affiché (les premiers de l'ordre, choisis ou complétés d'office) : un clic sur un héros
        // pas encore marqué prend la place du plus ancien ; un héros déjà marqué le reste (on en choisit un autre).
        const ids = p.heros;
        const actuels = composerOrdre(ids, p.avant, p.choisis).slice(0, Math.min(p.avant, ids.length)).map((x) => x.replace(/^aventurier:/, ""));
        if (actuels.includes(id)) return;
        p.choisis = [...actuels, id].slice(-Math.max(1, p.avant));
        return this.afficher();
      }
      if (a === "commencer") return await this.commencer();
      if (a === "poser-adversaires") return await this.poserSurLePlan(b);
      const c = this.combat;
      if (!c) return;
      // Les dés d'un adversaire (jets/des-mj.js) : son attaque contre sa valeur, ses dégâts ; rien ne change au combat.
      if (a === "de-attaque" || a === "de-degats") {
        const x = c.adversaires.find((y) => y.id === b.dataset.id);
        if (!x || b.getAttribute("aria-busy") === "true") return;
        b.setAttribute("aria-busy", "true");
        try {
          await lancerPourAdversaire(x, nomAdversaire(x), a === "de-degats" ? "degats" : "attaque");
        } finally {
          b.removeAttribute("aria-busy");
        }
        return;
      }
      if (a === "suivant") return this.changer(suivant(c));
      if (a === "precedent") return this.changer(precedent(c));
      if (a === "aller") return this.changer({ ...c, actif: Math.max(0, Math.min(c.ordre.length - 1, +b.dataset.rang || 0)), sablier: null });
      if (a === "strat") return this.changer({ ...c, strat: !c.strat });
      if (a === "sablier") return this.changer({ ...c, sablier: c.sablier ? null : { duree: SABLIER } });
      if (a === "jeton") {
        const n = copie(c);
        const h = n.heros.find((x) => x.id === b.dataset.id);
        if (!h) return;
        // Joué ou annulé, le jeton reste en clé vide : le serveur le retire aussi de l'état du héros.
        h.avantage = jetonApres(AVANTAGES[h.avantage] ? h.avantage : "", b.dataset.jeton);
        return this.changer(n);
      }
      if (a === "posture") {
        const n = copie(c);
        const h = n.heros.find((x) => x.id === b.dataset.id);
        if (!h || !NOMS_POSTURES[b.dataset.posture] || h.posture === b.dataset.posture) return;
        h.posture = b.dataset.posture;
        return this.changer(n);
      }
      if (a === "carton") {
        const n = copie(c);
        const h = n.heros.find((x) => x.id === b.dataset.id);
        const k = b.dataset.carac;
        if (!h || !NOMS_CARACS[k]) return;
        const suivantCarton = cartonApres(h.cartons?.[k]);
        h.cartons = { ...(h.cartons || {}) };
        if (suivantCarton) h.cartons[k] = suivantCarton;
        else delete h.cartons[k];
        return this.changer(n);
      }
      if (a === "montrer-pion") {
        window.dispatchEvent(new CustomEvent("tableau-pion", { detail: b.dataset.heros ? { heros: b.dataset.heros } : { adversaire: b.dataset.adversaire } }));
        return;
      }
      if (a === "fuite") {
        const n = copie(c);
        const x = n.adversaires.find((y) => y.id === b.dataset.id);
        if (x) x.fuite = !x.fuite;
        return this.changer(n);
      }
      if (a === "fuir-sbires") {
        const n = copie(c);
        const restent = new Set((moralDuCombat(n)?.restent || []).map((x) => x.id));
        for (const x of n.adversaires) if (restent.has(x.id)) x.fuite = true;
        return this.changer(n);
      }
      if (a === "tv") return await this.basculerTv();
      if (a === "fin") return await this.finir();
    } catch (err) {
      toast(`Impossible : ${err.message}`, "erreur");
    }
  }

  async commencer() {
    const r = this.rencontre();
    if (!r || !this.prep) return;
    // L'état du moment relu juste avant : un autre écran a pu le changer depuis l'ouverture de la préparation.
    const lus = this.prep.pleineForme ? null : await api.get("/api/etats-heros").catch(() => null);
    if (this.detruit) return;
    if (lus?.etats) this.etats = lus.etats;
    const candidats = this.candidats();
    const heros = this.prep.heros.map((id) => candidats.find((x) => x.fiche.id === id)).filter(Boolean).map((x) => this.herosPrepare(x));
    // En pleine forme, le jeton d'avantage de l'état s'en va aussi (clé vide : le serveur le retire de l'état).
    if (this.prep.pleineForme) for (const h of heros) h.avantage = "";
    const liste = groupes(r, this.planDuCombat(r), heros.length, +this.campagne.niveau || 1);
    const neuf = nouveauCombat({ rencontre: r, heros, adversaires: adversairesDepuis(liste), avant: this.prep.avant, choisis: this.prep.choisis });
    if (!heros.length || !neuf.adversaires.length) return;
    if (this.combat && !(await demander({ titre: "Un combat est en cours", texte: `« ${this.combat.nom} », tour ${this.combat.tour}. Le remplacer par « ${neuf.nom} » ?`, aide: "Le combat en cours s'arrête là, sans bilan au journal.", oui: "Remplacer le combat", non: "Garder celui-ci", danger: true }))) return;
    if (this.detruit) return;
    await this.vider();
    let srv;
    try {
      srv = await api.put(this.url, { ...neuf, par: "atelier", version_base: this.base?.modifie ?? null });
    } catch (err) {
      if (err.status !== 409) throw err;
      // Un combat a été commencé ou changé sur un autre écran entre-temps : on le montre avant de rien remplacer.
      const lu = await api.get(this.url);
      this.recu(lu);
      this.combat = copie(lu.combat);
      this.base = copie(lu.combat);
      toast("Un combat a changé sur un autre écran : vérifiez avant de commencer celui-ci.", "erreur");
      return this.afficher();
    }
    if (this.detruit) return;
    this.recu(srv);
    this.combat = copie(srv.combat);
    this.base = copie(srv.combat);
    this.idRencontre = "";
    history.replaceState(null, "", `#/combat/${encodeURIComponent(this.idSeance)}`);
    toast(`Combat commencé : ${phraseOrdre(this.combat)}.`, "info", { duree: 2800 });
    annoncerEtatJeu({ seance: this.idSeance, combat: copie(this.combat) }, { source: this });
    this.afficher();
  }

  async basculerTv() {
    await this.vider();
    const srv = await api.put(`${this.url}/tv`, { montrer: !this.tv });
    if (this.detruit) return;
    this.recu(srv);
    this.afficher();
    if (!this.tv) return toast("L'ordre du tour a quitté la TV.");
    const table = await api.get("/api/table").catch(() => null);
    toast(table && !VUES_BANDEAU.includes(table.vue)
      ? "L'ordre du tour paraîtra sur la TV dès qu'elle montrera un plan, une carte ou une image."
      : "L'ordre du tour est sur la TV.");
  }

  // « Fin du combat » : qui est encore debout, rappelé avant de confirmer ; le serveur rend le combat fini, dont le
  // bilan va au journal ; le message qui suit offre « Rouvrir le combat » et « Retour à la séance ».
  async finir() {
    const c = this.combat;
    const debout = c.adversaires.filter((a) => !horsDeCombat(a)).map(nomAdversaire);
    const finir = await demander({
      titre: `Finir le combat « ${c.nom} »`,
      texte: [debout.length ? `Encore debout : ${enListe(debout)}.` : "", `Son bilan sera noté au journal de la séance${this.tv ? ", et l'ordre du tour quitte la TV" : ""}.`],
      aide: `« ${MOTS.rouvrir} » le reprend pendant quelques secondes.`,
      oui: MOTS.fin,
      non: "Continuer le combat",
    });
    if (!finir || this.detruit || this.combat?.id !== c.id) return;
    await this.vider();
    const tv = this.tv;
    const fin = await finirCombat(this.idSeance, { local: copie(this.combat), source: this });
    annoncerFin(this.idSeance, fin, tv);
    if (this.detruit) return;
    this.tv = false;
    this.combat = null;
    this.base = null;
    this.idRencontre = "";
    this.fini = { nom: c.nom, combat: copie(fin.fini || c) };
    this.afficher();
  }

  // ---------------------------------------------------------------- enregistrement

  enFile(travail) {
    this.fileEnvois = this.fileEnvois.then(travail).catch((err) => toast(`Combat non enregistré : ${err.message}`, "erreur"));
    return this.fileEnvois;
  }

  // Le combat part avec la version sur laquelle il a été changé. Refusé (409) parce qu'un autre écran l'a changé : on
  // relit celui du serveur, on y reporte ce que cet écran a changé, et on renvoie. La main déjà passée là-bas (la
  // télécommande, puis Entrée ici) n'est pas passée une seconde fois : le message le dit.
  enregistrer() {
    if (!this.aEnvoyer || !this.combat) return this.fileEnvois;
    this.aEnvoyer = false;
    this.enVol++;
    return this.enFile(async () => {
      const envoye = copie(this.combat);
      const depart = this.base;
      let corps = envoye;
      let base = this.base;
      let deja = "";
      // La version du serveur, reçue après l'envoi (ou déjà complète : rien à renvoyer). reunis : après un refus.
      const adopter = (srv, reunis) => {
        this.reessai.reussite();
        this.recu(srv);
        this.base = copie(srv.combat);
        annoncerEtatJeu({ seance: this.idSeance, combat: copie(srv.combat) }, { source: this });
        if (JSON.stringify(this.combat) !== JSON.stringify(envoye)) {
          // Ce qui a changé ici pendant l'envoi reste, et repartira.
          this.combat = fusionnerCombat(envoye, this.combat, srv.combat);
          this.aEnvoyer = true;
          this.sauver();
        } else this.combat = copie(srv.combat);
        if (reunis) {
          toast(deja || "Combat changé aussi sur un autre écran : les deux sont réunis.");
          this.afficher();
        }
      };
      for (let essai = 0; essai < 3; essai++) {
        try {
          const srv = await api.put(this.url, { ...corps, par: "atelier", version_base: base?.modifie ?? null });
          return adopter(srv, essai > 0);
        } catch (err) {
          if (err.status !== 409 || essai === 2) {
            // Il repartira au prochain essai ou geste, ou en quittant la page.
            this.aEnvoyer = true;
            this.reessai.echec(err);
            this.reessai.signaler(err, "Combat non enregistré");
            return;
          }
          const lu = await api.get(this.url);
          this.recu(lu);
          if (!lu.combat || lu.combat.id !== envoye.id) {
            this.combat = copie(lu.combat);
            this.base = copie(lu.combat);
            toast("Ce combat a été fini ou remplacé sur un autre écran.", "erreur");
            this.afficher();
            return;
          }
          if (mainChangee(depart, envoye) && mainChangee(depart, lu.combat)) {
            deja = `${lu.combat.par === "telecommande" ? "La télécommande" : "Un autre écran"} a déjà passé la main ${versQui(lu.combat)}.`;
          }
          corps = fusionnerCombat(base, envoye, lu.combat);
          base = lu.combat;
          if (pareilCombat(corps, lu.combat)) return adopter(lu, true);
        }
      }
    }).finally(() => this.enVol--);
  }

  // De retour sur l'onglet : le combat a pu changer sur un autre écran, et pendant la préparation l'état des héros.
  async relire() {
    if (this.detruit || this.aEnvoyer || this.enVol || this.sauver.enAttente()) return;
    let lu;
    let etats;
    try {
      [lu, etats] = await Promise.all([api.get(this.url), this.vuePreparation() ? api.get("/api/etats-heros").catch(() => null) : null]);
    } catch {
      return;
    }
    if (this.detruit || this.aEnvoyer || this.enVol) return;
    const tv = this.tv;
    this.recu(lu);
    const autresEtats = !!etats?.etats && JSON.stringify(etats.etats) !== JSON.stringify(this.etats);
    if (autresEtats) this.etats = etats.etats;
    if (JSON.stringify(lu.combat) !== JSON.stringify(this.base) || tv !== this.tv) {
      // Fini sur un autre écran : la page le dit, avec le chemin de la séance ; rouvert, elle le reprend.
      if (!lu.combat && this.combat) this.fini = { nom: this.combat.nom, ailleurs: true, combat: copie(this.combat) };
      if (lu.combat) this.fini = null;
      this.combat = copie(lu.combat);
      this.base = copie(lu.combat);
      this.afficher();
    } else if (autresEtats) this.afficher();
  }
}
