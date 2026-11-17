// Les documents remis aux joueurs : une lettre trouvée sur un cadavre, une affiche arrachée, une note griffonnée, un
// parchemin officiel, un plan. La liste à gauche, la fiche à droite comme le carnet des PNJ ; la fiche s'enregistre à la
// frappe, avec sa version, et montre le document tel que la TV le dessinera (rendu.js). « Montrer à la TV » passe par la
// question des noms inconnus (tv.js) ; « Imprimer » ouvre la page à tendre en main propre. Une fois montré à la TV, il
// entre dans le carnet des joueurs, sauf si « Garder dans le carnet » est décoché. Les notes du MJ ne sortent jamais.
// « Remettre à… » (lot F2, prives/telephone.js) le fait parvenir au seul téléphone d'un héros, sans la TV ni le carnet.

import { api, copie, differer, echapper as e, enregistrerAvecVersion, toast } from "../api.js";
import { BoutonTv } from "../ecran-tv/bouton-tv.js";
import { annoncerCorbeille, lienVersions } from "../corbeille/corbeille.js";
import { ecouterTv } from "../ecran-tv/etat-tv.js";
import { Reessai } from "../commun/reessai.js";
import { liensDe } from "../seances/liens-scene.js";
import { nomDeScene } from "../seances/sous-la-main.js";
import { afficherTemoin, htmlTemoin } from "../commun/temoin-enregistrement.js";
import { GestesPrives, ecouterEtatPrives, htmlDocumentTelephone } from "../prives/telephone.js";
import { GENRES_DOCUMENT, ajusterDocument, genreDocument, htmlDocument, imagesPretes, sceauDe, titreSurLePapier } from "./rendu.js";
import { montrerDocument, nomDuDocument, retirerDocument, suivreALaTv } from "./tv.js";

// La feuille du papier (partagée avec la TV, la page imprimée et le carnet) et celle de la page, liées une fois.
for (const href of ["/static/css/documents.css", "/static/css/documents-atelier.css"]) {
  if (!document.querySelector(`link[href="${href}"]`)) {
    const lien = document.createElement("link");
    lien.rel = "stylesheet";
    lien.href = href;
    document.head.append(lien);
  }
}

const forme = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const jourCourt = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-CH", { day: "numeric", month: "long" }).replace(/^1 /, "1er ");
};

// Ce que disent les genres dans la fiche : le titre se lit sur le papier, ou en légende dessous.
const AIDE_TITRE = {
  lettre: "Une lettre ne porte pas de titre : à la TV, il la légende, sous le papier.",
  note: "Une note ne porte pas de titre : à la TV, il la légende, sous le papier.",
  affiche: "Écrit en tête de l'affiche, en grandes lettres.",
  parchemin: "Écrit en tête du parchemin, en capitales ornées.",
  plan: "Griffonné en haut du plan.",
};

function ajuster(zone) {
  zone.style.height = "auto";
  zone.style.height = `${zone.scrollHeight + 2}px`;
}

export class Documents {
  constructor(racine, { id }) {
    this.racine = racine;
    this.idDemande = id;
    this.documents = [];
    this.seances = [];
    this.fiche = null;
    this.modifies = new Set();
    this.sauver = differer(() => this.enregistrer(), 700);
    this.chaine = Promise.resolve();
    this.envois = 0;
    this.bases = {};
    // Serveur injoignable : les fiches qui ne sont pas parties repartent seules (3 s, 10 s, puis toutes les 30 s).
    this.reessai = new Reessai(() => this.enregistrer(), () => {
      if (this.etatAffiche === "erreur") this.etat("erreur");
    });
    this.boutonTv = new BoutonTv({
      estIci: (t) => Boolean(this.fiche) && t.vue === "document" && t.document === this.fiche.id,
      montrer: () => this.table(true),
      retirer: () => this.table(false),
      titre: "Le document en grand sur la TV, sans vos notes ; il entre ensuite dans le carnet des joueurs",
      titreIci: "La TV montre ce document : le retirer, la TV revient à ce qu'elle montrait avant",
    });
    this.docTv = null;
    this.finTv = ecouterTv((t) => {
      const ici = t.vue === "document" ? t.document || null : null;
      if (ici === this.docTv) return;
      this.docTv = ici;
      // Montré à l'instant : la date de la première fois arrive du serveur (le carnet le reçoit).
      if (ici) this.relireMontre(ici);
      if (this.racine.querySelector(".liste-documents")) this.afficherListe();
    });
    this.apercuPrevu = 0;
    // Le téléphone d'un héros : la fiche s'enregistre d'abord, le serveur la lit sur le disque.
    this.telephone = new GestesPrives({ avant: async () => {
      if (this.modifies.size || this.sauver.enAttente()) await this.sauver.maintenant();
      return !this.modifies.size;
    } });
  }

  async demarrer() {
    const [documents, seances] = await Promise.all([api.get("/api/documents"), api.get("/api/seances").catch(() => [])]);
    if (this.detruit) return;
    [this.documents, this.seances] = [documents, seances];
    for (const d of this.documents) this.bases[d.id] = copie(d);
    this.racine.innerHTML = this.gabarit();
    this.lier();
    this.afficherListe();
    this.ouvrir(this.documents.find((d) => d.id === this.idDemande) || null);
    if (this.idDemande && !this.fiche) history.replaceState(null, "", "#/documents");
    this.finTelephone = ecouterEtatPrives(() => this.majTelephone());
  }

  // « Remis à Isaure à 21 h 02 · lu à 21 h 04 », et « Remettre à… » : redessiné à chaque envoi ou lecture, sauf ouvert.
  majTelephone() {
    const zone = this.racine.querySelector(".fiche-document .tel-document");
    if (!this.fiche || !zone || zone.querySelector("details[open]")) return;
    zone.outerHTML = htmlDocumentTelephone(this.fiche);
  }

  detruire() {
    this.detruit = true;
    this.boutonTv.detruire();
    this.finTv();
    this.finTelephone?.();
    window.removeEventListener("resize", this.surTaille);
    cancelAnimationFrame(this.apercuPrevu);
    return this.vider();
  }

  vider() {
    if (this.modifies.size) this.sauver.maintenant();
    return this.chaine;
  }

  aEnregistrer() {
    return this.modifies.size > 0 || this.sauver.enAttente() || this.envois > 0;
  }

  gabarit() {
    return `
    <section class="carnet documents-atelier">
      <aside class="carnet-liste">
        <header>
          <p class="kicker">À remettre aux joueurs</p>
          <h1>Les documents</h1>
          <div class="tirages"><button class="principal" data-action="nouveau">Nouveau document</button></div>
          <input type="search" class="recherche" placeholder="Titre, texte, signature…" aria-label="Chercher un document">
        </header>
        <ul class="liste-documents"></ul>
        <p class="legende"><span class="jamais-montre" aria-hidden="true"></span>jamais montré : ni la TV, ni le carnet ne l'ont vu</p>
      </aside>
      <article class="carnet-fiche fiche-document"></article>
    </section>`;
  }

  lier() {
    const r = this.racine;
    r.querySelector(".carnet-liste header").addEventListener("click", (ev) => {
      if (ev.target.closest('[data-action="nouveau"]')) this.nouveau();
    });
    r.querySelector(".recherche").addEventListener("input", () => this.afficherListe());
    r.querySelector(".liste-documents").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-document]");
      if (b) {
        history.replaceState(null, "", `#/documents/${b.dataset.document}`);
        this.ouvrir(this.documents.find((d) => d.id === b.dataset.document));
        if (matchMedia("(max-width: 900px)").matches) r.querySelector(".fiche-document")?.scrollIntoView({ block: "start" });
      }
      if (ev.target.closest('[data-action="nouveau"]')) this.nouveau();
    });
    const fiche = r.querySelector(".fiche-document");
    fiche.addEventListener("input", (ev) => this.saisie(ev, false));
    fiche.addEventListener("change", (ev) => this.saisie(ev, true));
    fiche.addEventListener("click", (ev) => this.clic(ev));
    window.addEventListener("resize", this.surTaille = () => this.apercu());
  }

  afficherListe() {
    const q = forme(this.racine.querySelector(".recherche").value.trim());
    const mots = q.split(/\s+/).filter(Boolean);
    const liste = this.documents
      .filter((d) => mots.every((m) => forme([d.nom, d.texte, d.signature, d.notes_mj, genreDocument(d).nom].join(" ")).includes(m)))
      .sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));
    const ul = this.racine.querySelector(".liste-documents");
    if (!this.documents.length) {
      ul.innerHTML = `<li class="vide">Aucun document pour l'instant.<button class="principal" data-action="nouveau">Écrire le premier</button>
        <span class="aide">Une lettre trouvée sur un cadavre, une affiche arrachée, un plan griffonné : montrés à la TV, imprimés pour les tendre, puis gardés dans le carnet des joueurs.</span></li>`;
      return;
    }
    ul.innerHTML = liste.map((d) => `
      <li><button data-document="${e(d.id)}" aria-current="${this.fiche?.id === d.id}">
        <span class="genre-mini genre-${e(genreDocument(d).cle)}" aria-hidden="true"></span>
        <span class="texte">
          <span class="nom">${e(nomDuDocument(d))}</span>
          <span class="meta">${e(genreDocument(d).court)}${d.montre ? ` · montré le ${e(jourCourt(d.montre))}` : ""}</span>
        </span>
        ${d.id === this.docTv ? '<span class="a-la-tv" title="La TV le montre">à la TV</span>' : ""}
        ${d.montre ? "" : '<span class="jamais-montre" title="Jamais montré à la TV" aria-label="Jamais montré à la TV"></span>'}
      </button></li>`).join("") || '<li class="vide">Aucun document ne correspond.</li>';
  }

  ouvrir(d) {
    if (this.modifies.size) this.sauver.maintenant();
    this.fiche = d || null;
    this.afficherFiche();
    this.afficherListe();
  }

  // Les séances qui le prévoient : une scène qui le lie, ou « Sous la main ».
  dansLesSeances(d) {
    const lignes = [];
    for (const s of this.seances) {
      const nom = [`Séance ${s.numero ?? "?"}`, s.nom].filter(Boolean).join(" · ");
      (s.deroule || []).forEach((x, i) => {
        if (liensDe(x).documents.includes(d.id)) lignes.push({ s, texte: `${nom}, par la scène ${nomDeScene(x, i)}` });
      });
      if ((s.documents || []).includes(d.id)) lignes.push({ s, texte: `${nom}, sous la main` });
    }
    return lignes;
  }

  afficherFiche() {
    const zone = this.racine.querySelector(".fiche-document");
    const d = this.fiche;
    if (!d) {
      zone.innerHTML = `<div class="fiche-vide"><p>Choisissez un document dans la liste, ou écrivez-en un nouveau.</p><p class="aide">Liez-le ensuite à une scène dans Séances, à l'onglet Préparer (« Lier ») : au moment de la jouer, « Montrer à la TV » vous attend sous la scène.</p></div>`;
      return;
    }
    const g = genreDocument(d).cle;
    const seances = this.dansLesSeances(d);
    zone.innerHTML = `
      <div class="tete-document">
        <div class="avec-de ligne-nom">
          <input class="nom" type="text" value="${e(d.nom || "")}" data-champ="nom" placeholder="Titre du document" aria-label="Titre du document">
          ${htmlTemoin()}
        </div>
        <p class="aide aide-titre">${e(AIDE_TITRE[g])}</p>
        <div class="genres-document" role="radiogroup" aria-label="Genre du document">
          ${GENRES_DOCUMENT.map((x) => `<label class="genre-document${x.cle === g ? " choisi" : ""}"><input type="radio" name="genre-document" value="${x.cle}" data-champ="genre" ${x.cle === g ? "checked" : ""}><span class="genre-mini genre-${x.cle}" aria-hidden="true"></span>${e(x.nom)}</label>`).join("")}
        </div>
      </div>
      <div class="corps-document">
        <section class="ecrire-document">
          <h2>Ce que lisent les joueurs</h2>
          <label class="champ">Texte<textarea rows="8" data-champ="texte" placeholder="« Frère, si tu lis ceci… » Une ligne vide sépare deux paragraphes.">${e(d.texte || "")}</textarea></label>
          <label class="champ">Signature<input type="text" value="${e(d.signature || "")}" data-champ="signature" placeholder="aucune"></label>
          <div class="champ image-document"><span>Image</span>
            <div class="image-ligne">
              ${d.image ? `<img src="${e(d.image)}" alt="">` : ""}
              <label class="bouton">${d.image ? "Changer l'image" : "Choisir une image"}<input type="file" accept="image/*" data-action="image" hidden></label>
              ${d.image ? '<button type="button" data-action="image-retirer">Retirer l\'image</button>' : ""}
            </div>
          </div>
          <label class="case"><input type="checkbox" data-champ="sceau" ${sceauDe(d) ? "checked" : ""}> Un sceau de cire</label>
          <h2>Pour vous seul</h2>
          <label class="champ secret">Notes du MJ<textarea rows="3" data-champ="notes_mj" placeholder="Qui l'a écrit, ce que les joueurs peuvent en tirer. Jamais montré.">${e(d.notes_mj || "")}</textarea></label>
          <label class="case"><input type="checkbox" data-champ="dans_le_carnet" ${d.dans_le_carnet === false ? "" : "checked"}> Garder dans le carnet</label>
          <p class="aide aide-carnet">${this.phraseCarnet(d)}</p>
          ${seances.length ? `<p class="aide dans-les-seances">Prévu : ${seances.map((x) => `<a href="#/seances/${e(x.s.id)}">${e(x.texte)}</a>`).join(" ; ")}.</p>` : '<p class="aide dans-les-seances">Aucune séance ne le prévoit encore : liez-le à une scène dans Séances › Préparer.</p>'}
          <h2>Sur un seul téléphone</h2>
          ${htmlDocumentTelephone(d)}
        </section>
        <section class="apercu-document">
          <div class="entete-apercu">
            <h2>Tel qu'à la TV</h2>
            <a class="bouton" href="/document-imprime?id=${e(encodeURIComponent(d.id))}" target="_blank" rel="noopener" title="Une page sur parchemin, en A5 ou en A4, à tendre en main propre">Imprimer</a>
          </div>
          <div class="table-apercu"><div class="papier-apercu"></div><p class="legende-apercu"></p></div>
        </section>
      </div>
      <div class="actions pied-fiche"><button class="danger" data-action="supprimer">Mettre à la corbeille</button>
        <a class="lien-versions" href="${lienVersions("documents", d.id, `#/documents/${d.id}`)}">Versions précédentes</a></div>`;
    zone.prepend(this.boutonTv.cadre);
    this.boutonTv.maj();
    zone.querySelectorAll("textarea").forEach(ajuster);
    this.apercu();
    this.etat(!this.modifies.has(d.id) ? "ok" : this.reessai.actif ? "erreur" : "modifie");
  }

  phraseCarnet(d) {
    if (d.dans_le_carnet === false) return "Il ne paraîtra pas dans « Documents reçus », même montré à la TV.";
    return d.montre ? `Montré à la TV le ${e(jourCourt(d.montre))} : il est dans « Documents reçus » du carnet des joueurs.`
      : "Une fois montré à la TV, il entre dans « Documents reçus » du carnet des joueurs, pour le relire entre deux séances.";
  }

  // L'aperçu se redessine à la frappe, une fois par image, à la taille qui tient dans son cadre.
  apercu() {
    cancelAnimationFrame(this.apercuPrevu);
    this.apercuPrevu = requestAnimationFrame(async () => {
      const d = this.fiche;
      const papier = this.racine.querySelector(".papier-apercu");
      if (!d || !papier) return;
      papier.innerHTML = htmlDocument(d);
      this.racine.querySelector(".legende-apercu").textContent = titreSurLePapier(d) ? "" : String(d.nom || "").trim();
      await imagesPretes(papier, 2000);
      const article = papier.querySelector(".document");
      const cadre = papier.parentElement;
      if (!article || this.fiche !== d) return;
      ajusterDocument(article, cadre.clientWidth - 48, Math.max(320, window.innerHeight * 0.62), { depart: 17, min: 7 });
    });
  }

  etat(x) {
    this.etatAffiche = x;
    afficherTemoin(this.detruit ? null : this.racine.querySelector(".fiche-document .temoin-enregistrement"), x, { reessai: this.reessai, modifie: this.fiche?.modifie });
  }

  saisie(ev, change) {
    const el = ev.target;
    const d = this.fiche;
    if (!d) return;
    if (el.dataset.action === "image") {
      if (change && el.files?.[0]) this.televerser(el.files[0]);
      return;
    }
    if (!el.dataset.champ) return;
    const discret = el.type === "checkbox" || el.type === "radio";
    if (el.tagName === "TEXTAREA" && !change) ajuster(el);
    if (discret !== change) return;
    const champ = el.dataset.champ;
    d[champ] = el.type === "checkbox" ? el.checked : el.value;
    this.modifies.add(d.id);
    this.etat("modifie");
    this.sauver();
    if (champ === "genre") {
      // Le parchemin porte son sceau ; les autres n'en ont pas, tant que le MJ n'a rien choisi.
      if (typeof d.sceau !== "boolean") this.racine.querySelector('[data-champ="sceau"]').checked = sceauDe(d);
      this.racine.querySelectorAll(".genre-document").forEach((l) => l.classList.toggle("choisi", l.querySelector("input").checked));
      this.racine.querySelector(".aide-titre").textContent = AIDE_TITRE[genreDocument(d).cle];
    }
    if (champ === "dans_le_carnet") this.racine.querySelector(".aide-carnet").innerHTML = this.phraseCarnet(d);
    if (champ === "nom" || champ === "genre") this.afficherListe();
    if (champ !== "notes_mj" && champ !== "dans_le_carnet") this.apercu();
  }

  async televerser(fichier) {
    const d = this.fiche;
    const donnees = new FormData();
    donnees.append("image", fichier);
    try {
      const { url } = await api.post("/api/images", donnees);
      d.image = url;
      this.modifies.add(d.id);
      this.sauver();
      if (this.fiche === d) this.afficherFiche();
    } catch (err) {
      toast(`Image refusée : ${err.message}`, "erreur");
    }
  }

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
      const d = this.documents.find((x) => x.id === id);
      if (!d) continue;
      try {
        const fusion = await enregistrerAvecVersion(`/api/documents/${id}`, d, this.bases, id);
        // Le champ « montre » ne s'écrit que par le serveur : la fiche garde celui qu'il a.
        d.montre = this.bases[id]?.montre ?? d.montre;
        if (this.fiche?.id === d.id && !this.modifies.has(d.id)) this.etat("ok");
        if (fusion && !this.detruit) toast(`« ${nomDuDocument(d)} » avait été modifié sur un autre écran : ses changements et les vôtres sont réunis.`);
        // Retouché pendant que la TV le montre : elle le relit.
        if (this.docTv === d.id) suivreALaTv(d).catch(() => {});
      } catch (err) {
        erreurs.push(err);
        this.modifies.add(d.id);
        this.reessai.signaler(err, `« ${nomDuDocument(d)} » non enregistré`);
      }
    }
    if (!ids.length) return;
    this.reessai.bilan(erreurs);
    if (erreurs.length) this.etat("erreur");
  }

  // La TV vient de le montrer : la date de la première fois, posée par le serveur, sans toucher au reste de la fiche.
  async relireMontre(id) {
    const d = this.documents.find((x) => x.id === id);
    if (!d || d.montre) return;
    try {
      const frais = await api.get(`/api/documents/${encodeURIComponent(id)}`);
      d.montre = frais.montre || null;
      if (this.bases[id]) this.bases[id].montre = d.montre;
    } catch {
      return;
    }
    if (this.detruit) return;
    this.afficherListe();
    if (this.fiche === d) {
      const aide = this.racine.querySelector(".aide-carnet");
      if (aide) aide.innerHTML = this.phraseCarnet(d);
    }
  }

  async nouveau() {
    try {
      const d = await api.post("/api/documents", { nom: "", genre: "lettre", texte: "", signature: "", notes_mj: "", dans_le_carnet: true });
      this.bases[d.id] = copie(d);
      this.documents.push(d);
      history.replaceState(null, "", `#/documents/${d.id}`);
      this.ouvrir(d);
      this.racine.querySelector(".fiche-document .nom")?.focus();
    } catch (err) {
      toast(`Création impossible : ${err.message}`, "erreur");
    }
  }

  async clic(ev) {
    const b = ev.target.closest("button");
    const d = this.fiche;
    if (!b || !d) return;
    if (this.telephone.clic(b)) return;
    const a = b.dataset.action;
    if (a === "image-retirer") {
      d.image = "";
      this.modifies.add(d.id);
      this.sauver();
      return this.afficherFiche();
    }
    if (a === "supprimer") {
      // Sans confirmation : ce qui attend part d'abord (la fiche revient entière), puis « Annuler » dix secondes.
      await this.vider();
      try {
        if (this.docTv === d.id) await retirerDocument(d);
        await api.del(`/api/documents/${d.id}`);
      } catch (err) {
        return toast(`Suppression impossible : ${err.message}`, "erreur");
      }
      this.documents = this.documents.filter((x) => x.id !== d.id);
      this.modifies.delete(d.id);
      history.replaceState(null, "", "#/documents");
      this.ouvrir(null);
      annoncerCorbeille(`« ${nomDuDocument(d)} » mis à la corbeille.`, "documents", d.id, { retour: `#/documents/${d.id}` });
    }
  }

  // La fiche enregistrée est celle que lira la TV : ce qu'elle nomme d'inconnu se vérifie sur elle.
  async table(montrer) {
    const d = this.fiche;
    if (!d) return;
    if (this.modifies.size || this.sauver.enAttente()) await this.sauver.maintenant();
    await (montrer ? montrerDocument(d) : retirerDocument(d));
  }
}
