// Ce que l'écran montre ou cache : accueil, plan, légende.

import { echapper } from "../api.js";
import { ajusterBoutique } from "./boutique.js";
import { recadrerPlan } from "./carte-plan.js";
import { S, accueil, boutiqueTv, carton, cartonHeros, cartonPnj, cartonRumeur, legendeHeros, prochaine, toilePlan } from "./etat.js";

// ---------------------------------------------------------------- fondus

// Chaque passage est numéroté : la fin d'un retrait ne cache pas un élément remontré entre-temps.
const passages = new Map();

function afficher(el) {
  passages.set(el, (passages.get(el) || 0) + 1);
  el.hidden = false;
  void el.offsetWidth; // l'état de départ, transparent, est calculé : le fondu part de lui
  el.classList.add("visible");
  majCorps();
}

function cacher(el, delai = 800) {
  const n = (passages.get(el) || 0) + 1;
  passages.set(el, n);
  el.classList.remove("visible");
  majCorps();
  setTimeout(() => {
    if (passages.get(el) === n) el.hidden = true;
  }, delai);
}

// Ce que :has() ferait sur un navigateur récent : l'accueil et la rumeur se rangent autour des cartons présents. La
// boutique laisse la place au carton d'un PNJ (son marchand, souvent) : elle se remesure quand il paraît ou s'en va.
function majCorps() {
  const pnj = cartonPnj.classList.contains("visible");
  const bouge = document.body.classList.contains("avec-pnj") !== pnj;
  document.body.classList.toggle("avec-pnj", pnj);
  document.body.classList.toggle("avec-heros", cartonHeros.classList.contains("visible"));
  // Lot G : le coin des réserves s'efface sous la rumeur et le carton d'un lieu (table.css).
  document.body.classList.toggle("avec-carton", cartonRumeur.classList.contains("visible") || carton.classList.contains("visible"));
  if (document.body.classList.contains("avec-rumeur") !== cartonRumeur.classList.contains("visible")) {
    document.body.classList.toggle("avec-rumeur", cartonRumeur.classList.contains("visible"));
    majBasRumeur();
  }
  if (bouge && boutiqueTv.classList.contains("visible")) ajusterBoutique();
}
// L'échoppe glisse (0,7 s) quand ce carton paraît ou s'en va : mesurée au départ, elle se range de nouveau à l'arrivée,
// sans quoi ses étagères débordent sous le carton du marchand.
boutiqueTv.querySelector(".echoppe").addEventListener("transitionend", (ev) => {
  if (ev.propertyName === "right" && ev.target === ev.currentTarget && boutiqueTv.classList.contains("visible")) ajusterBoutique();
});

function montrerAccueil(oui) {
  accueil.classList.toggle("visible", oui);
}

// Table publique fermée : un écran venu d'Internet ne reçoit que l'accueil, avec la date de la prochaine séance.
function montrerProchaine(quand) {
  prochaine.textContent = quand ? `Prochaine séance : ${quand}` : "";
  prochaine.hidden = !quand;
}

// La carte et le plan se relaient : celui des deux qui est caché rend ses tuiles et cesse de se dessiner.
function montrerPlanTv(oui) {
  toilePlan.classList.toggle("visible", oui);
  majBasRumeur();
  if (!oui) S.basLegende = 0; // un plan qui revient mesure de nouveau sa légende
  if (oui) S.vue.alleger();
  else if (S.vuePlan) S.vuePlan.alleger(); // la vue annoncera de nouveau sa légende au réveil
  montrerLegende(oui ? S.legende : []);
}

// Deux héros collés n'ont plus la place d'écrire leur prénom sous le pion : la légende, en bas du plan, donne la couleur
// et le prénom de chaque héros à l'écran. La vue du plan tient la liste (vide quand chaque prénom tient) ; elle ne se
// montre qu'avec le plan.
function montrerLegende(liste) {
  S.legende = liste;
  const visible = legendeHeros.classList.contains("visible");
  if (!S.legende.length || !toilePlan.classList.contains("visible")) {
    if (visible) cacher(legendeHeros, 600);
    majBasRumeur();
    return;
  }
  legendeHeros.innerHTML = S.legende.map((h) => `<li><span class="pastille" style="background:${echapper(h.couleur)}"></span>${echapper(h.nom)}</li>`).join("");
  if (!visible) afficher(legendeHeros);
  majBasLegende();
  majBasRumeur();
}

// La place de la légende, en bas : le plan se recadre au-dessus d'elle, et elle ne couvre plus les pions du bas. Mesurée
// hors de l'image en cours (la vue du plan annonce sa légende pendant qu'elle se dessine). Sur un même plan, la place
// gardée ne rétrécit pas : des héros qui s'écartent puis se rapprochent ne font pas battre le cadrage.
function majBasLegende() {
  setTimeout(() => {
    const haut = legendeHeros.classList.contains("visible") && S.legende.length ? legendeHeros.offsetHeight + 0.024 * window.innerHeight : 0;
    const part = Math.min(0.25, haut / Math.max(1, window.innerHeight));
    if (part <= S.basLegende + 0.005) return;
    S.basLegende = part;
    recadrerPlan(700);
  }, 0);
}

// La rumeur se pose au bas de l'écran, sur la légende des héros s'il y en a une : elle monte au-dessus d'elle (--bas-legende),
// et le plan se recadre au-dessus de la rumeur pour que ses pions ne disparaissent pas dessous.
function majBasRumeur() {
  setTimeout(() => {
    const legende = legendeHeros.classList.contains("visible") && S.legende.length ? legendeHeros.offsetHeight + 0.024 * window.innerHeight : 0;
    document.body.style.setProperty("--bas-legende", `${Math.round(legende)}px`);
    const visible = cartonRumeur.classList.contains("visible") && toilePlan.classList.contains("visible");
    const haut = visible ? cartonRumeur.offsetHeight + (parseFloat(getComputedStyle(cartonRumeur).bottom) || 0) + 0.02 * window.innerHeight : 0;
    const part = Math.min(0.45, haut / Math.max(1, window.innerHeight));
    if (Math.abs(part - S.basRumeur) < 0.005) return;
    S.basRumeur = part;
    recadrerPlan(700);
  }, 0);
}

// L'écran change de taille (fenêtre, rotation) : les places du bas (légende, rumeur) se remesurent.
function remesurerEcran() {
  S.basLegende = 0;
  majBasLegende();
  majBasRumeur();
}

export { afficher, cacher, majBasRumeur, remesurerEcran, montrerAccueil, montrerLegende, montrerPlanTv, montrerProchaine };
