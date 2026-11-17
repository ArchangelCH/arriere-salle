// Les scénarios du MJ, écrits chapitre par chapitre. Là où il laisse carte blanche, il pose une consigne
// ([[carte blanche : …]], [[pistes : …]]…) ; la proposition faite ensuite s'affiche dessous, et c'est lui qui
// l'intègre au texte, la redemande ou retire la consigne. De même pour la relecture et la mise en page d'un chapitre :
// le texte corrigé est proposé à côté du sien, comparé mot à mot, et rien ne change sans son geste (accepter tout le
// chapitre, des passages, ou refuser). Rien de tout cela ne part vers la TV.

import { api, copie, differer, echapper as e, enregistrerAvecVersion, erreurIA, flux, toast } from "../api.js";
import { annoncerCorbeille, lienVersions } from "../corbeille/corbeille.js";
import { motsCles } from "../idees/idees.js";
import { Reessai } from "../commun/reessai.js";
import { demander } from "../commun/dialogue.js";
import { afficherTemoin, htmlTemoin } from "../commun/temoin-enregistrement.js";
import { GENRES, consignesDuScenario, consignesDuTexte, ecrireConsigne, plier, propositionDe } from "./consignes.js";
import { ChercherScenario, blocDuTexte } from "../chercher/scenario.js";
import { GENRES_FICHES, arobaseOuvre, chercherFiches, contexteDuScenario, fichesDe, indexFiches, insertionLien, intertitres, libelleDe, lienMort } from "./fiches.js";
import { rendre } from "./rendu.js";
import { bilan as bilanEcart, ecart, htmlEcart } from "../lore/ecart.js";
import { appliquer, empreinte, passages } from "./mise-en-page.js";
import { LiensCourts } from "./liens-courts.js";
import { LierEnEcrivant } from "./lier-en-ecrivant.js";

export const ETATS = { brouillon: "Brouillon", ecriture: "En écriture", pret: "Prêt à jouer", joue: "Joué" };
const MODES = { ecrire: "Écrire", cote: "Côte à côte", apercu: "Aperçu" };
const CORBEILLE_MAX = 30;
const ENSEMBLE = "ensemble";
const GENRE_MISE_EN_PAGE = "mise-en-page";

// Le brouillon de « Laisser une consigne » : fermée sans être posée (Échap, Annuler), ce qui était tapé revient à la
// réouverture, comme dans « Noter une idée ». Il vit le temps de la page, d'un scénario à l'autre.
let brouillonConsigne = null;

const nouvelId = () => `c-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`;
const maintenant = () => new Date().toISOString();

function date(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-CH", { day: "numeric", month: "long" })} à ${d.toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" })}`;
}

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
const court = (t, n) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

function lireMode() {
  try {
    return localStorage.getItem("scenarios.mode") || "ecrire";
  } catch {
    return "ecrire";
  }
}

function garderMode(mode) {
  try {
    localStorage.setItem("scenarios.mode", mode);
  } catch {
    // préférence perdue, sans conséquence
  }
}

// Où l'on en est dans un scénario (chapitre, défilement, curseur), gardé pour l'onglet : revenir d'une fiche ouverte par
// un lien, par Retour ou par les onglets, ramène au même endroit.
const clePlace = (id) => `scenarios.place.${id}`;

function lirePlace(id) {
  try {
    return JSON.parse(sessionStorage.getItem(clePlace(id)) || "null");
  } catch {
    return null;
  }
}

function noterPlace(id, place) {
  try {
    sessionStorage.setItem(clePlace(id), JSON.stringify(place));
  } catch {
    // place perdue, sans conséquence
  }
}

// La hauteur, dans la zone de texte, de la ligne où tombe pos : mesurée sur une copie cachée, puisque les longs
// paragraphes passent à la ligne.
function hauteurDans(zone, pos) {
  const st = getComputedStyle(zone);
  const copie = document.createElement("div");
  for (const p of ["paddingTop", "paddingRight", "paddingLeft", "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariantNumeric",
    "letterSpacing", "wordSpacing", "lineHeight", "tabSize", "textIndent", "wordBreak"]) copie.style[p] = st[p];
  Object.assign(copie.style, { position: "absolute", top: "0", left: "-10000px", visibility: "hidden", boxSizing: "border-box",
    width: `${zone.clientWidth}px`, border: "0", whiteSpace: "pre-wrap", overflowWrap: "break-word" });
  copie.textContent = zone.value.slice(0, pos);
  const marque = document.createElement("span");
  marque.textContent = "\u200b";
  copie.append(marque);
  document.body.append(copie);
  const haut = marque.offsetTop;
  copie.remove();
  return haut;
}

// Ce qu'il reste à lire ou à traiter dans un scénario.
function bilan(s) {
  const toutes = consignesDuScenario(s);
  const aLire = toutes.filter((c) => propositionDe(s, c)).length;
  return { attente: toutes.length - aLire, aLire };
}

// Retire une plage du texte ; une consigne seule sur sa ligne part avec sa ligne.
function retirerPlage(texte, debut, fin, bloc) {
  if (!bloc) {
    const avant = texte.slice(0, debut);
    const apres = texte.slice(fin);
    return /\s$/.test(avant) && /^\s/.test(apres) ? avant + apres.replace(/^[ \t]+/, "") : avant + apres;
  }
  const debutLigne = texte.lastIndexOf("\n", debut - 1) + 1;
  let finLigne = texte.indexOf("\n", fin);
  finLigne = finLigne < 0 ? texte.length : finLigne + 1;
  let avant = texte.slice(0, debutLigne);
  let apres = texte.slice(finLigne);
  if (/\n\s*\n$/.test(avant) && /^\s*\n/.test(apres)) apres = apres.replace(/^[ \t]*\n/, "");
  if (!apres) avant = avant.replace(/\n+$/, "\n");
  return avant + apres;
}

// Le titre du scénario se lit en entier dans la barre : il passe à la ligne, et sa zone grandit avec lui.
function ajusterTitre(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
}

export class Scenarios {
  constructor(racine, { id, parametres } = {}) {
    this.racine = racine;
    this.id = id || null;
    this.parametres = parametres || new URLSearchParams();
    this.bases = {};
    this.chaine = Promise.resolve();
    this.modifie = false;
    this.statutsEnCours = new Map();
    // Propositions et relectures en cours d'écriture : leur texte s'affiche au fur et à mesure.
    this.enCours = new Map();
    this.relecturesEnCours = new Map();
    this.lots = [];
    // La mise en page proposée : les chapitres en cours de relecture (leur texte arrive au fil), la série « tout le
    // scénario », les choix du MJ passage par passage, la comparaison déjà calculée de chaque chapitre, et les
    // propositions acceptées ou refusées ici que le serveur n'a pas encore retirées (chapitre → date).
    this.misesEnCours = new Map();
    this.serieMiseEnPage = null;
    this.choixMiseEnPage = new Map();
    this.ecartsMiseEnPage = new Map();
    this.misesRetirees = new Map();
    this.sauver = differer(() => this.enregistrer(), 800);
    // Serveur injoignable : le scénario repart seul (3 s, 10 s, puis toutes les 30 s).
    this.reessai = new Reessai(() => this.enregistrer(), () => {
      if (this.etatAffiche === "erreur") this.etat("erreur");
    });
    this.apercuDiffere = differer(() => this.afficherApercu(), 250);
    this.sommaireDiffere = differer(() => this.afficherSommaire(), 600);
    this.rafraichir = () => this.relire();
    // Les liens courts de la zone d'écriture (@[Nom]) ; le fichier garde les liens entiers (liens-courts.js).
    this.courts = new LiensCourts(() => this.fiches);
    // Créer la fiche qui manque, « Reprendre », « Retour au chapitre », le passage d'une fiche (lier-en-ecrivant.js).
    this.enEcrivant = new LierEnEcrivant(this);
    this.hauteurDans = (pos) => hauteurDans(this.zone, pos);
    this.surVisibilite = () => {
      if (document.visibilityState === "visible") this.relire();
    };
  }

  async demarrer() {
    if (!this.id) return this.liste();
    this.racine.innerHTML = `<div class="chargement plein">Ouverture du scénario…</div>`;
    const [s, idees, lots] = await Promise.all([api.get(`/api/scenarios/${encodeURIComponent(this.id)}`), api.get("/api/idees").catch(() => []),
      api.get("/api/ia/lots").catch(() => [])]);
    if (this.detruit) return;
    this.lots = lots;
    this.s = s;
    this.s.chapitres ||= [];
    if (!this.s.chapitres.length) this.s.chapitres.push({ id: nouvelId(), titre: "Premier chapitre", texte: "" });
    this.bases[s.id] = copie(s);
    this.idees = idees;
    const place = lirePlace(s.id);
    const demande = this.parametres.get("chapitre");
    const existe = (id) => this.s.chapitres.some((c) => c.id === id);
    this.chap = existe(demande) ? demande : existe(place?.chapitre) ? place.chapitre : this.s.chapitres[0].id;
    this.mode = lireMode();
    this.racine.innerHTML = this.gabarit();
    this.r = this.racine.querySelector(".scenario");
    this.lier();
    this.toutAfficher();
    this.etat("ok");
    if (place?.chapitre === this.chap) {
      if (!demande) history.replaceState(null, "", `#/scenarios/${this.s.id}?chapitre=${this.chap}`);
      this.reprendrePlace(place);
    }
    this.enEcrivant.brancher(this.r);
    this.enEcrivant.retenir(this.s.id, this.chap);
    // Venu de « Dans les scénarios » d'une fiche : le passage qui la cite, en vue.
    const voir = this.parametres.get("voir");
    if (voir) {
      history.replaceState(null, "", `#/scenarios/${this.s.id}?chapitre=${this.chap}`);
      requestAnimationFrame(() => this.enEcrivant.voir(voir));
    }
    // Un scénario tout neuf (« Créer et écrire ») : le curseur attend dans le texte du premier chapitre.
    if (this.parametres.has("ecrire")) {
      history.replaceState(null, "", `#/scenarios/${this.s.id}`);
      if (this.mode === "apercu") this.changerMode("ecrire");
      this.zone.focus();
    }
    // Les fiches que les liens peuvent viser : pour la recherche du bouton Fiche et les liens morts de l'aperçu.
    this.chargerFiches();
    // Venu de « Chercher » (l'en-tête) : le passage trouvé, choisi dans son chapitre.
    this.chercherIci.depuisLien();
    window.addEventListener("focus", this.rafraichir);
    document.addEventListener("visibilitychange", this.surVisibilite);
    this.minuterie = setInterval(() => this.relire(), 120000);
  }

  detruire() {
    this.detruit = true;
    window.removeEventListener("focus", this.rafraichir);
    document.removeEventListener("visibilitychange", this.surVisibilite);
    clearInterval(this.minuterie);
    this.apercuDiffere.annuler();
    this.sommaireDiffere.annuler();
    return this.vider();
  }

  vider() {
    this.garderPlace();
    if (this.modifie || this.sauver.enAttente()) this.sauver.maintenant();
    return this.chaine;
  }

  // Reste-t-il quelque chose qui n'est pas enregistré ? (l'onglet ne se ferme pas sans prévenir ; au-delà de 60 Ko, le
  // dernier envoi ne survit pas à la fermeture)
  aEnregistrer() {
    return this.modifie || this.sauver.enAttente() || this.etatAffiche === "enregistrement" || this.statutsEnCours.size > 0;
  }

  // Appelé en quittant la page (lien, onglet, Retour) ou l'onglet du navigateur : la page est encore en place.
  garderPlace() {
    if (!this.s || !this.r || !this.zone) return;
    this.enEcrivant.retenir(this.s.id, this.chap);
    const z = this.zone;
    noterPlace(this.s.id, {
      chapitre: this.chap, texte: z.scrollTop, apercu: this.r.querySelector(".apercu").scrollTop,
      selection: this.zoneTouchee ? [z.selectionStart, z.selectionEnd] : null,
    });
  }

  reprendrePlace(p) {
    const z = this.zone;
    const n = z.value.length;
    if (Array.isArray(p.selection)) {
      z.setSelectionRange(Math.min(+p.selection[0] || 0, n), Math.min(+p.selection[1] || 0, n));
      this.zoneTouchee = true;
    }
    z.scrollTop = +p.texte || 0;
    this.r.querySelector(".apercu").scrollTop = +p.apercu || 0;
  }

  /* ---- La liste ---- */

  async liste() {
    this.racine.innerHTML = `<section class="page-liste"><div class="chargement">Chargement des scénarios…</div></section>`;
    const scenarios = await api.get("/api/scenarios");
    if (this.detruit) return;
    scenarios.sort((a, b) => (b.modifie || "").localeCompare(a.modifie || ""));
    this.racine.innerHTML = `
      <section class="page-liste scenarios">
        <header class="titre-page">
          <p class="kicker">Écriture</p>
          <h1>Les scénarios</h1>
          <p class="chapo">Écrivez vos scénarios chapitre par chapitre. Là où vous laissez carte blanche, posez une consigne avec vos indications : elle sera traitée quand vous le demanderez, croisée avec la bible et vos idées, et la proposition s'affichera dessous, à intégrer ou non.</p>
        </header>
        ${this.enEcrivant.htmlReprendre(scenarios)}
        <div class="cartes">
          ${scenarios.map((s) => {
            const b = bilan(s);
            const n = (s.chapitres || []).length;
            return `
            <article class="fiche-carte fiche-scenario" data-etat="${e(s.etat || "brouillon")}">
              <a href="#/scenarios/${e(s.id)}" class="ouvrir">
                <p class="etat-scenario">${e(ETATS[s.etat] || ETATS.brouillon)}</p>
                <h2>${e(s.nom || "Sans titre")}</h2>
                ${s.resume ? `<p class="resume">${e(s.resume)}</p>` : ""}
                <p>${pluriel(n, "chapitre", "chapitres")}${b.attente ? ` · ${pluriel(b.attente, "consigne en attente", "consignes en attente")}` : ""}${b.aLire ? ` · <strong class="a-lire">${pluriel(b.aLire, "proposition à lire", "propositions à lire")}</strong>` : ""}</p>
                <p class="date">Modifié le ${e(date(s.modifie))}</p>
              </a>
              <button class="lien-danger" data-supprimer="${e(s.id)}" data-nom="${e(s.nom || "Sans titre")}">Supprimer</button>
            </article>`;
          }).join("")}
          <button class="fiche-carte nouvelle" data-action="nouveau"><span>Nouveau scénario</span></button>
        </div>
        <div class="mode-emploi">
          <h2>Les consignes</h2>
          <p>Dans le texte, le bouton <strong>Consigne</strong> en pose une là où se trouve le curseur ; on peut aussi l'écrire à la main, entre doubles crochets :</p>
          <ul>
            ${Object.values(GENRES).map((g) => `<li><code>[[${e(g.mot)} : …]]</code> ${e(g.nom)}. ${e(g.aide)}</li>`).join("")}
          </ul>
          <p>Seule sur sa ligne, la consigne tient lieu de paragraphe ; dans une phrase, elle attend un mot ou une ligne (<code>[[pistes : un nom de village]]</code>). Les <code>#mots-clés</code> relient le texte à vos idées, et les lignes commençant par <code>&gt;</code> forment l'encadré à lire aux joueurs.</p>
          <p>Le bouton <strong>Fiche</strong>, ou <code>@</code> en début de mot, relie le texte à un PNJ, un lieu, un plan, une rencontre ou une carte : le lien s'écrit <code>@[Lisette Varenne]</code>, et l'atelier retient seul la fiche visée ; un mot choisi devient le libellé du lien. <code>@[Lisette Varenne]</code> tapé à la main se relie de même, et quand aucune fiche ne porte ce nom, « Lier une fiche » propose de la créer. Dans l'aperçu, un clic ouvre la fiche, qui propose « Retour au chapitre ». Le sommaire montre les intertitres du chapitre ouvert.</p>
        </div>
        <dialog class="dialogue" id="nouveau-scenario">
          <form method="dialog">
            <h2>Nouveau scénario</h2>
            <label class="champ">Titre<input type="text" name="nom" required placeholder="La chasse est ouverte"></label>
            <label class="champ">En deux mots<textarea name="resume" rows="3" placeholder="Le pitch : ce qui se joue, pour qui, où."></textarea></label>
            <div class="actions">
              <button value="annuler" formnovalidate>Annuler</button>
              <button class="principal" value="creer">Créer et écrire</button>
            </div>
          </form>
        </dialog>
      </section>`;
    const dlg = this.racine.querySelector("#nouveau-scenario");
    const form = dlg.querySelector("form");
    this.racine.querySelector('[data-action="nouveau"]').addEventListener("click", () => {
      form.reset();
      dlg.showModal();
    });
    dlg.addEventListener("close", async () => {
      if (dlg.returnValue !== "creer" || !form.nom.value.trim()) return;
      try {
        const s = await api.post("/api/scenarios", {
          nom: form.nom.value.trim(), resume: form.resume.value.trim(), etat: "brouillon",
          chapitres: [{ id: nouvelId(), titre: "Premier chapitre", texte: "" }], corbeille: [],
        });
        location.hash = `#/scenarios/${s.id}?ecrire`;
      } catch (err) {
        toast(`Création impossible : ${err.message}`, "erreur");
      }
    });
    for (const b of this.racine.querySelectorAll("[data-supprimer]")) {
      b.addEventListener("click", async () => {
        try {
          await api.del(`/api/scenarios/${encodeURIComponent(b.dataset.supprimer)}`);
          annoncerCorbeille(`« ${b.dataset.nom} » mis à la corbeille.`, "scenarios", b.dataset.supprimer, { retour: "#/scenarios" });
        } catch (err) {
          toast(`Suppression impossible : ${err.message}`, "erreur");
        }
        if (!this.detruit) this.liste();
      });
    }
  }

  /* ---- L'éditeur ---- */

  gabarit() {
    const s = this.s;
    return `
      <section class="scenario" data-mode="${e(this.mode)}" data-sommaire="ferme">
        <aside class="scenario-sommaire">
          <a class="retour" href="#/scenarios">Tous les scénarios</a>
          <textarea class="scenario-nom" data-champ="nom" rows="1" placeholder="Titre du scénario" aria-label="Titre du scénario">${e(s.nom || "")}</textarea>
          <div class="scenario-meta">
            <select data-champ="etat" aria-label="Avancement">
              ${Object.entries(ETATS).map(([k, v]) => `<option value="${k}" ${(s.etat || "brouillon") === k ? "selected" : ""}>${v}</option>`).join("")}
            </select>
          </div>
          <div class="place-sans-cle"></div>
          <textarea class="scenario-resume" data-champ="resume" rows="3" placeholder="Le pitch, en deux ou trois lignes" aria-label="Résumé">${e(s.resume || "")}</textarea>
          <h2 class="sommaire-titre">Chapitres</h2>
          <ol class="liste-chapitres"></ol>
          <button type="button" class="ajouter-chapitre" data-action="ajouter-chapitre">Ajouter un chapitre</button>
          <div class="bloc-consignes"></div>
          <div class="relecture-ensemble"></div>
          <div class="mise-en-page-ensemble"></div>
          <details class="chercher-ici">
            <summary>Chercher dans ce scénario</summary>
            <input type="search" autocomplete="off" spellcheck="false" enterkeyhint="search" placeholder="Un nom, un mot, une phrase" aria-label="Chercher dans ce scénario" title="Dans tous les chapitres ; ⌘F (Ctrl+F) y mène depuis la page">
            <div class="resultats-ici" aria-live="polite"></div>
          </details>
          <details class="bible-rapide">
            <summary>Chercher dans la bible</summary>
            <input type="search" placeholder="Un nom, un lieu, un mot" aria-label="Chercher dans la bible">
            <div class="resultats-rapides"></div>
          </details>
          <div class="corbeille-chapitres"></div>
          <div class="sommaire-pied">
            <button type="button" data-action="imprimer">Imprimer</button>
            <button type="button" class="lien-danger" data-action="supprimer-scenario">Mettre le scénario à la corbeille</button>
            <a class="lien-versions" href="${lienVersions("scenarios", s.id, `#/scenarios/${s.id}`)}">Versions précédentes</a>
          </div>
        </aside>
        <div class="scenario-corps">
          <div class="barre-chapitre">
            <button type="button" class="ouvrir-sommaire" data-action="sommaire" aria-expanded="false">Sommaire</button>
            <input class="titre-chapitre" placeholder="Titre du chapitre" aria-label="Titre du chapitre">
            ${htmlTemoin()}
            <div class="outils-texte">
              <button type="button" data-inserer="titre" title="Un intertitre dans le chapitre">Intertitre</button>
              <button type="button" data-inserer="a-lire" title="Un encadré à lire à voix haute">À lire</button>
              <button type="button" data-action="fiche" title="Un lien vers un PNJ, un lieu, un plan, une rencontre ou une carte (ou « @ » en écrivant)">Fiche</button>
              <button type="button" class="poser-consigne" data-action="consigne" title="Laisser carte blanche, avec vos indications">Consigne</button>
            </div>
            <div class="modes" role="group" aria-label="Affichage">
              ${Object.entries(MODES).map(([k, v]) => `<button type="button" data-mode="${k}" aria-pressed="${this.mode === k}">${v}</button>`).join("")}
            </div>
          </div>
          <div class="avis-chapitre" hidden></div>
          <div class="zones">
            <textarea class="texte-chapitre" spellcheck="true" lang="fr" placeholder="Écrivez ici. Une ligne vide sépare les paragraphes ; « ## » en début de ligne fait un intertitre, « > » un texte à lire aux joueurs, « @ » un lien vers une fiche. Là où vous laissez carte blanche : le bouton Consigne, ou [[carte blanche : vos indications]]."></textarea>
            <article class="apercu"></article>
          </div>
          <div class="pied-chapitre">
            <span class="compte-mots aide"></span>
            <button type="button" class="relire-chapitre" data-mise-en-page-courant data-estimation="mise-en-page" data-estimation-discret title="Orthographe, grammaire, typographie, intertitres, listes, encadrés : une version corrigée de ce chapitre vous est proposée, à comparer avant d'accepter">Relire et mettre en page</button>
            <button type="button" class="lien-danger" data-action="supprimer-chapitre">Supprimer ce chapitre</button>
          </div>
        </div>
        <div class="impression"></div>
        <dialog class="dialogue dialogue-consigne">
          <form method="dialog">
            <h2>Laisser une consigne</h2>
            <fieldset class="choix-modele choix-consigne">
              ${Object.entries(GENRES).map(([k, g], i) => `<label class="modele"><input type="radio" name="genre" value="${k}" ${i === 0 ? "checked" : ""}><span><strong>${e(g.nom)}</strong>${e(g.aide)}</span></label>`).join("")}
            </fieldset>
            <label class="champ">Indications<textarea name="indications" rows="5" placeholder="Ce qui doit s'y passer, le ton, la longueur, ce qu'il faut éviter… Vide : d'après ce qui entoure."></textarea></label>
            <p class="aide">S'écrit aussi à la main : <code>[[carte blanche : …]]</code>, <code>[[pistes : …]]</code>, <code>[[vérifier : …]]</code>, <code>[[pnj : …]]</code>, <code>[[combat : …]]</code>.</p>
            <div class="actions">
              <button value="annuler" formnovalidate>Annuler</button>
              <button class="principal" value="poser">Poser la consigne</button>
            </div>
          </form>
        </dialog>
        <dialog class="dialogue dialogue-fiche">
          <form method="dialog">
            <h2>Lier une fiche</h2>
            <label class="champ">Chercher<input type="search" name="q" autocomplete="off" spellcheck="false" placeholder="PNJ, lieu, plan, rencontre ou carte" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="choix-fiches"></label>
            <ul class="choix-fiches" id="choix-fiches" role="listbox" aria-label="Fiches trouvées"></ul>
            <p class="aide aide-fiche"></p>
            <div class="actions">
              <button value="annuler" formnovalidate>Annuler</button>
              <button class="principal" value="lier">Insérer le lien</button>
            </div>
          </form>
        </dialog>
      </section>`;
  }

  chapitre(id = this.chap) {
    return this.s.chapitres.find((c) => c.id === id) || this.s.chapitres[0];
  }

  lier() {
    const r = this.r;
    this.zone = r.querySelector(".texte-chapitre");
    this.glisserChapitres(r.querySelector(".liste-chapitres"));
    // Tant qu'on n'a pas cliqué dans le texte, son curseur n'a pas de sens : une consigne se pose alors à la fin.
    this.zone.addEventListener("focus", () => {
      this.zoneTouchee = true;
    });
    this.zone.addEventListener("input", (ev) => {
      const ch = this.chapitre();
      ch.texte = this.courts.fichier(ch, this.zone.value);
      ch.texte_modifie = maintenant();
      this.marquer();
      if (this.mode === "cote") this.apercuDiffere();
      this.sommaireDiffere();
      this.compterMots();
      if (ev.inputType === "insertText" && ev.data === "@" && !ev.isComposing) {
        const p = this.zone.selectionStart;
        if (p === this.zone.selectionEnd && arobaseOuvre(this.zone.value, p - 1)) this.ouvrirFiches(p - 1);
      }
    });
    this.zone.addEventListener("keydown", (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
        ev.preventDefault();
        this.sauver.maintenant();
      }
    });
    r.querySelector(".titre-chapitre").addEventListener("input", (ev) => {
      this.chapitre().titre = ev.target.value;
      this.marquer();
      this.sommaireDiffere();
    });
    for (const el of r.querySelectorAll("[data-champ]")) {
      el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
        // Le titre tient sur une ligne de texte, même collé : il passe seulement à la ligne à l'écran.
        if (el.dataset.champ === "nom" && /\n/.test(el.value)) el.value = el.value.replace(/\s*\n\s*/g, " ");
        this.s[el.dataset.champ] = el.value;
        if (el.dataset.champ === "nom") ajusterTitre(el);
        this.marquer();
      });
    }
    const nom = r.querySelector(".scenario-nom");
    nom.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" || ev.isComposing) return;
      ev.preventDefault();
      r.querySelector(".scenario-resume")?.focus();
    });
    requestAnimationFrame(() => ajusterTitre(nom));
    r.addEventListener("click", (ev) => this.clic(ev));
    const recherche = r.querySelector(".bible-rapide input");
    const chercher = differer(() => this.chercherBible(recherche.value), 350);
    recherche.addEventListener("input", chercher);
    // « Chercher dans ce scénario » : tous les chapitres, et ⌘F qui y mène (chercher/scenario.js).
    this.chercherIci = new ChercherScenario(this);
    const dlg = r.querySelector(".dialogue-consigne");
    dlg.addEventListener("close", () => this.fermerConsigne(dlg));
    dlg.querySelector("textarea").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        dlg.querySelector('button[value="poser"]').click();
      }
    });
    const fiche = r.querySelector(".dialogue-fiche");
    const q = fiche.querySelector('input[name="q"]');
    fiche.addEventListener("close", () => this.fermerFiches(fiche));
    q.addEventListener("input", () => {
      this.choixFiche = 0;
      this.afficherChoixFiches();
    });
    q.addEventListener("keydown", (ev) => {
      const n = this.trouvees?.length || 0;
      if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && n) {
        ev.preventDefault();
        this.choixFiche = (this.choixFiche + (ev.key === "ArrowDown" ? 1 : n - 1)) % n;
        this.majChoixFiche();
      } else if (ev.key === "Enter") {
        // Entrée choisit la fiche en surbrillance (sans elle, le formulaire prendrait « Annuler »).
        ev.preventDefault();
        if (n && !ev.isComposing) fiche.close("lier");
      }
    });
    fiche.querySelector(".choix-fiches").addEventListener("click", (ev) => {
      const creer = ev.target.closest("[data-creer]");
      if (creer) return this.enEcrivant.creer(creer.dataset.creer, q.value, creer);
      const li = ev.target.closest("[data-i]");
      if (!li) return;
      this.choixFiche = +li.dataset.i;
      fiche.close("lier");
    });
  }

  toutAfficher() {
    this.afficherChapitre();
    this.afficherSommaire();
  }

  afficherChapitre() {
    const ch = this.chapitre();
    this.r.querySelector(".titre-chapitre").value = ch.titre || "";
    const zone = this.courts.zone(ch);
    if (this.zone.value !== zone) this.zone.value = zone;
    this.r.dataset.mode = this.mode;
    for (const b of this.r.querySelectorAll(".modes [data-mode]")) b.setAttribute("aria-pressed", String(b.dataset.mode === this.mode));
    this.compterMots();
    this.afficherApercu();
  }

  compterMots() {
    const n = (this.chapitre().texte || "").replace(/\[\[[\s\S]*?\]\]/g, " ").split(/\s+/).filter((m) => /[\p{L}\p{N}]/u.test(m)).length;
    this.r.querySelector(".compte-mots").textContent = n ? pluriel(n, "mot", "mots") : "";
  }

  afficherSommaire() {
    if (this.detruit) return;
    const toutes = consignesDuScenario(this.s);
    this.r.querySelector(".liste-chapitres").innerHTML = this.s.chapitres.map((ch, i) => {
      const siennes = toutes.filter((c) => c.chapitre === ch.id);
      const aLire = siennes.filter((c) => propositionDe(this.s, c)).length;
      const attente = siennes.length - aLire;
      const titres = ch.id === this.chap ? intertitres(ch.texte).filter((t) => t.titre) : [];
      const haut = Math.min(...titres.map((t) => t.niveau));
      return `
        <li data-id="${e(ch.id)}" ${ch.id === this.chap ? 'aria-current="true"' : ""}${ch.id === this.deplace?.id && Date.now() - this.deplace.quand < 1500 ? ' class="deplace"' : ""}>
          <span class="poignee" draggable="true" title="Glisser pour déplacer le chapitre" aria-hidden="true"></span>
          <button type="button" class="ouvrir-chapitre" data-chapitre="${e(ch.id)}">
            <span class="numero">${i + 1}</span>
            <span class="titre">${e(ch.titre || "Sans titre")}</span>
            ${aLire ? `<span class="pastille a-lire" title="${pluriel(aLire, "proposition à lire", "propositions à lire")}">${aLire}</span>` : ""}
            ${attente ? `<span class="pastille" title="${pluriel(attente, "consigne en attente", "consignes en attente")}">${attente}</span>` : ""}
            ${this.misesEnCours.has(ch.id) ? `<span class="pastille mise-en-page en-cours" title="Relecture en cours">…</span>`
              : this.propositionMiseEnPage(ch.id) ? `<span class="pastille mise-en-page" title="Mise en page proposée, à comparer">¶</span>` : ""}
          </button>
          <span class="deplacer">
            <button type="button" data-monter="${e(ch.id)}" aria-label="Monter le chapitre" ${i === 0 ? "disabled" : ""}>↑</button>
            <button type="button" data-descendre="${e(ch.id)}" aria-label="Descendre le chapitre" ${i === this.s.chapitres.length - 1 ? "disabled" : ""}>↓</button>
          </span>
          ${titres.length ? `<ol class="intertitres" aria-label="Intertitres du chapitre">${titres.map((t) => `
            <li><button type="button" class="aller-intertitre" data-intertitre="${t.rang}" data-retrait="${Math.min(3, t.niveau - haut)}" title="${e(t.titre)}">${e(t.titre)}</button></li>`).join("")}
          </ol>` : ""}
        </li>`;
    }).join("");
    const orphelines = this.orphelines(toutes);
    const bloc = this.r.querySelector(".bloc-consignes");
    bloc.innerHTML = toutes.length || orphelines.length ? `
      <h2 class="sommaire-titre">Consignes</h2>
      <ul class="liste-consignes">
        ${toutes.map((c) => {
          const p = propositionDe(this.s, c);
          const ecrit = this.enCours.has(`${c.rang}#${c.cle}`);
          return `<li><button type="button" data-aller="${e(c.cle)}" data-rang="${c.rang}" data-etat="${ecrit ? "redaction" : p ? "proposee" : "ouverte"}">
            <span class="genre">${e(GENRES[c.genre].nom)}</span>
            <span class="quoi">${e(court(c.indications || "d'après ce qui entoure", 70))}</span>
            <span class="ou">ch. ${c.numero} · ${ecrit ? "en rédaction" : p ? "à lire" : "en attente"}</span>
          </button>${p || ecrit ? "" : `<button type="button" class="proposer-vite" data-proposer data-cle="${e(c.cle)}" data-rang="${c.rang}" title="Demander une proposition pour cette consigne" data-estimation="${c.genre === "verifier" ? "verifier" : "consigne"}" data-estimation-discret>Proposer</button>`}</li>`;
        }).join("")}
        ${orphelines.map((p) => `<li><button type="button" data-orpheline="${e(p.id)}" data-etat="orpheline">
            <span class="genre">${e(GENRES[p.genre]?.nom || "Proposition")}</span>
            <span class="quoi">${e(court(p.indications || "", 70))}</span>
            <span class="ou">sa consigne a changé</span>
          </button></li>`).join("")}
      </ul>` : "";
    const ensemble = this.s.relectures?.ensemble;
    const ecriture = this.relecturesEnCours.get("ensemble");
    this.r.querySelector(".relecture-ensemble").innerHTML = `
      ${ecriture ? `
      <details class="canon en-cours" data-verdict="a-verifier" open>
        <summary class="canon-titre">Relecture d'ensemble</summary>
        <p class="aide">Relecture en cours…</p>
        <div class="md" data-flux-relecture="ensemble">${rendre(ecriture.texte)}</div>
      </details>` : ensemble ? `
      <details class="canon" data-verdict="a-verifier" open>
        <summary class="canon-titre">Relecture d'ensemble</summary>
        <p class="aide">${e(date(ensemble.date))}</p>
        <div class="md">${rendre(ensemble.texte)}</div>
        <button type="button" class="lien-danger" data-effacer-relecture="ensemble">Effacer la relecture</button>
      </details>` : ""}
      ${this.actionsRelecture("ensemble")}`;
    this.r.querySelector(".mise-en-page-ensemble").innerHTML = this.htmlMiseEnPageEnsemble();
    const corbeille = this.s.corbeille || [];
    this.r.querySelector(".corbeille-chapitres").innerHTML = corbeille.length ? `
      <details>
        <summary>Chapitres supprimés (${corbeille.length})</summary>
        <ul>${corbeille.map((c, i) => `<li><span>${e(c.titre || "Sans titre")}</span> <button type="button" class="lien" data-restaurer="${i}">Remettre</button></li>`).join("")}</ul>
      </details>` : "";
    this.afficherAvis(toutes);
  }

  orphelines(toutes = consignesDuScenario(this.s)) {
    const presentes = new Set(toutes.map((c) => `${c.rang}#${c.cle}`));
    return (this.s.reponses || []).filter((r) => r.statut === "proposee" && !presentes.has(`${r.rang}#${r.cle}`));
  }

  // En mode Écrire, l'aperçu est caché : un bandeau dit ce qui attend d'être lu dans ce chapitre.
  afficherAvis(toutes = consignesDuScenario(this.s)) {
    const avis = this.r.querySelector(".avis-chapitre");
    const ch = this.chapitre();
    const aLire = toutes.filter((c) => c.chapitre === ch.id && propositionDe(this.s, c)).length;
    const relu = this.s.relectures?.[ch.id];
    const morceaux = [aLire ? pluriel(aLire, "proposition à lire", "propositions à lire") : "", relu ? (relu.rapide ? "une relecture rapide" : "une relecture au regard du canon") : "",
      this.misesEnCours.has(ch.id) ? "une relecture en cours" : this.propositionMiseEnPage(ch.id) ? "une mise en page proposée" : ""].filter(Boolean);
    avis.hidden = this.mode !== "ecrire" || !morceaux.length;
    avis.innerHTML = morceaux.length ? `<span>Dans ce chapitre : ${e(morceaux.join(", "))}.</span> <button type="button" class="lien" data-mode="apercu">Voir dans l'aperçu</button>` : "";
  }

  // Le chapitre mis en page, ses consignes et leurs propositions, puis sa relecture et les idées qui partagent ses mots-clés.
  afficherApercu() {
    if (this.detruit || this.mode === "ecrire") return;
    const ch = this.chapitre();
    const siennes = consignesDuScenario(this.s).filter((c) => c.chapitre === ch.id);
    const corps = rendre(ch.texte || "", { consigne: (i, bloc) => this.rendreConsigne(siennes[i], bloc) });
    const relu = this.s.relectures?.[ch.id];
    const ecriture = this.relecturesEnCours.get(ch.id);
    const relecture = ecriture ? `
      <section class="canon relecture en-cours" data-verdict="a-verifier">
        <p class="canon-titre">${ecriture.rapide ? "Relecture rapide" : "Au regard du canon"}</p>
        <p class="aide">Relecture en cours…</p>
        <div class="md" data-flux-relecture="${e(ch.id)}">${rendre(ecriture.texte)}</div>
      </section>` : relu ? `
      <section class="canon relecture" data-verdict="a-verifier">
        <p class="canon-titre">${relu.rapide ? "Relecture rapide" : "Au regard du canon"}</p>
        <p class="aide">Relu le ${e(date(relu.date))}${relu.rapide ? " avec les seuls passages de la bible liés au chapitre" : ""}${ch.texte_modifie && new Date(ch.texte_modifie) > new Date(relu.date) ? ", avant la dernière modification du chapitre" : ""}.</p>
        <div class="md">${rendre(relu.texte)}</div>
        <button type="button" class="lien-danger" data-effacer-relecture="${e(ch.id)}">Effacer la relecture</button>
      </section>` : "";
    const zone = this.r.querySelector(".apercu");
    const haut = zone.scrollTop;
    zone.innerHTML = `
      <div class="md">
        <h1>${e(ch.titre || "Sans titre")}</h1>
        ${corps || `<p class="vide">Rien d'écrit pour l'instant.</p>`}
      </div>
      ${this.htmlMiseEnPage(ch)}
      ${relecture}
      ${this.actionsRelecture(ch.id)}
      ${this.actionsMiseEnPage(ch)}
      ${this.ideesLiees(ch)}`;
    zone.scrollTop = haut;
    this.marquerLiens();
  }

  // Dans l'aperçu, un lien vers une fiche qui n'existe plus se voit barré.
  marquerLiens() {
    if (this.detruit || !this.index || !this.r) return;
    for (const a of this.r.querySelectorAll('.apercu a[href^="#/"]')) {
      if (!lienMort(a.getAttribute("href"), this.index)) continue;
      a.classList.add("lien-mort");
      a.title = "Cette fiche n'existe plus : supprimée, ou son identifiant a changé.";
    }
  }

  // Relire maintenant (le texte arrive au fil) ou en différé, à moitié prix et sans cache : la relecture se dépose d'elle-même
  // plus tard. Un chapitre peut aussi se relire vite, avec les seuls passages de la bible liés à ses noms et à ses mots.
  actionsRelecture(chapitre) {
    if (this.relecturesEnCours.has(chapitre)) return "";
    // Un lot sans genre est une relecture du canon ; ceux de la mise en page ont leur place (actionsMiseEnPage).
    const lot = this.lots.find((l) => l.cible?.scenario === this.s.id && l.cible?.chapitre === chapitre && !l.cible?.genre && (l.etat === "en-cours" || l.etat === "erreur"));
    const quoi = chapitre === "ensemble" ? "l'ensemble" : "ce chapitre";
    const etatLot = !lot ? "" : lot.etat === "en-cours"
      ? `<p class="aide">Relecture différée demandée le ${e(date(lot.cree))} : elle arrivera d'elle-même, en général dans l'heure.</p>`
      : `<p class="aide erreur">La relecture différée du ${e(date(lot.cree))} a échoué (${e(lot.erreur || "inconnu")}).</p>`;
    const aide = chapitre === "ensemble"
      ? "Complète : la bible entière, pour tout le scénario. Différée : la même, à moitié prix, le résultat arrive dans l'heure."
      : "Complète : la bible entière. Rapide : les seuls passages liés aux noms et aux mots du chapitre, bien moins chère, mais un fait sans mot commun peut échapper. Différée : la complète à moitié prix, le résultat arrive dans l'heure.";
    return `
      <div class="actions-relecture">
        <p class="titre-relecture">Relecture du canon</p>
        <p class="aide">${aide}</p>
        ${etatLot}
        <div class="consigne-actions">
          <button type="button" data-relire="${e(chapitre)}" data-estimation="relecture" title="Relit ${quoi} au regard du canon (la bible entière), de la tablée et des idées">Complète</button>
          ${chapitre === "ensemble" ? "" : `<button type="button" data-relire="${e(chapitre)}" data-rapide data-estimation="relecture-rapide" title="Le canon par les seuls passages de la bible liés aux noms et aux mots du chapitre : bien moins cher, mais un fait sans mot commun avec le texte peut échapper">Rapide (moins chère)</button>`}
          ${lot?.etat === "en-cours" ? "" : `<button type="button" data-relire-differe="${e(chapitre)}" data-estimation="relecture" data-estimation-differe title="Au regard du canon, à moitié prix et sans cache ; le résultat arrive en général dans l'heure">Différée (moitié prix, dans l'heure)</button>`}
        </div>
      </div>`;
  }

  ideesLiees(ch) {
    const mots = motsCles(`${ch.texte || ""}\n${this.s.resume || ""}`).map(plier);
    if (!mots.length || !this.idees?.length) return "";
    const liees = this.idees.filter((i) => i.etat !== "ecartee" && (i.mots || []).some((m) => mots.includes(plier(m))));
    if (!liees.length) return "";
    return `
      <section class="idees-liees">
        <p class="canon-titre">Idées liées par leurs mots-clés</p>
        <ul>${liees.slice(0, 12).map((i) => `<li><span>${e(court(i.texte || "", 220))}</span> ${(i.mots || []).map((m) => `<a class="mot" href="#/idees?mot=${encodeURIComponent(m)}">#${e(m)}</a>`).join(" ")}</li>`).join("")}</ul>
      </section>`;
  }

  rendreConsigne(c, bloc) {
    if (!c) return { html: "" };
    const p = propositionDe(this.s, c);
    const g = GENRES[c.genre];
    const attrs = `data-cle="${e(c.cle)}" data-rang="${c.rang}"`;
    const ecriture = this.enCours.get(`${c.rang}#${c.cle}`);
    const etat = ecriture ? "redaction" : p ? "proposee" : "ouverte";
    const versions = c.genre === "rediger" || c.genre === "pistes";
    // « Vérifier » emporte la bible entière ; les autres consignes, le contexte léger et quelques passages.
    const estimation = `data-estimation="${c.genre === "verifier" ? "verifier" : "consigne"}"`;
    const actions = `
      <div class="consigne-actions">
        <button type="button" class="principal" data-proposer ${attrs} ${estimation}>Proposer</button>
        ${versions ? `<button type="button" data-proposer data-variantes="3" ${attrs} ${estimation} data-estimation-fois="3" title="Trois versions différentes, pour choisir">Trois versions</button>` : ""}
        <button type="button" data-modifier-consigne ${attrs}>Modifier</button>
        <button type="button" class="lien-danger" data-retirer-consigne ${attrs}>Retirer</button>
      </div>`;
    const enCours = ecriture ? `
      <div class="proposition en-cours">
        <p class="proposition-tete">${e(ecriture.etape)}</p>
        <div class="md" data-flux-consigne="${e(`${c.rang}#${c.cle}`)}">${rendre(ecriture.texte)}</div>
      </div>` : "";
    const boite = (enLigne) => `
      <div class="consigne${enLigne ? " en-ligne" : ""}" data-genre="${e(c.genre)}" data-etat="${etat}" ${attrs}>
        <p class="consigne-tete"><span class="consigne-genre">${e(g.nom)}</span><span class="consigne-etat">${ecriture ? "En rédaction" : p ? "Proposition à lire" : "En attente"}</span></p>
        ${enLigne ? "" : c.indications ? `<p class="consigne-indications">${e(c.indications)}</p>` : `<p class="consigne-indications vide">Sans indication : d'après ce qui entoure.</p>`}
        ${ecriture ? enCours : p ? this.rendreProposition(p, c) : actions}
      </div>`;
    if (bloc) return { html: boite(false) };
    return {
      html: `<button type="button" class="consigne-puce" data-genre="${e(c.genre)}" data-etat="${etat}" data-puce ${attrs} title="${e(`${g.nom} : ${c.indications}`)}">${e(court(c.indications || g.nom, 60))}</button>`,
      apres: p || ecriture ? boite(true) : "",
    };
  }

  rendreProposition(p, c) {
    const lu = c.genre === "verifier";
    return `
      <div class="proposition">
        <p class="proposition-tete">Proposition du ${e(date(p.date))}</p>
        <div class="md">${rendre(p.texte)}</div>
        <div class="consigne-actions">
          ${lu ? "" : `<button type="button" class="principal" data-integrer="${e(p.id)}">Intégrer au texte</button>`}
          <button type="button" data-proposer data-cle="${e(c.cle)}" data-rang="${c.rang}" title="Une nouvelle proposition remplace celle-ci">Autre proposition</button>
          <button type="button" data-redemander="${e(p.id)}" title="Changer les indications de la consigne">Redemander</button>
          <button type="button" ${lu ? 'class="principal"' : ""} data-retirer="${e(p.id)}">${lu ? "Lu, retirer la consigne" : "Retirer la consigne"}</button>
        </div>
      </div>`;
  }

  /* ---- Actions ---- */

  async clic(ev) {
    const b = ev.target.closest("button");
    if (!b || !this.r.contains(b)) return;
    const d = b.dataset;
    if (d.mode) return this.changerMode(d.mode);
    if (d.chapitre) return this.ouvrirChapitre(d.chapitre);
    if (d.intertitre !== undefined) return this.allerIntertitre(+d.intertitre);
    if (d.monter || d.descendre) {
      // Un second clic aussitôt, à la même place, tombe sur la ligne voisine : il continue de déplacer le même chapitre
      // (deux clics, deux crans), au lieu de défaire le premier.
      const sens = d.monter ? -1 : 1;
      const deja = this.deplace && this.deplace.sens === sens && Date.now() - this.deplace.quand < 600 ? this.deplace.id : null;
      return this.deplacer(deja || d.monter || d.descendre, sens);
    }
    if (d.inserer) return this.inserer(d.inserer);
    if (d.aller) return this.allerA(d.aller, +d.rang);
    if (d.puce !== undefined) {
      const c = this.consigne(d.cle, +d.rang);
      if (c && propositionDe(this.s, c)) return this.allerA(c.cle, c.rang);
      return this.ouvrirConsigne({ consigne: c });
    }
    if (d.modifierConsigne !== undefined) return this.ouvrirConsigne({ consigne: this.consigne(d.cle, +d.rang) });
    if (d.retirerConsigne !== undefined) return this.retirerConsigne(this.consigne(d.cle, +d.rang));
    if (d.integrer) return this.integrer(d.integrer);
    if (d.redemander) {
      const p = this.reponse(d.redemander);
      const c = p && this.consigne(p.cle, p.rang);
      return c && this.ouvrirConsigne({ consigne: c, redemander: p });
    }
    if (d.retirer) {
      const p = this.reponse(d.retirer);
      const c = p && this.consigne(p.cle, p.rang);
      if (c) this.retirerConsigne(c, p);
      return;
    }
    if (d.proposer !== undefined) return this.proposer(d.cle, +d.rang, +(d.variantes || 1));
    if (d.relire) return this.relireCanon(d.relire, d.rapide !== undefined);
    if (d.relireDiffere) return this.relireDiffere(d.relireDiffere);
    if (d.orpheline) return this.voirOrpheline(d.orpheline);
    if (d.mettreEnPage) return this.mettreEnPage(d.mettreEnPage);
    if (d.miseEnPageCourant !== undefined) return this.mettreEnPage(this.chap);
    if (d.mettreEnPageDiffere) return this.mettreEnPageDiffere(d.mettreEnPageDiffere);
    if (d.vueMiseEnPage) return this.voirMiseEnPage(d.vueMiseEnPage);
    if (d.choixPassage !== undefined) return this.choisirPassage(+d.rang, d.choixPassage);
    if (d.accepterMiseEnPage) return this.accepterMiseEnPage(d.accepterMiseEnPage);
    if (d.appliquerMiseEnPage) return this.appliquerMiseEnPage(d.appliquerMiseEnPage);
    if (d.refuserMiseEnPage) return this.refuserMiseEnPage(d.refuserMiseEnPage);
    if (d.effacerRelecture) return this.effacerRelecture(d.effacerRelecture);
    if (d.restaurer) return this.restaurer(+d.restaurer);
    const action = d.action;
    if (action === "ajouter-chapitre") this.ajouterChapitre();
    else if (action === "supprimer-chapitre") this.supprimerChapitre();
    else if (action === "consigne") this.ouvrirConsigne({});
    else if (action === "fiche") this.ouvrirFiches();
    else if (action === "imprimer") this.imprimer();
    else if (action === "sommaire") this.basculerSommaire();
    else if (action === "supprimer-scenario") this.supprimerScenario();
  }

  consigne(cle, rang) {
    return consignesDuScenario(this.s).find((c) => c.cle === cle && c.rang === rang) || null;
  }

  reponse(id) {
    return (this.s.reponses || []).find((r) => r.id === id) || null;
  }

  changerMode(mode) {
    if (!MODES[mode]) return;
    this.mode = mode;
    garderMode(mode);
    this.afficherChapitre();
    this.afficherAvis();
    if (mode !== "apercu") this.zone.focus({ preventScroll: true });
  }

  ouvrirChapitre(id) {
    if (!this.s.chapitres.some((c) => c.id === id)) return;
    this.chap = id;
    this.zoneTouchee = false;
    history.replaceState(null, "", `#/scenarios/${this.s.id}?chapitre=${id}`);
    this.zone.scrollTop = 0;
    this.r.querySelector(".apercu").scrollTop = 0;
    this.afficherChapitre();
    this.afficherSommaire();
    this.basculerSommaire(false);
  }

  basculerSommaire(ouvrir) {
    const ouvert = ouvrir ?? this.r.dataset.sommaire !== "ouvert";
    this.r.dataset.sommaire = ouvert ? "ouvert" : "ferme";
    this.r.querySelector(".ouvrir-sommaire").setAttribute("aria-expanded", String(ouvert));
  }

  ajouterChapitre() {
    const ch = { id: nouvelId(), titre: `Chapitre ${this.s.chapitres.length + 1}`, texte: "" };
    const i = this.s.chapitres.findIndex((c) => c.id === this.chap);
    this.s.chapitres.splice(i + 1, 0, ch);
    this.marquer();
    this.ouvrirChapitre(ch.id);
    const titre = this.r.querySelector(".titre-chapitre");
    titre.focus();
    titre.select();
  }

  // Sans confirmation : le chapitre attend sous « Chapitres supprimés », et le message porte « Annuler ».
  supprimerChapitre() {
    const ch = this.chapitre();
    const vide = !(ch.texte || "").trim();
    const i = this.s.chapitres.indexOf(ch);
    this.s.chapitres.splice(i, 1);
    if (!vide) this.s.corbeille = [{ ...ch, place: i, supprime: maintenant() }, ...(this.s.corbeille || [])].slice(0, CORBEILLE_MAX);
    if (!this.s.chapitres.length) this.s.chapitres.push({ id: nouvelId(), titre: "Premier chapitre", texte: "" });
    this.marquer();
    this.ouvrirChapitre(this.s.chapitres[Math.min(i, this.s.chapitres.length - 1)].id);
    if (vide) return;
    const s = this.s;
    toast(`Chapitre « ${ch.titre || "Sans titre"} » supprimé.`, "info", {
      action: {
        libelle: "Annuler",
        faire: () => {
          const rang = (s.corbeille || []).findIndex((c) => c.id === ch.id);
          if (this.detruit || this.s !== s || rang < 0) return toast("Le chapitre attend sous « Chapitres supprimés », en bas du sommaire.");
          this.restaurer(rang);
        },
      },
    });
  }

  restaurer(i) {
    const corbeille = this.s.corbeille || [];
    const ch = corbeille[i];
    if (!ch) return;
    const { place, supprime, ...propre } = ch;
    if (this.s.chapitres.some((c) => c.id === propre.id)) propre.id = nouvelId();
    this.s.chapitres.splice(Math.min(place ?? this.s.chapitres.length, this.s.chapitres.length), 0, propre);
    corbeille.splice(i, 1);
    this.marquer();
    this.ouvrirChapitre(propre.id);
  }

  deplacer(id, sens) {
    const liste = this.s.chapitres;
    const i = liste.findIndex((c) => c.id === id);
    const j = i + sens;
    if (i < 0 || j < 0 || j >= liste.length) return;
    [liste[i], liste[j]] = [liste[j], liste[i]];
    // La ligne déplacée reste en lumière : l'œil la suit.
    this.deplace = { id, sens, quand: Date.now() };
    this.marquer();
    this.afficherSommaire();
    this.r.querySelector(`.liste-chapitres [data-${sens < 0 ? "monter" : "descendre"}="${CSS.escape(id)}"]`)?.focus();
  }

  // Glisser un chapitre par sa poignée, au-dessus ou au-dessous d'un autre ; les flèches restent pour le clavier.
  glisserChapitres(liste) {
    let saisi = null;
    const ligne = (ev) => ev.target.closest?.(".liste-chapitres > li");
    const nettoyer = () => liste.querySelectorAll(".avant, .apres").forEach((x) => x.classList.remove("avant", "apres"));
    liste.addEventListener("dragstart", (ev) => {
      const li = ev.target.closest?.(".poignee") && ligne(ev);
      if (!li) return;
      saisi = li.dataset.id;
      ev.dataTransfer.effectAllowed = "move";
      ev.dataTransfer.setData("text/plain", li.querySelector(".titre")?.textContent || "");
      ev.dataTransfer.setDragImage(li, 16, 16);
      li.classList.add("glisse");
    });
    liste.addEventListener("dragover", (ev) => {
      const li = saisi && ligne(ev);
      if (!li) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      const r = li.getBoundingClientRect();
      const avant = ev.clientY < r.top + r.height / 2;
      nettoyer();
      if (li.dataset.id !== saisi) li.classList.add(avant ? "avant" : "apres");
    });
    liste.addEventListener("drop", (ev) => {
      const li = saisi && ligne(ev);
      if (!li) return;
      ev.preventDefault();
      const avant = li.classList.contains("avant");
      const chapitres = this.s.chapitres;
      const i = chapitres.findIndex((c) => c.id === saisi);
      if (i < 0 || li.dataset.id === saisi) return;
      const [ch] = chapitres.splice(i, 1);
      const cible = chapitres.findIndex((c) => c.id === li.dataset.id);
      chapitres.splice(avant ? cible : cible + 1, 0, ch);
      this.deplace = { id: ch.id, sens: 0, quand: Date.now() };
      saisi = null;
      this.marquer();
      this.afficherSommaire();
    });
    liste.addEventListener("dragend", () => {
      saisi = null;
      nettoyer();
      liste.querySelector(".glisse")?.classList.remove("glisse");
    });
  }

  // Intertitre ou encadré à lire, au curseur.
  inserer(genre) {
    const z = this.zone;
    if (this.mode === "apercu") this.changerMode("ecrire");
    if (!this.zoneTouchee) z.setSelectionRange(z.value.length, z.value.length);
    const { selectionStart: a, selectionEnd: b, value: t } = z;
    const debutLigne = t.lastIndexOf("\n", a - 1) + 1;
    if (genre === "titre") {
      const ligne = t.slice(debutLigne);
      if (/^#{1,4}\s/.test(ligne)) return;
      z.setRangeText("## ", debutLigne, debutLigne, "end");
    } else {
      const choisi = t.slice(a, b);
      const texte = choisi ? choisi.split("\n").map((l) => `> ${l}`).join("\n") : "> ";
      const avant = a > 0 && t[a - 1] !== "\n" ? "\n\n" : "";
      z.setRangeText(`${avant}${texte}`, a, b, "end");
    }
    z.focus();
    z.dispatchEvent(new Event("input"));
  }

  // Un intertitre choisi dans le sommaire : le texte et l'aperçu y vont, sans rien changer au texte.
  // Un passage trouvé par « Chercher dans ce scénario » (chercher/scenario.js) : son chapitre s'ouvre, le passage est
  // choisi dans le texte et mis en vue, et dans l'aperçu son paragraphe s'éclaire. focus : le texte prend la main.
  allerAuPassage(chapitre, debut, fin, { focus = true } = {}) {
    if (chapitre !== this.chap) this.ouvrirChapitre(chapitre);
    this.basculerSommaire(false);
    const z = this.zone;
    if (this.mode !== "apercu") {
      if (focus) z.focus({ preventScroll: true });
      z.setSelectionRange(debut, fin);
      this.zoneTouchee = true;
      z.scrollTop = Math.max(0, hauteurDans(z, debut) - z.clientHeight / 3);
    }
    if (this.mode === "ecrire") return;
    this.apercuDiffere.vider();
    const zone = this.r.querySelector(".apercu");
    const cible = blocDuTexte(zone.querySelector(":scope > .md"), z.value, debut);
    if (!cible || !zone.clientHeight) return;
    zone.scrollTop += cible.getBoundingClientRect().top - zone.getBoundingClientRect().top - zone.clientHeight / 3;
    // Une rangée de tableau s'éclaire par ses cases.
    for (const el of cible.tagName === "TR" ? [...cible.cells] : [cible]) {
      el.classList.remove("eclat");
      void el.offsetWidth;
      el.classList.add("eclat");
    }
  }

  allerIntertitre(rang) {
    const t = intertitres(this.chapitre().texte).find((x) => x.rang === rang);
    if (!t) return;
    this.basculerSommaire(false);
    if (this.mode !== "apercu") {
      const z = this.zone;
      const debut = intertitres(z.value).find((x) => x.rang === rang)?.debut ?? t.debut;
      z.focus({ preventScroll: true });
      z.setSelectionRange(debut, debut);
      z.scrollTop = Math.max(0, hauteurDans(z, debut) - 24);
    }
    if (this.mode === "ecrire") return;
    this.apercuDiffere.vider();
    const zone = this.r.querySelector(".apercu");
    const md = zone.querySelector(":scope > .md");
    const cible = md && [...md.children].filter((el) => /^H[2-5]$/.test(el.tagName))[rang];
    if (!cible || !zone.clientHeight) return;
    zone.scrollTop += cible.getBoundingClientRect().top - zone.getBoundingClientRect().top - 16;
    cible.classList.remove("eclat");
    void cible.offsetWidth;
    cible.classList.add("eclat");
  }

  allerA(cle, rang) {
    const c = this.consigne(cle, rang);
    if (!c) return;
    if (c.chapitre !== this.chap) this.ouvrirChapitre(c.chapitre);
    if (this.mode === "ecrire") {
      // La même consigne dans la zone, où les liens sont courts : ses positions y sont autres.
      const rang = consignesDuScenario(this.s).filter((x) => x.chapitre === c.chapitre).findIndex((x) => x.cle === c.cle && x.rang === c.rang);
      const ici = consignesDuTexte(this.zone.value)[rang] || c;
      this.zone.focus();
      this.zone.setSelectionRange(ici.debut, ici.fin);
      // Faire venir la sélection en vue : la textarea ne défile pas toujours seule.
      const lignes = this.zone.value.slice(0, ici.debut).split("\n").length;
      const hauteur = parseFloat(getComputedStyle(this.zone).lineHeight) || 30;
      this.zone.scrollTop = Math.max(0, lignes * hauteur - this.zone.clientHeight / 3);
      return;
    }
    const cible = this.r.querySelector(`.apercu .consigne[data-cle="${CSS.escape(cle)}"][data-rang="${rang}"]`)
      || this.r.querySelector(`.apercu .consigne-puce[data-cle="${CSS.escape(cle)}"][data-rang="${rang}"]`);
    if (cible) {
      cible.scrollIntoView({ block: "center", behavior: "smooth" });
      cible.classList.remove("eclat");
      void cible.offsetWidth;
      cible.classList.add("eclat");
    }
  }

  /* ---- Liens vers les fiches ---- */

  chargerFiches() {
    if (this.fichesEnCours) return this.fichesEnCours;
    const lire = (url) => api.get(url).catch(() => null);
    this.fichesEnCours = Promise.all(["/api/pnj", "/api/lieux", "/api/plans", "/api/rencontres", "/api/cartes", "/api/renommages"].map(lire))
      .then(([pnj, lieux, plans, rencontres, cartes, renommages]) => {
        this.fichesEnCours = null;
        if (this.detruit) return;
        const listes = { pnj, lieux, plans, rencontres, cartes };
        this.fichesLues = Date.now();
        if (Object.values(listes).every((l) => !l)) {
          this.fichesErreur = true;
          return;
        }
        this.fichesErreur = false;
        this.fiches = fichesDe(listes);
        this.index = indexFiches({ ...listes, renommages });
        this.marquerLiens();
      });
    return this.fichesEnCours;
  }

  // Bouton Fiche, ou « @ » tapé en début de mot (arobase : sa position) : une recherche dans les fiches de l'atelier,
  // puis le lien s'insère là où était le curseur. Un mot choisi devient le libellé, tel quel.
  ouvrirFiches(arobase = null) {
    const z = this.zone;
    if (this.mode === "apercu") this.changerMode("ecrire");
    if (!this.zoneTouchee) z.setSelectionRange(z.value.length, z.value.length);
    const selection = [z.selectionStart, z.selectionEnd];
    this.lien = { chapitre: this.chap, texte: z.value, fichier: this.chapitre().texte || "", selection, arobase };
    const dlg = this.r.querySelector(".dialogue-fiche");
    const q = dlg.querySelector('input[name="q"]');
    const libelle = arobase === null && selection[0] !== selection[1] ? libelleDe(z.value, ...selection) : null;
    q.value = libelle || "";
    dlg.querySelector(".aide-fiche").textContent = arobase !== null ? "Le lien prend la place du « @ » ; Échap le laisse tel quel."
      : libelle ? `« ${court(libelle, 60)} » devient le libellé du lien, le reste du texte ne change pas.`
      : "Le lien se pose au curseur, sous le nom de la fiche. Dans l'aperçu, un clic l'ouvre ; revenir au scénario ramène ici.";
    this.choixFiche = 0;
    dlg.returnValue = "";
    dlg.showModal();
    q.focus();
    q.select();
    this.afficherChoixFiches();
    if (!this.fiches || Date.now() - (this.fichesLues || 0) > 30000) {
      this.chargerFiches().then(() => {
        if (dlg.open) this.afficherChoixFiches();
      });
    }
  }

  afficherChoixFiches() {
    const dlg = this.r.querySelector(".dialogue-fiche");
    const q = dlg.querySelector('input[name="q"]');
    const liste = dlg.querySelector(".choix-fiches");
    if (!this.fiches) {
      this.trouvees = [];
      liste.innerHTML = `<li class="vide">${this.fichesErreur && !this.fichesEnCours ? "Les fiches ne répondent pas : réessayez dans un instant." : "Chargement des fiches…"}</li>`;
    } else {
      // Les fiches déjà liées dans ce scénario d'abord, puis celles de la même carte (« @ » + trois lettres + Entrée).
      this.trouvees = chercherFiches(this.fiches, q.value, { contexte: contexteDuScenario(this.s, this.fiches) });
      this.choixFiche = Math.min(this.choixFiche || 0, Math.max(0, this.trouvees.length - 1));
      liste.innerHTML = this.trouvees.map((f, i) => `
        <li role="option" id="choix-fiche-${i}" data-i="${i}" data-genre="${e(f.genre)}" aria-selected="false">
          <span class="nom">${e(f.nom)}</span><span class="genre">${e([GENRES_FICHES[f.genre].nom, f.detail].filter(Boolean).join(" · "))}</span>
        </li>`).join("") || this.enEcrivant.htmlAucune(q.value);
    }
    dlg.querySelector('button[value="lier"]').disabled = !this.trouvees.length;
    this.majChoixFiche();
  }

  majChoixFiche() {
    const dlg = this.r.querySelector(".dialogue-fiche");
    const q = dlg.querySelector('input[name="q"]');
    let actif = null;
    for (const li of dlg.querySelectorAll(".choix-fiches [data-i]")) {
      const oui = +li.dataset.i === this.choixFiche;
      li.setAttribute("aria-selected", String(oui));
      if (oui) actif = li;
    }
    if (actif) {
      q.setAttribute("aria-activedescendant", actif.id);
      actif.scrollIntoView({ block: "nearest" });
    } else q.removeAttribute("aria-activedescendant");
  }

  fermerFiches(dlg) {
    const ed = this.lien;
    this.lien = null;
    if (!ed || this.detruit) return;
    const z = this.zone;
    const fiche = dlg.returnValue === "lier" ? this.trouvees?.[this.choixFiche] : null;
    const ch = this.chapitre(ed.chapitre);
    if (ch.id !== this.chap) return;
    if (!fiche) {
      z.focus({ preventScroll: true });
      z.setSelectionRange(...ed.selection);
      return;
    }
    // Le texte a pu être relu depuis un autre écran pendant la recherche : les positions ne vaudraient plus rien.
    if ((ch.texte || "") !== ed.fichier || z.value !== ed.texte) {
      toast("Le texte a changé pendant la recherche : le lien n'est pas inséré, recommencez.", "erreur");
      return;
    }
    // Court dans la zone (@[Nom]), entier dans le fichier : la table du chapitre retient son adresse.
    const court = (libelle) => this.courts.retenir(ch, ed.texte, libelle, fiche.route);
    const { debut, fin, insere } = insertionLien(ed.texte, ...ed.selection, fiche, { arobase: ed.arobase, court });
    z.focus({ preventScroll: true });
    z.setSelectionRange(debut, fin);
    // Par la saisie du navigateur, pour que Cmd+Z défasse le lien ; sinon comme les autres insertions.
    let fait = false;
    try {
      fait = document.execCommand("insertText", false, insere);
    } catch {
      fait = false;
    }
    if (!fait || z.value !== ed.texte.slice(0, debut) + insere + ed.texte.slice(fin)) {
      z.value = ed.texte;
      z.setRangeText(insere, debut, fin, "end");
      z.dispatchEvent(new Event("input"));
    }
  }

  /* ---- Consignes ---- */

  ouvrirConsigne({ consigne = null, redemander = null }) {
    const dlg = this.r.querySelector(".dialogue-consigne");
    const form = dlg.querySelector("form");
    const z = this.zone;
    const selection = this.zoneTouchee ? [z.selectionStart, z.selectionEnd] : [z.value.length, z.value.length];
    this.edition = { consigne, redemander, selection, chapitre: this.chap };
    const choisi = !consigne && this.mode !== "apercu" ? z.value.slice(...selection).trim() : "";
    // Un passage choisi dans le texte passe avant le brouillon, qui reste gardé pour la fois suivante.
    const brouillon = !consigne && !choisi ? brouillonConsigne : null;
    form.genre.value = consigne?.genre || brouillon?.genre || "rediger";
    form.indications.value = consigne ? consigne.indications : choisi || brouillon?.indications || "";
    this.edition.selectionReprise = Boolean(choisi);
    this.edition.depart = form.indications.value;
    dlg.querySelector("h2").textContent = redemander ? "Redemander" : consigne ? "Modifier la consigne" : "Laisser une consigne";
    dlg.querySelector('button[value="poser"]').textContent = redemander ? "Redemander" : consigne ? "Enregistrer" : "Poser la consigne";
    dlg.returnValue = "";
    dlg.showModal();
    form.indications.focus();
  }

  fermerConsigne(dlg) {
    const ed = this.edition;
    this.edition = null;
    if (!ed) return;
    const form = dlg.querySelector("form");
    if (dlg.returnValue !== "poser") {
      // Une nouvelle consigne garde ce qui a été tapé ; un passage repris tel quel ne remplace pas le brouillon.
      if (!ed.consigne && !(ed.selectionReprise && form.indications.value === ed.depart)) {
        brouillonConsigne = form.indications.value.trim() ? { genre: form.genre.value, indications: form.indications.value } : null;
      }
      return;
    }
    if (!ed.consigne) brouillonConsigne = null;
    const genre = form.genre.value;
    const indications = form.indications.value;
    const marque = ecrireConsigne(genre, indications);
    if (ed.consigne) {
      const c = this.consigne(ed.consigne.cle, ed.consigne.rang) || ed.consigne;
      const ch = this.chapitre(c.chapitre);
      const change = genre !== c.genre || indications.trim().split(/\s+/).join(" ") !== c.indications.split(/\s+/).join(" ");
      if (change) {
        ch.texte = ch.texte.slice(0, c.debut) + marque + ch.texte.slice(c.fin);
        ch.texte_modifie = maintenant();
        if (ch.id === this.chap) this.remplacerTexte(ch.texte);
      }
      if (ed.redemander) this.changerStatut(ed.redemander, "ecartee");
      if (change) this.marquer();
      this.afficherSommaire();
      this.afficherApercu();
      return;
    }
    const ch = this.chapitre(ed.chapitre);
    // Les positions sont celles de la zone d'écriture, où les liens sont courts : la consigne s'y pose.
    const t = ch.id === this.chap ? this.zone.value : this.courts.zone(ch);
    let [a, b] = this.mode === "apercu" ? [t.length, t.length] : ed.selection;
    let insere;
    if (genre === "verifier" && a !== b) {
      // Vérifier : le passage choisi reste, la consigne se pose juste après.
      const fin = t.indexOf("\n", b);
      a = b = fin < 0 ? t.length : fin;
      insere = `\n\n${marque}`;
    } else {
      if (!ed.selectionReprise) b = a;
      const avant = t.slice(t.lastIndexOf("\n", a - 1) + 1, a);
      const finLigne = t.indexOf("\n", b);
      const apres = t.slice(b, finLigne < 0 ? t.length : finLigne);
      if (!avant.trim() && !apres.trim()) insere = marque;
      else insere = `${avant && !/\s$/.test(avant) ? " " : ""}${marque}${apres && !/^\s/.test(apres) ? " " : ""}`;
      if (this.mode === "apercu" && t.trim()) insere = `${/\n\n$/.test(t) ? "" : /\n$/.test(t) ? "\n" : "\n\n"}${marque}`;
    }
    const nouveau = t.slice(0, a) + insere + t.slice(b);
    ch.texte = this.courts.fichier(ch, nouveau);
    ch.texte_modifie = maintenant();
    if (ch.id === this.chap) {
      const haut = this.zone.scrollTop;
      this.zone.value = nouveau;
      this.zone.scrollTop = haut;
      this.compterMots();
      if (this.mode !== "apercu") {
        this.zone.focus();
        this.zone.setSelectionRange(a + insere.length, a + insere.length);
      }
    }
    this.marquer();
    this.afficherSommaire();
    this.afficherApercu();
  }

  remplacerTexte(texte) {
    const haut = this.zone.scrollTop;
    this.zone.value = this.courts.zone({ id: this.chap, texte });
    this.zone.scrollTop = haut;
    this.compterMots();
  }

  async retirerConsigne(c, proposition = null) {
    if (!c) return;
    if (!proposition && c.indications) {
      if (!(await demander({ titre: "Retirer la consigne", texte: "La consigne et ses indications quittent le texte du chapitre.", oui: "Retirer la consigne", danger: true }))) return;
      // Le texte a pu bouger pendant la question : la consigne se relit à sa place du moment.
      c = this.consigne(c.cle, c.rang);
      if (!c) return;
    }
    const ch = this.chapitre(c.chapitre);
    ch.texte = retirerPlage(ch.texte, c.debut, c.fin, c.bloc);
    ch.texte_modifie = maintenant();
    if (ch.id === this.chap) this.remplacerTexte(ch.texte);
    if (proposition) this.changerStatut(proposition, "retiree");
    this.marquer();
    this.afficherSommaire();
    this.afficherApercu();
  }

  integrer(id) {
    const p = this.reponse(id);
    const c = p && this.consigne(p.cle, p.rang);
    if (!c) return;
    const ch = this.chapitre(c.chapitre);
    ch.texte = ch.texte.slice(0, c.debut) + p.texte.trim() + ch.texte.slice(c.fin);
    ch.texte_modifie = maintenant();
    if (ch.id === this.chap) this.remplacerTexte(ch.texte);
    this.changerStatut(p, "integree");
    this.marquer();
    this.afficherSommaire();
    this.afficherApercu();
    toast("Proposition intégrée au texte : elle est à vous, retouchez-la à votre guise.");
  }

  // Le statut part après l'enregistrement du texte, dans la même file ; d'ici là, il s'affiche déjà.
  changerStatut(p, statut) {
    p.statut = statut;
    this.statutsEnCours.set(p.id, statut);
    this.chaine = this.chaine.then(() => this.ecrire()).then(async () => {
      try {
        const srv = await api.patch(`/api/scenarios/${encodeURIComponent(this.s.id)}/reponses/${encodeURIComponent(p.id)}`, { statut });
        this.statutsEnCours.delete(p.id);
        if (this.bases[this.s.id]) this.bases[this.s.id].reponses = copie(srv.reponses || []);
        this.reprendreAnnexes(srv);
      } catch (err) {
        this.statutsEnCours.delete(p.id);
        toast(`Choix non enregistré : ${err.message}`, "erreur");
      }
    });
  }

  voirOrpheline(id) {
    const p = this.reponse(id);
    if (!p) return;
    const dlg = document.createElement("dialog");
    dlg.className = "dialogue dialogue-orpheline";
    dlg.innerHTML = `
      <form method="dialog">
        <h2>${e(GENRES[p.genre]?.nom || "Proposition")}</h2>
        <p class="aide">La consigne « ${e(court(p.indications || "", 160))} » a changé ou n'est plus dans le texte. Voici ce qui avait été proposé le ${e(date(p.date))}.</p>
        <div class="md proposition">${rendre(p.texte)}</div>
        <div class="actions">
          <button value="copier">Copier le texte</button>
          <button value="ecarter" class="danger">Écarter</button>
          <button value="fermer" class="principal">Fermer</button>
        </div>
      </form>`;
    this.r.append(dlg);
    dlg.addEventListener("close", async () => {
      if (dlg.returnValue === "ecarter") {
        this.changerStatut(p, "ecartee");
        this.afficherSommaire();
      } else if (dlg.returnValue === "copier") {
        const zone = document.createElement("textarea");
        zone.value = p.texte;
        document.body.append(zone);
        zone.select();
        document.execCommand("copy");
        zone.remove();
        toast("Texte copié.");
      }
      dlg.remove();
    });
    dlg.showModal();
  }

  // Le texte du chapitre part d'abord au serveur (la consigne doit y être), puis la proposition s'écrit sous la consigne.
  async proposer(cle, rang, variantes = 1) {
    const cleEnCours = `${rang}#${cle}`;
    if (!this.consigne(cle, rang) || this.enCours.has(cleEnCours)) return;
    const precedente = propositionDe(this.s, this.consigne(cle, rang));
    if (precedente && !(await demander({ titre: "Nouvelle proposition", texte: "Une nouvelle proposition remplacera celle qui est sous la consigne.", oui: "La remplacer", non: "Garder celle-ci", danger: true }))) return;
    if (this.modifie || this.sauver.enAttente()) this.sauver.maintenant();
    await this.chaine;
    if (this.modifie) return toast("Le scénario n'est pas encore enregistré : réessayez dans un instant.", "erreur");
    this.enCours.set(cleEnCours, { texte: "", etape: variantes > 1 ? "Trois versions en cours d'écriture…" : "Proposition en cours d'écriture…" });
    if (this.mode === "ecrire") this.changerMode("cote");
    this.afficherSommaire();
    this.afficherApercu();
    this.allerA(cle, rang);
    try {
      const fin = await flux(`/api/flux/scenarios/${encodeURIComponent(this.s.id)}/consignes`, { cle, rang, variantes }, (ev) => {
        const en = this.enCours.get(cleEnCours);
        if (!en) return;
        if (ev.t === "etape") en.etape = ev.d;
        if (ev.t === "texte") en.texte += ev.d;
        this.majFlux(`[data-flux-consigne="${CSS.escape(cleEnCours)}"]`, en.texte);
      });
      this.enCours.delete(cleEnCours);
      if (this.bases[this.s.id]) this.bases[this.s.id].reponses = copie(fin.scenario.reponses || []);
      this.reprendreAnnexes(fin.scenario);
      this.afficherSommaire();
      this.afficherApercu();
    } catch (err) {
      this.enCours.delete(cleEnCours);
      this.afficherSommaire();
      this.afficherApercu();
      toast(`Proposition impossible : ${erreurIA(err, "la consigne reste dans le texte, à écrire vous-même ou à redemander plus tard")}.`, "erreur");
    }
  }

  async relireCanon(chapitre, rapide = false) {
    if (this.relecturesEnCours.has(chapitre)) return;
    if (this.modifie || this.sauver.enAttente()) this.sauver.maintenant();
    await this.chaine;
    this.relecturesEnCours.set(chapitre, { texte: "", rapide });
    if (chapitre !== "ensemble" && this.mode === "ecrire") this.changerMode("cote");
    this.afficherSommaire();
    this.afficherApercu();
    try {
      const fin = await flux(`/api/flux/scenarios/${encodeURIComponent(this.s.id)}/relectures/${encodeURIComponent(chapitre)}${rapide ? "?rapide=true" : ""}`, {}, (ev) => {
        const en = this.relecturesEnCours.get(chapitre);
        if (!en || ev.t !== "texte") return;
        en.texte += ev.d;
        this.majFlux(`[data-flux-relecture="${CSS.escape(chapitre)}"]`, en.texte);
      });
      this.relecturesEnCours.delete(chapitre);
      if (this.bases[this.s.id]) this.bases[this.s.id].relectures = copie(fin.scenario.relectures || {});
      this.reprendreAnnexes(fin.scenario);
      this.afficherSommaire();
      this.afficherApercu();
    } catch (err) {
      this.relecturesEnCours.delete(chapitre);
      this.afficherSommaire();
      this.afficherApercu();
      toast(`Relecture impossible : ${erreurIA(err)}.`, "erreur");
    }
  }

  async relireDiffere(chapitre) {
    if (this.modifie || this.sauver.enAttente()) this.sauver.maintenant();
    await this.chaine;
    try {
      this.lots = [...this.lots, await api.post(`/api/scenarios/${encodeURIComponent(this.s.id)}/relectures/${encodeURIComponent(chapitre)}/differee`, {})];
      toast("Relecture demandée : elle s'affichera ici d'elle-même, en général dans l'heure.");
      this.afficherSommaire();
      this.afficherApercu();
    } catch (err) {
      toast(`Relecture impossible : ${erreurIA(err)}.`, "erreur");
    }
  }

  /* ---- Relecture et mise en page : une version corrigée du chapitre, proposée à côté du texte ---- */

  // La proposition d'un chapitre, sauf celle que le MJ vient d'accepter ou de refuser et que le serveur retire encore.
  propositionMiseEnPage(id) {
    const p = this.s.mises_en_page?.[id];
    return p && this.misesRetirees.get(id) !== p.date ? p : null;
  }

  // Le dernier lot différé de mise en page de ce chapitre : en cours, ou en échec depuis la dernière proposition.
  lotMiseEnPage(id) {
    const lot = [...this.lots].reverse().find((l) => l.cible?.scenario === this.s.id && l.cible?.genre === GENRE_MISE_EN_PAGE && l.cible?.chapitre === id);
    if (!lot || lot.etat === "en-cours") return lot || null;
    const p = this.propositionMiseEnPage(id);
    return lot.etat === "erreur" && !(p && new Date(p.date) > new Date(lot.cree)) ? lot : null;
  }

  // Les choix du MJ pour la proposition d'un chapitre ; une nouvelle proposition repart de zéro.
  choixDe(id, p) {
    let c = this.choixMiseEnPage.get(id);
    if (!c || c.date !== p.date) {
      c = { date: p.date, vue: "ecart", decisions: new Map() };
      this.choixMiseEnPage.set(id, c);
    }
    return c;
  }

  // Les passages qui changent entre le chapitre et sa proposition, chacun comparé mot à mot. Calculé une fois par
  // proposition : il ne vaut que tant que le chapitre a l'empreinte du texte relu.
  comparaison(ch, p) {
    const cle = `${p.date}|${p.base}`;
    let c = this.ecartsMiseEnPage.get(ch.id);
    if (!c || c.cle !== cle) {
      const morceaux = passages(ch.texte || "", p.texte);
      const changes = morceaux.filter((m) => !m.egal).map((m) => {
        const mots = ecart(m.avant, m.apres);
        return { ...m, mots, bilan: bilanEcart(mots) };
      });
      c = { cle, morceaux, changes };
      this.ecartsMiseEnPage.set(ch.id, c);
    }
    return c;
  }

  // Dans l'aperçu, sous le chapitre : la relecture en cours, puis la proposition (ce qui change, passage par passage, ou
  // le résultat mis en page) et ses gestes. Si le chapitre a changé depuis, rien ne s'applique : on relance.
  htmlMiseEnPage(ch) {
    const ecriture = this.misesEnCours.get(ch.id);
    if (ecriture) {
      return `
      <section class="canon mise-en-page en-cours" data-verdict="a-verifier">
        <p class="canon-titre">Relecture et mise en page</p>
        <p class="aide">Relecture en cours…</p>
        <div class="md" data-flux-mise-en-page="${e(ch.id)}">${rendre(ecriture.texte)}</div>
      </section>`;
    }
    const p = this.propositionMiseEnPage(ch.id);
    if (!p) return "";
    const id = e(ch.id);
    const resultat = () => `<div class="md resultat-mise-en-page">${rendre(p.texte, { consigne: () => ({ html: `<span class="consigne-gardee">consigne gardée telle quelle</span>` }) })}</div>`;
    if (empreinte(ch.texte || "") !== p.base) {
      return `
      <section class="canon mise-en-page perimee" data-verdict="a-verifier">
        <p class="canon-titre">Mise en page proposée</p>
        <p class="aide">Relu le ${e(date(p.date))}. Le chapitre a changé depuis : la comparaison ne vaut plus pour votre texte d'aujourd'hui, et rien ne peut en être appliqué. Relancez la relecture, ou retirez cette proposition.</p>
        <details><summary>Voir ce qui avait été proposé</summary>${resultat()}</details>
        <div class="consigne-actions">
          <button type="button" class="principal" data-mettre-en-page="${id}" data-estimation="mise-en-page">Relancer la relecture</button>
          <button type="button" class="lien-danger" data-refuser-mise-en-page="${id}">Retirer la proposition</button>
        </div>
      </section>`;
    }
    const { changes } = this.comparaison(ch, p);
    const choix = this.choixDe(ch.id, p);
    const ajoutes = changes.reduce((n, c) => n + c.bilan.ajoutes, 0);
    const retires = changes.reduce((n, c) => n + c.bilan.retires, 0);
    const mots = [ajoutes ? pluriel(ajoutes, "mot ajouté", "mots ajoutés") : "", retires ? pluriel(retires, "mot retiré", "mots retirés") : ""].filter(Boolean).join(", ")
      || "ponctuation, espaces et sauts de ligne seulement";
    const acceptes = [...choix.decisions.values()].filter((d) => d === "accepter").length;
    const passage = (c, i) => {
      const d = choix.decisions.get(i) || "";
      // Un saut de ligne ajouté ou retiré se voit : il porte sa marque.
      const visibles = c.mots.map((m) => (m.type === "egal" ? m : { ...m, texte: m.texte.replace(/\n/g, "↵\n") }));
      return `
        <div class="passage-mise-en-page" data-decision="${d}">
          <p class="passage-tete"><span>Passage ${i + 1} sur ${changes.length}</span><span class="decision">${d === "accepter" ? "Accepté" : d === "refuser" ? "Refusé" : "À trancher"}</span></p>
          <p class="ecart-lore">${htmlEcart(visibles, e)}</p>
          <div class="consigne-actions">
            ${d ? `<button type="button" data-choix-passage="" data-rang="${i}">Changer d'avis</button>`
              : `<button type="button" data-choix-passage="refuser" data-rang="${i}">Refuser ce passage</button>
                 <button type="button" data-choix-passage="accepter" data-rang="${i}">Accepter ce passage</button>`}
          </div>
        </div>`;
    };
    return `
      <section class="canon mise-en-page" data-verdict="a-verifier">
        <p class="canon-titre">Mise en page proposée</p>
        <p class="aide">Relu le ${e(date(p.date))}. ${pluriel(changes.length, "passage change", "passages changent")} : ${e(mots)}. Votre texte reste tel quel tant que vous n'acceptez pas.</p>
        <div class="vues-lore" role="group" aria-label="Affichage de la proposition">
          <button type="button" data-vue-mise-en-page="ecart" aria-pressed="${choix.vue === "ecart"}">Ce qui change</button>
          <button type="button" data-vue-mise-en-page="resultat" aria-pressed="${choix.vue === "resultat"}">Le résultat mis en page</button>
        </div>
        ${choix.vue === "resultat" ? resultat() : changes.map(passage).join("")}
        <div class="consigne-actions actions-mise-en-page">
          <button type="button" class="principal" data-accepter-mise-en-page="${id}">Accepter tout le chapitre</button>
          ${choix.decisions.size ? `<button type="button" data-appliquer-mise-en-page="${id}">Appliquer mes choix (${pluriel(acceptes, "passage accepté", "passages acceptés")} sur ${changes.length})</button>` : ""}
          <button type="button" class="lien-danger" data-refuser-mise-en-page="${id}">Refuser</button>
        </div>
      </section>`;
  }

  // Sous l'aperçu d'un chapitre : relire maintenant (le texte arrive au fil) ou en différé, à moitié prix.
  actionsMiseEnPage(ch) {
    if (this.misesEnCours.has(ch.id)) return "";
    const lot = this.lotMiseEnPage(ch.id);
    const vide = !(ch.texte || "").trim();
    const etatLot = !lot ? "" : lot.etat === "en-cours"
      ? `<p class="aide">Relecture différée demandée le ${e(date(lot.cree))} : la proposition arrivera d'elle-même, en général dans l'heure.</p>`
      : `<p class="aide erreur">La relecture différée du ${e(date(lot.cree))} n'a rien proposé (${e(lot.erreur || "inconnu")}). Votre texte n'a pas changé.</p>`;
    return `
      <div class="actions-relecture">
        <p class="titre-relecture">Relecture et mise en page</p>
        <p class="aide">Orthographe, grammaire, ponctuation, typographie, intertitres, listes et encadrés à lire : la rédaction propose sa version de ce chapitre, que vous comparez à la vôtre avant d'accepter. Elle ne touche ni au fond, ni au style, ni aux consignes.</p>
        ${etatLot}
        <div class="consigne-actions">
          <button type="button" data-mettre-en-page="${e(ch.id)}" data-estimation="mise-en-page"${vide || this.serieMiseEnPage ? " disabled" : ""} title="Une version corrigée et mise en page de ce chapitre, proposée à côté de votre texte">Relire et mettre en page</button>
          ${lot?.etat === "en-cours" ? "" : `<button type="button" data-mettre-en-page-differe="${e(ch.id)}" data-estimation="mise-en-page" data-estimation-differe${vide ? " disabled" : ""} title="La même relecture à moitié prix ; la proposition arrive en général dans l'heure">Différée (moitié prix, dans l'heure)</button>`}
        </div>
      </div>`;
  }

  // Dans le sommaire : tout le scénario, un chapitre après l'autre, ou en différé (un lot par chapitre).
  htmlMiseEnPageEnsemble() {
    const ecrits = this.s.chapitres.filter((c) => (c.texte || "").trim()).length;
    const proposes = this.s.chapitres.filter((c) => this.propositionMiseEnPage(c.id));
    const serie = this.serieMiseEnPage;
    const attendus = this.s.chapitres.filter((c) => this.lotMiseEnPage(c.id)?.etat === "en-cours").length;
    return `
      <div class="actions-relecture">
        <p class="titre-relecture">Relecture et mise en page</p>
        <p class="aide">Chaque chapitre est relu, corrigé et mis en page ; sa version vous est proposée, à comparer avant d'accepter.</p>
        ${serie ? `<p class="aide serie-en-cours">Relecture en cours${serie.rang ? ` : chapitre ${serie.rang} sur ${serie.sur}` : ""}…</p>` : ""}
        ${attendus ? `<p class="aide">${pluriel(attendus, "chapitre attend sa relecture différée", "chapitres attendent leur relecture différée")} : les propositions arriveront d'elles-mêmes.</p>` : ""}
        ${proposes.length ? `<p class="aide"><button type="button" class="lien" data-chapitre="${e(proposes[0].id)}">${pluriel(proposes.length, "chapitre a une mise en page proposée", "chapitres ont une mise en page proposée")}</button>, à comparer dans l'aperçu.</p>` : ""}
        <div class="consigne-actions">
          <button type="button" data-mettre-en-page="${ENSEMBLE}" data-estimation="mise-en-page" data-estimation-fois="${Math.max(1, ecrits)}"${serie || !ecrits ? " disabled" : ""} title="Tous les chapitres écrits, l'un après l'autre">Tout le scénario</button>
          <button type="button" data-mettre-en-page-differe="${ENSEMBLE}" data-estimation="mise-en-page" data-estimation-differe data-estimation-fois="${Math.max(1, ecrits)}"${!ecrits ? " disabled" : ""} title="Tous les chapitres écrits, à moitié prix ; les propositions arrivent en général dans l'heure">Différée (moitié prix, dans l'heure)</button>
        </div>
      </div>`;
  }

  // Le texte en attente part d'abord au serveur : c'est lui qui est relu, et son empreinte que garde la proposition.
  async toutEnregistre() {
    if (this.modifie || this.sauver.enAttente()) this.sauver.maintenant();
    await this.chaine;
    if (!this.modifie) return true;
    toast("Le scénario n'est pas encore enregistré : réessayez dans un instant.", "erreur");
    return false;
  }

  async mettreEnPage(chapitre) {
    const tout = chapitre === ENSEMBLE;
    if (this.serieMiseEnPage || this.misesEnCours.has(chapitre)) return;
    const ecrits = tout ? this.s.chapitres.filter((c) => (c.texte || "").trim()) : this.s.chapitres.filter((c) => c.id === chapitre && (c.texte || "").trim());
    if (!ecrits.length) return toast(tout ? "Ce scénario n'a encore aucun texte à relire." : "Ce chapitre est vide : rien à relire.");
    if (tout && !(await demander({ titre: "Relire et mettre en page tout le scénario", texte: [`${pluriel(ecrits.length, "chapitre sera relu", "chapitres seront relus, l'un après l'autre")}. Chaque proposition attendra dans son chapitre, à comparer avec votre texte.`, "Rien ne change dans le scénario tant que vous n'acceptez pas."], oui: "Lancer la relecture" }))) return;
    if (!(await this.toutEnregistre()) || this.serieMiseEnPage || this.misesEnCours.has(chapitre)) return;
    const s = this.s;
    if (tout) this.serieMiseEnPage = { rang: 0, sur: ecrits.length };
    else this.misesEnCours.set(chapitre, { texte: "" });
    // Sur un écran étroit, « Côte à côte » ne montre que le texte : la relecture s'y suit dans l'aperçu.
    if (!tout && chapitre === this.chap && this.mode !== "apercu") this.changerMode(matchMedia("(max-width: 1100px)").matches ? "apercu" : this.mode === "ecrire" ? "cote" : this.mode);
    this.afficherSommaire();
    this.afficherApercu();
    const finir = () => {
      this.misesEnCours.clear();
      this.serieMiseEnPage = null;
    };
    try {
      const fin = await flux(`/api/flux/scenarios/${encodeURIComponent(s.id)}/mises-en-page/${encodeURIComponent(chapitre)}`, {}, (ev) => {
        if (this.detruit || this.s.id !== s.id) return;
        if (ev.t === "chapitre") {
          this.misesEnCours.set(ev.chapitre, { texte: "" });
          if (this.serieMiseEnPage) Object.assign(this.serieMiseEnPage, { rang: ev.rang, sur: ev.sur });
          this.afficherSommaire();
          this.afficherApercu();
        } else if (ev.t === "texte") {
          const en = this.misesEnCours.get(ev.chapitre);
          if (!en) return;
          en.texte += ev.d;
          this.majFlux(`[data-flux-mise-en-page="${CSS.escape(ev.chapitre)}"]`, en.texte);
        } else if (ev.t === "depose" && tout) {
          // Dans une série, chaque proposition se montre dès qu'elle est déposée.
          this.misesEnCours.delete(ev.chapitre);
          api.get(`/api/scenarios/${encodeURIComponent(s.id)}`).then((srv) => this.reprendreAnnexes(srv)).catch(() => {});
        }
      });
      finir();
      if (this.detruit || this.s.id !== s.id) return;
      if (this.bases[s.id]) this.bases[s.id].mises_en_page = copie(fin.scenario.mises_en_page || {});
      this.reprendreAnnexes(fin.scenario);
      this.afficherSommaire();
      this.afficherApercu();
      this.direBilanMiseEnPage(fin, tout);
      if (!tout && chapitre === this.chap) this.r.querySelector(".apercu .mise-en-page")?.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (err) {
      finir();
      if (this.detruit) return;
      this.afficherSommaire();
      this.afficherApercu();
      // Un refus des garde-fous se dit tel quel : il explique pourquoi rien n'est proposé.
      if (/^Mise en page refusée/.test(err.message || "")) toast(`${err.message}. Votre texte n'a pas changé : relancez la relecture, ou corrigez ce chapitre à la main.`, "erreur");
      else toast(`Relecture impossible : ${erreurIA(err)}.`, "erreur");
      // Ce qui a été déposé avant la panne est gardé.
      this.relire();
    }
  }

  direBilanMiseEnPage(fin, tout) {
    const compte = (etat) => (fin.bilan || []).filter((b) => b.etat === etat).length;
    const proposees = compte("proposee");
    const inchanges = compte("inchange");
    const refusees = (fin.bilan || []).filter((b) => b.etat === "refusee");
    if (!tout) return toast(proposees ? "Mise en page proposée : comparez-la à votre texte, puis acceptez ou refusez." : "Rien à corriger dans ce chapitre.");
    const numero = (id) => this.s.chapitres.findIndex((c) => c.id === id) + 1;
    const morceaux = [
      proposees ? pluriel(proposees, "chapitre a une mise en page proposée", "chapitres ont une mise en page proposée") : "",
      inchanges ? pluriel(inchanges, "chapitre sans rien à corriger", "chapitres sans rien à corriger") : "",
      refusees.length ? `rien de proposé pour ${refusees.map((b) => `le chapitre ${numero(b.chapitre)} (${String(b.message || "").replace(/^rien n'est proposé, /, "")})`).join(", ")}` : "",
      fin.arret ? `la relecture s'est arrêtée en route (${erreurIA({ message: fin.arret })})` : "",
    ].filter(Boolean);
    toast(`Relecture terminée : ${morceaux.join(" ; ") || "rien à relire"}.`, refusees.length || fin.arret ? "erreur" : "info");
  }

  async mettreEnPageDiffere(chapitre) {
    if (!(await this.toutEnregistre())) return;
    try {
      const r = await api.post(`/api/scenarios/${encodeURIComponent(this.s.id)}/mises-en-page/${encodeURIComponent(chapitre)}/differee`, {});
      this.lots = [...this.lots, ...(r.lots || [])];
      const n = (r.lots || []).length;
      const suite = [r.arret ? `la suite n'est pas partie (${erreurIA({ message: r.arret })})` : "", (r.ecartes || []).length ? `${pluriel(r.ecartes.length, "chapitre trop long écarté", "chapitres trop longs écartés")}` : ""].filter(Boolean);
      toast(n ? `${pluriel(n, "relecture demandée", "relectures demandées")} : ${n > 1 ? "les propositions s'afficheront d'elles-mêmes" : "la proposition s'affichera d'elle-même"}, en général dans l'heure${suite.length ? ` ; ${suite.join(" ; ")}` : ""}.`
        : suite.length ? `Aucune relecture demandée : ${suite.join(" ; ")}.` : "Cette relecture différée est déjà demandée.", r.arret ? "erreur" : "info");
      this.afficherSommaire();
      this.afficherApercu();
    } catch (err) {
      toast(`Relecture impossible : ${erreurIA(err)}.`, "erreur");
    }
  }

  voirMiseEnPage(vue) {
    const p = this.propositionMiseEnPage(this.chap);
    if (!p) return;
    this.choixDe(this.chap, p).vue = vue === "resultat" ? "resultat" : "ecart";
    this.afficherApercu();
  }

  choisirPassage(rang, decision) {
    const p = this.propositionMiseEnPage(this.chap);
    if (!p) return;
    const { decisions } = this.choixDe(this.chap, p);
    if (decision === "accepter" || decision === "refuser") decisions.set(rang, decision);
    else decisions.delete(rang);
    this.afficherApercu();
  }

  // Le chapitre et sa proposition, si elle vaut encore pour le texte d'aujourd'hui ; sinon l'aperçu le dit.
  miseEnPageValable(id) {
    const ch = this.s.chapitres.find((c) => c.id === id);
    const p = ch && this.propositionMiseEnPage(id);
    if (!p) return null;
    if (empreinte(ch.texte || "") === p.base) return { ch, p };
    this.afficherApercu();
    toast("Le chapitre a changé depuis la relecture : rien n'est appliqué. Relancez-la.", "erreur");
    return null;
  }

  accepterMiseEnPage(id) {
    const v = this.miseEnPageValable(id);
    if (v) this.integrerMiseEnPage(v.ch, v.p, v.p.texte, "Mise en page acceptée : le chapitre est à vous, retouchez-le à votre guise.");
  }

  async appliquerMiseEnPage(id) {
    let v = this.miseEnPageValable(id);
    if (!v) return;
    const { decisions } = this.choixDe(id, v.p);
    const indecis = this.comparaison(v.ch, v.p).changes.length - decisions.size;
    const acceptes = [...decisions.values()].filter((d) => d === "accepter").length;
    if (indecis && !(await demander({ titre: "Appliquer mes choix", texte: `${pluriel(indecis, "passage n'est pas tranché : il restera tel que vous l'avez écrit", "passages ne sont pas tranchés : ils resteront tels que vous les avez écrits")}, et la proposition sera retirée.`, oui: "Appliquer" }))) return;
    // Le texte a pu bouger pendant la question.
    v = this.miseEnPageValable(id);
    if (!v) return;
    if (!acceptes) {
      this.retirerMiseEnPage(id, v.p);
      return toast("Aucun passage accepté : votre texte n'a pas changé, la proposition est retirée.");
    }
    const texte = appliquer(this.comparaison(v.ch, v.p).morceaux, (rang) => decisions.get(rang) === "accepter");
    this.integrerMiseEnPage(v.ch, v.p, texte, `${pluriel(acceptes, "passage accepté", "passages acceptés")} : le reste du chapitre n'a pas changé.`);
  }

  // Le geste du MJ : son chapitre prend le texte accepté, s'enregistre par la voie de l'éditeur, puis la proposition
  // quitte le scénario. « Annuler » rend le texte d'avant tant qu'il n'a pas été retouché.
  integrerMiseEnPage(ch, p, texte, message) {
    const avant = ch.texte || "";
    const poser = (t) => {
      ch.texte = t;
      ch.texte_modifie = maintenant();
      if (ch.id === this.chap) this.remplacerTexte(ch.texte);
      this.marquer();
      this.afficherSommaire();
      this.afficherApercu();
    };
    this.misesRetirees.set(ch.id, p.date);
    poser(texte);
    this.retirerMiseEnPage(ch.id, p, true);
    const s = this.s;
    toast(message, "info", {
      action: {
        libelle: "Annuler",
        faire: () => {
          if (this.detruit || this.s !== s || ch.texte !== texte) return toast("Le chapitre a changé depuis : son texte d'avant reste dans « Versions précédentes ».");
          poser(avant);
          toast("Votre texte d'avant est revenu. La proposition, elle, est retirée : relancez la relecture au besoin.");
        },
      },
    });
  }

  async refuserMiseEnPage(id) {
    const p = this.propositionMiseEnPage(id);
    if (!p) return;
    if (!(await demander({ titre: "Refuser cette mise en page", texte: "La proposition est retirée ; votre texte ne change pas.", oui: "Refuser", danger: true }))) return;
    this.retirerMiseEnPage(id, p);
    toast("Proposition retirée : votre texte n'a pas changé.");
  }

  // La proposition quitte l'écran tout de suite, et le serveur après l'enregistrement du texte (apresTexte), dans la même
  // file. Si le texte accepté n'a pas pu s'enregistrer, elle reste au serveur : rien n'est perdu.
  retirerMiseEnPage(id, p, apresTexte = false) {
    const s = this.s;
    this.misesRetirees.set(id, p.date);
    this.choixMiseEnPage.delete(id);
    this.ecartsMiseEnPage.delete(id);
    this.afficherSommaire();
    this.afficherApercu();
    this.chaine = this.chaine.then(() => (apresTexte ? this.ecrire() : null)).then(async () => {
      const relacher = () => {
        if (this.misesRetirees.get(id) === p.date) this.misesRetirees.delete(id);
      };
      if (apresTexte && this.etatAffiche === "erreur") return relacher();
      try {
        const srv = await api.del(`/api/scenarios/${encodeURIComponent(s.id)}/mises-en-page/${encodeURIComponent(id)}`);
        if (this.bases[s.id]) this.bases[s.id].mises_en_page = copie(srv.mises_en_page || {});
        if (this.detruit || this.s !== s) return;
        this.reprendreAnnexes(srv);
        relacher();
      } catch (err) {
        relacher();
        if (this.detruit || this.s !== s) return;
        toast(`Proposition non retirée : ${err.message}`, "erreur");
        this.afficherSommaire();
        this.afficherApercu();
      }
    });
  }

  // Le texte qui arrive est rendu au plus une fois par image, dans sa seule boîte : le reste de l'aperçu ne bouge pas.
  majFlux(selecteur, texte) {
    this.fluxEnAttente = { ...(this.fluxEnAttente || {}), [selecteur]: texte };
    if (this.imageFlux) return;
    this.imageFlux = requestAnimationFrame(() => {
      this.imageFlux = 0;
      for (const [sel, t] of Object.entries(this.fluxEnAttente)) {
        const el = this.r?.querySelector(sel);
        if (el) el.innerHTML = rendre(t);
      }
      this.fluxEnAttente = {};
    });
  }

  async effacerRelecture(chapitre) {
    if (!(await demander({ titre: "Effacer cette relecture", texte: "Ses remarques disparaissent ; une nouvelle relecture se demande ensuite.", oui: "Effacer", danger: true }))) return;
    try {
      const srv = await api.del(`/api/scenarios/${encodeURIComponent(this.s.id)}/relectures/${encodeURIComponent(chapitre)}`);
      if (this.bases[this.s.id]) this.bases[this.s.id].relectures = copie(srv.relectures || {});
      this.reprendreAnnexes(srv);
    } catch (err) {
      toast(`Effacement impossible : ${err.message}`, "erreur");
    }
  }

  /* ---- Enregistrement ---- */

  marquer() {
    this.modifie = true;
    this.etat("modifie");
    this.sauver();
  }

  etat(etat) {
    this.etatAffiche = etat;
    afficherTemoin(this.r?.querySelector(".temoin-enregistrement"), etat, { reessai: this.reessai, modifie: this.s?.modifie });
  }

  enregistrer() {
    this.chaine = this.chaine.then(() => this.ecrire());
    return this.chaine;
  }

  async ecrire() {
    if (!this.modifie) return;
    this.modifie = false;
    this.etat("enregistrement");
    try {
      const fusion = await enregistrerAvecVersion(`/api/scenarios/${encodeURIComponent(this.s.id)}`, this.s, this.bases, this.s.id);
      this.reessai.reussite();
      if (!this.modifie) this.etat("ok");
      this.reprendreAnnexes(this.bases[this.s.id]);
      if (fusion && !this.detruit) {
        toast("Ce scénario avait changé sur un autre écran : ses changements et les vôtres sont réunis.");
        if (document.activeElement !== this.zone) this.toutAfficher();
      }
    } catch (err) {
      this.modifie = true;
      this.reessai.echec(err);
      this.etat("erreur");
      this.reessai.signaler(err, "Scénario non enregistré");
    }
  }

  // Les propositions, les relectures et les mises en page proposées ne s'écrivent que côté serveur : on reprend les
  // siennes, en gardant les choix qui partent encore.
  reprendreAnnexes(srv) {
    if (!srv || this.detruit) return;
    const avant = JSON.stringify([this.s.reponses, this.s.relectures, this.s.mises_en_page]);
    this.s.reponses = copie(srv.reponses || []);
    this.s.relectures = copie(srv.relectures || {});
    this.s.mises_en_page = copie(srv.mises_en_page || {});
    for (const r of this.s.reponses) if (this.statutsEnCours.has(r.id)) r.statut = this.statutsEnCours.get(r.id);
    if (JSON.stringify([this.s.reponses, this.s.relectures, this.s.mises_en_page]) !== avant) {
      this.afficherSommaire();
      this.afficherApercu();
    }
  }

  // Retour sur la page (autre écran, propositions déposées entre-temps) : on relit le scénario s'il n'y a rien en attente ici.
  async relire() {
    if (this.detruit || !this.s || this.modifie || this.sauver.enAttente()) return;
    await this.chaine;
    let srv;
    try {
      srv = await api.get(`/api/scenarios/${encodeURIComponent(this.s.id)}`);
    } catch {
      return;
    }
    if (this.detruit || this.modifie || this.sauver.enAttente()) return;
    const lots = await api.get("/api/ia/lots").catch(() => null);
    if (lots && JSON.stringify(lots) !== JSON.stringify(this.lots)) {
      this.lots = lots;
      this.afficherSommaire();
      this.afficherApercu();
    }
    if (srv.modifie === this.s.modifie) return this.reprendreAnnexes(srv);
    const chap = this.chap;
    this.s = srv;
    this.s.chapitres ||= [];
    if (!this.s.chapitres.length) this.s.chapitres.push({ id: nouvelId(), titre: "Premier chapitre", texte: "" });
    this.bases[srv.id] = copie(srv);
    this.chap = this.s.chapitres.some((c) => c.id === chap) ? chap : this.s.chapitres[0].id;
    for (const el of this.r.querySelectorAll("[data-champ]")) el.value = this.s[el.dataset.champ] || (el.dataset.champ === "etat" ? "brouillon" : "");
    ajusterTitre(this.r.querySelector(".scenario-nom"));
    this.toutAfficher();
  }

  /* ---- Bible, impression, corbeille ---- */

  async chercherBible(q) {
    const zone = this.r.querySelector(".resultats-rapides");
    if (q.trim().length < 2) {
      zone.innerHTML = "";
      return;
    }
    this.requeteBible = (this.requeteBible || 0) + 1;
    const n = this.requeteBible;
    let r;
    try {
      r = await api.get(`/api/bible/recherche?q=${encodeURIComponent(q)}&limite=6`);
    } catch (err) {
      zone.innerHTML = `<p class="aide">La bible ne répond pas : ${e(err.message)}.</p>`;
      return;
    }
    if (n !== this.requeteBible || this.detruit) return;
    zone.innerHTML = r.total ? `
      <p class="aide">${pluriel(r.total, "passage", "passages")}, <a href="/#/bible?q=${encodeURIComponent(q)}" target="_blank" rel="noopener">tout voir</a></p>
      <ul>${r.resultats.map((x) => `<li><a href="/#/bible?doc=${encodeURIComponent(x.chemin)}&q=${encodeURIComponent(q)}" target="_blank" rel="noopener">${e(x.titre)}</a><a class="extrait" href="/#/bible?doc=${encodeURIComponent(x.chemin)}&q=${encodeURIComponent(q)}&passage=0" target="_blank" rel="noopener" title="Ouvrir la bible à ce passage">${e(court(x.lignes[0] || "", 180))}</a></li>`).join("")}</ul>`
      : `<p class="aide">Rien dans la série. Champ libre, ou autre graphie ?</p>`;
  }

  imprimer() {
    const s = this.s;
    const consigne = (c) => ({ html: c ? `<span class="consigne-imprimee">[${e(GENRES[c.genre].nom)}${c.indications ? ` : ${e(c.indications)}` : ""}]</span>` : "" });
    const toutes = consignesDuScenario(s);
    // Plusieurs chapitres : un sommaire sous le titre (les chapitres et leurs premiers intertitres), puis un chapitre
    // par page. Un seul : le texte suit le titre.
    const sommaire = s.chapitres.length > 1 ? `
      <nav class="sommaire-imprime">
        <p class="sommaire-imprime-titre">Sommaire</p>
        <ol>${s.chapitres.map((ch) => {
          const titres = intertitres(ch.texte || "").filter((t) => t.titre);
          const haut = Math.min(...titres.map((t) => t.niveau));
          const premiers = titres.filter((t) => t.niveau === haut);
          return `<li>${e(ch.titre || "Sans titre")}${premiers.length ? `<ul>${premiers.map((t) => `<li>${e(t.titre)}</li>`).join("")}</ul>` : ""}</li>`;
        }).join("")}</ol>
      </nav>` : "";
    this.r.querySelector(".impression").innerHTML = `
      <header class="titre-imprime">
        <h1>${e(s.nom || "Sans titre")}</h1>
        ${s.resume ? `<p class="resume">${e(s.resume)}</p>` : ""}
        ${sommaire}
      </header>
      ${s.chapitres.map((ch, i) => {
        const siennes = toutes.filter((c) => c.chapitre === ch.id);
        return `<section class="chapitre-imprime"><h2>${i + 1}. ${e(ch.titre || "Sans titre")}</h2>${rendre(ch.texte || "", { consigne: (k) => consigne(siennes[k]) })}</section>`;
      }).join("")}`;
    window.print();
  }

  // Sans confirmation : le texte en attente part d'abord (il reviendra avec le scénario), puis « Annuler » dix secondes.
  async supprimerScenario() {
    await this.vider();
    this.sauver.annuler();
    this.modifie = false;
    await this.chaine;
    try {
      await api.del(`/api/scenarios/${encodeURIComponent(this.s.id)}`);
      annoncerCorbeille(`« ${this.s.nom || "Sans titre"} » mis à la corbeille.`, "scenarios", this.s.id, { retour: `#/scenarios/${this.s.id}` });
      location.hash = "#/scenarios";
    } catch (err) {
      toast(`Suppression impossible : ${err.message}`, "erreur");
    }
  }
}
