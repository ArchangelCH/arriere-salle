// Une image plein écran et le pointeur du MJ.

import { afficher, cacher } from "./ecran.js";
import { S, plein, toilePlan } from "./etat.js";
import { change, demandes, numeroter } from "./outils.js";

function montrerImage(etat) {
  if (!change("image", etat ? [etat.url, etat.titre || ""] : null)) return;
  const actuel = numeroter("image");
  const img = plein.querySelector("img");
  if (!etat) {
    img.onload = img.onerror = null;
    return cacher(plein, 900);
  }
  // Une image quittée avant d'avoir fini de charger ne s'affiche plus.
  const montrer = () => {
    if (!actuel()) return;
    plein.querySelector(".legende").textContent = etat.titre || "";
    img.classList.remove("lent");
    afficher(plein);
    img.classList.add("lent");
  };
  img.onload = montrer;
  img.onerror = () => {
    if (!actuel()) return;
    delete demandes.image;
    cacher(plein, 900);
  };
  if (img.getAttribute("src") === etat.url && img.complete && img.naturalWidth) return montrer();
  plein.classList.remove("visible");
  img.src = etat.url;
}

// ---------------------------------------------------------------- le pointeur du MJ

// La vue qui montre le plan (ou la carte) où pointe le MJ, s'il est bien à l'écran, entièrement chargé ; sinon null.
function vuePointee(msg) {
  const e = S.dernierEtat;
  if (!e) return null;
  const planVisible = toilePlan.classList.contains("visible");
  if (msg.plan) return e.vue === "plan" && e.plan === msg.plan && S.planAffiche.plan === msg.plan && S.vuePlan && planVisible ? S.vuePlan : null;
  if (msg.carte) return e.vue === "carte" && e.carte === msg.carte && S.affiche.carte === msg.carte && S.vue && !planVisible ? S.vue : null;
  return null;
}

export { montrerImage, vuePointee };
