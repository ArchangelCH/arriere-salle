// Les cartons posés sur le jeu : lieu, PNJ, planche à contrats.

import { htmlAffiche } from "../auberge/affiche.js";
import { TYPES_LIEUX } from "../carte/biomes.js";
import { afficher, cacher } from "./ecran.js";
import { carton, cartonPnj, planche } from "./etat.js";
import { change, demandes, leger, lireJson, numeroter } from "./outils.js";

// ---------------------------------------------------------------- cartons et vues plein écran

async function montrerCarton(idLieu, cle = idLieu) {
  if (!change("lieu", idLieu ? cle : null)) return;
  const actuel = numeroter("lieu");
  if (!idLieu) return cacher(carton, 700);
  const lieu = await lireJson(`/api/table/lieu/${encodeURIComponent(idLieu)}`);
  if (!actuel()) return;
  if (!lieu) {
    delete demandes.lieu;
    return cacher(carton, 700);
  }
  // Le type du lieu se tait quand son nom le dit déjà (« Auberge » au-dessus de « L'auberge du Gué »).
  const genre = TYPES_LIEUX.find((t) => t.cle === lieu.type)?.nom || "";
  const simple = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  carton.querySelector(".genre").textContent = genre && !simple(lieu.nom).includes(simple(genre)) ? genre : "";
  carton.querySelector(".nom").textContent = lieu.nom || "";
  carton.querySelector(".resume").textContent = lieu.resume || "";
  const cadre = carton.querySelector(".illustration");
  if (lieu.illustration) {
    cadre.querySelector("img").src = leger(lieu.illustration, 640);
    cadre.hidden = false;
  } else cadre.hidden = true;
  afficher(carton);
}

async function montrerPnj(id) {
  if (!change("pnj", id || null)) return;
  const actuel = numeroter("pnj");
  if (!id) return cacher(cartonPnj, 700);
  const p = await lireJson(`/api/table/pnj/${encodeURIComponent(id)}`);
  if (!actuel()) return;
  if (!p) {
    delete demandes.pnj;
    return cacher(cartonPnj, 700);
  }
  cartonPnj.querySelector(".role").textContent = [p.role, p.peuple].filter(Boolean).join(" · ");
  cartonPnj.querySelector(".nom").textContent = p.nom || "";
  cartonPnj.querySelector(".surnom").textContent = p.surnom ? `« ${p.surnom} »` : "";
  cartonPnj.querySelector(".apparence").textContent = p.apparence || "";
  const cadre = cartonPnj.querySelector(".portrait");
  if (p.illustration) {
    cadre.querySelector("img").src = leger(p.illustration, 640);
    cadre.hidden = false;
  } else cadre.hidden = true;
  afficher(cartonPnj);
}

// La planche est relue à chaque état reçu : une affiche modifiée dans l'atelier change aussitôt sur la TV. Sans réponse,
// elle s'efface plutôt que de montrer une planche d'avant, où traînerait peut-être une affiche retirée depuis.
async function montrerPlanche(etat) {
  const actuel = numeroter("planche");
  if (!etat) return cacher(planche);
  const liste = await lireJson("/api/table/planche");
  if (!actuel()) return;
  if (!Array.isArray(liste)) return cacher(planche);
  planche.querySelector(".affiches").innerHTML = liste.map((c) => htmlAffiche(c)).join("") || '<p class="planche-vide">La planche est vide.</p>';
  const zoom = planche.querySelector(".zoom");
  const choisi = etat.contrat ? liste.find((c) => c.id === etat.contrat) : null;
  planche.classList.toggle("focus", Boolean(choisi));
  if (choisi) {
    if (zoom.dataset.contrat !== choisi.id || zoom.hidden) zoom.innerHTML = htmlAffiche(choisi);
    else zoom.querySelector(".affiche").outerHTML = htmlAffiche(choisi).trim();
    zoom.dataset.contrat = choisi.id;
    zoom.hidden = false;
  } else {
    zoom.hidden = true;
    zoom.dataset.contrat = "";
  }
  afficher(planche);
}

export { montrerCarton, montrerPlanche, montrerPnj };
