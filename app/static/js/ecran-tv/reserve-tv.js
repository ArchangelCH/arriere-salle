// Les deux réserves des dés d'aventure sur la TV (lot G, reserve.py) : en petit, dans le coin en bas à droite, seulement
// quand le MJ joue avec la règle (la clé « reserve » de l'état public : deux nombres, rien d'autre). Des dés d'or pour le
// groupe, des dés de sang pour le MJ, et leur nombre. Sur le jeu seulement (plan, carte, image) : les écrans pleins les
// couvrent. Quand la légende des héros paraît sous le plan, le coin remonte au-dessus d'elle, de toute sa hauteur : sur
// un écran étroit (la table publique sur un iPad ou un téléphone en hauteur), elle tient sur plusieurs lignes. Un carton
// posé sur le jeu (PNJ, héros, rumeur, lieu) le fait s'effacer le temps qu'il est là (table.css).
//
// Importé par table.js, donc transpilé pour Chromium 79 : rien au-delà d'ES2019 (ni « ?. », ni « ?? »).

const VUES = ["plan", "carte", "image"];
const MAX_PIPS = 8; // au-delà, le nombre seul suffit

function compte(v) {
  return Number.isInteger(v) && v >= 0 && v <= 99 ? v : null;
}

function ligne(classe, nom, n) {
  let pips = "";
  for (let i = 0; i < Math.min(n, MAX_PIPS); i++) pips += "<i></i>";
  return `<p class="${classe}"><span class="pips-tv" aria-hidden="true">${pips}</span><b>${n}</b><span class="nom-tv">${nom}</span></p>`;
}

export class ReserveTv {
  // apres : l'élément après lequel se ranger (la légende des héros), pour remonter au-dessus d'elle quand elle paraît.
  constructor(apres) {
    this.el = document.createElement("div");
    this.el.className = "reserve-tv";
    this.el.setAttribute("aria-label", "Dés d'aventure");
    this.vu = "";
    if (apres && apres.parentNode) apres.parentNode.insertBefore(this.el, apres.nextSibling);
    else document.body.appendChild(this.el);
    // La hauteur de la légende, suivie quand elle change (ses noms, un écran tourné) : table.css s'en sert pour remonter.
    if (apres && typeof ResizeObserver === "function") {
      new ResizeObserver(() => this.el.style.setProperty("--legende", `${apres.offsetHeight}px`)).observe(apres);
    }
  }

  // Chaque état reçu : la réserve (absente : la règle n'est pas en jeu) et la vue demandée.
  montrer(reserve, quoi) {
    const aventure = reserve ? compte(reserve.aventure) : null;
    const mesaventure = reserve ? compte(reserve.mesaventure) : null;
    const visible = aventure !== null && mesaventure !== null && VUES.indexOf(quoi) >= 0;
    this.el.classList.toggle("visible", visible);
    if (aventure === null || mesaventure === null) return;
    const cle = `${aventure}/${mesaventure}`;
    if (cle === this.vu) return;
    this.vu = cle;
    this.el.innerHTML = ligne("groupe-tv", "Aventure", aventure) + ligne("mj-tv", "Mésaventure", mesaventure);
  }
}
