// Les pages Cartes : la liste, la carte ouverte, ses éditeurs.

import { partageeParUnAutre } from "../mj/partage.js";
import { api, echapper as e, toast } from "../api.js";
import { encoderCarte } from "../carte/format.js";
import { B } from "../carte/biomes.js";
import { CARTE_MONDE, CARTE_REGION, CHAPO_CARTES, EXEMPLES_CARTES } from "../campagne/cartes-libelles.js";
import { annoncerCorbeille } from "../corbeille/corbeille.js";
import { jeterCarte } from "../lieux/jeter-carte.js";
import { estInvite } from "../mj/role.js";
import { demander } from "../commun/dialogue.js";
import { MODELES, generer } from "../plan/generateurs.js";
import { attente, importerUvtt, nomDuFichier } from "../plan/importer-uvtt.js";
import { nouveauPlan } from "../plan/modele.js";
import { AIDE_UVTT, PERTES_UVTT } from "../plan/uvtt.js";
import { FORMATS, S, chargerEditeurCarte, chargerGenerateurCarte, date, onglet, page, vignettePlan } from "./etat.js";
import { monter, perimee } from "./routeur.js";

// L'identifiant que le serveur donne à une carte d'après son nom (api/utilitaires.slug) : la carte du monde déjà créée
// sous son nom par défaut se reconnaît à lui.
const identifiant = (nom) => nom.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");

async function pageCartes(n = S.navigation, parametres = new URLSearchParams()) {
  onglet("cartes");
  // Un MJ invité n'a que ses plans : les cartes du monde du MJ principal se regardent dans « Le monde » (mj/monde.js).
  const invite = estInvite();
  page.innerHTML = `<section class="page-liste"><div class="chargement">Chargement des ${invite ? "plans" : "cartes"}…</div></section>`;
  const [cartes, plans, lieux] = await Promise.all([invite ? [] : api.get("/api/cartes"), api.get("/api/plans").catch(() => []), api.get("/api/lieux").catch(() => [])]);
  if (perimee(n)) return;
  plans.sort((a, b) => (b.modifie || "").localeCompare(a.modifie || ""));
  lieux.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  const nomLieu = Object.fromEntries(lieux.map((l) => [l.id, l.nom]));
  const idMonde = identifiant(CARTE_MONDE.nom);
  const aMonde = cartes.some((c) => c.id.startsWith(idMonde));
  page.innerHTML = `
    <section class="page-liste">
      ${invite ? `
      <header class="titre-page">
        <p class="kicker">Intérieurs</p>
        <h1>Vos plans</h1>
        <p class="chapo">Une auberge, une crypte, une grotte : des pièces sur quadrillage dont les murs se posent seuls, révélées une à une sur la TV, avec les pions des héros. Les cartes du monde se regardent dans <a href="#/monde">Le monde</a>.</p>
      </header>` : `
      <header class="titre-page">
        <p class="kicker">Cartographie</p>
        <h1>Les cartes de la campagne</h1>
        <p class="chapo">${e(CHAPO_CARTES)} Ce qui est tracé ici s'affiche sur la TV, sous le brouillard que vous choisissez.</p>
      </header>
      <div class="cartes">
        ${cartes.map((c) => `
          <article class="fiche-carte">
            <a href="#/carte/${e(c.id)}" class="ouvrir">
              <h2>${e(c.nom)}</h2>
              <p>${c.largeur} × ${c.hauteur} cases · ${String(c.km_case).replace(".", ",")} km par case</p>
              <p class="date">Modifiée le ${e(date(c.modifie))}</p>
            </a>
            <button class="lien-danger" data-supprimer="${e(c.id)}" data-nom="${e(c.nom)}">Supprimer</button>
          </article>`).join("")}
        <button class="fiche-carte nouvelle" data-action="nouvelle"><span>Nouvelle carte</span></button>
      </div>
      <header class="titre-page second">
        <p class="kicker">Intérieurs</p>
        <h2>Les plans</h2>
        <p class="chapo">Une auberge, une crypte, une grotte : des pièces sur quadrillage dont les murs se posent seuls, révélées une à une sur la TV, avec les pions des héros.</p>
      </header>`}
      <div class="cartes plans">
        ${plans.map((p) => `
          <article class="fiche-carte fiche-plan">
            <a href="#/plan/${e(p.id)}" class="ouvrir">
              <img class="vignette-plan" src="${vignettePlan(p)}" alt="">
              <h2>${e(p.nom)}</h2>
              <p>${e([nomLieu[p.lieu], p.etage].filter(Boolean).join(" · ") || "sans lieu")} · ${p.largeur} × ${p.hauteur} cases</p>
              <p class="date">Modifié le ${e(date(p.modifie))}</p>
            </a>
            <button class="lien-danger" data-supprimer-plan="${e(p.id)}" data-nom="${e(p.nom)}">Supprimer</button>
          </article>`).join("")}
        <button class="fiche-carte nouvelle" data-action="nouveau-plan"><span>Nouveau plan</span></button>
      </div>
      <dialog class="dialogue" id="nouveau-plan">
        <form method="dialog">
          <h2>Nouveau plan</h2>
          ${[["Intérieurs", MODELES.filter((m) => !m.dehors)], ["Extérieurs", MODELES.filter((m) => m.dehors)]].map(([titre, liste]) => `<fieldset class="choix-modele en-colonnes">
            <legend>${titre}</legend>
            ${liste.map((m) => `<label class="modele"><input type="radio" name="modele" value="${m.cle}" ${m === MODELES[0] ? "checked" : ""}><span><strong>${e(m.nom)}</strong>${e(m.aide)}</span></label>`).join("")}
          </fieldset>`).join("")}
          <fieldset class="choix-modele">
            <legend>D'un autre outil</legend>
            <label class="modele"><input type="radio" name="modele" value="uvtt"><span><strong>Importer un plan UVTT</strong>${e(AIDE_UVTT)}</span></label>
            <div class="options-uvtt" hidden>
              <label class="champ">Fichier du plan (.dd2vtt, .uvtt, .df2vtt)<input type="file" name="fichier"></label>
              <p class="aide">${e(PERTES_UVTT)} Le fichier se lit sur cet appareil : seule son image, réduite, part vers l'atelier.</p>
            </div>
          </fieldset>
          <label class="champ">Lieu<select name="lieu"><option value="">aucun lieu</option>${lieux.map((l) => `<option value="${e(l.id)}">${e(l.nom)}</option>`).join("")}</select></label>
          <label class="champ">Nom<input type="text" name="nom" required placeholder="${e(EXEMPLES_CARTES.plan)}"></label>
          <div class="actions">
            <button value="annuler" formnovalidate>Annuler</button>
            <button class="principal" value="creer">Créer le plan</button>
          </div>
        </form>
      </dialog>
      <dialog class="dialogue" id="nouvelle">
        <form method="dialog">
          <h2>Nouvelle carte</h2>
          <fieldset class="choix-modele">
            <label class="modele"><input type="radio" name="modele" value="cratere" ${aMonde ? "" : "checked"}>
              <span><strong>${e(CARTE_MONDE.titre)}</strong>${e(CARTE_MONDE.aide)}</span></label>
            <label class="modele"><input type="radio" name="modele" value="pays">
              <span><strong>${e(CARTE_REGION.titre)}</strong>${e(CARTE_REGION.aide)}</span></label>
            <label class="modele"><input type="radio" name="modele" value="vierge" ${aMonde ? "checked" : ""}>
              <span><strong>Carte vierge</strong>Une région, une vallée, les alentours d'un village : vous peignez tout.</span></label>
            ${cartes.length ? `<label class="modele"><input type="radio" name="modele" value="region">
              <span><strong>Une région d'une carte existante</strong>Les alentours d'un village, la vallée de la séance : l'atelier en tire une carte plus précise, avec les mêmes côtes, rivières, routes et lieux. La carte d'origine s'ouvre, le cadre prêt à tracer.</span></label>` : ""}
          </fieldset>
          ${cartes.length ? `<div class="options-region" hidden><label class="champ">Carte d'origine<select name="origine">${cartes.map((c) => `<option value="${e(c.id)}">${e(c.nom)}</option>`).join("")}</select></label></div>` : ""}
          <label class="champ nom-carte-neuve">Nom<input type="text" name="nom" required value="${aMonde ? "" : e(CARTE_MONDE.nom)}" placeholder="${e(EXEMPLES_CARTES.carte)}"></label>
          <div class="options-vierge" ${aMonde ? "" : "hidden"}>
            <label class="champ">Format<select name="format">
              ${Object.entries(FORMATS).map(([k, f]) => `<option value="${k}" ${k === "region" ? "selected" : ""}>${f.nom} (${f.aide})</option>`).join("")}
            </select></label>
            <label class="champ">Terrain de départ<select name="fond">
              <option value="${B.plaine}">Plaine</option><option value="${B.foret}">Forêt</option><option value="${B.collines}">Collines</option><option value="${B.eau}">Mer</option>
              <option value="hasard">Relief au hasard : plaines, bois, collines, lacs, un massif</option>
            </select></label>
          </div>
          <div class="actions">
            <button value="annuler" formnovalidate>Annuler</button>
            <button class="principal" value="creer">Créer la carte</button>
          </div>
        </form>
      </dialog>
    </section>`;
  const dlg = page.querySelector("#nouvelle");
  const form = dlg.querySelector("form");
  page.querySelector('[data-action="nouvelle"]')?.addEventListener("click", () => dlg.showModal());
  form.addEventListener("change", () => {
    const vierge = form.modele.value === "vierge";
    form.querySelector(".options-vierge").hidden = !vierge;
    // Une région d'une carte existante : son nom se donne dans la carte d'origine, une fois le cadre tracé.
    const region = form.modele.value === "region";
    const regionOptions = form.querySelector(".options-region");
    if (regionOptions) regionOptions.hidden = !region;
    form.querySelector(".nom-carte-neuve").hidden = region;
    form.nom.required = !region;
    dlg.querySelector('button[value="creer"]').textContent = region ? "Ouvrir la carte d'origine" : "Créer la carte";
    if (form.modele.value === "cratere" && !form.nom.value) form.nom.value = CARTE_MONDE.nom;
    if (form.modele.value === "pays" && !form.nom.value) form.nom.value = CARTE_REGION.nom;
  });
  dlg.addEventListener("close", async () => {
    if (dlg.returnValue !== "creer") return;
    if (form.modele.value === "region" && form.origine?.value) {
      location.hash = `#/carte/${encodeURIComponent(form.origine.value)}?detailler`;
      return;
    }
    const nom = form.nom.value.trim();
    if (!nom) return;
    page.querySelector(".cartes").insertAdjacentHTML("beforebegin", `<div class="chargement">Création de la carte…</div>`);
    try {
      let id;
      if (form.modele.value === "cratere") id = await (await chargerEditeurCarte()).creerCarteCratere(nom, Math.floor(Math.random() * 1e6));
      else if (form.modele.value === "pays") id = await (await chargerEditeurCarte()).creerPaysCastelblanc(nom, Math.floor(Math.random() * 1e6));
      else {
        const { genererVierge, placerCartouche } = await chargerGenerateurCarte();
        const f = FORMATS[form.format.value];
        const hasard = form.fond.value === "hasard";
        const carte = genererVierge({ largeur: f.largeur, hauteur: f.hauteur, km_case: f.km_case, fond: hasard ? B.plaine : +form.fond.value, relief: hasard, graine: Math.floor(Math.random() * 1e6) });
        carte.nom = nom;
        carte.taille_textes = f.taille_textes;
        carte.style = "peint";
        carte.decor.cartouche.titre = nom;
        carte.decor.cartouche.taille = 3.2 * f.taille_textes;
        carte.decor.cartouche.x = placerCartouche(nom, carte.decor.cartouche.taille, carte.largeur);
        carte.decor.rose.taille = 10 * f.taille_textes;
        id = (await api.post("/api/cartes", encoderCarte({ ...carte, brouillard: new Uint8Array(carte.largeur * carte.hauteur) }))).id;
      }
      location.hash = `#/carte/${id}`;
    } catch (err) {
      toast(`Création impossible : ${err.message}`, "erreur");
      pageCartes();
    }
  });
  const dlgPlan = page.querySelector("#nouveau-plan");
  const formPlan = dlgPlan.querySelector("form");
  // Le nom se propose tout seul : le lieu, puis la partie du bâtiment.
  let nomTouche = false;
  const suffixes = { auberge: ", rez-de-chaussée", "auberge-etage": ", étage" };
  const MODELE_DU_LIEU = { capitale: "ville", cite: "ville", ville: "ville", village: "village", camp: "camp", ruine: "ruines", port: "cote", grotte: "grotte", mine: "grotte", tombeau: "crypte" };
  const proposerNom = () => {
    if (nomTouche) return;
    const lieu = lieux.find((l) => l.id === formPlan.lieu.value);
    const m = MODELES.find((x) => x.cle === formPlan.modele.value);
    // Un plan importé : le nom du lieu, sinon celui du fichier.
    if (!m) formPlan.nom.value = lieu ? lieu.nom : nomDuFichier(formPlan.fichier.files[0]);
    else formPlan.nom.value = lieu ? `${lieu.nom}${suffixes[m.cle] || ""}` : m.cle === "vierge" ? "" : m.nom;
  };
  // « Importer un plan UVTT » : le choix du fichier paraît, et le bouton dit ce qu'il fait.
  const suivreChoix = () => {
    const uvtt = formPlan.modele.value === "uvtt";
    formPlan.querySelector(".options-uvtt").hidden = !uvtt;
    formPlan.fichier.required = uvtt;
    dlgPlan.querySelector('button[value="creer"]').textContent = uvtt ? "Importer le plan" : "Créer le plan";
  };
  formPlan.nom.addEventListener("input", () => { nomTouche = true; });
  formPlan.addEventListener("change", (ev) => {
    suivreChoix();
    if (ev.target.name !== "nom") proposerNom();
  });
  const ouvrirPlan = (lieu = "") => {
    nomTouche = false;
    formPlan.lieu.value = lieu;
    const l = lieux.find((x) => x.id === lieu);
    if (l && /auberge|taverne/i.test(`${l.type} ${l.nom}`)) formPlan.modele.value = "auberge";
    // Le plan qui va au type du lieu : une ville, un village, un camp, des ruines, un port sur la côte.
    else if (l && MODELE_DU_LIEU[l.type]) formPlan.modele.value = MODELE_DU_LIEU[l.type];
    suivreChoix();
    proposerNom();
    dlgPlan.showModal();
  };
  page.querySelector('[data-action="nouveau-plan"]').addEventListener("click", () => ouvrirPlan());
  if (parametres.get("nouveau-plan")) ouvrirPlan(parametres.get("nouveau-plan"));
  dlgPlan.addEventListener("close", async () => {
    if (dlgPlan.returnValue !== "creer") return;
    if (formPlan.modele.value === "uvtt") return creerDepuisUvtt(formPlan.fichier.files[0], formPlan.nom.value.trim(), formPlan.lieu.value);
    const plan = generer(formPlan.modele.value);
    plan.nom = formPlan.nom.value.trim() || plan.nom;
    plan.lieu = formPlan.lieu.value;
    if (formPlan.modele.value === "auberge") plan.etage = "rez-de-chaussée";
    if (formPlan.modele.value === "auberge-etage") plan.etage = "étage";
    try {
      const cree = await api.post("/api/plans", plan);
      location.hash = `#/plan/${cree.id}`;
    } catch (err) {
      toast(`Création impossible : ${err.message}`, "erreur");
    }
  });
  // Sans confirmation : le message qui suit porte « Annuler », et la corbeille garde tout.
  for (const b of page.querySelectorAll("[data-supprimer-plan]")) {
    b.addEventListener("click", async () => {
      try {
        await api.del(`/api/plans/${b.dataset.supprimerPlan}`);
        annoncerCorbeille(`Plan « ${b.dataset.nom} » mis à la corbeille.`, "plans", b.dataset.supprimerPlan, { retour: "#/cartes" });
      } catch (err) {
        toast(`Suppression impossible : ${err.message}`, "erreur");
      }
      pageCartes();
    });
  }
  for (const b of page.querySelectorAll("[data-supprimer]")) {
    b.addEventListener("click", async () => {
      // Des lieux ont leur fiche sur cette carte : le dialogue propose de les poser ailleurs (lieux/jeter-carte.js).
      const siens = lieux.filter((l) => l.carte === b.dataset.supprimer);
      if (siens.length) {
        if (await jeterCarte(cartes.find((c) => c.id === b.dataset.supprimer), siens, cartes)) pageCartes();
        return;
      }
      try {
        await api.del(`/api/cartes/${b.dataset.supprimer}`);
        annoncerCorbeille(`Carte « ${b.dataset.nom} » mise à la corbeille.`, "cartes", b.dataset.supprimer, { retour: "#/cartes" });
      } catch (err) {
        toast(`Suppression impossible : ${err.message}`, "erreur");
      }
      pageCartes();
    });
  }
}

// « Importer un plan UVTT » : le fichier se lit ici (plan/importer-uvtt.js), son image part comme une image de fond, puis
// le plan est créé avec ses pièces et ses portes. Le bilan dit ce qui a été repris et ce qui s'est perdu.
async function creerDepuisUvtt(fichier, nom, lieu) {
  const ici = location.hash;
  const etat = attente("Import du plan");
  let cree;
  let phrases;
  try {
    const r = await importerUvtt(fichier, etat.dire);
    etat.dire("Création du plan…");
    phrases = r.phrases;
    cree = await api.post("/api/plans", {
      ...nouveauPlan({ nom: nom || nomDuFichier(fichier) || "Plan importé", largeur: r.plan.largeur, hauteur: r.plan.hauteur }), ...r.plan, lieu,
      generateur: { modele: "vierge", graine: 1 },
    });
  } catch (err) {
    etat.fermer();
    return toast(`Import impossible : ${err.message || "fichier illisible"}`, "erreur");
  }
  etat.fermer();
  // La page a été quittée pendant l'import : le plan est créé, on le dit sans y emmener de force.
  if (location.hash !== ici) return toast(`Plan « ${cree.nom} » importé : il est dans la liste des plans.`);
  if (await demander({ titre: "Plan importé", texte: phrases, oui: "Ouvrir le plan", non: "Rester ici" })) location.hash = `#/plan/${cree.id}`;
  else if (location.hash === ici) pageCartes();
}

async function pageCarte(n, id, parametres) {
  onglet("cartes");
  page.innerHTML = `<div class="chargement plein">Dépliage de la carte…</div>`;
  let carte;
  let lieux;
  let EditeurCarte;
  try {
    [carte, lieux, { EditeurCarte }] = await Promise.all([api.get(`/api/cartes/${id}`), api.get("/api/lieux"), chargerEditeurCarte()]);
  } catch (err) {
    // La carte d'un lien est à la corbeille : la fiche du lieu visé s'ouvre, et le suit sur sa nouvelle carte.
    if (err.status === 404 && parametres.get("lieu") && !perimee(n)) return location.replace(`#/lieu/${encodeURIComponent(parametres.get("lieu"))}`);
    throw err;
  }
  if (perimee(n)) return;
  // L'éditeur écrit les fiches des lieux de la carte : ceux que l'autre MJ partage (en lecture seule) n'y entrent pas.
  const parId = Object.fromEntries(lieux.filter((l) => !partageeParUnAutre(l)).map((l) => [l.id, l]));
  await monter(n, () => new EditeurCarte(page, carte, parId));
  const lieu = parametres.get("lieu");
  const poser = parametres.get("poser");
  if (parametres.has("detailler") && S.courant instanceof EditeurCarte) {
    history.replaceState(null, "", `#/carte/${encodeURIComponent(id)}`);
    S.courant.detaillerRegion();
  } else if (poser && S.courant instanceof EditeurCarte) S.courant.preparerPose(poser);
  else if (lieu && S.courant instanceof EditeurCarte) {
    // Un lien vers l'ancien identifiant d'un lieu renommé depuis (liens_fiches.py) : le serveur dit lequel il est devenu.
    const vise = parId[lieu] ? lieu : (await api.get(`/api/lieux/${encodeURIComponent(lieu)}`).catch(() => null))?.id || lieu;
    if (perimee(n) || !(S.courant instanceof EditeurCarte)) return;
    const m = S.courant.carte.marqueurs.find((x) => x.lieu === vise);
    if (m) S.courant.allerAuLieu(m.id);
    else S.courant.lieuAbsent(vise);
  }
}

export { pageCarte, pageCartes };
