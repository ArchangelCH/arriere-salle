// Prix et attente probables des boutons qui appellent l'API (« environ 0,30 $, 20 s »), lus par /api/ia/estimations dans
// le journal des coûts : rien n'est appelé ni écrit. Un bouton les demande par data-estimation="<usage>" (clés
// d'ESTIMATIONS dans redaction.py) ; data-estimation-fois="3" pour trois versions en un appel (trois fois la réponse),
// data-estimation-differe pour la même demande en lot (avec « fois » : autant de lots, un par chapitre d'un scénario), data-estimation-discret pour ne les mettre que dans l'info-bulle.
// Le texte court va dans data-prix (affiché sous le libellé par atelier.css), le détail dans l'info-bulle. Sans clé d'API
// sur le serveur, ces boutons sont atténués et le disent (data-sans-cle, css/filets.css), sauf ceux auxquels le modèle
// local répond ; une ligne discrète l'annonce une fois.
// Un MJ invité a un budget de rédaction par mois (« budget » dans la réponse, lot MJ-5) : atteint, ses boutons sont
// atténués de même (data-budget-atteint ; le serveur répondrait 402), sauf ceux auxquels le modèle local répond ; presque
// atteint, un bouton dont le prix probable dépasse ce qui reste le dit, et la relecture au regard du canon propose la
// relecture rapide. Le compte principal n'a pas de budget : rien ne change pour lui.
import { api, toast } from "../api.js";

const FRAICHEUR = 5000;
let connues = null;
let lues = 0;
let enCours = null;

export function estimations(forcer = false) {
  if (!forcer && connues && Date.now() - lues < FRAICHEUR) return Promise.resolve(connues);
  if (!enCours) {
    enCours = api.get("/api/ia/estimations")
      .then((r) => { connues = r; lues = Date.now(); return r; })
      .catch(() => connues)
      .finally(() => { enCours = null; });
  }
  return enCours;
}

export function dollars(x) {
  return x < 0.01 ? "moins de 0,01 $" : `${x.toFixed(2).replace(".", ",")} $`;
}

export function attente(secondes) {
  if (secondes < 60) return `${Math.max(5, Math.round(secondes / 5) * 5)} s`;
  const demi = Math.round(secondes / 30) / 2;
  const minutes = Math.floor(demi);
  return demi > minutes ? `${minutes} min 30 s` : `${minutes} min`;
}

// { court, long } pour une estimation du serveur, ou null quand il n'y a rien à dire (pas de clé d'API).
export function annonce(est, { fois = 1, differe = false } = {}) {
  if (!est) return null;
  const quoi = est.famille === "bible" ? "la bible entière" : "le contexte de la campagne";
  if (!est.connu) {
    // Jamais appelé : seul le chargement du contexte, quand il n'est plus en cache, vaut d'être annoncé.
    if (differe || est.en_cache || !est.minimum) return { court: "", long: "Prix et attente pas encore mesurés : ils s'afficheront après un premier appel." };
    return {
      court: `au moins ${dollars(est.minimum)}`,
      long: `Prix pas encore mesuré : au moins ${dollars(est.minimum)} pour charger ${quoi}, qui n'est plus en cache, plus la réponse.`,
    };
  }
  const selon = `D'après ${est.appels > 1 ? `les ${est.appels} derniers appels` : "le dernier appel"}`;
  if (differe) {
    return {
      court: `environ ${dollars(est.differe * fois)}, dans l'heure`,
      long: `Environ ${dollars(est.differe * fois)} : moitié prix, sans cache. Le résultat arrive en général dans l'heure. ${selon}.`,
    };
  }
  const cout = est.cout + (fois - 1) * est.sortie;
  const duree = est.duree * fois;
  const contexte = est.contexte_a_charger
    ? ` Dont ${dollars(est.contexte_a_charger)} pour charger ${quoi}, qui n'est plus en cache ; ensuite environ ${dollars(est.cout_en_cache + (fois - 1) * est.sortie)} tant qu'il y reste (une heure après le dernier appel).`
    : "";
  return {
    court: `environ ${dollars(cout)}, ${attente(duree)}`,
    long: `Environ ${dollars(cout)} et ${attente(duree)} d'attente.${contexte} ${selon}${est.duree_mesuree ? "" : ", attente déduite de la longueur des réponses"}.`,
  };
}

const SANS_CLE = "Rédaction indisponible : le service d'écriture n'est pas branché sur ce serveur.";

// Le bouton dépend de la clé d'API, et elle manque (la rédaction de secours du serveur ne répond qu'à quelques usages : repli_local).
const sansCle = (donnees, usage) => Boolean(donnees) && donnees.disponible === false && !(donnees.repli_local || []).includes(usage);

// Ce que le budget du mois d'un MJ invité dit d'un bouton : { atteint, mot } (mot : pour l'info-bulle), ou null. La
// relecture rapide n'est proposée qu'à côté de son bouton (celle d'un chapitre ; tout le scénario n'en a pas).
function selonLeBudget(el, donnees, usage, est, { fois, differe }) {
  const b = donnees?.budget;
  if (!b || !donnees.disponible) return null;
  if (b.atteint) {
    const mot = `Budget de rédaction du mois atteint : ${dollars(b.depense)} sur ${dollars(b.budget)}, il revient le ${b.revient}.`;
    return (donnees.repli_local || []).includes(usage)
      ? { atteint: false, mot: `${mot} La rédaction de secours du serveur répond à la place.` }
      : { atteint: true, mot: `${mot} Ce bouton répondra de nouveau à ce moment-là.` };
  }
  const prix = est?.connu ? (differe ? est.differe : est.cout + (fois - 1) * est.sortie) : est?.minimum || 0;
  if (!(prix > b.reste)) return null;
  const voisin = el.closest(".consigne-actions, .actions")?.querySelector('[data-estimation="relecture-rapide"]');
  const rapide = usage === "relecture" && voisin ? donnees.usages?.["relecture-rapide"] : null;
  const plutot = rapide && (!rapide.connu || rapide.cout <= b.reste) ? " La relecture rapide coûte bien moins : essayez-la plutôt." : "";
  return { atteint: false, depasse: true, mot: `Plus que ${dollars(b.reste)} dans votre budget du mois : cette demande pourrait le dépasser, et ne partirait pas.${plutot}` };
}

function poser(el, donnees) {
  const est = donnees?.disponible ? donnees.usages?.[el.dataset.estimation] : null;
  const a = annonce(est, { fois: Math.max(1, +el.dataset.estimationFois || 1), differe: el.dataset.estimationDiffere !== undefined });
  const budget = selonLeBudget(el, donnees, el.dataset.estimation, est, { fois: Math.max(1, +el.dataset.estimationFois || 1), differe: el.dataset.estimationDiffere !== undefined });
  if (budget?.atteint) el.dataset.budgetAtteint = "";
  else delete el.dataset.budgetAtteint;
  if (el.dataset.titreOrigine === undefined) el.dataset.titreOrigine = el.getAttribute("title") || "";
  const origine = el.dataset.titreOrigine;
  // Au-delà de ce qui reste du budget (un MJ invité) : dit sous le libellé aussi, l'info-bulle ne se lit pas au doigt.
  if (a?.court && el.dataset.estimationDiscret === undefined) el.dataset.prix = budget?.depasse ? `${a.court}, au-delà du budget` : a.court;
  else delete el.dataset.prix;
  const manque = sansCle(donnees, el.dataset.estimation);
  if (manque) el.dataset.sansCle = "";
  else delete el.dataset.sansCle;
  const titre = [origine, manque ? `${SANS_CLE} Ce bouton répondra dès qu'elle y sera.` : a?.long, manque ? "" : budget?.mot].filter(Boolean).join("\n");
  if (titre) el.title = titre;
  else el.removeAttribute("title");
}

// La ligne qui dit l'absence de clé, une fois : là où la page lui fait une place (.place-sans-cle, en haut de la barre
// d'un scénario), sinon un message, une seule fois par onglet. Masquée d'un clic, elle ne revient qu'avec un autre onglet.
const MASQUEE = "atelier.sans-cle-masquee";
const DITE_UNE_FOIS = "atelier.sans-cle-dite";
let dite = false;
const masquee = () => {
  try {
    return sessionStorage.getItem(MASQUEE) === "oui";
  } catch {
    return false;
  }
};

function annoncerSansCle(racine) {
  const vides = racine.querySelectorAll(".place-sans-cle:empty");
  if (!racine.querySelector("[data-sans-cle]") || masquee()) return;
  for (const place of vides) {
    dite = true;
    place.innerHTML = `<p class="sans-cle-bandeau" role="note"><b>Rédaction</b><span>Indisponible : le service d'écriture n'est pas branché sur ce serveur. Les boutons qui en dépendent sont atténués ; le reste de l'atelier fonctionne.</span><button type="button" data-masquer-sans-cle aria-label="Masquer cette ligne" title="Masquer jusqu'au prochain onglet">×</button></p>`;
  }
  if (dite || racine.querySelector(".sans-cle-bandeau")) return;
  dite = true;
  // Une seule fois par onglet du navigateur, pas à chaque page ni à chaque rechargement : ensuite, l'info-bulle des
  // boutons atténués et leur propre réponse au clic le disent.
  try {
    if (sessionStorage.getItem(DITE_UNE_FOIS) === "oui") return;
    sessionStorage.setItem(DITE_UNE_FOIS, "oui");
  } catch {
    // sans stockage : une fois par chargement
  }
  toast(`${SANS_CLE} Les boutons d'aide à l'écriture sont atténués ; le reste de l'atelier fonctionne.`, "info", { duree: 6000 });
}

// Le budget du mois atteint (un MJ invité) : dit une fois par onglet, quand une page montre un bouton qu'il atténue.
let budgetDit = false;
function annoncerBudget(racine, donnees) {
  const b = donnees?.budget;
  if (budgetDit || !b?.atteint || !racine.querySelector("[data-budget-atteint]")) return;
  budgetDit = true;
  toast(`Budget de rédaction du mois atteint : ${dollars(b.depense)} sur ${dollars(b.budget)}. Il revient le ${b.revient} ; d'ici là, les boutons qui en dépendent sont atténués, et la rédaction de secours du serveur répond aux PNJ et au « Précédemment ».`, "info", { duree: 9000 });
}

// Les boutons qui apparaissent sont annotés aussitôt ; tous sont repris chaque minute (le cache refroidit) et au retour sur
// l'onglet. Un seul relevé par image, quel que soit le nombre de boutons ajoutés.
export function surveillerEstimations(racine = document.body) {
  let prevu = 0;
  const tout = async (forcer) => {
    if (!racine.querySelector("[data-estimation]")) return;
    const donnees = await estimations(forcer);
    for (const el of racine.querySelectorAll("[data-estimation]")) poser(el, donnees);
    annoncerSansCle(racine);
    annoncerBudget(racine, donnees);
  };
  racine.addEventListener("click", (ev) => {
    if (!ev.target.closest?.("[data-masquer-sans-cle]")) return;
    try {
      sessionStorage.setItem(MASQUEE, "oui");
    } catch {
      // sans stockage : masquée jusqu'au prochain rendu de la page
    }
    for (const b of racine.querySelectorAll(".sans-cle-bandeau")) b.remove();
  });
  const ajoute = (n) => n.nodeType === 1 && (n.matches("[data-estimation]") || n.querySelector("[data-estimation]"));
  new MutationObserver((changements) => {
    if (prevu || !changements.some((c) => [...c.addedNodes].some(ajoute))) return;
    prevu = requestAnimationFrame(() => {
      prevu = 0;
      tout(false);
    });
  }).observe(racine, { childList: true, subtree: true });
  setInterval(() => tout(true), 60000);
  window.addEventListener("focus", () => tout(true));
  tout(false);
}
