// Les jets à distance, vus de l'atelier (lot F3, jets_mj.py) : les derniers tests lancés depuis le coin des joueurs, les
// tests que le MJ a demandés et qui attendent encore, les joueurs dont le héros est à la tablée (à qui en demander un).
// Une seule source par page, partagée par le Tableau et la télécommande. Elle arrive par le canal de l'atelier
// (canal-table.js, message « jets ») à l'instant où le dé tombe ; une relecture de secours rattrape une liaison tombée.
// Un test demandé passe au bout de dix minutes : la page le compte avec sa propre horloge.
//
// Lot G : les dés libres et les dégâts des armes passent dans la même liste (genre « des ») ; la réserve des dés d'aventure
// (vue.reserve : la règle en jeu, le groupe, le MJ, les dés de mésaventure annoncés) et ses gestes, partagés aussi.

import { api, echapper as e } from "../api.js";
import { ecouterJets } from "../ecran-tv/canal-table.js";

const SECOURS = 30000;
const FEUILLE = "/static/css/jets.css";
const abonnes = new Set();
let vue = null;
let numero = 0; // monte à chaque vue reçue par le canal : une relecture partie avant ne la remplace pas
let demarree = false;
let minuterie = 0;

export const signe = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");
export const deux = (n) => String(n).padStart(2, "0");
export const CARACS = [["physique", "Physique"], ["social", "Social"], ["mental", "Mental"]];

export function heure(iso) {
  const d = new Date(iso || "");
  return Number.isNaN(d.getTime()) ? "" : `${d.getHours()} h ${deux(d.getMinutes())}`;
}

export const prenomDe = (x) => String(x?.joueur_nom || x?.nom || "").trim() || "Un joueur";
export const herosDe = (x) => String(x?.heros_nom || x?.heros?.nom || "").trim();

// « Physique (Athlétisme) », « Mental, −10 » ; des dés : « 2D6+1 (Épée) ».
export function testDe(x) {
  if (x.genre === "des") return `${x.texte}${x.arme ? ` (${x.arme})` : ""}`;
  return `${x.carac_nom}${x.competence ? ` (${x.competence})` : ""}${x.modificateur ? `, ${signe(x.modificateur)}` : ""}`;
}

// « 4 + 3 + 1, bonus +2 » : les faces des dés libres, et le bonus dit comme tel (« + 2 » se lirait comme un dé de plus).
export const facesDe = (x) => `${(x.des || []).join(" + ")}${x.bonus ? `, bonus ${x.bonus > 0 ? "+" : "−"}${Math.abs(x.bonus)}` : ""}`;

// Le détail d'un jet pour le MJ : « 62 sur 35 » et ce qui a changé la valeur visée (« Carton rouge en Physique : −30 % ») ;
// pour des dés, les faces.
export function htmlDetail(x) {
  if (x.genre === "des") return `<span class="visee">${e(facesDe(x))}</span>`;
  const plus = (x.ajustements || []).map((a) => `<span class="ajustement-jet">${e(a.libelle)}\u00a0: ${e(signe(a.valeur))}\u00a0%</span>`).join("");
  // Posture offensive : les critiques élargis, dits au MJ (jets.seuils_de).
  const offensive = x.critiques?.offensive ? `<span class="ajustement-jet">Posture offensive\u00a0: critiques 01-${e(deux(x.critiques.reussite))} et ${e(x.critiques.echec)}-100</span>` : "";
  return `<span class="visee">${e(deux(x.de))} sur ${e(x.visee)}</span>${plus}${offensive}`;
}

// Le dé (en grand) et l'issue d'un jet : « 62 Échec » ; pour des dés, le total et « Total » ou « Dégâts ».
export function htmlIssue(x) {
  if (x.genre === "des") return `<span class="de">${e(x.total)}</span>${x.arme ? "Dégâts" : "Total"}`;
  return `<span class="de">${e(deux(x.de))}</span>${e(x.issue_nom)}`;
}

// ---- Lot G : les dés d'aventure ----

// L'effet choisi par le MJ (un désavantage) : la face envoyée est la plus haute de la paire, rien ne change avec l'autre.
export const EFFETS_CHOISIS = [[2, "Mouvement", "1-2"], [4, "Posture", "3-4"], [6, "In extremis", "5-6"]];
const PAR = { joueur: "choisi par le joueur", mj: "choisi par vous" };

// Les dés d'aventure et de mésaventure d'un test : « Aventure 5 In extremis », avec « Annuler le dé » tant qu'il compte.
export function htmlDesDuTest(x, avecAnnuler = true) {
  const morceaux = [["aventure", "Aventure"], ["mesaventure", "Mésaventure"]].filter(([k]) => x[k]).map(([k, nom]) => {
    const d = x[k];
    const annuler = k === "aventure" && avecAnnuler && !d.annule
      ? `<button type="button" class="annuler-de" data-jets="annuler-de" title="Le dé revient au groupe">Annuler le dé</button>` : "";
    return `<span class="de-aventure-mj ${k}${d.annule ? " annule" : ""}"><span class="face">${e(d.face)}</span>${nom}\u00a0: <b>${e(d.effet)}</b>${d.choisie ? ` <small>(${e(PAR[d.choisie] || "choisi")})</small>` : ""}${d.annule ? " <small>(annulé, revenu au groupe)</small>" : ""}${annuler}</span>`;
  });
  return morceaux.join("");
}

// Les deux réserves : des dés d'or pour le groupe, de sang pour le MJ.
export function htmlPips(n, classe) {
  return `<span class="pips-mj ${classe}" aria-hidden="true">${"<i></i>".repeat(Math.max(0, Math.min(n, 12)))}</span>`;
}

// Le joueur choisi, s'il porte un désavantage hors combat : le MJ peut choisir l'effet du dé de mésaventure.
export const desavantageDe = (j) => Boolean(j && j.jeton === "desavantage" && !j.combat);

export function poserFeuilleJets() {
  if (document.querySelector(`link[href="${FEUILLE}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = FEUILLE;
  document.head.append(l);
}

function courante() {
  if (!vue) return null;
  const t = Date.now();
  return { ...vue, demandes: vue.demandes.filter((d) => d.fin > t) };
}

function annoncer() {
  clearTimeout(minuterie);
  const v = courante();
  for (const fn of [...abonnes]) {
    try {
      fn(v);
    } catch (err) {
      console.error(err);
    }
  }
  const fin = Math.min(...(v?.demandes || []).map((d) => d.fin));
  if (Number.isFinite(fin)) minuterie = setTimeout(annoncer, Math.max(100, fin - Date.now() + 30));
}

function poser(v) {
  if (!v || !Array.isArray(v.jets) || !Array.isArray(v.demandes) || !Array.isArray(v.joueurs)) return;
  const t = Date.now();
  vue = { ...v, demandes: v.demandes.map((d) => ({ ...d, fin: t + Math.max(0, Number(d.reste) || 0) * 1000 })) };
  annoncer();
}

function relire() {
  const n = numero;
  return api.get("/api/jets").then((v) => {
    if (n === numero) poser(v);
  }).catch(() => {});
}

function demarrer() {
  if (demarree) return;
  demarree = true;
  poserFeuilleJets();
  ecouterJets((v) => {
    numero += 1;
    poser(v);
  });
  relire();
  setInterval(relire, SECOURS);
  window.addEventListener("focus", relire);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") relire();
  });
}

// fn(vue) à chaque changement, et tout de suite avec la dernière connue : { jets, demandes, joueurs, ouvert, pause }, ou
// null tant que rien n'est lu. Renvoie de quoi cesser.
export function ecouterLesJets(fn) {
  abonnes.add(fn);
  demarrer();
  if (vue) fn(courante());
  return () => abonnes.delete(fn);
}

// « Léa : test de Mental » : le joueur le voit aussitôt sur son téléphone. Un test encore ouvert pour lui est remplacé. Avec
// mesaventure, un dé de mésaventure est annoncé pour ce test (face : l'effet choisi pour un héros en désavantage).
export async function demanderTest(joueur, carac, modificateur = 0, mesaventure = false, face = null) {
  const v = await api.post("/api/jets/demander", { joueur, carac, modificateur, ...(mesaventure ? { mesaventure: true, face } : {}) });
  numero += 1;
  poser(v);
  return v;
}

// Les gestes de la réserve : chacun rend la vue entière, posée aussitôt.
async function geste(promesse) {
  try {
    const v = await promesse;
    numero += 1;
    poser(v);
    return v;
  } catch (err) {
    relire();
    throw err;
  }
}

export const imposerMesaventure = (joueur, face = null) => geste(api.post("/api/jets/mesaventure", { joueur, face }));
export const retirerMesaventure = (joueur) => geste(api.post(`/api/jets/mesaventure/${encodeURIComponent(joueur)}/retirer`, {}));
export const annulerAventure = (ident) => geste(api.post(`/api/jets/${encodeURIComponent(ident)}/aventure/annuler`, {}));
export const passerDe = (vers) => geste(api.post("/api/des-aventure/passer", { vers }));
export const reglerDes = (corps) => geste(api.put("/api/des-aventure", corps));

// Retirer un test demandé, avec la version lue : si le joueur a lancé entre-temps, le serveur refuse (409).
export async function retirerTest(d) {
  try {
    const v = await api.post(`/api/jets/demandes/${encodeURIComponent(d.joueur)}/${encodeURIComponent(d.id)}/retirer`, { version: d.version });
    numero += 1;
    poser(v);
    return v;
  } catch (err) {
    relire();
    throw err;
  }
}
