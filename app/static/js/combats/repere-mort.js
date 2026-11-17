// Le repère de mort du kit (moins la Santé maximum, jamais avant −10) : le MJ confirme avant de le noter, par le
// dialogue de l'atelier. La même question sur la page du combat, dans le Tableau et dans La compagnie.

import { demander } from "../commun/dialogue.js";
import { seuilMort } from "./suivi.js";

const signe = (n) => String(n).replace("-", "−");

// Vrai si cette Santé peut être notée (faux si le MJ renonce). champ : la saisie d'où vient le chiffre ; tant que la
// question est posée, le champ quitté (son « change ») ne la repose pas.
export async function accepterMort(qui, x, valeur, pourquoi = "", champ = null) {
  const seuil = seuilMort(x.max);
  if (!(valeur <= seuil && x.sante > seuil)) return true;
  if (champ?.dataset.question) return false;
  if (champ) champ.dataset.question = "1";
  try {
    return await demander({
      titre: `${qui} tomberait à ${signe(valeur)}${pourquoi}`,
      texte: "C'est le repère de mort du kit : moins sa Santé maximum, jamais avant −10.",
      aide: "Le MJ a toujours le dernier mot.",
      oui: "Noter ce chiffre",
      non: "Ne pas le noter",
    });
  } finally {
    if (champ) delete champ.dataset.question;
  }
}
