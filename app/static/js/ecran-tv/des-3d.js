// Les dés en 3D d'un jet (lot du 12/11) : sur l'écran de la table et sur la page Table du coin des joueurs, les dés roulent
// une seconde et demie puis s'arrêtent sur le résultat venu du serveur ; le bandeau du jet (jet-tv.js) paraît ensuite. Rien
// ne se tire ici : le module ne fait que montrer le dé et le total que porte le message ({"type": "jet"} ou {"type": "des"}).
//
// Faits maison, sans bibliothèque : de vrais polyèdres (tétraèdre, cube, octaèdre, trapézoèdre pentagonal du D10,
// dodécaèdre, icosaèdre) projetés sur un canvas, faces éclairées à plat, chiffres posés dans le plan de chaque face. Un
// test : deux D10, les dizaines (« 00 » à « 90 ») à la couleur du héros, les unités en ivoire. Un D100 libre : deux D10
// aussi. « Mouvements réduits » demandé par le système : aucun dé, le bandeau paraît tout de suite.
//
// Importé par table.js, donc transpilé pour l'écran de la table : rien au-delà d'ES2019 ici. La géométrie (polyedre,
// orientation, desDuMessage) ne touche pas à la page : outils/verifier_des3d.mjs la contrôle.

const PHI = (1 + Math.sqrt(5)) / 2;
const DUREE = 1500; // millisecondes : le roulement, jusqu'à l'arrêt sur le résultat
const DECALAGE = 70; // entre deux dés qui partent
const TENUE = 2600; // les dés restent posés, puis s'effacent
const FONDU = 450;
const ENTRE = 800; // entre l'arrêt d'un lancer et le départ du suivant
const FACES = [4, 6, 8, 10, 12, 20, 100];
const DES_MAX = 10; // cinq D100 font dix D10
const COULEUR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const IVOIRE = "#efe3c6";
const SANG = "#8e1b17";
const LUMIERE = unitaire([-0.45, 0.7, 0.62]);
const POLICE = 32; // les chiffres s'écrivent à 32 px puis se réduisent : une petite police agrandie perd des lettres

// ---------------------------------------------------------------- vecteurs

function produit(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function croix(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function moins(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function fois(a, k) {
  return [a[0] * k, a[1] * k, a[2] * k];
}

function longueur(a) {
  return Math.sqrt(produit(a, a));
}

function unitaire(a) {
  const l = longueur(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

// Une matrice 3 × 3 par ses trois lignes ; appliquer(m, v) = m · v.
function appliquer(m, v) {
  return [produit(m[0], v), produit(m[1], v), produit(m[2], v)];
}

function composer(a, b) {
  const colonnes = [0, 1, 2].map((j) => appliquer(a, [b[0][j], b[1][j], b[2][j]]));
  return [0, 1, 2].map((i) => [colonnes[0][i], colonnes[1][i], colonnes[2][i]]);
}

// La rotation d'un angle autour d'un axe unitaire (formule de Rodrigues).
function rotation(axe, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const x = axe[0];
  const y = axe[1];
  const z = axe[2];
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

// ---------------------------------------------------------------- les polyèdres

function signes(v) {
  // Toutes les combinaisons de signes des composantes non nulles.
  let liste = [[]];
  v.forEach((x) => {
    const suite = [];
    liste.forEach((debut) => {
      suite.push(debut.concat([x]));
      if (x !== 0) suite.push(debut.concat([-x]));
    });
    liste = suite;
  });
  return liste;
}

function permutationsPaires(v) {
  return [[v[0], v[1], v[2]], [v[1], v[2], v[0]], [v[2], v[0], v[1]]];
}

function tous(modeles) {
  const sortie = [];
  modeles.forEach((m) => permutationsPaires(m).forEach((p) => signes(p).forEach((s) => sortie.push(s))));
  return sortie;
}

const CUBE = signes([1, 1, 1]);
const AXES = tous([[1, 0, 0]]);
const ICOSAEDRE = tous([[0, 1, PHI]]);
const DODECAEDRE = CUBE.concat(tous([[0, 1 / PHI, PHI]]));
// Leurs duaux, tournés comme il faut : les normales des faces de l'un sont les sommets de l'autre.
const FACES_DODECAEDRE = tous([[0, PHI, 1]]);
const FACES_ICOSAEDRE = CUBE.concat(tous([[0, PHI, 1 / PHI]]));
const TETRAEDRE = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];

// Le D10 : deux pôles et dix sommets en couronne, tour à tour un peu au-dessus et un peu au-dessous de l'équateur ; à
// cette hauteur exacte (1 - cos 36°) / (1 + cos 36°), ses dix faces en cerf-volant sont planes.
function trapezoedre() {
  const pole = 1.02;
  const c = Math.cos(Math.PI / 5);
  const b = (pole * (1 - c)) / (1 + c);
  const sommets = [[0, 0, pole], [0, 0, -pole]];
  for (let k = 0; k < 10; k++) {
    const a = (k * Math.PI) / 5;
    sommets.push([Math.cos(a), Math.sin(a), k % 2 ? -b : b]);
  }
  const normales = [];
  for (let k = 0; k < 10; k++) {
    // La face du haut entre deux sommets hauts de la couronne, puis celle du bas, tour à tour : le pôle et ses deux voisins.
    const haut = k % 2 === 0;
    const p = sommets[haut ? 0 : 1];
    const u = sommets[2 + k];
    const v = sommets[2 + ((k + 2) % 10)];
    let n = unitaire(croix(moins(u, p), moins(v, p)));
    if (produit(n, p) < 0) n = fois(n, -1);
    normales.push(n);
  }
  return { sommets, normales };
}

// Le polyèdre construit de ses sommets et des normales de ses faces : chaque face réunit les sommets les plus avancés
// le long de sa normale, rangés en tournant autour d'elle. haut : la direction du haut du chiffre, dans le plan de la face.
function construire(sommets, normales, milieuArete) {
  const rayon = Math.max.apply(null, sommets.map(longueur));
  const points = sommets.map((v) => fois(v, 1 / rayon));
  const faces = normales.map((n0) => {
    const n = unitaire(n0);
    const avancees = points.map((v) => produit(v, n));
    const max = Math.max.apply(null, avancees);
    const indices = [];
    avancees.forEach((x, i) => {
      if (x > max - 1e-6) indices.push(i);
    });
    const centre = fois(indices.reduce((s, i) => [s[0] + points[i][0], s[1] + points[i][1], s[2] + points[i][2]], [0, 0, 0]), 1 / indices.length);
    const e1 = unitaire(moins(points[indices[0]], centre));
    const e2 = croix(n, e1);
    const angle = (i) => Math.atan2(produit(moins(points[i], centre), e2), produit(moins(points[i], centre), e1));
    const premier = indices[0];
    indices.sort((a, b) => angle(a) - angle(b));
    // Le plus petit écart du centre à une arête : la place du chiffre.
    let place = Infinity;
    indices.forEach((i, k) => {
      const a = points[i];
      const b = points[indices[(k + 1) % indices.length]];
      const arete = unitaire(moins(b, a));
      const vers = moins(centre, a);
      place = Math.min(place, longueur(moins(vers, fois(arete, produit(vers, arete)))));
    });
    let vise = points[premier];
    if (milieuArete) {
      const k = indices.indexOf(premier);
      vise = fois([0, 1, 2].map((j) => points[premier][j] + points[indices[(k + 1) % indices.length]][j]), 0.5);
    }
    const haut = unitaire(moins(vise, centre));
    return { indices, normale: n, centre, haut, droite: croix(haut, n), place };
  });
  return { sommets: points, faces };
}

const POLYEDRES = {};

// Le polyèdre d'un dé à 4, 6, 8, 10, 12 ou 20 faces : { sommets, faces: [{ indices, normale, centre, haut, droite, place }] }.
// La face de rang i porte le nombre i + 1 (ou le chiffre i pour un D10 de test).
export function polyedre(faces) {
  if (POLYEDRES[faces]) return POLYEDRES[faces];
  let p = null;
  if (faces === 4) p = construire(TETRAEDRE, TETRAEDRE.map((v) => fois(v, -1)));
  else if (faces === 6) p = construire(CUBE, AXES, true);
  else if (faces === 8) p = construire(AXES, CUBE);
  else if (faces === 10) {
    const t = trapezoedre();
    p = construire(t.sommets, t.normales);
  } else if (faces === 12) p = construire(DODECAEDRE, FACES_DODECAEDRE);
  else if (faces === 20) p = construire(ICOSAEDRE, FACES_ICOSAEDRE);
  else return null;
  POLYEDRES[faces] = p;
  return p;
}

// La rotation qui pose la face de rang i face au regard, son chiffre à l'endroit.
export function orientation(poly, i) {
  const f = poly.faces[i];
  return [f.droite, f.haut, f.normale];
}

// ---------------------------------------------------------------- du message aux dés

function entier(v, bas, haut) {
  return typeof v === "number" && Math.floor(v) === v && v >= bas && v <= haut;
}

function deuxD10(valeur, couleur) {
  // 100 se lit « 00 » et « 0 ».
  const v = valeur % 100;
  const dizaines = [];
  const unites = [];
  for (let k = 0; k < 10; k++) {
    dizaines.push(`${k}0`);
    unites.push(String(k));
  }
  return [{ faces: 10, face: Math.floor(v / 10), etiquettes: dizaines, couleur }, { faces: 10, face: v % 10, etiquettes: unites, couleur: IVOIRE }];
}

// Les dés à montrer pour un message de jet : [{ faces, face (le rang de la face du résultat), etiquettes, couleur }], ou
// une liste vide si le message ne se lit pas (le bandeau paraît alors seul).
export function desDuMessage(msg) {
  if (!msg || typeof msg !== "object") return [];
  const couleur = COULEUR.test(msg.couleur || "") ? msg.couleur : SANG;
  if (msg.type === "jet") return entier(msg.de, 1, 100) ? deuxD10(msg.de, couleur) : [];
  if (msg.type !== "des" || FACES.indexOf(msg.faces) < 0 || !Array.isArray(msg.des) || !msg.des.length || msg.des.length > 5) return [];
  if (!msg.des.every((x) => entier(x, 1, msg.faces))) return [];
  let des = [];
  msg.des.forEach((x) => {
    if (msg.faces === 100) des = des.concat(deuxD10(x, couleur));
    else {
      const etiquettes = [];
      for (let k = 1; k <= msg.faces; k++) etiquettes.push(String(k));
      des.push({ faces: msg.faces, face: x - 1, etiquettes, couleur });
    }
  });
  return des.slice(0, DES_MAX);
}

// ---------------------------------------------------------------- les couleurs

function rvb(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function clair(c) {
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255 > 0.6;
}

function teinte(c, lumiere) {
  // Sous 1, vers l'ombre ; au-dessus, vers le blanc.
  const k = Math.max(0, lumiere);
  const v = c.map((x) => (k <= 1 ? x * k : x + (255 - x) * Math.min(1, k - 1)));
  return `rgb(${Math.round(v[0])},${Math.round(v[1])},${Math.round(v[2])})`;
}

// ---------------------------------------------------------------- la scène

export function mouvementsReduits() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// parent : là où poser le canvas (le corps de la page par défaut). Rend { lancer(msg), effacer() }.
// lancer(msg) rend une promesse tenue quand les dés sont arrêtés sur leur résultat (tout de suite sans animation).
export function creerDes3d(parent) {
  const canvas = document.createElement("canvas");
  canvas.className = "des-3d";
  canvas.setAttribute("aria-hidden", "true");
  canvas.hidden = true;
  (parent || document.body).appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let des = [];
  let debut = 0;
  let image = 0;
  let fin = 0; // la minuterie qui efface les dés posés
  let file = Promise.resolve();
  let largeur = 0;
  let hauteur = 0;

  function mesurer() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    largeur = canvas.clientWidth || window.innerWidth;
    hauteur = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(largeur * dpr);
    canvas.height = Math.round(hauteur * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return dpr;
  }

  function placer(liste) {
    const n = liste.length;
    const colonnes = n <= 5 ? n : Math.ceil(n / 2);
    const lignes = n <= 5 ? 1 : 2;
    const rayon = Math.max(26, Math.min(largeur * 0.92 / (colonnes * 2.5), hauteur * 0.6 / (lignes * 2.6), 130));
    const pas = rayon * 2.5;
    liste.forEach((d, i) => {
      const ligne = Math.floor(i / colonnes);
      const dans = ligne === lignes - 1 ? n - ligne * colonnes : colonnes;
      const col = i - ligne * colonnes;
      d.rayon = rayon;
      d.x = largeur / 2 + (col - (dans - 1) / 2) * pas;
      d.y = hauteur * 0.5 + (ligne - (lignes - 1) / 2) * rayon * 2.6;
      // D'où il arrive : du bas de l'écran, d'un côté ou de l'autre.
      const cote = Math.random() < 0.5 ? -1 : 1;
      d.x0 = d.x + cote * (largeur * 0.3 + Math.random() * largeur * 0.2);
      d.y0 = hauteur + rayon * 2;
      d.axe = unitaire([Math.random() - 0.5, Math.random() - 0.5, (Math.random() - 0.5) * 0.6]);
      d.tours = (2.4 + Math.random() * 1.4) * 2 * Math.PI * (Math.random() < 0.5 ? -1 : 1);
      d.depart = i * DECALAGE;
      d.poly = polyedre(d.faces);
      d.pose = composer(composer(rotation([1, 0, 0], -0.3), rotation([0, 1, 0], cote * 0.24)), orientation(d.poly, d.face));
      d.rvb = rvb(d.couleur);
    });
    return liste;
  }

  function dessinerDe(d, p, eclat) {
    const e = 1 - Math.pow(1 - p, 3);
    const m = composer(rotation(d.axe, d.tours * Math.pow(1 - p, 2.2)), d.pose);
    const rebond = Math.abs(Math.sin(p * Math.PI * 2.5)) * Math.pow(1 - p, 1.5) * d.rayon * 1.1;
    const r = d.rayon * (1 + 0.14 * (1 - p));
    const cx = d.x0 + (d.x - d.x0) * e;
    const sol = d.y0 + (d.y - d.y0) * e;
    const cy = sol - rebond;
    // L'ombre au sol, plus petite quand le dé est en l'air.
    const ombre = ctx.createRadialGradient(cx, sol + r * 0.95, 0, cx, sol + r * 0.95, r * 1.1);
    ombre.addColorStop(0, `rgba(0,0,0,${0.5 - 0.25 * Math.min(1, rebond / d.rayon)})`);
    ombre.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.translate(cx, sol + r * 0.95);
    ctx.scale(1, 0.3);
    ctx.translate(-cx, -(sol + r * 0.95));
    ctx.fillStyle = ombre;
    ctx.beginPath();
    ctx.arc(cx, sol + r * 0.95, r * 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const points = d.poly.sommets.map((v) => appliquer(m, v));
    const encre = clair(d.rvb) ? "#1b120b" : "#fff6e0";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1, r * 0.035);
    d.poly.faces.forEach((f, i) => {
      const n = appliquer(m, f.normale);
      if (n[2] <= 0.02) return;
      const resultat = i === d.face;
      ctx.beginPath();
      f.indices.forEach((k, j) => {
        const x = cx + points[k][0] * r;
        const y = cy - points[k][1] * r;
        if (j) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.closePath();
      const lumiere = 0.42 + 0.62 * Math.max(0, produit(n, LUMIERE)) + (resultat ? eclat * 0.45 : 0);
      ctx.fillStyle = teinte(d.rvb, lumiere);
      ctx.fill();
      ctx.strokeStyle = resultat && eclat > 0 ? `rgba(255,236,176,${0.5 + 0.5 * eclat})` : "rgba(0,0,0,.45)";
      ctx.stroke();
      // Le chiffre, dans le plan de la face : la projection est droite, une simple transformation affine le pose.
      const texte = d.etiquettes[i];
      const droite = appliquer(m, f.droite);
      const haut = appliquer(m, f.haut);
      const centre = appliquer(m, f.centre);
      const taille = f.place * r * (texte.length > 1 ? 0.95 : 1.25);
      const k = taille / POLICE;
      ctx.save();
      ctx.transform(droite[0] * k, -droite[1] * k, -haut[0] * k, haut[1] * k, cx + centre[0] * r, cy - centre[1] * r);
      ctx.font = `700 ${POLICE}px "EB Garamond", Georgia, serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = encre;
      ctx.globalAlpha = 0.35 + 0.65 * Math.min(1, n[2] * 1.6);
      ctx.fillText(texte, 0, POLICE * 0.06);
      // 6 et 9 se soulignent, comme sur un vrai dé.
      if (texte === "6" || texte === "9") ctx.fillRect(-POLICE * 0.24, POLICE * 0.46, POLICE * 0.48, POLICE * 0.07);
      ctx.restore();
    });
  }

  function peindre(maintenant) {
    const t = maintenant - debut;
    const total = DUREE + TENUE + FONDU;
    ctx.clearRect(0, 0, largeur, hauteur);
    if (!des.length || t >= total) {
      canvas.hidden = true;
      des = [];
      image = 0;
      return;
    }
    const opacite = t > DUREE + TENUE ? 1 - (t - DUREE - TENUE) / FONDU : Math.min(1, t / 180);
    ctx.globalAlpha = opacite;
    // Un tapis sombre sous les dés : ils se lisent sur un plan clair comme sur un plan sombre.
    const rayon = des[0].rayon;
    const gauche = Math.min.apply(null, des.map((d) => d.x)) - rayon * 1.7;
    const droite = Math.max.apply(null, des.map((d) => d.x)) + rayon * 1.7;
    const haut = Math.min.apply(null, des.map((d) => d.y)) - rayon * 1.7;
    const bas = Math.max.apply(null, des.map((d) => d.y)) + rayon * 1.8;
    const tapis = ctx.createRadialGradient((gauche + droite) / 2, (haut + bas) / 2, 0, (gauche + droite) / 2, (haut + bas) / 2, Math.max(droite - gauche, bas - haut) * 0.62);
    tapis.addColorStop(0, "rgba(12,8,6,.72)");
    tapis.addColorStop(0.7, "rgba(12,8,6,.5)");
    tapis.addColorStop(1, "rgba(12,8,6,0)");
    ctx.fillStyle = tapis;
    ctx.fillRect(0, 0, largeur, hauteur);
    des.forEach((d) => {
      const p = Math.max(0, Math.min(1, (t - d.depart) / (DUREE - d.depart)));
      if (t < d.depart) return;
      // À l'arrêt, la face du résultat s'éclaire un instant.
      const depuis = t - DUREE;
      const eclat = depuis > 0 ? Math.max(0, 1 - depuis / 700) : 0;
      ctx.globalAlpha = opacite;
      dessinerDe(d, p, eclat);
    });
    ctx.globalAlpha = 1;
    image = requestAnimationFrame(peindre);
  }

  function effacer() {
    cancelAnimationFrame(image);
    clearTimeout(fin);
    image = 0;
    des = [];
    canvas.hidden = true;
  }

  function rouler(liste) {
    return new Promise((tenue) => {
      effacer();
      canvas.hidden = false;
      mesurer();
      des = placer(liste);
      debut = performance.now();
      image = requestAnimationFrame(peindre);
      setTimeout(tenue, DUREE);
    });
  }

  function lancer(msg) {
    const liste = desDuMessage(msg);
    if (!liste.length || mouvementsReduits() || !ctx || document.visibilityState === "hidden") return file;
    // Un jet arrivé pendant qu'un autre roule attend son arrêt, et un instant de plus (le résultat d'avant reste lisible) :
    // jamais deux lancers mêlés.
    const arret = file.then(() => rouler(liste)).catch(() => {});
    file = arret.then(() => new Promise((suite) => setTimeout(suite, ENTRE)));
    return arret;
  }

  window.addEventListener("resize", () => {
    if (!des.length) return;
    mesurer();
    const p = performance.now() - debut;
    placer(des);
    debut = performance.now() - Math.max(p, DUREE); // l'écran a tourné : les dés restent posés, à leur nouvelle place
  });

  return { lancer, effacer };
}
