// Le mobilier ajouté le 09/11, dans le style peint : la même main que peint-mobilier.js (planches, pierre, fer, tissu,
// lumière du nord-ouest), vu de dessus, dans un repère centré en cases (hw, hh : demi-largeur et demi-profondeur avant
// rotation). teinte : la couleur choisie pour le tissu d'un meuble qui en a une (MOBILIER, « teinte »), ou rien.
// Les outils viennent de peint-mobilier.js, qui assemble le tout : ce module n'importe rien d'autre que le modèle.

import { hache } from "./modele.js";

const h32 = hache;

// Ce qui éclaire (peint.js, FOYERS) : rayon en cases, couleur, intensité, « avant » (la flamme, devant le centre du
// meuble, rotation comprise) et la force du halo de la flamme.
export const FOYERS_PLUS = {
  "cheminee-angle": { rayon: 6, couleur: "#ffb15e", intensite: 1, avant: 0, flamme: 1.4 },
  forge: { rayon: 5, couleur: "#ff9040", intensite: 1, avant: 0, flamme: 1.3 },
  "feu-de-camp": { rayon: 5, couleur: "#ffa955", intensite: 1, avant: 0, flamme: 1.4 },
  candelabre: { rayon: 3.4, couleur: "#ffd08a", intensite: 0.85, avant: 0, flamme: 0.8 },
  torchere: { rayon: 3.6, couleur: "#ffb060", intensite: 0.9, avant: -0.14, flamme: 0.9 },
  cristaux: { rayon: 2.6, couleur: "#9ad0ff", intensite: 0.6, avant: 0, flamme: 0 },
};
// Posés à même le sol : pas d'ombre portée, seulement un contact léger. Grands : leur ombre tombe plus loin.
export const PLATS_PLUS = ["tapis-rond", "tapis-long", "riviere", "pont", "ponton", "passerelle", "cercle-rituel", "grille-egout", "fosse", "toiles",
  "chaines", "tenture", "torchere", "gravats", "fougeres", "potager", "filet", "cordages", "colimacon"];
export const GRANDS_PLUS = ["chene", "sapin", "saule", "arbre-mort", "grande-statue", "menhir", "mat", "tente", "banniere"];

// Une couleur #rrggbb éclaircie (f > 0) ou assombrie (f < 0).
export function nuance(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f)));
  return `rgb(${c})`;
}

export function meublesPeintsPlus(o) {
  const { rr, rond, degrade, trait, planches, feu, pailleSur, caillou, BOIS, FER, PIERRE } = o;
  const M = o.MEUBLES_PEINTS;
  const O = o.OBJETS_PEINTS;
  const enLong = (ctx, hw, hh, dessin) => {
    if (hw >= hh) return dessin(hw, hh);
    ctx.save();
    ctx.rotate(Math.PI / 2);
    dessin(hh, hw);
    ctx.restore();
    return undefined;
  };
  const poly = (ctx, pts) => {
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };
  // Un plateau de planches, coins arrondis, cerné.
  const plateau = (ctx, x, y, w, h, n, base, graine, r = 0.05) => {
    rr(ctx, x, y, w, h, r);
    ctx.save();
    ctx.clip();
    planches(ctx, x, y, w, h, n, base, graine);
    ctx.restore();
    rr(ctx, x, y, w, h, r);
    trait(ctx, BOIS.bord, 0.025);
  };
  const tissu = (teinte, defaut) => {
    const t = teinte || defaut;
    return { clair: nuance(t, 0.28), moyen: t, sombre: nuance(t, -0.45) };
  };
  const ailleurs = (ctx, x, y, s, a, dessin) => {
    ctx.save();
    ctx.translate(x, y);
    if (a) ctx.rotate(a);
    if (s !== 1) ctx.scale(s, s);
    dessin();
    ctx.restore();
  };
  const ligneFer = (ctx, x0, y0, x1, y1, l) => {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineCap = "round";
    trait(ctx, FER.sombre, l);
    trait(ctx, "rgba(200,200,190,.35)", l * 0.35);
    ctx.lineCap = "butt";
  };
  // Un houppier : touffes ombrées, sombres au sud-est, des feuilles au soleil.
  const houppier = (ctx, r, touffes, clair, sombre, n, graine) => {
    ctx.beginPath();
    for (const [x, y, k] of touffes) {
      ctx.moveTo(x * r + k * r * 1.05, y * r);
      ctx.arc(x * r, y * r, k * r * 1.05, 0, Math.PI * 2);
    }
    ctx.fillStyle = "#1a2614";
    ctx.fill();
    for (const [x, y, k] of touffes) {
      rond(ctx, x * r, y * r, k * r);
      ctx.fillStyle = degrade(ctx, x * r, y * r, k * r, clair, sombre, -0.4, -0.45);
      ctx.fill();
    }
    for (let m = 0; m < n; m++) {
      const a = h32(m, graine, 61) * Math.PI * 2;
      const d = Math.sqrt(h32(m, graine + 1, 61)) * r * 0.8;
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d;
      rond(ctx, x, y, r * (0.05 + 0.05 * h32(m, graine + 2, 61)));
      ctx.fillStyle = x + y < 0 ? "rgba(180,206,120,.32)" : "rgba(16,28,10,.35)";
      ctx.fill();
    }
  };
  // Une pierre taillée, ombrée.
  const pierreTaillee = (ctx, x, y, w, h, graine) => {
    rr(ctx, x, y, w, h, 0.03);
    const v = h32(graine, 3, 7);
    ctx.fillStyle = degrade(ctx, x + w / 2, y + h / 2, Math.max(w, h) * 0.8, `rgb(${182 + 20 * v},${174 + 18 * v},${160 + 16 * v})`, `rgb(${96 + 14 * v},${90 + 12 * v},${80 + 10 * v})`);
    ctx.fill();
    trait(ctx, PIERRE.bord, 0.018);
  };

  return {
    // ---------------------------------------------------------------- auberge et maison
    "table-banquet"(ctx, hw, hh) {
      enLong(ctx, hw, hh, (w, h) => {
        for (const s of [-1, 1]) plateau(ctx, -w + 0.2, s > 0 ? h - 0.34 : -h + 0.06, w * 2 - 0.4, 0.28, 2, BOIS.clair, 19 + s, 0.04);
        plateau(ctx, -w + 0.06, -h + 0.42, w * 2 - 0.12, h * 2 - 0.84, 4, BOIS.moyen, 61, 0.06);
        // Le chemin de table de lin.
        ctx.fillStyle = "#e6dcc4";
        ctx.fillRect(-w + 0.3, -0.13, w * 2 - 0.6, 0.26);
        ctx.fillStyle = "rgba(120,96,60,.18)";
        ctx.fillRect(-w + 0.3, 0.07, w * 2 - 0.6, 0.06);
        ctx.strokeStyle = "rgba(142,27,23,.55)";
        ctx.lineWidth = 0.015;
        ctx.strokeRect(-w + 0.34, -0.1, w * 2 - 0.68, 0.2);
      });
    },
    "comptoir-angle"(ctx, hw, hh) {
      ctx.beginPath();
      ctx.moveTo(-hw + 0.3, -hh + 0.06);
      ctx.lineTo(hw, -hh + 0.06);
      ctx.lineTo(hw, hh - 0.06);
      ctx.lineTo(hw - 0.06, hh - 0.06);
      ctx.lineTo(hw - 0.06, hh);
      ctx.lineTo(-hw + 0.06, hh);
      ctx.lineTo(-hw + 0.06, -hh + 0.3);
      ctx.quadraticCurveTo(-hw + 0.06, -hh + 0.06, -hw + 0.3, -hh + 0.06);
      ctx.closePath();
      ctx.fillStyle = BOIS.noir;
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(hw, -hh + 0.14);
      ctx.lineTo(-hw + 0.3, -hh + 0.14);
      ctx.quadraticCurveTo(-hw + 0.14, -hh + 0.14, -hw + 0.14, -hh + 0.3);
      ctx.lineTo(-hw + 0.14, hh);
      ctx.lineTo(hw - 0.22, hh);
      ctx.lineTo(hw - 0.22, hh - 0.22);
      ctx.lineTo(hw, hh - 0.22);
      ctx.closePath();
      ctx.clip();
      planches(ctx, -hw, -hh, hw * 2, hh * 2, 2, "#7a4a26", 23);
      ctx.fillStyle = "rgba(255,220,170,.16)";
      ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(-hw + 0.3, -hh + 0.06);
      ctx.lineTo(hw, -hh + 0.06);
      ctx.moveTo(-hw + 0.06, hh);
      ctx.lineTo(-hw + 0.06, -hh + 0.3);
      ctx.quadraticCurveTo(-hw + 0.06, -hh + 0.06, -hw + 0.3, -hh + 0.06);
      trait(ctx, BOIS.bord, 0.03);
    },
    "tonneau-couche"(ctx, hw, hh) {
      enLong(ctx, hw, hh, (w) => {
        for (const s of [-1, 1]) {
          ctx.fillStyle = BOIS.noir;
          ctx.fillRect(s * (w - 0.42) - 0.07, -0.44, 0.14, 0.88);
        }
        ctx.beginPath();
        ctx.moveTo(-w + 0.16, -0.27);
        ctx.quadraticCurveTo(0, -0.44, w - 0.16, -0.27);
        ctx.lineTo(w - 0.16, 0.27);
        ctx.quadraticCurveTo(0, 0.44, -w + 0.16, 0.27);
        ctx.closePath();
        ctx.save();
        ctx.clip();
        planches(ctx, -w, -0.44, w * 2, 0.88, 6, "#94643a", 67);
        const g = ctx.createLinearGradient(0, -0.44, 0, 0.44);
        g.addColorStop(0, "rgba(255,230,180,.25)");
        g.addColorStop(0.45, "rgba(0,0,0,0)");
        g.addColorStop(1, "rgba(0,0,0,.45)");
        ctx.fillStyle = g;
        ctx.fillRect(-w, -0.44, w * 2, 0.88);
        ctx.restore();
        ctx.beginPath();
        ctx.moveTo(-w + 0.16, -0.27);
        ctx.quadraticCurveTo(0, -0.44, w - 0.16, -0.27);
        ctx.lineTo(w - 0.16, 0.27);
        ctx.quadraticCurveTo(0, 0.44, -w + 0.16, 0.27);
        ctx.closePath();
        trait(ctx, BOIS.bord, 0.025);
        for (const t of [-0.66, -0.3, 0.3, 0.66]) {
          const y = 0.27 + 0.13 * (1 - t * t);
          ligneFer(ctx, t * (w - 0.16), -y, t * (w - 0.16), y, 0.045);
        }
        ctx.fillStyle = "#b08a3a";
        ctx.fillRect(w - 0.18, -0.05, 0.14, 0.1);
        ctx.fillStyle = "#3a2414";
        ctx.fillRect(w - 0.06, -0.03, 0.05, 0.06);
      });
    },
    "tonneaux-empiles"(ctx, hw, hh) {
      for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) ailleurs(ctx, x * hw * 0.5, y * hh * 0.5, Math.min(hw, hh) * 0.98, 0, () => M.tonneau(ctx));
      rond(ctx, 0.05, 0.07, 0.42 * Math.min(hw, hh));
      ctx.fillStyle = "rgba(8,5,2,.45)";
      ctx.fill();
      ailleurs(ctx, 0, 0, Math.min(hw, hh) * 1.04, 0.6, () => M.tonneau(ctx));
    },
    "etagere-bouteilles"(ctx, hw, hh) {
      enLong(ctx, hw, hh, (w, h) => {
        const y = -h + 0.04;
        ctx.fillStyle = BOIS.sombre;
        ctx.fillRect(-w + 0.04, y, w * 2 - 0.08, 0.42);
        ctx.strokeStyle = BOIS.bord;
        ctx.lineWidth = 0.025;
        ctx.strokeRect(-w + 0.04, y, w * 2 - 0.08, 0.42);
        ctx.fillStyle = "#24160c";
        ctx.fillRect(-w + 0.09, y + 0.05, w * 2 - 0.18, 0.32);
        const n = Math.max(3, Math.round((w * 2 - 0.2) / 0.15));
        for (let k = 0; k < n; k++) {
          const x = -w + 0.17 + (k * (w * 2 - 0.34)) / (n - 1);
          ailleurs(ctx, x, y + 0.14, 0.75, Math.PI / 2, () => O.bouteille(ctx));
        }
        ctx.strokeStyle = "rgba(160,110,60,.5)";
        ctx.lineWidth = 0.015;
        ctx.beginPath();
        for (let k = 0; k <= n; k++) {
          const x = -w + 0.09 + (k * (w * 2 - 0.18)) / n;
          ctx.moveTo(x, y + 0.05);
          ctx.lineTo(x, y + 0.37);
        }
        ctx.stroke();
      });
    },
    "cheminee-angle"(ctx, hw, hh) {
      const pts = [[-hw, -hh], [hw - 0.06, -hh], [hw - 0.06, -hh + 0.55], [-hw + 0.55, hh - 0.06], [-hw, hh - 0.06]];
      poly(ctx, pts);
      ctx.fillStyle = "#6f6860";
      ctx.fill();
      ctx.save();
      poly(ctx, pts);
      ctx.clip();
      for (let k = 0; k < 24; k++) {
        const x = -hw + (k % 6) * (hw / 3);
        const y = -hh + Math.floor(k / 6) * (hh / 2);
        const v = h32(k, 2, 5);
        ctx.fillStyle = `rgb(${110 + 30 * v},${104 + 28 * v},${96 + 24 * v})`;
        rr(ctx, x + 0.02 + (Math.floor(k / 6) % 2) * 0.12, y + 0.02, hw / 3 - 0.04, hh / 2 - 0.04, 0.04);
        ctx.fill();
      }
      ctx.restore();
      poly(ctx, pts);
      trait(ctx, "rgba(30,24,18,.8)", 0.03);
      const foyer = [[-hw + 0.2, -hh + 0.2], [hw - 0.4, -hh + 0.2], [-hw + 0.2, hh - 0.4]];
      poly(ctx, foyer);
      ctx.fillStyle = "#1e1612";
      ctx.fill();
      ctx.save();
      poly(ctx, foyer);
      ctx.clip();
      feu(ctx, -hw + 0.6, -hh + 0.6, 0.55);
      ctx.restore();
      ctx.strokeStyle = "#3a2414";
      ctx.lineCap = "round";
      ctx.lineWidth = 0.1;
      ctx.beginPath();
      ctx.moveTo(-hw + 0.36, -hh + 0.8);
      ctx.lineTo(-hw + 0.86, -hh + 0.36);
      ctx.moveTo(-hw + 0.4, -hh + 0.42);
      ctx.lineTo(-hw + 0.82, -hh + 0.78);
      ctx.stroke();
      ctx.lineCap = "butt";
      feu(ctx, -hw + 0.62, -hh + 0.6, 0.26);
    },
    "lit-double"(ctx, hw, hh, teinte) {
      const t = tissu(teinte, "#6b3a2e");
      rr(ctx, -hw + 0.06, -hh + 0.04, hw * 2 - 0.12, hh * 2 - 0.08, 0.05);
      ctx.fillStyle = BOIS.sombre;
      ctx.fill();
      for (const s of [-1, 1]) {
        rr(ctx, s > 0 ? 0.03 : -hw + 0.14, -hh + 0.12, hw - 0.17, 0.36, 0.08);
        ctx.fillStyle = degrade(ctx, s * hw * 0.5, -hh + 0.3, 0.4, "#f4ecda", "#c9bda2");
        ctx.fill();
      }
      rr(ctx, -hw + 0.1, -hh + 0.56, hw * 2 - 0.2, hh * 2 - 0.66, 0.06);
      const g = ctx.createLinearGradient(-hw, 0, hw, 0);
      g.addColorStop(0, t.clair);
      g.addColorStop(0.5, t.moyen);
      g.addColorStop(1, t.sombre);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = "rgba(230,200,150,.4)";
      ctx.lineWidth = 0.02;
      ctx.stroke();
      ctx.fillStyle = "rgba(240,230,210,.85)";
      ctx.fillRect(-hw + 0.1, -hh + 0.56, hw * 2 - 0.2, 0.12);
    },
    armoire(ctx, hw, hh) {
      enLong(ctx, hw, hh, (w, h) => {
        plateau(ctx, -w + 0.06, -h + 0.04, w * 2 - 0.12, h * 1.45, 3, BOIS.sombre, 71, 0.03);
        ctx.strokeStyle = "rgba(255,226,180,.22)";
        ctx.lineWidth = 0.03;
        ctx.strokeRect(-w + 0.12, -h + 0.1, w * 2 - 0.24, h * 1.45 - 0.12);
        for (const s of [-1, 1]) {
          rond(ctx, s * 0.07, -h + 0.04 + h * 1.45 - 0.02, 0.035);
          ctx.fillStyle = "#c9a052";
          ctx.fill();
        }
      });
    },
    baignoire(ctx, hw, hh) {
      enLong(ctx, hw, hh, (w, h) => {
        ctx.beginPath();
        ctx.ellipse(0, 0, w - 0.06, h - 0.1, 0, 0, Math.PI * 2);
        ctx.save();
        ctx.clip();
        planches(ctx, -w, -h, w * 2, h * 2, 8, "#8d5c32", 73);
        ctx.restore();
        ctx.beginPath();
        ctx.ellipse(0, 0, w - 0.06, h - 0.1, 0, 0, Math.PI * 2);
        trait(ctx, BOIS.bord, 0.025);
        for (const k of [0.08, 0.14]) {
          ctx.beginPath();
          ctx.ellipse(0, 0, w - 0.06 - k * 0.4, h - 0.1 - k * 0.4, 0, 0, Math.PI * 2);
          trait(ctx, FER.sombre, 0.025);
        }
        ctx.beginPath();
        ctx.ellipse(0, 0, w - 0.2, h - 0.24, 0, 0, Math.PI * 2);
        ctx.fillStyle = degrade(ctx, 0, 0, w, "#7fb3c8", "#2c5468");
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(-w * 0.3, -h * 0.25, w * 0.25, h * 0.12, -0.2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(230,245,250,.25)";
        ctx.fill();
      });
    },

    // ---------------------------------------------------------------- échoppe et forge
    etal(ctx, hw, hh, teinte) {
      const t = tissu(teinte, "#8e2a20");
      enLong(ctx, hw, hh, (w, h) => {
        plateau(ctx, -w + 0.06, -h + 0.28, w * 2 - 0.12, h * 2 - 0.36, 3, BOIS.clair, 79, 0.04);
        // Pommes, choux, rouleaux d'étoffe.
        for (let k = 0; k < 9; k++) {
          const x = -w + 0.26 + k * ((w * 2 - 0.52) / 8);
          const y = 0.1 + (k % 2) * 0.14;
          const c = [["#e0653a", "#7a1e10"], ["#a8c860", "#3a5a1c"], ["#e8c050", "#8a5a10"]][k % 3];
          rond(ctx, x, y, 0.075);
          ctx.fillStyle = degrade(ctx, x, y, 0.075, c[0], c[1]);
          ctx.fill();
        }
        // L'auvent rayé, au fond, festonné.
        const n = Math.max(4, Math.round(w * 4));
        for (let k = 0; k < n; k++) {
          const x = -w + (k * w * 2) / n;
          ctx.beginPath();
          ctx.moveTo(x, -h + 0.02);
          ctx.lineTo(x + (w * 2) / n, -h + 0.02);
          ctx.lineTo(x + (w * 2) / n, -h + 0.3);
          ctx.quadraticCurveTo(x + w / n, -h + 0.4, x, -h + 0.3);
          ctx.closePath();
          ctx.fillStyle = k % 2 ? "#e9dfc6" : t.moyen;
          ctx.fill();
        }
        const g = ctx.createLinearGradient(0, -h, 0, -h + 0.38);
        g.addColorStop(0, "rgba(255,240,210,.25)");
        g.addColorStop(1, "rgba(0,0,0,.3)");
        ctx.fillStyle = g;
        ctx.fillRect(-w, -h + 0.02, w * 2, 0.36);
        ctx.strokeStyle = t.sombre;
        ctx.lineWidth = 0.02;
        ctx.strokeRect(-w, -h + 0.02, w * 2, 0.28);
      });
    },
    presentoir(ctx, hw, hh) {
      enLong(ctx, hw, hh, (w, h) => {
        plateau(ctx, -w + 0.04, -h + 0.06, w * 2 - 0.08, h * 1.36, 2, BOIS.sombre, 83, 0.03);
        ctx.fillStyle = "#6e1f2a";
        ctx.fillRect(-w + 0.1, -h + 0.12, w * 2 - 0.2, h * 1.36 - 0.12);
        const n = Math.max(2, Math.round(w * 2));
        for (let k = 0; k < n; k++) {
          const x = -w + 0.5 + (k * (w * 2 - 1)) / Math.max(1, n - 1);
          if (k % 2) {
            rond(ctx, x, -h + 0.5, 0.17);
            ctx.fillStyle = degrade(ctx, x, -h + 0.5, 0.17, "#d8dad6", "#4a4c4c");
            ctx.fill();
            trait(ctx, FER.bord, 0.018);
            ctx.fillStyle = "#24262a";
            ctx.fillRect(x - 0.1, -h + 0.5, 0.2, 0.03);
          } else {
            const g = ctx.createLinearGradient(x - 0.03, 0, x + 0.03, 0);
            g.addColorStop(0, "#f0f0ec");
            g.addColorStop(1, "#6a6c6c");
            ctx.fillStyle = g;
            ctx.fillRect(x - 0.03, -h + 0.18, 0.06, h * 1.1);
            ctx.fillStyle = "#c9a052";
            ctx.fillRect(x - 0.12, -h + 0.22 + h * 0.86, 0.24, 0.04);
            ctx.fillStyle = BOIS.noir;
            ctx.fillRect(x - 0.025, -h + 0.26 + h * 0.86, 0.05, 0.12);
          }
        }
      });
    },
    mannequin(ctx) {
      ctx.lineCap = "round";
      ctx.beginPath();
      for (const a of [0.5, 2.6, 4.7]) {
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * 0.38, Math.sin(a) * 0.38);
      }
      trait(ctx, BOIS.sombre, 0.06);
      ctx.lineCap = "butt";
      ctx.beginPath();
      ctx.ellipse(0, 0.02, 0.3, 0.18, 0, 0, Math.PI * 2);
      ctx.fillStyle = degrade(ctx, 0, 0.02, 0.3, "#e0e2de", "#4a4c4c");
      ctx.fill();
      trait(ctx, FER.bord, 0.018);
      for (const s of [-1, 1]) {
        rond(ctx, s * 0.24, -0.02, 0.1);
        ctx.fillStyle = degrade(ctx, s * 0.24, -0.02, 0.1, "#c8cac6", "#3a3c3c");
        ctx.fill();
        trait(ctx, FER.bord, 0.015);
      }
      ctx.fillStyle = "#8e1b17";
      ctx.fillRect(-0.3, 0.12, 0.6, 0.04);
      rond(ctx, 0, -0.01, 0.09);
      ctx.fillStyle = degrade(ctx, 0, -0.01, 0.09, "#c79a62", "#5e3b1f");
      ctx.fill();
    },
    ratelier(ctx, hw, hh) {
      enLong(ctx, hw, hh, (w, h) => {
        ctx.fillStyle = BOIS.sombre;
        ctx.fillRect(-w + 0.06, -h + 0.08, w * 2 - 0.12, 0.12);
        ctx.fillRect(-w + 0.06, h - 0.3, w * 2 - 0.12, 0.08);
        for (const s of [-1, 1]) {
          ctx.fillStyle = BOIS.moyen;
          ctx.fillRect(s * (w - 0.14) - 0.06, -h + 0.04, 0.12, h * 2 - 0.12);
          ctx.strokeStyle = BOIS.bord;
          ctx.lineWidth = 0.02;
          ctx.strokeRect(s * (w - 0.14) - 0.06, -h + 0.04, 0.12, h * 2 - 0.12);
        }
        const n = Math.max(3, Math.round(w * 3));
        for (let k = 0; k < n; k++) {
          const x = -w + 0.34 + (k * (w * 2 - 0.68)) / (n - 1);
          const genre = k % 3;
          if (genre === 0) {
            // Une lance : la hampe et le fer.
            ctx.beginPath();
            ctx.moveTo(x, h - 0.14);
            ctx.lineTo(x, -h + 0.14);
            trait(ctx, "#7a5030", 0.04);
            poly(ctx, [[x, -h + 0.04], [x + 0.05, -h + 0.16], [x, -h + 0.24], [x - 0.05, -h + 0.16]]);
            ctx.fillStyle = degrade(ctx, x, -h + 0.14, 0.1, "#e0e2de", "#5a5c5c");
            ctx.fill();
          } else if (genre === 1) {
            // Une épée, pointe en bas.
            const g = ctx.createLinearGradient(x - 0.025, 0, x + 0.025, 0);
            g.addColorStop(0, "#f0f0ec");
            g.addColorStop(1, "#6a6c6c");
            ctx.fillStyle = g;
            ctx.fillRect(x - 0.025, -h + 0.28, 0.05, h * 2 - 0.5);
            ctx.fillStyle = "#c9a052";
            ctx.fillRect(x - 0.09, -h + 0.24, 0.18, 0.04);
            ctx.fillStyle = BOIS.noir;
            ctx.fillRect(x - 0.02, -h + 0.1, 0.04, 0.14);
          } else {
            // Une hache : le manche et le fer.
            ctx.beginPath();
            ctx.moveTo(x, h - 0.16);
            ctx.lineTo(x, -h + 0.12);
            trait(ctx, "#7a5030", 0.045);
            ctx.beginPath();
            ctx.moveTo(x, -h + 0.14);
            ctx.quadraticCurveTo(x + 0.2, -h + 0.12, x + 0.18, -h + 0.34);
            ctx.lineTo(x, -h + 0.3);
            ctx.closePath();
            ctx.fillStyle = degrade(ctx, x + 0.1, -h + 0.22, 0.15, "#d8dad6", "#4a4c4c");
            ctx.fill();
            trait(ctx, FER.bord, 0.012);
          }
        }
      });
    },
    forge(ctx, hw, hh) {
      rr(ctx, -hw + 0.04, -hh + 0.04, hw * 2 - 0.08, hh * 2 - 0.08, 0.05);
      ctx.fillStyle = "#6f6860";
      ctx.fill();
      ctx.save();
      rr(ctx, -hw + 0.04, -hh + 0.04, hw * 2 - 0.08, hh * 2 - 0.08, 0.05);
      ctx.clip();
      for (let k = 0; k < 16; k++) {
        const x = -hw + (k % 4) * (hw / 2);
        const y = -hh + Math.floor(k / 4) * (hh / 2);
        const v = h32(k, 4, 5);
        ctx.fillStyle = `rgb(${104 + 30 * v},${98 + 28 * v},${90 + 24 * v})`;
        rr(ctx, x + 0.02 + (Math.floor(k / 4) % 2) * 0.1, y + 0.02, hw / 2 - 0.04, hh / 2 - 0.04, 0.04);
        ctx.fill();
      }
      // La hotte, au fond.
      ctx.fillStyle = "rgba(20,16,12,.55)";
      ctx.fillRect(-hw, -hh, hw * 2, 0.36);
      ctx.restore();
      rr(ctx, -hw + 0.04, -hh + 0.04, hw * 2 - 0.08, hh * 2 - 0.08, 0.05);
      trait(ctx, "rgba(30,24,18,.85)", 0.03);
      rr(ctx, -hw + 0.34, -hh + 0.5, hw * 2 - 0.68, hh * 2 - 0.86, 0.14);
      ctx.fillStyle = "#1a120e";
      ctx.fill();
      for (let k = 0; k < 22; k++) {
        const x = (h32(k, 5, 71) - 0.5) * (hw * 2 - 0.9);
        const y = -hh + 0.66 + h32(k, 6, 71) * (hh * 2 - 1.2);
        rond(ctx, x, y, 0.05 + 0.03 * h32(k, 7, 71));
        ctx.fillStyle = k % 4 ? "#b8401a" : "#ffb04a";
        ctx.fill();
      }
      feu(ctx, 0, 0.12, 0.42);
      ligneFer(ctx, hw - 0.3, -hh + 0.5, hw - 0.12, hh - 0.2, 0.035);
    },
    soufflet(ctx) {
      poly(ctx, [[-0.32, -0.34], [0.32, -0.34], [0.1, 0.28], [-0.1, 0.28]]);
      ctx.fillStyle = "#4a3020";
      ctx.fill();
      trait(ctx, BOIS.bord, 0.02);
      ctx.strokeStyle = "rgba(20,10,4,.6)";
      ctx.lineWidth = 0.015;
      ctx.beginPath();
      for (let k = 1; k < 5; k++) {
        const t = k / 5;
        ctx.moveTo(-0.32 + t * 0.22, -0.34 + t * 0.62);
        ctx.lineTo(0.32 - t * 0.22, -0.34 + t * 0.62);
      }
      ctx.stroke();
      poly(ctx, [[-0.26, -0.3], [0.26, -0.3], [0.08, 0.2], [-0.08, 0.2]]);
      ctx.save();
      ctx.clip();
      planches(ctx, -0.3, -0.3, 0.6, 0.5, 3, BOIS.moyen, 89);
      ctx.restore();
      ctx.fillStyle = degrade(ctx, 0, 0.36, 0.08, "#9a9c9a", "#2c2e2e");
      ctx.fillRect(-0.04, 0.26, 0.08, 0.16);
      ctx.fillStyle = BOIS.sombre;
      ctx.fillRect(-0.2, -0.44, 0.4, 0.1);
    },
    "bac-trempe"(ctx) {
      rr(ctx, -0.4, -0.34, 0.8, 0.68, 0.06);
      ctx.save();
      ctx.clip();
      planches(ctx, -0.4, -0.34, 0.8, 0.68, 5, BOIS.moyen, 97);
      ctx.restore();
      rr(ctx, -0.4, -0.34, 0.8, 0.68, 0.06);
      trait(ctx, BOIS.bord, 0.025);
      rr(ctx, -0.3, -0.24, 0.6, 0.48, 0.04);
      ctx.fillStyle = degrade(ctx, 0, 0, 0.4, "#4a7088", "#10222e");
      ctx.fill();
      ctx.fillStyle = "rgba(220,235,245,.2)";
      ctx.fillRect(-0.24, -0.18, 0.3, 0.04);
      ligneFer(ctx, 0.06, -0.38, 0.32, 0.12, 0.03);
      ligneFer(ctx, 0.14, -0.4, 0.36, 0.06, 0.03);
    },
    meule(ctx) {
      plateau(ctx, -0.38, -0.32, 0.76, 0.64, 3, BOIS.sombre, 101, 0.03);
      rr(ctx, -0.34, -0.11, 0.68, 0.22, 0.09);
      const g = ctx.createLinearGradient(0, -0.11, 0, 0.11);
      g.addColorStop(0, "#5d564d");
      g.addColorStop(0.4, "#cfc8ba");
      g.addColorStop(1, "#5d564d");
      ctx.fillStyle = g;
      ctx.fill();
      trait(ctx, PIERRE.bord, 0.02);
      ligneFer(ctx, 0, -0.4, 0, 0.4, 0.04);
      ligneFer(ctx, 0, 0.4, 0.18, 0.44, 0.035);
    },

    // ---------------------------------------------------------------- temple
    "banc-temple"(ctx, hw, hh) {
      enLong(ctx, hw, hh, (w) => {
        plateau(ctx, -w + 0.1, -0.12, w * 2 - 0.2, 0.36, 2, BOIS.clair, 103, 0.04);
        plateau(ctx, -w + 0.06, -0.32, w * 2 - 0.12, 0.16, 1, BOIS.sombre, 107, 0.03);
        for (const s of [-1, 1]) {
          rr(ctx, s * (w - 0.1) - 0.06, -0.34, 0.12, 0.62, 0.05);
          ctx.fillStyle = degrade(ctx, s * (w - 0.1), -0.1, 0.3, BOIS.moyen, BOIS.noir);
          ctx.fill();
          trait(ctx, BOIS.bord, 0.02);
        }
      });
    },
    lutrin(ctx) {
      rond(ctx, 0, 0.14, 0.17);
      ctx.fillStyle = degrade(ctx, 0, 0.14, 0.17, PIERRE.clair, PIERRE.sombre);
      ctx.fill();
      trait(ctx, PIERRE.bord, 0.018);
      poly(ctx, [[-0.32, -0.32], [0.32, -0.32], [0.27, 0.12], [-0.27, 0.12]]);
      ctx.save();
      ctx.clip();
      planches(ctx, -0.32, -0.32, 0.64, 0.44, 3, BOIS.moyen, 109);
      ctx.restore();
      poly(ctx, [[-0.32, -0.32], [0.32, -0.32], [0.27, 0.12], [-0.27, 0.12]]);
      trait(ctx, BOIS.bord, 0.02);
      ailleurs(ctx, 0, -0.1, 1.4, 0, () => O.livre(ctx));
    },
    fonts(ctx) {
      const octo = (r) => {
        const pts = [];
        for (let k = 0; k < 8; k++) pts.push([Math.cos(((k + 0.5) / 8) * Math.PI * 2) * r, Math.sin(((k + 0.5) / 8) * Math.PI * 2) * r]);
        poly(ctx, pts);
      };
      octo(0.44);
      ctx.fillStyle = degrade(ctx, 0, 0, 0.44, "#d4cdbf", "#6a645a");
      ctx.fill();
      trait(ctx, PIERRE.bord, 0.022);
      octo(0.34);
      trait(ctx, "rgba(40,34,28,.4)", 0.012);
      rond(ctx, 0, 0, 0.27);
      ctx.fillStyle = degrade(ctx, 0, 0, 0.27, "#86b8cc", "#1c3c4c", 0.2, 0.25);
      ctx.fill();
      rond(ctx, -0.08, -0.08, 0.06);
      ctx.fillStyle = "rgba(235,248,252,.4)";
      ctx.fill();
    },
    candelabre(ctx) {
      rond(ctx, 0, 0, 0.32);
      ctx.fillStyle = degrade(ctx, 0, 0, 0.32, FER.clair, FER.sombre);
      ctx.fill();
      trait(ctx, FER.bord, 0.02);
      rond(ctx, 0, 0, 0.22);
      trait(ctx, "rgba(20,20,20,.6)", 0.03);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
        O.chandelle(ctx, Math.cos(a) * 0.22, Math.sin(a) * 0.22);
      }
      O.chandelle(ctx, 0, 0);
    },
    reliquaire(ctx) {
      ctx.fillStyle = degrade(ctx, 0, 0, 0.6, PIERRE.clair, PIERRE.sombre);
      ctx.fillRect(-0.42, -0.42, 0.84, 0.84);
      ctx.strokeStyle = PIERRE.bord;
      ctx.lineWidth = 0.022;
      ctx.strokeRect(-0.42, -0.42, 0.84, 0.84);
      rr(ctx, -0.24, -0.18, 0.48, 0.36, 0.03);
      ctx.fillStyle = degrade(ctx, 0, 0, 0.3, "#ffe89a", "#8a6418");
      ctx.fill();
      trait(ctx, "#5a3e0c", 0.018);
      ctx.beginPath();
      ctx.moveTo(-0.24, 0);
      ctx.lineTo(0.24, 0);
      trait(ctx, "rgba(90,62,12,.7)", 0.015);
      for (const [x, y, c] of [[-0.12, -0.09, "#c0283a"], [0.12, -0.09, "#2a7ac0"], [0, 0.09, "#2a9a5a"]]) {
        rond(ctx, x, y, 0.035);
        ctx.fillStyle = c;
        ctx.fill();
      }
    },
    "grande-statue"(ctx, hw, hh) {
      const r = Math.min(hw, hh);
      for (const [d, c0, c1] of [[0.04, PIERRE.moyen, PIERRE.sombre], [0.22, PIERRE.clair, PIERRE.moyen]]) {
        ctx.fillStyle = degrade(ctx, 0, 0, r * 1.4, c0, c1);
        ctx.fillRect(-r + d, -r + d, (r - d) * 2, (r - d) * 2);
        ctx.strokeStyle = PIERRE.bord;
        ctx.lineWidth = 0.025;
        ctx.strokeRect(-r + d, -r + d, (r - d) * 2, (r - d) * 2);
      }
      // Une figure en robe, une épée tenue droite devant elle.
      ctx.beginPath();
      ctx.ellipse(0, r * 0.08, r * 0.58, r * 0.34, 0, 0, Math.PI * 2);
      ctx.fillStyle = degrade(ctx, 0, r * 0.08, r * 0.58, "#e0dace", "#7e776c");
      ctx.fill();
      trait(ctx, "rgba(40,34,28,.6)", 0.018);
      ctx.strokeStyle = "rgba(40,34,28,.35)";
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      for (let k = -2; k <= 2; k++) {
        ctx.moveTo(k * r * 0.18, r * 0.2);
        ctx.quadraticCurveTo(k * r * 0.22, r * 0.3, k * r * 0.2, r * 0.4);
      }
      ctx.stroke();
      ctx.fillStyle = degrade(ctx, 0, r * 0.5, r * 0.2, "#e8e4da", "#8a8378");
      ctx.fillRect(-r * 0.04, r * 0.18, r * 0.08, r * 0.62);
      ctx.fillRect(-r * 0.18, r * 0.16, r * 0.36, r * 0.05);
      rond(ctx, 0, -r * 0.02, r * 0.2);
      ctx.fillStyle = degrade(ctx, 0, -r * 0.02, r * 0.2, "#eee8dc", "#8a8378");
      ctx.fill();
      trait(ctx, "rgba(40,34,28,.6)", 0.018);
    },

    // ---------------------------------------------------------------- donjon et crypte
    "sarcophage-ouvert"(ctx, hw, hh) {
      ctx.save();
      if (hh < hw) ctx.rotate(Math.PI / 2);
      const L = Math.max(hw, hh);
      poly(ctx, [[-0.27, -L + 0.1], [0.27, -L + 0.1], [0.36, -L + 0.55], [0.24, L - 0.1], [-0.24, L - 0.1], [-0.36, -L + 0.55]]);
      const g = ctx.createLinearGradient(-0.36, -L, 0.36, L);
      g.addColorStop(0, "#c8c1b2");
      g.addColorStop(1, "#77705f");
      ctx.fillStyle = g;
      ctx.fill();
      trait(ctx, PIERRE.bord, 0.025);
      poly(ctx, [[-0.19, -L + 0.2], [0.19, -L + 0.2], [0.26, -L + 0.58], [0.16, L - 0.2], [-0.16, L - 0.2], [-0.26, -L + 0.58]]);
      ctx.fillStyle = "#16100c";
      ctx.fill();
      O.crane(ctx, 0, -L + 0.42);
      ctx.lineCap = "round";
      for (const [x0, y0, x1, y1] of [[0, -L + 0.58, 0, L - 0.45], [-0.13, -L + 0.75, 0.13, -L + 0.75], [-0.08, L - 0.5, -0.1, L - 0.3], [0.08, L - 0.5, 0.1, L - 0.3]]) {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        trait(ctx, "#e6ddc8", 0.035);
      }
      ctx.lineCap = "butt";
      // Le couvercle, glissé de côté.
      ctx.save();
      ctx.translate(0.32, 0.18);
      ctx.rotate(0.22);
      ctx.fillStyle = degrade(ctx, 0, 0, L, "#b9b2a2", "#6a6354");
      ctx.fillRect(-0.24, -L + 0.3, 0.48, L * 2 - 0.5);
      ctx.strokeStyle = PIERRE.bord;
      ctx.lineWidth = 0.022;
      ctx.strokeRect(-0.24, -L + 0.3, 0.48, L * 2 - 0.5);
      ctx.restore();
      ctx.restore();
    },
    cercueil(ctx, hw, hh) {
      ctx.save();
      if (hh < hw) ctx.rotate(Math.PI / 2);
      const L = Math.max(hw, hh);
      const pts = [[-0.19, -L + 0.08], [0.19, -L + 0.08], [0.31, -L + 0.5], [0.21, L - 0.08], [-0.21, L - 0.08], [-0.31, -L + 0.5]];
      poly(ctx, pts);
      ctx.save();
      ctx.clip();
      planches(ctx, -0.32, -L, 0.64, L * 2, 3, "#5e3b1f", 113);
      ctx.restore();
      poly(ctx, pts);
      trait(ctx, BOIS.bord, 0.025);
      ctx.fillStyle = "#c9a052";
      ctx.fillRect(-0.08, -L + 0.4, 0.16, 0.08);
      for (const s of [-1, 1]) {
        ctx.fillStyle = FER.sombre;
        ctx.fillRect(s * 0.27 - 0.03, -0.2, 0.06, 0.14);
        ctx.fillRect(s * 0.25 - 0.03, 0.4, 0.06, 0.14);
      }
      ctx.restore();
    },
    chaines(ctx, hw, hh) {
      for (const s of [-1, 1]) {
        const x = s * 0.2;
        rond(ctx, x, -hh + 0.07, 0.06);
        ctx.fillStyle = degrade(ctx, x, -hh + 0.07, 0.06, FER.clair, FER.sombre);
        ctx.fill();
        for (let k = 1; k < 6; k++) {
          ctx.beginPath();
          if (k % 2) ctx.ellipse(x + s * 0.015 * k, -hh + 0.07 + k * 0.085, 0.025, 0.05, 0, 0, Math.PI * 2);
          else ctx.ellipse(x + s * 0.015 * k, -hh + 0.07 + k * 0.085, 0.012, 0.05, 0, 0, Math.PI * 2);
          trait(ctx, FER.sombre, 0.022);
          trait(ctx, "rgba(200,200,190,.4)", 0.008);
        }
        ctx.beginPath();
        ctx.arc(x + s * 0.12, -hh + 0.66, 0.075, 0, Math.PI * 1.7);
        trait(ctx, FER.sombre, 0.035);
        trait(ctx, "rgba(200,200,190,.35)", 0.012);
      }
    },
    pilori(ctx) {
      rond(ctx, 0, 0.18, 0.09);
      ctx.fillStyle = degrade(ctx, 0, 0.18, 0.09, BOIS.clair, BOIS.noir);
      ctx.fill();
      rr(ctx, -0.44, -0.15, 0.88, 0.22, 0.03);
      ctx.save();
      ctx.clip();
      planches(ctx, -0.44, -0.15, 0.88, 0.22, 2, BOIS.moyen, 127);
      ctx.restore();
      rr(ctx, -0.44, -0.15, 0.88, 0.22, 0.03);
      trait(ctx, BOIS.bord, 0.02);
      for (const [x, r] of [[-0.27, 0.045], [0, 0.07], [0.27, 0.045]]) {
        rond(ctx, x, -0.04, r);
        ctx.fillStyle = "#1e140c";
        ctx.fill();
      }
      ligneFer(ctx, -0.44, -0.04, 0.44, -0.04, 0.012);
    },
    herse(ctx, hw, hh) {
      ctx.fillStyle = "rgba(12,10,8,.35)";
      ctx.fillRect(-hw + 0.04, -hh + 0.04, hw * 2 - 0.08, hh * 2 - 0.08);
      for (let k = -2; k <= 2; k++) {
        ligneFer(ctx, k * 0.17, -hh + 0.03, k * 0.17, hh - 0.03, 0.06);
        ligneFer(ctx, -hw + 0.03, k * 0.17, hw - 0.03, k * 0.17, 0.045);
      }
      for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
          rond(ctx, i * 0.17, j * 0.17, 0.022);
          ctx.fillStyle = "#6a6c6a";
          ctx.fill();
        }
      }
    },
    fosse(ctx, hw, hh) {
      ctx.beginPath();
      ctx.ellipse(0, 0, hw - 0.1, hh - 0.1, 0, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(0.04, 0.05, 0, 0, 0, Math.max(hw, hh));
      g.addColorStop(0, "#020101");
      g.addColorStop(0.6, "#0e0a07");
      g.addColorStop(1, "#3a3028");
      ctx.fillStyle = g;
      ctx.fill();
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        caillou(ctx, Math.cos(a) * (hw - 0.1), Math.sin(a) * (hh - 0.1), 0.085, 140 + k, 6);
      }
    },
    "grille-egout"(ctx) {
      ctx.fillStyle = "#0c0a08";
      ctx.fillRect(-0.36, -0.36, 0.72, 0.72);
      ctx.fillStyle = "rgba(60,80,90,.35)";
      ctx.fillRect(-0.3, 0.06, 0.6, 0.2);
      for (let k = -2; k <= 2; k++) ligneFer(ctx, k * 0.13, -0.34, k * 0.13, 0.34, 0.05);
      ligneFer(ctx, -0.34, 0, 0.34, 0, 0.04);
      ctx.strokeStyle = FER.sombre;
      ctx.lineWidth = 0.06;
      ctx.strokeRect(-0.36, -0.36, 0.72, 0.72);
      ctx.strokeStyle = "rgba(200,200,190,.3)";
      ctx.lineWidth = 0.015;
      ctx.strokeRect(-0.36, -0.36, 0.72, 0.72);
    },
    "cercle-rituel"(ctx, hw, hh) {
      const r = Math.min(hw, hh) - 0.1;
      ctx.strokeStyle = "rgba(122,22,18,.75)";
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.84, 0, Math.PI * 2);
      for (let n = 0; n <= 6; n++) {
        const a = (n / 6) * Math.PI * 2 - Math.PI / 2;
        if (n) ctx.lineTo(Math.cos(a) * r * 0.84, Math.sin(a) * r * 0.84);
        else ctx.moveTo(Math.cos(a) * r * 0.84, Math.sin(a) * r * 0.84);
      }
      ctx.stroke();
      ctx.strokeStyle = "rgba(150,30,22,.7)";
      ctx.lineWidth = 0.022;
      ctx.beginPath();
      for (let n = 0; n < 12; n++) {
        const a = (n / 12) * Math.PI * 2;
        const [x, y] = [Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92];
        ctx.moveTo(x - 0.04, y - 0.04);
        ctx.lineTo(x + 0.04, y + 0.04);
        if (n % 2) {
          ctx.moveTo(x + 0.04, y - 0.04);
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      for (let n = 0; n < 6; n++) {
        const a = (n / 6) * Math.PI * 2 - Math.PI / 2;
        rond(ctx, Math.cos(a) * r * 0.84, Math.sin(a) * r * 0.84, 0.05);
        ctx.fillStyle = "#e6dcc4";
        ctx.fill();
        trait(ctx, "rgba(60,40,20,.5)", 0.01);
      }
    },
    toiles(ctx, hw, hh) {
      ailleurs(ctx, -hw, -hh, 1.25, 0, () => O.toile(ctx));
    },

    // ---------------------------------------------------------------- extérieur et nature
    chene(ctx, hw, hh) {
      const t = [[0, 0, 0.58], [-0.36, -0.3, 0.42], [0.36, -0.3, 0.42], [0.36, 0.3, 0.42], [-0.34, 0.32, 0.42], [0, -0.48, 0.32], [0.5, 0, 0.32], [-0.5, 0, 0.32], [0, 0.5, 0.32]];
      houppier(ctx, Math.min(hw, hh) * 0.93, t, "#5f7e36", "#22341a", 44, 9);
    },
    sapin(ctx, hw, hh) {
      const r = Math.min(hw, hh) - 0.06;
      for (const [f, c0, c1] of [[1, "#476c40", "#1a2c1a"], [0.7, "#557a4a", "#223a22"], [0.42, "#6a8e58", "#2c4a2c"]]) {
        ctx.beginPath();
        for (let n = 0; n < 20; n++) {
          const a = (n / 20) * Math.PI * 2;
          const q = r * f * (n % 2 ? 0.74 : 1);
          if (n) ctx.lineTo(Math.cos(a) * q, Math.sin(a) * q);
          else ctx.moveTo(q, 0);
        }
        ctx.closePath();
        ctx.fillStyle = degrade(ctx, 0, 0, r * f, c0, c1, -0.35, -0.4);
        ctx.fill();
        trait(ctx, "rgba(12,22,10,.55)", 0.02);
      }
      ctx.strokeStyle = "rgba(150,180,120,.25)";
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      for (let n = 0; n < 30; n++) {
        const a = h32(n, 2, 31) * Math.PI * 2;
        const d = r * (0.3 + 0.6 * h32(n, 3, 31));
        ctx.moveTo(Math.cos(a) * d, Math.sin(a) * d);
        ctx.lineTo(Math.cos(a) * (d + 0.12), Math.sin(a) * (d + 0.12));
      }
      ctx.stroke();
    },
    bouleau(ctx, hw, hh) {
      const r = Math.min(hw, hh) * 1.2;
      houppier(ctx, r, [[0, 0, 0.6], [-0.32, -0.26, 0.38], [0.3, 0.24, 0.38], [0.28, -0.3, 0.3], [-0.28, 0.3, 0.3]], "#a2c068", "#4a6a2a", 18, 15);
      ctx.strokeStyle = "rgba(240,236,224,.7)";
      ctx.lineWidth = 0.025;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-0.05, 0.08);
      ctx.lineTo(0.12, -0.1);
      ctx.moveTo(0, 0);
      ctx.lineTo(-0.16, -0.06);
      ctx.stroke();
      ctx.lineCap = "butt";
    },
    saule(ctx, hw, hh) {
      const r = Math.min(hw, hh) - 0.04;
      ctx.lineCap = "round";
      for (let n = 0; n < 90; n++) {
        const a = (n / 90) * Math.PI * 2 + h32(n, 1, 41) * 0.1;
        const q = r * (0.55 + 0.12 * h32(n, 2, 41));
        const l = r * (0.32 + 0.12 * h32(n, 3, 41));
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * q, Math.sin(a) * q);
        ctx.quadraticCurveTo(Math.cos(a + 0.12) * (q + l * 0.6), Math.sin(a + 0.12) * (q + l * 0.6), Math.cos(a + 0.05) * (q + l), Math.sin(a + 0.05) * (q + l));
        trait(ctx, n % 3 ? "#7a9a48" : "#a8c070", 0.03);
      }
      ctx.lineCap = "butt";
      houppier(ctx, r * 0.72, [[0, 0, 0.78], [-0.4, -0.32, 0.46], [0.42, -0.3, 0.46], [0.4, 0.36, 0.46], [-0.4, 0.36, 0.46]], "#86a456", "#34501e", 30, 23);
    },
    "arbre-mort"(ctx, hw, hh) {
      const r = Math.min(hw, hh) - 0.08;
      ctx.lineCap = "round";
      for (const [c, f] of [["#1a1410", 1.5], ["#5e5246", 1], ["rgba(190,180,160,.35)", 0.35]]) {
        for (let n = 0; n < 7; n++) {
          const a = (n / 7) * Math.PI * 2 + h32(n, 1, 3);
          const q = r * (0.7 + 0.3 * h32(n, 2, 3));
          const [mx, my] = [Math.cos(a) * q * 0.5, Math.sin(a) * q * 0.5];
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(Math.cos(a - 0.15) * q * 0.3, Math.sin(a - 0.15) * q * 0.3, mx, my);
          ctx.lineTo(Math.cos(a + 0.22) * q, Math.sin(a + 0.22) * q);
          trait(ctx, c, 0.07 * f);
          ctx.beginPath();
          ctx.moveTo(mx, my);
          ctx.lineTo(Math.cos(a - 0.4) * q * 0.86, Math.sin(a - 0.4) * q * 0.86);
          trait(ctx, c, 0.045 * f);
        }
      }
      ctx.lineCap = "butt";
      rond(ctx, 0, 0, 0.18);
      ctx.fillStyle = degrade(ctx, 0, 0, 0.18, "#7a6c5c", "#2a221a");
      ctx.fill();
    },
    buisson(ctx) {
      houppier(ctx, 0.46, [[0, 0, 0.62], [-0.42, -0.2, 0.5], [0.4, -0.26, 0.48], [0.32, 0.36, 0.48], [-0.34, 0.34, 0.46]], "#64863a", "#1e3014", 12, 33);
      for (let k = 0; k < 6; k++) {
        rond(ctx, (h32(k, 4, 35) - 0.5) * 0.5, (h32(k, 5, 35) - 0.5) * 0.5, 0.03);
        ctx.fillStyle = "#b8302a";
        ctx.fill();
      }
    },
    fougeres(ctx) {
      ctx.lineCap = "round";
      for (let n = 0; n < 9; n++) {
        const a = (n / 9) * Math.PI * 2 + 0.3;
        const l = 0.42 + 0.1 * h32(n, 1, 43);
        const ex = Math.cos(a) * l;
        const ey = Math.sin(a) * l;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(Math.cos(a + 0.3) * l * 0.6, Math.sin(a + 0.3) * l * 0.6, ex, ey);
        trait(ctx, "#4a6a2a", 0.022);
        for (let k = 1; k < 7; k++) {
          const t = k / 7;
          const px = ex * t + Math.cos(a + 0.3) * 0.03 * Math.sin(t * 3);
          const py = ey * t + Math.sin(a + 0.3) * 0.03 * Math.sin(t * 3);
          const f = 0.13 * (1 - t * 0.7);
          for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.ellipse(px + Math.cos(a + s * 1.2) * f * 0.5, py + Math.sin(a + s * 1.2) * f * 0.5, f * 0.55, f * 0.2, a + s * 1.2, 0, Math.PI * 2);
            ctx.fillStyle = k % 2 ? "#8ab84c" : "#6a9a3a";
            ctx.fill();
          }
        }
      }
      ctx.lineCap = "butt";
    },
    souche(ctx) {
      ctx.lineCap = "round";
      for (let n = 0; n < 5; n++) {
        const a = (n / 5) * Math.PI * 2 + 0.4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 0.18, Math.sin(a) * 0.18);
        ctx.quadraticCurveTo(Math.cos(a + 0.2) * 0.34, Math.sin(a + 0.2) * 0.34, Math.cos(a) * 0.44, Math.sin(a) * 0.44);
        trait(ctx, "#3a2a1c", 0.1);
        trait(ctx, "#6a5440", 0.06);
      }
      ctx.lineCap = "butt";
      rond(ctx, 0, 0, 0.28);
      ctx.fillStyle = "#4a3624";
      ctx.fill();
      trait(ctx, "rgba(20,12,6,.8)", 0.02);
      rond(ctx, 0, 0, 0.22);
      ctx.fillStyle = degrade(ctx, 0, 0, 0.22, "#d8b07a", "#8a6036");
      ctx.fill();
      for (const r of [0.05, 0.1, 0.15, 0.19]) {
        rond(ctx, 0.01, 0.005, r);
        trait(ctx, "rgba(90,56,24,.4)", 0.008);
      }
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0.15, 0.1);
      trait(ctx, "rgba(60,36,14,.6)", 0.012);
    },
    tronc(ctx, hw, hh) {
      enLong(ctx, hw, hh, (w) => {
        rr(ctx, -w + 0.08, -0.25, w * 2 - 0.16, 0.5, 0.22);
        const g = ctx.createLinearGradient(0, -0.25, 0, 0.25);
        g.addColorStop(0, "#7a6450");
        g.addColorStop(0.5, "#4e3c2c");
        g.addColorStop(1, "#22180e");
        ctx.fillStyle = g;
        ctx.fill();
        trait(ctx, "rgba(20,12,6,.85)", 0.02);
        ctx.strokeStyle = "rgba(20,12,6,.45)";
        ctx.lineWidth = 0.015;
        ctx.beginPath();
        for (let k = 0; k < 14; k++) {
          const x = -w + 0.3 + h32(k, 1, 47) * (w * 2 - 0.6);
          const y = (h32(k, 2, 47) - 0.5) * 0.36;
          ctx.moveTo(x, y);
          ctx.lineTo(x + 0.25, y + (h32(k, 3, 47) - 0.5) * 0.04);
        }
        ctx.stroke();
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.ellipse(-w * 0.5 + k * w * 0.5, -0.12, 0.14, 0.07, 0, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(110,140,60,.55)";
          ctx.fill();
        }
        ctx.beginPath();
        ctx.ellipse(w - 0.14, 0, 0.1, 0.24, 0, 0, Math.PI * 2);
        ctx.fillStyle = degrade(ctx, w - 0.14, 0, 0.24, "#d8b07a", "#8a6036");
        ctx.fill();
        trait(ctx, "rgba(20,12,6,.8)", 0.015);
        ctx.fillStyle = "#4e3c2c";
        ctx.fillRect(-0.12, -0.44, 0.08, 0.2);
      });
    },
    menhir(ctx) {
      ctx.save();
      ctx.scale(0.9, 1.2);
      caillou(ctx, 0, 0, 0.38, 151, 9);
      ctx.restore();
      for (let k = 0; k < 6; k++) {
        rond(ctx, (h32(k, 1, 53) - 0.5) * 0.4, (h32(k, 2, 53) - 0.5) * 0.6, 0.03 + 0.02 * h32(k, 3, 53));
        ctx.fillStyle = k % 2 ? "rgba(170,180,100,.7)" : "rgba(210,200,150,.6)";
        ctx.fill();
      }
    },
    riviere(ctx, hw, hh) {
      // L'eau court sur la longueur ; les bouts sont droits, deux rivières se raccordent.
      enLong(ctx, hw, hh, (w, h) => {
        const bord = (s, t) => s * (h - 0.14 - 0.07 * Math.sin(t * 2.7 + s * 1.3) - 0.03 * Math.sin(t * 7.1));
        const chemin = () => {
          ctx.beginPath();
          ctx.moveTo(-w, bord(-1, -w));
          for (let t = -w; t <= w + 0.001; t += 0.1) ctx.lineTo(t, bord(-1, t));
          for (let t = w; t >= -w - 0.001; t -= 0.1) ctx.lineTo(t, bord(1, t));
          ctx.closePath();
        };
        // Les berges : un peu de vase et d'herbe mouillée.
        ctx.fillStyle = "#4e4a30";
        ctx.fillRect(-w, -h, w * 2, h * 2);
        const g0 = ctx.createLinearGradient(0, -h, 0, h);
        g0.addColorStop(0, "rgba(90,110,50,.9)");
        g0.addColorStop(0.2, "rgba(70,62,40,.6)");
        g0.addColorStop(0.8, "rgba(70,62,40,.6)");
        g0.addColorStop(1, "rgba(90,110,50,.9)");
        ctx.fillStyle = g0;
        ctx.fillRect(-w, -h, w * 2, h * 2);
        chemin();
        const g = ctx.createLinearGradient(0, -h, 0, h);
        g.addColorStop(0, "#3e6a7c");
        g.addColorStop(0.5, "#1c3c4c");
        g.addColorStop(1, "#3e6a7c");
        ctx.fillStyle = g;
        ctx.fill();
        chemin();
        trait(ctx, "rgba(40,34,20,.6)", 0.04);
        ctx.strokeStyle = "rgba(200,230,240,.3)";
        ctx.lineWidth = 0.02;
        ctx.lineCap = "round";
        ctx.beginPath();
        for (let n = 0; n < Math.round(w * 6); n++) {
          const x = -w + 0.1 + h32(n, 1, 59) * (w * 2 - 0.4);
          const y = (h32(n, 2, 59) - 0.5) * (h - 0.4) * 1.6;
          ctx.moveTo(x, y);
          ctx.quadraticCurveTo(x + 0.12, y - 0.03, x + 0.26, y);
        }
        ctx.stroke();
        ctx.lineCap = "butt";
      });
    },
    pont(ctx, hw, hh) {
      // Le tablier court sur la longueur, les planches en travers.
      enLong(ctx, hw, hh, (w, h) => {
        ctx.fillStyle = "#24160c";
        ctx.fillRect(-w + 0.02, -h + 0.1, w * 2 - 0.04, h * 2 - 0.2);
        const n = Math.max(4, Math.round((w * 2) / 0.22));
        for (let k = 0; k < n; k++) {
          const x = -w + 0.04 + (k * (w * 2 - 0.08)) / n;
          const v = h32(k, 3, 163);
          ctx.fillStyle = `rgb(${142 + 26 * v},${96 + 18 * v},${56 + 10 * v})`;
          ctx.fillRect(x + 0.01, -h + 0.16 + (v - 0.5) * 0.04, (w * 2 - 0.08) / n - 0.025, h * 2 - 0.32);
          ctx.fillStyle = "#2f2f2c";
          ctx.fillRect(x + 0.06, -h + 0.24, 0.025, 0.025);
          ctx.fillRect(x + 0.06, h - 0.27, 0.025, 0.025);
        }
        for (const s of [-1, 1]) {
          ctx.fillStyle = BOIS.sombre;
          ctx.fillRect(-w + 0.02, s > 0 ? h - 0.16 : -h + 0.06, w * 2 - 0.04, 0.1);
          ctx.strokeStyle = BOIS.bord;
          ctx.lineWidth = 0.02;
          ctx.strokeRect(-w + 0.02, s > 0 ? h - 0.16 : -h + 0.06, w * 2 - 0.04, 0.1);
          for (const t of [-w + 0.1, 0, w - 0.1]) {
            rond(ctx, t, s * (h - 0.11), 0.075);
            ctx.fillStyle = degrade(ctx, t, s * (h - 0.11), 0.075, BOIS.clair, BOIS.noir);
            ctx.fill();
          }
        }
      });
    },
    cloture(ctx, hw, hh) {
      enLong(ctx, hw, hh, (w) => {
        for (const y of [-0.07, 0.04]) {
          ctx.fillStyle = BOIS.moyen;
          ctx.fillRect(-w + 0.06, y, w * 2 - 0.12, 0.05);
          ctx.strokeStyle = BOIS.bord;
          ctx.lineWidth = 0.012;
          ctx.strokeRect(-w + 0.06, y, w * 2 - 0.12, 0.05);
        }
        const poteaux = [];
        for (let t = -w + 0.12; t < w - 0.1; t += 1) poteaux.push(t);
        poteaux.push(w - 0.12);
        for (const t of poteaux) {
          rr(ctx, t - 0.07, -0.08, 0.14, 0.16, 0.02);
          ctx.fillStyle = degrade(ctx, t, 0, 0.12, BOIS.clair, BOIS.noir);
          ctx.fill();
          trait(ctx, BOIS.bord, 0.015);
        }
      });
    },
    palissade(ctx, hw, hh) {
      enLong(ctx, hw, hh, (w) => {
        ctx.fillStyle = "#2a1a0e";
        ctx.fillRect(-w + 0.02, -0.12, w * 2 - 0.04, 0.24);
        const n = Math.max(4, Math.round((w * 2) / 0.21));
        for (let k = 0; k < n; k++) {
          const x = -w + 0.105 + (k * (w * 2 - 0.21)) / (n - 1);
          const r = 0.1 + 0.015 * h32(k, 1, 167);
          rond(ctx, x, (h32(k, 2, 167) - 0.5) * 0.03, r);
          ctx.fillStyle = degrade(ctx, x, 0, r, "#9a6a3c", "#3a2414");
          ctx.fill();
          trait(ctx, BOIS.bord, 0.015);
          // Le bout taillé en pointe.
          rond(ctx, x - 0.015, -0.015, r * 0.42);
          ctx.fillStyle = "rgba(226,190,130,.65)";
          ctx.fill();
        }
        ctx.strokeStyle = "#a08860";
        ctx.lineWidth = 0.02;
        ctx.beginPath();
        ctx.moveTo(-w + 0.04, 0.06);
        ctx.lineTo(w - 0.04, 0.06);
        ctx.stroke();
      });
    },
    "feu-de-camp"(ctx) {
      ailleurs(ctx, 0, 0, 1.15, 0, () => O["feu-de-camp"](ctx));
    },
    tente(ctx, hw, hh, teinte) {
      const t0 = teinte || "#a89466";
      const t = { clair: nuance(t0, 0.12), moyen: t0, sombre: nuance(t0, -0.32) };
      ctx.strokeStyle = "rgba(200,184,150,.7)";
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      for (const [x, y] of [[-hw + 0.04, -hh + 0.04], [hw - 0.04, -hh + 0.04], [hw - 0.04, hh - 0.04], [-hw + 0.04, hh - 0.04]]) {
        ctx.moveTo(x * 0.7, y * 0.75);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      for (const [x, y] of [[-hw + 0.04, -hh + 0.04], [hw - 0.04, -hh + 0.04], [hw - 0.04, hh - 0.04], [-hw + 0.04, hh - 0.04]]) {
        ctx.fillStyle = BOIS.sombre;
        ctx.fillRect(x - 0.025, y - 0.025, 0.05, 0.05);
      }
      // Deux pans, l'un au jour, l'autre à l'ombre ; le faîte au milieu.
      const x0 = -hw + 0.22;
      const x1 = hw - 0.22;
      const y0 = -hh + 0.16;
      const y1 = hh - 0.16;
      ctx.fillStyle = t.clair;
      ctx.fillRect(x0, y0, -x0, y1 - y0);
      ctx.fillStyle = t.sombre;
      ctx.fillRect(0, y0, x1, y1 - y0);
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, "rgba(255,250,235,.12)");
      g.addColorStop(0.5, "rgba(255,250,235,0)");
      g.addColorStop(0.5, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,.25)");
      ctx.fillStyle = g;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeStyle = "rgba(30,20,10,.35)";
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      for (let y = y0 + 0.3; y < y1; y += 0.3) {
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
      }
      ctx.stroke();
      ctx.strokeStyle = "rgba(24,14,6,.8)";
      ctx.lineWidth = 0.02;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillStyle = BOIS.sombre;
      ctx.fillRect(-0.03, y0 - 0.06, 0.06, y1 - y0 + 0.12);
      // L'entrée, rabattue.
      poly(ctx, [[x0 + 0.1, y1], [0, y1 - 0.34], [x1 - 0.1, y1]]);
      ctx.fillStyle = "rgba(10,6,2,.55)";
      ctx.fill();
    },
    panneau(ctx) {
      for (const [a, l] of [[-0.5, 0.42], [0.7, 0.38], [2.5, 0.32]]) {
        ctx.save();
        ctx.rotate(a);
        poly(ctx, [[0.04, -0.07], [l, -0.07], [l + 0.08, 0], [l, 0.07], [0.04, 0.07]]);
        ctx.save();
        ctx.clip();
        planches(ctx, 0, -0.07, l + 0.1, 0.14, 1, BOIS.clair, 171);
        ctx.restore();
        poly(ctx, [[0.04, -0.07], [l, -0.07], [l + 0.08, 0], [l, 0.07], [0.04, 0.07]]);
        trait(ctx, BOIS.bord, 0.015);
        ctx.strokeStyle = "rgba(40,22,8,.6)";
        ctx.lineWidth = 0.012;
        ctx.beginPath();
        ctx.moveTo(0.12, 0);
        ctx.lineTo(l - 0.06, 0);
        ctx.stroke();
        ctx.restore();
      }
      rr(ctx, -0.07, -0.07, 0.14, 0.14, 0.02);
      ctx.fillStyle = degrade(ctx, 0, 0, 0.1, BOIS.clair, BOIS.noir);
      ctx.fill();
    },

    // ---------------------------------------------------------------- ferme et écurie
    potager(ctx, hw, hh) {
      rr(ctx, -hw + 0.04, -hh + 0.04, hw * 2 - 0.08, hh * 2 - 0.08, 0.04);
      ctx.fillStyle = BOIS.sombre;
      ctx.fill();
      rr(ctx, -hw + 0.1, -hh + 0.1, hw * 2 - 0.2, hh * 2 - 0.2, 0.03);
      ctx.fillStyle = "#4a3422";
      ctx.fill();
      const rangs = Math.max(2, Math.round((hh * 2) / 0.42));
      for (let r = 0; r < rangs; r++) {
        const y = -hh + 0.3 + (r * (hh * 2 - 0.6)) / (rangs - 1);
        ctx.fillStyle = "rgba(110,80,50,.5)";
        ctx.fillRect(-hw + 0.12, y - 0.08, hw * 2 - 0.24, 0.16);
        for (let x = -hw + 0.3; x < hw - 0.2; x += 0.26) {
          const px = x + (r % 2) * 0.1;
          if (r % 2) {
            rond(ctx, px, y, 0.09);
            ctx.fillStyle = degrade(ctx, px, y, 0.09, "#b8d488", "#3e6a2a");
            ctx.fill();
          } else {
            ctx.strokeStyle = "#5a8a34";
            ctx.lineWidth = 0.015;
            ctx.beginPath();
            for (let k = 0; k < 5; k++) {
              const a = (k / 5) * Math.PI * 2;
              ctx.moveTo(px, y);
              ctx.lineTo(px + Math.cos(a) * 0.08, y + Math.sin(a) * 0.08);
            }
            ctx.stroke();
          }
        }
      }
    },
    epouvantail(ctx) {
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-0.42, 0.02);
      ctx.lineTo(0.42, -0.02);
      trait(ctx, BOIS.sombre, 0.07);
      ctx.lineCap = "butt";
      ctx.beginPath();
      ctx.ellipse(0, 0.04, 0.24, 0.15, 0, 0, Math.PI * 2);
      ctx.fillStyle = degrade(ctx, 0, 0.04, 0.24, "#5c6e8a", "#232c3a");
      ctx.fill();
      ctx.fillStyle = "#8a5a2a";
      ctx.fillRect(0.04, 0, 0.1, 0.08);
      pailleSur(ctx, -0.36, 0.02, 0.08, 10, 177);
      pailleSur(ctx, 0.36, -0.02, 0.08, 10, 179);
      rond(ctx, 0, -0.02, 0.17);
      ctx.fillStyle = degrade(ctx, 0, -0.02, 0.17, "#e8c878", "#8a6a2a");
      ctx.fill();
      rond(ctx, 0, -0.02, 0.08);
      trait(ctx, "rgba(90,60,20,.6)", 0.015);
    },

    // ---------------------------------------------------------------- grotte
    cristaux(ctx) {
      for (const [x, y, r, a] of [[-0.12, 0.08, 0.21, 0.3], [0.17, -0.1, 0.16, 1.1], [0.14, 0.22, 0.12, 0.2], [-0.2, -0.2, 0.11, 0.8], [0.3, 0.06, 0.08, 0.5]]) {
        const pts = [];
        for (let n = 0; n < 6; n++) pts.push([x + Math.cos(a + (n / 6) * Math.PI * 2) * r, y + Math.sin(a + (n / 6) * Math.PI * 2) * r]);
        poly(ctx, pts);
        ctx.fillStyle = degrade(ctx, x, y, r, "#e8f6ff", "#3a5a9a");
        ctx.fill();
        trait(ctx, "rgba(20,30,60,.7)", 0.012);
        for (let n = 0; n < 3; n++) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(...pts[n * 2]);
          trait(ctx, "rgba(240,250,255,.4)", 0.008);
        }
        rond(ctx, x - r * 0.25, y - r * 0.25, r * 0.18);
        ctx.fillStyle = "rgba(255,255,255,.6)";
        ctx.fill();
      }
    },

    // ---------------------------------------------------------------- navire et quai
    ponton(ctx, hw, hh) {
      enLong(ctx, hw, hh, (w, h) => {
        for (const [x, y] of [[-w + 0.12, -h + 0.12], [w - 0.12, -h + 0.12], [-w + 0.12, h - 0.12], [w - 0.12, h - 0.12], [0, -h + 0.12], [0, h - 0.12]]) {
          rond(ctx, x, y, 0.1);
          ctx.fillStyle = degrade(ctx, x, y, 0.1, "#8a6a4a", "#24160c");
          ctx.fill();
        }
        ctx.fillStyle = "#24160c";
        ctx.fillRect(-w + 0.06, -h + 0.08, w * 2 - 0.12, h * 2 - 0.16);
        const n = Math.max(4, Math.round((w * 2) / 0.22));
        for (let k = 0; k < n; k++) {
          const x = -w + 0.08 + (k * (w * 2 - 0.16)) / n;
          const v = h32(k, 5, 181);
          ctx.fillStyle = `rgb(${130 + 30 * v},${94 + 20 * v},${60 + 12 * v})`;
          ctx.fillRect(x, -h + 0.1 + (v - 0.5) * 0.04, (w * 2 - 0.16) / n - 0.025, h * 2 - 0.2);
        }
        ctx.strokeStyle = "rgba(20,10,4,.35)";
        ctx.lineWidth = 0.01;
        ctx.beginPath();
        for (let k = 0; k < n * 2; k++) {
          const x = -w + 0.12 + (k * (w * 2 - 0.24)) / (n * 2);
          ctx.moveTo(x, -h + 0.14);
          ctx.lineTo(x + 0.01, h - 0.14);
        }
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(w - 0.12, 0, 0.06, 0, Math.PI * 2);
        trait(ctx, FER.sombre, 0.025);
      });
    },
    passerelle(ctx, hw, hh) {
      enLong(ctx, hw, hh, (w, h) => {
        plateau(ctx, -w + 0.04, -h + 0.16, w * 2 - 0.08, h * 2 - 0.32, 2, BOIS.moyen, 191, 0.03);
        for (let x = -w + 0.3; x < w - 0.2; x += 0.3) {
          ctx.fillStyle = BOIS.noir;
          ctx.fillRect(x, -h + 0.2, 0.04, h * 2 - 0.4);
        }
      });
    },
    barque(ctx, hw, hh) {
      enLong(ctx, hw, hh, (w, h) => {
        const coque = (k) => {
          ctx.beginPath();
          ctx.moveTo(w - 0.04 - k, 0);
          ctx.quadraticCurveTo(w * 0.4, -h + 0.06 + k, -w + 0.2, -h + 0.12 + k);
          ctx.quadraticCurveTo(-w + 0.06 + k, -h + 0.16 + k, -w + 0.06 + k, 0);
          ctx.quadraticCurveTo(-w + 0.06 + k, h - 0.16 - k, -w + 0.2, h - 0.12 - k);
          ctx.quadraticCurveTo(w * 0.4, h - 0.06 - k, w - 0.04 - k, 0);
          ctx.closePath();
        };
        coque(0);
        ctx.fillStyle = BOIS.noir;
        ctx.fill();
        trait(ctx, BOIS.bord, 0.025);
        coque(0.07);
        ctx.save();
        ctx.clip();
        planches(ctx, -w, -h, w * 2, h * 2, 5, "#8d5c32", 193);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, "rgba(0,0,0,.4)");
        ctx.fillStyle = g;
        ctx.fillRect(-w, -h, w * 2, h * 2);
        ctx.restore();
        for (const t of [-0.3, 0.28]) {
          ctx.fillStyle = BOIS.clair;
          ctx.fillRect(t * w - 0.05, -h + 0.16, 0.1, h * 2 - 0.32);
          ctx.strokeStyle = BOIS.bord;
          ctx.lineWidth = 0.012;
          ctx.strokeRect(t * w - 0.05, -h + 0.16, 0.1, h * 2 - 0.32);
        }
        // Les rames, rentrées.
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(-w * 0.6, s * 0.1);
          ctx.lineTo(w * 0.5, s * 0.14);
          ctx.lineCap = "round";
          trait(ctx, "#b88a54", 0.03);
          ctx.lineCap = "butt";
          ctx.beginPath();
          ctx.ellipse(w * 0.5, s * 0.14, 0.12, 0.04, 0, 0, Math.PI * 2);
          ctx.fillStyle = "#b88a54";
          ctx.fill();
        }
      });
    },
    mat(ctx) {
      ctx.strokeStyle = "rgba(200,184,150,.5)";
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      for (const [a, b] of [[-0.46, -0.42], [0.46, -0.42], [-0.46, 0.42], [0.46, 0.42]]) {
        ctx.moveTo(0, 0);
        ctx.lineTo(a, b);
      }
      ctx.stroke();
      rr(ctx, -0.48, -0.04, 0.96, 0.08, 0.04);
      ctx.fillStyle = degrade(ctx, 0, 0, 0.5, BOIS.clair, BOIS.sombre);
      ctx.fill();
      trait(ctx, BOIS.bord, 0.015);
      rond(ctx, 0, 0, 0.17);
      ctx.fillStyle = degrade(ctx, 0, 0, 0.17, "#c09060", "#4e321a");
      ctx.fill();
      trait(ctx, BOIS.bord, 0.02);
      rond(ctx, 0, 0, 0.13);
      trait(ctx, FER.sombre, 0.025);
    },
    gouvernail(ctx) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 0.08, Math.sin(a) * 0.08);
        ctx.lineTo(Math.cos(a) * 0.44, Math.sin(a) * 0.44);
        ctx.lineCap = "round";
        trait(ctx, BOIS.noir, 0.06);
        trait(ctx, "#9a6a3c", 0.035);
      }
      ctx.lineCap = "butt";
      ctx.beginPath();
      ctx.arc(0, 0, 0.3, 0, Math.PI * 2);
      trait(ctx, BOIS.noir, 0.09);
      trait(ctx, "#8d5c32", 0.06);
      rond(ctx, 0, 0, 0.1);
      ctx.fillStyle = degrade(ctx, 0, 0, 0.1, "#ffe08a", "#7a5414");
      ctx.fill();
    },
    bitte(ctx) {
      rond(ctx, 0, 0, 0.25);
      ctx.fillStyle = degrade(ctx, 0, 0, 0.25, FER.clair, FER.sombre);
      ctx.fill();
      trait(ctx, FER.bord, 0.02);
      rond(ctx, 0, 0, 0.18);
      ctx.fillStyle = degrade(ctx, 0, 0, 0.18, "#7a7c7a", "#2c2e2e", 0.2, 0.2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, 0.3, 0.4, 5.6);
      ctx.lineTo(0.44, 0.32);
      ctx.lineCap = "round";
      trait(ctx, "#5a4a2a", 0.065);
      trait(ctx, "#c8b07a", 0.04);
      ctx.lineCap = "butt";
    },
    ancre(ctx) {
      ctx.lineCap = "round";
      const forme = () => {
        ctx.beginPath();
        ctx.moveTo(0, -0.3);
        ctx.lineTo(0, 0.33);
        ctx.moveTo(-0.17, -0.18);
        ctx.lineTo(0.17, -0.18);
        ctx.moveTo(-0.3, 0.1);
        ctx.quadraticCurveTo(-0.24, 0.38, 0, 0.36);
        ctx.quadraticCurveTo(0.24, 0.38, 0.3, 0.1);
      };
      forme();
      trait(ctx, "#121212", 0.1);
      forme();
      trait(ctx, "#4a4c4c", 0.065);
      forme();
      trait(ctx, "rgba(210,210,200,.3)", 0.02);
      ctx.lineCap = "butt";
      for (const s of [-1, 1]) {
        poly(ctx, [[s * 0.3, 0.1], [s * 0.38, 0.04], [s * 0.3, 0.22]]);
        ctx.fillStyle = "#3a3c3c";
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(0, -0.37, 0.07, 0, Math.PI * 2);
      trait(ctx, "#2c2e2e", 0.035);
      ctx.beginPath();
      ctx.moveTo(0.05, -0.42);
      ctx.quadraticCurveTo(0.3, -0.46, 0.42, -0.3);
      trait(ctx, "#c8b07a", 0.035);
    },
    cordages(ctx) {
      const spirale = () => {
        ctx.beginPath();
        for (let a = 0; a < Math.PI * 9; a += 0.15) {
          const r = 0.04 + a * 0.012;
          if (a) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          else ctx.moveTo(r, 0);
        }
        ctx.quadraticCurveTo(0.44, 0.1, 0.42, 0.36);
      };
      ctx.lineCap = "round";
      spirale();
      trait(ctx, "#4a3a1e", 0.07);
      spirale();
      trait(ctx, "#c8ae74", 0.05);
      ctx.setLineDash([0.02, 0.03]);
      spirale();
      trait(ctx, "rgba(90,70,30,.6)", 0.03);
      ctx.setLineDash([]);
      ctx.lineCap = "butt";
    },
    filet(ctx, hw, hh) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, hw - 0.08, hh - 0.14, 0.2, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "rgba(40,30,16,.18)";
      ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
      ctx.strokeStyle = "rgba(214,196,150,.75)";
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      for (let t = -hw - hh; t <= hw + hh; t += 0.14) {
        ctx.moveTo(t - hh, -hh);
        ctx.quadraticCurveTo(t, 0.05 * Math.sin(t * 5), t + hh, hh);
        ctx.moveTo(t + hh, -hh);
        ctx.quadraticCurveTo(t, 0.05 * Math.cos(t * 5), t - hh, hh);
      }
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.ellipse(0, 0, hw - 0.08, hh - 0.14, 0.2, 0, Math.PI * 2);
      trait(ctx, "#a08a5a", 0.03);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + 0.2;
        const x = Math.cos(a) * (hw - 0.08);
        const y = Math.sin(a) * (hh - 0.14);
        rond(ctx, x * Math.cos(0.2) - y * Math.sin(0.2), x * Math.sin(0.2) + y * Math.cos(0.2), 0.055);
        ctx.fillStyle = degrade(ctx, 0, 0, 0.06, "#e0a050", "#7a4a1a");
        ctx.fill();
      }
    },

    // ---------------------------------------------------------------- ruines
    "mur-ruine"(ctx, hw, hh) {
      enLong(ctx, hw, hh, (w) => {
        const rangs = [[-0.21, 0.21], [0, 0.21]];
        let g = 0;
        rangs.forEach(([y, h], r) => {
          // Le haut du pan s'effondre vers un bout : les rangs du dessus s'arrêtent plus tôt.
          const fin = w - 0.2 - (1 - r) * 0.5 - 0.3 * h32(r, 1, 197);
          let x = -w + 0.04 + (r % 2) * 0.22;
          if (r % 2) pierreTaillee(ctx, -w + 0.04, y, 0.2, h - 0.015, g++);
          while (x < fin) {
            const l = Math.min(0.4 + 0.16 * h32(g, 2, 197), fin - x);
            if (l > 0.06) pierreTaillee(ctx, x, y, l - 0.02, h - 0.015, g);
            x += l;
            g++;
          }
        });
        for (const [x, y, r, k] of [[w - 0.26, 0.26, 0.11, 3], [w - 0.12, -0.2, 0.08, 5], [w - 0.5, 0.34, 0.07, 7], [-w + 0.5, 0.34, 0.06, 9]]) caillou(ctx, x, y, r, 200 + k, 6);
      });
    },
    "colonne-brisee"(ctx) {
      M.colonne(ctx);
      ctx.beginPath();
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const q = 0.3 * (k % 2 ? 0.68 : 1) * (0.9 + 0.2 * h32(k, 1, 211));
        if (k) ctx.lineTo(Math.cos(a) * q, Math.sin(a) * q);
        else ctx.moveTo(q, 0);
      }
      ctx.closePath();
      ctx.fillStyle = degrade(ctx, 0, 0, 0.3, "#e6e0d2", "#8a8376");
      ctx.fill();
      trait(ctx, "rgba(40,34,28,.55)", 0.015);
      caillou(ctx, 0.38, 0.36, 0.1, 213, 6);
      caillou(ctx, -0.36, 0.4, 0.07, 215, 5);
    },
    "colonne-couchee"(ctx, hw, hh) {
      enLong(ctx, hw, hh, (w) => {
        ctx.beginPath();
        ctx.moveTo(-w + 0.14, -0.3);
        ctx.lineTo(w - 0.3, -0.3);
        ctx.lineTo(w - 0.16, -0.14);
        ctx.lineTo(w - 0.26, 0.02);
        ctx.lineTo(w - 0.12, 0.3);
        ctx.lineTo(-w + 0.14, 0.3);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, -0.3, 0, 0.3);
        g.addColorStop(0, "#d4cdbf");
        g.addColorStop(0.45, "#a39c8e");
        g.addColorStop(1, "#5a544a");
        ctx.fillStyle = g;
        ctx.fill();
        trait(ctx, PIERRE.bord, 0.022);
        ctx.strokeStyle = "rgba(40,34,28,.3)";
        ctx.lineWidth = 0.012;
        ctx.beginPath();
        for (const t of [-0.2, -0.1, 0, 0.1, 0.2]) {
          ctx.moveTo(-w + 0.2, t);
          ctx.lineTo(w - 0.32, t);
        }
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(-w + 0.14, 0, 0.1, 0.3, 0, 0, Math.PI * 2);
        ctx.fillStyle = degrade(ctx, -w + 0.14, 0, 0.3, "#dcd6c8", "#7a7468");
        ctx.fill();
        trait(ctx, PIERRE.bord, 0.02);
        caillou(ctx, w - 0.12, -0.34, 0.08, 219, 6);
      });
    },
    "statue-brisee"(ctx) {
      ctx.fillStyle = degrade(ctx, 0, 0, 0.6, PIERRE.clair, PIERRE.sombre);
      ctx.fillRect(-0.42, -0.42, 0.84, 0.84);
      ctx.strokeStyle = PIERRE.bord;
      ctx.lineWidth = 0.022;
      ctx.strokeRect(-0.42, -0.42, 0.84, 0.84);
      poly(ctx, [[-0.27, -0.06], [0.08, -0.17], [0.25, 0.02], [0.1, 0.19], [-0.21, 0.15]]);
      ctx.fillStyle = degrade(ctx, 0, 0, 0.3, "#e6e0d4", "#7e776c");
      ctx.fill();
      trait(ctx, "rgba(40,34,28,.6)", 0.015);
      ctx.beginPath();
      ctx.moveTo(-0.02, -0.13);
      ctx.lineTo(0.04, 0.02);
      ctx.lineTo(-0.06, 0.12);
      trait(ctx, "rgba(40,34,28,.5)", 0.012);
      caillou(ctx, 0.3, -0.3, 0.1, 223, 6);
      O.crane(ctx, -0.3, 0.3);
    },
    eboulis(ctx, hw, hh) {
      const pieces = [];
      for (let k = 0; k < 11; k++) pieces.push([(h32(k, 1, 227) - 0.5) * (hw * 2 - 0.5), (h32(k, 2, 227) - 0.5) * (hh * 2 - 0.5), 0.13 + h32(k, 3, 227) * 0.22, k]);
      pieces.sort((a, b) => a[2] - b[2]);
      for (const [x, y, r, k] of pieces.reverse()) caillou(ctx, x, y, r, 230 + k, 7);
      for (let k = 0; k < 14; k++) caillou(ctx, (h32(k, 4, 227) - 0.5) * (hw * 2 - 0.2), (h32(k, 5, 227) - 0.5) * (hh * 2 - 0.2), 0.04 + 0.03 * h32(k, 6, 227), 250 + k, 5);
    },
    gravats(ctx) {
      for (let k = 0; k < 9; k++) caillou(ctx, (h32(k, 4, 233) - 0.5) * 0.72, (h32(k, 5, 233) - 0.5) * 0.72, 0.045 + h32(k, 6, 233) * 0.06, 260 + k, 5);
    },

    // ---------------------------------------------------------------- bureau et bibliothèque
    bibliotheque(ctx, hw, hh) {
      enLong(ctx, hw, hh, (w, h) => {
        const y = -h + 0.03;
        ctx.fillStyle = BOIS.sombre;
        ctx.fillRect(-w + 0.03, y, w * 2 - 0.06, 0.46);
        ctx.strokeStyle = BOIS.bord;
        ctx.lineWidth = 0.025;
        ctx.strokeRect(-w + 0.03, y, w * 2 - 0.06, 0.46);
        let x = -w + 0.08;
        let k = 0;
        const couleurs = ["#7b2a22", "#3d4f6a", "#c9b48a", "#2e4a34", "#5a3a22", "#6a2a4a", "#a8742c"];
        while (x < w - 0.1) {
          const l = 0.045 + h32(k, 3, 239) * 0.055;
          const p = 0.3 + h32(k, 4, 239) * 0.08;
          const c = couleurs[k % couleurs.length];
          const g = ctx.createLinearGradient(x, 0, x + l, 0);
          g.addColorStop(0, c);
          g.addColorStop(1, "rgba(0,0,0,.6)");
          ctx.fillStyle = c;
          ctx.fillRect(x, y + 0.05, l, p);
          ctx.fillStyle = g;
          ctx.fillRect(x, y + 0.05, l, p);
          ctx.fillStyle = "rgba(230,210,150,.55)";
          ctx.fillRect(x + l * 0.2, y + 0.05 + p * 0.8, l * 0.6, 0.012);
          x += l + 0.006;
          k++;
        }
      });
    },
    bureau(ctx, hw, hh) {
      enLong(ctx, hw, hh, (w, h) => {
        plateau(ctx, -w + 0.06, -h + 0.08, w * 2 - 0.12, h * 2 - 0.16, 3, BOIS.sombre, 241, 0.05);
        for (const [x, a, c] of [[-0.32, -0.15, "#efe3c6"], [0.02, 0.2, "#e6d6b0"]]) {
          ailleurs(ctx, x, 0.02, 1, a, () => {
            ctx.fillStyle = c;
            ctx.fillRect(-0.15, -0.2, 0.3, 0.4);
            ctx.strokeStyle = "rgba(60,40,20,.45)";
            ctx.lineWidth = 0.008;
            ctx.beginPath();
            for (let l = 0; l < 7; l++) {
              ctx.moveTo(-0.11, -0.15 + l * 0.05);
              ctx.lineTo(0.1, -0.15 + l * 0.05);
            }
            ctx.stroke();
          });
        }
        rond(ctx, w - 0.42, -0.12, 0.06);
        ctx.fillStyle = degrade(ctx, w - 0.42, -0.12, 0.06, "#4a4a5a", "#0a0a10");
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(w - 0.44, -0.12);
        ctx.quadraticCurveTo(w - 0.3, -0.05, w - 0.2, 0.14);
        trait(ctx, "#e6e0d0", 0.02);
        rond(ctx, -w + 0.3, 0.2, 0.05);
        ctx.fillStyle = "#8e1b17";
        ctx.fill();
      });
    },
    fauteuil(ctx, hw, hh, teinte) {
      const t = tissu(teinte, "#5c2440");
      rr(ctx, -0.38, -0.38, 0.76, 0.74, 0.1);
      ctx.fillStyle = degrade(ctx, 0, 0, 0.5, BOIS.moyen, BOIS.noir);
      ctx.fill();
      trait(ctx, BOIS.bord, 0.02);
      rr(ctx, -0.32, -0.34, 0.64, 0.18, 0.07);
      ctx.fillStyle = degrade(ctx, 0, -0.25, 0.3, t.clair, t.sombre);
      ctx.fill();
      rr(ctx, -0.25, -0.15, 0.5, 0.44, 0.09);
      ctx.fillStyle = degrade(ctx, 0, 0.07, 0.35, t.clair, t.sombre);
      ctx.fill();
      trait(ctx, "rgba(10,4,2,.5)", 0.015);
      for (const [x, y] of [[-0.1, -0.02], [0.1, -0.02], [0, 0.14]]) {
        rond(ctx, x, y, 0.018);
        ctx.fillStyle = "rgba(10,4,2,.5)";
        ctx.fill();
      }
    },
    "table-cartes"(ctx, hw, hh) {
      plateau(ctx, -hw + 0.08, -hh + 0.08, hw * 2 - 0.16, hh * 2 - 0.16, 5, BOIS.moyen, 251, 0.06);
      ailleurs(ctx, 0, 0, 1, 0.06, () => {
        const [w, h] = [hw * 2 - 0.62, hh * 2 - 0.62];
        ctx.fillStyle = "#e6d6b0";
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.fillStyle = "rgba(120,90,50,.15)";
        ctx.fillRect(-w / 2, -h / 2, w, h * 0.12);
        ctx.strokeStyle = "rgba(60,40,20,.6)";
        ctx.lineWidth = 0.014;
        ctx.beginPath();
        ctx.moveTo(-w / 2 + 0.1, 0.1);
        ctx.bezierCurveTo(-0.3, -0.4, 0.2, 0.3, w / 2 - 0.1, -0.2);
        ctx.moveTo(-0.2, -h / 2 + 0.1);
        ctx.quadraticCurveTo(0, 0, 0.2, h / 2 - 0.1);
        ctx.stroke();
        ctx.strokeStyle = "rgba(142,27,23,.7)";
        ctx.setLineDash([0.04, 0.03]);
        ctx.beginPath();
        ctx.moveTo(-0.4, 0.3);
        ctx.quadraticCurveTo(0, 0.1, 0.35, -0.3);
        ctx.stroke();
        ctx.setLineDash([]);
        // La rose des vents.
        ctx.fillStyle = "rgba(60,40,20,.7)";
        poly(ctx, [[w / 2 - 0.2, -h / 2 + 0.08], [w / 2 - 0.17, -h / 2 + 0.2], [w / 2 - 0.2, -h / 2 + 0.32], [w / 2 - 0.23, -h / 2 + 0.2]]);
        ctx.fill();
      });
      for (const [x, y, c] of [[-0.3, -0.2, "#c0283a"], [0.35, 0.25, "#2a5a9a"], [0.1, -0.4, "#c0283a"]]) {
        rond(ctx, x, y, 0.045);
        ctx.fillStyle = c;
        ctx.fill();
        trait(ctx, "rgba(0,0,0,.5)", 0.01);
      }
      // Une dague plantée dans la carte.
      ailleurs(ctx, hw - 0.5, hh - 0.45, 1, -0.7, () => {
        ctx.fillStyle = "#d8dad6";
        ctx.fillRect(-0.02, -0.2, 0.04, 0.2);
        ctx.fillStyle = "#c9a052";
        ctx.fillRect(-0.07, 0, 0.14, 0.03);
        ctx.fillStyle = BOIS.noir;
        ctx.fillRect(-0.02, 0.03, 0.04, 0.1);
      });
    },
    "table-alchimie"(ctx, hw, hh) {
      enLong(ctx, hw, hh, (w, h) => {
        plateau(ctx, -w + 0.06, -h + 0.1, w * 2 - 0.12, h * 2 - 0.2, 3, BOIS.sombre, 257, 0.05);
        for (const [x, y, r, c] of [[-w + 0.3, -0.08, 0.1, "#5ac08a"], [-w + 0.55, 0.14, 0.07, "#c04a6a"], [0.06, -0.12, 0.06, "#4a7ad0"], [0.24, 0.12, 0.08, "#e0b040"]]) {
          rond(ctx, x, y, r);
          ctx.fillStyle = degrade(ctx, x, y, r, "#f0fff8", c);
          ctx.fill();
          trait(ctx, "rgba(20,30,30,.6)", 0.01);
          rond(ctx, x, y, r * 0.35);
          ctx.fillStyle = "#c9b48a";
          ctx.fill();
        }
        rond(ctx, w - 0.36, 0, 0.19);
        ctx.fillStyle = degrade(ctx, w - 0.36, 0, 0.19, "#6a6c6a", "#141616");
        ctx.fill();
        trait(ctx, FER.bord, 0.02);
        rond(ctx, w - 0.36, 0, 0.13);
        ctx.fillStyle = degrade(ctx, w - 0.36, 0, 0.13, "#b8f08a", "#2a6a1a");
        ctx.fill();
        ctx.fillStyle = "#e6d6b0";
        ctx.fillRect(-0.2, 0.06, 0.18, 0.12);
      });
    },
    globe(ctx) {
      rond(ctx, 0, 0, 0.38);
      ctx.fillStyle = degrade(ctx, 0, 0, 0.38, BOIS.clair, BOIS.noir);
      ctx.fill();
      trait(ctx, BOIS.bord, 0.02);
      rond(ctx, 0, 0, 0.28);
      ctx.fillStyle = degrade(ctx, 0, 0, 0.28, "#7fb0c8", "#1c3a4c");
      ctx.fill();
      ctx.save();
      rond(ctx, 0, 0, 0.28);
      ctx.clip();
      ctx.fillStyle = "rgba(190,170,110,.85)";
      ctx.beginPath();
      ctx.ellipse(-0.08, -0.05, 0.12, 0.08, 0.6, 0, Math.PI * 2);
      ctx.moveTo(0.18, 0.09);
      ctx.ellipse(0.1, 0.09, 0.08, 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.32, 0.06, 0.4, 0, Math.PI * 2);
      trait(ctx, "#c9a052", 0.025);
      rond(ctx, -0.09, -0.1, 0.06);
      ctx.fillStyle = "rgba(255,255,255,.25)";
      ctx.fill();
    },
    "pile-livres"(ctx) {
      for (const [x, y, a, c] of [[-0.05, 0.08, 0.2, "#7b2a22"], [0.04, -0.01, -0.15, "#3d4f6a"], [0, -0.09, 0.35, "#2e4a34"]]) {
        ailleurs(ctx, x, y, 1, a, () => {
          ctx.fillStyle = c;
          ctx.fillRect(-0.23, -0.16, 0.46, 0.32);
          ctx.fillStyle = "#efe3c6";
          ctx.fillRect(-0.2, 0.13, 0.4, 0.03);
          ctx.fillStyle = "rgba(0,0,0,.35)";
          ctx.fillRect(-0.23, -0.16, 0.05, 0.32);
          ctx.fillStyle = "#c9a052";
          ctx.fillRect(-0.05, -0.04, 0.1, 0.08);
          ctx.strokeStyle = "rgba(10,4,2,.6)";
          ctx.lineWidth = 0.012;
          ctx.strokeRect(-0.23, -0.16, 0.46, 0.32);
        });
      }
    },

    // ---------------------------------------------------------------- mise en scène
    "tapis-rond"(ctx, hw, hh, teinte) {
      const t = tissu(teinte, "#9c2c22");
      const r = Math.min(hw, hh) - 0.1;
      ctx.strokeStyle = "#cdb88a";
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      for (let k = 0; k < 96; k++) {
        const a = (k / 96) * Math.PI * 2;
        ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.lineTo(Math.cos(a) * (r + 0.07), Math.sin(a) * (r + 0.07));
      }
      ctx.stroke();
      rond(ctx, 0, 0, r);
      ctx.fillStyle = degrade(ctx, 0, 0, r, t.moyen, t.sombre, 0, 0);
      ctx.fill();
      rond(ctx, 0, 0, r - 0.12);
      trait(ctx, "#c9a052", 0.06);
      rond(ctx, 0, 0, r - 0.22);
      trait(ctx, "#2c3e58", 0.025);
      ctx.beginPath();
      for (let n = 0; n <= 16; n++) {
        const a = (n / 16) * Math.PI * 2;
        const q = r * (n % 2 ? 0.28 : 0.46);
        if (n) ctx.lineTo(Math.cos(a) * q, Math.sin(a) * q);
        else ctx.moveTo(q, 0);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(201,160,82,.55)";
      ctx.fill();
      trait(ctx, "#2c3e58", 0.02);
      rond(ctx, 0, 0, r);
      trait(ctx, "rgba(20,8,4,.5)", 0.02);
    },
    "tapis-long"(ctx, hw, hh, teinte) {
      const t = tissu(teinte, "#9c2c22");
      enLong(ctx, hw, hh, (w, h) => {
        const x = -w + 0.12;
        const y = -h + 0.12;
        const L = w * 2 - 0.24;
        const H = h * 2 - 0.24;
        ctx.strokeStyle = "#cdb88a";
        ctx.lineWidth = 0.012;
        ctx.beginPath();
        for (let k = 0; k <= Math.round(H / 0.05); k++) {
          const v = y + (k * H) / Math.round(H / 0.05);
          ctx.moveTo(x - 0.07, v);
          ctx.lineTo(x, v);
          ctx.moveTo(x + L, v);
          ctx.lineTo(x + L + 0.07, v);
        }
        ctx.stroke();
        ctx.fillStyle = degrade(ctx, 0, 0, w, t.moyen, t.sombre, 0, 0);
        ctx.fillRect(x, y, L, H);
        ctx.strokeStyle = "#c9a052";
        ctx.lineWidth = 0.05;
        ctx.strokeRect(x + 0.07, y + 0.07, L - 0.14, H - 0.14);
        ctx.fillStyle = "rgba(201,160,82,.5)";
        ctx.strokeStyle = "#2c3e58";
        ctx.lineWidth = 0.018;
        for (let c = x + 0.5; c < x + L - 0.3; c += 0.6) {
          poly(ctx, [[c - 0.2, 0], [c, -H / 2 + 0.16], [c + 0.2, 0], [c, H / 2 - 0.16]]);
          ctx.fill();
          ctx.stroke();
        }
        ctx.strokeStyle = "rgba(20,8,4,.5)";
        ctx.lineWidth = 0.02;
        ctx.strokeRect(x, y, L, H);
      });
    },
    tenture(ctx, hw, hh, teinte) {
      const t = tissu(teinte, "#5c2440");
      enLong(ctx, hw, hh, (w, h) => {
        const y = -h + 0.06;
        const g = ctx.createLinearGradient(-w, 0, w, 0);
        const n = Math.max(4, Math.round(w * 5));
        for (let k = 0; k <= n; k++) g.addColorStop(k / n, k % 2 ? t.sombre : t.clair);
        ctx.fillStyle = t.moyen;
        ctx.fillRect(-w + 0.1, y, w * 2 - 0.2, 0.26);
        ctx.globalAlpha *= 0.55;
        ctx.fillStyle = g;
        ctx.fillRect(-w + 0.1, y, w * 2 - 0.2, 0.26);
        ctx.globalAlpha /= 0.55;
        ctx.fillStyle = "#c9a052";
        ctx.fillRect(-w + 0.1, y + 0.24, w * 2 - 0.2, 0.04);
        ctx.strokeStyle = "#c9a052";
        ctx.lineWidth = 0.01;
        ctx.beginPath();
        for (let x = -w + 0.12; x < w - 0.1; x += 0.04) {
          ctx.moveTo(x, y + 0.28);
          ctx.lineTo(x, y + 0.33);
        }
        ctx.stroke();
        ctx.fillStyle = FER.sombre;
        ctx.fillRect(-w + 0.04, y - 0.03, w * 2 - 0.08, 0.04);
        for (const s of [-1, 1]) {
          rond(ctx, s * (w - 0.06), y - 0.01, 0.035);
          ctx.fillStyle = "#c9a052";
          ctx.fill();
        }
      });
    },
    banniere(ctx, hw, hh, teinte) {
      const t = tissu(teinte, "#2c3e66");
      ctx.beginPath();
      ctx.moveTo(-0.3, -0.24);
      ctx.lineTo(0.3, -0.24);
      ctx.lineTo(0.3, 0.32);
      ctx.lineTo(0, 0.2);
      ctx.lineTo(-0.3, 0.32);
      ctx.closePath();
      const g = ctx.createLinearGradient(-0.3, 0, 0.3, 0);
      g.addColorStop(0, t.clair);
      g.addColorStop(0.5, t.moyen);
      g.addColorStop(1, t.sombre);
      ctx.fillStyle = g;
      ctx.fill();
      trait(ctx, "rgba(10,4,2,.6)", 0.015);
      ctx.strokeStyle = "#c9a052";
      ctx.lineWidth = 0.02;
      ctx.beginPath();
      ctx.moveTo(-0.26, -0.2);
      ctx.lineTo(0.26, -0.2);
      ctx.lineTo(0.26, 0.26);
      ctx.lineTo(0, 0.15);
      ctx.lineTo(-0.26, 0.26);
      ctx.closePath();
      ctx.stroke();
      rond(ctx, 0, 0.02, 0.1);
      ctx.fillStyle = degrade(ctx, 0, 0.02, 0.1, "#ffe08a", "#8a6418");
      ctx.fill();
      rr(ctx, -0.38, -0.29, 0.76, 0.06, 0.03);
      ctx.fillStyle = degrade(ctx, 0, -0.26, 0.4, BOIS.clair, BOIS.noir);
      ctx.fill();
      rond(ctx, 0, -0.26, 0.07);
      ctx.fillStyle = degrade(ctx, 0, -0.26, 0.07, "#c09060", "#3a2414");
      ctx.fill();
    },
    torchere(ctx, hw, hh) {
      ctx.fillStyle = FER.sombre;
      ctx.fillRect(-0.09, -hh + 0.02, 0.18, 0.08);
      ligneFer(ctx, 0, -hh + 0.08, 0, -hh + 0.24, 0.035);
      rr(ctx, -0.04, -hh + 0.2, 0.08, 0.18, 0.03);
      ctx.fillStyle = degrade(ctx, 0, -hh + 0.29, 0.1, "#9a6a3c", "#3a2414");
      ctx.fill();
      rond(ctx, 0, -hh + 0.36, 0.07);
      ctx.fillStyle = "#2a1a10";
      ctx.fill();
      feu(ctx, 0, -hh + 0.36, 0.16);
    },
    "coffre-fer"(ctx) {
      rr(ctx, -0.38, -0.27, 0.76, 0.54, 0.05);
      ctx.save();
      ctx.clip();
      planches(ctx, -0.38, -0.27, 0.76, 0.54, 3, "#5e3b1f", 263);
      ctx.restore();
      rr(ctx, -0.38, -0.27, 0.76, 0.54, 0.05);
      trait(ctx, BOIS.bord, 0.025);
      for (const x of [-0.27, 0, 0.27]) {
        const g = ctx.createLinearGradient(x - 0.035, 0, x + 0.035, 0);
        g.addColorStop(0, FER.clair);
        g.addColorStop(1, FER.sombre);
        ctx.fillStyle = g;
        ctx.fillRect(x - 0.035, -0.27, 0.07, 0.54);
        for (const y of [-0.2, 0, 0.2]) {
          rond(ctx, x, y, 0.014);
          ctx.fillStyle = "#d8dad6";
          ctx.fill();
        }
      }
      ctx.fillStyle = "#2c2e2e";
      ctx.fillRect(-0.06, 0.16, 0.12, 0.12);
      ctx.beginPath();
      ctx.arc(0, 0.16, 0.04, Math.PI, 0);
      trait(ctx, "#5a5c5c", 0.02);
    },
    "coffre-ouvert"(ctx) {
      // Le couvercle rabattu vers le mur, l'intérieur vers la pièce.
      rr(ctx, -0.37, -0.44, 0.74, 0.22, 0.04);
      ctx.save();
      ctx.clip();
      planches(ctx, -0.37, -0.44, 0.74, 0.22, 2, "#4e321a", 269);
      ctx.fillStyle = "rgba(0,0,0,.3)";
      ctx.fillRect(-0.37, -0.44, 0.74, 0.22);
      ctx.restore();
      rr(ctx, -0.37, -0.44, 0.74, 0.22, 0.04);
      trait(ctx, BOIS.bord, 0.02);
      rr(ctx, -0.37, -0.22, 0.74, 0.52, 0.05);
      ctx.fillStyle = BOIS.moyen;
      ctx.fill();
      trait(ctx, BOIS.bord, 0.025);
      ctx.fillStyle = "#1e140c";
      ctx.fillRect(-0.3, -0.15, 0.6, 0.38);
      for (let k = 0; k < 11; k++) {
        const x = -0.22 + (k % 4) * 0.14 + (Math.floor(k / 4) % 2) * 0.06;
        const y = -0.08 + Math.floor(k / 4) * 0.1;
        rond(ctx, x, y, 0.06);
        ctx.fillStyle = degrade(ctx, x, y, 0.06, "#fff0a0", "#a07818");
        ctx.fill();
        trait(ctx, "#6a4a10", 0.012);
      }
      for (const [x, y, c] of [[-0.1, 0.02, "#c0283a"], [0.14, -0.04, "#2a7ac0"]]) {
        rond(ctx, x, y, 0.04);
        ctx.fillStyle = c;
        ctx.fill();
      }
      for (const x of [-0.24, 0.2]) {
        ctx.fillStyle = "#4a4a46";
        ctx.fillRect(x, -0.24, 0.05, 0.06);
      }
    },
    sacs(ctx) {
      for (const [x, y, s, a] of [[-0.14, 0.1, 1.05, 0.3], [0.16, -0.12, 0.92, -0.4], [0.16, 0.24, 0.72, 0.9]]) ailleurs(ctx, x, y, s, a, () => O.sac(ctx));
    },
    caisses(ctx, hw, hh) {
      const s = Math.min(hw, hh);
      ailleurs(ctx, -hw * 0.48, hh * 0.46, s * 1.04, 0.04, () => M.caisse(ctx));
      ailleurs(ctx, hw * 0.46, hh * 0.44, s, -0.05, () => M.caisse(ctx));
      ailleurs(ctx, hw * 0.44, -hh * 0.48, s, 0.08, () => M.caisse(ctx));
      ctx.fillStyle = "rgba(8,5,2,.42)";
      ctx.fillRect(-hw * 0.05 - s * 0.38 + 0.05, -hh * 0.05 - s * 0.38 + 0.07, s * 0.8, s * 0.8);
      ailleurs(ctx, -hw * 0.05, -hh * 0.05, s * 1.06, 0.22, () => M.caisse(ctx));
    },

    // ---------------------------------------------------------------- passages
    colimacon(ctx, hw, hh) {
      const r = Math.min(hw, hh) - 0.06;
      rond(ctx, 0, 0, r);
      ctx.fillStyle = "#2e1e12";
      ctx.fill();
      for (let k = 0; k < 14; k++) {
        const a0 = (k / 14) * Math.PI * 2 - Math.PI / 2;
        const a1 = ((k + 0.92) / 14) * Math.PI * 2 - Math.PI / 2;
        const clair = 1.15 - 0.6 * (k / 14);
        const c = [168, 118, 70].map((v) => Math.min(255, Math.round(v * clair)));
        ctx.beginPath();
        ctx.arc(0, 0, r - 0.05, a0, a1);
        ctx.arc(0, 0, 0.16, a1, a0, true);
        ctx.closePath();
        ctx.fillStyle = `rgb(${c})`;
        ctx.fill();
        ctx.strokeStyle = "rgba(255,230,190,.25)";
        ctx.lineWidth = 0.015;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a0) * 0.16, Math.sin(a0) * 0.16);
        ctx.lineTo(Math.cos(a0) * (r - 0.05), Math.sin(a0) * (r - 0.05));
        ctx.stroke();
      }
      rond(ctx, 0, 0, r);
      trait(ctx, BOIS.bord, 0.04);
      rond(ctx, 0, 0, 0.16);
      ctx.fillStyle = degrade(ctx, 0, 0, 0.16, BOIS.clair, BOIS.noir);
      ctx.fill();
      trait(ctx, BOIS.bord, 0.02);
      // La flèche de la montée, discrète.
      const a = -Math.PI / 2 + 0.25;
      const [x, y] = [Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62];
      poly(ctx, [[x + 0.12, y], [x - 0.06, y - 0.1], [x - 0.06, y + 0.1]]);
      ctx.fillStyle = "rgba(250,236,206,.7)";
      ctx.fill();
    },
  };
}
