// L'état du jeu, partagé par les écrans qui le montrent (les jauges des pions de l'éditeur de plan, le tableau du MJ) :
// les fiches de la tablée, l'état du moment des héros (routes /api/etats-heros) et le combat en cours, celui d'une
// séance. Relu à l'abonnement, au retour sur l'onglet, toutes les cinq secondes tant que quelqu'un écoute et que la
// page est visible (l'iPad a pu noter un coup), et aussitôt qu'un écran de cette page annonce un changement
// (annoncerEtatJeu : le combat ou la compagnie viennent d'enregistrer).

import { api } from "../api.js";
import { ecouterCombats } from "../ecran-tv/canal-table.js";

const PERIODE = 5000;
const ecouteurs = new Set();
let dernier = null; // { fiches, etats, auCombat, seance, combat, lu }
let enCours = null;
let minuterie = 0;
let finCombats = null;
let fichesLues = 0;
// Chaque changement annoncé par un écran de cette page : une lecture commencée avant lui est périmée.
let generation = 0;
let relancer = false;

const avertir = () => {
  for (const fn of [...ecouteurs]) {
    try {
      fn(dernier);
    } catch (err) {
      console.error(err);
    }
  }
};

// La séance dont un combat est en cours : celle des héros qui se battent (la première trouvée).
const seanceAuCombat = (auCombat) => Object.values(auCombat || {}).map((x) => x?.seance).find(Boolean) || "";

async function lire(fiches) {
  const [etats, liste] = await Promise.all([
    api.get("/api/etats-heros"),
    fiches || !dernier ? api.get("/api/aventuriers") : Promise.resolve(dernier.fiches),
  ]);
  const seance = seanceAuCombat(etats.au_combat);
  let combat = null;
  if (seance) {
    const r = await api.get(`/api/seances/${encodeURIComponent(seance)}/combat`).catch(() => null);
    combat = r?.combat || null;
  }
  if (fiches || !dernier) fichesLues = Date.now();
  return { fiches: liste, etats: etats.etats || {}, auCombat: etats.au_combat || {}, seance: combat ? seance : "", combat, lu: Date.now() };
}

// Relit tout (fiches : relire aussi les fiches de la tablée, plus lourdes : au retour sur l'onglet, toutes les minutes).
export function relireEtatJeu({ fiches = false } = {}) {
  if (enCours) {
    // Une lecture déjà partie peut précéder le dernier geste : une autre la suivra.
    relancer = true;
    return enCours;
  }
  const depart = generation;
  enCours = lire(fiches || Date.now() - fichesLues > 60000)
    .then((x) => {
      // Un geste annoncé pendant la lecture : on ne remplace pas ce qu'il montre par l'état d'avant lui.
      if (depart === generation) {
        dernier = x;
        avertir();
      } else relancer = true;
      return dernier;
    })
    .catch(() => dernier)
    .finally(() => {
      enCours = null;
      if (relancer) {
        relancer = false;
        relireEtatJeu();
      }
    });
  return enCours;
}

// Un écran de cette page vient d'enregistrer : le combat (partiel.combat, partiel.seance ; null : fini) ou l'état des
// héros (partiel.etats). Les autres écouteurs le voient tout de suite, puis tout est relu (sauf relire : faux, pour un
// geste dont l'envoi n'est pas encore parti : l'annonce suivante relira).
// source : l'écran qui annonce ; les pages qui tiennent leur propre copie (le combat, la compagnie) se relisent sur
// l'événement « etat-jeu-change », sauf celle qui vient d'écrire.
export function annoncerEtatJeu(partiel = {}, { relire = true, source = null } = {}) {
  generation++;
  if (dernier) {
    dernier = { ...dernier, ...partiel };
    if ("combat" in partiel && !partiel.combat) dernier.seance = "";
    avertir();
  }
  if (relire) {
    relireEtatJeu();
    window.dispatchEvent(new CustomEvent("etat-jeu-change", { detail: { source } }));
  }
}

// Le plan ouvert dans l'éditeur (une fonction qui le rend, null quand on le quitte) : le tableau du MJ y lit les
// adversaires posés hors combat.
let planOuvert = null;
export function poserPlanCourant(lire) {
  planOuvert = lire;
}
export const planCourant = () => (planOuvert ? planOuvert() : null);

export const etatJeu = () => dernier;

function tic() {
  if (document.visibilityState === "visible" && ecouteurs.size) relireEtatJeu();
}

function auRetour() {
  if (ecouteurs.size) relireEtatJeu({ fiches: true });
}

// fn(etat) à chaque relecture ; rend la fonction qui désabonne.
export function ecouterEtatJeu(fn) {
  ecouteurs.add(fn);
  if (dernier) fn(dernier);
  if (!minuterie) {
    minuterie = setInterval(tic, PERIODE);
    window.addEventListener("focus", auRetour);
    // Un combat changé sur un autre écran (la télécommande, l'iPad) : le serveur le dit, tout est relu aussitôt. Sans
    // liaison possible (hors navigateur), la relecture des cinq secondes suffit.
    try {
      finCombats = ecouterCombats((s) => {
        if ((s.modifie ?? null) !== (dernier?.combat?.modifie ?? null) || (s.modifie && s.seance !== dernier?.seance)) relireEtatJeu();
      });
    } catch {
      finCombats = null;
    }
  }
  relireEtatJeu({ fiches: !dernier });
  return () => {
    ecouteurs.delete(fn);
    if (!ecouteurs.size && minuterie) {
      clearInterval(minuterie);
      minuterie = 0;
      window.removeEventListener("focus", auRetour);
      finCombats?.();
      finCombats = null;
    }
  };
}
