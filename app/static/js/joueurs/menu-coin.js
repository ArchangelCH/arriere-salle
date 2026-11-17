// Le menu du coin des joueurs : le bouton « Menu » de la barre du haut ouvre les pages que la barre ne porte pas (les pages
// du carnet, la bible, le guide, le mot de passe). Toutes les pages du coin le chargent ; le bouton est dans leur HTML.

import "./onglet-table.js";

const GROUPES = [
  ["Le monde", [
    ["/carnet#personnages", "Les personnages", ""],
    ["/carnet#lieux", "Les lieux", ""],
    ["/carnet#contrats", "Contrats et rumeurs", ""],
    ["/carnet#documents", "Les documents reçus", ""],
  ]],
  ["La compagnie", [
    ["/carnet#compagnie", "La compagnie", ""],
    ["/carnet#regles", "Les règles de la table", ""],
    ["/carnet#sanctuaire", "Le sanctuaire", ""],
    ["/carnet#activites", "Entre les séances", ""],
    ["/carnet#precedemment", "Les séances d'avant", ""],
  ]],
  ["Ailleurs", [
    ["/bible", "La bible", ""],
    ["/guide", "Le guide du coin", ""],
    ["/compte", "Mon mot de passe", ""],
  ]],
];

const bouton = document.querySelector(".onglets-coin [data-menu]");
if (bouton) {
  const entete = bouton.closest(".tete-coin");
  const html = (groupes) => groupes.map(([titre, liens]) => `
    <section><h2>${titre}</h2><ul>${liens.map(([href, nom, sous]) => `
      <li><a href="${href}"><b>${nom}</b>${sous ? `<span>${sous}</span>` : ""}</a></li>`).join("")}</ul></section>`).join("");
  const panneau = document.createElement("div");
  panneau.className = "menu-coin";
  panneau.id = "menu-coin";
  panneau.hidden = true;
  panneau.innerHTML = html(GROUPES);
  const fond = document.createElement("div");
  fond.className = "menu-coin-fond";
  fond.hidden = true;
  entete.append(panneau);
  document.body.append(fond);
  bouton.setAttribute("aria-controls", "menu-coin");
  bouton.setAttribute("aria-expanded", "false");

  const ouvert = () => !panneau.hidden;
  function fermer(rendreLeFocus = false) {
    panneau.hidden = true;
    fond.hidden = true;
    document.body.classList.remove("menu-coin-ouvert");
    bouton.setAttribute("aria-expanded", "false");
    if (rendreLeFocus) bouton.focus();
  }
  function ouvrir() {
    panneau.hidden = false;
    fond.hidden = false;
    document.body.classList.add("menu-coin-ouvert");
    bouton.setAttribute("aria-expanded", "true");
    panneau.querySelector("a")?.focus();
  }
  bouton.addEventListener("click", () => (ouvert() ? fermer(true) : ouvrir()));
  fond.addEventListener("click", () => fermer());
  panneau.addEventListener("click", (ev) => {
    if (ev.target.closest("a")) fermer();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && ouvert()) fermer(true);
  });
  window.addEventListener("hashchange", () => fermer());
}
