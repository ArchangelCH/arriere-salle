// Les réglages du décor dans le panneau de l'éditeur de plans : la teinte d'un meuble ou du sol d'une pièce (un
// nuancier de teinturier, une couleur libre, « d'origine »), la matière des murs d'une pièce, la lumière du plan.
// Du HTML seulement : l'éditeur reçoit les clics (data-teinte, data-lumiere) et les saisies (data-teinte-libre).

import { echapper as e } from "../api.js";
import { LUMIERES, MURS, TEINTES, lumiereValide, murValide, teinteValide } from "./modele.js";

// cible : « meuble » ou « piece » ; valeur : la teinte posée, ou rien ; defaut : ce que dit « d'origine ».
export function htmlTeintes(cible, valeur, titre, defaut = "D'origine") {
  const t = teinteValide(valeur);
  return `
    <div class="champ teintes" role="radiogroup" aria-label="${e(titre)}">
      <span class="lbl">${e(titre)}</span>
      <div class="nuancier">
        <button class="teinte-origine" role="radio" aria-checked="${!t}" data-teinte="${cible}" data-valeur="" title="${e(defaut)}">${e(defaut)}</button>
        ${TEINTES.map(([c, nom]) => `<button class="pastille-teinte" role="radio" aria-checked="${t === c}" data-teinte="${cible}" data-valeur="${c}" title="${e(nom)}" aria-label="${e(nom)}" style="background:${c}"></button>`).join("")}
        <label class="teinte-libre" title="Une autre couleur"><input type="color" data-teinte-libre="${cible}" value="${t || "#8e2a20"}" aria-label="Une autre couleur"><span>Autre</span></label>
      </div>
    </div>`;
}

export function htmlMurs(valeur) {
  const m = murValide(valeur);
  return `<label class="champ">Murs<select data-el="mur">${MURS.map(([v, n]) => `<option value="${v}" ${v === m ? "selected" : ""}>${e(n)}</option>`).join("")}</select></label>`;
}

// La lumière du plan (style peint). Sans réglage, celle de l'habillage s'il y en a un, sinon le crépuscule d'avant.
export function htmlLumiere(p) {
  const l = lumiereValide(p.lumiere);
  const hab = p.habillage && typeof p.habillage === "object" ? p.habillage.heure || "soir" : null;
  const avant = { jour: "jour", soir: "crepuscule", nuit: "nuit" }[hab] || "crepuscule";
  return `
    <h3>Lumière</h3>
    <div class="segments large lumieres" role="group" aria-label="Lumière du plan">${LUMIERES.map(([v, n]) => `<button data-lumiere="${v}" aria-pressed="${(l || avant) === v}">${n}</button>`).join("")}</div>
    <p class="aide">${l ? `Réglée pour ce plan, dans le style Peint, sur la TV comme ici.${hab ? " Elle passe avant l'heure de l'habillage." : ""} <button class="lien" data-lumiere="">${hab ? "Revenir à l'heure de l'habillage" : "Revenir au crépuscule d'origine"}</button>` : `${hab ? "Celle de l'heure de l'habillage" : "Le crépuscule d'origine"}, dans le style Peint. Torches : la nuit noire d'un souterrain, où seuls les feux posés éclairent (cheminées, braseros, torches au mur, candélabres).`}</p>`;
}
