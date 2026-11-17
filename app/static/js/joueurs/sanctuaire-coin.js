// Le sanctuaire dans le coin des joueurs : la section du carnet (sanctuaire-vue.js) avec les gestes du joueur.
// Il verse de l'or de la bourse de son héros dans la cagnotte d'un chantier, ou propose d'ouvrir un des projets que le
// MJ montre ; les deux partent par la file des demandes (POST /api/demandes) et attendent le MJ. La section se relit
// (GET /api/sanctuaire) dès que le flux le dit : quand le MJ accepte, la cagnotte monte sans recharger la page. L'or
// proposé compte comme engagé tant que le MJ n'a pas tranché. Tout texte passe par echapper.

import { echapper as e } from "../api.js";
import { demander } from "./carnet-vue.js";
import { ecouterFlux } from "./flux.js";
import { htmlSanctuaire, lireSection, pieces, po, reste } from "./sanctuaire-vue.js";

const MOT_MAX = 300;
const OUVERTS = ["a-appliquer", "en-attente"];

export class MonSanctuaire {
  constructor() {
    this.zone = null;
    this.etat = null; // la dernière réponse de GET /api/sanctuaire
    this.ouvert = null; // { genre : versement | projet, id : le jeton du chantier ou du projet }
    this.envoi = false;
    this.message = "";
    this.brouillons = {}; // ce qui est tapé et pas encore envoyé : un redessin ne le perd pas
    this.enCours = null;
    this.encore = false;
    this.centre = false;
    for (const sujet of ["carnet", "demandes", "commandes", "pause"]) ecouterFlux(sujet, () => this.relire());
  }

  // Posé dans la section que carnet-vue.js a dessinée (recréée à chaque affichage du carnet).
  monter(zone) {
    if (!zone) return;
    this.zone = zone;
    this.centre = false;
    zone.addEventListener("click", (ev) => this.clic(ev));
    zone.addEventListener("submit", (ev) => this.soumettre(ev));
    zone.addEventListener("input", (ev) => this.saisie(ev));
    if (this.etat) this.dessiner();
    else this.centrer();
    this.relire();
  }

  relire() {
    if (!this.zone?.isConnected) return Promise.resolve();
    if (this.enCours) {
      this.encore = true;
      return this.enCours;
    }
    this.enCours = (async () => {
      try {
        const r = await demander("GET", "/api/sanctuaire");
        if (this.zone?.isConnected) {
          this.etat = r;
          this.dessiner();
        }
      } catch {
        // le carnet dit déjà si la session ne vaut plus
      }
    })().finally(() => {
      this.enCours = null;
      if (this.encore) {
        this.encore = false;
        this.relire();
      }
    });
    return this.enCours;
  }

  bloque() {
    return this.envoi || Boolean(this.etat?.pause);
  }

  miennes(genre, id) {
    return (this.etat?.demandes || []).filter((d) => d.genre === genre && OUVERTS.includes(d.statut)
      && (genre === "versement" ? d.corps?.batiment === id : d.corps?.type === id));
  }

  // ------------------------------------------------------------ dessin

  dessiner() {
    const z = this.zone;
    const r = this.etat;
    if (!z?.isConnected || !r) return;
    if (!r.ouvert || !r.visible) {
      // Le MJ l'a caché depuis : la section le dit, sans rien d'autre.
      z.innerHTML = '<p class="vide">Le sanctuaire n\'est plus montré aux joueurs pour l\'instant.</p>';
      return;
    }
    const champ = z.querySelector("input:focus, textarea:focus");
    const garde = champ ? { nom: champ.name, debut: champ.selectionStart } : null;
    const defile = z.querySelector(".village-defile");
    const gauche = defile ? defile.scrollLeft : null;
    z.innerHTML = htmlSanctuaire(r.elements, this);
    for (const x of z.querySelectorAll("input[name], textarea[name]")) if (x.name in this.brouillons) x.value = this.brouillons[x.name];
    if (gauche !== null && this.centre) z.querySelector(".village-defile").scrollLeft = gauche;
    else this.centrer();
    if (garde) {
      const neuf = z.querySelector(`[name="${CSS.escape(garde.nom)}"]`);
      if (neuf) {
        neuf.focus();
        try {
          neuf.setSelectionRange(garde.debut, garde.debut);
        } catch {
          // un champ numérique n'a pas de curseur
        }
      }
    }
  }

  // Le village glisse sur un téléphone : il s'ouvre sur l'auberge, au milieu.
  centrer() {
    const d = this.zone?.querySelector(".village-defile");
    if (!d) return;
    requestAnimationFrame(() => {
      if (d.scrollWidth > d.clientWidth) d.scrollLeft = (d.scrollWidth - d.clientWidth) / 2;
      this.centre = true;
    });
  }

  // La bourse du héros, avec ce qui est engagé (commandes, dons, versements en attente).
  bourse() {
    const r = this.etat;
    const refus = `<p class="refus-coin refus-sanctuaire" role="alert"${this.message ? "" : " hidden"}>${e(this.message)}</p>`;
    if (!r.heros) return `<div class="bourse-sanctuaire"><p class="vide">Votre héros versera dans les cagnottes une fois accueilli à la tablée par le MJ.</p>${refus}</div>`;
    const o = r.or || {};
    const engage = [o.versements ? `${po(o.versements)} pour le sanctuaire` : "", o.commandes ? `${po(o.commandes)} en commandes` : "", o.dons ? `${po(o.dons)} en dons d'or` : ""].filter(Boolean);
    return `
      <div class="bourse-sanctuaire">
        <p class="bourse-coin"><span class="pieces">${e(o.bourse ?? 0)}</span> ${(o.bourse ?? 0) > 1 ? "pièces" : "pièce"} d'or dans la bourse de ${e(String(r.heros.nom || "").split(/[\s,]+/)[0] || "votre héros")}</p>
        ${o.total ? `<p class="engage-sac">Engagé, en attente du MJ : ${e(engage.join(", "))}. <b>Disponible : ${e(pieces(o.disponible ?? 0))}.</b></p>` : ""}
        ${r.pause ? '<p class="pause-sac">Le coin est en pause : le sanctuaire se lit, rien ne part pour l\'instant.</p>' : ""}
        ${refus}
      </div>`;
  }

  // Sous chaque chantier : ses versements en attente, puis « Verser » ou le petit formulaire.
  gestes(b) {
    const r = this.etat;
    const attente = this.miennes("versement", b.id);
    const manque = reste(b);
    const dispo = r.or?.disponible ?? 0;
    const enAttente = attente.length ? `<ul class="attente-chantier">${attente.map((d) => `
      <li><span>Vous proposez ${e(po(d.corps?.or || 0))} : ${e(d.statut_dit)}</span><button type="button" class="secondaire" data-retirer="${e(d.id)}"${r.pause ? " disabled" : ""}>Retirer</button></li>`).join("")}</ul>` : "";
    if (!r.heros || manque === null || manque <= 0) return enAttente;
    const o = this.ouvert;
    if (o?.genre === "versement" && o.id === b.id) {
      const max = Math.min(dispo, manque);
      return `${enAttente}
        <form class="verser-chantier" data-form="versement" data-id="${e(b.id)}">
          <label>Combien de pièces ?<input type="number" name="or-${e(b.id)}" inputmode="numeric" min="1" max="${e(max)}" step="1" required></label>
          <p class="aide-sac">Il manque ${e(po(manque))} ; vous avez ${e(pieces(dispo))} disponible${dispo > 1 ? "s" : ""}. Votre MJ valide chaque versement.</p>
          <div class="actions-sac">
            <button type="button" class="secondaire" data-laisser>Laisser</button>
            <button type="submit" class="envoyer-coin"${this.bloque() ? " disabled" : ""}>Proposer au MJ</button>
          </div>
        </form>`;
    }
    return `${enAttente}<p class="gestes-chantier"><button type="button" class="secondaire" data-verser="${e(b.id)}"${this.bloque() || !dispo ? " disabled" : ""}>Verser de l'or</button>${dispo ? "" : '<span class="aide-sac">Rien de disponible dans la bourse.</span>'}</p>`;
  }

  gestesProjet(t) {
    const r = this.etat;
    const attente = this.miennes("projet", t.id);
    if (attente.length) {
      return `<ul class="attente-chantier">${attente.map((d) => `
        <li><span>Vous l'avez proposé : ${e(d.statut_dit)}</span><button type="button" class="secondaire" data-retirer="${e(d.id)}"${r.pause ? " disabled" : ""}>Retirer</button></li>`).join("")}</ul>`;
    }
    const o = this.ouvert;
    if (o?.genre === "projet" && o.id === t.id) {
      return `
        <form class="proposer-projet" data-form="projet" data-id="${e(t.id)}">
          <label>Un mot pour le MJ <small>facultatif</small><textarea name="mot-${e(t.id)}" rows="2" maxlength="${e(r.mot_max || MOT_MAX)}" placeholder="Pourquoi ce bâtiment, où vous le verriez…"></textarea></label>
          <div class="actions-sac">
            <button type="button" class="secondaire" data-laisser>Laisser</button>
            <button type="submit" class="envoyer-coin"${this.bloque() ? " disabled" : ""}>Proposer au MJ</button>
          </div>
        </form>`;
    }
    return `<p class="gestes-chantier"><button type="button" class="secondaire" data-proposer="${e(t.id)}"${this.bloque() ? " disabled" : ""}>Proposer ce projet</button></p>`;
  }

  // Les dernières réponses du MJ : ce qu'il a accepté, refusé, et son mot.
  historique() {
    const liste = (this.etat?.demandes || []).filter((d) => !OUVERTS.includes(d.statut));
    if (!liste.length) return "";
    const { batiments, projets } = lireSection(this.etat.elements);
    const quoi = (d) => {
      // Un projet accepté n'est plus parmi les projets : sa réponse dit alors quel chantier s'est ouvert.
      if (d.genre === "projet") return projets.find((p) => p.id === d.corps?.type)?.nom || "Un projet pour le sanctuaire";
      return `${po(d.corps?.or || 0)} pour ${batiments.find((b) => b.id === d.corps?.batiment)?.nom || "un chantier"}`;
    };
    return `<div class="gestes-sac historique-sanctuaire"><h5>Vos dernières demandes au sanctuaire</h5><ol>${liste.map((d) => `
      <li class="geste-sac statut-${e(d.statut)}">
        <p><span class="quoi">${e(quoi(d))}</span><span class="statut">${e(d.statut_dit)}</span></p>
        ${d.resultat ? `<p class="resultat-demande">${e(d.resultat)}</p>` : ""}
        ${d.mot ? `<p class="mot-du-mj"><span class="lbl">Votre MJ</span>${e(d.mot)}</p>` : ""}
      </li>`).join("")}</ol></div>`;
  }

  // ------------------------------------------------------------ gestes

  dire(message) {
    this.message = message || "";
    const p = this.zone?.querySelector(".refus-sanctuaire");
    if (p) {
      p.textContent = this.message;
      p.hidden = !this.message;
      if (this.message) p.scrollIntoView({ block: "nearest" });
    }
  }

  async envoyer(genre, corps) {
    if (this.bloque()) return false;
    this.envoi = true;
    this.dire("");
    let ok = false;
    try {
      const d = await demander("POST", "/api/demandes", { genre, corps });
      // En attente du MJ : elle se voit tout de suite sous son chantier.
      if (this.etat) this.etat.demandes = [d, ...(this.etat.demandes || [])];
      this.ouvert = null;
      ok = true;
    } catch (err) {
      this.dire(err.status === 423 ? err.message : `Rien n'est parti : ${err.message}`);
    } finally {
      this.envoi = false;
      this.dessiner();
      if (!ok) this.dire(this.message);
      this.relire();
    }
    return ok;
  }

  clic(ev) {
    const village = ev.target.closest(".village-coin [data-batiment]");
    if (village) {
      const fiche = this.zone.querySelector(`#chantier-${CSS.escape(village.dataset.batiment)}`);
      fiche?.scrollIntoView({ behavior: "smooth", block: "start" });
      fiche?.classList.add("montre");
      setTimeout(() => fiche?.classList.remove("montre"), 1600);
      return;
    }
    const b = ev.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.retirer) return this.retirer(b.dataset.retirer);
    if (b.dataset.verser || b.dataset.proposer) {
      this.ouvert = b.dataset.verser ? { genre: "versement", id: b.dataset.verser } : { genre: "projet", id: b.dataset.proposer };
      this.dire("");
      this.dessiner();
      this.zone.querySelector(`[data-form="${this.ouvert.genre}"] input, [data-form="${this.ouvert.genre}"] textarea`)?.focus();
      return;
    }
    if (b.dataset.laisser !== undefined) {
      this.ouvert = null;
      this.dire("");
      this.dessiner();
    }
  }

  saisie(ev) {
    if (ev.target.name) this.brouillons[ev.target.name] = ev.target.value;
  }

  async soumettre(ev) {
    const form = ev.target.closest("[data-form]");
    if (!form) return;
    ev.preventDefault();
    const id = form.dataset.id;
    if (form.dataset.form === "versement") {
      const b = lireSection(this.etat?.elements).batiments.find((x) => x.id === id);
      const champ = form.querySelector("input");
      const montant = Math.round(Number(champ.value));
      const dispo = this.etat?.or?.disponible ?? 0;
      const manque = reste(b);
      if (!Number.isFinite(montant) || montant < 1) return this.dire("Combien de pièces ? Un nombre entier, au moins une.");
      if (manque !== null && montant > manque) return this.dire(`Il ne manque que ${po(manque)} à ce niveau.`);
      if (montant > dispo) return this.dire(`Vous avez ${pieces(dispo)} disponible${dispo > 1 ? "s" : ""}.`);
      if (await this.envoyer("versement", { batiment: id, or: montant })) delete this.brouillons[champ.name];
      return;
    }
    if (form.dataset.form === "projet") {
      const champ = form.querySelector("textarea");
      const mot = champ.value.trim();
      if (await this.envoyer("projet", { type: id, mot })) delete this.brouillons[champ.name];
    }
  }

  async retirer(id) {
    try {
      await demander("DELETE", `/api/demandes/${encodeURIComponent(id)}`);
      this.dire("");
    } catch (err) {
      this.dire(`Rien de retiré : ${err.message}`);
    }
    this.relire();
  }
}
