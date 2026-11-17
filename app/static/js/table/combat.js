// Le combat à la TV : ordre du tour, sablier, bandeau.

import { echapper } from "../api.js";
import { recadrerPlan } from "./carte-plan.js";
import { afficher, cacher } from "./ecran.js";
import { S, combatTv } from "./etat.js";
import { change, demandes, lireJson, numeroter } from "./outils.js";

// ---------------------------------------------------------------- le combat

// Le bandeau du combat, montré par le MJ : l'ordre du tour (prénoms et couleurs des héros, une case « Les ennemis »), le
// tour, le point strat et le sablier. Il passe sur le jeu (plan, carte, image), pas sur les écrans de présentation. Rien
// d'un adversaire n'arrive ici : le serveur ne l'envoie pas.
const VUES_COMBAT = ["plan", "carte", "image"];
const POSTURES_TV = { offensive: "offensive", defensive: "défensive", focus: "focus" };
const CARACS_TV = { physique: "P", social: "S", mental: "M" };

function htmlCombattantTv(x, actif) {
  if (x.genre === "ennemis") {
    return `<li class="ennemis${actif ? " actif" : ""}"><span class="ligne"><span class="losange-tv"></span><span class="nom-tv">Les ennemis</span></span><small>à eux de frapper</small></li>`;
  }
  const cartons = (x.cartons || []).map((k) => `<i class="carton-tv ${k.couleur === "rouge" ? "rouge" : "jaune"}">${CARACS_TV[k.carac] || ""}</i>`).join("")
    + (x.avantage === "avantage" || x.avantage === "desavantage" ? `<i class="jeton-tv ${x.avantage}" title="${x.avantage === "avantage" ? "Avantage" : "Désavantage"}">${x.avantage === "avantage" ? "+" : "−"}</i>` : "");
  const sous = x.coma ? "coma" : POSTURES_TV[x.posture] || "";
  return `<li class="heros${actif ? " actif" : ""}${x.coma ? " coma" : ""}"><span class="ligne"><span class="pastille" style="background:${echapper(x.couleur || "#c29b5c")}"></span><span class="nom-tv">${echapper(x.nom)}</span>${cartons}</span>${sous ? `<small>${sous}</small>` : ""}</li>`;
}

async function montrerCombat(etat, quoi) {
  const visible = Boolean(etat && etat.combat) && VUES_COMBAT.indexOf(quoi) >= 0;
  if (!change("combat", visible ? [etat.combat, etat.combat_maj ?? null] : null)) return;
  const actuel = numeroter("combat");
  if (!visible) return retirerCombat();
  const c = await lireJson(`/api/table/combat/${encodeURIComponent(etat.combat)}`);
  if (!actuel()) return;
  if (!c || !Array.isArray(c.ordre)) {
    delete demandes.combat;
    return retirerCombat();
  }
  combatTv.querySelector(".tour-tv b").textContent = String(c.tour || 1);
  combatTv.querySelector(".ordre-tv").innerHTML = c.ordre.map((x, i) => htmlCombattantTv(x, i === c.actif)).join("");
  const strat = combatTv.querySelector(".strat-tv");
  strat.classList.toggle("pris", Boolean(c.strat));
  strat.querySelector("b").textContent = c.strat ? "pris" : "disponible";
  majSablierTv(c.sablier);
  if (!combatTv.classList.contains("visible")) afficher(combatTv);
  majBandeau();
}

function retirerCombat() {
  clearTimeout(S.minuterieSablier);
  S.finSablier = 0;
  if (!combatTv.hidden) cacher(combatTv, 700);
  combatTv.classList.remove("rejoue");
  majBandeau();
}

// La barre se vide d'un seul mouvement jusqu'à zéro ; à zéro, « Le monstre rejoue ». Une mise à jour du combat qui
// garde le même sablier ne la fait pas repartir.
function majSablierTv(s) {
  const barre = combatTv.querySelector(".sablier-tv");
  const reste = barre.querySelector("span");
  if (!s || !(s.duree > 0)) {
    clearTimeout(S.minuterieSablier);
    S.finSablier = 0;
    barre.hidden = true;
    combatTv.classList.remove("rejoue");
    return;
  }
  const fin = Date.now() + Math.max(0, +s.reste || 0) * 1000;
  if (S.finSablier && !barre.hidden && Math.abs(fin - S.finSablier) < 1500) return;
  clearTimeout(S.minuterieSablier);
  S.finSablier = fin;
  barre.hidden = false;
  const secondes = Math.max(0, +s.reste || 0);
  reste.style.transition = "none";
  reste.style.transform = `scaleX(${Math.max(0, Math.min(1, secondes / s.duree))})`;
  void reste.offsetWidth; // la barre part de là où en est le sablier
  combatTv.classList.toggle("rejoue", secondes <= 0);
  if (secondes <= 0) return;
  reste.style.transition = `transform ${secondes}s linear`;
  reste.style.transform = "scaleX(0)";
  S.minuterieSablier = setTimeout(() => combatTv.classList.add("rejoue"), secondes * 1000);
}

// La place du bandeau : les cartons du haut se poussent dessous, et le plan se recadre pour que rien ne soit caché.
function majBandeau() {
  const haut = combatTv.classList.contains("visible") ? combatTv.offsetTop + combatTv.querySelector(".bandeau-tv").offsetHeight : 0;
  document.body.style.setProperty("--bandeau", `${haut}px`);
  document.body.classList.toggle("avec-combat", haut > 0);
  const part = Math.min(0.4, haut / Math.max(1, window.innerHeight));
  if (Math.abs(part - S.bandeau) < 0.005) return;
  S.bandeau = part;
  recadrerPlan(700);
}

export { majBandeau, montrerCombat };
