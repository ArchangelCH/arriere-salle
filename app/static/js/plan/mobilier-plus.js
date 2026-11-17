// Le mobilier ajouté le 09/11, dans les styles couleur et parchemin : la même main que rendu.js (aplats cernés d'un
// trait, palette de bois, de pierre et de tissu), vu de dessus, dans un repère centré en cases (hw, hh : demi-largeur et
// demi-profondeur avant rotation). En parchemin, la palette rend tout en encre sur papier. La teinte choisie (c.teinte)
// remplace le tissu des pièces qui en ont une ; elle ne vaut qu'en couleur.

import { hache } from "./modele.js";

// Pour les pièces d'avant qui ont une teinte : la couleur de la palette qu'elle remplace.
export const TEINTE_COULEUR = { tapis: "tissu", lit: "tissu2" };

// Les teintes propres au mobilier ajouté, en couleur ; en parchemin, du papier.
const EXTRA = {
  couleur: { toile: "#b39a6a", feuille: "#3f5a2a", feuilleClair: "#7d9a4c", sapin: "#2c4a2e", ecorce: "#5a4632", sombre: "#14100c", cristal: "#86b6d8", rune: "#a8342a", eauClair: "#6aa0c0", terre: "#6b4f33", verre: "#5f8a6a" },
  parchemin: { toile: "#eadbb6", feuille: "#e3dcc0", feuilleClair: "#f3e9d2", sapin: "#e3dcc0", ecorce: "#d9c9a6", sombre: "#2b1d12", cristal: "#f3e9d2", rune: "#2b1d12", eauClair: "#dfe3dd", terre: "#d9c9a6", verre: "#e3dcc0" },
};

export function meublesPlus({ rrect, rond, remplir, ligne, flamme }) {
  const tracer = (ctx, couleur, l) => {
    ctx.strokeStyle = couleur;
    ctx.lineWidth = l;
    ctx.stroke();
  };
  const poly = (ctx, pts) => {
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };
  const carre = (ctx, x, y, w, h) => {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
  };
  // Un bloc de pierre irrégulier, comme les rochers d'avant.
  const bloc = (ctx, x, y, r, graine, c, fond, n = 7) => {
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const q = r * (0.8 + hache(k, graine, 11) * 0.35);
      if (k) ctx.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q);
      else ctx.moveTo(x + Math.cos(a) * q, y + Math.sin(a) * q);
    }
    ctx.closePath();
    remplir(ctx, fond || c.pierreSombre, c);
  };
  // Le repère d'une pièce longue : on dessine le long de l'axe x, et l'on tourne si la pièce est plus profonde que large.
  const enLong = (ctx, hw, hh, dessin) => {
    if (hw >= hh) return dessin(hw, hh);
    ctx.save();
    ctx.rotate(Math.PI / 2);
    dessin(hh, hw);
    ctx.restore();
    return undefined;
  };
  const x = (parchemin) => EXTRA[parchemin ? "parchemin" : "couleur"];
  const teinte = (c) => c.teinte || c.tissu;
  // Un houppier vu de dessus : des touffes, un reflet au nord-ouest.
  const houppier = (ctx, r, touffes, fond, clair, c, parchemin) => {
    for (const [px, py, k] of touffes) {
      rond(ctx, px * r, py * r, k * r);
      ctx.fillStyle = fond;
      ctx.fill();
    }
    ctx.beginPath();
    for (const [px, py, k] of touffes) {
      ctx.moveTo(px * r + k * r, py * r);
      ctx.arc(px * r, py * r, k * r, 0, Math.PI * 2);
    }
    if (parchemin) tracer(ctx, c.trait, c.lw);
    else {
      rond(ctx, -0.22 * r, -0.24 * r, 0.3 * r);
      ctx.fillStyle = clair;
      ctx.fill();
    }
  };

  return {
    // ---------------------------------------------------------------- auberge et maison
    "table-banquet"(ctx, hw, hh, c) {
      enLong(ctx, hw, hh, (w, h) => {
        for (const s of [-1, 1]) {
          rrect(ctx, -w + 0.2, s > 0 ? h - 0.34 : -h + 0.06, w * 2 - 0.4, 0.28, 0.05);
          remplir(ctx, c.boisSombre, c);
        }
        rrect(ctx, -w + 0.08, -h + 0.42, w * 2 - 0.16, h * 2 - 0.84, 0.08);
        remplir(ctx, c.bois, c);
        carre(ctx, -w + 0.3, -0.12, w * 2 - 0.6, 0.24);
        remplir(ctx, c.tissu, c);
      });
    },
    tabouret(ctx, hw, hh, c) {
      rond(ctx, 0, 0, 0.2);
      remplir(ctx, c.bois, c);
      rond(ctx, 0, 0, 0.12);
      tracer(ctx, c.trait, 0.015);
    },
    "comptoir-angle"(ctx, hw, hh, c) {
      // Raccorde un comptoir qui part à droite et un autre qui descend (rotation : les autres angles).
      ctx.beginPath();
      ctx.moveTo(-hw + 0.1 + 0.2, -hh + 0.1);
      ctx.lineTo(hw, -hh + 0.1);
      ctx.lineTo(hw, hh - 0.1);
      ctx.lineTo(hw - 0.1, hh - 0.1);
      ctx.lineTo(hw - 0.1, hh);
      ctx.lineTo(-hw + 0.1, hh);
      ctx.lineTo(-hw + 0.1, -hh + 0.3);
      ctx.quadraticCurveTo(-hw + 0.1, -hh + 0.1, -hw + 0.3, -hh + 0.1);
      ctx.closePath();
      remplir(ctx, c.boisSombre, c);
      ctx.beginPath();
      ctx.moveTo(hw, -hh + 0.16);
      ctx.lineTo(-hw + 0.26, -hh + 0.16);
      ctx.quadraticCurveTo(-hw + 0.16, -hh + 0.16, -hw + 0.16, -hh + 0.26);
      ctx.lineTo(-hw + 0.16, hh);
      ctx.lineTo(-hw + 0.3, hh);
      ctx.lineTo(-hw + 0.3, -hh + 0.3);
      ctx.lineTo(hw, -hh + 0.3);
      ctx.closePath();
      ctx.fillStyle = c.boisClair;
      ctx.fill();
    },
    "tonneau-couche"(ctx, hw, hh, c) {
      enLong(ctx, hw, hh, (w) => {
        for (const s of [-1, 1]) {
          carre(ctx, s * (w - 0.42) - 0.06, -0.42, 0.12, 0.84);
          remplir(ctx, c.boisSombre, c);
        }
        ctx.beginPath();
        ctx.moveTo(-w + 0.18, -0.26);
        ctx.quadraticCurveTo(0, -0.42, w - 0.18, -0.26);
        ctx.lineTo(w - 0.18, 0.26);
        ctx.quadraticCurveTo(0, 0.42, -w + 0.18, 0.26);
        ctx.closePath();
        remplir(ctx, c.bois, c);
        ctx.beginPath();
        for (const t of [-0.62, -0.25, 0.25, 0.62]) ligne(ctx, t * w, -0.36, t * w, 0.36);
        tracer(ctx, c.trait, 0.03);
        carre(ctx, w - 0.2, -0.05, 0.14, 0.1);
        remplir(ctx, c.metal, c);
      });
    },
    "tonneaux-empiles"(ctx, hw, hh, c) {
      const r = Math.min(hw, hh) * 0.46;
      for (const [px, py] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        rond(ctx, px * hw * 0.48, py * hh * 0.48, r);
        remplir(ctx, c.bois, c);
        rond(ctx, px * hw * 0.48, py * hh * 0.48, r * 0.78);
        tracer(ctx, c.trait, 0.025);
      }
      rond(ctx, 0, 0, r);
      remplir(ctx, c.boisClair, c);
      rond(ctx, 0, 0, r * 0.78);
      tracer(ctx, c.trait, 0.03);
      rond(ctx, 0, 0, r * 0.35);
      tracer(ctx, c.trait, 0.02);
    },
    "etagere-bouteilles"(ctx, hw, hh, c, parchemin) {
      enLong(ctx, hw, hh, (w, h) => {
        carre(ctx, -w + 0.05, -h + 0.06, w * 2 - 0.1, 0.4);
        remplir(ctx, c.boisSombre, c);
        const n = Math.max(2, Math.round((w * 2 - 0.2) / 0.16));
        for (let k = 0; k < n; k++) {
          for (const r of [0, 1]) {
            rond(ctx, -w + 0.15 + (k * (w * 2 - 0.3)) / (n - 1), -h + 0.16 + r * 0.2, 0.06);
            remplir(ctx, (k + r) % 3 ? x(parchemin).verre : c.tissu, c);
          }
        }
      });
    },
    "cheminee-angle"(ctx, hw, hh, c, parchemin) {
      // Logée dans l'angle en haut à gauche, sa gueule tournée vers la pièce.
      poly(ctx, [[-hw, -hh], [hw - 0.1, -hh], [hw - 0.1, -hh + 0.5], [-hw + 0.5, hh - 0.1], [-hw, hh - 0.1]]);
      remplir(ctx, c.pierreSombre, c);
      poly(ctx, [[-hw + 0.22, -hh + 0.22], [hw - 0.42, -hh + 0.22], [-hw + 0.22, hh - 0.42]]);
      remplir(ctx, parchemin ? c.papier : "#231a14", c);
      flamme(ctx, -hw + 0.62, -hh + 0.62, 0.17, c, parchemin);
    },
    "lit-double"(ctx, hw, hh, c) {
      rrect(ctx, -hw + 0.08, -hh + 0.06, hw * 2 - 0.16, hh * 2 - 0.12, 0.06);
      remplir(ctx, c.bois, c);
      carre(ctx, -hw + 0.14, -hh + 0.6, hw * 2 - 0.28, hh * 2 - 0.7);
      remplir(ctx, c.teinte || c.tissu2, c);
      for (const s of [-1, 1]) {
        rrect(ctx, s > 0 ? 0.04 : -hw + 0.2, -hh + 0.14, hw - 0.24, 0.34, 0.08);
        remplir(ctx, c.papier, c);
      }
    },
    armoire(ctx, hw, hh, c) {
      enLong(ctx, hw, hh, (w, h) => {
        rrect(ctx, -w + 0.08, -h + 0.06, w * 2 - 0.16, h * 1.4, 0.04);
        remplir(ctx, c.boisSombre, c);
        ctx.beginPath();
        ligne(ctx, 0, -h + 0.12, 0, -h + 0.06 + h * 1.4 - 0.06);
        ligne(ctx, -w + 0.14, -h + 0.16, w - 0.14, -h + 0.16);
        tracer(ctx, c.trait, 0.02);
        for (const s of [-1, 1]) {
          rond(ctx, s * 0.08, -h + 0.06 + h * 0.9, 0.04);
          remplir(ctx, c.metal, c);
        }
      });
    },
    baignoire(ctx, hw, hh, c) {
      enLong(ctx, hw, hh, (w, h) => {
        ctx.beginPath();
        ctx.ellipse(0, 0, w - 0.08, h - 0.12, 0, 0, Math.PI * 2);
        remplir(ctx, c.bois, c);
        ctx.beginPath();
        ctx.ellipse(0, 0, w - 0.2, h - 0.24, 0, 0, Math.PI * 2);
        remplir(ctx, c.eau, c);
        ctx.beginPath();
        ctx.ellipse(0, 0, w - 0.13, h - 0.17, 0, 0, Math.PI * 2);
        tracer(ctx, c.metal, 0.03);
      });
    },

    // ---------------------------------------------------------------- échoppe et forge
    etal(ctx, hw, hh, c) {
      enLong(ctx, hw, hh, (w, h) => {
        carre(ctx, -w + 0.08, -h + 0.3, w * 2 - 0.16, h * 2 - 0.42);
        remplir(ctx, c.bois, c);
        for (let k = 0; k < 7; k++) {
          rond(ctx, -w + 0.3 + k * ((w * 2 - 0.6) / 6), 0.12 + (k % 2) * 0.12, 0.08);
          remplir(ctx, [c.or, c.vert, c.tissu][k % 3], c);
        }
        // L'auvent rayé, au fond.
        const n = Math.max(4, Math.round(w * 4));
        for (let k = 0; k < n; k++) {
          carre(ctx, -w + (k * w * 2) / n, -h + 0.02, (w * 2) / n, 0.3);
          remplir(ctx, k % 2 ? c.papier : teinte(c), c);
        }
      });
    },
    presentoir(ctx, hw, hh, c) {
      enLong(ctx, hw, hh, (w, h) => {
        carre(ctx, -w + 0.06, -h + 0.08, w * 2 - 0.12, h * 1.3);
        remplir(ctx, c.boisSombre, c);
        const n = Math.max(2, Math.round(w * 2));
        for (let k = 0; k < n; k++) {
          const px = -w + 0.5 + (k * (w * 2 - 1)) / Math.max(1, n - 1);
          ctx.beginPath();
          ligne(ctx, px, -h + 0.12, px, h - 0.22);
          ligne(ctx, px - 0.12, -h + 0.24, px + 0.12, -h + 0.24);
          tracer(ctx, c.metal, 0.05);
          rond(ctx, px, -h + 0.12, 0.04);
          remplir(ctx, c.or, c);
        }
      });
    },
    mannequin(ctx, hw, hh, c) {
      rond(ctx, 0, 0, 0.34);
      remplir(ctx, c.boisSombre, c);
      ctx.beginPath();
      ctx.ellipse(0, 0.02, 0.3, 0.17, 0, 0, Math.PI * 2);
      remplir(ctx, c.metal, c);
      ctx.beginPath();
      ligne(ctx, -0.18, 0.02, 0.18, 0.02);
      tracer(ctx, c.trait, 0.015);
      rond(ctx, 0, -0.02, 0.09);
      remplir(ctx, c.pierreClair, c);
    },
    ratelier(ctx, hw, hh, c) {
      enLong(ctx, hw, hh, (w, h) => {
        carre(ctx, -w + 0.06, -h + 0.08, w * 2 - 0.12, 0.12);
        remplir(ctx, c.boisSombre, c);
        for (const s of [-1, 1]) {
          carre(ctx, s * (w - 0.14) - 0.06, -h + 0.04, 0.12, h * 2 - 0.12);
          remplir(ctx, c.bois, c);
        }
        const n = Math.max(3, Math.round(w * 3));
        ctx.beginPath();
        for (let k = 0; k < n; k++) {
          const px = -w + 0.32 + (k * (w * 2 - 0.64)) / (n - 1);
          ligne(ctx, px, -h + 0.1, px + (k % 2 ? 0.04 : -0.04), h - 0.1);
        }
        tracer(ctx, c.metal, 0.045);
        for (let k = 0; k < n; k++) {
          const px = -w + 0.32 + (k * (w * 2 - 0.64)) / (n - 1);
          carre(ctx, px - 0.07, -h + 0.22, 0.14, 0.04);
          remplir(ctx, c.boisSombre, c);
        }
      });
    },
    forge(ctx, hw, hh, c, parchemin) {
      rrect(ctx, -hw + 0.06, -hh + 0.06, hw * 2 - 0.12, hh * 2 - 0.12, 0.06);
      remplir(ctx, c.pierreSombre, c);
      carre(ctx, -hw + 0.06, -hh + 0.06, hw * 2 - 0.12, 0.34);
      remplir(ctx, c.pierre, c);
      rrect(ctx, -hw + 0.36, -hh + 0.54, hw * 2 - 0.72, hh * 2 - 0.9, 0.12);
      remplir(ctx, parchemin ? c.papier : "#231a14", c);
      for (let k = 0; k < 6; k++) {
        rond(ctx, (hache(k, 2, 5) - 0.5) * hw, (hache(k, 3, 5) - 0.3) * hh * 0.8, 0.07);
        remplir(ctx, parchemin ? c.papier : "#8a2a10", c);
      }
      flamme(ctx, 0, 0.1, 0.22, c, parchemin);
    },
    soufflet(ctx, hw, hh, c) {
      poly(ctx, [[-0.3, -0.3], [0.3, -0.3], [0.08, 0.3], [-0.08, 0.3]]);
      remplir(ctx, c.boisSombre, c);
      poly(ctx, [[-0.24, -0.24], [0.24, -0.24], [0.06, 0.22], [-0.06, 0.22]]);
      remplir(ctx, c.boisClair, c);
      carre(ctx, -0.04, 0.3, 0.08, 0.14);
      remplir(ctx, c.metal, c);
      carre(ctx, -0.18, -0.42, 0.36, 0.1);
      remplir(ctx, c.bois, c);
    },
    "bac-trempe"(ctx, hw, hh, c) {
      rrect(ctx, -0.38, -0.32, 0.76, 0.64, 0.06);
      remplir(ctx, c.bois, c);
      carre(ctx, -0.3, -0.24, 0.6, 0.48);
      remplir(ctx, c.eau, c);
      ctx.beginPath();
      ligne(ctx, 0.05, -0.36, 0.3, 0.1);
      ligne(ctx, 0.12, -0.38, 0.34, 0.06);
      tracer(ctx, c.metal, 0.035);
    },
    meule(ctx, hw, hh, c) {
      carre(ctx, -0.36, -0.3, 0.72, 0.6);
      remplir(ctx, c.boisSombre, c);
      rrect(ctx, -0.32, -0.1, 0.64, 0.2, 0.08);
      remplir(ctx, c.pierreClair, c);
      ctx.beginPath();
      ligne(ctx, 0, -0.36, 0, 0.36);
      ligne(ctx, 0, 0.36, 0.16, 0.42);
      tracer(ctx, c.metal, 0.04);
    },

    // ---------------------------------------------------------------- temple
    "banc-temple"(ctx, hw, hh, c) {
      enLong(ctx, hw, hh, (w, h) => {
        rrect(ctx, -w + 0.1, -0.12, w * 2 - 0.2, 0.34, 0.04);
        remplir(ctx, c.bois, c);
        carre(ctx, -w + 0.06, -0.3, w * 2 - 0.12, 0.14);
        remplir(ctx, c.boisSombre, c);
        for (const s of [-1, 1]) {
          carre(ctx, s * (w - 0.1) - 0.05, -0.3, 0.1, 0.56);
          remplir(ctx, c.boisSombre, c);
        }
      });
    },
    lutrin(ctx, hw, hh, c) {
      rond(ctx, 0, 0.12, 0.16);
      remplir(ctx, c.pierreSombre, c);
      poly(ctx, [[-0.3, -0.3], [0.3, -0.3], [0.26, 0.12], [-0.26, 0.12]]);
      remplir(ctx, c.bois, c);
      for (const s of [-1, 1]) {
        carre(ctx, s > 0 ? 0.01 : -0.22, -0.24, 0.21, 0.3);
        remplir(ctx, c.papier, c);
      }
    },
    fonts(ctx, hw, hh, c) {
      const pts = [];
      for (let k = 0; k < 8; k++) pts.push([Math.cos(((k + 0.5) / 8) * Math.PI * 2) * 0.42, Math.sin(((k + 0.5) / 8) * Math.PI * 2) * 0.42]);
      poly(ctx, pts);
      remplir(ctx, c.pierreClair, c);
      rond(ctx, 0, 0, 0.26);
      remplir(ctx, c.eau, c);
    },
    candelabre(ctx, hw, hh, c, parchemin) {
      rond(ctx, 0, 0, 0.3);
      remplir(ctx, c.metal, c);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
        rond(ctx, Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.05);
        remplir(ctx, c.papier, c);
      }
      flamme(ctx, 0, 0, 0.1, c, parchemin);
    },
    reliquaire(ctx, hw, hh, c) {
      carre(ctx, -0.4, -0.4, 0.8, 0.8);
      remplir(ctx, c.pierreSombre, c);
      rrect(ctx, -0.22, -0.16, 0.44, 0.32, 0.04);
      remplir(ctx, c.or, c);
      ctx.beginPath();
      ligne(ctx, 0, -0.12, 0, 0.12);
      ligne(ctx, -0.09, -0.03, 0.09, -0.03);
      tracer(ctx, c.trait, 0.025);
    },
    "grande-statue"(ctx, hw, hh, c, parchemin) {
      const r = Math.min(hw, hh);
      carre(ctx, -r + 0.06, -r + 0.06, r * 2 - 0.12, r * 2 - 0.12);
      remplir(ctx, c.pierreSombre, c);
      carre(ctx, -r + 0.24, -r + 0.24, r * 2 - 0.48, r * 2 - 0.48);
      remplir(ctx, c.pierre, c);
      ctx.beginPath();
      ctx.ellipse(0, r * 0.06, r * 0.6, r * 0.32, 0, 0, Math.PI * 2);
      remplir(ctx, c.pierreClair, c);
      rond(ctx, 0, 0, r * 0.22);
      remplir(ctx, parchemin ? c.papier : "#c4bdb0", c);
    },

    // ---------------------------------------------------------------- donjon et crypte
    "sarcophage-ouvert"(ctx, hw, hh, c, parchemin) {
      // Comme le sarcophage : dessiné en long sur y, couché si la pièce est plus large que profonde.
      ctx.save();
      if (hh < hw) ctx.rotate(Math.PI / 2);
      const L = Math.max(hw, hh);
      poly(ctx, [[-0.26, -L + 0.1], [0.26, -L + 0.1], [0.34, -L + 0.55], [0.22, L - 0.1], [-0.22, L - 0.1], [-0.34, -L + 0.55]]);
      remplir(ctx, c.pierreClair, c);
      poly(ctx, [[-0.18, -L + 0.2], [0.18, -L + 0.2], [0.24, -L + 0.58], [0.14, L - 0.2], [-0.14, L - 0.2], [-0.24, -L + 0.58]]);
      remplir(ctx, x(parchemin).sombre, c);
      rond(ctx, 0, -L + 0.42, 0.09);
      remplir(ctx, c.os, c);
      ctx.beginPath();
      ligne(ctx, 0, -L + 0.55, 0, L - 0.5);
      ligne(ctx, -0.12, -L + 0.75, 0.12, -L + 0.75);
      tracer(ctx, c.os, 0.04);
      // Le couvercle glissé de côté.
      ctx.save();
      ctx.translate(0.3, 0.15);
      ctx.rotate(0.22);
      carre(ctx, -0.22, -L + 0.3, 0.44, L * 2 - 0.5);
      remplir(ctx, c.pierre, c);
      ctx.restore();
      ctx.restore();
    },
    cercueil(ctx, hw, hh, c) {
      ctx.save();
      if (hh < hw) ctx.rotate(Math.PI / 2);
      const L = Math.max(hw, hh);
      poly(ctx, [[-0.18, -L + 0.08], [0.18, -L + 0.08], [0.3, -L + 0.5], [0.2, L - 0.08], [-0.2, L - 0.08], [-0.3, -L + 0.5]]);
      remplir(ctx, c.boisSombre, c);
      ctx.beginPath();
      ligne(ctx, 0, -L + 0.3, 0, L - 0.4);
      ligne(ctx, -0.14, -L + 0.62, 0.14, -L + 0.62);
      tracer(ctx, c.or, 0.035);
      ctx.restore();
    },
    chaines(ctx, hw, hh, c) {
      // Scellées au mur du haut.
      for (const s of [-1, 1]) {
        const px = s * 0.2;
        rond(ctx, px, -hh + 0.08, 0.06);
        remplir(ctx, c.metal, c);
        for (let k = 1; k < 5; k++) {
          ctx.beginPath();
          ctx.ellipse(px + s * 0.02 * k, -hh + 0.08 + k * 0.1, 0.03, 0.05, 0, 0, Math.PI * 2);
          tracer(ctx, c.metal, 0.025);
        }
        ctx.beginPath();
        ctx.arc(px + s * 0.1, -hh + 0.62, 0.07, 0, Math.PI * 2);
        tracer(ctx, c.metal, 0.035);
      }
    },
    pilori(ctx, hw, hh, c) {
      rond(ctx, 0, 0.16, 0.08);
      remplir(ctx, c.boisSombre, c);
      rrect(ctx, -0.42, -0.14, 0.84, 0.2, 0.03);
      remplir(ctx, c.bois, c);
      for (const [px, r] of [[-0.26, 0.04], [0, 0.065], [0.26, 0.04]]) {
        rond(ctx, px, -0.04, r);
        remplir(ctx, c.boisSombre, c);
      }
    },
    herse(ctx, hw, hh, c) {
      ctx.beginPath();
      for (let k = -2; k <= 2; k++) {
        ligne(ctx, k * 0.17, -hh + 0.04, k * 0.17, hh - 0.04);
        ligne(ctx, -hw + 0.04, k * 0.17, hw - 0.04, k * 0.17);
      }
      tracer(ctx, c.trait, 0.07);
      ctx.beginPath();
      for (let k = -2; k <= 2; k++) ligne(ctx, k * 0.17, -hh + 0.04, k * 0.17, hh - 0.04);
      tracer(ctx, c.metal, 0.035);
    },
    fosse(ctx, hw, hh, c, parchemin) {
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        rond(ctx, Math.cos(a) * (hw - 0.12), Math.sin(a) * (hh - 0.12), 0.09);
        remplir(ctx, c.pierre, c);
      }
      ctx.beginPath();
      ctx.ellipse(0, 0, hw - 0.14, hh - 0.14, 0, 0, Math.PI * 2);
      remplir(ctx, x(parchemin).sombre, c);
    },
    "grille-egout"(ctx, hw, hh, c, parchemin) {
      carre(ctx, -0.34, -0.34, 0.68, 0.68);
      remplir(ctx, x(parchemin).sombre, c);
      ctx.beginPath();
      for (let k = -2; k <= 2; k++) ligne(ctx, k * 0.13, -0.34, k * 0.13, 0.34);
      ligne(ctx, -0.34, 0, 0.34, 0);
      tracer(ctx, c.metal, 0.045);
      carre(ctx, -0.34, -0.34, 0.68, 0.68);
      tracer(ctx, c.metal, 0.05);
    },
    "cercle-rituel"(ctx, hw, hh, c, parchemin) {
      const r = Math.min(hw, hh) - 0.12;
      const k = x(parchemin);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.moveTo(r * 0.84, 0);
      ctx.arc(0, 0, r * 0.84, 0, Math.PI * 2);
      tracer(ctx, k.rune, 0.04);
      ctx.beginPath();
      for (let n = 0; n <= 6; n++) {
        const a = (n / 6) * Math.PI * 2 - Math.PI / 2;
        if (n) ctx.lineTo(Math.cos(a) * r * 0.84, Math.sin(a) * r * 0.84);
        else ctx.moveTo(Math.cos(a) * r * 0.84, Math.sin(a) * r * 0.84);
      }
      for (let n = 0; n < 12; n++) {
        const a = (n / 12) * Math.PI * 2;
        ligne(ctx, Math.cos(a) * r * 0.88, Math.sin(a) * r * 0.88, Math.cos(a + 0.12) * r * 0.97, Math.sin(a + 0.12) * r * 0.97);
      }
      tracer(ctx, k.rune, 0.03);
    },
    toiles(ctx, hw, hh, c) {
      // Tendue dans l'angle en haut à gauche.
      ctx.beginPath();
      const o = [-hw, -hh];
      for (let k = 0; k <= 5; k++) {
        const a = (k / 5) * (Math.PI / 2);
        ligne(ctx, o[0], o[1], o[0] + Math.cos(a) * 0.95, o[1] + Math.sin(a) * 0.95);
      }
      for (const r of [0.25, 0.45, 0.65, 0.85]) {
        for (let k = 0; k < 5; k++) {
          const a0 = (k / 5) * (Math.PI / 2);
          const a1 = ((k + 1) / 5) * (Math.PI / 2);
          ctx.moveTo(o[0] + Math.cos(a0) * r, o[1] + Math.sin(a0) * r);
          ctx.quadraticCurveTo(o[0] + Math.cos((a0 + a1) / 2) * r * 0.86, o[1] + Math.sin((a0 + a1) / 2) * r * 0.86, o[0] + Math.cos(a1) * r, o[1] + Math.sin(a1) * r);
        }
      }
      tracer(ctx, c.os, 0.018);
    },

    // ---------------------------------------------------------------- extérieur et nature
    chene(ctx, hw, hh, c, parchemin) {
      const t = [[0, 0, 0.6], [-0.36, -0.3, 0.4], [0.36, -0.28, 0.42], [0.34, 0.3, 0.4], [-0.32, 0.32, 0.42], [0, -0.46, 0.3], [0.48, 0, 0.3], [-0.5, 0, 0.3], [0, 0.48, 0.3]];
      houppier(ctx, Math.min(hw, hh) * 0.94, t, x(parchemin).feuille, "rgba(160,190,100,.3)", c, parchemin);
    },
    sapin(ctx, hw, hh, c, parchemin) {
      const r = Math.min(hw, hh) - 0.08;
      const k = x(parchemin);
      for (const [f, couleur] of [[1, k.sapin], [0.66, parchemin ? k.sapin : "#3a5e3a"], [0.34, parchemin ? k.sapin : "#4c7448"]]) {
        ctx.beginPath();
        for (let n = 0; n < 16; n++) {
          const a = (n / 16) * Math.PI * 2;
          const q = r * f * (n % 2 ? 0.72 : 1);
          if (n) ctx.lineTo(Math.cos(a) * q, Math.sin(a) * q);
          else ctx.moveTo(q, 0);
        }
        ctx.closePath();
        remplir(ctx, couleur, c);
      }
    },
    bouleau(ctx, hw, hh, c, parchemin) {
      houppier(ctx, Math.min(hw, hh) * 1.15, [[0, 0, 0.62], [-0.3, -0.26, 0.36], [0.3, 0.24, 0.36]], parchemin ? c.vert : "#7f9e4e", "rgba(220,235,170,.35)", c, parchemin);
    },
    saule(ctx, hw, hh, c, parchemin) {
      const r = Math.min(hw, hh) - 0.06;
      houppier(ctx, r * 0.78, [[0, 0, 0.8], [-0.4, -0.3, 0.5], [0.4, -0.3, 0.5], [0.4, 0.34, 0.5], [-0.4, 0.34, 0.5]], parchemin ? c.vert : "#6a8a4a", "rgba(200,220,150,.3)", c, parchemin);
      ctx.beginPath();
      for (let n = 0; n < 48; n++) {
        const a = (n / 48) * Math.PI * 2;
        const q = r * (0.7 + 0.14 * hache(n, 3, 21));
        ligne(ctx, Math.cos(a) * q, Math.sin(a) * q, Math.cos(a) * (q + r * 0.2), Math.sin(a) * (q + r * 0.2));
      }
      tracer(ctx, parchemin ? c.trait : "#8aa868", 0.035);
    },
    "arbre-mort"(ctx, hw, hh, c, parchemin) {
      const r = Math.min(hw, hh) - 0.1;
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let n = 0; n < 7; n++) {
        const a = (n / 7) * Math.PI * 2 + hache(n, 1, 3);
        const q = r * (0.7 + 0.3 * hache(n, 2, 3));
        const [mx, my] = [Math.cos(a) * q * 0.55, Math.sin(a) * q * 0.55];
        ligne(ctx, 0, 0, mx, my);
        ctx.lineTo(Math.cos(a + 0.2) * q, Math.sin(a + 0.2) * q);
        ligne(ctx, mx, my, Math.cos(a - 0.35) * q * 0.85, Math.sin(a - 0.35) * q * 0.85);
      }
      tracer(ctx, x(parchemin).ecorce, 0.06);
      ctx.lineCap = "butt";
      rond(ctx, 0, 0, 0.16);
      remplir(ctx, x(parchemin).ecorce, c);
    },
    buisson(ctx, hw, hh, c, parchemin) {
      houppier(ctx, 0.46, [[0, 0, 0.66], [-0.4, -0.2, 0.5], [0.38, -0.24, 0.48], [0.3, 0.34, 0.48], [-0.32, 0.32, 0.46]], x(parchemin).feuille, "rgba(160,190,100,.3)", c, parchemin);
    },
    fougeres(ctx, hw, hh, c, parchemin) {
      ctx.lineCap = "round";
      for (let n = 0; n < 6; n++) {
        const a = (n / 6) * Math.PI * 2 + 0.3;
        const [ex, ey] = [Math.cos(a) * 0.46, Math.sin(a) * 0.46];
        ctx.beginPath();
        ligne(ctx, 0, 0, ex, ey);
        for (let k = 1; k < 5; k++) {
          const t = k / 5;
          const [px, py] = [ex * t, ey * t];
          const l = 0.11 * (1 - t * 0.6);
          ligne(ctx, px, py, px + Math.cos(a + 1.1) * l, py + Math.sin(a + 1.1) * l);
          ligne(ctx, px, py, px + Math.cos(a - 1.1) * l, py + Math.sin(a - 1.1) * l);
        }
        tracer(ctx, parchemin ? c.trait : "#5e8a3a", 0.03);
      }
      ctx.lineCap = "butt";
    },
    souche(ctx, hw, hh, c, parchemin) {
      ctx.beginPath();
      for (let n = 0; n < 5; n++) {
        const a = (n / 5) * Math.PI * 2 + 0.4;
        ligne(ctx, Math.cos(a) * 0.2, Math.sin(a) * 0.2, Math.cos(a) * 0.42, Math.sin(a) * 0.42);
      }
      tracer(ctx, x(parchemin).ecorce, 0.08);
      rond(ctx, 0, 0, 0.27);
      remplir(ctx, x(parchemin).ecorce, c);
      rond(ctx, 0, 0, 0.2);
      remplir(ctx, c.boisClair, c);
      for (const r of [0.06, 0.13]) {
        rond(ctx, 0.01, 0, r);
        tracer(ctx, c.trait, 0.012);
      }
    },
    tronc(ctx, hw, hh, c, parchemin) {
      enLong(ctx, hw, hh, (w) => {
        rrect(ctx, -w + 0.1, -0.24, w * 2 - 0.2, 0.48, 0.2);
        remplir(ctx, x(parchemin).ecorce, c);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) ligne(ctx, -w + 0.4 + k * 0.38, -0.14 + (k % 2) * 0.12, -w + 0.7 + k * 0.38, -0.1 + (k % 2) * 0.12);
        tracer(ctx, c.trait, 0.015);
        ctx.beginPath();
        ctx.ellipse(w - 0.16, 0, 0.1, 0.23, 0, 0, Math.PI * 2);
        remplir(ctx, c.boisClair, c);
        carre(ctx, -0.1, -0.42, 0.08, 0.2);
        remplir(ctx, x(parchemin).ecorce, c);
      });
    },
    menhir(ctx, hw, hh, c, parchemin) {
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.3, 0.38, 0.3, 0, Math.PI * 2);
      remplir(ctx, c.pierre, c);
      ctx.beginPath();
      ctx.ellipse(-0.04, -0.05, 0.16, 0.22, 0.3, 0, Math.PI * 2);
      remplir(ctx, c.pierreClair, c);
      if (!parchemin) {
        for (let k = 0; k < 4; k++) {
          rond(ctx, (hache(k, 1, 7) - 0.5) * 0.36, (hache(k, 2, 7) - 0.5) * 0.5, 0.035);
          ctx.fillStyle = "#9aa25a";
          ctx.fill();
        }
      }
    },
    riviere(ctx, hw, hh, c, parchemin) {
      // L'eau court sur la longueur ; les deux bouts sont droits pour que deux rivières se raccordent.
      enLong(ctx, hw, hh, (w, h) => {
        const k = x(parchemin);
        const rive = (s) => {
          ctx.moveTo(-w, s * (h - 0.16));
          for (let t = -w; t <= w + 0.001; t += 0.25) ctx.lineTo(t, s * (h - 0.16 - 0.06 * Math.sin(t * 3.1 + s)));
        };
        carre(ctx, -w, -h, w * 2, h * 2);
        ctx.fillStyle = parchemin ? c.papier : c.paille;
        ctx.fill();
        ctx.beginPath();
        rive(-1);
        for (let t = w; t >= -w - 0.001; t -= 0.25) ctx.lineTo(t, h - 0.16 - 0.06 * Math.sin(t * 3.1 + 1));
        ctx.closePath();
        ctx.fillStyle = c.eau;
        ctx.fill();
        ctx.beginPath();
        rive(-1);
        rive(1);
        tracer(ctx, c.trait, c.lw);
        ctx.beginPath();
        for (let n = 0; n < 5; n++) {
          const px = -w + 0.3 + n * ((w * 2 - 0.6) / 4);
          const py = (hache(n, 4, 9) - 0.5) * (h - 0.4);
          ctx.moveTo(px - 0.2, py);
          ctx.quadraticCurveTo(px, py - 0.06, px + 0.2, py);
        }
        tracer(ctx, k.eauClair, 0.03);
      });
    },
    pont(ctx, hw, hh, c) {
      enLong(ctx, hw, hh, (w, h) => {
        carre(ctx, -w + 0.04, -h + 0.14, w * 2 - 0.08, h * 2 - 0.28);
        remplir(ctx, c.bois, c);
        ctx.beginPath();
        for (let t = -w + 0.2; t < w - 0.1; t += 0.2) ligne(ctx, t, -h + 0.14, t, h - 0.14);
        tracer(ctx, c.trait, 0.015);
        for (const s of [-1, 1]) {
          carre(ctx, -w + 0.04, s > 0 ? h - 0.2 : -h + 0.1, w * 2 - 0.08, 0.1);
          remplir(ctx, c.boisSombre, c);
          for (const t of [-w + 0.1, 0, w - 0.1]) {
            rond(ctx, t, s * (h - 0.15), 0.07);
            remplir(ctx, c.boisSombre, c);
          }
        }
      });
    },
    cloture(ctx, hw, hh, c) {
      enLong(ctx, hw, hh, (w) => {
        ctx.beginPath();
        ligne(ctx, -w + 0.1, -0.05, w - 0.1, -0.05);
        ligne(ctx, -w + 0.1, 0.05, w - 0.1, 0.05);
        tracer(ctx, c.bois, 0.06);
        ctx.beginPath();
        ligne(ctx, -w + 0.1, -0.05, w - 0.1, -0.05);
        ligne(ctx, -w + 0.1, 0.05, w - 0.1, 0.05);
        tracer(ctx, c.trait, 0.012);
        for (let t = -w + 0.12; t <= w - 0.1; t += 1) {
          carre(ctx, t - 0.07, -0.08, 0.14, 0.16);
          remplir(ctx, c.boisSombre, c);
        }
        carre(ctx, w - 0.19, -0.08, 0.14, 0.16);
        remplir(ctx, c.boisSombre, c);
      });
    },
    palissade(ctx, hw, hh, c) {
      enLong(ctx, hw, hh, (w) => {
        carre(ctx, -w + 0.04, 0.12, w * 2 - 0.08, 0.06);
        remplir(ctx, c.boisSombre, c);
        const n = Math.round((w * 2) / 0.22);
        for (let k = 0; k < n; k++) {
          rond(ctx, -w + 0.11 + k * ((w * 2 - 0.22) / (n - 1)), 0, 0.11);
          remplir(ctx, k % 2 ? c.bois : c.boisClair, c);
          rond(ctx, -w + 0.11 + k * ((w * 2 - 0.22) / (n - 1)), 0, 0.03);
          ctx.fillStyle = c.trait;
          ctx.fill();
        }
      });
    },
    "feu-de-camp"(ctx, hw, hh, c, parchemin) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        rond(ctx, Math.cos(a) * 0.32, Math.sin(a) * 0.32, 0.08);
        remplir(ctx, c.pierre, c);
      }
      ctx.beginPath();
      ligne(ctx, -0.2, -0.14, 0.2, 0.14);
      ligne(ctx, -0.2, 0.14, 0.2, -0.14);
      tracer(ctx, c.boisSombre, 0.08);
      flamme(ctx, 0, 0, 0.15, c, parchemin);
    },
    tente(ctx, hw, hh, c, parchemin) {
      const t = c.teinte || x(parchemin).toile;
      ctx.beginPath();
      for (const [px, py] of [[-hw + 0.02, -hh + 0.02], [hw - 0.02, -hh + 0.02], [hw - 0.02, hh - 0.02], [-hw + 0.02, hh - 0.02]]) ligne(ctx, px, py, px * 0.7, py * 0.7);
      tracer(ctx, c.trait, 0.015);
      poly(ctx, [[-hw + 0.24, -hh + 0.2], [0, -hh + 0.2], [0, hh - 0.2], [-hw + 0.24, hh - 0.2]]);
      remplir(ctx, t, c);
      poly(ctx, [[0, -hh + 0.2], [hw - 0.24, -hh + 0.2], [hw - 0.24, hh - 0.2], [0, hh - 0.2]]);
      remplir(ctx, t, c);
      if (!parchemin) {
        carre(ctx, 0, -hh + 0.2, hw - 0.24, hh * 2 - 0.4);
        ctx.fillStyle = "rgba(0,0,0,.25)";
        ctx.fill();
      }
      ctx.beginPath();
      ligne(ctx, 0, -hh + 0.12, 0, hh - 0.12);
      tracer(ctx, c.boisSombre, 0.05);
    },
    panneau(ctx, hw, hh, c) {
      for (const [a, l] of [[-0.5, 0.4], [0.7, 0.36], [2.4, 0.3]]) {
        ctx.save();
        ctx.rotate(a);
        poly(ctx, [[0.04, -0.06], [l, -0.06], [l + 0.08, 0], [l, 0.06], [0.04, 0.06]]);
        remplir(ctx, c.bois, c);
        ctx.restore();
      }
      carre(ctx, -0.07, -0.07, 0.14, 0.14);
      remplir(ctx, c.boisSombre, c);
    },

    // ---------------------------------------------------------------- ferme et écurie
    potager(ctx, hw, hh, c, parchemin) {
      rrect(ctx, -hw + 0.08, -hh + 0.08, hw * 2 - 0.16, hh * 2 - 0.16, 0.06);
      remplir(ctx, x(parchemin).terre, c);
      const rangs = Math.max(2, Math.round(hh * 2 / 0.4));
      for (let r = 0; r < rangs; r++) {
        const py = -hh + 0.28 + (r * (hh * 2 - 0.56)) / (rangs - 1);
        for (let px = -hw + 0.28; px < hw - 0.2; px += 0.24) {
          rond(ctx, px + (r % 2) * 0.1, py, 0.08);
          remplir(ctx, r % 2 ? c.vert : c.vertClair, c);
        }
      }
    },
    epouvantail(ctx, hw, hh, c) {
      ctx.beginPath();
      ligne(ctx, -0.4, 0, 0.4, 0);
      tracer(ctx, c.boisSombre, 0.07);
      ctx.beginPath();
      ctx.ellipse(0, 0.04, 0.22, 0.14, 0, 0, Math.PI * 2);
      remplir(ctx, c.tissu2, c);
      rond(ctx, 0, -0.02, 0.15);
      remplir(ctx, c.paille, c);
      rond(ctx, 0, -0.02, 0.07);
      tracer(ctx, c.trait, 0.015);
    },

    // ---------------------------------------------------------------- grotte
    cristaux(ctx, hw, hh, c, parchemin) {
      const k = x(parchemin);
      if (!parchemin) {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.6);
        g.addColorStop(0, "rgba(140,200,240,.35)");
        g.addColorStop(1, "rgba(140,200,240,0)");
        ctx.fillStyle = g;
        rond(ctx, 0, 0, 0.6);
        ctx.fill();
      }
      for (const [px, py, r, a] of [[-0.12, 0.06, 0.2, 0.3], [0.16, -0.1, 0.15, 1.1], [0.12, 0.2, 0.11, 0.2], [-0.2, -0.2, 0.1, 0.8]]) {
        const pts = [];
        for (let n = 0; n < 6; n++) pts.push([px + Math.cos(a + (n / 6) * Math.PI * 2) * r, py + Math.sin(a + (n / 6) * Math.PI * 2) * r]);
        poly(ctx, pts);
        remplir(ctx, k.cristal, c);
        ctx.beginPath();
        ligne(ctx, px, py, pts[0][0], pts[0][1]);
        ligne(ctx, px, py, pts[2][0], pts[2][1]);
        ligne(ctx, px, py, pts[4][0], pts[4][1]);
        tracer(ctx, c.trait, 0.012);
      }
    },

    // ---------------------------------------------------------------- navire et quai
    ponton(ctx, hw, hh, c) {
      enLong(ctx, hw, hh, (w, h) => {
        for (const [px, py] of [[-w + 0.12, -h + 0.12], [w - 0.12, -h + 0.12], [-w + 0.12, h - 0.12], [w - 0.12, h - 0.12], [0, -h + 0.12], [0, h - 0.12]]) {
          rond(ctx, px, py, 0.1);
          remplir(ctx, c.boisSombre, c);
        }
        carre(ctx, -w + 0.06, -h + 0.08, w * 2 - 0.12, h * 2 - 0.16);
        remplir(ctx, c.bois, c);
        ctx.beginPath();
        for (let t = -w + 0.26; t < w - 0.1; t += 0.22) ligne(ctx, t, -h + 0.08, t, h - 0.08);
        tracer(ctx, c.trait, 0.015);
      });
    },
    passerelle(ctx, hw, hh, c) {
      enLong(ctx, hw, hh, (w, h) => {
        rrect(ctx, -w + 0.06, -h + 0.18, w * 2 - 0.12, h * 2 - 0.36, 0.04);
        remplir(ctx, c.bois, c);
        ctx.beginPath();
        for (let t = -w + 0.3; t < w - 0.2; t += 0.3) ligne(ctx, t, -h + 0.22, t, h - 0.22);
        tracer(ctx, c.boisSombre, 0.04);
      });
    },
    barque(ctx, hw, hh, c) {
      enLong(ctx, hw, hh, (w, h) => {
        ctx.beginPath();
        ctx.moveTo(w - 0.04, 0);
        ctx.quadraticCurveTo(w * 0.4, -h + 0.06, -w + 0.2, -h + 0.14);
        ctx.lineTo(-w + 0.08, -h + 0.2);
        ctx.lineTo(-w + 0.08, h - 0.2);
        ctx.lineTo(-w + 0.2, h - 0.14);
        ctx.quadraticCurveTo(w * 0.4, h - 0.06, w - 0.04, 0);
        ctx.closePath();
        remplir(ctx, c.boisSombre, c);
        ctx.beginPath();
        ctx.moveTo(w - 0.2, 0);
        ctx.quadraticCurveTo(w * 0.36, -h + 0.16, -w + 0.2, -h + 0.24);
        ctx.lineTo(-w + 0.2, h - 0.24);
        ctx.quadraticCurveTo(w * 0.36, h - 0.16, w - 0.2, 0);
        ctx.closePath();
        remplir(ctx, c.bois, c);
        for (const t of [-0.3, 0.25]) {
          carre(ctx, t * w - 0.05, -h + 0.2, 0.1, h * 2 - 0.4);
          remplir(ctx, c.boisClair, c);
        }
      });
    },
    mat(ctx, hw, hh, c) {
      ctx.beginPath();
      ligne(ctx, -0.46, 0.04, 0.46, -0.04);
      tracer(ctx, c.boisSombre, 0.07);
      ctx.beginPath();
      for (const [a, b] of [[-0.46, -0.4], [0.46, -0.4], [-0.46, 0.4], [0.46, 0.4]]) ligne(ctx, 0, 0, a, b);
      tracer(ctx, c.trait, 0.012);
      rond(ctx, 0, 0, 0.17);
      remplir(ctx, c.bois, c);
      rond(ctx, 0, 0, 0.1);
      tracer(ctx, c.trait, 0.015);
    },
    gouvernail(ctx, hw, hh, c) {
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        ligne(ctx, Math.cos(a) * 0.08, Math.sin(a) * 0.08, Math.cos(a) * 0.42, Math.sin(a) * 0.42);
      }
      tracer(ctx, c.boisSombre, 0.05);
      ctx.beginPath();
      ctx.arc(0, 0, 0.3, 0, Math.PI * 2);
      tracer(ctx, c.bois, 0.07);
      rond(ctx, 0, 0, 0.09);
      remplir(ctx, c.metal, c);
    },
    bitte(ctx, hw, hh, c) {
      rond(ctx, 0, 0, 0.24);
      remplir(ctx, c.boisSombre, c);
      rond(ctx, 0, 0, 0.16);
      remplir(ctx, c.bois, c);
      ctx.beginPath();
      ctx.arc(0, 0, 0.3, 0.4, 5.6);
      ctx.lineTo(0.42, 0.3);
      tracer(ctx, c.paille, 0.05);
    },
    ancre(ctx, hw, hh, c) {
      ctx.lineCap = "round";
      ctx.beginPath();
      ligne(ctx, 0, -0.3, 0, 0.32);
      ligne(ctx, -0.16, -0.18, 0.16, -0.18);
      ctx.moveTo(-0.3, 0.12);
      ctx.quadraticCurveTo(-0.24, 0.38, 0, 0.36);
      ctx.quadraticCurveTo(0.24, 0.38, 0.3, 0.12);
      tracer(ctx, c.trait, 0.09);
      ctx.beginPath();
      ligne(ctx, 0, -0.3, 0, 0.32);
      ligne(ctx, -0.16, -0.18, 0.16, -0.18);
      ctx.moveTo(-0.3, 0.12);
      ctx.quadraticCurveTo(-0.24, 0.38, 0, 0.36);
      ctx.quadraticCurveTo(0.24, 0.38, 0.3, 0.12);
      tracer(ctx, c.metal, 0.05);
      ctx.lineCap = "butt";
      ctx.beginPath();
      ctx.arc(0, -0.37, 0.07, 0, Math.PI * 2);
      tracer(ctx, c.metal, 0.035);
    },
    cordages(ctx, hw, hh, c) {
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 8; a += 0.2) {
        const r = 0.05 + a * 0.012;
        if (a) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.moveTo(r, 0);
      }
      ctx.lineTo(0.42, 0.28);
      tracer(ctx, c.trait, 0.07);
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 8; a += 0.2) {
        const r = 0.05 + a * 0.012;
        if (a) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.moveTo(r, 0);
      }
      ctx.lineTo(0.42, 0.28);
      tracer(ctx, c.paille, 0.045);
    },
    filet(ctx, hw, hh, c) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, hw - 0.1, hh - 0.14, 0.2, 0, Math.PI * 2);
      ctx.clip();
      ctx.beginPath();
      for (let t = -2; t <= 2; t += 0.16) {
        ligne(ctx, t - hh, -hh, t + hh, hh);
        ligne(ctx, t + hh, -hh, t - hh, hh);
      }
      tracer(ctx, c.paille, 0.015);
      ctx.restore();
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        rond(ctx, Math.cos(a) * (hw - 0.14), Math.sin(a) * (hh - 0.18), 0.05);
        remplir(ctx, c.tissu, c);
      }
    },

    // ---------------------------------------------------------------- ruines
    "mur-ruine"(ctx, hw, hh, c) {
      enLong(ctx, hw, hh, (w) => {
        ctx.beginPath();
        ctx.moveTo(-w + 0.04, -0.17);
        for (let t = -w + 0.3; t < w - 0.2; t += 0.3) ctx.lineTo(t, -0.17 - (hache(Math.round(t * 10), 1, 5) < 0.4 ? 0.06 : 0));
        ctx.lineTo(w - 0.5, -0.17);
        ctx.lineTo(w - 0.36, 0.02);
        ctx.lineTo(w - 0.6, 0.17);
        ctx.lineTo(-w + 0.04, 0.17);
        ctx.closePath();
        remplir(ctx, c.pierre, c);
        ctx.beginPath();
        for (let t = -w + 0.4; t < w - 0.6; t += 0.4) ligne(ctx, t, -0.17, t, 0.17);
        ligne(ctx, -w + 0.04, 0, w - 0.4, 0);
        tracer(ctx, c.trait, 0.015);
        for (const [px, py, r, g] of [[w - 0.22, 0.26, 0.1, 3], [w - 0.1, -0.2, 0.08, 5], [-w + 0.5, 0.32, 0.07, 7]]) bloc(ctx, px, py, r, g, c, c.pierre);
      });
    },
    "colonne-brisee"(ctx, hw, hh, c) {
      rond(ctx, 0, 0, 0.36);
      remplir(ctx, c.pierre, c);
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const q = 0.26 * (k % 2 ? 0.7 : 1);
        if (k) ctx.lineTo(Math.cos(a) * q, Math.sin(a) * q);
        else ctx.moveTo(q, 0);
      }
      ctx.closePath();
      remplir(ctx, c.pierreClair, c);
      bloc(ctx, 0.36, 0.34, 0.09, 9, c, c.pierre);
    },
    "colonne-couchee"(ctx, hw, hh, c) {
      enLong(ctx, hw, hh, (w) => {
        ctx.beginPath();
        ctx.moveTo(-w + 0.14, -0.3);
        ctx.lineTo(w - 0.3, -0.3);
        ctx.lineTo(w - 0.16, -0.12);
        ctx.lineTo(w - 0.26, 0.04);
        ctx.lineTo(w - 0.12, 0.3);
        ctx.lineTo(-w + 0.14, 0.3);
        ctx.closePath();
        remplir(ctx, c.pierre, c);
        ctx.beginPath();
        for (const t of [-0.18, -0.06, 0.06, 0.18]) ligne(ctx, -w + 0.2, t, w - 0.34, t);
        tracer(ctx, c.trait, 0.012);
        ctx.beginPath();
        ctx.ellipse(-w + 0.14, 0, 0.1, 0.3, 0, 0, Math.PI * 2);
        remplir(ctx, c.pierreClair, c);
      });
    },
    "statue-brisee"(ctx, hw, hh, c) {
      carre(ctx, -0.4, -0.4, 0.8, 0.8);
      remplir(ctx, c.pierreSombre, c);
      poly(ctx, [[-0.26, -0.06], [0.08, -0.16], [0.24, 0.02], [0.1, 0.18], [-0.2, 0.14]]);
      remplir(ctx, c.pierreClair, c);
      bloc(ctx, 0.28, -0.28, 0.1, 3, c, c.pierreClair);
      bloc(ctx, -0.3, 0.3, 0.08, 5, c, c.pierreClair);
    },
    eboulis(ctx, hw, hh, c) {
      for (let k = 0; k < 9; k++) {
        const px = (hache(k, 1, 17) - 0.5) * (hw * 2 - 0.5);
        const py = (hache(k, 2, 17) - 0.5) * (hh * 2 - 0.5);
        bloc(ctx, px, py, 0.14 + hache(k, 3, 17) * 0.22, k + 20, c, k % 3 ? c.pierreSombre : c.pierre);
      }
    },
    gravats(ctx, hw, hh, c) {
      for (let k = 0; k < 7; k++) bloc(ctx, (hache(k, 4, 19) - 0.5) * 0.7, (hache(k, 5, 19) - 0.5) * 0.7, 0.05 + hache(k, 6, 19) * 0.06, k + 40, c, c.pierre, 5);
    },

    // ---------------------------------------------------------------- bureau et bibliothèque
    bibliotheque(ctx, hw, hh, c, parchemin) {
      enLong(ctx, hw, hh, (w, h) => {
        carre(ctx, -w + 0.04, -h + 0.04, w * 2 - 0.08, 0.44);
        remplir(ctx, c.boisSombre, c);
        let px = -w + 0.08;
        let k = 0;
        while (px < w - 0.12) {
          const l = 0.05 + hache(k, 3, 29) * 0.05;
          carre(ctx, px, -h + 0.08, l, 0.36 - hache(k, 4, 29) * 0.08);
          ctx.fillStyle = parchemin ? c.papier : [c.tissu, c.tissu2, c.vert, c.or, c.papier, "#5a3a22"][k % 6];
          ctx.fill();
          px += l + 0.008;
          k++;
        }
      });
    },
    bureau(ctx, hw, hh, c, parchemin) {
      enLong(ctx, hw, hh, (w, h) => {
        rrect(ctx, -w + 0.08, -h + 0.1, w * 2 - 0.16, h * 2 - 0.2, 0.05);
        remplir(ctx, c.boisSombre, c);
        for (const [px, a] of [[-0.3, -0.15], [0.05, 0.2]]) {
          ctx.save();
          ctx.translate(px, 0);
          ctx.rotate(a);
          carre(ctx, -0.16, -0.2, 0.32, 0.4);
          remplir(ctx, c.papier, c);
          ctx.restore();
        }
        rond(ctx, w - 0.4, -0.1, 0.06);
        remplir(ctx, x(parchemin).sombre, c);
        flamme(ctx, -w + 0.3, -0.16, 0.06, c, parchemin);
      });
    },
    fauteuil(ctx, hw, hh, c) {
      rrect(ctx, -0.36, -0.36, 0.72, 0.7, 0.1);
      remplir(ctx, c.boisSombre, c);
      rrect(ctx, -0.24, -0.16, 0.48, 0.44, 0.08);
      remplir(ctx, c.teinte || c.tissu, c);
      rrect(ctx, -0.3, -0.34, 0.6, 0.16, 0.06);
      remplir(ctx, c.teinte || c.tissu, c);
    },
    "table-cartes"(ctx, hw, hh, c) {
      rrect(ctx, -hw + 0.1, -hh + 0.1, hw * 2 - 0.2, hh * 2 - 0.2, 0.06);
      remplir(ctx, c.bois, c);
      ctx.save();
      ctx.rotate(0.06);
      carre(ctx, -hw + 0.3, -hh + 0.3, hw * 2 - 0.6, hh * 2 - 0.6);
      remplir(ctx, c.papier, c);
      ctx.beginPath();
      ctx.moveTo(-hw + 0.5, 0.1);
      ctx.bezierCurveTo(-0.3, -0.4, 0.2, 0.3, hw - 0.5, -0.2);
      ctx.moveTo(-0.2, -hh + 0.5);
      ctx.quadraticCurveTo(0, 0, 0.2, hh - 0.5);
      tracer(ctx, c.trait, 0.015);
      ctx.restore();
      for (const [px, py] of [[-0.3, -0.2], [0.35, 0.25], [0.1, -0.4]]) {
        rond(ctx, px, py, 0.05);
        remplir(ctx, c.tissu, c);
      }
    },
    "table-alchimie"(ctx, hw, hh, c, parchemin) {
      enLong(ctx, hw, hh, (w, h) => {
        rrect(ctx, -w + 0.08, -h + 0.12, w * 2 - 0.16, h * 2 - 0.24, 0.05);
        remplir(ctx, c.boisSombre, c);
        for (const [px, py, r, couleur] of [[-w + 0.3, -0.08, 0.1, c.vert], [-w + 0.55, 0.12, 0.07, c.tissu], [0.1, -0.1, 0.06, c.tissu2], [0.25, 0.12, 0.08, c.or]]) {
          rond(ctx, px, py, r);
          remplir(ctx, parchemin ? c.papier : couleur, c);
        }
        rond(ctx, w - 0.36, 0, 0.18);
        remplir(ctx, c.metal, c);
        rond(ctx, w - 0.36, 0, 0.11);
        remplir(ctx, parchemin ? c.papier : "#6aa04a", c);
      });
    },
    globe(ctx, hw, hh, c) {
      rond(ctx, 0, 0, 0.36);
      remplir(ctx, c.bois, c);
      rond(ctx, 0, 0, 0.27);
      remplir(ctx, c.eau, c);
      ctx.beginPath();
      ctx.ellipse(-0.06, -0.04, 0.12, 0.08, 0.6, 0, Math.PI * 2);
      ctx.moveTo(0.18, 0.08);
      ctx.ellipse(0.1, 0.08, 0.08, 0.1, 0, 0, Math.PI * 2);
      remplir(ctx, c.vertClair, c);
      ctx.beginPath();
      ligne(ctx, -0.32, -0.12, 0.32, 0.12);
      tracer(ctx, c.or, 0.03);
    },
    "pile-livres"(ctx, hw, hh, c, parchemin) {
      for (const [px, py, a, couleur] of [[-0.06, 0.08, 0.2, c.tissu], [0.04, -0.02, -0.15, c.tissu2], [0, -0.1, 0.35, c.vert]]) {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(a);
        carre(ctx, -0.22, -0.15, 0.44, 0.3);
        remplir(ctx, parchemin ? c.papier : couleur, c);
        carre(ctx, -0.22, -0.15, 0.06, 0.3);
        remplir(ctx, c.papier, c);
        ctx.restore();
      }
    },

    // ---------------------------------------------------------------- mise en scène
    "tapis-rond"(ctx, hw, hh, c) {
      const r = Math.min(hw, hh) - 0.1;
      rond(ctx, 0, 0, r);
      remplir(ctx, teinte(c), c);
      rond(ctx, 0, 0, r - 0.12);
      tracer(ctx, c.or, 0.04);
      rond(ctx, 0, 0, r * 0.4);
      tracer(ctx, c.or, 0.03);
    },
    "tapis-long"(ctx, hw, hh, c) {
      enLong(ctx, hw, hh, (w, h) => {
        carre(ctx, -w + 0.12, -h + 0.14, w * 2 - 0.24, h * 2 - 0.28);
        remplir(ctx, teinte(c), c);
        carre(ctx, -w + 0.22, -h + 0.22, w * 2 - 0.44, h * 2 - 0.44);
        tracer(ctx, c.or, 0.03);
        ctx.beginPath();
        for (let t = -w + 0.7; t < w - 0.5; t += 0.7) {
          ctx.moveTo(t - 0.18, 0);
          ctx.lineTo(t, -h * 0.4);
          ctx.lineTo(t + 0.18, 0);
          ctx.lineTo(t, h * 0.4);
          ctx.closePath();
        }
        tracer(ctx, c.or, 0.025);
        ctx.beginPath();
        for (let t = -h + 0.16; t < h - 0.1; t += 0.06) {
          ligne(ctx, -w + 0.04, t, -w + 0.12, t);
          ligne(ctx, w - 0.12, t, w - 0.04, t);
        }
        tracer(ctx, c.trait, 0.01);
      });
    },
    tenture(ctx, hw, hh, c) {
      // Pendue au mur du haut.
      enLong(ctx, hw, hh, (w, h) => {
        carre(ctx, -w + 0.1, -h + 0.06, w * 2 - 0.2, 0.26);
        remplir(ctx, teinte(c), c);
        ctx.beginPath();
        for (let t = -w + 0.3; t < w - 0.2; t += 0.2) ligne(ctx, t, -h + 0.08, t, -h + 0.3);
        tracer(ctx, c.trait, 0.012);
        carre(ctx, -w + 0.1, -h + 0.28, w * 2 - 0.2, 0.04);
        remplir(ctx, c.or, c);
        carre(ctx, -w + 0.04, -h + 0.03, w * 2 - 0.08, 0.04);
        remplir(ctx, c.metal, c);
      });
    },
    banniere(ctx, hw, hh, c) {
      carre(ctx, -0.3, -0.22, 0.6, 0.36);
      remplir(ctx, teinte(c), c);
      poly(ctx, [[-0.3, 0.14], [0.3, 0.14], [0.3, 0.3], [0, 0.2], [-0.3, 0.3]]);
      remplir(ctx, teinte(c), c);
      carre(ctx, -0.36, -0.26, 0.72, 0.05);
      remplir(ctx, c.or, c);
      rond(ctx, 0, -0.24, 0.07);
      remplir(ctx, c.boisSombre, c);
    },
    torchere(ctx, hw, hh, c, parchemin) {
      // Scellée au mur du haut.
      carre(ctx, -0.08, -hh + 0.02, 0.16, 0.08);
      remplir(ctx, c.metal, c);
      ctx.beginPath();
      ligne(ctx, 0, -hh + 0.08, 0, -hh + 0.32);
      tracer(ctx, c.boisSombre, 0.07);
      flamme(ctx, 0, -hh + 0.36, 0.11, c, parchemin);
    },
    "coffre-fer"(ctx, hw, hh, c) {
      rrect(ctx, -0.38, -0.27, 0.76, 0.54, 0.05);
      remplir(ctx, c.boisSombre, c);
      for (const px of [-0.26, 0, 0.26]) {
        carre(ctx, px - 0.035, -0.27, 0.07, 0.54);
        remplir(ctx, c.metal, c);
      }
      carre(ctx, -0.07, 0.12, 0.14, 0.12);
      remplir(ctx, c.or, c);
    },
    "coffre-ouvert"(ctx, hw, hh, c) {
      carre(ctx, -0.36, -0.42, 0.72, 0.2);
      remplir(ctx, c.boisSombre, c);
      rrect(ctx, -0.36, -0.2, 0.72, 0.5, 0.05);
      remplir(ctx, c.bois, c);
      carre(ctx, -0.29, -0.13, 0.58, 0.36);
      remplir(ctx, c.boisSombre, c);
      for (let k = 0; k < 7; k++) {
        rond(ctx, -0.2 + (k % 4) * 0.13, -0.04 + Math.floor(k / 4) * 0.13, 0.06);
        remplir(ctx, c.or, c);
      }
    },
    sacs(ctx, hw, hh, c, parchemin) {
      const t = x(parchemin).toile;
      for (const [px, py, r] of [[-0.14, 0.1, 0.24], [0.17, -0.1, 0.21], [0.14, 0.24, 0.15]]) {
        ctx.beginPath();
        ctx.ellipse(px, py, r, r * 0.84, 0.4, 0, Math.PI * 2);
        remplir(ctx, t, c);
        rond(ctx, px + r * 0.5, py - r * 0.4, 0.04);
        remplir(ctx, c.boisSombre, c);
      }
    },
    caisses(ctx, hw, hh, c) {
      const caisse = (px, py, s, a) => {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(a);
        carre(ctx, -s, -s, s * 2, s * 2);
        remplir(ctx, c.boisClair, c);
        ctx.beginPath();
        ligne(ctx, -s, -s, s, s);
        ctx.rect(-s + 0.07, -s + 0.07, s * 2 - 0.14, s * 2 - 0.14);
        tracer(ctx, c.trait, 0.022);
        ctx.restore();
      };
      caisse(-hw * 0.48, hh * 0.45, Math.min(hw, hh) * 0.42, 0.04);
      caisse(hw * 0.46, hh * 0.42, Math.min(hw, hh) * 0.4, -0.05);
      caisse(hw * 0.44, -hh * 0.46, Math.min(hw, hh) * 0.4, 0.08);
      caisse(-hw * 0.05, -hh * 0.05, Math.min(hw, hh) * 0.4, 0.2);
    },

    // ---------------------------------------------------------------- passages
    colimacon(ctx, hw, hh, c, parchemin) {
      const r = Math.min(hw, hh) - 0.08;
      rond(ctx, 0, 0, r);
      remplir(ctx, c.pierreSombre, c);
      for (let k = 0; k < 12; k++) {
        const a0 = (k / 12) * Math.PI * 2;
        const a1 = ((k + 1) / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r - 0.06, a0, a1);
        ctx.closePath();
        ctx.fillStyle = parchemin ? c.papier : `rgba(${168 - k * 7},${118 - k * 5},${70 - k * 3},1)`;
        ctx.fill();
        tracer(ctx, c.trait, 0.015);
      }
      rond(ctx, 0, 0, 0.14);
      remplir(ctx, c.pierre, c);
    },
  };
}
