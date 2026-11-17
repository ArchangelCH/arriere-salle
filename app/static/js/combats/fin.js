// La fin d'un combat et son rattrapage, pour la page du combat, le Tableau et la télécommande. « Fin du combat » : le
// combat quitte la séance (et la TV), son bilan va au journal. Le serveur rend le combat tel qu'il était (fini) :
// pendant quelques secondes, « Rouvrir le combat » le remet, retire ce bilan du journal et rend l'ordre du tour à la TV
// s'il y était.

import { api, copie } from "../api.js";
import { annoncerEtatJeu } from "../commun/etat-jeu.js";
import { noterAuJournal, retirerDuJournal } from "../seances/journal.js";
import { bilan } from "./suivi.js";

const urlCombat = (seance) => `/api/seances/${encodeURIComponent(seance)}/combat`;
// Comme le serveur range une ligne du journal : les blancs ramenés à une espace.
const uneLigne = (t) => String(t || "").split(/\s+/).filter(Boolean).join(" ");

// Finit le combat de la séance. local : la copie de l'écran, si le serveur ne rend pas le combat fini (déjà fini
// ailleurs, réponse perdue puis renvoyée). Rend { fini, ligne, erreur } : le combat d'avant la fin, la ligne de son
// bilan au journal (null si elle n'a pas pu y entrer : erreur dit pourquoi).
export async function finirCombat(seance, { local = null, source = null } = {}) {
  const srv = await api.del(urlCombat(seance));
  const fini = srv?.fini || local;
  let ligne = null;
  let erreur = null;
  if (fini) {
    const texte = uneLigne(bilan(fini));
    try {
      const s = await noterAuJournal(seance, texte);
      const lignes = Array.isArray(s?.journal) ? s.journal : [];
      for (let i = lignes.length - 1; i >= 0 && !ligne; i--) if (lignes[i]?.texte === texte) ligne = lignes[i];
    } catch (err) {
      erreur = err;
    }
  }
  annoncerEtatJeu({ combat: null }, { source });
  return { fini, ligne, erreur };
}

// Remet un combat fini tel qu'il était : refusé si un autre combat a commencé depuis dans la séance. tv : l'ordre du
// tour y était ; par : l'écran qui le remet (« atelier » ou « telecommande »). Rend le combat remis.
export async function rouvrirCombat({ seance, fini, ligne = null, tv = false, par = "atelier" }) {
  if (!fini) throw new Error("ce combat n'est plus gardé");
  const url = urlCombat(seance);
  let srv;
  try {
    srv = await api.put(url, { ...copie(fini), par, version_base: null });
  } catch (err) {
    if (err.status === 409) throw new Error("un autre combat a commencé depuis dans cette séance");
    throw err;
  }
  // Le bilan noté à la fin n'a plus lieu d'être : il reviendra à la vraie fin.
  if (ligne?.id) await retirerDuJournal(seance, ligne).catch(() => null);
  if (tv) await api.put(`${url}/tv`, { montrer: true }).catch(() => null);
  annoncerEtatJeu({ seance, combat: copie(srv.combat) });
  return srv.combat;
}
