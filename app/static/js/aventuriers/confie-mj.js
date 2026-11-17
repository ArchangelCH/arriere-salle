// « Confié au MJ », dans la fiche d'un aventurier de l'atelier, page « Pour le MJ » : ce que son joueur a écrit
// pour le MJ seul depuis le coin (« Pour le MJ seulement », sous l'histoire de son héros), déposé sans validation. Marqué
// « nouveau » tant que le MJ ne l'a pas lu ; « Lu » le dit au joueur. Le texte reste ici : ni la TV, ni le carnet, ni la
// fiche imprimée ne le portent, et rien ne s'en recopie ailleurs.
//
// Chargé par createur.js (import dynamique, atelier seul : le coin des joueurs ne sert pas ce module). Le champ
// confie_au_mj ne s'écrit que par sa route : la fiche entière enregistrée ne le touche pas. Un nouvel envoi du joueur
// arrive pendant que la fiche est ouverte : la boîte des demandes change (canal de l'atelier), la section se relit.

import { api, echapper as e, toast } from "../api.js";
import { ecouterDemandes } from "../ecran-tv/canal-table.js";

const CHAMP = "confie_au_mj";
const suivis = new WeakMap(); // createur -> ce qui cesse l'écoute
const quand = (iso) => {
  const d = new Date(iso || "");
  if (Number.isNaN(d.getTime())) return "";
  const jour = d.toLocaleDateString("fr-CH", { day: "numeric", month: "long" });
  return `le ${jour} à ${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
};
const paragraphes = (t) => String(t || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${e(x)}</p>`).join("");

function lisible(c) {
  return c && typeof c === "object" && typeof c.texte === "string" && typeof c.envoi === "string" ? c : null;
}

function html(a) {
  const c = lisible(a?.[CHAMP]);
  if (!c) {
    return `<h2>Confié au MJ</h2>
      <p class="aide">Ce que le joueur vous confie depuis son coin (« Pour le MJ seulement », sous l'histoire de son héros) arrive ici, pour vous seul.</p>`;
  }
  return `<h2>Confié au MJ ${c.lu ? "" : '<span class="nouveau-confie">nouveau</span>'}</h2>
    <p class="quand-confie">${e(`Écrit par son joueur ${quand(c.envoye)}`.trim())}${c.lu ? ` · lu ${e(quand(c.lu))}` : ""}</p>
    <div class="texte-confie">${paragraphes(c.texte) || '<p class="aide">(vide)</p>'}</div>
    <div class="actions">
      ${c.lu ? '<p class="aide">Le joueur voit que vous l\'avez lu. Un nouvel envoi de sa part remplacera ce texte et reviendra « nouveau ».</p>'
        : '<button type="button" class="principal" data-confie-lu>Lu</button><p class="aide">Le joueur verra que vous l\'avez lu.</p>'}
    </div>`;
}

function dessiner(createur) {
  const zone = createur.racine.querySelector("[data-confie-mj]");
  if (zone && createur.a) {
    zone.innerHTML = html(createur.a);
    zone.dataset.envoi = lisible(createur.a[CHAMP])?.envoi || "";
  }
}

// Le champ de la fiche a changé (un envoi, « Lu ») : la fiche de l'éditeur et sa base de fusion le prennent, sans rien
// marquer à enregistrer ; la section et le rail se redessinent.
function poser(createur, valeur) {
  if (!createur.a) return;
  createur.a[CHAMP] = valeur ?? null;
  if (createur.base) createur.base[CHAMP] = valeur ?? null;
  dessiner(createur);
  createur.rafraichir();
}

async function relire(createur) {
  const id = createur.a?.id;
  if (!id || createur.detruit) return;
  let fiche;
  try {
    fiche = await api.get(`/api/aventuriers/${encodeURIComponent(id)}`);
  } catch {
    return;
  }
  if (createur.detruit || createur.a?.id !== id) return;
  if (JSON.stringify(fiche[CHAMP] ?? null) !== JSON.stringify(createur.a[CHAMP] ?? null)) poser(createur, fiche[CHAMP]);
}

async function marquerLu(createur, bouton) {
  const id = createur.a?.id;
  const zone = bouton.closest("[data-confie-mj]");
  if (!id || !zone) return;
  bouton.disabled = true;
  try {
    const r = await api.post(`/api/aventuriers/${encodeURIComponent(id)}/confie/lu`, { envoi: zone.dataset.envoi });
    if (createur.a?.id === id) poser(createur, r[CHAMP]);
  } catch (err) {
    bouton.disabled = false;
    toast(`Rien de noté : ${err.message}`, "erreur");
    if (err.status === 409 || err.status === 404) relire(createur);
  }
}

// À chaque affichage d'une étape de la fiche (atelier) : la section se dessine si elle est à l'écran ; l'écoute de la
// boîte se pose une fois par éditeur, et cesse avec lui.
export function suivreConfie(createur) {
  dessiner(createur);
  if (suivis.has(createur)) return;
  const cesser = ecouterDemandes(() => relire(createur));
  suivis.set(createur, cesser);
  createur.ecoute.signal.addEventListener("abort", cesser, { once: true });
  createur.racine.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-confie-lu]");
    if (b && !b.disabled) marquerLu(createur, b);
  }, { signal: createur.ecoute.signal });
}
