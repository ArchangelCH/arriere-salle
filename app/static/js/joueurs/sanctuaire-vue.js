// Le sanctuaire dans le carnet des joueurs : le village dessiné comme à la TV (sanctuaire/dessin.js), puis le
// registre des chantiers, une fiche par bâtiment (son niveau, sa cagnotte, ce que coûte le prochain niveau et ce qu'il
// apporte, qui a versé), ce que le sanctuaire offre déjà, et les projets que le MJ propose. Le carnet (carnet-vue.js) et
// l'aperçu du MJ le dessinent tel quel ; dans le coin, sanctuaire-coin.js y ajoute les gestes (verser, proposer) et le
// relit seul. Tout texte passe par echapper ; le serveur n'envoie que ce que l'atelier a publié.

import { echapper as e } from "../api.js";
import { svgVillage } from "../sanctuaire/dessin.js";

export const ROMAINS = ["0", "I", "II", "III", "IV", "V"];
export const po = (n) => `${n} po`;
export const pieces = (n) => `${n} ${n > 1 ? "pièces" : "pièce"} d'or`;

// La section publiée, rangée : le village, les bâtiments, les projets.
export function lireSection(elements) {
  const liste = (elements || []).filter((x) => x && typeof x === "object");
  return {
    village: liste.find((x) => x.genre === "village") || null,
    batiments: liste.filter((x) => x.genre === "batiment" && typeof x.id === "string"),
    projets: liste.filter((x) => x.genre === "projet" && typeof x.id === "string"),
  };
}

// Ce qui manque au prochain niveau ; null au plus haut.
export function reste(b) {
  const p = b?.prochain;
  if (!p || typeof p.cout !== "number") return null;
  return Math.max(0, p.cout - (Number(b.cagnotte) || 0));
}

const etatDe = (b) => (b.niveau ? `Niveau ${ROMAINS[b.niveau] || b.niveau} sur ${ROMAINS[b.niveaux] || b.niveaux}` : b.ruine ? "En ruines" : "À bâtir");

// La jauge de la cagnotte : la part payée du prochain niveau.
function jauge(b) {
  const p = b.prochain;
  const part = p && p.cout ? Math.min(100, Math.round((100 * (Number(b.cagnotte) || 0)) / p.cout)) : 100;
  return `<div class="jauge-chantier" role="progressbar" aria-valuemin="0" aria-valuemax="${e(p?.cout || 0)}" aria-valuenow="${e(b.cagnotte || 0)}" aria-label="Cagnotte"><i style="width:${part}%"></i></div>`;
}

// ctx (coin seulement) : pour chaque bâtiment, ce que le joueur peut y faire (sanctuaire-coin.js).
export function htmlBatiment(b, ctx = null) {
  const p = b.prochain;
  const manque = reste(b);
  const donateurs = (b.donateurs || []).filter((d) => d && d.nom);
  return `
    <article class="chantier-coin${b.niveau ? "" : " a-batir"}" id="chantier-${e(b.id)}" data-chantier="${e(b.id)}" style="--toit:${e(b.toit || "#8e3b2a")}">
      <header>
        <span class="niveau-chantier" aria-hidden="true">${e(ROMAINS[b.niveau] || "0")}</span>
        <div>
          <h3>${e(b.nom)}</h3>
          <p class="etat-chantier">${e(etatDe(b))}${b.niveau && b.etat ? ` · <i>${e(b.etat)}</i>` : ""}</p>
        </div>
      </header>
      ${p ? `
      <div class="cagnotte-chantier">
        <p class="somme"><span><b>${e(po(b.cagnotte || 0))}</b> sur ${e(po(p.cout))}</span>${manque ? `<span class="manque">il manque ${e(po(manque))}</span>` : ""}</p>
        ${jauge(b)}
      </div>
      <dl class="prochain-chantier">
        <dt>Niveau ${e(ROMAINS[p.rang] || p.rang)}</dt><dd><b>${e(p.nom)}</b>, ${e(po(p.cout))}</dd>
        ${p.bonus ? `<dt>Ce qu'il apporte</dt><dd>${e(p.bonus)}</dd>` : ""}
      </dl>
      ${donateurs.length ? `<p class="donateurs-chantier"><span class="lbl">Ont versé</span>${donateurs.map((d) => `${e(d.nom)} <b>${e(po(d.or))}</b>`).join(", ")}</p>` : ""}`
    : '<p class="haut-chantier">Au plus haut niveau.</p>'}
      ${ctx ? ctx.gestes(b) : ""}
    </article>`;
}

export function htmlProjet(t, ctx = null) {
  const niveaux = t.niveaux || [];
  return `
    <article class="projet-coin" id="projet-${e(t.id)}" data-projet="${e(t.id)}" style="--toit:${e(t.toit || "#55463b")}">
      <h3>${e(t.nom)}${t.unique ? ' <small>un seul au sanctuaire</small>' : ""}</h3>
      ${t.description ? `<p class="description-projet">${e(t.description)}</p>` : ""}
      ${niveaux.length ? `<ol class="niveaux-projet">${niveaux.map((n, i) => `
        <li><span class="rang">${e(ROMAINS[i + 1] || i + 1)}</span><span class="nom"><b>${e(n.nom)}</b><span class="cout">${e(po(n.cout))}</span>${n.bonus ? `<small>${e(n.bonus)}</small>` : ""}</span></li>`).join("")}</ol>` : ""}
      ${ctx ? ctx.gestesProjet(t) : ""}
    </article>`;
}

// Le village, puis les fiches. Le dessin se lit en entier sur un grand écran ; sur un téléphone, il glisse de côté.
export function htmlSanctuaire(elements, ctx = null) {
  const { village, batiments, projets } = lireSection(elements);
  if (!village) return '<p class="vide">Le sanctuaire n\'est pas encore montré aux joueurs.</p>';
  const debout = batiments.filter((b) => b.niveau).length;
  const habitants = Number(village.habitants) || 0;
  const bonus = village.bonus || [];
  return `
    ${village.accroche ? `<p class="accroche-sanctuaire">${e(village.accroche)}</p>` : ""}
    <p class="chiffres-sanctuaire"><span><b>${e(debout)}</b> bâtiment${debout > 1 ? "s" : ""} debout</span><span><b>${e(habitants)}</b> habitant${habitants > 1 ? "s" : ""}</span><span><b>${e(batiments.length - debout)}</b> chantier${batiments.length - debout > 1 ? "s" : ""}</span></p>
    <figure class="village-coin" data-image>
      <div class="village-defile" tabindex="0" aria-label="Le village du sanctuaire : touchez un bâtiment pour lire sa fiche">${svgVillage(batiments, { tv: true })}</div>
      <figcaption>${e(village.nom || "Le sanctuaire")}<span class="glisser"> · faites glisser pour voir tout le village</span></figcaption>
    </figure>
    ${ctx ? ctx.bourse() : ""}
    <h3 class="intertitre">Les chantiers</h3>
    <div class="chantiers-coin">${batiments.length ? batiments.map((b) => htmlBatiment(b, ctx)).join("") : '<p class="vide">Aucun bâtiment encore.</p>'}</div>
    <h3 class="intertitre">Ce que le sanctuaire offre</h3>
    ${bonus.length ? `<ul class="bonus-sanctuaire">${bonus.map((x) => `<li><b>${e(x.batiment)}</b> <small>niveau ${e(ROMAINS[x.niveau] || x.niveau)}</small><span>${e(x.bonus)}</span></li>`).join("")}</ul>`
      : '<p class="vide">Rien encore : chaque niveau bâti ajoute son bonus ici.</p>'}
    ${projets.length ? `<h3 class="intertitre">Les projets possibles</h3>
    <p class="aide-groupe">Ce que votre MJ vous propose de bâtir : demandez-lui d'ouvrir le chantier, il choisit sa place au village.</p>
    <div class="projets-coin">${projets.map((t) => htmlProjet(t, ctx)).join("")}</div>` : ""}
    ${ctx ? ctx.historique() : ""}`;
}

// Combien de bâtiments compte le sommaire du carnet.
export const nombreDeChantiers = (elements) => lireSection(elements).batiments.length;
