// L'atelier écoute la table (/ws/atelier) : l'état que reçoit la TV du salon, à l'instant où elle le reçoit. Une seule
// liaison par page, partagée par les modules qui veulent savoir ce que voient les joueurs ; elle se relance seule si elle
// tombe, tant qu'un module écoute. L'état est la version publique (jetons, noms masqués), comme sur la TV.
const abonnes = new Set();
// Ceux qui veulent savoir qu'un combat a changé (le serveur le dit aux seules pages de l'atelier) : ecouterCombats().
const combats = new Set();
// Ceux qui veulent savoir que la boîte des demandes des joueurs a changé (pastille, page #/demandes) : ecouterDemandes().
const demandes = new Set();
// Ceux qui veulent savoir qu'un joueur a changé un sac depuis son téléphone (le Tableau, « La compagnie ») : ecouterSacs().
const sacs = new Set();
// Ceux qui veulent savoir qu'une main se lève ou qu'un joueur arrive au coin (salle/salle.js) : ecouterSalle().
const salle = new Set();
// Ceux qui veulent savoir qu'un joueur a bougé son pion sur un plan (l'éditeur ouvert, plan/mouvements-joueurs.js) :
// ecouterPlans().
const plans = new Set();
// Ceux qui veulent savoir qu'un billet privé est parti, a été lu ou retiré (prives/telephone.js) : ecouterPrives().
const prives = new Set();
// Ceux qui veulent les jets à distance (lot F3, jets/jets.js) : un test lancé, demandé ou retiré : ecouterJets().
const jets = new Set();
// Ceux qui veulent savoir qu'un joueur a réglé la Santé, la Psy ou la posture de son héros depuis la table du coin
// (mj/etats-joueurs.js) : ecouterEtatsJoueurs().
const etatsJoueurs = new Set();
// Ceux qui veulent savoir qu'un joueur pointe sur le plan ou la carte depuis le coin (pointeurs_mj.py, lot du 13/11) :
// ecouterPointeursJoueurs().
const pointeursJoueurs = new Set();
let liaison = null;
let dernier = null;

function relier() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/atelier`);
  liaison = ws;
  let dernierMessage = Date.now();
  // Le serveur écrit au moins toutes les 45 secondes : deux minutes de silence, et la liaison est tenue pour morte.
  const garde = setInterval(() => {
    if (Date.now() - dernierMessage > 120000) ws.close();
  }, 30000);
  ws.onmessage = (ev) => {
    dernierMessage = Date.now();
    let msg = null;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "jets") {
      for (const fn of [...jets]) {
        try {
          fn(msg);
        } catch (err) {
          console.error(err);
        }
      }
      return;
    }
    if (msg.type === "pointeurs-joueurs") {
      for (const fn of [...pointeursJoueurs]) {
        try {
          fn(msg);
        } catch (err) {
          console.error(err);
        }
      }
      return;
    }
    if (msg.type === "salle") {
      for (const fn of [...salle]) {
        try {
          fn(msg);
        } catch (err) {
          console.error(err);
        }
      }
      return;
    }
    if (msg.type === "combat" || msg.type === "demandes" || msg.type === "sac" || msg.type === "plan" || msg.type === "prives" || msg.type === "etat-joueur") {
      for (const fn of [...({ combat: combats, demandes, sac: sacs, plan: plans, prives, "etat-joueur": etatsJoueurs })[msg.type]]) {
        try {
          fn(msg);
        } catch (err) {
          console.error(err);
        }
      }
      return;
    }
    if (msg.type !== "etat" || !msg.etat) return;
    dernier = msg.etat;
    for (const fn of [...abonnes]) {
      try {
        fn(dernier);
      } catch (err) {
        console.error(err);
      }
    }
  };
  ws.onclose = () => {
    clearInterval(garde);
    if (liaison === ws) liaison = null;
    setTimeout(() => {
      if (!liaison && (abonnes.size || combats.size || demandes.size || sacs.size || salle.size || plans.size || prives.size || jets.size || pointeursJoueurs.size)) relier();
    }, 2500);
  };
  ws.onerror = () => ws.close();
}

// fn(etat) à chaque état de la table, et tout de suite avec le dernier connu ; renvoie de quoi cesser d'écouter.
export function ecouterTable(fn) {
  abonnes.add(fn);
  if (dernier) fn(dernier);
  if (!liaison) relier();
  return () => abonnes.delete(fn);
}

// fn(signal) dès qu'un combat est enregistré ou fini sur n'importe quel écran (le Mac, l'iPad, la télécommande), même
// quand la TV ne montre pas l'ordre du tour : { seance, modifie, par } (modifie null : fini). Renvoie de quoi cesser.
export function ecouterCombats(fn) {
  combats.add(fn);
  if (!liaison) relier();
  return () => combats.delete(fn);
}

// fn(signal) dès que la boîte des demandes des joueurs change (une demande, une commande, un aventurier envoyé, un geste du
// MJ sur un autre écran) : { compte, pause, signature }. Renvoie de quoi cesser.
export function ecouterDemandes(fn) {
  demandes.add(fn);
  if (!liaison) relier();
  return () => demandes.delete(fn);
}

// fn(signal) dès qu'un geste d'un joueur (son sac, un don) a changé des sacs : { heros : les identifiants des fiches }.
// Renvoie de quoi cesser.
export function ecouterSacs(fn) {
  sacs.add(fn);
  if (!liaison) relier();
  return () => sacs.delete(fn);
}

// fn(vue) dès qu'une main se lève ou se baisse, ou qu'un joueur arrive au coin ou le quitte : la vue entière de la salle
// (salle.py), { mains, en_ligne, presence, signature… }. Renvoie de quoi cesser.
export function ecouterSalle(fn) {
  salle.add(fn);
  if (!liaison) relier();
  return () => salle.delete(fn);
}

// fn(signal) dès qu'un joueur a bougé son pion depuis le coin (ou que le MJ a annulé ce déplacement depuis la boîte) :
// { plan : son identifiant, mouvements : [{ id, pion, avant, apres, cases, brouillard, version_avant, version_apres… }] }.
// Renvoie de quoi cesser.
export function ecouterPlans(fn) {
  plans.add(fn);
  if (!liaison) relier();
  return () => plans.delete(fn);
}

// fn(signal) dès qu'un billet privé part vers un téléphone, y est lu ou en est retiré (prives_mj.py) : { signature }.
// Renvoie de quoi cesser.
export function ecouterPrives(fn) {
  prives.add(fn);
  if (!liaison) relier();
  return () => prives.delete(fn);
}

// fn(vue) dès qu'un joueur lance un test depuis le coin, que le MJ en demande ou en retire un, ou que la table du coin ou la
// pause changent : la vue entière des jets (jets_mj.py), { jets, demandes, joueurs, ouvert, pause, signature… }. Renvoie de
// quoi cesser.
export function ecouterJets(fn) {
  jets.add(fn);
  if (!liaison) relier();
  return () => jets.delete(fn);
}

// fn(signal) dès qu'un joueur a réglé son héros depuis la table du coin (etat_joueur_mj.py) : { joueur, heros, heros_id,
// quoi : "sante" | "psy" | "posture", avant, apres, combat }. Renvoie de quoi cesser.
export function ecouterEtatsJoueurs(fn) {
  etatsJoueurs.add(fn);
  if (!liaison) relier();
  return () => etatsJoueurs.delete(fn);
}

// fn(signal) à chaque changement des pointeurs que les joueurs posent depuis le coin : { pointeurs : [{ joueur, nom, couleur,
// genre : "plan" | "carte", id, x, y, onde, onde_age }] } (la liste entière, vide quand plus personne ne pointe). Renvoie de
// quoi cesser.
export function ecouterPointeursJoueurs(fn) {
  pointeursJoueurs.add(fn);
  if (!liaison) relier();
  return () => pointeursJoueurs.delete(fn);
}
