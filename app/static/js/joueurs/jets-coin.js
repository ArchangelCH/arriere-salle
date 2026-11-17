// « Lancer un test » : pendant la partie, en visio comme autour de la table, le joueur lance un test depuis son téléphone.
// Un bouton flottant, en bas à droite, juste à gauche de « Je veux agir » (main-levee.js). Il ouvre une feuille : un toucher
// pour la caractéristique, un pour la compétence qui aide (elle se choisit seulement), un modificateur s'il y a lieu, puis
// le bouton « Lancer » : aucun toucher sur un choix ne fait partir le dé. Puis le résultat. Le dé se jette dans l'atelier, sur la fiche de l'atelier : la page n'envoie que ces choix, et ne calcule les
// chances que pour les dire. Le résultat paraît aussi à la TV et chez le MJ.
//
// Quand le MJ demande un test (« Votre MJ demande un test de Mental »), la feuille s'ouvre d'elle-même avec « Lancer » et les
// compétences qui aident (à choisir avant de lancer) ; « Plus tard » la referme, le bouton reste doré tant que le test
// attend. Tout arrive par le flux poussé (flux.js : « demandes » pour un résultat ou un test demandé, « jets » pour la fiche,
// « table » quand le MJ ouvre ou ferme la table, « pause ») ; la page relit GET /api/jets, qui ne parle que de ce joueur.
// Table du coin fermée, ou héros absent : le bouton n'est pas là. Coin en pause : il dit pourquoi rien ne part.
//
// Lot G : un second volet, « Des dés » : D4 à D100, de un à cinq dés, un bonus, et un bouton par arme de la fiche
// (« Épée : 1D10 ») ; la page n'envoie que l'expression (des.js, jumeau de des.py), les dés roulent dans l'atelier. Quand
// le MJ joue avec les dés d'aventure : les deux réserves, la case « Ajouter un dé d'aventure », le dé de mésaventure annoncé
// avant de lancer. L'effet est annoncé, le MJ tranche (In extremis n'est jamais calculé).
//
// L'avantage du héros, en combat comme hors combat : « Utiliser mon avantage » ajoute 10 % au test (le jeton s'en va
// quand le dé roule) ; ou, le test lancé, il change l'effet d'un dé d'aventure ou de mésaventure qui a roulé (« Votre
// avantage : changer l'effet », sous le résultat du dernier test). Jamais avant le lancer.
//
// Pour l'inclure dans une page du coin où l'on joue (le carnet, « La table ») :
//   import { monter as monterJets } from "./jets-coin.js";
//   monterJets();

import { echapper as e } from "../api.js";
import { BONUS_MAX, FACES, NOMBRE_MAX, bornes, ecrire as expression, lire as lireDes } from "../jets/des.js";
import { ecouterFlux } from "./flux.js";

// Relatif au module : sous l'adresse versionnée de la page (/static/v-…/), la feuille aussi (voir joueurs.py, version_statique).
const FEUILLE = new URL("../../css/jets-coin.css", import.meta.url).pathname;
const PAS = 5; // le modificateur, de cinq en cinq
const ATTENTE = 12000; // au-delà, l'atelier tarde : la page le dit
const VUES = "jets.demandes-vues"; // les tests demandés déjà ouverts d'eux-mêmes sur cet appareil
// L'avantage dépensé après le lancer pour changer l'effet d'un dé d'aventure : l'effet voulu (la face envoyée en est la
// plus haute, rien ne change avec l'autre).
const EFFETS_CHOISIS = [[2, "Mouvement", "1-2"], [4, "Posture", "3-4"], [6, "In extremis", "5-6"]];
const DE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6 20.4 7.4v9.2L12 21.4l-8.4-4.8V7.4Z"/><path d="M3.6 7.4 12 12.2l8.4-4.8M12 12.2v9.2"/><circle cx="12" cy="7.2" r="1.1" class="plein"/><circle cx="7.6" cy="13.4" r="1.1" class="plein"/><circle cx="16.4" cy="13.4" r="1.1" class="plein"/></svg>';

let monte = null;

const signe = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");
// Les chances de réussir : bornées par les critiques (5 et 95 ; 10 et 90 en posture offensive, jets.chances côté serveur).
const chances = (v, c) => Math.max(c?.reussite || 5, Math.min((c?.echec || 96) - 1, v));
const deux = (n) => String(n).padStart(2, "0");

async function demander(methode, corps, url = "/api/jets") {
  let r;
  try {
    r = await fetch(url, { method: methode, headers: methode === "GET" ? {} : { "Content-Type": "application/json" },
      body: methode === "GET" ? undefined : JSON.stringify(corps || {}) });
  } catch {
    throw Object.assign(new Error("Pas de réseau : réessayez dans un instant."), { status: 0 });
  }
  if (!r.ok) {
    let message = `${r.status}`;
    try {
      message = (await r.json()).detail || message;
    } catch {
      // réponse sans JSON
    }
    throw Object.assign(new Error(message), { status: r.status });
  }
  return r.json();
}

function lireVues() {
  try {
    return JSON.parse(sessionStorage.getItem(VUES) || "[]").filter((x) => typeof x === "string").slice(-20);
  } catch {
    return [];
  }
}

function garderVues(liste) {
  try {
    sessionStorage.setItem(VUES, JSON.stringify(liste.slice(-20)));
  } catch {
    // navigation privée : un test demandé pourrait se rouvrir une fois, rien de plus
  }
}

function poserFeuille() {
  if (document.querySelector(`link[href="${FEUILLE}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = FEUILLE;
  document.head.append(l);
}

export function monter() {
  if (monte) return monte;
  poserFeuille();
  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.className = "bouton-jet";
  bouton.hidden = true;
  bouton.setAttribute("aria-haspopup", "dialog");
  bouton.innerHTML = `${DE}<span class="mot-jet">Lancer un test</span>`;
  const voile = document.createElement("div");
  voile.className = "voile-jet";
  voile.hidden = true;
  const feuille = document.createElement("section");
  feuille.className = "feuille-jet";
  feuille.hidden = true;
  feuille.setAttribute("role", "dialog");
  feuille.setAttribute("aria-modal", "true");
  feuille.setAttribute("aria-labelledby", "titre-jet");
  feuille.tabIndex = -1;
  document.body.append(bouton, voile, feuille);
  document.body.classList.add("avec-jets");

  let etat = null; // la dernière réponse de GET /api/jets
  let mode = ""; // "" (fermée), "choix", "demande", "roule", "resultat"
  let volet = "test"; // dans « choix » : « test » ou « des »
  let carac = "";
  let comp = ""; // la compétence choisie (vide : sans compétence) ; rien ne part avant « Lancer »
  let mod = 0;
  // Les dés libres : le dernier réglage reste d'une ouverture à l'autre.
  let nombre = 1;
  let faces = 6;
  let bonus = 0;
  let aventure = false; // « Ajouter un dé d'aventure »
  let avecAvantage = false; // « Utiliser mon avantage » : +10 % à ce test, le jeton est dépensé
  let change = false; // un changement d'effet (l'avantage, après le lancer) est en route
  let dernierDes = null; // { des, arme } : « Relancer » refait le même jet
  let lance = ""; // le jet parti de cet appareil, dont on attend le résultat
  let montre = null; // le résultat montré
  let erreur = "";
  let lecture = 0;
  let relance = 0;
  let tard = false; // l'atelier tarde à répondre
  let minuterie = 0;
  let occupe = false;
  const vues = lireVues();

  // ---------------------------------------------------------------- la place du bouton, à gauche de « Je veux agir »

  let observe = null;
  const placer = () => {
    const b = document.querySelector(".main-levee:not([hidden]) .bouton-main-levee");
    const largeur = b && b.offsetParent !== null ? b.offsetWidth : 0;
    document.body.style.setProperty("--jet-decalage", `${largeur ? largeur + 10 : 0}px`);
    // Et sa propre largeur (« Lancer un test », ou le dé seul) : la légende des héros de la page Table s'arrête avant.
    if (!bouton.hidden && bouton.offsetWidth) document.body.style.setProperty("--jet-largeur", `${bouton.offsetWidth}px`);
  };
  const suivreMainLevee = () => {
    const b = document.querySelector(".main-levee .bouton-main-levee");
    if (!b || observe === b || typeof ResizeObserver === "undefined") return placer();
    observe = b;
    new ResizeObserver(placer).observe(b);
    new ResizeObserver(placer).observe(bouton);
    new MutationObserver(placer).observe(b.closest(".main-levee"), { attributes: true, attributeFilter: ["hidden", "data-etat"] });
    placer();
  };

  // ---------------------------------------------------------------- dessiner

  const heros = () => etat?.heros || null;
  const caracDe = (cle) => heros()?.caracs.find((c) => c.cle === cle) || null;
  // Les dés d'aventure, tels que l'atelier les a publiés pour ce héros.
  const regle = () => heros()?.reserve?.actif === true;
  const groupe = () => (regle() ? heros().reserve.aventure : 0);
  const annonce = () => (regle() ? heros()?.mesaventure || null : null);
  const avantage = () => heros()?.jeton === "avantage";
  // Les seuils des critiques, élargis en posture offensive (publiés par l'atelier avec la fiche de jet).
  const critiques = () => heros()?.critiques || null;
  const htmlOffensive = () => (critiques()?.offensive
    ? `<p class="offensive-jet" role="note"><b>Posture offensive</b> : réussite critique de 01 à ${deux(critiques().reussite)}, échec critique de ${critiques().echec} à 100.</p>` : "");
  // Ce que le test choisi donnera de chances (la compétence choisie comprise), pour le bouton « Lancer ».
  const plusAvantage = () => (avecAvantage && avantage() ? heros().avantage || 10 : 0);
  const chancesChoisies = (c, m) => {
    if (!c) return "";
    const x = heros().competences.find((k) => k.nom === comp);
    return `<small>${chances(c.valeur + c.ajustement + m + (x ? x.bonus : 0) + plusAvantage(), critiques())} %</small>`;
  };

  // Ce qui n'a plus lieu d'être quand la feuille se relit : plus de dé au groupe, plus d'annonce, plus de jeton.
  function accorderChoix() {
    if (!regle() || groupe() < 1) aventure = false;
    if (!avantage()) avecAvantage = false;
  }

  function dessinerBouton() {
    const d = etat?.demande;
    bouton.hidden = !(etat?.ouvert && heros());
    bouton.dataset.demande = d ? "oui" : "non";
    bouton.dataset.pause = etat?.pause ? "oui" : "non";
    const mot = bouton.querySelector(".mot-jet");
    mot.textContent = d ? `Test de ${d.carac_nom}` : "Lancer un test";
    bouton.setAttribute("aria-label", d ? `Votre MJ demande un test de ${d.carac_nom} : le lancer` : "Lancer un test");
    bouton.setAttribute("aria-expanded", String(Boolean(mode)));
  }

  // Une compétence qui aide, avec les chances qu'elle donne pour la caractéristique choisie.
  function htmlCompetences(c, m, avecSans) {
    const choisie = (nom) => (c && comp === nom ? ' aria-pressed="true"' : ' aria-pressed="false"');
    const h = heros();
    const base = c ? c.valeur + c.ajustement + m + plusAvantage() : 0;
    const sans = `<button type="button" class="comp-jet" data-comp=""${choisie("")}${c ? "" : " disabled"}>Sans compétence${c ? `<small>${chances(base, critiques())} %</small>` : ""}</button>`;
    const autres = h.competences.map((x) => `<button type="button" class="comp-jet" data-comp="${e(x.nom)}"${choisie(x.nom)}${c ? "" : " disabled"}>${e(x.nom)} <b>${signe(x.bonus)}</b>${c ? `<small>${chances(base + x.bonus, critiques())} %</small>` : ""}</button>`);
    return `<div class="comps-jet" role="group" aria-label="La compétence qui aide">${avecSans ? sans : ""}${autres.join("")}</div>`;
  }

  // ---- Lot G : les dés d'aventure dans la feuille de test ----

  // « Dés d'aventure : 3 au groupe, 1 au MJ » : les deux réserves, quand la règle est en jeu.
  function htmlReserve() {
    if (!regle()) return "";
    const r = heros().reserve;
    return `<p class="reserve-jet"><span class="pips-jet" aria-hidden="true">${"<i></i>".repeat(Math.min(r.aventure, 12))}${'<i class="mj"></i>'.repeat(Math.min(r.mesaventure, 12))}</span>
      <span>Dés d'aventure\u00a0: ${r.aventure}\u00a0au groupe, ${r.mesaventure}\u00a0au MJ</span></p>`;
  }

  // Le dé de mésaventure annoncé par le MJ pour ce test, avant qu'il parte.
  function htmlAnnonce() {
    const m = annonce();
    if (!m) return "";
    return `<p class="annonce-jet" role="status"><b>Dé de mésaventure</b> : votre MJ en impose un à ce test. Il roulera avec le D100${m.face_choisie ? ", et votre MJ en a choisi l'effet (votre désavantage)" : ""}.</p>`;
  }

  // « Ajouter un dé d'aventure ». Son effet ne se choisit plus avant le lancer : l'avantage le change après, le dé vu.
  function htmlAventure() {
    if (!regle()) return "";
    const n = groupe();
    const caseAventure = `<label class="case-jet${n ? "" : " vide"}"><input type="checkbox" data-aventure${aventure ? " checked" : ""}${n ? "" : " disabled"}>
        <span>${n ? `Ajouter un dé d'aventure <small>(${n}\u00a0dans la réserve)</small>` : "Plus de dé d'aventure dans la réserve du groupe"}</span></label>`;
    return `<div class="aventure-jet">${caseAventure}</div>`;
  }

  // « Utiliser mon avantage » : +10 % à ce test ; le jeton s'en va quand le dé roule.
  function htmlAvantage() {
    if (!avantage()) return "";
    const plus = heros().avantage || 10;
    return `<div class="aventure-jet avantage-test"><label class="case-jet"><input type="checkbox" data-avantage${avecAvantage ? " checked" : ""}>
        <span>Utiliser mon avantage\u00a0: +${plus}\u00a0% à ce test <small>(le jeton est dépensé)</small></span></label></div>`;
  }

  // Ce qui part avec un test : le dé d'aventure et l'avantage dépensé, s'il y a lieu.
  const desDuTest = () => ({ ...(aventure ? { aventure: true } : {}), ...(avecAvantage && avantage() ? { avantage: true } : {}) });

  // ---- Lot G : le volet « Des dés » ----

  function htmlVolets(actif) {
    return `<div class="volets-jet" role="group" aria-label="Que lancer">
        <button type="button" data-volet="test" aria-pressed="${actif === "test"}">Un test</button>
        <button type="button" data-volet="des" aria-pressed="${actif === "des"}">Des dés</button></div>`;
  }

  function htmlDes() {
    const h = heros();
    const d = lireDes(expression(nombre, faces, bonus));
    const b = d ? bornes(d) : null;
    const armes = h.armes || [];
    return `${armes.length ? `<p class="etape-jet seule">Les dégâts de vos armes</p>
      <div class="armes-jet">${armes.map((w, i) => `<button type="button" class="arme-jet" data-arme="${i}">${DE}<span>${e(w.nom)}</span><b class="expr-jet">${e(w.degats)}</b></button>`).join("")}</div>` : ""}
      <p class="etape-jet seule">Des dés libres</p>
      <div class="faces-jet" role="group" aria-label="Le dé">${FACES.map((f) => `<button type="button" class="expr-jet" data-faces="${f}" aria-pressed="${f === faces}">D${f}</button>`).join("")}</div>
      <div class="mod-jet"><span>Combien</span>
        <button type="button" data-nombre="-1" aria-label="Un dé de moins"${nombre <= 1 ? " disabled" : ""}>−</button><output aria-live="polite">${nombre}</output><button type="button" data-nombre="1" aria-label="Un dé de plus"${nombre >= NOMBRE_MAX ? " disabled" : ""}>+</button></div>
      <div class="mod-jet"><span>Bonus</span>
        <button type="button" data-bonus="-1" aria-label="Moins un"${bonus <= -BONUS_MAX ? " disabled" : ""}>−</button><output aria-live="polite">${signe(bonus)}</output><button type="button" data-bonus="1" aria-label="Plus un"${bonus >= BONUS_MAX ? " disabled" : ""}>+</button></div>
      <button type="button" class="lancer-jet" data-des="libres">${DE}<span>Lancer <span class="expr-jet">${e(d ? d.texte : "")}</span></span>${b ? `<small class="expr-jet">de ${b.min} à ${b.max}</small>` : ""}</button>`;
  }

  // Ce qui change la valeur visée en plus, compté par l'atelier comme ici : « Carton rouge en Physique : −30 % ».
  const htmlAjustements = (liste) => (liste?.length ? `<ul class="ajustements-jet">${liste.map((x) => `<li>${e(x.libelle)}\u00a0: ${signe(x.valeur)}\u00a0%</li>`).join("")}</ul>` : "");
  const htmlPause = () => (etat?.pause ? '<p class="pause-jet" role="status">Le coin est en pause : votre MJ le rouvrira, rien ne part en attendant.</p>' : "");
  const htmlErreur = () => (erreur ? `<p class="erreur-jet" role="alert">${e(erreur)}</p>` : "");
  const tete = (titre) => `<header class="tete-jet"><h2 id="titre-jet">${e(titre)}</h2><button type="button" class="fermer-jet" data-jet="fermer" aria-label="Fermer">×</button></header>`;

  function htmlChoix() {
    const h = heros();
    if (volet === "des") {
      return `${tete("Lancer des dés")}
      <p class="qui-jet">${e(h.nom)}</p>
      ${htmlVolets("des")}
      ${htmlPause()}${htmlErreur()}
      ${htmlDes()}`;
    }
    const c = caracDe(carac);
    const caracs = h.caracs.map((x) => `<button type="button" class="carac-jet" data-carac="${x.cle}" aria-pressed="${x.cle === carac}">
        <span>${e(x.nom)}</span><b>${x.valeur}</b>${x.carton ? `<small class="carton-jet" data-carton="${e(x.carton)}">carton ${e(x.carton)}</small>` : ""}</button>`).join("");
    return `${tete("Lancer un test")}
      <p class="qui-jet">${e(h.nom)}</p>
      ${htmlVolets("test")}
      ${htmlPause()}${htmlErreur()}
      ${htmlReserve()}${htmlAnnonce()}
      <p class="etape-jet"><span>1</span>La caractéristique</p>
      <div class="caracs-jet" role="group" aria-label="La caractéristique">${caracs}</div>
      <div class="mod-jet"><span>Modificateur</span>
        <button type="button" data-mod="-${PAS}" aria-label="Moins ${PAS}">−</button><output aria-live="polite">${signe(mod)}</output><button type="button" data-mod="${PAS}" aria-label="Plus ${PAS}">+</button>
        <small>si votre MJ en donne un</small></div>
      ${htmlAventure()}${htmlAvantage()}
      <p class="etape-jet"><span>2</span>${c ? "La compétence qui aide, si elle s'applique" : "Puis la compétence qui aide"}</p>
      ${htmlCompetences(c, mod, true)}
      ${htmlAjustements(c?.ajustements)}${htmlOffensive()}
      <p class="etape-jet"><span>3</span>Lancer le dé</p>
      <button type="button" class="lancer-jet" data-lancer="choix"${c ? "" : " disabled"}>${DE}<span>Lancer${c ? ` : ${e(c.nom)}${comp ? ` (${e(comp)})` : ""}` : ""}</span>${chancesChoisies(c, mod)}</button>
      ${c ? "" : '<p class="aide-jet">Choisissez d\'abord une caractéristique.</p>'}`;
  }

  function htmlDemande() {
    const d = etat.demande;
    const c = caracDe(d.carac);
    return `${tete("Votre MJ demande un test")}
      <p class="demande-jet">Test de <b>${e(d.carac_nom)}</b>${d.modificateur ? ` <span>(${signe(d.modificateur)})</span>` : ""}</p>
      ${htmlPause()}${htmlErreur()}
      ${htmlReserve()}${htmlAnnonce()}${htmlAventure()}${htmlAvantage()}
      ${heros().competences.length ? `<p class="etape-jet seule">Avec une compétence qui aide, si elle s'applique :</p>${htmlCompetences(c, d.modificateur || 0, false)}` : ""}
      ${htmlAjustements(c?.ajustements)}${htmlOffensive()}
      <button type="button" class="lancer-jet" data-lancer="demande">${DE}<span>Lancer${comp ? ` (${e(comp)})` : ""}</span>${chancesChoisies(c, d.modificateur || 0)}</button>
      <button type="button" class="plus-tard-jet" data-jet="fermer">Plus tard</button>`;
  }

  function htmlRoule() {
    return `${tete("Le dé roule")}<p class="roule-jet" role="status"><span class="de-roule">${DE}</span>${tard ? "L'atelier de votre MJ tarde à répondre : votre test partira dès qu'il le pourra, ou échouera s'il arrive trop tard." : "Le dé roule…"}</p>`;
  }

  // Le dé d'aventure et le dé de mésaventure d'un test : la face, son effet, annoncés ; le MJ tranche. Tant que c'est le
  // dernier test et que le héros porte son avantage, chaque dé qui a roulé peut changer d'effet : le jeton est alors dépensé.
  function htmlDesDuTest(p, ident) {
    const dernier = Boolean(ident) && etat?.dernier?.id === ident;
    const lignes = [["aventure", "Dé d'aventure"], ["mesaventure", "Dé de mésaventure"]].filter(([k]) => p[k]).map(([k, nom]) => {
      const x = p[k];
      const changer = dernier && avantage() && !x.choisie && !x.annule
        ? `<div class="effets-jet changer-effet" role="group" aria-label="${nom} : changer l'effet avec votre avantage"><span>Votre avantage\u00a0: changer l'effet <small>(le jeton est dépensé)</small></span>${EFFETS_CHOISIS.filter(([, effet]) => effet !== x.effet).map(([face, effet, lesFaces]) => `<button type="button" data-changer="${k}" data-face="${face}"${change || etat?.face?.en_route ? " disabled" : ""}>${effet}<small>${lesFaces}</small></button>`).join("")}</div>`
        : "";
      return `<li data-de="${k}"${x.annule ? ' class="annule"' : ""}><span class="face-jet">${e(x.face)}</span><span><b>${nom}</b> : ${e(x.effet)}${x.choisie ? " <small>(effet choisi)</small>" : ""}${x.annule ? "<em>Votre MJ l'a annulé : le dé est revenu au groupe.</em>" : ""}</span>${changer}</li>`;
    });
    const notes = (p.notes || []).map((n) => `<p class="note-jet">${e(n)}</p>`).join("");
    const refus = dernier && etat?.face?.jet === ident && etat.face.phrase ? `<p class="erreur-jet" role="alert">${e(etat.face.phrase)}</p>` : "";
    return `${lignes.length ? `<ul class="des-test-jet">${lignes.join("")}</ul>${refus}<p class="tv-jet">L'effet est annoncé ; votre MJ dit ce qu'il change.</p>` : ""}${notes}`;
  }

  function htmlResultatDes(p) {
    // « 7 + 6 + 2, bonus +2 » : le bonus dit comme tel, sinon il se lirait comme un dé de plus.
    const somme = p.des.join(" + ") + (p.bonus ? `, bonus ${p.bonus > 0 ? "+" : "−"}${Math.abs(p.bonus)}` : "");
    return `${tete("Les dés")}
      <p class="test-jet">${e(p.nom)} · ${p.arme ? `${e(p.arme)}, ` : ""}<span class="expr-jet">${e(p.texte)}</span></p>
      <div class="resultat-jet total-jet" role="status">
        <p class="de-jet">${e(p.total)}</p>
        <p class="issue-jet">${p.arme ? "Dégâts" : "Total"}</p>
      </div>
      ${p.des.length > 1 || p.bonus ? `<p class="detail-jet">${e(somme)} = ${e(p.total)}</p>` : ""}
      <p class="tv-jet">Le résultat paraît à la TV et chez votre MJ.</p>
      <div class="gestes-jet"><button type="button" data-jet="fermer">Fermer</button><button type="button" data-jet="relancer">Relancer</button><button type="button" class="principal" data-jet="autre">Autre jet</button></div>`;
  }

  function htmlResultat() {
    const r = montre;
    const p = r.public;
    if (!p) {
      const desLibres = r.genre === "des";
      return `${tete(desLibres ? "Dés non lancés" : "Test non lancé")}<p class="echec-jet" role="status">${e(r.phrase || "Ce test n'a pas pu être lancé : relancez-le, ou demandez à votre MJ.")}</p>
        <div class="gestes-jet"><button type="button" data-jet="fermer">Fermer</button><button type="button" class="principal" data-jet="autre">Relancer</button></div>`;
    }
    if (p.genre === "des") return htmlResultatDes(p);
    const morceaux = [`${e(p.carac_nom)} ${p.base}`];
    if (p.competence) morceaux.push(`${e(p.competence)} ${signe(p.bonus)}`);
    if (p.modificateur) morceaux.push(`modificateur ${signe(p.modificateur)}`);
    // Les ajustements : les cartons (jets_distance.ajustements) et l'avantage dépensé ; le détail les dit sous le résultat.
    for (const a of p.ajustements || []) morceaux.push(`${a.libelle === "Avantage" ? "avantage" : "carton"} ${signe(a.valeur)}`);
    return `${tete("Le résultat")}
      <p class="test-jet">${e(p.nom)} · ${e(p.carac_nom)}${p.competence ? ` (${e(p.competence)})` : ""}</p>
      <div class="resultat-jet" data-issue="${e(p.issue)}" role="status">
        <p class="de-jet">${deux(p.de)}</p>
        <p class="issue-jet">${e(p.issue_nom)}</p>
      </div>
      <p class="detail-jet">${morceaux.join(" · ")} : il fallait ${p.visee} ou moins.</p>
      ${htmlAjustements(p.ajustements)}
      ${p.critiques?.offensive ? `<p class="offensive-jet">Posture offensive : critiques de 01 à ${deux(p.critiques.reussite)} et de ${e(p.critiques.echec)} à 100.</p>` : ""}
      ${htmlErreur()}${htmlDesDuTest(p, r.id)}
      <p class="tv-jet">Le résultat paraît à la TV et chez votre MJ.</p>
      <div class="gestes-jet"><button type="button" data-jet="fermer">Fermer</button><button type="button" class="principal" data-jet="autre">Un autre test</button></div>`;
  }

  function dessiner() {
    dessinerBouton();
    if (!mode) return;
    if (!heros() && mode !== "resultat") return fermer();
    if (mode === "demande" && !etat.demande) mode = "choix";
    accorderChoix();
    feuille.dataset.mode = mode;
    feuille.dataset.volet = mode === "choix" ? volet : "";
    // Le défilement de la feuille reste où il était : un réglage touché ne la ramène pas en haut.
    const haut = feuille.scrollTop;
    feuille.innerHTML = mode === "choix" ? htmlChoix() : mode === "demande" ? htmlDemande() : mode === "roule" ? htmlRoule() : htmlResultat();
    feuille.scrollTop = haut;
    const pause = Boolean(etat?.pause);
    for (const b of feuille.querySelectorAll("[data-comp], .lancer-jet, .arme-jet")) if (pause || occupe) b.disabled = true;
  }

  // ---------------------------------------------------------------- ouvrir, fermer

  function ouvrir(m) {
    const deja = Boolean(mode);
    mode = m;
    erreur = "";
    if (m === "choix" || m === "demande") {
      carac = "";
      comp = "";
      mod = 0;
      aventure = false;
      avecAvantage = false;
    }
    voile.hidden = false;
    feuille.hidden = false;
    document.body.classList.add("jet-ouvert");
    dessiner();
    if (!deja) feuille.focus({ preventScroll: true });
  }

  function fermer() {
    if (!mode) return;
    mode = "";
    erreur = "";
    clearTimeout(minuterie);
    tard = false;
    voile.hidden = true;
    feuille.hidden = true;
    feuille.innerHTML = "";
    document.body.classList.remove("jet-ouvert");
    dessinerBouton();
    if (!bouton.hidden) bouton.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- lire, lancer

  function recu(r) {
    etat = r;
    // Le résultat montré a changé chez l'atelier (le MJ a annulé son dé d'aventure) : la feuille le relit.
    if (!lance && montre && r.dernier && r.dernier.id === montre.id) montre = r.dernier;
    // Le résultat de notre jet est arrivé (ou son échec).
    if (lance && r.dernier && r.dernier.id === lance && r.dernier.statut !== "a-appliquer") {
      montre = r.dernier;
      lance = "";
      clearTimeout(minuterie);
      tard = false;
      if (mode) mode = "resultat";
      else ouvrir("resultat");
    }
    // Un test demandé par le MJ, pas encore vu ici : la feuille s'ouvre d'elle-même, sauf pendant qu'on écrit ou qu'un dé
    // roule ; le bouton doré le rappelle sinon.
    const d = r.demande;
    if (d && !vues.includes(d.id)) {
      const ecrit = document.activeElement?.matches?.("input, textarea, select, [contenteditable]");
      if (!ecrit && mode !== "roule") {
        vues.push(d.id);
        garderVues(vues);
        ouvrir("demande");
        if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.([60, 40, 60]);
      }
    }
    dessiner();
  }

  async function relire() {
    const n = ++lecture;
    try {
      const r = await demander("GET");
      if (n !== lecture) return;
      suivreMainLevee();
      recu(r);
    } catch (err) {
      if (err.status === 401) {
        etat = null;
        fermer();
        bouton.hidden = true;
      }
    }
  }

  const bientot = () => {
    clearTimeout(relance);
    relance = setTimeout(relire, 100);
  };

  async function lancer(corps) {
    if (occupe) return;
    occupe = true;
    erreur = "";
    lecture += 1;
    const avant = mode;
    mode = "roule";
    dessiner();
    try {
      const r = await demander("POST", corps);
      lance = r.lance;
      occupe = false;
      // Sans nouvelle du flux, la page relit d'elle-même ; au-delà d'ATTENTE, elle dit que l'atelier tarde.
      setTimeout(() => lance && relire(), 1500);
      setTimeout(() => lance && relire(), 5000);
      clearTimeout(minuterie);
      tard = false;
      minuterie = setTimeout(() => {
        if (lance && mode === "roule") {
          tard = true;
          dessiner();
        }
      }, ATTENTE);
      recu(r);
    } catch (err) {
      occupe = false;
      mode = avant;
      erreur = err.status === 423 ? "Le coin est en pause : votre MJ le rouvrira." : err.message;
      dessiner();
      relire();
    }
  }

  // « Mon avantage : changer l'effet » : après le lancer, pour le dé d'aventure ou de mésaventure du dernier test.
  async function changerEffet(jet, de, face) {
    if (change || occupe) return;
    change = true;
    erreur = "";
    dessiner();
    try {
      recu(await demander("POST", { jet, de, face }, "/api/jets/face"));
      // Sans nouvelle du flux, la page relit d'elle-même.
      setTimeout(relire, 1500);
      setTimeout(relire, 5000);
    } catch (err) {
      erreur = err.status === 423 ? "Le coin est en pause : votre MJ le rouvrira." : err.message;
      relire();
    }
    change = false;
    dessiner();
  }

  // ---------------------------------------------------------------- les gestes

  bouton.addEventListener("click", () => {
    if (mode) return fermer();
    ouvrir(etat?.demande ? "demande" : "choix");
  });
  voile.addEventListener("click", fermer);
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && mode) fermer();
  });
  feuille.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.jet === "fermer") return fermer();
    if (b.dataset.jet === "autre") {
      montre = null;
      return ouvrir(etat?.demande ? "demande" : "choix");
    }
    // ---- Lot G ----
    if (b.dataset.jet === "relancer" && dernierDes) return lancer(dernierDes);
    if (b.dataset.volet) {
      volet = b.dataset.volet;
      erreur = "";
      return dessiner();
    }
    if (b.dataset.faces) {
      faces = Number(b.dataset.faces);
      return dessiner();
    }
    if (b.dataset.nombre) {
      nombre = Math.max(1, Math.min(NOMBRE_MAX, nombre + Number(b.dataset.nombre)));
      return dessiner();
    }
    if (b.dataset.bonus) {
      bonus = Math.max(-BONUS_MAX, Math.min(BONUS_MAX, bonus + Number(b.dataset.bonus)));
      return dessiner();
    }
    if (b.dataset.des === "libres") {
      dernierDes = { des: expression(nombre, faces, bonus) };
      return lancer(dernierDes);
    }
    if (b.dataset.arme !== undefined) {
      const w = heros()?.armes?.[Number(b.dataset.arme)];
      if (!w) return;
      dernierDes = { arme: w.nom, des: w.degats };
      return lancer(dernierDes);
    }
    if (b.dataset.changer && montre) return changerEffet(montre.id, b.dataset.changer, Number(b.dataset.face));
    if (b.dataset.carac) {
      carac = b.dataset.carac;
      erreur = "";
      return dessiner();
    }
    if (b.dataset.mod) {
      const max = etat?.modificateur_max || 50;
      mod = Math.max(-max, Math.min(max, mod + Number(b.dataset.mod)));
      return dessiner();
    }
    // Une compétence se choisit, elle ne lance rien ; retoucher la même la retire (test demandé). Le dé ne part qu'avec « Lancer ».
    if (b.dataset.comp !== undefined) {
      comp = b.dataset.comp !== "" && b.dataset.comp === comp && mode === "demande" ? "" : b.dataset.comp;
      return dessiner();
    }
    if (b.dataset.lancer === "demande" && mode === "demande" && etat?.demande) {
      return lancer({ demande: etat.demande.id, competence: comp, ...desDuTest() });
    }
    if (b.dataset.lancer === "choix" && mode === "choix" && carac) {
      return lancer({ carac, competence: comp, modificateur: mod, ...desDuTest() });
    }
  });
  // La case « Ajouter un dé d'aventure » : une vraie case à cocher (le lecteur d'écran la dit), redessinée au changement.
  feuille.addEventListener("change", (ev) => {
    if (ev.target.matches("[data-aventure]")) {
      aventure = ev.target.checked;
      dessiner();
    }
    if (ev.target.matches("[data-avantage]")) {
      avecAvantage = ev.target.checked;
      dessiner();
    }
  });

  ecouterFlux("demandes", bientot);
  ecouterFlux("jets", bientot);
  ecouterFlux("table", bientot);
  ecouterFlux("pause", bientot);
  // Un test demandé qui passe (dix minutes) : la page le compte avec sa propre horloge, en relisant de loin en loin.
  setInterval(() => {
    if (document.visibilityState === "visible" && (etat?.demande || lance)) relire();
  }, 30000);
  relire();
  monte = { bouton, relire };
  return monte;
}
