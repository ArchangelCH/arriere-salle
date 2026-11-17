// L'état de la télécommande : constantes, mémoire du téléphone, ce qu'on sait de l'atelier (d) et ce que les modules se passent (S).

import { accorderEnfants } from "../commun/accorder.js";
import { api } from "../api.js";
import { lireBoutiqueMontree } from "../boutiques/rayons-telecommande.js";
import { seanceDuJournal } from "../seances/journal.js";
import { injoignable, raison } from "../commun/reessai.js";
import { rienDeRevele } from "../ecran-tv/tv-commun.js";
import { majSeance } from "./notes.js";
import { afficher } from "./rendu.js";

const PERIODE = 3000; // la table et le relais, relus toutes les trois secondes tant que la page est visible
const LISTES = 60000; // séances, plans, PNJ et ambiances : relus au plus toutes les minutes, et au retour sur la page
const PLAN_MIN = 6000; // les étapes du plan montré : relues quand il change, au plus toutes les six secondes
const PAUSES = [1200, 3500]; // nouveaux essais d'un geste quand le serveur ne répond pas
const SUIVI_MUSIQUE = 20000; // le temps laissé à l'atelier du Mac pour appliquer une commande de musique
const SUIVI_ETAPE = 8000; // une étape que l'éditeur n'a pas prise à temps : le téléphone la rappelle lui-même
const SANS_REPONSE = 12000; // une commande prise par l'atelier, sans résultat au-delà : il n'a pas répondu
const SUIVI_SCENE = 10000; // la scène suivante que l'atelier n'a pas prise à temps : le téléphone la joue lui-même
const RECENTS_MAX = 6;
// Les cartons posés par-dessus la vue restent quand un plan arrive, comme depuis l'éditeur.
const CARTONS = ["pnj", "rumeur", "aventurier", "aventurier_maj"];
// Ce que GET /api/table ajoute à l'état : jamais renvoyé.
const CHAMPS_LUS = ["ecrans", "ecrans_salon", "ecrans_internet", "publique", "par", "par_nom"];
const ONGLETS = ["tv", "combat", "musique", "journal"];
const LARGE = matchMedia("(min-width: 760px)");

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const signe = (n) => String(n).replace("-", "−");
const couleurSante = (k) => (k > 0.6 ? "#6aa84f" : k > 0.3 ? "#d9a13b" : "#c8372d");
const de = (nom) => (/^[aeiouyàâéèêëîïôöùûœ]/i.test(nom) ? `d'${nom}` : `de ${nom}`);
// Comme le serveur range une ligne du journal : les blancs ramenés à une espace.
const uneLigne = (t) => String(t || "").split(/\s+/).filter(Boolean).join(" ");
const jeton = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (o) => o.toString(16).padStart(2, "0")).join("");

function lireMemoire(cle, defaut) {
  try {
    const v = localStorage.getItem(cle);
    return v === null ? defaut : JSON.parse(v) ?? defaut;
  } catch {
    return defaut;
  }
}

function garder(cle, valeur) {
  try {
    localStorage.setItem(cle, JSON.stringify(valeur));
  } catch {
    // navigation privée : rien de retenu, rien de cassé
  }
}

const d = {
  table: null, // GET /api/table
  relais: null, // GET /api/telecommande : les écrans de l'atelier, ce que joue le Mac
  seances: [],
  plans: [],
  pnj: [],
  ambiances: [],
  plan: null, // le plan montré à la TV, avec ses étapes
  boutique: null, // la boutique montrée à la TV, avec ses rayons (rayons-telecommande.js)
  planLu: 0,
  jeu: null, // etat-jeu.js : le combat en cours et sa séance
  listesLues: 0,
  liaison: "attente",
  recents: lireMemoire("telecommande.plans", []).filter((x) => typeof x === "string").slice(0, RECENTS_MAX),
  // Les lignes du journal pas encore reçues par le serveur : gardées sur le téléphone jusqu'à leur arrivée.
  notes: lireMemoire("telecommande.notes", []).filter((n) => n && typeof n.texte === "string" && typeof n.seance === "string"),
  noms: new Map(),
};
export const S = {
  onglet: ONGLETS.includes(lireMemoire("telecommande.onglet", "tv")) ? lireMemoire("telecommande.onglet", "tv") : "tv",
  // L'heure du serveur moins celle du téléphone, en ms : le sablier se compte comme sur l'ordinateur.
  decalage: 0,
};

const occupes = new Set();

async function lireListes() {
  const lus = await Promise.allSettled(["/api/seances", "/api/plans?resume=1", "/api/pnj", "/api/musique"].map((u) => api.get(u)));
  const [seances, plans, pnj, musique] = lus.map((r) => (r.status === "fulfilled" ? r.value : null));
  if (Array.isArray(seances)) d.seances = seances;
  if (Array.isArray(plans)) {
    d.plans = plans.map((p) => ({ id: p.id, nom: p.nom || "Plan sans nom", style: p.style || "couleur", modifie: p.modifie, etapes: Number.isFinite(p.nb_etapes) ? p.nb_etapes : Array.isArray(p.etapes) ? p.etapes.length : 0 }))
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  }
  if (Array.isArray(pnj)) d.pnj = pnj.map((p) => ({ id: p.id, nom: p.nom || "PNJ sans nom", connu: Boolean(p.connu) }));
  if (musique && Array.isArray(musique.ambiances)) d.ambiances = musique.ambiances.map((a) => ({ id: a.id, nom: a.nom || "Ambiance", liste: Boolean(a.liste) }));
  if (lus.every((r) => r.status === "fulfilled")) d.listesLues = Date.now();
}

async function lirePlanMontre() {
  const t = d.table;
  // Le plan de l'autre MJ (deux MJ) arrive sous son jeton : ses étapes ne se mènent pas d'ici.
  if (!(t?.vue === "plan" && t.plan) || (Array.isArray(t.jetons) && t.jetons.includes("plan"))) {
    d.plan = null;
    return;
  }
  const cle = `${t.plan}|${t.version ?? ""}`;
  if (d.plan?.cle === cle) return;
  if (d.plan?.id === t.plan && Date.now() - d.planLu < PLAN_MIN) return;
  try {
    const p = await api.get(`/api/plans/${encodeURIComponent(t.plan)}`);
    const etapes = Array.isArray(p.etapes) ? p.etapes : [];
    d.plan = {
      id: p.id, cle, nom: p.nom || "Plan sans nom", modifie: p.modifie,
      // Le nom d'une étape, s'il dit plus que son numéro.
      etapes: etapes.map((et, k) => {
        const nom = typeof et?.nom === "string" ? et.nom.trim() : "";
        return nom && nom !== `Étape ${k + 1}` ? nom : "";
      }),
      etape: Number.isInteger(p.etape) && etapes[p.etape] ? p.etape : null,
      // Sous le brouillard, rien de révélé : la TV n'en montre que du noir.
      noire: rienDeRevele(p),
    };
    d.planLu = Date.now();
  } catch {
    // gardé tel quel : la table est relue au prochain tour
  }
}

function retenirPlan(t) {
  // Le plan de l'autre MJ (sous son jeton) n'entre pas dans les plans récents : ils se rouvrent par leur fiche.
  if (t?.vue !== "plan" || !t.plan || d.recents[0] === t.plan || (Array.isArray(t.jetons) && t.jetons.includes("plan"))) return;
  d.recents = [t.plan, ...d.recents.filter((id) => id !== t.plan)].slice(0, RECENTS_MAX);
  garder("telecommande.plans", d.recents);
}

let lecture = null;
function relire({ listes = false } = {}) {
  if (lecture) return lecture;
  lecture = (async () => {
    const attente = listes || Date.now() - d.listesLues > LISTES ? lireListes() : null;
    try {
      const [table, relais, horl] = await Promise.all([api.get("/api/table"), api.get("/api/telecommande"),
        api.get("/api/horloges").catch(() => null)]);
      d.table = table;
      d.relais = relais;
      if (Array.isArray(horl?.horloges)) d.horloges = horl.horloges;
      poserLiaison("ok");
      retenirPlan(table);
      await lirePlanMontre();
      d.boutique = await lireBoutiqueMontree(api, table, d.boutique);
      // La séance en cours, relue à chaque tour : sa scène suit ce qui se joue sur l'ordinateur.
      const s = seanceEnCours();
      if (s) majSeance(await api.get(`/api/seances/${encodeURIComponent(s.id)}`).catch(() => s));
    } catch (err) {
      poserLiaison(injoignable(err) ? "coupee" : "erreur", err);
    }
    await attente;
    afficher();
  })().finally(() => {
    lecture = null;
  });
  return lecture;
}

function poserLiaison(etat, err) {
  d.liaison = etat;
  const el = document.querySelector(".liaison");
  el.dataset.etat = etat;
  // Court : la tête du téléphone n'a de place que pour deux mots. Le détail d'une erreur passe en bulle.
  el.querySelector("span").textContent = etat === "ok" ? "En ligne" : etat === "coupee" ? "Hors ligne" : "Erreur";
  el.title = etat === "erreur" ? raison(err) : etat === "coupee" ? "Nouvel essai toutes les trois secondes" : "";
}

// La séance en cours : celle du combat en cours (etat-jeu.js), sinon celle où note le bouton Journal de l'atelier.
function seanceEnCours() {
  const auCombat = d.jeu?.combat ? d.jeu.seance : "";
  return d.seances.find((s) => s.id === auCombat) || seanceDuJournal(d.seances);
}

const planDe = (id) => d.plans.find((p) => p.id === id) || null;
const fichePnj = (id) => d.pnj.find((p) => p.id === id) || null;
const ambianceDe = (id) => d.ambiances.find((a) => a.id === id) || null;
const nomSeance = (s) => [`Séance ${s.numero ?? ""}`.trim(), s.nom].filter(Boolean).join(" · ");

// Le nom d'une carte ou d'une boutique montrée : lu une fois, à la demande.
// Une fiche de l'autre MJ (deux MJ) arrive sous son jeton (« jetons » de GET /api/table) : son nom se lit comme la TV le
// lit (/api/table/<vue>/<jeton>), et une carte reste sans nom.
function nomDistant(collection, id, vue) {
  const cle = `${collection}/${id}`;
  const jeton = Array.isArray(d.table?.jetons) && d.table.jetons.includes(vue);
  if (jeton && collection === "cartes") return "";
  if (!d.noms.has(cle)) {
    d.noms.set(cle, "");
    api.get(jeton ? `/api/table/${vue}/${encodeURIComponent(id)}` : `/api/${collection}/${encodeURIComponent(id)}`).then((f) => {
      d.noms.set(cle, f?.nom || "");
      afficher();
    }).catch(() => {});
  }
  return d.noms.get(cle);
}

const derniers = new Map();
function rendre(el, html) {
  if (!el || derniers.get(el) === html) return;
  derniers.set(el, html);
  const neuf = document.createElement("div");
  neuf.innerHTML = html;
  accorderEnfants(el, neuf);
}

const attente = (cle) => (occupes.has(cle) ? ' aria-busy="true"' : "");

export { CARTONS, CHAMPS_LUS, LARGE, ONGLETS, PAUSES, PERIODE, SANS_REPONSE, SUIVI_ETAPE, SUIVI_MUSIQUE, SUIVI_SCENE, ambianceDe, attente, couleurSante, d, de, fichePnj, garder, jeton, nomDistant, nomSeance, occupes, pause, planDe, relire, rendre, seanceEnCours, signe, uneLigne };
