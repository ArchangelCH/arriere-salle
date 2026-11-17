import { api, echapper as e, toast } from "../api.js";
import { ecouterEtatJeu } from "../commun/etat-jeu.js";

// La musique des combats. Un combat commence, d'où qu'il soit lancé (la page du combat, le tableau du MJ, un autre
// écran) : la musique passe en fondu à l'ambiance de combat choisie dans le panneau, et l'ambiance d'avant revient à la
// fin. Tout se lit dans l'état du jeu partagé (etat-jeu.js), relu toutes les cinq secondes et aussitôt qu'un écran de
// cette page annonce un combat commencé ou fini. Le MJ garde la main : rien ne démarre si rien ne jouait, rien ne revient
// s'il a changé de musique pendant le combat, et un combat déjà en cours quand on commence à écouter (ouverture de la
// page, musique lancée en plein combat) ne fait rien basculer.

// La décision, sans rien toucher. avant, apres : un combat est-il en cours à la lecture précédente, à celle-ci (avant
// null : pas encore de lecture, rien ne bascule) ; joue : { courante, enPause } du lecteur ; combat : l'ambiance de
// combat choisie (null : aucune) ; retenue : { avant, combat } depuis une bascule, sinon null.
// Rend { jouer, retenue } : l'ambiance vers laquelle fondre (null : ne rien toucher) et ce qu'il faut retenir ensuite.
export function decisionCombat({ avant = null, apres = false, joue = {}, combat = null, retenue = null } = {}) {
  const enCours = joue.courante && !joue.enPause ? joue.courante : null;
  if (avant === null || avant === undefined) return { jouer: null, retenue: null };
  if (!avant && apres) {
    if (!combat || !enCours || enCours === combat) return { jouer: null, retenue: null };
    return { jouer: combat, retenue: { avant: enCours, combat } };
  }
  if (avant && !apres) {
    // L'ambiance d'avant revient seulement si celle du combat joue encore : en pause ou remplacée, le MJ a la main.
    return { jouer: retenue && enCours === retenue.combat ? retenue.avant : null, retenue: null };
  }
  // Ni début ni fin : une autre musique choisie entre-temps (ou plus rien) et l'on ne reviendra pas en arrière.
  if (retenue && (!apres || joue.courante !== retenue.combat)) return { jouer: null, retenue: null };
  return { jouer: null, retenue };
}

// La musique des combats de la page (celle de l'en-tête) : son réglage se lit aussi ailleurs (« Avant de jouer »).
let enPage = null;

// Le réglage, une fois la liste lue : { ambiances, combat } (combat : l'ambiance choisie, ou null), sinon null.
export function reglageCombat() {
  const m = enPage?.musique;
  return m?.chargee ? { ambiances: m.ambiances || [], combat: m.ambianceCombat ?? null } : null;
}

// Un combat est-il en cours ? Des héros au combat (la lecture du serveur) ou le combat qu'un écran vient d'annoncer.
export const combatEnCours = (jeu) => Boolean(jeu && (jeu.combat || Object.keys(jeu.auCombat || {}).length));

// Le réglage des combats (page Réglages, section Table et TV ; la préparation du combat le propose aussi).
export function htmlReglageCombat(ambiances, combat) {
  if (!ambiances.length) return "";
  return `
      <div class="musique-combat">
        <label class="champ">Ambiance de combat<select data-m-combat>
          <option value="">Aucune</option>
          ${ambiances.map((a) => `<option value="${e(a.id)}" ${a.id === combat ? "selected" : ""}>${e(a.nom)}</option>`).join("")}
        </select></label>
        <p class="aide">Elle prend le relais en fondu quand un combat commence, et l'ambiance d'avant revient à la fin. Si rien ne joue, rien ne démarre.</p>
      </div>`;
}

export class MusiqueDesCombats {
  // musique : le lecteur de l'en-tête (musique.js). ecouter et cible (l'état du jeu, la fenêtre) se remplacent pour les
  // essais sous node.
  constructor(musique, { ecouter = ecouterEtatJeu, cible = window } = {}) {
    this.musique = musique;
    this.ecouter = ecouter;
    this.retenue = null;
    this.auCombat = null; // la dernière lecture : un combat en cours ? (null : pas encore de lecture fraîche)
    this.abonne = 0;
    this.fin = null;
    musique.panneau.addEventListener("change", (ev) => {
      if (ev.target.matches?.("[data-m-combat]")) this.regler(ev.target);
    });
    // Le même réglage posé ailleurs (la page Réglages, la préparation du combat) passe aussi par ici.
    cible.document?.addEventListener("change", (ev) => {
      if (ev.target.matches?.("[data-m-combat]") && !musique.panneau.contains?.(ev.target)) this.regler(ev.target);
    });
    cible.addEventListener("musique-changee", () => this.surMusique());
    enPage = this;
  }

  // L'état du jeu ne s'écoute que s'il peut servir : une ambiance de combat choisie et de la musique qui joue, ou une
  // ambiance à rendre à la fin du combat.
  suivre() {
    const m = this.musique;
    const utile = Boolean(this.retenue || (m.ambianceCombat && m.courante && !m.enPause));
    if (utile && !this.fin) {
      this.auCombat = null;
      this.abonne = Date.now();
      this.fin = this.ecouter((jeu) => this.recu(jeu));
    } else if (!utile && this.fin) {
      this.fin();
      this.fin = null;
      this.auCombat = null;
    }
  }

  joue() {
    return { courante: this.musique.courante || null, enPause: Boolean(this.musique.enPause) };
  }

  recu(jeu) {
    if (!jeu) return;
    const apres = combatEnCours(jeu);
    if (this.auCombat === null) {
      // Le point de départ : une lecture faite depuis qu'on écoute (celle qu'on avait déjà peut dater).
      if ((jeu.lu || 0) >= this.abonne) this.auCombat = apres;
      return;
    }
    const avant = this.auCombat;
    this.auCombat = apres;
    if (avant !== apres) this.appliquer(decisionCombat({ avant, apres, joue: this.joue(), combat: this.musique.ambianceCombat, retenue: this.retenue }));
  }

  // Le lecteur a changé (un clic du MJ, ou la bascule elle-même) : s'il a pris la main pendant le combat, plus de retour.
  surMusique() {
    if (this.retenue && this.auCombat !== null) {
      this.appliquer(decisionCombat({ avant: this.auCombat, apres: this.auCombat, joue: this.joue(), combat: this.musique.ambianceCombat, retenue: this.retenue }));
    } else this.suivre();
  }

  appliquer({ jouer, retenue }) {
    // Retenue posée avant le fondu : le lecteur annonce son changement aussitôt, et il ne doit pas l'effacer.
    this.retenue = retenue;
    const a = jouer ? this.musique.ambiances.find((x) => x.id === jouer) : null;
    if (a) this.musique.choisir(a);
    else if (jouer) {
      this.retenue = null;
      toast(`L'ambiance ${retenue ? "de combat" : "d'avant le combat"} n'est plus dans la liste de musique.`, "erreur");
    }
    this.suivre();
  }

  // Le réglage part seul, sans la liste ni sa version : le serveur garde la liste telle quelle.
  async regler(select) {
    const m = this.musique;
    select.disabled = true;
    try {
      const d = await api.put("/api/musique", { combat: select.value || null });
      m.ambiances = d.ambiances;
      m.modifie = d.modifie;
      m.ambianceCombat = d.combat ?? null;
      m.ambianceBoutique = d.boutique ?? null;
      if (!m.edition) m.afficherListe();
      const a = m.ambiances.find((x) => x.id === m.ambianceCombat);
      toast(a ? `« ${a.nom} » jouera pendant les combats.` : "Aucune ambiance de combat : la musique ne changera plus au combat.");
    } catch (err) {
      toast(`Réglage non enregistré : ${err.message}`, "erreur");
      await m.chargerListe();
    }
    select.disabled = false;
    this.suivre();
  }
}
