// Les activités entre les séances, côté MJ : le catalogue où il écrit ce que les héros peuvent faire d'une séance à
// l'autre, rangé sous l'onglet Auberge (c'est là que se trouvent déjà la planche à contrats et les rumeurs du comptoir, et
// l'auberge est le lieu d'où les héros partent entre deux aventures). L'interrupteur « Ouvertes aux joueurs » et la période
// (une semaine, ou l'intervalle entre deux séances) sont dans la page Réglages (section Coin des joueurs) : ici, ce qu'ils
// valent en ce moment et le lien. Puis chaque activité : sa caractéristique, les compétences qui aident,
// le modificateur, les places, le texte que lisent les joueurs, et pour chaque issue l'or (une formule de dés), sa
// destination et le récit type. Les petits contrats s'écrivent ici à la main. Tout s'enregistre pendant la frappe, avec la
// version lue : un autre écran passé avant est fusionné activité par activité.
// Le tableau (19/11) : le catalogue est une réserve. Chaque activité a un rythme (chaque semaine, souvent, parfois,
// rarement) ; au début de chaque période, l'atelier tire au tableau quelques activités qui ne sont pas de chaque semaine, et
// la première quête unique jamais proposée. Le panneau « Au tableau » montre la période en cours : changer une offre tirée,
// en retirer une, en ajouter une de la réserve, tant qu'aucun héros ne l'a jouée.

import { api, copie, differer, echapper as e, enregistrerAvecVersion, toast } from "../api.js";
import { COMPETENCES } from "../aventuriers/regles.js";
import { demander } from "../commun/dialogue.js";
import { afficherTemoin, htmlTemoin } from "../commun/temoin-enregistrement.js";
import { formuleLisible } from "./formule.js";

const ISSUES = [["reussite-critique", "Réussite critique"], ["reussite", "Réussite"], ["echec", "Échec"], ["echec-critique", "Échec critique"]];
const RYTHMES = [["toujours", "Chaque semaine"], ["souvent", "Souvent"], ["parfois", "Parfois"], ["rarement", "Rarement"]];
const GAINS = [["or", "De l'or"], ["rumeur", "Une rumeur"], ["contact", "Un contact"], ["objet", "Un objet"]];
const GENRES_TABLEAU = { quete: "quête unique", toujours: "chaque semaine", tiree: "tirée" };
const CARACS = [["physique", "Physique"], ["social", "Social"], ["mental", "Mental"]];
const DECISIONS = { acceptee: "validée", refusee: "refusée" };
// L'or versé d'office : « +8 po, bourse », « +4 po, les baraquements », « 0 po ».
const orDit = (x) => (x.montant ? `${x.montant > 0 ? "+" : "\u2212"}${Math.abs(x.montant)}\u00a0po, ${x.vers === "bourse" ? "bourse" : x.chantier || "sanctuaire"}` : "0\u00a0po");

const options = (liste, valeur) => liste.map(([v, n]) => `<option value="${e(v)}"${v === valeur ? " selected" : ""}>${e(n)}</option>`).join("");
const nouvelId = () => `activite-${[...crypto.getRandomValues(new Uint8Array(4))].map((x) => x.toString(16).padStart(2, "0")).join("")}`;

function ajuster(zone) {
  zone.style.height = "auto";
  zone.style.height = `${zone.scrollHeight + 2}px`;
}

function vierge() {
  return {
    id: nouvelId(), nom: "", texte: "", carac: "physique", competences: [], modificateur: 0, places: null, visible: false, chantier: "", notes_mj: "",
    rythme: "toujours", unique: false, accroche: "", gains: [],
    issues: Object.fromEntries(ISSUES.map(([k]) => [k, { or: "0", vers: "bourse", recit: "" }])),
  };
}

export class Activites {
  constructor(racine) {
    this.racine = racine;
    this.bases = {};
    this.ouvertes = new Set();
    this.sauver = differer(() => this.enregistrer(), 700);
    this.chaine = Promise.resolve();
    this.envois = 0;
    this.modifie = false;
  }

  async demarrer() {
    const [c, etat] = await Promise.all([api.get("/api/activites"), api.get("/api/activites/etat")]);
    if (this.detruit) return;
    this.c = c;
    this.etat = etat;
    this.bases.catalogue = copie(c);
    this.racine.innerHTML = this.gabarit();
    this.section = this.racine.querySelector(".activites-mj");
    this.section.addEventListener("input", (ev) => this.saisie(ev));
    this.section.addEventListener("change", (ev) => this.saisie(ev, true));
    this.section.addEventListener("click", (ev) => this.clic(ev));
    this.section.addEventListener("toggle", (ev) => {
      const d = ev.target.closest?.("details[data-id]");
      if (!d) return;
      if (d.open) {
        this.ouvertes.add(d.dataset.id);
        // Les champs d'une fiche ne se mesurent qu'à son ouverture : une réserve d'une centaine reste légère.
        d.querySelectorAll("textarea").forEach(ajuster);
      } else this.ouvertes.delete(d.dataset.id);
    }, true);
    this.section.addEventListener("input", (ev) => {
      if (ev.target.matches?.("[data-chercher]")) this.filtrer();
    });
    this.tout();
  }

  detruire() {
    this.detruit = true;
    return this.vider();
  }

  vider() {
    if (this.modifie) this.sauver.maintenant();
    return this.chaine;
  }

  aEnregistrer() {
    return this.modifie || this.sauver.enAttente() || this.envois > 0;
  }

  gabarit() {
    return `
      <section class="page-liste activites-mj">
        <header class="titre-page titre-avec-temoin">
          <div>
            <p class="kicker"><a href="#/auberge">L'auberge</a></p>
            <h1>Les activités entre les séances</h1>
            <p class="chapo">Ce que les héros peuvent faire d'une séance à l'autre : votre réserve. Au tableau de l'auberge, dans le carnet des joueurs, les activités de chaque semaine et quelques autres tirées au début de chaque période, selon leur rythme. Chaque joueur peut prendre chaque affiche une fois ; le serveur jette le dé sur la fiche du héros, lui montre aussitôt le récit de l'issue et l'or vous attend dans la boîte « Demandes ».</p>
          </div>
          ${htmlTemoin("ok")}
        </header>
        <div class="reglages-activites"></div>
        <datalist id="competences-activites">${COMPETENCES.flatMap(([, l]) => l).map(([n]) => `<option value="${e(n)}">`).join("")}</datalist>
        <div class="chercher-activites">
          <label class="champ">Chercher dans la réserve<input type="search" data-chercher placeholder="un nom, une compétence, un mot du texte" autocomplete="off"></label>
          <label class="champ">Rythme<select data-chercher><option value="">tous</option>${RYTHMES.map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}<option value="quete">quêtes uniques</option><option value="tableau">au tableau</option><option value="cachee">cachées</option></select></label>
          <p class="compte-activites" aria-live="polite"></p>
        </div>
        <div class="liste-activites-mj"></div>
        <p class="actions"><button type="button" data-action="nouvelle">Nouvelle activité</button></p>
        <p class="aide">Dans un récit type : <code>{prenom}</code> devient le prénom du héros ; <code>{il|elle}</code>, <code>fourbu{|e}</code> s'accordent. Un récit qui nomme un PNJ ou un lieu inconnu des joueurs ne leur part pas : ils lisent « Votre MJ vous racontera la suite ». L'or s'écrit <code>10</code>, <code>2D6</code>, <code>1D6 + 4</code>, <code>2D6 × 5</code>, ou <code>-1D6</code> pour une perte ; vous le changez à la validation.</p>
      </section>`;
  }

  tout() {
    this.afficherReglages();
    this.afficherListe();
  }

  afficherReglages() {
    const c = this.c;
    const et = this.etat || {};
    const jouees = et.jouees || [];
    const zone = this.section.querySelector(".reglages-activites");
    zone.innerHTML = `
      <p class="aide interrupteur-activites">${c.ouvert ? `<b>Ouvertes aux joueurs</b> : le tableau paraît dans leur carnet${et.carnet_ouvert === false ? " (le carnet est fermé en ce moment : rien ne paraît avant qu'il rouvre)" : ""}`
        : "<b>Fermées aux joueurs</b> : leur carnet n'en montre aucune"}. Chaque affiche du tableau une fois par héros ${c.periode === "seance" ? "entre deux séances" : "et par semaine"}. <a class="vers-reglages" href="#/reglages/coin">Réglages</a></p>
      <p class="aide">En ce moment : <b>${e(et.periode?.libelle || "")}</b>.${jouees.length ? "" : " Aucune activité jouée pour l'instant."}</p>
      ${this.htmlTableau()}
      ${jouees.length ? `<table class="jouees-activites"><caption>Jouées cette période</caption><thead><tr><th>Héros</th><th>Activité</th><th>Dé</th><th>Issue</th><th>Or</th></tr></thead><tbody>${jouees.map((x) => `
        <tr><td>${e(x.heros.split(/[\s,]+/)[0])}</td><td>${e(x.activite)}</td><td>${e(String(x.de ?? "").padStart(2, "0"))} pour ${e(x.visee ?? "")}</td><td>${e(x.issue)}</td>
        <td>${x.decision === "refusee" ? "refusée" : x.decision ? e(orDit(x)) : "à valider"}</td></tr>`).join("")}</tbody></table>` : ""}`;
  }

  // Le tableau de la période : ce que les joueurs voient, et les gestes du MJ sur chaque affiche.
  htmlTableau() {
    const t = this.etat?.tableau;
    if (!t) return "";
    const par = new Map(this.c.activites.map((a) => [a.id, a]));
    const prises = this.etat?.prises || {};
    const lignes = t.ids.map((id) => {
      const a = par.get(id);
      if (!a) return "";
      const jouee = (prises[id] || 0) > 0;
      const genre = t.genres[id];
      return `<li data-id="${e(id)}"><span class="nom">${e(a.nom)}</span><span class="genre-tableau genre-${e(genre)}">${e(GENRES_TABLEAU[genre] || "")}</span>
        ${jouee ? `<span class="jouee">prise ${prises[id]} fois</span>` : `${genre !== "toujours" ? '<button type="button" data-action="tableau-changer">Changer</button>' : ""}<button type="button" data-action="tableau-retirer">Retirer</button>`}</li>`;
    }).join("");
    const tourne = this.c.activites.some((a) => a.visible && a.nom && (a.unique || a.rythme !== "toujours"));
    return `
      <div class="tableau-activites-mj">
        <h2>Au tableau en ce moment</h2>
        <ul class="affiches-mj">${lignes || '<li class="vide">Le tableau est vide : montrez une activité, ou mettez-en une au tableau depuis sa fiche.</li>'}</ul>
        <p class="aide">${tourne ? `Le tableau change ${this.c.periode === "seance" ? "à chaque séance close" : `chaque lundi (le prochain : ${e(t.renouvellement)})`} : les activités de chaque semaine, ${this.c.offres} tirée${this.c.offres > 1 ? "s" : ""} dans la réserve et la quête unique suivante. Retoucher la réserve ne change pas ce tableau-ci ; une activité cachée en sort, une activité passée « chaque semaine » y entre.`
          : "Toutes vos activités sont « chaque semaine » : le tableau ne change pas, comme avant la réserve. Donnez un autre rythme à certaines pour qu'il tourne."}</p>
        <div class="reglages-tableau">
          <label class="champ">Tirées à chaque période<input type="number" min="0" max="8" value="${e(this.c.offres ?? 3)}" data-reglage="offres"></label>
          <label class="case"><input type="checkbox" data-reglage="annoncer_gains"${this.c.annoncer_gains ? " checked" : ""}> Annoncer sur les affiches ce qu'on peut y gagner</label>
        </div>
      </div>`;
  }

  afficherListe() {
    const zone = this.section.querySelector(".liste-activites-mj");
    zone.innerHTML = this.c.activites.length ? this.c.activites.map((a, i) => this.htmlActivite(a, i)).join("")
      : '<p class="vide">Aucune activité. « Nouvelle activité » en ajoute une.</p>';
    zone.querySelectorAll("details[open] textarea").forEach(ajuster);
    this.filtrer();
  }

  // La recherche dans la réserve : un mot (nom, compétences, texte), un rythme, les quêtes, le tableau, les cachées.
  filtrer() {
    const champs = this.section.querySelectorAll("[data-chercher]");
    if (!champs.length) return;
    const mot = champs[0].value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const genre = champs[1].value;
    const auTableau = new Set(this.etat?.tableau?.ids || []);
    let vus = 0;
    for (const d of this.section.querySelectorAll("details.activite-mj")) {
      const a = this.c.activites.find((x) => x.id === d.dataset.id);
      if (!a) continue;
      const texte = `${a.nom} ${a.competences.join(" ")} ${a.texte}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const ok = (!mot || texte.includes(mot)) && (!genre || (genre === "quete" ? a.unique : genre === "tableau" ? auTableau.has(a.id)
        : genre === "cachee" ? !a.visible : !a.unique && a.rythme === genre));
      d.hidden = !ok;
      if (ok) vus += 1;
    }
    const n = this.c.activites.length;
    this.section.querySelector(".compte-activites").textContent = mot || genre ? `${vus} sur ${n}` : `${n} activité${n > 1 ? "s" : ""} dans la réserve`;
  }

  resume(a) {
    const prises = this.etat?.prises?.[a.id] || 0;
    const faite = [...new Set((this.etat?.jouees || []).filter((x) => x.activite_id === a.id && !(x.decision === "refusee" && x.rendu)).map((x) => x.heros.split(/[\s,]+/)[0]))];
    const t = this.etat?.tableau;
    const auTableau = Boolean(t?.ids.includes(a.id));
    const rythme = a.unique ? (!auTableau && (t?.quetes_proposees || []).includes(a.id) ? "quête déjà proposée" : "quête unique") : RYTHMES.find(([k]) => k === a.rythme)?.[1].toLowerCase();
    return [CARACS.find(([k]) => k === a.carac)?.[1], a.competences.join(", "), a.modificateur ? `${a.modificateur > 0 ? "+" : "\u2212"}${Math.abs(a.modificateur)}\u00a0%` : "",
      a.places ? `${prises}/${a.places} places prises` : "", rythme, auTableau ? "au tableau" : "",
      faite.length ? `faite par ${faite.join(", ")}` : ""].filter(Boolean).join(" · ");
  }

  htmlActivite(a, i) {
    const batiments = (this.etat?.batiments || []).map((b) => [b.id, `${b.nom}${b.cache ? " (caché)" : ""}`]);
    const cagnotte = Object.values(a.issues).some((x) => x.vers === "cagnotte");
    return `
      <details class="activite-mj${a.visible ? "" : " cachee"}" data-id="${e(a.id)}"${this.ouvertes.has(a.id) ? " open" : ""}>
        <summary>
          <span class="nom">${e(a.nom || "Activité sans nom")}</span>
          <span class="meta">${e(this.resume(a))}</span>
          <span class="etiquette">${a.visible ? "Montrée" : "Cachée"}</span>
        </summary>
        <div class="fiche-activite-mj">
          <div class="deux">
            <label class="champ">Nom<input type="text" value="${e(a.nom)}" data-champ="nom" maxlength="120"></label>
            <label class="case"><input type="checkbox" data-champ="visible"${a.visible ? " checked" : ""}> Montrée aux joueurs</label>
          </div>
          <div class="trois">
            <label class="champ">Caractéristique<select data-champ="carac">${options(CARACS, a.carac)}</select></label>
            <label class="champ">Modificateur<input type="number" step="5" min="-100" max="100" value="${e(a.modificateur)}" data-champ="modificateur"></label>
            <label class="champ">Places par période<input type="number" min="1" max="20" value="${e(a.places ?? "")}" placeholder="sans limite" data-champ="places"></label>
          </div>
          <div class="trois">
            <label class="champ">Rythme dans la réserve<select data-champ="rythme"${a.unique ? " disabled" : ""}>${options(RYTHMES, a.rythme)}</select></label>
            <label class="case"><input type="checkbox" data-champ="unique"${a.unique ? " checked" : ""}> Quête unique <small>proposée une seule fois</small></label>
            <p class="au-tableau">${this.etat?.tableau?.ids.includes(a.id) ? '<span class="etiquette">Au tableau</span>' : a.visible && a.nom ? '<button type="button" data-action="tableau-ajouter">Mettre au tableau</button>' : ""}</p>
          </div>
          ${a.unique ? `<label class="champ">Accroche de la quête <small>une ligne, lue par les joueurs : « Tirée d'une rumeur entendue au comptoir »</small><input type="text" maxlength="160" value="${e(a.accroche || "")}" data-champ="accroche"></label>` : ""}
          <fieldset class="gains-mj"><legend>Ce qu'on peut y gagner <small>sur l'affiche, si vous l'annoncez</small></legend>
            ${GAINS.map(([k, n]) => `<label class="case"><input type="checkbox" data-gain="${k}"${(a.gains || []).includes(k) ? " checked" : ""}> ${n}</label>`).join("")}</fieldset>
          <label class="champ">Compétences qui aident <small>le meilleur bonus du héros parmi elles s'ajoute, séparées par des virgules</small>
            <input type="text" list="competences-activites" value="${e(a.competences.join(", "))}" data-champ="competences"></label>
          <label class="champ">Ce que lisent les joueurs<textarea rows="2" data-champ="texte">${e(a.texte)}</textarea></label>
          <table class="issues-mj">
            <thead><tr><th scope="col">Issue</th><th scope="col">Or</th><th scope="col">Vers</th><th scope="col">Récit type, lu aussitôt par le joueur</th></tr></thead>
            <tbody>${ISSUES.map(([k, nom]) => {
              const x = a.issues[k];
              const lisible = !x.or || formuleLisible(x.or);
              return `<tr data-issue="${e(k)}">
                <th scope="row">${e(nom)}</th>
                <td><input type="text" value="${e(x.or)}" data-issue-champ="or" aria-label="Or, ${e(nom)}" class="${lisible ? "" : "illisible"}" title="${lisible ? "" : "Formule illisible : le dé n'en tirera rien, vous fixerez l'or à la validation"}"></td>
                <td><select data-issue-champ="vers" aria-label="Destination, ${e(nom)}">${options([["bourse", "la bourse"], ["cagnotte", "une cagnotte"]], x.vers)}</select></td>
                <td><textarea rows="2" data-issue-champ="recit" aria-label="Récit type, ${e(nom)}">${e(x.recit)}</textarea></td>
              </tr>`;
            }).join("")}</tbody>
          </table>
          ${cagnotte ? `<label class="champ">Chantier proposé pour la cagnotte<select data-champ="chantier"><option value="">le premier chantier montré qui a un niveau à payer</option>${options(batiments, a.chantier)}</select></label>` : ""}
          <label class="champ secret">Notes pour le MJ <small>jamais montrées</small><textarea rows="2" data-champ="notes_mj">${e(a.notes_mj)}</textarea></label>
          <div class="actions pied-fiche">
            <button type="button" data-action="monter"${i ? "" : " disabled"}>Monter</button>
            <button type="button" data-action="descendre"${i < this.c.activites.length - 1 ? "" : " disabled"}>Descendre</button>
            <button type="button" class="danger" data-action="retirer">Retirer du catalogue</button>
          </div>
        </div>
      </details>`;
  }

  activiteDe(el) {
    const id = el.closest("[data-id]")?.dataset.id;
    return this.c.activites.find((a) => a.id === id) || null;
  }

  saisie(ev, change = false) {
    const t = ev.target;
    if (t.dataset.reglage) {
      if (t.dataset.reglage === "offres") this.c.offres = Math.max(0, Math.min(8, Math.round(Number(t.value) || 0)));
      else this.c.annoncer_gains = t.checked;
      return this.marquer();
    }
    const a = this.activiteDe(t);
    if (!a) return;
    if (t.tagName === "TEXTAREA") ajuster(t);
    if (t.dataset.issueChamp) {
      const k = t.closest("[data-issue]").dataset.issue;
      a.issues[k][t.dataset.issueChamp] = t.value;
      if (t.dataset.issueChamp === "or") t.classList.toggle("illisible", Boolean(t.value.trim()) && !formuleLisible(t.value));
      return this.marquer(change && t.dataset.issueChamp === "vers", a);
    }
    if (t.dataset.gain) {
      const g = t.dataset.gain;
      a.gains = t.checked ? [...new Set([...(a.gains || []), g])] : (a.gains || []).filter((x) => x !== g);
      return this.marquer(false, a);
    }
    const champ = t.dataset.champ;
    if (!champ) return;
    if (champ === "visible") a.visible = t.checked;
    else if (champ === "unique") {
      a.unique = t.checked;
      // Une quête a ses places : deux, tant que le MJ n'en dit pas autrement.
      if (a.unique && !a.places) a.places = 2;
    }
    else if (champ === "modificateur") a.modificateur = Math.max(-100, Math.min(100, Math.round(Number(t.value) || 0)));
    else if (champ === "places") a.places = t.value.trim() && Number(t.value) >= 1 ? Math.min(20, Math.round(Number(t.value))) : null;
    else if (champ === "competences") a.competences = t.value.split(",").map((x) => x.trim()).filter(Boolean);
    else a[champ] = t.value;
    this.marquer(change && ["visible", "carac", "chantier", "unique", "rythme"].includes(champ), a);
  }

  // Une modification : l'envoi part un peu après la frappe ; redessiner seulement le titre de la fiche (ou toute la fiche
  // quand un choix change ce qu'elle montre).
  marquer(redessiner = false, a = null) {
    this.modifie = true;
    afficherTemoin(this.section.querySelector(".temoin-enregistrement"), "modifie");
    if (a) {
      const d = this.section.querySelector(`details[data-id="${CSS.escape(a.id)}"]`);
      if (redessiner && d) {
        const i = this.c.activites.indexOf(a);
        d.outerHTML = this.htmlActivite(a, i);
        this.section.querySelectorAll(`details[data-id="${CSS.escape(a.id)}"] textarea`).forEach(ajuster);
      } else if (d) {
        d.querySelector("summary .nom").textContent = a.nom || "Activité sans nom";
        d.querySelector("summary .meta").textContent = this.resume(a);
      }
    }
    this.sauver();
  }

  enregistrer() {
    this.chaine = this.chaine.then(async () => {
      if (this.detruit && !this.modifie) return;
      this.modifie = false;
      this.envois += 1;
      afficherTemoin(this.section?.querySelector(".temoin-enregistrement"), "enregistrement");
      try {
        const fusion = await enregistrerAvecVersion("/api/activites", this.c, this.bases, "catalogue", { listes: { activites: "id" } });
        // Le serveur a pu changer un identifiant (un doublon) : la page reprend les siens.
        const srv = this.bases.catalogue;
        if (fusion || srv.activites.length !== this.c.activites.length || srv.activites.some((x, i) => x.id !== this.c.activites[i]?.id)) {
          this.c = copie(srv);
          if (!this.detruit) this.afficherListe();
          if (fusion) toast("Le catalogue avait changé sur un autre écran : les deux versions sont réunies.");
        }
        afficherTemoin(this.section?.querySelector(".temoin-enregistrement"), this.modifie ? "modifie" : "ok", { modifie: this.c.modifie });
        if (!this.detruit) this.relireEtat();
      } catch (err) {
        this.modifie = true;
        afficherTemoin(this.section?.querySelector(".temoin-enregistrement"), "erreur");
        toast(`Catalogue non enregistré : ${err.message}`, "erreur");
      } finally {
        this.envois -= 1;
      }
    });
    return this.chaine;
  }

  // Un geste sur le tableau de la période : la réserve s'enregistre d'abord (une quête cochée à l'instant compte).
  async geste(b) {
    const id = b.closest("[data-id]")?.dataset.id;
    if (!id) return;
    b.disabled = true;
    try {
      await this.vider();
      this.etat = await api.post("/api/activites/tableau", { action: b.dataset.action.slice(8), activite: id });
      toast(b.dataset.action === "tableau-changer" ? "Une autre affiche la remplace au tableau." : b.dataset.action === "tableau-retirer" ? "Retirée du tableau pour cette période." : "Au tableau pour cette période.");
    } catch (err) {
      toast(err.message, "erreur");
    } finally {
      if (!this.detruit) {
        this.afficherReglages();
        this.afficherListe();
      }
    }
  }

  async relireEtat() {
    try {
      this.etat = await api.get("/api/activites/etat");
    } catch {
      return;
    }
    if (this.detruit) return;
    if (!this.section.querySelector(".reglages-activites").contains(document.activeElement)) this.afficherReglages();
  }

  async clic(ev) {
    const b = ev.target.closest("button[data-action]");
    if (!b || b.disabled) return;
    if (b.dataset.action.startsWith("tableau-")) return this.geste(b);
    if (b.dataset.action === "nouvelle") {
      const a = vierge();
      this.c.activites.push(a);
      this.ouvertes.add(a.id);
      this.afficherListe();
      this.section.querySelector(`details[data-id="${CSS.escape(a.id)}"] [data-champ="nom"]`)?.focus();
      return this.marquer();
    }
    const a = this.activiteDe(b);
    if (!a) return;
    const i = this.c.activites.indexOf(a);
    if (b.dataset.action === "monter" || b.dataset.action === "descendre") {
      const j = b.dataset.action === "monter" ? i - 1 : i + 1;
      [this.c.activites[i], this.c.activites[j]] = [this.c.activites[j], this.c.activites[i]];
      this.afficherListe();
      return this.marquer();
    }
    if (b.dataset.action === "retirer") {
      const oui = await demander({ titre: "Retirer cette activité ?", texte: `« ${a.nom || "Activité sans nom"} » quitte le catalogue. Ce qui a déjà été joué reste dans la boîte et dans le journal.`, oui: "Retirer", danger: true });
      if (!oui) return;
      this.c.activites = this.c.activites.filter((x) => x !== a);
      this.afficherListe();
      this.marquer();
    }
  }
}
