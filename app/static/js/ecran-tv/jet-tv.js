// Le bandeau d'un test lancé à distance (lot F3, jets_mj.py) sur la TV : « Ysolde, test de Physique (Athlétisme) », le dé
// en grand et l'issue, six secondes en tout (le fondu compris), en haut au centre, sous le bandeau du combat. Un critique se voit : l'or vif
// pour une réussite critique, le rouge sang pour un échec critique. Plusieurs jets de suite s'empilent (trois au plus).
//
// Il arrive par un message à part du canal de la TV ({"type": "jet"}), comme le pointeur : rien ne s'écrit dans l'état de
// la table, une TV qui se rallume ne rejoue pas un vieux jet. Le message ne porte que le prénom public du héros, sa
// couleur, le test, le dé et l'issue : ni la valeur visée, ni le modificateur du MJ, ni rien de secret.
//
// Lot G : les dés libres et les dégâts d'une arme (message {"type": "des"}) : « Ysolde, 2D6+1 (Épée) », le total en
// grand, les faces à côté. Et sous un test, le dé d'aventure ou de mésaventure : sa face et son effet, annoncés (le MJ
// tranche, rien ne se calcule ici).
//
// La TV du salon a Chromium 79 : rien au-delà d'ES2019 ici (ni « ?. », ni « ?? »), et la feuille (table.css) sans gap en
// flex, ni inset, ni :has().

import { echapper } from "../api.js";

const DUREE = 5300; // millisecondes à l'écran avant le fondu
const SORTIE = 700; // le fondu de sortie : parti au bout de six secondes
const MAX = 3;
const ISSUES = { "reussite-critique": "Réussite critique", reussite: "Réussite", echec: "Échec", "echec-critique": "Échec critique" };
const COULEUR = /^#[0-9a-fA-F]{3,8}$/;
const EFFETS = ["Mouvement", "Posture", "In extremis"];
const EXPRESSION = /^[1-5]D(4|6|8|10|12|20|100)([+-]([1-9]|1[0-9]|20))?$/;

function entier(v, bas, haut) {
  return Number.isInteger(v) && v >= bas && v <= haut;
}

// Le dé d'aventure ou de mésaventure d'un test : { face, effet, choisie }, ou rien s'il est illisible.
function htmlDeAventure(x, nom, classe) {
  if (!x || !entier(x.face, 1, 6) || EFFETS.indexOf(x.effet) < 0) return "";
  return `<p class="aventure-jet-tv ${classe}"><span class="face-tv">${x.face}</span>${nom} : <b>${echapper(x.effet)}</b>${x.choisie ? " <span>(effet choisi)</span>" : ""}</p>`;
}

function texte(v, max) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export class JetTv {
  constructor(parent) {
    this.pile = document.createElement("div");
    this.pile.className = "jets-tv";
    this.pile.setAttribute("aria-live", "polite");
    (parent || document.body).appendChild(this.pile);
  }

  recevoir(msg) {
    if (msg && msg.type === "des") return this.recevoirDes(msg);
    if (!msg || !Number.isInteger(msg.de) || msg.de < 1 || msg.de > 100 || !ISSUES[msg.issue]) return;
    const nom = texte(msg.nom, 60) || "Un héros";
    const carac = texte(msg.carac, 20);
    const competence = texte(msg.competence, 60);
    const el = document.createElement("div");
    el.className = `jet-tv ${msg.issue}`;
    if (COULEUR.test(msg.couleur || "")) el.style.borderLeftColor = msg.couleur;
    // Les dés du MJ n'ont pas de caractéristique : « Le MJ, Attaque », ou « Le MJ, un test ».
    const quoi = carac ? `test de ${echapper(carac)}${competence ? ` <span>(${echapper(competence)})</span>` : ""}` : (competence ? echapper(competence) : "un test");
    el.innerHTML = `<p class="qui-jet-tv"><b>${echapper(nom)}</b>, ${quoi}</p>
      <p class="resultat-jet-tv"><span class="de-jet-tv">${msg.de < 10 ? `0${msg.de}` : msg.de}</span><span class="issue-jet-tv">${echapper(ISSUES[msg.issue])}</span></p>
      ${htmlDeAventure(msg.aventure, "Dé d'aventure", "aventure")}${htmlDeAventure(msg.mesaventure, "Dé de mésaventure", "mesaventure")}`;
    this.montrer(el);
  }

  // « Ysolde, 2D6+1 (Épée) » : le total en grand, les faces à côté.
  recevoirDes(msg) {
    const des = Array.isArray(msg.des) ? msg.des : [];
    if (!EXPRESSION.test(msg.texte || "") || !des.length || des.length > 5 || !des.every((x) => entier(x, 1, 100))
      || !entier(msg.bonus, -20, 20) || !entier(msg.total, -20, 520)) return;
    const nom = texte(msg.nom, 60) || "Un héros";
    const arme = texte(msg.arme, 60);
    // « 7 + 6 + 2, bonus +2 » : le bonus dit comme tel, sinon il se lirait comme un dé de plus.
    const faces = des.join(" + ") + (msg.bonus ? `, bonus ${msg.bonus > 0 ? "+" : "−"}${Math.abs(msg.bonus)}` : "");
    const el = document.createElement("div");
    el.className = "jet-tv des-tv";
    if (COULEUR.test(msg.couleur || "")) el.style.borderLeftColor = msg.couleur;
    el.innerHTML = `<p class="qui-jet-tv"><b>${echapper(nom)}</b>, ${echapper(msg.texte)}${arme ? ` <span>(${echapper(arme)})</span>` : ""}</p>
      <p class="resultat-jet-tv"><span class="de-jet-tv">${msg.total}</span><span class="faces-des-tv">${des.length > 1 || msg.bonus ? echapper(faces) : ""}</span></p>`;
    this.montrer(el);
  }

  montrer(el) {
    this.pile.appendChild(el);
    while (this.pile.children.length > MAX) this.pile.removeChild(this.pile.firstChild);
    // Le premier dessin sans la classe, puis la classe : l'entrée s'anime (deux images, sûr sur Chromium 79).
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("visible")));
    setTimeout(() => {
      el.classList.remove("visible");
      el.classList.add("sortie");
      setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, SORTIE);
    }, DUREE);
  }
}
