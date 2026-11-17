// L'onglet « Règles maison » : le registre des décisions de règle du MJ. D'abord ce qui reste à trancher, puis ce qui est
// en vigueur ; recherche, ajout rapide, édition sur place, changement de statut. Les règles en vigueur et publiques
// paraissent dans le carnet des joueurs (le serveur le récrit à chaque changement) ; le contexte reste au MJ.
// Rien ne s'enregistre sans « Enregistrer » : une règle trop vite publiée se lirait chez les joueurs. Une édition laissée
// en plan attend le retour sur l'onglet. « Trancher » propose la séance en cours, comme la touche R, et la ligne
// « Règle maison : … » à son journal (cochée le jour de la séance).

import { api, echapper as e, toast } from "../api.js";
import { annoncerCorbeille, lienVersions } from "../corbeille/corbeille.js";
import { demander } from "../commun/dialogue.js";
import { noterAuJournal } from "../seances/journal.js";
import {
  CONTEXTE_MAX, ORDRE, STATUTS, TEXTE_MAX, TITRE_MAX, annoncerRegles, aujourdhui, avertirSecrets, correspond, lireRegles,
  motsDe, nomSeance, quand, seanceEnCours, surligner,
} from "./commun.js";

const statutDe = (r) => (r.statut === "a-trancher" ? "a-trancher" : "en-vigueur");
const propre = (t) => String(t || "").replace(/\s+/g, " ").trim();

// L'ajout commencé et l'édition laissée en plan survivent à un tour dans un autre onglet de l'atelier.
const brouillon = { titre: "", texte: "", statut: "en-vigueur" };
let editionGardee = null;

export class ReglesMaison {
  constructor(racine, { id, parametres } = {}) {
    this.racine = racine;
    this.idDemande = id || "";
    this.parametres = parametres || new URLSearchParams();
    this.regles = [];
    this.seances = [];
    this.q = "";
    this.edition = null; // { id, trancher, base, valeurs, initiales }
    this.aRelire = false;
    this.surSignal = (ev) => {
      if (ev?.detail?.source !== this) this.charger();
    };
  }

  async demarrer() {
    this.racine.innerHTML = `<section class="page-liste registre-regles"><div class="chargement">Ouverture du registre…</div></section>`;
    const [regles, seances] = await Promise.all([lireRegles(), api.get("/api/seances").catch(() => [])]);
    if (this.detruit) return;
    this.regles = regles;
    this.seances = this.trierSeances(seances);
    this.racine.innerHTML = this.gabarit();
    this.lier();
    const demandee = this.regles.find((r) => r.id === this.idDemande);
    if (this.idDemande && !demandee) history.replaceState(null, "", "#/regles");
    const gardee = editionGardee && this.regles.some((r) => r.id === editionGardee.id) ? editionGardee : null;
    editionGardee = null;
    if (demandee && !(gardee && gardee.id === demandee.id)) this.editer(demandee, this.parametres.has("trancher"));
    else if (gardee) {
      this.edition = gardee;
      this.afficher();
      this.racine.querySelector(".rm-edition")?.scrollIntoView({ block: "center" });
    } else this.afficher();
    window.addEventListener("regles-modifiees", this.surSignal);
    window.addEventListener("focus", this.surSignal);
  }

  detruire() {
    this.detruit = true;
    window.removeEventListener("regles-modifiees", this.surSignal);
    window.removeEventListener("focus", this.surSignal);
    if (this.modifiee()) editionGardee = this.edition;
  }

  vider() {}

  // Fermer l'onglet du navigateur avec une règle modifiée et pas enregistrée : il demande confirmation.
  aEnregistrer() {
    return this.modifiee();
  }

  modifiee() {
    return !!this.edition && JSON.stringify(this.edition.valeurs) !== this.edition.initiales;
  }

  trierSeances(seances) {
    return (Array.isArray(seances) ? seances : []).sort((a, b) => (b.numero || 0) - (a.numero || 0));
  }

  // Relu à chaque retour sur la fenêtre et à chaque règle notée ailleurs ; pas pendant une édition, juste après.
  async charger() {
    if (this.detruit) return;
    if (this.edition) {
      this.aRelire = true;
      return;
    }
    this.aRelire = false;
    try {
      const [regles, seances] = await Promise.all([lireRegles(), api.get("/api/seances").catch(() => null)]);
      if (this.detruit || this.edition) return;
      this.regles = regles;
      if (seances) this.seances = this.trierSeances(seances);
      this.afficher();
    } catch {
      // serveur muet : la liste affichée reste
    }
  }

  gabarit() {
    return `
      <section class="page-liste registre-regles">
        <header class="titre-page">
          <p class="kicker">À la table</p>
          <h1>Règles maison</h1>
          <p class="chapo">Chaque décision de règle, notée une fois pour toutes : d'une séance à l'autre, la table reste cohérente et le débat ne revient pas. Les règles en vigueur paraissent dans le carnet des joueurs, le contexte reste pour vous.</p>
        </header>
        <p class="aide vers-reglages-page">Le confort de la table, les lignes et les voiles de la tablée : <a href="#/reglages/regles?confort">Réglages, Règles de jeu</a>.</p>
        <form class="rm-ajout">
          <div class="rm-ajout-ligne">
            <input type="text" name="titre" maxlength="${TITRE_MAX}" autocomplete="off" placeholder="Titre : Focus au calme, sauter de l'étage…" aria-label="Titre de la nouvelle règle">
            <div class="segments" role="group" aria-label="Statut de la nouvelle règle">
              ${["en-vigueur", "a-trancher"].map((s) => `<button type="button" data-ajout-statut="${s}" aria-pressed="${brouillon.statut === s}">${STATUTS[s]}</button>`).join("")}
            </div>
          </div>
          <textarea name="texte" rows="2" maxlength="${TEXTE_MAX}" placeholder="La règle, en quelques lignes" aria-label="Texte de la nouvelle règle"></textarea>
          <div class="rm-ajout-pied">
            <span class="aide">En jeu, touche <kbd>R</kbd> depuis n'importe quel écran pour chercher ou noter une règle. Ctrl+Entrée pour noter.</span>
            <button class="principal" type="submit">Noter</button>
          </div>
        </form>
        <div class="filtres">
          <input type="search" name="q" placeholder="Chercher dans les règles" aria-label="Chercher dans les règles maison">
          <span class="compte rm-compte"></span>
        </div>
        <div class="rm-liste"></div>
      </section>`;
  }

  lier() {
    const r = this.racine.querySelector(".registre-regles");
    const form = r.querySelector(".rm-ajout");
    form.elements.titre.value = brouillon.titre;
    form.elements.texte.value = brouillon.texte;
    form.addEventListener("input", () => {
      brouillon.titre = form.elements.titre.value;
      brouillon.texte = form.elements.texte.value;
    });
    form.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-ajout-statut]");
      if (!b) return;
      brouillon.statut = b.dataset.ajoutStatut;
      for (const x of form.querySelectorAll("[data-ajout-statut]")) x.setAttribute("aria-pressed", String(x === b));
    });
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      this.ajouter(form);
    });
    form.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey) && !ev.isComposing) {
        ev.preventDefault();
        this.ajouter(form);
      }
    });
    // Entrée dans le titre passe au texte : une règle notée sans son texte serait à reprendre.
    form.elements.titre.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.ctrlKey && !ev.metaKey && !ev.isComposing) {
        ev.preventDefault();
        form.elements.texte.focus();
      }
    });
    r.querySelector('input[name="q"]').addEventListener("input", (ev) => {
      this.q = ev.target.value;
      this.afficher();
    });
    const liste = r.querySelector(".rm-liste");
    liste.addEventListener("click", (ev) => this.clic(ev));
    liste.addEventListener("input", (ev) => this.saisie(ev));
    liste.addEventListener("submit", (ev) => {
      ev.preventDefault();
      this.enregistrer();
    });
    liste.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey) && !ev.isComposing && ev.target.closest(".rm-edition")) {
        ev.preventDefault();
        this.enregistrer();
      }
    });
  }

  afficher() {
    const zone = this.racine.querySelector(".rm-liste");
    if (!zone) return;
    const mots = motsDe(this.q);
    const visibles = this.regles.filter((r) => correspond(r, mots, true) || r.id === this.edition?.id);
    const carnet = this.regles.filter((r) => statutDe(r) === "en-vigueur" && r.publique !== false).length;
    const n = visibles.length;
    this.racine.querySelector(".rm-compte").textContent = this.regles.length
      ? `${n} règle${n > 1 ? "s" : ""}${n < this.regles.length ? ` sur ${this.regles.length}` : ""} · ${carnet ? `${carnet} dans le carnet des joueurs` : "aucune dans le carnet des joueurs"}`
      : "";
    if (!this.regles.length) {
      zone.innerHTML = '<p class="vide">Aucune règle maison pour l\'instant. La première s\'écrit juste au-dessus, ou en jeu, touche R depuis n\'importe quel écran.</p>';
      return;
    }
    // Les plus récentes en tête, comme le serveur les donne : une règle tranchée ou remise à trancher ici prend sa place.
    const cle = (r) => (statutDe(r) === "a-trancher" ? String(r.cree || "") : `${r.depuis || String(r.cree || "").slice(0, 10)} ${r.cree || ""}`);
    zone.innerHTML = ORDRE.map((statut) => {
      const groupe = visibles.filter((r) => statutDe(r) === statut).sort((a, b) => cle(b).localeCompare(cle(a)));
      if (!groupe.length && mots.length) return "";
      return `
        <section class="rm-groupe" data-groupe="${statut}">
          <h2>${STATUTS[statut]}${groupe.length ? ` <span class="compte">${groupe.length}</span>` : ""}</h2>
          ${groupe.length ? groupe.map((r) => this.carte(r, mots)).join("") : `<p class="vide">${statut === "a-trancher" ? "Rien à trancher pour l'instant." : "Aucune règle en vigueur pour l'instant."}</p>`}
        </section>`;
    }).join("") || '<p class="vide">Aucune règle ne correspond.</p>';
  }

  carte(r, mots) {
    if (this.edition?.id === r.id) return this.formulaire(r);
    const statut = statutDe(r);
    const seance = this.seances.find((s) => s.id === r.seance);
    const meta = [e(quand(r))];
    if (seance) meta.push(`<a href="#/seances/${encodeURIComponent(seance.id)}">${e(nomSeance(seance))}</a>`);
    else if (r.seance) meta.push("séance retirée");
    if (statut === "en-vigueur" && r.publique === false) meta.push("gardée pour le MJ");
    return `
      <article class="rm-regle" data-id="${e(r.id)}" data-statut="${statut}">
        <header class="rm-tete">
          <h3>${surligner(r.titre, mots)}</h3>
          <span class="rm-statut">${STATUTS[statut]}</span>
        </header>
        ${r.texte ? `<p class="rm-texte">${surligner(r.texte, mots)}</p>` : '<p class="rm-texte rm-sans-texte">Pas encore de texte.</p>'}
        ${r.contexte ? `<div class="rm-contexte"><span class="rm-etiquette">Pour le MJ</span><p>${surligner(r.contexte, mots)}</p></div>` : ""}
        <p class="rm-meta">${meta.join(" · ")}</p>
        <div class="rm-actions">
          ${statut === "a-trancher" ? '<button type="button" class="principal" data-action="trancher">Trancher</button>' : ""}
          <button type="button" data-action="modifier">Modifier</button>
          ${statut === "en-vigueur" ? '<button type="button" data-action="a-trancher">Remettre à trancher</button>' : ""}
          <button type="button" class="lien-danger" data-action="supprimer">Supprimer</button>
          <a class="lien-versions" href="${lienVersions("regles-maison", r.id, `#/regles/${r.id}`)}">Versions</a>
        </div>
      </article>`;
  }

  formulaire(r) {
    const v = this.edition.valeurs;
    const connue = !v.seance || this.seances.some((s) => s.id === v.seance);
    return `
      <article class="rm-regle rm-en-edition" data-id="${e(r.id)}" data-statut="${e(v.statut)}">
        <form class="rm-edition">
          ${this.edition.trancher ? '<p class="rm-consigne">Écrivez la règle telle que vous la tranchez : c\'est ce texte que liront les joueurs. La question d\'avant peut passer dans le contexte.</p>' : ""}
          <label class="champ">Titre<input type="text" name="titre" maxlength="${TITRE_MAX}" autocomplete="off" required value="${e(v.titre)}"></label>
          <label class="champ">La règle<textarea name="texte" rows="4" maxlength="${TEXTE_MAX}">${e(v.texte)}</textarea></label>
          <label class="champ rm-champ-contexte">Contexte, pour vous seul<textarea name="contexte" rows="3" maxlength="${CONTEXTE_MAX}" placeholder="Pourquoi, quand, ce qui reste à voir…">${e(v.contexte)}</textarea></label>
          <div class="rm-reglages">
            <div class="champ">Statut
              <div class="segments" role="group" aria-label="Statut">${["en-vigueur", "a-trancher"].map((s) => `<button type="button" data-statut-edition="${s}" aria-pressed="${v.statut === s}">${STATUTS[s]}</button>`).join("")}</div>
            </div>
            <label class="champ rm-depuis"${v.statut === "en-vigueur" ? "" : " hidden"}>En vigueur depuis<input type="date" name="depuis" value="${e(v.depuis || "")}"></label>
            <label class="champ">Séance<select name="seance">
              <option value="">Aucune</option>
              ${connue ? "" : `<option value="${e(v.seance)}" selected>Séance retirée</option>`}
              ${this.seances.map((s) => `<option value="${e(s.id)}" ${s.id === v.seance ? "selected" : ""}>${e(nomSeance(s))}</option>`).join("")}
            </select></label>
          </div>
          ${this.edition.trancher ? `<label class="case rm-journal-tranche"${v.seance ? "" : " hidden"}><input type="checkbox" name="journal" ${v.journal ? "checked" : ""}><span>Avec la ligne « Règle maison : … » au journal de cette séance</span></label>` : ""}
          <label class="case"><input type="checkbox" name="publique" ${v.publique ? "checked" : ""}><span>Dans le carnet des joueurs, une fois en vigueur</span></label>
          <div class="actions">
            <button type="button" data-action="annuler">Annuler</button>
            <button class="principal" type="submit">Enregistrer</button>
          </div>
        </form>
      </article>`;
  }

  saisie(ev) {
    const f = ev.target.closest(".rm-edition");
    if (!f || !this.edition) return;
    const v = this.edition.valeurs;
    v.titre = f.elements.titre.value;
    v.texte = f.elements.texte.value;
    v.contexte = f.elements.contexte.value;
    v.depuis = f.elements.depuis.value;
    v.seance = f.elements.seance.value;
    v.publique = f.elements.publique.checked;
    if (f.elements.journal) {
      v.journal = f.elements.journal.checked;
      f.querySelector(".rm-journal-tranche").hidden = !v.seance;
    }
  }

  async editer(r, trancher) {
    if (this.edition && this.edition.id !== r.id && this.modifiee()
      && !(await demander({ titre: "Abandonner les changements ?", texte: "La règle en cours d'écriture a des changements qui ne sont pas enregistrés.", oui: "Abandonner", non: "Continuer d'écrire", danger: true }))) return;
    if (this.detruit) return;
    const valeurs = {
      titre: r.titre || "", texte: r.texte || "", contexte: r.contexte || "",
      statut: trancher ? "en-vigueur" : statutDe(r), depuis: trancher ? aujourdhui() : r.depuis || "",
      seance: r.seance || "", publique: r.publique !== false, journal: false,
    };
    this.edition = { id: r.id, trancher, base: r.modifie, valeurs, initiales: JSON.stringify(valeurs) };
    this.afficher();
    const f = this.racine.querySelector(".rm-edition");
    if (!f) return;
    f.scrollIntoView({ block: "nearest" });
    const champ = trancher ? f.elements.texte : f.elements.titre;
    champ.focus({ preventScroll: true });
    champ.setSelectionRange(champ.value.length, champ.value.length);
    if (trancher && !r.seance) this.proposerSeance(this.edition);
  }

  // Trancher une règle sans séance : la séance en cours (celle du combat, sinon celle du journal) est proposée, comme par
  // la touche R, avec sa ligne au journal cochée le jour même. Le formulaire se règle sur place : on y écrit peut-être.
  async proposerSeance(ed) {
    let s = null;
    try {
      s = await seanceEnCours();
    } catch {
      return;
    }
    const v = ed.valeurs;
    if (!s || this.edition !== ed || this.detruit || v.seance) return;
    const intacte = JSON.stringify(v) === ed.initiales;
    v.seance = s.id;
    v.journal = s.date === aujourdhui();
    if (intacte) ed.initiales = JSON.stringify(v);
    if (!this.seances.some((x) => x.id === s.id)) this.seances = this.trierSeances([...this.seances, s]);
    const f = this.racine.querySelector(".rm-edition");
    if (!f?.elements.journal) return;
    if (![...f.elements.seance.options].some((o) => o.value === s.id)) f.elements.seance.add(new Option(nomSeance(s), s.id));
    f.elements.seance.value = s.id;
    f.elements.journal.checked = v.journal;
    f.querySelector(".rm-journal-tranche").hidden = false;
  }

  fermerEdition(id) {
    this.edition = null;
    if (location.hash !== "#/regles") history.replaceState(null, "", "#/regles");
    this.afficher();
    this.racine.querySelector(`.rm-regle[data-id="${CSS.escape(id)}"] [data-action="modifier"]`)?.focus({ preventScroll: true });
    if (this.aRelire) this.charger();
  }

  async clic(ev) {
    const b = ev.target.closest("button");
    const carte = b?.closest(".rm-regle[data-id]");
    const r = carte && this.regles.find((x) => x.id === carte.dataset.id);
    if (!r) return;
    if (b.dataset.statutEdition && this.edition) {
      const v = this.edition.valeurs;
      v.statut = b.dataset.statutEdition;
      if (v.statut === "en-vigueur" && !v.depuis) v.depuis = r.depuis || aujourdhui();
      for (const x of carte.querySelectorAll("[data-statut-edition]")) x.setAttribute("aria-pressed", String(x === b));
      carte.querySelector(".rm-depuis").hidden = v.statut !== "en-vigueur";
      carte.querySelector('input[name="depuis"]').value = v.depuis || "";
      carte.dataset.statut = v.statut;
      return;
    }
    const a = b.dataset.action;
    if (a === "modifier") return this.editer(r, false);
    if (a === "trancher") return this.editer(r, true);
    if (a === "annuler") {
      if (this.modifiee() && !(await demander({ titre: "Abandonner les changements ?", texte: "Ce que vous avez changé à cette règle n'est pas enregistré.", oui: "Abandonner", non: "Continuer d'écrire", danger: true }))) return;
      return this.fermerEdition(r.id);
    }
    if (a === "a-trancher") return this.changer(r, { statut: "a-trancher" }, "Remise à trancher : elle quitte le carnet des joueurs.");
    if (a === "supprimer") {
      try {
        await api.del(`/api/regles-maison/${encodeURIComponent(r.id)}`);
        this.regles = this.regles.filter((x) => x.id !== r.id);
        this.afficher();
        annoncerRegles(this);
        annoncerCorbeille(`« ${r.titre} » mise à la corbeille.`, "regles-maison", r.id, { retour: `#/regles/${r.id}` });
      } catch (err) {
        toast(`Suppression impossible : ${err.message}`, "erreur");
      }
    }
  }

  async ajouter(form) {
    const titre = propre(form.elements.titre.value);
    if (!titre) {
      form.elements.titre.focus();
      return toast("Un titre, s'il vous plaît : c'est par lui qu'on retrouve la règle.", "erreur");
    }
    if (this.envoiAjout) return;
    this.envoiAjout = true;
    try {
      const regle = await api.post("/api/regles-maison", { titre, texte: form.elements.texte.value, statut: brouillon.statut });
      brouillon.titre = "";
      brouillon.texte = "";
      form.elements.titre.value = "";
      form.elements.texte.value = "";
      this.regles = [regle, ...this.regles.filter((x) => x.id !== regle.id)];
      this.afficher();
      const carte = this.racine.querySelector(`.rm-regle[data-id="${CSS.escape(regle.id)}"]`);
      carte?.classList.add("rm-arrivee");
      carte?.scrollIntoView({ block: "nearest" });
      annoncerRegles(this);
      toast(regle.statut === "a-trancher" ? "Règle notée, à trancher." : "Règle notée, en vigueur.");
      avertirSecrets(regle);
      form.elements.titre.focus({ preventScroll: true });
    } catch (err) {
      toast(`Règle non notée : ${err.message}`, "erreur");
    } finally {
      this.envoiAjout = false;
    }
  }

  async enregistrer() {
    const ed = this.edition;
    if (!ed || this.envoi) return;
    const v = ed.valeurs;
    const titre = propre(v.titre);
    if (!titre) {
      this.racine.querySelector('.rm-edition input[name="titre"]')?.focus();
      return toast("Un titre, s'il vous plaît : c'est par lui qu'on retrouve la règle.", "erreur");
    }
    const champs = { titre, texte: v.texte, contexte: v.contexte, statut: v.statut, seance: v.seance, publique: v.publique, version_base: ed.base };
    if (v.statut === "en-vigueur") champs.depuis = v.depuis || "";
    this.envoi = true;
    try {
      const maj = await api.patch(`/api/regles-maison/${encodeURIComponent(ed.id)}`, champs);
      this.regles = this.regles.map((x) => (x.id === ed.id ? maj : x));
      this.fermerEdition(ed.id);
      annoncerRegles(this);
      // Tranchée en séance : la même ligne au journal que par la touche R.
      let journal = "";
      if (ed.trancher && v.journal && v.seance && maj.statut === "en-vigueur") {
        try {
          await noterAuJournal(v.seance, `Règle maison : ${maj.titre}`);
          const s = this.seances.find((x) => x.id === v.seance);
          journal = `, et au journal de la séance ${s?.numero ?? ""}`.trimEnd();
        } catch (err) {
          toast(`Règle tranchée, mais pas notée au journal : ${err.message}`, "erreur");
        }
      }
      toast(ed.trancher ? `Règle tranchée : elle est en vigueur${journal}.` : "Règle enregistrée.");
      avertirSecrets(maj);
    } catch (err) {
      if (err.status === 409) {
        // Le formulaire garde ce qui a été écrit ici ; enregistrer à nouveau passe par-dessus l'autre écran.
        const srv = await api.get(`/api/regles-maison/${encodeURIComponent(ed.id)}`).catch(() => null);
        if (srv && this.edition === ed) {
          ed.base = srv.modifie;
          this.regles = this.regles.map((x) => (x.id === srv.id ? srv : x));
        }
        toast("Cette règle a changé sur un autre écran. Vos changements sont toujours là : enregistrez à nouveau pour les garder.", "erreur");
      } else if (err.status === 404) {
        toast("Cette règle a été supprimée depuis un autre écran.", "erreur");
        this.regles = this.regles.filter((x) => x.id !== ed.id);
        this.fermerEdition(ed.id);
      } else toast(`Enregistrement impossible : ${err.message}`, "erreur");
    } finally {
      this.envoi = false;
    }
  }

  async changer(r, champs, message) {
    try {
      const maj = await api.patch(`/api/regles-maison/${encodeURIComponent(r.id)}`, { ...champs, version_base: r.modifie });
      this.regles = this.regles.map((x) => (x.id === r.id ? maj : x));
      this.afficher();
      annoncerRegles(this);
      toast(message);
    } catch (err) {
      if (err.status === 409) {
        toast("Cette règle a changé sur un autre écran : voici sa dernière version.", "erreur");
        return this.charger();
      }
      toast(`Enregistrement impossible : ${err.message}`, "erreur");
    }
  }
}
