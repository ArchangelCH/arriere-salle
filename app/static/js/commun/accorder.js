// Le redessin qui ne remplace que ce qui a changé (le combat, la compagnie de Séances › Jouer) : le bouton sur lequel le
// MJ est en train de cliquer, le champ où il écrit, gardent leur place (un clic sur « Suivant » juste après une saisie
// n'est pas perdu, un champ modifié n'est pas retiré du document en pleine frappe).
export function accorder(vieux, neuf) {
  if (vieux.nodeType !== neuf.nodeType || vieux.nodeName !== neuf.nodeName) return vieux.replaceWith(neuf);
  if (vieux.nodeType === Node.TEXT_NODE) {
    if (vieux.data !== neuf.data) vieux.data = neuf.data;
    return;
  }
  if (vieux.nodeType !== Node.ELEMENT_NODE || vieux.isEqualNode(neuf)) return;
  for (const a of [...vieux.attributes]) if (!neuf.hasAttribute(a.name)) vieux.removeAttribute(a.name);
  for (const a of [...neuf.attributes]) if (vieux.getAttribute(a.name) !== a.value) vieux.setAttribute(a.name, a.value);
  const valeur = vieux.tagName === "SELECT" ? neuf.value : null;
  accorderEnfants(vieux, neuf);
  if (valeur !== null) vieux.value = valeur;
  if (vieux.tagName === "INPUT" && (vieux.type === "checkbox" || vieux.type === "radio")) vieux.checked = neuf.checked;
}

export function accorderEnfants(vieux, neuf) {
  const a = [...vieux.childNodes];
  const b = [...neuf.childNodes];
  b.forEach((n, i) => (i < a.length ? accorder(a[i], n) : vieux.append(n)));
  for (const n of a.slice(b.length)) n.remove();
}
