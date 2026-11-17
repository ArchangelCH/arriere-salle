// La fiche d'un lieu qui n'est posé sur aucune carte : créé par « Nouveau lieu » ou en écrivant un scénario, ou venu d'une
// carte mise à la corbeille. Elle s'ouvre depuis les Lieux ou un lien de scénario, et se remplit ici : nom, genre, ce que
// savent les joueurs, les secrets, les notes, qui vit là et les scénarios qui le citent. « Poser sur une carte » l'y met,
// avec sa fiche telle quelle. Un lieu dont la carte existe s'ouvre directement sur elle.

import { api, copie, differer, echapper as e, enregistrerAvecVersion, toast } from "../api.js";
import { TYPES_LIEUX } from "../carte/biomes.js";
import { annoncerCorbeille, lienVersions } from "../corbeille/corbeille.js";
import { htmlRetour, monterMentions, oublierMentions, placeMentions } from "../liens/dans-les-scenarios.js";
import { Reessai } from "../commun/reessai.js";
import { afficherTemoin, htmlTemoin } from "../commun/temoin-enregistrement.js";
import { htmlPnjIci, monterPanneauLieu } from "./panneau-lieu.js";
import { figer, htmlAvisLectureSeule, htmlCasePartage, nomDeLAuteur, partageeParUnAutre } from "../mj/partage.js";

const ETIQUETTES = { officiel: "Officiel", "série": "Série", maison: "Maison" };

function ajuster(zone) {
  zone.style.height = "auto";
  zone.style.height = `${zone.scrollHeight + 2}px`;
}

export class FicheLieu {
  constructor(racine, { id }) {
    this.racine = racine;
    this.id = id;
    this.bases = {};
    this.modifie = false;
    this.chaine = Promise.resolve();
    this.sauver = differer(() => this.enregistrer(), 700);
    this.reessai = new Reessai(() => this.enregistrer(), () => this.etat(this.modifie ? "erreur" : "ok"));
  }

  async demarrer() {
    this.racine.innerHTML = `<section class="page-liste"><div class="chargement">Ouverture de la fiche…</div></section>`;
    let lieu;
    let cartes;
    let pnj;
    let plans;
    let lieux;
    try {
      [lieu, cartes, pnj, plans, lieux] = await Promise.all([api.get(`/api/lieux/${encodeURIComponent(this.id)}`), api.get("/api/cartes"),
        api.get("/api/pnj").catch(() => []), api.get("/api/plans?resume=1").catch(() => []), api.get("/api/lieux").catch(() => [])]);
    } catch (err) {
      if (this.detruit) return;
      const message = err.status === 404 ? "ce lieu n'existe plus (il est peut-être à la corbeille)" : err.message;
      this.racine.innerHTML = `<section class="page-liste"><p class="vide">Impossible d'ouvrir cette fiche : ${e(message)}. <a href="#/lieux">Tous les lieux</a></p></section>`;
      return;
    }
    if (this.detruit) return;
    // Ouverte par un ancien identifiant (le lieu a été renommé depuis, liens_fiches.py) : l'adresse prend le nouveau.
    if (lieu.id && lieu.id !== this.id) {
      if (location.hash.startsWith(`#/lieu/${this.id}`)) history.replaceState(null, "", `#/lieu/${lieu.id}`);
      this.id = lieu.id;
    }
    // Sa carte existe : la fiche complète est sur elle (un lien venu d'une carte jetée y mène après un déplacement). Un lieu
    // partagé par l'autre MJ se lit toujours ici : sa carte n'est pas partagée.
    if (lieu.carte && !partageeParUnAutre(lieu) && cartes.some((c) => c.id === lieu.carte)) {
      location.replace(`#/carte/${encodeURIComponent(lieu.carte)}?lieu=${encodeURIComponent(lieu.id)}`);
      return;
    }
    this.lieu = lieu;
    this.cartes = cartes;
    this.pnj = pnj;
    this.plans = plans;
    this.lieux = Object.fromEntries(lieux.map((l) => [l.id, l]));
    this.bases[lieu.id] = copie(lieu);
    this.afficher();
    const r = this.racine;
    r.addEventListener("submit", (ev) => {
      if (!ev.target.matches(".poser-lieu")) return;
      ev.preventDefault();
      const carte = ev.target.elements.carte.value;
      if (carte) location.hash = `#/carte/${encodeURIComponent(carte)}?poser=${encodeURIComponent(this.lieu.id)}`;
    });
    r.addEventListener("click", (ev) => {
      if (ev.target.closest('[data-action="supprimer-lieu"]') && !partageeParUnAutre(this.lieu)) this.supprimer();
    });
    r.addEventListener("input", (ev) => this.saisie(ev, false));
    r.addEventListener("change", (ev) => this.saisie(ev, true));
  }

  detruire() {
    this.detruit = true;
    return this.vider();
  }

  // Sans confirmation : le message qui suit porte « Annuler », et la corbeille garde la fiche.
  async supprimer() {
    const lieu = this.lieu;
    if (!lieu || this.supprime) return;
    this.supprime = true;
    try {
      await this.vider();
      await api.del(`/api/lieux/${encodeURIComponent(lieu.id)}`);
    } catch (err) {
      this.supprime = false;
      return toast(`Suppression impossible : ${err.message}`, "erreur");
    }
    this.modifie = false;
    this.sauver.annuler?.();
    annoncerCorbeille(`« ${lieu.nom || "Ce lieu"} » mis à la corbeille.`, "lieux", lieu.id, { retour: `#/lieu/${lieu.id}` });
    location.hash = "#/lieux";
  }

  vider() {
    if (this.modifie || this.sauver.enAttente()) this.sauver.maintenant();
    return this.chaine;
  }

  aEnregistrer() {
    return this.modifie || this.sauver.enAttente();
  }

  afficher() {
    const lieu = this.lieu;
    // Partagé par l'autre MJ : lu en entier, jamais modifié d'ici (ni posé, ni jeté, ni peuplé).
    const lecture = partageeParUnAutre(lieu);
    const pourquoi = lieu.carte ? "La carte où il était posé est à la corbeille." : "Il n'est posé sur aucune carte.";
    const plans = this.plans.filter((p) => p.lieu === lieu.id);
    this.racine.innerHTML = `
      <section class="page-liste fiche-lieu">
        ${htmlRetour("lieu", lieu.id)}
        <header class="titre-page">
          <p class="kicker"><a href="#/lieux">Les lieux</a></p>
          <div class="titre-avec-temoin">
            <input class="nom-lieu" type="text" value="${e(lieu.nom || "")}" data-l="nom" placeholder="Nom du lieu" aria-label="Nom du lieu">
            ${htmlTemoin()}
          </div>
          <p class="etiquettes">
            ${ETIQUETTES[lieu.etiquette] ? `<span class="etiquette etiquette-${e(lieu.etiquette.normalize("NFD").replace(/[̀-ͯ]/g, ""))}">${e(ETIQUETTES[lieu.etiquette])}</span>` : ""}
            ${lecture ? `<span class="pastille-partage">partagée par ${e(nomDeLAuteur(lieu))}</span>` : '<span class="etiquette sans-carte">sans carte</span>'}
          </p>
          ${lecture ? htmlAvisLectureSeule(lieu, "Cette fiche") : `<p class="chapo">${pourquoi} Sa fiche se tient ici, secrets et notes compris ; posez-le sur une carte pour le montrer à la table.</p>`}
        </header>
        <form class="bloc poser-lieu" ${lecture ? "hidden" : ""}>
          <h2>Poser sur une carte</h2>
          ${this.cartes.length ? `
          <p class="aide">Choisissez la carte, puis cliquez là où se trouve le lieu : il y retrouve sa fiche telle quelle.</p>
          <div class="poser-ligne">
            <label class="champ">Carte<select name="carte">${this.cartes.map((c) => `<option value="${e(c.id)}">${e(c.nom)}</option>`).join("")}</select></label>
            <button class="principal">Poser sur cette carte</button>
          </div>` : `<p class="vide">Aucune carte pour l'instant : créez-en une dans <a href="#/cartes">Cartes</a>.</p>`}
        </form>
        <div class="grille-fiche">
          <div class="bloc">
            <div class="ligne-lieu">
              <label class="champ">Genre<select data-l="type">${TYPES_LIEUX.map((t) => `<option value="${t.cle}" ${lieu.type === t.cle ? "selected" : ""}>${e(t.nom)}</option>`).join("")}</select></label>
            </div>
            <label class="case"><input type="checkbox" data-l="connu" ${lieu.connu ? "checked" : ""}> Connu des joueurs</label>
            ${htmlCasePartage(lieu, 'data-l="partage"')}
            ${lieu.illustration ? `<img class="illustration-lieu" src="${e(lieu.illustration)}" alt="">` : ""}
            <label class="champ">Ce que les joueurs en savent<textarea rows="4" data-l="resume">${e(lieu.resume || "")}</textarea></label>
            <label class="champ secret">Réservé au MJ<textarea rows="4" data-l="secrets">${e(lieu.secrets || "")}</textarea></label>
            <label class="champ">Notes<textarea rows="3" data-l="notes">${e(lieu.notes || "")}</textarea></label>
            ${lecture ? "" : `<p class="aide"><a class="lien-versions" href="${lienVersions("lieux", lieu.id, `#/lieu/${lieu.id}`)}">Versions précédentes de la fiche</a></p>
            <p class="aide"><button type="button" class="lien-danger" data-action="supprimer-lieu">Supprimer ce lieu</button> La fiche part à la corbeille ; « Annuler » la remet.</p>`}
          </div>
          <div class="bloc panneau-lieu-seul">
            ${htmlPnjIci(lieu, this.pnj)}
            ${plans.length ? `<h3>Plans intérieurs <span class="compte">${plans.length}</span></h3><ul class="liste-lieux">${plans.map((p) => `<li><a class="lien-carte" href="#/plan/${e(p.id)}">${e(p.nom)}</a></li>`).join("")}</ul>` : ""}
            ${placeMentions("lieux", lieu.id)}
          </div>
        </div>
      </section>`;
    this.racine.querySelectorAll("textarea").forEach(ajuster);
    this.etat(this.modifie ? "modifie" : "ok");
    if (lecture) return this.figerLaFiche();
    monterPanneauLieu(this.racine.querySelector(".panneau-lieu-seul"), {
      lieu, pnj: () => this.pnj, lieux: () => this.lieux, redessiner: () => this.redessinerPnj(),
    });
  }

  // Lecture seule : les champs figés, et dans « PNJ ici » seulement les liens vers les fiches (ni ajout, ni création).
  figerLaFiche() {
    const fiche = this.racine.querySelector(".fiche-lieu");
    figer(fiche, "");
    for (const el of fiche.querySelectorAll('.panneau-lieu-seul [data-pnj-ajouter], .panneau-lieu-seul a[href^="#/pnj/nouveau"], .panneau-lieu-seul .ajouter-pnj')) el.remove();
    monterMentions(fiche.querySelector(".panneau-lieu-seul"), "lieux", this.lieu.id);
  }

  // « Ajouter un PNJ » : seule la colonne de droite se redessine, la frappe en cours reste.
  redessinerPnj() {
    const zone = this.racine.querySelector(".panneau-lieu-seul");
    if (!zone || partageeParUnAutre(this.lieu)) return;
    const plans = this.plans.filter((p) => p.lieu === this.lieu.id);
    zone.innerHTML = `
            ${htmlPnjIci(this.lieu, this.pnj)}
            ${plans.length ? `<h3>Plans intérieurs <span class="compte">${plans.length}</span></h3><ul class="liste-lieux">${plans.map((p) => `<li><a class="lien-carte" href="#/plan/${e(p.id)}">${e(p.nom)}</a></li>`).join("")}</ul>` : ""}
            ${placeMentions("lieux", this.lieu.id)}`;
    monterPanneauLieu(zone, { lieu: this.lieu, pnj: () => this.pnj, lieux: () => this.lieux, redessiner: () => this.redessinerPnj() });
  }

  etat(etat) {
    afficherTemoin(this.detruit ? null : this.racine.querySelector(".temoin-enregistrement"), etat, { reessai: this.reessai, modifie: this.lieu?.modifie });
  }

  saisie(ev, change) {
    const el = ev.target;
    const champ = el.dataset.l;
    if (!champ || !this.lieu || partageeParUnAutre(this.lieu)) return;
    if (el.tagName === "TEXTAREA" && !change) ajuster(el);
    const discret = el.type === "checkbox" || el.tagName === "SELECT";
    // Le nom quitté : l'identifiant suit le nom tant que rien ne cite le lieu (liens_fiches.py).
    if (change && champ === "nom") this.suivreNom();
    if (discret !== change) return;
    this.lieu[champ] = el.type === "checkbox" ? el.checked : el.value;
    this.modifie = true;
    this.etat("modifie");
    this.sauver();
  }

  enregistrer() {
    this.chaine = this.chaine.then(() => this.ecrire());
    return this.chaine;
  }

  async ecrire() {
    if (!this.modifie) return;
    this.modifie = false;
    const lieu = this.lieu;
    const id = lieu.id;
    try {
      const fusion = await enregistrerAvecVersion(`/api/lieux/${encodeURIComponent(id)}`, lieu, this.bases, id);
      // Renommé depuis un autre écran : le serveur a suivi le renommage, la fiche prend son nouvel identifiant.
      if (this.bases[id]?.id && this.bases[id].id !== id) this.adopter(id, this.bases[id].id, this.bases[id]);
      this.reessai.reussite();
      if (!this.modifie) this.etat("ok");
      if (fusion && !this.detruit) toast(`« ${lieu.nom} » avait changé sur un autre écran : ses changements et les vôtres sont réunis.`);
    } catch (err) {
      this.modifie = true;
      this.reessai.echec(err);
      this.etat("erreur");
      this.reessai.signaler(err, `« ${lieu.nom} » non enregistré`);
    }
  }

  suivreNom() {
    this.chaine = this.chaine.then(async () => {
      // Le nom part d'abord : le serveur en tire l'identifiant. Ce qui sera tapé ensuite partira sous le nouveau.
      if (this.modifie) await this.ecrire();
      if (this.detruit) return;
      const ancien = this.lieu.id;
      let r;
      try {
        r = await api.post(`/api/lieux/${encodeURIComponent(ancien)}/identifiant`, {});
      } catch {
        return;
      }
      if (!r?.change || this.detruit) return;
      this.lieu.modifie = r.fiche.modifie;
      this.adopter(ancien, r.id, r.fiche);
    });
  }

  // Le lieu porte désormais un autre identifiant : renommé ici (suivreNom), ou sur un autre écran pendant que sa fiche
  // était ouverte ici (le serveur suit le renommage, liens_fiches.py).
  adopter(ancien, neuf, fiche) {
    if (!neuf || ancien === neuf) return;
    this.lieu.id = neuf;
    this.bases[neuf] = copie(fiche);
    delete this.bases[ancien];
    this.id = neuf;
    oublierMentions("lieux", ancien);
    if (this.detruit) return;
    if (location.hash.startsWith(`#/lieu/${ancien}`)) history.replaceState(null, "", `#/lieu/${neuf}`);
    const versions = this.racine.querySelector(".lien-versions");
    if (versions) versions.href = lienVersions("lieux", neuf, `#/lieu/${neuf}`);
    this.redessinerPnj();
  }
}
