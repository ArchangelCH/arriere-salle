// Ce qui manque au navigateur de la TV (LG webOS 6, Chromium 79). Le script de la TV est transpilé pour lui (la syntaxe
// récente est réécrite), mais les fonctions plus récentes que lui doivent exister : chacune n'est posée que si elle manque,
// sans rien changer sur un navigateur récent. Importé en tête de table.js.

function poser(cible, nom, valeur) {
  if (cible && !(nom in cible)) Object.defineProperty(cible, nom, { value: valeur, writable: true, configurable: true });
}

// .at(-1) : Chromium 92
function aLaPosition(n) {
  const i = Math.trunc(n) || 0;
  const k = i < 0 ? this.length + i : i;
  return k < 0 || k >= this.length ? undefined : this[k];
}
poser(Array.prototype, "at", aLaPosition);
poser(String.prototype, "at", aLaPosition);
poser(Object.getPrototypeOf(Int8Array.prototype), "at", aLaPosition);

// findLast, findLastIndex : Chromium 97 ; toSorted, toReversed : Chromium 110
poser(Array.prototype, "findLast", function findLast(f, ceci) {
  for (let i = this.length - 1; i >= 0; i--) if (f.call(ceci, this[i], i, this)) return this[i];
  return undefined;
});
poser(Array.prototype, "findLastIndex", function findLastIndex(f, ceci) {
  for (let i = this.length - 1; i >= 0; i--) if (f.call(ceci, this[i], i, this)) return i;
  return -1;
});
poser(Array.prototype, "toSorted", function toSorted(f) {
  return Array.prototype.slice.call(this).sort(f);
});
poser(Array.prototype, "toReversed", function toReversed() {
  return Array.prototype.slice.call(this).reverse();
});

// Object.hasOwn : Chromium 93
poser(Object, "hasOwn", (objet, cle) => Object.prototype.hasOwnProperty.call(Object(objet), cle));

// replaceAll : Chromium 85
poser(String.prototype, "replaceAll", function replaceAll(motif, remplacement) {
  if (motif instanceof RegExp) {
    if (!motif.global) throw new TypeError("replaceAll exige une expression régulière globale");
    return String(this).replace(motif, remplacement);
  }
  const echappe = String(motif).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(this).replace(new RegExp(echappe, "g"), remplacement);
});

// Promise.any et AggregateError : Chromium 85
if (typeof AggregateError === "undefined") {
  window.AggregateError = class AggregateError extends Error {
    constructor(erreurs, message = "") {
      super(message);
      this.name = "AggregateError";
      this.errors = Array.from(erreurs);
    }
  };
}
poser(Promise, "any", (promesses) => new Promise((ok, ko) => {
  const liste = Array.from(promesses);
  const erreurs = [];
  let restantes = liste.length;
  if (!restantes) ko(new AggregateError([], "Aucune promesse"));
  liste.forEach((p, i) => Promise.resolve(p).then(ok, (err) => {
    erreurs[i] = err;
    if (--restantes === 0) ko(new AggregateError(erreurs, "Toutes les promesses ont échoué"));
  }));
}));

// AbortSignal.timeout : Chromium 103
if (typeof AbortSignal !== "undefined") {
  poser(AbortSignal, "timeout", (ms) => {
    const controle = new AbortController();
    setTimeout(() => controle.abort(), ms);
    return controle.signal;
  });
}

// structuredClone : Chromium 98. Données seules (objets, tableaux, dates, Map, Set, tableaux typés), comme ce que la TV reçoit.
if (typeof structuredClone !== "function") {
  const cloner = (v, vus) => {
    if (v === null || typeof v !== "object") return v;
    if (vus.has(v)) return vus.get(v);
    if (v instanceof Date) return new Date(v.getTime());
    if (v instanceof RegExp) return new RegExp(v.source, v.flags);
    if (v instanceof ArrayBuffer) return v.slice(0);
    if (ArrayBuffer.isView(v)) return new v.constructor(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
    let copie;
    if (v instanceof Map) {
      copie = new Map();
      vus.set(v, copie);
      v.forEach((x, k) => copie.set(cloner(k, vus), cloner(x, vus)));
      return copie;
    }
    if (v instanceof Set) {
      copie = new Set();
      vus.set(v, copie);
      v.forEach((x) => copie.add(cloner(x, vus)));
      return copie;
    }
    copie = Array.isArray(v) ? [] : {};
    vus.set(v, copie);
    for (const k of Object.keys(v)) copie[k] = cloner(v[k], vus);
    return copie;
  };
  window.structuredClone = (v) => cloner(v, new Map());
}

// crypto.randomUUID : Chromium 92, et jamais en HTTP simple, même récent.
if (window.crypto && crypto.getRandomValues && typeof crypto.randomUUID !== "function") {
  crypto.randomUUID = () => {
    const o = crypto.getRandomValues(new Uint8Array(16));
    o[6] = (o[6] & 0x0f) | 0x40;
    o[8] = (o[8] & 0x3f) | 0x80;
    const h = Array.from(o, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
}

// roundRect : Chromium 99. Rayon unique ou un par coin, comme la fonction d'origine.
function roundRect(x, y, l, h, rayons = 0) {
  const liste = (Array.isArray(rayons) ? rayons : [rayons]).map((r) => Math.abs(r && typeof r === "object" ? r.x || 0 : +r || 0));
  const [hg, hd = hg, bd = hg, bg = hd] = liste;
  const max = Math.min(Math.abs(l), Math.abs(h)) / 2;
  const [a1, a2, a3, a4] = [hg, hd, bd, bg].map((r) => Math.min(r, max));
  this.moveTo(x + a1, y);
  this.arcTo(x + l, y, x + l, y + h, a2);
  this.arcTo(x + l, y + h, x, y + h, a3);
  this.arcTo(x, y + h, x, y, a4);
  this.arcTo(x, y, x + l, y, a1);
  this.closePath();
}
if (typeof CanvasRenderingContext2D !== "undefined") poser(CanvasRenderingContext2D.prototype, "roundRect", roundRect);
if (typeof Path2D !== "undefined") poser(Path2D.prototype, "roundRect", roundRect);

// replaceChildren : Chromium 86
poser(Element.prototype, "replaceChildren", function replaceChildren(...noeuds) {
  while (this.lastChild) this.removeChild(this.lastChild);
  this.append(...noeuds);
});
