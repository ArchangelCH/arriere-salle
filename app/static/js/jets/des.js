// Les dés libres, côté page : la même lecture que des.py sur le serveur (« 2D6+1 », « D6 », « 1D4-1 »), les mêmes
// bornes. La feuille « Lancer un test » du coin s'en sert pour écrire l'expression qu'elle envoie et dire ce qu'elle peut
// donner ; les dés roulent toujours dans l'atelier. Les cas communs sont dans tests/des-cas.json (outils/verifier_des.mjs).

export const FACES = [4, 6, 8, 10, 12, 20, 100];
export const NOMBRE_MAX = 5;
export const BONUS_MAX = 20;
const TEXTE_MAX = 30;
// Mêmes espaces permis que des.py : l'espace, l'insécable, l'insécable fine. Pas de \s ni de \d (ensembles différents).
const ESP = "[   ]*";
const EXPRESSION = new RegExp(`^${ESP}([0-9]{1,2})?${ESP}[dD]${ESP}([0-9]{1,3})${ESP}(?:([-+−])${ESP}([0-9]{1,3}))?${ESP}$`);

// Le D6 d'aventure : 1-2 Mouvement, 3-4 Posture, 5-6 In extremis.
export const EFFETS = { 1: "Mouvement", 2: "Mouvement", 3: "Posture", 4: "Posture", 5: "In extremis", 6: "In extremis" };

export function ecrire(nombre, faces, bonus = 0) {
  return `${nombre}D${faces}${bonus > 0 ? `+${bonus}` : bonus < 0 ? `-${-bonus}` : ""}`;
}

// { nombre, faces, bonus, texte } d'une expression lisible et dans les bornes, sinon null.
export function lire(texte) {
  if (typeof texte !== "string" || texte.length > TEXTE_MAX) return null;
  const m = EXPRESSION.exec(texte);
  if (!m) return null;
  const nombre = m[1] !== undefined ? Number(m[1]) : 1;
  const faces = Number(m[2]);
  const bonus = Number(m[4] || 0) * (m[3] === "-" || m[3] === "−" ? -1 : 1);
  if (nombre < 1 || nombre > NOMBRE_MAX || !FACES.includes(faces) || Math.abs(bonus) > BONUS_MAX) return null;
  return { nombre, faces, bonus, texte: ecrire(nombre, faces, bonus) };
}

// Ce que l'expression peut donner : « de 3 à 13 ».
export function bornes(d) {
  return { min: d.nombre + d.bonus, max: d.nombre * d.faces + d.bonus };
}

export const effet = (face) => EFFETS[face] || "";
