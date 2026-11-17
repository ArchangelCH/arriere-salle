// La salle, vue de l'atelier (salle.py) : les mains levées depuis le coin des joueurs, dans l'ordre où elles se sont
// levées, et qui est au coin en ce moment. Une seule source par page, partagée par le Tableau, l'en-tête, la carte des
// joueurs (onglet Aventuriers) et la télécommande. Elle arrive par le canal de l'atelier (canal-table.js, message
// « salle ») à l'instant où le joueur lève la main ; une relecture de secours rattrape une liaison tombée. Une main
// retombe seule au bout de cinq minutes : la page le compte avec sa propre horloge, sans attendre le serveur.
//
// Les héros qui lèvent la main ou dont le joueur est en ligne se marquent par une petite feuille de style écrite ici
// (une règle par héros) : le Tableau et le combat redessinent leurs lignes sans cesse, la marque tient sans les toucher.

import { api } from "../api.js";
import { ecouterSalle } from "../ecran-tv/canal-table.js";

const SECOURS = 30000;
const ID = /^[a-z0-9-]{1,60}$/;
const abonnes = new Set();
let vue = null; // la dernière vue reçue ; chaque main y porte fin, l'heure de cette page où elle retombe
let numero = 0; // monte à chaque vue reçue par le canal : une relecture partie avant ne la remplace pas
let demarree = false;
let minuterie = 0;
let feuille = null;

// Une chaîne CSS sûre pour un prénom ou un nom : guillemets, barres et sauts de ligne neutralisés.
const chaineCss = (t) => `"${String(t ?? "").replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\n\r\f\t]/g, " ")}"`;
export const prenomDe = (m) => String(m?.nom || "").trim() || "Un joueur";

// Les mains encore levées à l'horloge de cette page, rangées de nouveau (une main retombée laisse sa place).
function courante() {
  if (!vue) return null;
  const t = Date.now();
  const mains = vue.mains.filter((m) => m.fin > t).map((m, i) => ({ ...m, rang: i + 1 }));
  return { ...vue, mains };
}

function marquer(v) {
  if (!feuille) {
    feuille = document.createElement("style");
    feuille.id = "salle-marques";
    document.head.append(feuille);
  }
  const regles = [];
  const plusieurs = (v?.mains || []).length > 1;
  for (const m of v?.mains || []) {
    const h = m.heros?.id;
    if (!ID.test(h || "")) continue;
    const texte = plusieurs ? `${m.rang} · ${prenomDe(m)} lève la main` : `${prenomDe(m)} lève la main`;
    // Hors combat, la ligne porte l'identifiant du héros ; au combat, son bouton (la ligne s'allume là où :has existe).
    regles.push(`.tableau-mj .tc-ligne[data-tb-heros="${h}"] { background: var(--salle-fond); box-shadow: var(--salle-ombre); }`);
    regles.push(`.tableau-mj .tc-ligne:has(> .tc-qui[data-heros="${h}"]) { background: var(--salle-fond); box-shadow: var(--salle-ombre); }`);
    regles.push(`.tableau-mj .tc-ligne[data-tb-heros="${h}"] > .tc-qui::after, .tableau-mj .tc-qui[data-heros="${h}"]::after { content: ${chaineCss(texte)}; }`);
  }
  for (const x of v?.en_ligne || []) {
    const h = x.heros?.id;
    if (ID.test(h || "")) regles.push(`.tableau-mj .tc-ligne[data-tb-heros="${h}"] > .tc-qui b::after, .tableau-mj .tc-qui[data-heros="${h}"] b::after { content: ""; }`);
    if (ID.test(x.joueur || "")) regles.push(`[data-en-ligne-joueur="${x.joueur}"] { display: inline-flex; }`);
  }
  const texte = regles.join("\n");
  if (feuille.textContent !== texte) feuille.textContent = texte;
}

function annoncer() {
  clearTimeout(minuterie);
  const v = courante();
  marquer(v);
  for (const fn of [...abonnes]) {
    try {
      fn(v);
    } catch (err) {
      console.error(err);
    }
  }
  // La prochaine main qui retombe : la vue se refait à cet instant-là.
  const fin = Math.min(...(v?.mains || []).map((m) => m.fin));
  if (Number.isFinite(fin)) minuterie = setTimeout(annoncer, Math.max(100, fin - Date.now() + 30));
}

function poser(v) {
  if (!v || !Array.isArray(v.mains) || !Array.isArray(v.en_ligne)) return;
  const t = Date.now();
  vue = { ...v, mains: v.mains.map((m) => ({ ...m, fin: t + Math.max(0, Number(m.reste) || 0) * 1000 })) };
  annoncer();
}

function relire() {
  const n = numero;
  return api.get("/api/salle").then((v) => {
    if (n === numero) poser(v);
  }).catch(() => {});
}

function demarrer() {
  if (demarree) return;
  demarree = true;
  ecouterSalle((v) => {
    numero += 1;
    poser(v);
  });
  relire();
  setInterval(relire, SECOURS);
  window.addEventListener("focus", relire);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") relire();
  });
}

// fn(vue) à chaque changement, et tout de suite avec la dernière connue : { mains, en_ligne, presence, invites }, ou
// null tant que rien n'est lu. Renvoie de quoi cesser.
export function ecouterLaSalle(fn) {
  abonnes.add(fn);
  demarrer();
  if (vue) fn(courante());
  return () => abonnes.delete(fn);
}

// « Donner la parole » (geste « parole ») ou « Plus tard » (« plus-tard »), avec la version lue : un autre écran passé
// avant, ou le joueur qui a baissé sa main, et le serveur refuse (409). La vue rendue remplace aussitôt la nôtre.
export async function repondre(main, geste) {
  try {
    const v = await api.post(`/api/salle/mains/${encodeURIComponent(main.joueur)}/${encodeURIComponent(main.id)}`, { geste, version: main.version });
    numero += 1;
    poser(v);
    return v;
  } catch (err) {
    relire();
    throw err;
  }
}

// « Paul, Jeanne et Léa ».
export function enListe(noms) {
  return noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}` : noms[0] || "";
}
