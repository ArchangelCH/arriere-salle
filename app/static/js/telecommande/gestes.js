// Ce que le MJ fait depuis son téléphone : montrer, changer de scène, mener le combat, lancer la musique.

import { api, copie, echapper as e } from "../api.js";
import { rayonApres } from "../boutiques/rayons-telecommande.js";
import { listeInconnus, nomsInconnus } from "../pnj/carton-pnj.js";
import { MOTS, versQui } from "../combats/barre.js";
import { finirCombat, rouvrirCombat } from "../combats/fin.js";
import { SABLIER, enListe, fusionnerCombat, herosDe, horsDeCombat, mainChangee, nomAdversaire, precedent, prenom, saisieSante, santePosee, seuilMort, suivant } from "../combats/suivi.js";
import { annoncerEtatJeu } from "../commun/etat-jeu.js";
import { injoignable, raison } from "../commun/reessai.js";
import { attenduDe, jouerSuivanteAilleurs } from "../seances/scene-suivante.js";
import { etatRetire } from "../ecran-tv/tv-commun.js";
import { CARTONS, CHAMPS_LUS, PAUSES, S, SANS_REPONSE, SUIVI_ETAPE, SUIVI_MUSIQUE, SUIVI_SCENE, ambianceDe, d, de, fichePnj, jeton, occupes, pause, planDe, relire, seanceEnCours, signe } from "./etat.js";
import { majSeance } from "./notes.js";
import { afficher, ordreSurLaTv } from "./rendu.js";

// L'annonce d'un geste. « Fait », une information ou un geste en route s'écrivent en tête, à la place de la ligne de
// la séance, comme les messages du Mac en haut de l'écran : ils ne couvrent aucune touche. Un échec, une question, ou un
// « Fait » qui offre de revenir en arrière (Rouvrir, Réessayer) restent sous le pouce, avec leur bouton.
let minuterieAnnonce = 0;
function annoncer(texte, genre, relancer = null, { libelle = "Réessayer", duree = 0 } = {}) {
  const enTete = !relancer && (genre === "fait" || genre === "info" || genre === "attente");
  const el = document.querySelector(enTete ? ".annonce-tete" : ".annonce");
  clearTimeout(minuterieAnnonce);
  effacerAnnonce();
  const phrase = String(texte || "").replace(/^./, (x) => x.toUpperCase());
  const tete = { fait: "Fait", echec: "Échec" }[genre];
  el.dataset.genre = genre;
  el.innerHTML = enTete ? `${tete ? `<b>${tete}</b> ` : ""}${e(phrase)}` : `<p>${tete ? `<b>${tete}</b> ` : ""}${e(phrase)}</p>
    ${relancer ? `<button type="button" class="touche petite" data-annonce="relancer">${e(libelle)}</button>` : ""}
    ${genre === "echec" || genre === "question" ? '<button type="button" class="fermer" data-annonce="fermer" aria-label="Fermer">×</button>' : ""}`;
  el.hidden = false;
  el.relancer = relancer;
  document.body.classList.toggle("annonce-en-tete", enTete);
  if (genre === "fait" || genre === "info") minuterieAnnonce = setTimeout(() => effacerAnnonce(), duree || (relancer ? 10000 : 3500));
}

// Efface l'annonce ; passagere : seulement un « Fait » ou une information sans bouton (un échec, une question ou un
// « Rouvrir » attendent leur toucher).
function effacerAnnonce(passagere = false) {
  for (const el of document.querySelectorAll(".annonce, .annonce-tete")) {
    if (passagere && (el.relancer || !["fait", "info"].includes(el.dataset.genre))) continue;
    el.hidden = true;
  }
  document.body.classList.toggle("annonce-en-tete", !document.querySelector(".annonce-tete").hidden);
}

// Un geste : son bouton attend, l'annonce dit où il en est puis « fait » ou « échec ». preparer() rend le travail (ou
// null : le MJ a renoncé) ; un serveur muet le voit repartir deux fois, puis le MJ peut le relancer d'un toucher.
async function geste(cle, libelle, preparer) {
  if (occupes.has(cle)) return;
  let travail;
  try {
    travail = await preparer();
  } catch (err) {
    return annoncer(raison(err), "echec");
  }
  if (!travail) return;
  occupes.add(cle);
  afficher();
  annoncer(`${libelle}…`, "attente");
  try {
    let message;
    for (let essai = 0; ; essai++) {
      try {
        message = await travail();
        break;
      } catch (err) {
        if (!injoignable(err) || essai >= PAUSES.length) throw err;
        annoncer(`${libelle} : le serveur ne répond pas, nouvel essai…`, "attente");
        await pause(PAUSES[essai]);
      }
    }
    if (message && typeof message === "object") annoncer(message.message, "fait", message.action?.faire || null, { libelle: message.action?.libelle });
    else annoncer(message, "fait");
  } catch (err) {
    annoncer(raison(err), "echec", injoignable(err) ? () => geste(cle, libelle, preparer) : null);
  } finally {
    occupes.delete(cle);
    afficher();
    relire();
  }
}

async function envoyerTable(changer) {
  const actuel = await api.get("/api/table");
  for (const k of CHAMPS_LUS) delete actuel[k];
  const nouveau = changer(actuel);
  if (!nouveau) return null;
  const r = await api.put("/api/table", nouveau);
  d.table = { ...nouveau, ...r };
  return r;
}

const surLaTv = (r, phrase) => (r && !r.ecrans ? `${phrase} Aucun écran de table n'est branché.` : phrase);

function montrerAccueil() {
  geste("accueil", "Écran d'accueil", () => async () => surLaTv(await envoyerTable(() => ({ vue: "accueil" })), "La TV montre l'écran d'accueil."));
}

// Comme « Montrer » d'un plan : la TV cadre ce qui est révélé ; déjà à l'écran, il garde son cadrage.
function montrerPlan(id) {
  const p = planDe(id);
  if (!p) return;
  geste(`plan:${id}`, `«\u00a0${p.nom}\u00a0»`, () => async () => {
    const r = await envoyerTable((t) => {
      const deja = t.vue === "plan" && t.plan === id;
      const etat = { vue: "plan", plan: id, camera: deja ? t.camera ?? null : null, style: deja && t.style ? t.style : p.style, version: p.modifie };
      for (const k of CARTONS) if (t[k]) etat[k] = t[k];
      return etat;
    });
    return surLaTv(r, `«\u00a0${p.nom}\u00a0» est sur la TV.`);
  });
}

// « Retirer », depuis le témoin : ce que ferait le « Retirer » de la page concernée (un carton d'abord, puis une vue plein
// écran, qui rend la TV à ce qu'elle recouvrait, enfin un plan ou une carte : l'accueil).
function retirerTv() {
  geste("retirer", "Retrait", () => async () => ((await envoyerTable((t) => etatRetire(t))) ? "Retiré de la TV." : "La TV montre déjà l'écran d'accueil."));
}

// Un PNJ secret ou un carton qui nomme ce que les joueurs ignorent encore (un lieu dans son rôle…) ne part qu'au second
// toucher, après une seule question (carton-pnj.js) : le PNJ secret ne devient connu des joueurs qu'à ce moment.
function basculerPnj(id, montrer, quandMeme = false) {
  const p = fichePnj(id);
  const nom = p?.nom || "ce PNJ";
  geste(`pnj:${id}`, montrer ? `Carton ${de(nom)}` : "Retrait du carton", async () => {
    if (montrer && !quandMeme) {
      const inconnus = await nomsInconnus(id);
      const secret = Boolean(p && !p.connu);
      if (inconnus.length || secret) {
        const phrases = [
          secret ? `«\u00a0${nom}\u00a0» est encore inconnu des joueurs : montrer son carton le rend connu.` : "",
          inconnus.length ? `${secret ? "Il" : `Le carton ${de(nom)}`} nomme ${listeInconnus(inconnus)}, que les joueurs ne connaissent pas encore.` : "",
        ];
        annoncer(phrases.filter(Boolean).join(" "), "question", () => basculerPnj(id, true, true),
          { libelle: secret ? "Le rendre connu et montrer" : "Montrer quand même" });
        return null;
      }
    }
    return async () => {
      if (montrer && p && !p.connu) {
        const fiche = await api.patch(`/api/pnj/${encodeURIComponent(id)}`, { connu: true });
        p.connu = Boolean(fiche.connu);
      }
      const r = await envoyerTable((t) => ({ ...t, pnj: montrer ? id : null }));
      return montrer ? surLaTv(r, `Le carton ${de(nom)} est sur la TV.`) : "Carton retiré de la TV.";
    };
  });
}

// « Scène suivante » : l'atelier du Mac la joue (relais), avec l'ambiance de la scène et par la page Séances si elle
// tient la séance ; sans atelier ouvert, le téléphone la joue lui-même, sans la musique. Le bouton porte la scène qu'il
// annonce : jouée entre-temps ailleurs, rien ne se rejoue (seances/scene-suivante.js).
function sceneSuivante() {
  const s = seanceEnCours();
  const attendu = s ? attenduDe(s) : null;
  if (!attendu || attendu.suivante < 0) return;
  geste("scene", `«\u00a0${attendu.titre}\u00a0»`, () => {
    const cle = jeton();
    return async () => {
      // La séance se relit après le geste, d'où qu'il parte.
      d.listesLues = 0;
      const r = await api.post("/api/telecommande/commandes", { genre: "scene", seance: s.id, de: attendu.enCours, vers: attendu.suivante, titre: attendu.titre, jeton: cle });
      if (r.relais) {
        const fin = await suivreCommande(r.numero, SUIVI_SCENE, true);
        if (fin.etat === "faite") return fin.message || "C'est fait sur l'ordinateur.";
        if (fin.etat === "echec") throw new Error(fin.message || "l'atelier du Mac n'a pas pu");
        if (fin.etat !== "annulee") throw new Error("l'atelier du Mac n'a pas répondu : est-il ouvert, l'ordinateur est-il réveillé ?");
      }
      const bilan = await jouerSuivanteAilleurs({ seance: s.id, attendu }, { sansMusique: "l'atelier n'est ouvert sur aucun écran" });
      majSeance(bilan.seance);
      if (bilan.refus && !bilan.deja) throw new Error(bilan.texte);
      return bilan.texte;
    };
  });
}

// Le rayon suivant ou précédent d'une boutique trop grande pour un écran : l'article montré de près s'efface.
function changerRayon(sens) {
  const b = d.boutique;
  const i = rayonApres(b, d.table, sens);
  if (i === null) return;
  geste("rayon", `Rayon ${i + 1}`, () => async () => {
    const r = await envoyerTable((t) => (t.vue === "boutique" && t.boutique === b.id ? { ...t, rayon: i, article: null } : null));
    return r ? surLaTv(r, `Rayon ${i + 1} sur ${b.pages.length} : ${b.pages[i].nom}.`) : "La TV montre déjà autre chose.";
  });
}

// L'étape du feu du plan montré. L'éditeur qui tient ce plan sur l'ordinateur la rappelle lui-même (sinon son prochain
// enregistrement tomberait en conflit) ; sans éditeur, le téléphone pose le feu et la brume de l'étape, comme sa barre
// Étapes, et la TV relit le plan.
function changerEtape(sens) {
  const p = d.plan;
  if (!p?.etapes.length) return;
  const n = p.etapes.length;
  const i = p.etape === null ? (sens > 0 ? 0 : -1) : p.etape + sens;
  if (i < 0 || i >= n) return;
  const fait = (message) => {
    if (d.plan?.id === p.id) d.plan.etape = i;
    d.planLu = 0;
    return message || `Étape ${i + 1} sur ${n}${p.etapes[i] ? ` : ${p.etapes[i]}` : ""}.`;
  };
  geste("etape", `Étape ${i + 1}`, () => {
    const cle = jeton();
    return async () => {
      const r = await api.post("/api/telecommande/commandes", { genre: "etape", plan: p.id, etape: i, jeton: cle });
      if (r.relais) {
        const fin = await suivreCommande(r.numero, SUIVI_ETAPE, true);
        if (fin.etat === "faite") return fait(fin.message);
        if (!(fin.etat === "annulee" || (fin.etat === "echec" && fin.libre))) throw new Error(fin.message || "l'éditeur du Mac n'a pas répondu");
      }
      await etapeDirecte(p.id, i);
      return fait();
    };
  });
}

async function etapeDirecte(id, i) {
  const url = `/api/plans/${encodeURIComponent(id)}`;
  for (let essai = 0; ; essai++) {
    const p = await api.get(url);
    const et = Array.isArray(p.etapes) ? p.etapes[i] : null;
    if (!et) throw new Error("cette étape n'existe plus dans le plan");
    const n = Math.round(+p.largeur || 0) * Math.round(+p.hauteur || 0);
    const grille = (g) => (Array.isArray(g) && g.length === n ? g.slice() : Array(n).fill(0));
    let neuf;
    try {
      neuf = await api.patch(url, { feu: grille(et.feu), brume: grille(et.brume), etape: i, version_base: p.modifie });
    } catch (err) {
      if (err.status === 409 && !essai) continue;
      throw err;
    }
    // La TV qui montre ce plan reçoit sa nouvelle version.
    await envoyerTable((t) => (t.vue === "plan" && t.plan === id ? { ...t, version: neuf.modifie } : null));
    return neuf;
  }
}

// Une commande confiée à l'atelier : suivie jusqu'à son résultat. annuler : pas encore prise à l'échéance, le
// téléphone la reprend (le serveur ne la donnera plus).
async function suivreCommande(numero, delai, annuler = false) {
  const fin = Date.now() + delai;
  for (;;) {
    const c = await api.get(`/api/telecommande/commandes/${numero}`);
    if (c.etat !== "attente" && c.etat !== "prise") return c;
    if (Date.now() > fin) {
      if (annuler && c.etat === "attente") {
        const r = await api.del(`/api/telecommande/commandes/${numero}`);
        if (r.etat !== "attente" && r.etat !== "prise") return r;
      }
      if (c.etat === "attente" || Date.now() > fin + SANS_REPONSE) return { ...c, etat: "sans-reponse" };
    }
    await pause(700);
  }
}

// Le combat se tient avec les fonctions de la page du combat (combats/suivi.js). changer(combat) rend [combat changé,
// message] ou null (le MJ renonce). Le combat part avec la version d'où il a été
// changé ; refusé parce qu'un autre écran l'a changé (409), il est fusionné avec celui du serveur, comme sur l'ordinateur.
// La main déjà passée sur l'atelier ne passe pas une seconde fois : message(combat, { deja }) le dit.
function preparerCombat(changer) {
  const jeu = d.jeu;
  if (!jeu?.combat || !jeu.seance) throw new Error("aucun combat en cours");
  const seance = jeu.seance;
  const base = copie(jeu.combat);
  const fait = changer(copie(base));
  if (!fait) return null;
  const [local, message] = fait;
  return async () => {
    const url = `/api/seances/${encodeURIComponent(seance)}/combat`;
    let corps = local;
    let version = base.modifie ?? null;
    let deja = false;
    for (let essai = 0; ; essai++) {
      try {
        const srv = await api.put(url, { ...corps, par: "telecommande", version_base: version });
        if (typeof srv.horloge === "number") S.decalage = srv.horloge * 1000 - Date.now();
        annoncerEtatJeu({ seance, combat: copie(srv.combat) });
        return message(srv.combat, { deja });
      } catch (err) {
        if (err.status !== 409 || essai >= 2) throw err;
        const lu = await api.get(url);
        if (!lu.combat || lu.combat.id !== base.id) {
          annoncerEtatJeu(lu.combat ? { seance, combat: copie(lu.combat) } : { combat: null });
          throw new Error("ce combat a été fini ou remplacé sur un autre écran");
        }
        if (mainChangee(base, local) && mainChangee(base, lu.combat)) deja = true;
        corps = fusionnerCombat(base, local, lu.combat);
        version = lu.combat.modifie ?? null;
      }
    }
  };
}

// Comme la touche Entrée du suivi : le combattant suivant, qui saute un héros dans le coma ou des ennemis à terre.
// Une part de plus ou de moins : le compte visé est envoyé, pas le pas, pour qu'un nouvel essai ne compte pas double.
function pasHorloge(id, pas) {
  const h = (d.horloges || []).find((x) => x.id === id);
  if (!h) return;
  const vise = Math.max(0, Math.min(h.parts, h.remplies + pas));
  geste(`horloge:${id}`, pas > 0 ? "Une part de plus" : "Une part de moins", async () => async () => {
    const r = await api.patch(`/api/horloges/${encodeURIComponent(id)}`, { remplies: vise });
    if (Array.isArray(r?.horloges)) d.horloges = r.horloges;
    return `« ${h.nom} » : ${vise} sur ${h.parts}${vise >= h.parts ? ", échue" : ""}.`;
  });
}

function basculerHorloge(id) {
  const h = (d.horloges || []).find((x) => x.id === id);
  if (!h) return;
  const montrer = !h.visible;
  geste(`horloge:${id}`, montrer ? "Montrer à la TV" : "Retirer de la TV", async () => async () => {
    const r = await api.patch(`/api/horloges/${encodeURIComponent(id)}`, { visible: montrer });
    if (Array.isArray(r?.horloges)) d.horloges = r.horloges;
    return montrer ? `« ${h.nom} » est à la TV.` : `« ${h.nom} » n'est plus à la TV.`;
  });
}

function passerLaMain() {
  geste("combat", "La main passe", () => preparerCombat((c) => [suivant(c), (x, { deja }) => {
    if (deja) return `L'atelier a déjà passé la main ${versQui(x)}.`;
    return `La main passe ${versQui(x)}${x.tour > c.tour ? `, tour ${x.tour}` : ""}.`;
  }]));
}

// Les gestes de la barre du combat (combats/barre.js), les mêmes que sur l'ordinateur.
function gesteDeLaBarre(action, b) {
  if (action === "suivant") return passerLaMain();
  if (action === "precedent") {
    return geste("combat", MOTS.precedent, () => preparerCombat((c) => [precedent(c), (x, { deja }) => (deja ? `L'atelier a déjà passé la main ${versQui(x)}.` : `La main revient ${versQui(x)}.`)]));
  }
  if (action === "aller") {
    const rang = +b.dataset.rang || 0;
    return geste("combat", "La main passe", () => preparerCombat((c) => [{ ...c, actif: Math.max(0, Math.min((c.ordre || []).length - 1, rang)), sablier: null },
      (x, { deja }) => (deja ? `L'atelier a déjà passé la main ${versQui(x)}.` : `La main passe ${versQui(x)}.`)]));
  }
  if (action === "strat") {
    return geste("combat", MOTS.strat, () => preparerCombat((c) => [{ ...c, strat: !c.strat }, (x) => (x.strat ? "Point strat pris : le temps s'arrête, les joueurs se concertent." : "Point strat rendu.")]));
  }
  if (action === "sablier") {
    return geste("combat", "Sablier", () => preparerCombat((c) => [{ ...c, sablier: c.sablier ? null : { duree: SABLIER } },
      (x) => (x.sablier ? "Le sablier tourne : à zéro, le monstre rejoue." : "Sablier arrêté.")]));
  }
  if (action === "tv") return basculerOrdreTv();
  if (action === "fin") return finDuCombat();
}

// L'ordre du tour à la TV ou retiré, comme sur l'ordinateur.
function basculerOrdreTv() {
  const seance = d.jeu?.seance;
  if (!seance || !d.jeu?.combat) return;
  const montrer = !ordreSurLaTv();
  geste("combat", montrer ? MOTS.tv : MOTS.tvRetirer, () => async () => {
    const r = await api.put(`/api/seances/${encodeURIComponent(seance)}/combat/tv`, { montrer });
    if (d.table) {
      if (r.tv) d.table.combat = seance;
      else delete d.table.combat;
    }
    if (!r.tv) return "L'ordre du tour a quitté la TV.";
    return surLaTv(r, ["plan", "carte", "image"].includes(d.table?.vue) ? "L'ordre du tour est sur la TV."
      : "L'ordre du tour paraîtra sur la TV dès qu'elle montrera un plan, une carte ou une image.");
  });
}

// « Fin du combat » : qui est encore debout, rappelé dans une question qui ne part qu'au second toucher ; le bilan va au
// journal, et l'annonce qui suit offre « Rouvrir le combat » pendant dix secondes.
function finDuCombat(confirme = false) {
  const c = d.jeu?.combat;
  const seance = d.jeu?.seance;
  if (!c || !seance) return;
  geste("combat", MOTS.fin, () => {
    const debout = (c.adversaires || []).filter((a) => !horsDeCombat(a)).map(nomAdversaire);
    const tv = ordreSurLaTv();
    if (confirme !== true) {
      annoncer(`Finir le combat «\u00a0${c.nom}\u00a0» ?${debout.length ? ` Encore debout : ${enListe(debout)}.` : ""} Son bilan sera noté au journal de la séance${tv ? ", et l'ordre du tour quitte la TV" : ""}. «\u00a0${MOTS.rouvrir}\u00a0» le reprend pendant quelques secondes.`,
        "question", () => finDuCombat(true), { libelle: MOTS.fin });
      return null;
    }
    return async () => {
      const r = await finirCombat(seance, { local: copie(c) });
      if (d.table) delete d.table.combat;
      return {
        message: r.erreur ? `Combat fini. Bilan non noté au journal : ${raison(r.erreur)}.` : "Combat fini, bilan noté au journal.",
        action: r.fini ? { libelle: MOTS.rouvrir, faire: () => rouvrirDepuisLeTelephone({ seance, fini: r.fini, ligne: r.ligne, tv }) } : null,
      };
    };
  });
}

function rouvrirDepuisLeTelephone(infos) {
  geste("combat", MOTS.rouvrir, () => async () => {
    const c = await rouvrirCombat({ ...infos, par: "telecommande" });
    if (infos.tv && d.table) d.table.combat = infos.seance;
    return `« ${c.nom} » reprend : la main est ${versQui(c)}, tour ${c.tour}.`;
  });
}

// La Santé du héros qui a la main, avec les rappels du kit (coma, réveil, repère de mort : une question, au second
// toucher, comme sur l'ordinateur).
function changerSante(delta, repereAccepte = false) {
  geste("combat", `Santé ${delta > 0 ? "+1" : "−1"}`, () => preparerCombat((c) => {
    const h = herosDe(c, c.ordre?.[c.actif]);
    if (!h) throw new Error("les adversaires ont la main : leur Santé se suit sur l'ordinateur");
    const lu = saisieSante(delta > 0 ? "+1" : "-1", h);
    const qui = prenom(h.nom);
    if (lu.sante === h.sante) {
      annoncer(lu.retenu ? `${qui} ne remonte pas : la Santé payée faute de Psy ne revient qu'après une journée entière de repos.` : `${qui} est déjà à sa Santé maximum.`, "info");
      return null;
    }
    const seuil = seuilMort(h.max);
    if (lu.sante <= seuil && h.sante > seuil && repereAccepte !== true) {
      annoncer(`${qui} tomberait à ${signe(lu.sante)} : c'est le repère de mort du kit (moins sa Santé maximum, jamais avant −10). Le MJ a toujours le dernier mot.`,
        "question", () => changerSante(delta, true), { libelle: "Noter ce chiffre" });
      return null;
    }
    const { heros, coma, reveil } = santePosee(h, lu.sante);
    Object.assign(h, heros);
    const suite = coma ? ` ${qui} tombe dans le coma.` : reveil ? ` ${qui} se réveille, avec un carton jaune en Physique.` : "";
    return [c, () => `${qui} : ${signe(h.sante)} Santé sur ${h.max}.${suite}`];
  }));
}

// La musique joue sur l'ordinateur : la commande lui est confiée par le relais, et suivie jusqu'à ce qu'il l'ait appliquée.
function envoyerMusique(action, ambiance, bouton) {
  const cle = action !== "choisir" ? `musique:${action}` : bouton.classList.contains("large") ? "musique:suivante" : `musique:${ambiance}`;
  const libelle = { pause: "Pause", reprendre: "Reprise", morceau: "Morceau suivant" }[action] || `«\u00a0${ambianceDe(ambiance)?.nom || "Ambiance"}\u00a0»`;
  geste(cle, libelle, () => {
    const cleEnvoi = jeton();
    return async () => {
      const r = await api.post("/api/telecommande/commandes", { genre: "musique", action, ...(action === "choisir" ? { ambiance } : {}), jeton: cleEnvoi });
      const fin = await suivreCommande(r.numero, SUIVI_MUSIQUE);
      if (fin.etat === "faite") return fin.message || "C'est fait sur l'ordinateur.";
      if (fin.etat === "echec") throw new Error(fin.message || "l'atelier du Mac n'a pas pu");
      throw new Error("l'atelier du Mac n'a pas répondu : est-il ouvert, l'ordinateur est-il réveillé ?");
    };
  });
}

export { annoncer, basculerHorloge, basculerPnj, changerEtape, changerRayon, changerSante, effacerAnnonce, envoyerMusique, gesteDeLaBarre, montrerAccueil, montrerPlan, pasHorloge, passerLaMain, retirerTv, sceneSuivante };
