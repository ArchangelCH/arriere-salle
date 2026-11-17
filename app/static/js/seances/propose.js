// Les marques « proposé » d'une séance préparée à la clôture de la précédente (seance-suivante.js) : une scène ou une
// ligne de « Sous la main » que le MJ garde ou retire d'un clic. Ce qu'elles portent vit dans la séance :
// la ligne du déroulé a son champ propose (la raison), les lignes de « Sous la main » sont rangées dans
// suite.proposes[genre][id]. Garder efface la marque, rien d'autre.

import { echapper as e } from "../api.js";

export const GENRES_PROPOSES = ["pnj", "lieux", "contrats", "rumeurs"];

export function proposesDe(s, genre) {
  const p = s?.suite?.proposes?.[genre];
  return p && typeof p === "object" ? p : {};
}

export const raisonProposee = (s, genre, id) => {
  const r = proposesDe(s, genre)[id];
  return typeof r === "string" ? r : "";
};

// Préparer : en tête d'une scène proposée.
export function htmlMarqueScene(d, i) {
  if (!d?.propose) return "";
  return `
          <p class="marque-proposee"><span class="etiquette">Proposée</span><i>${e(typeof d.propose === "string" ? d.propose : "")}</i>
            <span class="boutons"><button type="button" data-suite="garder" data-genre="scene" data-i="${i}">Garder</button><button type="button" class="lien-danger" data-suite="retirer" data-genre="scene" data-i="${i}">Retirer</button></span></p>`;
}

// Préparer, dans une rubrique de « Sous la main » : les lignes proposées, sous les puces de ce que le MJ a gardé.
// entrees : [{ id, fiche, libelle, lien }].
export function htmlProposes(s, genre, entrees) {
  if (!entrees.length) return "";
  return `
        <div class="proposes">
          <p class="tete-proposes"><span class="etiquette">Proposés</span>${entrees.length > 1 ? `<button type="button" data-suite="tout-garder" data-genre="${genre}">Tout garder</button>` : ""}</p>
          <ul>${entrees.map((x) => `
            <li><a href="${e(x.lien)}">${e(x.libelle)}</a><i>${e(raisonProposee(s, genre, x.id))}</i>
              <span class="boutons"><button type="button" data-suite="garder" data-genre="${genre}" data-id="${e(x.id)}">Garder</button><button type="button" class="lien-danger" data-suite="retirer" data-genre="${genre}" data-id="${e(x.id)}">Retirer</button></span></li>`).join("")}
          </ul>
        </div>`;
}
