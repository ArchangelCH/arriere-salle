// Le son d'un test à l'écran de la table : un jingle par issue (réussite, réussite critique, échec, échec critique), joué
// en même temps que le bandeau du jet (jet-tv.js). Les dés libres et les dégâts n'ont pas d'issue : ils restent muets.
//
// Un navigateur ne laisse partir aucun son avant un geste sur la page : le premier toucher (celui qui passe la table en
// plein écran) ouvre la sortie audio et charge les quatre sons. Avant ce geste, un jet reste silencieux, sans erreur.
// Un jet qui arrive pendant le son du précédent le coupe : jamais deux jingles l'un sur l'autre.
//
// Le volume se règle par appareil (regler, de 0 à 1 ; 0 coupe) : la jauge de volume-sons.js, sur l'écran de la table comme
// sur la page Table du coin des joueurs, qui joue les mêmes jingles.

const SONS = {
  reussite: "/static/sons/jet-reussite.mp3",
  "reussite-critique": "/static/sons/jet-reussite-critique.mp3",
  echec: "/static/sons/jet-echec.mp3",
  "echec-critique": "/static/sons/jet-echec-critique.mp3",
};

export function creerSonsJets({ sons = SONS, volume = 1 } = {}) {
  const Contexte = window.AudioContext || window.webkitAudioContext;
  let contexte = null;
  let sortie = null;
  let enCours = null;
  let ouvert = false; // le silence d'ouverture est parti
  let niveau = Math.max(0, Math.min(1, Number(volume) || 0));
  const tampons = {}; // issue : le son décodé, ou la promesse de son chargement

  function charger(issue) {
    if (tampons[issue]) return tampons[issue];
    tampons[issue] = fetch(sons[issue])
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      // La forme à rappels : la seule que connaissent les vieux Safari.
      .then((octets) => new Promise((ok, non) => contexte.decodeAudioData(octets, ok, non)))
      .then((son) => {
        tampons[issue] = son;
        return son;
      })
      .catch(() => {
        // Son introuvable ou illisible : la table reste muette pour cette issue, un autre essai au prochain jet.
        delete tampons[issue];
        return null;
      });
    return tampons[issue];
  }

  // À appeler dans un geste (clic, toucher, touche) : ouvre la sortie audio, puis charge les sons.
  function reveiller() {
    if (!Contexte) return;
    try {
      if (!contexte) {
        // iPhone : sans cela, le bouton « silencieux » de l'appareil coupe ces sons, alors que la jauge de la page est
        // là pour les régler.
        try {
          if (navigator.audioSession) navigator.audioSession.type = "playback";
        } catch {
          // réglage refusé : les sons suivent le bouton de l'appareil
        }
        contexte = new Contexte();
        sortie = contexte.createGain();
        sortie.gain.value = niveau;
        sortie.connect(contexte.destination);
      }
      // « interrupted » : l'état d'un iPhone revenu de veille ou d'un appel.
      if (contexte.state !== "running") contexte.resume();
      // Safari n'ouvre vraiment la sortie qu'à un son parti dans le geste : un silence d'un échantillon, à chaque geste
      // tant qu'elle n'est pas ouverte.
      if (!ouvert || contexte.state !== "running") {
        const silence = contexte.createBufferSource();
        silence.buffer = contexte.createBuffer(1, 1, 22050);
        silence.connect(contexte.destination);
        silence.start(0);
        ouvert = contexte.state === "running";
      }
    } catch {
      contexte = null;
      return;
    }
    Object.keys(sons).forEach(charger);
  }

  function arreter() {
    if (!enCours) return;
    try {
      enCours.stop();
    } catch {
      // déjà fini
    }
    enCours = null;
  }

  // Le volume, de 0 (coupé) à 1 : tout de suite, y compris pour le son en cours.
  function regler(v) {
    const n = Number(v);
    niveau = Math.max(0, Math.min(1, n === n ? n : 0));
    if (sortie) sortie.gain.value = niveau;
    if (!niveau) arreter();
    return niveau;
  }

  async function jouer(issue) {
    if (!contexte || !niveau || !Object.prototype.hasOwnProperty.call(sons, issue)) return false;
    // Un écran revenu de veille a pu suspendre la sortie : la reprise passe si un geste a déjà eu lieu.
    if (contexte.state !== "running") {
      try {
        await contexte.resume();
      } catch {
        return false;
      }
    }
    const son = await charger(issue);
    if (!son || contexte.state !== "running") return false;
    arreter();
    const source = contexte.createBufferSource();
    source.buffer = son;
    source.connect(sortie);
    source.onended = () => {
      if (enCours === source) enCours = null;
    };
    source.start();
    enCours = source;
    return true;
  }

  ["pointerdown", "pointerup", "touchend", "click", "keydown"].forEach((geste) => window.addEventListener(geste, reveiller, { passive: true }));

  return { reveiller, jouer, arreter, regler, volume: () => niveau, pret: () => !!contexte && contexte.state === "running" };
}
