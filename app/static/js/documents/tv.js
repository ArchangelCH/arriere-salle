// Un document remis aux joueurs, à la TV : « Montrer à la TV » et « Retirer de la TV », les mêmes gestes depuis la page
// des documents et depuis Séances (Jouer, la scène en cours). Avant de montrer, ce que le document nomme d'encore inconnu
// des joueurs passe par la même question que les cartons de PNJ (carton-pnj.js) : il part vers la TV, la table publique
// et le carnet. Le document est une vue plein écran : le retirer rend la TV à ce qu'elle montrait avant (tv-commun.js).

import { api } from "../api.js";
import { annoncerTv } from "../ecran-tv/bouton-tv.js";
import { questionDesInconnus } from "../pnj/carton-pnj.js";
import { relireTv } from "../ecran-tv/etat-tv.js";
import { CHAMPS_LUS, avantDe, sansVuePleine } from "../ecran-tv/tv-commun.js";

const guillemets = (t) => `« ${t} »`;
export const nomDuDocument = (d) => String(d?.nom || "").trim() || "Document sans titre";

// L'état de la table relu à l'instant, sans ce que GET /api/table y ajoute.
async function etatDeLaTable() {
  const etat = await api.get("/api/table");
  for (const k of CHAMPS_LUS) delete etat[k];
  return etat;
}

// Les noms inconnus des joueurs que nomme le document enregistré (vide si rien, ou si le serveur ne répond pas).
export async function inconnusDuDocument(id) {
  try {
    return (await api.get(`/api/documents/${encodeURIComponent(id)}/inconnus`)).secrets || [];
  } catch {
    return [];
  }
}

// Vrai si le document peut partir : il ne nomme rien d'inconnu, ou le MJ a choisi de le montrer quand même.
export async function documentVerifie(d) {
  const secrets = await inconnusDuDocument(d.id);
  if (!secrets.length) return true;
  return questionDesInconnus(secrets, {
    titre: `Le document ${guillemets(nomDuDocument(d))}`,
    part: "Il part vers la TV et la table publique, puis dans le carnet des joueurs, et nomme ce que les joueurs ne connaissent pas encore :",
    montrer: "Montrer quand même",
  });
}

// Montre le document enregistré (l'appelant enregistre d'abord ce qui attend). Les cartons posés sur la TV s'effacent :
// le document se lit seul, en grand. Rend la réponse du serveur, ou null si le MJ a choisi de ne pas le montrer.
export async function montrerDocument(d) {
  if (!(await documentVerifie(d))) return null;
  const etat = await etatDeLaTable();
  const r = await api.put("/api/table", {
    ...etat, vue: "document", document: d.id, avant: avantDe(etat), lieu: null, pnj: null, rumeur: null, aventurier: null,
  });
  annoncerTv(r, `le document ${guillemets(nomDuDocument(d))}`);
  relireTv();
  return r;
}

// Retire ce document s'il est à la TV : elle revient à ce qu'elle montrait avant.
export async function retirerDocument(d) {
  const etat = await etatDeLaTable();
  if (etat.vue !== "document" || etat.document !== d.id) return null;
  const r = await api.put("/api/table", sansVuePleine(etat));
  annoncerTv(r, `le document ${guillemets(nomDuDocument(d))}`, { montre: false });
  relireTv();
  return r;
}

// Retouché pendant que la TV le montre : elle le relit (document_maj), sans revenir à son entrée.
export async function suivreALaTv(d) {
  const etat = await etatDeLaTable();
  if (etat.vue !== "document" || etat.document !== d.id || etat.document_maj === d.modifie) return;
  await api.put("/api/table", { ...etat, document_maj: d.modifie });
}

