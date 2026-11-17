// Les comptes du coin des joueurs : la page de connexion, et celle du compte, qui sert à trois choses selon ce que dit
// le serveur (/api/compte) : choisir son mot de passe après le provisoire du MJ (rien d'autre ne s'ouvre avant), créer
// son compte depuis un appareil qui gardait un cookie d'avant les comptes, ou changer son mot de passe une fois connecté.
// Tout part en JSON ; rien ne s'écrit dans l'adresse.

import { echapper as e } from "../api.js";
import "./pied-coin.js";
import { suiteSure } from "./suite.js";

const page = document.getElementById("page");
const parametres = new URLSearchParams(location.search);
// Des phrases fixes, choisies par une clé de l'adresse : l'adresse ne fait jamais écrire son propre texte.
const ANNONCES = {
  ancien: "Les liens personnels ne servent plus. Demandez à votre MJ votre identifiant et un mot de passe provisoire.",
  deconnecte: "Vous êtes déconnecté.",
  session: "Connectez-vous pour ouvrir cette page : vous y arriverez ensuite directement.",
  provisoire: "Ce mot de passe provisoire ne vaut plus : votre MJ en a peut-être donné un autre. Reconnectez-vous avec le dernier reçu.",
};
const REGLE_IDENTIFIANT = "De 3 à 32 caractères : lettres, chiffres, point, tiret ou trait bas, sans espace.";
const REGLE_MDP = "8 caractères au moins. Une courte phrase se retient mieux qu'un mot compliqué.";

async function envoyer(url, corps) {
  let r;
  try {
    r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
  } catch {
    throw Object.assign(new Error("Serveur injoignable : vérifiez la connexion."), { status: 0 });
  }
  let donnees = {};
  try {
    donnees = await r.json();
  } catch {
    // réponse sans JSON
  }
  if (!r.ok) throw Object.assign(new Error(donnees.detail || `Erreur ${r.status}`), { status: r.status });
  return donnees;
}

// La page d'où l'on venait avant de devoir se reconnecter (api.js y renvoie sur un 401) : une adresse du coin seulement.
function suiteVoulue() {
  return suiteSure(parametres.get("suite") || "", location.origin);
}

// Un formulaire du compte : un seul envoi à la fois, le refus dit sous le bouton, les mots de passe effacés après un refus.
// sur401 : ce que fait la page quand le serveur ne la reconnaît plus (au lieu de dire le refus).
function brancher(form, url, corpsDe, apres, sur401 = null) {
  const refus = form.querySelector(".refus-compte");
  const bouton = form.querySelector('button[type="submit"]');
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (bouton.disabled) return;
    refus.hidden = true;
    bouton.disabled = true;
    try {
      await apres(await envoyer(url, corpsDe(form)));
    } catch (err) {
      if (err.status === 401 && sur401) return sur401(err);
      refus.textContent = err.message;
      refus.hidden = false;
      for (const champ of form.querySelectorAll('input[type="password"]')) champ.value = "";
      form.querySelector('input[type="password"]:not([readonly])')?.focus();
    } finally {
      bouton.disabled = false;
    }
  });
}

function connexion() {
  const annonce = document.querySelector(".annonce-compte");
  const quoi = parametres.get("lien") === "ancien" ? "ancien" : parametres.get("raison");
  if (ANNONCES[quoi]) {
    annonce.textContent = ANNONCES[quoi];
    annonce.hidden = false;
  }
  const form = document.querySelector("form[data-connexion]");
  // Entré par le provisoire : le choix de son mot de passe passe avant la page d'où il venait.
  brancher(form, "/api/connexion", (f) => ({ identifiant: f.identifiant.value, mot_de_passe: f.mot_de_passe.value }),
    (r) => location.replace(r.choisir ? r.suite : suiteVoulue() || r.suite || "/"));
  form.identifiant.focus({ preventScroll: true });
}

const champMdp = (nom, libelle, complete, aide = "") => `
  <label class="champ">${libelle}<input type="password" name="${nom}" autocomplete="${complete}" maxlength="128" required></label>
  ${aide ? `<p class="aide aide-champ">${aide}</p>` : ""}`;
// L'identifiant reste dans le formulaire, en lecture seule : le trousseau du téléphone range le mot de passe avec lui.
const champIdentifiant = (identifiant) => `
  <label class="champ">Identifiant<input type="text" name="identifiant" value="${e(identifiant)}" autocomplete="username" readonly></label>`;

function pageCreer(c) {
  page.innerHTML = `<section class="page-liste compte-coin">
    <header class="titre-page"><p class="kicker">Le coin des joueurs</p><h1>Créer votre compte</h1>
      <p class="chapo">Bonjour ${e(c.joueur)} ! Choisissez un identifiant et un mot de passe : ils vous ouvriront le coin des joueurs depuis n'importe quel appareil, téléphone, tablette ou ordinateur.</p></header>
    <form class="formulaire-compte" method="post" action="/api/compte">
      <label class="champ">Identifiant<input type="text" name="identifiant" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="32" required></label>
      <p class="aide aide-champ">${REGLE_IDENTIFIANT}</p>
      ${champMdp("mot_de_passe", "Mot de passe", "new-password", REGLE_MDP)}
      ${champMdp("confirmation", "Encore une fois", "new-password")}
      <p class="refus-compte" role="alert" hidden></p>
      <button class="principal" type="submit">Créer mon compte</button>
    </form>
    <p class="aide">Gardez votre identifiant et votre mot de passe. Oubliés, votre MJ vous donne un mot de passe provisoire.</p>
  </section>`;
  const form = page.querySelector("form");
  brancher(form, "/api/compte", (f) => ({ identifiant: f.identifiant.value, mot_de_passe: f.mot_de_passe.value, confirmation: f.confirmation.value }),
    (r) => location.replace(r.suite || "/"));
  form.identifiant.focus({ preventScroll: true });
}

// Après le mot de passe provisoire du MJ : rien d'autre ne s'ouvre avant ce choix (le serveur n'a pas encore ouvert de
// session). Le provisoire ne sert qu'une fois.
function pageChoisir(c) {
  page.innerHTML = `<section class="page-liste compte-coin">
    <header class="titre-page"><p class="kicker">Le coin des joueurs</p><h1>Choisir mon mot de passe</h1>
      <p class="chapo">Bonjour ${e(c.joueur)} ! Le mot de passe provisoire de votre MJ ne sert qu'une fois : choisissez maintenant le vôtre. Avec votre identifiant, il vous ouvrira le coin des joueurs depuis n'importe quel appareil.</p></header>
    <form class="formulaire-compte" method="post" action="/api/compte">
      ${champIdentifiant(c.identifiant)}
      ${champMdp("mot_de_passe", "Mon mot de passe", "new-password", REGLE_MDP)}
      ${champMdp("confirmation", "Encore une fois", "new-password")}
      <p class="refus-compte" role="alert" hidden></p>
      <button class="principal" type="submit">Enregistrer mon mot de passe</button>
    </form>
  </section>`;
  const form = page.querySelector("form");
  // Le MJ a refait le provisoire entre-temps : retour à la connexion, qui le dit.
  brancher(form, "/api/compte", (f) => ({ mot_de_passe: f.mot_de_passe.value, confirmation: f.confirmation.value }),
    (r) => location.replace(r.suite || "/"), () => location.replace("/connexion?raison=provisoire"));
  form.mot_de_passe.focus({ preventScroll: true });
}

function pageConnecte(c) {
  page.innerHTML = `<section class="page-liste compte-coin">
    <header class="titre-page"><p class="kicker">Le coin des joueurs</p><h1>Mon compte</h1>
      <p class="chapo">Vous êtes connecté avec l'identifiant <b>${e(c.identifiant)}</b>.</p></header>
    <p class="annonce-compte" role="status" hidden></p>
    <form class="formulaire-compte" method="post" action="/api/compte/mot-de-passe">
      <h2>Changer mon mot de passe</h2>
      ${champIdentifiant(c.identifiant)}
      ${champMdp("actuel", "Mot de passe actuel", "current-password")}
      ${champMdp("nouveau", "Nouveau mot de passe", "new-password", REGLE_MDP)}
      ${champMdp("confirmation", "Encore une fois", "new-password")}
      <p class="refus-compte" role="alert" hidden></p>
      <button class="principal" type="submit">Changer mon mot de passe</button>
      <p class="aide">Vos autres appareils seront déconnectés ; celui-ci reste connecté.</p>
    </form>
    <div class="actions compte-actions">
      <a class="bouton" href="/">Retour au coin</a>
      <button type="button" data-deconnexion>Se déconnecter</button>
    </div>
  </section>`;
  const form = page.querySelector("form");
  brancher(form, "/api/compte/mot-de-passe", (f) => ({ actuel: f.actuel.value, nouveau: f.nouveau.value, confirmation: f.confirmation.value }), () => {
    form.reset();
    const annonce = page.querySelector(".annonce-compte");
    annonce.textContent = "Mot de passe changé : vos autres appareils sont déconnectés.";
    annonce.hidden = false;
  });
}

async function compte() {
  let r;
  try {
    r = await fetch("/api/compte");
  } catch {
    page.innerHTML = `<section class="page-liste compte-coin"><header class="titre-page"><p class="kicker">Le coin des joueurs</p>
      <h1>Le compte ne s'ouvre pas</h1><p class="chapo">Serveur injoignable : vérifiez la connexion, puis rechargez la page.</p></header></section>`;
    return;
  }
  if (r.status === 401) return location.replace("/connexion");
  const c = await r.json();
  if (c.etat === "creer") return pageCreer(c);
  if (c.etat === "choisir") return pageChoisir(c);
  return pageConnecte(c);
}

if (document.body.dataset.compte === "connexion") connexion();
else compte();
