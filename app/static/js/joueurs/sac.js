// Le sac de « Mon héros », dans le carnet du coin des joueurs : le joueur ajoute, renomme et retire une ligne
// d'équipement ou un de ses trois objets personnels, donne une ligne à un compagnon, propose de l'or (le MJ le valide).
// Chaque geste part par la file des demandes (POST /api/demandes) ; l'atelier le rejoue sur le sac du moment et republie
// la fiche, que la section relit (GET /api/sac) dès que le flux le dit. Un geste en route se voit tout de suite
// (avecGeste) ; refusé, il disparaît avec sa phrase. Les lignes se désignent par ce que le joueur lit (leur rang dans la
// fiche publiée et leur texte), comme corpsDuSac le fait pour « La compagnie » de l'atelier. L'or ne se touche pas ici :
// il passe par l'échoppe, ou par le MJ. Tout texte passe par echapper.
// Les quantités : une ligne d'équipement « Potion de soins ×3 » montre son nom et, à droite, « − 3 + ». Un de
// plus ou un de moins part comme un geste « quantite » ; au dernier, la page demande avant de retirer la ligne. Ajouter un
// objet déjà là grossit sa ligne. Donner une ligne comptée : un seul, ou tout. Les objets personnels ne se comptent pas.

import { echapper as e } from "../api.js";
import { avecGeste, cleNom, corpsDuSac, douteuse, ligneDe, listeDuSac, quantiteDe } from "../aventuriers/etat.js";
import { demander } from "./carnet-vue.js";
import { ecouterFlux } from "./flux.js";

const LIGNE_MAX = 300;
const NOMS = { equipement: "Équipement", objets: "Objets personnels" };
const pieces = (n) => `${n} ${n > 1 ? "pièces" : "pièce"} d'or`;
// Des guillemets qui ne se séparent pas de leur texte en fin de ligne (espaces insécables).
const cite = (t) => `«\u00a0${t}\u00a0»`;
const prenom = (nom) => String(nom || "").split(/[\s,]+/)[0] || "un compagnon";

// Le nom d'une ligne tel qu'il se compare, sans sa quantité : un geste en route se reconnaît à lui, quel que soit le compte.
const nomCle = (t) => cleNom(quantiteDe(t || "")[0]);

// La demande d'un geste en route, telle que corpsDuSac et avecGeste la lisent.
function gesteDe(d) {
  const c = d.corps || {};
  if (d.genre === "don-objet") {
    // Quelques exemplaires seulement : la ligne reste, son compte baisse.
    if (Number.isInteger(c.nombre) && c.nombre < quantiteDe(c.avant)[1]) return { genre: "quantite", liste: c.liste, rang: c.rang, avant: c.avant, de: -c.nombre, strict: true };
    return { genre: "retirer", liste: c.liste, rang: c.rang, avant: c.avant };
  }
  if (d.genre !== "sac") return null;
  // strict : si la fiche relue porte déjà ce geste (elle est republiée avant que son statut ne change), il ne se recompte pas.
  if (c.geste === "quantite") return { genre: "quantite", liste: c.liste, rang: c.rang, avant: c.avant, de: c.de, strict: true };
  if (c.geste === "ajouter") return { genre: "ajouter", liste: c.liste, texte: c.ligne };
  if (c.geste === "changer") return { genre: "changer", liste: c.liste, rang: c.rang, avant: c.avant, texte: c.ligne };
  return { genre: "retirer", liste: c.liste, rang: c.rang, avant: c.avant };
}

export class MonSac {
  constructor() {
    this.zone = null;
    this.etat = null; // la dernière réponse de GET /api/sac
    this.ouverte = null; // { liste, rang, avant, mode : menu | renommer | donner | retirer }
    this.or = null; // le don d'or en cours de saisie : { ref, montant }
    this.envoi = false;
    this.message = "";
    this.brouillons = {}; // ce qui est tapé et pas encore envoyé, par champ : un redessin ne le perd pas
    this.encore = false;
    this.enCours = null;
    for (const sujet of ["carnet", "demandes", "commandes", "pause"]) ecouterFlux(sujet, () => this.relire());
  }

  // Pose le sac dans la section du carnet que carnet-vue.js a dessinée (elle est recréée à chaque affichage du carnet).
  monter(zone) {
    if (!zone) return;
    this.zone = zone;
    zone.classList.add("sac-joueur");
    zone.addEventListener("click", (ev) => this.clic(ev));
    zone.addEventListener("submit", (ev) => this.soumettre(ev));
    zone.addEventListener("input", (ev) => this.saisie(ev));
    if (this.etat) this.dessiner();
    this.relire();
  }

  // Une lecture à la fois ; une nouvelle venue pendant ce temps en relance une.
  relire() {
    if (!this.zone?.isConnected) return Promise.resolve();
    if (this.enCours) {
      this.encore = true;
      return this.enCours;
    }
    this.enCours = (async () => {
      try {
        const r = await demander("GET", "/api/sac");
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

  // La fiche publiée, et par-dessus les gestes encore en route (ce que le joueur vient de faire se voit tout de suite).
  fiche() {
    const h = this.etat?.heros;
    if (!h) return null;
    return (this.etat.demandes || []).filter((d) => d.statut === "a-appliquer").reverse()
      .map(gesteDe).filter(Boolean).reduce((f, g) => avecGeste(f, g), h);
  }

  bloque() {
    return this.envoi || Boolean(this.etat?.pause);
  }

  // ------------------------------------------------------------ dessin

  dessiner() {
    const z = this.zone;
    const r = this.etat;
    if (!z?.isConnected || !r) return;
    if (!r.ouvert || !r.heros) return; // carnet fermé ou héros absent : la page le dit déjà
    // La saisie en cours (un nom, un montant) reste telle quelle quand la section se redessine, curseur compris.
    const champ = z.querySelector("input:focus");
    const garde = champ ? { nom: champ.name, debut: champ.selectionStart } : null;
    const f = this.fiche();
    z.innerHTML = `
      <h4>Le sac</h4>
      ${this.htmlBourse(r)}
      ${r.pause ? '<p class="pause-sac">Le coin est en pause : votre sac se relit, il ne change pas pour l\'instant.</p>' : ""}
      <div class="listes-sac">
        ${this.htmlListe(f, "equipement")}
        ${this.htmlListe(f, "objets")}
      </div>
      <p class="refus-coin refus-sac" role="alert"${this.message ? "" : " hidden"}>${e(this.message)}</p>
      ${this.htmlGestes(r)}`;
    for (const x of z.querySelectorAll("input[name]")) if (x.name in this.brouillons) x.value = this.brouillons[x.name];
    if (garde) {
      const neuf = z.querySelector(`input[name="${CSS.escape(garde.nom)}"]`);
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

  htmlBourse(r) {
    const o = r.or || {};
    const engage = [o.commandes ? `${o.commandes} po en commandes à l'échoppe` : "", o.dons ? `${o.dons} po en dons d'or` : "",
      o.versements ? `${o.versements} po pour le sanctuaire` : ""].filter(Boolean);
    const compagnons = r.compagnons || [];
    const don = this.or;
    return `
      <div class="bourse-sac">
        <p class="bourse-coin"><span class="pieces">${e(o.bourse ?? 0)}</span> ${(o.bourse ?? 0) > 1 ? "pièces" : "pièce"} d'or</p>
        ${o.total ? `<p class="engage-sac">Engagé, en attente du MJ : ${e(engage.join(", "))}. <b>Disponible : ${e(pieces(o.disponible ?? 0))}.</b></p>` : ""}
        ${compagnons.length && !don ? `<button type="button" class="secondaire" data-sac="or"${this.bloque() || !o.disponible ? " disabled" : ""}>Donner de l'or</button>
          ${this.bloque() ? '<p class="aide-sac">Le coin est en pause : rien ne part pour l\'instant.</p>' : !o.disponible ? '<p class="aide-sac">Rien à donner pour l\'instant : votre bourse est vide (ou tout est déjà engagé).</p>' : ""}` : ""}
      </div>
      ${don ? `
      <form class="don-or-sac" data-form="or">
        <p class="aide-sac">Votre MJ valide chaque don d'or. Disponible : ${e(pieces(o.disponible ?? 0))}.</p>
        <fieldset class="choix-compagnon"><legend>À qui ?</legend>
          ${compagnons.map((c) => `<button type="button" class="compagnon-sac" data-or-a="${e(c.ref)}" aria-pressed="${don.ref === c.ref}">${e(prenom(c.nom))}</button>`).join("")}
        </fieldset>
        <label class="montant-sac">Combien de pièces ?<input type="number" name="montant" inputmode="numeric" min="1" max="${e(o.disponible ?? 0)}" step="1" required></label>
        <div class="actions-sac">
          <button type="button" class="secondaire" data-sac="laisser-or">Laisser</button>
          <button type="submit" class="envoyer-coin"${this.bloque() || !don.ref ? " disabled" : ""}>Proposer au MJ</button>
        </div>
      </form>` : ""}`;
  }

  htmlListe(f, cle) {
    const lignes = listeDuSac(f, cle);
    const pleines = lignes.map((t, rang) => ({ t, rang })).filter((x) => x.t.trim());
    const objetsPris = cle === "objets" && pleines.length >= (this.etat.objets || 3);
    const vide = cle === "objets" ? "Aucun objet personnel." : "Rien pour l'instant.";
    return `
      <div class="liste-sac" data-liste="${cle}">
        <h4>${e(NOMS[cle])}${cle === "objets" ? ' <small>trois au plus</small>' : ""}</h4>
        ${pleines.length ? `<ul>${pleines.map((x) => this.htmlLigne(cle, x.t, x.rang)).join("")}</ul>` : `<p class="vide">${e(vide)}</p>`}
        ${objetsPris ? "" : `
        <form class="ajouter-sac" data-form="ajouter" data-liste="${cle}">
          <label class="sr-sac" for="ajouter-${cle}">Ajouter ${cle === "objets" ? "un objet personnel" : "à l'équipement"}</label>
          <input id="ajouter-${cle}" name="ajouter-${cle}" type="text" maxlength="${LIGNE_MAX}" autocomplete="off" enterkeyhint="done"
            placeholder="${cle === "objets" ? "Un objet personnel…" : "Ajouter à l'équipement…"}"${this.bloque() ? " disabled" : ""}>
          <button type="submit" class="secondaire"${this.bloque() ? " disabled" : ""}>Ajouter</button>
        </form>`}
      </div>`;
  }

  // Une ligne, et ce qu'on peut en faire une fois touchée : la renommer, la donner, la retirer.
  htmlLigne(cle, texte, rang) {
    const o = this.ouverte;
    const ouverte = o && o.liste === cle && o.rang === rang && o.avant === texte;
    const cleLigne = nomCle(texte);
    const enRoute = (this.etat.demandes || []).some((d) => d.statut === "a-appliquer" && (gesteDe(d)?.liste === cle)
      && ((d.corps?.ligne && nomCle(d.corps.ligne) === cleLigne) || (d.corps?.avant && nomCle(d.corps.avant) === cleLigne)));
    const id = `ligne-${cle}-${rang}`;
    // Seul l'équipement se compte, et seulement une ligne dont la quantité se lit sans risque.
    const compte = cle === "equipement" && !douteuse(texte);
    const [objet, n] = compte ? quantiteDe(texte) : [texte, 1];
    let suite = "";
    if (ouverte && o.mode === "menu") {
      suite = `<div class="actions-ligne" role="group" aria-label="${e(texte)}">
        <button type="button" class="secondaire" data-sac="renommer">Renommer</button>
        ${(this.etat.compagnons || []).length ? '<button type="button" class="secondaire" data-sac="donner">Donner à…</button>' : ""}
        <button type="button" class="secondaire" data-sac="retirer">Retirer</button>
      </div>`;
    } else if (ouverte && o.mode === "renommer") {
      suite = `<form class="renommer-sac" data-form="renommer">
        <label class="sr-sac" for="renommer-${id}">Nouveau nom</label>
        <input id="renommer-${id}" name="renommer-${id}" type="text" maxlength="${LIGNE_MAX}" autocomplete="off" enterkeyhint="done" value="${e(texte)}">
        <div class="actions-sac"><button type="button" class="secondaire" data-sac="laisser">Laisser</button><button type="submit" class="envoyer-coin"${this.bloque() ? " disabled" : ""}>Enregistrer</button></div>
      </form>`;
    } else if (ouverte && o.mode === "donner") {
      const un = compte && n > 1 && o.combien !== "tout";
      suite = `<div class="actions-ligne donner-sac">
        ${compte && n > 1 ? `<fieldset class="choix-compagnon combien-sac"><legend>Combien ?</legend>
          <button type="button" class="compagnon-sac" data-combien="1" aria-pressed="${un}">En donner 1</button>
          <button type="button" class="compagnon-sac" data-combien="tout" aria-pressed="${!un}">Tout donner (${n})</button>
        </fieldset>` : ""}
        <p class="aide-sac">${un ? `Un exemplaire de ${e(cite(objet))} quittera votre sac pour celui de :` : `${e(cite(texte))} quittera votre sac pour celui de :`}</p>
        ${(this.etat.compagnons || []).map((c) => `<button type="button" class="envoyer-coin" data-donner-a="${e(c.ref)}"${this.bloque() ? " disabled" : ""}>${e(prenom(c.nom))}</button>`).join("")}
        <button type="button" class="secondaire" data-sac="laisser">Laisser</button>
      </div>`;
    } else if (ouverte && o.mode === "retirer") {
      suite = `<div class="actions-ligne">
        <p class="aide-sac">Retirer ${e(cite(texte))} du sac ?</p>
        <button type="button" class="envoyer-coin" data-sac="retirer-oui"${this.bloque() ? " disabled" : ""}>Retirer</button>
        <button type="button" class="secondaire" data-sac="laisser">Laisser</button>
      </div>`;
    }
    const compteur = compte ? `<span class="quantite-sac" role="group" aria-label="Quantité de ${e(objet)}">
        <button type="button" data-de="-1" data-rang="${rang}" aria-label="${n > 1 ? `Un ${e(objet)} de moins` : `Retirer ${e(objet)}`}"${this.bloque() ? " disabled" : ""}>−</button>
        <output aria-label="${n} dans le sac">${n}</output>
        <button type="button" data-de="1" data-rang="${rang}" aria-label="Un ${e(objet)} de plus"${this.bloque() ? " disabled" : ""}>+</button>
      </span>` : "";
    return `<li class="${ouverte ? "ouverte" : ""}${enRoute ? " en-route" : ""}" data-rang="${rang}">
      <div class="tete-ligne-sac">
        <button type="button" class="ligne-sac" data-ligne="${e(cle)}" data-rang="${rang}" aria-expanded="${Boolean(ouverte)}"${this.bloque() ? " disabled" : ""}>${e(objet)}${enRoute ? '<span class="en-route-sac">en route</span>' : ""}</button>
        ${compteur}
      </div>
      ${suite}
    </li>`;
  }

  phrase(d) {
    const c = d.corps || {};
    const a = (this.etat.compagnons || []).find((x) => x.ref === c.ref);
    const qui = a ? prenom(a.nom) : "un compagnon";
    if (d.genre === "don-or") return `${pieces(c.montant || 0)} pour ${qui}`;
    if (d.genre === "don-objet") return `${cite(Number.isInteger(c.nombre) ? ligneDe(quantiteDe(c.avant)[0], c.nombre) : c.avant)} pour ${qui}`;
    if (c.geste === "quantite") return `${cite(quantiteDe(c.avant)[0])} : un de ${c.de > 0 ? "plus" : "moins"}`;
    if (c.geste === "ajouter") return `Ajouter ${cite(c.ligne)}`;
    if (c.geste === "changer") return `${cite(c.avant)} devient ${cite(c.ligne)}`;
    return `Retirer ${cite(c.avant)}`;
  }

  // Les derniers gestes et dons, avec ce qu'en a fait l'atelier ou le MJ : la section se relit seule (flux).
  htmlGestes(r) {
    const liste = r.demandes || [];
    if (!liste.length) return "";
    return `<div class="gestes-sac"><h5>Derniers gestes</h5><ol>${liste.map((d) => `
      <li class="geste-sac statut-${e(d.statut)}">
        <p><span class="quoi">${e(this.phrase(d))}</span><span class="statut">${e(d.statut_dit)}</span></p>
        ${d.resultat && d.statut !== "appliquee" ? `<p class="resultat-demande">${e(d.resultat)}</p>` : ""}
        ${d.mot ? `<p class="mot-du-mj"><span class="lbl">Votre MJ</span>${e(d.mot)}</p>` : ""}
        ${d.retirable && d.statut === "en-attente" ? `<button type="button" class="secondaire" data-retirer-don="${e(d.id)}"${r.pause ? " disabled" : ""}>Retirer ce don</button>` : ""}
      </li>`).join("")}</ol></div>`;
  }

  // ------------------------------------------------------------ gestes

  dire(message) {
    this.message = message || "";
    const p = this.zone?.querySelector(".refus-sac");
    if (p) {
      p.textContent = this.message;
      p.hidden = !this.message;
    }
  }

  async envoyer(genre, corps) {
    if (this.bloque()) return false;
    this.envoi = true;
    this.dire("");
    try {
      const d = await demander("POST", "/api/demandes", { genre, corps });
      // En route : il se voit tout de suite, jusqu'à ce que l'atelier l'ait appliqué (la section se relit alors).
      if (this.etat) this.etat.demandes = [d, ...(this.etat.demandes || [])];
      this.ouverte = null;
      this.oublierRenommer();
      if (genre === "don-or") {
        this.or = null;
        delete this.brouillons.montant;
      }
      return true;
    } catch (err) {
      this.dire(err.status === 423 ? err.message : `Rien n'a changé : ${err.message}`);
      return false;
    } finally {
      this.envoi = false;
      this.dessiner();
      this.relire();
      // De secours : si le flux s'est tu, la section se relit d'elle-même.
      setTimeout(() => this.relire(), 3000);
    }
  }

  // Le geste joué sur ce que voit le joueur : refusé ici déjà s'il ne s'applique plus (corpsDuSac), avant tout envoi.
  essayer(geste) {
    const r = corpsDuSac(this.fiche(), geste);
    if (r.erreur) {
      this.dire(r.erreur);
      return false;
    }
    return Object.keys(r).length > 0;
  }

  clic(ev) {
    const ligne = ev.target.closest("[data-ligne]");
    if (ligne) {
      const cle = ligne.dataset.ligne;
      const rang = Number(ligne.dataset.rang);
      const avant = listeDuSac(this.fiche(), cle)[rang];
      const o = this.ouverte;
      this.ouverte = o && o.liste === cle && o.rang === rang ? null : { liste: cle, rang, avant, mode: "menu" };
      this.dire("");
      this.dessiner();
      this.zone.querySelector(".ouverte .actions-ligne button")?.focus();
      return;
    }
    const b = ev.target.closest("[data-sac], [data-donner-a], [data-or-a], [data-retirer-don], [data-de], [data-combien]");
    if (!b || b.disabled) return;
    if (b.dataset.de) return this.compter(Number(b.dataset.rang), Number(b.dataset.de));
    const o = this.ouverte;
    if (b.dataset.combien && o) {
      this.ouverte = { ...o, combien: b.dataset.combien === "tout" ? "tout" : 1 };
      this.dessiner();
      return this.zone.querySelector(`[data-combien="${b.dataset.combien}"]`)?.focus();
    }
    if (b.dataset.retirerDon) return this.retirerDon(b.dataset.retirerDon);
    if (b.dataset.orA) {
      this.or = { ...this.or, ref: b.dataset.orA };
      this.dessiner();
      return this.zone.querySelector('[name="montant"]')?.focus();
    }
    if (b.dataset.donnerA && o) {
      // Une ligne comptée : un seul exemplaire (nombre), ou toute la ligne comme avant.
      const partiel = o.liste === "equipement" && !douteuse(o.avant) && quantiteDe(o.avant)[1] > 1 && o.combien !== "tout";
      return this.envoyer("don-objet", { liste: o.liste, rang: o.rang, avant: o.avant, ref: b.dataset.donnerA, ...(partiel ? { nombre: 1 } : {}) });
    }
    const quoi = b.dataset.sac;
    if (quoi === "or") {
      this.or = { ref: (this.etat.compagnons || []).length === 1 ? this.etat.compagnons[0].ref : "" };
      this.dessiner();
      return this.zone.querySelector(this.or.ref ? '[name="montant"]' : ".compagnon-sac")?.focus();
    }
    if (quoi === "laisser-or") {
      this.or = null;
      delete this.brouillons.montant;
      return this.dessiner();
    }
    if (quoi === "laisser") {
      this.ouverte = null;
      this.oublierRenommer();
      return this.dessiner();
    }
    if (!o) return;
    if (quoi === "renommer" || quoi === "donner" || quoi === "retirer") {
      this.ouverte = { ...o, mode: quoi };
      this.dessiner();
      const champ = this.zone.querySelector(".ouverte input");
      if (champ) {
        champ.focus();
        champ.select();
      } else this.zone.querySelector(".ouverte .actions-ligne button")?.focus();
      return;
    }
    if (quoi === "retirer-oui") {
      if (!this.essayer({ genre: "retirer", liste: o.liste, rang: o.rang, avant: o.avant })) return this.dessiner();
      return this.envoyer("sac", { geste: "retirer", liste: o.liste, rang: o.rang, avant: o.avant });
    }
  }

  // Un de plus, un de moins sur une ligne d'équipement. Au dernier exemplaire, « − » demande avant de retirer la ligne.
  async compter(rang, de) {
    if (de !== 1 && de !== -1) return;
    const avant = listeDuSac(this.fiche(), "equipement")[rang];
    if (typeof avant !== "string" || !avant.trim()) return;
    if (de < 0 && quantiteDe(avant)[1] <= 1) {
      this.ouverte = { liste: "equipement", rang, avant, mode: "retirer" };
      this.dire("");
      this.dessiner();
      return this.zone.querySelector(".ouverte .actions-ligne button")?.focus();
    }
    if (!this.essayer({ genre: "quantite", liste: "equipement", rang, avant, de })) return this.dessiner();
    await this.envoyer("sac", { geste: "quantite", liste: "equipement", rang, avant, de });
    // Le doigt reste sur le même bouton : plusieurs touchers de suite comptent chacun.
    this.zone?.querySelector(`[data-de="${de}"][data-rang="${rang}"]`)?.focus();
  }

  saisie(ev) {
    if (ev.target.name) this.brouillons[ev.target.name] = ev.target.value;
  }

  async soumettre(ev) {
    const form = ev.target.closest("[data-form]");
    if (!form) return;
    ev.preventDefault();
    if (form.dataset.form === "ajouter") {
      const cle = form.dataset.liste;
      const champ = form.querySelector("input");
      const ligne = champ.value.replace(/\s+/g, " ").trim();
      if (!ligne || !this.essayer({ genre: "ajouter", liste: cle, texte: ligne })) return;
      delete this.brouillons[champ.name];
      if (!(await this.envoyer("sac", { geste: "ajouter", liste: cle, ligne }))) {
        this.brouillons[champ.name] = ligne;
        this.dessiner();
      }
      this.zone?.querySelector(`[data-form="ajouter"][data-liste="${cle}"] input`)?.focus();
      return;
    }
    if (form.dataset.form === "renommer" && this.ouverte) {
      const o = this.ouverte;
      const ligne = form.querySelector("input").value.replace(/\s+/g, " ").trim();
      if (!ligne) return this.dire("Écrivez le nouveau nom, ou retirez la ligne.");
      if (ligne === o.avant) {
        this.ouverte = null;
        return this.dessiner();
      }
      if (!this.essayer({ genre: "changer", liste: o.liste, rang: o.rang, avant: o.avant, texte: ligne })) return;
      return this.envoyer("sac", { geste: "changer", liste: o.liste, rang: o.rang, avant: o.avant, ligne });
    }
    if (form.dataset.form === "or" && this.or) {
      const montant = Math.round(Number(form.querySelector('[name="montant"]').value));
      const dispo = this.etat?.or?.disponible ?? 0;
      if (!this.or.ref) return this.dire("Choisissez d'abord à qui donner.");
      if (!Number.isFinite(montant) || montant < 1) return this.dire("Combien de pièces ? Un nombre entier, au moins une.");
      if (montant > dispo) return this.dire(`Vous avez ${pieces(dispo)} disponibles.`);
      return this.envoyer("don-or", { ref: this.or.ref, montant });
    }
  }

  oublierRenommer() {
    for (const k of Object.keys(this.brouillons)) if (k.startsWith("renommer-")) delete this.brouillons[k];
  }

  async retirerDon(id) {
    try {
      await demander("DELETE", `/api/demandes/${encodeURIComponent(id)}`);
      this.dire("");
    } catch (err) {
      this.dire(`Rien de retiré : ${err.message}`);
    }
    this.relire();
  }
}
