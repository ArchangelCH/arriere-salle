// La fiche imprimée d'un aventurier (ou de toute la tablée) : le recto du kit rempli,
// et au verso l'histoire écrite sur les lignes, la progression et le carnet de campagne.

import { api, echapper as e } from "../api.js";
import { svgEmbleme, fondMedaillon } from "./embleme.js";
import { lisible } from "./etat.js";
import * as R from "./regles.js";
import { NOM } from "../campagne/nom.js";

const LETTRES = NOM.toUpperCase();
const MARQUE = `<svg class="marque" viewBox="0 0 1000 170" xmlns="http://www.w3.org/2000/svg" aria-label="${e(NOM)}"><defs>`
  + '<linearGradient id="av-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf7ee"/><stop offset=".38" stop-color="#c9c1b3"/>'
  + '<stop offset=".52" stop-color="#7d746a"/><stop offset=".62" stop-color="#a39a8d"/><stop offset="1" stop-color="#e8e1d4"/></linearGradient>'
  + '<filter id="av-ombre" x="-5%" y="-20%" width="110%" height="150%"><feDropShadow dx="0" dy="4" stdDeviation="3.5" flood-color="#2b1d12" flood-opacity=".55"/></filter></defs>'
  + '<text x="500" y="132" text-anchor="middle" font-family="Cinzel" font-weight="900" font-size="118" letter-spacing="3" fill="url(#av-metal)" stroke="#2b1d12" stroke-width="4.5" paint-order="stroke" filter="url(#av-ombre)"'
  // Un nom long se resserre pour tenir dans la largeur du logo (comme commun/nom_campagne.py).
  + (LETTRES.length > 10 ? ' textLength="900" lengthAdjust="spacingAndGlyphs"' : '') + '>'
  + (LETTRES.length < 3 ? e(LETTRES) : `<tspan font-size="150">${e(LETTRES[0])}</tspan>${e(LETTRES.slice(1, -1))}<tspan font-size="150">${e(LETTRES[LETTRES.length - 1])}</tspan>`)
  + '</text></svg>';

const DEFENSES = { offensive: "aucune défense", defensive: "une défense (esquive, parade ou protéger un allié)", focus: "aucune défense, +5 % à tous les tests" };
// En dessous, le texte deviendrait illisible : une fiche qui déborde encore à 72 % le dit.
const PLANCHER = 0.72;

const dizaine = (v) => {
  const s = String(v ?? "");
  return s.length > 1 ? `<span class="dizaine">${e(s.slice(0, -1))}</span>${e(s.slice(-1))}` : e(s);
};
const cases = (n) => Array.from({ length: Math.max(0, n) }, (_, i) => `<span class="c">${i + 1}</span>`).join("");
const lignes = (n) => "<i></i>".repeat(n);
const phrase = (t) => {
  const x = (t || "").trim();
  return x && !/[.!?…»]$/.test(x) ? `${x}.` : x;
};
const prenom = (a) => (a.nom || "").split(/[\s,]+/)[0] || "votre aventurier";

function recto(a, n) {
  const posture = R.POSTURES.find((p) => p.cle === a.posture);
  const comps = (a.competences || []).filter((c) => (c.nom || "").trim());
  const armes = (a.armes || []).filter((w) => (w.nom || "").trim());
  const indice = +a.protection?.indice || 0;
  const bouclier = a.bouclier ? 2 : 0;
  const vocations = (a.vocations || []).map((v) => R.vocationAccordee(v, a.genre)).join(" et ");
  const meta = [
    ["Peuple", R.titre({ ...a, specialite: "", vocations: [] })],
    ["Vocation", vocations],
    ["Élément", a.element],
    ["Thèmes", (a.themes || []).filter(Boolean).join(", ")],
    ["Langues", a.langues],
  ].filter(([, v]) => (v || "").trim());
  const dons = (a.dons || []).map(R.lireDon);
  // L'équipement avec ses quantités (« Potion de soins ×3 », le compte tenu à son nom), puis les objets personnels.
  const equipement = [...(a.equipement || []).map(lisible), ...(a.objets || [])].filter((x) => (x || "").trim());
  if (a.or !== null && a.or !== undefined && a.or !== "") equipement.push(`${a.or} pièces d'or`);
  equipement.push("Le sac de l'aventurier : couverture, gourde, briquet, corde, torche, vivres");
  const conseils = (a.conseils || []).length ? a.conseils : R.conseilsAuto(a);
  const extra = [["Je ne ferai jamais", a.jamais], ["Mon défaut", a.defaut], ["Mon lien avec le groupe", a.lien]].filter(([, v]) => (v || "").trim());
  const histoire = (a.histoire || "").trim() || [a.avant, a.pourquoi].map(phrase).filter(Boolean).join(" ");
  const [clair, milieu, sombre] = R.teintes(a);
  const gene = R.armureConnue(a.protection?.nom)?.gene;
  // Coma à 0 ; la mort à moins la Santé maximum, jamais avant −10 (livret, chapitre 06).
  const mort = Math.max(+a.sante || 0, 10);
  return `
  <section class="feuille perso" data-nom="${e(a.nom || "Sans nom")}" data-face="recto">
    <div class="haut">
      <div>
        ${MARQUE}
        <div class="source">${a.source ? R.accord("{Aventurier prêt|Aventurière prête} à jouer", a) : "Fiche d'aventurier"}</div>
        ${histoire ? `<p class="histoire">${e(histoire)}</p>` : ""}
        <div class="meta">${meta.map(([k, v]) => `<div><b>${k}</b> : ${e(v)}</div>`).join("")}</div>
      </div>
      <div>
        <div class="portrait" style="background: radial-gradient(circle at 50% 42%, ${clair} 0%, ${milieu} 48%, ${sombre} 100%)">
          ${a.illustration ? `<img src="${e(a.illustration)}" alt="">` : svgEmbleme(a.element)}
          <span class="p-niveau">Niveau ${e(a.niveau || 1)}</span><span class="p-psy">Psy : ${e(a.psy)}</span><span class="p-sante">Santé : ${e(a.sante)}</span>
        </div>
        <div class="nom${(a.nom || "").length > 22 ? " long" : ""}">${e(a.nom || "")}</div>
        <div class="titre">${e(R.titre(a))}</div>
      </div>
    </div>
    <div class="stats">${R.CARACS.map((c) => `
      <div><span class="lbl-c">${c.nom}</span><span class="val">${dizaine(a[c.cle])} <small>%</small></span>
      <span class="cartons">cartons <span class="case jaune"></span><span class="case rouge"></span></span></div>`).join("")}
    </div>
    <div class="corps">
      <div class="col">
        <h2>Compétences</h2>
        <table><tr><th>Compétence</th><th class="n">Bonus</th><th class="n">Avec</th><th class="n">Valeur</th></tr>
          ${comps.map((c) => `<tr><td>${e(c.nom)}</td><td class="n">+${e(c.bonus)}</td><td class="n doux">${e(c.avec || R.competenceConnue(c.nom)?.avec || "Physique")}</td><td class="n"><b>${R.valeurCompetence(a, c)} %</b></td></tr>`).join("")}
        </table>
        ${armes.length ? `<h2>Armes</h2>
        <table><tr><th>Arme</th><th class="n">Valeur</th><th class="n">Dégâts</th><th>Notes</th></tr>
          ${armes.map((w) => `<tr><td>${e(w.nom)}</td><td class="n"><b>${R.valeurArme(a, w)} %</b></td><td class="n">${e(w.degats || "–")}</td><td class="petit">${e(w.notes || "")}</td></tr>`).join("")}
        </table>` : ""}
        <div class="protection">
          <div><span class="lbl">Armure</span> ${e(a.protection?.nom || "aucune")}, indice <b>${indice}</b>${bouclier ? ` · bouclier <b>+${bouclier}</b>` : ""}${gene ? ` · gêne : ${e(gene)}` : ""}</div>
          ${posture ? `<div><span class="lbl">Posture de base</span> <b>${e(posture.nom)}</b> : ${DEFENSES[posture.cle]} par tour${bouclier && posture.cle === "defensive" ? `, armure ${indice + bouclier} avec le bouclier` : ""}.</div>` : ""}
        </div>
        <div class="jauges">
          <div><div class="jt"><b>Santé</b><span>${e(a.sante)}</span></div><div class="rangee">${cases(+a.sante || 0)}</div><p class="note-j facultatif" data-cede="2">0 : coma · −${mort} : mort</p></div>
          <div><div class="jt"><b>Psy</b><span>${e(a.psy)}</span></div><div class="rangee">${cases(+a.psy || 0)}</div><p class="note-j facultatif" data-cede="2">une nuit : +1D6</p></div>
        </div>
        <div class="jetons facultatif" data-cede="1"><span class="rond">avan-<br>tage</span><span class="rond">désa-<br>vantage</span><p class="note-j">un seul jeton à la fois ; un avantage et un désavantage s'annulent</p></div>
        <h2>Équipements</h2>
        <ul>${equipement.map((x) => `<li>${e(x)}</li>`).join("")}</ul>
        <div class="notes"><span class="lbl">Notes</span><div class="lignes">${lignes(30)}</div></div>
      </div>
      <div class="col">
        <h2>Dons</h2>
        ${dons.map((d) => `<p class="don"><b>${e(d.nom)}</b><span class="cout">${e(d.cout)}</span>${e(d.effet)}</p>`).join("")}
        ${a.posture_elementaire ? `<p class="don"><b>Posture élémentaire</b><span class="cout">1 dé</span>${e(phrase(a.posture_elementaire))} +10 % à tous les tests jusqu'à la fin du combat ; sans dé d'aventure, elle coûte 3 Psy.</p>` : ""}
        ${(a.particularites || "").trim() ? `<h2>Particularités</h2><p>${e(a.particularites)}</p>` : ""}
        ${extra.map(([t, v]) => `<p><span class="lbl">${t}</span><br>${e(v)}</p>`).join("")}
        ${conseils.length ? `<div class="encart"><div class="titre-encart">Pour bien jouer ${e(prenom(a))}</div><ul>${conseils.map((c) => `<li>${e(c)}</li>`).join("")}</ul></div>` : ""}
      </div>
    </div>
    <div class="pied"><span>Test : D100 égal ou inférieur à la valeur. <b>01-05</b> réussite critique, <b>96-100</b> échec critique. Plus de Psy ? Le reste se paie en Santé.</span></div>
    <img class="sang" src="/static/img/kit/sang-${(n % 3) + 1}.svg" alt="">
  </section>`;
}

function verso(a) {
  const q = (titre, texte, large = false) => `<div class="q${large ? " large" : ""}"><span class="lbl">${titre}</span><p class="reponse">${e(texte || "")}</p></div>`;
  // « Non », « aucun » : le joueur a répondu qu'il n'avait pas de lien, ce n'est pas un nom.
  const libre = /^(non|aucun|aucune|personne|rien|-+)$/i.test((a.lien_avec_nom || "").trim()) ? "" : a.lien_avec_nom;
  const avec = (a.lien_avec && verso.tous?.find((x) => x.id === a.lien_avec)?.nom) || libre || "";
  const lien = [avec && !(a.lien || "").includes(avec.split(/[\s,]+/)[0]) ? `Avec ${avec} :` : "", a.lien].filter(Boolean).join(" ");
  const progression = a.progression || [];
  return `
  <section class="feuille perso verso" data-nom="${e(a.nom || "Sans nom")}" data-face="verso">
    <div class="haut-verso">${MARQUE}<div class="source">Histoire et carnet${a.nom ? ` · ${e(a.nom)}` : ""}${a.joueur ? ` · ${R.accord("{joué|jouée}", a)} par ${e(a.joueur)}` : ""}</div></div>
    <div class="deux">
      ${q("Qui étiez-vous avant ?", a.avant || (!a.pourquoi ? a.histoire : ""))}
      ${q(R.accord("Pourquoi être devenu{|e} aventuri{er|ère} ?", a), a.pourquoi)}
      ${q("Ce que vous ne ferez jamais", a.jamais)}
      ${q("Allure et défaut visible", [phrase(a.allure), phrase(a.defaut)].filter(Boolean).join(" "))}
      ${q("Liens avec le groupe", lien)}
      ${q("Contacts, dettes et ennemis", a.contacts)}
    </div>
    ${progression.length ? `
    <div class="progression"><h2>Progression</h2>
      <table><tr><th class="n">Niv.</th><th>Date</th><th>Ce qui a changé</th></tr>
        ${progression.map((p) => `<tr><td class="n">${e(p.niveau)}</td><td>${e(new Date(p.date).toLocaleDateString("fr-CH"))}</td><td>${e(p.texte)}</td></tr>`).join("")}
      </table></div>` : ""}
    <div class="journal"><h2>Carnet de campagne</h2><div class="lignes">${lignes(40)}</div></div>
    <img class="sang" src="/static/img/kit/sang-3.svg" alt="">
  </section>`;
}

// Les familiers de l'aventurier : une page chacun, après le verso (et seulement avec lui). Sans image au coin des joueurs,
// qui n'a pas la médiathèque : l'image qui ne charge pas s'efface (rendre()).
function pagesFamiliers(a) {
  const q = (titre, texte, large = false) => `<div class="q${large ? " large" : ""}"><span class="lbl">${titre}</span><p class="reponse">${e(texte || "")}</p></div>`;
  return (Array.isArray(a.familiers) ? a.familiers : []).filter((f) => f && Object.values(f).some((v) => typeof v === "string" && v.trim())).map((f) => {
    const nature = [f.espece, f.element, f.taille].map((x) => (x || "").trim()).filter(Boolean).join(" · ");
    const image = /^\/media\/[A-Za-z0-9._-]+$/.test(f.image || "") ? `<p class="fam-image"><img src="${e(f.image)}" alt=""></p>` : "";
    return `
  <section class="feuille perso verso" data-nom="${e(a.nom || "Sans nom")}" data-face="familier">
    <div class="haut-verso">${MARQUE}<div class="source">Familier${f.nom ? ` · ${e(f.nom)}` : ""}${a.nom ? ` · ${e(R.accord("{lié|liée}", a))} à ${e(a.nom)}` : ""}</div></div>
    ${image}
    <div class="deux">
      ${q("Nom", f.nom)}
      ${q("Ce qu'il est", nature)}
      ${q("Aspect, signes distinctifs", f.aspect, true)}
      ${q("Humeurs", f.humeurs, true)}
      ${q("Caractère", f.caractere)}
      ${q("Lien avec " + (prenom(a) || "son aventurier"), f.lien)}
      ${q("Ce qu'il fait en jeu", f.regles, true)}
    </div>
    <div class="journal"><h2>Notes</h2><div class="lignes">${lignes(14)}</div></div>
    <img class="sang" src="/static/img/kit/sang-3.svg" alt="">
  </section>`;
  }).join("");
}

// Une face doit tenir sur sa page A4. Quand elle déborde, les rappels facultatifs cèdent d'abord leur place, dans
// l'ordre de data-cede (les jetons, puis les notes des jauges) ; ensuite le texte variable rapetisse d'un cran, jusqu'au
// plancher. On mesure après coup si elle tient vraiment : { k, deborde, sansRappels }.
function resserrer(feuille) {
  const deborde = () => [...feuille.querySelectorAll(".col, .deux")].some((c) => c.scrollHeight > c.clientHeight + 1) || feuille.scrollHeight > feuille.clientHeight + 1;
  const rappels = [...feuille.querySelectorAll(".facultatif")];
  let k = 1;
  feuille.style.setProperty("--k", k);
  for (const x of rappels) x.hidden = false;
  let sansRappels = false;
  for (const rang of [...new Set(rappels.map((x) => x.dataset.cede))].sort()) {
    if (!deborde()) break;
    for (const x of rappels) if (x.dataset.cede === rang) x.hidden = true;
    sansRappels = true;
  }
  while (deborde() && k > PLANCHER) {
    k = Math.max(PLANCHER, Math.round((k - 0.03) * 100) / 100);
    feuille.style.setProperty("--k", k);
  }
  const reste = deborde();
  feuille.classList.toggle("deborde", reste);
  return { k, deborde: reste, sansRappels };
}

// Ce que la page dit de la mise en page, sans jamais prétendre qu'une face tient quand elle ne tient pas.
function bilanMiseEnPage(resultats) {
  const qui = (liste) => liste.map((r) => `${r.nom} (${r.face})`).join(", ");
  const debordent = resultats.filter((r) => r.deborde);
  const serrees = resultats.filter((r) => r.k < 1);
  const sansRappels = resultats.filter((r) => r.sansRappels);
  const phrases = [];
  if (debordent.length) {
    phrases.push(`Trop long pour une page, même resserré à ${Math.round(PLANCHER * 100)} % : ${qui(debordent)}. Le bas serait coupé à l'impression ; raccourcissez l'histoire, les conseils, les dons ou le journal.`);
  } else if (serrees.length) phrases.push(`Texte resserré à ${Math.round(Math.min(...serrees.map((r) => r.k)) * 100)} % pour tenir sur la page.`);
  else phrases.push("Chaque face tient sur une page A4. Dans la fenêtre d'impression, gardez les arrière-plans pour le parchemin. Sur téléphone ou tablette, téléchargez plutôt le PDF.");
  if (sansRappels.length) phrases.push(`Faute de place, certains rappels (jetons d'avantage, coma et mort, repos) ne sont pas imprimés sur : ${qui(sansRappels)}.`);
  return phrases.join(" ");
}

async function demarrer() {
  const p = new URLSearchParams(location.search);
  const zone = document.getElementById("feuilles");
  // Le coin des joueurs n'imprime que la fiche du joueur connecté.
  const joueur = document.body.dataset.mode === "joueur";
  const tous = joueur ? [(await api.get("/api/moi")).aventurier].filter(Boolean) : await api.get("/api/aventuriers");
  verso.tous = tous;
  let choisis;
  if (joueur) choisis = tous;
  else if (p.get("tablee")) choisis = tous.filter((a) => a.tablee !== false).sort((x, y) => (x.cree || "").localeCompare(y.cree || ""));
  else {
    const ids = (p.get("ids") || p.get("id") || "").split(",").filter(Boolean);
    choisis = ids.map((id) => tous.find((a) => a.id === id)).filter(Boolean);
  }
  if (!choisis.length) {
    zone.innerHTML = '<p class="chargement">Aucun aventurier à imprimer.</p>';
    return;
  }
  document.title = choisis.length === 1 ? `${choisis[0].nom || "Aventurier"} · fiche` : "Fiches de la tablée";
  const retour = document.querySelector(".retour");
  retour.href = joueur ? "/" : choisis.length === 1 ? `/#/aventuriers/${choisis[0].id}` : "/#/aventuriers";
  const avecVerso = document.querySelector('[data-opt="verso"]');
  const eco = document.querySelector('[data-opt="eco"]');
  if (p.get("verso") === "0") avecVerso.checked = false;
  if (p.get("eco") === "1") eco.checked = true;
  // Le PDF est rendu par le serveur : un téléphone ou un iPad imprime mal une page A4, un PDF s'imprime partout.
  const pdf = document.querySelector('[data-action="pdf"]');
  const lienPdf = () => {
    const q = new URLSearchParams();
    if (!joueur) {
      if (p.get("tablee")) q.set("tablee", "1");
      else q.set("ids", choisis.map((a) => a.id).join(","));
    }
    if (!avecVerso.checked) q.set("verso", "0");
    if (eco.checked) q.set("eco", "1");
    if (pdf) pdf.href = `${joueur ? "/fiche.pdf" : "/fiche-aventurier.pdf"}?${q}`;
  };
  pdf?.addEventListener("click", () => {
    pdf.textContent = "Préparation du PDF…";
    setTimeout(() => { pdf.textContent = "Télécharger le PDF"; }, 9000);
  });
  const rendre = async () => {
    lienPdf();
    zone.innerHTML = choisis.map((a, i) => recto(a, i) + (avecVerso.checked ? verso(a) + pagesFamiliers(a) : "")).join("");
    document.documentElement.classList.toggle("eco", eco.checked);
    await document.fonts.ready;
    await Promise.all([...zone.querySelectorAll("img")].map((im) => (im.complete ? null : new Promise((ok) => { im.onload = im.onerror = ok; }))));
    for (const im of zone.querySelectorAll(".fam-image img")) if (im.complete && !im.naturalWidth) im.closest(".fam-image").remove();
    const resultats = [...zone.querySelectorAll(".feuille")].map((f) => ({ nom: f.dataset.nom, face: f.dataset.face, ...resserrer(f) }));
    const taille = document.querySelector(".taille");
    taille.textContent = bilanMiseEnPage(resultats);
    taille.classList.toggle("alerte", resultats.some((r) => r.deborde));
  };
  avecVerso.addEventListener("change", rendre);
  eco.addEventListener("change", rendre);
  document.querySelector('[data-action="imprimer"]').addEventListener("click", () => window.print());
  await rendre();
}

demarrer().catch((err) => {
  document.getElementById("feuilles").innerHTML = `<p class="chargement">Fiche impossible à préparer : ${e(err.message)}</p>`;
});
