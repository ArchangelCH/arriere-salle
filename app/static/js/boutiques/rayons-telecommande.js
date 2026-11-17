// Les rayons d'une boutique trop grande pour un écran, sur la télécommande (E07) : − et +, comme les étapes du feu, et
// le nom du rayon à l'écran. Les pages sont celles de la TV et de l'atelier (rayons-tv.js).

import { echapper as e } from "../api.js";
import { articlesDeLaTv, pageDemandee, pagesEchoppe } from "./rayons-tv.js";

const RELIRE = 6000; // la boutique montrée, relue au plus toutes les six secondes

// La boutique que montre la TV, avec ses pages ; null si la TV montre autre chose. avant : la dernière lue.
export async function lireBoutiqueMontree(api, t, avant) {
  if (!(t?.vue === "boutique" && t.boutique)) return null;
  if (avant?.id === t.boutique && Date.now() - avant.lu < RELIRE) return avant;
  try {
    // La boutique de l'autre MJ (deux MJ) arrive sous son jeton : lue comme la TV la lit.
    const jeton = Array.isArray(t.jetons) && t.jetons.includes("boutique");
    const b = await api.get(`/api/${jeton ? "table/boutique" : "boutiques"}/${encodeURIComponent(t.boutique)}`);
    return { id: jeton ? t.boutique : b.id, nom: b.nom || "", pages: pagesEchoppe(articlesDeLaTv(b.articles)), lu: Date.now() };
  } catch {
    return avant?.id === t.boutique ? avant : null;
  }
}

// Le rayon voulu après un pas (−1, +1), ou null s'il n'y en a pas.
export function rayonApres(boutique, t, sens) {
  if (!boutique || boutique.pages.length < 2 || t?.boutique !== boutique.id) return null;
  const i = pageDemandee(boutique.pages, t.rayon) + sens;
  return i >= 0 && i < boutique.pages.length ? i : null;
}

export function htmlRayons(boutique, t, occupe = "") {
  if (!boutique || boutique.pages.length < 2 || t?.vue !== "boutique" || t.boutique !== boutique.id) return "";
  const n = boutique.pages.length;
  const i = pageDemandee(boutique.pages, t.rayon);
  return `
    <div class="rayons-tc" role="group" aria-label="Rayons de l'échoppe">
      <p class="kicker">Rayons de l'échoppe</p>
      <div class="pas">
        <button type="button" class="touche carree" data-geste="rayon" data-sens="-1" aria-label="Rayon précédent" ${i <= 0 ? "disabled" : ""}${occupe}>−</button>
        <p class="compte"><b>${i + 1}</b><small>sur ${n}</small></p>
        <button type="button" class="touche carree" data-geste="rayon" data-sens="1" aria-label="Rayon suivant" ${i >= n - 1 ? "disabled" : ""}${occupe}>+</button>
      </div>
      <p class="nom-etape">${e(boutique.pages[i].nom)}</p>
    </div>`;
}
