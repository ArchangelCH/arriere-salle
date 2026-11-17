// « Dés d'aventure » (lot G, reserve.py), la règle optionnelle du kit (chapitre 08). Éteinte par défaut.
// En jeu : la TV montre les deux réserves en petit dans un coin, chaque joueur peut ajouter un dé d'aventure à son test
// depuis son téléphone (le dé passe au MJ), et le MJ annonce des dés de mésaventure depuis le Tableau ou la télécommande.
// Deux blocs : dans l'onglet Table, les deux réserves avec le transfert à la main (on joue aussi avec de vrais dés) et
// « Tout au groupe » pour commencer une séance ; dans la page Réglages (section Règles de jeu), l'interrupteur et le total
// (quatre dés au départ). Le serveur garde l'état (data/des-aventure.json) ; la vue arrive par le canal des jets
// (jets.js), comme au Tableau.

import { echapper as e, toast } from "../api.js";
import { ecouterLesJets, htmlPips, passerDe, reglerDes } from "./jets.js";

// Le bloc, son dessin et ses gestes, tenus à jour par le canal des jets. garder(bloc) : vrai quand une case du bloc garde
// la main (le total qu'on tape).
function blocDesDes(grille, { classe, dessin, garder = () => false }) {
  if (!grille) return;
  const bloc = document.createElement("div");
  bloc.className = `bloc bloc-des-aventure ${classe}`;
  grille.append(bloc);
  const vue = { r: null };
  const dessiner = () => {
    bloc.innerHTML = dessin(vue.r);
  };
  const changer = async (travail, dit) => {
    try {
      const v = await travail();
      vue.r = v.reserve;
      dessiner();
      if (dit) toast(dit);
    } catch (err) {
      toast(`Dés d'aventure : ${err.message}`, "erreur");
      dessiner();
    }
  };
  dessiner();
  let fin = null;
  fin = ecouterLesJets((v) => {
    if (!bloc.isConnected) return fin && fin();
    if (!v?.reserve) return;
    vue.r = v.reserve;
    if (!garder(bloc)) dessiner();
  });
  return { bloc, vue, changer, dessiner, arreter: () => fin && fin() };
}

// Onglet Table : les réserves et les gestes de jeu.
export function ajouterBlocDesAventure(grille) {
  const b = blocDesDes(grille, {
    classe: "des-aventure-jeu",
    dessin: (r) => {
      const pret = Boolean(r);
      if (pret && !r.actif) {
        return `
      <h2>Dés d'aventure</h2>
      <p>Éteints : ni la TV ni les joueurs n'en voient rien. <a href="#/reglages/regles">Les mettre en jeu dans les Réglages</a>.</p>`;
      }
      return `
      <h2>Dés d'aventure</h2>
      <div class="reserves-table"${pret ? "" : " hidden"}>
        <span class="reserve-mj groupe">${htmlPips(r?.groupe || 0, "groupe")}<b>${e(r?.groupe ?? 0)}</b> au groupe</span>
        <span class="reserve-mj mj">${htmlPips(r?.mj || 0, "mj")}<b>${e(r?.mj ?? 0)}</b> au MJ</span>
      </div>
      <div class="gestes-des-aventure"${pret ? "" : " hidden"}>
        <button type="button" data-vers="mj"${r?.groupe ? "" : " disabled"}>Passer un dé au MJ</button>
        <button type="button" data-vers="groupe"${r?.mj ? "" : " disabled"}>Passer un dé au groupe</button>
        <button type="button" data-remettre${r?.mj || r?.mesaventures?.length ? "" : " disabled"} title="Comme au début d'une séance : le MJ commence sans rien">Tout au groupe</button>
      </div>
      <p class="aide">À la table, on jette aussi de vrais dés : passez-les ici à la main pour que la TV et les téléphones suivent. Éteindre, le total : <a href="#/reglages/regles">Réglages</a>.</p>`;
    },
  });
  if (!b) return null;
  b.bloc.addEventListener("click", (ev) => {
    const bouton = ev.target.closest("button");
    if (!bouton || bouton.disabled) return;
    if (bouton.dataset.vers) return b.changer(() => passerDe(bouton.dataset.vers));
    if (bouton.dataset.remettre !== undefined) return b.changer(() => reglerDes({ remettre: true }), "Tous les dés sont au groupe.");
  });
  return b.arreter;
}

// Page Réglages : l'interrupteur et le total des dés.
export function ajouterReglageDesAventure(grille) {
  const b = blocDesDes(grille, {
    classe: "des-aventure-reglage",
    // Pendant qu'on tape le total, la case garde la main.
    garder: (bloc) => bloc.contains(document.activeElement) && document.activeElement.matches("[data-total]"),
    dessin: (r) => {
      const actif = Boolean(r?.actif);
      const pret = Boolean(r);
      return `
      <h2>Dés d'aventure</h2>
      <div class="choix-publique choix-des-aventure" role="group" aria-label="Dés d'aventure">
        <button type="button" data-actif="oui" aria-pressed="${pret && actif}"${pret ? "" : " disabled"}>En jeu</button>
        <button type="button" data-actif="non" aria-pressed="${pret && !actif}"${pret ? "" : " disabled"}>Éteints</button>
      </div>
      <p>${actif
        ? "En jeu : la TV montre les deux réserves en petit, dans un coin. Un joueur ajoute un dé d'aventure à son test depuis son téléphone, et le dé passe dans votre réserve ; vous annoncez un dé de mésaventure depuis le Tableau ou la télécommande. L'effet du dé est annoncé, vous tranchez."
        : "Éteints : ni la TV ni les joueurs n'en voient rien. La règle optionnelle du kit (chapitre 08) : quatre D6 au groupe, chaque dé joué passe au MJ, chaque dé de mésaventure revient au groupe."}</p>
      <label class="champ total-des-aventure"${pret ? "" : " hidden"}>Le total des dés
        <span class="nombre-cases"><input type="number" inputmode="numeric" min="1" max="${e(r?.total_max ?? 12)}" step="1" data-total value="${e(r?.total ?? 4)}"> dés</span></label>
      <p class="aide">Les deux réserves, les transferts et « Tout au groupe » : <a href="#/table">onglet Table</a>.</p>`;
    },
  });
  if (!b) return;
  b.bloc.addEventListener("click", (ev) => {
    const bouton = ev.target.closest("button[data-actif]");
    if (!bouton || bouton.disabled || bouton.getAttribute("aria-pressed") === "true") return;
    const actif = bouton.dataset.actif === "oui";
    return b.changer(() => reglerDes({ actif }), actif ? "Dés d'aventure en jeu : la TV montre les deux réserves." : "Dés d'aventure éteints.");
  });
  b.bloc.addEventListener("change", (ev) => {
    if (!ev.target.matches("[data-total]")) return;
    const total = Math.round(Number(ev.target.value));
    if (!Number.isFinite(total) || total === b.vue.r?.total) return b.dessiner();
    b.changer(() => reglerDes({ total }), `Dés d'aventure : ${total} en tout.`);
  });
}
