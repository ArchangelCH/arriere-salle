// Petits outils de l'écran de la table : images légères, lecture du serveur, numéros de demande.

import { htmlMedaillon } from "../aventuriers/embleme.js";
import { DELAI_RESEAU, S } from "./etat.js";

// Sur la table publique, un portrait réduit (/api/table/vignette, vignettes.py) à la place de l'image entière : un
// téléphone sur un réseau lent tire quelques dizaines de Ko par médaillon. La TV du salon garde les images entières.
const MEDIA = /^\/media\/([A-Za-z0-9][A-Za-z0-9._-]{0,120})$/;
// transparence : une image du MJ garde ses pixels transparents.
function leger(url, largeur, transparence = false) {
  const m = S.internet && typeof url === "string" ? MEDIA.exec(url) : null;
  return m ? `/api/table/vignette/${m[1]}?l=${largeur}${transparence ? "&a=1" : ""}` : url;
}
// Un médaillon de héros, léger sur la table publique, chargé seulement quand il approche de l'écran (fiches qui défilent).
const medaillonTv = (a, largeur = 320) => htmlMedaillon({ ...a, illustration: leger(a.illustration, largeur) }).replace("<img ", '<img loading="lazy" decoding="async" ');

// ---------------------------------------------------------------- réseau, ordre des réponses

// Au coin des joueurs (source-coin.js), les lectures ne vont pas au serveur : la page les tient déjà.
let source = null;
function poserSource(fn) {
  source = fn;
}

// La réponse JSON du serveur, ou null (refus, silence au-delà du délai, réseau coupé).
async function lireJson(url) {
  if (source) return source(url);
  const controle = new AbortController();
  const minuterie = setTimeout(() => controle.abort(), DELAI_RESEAU);
  try {
    const r = await fetch(url, { signal: controle.signal });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(minuterie);
  }
}

// Chaque élément (carton, planche, image…) numérote ses demandes : une réponse arrivée après une demande plus récente
// est ignorée. Un « montrer » suivi d'un « retirer » rapide ne laisse donc jamais un carton à l'écran.
const numeros = {};
function numeroter(nom) {
  const n = (numeros[nom] || 0) + 1;
  numeros[nom] = n;
  return () => numeros[nom] === n;
}

// Ce que chaque élément montre, ou s'apprête à montrer : un état reçu ne relance que ce qui a changé. Un échec est
// oublié pour être retenté à l'état suivant (une reconnexion renvoie l'état courant).
const demandes = {};
function change(nom, cle) {
  const texte = JSON.stringify(cle ?? null);
  if (demandes[nom] === texte) return false;
  demandes[nom] = texte;
  return true;
}

export { change, demandes, leger, lireJson, medaillonTv, numeroter, poserSource };
