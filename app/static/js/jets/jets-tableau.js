// Les jets à distance dans le Tableau du MJ (tableau.js, bouton Tableau, touche T), sous les mains levées : les derniers
// tests lancés depuis le coin des joueurs (l'heure, le héros et son joueur, le test, le dé et l'issue, la valeur visée et ce
// qui n'a pas été compté), les tests demandés qui attendent (« Retirer »), et « Demander un test » : un joueur, puis la
// caractéristique, et c'est parti (le modificateur avant, s'il y a lieu). Le joueur le voit aussitôt sur son téléphone.
// Tableau fermé, un test qui tombe se dit dans un message, sur toute page de l'atelier.
//
// Lot G : les dés libres et les dégâts des armes dans la même liste ; et quand la règle des dés d'aventure est en jeu, les
// deux réserves (un dé passe à la main d'une réserve à l'autre : on joue aussi avec de vrais dés), le dé de mésaventure à
// annoncer pour le prochain test d'un joueur (seul, ou avec le test demandé ; l'effet au choix pour un héros en
// désavantage), les annonces qui attendent (« Retirer »), et sous chaque test, ses dés d'aventure (« Annuler le dé »).

import { accorderEnfants } from "../commun/accorder.js";
import { echapper as e, toast } from "../api.js";
import { effet } from "./des.js";
import {
  CARACS, EFFETS_CHOISIS, annulerAventure, deux, demanderTest, desavantageDe, ecouterLesJets, herosDe, heure, htmlDesDuTest, htmlDetail,
  htmlIssue, htmlPips, imposerMesaventure, passerDe, prenomDe, retirerMesaventure, retirerTest, signe, testDe,
} from "./jets.js";

const PAS = 5;
const MOD_MAX = 50;
const VUS = 3; // les derniers jets montrés ; « Les 12 derniers » déplie le reste
const RECENT = 3600 * 1000;
const prenomCourt = (nom) => String(nom || "").trim().split(/[\s,]+/)[0] || "";

export class JetsDuTableau {
  constructor(panneau) {
    this.ouvert = false;
    this.vue = null;
    this.choisi = ""; // le joueur à qui demander
    this.mod = 0;
    this.mesaventure = false; // lot G : le test demandé part avec un dé de mésaventure
    this.face = null; // l'effet choisi pour un héros en désavantage (sinon le dé roule)
    this.tous = false; // tous les derniers jets, ou les trois plus récents
    this.connus = new Set(); // les jets déjà dits au lecteur d'écran
    this.premiere = true;
    this.zone = document.createElement("section");
    this.zone.className = "jets-tableau";
    this.zone.setAttribute("aria-label", "Tests à distance");
    this.zone.hidden = true;
    const avant = panneau.querySelector(".salle-tableau") || panneau.querySelector(".tableau-tete") || panneau.firstElementChild;
    avant?.after(this.zone);
    this.voix = document.createElement("p");
    this.voix.className = "salle-voix";
    this.voix.setAttribute("aria-live", "polite");
    document.body.append(this.voix);
    this.zone.addEventListener("click", (ev) => this.clic(ev));
    ecouterLesJets((v) => this.recevoir(v));
  }

  // L'interface des aides du Tableau (ouvrir, fermer, recu) : les jets arrivent par leur propre canal.
  ouvrir() {
    this.ouvert = true;
    this.dessiner();
  }

  fermer() {
    this.ouvert = false;
  }

  recu() {}

  recevoir(v) {
    this.vue = v;
    const nouveaux = (v?.jets || []).filter((x) => !this.connus.has(x.id));
    for (const x of v?.jets || []) this.connus.add(x.id);
    if (nouveaux.length && !this.premiere) {
      const x = nouveaux[0];
      const resultat = x.genre === "des" ? `${x.total}` : `${deux(x.de)}, ${String(x.issue_nom || "").toLowerCase()}`;
      const desTest = [["aventure", "dé d'aventure"], ["mesaventure", "dé de mésaventure"]].filter(([k]) => x[k]).map(([k, nom]) => `, ${nom} ${x[k].face} ${x[k].effet}`).join("");
      this.voix.textContent = `${herosDe(x) || prenomDe(x)}, ${x.genre === "des" ? "" : "test de "}${testDe(x)} : ${resultat}${desTest}.`;
      // Tableau fermé, le MJ le lit quand même, dans un coin de la page.
      if (!this.ouvert) toast(this.voix.textContent);
    }
    this.premiere = false;
    if (this.choisi && !(v?.joueurs || []).some((j) => j.joueur === this.choisi)) this.choisi = "";
    if (!desavantageDe(this.joueurChoisi())) this.face = null;
    if (!v?.reserve?.actif) this.mesaventure = false;
    this.dessiner();
  }

  joueurChoisi() {
    const v = this.vue;
    const joueur = this.choisi || (v?.joueurs.length === 1 ? v.joueurs[0].joueur : "");
    return (v?.joueurs || []).find((x) => x.joueur === joueur) || null;
  }

  dessiner() {
    const v = this.vue;
    if (!this.ouvert) return;
    // Table du coin fermée et rien de lancé depuis une heure : la section se retire, le Tableau garde sa place (sauf si la
    // règle des dés d'aventure est en jeu : leurs réserves restent sous la main).
    const recent = (v?.jets || []).some((x) => Date.now() - new Date(x.quand).getTime() < RECENT);
    const reserve = Boolean(v?.reserve?.actif);
    this.zone.hidden = !v || (!(v.joueurs.length || v.jets.length) && !reserve) || (!v.ouvert && !recent && !v.demandes.length && !reserve);
    if (this.zone.hidden) return;
    // Toujours les mêmes blocs, dans le même ordre (vides au besoin) : le redessin ne change que ce qui a changé.
    const neuf = document.createElement("div");
    neuf.innerHTML = `<h3>Tests à distance</h3>${this.htmlEtat(v)}${this.htmlReserve(v)}${this.htmlDemander(v)}${this.htmlDemandes(v)}${this.htmlJets(v)}`;
    accorderEnfants(this.zone, neuf);
  }

  htmlEtat(v) {
    const texte = !v.ouvert ? "Table du coin fermée : les joueurs ne lancent pas (Réglages, Coin des joueurs, pour l'ouvrir)."
      : v.pause ? "Coin en pause : les joueurs ne lancent pas." : "";
    return `<p class="jets-etat"${texte ? "" : " hidden"}>${e(texte)}</p>`;
  }

  // Les deux réserves des dés d'aventure, et les dés de mésaventure annoncés.
  htmlReserve(v) {
    const r = v.reserve || { actif: false, mesaventures: [] };
    const annonces = (r.mesaventures || []).map((m) => `
      <li data-mesaventure="${e(m.joueur)}"><span class="quoi"><b>${e(m.nom || "Un joueur")}</b> : dé de mésaventure au prochain test${m.face ? ` <small>(effet choisi : ${e(effet(m.face))})</small>` : ""}<em>annoncé, attend son test</em></span>
        <button type="button" data-jets="retirer-mesaventure" title="L'annonce tombe, le dé reste dans votre réserve">Retirer</button></li>`).join("");
    return `<div class="jets-reserve"${r.actif ? "" : " hidden"}>
        <p class="titre">Dés d'aventure</p>
        <div class="reserves-mj">
          <span class="reserve-mj groupe">${htmlPips(r.groupe, "groupe")}<b>${e(r.groupe)}</b> au groupe</span>
          <span class="reserve-mj mj">${htmlPips(r.mj, "mj")}<b>${e(r.mj)}</b> au MJ</span>
        </div>
        <div class="reserves-mj">
          <button type="button" data-jets="vers-mj" title="Un dé d'aventure joué à la table passe au MJ"${r.groupe ? "" : " disabled"}>Passer un dé au MJ</button>
          <button type="button" data-jets="vers-groupe" title="Un dé de mésaventure joué à la table revient au groupe"${r.mj ? "" : " disabled"}>Passer un dé au groupe</button>
        </div>
        <ul class="jets-demandes jets-mesaventures"${annonces ? "" : " hidden"}>${annonces}</ul>
      </div>`;
  }

  htmlDemandes(v) {
    return `<ul class="jets-demandes"${v.demandes.length ? "" : " hidden"}>${v.demandes.map((d) => `
      <li data-demande="${e(d.id)}" data-joueur="${e(d.joueur)}">
        <span class="quoi"><b>${e(prenomDe(d))}</b> : ${e(d.carac_nom)}${d.modificateur ? ` (${e(signe(d.modificateur))})` : ""}<em>attend son jet</em></span>
        <button type="button" data-jets="retirer" title="Le test n'attend plus ${e(prenomDe(d))}">Retirer</button>
      </li>`).join("")}</ul>`;
  }

  htmlJets(v) {
    const liste = v.jets.slice(0, this.tous ? v.jets.length : VUS);
    const plus = v.jets.length > VUS;
    return `<ol class="jets-derniers"${liste.length ? "" : " hidden"}>${liste.map((x) => {
      const desTest = x.genre === "des" ? "" : htmlDesDuTest(x);
      return `
      <li class="jet-mj${x.genre === "des" ? " des-mj" : ""}" data-jet="${e(x.id)}" data-issue="${e(x.issue || "")}">
        <span class="ligne1"><b>${e(prenomCourt(herosDe(x)) || prenomDe(x))}</b> ${e(testDe(x))}</span>
        <span class="issue">${htmlIssue(x)}</span>
        <span class="ligne2">${e(heure(x.quand))} · ${e(prenomDe(x))}${x.demande ? " · demandé" : ""} · ${htmlDetail(x)}</span>
        <span class="ligne3"${desTest ? "" : " hidden"}>${desTest}</span>
      </li>`;
    }).join("")}</ol>
      <p class="jets-vide"${v.jets.length ? " hidden" : ""}>Aucun test lancé depuis le coin pour l'instant.</p>
      <button type="button" class="jets-plus" data-jets="tous"${plus ? "" : " hidden"}>${this.tous ? "Moins" : `Les ${v.jets.length} derniers`}</button>`;
  }

  htmlDemander(v) {
    const seul = v.joueurs.length === 1 ? v.joueurs[0].joueur : "";
    const choisi = this.choisi || seul;
    const ferme = !v.ouvert || v.pause;
    const r = v.reserve || {};
    const j = this.joueurChoisi();
    const desav = r.actif && desavantageDe(j);
    const libres = r.libres || 0;
    return `<div class="jets-demander"${v.joueurs.length ? "" : " hidden"}>
        <div class="qui" role="group" aria-label="Demander un test à">${v.joueurs.map((x) => `<button type="button" data-jets-joueur="${e(x.joueur)}" aria-pressed="${x.joueur === choisi}" title="${e(`${x.nom || "Ce joueur"} joue ${x.heros?.nom || "un héros"}`)}">${e(x.nom || "Un joueur")}<small>${e(prenomCourt(x.heros?.nom))}</small>${x.jeton ? `<i class="jeton-mj ${e(x.jeton)}" title="${x.jeton === "avantage" ? "Avantage" : "Désavantage"}">${x.jeton === "avantage" ? "+" : "−"}</i>` : ""}</button>`).join("")}</div>
        <div class="quoi" role="group" aria-label="Quel test">
          ${CARACS.map(([cle, nom]) => `<button type="button" class="principal" data-jets-carac="${cle}"${!choisi || ferme ? " disabled" : ""}>${nom}</button>`).join("")}
          <span class="mod"><button type="button" data-jets-mod="-${PAS}" aria-label="Moins ${PAS}">−</button><output title="Modificateur">${e(signe(this.mod))}</output><button type="button" data-jets-mod="${PAS}" aria-label="Plus ${PAS}">+</button></span>
        </div>
        <div class="mesaventure-mj"${r.actif ? "" : " hidden"}>
          <button type="button" data-jets="avec-mesaventure" aria-pressed="${this.mesaventure}"${libres ? "" : " disabled"} title="Le test demandé part avec un dé de mésaventure, annoncé au joueur">Avec un dé de mésaventure</button>
          <button type="button" data-jets="mesaventure-seule"${!choisi || !v.ouvert || !libres ? " disabled" : ""} title="Annoncé dans sa feuille : il roulera avec son prochain test">Mésaventure au prochain test</button>
          <span class="libres-mj"${libres ? " hidden" : ""}>${r.mj ? "Chaque dé de votre réserve est déjà annoncé." : "Votre réserve est vide."}</span>
        </div>
        <div class="effets-mj" role="group" aria-label="Son désavantage : l'effet du dé de mésaventure"${desav ? "" : " hidden"}>
          <span>${e(j?.nom || "")} porte un désavantage : l'effet</span>
          <button type="button" data-jets-face="" aria-pressed="${this.face === null}">Au dé</button>
          ${EFFETS_CHOISIS.map(([face, nom]) => `<button type="button" data-jets-face="${face}" aria-pressed="${this.face === face}">${nom}</button>`).join("")}
        </div>
        <p class="aide"${choisi || ferme ? " hidden" : ""}>Demander un test : touchez un joueur, puis la caractéristique.</p>
      </div>`;
  }

  async occupe(b, travail, dit) {
    b.setAttribute("aria-busy", "true");
    try {
      await travail();
      if (dit) toast(dit);
    } catch (err) {
      toast(err.message, "erreur");
    } finally {
      b.removeAttribute("aria-busy");
    }
  }

  async clic(ev) {
    const b = ev.target.closest("button");
    if (!b || b.disabled || b.getAttribute("aria-busy") === "true") return;
    if (ev.detail) b.blur();
    const v = this.vue;
    if (b.dataset.jets === "tous") {
      this.tous = !this.tous;
      return this.dessiner();
    }
    if (b.dataset.jetsJoueur) {
      this.choisi = this.choisi === b.dataset.jetsJoueur && v?.joueurs.length > 1 ? "" : b.dataset.jetsJoueur;
      if (!desavantageDe(this.joueurChoisi())) this.face = null;
      return this.dessiner();
    }
    if (b.dataset.jetsMod) {
      this.mod = Math.max(-MOD_MAX, Math.min(MOD_MAX, this.mod + Number(b.dataset.jetsMod)));
      return this.dessiner();
    }
    // ---- Lot G : la réserve ----
    if (b.dataset.jets === "avec-mesaventure") {
      this.mesaventure = !this.mesaventure;
      return this.dessiner();
    }
    if (b.dataset.jetsFace !== undefined) {
      this.face = b.dataset.jetsFace ? Number(b.dataset.jetsFace) : null;
      return this.dessiner();
    }
    if (b.dataset.jets === "vers-mj" || b.dataset.jets === "vers-groupe") {
      return this.occupe(b, () => passerDe(b.dataset.jets === "vers-mj" ? "mj" : "groupe"));
    }
    if (b.dataset.jets === "mesaventure-seule") {
      const j = this.joueurChoisi();
      if (!j) return;
      const face = desavantageDe(j) ? this.face : null;
      return this.occupe(b, async () => {
        await imposerMesaventure(j.joueur, face);
        this.face = null;
        this.choisi = "";
      }, `${j.nom || "Le joueur"} : dé de mésaventure annoncé pour son prochain test.`);
    }
    if (b.dataset.jets === "retirer-mesaventure") {
      const joueur = b.closest("[data-mesaventure]")?.dataset.mesaventure;
      return joueur && this.occupe(b, () => retirerMesaventure(joueur));
    }
    if (b.dataset.jets === "annuler-de") {
      const ident = b.closest("[data-jet]")?.dataset.jet;
      return ident && this.occupe(b, () => annulerAventure(ident), "Le dé d'aventure est revenu au groupe.");
    }
    if (b.dataset.jetsCarac) {
      const j = this.joueurChoisi();
      if (!j) return;
      const avec = this.mesaventure && Boolean(v?.reserve?.actif);
      const face = avec && desavantageDe(j) ? this.face : null;
      b.setAttribute("aria-busy", "true");
      try {
        await demanderTest(j.joueur, b.dataset.jetsCarac, this.mod, avec, face);
        toast(`${j.nom || "Le joueur"} : test de ${b.textContent.trim()}${this.mod ? ` (${signe(this.mod)})` : ""}${avec ? ", avec un dé de mésaventure," : ""} demandé.`);
        this.mod = 0;
        this.choisi = "";
        this.mesaventure = false;
        this.face = null;
        this.dessiner();
      } catch (err) {
        toast(`Test non demandé : ${err.message}`, "erreur");
      } finally {
        b.removeAttribute("aria-busy");
      }
      return;
    }
    if (b.dataset.jets === "retirer") {
      const li = b.closest("[data-demande]");
      const d = (v?.demandes || []).find((x) => x.id === li?.dataset.demande && x.joueur === li?.dataset.joueur);
      if (!d) return;
      b.setAttribute("aria-busy", "true");
      try {
        await retirerTest(d);
      } catch (err) {
        toast(`${prenomDe(d)} : ${err.message}`, "erreur");
      } finally {
        b.removeAttribute("aria-busy");
      }
    }
  }
}
