// Passer à la scène suivante d'un geste, depuis le bandeau de Séances, le Tableau ou la télécommande : la scène en cours
// se coche, la suivante se joue comme « Jouer la scène » (plan sur la TV, ambiance, journal, repère), avec le même
// compte rendu. Le bouton porte la scène qu'il annonce : si un autre écran a avancé entre-temps, rien ne se joue deux
// fois, le geste dit où en est la séance.
// La page Séances fait le geste elle-même quand elle tient la séance (événement « scene-suivante » : sa copie reste la
// bonne) ; sinon il se fait ici, la séance relue puis enregistrée avec sa version avant le moindre envoi.

import { api, echapper as e } from "../api.js";
import { noterAuJournal } from "./journal.js";
import { jouerLaScene, ligneEnCours, marquerEnCours, vuePlan } from "./jouer-scene.js";
import { liensDe } from "./liens-scene.js";

// Ce que GET /api/table ajoute à l'état : jamais renvoyé.
const CHAMPS_LUS = ["ecrans", "ecrans_salon", "ecrans_internet", "publique"];

export const titreScene = (d, i) => (d?.titre || "").trim() || `Scène ${i + 1}`;

// En cours : la scène jouée (repère de « Jouer la scène ») qui n'est pas encore cochée. Ensuite : la première scène non
// cochée après elle, sinon avant elle ; sans scène en cours, la première non cochée. -1 quand il n'y en a pas.
export function filDeLaSeance(s) {
  const lignes = s?.deroule || [];
  const enCours = ligneEnCours(s);
  const libres = [...lignes.keys()].filter((k) => !lignes[k]?.fait && k !== enCours);
  const suivante = enCours < 0 ? libres[0] ?? -1 : libres.find((k) => k > enCours) ?? libres[0] ?? -1;
  return { enCours, suivante };
}

// Ce que le bouton annonce : les deux scènes et le titre de celle qui va se jouer.
export function attenduDe(s) {
  const { enCours, suivante } = filDeLaSeance(s);
  return { enCours, suivante, titre: suivante >= 0 ? titreScene(s.deroule[suivante], suivante) : "" };
}

// Le pas du geste, sur la séance donnée : vérifie qu'elle en est là où le bouton le disait, coche la scène en cours et
// pose le repère sur la suivante. Rend { i } (la scène à jouer), ou { refus, deja } quand la séance a changé (deja : la
// scène annoncée est déjà en cours, ce que voulait le MJ).
export function avancer(s, attendu, quand) {
  const lignes = s?.deroule || [];
  const fil = filDeLaSeance(s);
  const titre = (k) => titreScene(lignes[k], k);
  // Comparés comme le serveur range le titre d'une commande (telecommande.chaine) : blancs réduits, 200 caractères.
  const net = (t) => String(t || "").split(/\s+/).filter(Boolean).join(" ").slice(0, 200);
  const pareil = (k, t) => net(titre(k)) === net(t);
  if (attendu && (fil.enCours !== attendu.enCours || fil.suivante !== attendu.suivante || (fil.suivante >= 0 && !pareil(fil.suivante, attendu.titre)))) {
    const deja = fil.enCours >= 0 && Boolean(attendu.titre) && pareil(fil.enCours, attendu.titre);
    return {
      deja,
      refus: deja ? `« ${attendu.titre} » est déjà en cours.`
        : `La séance a changé entre-temps : ${fil.enCours >= 0 ? `« ${titre(fil.enCours)} » est en cours` : "aucune scène n'est en cours"}.`,
    };
  }
  if (fil.suivante < 0) return { deja: false, refus: "Plus de scène à jouer : tout le déroulé est coché." };
  if (fil.enCours >= 0) lignes[fil.enCours].fait = true;
  marquerEnCours(lignes, lignes[fil.suivante], quand);
  return { i: fil.suivante };
}

// La TV sur le plan de la scène, comme « Jouer la scène » : déjà à l'écran, il garde son cadrage.
export async function montrerPlanSurLaTv(p) {
  const etat = await api.get("/api/table");
  const ecrans = etat.ecrans;
  for (const k of CHAMPS_LUS) delete etat[k];
  if (etat.vue === "plan" && etat.plan === p.id) return { deja: true, ecrans };
  return api.put("/api/table", { ...etat, ...vuePlan(p) });
}

// Les trois envois du geste hors de la page Séances. lancerAmbiance : le lecteur de cet écran (absent sur le téléphone,
// sansMusique dit pourquoi).
export function envoisDuGeste(seance, { lancerAmbiance = null, sansMusique = "" } = {}) {
  return {
    montrerPlan: montrerPlanSurLaTv,
    lancerAmbiance: (id) => (lancerAmbiance ? lancerAmbiance(id) : Promise.reject(new Error(sansMusique || "aucun lecteur de musique ici"))),
    noter: (texte) => noterAuJournal(seance, texte),
  };
}

// Le geste hors de la page Séances : la séance relue, avancée et enregistrée avec sa version (un autre écran qui a
// avancé entre-temps fait refuser l'enregistrement : la séance est relue et le bouton revérifié), puis les envois.
// outils : { lancerAmbiance, musique() (ce qui joue ici), sansMusique }. Rend { texte, erreur, refus, deja, seance }.
export async function jouerSuivanteAilleurs({ seance: id, attendu }, outils = {}) {
  const url = `/api/seances/${encodeURIComponent(id)}`;
  const quand = new Date().toISOString();
  let s;
  let pas;
  for (let essai = 0; ; essai++) {
    s = await api.get(url);
    pas = avancer(s, attendu, quand);
    if (pas.refus) return { texte: pas.refus, erreur: !pas.deja, refus: true, deja: pas.deja, seance: s };
    try {
      s = await api.put(url, { ...s, version_base: s.modifie });
      break;
    } catch (err) {
      if (err.status !== 409 || essai >= 2) throw err;
    }
  }
  const l = liensDe(s.deroule[pas.i]);
  const [plan, musique] = await Promise.all([
    l.plan ? api.get(`/api/plans/${encodeURIComponent(l.plan)}`).catch(() => null) : null,
    l.ambiance ? api.get("/api/musique").catch(() => null) : null,
  ]);
  const ambiance = (musique?.ambiances || []).find((a) => a.id === l.ambiance) || null;
  const bilan = await jouerLaScene({ seance: s, i: pas.i, r: { plan, pnj: [], rencontre: null, ambiance }, musique: outils.musique?.() || {}, quand },
    envoisDuGeste(id, outils));
  return { ...bilan, seance: s };
}

// Depuis le Tableau ou le relais de la télécommande : la page Séances le fait si elle tient cette séance, sinon ici.
export function demanderSceneSuivante(demande, outils = {}) {
  const detail = { ...demande, resultat: null };
  const prise = !window.dispatchEvent(new CustomEvent("scene-suivante", { cancelable: true, detail }));
  return prise && detail.resultat ? detail.resultat : jouerSuivanteAilleurs(demande, outils);
}

const enPhrase = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(", ")} et ${parts[parts.length - 1]}` : parts[0]);

// Ce que fera le geste, pour la bulle du bouton.
function bulle(s, enCours, suivante) {
  const l = liensDe(s.deroule[suivante]);
  const fait = enPhrase([l.plan && "plan sur la TV", l.ambiance && "ambiance", "journal"].filter(Boolean));
  const avant = enCours >= 0 ? `Coche « ${titreScene(s.deroule[enCours], enCours)} » et joue` : "Joue";
  return `${avant} « ${titreScene(s.deroule[suivante], suivante)} » : ${fait}.`;
}

// Le fil de la séance en une ligne : le bandeau de Séances (variante « bandeau ») et le Tableau (« tableau », avec le
// nom de la séance, qui l'ouvre sur Jouer). Rien pour une séance close ou sans déroulé.
export function htmlFilDeSeance(s, variante = "bandeau") {
  const lignes = s?.deroule || [];
  if (!lignes.length || s.close) return "";
  const { enCours, suivante } = filDeLaSeance(s);
  const nom = [`Séance ${s.numero ?? ""}`.trim(), s.nom].filter(Boolean).join(" · ");
  const titre = (k) => e(titreScene(lignes[k], k));
  const scenes = [];
  if (enCours >= 0) {
    scenes.push(`<span class="fil-scene en-cours"><small>En cours</small>${variante === "bandeau"
      ? `<button type="button" class="fil-voir" data-action="voir-scene" title="Voir la scène dans le fil de la séance">${titre(enCours)}</button>`
      : `<b>${titre(enCours)}</b>`}</span>`);
  }
  if (suivante >= 0) scenes.push(`<span class="fil-scene ensuite"><small>Ensuite</small><b>${titre(suivante)}</b></span>`);
  else if (enCours >= 0) scenes.push('<span class="fil-scene fin">Dernière scène du déroulé.</span>');
  else scenes.push('<span class="fil-scene fin">Toutes les scènes sont jouées.</span>');
  const att = suivante >= 0 ? titreScene(lignes[suivante], suivante) : "";
  return `
    <div class="fil-seance ${variante}">
      ${variante === "tableau" ? `<a class="fil-nom" href="#/seances/${encodeURIComponent(s.id)}?onglet=jouer" title="Ouvrir la séance sur Jouer">${e(nom)}</a>` : ""}
      <p class="fil-scenes">${scenes.join("")}</p>
      ${suivante >= 0 ? `<button type="button" class="principal" data-action="jouer-suite" data-seance="${e(s.id)}" data-de="${enCours}" data-vers="${suivante}" data-titre="${e(att)}" title="${e(bulle(s, enCours, suivante))}" aria-label="Jouer « ${e(att)} »">Jouer</button>` : ""}
    </div>`;
}

// L'attendu porté par un bouton « Jouer » du fil.
export const attenduDuBouton = (b) => ({ enCours: +b.dataset.de, suivante: +b.dataset.vers, titre: b.dataset.titre || "" });
