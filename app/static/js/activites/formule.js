// L'or d'une activité s'écrit en formule de dés (« 10 », « 2D6 », « 1D6 + 4 », « 2D6 × 5 », « -1D6 ») : la même lecture
// que jets.formule côté serveur, pour signaler pendant la frappe une formule que le dé ne saura pas tirer. Les cas communs
// sont dans tests/formules-cas.json (outils/verifier_formules.mjs, test_jets_et_activites.py).

const FORMULE = /^\s*([-−])?\s*(?:(\d{1,2})?\s*[dD]\s*(\d{1,3})|(\d{1,6}))(?:\s*[x×*]\s*(\d{1,3}))?(?:\s*([-+−])\s*(\d{1,5}))?\s*$/;
const DES = new Set([2, 3, 4, 6, 8, 10, 12, 20, 100]);

export function formuleLisible(texte) {
  const m = typeof texte === "string" ? FORMULE.exec(texte) : null;
  if (!m) return false;
  if (m[4] !== undefined) return true;
  const n = Number(m[2] || 1);
  return n >= 1 && n <= 20 && DES.has(Number(m[3])) && Number(m[5] || 1) >= 1;
}
