// Page Réglages (section Rédaction) : l'aide à l'écriture des joueurs (« Proposer » et « Relire » sous chaque passage
// de leur histoire, aide.py et aide_mj.py). Un compteur pour le mois plutôt qu'une ligne par aide : combien chaque
// joueur en a pris, ce qu'elles ont coûté, ce qui attend ; et les deux réglages, les aides par joueur (un nombre propre
// à un joueur, au besoin) et le plafond du mois en dollars pour toute la tablée. Rien du texte des joueurs
// (/api/aide-joueurs).

import { api, echapper as e, toast } from "../api.js";

const dollars = (v) => `${v > 0 && v < 0.01 ? "moins de 0,01" : Number(v || 0).toFixed(2).replace(".", ",")} $`;
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

export function ajouterBlocAideJoueurs(grille) {
  if (!grille) return;
  const bloc = document.createElement("div");
  bloc.className = "bloc bloc-aide-joueurs";
  grille.append(bloc);
  let etat = null;

  const dessiner = () => {
    if (!etat) {
      bloc.innerHTML = '<h2>L\'aide à l\'écriture des joueurs</h2><p class="aide">Lecture du compte du mois…</p>';
      return;
    }
    const r = etat.reglages;
    const mois = new Date(`${etat.mois}-01T12:00:00`).toLocaleDateString("fr-CH", { month: "long" });
    bloc.innerHTML = `
      <h2>L'aide à l'écriture des joueurs</h2>
      ${etat.disponible ? "" : '<p class="alerte">Aucune clé d\'API sur le serveur : les joueurs lisent « Indisponible pour l\'instant » sous leurs passages.</p>'}
      <p><strong>${pluriel(etat.aides, "aide", "aides")}</strong> en ${e(mois)}, pour ${dollars(etat.total)} sur un plafond de ${dollars(r.plafond)}.
        ${etat.en_file ? ` ${pluriel(etat.en_file, "aide attend", "aides attendent")} son tour.` : ""}</p>
      ${etat.epuise ? '<p class="alerte">Plafond atteint : l\'aide est fermée aux joueurs jusqu\'au mois prochain, ou jusqu\'à ce que vous le releviez.</p>' : ""}
      ${etat.pause ? '<p class="aide">Coin en pause : les aides demandées attendent qu\'il rouvre.</p>' : ""}
      <form class="reglages-aide-joueurs">
        <label class="champ">Aides par joueur et par mois<input type="number" name="par_joueur" min="0" max="100" step="1" value="${e(r.par_joueur)}" inputmode="numeric"></label>
        <label class="champ">Plafond du mois, en dollars<input type="number" name="plafond" min="0" max="200" step="0.5" value="${e(r.plafond)}" inputmode="decimal"></label>
        <div class="actions"><button type="submit">Enregistrer</button></div>
      </form>
      ${etat.joueurs.length ? `<ul class="liste-simple aide-par-joueur">${etat.joueurs.map((j) => `
        <li data-joueur="${e(j.id)}">
          <span>${e(j.nom)}${j.en_route ? ' <i class="meta">une aide en route</i>' : ""}</span>
          <span>${j.utilisees} sur
            <input type="number" class="limite-joueur" min="0" max="100" step="1" value="${e(j.limite)}" aria-label="Aides par mois pour ${e(j.nom)}" inputmode="numeric">
            · ${dollars(j.cout)}
            ${j.particulier ? `<button type="button" class="lien" data-commun="${e(j.id)}">comme les autres</button>` : ""}</span>
        </li>`).join("")}</ul>` : ""}
      <p class="aide">0 aide par joueur ferme l'aide. Une aide coûte quelques centimes ; chaque réponse est relue avant de partir (rien de ce que les joueurs ne savent pas, ni le nom caché de l'auberge), et rien n'entre sur une fiche sans passer par vous.</p>`;
  };

  const lire = () => api.get("/api/aide-joueurs").then((r) => { etat = r; dessiner(); }).catch(() => {
    bloc.innerHTML = '<h2>L\'aide à l\'écriture des joueurs</h2><p class="aide">Le compte du mois ne se lit pas pour l\'instant.</p>';
  });

  const regler = async (corps, message) => {
    try {
      etat = await api.put("/api/aide-joueurs", corps);
      dessiner();
      toast(message);
    } catch (err) {
      toast(`Réglage non enregistré : ${err.message}`, "erreur");
      lire();
    }
  };

  bloc.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const parJoueur = Number(f.par_joueur.value);
    const plafond = Number(f.plafond.value);
    if (!Number.isInteger(parJoueur) || parJoueur < 0 || parJoueur > 100) return toast("Aides par joueur : un nombre entier de 0 à 100.", "erreur");
    if (!Number.isFinite(plafond) || plafond < 0 || plafond > 200) return toast("Plafond du mois : de 0 à 200 dollars.", "erreur");
    regler({ par_joueur: parJoueur, plafond }, parJoueur ? `Aide des joueurs : ${pluriel(parJoueur, "aide", "aides")} par mois, plafond ${dollars(plafond)}.` : "Aide des joueurs fermée.");
  });
  bloc.addEventListener("change", (ev) => {
    const champ = ev.target.closest(".limite-joueur");
    if (!champ) return;
    const id = champ.closest("[data-joueur]").dataset.joueur;
    const n = Number(champ.value);
    if (!Number.isInteger(n) || n < 0 || n > 100) return toast("Un nombre entier de 0 à 100.", "erreur");
    const nom = etat?.joueurs.find((j) => j.id === id)?.nom || "ce joueur";
    regler({ joueurs: { [id]: n } }, `${nom} : ${pluriel(n, "aide", "aides")} par mois.`);
  });
  bloc.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-commun]");
    if (!b) return;
    regler({ joueurs: { [b.dataset.commun]: null } }, "Ce joueur a de nouveau le nombre de tous.");
  });
  dessiner();
  lire();
}
