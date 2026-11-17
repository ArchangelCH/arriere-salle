// Le médaillon d'un aventurier : l'emblème de son élément sur un dégradé de ses couleurs, comme sur les fiches du kit,
// ou son portrait quand il en a un. Partagé par l'atelier, la fiche imprimée et la TV.

import { echapper as e } from "../api.js";
import { elementConnu, teintes } from "./regles.js";

function rayons(n, r1, r2, demi) {
  const rad = (d) => (d * Math.PI) / 180;
  let pts = "";
  for (let i = 0; i < n; i++) {
    const a = rad((i * 360) / n - 90);
    const g = a - rad(demi);
    const d = a + rad(demi);
    const p = (r, t) => `${(50 + r * Math.cos(t)).toFixed(1)},${(50 + r * Math.sin(t)).toFixed(1)}`;
    pts += `<polygon points="${p(r1, g)} ${p(r2, a)} ${p(r1, d)}"/>`;
  }
  return pts;
}

// Les dix emblèmes du kit, et quelques autres pour les éléments sans liste de dons.
const EMBLEMES = {
  Lumière: `<circle cx="50" cy="50" r="15"/>${rayons(12, 21, 40, 6)}`,
  Feu: '<path d="M50 8 C58 26 76 36 73 60 C71 78 60 90 50 90 C36 90 25 79 27 61 C29 47 40 43 39 27 C47 35 51 26 50 8 Z"/>'
    + '<path d="M50 50 C55 60 62 64 60 74 C58 82 54 86 50 86 C44 86 39 81 40 73 C41 66 47 64 50 50 Z" fill-opacity=".45"/>',
  Eau: '<path d="M50 10 C63 33 76 47 76 63 A26 26 0 0 1 24 63 C24 47 37 33 50 10 Z"/>'
    + '<path d="M38 63 A13 13 0 0 0 50 76" fill="none" stroke-width="4" stroke-linecap="round" stroke-opacity=".5"/>',
  Air: '<g fill="none" stroke-width="6" stroke-linecap="round"><path d="M14 38 H58 A11 11 0 1 0 47 27"/>'
    + '<path d="M14 54 H76 A11 11 0 1 1 65 65"/><path d="M22 70 H44 A8 8 0 1 1 36 78"/></g>',
  Terre: '<path d="M8 80 L36 34 L50 54 L64 24 L92 80 Z"/><path d="M64 24 L72 38 L66 36 L60 42 Z" fill-opacity=".45"/>',
  Métal: '<path d="M16 36 H70 C82 36 90 44 92 52 H72 V58 H60 V70 H74 V80 H28 V70 H42 V58 H30 C22 58 16 50 16 43 Z"/>',
  Ténèbres: '<path d="M60 14 A36 36 0 1 0 60 86 A28 28 0 1 1 60 14 Z"/><polygon points="72,30 75,38 83,38 77,43 79,51 72,46 65,51 67,43 61,38 69,38"/>',
  Son: '<circle cx="28" cy="50" r="8"/><g fill="none" stroke-width="6" stroke-linecap="round">'
    + '<path d="M44 34 A22 22 0 0 1 44 66"/><path d="M56 24 A36 36 0 0 1 56 76"/><path d="M68 14 A50 50 0 0 1 68 86"/></g>',
  Nature: '<path d="M20 82 C20 40 50 14 84 14 C84 52 60 82 20 82 Z"/><path d="M24 78 C40 58 56 42 74 26" fill="none" stroke-width="3.5" stroke-opacity=".5"/>',
  Sang: '<path d="M50 10 C63 33 76 47 76 63 A26 26 0 0 1 24 63 C24 47 37 33 50 10 Z"/>',
  Temps: '<path d="M26 12 H74 V20 C74 36 57 44 57 50 C57 56 74 64 74 80 V88 H26 V80 C26 64 43 56 43 50 C43 44 26 36 26 20 Z"/>'
    + '<path d="M36 80 C36 70 50 66 50 60 C50 66 64 70 64 80 Z" fill-opacity=".45"/>',
  autre: '<polygon points="50,8 58,40 92,50 58,60 50,92 42,60 8,50 42,40"/><circle cx="50" cy="50" r="7" fill-opacity=".45"/>',
};

export function svgEmbleme(element) {
  const el = elementConnu(element);
  const cle = el ? (el.embleme || el.nom) : "autre";
  return `<svg viewBox="0 0 100 100" class="embleme" fill="#fbf4e3" stroke="#fbf4e3" aria-hidden="true">${EMBLEMES[cle] || EMBLEMES.autre}</svg>`;
}

export function fondMedaillon(a) {
  const [clair, milieu, sombre] = teintes(a);
  return `radial-gradient(circle at 50% 42%, ${clair} 0%, ${milieu} 48%, ${sombre} 100%)`;
}

// Dans l'atelier seulement : le portrait réduit (WebP de 160 ou 320 px, /api/table/vignette) au lieu de l'image entière
// (commun/miniature.js fait de même ; ce module sert aussi à la TV et au coin, qui n'ont pas ce fichier).
const dansAtelier = () => !!document.body?.classList.contains("atelier");
function portraitLeger(url, classe) {
  const m = typeof url === "string" && dansAtelier() ? /^\/media\/([A-Za-z0-9][A-Za-z0-9._-]{0,120})$/.exec(url) : null;
  return m ? `/api/table/vignette/${m[1]}?l=${/\bmini\b/.test(classe) ? 160 : 320}&f=webp` : url;
}

// portrait : false pour forcer l'emblème (la fiche en noir et blanc, par exemple).
export function htmlMedaillon(a, { classe = "", portrait = true } = {}) {
  const image = portrait && a.illustration;
  return `<span class="medaillon-heros ${classe}" style="background: ${fondMedaillon(a)}">${image ? `<img src="${e(portraitLeger(a.illustration, classe))}" ${dansAtelier() ? 'loading="lazy" decoding="async" ' : ""}alt="">` : svgEmbleme(a.element)}</span>`;
}
