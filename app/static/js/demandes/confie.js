// « Pour le MJ seulement » dans la boîte du MJ : un passage qu'un joueur confie au MJ seul est déposé sans
// validation sur la fiche de son héros. La boîte ne fait que le signaler (sa ligne dit s'il est lu, jamais le texte) ;
// « Lire sur sa fiche » ouvre la page « Pour le MJ » de ce héros, trouvé par la liste des joueurs de l'atelier.

import { api, toast } from "../api.js";

export const GENRE_CONFIE = "confie";

export function htmlBoutonConfie(x) {
  return x.genre === GENRE_CONFIE && x.statut === "appliquee" ? '<button type="button" data-confie-ouvrir>Lire sur sa fiche</button>' : "";
}

export async function ouvrirConfie(joueur) {
  let liste;
  try {
    liste = await api.get("/api/joueurs");
  } catch (err) {
    return toast(`La fiche ne s'ouvre pas : ${err.message}`, "erreur");
  }
  const heros = (Array.isArray(liste) ? liste : []).find((j) => j.id === joueur)?.heros;
  if (!heros?.id) return toast("Ce joueur n'a plus de héros à la tablée.", "erreur");
  location.hash = `#/aventuriers/${encodeURIComponent(heros.id)}?etape=mj`;
}
