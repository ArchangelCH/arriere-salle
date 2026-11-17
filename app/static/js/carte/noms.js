// Les noms des lieux ne se posent pas sur les noms de régions, de mers ni sur un autre nom : avant de dessiner, on cherche
// pour chaque nom posé « automatiquement » (le MJ n'en a pas fixé la place) une position voisine qui ne chevauche rien :
// d'abord celle par défaut, puis au-dessus, au-dessous, de l'autre côté de l'icône. Un nom que le MJ a placé à la main
// (nx, ny) garde sa place et sert d'obstacle aux autres. Le calcul porte sur toute la carte, pas sur la zone vue : les noms
// ne bougent pas quand on déplace la caméra. Résultat : une Map marqueur -> { dx, dy }, à ajouter à la place par défaut.

import { STYLES_TEXTE, largeurTexte, positionNom, styleNomLieu } from "./rendu.js";

let ctxMesure = null;
const mesure = () => {
  if (!ctxMesure) ctxMesure = document.createElement("canvas").getContext("2d");
  return ctxMesure;
};

const memoire = new Map();

// Le rectangle d'un texte (droit ou en arc), un peu élargi : les halos et l'approximation des largeurs.
function boiteEtiquette(ctx, e, min) {
  const st = STYLES_TEXTE[e.style] || STYLES_TEXTE.region;
  const chaine = st.majuscules ? (e.texte || "").toLocaleUpperCase("fr") : e.texte || "";
  if (!chaine) return null;
  const taille = Math.max(e.taille || st.taille, min);
  const esp = e.espacement ?? st.espacement;
  const L = largeurTexte(ctx, chaine, taille, st.police, esp) * 1.04;
  const h = taille * 1.05;
  const courbure = e.courbure || 0;
  const angle = e.angle || 0;
  if (Math.abs(courbure) < 0.01 && !angle) return { x0: e.x - L / 2, x1: e.x + L / 2, y0: e.y - h / 2, y1: e.y + h / 2 };
  // En arc ou penché : l'enveloppe des points de la ligne de base.
  const R = Math.abs(courbure) < 0.01 ? Infinity : L / courbure;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i <= 12; i++) {
    const s = (i / 12 - 0.5) * L;
    const a = R === Infinity ? 0 : s / R;
    const px = R === Infinity ? s : R * Math.sin(a);
    const py = R === Infinity ? 0 : R - R * Math.cos(a);
    const x = e.x + px * Math.cos(angle) - py * Math.sin(angle);
    const y = e.y + px * Math.sin(angle) + py * Math.cos(angle);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return { x0: x0 - h / 2, x1: x1 + h / 2, y0: y0 - h / 2, y1: y1 + h / 2 };
}

function recouvrement(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

// options : joueurs, champs (connuA), k, min, lieuxPublics : les mêmes que pour le dessin, pour ne tenir compte que de
// ce qui s'affiche.
export function decalagesDesNoms(carte, lieux, { joueurs = false, champs = null, k = 1, min = 0, lieuxPublics = false, peint = false } = {}) {
  const marqueurs = (carte.marqueurs || []).filter((m) => {
    const lieu = lieux[m.lieu];
    if (!joueurs) return true;
    if (m.cache || (champs && !champs.connuA(m.x, m.y))) return false;
    if (peint && !lieu) return false;
    return !(lieu && !lieu.connu && !lieuxPublics);
  });
  const etiquettes = (carte.etiquettes || []).filter((e) => !(joueurs && (e.cache || (champs && !champs.connuA(e.x, e.y)))));
  const cle = [
    joueurs, k, min, peint,
    etiquettes.map((e) => `${e.x},${e.y},${e.texte},${e.taille},${e.courbure},${e.angle},${e.style}`).join(";"),
    marqueurs.map((m) => `${m.x},${m.y},${m.taille},${m.nx},${m.ny},${m.nom_gauche},${m.sans_nom},${m.taille_nom},${lieux[m.lieu]?.nom || m.nom}`).join(";"),
  ].join("|");
  const connu = memoire.get(cle);
  if (connu) return connu;

  const ctx = mesure();
  const obstacles = [];
  for (const e of etiquettes) {
    const b = boiteEtiquette(ctx, e, min);
    if (b) obstacles.push(b);
  }
  const resultat = new Map();
  const automatiques = [];
  for (const m of [...marqueurs].sort((a, b) => a.y - b.y)) {
    const lieu = lieux[m.lieu];
    const nom = lieu?.nom || m.nom;
    if (!nom || m.sans_nom) continue;
    const type = lieu?.type || m.type || "point";
    const st = styleNomLieu(type);
    const taille = Math.max(st.taille * k * (m.taille_nom || 1), min);
    const L = largeurTexte(ctx, nom, taille, st.police, st.espacement) * 1.04;
    const s = m.taille || 1.6;
    const p = positionNom(m);
    if (m.nom_gauche && m.nx === undefined) p.x = m.x - s * 0.62 - L;
    const h = taille * 1.05;
    const boite = (x, y) => ({ x0: x, x1: x + L, y0: y - h / 2, y1: y + h / 2 });
    if (m.nx !== undefined || m.ny !== undefined) {
      obstacles.push(boite(p.x, p.y));
      continue;
    }
    automatiques.push({ m, p, L, h, s, boite });
  }
  for (const { m, p, L, h, s, boite } of automatiques) {
    // Les icônes des autres lieux comptent aussi : un nom ne se pose pas sur leur dessin.
    const candidats = [[0, 0], [0, -h], [0, h], [-(s * 1.24 + L), 0], [-(s * 1.24 + L), -h], [-(s * 1.24 + L), h], [0, -2 * h], [0, 2 * h]];
    let meilleur = null;
    for (const [dx, dy] of candidats) {
      const b = boite(p.x + dx, p.y + dy);
      let gene = 0;
      for (const o of obstacles) gene += recouvrement(b, o);
      if (!meilleur || gene < meilleur.gene - 1e-6) meilleur = { dx, dy, gene, b };
      if (gene === 0) break;
    }
    obstacles.push(meilleur.b);
    if (meilleur.dx || meilleur.dy) resultat.set(m, { dx: meilleur.dx, dy: meilleur.dy });
  }
  if (memoire.size > 40) memoire.clear();
  memoire.set(cle, resultat);
  return resultat;
}
