// Gestes au doigt dans les éditeurs de plans et de cartes (iPad, iPhone). Un pincement commence toujours par un seul
// doigt, posé un peu avant le second : ce premier contact ne doit rien révéler ni poser. Une action ponctuelle part
// donc au lever du doigt, un trait au pinceau après un court délai ou un petit glissé, et un deuxième doigt annule ce
// qui attendait encore. Souris, stylet et pavé tactile ne passent pas par ici.

export const SEUIL = 8; // pixels d'écran : au-delà, le doigt glisse au lieu de toucher
export const DELAI = 120; // millisecondes : un doigt resté posé commence le trait

export const auDoigt = (ev) => ev.pointerType === "touch";

// Le pointeur a-t-il glissé d'au moins SEUIL pixels depuis `depart` ([x, y] dans le canvas) ?
export function aGlisse(depart, ev) {
  return Math.hypot(ev.offsetX - depart[0], ev.offsetY - depart[1]) >= SEUIL;
}

// Un doigt posé qui n'a encore rien fait. auLever : au lever d'un doigt resté presque immobile ; auGlisser(depart) :
// une seule fois, dès qu'il a glissé de SEUIL pixels, ou après `delai` millisecondes s'il est donné.
export class Attente {
  constructor(ev, auLever, auGlisser, delai = 0) {
    this.id = ev.pointerId;
    this.depart = [ev.offsetX, ev.offsetY];
    this.auLever = auLever;
    this.auGlisser = auGlisser;
    this.fini = false;
    this.minuteur = delai ? setTimeout(() => this.partir(), delai) : 0;
  }

  partir() {
    if (this.fini) return;
    this.annuler();
    this.auGlisser(this.depart);
  }

  // Vrai tant que le doigt attend encore : ce mouvement-là ne fait rien d'autre.
  bouge(ev) {
    if (this.fini || ev.pointerId !== this.id) return false;
    if (!aGlisse(this.depart, ev)) return true;
    this.partir();
    return false;
  }

  // L'action part au pointerup seulement : un geste repris par le navigateur (pointercancel) n'en fait aucune.
  leve(ev) {
    if (this.fini || ev.pointerId !== this.id) return;
    this.annuler();
    if (ev.type === "pointerup") this.auLever();
  }

  annuler() {
    this.fini = true;
    clearTimeout(this.minuteur);
  }
}
