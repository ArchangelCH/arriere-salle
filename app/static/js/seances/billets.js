// Les billets secrets : le mot que le MJ passe à un seul joueur (« Toi seul entends un murmure derrière la porte »).
// Préparés dans Séances › Préparer, imprimés sur une feuille à découper (/billets?seance=…), rappelés dans Jouer quand
// leur scène arrive, puis cochés « remis ».
// Une donnée du MJ : le billet vit dans la séance, que seules les routes de l'atelier lisent. Rien n'en part vers la
// TV, la table publique ni le carnet des joueurs.
// Un billet : { id, pour: [identifiants de la tablée], titre, texte, scene: la clé de sa ligne du déroulé, remis }.
// La scène se désigne par une clé posée sur sa ligne (cle) : monter, descendre ou retirer d'autres scènes ne la perd pas.
// Le billet peut aussi partir sur le téléphone de son joueur (lot F2, prives/telephone.js), au lieu du papier ou en plus :
// « Envoyer sur son téléphone » sous le billet, puis « envoyé à 21 h 02 », « lu à 21 h 04 ». L'impression ne change pas.

import { echapper as e, toast } from "../api.js";
import { GestesPrives, ecouterEtatPrives, htmlBilletTelephone, htmlDocumentTelephone } from "../prives/telephone.js";

const heureFr = (h) => (h ? h.replace(/^0(\d)/, "$1").replace(":", " h ").replace(/ h 00$/, " h") : "");
const tronquer = (t, n) => (String(t || "").length > n ? `${String(t).slice(0, n - 1).trimEnd()}…` : String(t || ""));
const hasard = () => Math.random().toString(36).slice(2, 8);

// Un billet écrit sans personne à qui le remettre : imprimé, il porterait « Pour ______ ».
export const sansDestinataire = (b, tablee = []) => Boolean((b?.texte || "").trim()) && !destinataires(b, tablee).length;

// Ce que la clôture (ou le lancement d'une scène) doit rappeler : billets écrits sans destinataire, billets encore à remettre.
export function billetsAVerifier(s, tablee = []) {
  const ecrits = billetsDe(s).filter((b) => (b.texte || "").trim());
  return { sansDestinataire: ecrits.filter((b) => sansDestinataire(b, tablee)), aRemettre: ecrits.filter((b) => !b.remis) };
}

export const billetsDe = (s) => (Array.isArray(s?.billets) ? s.billets.filter((b) => b && typeof b === "object") : []);

// Le prénom du héros, tel qu'on le dit à table : « Ilian » pour « Ilian de la maison Corval ».
export function prenom(j) {
  const nom = String(j?.personnage || "").trim();
  return nom ? nom.split(/\s+/)[0] : String(j?.joueur || "").trim() || "un héros";
}

// Les héros d'un billet, dans l'ordre de la tablée ; un héros qui a quitté la tablée n'y est plus.
export function destinataires(b, tablee = []) {
  const ids = new Set(Array.isArray(b?.pour) ? b.pour : []);
  return (tablee || []).filter((j) => j && ids.has(j.id));
}

// « Isaure », « Isaure et Mathis », « Isaure, Ilian et Mathis ».
export function pourQui(b, tablee = []) {
  const noms = destinataires(b, tablee).map(prenom);
  if (!noms.length) return "";
  return noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}` : noms[0];
}

// Le rang de la scène du billet dans le déroulé, -1 sans scène (ou si elle a été retirée).
export function rangDeScene(s, b) {
  if (!b?.scene) return -1;
  return (s?.deroule || []).findIndex((d) => d && d.cle === b.scene);
}

// La clé d'une ligne du déroulé, posée au premier billet qui la choisit.
export function cleDeScene(d) {
  if (!d.cle) d.cle = `sc-${hasard()}`;
  return d.cle;
}

// Dans l'ordre du déroulé, ceux sans scène à la fin.
export function billetsOrdonnes(s) {
  const rang = (b) => {
    const i = rangDeScene(s, b);
    return i < 0 ? Infinity : i;
  };
  return billetsDe(s).map((b, k) => ({ b, k })).sort((x, y) => rang(x.b) - rang(y.b) || x.k - y.k).map((x) => x.b);
}

export const billetsDeLaScene = (s, i) => billetsDe(s).filter((b) => rangDeScene(s, b) === i);

// « Scène 4 · 14 h 55 » : le repère discret, sans le titre (il pourrait dévoiler la suite à qui lit le rabat).
export function repereDeScene(s, b) {
  const i = rangDeScene(s, b);
  if (i < 0) return "";
  const h = heureFr(s.deroule[i].heure || "");
  return `Scène ${i + 1}${h ? ` · ${h}` : ""}`;
}

// La phrase ajoutée au compte rendu de « Jouer la scène » : « Billet pour Isaure à remettre. »
export function rappelDeScene(s, i, tablee = []) {
  const restants = billetsDeLaScene(s, i).filter((b) => !b.remis && (b.texte || "").trim());
  if (!restants.length) return "";
  const qui = restants.map((b) => pourQui(b, tablee) || "un héros à choisir");
  return restants.length > 1 ? ` Billets à remettre : ${qui.join(" ; ")}.` : ` Billet pour ${qui[0]} à remettre.`;
}

function optionsScenes(s, b) {
  const rang = rangDeScene(s, b);
  return (s.deroule || []).map((d, i) => {
    const libelle = tronquer([heureFr(d.heure || ""), (d.titre || "").trim() || `Scène ${i + 1}`].filter(Boolean).join(" · "), 58);
    return `<option value="${d.cle ? `cle:${e(d.cle)}` : `rang:${i}`}" ${i === rang ? "selected" : ""}>${e(libelle)}</option>`;
  }).join("");
}

function htmlBillet(s, b, tablee) {
  const pour = new Set(Array.isArray(b.pour) ? b.pour : []);
  const actifs = tablee.filter((j) => j.actif !== false || pour.has(j.id));
  const perdue = b.scene && rangDeScene(s, b) < 0;
  return `
        <li class="billet${b.remis ? " remis" : ""}" data-billet="${e(b.id)}">
          <div class="pour-billet" role="group" aria-label="Pour qui">
            <span class="libelle">Pour</span>
            ${actifs.map((j) => `
            <label class="destinataire"><input type="checkbox" data-billet-pour="${e(j.id)}" ${pour.has(j.id) ? "checked" : ""}>
              <span class="pastille" style="background:${e(j.couleur || "#888")}"></span>${e(prenom(j))}${j.joueur ? ` <i>${e(j.joueur)}</i>` : ""}</label>`).join("") || '<span class="aide">La tablée est vide.</span>'}
          </div>
          <input type="text" value="${e(b.titre || "")}" data-billet-champ="titre" placeholder="Titre, si vous voulez" aria-label="Titre du billet">
          <textarea rows="2" data-billet-champ="texte" placeholder="Toi seul entends un murmure derrière la porte." aria-label="Texte du billet">${e(b.texte || "")}</textarea>
          <div class="pied-billet">
            <label class="scene-billet">Scène<select data-billet-champ="scene">
              <option value="">À remettre quand il faut</option>${optionsScenes(s, b)}
            </select></label>
            ${b.remis ? '<span class="fait">Remis</span>' : ""}
            <button class="lien-danger" data-billet-retirer>Retirer</button>
          </div>
          <p class="alerte-billet" role="status" ${sansDestinataire(b, tablee) ? "" : "hidden"}>Personne n'est choisi dans « Pour » : imprimé, ce billet porterait « Pour ______ ». Touchez le prénom du héros.</p>
          ${perdue ? '<p class="aide">Sa scène a été retirée du déroulé : choisissez-en une autre.</p>' : ""}
          ${telephone(s, b, tablee)}
        </li>`;
}

// Préparer : la liste des billets de la séance, sous « Sous la main ».
export function htmlBillets(s, tablee = []) {
  const billets = billetsDe(s);
  const aImprimer = billets.filter((b) => (b.texte || "").trim()).length;
  return `
      <section class="billets-seance" aria-labelledby="billets-titre">
        <h2 id="billets-titre">Billets secrets <span class="compte">${billets.length || ""}</span></h2>
        <p class="aide">Un mot pour un seul joueur, sur papier : imprimés sur une feuille à découper, le prénom du héros dehors, le texte dedans. Ou sur son téléphone, si son joueur est relié au coin. Rien ne part vers la TV ni le carnet.</p>
        ${billets.length ? `<ol class="billets">${billets.map((b) => htmlBillet(s, b, tablee)).join("")}</ol>` : ""}
        <div class="actions">
          <button data-billet-ajouter>Ajouter un billet</button>
          ${aImprimer ? `<a class="bouton" href="/billets?seance=${e(encodeURIComponent(s.id))}" target="_blank" rel="noopener">Imprimer ${aImprimer > 1 ? `les ${aImprimer} billets` : "le billet"}</a>` : ""}
        </div>
      </section>`;
}

// Sous le billet, ses téléphones (prives/telephone.js) : rien tant qu'aucun destinataire n'a de joueur relié au coin.
const telephone = (s, b, tablee) => htmlBilletTelephone(s, b, destinataires(b, tablee).map((j) => ({ j, prenom: prenom(j) })));

// devant : ce qui précède le texte, « Scène 4 · 14 h 55. » dans la liste de Jouer.
function htmlRemis(s, b, tablee, devant = "") {
  const qui = pourQui(b, tablee) || "un héros à choisir";
  const titre = (b.titre || "").trim();
  return `
              <li class="${b.remis ? "remis" : ""}"><label class="case"><input type="checkbox" data-billet-remis="${e(b.id)}" ${b.remis ? "checked" : ""}>
                <span><b>Billet pour ${e(qui)}</b>${titre ? ` <i>« ${e(tronquer(titre, 50))} »</i>` : ""}<small>${e(devant + tronquer((b.texte || "").trim(), 140))}</small></span></label>
                <span class="etat">${b.remis ? "remis" : "à remettre"}</span>${telephone(s, b, tablee)}</li>`;
}

// Jouer : sous la scène en cours, ses billets, à cocher une fois remis.
export function htmlRappel(s, i, tablee = []) {
  const billets = billetsDeLaScene(s, i).filter((b) => (b.texte || "").trim());
  if (!billets.length) return "";
  return `
            <ul class="billets-scene" aria-label="Billets de cette scène">${billets.map((b) => htmlRemis(s, b, tablee)).join("")}
            </ul>`;
}

// Jouer, sous « À montrer » : tous les billets de la séance, ceux de chaque scène et ceux « quand il faut ».
export function htmlBilletsJeu(s, tablee = []) {
  const billets = billetsOrdonnes(s).filter((b) => (b.texte || "").trim());
  if (!billets.length) return "";
  const restent = billets.filter((b) => !b.remis).length;
  return `
          <section class="billets-jeu" aria-labelledby="billets-jeu-titre">
            <h2 id="billets-jeu-titre">Billets <span class="compte">${restent ? `${restent} à remettre` : "tous remis"}</span></h2>
            <ul>${billets.map((b) => htmlRemis(s, b, tablee, `${repereDeScene(s, b) || "Quand il faut"}. `)).join("")}
            </ul>
          </section>`;
}

// Les gestes des billets, pour la page Séances (seances.js) : elle tient la séance, l'enregistre et redessine.
export class Billets {
  constructor(seances) {
    this.seances = seances;
    // Les téléphones des joueurs : le billet s'enregistre d'abord, le serveur le lit sur le disque ; parti vers
    // tous ses destinataires, il est coché « remis ». Le canal de l'atelier redessine « envoyé », puis « lu ».
    this.telephone = new GestesPrives({ avant: () => this.enregistrerDabord(), apres: (r, genre, corps) => this.envoye(r, genre, corps) });
    this.telephone.seance = () => this.seances.seance?.id;
    this.finTelephone = ecouterEtatPrives(() => this.majTelephones());
  }

  detruire() {
    this.finTelephone?.();
  }

  async enregistrerDabord() {
    const S = this.seances;
    if (!S.resteAEnvoyer() && !S.sauver.enAttente()) return true;
    return Boolean(await S.sauver.maintenant());
  }

  envoye(r, genre, corps) {
    const s = this.seances.seance;
    const b = genre === "billet" && s && s.id === corps.seance ? billetsDe(s).find((x) => x.id === corps.billet) : null;
    if (!b || !r.tous || !r.envoyes.length || b.remis) return;
    b.remis = true;
    this.seances.marquer("seance", s.id);
    this.redessinerJeu();
    const li = this.seances.racine.querySelector(`.billets-seance [data-billet="${CSS.escape(b.id)}"]`);
    if (li) li.classList.add("remis");
  }

  // L'état des téléphones a changé (un envoi, une lecture, un autre écran) : seuls les blocs des téléphones se redessinent,
  // jamais le champ qu'on tape.
  majTelephones() {
    const S = this.seances;
    // L'état peut arriver avant que la page ait lu ses séances : elle dessinera elle-même.
    if (S.detruit || !Array.isArray(S.seances) || !S.racine) return;
    const s = S.seance;
    if (!s) return;
    for (const zone of S.racine.querySelectorAll(".tel-billet[data-tel-billet]")) {
      const b = billetsDe(s).find((x) => x.id === zone.dataset.telBillet);
      if (b && !zone.contains(document.activeElement)) zone.outerHTML = telephone(s, b, this.tablee);
    }
    for (const zone of S.racine.querySelectorAll(".tel-document[data-tel-document]")) {
      const d = (S.documents || []).find((x) => x.id === zone.dataset.telDocument);
      if (d && !zone.querySelector("details[open]")) zone.outerHTML = htmlDocumentTelephone(d, { court: true });
    }
  }

  get tablee() {
    return this.seances.campagne?.tablee || [];
  }

  billet(el) {
    const s = this.seances.seance;
    const id = el.closest("[data-billet]")?.dataset.billet || el.dataset.billetRemis;
    return s && id ? billetsDe(s).find((b) => b.id === id) || null : null;
  }

  // Préparer : la section se redessine seule, le focus revient où il était.
  redessiner(focus = null) {
    const s = this.seances.seance;
    const zone = this.seances.racine.querySelector(".billets-seance");
    if (!s || !zone) return;
    zone.outerHTML = htmlBillets(s, this.tablee);
    this.seances.racine.querySelectorAll(".billets-seance textarea").forEach((t) => {
      t.style.height = "auto";
      t.style.height = `${t.scrollHeight + 2}px`;
    });
    if (focus) this.seances.racine.querySelector(focus)?.focus();
  }

  // Jouer : le rappel sous la scène et la liste des billets suivent la case « remis ».
  redessinerJeu(focusId = null) {
    const S = this.seances;
    const s = S.seance;
    if (!s || S.onglet !== "jouer") return;
    S.majDerouleJeu();
    const zone = S.racine.querySelector(".billets-jeu");
    const html = htmlBilletsJeu(s, this.tablee);
    if (zone) zone.outerHTML = html;
    if (focusId) S.racine.querySelector(`[data-billet-remis="${CSS.escape(focusId)}"]`)?.focus();
  }

  // Un champ d'un billet : le texte à la frappe, les cases et la scène quand elles changent. Rend vrai si traité.
  saisie(el, change) {
    const d = el.dataset;
    if (d.billetRemis !== undefined) {
      if (!change) return true;
      const b = this.billet(el);
      if (!b) return true;
      b.remis = el.checked;
      this.seances.marquer("seance");
      this.redessinerJeu(b.id);
      return true;
    }
    const b = this.billet(el);
    if (!b) return false;
    if (d.billetPour !== undefined) {
      if (!change) return true;
      const pour = new Set(Array.isArray(b.pour) ? b.pour : []);
      if (el.checked) pour.add(d.billetPour);
      else pour.delete(d.billetPour);
      b.pour = this.tablee.map((j) => j.id).filter((id) => pour.has(id));
      this.majAlerte(el, b);
      this.seances.marquer("seance");
      this.majTelephone(b);
      return true;
    }
    if (d.billetChamp === "scene") {
      if (!change) return true;
      const s = this.seances.seance;
      const [genre, valeur] = el.value.split(/:(.*)/s);
      if (genre === "rang") {
        const ligne = s.deroule?.[+valeur];
        b.scene = ligne ? cleDeScene(ligne) : "";
      } else b.scene = genre === "cle" ? valeur : "";
      this.seances.marquer("seance");
      // L'avis « sa scène a été retirée » s'efface.
      if (el.closest(".billet")?.querySelector(".aide")) this.redessiner(`[data-billet="${CSS.escape(b.id)}"] [data-billet-champ="scene"]`);
      return true;
    }
    if (d.billetChamp === "titre" || d.billetChamp === "texte") {
      if (change) return true;
      b[d.billetChamp] = el.value;
      this.seances.marquer("seance");
      if (d.billetChamp === "texte") {
        this.majImprimer();
        this.majAlerte(el, b);
      }
      this.majTelephone(b);
      return true;
    }
    return false;
  }

  // Le texte ou les destinataires d'un billet changent : son bloc du téléphone suit (« Renvoyer la nouvelle version »).
  majTelephone(b) {
    const s = this.seances.seance;
    for (const zone of this.seances.racine.querySelectorAll(`.tel-billet[data-tel-billet="${CSS.escape(b.id)}"]`)) {
      if (!zone.contains(document.activeElement)) zone.outerHTML = telephone(s, b, this.tablee);
    }
  }

  // L'avis « personne dans Pour » suit les cases et le texte, sans redessiner le champ qu'on tape.
  majAlerte(el, b) {
    const alerte = el.closest(".billet")?.querySelector(".alerte-billet");
    if (alerte) alerte.hidden = !sansDestinataire(b, this.tablee);
  }

  // Le lien « Imprimer » paraît avec le premier texte écrit, sans redessiner le champ qu'on tape.
  majImprimer() {
    const s = this.seances.seance;
    const zone = this.seances.racine.querySelector(".billets-seance .actions");
    if (!s || !zone) return;
    const n = billetsDe(s).filter((b) => (b.texte || "").trim()).length;
    const lien = zone.querySelector("a.bouton");
    if (!n) return lien?.remove();
    const libelle = `Imprimer ${n > 1 ? `les ${n} billets` : "le billet"}`;
    if (lien) lien.textContent = libelle;
    else zone.insertAdjacentHTML("beforeend", `<a class="bouton" href="/billets?seance=${e(encodeURIComponent(s.id))}" target="_blank" rel="noopener">${libelle}</a>`);
  }

  clic(b) {
    const s = this.seances.seance;
    if (!s) return;
    if (b.hasAttribute("data-billet-ajouter")) {
      const billet = { id: `b-${hasard()}`, pour: [], titre: "", texte: "", scene: "", remis: false };
      s.billets = [...billetsDe(s), billet];
      this.seances.marquer("seance");
      return this.redessiner(`[data-billet="${CSS.escape(billet.id)}"] textarea`);
    }
    if (b.hasAttribute("data-billet-retirer")) return this.retirer(s, this.billet(b));
  }

  // Retiré d'un clic : « Annuler », dix secondes, le remet à sa place.
  retirer(s, billet) {
    if (!billet) return;
    const rang = billetsDe(s).indexOf(billet);
    s.billets = billetsDe(s).filter((x) => x !== billet);
    this.seances.marquer("seance");
    this.redessiner();
    const qui = pourQui(billet, this.tablee);
    toast(`Billet retiré${qui ? ` (pour ${qui})` : ""}.`, "info", {
      action: {
        libelle: "Annuler",
        faire: () => {
          const liste = billetsDe(s);
          if (liste.some((x) => x.id === billet.id)) return;
          liste.splice(Math.min(rang, liste.length), 0, billet);
          s.billets = liste;
          this.seances.marquer("seance", s.id);
          if (this.seances.seance === s) this.redessiner();
        },
      },
    });
  }
}
