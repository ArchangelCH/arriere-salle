// Les petits gestes de dessin que partagent le plan, les pions et les figurines (rendu.js, pions.js, figurine.js).
// Rien d'un navigateur récent : la TV a Chromium 79 (ni roundRect).

import { texte } from "../carte/rendu.js";

// Chrome perd des lettres quand une police de moins d'un pixel est agrandie par la transformation : on écrit en 32 px
// et on réduit le contexte. o : taille (en cases), police (« 700 {t}px Cinzel »), couleur, halo, et largeurMax (en
// cases) : un texte trop large se resserre au lieu de déborder.
export function ecrire(ctx, chaine, x, y, o) {
  const f = 32;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(o.taille / f, o.taille / f);
  if (o.largeurMax) {
    ctx.font = o.police.replace("{t}", f);
    const l = (ctx.measureText(chaine).width * o.taille) / f;
    if (l > o.largeurMax) ctx.scale(o.largeurMax / l, 1);
  }
  texte(ctx, chaine, 0, 0, { ...o, taille: f });
  ctx.restore();
}

// Un rectangle aux coins arrondis de r (jamais plus que la moitié d'un côté), en chemin.
export function rrect(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

// Un disque de rayon r, en chemin.
export function rond(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}
