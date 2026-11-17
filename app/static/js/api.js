// Vrai quand l'onglet se ferme ou passe en arrière-plan : les derniers envois partent en « keepalive »
// pour survivre à la fermeture de la page (le navigateur limite ces envois à 64 Ko).
let enPartance = false;
export function partance(oui) {
  enPartance = oui;
}

// Par Internet (atelier.exemple.org), une session expirée répond 401 : retour à la page de connexion.
function versConnexionSi401(r) {
  if (r.status !== 401) return;
  const ici = location.pathname + location.search + location.hash;
  location.href = "/connexion?suite=" + encodeURIComponent(ici);
}

// Une écriture que le serveur suspend à une question (409 portant « question » : l'autre MJ a la main sur la TV) : la page
// qui sait la poser (surQuestion, mj/main-tv.js) la pose, et la même requête repart avec « reprendre ». Ailleurs (la TV,
// le coin des joueurs), ou sur un refus, l'erreur reste une erreur.
let questionneur = null;
export function surQuestion(fn) {
  questionneur = fn;
}

// Une fiche trop lourde pour « keepalive » (une carte, un grand plan, un long scénario) et un onglet qui se ferme ou que
// l'iPad met en veille : l'envoi peut être coupé en route. Il est donc gardé dans le navigateur le temps de partir, effacé
// dès que le serveur répond, et rattrapé à la prochaine ouverture de l'atelier s'il est resté (rattraperEnvois).
const KEEPALIVE_MAX = 60000;
const ENVOI_GARDE = "envoi-en-partance:";
const ENVOI_GARDE_MAX = 2_000_000; // caractères : au-delà, le navigateur n'a pas la place
const ENVOI_GARDE_JOURS = 7;

function garderEnvoi(methode, url, corps, texte) {
  // Seulement une fiche envoyée avec sa version : rejouée après un autre enregistrement, le serveur la refuse (409).
  if (methode !== "PUT" || !corps || corps.constructor !== Object || !corps.version_base || texte.length > ENVOI_GARDE_MAX) return;
  try {
    localStorage.setItem(ENVOI_GARDE + url, JSON.stringify({ quand: Date.now(), corps: texte }));
  } catch {
    // stockage plein ou refusé : l'envoi part quand même, sans filet
  }
}

function oublierEnvoi(url) {
  try {
    localStorage.removeItem(ENVOI_GARDE + url);
  } catch {
    // stockage refusé : rien n'y était
  }
}

// À l'ouverture de l'atelier, avant la première page (elle lirait la fiche d'avant) : les envois restés en suspens
// repartent tels quels. Reçu : dit au MJ. Refusé (un autre écran a enregistré depuis, fiche disparue) : abandonné, comme
// avant. Serveur injoignable : gardé pour la prochaine fois. Jamais plus de quelques secondes d'attente.
export async function rattraperEnvois(delai = 5000) {
  let cles = [];
  try {
    cles = Object.keys(localStorage).filter((c) => c.startsWith(ENVOI_GARDE));
  } catch {
    return 0;
  }
  let rattrapes = 0;
  for (const cle of cles) {
    const url = cle.slice(ENVOI_GARDE.length);
    let garde = null;
    try {
      garde = JSON.parse(localStorage.getItem(cle));
    } catch {
      // illisible : jeté plus bas
    }
    if (!garde || typeof garde.corps !== "string" || !url.startsWith("/api/") || Date.now() - garde.quand > ENVOI_GARDE_JOURS * 86400000) {
      oublierEnvoi(url);
      continue;
    }
    try {
      const r = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: garde.corps, signal: AbortSignal.timeout(delai) });
      if (r.status >= 502) continue;
      oublierEnvoi(url);
      if (r.ok) rattrapes += 1;
    } catch {
      // serveur injoignable ou trop lent : l'envoi reste gardé
    }
  }
  if (rattrapes) toast(rattrapes > 1 ? `${rattrapes} enregistrements restés en suspens à la fermeture de la page ont été rattrapés.` : "Un enregistrement resté en suspens à la fermeture de la page a été rattrapé.");
  return rattrapes;
}

async function requete(methode, url, corps) {
  const options = { method: methode, headers: {} };
  if (corps instanceof FormData) options.body = corps;
  else if (corps !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(corps);
    if (enPartance && options.body.length < KEEPALIVE_MAX) options.keepalive = true;
    else if (enPartance) garderEnvoi(methode, url, corps, options.body);
  }
  let r;
  try {
    r = await fetch(url, options);
  } catch {
    const erreur = new Error("serveur injoignable, vérifiez la connexion");
    erreur.status = 0;
    throw erreur;
  }
  // Le serveur a répondu (reçu, ou refusé : le renvoyer n'y changerait rien) : plus rien à rattraper pour cette fiche.
  if (methode === "PUT" && !(r.status >= 502)) oublierEnvoi(url);
  if (!r.ok) {
    versConnexionSi401(r);
    let message = `${r.status}`;
    let reponse = null;
    try {
      reponse = await r.json();
      message = reponse.detail || message;
    } catch {
      // réponse sans JSON
    }
    const question = r.status === 409 && reponse && reponse.question;
    if (question && questionneur && corps && corps.constructor === Object && !corps.reprendre && (await questionneur(question))) {
      return requete(methode, url, { ...corps, reprendre: true });
    }
    const erreur = new Error(message);
    erreur.status = r.status;
    throw erreur;
  }
  return r.status === 204 ? null : r.json();
}

// La liste des séances (23 ko) est demandée par l'en-tête et par la page en même temps : les lectures presque simultanées
// partagent une seule requête (chacune reçoit sa propre copie). Toute écriture de cet écran vide la mémoire.
const PARTAGEES = new Set(["/api/seances"]);
const DELAI_PARTAGE = 700;
const recentes = new Map();
function lirePartagee(url) {
  const vue = recentes.get(url);
  if (vue && Date.now() - vue.quand < DELAI_PARTAGE) return vue.promesse.then((x) => structuredClone(x));
  const promesse = requete("GET", url);
  const entree = { quand: Date.now(), promesse };
  recentes.set(url, entree);
  promesse.catch(() => { if (recentes.get(url) === entree) recentes.delete(url); });
  return promesse.then((x) => structuredClone(x));
}
const ecrire = (methode) => (url, corps) => {
  recentes.clear();
  return requete(methode, url, corps);
};

export const api = {
  get: (url) => (PARTAGEES.has(url) ? lirePartagee(url) : requete("GET", url)),
  post: ecrire("POST"),
  put: ecrire("PUT"),
  patch: ecrire("PATCH"),
  del: (url) => {
    recentes.clear();
    return requete("DELETE", url);
  },
};

// Un texte écrit au fur et à mesure par le serveur (événements « data: {...} ») : chaque événement passe à surEvenement,
// le dernier (« fin ») est rendu. Une erreur annoncée par le flux devient une exception, comme pour api.post.
export async function flux(url, corps, surEvenement) {
  let r;
  try {
    r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps || {}) });
  } catch {
    throw new Error("serveur injoignable, vérifiez la connexion");
  }
  if (!r.ok) {
    versConnexionSi401(r);
    let message = `${r.status}`;
    try {
      message = (await r.json()).detail || message;
    } catch {
      // réponse sans JSON
    }
    throw new Error(message);
  }
  const lecteur = r.body.getReader();
  const decodeur = new TextDecoder();
  let reste = "";
  let fin = null;
  for (;;) {
    const { value, done } = await lecteur.read();
    if (done) break;
    reste += decodeur.decode(value, { stream: true });
    const paquets = reste.split("\n\n");
    reste = paquets.pop();
    for (const paquet of paquets) {
      if (!paquet.startsWith("data: ")) continue;
      const ev = JSON.parse(paquet.slice(6));
      if (ev.t === "erreur") throw new Error(ev.message);
      if (ev.t === "fin") fin = ev;
      surEvenement?.(ev);
    }
  }
  if (!fin) throw new Error("rédaction interrompue");
  return fin;
}

// Fusion à trois après un refus 409 : ce que cet écran a changé depuis sa dernière version connue (base) passe
// par-dessus la version du serveur ; le reste vient du serveur. Les champs gérés ailleurs (illustrations,
// version) viennent toujours du serveur.
const GERES_PAR_LE_SERVEUR = new Set(["id", "cree", "modifie", "illustrations", "illustration"]);
const pareil = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Une liste d'éléments à identifiant (les articles d'une boutique, les bâtiments du sanctuaire) se fusionne élément par
// élément et champ par champ : ce qu'un écran a changé à un article ne ramène pas les autres à son ancienne version.
// Un élément retiré d'un côté reste retiré ; un élément ajouté ici s'ajoute à la fin.
function fusionnerListe(base = [], local = [], serveur = [], id = "id") {
  const cle = (x) => (x && typeof x === "object" ? x[id] : undefined);
  const avant = new Map(base.map((x) => [cle(x), x]));
  const ici = new Map(local.map((x) => [cle(x), x]));
  const resultat = [];
  for (const s of serveur) {
    const k = cle(s);
    const b = avant.get(k);
    const l = ici.get(k);
    if (b && !l) continue; // retiré ici
    if (!b || !l) {
      resultat.push(s);
      continue;
    }
    const f = { ...s };
    for (const champ of new Set([...Object.keys(l), ...Object.keys(b)])) {
      if (!pareil(l[champ], b[champ])) {
        if (champ in l) f[champ] = l[champ];
        else delete f[champ];
      }
    }
    resultat.push(f);
  }
  const auServeur = new Set(serveur.map(cle));
  for (const l of local) if (!avant.has(cle(l)) && !auServeur.has(cle(l))) resultat.push(l);
  // L'ordre de cet écran l'emporte s'il l'a changé (un article monté ou descendu).
  const ordreIci = local.map(cle).filter((k) => resultat.some((x) => cle(x) === k));
  const communs = ordreIci.filter((k) => avant.has(k));
  if (!pareil(base.map(cle).filter((k) => communs.includes(k)), communs)) {
    resultat.sort((a, b) => {
      const ia = ordreIci.indexOf(cle(a));
      const ib = ordreIci.indexOf(cle(b));
      return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    });
  }
  return resultat;
}

// listes : { champ: identifiant } pour les listes à fusionner élément par élément ({ articles: "id" }).
export function fusionner(base, local, serveur, listes = {}) {
  const resultat = { ...serveur };
  for (const cle of new Set([...Object.keys(local), ...Object.keys(base || {})])) {
    if (GERES_PAR_LE_SERVEUR.has(cle)) continue;
    if (!pareil(local[cle], base?.[cle])) {
      if (listes[cle] && Array.isArray(local[cle]) && Array.isArray(serveur[cle])) {
        resultat[cle] = fusionnerListe(Array.isArray(base?.[cle]) ? base[cle] : [], local[cle], serveur[cle], listes[cle]);
      } else if (cle in local) resultat[cle] = local[cle];
      else delete resultat[cle];
    }
  }
  return resultat;
}

export function copie(objet) {
  return JSON.parse(JSON.stringify(objet));
}

// Enregistre une fiche avec sa version. Si un autre écran l'a changée entre-temps (409), relit la version du serveur,
// fusionne à trois avec bases[cle] (la dernière version connue du serveur), renvoie, et reporte dans la fiche locale
// ce qui n'a pas bougé ici pendant l'envoi. Renvoie vrai quand il a fallu fusionner.
export async function enregistrerAvecVersion(url, local, bases, cle, { listes = {} } = {}) {
  const envoye = copie(local);
  let srv;
  let fusion = null;
  try {
    srv = await api.put(url, { ...envoye, version_base: envoye.modifie ?? null });
  } catch (err) {
    if (err.status !== 409) throw err;
    const actuel = await api.get(url);
    fusion = fusionner(bases[cle] || actuel, envoye, actuel, listes);
    srv = await api.put(url, { ...fusion, version_base: actuel.modifie ?? null });
    for (const [k, v] of Object.entries(fusion)) if (JSON.stringify(local[k]) === JSON.stringify(envoye[k])) local[k] = v;
  }
  local.modifie = srv.modifie;
  if (srv.illustrations) {
    local.illustrations = srv.illustrations;
    local.illustration = srv.illustration;
  }
  bases[cle] = copie(srv);
  return Boolean(fusion);
}

export function echapper(texte) {
  return String(texte ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Les messages de l'atelier : un à la fois, en bas à droite de la page (dans un éditeur, en haut à droite du plan, sous
// sa barre) : le haut de la page porte ses boutons, la TV, « Montrer », les actions de la fiche. Un message
// passe après le temps de le lire (quatre secondes au moins, une de plus par quinze caractères), et attend tant qu'on
// survole ses boutons ; il laisse passer les clics vers ce qu'il recouvre. Une erreur reste jusqu'à un clic. Le même
// message répété se fond dans celui qui est affiché au lieu de s'empiler. action = { libelle: "Annuler", faire() } y ajoute un bouton, actions = [...] en
// ajoute plusieurs : le message reste alors dix secondes au moins, et un simple message venu après ne le chasse pas.
// duree, en millisecondes, remplace le temps calculé. Renvoie l'élément du message : un lien qu'on y ajoute reste
// cliquable et ne le ferme pas.
const ERREURS_MAX = 3;
const minuteries = new WeakMap();

function zoneToasts() {
  let zone = document.querySelector(".toasts");
  if (zone) return zone;
  zone = document.createElement("div");
  zone.className = "toasts";
  zone.setAttribute("role", "status");
  document.body.append(zone);
  // L'en-tête, la barre d'un éditeur ou le Tableau qui changent : une erreur restée affichée suit.
  const suivre = () => zone.childElementCount && placerToasts(zone);
  const observateur = new MutationObserver(suivre);
  observateur.observe(document.body, { attributes: true, attributeFilter: ["class", "data-page"] });
  const page = document.getElementById("page");
  if (page) observateur.observe(page, { childList: true });
  // L'état de l'enregistrement qui change (« Hors ligne » et son compte à rebours prennent deux lignes) : le message suit.
  if (page) new MutationObserver(suivre).observe(page, { subtree: true, attributes: true, attributeFilter: ["data-etat"] });
  // Une autre page : les messages de la précédente s'en vont, « Annuler » compris (il parlait de ce qu'on a quitté). Une
  // erreur reste jusqu'à son clic, et un message né du geste qui change de page (moins d'une seconde et demie) aussi.
  let pageVue = document.body.dataset.page;
  new MutationObserver(() => {
    if (document.body.dataset.page === pageVue) return;
    pageVue = document.body.dataset.page;
    for (const t of zone.children) if (t.dataset.genre !== "erreur" && Date.now() - (+t.dataset.ne || 0) > 1500) retirerToast(t);
  }).observe(document.body, { attributes: true, attributeFilter: ["data-page"] });
  addEventListener("resize", suivre);
  // Le clavier de l'iPad ou du téléphone qui s'ouvre : le message remonte au-dessus.
  globalThis.visualViewport?.addEventListener("resize", suivre);
  globalThis.visualViewport?.addEventListener("scroll", suivre);
  // La page défile : la barre du combat ou le bandeau de la séance se collent en haut, le message passe dessous.
  let image = 0;
  document.addEventListener("scroll", () => {
    if (image || !zone.childElementCount) return;
    image = requestAnimationFrame(() => {
      image = 0;
      placerToasts(zone);
    });
  }, { capture: true, passive: true });
  return zone;
}

// Ce qui tient le haut de l'écran : l'en-tête, la barre d'un éditeur, et ce qui s'y colle quand la page défile (la barre
// du combat, le bandeau de la séance, le bouton de la TV d'une fiche), et l'état de l'enregistrement près du titre. Le
// message ne cache ni « Suivant », ni « Jouer », ni ce que montre la TV, ni le compte à rebours d'un nouvel essai, et son
// « Annuler » ne se pose jamais sur eux.
const HAUT_DE_L_ECRAN = ".entete, .barre-carte, .barre-combat.barre-page, .bandeau-seance, .tv-colle .bouton-tv, .temoin-enregistrement";

// Ce qui tient le bas de l'écran, au droit des messages : l'avis des noms encore inconnus et ses « Marquer connu », le
// pied du Tableau quand il couvre la page. Le message se pose au-dessus.
const BAS_DE_L_ECRAN = ".avis-secrets, .tableau-mj:not([hidden]) .tableau-pied";

// Dans l'atelier, en bas à droite, au-dessus du clavier et de ce qui tient le bas de l'écran ; dans un éditeur (et hors
// de l'atelier), sous ce qui tient le haut de l'écran. Toujours à gauche du Tableau quand il pousse la page, et du
// panneau d'un éditeur : le message se pose sur le coin du plan, pas sur les réglages de l'outil.
function placerToasts(zone) {
  let bord = innerWidth;
  const tableau = document.querySelector(".tableau-mj:not([hidden])");
  // Sous 1100 px, le Tableau couvre la droite de la page : le message passe à sa gauche s'il y reste de la place.
  const bordTableau = tableau ? tableau.getBoundingClientRect().left : 0;
  if (tableau && document.body.classList.contains("tableau-ouvert") && (innerWidth >= 1100 || bordTableau >= 360)) bord = bordTableau;
  const panneau = document.querySelector(".editeur > .panneau");
  const r = panneau?.getBoundingClientRect();
  if (r && r.width && r.left > innerWidth / 2) bord = Math.min(bord, r.left);
  zone.style.right = `${Math.round(innerWidth - bord) + 16}px`;
  const gauche = bord - 16 - Math.min(460, innerWidth - 32);
  const enBas = document.body.classList.contains("atelier") && !document.querySelector(".editeur");
  zone.classList[enBas ? "add" : "remove"]("en-bas");
  if (enBas) {
    const vv = globalThis.visualViewport;
    let bas = vv ? Math.max(0, innerHeight - vv.offsetTop - vv.height) : 0;
    for (const el of document.querySelectorAll(BAS_DE_L_ECRAN)) {
      const b = el.getBoundingClientRect();
      if (b.height && b.right > gauche && b.left < bord && b.bottom > innerHeight - 60) bas = Math.max(bas, innerHeight - b.top);
    }
    zone.style.top = "auto";
    zone.style.bottom = `${Math.round(Math.min(bas, innerHeight / 2)) + 16}px`;
    return;
  }
  // Une barre collée se tient un peu sous ce qui la précède (la marge de sa colonne) : jusqu'à 48 px plus bas, elle compte.
  const boites = [...document.querySelectorAll(HAUT_DE_L_ECRAN)].map((el) => ({ el, b: el.getBoundingClientRect() }))
    .filter(({ b }) => b.height && b.right > gauche && b.left < bord).sort((x, y) => x.b.top - y.b.top);
  let haut = 0;
  let combat = false;
  for (const { el, b } of boites) {
    if (b.top > haut + 48 || b.bottom <= haut) continue;
    haut = b.bottom;
    combat = combat || el.matches(".barre-combat");
  }
  // La barre du combat collée en haut de la page : juste dessous se joue la première ligne d'adversaires, que le message
  // et son « Annuler » couvriraient. Il passe alors en bas à droite.
  zone.style.top = combat ? "auto" : `${Math.round(haut) + 12}px`;
  zone.style.bottom = combat ? "16px" : "";
}

function lancer(t, ms) {
  const m = minuteries.get(t) || {};
  clearTimeout(m.id);
  Object.assign(m, { reste: ms, depuis: Date.now(), id: ms > 0 && !m.pause ? setTimeout(() => retirerToast(t), ms) : 0 });
  minuteries.set(t, m);
}

function suspendre(t) {
  const m = minuteries.get(t);
  if (!m || m.pause) return;
  m.pause = true;
  if (m.id) m.reste = Math.max(0, m.reste - (Date.now() - m.depuis));
  clearTimeout(m.id);
  m.id = 0;
}

// Le pointeur s'en va : le message reste encore deux secondes au moins, le temps de le voir partir.
function reprendre(t) {
  const m = minuteries.get(t);
  if (!m || !m.pause) return;
  m.pause = false;
  if (m.reste > 0) lancer(t, Math.max(2000, m.reste));
}

function retirerToast(t) {
  if (!t.isConnected || t.classList.contains("sortie")) return;
  clearTimeout(minuteries.get(t)?.id);
  t.classList.add("sortie");
  setTimeout(() => t.remove(), 400);
}

export function toast(message, genre = "info", { action = null, actions = null, duree = 0 } = {}) {
  const texte = String(message ?? "").trim();
  const gestes = [action, ...(Array.isArray(actions) ? actions : [])].filter((g) => g && typeof g.faire === "function");
  if (!texte && !gestes.length) return null;
  const zone = zoneToasts();
  placerToasts(zone);
  const erreur = genre === "erreur";
  const lecture = Math.min(12000, Math.round((texte.length / 15) * 1000));
  const tenue = duree || (erreur ? 0 : Math.max(gestes.length ? 10000 : 4000, lecture));
  const vivants = [...zone.children].filter((x) => !x.classList.contains("sortie"));
  // Le même message, sans bouton de part et d'autre : il se fond dans celui qui est là, qui repart pour un tour.
  const pareil = !gestes.length && vivants.find((x) => x.dataset.genre === genre && !x.dataset.geste
    && x.querySelector(".toast-texte")?.textContent === texte);
  if (pareil) {
    pareil.dataset.ne = String(Date.now());
    pareil.classList.remove("repete");
    void pareil.offsetWidth;
    pareil.classList.add("repete");
    lancer(pareil, tenue);
    return pareil;
  }
  const t = document.createElement("div");
  t.className = `toast toast-${genre}`;
  t.dataset.genre = genre;
  t.dataset.ne = String(Date.now());
  if (gestes.length) t.dataset.geste = "1";
  if (erreur) t.setAttribute("role", "alert");
  const corps = document.createElement("span");
  corps.className = "toast-texte";
  corps.textContent = texte;
  t.append(corps);
  for (const g of gestes) {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = "toast-action";
    bouton.textContent = g.libelle || "Annuler";
    bouton.addEventListener("click", () => {
      t.remove();
      g.faire();
    }, { once: true });
    t.append(bouton);
  }
  if (erreur) {
    const fermer = document.createElement("button");
    fermer.type = "button";
    fermer.className = "toast-fermer";
    fermer.setAttribute("aria-label", "Fermer ce message");
    fermer.title = "Fermer";
    fermer.textContent = "×";
    t.append(fermer);
  }
  // Un clic sur le texte ou sur « × » ferme le message ; un bouton ou un lien qu'il porte fait son travail.
  t.addEventListener("click", (ev) => {
    if (ev.target.closest(".toast-fermer") || !ev.target.closest("a, button, input, select, textarea")) retirerToast(t);
  });
  t.addEventListener("pointerenter", () => suspendre(t));
  t.addEventListener("pointerleave", () => reprendre(t));
  t.addEventListener("focusin", () => suspendre(t));
  t.addEventListener("focusout", () => reprendre(t));
  if (erreur) {
    // Les erreurs d'abord, la plus récente en dernier ; trois au plus.
    zone.insertBefore(t, vivants.find((x) => x.dataset.genre !== "erreur") || null);
    const erreurs = vivants.filter((x) => x.dataset.genre === "erreur");
    for (const x of erreurs.slice(0, Math.max(0, erreurs.length + 1 - ERREURS_MAX))) x.remove();
  } else {
    // Un seul message de passage : le nouveau prend la place du précédent. Un message à geste (« Annuler ») ne cède
    // qu'à un autre message à geste : un simple message venu après se pose sous lui.
    for (const x of vivants) if (x.dataset.genre !== "erreur" && (gestes.length || !x.dataset.geste)) x.remove();
    zone.append(t);
  }
  lancer(t, tenue);
  return t;
}

// Le moment, pour dire qu'un service ne répond pas : « ce soir » à l'heure des séances, « pour l'instant » sinon.
const moment = () => {
  const h = new Date().getHours();
  return h >= 17 || h < 5 ? "ce soir" : "pour l'instant";
};

// L'erreur d'une aide à l'écriture, dite au MJ sans jargon ni redite : pas de clé, clé refusée, crédit, surcharge,
// serveur de textes muet. aLaMain dit ce que le MJ peut faire sans elle (« écrivez quelques phrases ci-dessous, elles
// serviront telles quelles ») quand le serveur de textes ne répond pas.
export function erreurIA(err, aLaMain = "") {
  const m = String((err && err.message) || err || "");
  if (err && err.status === 0) return "l'atelier ne répond pas, vérifiez la connexion";
  if (/clé d'API/i.test(m)) return "la rédaction n'est pas branchée sur ce serveur";
  if (/AuthenticationError|PermissionDenied/.test(m)) return "le service d'écriture refuse l'accès";
  if (/BadRequestError/.test(m)) return "demande refusée par l'API (crédit épuisé ?)";
  if (/RateLimitError|Overloaded|InternalServerError/.test(m)) return "l'API est surchargée, réessayez dans une minute";
  if (/modèle de langue ne répond pas|Timeout|Connect|ne répond pas/i.test(m)) {
    return `le serveur de textes ne répond pas ${moment()} ; ${aLaMain || "réessayez un peu plus tard"}`;
  }
  if (/illisible/.test(m)) return "la réponse était illisible, réessayez";
  // Le reste, sans le nom technique de l'erreur entre parenthèses.
  return m.replace(/^Rédaction impossible : /, "").replace(/\s*\((?:[A-Z][A-Za-z]*)?(?:Error|Exception|Timeout)\)/g, "");
}

// Appel différé : chaque nouvel appel repousse l'échéance. maintenant() exécute tout de suite ;
// vider() n'exécute que si un appel attend encore (rien à écrire, rien d'envoyé).
export function differer(fn, delai) {
  let minuterie = 0;
  let attente = null;
  const f = (...args) => {
    clearTimeout(minuterie);
    attente = args;
    minuterie = setTimeout(() => {
      attente = null;
      fn(...args);
    }, delai);
  };
  f.maintenant = (...args) => {
    clearTimeout(minuterie);
    attente = null;
    return fn(...args);
  };
  f.vider = () => (attente ? f.maintenant(...attente) : undefined);
  f.enAttente = () => attente !== null;
  f.annuler = () => {
    clearTimeout(minuterie);
    attente = null;
  };
  return f;
}
