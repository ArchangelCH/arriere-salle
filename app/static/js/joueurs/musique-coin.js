// La musique du MJ à la table du coin (19/11) : ce que joue le lecteur de l'atelier s'entend aussi ici, sur cet appareil,
// si le joueur le veut (autour de la vraie table, les haut-parleurs du MJ suffisent : chaque appareil choisit, et s'en
// souvient). La page relit GET /api/musique-table quand le flux dit « musique » : la vidéo YouTube, sa position à cet
// instant, joue ou en pause. Le lecteur de YouTube suit : même vidéo, même endroit (à quelques secondes près).
//
// Le réglage vit dans la jauge du volume, en bas à gauche (« Musique du MJ », sa propre jauge). Tant que l'appareil n'a
// pas choisi, une invitation paraît quand la musique commence. Un navigateur qui refuse le son lancé de loin (Safari)
// montre la petite vidéo : un toucher dessus la lance.

import { ecouterFlux } from "./flux.js";

const CLE_CHOIX = "musique-coin.choix";
const CLE_VOLUME = "musique-coin.volume";
const ECART_MAX = 6; // secondes : au-delà, le lecteur saute à la position du MJ
const ATTENTE_GESTE = 4000;

function memoire(cle, defaut) {
  try {
    const v = localStorage.getItem(cle);
    return v === null ? defaut : JSON.parse(v);
  } catch {
    return defaut;
  }
}

function retenir(cle, valeur) {
  try {
    localStorage.setItem(cle, JSON.stringify(valeur));
  } catch {
    // navigation privée : le choix vaut pour cette visite
  }
}

let chargement = null;
function chargerYouTube() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (chargement) return chargement;
  chargement = new Promise((resoudre, rejeter) => {
    const precedent = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      precedent?.();
      resoudre(window.YT);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => rejeter(new Error("YouTube est injoignable"));
    document.head.append(s);
    setTimeout(() => rejeter(new Error("YouTube ne répond pas")), 15000);
  }).catch((err) => {
    chargement = null;
    throw err;
  });
  return chargement;
}

export function monter(panneauVolume) {
  if (!panneauVolume) return null;
  let choix = memoire(CLE_CHOIX, null); // "oui", "non", ou null tant que l'appareil n'a pas choisi
  let volume = Math.max(0, Math.min(100, Number(memoire(CLE_VOLUME, 70)) || 0));
  let voulu = { etat: "arret", video: null, position: 0 }; // ce que joue le MJ
  let lecteur = null;
  let creation = null;
  let attente = 0;
  let geste = false; // le navigateur attend un toucher sur la vidéo

  const bloc = document.createElement("div");
  bloc.className = "musique-coin";
  bloc.innerHTML = `
    <label class="case-musique"><input type="checkbox" id="musique-mj"> Musique du MJ sur cet appareil</label>
    <div class="ligne-volume"><label for="jauge-musique">Musique</label><input type="range" id="jauge-musique" min="0" max="100" step="5"><output for="jauge-musique"></output></div>
    <p class="etat-musique" role="status"></p>
    <div class="ecran-musique" hidden><div class="hote-musique"></div></div>`;
  panneauVolume.append(bloc);
  const caseMusique = bloc.querySelector("#musique-mj");
  const jauge = bloc.querySelector("#jauge-musique");
  const sortie = bloc.querySelector("output");
  const dit = bloc.querySelector(".etat-musique");
  const ecran = bloc.querySelector(".ecran-musique");

  const invitation = document.createElement("div");
  invitation.className = "invitation-musique";
  invitation.hidden = true;
  invitation.setAttribute("role", "dialog");
  invitation.setAttribute("aria-label", "La musique du MJ");
  invitation.innerHTML = `<p>Votre MJ joue de la musique.</p><div><button type="button" class="principal" data-musique="oui">L'écouter ici</button><button type="button" data-musique="non">Non merci</button></div>`;
  document.body.append(invitation);

  function dessiner() {
    caseMusique.checked = choix === "oui";
    jauge.value = String(volume);
    jauge.disabled = choix !== "oui";
    sortie.textContent = `${volume} %`;
    const joue = voulu.etat !== "arret";
    invitation.hidden = !(choix === null && voulu.etat === "joue");
    ecran.hidden = !(choix === "oui" && joue && geste);
    dit.textContent = choix !== "oui"
      ? (joue ? "Votre MJ joue de la musique : cochez pour l'entendre ici." : "")
      : geste ? "Touchez la vidéo pour lancer la musique."
        : voulu.etat === "joue" ? "La musique du MJ joue ici." : voulu.etat === "pause" ? "Musique en pause." : "Aucune musique en ce moment.";
  }

  function creer() {
    if (creation) return creation;
    creation = chargerYouTube().then((YT) => new Promise((resoudre) => {
      const hote = document.createElement("div");
      bloc.querySelector(".hote-musique").replaceChildren(hote);
      const p = new YT.Player(hote, {
        width: "100%", height: "100%", host: "https://www.youtube-nocookie.com",
        videoId: voulu.video,
        playerVars: { autoplay: 1, playsinline: 1, controls: 1, rel: 0, iv_load_policy: 3, start: Math.floor(voulu.position || 0), origin: location.origin },
        events: {
          onReady: () => {
            lecteur = p;
            p.setVolume(volume);
            resoudre(p);
            suivre();
          },
          onStateChange: (ev) => {
            if (ev.data === YT.PlayerState.PLAYING) {
              geste = false;
              if (voulu.etat !== "joue") p.pauseVideo();
              dessiner();
            }
          },
          onError: () => {
            dit.textContent = "YouTube refuse de lire cette musique ici.";
          },
        },
      });
    })).catch((err) => {
      creation = null;
      dit.textContent = `Musique impossible : ${err.message}.`;
    });
    return creation;
  }

  // Le lecteur suit ce que joue le MJ : la même vidéo, au même endroit, jouée ou en pause.
  function suivre() {
    clearTimeout(attente);
    if (choix !== "oui" || voulu.etat === "arret" || !voulu.video) {
      geste = false;
      if (lecteur) lecteur.stopVideo?.();
      return dessiner();
    }
    if (!lecteur) {
      creer();
      return dessiner();
    }
    const enCours = lecteur.getVideoData?.()?.video_id;
    if (enCours !== voulu.video) {
      if (voulu.etat === "joue") lecteur.loadVideoById({ videoId: voulu.video, startSeconds: voulu.position });
      else lecteur.cueVideoById({ videoId: voulu.video, startSeconds: voulu.position });
    } else if (voulu.etat === "joue") {
      if (Math.abs((lecteur.getCurrentTime?.() || 0) - voulu.position) > ECART_MAX) lecteur.seekTo(voulu.position, true);
      lecteur.playVideo();
    } else lecteur.pauseVideo();
    lecteur.setVolume(volume);
    if (voulu.etat === "joue") {
      attente = setTimeout(() => {
        const S = window.YT?.PlayerState;
        if (lecteur && S && voulu.etat === "joue" && [S.UNSTARTED, S.CUED, S.PAUSED, -1].includes(lecteur.getPlayerState?.())) {
          geste = true;
          dessiner();
        }
      }, ATTENTE_GESTE);
    }
    dessiner();
  }

  async function relire() {
    try {
      const r = await fetch("/api/musique-table");
      if (!r.ok) return;
      const m = await r.json();
      voulu = { etat: ["joue", "pause"].includes(m.etat) ? m.etat : "arret", video: typeof m.video === "string" ? m.video : null, position: Number(m.position) || 0 };
      suivre();
    } catch {
      // une coupure : la prochaine nouvelle du flux relira
    }
  }

  function choisir(oui) {
    choix = oui ? "oui" : "non";
    retenir(CLE_CHOIX, choix);
    // Choisi d'un toucher : le lecteur se crée et joue dans la foulée de ce geste.
    suivre();
  }

  caseMusique.addEventListener("change", () => choisir(caseMusique.checked));
  jauge.addEventListener("input", () => {
    volume = Number(jauge.value);
    retenir(CLE_VOLUME, volume);
    lecteur?.setVolume?.(volume);
    dessiner();
  });
  invitation.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-musique]");
    if (b) choisir(b.dataset.musique === "oui");
  });

  ecouterFlux("musique", relire);
  ecouterFlux("table", relire);
  // De loin en loin : la position du MJ avance, celle d'ici aussi ; une nouvelle perdue se rattrape.
  setInterval(() => {
    if (document.visibilityState === "visible" && voulu.etat !== "arret") relire();
  }, 45000);
  dessiner();
  relire();
  return { relire };
}
