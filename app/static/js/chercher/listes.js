// La recherche des listes de l'atelier, avec le moteur de « Chercher » (moteur.js) : le carnet des PNJ et le répertoire
// des lieux cherchent sans accents ni majuscules, dans tous les champs de jeu ; le nom d'abord, puis le détail, puis les
// autres champs, et celui qui répond est rappelé sous le nom. Côté MJ seulement.

import { TYPES_LIEUX } from "../carte/biomes.js";
import { champsDe } from "./index-atelier.js";
import { chercherFiches, plier, propre, surligner } from "./moteur.js";

const e = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const TYPES = Object.fromEntries(TYPES_LIEUX.map((t) => [t.cle, t.nom]));

function fiche(genre, x, detail, champs) {
  const nom = propre(x.nom) || "Sans nom";
  return { genre, id: x.id, nom, cle: plier(nom), detail: propre(detail), nomGenre: "", ordre: 0, champs, source: x };
}

// Le champ qui répond, sous le nom : « VOIX Il chuchote quand il ment… ».
export const htmlTrouve = (trouve) => (trouve ? `<span class="trouve"><b>${e(trouve.libelle)}</b> ${trouve.html}</span>` : "");

// Les PNJ qui répondent, dans l'ordre de la recherche : [{ p, trouve }]. nomLieu(id) : le nom d'un lieu.
export function chercherPnj(pnj, recherche, nomLieu) {
  const fiches = pnj.map((p) => fiche("pnj", p, [p.role, nomLieu(p.lieu)].filter(Boolean).join(" · "), champsDe("pnj", p)));
  return chercherFiches(fiches, recherche, { max: Infinity }).map((f) => ({ p: f.source, trouve: f.trouve || null }));
}

export { surligner };

// Le répertoire des lieux (atelier.js) : chaque carte du lieu reste dans la page ; celles qui ne répondent pas se
// cachent, les autres se rangent dans l'ordre de la recherche, le nom et le résumé surlignés, et les notes ou les
// secrets qui répondent rappelés dessous.
export function filtrerLieux(page, lieux) {
  const q = page.querySelector(".recherche")?.value.trim() || "";
  const type = page.querySelector(".filtre-type")?.value || "";
  const aValider = Boolean(page.querySelector(".filtre-valider")?.checked);
  const gardes = lieux.filter((l) => (!type || l.type === type) && (!aValider || l.a_valider));
  const fiches = gardes.map((l) => fiche("lieu", l, TYPES[l.type] || l.type || "", champsDe("lieu", l)));
  const trouves = q ? chercherFiches(fiches, q, { max: Infinity }) : fiches;
  const places = new Map(trouves.map((f, i) => [f.id, { i, trouve: f.trouve || null, l: f.source }]));
  for (const li of page.querySelectorAll(".repertoire li[data-id]")) {
    const x = places.get(li.dataset.id);
    li.hidden = !x;
    li.style.order = x && q ? String(x.i) : "";
    if (!x) continue;
    const nom = li.querySelector(".nom");
    const resume = li.querySelector(".resume");
    if (nom) nom.innerHTML = q ? surligner(x.l.nom, q) : e(x.l.nom);
    // Le résumé ne montre que deux lignes : quand c'est lui qui répond, l'extrait autour du mot trouvé.
    if (resume) resume.innerHTML = x.trouve?.libelle === "Résumé" ? x.trouve.html : q ? surligner(x.l.resume || "", q) : e(x.l.resume || "");
    let ligne = li.querySelector(".trouve");
    // Le résumé se lit déjà sur la carte : seuls les notes et les secrets ont besoin d'être rappelés.
    const rappel = x.trouve && x.trouve.libelle !== "Résumé" ? x.trouve : null;
    if (rappel && !ligne) {
      ligne = document.createElement("span");
      ligne.className = "trouve";
      li.querySelector("a")?.append(ligne);
    }
    if (ligne) {
      ligne.hidden = !rappel;
      ligne.innerHTML = rappel ? `<b>${e(rappel.libelle)}</b> ${rappel.html}` : "";
    }
  }
  const liste = page.querySelector(".repertoire");
  let vide = page.querySelector(".repertoire-vide");
  if (!vide && liste) {
    vide = document.createElement("p");
    vide.className = "vide repertoire-vide";
    liste.after(vide);
  }
  if (vide) {
    vide.hidden = Boolean(trouves.length) || !lieux.length;
    vide.textContent = q ? `Aucun lieu ne répond à « ${q} », ni par son nom, ni par son genre, son résumé, ses notes ou ses secrets.` : "Aucun lieu ne correspond à ces filtres.";
  }
}
