// Les fiches des héros et de la tablée à la TV.

import { echapper } from "../api.js";
import { CARACS, essentiel, titre } from "../aventuriers/regles.js";
import { afficher, cacher } from "./ecran.js";
import { cartonHeros, enPortrait, fichesTv, tableeHeros, telephone } from "./etat.js";
import { change, demandes, lireJson, medaillonTv, numeroter } from "./outils.js";

const dizaine = (v) => {
  const t = String(v ?? "");
  return t.length > 1 ? `<span class="dizaine">${echapper(t.slice(0, -1))}</span>${echapper(t.slice(-1))}` : echapper(t);
};

// Un aventurier se présente : repris à chaque enregistrement tant qu'il est à l'écran (la table le voit prendre forme).
async function montrerAventurier(id, maj) {
  if (!change("aventurier", id ? [id, maj ?? null] : null)) return;
  const actuel = numeroter("aventurier");
  if (!id) return cacher(cartonHeros, 700);
  const a = await lireJson(`/api/table/aventurier/${encodeURIComponent(id)}`);
  if (!actuel()) return;
  if (!a) {
    delete demandes.aventurier;
    return cacher(cartonHeros, 700);
  }
  cartonHeros.querySelector(".medaillon-tv").innerHTML = medaillonTv(a);
  cartonHeros.querySelector(".titre-heros").textContent = titre(a);
  cartonHeros.querySelector(".nom").textContent = a.nom || "Sans nom";
  cartonHeros.querySelector(".joueur").innerHTML = a.joueur ? `<span class="pastille" style="background:${echapper(a.couleur || "#888")}"></span>${a.genre === "f" ? "jouée" : "joué"} par ${echapper(a.joueur)}` : "";
  cartonHeros.querySelector(".stats-tv").innerHTML = `${CARACS.map((c) => `<span><small>${c.nom}</small><b>${dizaine(a[c.cle])}</b></span>`).join("")}
    <span class="jauge"><small>Santé</small><b>${echapper(a.sante ?? "")}</b></span><span class="jauge"><small>Psy</small><b>${echapper(a.psy ?? "")}</b></span>`;
  cartonHeros.querySelector(".themes").textContent = (a.themes || []).join(" · ");
  cartonHeros.querySelector(".allure").textContent = a.allure || "";
  afficher(cartonHeros);
}

async function montrerTablee(etat) {
  const actuel = numeroter("tablee");
  if (!etat) return cacher(tableeHeros, 1000);
  const liste = await lireJson("/api/table/heros");
  if (!actuel()) return;
  if (!Array.isArray(liste)) return cacher(tableeHeros, 1000);
  tableeHeros.querySelector(".heros").innerHTML = liste.map((a) => `
    <article class="heros-tv">
      ${medaillonTv(a)}
      <h2>${echapper(a.nom || "Sans nom")}</h2>
      <p class="titre-heros">${echapper(titre(a))}</p>
      ${a.joueur ? `<p class="joueur"><span class="pastille" style="background:${echapper(a.couleur || "#888")}"></span>${echapper(a.joueur)}</p>` : ""}
    </article>`).join("") || '<p class="planche-vide">La tablée est vide.</p>';
  const n = Math.max(1, liste.length);
  const colonnes = colonnesDe(n, enPortrait() ? 4 : 5);
  tableeHeros.style.setProperty("--n", colonnes);
  tableeHeros.style.setProperty("--colonnes", colonnes);
  tableeHeros.hidden = false; // encore transparente : mesurable sans être vue
  ajusterTablee();
  afficher(tableeHeros);
}

// Les rangées de la tablée : jamais plus de `max` héros côte à côte, et des rangées égales (sept héros : 4 puis 3, non 6 puis 1).
function colonnesDe(n, max) {
  return Math.ceil(n / Math.ceil(n / max));
}

// La tablée tient dans l'écran, à toute taille : le facteur --k rétrécit médaillons, titres et marges d'un cran tant que
// quelque chose sort de l'écran (une rangée coupée en bas, le titre en haut, un nom ou un sous-titre plus large que sa
// colonne). Refaite à chaque redimensionnement. Sur un téléphone, une colonne qui défile : rien ne rétrécit.
function ajusterTablee() {
  if (tableeHeros.hidden) return;
  const n = tableeHeros.querySelectorAll(".heros-tv").length;
  if (n) {
    const colonnes = colonnesDe(n, enPortrait() ? 4 : 5);
    tableeHeros.style.setProperty("--n", colonnes);
    tableeHeros.style.setProperty("--colonnes", colonnes);
  }
  tableeHeros.classList.remove("defile");
  tableeHeros.style.setProperty("--k", 1);
  if (telephone()) return;
  const textes = Array.prototype.slice.call(tableeHeros.querySelectorAll(".heros-tv h2, .heros-tv .titre-heros, .heros-tv .joueur"));
  const deborde = () => {
    const haut = tableeHeros.querySelector("header").getBoundingClientRect().top;
    const bas = tableeHeros.querySelector(".heros").getBoundingClientRect().bottom;
    return haut < 4 || bas > window.innerHeight - 4 || textes.some((t) => t.scrollWidth > t.clientWidth + 1);
  };
  let k = 1;
  while (k > 0.3 && deborde()) {
    k -= 0.04;
    tableeHeros.style.setProperty("--k", k.toFixed(2));
  }
  if (deborde()) tableeHeros.classList.add("defile");
}

// Les fiches de la tablée en partie : une colonne par héros, lue depuis le canapé. Le texte part grand et rétrécit
// d'un cran tant que la plus longue fiche dépasse l'écran.
const DEFENSES_TV = ["aucune défense", "une défense", "deux défenses"];
const pct = (v) => `${echapper(v)}<small>%</small>`;
// La Santé ou la Psy du moment sur le maximum de la fiche (« 5/8 ») ; au maximum, le chiffre seul.
const jaugeTv = (max, actuelle) => (typeof actuelle === "number" && actuelle < max
  ? `${echapper(String(actuelle).replace("-", "−"))}<small>/${echapper(max)}</small>` : echapper(max));

// La Santé et la Psy du moment, la défense et l'armure : seules ces cases changent quand un coup ou un repos est noté.
function htmlJaugesTv(a, x) {
  const bouclier = x.bouclier && x.posture && x.posture.cle === "defensive" ? 2 : 0;
  return `<span class="sante"><small>Santé</small><b>${jaugeTv(x.sante, a.sante_actuelle)}</b></span><span class="psy"><small>Psy</small><b>${jaugeTv(x.psy, a.psy_actuelle)}</b></span>
        <span><small>Défense</small><b>${pct(x.defense)}</b></span><span><small>Armure</small><b>${x.protection.indice + bouclier}</b></span>`;
}

// jauges : faux pour la forme seule de la fiche, sans ces cases (montrerFiches compare les formes).
function htmlFicheTv(a, jauges = true) {
  const x = essentiel(a);
  return `
    <article class="fiche-tv" style="border-top-color:${echapper(a.couleur || "#8a6a34")}">
      <header>
        ${medaillonTv(a)}
        <div>
          <h2>${echapper(a.nom || "Sans nom")}</h2>
          <p class="titre-heros">${echapper(titre(a))}</p>
          ${a.joueur ? `<p class="joueur"><span class="pastille" style="background:${echapper(a.couleur || "#888")}"></span>${echapper(a.joueur)}</p>` : ""}
        </div>
      </header>
      <div class="cases">${x.caracs.map((c) => `<span><small>${c.nom}</small><b>${pct(c.valeur)}</b></span>`).join("")}</div>
      <div class="cases jauges">${jauges ? htmlJaugesTv(a, x) : ""}</div>
      ${x.posture ? `<p class="posture">${echapper(x.posture.nom)} : ${DEFENSES_TV[x.defenses] || ""} par tour${x.posture.cle === "focus" ? ", +5 % aux tests" : ""}</p>` : ""}
      ${x.competences.length ? `<h3>Compétences</h3><ul>${x.competences.map((c) => `<li><span>${echapper(c.nom)}</span><b>${pct(c.valeur)}</b></li>`).join("")}</ul>` : ""}
      ${x.armes.length ? `<h3>Armes</h3><ul>${x.armes.map((w) => `<li><span>${echapper(w.nom)}${w.nombre > 1 ? ` × ${w.nombre}` : ""} <i>${echapper(w.degats)}</i></span><b>${pct(w.valeur)}</b></li>`).join("")}</ul>` : ""}
      ${x.dons.length ? `<h3>Dons</h3><ul>${x.dons.map((d) => `<li><span>${echapper(d.nom)}</span><em>${echapper(d.cout)}</em></li>`).join("")}</ul>` : ""}
    </article>`;
}

// Les fiches à l'écran : leur forme (sans les jauges) et leurs jauges, pour ne changer que celles-ci quand seules elles
// bougent (un coup noté au combat, un repos) : les fiches restent en place, sans rejouer leur entrée.
let fichesVues = null;

async function montrerFiches(etat) {
  const actuel = numeroter("fiches");
  if (!etat) {
    fichesVues = null;
    return cacher(fichesTv, 1000);
  }
  const liste = await lireJson("/api/table/fiches");
  if (!actuel()) return;
  if (!Array.isArray(liste)) {
    fichesVues = null;
    return cacher(fichesTv, 1000);
  }
  const colonnes = fichesTv.querySelector(".colonnes");
  const forme = liste.map((a) => htmlFicheTv(a, false)).join("");
  const jauges = liste.map((a) => htmlJaugesTv(a, essentiel(a)));
  const enPlace = colonnes.querySelectorAll(".fiche-tv .jauges");
  if (fichesVues && fichesVues.forme === forme && fichesTv.classList.contains("visible") && enPlace.length === jauges.length) {
    jauges.forEach((html, i) => {
      if (html !== fichesVues.jauges[i]) enPlace[i].innerHTML = html;
    });
    fichesVues.jauges = jauges;
    return;
  }
  fichesVues = { forme, jauges };
  colonnes.innerHTML = liste.map((a) => htmlFicheTv(a)).join("") || '<p class="planche-vide">La tablée est vide.</p>';
  fichesTv.hidden = false; // encore transparente : mesurable sans être vue
  ajusterFiches();
  afficher(fichesTv);
}

// Les fiches tiennent dans l'écran, à toute taille : toutes les répartitions en colonnes (sept héros : 4 puis 3, 3 puis 3
// puis 1...) sont essayées, le texte part grand et rétrécit d'un cran tant que la plus longue fiche dépasse l'écran ou
// qu'un nom déborde de sa fiche ; on garde la répartition qui laisse le texte le plus grand. Refaite à chaque
// redimensionnement. Sur un téléphone, une colonne qui défile : la feuille de style donne les tailles, rien ne rétrécit.
function ajusterFiches() {
  if (fichesTv.hidden) return;
  const colonnes = fichesTv.querySelector(".colonnes");
  const n = colonnes.querySelectorAll(".fiche-tv").length;
  fichesTv.classList.remove("defile");
  if (telephone()) {
    fichesTv.style.setProperty("--colonnes", 1);
    fichesTv.style.setProperty("--echelle", 1);
    return;
  }
  const deborde = () => {
    const r = colonnes.getBoundingClientRect();
    return r.bottom > window.innerHeight - 12 || r.top < 12
      || Array.prototype.some.call(colonnes.querySelectorAll(".fiche-tv h2, .fiche-tv .titre-heros"), (h) => h.scrollWidth > h.clientWidth + 1);
  };
  let meilleur = { echelle: -1, colonnes: 1 };
  const candidats = [];
  for (let c = Math.min(Math.max(1, n), 6); c >= 1; c--) if (!candidats.some((x) => Math.ceil(n / x) === Math.ceil(n / c))) candidats.push(c);
  for (const c of candidats) {
    fichesTv.style.setProperty("--colonnes", colonnesDe(Math.max(1, n), c));
    let echelle = enPortrait() ? 2.6 : 1.4;
    fichesTv.style.setProperty("--echelle", echelle);
    while (echelle > 0.3 && deborde()) {
      echelle -= 0.04;
      fichesTv.style.setProperty("--echelle", echelle.toFixed(2));
    }
    // À échelle égale, la répartition la plus large (essayée en premier) : des fiches moins hautes, plus d'air.
    const note = deborde() ? 0 : echelle;
    if (note > meilleur.echelle + 0.01) meilleur = { echelle: note, colonnes: colonnesDe(Math.max(1, n), c), vraie: echelle };
  }
  fichesTv.style.setProperty("--colonnes", meilleur.colonnes);
  fichesTv.style.setProperty("--echelle", (meilleur.vraie ?? 0.3).toFixed(2));
  if (deborde()) fichesTv.classList.add("defile");
}

// Un écran qu'on redimensionne ou qu'on tourne : tout ce qui est mesuré à l'écran se remesure.
function reajusterVues() {
  ajusterTablee();
  ajusterFiches();
}

export { montrerAventurier, montrerFiches, montrerTablee, reajusterVues };
