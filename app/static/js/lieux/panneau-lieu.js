// Le panneau d'un lieu, sur la carte (carte/editeur.js) : « PNJ ici » remonte sous « Connu des joueurs », avec « Ajouter
// un PNJ » qui cherche un PNJ existant (par son nom, son métier ou son lieu, sans accents) et le fait vivre ici ; puis
// « Dans les scénarios » (liens/dans-les-scenarios.js). Côté MJ seulement.

import { api, copie, echapper as e, toast } from "../api.js";
import { monterMentions, oublierMentions } from "../liens/dans-les-scenarios.js";
import { chercherFiches, fichesDe } from "../scenarios/fiches.js";

const TROUVES_MAX = 8;
const branches = new WeakSet();

export function htmlPnjIci(lieu, pnj) {
  const ici = (pnj || []).filter((p) => p.lieu === lieu.id);
  return `
      <h3>PNJ ici <span class="compte">${ici.length || ""}</span></h3>
      ${ici.length ? `<ul class="liste-lieux">${ici.map((p) => `<li><a class="lien-carte" href="#/pnj/${e(p.id)}">${e(p.nom)}${p.role ? ` <span class="secret">${e(p.role)}</span>` : ""}</a></li>`).join("")}</ul>` : ""}
      <div class="actions">
        <button type="button" data-pnj-ajouter title="Un PNJ du carnet, qui vivra ici">Ajouter un PNJ</button>
        <a class="bouton" href="#/pnj/nouveau?lieu=${e(lieu.id)}">Nouveau PNJ ici</a>
      </div>
      <div class="ajouter-pnj" hidden>
        <input type="search" data-pnj-cherche="${e(lieu.id)}" placeholder="Son nom, son métier ou son lieu" aria-label="Chercher le PNJ qui vit ici" autocomplete="off" spellcheck="false">
        <ul class="liste-lieux trouves-pnj" aria-label="PNJ trouvés"></ul>
      </div>`;
}

// Après chaque dessin du panneau d'un lieu : « Dans les scénarios », et les gestes d'« Ajouter un PNJ ». ctx : { lieu,
// pnj: () => liste, lieux: () => { id: lieu }, redessiner }.
export function monterPanneauLieu(panneau, ctx) {
  if (!panneau || !ctx.lieu?.id) return;
  panneau.ctxLieu = ctx;
  monterMentions(panneau, "lieux", ctx.lieu.id);
  if (branches.has(panneau)) return;
  branches.add(panneau);
  panneau.addEventListener("click", (ev) => {
    const c = panneau.ctxLieu;
    if (ev.target.closest("[data-pnj-ajouter]")) {
      const zone = panneau.querySelector(".ajouter-pnj");
      if (!zone) return;
      zone.hidden = !zone.hidden;
      if (!zone.hidden) zone.querySelector("input")?.focus();
      return;
    }
    const choisi = ev.target.closest("[data-pnj-choisi]");
    if (choisi && c) faireVivreIci(c, choisi.dataset.pnjChoisi);
  });
  panneau.addEventListener("input", (ev) => {
    if (ev.target.matches("[data-pnj-cherche]")) afficherTrouves(panneau);
  });
  panneau.addEventListener("keydown", (ev) => {
    if (!ev.target.matches("[data-pnj-cherche]") || ev.key !== "Enter" || ev.isComposing) return;
    ev.preventDefault();
    const premier = panneau.querySelector("[data-pnj-choisi]");
    if (premier && panneau.ctxLieu) faireVivreIci(panneau.ctxLieu, premier.dataset.pnjChoisi);
  });
}

function afficherTrouves(panneau) {
  const c = panneau.ctxLieu;
  const champ = panneau.querySelector("[data-pnj-cherche]");
  const liste = panneau.querySelector(".trouves-pnj");
  if (!c || !champ || !liste) return;
  const lieux = c.lieux() || {};
  const ailleurs = (c.pnj() || []).filter((p) => p.lieu !== c.lieu.id);
  const fiches = fichesDe({ pnj: ailleurs, lieux: Object.values(lieux) }).filter((f) => f.genre === "pnj");
  const q = champ.value.trim();
  const trouves = q ? chercherFiches(fiches, q, TROUVES_MAX) : [];
  liste.innerHTML = !q ? "" : trouves.length ? trouves.map((f) => `
      <li><button type="button" data-pnj-choisi="${e(f.id)}">${e(f.nom)}${f.detail ? `<span class="secret">${e(f.detail)}</span>` : ""}</button></li>`).join("")
    : '<li class="vide">Aucun PNJ ne répond. « Nouveau PNJ ici » en crée un.</li>';
}

async function faireVivreIci(c, id) {
  const p = (c.pnj() || []).find((x) => x.id === id);
  if (!p) return;
  const avant = p.lieu || "";
  const nomAvant = (c.lieux() || {})[avant]?.nom || "";
  try {
    // Seul son lieu change : sa fiche, ouverte ailleurs, n'est pas écrasée.
    Object.assign(p, await api.patch(`/api/pnj/${encodeURIComponent(id)}`, { lieu: c.lieu.id }));
  } catch (err) {
    return toast(`Impossible : ${err.message}`, "erreur");
  }
  c.redessiner();
  toast(`« ${p.nom} » vit maintenant ici${nomAvant ? `, et non plus à ${nomAvant}` : ""}.`, "info", {
    action: {
      libelle: "Annuler",
      faire: async () => {
        try {
          Object.assign(p, await api.patch(`/api/pnj/${encodeURIComponent(id)}`, { lieu: avant }));
          c.redessiner();
        } catch (err) {
          toast(`Impossible : ${err.message}`, "erreur");
        }
      },
    },
  });
}

// Le nom d'un lieu quitté, sur la carte : son identifiant suit le nom tant que rien d'autre que cette carte ne le cite
// (liens_fiches.py) ; « village-sans-nom » devient « le-gue-aux-cendres ». Le serveur réécrit la carte dans le même geste ;
// l'éditeur en reprend la version et réécrit chez lui ce que la carte dit du lieu (son marqueur, son habillage, ses pas
// d'annulation). Après les fiches qui partent, dans leur file.
export function suivreNomSurLaCarte(editeur, lieu) {
  if (!lieu?.id) return;
  editeur.chaineLieux = editeur.chaineLieux.then(async () => {
    // Le nom part d'abord (le serveur en tire l'identifiant), directement : passer par la file attendrait ce geste-ci.
    if (editeur.lieuxModifies.size || editeur.sauverLieux.enAttente()) {
      editeur.sauverLieux.annuler();
      await editeur.envoyerLieux();
    }
    // La carte part aussi : le serveur réécrit lui-même son marqueur sur la version annoncée, ou laisse l'identifiant
    // si un autre écran l'a enregistrée entre-temps.
    if (editeur.sauverCarte.enAttente()) {
      editeur.sauverCarte.annuler();
      await editeur.enregistrer();
    } else await editeur.chaineCarte;
    const ancien = lieu.id;
    let r;
    try {
      r = await api.post(`/api/lieux/${encodeURIComponent(ancien)}/identifiant`, { carte: editeur.carte.id, version_carte: editeur.carte.modifie });
    } catch {
      return;
    }
    if (!r?.change) return;
    // La carte de cet écran prend la version réécrite par le serveur.
    if (r.carte?.modifie && r.carte.id === editeur.carte.id) editeur.carte.modifie = r.carte.modifie;
    if (editeur.detruit || editeur.lieux[ancien] !== lieu) return adopterSurLaCarte(editeur, null, ancien, r.id);
    lieu.modifie = r.fiche.modifie;
    adopterSurLaCarte(editeur, lieu, ancien, r.id, r.fiche, { ici: true });
  });
}

// Le lieu porte désormais un autre identifiant : renommé ici (suivreNomSurLaCarte), ou sur un autre écran pendant que la
// carte était ouverte ici (le serveur suit le renommage, liens_fiches.py, et rend la fiche enregistrée sous son nouvel
// identifiant). Ce que la carte dit du lieu suit tout de suite : un envoi plus tard, même après un changement de page, ne
// remet jamais l'ancien identifiant. lieu : la fiche de cet écran (null : seule la carte suit) ; ici : renommé sur cet
// écran, la carte repart avec la version que le serveur vient d'écrire (venu d'un autre écran, elle attend le prochain
// geste : sa version n'est pas celle du disque).
export function adopterSurLaCarte(editeur, lieu, ancien, neuf, fiche = null, { ici = false } = {}) {
  if (!neuf || ancien === neuf) return;
  const remplacer = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(remplacer);
    if (o.lieu === ancien) o.lieu = neuf;
    Object.values(o).forEach(remplacer);
  };
  remplacer(editeur.carte.marqueurs);
  remplacer(editeur.carte.habillage);
  remplacer(editeur.apercu?.avant);
  for (const etat of [...editeur.passe, ...editeur.futur]) etat.vect = etat.vect.split(`"lieu":${JSON.stringify(ancien)}`).join(`"lieu":${JSON.stringify(neuf)}`);
  if (!lieu || editeur.detruit || editeur.lieux[ancien] !== lieu) return;
  lieu.id = neuf;
  editeur.lieux[neuf] = lieu;
  delete editeur.lieux[ancien];
  editeur.basesLieux[neuf] = copie(fiche || lieu);
  delete editeur.basesLieux[ancien];
  if (editeur.lieuxModifies.delete(ancien)) editeur.lieuxModifies.add(neuf);
  if (ici) editeur.modifie();
  oublierMentions("lieux", ancien);
  if (location.hash.includes(`lieu=${ancien}`)) history.replaceState(null, "", location.hash.replace(`lieu=${ancien}`, `lieu=${neuf}`));
  // La carte redessine son nom (repris de l'autre écran par la fusion), le panneau se redessine sous le nouvel
  // identifiant ; le champ où l'on écrit garde la main.
  editeur.vue?.demander?.();
  const actif = document.activeElement;
  const garde = editeur.panneau.contains(actif) ? { cible: actif.dataset.cible, champ: actif.dataset.champ, a: actif.selectionStart, b: actif.selectionEnd } : null;
  editeur.afficherPanneau();
  if (garde?.champ) {
    const champ = editeur.panneau.querySelector(`[data-cible="${garde.cible}"][data-champ="${garde.champ}"]`);
    champ?.focus({ preventScroll: true });
    try {
      champ?.setSelectionRange(garde.a, garde.b);
    } catch {
      // une liste ou une case n'a pas de sélection
    }
  }
}
