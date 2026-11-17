// Les touches de l'atelier, qu'on voit et qu'on retrouve : la carte des raccourcis sur parchemin (touche « ? » ou lien
// « Touches » à côté du nom de l'atelier), une carte par écran (l'atelier, la carte, le plan), les touches T (Tableau)
// et I (idée) à côté de N, R et H, la ligne de rappel au pied du Tableau, et Échap partout pareil (echap.js). Rien n'y
// est inventé : chaque touche citée est lue par le code (tests/test_touches.py le vérifie).

import { OUTILS as OUTILS_CARTE } from "../carte/outils.js";
import { champDeSaisie, coucheEchap, dialogueOuvert, installerEchap, surUnEditeur, tableauVientDEtreTouche, toucherLeTableau } from "./echap.js";
import { ajouterLienAtelier } from "./liens-atelier.js";
import { OUTILS as OUTILS_PLAN } from "../plan/editeur.js";

const e = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Sur un Mac, ⌘ ; ailleurs, Ctrl (le code accepte les deux partout).
const MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || "");
const CMD = MAC ? "⌘" : "Ctrl";

// Une ligne : [touches, effet]. Les touches : une ou plusieurs, côte à côte (l'une ou l'autre, ou l'une après l'autre) ;
// « + » relie celles d'un même geste (Maj+H : les deux ensemble).
const l = (touches, effet) => [touches.split(" ").map((geste) => (geste === "+" ? ["+"] : geste.split("+"))), effet];

// Ce que chaque écran lit au clavier, par groupes. Les outils des éditeurs viennent de leurs propres listes.
export const CARTES = {
  atelier: {
    titre: "L'atelier",
    chapo: "Hors d'un champ de saisie, sur toutes les pages, cartes et plans compris.",
    groupes: [
      { titre: "À la table", lignes: [
        l("N", "Noter au journal de la séance"),
        l("R", "Chercher ou noter une règle maison (sur une carte, R reste l'outil Rivière)"),
        l("H", "Avancer l'horloge de la menace"),
        l("Maj+H", "La reculer"),
        l("T", "Ouvrir ou fermer le Tableau"),
        l("I", "Noter une idée"),
        l("?", "Cette carte des touches"),
      ] },
      { titre: "Chercher", lignes: [
        l(`/ ${CMD}+K`, "Chercher une fiche, une idée, un passage d'un scénario ou de la bible"),
        l(`${CMD}+K`, "Chercher, même depuis un champ de saisie"),
        l("↑ ↓ Entrée", "Choisir ce qui est trouvé et l'ouvrir"),
        l(`${CMD}+F`, "Dans un scénario : chercher dans tous ses chapitres (un second : celui du navigateur)"),
      ] },
      { titre: "Échap", lignes: [
        l("Échap", "Dans un champ : rendre la main à la page, les lettres redeviennent des touches"),
        l("Échap", "Sinon : fermer la fenêtre, le menu ou le Tableau, du premier coup"),
      ] },
      { titre: "En combat", lignes: [
        l("Entrée", "Main suivante, sur la page du combat"),
        l("-4 Entrée", "Santé : « -4 » retire, « +3 » rend, « =7 » fixe"),
        l("-2 Entrée", "Psy : « -2 » paie un don, « +1 » rend"),
        l("Entrée", "Sur une case vide : main suivante, aussi dans le Tableau"),
      ] },
      { titre: "En écrivant", lignes: [
        l("@", "Dans un scénario : lier une fiche (PNJ, lieu, plan, rencontre, carte)"),
        l("↑ ↓ Entrée", "Choisir la fiche à lier"),
        l(`${CMD}+S`, "Enregistrer le scénario tout de suite"),
        l(`${CMD}+Entrée`, "Noter une règle, une idée, une consigne"),
      ] },
      { titre: "Dans la barre des onglets", lignes: [
        l("← →", "D'un onglet à l'autre, d'une famille à l'autre"),
        l("↓", "D'une famille à ses onglets"),
        l("↑", "Des onglets à leur famille"),
      ] },
    ],
  },
  carte: {
    titre: "La carte",
    chapo: "Dans l'éditeur de carte, hors d'un champ du panneau (Échap y rend la main).",
    outils: OUTILS_CARTE,
    groupes: [
      { titre: "La vue", lignes: [
        l("Espace+glisser", "Déplacer la vue (clic droit et glisser aussi)"),
        l("+ −", "Zoomer, dézoomer"),
        l("0", "Toute la carte"),
      ] },
      { titre: "Pinceaux et tracés", lignes: [
        l("[ ]", "Taille du pinceau (terrain, terres connues)"),
        l("Maj+peindre", "Terres connues : l'inverse (Alt aussi)"),
        l("Entrée", "Finir le tracé (double-clic aussi)"),
        l("⌫", "Retirer le dernier point du tracé"),
      ] },
      { titre: "La sélection", lignes: [
        l("Suppr", "Supprimer ce qui est choisi (⌫ aussi) ; plusieurs pions : après confirmation"),
        l("Échap", "Abandonner le tracé, puis lâcher la sélection"),
        l(`${CMD}+Z`, "Annuler"),
        l(`${CMD}+Y`, `Rétablir (${CMD} + Maj + Z aussi)`),
      ] },
    ],
  },
  plan: {
    titre: "Le plan",
    chapo: "Dans l'éditeur de plan, hors d'un champ du panneau (Échap y rend la main).",
    outils: OUTILS_PLAN,
    groupes: [
      { titre: "En partie", lignes: [
        l("↑ ↓ ← →", "Déplacer d'une case le pion choisi, ou tous les pions choisis"),
        l("Maj+clic", `Ajouter un pion à la sélection, ou l'en retirer (Ctrl ou ${CMD} + clic aussi)`),
        l("Maj+glisser", "Sur le plan : un rectangle qui choisit les pions ; sur un héros : tous les héros visibles le suivent"),
        l("R", "Tourner le meuble choisi ou à poser (sans meuble, R ouvre les règles)"),
        l("Maj+R", "Le tourner dans l'autre sens"),
      ] },
      { titre: "Pinceaux", lignes: [
        l("Alt+glisser", "Révéler, brume, feu, pièce : l'inverse (cacher, effacer, éteindre)"),
        l("Maj+glisser", "Pièce : l'agrandir"),
      ] },
      { titre: "La vue et la sélection", lignes: [
        l("Espace+glisser", "Déplacer la vue (clic droit et glisser aussi)"),
        l("0", "Tout le plan"),
        l("Suppr", "Supprimer ce qui est choisi (⌫ aussi) ; plusieurs pions : après confirmation"),
        l("Échap", "Tout lâcher"),
        l(`${CMD}+Z`, "Annuler"),
        l(`${CMD}+Y`, `Rétablir (${CMD} + Maj + Z aussi)`),
      ] },
    ],
  },
};

// Une touche dans sa case ; un geste de la souris (glisser, peindre) en toutes lettres.
const htmlTouche = (t) => (/^[a-zé]{3,}$/.test(t) ? `<i class="geste">${e(t)}</i>` : `<kbd>${e(t)}</kbd>`);
const htmlGeste = (geste) => geste.map(htmlTouche).join('<span class="plus" aria-hidden="true">+</span>');
const htmlTouches = (gestes) => gestes.map(htmlGeste).join(" ");

function htmlLigne([gestes, effet]) {
  return `<li><span class="touches">${htmlTouches(gestes)}</span><span class="effet">${e(effet)}</span></li>`;
}

function htmlCarte(cle) {
  const c = CARTES[cle];
  const outils = c.outils ? `
      <section class="ct-groupe ct-outils">
        <h3>Les outils</h3>
        <ul>${c.outils.map(([, nom, lettre]) => htmlLigne([[[lettre]], nom])).join("")}</ul>
      </section>` : "";
  return `
    <div class="ct-page" data-carte="${cle}" role="tabpanel" aria-labelledby="ct-onglet-${cle}">
      <p class="ct-chapo">${e(c.chapo)}</p>
      <div class="ct-groupes">${outils}${c.groupes.map((g) => `
        <section class="ct-groupe">
          <h3>${e(g.titre)}</h3>
          <ul>${g.lignes.map(htmlLigne).join("")}</ul>
        </section>`).join("")}
      </div>
    </div>`;
}

let dialogue = null;

function ecranCourant() {
  if (document.querySelector("#page .editeur-plan")) return "plan";
  if (document.querySelector("#page .editeur")) return "carte";
  return "atelier";
}

function montrer(cle) {
  for (const b of dialogue.querySelectorAll("[data-ct]")) b.setAttribute("aria-selected", String(b.dataset.ct === cle));
  for (const p of dialogue.querySelectorAll(".ct-page")) p.hidden = p.dataset.carte !== cle;
}

function creerDialogue() {
  dialogue = document.createElement("dialog");
  dialogue.className = "dialogue carte-touches";
  dialogue.setAttribute("aria-labelledby", "carte-touches-titre");
  dialogue.innerHTML = `
    <form method="dialog">
      <header class="ct-tete">
        <p class="kicker">Raccourcis</p>
        <h2 id="carte-touches-titre">Les touches</h2>
        <div class="ct-onglets" role="tablist" aria-label="Écran">
          ${Object.entries(CARTES).map(([cle, c]) => `<button type="button" role="tab" id="ct-onglet-${cle}" data-ct="${cle}" aria-selected="false">${e(c.titre)}</button>`).join("")}
        </div>
      </header>
      ${Object.keys(CARTES).map(htmlCarte).join("")}
      <footer class="ct-pied">
        <span><kbd>?</kbd> ou <kbd>Échap</kbd> pour fermer</span>
        <button class="principal" value="fermer">Fermer</button>
      </footer>
    </form>`;
  document.body.append(dialogue);
  dialogue.querySelector(".ct-onglets").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-ct]");
    if (b) montrer(b.dataset.ct);
  });
  dialogue.querySelector(".ct-onglets").addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
    const boutons = [...dialogue.querySelectorAll("[data-ct]")];
    const i = boutons.findIndex((b) => b.getAttribute("aria-selected") === "true");
    const suivant = boutons[(i + (ev.key === "ArrowRight" ? 1 : boutons.length - 1)) % boutons.length];
    ev.preventDefault();
    montrer(suivant.dataset.ct);
    suivant.focus();
  });
}

// La carte de l'écran ouvert d'abord ; les deux autres d'un clic.
export function ouvrirCarteDesTouches(cle = ecranCourant()) {
  if (!dialogue) creerDialogue();
  if (dialogue.open) return;
  montrer(cle);
  dialogue.showModal();
  dialogue.querySelector(`[data-ct="${cle}"]`).focus();
}

// La ligne du pied du Tableau : les touches de la soirée, et le chemin vers toutes les autres.
function poserPiedTableau() {
  const pied = document.querySelector(".tableau-mj .tableau-pied");
  if (!pied) return;
  pied.innerHTML = `
    <p class="rappel-touches"><kbd>N</kbd> journal · <kbd>R</kbd> règles · <kbd>H</kbd> horloge · <kbd>Entrée</kbd> main suivante</p>
    <button type="button" class="toutes-les-touches" title="Toutes les touches de l'atelier (touche ?)">Toutes les touches</button>`;
  pied.querySelector(".toutes-les-touches").addEventListener("click", () => ouvrirCarteDesTouches());
  pied.hidden = false;
}

// « ? », T et I hors d'un champ de saisie et hors d'un dialogue ouvert ; « ? » referme aussi sa carte. Les deux éditeurs
// n'utilisent aucune de ces touches.
function touche(ev) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing || ev.repeat) return;
  const lettre = (ev.key || "").toLowerCase();
  if (ev.key === "?" && dialogue?.open) {
    ev.preventDefault();
    dialogue.close();
    return;
  }
  if (ev.key !== "?" && lettre !== "t" && lettre !== "i") return;
  const cible = ev.target instanceof Element ? ev.target : null;
  if (champDeSaisie(cible) || cible?.closest("input, textarea, select, dialog") || dialogueOuvert()) return;
  ev.preventDefault();
  ev.stopPropagation();
  if (ev.key === "?") return ouvrirCarteDesTouches();
  if (lettre === "t") toucherLeTableau();
  document.querySelector(lettre === "t" ? ".entete .ouvrir-tableau" : ".entete .noter-idee")?.click();
}

const cliquer = (selecteur) => () => document.querySelector(selecteur)?.click();

// barre : la barre des onglets (onglets.js), dont une famille montrée d'un clic se referme comme un menu.
export function installerTouches({ barre = null } = {}) {
  installerEchap();
  // Ce que ferme Échap, dans cet ordre : les menus, puis le Tableau.
  if (barre) coucheEchap({ nom: "familles", ouvert: () => barre.ouvert(), fermer: (auClavier) => barre.fermer(auClavier) });
  coucheEchap({
    nom: "exporter",
    ouvert: () => !!document.querySelector(".menu-exporter .menu:not([hidden])"),
    fermer: () => { for (const m of document.querySelectorAll(".menu-exporter .menu:not([hidden])")) m.hidden = true; },
  });
  coucheEchap({
    nom: "musique",
    ouvert: () => !!document.querySelector(".musique.ouvert"),
    fermer: (auClavier) => {
      const b = document.querySelector(".entete .bouton-musique");
      b?.click();
      if (auClavier) b?.focus();
    },
  });
  coucheEchap({
    nom: "sommaire",
    ouvert: () => {
      const b = document.querySelector('#page .scenario[data-sommaire="ouvert"] .ouvrir-sommaire');
      return !!b && getComputedStyle(b).display !== "none";
    },
    fermer: cliquer("#page .scenario .ouvrir-sommaire"),
  });
  coucheEchap({
    nom: "tableau",
    ouvert: () => document.querySelector(".tableau-mj")?.hidden === false,
    // Sur une carte ou un plan, Échap lâche d'abord la sélection : le Tableau ne s'y ferme que si on vient de le toucher.
    garde: () => !surUnEditeur() || tableauVientDEtreTouche(),
    fermer: cliquer(".entete .ouvrir-tableau"),
  });
  // Le menu Exporter des éditeurs se ferme aussi au clic ailleurs, comme les autres menus.
  document.addEventListener("pointerdown", (ev) => {
    if (ev.target instanceof Element && ev.target.closest(".menu-exporter")) return;
    for (const m of document.querySelectorAll(".menu-exporter .menu:not([hidden])")) m.hidden = true;
  }, true);
  document.addEventListener("keydown", touche);
  ajouterLienAtelier({ libelle: "Touches", titre: "Toutes les touches de l'atelier (touche ?)", surClic: () => ouvrirCarteDesTouches() })
    ?.classList.add("lien-touches");
  poserPiedTableau();
}
