// L'auberge de la campagne (son vrai nom est caché aux joueurs) : la planche à contrats, les rumeurs de comptoir, et qui boit là
// ce soir. Ce que l'auberge tient du kit (son nom caché, ses habitués, les rumeurs de l'aide-mémoire, la campagne à
// installer) vient de auberge/kit.js, chargé à l'ouverture de la page chez le MJ principal seulement : un MJ
// invité y tient ses contrats et ses rumeurs, sans rien du kit.
// Chaque fiche s'enregistre pendant la frappe ; ce qui part vers la TV passe par /api/table, jamais les notes du MJ.

import { api, copie, differer, echapper as e, enregistrerAvecVersion, toast } from "../api.js";
import { annoncerCorbeille, lienVersions } from "../corbeille/corbeille.js";
import { BoutonTv } from "../ecran-tv/bouton-tv.js";
import { cartonVerifie } from "../pnj/carton-pnj.js";
import { demander } from "../commun/dialogue.js";
import { Vierges, nomDistinct } from "../commun/vierges.js";
import { attributsMiniature } from "../commun/miniature.js";
import { afficherTemoin, htmlTemoin } from "../commun/temoin-enregistrement.js";
import { descriptionTv, ecouterTv, phraseTv } from "../ecran-tv/etat-tv.js";
import { Reessai } from "../commun/reessai.js";
import { htmlAffiche } from "./affiche.js";
import { estInvite } from "../mj/role.js";
import { DANGERS, ETATS_CONTRAT, ETATS_RUMEUR, VERITES, tirerContrat, tirerRumeur } from "./tables.js";

const SUR_LA_PLANCHE = new Set(["affiche", "pris"]);
const NOMS_ETATS = Object.fromEntries(ETATS_CONTRAT);
const NOMS_RUMEURS = Object.fromEntries(ETATS_RUMEUR);
const NOMS_VERITES = Object.fromEntries(VERITES);
const VUE_AVANT = ["vue", "carte", "camera", "style", "version", "lieu", "url", "titre"];
const FILTRES = [["a-placer", "À placer"], ["entendue", "Entendues"], ["toutes", "Toutes"]];

function ajuster(zone) {
  zone.style.height = "auto";
  zone.style.height = `${zone.scrollHeight + 2}px`;
}

const options = (liste, valeur, vide) =>
  (vide ? `<option value="">${e(vide)}</option>` : "") + liste.map(([v, n]) => `<option value="${e(v)}" ${v === (valeur || "") ? "selected" : ""}>${e(n)}</option>`).join("");

export class Auberge {
  constructor(racine, { genre, id }) {
    this.racine = racine;
    this.choix = genre && id ? { genre, id } : null;
    this.filtre = "a-placer";
    // Les rumeurs racontées depuis le filtre « À placer » y restent, estompées, jusqu'au prochain changement de filtre :
    // la suivante ne remonte pas sous le curseur, et « Taire » reste sous la main.
    this.racontees = new Set();
    this.vierges = new Vierges();
    this.modifies = new Set();
    this.sauver = differer(() => this.enregistrer(), 700);
    this.chaine = Promise.resolve();
    this.envois = 0;
    // Serveur injoignable : les fiches qui ne sont pas parties repartent seules (3 s, 10 s, puis toutes les 30 s).
    this.enEchec = false;
    this.reessai = new Reessai(() => this.enregistrer(), () => this.afficherEtat());
    this.bases = {};
  }

  async demarrer() {
    const [kit, ...donnees] = await Promise.all([
      estInvite() ? null : import("./kit.js"),
      ...["/api/contrats", "/api/rumeurs", "/api/pnj", "/api/lieux", "/api/fils", "/api/seances", "/api/table"].map((u) => api.get(u)),
    ]);
    if (this.detruit) return;
    this.kit = kit;
    [this.contrats, this.rumeurs, this.pnj, this.lieux, this.fils, this.seances, this.table] = donnees;
    for (const c of this.contrats) this.bases[`contrat:${c.id}`] = copie(c);
    for (const r of this.rumeurs) this.bases[`rumeur:${r.id}`] = copie(r);
    this.lieux.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    this.pnj.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    if (this.choix && !this.fiche) {
      this.choix = null;
      toast("Cette fiche n'existe plus ou plus ici (elle est peut-être à la corbeille) : voici la planche.");
    }
    this.racine.innerHTML = this.gabarit();
    // La planche à la TV : un seul bouton qui bascule, dans le bandeau collé en haut de la page.
    this.boutonPlanche = new BoutonTv({
      estIci: (t) => t.vue === "planche",
      montrer: () => this.montrerPlanche(),
      retirer: () => this.retirerPlanche(),
      libelle: "Montrer la planche à la TV",
      titre: "La planche et ses affiches sur la TV, sans ce qui est pour le MJ",
      titreIci: "La TV montre la planche : la retirer, elle revient à ce qu'elle montrait avant",
    });
    this.lier();
    this.tout();
    // Ce que montre la TV, lu comme le témoin de l'en-tête (un autre écran a pu la changer) : le bandeau, les rumeurs et
    // le panneau le disent sans le deviner. Un panneau en cours de frappe n'est pas réécrit.
    this.finTv = ecouterTv((t) => {
      this.table = t;
      if (this.detruit) return;
      this.afficherEtatTable();
      this.afficherRumeurs();
      if (!this.racine.querySelector(".panneau-auberge")?.contains(document.activeElement)) this.afficherPanneau();
    });
  }

  async detruire() {
    this.detruit = true;
    this.boutonPlanche?.detruire();
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
    return this.modifies.size > 0 || this.sauver.enAttente() || this.envois > 0;
  }

  get fiche() {
    if (!this.choix) return null;
    const liste = this.choix.genre === "contrat" ? this.contrats : this.rumeurs;
    return liste.find((x) => x.id === this.choix.id) || null;
  }

  get auberge() {
    return this.kit ? this.kit.aubergeDuKit(this.lieux) : null;
  }

  gabarit() {
    return `
    <section class="auberge">
      <div class="auberge-corps">
        <div class="etat-table bandeau-tv" aria-live="polite"></div>
        <header class="titre-auberge">
          <div>
            ${this.kit ? `<p class="kicker" title="Nom caché aux joueurs jusqu'à la révélation">${e(this.kit.NOM_CACHE_DE_L_AUBERGE)}</p>` : '<p class="kicker">Vos contrats et vos rumeurs</p>'}
            <h1>L'auberge</h1>
            <p class="chapo">La planche à contrats près de la porte, les rumeurs du comptoir${this.kit ? ", et ceux qui boivent là ce soir" : ""}.</p>
            ${this.kit ? '<p class="vers-activites"><a href="#/auberge/activites">Les activités entre les séances</a> : ce que les héros font d\'une séance à l\'autre.</p>' : ""}
          </div>
        </header>
        <section class="bloc-planche">
          <div class="barre">
            <h2>La planche à contrats</h2>
            <div class="actions">
              <button data-action="nouveau-contrat">Nouveau contrat</button>
              <button data-action="nouvel-avis">Nouvel avis</button>
              <button data-action="tirer-contrat" title="Un contrat tiré au sort, gardé en brouillon">Tirer un contrat</button>
            </div>
          </div>
          <div class="planche-mj"></div>
          <div class="hors-planche"></div>
        </section>
        <section class="bloc-rumeurs">
          <div class="barre">
            <h2>Rumeurs de comptoir</h2>
            <div class="actions">
              <button data-action="tirer-rumeur" title="${this.kit ? "Une rumeur du kit ou de la maison" : "Une rumeur de comptoir"}, pas encore dans la liste">Tirer une rumeur</button>
              <button data-action="nouvelle-rumeur">Nouvelle rumeur</button>
            </div>
          </div>
          <div class="filtres-rumeurs" role="group" aria-label="Filtrer les rumeurs"></div>
          <ul class="liste-rumeurs"></ul>
        </section>
      </div>
      <aside class="panneau-auberge"></aside>
    </section>`;
  }

  lier() {
    const r = this.racine;
    r.querySelector(".auberge-corps").addEventListener("click", (ev) => this.clic(ev));
    const panneau = r.querySelector(".panneau-auberge");
    panneau.addEventListener("input", (ev) => this.saisie(ev));
    panneau.addEventListener("change", (ev) => this.saisie(ev, true));
    panneau.addEventListener("click", (ev) => this.clic(ev));
  }

  tout() {
    this.afficherEtatTable();
    this.afficherPlanche();
    this.afficherRumeurs();
    this.afficherPanneau();
  }

  nomDe(liste, id) {
    return liste.find((x) => x.id === id)?.nom || "";
  }

  // Le bandeau collé en haut de la page : ce que montre la TV, nommé comme dans le témoin de l'en-tête, et ses gestes
  // (la planche, et « Taire » quand une rumeur est racontée), à portée de main même en bas de la liste des rumeurs.
  afficherEtatTable() {
    const t = this.table || {};
    const zone = this.racine.querySelector(".etat-table");
    const d = descriptionTv();
    zone.innerHTML = `
      <p><span class="kicker">TV</span> ${d ? `La TV montre <strong>${e(phraseTv(d))}</strong>.` : "Lecture de la table…"}</p>
      <div class="actions">${t.rumeur ? '<button data-action="taire">Taire la rumeur</button>' : ""}</div>`;
    zone.querySelector(".actions").append(this.boutonPlanche.el);
    this.boutonPlanche.maj(this.table);
  }

  afficherPlanche() {
    const zone = this.racine.querySelector(".planche-mj");
    const hors = this.racine.querySelector(".hors-planche");
    if (!this.contrats.length && !this.rumeurs.length && this.kit) {
      zone.innerHTML = `
        <div class="installer">
          <p>La planche est vide.</p>
          <button class="principal" data-action="installer">Installer l'auberge du kit</button>
          <p class="aide">Quatre affiches (deux sur la planche, deux qui attendent leur fil), les six rumeurs de l'aide-mémoire, les quatre fils de la campagne et les trois habitués de l'auberge. Rien de ce qui existe n'est modifié.</p>
        </div>`;
      hors.innerHTML = "";
      return;
    }
    const tri = (a, b) => (a.ordre ?? 0) - (b.ordre ?? 0) || (a.cree || "").localeCompare(b.cree || "");
    const visibles = this.contrats.filter((c) => SUR_LA_PLANCHE.has(c.etat)).sort(tri);
    const choisi = this.choix?.genre === "contrat" ? this.choix.id : null;
    zone.innerHTML = visibles.length
      ? visibles.map((c) => htmlAffiche(c, { bouton: true, choisie: c.id === choisi })).join("")
      : '<p class="planche-vide">Aucune affiche sur la planche. Un contrat « affiché » ou « pris » y apparaît.</p>';
    const autres = this.contrats.filter((c) => !SUR_LA_PLANCHE.has(c.etat)).sort(tri);
    hors.innerHTML = autres.length ? `
      <h3>Hors de la planche</h3>
      <ul class="liste-contrats">
        ${autres.map((c) => `
          <li><button data-contrat="${e(c.id)}" aria-current="${c.id === choisi}">
            <span class="nom">${e(c.nom || "Sans titre")}${c.genre === "avis" ? ' <i>avis</i>' : ""}</span>
            <span class="meta">${e([this.nomDe(this.fils, c.fil), this.nomDe(this.lieux, c.lieu)].filter(Boolean).join(" · "))}</span>
            <span class="etiquette etat-${e(c.etat || "brouillon")}">${e((NOMS_ETATS[c.etat] || "Brouillon").split(",")[0])}</span>
          </button></li>`).join("")}
      </ul>` : "";
  }

  afficherRumeurs() {
    const compte = (f) => (f === "toutes" ? this.rumeurs.length : this.rumeurs.filter((r) => (f === "a-placer" ? r.etat === "a-placer" || !r.etat : r.etat && r.etat !== "a-placer")).length);
    this.racine.querySelector(".filtres-rumeurs").innerHTML = FILTRES.map(([f, n]) =>
      `<button data-filtre="${f}" aria-pressed="${this.filtre === f}">${n} <span class="compte">${compte(f)}</span></button>`).join("");
    const liste = this.rumeurs
      .filter((r) => this.filtre === "toutes" || (this.filtre === "a-placer" ? r.etat === "a-placer" || !r.etat || this.racontees.has(r.id) : r.etat && r.etat !== "a-placer"))
      .sort((a, b) => (a.cree || "").localeCompare(b.cree || ""));
    const choisie = this.choix?.genre === "rumeur" ? this.choix.id : null;
    const surTable = this.table?.rumeur;
    this.racine.querySelector(".liste-rumeurs").innerHTML = liste.map((r) => `
      <li class="${[r.id === choisie ? "choisie" : "", this.filtre === "a-placer" && this.racontees.has(r.id) ? "racontee" : ""].filter(Boolean).join(" ")}">
        <button class="ouvrir" data-rumeur="${e(r.id)}">
          <span class="texte">«&nbsp;${e(r.texte || "…")}&nbsp;»</span>
          <span class="meta">${e([r.source, this.nomDe(this.fils, r.fil)].filter(Boolean).join(" · "))}</span>
        </button>
        <span class="verite verite-${e(r.verite || "aucune")}" title="Vraie ou fausse : visible par vous seul">${e(r.verite ? NOMS_VERITES[r.verite] : "?")}</span>
        <span class="etat-rumeur">${e(NOMS_RUMEURS[r.etat] || "À placer")}</span>
        ${surTable === r.id
          ? `<button data-action="taire">Taire</button>`
          : `<button data-action="raconter" data-rumeur="${e(r.id)}" title="Afficher la rumeur sur la TV">Raconter</button>`}
      </li>`).join("") || `<li class="vide">${this.filtre === "a-placer" ? "Aucune rumeur à placer. Tirez-en une, ou attendez que les fils avancent." : "Aucune rumeur."}</li>`;
  }

  afficherPanneau() {
    const zone = this.racine.querySelector(".panneau-auberge");
    const f = this.fiche;
    if (!f) zone.innerHTML = this.panneauComptoir();
    else if (this.choix.genre === "contrat") zone.innerHTML = this.panneauContrat(f);
    else zone.innerHTML = this.panneauRumeur(f);
    zone.querySelectorAll("textarea").forEach(ajuster);
    if (f) this.afficherEtat();
  }

  panneauComptoir() {
    // Le comptoir est celui de l'auberge du kit : un MJ invité n'en a que le mot pour choisir une fiche.
    if (!this.kit) return `<p class="aide">Choisissez une affiche ou une rumeur pour la modifier.</p>`;
    const ici = this.auberge ? this.pnj.filter((p) => p.lieu === this.auberge.id) : [];
    const surTable = this.table?.pnj;
    return `
      <h2>Au comptoir ce soir</h2>
      ${ici.length ? `<ul class="comptoir">${ici.map((p) => `
        <li>
          <span class="medaillon-mini">${p.illustration ? `<img ${attributsMiniature(p.illustration, 160, 40)} alt="">` : `<span>${e((p.nom || "?").replace(/^(L'|Le |La )/, "").charAt(0))}</span>`}</span>
          <a href="#/pnj/${e(p.id)}"><span class="nom">${e(p.nom)}</span><span class="meta">${e(p.role || "")}</span></a>
          ${surTable === p.id ? '<button class="bouton-tv montree petit" data-action="pnj-retirer" aria-pressed="true" title="Son carton est à la TV : le retirer"><span class="tv-etat">À la TV</span>Retirer de la TV</button>' : `<button data-action="pnj-montrer" data-pnj="${e(p.id)}"${p.connu ? "" : ' title="Inconnu des joueurs : il sera rendu connu"'}>Montrer à la TV</button>`}
        </li>`).join("")}</ul>`
        : `<p class="aide">Personne pour l'instant : les PNJ dont le lieu est l'auberge s'affichent ici.</p>`}
      <h3>Le règlement de l'auberge</h3>
      <ul class="regles-maison">${this.kit.REGLEMENT_DE_L_AUBERGE.map((r) => `
        <li>${e(r)}</li>`).join("")}
      </ul>
      <p class="aide">${e(this.kit.DECOR_DE_L_AUBERGE)}</p>
      <p class="aide">Choisissez une affiche ou une rumeur pour la modifier.</p>`;
  }

  panneauContrat(c) {
    const pnj = this.pnj.map((p) => [p.id, p.nom]);
    const lieux = this.lieux.map((l) => [l.id, l.nom]);
    const fils = this.fils.map((x) => [x.id, x.nom]);
    const lieu = this.lieux.find((l) => l.id === c.lieu);
    const surTable = this.table?.vue === "planche" && this.table?.contrat === c.id;
    return `
      <div class="fiche-auberge">
        <div class="titre-avec-temoin"><p class="kicker">${c.genre === "avis" ? "Avis officiel" : "Contrat"}</p>${htmlTemoin(this.modifies.has(`contrat:${c.id}`) ? "modifie" : "ok")}</div>
        <label class="champ">Titre<input type="text" value="${e(c.nom || "")}" data-champ="nom"></label>
        <div class="deux">
          <label class="champ">Genre<select data-champ="genre">${options([["contrat", "Contrat"], ["avis", "Avis officiel"]], c.genre || "contrat")}</select></label>
          <label class="champ">État<select data-champ="etat">${options(ETATS_CONTRAT, c.etat || "brouillon")}</select></label>
        </div>
        <div class="actions etats-affiche" role="group" aria-label="L'affiche sur la planche">
          ${[["affiche", "Clouer sur la planche"], ["pris", "Pris par les héros"], ["retire", "Retirer"]].map(([k, nom]) => `<button type="button" data-etat-affiche="${k}" aria-pressed="${(c.etat || "brouillon") === k}">${nom}</button>`).join("")}
        </div>
        <label class="champ">Texte de l'affiche<textarea rows="3" data-champ="affiche">${e(c.affiche || "")}</textarea></label>
        <label class="champ">Récompense<input type="text" value="${e(c.recompense || "")}" data-champ="recompense" placeholder="Trente pièces d'or par tête."></label>
        <label class="champ">${c.genre === "avis" ? "Signature" : "À qui s'adresser"}<input type="text" value="${e(c.contact || "")}" data-champ="contact"></label>
        <label class="champ">Ajouté à la main, d'une autre écriture<input type="text" value="${e(c.mention || "")}" data-champ="mention" placeholder="Ne descendez pas."></label>
        <label class="case"><input type="checkbox" data-champ="delave" ${c.delave ? "checked" : ""}> Papier délavé par la pluie</label>
        <div class="actions">
          ${surTable ? '<button data-action="planche-seule">Revenir à toute la planche</button>' : '<button class="principal" data-action="montrer-contrat">Montrer de près à la TV</button>'}
        </div>
        <h3>Pour le MJ</h3>
        <label class="champ secret">Ce qui se passe vraiment<textarea rows="3" data-champ="verite">${e(c.verite || "")}</textarea></label>
        <label class="champ">Danger<select data-champ="danger">${options(DANGERS, c.danger || "")}</select></label>
        <div class="deux">
          <label class="champ">Commanditaire<select data-champ="commanditaire">${options(pnj, c.commanditaire, "Aucun PNJ")}</select></label>
          <label class="champ">Lieu<select data-champ="lieu">${options(lieux, c.lieu, "Aucun lieu")}</select></label>
        </div>
        <div class="deux">
          <label class="champ">Fil de la campagne<select data-champ="fil">${options(fils, c.fil, "Aucun")}</select></label>
          <label class="champ">Scénario<input type="text" value="${e(c.scenario || "")}" data-champ="scenario"></label>
        </div>
        <p class="liens">
          ${c.commanditaire && this.pnj.some((p) => p.id === c.commanditaire) ? `<a href="#/pnj/${e(c.commanditaire)}">Fiche du commanditaire</a>` : ""}
          ${lieu?.carte ? `<a href="#/carte/${e(lieu.carte)}?lieu=${e(lieu.id)}">Voir le lieu sur la carte</a>` : ""}
        </p>
        <label class="champ">Notes<textarea rows="3" data-champ="notes">${e(c.notes || "")}</textarea></label>
        <div class="actions pied-fiche">
          <button data-action="fermer">Fermer la fiche</button>
          <button class="danger" data-action="supprimer">Mettre à la corbeille</button>
          <a class="lien-versions" href="${lienVersions("contrats", c.id, `#/auberge/contrat/${c.id}`)}">Versions précédentes</a>
        </div>
      </div>`;
  }

  panneauRumeur(r) {
    const fils = this.fils.map((x) => [x.id, x.nom]);
    const lieux = this.lieux.map((l) => [l.id, l.nom]);
    const seances = this.seances.slice().sort((a, b) => (a.numero || 0) - (b.numero || 0)).map((s) => [s.id, `Séance ${s.numero || "?"}${s.nom ? ` · ${s.nom}` : ""}`]);
    const sources = [...new Set([...this.pnj.filter((p) => this.auberge && p.lieu === this.auberge.id).map((p) => p.nom), "la serveuse", "le marchand nain", "le ménestrel", "un colporteur", "un habitué qui a trop bu"])];
    const surTable = this.table?.rumeur === r.id;
    return `
      <div class="fiche-auberge">
        <div class="titre-avec-temoin"><p class="kicker">Rumeur</p>${htmlTemoin(this.modifies.has(`rumeur:${r.id}`) ? "modifie" : "ok")}</div>
        <label class="champ">Ce qu'on raconte<textarea rows="3" data-champ="texte">${e(r.texte || "")}</textarea></label>
        <label class="champ">Qui la raconte<input type="text" list="sources-rumeur" value="${e(r.source || "")}" data-champ="source"></label>
        <datalist id="sources-rumeur">${sources.map((s) => `<option value="${e(s)}">`).join("")}</datalist>
        <div class="deux">
          <label class="champ">État<select data-champ="etat">${options(ETATS_RUMEUR, r.etat || "a-placer")}</select></label>
          <label class="champ">Vraie ?<select data-champ="verite">${options(VERITES, r.verite || "")}</select></label>
        </div>
        <div class="actions">
          ${surTable ? '<button data-action="taire">Taire</button>' : `<button class="principal" data-action="raconter" data-rumeur="${e(r.id)}">Raconter</button>`}
        </div>
        <h3>Pour le MJ</h3>
        <label class="champ secret">Le fond de l'affaire<textarea rows="3" data-champ="fond">${e(r.fond || "")}</textarea></label>
        <div class="deux">
          <label class="champ">Fil de la campagne<select data-champ="fil">${options(fils, r.fil, "Aucun")}</select></label>
          <label class="champ">Lieu concerné<select data-champ="lieu">${options(lieux, r.lieu, "Aucun lieu")}</select></label>
        </div>
        <label class="champ">Entendue pendant<select data-champ="seance">${options(seances, r.seance, "Pas encore")}</select></label>
        <div class="actions pied-fiche">
          <button data-action="fermer">Fermer la fiche</button>
          <button class="danger" data-action="supprimer">Mettre à la corbeille</button>
          <a class="lien-versions" href="${lienVersions("rumeurs", r.id, `#/auberge/rumeur/${r.id}`)}">Versions précédentes</a>
        </div>
      </div>`;
  }

  // Un contrat, un avis ou une rumeur « Nouveau » laissé intact repart à la corbeille quand on passe à une autre fiche
  // (sauf s'il est à la TV).
  purgerVierges(sauf = null) {
    return this.vierges.purger({
      sauf,
      trouve: (cle) => {
        const [genre, id] = cle.split(":");
        return (genre === "contrat" ? this.contrats : this.rumeurs).find((x) => x.id === id);
      },
      modifiee: (cle) => this.modifies.has(cle) || [this.table?.contrat, this.table?.rumeur].includes(cle.split(":")[1]),
      retirer: (cle) => {
        const [genre, id] = cle.split(":");
        if (genre === "contrat") this.contrats = this.contrats.filter((x) => x.id !== id);
        else this.rumeurs = this.rumeurs.filter((x) => x.id !== id);
      },
    });
  }

  choisir(genre, id) {
    if (this.modifies.size) this.sauver.maintenant();
    if (this.vierges.liste.size) {
      this.purgerVierges(id ? `${genre}:${id}` : null).then((n) => {
        if (!n || this.detruit) return;
        this.afficherPlanche();
        this.afficherRumeurs();
      }).catch(() => {});
    }
    this.choix = id ? { genre, id } : null;
    history.replaceState(null, "", id ? `#/auberge/${genre}/${id}` : "#/auberge");
    this.afficherPlanche();
    this.afficherRumeurs();
    this.afficherPanneau();
    if (id) this.racine.querySelector(".panneau-auberge").scrollTop = 0;
  }

  saisie(ev, change) {
    const el = ev.target;
    const f = this.fiche;
    if (!f || !el.dataset.champ) return;
    const coche = el.type === "checkbox";
    // Le texte s'enregistre à la frappe, les listes et les cases quand elles changent.
    if ((coche || el.tagName === "SELECT") !== Boolean(change)) return;
    if (el.tagName === "TEXTAREA") ajuster(el);
    f[el.dataset.champ] = coche ? el.checked : el.value;
    this.modifies.add(`${this.choix.genre}:${f.id}`);
    afficherTemoin(this.racine.querySelector(".fiche-auberge .temoin-enregistrement"), "modifie");
    this.sauver();
    const visuel = ["nom", "affiche", "recompense", "contact", "mention", "delave", "etat", "genre", "fil", "lieu"];
    if (this.choix.genre === "contrat" && visuel.includes(el.dataset.champ)) this.afficherPlanche();
    if (this.choix.genre === "rumeur") this.afficherRumeurs();
    if (el.dataset.champ === "genre") this.afficherPanneau();
  }

  // Les envois se suivent en file, chaque fiche avec sa version : un autre écran n'est jamais écrasé en silence.
  enregistrer() {
    this.envois++;
    this.chaine = this.chaine.then(() => this.ecrire()).finally(() => this.envois--);
    return this.chaine;
  }

  async ecrire() {
    const cles = [...this.modifies];
    this.modifies.clear();
    const erreurs = [];
    let planche = false;
    let fusion = false;
    for (const cle of cles) {
      const [genre, id] = cle.split(":");
      const liste = genre === "contrat" ? this.contrats : this.rumeurs;
      const f = liste.find((x) => x.id === id);
      if (!f) continue;
      try {
        fusion = (await enregistrerAvecVersion(`/api/${genre === "contrat" ? "contrats" : "rumeurs"}/${id}`, f, this.bases, cle)) || fusion;
        if (genre === "contrat") planche = true;
      } catch (err) {
        erreurs.push(err);
        this.modifies.add(cle);
        this.reessai.signaler(err, `« ${f.nom || f.texte || id} » non enregistré`);
      }
    }
    if (cles.length) this.reessai.bilan(erreurs);
    this.enEchec = erreurs.length > 0;
    if (fusion && !this.detruit) {
      toast("Un autre écran avait modifié cette fiche : ses changements et les vôtres sont réunis.");
      if (!this.racine.contains(document.activeElement) || !document.activeElement.matches("input, textarea, select")) this.tout();
    }
    this.afficherEtat();
    // La TV relit la planche à chaque état reçu : on le lui renvoie si elle l'affiche.
    if (planche && this.table?.vue === "planche") this.envoyer({}).catch(() => {});
  }

  // L'état de la fiche ouverte après un envoi : raté (avec le nouvel essai qui vient), ou tout enregistré.
  afficherEtat() {
    const etat = this.detruit ? null : this.racine.querySelector(".fiche-auberge .temoin-enregistrement");
    if (!etat) return;
    if (this.enEchec) afficherTemoin(etat, "erreur", { reessai: this.reessai });
    else if (!this.modifies.size) afficherTemoin(etat, "ok", { modifie: this.fiche?.modifie });
  }

  async creer(genre, donnees, vierge = false) {
    const chemin = genre === "contrat" ? "contrats" : "rumeurs";
    const f = await api.post(`/api/${chemin}`, donnees);
    if (vierge) this.vierges.marquer(`${genre}:${f.id}`, `/api/${chemin}`, f);
    this.bases[`${genre}:${f.id}`] = copie(f);
    (genre === "contrat" ? this.contrats : this.rumeurs).push(f);
    this.choisir(genre, f.id);
    // Rangée en bas de sa liste (la plus récente), elle vient sous les yeux.
    this.racine.querySelector(genre === "contrat" ? `[data-contrat="${CSS.escape(f.id)}"]` : `.liste-rumeurs [data-rumeur="${CSS.escape(f.id)}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
    return f;
  }

  async envoyer(changements) {
    const etat = await api.get("/api/table");
    delete etat.ecrans;
    const nouveau = { ...etat, ...changements };
    const r = await api.put("/api/table", nouveau);
    this.table = nouveau;
    this.afficherEtatTable();
    return r;
  }

  async montrerPlanche(contrat = null) {
    const etat = await api.get("/api/table");
    const avant = ["planche", "precedemment", "episode", "heros", "fiches"].includes(etat.vue) ? etat.avant || null : Object.fromEntries(VUE_AVANT.map((k) => [k, etat[k] ?? null]));
    const r = await this.envoyer({ vue: "planche", contrat, avant, lieu: null });
    toast(r.ecrans ? (contrat ? `À la TV, de près : «\u00a0${this.contrats.find((c) => c.id === contrat)?.nom || "l'affiche"}\u00a0».` : "À la TV : la planche à contrats.") : "Envoyé, mais aucun écran de table n'est branché.");
  }

  async retirerPlanche() {
    const etat = await api.get("/api/table");
    const avant = etat.avant && !["planche", "precedemment", "episode", "heros", "fiches"].includes(etat.avant.vue) ? etat.avant : { vue: "accueil" };
    await this.envoyer({ ...avant, contrat: null, avant: null });
    toast("Retiré de la TV : la planche à contrats.");
  }

  async raconter(r) {
    if (!r.etat || r.etat === "a-placer") {
      this.racontees.add(r.id);
      r.etat = "entendue";
      this.modifies.add(`rumeur:${r.id}`);
      await this.sauver.maintenant();
    }
    const rep = await this.envoyer({ rumeur: r.id });
    toast(rep.ecrans ? "Rumeur racontée à la table." : "Envoyée, mais aucun écran de table n'est ouvert.", "info", {
      action: { libelle: "Reprendre", faire: async () => {
        await this.envoyer({ rumeur: null });
        if (!this.detruit) {
          this.afficherRumeurs();
          if (this.choix?.id === r.id) this.afficherPanneau();
        }
      } },
    });
    this.afficherRumeurs();
    if (this.choix?.id === r.id) this.afficherPanneau();
  }

  async montrerPnj(id) {
    const p = this.pnj.find((x) => x.id === id);
    if (!p) return;
    // Ce que son carton nomme d'inconnu des joueurs (un lieu dans son rôle…) passe par la même question que partout ; un
    // PNJ inconnu ne devient connu qu'après ce « oui », dans cette seule question.
    if (!(await cartonVerifie(p.id, p.nom, { secret: !p.connu }))) return;
    // Seul « connu » change : la copie du PNJ chargée ici n'écrase pas ce qu'un autre écran a écrit dans sa fiche.
    if (!p.connu) Object.assign(p, await api.patch(`/api/pnj/${p.id}`, { connu: true }));
    await this.envoyer({ pnj: id });
    this.afficherPanneau();
  }

  async clic(ev) {
    const b = ev.target.closest("button");
    if (!b) return;
    const a = b.dataset.action;
    try {
      if (b.dataset.filtre) {
        this.filtre = b.dataset.filtre;
        this.racontees.clear();
        return this.afficherRumeurs();
      }
      if (a === "raconter") return await this.raconter(this.rumeurs.find((x) => x.id === b.dataset.rumeur));
      if (a === "taire") {
        await this.envoyer({ rumeur: null });
        this.afficherRumeurs();
        return this.afficherPanneau();
      }
      if (b.dataset.contrat && !a) return this.choisir("contrat", b.dataset.contrat === this.choix?.id ? null : b.dataset.contrat);
      if (b.dataset.rumeur && !a) return this.choisir("rumeur", b.dataset.rumeur === this.choix?.id ? null : b.dataset.rumeur);
      if (a === "montrer-planche") return await this.montrerPlanche();
      if (a === "retirer-planche") return await this.retirerPlanche();
      if (a === "planche-seule") {
        await this.montrerPlanche(null);
        return this.afficherPanneau();
      }
      if (a === "pnj-montrer") return await this.montrerPnj(b.dataset.pnj);
      if (a === "pnj-retirer") {
        await this.envoyer({ pnj: null });
        return this.afficherPanneau();
      }
      if (a === "nouveau-contrat") return await this.creer("contrat", { genre: "contrat", nom: nomDistinct("Nouveau contrat", this.contrats.map((x) => x.nom)), etat: "brouillon", etiquette: "maison" }, true);
      if (a === "nouvel-avis") return await this.creer("contrat", { genre: "avis", nom: nomDistinct("Avis", this.contrats.map((x) => x.nom)), etat: "brouillon", etiquette: "maison" }, true);
      if (a === "tirer-contrat") return await this.creer("contrat", tirerContrat());
      if (a === "nouvelle-rumeur") return await this.creer("rumeur", { texte: "", etat: "a-placer" }, true);
      if (a === "tirer-rumeur") {
        const r = tirerRumeur(this.rumeurs, this.kit?.RUMEURS_DU_KIT);
        if (!r) return toast("Toutes les rumeurs des tables sont déjà dans la liste.");
        r.fil = (this.fils.find((x) => x.repere === r.fil) || {}).id || "";
        this.filtre = "a-placer";
        return await this.creer("rumeur", r);
      }
      if (a === "installer") {
        b.disabled = true;
        b.textContent = "Installation…";
        const n = await this.kit.installerCampagneDuKit();
        toast(`Installé : ${n.contrats} affiches, ${n.rumeurs} rumeurs, ${n.fils} fils, ${n.pnj} habitués.`);
        return await this.demarrer();
      }
      const f = this.fiche;
      if (!f) return;
      if (b.dataset.etatAffiche) {
        if (f.etat === b.dataset.etatAffiche) return;
        f.etat = b.dataset.etatAffiche;
        this.modifies.add(`contrat:${f.id}`);
        this.afficherPlanche();
        this.afficherPanneau();
        await this.sauver.maintenant();
        return;
      }
      if (a === "fermer") return this.choisir(null, null);
      if (a === "montrer-contrat") {
        if (!SUR_LA_PLANCHE.has(f.etat)) {
          if (!(await demander({ titre: "Afficher sur la planche", texte: `« ${f.nom} » n'est pas sur la planche. L'y afficher et le montrer à la TV ?`, oui: "Afficher et montrer" }))) return;
          f.etat = "affiche";
          this.modifies.add(`contrat:${f.id}`);
          await this.sauver.maintenant();
          this.afficherPlanche();
        } else if (this.modifies.size) await this.sauver.maintenant();
        await this.montrerPlanche(f.id);
        return this.afficherPanneau();
      }
      if (a === "supprimer") {
        const genre = this.choix.genre;
        // Sans confirmation : ce qui attend part d'abord, puis « Annuler » dix secondes.
        await this.vider();
        await api.del(`/api/${genre === "contrat" ? "contrats" : "rumeurs"}/${f.id}`);
        this.modifies.delete(`${genre}:${f.id}`);
        if (genre === "contrat") this.contrats = this.contrats.filter((x) => x.id !== f.id);
        else this.rumeurs = this.rumeurs.filter((x) => x.id !== f.id);
        if (this.table?.contrat === f.id || this.table?.rumeur === f.id) await this.envoyer(genre === "contrat" ? { contrat: null } : { rumeur: null });
        this.choisir(null, null);
        annoncerCorbeille(genre === "contrat" ? `« ${f.nom || "Ce contrat"} » mis à la corbeille.` : "Rumeur mise à la corbeille.",
          genre === "contrat" ? "contrats" : "rumeurs", f.id, { retour: `#/auberge/${genre}/${f.id}` });
      }
    } catch (err) {
      toast(`Impossible : ${err.message}`, "erreur");
    }
  }
}
