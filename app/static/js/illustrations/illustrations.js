// Illustrations d'une fiche (lieu, PNJ ou aventurier) : galerie, consigne d'image écrite par le modèle de l'API (ou le
// modèle local), peinture par le serveur, import d'une image, envoi à la table. Un portrait suit la charte visuelle
// (charte.js), reçoit une mise en scène par variante et passe un contrôle automatique après la peinture.

import { api, echapper as e, erreurIA, toast } from "../api.js";
import { aCopier, demander } from "../commun/dialogue.js";
// La charte visuelle se règle au compte principal (PUT /api/charte-visuelle) : un MJ invité n'en a pas le bouton.
import { estInvite } from "../mj/role.js";

// Vignette WebP pour la galerie de l'atelier ; ailleurs (coin des joueurs, TV) l'adresse reste celle de l'original.
// Calcul en ligne : ce module est aussi servi au coin, qui n'a pas commun/miniature.js.
function miniatureGalerie(url) {
  const m = typeof url === "string" && document.body?.classList.contains("atelier") ? /^\/media\/([A-Za-z0-9][A-Za-z0-9._-]{0,120})$/.exec(url) : null;
  return m ? `/api/table/vignette/${m[1]}?l=320&f=webp` : url;
}

// Le presse-papiers moderne exige HTTPS ; sur le réseau local on passe par une zone de texte. Renvoie faux si le
// navigateur a refusé (Safari refuse une copie qui ne suit pas immédiatement un clic).
export function copier(texte) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(texte);
    return true;
  }
  const zone = document.createElement("textarea");
  zone.value = texte;
  zone.style.position = "fixed";
  zone.style.opacity = "0";
  document.body.append(zone);
  zone.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  zone.remove();
  return ok;
}

const FORMATS = [["paysage", "Paysage"], ["large", "Panoramique"], ["portrait", "Portrait"], ["carre", "Carré"]];

// Une image en plein écran note la vue qu'elle recouvre, pour y revenir (le plan, avec son cadrage). Par-dessus une
// autre vue plein écran ou une autre image, elle garde la vue que celle-ci avait notée.
const SANS_RETOUR = ["planche", "precedemment", "episode", "heros", "fiches", "image", "document"];
const VUE_AVANT = ["vue", "plan", "carte", "camera", "style", "version", "lieu", "url", "titre"];

// Une image que la TV montre en plein écran sans passer par une galerie (la planche d'un familier) : mêmes règles que
// « Plein écran » de la galerie, la vue recouverte est notée pour y revenir. Le nom de la fiche en légende.
export async function montrerImageTv(url, titre) {
  const etat = await api.get("/api/table");
  delete etat.ecrans;
  const avant = SANS_RETOUR.includes(etat.vue) ? etat.avant || null : Object.fromEntries(VUE_AVANT.map((k) => [k, etat[k] ?? null]));
  const r = await api.put("/api/table", { ...etat, vue: "image", url, titre: titre || "", avant, lieu: null, contrat: null });
  toast(r.ecrans ? "À la TV : l'image, en plein écran." : "Envoyé, mais aucun écran de table n'est branché.");
}

export async function retirerImageTv(url) {
  const etat = await api.get("/api/table");
  delete etat.ecrans;
  if (etat.vue === "image" && etat.url === url) {
    const avant = etat.avant && !SANS_RETOUR.includes(etat.avant.vue) ? etat.avant : { vue: "accueil" };
    await api.put("/api/table", { ...etat, ...avant, avant: null });
  }
  toast("Retiré de la TV : l'image.");
}

// « Femme (naine), d'âge mûr, contrebandière. Les sourcils brûlés… » : le modèle de langue en tire une consigne de portrait.
export function descriptionPnj(p) {
  const minuscule = (t) => (t ? `${t.charAt(0).toLowerCase()}${t.slice(1)}` : "");
  const qui = { h: "homme", f: "femme" }[p.genre] || "personnage";
  const debut = [`${qui}${p.peuple ? ` (${minuscule(p.peuple)})` : ""}`, p.age, minuscule(p.role)].filter(Boolean).join(", ");
  return [`${debut.charAt(0).toUpperCase()}${debut.slice(1)}`, p.apparence].filter(Boolean).join(". ");
}

export class Galerie {
  // cible : « lieu », « pnj » ou « aventurier » ; fiche() : la fiche affichée ; trouver(id) : une fiche chargée ;
  // rafraichir() : réaffiche le panneau ; zone() : l'élément qui contient la galerie ; decrire(fiche) : la description
  // de départ, en français.
  constructor({ cible, fiche, trouver, rafraichir, zone, apresTable, decrire }) {
    this.cible = cible;
    this.decrire = decrire;
    this.fiche = fiche;
    this.trouver = trouver;
    this.rafraichir = rafraichir;
    this.zone = zone;
    this.apresTable = apresTable;
    this.local = {};
    this.vus = new Set();
    this.file = null;
    // Préfixe et suffixe de style chargés d'avance : « Copier » doit copier pendant le clic, sans attendre le réseau.
    this.style = null;
    api.get(`/api/illustrations/style?genre=${this.genre}`).then((r) => (this.style = r)).catch(() => {});
    // L'image que montre la TV, d'après l'événement « etat-tv » du témoin de l'atelier (etat-tv.js, que ce module ne
    // peut pas importer : le coin des joueurs le charge aussi) : son bouton TV porte le liseré or et « À la TV ».
    this.urlTv = null;
    this.surTv = (ev) => {
      const t = ev.detail?.etat;
      const url = t && t.vue === "image" ? t.url || null : null;
      if (url === this.urlTv) return;
      this.urlTv = url;
      for (const b of this.zone?.()?.querySelectorAll('[data-action="ill-plein"]') || []) this.peindreTv(b);
    };
    document.addEventListener("etat-tv", this.surTv);
    document.dispatchEvent(new Event("etat-tv-demande"));
  }

  // Le bouton TV d'une image : liseré or tant que la TV la montre (un clic l'en retire), et « À la TV » sur l'image (la
  // légende n'a pas la place d'un mot de plus).
  peindreTv(b) {
    const ici = b.dataset.valeur === this.urlTv;
    b.classList.toggle("montree", ici);
    b.setAttribute("aria-pressed", String(ici));
    b.title = ici ? "La TV montre cette image : la retirer, elle revient à ce qu'elle montrait avant" : "Plein écran sur la TV";
    b.closest("figure")?.classList.toggle("tv-ici", ici);
  }

  get chemin() {
    return { pnj: "/api/pnj", aventurier: "/api/aventuriers" }[this.cible] || "/api/lieux";
  }

  get genre() {
    return this.cible === "lieu" ? "lieu" : "portrait";
  }

  // La description de départ, d'après la fiche : elle suit la fiche (genre, peuple, métier, apparence…) tant que le MJ ne
  // l'a pas retouchée à la main.
  descriptionDe(f) {
    return this.decrire ? this.decrire(f) : this.cible === "pnj" ? descriptionPnj(f) : f.resume || "";
  }

  etatLocal(f) {
    const l = (this.local[f.id] ||= {
      description: this.descriptionDe(f),
      retouchee: false,
      prompt: "",
      couleurs: "",
      negatif: "",
      reperes: [],
      format: this.genre === "portrait" ? "portrait" : "paysage",
      nombre: 2,
    });
    if (!l.retouchee) l.description = this.descriptionDe(f);
    return l;
  }

  // La fiche a changé (un champ de la page) : la description pas encore retouchée se récrit dans sa zone, sous les yeux.
  suivreFiche() {
    const f = this.fiche();
    const zone = f && this.zone?.()?.querySelector('[data-local="description"]');
    if (!zone || document.activeElement === zone) return;
    const l = this.etatLocal(f);
    if (!l.retouchee && zone.value !== l.description) zone.value = l.description;
  }

  html(f) {
    const ills = f.illustrations || [];
    const l = this.etatLocal(f);
    const pnj = this.genre === "portrait";
    return `
      <h3>${pnj ? "Portraits" : "Illustrations"} <span class="compte">${ills.length || ""}</span></h3>
      ${ills.length ? `<div class="galerie${pnj ? " portraits" : ""}">${ills.map((i) => `
        <figure class="${i.url === f.illustration ? "une" : ""}${i.controle && !i.controle.conforme ? " a-verifier" : ""}${i.url === this.urlTv ? " tv-ici" : ""}">
          <img src="${e(miniatureGalerie(i.url))}" alt="" loading="lazy" decoding="async">
          ${i.source === "joueur" ? `<p class="source-ill" title="Envoyé depuis le coin des joueurs, accepté par vous">Envoyé par ${e(i.joueur_nom || "son joueur")}</p>` : ""}
          ${i.controle && !i.controle.conforme ? `<p class="ecart-ill" title="Relevé par le contrôle automatique">À vérifier : ${e(i.controle.ecarts || "écart avec la description")}</p>` : ""}
          <figcaption>
            <button data-action="ill-une" data-valeur="${e(i.url)}" title="${pnj ? "Le portrait montré à la TV" : "L'illustration montrée avec le lieu"}">${i.url === f.illustration ? "À la une" : "Choisir"}</button>
            ${i.url === this.urlTv
              ? `<button class="montree" data-action="ill-plein" data-valeur="${e(i.url)}" aria-pressed="true" title="La TV montre cette image : la retirer, elle revient à ce qu'elle montrait avant">TV</button>`
              : `<button data-action="ill-plein" data-valeur="${e(i.url)}" aria-pressed="false" title="Plein écran sur la TV${this.secrete(f) ? " (sans légende : la fiche est secrète)" : ""}">TV</button>`}
            <button data-action="ill-retirer" data-valeur="${e(i.url)}" title="Retirer de la fiche">Retirer</button>
          </figcaption>
        </figure>`).join("")}</div>` : `<p class="aide">${pnj ? "Aucun portrait." : "Aucune illustration."} Décrivez ${pnj ? "le personnage" : "le lieu"}, l'atelier écrit la consigne d'image et la carte graphique du serveur la peint (environ une minute et demie par image).</p>`}
      <label class="champ">${pnj ? `À quoi ${f.genre === "f" ? "elle" : "il"} ressemble` : "Ce qu'on voit"}, en français<textarea rows="3" data-local="description">${e(l.description)}</textarea></label>
      ${pnj ? `<label class="champ">Couleurs imposées<input type="text" data-local="couleurs" value="${e(l.couleurs)}" placeholder="Vide : la charte et la description décident"></label>` : ""}
      <div class="actions"><button data-action="ill-prompt">Écrire la consigne</button>${pnj && !estInvite() ? `<button data-action="ill-charte" title="Peuples, Églises, ordres : leur allure, leurs couleurs, leurs interdits">Charte visuelle</button>` : ""}</div>
      ${pnj && l.reperes.length ? `<p class="aide reperes-ill">Charte appliquée : ${l.reperes.map(e).join(", ")}.</p>` : ""}
      <label class="champ">Consigne pour le peintre, en anglais<textarea rows="4" data-local="prompt" placeholder="Écrite par l'atelier, modifiable">${e(l.prompt)}</textarea></label>
      ${pnj ? `<label class="champ">À éviter, en anglais<textarea rows="2" data-local="negatif" placeholder="Écrit avec la consigne, modifiable">${e(l.negatif)}</textarea></label>` : ""}
      <div class="deux">
        <label class="champ">Format<select data-local="format">
          ${FORMATS.map(([v, n]) => `<option value="${v}" ${l.format === v ? "selected" : ""}>${n}</option>`).join("")}
        </select></label>
        <label class="champ">Variantes<select data-local="nombre">
          ${[1, 2, 3, 4].map((n) => `<option value="${n}" ${+l.nombre === n ? "selected" : ""}>${n}</option>`).join("")}
        </select></label>
      </div>
      <div class="actions">
        <button class="principal" data-action="ill-peindre">Peindre</button>
        <button data-action="ill-copier" title="Pour un générateur d'images extérieur">Copier la consigne</button>
        <label class="bouton">Importer<input type="file" accept="image/png,image/jpeg,image/webp" data-action="ill-importer" hidden></label>
      </div>
      <div class="file-ill" aria-live="polite">${this.etat(f.id)}</div>`;
  }

  etat(id) {
    const tous = this.file?.travaux || [];
    const travaux = tous.filter((t) => (t.cible || "lieu") === this.cible && (t.fiche || t.lieu) === id);
    const lignes = [];
    if (this.file && !this.file.moteur) lignes.push(`<p class="alerte">Le moteur d'images ne répond pas. La consigne à copier reste disponible.</p>`);
    const attente = tous.filter((t) => t.etat === "attente");
    for (const t of travaux) {
      const rang = attente.indexOf(t) + 1;
      if (t.etat === "attente") lignes.push(`<p>En attente, ${rang}<sup>${rang === 1 ? "re" : "e"}</sup> dans la file</p>`);
      if (t.etat === "en_cours") {
        const quoi = t.phase === "controle" ? "Vérification de l'image" : t.ecart ? `Nouvelle peinture (${e(t.ecart)})` : "Peinture en cours";
        lignes.push(`<p class="en-cours">${quoi}, ${Math.round(Date.now() / 1000 - t.debut)} s</p>`);
      }
      if (t.etat === "erreur") lignes.push(`<p class="alerte">Échec : ${e(t.erreur)}</p>`);
    }
    return lignes.join("");
  }

  arreter() {
    clearTimeout(this.minuterie);
    this.arrete = true;
    document.removeEventListener("etat-tv", this.surTv);
  }

  async suivre() {
    clearTimeout(this.minuterie);
    this.arrete = false;
    try {
      this.file = await api.get("/api/illustrations");
    } catch {
      this.file = null;
      // Serveur momentanément injoignable : on réessaie plus tard plutôt que d'abandonner le suivi.
      if (!this.arrete) this.minuterie = setTimeout(() => this.suivre(), 5000);
      return;
    }
    if (this.arrete) return;
    const courante = this.fiche();
    const zone = this.zone()?.querySelector(".file-ill");
    if (zone && courante) zone.innerHTML = this.etat(courante.id);
    for (const t of this.file.travaux) {
      if (t.etat !== "fini" || this.vus.has(t.id) || (t.cible || "lieu") !== this.cible) continue;
      const id = t.fiche || t.lieu;
      const f = this.trouver(id);
      if (!f) continue;
      try {
        const srv = await api.get(`${this.chemin}/${id}`);
        if (this.arrete) return;
        this.vus.add(t.id);
        this.reprendre(f, srv);
        if (courante && courante.id === id) this.rafraichir();
      } catch {
        // fiche supprimée entre-temps ou serveur injoignable : on la reprendra au passage suivant
      }
    }
    if (this.file.travaux.some((t) => t.etat === "attente" || t.etat === "en_cours")) this.minuterie = setTimeout(() => this.suivre(), 2500);
  }

  // Les illustrations ne changent pas la version de la fiche (le serveur les garde à part) : on ne reprend qu'elles,
  // jamais « modifie », sinon cet écran écraserait sans le savoir ce qu'un autre a enregistré entre-temps.
  reprendre(f, srv) {
    f.illustrations = srv.illustrations;
    f.illustration = srv.illustration;
  }

  // Un lieu ou un PNJ que les joueurs ne connaissent pas : son nom ne part pas avec l'image.
  secrete(f) {
    return this.cible !== "aventurier" && !f.connu;
  }

  saisie(el) {
    const f = this.fiche();
    if (!f) return;
    const l = this.etatLocal(f);
    l[el.dataset.local] = el.value;
    if (el.dataset.local === "description") l.retouchee = el.value !== this.descriptionDe(f);
  }

  async action(a, valeur, bouton) {
    const f = this.fiche();
    if (!f) return;
    const l = this.etatLocal(f);
    const maj = (srv) => {
      this.reprendre(f, srv);
      this.rafraichir();
    };
    try {
      if (a === "ill-prompt") {
        if (!l.description.trim()) return toast("Décrivez d'abord ce qu'on voit.");
        bouton.disabled = true;
        bouton.textContent = "Écriture…";
        const r = await api.post("/api/illustrations/prompt", { description: l.description, genre: this.genre, couleurs: l.couleurs })
          .catch((err) => {
            throw new Error(`Consigne non écrite : ${erreurIA(err, "écrivez-la vous-même en anglais, dans le champ ci-dessous")}.`);
          });
        l.prompt = r.prompt;
        if (this.genre === "portrait") Object.assign(l, { negatif: r.negatif || "", reperes: r.reperes || [] });
        this.rafraichir();
      } else if (a === "ill-peindre") {
        if (!l.prompt.trim()) return toast("Écrivez d'abord la consigne.");
        await api.post("/api/illustrations", {
          cible: this.cible, fiche: f.id, prompt: l.prompt, format: l.format, nombre: +l.nombre, description: l.description,
          ...(this.genre === "portrait" ? { negatif: l.negatif, couleurs: l.couleurs } : {}),
        });
        toast(+l.nombre > 1 ? `${l.nombre} images commandées.` : "Image commandée.");
        this.suivre();
      } else if (a === "ill-copier") {
        const r = this.style;
        const texte = [r?.prefixe, l.prompt || l.description, r?.suffixe].filter(Boolean).join(", ") + (l.negatif ? `. Avoid: ${l.negatif}` : "");
        if (copier(texte)) toast("Consigne copiée : collez-la dans votre générateur d'images.");
        else await aCopier({ titre: "Copier la consigne", texte: "À coller dans votre générateur d'images.", valeur: texte, copie: "Consigne copiée." });
      } else if (a === "ill-charte") {
        // Chargée au premier clic : le coin des joueurs sert ce module sans la charte (réservée au MJ).
        (await import("./charte.js")).ouvrirCharte();
      } else if (a === "ill-une") {
        maj(await api.put(`${this.chemin}/${f.id}/illustration`, { url: valeur }));
      } else if (a === "ill-retirer") {
        if (await demander({ titre: "Retirer cette image de la fiche ?", texte: `Elle quitte la galerie de « ${f.nom || "cette fiche"} ».`, oui: "Retirer", non: "La garder" })) {
          maj(await api.del(`${this.chemin}/${f.id}/illustrations?url=${encodeURIComponent(valeur)}`));
        }
      } else if (a === "ill-plein" && valeur === this.urlTv) {
        // Déjà à la TV : elle revient à la vue que l'image recouvrait.
        const etat = await api.get("/api/table");
        delete etat.ecrans;
        if (etat.vue === "image" && etat.url === valeur) {
          const avant = etat.avant && !SANS_RETOUR.includes(etat.avant.vue) ? etat.avant : { vue: "accueil" };
          const r = await api.put("/api/table", { ...etat, ...avant, avant: null });
          this.apresTable?.(r);
        }
        toast("Retiré de la TV : l'image.");
      } else if (a === "ill-plein") {
        const secrete = this.secrete(f);
        if (secrete && !(await demander({ titre: "Montrer l'image sans son nom ?", texte: `« ${f.nom} » est encore secret pour les joueurs : la TV montre l'image seule.`, oui: "Montrer sans le nom", non: "Ne pas montrer" }))) return;
        // Les cartons posés (PNJ, rumeur, aventurier) restent ; seuls l'image et le nom de la fiche s'ajoutent, jamais le lieu.
        const etat = await api.get("/api/table");
        delete etat.ecrans;
        const avant = SANS_RETOUR.includes(etat.vue) ? etat.avant || null : Object.fromEntries(VUE_AVANT.map((k) => [k, etat[k] ?? null]));
        const r = await api.put("/api/table", { ...etat, vue: "image", url: valeur, titre: secrete ? "" : f.nom, avant, lieu: null, contrat: null });
        this.apresTable?.(r);
        toast(r.ecrans ? "À la TV : l'image, en plein écran." : "Envoyé, mais aucun écran de table n'est branché.");
      }
    } catch (err) {
      toast(err.message, "erreur");
      if (bouton) this.rafraichir();
    }
  }

  async importer(fichier) {
    const f = this.fiche();
    if (!f || !fichier) return;
    const donnees = new FormData();
    donnees.append("image", fichier);
    try {
      const { url } = await api.post("/api/images", donnees);
      const srv = await api.post(`${this.chemin}/${f.id}/illustrations`, { url, source: "import" });
      this.reprendre(f, srv);
      this.rafraichir();
      toast("Image ajoutée.");
    } catch (err) {
      toast(`Import impossible : ${err.message}`, "erreur");
    }
  }
}
