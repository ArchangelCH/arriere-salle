// Les documents à imprimer, pour les tendre aux joueurs en main propre : /document-imprime?id=… (un document) et
// /documents-imprimes?seance=… (tous ceux de la séance : ceux que lient ses scènes, dans l'ordre du déroulé, puis ceux de
// « Sous la main »). Une feuille par document, en A5 ou en A4, le papier dessiné comme à la TV (rendu.js), à la plus
// grande taille qui tient. Le serveur ne donne que ce que liront les joueurs (masqué, sans les notes du MJ) ; ce qu'un
// document nomme d'encore inconnu est rappelé à l'écran, jamais imprimé.

import { api, echapper as e } from "../api.js";
import { listeInconnus } from "../pnj/carton-pnj.js";
import { idsSousLaMain } from "../seances/sous-la-main.js";
import { apercuALEcran } from "../commun/apercu-feuille.js";
import { ajusterDocument, htmlDocument, imagesPretes } from "./rendu.js";

const MM = 96 / 25.4;
const FORMATS = { a5: { l: 148, h: 210, marge: 9, nom: "A5" }, a4: { l: 210, h: 297, marge: 12, nom: "A4" } };
const parametres = new URLSearchParams(location.search);
const feuilles = document.getElementById("feuilles");
const avertissement = document.querySelector(".avertissement");
const taille = document.querySelector(".taille");
const majApercu = apercuALEcran(".feuille", 148);
let lus = []; // [{ document, secrets }]

function lireFormat() {
  try {
    return localStorage.getItem("documents-imprimes-format") === "a4" ? "a4" : "a5";
  } catch {
    return "a5";
  }
}

function garderFormat(f) {
  try {
    localStorage.setItem("documents-imprimes-format", f);
  } catch {
    // le format choisi vaut pour cette page seulement
  }
}

async function lire() {
  const seance = parametres.get("seance");
  if (seance) {
    const s = await api.get(`/api/seances/${encodeURIComponent(seance)}`);
    document.title = `Documents de la séance ${s.numero ?? ""} · L'Arrière-salle`.replace("  ", " ");
    const retour = document.querySelector(".retour");
    retour.href = `/#/seances/${encodeURIComponent(s.id)}`;
    retour.textContent = "Retour à la séance";
    const ids = idsSousLaMain(s, []).documents.map((x) => x.id);
    const reponses = await Promise.all(ids.map((id) => api.get(`/api/documents/${encodeURIComponent(id)}/imprime`).catch(() => null)));
    return reponses.filter(Boolean);
  }
  const id = parametres.get("id") || "";
  const r = await api.get(`/api/documents/${encodeURIComponent(id)}/imprime`);
  document.querySelector(".retour").href = `/#/documents/${encodeURIComponent(id)}`;
  document.title = `${r.document.nom || "Document"} · à imprimer`;
  return [r];
}

function avertir() {
  const avec = lus.filter((x) => x.secrets.length);
  avertissement.hidden = !avec.length;
  avertissement.innerHTML = avec.map((x) => `<p><b>${e(x.document.nom || "Un document")}</b> nomme ${e(listeInconnus(x.secrets))}, ${x.secrets.length > 1 ? "encore inconnus" : "encore inconnu"} des joueurs : relisez-le avant de le tendre.</p>`).join("");
}

async function dessiner() {
  const f = FORMATS[document.body.classList.contains("format-a4") ? "a4" : "a5"];
  if (!lus.length) {
    feuilles.innerHTML = `<p class="aucun-document">Aucun document à imprimer pour cette séance. Liez-en un à une scène, ou ajoutez-le à « Sous la main », dans Séances › Préparer. <a href="/#/documents">Les documents</a></p>`;
    taille.textContent = "";
    return;
  }
  feuilles.innerHTML = lus.map((x) => `<section class="feuille"><p class="titre-mj">${e(x.document.nom || "")}</p>${htmlDocument(x.document)}</section>`).join("");
  await imagesPretes(feuilles);
  if (document.fonts) await document.fonts.ready;
  const largeur = (f.l - 2 * f.marge) * MM;
  const hauteur = (f.h - 2 * f.marge) * MM;
  for (const article of feuilles.querySelectorAll(".document")) ajusterDocument(article, largeur, hauteur - 14, { depart: 26, min: 7 });
  for (const x of feuilles.querySelectorAll(".feuille")) x.style.zoom = ""; // mesurée à sa taille de papier
  majApercu(f.l);
  taille.textContent = `${lus.length > 1 ? `${lus.length} feuilles` : "Une feuille"} ${f.nom}, une par document.`;
}

function choisirFormat(cle) {
  document.body.classList.toggle("format-a4", cle === "a4");
  document.body.classList.toggle("format-a5", cle !== "a4");
  document.getElementById("format-page").textContent = `@page { size: ${FORMATS[cle].nom} portrait; margin: 0; }`;
  const radio = document.querySelector(`input[name="format"][value="${cle}"]`);
  if (radio) radio.checked = true;
}

document.querySelector(".choix-format").addEventListener("change", (ev) => {
  choisirFormat(ev.target.value);
  garderFormat(ev.target.value);
  dessiner();
});
document.querySelector('input[name="fond"]').addEventListener("change", (ev) => document.body.classList.toggle("sans-fond", !ev.target.checked));
document.querySelector('[data-action="imprimer"]').addEventListener("click", () => window.print());

choisirFormat(lireFormat());
try {
  lus = await lire();
  avertir();
  await dessiner();
} catch (err) {
  feuilles.innerHTML = `<p class="aucun-document">Impossible de préparer la page : ${e(err.message)}. <a href="/#/documents">Les documents</a></p>`;
}
