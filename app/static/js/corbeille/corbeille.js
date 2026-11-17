// Les filets de la corbeille, pour les pages qui suppriment : plus de confirmation avant de jeter une fiche, mais
// « Annuler » pendant dix secondes dans le message qui suit, et le chemin des versions précédentes d'une fiche. La page
// Corbeille et celle des versions vivent dans corbeille-page.js ; le serveur, dans corbeille.py.

import { api, toast } from "../api.js";
import { identiteTablee } from "../aventuriers/regles.js";

const genre = (a, m, f) => (a?.genre === "f" ? f : m);

// Remet la dernière fiche jetée sous cet identifiant ; rend { collection, id, nom }.
export function remettreJetee(collection, id) {
  return api.post(`/api/corbeille/${encodeURIComponent(collection)}/${encodeURIComponent(id)}/annuler`);
}

// Rouvre une page : y aller, ou la redessiner si l'on y est déjà (le routeur relit tout du serveur).
export function rouvrir(hash) {
  if (!hash) return;
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = hash;
}

// Le message qui suit une mise à la corbeille. retour : la page à rouvrir une fois la fiche remise (la fiche elle-même,
// ou la liste d'où on l'a jetée) ; apres(remise) : ce que la page doit refaire de son côté avant (la tablée d'un
// aventurier…).
export function annoncerCorbeille(message, collection, id, { retour = "", apres = null } = {}) {
  return toast(message, "info", {
    action: {
      libelle: "Annuler",
      async faire() {
        let r;
        try {
          r = await remettreJetee(collection, id);
        } catch (err) {
          return toast(`Rien n'est revenu : ${err.message}. La fiche attend dans la corbeille (lien à côté du nom de l'atelier).`, "erreur");
        }
        try {
          await apres?.(r);
        } catch (err) {
          toast(`Fiche remise, mais pas tout à fait : ${err.message}`, "erreur");
        }
        toast(r.nom ? `« ${r.nom} » est de retour.` : "La fiche est de retour.");
        rouvrir(retour);
      },
    },
  });
}

// Un aventurier remis reprend sa ligne à la tablée des séances (joueur, couleur des dés, nom, peuple, vocation),
// comme le créateur la tient : la campagne ne garde pas les absents. place : { ligne, rang }, la ligne qu'il avait au
// moment de partir (« Annuler » juste après) ; il la retrouve à son rang, et la séance du soir le compte de nouveau
// parmi ses présents. Sans elle (remis plus tard depuis la Corbeille), une ligne neuve au bout.
export async function remettreALaTablee(id, place = null) {
  const a = await api.get(`/api/aventuriers/${encodeURIComponent(id)}`);
  if (a.tablee === false) return a;
  for (let essai = 0; essai < 3; essai++) {
    const c = await api.get("/api/campagne");
    const t = [...(c.tablee || [])];
    if (t.some((j) => j.aventurier === a.id)) return a;
    const ancienne = place?.ligne?.id && !t.some((j) => j.id === place.ligne.id) ? place.ligne : null;
    const ligne = { ...(ancienne || { id: Math.random().toString(36).slice(2, 8), actif: true }), aventurier: a.id, joueur: a.joueur || "", couleur: a.couleur || "#b3261e", ...identiteTablee(a) };
    if (ancienne) t.splice(Math.min(Math.max(0, +place.rang || 0), t.length), 0, ligne);
    else t.push(ligne);
    try {
      await api.put("/api/campagne", { ...c, tablee: t, version_base: c.modifie });
      return a;
    } catch (err) {
      if (err.status !== 409 || essai === 2) throw new Error(`${genre(a, "il", "elle")} n'a pas repris sa place à la tablée des séances (${err.message})`);
    }
  }
  return a;
}

// Le lien « Versions précédentes » d'une fiche ; retour : la page où revenir (celle de la fiche, par défaut l'actuelle).
export function lienVersions(collection, id, retour = location.hash) {
  const q = retour ? `?retour=${encodeURIComponent(retour)}` : "";
  return `#/versions/${encodeURIComponent(collection)}/${encodeURIComponent(id)}${q}`;
}
