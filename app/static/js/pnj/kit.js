// Les PNJ du kit : les ajouter au carnet. Leurs fiches (les figures de la campagne de départ, leurs secrets, leurs
// valeurs de combat) sont une donnée de la campagne, campagne/pnj.js. Des secrets du kit : ce module se charge à la
// demande, chez le MJ principal seulement.

import { api } from "../api.js";
import { PNJ_DU_KIT } from "../campagne/pnj.js";

export { PNJ_DU_KIT };

// Ajoute les PNJ du kit qui manquent (repérés par leur clé) ; les fiches existantes ne sont pas touchées.
// Le lieu est donné par le repère de sa fiche, qui survit à un renommage ou à une carte recréée.
export async function importerPnjDuKit() {
  const [existants, lieux] = await Promise.all([api.get("/api/pnj"), api.get("/api/lieux")]);
  const deja = new Set(existants.map((p) => p.repere).filter(Boolean));
  const lieuDe = (repere) => (lieux.find((l) => l.repere === repere) || lieux.find((l) => l.id === repere))?.id || "";
  let n = 0;
  for (const p of PNJ_DU_KIT) {
    if (deja.has(p.repere)) continue;
    await api.post("/api/pnj", { statut: "vivant", ...p, lieu: p.lieu ? lieuDe(p.lieu) : "" });
    n++;
  }
  return n;
}
