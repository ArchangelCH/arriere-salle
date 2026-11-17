// Les documents dans Séances : « À montrer » (Jouer) les liste avec leur bouton de la TV, et le compte rendu de « Jouer
// la scène » propose de montrer celui que la scène lie. Rien ne part seul vers la TV : chaque document attend un clic,
// comme les cartons des PNJ.

import { echapper as e } from "../api.js";
import { htmlDocumentTelephone } from "../prives/telephone.js";
import { nomDuDocument } from "./tv.js";

const tronquer = (t, n) => (t && t.length > n ? `${t.slice(0, n - 1)}…` : t || "");
const guillemets = (t) => `« ${t} »`;

// Jouer › À montrer : les documents de « Sous la main », chacun avec « Montrer à la TV » ou « Retirer de la TV », et
// « Remettre à… » le seul téléphone d'un héros (lot F2, prives/telephone.js).
// liste : les fiches, dans l'ordre du déroulé ; t : l'état de la table. Rien quand la séance n'en prévoit aucun.
export function htmlDocumentsAMontrer(liste, t = {}) {
  if (!liste.length) return "";
  return `<h3>Documents</h3>
        <ul>${liste.map((x) => `
          <li><span>${e(tronquer(nomDuDocument(x), 70))}</span>
            ${t.vue === "document" && t.document === x.id ? `<button data-action="document-retirer" data-document="${e(x.id)}">Retirer de la TV</button>` : `<button data-action="document-montrer" data-document="${e(x.id)}">Montrer à la TV</button>`}
            ${htmlDocumentTelephone(x, { court: true })}</li>`).join("")}
        </ul>`;
}

// Le compte rendu de « Jouer la scène » : les documents que lie la scène sont rappelés, et le premier se montre d'un
// clic dans le message. montrer(x) : le geste « Montrer à la TV » de la page.
export function documentsAuCompteRendu(documents, montrer) {
  const liste = documents || [];
  if (!liste.length) return { texte: "", action: null };
  const noms = liste.map((x) => guillemets(tronquer(nomDuDocument(x), 40)));
  const texte = ` À remettre : ${noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}` : noms[0]}.`;
  return { texte, action: { libelle: liste.length > 1 ? `Montrer ${guillemets(tronquer(nomDuDocument(liste[0]), 24))}` : "Montrer le document", faire: () => montrer(liste[0]) } };
}
