// Son héros sous la main, à la table du coin (demandes d'Adrien du 19/11) :
//   - la fiche en résumé, en bas à gauche : un médaillon à son portrait ouvre les caractéristiques (cartons comptés), la
//     défense et l'armure, les compétences, les armes et les dons (effet au toucher). Elle se lit dans la fiche publiée du
//     carnet (GET /api/carnet) ; carnet fermé, dans la fiche de jet de la table (GET /api/jets), sans les dons ;
//   - le sac et les notes, en tiroirs sous la barre « Mon héros » (etat-coin.js), ouverts par ses boutons « Sac » et
//     « Notes » (événement « tiroir-coin ») : le sac est celui du carnet (sac.js, mêmes gestes, même file des demandes) ;
//     les notes sont au joueur seul (GET|PUT /api/notes), enregistrées seules à la pause de la saisie.
// Un seul panneau ouvert à la fois ; Échap ou un toucher sur le plan le ferme.
//
// Pour l'inclure dans la page Table :
//   import { monter as monterTableHeros } from "./table-heros.js";
//   monterTableHeros(document.getElementById("page"));

import { echapper as e } from "../api.js";
import { essentiel, titre } from "../aventuriers/regles.js";
import { demander } from "./carnet-vue.js";
import { ecouterFlux } from "./flux.js";
import { MonSac } from "./sac.js";

const FEUILLES = ["../../css/sac-coin.css", "../../css/table-heros.css"].map((x) => new URL(x, import.meta.url).pathname);
const CARACS = [["physique", "Physique"], ["social", "Social"], ["mental", "Mental"]];
const CARTONS = { jaune: -10, rouge: -30 };
const ATTENTE_NOTES = 1200; // millisecondes sans frapper avant d'enregistrer
const NOTES_MAX = 20000; // le plafond de l'atelier (notes.py)

let monte = null;

const prenom = (nom) => String(nom || "").split(/[\s,]+/)[0] || "";
const monogramme = (nom) => (String(nom || "").replace(/^(le|la|les|l['’])\s*/i, "").trim().charAt(0) || "?").toUpperCase();
const heure = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};
// Le coût d'un don tel que l'écrit la fiche : « 2 », « 2 Psy », « 1 dé ».
const cout = (c) => {
  const t = String(c ?? "").trim();
  return !t ? "" : /^\d+$/.test(t) ? `${t} Psy` : t;
};

export function monter(page) {
  if (monte || !page) return monte;
  for (const href of FEUILLES) {
    if (document.querySelector(`link[href="${href}"]`)) continue;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    document.head.append(l);
  }

  // ------------------------------------------------------------ la fiche en résumé

  const medaillon = document.createElement("button");
  medaillon.type = "button";
  medaillon.className = "medaillon-table";
  medaillon.hidden = true;
  medaillon.setAttribute("aria-expanded", "false");
  medaillon.setAttribute("aria-controls", "recap-table");
  const recap = document.createElement("section");
  recap.className = "recap-table";
  recap.id = "recap-table";
  recap.hidden = true;
  recap.setAttribute("aria-label", "Ma fiche en résumé");
  document.body.append(recap, medaillon);

  let fiche = null; // la fiche publiée du carnet, ou null
  let deJet = null; // la fiche de jet de la table (carnet fermé)
  let ouvert = ""; // "recap" | "sac" | "notes" | ""
  let lecture = 0;

  async function lireFiche() {
    const n = ++lecture;
    let h = null;
    let j = null;
    try {
      const c = await demander("GET", "/api/carnet");
      h = c.ouvert ? c.heros || null : null;
    } catch {
      // carnet illisible : la fiche de jet suffit
    }
    if (!h) {
      try {
        j = (await demander("GET", "/api/jets")).heros || null;
      } catch {
        j = null;
      }
    }
    if (n !== lecture) return;
    fiche = h;
    deJet = j;
    dessinerMedaillon();
    if (ouvert === "recap") dessinerRecap();
  }

  function dessinerMedaillon() {
    const nom = fiche?.nom || deJet?.nom || "";
    medaillon.hidden = !nom;
    if (!nom) return fermer("recap");
    const image = fiche?.illustration;
    const couleur = /^#[0-9a-f]{3,8}$/i.test(fiche?.couleur || "") ? fiche.couleur : "";
    medaillon.style.setProperty("--c", couleur || "#e0b562");
    medaillon.innerHTML = `${image ? `<img src="${e(image)}" alt="" decoding="async">` : `<span class="lettre">${e(monogramme(nom))}</span>`}<span class="mot">Fiche</span>`;
    medaillon.setAttribute("aria-label", `Ma fiche : ${prenom(nom)}`);
  }

  function htmlCaracs(valeurs, cartons) {
    return `<div class="caracs-recap">${CARACS.map(([k, nom]) => {
      const v = Number(valeurs[k]) || 0;
      const c = cartons?.[k];
      const malus = CARTONS[c] || 0;
      return `<div class="carac-recap${c ? ` carton-${c}` : ""}"><span class="nom">${nom}</span><b>${e(v + malus)}</b>${c ? `<small>carton ${c === "rouge" ? "rouge" : "jaune"}, ${malus}</small>` : `<small>&nbsp;</small>`}</div>`;
    }).join("")}</div>`;
  }

  function dessinerRecap() {
    if (fiche) {
      const f = { ...fiche, sante: fiche.sante_max, psy: fiche.psy_max };
      const x = essentiel(f);
      const t = titre(fiche);
      recap.innerHTML = `
        <header class="tete-recap">
          <div><h2>${e(fiche.nom)}</h2><p>${e([`Niveau ${fiche.niveau || 1}`, t].filter(Boolean).join(" · "))}</p></div>
          <button type="button" class="fermer-panneau" data-fermer aria-label="Fermer la fiche">×</button>
        </header>
        ${htmlCaracs(fiche, fiche.cartons)}
        <p class="defense-recap"><span><b>Défense</b> ${e(x.defense)} %</span><span><b>Armure</b> ${e(x.protection.indice)}${x.bouclier ? " <small>(+2 en défensive)</small>" : ""}</span><span><b>Santé</b> ${e(fiche.sante)}/${e(fiche.sante_max)}</span><span><b>Psy</b> ${e(fiche.psy)}/${e(fiche.psy_max)}</span></p>
        ${x.competences.length ? `<h3>Compétences</h3><ul class="liste-recap">${x.competences.map((c) => `<li><span>${e(c.nom)}</span><b>${e(c.valeur)} %</b></li>`).join("")}</ul>` : ""}
        ${x.armes.length ? `<h3>Armes</h3><ul class="liste-recap">${x.armes.map((w) => `<li><span>${e(w.nom)}${w.nombre > 1 ? ` ×${w.nombre}` : ""}${w.degats ? ` <i>${e(w.degats)}</i>` : ""}</span><b>${e(w.valeur)} %</b></li>`).join("")}</ul>` : ""}
        ${x.dons.length ? `<h3>Dons</h3><div class="dons-recap">${x.dons.map((d) => `<details><summary><span>${e(d.nom)}</span>${cout(d.cout) ? `<small>${e(cout(d.cout))}</small>` : ""}</summary>${d.effet ? `<p>${e(d.effet)}</p>` : "<p class=\"vide\">Effet à voir avec votre MJ.</p>"}</details>`).join("")}</div>` : ""}
        <p class="pied-recap"><a href="/carnet#heros">Toute ma fiche</a></p>`;
    } else if (deJet) {
      const valeurs = Object.fromEntries((deJet.caracs || []).map((c) => [c.cle, c.valeur]));
      const cartons = Object.fromEntries((deJet.caracs || []).filter((c) => c.carton).map((c) => [c.cle, c.carton]));
      recap.innerHTML = `
        <header class="tete-recap">
          <div><h2>${e(deJet.nom)}</h2></div>
          <button type="button" class="fermer-panneau" data-fermer aria-label="Fermer la fiche">×</button>
        </header>
        ${htmlCaracs(valeurs, cartons)}
        ${(deJet.competences || []).length ? `<h3>Compétences</h3><ul class="liste-recap">${deJet.competences.map((c) => `<li><span>${e(c.nom)}</span><b>${c.bonus >= 0 ? "+" : ""}${e(c.bonus)}</b></li>`).join("")}</ul>` : ""}
        ${(deJet.armes || []).length ? `<h3>Armes</h3><ul class="liste-recap">${deJet.armes.map((w) => `<li><span>${e(w.nom)}</span><b>${e(w.degats)}</b></li>`).join("")}</ul>` : ""}
        <p class="vide">Vos dons paraîtront ici quand votre MJ ouvrira le carnet.</p>`;
    } else {
      recap.innerHTML = `<header class="tete-recap"><div><h2>Ma fiche</h2></div><button type="button" class="fermer-panneau" data-fermer aria-label="Fermer la fiche">×</button></header>
        <p class="vide">Votre fiche paraîtra ici quand votre héros sera à la tablée.</p>`;
    }
  }

  // ------------------------------------------------------------ les tiroirs : le sac et les notes

  const tiroir = document.createElement("section");
  tiroir.className = "tiroir-table";
  tiroir.hidden = true;
  tiroir.innerHTML = `
    <div class="panneau-tiroir" data-tiroir="sac" hidden aria-label="Mon sac">
      <header class="tete-recap"><div><h2>Mon sac</h2><p>Ajouter, retirer, compter, donner : votre MJ le voit tout de suite.</p></div>
        <button type="button" class="fermer-panneau" data-fermer aria-label="Fermer le sac">×</button></header>
      <div class="sac-coin sac-table"><p class="vide">Ouverture du sac…</p></div>
    </div>
    <div class="panneau-tiroir" data-tiroir="notes" hidden aria-label="Mes notes">
      <header class="tete-recap"><div><h2>Mes notes</h2><p>Pour vous seul : ni le MJ ni la tablée ne les lisent.</p></div>
        <button type="button" class="fermer-panneau" data-fermer aria-label="Fermer les notes">×</button></header>
      <label class="cache" for="notes-table">Mes notes</label>
      <textarea id="notes-table" class="notes-table" maxlength="${NOTES_MAX}" spellcheck="true" autocomplete="off" placeholder="Un nom entendu, une piste, ce que le marchand a promis…"></textarea>
      <p class="etat-notes" role="status"></p>
    </div>`;
  page.append(tiroir);
  const panneauSac = tiroir.querySelector('[data-tiroir="sac"]');
  const panneauNotes = tiroir.querySelector('[data-tiroir="notes"]');
  const zoneSac = tiroir.querySelector(".sac-table");
  const champ = tiroir.querySelector("textarea");
  const dit = tiroir.querySelector(".etat-notes");
  const monSac = new MonSac();
  let sacMonte = false;

  // Le tiroir se pose juste sous la barre « Mon héros » (sa hauteur change avec la largeur de l'écran).
  function placer() {
    const barre = page.querySelector(".etat-coin");
    const haut = barre && !barre.hidden ? barre.offsetTop + barre.offsetHeight : 0;
    tiroir.style.top = `${haut}px`;
  }
  window.addEventListener("resize", placer);

  async function ouvrirSac() {
    if (!sacMonte) {
      sacMonte = true;
      monSac.monter(zoneSac);
    }
    await monSac.relire();
    if (monSac.etat && !monSac.etat.ouvert) zoneSac.innerHTML = '<p class="vide">Le carnet est fermé : votre sac se gère quand votre MJ l\'ouvre.</p>';
    else if (monSac.etat && !monSac.etat.heros) zoneSac.innerHTML = '<p class="vide">Votre héros n\'est pas encore dans le carnet de la compagnie.</p>';
  }

  // ------------------------------------------------------------ les notes

  let notes = { texte: "", modifie: null }; // ce que l'atelier garde
  let minuterie = 0;
  let envoi = null;
  let encore = false;

  function direNotes(texte, alerte = false) {
    dit.textContent = texte;
    dit.setAttribute("role", alerte ? "alert" : "status");
    dit.dataset.alerte = alerte ? "oui" : "non";
  }

  async function lireNotes() {
    try {
      notes = await demander("GET", "/api/notes");
      if (champ.value === "" || champ.value === notes.texte || !champ.dataset.touche) champ.value = notes.texte || "";
      direNotes(notes.modifie ? `Enregistrées à ${heure(notes.modifie)}.` : "");
    } catch (err) {
      direNotes(err.status === 401 ? "Vous n'êtes plus connecté." : `Notes illisibles pour l'instant (${err.message}).`, true);
    }
  }

  async function enregistrer() {
    clearTimeout(minuterie);
    if (envoi) {
      encore = true;
      return envoi;
    }
    const texte = champ.value;
    if (texte === (notes.texte || "")) return;
    direNotes("Enregistrement…");
    envoi = (async () => {
      try {
        notes = await demander("PUT", "/api/notes", { texte, base: notes.modifie });
        if (champ.value === texte) delete champ.dataset.touche;
        direNotes(`Enregistrées à ${heure(notes.modifie)}.`);
      } catch (err) {
        if (err.status === 409) {
          // Changées entre-temps sur un autre appareil : rien ne se perd, ce qui était tapé ici s'ajoute à la suite.
          const ici = texte;
          await lireNotes();
          if (ici.trim() && ici !== notes.texte) {
            champ.value = `${notes.texte || ""}${notes.texte ? "\n\n" : ""}${ici}`.slice(0, NOTES_MAX);
            champ.dataset.touche = "oui";
            encore = true;
            direNotes("Vos notes avaient changé sur un autre appareil : les deux versions sont gardées, l'une après l'autre.", true);
          }
        } else direNotes(err.status === 0 ? "Pas de réseau : vos notes partiront dès qu'il revient." : err.message, true);
      }
    })().finally(() => {
      envoi = null;
      if (encore) {
        encore = false;
        minuterie = setTimeout(enregistrer, 400);
      }
    });
    return envoi;
  }

  champ.addEventListener("input", () => {
    champ.dataset.touche = "oui";
    clearTimeout(minuterie);
    minuterie = setTimeout(enregistrer, ATTENTE_NOTES);
    if (champ.value.length > NOTES_MAX * 0.9) direNotes(`${champ.value.length} signes sur ${NOTES_MAX}.`);
  });
  champ.addEventListener("blur", () => enregistrer());
  window.addEventListener("pagehide", () => enregistrer());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") enregistrer();
  });

  // ------------------------------------------------------------ ouvrir, fermer

  function etatDesBoutons() {
    document.body.dataset.tiroir = ouvert;
    medaillon.setAttribute("aria-expanded", String(ouvert === "recap"));
    for (const b of document.querySelectorAll(".etat-coin [data-tiroir]")) b.setAttribute("aria-expanded", String(ouvert === b.dataset.tiroir));
  }

  function ouvrir(quoi) {
    if (ouvert === quoi) return fermer(quoi);
    if (ouvert === "notes") enregistrer();
    ouvert = quoi;
    recap.hidden = quoi !== "recap";
    tiroir.hidden = quoi !== "sac" && quoi !== "notes";
    panneauSac.hidden = quoi !== "sac";
    panneauNotes.hidden = quoi !== "notes";
    etatDesBoutons();
    if (quoi === "recap") {
      dessinerRecap();
      lireFiche();
    } else if (quoi === "sac") {
      placer();
      ouvrirSac();
    } else if (quoi === "notes") {
      placer();
      lireNotes();
      setTimeout(() => champ.focus({ preventScroll: true }), 50);
    }
  }

  function fermer(quoi) {
    if (quoi && ouvert !== quoi) return;
    if (ouvert === "notes") enregistrer();
    ouvert = "";
    recap.hidden = true;
    tiroir.hidden = true;
    etatDesBoutons();
  }

  medaillon.addEventListener("click", () => ouvrir("recap"));
  window.addEventListener("tiroir-coin", (ev) => ouvrir(ev.detail));
  for (const p of [recap, tiroir]) {
    p.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-fermer]")) fermer();
    });
  }
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && ouvert) fermer();
  });
  // Un toucher sur le plan (ou sur l'écran de la TV) referme le panneau : le jeu reprend la main.
  page.querySelector(".zone-table")?.addEventListener("pointerdown", () => {
    if (ouvert === "recap" || ouvert === "sac") fermer();
  });

  ecouterFlux("carnet", () => lireFiche());
  ecouterFlux("table", () => {
    if (!fiche) lireFiche();
  });
  lireFiche();
  monte = { ouvrir, fermer };
  return monte;
}
