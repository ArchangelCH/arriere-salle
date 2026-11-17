// Une affiche de la planche : même rendu dans l'atelier et sur la TV (feuille de papier clouée, penchée selon son identifiant).

import { echapper as e } from "../api.js";

function penche(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return ((Math.abs(h) % 70) / 10 - 3.5).toFixed(1);
}

// c : contrat (public ou complet). options.choisie : entourée dans l'atelier ; options.bouton : l'affiche est cliquable.
export function htmlAffiche(c, { choisie = false, bouton = false } = {}) {
  const avis = c.genre === "avis";
  const classes = ["affiche", avis ? "genre-avis" : "genre-contrat", c.delave ? "delave" : "", c.etat === "pris" ? "prise" : "", choisie ? "choisie" : ""];
  const balise = bouton ? "button" : "article";
  return `
    <${balise} class="${classes.filter(Boolean).join(" ")}" style="--r:${penche(c.id)}deg" data-contrat="${e(c.id)}"${bouton ? ` type="button" aria-pressed="${choisie}"` : ""}>
      <span class="clou" aria-hidden="true"></span>
      <span class="type">${avis ? "Avis" : "Contrat"}</span>
      <span class="titre">${e(c.nom || "Sans titre")}</span>
      ${c.affiche ? `<span class="texte">${e(c.affiche)}</span>` : ""}
      ${c.recompense ? `<span class="prime">${e(c.recompense)}</span>` : ""}
      ${c.contact ? `<span class="contact">${e(c.contact)}</span>` : ""}
      ${c.mention ? `<span class="mention">${e(c.mention)}</span>` : ""}
      ${avis ? '<span class="sceau" aria-hidden="true"></span>' : ""}
      ${c.etat === "pris" ? '<span class="tampon">Pris</span>' : ""}
    </${balise}>`;
}
