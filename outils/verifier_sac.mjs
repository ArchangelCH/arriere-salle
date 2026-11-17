// Vérifie le sac de la page (app/static/js/aventuriers/etat.js) sur les cas communs de tests/sac-cas.json : corpsDuSac
// prévoit ce que l'atelier rejouera (inventaire.rejouer), et les quantités se lisent et s'écrivent comme sur le serveur
// (quantiteDe, ligneDe, douteuse, cleNom, jumelles de commun/inventaire.py). tests/test_inventaire.py passe les mêmes
// cas côté serveur.
// node outils/verifier_sac.mjs

import { readFileSync } from "node:fs";
import { avecGeste, cleNom, corpsDuSac, douteuse, ligneDe, lisible, quantiteDe, reprisDuSac, resumeSac } from "../app/static/js/aventuriers/etat.js";

const { cas, quantites, lignes, douteuses, memes_noms: memesNoms } = JSON.parse(readFileSync(new URL("../tests/sac-cas.json", import.meta.url), "utf8"));
let defauts = 0;
const noter = (quoi, lu, attendu) => {
  if (JSON.stringify(lu) === JSON.stringify(attendu)) return;
  defauts++;
  console.log(`DÉFAUT : ${quoi} : ${JSON.stringify(lu)} au lieu de ${JSON.stringify(attendu)}`);
};
for (const c of cas) {
  const r = corpsDuSac(c.fiche, c.geste);
  if (c.attendu.erreur) noter(c.nom, Boolean(r.erreur), true);
  else noter(c.nom, r, c.attendu);
}
for (const [texte, nom, n] of quantites) {
  noter(`quantité de ${JSON.stringify(texte)}`, quantiteDe(texte), [nom, n]);
  // Ce qui se lit se réécrit et se relit pareil, à toute quantité : un de plus ne perd jamais le compte.
  if (nom && !douteuse(texte)) for (const k of [1, 2, 999]) noter(`aller et retour de ${JSON.stringify(texte)} ×${k}`, quantiteDe(ligneDe(nom, k)), [nom, k]);
}
for (const [nom, n, texte] of lignes) noter(`ligne de ${JSON.stringify(nom)} ×${n}`, ligneDe(nom, n), texte);
for (const [texte, oui] of douteuses) noter(`ligne douteuse ${JSON.stringify(texte)}`, douteuse(texte), oui);
for (const [a, b, meme] of memesNoms) noter(`même nom ${JSON.stringify(a)} et ${JSON.stringify(b)}`, cleNom(a) === cleNom(b), meme);

// La vente de la boutique (boutiques.js, vendre) et son annulation (annulerVente) : l'article entre par le geste
// « ajouter », et se reprend par son nom, quel que soit le compte de la ligne entre-temps.
let autres = 0;
const vente = (sac, article) => avecGeste({ equipement: sac }, { genre: "ajouter", liste: "equipement", texte: article }).equipement;
const annulee = (sac, article) => {
  const corps = reprisDuSac({ equipement: sac }, article);
  return corps ? corps.equipement.apres : null;
};
for (const [quoi, lu, attendu] of [
  ["vente d'un article neuf", vente(["Cape"], "Potion de soins"), ["Cape", "Potion de soins"]],
  ["vente d'un article déjà dans le sac", vente(["Potion de soins ×2", "Cape"], "Potion de soins"), ["Potion de soins ×3", "Cape"]],
  ["vente d'un lot", vente(["Flèches ×20"], "Flèches x20"), ["Flèches ×40"]],
  ["annuler la vente d'un article neuf", annulee(["Cape", "Potion de soins"], "Potion de soins"), ["Cape"]],
  ["annuler la vente : la ligne décompte", annulee(["Potion de soins ×3", "Cape"], "Potion de soins"), ["Potion de soins ×2", "Cape"]],
  ["annuler la vente après un autre achat", annulee(["Cape", "potion de soins ×5"], "Potion de soins"), ["Cape", "potion de soins ×4"]],
  ["annuler la vente d'un lot", annulee(["Flèches ×40"], "Flèches x20"), ["Flèches ×20"]],
  ["annuler la vente d'un lot entamé", annulee(["Flèches ×12"], "Flèches ×20"), []],
  ["annuler la vente : l'article n'est plus là", annulee(["Cape"], "Potion de soins"), null],
  ["annuler la vente d'une ligne qui ne se compte pas", annulee(["Planche 2 x 4", "Cape", "Planche 2 x 4"], "Planche 2 x 4"), ["Planche 2 x 4", "Cape"]],
  ["l'aperçu d'un geste déjà porté par la fiche relue ne le recompte pas", avecGeste({ equipement: ["Torche ×3"] }, { genre: "quantite", liste: "equipement", rang: 0, avant: "Torche ×2", de: 1, strict: true }).equipement, ["Torche ×3"]],
  ["deux gestes en route se suivent dans l'aperçu", [["Torche", 1], ["Torche ×2", 1]].reduce((f, [avant, de]) => avecGeste(f, { genre: "quantite", liste: "equipement", rang: 0, avant, de, strict: true }), { equipement: ["Torche"] }).equipement, ["Torche ×3"]],
  ["le résumé compte les exemplaires", resumeSac({ or: 3, equipement: ["Potion de soins ×3", "Cape", "Planche 2 x 4"], objets: ["Un dé"] }), "3 pièces d'or, 6 objets"],
  ["sur une feuille, le compte tient à son nom", lisible("Potion de soins x3"), "Potion de soins\u00a0×3"],
  ["sur une feuille, un seul exemplaire reste tel quel", lisible("Cape"), "Cape"],
  ["sur une feuille, une mesure reste telle quelle", lisible("Planche 2 x 4"), "Planche 2 x 4"],
]) {
  autres++;
  noter(quoi, lu, attendu);
}
const total = autres + cas.length + quantites.length + lignes.length + douteuses.length + memesNoms.length;
console.log(defauts ? `${defauts} défaut(s) sur ${total} cas` : `${cas.length} gestes, ${quantites.length} quantités, ${lignes.length} lignes, ${douteuses.length} lignes douteuses et ${memesNoms.length} noms, ${autres} ventes et affichages : tout est juste`);
process.exit(defauts ? 1 : 0);
