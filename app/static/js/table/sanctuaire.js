// Le sanctuaire à la TV.

import { echapper } from "../api.js";
import { svgVillage } from "../sanctuaire/dessin.js";
import { afficher, cacher } from "./ecran.js";
import { sanctuaireTv } from "./etat.js";
import { lireJson, numeroter } from "./outils.js";

// ---------------------------------------------------------------- le sanctuaire

// Le village dessiné (sanctuaire/dessin.js) et, à droite, les chantiers avec leur cagnotte et ce que le sanctuaire offre
// déjà ; un bâtiment montré de près passe en grand par-dessus. Le serveur n'envoie ni les notes du MJ ni un bâtiment
// caché (sanctuaire_public). Relu à chaque état : un versement noté à l'atelier change sanctuaire_maj.
const ROMAINS_TV = ["0", "I", "II", "III", "IV", "V"];
let sanctuaireVu = "";
let batimentVu = "";

const prenomsDonateurs = (b) => (b.donateurs || []).map((d) => `${echapper(d.nom)} <small>${echapper(d.or)} po</small>`).join(", ");

function htmlChantierTv(b) {
  const p = b.prochain;
  const part = p && p.cout ? Math.min(100, Math.round((100 * (b.cagnotte || 0)) / p.cout)) : 100;
  return `<li class="${b.cagnotte ? "en-cours" : ""}">
      <p class="ligne"><b>${echapper(b.nom)}</b><span>${b.niveau ? `niveau ${ROMAINS_TV[b.niveau]}` : echapper(b.etat)}</span></p>
      <p class="vers">Vers le niveau ${ROMAINS_TV[p.rang]} : <i>${echapper(p.nom)}</i></p>
      <div class="jauge"><i style="width:${part}%"></i></div>
      <p class="somme"><b>${echapper(b.cagnotte || 0)}</b> sur ${echapper(p.cout)} po${(b.donateurs || []).length ? `<span class="merci">merci à ${prenomsDonateurs(b)}</span>` : ""}</p>
    </li>`;
}

function htmlFicheSanctuaireTv(b, bonus) {
  const p = b.prochain;
  const siens = bonus.filter((x) => x.id === b.id);
  return `<p class="petit">${b.niveau ? `Niveau ${ROMAINS_TV[b.niveau]} sur ${ROMAINS_TV[b.niveaux]}` : echapper(b.etat)}</p>
    <h2>${echapper(b.nom)}</h2>
    ${b.niveau ? `<p class="etat">${echapper(b.etat)}</p>` : ""}
    ${siens.length ? `<ul class="acquis">${siens.map((x) => `<li><b>${ROMAINS_TV[x.niveau]}</b>${echapper(x.bonus)}</li>`).join("")}</ul>` : ""}
    ${p ? `<div class="prochain"><p class="vers">Prochain niveau : <b>${echapper(p.nom)}</b>, ${echapper(p.cout)} po</p>
      ${p.bonus ? `<p class="gain">${echapper(p.bonus)}</p>` : ""}
      <div class="jauge"><i style="width:${p.cout ? Math.min(100, Math.round((100 * (b.cagnotte || 0)) / p.cout)) : 100}%"></i></div>
      <p class="somme"><b>${echapper(b.cagnotte || 0)}</b> sur ${echapper(p.cout)} po${(b.donateurs || []).length ? `<span class="merci">merci à ${prenomsDonateurs(b)}</span>` : ""}</p></div>`
      : '<p class="vers">Au plus haut niveau.</p>'}`;
}

async function montrerSanctuaire(etat) {
  const actuel = numeroter("sanctuaire");
  if (!etat) {
    sanctuaireVu = batimentVu = "";
    return cacher(sanctuaireTv, 900);
  }
  const s = await lireJson("/api/table/sanctuaire");
  if (!actuel()) return;
  if (!s || !Array.isArray(s.batiments)) {
    sanctuaireVu = batimentVu = "";
    return cacher(sanctuaireTv, 900);
  }
  const entree = !sanctuaireTv.classList.contains("visible");
  const focus = etat.batiment ? s.batiments.find((b) => b.id === etat.batiment) || null : null;
  const cle = JSON.stringify([s, focus ? focus.id : ""]);
  if (cle !== sanctuaireVu || entree) {
    sanctuaireVu = cle;
    sanctuaireTv.querySelector(".sc-tv-village").innerHTML = svgVillage(s.batiments, { tv: true, focus: focus ? focus.id : null });
    sanctuaireTv.querySelector(".sc-tv-nom").textContent = s.nom || "Le sanctuaire";
    const accroche = sanctuaireTv.querySelector(".sc-tv-accroche");
    accroche.textContent = s.accroche || "";
    accroche.hidden = !s.accroche;
    const debout = s.batiments.filter((b) => b.niveau).length;
    sanctuaireTv.querySelector(".sc-tv-chiffres").innerHTML = `<b>${debout}</b> bâtiment${debout > 1 ? "s" : ""} debout · <b>${echapper(s.habitants || 0)}</b> habitant${s.habitants > 1 ? "s" : ""}`;
    // Les chantiers entamés d'abord, puis ceux qui attendent ; au plus haut niveau, ils ne figurent plus ici.
    const chantiers = s.batiments.filter((b) => b.prochain).sort((a, b) => (b.cagnotte ? 1 : 0) - (a.cagnotte ? 1 : 0));
    sanctuaireTv.querySelector(".sc-tv-chantiers").innerHTML = chantiers.map(htmlChantierTv).join("") || '<li class="vide">Tout est bâti.</li>';
    const bonus = s.bonus || [];
    sanctuaireTv.querySelector(".sc-tv-titre-bonus").hidden = !bonus.length;
    sanctuaireTv.querySelector(".sc-tv-bonus").innerHTML = bonus.map((x) => `<li><b>${echapper(x.batiment)}</b><span>${echapper(x.bonus)}</span></li>`).join("");
    sanctuaireTv.hidden = false; // encore transparent : mesurable sans être vu
    ajusterSanctuaire();
  }
  const zoom = sanctuaireTv.querySelector(".sc-tv-zoom");
  const fiche = zoom.querySelector(".sc-tv-fiche");
  sanctuaireTv.classList.toggle("focus", Boolean(focus));
  if (focus) {
    const contenu = htmlFicheSanctuaireTv(focus, s.bonus || []);
    if (zoom.hidden || batimentVu !== focus.id) {
      fiche.innerHTML = contenu;
      fiche.classList.remove("approche");
      void fiche.offsetWidth;
      fiche.classList.add("approche");
    } else fiche.innerHTML = contenu;
    batimentVu = focus.id;
    zoom.hidden = false;
  } else {
    zoom.hidden = true;
    batimentVu = "";
  }
  if (entree) afficher(sanctuaireTv);
}

// La colonne de droite rétrécit d'un cran tant qu'elle déborde de l'écran.
function ajusterSanctuaire() {
  const cote = sanctuaireTv.querySelector(".sc-tv-cote");
  let echelle = 1;
  cote.style.setProperty("--echelle", echelle);
  while (echelle > 0.6 && cote.scrollHeight > cote.clientHeight + 2) {
    echelle -= 0.05;
    cote.style.setProperty("--echelle", echelle.toFixed(2));
  }
}

export { montrerSanctuaire };
