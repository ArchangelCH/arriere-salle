// La jauge de volume des jingles des tests (sons-jets.js), par appareil : sur la page Table du coin des joueurs et sur
// l'écran de la table. Un bouton rond (un haut-parleur) déplie la jauge, de 0 à 100 % ; « Couper » garde le réglage pour
// le retour du son. Le réglage reste sur cet appareil (localStorage), jamais sur le serveur : chacun le sien.
//
// Un navigateur ne joue aucun son avant un geste sur la page : tant que la sortie n'est pas ouverte, la jauge le dit.
//
// Importé par table.js, donc transpilé pour l'écran de la table : rien au-delà d'ES2019 ici.

const CLE = "table.volume-sons";
const DEFAUT = { volume: 100, coupe: false };
const HAUT_PARLEUR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="plein" d="M4 9.5h3.2L12 5.6v12.8l-4.8-3.9H4Z"/><path class="ondes" d="M15.4 9.2a4 4 0 0 1 0 5.6M17.9 6.8a7.4 7.4 0 0 1 0 10.4"/><path class="barre" d="M15.5 9.5l5 5M20.5 9.5l-5 5"/></svg>';

function borne(v) {
  const n = Math.round(Number(v));
  return n === n ? Math.max(0, Math.min(100, n)) : DEFAUT.volume;
}

// { volume (0 à 100), coupe } : le réglage de cet appareil, ou celui par défaut si rien n'est gardé (ou si le stockage est refusé).
export function lireVolume() {
  try {
    const lu = JSON.parse(localStorage.getItem(CLE) || "null");
    if (lu && typeof lu === "object") return { volume: borne(lu.volume), coupe: lu.coupe === true };
  } catch (err) {
    // stockage refusé ou valeur abîmée : le réglage par défaut
  }
  return { volume: DEFAUT.volume, coupe: DEFAUT.coupe };
}

export function garderVolume(reglage) {
  try {
    localStorage.setItem(CLE, JSON.stringify({ volume: borne(reglage.volume), coupe: reglage.coupe === true }));
    return true;
  } catch (err) {
    return false; // navigation privée : le réglage vaut pour cette page
  }
}

// Ce que la sortie audio doit jouer : de 0 à 1.
export function niveauDe(reglage) {
  return reglage.coupe ? 0 : borne(reglage.volume) / 100;
}

// sons : ce que rend creerSonsJets. Pose le bouton et sa jauge dans parent (le corps de la page par défaut), applique le
// réglage gardé, et rend { reglage(), fermer() }.
export function monterVolume(sons, options) {
  const o = options || {};
  let reglage = lireVolume();
  sons.regler(niveauDe(reglage));
  const racine = document.createElement("div");
  racine.className = `volume-sons${o.classe ? ` ${o.classe}` : ""}`;
  racine.innerHTML = `<button type="button" aria-expanded="false" aria-controls="panneau-volume"></button>
    <div class="panneau-volume" id="panneau-volume" hidden>
      <div class="ligne-volume"><label for="jauge-volume">Sons des tests</label><input type="range" id="jauge-volume" min="0" max="100" step="5"><output for="jauge-volume"></output></div>
      <p class="aide-volume" hidden>Touchez la page une fois pour activer le son.</p>
    </div>`;
  (o.parent || document.body).appendChild(racine);
  const bouton = racine.querySelector("button");
  const panneau = racine.querySelector(".panneau-volume");
  const jauge = racine.querySelector("input");
  const sortie = racine.querySelector("output");
  const aide = racine.querySelector(".aide-volume");
  bouton.innerHTML = HAUT_PARLEUR;

  function dessiner() {
    const muet = reglage.coupe || reglage.volume === 0;
    racine.setAttribute("data-coupe", muet ? "oui" : "non");
    bouton.querySelector(".ondes").style.display = muet ? "none" : "";
    bouton.querySelector(".barre").style.display = muet ? "" : "none";
    const dit = muet ? "Sons des tests coupés" : `Sons des tests : ${reglage.volume} %`;
    bouton.setAttribute("aria-label", `${dit}. Régler le volume`);
    bouton.title = dit;
    jauge.value = String(muet ? 0 : reglage.volume);
    sortie.textContent = muet ? "Coupé" : `${reglage.volume} %`;
    aide.hidden = sons.pret() || muet;
  }

  function fermer() {
    panneau.hidden = true;
    bouton.setAttribute("aria-expanded", "false");
  }

  bouton.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const ouvrir = panneau.hidden;
    panneau.hidden = !ouvrir;
    bouton.setAttribute("aria-expanded", String(ouvrir));
    // Le toucher du bouton est un geste : la sortie audio s'ouvre avec lui.
    sons.reveiller();
    setTimeout(dessiner, 150);
  });
  panneau.addEventListener("click", (ev) => ev.stopPropagation());
  jauge.addEventListener("input", () => {
    const v = borne(jauge.value);
    // La jauge à zéro coupe ; remontée, elle rend le son à ce niveau.
    reglage = v === 0 ? { volume: reglage.volume || DEFAUT.volume, coupe: true } : { volume: v, coupe: false };
    sons.regler(niveauDe(reglage));
    garderVolume(reglage);
    dessiner();
  });
  // La jauge lâchée : un jingle pour entendre le niveau choisi.
  jauge.addEventListener("change", () => {
    if (niveauDe(reglage) > 0) sons.jouer("reussite");
  });
  document.addEventListener("click", () => {
    if (!panneau.hidden) fermer();
    setTimeout(dessiner, 150);
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !panneau.hidden) {
      fermer();
      bouton.focus();
    }
  });
  dessiner();
  return { reglage: () => ({ volume: reglage.volume, coupe: reglage.coupe }), fermer, racine };
}
