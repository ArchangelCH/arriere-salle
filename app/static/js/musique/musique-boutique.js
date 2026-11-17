import { api, echapper as e, toast } from "../api.js";
import { ecouterTv } from "../ecran-tv/etat-tv.js";
import { decisionCombat } from "./musique-combat.js";
import { vueTv } from "../ecran-tv/tv-commun.js";

// La musique des boutiques. La TV montre une boutique, d'où qu'elle soit envoyée (la fiche, la télécommande, un autre
// écran) : la musique passe en fondu à l'ambiance de boutique choisie dans le panneau, et l'ambiance d'avant revient
// quand la boutique quitte la TV. Mêmes règles que la musique des combats (musique-combat.js, decisionCombat) : rien ne
// démarre si rien ne jouait, rien ne revient si le MJ a changé de musique entre-temps, et une boutique déjà à la TV quand
// on commence à écouter ne fait rien basculer. Un article montré de près ou un autre rayon reste la même boutique.

export const boutiqueALaTv = (etat) => vueTv(etat) === "boutique";

// Le réglage des boutiques, sous celui des combats (page Réglages, section Table et TV).
export function htmlReglageBoutique(ambiances, boutique) {
  if (!ambiances.length) return "";
  return `
      <div class="musique-combat musique-boutique">
        <label class="champ">Ambiance des boutiques<select data-m-boutique>
          <option value="">Aucune</option>
          ${ambiances.map((a) => `<option value="${e(a.id)}" ${a.id === boutique ? "selected" : ""}>${e(a.nom)}</option>`).join("")}
        </select></label>
        <p class="aide">Elle prend le relais en fondu quand la TV montre une boutique, et l'ambiance d'avant revient quand la boutique s'en va. Si rien ne joue, rien ne démarre.</p>
      </div>`;
}

export class MusiqueDesBoutiques {
  // musique : le lecteur de l'en-tête (musique.js). ecouter (ce que montre la TV) se remplace pour les essais sous node.
  constructor(musique, { ecouter = ecouterTv, cible = window } = {}) {
    this.musique = musique;
    this.ecouter = ecouter;
    this.retenue = null;
    this.enBoutique = null; // la dernière lecture : une boutique à la TV ? (null : pas encore de lecture)
    this.fin = null;
    musique.panneau.addEventListener("change", (ev) => {
      if (ev.target.matches?.("[data-m-boutique]")) this.regler(ev.target);
    });
    // Le même réglage posé ailleurs (la page Réglages) passe aussi par ici.
    cible.document?.addEventListener("change", (ev) => {
      if (ev.target.matches?.("[data-m-boutique]") && !musique.panneau.contains?.(ev.target)) this.regler(ev.target);
    });
    cible.addEventListener("musique-changee", () => this.surMusique());
  }

  // Ce que montre la TV ne s'écoute que s'il peut servir : une ambiance de boutique choisie et de la musique qui joue,
  // ou une ambiance à rendre quand la boutique s'en va.
  suivre() {
    const m = this.musique;
    const utile = Boolean(this.retenue || (m.ambianceBoutique && m.courante && !m.enPause));
    if (utile && !this.fin) {
      this.enBoutique = null;
      this.fin = this.ecouter((etat) => this.recu(etat));
    } else if (!utile && this.fin) {
      this.fin();
      this.fin = null;
      this.enBoutique = null;
    }
  }

  joue() {
    return { courante: this.musique.courante || null, enPause: Boolean(this.musique.enPause) };
  }

  recu(etat) {
    if (!etat) return;
    const apres = boutiqueALaTv(etat);
    if (this.enBoutique === null) {
      // Le point de départ : ce que montre la TV quand on commence à écouter ne fait rien basculer.
      this.enBoutique = apres;
      return;
    }
    const avant = this.enBoutique;
    this.enBoutique = apres;
    if (avant !== apres) this.appliquer(decisionCombat({ avant, apres, joue: this.joue(), combat: this.musique.ambianceBoutique, retenue: this.retenue }));
  }

  // Le lecteur a changé (un clic du MJ, ou la bascule elle-même) : s'il a pris la main pendant la boutique, plus de retour.
  surMusique() {
    if (this.retenue && this.enBoutique !== null) {
      this.appliquer(decisionCombat({ avant: this.enBoutique, apres: this.enBoutique, joue: this.joue(), combat: this.musique.ambianceBoutique, retenue: this.retenue }));
    } else this.suivre();
  }

  appliquer({ jouer, retenue }) {
    // Retenue posée avant le fondu : le lecteur annonce son changement aussitôt, et il ne doit pas l'effacer.
    this.retenue = retenue ? { avant: retenue.avant, combat: retenue.combat } : null;
    const a = jouer ? this.musique.ambiances.find((x) => x.id === jouer) : null;
    if (a) this.musique.choisir(a);
    else if (jouer) {
      this.retenue = null;
      toast(`L'ambiance ${retenue ? "de boutique" : "d'avant la boutique"} n'est plus dans la liste de musique.`, "erreur");
    }
    this.suivre();
  }

  // Le réglage part seul, sans la liste ni sa version : le serveur garde la liste telle quelle.
  async regler(select) {
    const m = this.musique;
    select.disabled = true;
    try {
      const d = await api.put("/api/musique", { boutique: select.value || null });
      m.ambiances = d.ambiances;
      m.modifie = d.modifie;
      m.ambianceCombat = d.combat ?? null;
      m.ambianceBoutique = d.boutique ?? null;
      if (!m.edition) m.afficherListe();
      const a = m.ambiances.find((x) => x.id === m.ambianceBoutique);
      toast(a ? `« ${a.nom} » jouera quand la TV montre une boutique.` : "Aucune ambiance de boutique : la musique ne changera plus aux boutiques.");
    } catch (err) {
      toast(`Réglage non enregistré : ${err.message}`, "erreur");
      await m.chargerListe();
    }
    select.disabled = false;
    this.suivre();
  }
}
