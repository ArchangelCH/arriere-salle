// Les réglages du compte principal dans la page Réglages (reglages.js), chargés au clic chez le MJ principal seulement : un MJ
// invité ne reçoit pas ce module (acces_mj.STATIQUES_INVITE), ni ceux qu'il importe, et le serveur lui refuse leurs
// routes (acces_mj.REGLES).
//
// Les blocs viennent de là où ils vivaient avant (onglets Table, Aventuriers, Bible, Sanctuaire, page des activités) ;
// ceux qui n'avaient pas de module à eux sont ici : la table publique, les comptes des joueurs, le sanctuaire et les
// activités ouverts aux joueurs, la charte visuelle des portraits.

import { api, echapper as e, toast } from "../api.js";
import { ajouterBlocCoin } from "../demandes/reglages.js";
import { ajouterBlocAideJoueurs } from "../demandes/aide-joueurs.js";
import { ajouterBlocPionsJoueurs, ajouterBlocTableJoueurs } from "../joueurs/table-mj.js";
import { ajouterReglageDesAventure } from "../jets/reserve-table.js";
import { ajouterBlocNomAuberge } from "../auberge/nom-auberge.js";
import { interrupteurCarnet } from "../joueurs/carnet-mj.js";
import { blocBibleJoueurs } from "../bible/joueurs-mj.js";
import { blocBudgetsDesMJ, blocDesMJ } from "../mj/les-mj.js";
import { PanneauConfort } from "../confort/confort.js";
import * as C from "../aventuriers/compte-joueur.js";

function zone(grille, classe = "") {
  const z = document.createElement("div");
  if (classe) z.className = classe;
  grille.append(z);
  return z;
}

// Une écriture d'un document entier avec sa version (le sanctuaire, le catalogue des activités) : relu juste avant,
// et relu une fois de plus si un autre écran l'a changé entre-temps (409).
async function changerAvecVersion(url, champs) {
  for (let essai = 0; ; essai++) {
    const doc = await api.get(url);
    try {
      return await api.put(url, { ...doc, ...champs, version_base: doc.modifie ?? null });
    } catch (err) {
      if (err.status !== 409 || essai) throw err;
    }
  }
}

// ---------------------------------------------------------------- Table et TV : la table publique

function blocTablePublique(grille) {
  const bloc = zone(grille, "bloc table-publique");
  const dessiner = (pub) => {
    bloc.innerHTML = `
      <h2>Table publique</h2>
      <div class="choix-publique" role="group" aria-label="Table publique">
        <button type="button" data-publique="oui" aria-pressed="${pub.ouverte}">Ouverte</button>
        <button type="button" data-publique="non" aria-pressed="${!pub.ouverte}">Fermée</button>
      </div>
      <p>${pub.ouverte
        ? "Ouverte : qui a l'adresse en ligne voit en direct ce que montre la TV du salon."
        : `Fermée : un écran venu d'Internet ne voit que l'écran d'accueil${pub.prochaine ? `, avec « Prochaine séance : ${e(pub.prochaine)} »` : ", sans date de séance"}.`}</p>
      ${pub.adresse ? `<p class="aide">Adresse en ligne : <code>${e(pub.adresse)}</code>. La TV du salon n'est jamais touchée par ce réglage.</p>` : ""}`;
  };
  let pub = null;
  const lire = () => api.get("/api/table").then((t) => { pub = t.publique || { ouverte: true }; dessiner(pub); }).catch(() => {
    bloc.innerHTML = '<h2>Table publique</h2><p class="aide">Le réglage ne se lit pas pour l\'instant.</p>';
  });
  bloc.innerHTML = '<h2>Table publique</h2><p class="aide">Lecture…</p>';
  lire();
  bloc.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-publique]");
    if (!b || !pub) return;
    const ouverte = b.dataset.publique === "oui";
    if (ouverte === pub.ouverte) return;
    try {
      await api.put("/api/table-publique", { ouverte });
      toast(ouverte ? "Table publique ouverte : les écrans d'Internet voient la TV du salon." : "Table publique fermée : les écrans d'Internet ne voient plus que l'accueil.");
    } catch (err) {
      toast(`La table ne répond pas : ${err.message}`, "erreur");
    }
    lire();
  });
}

// ---------------------------------------------------------------- Coin des joueurs : le carnet, la bible

function blocCarnet(grille) {
  const bloc = zone(grille, "bloc bloc-carnet-reglages");
  bloc.innerHTML = '<h2>Le carnet des joueurs</h2><div class="carnet-des-joueurs"></div>';
  interrupteurCarnet(bloc.querySelector(".carnet-des-joueurs"));
}

function blocBible(grille) {
  const bloc = zone(grille, "bloc bloc-bible-reglages");
  bloc.innerHTML = '<h2>La bible des joueurs</h2><div class="bible-joueurs"></div>';
  blocBibleJoueurs(bloc.querySelector(".bible-joueurs"));
}

// ---------------------------------------------------------------- Coin des joueurs : le sanctuaire

function blocSanctuaire(grille) {
  const bloc = zone(grille, "bloc bloc-sanctuaire-reglages");
  const dessiner = (s) => {
    const noms = (s.catalogue || []).filter((t) => t.joueurs).map((t) => t.nom);
    const proposes = noms.length ? `les projets cochés au catalogue (${noms.join(", ")})` : "aucun projet (cochez « Proposé aux joueurs » sur un type du catalogue)";
    bloc.innerHTML = `
      <h2>Le sanctuaire</h2>
      <div class="choix-publique" role="group" aria-label="Sanctuaire visible des joueurs">
        <button type="button" data-sanctuaire="oui" aria-pressed="${Boolean(s.joueurs)}">Visible</button>
        <button type="button" data-sanctuaire="non" aria-pressed="${!s.joueurs}">Caché</button>
      </div>
      <p>${s.joueurs ? `Visible : dans leur carnet, le village, chaque bâtiment non caché avec sa cagnotte et son prochain niveau, et ${e(proposes)}. Ils versent de leur bourse et proposent des projets : vous validez dans la boîte Demandes.`
        : "Caché : leur carnet n'en dit rien. Visible, ils y lisent le village, chaque bâtiment non caché avec sa cagnotte, et les types cochés « Proposé aux joueurs » ; ils versent et proposent, vous validez."}</p>
      <p class="aide">Ce que les joueurs peuvent proposer : la case « Proposé aux joueurs » de chaque type du catalogue, <a href="#/sanctuaire">onglet Sanctuaire</a>.</p>`;
  };
  let s = null;
  bloc.innerHTML = '<h2>Le sanctuaire</h2><p class="aide">Lecture…</p>';
  api.get("/api/sanctuaire").then((x) => { s = x; dessiner(s); }).catch(() => {
    bloc.innerHTML = '<h2>Le sanctuaire</h2><p class="aide">Le sanctuaire ne se lit pas pour l\'instant.</p>';
  });
  bloc.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-sanctuaire]");
    if (!b || !s || b.getAttribute("aria-pressed") === "true") return;
    const joueurs = b.dataset.sanctuaire === "oui";
    try {
      s = await changerAvecVersion("/api/sanctuaire", { joueurs });
      toast(joueurs ? "Sanctuaire visible des joueurs, dans leur carnet." : "Sanctuaire caché aux joueurs.");
    } catch (err) {
      toast(`Réglage non enregistré : ${err.message}`, "erreur");
      s = await api.get("/api/sanctuaire").catch(() => s);
    }
    dessiner(s);
  });
}

// ---------------------------------------------------------------- Coin des joueurs : les activités de la semaine

function blocActivites(grille) {
  const bloc = zone(grille, "bloc bloc-activites-reglages");
  let c = null;
  let et = null;
  const dessiner = () => {
    bloc.innerHTML = `
      <h2>Les activités</h2>
      <div class="choix-publique" role="group" aria-label="Activités ouvertes aux joueurs">
        <button type="button" data-activites="oui" aria-pressed="${Boolean(c.ouvert)}">Ouvertes</button>
        <button type="button" data-activites="non" aria-pressed="${!c.ouvert}">Fermées</button>
      </div>
      <p>${c.ouvert ? `Ouvertes : les activités montrées paraissent dans leur carnet${et?.carnet_ouvert === false ? " (le carnet est fermé en ce moment : rien ne paraît avant qu'il rouvre)" : ""}.`
        : "Fermées : le carnet des joueurs n'en montre aucune."}</p>
      <fieldset class="periode-mj"><legend>Chaque activité une fois par héros</legend>
        <label class="case"><input type="radio" name="periode-reglages" value="semaine" data-periode${c.periode === "semaine" ? " checked" : ""}> par semaine</label>
        <label class="case"><input type="radio" name="periode-reglages" value="seance" data-periode${c.periode === "seance" ? " checked" : ""}> entre deux séances</label>
      </fieldset>
      <p class="aide">${et?.periode?.libelle ? `En ce moment : ${e(et.periode.libelle)}. ` : ""}Entre deux séances, la période change quand une séance est close. Le catalogue : <a href="#/auberge/activites">Les activités</a>, onglet Auberge.</p>`;
  };
  bloc.innerHTML = '<h2>Les activités</h2><p class="aide">Lecture…</p>';
  const lire = () => Promise.all([api.get("/api/activites"), api.get("/api/activites/etat").catch(() => null)]).then(([x, y]) => {
    c = x;
    et = y;
    dessiner();
  }).catch(() => {
    bloc.innerHTML = '<h2>Les activités</h2><p class="aide">Le catalogue ne se lit pas pour l\'instant.</p>';
  });
  lire();
  const changer = async (champs, dit) => {
    try {
      c = await changerAvecVersion("/api/activites", champs);
      et = await api.get("/api/activites/etat").catch(() => et);
      toast(dit);
    } catch (err) {
      toast(`Réglage non enregistré : ${err.message}`, "erreur");
      return lire();
    }
    dessiner();
  };
  bloc.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-activites]");
    if (!b || !c || b.getAttribute("aria-pressed") === "true") return;
    const ouvert = b.dataset.activites === "oui";
    changer({ ouvert }, ouvert ? "Activités ouvertes : les activités montrées paraissent dans le carnet des joueurs." : "Activités fermées aux joueurs.");
  });
  bloc.addEventListener("change", (ev) => {
    if (!ev.target.matches("[data-periode]") || !c) return;
    const periode = ev.target.value;
    changer({ periode }, periode === "semaine" ? "Chaque activité une fois par héros et par semaine." : "Chaque activité une fois par héros entre deux séances.");
  });
}

// ---------------------------------------------------------------- Accès : les comptes des joueurs

function blocComptesJoueurs(grille) {
  const bloc = zone(grille, "bloc joueurs-en-ligne comptes-joueurs-reglages large");
  bloc.innerHTML = `
    <h2>Les comptes des joueurs</h2>
    <p>Chaque joueur a son compte : « Créer son compte » lui donne un identifiant et un mot de passe provisoire, à dicter ou à envoyer. Il se connecte au coin des joueurs, choisit son propre mot de passe, puis crée son aventurier étape par étape et vous l'envoie ; il ne voit rien d'autre de l'atelier.</p>
    <p class="aide">Mot de passe oublié : « Nouveau mot de passe provisoire ». Ses appareils sont déconnectés ; son identifiant ne change pas. Accueillir son aventurier, le relier à un héros, le retirer : <a href="#/aventuriers">onglet Aventuriers</a>.</p>
    <ul class="liste-joueurs"><li class="aide">Chargement…</li></ul>
    <form class="inviter-joueur">
      <label class="champ">Inviter un joueur<input type="text" name="nom" maxlength="60" placeholder="Son prénom" required></label>
      <button class="principal" type="submit">Inviter</button>
    </form>`;
  const liste = bloc.querySelector(".liste-joueurs");
  let joueurs = [];
  const lire = async () => {
    try {
      joueurs = await api.get("/api/joueurs");
    } catch (err) {
      liste.innerHTML = `<li class="alerte">Liste des joueurs indisponible : ${e(err.message)}</li>`;
      return;
    }
    liste.innerHTML = joueurs.length ? joueurs.map((j) => `
      <li class="joueur-en-ligne" data-joueur="${e(j.id)}" data-etat="${j.compte?.compte ? "accueilli" : "invite"}">
        <div class="qui"><b>${e(j.nom)}</b><span class="compte-joueur">${C.htmlEtatCompte(j)}</span></div>
        ${C.htmlCreerCompte(j)}
        ${j.compte ? `<div class="actions">${C.htmlBoutonCompte(j)}</div>` : ""}
      </li>`).join("") : '<li class="aide">Aucun joueur invité pour l\'instant.</li>';
  };
  lire();
  bloc.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button[data-joueur-compte]");
    if (!b) return;
    try {
      await C.tirerProvisoire(b, joueurs);
    } catch (err) {
      toast(err.message, "erreur");
    } finally {
      // Tiré ou refusé (identifiant pris), la liste se relit : l'état du compte a pu changer ailleurs.
      if (bloc.isConnected) await lire();
    }
  });
  bloc.querySelector(".inviter-joueur").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const champ = ev.target.querySelector('[name="nom"]');
    try {
      const j = await api.post("/api/joueurs", { nom: champ.value });
      champ.value = "";
      await lire();
      // Sa ligne attend son compte : l'identifiant proposé, prêt à corriger, puis « Créer son compte ».
      bloc.querySelector(`[data-identifiant-de="${CSS.escape(j.id)}"]`)?.focus();
      toast(`${j.nom} est invité : vérifiez son identifiant, puis « Créer son compte » lui donne un mot de passe provisoire.`);
    } catch (err) {
      toast(err.message, "erreur");
    }
  });
}

// ---------------------------------------------------------------- Rédaction : la charte visuelle des portraits

function blocCharte(grille) {
  const bloc = zone(grille, "bloc bloc-charte-reglages");
  bloc.innerHTML = `
    <h2>Les portraits</h2>
    <p>La charte visuelle : les repères (peuples, Églises, ordres, lieux) que l'atelier glisse dans la consigne d'un portrait dès qu'un de leurs mots paraît dans la description.</p>
    <div class="actions"><button type="button" data-charte>Ouvrir la charte visuelle</button></div>
    <p class="aide">Elle s'ouvre aussi depuis la fenêtre d'un portrait, sur la fiche d'un PNJ ou d'un lieu.</p>`;
  bloc.querySelector("[data-charte]").addEventListener("click", async () => {
    try {
      (await import("../illustrations/charte.js")).ouvrirCharte();
    } catch (err) {
      toast(`Charte indisponible : ${err.message}`, "erreur");
    }
  });
}

// Les blocs du principal, section par section (grilles : { coin, table, regles, acces, redaction }). Rend ce qu'il faut
// finir en quittant la page (le confort de la table enregistre ce qui attend).
export function monterReglagesDuPrincipal(grilles, { confort = false } = {}) {
  const { coin, table, regles, acces, redaction } = grilles;

  ajouterBlocCoin(coin);
  blocCarnet(coin);
  ajouterBlocTableJoueurs(coin);
  blocBible(coin);
  blocSanctuaire(coin);
  blocActivites(coin);

  blocTablePublique(table);
  ajouterBlocNomAuberge(table);

  ajouterReglageDesAventure(regles);
  ajouterBlocPionsJoueurs(regles);
  // Le panneau a son propre cadre (confort/confort.js) : pas de bloc autour.
  const zoneConfort = zone(regles, "zone-confort large");
  zoneConfort.id = "confort";
  const panneau = new PanneauConfort(zoneConfort, { ouvrir: confort });
  panneau.demarrer();

  blocDesMJ(zone(acces, "large"), { budgets: false });
  blocComptesJoueurs(acces);

  ajouterBlocAideJoueurs(redaction);
  blocBudgetsDesMJ(zone(redaction));
  blocCharte(redaction);

  return { detruire: () => panneau.detruire() };
}
