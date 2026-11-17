// Le dialogue maison, au parchemin, à la place des fenêtres grises du navigateur (confirm, prompt) : celles-ci sortent
// de l'ambiance et se valident par Entrée sans être lues. Il reste pour ce qui ne se rattrape pas ; ce qui se rattrape
// passe plutôt par un « Annuler » dans le message qui suit. Échap le ferme du premier coup (echap.js), comme « non ».

import { echapper as e, toast } from "../api.js";

// Le temps de lire : une Entrée restée appuyée, ou répétée, ne valide pas une question qui vient de s'ouvrir.
const LECTURE = 350;
let rang = 0;

// À poser à chaque ouverture de tout dialogue qui donne la main à un bouton (la TV noire, le carton d'un PNJ, les
// repos) : l'Entrée qui a ouvert la question, restée appuyée ou répétée, ne choisit pas à la place du MJ.
export function garderLaLecture(d) {
  d.dataset.ouvertLe = String(performance.now());
  if (d.dataset.lecture) return;
  d.dataset.lecture = "oui";
  d.addEventListener("keydown", (ev) => {
    if ((ev.key === "Enter" || ev.key === " ") && (ev.repeat || performance.now() - (+d.dataset.ouvertLe || 0) < LECTURE)) ev.preventDefault();
  });
}

// Pose le dialogue, donne la main au bouton voulu et rend la promesse de sa réponse (la valeur du bouton, "" sinon).
function poser(d, focus) {
  const id = `dialogue-${++rang}`;
  d.setAttribute("aria-labelledby", `${id}-titre`);
  d.querySelector("h2")?.setAttribute("id", `${id}-titre`);
  document.body.append(d);
  garderLaLecture(d);
  return new Promise((fini) => {
    d.addEventListener("close", () => {
      const reponse = d.returnValue;
      d.remove();
      fini(reponse);
    }, { once: true });
    d.returnValue = "";
    d.showModal();
    d.querySelector(focus)?.focus();
  });
}

const paragraphes = (texte) => [].concat(texte || []).filter(Boolean).map((t) => `<p>${e(t)}</p>`).join("");

// demander({ titre, texte, aide, oui, non, danger }) : vrai si le MJ choisit « oui » ; « non », Échap ou la fermeture
// rendent faux. texte : une phrase ou une liste de paragraphes. danger : le geste ne se rattrape pas, la main est d'abord
// sur « non », le bouton sûr ; sinon elle est sur « oui ».
export function demander({ titre = "", texte = "", aide = "", oui = "Continuer", non = "Annuler", danger = false } = {}) {
  const d = document.createElement("dialog");
  d.className = `dialogue question${danger ? " danger" : ""}`;
  d.innerHTML = `
    <form method="dialog">
      ${titre ? `<h2>${e(titre)}</h2>` : ""}
      ${paragraphes(texte)}
      ${aide ? `<p class="aide">${e(aide)}</p>` : ""}
      <div class="actions">
        <button value="non" formnovalidate>${e(non)}</button>
        <button value="oui" class="principal">${e(oui)}</button>
      </div>
    </form>`;
  return poser(d, danger ? 'button[value="non"]' : 'button[value="oui"]').then((r) => r === "oui");
}

// À la place de prompt("Copiez…") quand le presse-papiers refuse (l'atelier ouvert sans https, sur le réseau de la
// maison) : le texte entier, déjà sélectionné, et « Copier », qui passe par la sélection.
export function aCopier({ titre = "Copier", texte = "", valeur = "", copie = "Copié." } = {}) {
  const d = document.createElement("dialog");
  d.className = "dialogue question a-copier";
  d.innerHTML = `
    <form method="dialog">
      <h2>${e(titre)}</h2>
      ${paragraphes(texte)}
      <textarea readonly rows="${Math.min(10, Math.max(3, Math.ceil(String(valeur).length / 60)))}" aria-label="${e(titre)}">${e(valeur)}</textarea>
      <div class="actions">
        <button value="non" formnovalidate>Fermer</button>
        <button type="button" class="principal" data-copier>Copier</button>
      </div>
    </form>`;
  const zone = d.querySelector("textarea");
  d.querySelector("[data-copier]").addEventListener("click", () => {
    zone.focus();
    zone.select();
    let fait = false;
    try {
      fait = document.execCommand("copy");
    } catch {
      fait = false;
    }
    if (!fait) return toast("Le navigateur refuse de copier : le texte est sélectionné, Cmd+C (Ctrl+C) le copie.", "erreur");
    d.close("copie");
    toast(copie);
  });
  const promesse = poser(d, "[data-copier]");
  zone.select();
  return promesse.then(() => undefined);
}

// Ce qui ne se montre qu'une seule fois (le mot de passe provisoire d'un joueur, provisoires.py) : en grand, pour le
// dicter, et la phrase à transmettre, à copier. « Copier » ne ferme pas : le MJ peut encore le lire à voix haute. Une
// fois fermé, rien ne le remontre ; le MJ en tire un autre. enGrand : [[libellé, valeur], …].
export function montrerUneFois({ titre = "", texte = "", enGrand = [], valeur = "", aide = "", fermer = "Fermer" } = {}) {
  const d = document.createElement("dialog");
  d.className = "dialogue question une-fois";
  d.innerHTML = `
    <form method="dialog">
      <h2>${e(titre)}</h2>
      ${paragraphes(texte)}
      ${enGrand.length ? `<dl class="a-dicter" translate="no">${enGrand.map(([l, v]) => `<dt>${e(l)}</dt><dd>${e(v)}</dd>`).join("")}</dl>` : ""}
      <textarea readonly rows="3" aria-label="${e(titre)}">${e(valeur)}</textarea>
      <p class="statut-copie" role="status"></p>
      ${aide ? `<p class="aide">${e(aide)}</p>` : ""}
      <div class="actions">
        <button type="button" data-copier>Copier</button>
        <button value="fini" class="principal">${e(fermer)}</button>
      </div>
    </form>`;
  const zone = d.querySelector("textarea");
  const statut = d.querySelector(".statut-copie");
  d.querySelector("[data-copier]").addEventListener("click", async () => {
    let fait = false;
    // Le presse-papiers n'existe qu'en https (l'atelier en ligne) ; sur le réseau de la maison, la copie passe par la sélection.
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(zone.value);
        fait = true;
      }
    } catch {
      fait = false;
    }
    if (!fait) {
      zone.focus();
      zone.select();
      // Safari de l'iPhone et de l'iPad ne sélectionne pas un texte en lecture seule par select() seul.
      zone.setSelectionRange(0, zone.value.length);
      try {
        fait = document.execCommand("copy");
      } catch {
        fait = false;
      }
    }
    statut.textContent = fait ? "Copié : collez-le dans votre message." : "Le navigateur refuse de copier : le texte est sélectionné, Cmd+C (Ctrl+C) le copie.";
  });
  const promesse = poser(d, "[data-copier]");
  // Sur une ligne, à dicter d'un trait : coupé au tiret (« gant- / 32 » sur un téléphone de 320 px), le MJ croyait à deux
  // morceaux. La valeur rétrécit jusqu'à tenir ; trop longue même à 15 px, elle passe à la ligne.
  const ajuster = () => {
    for (const dd of d.querySelectorAll(".a-dicter dd")) {
      dd.classList.remove("a-la-ligne");
      dd.style.fontSize = "";
      let px = parseFloat(getComputedStyle(dd).fontSize) || 24;
      while (dd.scrollWidth > dd.clientWidth + 1 && px > 15) {
        px -= 1;
        dd.style.fontSize = `${px}px`;
      }
      if (dd.scrollWidth > dd.clientWidth + 1) dd.classList.add("a-la-ligne");
    }
  };
  ajuster();
  document.fonts?.ready.then(() => d.isConnected && ajuster());
  return promesse.then(() => undefined);
}
