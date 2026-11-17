// L'écran de la table gardé allumé pendant la partie (l'iPad posé sur la table, un ordinateur). Le verrou d'écran du
// navigateur (Wake Lock) quand il existe, c'est-à-dire en https (table.exemple.org). Ailleurs, et d'abord à l'adresse
// du réseau local en http où ce verrou n'existe pas : une vidéo noire et silencieuse de deux secondes tourne en boucle
// dans un coin, à peine visible, car un écran qui lit une vidéo ne se met pas en veille. Elle part d'un geste (le toucher
// qui passe en plein écran) ; quand la page revient au premier plan, elle repart seule. La TV du salon garde son propre
// réglage : rien n'y est lancé.

const VIDEO = "/static/img/eveil.mp4";

// L'avis du premier toucher, quelques secondes en bas de l'écran (table.css, .avis-eveil).
function avisParDefaut(ok) {
  const p = document.createElement("p");
  p.className = "avis-eveil";
  p.setAttribute("role", "status");
  p.textContent = ok ? "L'écran restera allumé pendant la partie."
    : "Cet écran peut se mettre en veille : réglez son verrouillage automatique sur « Jamais ».";
  document.body.appendChild(p);
  setTimeout(() => p.classList.add("cache"), ok ? 4000 : 9000);
  setTimeout(() => p.remove(), ok ? 5000 : 10000);
}

// tv : la TV du salon (rien n'est lancé) ; avis(ok) : dit une fois si l'écran restera allumé.
export function creerEveil({ tv = false, video = VIDEO, avis = avisParDefaut } = {}) {
  let verrou = null;
  let lecteur = null;
  let annonce = false;

  const annoncer = (ok) => {
    if (annonce) return;
    annonce = true;
    avis(ok);
  };

  function lireVideo() {
    if (!lecteur) {
      lecteur = document.createElement("video");
      lecteur.className = "eveil";
      lecteur.src = video;
      lecteur.loop = true;
      lecteur.setAttribute("playsinline", "");
      lecteur.setAttribute("webkit-playsinline", "");
      lecteur.setAttribute("aria-hidden", "true");
      lecteur.setAttribute("tabindex", "-1");
      document.body.appendChild(lecteur);
    }
    if (!lecteur.paused) return Promise.resolve(true);
    let p;
    try {
      p = lecteur.play();
    } catch {
      return Promise.resolve(false);
    }
    return Promise.resolve(p).then(() => true, () => false);
  }

  async function verrouiller() {
    if (verrou && !verrou.released) return true;
    try {
      verrou = await navigator.wakeLock.request("screen");
      verrou.addEventListener("release", () => {
        verrou = null;
      });
      return true;
    } catch {
      verrou = null;
      return false;
    }
  }

  // À chaque toucher. Sans verrou d'écran, la vidéo part tout de suite, dans le geste même : après une attente, le
  // navigateur la refuserait.
  function garder() {
    if (tv) return Promise.resolve(false);
    const essai = navigator.wakeLock ? verrouiller().then((ok) => ok || lireVideo()) : lireVideo();
    return essai.then((ok) => {
      annoncer(ok);
      return ok;
    });
  }

  // Le retour au premier plan, sans geste : le verrou est rendu par le navigateur quand la page se cache, la vidéo
  // s'arrête ; l'un ou l'autre repart (la vidéo déjà lancée d'un geste a le droit de reprendre seule).
  function reprendre() {
    if (tv || document.visibilityState !== "visible") return;
    if (navigator.wakeLock && (annonce || verrou)) verrouiller();
    if (lecteur && lecteur.paused) lireVideo();
  }
  document.addEventListener("visibilitychange", reprendre);

  return { garder, reprendre, etat: () => ({ verrou: Boolean(verrou && !verrou.released), video: Boolean(lecteur && !lecteur.paused) }) };
}
