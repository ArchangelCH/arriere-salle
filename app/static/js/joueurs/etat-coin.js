// « Mon héros » sur la page Table du coin : pendant la partie, autour de la table comme en visio, le joueur règle
// lui-même la Santé, la Psy et la posture de son héros. Une barre sous l'en-tête, au-dessus du plan : deux compteurs (− et +) et les trois
// postures. La page n'envoie qu'un écart (« Santé −3 ») ou une posture ; l'atelier l'applique aussitôt, en combat (dans le
// combat du MJ) comme hors combat, borne le résultat et le renvoie. Le MJ le voit dans son Tableau et garde la main.
//
// Les touchers rapprochés partent en un seul envoi (trois fois « − » : un écart de −3). En attendant la réponse, la barre
// montre le résultat attendu, borné comme le fera l'atelier (la Santé payée faute de Psy ne se soigne pas, la mort en
// bas, la Psy entre 0 et son maximum). Tout arrive par le flux poussé (flux.js) ; la page relit GET /api/etat-heros, qui
// ne parle que de ce joueur. Table du coin fermée, ou héros absent : la barre n'est pas là.
//
// Pour l'inclure dans la page Table :
//   import { monter as monterEtat } from "./etat-coin.js";
//   monterEtat(document.getElementById("page"));

import { echapper as e } from "../api.js";
import { ecouterFlux } from "./flux.js";

const FEUILLE = new URL("../../css/etat-coin.css", import.meta.url).pathname;
const REGROUPER = 650; // millisecondes sans toucher avant d'envoyer l'écart
const GRACE = 1500; // après un envoi, la valeur attendue reste affichée le temps que la fiche se republie
const CHAMPS = [["sante", "Santé"], ["psy", "Psy"]];
const JETONS = { avantage: "Avantage", desavantage: "Désavantage" };
const TIROIRS = [
  ["sac", "Sac", '<path d="M7 9V7a5 5 0 0 1 10 0v2"/><path d="M4.5 9h15l-1.3 10.2a2 2 0 0 1-2 1.8H7.8a2 2 0 0 1-2-1.8z"/>'],
  ["notes", "Notes", '<path d="M14.5 4.5l5 5L9 20H4v-5z"/><path d="M12.5 6.5l5 5"/>'],
];

let monte = null;

async function demander(methode, corps) {
  let r;
  try {
    r = await fetch("/api/etat-heros", { method: methode, headers: methode === "GET" ? {} : { "Content-Type": "application/json" },
      body: methode === "GET" ? undefined : JSON.stringify(corps) });
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

// Les bornes de l'atelier (etat_joueur.calculer), pour montrer tout de suite ce qu'il rendra.
export function calculer(v, champ, delta) {
  if (champ === "psy") return { ...v, psy: Math.max(0, Math.min(v.psy_max, v.psy + delta)) };
  const voulu = v.sante + delta;
  const plancher = -Math.max(v.sante_max, 10);
  const plafond = v.sante_max - v.sante_don;
  return { ...v, sante: delta < 0 ? Math.max(plancher, voulu) : Math.min(voulu, Math.max(v.sante, plafond)) };
}

export function monter(page) {
  if (monte || !page) return monte;
  if (!document.querySelector(`link[href="${FEUILLE}"]`)) {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = FEUILLE;
    document.head.append(l);
  }
  const barre = document.createElement("section");
  barre.className = "etat-coin";
  barre.hidden = true;
  barre.setAttribute("aria-label", "Mon héros : Santé, Psy et posture");
  // En tête de la page, avant le plan : la barre reste là quand la TV montre autre chose qu'un plan (l'accueil, une fiche).
  page.prepend(barre);

  let etat = null; // la dernière réponse de GET /api/etat-heros
  let attendu = null; // { vitalite, posture } : ce que la barre montre en attendant l'atelier
  const ecarts = { sante: 0, psy: 0 }; // les touchers pas encore envoyés
  let minuterie = 0;
  let grace = 0;
  let enGrace = false;
  let envois = 0;
  let erreur = "";
  let finErreur = 0;
  let lecture = 0;
  let relance = 0;

  const heros = () => etat?.heros || null;
  const enAttente = () => ecarts.sante !== 0 || ecarts.psy !== 0 || envois > 0 || enGrace || (etat?.en_route || 0) > 0;
  const montre = () => (attendu && enAttente() ? attendu : heros());

  function dessiner() {
    const h = heros();
    const visible = Boolean(etat?.ouvert && h);
    if (barre.hidden === visible) {
      barre.hidden = !visible;
      // Le plan change de hauteur : il se remesure.
      window.dispatchEvent(new Event("resize"));
    }
    if (!visible) return;
    const m = montre();
    const v = m.vitalite;
    const pause = Boolean(etat.pause);
    const jauges = CHAMPS.map(([champ, nom]) => {
      const valeur = v[champ];
      const maximum = v[`${champ}_max`];
      // Un bouton qui ne changerait rien (au maximum, à zéro, à la mort, ou la Santé payée en dons) est éteint.
      const bas = calculer(v, champ, -1)[champ] === valeur;
      const haut = calculer(v, champ, 1)[champ] === valeur;
      const alerte = champ === "sante" && valeur <= 0 ? ' data-alerte="oui"' : "";
      return `<div class="jauge-etat" data-champ="${champ}"${alerte} role="group" aria-label="${nom}">
        <span class="nom-etat">${nom}</span>
        <button type="button" data-delta="-1" aria-label="${nom} : un point de moins"${pause || bas ? " disabled" : ""}>−</button>
        <output aria-live="polite"><b>${e(valeur)}</b><small>/${e(maximum)}</small></output>
        <button type="button" data-delta="1" aria-label="${nom} : un point de plus"${pause || haut ? " disabled" : ""}>+</button>
      </div>`;
    }).join("");
    const postures = Object.entries(etat.postures || {}).map(([cle, nom]) => `<button type="button" data-posture="${e(cle)}" aria-pressed="${m.posture === cle}"${pause ? " disabled" : ""}>${e(nom)}</button>`).join("");
    const jeton = JETONS[h.jeton] ? `<span class="jeton-etat" data-jeton="${e(h.jeton)}">${JETONS[h.jeton]}</span>` : "";
    const don = v.sante_don > 0 ? `<span class="don-etat">${e(v.sante_don)} de Santé payé${v.sante_don > 1 ? "s" : ""} faute de Psy : un repos complet les rend</span>` : "";
    const mot = erreur || (pause ? "Le coin est en pause : votre MJ le rouvrira." : "");
    barre.dataset.combat = h.combat ? "oui" : "non";
    // Le sac et les notes (table-heros.js), en tiroirs sous la barre : leurs boutons au bout de la ligne du nom.
    const tiroir = document.body.dataset.tiroir || "";
    const outils = `<span class="outils-etat">${TIROIRS.map(([cle, nom, dessin]) => `<button type="button" data-tiroir="${cle}" aria-expanded="${tiroir === cle}" aria-label="${nom === "Sac" ? "Mon sac" : "Mes notes"}"><svg viewBox="0 0 24 24" aria-hidden="true">${dessin}</svg><span class="mot-outil">${nom}</span></button>`).join("")}</span>`;
    barre.innerHTML = `<p class="qui-etat"><span class="nom-heros-etat">${e(h.nom)}</span>${jeton}${outils}</p>
      <div class="jauges-etat">${jauges}</div>
      <div class="postures-etat" role="group" aria-label="Ma posture"><span class="nom-etat">Posture</span>${postures}</div>
      ${don}${mot ? `<p class="mot-etat" role="${erreur ? "alert" : "status"}">${e(mot)}</p>` : ""}`;
  }

  function dire(message) {
    erreur = message;
    clearTimeout(finErreur);
    finErreur = setTimeout(() => {
      erreur = "";
      dessiner();
    }, 5000);
  }

  function recu(r) {
    etat = r;
    // Un refus de l'atelier (trop tard, table fermée) : la barre le dit, et revient à ce que dit la fiche.
    const d = r.dernier;
    if (d && d.statut === "echec" && d.phrase && d.id !== recu.vu) {
      recu.vu = d.id;
      dire(d.phrase);
    }
    if (!enAttente()) attendu = null;
    dessiner();
  }

  async function relire() {
    const n = ++lecture;
    try {
      const r = await demander("GET");
      if (n === lecture) recu(r);
    } catch (err) {
      if (err.status === 401) {
        etat = null;
        dessiner();
      }
    }
  }

  const bientot = () => {
    clearTimeout(relance);
    relance = setTimeout(relire, 100);
  };

  function tenirLaGrace() {
    enGrace = true;
    clearTimeout(grace);
    grace = setTimeout(() => {
      enGrace = false;
      relire();
    }, GRACE);
  }

  async function envoyer(corps) {
    envois += 1;
    lecture += 1;
    try {
      const r = await demander("POST", corps);
      envois -= 1;
      tenirLaGrace();
      recu(r);
    } catch (err) {
      envois -= 1;
      attendu = null;
      dire(err.status === 423 ? "Le coin est en pause : votre MJ le rouvrira." : err.message);
      relire();
    }
  }

  function partir() {
    clearTimeout(minuterie);
    for (const champ of Object.keys(ecarts)) {
      const delta = ecarts[champ];
      ecarts[champ] = 0;
      if (delta) envoyer({ champ, delta });
    }
  }

  barre.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b || b.disabled || !heros()) return;
    if (b.dataset.tiroir) return window.dispatchEvent(new CustomEvent("tiroir-coin", { detail: b.dataset.tiroir }));
    const base = montre();
    if (b.dataset.posture) {
      if (base.posture === b.dataset.posture) return;
      attendu = { vitalite: base.vitalite, posture: b.dataset.posture };
      dessiner();
      return envoyer({ posture: b.dataset.posture });
    }
    const champ = b.closest("[data-champ]")?.dataset.champ;
    const pas = Number(b.dataset.delta);
    if (!champ || !pas) return;
    const apres = calculer(base.vitalite, champ, pas);
    if (apres[champ] === base.vitalite[champ]) return;
    const max = etat.delta_max || 99;
    if (Math.abs(ecarts[champ] + pas) > max) return;
    ecarts[champ] += pas;
    attendu = { vitalite: apres, posture: base.posture };
    dessiner();
    clearTimeout(minuterie);
    minuterie = setTimeout(partir, REGROUPER);
  });
  // La page quittée ou mise en veille : ce qui attend part tout de suite.
  window.addEventListener("pagehide", partir);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") partir();
    else relire();
  });

  ecouterFlux("demandes", bientot);
  ecouterFlux("jets", bientot);
  ecouterFlux("table", bientot);
  ecouterFlux("pause", bientot);
  relire();
  monte = { barre, relire };
  return monte;
}
