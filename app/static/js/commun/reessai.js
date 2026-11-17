// Nouvel essai d'un enregistrement que le serveur n'a pas reçu (serveur arrêté ou qui redémarre, réseau coupé) : à 3 s,
// à 10 s, puis toutes les 30 s, et tout de suite quand le réseau revient ou qu'on revient sur l'onglet. Jamais après un
// conflit (409) ni un autre refus : renvoyer la même chose n'y changerait rien, et après un conflit le renvoi
// écraserait l'autre écran.

import { toast } from "../api.js";

const PAUSES = [3000, 10000, 30000];

// Les séries en cours, de toutes les pages (une page quittée garde la sienne : ce qu'elle n'a pas pu envoyer n'est
// que dans cet onglet) : tant qu'il en reste, l'onglet ne se ferme pas sans prévenir.
const series = new Set();

// Le serveur n'a pas répondu : requête impossible (0), ou passerelle sans serveur derrière (502 à 504, et les codes de
// Cloudflare quand le serveur ne répond pas).
export function injoignable(err) {
  const s = err?.status;
  return s === 0 || [502, 503, 504, 520, 521, 522, 523, 524, 530].includes(s);
}

// L'erreur dite au MJ : une passerelle ne répond que par son code, qui ne lui dirait rien.
export function raison(err) {
  return injoignable(err) && err.status ? "le serveur ne répond pas" : String(err?.message || err);
}

export function reessaisEnAttente() {
  return series.size > 0;
}

// Tout de suite, pour toutes les pages (onglet qui se ferme, page qui en remplace une autre) : la promesse se résout
// quand ces essais ont abouti ou échoué.
export function relancerTout() {
  return Promise.all([...series].map((r) => r.maintenant()));
}

export class Reessai {
  // essayer : renvoie ce qui reste à enregistrer et rend la promesse de cet envoi ; il appelle lui-même echec(),
  // reussite() ou bilan(). surChange : redessine l'état affiché (une fois par seconde pendant l'attente).
  constructor(essayer, surChange = () => {}) {
    this.essayer = essayer;
    this.surChange = surChange;
    this.rang = 0; // échecs d'affilée de la série en cours (0 : pas de série)
    this.echeance = 0; // heure du prochain essai prévu (0 : aucun de prévu, ou un essai part)
    this.enCours = null;
    this.annonce = false;
    this.minuterie = 0;
    this.horloge = 0;
    this.reveil = () => {
      if (document.visibilityState !== "hidden") this.maintenant();
    };
  }

  get actif() {
    return this.rang > 0;
  }

  // Un envoi a échoué : rend vrai si un nouvel essai est prévu. Un refus du serveur arrête la série.
  echec(err) {
    if (!injoignable(err)) {
      this.arreter();
      return false;
    }
    if (!this.echeance) {
      const pause = PAUSES[Math.min(this.rang, PAUSES.length - 1)];
      this.rang++;
      this.echeance = Date.now() + pause;
      clearTimeout(this.minuterie);
      this.minuterie = setTimeout(() => this.maintenant(), pause);
    }
    this.suivre(true);
    return true;
  }

  // Un passage qui envoie plusieurs fiches : une seule restée sans réponse suffit à prévoir un nouvel essai.
  bilan(erreurs) {
    const coupure = erreurs.find(injoignable);
    if (coupure) return this.echec(coupure);
    if (erreurs.length) this.arreter();
    else this.reussite();
    return false;
  }

  // Le serveur répond : les autres séries (autre fiche, page quittée) n'attendent plus leur heure. Le retour n'est dit
  // qu'une fois tout reparti.
  reussite() {
    const annonce = this.annonce;
    this.arreter();
    for (const r of series) r.maintenant();
    if (annonce && ![...series].some((r) => r.annonce)) toast("Enregistré : le serveur répond de nouveau.");
  }

  // Le toast d'un échec. Une coupure n'est annoncée qu'une fois pour tout l'onglet : l'état affiché dit la suite.
  signaler(err, quoi) {
    if (!injoignable(err)) return toast(`${quoi} : ${raison(err)}`, "erreur");
    if (this.annonce) return;
    const dejaDite = [...series].some((r) => r !== this && r.annonce);
    this.annonce = true;
    if (!dejaDite) toast(`${quoi} : ${raison(err)}. Nouvel essai automatique dans quelques secondes.`, "erreur");
  }

  // Le prochain essai part tout de suite (sans série en cours, rien ne part).
  maintenant() {
    if (!this.rang) return Promise.resolve();
    if (this.enCours) return this.enCours;
    clearTimeout(this.minuterie);
    this.echeance = 0;
    this.surChange();
    this.enCours = Promise.resolve()
      .then(() => this.essayer())
      .catch(() => {})
      .then(() => {
        this.enCours = null;
        // Rien de nouveau de prévu : tout est parti, ou il ne restait plus rien à envoyer.
        if (!this.echeance) this.arreter();
        this.surChange();
      });
    return this.enCours;
  }

  arreter() {
    clearTimeout(this.minuterie);
    this.rang = 0;
    this.echeance = 0;
    this.annonce = false;
    this.suivre(false);
  }

  // L'état affiché pendant une série (« enregistrement » ou « erreur »), sinon null : l'écran garde son libellé. court :
  // pour une barre serrée (éditeurs, colonne du scénario), la phrase entière passe alors en bulle.
  libelle(etat, court = false) {
    if (!this.rang || (etat !== "enregistrement" && etat !== "erreur")) return null;
    if (etat === "enregistrement" || !this.echeance) return "Nouvel essai…";
    const s = Math.max(1, Math.ceil((this.echeance - Date.now()) / 1000));
    return court ? `Nouvel essai dans ${s} s` : `Non enregistré, nouvel essai dans ${s} s`;
  }

  // Pendant une série : écoute du réseau et de l'onglet, et compte à rebours de l'état affiché.
  suivre(oui) {
    if (oui === series.has(this)) return;
    const m = oui ? "addEventListener" : "removeEventListener";
    window[m]("online", this.reveil);
    window[m]("focus", this.reveil);
    document[m]("visibilitychange", this.reveil);
    clearInterval(this.horloge);
    if (oui) {
      series.add(this);
      this.horloge = setInterval(() => this.surChange(), 1000);
    } else series.delete(this);
  }
}
