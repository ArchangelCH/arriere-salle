// « Pour le carnet des joueurs », dans Séances › Clore, avant « Clore la séance » : ce que le carnet de la compagnie
// recevra de cette séance, et de quoi le régler sans changer d'onglet. Le récit (le « Précédemment », ou un texte écrit
// pour le carnet quand celui-ci nomme ce que les joueurs ne savent pas encore), les affiches de la séance à marquer
// prises ou réussies, ses rumeurs entendues, ses lieux et ses PNJ encore inconnus avec « Marquer connu ». Rien ne se
// marque tout seul : ce sont les décisions du MJ. Le carnet ne publie que les séances closes.

import { api, echapper as e, toast } from "../api.js";
import { ETATS_CONTRAT, ETATS_RUMEUR } from "../auberge/tables.js";
import { sousLaMain } from "./sous-la-main.js";
import { demander } from "../commun/dialogue.js";

const NOMS_CONTRAT = Object.fromEntries(ETATS_CONTRAT);
const NOMS_RUMEUR = Object.fromEntries(ETATS_RUMEUR);
const POUR_LE_CARNET = [["pris", "Pris"], ["reussi", "Réussi"], ["echoue", "Échoué"]];
const tronquer = (t, n) => (String(t || "").length > n ? `${String(t).slice(0, n - 1).trimEnd()}…` : String(t || ""));

// « la Ferme aux Corbeaux », « Anton », « le peuple caché d'Isaure » : un nom tel qu'il se lit au milieu d'une phrase.
function dansLaPhrase(x) {
  if (x.genre === "peuple") return `le peuple caché de ${(x.de || []).join(" et ") || "un aventurier"}`;
  return String(x.nom || "").replace(/^(?:La |Le |Les |L['’])/, (m) => m.toLowerCase());
}

// « tant que les joueurs ne connaissent pas la Ferme aux Corbeaux », « … ne connaissent ni la Ferme aux Corbeaux, ni Anton ».
export function tantQueInconnus(secrets) {
  // Deux fiches homonymes (deux « Jehan ») ne font qu'un nom dans la phrase ; l'avis, lui, garde une ligne par fiche.
  const noms = [...new Set(secrets.map(dansLaPhrase))];
  return noms.length > 1 ? `tant que les joueurs ne connaissent ni ${noms.join(", ni ")}` : `tant que les joueurs ne connaissent pas ${noms[0]}`;
}

// La dernière ligne de l'avis des noms inconnus (seances.js, avertirSecrets) quand le texte vérifié part au carnet :
// ce qu'il deviendra, au lieu de « Rien n'est bloqué ». null : l'avis garde sa phrase (le titre de l'épisode).
export function suiteDuTexte(champ, secrets, seance) {
  if (!secrets?.length) return null;
  if (champ === "precedemment_carnet") return `Le carnet le gardera de côté ${tantQueInconnus(secrets)} : corrigez-le, ou marquez connu ce que les héros ont découvert en jouant.`;
  if (champ !== "precedemment") return null;
  if ((seance?.precedemment_carnet || "").trim()) return "La TV le montrera ; le carnet lira le texte écrit pour lui.";
  return `La TV le montrera ; le carnet le gardera de côté ${tantQueInconnus(secrets)}. Corrigez le texte, écrivez-en un « Pour le carnet des joueurs », ou marquez connu ce que les héros ont découvert.`;
}

export class PourLeCarnet {
  // seances : l'onglet Séances, qui tient la séance affichée et les fiches (contrats, rumeurs, lieux, PNJ).
  constructor(seances) {
    this.seances = seances;
    this.jeton = 0;
  }

  zone() {
    return this.seances.racine.querySelector(".pour-le-carnet");
  }

  html(s) {
    return `
      <section class="pour-le-carnet" aria-labelledby="pour-le-carnet-titre">
        <h2 id="pour-le-carnet-titre">Pour le carnet des joueurs</h2>
        <p class="aide">Ce que les joueurs retrouveront dans leur carnet, depuis leur lien${s.close ? "" : ", une fois la séance close"}.</p>
        <h3>Le récit</h3>
        <p class="etat-recit" aria-live="polite">${e(this.recitSansVerif(s))}</p>
        <label class="champ">Un texte pour le carnet, si le « Précédemment » ne convient pas
          <textarea rows="4" data-s="precedemment_carnet" placeholder="Vide : le carnet reprend le « Précédemment ».">${e(s.precedemment_carnet || "")}</textarea></label>
        <div class="actions"><button type="button" data-carnet="reprendre" ${(s.precedemment || "").trim() ? "" : "disabled"}>Reprendre le « Précédemment »</button></div>
        <div class="carnet-listes">${this.htmlListes(s)}</div>
      </section>`;
  }

  // Le récit avant que le serveur ait dit ce qu'il nomme.
  recitSansVerif(s) {
    if (!(s.precedemment_carnet || "").trim() && !(s.precedemment || "").trim()) return "Le « Précédemment » n'est pas encore écrit : le carnet n'aura rien à raconter de cette séance.";
    return "Vérification des noms…";
  }

  htmlListes(s) {
    const { contrats = [], rumeurs = [], lieux = [], pnj = [] } = this.seances;
    const affiches = (s.contrats || []).map((id) => contrats.find((c) => c.id === id)).filter(Boolean);
    const ouies = (s.rumeurs || []).map((id) => rumeurs.find((r) => r.id === id)).filter(Boolean);
    // « Sous la main » et ce que lient les scènes (sous-la-main.js) : un PNJ lié à une scène jouée a été rencontré.
    const sous = sousLaMain(s, { pnj, lieux, plans: this.seances.plans || [] });
    const inconnus = [
      ...sous.lieux.map((x) => x.fiche).filter((l) => !l.connu).map((l) => ({ genre: "lieu", f: l })),
      ...sous.pnj.map((x) => x.fiche).filter((p) => !p.connu).map((p) => ({ genre: "pnj", f: p })),
    ];
    return `
      <h3>Les affiches de la séance</h3>
      ${affiches.length ? `<ul class="carnet-lignes">${affiches.map((c) => `
        <li><span><b>${e(c.nom || "Sans titre")}</b> <i>${e((NOMS_CONTRAT[c.etat] || "Brouillon").split(",")[0])}${POUR_LE_CARNET.some(([k]) => k === c.etat) ? ", pour le carnet" : ""}</i></span>
          <span class="segments" role="group" aria-label="État de « ${e(c.nom || "Sans titre")} »">${POUR_LE_CARNET.map(([k, nom]) => `<button type="button" data-carnet-contrat="${e(c.id)}" data-etat="${k}" aria-pressed="${c.etat === k}">${nom}</button>`).join("")}</span></li>`).join("")}
      </ul>` : '<p class="aide">Aucune affiche sous la main pour cette séance (Préparer › Sous la main).</p>'}
      <h3>Les rumeurs de la séance</h3>
      ${ouies.length ? `<ul class="carnet-lignes">${ouies.map((r) => {
        const entendue = r.etat && r.etat !== "a-placer";
        return `
        <li><span>«&nbsp;${e(tronquer(r.texte, 90))}&nbsp;» <i>${e(NOMS_RUMEUR[r.etat] || "À placer")}${entendue ? ", pour le carnet" : ""}</i></span>
          <button type="button" data-carnet-rumeur="${e(r.id)}" aria-pressed="${Boolean(entendue)}" ${entendue ? "disabled" : ""}>Entendue</button></li>`;
      }).join("")}</ul>` : '<p class="aide">Aucune rumeur prévue pour cette séance.</p>'}
      <h3>Encore inconnus des joueurs</h3>
      ${inconnus.length ? `<ul class="carnet-lignes">${inconnus.map((x) => `
        <li><span><b>${e(x.f.nom)}</b> <i>${x.genre === "lieu" ? "lieu" : "PNJ"}</i></span>
          <button type="button" data-carnet-connu="${e(x.genre)}" data-id="${e(x.f.id)}" title="${x.genre === "lieu" ? "Les héros y sont allés : la carte de la TV le montre là où le brouillard est levé, le carnet l'ajoute." : "Les héros l'ont rencontré : son carton peut aller sur la TV, le carnet l'ajoute."}">Marquer connu</button></li>`).join("")}
      </ul>
      <p class="aide">Le carnet ne montre ni leur fiche, ni un texte qui les nomme.</p>` : '<p class="aide">Les lieux et les PNJ de la séance sont tous connus des joueurs.</p>'}`;
  }

  // Ce que deviendra le récit : le serveur dit s'il nomme un lieu, un PNJ ou un peuple encore inconnu (/api/masque).
  async verifier() {
    const s = this.seances.seance;
    const zone = this.zone();
    if (!s || !zone) return;
    const carnet = (s.precedemment_carnet || "").trim();
    const texte = carnet || (s.precedemment || "").trim();
    const p = zone.querySelector(".etat-recit");
    zone.querySelector('[data-carnet="reprendre"]').disabled = !(s.precedemment || "").trim();
    if (!texte) {
      p.textContent = this.recitSansVerif(s);
      return;
    }
    const n = ++this.jeton;
    let secrets = [];
    try {
      secrets = (await api.post("/api/masque", { texte })).secrets || [];
    } catch {
      if (n === this.jeton) p.textContent = "Vérification impossible pour l'instant : le carnet, lui, retiendra tout texte qui nomme un inconnu.";
      return;
    }
    if (n !== this.jeton || !this.zone()) return;
    p.classList.toggle("retenu", secrets.length > 0);
    p.textContent = secrets.length
      ? (carnet ? `Le carnet gardera ce texte de côté ${tantQueInconnus(secrets)} : retouchez-le, ou marquez connu ce que les héros ont découvert.`
        : `La TV montrera le « Précédemment », mais le carnet le gardera de côté ${tantQueInconnus(secrets)}. Écrivez ci-dessous une version pour le carnet, ou marquez connu ce que les héros ont découvert.`)
      : `Le carnet montrera ${carnet ? "ce texte à la place du « Précédemment »" : "le « Précédemment »"}${s.close ? "" : ", dès la clôture"}.`;
  }

  redessinerListes() {
    const zone = this.zone();
    const s = this.seances.seance;
    if (!zone || !s) return;
    zone.querySelector(".carnet-listes").innerHTML = this.htmlListes(s);
  }

  async clic(b) {
    const s = this.seances.seance;
    if (!s || b.disabled) return;
    const d = b.dataset;
    try {
      if (d.carnet === "reprendre") return this.reprendre(s);
      if (d.carnetContrat) return await this.changerContrat(d.carnetContrat, d.etat);
      if (d.carnetRumeur) return await this.entendre(d.carnetRumeur);
      if (d.carnetConnu) return await this.marquerConnu(d.carnetConnu, d.id);
    } catch (err) {
      toast(`Impossible : ${err.message}`, "erreur");
    }
  }

  // Le « Précédemment » recopié pour le carnet, à retoucher (ôter un nom que les joueurs ne connaissent pas encore).
  async reprendre(s) {
    if (!this.zone()?.querySelector('[data-s="precedemment_carnet"]')) return;
    if ((s.precedemment_carnet || "").trim() && s.precedemment_carnet !== s.precedemment
      && !(await demander({ titre: "Remplacer le texte du carnet ?", texte: "Le texte déjà écrit pour le carnet sera remplacé par le « Précédemment ».", oui: "Remplacer", non: "Garder le mien", danger: true }))) return;
    // Relu après la question : la page a pu se redessiner entre-temps.
    const champ = this.zone()?.querySelector('[data-s="precedemment_carnet"]');
    if (!champ) return;
    s.precedemment_carnet = s.precedemment || "";
    champ.value = s.precedemment_carnet;
    champ.dispatchEvent(new Event("input", { bubbles: true }));
    champ.focus();
    this.verifier();
  }

  // Un seul champ change (PATCH) : une fiche ouverte ailleurs n'est pas écrasée. Chaque geste s'annule depuis le message.
  async changerFiche(collection, liste, id, champs, avant, message) {
    const fiche = liste.find((x) => x.id === id);
    if (!fiche) return;
    Object.assign(fiche, await api.patch(`/api/${collection}/${encodeURIComponent(id)}`, champs));
    this.redessinerListes();
    toast(message(fiche), "info", {
      action: {
        libelle: "Annuler",
        faire: async () => {
          try {
            Object.assign(fiche, await api.patch(`/api/${collection}/${encodeURIComponent(id)}`, avant));
            this.redessinerListes();
            this.verifier();
          } catch (err) {
            toast(`Impossible d'annuler : ${err.message}`, "erreur");
          }
        },
      },
    });
  }

  changerContrat(id, etat) {
    const c = this.seances.contrats.find((x) => x.id === id);
    if (!c || c.etat === etat) return;
    return this.changerFiche("contrats", this.seances.contrats, id, { etat }, { etat: c.etat || "brouillon" },
      (f) => `« ${f.nom} » : ${NOMS_CONTRAT[etat].toLowerCase()}. Le carnet le montrera aux joueurs.`);
  }

  entendre(id) {
    const r = this.seances.rumeurs.find((x) => x.id === id);
    if (!r) return;
    return this.changerFiche("rumeurs", this.seances.rumeurs, id, { etat: "entendue", seance: r.seance || this.seances.seance.id },
      { etat: r.etat || "a-placer", seance: r.seance || null }, () => "Rumeur entendue : elle entrera dans le carnet des joueurs.");
  }

  async marquerConnu(genre, id) {
    const [collection, liste] = genre === "lieu" ? ["lieux", this.seances.lieux] : ["pnj", this.seances.pnj];
    await this.changerFiche(collection, liste, id, { connu: true }, { connu: false },
      (f) => `Les joueurs connaissent maintenant « ${f.nom} » : le carnet l'ajoutera.`);
    this.verifier();
  }
}
