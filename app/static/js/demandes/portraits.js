// Les portraits des joueurs dans la boîte du MJ : l'image qu'un joueur envoie (« Portrait envoyé », à accepter ou
// refuser) ou le portrait qu'il a choisi parmi ceux de son héros (« Changer de portrait », appliqué seul, à annuler au
// besoin). L'image vient de l'atelier (portraits_mj.py), qui la trouve par la demande ; la version la fait relire.

import { echapper as e } from "../api.js";

export const GENRES_PORTRAIT = ["portrait", "portrait-choisi"];

export function htmlImagePortrait(x, { petite = false } = {}) {
  const src = `/api/portraits-joueurs/${encodeURIComponent(x.joueur)}/${encodeURIComponent(x.id)}/image?v=${encodeURIComponent(x.version)}`;
  return `<figure class="portrait-demande${petite ? " petite" : ""}">
    <img src="${e(src)}" alt="${e(x.genre === "portrait" ? "L'image envoyée par le joueur" : "Le portrait choisi par le joueur")}" loading="lazy" decoding="async">
    ${!petite && x.phrase ? `<figcaption>${e(x.phrase)}</figcaption>` : ""}
  </figure>`;
}
