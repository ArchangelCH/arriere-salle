// Les boutiques du MJ : la liste à gauche, la fiche à droite, comme le carnet de PNJ. Chaque boutique a ses articles,
// leurs prix tels que le MJ les tape et un ajustement en pour cent pour la tablée (bonne réputation, étrangers…).
// La fiche s'enregistre à la frappe, avec sa version. La TV n'en reçoit que la partie publique (/api/table/boutique/…) :
// ni les notes du MJ, ni le stock chiffré, ni les articles cachés. « Vendre à… » passe l'achat dans le sac d'un
// aventurier (or et équipement, par la route du sac) et le note au journal de la séance. Une boutique « ouverte aux
// joueurs » paraît dans leur coin entre les séances ; leurs commandes se traitent ici (commandes.js).

import { api, copie, differer, echapper as e, enregistrerAvecVersion, toast } from "../api.js";
import { corpsDuSac, reprisDuSac } from "../aventuriers/etat.js";
import { BoutonTv } from "../ecran-tv/bouton-tv.js";
import { demander } from "../commun/dialogue.js";
import { afficherTemoin, htmlTemoin } from "../commun/temoin-enregistrement.js";
import { annoncerCorbeille, lienVersions } from "../corbeille/corbeille.js";
import { descriptionTv, ecouterTv, phraseTv } from "../ecran-tv/etat-tv.js";
import { noterAuJournal, retirerDuJournal, seanceDuJournal } from "../seances/journal.js";
import { Reessai } from "../commun/reessai.js";
import { etatAuxJoueurs } from "../joueurs/etat-carnet.js";
import { Commandes } from "./commandes.js";
import { MODES_BOUTIQUE, articlesTrouves, garderModeBoutique, htmlComptoir, htmlCompte, lireModeBoutique } from "./comptoir.js";
import { CATEGORIES, PRIX_DU_KIT, ajustementDe, ajusterPrix, avecPo, forme, grouper, montantDuPrix, premierNombre } from "./commun.js";
import { NOMS_DESSINS, objetSvg, typeObjet } from "./objets.js";
import { articlesDeLaTv, pageDeLArticle, pageDemandee, pagesEchoppe } from "./rayons-tv.js";
import { surligner } from "../chercher/moteur.js";
import { Vierges, nomDistinct } from "../commun/vierges.js";

// Le dessin d'un article sur les étagères de la TV : celui que le MJ a choisi, sinon celui que son nom appelle.
const NOM_DESSIN = Object.fromEntries(NOMS_DESSINS);
const dessinDevine = (a) => NOM_DESSIN[typeObjet({ ...a, dessin: "" })] || "";

// Une boutique montrée par-dessus une autre vue plein écran (ou une image) garde la vue que celle-ci avait notée :
// « Retirer de la TV » y revient (le plan, avec son cadrage), sinon à l'accueil.
export const SANS_RETOUR = ["planche", "precedemment", "episode", "heros", "fiches", "image", "boutique", "document"];
export const VUE_AVANT = ["vue", "plan", "carte", "camera", "style", "version", "lieu", "url", "titre"];

const prenom = (nom) => String(nom || "").trim().split(/[\s,]+/)[0] || "";
const orDe = (fiche) => (typeof fiche?.or === "number" && Number.isFinite(fiche.or) ? Math.round(fiche.or) : null);
const pourcent = (a) => `${a > 0 ? "+" : a < 0 ? "−" : ""}${Math.abs(a)} %`;

function ajuster(zone) {
  zone.style.height = "auto";
  zone.style.height = `${zone.scrollHeight + 2}px`;
}

// Un identifiant d'article court, unique dans la boutique (la TV le reçoit pour montrer un article de près).
function idArticle(articles) {
  const pris = new Set((articles || []).map((a) => a.id));
  let id = "";
  while (!id || pris.has(id)) id = Math.random().toString(36).slice(2, 10);
  return id;
}

const articleVide = (articles, champs = {}) => ({
  id: idArticle(articles), nom: "", prix: "", categorie: "", description: "", note_mj: "", stock: null, cache: false, ...champs,
});

// « 23 po pour la table » : ce que lisent les joueurs quand l'ajustement change le prix.
function prixPourLaTable(article, a) {
  const base = String(article.prix || "").trim();
  if (!base || !a) return "";
  const ajuste = ajusterPrix(base, a);
  return ajuste === base ? "" : `${avecPo(ajuste)} pour la table`;
}

const epuise = (article) => typeof article.stock === "number" && article.stock <= 0;

export class Boutiques {
  constructor(racine, { id, parametres = null }) {
    this.racine = racine;
    this.idDemande = id;
    // Le comptoir pour jouer, une ligne par article, ou l'éditeur complet pour préparer (comptoir.js) ; « Chercher un
    // article » dans les deux. ?article=… (venu de « Chercher », l'en-tête) ouvre la boutique sur cet article.
    this.mode = lireModeBoutique();
    this.rechercheArticle = "";
    this.deplies = new Set();
    this.articleDemande = parametres?.get("article") || null;
    this.boutiques = [];
    this.pnj = [];
    this.lieux = [];
    this.fiche = null;
    this.table = null;
    this.modifies = new Set();
    this.vierges = new Vierges();
    this.sauver = differer(() => this.enregistrer(), 700);
    this.chaine = Promise.resolve();
    this.envois = 0;
    this.ventes = 0;
    // Un envoi à la TV à la fois : un « Montrer » suivi d'un « Retirer » rapide arrive dans l'ordre.
    this.fileTable = Promise.resolve();
    // Serveur injoignable : les fiches qui ne sont pas parties repartent seules (3 s, 10 s, puis toutes les 30 s).
    this.reessai = new Reessai(() => this.enregistrer(), () => {
      if (this.etatAffiche === "erreur") this.etat("erreur");
    });
    this.bases = {};
    // « Montrer à la TV », en haut à droite de la fiche, même quand elle défile (une boutique de dix-huit articles).
    this.boutonTv = new BoutonTv({
      estIci: (t) => Boolean(this.fiche) && t.vue === "boutique" && t.boutique === this.fiche.id,
      montrer: () => this.montrer(null),
      retirer: () => this.retirer(),
      titre: "L'échoppe sur la TV : les étagères, sans les notes du MJ ni les articles cachés",
      titreIci: "La TV montre cette boutique : la retirer, la TV revient à ce qu'elle montrait avant",
    });
  }

  async demarrer() {
    const [boutiques, pnj, lieux, table] = await Promise.all([
      api.get("/api/boutiques"), api.get("/api/pnj").catch(() => []), api.get("/api/lieux").catch(() => []), api.get("/api/table").catch(() => null),
    ]);
    if (this.detruit) return;
    [this.boutiques, this.pnj, this.lieux, this.table] = [boutiques, pnj, lieux, table];
    for (const b of this.boutiques) this.bases[b.id] = copie(b);
    this.pnj.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));
    this.lieux.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));
    this.racine.innerHTML = this.gabarit();
    this.lier();
    this.commandes = new Commandes(this.racine.querySelector("[data-commandes]"), { surVente: (b) => this.apresCommande(b) });
    const choisie = this.boutiques.find((b) => b.id === this.idDemande) || null;
    if (this.idDemande && !choisie) history.replaceState(null, "", "#/boutiques");
    const demande = choisie && (choisie.articles || []).find((a) => a.id === this.articleDemande);
    if (demande) this.rechercheArticle = demande.nom || "";
    this.ouvrir(choisie);
    // Ce que montre la TV, lu comme le témoin de l'en-tête : la fiche et la liste le disent sans le deviner.
    this.finTv = ecouterTv((t) => {
      this.table = t;
      if (this.detruit) return;
      this.afficherTable();
      this.afficherListe();
    });
  }

  async detruire() {
    this.detruit = true;
    this.dialogue()?.close();
    this.commandes?.detruire();
    this.boutonTv.detruire();
    this.finTv?.();
    await this.vider();
    await this.purgerVierges();
  }

  vider() {
    if (this.modifies.size) this.sauver.maintenant();
    return this.chaine;
  }

  // Reste-t-il quelque chose qui n'est pas enregistré ? (l'onglet ne se ferme pas sans prévenir)
  aEnregistrer() {
    return this.modifies.size > 0 || this.sauver.enAttente() || this.envois > 0 || this.ventes > 0;
  }

  gabarit() {
    return `
    <section class="carnet boutiques">
      <aside class="carnet-liste">
        <header>
          <p class="kicker">Échoppes</p>
          <h1>Les boutiques</h1>
          <div class="tirages"><button class="principal" data-action="nouvelle">Nouvelle boutique</button><button type="button" class="bouton-commandes" data-commandes>Commandes des joueurs<span class="compte-commandes"></span></button></div>
          <input type="search" class="recherche" placeholder="Nom, marchand, lieu, article…" aria-label="Chercher une boutique">
        </header>
        <ul class="liste-boutiques"></ul>
      </aside>
      <article class="carnet-fiche fiche-boutique"></article>
      <datalist id="categories-boutique">${CATEGORIES.map((c) => `<option value="${e(c)}">`).join("")}</datalist>
      <dialog class="dialogue vente-boutique"></dialog>
    </section>`;
  }

  dialogue() {
    return this.racine.querySelector(".vente-boutique");
  }

  lier() {
    const r = this.racine;
    r.querySelector(".carnet-liste header").addEventListener("click", (ev) => {
      if (ev.target.closest('[data-action="nouvelle"]')) this.nouvelle();
    });
    r.querySelector(".recherche").addEventListener("input", () => this.afficherListe());
    r.querySelector(".liste-boutiques").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-boutique]");
      if (!b) return;
      history.replaceState(null, "", `#/boutiques/${b.dataset.boutique}`);
      // Trouvée par un de ses articles (« potion ») : la boutique s'ouvre sur eux.
      const boutique = this.boutiques.find((x) => x.id === b.dataset.boutique);
      const q = r.querySelector(".recherche").value.trim();
      const parElle = forme([boutique?.nom, boutique?.accroche, this.nomDe(this.pnj, boutique?.marchand), this.nomDe(this.lieux, boutique?.lieu)].join(" ")).includes(forme(q));
      this.rechercheArticle = q && !parElle && articlesTrouves((boutique?.articles || []).filter((a) => String(a.nom || "").trim()), q).length ? q : "";
      this.ouvrir(boutique);
      if (matchMedia("(max-width: 900px)").matches) r.querySelector(".fiche-boutique")?.scrollIntoView({ block: "start" });
    });
    const fiche = r.querySelector(".fiche-boutique");
    fiche.addEventListener("input", (ev) => this.saisie(ev, false));
    fiche.addEventListener("change", (ev) => this.saisie(ev, true));
    fiche.addEventListener("click", (ev) => this.clic(ev));
    fiche.addEventListener("input", (ev) => {
      if (!ev.target.matches(".chercher-article")) return;
      this.rechercheArticle = ev.target.value;
      this.afficherArticles();
    });
    const d = this.dialogue();
    d.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-acheteur]");
      if (b) this.vendre(b.dataset.acheteur);
    });
    // Entrée dans le champ du montant ne ferme pas le dialogue : seul « Annuler » le ferme sans vendre.
    d.addEventListener("submit", (ev) => {
      if (ev.submitter?.value !== "annuler") ev.preventDefault();
    });
    d.addEventListener("close", () => {
      this.vente = null;
    });
  }

  // ---------------------------------------------------------------- liste

  nomDe(liste, id) {
    return (id && liste.find((x) => x.id === id)?.nom) || "";
  }

  surLaTv(b) {
    return this.table?.vue === "boutique" && this.table.boutique === b.id;
  }

  // Les articles qui ont fait trouver une boutique (« potion »), quand ni son nom, ni son accroche, ni son marchand, ni
  // son lieu ne répondent : rappelés sous le nom, comme le champ trouvé des PNJ et des lieux.
  articlesQuiRepondent(b, brut) {
    const q = forme(brut);
    if (!q || forme([b.nom, b.accroche, this.nomDe(this.pnj, b.marchand), this.nomDe(this.lieux, b.lieu)].join(" ")).includes(q)) return [];
    const nommes = (b.articles || []).filter((a) => String(a.nom || "").trim());
    const siens = nommes.filter((a) => forme(a.nom).includes(q));
    return (siens.length ? siens : articlesTrouves(nommes, brut)).map((a) => String(a.nom).trim());
  }

  afficherListe() {
    const ul = this.racine.querySelector(".liste-boutiques");
    if (!ul) return;
    const brut = this.racine.querySelector(".recherche").value.trim();
    const q = forme(brut);
    if (!this.boutiques.length) {
      ul.innerHTML = `<li class="vide">Aucune boutique pour l'instant.<span class="aide">Créez-en une, puis « Ajouter les prix du kit » pour partir des prix indicatifs du kit de règles.</span></li>`;
      return;
    }
    const liste = this.boutiques
      // Plusieurs mots (« potion soin ») : trouvée aussi par les articles qui les portent tous, comme le Comptoir.
      .filter((b) => !q || forme([b.nom, b.accroche, this.nomDe(this.pnj, b.marchand), this.nomDe(this.lieux, b.lieu), ...(b.articles || []).map((a) => a.nom)].join(" ")).includes(q)
        || (/[\p{L}\p{N}]/u.test(brut) && this.articlesQuiRepondent(b, brut).length > 0))
      .sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));
    ul.innerHTML = liste.map((b) => {
      const n = (b.articles || []).filter((a) => String(a.nom || "").trim()).length;
      const meta = [this.nomDe(this.pnj, b.marchand), this.nomDe(this.lieux, b.lieu), `${n || "aucun"} article${n > 1 ? "s" : ""}`].filter(Boolean).join(" · ");
      const marquer = (t) => (q ? surligner(t, brut) : e(t));
      const articles = this.articlesQuiRepondent(b, brut);
      const rappel = articles.length
        ? `<span class="trouve"><b>Article${articles.length > 1 ? "s" : ""}</b> ${articles.slice(0, 3).map(marquer).join(", ")}${articles.length > 3 ? ` et ${articles.length - 3} autres` : ""}</span>`
        : "";
      return `
      <li><button data-boutique="${e(b.id)}" aria-current="${this.fiche?.id === b.id}">
        <span class="texte"><span class="nom">${marquer(b.nom || "Sans nom")}</span><span class="meta">${marquer(meta)}</span>${rappel}</span>
        ${this.surLaTv(b) ? '<span class="a-la-tv">à la TV</span>' : ""}${b.ouverte_joueurs === true ? '<span class="a-la-tv aux-joueurs" title="Ouverte aux joueurs entre les séances">joueurs</span>' : ""}
      </button></li>`;
    }).join("") || '<li class="vide">Aucune boutique ne correspond.</li>';
  }

  // Une « Nouvelle boutique » laissée intacte repart à la corbeille quand on passe à une autre (sauf si la TV la montre).
  purgerVierges(sauf = null) {
    return this.vierges.purger({
      sauf,
      trouve: (id) => this.boutiques.find((x) => x.id === id),
      modifiee: (id) => this.modifies.has(id) || this.surLaTv(this.boutiques.find((x) => x.id === id) || {}),
      retirer: (id) => {
        this.boutiques = this.boutiques.filter((x) => x.id !== id);
        if (this.fiche?.id === id) this.fiche = null;
      },
    });
  }

  ouvrir(b) {
    if (this.modifies.size) this.sauver.maintenant();
    if (this.vierges.liste.size) this.purgerVierges(b?.id).then((n) => n && !this.detruit && this.afficherListe()).catch(() => {});
    if ((b?.id || null) !== (this.fiche?.id || null)) this.deplies.clear();
    this.fiche = b || null;
    this.afficherFiche();
    this.afficherListe();
  }

  // ---------------------------------------------------------------- fiche

  afficherFiche() {
    const zone = this.racine.querySelector(".fiche-boutique");
    const b = this.fiche;
    if (!b) {
      zone.innerHTML = `<div class="fiche-vide"><p>Choisissez une boutique dans la liste, ou créez-en une.</p><p class="aide">Un marchand, ses articles et ses prix : la TV les montre comme une carte de marchand, groupés par catégorie, et un article peut s'y montrer de près.</p></div>`;
      return;
    }
    const options = (liste, valeur, vide) => `<option value="">${e(vide)}</option>`
      + liste.map((x) => `<option value="${e(x.id)}" ${x.id === valeur ? "selected" : ""}>${e(x.nom || x.id)}</option>`).join("");
    const marchand = this.pnj.find((p) => p.id === b.marchand);
    const lieu = this.lieux.find((l) => l.id === b.lieu);
    zone.innerHTML = `
      <div class="tete-boutique">
        <div class="identite-boutique">
          <div class="titre-avec-temoin"><input class="nom-boutique" type="text" value="${e(b.nom || "")}" data-champ="nom" aria-label="Nom de la boutique" placeholder="Le Comptoir du Pont">${htmlTemoin()}</div>
          <p class="resume-boutique">${[marchand ? `<a href="#/pnj/${e(marchand.id)}">${e(marchand.nom)}</a>` : "", lieu ? (lieu.carte ? `<a href="#/carte/${e(lieu.carte)}?lieu=${e(lieu.id)}">${e(lieu.nom)}</a>` : e(lieu.nom)) : "",
            ajustementDe(b) ? `prix ${pourcent(ajustementDe(b))}` : "", b.ouverte_joueurs === true ? "ouverte aux joueurs" : ""].filter(Boolean).join(" · ") || "Ni marchand ni lieu : « Préparer » pour les choisir."}</p>
          <label class="champ">Accroche, lue par les joueurs<input type="text" value="${e(b.accroche || "")}" data-champ="accroche" placeholder="Cordes, lanternes et lames honnêtes, tout pour la route."></label>
          <div class="grille-boutique">
            <label class="champ">Marchand<select data-champ="marchand">${options(this.pnj, b.marchand, "Aucun PNJ")}</select></label>
            <label class="champ">Lieu<select data-champ="lieu">${options(this.lieux, b.lieu, "Aucun lieu")}</select></label>
            <label class="champ">Ajustement des prix<span class="avec-unite"><input type="number" step="1" min="-90" max="500" value="${e(ajustementDe(b))}" data-champ="ajustement"><span>%</span></span></label>
          </div>
          <p class="aide">−10 pour une bonne réputation, +20 pour des étrangers : chaque nombre du prix change pour la table, arrondi à la pièce. Vous voyez les deux prix.</p>
          <label class="case ouverte-joueurs"><input type="checkbox" data-champ="ouverte_joueurs" ${b.ouverte_joueurs === true ? "checked" : ""}> Ouverte aux joueurs, entre les séances</label>
          <div class="etat-aux-joueurs" data-etat-carnet aria-live="polite" hidden></div>
          <p class="aide">Ils la parcourent depuis leur lien (carnet des joueurs ouvert, dans les Réglages) et y passent commande ; vous vendez ou refusez depuis « Commandes des joueurs ». Les articles cachés n'y paraissent pas.</p>
          <p class="liens">
            ${marchand ? `<a href="#/pnj/${e(marchand.id)}">Fiche du marchand</a>${marchand.connu ? "" : " <i>(inconnu des joueurs : son nom n'est pas montré)</i>"}` : ""}
            ${lieu?.carte ? `<a href="#/carte/${e(lieu.carte)}?lieu=${e(lieu.id)}">Voir le lieu sur la carte</a>` : ""}
          </p>
        </div>
        <div class="table-boutique"></div>
      </div>
      <label class="champ secret notes-boutique">Notes du MJ<textarea rows="2" data-champ="notes_mj" placeholder="Ce que le marchand sait, ce qu'il garde sous le comptoir, à qui il doit de l'argent…">${e(b.notes_mj || "")}</textarea></label>
      <section class="bloc-articles">
        <div class="barre-articles">
          <h2>Les articles</h2>
          <div class="modes modes-boutique" role="group" aria-label="Les articles">
            ${Object.entries(MODES_BOUTIQUE).map(([k, v]) => `<button type="button" data-mode-boutique="${k}" aria-pressed="${this.mode === k}" title="${k === "comptoir" ? "Pour jouer : une ligne par article" : "Pour préparer : chaque article en entier"}">${v}</button>`).join("")}
          </div>
          <input type="search" class="chercher-article" value="${e(this.rechercheArticle)}" placeholder="Chercher un article" aria-label="Chercher un article" autocomplete="off" spellcheck="false">
          <div class="actions">
            <button data-action="ajouter">Ajouter un article</button>
            <button data-action="kit" title="Repas, vivres, armes, armures, cheval, soins, gemme brute : seuls les articles absents de la boutique s'ajoutent">Ajouter les prix du kit</button>
          </div>
        </div>
        <div class="rayons-mj"></div>
      </section>
      <div class="actions pied-fiche"><button class="danger" data-action="supprimer">Mettre à la corbeille</button>
        <a class="lien-versions" href="${lienVersions("boutiques", b.id, `#/boutiques/${b.id}`)}">Versions précédentes</a></div>`;
    zone.dataset.mode = this.mode;
    zone.prepend(this.boutonTv.cadre);
    this.boutonTv.maj();
    zone.querySelectorAll("textarea").forEach(ajuster);
    this.afficherTable();
    this.afficherArticles();
    this.etat(!this.modifies.has(b.id) ? "ok" : this.reessai.actif ? "erreur" : "modifie");
    etatAuxJoueurs(zone.querySelector("[data-etat-carnet]"), b);
  }

  // Ce que montre la TV, et les boutons qui vont avec.
  afficherTable() {
    const zone = this.racine.querySelector(".table-boutique");
    const b = this.fiche;
    if (!zone || !b) return;
    const ici = this.surLaTv(b);
    const article = ici && this.table.article ? (b.articles || []).find((a) => a.id === this.table.article) : null;
    // Pas à la TV : ce qu'elle montre, nommé, pour savoir ce que « Montrer » va remplacer.
    const ailleurs = descriptionTv();
    zone.innerHTML = `
      <div class="place-tv"></div>
      <p class="sur-tv">${ici ? `À la TV${article ? `, et de près «\u00a0${e(article.nom || "sans nom")}\u00a0»` : ""}.` : ailleurs ? `La TV montre ${e(phraseTv(ailleurs))}.` : ""}</p>
      ${ici && article ? '<button data-action="toute-la-boutique">Toute la boutique</button>' : ""}
      ${this.htmlRayonsTv(b, ici)}`;
    for (const li of this.racine.querySelectorAll(".article-mj, .comptoir-article")) {
      const vu = Boolean(article) && li.dataset.article === article.id;
      li.classList.toggle("de-pres", vu);
      const bouton = li.querySelector('[data-action="montrer-article"], [data-action="toute-la-boutique"]');
      if (bouton) {
        bouton.dataset.action = vu ? "toute-la-boutique" : "montrer-article";
        bouton.textContent = vu ? "Ne plus le montrer de près" : "Montrer de près";
      }
    }
  }

  // Une boutique trop grande pour un écran se montre par rayon (rayons-tv.js, E07) : à la TV, un bouton par rayon, celui
  // de l'écran marqué ; avant, une phrase qui le dit.
  htmlRayonsTv(b, ici) {
    const pages = pagesEchoppe(articlesDeLaTv(b.articles));
    if (pages.length < 2) return "";
    if (!ici) return `<p class="aide rayons-aide">Trop d'articles pour un écran : la TV la montrera rayon par rayon (${pages.length} rayons), à faire défiler d'ici.</p>`;
    const rayon = pageDemandee(pages, this.table.rayon);
    return `<div class="rayons-tv-mj" role="group" aria-label="Rayon montré à la TV">
      <span class="lbl">Rayon à la TV</span>
      ${pages.map((p, i) => `<button data-action="rayon-tv" data-rayon="${i}" aria-pressed="${i === rayon}" title="${p.articles.length} article${p.articles.length > 1 ? "s" : ""}">${e(p.nom)}</button>`).join("")}
      ${rayon < pages.length - 1 ? `<button data-action="rayon-tv" data-rayon="${rayon + 1}" class="rayon-suivant">Rayon suivant ›</button>` : ""}
    </div>`;
  }

  // Le rayon que montre la TV : l'article montré de près s'efface, l'échoppe glisse au rayon choisi.
  montrerRayon(rayon) {
    const id = this.fiche?.id;
    const pages = pagesEchoppe(articlesDeLaTv(this.fiche?.articles));
    const nom = pages[rayon]?.nom;
    if (!nom) return null;
    return this.envoyerTable((etat) => (etat.vue === "boutique" && etat.boutique === id ? { ...etat, rayon, article: null } : null),
      { message: `À la TV : le rayon «\u00a0${nom}\u00a0».`, sinon: "La TV montre déjà autre chose." });
  }

  htmlArticle(a, ajustement, vu) {
    const pourTable = prixPourLaTable(a, ajustement);
    const vendable = String(a.nom || "").trim() && !epuise(a);
    return `
      <li class="article-mj${a.cache ? " cache" : ""}${epuise(a) ? " epuise" : ""}${vu ? " de-pres" : ""}" data-article="${e(a.id)}">
        <div class="ligne-article">
          <span class="vignette-article" title="Son dessin sur les étagères de la TV">${objetSvg(a, "vignette")}</span>
          <input class="nom-article" type="text" value="${e(a.nom || "")}" data-a="nom" placeholder="Nom de l'article" aria-label="Nom de l'article">
          <label class="prix-article" title="Tel que vous le tapez : « 25 », « à partir de 150 », « 15 / 120 / 600 »"><input type="text" value="${e(a.prix || "")}" data-a="prix" placeholder="prix" aria-label="Prix de base"><span>po</span></label>
          <label class="stock-article" title="Vide : sans limite. 0 : épuisé (barré sur la TV)."><span>Stock</span><input type="number" min="0" step="1" value="${typeof a.stock === "number" ? e(a.stock) : ""}" data-a="stock" placeholder="sans limite" aria-label="Stock"></label>
          <button data-action="vendre" ${vendable ? "" : "disabled"} title="${epuise(a) ? "Épuisé : remettez du stock pour le vendre" : "Retire le prix de l'or d'un aventurier et lui donne l'article"}">Vendre à…</button>
        </div>
        <p class="prix-table" ${pourTable ? "" : "hidden"}>${e(pourTable)}</p>
        <div class="ligne-article seconde">
          <input type="text" value="${e(a.description || "")}" data-a="description" placeholder="Ce qu'en lisent les joueurs (facultatif)" aria-label="Description vue par les joueurs">
          <input class="note-mj" type="text" value="${e(a.note_mj || "")}" data-a="note_mj" placeholder="Note du MJ" aria-label="Note du MJ">
        </div>
        <div class="outils-article">
          <input class="categorie-article" type="text" value="${e(a.categorie || "")}" data-a="categorie" list="categories-boutique" placeholder="Catégorie" aria-label="Catégorie">
          <label class="dessin-article" title="Le dessin de l'article sur les étagères de la TV"><span>Dessin</span><select data-a="dessin" aria-label="Dessin sur la TV">
            <option value="">${e(`Selon le nom (${dessinDevine(a)})`)}</option>${NOMS_DESSINS.map(([v, n]) => `<option value="${v}" ${a.dessin === v ? "selected" : ""}>${e(n)}</option>`).join("")}
          </select></label>
          <label class="case"><input type="checkbox" data-a="cache" ${a.cache ? "checked" : ""}> Caché aux joueurs</label>
          <button class="lien" data-action="${vu ? "toute-la-boutique" : "montrer-article"}">${vu ? "Ne plus le montrer de près" : "Montrer de près"}</button>
          <span class="pousse"></span>
          <button class="mini" data-action="monter" title="Monter" aria-label="Monter">↑</button>
          <button class="mini" data-action="descendre" title="Descendre" aria-label="Descendre">↓</button>
          <button class="mini" data-action="dupliquer">Dupliquer</button>
          <button class="mini danger" data-action="retirer">Retirer</button>
        </div>
      </li>`;
  }

  // Les articles par catégorie, comme sur la TV. Le champ qui avait la main la retrouve (même article, même champ).
  afficherArticles() {
    const zone = this.racine.querySelector(".rayons-mj");
    const b = this.fiche;
    if (!zone || !b) return;
    const actif = document.activeElement;
    const garde = zone.contains(actif) ? { article: actif.closest("[data-article]")?.dataset.article, a: actif.dataset.a, action: actif.dataset.action } : null;
    const articles = b.articles || [];
    const a = ajustementDe(b);
    const vu = this.surLaTv(b) ? this.table.article : null;
    // « Chercher un article », puis le comptoir (une ligne par article) ou l'éditeur complet (comptoir.js).
    // Un article déplié reste en vue, même si on lui donne un nom que la recherche ne trouve plus.
    const repondent = new Set(articlesTrouves(articles, this.rechercheArticle));
    const trouves = articles.filter((x) => repondent.has(x) || this.deplies.has(x.id));
    const groupes = grouper(trouves);
    const compte = htmlCompte(articles.filter((x) => String(x.nom || "").trim()).length, trouves.filter((x) => String(x.nom || "").trim()).length, this.rechercheArticle);
    zone.innerHTML = articles.length && this.mode === "comptoir" ? compte + htmlComptoir(groupes, {
      ajustement: a, vu, recherche: this.rechercheArticle, deplies: this.deplies, editeur: (x) => this.htmlArticle(x, a, x.id === vu),
    }) : articles.length ? compte + groupes.map((g, i) => `
      <section class="rayon-mj" data-categorie="${e(g.categorie)}">
        <header class="tete-rayon">
          <h3>${e(g.categorie || "Sans catégorie")}</h3>
          <span class="compte">${g.articles.length}</span>
          <button class="lien" data-action="ajouter-ici">Ajouter ici</button>
          <span class="pousse"></span>
          ${groupes.length > 1 ? `
            <button class="mini" data-action="rayon-monter" ${i ? "" : "disabled"} title="Monter la catégorie" aria-label="Monter la catégorie">↑</button>
            <button class="mini" data-action="rayon-descendre" ${i < groupes.length - 1 ? "" : "disabled"} title="Descendre la catégorie" aria-label="Descendre la catégorie">↓</button>` : ""}
        </header>
        <ol class="articles-mj">${g.articles.map((x) => this.htmlArticle(x, a, x.id === vu)).join("")}</ol>
      </section>`).join("")
      : `<p class="vide">Aucun article. « Ajouter un article » pour le premier, ou « Ajouter les prix du kit ».</p>`;
    if (!garde?.article) return;
    const li = zone.querySelector(`[data-article="${CSS.escape(garde.article)}"]`);
    const cible = li && (garde.a ? li.querySelector(`[data-a="${garde.a}"]`) : garde.action ? li.querySelector(`[data-action="${garde.action}"]`) : null);
    cible?.focus();
  }

  // Après la destruction, la page en montre une autre : l'état n'y est plus écrit.
  etat(quoi) {
    this.etatAffiche = quoi;
    afficherTemoin(this.detruit ? null : this.racine.querySelector(".tete-boutique .temoin-enregistrement"), quoi, { reessai: this.reessai, modifie: this.fiche?.modifie });
  }

  modifier(b) {
    this.modifies.add(b.id);
    this.etat("modifie");
    this.sauver();
  }

  // Le texte s'enregistre à la frappe, les listes et les cases quand elles changent. La catégorie regroupe les articles
  // quand on la quitte.
  saisie(ev, change) {
    const el = ev.target;
    const b = this.fiche;
    if (!b) return;
    const choix = el.type === "checkbox" || el.tagName === "SELECT";
    if (el.dataset.champ) {
      if (choix !== change) return;
      const cle = el.dataset.champ;
      if (cle === "ajustement") {
        if (change) return;
        const v = Number(el.value);
        b.ajustement = el.value.trim() === "" || !Number.isFinite(v) ? 0 : v;
        this.majPrixTable();
      } else b[cle] = el.type === "checkbox" ? el.checked : el.value;
      if (el.tagName === "TEXTAREA") ajuster(el);
      this.modifier(b);
      if (["nom", "marchand", "lieu", "ouverte_joueurs"].includes(cle)) this.afficherListe();
      if (cle === "ouverte_joueurs") etatAuxJoueurs(this.racine.querySelector("[data-etat-carnet]"), b);
      if (cle === "marchand" || cle === "lieu") this.afficherFiche();
      return;
    }
    const li = el.closest("[data-article]");
    const article = li && (b.articles || []).find((x) => x.id === li.dataset.article);
    if (!article || !el.dataset.a) return;
    const cle = el.dataset.a;
    if (cle === "categorie" && change) {
      // Laissé le temps au focus de passer au champ suivant : il le retrouve après le regroupement.
      setTimeout(() => this.afficherArticles(), 0);
      return;
    }
    if (choix !== change) return;
    if (cle === "cache") article.cache = el.checked;
    else if (cle === "stock") {
      const n = Math.floor(Number(el.value));
      article.stock = el.value.trim() === "" || !Number.isFinite(n) ? null : Math.max(0, n);
    } else article[cle] = el.value;
    this.modifier(b);
    if (cle === "cache") li.classList.toggle("cache", article.cache);
    if (cle === "stock" || cle === "nom") {
      li.classList.toggle("epuise", epuise(article));
      const vendre = li.querySelector('[data-action="vendre"]');
      vendre.disabled = !String(article.nom || "").trim() || epuise(article);
    }
    if (cle === "prix") this.majPrixTable(li, article);
    if (cle === "nom") this.afficherListe();
    if (cle === "nom" || cle === "dessin" || cle === "description") this.majVignette(li, article);
  }

  // La vignette de l'article et le dessin deviné d'après son nom, sans redessiner les champs.
  majVignette(li, article) {
    const v = li.querySelector(".vignette-article");
    if (v) v.innerHTML = objetSvg(article, "vignette");
    const devine = li.querySelector('[data-a="dessin"] option[value=""]');
    if (devine) devine.textContent = `Selon le nom (${dessinDevine(article)})`;
  }

  // Le prix pour la table sous chaque article (ou sous un seul), sans redessiner les champs.
  majPrixTable(li = null, article = null) {
    const b = this.fiche;
    const a = ajustementDe(b);
    const lignes = li ? [[li, article]] : [...this.racine.querySelectorAll(".article-mj")].map((x) => [x, (b.articles || []).find((y) => y.id === x.dataset.article)]);
    for (const [ligne, art] of lignes) {
      const p = ligne.querySelector(".prix-table");
      if (!p || !art) continue;
      p.textContent = prixPourLaTable(art, a);
      p.hidden = !p.textContent;
    }
  }

  // ---------------------------------------------------------------- enregistrement

  // En file, chaque fiche avec sa version : ce qu'un autre écran a enregistré entre-temps est fusionné, jamais écrasé.
  enregistrer() {
    this.envois++;
    this.chaine = this.chaine.then(() => this.ecrire()).finally(() => this.envois--);
    return this.chaine;
  }

  async ecrire() {
    const ids = [...this.modifies];
    this.modifies.clear();
    const erreurs = [];
    for (const id of ids) {
      const b = this.boutiques.find((x) => x.id === id);
      if (!b) continue;
      try {
        const fusion = await enregistrerAvecVersion(`/api/boutiques/${id}`, b, this.bases, id, { listes: { articles: "id" } });
        if (this.fiche?.id === id && !this.modifies.has(id)) this.etat("ok");
        if (fusion && !this.detruit) {
          toast(`« ${b.nom} » avait été modifiée sur un autre écran : ses changements et les vôtres sont réunis.`);
          if (this.fiche?.id === id && !this.racine.querySelector(".fiche-boutique")?.contains(document.activeElement)) this.afficherFiche();
        }
        // La TV relit la boutique à chaque état reçu : on le lui renvoie si elle la montre.
        if (this.surLaTv(b)) this.envoyerTable((etat) => (etat.vue === "boutique" && etat.boutique === id ? etat : null));
      } catch (err) {
        erreurs.push(err);
        this.modifies.add(id);
        this.reessai.signaler(err, `« ${b.nom} » non enregistrée`);
      }
    }
    if (!ids.length) return;
    this.reessai.bilan(erreurs);
    if (erreurs.length) this.etat("erreur");
  }

  async nouvelle() {
    try {
      const b = await api.post("/api/boutiques", { nom: nomDistinct("Nouvelle boutique", this.boutiques.map((x) => x.nom)), accroche: "", marchand: "", lieu: "", ajustement: 0, notes_mj: "", articles: [] });
      this.bases[b.id] = copie(b);
      this.boutiques.push(b);
      this.vierges.marquer(b.id, "/api/boutiques", b);
      history.replaceState(null, "", `#/boutiques/${b.id}`);
      this.ouvrir(b);
      const nom = this.racine.querySelector(".nom-boutique");
      nom?.focus();
      nom?.select();
    } catch (err) {
      toast(`Création impossible : ${err.message}`, "erreur");
    }
  }

  // ---------------------------------------------------------------- articles

  focaliser(id, champ = "nom") {
    const el = this.racine.querySelector(`[data-article="${CSS.escape(id)}"] [data-a="${champ}"]`);
    if (!el) return;
    el.focus();
    el.select?.();
    el.scrollIntoView({ block: "nearest" });
  }

  ajouterPrixDuKit() {
    const b = this.fiche;
    b.articles ||= [];
    const presents = new Set(b.articles.map((a) => forme(a.nom)));
    const nouveaux = PRIX_DU_KIT.filter((k) => !presents.has(forme(k.nom)));
    if (!nouveaux.length) return toast("Tous les prix du kit sont déjà dans la boutique.");
    for (const k of nouveaux) b.articles.push(articleVide(b.articles, k));
    this.modifier(b);
    this.afficherArticles();
    this.afficherListe();
    toast(`${nouveaux.length} article${nouveaux.length > 1 ? "s" : ""} du kit ajouté${nouveaux.length > 1 ? "s" : ""}.`);
  }

  // Monter ou descendre un article parmi ceux de sa catégorie, ou toute une catégorie parmi les autres.
  deplacer(article, sens) {
    const liste = this.fiche.articles;
    const i = liste.indexOf(article);
    const cat = String(article.categorie || "").trim();
    let j = i + sens;
    while (j >= 0 && j < liste.length && String(liste[j].categorie || "").trim() !== cat) j += sens;
    if (j < 0 || j >= liste.length) return false;
    [liste[i], liste[j]] = [liste[j], liste[i]];
    return true;
  }

  deplacerRayon(categorie, sens) {
    const groupes = grouper(this.fiche.articles);
    const i = groupes.findIndex((g) => g.categorie === categorie);
    const j = i + sens;
    if (i < 0 || j < 0 || j >= groupes.length) return false;
    [groupes[i], groupes[j]] = [groupes[j], groupes[i]];
    this.fiche.articles = groupes.flatMap((g) => g.articles);
    return true;
  }

  async clic(ev) {
    const bouton = ev.target.closest("button");
    const b = this.fiche;
    if (!bouton || !b) return;
    const action = bouton.dataset.action;
    const li = bouton.closest("[data-article]");
    const article = li && (b.articles || []).find((x) => x.id === li.dataset.article);
    const rayon = bouton.closest("[data-categorie]");
    if (bouton.dataset.modeBoutique) return this.changerMode(bouton.dataset.modeBoutique);
    try {
      if (action === "montrer") return await this.montrer(null);
      if (action === "retirer-tv") return await this.retirer();
      if (action === "rayon-tv") return await this.montrerRayon(Number(bouton.dataset.rayon));
      if (action === "toute-la-boutique") return await this.montrer(null, { message: "À la TV : toute la boutique." });
      if (action === "kit") return this.ajouterPrixDuKit();
      if (action === "ajouter" || action === "ajouter-ici") {
        b.articles ||= [];
        const categorie = action === "ajouter-ici" ? rayon?.dataset.categorie || "" : "";
        const nouveau = articleVide(b.articles, { categorie });
        // Dans sa catégorie, après le dernier article de celle-ci ; sinon à la fin.
        let place = b.articles.length;
        if (action === "ajouter-ici") for (let k = 0; k < b.articles.length; k++) if (String(b.articles[k].categorie || "").trim() === categorie) place = k + 1;
        b.articles.splice(place, 0, nouveau);
        this.modifier(b);
        // Au comptoir aussi, le nouvel article s'ouvre en entier ; la recherche s'efface pour le laisser en vue.
        this.deplies.add(nouveau.id);
        this.effacerRecherche();
        this.afficherArticles();
        this.afficherListe();
        return this.focaliser(nouveau.id);
      }
      if (action === "rayon-monter" || action === "rayon-descendre") {
        if (this.deplacerRayon(rayon.dataset.categorie, action === "rayon-monter" ? -1 : 1)) {
          this.modifier(b);
          this.afficherArticles();
        }
        return;
      }
      if (action === "supprimer") return await this.supprimer();
      if (!article) return;
      if (action === "monter" || action === "descendre") {
        if (this.deplacer(article, action === "monter" ? -1 : 1)) {
          this.modifier(b);
          this.afficherArticles();
          this.racine.querySelector(`[data-article="${CSS.escape(article.id)}"] [data-action="${action}"]`)?.focus();
        }
        return;
      }
      if (action === "deplier") {
        if (!this.deplies.delete(article.id)) this.deplies.add(article.id);
        this.afficherArticles();
        const ouvert = this.deplies.has(article.id);
        return ouvert ? this.focaliser(article.id) : this.racine.querySelector(`[data-article="${CSS.escape(article.id)}"] [data-action="deplier"]`)?.focus();
      }
      if (action === "dupliquer") {
        const double = { ...copie(article), id: idArticle(b.articles) };
        b.articles.splice(b.articles.indexOf(article) + 1, 0, double);
        this.modifier(b);
        this.deplies.add(double.id);
        this.afficherArticles();
        return this.focaliser(double.id);
      }
      if (action === "retirer") {
        // Sans confirmation : « Annuler » le remet à sa place pendant dix secondes.
        const rang = b.articles.indexOf(article);
        b.articles = b.articles.filter((x) => x !== article);
        this.modifier(b);
        this.afficherArticles();
        this.afficherListe();
        if (String(article.nom || "").trim()) {
          toast(`« ${article.nom} » retiré de la boutique.`, "info", {
            action: {
              libelle: "Annuler",
              faire: () => {
                const ici = !this.detruit && this.boutiques.find((x) => x.id === b.id);
                if (!ici) return toast("La boutique n'est plus ouverte ici : ses versions précédentes gardent l'article.", "erreur");
                if (!ici.articles.some((x) => x.id === article.id)) ici.articles.splice(Math.min(rang, ici.articles.length), 0, article);
                this.modifier(ici);
                if (this.fiche === ici) this.afficherArticles();
                this.afficherListe();
              },
            },
          });
        }
        return;
      }
      if (action === "montrer-article") {
        if (article.cache) {
          if (!(await demander({ titre: "Montrer un article caché", texte: `« ${article.nom || "Cet article"} » est caché aux joueurs. Le rendre visible et le montrer à la TV ?`, oui: "Le rendre visible et montrer", non: "Ne pas montrer", danger: true }))) return;
          article.cache = false;
          this.modifier(b);
          this.afficherArticles();
        }
        return await this.montrer(article.id);
      }
      if (action === "vendre") return await this.ouvrirVente(article);
    } catch (err) {
      toast(`Impossible : ${err.message}`, "erreur");
    }
  }

  // Comptoir ou Préparer, gardé pour la prochaine fois.
  changerMode(mode) {
    if (!MODES_BOUTIQUE[mode] || mode === this.mode) return;
    this.mode = mode;
    garderModeBoutique(mode);
    const zone = this.racine.querySelector(".fiche-boutique");
    if (zone) zone.dataset.mode = mode;
    for (const x of this.racine.querySelectorAll("[data-mode-boutique]")) x.setAttribute("aria-pressed", String(x.dataset.modeBoutique === mode));
    this.afficherArticles();
  }

  effacerRecherche() {
    this.rechercheArticle = "";
    const champ = this.racine.querySelector(".chercher-article");
    if (champ) champ.value = "";
  }

  // Sans confirmation : ce qui attend part d'abord (la boutique reviendra entière), puis « Annuler » dix secondes.
  async supprimer() {
    const b = this.fiche;
    await this.vider();
    this.sauver.annuler();
    await this.chaine;
    try {
      await api.del(`/api/boutiques/${b.id}`);
    } catch (err) {
      return toast(`Suppression impossible : ${err.message}`, "erreur");
    }
    if (this.surLaTv(b)) this.retirer({ message: "" });
    this.boutiques = this.boutiques.filter((x) => x.id !== b.id);
    this.modifies.delete(b.id);
    history.replaceState(null, "", "#/boutiques");
    this.ouvrir(null);
    annoncerCorbeille(`« ${b.nom || "Cette boutique"} » mise à la corbeille.`, "boutiques", b.id, { retour: `#/boutiques/${b.id}` });
  }

  // ---------------------------------------------------------------- la TV

  // L'état de la table est relu juste avant chaque envoi : ce qu'un autre écran y a posé (un carton, un combat) reste.
  // fabrique rend l'état à envoyer, ou null pour ne rien envoyer (la TV montre déjà autre chose).
  envoyerTable(fabrique, { message = "", sinon = "" } = {}) {
    this.fileTable = this.fileTable.then(async () => {
      try {
        const etat = await api.get("/api/table");
        delete etat.ecrans;
        const nouveau = fabrique(etat);
        if (!nouveau) {
          this.table = etat;
          if (sinon) toast(sinon);
        } else {
          const r = await api.put("/api/table", nouveau);
          this.table = nouveau;
          if (message) toast(r.ecrans ? message : "Envoyé, mais aucun écran de table n'est ouvert.");
        }
      } catch (err) {
        toast(err.status && err.status < 500 ? err.message : `La table ne répond pas : ${err.message}`, "erreur");
      }
      if (this.detruit) return;
      this.afficherTable();
      this.afficherListe();
    });
    return this.fileTable;
  }

  async montrer(article, { message } = {}) {
    const b = this.fiche;
    // La TV lit la boutique enregistrée : ce qui attend part d'abord.
    if (this.modifies.size) await this.sauver.maintenant();
    const id = b.id;
    const pages = pagesEchoppe(articlesDeLaTv(b.articles));
    return this.envoyerTable((etat) => {
      const avant = SANS_RETOUR.includes(etat.vue) ? etat.avant || null : Object.fromEntries(VUE_AVANT.map((k) => [k, etat[k] ?? null]));
      // Par rayon : l'article montré de près sur le sien ; sinon le rayon déjà à l'écran, ou le premier.
      const deja = etat.vue === "boutique" && etat.boutique === id ? pageDemandee(pages, etat.rayon) : 0;
      const rayon = pages.length < 2 ? null : article ? pageDeLArticle(pages, article) : deja;
      return { ...etat, vue: "boutique", boutique: id, article: article || null, rayon, avant, lieu: null };
    }, { message: message || (article ? `À la TV, de près : «\u00a0${(b.articles || []).find((a) => a.id === article)?.nom || "l'article"}\u00a0».` : `À la TV : la boutique «\u00a0${b.nom || "sans nom"}\u00a0».`) });
  }

  retirer({ message = `Retiré de la TV : la boutique «\u00a0${this.fiche?.nom || "sans nom"}\u00a0».` } = {}) {
    const id = this.fiche?.id;
    return this.envoyerTable((etat) => {
      if (etat.vue !== "boutique" || etat.boutique !== id) return null;
      const avant = etat.avant && !SANS_RETOUR.includes(etat.avant.vue) ? etat.avant : { vue: "accueil" };
      return { ...etat, ...avant, boutique: null, article: null, rayon: null, avant: null };
    }, { message, sinon: message ? "La TV montre déjà autre chose." : "" });
  }

  // Une commande vendue a changé le stock de la boutique : la copie de l'écran le reprend, sauf saisie en cours (sa
  // fusion à l'enregistrement s'en chargera).
  apresCommande(boutique) {
    const i = this.boutiques.findIndex((x) => x.id === boutique.id);
    if (i < 0 || this.modifies.has(boutique.id) || this.detruit) return;
    this.boutiques[i] = boutique;
    this.bases[boutique.id] = copie(boutique);
    if (this.fiche?.id === boutique.id) {
      this.fiche = boutique;
      this.afficherFiche();
    }
    this.afficherListe();
  }

  // ---------------------------------------------------------------- vendre

  async ouvrirVente(article) {
    const b = this.fiche;
    let tablee;
    try {
      tablee = (await api.get("/api/aventuriers")).filter((a) => a.tablee !== false && a.id);
    } catch (err) {
      return toast(`Aventuriers illisibles : ${err.message}`, "erreur");
    }
    tablee.sort((x, y) => (x.cree || "").localeCompare(y.cree || ""));
    const a = ajustementDe(b);
    const ajuste = ajusterPrix(article.prix, a);
    const simple = montantDuPrix(ajuste);
    const propose = simple ?? premierNombre(ajuste);
    const base = String(article.prix || "").trim();
    const explication = !base ? "Pas de prix : tapez le montant payé."
      : simple === null ? `Prix « ${avecPo(ajuste)} » : tapez le montant payé.`
      : a && ajuste !== base ? `${avecPo(ajuste)} pour la table (${avecPo(base)}, ajusté de ${pourcent(a)}).` : `${avecPo(ajuste)}.`;
    this.vente = { article: article.id, boutique: b.id, tablee };
    const d = this.dialogue();
    d.innerHTML = `
      <form method="dialog">
        <h2>Vendre « ${e(article.nom)} »</h2>
        <p class="aide">${e(explication)}</p>
        <label class="champ">Montant payé, en pièces d'or<input type="number" name="montant" min="0" step="1" value="${propose ?? ""}" inputmode="numeric"></label>
        <p class="titre-acheteurs">Qui l'achète ?</p>
        ${tablee.length ? `<ul class="acheteurs">${tablee.map((x) => `
          <li><button type="button" data-acheteur="${e(x.id)}">
            <span class="nom">${e(x.nom || "Sans nom")}</span>
            <span class="bourse">${orDe(x) === null ? "pas de bourse" : `${orDe(x)} po`}</span>
          </button></li>`).join("")}</ul>` : '<p class="vide">Aucun aventurier dans la tablée.</p>'}
        <p class="refus" role="alert" hidden></p>
        <p class="aide">L'or est retiré de sa bourse, l'article s'ajoute à son équipement${typeof article.stock === "number" ? ", le stock baisse d'un" : ""}, et l'achat est noté au journal de la séance.</p>
        <div class="actions"><button value="annuler" formnovalidate>Annuler</button></div>
      </form>`;
    d.showModal();
    const champ = d.querySelector('[name="montant"]');
    if (propose === null || simple === null) {
      champ.focus();
      champ.select();
    }
  }

  refuser(texte) {
    const p = this.dialogue().querySelector(".refus");
    if (!p) return toast(texte, "erreur");
    p.textContent = texte;
    p.hidden = !texte;
  }

  // L'achat : l'or et l'équipement partent ensemble, chacun avec sa valeur d'avant. Refusé (409, le sac a changé sur un
  // autre écran) : la fiche est relue et l'achat rejoué sur elle, trois fois au plus. Puis le stock et le journal.
  async vendre(idAventurier) {
    const v = this.vente;
    const d = this.dialogue();
    const b = this.boutiques.find((x) => x.id === v?.boutique);
    const article = b && (b.articles || []).find((x) => x.id === v.article);
    if (!article || this.ventes) return;
    const saisi = d.querySelector('[name="montant"]').value.trim();
    const montant = Number(saisi);
    if (saisi === "" || !Number.isInteger(montant) || montant < 0) return this.refuser("Indiquez le montant payé, en pièces d'or entières.");
    const choisi = v.tablee.find((x) => x.id === idAventurier);
    if (!choisi) return;
    const qui = prenom(choisi.nom) || "Cet aventurier";
    this.refuser("");
    this.ventes++;
    for (const x of d.querySelectorAll("[data-acheteur]")) x.disabled = true;
    let fiche;
    let ajoute = "";
    try {
      // Relue : sa bourse a pu changer depuis l'ouverture du dialogue (la compagnie, un autre écran).
      fiche = await api.get(`/api/aventuriers/${encodeURIComponent(idAventurier)}`);
      for (let essai = 0; ; essai++) {
        const bourse = orDe(fiche) ?? 0;
        if (montant > bourse) {
          return this.refuser(bourse ? `${qui} n'a que ${bourse} po : il en faut ${montant}.` : `${qui} n'a pas d'or : il en faut ${montant}.`);
        }
        const corps = montant ? corpsDuSac(fiche, { genre: "or", texte: `-${montant}` }) : {};
        const sac = corpsDuSac(fiche, { genre: "ajouter", liste: "equipement", texte: article.nom });
        if (corps.erreur || sac.erreur) return this.refuser(corps.erreur || sac.erreur);
        // Ce qui entre dans le sac : une ligne de plus, ou un exemplaire de plus sur la ligne de ce nom. « Annuler la
        // vente » le reprend par son nom, quel que soit le compte de la ligne à ce moment-là.
        ajoute = sac.equipement ? article.nom : "";
        try {
          fiche = await api.patch(`/api/aventuriers/${encodeURIComponent(fiche.id)}/sac`, { ...corps, ...sac });
          break;
        } catch (err) {
          if (err.status !== 409 || essai === 2) return this.refuser(`Vente non enregistrée : ${err.message}.`);
          fiche = await api.get(`/api/aventuriers/${encodeURIComponent(fiche.id)}`);
        }
      }
    } catch (err) {
      return this.refuser(`Vente non enregistrée : ${err.message}.`);
    } finally {
      this.ventes--;
      for (const x of d.querySelectorAll("[data-acheteur]")) x.disabled = false;
    }
    d.close();
    const stockBaisse = typeof article.stock === "number" && article.stock > 0;
    if (typeof article.stock === "number") {
      article.stock = Math.max(0, article.stock - 1);
      this.modifier(b);
      if (this.fiche === b) this.afficherArticles();
    }
    const reste = orDe(fiche) ?? 0;
    const chez = b.nom || "le marchand";
    let journal = "";
    let noteJournal = null;
    try {
      const seance = seanceDuJournal(await api.get("/api/seances"));
      if (seance) {
        const texte = montant ? `${qui} achète ${article.nom} (${montant} po) chez ${chez}.` : `${qui} reçoit ${article.nom} (offert) chez ${chez}.`;
        const r = await noterAuJournal(seance.id, texte);
        const ligne = [...(r.journal || [])].reverse().find((j) => j.texte === texte);
        if (ligne?.id) noteJournal = { seance: seance.id, ligne };
        journal = ", noté au journal";
      } else journal = " (aucune séance ouverte : rien au journal)";
    } catch (err) {
      toast(`Achat non noté au journal : ${err.message}`, "erreur");
    }
    const vente = { aventurier: fiche.id, qui, montant, ajoute, boutique: b.id, article: article.id, nom: article.nom, stockBaisse, noteJournal };
    toast(montant ? `${qui} achète ${article.nom} pour ${montant} po : il lui reste ${reste} po${journal}.` : `${qui} reçoit ${article.nom}, offert${journal}.`, "info", {
      action: { libelle: montant ? "Annuler la vente" : "Annuler", faire: () => this.annulerVente(vente) },
    });
  }

  // « Annuler la vente », dans les dix secondes : l'or revient dans la bourse, l'article quitte le sac (la quantité de sa
  // ligne baisse d'autant, la ligne s'en va au dernier), le stock remonte d'un, la ligne du journal s'efface. Le sac est
  // relu d'abord : ce qu'un autre écran y a changé entre-temps reste.
  async annulerVente(v) {
    let sansArticle = false;
    try {
      for (let essai = 0; ; essai++) {
        const fiche = await api.get(`/api/aventuriers/${encodeURIComponent(v.aventurier)}`);
        const corps = v.montant ? corpsDuSac(fiche, { genre: "or", texte: `+${v.montant}` }) : {};
        const sac = v.ajoute ? reprisDuSac(fiche, v.ajoute) : null;
        sansArticle = !sac;
        if (corps.erreur || sac?.erreur) throw new Error(corps.erreur || sac.erreur);
        try {
          await api.patch(`/api/aventuriers/${encodeURIComponent(fiche.id)}/sac`, { ...corps, ...(sac || {}) });
          break;
        } catch (err) {
          if (err.status !== 409 || essai === 2) throw err;
        }
      }
    } catch (err) {
      return toast(`Vente non annulée : ${err.message}`, "erreur");
    }
    if (v.stockBaisse) await this.remonterStock(v.boutique, v.article);
    if (v.noteJournal) retirerDuJournal(v.noteJournal.seance, v.noteJournal.ligne, -1).catch(() => {});
    const rendu = v.montant ? `${v.qui} récupère ses ${v.montant} po` : `${v.qui} rend le cadeau`;
    toast(`Vente annulée : ${rendu}${sansArticle ? ` (« ${v.nom} » n'était déjà plus dans son sac)` : `, « ${v.nom} » revient en boutique`}.`);
  }

  // Le stock d'un article remonte d'un : sur la fiche ouverte ici si elle l'est encore (son enregistrement l'emporte),
  // sinon directement sur le serveur.
  async remonterStock(idBoutique, idArticle) {
    const ici = !this.detruit && this.boutiques.find((x) => x.id === idBoutique);
    const a = ici && (ici.articles || []).find((x) => x.id === idArticle);
    if (a) {
      if (typeof a.stock === "number") a.stock += 1;
      this.modifier(ici);
      if (this.fiche === ici) this.afficherArticles();
      return;
    }
    for (let essai = 0; essai < 3; essai++) {
      try {
        const b = await api.get(`/api/boutiques/${encodeURIComponent(idBoutique)}`);
        const x = (b.articles || []).find((y) => y.id === idArticle);
        if (!x || typeof x.stock !== "number") return;
        x.stock += 1;
        await api.put(`/api/boutiques/${encodeURIComponent(idBoutique)}`, { ...b, version_base: b.modifie });
        return;
      } catch (err) {
        if (err.status !== 409 || essai === 2) return toast(`Stock non remonté : ${err.message}`, "erreur");
      }
    }
  }
}
