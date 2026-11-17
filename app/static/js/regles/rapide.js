import { api, echapper as e, toast } from "../api.js";
import { noterAuJournal } from "../seances/journal.js";
import { AIDE_MEMOIRE, aideCherchable } from "./aide-memoire.js";
import {
  STATUTS, TEXTE_MAX, TITRE_MAX, annoncerRegles, avertirSecrets, correspond, lireRegles, motsDe, nomSeance, quand,
  seanceEnCours, surligner,
} from "./commun.js";
// Un MJ invité lit les règles de la table ; le registre s'écrit au compte principal.
import { estInvite } from "../mj/role.js";

// La fenêtre rapide des règles maison : touche R par-dessus n'importe quelle page, une recherche qui montre la règle dès
// les premières lettres, et « Nouvelle règle » pour noter en dix secondes une décision prise à la table : en vigueur,
// rattachée à la séance en cours, avec la ligne « Règle maison : … » au journal de cette séance. En partie, on cherche
// une règle à appliquer : celles en vigueur d'abord, puis l'aide-mémoire du kit (cartons, critiques, coma…), et les
// questions à trancher repliées en dernier. Une règle ne se crée que par son bouton : un Entrée réflexe ne note rien.
// Échap ferme du premier coup, même la recherche remplie (echap.js) ; une règle commencée attend la prochaine ouverture.

// R sert déjà dans les deux éditeurs : sur une carte, l'outil « Rivière, route, frontière » ; sur un plan, la rotation du
// meuble choisi ou à poser. La carte garde sa touche ; le plan seulement quand l'orientation d'un meuble est à l'écran
// (ailleurs, R n'y tourne que le prochain meuble à poser, sans rien montrer).
function rPourLEditeur() {
  if (document.querySelector("#page .editeur:not(.editeur-plan)")) return true;
  return !!document.querySelector('#page .editeur-plan [data-action="tourner-d"]');
}

export class ReglesRapides {
  constructor() {
    this.regles = null;
    this.erreur = "";
    this.dialogue = null;
    this.seance = null;
    this.jeton = 0;
    this.jetonSeance = 0;
    document.addEventListener("keydown", (ev) => this.touche(ev));
    window.addEventListener("regles-modifiees", () => {
      if (this.dialogue?.open) this.relire();
      else this.regles = null;
    });
  }

  // R hors d'un champ de saisie et hors d'un dialogue ouvert. La touche s'arrête ici : l'éditeur de plan, qui écoute la
  // fenêtre, tournerait aussi le prochain meuble.
  touche(ev) {
    if ((ev.key || "").toLowerCase() !== "r" || ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat || ev.isComposing) return;
    const cible = ev.target instanceof Element ? ev.target : null;
    if (cible && (cible.closest("input, textarea, select, dialog") || cible.isContentEditable)) return;
    if (document.querySelector("dialog[open]") || rPourLEditeur()) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.ouvrir();
  }

  ouvrir() {
    if (this.dialogue?.open) return;
    this.creerDialogue();
    this.mode("chercher");
    this.champ.value = "";
    this.trancherOuvert = false;
    this.afficher();
    this.dialogue.showModal();
    this.champ.focus();
    this.relire();
  }

  async relire() {
    const n = ++this.jeton;
    try {
      const liste = await lireRegles();
      if (n !== this.jeton) return;
      this.regles = liste;
      this.erreur = "";
    } catch (err) {
      if (n !== this.jeton) return;
      this.erreur = err.message;
    }
    if (this.dialogue?.open) this.afficher();
  }

  creerDialogue() {
    if (this.dialogue) return;
    const d = document.createElement("dialog");
    d.className = "dialogue regles-rapide";
    d.setAttribute("aria-labelledby", "regles-rapide-titre");
    d.innerHTML = `
      <form class="rm-chercher" method="dialog">
        <p class="kicker">Règles maison</p>
        <h2 id="regles-rapide-titre">Chercher une règle</h2>
        <input type="search" name="q" autocomplete="off" enterkeyhint="search" spellcheck="false"
          placeholder="Trois lettres suffisent : pos, feu, cartons, coma…" aria-label="Chercher dans les règles maison et l'aide-mémoire du kit">
        <div class="rm-resultats" aria-live="polite"></div>
        <p class="aide">Touche <kbd>R</kbd> depuis n'importe quel écran, <kbd>Échap</kbd> pour fermer.</p>
        <div class="actions">
          ${estInvite() ? "" : '<a class="bouton rm-registre" href="#/regles">Tout le registre</a>'}
          <button type="button" data-rr="fermer">Fermer</button>
          ${estInvite() ? "" : '<button type="button" class="principal" data-rr="nouvelle">Nouvelle règle</button>'}
        </div>
      </form>
      <form class="rm-nouvelle" method="dialog" hidden>
        <p class="kicker">Décidé à la table</p>
        <h2 id="regles-rapide-nouvelle">Nouvelle règle</h2>
        <label class="champ">Titre<input type="text" name="titre" maxlength="${TITRE_MAX}" autocomplete="off" required
          placeholder="Sauter de l'étage, Focus au calme…"></label>
        <label class="champ">La règle<textarea name="texte" rows="3" maxlength="${TEXTE_MAX}"
          placeholder="Ce qui a été décidé, en une ou deux phrases"></textarea></label>
        <label class="case rm-journal" hidden><input type="checkbox" name="journal" checked><span></span></label>
        <p class="aide rm-sans-seance"></p>
        <p class="aide">En vigueur dès maintenant, et dans le carnet des joueurs. Entrée passe au texte, Ctrl+Entrée note la règle.</p>
        <div class="actions">
          <button type="button" data-rr="retour">Retour à la recherche</button>
          <button class="principal" data-rr="noter">Noter la règle</button>
        </div>
      </form>`;
    document.body.append(d);
    this.dialogue = d;
    this.formChercher = d.querySelector(".rm-chercher");
    this.formNouvelle = d.querySelector(".rm-nouvelle");
    this.champ = this.formChercher.elements.q;
    this.champ.addEventListener("input", () => this.afficher());
    // Entrée dans la recherche ne crée rien : une nouvelle règle passe par son bouton.
    this.formChercher.addEventListener("submit", (ev) => ev.preventDefault());
    // « À trancher » replié à chaque ouverture ; ouvert d'un clic, il le reste d'une lettre à l'autre.
    this.formChercher.addEventListener("click", (ev) => {
      const titre = ev.target.closest(".rm-a-trancher > summary");
      if (titre) this.trancherOuvert = !titre.parentElement.open;
    });
    this.formNouvelle.addEventListener("submit", (ev) => {
      ev.preventDefault();
      this.noter();
    });
    this.formNouvelle.elements.titre.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.isComposing && !ev.ctrlKey && !ev.metaKey) {
        ev.preventDefault();
        this.formNouvelle.elements.texte.focus();
      }
    });
    this.formNouvelle.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey) && !ev.isComposing) {
        ev.preventDefault();
        this.noter();
      }
    });
    d.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-rr]");
      if (ev.target.closest("a[href]")) return d.close();
      if (!b) return;
      if (b.dataset.rr === "fermer") d.close();
      // Ce qu'on cherchait sans le trouver sert de titre ; une recherche qui a trouvé ne s'y recopie pas.
      else if (b.dataset.rr === "nouvelle") this.nouvelle(this.trouvees().length ? "" : this.champ.value.replace(/\s+/g, " ").trim());
      else if (b.dataset.rr === "retour") {
        this.mode("chercher");
        this.champ.focus();
      }
    });
  }

  mode(m) {
    this.formChercher.hidden = m !== "chercher";
    this.formNouvelle.hidden = m !== "nouvelle";
    this.dialogue.setAttribute("aria-labelledby", m === "nouvelle" ? "regles-rapide-nouvelle" : "regles-rapide-titre");
  }

  trouvees() {
    const mots = motsDe(this.champ.value);
    return (this.regles || []).filter((r) => correspond(r, mots));
  }

  // L'aide-mémoire du kit qui répond à la recherche (rien sans recherche : il ne passe pas devant les règles de la table).
  aideTrouvee(mots) {
    return mots.length ? AIDE_MEMOIRE.filter((a) => correspond(aideCherchable(a), mots, true)) : [];
  }

  afficher() {
    const zone = this.dialogue.querySelector(".rm-resultats");
    const mots = motsDe(this.champ.value);
    const kit = this.aideTrouvee(mots);
    if (!this.regles) {
      zone.innerHTML = `<p class="vide">${this.erreur ? `Le registre ne répond pas : ${e(this.erreur)}.` : "Lecture du registre…"}</p>${this.htmlKit(kit, mots)}`;
      return;
    }
    const liste = this.trouvees();
    const enVigueur = liste.filter((r) => r.statut !== "a-trancher");
    const aTrancher = liste.filter((r) => r.statut === "a-trancher");
    if (!this.regles.length && !kit.length) {
      zone.innerHTML = '<p class="vide">Aucune règle maison pour l\'instant : « Nouvelle règle » note la première. Cherchez « cartons » ou « coma » : l\'aide-mémoire du kit répond aussi.</p>';
      return;
    }
    if (!liste.length && !kit.length) {
      zone.innerHTML = `<p class="vide">Rien ne parle de « ${e(this.champ.value.trim())} », ni dans le registre, ni dans l'aide-mémoire du kit. « Nouvelle règle » la note sous ce titre.</p>`;
      return;
    }
    // Les questions à trancher, repliées, sauf si elles sont seules à répondre.
    const deplie = this.trancherOuvert || (mots.length > 0 && !enVigueur.length && !kit.length);
    zone.innerHTML = `
      ${enVigueur.length ? `
      <section class="rm-groupe-rapide">
        <h3>${STATUTS["en-vigueur"]}</h3>
        ${enVigueur.map((r) => this.htmlRegle(r, mots)).join("")}
      </section>` : mots.length ? "" : '<p class="vide">Aucune règle en vigueur pour l\'instant.</p>'}
      ${this.htmlKit(kit, mots)}
      ${aTrancher.length ? `
      <details class="rm-groupe-rapide rm-a-trancher" ${deplie ? "open" : ""}>
        <summary><h3>${STATUTS["a-trancher"]} <span class="compte">${aTrancher.length}</span></h3></summary>
        ${aTrancher.map((r) => this.htmlRegle(r, mots)).join("")}
      </details>` : ""}`;
  }

  htmlRegle(r, mots) {
    const statut = r.statut === "a-trancher" ? "a-trancher" : "en-vigueur";
    return `
        <article class="rm-regle rm-compacte" data-statut="${e(statut)}">
          <h4>${surligner(r.titre, mots)}</h4>
          ${r.texte ? `<p class="rm-texte">${surligner(r.texte, mots)}</p>` : ""}
          <p class="rm-meta">${e(quand(r))}${statut !== "a-trancher" && r.publique === false ? " · gardée pour le MJ" : ""}${estInvite() ? "" : ` · <a href="#/regles/${encodeURIComponent(r.id)}${statut === "a-trancher" ? "?trancher=1" : ""}">${statut === "a-trancher" ? "Trancher" : "Modifier"}</a>`}</p>
        </article>`;
  }

  htmlKit(kit, mots) {
    if (!kit.length) return "";
    return `
      <section class="rm-groupe-rapide rm-kit">
        <h3>Aide-mémoire du kit</h3>
        ${kit.map((a) => `
        <article class="rm-regle rm-compacte" data-statut="kit">
          <h4>${surligner(a.titre, mots)}</h4>
          <p class="rm-texte">${surligner(a.texte, mots)}</p>
        </article>`).join("")}
      </section>`;
  }

  // Le formulaire s'ouvre tout de suite ; la séance en cours se cherche pendant qu'on écrit le titre.
  async nouvelle(titre = "") {
    const f = this.formNouvelle;
    this.mode("nouvelle");
    if (titre && !f.elements.titre.value.trim()) f.elements.titre.value = titre.slice(0, TITRE_MAX);
    (f.elements.titre.value.trim() ? f.elements.texte : f.elements.titre).focus();
    const n = ++this.jetonSeance;
    this.majSeance(undefined);
    let seance = null;
    try {
      seance = await seanceEnCours();
    } catch {
      seance = null;
    }
    if (n === this.jetonSeance) this.majSeance(seance);
  }

  // undefined : encore inconnue ; null : aucune séance ouverte.
  majSeance(seance) {
    this.seance = seance || null;
    const f = this.formNouvelle;
    const ligne = f.querySelector(".rm-journal");
    const sans = f.querySelector(".rm-sans-seance");
    ligne.hidden = !seance;
    if (seance) ligne.querySelector("span").textContent = `Rattacher à ${nomSeance(seance)}, avec la ligne « Règle maison : … » au journal`;
    sans.hidden = !!seance;
    sans.textContent = seance === undefined ? "Recherche de la séance en cours…" : "Aucune séance ouverte : la règle n'est rattachée à aucune séance.";
  }

  async noter() {
    const f = this.formNouvelle;
    const titre = f.elements.titre.value.replace(/\s+/g, " ").trim();
    const texte = f.elements.texte.value.trim();
    if (!titre) {
      f.elements.titre.focus();
      return toast("Un titre, s'il vous plaît : c'est par lui qu'on retrouve la règle.", "erreur");
    }
    if (this.envoi) return;
    const seance = f.elements.journal.checked && this.seance ? this.seance : null;
    this.envoi = true;
    f.querySelector('[data-rr="noter"]').disabled = true;
    try {
      const regle = await api.post("/api/regles-maison", { titre, texte, statut: "en-vigueur", seance: seance?.id || "" });
      f.reset();
      this.dialogue.close();
      annoncerRegles();
      let journal = "";
      if (seance) {
        try {
          await noterAuJournal(seance.id, `Règle maison : ${regle.titre}`);
          journal = `, et au journal de la séance ${seance.numero ?? ""}`.trimEnd();
        } catch (err) {
          toast(`Règle notée, mais pas au journal : ${err.message}`, "erreur");
        }
      }
      toast(`Règle notée${journal}.`);
      avertirSecrets(regle);
    } catch (err) {
      toast(`Règle non notée : ${err.message}`, "erreur");
    } finally {
      this.envoi = false;
      f.querySelector('[data-rr="noter"]').disabled = false;
    }
  }
}
