// Web Worker du relief peint : garde le terrain et ses champs, calcule le raster des zones demandées et le renvoie en
// tableaux d'octets (Chromium 79, celui de la TV, n'a pas de canvas hors écran). Dans l'atelier, il se charge en module ;
// pour la TV, le Dockerfile en fait un script classique (tv/peint-worker.js).

import { creerBruit } from "./geo.js";
import { appliquerMorceaux, calculerRaster } from "./peint-calcul.js";

let donnees = null;

self.onmessage = (ev) => {
  const m = ev.data;
  if (m.genre === "carte") {
    donnees = m.donnees;
    donnees.bruit = creerBruit(((donnees.graine | 0) + 7919) >>> 0).bruit;
    return;
  }
  if (m.genre === "morceaux") {
    if (donnees) appliquerMorceaux(donnees, m.morceaux);
    return;
  }
  if (m.genre === "raster") {
    try {
      if (!donnees) throw new Error("carte absente");
      const t0 = performance.now();
      const r = calculerRaster(donnees, m.X0, m.Y0, m.wpx, m.hpx, m.R);
      self.postMessage({ id: m.id, couleur: r.couleur, ombre: r.ombre, lumiere: r.lumiere, duree: performance.now() - t0 },
        [r.couleur.buffer, r.ombre.buffer, r.lumiere.buffer]);
    } catch (err) {
      self.postMessage({ id: m.id, erreur: String((err && err.message) || err) });
    }
  }
};
