// « Chercher », dans l'en-tête de l'atelier (touche « / », ou ⌘K / Ctrl+K même depuis un champ) : une fiche, une idée,
// un passage d'un scénario ou de la bible, retrouvés en trois lettres, sans accents ni majuscules, et ouverts d'Entrée.
// Les fiches de jeu d'abord, avec le champ qui répond sous le nom ; puis les idées, les scénarios et la bible. Le moteur
// est celui de « Lier une fiche » (moteur.js) ; l'index vient de /api/recherche, la bible de /api/bible/recherche. Pour
// le MJ seulement : rien de ce qui est cherché ne part vers la TV ni le coin des joueurs.
//
// Le bouton tient le bout de la seconde ligne de l'en-tête, sous les outils, sans rien déplacer : il prend la place
// laissée par les onglets (le jour d'une séance, ceux de Jouer s'y ajoutent), et se resserre, ou s'efface, plutôt que
// de les couvrir. La touche « / » et ⌘K marchent toujours.

import { api, echapper as e } from "../api.js";
import { champDeSaisie, dialogueOuvert } from "../commun/echap.js";
import { assezLong, extrait, mots, placesDesMots, surligner } from "./moteur.js";
import { fichesDeLIndex, fichesTrouvees, ideesTrouvees, recentes, routeDe, scenariosTrouves } from "./index-atelier.js";

const MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || "");
const CMD = MAC ? "⌘" : "Ctrl+";
// L'index est relu à l'ouverture s'il a plus de trente secondes : une fiche créée ailleurs se retrouve aussitôt.
const FRAIS = 30000;
const LOUPE = '<svg class="loupe" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.6"/><path d="M12.8 12.8l4.6 4.6"/></svg>';
const ETATS_IDEE = { "a-creuser": "à creuser", retenue: "retenue", ecartee: "écartée" };

let bouton = null;
let dlg = null;
let champ = null;
let liste = null;
let index = null; // { lu, fiches, idees, scenarios }
let lecture = null;
let erreur = "";
let resultats = [];
let choix = 0;
let retour = null;
const bibles = new Map(); // recherche → résultats de la bible (ou null pendant la requête)
let minuterieBible = 0;

function charger() {
  if (lecture) return lecture;
  lecture = api.get("/api/recherche").then((ix) => {
    index = { lu: Date.now(), fiches: fichesDeLIndex(ix), idees: ix.idees || [], scenarios: ix.scenarios || [] };
    erreur = "";
  }).catch((err) => {
    erreur = err.message || "réseau coupé";
  }).finally(() => {
    lecture = null;
    if (dlg?.open) afficher(false);
  });
  return lecture;
}

const motsDe = (q) => mots(q).filter((m) => m.length >= 2);

// La bible, par le serveur, une fois la frappe posée ; chaque recherche n'est demandée qu'une fois.
function demanderBible(q) {
  clearTimeout(minuterieBible);
  if (!motsDe(q).length || !assezLong(q) || bibles.has(q)) return;
  minuterieBible = setTimeout(async () => {
    bibles.set(q, null);
    let r = { resultats: [] };
    try {
      r = await api.get(`/api/bible/recherche?q=${encodeURIComponent(q)}&limite=4`);
    } catch {
      bibles.delete(q);
      return;
    }
    bibles.set(q, r.resultats || []);
    if (dlg?.open && champ.value.trim() === q) afficher(false);
  }, 280);
}

// « PNJ · Meunier ruiné · Le moulin des Vernet », les mots cherchés surlignés dans le détail (Odile répond à « berthe »
// par son métier, « Serveuse de l'auberge de Berthe »).
const genreDe = (f, q = "") => [e(f.nomGenre), f.detail ? (q ? surligner(f.detail, q) : e(f.detail)) : ""].filter(Boolean).join(" · ");

// Ce qui répond, dans l'ordre : les fiches de jeu, puis les idées, les scénarios et la bible.
function calculer(q) {
  if (!q) {
    const r = recentes(index.fiches).map((f) => ({ famille: "fiche", href: f.route, nom: e(f.nom), genre: genreDe(f), inconnu: f.inconnu }));
    return r.length ? [{ groupe: "Modifiées récemment" }, ...r] : [];
  }
  const sortie = fichesTrouvees(index.fiches, q, 24).map((f) => ({
    famille: "fiche", href: routeDe(f), nom: surligner(f.nom, q), genre: genreDe(f, q), inconnu: f.inconnu,
    trouve: f.trouve ? { libelle: f.trouve.libelle, html: f.trouve.html } : null,
  }));
  const idees = ideesTrouvees(index.idees, q);
  if (idees.length) {
    sortie.push({ groupe: "Dans les idées" });
    for (const i of idees) sortie.push({ famille: "idee", href: `#/idees?q=${encodeURIComponent(q)}`, nom: i.html, genre: e(`Idée · ${ETATS_IDEE[i.etat] || "à creuser"}`) });
  }
  const passages = scenariosTrouves(index.scenarios, q);
  if (passages.length) {
    sortie.push({ groupe: "Dans les scénarios" });
    for (const p of passages) sortie.push({ famille: "scenario", href: p.href, nom: surligner(p.nom, q), genre: e(p.ou), trouve: p.html ? { libelle: "", html: p.html } : null });
  }
  const bible = bibles.get(q);
  if (bible?.length) {
    sortie.push({ groupe: "Dans la bible" });
    const motsQ = mots(q);
    for (const x of bible) {
      const ligne = x.lignes?.[0] || "";
      sortie.push({ famille: "bible", href: `#/bible?doc=${encodeURIComponent(x.chemin)}&q=${encodeURIComponent(q)}&passage=0`, nom: e(x.titre),
        genre: e(`Bible · ${x.rubrique}`), trouve: ligne ? { libelle: "", html: extrait(ligne, placesDesMots(ligne, motsQ).zones, { largeur: 150 }) } : null });
    }
  }
  return sortie;
}

function afficher(remettre = true) {
  const q = champ.value.trim();
  if (q) demanderBible(q);
  let html = "";
  if (!index) {
    resultats = [];
    html = erreur && !lecture ? `<li class="ch-vide">La recherche ne répond pas : ${e(erreur)}. Réessayez dans un instant.</li>` : '<li class="ch-vide">Lecture des fiches…</li>';
  } else {
    const lignes = calculer(q);
    resultats = lignes.filter((l) => !l.groupe);
    let i = 0;
    html = lignes.map((l) => (l.groupe ? `<li class="ch-groupe" role="presentation" aria-hidden="true">${e(l.groupe)}</li>` : htmlResultat(l, i++))).join("");
    const court = Boolean(q) && !assezLong(q);
    if (!resultats.length) {
      html += q ? `<li class="ch-vide">${court ? "Aucun nom" : "Aucune fiche, idée ni passage"} ne répond à « ${e(q)} »${!court && (bibles.get(q) === null || (!bibles.has(q) && motsDe(q).length)) ? " ; la bible cherche encore" : ""}.</li>`
        : '<li class="ch-vide">Tapez trois lettres : un nom, un tic, un détail, un mot de vos scénarios.</li>';
    }
    // Sous trois lettres, seuls les noms et les détails répondent : on le dit.
    if (court) html += '<li class="ch-vide">Dès trois lettres, les autres champs, les idées, les scénarios et la bible répondent aussi.</li>';
  }
  if (remettre) choix = 0;
  choix = Math.min(choix, Math.max(0, resultats.length - 1));
  liste.innerHTML = html;
  marquerChoix();
}

function htmlResultat(r, i) {
  return `<li role="option" id="ch-r${i}" data-i="${i}" class="ch-${r.famille}" aria-selected="false">
    <a href="${e(r.href)}" tabindex="-1">
      <span class="ch-tete"><span class="ch-nom">${r.nom}</span>${r.inconnu ? '<span class="inconnu" title="Inconnu des joueurs"></span>' : ""}<span class="ch-genre">${r.genre}</span></span>
      ${r.trouve ? `<span class="ch-trouve">${r.trouve.libelle ? `<b>${e(r.trouve.libelle)}</b> ` : ""}${r.trouve.html}</span>` : ""}
    </a></li>`;
}

function marquerChoix(defiler = true) {
  let actif = null;
  for (const li of liste.querySelectorAll("[data-i]")) {
    const oui = +li.dataset.i === choix;
    li.setAttribute("aria-selected", String(oui));
    if (oui) actif = li;
  }
  if (actif) {
    champ.setAttribute("aria-activedescendant", actif.id);
    if (defiler) actif.scrollIntoView({ block: "nearest" });
  } else champ.removeAttribute("aria-activedescendant");
}

function aller(r) {
  if (!r) return;
  fermer(false);
  if (location.hash !== r.href) location.hash = r.href;
}

function fermer(rendre = true) {
  if (!dlg?.open) return;
  dlg.close();
  if (rendre && retour?.isConnected && document.activeElement === document.body) retour.focus({ preventScroll: true });
}

export function ouvrirRecherche() {
  if (!dlg) return;
  if (dlg.open) {
    champ.focus();
    champ.select();
    return;
  }
  if (dialogueOuvert()) return;
  retour = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dlg.showModal();
  champ.focus();
  champ.select();
  afficher();
  if (!index || Date.now() - index.lu > FRAIS) charger();
}

function creerDialogue() {
  dlg = document.createElement("dialog");
  dlg.className = "dialogue chercher-partout";
  dlg.setAttribute("aria-label", "Chercher dans l'atelier");
  dlg.innerHTML = `
    <label class="ch-champ">${LOUPE}<input type="search" name="q" autocomplete="off" spellcheck="false" enterkeyhint="go"
      placeholder="Un nom, un tic, un détail, un mot de vos scénarios" aria-label="Chercher" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="ch-resultats"></label>
    <ul class="ch-resultats" id="ch-resultats" role="listbox" aria-label="Ce qui répond"></ul>
    <p class="ch-aide"><kbd>↑</kbd><kbd>↓</kbd> choisir · <kbd>Entrée</kbd> ouvrir · <kbd>Échap</kbd> fermer. Les fiches de jeu d'abord, puis les idées, les scénarios et la bible.</p>`;
  document.body.append(dlg);
  champ = dlg.querySelector("input");
  liste = dlg.querySelector(".ch-resultats");
  champ.addEventListener("input", () => afficher());
  champ.addEventListener("keydown", (ev) => {
    const n = resultats.length;
    if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && n) {
      ev.preventDefault();
      choix = (choix + (ev.key === "ArrowDown" ? 1 : n - 1)) % n;
      marquerChoix();
    } else if (ev.key === "Enter" && !ev.isComposing) {
      ev.preventDefault();
      aller(resultats[choix]);
    }
  });
  // La souris choisit sans faire défiler ; un clic ouvre. ⌘ ou Ctrl + clic : un nouvel onglet, comme un lien.
  liste.addEventListener("mousemove", (ev) => {
    const li = ev.target.closest("[data-i]");
    if (li && +li.dataset.i !== choix) {
      choix = +li.dataset.i;
      marquerChoix(false);
    }
  });
  liste.addEventListener("click", (ev) => {
    const li = ev.target.closest("[data-i]");
    if (!li || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
    ev.preventDefault();
    aller(resultats[+li.dataset.i]);
  });
  // Un clic sur le voile, hors de la fenêtre, la ferme (pas un clic dans sa marge).
  dlg.addEventListener("click", (ev) => {
    if (ev.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) fermer();
  });
}

// La taille du bouton : la plus grande qui laisse aux onglets de la seconde ligne toute leur place.
function ajuster() {
  if (!bouton) return;
  if (!matchMedia("(min-width: 761px)").matches) {
    bouton.dataset.taille = "court";
    return;
  }
  const nav = bouton.parentElement?.querySelector(".onglets");
  if (!nav) return;
  const montres = [...nav.children].filter((el) => !el.hidden && el.getClientRects().length);
  const fin = montres.length ? Math.max(...montres.map((el) => el.getBoundingClientRect().right)) : nav.getBoundingClientRect().left;
  const deborde = nav.scrollWidth > nav.clientWidth + 1;
  for (const taille of ["large", "moyen", "court"]) {
    bouton.dataset.taille = taille;
    if (!deborde && bouton.getBoundingClientRect().left >= fin + 18) return;
  }
  bouton.dataset.taille = "cache";
}

let attente = 0;
const reajuster = () => {
  cancelAnimationFrame(attente);
  attente = requestAnimationFrame(ajuster);
};

function touche(ev) {
  if (ev.isComposing || ev.defaultPrevented) return;
  // ⌘K / Ctrl+K : de partout, même depuis un champ (ce n'est pas une lettre tapée), sauf sous un autre dialogue.
  if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && (ev.key || "").toLowerCase() === "k") {
    const ouvert = dialogueOuvert();
    if (ouvert && ouvert !== dlg) return;
    ev.preventDefault();
    ev.stopPropagation();
    ouvrirRecherche();
  }
}

// « / » hors d'un champ de saisie et hors d'un dialogue, comme les autres touches de l'atelier.
function toucheBarre(ev) {
  if (ev.key !== "/" || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing || ev.repeat || ev.defaultPrevented) return;
  const cible = ev.target instanceof Element ? ev.target : null;
  if (champDeSaisie(cible) || cible?.closest("input, textarea, select, dialog, [contenteditable]") || dialogueOuvert()) return;
  ev.preventDefault();
  ev.stopPropagation();
  ouvrirRecherche();
}

export function installerRecherche(entete) {
  if (!entete || bouton) return;
  bouton = document.createElement("button");
  bouton.type = "button";
  bouton.className = "chercher-entete";
  bouton.dataset.taille = "large";
  bouton.setAttribute("aria-label", "Chercher");
  bouton.setAttribute("aria-haspopup", "dialog");
  bouton.setAttribute("aria-keyshortcuts", "/ Meta+K Control+K");
  bouton.title = `Chercher une fiche, une idée, un passage d'un scénario ou de la bible (touche / ou ${CMD}K)`;
  bouton.innerHTML = `${LOUPE}<span class="ch-mot">Chercher</span><span class="ch-suite">une fiche, un mot…</span><kbd class="touche" aria-hidden="true">/</kbd>`;
  bouton.addEventListener("click", () => ouvrirRecherche());
  // Survolé, il lit déjà l'index : la fenêtre s'ouvre pleine.
  bouton.addEventListener("pointerenter", () => {
    if (!index || Date.now() - index.lu > FRAIS) charger();
  });
  entete.append(bouton);
  creerDialogue();
  document.addEventListener("keydown", touche, true);
  document.addEventListener("keydown", toucheBarre);
  // La place change avec la fenêtre, les polices et les onglets montrés (famille ouverte, jour de séance).
  new ResizeObserver(reajuster).observe(entete);
  const nav = entete.querySelector(".onglets");
  if (nav) new MutationObserver(reajuster).observe(nav, { attributes: true, attributeFilter: ["hidden", "class"], subtree: true, childList: true });
  document.fonts?.ready.then(reajuster);
  ajuster();
}
