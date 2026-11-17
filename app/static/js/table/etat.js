// L'état partagé de l'écran de la table : les éléments de la page, les réglages et ce que les autres modules se passent (S).

import { HorlogesTv } from "../ecran-tv/horloges-tv.js";
import { PointeurTv } from "../ecran-tv/pointeur-tv.js";
import { JetTv } from "../ecran-tv/jet-tv.js";
import { ReserveTv } from "../ecran-tv/reserve-tv.js";

export const S = {
  minuterieFonds: 0,
  vue: null,
  texture: null,
  affiche: { carte: null, version: null, style: null },
  vuePlan: null,
  planAffiche: { plan: null, version: null, style: null, signature: null },
  dernierEtat: null,
  legende: [], // les héros que la légende du plan nomme
  bandeau: 0, // la part de la hauteur de l'écran que prend le bandeau du combat, en haut (0 : pas de bandeau)
  basLegende: 0, // la part que prend la légende des héros, en bas (0 : pas de légende)
  basRumeur: 0, // la part que prend le carton d'une rumeur posé sur le plan, en bas (0 : pas de rumeur)
  internet: false, // un écran venu d'Internet (la table publique) : le serveur le dit dans l'état
  finSablier: 0, // l'heure (de la TV) où le sablier du combat sera vide
  minuterieSablier: 0,
};

// La TV du salon (LG webOS) peint le feu au tiers de ses pixels ; une tablette ou un ordinateur, plus puissants et vus
// de plus près, le peignent plus fin et plus vif.
const TV_SALON = /Web0S|webOS|SmartTV/i.test(navigator.userAgent);
const FEU_ECRAN = TV_SALON ? null : { echelle: 2 / 3, images: 20, sprite: 96, flammes: 600, escarbilles: 100 };
// Une tablette tenue en hauteur (iPad en portrait) : fiches sur deux colonnes, boutique sur deux au plus.
const enPortrait = () => window.innerHeight > window.innerWidth && window.innerWidth >= 700;
// Un téléphone (la table publique) : la tablée et les fiches en une colonne qui défile (table.css, sous 600 pixels).
const telephone = () => window.innerWidth < 600;

// Au-delà, une requête est abandonnée : un serveur qui ne répond plus ne bloque jamais les états suivants.
const DELAI_RESEAU = 8000;
// La TV ne peint pas plus de pixels qu'un écran 1080p et garde des tuiles pour deux écrans et demi.
const REGLAGES_TV = { pixelsMax: 2.1e6, ecransTuiles: 2.5 };
// Carte en style peint : la carte reçue est déjà celle des joueurs ; le relief se calcule dans deux workers, plus
// grossier qu'à l'atelier, sans garder ses calques. Le script transpilé de la TV (script classique) a son worker
// classique (tv/peint-worker.js, construit avec l'image) ; le module source prend le worker en module.
const PEINT_TV = {
  donneesPubliques: true,
  peint: { travailleurs: 2, garderRaster: false, rasterMax: 16, worker: document.currentScript ? { url: "/static/tv/peint-worker.js", module: false } : undefined },
};

const canvas = document.getElementById("carte");
const toilePlan = document.getElementById("plan");
const toileBrume = document.querySelector(".brume-plan");
const toileFeu = document.querySelector(".feu-plan");
const accueil = document.querySelector(".accueil");
const carton = document.querySelector(".carton");
const connexion = document.querySelector(".connexion");
const indice = document.querySelector(".indice");
const plein = document.querySelector(".plein");
const cartonPnj = document.querySelector(".carton-pnj");
const planche = document.querySelector(".planche");
const boutiqueTv = document.querySelector(".boutique-tv");
const sanctuaireTv = document.querySelector(".sanctuaire-tv");
const precedemment = document.querySelector(".precedemment");
const episode = document.querySelector(".episode");
const cartonRumeur = document.querySelector(".carton-rumeur");
const cartonHeros = document.querySelector(".carton-heros");
const tableeHeros = document.querySelector(".tablee-heros");
const fichesTv = document.querySelector(".fiches-tv");
const legendeHeros = document.querySelector(".legende-heros");
const combatTv = document.querySelector(".combat-tv");
const attenteTv = document.querySelector(".attente-tv");
const feuilleTv = document.querySelector(".document-tv");
const prochaine = accueil.querySelector(".prochaine");
precedemment.querySelector("header").append(accueil.querySelector(".marque").cloneNode(true));
tableeHeros.querySelector("header").prepend(accueil.querySelector(".marque").cloneNode(true));
episode.querySelector(".generique").prepend(accueil.querySelector(".marque").cloneNode(true));
// Le point doré du MJ, sur son propre calque (pointeur-tv.js).
const pointeurTv = new PointeurTv(document.querySelector(".pointeur-tv"));
// Les horloges de la menace (horloges-tv.js), rangées juste avant le calque du pointeur pour passer sous lui.
const horlogesTv = new HorlogesTv(document.querySelector(".pointeur-tv"));
// ---- Les jets à distance : le bandeau d'un test lancé depuis le coin des joueurs (jet-tv.js). ----
const jetTv = new JetTv();
// ---- Les dés d'aventure : les deux réserves, en petit, en bas à droite (reserve-tv.js). ----
const reserveTv = new ReserveTv(legendeHeros);

export { DELAI_RESEAU, FEU_ECRAN, PEINT_TV, REGLAGES_TV, TV_SALON, accueil, attenteTv, boutiqueTv, canvas, carton, cartonHeros, cartonPnj, cartonRumeur, combatTv, connexion, enPortrait, episode, feuilleTv, fichesTv, horlogesTv, indice, jetTv, legendeHeros, planche, plein, pointeurTv, precedemment, prochaine, reserveTv, sanctuaireTv, tableeHeros, telephone, toileBrume, toileFeu, toilePlan };
