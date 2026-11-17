// « Votre suite au carnet » (page Réglages d'un MJ invité, lot MJ-7) : ses séances se numérotent à part, dans le carnet des
// joueurs, les « croisés » et sur le carton d'épisode de la TV : « Quête annexe 2 », jamais « Séance 2 », qui est la suite
// du MJ principal. Il peut lui donner un autre nom ; un nom qui dirait ce que les joueurs ne savent pas laisse la suite par défaut
// (carnet_api.suite_publique).

import { api, echapper as e, toast } from "../api.js";

export async function blocSuite(zone) {
  if (!zone) return;
  let moi;
  try {
    moi = await api.get("/api/moi");
  } catch {
    return;
  }
  if (!zone.isConnected || moi.role !== "invite") return;
  dessiner(zone, moi.suite);
  zone.addEventListener("submit", async (ev) => {
    if (!ev.target.closest(".nom-suite")) return;
    ev.preventDefault();
    try {
      const r = await api.put("/api/mj/suite", { suite: ev.target.suite.value });
      dessiner(zone, r.suite);
      toast(`Vos séances paraissent désormais en « ${r.suite} 1 », « ${r.suite} 2 »…`);
    } catch (err) {
      toast(err.message, "erreur");
    }
  });
}

function dessiner(zone, suite) {
  zone.innerHTML = `
    <section class="bloc joueurs-en-ligne suite-mj">
      <h2>Votre suite au carnet</h2>
      <p>Vos séances se numérotent à part : dans le carnet des joueurs et sur le carton d'épisode de la TV, elles s'appellent « ${e(suite)} 1 », « ${e(suite)} 2 »… Celles de l'autre MJ restent « Séance N ».</p>
      <form class="inviter-joueur nom-suite">
        <label class="champ">Nom de votre suite<input type="text" name="suite" maxlength="40" value="${e(suite)}" placeholder="Quête annexe"></label>
        <button type="submit">Enregistrer</button>
      </form>
      <p class="aide">Vide : « Quête annexe ». Un nom qui dirait ce que les joueurs ne savent pas encore est remplacé par « Quête annexe » à leurs yeux.</p>
    </section>`;
}
