// Le portrait de son héros, dans le coin des joueurs : « Changer de portrait » sous le portrait, dans l'onglet
// « Héros » (heros-coin.js) et dans « Mon héros » du carnet (carnet.js). Deux façons :
// - choisir parmi les portraits que le MJ a fait peindre pour ce héros (POST /api/demandes, genre « portrait-choisi ») :
//   l'atelier l'applique seul, la TV le montre, le MJ peut l'annuler ;
// - envoyer sa propre image (POST /api/portraits/envoi) : le joueur la cadre au format portrait (un doigt la place, le
//   curseur la rapproche), la page en fait un JPEG, et le MJ l'accepte ou la refuse dans sa boîte.
// Tout se relit par GET /api/portraits, quand le flux le dit (« portraits », « demandes », « pause »). Le bloc est un seul
// élément, déplacé d'une page dessinée à la suivante : un cadrage en cours ne se perd pas quand le carnet se redessine.
// Tout texte passe par echapper.

import { echapper as e } from "../api.js";
import { dateFr, demander, heureFr } from "./carnet-vue.js";
import { ecouterFlux } from "./flux.js";

const TYPES = ["image/jpeg", "image/png", "image/webp"];
const SORTIE = 900; // pixels de large du portrait envoyé, au plus (le serveur le réécrit de toute façon)
const ZOOM_MAX = 4;
const quand = (iso) => [dateFr(iso, { jour: false }), heureFr(iso)].filter(Boolean).join(" à ");
const prenom = (nom) => String(nom || "").split(/[\s,]+/)[0] || "votre héros";
const accord = (genre, h, f) => (genre === "f" ? f : h);

// La dernière réponse de /api/portraits, partagée par les blocs et la page Table de cette page.
let dernier = null;
let lecture = null;
const suiveurs = new Set();

export function lirePortraits() {
  lecture ||= demander("GET", "/api/portraits").then((r) => {
    dernier = r;
    for (const fn of [...suiveurs]) fn(r);
    return r;
  }).finally(() => {
    lecture = null;
  });
  return lecture;
}

// Les sujets du flux déjà écoutés : la page Table ne suit que ses portraits, le bloc aussi ses demandes et la pause.
const ecoutes = new Set();
function ecouter(sujets) {
  for (const sujet of sujets) {
    if (ecoutes.has(sujet)) continue;
    ecoutes.add(sujet);
    ecouterFlux(sujet, () => lirePortraits().catch(() => {}));
  }
}

// fn(adresse du portrait du moment, ou null) à chaque changement : la page Table en fait la pastille de son héros.
export function suivreMonPortrait(fn) {
  let avant;
  const suivre = (r) => {
    const url = r?.actuel || null;
    if (url === avant) return;
    avant = url;
    fn(url);
  };
  suiveurs.add(suivre);
  ecouter(["portraits"]);
  if (dernier) suivre(dernier);
  else lirePortraits().catch(() => {});
}

// Carnet fermé : une petite carte sous la page « Le carnet est fermé », le portrait et le chemin vers l'onglet Héros. Une
// seule carte par page, reposée à chaque dessin.
let carteFerme = null;
export function poserPortraitFerme(conteneur) {
  if (!conteneur) return;
  if (!carteFerme) {
    carteFerme = document.createElement("p");
    carteFerme.className = "portrait-ferme";
    carteFerme.hidden = true;
    suivreMonPortrait((url) => {
      const h = dernier?.heros;
      carteFerme.hidden = !h;
      if (!h) return;
      carteFerme.innerHTML = `<a href="/"><span class="medaillon${url ? "" : " sans-image"}" data-image>${url ? `<img src="${e(url)}" alt="">` : ""}<span class="monogramme" aria-hidden="true">${e(prenom(h.nom).charAt(0) || "?")}</span></span>
        <span><b>${e(h.nom || "Votre héros")}</b><i>Son portrait et « Changer de portrait » restent dans l'onglet Héros, carnet fermé aussi.</i></span></a>`;
    });
  }
  conteneur.append(carteFerme);
}

export class MonPortrait {
  // surEtat(r) : à chaque lecture (la page qui montre le portrait en grand le change).
  constructor({ surEtat = null } = {}) {
    this.surEtat = surEtat;
    this.etat = null;
    this.choisi = null; // le nom de la miniature touchée, pas encore prise
    this.ouvert = false;
    this.envoi = false;
    this.cadre = null; // { url, fichier, img, l, h, s0, zoom, ox, oy }
    this.racine = document.createElement("div");
    this.racine.className = "portrait-joueur";
    this.racine.innerHTML = `
      <button type="button" class="secondaire changer-portrait" aria-expanded="false" data-ouvrir>Changer de portrait</button>
      <div class="panneau-portrait" hidden>
        <p class="pause-portrait" role="status" hidden>Le coin est en pause : votre MJ le rouvrira. Rien ne change d'ici là.</p>
        <section class="ses-portraits">
          <h4>Ses portraits</h4>
          <p class="aide-portrait">Les portraits de votre héros. Touchez-en un, puis « Prendre ce portrait » : la TV le montre aussi.</p>
          <ul class="grille-portraits"></ul>
          <div class="actions-portrait"><button type="button" class="envoyer-coin" data-prendre disabled>Prendre ce portrait</button></div>
        </section>
        <section class="propre-portrait">
          <h4>Ma propre image</h4>
          <p class="aide-portrait">Un dessin, une photo : JPEG, PNG ou WebP, 8 Mo au plus. Votre MJ la regarde avant qu'elle devienne votre portrait.</p>
          <label class="secondaire choisir-image">Choisir une image<input type="file" accept="${TYPES.join(",")}" data-fichier></label>
          <div class="cadrage-portrait" hidden>
            <div class="cadre-portrait" aria-label="Le cadre du portrait : faites glisser l'image pour la placer"><img alt="" draggable="false"></div>
            <label class="zoom-portrait"><span>Rapprocher</span><input type="range" min="1" max="${ZOOM_MAX}" step="0.01" value="1" data-zoom></label>
            <p class="aide-portrait">Faites glisser l'image du doigt pour la placer dans le cadre.</p>
            <div class="actions-portrait"><button type="button" class="secondaire" data-annuler-cadrage>Annuler</button>
              <button type="button" class="envoyer-coin" data-envoyer>Envoyer au MJ</button></div>
          </div>
          <ol class="envois-portrait"></ol>
        </section>
        <p class="message-portrait" role="status" aria-live="polite" hidden></p>
      </div>`;
    this.racine.addEventListener("click", (ev) => this.clic(ev));
    this.racine.querySelector("[data-fichier]").addEventListener("change", (ev) => this.fichierChoisi(ev.target));
    this.racine.querySelector("[data-zoom]").addEventListener("input", (ev) => this.zoomer(Number(ev.target.value)));
    this.brancherGlisser(this.racine.querySelector(".cadre-portrait"));
    this.fiche = null; // « Mon héros » du carnet, où le bloc a été posé (monterDansFiche)
    suiveurs.add((r) => {
      this.etat = r;
      this.dessiner();
      this.surEtat?.(r);
      if (this.fiche?.isConnected) this.medaillon(r);
    });
    ecouter(["portraits", "demandes", "pause"]);
  }

  // Pose le bloc dans la page que l'on vient de dessiner (ouvert : déplié d'emblée, l'onglet Héros arrivé par #portrait).
  monter(zone, { ouvert = false } = {}) {
    if (!zone) return;
    zone.append(this.racine);
    if (ouvert) this.ouvrir(true);
    if (this.etat) {
      this.dessiner();
      this.surEtat?.(this.etat);
      if (this.fiche?.isConnected) this.medaillon(this.etat);
    }
    lirePortraits().catch(() => {});
  }

  // Dans « Mon héros » du carnet : sous l'identité, et le médaillon prend le portrait que le coin sert toujours.
  monterDansFiche(fiche) {
    if (!fiche) return;
    this.fiche = fiche;
    let zone = fiche.querySelector(".zone-portrait");
    if (!zone) {
      zone = document.createElement("div");
      zone.className = "zone-portrait dans-fiche";
      (fiche.querySelector(".identite") || fiche.firstElementChild)?.after(zone);
    }
    this.monter(zone);
  }

  medaillon(r) {
    const m = this.fiche.querySelector(".identite .medaillon");
    if (!m || !r?.actuel) return;
    let img = m.querySelector("img");
    if (!img) {
      img = document.createElement("img");
      img.alt = "";
      m.prepend(img);
    }
    if (img.getAttribute("src") !== r.actuel) img.src = r.actuel;
    m.classList.remove("sans-image");
  }

  ouvrir(oui) {
    this.ouvert = oui;
    this.racine.querySelector(".panneau-portrait").hidden = !oui;
    const b = this.racine.querySelector("[data-ouvrir]");
    b.setAttribute("aria-expanded", String(oui));
    b.textContent = oui ? "Fermer" : "Changer de portrait";
  }

  dire(message, erreur = false) {
    const p = this.racine.querySelector(".message-portrait");
    p.textContent = message || "";
    p.hidden = !message;
    p.classList.toggle("erreur", erreur);
  }

  // ------------------------------------------------------------ dessin

  dessiner() {
    const r = this.etat;
    this.racine.hidden = !r?.heros;
    if (!r?.heros) return;
    const pause = Boolean(r.pause);
    this.racine.querySelector(".pause-portrait").hidden = !pause;
    const enRoute = (r.choix || []).some((d) => d.statut === "a-appliquer");
    if (this.choisi && !r.portraits.some((p) => p.nom === this.choisi && !p.actuel)) this.choisi = null;
    const g = r.heros.genre;
    this.racine.querySelector(".ses-portraits .aide-portrait").textContent = r.portraits.length
      ? `Les portraits de ${prenom(r.heros.nom)}, peints ou acceptés par votre MJ. Touchez-en un, puis « Prendre ce portrait » : la TV le montre aussi.`
      : r.publie ? `Votre MJ n'a pas encore de portrait pour ${prenom(r.heros.nom)} : envoyez le vôtre, ou demandez-lui.`
        : "Les portraits arrivent dans un instant.";
    this.racine.querySelector(".grille-portraits").innerHTML = r.portraits.map((p) => `
      <li><button type="button" class="vignette-portrait${p.actuel ? " actuel" : ""}" data-choisir="${e(p.nom)}" aria-pressed="${p.nom === this.choisi}"
        ${p.actuel ? 'aria-current="true"' : ""} aria-label="${p.actuel ? `Le portrait de ${accord(g, "votre héros", "votre héroïne")} en ce moment` : "Choisir ce portrait"}">
        <img src="${e(p.url)}" alt="" loading="lazy" decoding="async">
        ${p.actuel ? '<span class="etiquette-portrait">Son portrait</span>' : p.source === "joueur" ? `<span class="etiquette-portrait">${p.de_vous ? "Votre image" : "Image d'un joueur"}</span>` : ""}
      </button></li>`).join("");
    const prendre = this.racine.querySelector("[data-prendre]");
    prendre.disabled = !this.choisi || pause || this.envoi || enRoute;
    prendre.textContent = enRoute ? "Changement en route…" : "Prendre ce portrait";
    this.racine.querySelector(".choisir-image").classList.toggle("inactif", pause || (r.en_attente || 0) >= (r.attente_max || 5));
    this.racine.querySelector("[data-fichier]").disabled = pause || (r.en_attente || 0) >= (r.attente_max || 5);
    this.racine.querySelector("[data-envoyer]").disabled = pause || this.envoi;
    this.racine.querySelector(".envois-portrait").innerHTML = (r.envois || []).map((d) => this.htmlEnvoi(d, pause)).join("");
  }

  htmlEnvoi(d, pause) {
    const etat = { "en-attente": "attente", acceptee: "acceptee", refusee: "refusee", echec: "refusee" }[d.statut] || "";
    // Acceptée, l'image est parmi ses portraits (le coin a effacé sa copie) : la ligne n'en garde que le mot.
    return `<li class="envoi-portrait ${etat}${d.image ? "" : " sans-image"}">
      ${d.image ? `<img src="${e(d.image)}" alt="" loading="lazy" decoding="async">` : ""}
      <div>
        <p><b>${e(d.statut_dit)}</b> <span class="quand">${e(quand(d.cree))}</span></p>
        ${d.mot ? `<p class="mot-mj">Votre MJ : « ${e(d.mot)} »</p>` : ""}
        ${d.statut === "echec" && d.resultat ? `<p class="mot-mj">${e(d.resultat)}</p>` : ""}
        ${d.retirable ? `<button type="button" class="secondaire" data-retirer="${e(d.id)}" ${pause ? "disabled" : ""}>Retirer</button>` : ""}
      </div></li>`;
  }

  // ------------------------------------------------------------ gestes

  async clic(ev) {
    if (ev.target.closest("[data-ouvrir]")) return this.ouvrir(!this.ouvert);
    const vignette = ev.target.closest("[data-choisir]");
    if (vignette) {
      if (vignette.classList.contains("actuel")) return this.dire("C'est déjà son portrait.");
      this.choisi = this.choisi === vignette.dataset.choisir ? null : vignette.dataset.choisir;
      this.dire("");
      return this.dessiner();
    }
    if (ev.target.closest("[data-prendre]")) return this.prendre();
    if (ev.target.closest("[data-annuler-cadrage]")) return this.fermerCadrage();
    if (ev.target.closest("[data-envoyer]")) return this.envoyer();
    const retirer = ev.target.closest("[data-retirer]");
    if (retirer) {
      retirer.disabled = true;
      try {
        await demander("DELETE", `/api/demandes/${encodeURIComponent(retirer.dataset.retirer)}`);
        this.dire("Image retirée : votre MJ ne la verra pas.");
      } catch (err) {
        retirer.disabled = false;
        this.dire(err.message, true);
      }
      lirePortraits().catch(() => {});
    }
  }

  async prendre() {
    const nom = this.choisi;
    if (!nom || this.envoi) return;
    this.envoi = true;
    this.dessiner();
    try {
      await demander("POST", "/api/demandes", { genre: "portrait-choisi", corps: { portrait: nom } });
      this.choisi = null;
      this.dire("C'est parti : son portrait change dans un instant, à la TV aussi.");
    } catch (err) {
      this.dire(err.message, true);
    } finally {
      this.envoi = false;
    }
    lirePortraits().catch(() => {});
  }

  // ------------------------------------------------------------ sa propre image : choisir, cadrer, envoyer

  fichierChoisi(input) {
    const fichier = input.files?.[0];
    input.value = "";
    if (!fichier) return;
    const nom = String(fichier.name || "").toLowerCase();
    if (/heic|heif/.test(fichier.type) || /\.hei[cf]$/.test(nom)) {
      return this.dire("Les photos HEIC de l'iPhone ne passent pas telles quelles : choisissez la photo depuis la photothèque (l'iPhone la convertit), ou réglez Appareil photo › Formats sur « Le plus compatible ».", true);
    }
    if (/svg/.test(fichier.type) || nom.endsWith(".svg")) return this.dire("Un dessin SVG ne passe pas : exportez-le en PNG ou en JPEG.", true);
    if (fichier.type && !TYPES.includes(fichier.type)) return this.dire("Ce format d'image ne passe pas. Formats acceptés : JPEG, PNG ou WebP, 8 Mo au plus.", true);
    if (fichier.size > (this.etat?.octets_max || 8 * 1024 * 1024)) return this.dire("Cette image est trop lourde : 8 Mo au plus.", true);
    this.dire("");
    const url = URL.createObjectURL(fichier);
    const img = this.racine.querySelector(".cadre-portrait img");
    img.onload = () => this.ouvrirCadrage(url, fichier, img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      this.dire("Cette image ne s'ouvre pas : JPEG, PNG ou WebP attendus.", true);
    };
    img.src = url;
  }

  ouvrirCadrage(url, fichier, img) {
    if (this.cadre?.url && this.cadre.url !== url) URL.revokeObjectURL(this.cadre.url);
    const zone = this.racine.querySelector(".cadrage-portrait");
    zone.hidden = false;
    this.racine.querySelector(".choisir-image").hidden = true;
    const boite = this.racine.querySelector(".cadre-portrait");
    const l = boite.clientWidth;
    const h = boite.clientHeight;
    const s0 = Math.max(l / img.naturalWidth, h / img.naturalHeight);
    this.cadre = { url, fichier, img, l, h, s0, zoom: 1, ox: 0, oy: 0 };
    this.racine.querySelector("[data-zoom]").value = "1";
    this.cadre.ox = (l - img.naturalWidth * s0) / 2;
    this.cadre.oy = (h - img.naturalHeight * s0) / 2;
    this.placer();
    zone.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  fermerCadrage() {
    if (this.cadre?.url) URL.revokeObjectURL(this.cadre.url);
    this.cadre = null;
    this.racine.querySelector(".cadrage-portrait").hidden = true;
    this.racine.querySelector(".choisir-image").hidden = false;
    this.racine.querySelector(".cadre-portrait img").removeAttribute("src");
  }

  // L'image couvre toujours le cadre : ni bord vide, ni bande.
  placer() {
    const c = this.cadre;
    if (!c) return;
    const s = c.s0 * c.zoom;
    const w = c.img.naturalWidth * s;
    const h = c.img.naturalHeight * s;
    c.ox = Math.min(0, Math.max(c.l - w, c.ox));
    c.oy = Math.min(0, Math.max(c.h - h, c.oy));
    c.img.style.width = `${w}px`;
    c.img.style.height = `${h}px`;
    c.img.style.transform = `translate(${c.ox}px, ${c.oy}px)`;
  }

  zoomer(z) {
    const c = this.cadre;
    if (!c) return;
    // Rapprocher garde le milieu du cadre où il est.
    const s = c.s0 * c.zoom;
    const cx = (c.l / 2 - c.ox) / s;
    const cy = (c.h / 2 - c.oy) / s;
    c.zoom = Math.min(ZOOM_MAX, Math.max(1, z || 1));
    const s2 = c.s0 * c.zoom;
    c.ox = c.l / 2 - cx * s2;
    c.oy = c.h / 2 - cy * s2;
    this.placer();
  }

  brancherGlisser(boite) {
    let depart = null;
    boite.addEventListener("pointerdown", (ev) => {
      if (!this.cadre) return;
      depart = { x: ev.clientX, y: ev.clientY, ox: this.cadre.ox, oy: this.cadre.oy, id: ev.pointerId };
      boite.setPointerCapture?.(ev.pointerId);
      ev.preventDefault();
    });
    boite.addEventListener("pointermove", (ev) => {
      if (!depart || ev.pointerId !== depart.id || !this.cadre) return;
      this.cadre.ox = depart.ox + ev.clientX - depart.x;
      this.cadre.oy = depart.oy + ev.clientY - depart.y;
      this.placer();
    });
    const fin = (ev) => {
      if (depart && ev.pointerId === depart.id) depart = null;
    };
    boite.addEventListener("pointerup", fin);
    boite.addEventListener("pointercancel", fin);
  }

  // Le cadre, en pixels de l'image : { x, y, l, h }.
  rectangle() {
    const c = this.cadre;
    const s = c.s0 * c.zoom;
    return { x: -c.ox / s, y: -c.oy / s, l: c.l / s, h: c.h / s };
  }

  // Le portrait cadré, en JPEG, fait ici : léger à envoyer depuis un téléphone. Null si le navigateur ne sait pas.
  async jpegCadre() {
    const c = this.cadre;
    const r = this.rectangle();
    const largeur = Math.max(1, Math.round(Math.min(SORTIE, r.l)));
    const hauteur = Math.round(largeur * 4 / 3);
    try {
      const toile = document.createElement("canvas");
      toile.width = largeur;
      toile.height = hauteur;
      const ctx = toile.getContext("2d");
      ctx.fillStyle = "#f4ead4";
      ctx.fillRect(0, 0, largeur, hauteur);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(c.img, r.x, r.y, r.l, r.h, 0, 0, largeur, hauteur);
      return await new Promise((ok) => toile.toBlob((b) => ok(b), "image/jpeg", 0.9));
    } catch {
      return null;
    }
  }

  async envoyer() {
    const c = this.cadre;
    if (!c || this.envoi) return;
    this.envoi = true;
    this.dessiner();
    const bouton = this.racine.querySelector("[data-envoyer]");
    bouton.textContent = "Envoi…";
    try {
      let corps = await this.jpegCadre();
      let adresse = "/api/portraits/envoi";
      if (!corps) {
        // Sans toile : l'image telle quelle, et le cadre en fractions ; le serveur recadre.
        const r = this.rectangle();
        const n = (v) => Math.max(0, Math.min(1, v)).toFixed(5);
        adresse += `?x=${n(r.x / c.img.naturalWidth)}&y=${n(r.y / c.img.naturalHeight)}&l=${n(r.l / c.img.naturalWidth)}`;
        corps = c.fichier;
      }
      let rep;
      try {
        rep = await fetch(adresse, { method: "POST", headers: { "Content-Type": corps.type || "application/octet-stream" }, body: corps });
      } catch {
        throw new Error("serveur injoignable, vérifiez la connexion");
      }
      if (!rep.ok) {
        let message = `${rep.status}`;
        try {
          message = (await rep.json()).detail || message;
        } catch {
          // réponse sans JSON
        }
        throw new Error(message);
      }
      this.fermerCadrage();
      this.dire("Envoyée : votre MJ la regarde dans sa boîte. Acceptée, elle devient votre portrait.");
    } catch (err) {
      this.dire(`Image non envoyée : ${err.message}`, true);
    } finally {
      this.envoi = false;
      bouton.textContent = "Envoyer au MJ";
    }
    lirePortraits().catch(() => {});
  }
}
