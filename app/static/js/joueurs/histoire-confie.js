// « Pour le MJ seulement », au bas de « L'histoire de mon héros » : un seul passage libre, que seul le MJ lira
// (un secret, une peur, une envie pour la suite, une limite). Il s'enregistre au fil de la frappe (PUT /api/confie) ;
// « Envoyer au MJ » le dépose tel quel sur la fiche du héros, sans validation (POST /api/confie/envoyer). Le joueur relit
// ce qu'il a confié, voit s'il est lu, le complète ou le remplace. Aucune aide à l'écriture ici : rien de ce texte ne part
// ailleurs que chez le MJ. La section vit hors de #page (histoire.js la redessine) et se cache quand la page de l'histoire
// n'a rien à montrer (carnet fermé, pas de héros, plus de session). Tout texte passe par echapper.

import { echapper as e } from "../api.js";
import { injoignable, Reessai } from "../commun/reessai.js";
import { afficherTemoin, htmlTemoin } from "../commun/temoin-enregistrement.js";
import { dateFr, demander, heureFr } from "./carnet-vue.js";
import { ecouterFlux } from "./flux.js";

const ATTENTE = 900; // millisecondes sans frappe avant d'enregistrer
const RESTE = 600; // signes restants à partir desquels le compte s'affiche
const quand = (iso) => [dateFr(iso, { jour: false }), heureFr(iso)].filter(Boolean).join(" à ");
const paragraphes = (t) => String(t || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${e(x)}</p>`).join("");
// Comme le serveur (lore.propre) : ce qui ne compte pas pour dire qu'un texte a changé.
const net = (t) => String(t ?? "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
const PARTI = ["depose", "en-route", "envoye"]; // un envoi qui est arrivé, ou qui y va

// Arrivé par « Relire ce que vous avez confié » (Mes demandes, /histoire#confie-mj) : la zone se dessine après le chargement,
// le navigateur n'a pas pu y descendre seul. L'histoire au-dessus se dessine elle aussi : on attend qu'elle soit là.
function descendre(zone) {
  const page = document.getElementById("page");
  const aller = () => zone.scrollIntoView({ block: "start" });
  if (!page || !page.querySelector(".chargement")) return aller();
  const guet = new MutationObserver(() => {
    if (page.querySelector(".chargement")) return;
    guet.disconnect();
    requestAnimationFrame(aller);
  });
  guet.observe(page, { childList: true, subtree: true });
  setTimeout(() => guet.disconnect(), 8000);
}

class Confidence {
  constructor(zone) {
    this.zone = zone;
    this.etat = null; // la dernière réponse de GET /api/confie
    this.local = null; // ce qui est tapé et pas encore enregistré
    this.minuterie = 0;
    this.enCours = null;
    this.encore = false;
    this.lecture = 0;
    this.envoi = false;
    this.message = "";
    this.temoin = { etat: "ok", modifie: null, texte: "" };
    this.reessai = new Reessai(() => this.enregistrer(), () => this.majTemoin());
    this.avis = null;
    for (const sujet of ["demandes", "carnet"]) ecouterFlux(sujet, () => this.relire({ dire: sujet === "demandes" }));
    // La pause levée, ce qui a été tapé pendant s'enregistre tout de suite (le témoin le promettait), comme dans l'histoire.
    ecouterFlux("pause", async () => {
      await this.relire();
      if (!this.etat?.pause && this.local !== null) this.enregistrer();
    });
    zone.addEventListener("input", (ev) => this.saisie(ev));
    zone.addEventListener("click", (ev) => this.clic(ev));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && this.local !== null) this.enregistrer();
      else if (document.visibilityState === "visible" && this.etat) this.relire();
    });
    window.addEventListener("beforeunload", (ev) => {
      if (this.local === null) return;
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
      r = await demander("GET", "/api/confie");
    } catch (err) {
      // Plus de session, carnet fermé, coin injoignable : la page de l'histoire le dit déjà, la section se tait.
      if (n === this.lecture && (err.status === 401 || err.status === 403 || !this.etat)) this.cacher();
      return;
    }
    if (n !== this.lecture) return;
    const avant = this.etat;
    this.etat = r;
    this.afficher();
    if (dire && avant) this.direCeQuiAChange(avant, r);
  }

  cacher() {
    this.zone.hidden = true;
    this.zone.innerHTML = "";
  }

  // Ce que montre le champ : ce qui est tapé ici, sinon le brouillon, sinon ce qui a été confié.
  texte() {
    const r = this.etat;
    return this.local ?? r.brouillon ?? r.envoye?.texte ?? "";
  }

  afficher() {
    const r = this.etat;
    if (!r?.ouvert || !r.heros) return this.cacher();
    if (!this.zone.querySelector(".feuille-confie")) this.dessiner();
    this.maj();
    if (!this.descendu && location.hash === "#confie-mj") {
      this.descendu = true;
      descendre(this.zone);
    }
  }

  dessiner() {
    const r = this.etat;
    this.zone.hidden = false;
    this.zone.innerHTML = `
      <section class="feuille-coin feuille-confie" aria-labelledby="titre-confie">
        <span class="sceau-confie" aria-hidden="true"></span>
        <header class="titre-confie">
          <p class="kicker">Pour le MJ seulement</p>
          <h2 id="titre-confie">Ce que seul votre MJ saura</h2>
          <p class="chapo">Seul votre MJ lira ce passage : ni la tablée, ni la TV, ni les autres joueurs, ni votre fiche imprimée. Un secret, une peur, une envie pour la suite, une limite à respecter. Il arrive tel quel sur la fiche de votre héros, sans attendre de validation.</p>
          <p class="sans-aide">Pas d'aide à l'écriture ici : ce texte reste entre vous et votre MJ.</p>
        </header>
        <div class="etat-confie" aria-live="polite"></div>
        <div class="passage passage-confie">
          <header class="tete-passage">
            <label class="nom-passage" for="texte-confie">Votre message au MJ</label>
            <span class="tampon-passage" hidden></span>
          </header>
          <textarea id="texte-confie" data-confie rows="5" maxlength="${e(r.max)}" spellcheck="true" autocapitalize="sentences"
            aria-describedby="titre-confie">${e(this.texte())}</textarea>
          <p class="pied-passage"><span class="reste" aria-live="polite"></span></p>
        </div>
        <p class="refus-coin refus-confie" role="alert" hidden></p>
        <div class="barre-confie">
          <p class="ligne-temoin">${htmlTemoin("ok")}</p>
          <button type="button" class="lien-passage" data-confie-action="revenir" hidden>Revenir à ce que j'ai confié</button>
          <button type="button" class="envoyer-coin" data-confie-action="envoyer">Envoyer au MJ</button>
        </div>
      </section>`;
    this.ajuster(this.champ());
  }

  champ() {
    return this.zone.querySelector("textarea[data-confie]");
  }

  // Ce qui change sans toucher au champ où l'on écrit : l'état de l'envoi, le tampon, le bouton, le témoin.
  maj() {
    const r = this.etat;
    const champ = this.champ();
    if (!champ) return;
    // Un autre appareil a écrit, ou l'envoi vient de partir : le champ suit, sauf si l'on y écrit.
    if (document.activeElement !== champ && this.local === null && champ.value !== this.texte()) {
      champ.value = this.texte();
      this.ajuster(champ);
    }
    const v = r.envoye;
    const actuel = net(this.texte());
    const parti = Boolean(v && PARTI.includes(v.etat));
    const change = !v || actuel !== net(v.texte);
    const lignes = [];
    if (v) {
      const date = v.quand ? ` le ${quand(v.quand)}` : "";
      if (v.etat === "en-route") lignes.push(`<p><b>Envoyé</b>${e(date)} : en route vers votre MJ.</p>`);
      else if (v.etat === "pas-depose") lignes.push(`<p class="echec-confie"><b>Pas déposé</b>${v.resultat ? ` : ${e(v.resultat)}` : "."} Renvoyez-le quand vous voulez.</p>`);
      else if (v.etat === "retire") lignes.push("<p><b>Retiré</b> avant d'arriver sur votre fiche : il n'est pas parti.</p>");
      else lignes.push(`<p><b>Confié</b>${e(date)}. ${v.lu ? `Lu par votre MJ le ${e(quand(v.lu))}.` : "Pas encore lu par votre MJ."}</p>`);
      if (parti && change) {
        lignes.push(`<p class="aide-confie">Votre nouvelle version n'est pas encore partie : votre MJ lit toujours la précédente.</p>
          <details class="relire-confie"><summary>Relire ce que vous lui avez confié</summary><div class="texte-confie">${paragraphes(v.texte)}</div></details>`);
      } else if (parti) {
        lignes.push('<p class="aide-confie">Pour le compléter ou le remplacer, modifiez-le ci-dessous puis envoyez : la nouvelle version remplace l\'ancienne sur votre fiche.</p>');
      }
    }
    // Rien ne part seul à la réouverture : le texte tapé s'enregistre (brouillon), l'envoi reste au joueur.
    if (r.pause) lignes.push('<p class="aide-confie">Le coin est en pause : gardez cette page ouverte, votre texte s\'enregistrera quand votre MJ le rouvrira. Vous l\'enverrez ensuite.</p>');
    this.zone.querySelector(".etat-confie").innerHTML = lignes.join("");
    const tampon = this.zone.querySelector(".tampon-passage");
    const t = v && parti && !change ? (v.etat === "depose" && v.lu ? ["lu", "Lu par le MJ"] : ["envoye", "Confié"]) : actuel ? ["brouillon", "Brouillon"] : null;
    tampon.hidden = !t;
    tampon.textContent = t ? t[1] : "";
    tampon.dataset.etat = t ? t[0] : "";
    this.zone.querySelector(".passage-confie").dataset.etat = t ? t[0] : "";
    const bouton = this.zone.querySelector('[data-confie-action="envoyer"]');
    bouton.textContent = parti && change ? "Remplacer ce que j'ai confié" : "Envoyer au MJ";
    bouton.disabled = this.envoi || r.pause || !actuel || (parti && !change);
    this.zone.querySelector('[data-confie-action="revenir"]').hidden = !(v && change);
    const refus = this.zone.querySelector(".refus-confie");
    refus.hidden = !this.message;
    refus.textContent = this.message;
    this.compter(champ);
    this.majTemoin();
  }

  compter(champ) {
    const reste = Number(this.etat?.max || 8000) - champ.value.length;
    const p = this.zone.querySelector(".passage-confie .reste");
    if (p) p.textContent = reste <= RESTE ? `${reste} signe${reste > 1 ? "s" : ""} restant${reste > 1 ? "s" : ""}` : "";
  }

  ajuster(champ) {
    if (!champ) return;
    champ.style.height = "auto";
    champ.style.height = `${champ.scrollHeight + 2}px`;
  }

  majTemoin() {
    const t = this.zone.querySelector(".temoin-enregistrement");
    if (!t) return;
    const pause = this.etat?.pause && this.local !== null;
    afficherTemoin(t, this.temoin.etat, { reessai: this.reessai, modifie: this.temoin.modifie ?? this.etat?.modifie,
      texte: pause ? "En pause : enregistré à la réouverture" : this.temoin.texte });
  }

  etatTemoin(etat, { modifie = null, texte = "" } = {}) {
    this.temoin = { etat, modifie: modifie ?? this.temoin.modifie, texte };
    this.majTemoin();
  }

  // Le MJ vient de lire : un avis au bas de l'écran.
  direCeQuiAChange(avant, apres) {
    const a = avant.envoye;
    const b = apres.envoye;
    if (!b || !b.lu || (a && a.id === b.id && a.lu)) return;
    this.avis?.remove();
    const el = document.createElement("div");
    el.className = "avis-coin";
    el.setAttribute("role", "status");
    el.innerHTML = '<span>Votre MJ a lu ce que vous lui avez confié.</span><a href="#confie-mj">Voir</a>';
    el.addEventListener("click", () => el.remove());
    document.body.append(el);
    this.avis = el;
    setTimeout(() => el.remove(), 9000);
  }

  // ------------------------------------------------------------ écrire

  saisie(ev) {
    const champ = ev.target.closest("textarea[data-confie]");
    if (!champ) return;
    this.local = champ.value;
    this.message = "";
    this.ajuster(champ);
    this.maj();
    this.etatTemoin("modifie");
    clearTimeout(this.minuterie);
    this.minuterie = setTimeout(() => this.enregistrer(), ATTENTE);
  }

  // Un enregistrement à la fois ; une frappe pendant l'envoi en relance un, avec le texte du moment.
  enregistrer(corps = null) {
    clearTimeout(this.minuterie);
    if (this.enCours) {
      this.encore = true;
      return this.enCours;
    }
    const texte = this.local;
    if (texte === null && !corps) return Promise.resolve(true);
    if (this.etat?.pause) {
      this.majTemoin();
      return Promise.resolve(false);
    }
    this.etatTemoin("enregistrement");
    this.enCours = (async () => {
      try {
        const r = await demander("PUT", "/api/confie", corps || { texte });
        if (corps || this.local === texte) this.local = null;
        this.etat = r;
        this.reessai.reussite();
        this.etatTemoin(this.local === null ? "ok" : "modifie", { modifie: r.enregistre });
        this.afficher();
        return true;
      } catch (err) {
        if (err.status === 401 || err.status === 403) {
          this.cacher();
          return false;
        }
        if (injoignable(err)) {
          this.reessai.echec(err);
          this.etatTemoin("erreur");
        } else {
          // En pause, carnet fermé, texte trop long : dit sous le champ ; le texte tapé reste.
          if (err.status !== 423) this.message = err.message;
          this.etatTemoin("erreur", { texte: this.etat?.pause ? "" : "Non enregistré" });
          await this.relire();
        }
        return false;
      }
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
    const champ = this.champ();
    if (!champ) return;
    this.envoi = true;
    bouton.disabled = true;
    this.message = "";
    try {
      // L'enregistrement en route d'abord : il ne doit pas repasser derrière l'envoi.
      clearTimeout(this.minuterie);
      while (this.enCours) await this.enCours;
      const r = await demander("POST", "/api/confie/envoyer", { texte: champ.value });
      this.local = null;
      this.etat = r;
      this.envoi = false;
      this.etatTemoin("ok", { modifie: r.modifie });
      this.afficher();
      this.zone.querySelector(".etat-confie")?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      this.envoi = false;
      if (err.status === 401 || err.status === 403) return this.cacher();
      this.message = `Rien n'est parti : ${err.message}`;
      await this.relire();
    }
  }

  async clic(ev) {
    const b = ev.target.closest("[data-confie-action]");
    if (!b || b.disabled) return;
    if (b.dataset.confieAction === "envoyer") return this.envoyer(b);
    if (b.dataset.confieAction === "revenir") {
      // Le texte confié revient dans le champ ; le brouillon s'en va.
      this.local = null;
      this.message = "";
      const champ = this.champ();
      if (champ && this.etat?.envoye) {
        champ.value = this.etat.envoye.texte;
        this.ajuster(champ);
      }
      return this.enregistrer({ effacer: true });
    }
  }
}

const zone = document.getElementById("confie-mj");
if (zone) new Confidence(zone).relire();
