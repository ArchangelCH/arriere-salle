// L'échoppe du téléphone, dans le coin des joueurs : les boutiques que le MJ a ouvertes aux joueurs, peintes comme celle
// de la TV (l'enseigne, le marchand, les étagères, chaque objet peint par boutiques/objets.js avec son étiquette de prix).
// Le joueur compose un panier aux quantités bornées, voit sa bourse, puis envoie sa commande au MJ, qui vend ou refuse
// depuis l'atelier. Le panier reste dans la page (et la session de l'onglet) jusqu'à l'envoi ; le serveur revérifie tout.

import { echapper as e } from "../api.js";
import { avecPo, grouper, montantDuPrix } from "../boutiques/commun.js";
import { objetSvg } from "../boutiques/objets.js";

// Les mêmes bornes que le serveur (carnet.py).
const QUANTITE_MAX = 20;
const LIGNES_MAX = 12;
const PENCHES = [-2.5, 1.5, -1, 2.5, -2, 1];
const STATUTS = { "en-attente": "Attend le MJ", vendue: "Vendue", refusee: "Refusée" };
const CLE_PANIERS = "coin-paniers";

const pieces = (n) => `${n} pièce${n > 1 ? "s" : ""} d'or`;
// « le sac d'Aldwin », « le sac de Mathis ».
const de = (nom) => (/^[aeiouyhàâäéèêëîïôöûü]/i.test(nom) ? `d'${nom}` : `de ${nom}`);
const dateCourte = (iso) => {
  const d = new Date(iso || "");
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-CH", { day: "numeric", month: "long" });
};
const lignesCommande = (c) => (c.lignes || []).map((l) => `${l.quantite > 1 ? `${l.quantite} × ` : ""}${l.nom}`).join(", ");

function lirePaniers() {
  try {
    const p = JSON.parse(sessionStorage.getItem(CLE_PANIERS) || "{}");
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

export class Echoppe {
  // lectureSeule : l'aperçu du MJ (« Voir comme Léa ») montre l'échoppe du joueur sans panier ni bouton qui écrive.
  constructor(racine, { demander, pageErreur, pageFermee, lectureSeule = false }) {
    this.racine = racine;
    this.demander = demander;
    this.pageErreur = pageErreur;
    this.pageFermee = pageFermee;
    this.lectureSeule = lectureSeule;
    this.donnees = null;
    this.boutique = null;
    this.paniers = lirePaniers();
    this.envoi = false;
    this.jeton = 0;
  }

  // Un envoi en cours ou un panier commencé : la page ne se relit pas sous les doigts du joueur.
  occupe() {
    return this.envoi || Boolean(this.boutique && Object.keys(this.panier()).length);
  }

  quitter() {
    this.boutique = null;
    document.querySelector(".barre-panier")?.remove();
    document.querySelector(".confirmer-commande")?.remove();
    document.body.classList.remove("avec-panier");
  }

  // message : ce qui vient d'arriver, montré en tête (une commande refusée parce que la boutique a changé entre-temps).
  async afficher(hash, message = "") {
    const n = ++this.jeton;
    const choisie = /^boutique\/([a-f0-9]{20})$/.exec(hash)?.[1] || "";
    try {
      const d = await this.demander("GET", "/api/echoppe");
      if (n !== this.jeton) return;
      this.donnees = d;
    } catch (err) {
      if (n === this.jeton) this.pageErreur(err);
      return;
    }
    this.quitter();
    if (!this.donnees.ouvert) return this.pageFermee();
    const b = choisie && this.donnees.boutiques.find((x) => x.id === choisie);
    if (choisie && !b) {
      history.replaceState(null, "", "#boutiques");
      // Fermée aux joueurs en plein panier (E24) : le panier reste gardé, il revient avec la boutique.
      const garde = Object.keys(this.panier(choisie)).length ? " Votre panier vous attend pour sa réouverture." : "";
      return this.afficherListe(`${message ? "Commande non envoyée : cette boutique vient de fermer aux joueurs." : "Cette boutique n'est plus ouverte aux joueurs."}${garde}`);
    }
    return b ? this.afficherBoutique(b, message) : this.afficherListe(message);
  }

  bourse() {
    const or = this.donnees?.heros?.or;
    return Number.isInteger(or) ? or : 0;
  }

  enAttente(jeton) {
    return (this.donnees?.commandes || []).find((c) => c.boutique === jeton && c.statut === "en-attente") || null;
  }

  // ---------------------------------------------------------------- la liste des boutiques

  htmlCommande(c, { boutique = true } = {}) {
    const total = c.total ? `${c.total} po${c.a_fixer ? " et un prix à voir avec le MJ" : ""}` : c.a_fixer ? "prix à voir avec le MJ" : "offert";
    let suite = "";
    if (c.statut === "vendue") suite = `${c.montant ? `${c.montant} po payées` : "offert"}${c.heros ? `, dans le sac ${e(de(c.heros))}` : ""}.`;
    else if (c.statut === "refusee") suite = c.mot ? `Le mot du MJ : « ${e(c.mot)} »` : "Sans un mot du MJ.";
    else suite = `${e(total)}. Votre MJ la valide avant la séance.`;
    return `
      <li class="commande-coin statut-${e(c.statut)}">
        <p class="tete-commande"><span class="statut">${e(STATUTS[c.statut] || c.statut)}</span>${boutique ? `<b>${e(c.boutique_nom)}</b>` : ""}<span class="date">${e(dateCourte(c.traitee || c.cree))}</span></p>
        <p class="lignes">${e(lignesCommande(c))}</p>
        <p class="suite">${suite}</p>
        ${c.statut === "en-attente" && !this.lectureSeule ? `<button type="button" class="lien-coin" data-retirer="${e(c.id)}">Retirer ma commande</button>` : ""}
      </li>`;
  }

  afficherListe(message = "") {
    const d = this.donnees;
    const h = d.heros;
    this.racine.innerHTML = `
      <section class="feuille-coin boutiques-coin">
        <header class="titre-carnet">
          <p class="kicker">Entre les séances</p>
          <h1>Les boutiques</h1>
          <p class="chapo">Faites vos achats avant la séance : vous composez votre panier, votre MJ valide, l'or quitte votre bourse et les objets entrent dans votre sac.</p>
        </header>
        ${message ? `<p class="alerte-coin" role="alert">${e(message)}</p>` : ""}
        ${h ? `<p class="bourse-coin grande">Votre bourse : <span class="pieces">${e(this.bourse())}</span> ${this.bourse() > 1 ? "pièces" : "pièce"} d'or</p>`
          : '<p class="alerte-coin">Votre héros n\'est pas encore dans la tablée : vous pouvez regarder les boutiques, et commander dès que le MJ l\'aura accueilli.</p>'}
        ${d.boutiques.length ? `<ul class="enseignes-coin">${d.boutiques.map((b) => `
          <li><a class="enseigne-coin" href="#boutique/${e(b.id)}">
            ${b.marchand ? `<span class="chez">Chez ${e(b.marchand)}</span>` : ""}
            <span class="nom-boutique">${e(b.nom || "La boutique")}</span>
            ${b.accroche ? `<span class="accroche">${e(b.accroche)}</span>` : ""}
            <span class="compte">${e(b.articles.length)} article${b.articles.length > 1 ? "s" : ""}${this.enAttente(b.id) ? " · une commande attend le MJ" : ""}</span>
          </a></li>`).join("")}</ul>` : '<p class="vide">Aucune boutique n\'est ouverte aux joueurs en ce moment.</p>'}
        ${d.commandes.length ? `<section class="mes-commandes"><h2>Vos commandes</h2><ul>${d.commandes.slice().reverse().map((c) => this.htmlCommande(c)).join("")}</ul></section>` : ""}
      </section>`;
    this.racine.querySelector(".boutiques-coin").addEventListener("click", (ev) => this.clic(ev));
  }

  // ---------------------------------------------------------------- une boutique

  panier(jeton = this.boutique?.id) {
    const p = this.paniers[jeton];
    return p && typeof p === "object" ? p : {};
  }

  garderPaniers() {
    try {
      sessionStorage.setItem(CLE_PANIERS, JSON.stringify(this.paniers));
    } catch {
      // navigation privée : le panier reste dans la page
    }
  }

  // Le panier, nettoyé de ce qui n'est plus en vente (article retiré, caché ou épuisé depuis).
  lignes() {
    const b = this.boutique;
    const p = this.panier();
    const lignes = [];
    for (const a of b.articles) {
      const q = p[a.id];
      if (a.id && !a.epuise && Number.isInteger(q) && q > 0) lignes.push({ article: a, quantite: Math.min(QUANTITE_MAX, q) });
    }
    return lignes;
  }

  totaux() {
    let total = 0;
    let aFixer = false;
    let objets = 0;
    for (const { article, quantite } of this.lignes()) {
      const m = montantDuPrix(article.prix);
      if (m === null) aFixer = true;
      else total += m * quantite;
      objets += quantite;
    }
    return { total, aFixer, objets };
  }

  htmlArticle(a, k, bloque) {
    const q = this.panier()[a.id] || 0;
    const commandable = Boolean(a.id) && !a.epuise && !bloque && !this.lectureSeule;
    return `
      <div class="article-coin${a.epuise ? " epuise" : ""}${q ? " choisi" : ""}" data-article="${e(a.id)}">
        <div class="pose">${objetSvg(a)}${a.epuise ? '<i class="mention">épuisé</i>' : ""}</div>
        <span class="planche" aria-hidden="true"></span>
        <div class="etiquette-coin" style="--r:${PENCHES[k % PENCHES.length]}deg">
          <b>${e(a.nom)}</b>${a.description ? `<i>${e(a.description)}</i>` : ""}<span class="prix">${e(avecPo(a.prix))}</span>
        </div>
        <div class="quantite-coin">${!commandable ? "" : q
          ? `<button type="button" data-moins aria-label="Un de moins">−</button><output aria-label="Quantité">${q}</output><button type="button" data-plus aria-label="Un de plus" ${q >= QUANTITE_MAX ? "disabled" : ""}>+</button>`
          : '<button type="button" class="ajouter" data-plus>Ajouter</button>'}</div>
      </div>`;
  }

  afficherBoutique(b, message = "") {
    this.boutique = b;
    const attente = this.enAttente(b.id);
    const passees = (this.donnees.commandes || []).filter((c) => c.boutique === b.id && c.statut !== "en-attente");
    const derniere = passees[passees.length - 1];
    const bloque = Boolean(attente) || !this.donnees.heros;
    let k = 0;
    this.racine.innerHTML = `
      <section class="echoppe-coin">
        <a class="retour-coin" href="#boutiques">Toutes les boutiques</a>
        <header class="enseigne-coin grande">
          ${b.marchand ? `<span class="chez">Chez ${e(b.marchand.replace(/^(Le|La|Les|L')(?=[\s'’])/, (m) => m.toLowerCase()))}</span>` : ""}
          <h1 class="nom-boutique">${e(b.nom || "La boutique")}</h1>
        </header>
        ${message ? `<p class="alerte-coin" role="alert">${e(message)}</p>` : ""}
        ${b.portrait || b.accroche ? `<div class="comptoir-coin">
          ${b.portrait ? `<figure class="marchand-coin" data-image><span class="cadre"><img src="${e(b.portrait)}" alt=""></span><figcaption>${e(b.marchand.replace(/^(Le|La|Les|L')(?=[\s'’])\s*/, "").split(/\s+/)[0])}</figcaption></figure>` : ""}
          ${b.accroche ? `<p class="accroche">${e(b.accroche)}</p>` : ""}
        </div>` : ""}
        <div class="etat-commande">
          ${attente ? `<ul>${this.htmlCommande(attente, { boutique: false })}</ul><p class="aide-coin">Une seule commande à la fois chez ce marchand : retirez-la pour en passer une autre.</p>`
            : derniere ? `<ul>${this.htmlCommande(derniere, { boutique: false })}</ul>` : ""}
          ${!this.donnees.heros ? '<p class="alerte-coin">Votre héros n\'est pas encore dans la tablée : la commande s\'ouvrira quand le MJ l\'aura accueilli.</p>' : ""}
        </div>
        ${b.articles.length ? `<div class="etageres-coin">${grouper(b.articles).map((g) => `
          <section class="rayon-coin">
            ${g.categorie ? `<h2 class="plaque-coin">${e(g.categorie)}</h2>` : ""}
            <div class="rangees-coin">${g.articles.map((a) => this.htmlArticle(a, k++, bloque)).join("")}</div>
          </section>`).join("")}</div>` : '<p class="vide-echoppe">Rien à vendre pour l\'instant.</p>'}
      </section>`;
    this.racine.querySelector(".echoppe-coin").addEventListener("click", (ev) => this.clic(ev));
    for (const img of this.racine.querySelectorAll("img")) {
      img.addEventListener("error", () => img.closest("[data-image]")?.remove(), { once: true });
    }
    if (!bloque && !this.lectureSeule) this.afficherPanier();
  }

  afficherPanier() {
    let barre = document.querySelector(".barre-panier");
    if (!barre) {
      barre = document.createElement("aside");
      barre.className = "barre-panier";
      barre.setAttribute("aria-label", "Votre panier");
      barre.addEventListener("click", (ev) => this.clic(ev));
      document.body.append(barre);
    }
    const { total, aFixer, objets } = this.totaux();
    const bourse = this.bourse();
    const manque = total - bourse;
    const lignes = this.lignes();
    barre.innerHTML = objets ? `
      <div class="resume-panier">
        <p class="total"><b>${e(objets)} objet${objets > 1 ? "s" : ""}</b> · ${e(total)} po${aFixer ? " <i>et un prix à voir</i>" : ""}</p>
        <p class="${manque > 0 ? "manque" : "reste"}">${manque > 0 ? `Il vous manque ${e(manque)} po` : `Bourse : ${e(bourse)} po`}</p>
      </div>
      <button type="button" class="envoyer-coin" data-envoyer ${manque > 0 || lignes.length > LIGNES_MAX || this.envoi ? "disabled" : ""}>Envoyer au MJ</button>`
      : `<p class="invite-panier">Touchez « Ajouter » sous un objet pour le mettre dans votre panier. Bourse : ${e(pieces(bourse))}.</p>`;
    document.body.classList.add("avec-panier");
  }

  changer(article, pas) {
    const b = this.boutique;
    const a = b.articles.find((x) => x.id === article);
    if (!a || a.epuise) return;
    const p = { ...this.panier() };
    const q = Math.max(0, Math.min(QUANTITE_MAX, (p[a.id] || 0) + pas));
    if (q && !p[a.id] && Object.keys(p).length >= LIGNES_MAX) return;
    if (q) p[a.id] = q;
    else delete p[a.id];
    this.paniers[b.id] = p;
    if (!Object.keys(p).length) delete this.paniers[b.id];
    this.garderPaniers();
    const case_ = this.racine.querySelector(`.article-coin[data-article="${CSS.escape(a.id)}"]`);
    if (case_) {
      const k = [...this.racine.querySelectorAll(".article-coin")].indexOf(case_);
      case_.outerHTML = this.htmlArticle(a, k, false);
    }
    this.afficherPanier();
  }

  confirmer() {
    const lignes = this.lignes();
    if (!lignes.length) return;
    const { total, aFixer } = this.totaux();
    document.querySelector(".confirmer-commande")?.remove();
    const d = document.createElement("dialog");
    d.className = "confirmer-commande";
    d.innerHTML = `
      <form method="dialog">
        <p class="kicker">${e(this.boutique.nom)}</p>
        <h2>Envoyer cette commande ?</h2>
        <ul>${lignes.map(({ article, quantite }) => `<li><span>${quantite > 1 ? `${e(quantite)} × ` : ""}${e(article.nom)}</span><span class="prix">${e(avecPo(article.prix))}</span></li>`).join("")}</ul>
        <p class="total">Total : ${e(total)} po${aFixer ? ", et un prix à voir avec le MJ" : ""}</p>
        <p class="aide-coin">Votre MJ valide la commande depuis l'atelier : l'or ne quitte votre bourse qu'à ce moment-là.</p>
        <p class="refus-coin" role="alert" hidden></p>
        <div class="actions-coin"><button value="non" class="secondaire">Pas encore</button><button value="oui" class="envoyer-coin">Envoyer</button></div>
      </form>`;
    document.body.append(d);
    d.addEventListener("submit", (ev) => {
      if (ev.submitter?.value !== "oui") return;
      ev.preventDefault();
      this.envoyer(d);
    });
    d.addEventListener("close", () => d.remove());
    d.showModal();
  }

  async envoyer(dialogue) {
    if (this.envoi) return;
    const b = this.boutique;
    const corps = { boutique: b.id, lignes: this.lignes().map(({ article, quantite }) => ({ article: article.id, quantite })) };
    this.envoi = true;
    const bouton = dialogue.querySelector('[value="oui"]');
    bouton.disabled = true;
    try {
      await this.demander("POST", "/api/commandes", corps);
      delete this.paniers[b.id];
      this.garderPaniers();
      dialogue.close();
      this.envoi = false;
      await this.afficher(`boutique/${b.id}`);
    } catch (err) {
      this.envoi = false;
      // Refusée parce que la boutique a changé entre-temps (fermée aux joueurs, article retiré ou épuisé, carnet fermé) :
      // la page se relit et le dit, au lieu de laisser un « Envoyer » qui échouerait encore. Le panier reste gardé.
      if ([404, 409, 423].includes(err.status)) {
        dialogue.close();
        return this.afficher(`boutique/${b.id}`, `Commande non envoyée : ${err.message}`);
      }
      if (err.status === 401 || err.status === 403) {
        dialogue.close();
        return this.pageErreur(err);
      }
      bouton.disabled = false;
      const p = dialogue.querySelector(".refus-coin");
      p.textContent = `Commande non envoyée : ${err.message}`;
      p.hidden = false;
    }
  }

  // La même feuille que l'envoi d'une commande : la question, puis le refus du serveur écrit dedans s'il y en a un.
  retirer(id) {
    document.querySelector(".confirmer-commande")?.remove();
    const d = document.createElement("dialog");
    d.className = "confirmer-commande";
    d.innerHTML = `
      <form method="dialog">
        <h2>Retirer cette commande ?</h2>
        <p class="aide-coin">Votre MJ ne la verra plus. Vous pourrez en envoyer une autre.</p>
        <p class="refus-coin" role="alert" hidden></p>
        <div class="actions-coin"><button value="non" class="secondaire">La garder</button><button value="oui" class="envoyer-coin">Retirer</button></div>
      </form>`;
    document.body.append(d);
    d.addEventListener("submit", async (ev) => {
      if (ev.submitter?.value !== "oui") return;
      ev.preventDefault();
      const bouton = ev.submitter;
      bouton.disabled = true;
      try {
        await this.demander("DELETE", `/api/commandes/${encodeURIComponent(id)}`);
        d.close();
        await this.afficher(location.hash.slice(1));
      } catch (err) {
        if (err.status === 401 || err.status === 403) {
          d.close();
          return this.pageErreur(err);
        }
        bouton.disabled = false;
        const p = d.querySelector(".refus-coin");
        p.textContent = `Impossible de la retirer : ${err.message}`;
        p.hidden = false;
      }
    });
    d.addEventListener("close", () => d.remove());
    d.showModal();
  }

  clic(ev) {
    const b = ev.target.closest("button");
    if (!b || b.disabled || this.lectureSeule) return;
    if (b.dataset.retirer) return this.retirer(b.dataset.retirer);
    if (b.hasAttribute("data-envoyer")) return this.confirmer();
    const article = b.closest("[data-article]")?.dataset.article;
    if (article && b.hasAttribute("data-plus")) return this.changer(article, 1);
    if (article && b.hasAttribute("data-moins")) return this.changer(article, -1);
  }
}
