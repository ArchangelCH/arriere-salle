// Le panneau d'un pion, dans l'éditeur de plan : ses états posés d'un clic, sa forme, son cadre, son image, son
// étiquette, son nom pour les joueurs, son groupe et sa monture. L'éditeur (editeur.js) appelle ces fonctions depuis son
// panneau et sa saisie ; ce qui part vers la TV, le serveur le décide (app/table/pions_plan.py).

import { echapper as e, toast } from "../api.js";
import { bibliotheque, htmlBibliotheque, importerImage } from "./editeur-images.js";
import { COULEURS_PIONS } from "./modele.js";
import {
  EPAISSEURS_PION, ETATS_PION, ETIQUETTE_MAX, FORMES_PION, GROUPE_MAX, epaisseurDuPion, formeDuPion, memeSorte,
  vignetteEtat,
} from "./pions.js";

const NOMS_JOUEURS = [["", "Selon le camp"], ["oui", "Visible"], ["non", "Caché"]];

// « À terre » (le champ « tombe » d'avant), puis les états de la liste, chacun avec sa pastille.
export function htmlEtatsPion(t) {
  const etats = Array.isArray(t.etats) ? t.etats : [];
  const bouton = (cle, nom, actif, image, titre = "") => `<button type="button" data-pion-action="etat" data-valeur="${e(cle)}" aria-pressed="${actif}"${titre ? ` title="${e(titre)}"` : ""}>${image}<span>${e(nom)}</span></button>`;
  const terre = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#3a3a3a" stroke="#f4ead4" stroke-width="1.6"/><path d="M8 8l8 8M16 8l-8 8" stroke="#e0584c" stroke-width="2.2" stroke-linecap="round"/></svg>';
  return `
    <div class="etats-pion" role="group" aria-label="États du pion">
      ${bouton("a-terre", "À terre", !!t.tombe, terre, "À terre (au tapis) : le pion grisé et barré")}
      ${ETATS_PION.map((x) => bouton(x.cle, x.nom, etats.includes(x.cle), `<img src="${vignetteEtat(x.cle)}" alt="">`,
        x.mj ? "Pour le MJ seul : le pion disparaît de la TV, comme un pion caché" : "")).join("")}
    </div>`;
}

// Forme, cadre et image ; puis étiquette, nom pour les joueurs, groupe et monture.
export function htmlApparencePion(ed, t) {
  const forme = formeDuPion(t);
  const k = epaisseurDuPion(t);
  const p = ed.plan;
  // Sans couleur choisie, l'anneau a celle de son camp.
  const couleur = /^#[0-9a-f]{6}$/i.test(t.couleur || "") ? t.couleur : COULEURS_PIONS[t.genre] || COULEURS_PIONS.autre;
  const montures = p.pions.filter((x) => x.id !== t.id && typeof x.monture !== "string");
  const secret = t.genre === "pnj" || (t.ref || "").startsWith("pnj:");
  const sortes = p.pions.filter((x) => memeSorte(t, x)).length;
  const image = typeof t.image_libre === "string" && t.image_libre ? t.image_libre : "";
  const liste = bibliotheque(ed);
  return `
    <details class="reglages-pion" ${ed.ouvertsPion?.apparence ? "open" : ""} data-pion-volet="apparence">
      <summary>Forme, cadre et image</summary>
      <div class="segments large" role="group" aria-label="Forme">${FORMES_PION.map(([v, n]) => `<button type="button" data-pion-action="forme" data-valeur="${v}" aria-pressed="${forme === v}">${e(n)}</button>`).join("")}</div>
      <div class="deux">
        <label class="champ">Anneau<input type="color" data-pion-reglage="couleur" value="${e(couleur)}"></label>
        <label class="champ">Épaisseur<select data-pion-reglage="epaisseur">${EPAISSEURS_PION.map(([v, n]) => `<option value="${v}" ${v === k ? "selected" : ""}>${e(n)}</option>`).join("")}</select></label>
      </div>
      ${t.genre === "heros" ? '<p class="aide">Sur la TV, un aventurier garde la couleur de son joueur.</p>' : ""}
      <div class="image-pion">
        ${image ? `<img src="${e(image)}" alt="" class="apercu-image-pion forme-${forme}">` : '<p class="aide">Pas d\'image choisie : le pion montre le portrait de sa fiche, ou ses initiales.</p>'}
        <div class="actions">
          <label class="bouton">Importer<input type="file" accept="image/png,image/jpeg,image/webp" data-pion-reglage="importer" hidden></label>
          ${image ? '<button type="button" data-pion-action="image-retirer">Retirer l\'image</button>' : ""}
        </div>
        ${secret ? '<p class="aide">PNJ inconnu des joueurs : ni son nom, ni son image, ni son étiquette ne partent vers la TV.</p>' : ""}
        ${liste === null ? '<p class="aide">Lecture de la bibliothèque…</p>' : liste.length ? `<p class="lbl">Ou dans la bibliothèque</p>${htmlBibliotheque(liste, image, "pion-action", "image-prendre")}` : ""}
      </div>
    </details>
    <details class="reglages-pion" ${ed.ouvertsPion?.etiquette ? "open" : ""} data-pion-volet="etiquette">
      <summary>Étiquette, groupe et monture</summary>
      <label class="champ">Étiquette (vue des joueurs)<input type="text" maxlength="${ETIQUETTE_MAX}" data-pion-reglage="etiquette" value="${e(t.etiquette || "")}" placeholder="chef, archer, blessé…"></label>
      <label class="champ">Nom pour les joueurs<select data-pion-reglage="nom_visible">${NOMS_JOUEURS.map(([v, n]) => `<option value="${v}" ${(t.nom_visible === true ? "oui" : t.nom_visible === false ? "non" : "") === v ? "selected" : ""}>${e(n)}</option>`).join("")}</select></label>
      <p class="aide">${t.genre === "ennemi" ? "Selon le camp : un adversaire ne montre que son numéro." : "Selon le camp : son nom s'écrit sous le pion."}${secret ? " Un PNJ inconnu reste sans nom." : ""}</p>
      <div class="deux">
        <label class="champ">Groupe (nombre)<input type="number" min="1" max="${GROUPE_MAX}" data-pion-reglage="groupe" value="${e(t.groupe || 1)}"></label>
        <label class="champ">En selle sur<select data-pion-reglage="monture"><option value="">personne</option>${montures.map((x) => `<option value="${e(x.id)}" ${t.monture === x.id ? "selected" : ""}>${e(x.nom || "Pion")}${x.court ? ` ${e(x.court)}` : ""}</option>`).join("")}</select></label>
      </div>
      ${sortes > 1 ? `<div class="actions"><button type="button" data-pion-action="numeroter" title="Numérote de 1 à ${sortes}, de haut en bas puis de gauche à droite">Numéroter les ${sortes} « ${e(t.nom || "Pion")} »</button></div>` : ""}
    </details>`;
}

// Garde ouverts les volets que le MJ a ouverts, d'un panneau à l'autre.
export function suivreVolets(ed, panneau) {
  panneau.querySelectorAll("[data-pion-volet]").forEach((d) => {
    d.addEventListener("toggle", () => {
      ed.ouvertsPion = { ...(ed.ouvertsPion || {}), [d.dataset.pionVolet]: d.open };
    });
  });
}

function pionChoisi(ed) {
  return ed.selection?.genre === "pion" ? ed.element() : null;
}

// vite : la TV le reçoit tout de suite (un état, une forme) ; sinon après la frappe (une étiquette, une couleur qu'on glisse).
function fini(ed, panneau = false, vite = true) {
  ed.vue.chargerImagesPions();
  ed.vue.demander();
  if (panneau) ed.afficherPanneau();
  ed.modifie(vite);
}

// La saisie d'un réglage (data-pion-reglage) : une étape d'annulation par réglage, prise à sa première touche.
export async function reglerPion(ed, el) {
  const t = pionChoisi(ed);
  if (!t) return;
  const k = el.dataset.pionReglage;
  if (k === "importer") {
    const fichier = el.files?.[0];
    el.value = "";
    if (!fichier) return;
    const image = await importerImage(ed, fichier, "Pions");
    if (!image || ed.detruit) return;
    ed.instantane();
    t.image_libre = image.url;
    return fini(ed, true);
  }
  if (ed.derniereSaisie !== `${t.id}:h2:${k}`) ed.instantane();
  ed.derniereSaisie = `${t.id}:h2:${k}`;
  if (k === "couleur") t.couleur = el.value;
  else if (k === "epaisseur") {
    if (+el.value === 1) delete t.epaisseur;
    else t.epaisseur = +el.value;
  } else if (k === "etiquette") {
    const v = el.value.replace(/\s+/g, " ").slice(0, ETIQUETTE_MAX);
    if (v.trim()) t.etiquette = v;
    else delete t.etiquette;
  } else if (k === "nom_visible") {
    if (el.value === "") delete t.nom_visible;
    else t.nom_visible = el.value === "oui";
  } else if (k === "groupe") {
    const n = Math.round(+el.value);
    if (!Number.isFinite(n) || n <= 1) delete t.groupe;
    else t.groupe = Math.min(GROUPE_MAX, n);
  } else if (k === "monture") {
    const m = ed.plan.pions.find((x) => x.id === el.value && x !== t);
    if (!m) delete t.monture;
    else {
      t.monture = m.id;
      // Il rejoint sa monture : même case pour le serveur (révélation, déplacements, visibilité).
      t.x = m.x;
      t.y = m.y;
      ed.calerPion(t);
    }
    return fini(ed, true);
  }
  fini(ed, false, k !== "couleur" && k !== "etiquette");
}

// Les boutons du panneau (data-pion-action).
export function actionPion(ed, b) {
  const t = pionChoisi(ed);
  if (!t) return;
  const a = b.dataset.pionAction;
  const v = b.dataset.valeur;
  ed.instantane();
  ed.derniereSaisie = null;
  if (a === "etat") {
    if (v === "a-terre") t.tombe = !t.tombe;
    else {
      const etats = new Set(Array.isArray(t.etats) ? t.etats : []);
      if (etats.has(v)) etats.delete(v);
      else etats.add(v);
      const liste = ETATS_PION.map((x) => x.cle).filter((c) => etats.has(c));
      if (liste.length) t.etats = liste;
      else delete t.etats;
      if (v === "invisible" && etats.has(v)) toast("Invisible : le pion disparaît de la TV et du coin des joueurs, comme un pion caché.");
    }
  } else if (a === "forme") {
    if (v === "rond") delete t.forme;
    else t.forme = v;
  } else if (a === "image-retirer") delete t.image_libre;
  else if (a === "image-prendre") t.image_libre = v;
  else if (a === "numeroter") {
    const liste = ed.plan.pions.filter((x) => memeSorte(t, x)).sort((p, q) => p.y - q.y || p.x - q.x);
    liste.forEach((x, i) => {
      x.court = String(i + 1);
    });
    toast(`${liste.length} pions numérotés de 1 à ${liste.length}.`);
  } else return;
  fini(ed, true);
}
