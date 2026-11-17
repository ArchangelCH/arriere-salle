// La bible de la campagne dans le coin des joueurs : le module de l'onglet Bible de l'atelier (bible/bible.js), tel quel,
// sur la copie que l'atelier publie pour eux (bible.py : la liste blanche, passée par le masque). Le serveur ne sert que
// les clés de cet index. Fermée par le MJ, la page le dit et rien d'autre.

import { api, echapper as e } from "../api.js";
import { Bible } from "../bible/bible.js";

const page = document.getElementById("page");
const versSommaire = document.querySelector(".vers-sommaire");

function message(titre, texte) {
  page.innerHTML = `<section class="feuille-coin message-coin"><p class="kicker">La bible de la campagne</p>
    <h1>${e(titre)}</h1><p>${e(texte)}</p></section>`;
}

// Sur un téléphone, le document se lit sous le sommaire : une fois le sommaire hors de vue, un bouton y ramène.
function suivreLeSommaire() {
  const nav = page.querySelector(".bible-nav");
  if (!nav || !versSommaire || !("IntersectionObserver" in window)) return;
  const etroit = matchMedia("(max-width: 900px)");
  // Le bouton paraît dès que le sommaire est sorti de l'écran par le haut (lu à chaque défilement, et au saut vers un document).
  const regler = () => {
    versSommaire.hidden = !etroit.matches || nav.getBoundingClientRect().bottom > 160;
  };
  window.addEventListener("scroll", regler, { passive: true });
  window.addEventListener("hashchange", () => setTimeout(regler, 50));
  new IntersectionObserver(regler).observe(nav);
  regler();
  versSommaire.addEventListener("click", (ev) => {
    ev.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

async function ouvrir() {
  let index;
  try {
    // D'abord un « oui » ou un « non » (200) : une bible fermée ne laisse pas de réponse 423 dans la console.
    const etat = await api.get("/api/bible/ouverte").catch(() => null);
    if (etat && etat.ouverte === false) return message("La bible n'est pas ouverte", "Votre MJ l'ouvre quand il le souhaite : revenez un peu plus tard.");
    index = await api.get("/api/bible");
  } catch (err) {
    if (err.status === 423) return message("La bible n'est pas ouverte", "Votre MJ l'ouvre quand il le souhaite : revenez un peu plus tard.");
    if (err.status === 401 || err.status === 403) {
      // Plus connecté (mot de passe changé, nouveau lien du MJ) : comme le carnet, un lien vers la connexion.
      page.innerHTML = `<section class="feuille-coin message-coin"><p class="kicker">La bible de la campagne</p>
        <h1>Vous n'êtes plus connecté</h1><p><a href="/connexion?suite=%2Fbible">Se connecter</a> avec votre identifiant et votre mot de passe.</p></section>`;
      return;
    }
    return message("La bible ne s'ouvre pas", `Réessayez dans un instant (${err.message}).`);
  }
  const bible = new Bible(page, { parametres: new URLSearchParams(location.hash.split("?")[1] || ""), index });
  await bible.demarrer();
  suivreLeSommaire();
}

ouvrir();
