// Le clavier des éditeurs de carte et de plan, autour des champs de leur panneau. Un élément tout juste posé (nom de
// région, texte du plan) donne la main à son champ : la frappe y va, au lieu de choisir des outils ou d'ouvrir le
// journal. Échap, dans un champ de l'éditeur, rend la main à la carte ou au plan, sans rien faire d'autre.

const SAISIE = "input, textarea, select, [contenteditable]";

// La main au champ, son texte sélectionné. Le geste qui vient de poser l'élément n'est pas fini : à la souris, le
// mousedown qui suit le pointerdown, au doigt le clic simulé après le toucher, rendraient le focus à la toile. Si cela
// arrive avant le geste suivant (une seconde au plus), la main revient au champ.
export function donnerLaMain(champ, toile) {
  if (!champ) return;
  const prendre = () => {
    if (!champ.isConnected) return;
    champ.focus({ preventScroll: true });
    champ.select?.();
  };
  prendre();
  if (!toile) return;
  let minuteur = 0;
  const finir = () => {
    clearTimeout(minuteur);
    toile.removeEventListener("focus", reprendre);
    toile.removeEventListener("pointerdown", finir, true);
  };
  const reprendre = () => {
    finir();
    prendre();
  };
  minuteur = setTimeout(finir, 1000);
  toile.addEventListener("focus", reprendre);
  // Un nouveau geste sur la toile la veut pour lui : le champ ne reprend plus rien.
  toile.addEventListener("pointerdown", finir, true);
}

// Échap dans un champ de l'éditeur (panneau, barre) : le champ perd la main, la toile la reprend, et rien d'autre ne se
// passe (la sélection reste). Vrai si c'est le cas. Un champ de dialogue garde son Échap, qui ferme le dialogue.
export function rendreLaMain(ev, toile) {
  if (ev.key !== "Escape" || ev.isComposing || !toile) return false;
  const champ = ev.target instanceof Element ? ev.target.closest(SAISIE) : null;
  if (!champ || champ.closest("dialog") || !champ.closest(".editeur")) return false;
  ev.preventDefault();
  champ.blur();
  toile.focus({ preventScroll: true });
  return true;
}
