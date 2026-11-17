// Ce que la télécommande dessine : la TV, les scènes, le combat, la musique, le journal.

import { echapper as e } from "../api.js";
import { htmlRayons } from "../boutiques/rayons-telecommande.js";
import { htmlBarre, minutes, nomEntree } from "../combats/barre.js";
import { ENNEMIS, herosDe, prenom, seuilMort } from "../combats/suivi.js";
import { heureFr } from "../seances/journal.js";
import { liensDe, sceneEnCours } from "../seances/liens-scene.js";
import { filDeLaSeance, titreScene } from "../seances/scene-suivante.js";
import { etatRetire } from "../ecran-tv/tv-commun.js";
import { parLaMain } from "../mj/main-tv.js";
import { LARGE, ONGLETS, S, ambianceDe, attente, couleurSante, d, de, fichePnj, garder, nomDistant, nomSeance, occupes, planDe, rendre, seanceEnCours, signe } from "./etat.js";
import { effacerAnnonce } from "./gestes.js";
import { reessaiNotes } from "./notes.js";
import { TITRE_PRECEDEMMENT } from "../campagne/nom.js";

function afficher() {
  const temoin = document.querySelector(".temoin-tc");
  rendre(temoin, htmlTemoin());
  temoin.hidden = !d.table;
  rendre(document.querySelector('[data-zone="tv"]'), htmlTv());
  rendre(document.querySelector('[data-zone="combat"]'), htmlCombat());
  rendre(document.querySelector('[data-zone="musique"]'), htmlMusique());
  rendre(document.querySelector('[data-zone="journal"]'), htmlJournal());
  const s = seanceEnCours();
  document.querySelector(".seance-du-jour").textContent = s ? nomSeance(s) : "Aucune séance ouverte";
  const pour = document.querySelector('[data-zone="journal-seance"]');
  pour.textContent = s ? `Au journal de la séance ${s.numero ?? ""}${s.nom ? ` · ${s.nom}` : ""}` : "Aucune séance ouverte où noter : créez-la dans l'atelier.";
  document.querySelector(".noter button").disabled = !s;
  afficherMainCourante();
  marquerOnglets();
}

// Ce que montre la TV, comme table.js le décide : une vue sans sa fiche retombe sur l'accueil.
function vueTv(t) {
  if (t.vue === "plan" && t.plan) return ["Plan", planDe(t.plan)?.nom || d.plan?.nom || ""];
  if (t.vue === "carte" && t.carte) return ["Carte", nomDistant("cartes", t.carte, "carte")];
  if (t.vue === "image" && t.url) return ["Illustration", t.titre || ""];
  if (t.vue === "document" && t.document) return ["Document", nomDistant("documents", t.document, "document")];
  if (t.vue === "heros") return ["La tablée des aventuriers", ""];
  if (t.vue === "fiches") return ["Les fiches de la tablée", ""];
  if (t.vue === "planche") return ["La planche à contrats", ""];
  if (t.vue === "boutique" && t.boutique) return ["Boutique", nomDistant("boutiques", t.boutique, "boutique")];
  if (t.vue === "sanctuaire") return [t.batiment ? "Un bâtiment du sanctuaire" : "Le sanctuaire", ""];
  if (t.vue === "precedemment" && t.seance) return [TITRE_PRECEDEMMENT, ""];
  if (t.vue === "episode" && t.seance) return ["Le titre de l'épisode", ""];
  return ["L'écran d'accueil", ""];
}

const losange = '<span class="losange-ecran" aria-hidden="true"></span>';

// Le plan montré est-il tout noir (rien de révélé) ? Seulement s'il est à l'écran sans carton par-dessus.
const tvNoire = (t) => t?.vue === "plan" && d.plan?.id === t.plan && d.plan.noire;

// Le témoin de la TV, en tête de toutes les pages, comme celui de l'en-tête de l'atelier : ce que voient les joueurs
// (le carton posé par-dessus d'abord), si la TV est noire ou débranchée, et « Retirer ».
function htmlTemoin() {
  const t = d.table;
  if (!t) return "";
  const [quoi, detail] = vueTv(t);
  const heros = t.aventurier ? (d.jeu?.fiches || []).find((a) => a.id === t.aventurier) : null;
  const carton = t.pnj ? fichePnj(t.pnj)?.nom || "un PNJ" : t.rumeur ? "une rumeur" : t.aventurier ? heros?.nom || "un aventurier" : "";
  const noire = !carton && tvNoire(t);
  const nom = !t.ecrans ? "aucun écran branché" : carton || detail || quoi;
  // « par : Léa » quand l'autre MJ a la main sur la TV ; sans invité, jamais.
  const par = parLaMain(t);
  return `<span class="mot-tv${noire ? " noire" : ""}">${noire ? "TV noire" : "TV"}</span><span class="nom-tv${t.ecrans ? "" : " pale"}">${e(nom)}</span>${par ? `<span class="par-tv">${e(par)}</span>` : ""}
    ${etatRetire(t) ? `<button type="button" class="touche petite" data-geste="retirer"${attente("retirer")}>Retirer</button>` : ""}`;
}

function htmlTv() {
  const t = d.table;
  if (!t) return `<p class="calme">${d.liaison === "coupee" ? "La table ne répond pas : nouvel essai dans quelques secondes." : "Lecture de la table…"}</p>`;
  const [quoi, detail] = vueTv(t);
  const s = seanceEnCours();
  const i = s ? sceneEnCours(s) : -1;
  const dessus = [];
  if (t.pnj) {
    dessus.push(`<li><span>Carton de PNJ : <b>${e(fichePnj(t.pnj)?.nom || "un PNJ")}</b></span>
      <button type="button" class="touche petite" data-geste="pnj" data-pnj="${e(t.pnj)}" data-montrer="non"${attente(`pnj:${t.pnj}`)}>Retirer le carton</button></li>`);
  }
  if (t.rumeur) dessus.push("<li><span>Carton : <b>une rumeur</b></span></li>");
  if (t.aventurier) dessus.push(`<li><span>Carton : <b>${e((d.jeu?.fiches || []).find((a) => a.id === t.aventurier)?.nom || "un aventurier")}</b></span></li>`);
  if (t.combat) dessus.push("<li><span>L'ordre du tour est affiché</span></li>");
  const salon = t.ecrans_salon || 0;
  return `
    <div class="ecran">
      <p class="kicker">À la TV</p>
      <p class="vue">${losange}${e(quoi)}${detail ? `<span class="detail">${e(detail)}</span>` : ""}</p>
      ${tvNoire(t) ? '<p class="alerte">Rien n\'est révélé sur ce plan : la TV est noire. Révélez une pièce dans l\'atelier.</p>' : ""}
      ${dessus.length ? `<ul class="par-dessus">${dessus.join("")}</ul>` : ""}
      <p class="ecrans${salon ? "" : " alerte"}">${salon ? `${salon} écran${salon > 1 ? "s" : ""} de table au salon` : "Aucun écran de table branché au salon"}</p>
    </div>
    ${htmlScene(s)}
    ${htmlFeu()}
    ${htmlRayons(d.boutique, t, attente("rayon"))}
    ${htmlHorloges()}
    <button type="button" class="touche large" data-geste="accueil" aria-pressed="${quoi === "L'écran d'accueil"}"${attente("accueil")}>Écran d'accueil</button>
    ${htmlPlans(s, i)}
    ${htmlPnj(s, i)}`;
}

// La scène en cours et le geste de la soirée : « Scène suivante » coche la scène et joue la suivante, comme le bandeau
// de Séances sur l'ordinateur (seances/scene-suivante.js).
function htmlScene(s) {
  if (!s?.deroule?.length) return "";
  const { enCours, suivante } = filDeLaSeance(s);
  const d0 = enCours >= 0 ? s.deroule[enCours] : null;
  return `
    <div class="fil-tc">
      ${d0 ? `<p class="scene"><span class="kicker">Scène en cours</span>${e([heureFr(d0.heure || ""), titreScene(d0, enCours)].filter(Boolean).join(" · "))}</p>` : ""}
      ${suivante >= 0 ? `<button type="button" class="touche large suite" data-geste="scene"${attente("scene")}>Scène suivante<small>${e(titreScene(s.deroule[suivante], suivante))}</small></button>`
        : `<p class="calme">${d0 ? "Dernière scène du déroulé." : "Toutes les scènes sont jouées."}</p>`}
    </div>`;
}

function htmlFeu() {
  const p = d.plan;
  const t = d.table;
  if (!p || !p.etapes.length || t?.vue !== "plan" || t.plan !== p.id) return "";
  const n = p.etapes.length;
  const i = p.etape;
  return `
    <div class="feu" role="group" aria-label="Étapes du feu">
      <p class="kicker">Étapes du feu</p>
      <div class="pas">
        <button type="button" class="touche carree" data-geste="etape" data-sens="-1" aria-label="Étape précédente" ${i === null || i <= 0 ? "disabled" : ""}${attente("etape")}>−</button>
        <p class="compte">${i === null ? "<b>0</b>" : `<b>${i + 1}</b>`}<small>sur ${n}</small></p>
        <button type="button" class="touche carree" data-geste="etape" data-sens="1" aria-label="Étape suivante" ${i !== null && i >= n - 1 ? "disabled" : ""}${attente("etape")}>+</button>
      </div>
      ${i === null ? '<p class="nom-etape">Aucune étape rappelée : + pose la première.</p>' : p.etapes[i] ? `<p class="nom-etape">${e(p.etapes[i])}</p>` : ""}
    </div>`;
}

// Les horloges de la menace (horloges.js), préparées dans le Tableau : une part de plus ou de moins, montrée ou cachée.
function htmlHorloges() {
  const liste = d.horloges || [];
  if (!liste.length) return "";
  const une = (h) => {
    const pleine = h.remplies >= h.parts;
    const occupe = attente(`horloge:${h.id}`);
    return `
      <div class="horloge-tc${pleine ? " echue" : ""}">
        <p class="nom-horloge">${e(h.nom)}<small>${h.remplies} sur ${h.parts}${pleine ? ", échue" : ""}</small></p>
        <div class="parts-tc" aria-hidden="true">${Array.from({ length: h.parts }, (_, k) => `<span${k < h.remplies ? ' class="pleine"' : ""}></span>`).join("")}</div>
        <div class="pas">
          <button type="button" class="touche carree" data-geste="horloge" data-horloge="${e(h.id)}" data-pas="-1" aria-label="Une part de moins" ${h.remplies <= 0 ? "disabled" : ""}${occupe}>−</button>
          <button type="button" class="touche petite" data-geste="horloge-tv" data-horloge="${e(h.id)}" aria-pressed="${h.visible}"${occupe}>${h.visible ? "Retirer de la TV" : "Montrer à la TV"}</button>
          <button type="button" class="touche carree" data-geste="horloge" data-horloge="${e(h.id)}" data-pas="1" aria-label="Une part de plus" ${pleine ? "disabled" : ""}${occupe}>+</button>
        </div>
      </div>`;
  };
  return `
    <div class="horloges-tc" role="group" aria-label="Horloges de la menace">
      <p class="kicker">Horloges</p>${liste.map(une).join("")}
    </div>`;
}

// Les plans liés aux scènes de la séance, la scène en cours d'abord, puis les suivantes ; puis les derniers montrés.
function htmlPlans(s, i) {
  const deroule = s?.deroule || [];
  const rangs = [...deroule.keys()];
  const ordre = i < 0 ? rangs : [...rangs.slice(i), ...rangs.slice(0, i)];
  const vus = new Set();
  const seance = [];
  for (const k of ordre) {
    const id = liensDe(deroule[k]).plan;
    if (id && !vus.has(id) && planDe(id)) {
      vus.add(id);
      seance.push({ id, scene: k === i });
    }
  }
  const recents = d.recents.filter((id) => !vus.has(id) && planDe(id)).map((id) => ({ id }));
  const t = d.table;
  const ligne = ({ id, scene }) => {
    const p = planDe(id);
    const ici = t?.vue === "plan" && t.plan === id;
    const note = ici ? "À la TV" : scene ? "Scène en cours" : p.etapes ? `${p.etapes} étapes` : "";
    return `<button type="button" class="ligne" data-geste="plan" data-plan="${e(id)}" aria-pressed="${ici}"${attente(`plan:${id}`)}>
      <span class="nom">${ici ? losange : ""}${e(p.nom)}</span>${note ? `<span class="note">${e(note)}</span>` : ""}</button>`;
  };
  return `
    <h3 class="sous-titre">Plans de la séance</h3>
    ${seance.length ? `<div class="lignes">${seance.map(ligne).join("")}</div>`
      : `<p class="calme">Aucun plan lié aux scènes${s ? " de cette séance" : ""}. Ils se lient dans l'atelier, Séances › Préparer.</p>`}
    ${recents.length ? `<h3 class="sous-titre">Derniers montrés</h3><div class="lignes">${recents.map(ligne).join("")}</div>` : ""}`;
}

// Les PNJ de la scène en cours, puis ceux de la séance (sa liste, et ceux liés à ses autres scènes).
function htmlPnj(s, i) {
  const deLaScene = [...new Set(i >= 0 ? liensDe(s.deroule[i]).pnj : [])].filter(fichePnj);
  const tous = [...(Array.isArray(s?.pnj) ? s.pnj : []), ...(s?.deroule || []).flatMap((x) => liensDe(x).pnj)];
  const autres = [...new Set(tous)].filter((id) => !deLaScene.includes(id) && fichePnj(id));
  const bouton = (id) => {
    const p = fichePnj(id);
    const ici = d.table?.pnj === id;
    return `<button type="button" class="pastille" data-geste="pnj" data-pnj="${e(id)}" aria-pressed="${ici}"${attente(`pnj:${id}`)}>
      <span>${ici ? losange : ""}${e(p.nom)}</span>${ici ? "<small>à la TV</small>" : p.connu ? "" : '<small class="secret">secret</small>'}</button>`;
  };
  return `
    <h3 class="sous-titre">Cartons de PNJ</h3>
    ${deLaScene.length ? `<p class="groupe">De la scène</p><div class="pastilles">${deLaScene.map(bouton).join("")}</div>` : ""}
    ${autres.length ? `<p class="groupe">De la séance</p><div class="pastilles">${autres.map(bouton).join("")}</div>` : ""}
    ${deLaScene.length || autres.length ? '<p class="aide">Un carton montré se retire d\'un second toucher.</p>' : '<p class="calme">Aucun PNJ dans cette séance.</p>'}`;
}
const resteSablier = (c) => (typeof c?.sablier?.fin === "number" ? Math.max(0, (c.sablier.fin * 1000 - (Date.now() + S.decalage)) / 1000) : null);
const ordreSurLaTv = () => Boolean(d.jeu?.seance) && d.table?.combat === d.jeu.seance;

// La barre du combat, la même que sur l'ordinateur (combats/barre.js) ; la Santé du héros qui a la main glissée au milieu.
function htmlCombat() {
  if (!d.jeu) return '<p class="calme">Lecture du combat…</p>';
  const c = d.jeu.combat;
  if (!c) return '<p class="calme">Aucun combat en cours. Il se lance depuis l\'atelier (Séances › Jouer, ou l\'onglet Combats) et paraît ici aussitôt.</p>';
  const entree = Array.isArray(c.ordre) ? c.ordre[c.actif] : null;
  const h = entree && entree !== ENNEMIS ? herosDe(c, entree) : null;
  return `
    <p class="kicker">${e(c.nom || "Rencontre")}</p>
    ${htmlBarre(c, {
      surface: "telecommande", tv: ordreSurLaTv(), reste: resteSablier(c), occupe: occupes.has("combat"),
      milieu: h ? htmlSante(h) : '<p class="aide">La Santé des adversaires se suit sur l\'ordinateur.</p>',
    })}`;
}

// Le sablier qui tourne : son compte suit à la demi-seconde, sans redessiner la barre.
setInterval(() => {
  const c = d.jeu?.combat;
  const el = document.querySelector('[data-zone="combat"] .sablier-mj');
  if (!c?.sablier || !el) return;
  const reste = resteSablier(c);
  el.textContent = minutes(reste);
  el.classList.toggle("vide", reste <= 0);
}, 500);

function htmlSante(h) {
  const k = h.max > 0 ? Math.max(0, Math.min(1, h.sante / h.max)) : 0;
  const etat = h.sante <= seuilMort(h.max) ? "Au repère de mort" : h.sante <= 0 ? "Dans le coma" : "";
  return `
    <div class="sante">
      <p class="kicker">Santé ${e(de(prenom(h.nom)))}</p>
      <div class="jauge"><span class="barre" aria-hidden="true"><i style="width:${Math.round(k * 100)}%;background:${couleurSante(k)}"></i></span>
        <output>${e(signe(h.sante))}<small>/${h.max}</small></output></div>
      ${etat ? `<p class="etat-heros">${etat}</p>` : ""}
      <div class="deux">
        <button type="button" class="touche" data-geste="sante" data-delta="-1"${attente("combat")}>Santé −1</button>
        <button type="button" class="touche" data-geste="sante" data-delta="1"${attente("combat")}>Santé +1</button>
      </div>
    </div>`;
}

// L'ambiance après celle qui joue, dans l'ordre de la liste ; sans musique, celle de la scène en cours, ou la première.
function ambianceSuivante(courante) {
  const liste = d.ambiances;
  if (!liste.length) return null;
  const k = liste.findIndex((a) => a.id === courante);
  if (k >= 0) return liste.length > 1 ? liste[(k + 1) % liste.length] : null;
  const s = seanceEnCours();
  const i = s ? sceneEnCours(s) : -1;
  return ambianceDe(i >= 0 ? liensDe(s.deroule[i]).ambiance : null) || liste[0];
}

function htmlMusique() {
  const r = d.relais;
  if (!r) return '<p class="calme">Lecture de la musique…</p>';
  const m = r.musique;
  const ouvert = r.ecrans > 0;
  const suivante = ambianceSuivante(m?.courante);
  const s = seanceEnCours();
  const i = s ? sceneEnCours(s) : -1;
  const deLaScene = i >= 0 ? liensDe(s.deroule[i]).ambiance : null;
  let etat;
  if (!ouvert) etat = '<p class="alerte">L\'atelier n\'est ouvert sur aucun écran : ouvrez-le sur l\'ordinateur, la musique y joue.</p>';
  else if (!m) etat = '<p class="calme">Le lecteur de l\'atelier se prépare…</p>';
  else if (!m.courante) etat = '<p class="calme">Aucune musique ne joue sur l\'ordinateur.</p>';
  else etat = `<p class="vue">${losange}${e(m.nom)}<span class="detail">${m.enPause ? "En pause" : e(m.titre || "Lancement…")}</span></p>`;
  const bouton = (action, libelle, inactif = false) => `<button type="button" class="touche" data-geste="musique" data-action="${action}" ${!ouvert || inactif ? "disabled" : ""}${attente(`musique:${action}`)}>${libelle}</button>`;
  return `
    <div class="ecran">
      <p class="kicker">Sur le Mac</p>
      ${etat}
      ${m?.attenteGeste ? '<p class="alerte">Le navigateur du Mac attend un geste : touchez la vidéo dans le panneau Musique.</p>' : ""}
    </div>
    <div class="deux">
      ${m?.enPause ? bouton("reprendre", "Reprendre") : bouton("pause", "Pause", !m?.courante)}
      ${bouton("morceau", "Morceau suivant", !m?.liste || m?.enPause)}
    </div>
    <button type="button" class="touche large" data-geste="musique" data-action="choisir" data-ambiance="${e(suivante?.id || "")}" ${!ouvert || !suivante ? "disabled" : ""}${attente("musique:suivante")}>Ambiance suivante${suivante ? `<small>${e(suivante.nom)}</small>` : ""}</button>
    <h3 class="sous-titre">Ambiances</h3>
    ${d.ambiances.length ? `<div class="pastilles">${d.ambiances.map((a) => {
      const ici = a.id === m?.courante;
      return `<button type="button" class="pastille" data-geste="musique" data-action="choisir" data-ambiance="${e(a.id)}" aria-pressed="${ici}" ${ouvert ? "" : "disabled"}${attente(`musique:${a.id}`)}>
        <span>${ici ? losange : ""}${e(a.nom)}</span>${a.id === deLaScene ? "<small>de la scène</small>" : ""}</button>`;
    }).join("")}</div>` : '<p class="calme">Aucune ambiance : la liste se remplit dans l\'atelier, panneau Musique.</p>'}`;
}

function htmlJournal() {
  const s = seanceEnCours();
  const lignes = (Array.isArray(s?.journal) ? s.journal : []).slice(-4).reverse();
  const enAttente = d.notes;
  return `
    ${enAttente.length ? `
    <div class="en-attente">
      <p class="kicker">Pas encore reçu${enAttente.length > 1 ? "es" : "e"} par le serveur</p>
      <ul>${enAttente.map((n) => `<li>${e(n.texte)}</li>`).join("")}</ul>
      <p class="aide">${e(reessaiNotes.libelle("erreur") || "Envoi en cours…")}</p>
    </div>` : ""}
    ${lignes.length ? `<h3 class="sous-titre">Dernières lignes</h3>
    <ol class="lignes-journal">${lignes.map((l) => `<li><time>${e(heureFr(l.t || ""))}</time> ${e(l.texte)}</li>`).join("")}</ol>`
      : s ? '<p class="calme">Rien encore au journal de cette séance.</p>' : ""}`;
}

function afficherMainCourante() {
  const el = document.querySelector(".main-courante");
  const c = d.jeu?.combat;
  const montrer = Boolean(c) && !LARGE.matches && S.onglet !== "combat";
  el.hidden = !montrer;
  document.body.classList.toggle("avec-main", montrer);
  if (!montrer) return;
  const entree = c.ordre?.[c.actif];
  rendre(el, `
    <p><span class="kicker">Tour ${c.tour || 1}, la main</span><b>${e(nomEntree(c, entree))}</b></p>
    <button type="button" class="touche principale" data-geste="suivant"${attente("combat")}>Suivant</button>`);
}

function marquerOnglets() {
  const large = LARGE.matches;
  for (const p of document.querySelectorAll("[data-panneau]")) p.hidden = !large && p.dataset.panneau !== S.onglet;
  for (const b of document.querySelectorAll("[data-onglet]")) {
    const ici = b.dataset.onglet === S.onglet;
    b.setAttribute("aria-selected", String(ici));
    b.tabIndex = ici ? 0 : -1;
  }
  document.querySelector('[data-onglet="combat"]').dataset.alerte = d.jeu?.combat ? "oui" : "non";
}

function choisirOnglet(o) {
  if (!ONGLETS.includes(o)) return;
  S.onglet = o;
  garder("telecommande.onglet", o);
  // Le « Fait » du geste d'avant ne suit pas dans l'autre onglet.
  effacerAnnonce(true);
  marquerOnglets();
  afficherMainCourante();
  window.scrollTo(0, 0);
}

export { afficher, afficherMainCourante, choisirOnglet, marquerOnglets, ordreSurLaTv };
