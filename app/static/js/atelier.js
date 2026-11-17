import "./atelier/etat.js";
import "./atelier/cartes.js";
import "./atelier/pages.js";
import "./atelier/routeur.js";

import { partance, rattraperEnvois } from "./api.js";
import { poserLienCorbeille } from "./corbeille/corbeille-page.js";
import { demarrerPastilleDemandes } from "./demandes/boite.js";
import { installerRangeeDegats } from "./commun/degats-doigt.js";
import { ouvrirNoteRapide } from "./idees/idees.js";
import { JournalRapide } from "./seances/journal.js";
import { ReglesRapides } from "./regles/rapide.js";
import { surveillerEstimations } from "./commun/estimation.js";
import { Musique } from "./musique/musique.js";
import { installerRecherche } from "./chercher/chercher.js";
import { ajouterLienAtelier } from "./commun/liens-atelier.js";
import { reessaisEnAttente, relancerTout } from "./commun/reessai.js";
import { demarrerRelais } from "./ecran-tv/relais-telecommande.js";
import { Tableau } from "./tableau/tableau.js";
import { demarrerTemoin } from "./ecran-tv/temoin-tv.js";
import { brancherLaMainTv } from "./mj/main-tv.js";
import { suivreEtatsDesJoueurs } from "./mj/etats-joueurs.js";
import { installerTouches } from "./commun/touches.js";
import { S, barreOnglets } from "./atelier/etat.js";
import { router } from "./atelier/routeur.js";

// Onglet fermé, rechargé ou passé en arrière-plan (iPad) : ce qui attend encore d'être enregistré part tout de suite,
// les envois ratés compris.
function partir() {
  partance(true);
  try {
    S.courant?.vider?.();
    relancerTout();
  } catch {
    // rien à faire de plus : la page se ferme
  }
  setTimeout(() => partance(false), 1000);
}
window.addEventListener("pagehide", partir);
// Fermer ou recharger l'onglet avec quelque chose qui n'est pas enregistré (envoi raté compris, même d'une page déjà
// quittée) : le navigateur demande confirmation.
window.addEventListener("beforeunload", (ev) => {
  if (!reessaisEnAttente() && !S.courant?.aEnregistrer?.()) return;
  ev.preventDefault();
  ev.returnValue = "";
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") partir();
});

// Un envoi resté en suspens à la dernière fermeture (api.js) repart avant la première page, qui lit alors la bonne fiche.
rattraperEnvois().finally(() => {
  window.addEventListener("hashchange", router);
  router();
});

document.querySelector(".noter-idee")?.addEventListener("click", () => ouvrirNoteRapide());

new JournalRapide(document.querySelector(".entete"));

// Les règles maison, touche R depuis n'importe quelle page (regles/rapide.js).
new ReglesRapides();

new Musique(document.querySelector(".entete"));

new Tableau(document.querySelector(".entete"));

// Les réglages, puis la corbeille, par de petits liens à côté du nom de l'atelier (reglages/reglages.js, corbeille-page.js).
ajouterLienAtelier({ libelle: "Réglages", href: "#/reglages", titre: "Les paramètres de l'atelier, du coin des joueurs et de la table, et les accès" });
poserLienCorbeille();
// Les demandes des joueurs, à côté du témoin de la TV : la pastille s'allume dès qu'un joueur écrit (demandes/boite.js).
demarrerPastilleDemandes(document.querySelector(".pastille-demandes"));
// Ce que voit la TV, à côté de Tableau, sur toutes les pages (temoin-tv.js).
demarrerTemoin(document.querySelector(".entete"));
brancherLaMainTv();
// Un joueur qui règle la Santé, la Psy ou la posture de son héros depuis le coin : une ligne, et les écrans relisent.
suivreEtatsDesJoueurs();
// La carte des touches (« ? »), les touches T et I, le pied du Tableau et Échap partout pareil (touches.js, echap.js).
installerTouches({ barre: barreOnglets });
// « Chercher » au bout de la seconde ligne de l'en-tête, touche « / » ou ⌘K (chercher/chercher.js).
installerRecherche(document.querySelector(".entete"));

// La télécommande du téléphone confie la musique et les étapes du feu à cet écran (relais-telecommande.js).
demarrerRelais();

// Prix et attente probables sur chaque bouton qui appelle l'API (estimation.js).
surveillerEstimations();

// Au doigt, toucher le chiffre de Santé ouvre la rangée des coups et des soins (degats-doigt.js).
installerRangeeDegats();
