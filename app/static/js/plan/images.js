// Les images du MJ posées sur un plan : un objet de plan.objets à la clé « image », avec son adresse, sa taille
// en cases (l × h avant rotation), sa rotation, sa couche (au-dessus des pions ou dessous) et son « franchissable » (lu par
// plan/deplacement.js). Les moteurs de rendu des meubles l'ignorent (clé inconnue) : il se dessine ici, sous les pions
// avec le fond du plan, ou par-dessus eux à chaque image. Une image cachée n'arrive pas jusqu'à la TV (plan_public) ;
// dans l'atelier, elle est pâle et cerclée de rouge, comme un meuble caché.

import { emprise, objetVisible } from "./modele.js";

export const CLE_IMAGE = "image";
export const estImage = (o) => !!o && o.cle === CLE_IMAGE;

// Les images d'un plan, chargées une fois par adresse : quand l'une arrive, pret() repeint ce qu'il faut.
export function chargerImagesPlan(plan, cache, pret) {
  for (const o of plan.objets || []) {
    if (!estImage(o) || !o.image || cache.has(o.image)) continue;
    const img = new Image();
    img.onload = () => pret(o.dessus === true);
    img.src = o.image;
    cache.set(o.image, img);
  }
}

// Y a-t-il une image à dessiner au-dessus des pions ? (la vue ne fait rien de plus pour un plan qui n'en a pas)
export const imagesDessus = (plan) => (plan.objets || []).some((o) => estImage(o) && o.dessus === true);

// Dessine les images d'une couche (dessus : au-dessus des pions, sinon dessous) dans la zone, en cases.
export function dessinerImagesPlan(ctx, p, zone, cache, { dessus = false, joueurs = false } = {}) {
  if (!cache) return;
  for (const o of p.objets || []) {
    if (!estImage(o) || (o.dessus === true) !== dessus) continue;
    const b = emprise(o);
    if (b.x1 < zone.x0 - 1 || b.x0 > zone.x1 + 1 || b.y1 < zone.y0 - 1 || b.y0 > zone.y1 + 1) continue;
    if (joueurs && !objetVisible(p, o)) continue;
    const img = o.image && cache.get(o.image);
    const cache_ = !joueurs && !!o.cache;
    ctx.save();
    if (cache_) ctx.globalAlpha = 0.55;
    ctx.translate((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    ctx.rotate(((o.rot || 0) * Math.PI) / 180);
    if (img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, -o.l / 2, -o.h / 2, o.l, o.h);
    } else if (!joueurs) {
      // Une image qui n'est pas encore là (ou introuvable) : son cadre, pour le MJ seul.
      ctx.setLineDash([0.12, 0.08]);
      ctx.strokeStyle = "rgba(224,181,98,.7)";
      ctx.lineWidth = 0.04;
      ctx.strokeRect(-o.l / 2 + 0.03, -o.h / 2 + 0.03, o.l - 0.06, o.h - 0.06);
    }
    ctx.restore();
    if (cache_) {
      ctx.save();
      ctx.setLineDash([0.1, 0.08]);
      ctx.strokeStyle = "#e0584c";
      ctx.lineWidth = 0.04;
      ctx.strokeRect(b.x0 + 0.04, b.y0 + 0.04, b.l - 0.08, b.h - 0.08);
      ctx.restore();
    }
  }
}
