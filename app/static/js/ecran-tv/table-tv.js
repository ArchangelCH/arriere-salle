// L'onglet Table lit la TV comme le témoin de l'en-tête (etat-tv.js) : « En ce moment » nomme ce qui est vraiment à
// l'écran (un carton de PNJ compris), les écrans branchés suivent, et les boutons des cartes et des plans portent le
// liseré or et « À la TV » tant que la TV les montre. Tout s'arrête seul quand la page est quittée.

import { echapper as e } from "../api.js";
import { ecouterTv, phraseTv } from "./etat-tv.js";
import { parLaMain } from "../mj/main-tv.js";

const branches = (n) => (n ? `${n} écran${n > 1 ? "s" : ""} branché${n > 1 ? "s" : ""}` : "aucun écran branché");

// Le bouton d'une carte ou d'un plan de la liste : « Montrer à la TV », ou « À la TV » et « Retirer de la TV ».
export function peindreBoutonListe(b, ici) {
  b.classList.toggle("bouton-tv", true);
  b.classList.toggle("montree", ici);
  b.setAttribute("aria-pressed", String(ici));
  b.innerHTML = ici ? '<span class="tv-etat">À la TV</span><span class="tv-geste">Retirer de la TV</span>' : '<span class="tv-geste">Montrer à la TV</span>';
}

export function suivreTvSurLaPage(page, { publique = { ouverte: true } } = {}) {
  const dit = page.querySelector("[data-tv-dit]");
  const ecrans = page.querySelector("[data-ecrans-dit]");
  const fin = ecouterTv((t, d) => {
    if (!dit || !dit.isConnected) return fin();
    // « par : Léa » quand l'autre MJ y a la main ; sans invité, jamais.
    const par = parLaMain(t);
    dit.innerHTML = `La TV montre <strong>${e(phraseTv(d))}</strong>.${par ? ` <span class="par-tv">${e(par)}</span>` : ""}${d.noire && !d.cartons.length ? " Rien n'y est révélé : les joueurs voient un écran noir." : ""}`;
    if (ecrans) {
      ecrans.innerHTML = `<strong>Au salon : ${branches(d.ecransSalon)}.</strong>
            Sur Internet : ${branches(d.ecransInternet)}${d.ecransInternet && !publique.ouverte ? ", qui ne voient que l'accueil" : ""}.`;
    }
    for (const b of page.querySelectorAll("[data-montrer-plan]")) peindreBoutonListe(b, t.vue === "plan" && t.plan === b.dataset.montrerPlan);
    for (const b of page.querySelectorAll("[data-montrer]")) peindreBoutonListe(b, t.vue === "carte" && t.carte === b.dataset.montrer);
  });
  return fin;
}
