// Balance des combats : le groupe sur un plateau, les adversaires sur l'autre, et des milliers de combats simulés
// pour savoir de quel côté ça penche. Les rencontres s'enregistrent et se retrouvent dans la préparation des séances.
// Le niveau de la balance est le sien (celui de la campagne à l'ouverture) : l'essayer à un autre niveau ne touche ni la
// campagne ni les fiches. Seul ce qui a changé s'enregistre ; une rencontre modifiée entre-temps sur un autre écran est
// relue et fusionnée au lieu d'être écrasée.

import { api, copie, differer, echapper as e, fusionner, toast } from "../api.js";
import { annoncerCorbeille, lienVersions } from "../corbeille/corbeille.js";
import { seanceDuJournal } from "../seances/journal.js";
import { Reessai } from "../commun/reessai.js";
import { afficherTemoin, htmlTemoin } from "../commun/temoin-enregistrement.js";
import { CREATURES, GENS, NOMS_RANGS, RANGS, TITRES_BESTIAIRE, depuisPnj } from "./bestiaire.js";
import { GROUPE_DE_DEPART, POSTURES, PRETIRES, PROFILS_TYPES, auNiveau, chargerPretires, depuisAventurier, nouvelAventurier } from "./groupe.js";
import { estInvite } from "../mj/role.js";
import { composer } from "./composer.js";
import { VERDICTS, etudier, severite, verdict } from "./simulation.js";
import { SITUATIONS } from "./suivi.js";
import { marqueSort } from "../seances/liens-scene.js";
const CATALOGUE = [...RANGS, ...CREATURES, ...GENS];
const NIVEAUX_BALANCE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
// Les valeurs de combat qui changent avec le niveau : les retoucher recale l'aventurier sur le niveau affiché.
const SELON_NIVEAU = ["att", "sante", "defense"];
const pc = (x) => `${Math.round(x * 100)} %`;
const virgule = (x, d = 1) => x.toFixed(d).replace(".", ",");

function ajuster(zone) {
  zone.style.height = "auto";
  zone.style.height = `${zone.scrollHeight + 2}px`;
}

// Remplace le contenu d'un objet sans changer d'objet : les autres références restent bonnes.
function remplacer(cible, source) {
  for (const k of Object.keys(cible)) if (!(k in source)) delete cible[k];
  Object.assign(cible, source);
}

// Les compositions du bestiaire, pour la taille du groupe.
function composition(niveau, n) {
  const r = (cle, k) => ({ ...RANGS.find((x) => x.cle === cle), n: Math.max(1, k) });
  const moitie = Math.max(1, Math.floor(n / 2));
  if (niveau === "facile") return [r("sbire", n)];
  if (niveau === "normale") return [r("soldat", n)];
  if (niveau === "difficile") return [r("elite", moitie)];
  return [r("boss", 1), r("sbire", moitie)];
}

// Le nom d'un adversaire dans une phrase : « ajouter 1 chef mercenaire ». Un PNJ du carnet ou un adversaire
// renommé garde son nom tel quel.
function nomDansPhrase(a) {
  const catalogue = CATALOGUE.find((x) => x.cle === a.cle);
  return catalogue && catalogue.nom === a.nom ? `${a.nom.charAt(0).toLowerCase()}${a.nom.slice(1)}` : a.nom;
}

export function resumeAdversaires(adv) {
  return (adv || []).filter((a) => a.n > 0).map((a) => `${a.n} × ${a.nom}`).join(", ");
}

export class Balance {
  constructor(racine, { id }) {
    this.racine = racine;
    this.idDemande = id || null;
    this.sauverRencontre = differer(() => this.enregistrerRencontres(), 600);
    this.sauverGroupe = differer(() => this.enregistrerGroupe(), 800);
    // La pesée part 300 ms après le dernier geste ; dès le geste, l'ancien verdict s'estompe (« Pesée… ») : on ne lit
    // pas un mot périmé en cliquant vite sur « + » ou « − ».
    const peser = differer(() => this.lancer(), 300);
    this.simuler = Object.assign((...args) => {
      this.racine.querySelector(".fleau-central")?.classList.add("en-pesee");
      return peser(...args);
    }, peser);
    this.resultat = null;
    this.variantes = [];
    this.jeton = 0;
    this.bases = new Map(); // dernière version connue du serveur, par rencontre
    this.aEnvoyer = new Set();
    this.groupeModifie = false;
    this.fileEnvois = Promise.resolve();
    this.envois = 0;
    // Serveur injoignable : les rencontres et le groupe repartent seuls (3 s, 10 s, puis toutes les 30 s).
    this.reessaiRencontres = new Reessai(() => this.enregistrerRencontres(), () => this.etat());
    this.reessaiGroupe = new Reessai(() => this.enregistrerGroupe(), () => this.etat());
    this.retires = [];
    this.detruit = false;
    this.ecoute = new AbortController();
  }

  async demarrer() {
    const [rencontres, campagne, pnj, aventuriers, seances] = await Promise.all([
      ...["/api/rencontres", "/api/campagne", "/api/pnj", "/api/aventuriers"].map((u) => api.get(u)), api.get("/api/seances").catch(() => []),
      chargerPretires().catch(() => []),
    ]);
    if (this.detruit) return;
    // La séance où se joue un combat lancé d'ici (celle du journal : du jour, sinon la plus proche).
    this.seance = seanceDuJournal(seances);
    this.rencontres = rencontres.sort((a, b) => (a.cree || "").localeCompare(b.cree || ""));
    for (const r of this.rencontres) this.bases.set(r.id, copie(r));
    this.campagne = campagne;
    this.pnj = pnj;
    this.aventuriers = aventuriers.filter((a) => a.tablee !== false).sort((a, b) => (a.cree || "").localeCompare(b.cree || ""));
    this.niveau = Math.min(10, Math.max(1, +campagne.niveau || 1));
    // Un aventurier mis à la corbeille ou sorti de la tablée quitte le groupe ; les autres sont relus dans leur fiche.
    const sauve = campagne.balance?.groupe || [];
    const restent = sauve.filter((p) => !p.aventurier || this.aventuriers.some((a) => a.id === p.aventurier));
    this.retires = sauve.filter((p) => !restent.includes(p)).map((p) => p.nom);
    this.groupe = restent.length ? restent.map((p) => this.relire(p)) : this.groupeDeDepart();
    this.r = this.rencontres.find((x) => x.id === this.idDemande) || this.rencontres[0] || null;
    this.racine.innerHTML = `<section class="balance-page"><aside class="liste-rencontres"></aside><div class="balance-corps"></div></section>`;
    this.lier();
    this.afficherListe();
    this.afficherCorps();
  }

  // La page quittée : plus de pesée, plus d'écouteurs, et seulement ce qui attendait encore d'être enregistré.
  detruire() {
    this.detruit = true;
    this.jeton++;
    this.simuler.annuler();
    this.ecoute.abort();
    return this.vider();
  }

  // Onglet fermé ou page quittée : ce qui attend part tout de suite (y compris un envoi raté plus tôt). Rien n'est
  // écrit s'il n'y a rien à écrire.
  vider() {
    if (this.aEnvoyer.size) this.sauverRencontre.maintenant();
    else this.sauverRencontre.annuler();
    if (this.groupeModifie) this.sauverGroupe.maintenant();
    else this.sauverGroupe.annuler();
    return this.fileEnvois;
  }

  // Reste-t-il quelque chose qui n'est pas enregistré ? (l'onglet ne se ferme pas sans prévenir)
  aEnregistrer() {
    return this.aEnvoyer.size > 0 || this.groupeModifie || this.sauverRencontre.enAttente() || this.sauverGroupe.enAttente() || this.envois > 0;
  }

  // Un aventurier de la tablée se relit dans sa fiche à chaque ouverture : un niveau gagné ou une arme changée comptent aussitôt.
  // Seule la posture choisie ici est gardée, pour essayer une autre façon de se battre.
  relire(p) {
    const a = p.aventurier && this.aventuriers.find((x) => x.id === p.aventurier);
    if (!a) return p;
    return { ...depuisAventurier(a), id: p.id, posture: p.posture || a.posture || "focus" };
  }

  // Les aventuriers de la tablée ; sinon ses prétirés ; sinon le groupe de départ que la campagne a choisi parmi les siens.
  groupeDeDepart() {
    if (this.aventuriers.length) return this.aventuriers.map((a) => nouvelAventurier(depuisAventurier(a)));
    const tablee = (this.campagne.tablee || []).filter((j) => j.actif !== false);
    const depuisTablee = tablee.map((j) => PRETIRES.find((p) => j.personnage && p.nom.split(",")[0].startsWith(j.personnage.split(",")[0]))).filter(Boolean);
    const modeles = depuisTablee.length ? depuisTablee : GROUPE_DE_DEPART.map((c) => PRETIRES.find((p) => p.cle === c)).filter(Boolean);
    // Sans les prétirés (un MJ invité, ou le kit injoignable) : trois profils types.
    return (modeles.length ? modeles : PROFILS_TYPES.slice(0, 3)).map((m) => nouvelAventurier(m));
  }

  // Le groupe tel qu'il se bat au niveau de la balance.
  groupeAuNiveau() {
    return this.groupe.map((p) => auNiveau(p, this.niveau));
  }

  // La tablée entière est-elle dans le groupe, et rien qu'elle ?
  tableeAuComplet() {
    const ids = this.groupe.filter((p) => p.aventurier).map((p) => p.aventurier);
    return ids.length === this.groupe.length && ids.length === this.aventuriers.length && this.aventuriers.every((a) => ids.includes(a.id));
  }

  lier() {
    const r = this.racine.querySelector(".balance-page");
    const option = { signal: this.ecoute.signal };
    r.addEventListener("click", (ev) => this.clic(ev), option);
    r.addEventListener("input", (ev) => this.saisie(ev, false), option);
    r.addEventListener("change", (ev) => this.saisie(ev, true), option);
  }

  afficherListe() {
    const zone = this.racine.querySelector(".liste-rencontres");
    if (this.detruit || !zone) return;
    zone.innerHTML = `
      <header>
        <p class="kicker">Balance des combats</p>
        <h1>Les rencontres</h1>
        <button class="principal" data-action="nouvelle">Nouvelle rencontre</button>
        ${this.seance?.combat ? `<a class="combat-en-cours" href="#/combat/${e(this.seance.id)}">Combat en cours : ${e(this.seance.combat.nom || "Rencontre")}, tour ${e(this.seance.combat.tour)}</a>` : ""}
      </header>
      <ul class="rencontres">
        ${this.rencontres.map((x) => `
          <li><a href="#/combats/${e(x.id)}" data-rencontre="${e(x.id)}" aria-current="${x.id === this.r?.id}">
            <span class="nom">${e(x.nom || "Rencontre")}</span>
            <span class="meta">${e(resumeAdversaires(x.adversaires) || "aucun adversaire")}</span>
            ${x.verdict ? `<span class="pastille-verdict verdict-${e(x.verdict.cle)}">${e(VERDICTS[x.verdict.cle]?.nom || "")}</span>` : ""}
          </a></li>`).join("") || '<li class="vide">Aucune rencontre pour l\'instant.</li>'}
      </ul>`;
  }

  afficherCorps() {
    const zone = this.racine.querySelector(".balance-corps");
    if (this.detruit || !zone) return;
    // Les variantes encore en calcul concernaient la rencontre d'avant.
    this.jeton++;
    if (!this.r) {
      zone.innerHTML = `
        <div class="balance-vide">
          <p class="kicker">Balance des combats</p>
          <h1>Combien d'ennemis pour ce groupe ?</h1>
          <p class="chapo">Posez le groupe sur un plateau, les adversaires sur l'autre : l'atelier joue la rencontre deux mille fois selon les règles du kit et vous dit de quel côté elle penche.</p>
          <button class="principal" data-action="nouvelle">Nouvelle rencontre</button>
        </div>`;
      return;
    }
    const r = this.r;
    zone.innerHTML = `
      <header class="tete-rencontre">
        <div class="titre">
          <p class="kicker">Rencontre</p>
          <div class="titre-avec-temoin"><input class="nom-rencontre" type="text" value="${e(r.nom || "")}" data-champ="nom" aria-label="Nom de la rencontre" placeholder="Les chasseurs de primes du gué">${htmlTemoin(this.aEnvoyer.has(r.id) ? "modifie" : "ok")}</div>
        </div>
        <div class="actions">
          <button data-action="lancer" title="${this.seance ? `Dans ${e([`Séance ${this.seance.numero ?? ""}`.trim(), this.seance.nom].filter(Boolean).join(" · "))} : ordre du tour, Santé, cartons et rappels du kit` : "Il faut d'abord une séance ouverte, dans l'onglet Séances"}">Lancer le combat</button>
          <button class="lien-danger" data-action="supprimer">Mettre à la corbeille</button>
          <a class="lien-versions" href="${lienVersions("rencontres", r.id, `#/combats/${r.id}`)}">Versions</a>
        </div>
      </header>
      <div class="plateaux">
        <section class="plateau-groupe">${this.htmlGroupe()}</section>
        <section class="fleau-central">
          <div class="dessin-balance">${this.htmlBalance()}</div>
          <div class="verdict-zone" aria-live="polite">${this.htmlVerdict()}</div>
          <div class="reglages">
            <label class="champ">Qui commence<select data-champ="avant">${SITUATIONS.map(([v, n]) => `<option value="${v}" ${+r.avant === v ? "selected" : ""}>${e(n)}</option>`).join("")}</select></label>
            <label class="champ">Postures<select data-champ="style">
              <option value="fiches" ${r.style !== "offensif" ? "selected" : ""}>Celles des fiches</option>
              <option value="offensif" ${r.style === "offensif" ? "selected" : ""}>Tout le monde en offensive</option>
            </select></label>
            <label class="case"><input type="checkbox" data-champ="moral" ${r.moral === false ? "" : "checked"}> Les sbires fuient quand la moitié d'entre eux tombe</label>
          </div>
        </section>
        <section class="plateau-adversaires">${this.htmlAdversaires()}</section>
      </div>
      <label class="champ notes-rencontre">Notes<textarea rows="2" data-champ="notes" placeholder="Terrain, buts des adversaires, ce qui les fait fuir.">${e(r.notes || "")}</textarea></label>`;
    zone.querySelectorAll("textarea").forEach(ajuster);
    this.etat();
    this.simuler();
  }

  // La rencontre et le groupe s'enregistrent à la frappe : l'état se lit à droite du titre, comme partout.
  etat() {
    const el = this.detruit ? null : this.racine.querySelector(".tete-rencontre .temoin-enregistrement");
    if (!el) return;
    const serie = [this.reessaiRencontres, this.reessaiGroupe].find((x) => x.actif);
    if (serie) return afficherTemoin(el, "erreur", { reessai: serie });
    if (this.aEnvoyer.size || this.groupeModifie || this.envois) return afficherTemoin(el, "modifie");
    afficherTemoin(el, "ok", { modifie: this.r?.modifie });
  }

  htmlGroupe() {
    const n = this.niveau;
    const niveauCampagne = +this.campagne.niveau || 1;
    return `
      <h2>Le groupe</h2>
      <div class="niveau-groupe">
        <label class="champ">Niveau<select data-groupe-niveau>${NIVEAUX_BALANCE.map((x) => `<option value="${x}" ${x === n ? "selected" : ""}>${x}</option>`).join("")}</select></label>
        <p class="aide">${n === niveauCampagne ? `Celui de la campagne.` : `La campagne est au niveau ${niveauCampagne}.`} Changer de niveau recalcule Santé, attaque et défense de chacun, sans toucher à la campagne ni aux fiches.</p>
      </div>
      <table class="table-combat">
        <thead><tr><th>Aventurier</th><th title="Attaque, en %">Att.</th><th>Dég.</th><th title="Armure (et bouclier en défensive)">Arm.</th><th>Santé</th><th title="Défense : esquive ou parade, en %">Déf.</th><th>Posture</th><th><span class="visuel-cache">Retirer</span></th></tr></thead>
        <tbody>${this.groupe.map((p, i) => {
          const v = auNiveau(p, n);
          const note = [p.note, (p.base || 1) !== n ? `compté au niveau ${n}` : ""].filter(Boolean).join(", ");
          return `
          <tr>
            <td><input type="text" value="${e(p.nom)}" data-pj="${i}" data-c="nom" aria-label="Nom"></td>
            <td><input type="number" value="${e(v.att)}" data-pj="${i}" data-c="att" aria-label="Attaque"></td>
            <td><input type="text" value="${e(v.degats)}" data-pj="${i}" data-c="degats" aria-label="Dégâts"></td>
            <td><input type="number" value="${e(v.armure)}" data-pj="${i}" data-c="armure" aria-label="Armure" title="${v.bouclier ? `+${v.bouclier} de bouclier en défensive` : ""}"></td>
            <td><input type="number" value="${e(v.sante)}" data-pj="${i}" data-c="sante" aria-label="Santé"></td>
            <td><input type="number" value="${e(v.defense)}" data-pj="${i}" data-c="defense" aria-label="Défense"></td>
            <td><select data-pj="${i}" data-c="posture" aria-label="Posture">${POSTURES.map(([x, nom]) => `<option value="${x}" ${p.posture === x ? "selected" : ""}>${nom}</option>`).join("")}</select></td>
            <td><button class="retirer" data-action="pj-retirer" data-i="${i}" aria-label="Retirer ${e(p.nom)}">×</button></td>
          </tr>
          ${note ? `<tr class="note-ligne"><td colspan="8">${e(note)}</td></tr>` : ""}`;
        }).join("")}
        </tbody>
      </table>
      <select class="ajout" data-ajout-pj aria-label="Ajouter un aventurier">
        <option value="">Ajouter un aventurier…</option>
        ${this.aventuriers.length ? `<optgroup label="La tablée">${this.aventuriers.map((a) => `<option value="aventurier:${e(a.id)}">${e(a.nom || "Sans nom")}</option>`).join("")}</optgroup>` : ""}
        ${PRETIRES.length ? `<optgroup label="Prétirés du kit">${PRETIRES.map((p) => `<option value="${p.cle}">${e(p.nom)}</option>`).join("")}</optgroup>` : ""}
        <optgroup label="Profils types">${PROFILS_TYPES.map((p) => `<option value="${p.cle}">${e(p.nom)}</option>`).join("")}</optgroup>
      </select>
      ${this.aventuriers.length && !this.tableeAuComplet() ? `<div class="actions"><button data-action="prendre-tablee">Prendre la tablée (${this.aventuriers.length})</button></div>` : ""}
      ${this.retires.length ? `<p class="aide">Plus à la tablée, donc retiré${this.retires.length > 1 ? "s" : ""} du groupe : ${e(this.retires.join(", "))}.</p>` : ""}
      <p class="aide">Attaque : Physique et compétence d'arme. Défense : Physique et Esquive, Bouclier ou arme. ${this.aventuriers.length ? "Les aventuriers de la tablée sont relus dans leur fiche à chaque ouverture." : "Remplacez les prétirés par les personnages de vos joueurs : créez-les dans l'onglet Aventuriers."}</p>`;
  }

  htmlAdversaires() {
    const adv = this.r.adversaires || [];
    // Un PNJ mort ou disparu le dit dans la liste (seances/liens-scene.js) : on ne l'ajoute pas sans le savoir.
    const pnj = this.pnj.map((p) => { const a = depuisPnj(p); return a && { ...a, nom: a.nom + marqueSort(p) }; }).filter(Boolean);
    const groupe = (titre, liste) => `<optgroup label="${e(titre)}">${liste.map((a) => `<option value="${e(a.cle)}">${e(a.nom)}${a.rang && NOMS_RANGS[a.rang] ? ` (${NOMS_RANGS[a.rang]})` : ""}</option>`).join("")}</optgroup>`;
    const santeBoss = this.niveau <= 1 ? "Un boss a 7 Santé par aventurier au niveau 1, 8 ensuite" : "Un boss a 8 Santé par aventurier (7 au niveau 1)";
    return `
      <h2>Les adversaires</h2>
      <div class="compositions">
        <span>Composer :</span>
        ${["facile", "normale", "difficile", "epique"].map((k) => `<button data-action="composer" data-niveau="${k}" title="Barème du bestiaire">${VERDICTS[k].nom}</button>`).join("")}
      </div>
      <table class="table-combat adversaires">
        <thead><tr><th title="Nombre">Nb</th><th>Adversaire</th><th>Att.</th><th>Dég.</th><th>Arm.</th><th title="${santeBoss}">Santé</th><th title="Défenses par tour, et leur valeur en %">Déf.</th><th><span class="visuel-cache">Retirer</span></th></tr></thead>
        <tbody>${adv.map((a, i) => `
          <tr>
            <td class="nombre"><button data-action="moins" data-i="${i}" aria-label="Un de moins">−</button><output>${a.n}</output><button data-action="plus" data-i="${i}" aria-label="Un de plus">+</button></td>
            <td><input type="text" value="${e(a.nom)}" data-adv="${i}" data-c="nom" aria-label="Nom">${a.rang && NOMS_RANGS[a.rang] ? `<span class="rang rang-${e(a.rang)}">${e(NOMS_RANGS[a.rang])}</span>` : ""}</td>
            <td><input type="number" value="${e(a.att)}" data-adv="${i}" data-c="att" aria-label="Attaque">${(a.attaques || 1) > 1 ? `<span class="multi">×${a.attaques}</span>` : ""}</td>
            <td><input type="text" value="${e(a.degats)}" data-adv="${i}" data-c="degats" aria-label="Dégâts"></td>
            <td><input type="number" value="${e(a.armure)}" data-adv="${i}" data-c="armure" aria-label="Armure"></td>
            <td><input type="text" value="${e(a.sante)}" data-adv="${i}" data-c="sante" aria-label="Santé"></td>
            <td class="defense"><input type="number" min="0" max="3" value="${e(a.nbDef || 0)}" data-adv="${i}" data-c="nbDef" aria-label="Défenses par tour"><span>×</span><input type="number" value="${e(a.defense || 0)}" data-adv="${i}" data-c="defense" aria-label="Valeur de défense"></td>
            <td><button class="retirer" data-action="adv-retirer" data-i="${i}" aria-label="Retirer ${e(a.nom)}">×</button></td>
          </tr>
          ${a.capacites ? `<tr class="note-ligne"><td colspan="8">${e(a.capacites)}</td></tr>` : ""}`).join("") || '<tr><td colspan="8" class="vide">Ajoutez des adversaires, ou composez selon le barème.</td></tr>'}
        </tbody>
      </table>
      <select class="ajout" data-ajout-adv aria-label="Ajouter un adversaire">
        <option value="">Ajouter un adversaire…</option>
        ${groupe("Rangs du bestiaire", RANGS)}
        ${groupe(TITRES_BESTIAIRE.creatures, CREATURES)}
        ${groupe(TITRES_BESTIAIRE.gens, GENS)}
        ${pnj.length ? groupe("PNJ du carnet", pnj) : ""}
      </select>`;
  }

  htmlBalance() {
    const cle = this.resultat ? this.resultat.cle : null;
    const angle = cle ? VERDICTS[cle].angle : 0;
    const dy = +(118 * Math.sin((angle * Math.PI) / 180)).toFixed(1);
    const nbPj = Math.min(8, this.groupe.length);
    const nbAdv = Math.min(10, (this.r?.adversaires || []).reduce((t, a) => t + (a.n || 0), 0));
    const poids = (n, x, forme) => Array.from({ length: n }, (_, i) => {
      const col = i % 5;
      const rangee = Math.floor(i / 5);
      const cx = x - 22 + col * 11;
      const cy = 118 - rangee * 10;
      return forme === "rond" ? `<circle cx="${cx}" cy="${cy}" r="4.4"/>` : `<rect x="${cx - 3.8}" y="${cy - 3.8}" width="7.6" height="7.6" transform="rotate(45 ${cx} ${cy})"/>`;
    }).join("");
    return `
      <svg viewBox="0 0 320 210" class="balance-svg${cle ? ` penche-${cle}` : ""}" role="img" aria-label="${cle ? `La balance penche : ${VERDICTS[cle].nom}` : "Balance en attente"}">
        <path class="pied" d="M160 52 V186"/>
        <path class="socle" d="M122 198 Q160 174 198 198 Z"/>
        <g class="fleau" style="transform: rotate(${angle}deg)">
          <path class="bras" d="M42 52 H278"/>
          <path class="aiguille" d="M160 52 V22"/>
          <circle class="pivot" cx="160" cy="52" r="6"/>
        </g>
        <g class="cote" style="transform: translateY(${-dy}px)">
          <path class="chaines" d="M42 52 L18 110 M42 52 L66 110"/>
          <path class="coupe" d="M8 110 Q42 138 76 110 Z"/>
          <g class="pions pj">${poids(nbPj, 42, "rond")}</g>
        </g>
        <g class="cote" style="transform: translateY(${dy}px)">
          <path class="chaines" d="M278 52 L254 110 M278 52 L302 110"/>
          <path class="coupe" d="M244 110 Q278 138 312 110 Z"/>
          <g class="pions adv">${poids(nbAdv, 278, "losange")}</g>
        </g>
      </svg>`;
  }

  htmlVerdict() {
    const res = this.resultat;
    if (!res) return '<p class="attente">Pesée en cours…</p>';
    if (res.vide) return '<p class="attente">Il faut au moins un aventurier et un adversaire.</p>';
    const v = VERDICTS[res.cle];
    const barres = res.repartition.map((x, i) => `<span style="flex:${Math.max(x, 0.001)}" class="part-${i}" title="${["Personne", "Un aventurier", "Deux aventuriers", "Trois ou plus"][i]} au tapis : ${pc(x)}"></span>`).join("");
    const variantes = this.variantes;
    return `
      <div class="verdict verdict-${res.cle}">
        <p class="mot">${e(v.nom)}</p>
        <p class="attendre">${e(v.attendre)}</p>
        <dl class="chiffres">
          <div><dt>Victoire</dt><dd>${pc(res.victoire)}</dd></div>
          <div><dt>Tours</dt><dd>${virgule(res.tours)}</dd></div>
          <div><dt>Au tapis</dt><dd>${virgule(res.auTapis)}</dd></div>
          <div><dt>Un mort</dt><dd>${res.mort > 0 && res.mort < 0.005 ? "moins de 1 %" : pc(res.mort)}</dd></div>
        </dl>
        <div class="repartition" aria-hidden="true">${barres}</div>
        <p class="legende-repartition"><span class="part-0"></span>personne au tapis <span class="part-1"></span>un <span class="part-2"></span>deux <span class="part-3"></span>trois et plus</p>
        ${res.indecis >= 0.005 ? `<p class="indecis">${pc(res.indecis)} des combats durent encore après 40 tours : ni gagnés, ni perdus.</p>` : ""}
      </div>
      ${variantes.length ? `<div class="variantes">${variantes.map((x, i) => `
        <button data-action="variante" data-i="${i}"><span>${x.sens === "facile" ? "Plus facile" : "Plus dur"}</span>${e(x.texte)} <b class="verdict-${x.cle}">${e(VERDICTS[x.cle].nom)}</b></button>`).join("")}</div>` : ""}
      <p class="aide">Sur ${res.n.toLocaleString("fr-CH")} combats simulés selon les règles du kit, au niveau ${this.niveau}. Dons, soins, dés d'aventure et terrain ne sont pas comptés : ils avantagent presque toujours le groupe.</p>`;
  }

  // « Composer : Difficile » doit donner un combat Difficile pour CE groupe (composer.js).
  composerPour(niveau) {
    return composer(niveau, this.groupeAuNiveau(), this.options(), composition(niveau, this.groupe.length || 3));
  }

  options() {
    return { avant: +this.r.avant || 0, style: this.r.style || "fiches", moral: this.r.moral !== false, niveau: this.niveau };
  }

  // Pesée : le verdict tout de suite, puis les variantes (un adversaire de plus ou de moins) pour proposer d'ajuster.
  lancer() {
    if (this.detruit || !this.r) return;
    const jeton = ++this.jeton;
    const adv = (this.r.adversaires || []).filter((a) => a.n > 0);
    if (!this.groupe.length || !adv.length) {
      this.resultat = { vide: true };
      this.variantes = [];
      return this.majPesee();
    }
    const groupe = this.groupeAuNiveau();
    const res = etudier(groupe, adv, this.options(), 2000);
    res.cle = verdict(res);
    this.resultat = res;
    this.variantes = [];
    this.majPesee();
    this.noterVerdict(res);
    setTimeout(() => this.chercherVariantes(jeton, res, groupe), 30);
  }

  // Le verdict gardé dans la rencontre (la séance et sa fiche l'affichent). Chaque pesée tire d'autres dés : on ne le
  // réécrit que si la difficulté, le groupe ou le niveau change, ou si la rencontre part de toute façon au serveur.
  noterVerdict(res) {
    const r = this.r;
    const avant = r.verdict;
    const categorie = !avant || avant.cle !== res.cle;
    if (!categorie && avant.nbPj === this.groupe.length && avant.niveau === this.niveau && !this.aEnvoyer.has(r.id)) return;
    r.verdict = {
      cle: res.cle, victoire: res.victoire, indecis: res.indecis, auTapis: res.auTapis, mort: res.mort, tours: res.tours,
      nbPj: this.groupe.length, niveau: this.niveau, quand: new Date().toISOString(),
    };
    this.marquerRencontre(r);
    if (categorie) this.afficherListe();
  }

  chercherVariantes(jeton, res, groupe) {
    if (jeton !== this.jeton || this.detruit || !this.r) return;
    const base = severite(res);
    const essais = [];
    (this.r.adversaires || []).forEach((a, i) => {
      if (a.n > 0) essais.push({ i, delta: -1 });
      essais.push({ i, delta: +1 });
    });
    const trouves = [];
    for (const t of essais) {
      const adv = this.r.adversaires.map((a, k) => ({ ...a, n: k === t.i ? a.n + t.delta : a.n })).filter((a) => a.n > 0);
      if (!adv.length) continue;
      const r = etudier(groupe, adv, this.options(), 700);
      trouves.push({ ...t, cle: verdict(r), s: severite(r) });
    }
    if (jeton !== this.jeton || this.detruit) return;
    const plusFacile = trouves.filter((x) => x.s < base && x.cle !== res.cle).sort((a, b) => b.s - a.s)[0];
    const plusDur = trouves.filter((x) => x.s > base && x.cle !== res.cle).sort((a, b) => a.s - b.s)[0];
    const texte = (x) => `${x.delta > 0 ? "ajouter" : "retirer"} 1 ${nomDansPhrase(this.r.adversaires[x.i])}`;
    this.variantes = [plusFacile && { ...plusFacile, sens: "facile" }, plusDur && { ...plusDur, sens: "dur" }].filter(Boolean).map((x) => ({ ...x, texte: texte(x) }));
    this.majPesee();
  }

  majPesee() {
    if (this.detruit) return;
    const dessin = this.racine.querySelector(".dessin-balance");
    const zone = this.racine.querySelector(".verdict-zone");
    if (!dessin || !zone) return;
    if (!this.simuler.enAttente()) dessin.closest(".fleau-central")?.classList.remove("en-pesee");
    // On redessine sans recréer le fléau, pour que la balance bascule en douceur.
    const neuf = document.createElement("div");
    neuf.innerHTML = this.htmlBalance();
    const svg = dessin.querySelector("svg");
    if (svg) {
      const n = neuf.querySelector("svg");
      svg.setAttribute("class", n.getAttribute("class"));
      svg.setAttribute("aria-label", n.getAttribute("aria-label"));
      svg.querySelector(".fleau").style.transform = n.querySelector(".fleau").style.transform;
      const cotes = svg.querySelectorAll(".cote");
      n.querySelectorAll(".cote").forEach((c, i) => {
        cotes[i].style.transform = c.style.transform;
        cotes[i].querySelector(".pions").innerHTML = c.querySelector(".pions").innerHTML;
      });
    } else dessin.innerHTML = neuf.innerHTML;
    zone.innerHTML = this.htmlVerdict();
  }

  saisie(ev, change) {
    if (this.detruit) return;
    const el = ev.target;
    const d = el.dataset;
    const discret = el.tagName === "SELECT" || el.type === "checkbox";
    if (el.tagName === "TEXTAREA" && !change) ajuster(el);
    if (discret !== change) return;
    if (d.ajoutPj !== undefined && el.value) {
      const av = el.value.startsWith("aventurier:") && this.aventuriers.find((a) => `aventurier:${a.id}` === el.value);
      const m = av ? depuisAventurier(av) : [...PRETIRES, ...PROFILS_TYPES].find((p) => p.cle === el.value);
      if (m) this.groupe.push(nouvelAventurier(m));
      return this.majGroupe();
    }
    if (d.ajoutAdv !== undefined && el.value) {
      const m = CATALOGUE.find((a) => a.cle === el.value) || this.pnj.map((p) => depuisPnj(p)).find((a) => a && a.cle === el.value);
      if (m && this.r) {
        const deja = this.r.adversaires.find((a) => a.cle === m.cle);
        if (deja) deja.n++;
        else this.r.adversaires.push({ ...m, n: 1 });
      }
      return this.majAdversaires();
    }
    if (d.groupeNiveau !== undefined) {
      // Le niveau de la balance seulement : le groupe garde ses valeurs de base, la campagne n'est pas touchée.
      this.niveau = Math.min(10, Math.max(1, +el.value || 1));
      const zone = this.racine.querySelector(".plateau-groupe");
      if (zone) zone.innerHTML = this.htmlGroupe();
      const adv = this.racine.querySelector(".plateau-adversaires");
      if (adv && this.r) adv.innerHTML = this.htmlAdversaires();
      return this.simuler();
    }
    if (d.pj !== undefined) {
      const p = this.groupe[+d.pj];
      if (!p) return;
      if (SELON_NIVEAU.includes(d.c) && (p.base || 1) !== this.niveau) {
        // Retoucher une valeur vue à un autre niveau que le sien : l'aventurier se recale sur le niveau affiché.
        Object.assign(p, auNiveau(p, this.niveau), { base: this.niveau });
        // La ligne de note perd son « compté au niveau… » sans redessiner le tableau (la saisie continue).
        const note = this.racine.querySelectorAll(".plateau-groupe tbody tr:not(.note-ligne)")[+d.pj]?.nextElementSibling;
        if (note?.classList.contains("note-ligne")) {
          note.firstElementChild.textContent = p.note || "";
          note.hidden = !p.note;
        }
      }
      p[d.c] = el.type === "number" ? +el.value : el.value;
      this.marquerGroupe();
      return this.simuler();
    }
    if (d.adv !== undefined && this.r) {
      const a = this.r.adversaires[+d.adv];
      if (!a) return;
      a[d.c] = el.type === "number" ? +el.value : el.value;
      this.marquerRencontre();
      return this.simuler();
    }
    if (d.champ && this.r) {
      this.r[d.champ] = el.type === "checkbox" ? el.checked : d.champ === "avant" ? +el.value : el.value;
      this.marquerRencontre();
      if (d.champ === "nom") this.afficherListe();
      if (["avant", "style", "moral"].includes(d.champ)) this.simuler();
    }
  }

  majGroupe() {
    const zone = this.racine.querySelector(".plateau-groupe");
    if (zone) zone.innerHTML = this.htmlGroupe();
    this.marquerGroupe();
    this.simuler();
  }

  majAdversaires() {
    const zone = this.racine.querySelector(".plateau-adversaires");
    if (zone && this.r) zone.innerHTML = this.htmlAdversaires();
    this.marquerRencontre();
    this.simuler();
  }

  // ---------------------------------------------------------------- enregistrements

  enFile(travail) {
    this.envois++;
    this.fileEnvois = this.fileEnvois.then(travail).catch((err) => toast(`Enregistrement impossible : ${err.message}`, "erreur"))
      .finally(() => {
        this.envois--;
        this.etat();
      });
    return this.fileEnvois;
  }

  marquerRencontre(r = this.r) {
    if (!r || this.detruit) return;
    this.aEnvoyer.add(r.id);
    this.etat();
    this.sauverRencontre();
  }

  marquerGroupe() {
    if (this.detruit) return;
    this.groupeModifie = true;
    this.etat();
    this.sauverGroupe();
  }

  enregistrerRencontres() {
    const ids = [...this.aEnvoyer];
    this.aEnvoyer.clear();
    return this.enFile(async () => {
      const erreurs = [];
      for (const id of ids) {
        const err = await this.envoyerRencontre(id);
        if (err) erreurs.push(err);
      }
      if (ids.length) this.reessaiRencontres.bilan(erreurs);
    });
  }

  // Une rencontre part avec la version sur laquelle elle a été modifiée. Refusée (409) parce qu'un autre écran l'a
  // enregistrée entre-temps : on relit celle du serveur, on y reporte ce que cet écran a changé, et on renvoie. Rend
  // l'erreur quand elle n'est pas partie.
  async envoyerRencontre(id) {
    const r = this.rencontres.find((x) => x.id === id);
    if (!r) return;
    const instantane = copie(r);
    let envoye = instantane;
    let base = this.bases.get(id) || instantane;
    for (let essai = 0; essai < 3; essai++) {
      try {
        const srv = await api.put(`/api/rencontres/${id}`, { ...envoye, version_base: base.modifie });
        this.bases.set(id, copie(srv));
        const avant = JSON.stringify(r);
        // Ce qui a été saisi pendant l'envoi reste ; le reste est la version du serveur.
        remplacer(r, fusionner(instantane, copie(r), srv));
        if (essai && r === this.r && JSON.stringify(r) !== avant && !this.detruit) {
          toast("Rencontre modifiée aussi sur un autre écran : les deux versions sont réunies.");
          this.afficherListe();
          this.afficherCorps();
        }
        return;
      } catch (err) {
        let echec = err;
        let serveur = null;
        if (err.status === 409 && essai < 2) {
          try {
            serveur = await api.get(`/api/rencontres/${id}`);
          } catch (err2) {
            echec = err2;
          }
        }
        if (!serveur) {
          if (echec.status === 404) return this.rencontrePerdue(id);
          // Elle repartira au prochain essai ou enregistrement, ou en quittant la page.
          this.aEnvoyer.add(id);
          this.reessaiRencontres.signaler(echec, "Rencontre non enregistrée");
          return echec;
        }
        envoye = fusionner(base, envoye, serveur);
        base = serveur;
      }
    }
  }

  rencontrePerdue(id) {
    this.rencontres = this.rencontres.filter((x) => x.id !== id);
    this.bases.delete(id);
    this.aEnvoyer.delete(id);
    toast("Cette rencontre a été mise à la corbeille depuis un autre écran.", "erreur");
    if (this.detruit) return;
    if (this.r?.id === id) {
      this.r = this.rencontres[0] || null;
      history.replaceState(null, "", this.r ? `#/combats/${this.r.id}` : "#/combats");
      this.resultat = null;
      this.variantes = [];
      this.afficherCorps();
    }
    this.afficherListe();
  }

  // Le groupe se garde dans la campagne (balance.groupe), seul champ que cette page y écrit : sur un refus, on relit la
  // campagne et on y repose le groupe.
  enregistrerGroupe() {
    if (!this.groupeModifie) return this.fileEnvois;
    this.groupeModifie = false;
    // La campagne est au MJ principal : chez un MJ invité, le groupe reste celui de la page (PUT /api/campagne lui est fermé).
    if (estInvite()) return this.fileEnvois;
    const groupe = copie(this.groupe);
    return this.enFile(async () => {
      let c = this.campagne;
      for (let essai = 0; essai < 3; essai++) {
        try {
          if (essai) c = await api.get("/api/campagne");
          this.campagne = await api.put("/api/campagne", { ...c, balance: { ...(c.balance || {}), groupe }, version_base: c.modifie });
          this.reessaiGroupe.reussite();
          return;
        } catch (err) {
          if (err.status !== 409 || essai === 2) {
            // Le groupe repartira au prochain essai ou changement, ou en quittant la page.
            this.groupeModifie = true;
            this.reessaiGroupe.echec(err);
            this.reessaiGroupe.signaler(err, "Groupe non enregistré");
            return;
          }
        }
      }
    });
  }

  async clic(ev) {
    if (this.detruit) return;
    const lien = ev.target.closest("a[data-rencontre]");
    if (lien) {
      ev.preventDefault();
      this.sauverRencontre.vider();
      this.r = this.rencontres.find((x) => x.id === lien.dataset.rencontre) || null;
      history.replaceState(null, "", this.r ? `#/combats/${this.r.id}` : "#/combats");
      this.resultat = null;
      this.variantes = [];
      this.afficherListe();
      return this.afficherCorps();
    }
    const b = ev.target.closest("button");
    if (!b) return;
    const a = b.dataset.action;
    try {
      if (a === "nouvelle") {
        const r = await api.post("/api/rencontres", {
          nom: "Nouvelle rencontre", adversaires: composition("normale", this.groupe.length || 3), avant: 2, style: "fiches", moral: true, notes: "",
        });
        this.rencontres.push(r);
        this.bases.set(r.id, copie(r));
        if (this.detruit) return;
        this.r = r;
        history.replaceState(null, "", `#/combats/${r.id}`);
        this.resultat = null;
        this.afficherListe();
        this.afficherCorps();
        this.racine.querySelector(".nom-rencontre")?.select();
        return;
      }
      if (a === "pj-retirer") {
        this.groupe.splice(+b.dataset.i, 1);
        return this.majGroupe();
      }
      if (a === "prendre-tablee") {
        this.groupe = this.aventuriers.map((x) => nouvelAventurier(depuisAventurier(x)));
        this.retires = [];
        return this.majGroupe();
      }
      if (!this.r) return;
      if (a === "lancer") {
        if (!this.seance) return toast("Aucune séance ouverte : créez-la dans l'onglet Séances.", "erreur");
        location.hash = `#/combat/${encodeURIComponent(this.seance.id)}?rencontre=${encodeURIComponent(this.r.id)}`;
        return;
      }
      if (a === "adv-retirer") {
        this.r.adversaires.splice(+b.dataset.i, 1);
        return this.majAdversaires();
      }
      if (a === "plus" || a === "moins") {
        const x = this.r.adversaires[+b.dataset.i];
        x.n = Math.max(0, x.n + (a === "plus" ? 1 : -1));
        return this.majAdversaires();
      }
      if (a === "composer") {
        this.r.adversaires = this.composerPour(b.dataset.niveau);
        return this.majAdversaires();
      }
      if (a === "variante") {
        const v = this.variantes[+b.dataset.i];
        if (!v) return;
        const x = this.r.adversaires[v.i];
        x.n = Math.max(0, x.n + v.delta);
        if (!x.n) this.r.adversaires.splice(v.i, 1);
        return this.majAdversaires();
      }
      if (a === "supprimer") {
        const r = this.r;
        // Sans confirmation : ce qui partait encore pour elle part d'abord (elle reviendra entière), rien n'arrive après
        // la corbeille, et « Annuler » la remet pendant dix secondes.
        await this.vider();
        this.aEnvoyer.delete(r.id);
        await api.del(`/api/rencontres/${r.id}`);
        this.rencontres = this.rencontres.filter((x) => x.id !== r.id);
        this.bases.delete(r.id);
        annoncerCorbeille(`« ${r.nom || "Cette rencontre"} » mise à la corbeille.`, "rencontres", r.id, { retour: `#/combats/${r.id}` });
        if (this.detruit) return;
        if (this.r === r) {
          this.r = this.rencontres[0] || null;
          history.replaceState(null, "", this.r ? `#/combats/${this.r.id}` : "#/combats");
          this.resultat = null;
          this.variantes = [];
          this.afficherCorps();
        }
        this.afficherListe();
      }
    } catch (err) {
      toast(`Impossible : ${err.message}`, "erreur");
    }
  }
}
