// La page où revenir après la connexion (« ?suite= », posée par api.js sur un 401) : une adresse du coin, jamais une
// autre. Le navigateur retire tabulations et sauts de ligne d'une adresse avant de la lire (« /<tab>/ailleurs » devient
// « //ailleurs », un autre site) et lit « \ » comme « / » : ni l'un ni l'autre n'entre, et l'adresse passe par le même
// analyseur que le sien. Rend "" quand il n'y a pas de suite à suivre.
export function suiteSure(valeur, origine) {
  if (typeof valeur !== "string" || !valeur.startsWith("/") || valeur.startsWith("//") || /[\u0000-\u001f\u007f\\]/.test(valeur)) return "";
  let adresse;
  try {
    adresse = new URL(valeur, origine);
  } catch {
    return "";
  }
  if (adresse.origin !== new URL(origine).origin) return "";
  return valeur === "/" ? "" : valeur;
}
