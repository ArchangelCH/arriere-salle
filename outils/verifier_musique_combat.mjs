// Vérifie la musique des combats (app/static/js/musique/musique-combat.js) : la décision seule, cas par cas, puis le contrôleur
// branché sur le vrai état du jeu (etat-jeu.js, serveur simulé) avec un faux lecteur : bascule au début d'un combat
// lancé ici ou ailleurs, retour à la fin, et le MJ qui garde la main (rien ne jouait, musique changée pendant le combat,
// combat déjà en cours, pause, ambiance retirée de la liste). Le lecteur YouTube n'y joue pas : le navigateur fait le reste.
// Usage : node outils/verifier_musique_combat.mjs

let defauts = 0;
let verifications = 0;
const verifier = (ok, message) => {
  verifications++;
  if (!ok) {
    defauts++;
    console.log(`DÉFAUT : ${message}`);
  }
};
const json = (x) => JSON.stringify(x);

// ---- un navigateur minimal : fenêtre, document, horloge, serveur ----
let horloge = 1_000_000;
Date.now = () => horloge;
const avancer = (ms = 1000) => {
  horloge += ms;
};
globalThis.window = new EventTarget();
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
const zoneToasts = noeud((t) => toasts.push(texteDe(t)));
globalThis.document = {
  visibilityState: "visible",
  querySelector: (sel) => (sel === ".toasts" ? zoneToasts : null),
  querySelectorAll: () => [],
  createElement: () => noeud(),
  body: { append() {}, classList: { contains: () => false } },
};
// Pas de vraie minuterie : les relectures se font à la main (relireEtatJeu), comme si cinq secondes passaient.
globalThis.setInterval = () => 1;
globalThis.clearInterval = () => {};
globalThis.setTimeout = (fn) => {
  fn();
  return 1;
};

const serveur = { auCombat: {}, combat: null, combatIllisible: false, lectures: 0 };
const repondre = (corps) => ({ ok: true, status: 200, json: async () => corps });
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u === "/api/etats-heros") {
    serveur.lectures++;
    return repondre({ etats: {}, au_combat: serveur.auCombat });
  }
  if (u === "/api/aventuriers") return repondre([]);
  if (/^\/api\/seances\/[^/]+\/combat$/.test(u)) {
    return serveur.combatIllisible ? { ok: false, status: 502, json: async () => ({}) } : repondre({ combat: serveur.combat });
  }
  throw new Error(`requête inattendue : ${u}`);
};
const commencerAuServeur = () => {
  serveur.auCombat = { toma: { seance: "s1", combat: "La rixe" } };
  serveur.combat = { id: "c1", nom: "La rixe", tour: 1 };
};
const finirAuServeur = () => {
  serveur.auCombat = {};
  serveur.combat = null;
};
const attendre = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
};

const { decisionCombat, combatEnCours, htmlReglageCombat, MusiqueDesCombats, reglageCombat } = await import("../app/static/js/musique/musique-combat.js");
const { annoncerEtatJeu, ecouterEtatJeu, relireEtatJeu } = await import("../app/static/js/commun/etat-jeu.js");

// ---- 1. La décision, cas par cas ----
const D = (avant, apres, courante, enPause, combat, retenue) => decisionCombat({ avant, apres, joue: { courante, enPause }, combat, retenue });
const R = { avant: "auberge", combat: "combat" };
const cas = [
  // [nom, décision, attendu]
  ["début : l'auberge joue, bascule et retient l'auberge", D(false, true, "auberge", false, "combat", null), { jouer: "combat", retenue: R }],
  ["début : rien ne joue, rien ne démarre", D(false, true, null, false, "combat", null), { jouer: null, retenue: null }],
  ["début : l'auberge en pause, rien ne démarre", D(false, true, "auberge", true, "combat", null), { jouer: null, retenue: null }],
  ["début : aucune ambiance de combat choisie", D(false, true, "auberge", false, null, null), { jouer: null, retenue: null }],
  ["début : l'ambiance de combat joue déjà, rien à retenir", D(false, true, "combat", false, "combat", null), { jouer: null, retenue: null }],
  ["première lecture, combat déjà en cours : rien ne bascule", D(null, true, "auberge", false, "combat", null), { jouer: null, retenue: null }],
  ["première lecture, sans combat", D(null, false, "auberge", false, "combat", null), { jouer: null, retenue: null }],
  ["fin : la musique de combat joue encore, l'auberge revient", D(true, false, "combat", false, "combat", R), { jouer: "auberge", retenue: null }],
  ["fin : le MJ a changé de musique, on ne revient pas", D(true, false, "route", false, "combat", R), { jouer: null, retenue: null }],
  ["fin : la musique de combat en pause, on ne relance rien", D(true, false, "combat", true, "combat", R), { jouer: null, retenue: null }],
  ["fin : le MJ a tout arrêté", D(true, false, null, false, "combat", R), { jouer: null, retenue: null }],
  ["fin sans bascule au début : rien", D(true, false, "auberge", false, "combat", null), { jouer: null, retenue: null }],
  ["fin : l'ambiance de combat retirée du réglage entre-temps, l'auberge revient quand même", D(true, false, "combat", false, null, R), { jouer: "auberge", retenue: null }],
  ["pendant : la musique de combat joue, la retenue reste", D(true, true, "combat", false, "combat", R), { jouer: null, retenue: R }],
  ["pendant : une pause ne fait pas perdre le retour", D(true, true, "combat", true, "combat", R), { jouer: null, retenue: R }],
  ["pendant : le MJ choisit une autre musique, la retenue tombe", D(true, true, "route", false, "combat", R), { jouer: null, retenue: null }],
  ["pendant : le MJ arrête tout, la retenue tombe", D(true, true, null, false, "combat", R), { jouer: null, retenue: null }],
  ["hors combat : rien", D(false, false, "auberge", false, "combat", null), { jouer: null, retenue: null }],
  ["hors combat avec une vieille retenue : elle tombe", D(false, false, "combat", false, "combat", R), { jouer: null, retenue: null }],
];
for (const [nom, obtenu, attendu] of cas) verifier(json(obtenu) === json(attendu), `${nom} : ${json(obtenu)}`);
verifier(json(decisionCombat()) === json({ jouer: null, retenue: null }), "sans argument : rien");

verifier(!combatEnCours(null) && !combatEnCours({ auCombat: {}, combat: null }), "pas de combat");
verifier(combatEnCours({ auCombat: {}, combat: { id: "c1" } }), "le combat annoncé par un écran de la page");
verifier(combatEnCours({ auCombat: { toma: { seance: "s1" } }, combat: null }), "des héros au combat, combat illisible : toujours en combat");

const reglage = htmlReglageCombat([{ id: "auberge", nom: "L'auberge" }, { id: "combat", nom: "Combat <fort>" }], "combat");
verifier(reglage.includes('data-m-combat') && reglage.includes('<option value="">Aucune</option>'), "le réglage : une liste avec « Aucune »");
verifier(/value="combat" selected/.test(reglage) && !/value="auberge" selected/.test(reglage), "le réglage : l'ambiance choisie est sélectionnée");
verifier(reglage.includes("Combat &lt;fort&gt;"), "le réglage : nom échappé");
verifier(htmlReglageCombat([], null) === "", "sans ambiance : pas de réglage");

// ---- 2. Le contrôleur, sur le vrai état du jeu ----
class FauxLecteur {
  constructor() {
    this.cible = new EventTarget();
    this.panneau = new EventTarget();
    this.ambiances = ["auberge", "route", "combat"].map((id) => ({ id, nom: id }));
    this.ambianceCombat = "combat";
    this.courante = null;
    this.enPause = false;
    this.fondus = [];
  }
  annoncer() {
    this.cible.dispatchEvent(new Event("musique-changee"));
  }
  choisir(a) {
    this.fondus.push(a.id);
    if (a.id === this.courante && this.enPause) this.enPause = false;
    else if (a.id !== this.courante) [this.courante, this.enPause] = [a.id, false];
    this.annoncer();
  }
  pause() {
    this.enPause = true;
    this.annoncer();
  }
  arreter() {
    [this.courante, this.enPause] = [null, false];
    this.annoncer();
  }
}

async function scene(nom, fn) {
  finirAuServeur();
  serveur.combatIllisible = false;
  avancer(60_000);
  const m = new FauxLecteur();
  const c = new MusiqueDesCombats(m, { ecouter: ecouterEtatJeu, cible: m.cible });
  try {
    await fn(m, c);
  } catch (err) {
    verifier(false, `${nom} : ${err.stack}`);
  }
  // Fin de scène : la musique s'arrête, plus rien n'écoute l'état du jeu.
  m.arreter();
  await attendre();
  verifier(c.fin === null && c.retenue === null, `${nom} : plus d'écoute ni de retenue une fois la musique arrêtée`);
}
// Une relecture de l'état du jeu, comme celle des cinq secondes.
const relire = async () => {
  avancer(5000);
  await relireEtatJeu();
  await attendre();
};

await scene("combat lancé ailleurs (téléphone, iPad)", async (m, c) => {
  verifier(c.fin === null, "rien ne joue : l'état du jeu n'est pas écouté");
  const avant = serveur.lectures;
  m.choisir(m.ambiances[0]);
  await attendre();
  verifier(c.fin !== null && serveur.lectures > avant, "la musique joue : l'état du jeu est écouté");
  verifier(c.auCombat === false, `point de départ hors combat : ${c.auCombat}`);
  commencerAuServeur();
  await relire();
  verifier(m.courante === "combat" && json(m.fondus) === json(["auberge", "combat"]), `bascule au combat : ${json(m.fondus)}`);
  verifier(json(c.retenue) === json({ avant: "auberge", combat: "combat" }), `l'auberge est retenue : ${json(c.retenue)}`);
  await relire();
  verifier(m.fondus.length === 2, "une relecture pendant le combat ne rejoue rien");
  finirAuServeur();
  await relire();
  verifier(m.courante === "auberge" && json(m.fondus) === json(["auberge", "combat", "auberge"]), `retour à l'auberge : ${json(m.fondus)}`);
  verifier(c.retenue === null, "plus rien de retenu après le retour");
});

await scene("combat lancé et fini sur cette page (annonce de l'écran du combat)", async (m) => {
  m.choisir(m.ambiances[1]);
  await attendre();
  commencerAuServeur();
  // L'écran du combat annonce aussitôt son combat, avant toute relecture.
  annoncerEtatJeu({ seance: "s1", combat: { ...serveur.combat } }, { relire: false });
  verifier(m.courante === "combat", "bascule dès l'annonce, sans attendre la relecture");
  await relire();
  finirAuServeur();
  annoncerEtatJeu({ combat: null });
  await attendre();
  verifier(m.courante === "route" && json(m.fondus) === json(["route", "combat", "route"]), `retour à la route : ${json(m.fondus)}`);
});

await scene("rien ne jouait au début du combat", async (m, c) => {
  commencerAuServeur();
  await relire();
  verifier(m.fondus.length === 0 && c.fin === null, "rien ne démarre, rien n'écoute");
  finirAuServeur();
  await relire();
  verifier(m.fondus.length === 0, "rien à la fin non plus");
});

await scene("musique en pause au début du combat", async (m, c) => {
  m.choisir(m.ambiances[0]);
  await attendre();
  m.pause();
  await attendre();
  verifier(c.fin === null, "en pause : plus d'écoute");
  commencerAuServeur();
  await relire();
  verifier(m.courante === "auberge" && m.enPause && m.fondus.length === 1, "la pause reste une pause");
  // Reprise en plein combat : c'est le choix du MJ, rien ne bascule.
  m.choisir(m.ambiances[0]);
  await attendre();
  verifier(!m.enPause && m.courante === "auberge" && c.auCombat === true, "reprise en plein combat : point de départ en combat");
  finirAuServeur();
  await relire();
  verifier(m.courante === "auberge" && json(m.fondus) === json(["auberge", "auberge"]), `rien ne bouge à la fin : ${json(m.fondus)}`);
});

await scene("le MJ change de musique pendant le combat", async (m, c) => {
  m.choisir(m.ambiances[0]);
  await attendre();
  commencerAuServeur();
  await relire();
  verifier(m.courante === "combat", "bascule");
  m.choisir(m.ambiances[1]);
  await attendre();
  verifier(c.retenue === null, "son choix efface le retour prévu");
  finirAuServeur();
  await relire();
  verifier(m.courante === "route" && json(m.fondus) === json(["auberge", "combat", "route"]), `la route continue : ${json(m.fondus)}`);
});

await scene("le MJ change puis revient à la musique de combat", async (m) => {
  m.choisir(m.ambiances[0]);
  await attendre();
  commencerAuServeur();
  await relire();
  m.choisir(m.ambiances[1]);
  m.choisir(m.ambiances[2]);
  await attendre();
  finirAuServeur();
  await relire();
  verifier(m.courante === "combat", "il a repris la main : la musique de combat continue après le combat");
});

await scene("pause de la musique de combat, puis fin", async (m, c) => {
  m.choisir(m.ambiances[0]);
  await attendre();
  commencerAuServeur();
  await relire();
  m.pause();
  await attendre();
  verifier(c.fin !== null && c.retenue !== null, "en pause pendant le combat : le retour reste prévu, l'écoute aussi");
  finirAuServeur();
  await relire();
  verifier(m.courante === "combat" && m.enPause && m.fondus.length === 2, "à la fin, rien ne repart tout seul");
  verifier(c.retenue === null && c.fin === null, "et plus rien n'est retenu ni écouté");
});

await scene("pause puis reprise de la musique de combat, puis fin", async (m) => {
  m.choisir(m.ambiances[0]);
  await attendre();
  commencerAuServeur();
  await relire();
  m.pause();
  m.choisir(m.ambiances[2]);
  await attendre();
  finirAuServeur();
  await relire();
  verifier(m.courante === "auberge", "reprise : l'auberge revient bien à la fin");
});

await scene("combat déjà en cours quand la musique commence", async (m, c) => {
  commencerAuServeur();
  avancer();
  m.choisir(m.ambiances[0]);
  await attendre();
  verifier(c.auCombat === true && m.courante === "auberge" && m.fondus.length === 1, "pas de bascule d'office");
  await relire();
  verifier(m.fondus.length === 1, "ni à la relecture suivante");
  finirAuServeur();
  await relire();
  verifier(m.courante === "auberge" && m.fondus.length === 1, "ni retour à la fin");
});

await scene("état du jeu périmé au moment d'écouter", async (m, c) => {
  // Le tableau a lu « hors combat » il y a longtemps ; un combat a commencé depuis sur un autre écran.
  const fin = ecouterEtatJeu(() => {});
  await attendre();
  fin();
  commencerAuServeur();
  avancer(120_000);
  m.choisir(m.ambiances[0]);
  await attendre();
  verifier(c.auCombat === true && m.fondus.length === 1, `l'ancienne lecture ne sert pas de point de départ : ${c.auCombat}, ${json(m.fondus)}`);
});

await scene("aucune ambiance de combat choisie", async (m, c) => {
  m.ambianceCombat = null;
  m.choisir(m.ambiances[0]);
  await attendre();
  verifier(c.fin === null, "rien à écouter sans ambiance de combat");
  commencerAuServeur();
  await relire();
  verifier(m.courante === "auberge" && m.fondus.length === 1, "pas de bascule");
});

await scene("l'ambiance de combat joue déjà au début du combat", async (m, c) => {
  m.choisir(m.ambiances[2]);
  await attendre();
  commencerAuServeur();
  await relire();
  verifier(m.fondus.length === 1 && c.retenue === null, "rien à faire ni à retenir");
  finirAuServeur();
  await relire();
  verifier(m.courante === "combat" && m.fondus.length === 1, "rien à rendre à la fin");
});

await scene("l'ambiance d'avant retirée de la liste pendant le combat", async (m, c) => {
  m.choisir(m.ambiances[0]);
  await attendre();
  commencerAuServeur();
  await relire();
  m.ambiances = m.ambiances.filter((a) => a.id !== "auberge");
  const vus = toasts.length;
  finirAuServeur();
  await relire();
  verifier(m.courante === "combat" && c.retenue === null, "rien ne revient");
  verifier(toasts.length === vus + 1 && /plus dans la liste/.test(toasts[toasts.length - 1]), `le MJ est prévenu : ${toasts[toasts.length - 1]}`);
});

await scene("l'ambiance de combat absente de la liste du lecteur", async (m, c) => {
  m.choisir(m.ambiances[0]);
  await attendre();
  m.ambiances = m.ambiances.filter((a) => a.id !== "combat");
  const vus = toasts.length;
  commencerAuServeur();
  await relire();
  verifier(m.courante === "auberge" && m.fondus.length === 1 && c.retenue === null, "rien ne bascule, rien n'est retenu");
  verifier(toasts.length === vus + 1 && /de combat n'est plus dans la liste/.test(toasts[toasts.length - 1]), `le MJ est prévenu : ${toasts[toasts.length - 1]}`);
});

await scene("le combat illisible un instant (réseau) ne fait pas revenir la musique", async (m) => {
  m.choisir(m.ambiances[0]);
  await attendre();
  commencerAuServeur();
  await relire();
  serveur.combatIllisible = true;
  await relire();
  verifier(m.courante === "combat" && m.fondus.length === 2, `toujours la musique de combat : ${json(m.fondus)}`);
  serveur.combatIllisible = false;
  await relire();
  verifier(m.fondus.length === 2, "et rien ne rebascule quand il redevient lisible");
});

await scene("le réglage passe à « Aucune » pendant le combat", async (m, c) => {
  m.choisir(m.ambiances[0]);
  await attendre();
  commencerAuServeur();
  await relire();
  m.ambianceCombat = null;
  c.suivre();
  verifier(c.fin !== null, "l'écoute continue tant qu'une ambiance est à rendre");
  finirAuServeur();
  await relire();
  verifier(m.courante === "auberge", "l'auberge revient quand même");
});

await scene("deux combats de suite", async (m) => {
  m.choisir(m.ambiances[0]);
  await attendre();
  for (let n = 0; n < 2; n++) {
    commencerAuServeur();
    await relire();
    verifier(m.courante === "combat", `combat ${n + 1} : bascule`);
    finirAuServeur();
    await relire();
    verifier(m.courante === "auberge", `combat ${n + 1} : retour`);
  }
  verifier(json(m.fondus) === json(["auberge", "combat", "auberge", "combat", "auberge"]), `fondus : ${json(m.fondus)}`);
});

// Le réglage, lu ailleurs que dans le panneau (« Avant de jouer », la préparation du combat) : rien tant que la liste
// n'est pas lue, puis l'ambiance choisie.
{
  verifier(reglageCombat() === null, "réglage : rien tant que la liste n'est pas lue");
  const m = new FauxLecteur();
  m.chargee = true;
  new MusiqueDesCombats(m, { ecouter: () => () => {}, cible: m.cible });
  verifier(json(reglageCombat()) === json({ ambiances: m.ambiances, combat: "combat" }), `réglage lu : ${json(reglageCombat())}`);
  m.ambianceCombat = null;
  verifier(reglageCombat().combat === null, "réglage : aucune ambiance de combat");
}

console.log(defauts ? `${defauts} défaut(s) sur ${verifications} vérifications` : `Aucun défaut (${verifications} vérifications)`);
process.exit(defauts ? 1 : 0);
