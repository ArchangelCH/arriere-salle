// Les champs de saisie rapide (Santé « -4 », Psy « -2 ») : un exemple grisé qui ne se prend pas pour une valeur, puis,
// pendant quelques secondes après la validation, ce qui vient d'être fait et comment le corriger (« +4 »). Le retour est
// gardé ici : les pages se redessinent après chaque geste, il est redonné à chaque dessin tant qu'il est récent.

const TENUE = 9000;
const recents = new Map();

// Le texte grisé d'un champ : un exemple, pas une valeur.
export const exemple = (genre) => (genre === "psy" ? "ex. -2" : "ex. -4");

const signe = (n) => String(n).replace("-", "−");

// cle : « h:<id> », « p:<id> », « a:<id> » ou « cp:sante:<id> » ; avant, apres : la valeur du champ avant et après.
export function noterRetour(cle, avant, apres, mot = "Santé") {
  const delta = Math.round(apres) - Math.round(avant);
  const texte = delta === 0
    ? `${mot} inchangée (${signe(apres)}).`
    : `${mot} ${delta < 0 ? "−" : "+"}${Math.abs(delta)} : ${signe(avant)} → ${signe(apres)}. Pour corriger : ${delta < 0 ? "+" : "-"}${Math.abs(delta)}.`;
  recents.set(cle, { texte, quand: Date.now() });
  return texte;
}

export function htmlRetour(cle) {
  const x = recents.get(cle);
  if (!x) return "";
  if (Date.now() - x.quand > TENUE) {
    recents.delete(cle);
    return "";
  }
  return `<small class="retour-saisie" role="status" data-quand="${x.quand}">${x.texte.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</small>`;
}
