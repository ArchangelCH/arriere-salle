// Les règles maison, communes à l'onglet et à la fenêtre rapide (touche R) : la recherche sans accents ni casse, les mots
// trouvés surlignés, les dates en clair, l'avertissement avant le carnet des joueurs, et la séance où se note une
// décision prise à la table.

import { api, echapper as e, toast } from "../api.js";
import { etatJeu } from "../commun/etat-jeu.js";
import { seanceDuJournal } from "../seances/journal.js";

export const STATUTS = { "a-trancher": "À trancher", "en-vigueur": "En vigueur" };
export const ORDRE = ["a-trancher", "en-vigueur"];
export const TITRE_MAX = 80;
export const TEXTE_MAX = 2000;
export const CONTEXTE_MAX = 4000;

// Un caractère à la fois, de même longueur : la place d'un mot trouvé dans le texte plié est sa place dans le texte.
function plierUnite(c) {
  const p = c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’‘]/g, "'");
  if (p.length === 1) return p;
  const m = c.toLowerCase();
  return m.length === 1 ? m : c;
}

const nfc = (t) => String(t ?? "").normalize("NFC");
export const plier = (t) => nfc(t).split("").map(plierUnite).join("");
export const motsDe = (q) => plier(q).split(/\s+/).filter(Boolean);

// Tous les mots cherchés figurent dans la règle (titre et texte, et le contexte si `contexte`).
export function correspond(regle, mots, contexte = false) {
  if (!mots.length) return true;
  const t = plier([regle.titre, regle.texte, contexte ? regle.contexte : ""].join("\n"));
  return mots.every((m) => t.includes(m));
}

// Le texte échappé, les mots cherchés dans des <mark>.
export function surligner(texte, mots = []) {
  const t = nfc(texte);
  const plie = t.split("").map(plierUnite).join("");
  const zones = [];
  for (const m of mots) for (let i = plie.indexOf(m); i >= 0; i = plie.indexOf(m, i + m.length)) zones.push([i, i + m.length]);
  // Deux mots qui se chevauchent ou se touchent ne font qu'une marque.
  const fusion = [];
  for (const z of zones.sort((a, b) => a[0] - b[0])) {
    const derniere = fusion[fusion.length - 1];
    if (derniere && z[0] <= derniere[1]) derniere[1] = Math.max(derniere[1], z[1]);
    else fusion.push(z);
  }
  let html = "";
  let pos = 0;
  for (const [debut, fin] of fusion) {
    html += `${e(t.slice(pos, debut))}<mark>${e(t.slice(debut, fin))}</mark>`;
    pos = fin;
  }
  return html + e(t.slice(pos));
}

// « 2 novembre » (l'année seulement si ce n'est pas celle-ci) ; une date seule se lit à midi, à l'abri des fuseaux.
export function dateEnClair(iso) {
  if (!iso) return "";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "";
  const annee = d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" };
  return d.toLocaleDateString("fr-CH", { day: "numeric", month: "long", ...annee });
}

export const aujourdhui = () => new Date().toLocaleDateString("sv");

export const nomSeance = (s) => (s ? [`Séance ${s.numero ?? ""}`.trim(), s.nom].filter(Boolean).join(" · ") : "");

// « En vigueur depuis le 2 novembre », « Notée le 3 novembre ».
export function quand(r) {
  if (r.statut === "a-trancher") return r.cree ? `Notée le ${dateEnClair(r.cree)}` : "";
  const d = r.depuis || r.cree;
  return d ? `En vigueur depuis le ${dateEnClair(d)}` : "En vigueur";
}

export const lireRegles = () => api.get("/api/regles-maison");

// Chaque écran de cette page qui change une règle l'annonce : l'onglet et la fenêtre rapide se relisent, sauf celui qui
// annonce (source).
export function annoncerRegles(source = null) {
  window.dispatchEvent(new CustomEvent("regles-modifiees", { detail: { source } }));
}

// Une règle en vigueur et publique part dans le carnet des joueurs : le nom caché de l'auberge y devient « l'auberge »,
// et un PNJ, un lieu ou un peuple encore inconnu des joueurs nommé dedans est signalé. Un avertissement, rien n'est bloqué.
export async function avertirSecrets(r) {
  if (!r || r.statut !== "en-vigueur" || r.publique === false) return;
  try {
    const v = await api.post("/api/masque", { texte: `${r.titre || ""}\n${r.texte || ""}` });
    if (v.trouve) toast("Le nom secret de l'auberge sera remplacé par « l'auberge » dans le carnet des joueurs.", "erreur");
    const noms = [...new Set((v.secrets || []).map((x) => x.nom))];
    if (noms.length) {
      const liste = noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}` : noms[0];
      toast(`Cette règle nomme ${liste}, que les joueurs ne connaissent pas encore. Elle paraît pourtant dans leur carnet.`, "erreur");
    }
  } catch {
    // vérification de confort seulement
  }
}

// La séance où se note une décision prise à la table : celle du combat en cours (l'état du jeu, comme le Tableau) si elle
// n'est pas close, sinon celle du journal (la séance du jour, ou la plus proche qui n'est pas close). Aucune : null.
export async function seanceEnCours() {
  const seances = await api.get("/api/seances");
  let auCombat = etatJeu()?.seance || "";
  if (!auCombat) {
    const etats = await api.get("/api/etats-heros").catch(() => null);
    auCombat = Object.values(etats?.au_combat || {}).map((x) => x?.seance).find(Boolean) || "";
  }
  return seances.find((s) => s.id === auCombat && !s.close) || seanceDuJournal(seances);
}
