// La boîte « Demandes des joueurs » : ce que les joueurs demandent depuis le coin (un mot au MJ, plus tard le sac, le
// sanctuaire, le lore…), leurs commandes à l'échoppe et les aventuriers qu'ils ont envoyés. La pastille de l'en-tête
// compte ce qui attend ; la page #/demandes le range par joueur puis par genre, et garde l'historique récent. Les deux se
// tiennent à jour par le canal de l'atelier (canal-table.js, message « demandes »), presque à l'instant où le joueur écrit.
// Chaque geste part avec la version lue : le Mac et l'iPad ne traitent jamais deux fois la même demande.

import { api, echapper as e, toast } from "../api.js";
import { ecouterDemandes } from "../ecran-tv/canal-table.js";
import { Commandes } from "../boutiques/commandes.js";
import { ComparaisonLore, htmlCarteLore } from "./lore.js";
import { ValidationActivite, htmlCarteActivite } from "./activites.js";
import { GENRES_PORTRAIT, htmlImagePortrait } from "./portraits.js";
import { htmlBoutonConfie, ouvrirConfie } from "./confie.js";
// Un MJ invité : ni Telegram (il ne concerne que le MJ principal), ni les réglages du coin.
import { estInvite } from "../mj/role.js";

const RELIRE = 60000; // de secours : le canal a pu tomber un moment

function quand(iso) {
  const d = new Date(iso || "");
  if (Number.isNaN(d.getTime())) return "";
  const aujourdhui = d.toDateString() === new Date().toDateString();
  const jour = aujourdhui ? "aujourd'hui" : `le ${d.toLocaleDateString("fr-CH", { day: "numeric", month: "long" })}`;
  return `${jour} à ${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
}

const lignes = (t) => String(t || "").split(/\n/).map((l) => e(l)).join("<br>");
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

// ---------------------------------------------------------------- la pastille de l'en-tête

export function demarrerPastilleDemandes(lien) {
  if (!lien) return;
  const compte = lien.querySelector(".compte-demandes");
  const montrer = (r) => {
    const n = Number(r?.compte) || 0;
    compte.textContent = String(n);
    lien.dataset.compte = n ? "oui" : "non";
    lien.dataset.pause = r?.pause ? "oui" : "non";
    const pause = r?.pause ? " Le coin des joueurs est en pause." : "";
    lien.title = (n ? `${pluriel(n, "demande de joueur attend", "demandes de joueurs attendent")} : ouvrir la boîte.` : "Aucune demande de joueur en attente.") + pause;
    lien.setAttribute("aria-label", `Demandes des joueurs : ${n || "aucune"} en attente${pause ? ", coin en pause" : ""}`);
  };
  const relire = () => api.get("/api/demandes/resume").then(montrer).catch(() => {});
  lien.hidden = false;
  relire();
  ecouterDemandes(montrer);
  setInterval(relire, RELIRE);
  window.addEventListener("focus", relire);
}

// ---------------------------------------------------------------- la page

export class BoiteDemandes {
  constructor(racine) {
    this.racine = racine;
    this.detruit = false;
    this.vue = null;
    this.lecture = 0;
    // L'histoire d'un héros (lore.js) s'ouvre sur sa comparaison, passage par passage.
    this.lore = new ComparaisonLore(() => this.relire());
    // Une activité entre les séances (activites.js) s'ouvre sur son jet et l'or à valider.
    this.activites = new ValidationActivite(() => this.relire());
  }

  async demarrer() {
    this.racine.innerHTML = `
      <section class="page-liste boite-demandes">
        <header class="titre-page">
          <p class="kicker">Le coin des joueurs</p>
          <h1>Demandes des joueurs</h1>
          <p class="chapo">Ce que les joueurs vous demandent depuis leur téléphone : ${estInvite() ? "un mot qui vous est adressé, une commande à l'une de vos boutiques, un pion bougé sur l'un de vos plans" : "un mot, une commande à l'échoppe, un aventurier à accueillir"}. La page se tient à jour seule ; ce que vous écrivez n'est jamais effacé par une arrivée.</p>
        </header>
        <div class="etat-coin" aria-live="polite"></div>
        <div class="outils-boite"><button type="button" class="bouton-commandes" data-commandes hidden>Traiter les commandes<span class="compte-commandes"></span></button></div>
        <div class="contenu-boite"><div class="chargement">Ouverture de la boîte…</div></div>
      </section>`;
    this.section = this.racine.querySelector(".boite-demandes");
    this.contenu = this.section.querySelector(".contenu-boite");
    // Les écouteurs vont sur la section, recréée à chaque page : jamais sur #page.
    this.section.addEventListener("click", (ev) => this.clic(ev));
    this.section.addEventListener("submit", (ev) => this.soumettre(ev));
    this.section.addEventListener("input", (ev) => this.saisie(ev));
    this.boutonCommandes = this.section.querySelector("[data-commandes]");
    this.commandes = new Commandes(this.boutonCommandes);
    await this.relire();
    if (this.detruit) return;
    this.fin = ecouterDemandes(() => this.relire());
    this.minuterie = setInterval(() => this.relire(), RELIRE);
  }

  detruire() {
    this.detruit = true;
    this.fin?.();
    clearInterval(this.minuterie);
    this.commandes?.detruire();
    this.lore.fermer();
    this.activites.fermer();
  }

  async relire() {
    const n = ++this.lecture;
    let v;
    try {
      v = await api.get("/api/demandes");
    } catch (err) {
      if (!this.vue && !this.detruit) this.contenu.innerHTML = `<p class="vide">La boîte ne s'ouvre pas : ${e(err.message)}.</p>`;
      return;
    }
    if (this.detruit || n !== this.lecture) return;
    this.vue = v;
    this.afficher();
    this.lore.verifier(v);
    this.activites.verifier(v);
    this.commandes?.relire();
  }

  // ------------------------------------------------------------ dessin

  afficher() {
    const v = this.vue;
    // Rouvrir le coin est un réglage du compte principal : un MJ invité lit seulement que le coin est en pause.
    this.section.querySelector(".etat-coin").innerHTML = v.pause
      ? `<p class="coin-en-pause"><b>Le coin est en pause</b> : les joueurs lisent, mais rien de ce qu'ils écrivent ne part.${estInvite() ? "" : ' <button type="button" data-rouvrir>Rouvrir le coin</button>'}</p>`
      : "";
    const commandes = v.attente.filter((x) => x.type === "commande").length;
    this.boutonCommandes.hidden = !commandes;
    // Ce que le MJ est en train d'écrire reste tel quel, à sa place, même si la demande a changé entre-temps.
    const touchees = new Map([...this.contenu.querySelectorAll(".a-traiter [data-cle]")].filter((li) => this.touchee(li)).map((li) => [li.dataset.cle, li]));
    const parJoueur = new Map();
    for (const x of v.attente) {
      if (!parJoueur.has(x.joueur)) parJoueur.set(x.joueur, { nom: x.joueur_nom, liste: [] });
      parJoueur.get(x.joueur).liste.push(x);
    }
    this.contenu.innerHTML = `
      <section class="a-traiter">
        <h2>À traiter${v.compte ? ` <span class="compte">${v.compte}</span>` : ""}</h2>
        ${parJoueur.size ? [...parJoueur.values()].map((g) => `
          <section class="joueur-demandes">
            <h3>${e(g.nom)}</h3>
            <ul class="demandes-mj">${g.liste.map((x) => this.htmlAttente(x)).join("")}</ul>
          </section>`).join("") : `<p class="vide">Rien n'attend. Quand un joueur vous écrit, passe commande ${estInvite() ? "à l'une de vos boutiques ou bouge son pion sur l'un de vos plans" : "ou vous envoie son aventurier"}, la pastille « Demandes » de l'en-tête s'allume${v.telegram && v.telegram_configure ? " et Telegram vous prévient" : ""}.</p>`}
      </section>
      <section class="historique-demandes">
        <h2>Récemment</h2>
        ${v.historique.length ? `<ul class="historique-mj">${v.historique.map((x) => this.htmlHistorique(x)).join("")}</ul>` : '<p class="vide">Rien encore.</p>'}
      </section>
      ${estInvite() ? "" : `<p class="aide reglages-boite">${this.phraseTelegram(v)} <a href="#/reglages/coin">Réglages</a>.</p>`}`;
    for (const [cle, ancien] of touchees) {
      const neuf = this.contenu.querySelector(`.a-traiter [data-cle="${CSS.escape(cle)}"]`);
      if (neuf) {
        // Même demande : la saisie revient, avec la version d'aujourd'hui si rien d'autre n'a bougé.
        neuf.replaceWith(ancien);
        continue;
      }
      ancien.classList.add("perimee");
      ancien.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      this.erreur(ancien, "Cette demande n'attend plus : elle a été traitée sur un autre écran, ou le joueur l'a retirée. Ce que vous aviez écrit reste ici.");
      (this.contenu.querySelector(".demandes-mj") || this.contenu.querySelector(".a-traiter")).prepend(ancien);
    }
  }

  phraseTelegram(v) {
    if (!v.telegram_configure) return "Telegram n'est pas branché sur le serveur : seule la pastille vous prévient.";
    return v.telegram ? "Telegram vous prévient : un message par vague, avec le prénom du joueur et ce qu'il demande, jamais son texte."
      : "Telegram ne vous prévient pas en ce moment.";
  }

  htmlAttente(x) {
    const tete = `<p class="quoi"><b>${e(x.genre_nom)}</b> <span class="quand">${e(quand(x.cree))}</span></p>`;
    const cle = `${x.type}/${x.joueur}/${x.id}`;
    if (x.type === "commande") {
      const total = x.total ? `${x.total} po${x.a_fixer ? " et un prix à fixer" : ""}` : x.a_fixer ? "prix à fixer" : "";
      return `<li class="demande-mj commande" data-cle="${e(cle)}">${tete}
        <p>${e([x.boutique_nom, pluriel(x.articles || 0, "article", "articles"), total].filter(Boolean).join(" · "))}</p>
        <div class="actions"><button type="button" data-traiter-commandes>Traiter</button></div></li>`;
    }
    if (x.type === "aventurier") {
      return `<li class="demande-mj aventurier" data-cle="${e(cle)}">${tete}
        <p>« ${e(x.aventurier || "Sans nom")} »${x.retouche ? ", retouché depuis l'envoi" : ""} : à accueillir dans la tablée.</p>
        <div class="actions"><a class="bouton" href="#/aventuriers">Ouvrir les joueurs</a></div></li>`;
    }
    if (x.genre === "lore") return htmlCarteLore(x, cle);
    if (x.genre === "activite") return htmlCarteActivite(x, cle);
    if (x.statut === "a-appliquer") {
      return `<li class="demande-mj en-route" data-cle="${e(cle)}">${tete}${this.htmlCorps(x)}<p class="aide">L'atelier l'applique dans un instant.</p></li>`;
    }
    return `<li class="demande-mj" data-cle="${e(cle)}" data-joueur="${e(x.joueur)}" data-id="${e(x.id)}" data-version="${e(x.version)}" data-oui="${e(x.oui)}">
      ${tete}${this.htmlCorps(x)}
      <form class="reponse-mj">
        <label class="champ">${x.non ? "Un mot pour le joueur (facultatif)" : "Lui répondre d'un mot (facultatif)"}
          <textarea name="mot" rows="2" maxlength="300" placeholder="${x.non ? "Il le lira dans son carnet" : "Il le lira dans son carnet, sous son mot"}"></textarea></label>
        <div class="actions">
          <button type="submit" class="principal" data-geste="accepter">${e(x.oui)}</button>
          ${x.non ? `<button type="submit" data-geste="refuser">${e(x.non)}</button>` : ""}
        </div>
        <p class="erreur-demande" role="alert" hidden></p>
      </form></li>`;
  }

  htmlCorps(x) {
    const c = x.corps || {};
    if (x.genre === "message") return `<blockquote class="texte-joueur">${lignes(c.texte)}</blockquote>`;
    // Un portrait : l'image envoyée, ou celle qu'il a choisie.
    if (GENRES_PORTRAIT.includes(x.genre)) return htmlImagePortrait(x);
    // La ligne que l'atelier en écrit : « Jeanne donne 20 po à Mathis ».
    if (x.phrase) return `<p class="phrase-demande">${e(x.phrase)}</p>`;
    // Un genre à venir sans dessin propre : ses champs, en clair.
    const champs = Object.entries(c).filter(([, val]) => ["string", "number", "boolean"].includes(typeof val));
    return champs.length ? `<dl class="corps-demande">${champs.map(([k, val]) => `<div><dt>${e(k)}</dt><dd>${e(val)}</dd></div>`).join("")}</dl>` : "";
  }

  htmlHistorique(x) {
    const extrait = x.genre === "message" ? String(x.corps?.texte || "").replace(/\s+/g, " ").slice(0, 140) : "";
    return `<li class="${e(x.statut)}" data-joueur="${e(x.joueur)}" data-id="${e(x.id)}" data-version="${e(x.version)}">
      <p><b>${e(x.joueur_nom)}</b> · ${e(x.genre_nom)} · ${e(x.statut_dit)}${x.traitee || x.modifie ? ` ${e(quand(x.traitee || x.modifie))}` : ""}</p>
      ${extrait ? `<p class="extrait">« ${e(extrait)}${extrait.length >= 140 ? "…" : ""} »</p>` : ""}
      ${x.phrase ? `<p class="extrait phrase-demande">${e(x.phrase)}</p>` : ""}
      ${GENRES_PORTRAIT.includes(x.genre) && x.statut !== "retiree" ? htmlImagePortrait(x, { petite: true }) : ""}
      ${x.mot ? `<p class="mot-mj">Votre mot : « ${e(x.mot)} »</p>` : ""}
      ${x.resultat && !(x.phrase && ["appliquee", "acceptee"].includes(x.statut)) ? `<p class="resultat${x.statut === "echec" ? " echec" : ""}">${e(x.resultat)}</p>` : ""}
      ${x.annulable ? `<button type="button" data-annuler>Annuler</button>` : ""}
      ${x.genre === "activite" && x.statut !== "echec" ? `<button type="button" data-activite-ouvrir>Revoir, créer une suite</button>` : ""}
      ${htmlBoutonConfie(x)}
    </li>`;
  }

  // ------------------------------------------------------------ gestes

  // Le MJ y écrit, ou y a écrit : la carte reste (une carte périmée s'en va dès que son mot est effacé).
  touchee(li) {
    const champ = li.querySelector("textarea");
    return Boolean(champ && (champ.value.trim() || li.contains(document.activeElement)));
  }

  erreur(li, message) {
    const p = li.querySelector(".erreur-demande");
    if (!p) return toast(message, "erreur");
    p.textContent = message;
    p.hidden = !message;
  }

  saisie(ev) {
    const champ = ev.target.closest("textarea[name=mot]");
    if (!champ) return;
    const li = champ.closest("[data-oui]");
    const bouton = li?.querySelector('[data-geste="accepter"]');
    // « Lu » devient « Répondre » dès qu'il y a un mot (un genre qui se refuse garde son « Accepter »).
    if (bouton && li.dataset.oui === "Lu") bouton.textContent = champ.value.trim() ? "Répondre" : "Lu";
  }

  async soumettre(ev) {
    const form = ev.target.closest(".reponse-mj");
    if (!form) return;
    ev.preventDefault();
    const li = form.closest("[data-id]");
    const geste = ev.submitter?.dataset.geste || "accepter";
    const mot = form.mot.value.trim();
    const boutons = [...form.querySelectorAll("button")];
    boutons.forEach((b) => { b.disabled = true; });
    this.erreur(li, "");
    try {
      await api.post(`/api/demandes/${encodeURIComponent(li.dataset.joueur)}/${encodeURIComponent(li.dataset.id)}/${geste}`, { version: Number(li.dataset.version), mot });
    } catch (err) {
      boutons.forEach((b) => { b.disabled = false; });
      this.erreur(li, err.message);
      if (err.status === 404 || err.status === 409) this.relire();
      return;
    }
    const qui = li.closest(".joueur-demandes")?.querySelector("h3")?.textContent || "Le joueur";
    form.mot.value = "";
    toast(geste === "refuser" ? `Refusé : ${qui} le lira dans son carnet.` : mot ? `Réponse envoyée : ${qui} la lira dans son carnet.` : `Lu : ${qui} le verra dans son carnet.`);
    li.remove();
    this.relire();
  }

  async clic(ev) {
    if (ev.target.closest("[data-traiter-commandes]")) return this.boutonCommandes.click();
    const lore = ev.target.closest("[data-lore-ouvrir]")?.closest("[data-id]");
    if (lore) return this.lore.ouvrir(lore.dataset.joueur, lore.dataset.id);
    const activite = ev.target.closest("[data-activite-ouvrir]")?.closest("[data-id]");
    if (activite) return this.activites.ouvrir(activite.dataset.joueur, activite.dataset.id);
    const confie = ev.target.closest("[data-confie-ouvrir]")?.closest("[data-joueur]");
    if (confie) return ouvrirConfie(confie.dataset.joueur);
    if (ev.target.closest("[data-rouvrir]")) {
      try {
        await api.put("/api/demandes/reglages", { pause: false });
        toast("Le coin est rouvert : les joueurs peuvent de nouveau écrire.");
      } catch (err) {
        toast(`Le coin ne se rouvre pas : ${err.message}`, "erreur");
      }
      return this.relire();
    }
    const annuler = ev.target.closest("[data-annuler]");
    if (annuler) {
      const li = annuler.closest("[data-id]");
      annuler.disabled = true;
      try {
        await api.post(`/api/demandes/${encodeURIComponent(li.dataset.joueur)}/${encodeURIComponent(li.dataset.id)}/annuler`, { version: Number(li.dataset.version) });
        toast("Annulé : le joueur le verra dans son carnet.");
      } catch (err) {
        annuler.disabled = false;
        toast(`Rien d'annulé : ${err.message}`, "erreur");
      }
      this.relire();
    }
  }
}
