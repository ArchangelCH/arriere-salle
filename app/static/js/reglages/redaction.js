// Ce que la rédaction a coûté ce mois-ci, par usage (en dollars, tarif de l'API ; les relectures différées comptent pour
// moitié) : page Réglages, section Rédaction, pour les deux MJ. Le compte principal lit le détail, la part des joueurs et
// celle de chaque MJ invité ; un invité ne lit que la sienne et son budget du mois (/api/ia/couts, budget_mj.py).

import { echapper as e } from "../api.js";

const dollars = (v) => `${v < 0.01 && v > 0 ? "moins de 0,01" : v.toFixed(2).replace(".", ",")} $`;

export function blocCouts(c) {
  const mois = new Date(`${c.mois}-01T12:00:00`).toLocaleDateString("fr-CH", { month: "long", year: "numeric" });
  return `
    <div class="bloc couts-ia">
      <h2>La rédaction en ${e(mois)}</h2>
      ${c.disponible ? "" : `<p class="alerte">Aucune clé d'API sur le serveur : seule la rédaction locale répond (PNJ, « Précédemment », histoires).</p>`}
      <p><strong>${dollars(c.total)}</strong> pour ${c.appels} demande${c.appels > 1 ? "s" : ""}.</p>
      ${c.detail.length ? `<ul class="liste-simple">${c.detail.map((d) => `<li><span>${e(d.nom)}</span><span>${d.appels} · ${dollars(d.cout)}</span></li>`).join("")}</ul>` : ""}
      ${c.joueurs?.length ? `<h3>Pour les joueurs</h3><ul class="liste-simple">${c.joueurs.map((j) => `<li><span>${e(j.nom)}</span><span>${j.appels} · ${dollars(j.cout)}</span></li>`).join("")}</ul>` : ""}
      ${c.mj?.length ? `<h3>Dont les autres MJ</h3><ul class="liste-simple">${c.mj.map((m) => `<li><span>${e(m.nom)}</span><span>${m.appels} · ${dollars(m.cout)}${m.budget ? ` sur ${dollars(m.budget.budget)}` : ""}</span></li>`).join("")}</ul>` : ""}
      ${c.budget ? `<p>Votre budget du mois : ${dollars(c.budget.depense)} sur ${dollars(c.budget.budget)}${c.budget.atteint ? `, atteint : il revient le ${e(c.budget.revient)}` : ""}.</p>` : ""}
      <p class="aide">Le contexte de la campagne est gardé une heure : la première demande de l'heure le paie, les suivantes presque rien. La bible entière ne sert qu'à vérifier le canon et aux relectures.</p>
    </div>`;
}
