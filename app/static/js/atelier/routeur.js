// Le routeur : monter une page, annuler celle qui est périmée.

import { api, echapper as e, toast } from "../api.js";
import { Carnet } from "../pnj/carnet.js";
import { Auberge } from "../auberge/auberge.js";
import { Boutiques } from "../boutiques/boutiques.js";
import { Documents } from "../documents/documents.js";
import { Sanctuaire } from "../sanctuaire/sanctuaire.js";
import { Seances } from "../seances/seances.js";
import { Balance } from "../combats/balance.js";
import { Combat } from "../combats/combat.js";
import { Corbeille, Versions, ongletDe } from "../corbeille/corbeille-page.js";
import { Createur } from "../aventuriers/createur.js";
import { BoiteDemandes } from "../demandes/boite.js";
import { Tablee } from "../aventuriers/tablee.js";
import { Bible } from "../bible/bible.js";
import { FicheLieu } from "../lieux/fiche-lieu.js";
import { Idees } from "../idees/idees.js";
import { ReglesMaison } from "../regles/regles.js";
import { reessaisEnAttente, relancerTout } from "../commun/reessai.js";
import { Scenarios } from "../scenarios/scenarios.js";
import { estInvite } from "../mj/role.js";
import { PAGES_FERMEES } from "../mj/menu-invite.js";
import { EditeurPlan } from "../plan/editeur.js";
import { pageCarte, pageCartes } from "./cartes.js";
import { S, onglet, page } from "./etat.js";
import { pageFermee, pageLieux, pageTable } from "./pages.js";

const perimee = (n) => n !== S.navigation;

// Les boîtes de dialogue ouvertes quand l'adresse change : fermées comme par « Annuler » (Échap), jamais validées.
function fermerLesDialogues() {
  for (const d of document.querySelectorAll("dialog[open]")) {
    try {
      d.close();
    } catch {
      d.removeAttribute("open");
    }
  }
}

// Chaque page s'ouvre en haut : le défilement de la précédente ne se reporte pas (le corps ne défile pas à la molette,
// rien ne le ramènerait).
function remonter() {
  window.scrollTo(0, 0);
  for (const el of [document.scrollingElement, document.body, page]) if (el && el.scrollTop) el.scrollTop = 0;
}

// Ce que dit une page qui ne s'ouvre pas : une fiche qui n'existe pas (ou plus) n'est pas une panne.
function phraseErreur(err) {
  if (err?.status === 404) return "cette fiche n'existe pas ou plus (elle a peut-être été supprimée, ou l'adresse est erronée)";
  if (err?.status === 403) return "cette page n'est pas ouverte à votre compte";
  return err?.message || "erreur inconnue";
}

// Une adresse que l'atelier ne connaît pas : on le dit, au lieu de montrer la liste des cartes comme si de rien n'était.
function pageInconnue(chemin) {
  onglet("cartes");
  document.body.dataset.page = "introuvable";
  page.innerHTML = `
    <section class="page-liste">
      <header class="titre-page">
        <p class="kicker">Adresse inconnue</p>
        <h1>Cette page n'existe pas</h1>
        <p class="chapo">L'adresse « <code>#${e(chemin || "/")}</code> » ne mène à rien dans l'atelier : elle est peut-être mal recopiée, ou la fiche a été supprimée.</p>
        <div class="actions"><a class="bouton principal" href="#/cartes">Retour aux cartes</a><a class="bouton" href="#/scenarios">Aller aux scénarios</a></div>
      </header>
    </section>`;
}

// Une page (classe) se construit, démarre, et n'est gardée que si l'on n'a pas navigué entre-temps.
async function monter(n, fabrique) {
  const instance = fabrique();
  S.courant = instance;
  await instance.demarrer();
  if (perimee(n) && S.courant === instance) {
    S.courant = null;
    await instance.detruire();
  }
}

async function router() {
  const n = ++S.navigation;
  if (S.courant) {
    const quittee = S.courant;
    S.courant = null;
    // La page quittée finit d'enregistrer avant que la suivante ne relise les mêmes fiches.
    try {
      await quittee.detruire();
      // Un envoi resté sans réponse (celui d'une page quittée plus tôt compris) repart lui aussi d'abord.
      if (reessaisEnAttente()) await relancerTout();
    } catch (err) {
      toast(`Dernier enregistrement impossible : ${err.message}`, "erreur");
    }
    if (perimee(n)) return;
  }
  // Une question restée ouverte (retour arrière, adresse changée à la main) ne reste pas posée sur la page suivante ; la
  // page repart en haut (rien ne la décale d'avance).
  fermerLesDialogues();
  remonter();
  const [chemin, requete] = (location.hash.slice(1) || "/cartes").split("?");
  const parametres = new URLSearchParams(requete || "");
  const morceaux = chemin.split("/").filter(Boolean);
  try {
    // Un MJ invité n'ouvre ni la campagne du MJ principal ni ses réglages (mj/menu-invite.js) : le serveur les lui refuse.
    if (estInvite() && (PAGES_FERMEES.has(morceaux[0]) || (morceaux[0] === "auberge" && morceaux[1] === "activites"))) pageFermee();
    else if (morceaux[0] === "carte" && morceaux[1]) await pageCarte(n, morceaux[1], parametres);
    else if (morceaux[0] === "plan" && morceaux[1]) {
      onglet("cartes");
      page.innerHTML = `<div class="chargement plein">Dépliage du plan…</div>`;
      const plan = await api.get(`/api/plans/${morceaux[1]}`);
      if (perimee(n)) return;
      await monter(n, () => new EditeurPlan(page, plan));
    }
    else if (morceaux[0] === "lieux") await pageLieux(n);
    else if (morceaux[0] === "monde") {
      // Le monde tel que les joueurs le connaissent, en lecture (mj/monde.js), pour un MJ invité ; chargé à l'ouverture.
      onglet("monde");
      const { Monde } = await import("../mj/monde.js");
      if (perimee(n)) return;
      await monter(n, () => new Monde(page));
    }
    else if (morceaux[0] === "lieu" && morceaux[1]) {
      onglet("lieux");
      await monter(n, () => new FicheLieu(page, { id: morceaux[1] }));
    }
    else if (morceaux[0] === "pnj") {
      onglet("pnj");
      await monter(n, () => new Carnet(page, { id: morceaux[1], parametres }));
    }
    else if (morceaux[0] === "auberge" && morceaux[1] === "activites") {
      // Les activités entre les séances (activites/catalogue.js) : sous l'onglet Auberge, en page qui défile.
      onglet("auberge");
      document.body.dataset.page = "activites";
      const { Activites } = await import("../activites/catalogue.js");
      if (perimee(n)) return;
      await monter(n, () => new Activites(page));
    }
    else if (morceaux[0] === "auberge") {
      onglet("auberge");
      await monter(n, () => new Auberge(page, { genre: morceaux[1], id: morceaux[2] }));
    }
    else if (morceaux[0] === "sanctuaire") {
      onglet("sanctuaire");
      await monter(n, () => new Sanctuaire(page, { id: morceaux[1] }));
    }
    else if (morceaux[0] === "boutiques") {
      onglet("boutiques");
      await monter(n, () => new Boutiques(page, { id: morceaux[1], parametres }));
    }
    else if (morceaux[0] === "scenarios") {
      onglet("scenarios");
      await monter(n, () => new Scenarios(page, { id: morceaux[1], parametres }));
    }
    else if (morceaux[0] === "seances") {
      onglet("seances");
      await monter(n, () => new Seances(page, { id: morceaux[1], parametres }));
    }
    else if (morceaux[0] === "tablee") {
      onglet("aventuriers");
      await monter(n, () => new Tablee(page));
    }
    else if (morceaux[0] === "aventuriers") {
      onglet("aventuriers");
      await monter(n, () => new Createur(page, { id: morceaux[1], parametres }));
    }
    else if (morceaux[0] === "combats") {
      onglet("combats");
      await monter(n, () => new Balance(page, { id: morceaux[1] }));
    }
    else if (morceaux[0] === "combat" && morceaux[1]) {
      onglet("combats");
      await monter(n, () => new Combat(page, { seance: morceaux[1], parametres }));
    }
    else if (morceaux[0] === "idees") {
      onglet("idees");
      await monter(n, () => new Idees(page, { parametres }));
    }
    else if (morceaux[0] === "documents") {
      onglet("documents");
      await monter(n, () => new Documents(page, { id: morceaux[1] }));
    }
    else if (morceaux[0] === "bible") {
      onglet("bible");
      await monter(n, () => new Bible(page, { parametres }));
      // Où en est la bible des joueurs, sous la recherche (l'interrupteur est dans les Réglages) : il n'entre pas dans le
      // module que sert le coin.
      if (!perimee(n) && !estInvite()) import("../bible/joueurs-mj.js").then((m) => m.etatBibleJoueurs(page)).catch(() => {});
    }
    // Le confort de la table a quitté les Règles maison pour les Réglages : une adresse d'avant y mène.
    else if (morceaux[0] === "regles" && parametres.has("confort")) location.replace("#/reglages/regles?confort");
    else if (morceaux[0] === "regles") {
      onglet("regles");
      await monter(n, () => new ReglesMaison(page, { id: morceaux[1], parametres }));
    }
    else if (morceaux[0] === "table") await pageTable(n);
    else if (morceaux[0] === "reglages") {
      // Les paramètres et les accès, en sections (reglages/reglages.js) ; chargée à l'ouverture.
      onglet("reglages");
      const { Reglages } = await import("../reglages/reglages.js");
      if (perimee(n)) return;
      await monter(n, () => new Reglages(page, { section: morceaux[1], parametres }));
    }
    else if (morceaux[0] === "demandes") {
      onglet("demandes");
      await monter(n, () => new BoiteDemandes(page));
    }
    else if (morceaux[0] === "corbeille") {
      onglet("corbeille");
      await monter(n, () => new Corbeille(page));
    }
    else if (morceaux[0] === "versions" && morceaux[2]) {
      onglet(ongletDe(morceaux[1]));
      await monter(n, () => new Versions(page, { collection: morceaux[1], id: morceaux[2], parametres }));
    }
    else if (!morceaux.length || (morceaux[0] === "cartes" && morceaux.length === 1)) await pageCartes(n, parametres);
    else pageInconnue(chemin);
  } catch (err) {
    if (perimee(n)) return;
    page.innerHTML = `<section class="page-liste"><p class="vide">Impossible d'ouvrir cette page : ${e(phraseErreur(err))}. <a href="#/cartes">Retour aux cartes</a></p></section>`;
  }
}

export { monter, perimee, router };
