import { api, echapper as e, toast } from "../api.js";
import { MusiqueDesCombats } from "./musique-combat.js";
import { MusiqueDesBoutiques } from "./musique-boutique.js";

// La musique de fond de la partie : une liste d'ambiances (liens YouTube, vidéo ou playlist) jouée ici, sur l'ordinateur
// du MJ, par le lecteur intégré de YouTube. Le panneau vit dans l'en-tête : la musique continue quand on change d'onglet.

const FONDU_SORTIE = 900;
const FONDU_ENTREE = 1600;
const ATTENTE_GESTE = 4500;
const ECOUTE_BATTEMENT = 30000;
// Sur un écran large, le panneau pousse la page au lieu de la couvrir (combat.css) : un clic dans la page ne le ferme
// pas, la page ne bouge pas sous le doigt.
const POUSSE_LA_PAGE = matchMedia("(min-width: 1100px)");

function memoire(cle, defaut) {
  try {
    const v = localStorage.getItem(`musique.${cle}`);
    return v === null ? defaut : JSON.parse(v);
  } catch {
    return defaut;
  }
}

function retenir(cle, valeur) {
  try {
    localStorage.setItem(`musique.${cle}`, JSON.stringify(valeur));
  } catch {
    // navigation privée : le réglage ne sera simplement pas retenu
  }
}

// Le nom d'une ambiance réglée pour les combats ou les boutiques (page Réglages), rappelé sous la liste ; « aucune ».
function nomAmbiance(ambiances, id) {
  return (id && ambiances.find((x) => x.id === id)?.nom) || "aucune";
}

let chargementYouTube = null;
function chargerYouTube() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (chargementYouTube) return chargementYouTube;
  chargementYouTube = new Promise((resoudre, rejeter) => {
    const precedent = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      precedent?.();
      resoudre(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => rejeter(new Error("YouTube est injoignable"));
    document.head.append(script);
    setTimeout(() => rejeter(new Error("YouTube ne répond pas")), 15000);
  }).catch((err) => {
    chargementYouTube = null;
    throw err;
  });
  return chargementYouTube;
}

// Le lecteur de l'en-tête, seul de la page : Séances › Jouer lance par lui l'ambiance d'une scène, sur un clic du MJ.
let instance = null;

// Ce qui joue : l'identifiant de l'ambiance (ou null) et si elle est en pause.
export function etatMusique() {
  return { courante: instance?.courante || null, enPause: Boolean(instance?.enPause) };
}

// Lance une ambiance par son identifiant, avec le même fondu qu'un clic dans le panneau. À n'appeler que sur un geste :
// rien ne joue sans lui.
export async function jouerAmbiance(id) {
  if (!instance) throw new Error("le lecteur de musique n'est pas prêt");
  if (!instance.ambiances.some((a) => a.id === id)) await instance.chargerListe();
  const a = instance.ambiances.find((x) => x.id === id);
  if (!a) throw new Error(instance.chargee ? "cette ambiance n'est plus dans la liste de musique" : "la liste de musique est illisible");
  instance.choisir(a);
}

const ERREURS = {
  2: "le lien est illisible",
  5: "le lecteur n'a pas pu lire cette vidéo",
  100: "vidéo introuvable (privée ou supprimée)",
  101: "YouTube refuse sa lecture hors de son site",
  150: "YouTube refuse sa lecture hors de son site",
  153: "YouTube refuse le lecteur (adresse d'origine manquante)",
};

export class Musique {
  constructor(entete) {
    this.ambiances = [];
    this.modifie = null;
    this.chargee = false;
    this.courante = null;
    this.titreMorceau = "";
    this.enPause = false;
    this.selection = null; // l'ambiance touchée dans la liste : rien n'est chargé tant que « Lancer la lecture » n'est pas pressé
    this.volume = Math.max(0, Math.min(100, Number(memoire("volume", 60)) || 0));
    this.aleatoire = memoire("aleatoire", true) !== false;
    this.lecteur = null;
    this.jeton = 0;
    this.fonduEnAttente = 0;
    this.melangerAuDebut = false;
    this.erreursDeSuite = 0;
    this.minuteurFondu = null;
    this.finFondu = null;
    this.edition = null;
    this.attenteGeste = false;
    this.annonce = "";
    this.ambianceCombat = null; // l'ambiance des combats (musique-combat.js), null : aucune
    this.ambianceBoutique = null; // l'ambiance des boutiques à la TV (musique-boutique.js), null : aucune
    instance = this;

    const outils = entete.querySelector(".outils-entete") || entete;
    this.bouton = document.createElement("button");
    this.bouton.type = "button";
    this.bouton.className = "bouton-musique";
    this.bouton.setAttribute("aria-expanded", "false");
    this.bouton.setAttribute("aria-controls", "musique-panneau");
    this.bouton.title = "Musique de fond";
    this.bouton.innerHTML = `<span class="egaliseur" aria-hidden="true"><i></i><i></i><i></i></span><span class="libelle">Musique</span>`;
    outils.prepend(this.bouton);

    this.panneau = document.createElement("aside");
    this.panneau.id = "musique-panneau";
    this.panneau.className = "musique";
    this.panneau.setAttribute("aria-label", "Musique de fond");
    this.panneau.innerHTML = `
      <header class="musique-tete"><h2>Musique de fond</h2><button type="button" data-m="fermer">Fermer</button></header>
      <div class="musique-ecran" hidden><div class="musique-youtube"></div></div>
      <p class="musique-attente" hidden>Le navigateur attend un geste : touchez la vidéo ci-dessus pour lancer la musique.</p>
      <p class="musique-en-cours"></p>
      <div class="musique-boutons">
        <button type="button" class="principal" data-m="lancer" disabled>Lancer la lecture</button>
        <button type="button" data-m="pause">Pause</button>
        <button type="button" data-m="suivant">Morceau suivant</button>
        <button type="button" data-m="aleatoire" aria-pressed="false">Aléatoire</button>
        <button type="button" class="lien-danger" data-m="arreter">Arrêter</button>
      </div>
      <label class="musique-volume">Volume <input type="range" min="0" max="100" step="1"><output></output></label>
      <div class="musique-corps"></div>`;
    document.body.append(this.panneau);
    this.ecran = this.panneau.querySelector(".musique-ecran");
    this.corps = this.panneau.querySelector(".musique-corps");
    this.reglette = this.panneau.querySelector(".musique-volume input");
    this.reglette.value = this.volume;
    this.panneau.querySelector(".musique-volume output").textContent = this.volume;

    this.bouton.addEventListener("click", () => this.basculerPanneau());
    this.panneau.addEventListener("click", (ev) => this.surClic(ev));
    this.reglette.addEventListener("input", () => this.changerVolume(Number(this.reglette.value)));
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && this.ouvert()) {
        this.fermer();
        this.bouton.focus();
      }
    });
    document.addEventListener("pointerdown", (ev) => {
      if (POUSSE_LA_PAGE.matches) return;
      if (this.ouvert() && !this.panneau.contains(ev.target) && !this.bouton.contains(ev.target)) this.fermer();
    });
    this.majCommandes();
    this.combats = new MusiqueDesCombats(this);
    this.boutiques = new MusiqueDesBoutiques(this);
    // La musique à la table du coin (19/11) : pendant la lecture, la position repart toutes les 30 secondes.
    this.derniereEcoute = "";
    setInterval(() => {
      const S = window.YT?.PlayerState;
      if (this.lecteur && this.courante && !this.enPause && S && this.lecteur.getPlayerState?.() === S.PLAYING) this.publierEcoute("joue", true);
    }, ECOUTE_BATTEMENT);
    // La liste se lit dès l'ouverture : l'ambiance de combat sert même si le panneau reste fermé.
    this.chargerListe();
  }

  ouvert() {
    return this.panneau.classList.contains("ouvert");
  }

  // Ce que joue ce lecteur, pour la table du coin des joueurs (musique_coin.py) : la vidéo, l'endroit où elle en est, et si
  // elle joue. Ni le nom de l'ambiance ni sa note. L'atelier ne le publie que la table du coin ouverte et la musique au coin
  // permise ; un envoi raté ne dit rien (la musique d'ici continue). battement : la position seule a avancé.
  publierEcoute(etat, battement = false) {
    let corps = { etat: "arret" };
    if (etat !== "arret") {
      const video = this.lecteur?.getVideoData?.()?.video_id;
      if (!video) return;
      corps = { etat, video, temps: Math.max(0, Math.round((Number(this.lecteur.getCurrentTime?.()) || 0) * 10) / 10) };
    }
    const cle = `${corps.etat}|${corps.video || ""}`;
    if (!battement && cle === this.derniereEcoute && corps.etat !== "joue") return;
    this.derniereEcoute = cle;
    // Un simple fetch : ni toast ni cache des lectures vidé toutes les 30 secondes.
    fetch("/api/musique/ecoute", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps), keepalive: true }).catch(() => {});
  }

  async basculerPanneau() {
    if (this.ouvert()) return this.fermer();
    this.panneau.classList.add("ouvert");
    document.body.classList.add("musique-ouverte");
    this.bouton.setAttribute("aria-expanded", "true");
    if (!this.edition) {
      if (!this.chargee) this.corps.innerHTML = `<p class="aide">Chargement de la liste…</p>`;
      await this.chargerListe();
    }
  }

  fermer() {
    this.panneau.classList.remove("ouvert");
    document.body.classList.remove("musique-ouverte");
    this.bouton.setAttribute("aria-expanded", "false");
  }

  async chargerListe() {
    try {
      const d = await api.get("/api/musique");
      this.ambiances = d.ambiances || [];
      this.modifie = d.modifie ?? null;
      this.ambianceCombat = d.combat ?? null;
      this.ambianceBoutique = d.boutique ?? null;
      this.chargee = true;
    } catch (err) {
      if (!this.chargee) {
        this.corps.innerHTML = `<p class="musique-erreur">Liste illisible : ${e(err.message)}</p>`;
        return;
      }
    }
    if (!this.edition) this.afficherListe();
  }

  ambianceCourante() {
    return this.ambiances.find((a) => a.id === this.courante) || this.ambianceJouee || null;
  }

  afficherListe() {
    const genre = (a) => (a.liste ? "Playlist" : "Vidéo");
    this.corps.innerHTML = `
      ${this.ambiances.length ? `<ul class="musique-ambiances">
        ${this.ambiances.map((a) => `
          <li><button type="button" class="ambiance" data-id="${e(a.id)}" aria-pressed="${a.id === this.courante}">
            <span class="nom">${e(a.nom)}</span>
            <span class="detail">${e(genre(a))}${a.titre ? ` · ${e(a.titre)}` : ""}</span>
            ${a.note ? `<span class="detail">${e(a.note)}</span>` : ""}
            ${a.lisible === false ? `<span class="alerte">${e(a.raison || "YouTube refuse sa lecture ici")}</span>` : ""}
          </button></li>`).join("")}
      </ul>` : `<p class="aide">Aucune ambiance pour l'instant. Ajoutez des liens YouTube (une vidéo ou une playlist) avec « Modifier la liste ».</p>`}
      ${this.ambiances.length ? `<p class="aide musique-vers-reglages">Au combat : ${e(nomAmbiance(this.ambiances, this.ambianceCombat))}. Aux boutiques : ${e(nomAmbiance(this.ambiances, this.ambianceBoutique))}. <a href="#/reglages/table">Les choisir dans les Réglages</a></p>` : ""}
      <div class="musique-pied">
        <button type="button" data-m="modifier">Modifier la liste</button>
        <span class="aide">Touchez une ambiance, puis « Lancer la lecture » : fondu vers elle.</span>
      </div>`;
  }

  majBouton() {
    const a = this.courante ? this.ambianceCourante() : null;
    this.bouton.dataset.joue = a && !this.enPause ? "1" : "0";
    this.bouton.querySelector(".libelle").textContent = a ? a.nom : "Musique";
    this.bouton.title = a ? `Musique de fond : ${a.nom}${this.enPause ? " (en pause)" : ""}` : "Musique de fond";
    // Les boutons « Ambiance » des scènes suivent ce qui joue (annoncé seulement quand ça change).
    const annonce = `${this.courante || ""}|${this.enPause}`;
    if (annonce !== this.annonce) {
      this.annonce = annonce;
      window.dispatchEvent(new CustomEvent("musique-changee", { detail: etatMusique() }));
    }
  }

  majCommandes() {
    const a = this.courante ? this.ambianceCourante() : null;
    const enCours = this.panneau.querySelector(".musique-en-cours");
    enCours.innerHTML = a
      ? `<b>${e(a.nom)}</b><span>${this.enPause ? "En pause" : e(this.titreMorceau || "Chargement…")}</span>`
      : `<span>Choisissez une ambiance dans la liste.</span>`;
    // Une ambiance touchée mais pas lancée : ni YouTube ni son lecteur ne sont appelés avant « Lancer la lecture ».
    const visee = this.selection && !(this.selection.id === this.courante && !this.enPause) ? this.selection : null;
    if (visee) {
      enCours.innerHTML += `<span class="musique-visee">Choisie : <b>${e(visee.nom)}</b>. Rien ne joue ni ne se charge avant « Lancer la lecture ».</span>`;
    }
    const lancer = this.panneau.querySelector('[data-m="lancer"]');
    lancer.disabled = !visee;
    lancer.textContent = visee ? (a ? `Lancer « ${visee.nom} » (fondu)` : `Lancer « ${visee.nom} »`) : "Lancer la lecture";
    const pause = this.panneau.querySelector('[data-m="pause"]');
    pause.textContent = this.enPause ? "Reprendre" : "Pause";
    pause.disabled = !a;
    this.panneau.querySelector('[data-m="suivant"]').disabled = !a?.liste;
    this.panneau.querySelector('[data-m="arreter"]').disabled = !a;
    this.panneau.querySelector('[data-m="aleatoire"]').setAttribute("aria-pressed", String(this.aleatoire));
    this.panneau.querySelector(".musique-attente").hidden = !this.attenteGeste;
    for (const b of this.corps.querySelectorAll(".ambiance")) {
      b.setAttribute("aria-pressed", String(b.dataset.id === this.courante));
      b.classList.toggle("choisie", b.dataset.id === this.selection?.id);
    }
    this.majBouton();
  }

  surClic(ev) {
    const cible = ev.target.closest("button");
    if (!cible) return;
    const action = cible.dataset.m;
    if (action === "fermer") this.fermer();
    else if (action === "lancer") {
      const a = this.selection;
      if (a) {
        this.selection = null;
        this.choisir(a);
      }
    } else if (action === "pause") this.basculerPause();
    else if (action === "suivant") this.suivant();
    else if (action === "aleatoire") this.basculerAleatoire();
    else if (action === "arreter") this.arreter();
    else if (action === "modifier") this.ouvrirEdition();
    else if (cible.dataset.e) this.surEdition(cible.dataset.e, cible);
    else if (cible.classList.contains("ambiance")) {
      const a = this.ambiances.find((x) => x.id === cible.dataset.id);
      if (a) {
        this.selection = a;
        this.majCommandes();
      }
    }
  }

  // Une ambiance choisie : reprise si elle est en pause, fondu vers elle si c'en est une autre, rien si elle joue déjà.
  choisir(a) {
    if (a.id === this.courante && this.enPause) this.basculerPause();
    else if (a.id !== this.courante) this.jouer(a);
  }

  // Un lecteur YouTube neuf par ambiance : changer de playlist dans le même lecteur lui fait rejouer la précédente.
  creerLecteur(a) {
    return chargerYouTube().then((YT) => new Promise((resoudre) => {
      this.ecran.hidden = false;
      const hote = document.createElement("div");
      this.ecran.replaceChildren(hote);
      const source = a.liste ? { listType: "playlist", list: a.liste } : { playlist: a.video, loop: 1 };
      const lecteur = new YT.Player(hote, {
        width: "100%",
        height: "100%",
        ...(a.liste ? {} : { videoId: a.video }),
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, iv_load_policy: 3, origin: location.origin, ...source },
        events: {
          onReady: () => {
            lecteur.setVolume(0);
            lecteur.playVideo();
            resoudre(lecteur);
          },
          onStateChange: (ev) => {
            if (lecteur === this.lecteur) this.surEtat(ev.data);
          },
          onError: (ev) => {
            if (lecteur === this.lecteur) this.surErreur(ev.data);
          },
        },
      });
      this.lecteur = lecteur;
    }));
  }

  async jouer(a) {
    const jeton = ++this.jeton;
    const etaitEnCours = this.courante && !this.enPause;
    this.courante = a.id;
    this.ambianceJouee = a;
    this.enPause = false;
    this.titreMorceau = "";
    this.erreursDeSuite = 0;
    this.attenteGeste = false;
    this.majCommandes();
    if (this.lecteur && etaitEnCours) await this.fondu(0, FONDU_SORTIE);
    if (jeton !== this.jeton) return;
    this.finFondu?.();
    try {
      this.lecteur?.destroy();
    } catch {
      // l'ancien lecteur est déjà parti
    }
    this.lecteur = null;
    this.fonduEnAttente = jeton;
    this.melangerAuDebut = this.aleatoire && Boolean(a.liste);
    try {
      await this.creerLecteur(a);
    } catch (err) {
      if (jeton !== this.jeton) return;
      this.courante = null;
      this.majCommandes();
      toast(`Musique impossible : ${err.message}`, "erreur");
      return;
    }
    if (jeton !== this.jeton) return;
    // Safari (et parfois Chrome sans clic récent) bloque le son lancé de loin : il faut alors toucher la vidéo.
    setTimeout(() => {
      if (jeton !== this.jeton || this.enPause || !this.lecteur) return;
      const S = window.YT.PlayerState;
      if ([S.UNSTARTED, S.CUED, S.PAUSED].includes(this.lecteur.getPlayerState?.())) {
        this.attenteGeste = true;
        this.majCommandes();
        if (!this.ouvert()) this.basculerPanneau();
      }
    }, ATTENTE_GESTE);
  }

  surEtat(etat) {
    const S = window.YT.PlayerState;
    if (etat === S.PLAYING) {
      this.erreursDeSuite = 0;
      this.attenteGeste = false;
      this.lecteur.setLoop(true);
      if (this.lecteur.isMuted?.()) this.lecteur.unMute();
      if (this.melangerAuDebut) {
        // Une playlist en aléatoire commence par un morceau pris au hasard (le fondu attend ce morceau-là).
        this.melangerAuDebut = false;
        const n = this.lecteur.getPlaylist?.()?.length || 0;
        this.lecteur.setShuffle(true);
        if (n > 1) {
          this.lecteur.playVideoAt(Math.floor(Math.random() * n));
          return;
        }
      }
      if (this.enPause) this.enPause = false;
      if (this.fonduEnAttente) {
        this.fonduEnAttente = 0;
        this.fondu(this.volume, FONDU_ENTREE);
      } else if (!this.minuteurFondu && this.lecteur.getVolume() < this.volume) {
        this.lecteur.setVolume(this.volume);
      }
      this.titreMorceau = this.lecteur.getVideoData?.()?.title || "";
      this.majCommandes();
      this.publierEcoute("joue");
    } else if (etat === S.PAUSED && !this.minuteurFondu && this.courante && !this.enPause) {
      // mis en pause depuis le lecteur lui-même
      this.enPause = true;
      this.majCommandes();
      this.publierEcoute("pause");
    }
  }

  surErreur(code) {
    const a = this.ambianceCourante();
    if (a?.liste && [100, 101, 150].includes(code) && this.erreursDeSuite < 8) {
      // un morceau de la playlist refuse d'être lu ici : on passe au suivant
      this.erreursDeSuite += 1;
      setTimeout(() => this.lecteur.nextVideo(), 400);
      return;
    }
    toast(`« ${a?.nom || "Musique"} » : ${ERREURS[code] || `erreur ${code} du lecteur YouTube`}.`, "erreur");
  }

  fondu(cible, duree) {
    this.finFondu?.();
    clearInterval(this.minuteurFondu);
    return new Promise((resoudre) => {
      if (!this.lecteur) return resoudre();
      const depart = this.lecteur.getVolume?.() ?? 0;
      const t0 = performance.now();
      const finir = () => {
        clearInterval(this.minuteurFondu);
        this.minuteurFondu = null;
        this.finFondu = null;
        resoudre();
      };
      this.finFondu = finir;
      this.minuteurFondu = setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / duree);
        this.lecteur.setVolume(Math.round(depart + (cible - depart) * k));
        if (k >= 1) finir();
      }, 60);
    });
  }

  async basculerPause() {
    if (!this.lecteur || !this.courante) return;
    if (this.enPause) {
      this.enPause = false;
      this.fonduEnAttente = ++this.jeton;
      this.lecteur.playVideo();
    } else {
      this.enPause = true;
      const jeton = ++this.jeton;
      this.majCommandes();
      await this.fondu(0, 500);
      if (jeton === this.jeton && this.enPause) {
        this.lecteur.pauseVideo();
        this.publierEcoute("pause");
      }
    }
    this.majCommandes();
  }

  async suivant() {
    if (!this.lecteur || !this.ambianceCourante()?.liste) return;
    const jeton = ++this.jeton;
    await this.fondu(0, 500);
    if (jeton !== this.jeton) return;
    this.enPause = false;
    this.fonduEnAttente = jeton;
    this.lecteur.nextVideo();
  }

  basculerAleatoire() {
    this.aleatoire = !this.aleatoire;
    retenir("aleatoire", this.aleatoire);
    if (this.lecteur && this.ambianceCourante()?.liste) this.lecteur.setShuffle(this.aleatoire);
    this.majCommandes();
  }

  async arreter() {
    if (!this.lecteur) return;
    const jeton = ++this.jeton;
    this.courante = null;
    this.ambianceJouee = null;
    this.enPause = false;
    this.attenteGeste = false;
    this.majCommandes();
    this.publierEcoute("arret");
    await this.fondu(0, FONDU_SORTIE);
    if (jeton === this.jeton) this.lecteur.stopVideo();
  }

  changerVolume(v) {
    this.volume = v;
    retenir("volume", v);
    this.panneau.querySelector(".musique-volume output").textContent = v;
    if (!this.lecteur || !this.courante || this.enPause) return;
    this.finFondu?.();
    this.fonduEnAttente = 0;
    this.lecteur.setVolume(v);
  }

  // Modifier la liste : nom, lien YouTube et note par ambiance ; le serveur vérifie les liens auprès de YouTube.
  ouvrirEdition() {
    this.edition = this.ambiances.map((a) => ({ id: a.id, nom: a.nom, lien: a.lien, note: a.note || "" }));
    if (!this.edition.length) this.edition.push({ nom: "", lien: "", note: "" });
    this.afficherEdition();
  }

  lireEdition() {
    for (const li of this.corps.querySelectorAll(".musique-edition li")) {
      const x = this.edition[Number(li.dataset.i)];
      x.nom = li.querySelector(".m-nom").value;
      x.lien = li.querySelector(".m-lien").value;
      x.note = li.querySelector(".m-note").value;
    }
  }

  afficherEdition(erreur = "") {
    const n = this.edition.length;
    this.corps.innerHTML = `
      <ol class="musique-edition">
        ${this.edition.map((x, i) => `
          <li data-i="${i}">
            <input class="m-nom" type="text" value="${e(x.nom)}" placeholder="Nom, par exemple L'auberge" aria-label="Nom de l'ambiance" maxlength="60">
            <input class="m-lien" type="url" value="${e(x.lien)}" placeholder="Lien YouTube : vidéo ou playlist" aria-label="Lien YouTube" inputmode="url">
            <input class="m-note" type="text" value="${e(x.note)}" placeholder="Note (facultatif) : la scène, le moment" aria-label="Note" maxlength="200">
            <div class="m-actions">
              <button type="button" data-e="monter" aria-label="Monter" ${i === 0 ? "disabled" : ""}>↑</button>
              <button type="button" data-e="descendre" aria-label="Descendre" ${i === n - 1 ? "disabled" : ""}>↓</button>
              <button type="button" class="lien-danger" data-e="retirer">Retirer</button>
            </div>
          </li>`).join("")}
      </ol>
      <p class="aide">Collez l'adresse d'une vidéo ou d'une playlist YouTube telle qu'elle apparaît dans le navigateur.</p>
      <p class="musique-erreur" role="alert">${e(erreur)}</p>
      <div class="musique-pied">
        <button type="button" data-e="ajouter">Ajouter une ambiance</button>
        <span>
          <button type="button" data-e="annuler">Annuler</button>
          <button type="button" class="principal" data-e="enregistrer">Enregistrer</button>
        </span>
      </div>`;
  }

  async surEdition(action, cible) {
    this.lireEdition();
    const i = Number(cible.closest("li")?.dataset.i);
    if (action === "ajouter") {
      this.edition.push({ nom: "", lien: "", note: "" });
      this.afficherEdition();
      this.corps.querySelector(".musique-edition li:last-child .m-nom")?.focus();
    } else if (action === "retirer") {
      this.edition.splice(i, 1);
      this.afficherEdition();
    } else if (action === "monter" || action === "descendre") {
      const j = action === "monter" ? i - 1 : i + 1;
      [this.edition[i], this.edition[j]] = [this.edition[j], this.edition[i]];
      this.afficherEdition();
    } else if (action === "annuler") {
      this.edition = null;
      this.afficherListe();
    } else if (action === "enregistrer") {
      const ambiances = this.edition.filter((x) => x.nom.trim() || x.lien.trim());
      cible.disabled = true;
      cible.textContent = "Vérification…";
      try {
        const d = await api.put("/api/musique", { ambiances, version_base: this.modifie });
        this.ambiances = d.ambiances;
        this.modifie = d.modifie;
        this.ambianceCombat = d.combat ?? null;
        this.ambianceBoutique = d.boutique ?? null;
        this.edition = null;
        this.afficherListe();
        this.majCommandes();
        const refusees = d.ambiances.filter((a) => a.lisible === false).length;
        toast(refusees ? `Liste enregistrée ; ${refusees} lien${refusees > 1 ? "s" : ""} refusé${refusees > 1 ? "s" : ""} par YouTube.` : "Liste de musique enregistrée.",
          refusees ? "erreur" : undefined);
      } catch (err) {
        if (err.status === 409) {
          await this.chargerListe();
          this.afficherEdition("La liste a changé sur un autre écran entre-temps. Vos changements sont gardés ici : enregistrez à nouveau pour les appliquer, ou annulez pour voir l'autre version.");
          return;
        }
        this.afficherEdition(err.message);
      }
    }
  }
}

// La télécommande (relais-telecommande.js) : ce qui joue ici, dit au téléphone (null tant que le lecteur n'est pas prêt),
// et ses gestes, les mêmes que ceux du panneau.
export function etatPourTelecommande() {
  if (!instance) return null;
  const a = instance.courante ? instance.ambianceCourante() : null;
  const S = window.YT?.PlayerState;
  return {
    courante: a?.id || null, nom: a?.nom || "", titre: a ? instance.titreMorceau : "", enPause: Boolean(a && instance.enPause),
    liste: Boolean(a?.liste), attenteGeste: instance.attenteGeste,
    joue: Boolean(a && S && !instance.enPause && instance.lecteur?.getPlayerState?.() === S.PLAYING),
  };
}

export async function commanderMusique(action, id) {
  if (!instance) throw new Error("le lecteur de musique n'est pas prêt");
  if (action === "choisir") return jouerAmbiance(id);
  if (!instance.courante || !instance.lecteur) throw new Error("aucune musique ne joue sur cet écran");
  if (action === "pause") return instance.enPause ? undefined : instance.basculerPause();
  if (action === "reprendre") return instance.enPause ? instance.basculerPause() : undefined;
  if (action === "morceau") {
    if (!instance.ambianceCourante()?.liste) throw new Error("cette ambiance n'est pas une playlist");
    return instance.suivant();
  }
  throw new Error("commande inconnue");
}
