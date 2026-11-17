// Les listes que lisent les aides du tableau du MJ (séances, campagne, PNJ, lieux, rumeurs, boutiques) : une lecture
// partagée et gardée un moment, pour que deux sections ne demandent pas deux fois la même chose au serveur, et qu'un
// serveur muet laisse la dernière réponse en place.

import { api } from "../api.js";

const memoire = new Map(); // url → { quand, valeur, enCours, generation }

export function lire(url, ageMax = 15000) {
  const x = memoire.get(url) || { quand: 0, generation: 0 };
  if (x.enCours) return x.enCours;
  if ("valeur" in x && Date.now() - x.quand < ageMax) return Promise.resolve(x.valeur);
  const depart = x.generation;
  const enCours = api.get(url).then((valeur) => {
    // Oubliée pendant la lecture (une écriture vient de partir) : la réponse sert, mais la suivante repart du serveur.
    const g = memoire.get(url)?.generation ?? depart;
    memoire.set(url, { quand: g === depart ? Date.now() : 0, valeur, generation: g });
    return valeur;
  }, (err) => {
    const y = memoire.get(url) || x;
    if (!("valeur" in x)) {
      memoire.delete(url);
      throw err;
    }
    memoire.set(url, { quand: x.quand, valeur: x.valeur, generation: y.generation });
    return x.valeur;
  });
  memoire.set(url, { ...x, enCours });
  return enCours;
}

// La prochaine lecture repart du serveur : après une écriture d'ici, ou quand une autre page annonce un changement.
export function oublier(...urls) {
  for (const url of urls) {
    const x = memoire.get(url);
    if (x) memoire.set(url, { ...x, quand: 0, generation: x.generation + 1 });
  }
}

// Les préférences des aides (section repliée, lieu choisi, difficulté visée), retenues sur ce navigateur seulement.
export function lireCle(cle) {
  try {
    return localStorage.getItem(cle);
  } catch {
    return null;
  }
}

export function garderCle(cle, valeur) {
  try {
    localStorage.setItem(cle, valeur);
  } catch {
    // préférence perdue, sans conséquence
  }
}
