// Passage entre la carte enregistrée (JSON, grilles en base64) et la carte en mémoire (tableaux d'octets).

import { depuisBase64, versBase64 } from "./geo.js";

// La carte reçue est du JSON : une copie par JSON suffit, et le navigateur de la TV (Chromium 79) ignore structuredClone.
export function decoderCarte(json) {
  const { terrain, brouillard, ...reste } = json;
  const carte = JSON.parse(JSON.stringify(reste));
  carte.terrain = depuisBase64(terrain);
  carte.brouillard = brouillard ? depuisBase64(brouillard) : new Uint8Array(json.largeur * json.hauteur);
  carte.traces ||= [];
  carte.marqueurs ||= [];
  carte.etiquettes ||= [];
  carte.decor ||= {};
  return carte;
}

export function encoderCarte(carte) {
  return { ...carte, terrain: versBase64(carte.terrain), brouillard: versBase64(carte.brouillard) };
}
