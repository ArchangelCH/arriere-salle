// Les déplacements des joueurs, dans l'éditeur de plan du MJ. L'atelier pose le pion qu'un joueur a bougé
// depuis le coin, puis dit aux pages de l'atelier ce qui a bougé ({"type": "plan", plan, mouvements}, canal-table.js) :
// l'éditeur ouvert sur ce plan le pose aussi, sans recharger ni rien perdre de ce que le MJ est en train de faire.
//   - Un pion que le MJ a déplacé de son côté (pas encore enregistré) garde la place que lui a donnée le MJ : son geste
//     gagne. Sinon le pion glisse à sa nouvelle case, et ce que le héros découvre se révèle (sa pièce, ou ses alentours).
//   - Les portes que le héros a ouvertes en passant s'ouvrent aussi (et se referment avec « Annuler »), sauf celles que le
//     MJ a changées de son côté.
//   - La version du plan suit (version_base) quand l'éditeur était à jour : l'enregistrement suivant passe sans conflit.
//     Sinon, le serveur rejoue lui-même ces mouvements (mouvements.py, rejouer) et les rend avec la réponse.
//   - L'historique (Ctrl+Z, Ctrl+Maj+Z) est corrigé : revenir en arrière n'efface pas le geste d'un joueur.
// Pions à valider : les déplacements qui attendent le MJ sur ce plan paraissent en pions fantômes ; un clic sur l'un d'eux
// propose de l'accepter (le refus reste dans la boîte des demandes). Ce qui a arrêté un héros sur le vrai plan (une porte
// verrouillée, la porte secrète qu'il a tâtée sans la trouver) se dit au MJ d'un mot, une fois.
// Fonctions sans page pour le pion, les portes et l'historique (outils/verifier_mouvements_editeur.mjs les rejoue).

import { api, toast } from "../api.js";
import { ecouterDemandes, ecouterPlans } from "../ecran-tv/canal-table.js";
import { demander } from "../commun/dialogue.js";

const proche = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-6;

// Les pions après ce mouvement : une nouvelle liste (la vue fait glisser le pion), ou null si rien ne bouge (le pion n'y
// est plus, ou le MJ l'a déplacé de son côté). force : poser le pion même ailleurs (l'historique, où le geste du joueur
// doit survivre à tout retour en arrière).
export function pionsApres(pions, m, force = false) {
  const t = (pions || []).find((x) => x && x.id === m.pion);
  if (!t || !Array.isArray(m.apres)) return null;
  if (proche(t.x, m.apres[0]) && proche(t.y, m.apres[1])) return null;
  if (!force && !(Array.isArray(m.avant) && proche(t.x, m.avant[0]) && proche(t.y, m.avant[1]))) return null;
  return pions.map((x) => (x === t ? { ...x, x: m.apres[0], y: m.apres[1] } : x));
}

// Le brouillard après ce mouvement (la pièce entrée révélée, ou cachée de nouveau par « Annuler ») : le nombre de cases
// changées, en place. Rien si le plan n'a plus la même taille.
export function brouillardApres(p, m) {
  if (!Array.isArray(m.cases) || !m.cases.length || p.largeur !== m.w || p.hauteur !== m.h || !Array.isArray(p.brouillard)) return 0;
  let n = 0;
  for (const i of m.cases) {
    if (Number.isInteger(i) && i >= 0 && i < p.brouillard.length && p.brouillard[i] !== m.brouillard) {
      p.brouillard[i] = m.brouillard;
      n++;
    }
  }
  return n;
}

// Les portes après ce mouvement ({ sens, x, y, avant, apres } : ouvertes par le héros, ou refermées par « Annuler ») : le
// nombre de portes changées, en place. Une porte que le MJ a mise dans un autre état garde son geste.
export function portesApres(p, m) {
  if (!Array.isArray(m.portes) || !m.portes.length || !Array.isArray(p.portes)) return 0;
  let n = 0;
  for (const c of m.portes) {
    const d = c && p.portes.find((x) => x && x.sens === c.sens && x.x === c.x && x.y === c.y);
    if (d && (d.etat || "fermee") === c.avant && d.etat !== c.apres) {
      d.etat = c.apres;
      n++;
    }
  }
  return n;
}

// Un instantané de l'historique (JSON des champs du plan) avec le geste du joueur posé dedans.
export function corrigerInstantane(json, m) {
  let etat;
  try {
    etat = JSON.parse(json);
  } catch {
    return json;
  }
  const pions = pionsApres(etat.pions, m, true);
  if (pions) etat.pions = pions;
  const n = brouillardApres(etat, m);
  const portes = portesApres(etat, m);
  return pions || n || portes ? JSON.stringify(etat) : json;
}

// Les mouvements reçus pour le plan ouvert dans l'éditeur ed (EditeurPlan). version : faire suivre la version du plan
// (faux pour ceux que rend le serveur avec un enregistrement : la réponse porte déjà la bonne version). dire : ce qui
// prévient le MJ (les toasts de l'atelier ; un relevé dans les vérifieurs sans page).
export function recevoirMouvements(ed, liste, { version = true, dire = toast } = {}) {
  if (ed.detruit || !Array.isArray(liste)) return;
  ed.mouvementsVus ||= new Set();
  let pions = null;
  let cases = 0;
  let portes = 0;
  const alertes = [];
  const entres = [];
  const autour = [];
  const ouvreurs = [];
  for (const m of liste) {
    if (!m || typeof m.id !== "string" || ed.mouvementsVus.has(m.id)) continue;
    ed.mouvementsVus.add(m.id);
    // Le pion que le MJ tient en main en ce moment, ou l'un de ceux qu'il emmène avec lui (plusieurs pions choisis, une
    // monture et ses cavaliers) : son geste gagne, rien ne le lui arrache.
    const g = ed.glisse?.type === "objet" && ed.glisse.sel?.genre === "pion" ? ed.glisse : null;
    const tenu = !!g && (g.sel.id === m.pion || (g.groupe || []).some((x) => x.id === m.pion));
    const apres = tenu ? null : pionsApres(pions || ed.plan.pions, m);
    if (apres) pions = apres;
    const n = brouillardApres(ed.plan, m);
    const np = portesApres(ed.plan, m);
    cases += n;
    portes += np;
    const nom = String((ed.plan.pions || []).find((t) => t.id === m.pion)?.nom || "Un héros").split(" ")[0];
    if (n && m.brouillard === 1) {
      const qui = m.revele === "autour" ? autour : entres;
      if (!qui.includes(nom)) qui.push(nom);
    }
    if (np && m.genre !== "annulation" && !ouvreurs.includes(nom)) ouvreurs.push(nom);
    if (apres || n || np) {
      ed.passe = ed.passe.map((s) => corrigerInstantane(s, m));
      ed.futur = ed.futur.map((s) => corrigerInstantane(s, m));
    }
    if (version && m.version_avant && ed.plan.modifie === m.version_avant) ed.plan.modifie = m.version_apres;
    for (const a of m.alertes || []) if (!alertes.includes(a)) alertes.push(a);
  }
  if (pions) ed.vue.majPions(pions);
  if (cases || portes) ed.vue.majStructure();
  if (pions || cases || portes) {
    ed.vue.demander();
    const sel = ed.selection?.genre;
    if ((sel === "pion" || sel === "pions" || (sel === "porte" && portes)) && !ed.panneau?.contains(document.activeElement)) ed.afficherPanneau();
  }
  // Un seul message (un message de passage chasse le précédent) : la porte ouverte, puis ce qui se révèle.
  const et = (noms) => noms.join(" et ");
  const phrases = [];
  if (ouvreurs.length) phrases.push(`${et(ouvreurs)} ${ouvreurs.length > 1 ? "ouvrent" : "ouvre"} une porte en passant.`);
  if (entres.length) phrases.push(`${et(entres)} ${entres.length > 1 ? "entrent" : "entre"} dans une pièce cachée : elle se révèle aux joueurs.`);
  if (autour.length) phrases.push(`${et(autour)} ${autour.length > 1 ? "avancent" : "avance"} dans le noir : ses alentours se révèlent aux joueurs.`);
  if (phrases.length) dire(phrases.join(" "));
  if (alertes.length) dire(`Déplacement d'un joueur : ${alertes.join(" ")}`, "erreur");
  ed.fantomes?.relire();
}

// ---------------------------------------------------------------- les pions fantômes (pions à valider)

class Fantomes {
  constructor(ed) {
    this.ed = ed;
    this.liste = [];
    this.lecture = 0;
    this.tentativesVues = null; // à la première lecture, les tentatives déjà là comptent pour dites
    this.finDemandes = ecouterDemandes(() => this.relire());
    this.clic = (ev) => this.toucher(ev);
    ed.canvas.parentElement.addEventListener("pointerdown", this.clic, true);
    this.relire();
  }

  async relire() {
    const n = ++this.lecture;
    let r;
    try {
      r = await api.get(`/api/plans/${encodeURIComponent(this.ed.plan.id)}/deplacements`);
    } catch {
      return;
    }
    if (n !== this.lecture || this.ed.detruit) return;
    const avant = JSON.stringify(this.liste);
    this.liste = Array.isArray(r.attente) ? r.attente : [];
    if (JSON.stringify(this.liste) !== avant) this.ed.vue.demander();
    this.direTentatives(Array.isArray(r.tentatives) ? r.tentatives : []);
  }

  // Ce qui a arrêté un héros sur le vrai plan, dit une fois (le joueur, lui, a lu « un mur » pour une porte secrète).
  direTentatives(liste, dire = toast) {
    const premiere = this.tentativesVues === null;
    this.tentativesVues ||= new Set();
    for (const x of liste) {
      if (!x || typeof x.id !== "string" || this.tentativesVues.has(x.id)) continue;
      this.tentativesVues.add(x.id);
      if (!premiere && x.phrase) dire(x.phrase, x.raison === "secrete" ? "erreur" : "info");
    }
  }

  places() {
    return this.liste.map((d) => {
      const t = (this.ed.plan.pions || []).find((x) => x.id === d.pion);
      return { d, t, x: d.vers[0] + 0.5, y: d.vers[1] + 0.5 };
    }).filter((f) => f.t);
  }

  dessiner(ctx) {
    if (!this.liste.length) return;
    const z = this.ed.vue.cam.z;
    ctx.save();
    for (const { t, x, y } of this.places()) {
      ctx.setLineDash([7 / z, 5 / z]);
      ctx.lineWidth = 2 / z;
      ctx.strokeStyle = "rgba(240, 203, 120, .8)";
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = /^#[0-9a-f]{3,8}$/i.test(t.couleur || "") ? t.couleur : "#c29b5c";
      ctx.beginPath();
      ctx.arc(x, y, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.setLineDash([5 / z, 4 / z]);
      ctx.lineWidth = 2.5 / z;
      ctx.strokeStyle = "#f0cb78";
      ctx.stroke();
    }
    ctx.restore();
  }

  // Un clic sur un fantôme : accepter ce déplacement (par la boîte, avec sa version), ou le laisser en attente.
  async toucher(ev) {
    if (!this.liste.length || (ev.pointerType === "mouse" && ev.button !== 0)) return;
    const r = this.ed.canvas.getBoundingClientRect();
    const [cx, cy] = this.ed.vue.versCarte(ev.clientX - r.left, ev.clientY - r.top);
    const f = this.places().find((p) => Math.hypot(p.x - cx, p.y - cy) < 0.5);
    if (!f) return;
    ev.preventDefault();
    ev.stopPropagation();
    const oui = await demander({
      titre: `Déplacement de ${f.d.joueur_nom}`, texte: f.d.phrase || "Ce joueur veut aller sur cette case.",
      aide: "Le refus se fait dans la boîte des demandes, avec un mot si vous voulez.", oui: "Accepter", non: "Laisser en attente",
    });
    if (!oui || this.ed.detruit) return;
    try {
      await api.post(`/api/demandes/${encodeURIComponent(f.d.joueur)}/${encodeURIComponent(f.d.id)}/accepter`, { version: f.d.version });
      toast(`Déplacement de ${f.d.joueur_nom} accepté.`);
    } catch (err) {
      toast(`Déplacement non accepté : ${err.message}`, "erreur");
    }
    this.relire();
  }

  detruire() {
    this.finDemandes?.();
    this.ed.canvas.parentElement?.removeEventListener("pointerdown", this.clic, true);
  }
}

// Branche l'éditeur ed (au démarrage, après sa vue) : les mouvements reçus, et les fantômes dessinés par-dessus le plan.
// Rend de quoi cesser.
export function brancherMouvements(ed) {
  const fin = ecouterPlans((msg) => {
    if (msg.plan === ed.plan.id) recevoirMouvements(ed, msg.mouvements);
  });
  ed.fantomes = new Fantomes(ed);
  const dessus = ed.vue.dessusEditeur;
  ed.vue.dessusEditeur = (ctx, zone) => {
    if (dessus) dessus(ctx, zone);
    ed.fantomes?.dessiner(ctx);
  };
  return () => {
    fin();
    ed.fantomes?.detruire();
    ed.fantomes = null;
  };
}
