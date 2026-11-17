import { api, echapper as e, toast } from "../api.js";
import { aujourdhui, seanceEnCours } from "./seance-en-cours.js";

// Le journal de la séance, noté depuis n'importe quel écran : bouton « Journal » de l'en-tête ou touche N. Une ligne
// s'ajoute ou se retire par les routes du journal, jamais en renvoyant toute la séance : le Mac et l'iPad peuvent noter
// en même temps sans rien perdre. Chaque changement est annoncé (« journal-modifie ») : l'onglet Séances se tient à jour.

const RECENTES = 3;

export const heureFr = (h) => (h ? h.replace(/^0(\d)/, "$1").replace(":", " h ").replace(/ h 00$/, " h") : "");

// La séance où noter : la séance en cours, la même règle que la campagne et le Tableau (seance-en-cours.js).
export function seanceDuJournal(seances, jour = aujourdhui()) {
  return seanceEnCours(seances, { jour });
}

// Les envois partent l'un après l'autre : la réponse d'une ligne ne remplace jamais celle d'une ligne notée après elle.
let file = Promise.resolve();
function enFile(travail) {
  const suite = file.then(travail);
  file = suite.catch(() => {});
  return suite;
}

function annoncer(seance) {
  window.dispatchEvent(new CustomEvent("journal-modifie", { detail: { id: seance.id, journal: seance.journal || [] } }));
  return seance;
}

export function noterAuJournal(id, texte) {
  return enFile(() => api.post(`/api/seances/${encodeURIComponent(id)}/journal`, { texte }).then(annoncer));
}

// Une ligne d'avant les identifiants se désigne par sa place et son texte (le serveur vérifie les deux).
export function retirerDuJournal(id, ligne, rang) {
  const cle = ligne.id || `n${rang}`;
  const verif = ligne.id ? "" : `?texte_ligne=${encodeURIComponent(ligne.texte || "")}`;
  return enFile(() => api.del(`/api/seances/${encodeURIComponent(id)}/journal/${encodeURIComponent(cle)}${verif}`).then(annoncer));
}

// « Annuler » après un retrait : la ligne revient à sa place (après celle qui la précédait, sinon à son rang), avec son
// heure.
export function remettreAuJournal(id, ligne, apres, rang) {
  return enFile(() => api.post(`/api/seances/${encodeURIComponent(id)}/journal/remettre`, { ligne, apres, rang }).then(annoncer));
}

function nomSeance(s) {
  const quand = s.date && s.date !== aujourdhui()
    ? new Date(`${s.date}T12:00`).toLocaleDateString("fr-CH", { weekday: "long", day: "numeric", month: "long" })
    : s.date ? "aujourd'hui" : "";
  return [`Séance ${s.numero ?? ""}`.trim(), s.nom, quand].filter(Boolean).join(" · ");
}

export class JournalRapide {
  constructor(entete) {
    this.bouton = entete.querySelector(".noter-journal");
    this.seance = null;
    this.cible = null;
    this.jeton = 0;
    this.dialogue = null;
    if (!this.bouton) return;
    this.bouton.addEventListener("click", () => this.ouvrir());
    document.addEventListener("keydown", (ev) => this.touche(ev));
    const relire = () => this.relire();
    window.addEventListener("hashchange", relire);
    window.addEventListener("focus", relire);
    // L'onglet Séances annonce ses séances quand il en enregistre une : date, clôture, nouvelle séance.
    window.addEventListener("seances-modifiees", (ev) => this.choisir(ev.detail?.seances));
    window.addEventListener("journal-modifie", (ev) => this.surJournal(ev.detail));
    this.relire();
  }

  async relire() {
    const n = ++this.jeton;
    let seances;
    try {
      seances = await api.get("/api/seances");
    } catch {
      return this.seance; // serveur muet : on garde ce qu'on savait
    }
    if (n === this.jeton) this.choisir(seances);
    return this.seance;
  }

  choisir(seances) {
    if (!Array.isArray(seances)) return;
    ++this.jeton;
    this.seance = seanceDuJournal(seances);
    this.bouton.hidden = !this.seance;
    this.bouton.title = this.seance ? `Noter au journal : ${nomSeance(this.seance)} (touche N)` : "";
    if (this.dialogue?.open && this.seance && this.seance.id === this.cible?.id) {
      this.cible = this.seance;
      this.remplir();
    }
  }

  surJournal({ id, journal } = {}) {
    for (const s of [this.seance, this.cible]) if (s && s.id === id) s.journal = journal;
    if (this.dialogue?.open) this.remplir();
  }

  // N hors d'un champ de saisie et hors d'un dialogue ouvert ; les deux éditeurs n'utilisent pas cette touche.
  touche(ev) {
    if ((ev.key || "").toLowerCase() !== "n" || ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat || ev.isComposing) return;
    const cible = ev.target instanceof Element ? ev.target : null;
    if (cible && (cible.closest("input, textarea, select, dialog") || cible.isContentEditable)) return;
    if (document.querySelector("dialog[open]")) return;
    ev.preventDefault();
    this.ouvrir();
  }

  async ouvrir() {
    if (this.dialogue?.open) return;
    // Le dialogue s'ouvre tout de suite sur la séance déjà connue : les lettres tapées dans la foulée vont dans le
    // champ et non à l'éditeur de plan. La liste des séances se relit ensuite.
    if (!this.seance) await this.relire();
    if (!this.seance) return;
    this.creerDialogue();
    this.cible = this.seance;
    this.remplir();
    this.dialogue.showModal();
    this.champ.focus();
    this.relire();
  }

  creerDialogue() {
    if (this.dialogue) return;
    const d = document.createElement("dialog");
    d.className = "dialogue journal-rapide";
    d.setAttribute("aria-labelledby", "journal-rapide-titre");
    d.innerHTML = `
      <form method="dialog">
        <p class="kicker journal-seance"></p>
        <h2 id="journal-rapide-titre">Noter au journal</h2>
        <ol class="journal-recent" aria-label="Dernières lignes du journal"></ol>
        <input type="text" name="texte" maxlength="2000" autocomplete="off" enterkeyhint="done"
          placeholder="Ce qui vient de se passer, puis Entrée" aria-label="Nouvelle ligne du journal">
        <p class="aide">L'heure se met seule. Touche <kbd>N</kbd> depuis n'importe quel écran, Échap pour fermer.</p>
        <div class="actions">
          <a class="bouton tout-le-journal" href="#/seances">Tout le journal</a>
          <button type="button" data-j="fermer">Fermer</button>
          <button class="principal">Noter</button>
        </div>
      </form>`;
    document.body.append(d);
    this.dialogue = d;
    this.champ = d.querySelector("input");
    d.querySelector("form").addEventListener("submit", (ev) => {
      ev.preventDefault();
      this.noter();
    });
    d.querySelector('[data-j="fermer"]').addEventListener("click", () => d.close());
    d.querySelector(".tout-le-journal").addEventListener("click", () => d.close());
  }

  remplir() {
    const s = this.cible;
    if (!s || !this.dialogue) return;
    this.dialogue.querySelector(".journal-seance").textContent = nomSeance(s);
    this.dialogue.querySelector(".tout-le-journal").href = `#/seances/${encodeURIComponent(s.id)}?onglet=jouer`;
    const lignes = (s.journal || []).slice(-RECENTES);
    this.dialogue.querySelector(".journal-recent").innerHTML = lignes.length
      ? lignes.map((j) => `<li><span class="heure">${e(heureFr(j.t))}</span><span>${e(j.texte)}</span></li>`).join("")
      : '<li class="vide">Rien de noté pour l\'instant.</li>';
  }

  async noter() {
    const texte = this.champ.value.trim();
    const s = this.cible;
    if (!texte || !s) return;
    this.champ.value = "";
    this.dialogue.close();
    try {
      const r = await noterAuJournal(s.id, texte);
      const ligne = [...(r.journal || [])].reverse().find((j) => j.texte === texte);
      toast(`Noté au journal${ligne?.t ? ` à ${heureFr(ligne.t)}` : ""}.`);
    } catch (err) {
      // Le dialogue revient avec la ligne, pour la renvoyer d'un Entrée.
      toast(`Ligne non notée : ${err.message}`, "erreur");
      if (!this.champ.value) this.champ.value = texte;
      if (!this.dialogue.open) this.dialogue.showModal();
      this.champ.focus();
    }
  }
}
