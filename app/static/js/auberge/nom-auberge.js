// Page Réglages (section Table et TV) : le nom que lisent les joueurs à la place du vrai nom de l'auberge, caché à la
// TV, dans le carnet et dans les textes écrits pour eux. « l'auberge » tant que le MJ n'en a pas choisi un autre. Le
// serveur garde le réglage (/api/nom-auberge, masque.py) et refuse tout nom qui contiendrait le vrai ; il rend aussi
// trois phrases telles que les joueurs les liront, pour voir comment le nom se lie (« à l'auberge du Gué », « au
// Chaudron »).

import { api, echapper as e, toast } from "../api.js";
import { estInvite } from "../mj/role.js";

// Le nom que liront les joueurs, pour le leur citer dans un avertissement (« la TV dira « l'auberge du Gué » ») ; le
// nom par défaut si le réglage ne se lit pas.
export async function nomPourLesJoueurs() {
  // Le réglage est au MJ principal (GET /api/nom-auberge lui est réservé) : un MJ invité cite le nom par défaut.
  if (estInvite()) return "l'auberge";
  const d = await api.get("/api/nom-auberge").catch(() => null);
  return (d && (d.public || d.defaut)) || "l'auberge";
}

const guillemets = (t) => `« ${e(t)} »`;

export function ajouterBlocNomAuberge(grille) {
  if (!grille) return;
  const bloc = document.createElement("div");
  bloc.className = "bloc bloc-nom-auberge";
  bloc.innerHTML = `
    <h2>Le nom de l'auberge</h2>
    <p>Son vrai nom reste caché aux joueurs. À la TV, dans le carnet et dans les textes écrits pour eux, il devient :</p>
    <form class="ligne-nom-auberge">
      <input type="text" name="nom" maxlength="60" autocomplete="off" aria-label="Nom de l'auberge pour les joueurs">
      <button type="submit">Enregistrer</button>
    </form>
    <p class="aide exemples-auberge"></p>
    <p class="aide">Laissé vide : « l'auberge ». Écrivez-le avec son article, comme dans une phrase (« l'auberge de… », « le… »).</p>`;
  grille.append(bloc);
  const champ = bloc.querySelector("input");
  const exemples = bloc.querySelector(".exemples-auberge");
  const montrer = (d) => {
    champ.placeholder = d.defaut || "l'auberge";
    if (document.activeElement !== champ) champ.value = d.nom || "";
    exemples.innerHTML = `Les joueurs liront ${(d.exemples || []).map(guillemets).join(", ")}.`;
  };
  api.get("/api/nom-auberge").then(montrer).catch(() => {
    exemples.textContent = "Le réglage ne se lit pas pour l'instant.";
  });
  bloc.querySelector("form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      const d = await api.put("/api/nom-auberge", { nom: champ.value });
      champ.blur();
      montrer(d);
      // Un message à la fois : un inconnu nommé passe avant la confirmation (toast écrit du texte, sans balise).
      const inconnus = (d.secrets || []).map((x) => x.nom).filter(Boolean);
      if (inconnus.length) toast(`Enregistré, mais ce nom nomme ${inconnus.join(", ")}, encore inconnu${inconnus.length > 1 ? "s" : ""} des joueurs.`, "erreur");
      else toast(d.nom ? `Les joueurs liront « ${d.public} ».` : "Les joueurs liront de nouveau « l'auberge ».");
    } catch (err) {
      toast(err.message, "erreur");
    }
  });
}
