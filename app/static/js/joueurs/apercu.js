// « Voir comme Léa » (d27), une page de l'atelier : le carnet et l'échoppe d'un joueur, dessinés par les mêmes modules
// que son coin (carnet-vue.js, echoppe.js), avec ce que l'atelier lui publie (/api/joueurs/<id>/apercu). Lecture seule :
// ni panier, ni commande, ni rien qui parte vers le coin des joueurs.

import { echapper as e } from "../api.js";
import { afficherCarnet, demander, pageErreur, pageFermee, vueDuHash } from "./carnet-vue.js";
import { Echoppe } from "./echoppe.js";

const page = document.getElementById("page");
const bandeau = document.querySelector(".bandeau-apercu");
const joueur = new URLSearchParams(location.search).get("joueur") || "";
let donnees = null;

const refus = () => Promise.reject(Object.assign(new Error("aperçu du MJ, rien ne part d'ici"), { status: 0 }));
const echoppe = new Echoppe(page, {
  demander: (methode, url) => (methode === "GET" && url === "/api/echoppe" ? Promise.resolve(donnees.echoppe) : refus()),
  pageErreur: (err) => pageErreur(page, err),
  pageFermee: () => pageFermee(page, donnees?.carnet?.prochaine),
  lectureSeule: true,
});

// Ce que son compte lui ouvre aujourd'hui, en une phrase.
function ceQueVoitLeLien(d) {
  const qui = d.joueur;
  if (d.etat === "invite") return `Le coin de ${qui} ouvre l'accueil du créateur : il n'a encore rien commencé.`;
  if (["en-cours", "envoye", "retouche"].includes(d.etat)) return `Le coin de ${qui} ouvre son créateur d'aventurier${d.etat === "en-cours" ? "" : ", déjà envoyé au MJ"}.`;
  if (d.carnet.absent || d.etat === "relie-perdu") return `Le héros de ${qui} n'est plus à la tablée : son coin le lui dit.`;
  return d.ouvert ? `Le coin de ${qui} ouvre ce carnet, sur sa fiche.` : `Le coin de ${qui} lui dit que son héros est à la tablée, et que le carnet s'ouvre entre les séances.`;
}

function peindreBandeau(d) {
  document.title = `Voir comme ${d.joueur} · L'Arrière-salle`;
  bandeau.innerHTML = `
    <p><b>Aperçu du MJ</b> : ce que voit ${e(d.joueur)} dans son coin. Rien ne s'écrit d'ici, ni panier ni commande.</p>
    <p class="aide">${d.ouvert ? "" : "<b>Le carnet est fermé</b> : voici ce qu'il lira quand vous l'ouvrirez (Réglages, Coin des joueurs). "}${e(ceQueVoitLeLien(d))}</p>`;
}

async function montrer() {
  const boutiques = location.hash.startsWith("#boutique");
  const { vue, ancre } = vueDuHash(location.hash);
  const courant = boutiques ? "boutiques" : vue;
  for (const a of document.querySelectorAll(".onglets-coin [data-vue]")) a.setAttribute("aria-current", String(a.dataset.vue === courant));
  if (boutiques) return echoppe.afficher(location.hash.slice(1));
  echoppe.quitter();
  afficherCarnet(page, donnees.carnet, vue, ancre);
}

async function demarrer() {
  try {
    donnees = await demander("GET", `/api/joueurs/${encodeURIComponent(joueur)}/apercu`);
  } catch (err) {
    bandeau.innerHTML = "<p><b>Aperçu du MJ</b></p>";
    page.innerHTML = `<section class="feuille-coin message-coin"><p class="kicker">Aperçu du MJ</p><h1>Aperçu impossible</h1>
      <p>${err.status === 404 ? "Ce joueur n'est plus invité." : `Réessayez dans un instant (${e(err.message)}).`}</p></section>`;
    return;
  }
  peindreBandeau(donnees);
  await montrer();
}

window.addEventListener("hashchange", () => {
  window.scrollTo(0, 0);
  if (donnees) montrer();
});
demarrer();
