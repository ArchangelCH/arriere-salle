// La carte de la région de la campagne (modèle « pays-castelblanc ») : son terrain, tiré de ses formes. Les données
// (formes, rivières, lieux, fiches et secrets) vivent dans campagne/pays.js ; ce module les reprend sous les noms que lit
// le générateur. Coordonnées en pourcentage de la carte : x vers l'est, y vers le sud.

import { B } from "./biomes.js";
import { FORMES as FORMES_PAYS } from "../campagne/pays.js";

export { FICHES, HAUTEUR_KM, LARGEUR_KM, LIEUX, RIVIERES, ROUTES } from "../campagne/pays.js";

// Formes du terrain, peintes dans l'ordre : une forme posée plus bas recouvre les précédentes. Le terrain de chacune,
// nommé par sa clé dans les données, devient son numéro (biomes.js).
export const FORMES = FORMES_PAYS.map((f) => ({ ...f, biome: B[f.biome] }));

function dansPolygone(x, y, pts) {
  let dedans = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

// Terrain en un point (x, y en pourcentage de la carte), bords rendus irréguliers par le bruit.
export function biomeS4(x, y, bruit) {
  const dx = 1.6 * bruit.bruit(x * 0.17 + 3.1, y * 0.17 - 7.3) + 0.6 * bruit.bruit(x * 0.6 - 11, y * 0.6 + 5);
  const dy = 1.6 * bruit.bruit(x * 0.17 - 13.7, y * 0.17 + 2.9) + 0.6 * bruit.bruit(x * 0.6 + 21, y * 0.6 - 9);
  const px = x + dx;
  const py = y + dy;
  let b = B.plaine;
  for (const f of FORMES) {
    if (f.points ? dansPolygone(px, py, f.points) : ((px - f.ellipse[0]) / f.ellipse[2]) ** 2 + ((py - f.ellipse[1]) / f.ellipse[3]) ** 2 < 1) {
      if (f.biome === B.cultures && b !== B.plaine) continue;
      b = f.biome;
    }
  }
  return b;
}
