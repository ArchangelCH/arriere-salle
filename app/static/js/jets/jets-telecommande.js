// Les jets à distance sur la télécommande du MJ (telecommande.html), juste au-dessus des onglets, quel que soit l'onglet
// ouvert, sous les mains levées : une ligne avec le dernier test lancé depuis le coin (le héros, le test, le dé, l'issue,
// l'heure) et « Tests », qui déplie de quoi en demander un (un joueur, puis la caractéristique ; le modificateur avant,
// s'il y a lieu), les tests qui attendent (« Retirer ») et les derniers jets. Rien quand la table du coin est fermée et que
// personne n'a lancé. Un jet qui tombe fait vibrer le téléphone, là où le navigateur le permet.
//
// Lot G : les dés libres dans les derniers jets ; quand la règle des dés d'aventure est en jeu, les deux réserves sur la
// ligne et dans le panneau (un dé passe à la main d'une réserve à l'autre), le dé de mésaventure à annoncer (seul ou avec
// le test demandé ; l'effet au choix pour un héros en désavantage), les annonces qui attendent, et « Annuler le dé ».

import { accorderEnfants } from "../commun/accorder.js";
import { echapper as e } from "../api.js";
import {
  CARACS, EFFETS_CHOISIS, annulerAventure, demanderTest, desavantageDe, ecouterLesJets, herosDe, heure, htmlDesDuTest, htmlDetail, htmlIssue,
  htmlPips, imposerMesaventure, passerDe, prenomDe, retirerMesaventure, retirerTest, signe, testDe,
} from "./jets.js";

const PAS = 5;
const MOD_MAX = 50;
const RECENT = 5 * 60 * 1000; // le dernier jet reste sur la ligne cinq minutes
const VUS = 4;

export function monterJetsTelecommande(bas) {
  if (!bas) return;
  const zone = document.createElement("section");
  zone.className = "jets-tc";
  zone.setAttribute("aria-label", "Tests à distance");
  zone.hidden = true;
  const mains = bas.querySelector(".mains-tc");
  if (mains) mains.after(zone);
  else bas.prepend(zone);
  let vue = null;
  let deplie = false;
  let choisi = "";
  let mod = 0;
  let mesaventure = false; // lot G : le test demandé part avec un dé de mésaventure
  let face = null; // l'effet choisi pour un héros en désavantage
  let mot = ""; // le dernier geste : « Test demandé à Léa », ou un échec
  let effacer = 0;
  const connus = new Set();
  let premiere = true;

  // La place que prend la télécommande en bas : le bas des panneaux reste lisible au-dessus.
  const ajuster = () => {
    document.body.style.paddingBottom = zone.hidden ? "" : `${bas.offsetHeight + 24}px`;
  };
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(ajuster).observe(bas);

  const dire = (texte) => {
    mot = texte;
    clearTimeout(effacer);
    effacer = setTimeout(() => {
      mot = "";
      dessiner();
    }, 5000);
  };

  const joueurChoisi = () => {
    const qui = choisi || (vue?.joueurs.length === 1 ? vue.joueurs[0].joueur : "");
    return (vue?.joueurs || []).find((j) => j.joueur === qui) || null;
  };

  function htmlLigne(v) {
    const x = v.jets[0];
    const recent = x && Date.now() - new Date(x.quand).getTime() < RECENT;
    const texte = recent
      ? `<b>${e(herosDe(x) || prenomDe(x))}</b><span class="test">${e(testDe(x))}</span><span class="issue" data-issue="${e(x.issue || "")}">${htmlIssue(x)}</span><small>${e(heure(x.quand))}</small>`
      : `<span class="calme">${v.ouvert ? (v.pause ? "Coin en pause" : "Tests à distance") : "Table du coin fermée"}</span>`;
    const attente = v.demandes.length ? `<span class="attend">${v.demandes.length} en attente</span>` : "";
    const r = v.reserve || {};
    const reserve = r.actif ? `<span class="reserve-tc" title="Dés d'aventure : ${e(r.groupe)} au groupe, ${e(r.mj)} au MJ">${htmlPips(1, "groupe")}${e(r.groupe)}${htmlPips(1, "mj")}${e(r.mj)}</span>` : "";
    return `<div class="ligne-jets-tc"><p class="dernier" aria-live="polite">${texte}${attente}${reserve}</p>
      <button type="button" class="touche" data-jets-tc="deplier" aria-expanded="${deplie}">${deplie ? "Fermer" : "Tests"}</button></div>`;
  }

  // Toujours les mêmes blocs, dans le même ordre (cachés au besoin) : le redessin ne change que ce qui a changé, sans faire
  // passer un bouton d'un rôle à l'autre sous le doigt.
  function htmlPanneau(v) {
    const seul = v.joueurs.length === 1 ? v.joueurs[0].joueur : "";
    const qui = choisi || seul;
    const ferme = !v.ouvert || v.pause;
    const cache = (oui) => (oui ? "" : " hidden");
    const r = v.reserve || { actif: false, mesaventures: [] };
    const j = joueurChoisi();
    const desav = r.actif && desavantageDe(j);
    const libres = r.libres || 0;
    const demandes = v.demandes.map((d) => `
      <li data-demande="${e(d.id)}" data-joueur="${e(d.joueur)}"><span><b>${e(prenomDe(d))}</b> : ${e(d.carac_nom)}${d.modificateur ? ` (${e(signe(d.modificateur))})` : ""}</span>
        <button type="button" class="touche" data-jets-tc="retirer">Retirer</button></li>`).join("");
    const annonces = (r.mesaventures || []).map((m) => `
      <li data-mesaventure="${e(m.joueur)}"><span><b>${e(m.nom || "Un joueur")}</b> : mésaventure au prochain test</span>
        <button type="button" class="touche" data-jets-tc="retirer-mesaventure">Retirer</button></li>`).join("");
    const jets = v.jets.slice(0, VUS).map((x) => `
      <li data-jet="${e(x.id)}" data-issue="${e(x.issue || "")}"><span class="heure">${e(heure(x.quand))}</span><span class="quoi"><b>${e(herosDe(x) || prenomDe(x))}</b> ${e(testDe(x))}</span>
        <span class="issue">${htmlIssue(x)}</span><span class="detail">${htmlDetail(x)}</span>${x.genre !== "des" && (x.aventure || x.mesaventure) ? `<span class="des-tc">${htmlDesDuTest(x)}</span>` : ""}</li>`).join("");
    return `<div class="panneau-jets-tc"${cache(deplie)}>
      <p class="mot-jets-tc" role="status"${cache(mot)}>${e(mot)}</p>
      <p class="calme"${cache(ferme)}>${v.ouvert ? "Coin en pause : les joueurs ne lancent pas." : "La table du coin est fermée : les joueurs ne lancent pas."}</p>
      <p class="titre"${cache(r.actif)}>Dés d'aventure</p>
      <div class="reserve-panneau-tc"${cache(r.actif)}>
        <span class="reserve-mj groupe">${htmlPips(r.groupe, "groupe")}<b>${e(r.groupe)}</b> au groupe</span>
        <span class="reserve-mj mj">${htmlPips(r.mj, "mj")}<b>${e(r.mj)}</b> au MJ</span>
        <button type="button" class="touche" data-jets-tc="vers-mj"${r.groupe ? "" : " disabled"}>Passer un dé au MJ</button>
        <button type="button" class="touche" data-jets-tc="vers-groupe"${r.mj ? "" : " disabled"}>Passer un dé au groupe</button>
      </div>
      <ul class="attente-tc annonces-tc"${cache(annonces)}>${annonces}</ul>
      <p class="titre"${cache(v.joueurs.length)}>Demander un test</p>
      <div class="qui-tc"${cache(v.joueurs.length)}>${v.joueurs.map((x) => `<button type="button" class="touche" data-jets-joueur="${e(x.joueur)}" aria-pressed="${x.joueur === qui}">${e(x.nom || "Un joueur")}<small>${e(x.heros?.nom || "")}${x.jeton ? ` · ${x.jeton === "avantage" ? "avantage" : "désavantage"}` : ""}</small></button>`).join("")}</div>
      <div class="quoi-tc"${cache(v.joueurs.length)}>${CARACS.map(([cle, nom]) => `<button type="button" class="touche principale" data-jets-carac="${cle}"${!qui || ferme ? " disabled" : ""}>${nom}</button>`).join("")}</div>
      <div class="mod-tc"${cache(v.joueurs.length)}><span>Modificateur</span><button type="button" class="touche" data-jets-mod="-${PAS}" aria-label="Moins ${PAS}">−</button><output>${e(signe(mod))}</output><button type="button" class="touche" data-jets-mod="${PAS}" aria-label="Plus ${PAS}">+</button></div>
      <div class="mesaventure-tc"${cache(r.actif && v.joueurs.length)}>
        <button type="button" class="touche" data-jets-tc="avec-mesaventure" aria-pressed="${mesaventure}"${libres ? "" : " disabled"}>Avec un dé de mésaventure</button>
        <button type="button" class="touche" data-jets-tc="mesaventure-seule"${!qui || !v.ouvert || !libres ? " disabled" : ""}>Mésaventure au prochain test</button>
      </div>
      <div class="effets-tc" role="group" aria-label="Son désavantage : l'effet du dé de mésaventure"${cache(desav)}>
        <span>Désavantage : l'effet</span>
        <button type="button" class="touche" data-jets-face="" aria-pressed="${face === null}">Au dé</button>
        ${EFFETS_CHOISIS.map(([f, nom]) => `<button type="button" class="touche" data-jets-face="${f}" aria-pressed="${face === f}">${nom}</button>`).join("")}
      </div>
      <p class="titre"${cache(demandes)}>En attente</p><ul class="attente-tc"${cache(demandes)}>${demandes}</ul>
      <p class="titre"${cache(jets)}>Derniers jets</p><ol class="derniers-tc"${cache(jets)}>${jets}</ol>
    </div>`;
  }

  function dessiner() {
    const v = vue;
    zone.hidden = !v || !(deplie || v.ouvert || v.reserve?.actif || (v.jets[0] && Date.now() - new Date(v.jets[0].quand).getTime() < RECENT));
    document.body.classList.toggle("avec-jets-tc", !zone.hidden);
    if (!zone.hidden) {
      const neuf = document.createElement("div");
      neuf.innerHTML = `${htmlPanneau(v)}${htmlLigne(v)}`;
      accorderEnfants(zone, neuf);
    }
    ajuster();
  }

  ecouterLesJets((v) => {
    vue = v;
    const nouveaux = (v?.jets || []).filter((x) => !connus.has(x.id));
    for (const x of v?.jets || []) connus.add(x.id);
    if (nouveaux.length && !premiere && navigator.userActivation?.hasBeenActive) navigator.vibrate?.(60);
    premiere = false;
    if (choisi && !(v?.joueurs || []).some((j) => j.joueur === choisi)) choisi = "";
    if (!desavantageDe(joueurChoisi())) face = null;
    if (!v?.reserve?.actif) mesaventure = false;
    dessiner();
  });
  // La ligne du dernier jet s'efface d'elle-même au bout de cinq minutes.
  setInterval(() => vue && !deplie && dessiner(), 30000);

  // Un geste de la réserve : la vue revient avec la réponse ; un refus se dit sur la ligne du panneau.
  async function geste(b, travail, dit) {
    b.setAttribute("aria-busy", "true");
    try {
      await travail();
      if (dit) dire(dit);
    } catch (err) {
      dire(err.message);
    } finally {
      b.removeAttribute("aria-busy");
      dessiner();
    }
  }

  zone.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button");
    if (!b || b.disabled || b.getAttribute("aria-busy") === "true") return;
    const v = vue;
    if (b.dataset.jetsTc === "deplier") {
      deplie = !deplie;
      return dessiner();
    }
    if (b.dataset.jetsJoueur) {
      choisi = choisi === b.dataset.jetsJoueur && v?.joueurs.length > 1 ? "" : b.dataset.jetsJoueur;
      if (!desavantageDe(joueurChoisi())) face = null;
      return dessiner();
    }
    if (b.dataset.jetsMod) {
      mod = Math.max(-MOD_MAX, Math.min(MOD_MAX, mod + Number(b.dataset.jetsMod)));
      return dessiner();
    }
    // ---- Lot G ----
    if (b.dataset.jetsTc === "avec-mesaventure") {
      mesaventure = !mesaventure;
      return dessiner();
    }
    if (b.dataset.jetsFace !== undefined) {
      face = b.dataset.jetsFace ? Number(b.dataset.jetsFace) : null;
      return dessiner();
    }
    if (b.dataset.jetsTc === "vers-mj" || b.dataset.jetsTc === "vers-groupe") {
      return geste(b, () => passerDe(b.dataset.jetsTc === "vers-mj" ? "mj" : "groupe"));
    }
    if (b.dataset.jetsTc === "mesaventure-seule") {
      const j = joueurChoisi();
      if (!j) return;
      return geste(b, async () => {
        await imposerMesaventure(j.joueur, desavantageDe(j) ? face : null);
        face = null;
        choisi = "";
      }, `${j.nom || "Le joueur"} : dé de mésaventure au prochain test.`);
    }
    if (b.dataset.jetsTc === "retirer-mesaventure") {
      const joueur = b.closest("[data-mesaventure]")?.dataset.mesaventure;
      return joueur && geste(b, () => retirerMesaventure(joueur));
    }
    if (b.dataset.jets === "annuler-de") {
      const ident = b.closest("[data-jet]")?.dataset.jet;
      return ident && geste(b, () => annulerAventure(ident), "Le dé d'aventure est revenu au groupe.");
    }
    if (b.dataset.jetsCarac) {
      const j = joueurChoisi();
      if (!j) return;
      const avec = mesaventure && Boolean(v?.reserve?.actif);
      b.setAttribute("aria-busy", "true");
      try {
        await demanderTest(j.joueur, b.dataset.jetsCarac, mod, avec, avec && desavantageDe(j) ? face : null);
        dire(`${j.nom || "Le joueur"} : test de ${b.textContent.trim()}${mod ? ` (${signe(mod)})` : ""}${avec ? ", avec un dé de mésaventure," : ""} demandé.`);
        mod = 0;
        choisi = "";
        mesaventure = false;
        face = null;
      } catch (err) {
        dire(`Test non demandé : ${err.message}`);
      } finally {
        b.removeAttribute("aria-busy");
        dessiner();
      }
      return;
    }
    if (b.dataset.jetsTc === "retirer") {
      const li = b.closest("[data-demande]");
      const d = (v?.demandes || []).find((x) => x.id === li?.dataset.demande && x.joueur === li?.dataset.joueur);
      if (!d) return;
      b.setAttribute("aria-busy", "true");
      try {
        await retirerTest(d);
      } catch (err) {
        dire(`${prenomDe(d)} : ${err.message}`);
      } finally {
        b.removeAttribute("aria-busy");
        dessiner();
      }
    }
  });
}
