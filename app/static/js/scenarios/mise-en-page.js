// La mise en page proposée d'un chapitre : le texte relu, corrigé et mis en page attend à côté de celui du MJ, qui
// l'accepte en entier, passage par passage, ou le refuse. Ici, ce qui se calcule sans toucher à la page : l'empreinte
// d'un texte (la même que app/api/scenarios_api.py, tests/mise-en-page-cas.json), les passages qui changent d'un texte à
// l'autre, et le texte que donnent les choix du MJ. Vérifié par outils/verifier_mise_en_page.mjs.

// La longueur en octets et un FNV-1a de 32 bits : de quoi savoir si le chapitre a changé depuis la relecture, sans le
// chiffrement du navigateur (indisponible en http sur le réseau local).
export function empreinte(texte) {
  const octets = new TextEncoder().encode(String(texte ?? ""));
  let h = 0x811c9dc5;
  for (const o of octets) h = Math.imul(h ^ o, 0x01000193) >>> 0;
  return `${octets.length}-${h.toString(16).padStart(8, "0")}`;
}

// Chaque ligne avec son saut de ligne : remises bout à bout, elles refont le texte au caractère près.
const lignes = (texte) => String(texte ?? "").match(/[^\n]*\n|[^\n]+$/g) || [];

// Les lignes communes aux deux textes, dans l'ordre (plus longue sous-suite commune) : [i dans a, j dans b].
function communes(a, b) {
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const paires = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) paires.push([i++, j++]);
    else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return paires;
}

// Les morceaux qui mènent du texte du MJ au texte proposé, dans l'ordre : { egal: true, texte } pour ce qui ne change
// pas, { avant, apres } pour un passage qui change : des lignes qui se suivent (un intertitre et la ligne vide ajoutée
// après lui se décident ensemble) ; deux paragraphes corrigés que sépare une ligne vide restent deux passages.
export function passages(avant, apres) {
  const a = lignes(avant);
  const b = lignes(apres);
  let debut = 0;
  while (debut < a.length && debut < b.length && a[debut] === b[debut]) debut++;
  let fa = a.length;
  let fb = b.length;
  while (fa > debut && fb > debut && a[fa - 1] === b[fb - 1]) {
    fa--;
    fb--;
  }
  const brut = [];
  const pousser = (m) => {
    const dernier = brut[brut.length - 1];
    if (m.egal && dernier?.egal) dernier.texte += m.texte;
    else if (!m.egal && dernier && !dernier.egal) {
      dernier.avant += m.avant;
      dernier.apres += m.apres;
    } else brut.push(m);
  };
  if (debut) pousser({ egal: true, texte: a.slice(0, debut).join("") });
  let i = debut;
  let j = debut;
  for (const [x, y] of [...communes(a.slice(debut, fa), b.slice(debut, fb)).map(([p, q]) => [p + debut, q + debut]), [fa, fb]]) {
    if (x > i || y > j) pousser({ avant: a.slice(i, x).join(""), apres: b.slice(j, y).join("") });
    if (x < fa) pousser({ egal: true, texte: a[x] });
    i = x + 1;
    j = y + 1;
  }
  if (fa < a.length) pousser({ egal: true, texte: a.slice(fa).join("") });
  return brut;
}

// Le texte que donnent les choix du MJ : accepte(rang) dit si le passage de ce rang (parmi ceux qui changent) prend
// le texte proposé ; refusé ou pas encore tranché, il garde le texte du MJ.
export function appliquer(morceaux, accepte) {
  let rang = 0;
  return morceaux.map((m) => (m.egal ? m.texte : accepte(rang++) ? m.apres : m.avant)).join("");
}
