// Importer un plan Universal VTT, côté page : le fichier se lit dans le navigateur (ces exports dépassent souvent ce que
// le serveur accepte d'un seul envoi), son image est réduite puis envoyée comme n'importe quelle image de fond, et la
// conversion des murs en pièces et en portes vient de uvtt.js. Rend de quoi créer un plan ou remplacer celui de
// l'éditeur ; « Nouveau plan » (atelier/cartes.js) et l'éditeur (editeur.js, « Image de fond ») s'en servent.

import { api, echapper as e } from "../api.js";
import { chargerImage } from "../carte/vue.js";
import { nouvelId } from "./modele.js";
import { ErreurUvtt, POIDS_FICHIER, POIDS_IMAGE, convertir, lireUvtt, octetsDeBase64, phrasesBilan, tailleReduite, typeImage } from "./uvtt.js";

// Le serveur refuse une image de plus de 40 millions de pixels.
const PIXELS_MAX = 40e6;
const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const ILLISIBLE = "L'image de ce plan est illisible, ou trop grande pour ce navigateur.";

// Laisse la page se redessiner (l'état d'attente) avant un calcul qui la fige un instant.
const souffler = () => new Promise((ok) => requestAnimationFrame(() => setTimeout(ok, 0)));

// L'état d'attente d'un import : une fenêtre qui dit l'étape en cours, avec sa barre. dire(texte, part) : part de 0 à 1,
// ou rien quand la durée ne se mesure pas. Échap ne la ferme pas : l'import va à son terme ou dit son erreur.
export function attente(titre) {
  const d = document.createElement("dialog");
  d.className = "dialogue attente-import";
  d.innerHTML = `<h2>${e(titre)}</h2><p class="etape" role="status"></p><progress></progress>`;
  d.addEventListener("cancel", (ev) => ev.preventDefault());
  document.body.append(d);
  d.showModal();
  const barre = d.querySelector("progress");
  return {
    dire(texte, part = null) {
      d.querySelector(".etape").textContent = texte;
      if (part === null) barre.removeAttribute("value");
      else barre.value = Math.max(0, Math.min(1, part));
    },
    fermer() {
      if (d.open) d.close();
      d.remove();
    },
  };
}

function lireTexte(fichier, suivre) {
  return new Promise((ok, ko) => {
    const lecteur = new FileReader();
    lecteur.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total) suivre("Lecture du fichier…", ev.loaded / ev.total);
    };
    lecteur.onload = () => ok(String(lecteur.result || ""));
    lecteur.onerror = () => ko(new ErreurUvtt("Fichier illisible : la lecture a échoué."));
    lecteur.readAsText(fichier);
  });
}

const enBlob = (toile, type, qualite) => new Promise((ok) => toile.toBlob(ok, type, qualite));

// L'image du fichier, prête à partir : telle quelle si elle est assez petite, sinon réduite (100 px par case et 4096 px
// de côté au plus) en WebP, ou en JPEG là où le navigateur n'écrit pas de WebP (Safari).
async function preparerImage(u) {
  const octets = octetsDeBase64(u.image);
  const type = typeImage(octets);
  if (!type) throw new ErreurUvtt("L'image de ce plan n'est ni un PNG, ni un JPEG, ni un WebP.");
  const source = new Blob([octets], { type });
  const adresse = URL.createObjectURL(source);
  try {
    const img = await chargerImage(adresse).catch(() => {
      throw new ErreurUvtt(ILLISIBLE);
    });
    const [l, h] = [img.naturalWidth, img.naturalHeight];
    if (!(l > 0 && h > 0)) throw new ErreurUvtt(ILLISIBLE);
    const reduite = tailleReduite(l, h, u.cases.l);
    if (!reduite && source.size <= POIDS_IMAGE && l * h <= PIXELS_MAX) return { blob: source, ratio: h / l };
    const cible = reduite || { l, h };
    const toile = document.createElement("canvas");
    toile.width = cible.l;
    toile.height = cible.h;
    const ctx = toile.getContext("2d");
    if (!ctx) throw new ErreurUvtt(ILLISIBLE);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, cible.l, cible.h);
    let blob = await enBlob(toile, "image/webp", 0.9);
    for (const qualite of [0.9, 0.8, 0.65]) {
      if (blob && blob.type !== "image/png" && blob.size <= POIDS_IMAGE) break;
      blob = await enBlob(toile, "image/jpeg", qualite);
    }
    if (!blob) throw new ErreurUvtt(ILLISIBLE);
    if (blob.size > POIDS_IMAGE) throw new ErreurUvtt("L'image de ce plan reste trop lourde même réduite (25 Mo au plus).");
    return { blob, ratio: cible.h / cible.l };
  } finally {
    URL.revokeObjectURL(adresse);
  }
}

// Le plan tiré d'un fichier UVTT : { plan, bilan, phrases }. plan : taille, sols, pièces, portes, image de fond (déjà
// envoyée) et quadrillage éteint, à poser sur un plan neuf ou sur celui de l'éditeur ; phrases : ce qui a été repris et
// ce qui s'est perdu, à dire au MJ. suivre(texte, part) : l'état d'attente. Lève une erreur au message lisible.
export async function importerUvtt(fichier, suivre = () => {}) {
  if (!fichier) throw new ErreurUvtt("Aucun fichier choisi.");
  if (fichier.size > POIDS_FICHIER) throw new ErreurUvtt(`Fichier trop lourd (${Math.round(fichier.size / 1048576)} Mo) : 300 Mo au plus.`);
  suivre("Lecture du fichier…", 0);
  let texte = await lireTexte(fichier, suivre);
  suivre("Lecture des murs et des portes…");
  await souffler();
  const u = lireUvtt(texte);
  texte = null;
  const conversion = convertir(u, nouvelId);
  suivre("Préparation de l'image…");
  await souffler();
  const { blob, ratio } = await preparerImage(u);
  suivre("Envoi de l'image…");
  const donnees = new FormData();
  donnees.append("image", blob, `plan.${EXTENSIONS[blob.type] || "png"}`);
  const { url } = await api.post("/api/images", donnees);
  const { bilan, ...trace } = conversion;
  return {
    plan: { ...trace, fond: { url, ...u.fond, opacite: 1, dessiner: false, ratio }, quadrillage: false },
    bilan, phrases: phrasesBilan(bilan),
  };
}

// Le nom d'un plan d'après son fichier : « auberge-rdc.dd2vtt » donne « auberge rdc ».
export const nomDuFichier = (fichier) => String(fichier?.name || "").replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim().slice(0, 80);
