// Les fils de la campagne : chaque faction avance d'une étape quand les héros ne s'en mêlent pas.
// Une étape atteinte peut laisser une rumeur à placer à l'auberge, et afficher un avis sur la planche.

import { api, echapper as e } from "../api.js";
import { lienVersions } from "../corbeille/corbeille.js";

export const RYTHMES = [
  ["seance", "Avance à chaque séance"],
  ["deux", "Avance une séance sur deux"],
  ["main", "N'avance qu'à la main"],
];

// Horloge en secteurs : n étapes, k franchies.
export function horloge(n, k, taille = 54) {
  const r = taille / 2 - 2;
  const c = taille / 2;
  if (!n) return "";
  const secteurs = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 2 * Math.PI - Math.PI / 2 + 0.05;
    const a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2 - 0.05;
    const x0 = c + r * Math.cos(a0);
    const y0 = c + r * Math.sin(a0);
    const x1 = c + r * Math.cos(a1);
    const y1 = c + r * Math.sin(a1);
    const grand = a1 - a0 > Math.PI ? 1 : 0;
    secteurs.push(`<path d="M${c},${c} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${grand} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" class="${i < k ? "plein" : "vide"}"/>`);
  }
  return `<svg class="horloge" viewBox="0 0 ${taille} ${taille}" width="${taille}" height="${taille}" role="img" aria-label="Étape ${k} sur ${n}">${secteurs.join("")}</svg>`;
}

// Ce que le fil propose à la clôture d'une séance : +1, ou rien.
export function proposition(fil, touche) {
  if (!fil.actif || touche) return 0;
  if ((fil.avance || 0) >= (fil.etapes || []).length) return 0;
  if (fil.rythme === "main") return 0;
  if (fil.rythme === "deux") return (fil.attente || 0) >= 1 ? 1 : 0;
  return 1;
}

export function etapeActuelle(fil) {
  const k = fil.avance || 0;
  return k ? fil.etapes[k - 1] : null;
}

export function etapeSuivante(fil) {
  return (fil.etapes || [])[fil.avance || 0] || null;
}

// Franchit une étape : rumeur à placer, avis affiché, trace dans le journal du fil. Renvoie ce qui a été créé.
// La rumeur et l'avis passent d'abord, le fil ensuite, par un PATCH qui ne touche qu'à ses compteurs : une coupure au
// milieu ne fait pas avancer le fil à moitié, et un nouvel essai ne crée pas la rumeur en double.
export async function franchir(fil, { contrats, rumeurs, seance = null, note = "" }) {
  const etape = etapeSuivante(fil);
  if (!etape) return { rumeur: null, contrat: null };
  const avance = (fil.avance || 0) + 1;
  let rumeur = null;
  let contrat = null;
  if (etape.rumeur) {
    rumeur = rumeurs.find((r) => r.fil === fil.id && r.etape_fil === avance) || null;
    if (!rumeur) {
      rumeur = await api.post("/api/rumeurs", {
        texte: etape.rumeur, source: "", etat: "a-placer", verite: "vraie", fil: fil.id, etape_fil: avance,
        fond: `Étape ${avance} du fil « ${fil.nom} » : ${etape.texte}`,
      });
      rumeurs.push(rumeur);
    }
  }
  if (etape.afficher) {
    contrat = contrats.find((c) => c.repere === etape.afficher || c.id === etape.afficher) || null;
    if (contrat && contrat.etat === "brouillon") Object.assign(contrat, await api.patch(`/api/contrats/${contrat.id}`, { etat: "affiche" }));
    else contrat = null;
  }
  const champs = {
    avance,
    attente: 0,
    journal: [...(fil.journal || []), { quand: new Date().toISOString(), a: avance, seance: seance?.id || "", numero: seance?.numero || null, note }],
  };
  if (seance) champs.seances_closes = [...(fil.seances_closes || []), seance.id];
  Object.assign(fil, await api.patch(`/api/fils/${fil.id}`, champs));
  return { rumeur, contrat };
}

export function htmlFil(f, { ouvert = false, contrats = [] } = {}) {
  const n = (f.etapes || []).length;
  const k = Math.min(f.avance || 0, n);
  const actuelle = etapeActuelle(f);
  const suivante = etapeSuivante(f);
  const fini = n && k >= n;
  return `
    <article class="fil${f.actif === false ? " en-pause" : ""}${fini ? " fini" : ""}" data-fil="${e(f.id)}">
      <header>
        ${horloge(n, k)}
        <div>
          <h3>${e(f.nom || "Fil sans nom")}</h3>
          <p class="faction">${e(f.faction || "")}${f.actif === false ? " · en pause" : ""}</p>
        </div>
      </header>
      <p class="ou"><span>Où on en est</span>${actuelle ? `${k}. ${e(actuelle.texte)}` : "Rien n'a encore bougé."}</p>
      ${fini ? `<p class="fin"><span>C'est arrivé</span>${e(f.fin || "Le fil est allé au bout.")}</p>` : `<p class="ensuite"><span>Ensuite</span>${suivante ? e(suivante.texte) : "Aucune étape écrite."}</p>`}
      <div class="actions">
        <button data-action="fil-reculer" ${k ? "" : "disabled"} title="Les héros l'ont fait reculer">Reculer</button>
        <button data-action="fil-avancer" ${suivante ? "" : "disabled"} title="Franchir l'étape suivante maintenant">Avancer</button>
        <select data-fil-champ="rythme" aria-label="Rythme">${RYTHMES.map(([v, t]) => `<option value="${v}" ${f.rythme === v ? "selected" : ""}>${t}</option>`).join("")}</select>
      </div>
      <details ${ouvert ? "open" : ""}>
        <summary>But, étapes et fin</summary>
        <label class="champ">Nom<input type="text" value="${e(f.nom || "")}" data-fil-champ="nom"></label>
        <label class="champ">Faction<input type="text" value="${e(f.faction || "")}" data-fil-champ="faction"></label>
        <label class="champ">Ce qu'ils veulent<textarea rows="2" data-fil-champ="but">${e(f.but || "")}</textarea></label>
        <ol class="etapes">
          ${(f.etapes || []).map((et, i) => `
            <li class="${i < k ? "franchie" : ""}">
              <label class="champ">Étape ${i + 1}<textarea rows="2" data-etape="${i}" data-etape-champ="texte">${e(et.texte || "")}</textarea></label>
              <label class="champ">Rumeur qu'elle laisse à l'auberge<input type="text" value="${e(et.rumeur || "")}" data-etape="${i}" data-etape-champ="rumeur"></label>
              <label class="champ">Affiche qu'elle cloue sur la planche<select data-etape="${i}" data-etape-champ="afficher">
                <option value="">Aucune</option>
                ${contrats.map((c) => `<option value="${e(c.repere || c.id)}" ${et.afficher && (et.afficher === c.repere || et.afficher === c.id) ? "selected" : ""}>${e(c.nom)}</option>`).join("")}
              </select></label>
              <button class="lien-danger" data-action="etape-retirer" data-etape="${i}">Retirer l'étape</button>
            </li>`).join("")}
        </ol>
        <button data-action="etape-ajouter">Ajouter une étape</button>
        <label class="champ secret">Si personne ne l'arrête<textarea rows="2" data-fil-champ="fin">${e(f.fin || "")}</textarea></label>
        <label class="champ">Notes<textarea rows="2" data-fil-champ="notes">${e(f.notes || "")}</textarea></label>
        <label class="case"><input type="checkbox" data-fil-champ="actif" ${f.actif === false ? "" : "checked"}> Fil actif</label>
        ${(f.journal || []).length ? `<p class="aide">${(f.journal || []).slice(-4).map((j) => `${j.numero ? `Séance ${j.numero}` : "À la main"} : ${j.a ? `étape ${j.a}` : "retour en arrière"}${j.note ? ` (${e(j.note)})` : ""}`).join(" · ")}</p>` : ""}
        <button class="lien-danger" data-action="fil-supprimer">Mettre ce fil à la corbeille</button>
        <a class="lien-versions" href="${lienVersions("fils", f.id, "#/seances")}">Versions précédentes</a>
      </details>
    </article>`;
}
