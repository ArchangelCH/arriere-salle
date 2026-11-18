// Le flux poussé du coin des joueurs (GET /api/flux, des événements envoyés par le serveur) : la page apprend qu'il y a
// du nouveau pour ce joueur, sujet par sujet (« demandes », « commandes », « carnet », « pause », « table », « prives », « jets »,
// « portraits », « jets-table » : les jets de la tablée, « pointeur » : le pointeur et la règle du MJ, page Table), et relit
// elle-même par ses routes habituelles. Un événement ne porte jamais de contenu. Une seule liaison par page, partagée par les modules
// qui écoutent ; elle se reconnecte seule, et s'arrête quand la page est cachée (téléphone en poche) : au retour, chaque
// module relit, puisqu'il a pu manquer quelque chose.

const SUJETS = ["demandes", "commandes", "carnet", "pause", "table", "prives", "jets", "portraits", "jets-table", "pointeur", "musique"];
const abonnes = new Map(SUJETS.map((s) => [s, new Set()]));
let source = null;
let ouvertUneFois = false;
let attente = 0; // la prochaine reconnexion décidée par la page (le serveur a refusé : trop de pages, session perdue)
let pas = 5000;

function avertir(sujet, retour = false) {
  for (const fn of [...(abonnes.get(sujet) || [])]) {
    try {
      fn({ sujet, retour });
    } catch (err) {
      console.error(err);
    }
  }
}

// Revenue après une coupure, ou de nouveau visible : tout peut avoir changé.
function toutRelire() {
  for (const s of SUJETS) avertir(s, true);
}

function ecoute() {
  return [...abonnes.values()].some((x) => x.size);
}

function demarrer() {
  if (source || attente || document.visibilityState === "hidden" || !ecoute() || typeof EventSource === "undefined") return;
  const es = new EventSource("/api/flux");
  source = es;
  es.onopen = () => {
    pas = 5000;
    if (ouvertUneFois) toutRelire();
    ouvertUneFois = true;
  };
  es.onmessage = (ev) => {
    if (SUJETS.includes(ev.data)) avertir(ev.data);
  };
  es.onerror = () => {
    // Une coupure : le navigateur se reconnecte seul (délai « retry » du serveur). Un refus (429, 401) ferme la liaison
    // pour de bon : la page réessaie elle-même, de moins en moins souvent.
    if (es.readyState !== EventSource.CLOSED) return;
    if (source === es) source = null;
    attente = setTimeout(() => {
      attente = 0;
      demarrer();
    }, pas);
    pas = Math.min(pas * 2, 300000);
  };
}

function arreter() {
  source?.close();
  source = null;
  clearTimeout(attente);
  attente = 0;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") return arreter();
  if (!source && ecoute()) {
    pas = 5000;
    demarrer();
    toutRelire();
  }
});
window.addEventListener("pagehide", arreter);
// Revenue de l'historique du navigateur (Safari garde la page en mémoire) : la liaison repart, et tout se relit.
window.addEventListener("pageshow", (ev) => {
  if (!ev.persisted || source || !ecoute()) return;
  pas = 5000;
  demarrer();
  toutRelire();
});

// fn({ sujet, retour }) à chaque nouvelle de ce sujet (retour : après une coupure ou un retour sur la page, rien n'est
// sûr). Renvoie de quoi cesser d'écouter.
export function ecouterFlux(sujet, fn) {
  if (!abonnes.has(sujet)) throw new Error(`Sujet inconnu : ${sujet}`);
  abonnes.get(sujet).add(fn);
  demarrer();
  return () => {
    abonnes.get(sujet).delete(fn);
    if (!ecoute()) arreter();
  };
}
