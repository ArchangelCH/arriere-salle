// Les séances : la campagne (tablée, réputation, fils qui avancent), puis chaque séance à préparer, jouer et clore.
// Une séance et la campagne s'enregistrent avec leur version : un autre écran ne les écrase pas en silence.

import { api, copie, differer, echapper as e, enregistrerAvecVersion, erreurIA, toast } from "../api.js";
import { identiteTablee } from "../aventuriers/regles.js";
import { annoncerCorbeille, lienVersions } from "../corbeille/corbeille.js";
import { copier } from "../illustrations/illustrations.js";
import { etapeSuivante, franchir, horloge, htmlFil, proposition } from "./fils.js";
import { avantDeJouer, htmlAvantDeJouer, lienLieu, scenarioDe } from "./avant-de-jouer.js";
import { VERDICTS } from "../combats/simulation.js";
import { TYPES_LIEUX } from "../carte/biomes.js";
import { cartonVerifie } from "../pnj/carton-pnj.js";
import { aCopier, demander } from "../commun/dialogue.js";
import { afficherTemoin, htmlTemoin } from "../commun/temoin-enregistrement.js";
import { noterAuJournal, remettreAuJournal, retirerDuJournal } from "./journal.js";
import { etatMusique, jouerAmbiance } from "../musique/musique.js";
import { Reessai } from "../commun/reessai.js";
import { Compagnie } from "./compagnie.js";
import { delier, htmlLier, htmlLiensJeu, lienCombat, lier, liensResolus, sceneEnCours } from "./liens-scene.js";
import { htmlRepere, jouerLaScene, vuePlan } from "./jouer-scene.js";
import { ecouterTable } from "../ecran-tv/canal-table.js";
import { ecouterTv } from "../ecran-tv/etat-tv.js";
import { rienDeRevele } from "../ecran-tv/tv-commun.js";
import { questionTvNoire } from "../ecran-tv/tv-noire.js";
import { aujourdhui, seanceDuJour, seanceEnCours } from "./seance-en-cours.js";
import { attenduDuBouton, avancer, envoisDuGeste, htmlFilDeSeance } from "./scene-suivante.js";
import { ongletOuvrant, retenirOnglet } from "./ouverture.js";
import { PourLeCarnet, suiteDuTexte } from "./pour-le-carnet.js";
import { htmlRubrique, marqueSort, plansDeLaSeance, sousLaMain } from "./sous-la-main.js";
import { ProposerLiens } from "./proposer-liens.js";
import { nomPourLesJoueurs } from "../auberge/nom-auberge.js";
import { estInvite } from "../mj/role.js";
import { Billets, billetsAVerifier, billetsDe, htmlBillets, htmlBilletsJeu, htmlRappel, rappelDeScene } from "./billets.js";
import { SuiteDeSeance } from "./seance-suivante.js";
import { htmlMarqueScene, htmlProposes, proposesDe } from "./propose.js";
import { chargerConfort } from "../confort/confort.js";
import { documentsAuCompteRendu, htmlDocumentsAMontrer } from "../documents/seance.js";
import { montrerDocument, retirerDocument } from "../documents/tv.js";
import { TITRE_PRECEDEMMENT } from "../campagne/nom.js";

// Les six prétirés du kit, pour compléter la tablée : les mêmes nom, peuple et vocation que le créateur y écrit. Le kit
// porte aussi leurs histoires, des secrets pour un MJ invité : chargé à l'ouverture de la page, chez le MJ principal
// seulement. Un MJ invité lit la tablée sans l'écrire : la campagne est celle du MJ principal.
let PRETIRES = [];
// Chaque joueur a la couleur de ses dés.
const COULEURS = ["#b3261e", "#2f6ea5", "#3f8f4a", "#c9a227", "#7b4fa0", "#d07a2c", "#4a9aa0"];
const ONGLETS = [["preparer", "Préparer"], ["jouer", "Jouer"], ["clore", "Clore"]];
const DEROULE_TYPE = [
  ["Installation, et le « Précédemment »", 15],
  ["Scène 1", 40],
  ["Scène 2", 45],
  ["Pause", 30],
  ["Scène 3", 45],
  ["Scène 4", 30],
  ["Fin de séance : ce que chacun a préféré", 15],
];
const VUE_AVANT = ["vue", "carte", "camera", "style", "version", "lieu", "url", "titre"];
// Les vues de la TV qui passent sans s'installer : les quitter ramène à ce qu'elle montrait avant elles.
const VUES_PLEINES = ["planche", "precedemment", "episode", "heros", "fiches", "document"];

function ajuster(zone) {
  zone.style.height = "auto";
  zone.style.height = `${zone.scrollHeight + 2}px`;
}
const enMinutes = (h) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(h || "");
  return m ? +m[1] * 60 + +m[2] : null;
};
const enHeure = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;
const heureFr = (h) => (h ? h.replace(/^0(\d)/, "$1").replace(":", " h ").replace(/ h 00$/, " h") : "");
const duree = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}` : `${m} min`);
const tronquer = (t, n) => (t && t.length > n ? `${t.slice(0, n - 1)}…` : t || "");
// Ce que le carton-titre annonce (la TV le reçoit passé au masque).
const titreEpisode = (s) => (s.titre_episode || "").trim() || (s.nom || "").trim();

function dateLongue(iso) {
  if (!iso) return "";
  return new Date(`${iso}T12:00`).toLocaleDateString("fr-CH", { weekday: "long", day: "numeric", month: "long" });
}
function dateCourte(iso) {
  if (!iso) return "";
  return new Date(`${iso}T12:00`).toLocaleDateString("fr-CH", { day: "numeric", month: "short" });
}

export class Seances {
  constructor(racine, { id, parametres }) {
    this.racine = racine;
    this.idDemande = id || null;
    // L'onglet demandé par l'adresse ; sans lui, choisi à l'ouverture (ouverture.js), une fois la séance lue.
    this.ongletDemande = ONGLETS.some(([k]) => k === parametres?.get("onglet")) ? parametres.get("onglet") : "";
    this.onglet = this.ongletDemande || "preparer";
    this.versLaScene = true;
    this.surSceneSuivante = (ev) => this.sceneSuivanteDemandee(ev);
    this.surRetour = () => document.visibilityState === "visible" && this.actualiser();
    this.modifs = { seance: new Set(), campagne: false, fils: new Set() };
    this.sauver = differer(() => this.enregistrer(), 700);
    this.chaine = Promise.resolve();
    this.envois = 0;
    // Serveur injoignable : ce qui n'est pas parti repart seul (3 s, 10 s, puis toutes les 30 s).
    this.enEchec = false;
    this.reessai = new Reessai(() => this.enregistrer(), () => this.afficherEtat());
    this.minuterie = 0;
    // Dernière version connue du serveur, base de la fusion quand un autre écran a enregistré entre-temps.
    this.bases = { seances: {}, campagne: {}, fils: {} };
    this.surJournal = (ev) => this.journalModifie(ev.detail);
    this.surMusique = () => this.majLiensJeu();
    // Les « Lier » ouverts dans Préparer, par ligne du déroulé : ils le restent quand l'onglet se redessine.
    this.liensOuverts = new WeakSet();
    // L'état et le sac des héros présents (Jouer) : ils s'enregistrent à part de la séance.
    this.compagnie = new Compagnie({ seance: () => this.seance, tablee: () => this.campagne?.tablee || [] });
    // Clore : ce que le carnet des joueurs recevra de la séance (pour-le-carnet.js).
    this.pourLeCarnet = new PourLeCarnet(this);
    // Préparer : les liens que les titres des scènes et le scénario relié laissent deviner (proposer-liens.js).
    this.proposer = new ProposerLiens(this);
    // Préparer et Jouer : les billets secrets, remis à un joueur sur papier (billets.js).
    this.billets = new Billets(this);
    // Clore puis Préparer : la séance suivante préparée à la clôture (seance-suivante.js).
    this.suite = new SuiteDeSeance(this, { cadre: DEROULE_TYPE });
  }

  async demarrer() {
    const urls = ["/api/seances", "/api/campagne", "/api/fils", "/api/pnj", "/api/lieux", "/api/contrats", "/api/rumeurs", "/api/table", "/api/rencontres", "/api/plans", "/api/scenarios"];
    // La liste de musique sert aux liens des scènes : illisible, elle ne doit pas empêcher d'ouvrir les séances.
    const [donnees, musique, confort, documents, kit] = await Promise.all([Promise.all(urls.map((u) => api.get(u))), api.get("/api/musique").catch(() => null),
      chargerConfort(), api.get("/api/documents").catch(() => []), estInvite() ? null : import("../aventuriers/kit.js").catch(() => null)]);
    if (this.detruit) return;
    if (kit) PRETIRES = kit.PRETIRES.map(identiteTablee);
    // Les lignes et les voiles de la tablée, pour « Avant de jouer » (confort/confort.js).
    this.confort = confort;
    // Les documents remis aux joueurs (documents/) : liés aux scènes, sous la main, montrés depuis Jouer.
    this.documents = documents.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));
    [this.seances, this.campagne, this.fils, this.pnj, this.lieux, this.contrats, this.rumeurs, this.table, this.rencontres, this.plans, this.scenarios] = donnees;
    this.ambiances = musique?.ambiances || [];
    this.bases = {
      seances: Object.fromEntries(this.seances.map((x) => [x.id, copie(x)])),
      campagne: { campagne: copie(this.campagne) },
      fils: Object.fromEntries(this.fils.map((x) => [x.id, copie(x)])),
    };
    this.seances.sort((a, b) => (a.numero || 0) - (b.numero || 0));
    this.pnj.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    this.lieux.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    this.scenarios.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));
    this.fils.sort((a, b) => (a.cree || "").localeCompare(b.cree || ""));
    if (this.idDemande && !this.seance) this.idDemande = null;
    if (!this.ongletDemande) this.onglet = ongletOuvrant(this.seance);
    this.racine.innerHTML = `<section class="seances"><aside class="liste-seances"></aside><div class="seances-corps"></div></section>`;
    window.addEventListener("journal-modifie", this.surJournal);
    window.addEventListener("musique-changee", this.surMusique);
    // Le Tableau et la télécommande passent par la page pour jouer la scène suivante d'une séance qu'elle tient.
    window.addEventListener("scene-suivante", this.surSceneSuivante);
    // Une scène jouée ailleurs (la télécommande, un autre écran) : la séance se relit au retour sur la page, quand la
    // table change, et toutes les 30 secondes dans Jouer (majHoraire).
    window.addEventListener("focus", this.surRetour);
    document.addEventListener("visibilitychange", this.surRetour);
    this.finTable = ecouterTable(() => this.actualiser());
    this.lier();
    this.afficherListe();
    this.afficherCorps();
    // Ce que montre la TV, lu comme le témoin de l'en-tête (un autre écran, la télécommande ont pu la changer) : les
    // boutons « Montrer » et « Retirer » de Jouer le disent sans le deviner.
    this.finTv = ecouterTv((t) => {
      if (this.detruit) return;
      const { ecrans, ecrans_salon, ecrans_internet, publique, ...etat } = t;
      this.table = etat;
      this.majBoutonsTable();
    });
    this.chargementCompagnie = this.compagnie.charger();
  }

  detruire() {
    this.detruit = true;
    clearInterval(this.minuterie);
    window.removeEventListener("journal-modifie", this.surJournal);
    window.removeEventListener("musique-changee", this.surMusique);
    window.removeEventListener("scene-suivante", this.surSceneSuivante);
    window.removeEventListener("focus", this.surRetour);
    document.removeEventListener("visibilitychange", this.surRetour);
    this.finTable?.();
    this.finTv?.();
    this.billets.detruire();
    document.querySelector(".avis-secrets")?.remove();
    const compagnie = this.compagnie.detruire();
    return Promise.all([this.vider(), compagnie]);
  }

  vider() {
    if (this.resteAEnvoyer()) this.sauver.maintenant();
    return Promise.all([this.chaine, this.compagnie.vider()]);
  }

  resteAEnvoyer() {
    return this.modifs.seance.size > 0 || this.modifs.campagne || this.modifs.fils.size > 0;
  }

  // Reste-t-il quelque chose qui n'est pas enregistré ? (l'onglet ne se ferme pas sans prévenir)
  aEnregistrer() {
    return this.resteAEnvoyer() || this.sauver.enAttente() || this.envois > 0 || this.compagnie.aEnregistrer();
  }

  get seance() {
    return this.seances.find((s) => s.id === this.idDemande) || null;
  }

  // La séance en cours, la même pour la campagne, le journal et le Tableau (seance-en-cours.js).
  prochaine() {
    return seanceEnCours(this.seances);
  }

  // « aujourd'hui » pour la séance du jour, « en cours » pour celle qu'on joue un autre jour que sa date.
  etiquette(s) {
    if (!seanceDuJour(s)) return "la prochaine";
    return s.date === aujourdhui() ? "aujourd'hui" : "en cours";
  }

  // La dernière séance jouée avant celle-ci, dont le résumé sert de « Précédemment ».
  precedente(s) {
    return this.seances.filter((x) => (x.numero || 0) < (s ? s.numero || 0 : Infinity) && x.close && (x.precedemment || "").trim()).pop() || null;
  }

  lier() {
    // Sur la section et non sur #page : #page survit aux changements de page, ses écouteurs s'empileraient.
    const r = this.racine.querySelector(".seances");
    r.addEventListener("click", (ev) => {
      const lien = ev.target.closest(".liste-seances a[href^='#/seances']");
      if (lien) {
        ev.preventDefault();
        const id = lien.getAttribute("href").split("/")[2] || null;
        this.aller(id);
        return;
      }
      this.clic(ev);
    });
    // « toggle » ne remonte pas : on l'écoute à la descente.
    r.addEventListener("toggle", (ev) => {
      const d = ev.target.matches?.("details[data-liens]") && this.seance?.deroule?.[+ev.target.dataset.liens];
      if (!d) return;
      if (ev.target.open) this.liensOuverts.add(d);
      else this.liensOuverts.delete(d);
    }, true);
    r.addEventListener("input", (ev) => this.saisie(ev, false));
    r.addEventListener("change", (ev) => this.saisie(ev, true));
    r.addEventListener("submit", (ev) => {
      if (!ev.target.matches("[data-journal]")) return;
      ev.preventDefault();
      this.noterLigne(ev.target.elements.texte);
    });
  }

  aller(id, onglet = "") {
    if (this.modifs.seance.size || this.modifs.campagne || this.modifs.fils.size) this.sauver.maintenant();
    this.idDemande = id;
    this.onglet = ONGLETS.some(([k]) => k === onglet) ? onglet : ongletOuvrant(this.seance);
    this.versLaScene = true;
    history.pushState(null, "", id ? `#/seances/${id}${this.onglet === "preparer" ? "" : `?onglet=${this.onglet}`}` : "#/seances");
    this.afficherListe();
    this.afficherCorps();
    this.racine.querySelector(".seances-corps").scrollTop = 0;
    this.actualiser();
    // L'adresse change sans « hashchange » : le Tableau apprend ici quelle séance la page montre.
    window.dispatchEvent(new CustomEvent("seance-ouverte", { detail: { id } }));
  }

  afficherListe() {
    const prochaine = this.prochaine();
    this.racine.querySelector(".liste-seances").innerHTML = `
      <header>
        <p class="kicker">Campagne</p>
        <h1>Les séances</h1>
        <button class="principal" data-action="nouvelle-seance">Nouvelle séance</button>
      </header>
      <nav aria-label="Séances">
        <a href="#/seances" class="lien-campagne" aria-current="${!this.idDemande}">
          <span class="nom">La campagne</span><span class="meta">${estInvite() ? "tablée, fils" : "tablée, réputation, fils"}</span>
        </a>
        <ol class="liste">
          ${this.seances.map((s) => `
            <li><a href="#/seances/${e(s.id)}" aria-current="${s.id === this.idDemande}">
              <span class="numero">${s.numero ?? "?"}</span>
              <span class="texte">
                <span class="nom">${e(s.nom || `Séance ${s.numero ?? ""}`)}</span>
                <span class="meta">${e([s.date ? dateCourte(s.date) : s.suite?.date ? `${dateCourte(s.suite.date)}, à confirmer` : "date à fixer", s.close ? "jouée" : s.id === prochaine?.id ? this.etiquette(s) : "à préparer"].join(" · "))}</span>
              </span>
            </a></li>`).join("")}
        </ol>
      </nav>`;
  }

  afficherCorps() {
    clearInterval(this.minuterie);
    if (this.seance) this.afficherSeance();
    else this.afficherCampagne();
    this.racine.querySelectorAll(".seances-corps textarea").forEach(ajuster);
    this.afficherEtat();
  }

  // ---- La campagne ----

  texteNiveau() {
    const c = this.campagne;
    const depuis = this.seances.filter((s) => s.close && (s.numero || 0) > (c.niveau_seance || 0)).length;
    const base = "À la fin d'une histoire, ou environ toutes les trois séances.";
    return `${base} ${depuis ? `${depuis} séance${depuis > 1 ? "s" : ""} jouée${depuis > 1 ? "s" : ""} depuis le dernier niveau.` : ""}`;
  }

  afficherCampagne() {
    const c = this.campagne;
    const prochaine = this.prochaine();
    const duJour = seanceDuJour(prochaine);
    const derniere = this.precedente(prochaine);
    const vide = !this.seances.length && !this.fils.length;
    this.racine.querySelector(".seances-corps").innerHTML = `
      <div class="campagne">
        <header class="titre-page">
          <p class="kicker">${e(c.nom || "La campagne")}</p>
          <div class="titre-avec-temoin"><h1>La campagne</h1>${htmlTemoin(this.resteAEnvoyer() ? "modifie" : "ok")}</div>
          <p class="chapo">${estInvite() ? "La tablée, et vos fils qui avancent quand les héros regardent ailleurs." : "La tablée, ce que le pays pense du groupe, et les fils qui avancent quand les héros regardent ailleurs."}</p>
        </header>
        ${vide && !estInvite() ? `
        <div class="bloc installer">
          <p>Rien n'est encore prêt.</p>
          <button class="principal" data-action="installer">Installer la campagne du kit</button>
          <p class="aide">Les fils de la campagne découpés en étapes, la planche de l'auberge, ses rumeurs et ses habitués. Rien de ce qui existe n'est modifié.</p>
        </div>` : ""}
        <section class="bloc prochaine">
          ${prochaine ? `
            <p class="kicker">${duJour ? "Séance du jour" : "Prochaine séance"}</p>
            <h2>Séance ${prochaine.numero ?? ""}${prochaine.nom ? ` · ${e(prochaine.nom)}` : ""}</h2>
            <p>${prochaine.date ? e(`${prochaine.date === aujourdhui() ? "Aujourd'hui" : dateLongue(prochaine.date)}${prochaine.heure ? ` à ${heureFr(prochaine.heure)}` : ""}${duJour && prochaine.date !== aujourdhui() ? " · jouée aujourd'hui" : ""}`) : duJour ? "Jouée aujourd'hui." : "Date à fixer."}</p>
            <div class="actions">
              ${duJour ? `<a class="bouton principal" href="#/seances/${e(prochaine.id)}?onglet=jouer" data-aller="${e(prochaine.id)}" data-onglet="jouer">Jouer</a>` : ""}
              <a class="bouton${duJour ? "" : " principal"}" href="#/seances/${e(prochaine.id)}" data-aller="${e(prochaine.id)}" data-onglet="preparer">Préparer</a>
              <a class="bouton" href="/fiche-seance?id=${e(prochaine.id)}" target="_blank" rel="noopener">Fiche d'une page</a>
              <a class="bouton" href="/feuille-combat?id=${e(prochaine.id)}" target="_blank" rel="noopener">Feuille de combat</a>
              ${derniere ? `<button data-action="precedemment" data-seance="${e(derniere.id)}">Précédemment…</button>` : ""}
            </div>` : `
            <p>Aucune séance à venir.</p>
            <div class="actions"><button class="principal" data-action="nouvelle-seance">Nouvelle séance</button></div>`}
        </section>
        <div class="grille-campagne">
          <section class="bloc tablee">${estInvite() ? this.htmlTableeEnLecture() : this.htmlTablee()}</section>
          ${estInvite() ? "" : `<section class="bloc reputation">${this.htmlReputation()}</section>`}
        </div>
        <section class="bloc-fils">
          <div class="barre">
            <h2>${estInvite() ? "Vos fils" : "Les fils de la campagne"}</h2>
            <button data-action="nouveau-fil">Nouveau fil</button>
          </div>
          <p class="aide">À la clôture d'une séance, chaque fil dont les héros ne se sont pas mêlés avance selon son rythme. Une étape franchie laisse une rumeur à placer à l'auberge, parfois une affiche sur la planche. Les étapes du kit sont des propositions maison.</p>
          <div class="fils">${this.fils.map((f) => htmlFil(f, { contrats: this.contrats })).join("") || '<p class="vide">Aucun fil pour l\'instant.</p>'}</div>
        </section>
      </div>`;
  }

  htmlTablee() {
    const t = this.campagne.tablee || [];
    return `
      <h2>La tablée</h2>
      ${t.length ? `
      <table class="table-tablee">
        <thead><tr><th>Joueur</th><th>Personnage</th><th>Peuple</th><th>Vocation</th><th title="Chaque joueur a la couleur de ses dés">Dés</th><th>Actif</th><th><span class="visuel-cache">Retirer</span></th></tr></thead>
        <tbody>${t.map((j, i) => j.aventurier ? `
          <tr class="lie">
            <td>${e(j.joueur || "?")}</td>
            <td><a href="#/aventuriers/${e(j.aventurier)}" title="Joueur, dés et personnage se modifient dans sa fiche">${e(j.personnage || "sans nom")}</a></td>
            <td>${e(j.peuple || "")}</td>
            <td>${e(j.vocation || "")}</td>
            <td><span class="pastille" style="background:${e(j.couleur || "#888")}"></span></td>
            <td><input type="checkbox" ${j.actif === false ? "" : "checked"} data-t="${i}" data-tc="actif" aria-label="Joue encore"></td>
            <td></td>
          </tr>` : `
          <tr>
            <td><input type="text" value="${e(j.joueur || "")}" data-t="${i}" data-tc="joueur" aria-label="Joueur" placeholder="Prénom"></td>
            <td><input type="text" list="pretires" value="${e(j.personnage || "")}" data-t="${i}" data-tc="personnage" aria-label="Personnage"></td>
            <td><input type="text" value="${e(j.peuple || "")}" data-t="${i}" data-tc="peuple" aria-label="Peuple"></td>
            <td><input type="text" value="${e(j.vocation || "")}" data-t="${i}" data-tc="vocation" aria-label="Vocation"></td>
            <td><input type="color" value="${e(j.couleur || COULEURS[i % COULEURS.length])}" data-t="${i}" data-tc="couleur" aria-label="Couleur des dés"></td>
            <td><input type="checkbox" ${j.actif === false ? "" : "checked"} data-t="${i}" data-tc="actif" aria-label="Joue encore"></td>
            <td><button class="lien-danger" data-action="joueur-retirer" data-i="${i}">Retirer</button></td>
          </tr>`).join("")}
        </tbody>
      </table>
      ${t.some((j) => j.aventurier) ? '<p class="aide">Les aventuriers créés dans l\'onglet Aventuriers se tiennent à jour tout seuls : on les modifie depuis leur fiche.</p>' : ""}` : '<p class="aide">Personne encore. Créez les aventuriers dans l\'onglet Aventuriers : ils rejoignent la tablée avec leur joueur et la couleur de ses dés.</p>'}
      <datalist id="pretires">${PRETIRES.map((p) => `<option value="${e(p.personnage)}">`).join("")}</datalist>
      <div class="actions"><a class="bouton" href="#/aventuriers">Créer les aventuriers</a><button data-action="joueur-ajouter">Ajouter un joueur sans fiche</button></div>
      <div class="niveau">
        <label class="champ">Niveau du groupe<input type="number" min="1" max="10" value="${this.campagne.niveau || 1}" data-c="niveau"></label>
        <p class="aide">${e(this.texteNiveau())}</p>
      </div>`;
  }

  // La tablée telle qu'un MJ invité la lit (GET /api/campagne, sa projection) : qui joue, sans rien à y changer.
  htmlTableeEnLecture() {
    const t = (this.campagne.tablee || []).filter((j) => j.actif !== false);
    return `
      <h2>La tablée</h2>
      ${t.length ? `
      <table class="table-tablee">
        <thead><tr><th>Joueur</th><th>Personnage</th><th>Peuple</th><th>Vocation</th><th title="Chaque joueur a la couleur de ses dés">Dés</th></tr></thead>
        <tbody>${t.map((j) => `
          <tr class="lie">
            <td>${e(j.joueur || "?")}</td>
            <td>${e(j.personnage || "sans nom")}</td>
            <td>${e(j.peuple || "")}</td>
            <td>${e(j.vocation || "")}</td>
            <td><span class="pastille" style="background:${e(j.couleur || "#888")}"></span></td>
          </tr>`).join("")}
        </tbody>
      </table>` : '<p class="aide">Personne encore à la tablée.</p>'}
      <p class="aide">Groupe de niveau ${e(String(this.campagne.niveau || 1))}. La tablée et le niveau sont ceux de la campagne : une quête annexe compte pour l'or, les objets et l'état des héros, pas pour le niveau.</p>`;
  }

  htmlReputation() {
    const r = this.campagne.reputations || [];
    return `
      <h2>La réputation</h2>
      <p class="aide">Pas de chiffres : une ligne par région, ce dont les gens se souviennent. Elle change l'accueil, les prix, les contrats, et de 10 à 20 aux tests de Social.</p>
      <ul class="lignes-reputation">${r.map((x, i) => `
        <li>
          <input type="text" value="${e(x.region || "")}" data-r="${i}" data-rc="region" aria-label="Région" placeholder="La vallée">
          <input type="text" value="${e(x.souvenir || "")}" data-r="${i}" data-rc="souvenir" aria-label="Ce dont on se souvient" placeholder="Les aventuriers qui ont tabassé l'intendant">
          <button class="lien-danger" data-action="reputation-retirer" data-i="${i}">Retirer</button>
          ${x.numero ? `<span class="meta">séance ${x.numero}</span>` : ""}
        </li>`).join("")}
      </ul>
      <div class="actions"><button data-action="reputation-ajouter">Ajouter une région</button></div>`;
  }

  // ---- Une séance ----

  boutonPrecedemment(s) {
    if (this.table?.vue === "precedemment") return '<button data-action="precedemment-fin">Terminer le « Précédemment »</button>';
    const prec = this.precedente(s);
    return prec
      ? `<button data-action="precedemment" data-seance="${e(prec.id)}" title="Le résumé de la séance ${prec.numero} sur la TV">Précédemment…</button>`
      : '<button disabled title="Aucune séance précédente close avec un résumé">Précédemment…</button>';
  }

  // La liste des scénarios. Un ancien texte sans scénario du même nom reste affiché tel quel, jusqu'à un autre choix.
  htmlScenario(s) {
    const lie = scenarioDe(s, this.scenarios);
    const libre = !lie && (s.scenario || "").trim();
    return `
      <label class="champ">Scénario<select data-scenario>
        <option value="">Aucun</option>
        ${libre ? `<option value=":texte" selected>${e(tronquer(s.scenario, 60))} (sans lien)</option>` : ""}
        ${this.scenarios.map((x) => `<option value="${e(x.id)}" ${lie?.id === x.id ? "selected" : ""}>${e(x.nom || "Scénario sans titre")}</option>`).join("")}
      </select></label>`;
  }

  lienScenario(s) {
    const lie = scenarioDe(s, this.scenarios);
    return lie ? `<a class="bouton" href="#/scenarios/${e(lie.id)}" title="${e(lie.nom || "")}">Ouvrir le scénario</a>` : "";
  }

  afficherSeance() {
    const s = this.seance;
    this.racine.querySelector(".seances-corps").innerHTML = `
      <div class="seance">
        <header class="tete-seance">
          <div class="titre">
            <p class="kicker">Séance ${s.numero ?? ""}${s.close ? " · jouée" : ""}</p>
            <div class="titre-avec-temoin"><input class="nom-seance" type="text" value="${e(s.nom || "")}" data-s="nom" placeholder="Titre de la séance" aria-label="Titre de la séance">${htmlTemoin(this.modifs.seance.size ? "modifie" : "ok")}</div>
            <div class="quand">
              <label class="champ">Date<input type="date" value="${e(s.date || "")}" data-s="date"></label>
              <label class="champ">Heure<input type="time" value="${e(s.heure || "")}" data-s="heure"></label>
              ${this.htmlScenario(s)}
            </div>
          </div>
          <div class="actions-seance">
            <span class="lien-scenario">${this.lienScenario(s)}</span>
            <a class="bouton" href="/fiche-seance?id=${e(s.id)}" target="_blank" rel="noopener">Fiche d'une page</a>
            <a class="bouton" href="/feuille-combat?id=${e(s.id)}" target="_blank" rel="noopener">Feuille de combat</a>
            ${billetsDe(s).some((b) => (b.texte || "").trim()) ? `<a class="bouton" href="/billets?seance=${e(encodeURIComponent(s.id))}" target="_blank" rel="noopener" title="La feuille des billets secrets, à découper">Billets</a>` : ""}
            <span class="precedemment-bouton">${this.boutonPrecedemment(s)}</span>
            <button class="lien-danger" data-action="seance-supprimer">Mettre à la corbeille</button>
            <a class="lien-versions" href="${lienVersions("seances", s.id, `#/seances/${s.id}`)}">Versions</a>
          </div>
        </header>
        <nav class="onglets-seance" role="tablist" aria-label="Moments de la séance">
          ${ONGLETS.map(([k, n]) => `<button role="tab" data-onglet-seance="${k}" aria-selected="${this.onglet === k}">${n}</button>`).join("")}
        </nav>
        <div class="bandeau-seance" role="region" aria-label="Le fil de la séance" hidden></div>
        <div class="contenu-onglet" role="tabpanel"></div>
      </div>`;
    this.afficherOnglet();
  }

  afficherOnglet() {
    const s = this.seance;
    if (!s) return;
    clearInterval(this.minuterie);
    const zone = this.racine.querySelector(".contenu-onglet");
    zone.innerHTML = this.onglet === "jouer" ? this.ongletJouer(s) : this.onglet === "clore" ? this.ongletClore(s) : this.ongletPreparer(s);
    zone.querySelectorAll("textarea").forEach(ajuster);
    if (this.onglet === "clore") this.pourLeCarnet.verifier();
    if (this.onglet === "jouer") {
      this.compagnie.monter(zone.querySelector(".compagnie"));
      this.majHoraire();
      this.minuterie = setInterval(() => {
        this.majHoraire();
        this.actualiser();
      }, 30000);
    }
    retenirOnglet(s, this.onglet);
    this.majBandeau();
    if (this.onglet === "jouer" && this.versLaScene) this.voirSceneEnCours();
    this.versLaScene = false;
  }

  // Le bandeau collant sous les onglets : dans Jouer, et dans tous les onglets de la séance qu'on joue aujourd'hui.
  majBandeau() {
    const zone = this.racine.querySelector(".bandeau-seance");
    const s = this.seance;
    if (!zone || !s) return;
    const html = this.onglet === "jouer" || seanceDuJour(s) ? htmlFilDeSeance(s, "bandeau") : "";
    zone.hidden = !html;
    if (zone.innerHTML !== html) zone.innerHTML = html;
  }

  // À l'arrivée dans Jouer, une fois la partie commencée : la scène en cours en vue, plutôt que « Qui est là ».
  // Après le premier dessin de la compagnie, qui pousse le fil vers le bas. force : le clic sur « En cours ».
  voirSceneEnCours(force = false) {
    const s = this.seance;
    const lignes = s?.deroule || [];
    if (!force && !lignes.some((d) => d.fait || d.en_cours)) return;
    Promise.resolve().then(() => this.chargementCompagnie).then(() => requestAnimationFrame(() => {
      const i = sceneEnCours(s);
      const li = this.seance === s && i >= 0 ? this.racine.querySelector(`.deroule-jeu [data-fait="${i}"]`)?.closest("li") : null;
      li?.scrollIntoView({ block: "center", behavior: force ? "smooth" : "auto" });
    }));
  }

  // La scène suivante d'un geste (bandeau, Tableau, télécommande) : la scène en cours se coche, la suivante se joue
  // comme « Jouer la scène », sur la copie de cette page, enregistrée aussitôt. attendu : ce que le bouton annonçait.
  async jouerLaSuite(s, attendu) {
    const quand = new Date().toISOString();
    const pas = avancer(s, attendu, quand);
    let bilan = { texte: pas.refus, erreur: !pas.deja, refus: true, deja: pas.deja };
    if (!pas.refus) {
      this.marquer("seance", s.id);
      this.sauver.maintenant();
      bilan = await jouerLaScene({ seance: s, i: pas.i, r: liensResolus(s.deroule[pas.i], this.contexteLiens(s)), musique: etatMusique(), quand },
        envoisDuGeste(s.id, { lancerAmbiance: jouerAmbiance }));
      this.table = await api.get("/api/table").catch(() => this.table);
    }
    if (!this.detruit && s === this.seance) {
      // Préparer montre aussi le repère de la scène en cours : il se redessine.
      if (this.onglet === "preparer" && !pas.refus) this.afficherOnglet();
      this.majDerouleJeu();
      this.majBoutonsTable();
      this.majHoraire();
      this.majBandeau();
      // La première scène jouée fait d'elle la séance du jour : « en cours » dans la liste.
      this.afficherListe();
    }
    return bilan;
  }

  // Seulement pour la séance affichée : une autre, peut-être changée ailleurs depuis l'ouverture de la page, se joue
  // hors d'ici (scene-suivante.js), relue et enregistrée avec sa version ; elle se relit quand on l'ouvre (aller).
  sceneSuivanteDemandee(ev) {
    const s = this.seance;
    if (this.detruit || !s || s.close || s.id !== ev.detail?.seance) return;
    ev.preventDefault();
    ev.detail.resultat = this.jouerLaSuite(s, ev.detail.attendu);
  }

  // La séance affichée, relue si un autre écran l'a changée et que rien n'attend d'être enregistré ici : le fil, le
  // bandeau et le journal suivent.
  async actualiser() {
    const s = this.seance;
    const occupee = () => this.modifs.seance.size > 0 || this.sauver.enAttente() || this.envois > 0;
    if (this.detruit || !s || occupee() || this.relecture) return;
    this.relecture = true;
    let frais = null;
    try {
      frais = await api.get(`/api/seances/${encodeURIComponent(s.id)}`);
    } catch {
      // serveur muet : on garde ce qu'on a
    } finally {
      this.relecture = false;
    }
    if (!frais || this.detruit || this.seance !== s || occupee()) return;
    // Une ligne notée ailleurs ne change pas la version de la séance : le journal se compare à part.
    if (frais.modifie === s.modifie) return this.journalModifie({ id: s.id, journal: frais.journal || [] });
    this.bases.seances[s.id] = copie(frais);
    for (const k of Object.keys(s)) if (!(k in frais)) delete s[k];
    Object.assign(s, copie(frais));
    if (this.onglet === "jouer") {
      this.majDerouleJeu();
      const liste = this.racine.querySelector("ol.journal");
      if (liste) liste.outerHTML = this.htmlJournal(s);
      this.majHoraire();
    }
    this.majBandeau();
  }

  texteTotal(s) {
    const lignes = s.deroule || [];
    const total = lignes.reduce((t, d) => t + (+d.duree || 0), 0);
    const debut = enMinutes(lignes[0]?.heure || s.heure);
    if (!total) return "";
    return `Durée prévue : ${duree(total)}${debut !== null ? `, fin vers ${heureFr(enHeure(debut + total))}` : ""}.`;
  }

  htmlDeroule(s) {
    const lignes = s.deroule || [];
    return `
      <ol class="scenes">${lignes.map((d, i) => `
        <li class="scene${htmlRepere(d) ? " en-cours" : ""}${d.propose ? " proposee" : ""}">${htmlRepere(d, "p")}${htmlMarqueScene(d, i)}
          <div class="ligne">
            <input type="time" value="${e(d.heure || "")}" data-d="${i}" data-dc="heure" aria-label="Heure">
            <input type="text" value="${e(d.titre || "")}" data-d="${i}" data-dc="titre" aria-label="Scène">
            <label class="duree"><input type="number" min="0" step="5" value="${d.duree ?? ""}" data-d="${i}" data-dc="duree" aria-label="Durée en minutes"><span>min</span></label>
            <span class="outils">
              <button data-action="scene-monter" data-i="${i}" ${i ? "" : "disabled"} title="Monter" aria-label="Monter">↑</button>
              <button data-action="scene-descendre" data-i="${i}" ${i < lignes.length - 1 ? "" : "disabled"} title="Descendre" aria-label="Descendre">↓</button>
              <button class="lien-danger" data-action="scene-retirer" data-i="${i}">Retirer</button>
            </span>
          </div>
          <textarea rows="1" data-d="${i}" data-dc="note" placeholder="À ne pas oublier : un moment pour chaque joueur, une règle à montrer" aria-label="À ne pas oublier">${e(d.note || "")}</textarea>
          ${this.proposer.htmlScene(s, d, i)}
          ${htmlLier(d, i, this.contexteLiens(s), this.liensOuverts.has(d))}
        </li>`).join("")}
      </ol>
      <p class="aide total-deroule">${e(this.texteTotal(s))}</p>`;
  }

  htmlChoix(s, cle, titre, liste, libelle, lien) {
    const ids = s[cle] || [];
    const choisis = ids.map((id) => liste.find((x) => x.id === id)).filter(Boolean);
    const reste = liste.filter((x) => !ids.includes(x.id) && (cle !== "rumeurs" || !x.etat || x.etat === "a-placer"));
    // Les lignes proposées à la clôture de la séance d'avant attendent sous les puces (propose.js).
    const proposes = proposesDe(s, cle);
    return `
      <div class="choix" data-choix="${cle}">
        <h3>${titre} <span class="compte">${choisis.length || ""}</span></h3>
        <ul class="puces">${choisis.filter((x) => !(x.id in proposes)).map((x) => `
          <li><a href="${e(lien(x))}">${e(tronquer(libelle(x), 64))}</a><button class="retirer-puce" data-action="puce-retirer" data-cle="${cle}" data-id="${e(x.id)}" aria-label="Retirer ${e(tronquer(libelle(x), 40))}">×</button></li>`).join("")}
        </ul>
        ${htmlProposes(s, cle, choisis.filter((x) => x.id in proposes).map((x) => ({ id: x.id, libelle: tronquer(libelle(x), 64), lien: lien(x) })))}
        ${reste.length ? `<select data-ajouter="${cle}" aria-label="Ajouter : ${e(titre)}"><option value="">Ajouter…</option>${reste.map((x) => `<option value="${e(x.id)}">${e(tronquer(libelle(x), 72))}</option>`).join("")}</select>` : ""}
      </div>`;
  }

  lignesAvantDeJouer(s) {
    return avantDeJouer(s, {
      pnj: this.pnj, lieux: this.lieux, rencontres: this.rencontres, tablee: this.campagne.tablee || [], niveau: +this.campagne.niveau || 1,
      plans: this.plans, confort: this.confort, scenarios: this.scenarios,
    });
  }

  // « Avant de jouer » suit les liens des scènes (un plan tout noir lié, une rencontre choisie), sans redessiner Préparer.
  majAvantDeJouer() {
    const s = this.seance;
    if (!s || this.onglet !== "preparer") return;
    const html = htmlAvantDeJouer(this.lignesAvantDeJouer(s));
    const ancien = this.racine.querySelector(".avant-de-jouer");
    if (ancien) ancien.outerHTML = html;
    else if (html) this.racine.querySelector(".colonnes-seance")?.insertAdjacentHTML("beforebegin", html);
  }

  ongletPreparer(s) {
    return `
      ${this.suite.htmlBandeau(s)}
      ${htmlAvantDeJouer(this.lignesAvantDeJouer(s))}
      <div class="colonnes-seance">
        <div>
          <label class="champ">Titre montré aux joueurs<input type="text" data-s="titre_episode" value="${e(s.titre_episode || "")}" placeholder="${e(s.nom || "")}"></label>
          <p class="aide aide-champ">Le carton-titre de la TV, au début de la séance. Laissé vide, il annonce le nom de la séance : choisissez-en un autre s'il dévoile la suite.</p>
          <label class="champ">Objectif de la séance<textarea rows="2" data-s="objectif">${e(s.objectif || "")}</textarea></label>
          <h2>Déroulé</h2>
          ${this.proposer.html(s)}
          <div class="deroule">${this.htmlDeroule(s)}</div>
          <div class="actions">
            <button data-action="scene-ajouter">Ajouter une scène</button>
            <button data-action="recaler" title="Recalcule les heures à partir de la première ligne et des durées">Recaler les heures</button>
          </div>
          <label class="champ">En retard ? Ce qu'on peut couper<textarea rows="2" data-s="conseils">${e(s.conseils || "")}</textarea></label>
          <label class="champ">Pour finir<textarea rows="2" data-s="fin">${e(s.fin || "")}</textarea></label>
          <label class="champ">Notes<textarea rows="3" data-s="notes">${e(s.notes || "")}</textarea></label>
        </div>
        <div>
          <h2>Sous la main</h2>
          ${htmlRubrique(s, "pnj", this.listesSousLaMain())}
          ${htmlRubrique(s, "lieux", this.listesSousLaMain())}
          ${this.htmlChoix(s, "contrats", "Affiches", this.contrats, (c) => c.nom, (c) => `#/auberge/contrat/${c.id}`)}
          ${this.htmlChoix(s, "rumeurs", "Rumeurs à placer", this.rumeurs, (r) => r.texte || "Rumeur", (r) => `#/auberge/rumeur/${r.id}`)}
          ${htmlRubrique(s, "rencontres", this.listesSousLaMain())}
          ${htmlRubrique(s, "documents", this.listesSousLaMain())}
          <label class="champ">Questions à trancher en fin de séance<textarea rows="4" data-s="questions">${e(s.questions || "")}</textarea></label>
          ${s.reputations_a_noter ? `<p class="aide">Réputation à noter : ${e(s.reputations_a_noter)}</p>` : ""}
          ${htmlBillets(s, this.campagne.tablee || [])}
          <h2>Les fils</h2>
          <ul class="fils-mini">${this.fils.filter((f) => f.actif !== false).map((f) => {
            const suivante = etapeSuivante(f);
            return `<li>${horloge((f.etapes || []).length, f.avance || 0, 30)}<span><b>${e(f.nom)}</b>${suivante ? `Ensuite : ${e(suivante.texte)}` : "Arrivé au bout."}</span></li>`;
          }).join("") || '<li class="vide">Aucun fil actif.</li>'}</ul>
        </div>
      </div>`;
  }

  ongletJouer(s) {
    const actifs = (this.campagne.tablee || []).filter((j) => j.actif !== false);
    const presents = new Set(s.presents || []);
    return `
      <div class="colonnes-seance jouer">
        <div>
          <h2>Qui est là</h2>
          ${actifs.length ? `
          <ul class="presents">${actifs.map((j) => `
            <li><label class="case"><input type="checkbox" data-present="${e(j.id)}" ${presents.has(j.id) ? "checked" : ""}>
              <span class="pastille" style="background:${e(j.couleur || "#888")}"></span>${e(j.joueur || "?")}${j.personnage ? ` <i>${e(j.personnage)}</i>` : ""}</label></li>`).join("")}
          </ul>
          <p class="aide">Un absent est simplement « parti sur un autre contrat ».</p>` : '<p class="aide">La tablée est vide : <a href="#/seances" data-aller="">ajoutez les joueurs</a>.</p>'}
          <section class="compagnie" aria-label="La compagnie : état et sac des héros"></section>
          <h2>Le fil de la séance</h2>
          <p class="horaire" aria-live="polite"></p>
          ${this.htmlDerouleJeu(s)}
          ${s.conseils ? `<p class="aide">${e(s.conseils)}</p>` : ""}
          ${s.fin ? `<p class="aide">${e(s.fin)}</p>` : ""}
        </div>
        <div>
          <h2>Journal</h2>
          <form class="journal-saisie" data-journal>
            <input type="text" name="texte" placeholder="Ce qui vient de se passer, puis Entrée" aria-label="Nouvelle ligne du journal" autocomplete="off">
            <button>Noter</button>
          </form>
          ${this.htmlJournal(s)}
          <h2>À montrer</h2>
          ${this.htmlAMontrer(s)}
          ${htmlBilletsJeu(s, this.campagne.tablee || [])}
        </div>
      </div>`;
  }

  // Ce que les liens d'une scène désignent, et l'état de la TV et de la musique pour leurs boutons.
  contexteLiens(s) {
    return { seance: s, plans: this.plans, pnj: this.pnj, rencontres: this.rencontres, ambiances: this.ambiances, table: this.table, musique: etatMusique(), documents: this.documents };
  }

  // Le fil de la séance : la scène en cours (la première non cochée) porte ses liens en boutons.
  htmlDerouleJeu(s) {
    const lignes = s.deroule || [];
    const courante = sceneEnCours(s);
    const ctx = this.contexteLiens(s);
    return `
          <ol class="deroule-jeu">${lignes.map((d, i) => {
            const liens = i === courante ? htmlLiensJeu(d, ctx, i) : "";
            // Les billets de la scène en cours, à remettre (billets.js).
            const billets = i === courante ? htmlRappel(s, i, this.campagne?.tablee || []) : "";
            const repere = htmlRepere(d);
            return `
            <li class="${[d.fait ? "fait" : "", liens ? "avec-liens" : "", repere ? "en-cours" : ""].filter(Boolean).join(" ")}"><label class="case"><input type="checkbox" data-fait="${i}" ${d.fait ? "checked" : ""}>
              <span class="heure">${e(heureFr(d.heure))}</span><span><b>${e(d.titre || "")}</b>${repere}${d.note ? `<small>${e(d.note)}</small>` : ""}</span></label>${billets}${liens}</li>`;
          }).join("")}
          </ol>`;
  }

  // Une scène cochée ou décochée : la suivante non cochée prend les boutons. La case garde le focus.
  majDerouleJeu() {
    const liste = this.racine.querySelector("ol.deroule-jeu");
    if (!liste || !this.seance || this.onglet !== "jouer") return;
    const focus = document.activeElement?.dataset?.fait;
    liste.outerHTML = this.htmlDerouleJeu(this.seance);
    if (focus !== undefined) this.racine.querySelector(`[data-fait="${CSS.escape(focus)}"]`)?.focus();
    this.majBandeau();
  }

  // Les boutons de la scène en cours suivent la TV et la musique, sans redessiner le reste.
  majLiensJeu() {
    const s = this.seance;
    if (this.detruit || !s || this.onglet !== "jouer") return;
    const courante = sceneEnCours(s);
    const li = courante < 0 ? null : this.racine.querySelector(`[data-fait="${courante}"]`)?.closest("li");
    if (!li) return;
    const html = htmlLiensJeu(s.deroule[courante], this.contexteLiens(s), courante);
    const ancien = li.querySelector(".liens-jeu");
    if (ancien) ancien.outerHTML = html;
    else if (html) li.insertAdjacentHTML("beforeend", html);
    li.classList.toggle("avec-liens", Boolean(html));
  }

  // Un lien posé ou retiré dans Préparer : seul son « Lier » se redessine, ouvert, et le choix garde le focus.
  majLier(i, focus) {
    const s = this.seance;
    const d = s?.deroule?.[i];
    const ancien = this.racine.querySelector(`details[data-liens="${i}"]`);
    if (!d || !ancien) return;
    this.liensOuverts.add(d);
    ancien.outerHTML = htmlLier(d, i, this.contexteLiens(s), true);
    this.majAvantDeJouer();
    this.majSousLaMain();
    if (focus) this.racine.querySelector(`[data-ls="${i}"][data-lien="${focus}"]`)?.focus();
  }

  // Ce que les scènes lient entre dans « Sous la main » (sous-la-main.js) : les fiches qu'il lit.
  listesSousLaMain() {
    return { pnj: this.pnj, lieux: this.lieux, rencontres: this.rencontres, plans: this.plans, documents: this.documents };
  }

  // Un lien de scène posé ou défait : « Sous la main » suit, sans redessiner Préparer.
  majSousLaMain() {
    const s = this.seance;
    if (!s || this.onglet !== "preparer") return;
    for (const genre of ["pnj", "lieux", "rencontres", "documents"]) {
      const ancien = this.racine.querySelector(`.choix[data-choix="${genre}"]`);
      if (ancien) ancien.outerHTML = htmlRubrique(s, genre, this.listesSousLaMain());
    }
  }

  // « par la scène de 18 h 15 » : le « Lier » de cette scène s'ouvre, en vue.
  voirLier(i) {
    const det = this.racine.querySelector(`details[data-liens="${i}"]`);
    if (!det) return;
    det.open = true;
    det.scrollIntoView({ block: "center", behavior: "smooth" });
    det.querySelector("summary")?.focus({ preventScroll: true });
  }

  htmlJournal(s) {
    return `
          <ol class="journal">${(s.journal || []).map((j, i) => ({ j, i })).reverse().map(({ j, i }) => `
            <li><span class="heure">${e(heureFr(j.t))}</span><span class="texte">${e(j.texte)}</span><button class="lien-danger" data-action="journal-retirer" data-i="${i}">Retirer</button></li>`).join("")}
          </ol>`;
  }

  // Le journal ne part jamais avec la séance : chaque ligne s'ajoute ou se retire par les routes du journal
  // (journal.js), d'ici comme du bouton « Journal » de l'en-tête. La liste se redessine seule, le champ reste tel quel.
  async noterLigne(champ) {
    const texte = champ.value.trim();
    const s = this.seance;
    if (!texte || !s) return;
    champ.value = "";
    try {
      await noterAuJournal(s.id, texte);
    } catch (err) {
      if (!champ.value) champ.value = texte;
      toast(`Ligne non notée : ${err.message}`, "erreur");
    }
  }

  // Retirée d'un clic, sans confirmation : « Annuler », dix secondes, la remet à sa place avec son heure.
  async retirerLigne(s, rang) {
    const ligne = (s.journal || [])[rang];
    if (!ligne) return;
    const apres = rang > 0 ? s.journal[rang - 1]?.id || null : null;
    try {
      await retirerDuJournal(s.id, ligne, rang);
    } catch (err) {
      toast(`Ligne non retirée : ${err.message}`, "erreur");
      await this.relireJournal(s);
      return;
    }
    const texte = String(ligne.texte || "").replace(/[\s.]+$/, "");
    toast(`Ligne retirée : « ${texte.length > 60 ? `${texte.slice(0, 58).trimEnd()}…` : texte} ».`, "info", {
      action: {
        libelle: "Annuler",
        faire: () => remettreAuJournal(s.id, ligne, apres, rang).catch((err) => toast(`Ligne non remise : ${err.message}`, "erreur")),
      },
    });
  }

  async relireJournal(s) {
    try {
      const fraiche = await api.get(`/api/seances/${encodeURIComponent(s.id)}`);
      this.journalModifie({ id: s.id, journal: fraiche.journal || [] });
    } catch {
      // on garde la liste affichée
    }
  }

  // Le journal d'une séance a changé (ici, dans l'en-tête, ou relu du serveur après un enregistrement).
  journalModifie({ id, journal } = {}) {
    const s = this.seances?.find((x) => x.id === id);
    if (this.detruit || !s || !Array.isArray(journal)) return;
    if (this.bases.seances[id]) this.bases.seances[id].journal = copie(journal);
    if (JSON.stringify(s.journal || []) === JSON.stringify(journal)) return;
    s.journal = copie(journal);
    const liste = this.racine.querySelector("ol.journal");
    if (liste && this.seance === s && this.onglet === "jouer") liste.outerHTML = this.htmlJournal(s);
  }

  // Le bouton « Journal » de l'en-tête suit la séance du jour : il apprend ici une date, une clôture, une séance neuve.
  annoncerSeances() {
    window.dispatchEvent(new CustomEvent("seances-modifiees", { detail: { seances: copie(this.seances) } }));
  }

  majHoraire() {
    const zone = this.racine.querySelector(".horaire");
    const s = this.seance;
    if (!zone || !s) return;
    const lignes = s.deroule || [];
    const i = sceneEnCours(s);
    const maintenant = new Date().getHours() * 60 + new Date().getMinutes();
    if (i < 0) {
      zone.textContent = lignes.length ? "Toutes les scènes sont jouées." : "";
      return;
    }
    const d = lignes[i];
    const debut = enMinutes(d.heure);
    // L'heure du jour n'a de sens que si la séance se joue aujourd'hui : sinon, « Il est 10 h » à côté d'une scène de 18 h déroute.
    const aujourdhuiMeme = s.date === new Date().toLocaleDateString("sv");
    let texte = `${aujourdhuiMeme ? `Il est ${heureFr(enHeure(maintenant))}. ` : ""}En cours : ${d.titre || `scène ${i + 1}`}`;
    if (debut !== null && aujourdhuiMeme) {
      const finPrevue = debut + (+d.duree || 0);
      if (maintenant > finPrevue) texte += `, prévue jusqu'à ${heureFr(enHeure(finPrevue))} : ${duree(maintenant - finPrevue)} de retard.`;
      else if (maintenant < debut) texte += `, prévue à ${heureFr(d.heure)} : ${duree(debut - maintenant)} d'avance.`;
      else texte += ", dans les temps.";
    } else texte += ".";
    zone.textContent = texte;
  }

  libelleEpisode(s) {
    return [`Épisode ${s.numero ?? "?"}`, titreEpisode(s)].filter(Boolean).join(" · ");
  }

  htmlAMontrer(s) {
    const t = this.table || {};
    // « Sous la main » et ce que lient les scènes, dans l'ordre du déroulé (sous-la-main.js).
    const sous = sousLaMain(s, this.listesSousLaMain());
    const pnj = sous.pnj.map((x) => x.fiche);
    const contrats = (s.contrats || []).map((id) => this.contrats.find((c) => c.id === id)).filter(Boolean);
    const rumeurs = (s.rumeurs || []).map((id) => this.rumeurs.find((r) => r.id === id)).filter(Boolean);
    const rencontres = sous.rencontres.map((x) => x.fiche);
    const plans = plansDeLaSeance(s, this.plans, sous);
    return `
      <div class="a-montrer">
        <h3>Épisode</h3>
        <ul>
          <li><span class="libelle-episode">${e(this.libelleEpisode(s))}</span>
            ${t.vue === "episode" && t.seance === s.id ? '<button data-action="episode-fin">Retirer</button>' : `<button data-action="episode-montrer" title="Fondu au noir, puis le numéro et le titre de l'épisode sur la TV">Montrer le titre</button>`}</li>
        </ul>
        ${plans.length ? `<h3>Plans</h3>
        <ul>${plans.map((p) => `
          <li><span>${e(p.nom)}</span><a class="bouton" href="#/plan/${e(p.id)}" title="Révéler les pièces, poser et bouger les pions">Jouer</a>
            ${t.vue === "plan" && t.plan === p.id ? '<button data-action="accueil">Retirer</button>' : `<button data-action="plan-montrer" data-plan="${e(p.id)}">Montrer</button>`}</li>`).join("")}
        </ul>` : ""}
        <h3>PNJ</h3>
        <ul>${pnj.map((p) => `
          <li><span>${e(p.nom + marqueSort(p))}${p.connu ? "" : ' <span class="inconnu" title="Inconnu des joueurs"></span>'}</span>
            ${t.pnj === p.id ? '<button data-action="pnj-retirer">Retirer</button>' : `<button data-action="pnj-montrer" data-pnj="${e(p.id)}">Montrer</button>`}</li>`).join("") || '<li class="vide">Aucun PNJ prévu.</li>'}
        </ul>
        ${rencontres.length || s.combat ? `<h3>Rencontres</h3>
        <ul>${s.combat && !rencontres.some((r) => r.id === s.combat.rencontre) ? `
          <li><span>Combat en cours : ${e(s.combat.nom || "Rencontre")}, tour ${e(s.combat.tour)}</span><a class="bouton" href="#/combat/${e(s.id)}">Reprendre le combat</a></li>` : ""}${rencontres.map((r) => `
          <li><span>${e(r.nom || "Rencontre")}${r.verdict && VERDICTS[r.verdict.cle] ? ` <i>(${e(VERDICTS[r.verdict.cle].nom.toLowerCase())})</i>` : ""}${s.combat?.rencontre === r.id ? ` <i>· combat en cours, tour ${e(s.combat.tour)}</i>` : ""}</span>
            <span class="boutons"><a class="bouton" href="#/combats/${e(r.id)}" title="Les adversaires et leur verdict, dans l'onglet Combats">Ouvrir dans la balance</a>
            <a class="bouton" href="${e(lienCombat(s, r))}" title="Ordre du tour, Santé, cartons et rappels du kit">${s.combat?.rencontre === r.id ? "Reprendre le combat" : "Lancer le combat"}</a></span></li>`).join("")}
        </ul>` : ""}
        <h3>Affiches</h3>
        <ul>${contrats.map((c) => `<li><span>${e(c.nom)}</span><button data-action="contrat-montrer" data-contrat="${e(c.id)}">Montrer de près</button></li>`).join("")}
          <li><span>Toute la planche</span>${t.vue === "planche" ? '<button data-action="planche-retirer">Retirer</button>' : '<button data-action="planche-montrer">Montrer</button>'}</li>
        </ul>
        ${htmlDocumentsAMontrer(sous.documents.map((x) => x.fiche), t)}
        <h3>Rumeurs</h3>
        <ul>${rumeurs.map((r) => `
          <li><span>«&nbsp;${e(tronquer(r.texte, 90))}&nbsp;»</span>
            ${t.rumeur === r.id ? '<button data-action="taire">Taire</button>' : `<button data-action="raconter" data-rumeur="${e(r.id)}">Raconter</button>`}</li>`).join("") || '<li class="vide">Aucune rumeur prévue.</li>'}
        </ul>
        <div class="actions"><button data-action="accueil">Écran d'accueil</button></div>
      </div>`;
  }

  ongletClore(s) {
    const touches = new Set(s.fils_touches || []);
    const avances = s.avances || {};
    const niveau = this.campagne.niveau || 1;
    return `
      ${s.close ? this.suite.htmlBandeauClose(s) : ""}
      <div class="colonnes-seance clore">
        <div>
          <label class="champ">Ce qui s'est passé, en vrac<textarea rows="5" data-s="resume" placeholder="Ce qui compte pour la suite : qui a quoi, qui en veut à qui.">${e(s.resume || "")}</textarea></label>
          <div class="actions"><button data-action="rediger" data-estimation="precedemment" title="Le serveur l'écrit à partir du journal et de ce résumé">Rédiger le « Précédemment »</button></div>
          <label class="champ">« ${e(TITRE_PRECEDEMMENT)}… »<textarea rows="6" data-s="precedemment">${e(s.precedemment || "")}</textarea></label>
          <p class="aide">Affiché sur la TV au début de la séance suivante, et envoyé aux joueurs. Rien de secret : ils le liront.</p>
          <div class="actions">
            <button data-action="copier-message" ${s.precedemment ? "" : "disabled"}>Copier le message aux joueurs</button>
            <button data-action="precedemment" data-seance="${e(s.id)}" ${s.precedemment ? "" : "disabled"}>Montrer à la TV</button>
          </div>
          <label class="champ">Butin<textarea rows="2" data-s="butin">${e(s.butin || "")}</textarea></label>
          <label class="champ">Ce que chacun a préféré<textarea rows="2" data-s="prefere">${e(s.prefere || "")}</textarea></label>
          <label class="champ">Questions encore ouvertes<textarea rows="4" data-s="questions">${e(s.questions || "")}</textarea></label>
        </div>
        <div>
          ${estInvite() ? `<h2>Réputation et niveau</h2>
          <p class="aide">Ceux de la campagne : une quête annexe compte pour l'or, les objets et l'état des héros, pas pour le niveau ni la réputation.</p>` : `
          <h2>Réputation</h2>
          ${s.reputations_a_noter ? `<p class="aide">À noter : ${e(s.reputations_a_noter)}</p>` : ""}
          <ul class="lignes-reputation">${(s.reputations || []).map((x, i) => `
            <li>
              <input type="text" value="${e(x.region || "")}" data-sr="${i}" data-src="region" aria-label="Région" placeholder="La vallée">
              <input type="text" value="${e(x.souvenir || "")}" data-sr="${i}" data-src="souvenir" aria-label="Ce dont on se souviendra">
              <button class="lien-danger" data-action="sr-retirer" data-i="${i}">Retirer</button>
            </li>`).join("")}
          </ul>
          <div class="actions"><button data-action="sr-ajouter">Ajouter une région</button></div>
          <h2>Niveau</h2>
          <label class="case"><input type="checkbox" data-s-case="niveau_gagne" ${s.niveau_gagne ? "checked" : ""} ${s.close ? "disabled" : ""}> Le groupe passe au niveau ${s.close && s.niveau_gagne ? niveau : niveau + 1}</label>
          <p class="aide">${e(this.texteNiveau())}</p>`}
          <h2>Le monde avance</h2>
          ${s.close ? this.htmlBilan(s) : `
          <p class="aide">Cochez les fils dont les héros se sont mêlés : ils ne bougent pas. Les autres avancent selon leur rythme.</p>
          <ul class="monde">${this.fils.filter((f) => f.actif !== false).map((f) => {
            const touche = touches.has(f.id);
            const suivante = etapeSuivante(f);
            const avance = !touche && suivante && (f.id in avances ? avances[f.id] : Boolean(proposition(f, touche)));
            return `
            <li>
              ${horloge((f.etapes || []).length, f.avance || 0, 34)}
              <div>
                <b>${e(f.nom)}</b>
                <label class="case"><input type="checkbox" data-touche="${e(f.id)}" ${touche ? "checked" : ""}> Les héros s'en sont mêlés</label>
                <label class="case"><input type="checkbox" data-avance="${e(f.id)}" ${avance ? "checked" : ""} ${touche || !suivante ? "disabled" : ""}> ${suivante ? `Avance : ${e(suivante.texte)}` : "Arrivé au bout"}</label>
                ${avance && suivante.rumeur ? `<small>Rumeur à placer : «&nbsp;${e(suivante.rumeur)}&nbsp;»</small>` : ""}
              </div>
            </li>`;
          }).join("") || '<li class="vide">Aucun fil actif.</li>'}</ul>
          ${this.pourLeCarnet.html(s)}
          <div class="actions"><button class="principal" data-action="clore">Clore la séance</button></div>`}
        </div>
      </div>`;
  }

  htmlBilan(s) {
    const b = s.bilan || {};
    return `
      <p>Séance close${s.close_le ? ` le ${e(new Date(s.close_le).toLocaleDateString("fr-CH", { day: "numeric", month: "long" }))}` : ""}.</p>
      <ul class="bilan">${(b.lignes || []).map((l) => `<li>${e(l)}</li>`).join("") || "<li>Aucun fil n'a bougé.</li>"}</ul>
      <div class="actions"><button data-action="rouvrir">Rouvrir la séance</button></div>
      <p class="aide">Rouvrir ne fait pas reculer les fils : le monde a déjà avancé.</p>
      ${this.pourLeCarnet.html(s)}
      ${this.suite.htmlClore(s)}`;
  }

  // ---- Saisie ----

  // id : la séance ou le fil concerné ; pour une séance, celle affichée par défaut (un texte rédigé qui arrive après
  // un changement de séance doit marquer celle qui le reçoit, pas celle qu'on regarde).
  marquer(genre, id) {
    if (genre === "seance") {
      const cible = id || this.seance?.id;
      if (!cible) return;
      this.modifs.seance.add(cible);
    }
    else if (genre === "campagne") {
      // La campagne est celle du MJ principal : un MJ invité la lit sans l'écrire (PUT /api/campagne lui est fermé).
      if (estInvite()) return;
      this.modifs.campagne = true;
    }
    else this.modifs.fils.add(id);
    afficherTemoin(this.racine.querySelector(".seances-corps .temoin-enregistrement"), "modifie");
    this.sauver();
  }

  saisie(ev, change) {
    const el = ev.target;
    const d = el.dataset;
    const discret = el.type === "checkbox" || el.type === "color" || el.tagName === "SELECT" || el.type === "date" || el.type === "time";
    if (el.tagName === "TEXTAREA" && !change) ajuster(el);
    if (el.closest(".billets-seance, .billets-jeu, .billets-scene") && this.billets.saisie(el, change)) return;
    // Le « Précédemment » (et le texte écrit pour le carnet) s'enregistre à la frappe, mais ne se vérifie qu'en quittant le champ.
    if (change && (d.s === "precedemment" || d.s === "precedemment_carnet") && !discret) {
      this.pourLeCarnet.verifier();
      return this.verifierNomCache(el.value, d.s);
    }
    // Le titre de l'épisode part aussi vers la TV : même vérification, s'il est écrit.
    if (change && d.s === "titre_episode") return el.value.trim() ? this.verifierNomCache(el.value) : undefined;
    // Texte à la frappe ; listes, cases, dates et couleurs quand elles changent.
    if (discret !== change) return;
    const s = this.seance;
    const valeur = el.type === "checkbox" ? el.checked : el.value;

    if (d.ajouter && s && el.value) {
      s[d.ajouter] = [...(s[d.ajouter] || []), el.value];
      this.marquer("seance");
      return this.afficherOnglet();
    }
    if (d.scenario !== undefined && s) {
      if (el.value === ":texte") return;
      const choisi = this.scenarios.find((x) => x.id === el.value) || null;
      // Le nom reste écrit à côté du lien : la fiche A4 l'imprime.
      s.scenario_id = choisi ? choisi.id : null;
      s.scenario = choisi ? choisi.nom || "" : "";
      el.querySelector('option[value=":texte"]')?.remove();
      const lien = this.racine.querySelector(".lien-scenario");
      if (lien) lien.innerHTML = this.lienScenario(s);
      return this.marquer("seance");
    }
    if (d.s && s) {
      s[d.s] = valeur;
      this.marquer("seance");
      if (d.s === "nom" || d.s === "date") this.afficherListe();
      if (d.s === "date") this.majBandeau();
      if (d.s === "date") this.suite.dateChoisie(s);
      if (d.s === "nom" || d.s === "titre_episode") this.majEpisode(s);
      if (d.s === "precedemment" && this.onglet === "clore") {
        this.racine.querySelectorAll('[data-action="copier-message"], .clore [data-action="precedemment"]').forEach((b) => { b.disabled = !valeur.trim(); });
      }
      return;
    }
    if (d.sCase && s) {
      s[d.sCase] = valeur;
      return this.marquer("seance");
    }
    if (d.ls !== undefined && d.lien && s) {
      const ligne = s.deroule?.[+d.ls];
      if (!ligne) return;
      lier(ligne, d.lien, el.value);
      this.marquer("seance");
      return this.majLier(+d.ls, d.lien);
    }
    if (d.d !== undefined && s) {
      const ligne = s.deroule[+d.d];
      ligne[d.dc] = d.dc === "duree" ? (el.value === "" ? null : +el.value) : el.value;
      this.marquer("seance");
      const total = this.racine.querySelector(".total-deroule");
      if (total) total.textContent = this.texteTotal(s);
      if (d.dc === "titre") this.majBandeau();
      return;
    }
    if (d.present !== undefined && s) {
      const p = new Set(s.presents || []);
      if (valeur) p.add(d.present);
      else p.delete(d.present);
      s.presents = [...p];
      this.compagnie.afficher();
      return this.marquer("seance");
    }
    if (d.fait !== undefined && s) {
      s.deroule[+d.fait].fait = valeur;
      this.marquer("seance");
      this.majDerouleJeu();
      return this.majHoraire();
    }
    if (d.touche && s) {
      const t = new Set(s.fils_touches || []);
      if (valeur) t.add(d.touche);
      else t.delete(d.touche);
      s.fils_touches = [...t];
      this.marquer("seance");
      return this.afficherOnglet();
    }
    if (d.avance && s) {
      s.avances = { ...(s.avances || {}), [d.avance]: valeur };
      this.marquer("seance");
      return this.afficherOnglet();
    }
    if (d.sr !== undefined && s) {
      s.reputations[+d.sr][d.src] = el.value;
      return this.marquer("seance");
    }
    if (d.t !== undefined) {
      const j = this.campagne.tablee[+d.t];
      j[d.tc] = valeur;
      if (d.tc === "personnage") {
        const pre = PRETIRES.find((p) => p.personnage === el.value);
        if (pre && !j.peuple && !j.vocation) {
          [j.peuple, j.vocation] = [pre.peuple, pre.vocation];
          this.racine.querySelector(".tablee").innerHTML = this.htmlTablee();
        }
      }
      return this.marquer("campagne");
    }
    if (d.r !== undefined) {
      this.campagne.reputations[+d.r][d.rc] = el.value;
      return this.marquer("campagne");
    }
    if (d.c) {
      this.campagne[d.c] = el.type === "number" ? Math.max(1, +el.value || 1) : valeur;
      return this.marquer("campagne");
    }
    const carte = el.closest("[data-fil]");
    if (carte && (d.filChamp || d.etapeChamp)) {
      const f = this.fils.find((x) => x.id === carte.dataset.fil);
      if (!f) return;
      if (d.filChamp) f[d.filChamp] = valeur;
      else f.etapes[+d.etape][d.etapeChamp] = el.value;
      if (d.filChamp === "nom") carte.querySelector("h3").textContent = el.value || "Fil sans nom";
      this.marquer("fil", f.id);
      if (change && ["actif", "nom", "faction"].includes(d.filChamp)) this.remplacerFil(f);
    }
  }

  remplacerFil(f, ouvert = true) {
    const carte = this.racine.querySelector(`[data-fil="${CSS.escape(f.id)}"]`);
    if (!carte) return;
    carte.outerHTML = htmlFil(f, { ouvert, contrats: this.contrats });
    this.racine.querySelectorAll(`[data-fil="${CSS.escape(f.id)}"] textarea`).forEach(ajuster);
  }

  enregistrer() {
    this.envois++;
    this.chaine = this.chaine.then(() => this.ecrire()).finally(() => this.envois--);
    return this.chaine;
  }

  // Renvoie vrai si tout est parti. Ce qui a échoué reste marqué : le prochain enregistrement le renverra.
  async ecrire() {
    const seances = [...this.modifs.seance];
    const campagne = this.modifs.campagne;
    const fils = [...this.modifs.fils];
    this.modifs = { seance: new Set(), campagne: false, fils: new Set() };
    let ok = true;
    const erreurs = [];
    this.fusions = 0;
    for (const id of seances) {
      const s = this.seances.find((x) => x.id === id);
      if (!s) continue;
      // Une séance d'avant la liste garde son texte ; elle prend le lien du scénario de même nom en s'enregistrant.
      const lie = !s.scenario_id && scenarioDe(s, this.scenarios);
      if (lie) s.scenario_id = lie.id;
      try {
        await this.envoyerFiche(`/api/seances/${id}`, s, this.bases.seances, id);
        // Le serveur garde son journal : sa réponse donne aussi les lignes notées depuis un autre écran.
        this.journalModifie({ id, journal: this.bases.seances[id]?.journal || [] });
      } catch (err) {
        ok = false;
        erreurs.push(err);
        this.modifs.seance.add(id);
        this.reessai.signaler(err, "Séance non enregistrée");
      }
    }
    if (seances.length) this.annoncerSeances();
    if (campagne) {
      try {
        await this.envoyerFiche("/api/campagne", this.campagne, this.bases.campagne, "campagne");
      } catch (err) {
        ok = false;
        erreurs.push(err);
        this.modifs.campagne = true;
        this.reessai.signaler(err, "Campagne non enregistrée");
      }
    }
    for (const id of fils) {
      const f = this.fils.find((x) => x.id === id);
      if (!f) continue;
      try {
        await this.envoyerFiche(`/api/fils/${id}`, f, this.bases.fils, id);
      } catch (err) {
        ok = false;
        erreurs.push(err);
        this.modifs.fils.add(id);
        this.reessai.signaler(err, `Fil « ${f.nom} » non enregistré`);
      }
    }
    if (this.fusions && !this.detruit) {
      toast("Un autre écran avait modifié ces fiches : ses changements et les vôtres sont réunis.");
      const actif = document.activeElement;
      if (!actif || !this.racine.contains(actif) || !actif.matches("input, textarea, select")) {
        this.afficherListe();
        this.afficherCorps();
      }
    }
    if (seances.length || campagne || fils.length) this.reessai.bilan(erreurs);
    this.enEchec = !ok;
    this.afficherEtat();
    return ok;
  }

  // L'état de l'en-tête après un envoi : raté (avec le nouvel essai qui vient), tout enregistré, ou rien à changer tant
  // qu'une modification faite pendant l'envoi attend encore (« Modifications en cours »).
  afficherEtat() {
    const etat = this.detruit ? null : this.racine.querySelector(".seances-corps .temoin-enregistrement");
    if (!etat) return;
    if (this.enEchec) afficherTemoin(etat, "erreur", { reessai: this.reessai });
    else if (!this.resteAEnvoyer()) afficherTemoin(etat, "ok", { modifie: this.seance ? this.seance.modifie : this.campagne?.modifie });
  }

  async envoyerFiche(url, local, bases, cle) {
    if (await enregistrerAvecVersion(url, local, bases, cle)) this.fusions++;
  }

  // Le « Précédemment » part vers les joueurs : le nom caché de l'auberge n'y a pas sa place, et un PNJ ou un lieu
  // encore inconnu y est signalé.
  async verifierNomCache(texte, champ = "") {
    try {
      const r = await api.post("/api/masque", { texte });
      if (r.trouve) toast(`Ce texte contient le nom secret de l'auberge : la TV et le message aux joueurs diront « ${await nomPourLesJoueurs()} ».`, "erreur");
      this.avertirSecrets(r.secrets, champ);
    } catch {
      // vérification de confort seulement
    }
  }

  // Un avertissement, jamais un blocage : le texte part quand même. « Marquer connu » sert quand les héros les ont
  // rencontrés pendant la séance. L'avis vit hors de la page : un redessin de l'onglet ne l'efface pas.
  // Une ligne par fiche : trois figurants du même nom font trois lignes, distinguées comme dans le carnet (Colporteur, Palefrenier…).
  avertirSecrets(secrets, champ = "") {
    const cle = JSON.stringify([champ, ...(secrets || []).map((x) => [x.genre, x.nom, x.precision ?? null, x.ids || []])]);
    const ancien = document.querySelector(".avis-secrets");
    // Le même avis déjà affiché reste tel quel, avec ce qui vient d'être marqué connu.
    if (ancien && ancien.dataset.cle === cle && !this.detruit) return;
    ancien?.remove();
    if (this.detruit || !secrets?.length) return;
    const genre = { pnj: "PNJ", lieu: "lieu" };
    const types = Object.fromEntries(TYPES_LIEUX.map((t) => [t.cle, t.nom]));
    const precision = (x) => (x.genre === "lieu" ? types[x.precision] || x.precision : x.precision) || "";
    const homonymes = secrets.some((x) => x.precision !== undefined);
    const avis = document.createElement("aside");
    avis.className = "avis-secrets";
    avis.dataset.cle = cle;
    avis.setAttribute("role", "status");
    avis.innerHTML = `
      <h2>${secrets.length > 1 ? "Encore inconnus des joueurs" : "Encore inconnu des joueurs"}</h2>
      <p>Ce texte part vers les joueurs et nomme :</p>
      <ul>${secrets.map((x, i) => `
        <li><span><b>${e(x.nom)}</b> <i>${x.genre === "peuple" ? `peuple caché de ${e((x.de || []).join(", "))}` : e([genre[x.genre], precision(x)].filter(Boolean).join(", "))}</i></span>
          ${x.genre === "peuple" ? "" : x.ambigu ? `<span class="carnet" title="Des fiches pareilles portent ce nom : marquez la bonne dans le carnet.">Voir le carnet</span>` : `<button data-connu="${i}" title="${x.genre === "lieu" ? "Les joueurs le connaissent : sur la carte de la TV, il apparaît là où le brouillard est levé." : "Les joueurs le connaissent : son carton peut aller sur la TV."}">Marquer connu</button>`}</li>`).join("")}
      </ul>
      ${homonymes ? `<p class="aide">Plusieurs fiches portent le même nom : marquez seulement celle que les héros ont vraiment rencontrée.</p>` : ""}
      <p class="aide">${e(suiteDuTexte(champ, secrets, this.seance) || "Rien n'est bloqué : corrigez le texte, ou marquez connu ce que les héros ont découvert en jouant.")}</p>
      <div class="actions"><button data-fermer>Fermer</button></div>`;
    avis.addEventListener("click", async (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      if (b.hasAttribute("data-fermer")) return avis.remove();
      const x = secrets[+b.dataset.connu];
      if (!x) return;
      b.disabled = true;
      try {
        await this.marquerConnu(x);
        b.replaceWith(Object.assign(document.createElement("span"), { className: "fait", textContent: "Connu" }));
        toast(`« ${[x.nom, precision(x)].filter(Boolean).join(", ")} » est maintenant connu des joueurs.`);
      } catch (err) {
        b.disabled = false;
        toast(`Impossible : ${err.message}`, "erreur");
      }
    });
    document.body.append(avis);
  }

  async marquerConnu(x) {
    const [url, liste] = x.genre === "lieu" ? ["/api/lieux", this.lieux] : ["/api/pnj", this.pnj];
    // Une ligne, une fiche : un homonyme a sa propre ligne et reste inconnu.
    const [id, ...autres] = x.ids || [];
    if (!id || autres.length) throw new Error("cette ligne ne désigne pas une seule fiche");
    // Seul le champ « connu » change : une fiche ouverte sur un autre écran n'est pas écrasée.
    const fiche = await api.patch(`${url}/${encodeURIComponent(id)}`, { connu: true });
    const locale = liste.find((f) => f.id === id);
    if (locale) Object.assign(locale, fiche);
    // Préparer (« Avant de jouer ») et Jouer montrent qui reste inconnu ; dans Clore, seul « Pour le carnet » se redessine.
    if (!this.detruit && this.seance && this.onglet !== "clore") this.afficherOnglet();
    else if (!this.detruit && this.seance) {
      this.pourLeCarnet.redessinerListes();
      this.pourLeCarnet.verifier();
    }
  }

  // ---- La table ----

  async envoyer(changements) {
    const etat = await api.get("/api/table");
    delete etat.ecrans;
    const nouveau = { ...etat, ...changements };
    const r = await api.put("/api/table", nouveau);
    this.table = nouveau;
    return r;
  }

  async basculer(vue, extra) {
    const etat = await api.get("/api/table");
    const avant = VUES_PLEINES.includes(etat.vue) ? etat.avant || null : Object.fromEntries(VUE_AVANT.map((k) => [k, etat[k] ?? null]));
    return this.envoyer({ vue, ...extra, avant, lieu: null });
  }

  async revenir() {
    const etat = await api.get("/api/table");
    const avant = etat.avant && !VUES_PLEINES.includes(etat.avant.vue) ? etat.avant : { vue: "accueil" };
    return this.envoyer({ ...avant, contrat: null, avant: null });
  }

  // Un document à la TV, ou retiré (documents/tv.js) : les boutons suivent l'état de la table (ecouterTv).
  async documentTv(x, montrer) {
    try {
      await (montrer ? montrerDocument(x) : retirerDocument(x));
    } catch (err) {
      toast(err.status && err.status < 500 ? err.message : `La table ne répond pas : ${err.message}`, "erreur");
    }
  }

  // Le nom ou le titre de l'épisode change : l'indication du champ et la ligne « Épisode » suivent, sans redessin.
  majEpisode(s) {
    this.racine.querySelector('[data-s="titre_episode"]')?.setAttribute("placeholder", s.nom || "");
    const libelle = this.racine.querySelector(".libelle-episode");
    if (libelle) libelle.textContent = this.libelleEpisode(s);
  }

  majBoutonsTable() {
    const b = this.racine.querySelector(".precedemment-bouton");
    if (b && this.seance) b.innerHTML = this.boutonPrecedemment(this.seance);
    if (this.onglet === "jouer" && this.seance) {
      const zone = this.racine.querySelector(".a-montrer");
      if (zone) zone.outerHTML = this.htmlAMontrer(this.seance);
      this.majLiensJeu();
    }
  }

  messageAuxJoueurs(s) {
    const suivante = this.seances.find((x) => (x.numero || 0) > (s.numero || 0) && x.date);
    const lignes = [`${TITRE_PRECEDEMMENT}…`, "", (s.precedemment || "").trim()];
    if (suivante) lignes.push("", `Prochaine séance : ${dateLongue(suivante.date)}${suivante.heure ? ` à ${heureFr(suivante.heure)}` : ""}. Rendez-vous à l'auberge.`);
    return lignes.join("\n").replace(/ /g, " ");
  }

  async rediger(bouton) {
    const s = this.seance;
    if (!s) return;
    // Le journal noté depuis un autre écran compte aussi pour le résumé.
    await this.relireJournal(s);
    const presents = (this.campagne.tablee || []).filter((j) => (s.presents || []).includes(j.id));
    const corps = {
      personnages: presents.map((j) => [j.personnage, j.joueur ? `joué par ${j.joueur}` : ""].filter(Boolean).join(", ")).join("\n"),
      resume: s.resume || "",
      journal: (s.journal || []).map((j) => `${j.t} ${j.texte}`).join("\n"),
      butin: s.butin || "",
      questions: s.questions || "",
    };
    if (!corps.resume.trim() && !corps.journal.trim()) return toast("Notez d'abord ce qui s'est passé : journal ou résumé.", "erreur");
    if ((s.precedemment || "").trim() && !(await demander({ titre: "Remplacer le « Précédemment » ?", texte: "Le texte déjà écrit sera remplacé par la nouvelle rédaction.", oui: "Remplacer", non: "Garder le mien", danger: true }))) return;
    bouton.disabled = true;
    bouton.textContent = "Rédaction en cours…";
    try {
      const r = await api.post("/api/precedemment/redaction", corps);
      s.precedemment = r.texte;
      this.marquer("seance", s.id);
      if (!this.detruit && this.seance === s) this.afficherOnglet();
      toast("Relisez-le : la rédaction peut se tromper de nom ou inventer un détail.");
      this.verifierNomCache(r.texte, "precedemment");
    } catch (err) {
      toast(`Rédaction impossible : ${erreurIA(err, "écrivez quelques phrases ci-dessous, elles serviront telles quelles")}.`, "erreur");
      bouton.disabled = false;
      bouton.textContent = "Rédiger le « Précédemment »";
      this.racine.querySelector('[data-s="precedemment"]')?.focus();
    }
  }

  // Clôture : les fils avancent, les rumeurs tombent à l'auberge, la réputation et le niveau passent dans la campagne.
  // Rejouable : chaque fil note les séances qui l'ont déjà fait bouger. Une clôture coupée en route (réseau) se
  // reprend d'un nouveau clic sans faire avancer deux fois le même fil ; une séance rouverte puis reclose non plus.
  // Ce que la clôture risque de laisser derrière elle : un billet sans destinataire ou jamais remis, un « Précédemment »
  // vide, un héros resté à terre. Rappelé dans la question de clôture, jamais bloquant.
  oublisAvantClore(s) {
    const oublis = [];
    const tablee = this.campagne?.tablee || [];
    const { sansDestinataire, aRemettre } = billetsAVerifier(s, tablee);
    const titreDe = (b) => (b.titre || "").trim() || tronquer((b.texte || "").trim(), 40);
    if (sansDestinataire.length) oublis.push(`Sans destinataire : ${sansDestinataire.map((b) => `« ${titreDe(b)} »`).join(", ")}. Choisissez un héros dans « Pour », en Préparer.`);
    const restent = aRemettre.filter((b) => !sansDestinataire.includes(b));
    if (restent.length) oublis.push(`${restent.length > 1 ? `${restent.length} billets restent` : "Un billet reste"} à remettre : ${restent.map((b) => `« ${titreDe(b)} »`).join(", ")}.`);
    if (!(s.precedemment || "").trim()) oublis.push("Le « Précédemment » est vide : la TV et les joueurs n'auront rien à lire au début de la séance suivante.");
    const tapis = this.compagnie.herosATerre();
    if (tapis.length) oublis.push(`${tapis.map((h) => `${h.nom} (${String(h.sante).replace("-", "−")} Santé)`).join(", ")} ${tapis.length > 1 ? "sont à terre" : "est à terre"} : la Santé reste telle quelle à la séance suivante.`);
    return oublis;
  }

  async clore() {
    const s = this.seance;
    if (!s || s.close) return;
    const touches = new Set(s.fils_touches || []);
    const avances = s.avances || {};
    const faits = (f) => (f.seances_closes || []).includes(s.id);
    const actifs = this.fils.filter((f) => f.actif !== false && !faits(f));
    const vont = actifs.filter((f) => !touches.has(f.id) && etapeSuivante(f) && (f.id in avances ? avances[f.id] : Boolean(proposition(f, false))));
    const resume = vont.length ? vont.map((f) => `« ${f.nom} » franchit l'étape ${(f.avance || 0) + 1}`).join(", ") : "aucun fil n'avance";
    if (!(await demander({ titre: `Clore la séance ${s.numero ?? ""}`.trim(), texte: [`${resume.replace(/^./, (x) => x.toUpperCase())}.`, ...this.oublisAvantClore(s)], aide: "« Rouvrir la séance » la rouvre ensuite ; les fils, eux, ne reculent pas.", oui: "Clore la séance", danger: true }))) return;
    if (!(await this.enregistrer())) return toast("Clôture annulée : la séance n'a pas pu être enregistrée d'abord.", "erreur");
    const lignes = [...(s.bilan?.lignes || [])];
    try {
      for (const f of actifs) {
        if (vont.includes(f)) {
          const { rumeur, contrat } = await franchir(f, { contrats: this.contrats, rumeurs: this.rumeurs, seance: s });
          lignes.push(`${f.nom} : étape ${f.avance}. ${f.etapes[f.avance - 1].texte}${rumeur ? " Une rumeur attend à l'auberge." : ""}${contrat ? ` « ${contrat.nom} » est cloué sur la planche.` : ""}`);
        } else {
          const champs = { attente: touches.has(f.id) ? 0 : (f.attente || 0) + 1, seances_closes: [...(f.seances_closes || []), s.id] };
          if (touches.has(f.id)) champs.journal = [...(f.journal || []), { quand: new Date().toISOString(), seance: s.id, numero: s.numero, note: "freiné par les héros" }];
          Object.assign(f, await api.patch(`/api/fils/${f.id}`, champs));
        }
        this.bases.fils[f.id] = copie(f);
      }
    } catch (err) {
      s.bilan = { lignes };
      this.afficherCorps();
      return toast(`Clôture interrompue (${err.message}). Cliquez de nouveau sur « Clore » : ce qui est fait ne sera pas refait.`, "erreur");
    }
    // La réputation et le niveau passent dans la campagne du MJ principal ; une quête annexe d'un MJ invité n'y touche pas.
    if (!estInvite()) {
      const c = this.campagne;
      for (const r of s.reputations || []) {
        if (!(r.region || "").trim()) continue;
        const deja = (c.reputations || []).find((x) => (x.region || "").trim().toLowerCase() === r.region.trim().toLowerCase());
        if (deja) Object.assign(deja, { souvenir: r.souvenir, numero: s.numero });
        else c.reputations = [...(c.reputations || []), { region: r.region.trim(), souvenir: r.souvenir || "", numero: s.numero }];
      }
      if (s.niveau_gagne) {
        c.niveau = (c.niveau || 1) + 1;
        c.niveau_seance = s.numero;
        lignes.push(`Le groupe passe au niveau ${c.niveau}.`);
      }
      this.modifs.campagne = true;
    }
    s.close = true;
    s.close_le = new Date().toISOString();
    s.bilan = { lignes };
    this.modifs.seance.add(s.id);
    await this.enregistrer();
    this.afficherListe();
    this.afficherCorps();
    // Remonté en haut : « Préparer la suivante » attend sous « Séance close », sans défilement à chercher.
    this.racine.querySelector(".seances-corps")?.scrollTo({ top: 0 });
    // « Préparer la suivante » reste en haut de Clore (bandeau) : le message n'a plus à le porter, et passe vite.
    toast(vont.length ? `Séance close. ${vont.length} fil${vont.length > 1 ? "s ont" : " a"} avancé.` : "Séance close. Le monde a retenu son souffle.", "info", { duree: 2800 });
  }

  async clic(ev) {
    const b = ev.target.closest("button, a[data-aller]");
    if (!b) return;
    // Un billet ou un document vers le téléphone d'un joueur (billets.js, prives/telephone.js), où qu'il soit dans la page.
    if (this.billets.telephone.clic(b)) return;
    if (b.closest(".pour-le-carnet")) return this.pourLeCarnet.clic(b);
    if (b.closest(".billets-seance")) return this.billets.clic(b);
    if (b.matches("a[data-aller]")) {
      ev.preventDefault();
      if (b.dataset.aller === "") this.aller(null);
      else this.aller(b.dataset.aller, b.dataset.onglet);
      return;
    }
    if (b.dataset.suite) return await this.suite.clic(b);
    if (b.closest("form[data-journal]") && !b.dataset.action) return;
    const a = b.dataset.action;
    const s = this.seance;
    try {
      if (b.dataset.ongletSeance) {
        this.onglet = b.dataset.ongletSeance;
        this.racine.querySelectorAll("[data-onglet-seance]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
        history.replaceState(null, "", `#/seances/${s.id}${this.onglet === "preparer" ? "" : `?onglet=${this.onglet}`}`);
        this.versLaScene = true;
        return this.afficherOnglet();
      }
      if (b.closest(".proposer-liens, .proposition-scene")) return await this.proposer.clic(b);
      if (a === "voir-lier") return this.voirLier(+b.dataset.i);
      if (a === "voir-scene" && s) {
        // « En cours » dans le bandeau : la scène dans le fil de Jouer.
        if (this.onglet !== "jouer") return this.racine.querySelector('[data-onglet-seance="jouer"]')?.click();
        return this.voirSceneEnCours(true);
      }
      if (a === "jouer-suite") {
        const cible = this.seances.find((x) => x.id === b.dataset.seance);
        if (!cible) return;
        const focus = document.activeElement === b;
        b.disabled = true;
        const bilan = await this.jouerLaSuite(cible, attenduDuBouton(b));
        b.disabled = false;
        if (focus) this.racine.querySelector('.bandeau-seance [data-action="jouer-suite"]')?.focus();
        // Comme « Jouer la scène » : un plan encore tout noir à la TV vient avec « Ouvrir le plan ».
        const billets = bilan.refus ? "" : rappelDeScene(cible, sceneEnCours(cible), this.campagne.tablee || []);
        return toast(bilan.texte + billets, bilan.erreur ? "erreur" : undefined, { action: bilan.action });
      }
      if (a === "installer") {
        b.disabled = true;
        b.textContent = "Installation…";
        // La campagne du kit et ses secrets : chargés à ce clic seulement, chez le MJ principal.
        const { installerCampagneDuKit } = await import("../auberge/kit.js");
        const n = await installerCampagneDuKit();
        toast(`Installé : ${n.fils} fils, ${n.contrats} affiches, ${n.rumeurs} rumeurs, ${n.pnj} habitués.`);
        return this.demarrer();
      }
      if (a === "nouvelle-seance") return await this.nouvelleSeance();
      if (a === "nouveau-fil") {
        const f = await api.post("/api/fils", {
          nom: "Nouveau fil", faction: "", but: "", fin: "", rythme: "deux", avance: 0, attente: 0, actif: true, journal: [], etiquette: "maison",
          etapes: [1, 2, 3, 4].map(() => ({ texte: "", rumeur: "" })),
        });
        this.fils.push(f);
        this.racine.querySelector(".fils").insertAdjacentHTML("beforeend", htmlFil(f, { ouvert: true, contrats: this.contrats }));
        this.racine.querySelector(`[data-fil="${CSS.escape(f.id)}"] input`)?.select();
        return;
      }
      if (a === "joueur-ajouter") {
        const t = this.campagne.tablee || [];
        this.campagne.tablee = [...t, { id: Math.random().toString(36).slice(2, 8), joueur: "", personnage: "", peuple: "", vocation: "", couleur: COULEURS[t.length % COULEURS.length], actif: true }];
        this.racine.querySelector(".tablee").innerHTML = this.htmlTablee();
        this.racine.querySelector(".tablee tbody tr:last-child input")?.focus();
        return this.marquer("campagne");
      }
      if (a === "joueur-retirer") {
        this.campagne.tablee.splice(+b.dataset.i, 1);
        this.racine.querySelector(".tablee").innerHTML = this.htmlTablee();
        return this.marquer("campagne");
      }
      if (a === "reputation-ajouter" || a === "reputation-retirer") {
        if (a === "reputation-ajouter") this.campagne.reputations = [...(this.campagne.reputations || []), { region: "", souvenir: "" }];
        else this.campagne.reputations.splice(+b.dataset.i, 1);
        this.racine.querySelector(".reputation").innerHTML = this.htmlReputation();
        return this.marquer("campagne");
      }
      if (a === "precedemment") {
        // Le texte en cours de frappe part d'abord ; la TV relit la séance quand sa version change.
        await this.vider();
        const montree = this.seances.find((x) => x.id === b.dataset.seance);
        const verif = api.post("/api/masque", { texte: montree?.precedemment || "" }).catch(() => null);
        const r = await this.basculer("precedemment", { seance: b.dataset.seance, seance_maj: montree?.modifie || null, contrat: null });
        toast(r.ecrans ? `« ${TITRE_PRECEDEMMENT}… » sur la TV.` : "Envoyé, mais aucun écran de table n'est ouvert.");
        this.avertirSecrets((await verif)?.secrets);
        return this.majBoutonsTable();
      }
      if (a === "precedemment-fin") {
        await this.revenir();
        return this.majBoutonsTable();
      }
      if (a === "episode-montrer" && s) {
        // Comme le « Précédemment » : le titre en cours de frappe part d'abord, la TV relit la séance à sa version.
        await this.vider();
        const verif = api.post("/api/masque", { texte: titreEpisode(s) }).catch(() => null);
        const r = await this.basculer("episode", { seance: s.id, seance_maj: s.modifie || null, contrat: null });
        toast(r.ecrans ? `« ${this.libelleEpisode(s)} » sur la TV.` : "Envoyé, mais aucun écran de table n'est ouvert.");
        this.avertirSecrets((await verif)?.secrets);
        return this.majBoutonsTable();
      }
      if (a === "episode-fin") {
        await this.revenir();
        return this.majBoutonsTable();
      }
      if (a === "planche-montrer") {
        await this.basculer("planche", { contrat: null });
        return this.majBoutonsTable();
      }
      if (a === "plan-montrer") {
        const p = this.plans.find((x) => x.id === b.dataset.plan);
        // Rien de révélé sous le brouillard : la TV serait noire, la même question que sur la page Table. Le plan est
        // relu : on a pu y révéler une pièce depuis un autre écran.
        const frais = await api.get(`/api/plans/${encodeURIComponent(p.id)}`).catch(() => p);
        const noire = rienDeRevele(frais);
        if (noire) {
          const choix = await questionTvNoire({ nom: p.nom, editeur: false });
          if (choix === "ouvrir") location.hash = `#/plan/${p.id}`;
          if (choix !== "noire") return;
        }
        const r = await this.envoyer({ vue: "plan", plan: p.id, camera: null, style: frais.style || "couleur", version: frais.modifie, lieu: null, contrat: null, avant: null });
        toast(r.ecrans ? `« ${p.nom} » sur la TV${noire ? ", encore noir" : ""}.` : "Envoyé, mais aucun écran de table n'est ouvert.");
        return this.majBoutonsTable();
      }
      if (a === "planche-retirer") {
        await this.revenir();
        return this.majBoutonsTable();
      }
      if (a === "contrat-montrer") {
        const c = this.contrats.find((x) => x.id === b.dataset.contrat);
        if (c && !["affiche", "pris"].includes(c.etat)) {
          if (!(await demander({ titre: "Afficher sur la planche", texte: `« ${c.nom} » n'est pas sur la planche. L'y afficher et le montrer à la TV ?`, oui: "Afficher et montrer" }))) return;
          // Seul l'état change : une copie chargée à l'ouverture de la page n'écrase pas ce qu'un autre écran a écrit.
          Object.assign(c, await api.patch(`/api/contrats/${c.id}`, { etat: "affiche" }));
        }
        await this.basculer("planche", { contrat: b.dataset.contrat });
        return this.majBoutonsTable();
      }
      if (a === "pnj-montrer") {
        const p = this.pnj.find((x) => x.id === b.dataset.pnj);
        // Une seule question, même pour un PNJ secret : il ne devient connu qu'après ce « oui ».
        if (!(await cartonVerifie(b.dataset.pnj, p?.nom, { secret: Boolean(p && !p.connu) }))) return;
        if (p && !p.connu) Object.assign(p, await api.patch(`/api/pnj/${p.id}`, { connu: true }));
        await this.envoyer({ pnj: b.dataset.pnj });
        return this.majBoutonsTable();
      }
      if (a === "ambiance-jouer") {
        // Le seul chemin vers la musique depuis les séances : un clic sur ce bouton.
        b.disabled = true;
        try {
          await jouerAmbiance(b.dataset.ambiance);
        } finally {
          this.majLiensJeu();
        }
        return;
      }
      if (a === "scene-jouer" && s) {
        // « Jouer la scène » : le plan, l'ambiance (sur ce clic, comme « Lancer l'ambiance »), le journal et le repère.
        const i = +b.dataset.i;
        if (!s.deroule?.[i]) return;
        const focus = document.activeElement === b;
        b.disabled = true;
        const liens = liensResolus(s.deroule[i], this.contexteLiens(s));
        const bilan = await jouerLaScene({ seance: s, i, r: liens, musique: etatMusique(), quand: new Date().toISOString() }, {
          montrerPlan: async (p) => {
            // Déjà sur la TV : rien ne part, le cadrage choisi reste.
            const { ecrans, ...etat } = await api.get("/api/table");
            if (etat.vue === "plan" && etat.plan === p.id) {
              this.table = etat;
              return { deja: true, ecrans };
            }
            return this.envoyer(vuePlan(p));
          },
          lancerAmbiance: (id) => jouerAmbiance(id),
          noter: (texte) => noterAuJournal(s.id, texte),
        });
        this.marquer("seance");
        this.majDerouleJeu();
        this.majBoutonsTable();
        this.afficherListe();
        if (focus) this.racine.querySelector('[data-action="scene-jouer"]')?.focus();
        // Les documents que lie la scène : rappelés, et le premier se montre d'un clic dans le message.
        const docs = documentsAuCompteRendu(liens.documents, (x) => this.documentTv(x, true));
        return toast(bilan.texte + rappelDeScene(s, i, this.campagne.tablee || []) + docs.texte, bilan.erreur ? "erreur" : undefined, { action: bilan.action, actions: [docs.action] });
      }
      if (a === "document-montrer" || a === "document-retirer") {
        const x = this.documents.find((d) => d.id === b.dataset.document);
        if (x) await this.documentTv(x, a === "document-montrer");
        return;
      }
      if (a === "pnj-retirer") {
        await this.envoyer({ pnj: null });
        return this.majBoutonsTable();
      }
      if (a === "raconter") {
        const r = this.rumeurs.find((x) => x.id === b.dataset.rumeur);
        if (r && (!r.etat || r.etat === "a-placer")) {
          Object.assign(r, await api.patch(`/api/rumeurs/${r.id}`, { etat: "entendue", seance: s?.id || r.seance || "" }));
        }
        await this.envoyer({ rumeur: b.dataset.rumeur });
        return this.majBoutonsTable();
      }
      if (a === "taire") {
        await this.envoyer({ rumeur: null });
        return this.majBoutonsTable();
      }
      if (a === "accueil") {
        await this.envoyer({ vue: "accueil", contrat: null, avant: null, lieu: null });
        return this.majBoutonsTable();
      }
      const carte = b.closest("[data-fil]");
      if (carte) return await this.actionFil(a, this.fils.find((x) => x.id === carte.dataset.fil), b);
      if (!s) return;
      if (a === "scene-ajouter") {
        const lignes = s.deroule || [];
        const der = lignes[lignes.length - 1];
        const debut = der ? (enMinutes(der.heure) ?? 0) + (+der.duree || 0) : enMinutes(s.heure);
        s.deroule = [...lignes, { heure: debut !== null ? enHeure(debut) : "", titre: `Scène ${lignes.length + 1}`, duree: 30, note: "" }];
      } else if (a === "scene-retirer") {
        // Une scène proposée à la clôture, retirée ici, n'est plus reproposée.
        const [partie] = s.deroule.splice(+b.dataset.i, 1);
        if (partie?.suite_cle && s.suite) s.suite.retires = [...new Set([...(s.suite.retires || []), partie.suite_cle])];
      }
      else if (a === "scene-monter" || a === "scene-descendre") {
        const i = +b.dataset.i;
        const j = a === "scene-monter" ? i - 1 : i + 1;
        [s.deroule[i], s.deroule[j]] = [s.deroule[j], s.deroule[i]];
      } else if (a === "recaler") {
        let m = enMinutes(s.deroule?.[0]?.heure || s.heure);
        if (m === null) return toast("Donnez d'abord une heure à la première scène.", "erreur");
        for (const d of s.deroule || []) {
          d.heure = enHeure(m);
          m += +d.duree || 0;
        }
      } else if (a === "rencontre-ajouter") {
        if ((s.rencontres || []).includes(b.dataset.id)) return;
        s.rencontres = [...(s.rencontres || []), b.dataset.id];
        const r = this.rencontres.find((x) => x.id === b.dataset.id);
        toast(`« ${r?.nom || "Rencontre"} » ajoutée aux rencontres de la séance.`);
      } else if (a === "puce-retirer") s[b.dataset.cle] = (s[b.dataset.cle] || []).filter((x) => x !== b.dataset.id);
      else if (a === "journal-retirer") return await this.retirerLigne(s, +b.dataset.i);
      else if (a === "lien-retirer") {
        const ligne = s.deroule?.[+b.dataset.ls];
        if (!ligne) return;
        delier(ligne, b.dataset.genre, b.dataset.id);
        this.marquer("seance");
        return this.majLier(+b.dataset.ls, b.dataset.genre);
      }
      else if (a === "sr-ajouter") s.reputations = [...(s.reputations || []), { region: "", souvenir: "" }];
      else if (a === "sr-retirer") s.reputations.splice(+b.dataset.i, 1);
      else if (a === "copier-message") {
        let message = this.messageAuxJoueurs(s);
        const verif = await api.post("/api/masque", { texte: message }).catch(() => null);
        if (verif?.trouve) {
          if (!(await demander({ titre: "Le nom secret de l'auberge", texte: `Le message contient le nom secret de l'auberge. Copier la version qui dit « ${await nomPourLesJoueurs()} » ?`, oui: "Copier cette version", non: "Ne rien copier" }))) return;
          message = verif.texte;
        }
        if (copier(message)) toast("Message copié : collez-le dans le groupe des joueurs.");
        else await aCopier({ titre: "Le message aux joueurs", texte: "Le navigateur n'a pas pu le copier seul : le voici en entier.", valeur: message, copie: "Message copié : collez-le dans le groupe des joueurs." });
        return this.avertirSecrets(verif?.secrets);
      } else if (a === "rediger") return this.rediger(b);
      else if (a === "clore") return this.clore();
      else if (a === "rouvrir") {
        if (!(await demander({ titre: "Rouvrir la séance", texte: "Les fils ne reculent pas : ce que la clôture a fait avancer reste où il est.", oui: "Rouvrir" }))) return;
        s.close = false;
      } else if (a === "seance-supprimer") {
        // Sans confirmation : ce qui attend part d'abord, puis « Annuler » dix secondes.
        await this.vider();
        await api.del(`/api/seances/${s.id}`);
        this.modifs.seance.delete(s.id);
        this.seances = this.seances.filter((x) => x.id !== s.id);
        this.annoncerSeances();
        annoncerCorbeille(`Séance ${s.numero ?? ""} mise à la corbeille.`.replace("  ", " "), "seances", s.id, { retour: `#/seances/${s.id}` });
        return this.aller(null);
      } else return;
      this.marquer("seance");
      if (a === "rouvrir") {
        this.afficherListe();
        return this.afficherSeance();
      }
      this.afficherOnglet();
    } catch (err) {
      toast(`Impossible : ${err.message}`, "erreur");
    }
  }

  async actionFil(a, f, b) {
    if (!f) return;
    if (a === "fil-avancer") {
      if (this.modifs.fils.has(f.id)) await this.enregistrer();
      const { rumeur, contrat } = await franchir(f, { contrats: this.contrats, rumeurs: this.rumeurs, note: "à la main" });
      this.bases.fils[f.id] = copie(f);
      toast(`« ${f.nom} » : étape ${f.avance}.${rumeur ? " Une rumeur attend à l'auberge." : ""}${contrat ? ` « ${contrat.nom} » est sur la planche.` : ""}`);
      return this.remplacerFil(f, false);
    }
    if (a === "fil-reculer") {
      f.avance = Math.max(0, (f.avance || 0) - 1);
      f.journal = [...(f.journal || []), { quand: new Date().toISOString(), a: 0, note: `recul à l'étape ${f.avance}` }];
      this.marquer("fil", f.id);
      return this.remplacerFil(f, false);
    }
    if (a === "etape-ajouter") {
      f.etapes = [...(f.etapes || []), { texte: "", rumeur: "" }];
      this.marquer("fil", f.id);
      return this.remplacerFil(f);
    }
    if (a === "etape-retirer") {
      f.etapes.splice(+b.dataset.etape, 1);
      f.avance = Math.min(f.avance || 0, f.etapes.length);
      this.marquer("fil", f.id);
      return this.remplacerFil(f);
    }
    if (a === "fil-supprimer") {
      if (this.modifs.fils.has(f.id)) await this.vider();
      await api.del(`/api/fils/${f.id}`);
      this.modifs.fils.delete(f.id);
      this.fils = this.fils.filter((x) => x.id !== f.id);
      this.racine.querySelector(`[data-fil="${CSS.escape(f.id)}"]`)?.remove();
      annoncerCorbeille(`Fil « ${f.nom || "sans nom"} » mis à la corbeille.`, "fils", f.id, { retour: location.hash });
    }
  }

  async nouvelleSeance() {
    const numero = Math.max(0, ...this.seances.map((s) => s.numero || 0)) + 1;
    const derniere = this.seances[this.seances.length - 1];
    const heure = derniere?.heure || "14:00";
    let m = enMinutes(heure);
    const deroule = DEROULE_TYPE.map(([titre, d]) => {
      const ligne = { heure: enHeure(m), titre, duree: d, note: "" };
      m += d;
      return ligne;
    });
    const s = await api.post("/api/seances", {
      nom: "", numero, date: "", heure, scenario: "", objectif: "", deroule, conseils: "",
      fin: "Terminez la séance sur une question, jamais sur une réponse.", questions: derniere?.questions || "", notes: "",
      pnj: [], lieux: [], contrats: [], rumeurs: [], fils_touches: [], journal: [], presents: [], reputations: [], close: false,
    });
    this.seances.push(s);
    this.annoncerSeances();
    this.onglet = "preparer";
    this.aller(s.id);
    this.racine.querySelector(".nom-seance")?.focus();
  }
}
