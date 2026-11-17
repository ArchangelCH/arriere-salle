// Vérifie le nouvel essai des enregistrements (app/static/js/commun/reessai.js) sur une horloge simulée : pauses de 3 s, 10 s
// puis 30 s, rien après un conflit ou un refus, essai immédiat au retour du réseau ou de l'onglet, un seul toast par
// coupure, état affiché, séries de plusieurs pages.
// Usage : node outils/verifier_reessai.mjs

// ---- un navigateur minimal : horloge, fenêtre, document, toasts ----
let maintenant = 1_000_000;
let minuteries = [];
let prochainId = 1;
const planifier = (fn, delai, repete) => {
  const id = prochainId++;
  minuteries.push({ id, fn, quand: maintenant + delai, delai, repete });
  return id;
};
globalThis.setTimeout = (fn, delai = 0) => planifier(fn, delai, false);
globalThis.setInterval = (fn, delai = 0) => planifier(fn, delai, true);
globalThis.clearTimeout = globalThis.clearInterval = (id) => {
  minuteries = minuteries.filter((m) => m.id !== id);
};
Date.now = () => maintenant;

const ecouteurs = new Map();
const cible = (nom) => ({
  addEventListener: (type, fn) => ecouteurs.set(`${nom}:${type}`, [...(ecouteurs.get(`${nom}:${type}`) || []), fn]),
  removeEventListener: (type, fn) => ecouteurs.set(`${nom}:${type}`, (ecouteurs.get(`${nom}:${type}`) || []).filter((f) => f !== fn)),
});
// Un élément minimal, assez pour que toast() (api.js) pose, fusionne et retire ses messages : chaque message posé dans
// la zone est noté, avec son texte.
const noeud = (surPose) => {
  const n = {
    children: [], dataset: {}, style: {}, textContent: "", isConnected: true,
    classList: { add() {}, remove() {}, contains: () => false },
    setAttribute() {}, addEventListener() {}, querySelector: () => null,
    append(...enfants) {
      for (const e of enfants) n.insertBefore(e, null);
    },
    insertBefore(e, avant) {
      e.parentNode = n;
      const i = avant ? n.children.indexOf(avant) : -1;
      if (i < 0) n.children.push(e);
      else n.children.splice(i, 0, e);
      surPose?.(e);
    },
    remove() {
      n.isConnected = false;
      if (n.parentNode) n.parentNode.children = n.parentNode.children.filter((x) => x !== n);
    },
  };
  return n;
};
const texteDe = (t) => [t.textContent, ...t.children.map((c) => c.textContent)].join("");
globalThis.innerWidth = 1512;
const toasts = [];
const zoneToasts = noeud((t) => toasts.push(t));
globalThis.window = cible("window");
globalThis.document = {
  ...cible("document"),
  visibilityState: "visible",
  querySelector: (sel) => (sel === ".toasts" ? zoneToasts : null),
  querySelectorAll: () => [],
  createElement: () => noeud(),
  body: { append() {}, classList: { contains: () => false } },
};
const lancer = (nom, type) => (ecouteurs.get(`${nom}:${type}`) || []).forEach((f) => f());
const nbEcouteurs = () => [...ecouteurs.values()].reduce((n, l) => n + l.length, 0);

const attendre = () => new Promise((r) => setImmediate(r));
async function avancer(ms) {
  const fin = maintenant + ms;
  for (;;) {
    minuteries.sort((a, b) => a.quand - b.quand);
    const m = minuteries[0];
    if (!m || m.quand > fin) break;
    maintenant = m.quand;
    if (m.repete) m.quand += m.delai;
    else minuteries.shift();
    m.fn();
    // L'essai lancé finit (ses promesses) avant que l'horloge n'avance.
    for (let i = 0; i < 5; i++) await attendre();
  }
  maintenant = fin;
  await attendre();
}

const { Reessai, injoignable, raison, reessaisEnAttente, relancerTout } = await import("../app/static/js/commun/reessai.js");

let defauts = 0;
let verifications = 0;
const verifier = (ok, message) => {
  verifications++;
  if (!ok) {
    defauts++;
    console.log(`DÉFAUT : ${message}`);
  }
};
const erreur = (status, message = String(status)) => Object.assign(new Error(message), { status });

// ---- les erreurs qui méritent un nouvel essai ----
for (const s of [0, 502, 503, 504, 520, 521, 522, 523, 524, 530]) verifier(injoignable(erreur(s)), `statut ${s} : nouvel essai attendu`);
for (const s of [400, 401, 403, 404, 409, 413, 422, 423, 500]) verifier(!injoignable(erreur(s)), `statut ${s} : aucun nouvel essai`);
verifier(!injoignable(new Error("x")) && !injoignable(null), "erreur sans statut : aucun nouvel essai");
verifier(raison(erreur(502)) === "le serveur ne répond pas", "502 dit sans code");
verifier(raison(erreur(0, "serveur injoignable, vérifiez la connexion")) === "serveur injoignable, vérifiez la connexion", "statut 0 : message gardé");

// ---- un écran simulé : chaque essai échoue tant que le serveur est arrêté ----
function ecran() {
  const e = { serveur: false, envois: [], etat: "ok", affiche: [] };
  e.reessai = new Reessai(async () => {
    e.envois.push(maintenant);
    e.etat = "enregistrement";
    e.affiche.push(e.reessai.libelle("enregistrement"));
    await attendre();
    if (e.serveur === true) {
      e.reessai.reussite();
      e.etat = "ok";
    } else {
      const err = e.serveur === false ? erreur(0, "serveur injoignable, vérifiez la connexion") : erreur(e.serveur);
      e.reessai.echec(err);
      e.etat = "erreur";
      e.reessai.signaler(err, "Plan non enregistré");
    }
  }, () => e.affiche.push(e.reessai.libelle(e.etat)));
  // Le premier échec vient de l'écran lui-même (sa sauvegarde différée).
  e.premierEchec = (err = erreur(0, "serveur injoignable, vérifiez la connexion")) => {
    e.reessai.echec(err);
    e.etat = "erreur";
    e.reessai.signaler(err, "Plan non enregistré");
  };
  return e;
}

// 1. Pauses de 3 s, 10 s, puis toutes les 30 s ; le serveur revient : un toast, plus rien ne part.
{
  toasts.length = 0;
  const e = ecran();
  const t0 = maintenant;
  e.premierEchec();
  verifier(reessaisEnAttente(), "série en attente après un échec");
  verifier(e.reessai.libelle("erreur") === "Non enregistré, nouvel essai dans 3 s", `état : ${e.reessai.libelle("erreur")}`);
  await avancer(1000);
  verifier(e.reessai.libelle("erreur") === "Non enregistré, nouvel essai dans 2 s", `compte à rebours : ${e.reessai.libelle("erreur")}`);
  await avancer(130_000);
  const ecarts = e.envois.map((t, i) => (t - (i ? e.envois[i - 1] : t0)) / 1000);
  verifier(JSON.stringify(ecarts.slice(0, 5)) === "[3,10,30,30,30]", `pauses : ${ecarts.join(", ")}`);
  verifier(toasts.length === 1, `un seul toast pendant la coupure (${toasts.length})`);
  verifier(e.affiche.includes("Nouvel essai…"), "« Nouvel essai… » pendant l'essai");
  e.serveur = true;
  const avant = e.envois.length;
  await avancer(30_000);
  verifier(e.envois.length === avant + 1, "un essai de plus quand le serveur revient");
  verifier(!e.reessai.actif && !reessaisEnAttente(), "série finie après la réussite");
  verifier(toasts.length === 2, "un toast au retour du serveur");
  await avancer(120_000);
  verifier(e.envois.length === avant + 1, "plus rien ne part après la réussite");
  verifier(nbEcouteurs() === 0 && minuteries.length === 0, "écouteurs et minuteries retirés");
}

// 2. Jamais après un conflit ni un refus : ni nouvel essai, ni série.
for (const s of [409, 400, 403, 404, 413, 500]) {
  toasts.length = 0;
  const e = ecran();
  e.premierEchec(erreur(s, "refusé"));
  await avancer(120_000);
  verifier(e.envois.length === 0 && !reessaisEnAttente(), `statut ${s} : rien ne repart`);
  verifier(toasts.length === 1, `statut ${s} : le refus est dit`);
}

// 3. Un conflit pendant la série l'arrête.
{
  const e = ecran();
  e.premierEchec();
  e.serveur = 409;
  await avancer(3000);
  verifier(e.envois.length === 1 && !e.reessai.actif, "conflit au nouvel essai : la série s'arrête");
  await avancer(120_000);
  verifier(e.envois.length === 1, "conflit : plus rien ne repart");
}

// 4. Réseau revenu, retour sur l'onglet : essai tout de suite ; onglet caché : pas d'essai sur focus.
{
  const e = ecran();
  e.premierEchec();
  await avancer(3000); // premier essai, raté : le suivant dans 10 s
  verifier(e.envois.length === 1, "premier essai à 3 s");
  lancer("window", "online");
  await attendre();
  await attendre();
  verifier(e.envois.length === 2, "essai tout de suite au retour du réseau");
  document.visibilityState = "hidden";
  lancer("window", "focus");
  await attendre();
  verifier(e.envois.length === 2, "onglet caché : pas d'essai au focus");
  document.visibilityState = "visible";
  lancer("document", "visibilitychange");
  await attendre();
  await attendre();
  verifier(e.envois.length === 3, "essai tout de suite au retour sur l'onglet");
  e.serveur = true;
  lancer("window", "focus");
  await attendre();
  await attendre();
  verifier(e.envois.length === 4 && !e.reessai.actif, "focus avec le serveur revenu : enregistré");
}

// 5. Un échec pendant l'attente (nouvelle saisie) ne repousse pas l'essai prévu.
{
  const e = ecran();
  const t0 = maintenant;
  e.premierEchec();
  await avancer(2000);
  e.premierEchec();
  await avancer(1000);
  verifier(e.envois.length === 1 && e.envois[0] - t0 === 3000, "l'essai prévu garde son heure");
  e.serveur = true;
  await avancer(10_000);
  verifier(!e.reessai.actif, "série finie");
}

// 6. Plusieurs fiches : une seule injoignable suffit ; toutes parties, la série s'arrête.
{
  const r = new Reessai(async () => {});
  verifier(r.bilan([erreur(400), erreur(0)]) === true && r.actif, "bilan : une fiche injoignable, nouvel essai");
  r.bilan([]);
  verifier(!r.actif, "bilan vide : série finie");
  verifier(r.bilan([erreur(400)]) === false && !r.actif, "bilan : un refus seul n'en prévoit pas");
}

// 7. Rien de prévu après un essai qui n'envoie rien (déjà parti par une saisie) : la série se clôt.
{
  const r = new Reessai(async () => {});
  r.echec(erreur(0));
  await avancer(3000);
  verifier(!r.actif && !reessaisEnAttente(), "essai sans rien à envoyer : série close");
}

// 8. Deux pages : la série d'une page quittée reste, relancerTout() les fait partir toutes.
{
  const a = ecran();
  const b = ecran();
  a.premierEchec();
  b.premierEchec();
  verifier(reessaisEnAttente(), "deux séries en attente");
  a.serveur = true;
  b.serveur = true;
  await relancerTout();
  verifier(a.envois.length === 1 && b.envois.length === 1 && !reessaisEnAttente(), "relancerTout : les deux enregistrées");
  await avancer(13000); // les toasts s'effacent (le temps de les lire, douze secondes au plus, puis leur sortie)
  verifier(nbEcouteurs() === 0 && minuteries.length === 0, `plus d'écouteurs ni de minuteries (${nbEcouteurs()}, ${minuteries.map((m) => m.delai)})`);
  await relancerTout();
  verifier(a.envois.length === 1, "relancerTout sans série : rien ne part");
}

// 9. Deux séries pendant la même coupure (une carte et sa fiche de lieu, ou une page quittée) : un seul toast ; la
// première qui passe relance l'autre tout de suite ; le retour n'est dit qu'une fois, quand tout est reparti.
{
  toasts.length = 0;
  const a = ecran();
  const b = ecran();
  a.premierEchec();
  await avancer(2000);
  b.premierEchec();
  verifier(toasts.length === 1, `deux séries : un seul toast (${toasts.length})`);
  a.serveur = true;
  b.serveur = true;
  await avancer(1000); // l'essai de a (3 s) réussit et relance b, prévu à 5 s
  verifier(a.envois.length === 1 && b.envois.length === 1 && !reessaisEnAttente(), "la réussite de l'une relance l'autre tout de suite");
  verifier(toasts.length === 2, `un seul toast de retour (${toasts.length})`);
  await avancer(4000);
}

// 10. maintenant() pendant un essai en cours : pas de second envoi.
{
  const e = ecran();
  e.premierEchec();
  const p1 = e.reessai.maintenant();
  const p2 = e.reessai.maintenant();
  verifier(p1 === p2, "même essai rendu");
  await p1;
  verifier(e.envois.length === 1, "un seul envoi");
  e.reessai.arreter();
}

console.log(defauts ? `${defauts} défaut(s) sur ${verifications} vérifications` : `Aucun défaut (${verifications} vérifications)`);
process.exit(defauts ? 1 : 0);
