// L'outil Pointeur des éditeurs de plans et de cartes : la position de la souris (du doigt, du stylet) sur le plan ou la
// carte part vers la TV, qui y montre un point doré ; un clic y fait une onde. Rien ne s'enregistre : un WebSocket propre
// à l'atelier (/ws/pointeur, fermé à Internet) porte les positions, au plus une toutes les PAS millisecondes, et le
// serveur ne les passe qu'aux écrans qui montrent ce plan ou cette carte. Il répond, quand cela change ou après relire(),
// si le point passe et sur combien d'écrans (surPortee).

import { echapper } from "../api.js";

export const PAS = 50; // millisecondes entre deux positions envoyées : 20 par seconde
const RELANCE = 2000; // liaison coupée : pas de nouvel essai avant ce délai
const ENGORGE = 4096; // octets en attente d'envoi : le réseau traîne, les positions intermédiaires sautent

const arrondi = (v) => Math.round(v * 1000) / 1000;

export class Pointeur {
  // genre : "plan" ou "carte" ; surPortee({ ici, ecrans }) quand le serveur répond, ou null quand la liaison tombe.
  constructor(genre, id, surPortee) {
    this.genre = genre;
    this.id = id;
    this.surPortee = surPortee || (() => {});
    this.ws = null;
    this.ferme = false;
    this.actif = false; // un point est (peut-être) à la TV
    this.attente = null; // la prochaine position à envoyer
    this.attenteRegle = null; // la prochaine règle (outil Mesurer) à envoyer
    this.regleActive = false; // une règle est (peut-être) montrée aux joueurs
    this.enSuspensRegle = null;
    this.minuterie = 0;
    this.enSuspens = null; // ce qui partira à l'ouverture de la liaison
    this.coupee = 0; // heure de la dernière coupure
    // Onglet caché, fenêtre quittée : le point s'efface de la TV.
    this.quitter = () => this.effacer();
    this.cacher = () => {
      if (document.visibilityState === "hidden") this.effacer();
    };
    window.addEventListener("blur", this.quitter);
    document.addEventListener("visibilitychange", this.cacher);
  }

  // Le pointeur est là, en coordonnées du plan (cases) ou de la carte.
  bouger(x, y) {
    if (this.ferme || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.actif = true;
    this.attente = { [this.genre]: this.id, x: arrondi(x), y: arrondi(y) };
    if (!this.minuterie) this.cadence();
  }

  // La règle de l'outil Mesurer, montrée aux joueurs sur la page Table de leur coin (jamais à la TV) : a et b en coordonnées
  // du plan (cases) ou de la carte, texte : la mesure, telle que l'éditeur l'écrit.
  regle([x0, y0], [x1, y1], texte) {
    if (this.ferme || ![x0, y0, x1, y1].every(Number.isFinite)) return;
    this.regleActive = true;
    this.attenteRegle = { [this.genre]: this.id, regle: [x0, y0, x1, y1].map(arrondi), texte: String(texte || "").slice(0, 40) };
    if (!this.minuterie) this.cadence();
  }

  // La règle quitte la page des joueurs : autre outil, éditeur fermé.
  effacerRegle() {
    this.attenteRegle = null;
    this.enSuspensRegle = null;
    if (!this.regleActive) return;
    this.regleActive = false;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send('{"regle":false}');
  }

  // Un clic (ou un toucher bref) : l'onde part tout de suite, avec la position.
  onde(x, y) {
    if (this.ferme || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.actif = true;
    this.attente = null;
    this.envoyer({ [this.genre]: this.id, x: arrondi(x), y: arrondi(y), onde: true });
  }

  // Le point quitte la TV (fondu bref) : Échap, souris sortie du plan, autre outil, page quittée.
  effacer() {
    this.attente = null;
    if (!this.actif) return;
    this.actif = false;
    // Liaison fermée : le serveur a déjà effacé le point en la perdant.
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send('{"efface":true}');
  }

  // L'éditeur vient de lire la table : le serveur redira la portée au prochain mouvement, même s'il la croit inchangée
  // (la TV a pu partir puis revenir entre-temps). Liaison fermée ou en cours d'ouverture : la prochaine la dira d'elle-même.
  relire() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send('{"relire":true}');
  }

  // L'éditeur se ferme : le point s'efface, la liaison aussi, sans nouvel essai.
  fermer() {
    this.effacer();
    this.effacerRegle();
    this.ferme = true;
    clearTimeout(this.minuterie);
    window.removeEventListener("blur", this.quitter);
    document.removeEventListener("visibilitychange", this.cacher);
    if (this.ws) this.ws.close();
    this.ws = null;
  }

  // Une position tout de suite, puis au plus une toutes les PAS millisecondes : la dernière part toujours.
  cadence() {
    this.minuterie = 0;
    if ((!this.attente && !this.attenteRegle) || this.ferme) return;
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN && ws.bufferedAmount > ENGORGE) {
      this.minuterie = setTimeout(() => this.cadence(), PAS);
      return;
    }
    const m = this.attente;
    const r = this.attenteRegle;
    this.attente = null;
    this.attenteRegle = null;
    if (m) this.envoyer(m);
    if (r) this.envoyerRegle(r);
    this.minuterie = setTimeout(() => this.cadence(), PAS);
  }

  envoyer(m) {
    const ws = this.ouvrir();
    // Liaison coupée il y a peu : rien ne part, la position suivante retentera.
    if (!ws) return;
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    // Liaison en cours d'ouverture : la dernière position partira à l'ouverture, avec l'onde demandée entre-temps.
    else this.enSuspens = this.enSuspens && this.enSuspens.onde ? { ...m, onde: true } : m;
  }

  envoyerRegle(m) {
    const ws = this.ouvrir();
    if (!ws) return;
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    else this.enSuspensRegle = m;
  }

  ouvrir() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return this.ws;
    if (Date.now() - this.coupee < RELANCE) return null;
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/pointeur`);
    this.ws = ws;
    ws.onopen = () => {
      const m = this.enSuspens;
      this.enSuspens = null;
      if (m && this.actif) ws.send(JSON.stringify(m));
      const r = this.enSuspensRegle;
      this.enSuspensRegle = null;
      if (r && this.regleActive) ws.send(JSON.stringify(r));
    };
    ws.onmessage = (ev) => {
      let msg = null;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg && msg.type === "portee") this.surPortee({ ici: !!msg.ici, ecrans: +msg.ecrans || 0 });
    };
    // Le serveur efface de lui-même le point d'une liaison perdue ; elle se rouvre au mouvement suivant.
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.enSuspens = null;
      this.enSuspensRegle = null;
      this.regleActive = false;
      this.coupee = Date.now();
      if (!this.ferme) this.surPortee(null);
    };
    return ws;
  }
}

// Ce que l'outil dit de la TV. portee : la réponse du serveur ({ ici, ecrans }), null si la liaison est coupée, undefined
// si rien n'est venu depuis la dernière lecture de la table ; ici, ecrans : ce que disait alors la table (la TV montrait
// ce plan, ou cette carte ? combien d'écrans de table ouverts ? null : la table n'a pas répondu).
export function textePortee(portee, ici, ecrans, quoi) {
  if (portee === null) return { etat: "coupe", texte: "Liaison avec la TV coupée : elle reprend au prochain mouvement." };
  if (!portee && ecrans === null) return { etat: "coupe", texte: "La table ne répond pas : rien ne dit que la TV verra le point." };
  const p = portee || { ici, ecrans };
  if (p.ici === undefined) return { etat: "", texte: "" };
  if (!p.ici) return { etat: "ailleurs", texte: "La TV montre autre chose : le point n'y paraît pas. « Montrer à la TV » d'abord." };
  if (p.ecrans === 0) return { etat: "ailleurs", texte: "Aucun écran de table n'est ouvert : personne ne voit le point." };
  if (!portee) return { etat: "ici", texte: `La TV montre ${quoi} : les joueurs verront le point.` };
  return { etat: "ici", texte: `Les joueurs voient le point (${p.ecrans} écran${p.ecrans > 1 ? "s" : ""}).` };
}

// Le panneau de l'outil, le même pour les plans et les cartes.
export function panneauPointeur(genre, t) {
  return `
    <h2>Pointeur</h2>
    <p class="aide">Pour montrer aux joueurs ce dont vous parlez : un point doré suit la souris sur la TV, et un clic y fait une onde. Au doigt, glissez pour pointer, touchez pour l'onde. Rien ne s'enregistre, rien ne se révèle.</p>
    <p class="aide">Échap, sortir ${genre === "plan" ? "du plan" : "de la carte"} ou changer d'outil l'efface ; immobile, il s'estompe au bout de quelques secondes.</p>
    <p class="portee-pointeur" data-etat="${t.etat}" aria-live="polite">${echapper(t.texte)}</p>`;
}
