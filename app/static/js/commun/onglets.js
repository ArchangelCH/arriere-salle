// La barre des onglets de l'atelier, en trois familles stables : Préparer, La compagnie, Jouer. Les trois mots tiennent
// la première ligne de l'en-tête, les onglets de la famille ouverte la seconde, toujours dans le même ordre et à la même
// place : la mémoire des gestes peut s'installer. La famille ouverte est celle de la page ; un clic sur un autre mot
// montre ses onglets sans quitter la page (Échap, un clic ailleurs ou la page suivante remettent celle de la page). Le
// jour d'une séance (la séance en cours, qu'on joue aujourd'hui : seance-en-cours.js), Jouer reste ouvert en plus, au
// bout de la ligne. Trop étroite, la ligne défile, l'onglet ouvert gardé en vue. Le coin des joueurs n'a pas de barre
// et ne charge pas ce module.

import { seanceDuJour, seanceEnCours } from "../seances/seance-en-cours.js";

export const FAMILLES = [
  { cle: "preparer", nom: "Préparer", onglets: ["scenarios", "cartes", "lieux", "pnj", "idees", "bible", "documents"] },
  { cle: "compagnie", nom: "La compagnie", onglets: ["aventuriers", "auberge", "boutiques", "sanctuaire"] },
  { cle: "jouer", nom: "Jouer", onglets: ["seances", "combats", "table", "regles"] },
];

const SEPARATION = "|";
const SEPARATION_COURTE = "¦";

export function familleDe(onglet) {
  return FAMILLES.find((f) => f.onglets.includes(onglet))?.cle || null;
}

// Ce que montre la seconde ligne : les onglets de la famille ouverte dans leur ordre, puis, le jour d'une séance, ceux
// de Jouer après la séparation, s'ils tiennent tous (jamais à moitié) ; à l'étroit, la séparation perd son mot.
// largeurs : { onglet: px, "|": la séparation, "¦": la séparation sans son mot } ; place : la largeur de la ligne ;
// ecart : l'espace entre deux éléments. Rend { montres: [onglets], epingle, courte, deborde }.
export function disposer(largeurs, { ouverte, soir = false, place = Infinity, ecart = 0 }) {
  const famille = FAMILLES.find((f) => f.cle === ouverte);
  const total = (liste) => liste.reduce((s, o) => s + (largeurs[o] || 0), 0) + ecart * Math.max(0, liste.length - 1);
  let elements = famille ? [...famille.onglets] : [];
  let epingle = false;
  let courte = false;
  if (soir && famille && ouverte !== "jouer") {
    const jouer = FAMILLES.find((f) => f.cle === "jouer").onglets;
    for (const sep of [SEPARATION, SEPARATION_COURTE]) {
      const avec = [...elements, sep, ...jouer];
      if (total(avec) <= place + 0.5) {
        elements = avec;
        epingle = true;
        courte = sep === SEPARATION_COURTE;
        break;
      }
    }
  }
  const montres = elements.filter((o) => o !== SEPARATION && o !== SEPARATION_COURTE);
  return { montres, epingle, courte, deborde: total(elements) > place + 0.5 };
}

// La séance du soir, selon la règle de tout l'atelier : la séance en cours, si on la joue aujourd'hui (datée du jour,
// une scène jouée aujourd'hui ou un combat en cours) ; la même que suivent le Tableau, la campagne et l'ouverture des
// séances. Sinon null. jour : aujourd'hui par défaut.
export function seanceDuSoir(seances, jour = undefined) {
  const s = seanceEnCours(Array.isArray(seances) ? seances : [], jour ? { jour } : {});
  return s && seanceDuJour(s, jour) ? s : null;
}

export class BarreOnglets {
  // lireSeances : () => Promise<séances> (l'atelier passe la route), pour savoir si une séance a lieu aujourd'hui.
  constructor(entete, { lireSeances = null } = {}) {
    this.entete = entete;
    this.nav = entete.querySelector(".onglets");
    this.liens = [...this.nav.querySelectorAll("a[data-onglet]")];
    this.boutons = [...entete.querySelectorAll(".familles [data-famille]")];
    this.choisie = null; // la famille montrée d'un clic, sans quitter la page
    this.soir = null; // la séance du jour, pas close
    this.lireSeances = lireSeances;
    this.lecture = 0;

    // Avant les onglets de Jouer épinglés le jour de la séance, ce qui dit pourquoi ils sont là.
    this.separation = document.createElement("span");
    this.separation.className = "onglets-soir";
    this.separation.textContent = "Ce soir";
    this.separation.hidden = true;
    this.liens.find((a) => a.dataset.onglet === "seances")?.before(this.separation);

    for (const b of this.boutons) {
      b.addEventListener("click", (ev) => this.choisir(b.dataset.famille, ev.detail === 0));
      b.addEventListener("keydown", (ev) => this.toucheFamille(ev));
    }
    this.nav.addEventListener("keydown", (ev) => this.toucheOnglets(ev));
    document.addEventListener("pointerdown", (ev) => {
      if (this.choisie && !this.entete.contains(ev.target)) this.fermer();
    });
    this.entete.addEventListener("focusout", (ev) => {
      const vers = ev.relatedTarget;
      if (this.choisie && vers && !this.entete.contains(vers)) this.fermer();
    });
    // La page suivante ouvre sa famille (atelier.js range la barre à chaque page).
    window.addEventListener("hashchange", () => { this.choisie = null; });

    // La place change avec la fenêtre, le bouton Musique (nom de l'ambiance), Journal, les petits liens et les polices.
    // La ligne des onglets elle-même n'est pas observée : c'est elle que l'on range.
    const observateur = new ResizeObserver(() => this.ranger());
    for (const el of [entete, entete.querySelector(".marque"), entete.querySelector(".outils-entete"), entete.querySelector(".liens-atelier")]) {
      if (el) observateur.observe(el);
    }
    document.fonts?.ready.then(() => this.ranger());

    if (this.lireSeances) {
      this.relireSeances();
      window.addEventListener("focus", () => this.relireSeances());
      // L'onglet Séances annonce ses séances quand il en enregistre une : date, clôture, nouvelle séance.
      window.addEventListener("seances-modifiees", (ev) => this.surSeances(ev.detail?.seances));
      // Un combat commencé ou fini sur cette page change la séance du soir : relue quelques secondes après le dernier geste.
      window.addEventListener("etat-jeu-change", () => {
        clearTimeout(this.relectureCombat);
        this.relectureCombat = setTimeout(() => this.relireSeances(), 3000);
      });
    }
  }

  async relireSeances() {
    const n = ++this.lecture;
    try {
      const seances = await this.lireSeances();
      if (n === this.lecture) this.surSeances(seances);
    } catch {
      // serveur muet : la barre garde ce qu'elle savait
    }
  }

  surSeances(seances) {
    if (!Array.isArray(seances)) return;
    ++this.lecture;
    const soir = seanceDuSoir(seances);
    if ((soir?.id || null) === (this.soir?.id || null) && (soir?.nom || "") === (this.soir?.nom || "")) return;
    this.soir = soir;
    this.ranger();
  }

  // La famille de la page : celle de l'onglet marqué ouvert.
  courante() {
    const actif = this.liens.find((a) => a.getAttribute("aria-current") === "page");
    return actif ? familleDe(actif.dataset.onglet) : null;
  }

  ouverte() {
    return this.choisie || this.courante() || FAMILLES[0].cle;
  }

  // Une autre famille montrée d'un clic : c'est le « menu » que ferment Échap et un clic ailleurs.
  ouvert() {
    return !!this.choisie;
  }

  // auClavier (Échap) : le focus, s'il était dans la barre, revient au mot de la famille qu'on avait montrée.
  fermer(auClavier = false) {
    if (!this.choisie) return;
    const bouton = this.boutons.find((b) => b.dataset.famille === this.choisie);
    const dedans = this.entete.contains(document.activeElement);
    this.choisie = null;
    this.ranger();
    if (auClavier && dedans) bouton?.focus();
  }

  // Montre les onglets d'une famille sans quitter la page ; la famille de la page, ou celle déjà montrée, referme.
  choisir(cle, auClavier = false) {
    this.choisie = cle === this.courante() || cle === this.choisie ? null : cle;
    this.ranger();
    if (auClavier && this.choisie) this.liens.find((a) => !a.hidden)?.focus();
  }

  // Appelé à chaque page, à chaque changement de place et de séance du jour.
  ranger() {
    const ouverte = this.ouverte();
    const courante = this.courante();
    for (const b of this.boutons) {
      const cle = b.dataset.famille;
      b.setAttribute("aria-expanded", String(cle === ouverte));
      b.classList.toggle("courante", cle === courante);
      this.marquerSoir(b, cle === "jouer" && !!this.soir);
    }
    // Toute la famille et la séparation affichées le temps de mesurer : la ligne se range ensuite.
    const jouer = FAMILLES.find((f) => f.cle === "jouer").onglets;
    const garder = new Set([...FAMILLES.find((f) => f.cle === ouverte).onglets, ...(this.soir ? jouer : [])]);
    for (const a of this.liens) a.hidden = !garder.has(a.dataset.onglet);
    this.separation.hidden = !this.soir || ouverte === "jouer";
    // La place prise dans la ligne : la boîte et ses marges.
    const prise = (el) => {
      const s = getComputedStyle(el);
      return el.getBoundingClientRect().width + (parseFloat(s.marginLeft) || 0) + (parseFloat(s.marginRight) || 0);
    };
    const largeurs = {};
    if (!this.separation.hidden) {
      this.separation.classList.remove("courte");
      largeurs[SEPARATION] = prise(this.separation);
      this.separation.classList.add("courte");
      largeurs[SEPARATION_COURTE] = prise(this.separation);
    }
    for (const a of this.liens) if (!a.hidden) largeurs[a.dataset.onglet] = prise(a);
    const ecart = parseFloat(getComputedStyle(this.nav).columnGap) || 0;
    const choix = disposer(largeurs, { ouverte, soir: !!this.soir, place: this.nav.clientWidth, ecart });
    const montres = new Set(choix.montres);
    for (const a of this.liens) a.hidden = !montres.has(a.dataset.onglet);
    this.separation.hidden = !choix.epingle;
    this.separation.classList.toggle("courte", choix.courte);
    this.separation.title = choix.epingle ? this.titreSoir() : "";
    this.nav.classList.toggle("deborde", choix.deborde);
    // Si la ligne défile encore, l'onglet ouvert reste en vue.
    const actif = this.liens.find((a) => a.getAttribute("aria-current") === "page" && !a.hidden);
    if (actif && this.nav.scrollWidth > this.nav.clientWidth) {
      const gauche = actif.offsetLeft - this.nav.offsetLeft;
      this.nav.scrollLeft = Math.max(0, gauche - (this.nav.clientWidth - actif.offsetWidth) / 2);
    } else if (!actif) this.nav.scrollLeft = 0;
  }

  titreSoir() {
    const s = this.soir;
    return s ? `Séance ${s.numero ?? ""}${s.nom ? ` · ${s.nom}` : ""} aujourd'hui : Jouer reste ouvert`.replace(/\s+·/, " ·") : "";
  }

  // « ce soir » sous le mot Jouer le jour de la séance (sans toucher au bouton quand rien ne change : la page surveille
  // ce qui s'ajoute au document).
  marquerSoir(bouton, oui) {
    const marque = bouton.querySelector(".famille-soir");
    if (oui && !marque) {
      const m = document.createElement("small");
      m.className = "famille-soir";
      m.textContent = "ce soir";
      bouton.append(m);
    } else if (!oui && marque) marque.remove();
    const titre = oui ? this.titreSoir() : "";
    if (bouton.title !== titre) bouton.title = titre;
  }

  // Flèches gauche et droite entre les trois mots, flèche bas vers les onglets montrés. Elles s'arrêtent là : l'éditeur
  // de plan, qui écoute la fenêtre, déplacerait aussi le pion choisi (et l'enregistrerait).
  toucheFamille(ev) {
    // Entrée et Espace sur un mot l'actionnent, sans plus : l'éditeur de carte finirait le tracé en cours, et la main des
    // éditeurs (Espace) empêcherait le clic.
    if ((ev.key === "Enter" || ev.key === " ") && !ev.ctrlKey && !ev.metaKey && !ev.altKey) return ev.stopPropagation();
    const i = this.boutons.indexOf(ev.currentTarget);
    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      ev.preventDefault();
      ev.stopPropagation();
      this.boutons[(i + (ev.key === "ArrowRight" ? 1 : this.boutons.length - 1)) % this.boutons.length].focus();
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.currentTarget.dataset.famille !== this.ouverte()) this.choisir(ev.currentTarget.dataset.famille);
      this.liens.find((a) => !a.hidden)?.focus();
    }
  }

  // Flèches entre les onglets montrés ; flèche haut revient au mot de leur famille.
  toucheOnglets(ev) {
    const liens = this.liens.filter((a) => !a.hidden);
    const i = liens.indexOf(document.activeElement);
    if (i < 0 || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    let cible = null;
    if (ev.key === "ArrowRight") cible = liens[(i + 1) % liens.length];
    else if (ev.key === "ArrowLeft") cible = liens[(i + liens.length - 1) % liens.length];
    else if (ev.key === "Home") cible = liens[0];
    else if (ev.key === "End") cible = liens[liens.length - 1];
    else if (ev.key === "ArrowUp") cible = this.boutons.find((b) => b.dataset.famille === familleDe(liens[i].dataset.onglet));
    if (!cible) return;
    ev.preventDefault();
    ev.stopPropagation();
    cible.focus();
  }
}
