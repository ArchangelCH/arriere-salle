// L'outil Images de l'éditeur de plan : la bibliothèque des images du MJ (importées une fois, rangées et
// nommées, réutilisables d'un plan à l'autre), la pose d'une image comme décor ou comme pion, et le panneau d'une image
// posée (taille, rotation, au-dessus ou au-dessous des pions, franchissable, cachée). Le serveur vérifie et réécrit
// chaque image (app/ia/images_plan.py) ; la bibliothèque ne part jamais vers la TV.

import { api, echapper as e, toast } from "../api.js";
import { demander } from "../commun/dialogue.js";
import { CLE_IMAGE, estImage } from "./images.js";
import { emprise, nouvelId } from "./modele.js";

const ACCEPTE = "image/png,image/jpeg,image/webp";
const COTE_MAX = 40; // cases
const PAS = 0.5; // cases : une image se règle à la demi-case

// ---------------------------------------------------------------- la bibliothèque

// La liste des images (null pendant la première lecture : le panneau se refait quand elle arrive).
export function bibliotheque(ed) {
  if (ed.bibliothequeImages) return ed.bibliothequeImages;
  if (!ed.lectureBibliotheque) {
    ed.lectureBibliotheque = api.get("/api/bibliotheque-images").then((r) => {
      ed.bibliothequeImages = Array.isArray(r?.images) ? r.images : [];
      // Le panneau se refait pour la montrer, sauf si le MJ y écrit déjà (il la verra au panneau suivant).
      if (!ed.detruit && !ed.panneau.contains(document.activeElement)) ed.afficherPanneau();
    }).catch(() => {
      ed.bibliothequeImages = [];
      ed.lectureBibliotheque = null;
    });
  }
  return null;
}

// Importe une image dans la bibliothèque ; rend sa fiche ({ id, nom, rayon, url, largeur, hauteur, transparente }) ou null.
export async function importerImage(ed, fichier, rayon) {
  const donnees = new FormData();
  donnees.append("image", fichier);
  donnees.append("nom", (fichier.name || "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_]+/g, " ").trim().slice(0, 60));
  donnees.append("rayon", rayon || "");
  try {
    const { deja, ...image } = await api.post("/api/bibliotheque-images", donnees);
    // La même image déjà rangée (images_plan.py) : le serveur rend sa fiche, la liste ne la compte pas deux fois.
    ed.bibliothequeImages = [...(ed.bibliothequeImages || []).filter((x) => x.id !== image.id), image];
    toast(deja ? `Déjà dans la bibliothèque : « ${image.nom} » (${image.rayon}).` : `« ${image.nom} » rangée dans la bibliothèque (${image.rayon}).`);
    return image;
  } catch (err) {
    toast(`Import impossible : ${err.message || "image illisible"}`, "erreur");
    return null;
  }
}

// La bibliothèque, rangée par rayon : un bouton par image (attr et action : ce que fait le clic, data-valeur l'adresse).
export function htmlBibliotheque(liste, choisie, attr, action, parId = false) {
  const rayons = new Map();
  for (const im of liste) {
    const r = im.rayon || "Sans rayon";
    if (!rayons.has(r)) rayons.set(r, []);
    rayons.get(r).push(im);
  }
  return [...rayons.entries()].sort(([a], [b]) => a.localeCompare(b, "fr")).map(([r, images]) => `
    <p class="rayon-images">${e(r)}</p>
    <div class="bibliotheque-images">${images.map((im) => {
      const valeur = parId ? im.id : im.url;
      return `<button type="button" data-${attr}="${action}" data-valeur="${e(valeur)}" aria-pressed="${valeur === choisie}" title="${e(im.nom)}"><img src="${e(im.url)}" alt="" loading="lazy"><span>${e(im.nom)}</span></button>`;
    }).join("")}</div>`).join("");
}

const choisie = (ed) => (ed.bibliothequeImages || []).find((x) => x.id === ed.optImage?.id) || null;

// ---------------------------------------------------------------- le panneau de l'outil

export function panneauImages(ed) {
  ed.optImage ||= { id: null, mode: "decor", dessus: false, franchissable: false };
  const o = ed.optImage;
  const liste = bibliotheque(ed);
  const im = choisie(ed);
  const rayons = [...new Set((liste || []).map((x) => x.rayon).filter(Boolean))];
  return `
    <h2>Images</h2>
    <p class="aide">Vos images, gardées d'un plan à l'autre. Importez un PNG, un JPEG ou un WebP (la transparence reste), choisissez-la, puis cliquez sur le plan pour la poser. En pion, cliquer sur un pion lui donne cette image.</p>
    <div class="actions"><label class="bouton principal">Importer une image<input type="file" accept="${ACCEPTE}" data-image-reglage="importer" hidden></label></div>
    <div class="segments large" role="group" aria-label="Poser comme">
      <button type="button" data-image-action="mode" data-valeur="decor" aria-pressed="${o.mode === "decor"}">Décor ou meuble</button>
      <button type="button" data-image-action="mode" data-valeur="pion" aria-pressed="${o.mode === "pion"}">Pion</button>
    </div>
    ${o.mode === "decor" ? `
      <label class="case"><input type="checkbox" data-image-reglage="pose-dessus" ${o.dessus ? "checked" : ""}> Au-dessus des pions (un feuillage, un toit)</label>
      <label class="case"><input type="checkbox" data-image-reglage="pose-franchissable" ${o.franchissable ? "checked" : ""}> Les joueurs passent dessus</label>` : ""}
    ${liste === null ? '<p class="aide">Lecture de la bibliothèque…</p>' : liste.length ? htmlBibliotheque(liste, o.id, "image-action", "choisir", true) : '<p class="aide">La bibliothèque est vide : importez une première image.</p>'}
    ${im ? `
      <section class="image-choisie">
        <h3>Image choisie</h3>
        <label class="champ">Nom (pour vous seul)<input type="text" maxlength="60" data-image-reglage="biblio-nom" value="${e(im.nom)}"></label>
        <label class="champ">Rayon<input type="text" maxlength="40" list="rayons-images" data-image-reglage="biblio-rayon" value="${e(im.rayon)}"></label>
        <datalist id="rayons-images">${rayons.map((r) => `<option value="${e(r)}">`).join("")}</datalist>
        <p class="aide">${im.largeur} × ${im.hauteur} pixels${im.transparente ? ", détourée" : ""}. Ni ce nom ni ce rayon ne vont sur la TV.</p>
        <div class="actions"><button type="button" class="danger" data-image-action="biblio-retirer">Retirer de la bibliothèque</button></div>
      </section>` : ""}`;
}

// ---------------------------------------------------------------- le panneau d'une image posée

export function panneauImageObjet(ed, o) {
  const im = (ed.bibliothequeImages || []).find((x) => x.url === o.image);
  return `
    ${ed.outil === "image" ? `${panneauImages(ed)}<section class="pose-en-serie">` : ""}
    <h2>${e(o.nom || im?.nom || "Image")}</h2>
    ${o.image ? `<img class="apercu-image-objet" src="${e(o.image)}" alt="">` : ""}
    <label class="champ">Nom (pour vous seul)<input type="text" maxlength="60" data-el="nom" value="${e(o.nom || "")}" placeholder="${e(im?.nom || "")}"></label>
    <div class="tourner"><span class="lbl">Orientation ${o.rot || 0}°</span><button class="icone-seule" data-action="tourner-g" title="Tourner à gauche" aria-label="Tourner à gauche"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5l-7 7 7 7"/></svg></button><button class="icone-seule" data-action="tourner-d" title="Tourner à droite (R)" aria-label="Tourner à droite"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l7 7-7 7"/></svg></button></div>
    <div class="deux">
      <label class="champ">Largeur (cases)<input type="number" min="${PAS}" max="${COTE_MAX}" step="${PAS}" data-image-reglage="l" value="${e(o.l)}"></label>
      <label class="champ">Profondeur (cases)<input type="number" min="${PAS}" max="${COTE_MAX}" step="${PAS}" data-image-reglage="h" value="${e(o.h)}"></label>
    </div>
    <label class="case"><input type="checkbox" data-image-reglage="proportions" ${ed.proportionsImage !== false ? "checked" : ""}> Garder les proportions</label>
    <label class="case"><input type="checkbox" data-el="dessus" ${o.dessus ? "checked" : ""}> Au-dessus des pions</label>
    <label class="case"><input type="checkbox" data-el="franchissable" ${o.franchissable ? "checked" : ""}> Les joueurs passent dessus</label>
    <p class="aide">${o.franchissable ? "Un joueur qui bouge son pion depuis son téléphone peut traverser l'image." : "L'image barre le passage aux pions que les joueurs déplacent, comme un meuble."}</p>
    <label class="case"><input type="checkbox" data-el="cache" ${o.cache ? "checked" : ""}> Caché aux joueurs</label>
    <label class="champ secret">Note du MJ<textarea rows="2" data-el="note">${e(o.note || "")}</textarea></label>
    <div class="actions"><button class="danger" data-action="supprimer-selection">Retirer</button></div>
    ${ed.outil === "image" ? "</section>" : ""}`;
}

// ---------------------------------------------------------------- la saisie

const arrondi = (v) => Math.max(PAS, Math.min(COTE_MAX, Math.round(v / PAS) * PAS));

// La saisie d'un réglage de l'outil ou d'une image posée (data-image-reglage).
export async function reglerImage(ed, el) {
  const k = el.dataset.imageReglage;
  ed.optImage ||= { id: null, mode: "decor", dessus: false, franchissable: false };
  if (k === "importer") {
    const fichier = el.files?.[0];
    el.value = "";
    if (!fichier) return;
    const im = await importerImage(ed, fichier, ed.optImage.mode === "pion" ? "Pions" : "Décors");
    if (im && !ed.detruit) {
      ed.optImage.id = im.id;
      ed.afficherPanneau();
      toast("Cliquez sur le plan pour la poser.");
    }
    return;
  }
  if (k === "pose-dessus") ed.optImage.dessus = el.checked;
  else if (k === "pose-franchissable") ed.optImage.franchissable = el.checked;
  else if (k === "proportions") ed.proportionsImage = el.checked;
  else if (k === "biblio-nom" || k === "biblio-rayon") {
    const im = choisie(ed);
    if (!im) return;
    const champ = k === "biblio-nom" ? "nom" : "rayon";
    clearTimeout(ed.attenteBiblio);
    ed.attenteBiblio = setTimeout(async () => {
      try {
        Object.assign(im, await api.patch(`/api/bibliotheque-images/${encodeURIComponent(im.id)}`, { [champ]: el.value }));
        if (champ === "rayon" && !ed.detruit) ed.afficherPanneau();
      } catch (err) {
        toast(`Bibliothèque : ${err.message || "échec"}`, "erreur");
      }
    }, 600);
  } else if (k === "l" || k === "h") {
    const o = ed.element();
    if (!estImage(o)) return;
    const v = +el.value;
    if (!(v > 0)) return;
    if (ed.derniereSaisie !== `${o.id}:${k}`) ed.instantane();
    ed.derniereSaisie = `${o.id}:${k}`;
    const avant = emprise(o);
    const ratio = o.h / o.l;
    o[k] = arrondi(v);
    if (ed.proportionsImage !== false) {
      if (k === "l") o.h = arrondi(o.l * ratio);
      else o.l = arrondi(o.h / ratio);
      const autre = ed.panneau.querySelector(`[data-image-reglage="${k === "l" ? "h" : "l"}"]`);
      if (autre) autre.value = k === "l" ? o.h : o.l;
    }
    ed.bornerMeuble(o);
    const apres = emprise(o);
    ed.vue.rafraichirZone({ x0: Math.min(avant.x0, apres.x0) - 1, y0: Math.min(avant.y0, apres.y0) - 1, x1: Math.max(avant.x1, apres.x1) + 1, y1: Math.max(avant.y1, apres.y1) + 1 });
    ed.modifie();
  }
}

// Les boutons de l'outil (data-image-action).
export async function actionImage(ed, b) {
  const a = b.dataset.imageAction;
  ed.optImage ||= { id: null, mode: "decor", dessus: false, franchissable: false };
  if (a === "mode") ed.optImage.mode = b.dataset.valeur === "pion" ? "pion" : "decor";
  else if (a === "choisir") {
    ed.optImage.id = ed.optImage.id === b.dataset.valeur ? null : b.dataset.valeur;
    if (ed.optImage.id) toast(ed.optImage.mode === "pion" ? "Cliquez sur un pion pour lui donner l'image, ou ailleurs pour poser un pion." : "Cliquez sur le plan pour la poser.");
  } else if (a === "biblio-retirer") {
    const im = choisie(ed);
    if (!im) return;
    if (!(await demander({ titre: "Retirer de la bibliothèque", texte: `« ${im.nom} » ne sera plus proposée. Les plans qui l'utilisent la gardent.`, oui: "Retirer", danger: true }))) return;
    try {
      await api.del(`/api/bibliotheque-images/${encodeURIComponent(im.id)}`);
      ed.bibliothequeImages = (ed.bibliothequeImages || []).filter((x) => x.id !== im.id);
      ed.optImage.id = null;
    } catch (err) {
      return toast(`Bibliothèque : ${err.message || "échec"}`, "erreur");
    }
  }
  if (!ed.detruit) ed.afficherPanneau();
}

// ---------------------------------------------------------------- la pose

// Un clic de l'outil Images : prendre une image posée (et la glisser), donner l'image choisie à un pion, ou la poser.
export function clicImage(ed, x, y, ev) {
  const sur = ed.toucher(x, y, ["meuble"]);
  if (sur && estImage(ed.element(sur))) return ed.basSelection(x, y, ev, ["meuble"]);
  const im = choisie(ed);
  if (!im) return ed.basSelection(x, y, ev, ["meuble"]);
  if (ed.optImage.mode === "pion") {
    const pion = ed.toucher(x, y, ["pion"]);
    return ed.auLever(ev, () => (pion ? donnerAuPion(ed, pion.id, im) : poserPion(ed, x, y, im)));
  }
  return ed.auLever(ev, () => poserDecor(ed, x, y, im));
}

// La taille d'une image posée : deux cases dans son plus grand côté, ses proportions gardées (à la demi-case).
function tailleDeDepart(im) {
  const ratio = im.hauteur / Math.max(1, im.largeur);
  return ratio > 1 ? { l: arrondi(2 / ratio), h: 2 } : { l: 2, h: arrondi(2 * ratio) };
}

function poserDecor(ed, x, y, im) {
  const { l, h } = tailleDeDepart(im);
  const p = ed.plan;
  ed.instantane();
  const o = {
    id: nouvelId(), cle: CLE_IMAGE, image: im.url, x: Math.max(0, Math.min(Math.round(x - l / 2), p.largeur - l)),
    y: Math.max(0, Math.min(Math.round(y - h / 2), p.hauteur - h)), l, h, rot: 0, dessus: !!ed.optImage.dessus,
    franchissable: !!ed.optImage.franchissable, cache: false, nom: "", note: "",
  };
  p.objets.push(o);
  ed.vue.majStructure(null);
  ed.selectionner({ genre: "meuble", id: o.id });
  ed.modifie();
}

function donnerAuPion(ed, id, im) {
  const t = ed.plan.pions.find((x) => x.id === id);
  if (!t) return;
  ed.instantane();
  t.image_libre = im.url;
  ed.vue.chargerImagesPions();
  ed.vue.demander();
  ed.selectionner({ genre: "pion", id });
  ed.modifie(true);
  toast(t.genre === "pnj" || (t.ref || "").startsWith("pnj:") ? "Image donnée au pion. Sur la TV, seulement une fois le PNJ connu." : "Image donnée au pion.");
}

// Un pion libre, sans nom (le nom de l'image dans la bibliothèque reste au MJ) : il se nomme dans son panneau.
function poserPion(ed, x, y, im) {
  const p = ed.plan;
  ed.instantane();
  const t = { id: nouvelId(), genre: "autre", ref: "", nom: "", cache: false, tombe: false, taille: 1, couleur: "", image: "", court: "", image_libre: im.url, x, y };
  ed.calerPion(t);
  p.pions.push(t);
  ed.vue.chargerImagesPions();
  ed.vue.demander();
  ed.selectionner({ genre: "pion", id: t.id });
  ed.modifie(true);
}
