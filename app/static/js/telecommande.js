// La télécommande du MJ : un téléphone en main, debout face aux joueurs, l'essentiel de la partie d'un pouce. Ce que
// montre la TV et ce qu'on y envoie (l'accueil, les plans de la séance, les cartons de PNJ, l'étape du feu), qui a la
// main au combat, la musique qui joue sur l'ordinateur, une ligne au journal. Tout passe par les routes de l'atelier ; la
// musique et l'étape d'un plan ouvert dans l'éditeur sont confiées à l'atelier par le relais du serveur
// (telecommande.py, relais-telecommande.js). Chaque geste dit « fait » ou « échec » ; un serveur muet est réessayé.

import "./telecommande/etat.js";
import "./telecommande/rendu.js";
import "./telecommande/gestes.js";
import "./telecommande/notes.js";

import { ecouterEtatJeu } from "./commun/etat-jeu.js";
import { monterMainsTelecommande } from "./salle/mains-telecommande.js";
import { monterJetsTelecommande } from "./jets/jets-telecommande.js";
import { LanceurMJ } from "./jets/des-mj.js";
import { brancherLaMainTv } from "./mj/main-tv.js";
import { LARGE, ONGLETS, PERIODE, S, d, relire } from "./telecommande/etat.js";
import { basculerHorloge, basculerPnj, changerEtape, changerRayon, changerSante, envoyerMusique, gesteDeLaBarre, montrerAccueil, montrerPlan, pasHorloge, passerLaMain, retirerTv, sceneSuivante } from "./telecommande/gestes.js";
import { envoyerNotes, noter } from "./telecommande/notes.js";
import { afficher, afficherMainCourante, choisirOnglet, marquerOnglets } from "./telecommande/rendu.js";

document.addEventListener("click", (ev) => {
  const o = ev.target.closest("[data-onglet]");
  if (o) return choisirOnglet(o.dataset.onglet);
  const a = ev.target.closest("[data-annonce]");
  if (a) {
    const el = document.querySelector(".annonce");
    el.hidden = true;
    if (a.dataset.annonce === "relancer") el.relancer?.();
    return;
  }
  const barre = ev.target.closest(".barre-combat [data-action]");
  if (barre) {
    if (!barre.disabled && barre.getAttribute("aria-busy") !== "true") gesteDeLaBarre(barre.dataset.action, barre);
    return;
  }
  const b = ev.target.closest("[data-geste]");
  if (!b || b.disabled || b.getAttribute("aria-busy") === "true") return;
  const g = b.dataset.geste;
  if (g === "accueil") montrerAccueil();
  else if (g === "retirer") retirerTv();
  else if (g === "plan") montrerPlan(b.dataset.plan);
  else if (g === "pnj") basculerPnj(b.dataset.pnj, b.dataset.montrer === "non" ? false : d.table?.pnj !== b.dataset.pnj);
  else if (g === "etape") changerEtape(+b.dataset.sens);
  else if (g === "rayon") changerRayon(+b.dataset.sens);
  else if (g === "scene") sceneSuivante();
  else if (g === "horloge") pasHorloge(b.dataset.horloge, +b.dataset.pas);
  else if (g === "horloge-tv") basculerHorloge(b.dataset.horloge);
  else if (g === "suivant") passerLaMain();
  else if (g === "sante") changerSante(+b.dataset.delta);
  else if (g === "musique") envoyerMusique(b.dataset.action, b.dataset.ambiance, b);
});

document.querySelector(".noter").addEventListener("submit", noter);
// Le retour du clavier envoie la ligne (une ligne du journal n'a pas de saut de ligne).
document.getElementById("note").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) noter(ev);
});

document.querySelector(".onglets").addEventListener("keydown", (ev) => {
  if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
  const k = ONGLETS.indexOf(S.onglet) + (ev.key === "ArrowRight" ? 1 : -1);
  choisirOnglet(ONGLETS[(k + ONGLETS.length) % ONGLETS.length]);
  document.querySelector(`[data-onglet="${S.onglet}"]`).focus();
});

LARGE.addEventListener("change", () => {
  marquerOnglets();
  afficherMainCourante();
});

let minuterie = 0;
function tour() {
  clearTimeout(minuterie);
  if (document.visibilityState !== "visible") return;
  relire().finally(() => {
    clearTimeout(minuterie);
    minuterie = setTimeout(tour, PERIODE);
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return clearTimeout(minuterie);
  // Au réveil du téléphone : tout est relu tout de suite, les listes si elles ont plus de quinze secondes.
  if (Date.now() - d.listesLues > 15000) d.listesLues = 0;
  tour();
});
window.addEventListener("online", () => tour());
window.addEventListener("pageshow", (ev) => ev.persisted && tour());

ecouterEtatJeu((jeu) => {
  d.jeu = jeu;
  afficher();
});
// Les mains levées depuis le coin des joueurs, au-dessus des onglets, quel que soit l'onglet (salle/).
monterMainsTelecommande(document.querySelector(".bas"));
// ---- Les jets à distance : le dernier test et « Tests », sous les mains levées (jets/). ----
monterJetsTelecommande(document.querySelector(".bas"));
// Les dés du MJ (jets/des-mj.js), au bas de l'onglet Combat : les mêmes que dans le Tableau.
new LanceurMJ(document.querySelector("#panneau-combat"), { classe: "des-mj des-mj-tc", touches: true });
marquerOnglets();
// « La reprendre ? » quand l'autre MJ a la main sur la TV (lot MJ-4, mj/main-tv.js).
brancherLaMainTv({ feuille: true });
relire({ listes: true }).finally(() => {
  minuterie = setTimeout(tour, PERIODE);
});
if (d.notes.length) envoyerNotes();
