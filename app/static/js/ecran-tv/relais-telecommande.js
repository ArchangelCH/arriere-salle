// Le relais de la télécommande, côté atelier. Toutes les trois secondes, cet écran dit au serveur ce qu'il joue et quel
// plan son éditeur tient (telecommande.py), et reçoit les commandes que le téléphone lui confie : la musique, qui joue
// ici, l'étape du feu du plan ouvert et la scène suivante. Il relève aussi page cachée : l'écran du Mac peut s'endormir
// pendant que le MJ joue debout. Chaque commande porte un numéro ; redonnée par le serveur (une réponse perdue), elle
// n'est pas appliquée une seconde fois, son résultat repart.

import { echapper as e, toast } from "../api.js";
import { planCourant } from "../commun/etat-jeu.js";
import { commanderMusique, etatMusique, etatPourTelecommande, jouerAmbiance } from "../musique/musique.js";
import { demanderSceneSuivante } from "../seances/scene-suivante.js";

const PERIODE = 3000;
// Après « choisir une ambiance » : le temps de voir le son partir, ou le navigateur réclamer un geste (musique.js).
const ATTENTE_SON = 6500;
const ATTENTE_ENREGISTREMENT = 10000;
const GARDEES = 100;

const ecran = Array.from(crypto.getRandomValues(new Uint8Array(8)), (o) => o.toString(16).padStart(2, "0")).join("");
const appliquees = new Map(); // numéro → promesse du résultat
let file = Promise.resolve();
let dernierGeste = null;
let minuterie = 0;
let periode = PERIODE;
let demarre = false;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function etatEcran() {
  let musique = null;
  try {
    musique = etatPourTelecommande();
  } catch {
    // lecteur dans un état inattendu : le téléphone le verra « pas prêt »
  }
  return {
    ecran,
    musique,
    plan: planCourant()?.id || null,
    touche: dernierGeste === null ? null : Math.round((performance.now() - dernierGeste) / 1000),
    geste: navigator.userActivation ? navigator.userActivation.hasBeenActive : dernierGeste !== null,
  };
}

const ACQUIS = {
  pause: "La musique est en pause sur l'ordinateur.",
  reprendre: "La musique reprend sur l'ordinateur.",
  morceau: "Morceau suivant sur l'ordinateur.",
};

async function musique(c) {
  await commanderMusique(c.action, c.ambiance);
  if (c.action !== "choisir") return { ok: true, message: ACQUIS[c.action] || "" };
  const fin = performance.now() + ATTENTE_SON;
  let m = etatPourTelecommande();
  while (performance.now() < fin) {
    m = etatPourTelecommande();
    if (m?.courante === c.ambiance && m.joue) return { ok: true, message: `«\u00a0${m.nom}\u00a0» joue sur l'ordinateur.` };
    if (m?.attenteGeste) return { ok: false, message: "le navigateur du Mac attend un geste : touchez la vidéo dans le panneau Musique" };
    if (!m?.courante) return { ok: false, message: "le lecteur YouTube n'a pas démarré sur l'ordinateur" };
    if (m.courante !== c.ambiance) return { ok: false, message: "une autre ambiance a été lancée entre-temps" };
    await pause(250);
  }
  return { ok: true, message: `«\u00a0${m?.nom || "L'ambiance"}\u00a0» se lance sur l'ordinateur.` };
}

// L'éditeur qui tient le plan rappelle l'étape lui-même (plan/editeur.js, même geste que sa barre Étapes) : son
// enregistrement met la TV à jour sans conflit. libre : personne ici ne l'a prise, le téléphone peut la rappeler.
async function etape(c) {
  const detail = { plan: c.plan, etape: c.etape, enregistre: null };
  const prise = !window.dispatchEvent(new CustomEvent("telecommande-etape", { cancelable: true, detail }));
  if (!prise) return { ok: false, libre: true, message: "ce plan n'est plus ouvert dans l'éditeur du Mac" };
  const ok = await Promise.race([Promise.resolve(detail.enregistre), pause(ATTENTE_ENREGISTREMENT).then(() => null)]);
  if (ok === null) return { ok: false, message: "l'éditeur du Mac enregistre encore le plan" };
  return ok ? { ok: true, message: `Étape ${c.etape + 1} rappelée par l'éditeur du Mac.` } : { ok: false, message: "l'éditeur du Mac n'a pas pu enregistrer le plan" };
}

// « Scène suivante » du téléphone : le geste du bandeau de Séances (seances/scene-suivante.js), par la page Séances si
// elle tient la séance, avec la musique de cet écran. Déjà en cours, ce n'est pas un échec : c'était le but.
async function scene(c) {
  const bilan = await demanderSceneSuivante({ seance: c.seance, attendu: { enCours: c.de, suivante: c.vers, titre: c.titre || "" } },
    { lancerAmbiance: jouerAmbiance, musique: etatMusique });
  const muet = !bilan.refus && /ambiance en fondu/.test(bilan.texte) && navigator.userActivation && !navigator.userActivation.hasBeenActive;
  return { ok: !bilan.refus || Boolean(bilan.deja), message: `${bilan.texte}${muet ? " Le navigateur du Mac attend un geste : touchez la vidéo dans le panneau Musique." : ""}` };
}

async function appliquer(c) {
  try {
    if (c.genre === "musique") return await musique(c);
    if (c.genre === "etape") return await etape(c);
    if (c.genre === "scene") return await scene(c);
    return { ok: false, message: "commande inconnue de cet atelier" };
  } catch (err) {
    return { ok: false, message: String(err?.message || err) };
  }
}

function rendre(numero, resultat) {
  fetch(`/api/telecommande/commandes/${numero}/resultat`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ecran, ...resultat }),
  }).catch(() => {
    // le serveur redonnera la commande au prochain relevé, et ce résultat repartira
  });
}

// Les commandes s'appliquent l'une après l'autre, dans l'ordre où elles arrivent, sans retenir le relevé suivant.
function recevoir(c) {
  if (!appliquees.has(c.numero)) {
    const resultat = file.then(() => appliquer(c));
    file = resultat;
    appliquees.set(c.numero, resultat);
    for (const vieux of [...appliquees.keys()].slice(0, -GARDEES)) appliquees.delete(vieux);
  }
  appliquees.get(c.numero).then((r) => rendre(c.numero, r));
}

async function relever() {
  clearTimeout(minuterie);
  try {
    const r = await fetch("/api/telecommande/releve", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(etatEcran()),
    });
    if (r.ok) {
      // Le serveur dit à quel rythme relever (en-tête) : vite quand un téléphone écoute, lentement sinon.
      const prochain = Number(r.headers.get("X-Prochain-Releve"));
      if (Number.isFinite(prochain) && prochain > 0) periode = Math.min(15000, Math.max(2000, prochain));
      for (const c of (await r.json()).commandes || []) recevoir(c);
    }
  } catch {
    // serveur muet : nouveau relevé au prochain tour
  }
  // Programmé depuis la réponse du serveur : le navigateur ne ralentit pas autant ce relevé quand la page est cachée.
  minuterie = setTimeout(relever, periode);
}

export function demarrerRelais() {
  if (demarre) return;
  demarre = true;
  const geste = () => {
    dernierGeste = performance.now();
  };
  document.addEventListener("pointerdown", geste, { capture: true, passive: true });
  document.addEventListener("keydown", geste, { capture: true, passive: true });
  // Onglet fermé ou rechargé : le serveur ne lui confie plus rien. Revenu (cache du navigateur), il se signale aussitôt.
  window.addEventListener("pagehide", () => {
    navigator.sendBeacon?.("/api/telecommande/adieu", new Blob([JSON.stringify({ ecran })], { type: "application/json" }));
  });
  window.addEventListener("pageshow", (ev) => ev.persisted && relever());
  relever();
}

// Onglet Table : l'adresse à ouvrir sur le téléphone, celle de cet écran (à la maison) et celle d'Internet.
export function ajouterBlocTelecommande(grille) {
  if (!grille) return;
  const ici = `${location.origin}/telecommande`;
  const bloc = document.createElement("div");
  bloc.className = "bloc";
  bloc.innerHTML = `
    <h2>Télécommande</h2>
    <p>Ouvrez cette adresse sur le téléphone : la TV, le combat, la musique de cet ordinateur et le journal s'y pilotent d'un pouce.</p>
    <p class="adresse"><code></code></p>
    <p class="aide en-ligne" hidden>Par Internet, avec le mot de passe de l'atelier : <code></code></p>
    <div class="actions"><button type="button">Copier l'adresse</button></div>
    <p class="aide">Ajoutée à l'écran d'accueil du téléphone (Partager, puis «\u00a0Sur l'écran d'accueil\u00a0»), elle s'ouvre d'un geste. La musique obéit tant que l'atelier reste ouvert sur cet ordinateur.</p>`;
  // Coupée avant « /telecommande » si le bloc est étroit.
  const coupee = (adresse) => e(adresse).replace(/\/telecommande$/, "<wbr>/telecommande");
  bloc.querySelector(".adresse code").innerHTML = coupee(ici);
  grille.insertBefore(bloc, grille.children[1] || null);
  bloc.querySelector("button").addEventListener("click", () => copier(ici));
  fetch("/api/telecommande?de=atelier").then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d?.en_ligne || d.en_ligne === ici) return;
    const p = bloc.querySelector(".en-ligne");
    p.querySelector("code").innerHTML = coupee(d.en_ligne);
    p.hidden = false;
  }).catch(() => {});
}

// Sans connexion chiffrée (l'adresse de la maison), le presse-papiers moderne n'existe pas : l'ancienne copie prend le relais.
async function copier(texte) {
  try {
    await navigator.clipboard.writeText(texte);
  } catch {
    const zone = Object.assign(document.createElement("textarea"), { value: texte });
    zone.style.position = "fixed";
    zone.style.opacity = "0";
    document.body.append(zone);
    zone.select();
    const ok = document.execCommand("copy");
    zone.remove();
    if (!ok) return toast("Copie impossible : recopiez l'adresse à la main.", "erreur");
  }
  toast("Adresse copiée. Un iPhone du même compte la colle aussi.");
}
