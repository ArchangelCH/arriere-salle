// Les horloges de la menace sur la TV (horloges.py ; le MJ les montre depuis son tableau) : un cadran rond découpé en
// parts, le nom dessous, dans le coin en haut à gauche, sous le bandeau du combat quand il est là ; plusieurs s'empilent,
// un peu plus petites. Une part gagnée pousse depuis le centre, puis le cadran luit brièvement : rien que du transform et
// de l'opacity, sans filtre. Selon la vue : en grand sur le jeu (plan, carte, accueil, image), réduites sur les écrans
// pleins où le jeu continue (échoppe, planche à contrats, sanctuaire), absentes des écrans de présentation (carton-titre,
// « Précédemment », la tablée, les fiches) ; elles y reviennent là où elles en étaient, la part gagnée entre-temps
// animée au retour. Importé par table.js, donc transpilé pour Chromium 79 : rien de plus récent que lui.

import { echapper } from "../api.js";

const MAX = 3;
const PARTS = [4, 6, 8];
const REDUITES = ["boutique", "planche", "sanctuaire", "document"];
const MASQUEES = ["episode", "precedemment", "heros", "fiches"];
// L'accueil et l'image plein écran couvrent la page : les horloges passent devant elles. Sur le plan et la carte, elles
// restent sous le pointeur du MJ et sous les cartons (voir horloges-tv.css).
const DEVANT = ["accueil", "image"];
const POUSSE = 550; // millisecondes : une part qui se remplit (la transition de la feuille)
const ECART = 160; // entre deux parts gagnées d'un même coup
const SORTIE = 700; // fondu d'une horloge retirée
const DESCENTE = 1200; // le temps qu'une vue opaque s'efface avant que les horloges repassent dessous
const REAPPARITION = 700; // au retour d'une vue où elles étaient masquées : le cadran reparaît, puis il change

const SVG_DEGRADES = `<svg class="hz-degrades" width="0" height="0" aria-hidden="true" focusable="false"><defs>
  <linearGradient id="hz-or" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6dc93"/><stop offset=".46" stop-color="#c79a46"/><stop offset=".56" stop-color="#8a6424"/><stop offset="1" stop-color="#e6c06a"/></linearGradient>
  <radialGradient id="hz-face" cx="0" cy="0" r="43" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fbf5e4"/><stop offset=".72" stop-color="#f0e1bf"/><stop offset="1" stop-color="#d9c08e"/></radialGradient>
  <radialGradient id="hz-sang" cx="0" cy="0" r="41" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#c63a2c"/><stop offset=".62" stop-color="#9c1e18"/><stop offset="1" stop-color="#6c1310"/></radialGradient>
</defs></svg>`;

const point = (a, r) => `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;

// Le cadran, en unités de 100 centrées sur zéro : le liseré d'encre, l'anneau d'or, la face de parchemin, les parts de
// sang (rayon 40 : un filet de parchemin les sépare de l'anneau), les traits d'encre entre elles et le clou d'or.
function svgCadran(parts, remplies) {
  const pas = (2 * Math.PI) / parts;
  let secteurs = "";
  let traits = "";
  for (let i = 0; i < parts; i++) {
    const a = -Math.PI / 2 + i * pas;
    secteurs += `<path class="hz-part${i < remplies ? " pleine" : ""}" fill="url(#hz-sang)" d="M0 0L${point(a, 40)}A40 40 0 0 1 ${point(a + pas, 40)}Z"/>`;
    traits += `M0 0L${point(a, 42.5)}`;
  }
  return `<svg viewBox="-50 -50 100 100" aria-hidden="true" focusable="false">
    <circle r="49.6" fill="#2b1d12"/><circle r="48" fill="url(#hz-or)"/><circle r="42.5" fill="url(#hz-face)"/>
    <g class="hz-parts">${secteurs}</g>
    <path d="${traits}" stroke="#2b1d12" stroke-width="1.7" stroke-linecap="round" fill="none"/>
    <circle r="42.5" stroke="#2b1d12" stroke-width="1.4" fill="none"/>
    <circle r="5" fill="url(#hz-or)" stroke="#2b1d12" stroke-width="1.3"/></svg>`;
}

// Les chiffres de Cinzel font d'un 1 un I : dans le nom, ils passent en Garamond.
const nomHtml = (nom) => String(nom).split(/(\d+)/).map((x, i) => (i % 2 ? `<span class="chiffres">${x}</span>` : echapper(x))).join("");
const libelle = (h) => `${h.nom} : ${h.remplies} ${h.remplies > 1 ? "parts remplies" : "part remplie"} sur ${h.parts}`;

function valide(h) {
  return h && typeof h.id === "string" && typeof h.nom === "string" && PARTS.indexOf(h.parts) >= 0
    && typeof h.remplies === "number" && h.remplies >= 0 && h.remplies <= h.parts;
}

export class HorlogesTv {
  // avant : l'élément devant lequel se ranger dans la page (le calque du pointeur), pour passer sous lui.
  constructor(avant) {
    this.racine = document.createElement("div");
    this.racine.className = "horloges-tv";
    this.racine.innerHTML = SVG_DEGRADES;
    avant.parentNode.insertBefore(this.racine, avant);
    this.vues = new Map(); // id -> { el, h, minuteries }
    this.niveau = "";
    this.minuterieNiveau = 0;
    this.masquees = false;
    this.retour = 0; // l'heure où elles ont reparu
  }

  // Chaque état reçu : la liste des horloges montrées (absente : aucune) et la vue demandée (« plan », « boutique »…).
  montrer(liste, quoi) {
    const masquees = MASQUEES.indexOf(quoi) >= 0;
    if (this.masquees && !masquees) this.retour = performance.now();
    this.masquees = masquees;
    this.racine.classList.toggle("masquees", masquees);
    if (masquees) return; // les cadrans gardent leur état : la part gagnée s'animera au retour
    const reduites = REDUITES.indexOf(quoi) >= 0;
    this.racine.classList.toggle("reduites", reduites);
    this.poserNiveau(reduites ? "reduites" : DEVANT.indexOf(quoi) >= 0 ? "devant" : "");
    this.accorder(Array.isArray(liste) ? liste.filter(valide).slice(0, MAX) : []);
  }

  // Monter devant une vue se fait tout de suite ; redescendre attend qu'elle se soit effacée (les horloges ne
  // disparaissent pas un instant sous un accueil encore à moitié là).
  poserNiveau(niveau) {
    if (niveau === this.niveau) return;
    const rang = { "": 0, devant: 1, reduites: 2 };
    clearTimeout(this.minuterieNiveau);
    const appliquer = () => {
      this.racine.classList.toggle("devant", niveau === "devant");
      this.racine.classList.toggle("au-dessus", niveau === "reduites");
    };
    if (rang[niveau] > rang[this.niveau]) appliquer();
    else this.minuterieNiveau = setTimeout(appliquer, DESCENTE);
    this.niveau = niveau;
  }

  accorder(liste) {
    const ids = liste.map((h) => h.id);
    this.vues.forEach((v, id) => {
      if (ids.indexOf(id) < 0) this.retirer(id);
    });
    // Les horloges dans l'ordre du MJ, devant celles qui s'en vont.
    let suivant = this.racine.firstChild.nextSibling;
    liste.forEach((h) => {
      const v = this.vues.get(h.id);
      if (v) this.majHorloge(v, h);
      const el = v ? v.el : this.creer(h);
      if (el !== suivant) this.racine.insertBefore(el, suivant);
      suivant = el.nextSibling;
    });
    this.racine.classList.remove("n1", "n2", "n3");
    if (liste.length) this.racine.classList.add(`n${liste.length}`);
  }

  creer(h) {
    const el = document.createElement("figure");
    el.className = `horloge-tv entree${h.remplies >= h.parts ? " echue" : ""}`;
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", libelle(h));
    el.innerHTML = `<span class="hz-disque"><span class="hz-lueur"></span>${svgCadran(h.parts, h.remplies)}</span><figcaption>${nomHtml(h.nom)}</figcaption>`;
    this.vues.set(h.id, { el, h, minuteries: [] });
    // Elle glisse depuis le bord une fois posée dans la page.
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("entree")));
    return el;
  }

  majHorloge(v, h) {
    const avant = v.h;
    v.h = h;
    const el = v.el;
    el.setAttribute("aria-label", libelle(h));
    if (h.nom !== avant.nom) el.querySelector("figcaption").innerHTML = nomHtml(h.nom);
    if (h.parts !== avant.parts) {
      // Un autre découpage : le cadran est redessiné tel quel, sans animation.
      this.arreter(v);
      el.querySelector("svg").outerHTML = svgCadran(h.parts, h.remplies);
      el.classList.toggle("echue", h.remplies >= h.parts);
      return;
    }
    if (h.remplies === avant.remplies) return;
    this.arreter(v);
    const parts = el.querySelectorAll(".hz-part");
    const gagnees = Math.max(0, h.remplies - avant.remplies);
    // Juste revenues d'une vue où elles étaient masquées : le changement attend que le cadran ait reparu.
    const retard = Math.max(0, this.retour + REAPPARITION - performance.now());
    for (let i = 0; i < parts.length; i++) {
      const pleine = i < h.remplies;
      // Les parts gagnées poussent l'une après l'autre ; une part perdue se retire d'un coup.
      const rang = pleine && i >= avant.remplies ? i - avant.remplies : 0;
      parts[i].style.transitionDelay = retard || rang ? `${Math.round(retard + rang * ECART)}ms` : "";
      parts[i].classList.toggle("pleine", pleine);
    }
    const echue = h.remplies >= h.parts;
    if (!gagnees) {
      if (!retard) return el.classList.toggle("echue", echue);
      v.minuteries.push(setTimeout(() => el.classList.toggle("echue", echue), retard));
      return;
    }
    // La lueur quand la dernière part gagnée a fini de pousser ; rouge, et le nom sur fond de sang, si l'horloge est échue.
    v.minuteries.push(setTimeout(() => {
      el.classList.toggle("echue", echue);
      el.classList.remove("luit");
      void el.offsetWidth; // l'animation repart de zéro
      el.classList.add("luit");
    }, retard + POUSSE * 0.7 + (gagnees - 1) * ECART));
  }

  arreter(v) {
    v.minuteries.forEach(clearTimeout);
    v.minuteries = [];
  }

  retirer(id) {
    const v = this.vues.get(id);
    this.vues.delete(id);
    this.arreter(v);
    // Remontrée entre-temps, elle aurait un nouvel élément : celui-ci s'en va de toute façon.
    v.el.classList.add("sortie");
    setTimeout(() => v.el.remove(), SORTIE);
  }
}
