// Les billets privés, dans le coin des joueurs : le mot secret que le MJ glisse à un seul joueur pendant la
// séance (« Toi seul entends un murmure derrière la porte »), ou un document qu'il lui remet en main propre. Un avis
// discret paraît en haut de l'écran, sur le carnet comme sur la page « La table » : « Votre MJ vous a glissé un billet ».
// Le billet s'ouvre sur un papier qui reprend celui qu'on découpe (billets.css de l'atelier) ; l'ouvrir le note lu, et le
// MJ le voit aussitôt. « Mes billets », dans le carnet, les garde du plus récent au plus ancien.
//
// Le serveur ne rend que les billets du joueur connecté (sa session) ; le flux (flux.js, sujet « prives ») ne porte que
// le sujet, la page relit GET /api/prives. Rien ne s'écrit d'ici que la lecture. Tout texte passe par echapper.
//
// Pour l'inclure dans une page du coin : import { monter as monterBillets } from "./prives.js"; monterBillets();
// Dans le carnet, la section : monterBillets().section(conteneur, { sommaire, seule }).

import { echapper as e } from "../api.js";
import { htmlDocument, imagesPretes, titreSurLePapier } from "../documents/rendu.js";
import { ecouterFlux } from "./flux.js";

const FEUILLES = ["../../css/documents.css", "../../css/prives-coin.css"].map((c) => new URL(c, import.meta.url).pathname);
const ECARTES = "prives.ecartes"; // les billets dont l'avis a été remis à plus tard, sur cet appareil
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

let monte = null;

async function demander(methode, url) {
  let r;
  try {
    r = await fetch(url, { method: methode, headers: methode === "GET" ? {} : { "Content-Type": "application/json" },
      body: methode === "GET" ? undefined : "{}" });
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

function heure(iso) {
  const d = new Date(iso || "");
  return Number.isNaN(d.getTime()) ? "" : `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
}

// « à 21 h 02 » aujourd'hui, « le 7 novembre à 21 h 02 » un autre jour.
function quand(iso) {
  const d = new Date(iso || "");
  if (Number.isNaN(d.getTime())) return "";
  const auj = new Date();
  const jour = d.toDateString() === auj.toDateString() ? "" : `le ${d.getDate() === 1 ? "1er" : d.getDate()} ${MOIS[d.getMonth()]} `;
  return `${jour}à ${heure(iso)}`;
}

const et = (noms) => (noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}` : noms[0] || "");

function lireEcartes() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(ECARTES) || "[]").filter((x) => typeof x === "string").slice(-80));
  } catch {
    return new Set();
  }
}

function garderEcartes(ensemble) {
  try {
    sessionStorage.setItem(ECARTES, JSON.stringify([...ensemble].slice(-80)));
  } catch {
    // navigation privée : l'avis pourra revenir une fois, rien de plus
  }
}

function poserFeuilles() {
  for (const href of FEUILLES) {
    if (document.querySelector(`link[href="${href}"]`)) continue;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    document.head.append(l);
  }
}

// Ce qui se lit dans la liste et dans l'avis : « Billet », « Lettre », « Affiche »…
const GENRES = { lettre: "Lettre", affiche: "Affiche", note: "Note", parchemin: "Parchemin", plan: "Plan" };
const nature = (b) => (b.nature === "document" ? GENRES[b.genre] || "Document" : "Billet");
const titreDe = (b) => (b.nature === "document" ? b.nom : b.titre) || (b.nature === "document" ? "Un document" : "Un billet secret");

// Le papier du billet : comme celui qu'on découpe, le prénom dehors, le texte au parchemin, le rabat qui se relève.
function htmlBillet(b) {
  if (b.nature === "document") {
    const legende = !titreSurLePapier(b) && b.nom ? `<p class="legende-prive">${e(b.nom)}</p>` : "";
    return `<div class="document-prive">${htmlDocument(b)}${legende}</div>`;
  }
  return `
    <article class="billet-prive">
      <header class="dehors-prive">
        <span class="sceau-prive" aria-hidden="true"></span>
        <p class="pour-prive"><span>Pour</span><b>${e(b.pour || "vous")}</b></p>
        <p class="quand-prive">${e(quand(b.envoye))}</p>
      </header>
      <div class="dedans-prive">
        ${b.titre ? `<h2>${e(b.titre)}</h2>` : ""}
        <p class="texte-prive">${e(b.texte || "")}</p>
        ${(b.aussi || []).length ? `<p class="aussi-prive">Aussi remis à ${e(et(b.aussi))}.</p>` : ""}
        <span class="rabat-prive" aria-hidden="true"></span>
      </div>
    </article>`;
}

export function monter() {
  if (monte) return monte;
  poserFeuilles();
  const avis = document.createElement("div");
  avis.className = "avis-prive";
  avis.setAttribute("role", "status");
  avis.hidden = true;
  avis.innerHTML = `
    <span class="pli-avis" aria-hidden="true"></span>
    <p class="mot-avis"></p>
    <div class="gestes-avis"><button type="button" class="lire-avis">Lire</button><button type="button" class="plus-tard-avis">Plus tard</button></div>`;
  // Dans l'en-tête du coin, sous les onglets (prives-coin.css) : l'en-tête grandit le temps de l'avis, et rien de ce
  // qu'on touche (onglets, « Bouger », zoom) ne passe dessous. Une page sans en-tête le garde en haut de l'écran.
  const tete = document.querySelector(".tete-coin");
  (tete || document.body).append(avis);
  const montrerAvis = (oui) => {
    avis.hidden = !oui;
    tete?.classList.toggle("avec-avis-prive", oui);
  };

  const lecture = document.createElement("div");
  lecture.className = "lecture-prive";
  lecture.hidden = true;
  lecture.setAttribute("role", "dialog");
  lecture.setAttribute("aria-modal", "true");
  lecture.setAttribute("aria-label", "Un billet de votre MJ");
  lecture.innerHTML = `
    <div class="cadre-lecture">
      <div class="papier-lecture"></div>
      <p class="dit-lecture" role="status"></p>
      <div class="gestes-lecture"><button type="button" class="suivant-lecture" hidden>Billet suivant</button><button type="button" class="fermer-lecture">Fermer</button></div>
    </div>`;
  document.body.append(lecture);

  let etat = null; // la dernière réponse de GET /api/prives
  let ouvert = null; // l'identifiant du billet ouvert
  let lectureEnCours = 0;
  let relance = 0;
  let avant = null; // ce qui avait le focus avant d'ouvrir
  const connus = new Set(); // les billets déjà vus sur cette page : un nouveau fait paraître l'avis
  const ecartes = lireEcartes();
  const sections = new Set();

  const billets = () => etat?.billets || [];
  const nonLus = () => billets().filter((b) => !b.lu);

  function dessinerAvis() {
    const attendent = nonLus().filter((b) => !ecartes.has(b.id));
    if (!attendent.length || ouvert) {
      montrerAvis(false);
      return;
    }
    const docs = attendent.filter((b) => b.nature === "document").length;
    const billets = attendent.length - docs;
    // Un billet se glisse, un document se remet : « 2 billets » ne doit pas compter un document qui l'accompagne.
    const nombre = (k, mot) => (k > 1 ? `${k} ${mot}s` : `un ${mot}`);
    const glisses = billets ? `glissé ${nombre(billets, "billet")}` : "";
    const remis = docs ? `remis ${nombre(docs, "document")}` : "";
    avis.querySelector(".mot-avis").textContent = `Votre MJ vous a ${[glisses, remis].filter(Boolean).join(" et ")}`;
    montrerAvis(true);
  }

  function dessinerSections() {
    for (const s of [...sections]) {
      if (!s.racine.isConnected) {
        sections.delete(s);
        continue;
      }
      const liste = billets();
      s.racine.hidden = s.seule && !liste.length;
      if (s.ligne) {
        const n = nonLus().length;
        s.ligne.querySelector(".compte").textContent = liste.length ? (n ? `${n} nouveau${n > 1 ? "x" : ""}` : String(liste.length)) : "";
      }
      s.racine.querySelector(".liste-prives").innerHTML = liste.length ? `<ol class="prives-coin">${liste.map((b) => `
        <li class="${b.lu ? "lu" : "nouveau"}"><button type="button" data-prive="${e(b.id)}">
          <span class="genre-prive">${e(nature(b))}</span>
          <span class="titre-prive">${e(titreDe(b))}</span>
          <span class="date-prive">${e(b.nature === "document" ? "remis" : "glissé")} ${e(quand(b.envoye))}${b.lu ? "" : " · <b>nouveau</b>"}</span>
        </button></li>`).join("")}</ol>` : '<p class="vide">Rien pour l\'instant. Ce que votre MJ vous glisse en secret pendant la séance paraît ici, pour vous seul.</p>';
    }
  }

  function dessiner() {
    dessinerAvis();
    dessinerSections();
    // Un billet arrivé pendant qu'on en lit un autre : « Billet suivant » y mène.
    if (ouvert) lecture.querySelector(".suivant-lecture").hidden = !nonLus().some((x) => x.id !== ouvert);
  }

  async function relire() {
    const n = ++lectureEnCours;
    let r;
    try {
      r = await demander("GET", "/api/prives");
    } catch (err) {
      if (err.status === 401) {
        montrerAvis(false);
        etat = null;
      }
      return;
    }
    if (n !== lectureEnCours) return;
    const nouveaux = r.billets.filter((b) => !b.lu && !connus.has(b.id));
    const premier = etat === null;
    etat = r;
    for (const b of r.billets) connus.add(b.id);
    if (ouvert && !r.billets.some((b) => b.id === ouvert)) {
      lecture.querySelector(".papier-lecture").innerHTML = '<p class="repris-prive">Votre MJ a repris ce billet.</p>';
      lecture.querySelector(".suivant-lecture").hidden = true;
    }
    // Un billet qui arrive pendant qu'on regarde : l'avis glisse de nouveau, pour qu'on le remarque.
    if (nouveaux.length && !premier) {
      avis.classList.remove("arrive");
      void avis.offsetWidth;
      avis.classList.add("arrive");
      // Android seulement, et après un premier toucher : sinon le navigateur le refuse en le disant.
      if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(40);
    }
    dessiner();
  }

  const bientot = () => {
    clearTimeout(relance);
    relance = setTimeout(relire, 100);
  };

  async function ouvrir(id) {
    const b = billets().find((x) => x.id === id);
    if (!b) return;
    if (!ouvert) avant = document.activeElement;
    ouvert = id;
    montrerAvis(false);
    const papier = lecture.querySelector(".papier-lecture");
    papier.innerHTML = htmlBillet(b);
    papier.scrollTop = 0;
    lecture.querySelector(".dit-lecture").textContent = "";
    lecture.querySelector(".suivant-lecture").hidden = !nonLus().some((x) => x.id !== id);
    lecture.hidden = false;
    document.body.classList.add("avec-lecture-prive");
    requestAnimationFrame(() => lecture.classList.add("ouverte"));
    lecture.querySelector(".fermer-lecture").focus({ preventScroll: true });
    if (b.nature === "document") imagesPretes(papier);
    if (b.lu) return;
    try {
      const r = await demander("POST", `/api/prives/${encodeURIComponent(id)}/lu`);
      b.lu = r.lu;
    } catch (err) {
      if (err.status === 404) return relire();
      lecture.querySelector(".dit-lecture").textContent = "Votre MJ ne saura pas encore que vous l'avez lu : réessayez plus tard.";
      return;
    }
    dessinerSections();
  }

  function fermer() {
    if (!ouvert) return;
    ouvert = null;
    lecture.classList.remove("ouverte");
    lecture.hidden = true;
    document.body.classList.remove("avec-lecture-prive");
    if (avant?.isConnected) avant.focus({ preventScroll: true });
    avant = null;
    dessiner();
  }

  avis.querySelector(".lire-avis").addEventListener("click", () => {
    const b = nonLus().find((x) => !ecartes.has(x.id)) || nonLus()[0];
    if (b) ouvrir(b.id);
  });
  avis.querySelector(".plus-tard-avis").addEventListener("click", () => {
    for (const b of nonLus()) ecartes.add(b.id);
    garderEcartes(ecartes);
    dessinerAvis();
  });
  lecture.querySelector(".fermer-lecture").addEventListener("click", fermer);
  lecture.querySelector(".suivant-lecture").addEventListener("click", () => {
    const b = nonLus().find((x) => x.id !== ouvert);
    if (b) ouvrir(b.id);
  });
  lecture.addEventListener("click", (ev) => {
    if (ev.target === lecture) fermer();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && ouvert) fermer();
  });

  ecouterFlux("prives", bientot);
  relire();

  // « Mes billets », dans le carnet (ou sous la page « carnet fermé », seulement s'il y en a) : la liste se relit avec
  // l'avis, chaque ligne ouvre son billet.
  function section(conteneur, { sommaire = null, seule = false } = {}) {
    if (!conteneur) return;
    const s = document.createElement("section");
    s.className = seule ? "feuille-coin mes-billets seule" : "section-coin mes-billets";
    s.id = "mes-billets";
    s.innerHTML = `
      <header class="tete-section"><h2>Mes billets</h2><span class="filet" aria-hidden="true"></span>
        <p class="sous-titre">Les mots que votre MJ vous a glissés en secret, et les documents remis en main propre : pour vous seul.</p></header>
      <div class="liste-prives"><p class="vide">Lecture…</p></div>`;
    conteneur.append(s);
    s.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-prive]");
      if (b) ouvrir(b.dataset.prive);
    });
    let ligne = null;
    if (sommaire) {
      sommaire.insertAdjacentHTML("beforeend", `<li><a href="#carnet" data-aller="mes-billets"><span>Mes billets</span><span class="points" aria-hidden="true"></span><span class="compte"></span></a></li>`);
      ligne = sommaire.lastElementChild;
    }
    sections.add({ racine: s, ligne, seule });
    if (etat) dessinerSections();
    else s.hidden = seule;
  }

  monte = { relire, section, ouvrir };
  return monte;
}
