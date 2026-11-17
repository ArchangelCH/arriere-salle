// Les notes du journal prises depuis le téléphone.

import { api } from "../api.js";
import { heureFr, noterAuJournal } from "../seances/journal.js";
import { Reessai, injoignable, raison } from "../commun/reessai.js";
import { d, garder, seanceEnCours, uneLigne } from "./etat.js";
import { annoncer } from "./gestes.js";
import { afficher } from "./rendu.js";

// Une ligne notée attend sur le téléphone (et dans sa mémoire) jusqu'à ce que le serveur l'ait reçue.
const reessaiNotes = new Reessai(() => envoyerNotes(), () => afficher());
let envoiNotes = null;

function garderNotes() {
  garder("telecommande.notes", d.notes);
}

function majSeance(seance) {
  const k = d.seances.findIndex((s) => s.id === seance?.id);
  if (k >= 0) d.seances[k] = seance;
}

async function noterUne(n) {
  // Un renvoi : la ligne a pu arriver sans que la réponse revienne. Déjà au journal, elle n'y entre pas deux fois.
  if (n.essais) {
    const s = await api.get(`/api/seances/${encodeURIComponent(n.seance)}`);
    if ((Array.isArray(s.journal) ? s.journal : []).slice(-6).some((l) => l?.texte === n.texte)) return s;
  }
  n.essais = (n.essais || 0) + 1;
  garderNotes();
  return noterAuJournal(n.seance, n.texte);
}

function envoyerNotes() {
  if (envoiNotes) return envoiNotes;
  envoiNotes = (async () => {
    while (d.notes.length) {
      const n = d.notes[0];
      let seance;
      try {
        seance = await noterUne(n);
      } catch (err) {
        if (injoignable(err)) {
          reessaiNotes.echec(err);
          annoncer("La note attend sur le téléphone : le serveur ne répond pas. Nouvel essai automatique.", "echec");
          return;
        }
        // Refusée (séance retirée, ligne trop longue) : elle revient dans le champ, rien n'est perdu.
        d.notes.shift();
        garderNotes();
        const champ = document.getElementById("note");
        if (!champ.value.trim()) champ.value = n.texte;
        annoncer(raison(err), "echec");
        continue;
      }
      d.notes.shift();
      garderNotes();
      majSeance(seance);
      const ligne = Array.isArray(seance?.journal) ? seance.journal[seance.journal.length - 1] : null;
      annoncer(`Noté au journal${ligne?.t ? ` à ${heureFr(ligne.t)}` : ""}.`, "fait");
    }
    reessaiNotes.reussite();
  })().finally(() => {
    envoiNotes = null;
    afficher();
  });
  return envoiNotes;
}

function noter(ev) {
  ev?.preventDefault();
  const champ = document.getElementById("note");
  const texte = uneLigne(champ.value);
  if (!texte) return;
  const s = seanceEnCours();
  if (!s) return annoncer("aucune séance ouverte où noter : créez-la dans l'atelier.", "echec");
  d.notes.push({ seance: s.id, texte, essais: 0 });
  garderNotes();
  champ.value = "";
  annoncer("Note au journal…", "attente");
  afficher();
  envoyerNotes();
}

export { envoyerNotes, majSeance, noter, reessaiNotes };
