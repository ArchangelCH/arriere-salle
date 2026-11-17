// La carte X à imprimer : une grande carte sur une A4 couchée, ou deux petites sur une A4 debout ; le fond parchemin
// peut rester dans l'encrier. Le choix se garde dans l'adresse (?format=petites&eco=1), pour la réimprimer pareil.

const corps = document.body;
const feuilles = document.querySelector(".feuilles");
const modele = document.getElementById("modele-carte");
const formatPage = document.getElementById("format-page");
const outils = document.querySelector(".outils-fiche");

function dessiner() {
  const params = new URLSearchParams(location.search);
  const petites = params.get("format") === "petites";
  const eco = params.get("eco") === "1";
  corps.classList.toggle("grande", !petites);
  corps.classList.toggle("petites", petites);
  corps.classList.toggle("eco", eco);
  formatPage.textContent = `@page { size: A4 ${petites ? "portrait" : "landscape"}; margin: 0; }`;
  outils.querySelector(`input[value="${petites ? "petites" : "grande"}"]`).checked = true;
  outils.querySelector('input[name="eco"]').checked = eco;
  const feuille = document.createElement("section");
  feuille.className = "feuille";
  for (let i = 0; i < (petites ? 2 : 1); i++) feuille.append(modele.content.cloneNode(true));
  feuilles.replaceChildren(feuille);
}

outils.addEventListener("change", () => {
  const params = new URLSearchParams();
  if (outils.querySelector('input[name="format"]:checked')?.value === "petites") params.set("format", "petites");
  if (outils.querySelector('input[name="eco"]').checked) params.set("eco", "1");
  const requete = params.toString();
  history.replaceState(null, "", `${location.pathname}${requete ? `?${requete}` : ""}`);
  dessiner();
});
outils.querySelector('[data-action="imprimer"]').addEventListener("click", () => window.print());
dessiner();
