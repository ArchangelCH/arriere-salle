// L'état de l'enregistrement, à la même place sur toutes les pages (à droite du titre) et avec les mêmes mots. Là où il y a
// la place, « Enregistré à 21 h 43 » ; sous 1500 px (l'iPad, le Tableau ouvert, la barre d'un éditeur), un mot court :
// « Enregistré », « Envoi… », « Hors ligne ». Pendant une coupure, le compte à rebours du nouvel essai reste écrit
// (reessai.js) et une pastille rouge bat ; le message, lui, vient de la page (Reessai.signaler).

import { echapper as e } from "../api.js";

const LONGS = { ok: "Enregistré", modifie: "Modifications en cours", enregistrement: "Enregistrement…", erreur: "Échec de l'enregistrement" };
const COURTS = { ok: "Enregistré", modifie: "Envoi…", enregistrement: "Envoi…", erreur: "Non enregistré" };

// « à 21 h 43 » pour une version d'aujourd'hui, « le 2 nov. » ou « le 1er nov. » sinon ; vide sans date lisible.
export function quandEnregistre(modifie) {
  const d = modifie ? new Date(modifie) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  if (d.toDateString() === new Date().toDateString()) return `à ${d.getHours()}\u00a0h\u00a0${String(d.getMinutes()).padStart(2, "0")}`;
  return `le ${d.getDate() === 1 ? "1er" : d.getDate()}\u00a0${d.toLocaleDateString("fr-CH", { month: "short" })}`;
}

export function htmlTemoin(etat = "ok") {
  return `<span class="temoin-enregistrement" data-etat="${e(etat)}" aria-live="polite"><i class="temoin-pastille" aria-hidden="true"></i><span class="long">${e(LONGS[etat] || "")}</span><span class="court">${e(COURTS[etat] || "")}</span></span>`;
}

// el : le témoin (rien s'il manque) ; etat : ok, modifie, enregistrement ou erreur ; reessai : la série de nouveaux essais
// de la page (son compte à rebours) ; modifie : la version enregistrée de la fiche, pour l'heure ; texte : un état propre
// à la page, écrit tel quel (« Enregistrement suspendu »).
export function afficherTemoin(el, etat, { reessai = null, modifie = null, texte = "" } = {}) {
  if (!el) return;
  el.dataset.etat = etat;
  const long = el.querySelector(".long");
  const court = el.querySelector(".court");
  if (!long || !court) return;
  const relance = reessai?.libelle(etat);
  if (texte) {
    long.textContent = texte;
    court.textContent = texte;
  } else if (relance) {
    long.textContent = relance;
    // Coupure du réseau : « Hors ligne », et dessous le compte à rebours, lisible même en petit.
    court.innerHTML = `Hors ligne<small>${e(reessai.libelle(etat, true).replace(/^./, (x) => x.toLowerCase()))}</small>`;
  } else {
    const quand = etat === "ok" ? quandEnregistre(modifie) : "";
    long.textContent = quand ? `Enregistré ${quand}` : LONGS[etat] || "";
    court.textContent = COURTS[etat] || "";
  }
  el.title = long.textContent;
}
