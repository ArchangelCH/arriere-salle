// Une activité entre les séances dans la boîte « Demandes des joueurs » : une carte dans la liste, puis le détail.
// Le jet que le serveur a jeté sur la fiche (et de quoi la valeur visée est faite), le récit que le joueur a déjà lu, l'or
// que propose le catalogue ; le MJ fixe le montant et sa destination (la bourse du héros, ou la cagnotte d'un chantier),
// écrit « ce que le héros apprend » et un objet pour son sac s'il veut, puis valide ou refuse (en rendant son tour au joueur,
// s'il le souhaite).
// Les suites (une rumeur, une idée, un contrat en brouillon) se créent d'un clic par les routes de l'atelier, jamais
// montrées aux joueurs. Ce que le MJ a écrit reste en mémoire tant que la page est ouverte. Tout texte passe par echapper.

import { api, echapper as e, toast } from "../api.js";
import { noterIdee } from "../idees/idees.js";

const paragraphes = (t) => String(t || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${e(x)}</p>`).join("")
  || '<p class="vide">Vide.</p>';
const prenom = (nom) => String(nom || "").split(/[\s,]+/)[0] || "le héros";
const signe = (n) => (n > 0 ? `+ ${n}` : n < 0 ? `− ${-n}` : "");
const DECISIONS = { acceptee: "Validée", refusee: "Refusée" };
const SUITES = { rumeur: "Une rumeur", idee: "Une idée", contrat: "Un contrat" };
// Ce que le MJ a choisi ou écrit, par demande : le détail rouvert le retrouve ; les suites déjà créées aussi.
const choix = new Map();

function quand(iso) {
  const d = new Date(iso || "");
  if (Number.isNaN(d.getTime())) return "";
  return `le ${d.toLocaleDateString("fr-CH", { day: "numeric", month: "long" })} à ${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
}

// La carte de la liste « À traiter ».
export function htmlCarteActivite(x, cle) {
  return `<li class="demande-mj activite" data-cle="${e(cle)}" data-joueur="${e(x.joueur)}" data-id="${e(x.id)}" data-version="${e(x.version)}">
    <p class="quoi"><b>${e(x.genre_nom)}</b> <span class="quand">${e(quand(x.cree))}</span></p>
    ${x.phrase ? `<p class="phrase-demande">${e(x.phrase)}</p>` : ""}
    ${x.corps?.mot ? `<blockquote class="texte-joueur">${e(x.corps.mot)}</blockquote>` : ""}
    <div class="actions"><button type="button" class="principal" data-activite-ouvrir>Valider l'or</button></div></li>`;
}

export class ValidationActivite {
  constructor(relireBoite) {
    this.relireBoite = relireBoite;
    this.d = null;
    this.v = null;
    this.cle = "";
    this.perimee = false;
    this.minuterie = 0;
  }

  etat() {
    if (!choix.has(this.cle)) choix.set(this.cle, { montant: null, vers: null, apprend: "", objet: "", mot: "", rendre: false, suites: [] });
    return choix.get(this.cle);
  }

  async ouvrir(joueur, id) {
    this.fermer();
    this.cle = `${joueur}/${id}`;
    this.perimee = false;
    const d = document.createElement("dialog");
    d.className = "comparaison-lore validation-activite";
    d.setAttribute("aria-label", "Une activité entre les séances");
    d.innerHTML = '<p class="chargement">Lecture de l\'activité…</p>';
    document.body.append(d);
    d.addEventListener("close", () => {
      this.memoriser();
      clearTimeout(this.minuterie);
      d.remove();
      if (this.d === d) this.d = null;
    });
    d.addEventListener("click", (ev) => this.clic(ev));
    d.addEventListener("submit", (ev) => {
      if (ev.target.closest(".trancher-activite")) ev.preventDefault();
    });
    this.d = d;
    d.showModal();
    await this.lire(joueur, id);
  }

  fermer() {
    if (this.d?.open) this.d.close();
  }

  async lire(joueur = this.v?.joueur.id, id = this.v?.id) {
    let v;
    try {
      v = await api.get(`/api/activites/demandes/${encodeURIComponent(joueur)}/${encodeURIComponent(id)}`);
    } catch (err) {
      if (this.d) this.d.innerHTML = `<p class="vide">L'activité ne s'ouvre pas : ${e(err.message)}.</p><form method="dialog"><button>Fermer</button></form>`;
      return;
    }
    if (!this.d) return;
    this.memoriser();
    this.v = v;
    this.perimee = false;
    this.dessiner();
    clearTimeout(this.minuterie);
    // Le dé roule encore (l'atelier le jette dans l'instant) : le détail se relit seul.
    if (!v.pret && v.statut === "en-attente") this.minuterie = setTimeout(() => this.lire(), 1200);
  }

  // La boîte vient de se relire : l'activité attend-elle encore, à la même version ?
  verifier(vue) {
    if (!this.d || !this.v || this.v.statut !== "en-attente") return;
    const x = (vue.attente || []).find((a) => a.type === "demande" && a.joueur === this.v.joueur.id && a.id === this.v.id);
    if (x && x.version !== this.v.version && !this.v.pret) return this.lire();
    const perimee = !x || x.version !== this.v.version;
    if (perimee === this.perimee) return;
    this.perimee = perimee;
    this.dessiner();
  }

  memoriser() {
    if (!this.d || !this.v) return;
    const s = this.etat();
    const f = this.d.querySelector(".trancher-activite");
    if (!f) return;
    s.montant = f.montant.value;
    s.vers = f.vers.value;
    s.apprend = f.apprend.value;
    s.objet = f.objet.value;
    s.mot = f.mot.value;
    s.rendre = f.rendre.checked;
  }

  // ------------------------------------------------------------ dessin

  htmlJet(j) {
    if (!j) return "";
    const compo = [`${e(j.carac_nom)} ${e(j.base)}`];
    if (j.competence_mj && j.bonus) compo.push(`${e(j.competence_mj)} ${e(signe(j.bonus))}`);
    if (j.modificateur) compo.push(`modificateur ${e(signe(j.modificateur))}`);
    for (const a of j.ajustements || []) compo.push(`${e(a.libelle)} ${e(signe(a.valeur))} %`);
    const classe = j.issue?.startsWith("reussite") ? "reussite" : "echec";
    return `
      <div class="jet-activite ${classe}${j.issue?.endsWith("critique") ? " critique" : ""}">
        <span class="de-mj" role="img" aria-label="Le dé : ${e(j.de)}">${e(String(j.de).padStart(2, "0"))}</span>
        <p><b>${e(j.issue_nom)}</b><span>${compo.join(", ")} : <b>${e(j.visee)} %</b></span></p>
      </div>`;
  }

  htmlProposition(p) {
    if (!p.formule) return "Le catalogue ne propose pas d'or pour cette issue.";
    if (!p.lisible) return `La formule du catalogue, « ${e(p.formule)} », ne se lit pas : fixez l'or ici.`;
    const des = (p.des || []).length ? ` (dés : ${e(p.des.join(", "))})` : "";
    return `Le catalogue propose <b>${e(p.formule)}</b> ${p.vers === "cagnotte" ? "pour une cagnotte" : "pour la bourse"} : tiré, <b>${e(p.montant)} po</b>${des}.`;
  }

  dessiner() {
    const v = this.v;
    if (!this.d || !v) return;
    this.memoriser();
    const s = this.etat();
    const h = v.heros;
    const p = v.proposition || {};
    const ouverte = v.statut === "en-attente";
    const montant = s.montant ?? String(p.montant ?? 0);
    const vers = s.vers || p.destination || "bourse";
    const dests = v.destinations || [];
    const dec = v.decision;
    this.d.innerHTML = `
      <header class="tete-comparaison">
        <div>
          <p class="kicker">Activité entre les séances${v.periode?.libelle ? ` · ${e(v.periode.libelle)}` : ""}</p>
          <h2>${e(v.activite?.nom || "Une activité")} <small>${h ? `${e(h.nom)}, ` : ""}joué${h?.genre === "f" ? "e" : ""} par ${e(v.joueur.nom)}</small></h2>
          <p class="aide">Choisie ${e(quand(v.cree))}${v.traitee && !ouverte ? `, ${e((DECISIONS[v.statut] || v.statut_dit).toLowerCase())} ${e(quand(v.traitee))}` : ""}.</p>
        </div>
        <form method="dialog"><button>Fermer</button></form>
      </header>
      ${this.perimee ? '<p class="alerte-lore">Cette activité a changé depuis votre lecture (un autre écran l\'a traitée) : <button type="button" data-relire>Relire</button></p>' : ""}
      <div class="corps-validation">
        ${v.pret ? this.htmlJet(v.jet) : '<p class="chargement">Le dé roule encore…</p>'}
        ${v.mot_joueur ? `<section><h3>Ce que le joueur a écrit</h3><blockquote class="texte-joueur">${e(v.mot_joueur)}</blockquote></section>` : ""}
        ${v.pret ? `<section><h3>Ce qu'il a lu aussitôt</h3><div class="texte-lore">${paragraphes(v.recit)}</div>
          ${v.recit_retenu ? `<p class="alerte-lore">${e(v.recit_retenu)}</p>` : ""}</section>` : ""}
        ${v.activite?.notes_mj ? `<section class="notes-activite"><h3>Vos notes sur l'activité</h3>${paragraphes(v.activite.notes_mj)}</section>` : ""}
        ${ouverte && v.pret ? `
        <form class="trancher-activite">
          <h3>L'or et la suite</h3>
          <p class="aide">${this.htmlProposition(p)}${h ? ` La bourse de ${e(prenom(h.nom))} : ${e(h.or)} po.` : ""}</p>
          <div class="deux">
            <label class="champ">Or <small>négatif : une perte, prise dans la bourse</small><input type="number" name="montant" step="1" value="${e(montant)}"></label>
            <label class="champ">Vers<select name="vers">${dests.map((x) => `<option value="${e(x.cle)}"${x.cle === vers ? " selected" : ""}>${e(x.nom)}${x.detail ? `, ${e(x.detail)}` : ""}${x.cache ? " (caché aux joueurs)" : ""}</option>`).join("")}</select></label>
          </div>
          <label class="champ">Ce que ${e(prenom(h?.nom))} apprend <small>facultatif, lu par le joueur ; un nom inconnu des joueurs est refusé</small>
            <textarea name="apprend" rows="3" maxlength="${e(v.apprend_max || 1000)}">${e(s.apprend)}</textarea></label>
          <label class="champ">Un objet pour son sac <small>facultatif : une ligne ajoutée à son équipement, lue par le joueur ; un nom inconnu des joueurs est refusé</small>
            <input type="text" name="objet" maxlength="${e(v.objet_max || 300)}" value="${e(s.objet || "")}" placeholder="Une lanterne sourde, une lettre cachetée…"></label>
          <label class="champ">Un mot pour le joueur <small>facultatif</small><textarea name="mot" rows="2" maxlength="${e(v.mot_max || 300)}">${e(s.mot)}</textarea></label>
          <label class="case"><input type="checkbox" name="rendre"${s.rendre ? " checked" : ""}> En refusant, rendre son tour au joueur : il pourra choisir une autre activité pour cette période</label>
          <div class="actions">
            <button type="button" class="principal" data-trancher="valider"${this.perimee ? " disabled" : ""}>Valider</button>
            <button type="button" data-trancher="refuser"${this.perimee ? " disabled" : ""}>Refuser</button>
          </div>
          <p class="erreur-demande" role="alert" hidden></p>
        </form>` : ""}
        ${!ouverte ? `<section class="decision-activite"><h3>${e(DECISIONS[v.statut] || v.statut_dit)}</h3>
          ${v.resultat ? `<p>${e(v.resultat)}</p>` : ""}
          ${v.public?.apprend ? `<p><span class="lbl">Ce que le héros apprend</span>${e(v.public.apprend)}</p>` : ""}
          ${v.public?.objet ? `<p><span class="lbl">Dans son sac</span>${e(v.public.objet)}</p>` : ""}
          ${v.mot ? `<p class="mot-mj">Votre mot : « ${e(v.mot)} »</p>` : ""}
          ${dec?.rendu ? "<p>Tour rendu au joueur.</p>" : ""}</section>` : ""}
        ${v.pret ? `
        <section class="suites-activite">
          <h3>Une suite, en brouillon</h3>
          <p class="aide">Créée dans l'atelier seulement, jamais montrée aux joueurs : vous la placez quand vous voulez.</p>
          <div class="actions">${Object.entries(SUITES).map(([k, nom]) => `<button type="button" data-suite="${k}"${s.suites.some((x) => x.genre === k) ? " disabled" : ""}>${nom}</button>`).join("")}</div>
          ${s.suites.length ? `<ul class="suites-creees">${s.suites.map((x) => `<li>${e(SUITES[x.genre])} créée : <a href="${e(x.lien)}">l'ouvrir</a></li>`).join("")}</ul>` : ""}
        </section>` : ""}
      </div>`;
  }

  // ------------------------------------------------------------ gestes

  erreur(message) {
    const p = this.d?.querySelector(".erreur-demande");
    if (!p) return toast(message, "erreur");
    p.textContent = message;
    p.hidden = !message;
  }

  async clic(ev) {
    if (ev.target.closest("[data-relire]")) return this.lire();
    if (ev.target.closest(".suites-creees a")) return this.fermer();
    const t = ev.target.closest("[data-trancher]");
    if (t && !t.disabled) return this.trancher(t.dataset.trancher);
    const s = ev.target.closest("[data-suite]");
    if (s && !s.disabled) return this.suite(s.dataset.suite, s);
  }

  async trancher(decision) {
    const v = this.v;
    const f = this.d.querySelector(".trancher-activite");
    const montant = Number(f.montant.value);
    if (decision === "valider" && (!Number.isInteger(montant) || f.montant.value.trim() === "")) return this.erreur("L'or est un nombre entier de pièces (0 pour rien).");
    const boutons = [...f.querySelectorAll("button")];
    boutons.forEach((b) => { b.disabled = true; });
    this.erreur("");
    try {
      await api.post(`/api/activites/demandes/${encodeURIComponent(v.joueur.id)}/${encodeURIComponent(v.id)}/trancher`, {
        decision, version: v.version, montant: decision === "valider" ? montant : 0, vers: f.vers.value, apprend: f.apprend.value.trim(),
        objet: decision === "valider" ? f.objet.value.trim() : "", mot: f.mot.value.trim(), rendre: f.rendre.checked,
      });
    } catch (err) {
      boutons.forEach((b) => { b.disabled = false; });
      this.erreur(err.message);
      if (err.status === 404) this.relireBoite();
      return;
    }
    const s = this.etat();
    Object.assign(s, { montant: null, vers: null, apprend: "", objet: "", mot: "", rendre: false });
    toast(decision === "valider" ? `Validée : ${v.joueur.nom} le lit dans son carnet.` : `Refusée : ${v.joueur.nom} le lit dans son carnet.`);
    this.relireBoite();
    await this.lire();
  }

  async suite(genre, bouton) {
    const v = this.v;
    const s = this.etat();
    const heros = v.heros?.nom || "un héros";
    const j = v.jet || {};
    const appris = this.d.querySelector("textarea[name=apprend]")?.value.trim() || v.public?.apprend || "";
    const origine = `Suite de l'activité « ${v.activite?.nom || ""} » de ${heros} (${v.periode?.libelle || "entre les séances"}) : ${String(j.issue_nom || "").toLowerCase()}.`
      + (v.mot_joueur ? ` Le joueur avait écrit : « ${v.mot_joueur} ».` : "");
    bouton.disabled = true;
    try {
      let lien;
      if (genre === "rumeur") {
        const r = await api.post("/api/rumeurs", { texte: appris, source: `${prenom(heros)}, entre les séances`, etat: "a-placer", verite: "", notes: origine });
        lien = `#/auberge/rumeur/${encodeURIComponent(r.id)}`;
      } else if (genre === "contrat") {
        const c = await api.post("/api/contrats", { nom: `${v.activite?.nom || "Activité"} : la suite pour ${prenom(heros)}`, genre: "contrat", etat: "brouillon",
          affiche: "", recompense: "", contact: "", notes: [origine, appris].filter(Boolean).join("\n") });
        lien = `#/auberge/contrat/${encodeURIComponent(c.id)}`;
      } else {
        const idee = await noterIdee(`#activites ${origine}${appris ? ` ${appris}` : ""}`);
        lien = `#/idees?idee=${encodeURIComponent(idee.id)}`;
      }
      this.memoriser();
      s.suites.push({ genre, lien });
      toast(`${SUITES[genre]} en brouillon, dans l'atelier seulement.`);
      this.dessiner();
    } catch (err) {
      bouton.disabled = false;
      toast(`Rien de créé : ${err.message}`, "erreur");
    }
  }
}
