// Le menu des lumières dans le panneau de l'éditeur de plans (outil « Lumières », touche O) : le type à poser, la liste
// des sources du plan (allumer, éteindre, cacher, choisir), les réglages de la lumière choisie, et l'ambiance du plan.
// Du HTML seulement : l'éditeur reçoit les clics (data-lum) et les saisies (data-el sur la lumière choisie, data-amb).
// La logique (poser, régler, allumer) est dans lumieres.js.

import { echapper as e } from "../api.js";
import { AMBIANCES } from "./peint.js";
import { htmlLumiere } from "./reglages-decor.js";
import {
  INTENSITE, LUMIERES_MAX, NUANCES, RAYON, TYPES_LUMIERE, allumee, compter, couleurValide, lumieresDe, nomsDesLumieres, typeDe,
} from "./lumieres.js";

const virgule = (x) => String(Math.round(x * 10) / 10).replace(".", ",");

// Les réglages d'une lumière choisie : type, nom (note du MJ), couleur, portée, intensité, allumée, cachée.
export function htmlLumiereChoisie(l) {
  const couleur = couleurValide(l.couleur);
  const t = typeDe(l.type);
  return `
    <section class="lumiere-choisie" aria-label="Lumière choisie">
      <h3>Cette lumière</h3>
      <p class="aide">Glissez son repère sur le plan pour la déplacer ; elle éclaire sa pièce, sans traverser les murs.</p>
      <label class="champ">Type<select data-el="type">${TYPES_LUMIERE.map(([c, n]) => `<option value="${c}" ${(t ? l.type : "libre") === c ? "selected" : ""}>${e(n)}</option>`).join("")}</select></label>
      <label class="champ secret">Nom (note du MJ, jamais sur la TV)<input type="text" maxlength="80" data-el="source" value="${e(l.source || "")}" placeholder="la torche du couloir, le lustre…"></label>
      <div class="champ teintes" role="group" aria-label="Couleur de la lumière">
        <span class="lbl">Couleur</span>
        <div class="nuancier">
          ${NUANCES.map(([c, n]) => `<button type="button" class="pastille-teinte" aria-pressed="${couleur === c}" data-lum="couleur" data-valeur="${c}" title="${e(n)}" aria-label="${e(n)}" style="background:${c}"></button>`).join("")}
          <label class="teinte-libre" title="Une autre couleur"><input type="color" data-el="couleur" value="${e(couleur)}" aria-label="Une autre couleur"><span>Autre</span></label>
        </div>
      </div>
      <label class="champ">Portée en cases <output>${virgule(+l.rayon || 3)}</output><input type="range" min="${RAYON.min}" max="${RAYON.max}" step="0.1" data-el="rayon" value="${e(+l.rayon || 3)}"></label>
      <label class="champ">Intensité <output>${virgule(+l.intensite || 0.8)}</output><input type="range" min="${INTENSITE.min}" max="${INTENSITE.max}" step="0.05" data-el="intensite" value="${e(+l.intensite || 0.8)}"></label>
      <label class="case"><input type="checkbox" data-el="allumee" ${allumee(l) ? "checked" : ""}> Allumée</label>
      <label class="case"><input type="checkbox" data-el="cache" ${l.cache ? "checked" : ""}> Cachée aux joueurs (leur lumière n'existe pas pour eux)</label>
      <div class="actions"><button type="button" data-lum="dupliquer">Dupliquer</button><button type="button" class="danger" data-action="supprimer-selection">Retirer</button></div>
    </section>`;
}

// Un petit témoin à la couleur de la lumière : plein si elle est allumée, vide si elle est éteinte.
const temoin = (l) => `<span class="temoin-lumiere" data-eteinte="${!allumee(l)}" style="--lum:${couleurValide(l.couleur)}" aria-hidden="true"></span>`;

// Le panneau de l'outil. plan : le plan ; choisie : l'élément de la lumière choisie (ou rien) ; type : le type à poser ;
// peint : le style Peint est celui de l'éditeur (le seul qui dessine les lumières).
export function htmlLumieres(plan, { choisie = null, type = "torche", peint = false, apercu = false } = {}) {
  const liste = lumieresDe(plan);
  const noms = new Map(nomsDesLumieres(plan).map((n) => [n.id, n.nom]));
  const c = compter(plan);
  const hab = plan.habillage && typeof plan.habillage === "object" ? plan.habillage : null;
  const amb = hab ? (hab.ambiance && typeof hab.ambiance === "object" ? hab.ambiance : AMBIANCES[hab.heure] || AMBIANCES.soir) : null;
  return `
    <h2>Lumières</h2>
    ${peint ? "" : `<p class="aide alerte-lumiere" role="status">Les lumières ne se dessinent que dans le style Peint (celui de la TV pour cette ambiance). <button type="button" class="lien" data-lum="peint">Passer en Peint</button></p>`}
    ${apercu ? '<p class="aide">Une proposition d\'habillage est affichée : gardez-la ou écartez-la avant de poser des lumières.</p>' : ""}
    <h3>Poser une lumière</h3>
    <p class="aide">Choisissez un type, puis cliquez sur le sol d'une pièce. Le type donne la couleur, la portée et l'intensité d'origine, que vous réglez ensuite.</p>
    <div class="palette types-lumiere" role="radiogroup" aria-label="Type de lumière à poser">${TYPES_LUMIERE.map(([k, n, r]) => `<button type="button" role="radio" aria-checked="${type === k}" data-opt-bouton="lumiere.type" data-valeur="${k}"><span class="pastille" style="background:${r.couleur}"></span>${e(n)}</button>`).join("")}</div>
    <h3>Lumières du plan <span class="secret">${c.total ? `${c.allumees} allumée${c.allumees > 1 ? "s" : ""} sur ${c.total}${c.cachees ? `, ${c.cachees} cachée${c.cachees > 1 ? "s" : ""}` : ""}` : "aucune"}</span></h3>
    ${liste.length ? `
      <div class="actions"><button type="button" data-lum="tout-allumer" ${c.allumees === c.total ? "disabled" : ""}>Tout allumer</button><button type="button" data-lum="tout-eteindre" ${c.allumees === 0 ? "disabled" : ""}>Tout éteindre</button></div>
      <ul class="liste-lumieres">${liste.map((l) => `
        <li data-choisie="${choisie?.id === l.id}" data-eteinte="${!allumee(l)}">
          <button type="button" class="nom-lumiere" data-lum="choisir" data-id="${e(l.id)}">${temoin(l)}<span>${e(noms.get(l.id) || "Lumière")}</span>${l.cache ? '<span class="secret">cachée</span>' : ""}</button>
          <button type="button" class="bascule-lumiere" data-lum="bascule" data-id="${e(l.id)}" aria-pressed="${allumee(l)}" title="${allumee(l) ? "Éteindre" : "Allumer"}">${allumee(l) ? "Allumée" : "Éteinte"}</button>
        </li>`).join("")}</ul>`
    : '<p class="aide">Aucune lumière pour l\'instant. Les lumières proposées par « Habiller le plan » apparaîtront aussi ici.</p>'}
    ${liste.length >= LUMIERES_MAX ? `<p class="aide">Maximum de ${LUMIERES_MAX} lumières atteint.</p>` : ""}
    ${choisie ? htmlLumiereChoisie(choisie) : ""}
    ${htmlLumiere(plan)}
    ${amb ? `
      <h3>Pénombre et teintes</h3>
      <label class="champ">Pénombre <output>${virgule(+amb.force || 0)}</output><input type="range" min="0" max="0.95" step="0.05" data-amb="force" value="${e(+amb.force || 0)}"></label>
      <div class="deux">
        <label class="champ">Teinte dedans<input type="color" data-amb="interieur" value="${e(amb.interieur)}"></label>
        <label class="champ">Teinte dehors<input type="color" data-amb="exterieur" value="${e(amb.exterieur)}"></label>
      </div>` : `<p class="aide">La pénombre et les teintes se règlent une fois la première lumière posée.</p>`}`;
}
