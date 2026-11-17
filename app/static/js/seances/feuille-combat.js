// Feuille de combat à imprimer : un encadré par rencontre de la séance, une ligne par adversaire avec son profil et une
// rangée de cases de Santé à cocher. Pour le MJ seulement (elle ne va pas sur la TV). Les rencontres sont celles que lient
// les scènes, dans l'ordre du déroulé, puis celles de « Sous la main » (sous-la-main.js). Les profils sont ceux de la
// rencontre, tels que la balance les a pesés, complétés par le bestiaire ; les numéros sont ceux des pions du plan (celui
// de la scène qui lie la rencontre, que montrera la TV, sinon celui de son lieu qui porte ses adversaires : planDesNumeros).

import { api, echapper as e } from "../api.js";
import { NOMS_RANGS } from "../combats/bestiaire.js";
import { groupes } from "../combats/rencontre.js";
import { planDesNumeros } from "../combats/plan-de-scene.js";
import { VERDICTS } from "../combats/simulation.js";
import { apercuALEcran } from "../commun/apercu-feuille.js";
import { sousLaMain } from "./sous-la-main.js";
import { NOM } from "../campagne/nom.js";

const page = document.getElementById("page");
const id = new URLSearchParams(location.search).get("id") || "";
// Qui joue avant les adversaires, selon la situation choisie dans la balance (aide-mémoire du kit).
const ORDRES = [
  "les adversaires d'abord (embuscade), puis tout le groupe",
  "1 aventurier, puis les adversaires, puis le reste du groupe",
  "2 aventuriers, puis les adversaires, puis le reste du groupe",
  "3 aventuriers ou plus, puis les adversaires, puis le reste du groupe",
];
// Au-delà, des cases ne servent plus : on compte à la main.
const CASES_MAX = 40;
const A4 = (297 / 25.4) * 96;

const virgule = (x, d = 1) => x.toFixed(d).replace(".", ",");
const heureFr = (h) => (h ? h.replace(/^0(\d)/, "$1").replace(":", " h ").replace(/ h 00$/, " h") : "");

const nomNumerote = (g) => `${g.a.nom}${g.membres.some((m) => m.numero) ? ` ${g.membres.map((m) => m.numero || "?").join(", ")}` : ""}`;

// Le moral, comme dans la simulation : les sbires fuient quand la moitié d'entre eux tombe ; les sans-peur restent.
function moral(r, liste) {
  const peureux = liste.filter((g) => g.a.rang === "sbire" && !g.a.sansPeur);
  const n = peureux.reduce((t, g) => t + g.membres.length, 0);
  if (n < 2) return "";
  if (r.moral === false) return "Les sbires ne fuient pas à la moitié dans ce combat.";
  const seuil = Math.ceil(n / 2);
  return `Fuient à la moitié : ${peureux.map(nomNumerote).join(" ; ")}, dès que ${seuil === 1 ? "l'un d'eux tombe" : `${seuil} d'entre eux sont tombés`}.`;
}

function verdict(v) {
  if (!v || !VERDICTS[v.cle]) return "Pas encore pesée : ouvrez-la dans Combats.";
  const pesee = v.nbPj ? `, pesée pour ${v.nbPj} aventurier${v.nbPj > 1 ? "s" : ""}${v.niveau ? `, niveau ${v.niveau}` : ""}` : "";
  return `<b>${e(VERDICTS[v.cle].nom)}</b> : victoire ${Math.round(v.victoire * 100)} %, ${virgule(+v.auTapis || 0)} au tapis en moyenne${e(pesee)}.`;
}

// Une case par point de Santé, par paquets de cinq pour compter d'un coup d'œil.
function cases(n) {
  if (n > CASES_MAX) return '<span class="a-compter" aria-hidden="true"></span>';
  const paquets = [];
  for (let k = 0; k < n; k += 5) paquets.push(`<span class="paquet">${"<i></i>".repeat(Math.min(5, n - k))}</span>`);
  return paquets.join("");
}

function htmlGroupe(g) {
  const a = g.a;
  const attaque = `${+a.att || 0} %${(+a.attaques || 1) > 1 ? ` ×${+a.attaques}` : ""}`;
  const defense = +a.nbDef ? `${+a.nbDef} × ${+a.defense || 0} %` : "aucune";
  const max = `${g.sante}${g.parPJ ? `<small>${g.parPJ} par aventurier</small>` : ""}`;
  const rang = NOMS_RANGS[a.rang] || "";
  const nb = g.membres.length;
  return `
    <tbody class="groupe">
      ${g.membres.map((m, k) => `
      <tr class="combattant">
        <td class="qui"><b>${e(a.nom)}</b>${m.numero ? ` <span class="pion">${e(m.numero)}</span>` : ""}</td>
        ${k ? "" : `
        <td class="val" rowspan="${nb}">${e(attaque)}</td>
        <td class="val" rowspan="${nb}">${e(a.degats || "")}${a.ignoreArmure ? "<small>ignore l'armure</small>" : ""}</td>
        <td class="val" rowspan="${nb}">${+a.armure || 0}${+a.bouclier ? `<small>+${+a.bouclier} en défensive</small>` : ""}</td>
        <td class="val" rowspan="${nb}">${e(defense)}</td>`}
        <td class="sante"><div class="jauge"><span class="max">${max}</span><span class="cases-sante">${cases(g.sante)}</span></div></td>
      </tr>`).join("")}
      ${rang || a.capacites ? `<tr class="capacites"><td colspan="6">${rang ? `<span class="rang">${e(rang)}</span>` : ""}${e(a.capacites || "")}</td></tr>` : ""}
    </tbody>`;
}

// Au-dessus du nom : la scène qui lie la rencontre (son heure et son titre), ou « Sous la main ».
function htmlScenes(seance, scenes) {
  const d = seance?.deroule || [];
  const vues = scenes.filter((i) => d[i]).map((i) => [heureFr(d[i].heure), (d[i].titre || "").trim() || `Scène ${i + 1}`].filter(Boolean).join(" · "));
  return `<p class="scene-rencontre">${e(vues.length ? vues.join(" ; ") : "Sous la main")}</p>`;
}

function htmlRencontre(r, plans, nbPjTablee, niveauCampagne, seance, scenes = []) {
  const nbPj = +r.verdict?.nbPj || nbPjTablee;
  const niveau = +r.verdict?.niveau || niveauCampagne;
  const plan = planDesNumeros(seance, r, plans);
  const liste = groupes(r, plan, nbPj, niveau);
  const regle = moral(r, liste);
  const ordre = ORDRES[Math.min(3, Math.max(0, Math.round(+r.avant || 0)))];
  return `
    <section class="rencontre">
      <header class="tete-rencontre">
        ${htmlScenes(seance, scenes)}
        <h2>${e(r.nom || "Rencontre")}</h2>
        ${plan && liste.some((g) => g.depuisPlan) ? `<p class="plan">Numéros des pions du plan ${e(plan.nom || "")}</p>` : ""}
      </header>
      <p class="ordre"><span>Ordre de jeu</span>${e(ordre)}. Même ordre à chaque tour.</p>
      ${liste.length ? `
      <table class="adversaires">
        <thead><tr><th class="qui">Adversaire</th><th title="Attaque, en %">Att.</th><th>Dég.</th><th>Arm.</th><th title="Défenses par tour, et leur valeur en %">Déf.</th><th class="sante">Santé</th></tr></thead>
        ${liste.map(htmlGroupe).join("")}
      </table>` : '<p class="vide">Aucun adversaire dans cette rencontre.</p>'}
      ${(r.notes || "").trim() ? `<p class="notes"><span>Notes</span>${e(r.notes.trim())}</p>` : ""}
      <footer class="pied-rencontre">
        <p>${verdict(r.verdict)}</p>
        ${regle ? `<p class="moral">${e(regle)}</p>` : ""}
      </footer>
    </section>`;
}

async function construire() {
  if (!id) throw new Error("aucune séance demandée");
  const [s, rencontres, plans, campagne] = await Promise.all(
    [`/api/seances/${encodeURIComponent(id)}`, "/api/rencontres", "/api/plans", "/api/campagne"].map((u) => api.get(u)),
  );
  document.title = `Séance ${s.numero ?? ""} · feuille de combat`;
  document.querySelector(".retour").href = `/#/seances/${encodeURIComponent(s.id)}`;
  // Les rencontres liées aux scènes, dans l'ordre du déroulé, puis celles qui ne sont que « Sous la main ».
  const lesRencontres = sousLaMain(s, { rencontres, plans }).rencontres;
  const nbPj = (campagne.tablee || []).filter((j) => j.actif !== false).length || 3;
  const niveau = +campagne.niveau || 1;
  const date = s.date ? new Date(`${s.date}T12:00`).toLocaleDateString("fr-CH", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "Date à fixer";

  page.innerHTML = `
    <header class="tete">
      <div>
        <p class="sur-titre">Séance ${s.numero ?? ""}${s.nom ? ` · ${e(s.nom)}` : ""}</p>
        <h1>Feuille de combat</h1>
      </div>
      <p class="quand">${e(date)}${s.heure ? `<br>${e(heureFr(s.heure))}` : ""}<br>groupe niveau ${niveau}</p>
    </header>
    ${lesRencontres.length ? lesRencontres.map((x) => htmlRencontre(x.fiche, plans, nbPj, niveau, s, x.scenes)).join("") : `
    <p class="aucune">Aucune rencontre n'est liée à cette séance. Dans <a href="/#/seances/${e(encodeURIComponent(s.id))}">Préparer</a>, liez-en une à une scène (« Lier »), ou ajoutez-la sous « Sous la main », puis rouvrez cette feuille.</p>`}
    <footer class="pied"><span>À 0 Santé ou moins : au tapis. Critique : ni esquive ni parade, dégâts au maximum. La table traîne : le monstre rejoue.</span><span>${NOM === "L'Arrière-salle" ? e(NOM) : `${e(NOM)} · L'Arrière-salle`}</span></footer>`;
  await document.fonts.ready;
  apercuALEcran(".page", 210); // petit écran : la feuille se réduit à sa largeur, l'impression reste en A4
  document.querySelector(".taille").textContent = !lesRencontres.length
    ? ""
    : page.offsetHeight <= A4 + 1
      ? "Tient sur une page A4."
      : "Plus d'une page A4 : aucune rencontre n'est coupée entre deux pages.";
}

document.querySelector('[data-action="imprimer"]').addEventListener("click", () => window.print());

construire().catch((err) => {
  page.innerHTML = `<p class="chargement">Impossible de préparer la feuille : ${e(err.message)}.</p>`;
});
