// Page Réglages : « La table dans le coin » (section Coin des joueurs). Ouverte, chaque joueur voit dans son coin
// (onglet La table) le plan que montre la TV, sans votre caméra, et y retrouve son héros ; pour une autre vue, seulement
// ce que c'est. Fermée par défaut : rien ne part. Le serveur garde le réglage (/api/table-joueurs, table_joueurs.py).
//
// Les déplacements des joueurs (lot E2, deplacement.py), section Règles de jeu : pions libres (posés seuls,
// « Annuler » dans la boîte), à valider (le MJ accepte ou refuse, dans la boîte ou d'un clic sur le plan), ou figés ; la
// distance d'un déplacement hors combat et celle d'un tour de combat, en cases ; un héros qui entre dans une pièce cachée
// par une porte ouverte la révèle, ou non (les cases cachées restent alors hors d'atteinte). Les deux blocs lisent et
// écrivent le même réglage, chacun sa part.

import { api, echapper as e, toast } from "../api.js";

const MODES = [
  ["libres", "Libres", "Le pion va où le joueur le pose, dans les règles ; vous pouvez l'annuler depuis la boîte des demandes."],
  ["a-valider", "À valider", "Le pion fantôme attend votre accord : dans la boîte des demandes, ou d'un clic sur le plan ouvert dans l'éditeur."],
  ["figes", "Figés", "Personne ne bouge son pion depuis le coin ; vous les déplacez vous-même."],
];
const BORNES = { distance: [1, 60], distance_combat: [1, 30] };

// Un bloc du réglage : sa classe, son titre, son dessin (l'état lu, ou null avant), ses gestes.
function blocDuReglage(grille, { classe, titre, dessin, clics, changements }) {
  if (!grille) return;
  const bloc = document.createElement("div");
  bloc.className = `bloc ${classe}`;
  grille.append(bloc);
  const vue = { etat: null };
  const dessiner = () => {
    bloc.innerHTML = dessin(vue.etat);
  };
  const changer = async (corps, dit) => {
    try {
      vue.etat = await api.put("/api/table-joueurs", corps);
      dessiner();
      if (dit) toast(dit);
    } catch (err) {
      toast(`Réglage non enregistré : ${err.message}`, "erreur");
      dessiner();
    }
  };
  dessiner();
  api.get("/api/table-joueurs").then((r) => { vue.etat = r; dessiner(); }).catch(() => {
    bloc.innerHTML = `<h2>${titre}</h2><p class="aide">Le réglage ne se lit pas pour l'instant.</p>`;
  });
  bloc.addEventListener("click", (ev) => clics(ev, vue, changer));
  if (changements) bloc.addEventListener("change", (ev) => changements(ev, vue, changer, dessiner));
}

export function ajouterBlocTableJoueurs(grille) {
  blocDuReglage(grille, {
    classe: "bloc-table-joueurs",
    titre: "La table dans le coin",
    dessin: (etat) => {
      const ouverte = Boolean(etat?.ouverte);
      const publie = etat?.publie;
      const voit = !ouverte || !publie || !publie.ouverte ? ""
        : publie.genre === "plan"
          ? ` En ce moment, ils voient le plan de la TV${publie.pions ? `, et ${publie.pions === 1 ? "un joueur y retrouve son héros" : `${publie.pions} joueurs y retrouvent leur héros`}` : ""}.`
          : " En ce moment, la TV ne montre pas de plan : ils lisent seulement ce qu'elle montre, par exemple «\u00a0La TV montre : la carte\u00a0».";
      return `
      <h2>La table dans le coin</h2>
      <div class="choix-publique choix-table-joueurs" role="group" aria-label="Table ouverte aux joueurs">
        <button type="button" data-ouverte="oui" aria-pressed="${ouverte}">Ouverte</button>
        <button type="button" data-ouverte="non" aria-pressed="${!ouverte}">Fermée</button>
      </div>
      <p>${ouverte
        ? `Ouverte : sur leur téléphone (onglet « La table »), les joueurs voient le plan que montre la TV, le déplacent et le zooment à leur guise, sans suivre votre caméra, et y retrouvent leur héros. Rien de plus que ce que montre la TV.${voit}`
        : "Fermée : l'onglet « La table » du coin des joueurs dit seulement qu'elle n'est pas ouverte."}</p>
      <label class="case"><input type="checkbox" data-musique-coin ${etat?.musique !== false ? "checked" : ""}${etat ? "" : " disabled"}> Votre musique à la table du coin</label>
      <p class="aide">${etat?.musique !== false
        ? "Ce que joue votre lecteur de musique s'entend aussi sur leur page « La table », pour ceux qui le choisissent sur leur appareil (en visio, par exemple). Ni le nom ni la note de l'ambiance ne partent."
        : "Votre musique reste sur votre ordinateur : rien ne part vers le coin."}</p>
      <p class="aide">Leurs pions et leurs distances : <a href="#/reglages/regles">Règles de jeu</a>.</p>`;
    },
    changements: (ev, vue, changer) => {
      if (ev.target.matches("[data-musique-coin]")) changer({ musique: ev.target.checked }, ev.target.checked ? "Votre musique s'entend aussi à la table du coin." : "Votre musique reste sur votre ordinateur.");
    },
    clics: (ev, vue, changer) => {
      const b = ev.target.closest("[data-ouverte]");
      if (!b || b.getAttribute("aria-pressed") === "true") return;
      const ouverte = b.dataset.ouverte === "oui";
      changer({ ouverte }, ouverte ? "Table ouverte aux joueurs : leur onglet «\u00a0La table\u00a0» montre le plan de la TV." : "Table fermée aux joueurs.");
    },
  });
}

export function ajouterBlocPionsJoueurs(grille) {
  blocDuReglage(grille, {
    classe: "bloc-table-joueurs bloc-pions-joueurs",
    titre: "Les pions des joueurs",
    dessin: (etat) => {
      const mode = MODES.find(([m]) => m === etat?.pions) || MODES[1];
      const pret = !!etat;
      return `
      <h2>Les pions des joueurs</h2>
      <p class="aide">Depuis la table de leur coin${etat && !etat.ouverte ? " (fermée en ce moment)" : ""}, chaque joueur bouge son héros.</p>
      <div class="choix-publique choix-pions-joueurs" role="group" aria-label="Les joueurs bougent leur pion">
        ${MODES.map(([m, nom]) => `<button type="button" data-pions="${m}" aria-pressed="${pret && m === mode[0]}"${pret ? "" : " disabled"}>${nom}</button>`).join("")}
      </div>
      <p class="aide">${e(mode[2])}</p>
      <div class="reglages-pions">
        <label class="champ">Hors combat, par déplacement
          <span class="nombre-cases"><input type="number" inputmode="numeric" min="${BORNES.distance[0]}" max="${BORNES.distance[1]}" step="1" data-distance="distance" value="${e(etat?.distance ?? 12)}"${pret ? "" : " disabled"}> cases</span></label>
        <label class="champ">En combat, par tour
          <span class="nombre-cases"><input type="number" inputmode="numeric" min="${BORNES.distance_combat[0]}" max="${BORNES.distance_combat[1]}" step="1" data-distance="distance_combat" value="${e(etat?.distance_combat ?? 6)}"${pret ? "" : " disabled"}> cases</span></label>
        <label class="case"><input type="checkbox" data-entrer ${etat?.entrer !== false ? "checked" : ""}${pret ? "" : " disabled"}> Entrer révèle la pièce</label>
      </div>
      <p class="aide">En combat, un joueur ne bouge qu'à son tour, dans la limite du tour comptée depuis sa case du début du tour. ${etat?.entrer !== false
        // Lot E4 : la case couvre aussi les portes fermées et le pas dans le noir.
        ? "Un héros ouvre les portes fermées de son chemin (une porte fermée à clé l'arrête, une porte secrète aussi, comme un mur) et peut avancer d'un pas dans le noir là où rien ne montre de mur. La pièce où il entre se révèle aux joueurs, ou seulement ses alentours si elle l'était déjà en partie. « Annuler », dans la boîte des demandes, remet tout comme avant."
        : "Les portes fermées arrêtent les héros et les cases encore cachées restent hors d'atteinte : vous ouvrez et révélez vous-même."}</p>`;
    },
    clics: (ev, vue, changer) => {
      const b = ev.target.closest("[data-pions]");
      if (!b || b.getAttribute("aria-pressed") === "true") return;
      const mode = MODES.find(([m]) => m === b.dataset.pions);
      changer({ pions: mode[0] }, `Pions des joueurs : ${mode[1].toLowerCase()}.`);
    },
    changements: (ev, vue, changer, dessiner) => {
      const champ = ev.target;
      if (champ.matches("[data-entrer]")) return changer({ entrer: champ.checked });
      const cle = champ.dataset.distance;
      if (!cle) return;
      const [min, max] = BORNES[cle];
      const v = Math.round(Number(champ.value));
      if (!Number.isFinite(v) || v < min || v > max) {
        toast(`De ${min} à ${max} cases.`, "erreur");
        return dessiner();
      }
      changer({ [cle]: v });
    },
  });
}
