// Carnet de PNJ : liste, fiche éditable (enregistrée au fil de la frappe), tirages au sort, portraits, envoi à la table.

import { api, copie, differer, echapper as e, enregistrerAvecVersion, erreurIA, toast } from "../api.js";
import { annoncerCorbeille, lienVersions } from "../corbeille/corbeille.js";
import { cartonVerifie } from "./carton-pnj.js";
import { demander } from "../commun/dialogue.js";
import { Vierges, nomDistinct } from "../commun/vierges.js";
import { attributsMiniature } from "../commun/miniature.js";
import { afficherTemoin, htmlTemoin } from "../commun/temoin-enregistrement.js";
import { BoutonTv, annoncerTv } from "../ecran-tv/bouton-tv.js";
import { de, ecouterTv } from "../ecran-tv/etat-tv.js";
import { chercherPnj, htmlTrouve, surligner } from "../chercher/listes.js";
import { Galerie } from "../illustrations/illustrations.js";
import { Reessai } from "../commun/reessai.js";
import { estInvite } from "../mj/role.js";
import { figer, htmlAvisLectureSeule, htmlCasePartage, htmlPastillePartage, nomDeLAuteur, partageeParUnAutre } from "../mj/partage.js";
import { htmlRetour, monterMentions, oublierMentions, placeMentions } from "../liens/dans-les-scenarios.js";
import {
  AGES, accorder, ATTITUDES, CHAMPS_PROFIL, GENRES, ORIGINES, PEUPLES, RANGS,
  tirerAge, tirerApparence, tirerEnvie, tirerFigurant, tirerMetier, tirerNom, tirerOffre, tirerPnj, tirerSecret, tirerVoix,
} from "./tables.js";
import { FIGURANT, ORIGINE_PAR_DEFAUT } from "../campagne/noms.js";

const DE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l8.4 4.8v9.2L12 21.4l-8.4-4.8V7.4z"/><path d="M8.6 10.3h6.8L12 16.2z"/><path d="M12 2.6v7.7M3.6 7.4l5 2.9M20.4 7.4l-5 2.9M12 16.2v5.2M8.6 10.3l-5 6.3M15.4 10.3l5 6.3"/></svg>';

const STATUTS = [["vivant", "Vivant"], ["disparu", "Disparu"], ["mort", "Mort"], ["inconnu", "Sort inconnu"]];
const STATUTS_COURTS = { disparu: "disparu", mort: "mort", inconnu: "sort inconnu" };
const SOURCES = [["officiel", "Officiel"], ["série", "Série"], ["maison", "Maison"]];

const TIRAGES = {
  apparence: tirerApparence,
  voix: tirerVoix,
  envie: tirerEnvie,
  secret: tirerSecret,
  offre: tirerOffre,
  role: tirerMetier,
  age: tirerAge,
};

// Ce que le carton du PNJ montre à la TV et sur la table publique (pnj_public, api/tv_fiches.py) : ces champs le disent.
const VU = `<small class="vu-table" title="Écrit sur son carton, que montrent la TV et la table publique">vu à la table</small>`;

const CHAMPS_JEU = [
  ["apparence", "À quoi {il|elle} ressemble", 3],
  ["voix", "Sa voix, ses tics, comment {le|la} jouer", 2],
  ["envie", "Ce qu'{il|elle} veut", 2],
  ["secret", "Ce qu'{il|elle} cache", 3],
  ["offre", "Ce qu'{il|elle} peut offrir aux héros", 2],
];

// Une zone de texte prend la hauteur de son contenu : la fiche se lit d'un coup d'œil, sans ascenseurs.
function ajuster(zone) {
  zone.style.height = "auto";
  zone.style.height = `${zone.scrollHeight + 2}px`;
}

function initiales(nom) {
  return (nom || "?")
    .replace(/^(Frère|Sœur|Maître|Père|Mère)\s+/, "")
    .split(/\s+/)
    .filter((m) => /^[A-ZÀ-Ý]/.test(m))
    .slice(0, 2)
    .map((m) => m[0])
    .join("");
}

export class Carnet {
  constructor(racine, { id, parametres }) {
    this.racine = racine;
    this.idDemande = id;
    this.parametres = parametres;
    this.pnj = [];
    this.lieux = [];
    this.fiche = null;
    this.vierges = new Vierges();
    this.modifies = new Set();
    this.sauver = differer(() => this.enregistrer(), 700);
    this.chaine = Promise.resolve();
    this.envois = 0;
    // Serveur injoignable : les fiches qui ne sont pas parties repartent seules (3 s, 10 s, puis toutes les 30 s).
    this.reessai = new Reessai(() => this.enregistrer(), () => {
      if (this.etatAffiche === "erreur") this.etat("erreur");
    });
    this.bases = {};
    this.galerie = new Galerie({
      cible: "pnj",
      fiche: () => this.fiche,
      trouver: (x) => this.pnj.find((p) => p.id === x),
      rafraichir: () => this.afficherFiche(),
      zone: () => this.racine.querySelector(".carnet-fiche"),
    });
    // Le carton du PNJ ouvert, à la TV : le bouton reste en haut à droite de la fiche quand elle défile.
    this.boutonTv = new BoutonTv({
      estIci: (t) => Boolean(this.fiche) && t.pnj === this.fiche.id,
      montrer: () => this.table(true),
      retirer: () => this.table(false),
      titre: "Son carton sur la TV, par-dessus ce qu'elle montre",
      titreIci: "Son carton est à la TV : le retirer, la vue d'en dessous revient",
    });
    // Le PNJ dont le carton est à la TV, marqué dans la liste.
    this.pnjTv = null;
    this.finTv = ecouterTv((t) => {
      if ((t.pnj || null) === this.pnjTv) return;
      this.pnjTv = t.pnj || null;
      if (this.racine.querySelector(".liste-pnj")) this.afficherListe();
    });
  }

  async demarrer() {
    const [pnj, lieux] = await Promise.all([api.get("/api/pnj"), api.get("/api/lieux")]);
    if (this.detruit) return;
    [this.pnj, this.lieux] = [pnj, lieux];
    for (const x of this.pnj) this.bases[x.id] = copie(x);
    this.lieux.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    if (this.idDemande === "nouveau") {
      const lieu = this.parametres.get("lieu");
      const p = await this.creer({ ...tirerPnj(), lieu: lieu || "" });
      if (this.detruit) return;
      history.replaceState(null, "", `#/pnj/${p.id}`);
      this.idDemande = p.id;
    }
    this.racine.innerHTML = this.gabarit();
    this.lier();
    this.afficherListe();
    const choisi = this.pnj.find((p) => p.id === this.idDemande) || (await this.retrouver(this.idDemande));
    if (this.detruit) return;
    this.ouvrir(choisi);
    // Ouvert par un lien (un scénario, une séance) : il se voit aussi dans la liste.
    if (choisi) this.montrerDansLaListe();
    this.galerie.suivre();
  }

  async detruire() {
    this.detruit = true;
    this.galerie.arreter();
    this.boutonTv.detruire();
    this.finTv();
    await this.vider();
    await this.purgerVierges();
  }

  vider() {
    if (this.modifies.size) this.sauver.maintenant();
    return this.chaine;
  }

  // Reste-t-il quelque chose qui n'est pas enregistré ? (l'onglet ne se ferme pas sans prévenir)
  aEnregistrer() {
    return this.modifies.size > 0 || this.sauver.enAttente() || this.envois > 0;
  }

  gabarit() {
    return `
    <section class="carnet">
      <aside class="carnet-liste">
        <header>
          <p class="kicker">Carnet</p>
          <h1>Les PNJ</h1>
          <div class="tirages">
            <button class="principal" data-action="tirer" title="Un PNJ complet, tiré au sort">Tirer un PNJ</button>
            <button data-action="figurant" title="${e(FIGURANT.titre)}">${e(FIGURANT.bouton)}</button>
            <button data-action="vierge" title="Une fiche vide">Vierge</button>
          </div>
          <input type="search" class="recherche" placeholder="Nom, métier, lieu, secret…" aria-label="Chercher un PNJ">
          <select class="filtre-lieu" aria-label="Lieu">
            <option value="">Tous les lieux</option>
            ${this.lieux.map((l) => `<option value="${e(l.id)}">${e(l.nom)}</option>`).join("")}
          </select>
        </header>
        <ul class="liste-pnj"></ul>
        <p class="legende"><span class="inconnu" aria-hidden="true"></span>inconnu des joueurs, jamais montré à la TV</p>
      </aside>
      <article class="carnet-fiche"></article>
    </section>`;
  }

  lier() {
    const r = this.racine;
    r.querySelector(".carnet-liste header").addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-action]");
      if (!b) return;
      if (b.dataset.action === "tirer") this.nouveau(tirerPnj());
      if (b.dataset.action === "figurant") this.nouveau(tirerFigurant());
      if (b.dataset.action === "vierge") this.nouveau({ nom: nomDistinct("Nouveau PNJ", this.pnj.map((x) => x.nom)), rang: "civil" }, true);
    });
    r.querySelector(".recherche").addEventListener("input", () => this.afficherListe());
    r.querySelector(".filtre-lieu").addEventListener("change", () => this.afficherListe());
    r.querySelector(".liste-pnj").addEventListener("click", async (ev) => {
      const b = ev.target.closest("[data-pnj]");
      if (b) {
        history.replaceState(null, "", `#/pnj/${b.dataset.pnj}`);
        this.ouvrir(this.pnj.find((p) => p.id === b.dataset.pnj));
        this.montrerFiche();
      }
      const kit = ev.target.closest('[data-action="kit"]');
      if (kit && !kit.disabled) {
        // Un double clic ne doit pas importer deux fois les habitués.
        kit.disabled = true;
        try {
          // Les PNJ du kit portent ses secrets : chargés à ce clic seulement, chez le MJ principal.
          const { importerPnjDuKit } = await import("./kit.js");
          const n = await importerPnjDuKit();
          this.pnj = await api.get("/api/pnj");
          for (const x of this.pnj) this.bases[x.id] ||= copie(x);
          this.afficherListe();
          toast(`${n} PNJ du kit ajoutés.`);
        } catch (err) {
          toast(`Import impossible : ${err.message}`, "erreur");
        } finally {
          kit.disabled = false;
        }
      }
    });
    const fiche = r.querySelector(".carnet-fiche");
    fiche.addEventListener("input", (ev) => this.saisie(ev));
    fiche.addEventListener("change", (ev) => this.saisie(ev, true));
    fiche.addEventListener("click", (ev) => this.clic(ev));
  }

  nomLieu(id) {
    return this.lieux.find((l) => l.id === id)?.nom || "";
  }

  afficherListe() {
    const q = this.racine.querySelector(".recherche").value.trim();
    const lieu = this.racine.querySelector(".filtre-lieu").value;
    const dansLieu = this.pnj.filter((p) => !lieu || p.lieu === lieu);
    // Sans accents ni majuscules, dans tous les champs de jeu : le nom d'abord, et le champ qui répond rappelé sous le
    // nom (« chuchote » trouve Gaspard par sa voix ; chercher/listes.js).
    const liste = q ? chercherPnj(dansLieu, q, (id) => this.nomLieu(id))
      : dansLieu.map((p) => ({ p, trouve: null })).sort((a, b) => a.p.nom.localeCompare(b.p.nom, "fr"));
    const marquer = (t) => (q ? surligner(t, q) : e(t));
    const ul = this.racine.querySelector(".liste-pnj");
    if (!this.pnj.length) {
      // Un MJ invité n'a pas les PNJ du kit : ses secrets restent à l'atelier du MJ principal.
      ul.innerHTML = estInvite() ? `<li class="vide">Le carnet est vide : « Tirer un PNJ » ou « Vierge » en ajoute un.</li>` : `<li class="vide">Le carnet est vide.<button class="principal" data-action="kit">Ajouter les PNJ du kit</button><span class="aide">Les figures de la campagne de départ, avec leurs secrets.</span></li>`;
      return;
    }
    ul.innerHTML = liste.map(({ p, trouve }) => `
      <li><button data-pnj="${e(p.id)}" aria-current="${this.fiche?.id === p.id}">
        <span class="medaillon-mini${p.statut === "mort" ? " mort" : ""}">${p.illustration ? `<img ${attributsMiniature(p.illustration, 160, 40)} alt="">` : `<span>${e(initiales(p.nom))}</span>`}${p.statut === "mort" ? '<svg class="croix-mort" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5v19M5.5 8h13"/></svg>' : ""}</span>
        <span class="texte">
          <span class="nom">${marquer(p.nom)}${p.surnom ? ` <i>«&nbsp;${marquer(p.surnom)}&nbsp;»</i>` : ""}</span>
          <span class="meta">${marquer([p.role, this.nomLieu(p.lieu)].filter(Boolean).join(" · "))}</span>
          ${trouve && trouve.libelle !== "Surnom" ? htmlTrouve(trouve) : ""}
          ${htmlPastillePartage(p)}
        </span>
        ${STATUTS_COURTS[p.statut] ? `<span class="statut">${e(STATUTS_COURTS[p.statut])}</span>` : ""}
        ${p.id === this.pnjTv ? '<span class="a-la-tv" title="Son carton est à la TV">à la TV</span>' : ""}
        ${p.connu ? "" : '<span class="inconnu" title="Inconnu des joueurs" aria-label="Inconnu des joueurs"></span>'}
      </button></li>`).join("") || `<li class="vide">Aucun PNJ ne correspond.</li>`;
  }

  // Le PNJ qui vient d'être tiré se voit dans la liste, à côté de ses voisins : elle défile jusqu'à lui (elle seule).
  montrerDansLaListe() {
    const ul = this.racine.querySelector(".liste-pnj");
    const b = ul?.querySelector('[aria-current="true"]');
    if (!b) return;
    const cadre = ul.getBoundingClientRect();
    const ligne = b.getBoundingClientRect();
    if (ligne.top < cadre.top) ul.scrollTop -= cadre.top - ligne.top + 12;
    else if (ligne.bottom > cadre.bottom) ul.scrollTop += ligne.bottom - cadre.bottom + Math.min(cadre.height / 3, 120);
  }

  // Sur une seule colonne (téléphone, petite tablette), la fiche s'ouvre sous la liste : on y descend.
  montrerFiche() {
    if (!matchMedia("(max-width: 900px)").matches) return;
    this.racine.querySelector(".carnet-fiche")?.scrollIntoView({ block: "start" });
  }

  // Une fiche « Vierge » laissée intacte repart à la corbeille quand on passe à une autre.
  purgerVierges(sauf = null) {
    return this.vierges.purger({
      sauf,
      trouve: (id) => this.pnj.find((x) => x.id === id),
      modifiee: (id) => this.modifies.has(id),
      retirer: (id) => {
        this.pnj = this.pnj.filter((x) => x.id !== id);
        if (this.fiche?.id === id) this.fiche = null;
      },
    });
  }

  ouvrir(p) {
    if (this.modifies.size) this.sauver.maintenant();
    this.purgerVierges(p?.id).then((n) => n && !this.detruit && this.afficherListe()).catch(() => {});
    this.fiche = p || null;
    this.afficherFiche();
    this.afficherListe();
  }

  afficherFiche() {
    const zone = this.racine.querySelector(".carnet-fiche");
    const p = this.fiche;
    if (!p) {
      zone.innerHTML = `<div class="fiche-vide"><p>Choisissez un PNJ dans la liste, ou tirez-en un au sort.</p><p class="aide">En pleine partie, «&nbsp;${e(FIGURANT.bouton)}&nbsp;» donne en une seconde un nom, un métier, une voix et une envie. ${e(FIGURANT.aide)}</p></div>`;
      return;
    }
    // Partagée par l'autre MJ : lue en entier, montrée à la table, jamais modifiée d'ici.
    const lecture = partageeParUnAutre(p);
    const rang = RANGS.find((r) => r.cle === p.rang) || RANGS[0];
    const profil = { ...rang.profil, ...(p.profil || {}) };
    const option = (liste, valeur) => liste.map(([v, n]) => `<option value="${e(v)}" ${v === valeur ? "selected" : ""}>${e(n)}</option>`).join("");
    zone.innerHTML = `
      <div class="fiche-tete">
        <figure class="medaillon${p.statut === "mort" ? " mort" : ""}">${p.illustration ? `<img ${attributsMiniature(p.illustration, 320)} alt="Portrait de ${e(p.nom)}">` : `<span>${e(initiales(p.nom))}</span>`}${p.statut === "mort" ? '<svg class="croix-mort" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5v19M5.5 8h13"/></svg>' : ""}</figure>
        <div class="identite">
          <div class="avec-de ligne-nom">
            <input class="nom" type="text" value="${e(p.nom)}" data-champ="nom" aria-label="Nom">
            <select class="origine-nom" data-champ="origine" title="Région des noms tirés au sort" aria-label="Région des noms tirés au sort">${option(ORIGINES.map((o) => [o.cle, `Noms de ${o.nom === "Nain" ? "nains" : o.nom === "Elfe" ? "elfes" : o.nom}`]), p.origine || ORIGINE_PAR_DEFAUT)}</select>
            <button class="de" data-tirer="nom" title="Tirer un nom">${DE}</button>
            ${htmlTemoin()}
          </div>
          <div class="grille-identite">
            <label class="champ large"><span>Métier, fonction ${VU}</span><span class="avec-de"><input type="text" value="${e(p.role || "")}" data-champ="role"><button class="de" data-tirer="role" title="Tirer un métier">${DE}</button></span></label>
            <label class="champ"><span>Surnom ${VU}</span><input type="text" value="${e(p.surnom || "")}" data-champ="surnom" placeholder="aucun"></label>
            <label class="champ">Statut<select data-champ="statut">${option(STATUTS, p.statut || "vivant")}</select></label>
            <label class="champ"><span>Peuple ${VU}</span><input type="text" list="peuples" value="${e(p.peuple || "")}" data-champ="peuple"></label>
            <label class="champ">Genre<select data-champ="genre"><option value="">Non précisé</option>${option(GENRES, p.genre || "")}</select></label>
            <label class="champ">Âge<span class="avec-de"><input type="text" list="ages" value="${e(p.age || "")}" data-champ="age"><button class="de" data-tirer="age" title="Tirer un âge">${DE}</button></span></label>
            <label class="champ">Envers les héros<select data-champ="attitude">${option(ATTITUDES.map((a) => [a.cle, a.nom]), p.attitude || "neutre")}</select></label>
          </div>
          <datalist id="peuples">${PEUPLES.map((x) => `<option value="${e(x)}">`).join("")}</datalist>
          <datalist id="ages">${AGES.map((x) => `<option value="${e(x)}">`).join("")}</datalist>
        </div>
        <div class="table-pnj">
          <div class="place-tv"></div>
          <label class="case"><input type="checkbox" data-champ="connu" ${p.connu ? "checked" : ""}> Connu des joueurs</label>
          ${htmlCasePartage(p, 'data-champ="partage"')}
        </div>
      </div>
      ${lecture ? htmlAvisLectureSeule(p, "Cette fiche") : ""}
      <div class="fiche-corps">
        <section class="bloc-jeu">
          <h2>À la table</h2>
          ${CHAMPS_JEU.map(([cle, titre, lignes]) => `
            <label class="champ${cle === "secret" ? " secret" : ""}">${cle === "apparence" ? `<span>${accorder(titre, p.genre)} ${VU}</span>` : accorder(titre, p.genre)}
              <span class="avec-de"><textarea rows="${lignes}" data-champ="${cle}">${e(p[cle] || "")}</textarea><button class="de" data-tirer="${cle}" title="Tirer au sort">${DE}</button></span>
            </label>`).join("")}
          ${lecture ? "" : `<div class="ia">
            <label class="champ">Une idée de départ (facultatif)<input type="text" class="idee" placeholder="un nain qui a perdu sa caravane et accuse son associé"></label>
            <div class="actions">
              <button data-action="ia" data-estimation="pnj" title="Remplit les champs vides, d'après la campagne et le canon">Compléter la fiche</button>
              <button data-action="ia-variantes" data-estimation="pnj-variantes" title="Trois personnages différents à partir de ce qui est déjà écrit : vous prenez celui qui vous parle">Trois versions</button>
            </div>
          </div>
          ${this.htmlVariantes(p)}`}
        </section>
        <section class="bloc-cadre">
          <h2>Où et avec qui</h2>
          <label class="champ">Lieu où on ${p.genre === "f" ? "la" : "le"} trouve<select data-champ="lieu">
            <option value="">Aucun lieu précis</option>
            ${this.lieux.map((l) => `<option value="${e(l.id)}" ${l.id === p.lieu ? "selected" : ""}>${e(l.nom)}</option>`).join("")}
          </select></label>
          ${p.lieu && this.lieux.find((l) => l.id === p.lieu)?.carte ? `<p class="aide"><a href="#/carte/${e(this.lieux.find((l) => l.id === p.lieu).carte)}?lieu=${e(p.lieu)}">Voir le lieu sur la carte</a></p>` : ""}
          <label class="champ">Faction, Église, guilde<input type="text" value="${e(p.faction || "")}" data-champ="faction"></label>
          <label class="champ">Source<select data-champ="etiquette">${option(SOURCES, p.etiquette || "maison")}</select></label>
          ${placeMentions("pnj", p.id)}
          <label class="champ">Notes<textarea rows="3" data-champ="notes">${e(p.notes || "")}</textarea></label>
          <h2>Combat</h2>
          <label class="champ">Rang<select data-champ="rang">${option(RANGS.map((r) => [r.cle, r.nom]), rang.cle)}</select></label>
          <div class="profil">
            ${Object.keys(rang.profil).map((k) => `<label class="champ">${CHAMPS_PROFIL[k]}<input type="text" value="${e(profil[k] ?? "")}" data-profil="${k}"></label>`).join("")}
          </div>
          <label class="champ">Capacités, équipement<textarea rows="3" data-champ="capacites">${e(p.capacites || "")}</textarea></label>
          <p class="aide">Valeurs par défaut du rang, d'après le bestiaire du kit (le civil est une valeur maison). Un boss attaque deux fois par tour.</p>
        </section>
        ${lecture ? "" : `<section class="bloc-portraits">${this.galerie.html(p)}</section>`}
      </div>
      ${lecture ? "" : `<div class="actions pied-fiche"><button class="danger" data-action="supprimer">Mettre à la corbeille</button>
        <a class="lien-versions" href="${lienVersions("pnj", p.id, `#/pnj/${p.id}`)}">Versions précédentes</a></div>`}`;
    zone.prepend(this.boutonTv.cadre);
    // Ouverte depuis un scénario : le chemin du retour ; et les chapitres qui le citent (liens/dans-les-scenarios.js).
    this.boutonTv.cadre.insertAdjacentHTML("afterend", htmlRetour("pnj", p.id));
    monterMentions(zone, "pnj", p.id, { ancien: p.scenario, avecVerser: !lecture });
    if (lecture) figer(zone);
    this.boutonTv.maj();
    zone.querySelectorAll("textarea").forEach(ajuster);
    this.etat(!this.modifies.has(p.id) ? "ok" : this.reessai.actif ? "erreur" : "modifie");
  }

  // Après la destruction, la page en montre une autre : l'état n'y est plus écrit.
  etat(e) {
    this.etatAffiche = e;
    afficherTemoin(this.detruit ? null : this.racine.querySelector(".carnet-fiche .temoin-enregistrement"), e, { reessai: this.reessai, modifie: this.fiche?.modifie });
  }

  saisie(ev, change) {
    const el = ev.target;
    const p = this.fiche;
    if (!p || partageeParUnAutre(p)) return;
    if (el.dataset.action === "ill-importer") {
      if (change) this.galerie.importer(el.files[0]);
      return;
    }
    if (el.dataset.local) {
      this.galerie.saisie(el);
      return;
    }
    if (el.classList.contains("idee")) return;
    if (el.tagName === "TEXTAREA" && !change) ajuster(el);
    if ((el.type === "checkbox" || el.tagName === "SELECT") && !change) return;
    if (el.dataset.profil) {
      if (change) return;
      p.profil = { ...(p.profil || {}), [el.dataset.profil]: el.value };
    } else if (el.dataset.champ) {
      if (change && el.dataset.champ === "nom") this.suivreNom(p);
      if (change && el.type !== "checkbox" && el.tagName !== "SELECT") return;
      p[el.dataset.champ] = el.type === "checkbox" ? el.checked : el.value;
      if (el.dataset.champ === "rang") {
        p.profil = {};
        this.afficherFiche();
      }
      if (el.dataset.champ === "lieu" || el.dataset.champ === "genre") this.afficherFiche();
    } else return;
    this.modifies.add(p.id);
    this.etat("modifie");
    this.sauver();
    if (["nom", "surnom", "role", "lieu", "connu", "statut", "partage"].includes(el.dataset.champ)) this.afficherListe();
    // La description du portrait suit le genre, le peuple, l'âge, le métier et l'apparence, tant qu'on ne l'a pas retouchée.
    if (["genre", "peuple", "age", "role", "apparence"].includes(el.dataset.champ)) this.galerie.suivreFiche();
  }

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
      const p = this.pnj.find((x) => x.id === id);
      if (!p) continue;
      try {
        const fusion = await enregistrerAvecVersion(`/api/pnj/${id}`, p, this.bases, id);
        // Renommée depuis un autre écran : le serveur a suivi le renommage, la fiche prend son nouvel identifiant.
        if (this.bases[id]?.id && this.bases[id].id !== id) this.adopterIdentifiant(p, id, this.bases[id].id, this.bases[id]);
        if (this.fiche?.id === p.id && !this.modifies.has(p.id)) this.etat("ok");
        if (fusion && !this.detruit) {
          toast(`« ${p.nom} » avait été modifié sur un autre écran : ses changements et les vôtres sont réunis.`);
          if (this.fiche?.id === p.id && !this.racine.querySelector(".carnet-fiche")?.contains(document.activeElement)) this.afficherFiche();
        }
      } catch (err) {
        erreurs.push(err);
        this.modifies.add(p.id);
        this.reessai.signaler(err, `« ${p.nom} » non enregistré`);
      }
    }
    if (!ids.length) return;
    this.reessai.bilan(erreurs);
    if (erreurs.length) this.etat("erreur");
  }

  async creer(donnees) {
    const p = await api.post("/api/pnj", { statut: "vivant", attitude: "neutre", etiquette: "maison", connu: false, rang: "civil", ...donnees });
    this.bases[p.id] = copie(p);
    this.pnj.push(p);
    return p;
  }

  async nouveau(donnees, vierge = false) {
    try {
      const p = await this.creer(donnees);
      if (vierge) this.vierges.marquer(p.id, "/api/pnj", p);
      history.replaceState(null, "", `#/pnj/${p.id}`);
      this.ouvrir(p);
      this.montrerDansLaListe();
      this.montrerFiche();
      const nom = this.racine.querySelector(".carnet-fiche .nom");
      if (nom && vierge) {
        nom.focus();
        nom.select();
      }
    } catch (err) {
      toast(`Création impossible : ${err.message}`, "erreur");
    }
  }

  async clic(ev) {
    const b = ev.target.closest("button");
    if (!b) return;
    const p = this.fiche;
    if (!p) return;
    const a = b.dataset.action;
    // Une fiche partagée par l'autre MJ : seuls les boutons de la table répondent (ils ont leur propre écouteur).
    if (partageeParUnAutre(p)) return;
    if (b.dataset.tirer) {
      const champ = b.dataset.tirer;
      p[champ] = champ === "nom" ? tirerNom(p.origine || ORIGINE_PAR_DEFAUT, p.genre) : TIRAGES[champ](p.genre);
      this.modifies.add(p.id);
      this.sauver();
      this.afficherFiche();
      this.afficherListe();
      return;
    }
    if (a?.startsWith("ill-")) return this.galerie.action(a, b.dataset.valeur, b);
    if (a === "table" || a === "table-retirer") return this.table(a === "table");
    if (a === "verser-scenario") return this.verserScenario(p);
    if (a === "ia") return this.completer(b);
    if (a === "ia-variantes") return this.proposerVariantes(b);
    if (a === "prendre-variante") return this.prendreVariante(+b.dataset.variante);
    if (a === "oublier-variantes") {
      this.variantes = null;
      return this.afficherFiche();
    }
    if (a === "supprimer") {
      // Sans confirmation : ce qui attend part d'abord (la fiche revient entière), puis « Annuler » dix secondes.
      await this.vider();
      try {
        await api.del(`/api/pnj/${p.id}`);
      } catch (err) {
        return toast(`Suppression impossible : ${err.message}`, "erreur");
      }
      this.pnj = this.pnj.filter((x) => x.id !== p.id);
      this.modifies.delete(p.id);
      history.replaceState(null, "", "#/pnj");
      this.ouvrir(null);
      annoncerCorbeille(`« ${p.nom || "Ce PNJ"} » mis à la corbeille.`, "pnj", p.id, { retour: `#/pnj/${p.id}` });
    }
  }

  // L'ancien champ « Scénario » (texte libre, remplacé par « Dans les scénarios ») : son texte passe dans les Notes.
  verserScenario(p) {
    const ancien = String(p.scenario || "").trim();
    if (!ancien) return;
    p.notes = [String(p.notes || "").trim(), `Scénario, noté à la main : ${ancien}`].filter(Boolean).join("\n");
    p.scenario = "";
    this.modifies.add(p.id);
    this.etat("modifie");
    this.sauver();
    this.afficherFiche();
    toast("Le texte de l'ancien champ « Scénario » est dans les Notes.");
  }

  // L'identifiant suit le nom tant que rien ne cite la fiche (liens_fiches.py) : « nouveau-pnj » devient
  // « gaspard-tourbe » au premier vrai nom. Après l'enregistrement en cours, dans la même file.
  suivreNom(p) {
    this.chaine = this.chaine.then(async () => {
      // Le nom part d'abord : le serveur en tire l'identifiant. Ce qui sera tapé ensuite partira sous le nouveau.
      if (this.modifies.has(p.id)) await this.ecrire();
      if (this.detruit || !this.pnj.includes(p)) return;
      let r;
      try {
        r = await api.post(`/api/pnj/${encodeURIComponent(p.id)}/identifiant`, {});
      } catch {
        return;
      }
      if (!r?.change || this.detruit) return;
      // Seuls l'identifiant et la version changent : ce qui a été tapé entre-temps reste.
      p.modifie = r.fiche.modifie;
      this.adopterIdentifiant(p, p.id, r.id, r.fiche);
    });
  }

  // La fiche porte désormais un autre identifiant : renommée ici (suivreNom), ou sur un autre écran pendant qu'elle était
  // ouverte ici (le serveur suit le renommage, liens_fiches.py). Liste, adresse, versions et ce qui attend suivent.
  adopterIdentifiant(p, ancien, neuf, fiche) {
    if (!neuf || ancien === neuf) return;
    p.id = neuf;
    this.bases[neuf] = copie(fiche);
    delete this.bases[ancien];
    if (this.modifies.delete(ancien)) this.modifies.add(neuf);
    oublierMentions("pnj", ancien);
    if (this.detruit) return;
    if (location.hash.startsWith(`#/pnj/${ancien}`)) history.replaceState(null, "", `#/pnj/${neuf}`);
    this.afficherListe();
    if (this.fiche === p && !this.racine.querySelector(".carnet-fiche")?.contains(document.activeElement)) this.afficherFiche();
    else if (this.fiche === p) {
      const versions = this.racine.querySelector(".carnet-fiche .lien-versions");
      if (versions) versions.href = lienVersions("pnj", p.id, `#/pnj/${p.id}`);
    }
  }

  // Un identifiant que la liste ne connaît pas : peut-être l'ancien d'une fiche renommée depuis (un lien écrit avant, une
  // page rechargée sur l'ancienne adresse). Le serveur suit le renommage ; l'adresse prend le nouvel identifiant.
  async retrouver(id) {
    if (!id || id === "nouveau") return null;
    try {
      const f = await api.get(`/api/pnj/${encodeURIComponent(id)}`);
      const p = f?.id && f.id !== id ? this.pnj.find((x) => x.id === f.id) : null;
      if (p && !this.detruit && location.hash.startsWith(`#/pnj/${id}`)) history.replaceState(null, "", location.hash.replace(`#/pnj/${id}`, `#/pnj/${p.id}`));
      return p || null;
    } catch {
      return null;
    }
  }

  async table(montrer) {
    const p = this.fiche;
    try {
      // La fiche enregistrée est celle que lira la TV : ce que son carton nomme d'inconnu se vérifie sur elle. Un PNJ
      // secret ne devient connu qu'après le « oui » de cette même question.
      if (this.modifies.size) await this.sauver.maintenant();
      // Montrer un PNJ secret le rend connu : sur une fiche partagée par l'autre MJ, ce geste revient à son auteur.
      if (montrer && !p.connu && partageeParUnAutre(p)) return toast(`«\u00a0${p.nom}\u00a0» est encore inconnu des joueurs : seul ${nomDeLAuteur(p)}, qui partage sa fiche, peut le rendre connu. Son carton ne part pas.`, "erreur");
      if (montrer && !(await cartonVerifie(p.id, p.nom, { secret: !p.connu }))) return;
      if (montrer && !p.connu) {
        p.connu = true;
        this.modifies.add(p.id);
        await this.sauver.maintenant();
        this.afficherFiche();
        this.afficherListe();
      }
      const etat = await api.get("/api/table");
      delete etat.ecrans;
      const r = await api.put("/api/table", { ...etat, pnj: montrer ? p.id : null });
      annoncerTv(r, `le carton ${de(p.nom)}`, { montre: montrer });
    } catch (err) {
      toast(err.status && err.status < 500 ? err.message : `La table ne répond pas : ${err.message}`, "erreur");
    }
  }

  async completer(bouton) {
    const p = this.fiche;
    const idee = this.racine.querySelector(".idee")?.value.trim() || "";
    const vides = CHAMPS_JEU.map((c) => c[0]).filter((k) => !(p[k] || "").trim());
    if (!vides.length && !(await demander({ titre: "Tout réécrire ?", texte: "Tous les champs sont remplis : la proposition les remplacerait tous.", oui: "Tout réécrire", non: "Garder la fiche", danger: true }))) return;
    if (this.fiche !== p) return;
    bouton.disabled = true;
    bouton.textContent = "Rédaction en cours…";
    try {
      const r = await api.post("/api/pnj-proposition", { fiche: { ...p, lieu_nom: this.nomLieu(p.lieu) }, idee });
      const cibles = vides.length ? vides : Object.keys(r);
      for (const k of cibles) if (r[k]) p[k] = r[k];
      this.modifies.add(p.id);
      this.sauver();
      this.afficherFiche();
      toast("Champs proposés : relisez-les, gardez ce qui vous plaît.");
    } catch (err) {
      toast(`Rien de proposé : ${erreurIA(err, "les champs vides se remplissent aussi à la main, rien n'a été effacé")}.`, "erreur");
      this.afficherFiche();
    }
  }

  // Trois versions du même PNJ, côte à côte : le MJ en prend une (ses cinq champs remplacent ceux de la fiche).
  htmlVariantes(p) {
    if (!this.variantes || this.variantes.id !== p.id) return "";
    return `
      <div class="variantes-pnj">
        ${this.variantes.liste.map((v, i) => `
          <article class="variante">
            <p class="kicker">Version ${i + 1}</p>
            ${CHAMPS_JEU.map(([cle, titre]) => (v[cle] ? `<p><span class="lbl">${e(accorder(titre, p.genre))}</span> ${e(v[cle])}</p>` : "")).join("")}
            <button data-action="prendre-variante" data-variante="${i}">Prendre celle-ci</button>
          </article>`).join("")}
        <button class="lien" data-action="oublier-variantes">Fermer sans rien prendre</button>
      </div>`;
  }

  async proposerVariantes(bouton) {
    const p = this.fiche;
    const idee = this.racine.querySelector(".idee")?.value.trim() || "";
    bouton.disabled = true;
    bouton.textContent = "Trois versions en cours…";
    try {
      const r = await api.post("/api/pnj-variantes", { fiche: { ...p, lieu_nom: this.nomLieu(p.lieu) }, idee });
      this.variantes = { id: p.id, liste: r.variantes || [] };
    } catch (err) {
      toast(`Rien de proposé : ${erreurIA(err)}.`, "erreur");
    }
    this.afficherFiche();
  }

  prendreVariante(i) {
    const p = this.fiche;
    const v = this.variantes?.id === p.id ? this.variantes.liste[i] : null;
    if (!v) return;
    for (const [cle] of CHAMPS_JEU) if (v[cle]) p[cle] = v[cle];
    this.variantes = null;
    this.modifies.add(p.id);
    this.sauver();
    this.afficherFiche();
    toast("Version prise : relisez-la, retouchez ce que vous voulez.");
  }
}
