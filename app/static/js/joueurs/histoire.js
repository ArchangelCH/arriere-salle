// « L'histoire de mon héros », dans le coin des joueurs : le joueur étoffe le récit de sa fiche (qui il est, d'où
// il vient, comment on le voit, ceux qu'il connaît, ce qui le distingue) à son rythme, puis l'envoie au MJ, qui accepte,
// retouche ou refuse chaque passage dans sa boîte. Tout s'enregistre au fil de la frappe (PUT /api/lore ; le témoin dit où
// on en est) ; « Envoyer au MJ » en fait une demande (POST /api/lore/envoyer). Un passage que le MJ garde (il nomme ce que
// les joueurs ne savent pas encore) se montre en lecture seule, sans son texte. La page se relit quand l'atelier republie
// la fiche (flux « carnet ») ou tranche (flux « demandes »), sans jamais toucher au passage qu'on est en train d'écrire :
// sur un téléphone, remplacer le champ où l'on écrit fermerait le clavier. Tout texte passe par echapper.

import { echapper as e } from "../api.js";
import { ecart, htmlEcart } from "../lore/ecart.js";
import { injoignable, Reessai } from "../commun/reessai.js";
import { afficherTemoin, htmlTemoin } from "../commun/temoin-enregistrement.js";
import { dateFr, demander, heureFr, pageErreur, pageFermee } from "./carnet-vue.js";
import { bandeauPause } from "./demandes.js";
import { ecouterFlux } from "./flux.js";
import { AIDE } from "./histoire-aide.js";
import "./pied-coin.js";

const ATTENTE = 900; // millisecondes sans frappe avant d'enregistrer
const RESTE = 600; // signes restants à partir desquels le compte s'affiche
const quand = (iso) => [dateFr(iso, { jour: false }), heureFr(iso)].filter(Boolean).join(" à ");
const paragraphes = (t) => String(t || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${e(x)}</p>`).join("");
const prenom = (nom) => String(nom || "").split(/[\s,]+/)[0];
const TAMPONS = { brouillon: "Brouillon", envoye: "Envoyé au MJ", "a-renvoyer": "Changé depuis l'envoi", refuse: "Refusé" };
const ISSUES = { acceptee: "accepté", retouchee: "retouché par votre MJ", refusee: "refusé" };
// Comme le serveur (lore.propre) : ce qui ne compte pas pour dire qu'un passage a changé.
const net = (t) => String(t ?? "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();

class MonHistoire {
  constructor(page) {
    this.page = page;
    this.etat = null; // la dernière réponse de GET /api/lore
    this.locaux = {}; // ce qui est tapé et pas encore enregistré, par passage
    this.bases = {}; // le texte de la fiche que la page montrait quand le joueur a commencé un passage
    this.effacer = new Set(); // les passages ramenés au texte de la fiche, à enregistrer
    this.relus = new Set(); // ceux dont le joueur garde sa version après avoir lu celle du MJ
    this.minuterie = 0;
    this.enCours = null; // l'enregistrement qui part
    this.encore = false;
    this.lecture = 0;
    this.structure = "";
    this.confirmer = null; // le passage dont on confirme l'abandon du texte
    this.envoi = false;
    this.messages = {}; // un refus du serveur, par passage
    this.message = ""; // un refus de l'envoi
    this.temoin = { etat: "ok", modifie: null, texte: "" };
    this.reessai = new Reessai(() => this.enregistrer(), () => this.majTemoin());
    this.avis = null;
    for (const sujet of ["carnet", "demandes"]) ecouterFlux(sujet, () => this.relire({ dire: sujet === "demandes" }));
    ecouterFlux("pause", async () => {
      await this.relire();
      if (!this.etat?.pause && Object.keys(this.locaux).length) this.enregistrer();
    });
    page.addEventListener("input", (ev) => this.saisie(ev));
    page.addEventListener("click", (ev) => this.clic(ev));
    page.addEventListener("focusout", () => setTimeout(() => this.apresSaisie(), 0));
    // Ce qui n'est pas encore parti part avant que la page se cache (téléphone en poche, autre onglet).
    // Revenue sous les yeux (l'histoire a pu s'écrire sur un autre appareil entre-temps), elle se relit.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && Object.keys(this.locaux).length) this.enregistrer();
      else if (document.visibilityState === "visible" && this.etat) this.relire();
    });
    window.addEventListener("beforeunload", (ev) => {
      if (!Object.keys(this.locaux).length) return;
      this.enregistrer();
      ev.preventDefault();
      ev.returnValue = "";
    });
  }

  // ------------------------------------------------------------ lecture

  async relire({ dire = false } = {}) {
    const n = ++this.lecture;
    let r;
    try {
      r = await demander("GET", "/api/lore");
    } catch (err) {
      if (n === this.lecture && !this.etat) pageErreur(this.page, err);
      return;
    }
    if (n !== this.lecture) return;
    const avant = this.etat;
    this.etat = r;
    this.afficher();
    if (dire && avant) this.direCeQuiAChange(avant, r);
  }

  // La forme de la page : ce qui, en changeant, demande de la redessiner (un passage devenu tenu, le carnet fermé).
  forme(r) {
    if (!r.ouvert || !r.heros) return `${r.ouvert}|${Boolean(r.heros)}`;
    return [r.heros.nom, r.heros.genre, ...r.passages.map((p) => `${p.cle}:${p.tenu}:${p.tenu && p.brouillon !== null}`)].join("|");
  }

  enEcriture() {
    const actif = document.activeElement;
    return Boolean(actif && this.page.contains(actif) && actif.matches("textarea"));
  }

  afficher() {
    const r = this.etat;
    if (!r.ouvert) {
      this.structure = "ferme";
      return pageFermee(this.page);
    }
    if (!r.heros) {
      this.structure = "sans-heros";
      this.page.innerHTML = `<section class="feuille-coin message-coin"><p class="kicker">L'histoire de mon héros</p>
        <h1>Pas encore de héros</h1><p>Votre héros doit d'abord être accueilli dans la tablée par le MJ : son histoire s'écrit ensuite d'ici.</p>
        <p><a href="/">Mon aventurier</a></p></section>`;
      return;
    }
    const forme = this.forme(r);
    if (forme !== this.structure && !this.enEcriture()) {
      this.structure = forme;
      this.dessiner();
    } else this.maj();
  }

  passage(cle) {
    return this.etat?.passages?.find((p) => p.cle === cle);
  }

  // Le texte que montre le champ d'un passage : ce qui est tapé ici, sinon le brouillon, sinon la fiche.
  texteDe(p) {
    return this.locaux[p.cle] ?? p.brouillon ?? p.publie;
  }

  // ------------------------------------------------------------ dessin

  dessiner() {
    const r = this.etat;
    const h = r.heros;
    const groupes = [];
    for (const p of r.passages) {
      if (!groupes.length || groupes[groupes.length - 1].cle !== p.groupe) groupes.push({ cle: p.groupe, passages: [] });
      groupes[groupes.length - 1].passages.push(p);
    }
    this.page.innerHTML = `
      <a class="retour-coin" href="/carnet#heros">Retour à ma fiche</a>
      <article class="feuille-coin feuille-histoire">
        <span class="signet" aria-hidden="true"></span>
        <header class="titre-histoire">
          <p class="kicker">Mon héros</p>
          <h1>L'histoire de ${e(prenom(h.nom) || "mon héros")}</h1>
          <p class="chapo">${e(h.genre === "f" ? "Son passé, ce qui la pousse, ceux qu'elle connaît" : "Son passé, ce qui le pousse, ceux qu'il connaît")} : écrivez à votre rythme, tout s'enregistre au fil de la plume. Votre MJ lit ce que vous lui envoyez, passage par passage ; rien ne change sur votre fiche sans lui.</p>
          <p class="ligne-temoin">${htmlTemoin("ok")}</p>
        </header>
        <div class="etat-envoi" aria-live="polite"></div>
        ${groupes.map((g) => `
          <section class="groupe-histoire" aria-labelledby="groupe-${e(g.cle)}">
            <h2 class="intertitre" id="groupe-${e(g.cle)}">${e(r.groupes?.[g.cle] || "")}</h2>
            ${g.passages.map((p) => this.htmlPassage(p)).join("")}
          </section>`).join("")}
        <div class="barre-envoi">
          <p class="compte-envoi" aria-live="polite"></p>
          <button type="button" class="envoyer-coin" data-action="envoyer">Envoyer au MJ</button>
        </div>
        <p class="refus-coin refus-envoi" role="alert" hidden></p>
        <section class="envois-histoire" id="envois" aria-labelledby="titre-envois">
          <header class="tete-section"><h2 id="titre-envois">Vos envois</h2><span class="filet" aria-hidden="true"></span>
            <p class="sous-titre">Ce que votre MJ a fait de chaque passage, et son mot s'il vous en a laissé un.</p></header>
          <div class="liste-envois"></div>
        </section>
      </article>`;
    for (const t of this.page.querySelectorAll("textarea[data-cle]")) this.ajuster(t);
    for (const zone of this.page.querySelectorAll("[data-aide]")) this.monterAide(zone);
    this.maj();
  }

  htmlPassage(p) {
    const id = `texte-${p.cle}`;
    const lignes = p.cle === "histoire" ? 6 : 3;
    const corps = p.tenu
      ? `<p class="tenu-passage">Votre MJ garde ce passage pour l'instant.</p><div class="brouillon-tenu" hidden></div>`
      : `<textarea id="${id}" data-cle="${e(p.cle)}" rows="${lignes}" maxlength="${e(this.etat.max)}" spellcheck="true" autocapitalize="sentences"
          aria-describedby="aide-${e(p.cle)}">${e(this.texteDe(p))}</textarea>
        <div class="aide-ecriture" data-aide="${e(p.cle)}" hidden></div>`;
    return `
      <section class="passage" data-passage="${e(p.cle)}">
        <header class="tete-passage">
          ${p.tenu ? `<h3 class="nom-passage">${e(p.nom)}</h3>` : `<label class="nom-passage" for="${id}">${e(p.nom)}</label>`}
          <span class="tampon-passage" hidden></span>
        </header>
        <p class="aide-passage" id="aide-${e(p.cle)}">${e(p.aide)}</p>
        ${corps}
        <div class="notes-passage"></div>
        <p class="refus-coin refus-passage" role="alert" hidden></p>
        <p class="pied-passage"><span class="reste" aria-live="polite"></span></p>
      </section>`;
  }

  // L'emplacement de l'aide à l'écriture : rien tant qu'aucun module n'y est branché.
  monterAide(zone) {
    if (typeof AIDE.monter !== "function") return;
    const cle = zone.dataset.aide;
    const champ = this.page.querySelector(`textarea[data-cle="${CSS.escape(cle)}"]`);
    const p = this.passage(cle);
    if (!champ || !p) return;
    AIDE.monter(zone, {
      cle,
      nom: p.nom,
      lire: () => champ.value,
      ecrire: (texte) => {
        champ.value = String(texte ?? "");
        champ.dispatchEvent(new Event("input", { bubbles: true }));
      },
    });
  }

  // Ce qui change sans toucher aux champs où l'on écrit : tampons, avis, compte, envoi, historique.
  maj() {
    const r = this.etat;
    if (!r?.heros || !this.page.querySelector(".feuille-histoire")) return;
    for (const p of r.passages) this.majPassage(p);
    this.majEnvoi();
    this.majHistorique();
    this.majTemoin();
  }

  majPassage(p) {
    const s = this.page.querySelector(`[data-passage="${CSS.escape(p.cle)}"]`);
    if (!s) return;
    const champ = s.querySelector("textarea");
    // Un autre appareil a écrit, ou le MJ a tranché : le champ suit, sauf si l'on y écrit.
    if (champ && document.activeElement !== champ && !(p.cle in this.locaux) && champ.value !== this.texteDe(p)) {
      champ.value = this.texteDe(p);
      this.ajuster(champ);
    }
    const local = p.cle in this.locaux && net(this.locaux[p.cle]) !== net(p.brouillon ?? p.publie);
    const etat = local ? (p.etat === "fiche" || p.etat === "refuse" ? "brouillon" : p.etat === "envoye" ? "a-renvoyer" : p.etat) : p.etat;
    const tampon = s.querySelector(".tampon-passage");
    tampon.hidden = !TAMPONS[etat];
    tampon.textContent = TAMPONS[etat] || "";
    tampon.dataset.etat = etat;
    s.dataset.etat = etat;
    const notes = [];
    const confirmer = this.confirmer === p.cle;
    if (p.tenu && p.brouillon !== null) {
      const b = s.querySelector(".brouillon-tenu");
      b.hidden = false;
      b.innerHTML = `<p class="lbl">Votre brouillon, mis de côté</p><div class="texte-brouillon">${paragraphes(p.brouillon)}</div>
        <p class="actions-passage">${confirmer ? this.htmlConfirmer() : '<button type="button" class="secondaire" data-action="revenir">Effacer ce brouillon</button>'}</p>`;
    }
    if (!p.tenu && p.change_depuis) {
      notes.push(`<div class="note-passage change-depuis">
        <p>Votre MJ a changé ce passage sur votre fiche depuis que vous l'avez commencé.</p>
        <details><summary>Voir sa version</summary><div class="version-fiche">${paragraphes(p.publie) || '<p class="vide">Le passage est vide sur la fiche.</p>'}</div></details>
        <p class="actions-passage"><button type="button" class="secondaire" data-action="reprendre">Repartir de sa version</button>
          <button type="button" class="secondaire" data-action="garder">Garder la mienne</button></p></div>`);
    }
    if (!p.tenu && p.dernier && (p.etat === "fiche" || p.etat === "refuse") && !local) {
      const d = p.dernier;
      const retouche = d.issue === "retouchee" && d.propose && p.etat === "fiche"
        ? `<details><summary>Ce qu'il a changé à votre texte</summary><div class="ecart-passage">${htmlEcart(ecart(d.propose, p.publie), e)}</div></details>` : "";
      const suite = d.issue === "refusee" && p.etat === "refuse" ? " Votre texte reste ici : retravaillez-le, ou revenez à celui de la fiche." : "";
      notes.push(`<div class="note-passage issue-${e(d.issue)}"><p>${e(`Dernier envoi : ${ISSUES[d.issue] || d.issue}${d.quand ? ` le ${quand(d.quand)}` : ""}.`)}${e(suite)}</p>${retouche}</div>`);
    }
    if (!p.tenu && (p.brouillon !== null || local)) {
      notes.push(`<p class="actions-passage revenir-passage">${confirmer ? this.htmlConfirmer() : '<button type="button" class="lien-passage" data-action="revenir">Revenir au texte de la fiche</button>'}</p>`);
    }
    s.querySelector(".notes-passage").innerHTML = notes.join("");
    const refus = s.querySelector(".refus-passage");
    refus.hidden = !this.messages[p.cle];
    refus.textContent = this.messages[p.cle] || "";
    if (champ) this.compter(champ);
  }

  htmlConfirmer() {
    return `<span class="confirmer-passage">Votre texte de ce passage s'efface.
      <button type="button" class="envoyer-coin" data-action="revenir-oui">Effacer</button>
      <button type="button" class="secondaire" data-action="revenir-non">Garder</button></span>`;
  }

  compter(champ) {
    const reste = Number(this.etat?.max || 8000) - champ.value.length;
    const p = champ.closest(".passage")?.querySelector(".reste");
    if (p) p.textContent = reste <= RESTE ? `${reste} signe${reste > 1 ? "s" : ""} restant${reste > 1 ? "s" : ""}` : "";
  }

  ajuster(champ) {
    champ.style.height = "auto";
    champ.style.height = `${champ.scrollHeight + 2}px`;
  }

  // Ce qui partirait à l'envoi : les passages dont le texte n'est plus celui de la fiche (ou de l'envoi qui attend).
  aEnvoyer() {
    const r = this.etat;
    const liste = [];
    for (const p of r.passages) {
      if (p.tenu) continue;
      // Un texte refusé, que le joueur n'a pas retouché depuis, ne repart pas de lui-même.
      if (p.etat === "refuse" && !(p.cle in this.locaux)) continue;
      const texte = p.cle in this.locaux ? this.locaux[p.cle] : p.brouillon;
      if (texte !== null && texte !== undefined && net(texte) !== net(p.publie)) liste.push(p);
    }
    return liste;
  }

  majEnvoi() {
    const r = this.etat;
    const zone = this.page.querySelector(".etat-envoi");
    const v = r.envoi;
    zone.innerHTML = v ? `<div class="envoi-en-attente">
        <p><b>Envoyé au MJ</b> ${e(v.cree ? `le ${quand(v.cree)}` : "")} : ${e(v.passages.map((x) => x.nom).join(", "))}. Il le lira dans sa boîte ; vous pouvez continuer d'écrire.</p>
        <button type="button" class="secondaire" data-action="retirer" data-id="${e(v.id)}"${r.pause ? " disabled" : ""}>Retirer l'envoi</button></div>` : "";
    const liste = this.aEnvoyer();
    const tenus = r.passages.filter((p) => p.tenu && p.brouillon !== null);
    const changes = liste.filter((p) => !v || p.etat !== "envoye" || p.cle in this.locaux);
    const compte = this.page.querySelector(".compte-envoi");
    const bouton = this.page.querySelector("[data-action=envoyer]");
    if (r.pause) compte.textContent = "Le coin est en pause : vos passages s'enregistreront, et partiront, quand votre MJ le rouvrira.";
    else if (tenus.length) compte.textContent = `Effacez d'abord votre brouillon de « ${tenus[0].nom} » : votre MJ garde ce passage.`;
    else if (changes.length) compte.textContent = `${changes.length} passage${changes.length > 1 ? "s" : ""} à envoyer${v ? " : votre envoi en attente sera remplacé" : ""}.`;
    else if (v) compte.textContent = "Tout est envoyé : votre MJ n'a plus qu'à lire.";
    else compte.textContent = "Rien à envoyer pour l'instant : écrivez dans un passage, il s'enregistre tout seul.";
    bouton.textContent = v && changes.length ? "Renvoyer au MJ" : "Envoyer au MJ";
    bouton.disabled = this.envoi || r.pause || !changes.length || Boolean(tenus.length);
    const refus = this.page.querySelector(".refus-envoi");
    refus.hidden = !this.message;
    refus.textContent = this.message;
  }

  majHistorique() {
    const liste = this.etat.historique || [];
    this.page.querySelector(".liste-envois").innerHTML = liste.length ? `<ol class="envois-coin">${liste.map((d) => `
      <li class="envoi-coin statut-${e(d.statut)}">
        <p class="tete-demande"><b>${e(d.traitee ? `Lu le ${quand(d.traitee)}` : quand(d.cree))}</b><span class="statut">${e(d.statut_dit)}</span></p>
        <ul class="issues-envoi">${d.passages.map((x) => `<li class="issue-${e(x.issue || "")}"><span>${e(x.nom)}</span><i>${e(ISSUES[x.issue] || "")}</i></li>`).join("")}</ul>
        ${d.mot ? `<p class="mot-du-mj"><span class="lbl">Votre MJ</span>${e(d.mot)}</p>` : ""}
      </li>`).join("")}</ol>` : '<p class="vide">Rien encore : vos envois et ce que votre MJ en a fait paraîtront ici.</p>';
  }

  majTemoin() {
    const t = this.page.querySelector(".temoin-enregistrement");
    if (!t) return;
    const pause = this.etat?.pause && Object.keys(this.locaux).length;
    afficherTemoin(t, this.temoin.etat, { reessai: this.reessai, modifie: this.temoin.modifie,
      texte: pause ? "En pause : enregistré à la réouverture" : this.temoin.texte });
  }

  etatTemoin(etat, { modifie = null, texte = "" } = {}) {
    this.temoin = { etat, modifie: modifie ?? this.temoin.modifie, texte };
    this.majTemoin();
  }

  // Une décision du MJ vient d'arriver : un avis au bas de l'écran.
  direCeQuiAChange(avant, apres) {
    const neuf = (apres.historique || [])[0];
    if (!neuf || (avant.historique || []).some((d) => d.id === neuf.id)) return;
    this.avis?.remove();
    const a = document.createElement("div");
    a.className = "avis-coin";
    a.setAttribute("role", "status");
    a.innerHTML = `<span>Votre MJ a lu votre histoire.</span><a href="#envois">Voir</a>`;
    a.addEventListener("click", () => a.remove());
    document.body.append(a);
    this.avis = a;
    setTimeout(() => a.remove(), 9000);
  }

  // ------------------------------------------------------------ écrire

  saisie(ev) {
    const champ = ev.target.closest("textarea[data-cle]");
    if (!champ) return;
    const cle = champ.dataset.cle;
    const p = this.passage(cle);
    if (!p || p.tenu) return;
    // Le texte de la fiche qu'il avait sous les yeux en commençant : c'est lui que le MJ verra comme « avant ».
    if (p.brouillon === null && !(cle in this.bases)) this.bases[cle] = p.publie;
    this.locaux[cle] = champ.value;
    delete this.messages[cle];
    this.ajuster(champ);
    this.majPassage(p);
    this.majEnvoi();
    this.etatTemoin("modifie");
    clearTimeout(this.minuterie);
    this.minuterie = setTimeout(() => this.enregistrer(), ATTENTE);
  }

  // Le champ quitté : ce qui a changé de forme pendant la frappe (un passage devenu tenu) se redessine.
  apresSaisie() {
    if (this.etat && !this.enEcriture() && this.forme(this.etat) !== this.structure) this.afficher();
  }

  // Un enregistrement à la fois ; une frappe pendant l'envoi en relance un, avec le texte du moment.
  enregistrer() {
    clearTimeout(this.minuterie);
    if (this.enCours) {
      this.encore = true;
      return this.enCours;
    }
    const champs = { ...this.locaux };
    const effacer = [...this.effacer];
    const relus = [...this.relus];
    if (!Object.keys(champs).length && !effacer.length && !relus.length) return Promise.resolve(true);
    if (this.etat?.pause) {
      this.majTemoin();
      return Promise.resolve(false);
    }
    const bases = Object.fromEntries(Object.keys(champs).filter((k) => k in this.bases).map((k) => [k, this.bases[k]]));
    this.etatTemoin("enregistrement");
    this.enCours = (async () => {
      let ok = false;
      try {
        const r = await demander("PUT", "/api/lore", { champs, bases, effacer, relus });
        for (const [k, v] of Object.entries(champs)) {
          if (this.locaux[k] === v) {
            delete this.locaux[k];
            delete this.bases[k];
          }
        }
        for (const k of effacer) this.effacer.delete(k);
        for (const k of relus) this.relus.delete(k);
        this.etat = r;
        this.reessai.reussite();
        this.etatTemoin(Object.keys(this.locaux).length ? "modifie" : "ok", { modifie: r.enregistre });
        this.afficher();
        ok = true;
      } catch (err) {
        if (err.status === 401 || err.status === 403) return pageErreur(this.page, err);
        if (injoignable(err)) {
          this.reessai.echec(err);
          this.etatTemoin("erreur");
        } else if (err.status === 423) {
          // En pause (ou carnet fermé) : le texte reste ici, il partira à la réouverture.
          this.etatTemoin("erreur", { texte: this.etat?.pause ? "" : "Non enregistré" });
          await this.relire();
        } else {
          // Un refus pour un passage (tenu, trop long) : dit sous ce passage ; le texte tapé reste.
          const cle = Object.keys(champs).find((k) => err.message.includes(this.passage(k)?.nom || "\u0000")) || Object.keys(champs)[0];
          if (cle) this.messages[cle] = err.message;
          else this.message = err.message;
          this.etatTemoin("erreur", { texte: "Non enregistré" });
          await this.relire();
        }
      }
      return ok;
    })().finally(() => {
      this.enCours = null;
      if (this.encore) {
        this.encore = false;
        this.enregistrer();
      }
    });
    return this.enCours;
  }

  async envoyer(bouton) {
    if (this.envoi) return;
    this.envoi = true;
    bouton.disabled = true;
    this.message = "";
    try {
      // Ce qui est tapé part d'abord : l'envoi prend le brouillon tel qu'il est sur le serveur.
      while (this.enCours || Object.keys(this.locaux).length) {
        if (!(await this.enregistrer())) throw Object.assign(new Error("votre texte n'est pas encore enregistré, réessayez dans un instant"), { status: 0 });
      }
      const r = await demander("POST", "/api/lore/envoyer", {});
      this.etat = r;
      this.envoi = false;
      this.afficher();
      this.page.querySelector(".etat-envoi")?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      this.envoi = false;
      if (err.status === 401 || err.status === 403) return pageErreur(this.page, err);
      this.message = `Rien n'est parti : ${err.message}`;
      await this.relire();
    }
  }

  async clic(ev) {
    const b = ev.target.closest("[data-action]");
    if (!b || b.disabled) return;
    const cle = b.closest("[data-passage]")?.dataset.passage;
    const p = cle ? this.passage(cle) : null;
    const action = b.dataset.action;
    if (action === "envoyer") return this.envoyer(b);
    if (action === "retirer") {
      b.disabled = true;
      try {
        await demander("DELETE", `/api/demandes/${encodeURIComponent(b.dataset.id)}`);
      } catch (err) {
        this.message = `Rien de retiré : ${err.message}`;
      }
      return this.relire();
    }
    if (!p) return;
    if (action === "revenir") {
      this.confirmer = cle;
      return this.majPassage(p);
    }
    if (action === "revenir-non") {
      this.confirmer = null;
      return this.majPassage(p);
    }
    if (action === "revenir-oui" || action === "reprendre") {
      // Le texte de la fiche revient dans le champ ; le brouillon de ce passage s'en va.
      this.confirmer = null;
      delete this.locaux[cle];
      delete this.bases[cle];
      delete this.messages[cle];
      this.effacer.add(cle);
      const champ = this.page.querySelector(`textarea[data-cle="${CSS.escape(cle)}"]`);
      if (champ) {
        champ.value = p.publie;
        this.ajuster(champ);
      }
      this.majPassage({ ...p, brouillon: null, etat: "fiche", change_depuis: false });
      return this.enregistrer();
    }
    if (action === "garder") {
      this.relus.add(cle);
      return this.enregistrer();
    }
  }
}

const page = document.getElementById("page");
bandeauPause();
new MonHistoire(page).relire();
