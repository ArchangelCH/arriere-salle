// « La compagnie », dans Séances › Jouer : une ligne par héros présent, son état du moment (Santé, Psy, Santé payée
// faute de Psy, cartons, une note du MJ) et son sac (or, équipement, objets personnels), avec les repos du kit. L'état
// vit à part des fiches (routes /api/etats-heros) et s'écrit héros par héros, seulement les champs touchés : le Mac et
// l'iPad notent en même temps. Le sac s'écrit dans la fiche par sa route étroite, chaque geste avec la valeur d'avant ;
// refusé parce qu'un autre écran l'a changé, il se rejoue sur la fiche relue. Pendant un combat en cours, la Santé,
// la Psy et les cartons d'un héros qui s'y bat se suivent dans le combat. Rien de ce bloc ne part vers la TV.

import { accorderEnfants } from "../commun/accorder.js";
import { api, differer, echapper as e, toast } from "../api.js";
import { ecouterSacs } from "../ecran-tv/canal-table.js";
import {
  REPOS, avecGeste, champsChanges, corpsDuSac, de6, douteuse, etatComplet, ligneDe, ligneRepos, listeDuSac, poserEtat, quantiteDe, repos, resumeSac,
  reunirChamps,
  valeursAvant,
} from "../aventuriers/etat.js";
import { cartonApres, htmlCartons } from "../combats/barre.js";
import { accepterMort } from "../combats/repere-mort.js";
import { garderLaLecture } from "../commun/dialogue.js";
import { htmlJeton } from "../combats/combat.js";
import { AVANTAGES, CARACS_CARTON, jetonApres, prenom, saisiePsy, saisieSante, santeDonRestante, santePosee, seuilMort } from "../combats/suivi.js";
import { annoncerEtatJeu } from "../commun/etat-jeu.js";
import { exemple, htmlRetour, noterRetour } from "../combats/retour-saisie.js";
import { noterAuJournal } from "./journal.js";
import { Reessai, injoignable, raison } from "../commun/reessai.js";

const signe = (n) => String(n).replace("-", "−");
const enListe = (noms) => (noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}` : noms[0] || "");
const couleurSure = (c) => (/^#[0-9a-fA-F]{3,8}$/.test(c || "") ? c : "#8a6a34");
const DU_COMBAT = ["sante", "psy", "santeDon", "cartons", "avantage"];
const PLACEHOLDERS_OBJETS = ["un souvenir", "un outil de l'ancien métier", "un objet qu'on ne montre pas"];

export class Compagnie {
  // seance() : la séance affichée ; tablee() : la tablée de la campagne (les deux tenues par l'onglet Séances).
  constructor({ seance, tablee }) {
    this.seance = seance;
    this.tablee = tablee;
    this.fiches = []; // les fiches telles que le serveur les a rendues
    this.etats = {}; // l'état de chaque héros, tel que le serveur l'a rendu
    this.auCombat = {};
    this.attente = new Map(); // héros → champs d'état pas encore partis
    this.enVol = new Map(); // héros → champs partis, sans réponse encore
    this.gestes = []; // les gestes sur le sac, dans l'ordre ; le premier est peut-être en route
    this.envois = 0;
    this.chaine = Promise.resolve();
    this.enEchec = false;
    this.sauver = differer(() => this.enregistrer(), 300);
    // Serveur injoignable : ce qui n'est pas parti repart seul (3 s, 10 s, puis toutes les 30 s).
    this.reessai = new Reessai(() => this.enregistrer(), () => this.afficherEtat());
    this.charge = false;
    this.erreur = "";
    this.zone = null;
    this.sacsOuverts = new Set();
    this.detruit = false;
    this.dialogue = null;
    this.ouvertures = 0; // chaque ouverture des repos : une relecture en retard ne touche pas la suivante
    this.ecoute = new AbortController();
    window.addEventListener("focus", () => this.relire(), { signal: this.ecoute.signal });
    // Le tableau du MJ (ou le combat) vient d'écrire sur cette page : la compagnie se relit.
    window.addEventListener("etat-jeu-change", (ev) => ev.detail?.source !== this && this.relire(), { signal: this.ecoute.signal });
    // Un joueur a changé un sac depuis son téléphone (ou le MJ a annulé son geste dans la boîte) : la compagnie se relit.
    this.finSacs = ecouterSacs(() => this.relire());
  }

  async charger() {
    try {
      const [fiches, etats] = await Promise.all([api.get("/api/aventuriers"), api.get("/api/etats-heros")]);
      if (this.detruit) return;
      this.fiches = fiches;
      this.recu(etats);
      this.charge = true;
      this.erreur = "";
    } catch (err) {
      this.erreur = raison(err);
      // Serveur qui redémarre : un nouvel essai dans quelques secondes (« Réessayer » le fait tout de suite).
      clearTimeout(this.minuterieCharge);
      if (injoignable(err)) this.minuterieCharge = setTimeout(() => !this.detruit && !this.charge && this.charger(), 5000);
    }
    this.afficher();
  }

  detruire() {
    this.detruit = true;
    clearTimeout(this.minuterieCharge);
    this.ecoute.abort();
    this.finSacs?.();
    this.dialogue?.remove();
    return this.vider();
  }

  vider() {
    if (this.attente.size || this.gestes.length) this.sauver.maintenant();
    return this.chaine;
  }

  // Reste-t-il quelque chose qui n'est pas enregistré ? (l'onglet ne se ferme pas sans prévenir)
  aEnregistrer() {
    return this.attente.size > 0 || this.gestes.length > 0 || this.envois > 0 || this.sauver.enAttente();
  }

  recu(srv) {
    if (srv?.etats) this.etats = srv.etats;
    if (srv?.au_combat) this.auCombat = srv.au_combat;
  }

  // La réponse du serveur à l'écriture de l'état d'un héros.
  etatRecu(id, r) {
    this.etats = { ...this.etats };
    if (r.etat && Object.keys(r.etat).length) this.etats[id] = r.etat;
    else delete this.etats[id];
    this.auCombat = r.au_combat || this.auCombat;
  }

  // Les héros présents de la tablée (toute la tablée active si personne n'est coché), dans l'ordre de la tablée.
  heros() {
    const presents = new Set(this.seance()?.presents || []);
    return (this.tablee() || []).filter((j) => j.actif !== false && j.aventurier && (!presents.size || presents.has(j.id)))
      .map((j) => ({ j, fiche: this.ficheVue(j.aventurier) })).filter((x) => x.fiche);
  }

  // Les héros présents qui sont à terre (coma, repère de mort), avec leur Santé : à rappeler avant de clore.
  herosATerre() {
    return this.heros().map(({ fiche }) => {
      const x = this.etatDe(fiche);
      return { nom: prenom(fiche.nom), sante: x.sante, mort: x.sante <= seuilMort(x.max) };
    }).filter((h) => h.sante <= 0);
  }

  ficheServeur(id) {
    return this.fiches.find((a) => a.id === id) || null;
  }

  // La fiche avec les gestes du sac pas encore enregistrés : ce que le MJ vient de faire se voit tout de suite.
  ficheVue(id) {
    const f = this.ficheServeur(id);
    return f && this.gestes.filter((g) => g.id === id).reduce((x, g) => avecGeste(x, g.geste), f);
  }

  // L'état du serveur, puis ce qui est en route, puis ce qui attend.
  etatDe(fiche) {
    const brut = poserEtat(poserEtat(this.etats[fiche.id], this.enVol.get(fiche.id)), this.attente.get(fiche.id));
    return etatComplet(fiche, brut);
  }

  // ---------------------------------------------------------------- affichage

  monter(zone) {
    this.zone = zone;
    if (!zone) return;
    const option = { signal: this.ecoute.signal };
    zone.addEventListener("click", (ev) => this.clic(ev), option);
    zone.addEventListener("change", (ev) => this.choix(ev), option);
    zone.addEventListener("keydown", (ev) => this.touche(ev), option);
    this.afficher();
  }

  enPlace() {
    return !this.detruit && this.zone?.isConnected;
  }

  // Le bloc se redessine par accord du DOM (accorder.js) : le champ où l'on écrit reste en place avec ce qui y est tapé,
  // les champs quittés reprennent ce qui est enregistré. Un redessin demandé pendant un autre est refait juste après.
  afficher() {
    if (!this.enPlace()) return;
    if (this.enAccord) {
      this.aRefaire = true;
      return;
    }
    // Les sacs ouverts, lus dans la page au moment même : un sac qu'on vient d'ouvrir le reste.
    for (const d of this.zone.querySelectorAll("details[data-cp-sac]")) {
      const id = d.closest("[data-cp-heros]")?.dataset.cpHeros;
      if (id && d.open) this.sacsOuverts.add(id);
      else if (id) this.sacsOuverts.delete(id);
    }
    const liste = this.heros();
    const corps = !this.charge
      ? `<p class="aide">${this.erreur ? `La compagnie ne se charge pas : ${e(this.erreur)}. <button class="lien" data-cp-action="recharger">Réessayer</button>` : "On sort les fiches…"}</p>`
      : liste.length
        ? `<div class="cp-liste">${liste.map((x) => this.htmlHeros(x)).join("")}</div>`
        : '<p class="aide">Personne à suivre : cochez les présents, ou ajoutez des aventuriers à la tablée.</p>';
    const neuf = document.createElement("section");
    neuf.innerHTML = `
      <div class="cp-tete">
        <h2>La compagnie</h2>
        <span class="etat-compagnie" aria-live="polite"></span>
        <div class="cp-repos" role="group" aria-label="Repos de la compagnie">${Object.entries(REPOS).map(([k, r]) => `
          <button type="button" data-cp-repos="${k}" title="${e(r.regle)}" ${this.charge && liste.length ? "" : "disabled"}>${e(r.nom)}</button>`).join("")}
        </div>
      </div>
      ${corps}
      ${this.charge && liste.length ? `<p class="aide">Santé : « -4 » retire, « +3 » rend, « =7 » fixe. Psy : « -2 » paie un don (ce qui manque est pris sur la Santé), « +1 » rend. Or : « +5 », « -3 », « =40 ». Tout reste d'un combat à l'autre : le combat suivant part d'ici.</p>` : ""}`;
    this.enAccord = true;
    try {
      accorderEnfants(this.zone, neuf);
      for (const el of this.zone.querySelectorAll('input[type="text"]')) {
        if (el !== document.activeElement && el.value !== el.defaultValue) el.value = el.defaultValue;
      }
    } finally {
      this.enAccord = false;
    }
    this.afficherEtat();
    if (this.aRefaire) {
      this.aRefaire = false;
      this.afficher();
    }
  }

  htmlHeros({ fiche }) {
    const x = this.etatDe(fiche);
    const combat = this.auCombat[fiche.id];
    const nom = fiche.nom || "Sans nom";
    const etat = x.sante <= seuilMort(x.max) ? "mort" : x.sante <= 0 ? "coma" : "debout";
    const libelle = { coma: "Coma", mort: "Repère de mort" }[etat] || "";
    const don = x.santeDon;
    const sante = `<p class="sante-combat"${don ? ` title="Dont ${don} payé${don > 1 ? "s" : ""} faute de Psy : ${don > 1 ? "ils ne reviennent" : "il ne revient"} qu'après une journée entière de repos."` : ""}><output>${e(signe(x.sante))}</output><span>/ ${x.max}</span>${don ? `<small>dont ${don} en dons</small>` : ""}</p>`;
    const psy = `<p class="psy-combat"><span class="libelle">Psy</span><output>${x.psy}</output><span>/ ${x.psyMax}</span></p>`;
    // Les cartons en boutons P, S, M, comme au combat ; pendant un combat, ils se changent dans le combat.
    const cartons = htmlCartons(fiche.id, nom, x.cartons, { inactif: !!combat, pourquoi: "il se change dans le combat" });
    return `
        <article class="ligne-combat ligne-heros cp-heros etat-${etat}${combat ? " au-combat" : ""}" data-cp-heros="${e(fiche.id)}">
          <div class="qui"><span class="puce-heros" style="background:${e(couleurSure(fiche.couleur))}"></span><b>${e(nom)}</b>${libelle ? `<span class="etat">${libelle}</span>` : ""}</div>
          ${sante}
          ${combat ? "" : `<input class="saisie" type="text" inputmode="text" autocomplete="off" data-cp-saisie="sante" placeholder="${exemple("sante")}" aria-label="Santé de ${e(nom)} : -4, +3 ou =7">${htmlRetour(`cp:sante:${fiche.id}`)}`}
          ${psy}
          ${combat ? `<a class="cp-suivre" href="#/combat/${e(combat.seance)}" title="« ${e(combat.combat || "Combat")} » : la Santé, la Psy et les cartons se changent dans le combat">Suivre dans le combat</a>`
            : `<input class="saisie" type="text" inputmode="text" autocomplete="off" data-cp-saisie="psy" placeholder="${exemple("psy")}" aria-label="Psy de ${e(nom)} : -2 paie un don, +1 rend, =3 fixe">${htmlRetour(`cp:psy:${fiche.id}`)}`}
          <div class="cartons-combat">${cartons}${combat ? "" : htmlJeton(fiche.id, nom, AVANTAGES[x.avantage] ? x.avantage : "")}
            <input class="cp-notes" type="text" autocomplete="off" maxlength="300" data-cp-notes value="${e(x.notes)}" placeholder="Une note : empoisonné, bras en écharpe" aria-label="Note sur ${e(nom)}">
          </div>
          ${this.htmlSac(fiche, nom)}
        </article>`;
  }

  htmlSac(fiche, nom) {
    const equipement = listeDuSac(fiche, "equipement");
    const objets = listeDuSac(fiche, "objets");
    const armes = (fiche.armes || []).filter((w) => (w?.nom || "").trim()).map((w) => `${w.nom.trim()}${w.degats ? ` (${w.degats})` : ""}`);
    const protection = fiche.protection?.nom ? `${fiche.protection.nom}${fiche.protection.indice ? `, armure ${fiche.protection.indice}` : ""}` : "";
    // Une ligne d'équipement : son nom, et sa quantité entre « − » et « + » (« Potion de soins ×3 » dans la fiche). Une
    // ligne qui ne se compte pas (« Planche 2 x 4 ») reste un texte entier, sans compteur.
    const lignes = equipement.map((t, i) => {
      if (!t.trim()) return "";
      const compte = !douteuse(t);
      const [objet, n] = compte ? quantiteDe(t) : [t, 1];
      return `
              <li><input type="text" autocomplete="off" maxlength="300" data-cp-ligne="equipement" data-rang="${i}" data-entier="${e(t)}" value="${e(objet)}" title="${e(t)}" aria-label="Équipement de ${e(nom)}">${compte ? `<span class="cp-quantite" role="group" aria-label="Quantité de ${e(objet)}"><button type="button" data-cp-quantite="-1" data-rang="${i}" aria-label="Un ${e(objet)} de moins" title="${n > 1 ? "Un de moins" : "Le dernier : la ligne s'en va"}">−</button><output aria-label="${n} dans le sac">${n}</output><button type="button" data-cp-quantite="1" data-rang="${i}" aria-label="Un ${e(objet)} de plus" title="Un de plus">+</button></span>` : ""}<button type="button" class="retirer" data-cp-retirer="equipement" data-rang="${i}" aria-label="Retirer ${e(t)}">×</button></li>`;
    }).join("");
    return `
          <details class="cp-sac" data-cp-sac ${this.sacsOuverts.has(fiche.id) ? "open" : ""}>
            <summary>Le sac <span>${e(resumeSac(fiche))}</span></summary>
            <div class="cp-sac-corps">
              <p class="cp-or"><span class="libelle">Or</span><output>${typeof fiche.or === "number" ? e(Math.round(fiche.or)) : "0"}</output><span>pièces</span>
                <input class="saisie" type="text" inputmode="text" autocomplete="off" data-cp-or placeholder="ex. +5" aria-label="Or de ${e(nom)} : +5, -3 ou =40"></p>
              <div class="cp-listes">
                <div>
                  <h3>Équipement</h3>
                  <ul class="cp-lignes">${lignes}</ul>
                  <input type="text" autocomplete="off" maxlength="300" data-cp-ajouter="equipement" placeholder="Ajouter, puis Entrée" aria-label="Ajouter à l'équipement de ${e(nom)}">
                </div>
                <div>
                  <h3>Objets personnels</h3>
                  <ul class="cp-lignes">${objets.map((t, i) => `
                    <li><input type="text" autocomplete="off" maxlength="300" data-cp-ligne="objets" data-rang="${i}" value="${e(t)}" placeholder="${e(PLACEHOLDERS_OBJETS[i] || "")}" aria-label="Objet personnel ${i + 1} de ${e(nom)}"></li>`).join("")}
                  </ul>
                </div>
              </div>
              <p class="cp-armes">${armes.length ? `<span class="lbl">Armes</span> ${e(armes.join(", "))}. ` : ""}${protection ? `<span class="lbl">Protection</span> ${e(protection)}${fiche.bouclier ? ", bouclier" : ""}. ` : ""}<a href="#/aventuriers/${e(fiche.id)}?etape=9">Changer dans sa fiche</a></p>
            </div>
          </details>`;
  }

  afficherEtat() {
    const zone = this.enPlace() ? this.zone.querySelector(".etat-compagnie") : null;
    if (!zone) return;
    zone.textContent = this.enEchec ? this.reessai.libelle("erreur", true) || "Non enregistré" : "";
  }

  // ---------------------------------------------------------------- gestes

  ficheDuChamp(el) {
    const id = el.closest("[data-cp-heros]")?.dataset.cpHeros;
    return id ? this.ficheVue(id) : null;
  }

  touche(ev) {
    if (ev.key !== "Enter" || ev.isComposing) return;
    const el = ev.target;
    if (el.dataset.cpSaisie !== undefined || el.dataset.cpOr !== undefined || el.dataset.cpAjouter !== undefined || el.dataset.cpNotes !== undefined
      || el.dataset.cpLigne !== undefined) {
      ev.preventDefault();
      this.choix({ target: el });
    }
  }

  choix(ev) {
    const el = ev.target;
    const d = el.dataset;
    const fiche = this.ficheDuChamp(el);
    if (!fiche || this.detruit) return;
    if (d.cpSaisie !== undefined) return el.value.trim() ? this.saisir(el, fiche) : undefined;
    if (d.cpNotes !== undefined) {
      const notes = el.value.replace(/\s+/g, " ").trim();
      if (notes === this.etatDe(fiche).notes) return;
      return this.noter(fiche.id, { notes });
    }
    if (d.cpOr !== undefined) {
      if (!el.value.trim()) return;
      return this.geste(fiche, { genre: "or", texte: el.value }, el);
    }
    if (d.cpAjouter !== undefined) {
      if (!el.value.trim()) return;
      return this.geste(fiche, { genre: "ajouter", liste: d.cpAjouter, texte: el.value }, el);
    }
    if (d.cpLigne !== undefined) {
      if (el.value === el.defaultValue) return;
      // Dans l'équipement, la case ne montre que le nom : la ligne garde sa quantité, sauf si le MJ en tape une (« Corde x3 »).
      const avant = d.entier ?? el.defaultValue;
      let texte = el.value;
      if (d.entier !== undefined && texte.trim() && !douteuse(avant) && !douteuse(texte) && quantiteDe(texte)[1] === 1 && !/[×xX]\s*1\s*$/.test(texte)) {
        texte = ligneDe(quantiteDe(texte)[0], quantiteDe(avant)[1]);
      }
      return this.geste(fiche, { genre: "changer", liste: d.cpLigne, rang: +d.rang, avant, texte });
    }
  }

  // La Santé et la Psy : les mêmes saisies et les mêmes rappels du kit qu'au combat.
  async saisir(champ, fiche) {
    const x = this.etatDe(fiche);
    const qui = prenom(fiche.nom);
    if (this.auCombat[fiche.id]) return toast(`${qui} se bat : sa Santé et sa Psy se changent dans le combat.`, "erreur");
    let apres;
    if (champ.dataset.cpSaisie === "psy") {
      const lu = saisiePsy(champ.value, x, fiche);
      if (!lu) return toast("Saisie illisible : « -2 » ou « 2 » paie un don, « +1 » rend, « =3 » fixe.", "erreur");
      const { sante, preleve, ...psy } = lu;
      apres = { ...x, ...psy };
      if (preleve) {
        if (!(await this.accepteMort(qui, x, sante, " en payant ce don", champ))) return;
        toast(`${x.psy ? `${qui} paie ${x.psy} Psy et ${preleve} Santé` : `${qui} n'a plus de Psy : ${preleve} Santé en moins`}. Cette Santé ne revient qu'après une journée entière de repos.`);
        apres = this.poserSante(qui, apres, sante);
      }
    } else {
      const lu = saisieSante(champ.value, x);
      if (!lu) return toast("Saisie illisible : « -4 » ou « 4 » retire, « +3 » rend, « =7 » fixe.", "erreur");
      if (!(await this.accepteMort(qui, x, lu.sante, "", champ))) return;
      if (lu.retenu) {
        const don = santeDonRestante(x);
        toast(`${qui} ${lu.sante > x.sante ? "remonte" : "reste"} à ${signe(lu.sante)} sur ${x.max} : ${don > 1 ? `les ${don} points de Santé payés faute de Psy ne reviennent` : "le point de Santé payé faute de Psy ne revient"} qu'après une journée entière de repos (« Journée de repos », ou « =${x.max} »).`);
      }
      apres = this.poserSante(qui, x, lu.sante);
    }
    champ.value = "";
    if (champ.dataset.cpSaisie === "psy") noterRetour(`cp:psy:${fiche.id}`, x.psy, apres.psy, "Psy");
    else noterRetour(`cp:sante:${fiche.id}`, x.sante, apres.sante);
    this.noter(fiche.id, champsChanges(x, apres));
  }

  // Le repère de mort du kit : le MJ confirme avant de le noter (faux s'il renonce).
  accepteMort(qui, x, valeur, pourquoi = "", champ = null) {
    return accepterMort(qui, x, valeur, pourquoi, champ);
  }

  poserSante(qui, x, valeur) {
    const { heros, coma, reveil } = santePosee(x, valeur);
    if (coma) toast(`${qui} tombe dans le coma.`);
    if (reveil) toast(`${qui} se réveille, avec un carton jaune en Physique.`);
    return heros;
  }

  // Des champs de l'état à enregistrer : affichés tout de suite, envoyés un peu après (plusieurs gestes partent ensemble).
  noter(id, champs) {
    if (Object.keys(champs).length) {
      this.attente.set(id, reunirChamps(this.attente.get(id), champs));
      this.sauver();
    }
    this.afficher();
  }

  // Un geste sur le sac : affiché tout de suite s'il s'applique (sa case d'or ou d'ajout se vide), sinon expliqué et le
  // texte reste à corriger.
  geste(fiche, geste, champ = null) {
    const corps = corpsDuSac(fiche, geste);
    if (corps.erreur) toast(corps.erreur, "erreur");
    else {
      if (champ) champ.value = "";
      if (Object.keys(corps).length) {
        this.gestes.push({ id: fiche.id, geste });
        this.sauver();
      }
    }
    this.afficher();
  }

  async clic(ev) {
    const b = ev.target.closest("button");
    if (!b || this.detruit) return;
    if (b.dataset.cpAction === "recharger") {
      this.erreur = "";
      this.afficher();
      return this.charger();
    }
    if (b.dataset.cpRepos) return this.ouvrirRepos(b.dataset.cpRepos);
    if (b.dataset.action === "carton" && CARACS_CARTON.some(([k]) => k === b.dataset.carac)) {
      const fiche = this.ficheDuChamp(b);
      if (!fiche) return;
      if (this.auCombat[fiche.id]) return toast(`${prenom(fiche.nom)} se bat : ses cartons se changent dans le combat.`, "erreur");
      const x = this.etatDe(fiche);
      const v = cartonApres(x.cartons[b.dataset.carac]);
      const apres = { ...x, cartons: { ...x.cartons } };
      if (v) apres.cartons[b.dataset.carac] = v;
      else delete apres.cartons[b.dataset.carac];
      return this.noter(fiche.id, champsChanges(x, apres));
    }
    if (b.dataset.action === "jeton") {
      const fiche = this.ficheDuChamp(b);
      if (!fiche) return;
      if (this.auCombat[fiche.id]) return toast(`${prenom(fiche.nom)} se bat : son jeton se change dans le combat.`, "erreur");
      const x = this.etatDe(fiche);
      return this.noter(fiche.id, champsChanges(x, { ...x, avantage: jetonApres(x.avantage, b.dataset.jeton) }));
    }
    if (b.dataset.cpQuantite) {
      const fiche = this.ficheDuChamp(b);
      const avant = fiche && listeDuSac(fiche, "equipement")[+b.dataset.rang];
      if (avant !== undefined && avant !== false) this.geste(fiche, { genre: "quantite", liste: "equipement", rang: +b.dataset.rang, avant, de: +b.dataset.cpQuantite });
      return;
    }
    if (b.dataset.cpRetirer) {
      const fiche = this.ficheDuChamp(b);
      const avant = listeDuSac(fiche, b.dataset.cpRetirer)[+b.dataset.rang];
      if (fiche && avant !== undefined) this.geste(fiche, { genre: "retirer", liste: b.dataset.cpRetirer, rang: +b.dataset.rang, avant });
    }
  }

  // ---------------------------------------------------------------- les repos

  // La confirmation montre, héros par héros, ce qui va changer, sur l'état relu du serveur : un autre écran a pu noter
  // une Santé, commencer ou finir un combat depuis le chargement. Le 1D6 de Psy est tiré à l'ouverture et ne bouge plus.
  async ouvrirRepos(genre) {
    const r = REPOS[genre];
    if (!r || !this.heros().length) return;
    const n = ++this.ouvertures;
    const d = this.creerDialogue();
    d.dataset.genre = genre;
    d.querySelector("h2").textContent = r.nom;
    d.querySelector(".regle").textContent = r.regle;
    d.querySelector(".mauvaises").hidden = genre === "neuf";
    d.querySelector("[data-mauvaises]").checked = false;
    const relu = d.querySelector(".relu");
    relu.hidden = true;
    this.des = new Map();
    this.remplirRepos();
    garderLaLecture(d);
    d.showModal();
    d.querySelector('[data-r="appliquer"]').focus();
    const lu = await this.relireEtats();
    if (n !== this.ouvertures || !d.open) return;
    relu.hidden = lu;
    relu.textContent = lu ? "" : "Le serveur ne répond pas : l'état montré ici est celui lu plus tôt, peut-être dépassé.";
    this.remplirRepos();
  }

  creerDialogue() {
    if (this.dialogue) return this.dialogue;
    const d = document.createElement("dialog");
    d.className = "dialogue repos-compagnie";
    d.setAttribute("aria-labelledby", "repos-compagnie-titre");
    d.innerHTML = `
      <form method="dialog">
        <p class="kicker">La compagnie</p>
        <h2 id="repos-compagnie-titre"></h2>
        <p class="aide regle"></p>
        <label class="case mauvaises"><input type="checkbox" data-mauvaises> Dans de mauvaises conditions : ni Santé ni cartons rendus, la Psy seulement</label>
        <ul class="repos-liste"></ul>
        <p class="relu" role="status" hidden></p>
        <div class="actions">
          <button type="button" data-r="annuler">Annuler</button>
          <button type="button" class="principal" data-r="appliquer">Appliquer</button>
        </div>
      </form>`;
    document.body.append(d);
    d.querySelector("[data-mauvaises]").addEventListener("change", () => this.remplirRepos());
    d.querySelector('[data-r="annuler"]').addEventListener("click", () => d.close());
    d.querySelector('[data-r="appliquer"]').addEventListener("click", () => this.appliquerRepos());
    this.dialogue = d;
    return d;
  }

  // Le 1D6 de Psy d'un héros pour ce repos : tiré une fois, gardé jusqu'à l'enregistrement.
  deDe(des, id) {
    if (!des.has(id)) des.set(id, de6());
    return des.get(id);
  }

  // Ce que le repos ferait, maintenant : un héros qui se bat encore n'est pas compté.
  calculRepos() {
    const d = this.dialogue;
    const genre = d.dataset.genre;
    const mauvaises = genre !== "neuf" && d.querySelector("[data-mauvaises]").checked;
    return this.heros().map(({ fiche }) => {
      if (this.auCombat[fiche.id]) return { fiche, combat: true };
      return { fiche, ...repos(genre, this.etatDe(fiche), { de: this.deDe(this.des, fiche.id), mauvaises }) };
    });
  }

  remplirRepos() {
    this.dialogue.querySelector(".repos-liste").innerHTML = this.calculRepos().map(({ fiche, combat, changements }) => `
      <li${combat ? ' class="au-combat"' : ""}><span class="puce-heros" style="background:${e(couleurSure(fiche.couleur))}"></span><b>${e(prenom(fiche.nom))}</b>
        <span>${combat ? "se bat encore : rien ne change ici, tout se suit dans le combat." : e(changements.length ? changements.join(", ") : "rien ne change")}</span></li>`).join("");
  }

  // Appliquer : après ce qui attend encore d'être enregistré, le repos se rejoue sur l'état relu du serveur, héros par
  // héros. Le journal ne note que ce que le serveur a enregistré.
  appliquerRepos() {
    const d = this.dialogue;
    const genre = d.dataset.genre;
    const mauvaises = genre !== "neuf" && d.querySelector("[data-mauvaises]").checked;
    const des = this.des;
    const seance = this.seance();
    d.close();
    this.sauver.vider();
    this.envois++;
    this.chaine = this.chaine.then(() => this.reposer(genre, { mauvaises, des, seance }))
      .catch((err) => toast(`Repos non enregistré : ${err.message}`, "erreur"))
      .finally(() => this.envois--);
    return this.chaine;
  }

  async reposer(genre, { mauvaises, des, seance }) {
    const nom = REPOS[genre].nom;
    // Ce qui n'est pas encore parti (serveur coupé un moment) part d'abord : le repos se pose par-dessus.
    if (this.attente.size) await this.ecrire();
    if ((this.attente.size && this.enEchec) || !(await this.relireEtats())) {
      return toast(`Le serveur ne répond pas : « ${nom} » n'a rien changé. Réessayez dans un instant.`, "erreur");
    }
    const faits = [];
    const auCombat = [];
    const rates = [];
    let coupure = null;
    let pourquoi = "";
    for (const { fiche } of this.heros()) {
      const r = coupure ? { erreur: coupure } : await this.reposerUn(fiche, genre, { mauvaises, de: this.deDe(des, fiche.id) });
      if (r.fait) faits.push({ nom: fiche.nom, changements: r.fait.changements });
      else if (r.combat) auCombat.push(prenom(fiche.nom));
      else {
        rates.push(prenom(fiche.nom));
        pourquoi = pourquoi || raison(r.erreur);
        // Le serveur ne répond plus : les suivants ne sont pas tentés.
        if (injoignable(r.erreur)) coupure = r.erreur;
      }
    }
    this.afficher();
    if (faits.length) {
      toast(`${nom} pour ${enListe(faits.map((f) => prenom(f.nom)))}${seance ? ", noté au journal" : ""}.`);
      if (seance) noterAuJournal(seance.id, ligneRepos(genre, faits, { mauvaises })).catch((err) => toast(`Repos non noté au journal : ${err.message}`, "erreur"));
    }
    if (auCombat.length && !faits.length && !rates.length) toast("Tout le monde se bat encore : le repos attendra la fin du combat.", "erreur");
    else if (auCombat.length) toast(`${enListe(auCombat)} ${auCombat.length > 1 ? "se battent" : "se bat"} encore : rien ne change ici, tout se suit dans le combat.`);
    if (rates.length) toast(`« ${nom} » : rien d'enregistré pour ${enListe(rates)} (${pourquoi}) ; le journal n'en dit rien.`, "erreur");
  }

  // Un héros : le repos calculé sur son état enregistré part avec les valeurs d'avant des champs qu'il change. Refusé
  // parce qu'un autre écran vient de les changer (ou de le faire entrer dans un combat), l'état est relu et le repos
  // recalculé (trois essais au plus). Rend { fait } (ce que le repos a changé), { combat } ou { erreur }.
  async reposerUn(fiche, genre, { mauvaises, de }) {
    const id = fiche.id;
    for (let essai = 0; ; essai++) {
      if (this.auCombat[id]) return { combat: true };
      const enregistre = this.etats[id];
      const x = etatComplet(fiche, enregistre);
      const fait = repos(genre, x, { de, mauvaises });
      const champs = champsChanges(x, fait.apres);
      if (!Object.keys(champs).length) return { fait };
      this.enVol.set(id, champs);
      this.afficher();
      try {
        this.etatRecu(id, await api.patch(`/api/etats-heros/${encodeURIComponent(id)}`, { ...champs, avant: valeursAvant(enregistre, champs) }));
        return { fait };
      } catch (err) {
        if (err.status !== 409 || essai >= 2 || !(await this.relireEtats())) return { erreur: err };
      } finally {
        this.enVol.delete(id);
      }
    }
  }

  // ---------------------------------------------------------------- enregistrement

  enregistrer() {
    this.envois++;
    this.chaine = this.chaine.then(() => this.ecrire()).catch((err) => toast(`Compagnie non enregistrée : ${err.message}`, "erreur"))
      .finally(() => this.envois--);
    return this.chaine;
  }

  // Les états d'abord (une requête par héros, seulement ses champs touchés), puis les gestes du sac dans l'ordre.
  async ecrire() {
    const erreurs = [];
    const tente = this.attente.size > 0 || this.gestes.length > 0;
    const lot = [...this.attente];
    this.attente.clear();
    for (const [id, champs] of lot) {
      this.enVol.set(id, champs);
      try {
        this.etatRecu(id, await api.patch(`/api/etats-heros/${encodeURIComponent(id)}`, champs));
        annoncerEtatJeu({}, { source: this });
      } catch (err) {
        erreurs.push(err);
        const garde = injoignable(err) ? champs
          // Il est entré dans un combat sur un autre écran : la note part quand même, le reste se suit dans le combat.
          : err.status === 409 ? Object.fromEntries(Object.entries(champs).filter(([k]) => !DU_COMBAT.includes(k))) : {};
        if (Object.keys(garde).length) this.attente.set(id, reunirChamps(garde, this.attente.get(id)));
        if (!injoignable(err)) {
          toast(err.status === 409 ? `${prenom(this.ficheServeur(id)?.nom)} : ${err.message}` : `État non enregistré : ${err.message}`, "erreur");
          if (err.status === 409) await this.relire(true);
        } else this.reessai.signaler(err, "Compagnie non enregistrée");
      } finally {
        this.enVol.delete(id);
      }
      this.afficher();
    }
    while (this.gestes.length) {
      const { id, geste } = this.gestes[0];
      const err = await this.envoyerGeste(id, geste);
      if (err && injoignable(err)) {
        erreurs.push(err);
        this.reessai.signaler(err, "Sac non enregistré");
        break;
      }
      if (err) erreurs.push(err);
      this.gestes.shift();
      this.afficher();
    }
    // Noté pendant l'envoi : part au prochain passage.
    if (this.attente.size && !erreurs.some(injoignable)) this.sauver();
    if (tente) this.reessai.bilan(erreurs);
    this.enEchec = erreurs.some(injoignable);
    this.afficherEtat();
  }

  // Un geste du sac, avec la valeur d'avant. Refusé (409) : la fiche est relue et le geste rejoué sur elle (trois fois
  // au plus). Rend l'erreur, ou null.
  async envoyerGeste(id, geste) {
    for (let essai = 0; essai < 3; essai++) {
      const fiche = this.ficheServeur(id);
      if (!fiche) return null;
      const corps = corpsDuSac(fiche, geste);
      if (corps.erreur) {
        toast(corps.erreur, "erreur");
        return null;
      }
      if (!Object.keys(corps).length) return null;
      try {
        this.poserFiche(await api.patch(`/api/aventuriers/${encodeURIComponent(id)}/sac`, corps));
        return null;
      } catch (err) {
        if (err.status !== 409 || essai === 2) {
          if (!injoignable(err)) toast(`Sac non enregistré : ${err.message}`, "erreur");
          return err;
        }
        try {
          this.poserFiche(await api.get(`/api/aventuriers/${encodeURIComponent(id)}`));
        } catch (lecture) {
          return lecture;
        }
      }
    }
    return null;
  }

  poserFiche(fiche) {
    if (!fiche?.id) return;
    const i = this.fiches.findIndex((a) => a.id === fiche.id);
    if (i >= 0) this.fiches[i] = fiche;
    else this.fiches.push(fiche);
  }

  // L'état des héros et qui se bat, relus du serveur (les fiches restent) : ce qui attend ou part encore reste par-dessus
  // (etatDe). Faux si le serveur ne répond pas.
  async relireEtats() {
    let srv;
    try {
      srv = await api.get("/api/etats-heros");
    } catch {
      return false;
    }
    const avant = JSON.stringify([this.etats, this.auCombat]);
    this.recu(srv);
    if (JSON.stringify([this.etats, this.auCombat]) !== avant) this.afficher();
    return true;
  }

  // De retour sur l'onglet : un autre écran a pu changer un état, un sac, ou commencer un combat. Le champ où l'on
  // écrit garde ce qui est tapé.
  async relire(force = false) {
    if (this.detruit || !this.charge || (!force && (this.aEnregistrer() || this.enVol.size))) return;
    let fiches;
    let etats;
    try {
      [fiches, etats] = await Promise.all([api.get("/api/aventuriers"), api.get("/api/etats-heros")]);
    } catch {
      return;
    }
    if (this.detruit || (!force && this.aEnregistrer())) return;
    const avant = JSON.stringify([this.fiches, this.etats, this.auCombat]);
    this.fiches = fiches;
    this.recu(etats);
    if (JSON.stringify([this.fiches, this.etats, this.auCombat]) !== avant) this.afficher();
  }
}
