// L'état de l'atelier : la page courante, la barre des onglets, les formats et les petits outils des pages.

import { api } from "../api.js";
import { BarreOnglets } from "../commun/onglets.js";
import { estInvite } from "../mj/role.js";
import { menuDeLInvite } from "../mj/menu-invite.js";
import { calculerMurs } from "../plan/modele.js";
import { dessinerPlan } from "../plan/rendu.js";

const page = document.getElementById("page");
export const S = {
  courant: null,
  // Chaque navigation porte un numéro : une page qui finit de charger après qu'on l'a quittée ne s'affiche pas.
  navigation: 0,
};

// Un MJ invité (lot MJ-6, mj/role.js) : ses onglets seulement, avant que la barre ne se range.
if (estInvite()) menuDeLInvite(document.querySelector(".entete"));
// La porte du réseau local vient de s'éveiller : « Vos appareils » en tête, à relire.
if (document.body.dataset.appareils === "a-relire") import("../mj/appareils.js").then((m) => m.avisEnTete(page)).catch(() => {});
// Les onglets en trois familles, Jouer ouvert en plus le jour d'une séance (onglets.js).
const barreOnglets = new BarreOnglets(document.querySelector(".entete"), { lireSeances: () => api.get("/api/seances") });

const FORMATS = {
  continent: { nom: "Continent", largeur: 360, hauteur: 250, km_case: 8, taille_textes: 2.2, aide: "360 × 250 cases de 8 km" },
  region: { nom: "Région", largeur: 220, hauteur: 150, km_case: 1, taille_textes: 1.4, aide: "220 × 150 cases de 1 km" },
  contree: { nom: "Contrée", largeur: 160, hauteur: 110, km_case: 0.25, taille_textes: 1, aide: "160 × 110 cases de 250 m" },
};

function date(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-CH", { day: "numeric", month: "long" }) + " à " + d.toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" });
}

function onglet(nom) {
  for (const a of document.querySelectorAll("[data-onglet]")) a.setAttribute("aria-current", a.dataset.onglet === nom ? "page" : "false");
  document.body.dataset.page = nom;
  // La famille de la page s'ouvre ; si la ligne défile, l'onglet ouvert reste en vue.
  barreOnglets.ranger();
}

// L'éditeur et le générateur de cartes portent les cartes du kit (le monde et la région de la campagne, campagne/carte.js
// et campagne/pays.js : leurs lieux, leurs secrets, le nom caché de l'auberge) : aucun module commun ne les importe
// d'avance, ils se chargent à l'ouverture d'une carte ou à sa création, chez le MJ principal. Un MJ invité ne
// les reçoit pas (acces_mj.STATIQUES_INVITE).
const chargerEditeurCarte = () => import("../carte/editeur.js");
const chargerGenerateurCarte = () => import("../carte/generateur.js");

// Vignette d'un plan pour la liste : le rendu du MJ, sans brouillard, à petite échelle.
function vignettePlan(p) {
  const k = Math.max(3, Math.min(9, Math.floor(300 / Math.max(p.largeur, p.hauteur * 1.5))));
  const toile = document.createElement("canvas");
  toile.width = p.largeur * k;
  toile.height = p.hauteur * k;
  const ctx = toile.getContext("2d");
  ctx.setTransform(k, 0, 0, k, 0, 0);
  try {
    dessinerPlan(ctx, p, calculerMurs(p), { x0: 0, y0: 0, x1: p.largeur, y1: p.hauteur }, { style: "couleur", quadrillage: false });
  } catch {
    // une vignette ratée ne doit pas empêcher d'ouvrir la liste
  }
  return toile.toDataURL("image/png");
}

export { FORMATS, barreOnglets, chargerEditeurCarte, chargerGenerateurCarte, date, onglet, page, vignettePlan };
