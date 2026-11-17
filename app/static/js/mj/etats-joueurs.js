// Un joueur a réglé son héros depuis la table du coin (Santé, Psy, posture : etat_joueur_mj.py) : le MJ le lit en une
// ligne, où qu'il soit dans l'atelier, et ce qui montre l'état des héros (le Tableau, la compagnie, les jauges des pions)
// se relit aussitôt. Le combat ouvert, lui, se relit par son propre signal.

import { toast } from "../api.js";
import { relireEtatJeu } from "../commun/etat-jeu.js";
import { ecouterEtatsJoueurs } from "../ecran-tv/canal-table.js";

const NOMS = { sante: "Santé", psy: "Psy" };
const POSTURES = { offensive: "offensive", defensive: "défensive", focus: "focus" };

export function phrase(s) {
  const qui = `${s.heros || "Un héros"}${s.joueur ? ` (${s.joueur})` : ""}`;
  if (s.quoi === "posture") return `${qui} : posture ${POSTURES[s.apres] || s.apres}`;
  return `${qui} : ${NOMS[s.quoi] || s.quoi} ${s.avant} → ${s.apres}`;
}

let branche = false;
export function suivreEtatsDesJoueurs() {
  if (branche) return;
  branche = true;
  ecouterEtatsJoueurs((s) => {
    toast(phrase(s));
    relireEtatJeu();
    window.dispatchEvent(new CustomEvent("etat-jeu-change", { detail: { source: null } }));
  });
}
