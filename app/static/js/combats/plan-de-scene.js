// Un combat lancé depuis une scène se joue sur le plan de cette scène, celui que montre la TV : ses pions donnent les
// numéros des adversaires (plutôt que le plan qui en porte le plus, planDe). S'il en manque, la préparation propose de
// les y poser, cachés : les joueurs ne les voient qu'une fois montrés dans l'éditeur du plan, et « Brigand 3 » est le
// pion 3. Fonctions pures, sauf poserAdversaires ; outils/verifier_plan_de_scene.mjs les vérifie.

import { api } from "../api.js";
import { SOLS, nouvelId } from "../plan/modele.js";
import { liensDe, sceneEnCours } from "../seances/liens-scene.js";
import { pionsDe, planDe, profil } from "./rencontre.js";

const EAU = SOLS.find((x) => x.cle === "eau")?.id;
// Ce que GET /api/table ajoute à l'état : jamais renvoyé.
const CHAMPS_LUS = ["ecrans", "ecrans_salon", "ecrans_internet", "publique"];

// Le plan de la scène qui lie cette rencontre (Préparer › Lier) : la scène en cours d'abord, sinon la première du
// déroulé. null quand aucune scène ne la lie avec un plan.
export function planDeLaScene(seance, rencontre, plans) {
  const lignes = seance?.deroule || [];
  const i = sceneEnCours(seance);
  const ordre = [...new Set([...(i >= 0 ? [i] : []), ...lignes.keys()])];
  for (const k of ordre) {
    const l = liensDe(lignes[k]);
    const p = l.rencontre && l.rencontre === rencontre?.id && l.plan ? (plans || []).find((x) => x.id === l.plan) : null;
    if (p) return p;
  }
  return null;
}

// Le plan des numéros d'une rencontre, pour la feuille de combat comme pour le suivi : celui de la scène qui la lie ;
// sinon celui qui porte le plus de ses adversaires (planDe), pris parmi les plans de son lieu quand elle en a un. Les
// mêmes troupes attendent parfois ailleurs (les Frères de l'Eau de l'étang ne sont pas ceux de l'auberge en flammes) :
// rien plutôt qu'un faux, et les numéros vont alors 1, 2, 3.
export function planDesNumeros(seance, rencontre, plans) {
  const p = planDeLaScene(seance, rencontre, plans);
  if (p || !rencontre) return p;
  return planDe(rencontre, (plans || []).filter((x) => !rencontre.lieu || x.lieu === rencontre.lieu));
}

// Combien d'adversaires de la rencontre n'ont pas de pion sur ce plan.
export function manquants(r, plan) {
  const deja = pionsDe(r, plan);
  return (r?.adversaires || []).reduce((n, a, i) => n + Math.max(0, (a.n || 0) - deja[i].length), 0);
}

// Les pions qui manquent, comme l'éditeur les pose depuis une rencontre (référence du bestiaire, nom de la rencontre),
// cachés, numérotés à la suite des numéros déjà pris sur le plan.
export function pionsAPoser(r, plan) {
  const deja = pionsDe(r, plan);
  const pris = new Set((plan?.pions || []).filter((t) => t.genre === "ennemi").map((t) => String(t.court || "").trim()).filter(Boolean));
  let n = 0;
  const numero = () => {
    n++;
    while (pris.has(String(n))) n++;
    return String(n);
  };
  const res = [];
  (r?.adversaires || []).forEach((a, i) => {
    const rang = profil(a).rang;
    for (let k = deja[i].length; k < (a.n || 0); k++) {
      res.push({ genre: "ennemi", ref: `bestiaire:${a.cle}`, nom: a.nom || profil(a).nom || "Adversaire", court: numero(), taille: rang === "boss" || rang === "dragon" ? 2 : 1, cache: true, tombe: false, couleur: "", image: "" });
    }
  });
  return res;
}

// Des cases pour n pions, en spirale autour des héros posés (à deux cases d'eux au moins), sinon du milieu du plan : un
// sol sans autre pion, hors de l'eau tant qu'il y a la place.
export function places(plan, n) {
  const w = Math.round(+plan?.largeur || 0);
  const h = Math.round(+plan?.hauteur || 0);
  const sol = Array.isArray(plan?.sol) ? plan.sol : [];
  const occupees = new Set((plan?.pions || []).filter((t) => Number.isFinite(t.x) && Number.isFinite(t.y)).map((t) => `${Math.floor(t.x)}:${Math.floor(t.y)}`));
  const heros = (plan?.pions || []).filter((t) => t.genre === "heros" && Number.isFinite(t.x) && Number.isFinite(t.y));
  const milieu = (liste, cle, defaut) => (liste.length ? Math.floor(liste.reduce((s, t) => s + t[cle], 0) / liste.length) : defaut);
  const cx = milieu(heros, "x", Math.floor(w / 2));
  const cy = milieu(heros, "y", Math.floor(h / 2));
  const depart = heros.length ? 2 : 0;
  const res = [];
  for (const eau of [false, true]) {
    for (let r = depart; r < Math.max(w, h) && res.length < n; r++) {
      for (let j = cy - r; j <= cy + r && res.length < n; j++) {
        for (let i = cx - r; i <= cx + r && res.length < n; i++) {
          if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== r || i < 0 || j < 0 || i >= w || j >= h) continue;
          const k = j * w + i;
          if ((!plan.fond && !sol[k]) || (!eau && sol[k] === EAU) || occupees.has(`${i}:${j}`)) continue;
          res.push([i, j]);
          occupees.add(`${i}:${j}`);
        }
      }
    }
    if (res.length >= n) break;
  }
  return res;
}

// Pose sur le plan les adversaires qui y manquent, cachés, et rend { plan, poses } : le plan enregistré. Le plan est
// relu juste avant, et part avec sa version : ce qu'un autre écran y a changé n'est pas écrasé (relu et refait une fois).
export async function poserAdversaires(planId, r) {
  const url = `/api/plans/${encodeURIComponent(planId)}`;
  for (let essai = 0; ; essai++) {
    const p = await api.get(url);
    const modeles = pionsAPoser(r, p);
    if (!modeles.length) return { plan: p, poses: 0 };
    const cases = places(p, modeles.length);
    const pions = modeles.map((m, k) => {
      const [i, j] = cases[k] || [Math.floor(p.largeur / 2), Math.floor(p.hauteur / 2)];
      return { id: nouvelId(), ...m, x: m.taille % 2 ? i + 0.5 : i + 1, y: m.taille % 2 ? j + 0.5 : j + 1 };
    });
    let neuf;
    try {
      neuf = await api.patch(url, { pions: [...(p.pions || []), ...pions], version_base: p.modifie });
    } catch (err) {
      if (err.status === 409 && !essai) continue;
      throw err;
    }
    // La TV qui montre ce plan reçoit sa nouvelle version ; les pions cachés n'y paraissent pas.
    const t = await api.get("/api/table").catch(() => null);
    if (t?.vue === "plan" && t.plan === planId) {
      for (const k of CHAMPS_LUS) delete t[k];
      await api.put("/api/table", { ...t, version: neuf.modifie }).catch(() => null);
    }
    return { plan: neuf, poses: pions.length };
  }
}
