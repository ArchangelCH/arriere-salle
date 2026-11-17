// Fiche de séance d'une page A4 : tout ce que le MJ doit avoir sous les yeux, secrets compris (elle ne va pas sur la TV).
// Le texte se resserre jusqu'à tenir sur la page.

import { api, echapper as e } from "../api.js";
import { CHAMPS_PROFIL, RANGS } from "../pnj/tables.js";
import { ETATS_CONTRAT, VERITES } from "../auberge/tables.js";
import { etapeSuivante, horloge } from "./fils.js";
import { VERDICTS } from "../combats/simulation.js";
import { sousLaMain } from "./sous-la-main.js";
import { apercuALEcran } from "../commun/apercu-feuille.js";
import { NOM, TITRE_PRECEDEMMENT } from "../campagne/nom.js";

const page = document.getElementById("page");
const id = new URLSearchParams(location.search).get("id") || "";
const COMBAT = new Set(["sbire", "soldat", "elite", "boss", "heros"]);
const NOMS_ETATS = Object.fromEntries(ETATS_CONTRAT.map(([k, n]) => [k, n.split(",")[0]]));
const NOMS_VERITES = Object.fromEntries(VERITES);

const court = (t, n) => {
  const x = (t || "").replace(/\s+/g, " ").trim();
  return x.length > n ? `${x.slice(0, n - 1).replace(/[\s,;:.]+\S*$/, "")}…` : x;
};
const heureFr = (h) => (h ? h.replace(/^0(\d)/, "$1").replace(":", " h ").replace(/ h 00$/, " h") : "");
const enMinutes = (h) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(h || "");
  return m ? +m[1] * 60 + +m[2] : null;
};

function profil(p) {
  if (!COMBAT.has(p.rang)) return "";
  const rang = RANGS.find((r) => r.cle === p.rang);
  if (!rang) return "";
  const v = { ...rang.profil, ...(p.profil || {}) };
  return `${rang.cle === "heros" ? "Héros" : rang.nom} : ${Object.keys(rang.profil).map((k) => `${CHAMPS_PROFIL[k].toLowerCase()} ${v[k]}`).join(", ")}`;
}

// Le texte part à 10,5 pt et se resserre jusqu'à tenir sur une page A4, sans passer sous 8,5 pt : en dessous, la fiche n'est
// plus lisible à bout de bras. Si elle ne tient pas même à 8,5 pt, elle se répartit sur plusieurs feuilles A4, section par
// section, le texte à 10 pt, et la barre du haut le dit : rien n'est coupé en silence.
const PLANCHER_PT = 8.5;
const SUITE_PT = 10;
const pt = (t) => String(t).replace(".", ",");
const deborde = (feuille) => feuille.scrollHeight > feuille.clientHeight + 1;

// Une feuille de suite : le même cadre, un petit en-tête qui rappelle de quelle séance, le pied de page.
function feuilleDeSuite(modele, numero) {
  const f = document.createElement("main");
  f.className = "page suite";
  f.style.fontSize = `${SUITE_PT}pt`;
  f.innerHTML = `<header class="tete"><div><p class="sur-titre">${modele.querySelector(".sur-titre").innerHTML}</p><h1>${modele.querySelector("h1").innerHTML}</h1></div><p class="quand">page ${numero}</p></header>
    <div class="colonnes"></div>`;
  f.appendChild(modele.querySelector(".pied").cloneNode(true));
  return f;
}

// Les sections réparties sur des feuilles, au texte de taille donnée : celles qui ne tiennent pas passent sur la suivante ; une
// longue liste (les PNJ, les lieux, les affiches...) se coupe entre deux de ses éléments, la suite portant « (suite) » : un
// élément, lui, n'est jamais coupé.
function repartirA(sections, taille) {
  document.querySelectorAll(".page.suite").forEach((f) => f.remove());
  page.style.fontSize = `${taille}pt`;
  const feuilles = [page];
  page.querySelector(".colonnes").innerHTML = "";
  const courante = () => feuilles[feuilles.length - 1];
  const colonnesDe = () => courante().querySelector(".colonnes");
  const nouvelleFeuille = () => {
    const f = feuilleDeSuite(page, feuilles.length + 1);
    f.style.fontSize = `${taille}pt`;
    courante().after(f);
    feuilles.push(f);
  };
  const liste = (section) => {
    const l = section.querySelector(":scope > .pnj, :scope > ul.liste, :scope > ul.fils, :scope > ul.cases");
    return l && l.children.length > 1 ? l : null;
  };
  const poser = (section) => {
    colonnesDe().appendChild(section);
    if (!deborde(courante())) return;
    colonnesDe().removeChild(section);
    const l = liste(section);
    if (l) {
      // Autant d'éléments que la feuille en porte, le reste dans une section de suite.
      const elements = Array.prototype.slice.call(l.children);
      const tete = section.cloneNode(false);
      const titre = section.querySelector("h2");
      if (titre) tete.appendChild(titre.cloneNode(true));
      const conteneur = l.cloneNode(false);
      tete.appendChild(conteneur);
      colonnesDe().appendChild(tete);
      let gardes = 0;
      for (const el of elements) {
        conteneur.appendChild(el);
        if (deborde(courante())) {
          conteneur.removeChild(el);
          break;
        }
        gardes++;
      }
      if (gardes === 0) colonnesDe().removeChild(tete);
      if (gardes < elements.length) {
        nouvelleFeuille();
        const suite = section.cloneNode(false);
        if (titre) {
          const h = titre.cloneNode(true);
          h.textContent = `${titre.textContent} (suite)`;
          suite.appendChild(h);
        }
        const reste = l.cloneNode(false);
        for (const el of elements.slice(gardes)) reste.appendChild(el);
        suite.appendChild(reste);
        if (gardes === 0 && colonnesDe().children.length === 0) {
          // Rien de ce titre ne tenait : il reprend, sans « (suite) », en haut de la nouvelle feuille.
          if (titre) suite.querySelector("h2").textContent = titre.textContent;
        }
        poser(suite);
      }
      return;
    }
    if (colonnesDe().children.length > 0) nouvelleFeuille();
    colonnesDe().appendChild(section);
  };
  for (const modele of sections) poser(modele.cloneNode(true)); // chaque essai part de sections intactes
  return feuilles.length;
}

// Le moins de feuilles possible, puis le texte le plus grand : de 10 à 8,5 pt, on garde la taille qui en demande le moins.
function repartir(zoneTaille) {
  const sections = Array.prototype.slice.call(page.querySelector(".colonnes").children).map((x) => x.cloneNode(true));
  let meilleur = { feuilles: Infinity, taille: SUITE_PT };
  for (let taille = SUITE_PT; taille >= PLANCHER_PT; taille -= 0.5) {
    const feuilles = repartirA(sections, taille);
    if (feuilles < meilleur.feuilles) meilleur = { feuilles, taille };
  }
  repartirA(sections, meilleur.taille);
  zoneTaille.classList.add("avis");
  zoneTaille.textContent = `Trop de contenu pour une page lisible : la fiche s'imprime sur ${meilleur.feuilles} feuilles A4 (texte en ${pt(meilleur.taille)} pt), aucune coupée.`;
}

function ajusterALaPage(zoneTaille) {
  page.style.zoom = ""; // mesurée à sa taille de papier, jamais réduite pour l'écran
  document.querySelectorAll(".page.suite").forEach((f) => f.remove());
  let taille = 10.5;
  page.style.fontSize = `${taille}pt`;
  while (deborde(page) && taille > PLANCHER_PT) {
    taille -= 0.25;
    page.style.fontSize = `${taille}pt`;
  }
  zoneTaille.classList.remove("avis");
  if (!deborde(page)) zoneTaille.textContent = taille < 10.5 ? `Texte en ${pt(taille)} pt pour tenir sur une page A4.` : "Tient sur une page A4.";
  else repartir(zoneTaille);
  majApercu();
}

async function construire() {
  if (!id) throw new Error("aucune séance demandée");
  const [s, seances, pnj, lieux, contrats, rumeurs, fils, campagne, rencontres, plans] = await Promise.all(
    [`/api/seances/${encodeURIComponent(id)}`, "/api/seances", "/api/pnj", "/api/lieux", "/api/contrats", "/api/rumeurs", "/api/fils", "/api/campagne", "/api/rencontres", "/api/plans"].map((u) => api.get(u)),
  );
  document.title = `Séance ${s.numero ?? ""} · fiche`;
  document.querySelector(".retour").href = `/#/seances/${s.id}`;
  const prec = seances.filter((x) => (x.numero || 0) < (s.numero || 0) && x.close && (x.precedemment || "").trim()).sort((a, b) => a.numero - b.numero).pop();
  const trouver = (liste, ids) => (ids || []).map((x) => liste.find((y) => y.id === x)).filter(Boolean);
  // « Sous la main » et ce que lient les scènes, dans l'ordre du déroulé (sous-la-main.js).
  const sous = sousLaMain(s, { pnj, lieux, rencontres, plans });
  const lesPnj = sous.pnj.map((x) => x.fiche);
  const lesLieux = sous.lieux.map((x) => x.fiche);
  const lesContrats = trouver(contrats, s.contrats);
  const lesRumeurs = trouver(rumeurs, s.rumeurs);
  const lesRencontres = sous.rencontres.map((x) => x.fiche);
  const lesFils = fils.filter((f) => f.actif !== false);
  const questions = (s.questions || "").split("\n").map((q) => q.trim()).filter(Boolean);
  const tablee = (campagne.tablee || []).filter((j) => j.actif !== false);
  const total = (s.deroule || []).reduce((t, d) => t + (+d.duree || 0), 0);
  const debut = enMinutes((s.deroule || [])[0]?.heure || s.heure);
  const date = s.date ? new Date(`${s.date}T12:00`).toLocaleDateString("fr-CH", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "Date à fixer";

  page.innerHTML = `
    <header class="tete">
      <div>
        <p class="sur-titre">Séance ${s.numero ?? ""}${s.scenario ? ` · ${e(s.scenario)}` : ""}</p>
        <h1>${e(s.nom || "Séance")}</h1>
      </div>
      <p class="quand">${e(date)}${s.heure ? `<br>${e(heureFr(s.heure))}` : ""}${campagne.niveau ? `<br>groupe niveau ${campagne.niveau}` : ""}</p>
    </header>
    <div class="colonnes">
        ${prec ? `<section class="encadre"><h2>À lire en ouvrant la séance</h2><p><i>${e(TITRE_PRECEDEMMENT)}…</i> ${e(prec.precedemment.trim())}</p></section>` : ""}
        ${s.objectif ? `<section><h2>Objectif</h2><p class="objectif">${e(s.objectif)}</p></section>` : ""}
        ${(s.deroule || []).length ? `
        <section>
          <h2>Déroulé</h2>
          <table class="deroule">
            ${s.deroule.map((d) => `
              <tr>
                <td class="h">${e(heureFr(d.heure))}</td>
                <td><b>${e(d.titre || "")}</b>${d.note ? `<span class="note">${e(d.note)}</span>` : ""}</td>
                <td class="d">${d.duree ? `${d.duree} min` : ""}</td>
              </tr>`).join("")}
          </table>
          ${total ? `<p class="total">Durée prévue : ${Math.floor(total / 60)} h${total % 60 ? ` ${String(total % 60).padStart(2, "0")}` : ""}${debut !== null ? `, fin vers ${heureFr(`${String(Math.floor((debut + total) / 60) % 24).padStart(2, "0")}:${String((debut + total) % 60).padStart(2, "0")}`)}` : ""}.</p>` : ""}
        </section>` : ""}
        ${s.conseils ? `<section><h2>En retard ?</h2><p>${e(s.conseils)}</p></section>` : ""}
        ${s.fin ? `<section><h2>Pour finir</h2><p>${e(s.fin)}</p></section>` : ""}
        ${questions.length ? `<section><h2>À trancher en fin de séance</h2><ul class="cases">${questions.map((q) => `<li>${e(q)}</li>`).join("")}</ul></section>` : ""}
        ${lesPnj.length ? `
        <section>
          <h2>PNJ</h2>
          <div class="pnj">${lesPnj.map((p) => `
            <div class="p">
              <p class="qui"><b>${e(p.nom)}</b>${p.role ? `, ${e(p.role)}` : ""}${p.connu ? "" : ' <span class="marque-secret">secret</span>'}</p>
              ${p.voix ? `<p><span>Jouer</span>${e(court(p.voix, 120))}</p>` : ""}
              ${p.envie ? `<p><span>Veut</span>${e(court(p.envie, 110))}</p>` : ""}
              ${p.secret ? `<p class="secret"><span>Cache</span>${e(court(p.secret, 140))}</p>` : ""}
              ${profil(p) ? `<p class="combat">${e(profil(p))}</p>` : ""}
            </div>`).join("")}
          </div>
        </section>` : ""}
        ${lesLieux.length ? `<section><h2>Lieux</h2><ul class="liste">${lesLieux.map((l) => `<li><b>${e(l.nom)}</b>${l.secrets || l.resume ? ` : ${e(court(l.secrets || l.resume, 150))}` : ""}</li>`).join("")}</ul></section>` : ""}
        ${lesContrats.length ? `<section><h2>Affiches</h2><ul class="liste">${lesContrats.map((c) => `<li><b>${e(c.nom)}</b> <i>(${e((NOMS_ETATS[c.etat] || "brouillon").toLowerCase())})</i>${c.verite ? ` : ${e(court(c.verite, 170))}` : ""}</li>`).join("")}</ul></section>` : ""}
        ${lesRencontres.length ? `<section><h2>Rencontres</h2><ul class="liste">${lesRencontres.map((r) => `<li><b>${e(r.nom || "Rencontre")}</b> : ${e((r.adversaires || []).filter((a) => a.n > 0).map((a) => `${a.n} × ${a.nom}`).join(", "))}${r.verdict ? ` <i>(${e(VERDICTS[r.verdict.cle]?.nom.toLowerCase() || "")}, victoire ${Math.round(r.verdict.victoire * 100)} %, ${String(r.verdict.auTapis.toFixed(1)).replace(".", ",")} au tapis)</i>` : ""}</li>`).join("")}</ul></section>` : ""}
        ${lesRumeurs.length ? `<section><h2>Rumeurs à placer</h2><ul class="liste">${lesRumeurs.map((r) => `<li>« ${e(court(r.texte, 140))} »${r.verite ? ` <i>${e(NOMS_VERITES[r.verite].toLowerCase())}</i>` : ""}</li>`).join("")}</ul></section>` : ""}
        ${lesFils.length ? `
        <section>
          <h2>Les fils</h2>
          <ul class="fils">${lesFils.map((f) => {
            const suivante = etapeSuivante(f);
            return `<li>${horloge((f.etapes || []).length, f.avance || 0, 22)}<span><b>${e(f.nom)}</b>${suivante ? ` Ensuite : ${e(court(suivante.texte, 110))}` : " Arrivé au bout."}</span></li>`;
          }).join("")}</ul>
        </section>` : ""}
        ${tablee.length ? `<section><h2>La tablée</h2><p class="tablee">${tablee.map((j) => `${e(j.joueur || "?")}${j.personnage ? ` <i>${e(j.personnage)}</i>` : ""}`).join(" · ")}</p></section>` : ""}
        ${s.notes ? `<section><h2>Notes</h2><p>${e(s.notes)}</p></section>` : ""}
    </div>
    <footer class="pied"><span>Terminez la séance sur une question, jamais sur une réponse.</span><span>${NOM === "L'Arrière-salle" ? e(NOM) : `${e(NOM)} · L'Arrière-salle`}</span></footer>`;
  await document.fonts.ready;
  ajusterALaPage(document.querySelector(".taille"));
}

// Sur un petit écran, la feuille se réduit à la largeur (l'impression reste en A4) ; la page se remesure alors.
const majApercu = apercuALEcran(".page", 210);

document.querySelector('[data-action="imprimer"]').addEventListener("click", () => window.print());

construire().catch((err) => {
  page.innerHTML = `<p class="chargement">Impossible de préparer la fiche : ${e(err.message)}.</p>`;
});
