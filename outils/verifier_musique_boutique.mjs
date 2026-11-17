// Vérifie la musique des boutiques (app/static/js/musique/musique-boutique.js) : le contrôleur branché sur un faux « ce que
// montre la TV » et un faux lecteur. Bascule quand une boutique paraît à la TV, rien de plus quand on montre un article
// de près, retour quand la boutique s'en va, et le MJ qui garde la main (rien ne jouait, musique changée entre-temps,
// boutique déjà à la TV quand on commence à écouter, pause, aucune ambiance choisie).
// Usage : node outils/verifier_musique_boutique.mjs

let defauts = 0;
let verifications = 0;
const verifier = (ok, message) => {
  verifications++;
  if (!ok) {
    defauts++;
    console.log(`DÉFAUT : ${message}`);
  }
};

// ---- un navigateur minimal ----
const noeud = () => {
  const n = {
    children: [], dataset: {}, style: {}, textContent: "", isConnected: true,
    classList: { add() {}, remove() {}, contains: () => false },
    setAttribute() {}, addEventListener() {}, querySelector: () => null,
    append(...enfants) {
      n.children.push(...enfants);
    },
    insertBefore(e) {
      n.children.push(e);
    },
    remove() {
      n.isConnected = false;
    },
  };
  return n;
};
const toasts = [];
const zoneToasts = noeud();
zoneToasts.insertBefore = (e) => toasts.push([e.textContent, ...(e.children || []).map((c) => c.textContent)].join(""));
zoneToasts.append = (...es) => es.forEach((e) => zoneToasts.insertBefore(e));
globalThis.window = new EventTarget();
globalThis.innerWidth = 1512;
const doc = new EventTarget();
Object.assign(doc, {
  visibilityState: "visible",
  querySelector: (sel) => (sel === ".toasts" ? zoneToasts : null),
  querySelectorAll: () => [],
  createElement: () => noeud(),
  head: noeud(),
  body: { append() {}, classList: { contains: () => false } },
});
globalThis.document = doc;
globalThis.setTimeout = (fn) => {
  fn();
  return 1;
};
globalThis.clearTimeout = () => {};
globalThis.fetch = async (url) => {
  throw new Error(`requête inattendue : ${url}`);
};

const { MusiqueDesBoutiques, htmlReglageBoutique, boutiqueALaTv } = await import("../app/static/js/musique/musique-boutique.js");

// ---- un faux lecteur et une fausse TV ----
const AMBIANCES = [{ id: "auberge", nom: "L'auberge" }, { id: "route", nom: "La route" }, { id: "echoppe", nom: "L'échoppe" }];
function monter({ courante = "auberge", enPause = false, boutique = "echoppe", tv = { vue: "plan", plan: "p1" } } = {}) {
  const panneau = new EventTarget();
  const lecteur = {
    panneau, ambiances: AMBIANCES, ambianceBoutique: boutique, courante, enPause, choisis: [],
    choisir(a) {
      this.choisis.push(a.id);
      this.courante = a.id;
      window.dispatchEvent(new Event("musique-changee"));
    },
  };
  const fausseTv = { fn: null, etat: tv, abonnements: 0, desabonnements: 0 };
  const ecouter = (fn) => {
    fausseTv.fn = fn;
    fausseTv.abonnements++;
    fn(fausseTv.etat);
    return () => {
      fausseTv.fn = null;
      fausseTv.desabonnements++;
    };
  };
  const ctrl = new MusiqueDesBoutiques(lecteur, { ecouter });
  const montrer = (etat) => {
    fausseTv.etat = etat;
    fausseTv.fn?.(etat);
  };
  const changer = (id, pause = false) => {
    lecteur.courante = id;
    lecteur.enPause = pause;
    window.dispatchEvent(new Event("musique-changee"));
  };
  ctrl.suivre();
  return { lecteur, ctrl, montrer, changer, fausseTv };
}
const BOUTIQUE = { vue: "boutique", boutique: "b1" };
const PLAN = { vue: "plan", plan: "p1" };

// ---- 1. Ce qui compte comme une boutique à la TV ----
verifier(boutiqueALaTv(BOUTIQUE) && boutiqueALaTv({ ...BOUTIQUE, article: "a1", rayon: 2 }), "une boutique, avec un article de près ou par rayon");
verifier(!boutiqueALaTv(PLAN) && !boutiqueALaTv(null) && !boutiqueALaTv({ vue: "boutique" }), "un plan, rien, une boutique sans fiche");

// ---- 2. Le parcours ordinaire ----
{
  const { lecteur, montrer, ctrl } = monter();
  montrer(BOUTIQUE);
  verifier(lecteur.courante === "echoppe" && lecteur.choisis.join() === "echoppe", `la boutique paraît : l'échoppe joue (${lecteur.choisis})`);
  verifier(ctrl.retenue?.avant === "auberge", "l'auberge est retenue pour le retour");
  montrer({ ...BOUTIQUE, article: "a1" });
  montrer({ ...BOUTIQUE, rayon: 2 });
  verifier(lecteur.choisis.length === 1, "un article de près, un autre rayon : rien ne bascule");
  montrer(PLAN);
  verifier(lecteur.courante === "auberge" && lecteur.choisis.join() === "echoppe,auberge", `la boutique s'en va : l'auberge revient (${lecteur.choisis})`);
  verifier(ctrl.retenue === null, "plus rien de retenu");
  montrer(BOUTIQUE);
  verifier(lecteur.courante === "echoppe", "une seconde boutique : l'échoppe rejoue");
}

// ---- 3. Le MJ garde la main ----
{
  const { lecteur, montrer, ctrl, fausseTv } = monter({ courante: null });
  montrer(BOUTIQUE);
  verifier(lecteur.choisis.length === 0 && fausseTv.abonnements === 0, "rien ne jouait : rien ne démarre (et la TV n'est pas écoutée)");
  verifier(ctrl.retenue === null, "rien de retenu");
}
{
  const { lecteur, montrer } = monter({ enPause: true });
  montrer(BOUTIQUE);
  verifier(lecteur.choisis.length === 0, "musique en pause : rien ne démarre");
}
{
  const { lecteur, montrer } = monter({ boutique: null });
  montrer(BOUTIQUE);
  verifier(lecteur.choisis.length === 0, "aucune ambiance de boutique choisie : rien ne bascule");
}
{
  const { lecteur, montrer } = monter({ tv: BOUTIQUE });
  montrer({ ...BOUTIQUE, article: "a2" });
  verifier(lecteur.choisis.length === 0, "boutique déjà à la TV quand on commence à écouter : rien ne bascule");
  montrer(PLAN);
  verifier(lecteur.choisis.length === 0, "et son départ ne fait rien revenir");
}
{
  const { lecteur, montrer, changer, ctrl } = monter();
  montrer(BOUTIQUE);
  changer("route");
  verifier(ctrl.retenue === null, "le MJ change de musique pendant la boutique : le retour est oublié");
  montrer(PLAN);
  verifier(lecteur.courante === "route" && lecteur.choisis.join() === "echoppe", "la boutique s'en va : la route continue");
}
{
  const { lecteur, montrer, changer } = monter();
  montrer(BOUTIQUE);
  changer("echoppe", true);
  montrer(PLAN);
  verifier(lecteur.choisis.join() === "echoppe", "l'échoppe mise en pause : rien ne revient");
}
{
  const { lecteur, montrer, ctrl } = monter();
  lecteur.ambiances = AMBIANCES.filter((a) => a.id !== "echoppe");
  montrer(BOUTIQUE);
  verifier(lecteur.choisis.length === 0 && ctrl.retenue === null, "l'ambiance retirée de la liste : rien ne bascule");
  verifier(toasts.some((t) => t.includes("plus dans la liste")), "et le MJ en est averti");
}

// ---- 4. Le réglage du panneau ----
const reglage = htmlReglageBoutique(AMBIANCES, "echoppe");
verifier(reglage.includes("data-m-boutique") && reglage.includes('<option value="">Aucune</option>'), "le réglage : une liste avec « Aucune »");
verifier(/value="echoppe" selected/.test(reglage), "l'ambiance choisie est sélectionnée");
verifier(htmlReglageBoutique([], null) === "", "sans ambiance, pas de réglage");

console.log(`${verifications} vérifications, ${defauts} défaut${defauts > 1 ? "s" : ""}`);
process.exit(defauts ? 1 : 0);
