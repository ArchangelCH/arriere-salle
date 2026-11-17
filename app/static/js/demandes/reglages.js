// Page Réglages (section Coin des joueurs) : les deux réglages du coin. « Coin en pause » fige toute écriture des
// joueurs (ils lisent toujours, et voient pourquoi rien ne part) ; « Me prévenir sur Telegram » dit au MJ, en un
// message par vague, qui a demandé quoi (le prénom et le genre de la demande, jamais le texte du joueur). Le serveur
// garde les deux (/api/demandes/reglages, boite.py).

import { api, toast } from "../api.js";
import { ecouterDemandes } from "../ecran-tv/canal-table.js";

export function ajouterBlocCoin(grille) {
  if (!grille) return;
  const bloc = document.createElement("div");
  bloc.className = "bloc bloc-coin-joueurs";
  grille.append(bloc);
  let etat = null;
  const dessiner = () => {
    const pause = Boolean(etat?.pause);
    const telegram = etat?.telegram !== false;
    bloc.innerHTML = `
      <h2>Ouvert ou en pause</h2>
      <div class="choix-publique choix-pause" role="group" aria-label="Coin des joueurs">
        <button type="button" data-pause="non" aria-pressed="${!pause}">Ouvert</button>
        <button type="button" data-pause="oui" aria-pressed="${pause}">En pause</button>
      </div>
      <p>${pause
        ? "En pause : les joueurs lisent leur carnet, mais rien de ce qu'ils écrivent ne part (un mot, une commande, leur aventurier). Ils voient que le coin est en pause."
        : "Ouvert : les joueurs vous écrivent depuis leur téléphone, passent commande et vous envoient leur aventurier."}</p>
      <h3>Me prévenir sur Telegram</h3>
      <div class="choix-publique choix-telegram" role="group" aria-label="Me prévenir sur Telegram">
        <button type="button" data-telegram="oui" aria-pressed="${telegram}">Oui</button>
        <button type="button" data-telegram="non" aria-pressed="${!telegram}">Non</button>
      </div>
      <p class="aide">${etat && !etat.telegram_configure
        ? "Telegram n'est pas encore branché sur le serveur : rien ne part pour l'instant, la pastille « Demandes » de l'en-tête suffit."
        : "Un message par vague, douze par heure au plus : le prénom du joueur et ce qu'il demande, jamais son texte ni le nom de son héros."}</p>
      <p><a href="#/demandes">Ouvrir les demandes des joueurs</a></p>`;
  };
  const lire = () => api.get("/api/demandes/reglages").then((r) => { etat = r; dessiner(); }).catch(() => {
    bloc.innerHTML = '<h2>Ouvert ou en pause</h2><p class="aide">Les réglages ne se lisent pas pour l\'instant.</p>';
  });
  dessiner();
  lire();
  // Un autre écran (l'iPad) a changé la pause : ce bloc le montre aussitôt.
  const fin = ecouterDemandes((r) => {
    if (!bloc.isConnected) return fin();
    if (etat && r.pause !== etat.pause) lire();
  });
  bloc.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-pause], [data-telegram]");
    if (!b || b.getAttribute("aria-pressed") === "true") return;
    const corps = b.dataset.pause ? { pause: b.dataset.pause === "oui" } : { telegram: b.dataset.telegram === "oui" };
    try {
      etat = await api.put("/api/demandes/reglages", corps);
      dessiner();
      toast("pause" in corps
        ? corps.pause ? "Coin en pause : les joueurs ne peuvent plus rien écrire." : "Coin rouvert : les joueurs peuvent de nouveau écrire."
        : corps.telegram ? "Telegram vous préviendra des demandes des joueurs." : "Telegram ne vous préviendra plus.");
    } catch (err) {
      toast(`Réglage non enregistré : ${err.message}`, "erreur");
    }
  });
}
