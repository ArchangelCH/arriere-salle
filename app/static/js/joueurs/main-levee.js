// « Je veux agir » : pendant la partie, autour de la table ou en visio, le joueur lève la main depuis son téléphone. Un
// bouton flottant, en bas à droite, sous le pouce. Touché, la main se lève (le MJ la voit dans la seconde, dans son
// Tableau et sur sa télécommande) ; touché de nouveau, elle se baisse. Le MJ donne la parole : « À vous ! » paraît
// quelques secondes ; il dit « Plus tard » : la main se baisse. Personne ne répond : elle retombe seule au bout de cinq
// minutes. L'état arrive par le flux poussé (flux.js, sujet « demandes ») ; la page relit GET /api/main, qui ne parle
// que de la main de ce joueur. Jamais « carnet requis » : on joue même carnet fermé. Le coin en pause fige la main.
//
// Pour l'inclure dans une page du coin où l'on joue (le carnet, « La table ») :
//   import { monter as monterMainLevee } from "./main-levee.js";
//   monterMainLevee();
// Le module pose lui-même sa feuille de style et son bouton ; un second appel rend le même bouton.

import { ecouterFlux } from "./flux.js";

const FEUILLE = new URL("../../css/main-levee.css", import.meta.url).pathname;
const A_VOUS = 6000; // « À vous ! » reste à l'écran six secondes
const MOT = 4500; // les autres mots, un peu moins
const DITES = "main-levee.dites"; // les mains dont la réponse a déjà été dite sur cet appareil
const RETOUR_APRES_SAISIE = 400; // millisecondes : le bouton revient après qu'on a quitté un champ (voir monter)

let monte = null;

async function demander(methode) {
  let r;
  try {
    r = await fetch("/api/main", { method: methode, headers: methode === "GET" ? {} : { "Content-Type": "application/json" },
      body: methode === "GET" ? undefined : "{}" });
  } catch {
    throw Object.assign(new Error("Pas de réseau : réessayez dans un instant."), { status: 0 });
  }
  if (!r.ok) {
    let message = `${r.status}`;
    try {
      message = (await r.json()).detail || message;
    } catch {
      // réponse sans JSON
    }
    throw Object.assign(new Error(message), { status: r.status });
  }
  return r.json();
}

function lireDites() {
  try {
    return JSON.parse(sessionStorage.getItem(DITES) || "[]").filter((x) => typeof x === "string").slice(-20);
  } catch {
    return [];
  }
}

function garderDites(liste) {
  try {
    sessionStorage.setItem(DITES, JSON.stringify(liste.slice(-20)));
  } catch {
    // navigation privée : la réponse pourrait se redire une fois, rien de plus
  }
}

function poserFeuille() {
  if (document.querySelector(`link[href="${FEUILLE}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = FEUILLE;
  document.head.append(l);
}

export function monter({ racine = document.body } = {}) {
  if (monte) return monte;
  poserFeuille();
  const bloc = document.createElement("div");
  bloc.className = "main-levee";
  bloc.dataset.etat = "repos";
  bloc.hidden = true;
  bloc.innerHTML = `
    <p class="dit-main-levee" role="status" aria-live="polite" hidden></p>
    <button type="button" class="bouton-main-levee" aria-pressed="false">
      <span class="losange-main" aria-hidden="true"></span>
      <span class="mots"><span class="mot">Je veux agir</span><small class="sous" hidden></small></span>
    </button>`;
  racine.append(bloc);
  document.body.classList.add("avec-main-levee");
  const bouton = bloc.querySelector("button");
  const mot = bloc.querySelector(".mot");
  const sous = bloc.querySelector(".sous");
  const dit = bloc.querySelector(".dit-main-levee");
  let etat = null; // la dernière réponse de /api/main
  let occupe = false;
  let lecture = 0;
  let retombe = 0;
  let efface = 0;
  let relance = 0;
  const dites = lireDites();

  // Pendant qu'on écrit, main-levee.css efface le bouton (un champ a le focus). Le champ quitté, il ne revient qu'un peu
  // après, et jamais tant qu'un doigt ou la souris reste enfoncé : le geste qui quitte le champ pour toucher « Envoyer »,
  // « Proposer au MJ »… posé juste dessous en bas à droite, ne doit pas se relâcher sur lui (le clic serait perdu).
  const champ = (el) => el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
    || (el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit"].includes(el.type));
  let appui = false;
  let retour = 0;
  const revenir = () => {
    clearTimeout(retour);
    retour = setTimeout(() => {
      if (!appui) bloc.classList.remove("apres-saisie");
    }, RETOUR_APRES_SAISIE);
  };
  document.addEventListener("focusout", (ev) => {
    if (!champ(ev.target)) return;
    bloc.classList.add("apres-saisie");
    revenir();
  }, true);
  document.addEventListener("pointerdown", () => { appui = true; }, true);
  const lacher = () => {
    appui = false;
    if (bloc.classList.contains("apres-saisie")) revenir();
  };
  document.addEventListener("pointerup", lacher, true);
  document.addEventListener("pointercancel", lacher, true);

  const dire = (texte, genre, duree = MOT) => {
    clearTimeout(efface);
    dit.textContent = texte;
    dit.dataset.genre = genre;
    dit.hidden = !texte;
    if (texte) efface = setTimeout(() => {
      dit.hidden = true;
      dit.textContent = "";
      if (bloc.dataset.etat === "rendue") dessiner();
    }, duree);
  };

  const dessiner = () => {
    const e = etat?.etat || "repos";
    const montreAVous = e === "rendue" && !dit.hidden && dit.dataset.genre === "rendue";
    const vue = e === "levee" ? "levee" : montreAVous ? "rendue" : "repos";
    bloc.dataset.etat = vue;
    bloc.dataset.pause = etat?.pause ? "oui" : "non";
    bouton.setAttribute("aria-pressed", String(vue === "levee"));
    bouton.disabled = Boolean(etat?.pause) && vue !== "levee";
    mot.textContent = vue === "levee" ? "Main levée" : vue === "rendue" ? "À vous !" : "Je veux agir";
    const ligne = etat?.pause ? "Coin en pause" : vue === "levee" ? "Toucher pour la baisser" : "";
    sous.textContent = ligne;
    sous.hidden = !ligne;
    bouton.setAttribute("aria-label", vue === "levee" ? "Main levée : toucher pour la baisser" : vue === "rendue" ? "À vous : le MJ vous donne la parole" : "Je veux agir : lever la main");
  };

  // Une réponse du MJ, ou la main retombée, se dit une seule fois par main sur cet appareil.
  const recu = (r) => {
    etat = r;
    clearTimeout(retombe);
    if (r.etat === "levee") retombe = setTimeout(relire, (Math.max(0, Number(r.reste) || 0) + 0.6) * 1000);
    const deja = r.id && dites.includes(`${r.id}:${r.etat}`);
    if (!deja && r.id && ["rendue", "plus-tard", "retombee"].includes(r.etat)) {
      dites.push(`${r.id}:${r.etat}`);
      garderDites(dites);
      if (r.etat === "rendue") {
        dire("À vous ! Le MJ vous donne la parole.", "rendue", A_VOUS);
        // Android seulement (l'iPhone n'en a pas), et après un premier toucher : sinon Chrome le refuse en le disant.
        if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.([70, 50, 70]);
      } else if (r.etat === "plus-tard") dire("Plus tard : le MJ a baissé votre main.", "plus-tard");
      else dire("Personne n'a répondu : votre main est retombée.", "retombee");
    }
    dessiner();
  };

  async function relire() {
    const n = ++lecture;
    try {
      const r = await demander("GET");
      if (n !== lecture || occupe) return;
      bloc.hidden = false;
      recu(r);
    } catch (err) {
      // Plus connecté : le bouton s'efface, la page dira elle-même de se reconnecter.
      if (err.status === 401) bloc.hidden = true;
    }
  }

  // Le flux peut annoncer plusieurs changements d'affilée : une seule relecture.
  const bientot = () => {
    clearTimeout(relance);
    relance = setTimeout(relire, 120);
  };

  bouton.addEventListener("click", async () => {
    if (occupe) return;
    const lever = bloc.dataset.etat !== "levee";
    occupe = true;
    lecture += 1;
    bouton.setAttribute("aria-busy", "true");
    // Tout de suite à l'écran : le serveur confirme dans l'instant, ou la page revient en arrière.
    const avant = etat;
    etat = { ...(etat || {}), etat: lever ? "levee" : "repos", reste: etat?.duree || 300 };
    if (dit.dataset.genre === "rendue") dire("", "");
    dessiner();
    try {
      const r = await demander(lever ? "POST" : "DELETE");
      occupe = false;
      recu(r);
    } catch (err) {
      occupe = false;
      etat = avant;
      dessiner();
      dire(err.status === 423 ? "Le coin est en pause : votre MJ le rouvrira." : err.message, "erreur");
      relire();
    } finally {
      occupe = false;
      bouton.removeAttribute("aria-busy");
    }
  });

  ecouterFlux("demandes", bientot);
  ecouterFlux("pause", bientot);
  relire();
  monte = { element: bloc, relire };
  return monte;
}
