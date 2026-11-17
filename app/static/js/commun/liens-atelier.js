// Les petits liens de l'atelier, à côté de son nom (Corbeille, Touches…) : chaque module ajoute le sien par ici plutôt
// que dans la page, pour que l'en-tête ne se dessine qu'à un seul endroit.
export function ajouterLienAtelier({ libelle, href = "", titre = "", surClic = null }) {
  const zone = document.querySelector(".liens-atelier");
  if (!zone) return null;
  const lien = document.createElement(href ? "a" : "button");
  if (href) lien.href = href;
  else lien.type = "button";
  lien.textContent = libelle;
  if (titre) lien.title = titre;
  if (surClic) lien.addEventListener("click", surClic);
  zone.append(lien);
  zone.hidden = false;
  return lien;
}
