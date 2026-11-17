// Les pointeurs que les joueurs posent depuis la page Table du coin (« Montrer au MJ »), sur le plan ou la carte ouverts
// dans l'atelier : un point à la couleur du héros, le prénom du joueur à côté, une onde quand il touche. Le serveur
// (coin_mj/pointeurs_mj.py) ne transmet que ceux qui visent ce que la TV montre en ce moment ; ici, seuls ceux de CE plan
// (ou de cette carte) se dessinent. Un point qui n'a pas bougé depuis quelques secondes s'estompe de lui-même.
//
//   const fin = montrerPointeursJoueurs({ hote, genre: "plan", id, vue: () => this.vue });   ...   fin();
//
// hote : l'élément positionné qui contient le canvas (la scène de l'éditeur) ; vue() : la vue (versEcran), ou null.

import { ecouterPointeursJoueurs } from "../ecran-tv/canal-table.js";

const IMMOBILE = 5000; // millisecondes sans nouvelle position : le point s'estompe
const LISSAGE = 110; // millisecondes : le point rattrape la position reçue (six par seconde)
const COULEUR = /^#[0-9a-f]{3,8}$/i;

export function montrerPointeursJoueurs({ hote, genre, id, vue }) {
  const calque = document.createElement("div");
  calque.className = "pointeurs-joueurs";
  calque.setAttribute("aria-hidden", "true");
  hote.append(calque);
  // joueur : { el, x, y, cx, cy, onde, vu, couleur }
  const points = new Map();
  let raf = 0;
  let avant = 0;

  function recevoir(msg) {
    const maintenant = performance.now();
    const presents = new Set();
    for (const p of Array.isArray(msg.pointeurs) ? msg.pointeurs : []) {
      if (!p || p.genre !== genre || p.id !== id || typeof p.joueur !== "string" || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      presents.add(p.joueur);
      let e = points.get(p.joueur);
      if (!e) {
        const el = document.createElement("div");
        el.className = "pj";
        el.innerHTML = '<i class="pj-point"></i><span class="pj-nom"></span>';
        calque.append(el);
        e = { el, x: p.x, y: p.y, cx: p.x, cy: p.y, onde: p.onde, vu: maintenant, nouveau: true };
        points.set(p.joueur, e);
        // Une onde déjà là à l'ouverture (la page vient de s'ouvrir) ne se rejoue pas, sauf si elle est toute fraîche.
        if (typeof p.onde_age === "number" && p.onde_age < 2) lancerOnde(e);
      } else {
        if (p.x !== e.x || p.y !== e.y) e.vu = maintenant;
        e.x = p.x;
        e.y = p.y;
        if (p.onde !== e.onde) {
          e.onde = p.onde;
          e.vu = maintenant;
          lancerOnde(e);
        }
      }
      e.el.style.setProperty("--c", COULEUR.test(p.couleur || "") ? p.couleur : "#e0b562");
      e.el.querySelector(".pj-nom").textContent = String(p.nom || "").slice(0, 24);
      e.el.classList.remove("estompe");
    }
    for (const [joueur, e] of [...points]) {
      if (presents.has(joueur)) continue;
      e.el.remove();
      points.delete(joueur);
    }
    demander();
  }

  function lancerOnde(e) {
    e.el.classList.remove("onde");
    void e.el.offsetWidth; // l'animation repart
    e.el.classList.add("onde");
  }

  function demander() {
    if (!raf && points.size) {
      avant = performance.now();
      raf = requestAnimationFrame(image);
    }
  }

  function image(t) {
    raf = 0;
    const v = vue();
    const dt = Math.max(0, Math.min(100, t - avant));
    avant = t;
    const k = 1 - Math.exp(-dt / LISSAGE);
    for (const e of points.values()) {
      if (e.nouveau) {
        e.nouveau = false;
      } else {
        e.cx += (e.x - e.cx) * k;
        e.cy += (e.y - e.cy) * k;
      }
      e.el.classList.toggle("estompe", t - e.vu > IMMOBILE);
      if (v) {
        const [sx, sy] = v.versEcran(e.cx, e.cy);
        e.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
      }
    }
    // Tant qu'un point est là, la caméra du MJ peut bouger sous lui : il suit.
    if (points.size) raf = requestAnimationFrame(image);
  }

  const arreter = ecouterPointeursJoueurs(recevoir);
  return () => {
    arreter();
    cancelAnimationFrame(raf);
    calque.remove();
    points.clear();
  };
}
