// « Étoffer mon histoire », dans « Mon héros » du carnet : le lien vers la page où le joueur écrit l'histoire de
// son héros (histoire.js). Posé par carnet.js seulement, sous « Son histoire » : l'aperçu du MJ (« Voir comme Léa ») ne
// l'a pas, il n'écrit rien.

export function poserVersHistoire(fiche) {
  if (!fiche || fiche.querySelector(".vers-histoire")) return;
  const p = document.createElement("p");
  p.className = "vers-histoire";
  p.innerHTML = '<a class="secondaire" href="/histoire">Étoffer mon histoire</a><span>Écrivez à votre rythme : votre MJ lit chaque passage avant qu\'il entre sur votre fiche.</span>';
  const histoire = fiche.querySelector(".histoire-coin");
  const conseils = fiche.querySelector(".conseils-coin");
  if (histoire) histoire.append(p);
  else if (conseils) conseils.before(p);
  else fiche.append(p);
}
