// L'onglet « Héros » du coin des joueurs, une fois son héros à la tablée : son portrait en grand, toujours, carnet
// ouvert ou fermé ; « Changer de portrait » (portrait-coin.js) ; puis sa fiche telle que le MJ la tient, quand le carnet
// est ouvert (la même que « Mon héros », carnet-vue.js). Avant l'accueil, le serveur sert encore le créateur ; la fiche
// envoyée se relit sur /fiche-envoyee. La page se relit quand le carnet s'ouvre ou se ferme (flux « carnet ») ; le portrait,
// par son propre bloc. Tout texte passe par echapper.

import { echapper as e } from "../api.js";
import { accord, titre } from "../aventuriers/regles.js";
import { demander, htmlHeros, pageErreur, sansImagesCassees } from "./carnet-vue.js";
import { bandeauPause } from "./demandes.js";
import { ecouterFlux } from "./flux.js";
import { MonPortrait } from "./portrait-coin.js";
import "./pied-coin.js";

const page = document.getElementById("page");
const monogramme = (nom) => e(String(nom || "").replace(/^(le|la|les|l['’])\s*/i, "").trim().charAt(0).toUpperCase() || "?");
let jeton = 0;
let ouvert = null; // le carnet l'était-il au dernier dessin ?

// Le portrait en grand suit le bloc : un choix appliqué, une image acceptée, il change sous les yeux.
const monPortrait = new MonPortrait({ surEtat: (r) => montrerGrand(r) });

function montrerGrand(r) {
  const cadre = page.querySelector(".portrait-grand");
  if (!cadre || !r?.heros) return;
  const img = cadre.querySelector("img");
  cadre.classList.toggle("sans-image", !r.actuel);
  if (r.actuel && img.getAttribute("src") !== r.actuel) img.src = r.actuel;
  if (!r.actuel) img.removeAttribute("src");
}

async function montrer() {
  const n = ++jeton;
  let moi;
  let etat;
  try {
    [moi, etat] = await Promise.all([demander("GET", "/api/moi"), demander("GET", "/api/portraits")]);
  } catch (err) {
    if (n === jeton) pageErreur(page, err);
    return;
  }
  if (n !== jeton) return;
  if (!etat.heros) {
    page.innerHTML = `<section class="feuille-coin message-coin"><p class="kicker">Le coin des joueurs</p>
      <h1>Votre héros n'est pas à la tablée</h1>
      <p>Votre MJ ne l'a pas encore accueilli, ou l'a mis de côté pour l'instant. <a href="/fiche-envoyee">Revoir votre fiche</a>.</p></section>`;
    return;
  }
  let c = null;
  if (moi.carnet) {
    try {
      c = await demander("GET", "/api/carnet");
    } catch {
      c = null;
    }
    if (n !== jeton) return;
  }
  ouvert = Boolean(c?.ouvert);
  const h = c?.heros || null;
  const nom = h?.nom || etat.heros.nom || moi.heros?.nom || "Votre héros";
  const genre = { genre: h?.genre || etat.heros.genre };
  const sous = [h && titre(h), h?.joueur ? `${accord("{joué|jouée}", genre)} par ${h.joueur}` : ""].filter(Boolean).join(" · ");
  page.innerHTML = `
    <article class="feuille-coin heros-coin">
      <span class="signet" aria-hidden="true"></span>
      <header class="titre-carnet">
        <p class="kicker">${e(accord("{Mon héros|Mon héroïne}", genre))}</p>
        <h1>${e(nom)}</h1>
        ${sous ? `<p class="chapo">${e(sous)}</p>` : ""}
      </header>
      <div class="portrait-heros">
        <figure class="portrait-grand${etat.actuel ? "" : " sans-image"}" data-image>
          <img alt="Le portrait de ${e(nom)}" ${etat.actuel ? `src="${e(etat.actuel)}"` : ""} decoding="async">
          <span class="monogramme" aria-hidden="true">${monogramme(nom)}</span>
        </figure>
        <div class="zone-portrait"></div>
      </div>
      <nav class="liens-heros" aria-label="Ailleurs dans le coin">
        ${ouvert ? '<a class="secondaire" href="/carnet#heros">Sa fiche dans le carnet</a><a class="secondaire" href="/histoire">Étoffer son histoire</a>' : ""}
        ${moi.aventurier ? '<a class="secondaire" href="/fiche-envoyee">La fiche que vous aviez envoyée</a>' : ""}
      </nav>
      ${h ? `<section class="section-coin fiche-du-heros"><header class="tete-section"><h2>Sa fiche</h2><span class="filet" aria-hidden="true"></span>
          <p class="sous-titre">Telle que le MJ la tient : Santé et Psy du moment, sac à jour.</p></header>${htmlHeros(h)}</section>`
        : `<p class="vide fiche-fermee">Sa fiche complète se lit dans le carnet de la compagnie, quand votre MJ l'ouvre entre les séances. Son portrait reste ici.</p>`}
    </article>`;
  sansImagesCassees(page);
  monPortrait.monter(page.querySelector(".zone-portrait"), { ouvert: location.hash === "#portrait" });
  montrerGrand(etat);
}

bandeauPause();
// Le carnet ouvert ou fermé change la page ; le reste (une Santé, un sac) se relit au retour sur l'onglet.
ecouterFlux("carnet", async () => {
  try {
    const moi = await demander("GET", "/api/moi");
    if (Boolean(moi.carnet) !== ouvert) montrer();
  } catch {
    // la prochaine lecture dira ce qui ne va pas
  }
});
let cache = 0;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") cache = Date.now();
  else if (cache && Date.now() - cache > 60000 && !page.querySelector(".cadrage-portrait:not([hidden])")) montrer();
});
montrer();
