// La campagne du kit, prête à jouer : l'installer dans l'atelier (fils, affiches, rumeurs, habitués) et retrouver son
// auberge parmi les lieux. Ce qu'elle contient (le nom caché de l'auberge, son règlement, son décor, les rumeurs de
// l'aide-mémoire, les fils découpés en étapes, les affiches, les habitués) est une donnée de la campagne,
// campagne/auberge.js. Des secrets du kit : ce module se charge à la demande, chez le MJ principal seulement.

import { api } from "../api.js";
import {
  CONTRATS_DU_KIT, DECOR_DE_L_AUBERGE, FILS_DU_KIT, HABITUES, NOMS_DE_L_AUBERGE, NOM_CACHE_DE_L_AUBERGE, REGLEMENT_DE_L_AUBERGE,
  REPERE_DE_L_AUBERGE, RUMEURS_DU_KIT,
} from "../campagne/auberge.js";
import { importerPnjDuKit } from "../pnj/kit.js";

// La page de l'auberge (auberge/auberge.js) lit ici le nom caché, le règlement, le décor et les rumeurs du kit.
export { DECOR_DE_L_AUBERGE, FILS_DU_KIT, NOM_CACHE_DE_L_AUBERGE, REGLEMENT_DE_L_AUBERGE, RUMEURS_DU_KIT };

// Les débuts de nom de l'auberge, en un seul motif sans majuscules ; aucun début donné : aucun nom ne la désigne.
const motif = (debuts) => new RegExp(debuts.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
const NOM_DE_L_AUBERGE = NOMS_DE_L_AUBERGE.length ? motif(NOMS_DE_L_AUBERGE) : null;

// L'auberge du kit parmi les lieux : par le repère de sa fiche, sinon par son nom.
export const aubergeDuKit = (lieux) =>
  lieux.find((l) => l.repere === REPERE_DE_L_AUBERGE) || (NOM_DE_L_AUBERGE && lieux.find((l) => NOM_DE_L_AUBERGE.test(l.nom))) || null;

// Installe ce qui manque (repéré par sa clé) : rien de ce qui existe déjà n'est modifié.
export async function installerCampagneDuKit() {
  await importerPnjDuKit();
  const [pnj, lieux, fils, contrats, rumeurs] = await Promise.all(
    ["/api/pnj", "/api/lieux", "/api/fils", "/api/contrats", "/api/rumeurs"].map((u) => api.get(u)),
  );
  const trouver = (liste, cle) => (liste.find((x) => x.repere === cle) || liste.find((x) => x.id === cle))?.id || "";
  const ajouts = { fils: 0, contrats: 0, rumeurs: 0, pnj: 0 };

  for (const f of FILS_DU_KIT) {
    if (fils.some((x) => x.repere === f.repere)) continue;
    fils.push(await api.post("/api/fils", { ...f, avance: 0, actif: true, etiquette: "maison", journal: [] }));
    ajouts.fils++;
  }
  for (const c of CONTRATS_DU_KIT) {
    if (contrats.some((x) => x.repere === c.repere)) continue;
    contrats.push(await api.post("/api/contrats", {
      ...c, commanditaire: c.commanditaire ? trouver(pnj, c.commanditaire) : "", lieu: c.lieu ? trouver(lieux, c.lieu) : "", fil: c.fil ? trouver(fils, c.fil) : "",
    }));
    ajouts.contrats++;
  }
  for (const r of RUMEURS_DU_KIT) {
    if (rumeurs.some((x) => x.repere === r.repere)) continue;
    rumeurs.push(await api.post("/api/rumeurs", { ...r, etat: "a-placer", fil: trouver(fils, r.fil) }));
    ajouts.rumeurs++;
  }
  for (const h of HABITUES) {
    if (pnj.some((x) => x.repere === h.repere)) continue;
    pnj.push(await api.post("/api/pnj", { statut: "vivant", ...h, lieu: trouver(lieux, h.lieu) }));
    ajouts.pnj++;
  }
  return ajouts;
}
