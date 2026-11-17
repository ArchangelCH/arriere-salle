// L'écart mot à mot entre deux textes : ce qu'un joueur change dans un passage de l'histoire de son héros, que le
// MJ lit dans sa boîte (demandes/lore.js), et ce que le MJ a retouché, que le joueur relit (joueurs/histoire.js). D'abord
// paragraphe par paragraphe, puis mot à mot dans ce qui a changé : un long texte retouché aux deux bouts reste rapide,
// même sur un téléphone. Ce module ne fait que comparer : il ne lit ni n'envoie rien.

// Un mot (avec ses apostrophes : « l'auberge », « aujourd’hui »), une suite d'espaces, ou un signe seul.
const MOTS = /[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*|\s+|[^\s\p{L}\p{N}\p{M}]/gu;
// Au-delà de ce nombre de retouches (mots ou espaces), la partie changée se montre d'un bloc : retirée, puis ajoutée. Un
// texte réécrit de bout en bout se lit mieux ainsi, et la comparaison reste légère.
const RETOUCHES_MAX = 1500;

export function decouper(texte) {
  return String(texte ?? "").match(MOTS) || [];
}

function paragraphes(texte) {
  return String(texte ?? "").match(/[^\n]+|\n+/g) || [];
}

// Le plus court chemin de a à b (Myers) : [« - » ou « + », morceau] pour ce qui change, [« = », morceau] pour le reste ;
// null au-delà de dmax retouches. Chaque étape ne garde que sa bande de diagonales.
function myers(a, b, dmax) {
  const n = a.length;
  const m = b.length;
  const decalage = n + m + 1;
  const v = new Int32Array(2 * decalage + 1);
  const traces = [];
  for (let d = 0; d <= Math.min(n + m, dmax); d++) {
    traces.push(v.slice(decalage - d, decalage + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[decalage + k - 1] < v[decalage + k + 1]) ? v[decalage + k + 1] : v[decalage + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[decalage + k] = x;
      if (x >= n && y >= m) return remonter(a, b, traces, d);
    }
  }
  return null;
}

function remonter(a, b, traces, fin) {
  const ops = [];
  let x = a.length;
  let y = b.length;
  for (let d = fin; d >= 0; d--) {
    const t = traces[d];
    const lu = (k) => t[k + d];
    // D'où vient ce chemin à l'étape d'avant (à la toute première, du début des deux textes).
    const k = x - y;
    const avant = k === -d || (k !== d && lu(k - 1) < lu(k + 1)) ? k + 1 : k - 1;
    const px = d ? lu(avant) : 0;
    const py = d ? px - avant : 0;
    while (x > px && y > py) {
      x--;
      y--;
      ops.push(["=", a[x]]);
    }
    if (d && x === px) ops.push(["+", b[--y]]);
    else if (d) ops.push(["-", a[--x]]);
  }
  return ops.reverse();
}

// La suite d'opérations qui mène de a à b (tableaux de chaînes) : le début et la fin communs d'abord, puis Myers.
function suite(a, b) {
  let debut = 0;
  while (debut < a.length && debut < b.length && a[debut] === b[debut]) debut++;
  let fa = a.length;
  let fb = b.length;
  while (fa > debut && fb > debut && a[fa - 1] === b[fb - 1]) {
    fa--;
    fb--;
  }
  const milieu = myers(a.slice(debut, fa), b.slice(debut, fb), RETOUCHES_MAX)
    || [...a.slice(debut, fa).map((x) => ["-", x]), ...b.slice(debut, fb).map((x) => ["+", x])];
  return [...a.slice(0, debut).map((x) => ["=", x]), ...milieu, ...a.slice(fa).map((x) => ["=", x])];
}

function pousser(sortie, type, texte) {
  if (!texte) return;
  const dernier = sortie[sortie.length - 1];
  if (dernier && dernier.type === type) dernier.texte += texte;
  else sortie.push({ type, texte });
}

const lettres = (t) => (String(t).match(/[\p{L}\p{N}]+/gu) || []).length;

// Pour qu'un passage réécrit se lise d'un trait plutôt que mot à mot (« grands » devenu « Grimbal », « yeux » devenu « von »),
// un petit morceau égal pris entre deux changements les rejoint : une espace, une ponctuation, un ou deux mots courts.
// Puis chaque suite de changements se dit d'un bloc : ce qui est retiré, puis ce qui est ajouté.
function lisible(morceaux) {
  const m = morceaux.map((x) => ({ ...x }));
  const autour = (i, pas) => {
    let n = 0;
    for (let j = i + pas; j >= 0 && j < m.length && m[j].type !== "egal"; j += pas) n += m[j].texte.length;
    return n;
  };
  for (let encore = true; encore;) {
    encore = false;
    for (let i = 1; i < m.length - 1; i++) {
      if (m[i].type !== "egal") continue;
      const avant = autour(i, -1);
      const apres = autour(i, 1);
      const t = m[i].texte;
      if (avant && apres && (!lettres(t) || (lettres(t) <= 2 && t.length <= Math.min(avant, apres)))) {
        m[i].type = "pris";
        encore = true;
      }
    }
  }
  const sortie = [];
  let moins = "";
  let plus = "";
  const vider = () => {
    pousser(sortie, "retire", moins);
    pousser(sortie, "ajoute", plus);
    moins = plus = "";
  };
  for (const x of m) {
    if (x.type === "egal") {
      vider();
      pousser(sortie, "egal", x.texte);
    } else {
      if (x.type !== "ajoute") moins += x.texte;
      if (x.type !== "retire") plus += x.texte;
    }
  }
  vider();
  return sortie;
}

// Les morceaux de l'écart, dans l'ordre : { type : « egal », « retire » ou « ajoute », texte }. Entre deux morceaux égaux,
// ce qui est retiré vient avant ce qui est ajouté. Les morceaux égaux et retirés refont avant, les égaux et ajoutés après.
export function ecart(avant, apres) {
  const sortie = [];
  let retires = [];
  let ajoutes = [];
  const vider = () => {
    if (!retires.length && !ajoutes.length) return;
    let moins = "";
    let plus = "";
    for (const [op, x] of suite(decouper(retires.join("")), decouper(ajoutes.join("")))) {
      if (op === "=") {
        pousser(sortie, "retire", moins);
        pousser(sortie, "ajoute", plus);
        moins = plus = "";
        pousser(sortie, "egal", x);
      } else if (op === "-") moins += x;
      else plus += x;
    }
    pousser(sortie, "retire", moins);
    pousser(sortie, "ajoute", plus);
    retires = [];
    ajoutes = [];
  };
  for (const [op, x] of suite(paragraphes(avant), paragraphes(apres))) {
    if (op === "=") {
      vider();
      pousser(sortie, "egal", x);
    } else if (op === "-") retires.push(x);
    else ajoutes.push(x);
  }
  vider();
  return lisible(sortie);
}

// Ce que l'écart change, en mots : de quoi dire « 12 mots ajoutés, 3 retirés ».
export function bilan(morceaux) {
  const mots = (t) => (String(t).match(/[\p{L}\p{N}]+/gu) || []).length;
  return {
    ajoutes: morceaux.filter((m) => m.type === "ajoute").reduce((n, m) => n + mots(m.texte), 0),
    retires: morceaux.filter((m) => m.type === "retire").reduce((n, m) => n + mots(m.texte), 0),
  };
}

// L'écart en HTML, chaque texte passé par echapper : <ins> pour l'ajouté, <del> pour le retiré ; un saut de ligne reste
// un saut de ligne.
export function htmlEcart(morceaux, echapper) {
  const lignes = (t) => echapper(t).replace(/\n/g, "<br>");
  return morceaux.map((m) => {
    if (m.type === "ajoute") return `<ins>${lignes(m.texte)}</ins>`;
    if (m.type === "retire") return `<del>${lignes(m.texte)}</del>`;
    return lignes(m.texte);
  }).join("");
}
