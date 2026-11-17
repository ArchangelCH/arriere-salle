// Les fiches créées d'un clic (« Vierge », « Nouveau contrat », « Nouvelle rumeur »…) n'existent que pour qu'on les
// remplisse : une fiche laissée telle quelle en quittant la page n'a pas servi, elle repart à la corbeille (où elle se
// retrouve) au lieu d'encombrer les listes de doublons « Nouveau PNJ ». Une fiche dont un seul champ a changé est gardée.
// Les tirages au sort ne passent pas par ici : leur contenu a été lu, le MJ peut le vouloir tel quel.

import { api } from "../api.js";

const VOLATILS = ["modifie", "version", "cree"];

export function empreinte(fiche) {
  const c = { ...fiche };
  for (const k of VOLATILS) delete c[k];
  return JSON.stringify(c);
}

// « Nouveau PNJ », puis « Nouveau PNJ 2 », « Nouveau PNJ 3 » : deux fiches vierges ne se confondent jamais dans la liste.
export function nomDistinct(base, existants) {
  const pris = new Set(existants.map((n) => String(n || "").trim()));
  if (!pris.has(base)) return base;
  let n = 2;
  while (pris.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export class Vierges {
  constructor() {
    this.liste = new Map();
  }

  marquer(cle, chemin, fiche) {
    this.liste.set(cle, { chemin, id: fiche.id, empreinte: empreinte(fiche) });
  }

  // Les fiches encore intactes (hors celle qu'on ouvre) partent à la corbeille. trouve(cle) rend la fiche en mémoire,
  // modifiee(cle) dit si un envoi l'attend, retirer(cle, fiche) l'ôte de la page. Rend le nombre de fiches retirées.
  async purger({ sauf = null, trouve, modifiee = () => false, retirer = () => {} }) {
    let n = 0;
    for (const [cle, v] of [...this.liste]) {
      if (cle === sauf) continue;
      const fiche = trouve(cle);
      if (!fiche || modifiee(cle) || empreinte(fiche) !== v.empreinte) {
        this.liste.delete(cle);
        continue;
      }
      this.liste.delete(cle);
      retirer(cle, fiche);
      try {
        await api.del(`${v.chemin}/${encodeURIComponent(v.id)}`);
        n++;
      } catch {
        // la fiche reste, sans mal : on ne tente pas deux fois
      }
    }
    return n;
  }
}
