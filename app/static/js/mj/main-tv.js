// La main sur la TV, quand deux MJ mènent la campagne (lot MJ-4, adresses.py) : l'état de la table dit qui y a envoyé ce
// qu'elle montre. Si c'est l'autre MJ, le serveur suspend tout envoi qui changerait l'écran (409 portant « question ») ;
// cette page pose alors la question « La reprendre ? », et api.js renvoie la même requête si le MJ dit oui. Tant qu'aucun
// invité n'existe, la question ne vient jamais. Branché par l'atelier (atelier.js) et la télécommande (telecommande.js) :
// une seule question à la fois, même si plusieurs envois l'attendent.

import { surQuestion } from "../api.js";
import { demander } from "../commun/dialogue.js";

const FEUILLE = "/static/css/main-tv.css";
let enCours = null;

// feuille : la page n'a pas le style des dialogues de l'atelier (la télécommande).
export function brancherLaMainTv({ feuille = false } = {}) {
  if (feuille && !document.querySelector(`link[href="${FEUILLE}"]`)) {
    const lien = document.createElement("link");
    lien.rel = "stylesheet";
    lien.href = FEUILLE;
    document.head.append(lien);
  }
  surQuestion((q) => {
    if (q?.genre !== "main-tv") return false;
    if (!enCours) {
      enCours = demander({
        titre: "La reprendre ?",
        texte: `${q.nom || "L'autre MJ"} a la main sur la TV : ce que vous envoyez remplacera ce qu'on y voit.`,
        oui: "La reprendre",
        non: "Laisser",
      }).finally(() => {
        enCours = null;
      });
    }
    return enCours;
  });
}

// « par : Léa » : qui a la main sur la TV quand ce n'est pas le MJ de cette page (GET /api/table le dit, sinon rien).
export const parLaMain = (t) => (t?.par && t.par_nom ? `par : ${t.par_nom}` : "");
