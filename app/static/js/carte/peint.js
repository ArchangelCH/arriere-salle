// Rendu « relief peint » d'une carte : une altitude tirée du terrain, un ombrage doux venu du nord-ouest, des couleurs
// naturelles, des eaux en dégradé de profondeur, des forêts vues de dessus et des champs autour des lieux habités.
// Le raster (couleur, ombre, lumière) se calcule par zone dans des Web Workers (MoteurPeint) ; tout ce qui se pose
// dessus (parcelles, houppiers, eaux, voies, habillage) se calcule à la demande, par paquets, et se peint ici (FondPeint).
// Rien n'est global à la carte : un coup de pinceau ou un lieu révélé ne recalcule que sa zone.

import { B } from "./biomes.js";
import { Champs, SOUS } from "./champs.js";
import { chaikin, clamp, hacher } from "./geo.js";
import { calculerRaster, majChampsZone, preparerChamps } from "./peint-calcul.js";
import { habillageVu, preparerHabillage } from "./peint-habillage.js";

const SEAU = 8; // paquets d'arbres, en cases
const TOUT = { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 };
const croise = (a, b) => a.x1 > b.x0 && a.x0 < b.x1 && a.y1 > b.y0 && a.y0 < b.y1;
const elargir = (z, m) => ({ x0: z.x0 - m, y0: z.y0 - m, x1: z.x1 + m, y1: z.y1 + m });
const union = (a, b) => (a ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : b);

export function boitePoints(points, marge = 0) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  }
  return { x0: x0 - marge, y0: y0 - marge, x1: x1 + marge, y1: y1 + marge };
}

// Zones qui se chevauchent réunies en une seule.
export function fusionnerZones(zones) {
  const res = [];
  for (const z of zones) {
    let cur = { ...z };
    for (let i = res.length - 1; i >= 0; i--) {
      if (croise(elargir(res[i], 0.5), cur)) {
        cur = union(cur, res[i]);
        res.splice(i, 1);
      }
    }
    res.push(cur);
  }
  return res.length === zones.length ? res : fusionnerZones(res);
}

function toile(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

// ---------------------------------------------------------------- le moteur : rasters dans les workers

const EN_COURS_MAX = 2; // demandes confiées à la fois à chaque worker
const TRANCHE_REPLI = 24000; // pixels calculés d'un coup sur le fil principal, faute de worker

export class MoteurPeint {
  // options.worker : { url, module } (par défaut le module de l'atelier) ; options.travailleurs : nombre de workers.
  constructor(champs, options = {}) {
    this.options = options;
    this.travailleurs = [];
    this.file = [];
    this.numero = 0;
    this.version = 0;
    this.journal = [];
    this.charger(champs);
  }

  charger(champs) {
    this.champs = champs;
    const carte = champs.carte;
    this.terrain = carte.terrain.slice();
    this.distEau = champs.distEau;
    const dims = { w: champs.w, h: champs.h, W: champs.W, H: champs.H };
    this.f = preparerChamps({ ...dims, terrain: this.terrain, biomeSous: champs.biomeSous });
    this.d = { ...dims, graine: carte.graine | 0, Z: 2.6, terrain: this.terrain, distEau: this.distEau, ...this.f, bruit: champs.bruit.bruit };
    this.version++;
    this.journal = [{ version: this.version, zone: TOUT }];
    this.zoneRecente = null;
    for (const t of this.travailleurs) this.envoyerCarte(t);
  }

  detruire() {
    this.detruit = true;
    for (const t of this.travailleurs) t.w.terminate();
    this.travailleurs = [];
    for (const r of this.file) r.ok(null);
    this.file = [];
    clearTimeout(this.minuterieRepli);
  }

  ouvriers() {
    if (this.travailleurs.length || this.sansTravailleur || typeof Worker === "undefined") return this.travailleurs;
    const def = this.options.worker || { url: "/static/js/carte/peint-worker.js", module: true };
    const n = this.options.travailleurs || Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    try {
      for (let i = 0; i < n; i++) {
        const w = def.module ? new Worker(def.url, { type: "module" }) : new Worker(def.url);
        const t = { w, enCours: new Map(), mort: false };
        w.onmessage = (ev) => this.reponse(t, ev.data);
        w.onerror = (ev) => {
          if (ev && ev.preventDefault) ev.preventDefault();
          this.panne(t);
        };
        this.travailleurs.push(t);
        this.envoyerCarte(t);
      }
    } catch {
      this.sansTravailleur = true;
    }
    return this.travailleurs;
  }

  envoyerCarte(t) {
    const { bruit, ...donnees } = this.d;
    t.w.postMessage({ genre: "carte", donnees });
  }

  // Un worker qui échoue est écarté : ses demandes passent aux autres, ou au fil principal s'il n'en reste aucun.
  panne(t) {
    if (t.mort) return;
    t.mort = true;
    try {
      t.w.terminate();
    } catch {
      // déjà arrêté
    }
    this.file.unshift(...t.enCours.values());
    t.enCours.clear();
    if (!this.travailleurs.some((x) => !x.mort)) this.sansTravailleur = true;
    this.distribuer();
  }

  // Le terrain de la carte a changé (pinceau) : les champs se recalculent autour, les workers suivent.
  // Renvoie la zone (en cases) où le raster n'est plus le même, ou null.
  synchroniser() {
    const t = this.champs.carte.terrain;
    const { w, h } = this.d;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) {
        if (t[o + x] !== this.terrain[o + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          y1 = y;
        }
      }
    }
    let zone = null;
    if (x1 >= 0) {
      for (let y = y0; y <= y1; y++) this.terrain.set(t.subarray(y * w + x0, y * w + x1 + 1), y * w + x0);
      const morceaux = majChampsZone({ ...this.d, biomeSous: this.champs.biomeSous }, this.f, x0, y0, x1 + 1, y1 + 1);
      this.envoyerMorceaux(morceaux);
      zone = { x0: x0 - 9, y0: y0 - 9, x1: x1 + 10, y1: y1 + 10 };
      this.zoneRecente = union(this.zoneRecente, zone);
    }
    // Côtes recalculées (fin d'un trait qui touche l'eau) : la profondeur des eaux change autour du trait.
    if (this.champs.distEau !== this.distEau) {
      this.distEau = this.d.distEau = this.champs.distEau;
      this.envoyerMorceaux([{ nom: "distEau", data: this.distEau }]);
      zone = union(zone, this.zoneRecente ? elargir(this.zoneRecente, 9) : { x0: 0, y0: 0, x1: w, y1: h });
      this.zoneRecente = null;
    }
    if (!zone) return null;
    this.version++;
    this.journal.push({ version: this.version, zone });
    return zone;
  }

  envoyerMorceaux(morceaux) {
    for (const t of this.travailleurs) if (!t.mort) t.w.postMessage({ genre: "morceaux", morceaux });
  }

  // Le raster d'une zone (en cases) à R pixels par case, aligné sur la grille des pixels de la carte entière.
  // o.priorite : plus petit d'abord ; o.vivant() : faux, la demande est abandonnée avant calcul (résultat null).
  raster(zone, R, o = {}) {
    const X0 = Math.floor(zone.x0 * R) / R;
    const Y0 = Math.floor(zone.y0 * R) / R;
    const wpx = Math.max(1, Math.ceil((zone.x1 - X0) * R - 1e-6));
    const hpx = Math.max(1, Math.ceil((zone.y1 - Y0) * R - 1e-6));
    return new Promise((ok) => {
      if (this.detruit) return ok(null);
      const req = { id: ++this.numero, X0, Y0, wpx, hpx, R, priorite: o.priorite || 0, vivant: o.vivant, ok, version: this.version };
      req.zone = { x0: X0, y0: Y0, x1: X0 + wpx / R, y1: Y0 + hpx / R };
      this.file.push(req);
      // Les demandes faites d'un même élan sont triées ensemble avant de partir.
      if (!this.distributionPrevue) {
        this.distributionPrevue = true;
        Promise.resolve().then(() => {
          this.distributionPrevue = false;
          this.distribuer();
        });
      }
    });
  }

  distribuer() {
    if (this.detruit) return;
    const actifs = this.ouvriers().filter((t) => !t.mort);
    if (!actifs.length) return this.replier();
    this.file.sort((a, b) => a.priorite - b.priorite);
    while (this.file.length) {
      let t = actifs[0];
      for (const x of actifs) if (x.enCours.size < t.enCours.size) t = x;
      if (t.enCours.size >= EN_COURS_MAX) break;
      const req = this.file.shift();
      if (req.vivant && !req.vivant()) {
        req.ok(null);
        continue;
      }
      req.version = this.version;
      t.enCours.set(req.id, req);
      t.w.postMessage({ genre: "raster", id: req.id, X0: req.X0, Y0: req.Y0, wpx: req.wpx, hpx: req.hpx, R: req.R });
    }
  }

  // Le terrain a changé dans la zone pendant le calcul : le résultat ne vaut plus rien.
  perime(req) {
    for (const j of this.journal) if (j.version > req.version && croise(j.zone, req.zone)) return true;
    return false;
  }

  reponse(t, m) {
    const req = t.enCours.get(m.id);
    if (!req) return;
    t.enCours.delete(m.id);
    if (m.erreur) {
      this.panne(t);
      this.file.unshift(req);
    } else if (this.perime(req)) {
      this.file.push(req);
    } else {
      this.livrer(req, m.couleur, m.ombre, m.lumiere);
    }
    this.elaguer();
    this.distribuer();
  }

  livrer(req, couleur, ombre, lumiere) {
    const { wpx, hpx, R } = req;
    req.ok({
      couleur: new ImageData(couleur, wpx, hpx), ombre: new ImageData(ombre, wpx, hpx), lumiere: new ImageData(lumiere, wpx, hpx),
      x0: req.X0, y0: req.Y0, l: wpx / R, h: hpx / R, R, wpx, hpx,
    });
  }

  elaguer() {
    let min = this.version;
    for (const t of this.travailleurs) for (const r of t.enCours.values()) min = Math.min(min, r.version);
    for (const r of this.file) min = Math.min(min, r.version);
    this.journal = this.journal.filter((j) => j.version > min);
  }

  // Sans worker : le calcul se fait ici, par bandes, pour que l'écran respire entre deux.
  replier() {
    if (this.minuterieRepli || this.detruit) return;
    this.minuterieRepli = setTimeout(() => {
      this.minuterieRepli = 0;
      this.file.sort((a, b) => a.priorite - b.priorite);
      const req = this.file[0];
      if (!req) return;
      if (req.vivant && !req.vivant()) {
        this.file.shift();
        req.ok(null);
        return this.replier();
      }
      if (!req.partiel || req.partiel.version !== this.version) {
        req.partiel = { version: this.version, y: 0, couleur: new Uint8ClampedArray(req.wpx * req.hpx * 4), ombre: new Uint8ClampedArray(req.wpx * req.hpx * 4), lumiere: new Uint8ClampedArray(req.wpx * req.hpx * 4) };
      }
      const p = req.partiel;
      const n = Math.max(4, Math.min(req.hpx - p.y, Math.floor(TRANCHE_REPLI / req.wpx)));
      const r = calculerRaster(this.d, req.X0, req.Y0 + p.y / req.R, req.wpx, n, req.R);
      const o = p.y * req.wpx * 4;
      p.couleur.set(r.couleur, o);
      p.ombre.set(r.ombre, o);
      p.lumiere.set(r.lumiere, o);
      p.y += n;
      if (p.y >= req.hpx) {
        this.file.shift();
        this.livrer(req, p.couleur, p.ombre, p.lumiere);
      }
      this.replier();
    }, 0);
  }
}

// Les trois calques d'un raster, posés dans des toiles (une seule série réutilisée pour les tuiles).
let calquesCommuns = null;
export function calquesDe(ras, garder) {
  let c = garder ? null : calquesCommuns;
  if (!c || c.couleur.width < ras.wpx || c.couleur.height < ras.hpx) {
    const l = garder ? ras.wpx : Math.max(ras.wpx, c ? c.couleur.width : 0);
    const h = garder ? ras.hpx : Math.max(ras.hpx, c ? c.couleur.height : 0);
    c = { couleur: toile(l, h), ombre: toile(l, h), lumiere: toile(l, h) };
    if (!garder) calquesCommuns = c;
  }
  c.couleur.getContext("2d").putImageData(ras.couleur, 0, 0);
  c.ombre.getContext("2d").putImageData(ras.ombre, 0, 0);
  c.lumiere.getContext("2d").putImageData(ras.lumiere, 0, 0);
  return { ...c, x0: ras.x0, y0: ras.y0, R: ras.R, wpx: ras.wpx, hpx: ras.hpx };
}

// ---------------------------------------------------------------- le fond d'une vue

// Rayon des champs autour d'un lieu habité, en cases (avant la mise à l'échelle des parcelles).
const RAYONS = { capitale: 6.5, cite: 5, ville: 4.2, port: 3.6, village: 3, comptoir: 2.2, auberge: 1.8 };
const PAS_QUARTIER = 15;
const NET = { pale: false };
const PALE = { pale: true };

// Ce que dessine une vue de la carte : celle du MJ (tout, les éléments cachés aux joueurs plus pâles), celle des
// joueurs (seulement ce qu'ils connaissent, comme la TV) ou une carte déjà publique (celle que reçoit la TV).
export class FondPeint {
  constructor(carte, champs, lieux, o = {}) {
    this.champs = champs;
    this.moteur = o.moteur;
    this.joueurs = !!o.joueurs;
    this.publiques = !!o.publiques;
    this.w = champs.w;
    this.h = champs.h;
    this.W = champs.W;
    this.H = champs.H;
    this.voies = new Uint8Array(this.W * this.H);
    this.seaux = new Map();
    this.groupes = new Map();
    this.connu = null;
    this.carte = carte;
    this.lieux = lieux || {};
    this.preparer();
  }

  changerCarte(carte, lieux) {
    this.carte = carte;
    this.lieux = lieux || {};
  }

  preparer() {
    const km = this.carte.km_case || 2;
    this.echelleVoies = km < 1 ? 1.8 : 1;
    this.tailleChamp = Math.min(2.2, Math.max(1.05, 0.5 / km));
    this.desc = null;
    this.connu = this.entrees();
    this.calculerVoies();
    this.seaux.clear();
    this.groupes.clear();
    this.preparerQuartiers();
  }

  get versEau() {
    return this.moteur.f.versEau;
  }

  typeLieu(m) {
    const lieu = this.lieux[m.lieu];
    return (lieu && lieu.type) || m.type || "point";
  }

  // Un lieu posé : null (la vue ne le montre pas), ou NET, ou PALE (le MJ seul le voit).
  vuMarqueur(m) {
    if (this.publiques) return NET;
    const lieu = this.lieux[m.lieu];
    if (!m.cache && lieu && lieu.connu && this.champs.connuA(m.x, m.y)) return NET;
    return this.joueurs ? null : PALE;
  }

  vuTrace(t) {
    return this.publiques || !this.joueurs || !t.cache;
  }

  // Ce que la vue dessine de la carte, élément par élément (texte JSON → élément) : de quoi trouver ce qui a changé.
  entrees() {
    const c = this.carte;
    const hab = c.habillage || {};
    const e = {
      fond: JSON.stringify([c.km_case, c.decor && c.decor.cadre, c.decor && c.decor.brume, hab.taille_parcelle_m || null]),
      traces: new Map(), marqueurs: new Map(), habillage: new Map(),
    };
    for (const t of c.traces || []) {
      if (!t.points || t.points.length < 2 || !this.vuTrace(t)) continue;
      e.traces.set(JSON.stringify([t.type, t.points, t.largeur || null]), t);
    }
    for (const m of c.marqueurs || []) {
      const vu = this.vuMarqueur(m);
      if (!vu) continue;
      const type = this.typeLieu(m);
      e.marqueurs.set(JSON.stringify([m.id || "", m.lieu || "", m.x, m.y, m.taille || 1, type, vu.pale]), { m, type, pale: vu.pale });
    }
    for (const x of habillageVu(hab, this)) e.habillage.set(x.cle, x);
    this.habillage = preparerHabillage([...e.habillage.values()], hab, this);
    return e;
  }

  // Ce qui a changé dans la carte depuis le dernier appel : arbres, parcelles et voies sont recalculés autour, et les
  // zones à repeindre sont renvoyées (en cases).
  synchroniser() {
    const avant = this.connu;
    const apres = this.entrees();
    this.connu = apres;
    this.desc = null;
    if (avant.fond !== apres.fond) {
      this.preparer();
      return [{ x0: 0, y0: 0, x1: this.w, y1: this.h }];
    }
    const zones = [];
    const ecarts = (a, b, boite) => {
      for (const [k, x] of a) if (!b.has(k)) zones.push(boite(x));
      for (const [k, x] of b) if (!a.has(k)) zones.push(boite(x));
    };
    ecarts(avant.traces, apres.traces, (t) => boitePoints(t.points, 1.5 + (t.largeur ? Math.max(...t.largeur) : 0.5)));
    ecarts(avant.marqueurs, apres.marqueurs, (x) => this.zoneMarqueur(x));
    ecarts(avant.habillage, apres.habillage, (x) => x.boite);
    if (!zones.length) return [];
    this.calculerVoies();
    return this.apresChangement(zones);
  }

  // Les zones où les éléments de la liste (indices dans la carte publique) se posent : ce qu'il faut repeindre sur un
  // fond fourni d'avance, plus ancien qu'eux. nouveaux : { traces: [i], marqueurs: [i], habillage: { genre: [i] } }.
  zonesDesNouveaux(nouveaux) {
    const zones = [];
    const c = this.carte;
    for (const i of (nouveaux && nouveaux.traces) || []) {
      const t = (c.traces || [])[i];
      if (t && t.points && t.points.length) zones.push(boitePoints(t.points, 1.5 + (t.largeur ? Math.max(...t.largeur) : 0.5)));
    }
    for (const i of (nouveaux && nouveaux.marqueurs) || []) {
      const m = (c.marqueurs || [])[i];
      if (m) zones.push(this.zoneMarqueur({ m, type: this.typeLieu(m) }));
    }
    const hab = (nouveaux && nouveaux.habillage) || {};
    for (const genre of Object.keys(hab)) {
      for (const i of hab[genre] || []) {
        const el = ((c.habillage || {})[genre] || [])[i];
        const x = el && habillageVu({ [genre]: [el] }, this)[0];
        if (x) zones.push(x.boite);
      }
    }
    return zones.length ? this.apresChangement(zones) : [];
  }

  // Un lieu change la place des arbres autour de son icône et, s'il est habité, porte ses champs.
  zoneMarqueur(x) {
    const m = x.m;
    const s = m.taille || 1;
    const z = { x0: m.x - 1.2 * s - 1, y0: m.y - 1.4 * s - 1, x1: m.x + 1.2 * s + 1, y1: m.y + 1 };
    const r = RAYONS[x.type];
    return r ? union(z, elargir({ x0: m.x, y0: m.y, x1: m.x, y1: m.y }, this.porteeLieu(r))) : z;
  }

  porteeLieu(r) {
    return 1.35 * r * Math.max(1, this.tailleChamp / 1.4) + 3 * this.tailleChamp;
  }

  // Après un changement dans les zones : arbres oubliés, parcelles des groupes touchés recalculées. Renvoie les zones
  // à repeindre, élargies à ce qui a pu bouger avec elles.
  apresChangement(zones) {
    const touchees = zones.slice();
    for (const [cle, g] of this.groupes) {
      if (g.quartier) continue;
      if (touchees.some((z) => croise(z, g.portee)) || !this.descripteurs().has(cle)) {
        zones.push(g.portee);
        this.groupes.delete(cle);
      }
    }
    for (const [cle, d] of this.descripteurs()) {
      if (!this.groupes.has(cle) && touchees.some((z) => croise(z, d.portee))) zones.push(d.portee);
    }
    // Les quartiers de champs dépendent des parcelles des lieux voisins (pas des autres quartiers).
    const avantQuartiers = zones.slice();
    for (const q of this.quartiers) {
      if (!avantQuartiers.some((z) => croise(z, q.portee))) continue;
      const g = this.groupes.get(q.cle);
      if (g) this.groupes.delete(q.cle);
      if (g ? g.parcelles.length : this.aDesChamps(q)) zones.push(q.portee);
    }
    const res = fusionnerZones(zones.map((z) => this.borner(z)).filter(Boolean));
    for (const z of touchees) this.oublierArbres(z);
    return res;
  }

  borner(z) {
    const r = { x0: Math.max(0, Math.floor(z.x0)), y0: Math.max(0, Math.floor(z.y0)), x1: Math.min(this.w, Math.ceil(z.x1)), y1: Math.min(this.h, Math.ceil(z.y1)) };
    return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
  }

  // Ce qui change sans que l'éditeur le signale (brouillard peint, lieu devenu connu ou caché, habillage posé) : vrai
  // si la vue montre d'autres lieux ou un autre habillage qu'au dernier relevé.
  aChange() {
    if (this.publiques) return false;
    let cle = habillageVu(this.carte.habillage, this).map((x) => x.cle).join("|");
    for (const m of this.carte.marqueurs || []) {
      const vu = this.vuMarqueur(m);
      cle += `${vu ? (vu.pale ? "p" : "n") : "-"}${this.typeLieu(m)}`;
    }
    const avant = this.cleVue;
    this.cleVue = cle;
    return avant !== undefined && avant !== cle;
  }

  // Terrain repeint dans une zone (en cases) : arbres et parcelles se recalculent autour.
  majTerrain(z) {
    return this.apresChangement([elargir(z, 3)]);
  }

  // ---------------------------------------------------------------- voies

  // Les arbres et les champs s'écartent des rivières, des routes, des lieux et des sentiers de l'habillage. Ce sont les
  // voies de Champs, mais seulement pour ce que la vue montre (une clairière trahirait un lieu caché).
  calculerVoies() {
    const traces = [...this.connu.traces.values()];
    const marqueurs = [...this.connu.marqueurs.values()].map((x) => x.m);
    const proxy = { carte: { traces, marqueurs }, voies: this.voies, W: this.W, H: this.H, tamponner: Champs.prototype.tamponner };
    Champs.prototype.calculerVoies.call(proxy);
    this.habillage.tamponner((x, y, r) => proxy.tamponner(x, y, r));
  }

  // ---------------------------------------------------------------- forêts vues de dessus

  oublierArbres(z) {
    const bx0 = Math.floor((z.x0 - 2) / SEAU);
    const by0 = Math.floor((z.y0 - 2) / SEAU);
    const bx1 = Math.floor((z.x1 + 2) / SEAU);
    const by1 = Math.floor((z.y1 + 2) / SEAU);
    for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) this.seaux.delete(by * 4096 + bx);
  }

  // Houppiers d'un paquet de 8 cases, posés sur une trame lâche, plus clairsemés en lisière ; quelques arbres isolés
  // dans les prés ; roseaux dans les marais ; arbres des vergers de l'habillage.
  seau(bx, by) {
    const cle = by * 4096 + bx;
    let s = this.seaux.get(cle);
    if (s) return s;
    s = { arbres: [], roseaux: [] };
    const X0 = bx * SEAU;
    const Y0 = by * SEAU;
    const X1 = X0 + SEAU;
    const Y1 = Y0 + SEAU;
    const { w, h } = this;
    const ch = this.champs;
    const nb = ch.bruit.bruit;
    const dedans = (x, y) => x >= X0 && x < X1 && y >= Y0 && y < Y1;
    const espece = (k) => (k === B.foret ? "feuillu" : k === B.pins ? "pin" : k === B.foret_profonde ? "sombre" : k === B.jungle ? "touffu" : null);
    const PAS = { feuillu: 0.56, pin: 0.5, sombre: 0.66, touffu: 0.7 };
    const RAYON = { feuillu: [0.34, 0.46], pin: [0.27, 0.35], sombre: [0.4, 0.54], touffu: [0.44, 0.6] };
    for (const type of ["feuillu", "pin", "sombre", "touffu"]) {
      const sp = PAS[type];
      const g = type.length * 13;
      for (let j = Math.max(0, Math.floor(Y0 / sp) - 1); j <= Math.ceil(Y1 / sp) && j * sp < h; j++) {
        for (let i = Math.max(0, Math.floor(X0 / sp) - 1); i <= Math.ceil(X1 / sp) && i * sp < w; i++) {
          const x = (i + 0.5 + (hacher(i, j, g) - 0.5) * 0.9) * sp;
          const y = (j + 0.5 + (hacher(i, j, g + 1) - 0.5) * 0.9) * sp;
          if (!dedans(x, y) || x < 0.3 || y < 0.3 || x > w - 0.3 || y > h - 0.3) continue;
          const I = Math.floor(x * SOUS);
          const J = Math.floor(y * SOUS);
          if (espece(ch.biomeSous[J * ch.W + I]) !== type || this.voies[J * ch.W + I]) continue;
          // En lisière, des trouées et des arbres plus petits.
          let bord = 0;
          for (const [ox, oy] of [[-0.8, 0], [0.8, 0], [0, -0.8], [0, 0.8]]) if (espece(ch.biomeA(x + ox, y + oy)) !== type) bord++;
          if (bord && hacher(i, j, g + 2) < 0.18 * bord) continue;
          const v = hacher(i, j, g + 3);
          const [r0, r1] = RAYON[type];
          const teinte = clamp(0.5 + 1.1 * nb(x / 5.3 + 1.1, y / 5.3 - 2.9) + (hacher(i, j, g + 4) - 0.5) * 0.55, 0, 0.999);
          s.arbres.push({ t: type, x, y, r: (r0 + (r1 - r0) * v) * (bord ? 0.85 : 1), v: teinte });
        }
      }
    }
    for (let j = Math.max(0, Math.floor(Y0 / 0.62) - 1); j <= Math.ceil(Y1 / 0.62) && j * 0.62 < h; j++) {
      for (let i = Math.max(0, Math.floor(X0 / 0.62) - 1); i <= Math.ceil(X1 / 0.62) && i * 0.62 < w; i++) {
        const x = (i + 0.5 + (hacher(i, j, 501) - 0.5) * 0.9) * 0.62;
        const y = (j + 0.5 + (hacher(i, j, 502) - 0.5) * 0.9) * 0.62;
        if (!dedans(x, y) || hacher(i, j, 503) > 0.55 || ch.biomeA(x, y) !== B.marais) continue;
        s.roseaux.push({ x, y, s: 0.22 + 0.14 * hacher(i, j, 504), v: hacher(i, j, 505) });
      }
    }
    const sp = 1.7;
    for (let j = Math.max(0, Math.floor(Y0 / sp) - 1); j <= Math.ceil(Y1 / sp) && j * sp < h; j++) {
      for (let i = Math.max(0, Math.floor(X0 / sp) - 1); i <= Math.ceil(X1 / sp) && i * sp < w; i++) {
        if (hacher(i, j, 401) > 0.05) continue;
        const nbArbres = 1 + Math.floor(hacher(i, j, 402) * 4);
        for (let k = 0; k < nbArbres; k++) {
          const x = (i + 0.5) * sp + (hacher(i, j, 410 + k) - 0.5) * 1.1;
          const y = (j + 0.5) * sp + (hacher(i, j, 420 + k) - 0.5) * 1.1;
          if (!dedans(x, y)) continue;
          const I = Math.floor(clamp(x, 0, w - 0.01) * SOUS);
          const J = Math.floor(clamp(y, 0, h - 0.01) * SOUS);
          const kb = ch.biomeSous[J * ch.W + I];
          if ((kb !== B.plaine && kb !== B.lande && kb !== B.collines) || this.voies[J * ch.W + I]) continue;
          if (this.habillage.exclu(x, y)) continue;
          s.arbres.push({ t: "feuillu", x, y, r: 0.26 + 0.14 * hacher(i, j, 430 + k), v: hacher(i, j, 440 + k) });
        }
      }
    }
    for (const a of this.habillage.arbres) if (dedans(a.x, a.y)) s.arbres.push(a);
    s.arbres.sort((a, b) => a.y - b.y || a.x - b.x);
    this.seaux.set(cle, s);
    return s;
  }

  dansZone(z, marge, cle) {
    const res = [];
    const bx0 = Math.max(0, Math.floor((z.x0 - marge) / SEAU));
    const by0 = Math.max(0, Math.floor((z.y0 - marge) / SEAU));
    const bx1 = Math.min(Math.ceil(this.w / SEAU) - 1, Math.floor((z.x1 + marge) / SEAU));
    const by1 = Math.min(Math.ceil(this.h / SEAU) - 1, Math.floor((z.y1 + marge) / SEAU));
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        for (const a of this.seau(bx, by)[cle]) if (a.x > z.x0 - marge && a.x < z.x1 + marge && a.y > z.y0 - marge && a.y < z.y1 + marge) res.push(a);
      }
    }
    return res;
  }

  arbresZone(z) {
    return this.dansZone(z, 1, "arbres").sort((a, b) => a.y - b.y || a.x - b.x);
  }

  // ---------------------------------------------------------------- champs cultivés

  // Une mosaïque de parcelles en lanières sur une trame tournée, gardées là où accepte(x, y, d, alea) le veut
  // (d : distance relative au centre) ; coins : test plus souple (une parcelle peut border une route sans la couvrir).
  parceller(o) {
    const { cx, cy, rayon, angle = 0, taille = 1.2, graine = 1, accepte } = o;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const res = [];
    let v = -rayon;
    let rang = 0;
    while (v < rayon) {
      const hRang = taille * (0.5 + 0.45 * hacher(rang, 0, graine));
      let u = -rayon - hacher(rang, 1, graine) * taille * 2;
      let col = 0;
      while (u < rayon) {
        const lCol = taille * (1.2 + 1.8 * hacher(rang, col + 7, graine + 1));
        const coins = [[u, v], [u + lCol, v], [u + lCol, v + hRang], [u, v + hRang]].map(([a, bb], q) => {
          const ja = (hacher(rang * 31 + col, q, graine + 2) - 0.5) * 0.05 * taille;
          const jb = (hacher(rang * 31 + col, q, graine + 3) - 0.5) * 0.05 * taille;
          return [cx + (a + ja) * ca - (bb + jb) * sa, cy + (a + ja) * sa + (bb + jb) * ca];
        });
        const mx = (coins[0][0] + coins[2][0]) / 2;
        const my = (coins[0][1] + coins[2][1]) / 2;
        const d = Math.hypot(mx - cx, my - cy) / rayon;
        const coinsOk = !o.coins || coins.every(([qx, qy]) => o.coins(qx, qy));
        if (coinsOk && accepte(mx, my, d, hacher(rang, col, graine + 4))) {
          res.push({ pts: coins, x: mx, y: my, sens: angle, culture: hacher(rang, col, graine + 6), v: hacher(rang, col, graine + 7), l: lCol, h: hRang });
        }
        u += lCol;
        col++;
      }
      v += hRang;
      rang++;
    }
    return res;
  }

  terreCultivable(x, y, coin) {
    const ch = this.champs;
    if (x < 0.5 || y < 0.5 || x > this.w - 0.5 || y > this.h - 0.5) return false;
    const i = Math.floor(y * SOUS) * ch.W + Math.floor(x * SOUS);
    const k = ch.biomeSous[i];
    if (this.voies[i]) return false;
    if (this.versEau[i] < (coin ? 0.3 : 0.6) * SOUS) return false;
    return k === B.plaine || k === B.cultures || k === B.lande || (coin && k === B.collines);
  }

  // Les groupes de parcelles que la vue montre : un par lieu habité, un par zone de champs de l'habillage.
  descripteurs() {
    if (this.desc) return this.desc;
    const d = new Map();
    for (const [cle, x] of this.connu.marqueurs) {
      const r = RAYONS[x.type];
      if (!r) continue;
      const m = x.m;
      d.set(`l${cle}`, { lieu: x, portee: elargir({ x0: m.x, y0: m.y, x1: m.x, y1: m.y }, this.porteeLieu(r)) });
    }
    for (const g of this.habillage.groupes) d.set(`h${g.cle}`, { hab: g, portee: g.portee });
    this.desc = d;
    return d;
  }

  groupe(cle, desc) {
    let g = this.groupes.get(cle);
    if (g) return g;
    let parcelles;
    if (desc.lieu) parcelles = this.parcellesLieu(desc.lieu);
    else if (desc.hab) parcelles = desc.hab.parceller(this);
    else parcelles = this.parcellesQuartier(desc);
    g = { parcelles, portee: desc.portee, quartier: !!desc.quartier };
    this.groupes.set(cle, g);
    return g;
  }

  parcellesLieu(x) {
    const m = x.m;
    const r = RAYONS[x.type];
    const g = Math.round(m.x * 7 + m.y * 13);
    const b = this.champs.bruit.bruit;
    const ps = this.parceller({
      cx: m.x, cy: m.y, rayon: r * Math.max(1, this.tailleChamp / 1.4), angle: (hacher(g, 1, 3) - 0.5) * 1.2, taille: this.tailleChamp, graine: g,
      coins: (qx, qy) => this.terreCultivable(qx, qy, true),
      accepte: (px, py, d, alea) => {
        if (Math.hypot(px - m.x, py - m.y) < 0.9) return false;
        if (this.habillage.exclu(px, py) || !this.terreCultivable(px, py)) return false;
        return d + 0.35 * b(px / 2.3, py / 2.3) < 0.85 + 0.15 * alea;
      },
    });
    if (x.pale) for (const p of ps) p.pale = true;
    return ps;
  }

  // Le terrain « Champs » : par quartiers (cellules irrégulières autour de germes), chacun avec son orientation, hors des
  // champs déjà posés autour des lieux.
  preparerQuartiers() {
    const q = [];
    const P = PAS_QUARTIER;
    let n = 0;
    this.grilleQuartiers = new Map();
    for (let j = -1; j * P < this.h + P; j++) {
      for (let i = -1; i * P < this.w + P; i++) {
        const g = { i, j, n, cle: `q${n}`, quartier: true, x: (i + 0.5 + (hacher(i, j, 811) - 0.5) * 0.8) * P, y: (j + 0.5 + (hacher(i, j, 812) - 0.5) * 0.8) * P, a: (hacher(i, j, 813) - 0.5) * 1.6 };
        g.portee = elargir({ x0: g.x, y0: g.y, x1: g.x, y1: g.y }, P * 1.1 + 3 * this.tailleChamp * 1.1);
        q.push(g);
        this.grilleQuartiers.set(`${i}:${j}`, g);
        n++;
      }
    }
    this.quartiers = q;
  }

  germeDe(x, y) {
    const i0 = Math.floor(x / PAS_QUARTIER);
    const j0 = Math.floor(y / PAS_QUARTIER);
    let m = null;
    let dm = Infinity;
    for (let j = j0 - 2; j <= j0 + 2; j++) {
      for (let i = i0 - 2; i <= i0 + 2; i++) {
        const g = this.grilleQuartiers.get(`${i}:${j}`);
        if (!g) continue;
        const d = (g.x - x) ** 2 + (g.y - y) ** 2;
        if (d < dm) {
          dm = d;
          m = g;
        }
      }
    }
    return m;
  }

  aDesChamps(g) {
    const t = this.carte.terrain;
    const P = PAS_QUARTIER;
    for (let y = Math.max(0, Math.floor(g.y - P)); y < Math.min(this.h, g.y + P); y++) {
      for (let x = Math.max(0, Math.floor(g.x - P)); x < Math.min(this.w, g.x + P); x++) if (t[y * this.w + x] === B.cultures) return true;
    }
    return false;
  }

  parcellesQuartier(g) {
    if (!this.aDesChamps(g)) return [];
    const pris = new Set();
    for (const [cle, d] of this.descripteurs()) {
      if (!d.lieu || !croise(d.portee, g.portee)) continue;
      for (const p of this.groupe(cle, d).parcelles) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) pris.add(`${Math.floor(p.x) + dx}:${Math.floor(p.y) + dy}`);
      }
    }
    const hab = this.habillage;
    return this.parceller({
      cx: g.x, cy: g.y, rayon: PAS_QUARTIER * 1.1, angle: g.a, taille: this.tailleChamp * 1.1, graine: 977 + g.n * 7,
      coins: (qx, qy) => this.terreCultivable(qx, qy, true) && !hab.exclu(qx, qy),
      accepte: (x, y) => this.germeDe(x, y) === g && !pris.has(`${Math.floor(x)}:${Math.floor(y)}`) && !hab.exclu(x, y)
        && this.champs.biomeA(x, y) === B.cultures && this.terreCultivable(x, y),
    });
  }

  parcellesZone(z) {
    const res = [];
    const garder = (ps) => {
      for (const p of ps) if (p.x > z.x0 - 4 && p.x < z.x1 + 4 && p.y > z.y0 - 4 && p.y < z.y1 + 4) res.push(p);
    };
    for (const [cle, d] of this.descripteurs()) if (croise(d.portee, z)) garder(this.groupe(cle, d).parcelles);
    for (const q of this.quartiers) if (croise(q.portee, z)) garder(this.groupe(q.cle, q).parcelles);
    return res;
  }

  // ---------------------------------------------------------------- dessin

  // Le fond d'une zone (en cases) : ctx reçoit la transformation case → pixel ; ras : les calques du raster
  // (calquesDe), qui couvrent la zone ; R : pixels par case de l'image (pour l'épaisseur des sillons).
  peindre(ctx, zone, R, ras) {
    const { w, h } = this;
    const z = { x0: Math.max(0, zone.x0), y0: Math.max(0, zone.y0), x1: Math.min(w, zone.x1), y1: Math.min(h, zone.y1) };
    if (z.x1 <= z.x0 || z.y1 <= z.y0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const poser = (calque) => {
      // Seule la partie utile du calque est posée.
      const k = ras.R;
      const sx = Math.max(0, Math.floor((z.x0 - ras.x0) * k) - 2);
      const sy = Math.max(0, Math.floor((z.y0 - ras.y0) * k) - 2);
      const sw = Math.min(ras.wpx, Math.ceil((z.x1 - ras.x0) * k) + 2) - sx;
      const sh = Math.min(ras.hpx, Math.ceil((z.y1 - ras.y0) * k) + 2) - sy;
      if (sw > 0 && sh > 0) ctx.drawImage(calque, sx, sy, sw, sh, ras.x0 + sx / k, ras.y0 + sy / k, sw / k, sh / k);
    };
    poser(ras.couleur);
    const parcelles = this.parcellesZone(z);
    dessinerParcelles(ctx, parcelles.filter((p) => !p.pale), z, R, 1);
    dessinerParcelles(ctx, parcelles.filter((p) => p.pale), z, R, 0.5);
    this.habillage.avantRelief(ctx, z);
    dessinerRoseaux(ctx, this.dansZone(z, 1, "roseaux"));
    dessinerHouppiers(ctx, this.arbresZone(z));
    ctx.globalCompositeOperation = "multiply";
    poser(ras.ombre);
    ctx.globalCompositeOperation = "screen";
    poser(ras.lumiere);
    ctx.globalCompositeOperation = "source-over";
    dessinerRives(ctx, this.champs, z);
    const traces = [...this.connu.traces.values()];
    for (const t of traces) if (t.type === "riviere") dessinerRiviere(ctx, t, z);
    this.habillage.apresRivieres(ctx, z);
    for (const t of traces) if (t.type === "route" || t.type === "chemin") dessinerChemin(ctx, t, this.echelleVoies, z);
    for (const t of traces) if (t.type === "frontiere") dessinerFrontiere(ctx, t, z);
    this.habillage.apresRoutes(ctx, z);
    const d = this.carte.decor || {};
    if (d.brume) dessinerBrume(ctx, d.brume, w, h, z);
    if (d.cadre !== false) {
      // Un léger assombrissement vers les bords, sous le cadre.
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.hypot(w, h) * 0.56);
      g.addColorStop(0, "rgba(30,20,10,0)");
      g.addColorStop(1, "rgba(30,20,10,.32)");
      ctx.fillStyle = g;
      ctx.fillRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- parcelles

const CULTURES = [
  { c: [210, 186, 108], sillon: "rgba(120,90,30,.2)" }, // blé mûr
  { c: [194, 178, 114], sillon: "rgba(110,84,40,.18)" }, // orge, seigle
  { c: [128, 156, 70], sillon: "rgba(190,214,120,.22)" }, // pré de fauche, en andains clairs
  { c: [178, 168, 104], sillon: "rgba(110,96,50,.2)" }, // jachère
  { c: [156, 128, 90], sillon: "rgba(70,46,24,.26)" }, // labour
  { c: [178, 184, 102], sillon: "rgba(90,100,40,.16)" }, // avoine verte
  { c: [150, 162, 116], sillon: "rgba(120,140,170,.2)" }, // lin, en fleurs bleutées
];

// Sans indication, surtout des blés, des orges et des prés ; peu de labours.
const PART = [0.32, 0.2, 0.24, 0.1, 0.07, 0.07];
export function cultureDe(p) {
  if (p.type !== undefined) return p.type;
  let s = 0;
  for (let i = 0; i < PART.length; i++) {
    s += PART[i];
    if (p.culture < s) return i;
  }
  return 0;
}

export function dessinerParcelles(ctx, parcelles, zone, R, alpha = 1) {
  const visibles = parcelles.filter((p) => p.x > zone.x0 - 4 && p.x < zone.x1 + 4 && p.y > zone.y0 - 4 && p.y < zone.y1 + 4);
  if (!visibles.length) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = "round";
  const contour = (p) => {
    ctx.moveTo(p.pts[0][0], p.pts[0][1]);
    for (let q = 1; q < 4; q++) ctx.lineTo(p.pts[q][0], p.pts[q][1]);
    ctx.closePath();
  };
  // Fond des parcelles, légèrement varié de l'une à l'autre.
  ctx.lineWidth = 0.03;
  for (const p of visibles) {
    const cu = CULTURES[cultureDe(p)] || CULTURES[0];
    const k = 0.92 + 0.14 * p.v;
    ctx.fillStyle = `rgb(${(cu.c[0] * k) | 0},${(cu.c[1] * k) | 0},${(cu.c[2] * k) | 0})`;
    ctx.beginPath();
    contour(p);
    ctx.fill();
    ctx.strokeStyle = ctx.fillStyle;
    ctx.stroke();
  }
  // Sillons : des lignes fines dans le sens de la parcelle.
  if (R >= 5) {
    for (const p of visibles) {
      const cu = CULTURES[cultureDe(p)] || CULTURES[0];
      ctx.save();
      ctx.beginPath();
      contour(p);
      ctx.clip();
      ctx.strokeStyle = cu.sillon;
      ctx.lineWidth = Math.max(0.6 / R, 0.035);
      const pas = Math.max(2.2 / R, 0.13);
      const ca = Math.cos(p.sens);
      const sa = Math.sin(p.sens);
      const L = Math.max(p.l, p.h) * 1.2;
      ctx.beginPath();
      for (let s = -L; s <= L; s += pas) {
        ctx.moveTo(p.x - ca * L - sa * s, p.y - sa * L + ca * s);
        ctx.lineTo(p.x + ca * L - sa * s, p.y + sa * L + ca * s);
      }
      ctx.stroke();
      ctx.restore();
    }
  }
  // Bordures : un liseré de terre, et des haies bosselées sur une partie des côtés.
  ctx.lineWidth = Math.max(0.8 / R, 0.035);
  ctx.strokeStyle = "rgba(92,74,40,.35)";
  ctx.beginPath();
  for (const p of visibles) contour(p);
  ctx.stroke();
  ctx.lineCap = "round";
  const haies = new Path2D();
  for (const p of visibles) {
    for (let q = 0; q < 4; q++) {
      const proba = (p.haies !== undefined ? p.haies : 0.3) * (q % 2 ? 0.45 : 1.25);
      if (hacher(Math.round(p.x * 10), Math.round(p.y * 10), 60 + q) > proba) continue;
      const a = p.pts[q];
      const bb = p.pts[(q + 1) % 4];
      haies.moveTo(a[0], a[1]);
      haies.lineTo(bb[0], bb[1]);
    }
  }
  ctx.setLineDash([0.001, 0.16]);
  ctx.strokeStyle = "rgba(30,56,26,.45)";
  ctx.lineWidth = 0.2;
  ctx.save();
  ctx.translate(0.04, 0.05);
  ctx.stroke(haies);
  ctx.restore();
  ctx.strokeStyle = "#4b6e30";
  ctx.lineWidth = 0.17;
  ctx.stroke(haies);
  ctx.strokeStyle = "rgba(150,186,96,.5)";
  ctx.lineWidth = 0.07;
  ctx.save();
  ctx.translate(-0.025, -0.025);
  ctx.stroke(haies);
  ctx.restore();
  ctx.setLineDash([]);
  ctx.restore();
}

// ---------------------------------------------------------------- houppiers

// Chaque essence va d'une teinte claire à une sombre ; les variantes se choisissent par taches, pas au hasard.
const ESPECES = {
  feuillu: { clair: [104, 138, 60], sombre: [58, 94, 42], lobes: 7, pointu: false },
  pin: { clair: [56, 100, 68], sombre: [30, 64, 48], lobes: 9, pointu: true },
  sombre: { clair: [50, 88, 54], sombre: [26, 52, 38], lobes: 8, pointu: false },
  touffu: { clair: [78, 132, 60], sombre: [42, 94, 48], lobes: 9, pointu: false },
  verger: { clair: [118, 150, 66], sombre: [90, 126, 56], lobes: 6, pointu: false },
};
const TAILLE_SPRITE = 64;
let sprites = null;

// Les houppiers sont peints une fois, en quelques variantes, puis posés en image : rien n'est retracé à chaque vue.
function preparerSprites() {
  if (sprites) return sprites;
  sprites = {};
  const S = TAILLE_SPRITE;
  const melange = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  for (const [nom, e] of Object.entries(ESPECES)) {
    sprites[nom] = [];
    for (let v = 0; v < 6; v++) {
      const c = toile(S, S);
      const g = c.getContext("2d");
      const teinte = melange(e.clair, e.sombre, v / 5).map(Math.round);
      const clair = `rgb(${Math.min(255, teinte[0] * 1.55 + 18)},${Math.min(255, teinte[1] * 1.45 + 16)},${Math.min(255, teinte[2] * 1.2 + 6)})`;
      const moyen = `rgb(${teinte[0]},${teinte[1]},${teinte[2]})`;
      const sombre = `rgb(${teinte[0] * 0.5},${teinte[1] * 0.55},${teinte[2] * 0.6})`;
      const R = S * 0.42;
      const cx = S / 2;
      const cy = S / 2;
      const grad = g.createRadialGradient(cx - R * 0.38, cy - R * 0.42, R * 0.08, cx, cy, R * 1.08);
      grad.addColorStop(0, clair);
      grad.addColorStop(0.55, moyen);
      grad.addColorStop(1, sombre);
      g.fillStyle = grad;
      g.beginPath();
      if (e.pointu) {
        const n = e.lobes;
        for (let k = 0; k <= 2 * n; k++) {
          const a = (k / (2 * n)) * Math.PI * 2 + v * 0.3;
          const rr = k % 2 ? R * (0.62 + 0.08 * hacher(v, k, 5)) : R * (0.95 + 0.08 * hacher(v, k, 6));
          if (k) g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
          else g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
        g.closePath();
        g.fill();
        // Étoile intérieure, plus claire au nord-ouest.
        g.strokeStyle = "rgba(20,40,28,.35)";
        g.lineWidth = S / 64;
        g.beginPath();
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + v * 0.3;
          g.moveTo(cx, cy);
          g.lineTo(cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.8);
        }
        g.stroke();
      } else {
        // Houppier fait de lobes, chacun éclairé au nord-ouest.
        const lobes = [[0, 0, 0.66]];
        for (let k = 0; k < e.lobes; k++) {
          const a = (k / e.lobes) * Math.PI * 2 + hacher(v, k, 3) * 0.6;
          const d = R * (0.48 + 0.12 * hacher(v, k, 4));
          lobes.push([Math.cos(a) * d, Math.sin(a) * d, 0.42 + 0.1 * hacher(v, k, 8)]);
        }
        for (const [ox, oy, rr] of lobes) {
          g.moveTo(cx + ox + rr * R, cy + oy);
          g.arc(cx + ox, cy + oy, rr * R, 0, Math.PI * 2);
        }
        g.fill();
        // Touffes de feuillage : clair au nord-ouest de chaque lobe, sombre au sud-est.
        for (const [ox, oy, rr] of lobes) {
          const lx = cx + ox;
          const ly = cy + oy;
          const gl = g.createRadialGradient(lx - rr * R * 0.35, ly - rr * R * 0.4, 0, lx, ly, rr * R);
          gl.addColorStop(0, "rgba(255,250,200,.30)");
          gl.addColorStop(0.5, "rgba(255,250,200,0)");
          gl.addColorStop(0.82, "rgba(0,20,0,0)");
          gl.addColorStop(1, "rgba(0,20,0,.32)");
          g.fillStyle = gl;
          g.beginPath();
          g.arc(lx, ly, rr * R, 0, Math.PI * 2);
          g.fill();
        }
      }
      sprites[nom].push(c);
    }
  }
  // Ombre portée : une tache douce.
  const o = toile(S, S);
  const go = o.getContext("2d");
  const gr = go.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.48);
  gr.addColorStop(0, "rgba(14,24,18,.62)");
  gr.addColorStop(0.6, "rgba(14,24,18,.42)");
  gr.addColorStop(1, "rgba(14,24,18,0)");
  go.fillStyle = gr;
  go.fillRect(0, 0, S, S);
  sprites.ombre = o;
  return sprites;
}

export function dessinerHouppiers(ctx, arbres) {
  if (!arbres.length) return;
  const sp = preparerSprites();
  const k = 1 / 0.42; // le houppier occupe 0,42 du sprite
  ctx.save();
  // Des sprites déjà doux, posés par centaines : le lissage « high » (rééchantillonnage soigné) coûtait l'essentiel du temps
  // d'un morceau de fond (2,3 s sur 3 pour la carte du monde de la campagne) sans rien changer à l'image.
  ctx.imageSmoothingQuality = "low";
  for (const a of arbres) {
    const d = a.r * k;
    ctx.globalAlpha = a.pale ? 0.45 : 1;
    ctx.drawImage(sp.ombre, a.x - d / 2 + a.r * 0.42, a.y - d / 2 + a.r * 0.5, d * 1.05, d * 1.05);
  }
  for (const a of arbres) {
    const liste = sp[a.t] || sp.feuillu;
    const d = a.r * k;
    ctx.globalAlpha = a.pale ? 0.5 : 1;
    ctx.drawImage(liste[Math.floor(a.v * liste.length) % liste.length], a.x - d / 2, a.y - d / 2, d, d);
  }
  ctx.restore();
}

function dessinerRoseaux(ctx, liste) {
  if (!liste.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(52,70,34,.75)";
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  for (const r of liste) {
    for (let k = -2; k <= 2; k++) {
      const a = -Math.PI / 2 + k * 0.32 + (r.v - 0.5) * 0.3;
      const l = r.s * (1 - Math.abs(k) * 0.18);
      ctx.moveTo(r.x + k * 0.03, r.y);
      ctx.lineTo(r.x + k * 0.03 + Math.cos(a) * l, r.y + Math.sin(a) * l);
    }
  }
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- eaux, rivières, chemins

function tracer(ctx, pts, ferme) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (ferme) ctx.closePath();
}

// Écume claire le long des rives, et quelques rides au large.
export function dessinerRives(ctx, champs, zone) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const op = [0.16, 0.1, 0.06];
  const z = elargir(zone, 0.5);
  champs.vagues.forEach((liste, k) => {
    ctx.strokeStyle = `rgba(226,244,240,${op[k]})`;
    ctx.lineWidth = 0.07 - k * 0.012;
    ctx.beginPath();
    for (const l of liste) if (croise(l.boite, z) || boiteVide(l.boite)) tracer(ctx, l.points, l.ferme);
    ctx.stroke();
  });
  ctx.strokeStyle = "rgba(244,250,244,.14)";
  ctx.lineWidth = 0.18;
  ctx.beginPath();
  for (const l of champs.cotes) if (croise(l.boite, z) || boiteVide(l.boite)) tracer(ctx, l.points, l.ferme);
  ctx.stroke();
  ctx.strokeStyle = "rgba(250,252,246,.5)";
  ctx.lineWidth = 0.045;
  ctx.stroke();
  ctx.restore();
}

// Une ligne réduite à un point a une boîte plate : croise() la manquerait.
const boiteVide = (b) => b.x1 <= b.x0 || b.y1 <= b.y0;

const lisses = new WeakMap();
function pointsLisses(trace) {
  let l = lisses.get(trace);
  if (!l || l.source !== trace.points) {
    l = { source: trace.points, pts: trace.points.length > 2 ? chaikin(trace.points, false, 3) : trace.points };
    lisses.set(trace, l);
  }
  return l.pts;
}

// Rivière : un liseré clair (berge), l'eau qui s'élargit vers l'aval, un reflet au milieu. Seuls les tronçons de la
// zone se tracent.
export function dessinerRiviere(ctx, trace, zone) {
  const pts = pointsLisses(trace);
  const n = pts.length;
  if (n < 2) return;
  const [l0, l1] = trace.largeur || [0.16, 0.42];
  const larg = (i) => (pts[i].length > 2 ? pts[i][2] : l0 + (l1 - l0) * (i / (n - 1)));
  const utiles = [];
  for (let i = 0; i < n - 1; i++) {
    const m = larg(i) + 0.6;
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    if (Math.max(ax, bx) + m < zone.x0 || Math.min(ax, bx) - m > zone.x1 || Math.max(ay, by) + m < zone.y0 || Math.min(ay, by) - m > zone.y1) continue;
    utiles.push(i);
  }
  if (!utiles.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const passes = [
    { c: "rgba(40,52,40,.18)", plus: 0.3, dx: 0.05, dy: 0.06 },
    { c: "rgba(214,198,148,.75)", plus: 0.15, dx: 0, dy: 0 },
    { c: "#62aaa8", plus: 0, dx: 0, dy: 0 },
    { c: "rgba(52,128,150,.85)", plus: 0, dx: 0, dy: 0, k: 0.5 },
  ];
  for (const ps of passes) {
    ctx.strokeStyle = ps.c;
    for (const i of utiles) {
      const l = (larg(i) + larg(i + 1)) / 2;
      ctx.lineWidth = ps.k ? l * ps.k : Math.max(0.03, l + ps.plus);
      ctx.beginPath();
      ctx.moveTo(pts[i][0] + ps.dx, pts[i][1] + ps.dy);
      ctx.lineTo(pts[i + 1][0] + ps.dx, pts[i + 1][1] + ps.dy);
      ctx.stroke();
    }
  }
  // Quelques reflets courts, pas un trait continu.
  ctx.strokeStyle = "rgba(200,236,232,.45)";
  for (const i of utiles) {
    if (hacher(i, 3, 91) > 0.3) continue;
    const l = larg(i);
    ctx.lineWidth = l * 0.16;
    ctx.beginPath();
    ctx.moveTo(pts[i][0] - l * 0.12, pts[i][1] - l * 0.12);
    ctx.lineTo(pts[i + 1][0] - l * 0.12, pts[i + 1][1] - l * 0.12);
    ctx.stroke();
  }
  ctx.restore();
}

function horsZone(pts, zone, m) {
  const b = boitePoints(pts, m);
  return !croise(b, zone);
}

// Route de terre : un ruban clair bordé d'ornières ; chemin : une sente plus étroite et pointillée.
export function dessinerChemin(ctx, trace, k = 1, zone = null) {
  const pts = pointsLisses(trace);
  if (pts.length < 2 || (zone && horsZone(pts, zone, 1))) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  tracer(ctx, pts, false);
  if (trace.type === "route") {
    ctx.strokeStyle = "rgba(92,70,40,.45)";
    ctx.lineWidth = 0.34 * k;
    ctx.stroke();
    ctx.strokeStyle = "#cdb17a";
    ctx.lineWidth = 0.24 * k;
    ctx.stroke();
    ctx.strokeStyle = "rgba(150,120,72,.5)";
    ctx.lineWidth = 0.04 * k;
    ctx.setLineDash([0.5 * k, 0.3 * k]);
    ctx.stroke();
  } else {
    ctx.strokeStyle = "rgba(92,70,40,.35)";
    ctx.lineWidth = 0.2 * k;
    ctx.setLineDash([0.42 * k, 0.22 * k]);
    ctx.stroke();
    ctx.strokeStyle = "#d6be8a";
    ctx.lineWidth = 0.12 * k;
    ctx.stroke();
  }
  ctx.restore();
}

// Frontière : une large bande rouge très douce et un trait pointillé.
function dessinerFrontiere(ctx, trace, zone) {
  const pts = pointsLisses(trace);
  if (pts.length < 2 || horsZone(pts, zone, 1)) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  tracer(ctx, pts, false);
  ctx.strokeStyle = "rgba(142,27,23,.14)";
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.strokeStyle = "rgba(122,24,20,.8)";
  ctx.lineWidth = 0.15;
  ctx.setLineDash([0.9, 0.32, 0.14, 0.32]);
  ctx.stroke();
  ctx.restore();
}

// Terres dans la brume : tout se fond dans un voile clair au-delà de l'ellipse.
function dessinerBrume(ctx, brume, w, h, z) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
  ctx.clip();
  ctx.translate(brume.x, brume.y);
  ctx.scale(brume.rx, brume.ry);
  const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 1.75);
  g.addColorStop(0, "rgba(226,222,206,0)");
  g.addColorStop(0.35, "rgba(226,222,206,.42)");
  g.addColorStop(1, "rgba(226,222,206,.9)");
  ctx.fillStyle = g;
  ctx.fillRect(-brume.x / brume.rx, -brume.y / brume.ry, w / brume.rx, h / brume.ry);
  ctx.restore();
}
