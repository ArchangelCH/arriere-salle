// Le coin des joueurs : le créateur d'aventurier de l'atelier, en mode joueur (son seul aventurier, rien du MJ).

import { echapper as e, partance } from "../api.js";
import { Createur } from "../aventuriers/createur.js";
import { reessaisEnAttente, relancerTout } from "../commun/reessai.js";
import "./pied-coin.js";
import { bandeauPause } from "./demandes.js";

const page = document.getElementById("page");
const createur = new Createur(page, { parametres: new URLSearchParams(location.hash.slice(1)), joueur: true });
// « Coin en pause » : le bandeau dit pourquoi rien ne s'enregistre (la fiche attend, et part seule à la réouverture).
bandeauPause();

createur.demarrer().catch((err) => {
  const perdu = err.status === 401 || err.status === 403;
  page.innerHTML = `<section class="page-liste"><header class="titre-page"><p class="kicker">Le coin des joueurs</p>
    <h1>${perdu ? "Vous n'êtes plus connecté" : "Fiche impossible à ouvrir"}</h1>
    <p class="chapo">${perdu ? '<a href="/connexion">Se connecter</a> avec votre identifiant et votre mot de passe.' : `Réessayez dans un instant (${e(err.message)}).`}</p></header></section>`;
});

// Onglet fermé ou passé en arrière-plan (téléphone) : ce qui attend encore d'être enregistré part tout de suite.
function partir() {
  partance(true);
  try {
    createur.vider();
    relancerTout();
  } catch {
    // la page se ferme
  }
  setTimeout(() => partance(false), 1000);
}
window.addEventListener("pagehide", partir);
// Fermer l'onglet avec une saisie qui n'est pas enregistrée (envoi raté compris) : le navigateur demande confirmation.
window.addEventListener("beforeunload", (ev) => {
  if (!reessaisEnAttente() && !createur.aEnregistrer()) return;
  ev.preventDefault();
  ev.returnValue = "";
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") partir();
});
