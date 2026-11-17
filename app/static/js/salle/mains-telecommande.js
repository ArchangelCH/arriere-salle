// Les mains levées sur la télécommande du MJ (telecommande.html) : debout face à la table, le téléphone en main, il voit
// qui lève la main sur le sien, quel que soit l'onglet ouvert, juste au-dessus des onglets, sous le pouce. Pour chaque
// main, dans l'ordre : le prénom, le héros, « Parole » (le joueur lit « À vous ! ») et « Plus tard ». Rien quand
// personne ne lève la main. Une main qui arrive fait vibrer le téléphone, là où le navigateur le permet.

import { accorderEnfants } from "../commun/accorder.js";
import { echapper as e } from "../api.js";
import { ecouterLaSalle, prenomDe, repondre } from "./salle.js";

export function monterMainsTelecommande(bas) {
  if (!bas) return;
  const zone = document.createElement("section");
  zone.className = "mains-tc";
  zone.setAttribute("aria-label", "Mains levées");
  zone.setAttribute("aria-live", "polite");
  zone.hidden = true;
  bas.prepend(zone);
  let vue = null;
  let echec = "";
  const vues = new Set();
  let premiere = true;

  const dessiner = () => {
    const mains = vue?.mains || [];
    zone.hidden = !mains.length && !echec;
    document.body.classList.toggle("avec-mains-levees", !zone.hidden);
    const neuf = document.createElement("div");
    neuf.innerHTML = `${echec ? `<p class="echec-main">${e(echec)}</p>` : ""}${mains.map((m) => `
      <div class="main-tc" data-main="${e(m.id)}" data-joueur="${e(m.joueur)}">
        <p class="qui">${mains.length > 1 ? `<span class="rang">${m.rang}</span>` : ""}<b>${e(prenomDe(m))}</b>${m.heros?.nom ? `<small>${e(m.heros.nom)}</small>` : ""}<span class="leve">lève la main</span></p>
        <div class="gestes">
          <button type="button" class="touche principale" data-salle="parole">Parole</button>
          <button type="button" class="touche" data-salle="plus-tard">Plus tard</button>
        </div>
      </div>`).join("")}`;
    accorderEnfants(zone, neuf);
    // La place que prend le bandeau : le bas des panneaux reste lisible au-dessus.
    document.body.style.setProperty("--mains-levees", `${zone.hidden ? 0 : zone.offsetHeight}px`);
  };

  ecouterLaSalle((v) => {
    vue = v;
    const nouvelles = (v?.mains || []).filter((m) => !vues.has(m.id));
    for (const m of v?.mains || []) vues.add(m.id);
    if (nouvelles.length && !premiere && navigator.userActivation?.hasBeenActive) navigator.vibrate?.(80);
    premiere = false;
    dessiner();
  });

  zone.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button[data-salle]");
    const ligne = b?.closest("[data-main]");
    if (!b || !ligne || b.getAttribute("aria-busy") === "true") return;
    const main = (vue?.mains || []).find((m) => m.id === ligne.dataset.main && m.joueur === ligne.dataset.joueur);
    if (!main) return;
    for (const x of ligne.querySelectorAll("button")) x.disabled = true;
    b.setAttribute("aria-busy", "true");
    try {
      await repondre(main, b.dataset.salle);
      echec = "";
    } catch (err) {
      echec = `${prenomDe(main)} : ${err.message}`;
      setTimeout(() => {
        echec = "";
        dessiner();
      }, 5000);
      for (const x of ligne.querySelectorAll("button")) x.disabled = false;
    } finally {
      b.removeAttribute("aria-busy");
      dessiner();
    }
  });
}
