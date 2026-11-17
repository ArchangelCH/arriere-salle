// La carte et le plan montrés à la TV.

import { decoderCarte } from "../carte/format.js";
import { chargerImage, memeFond } from "../carte/vue.js";
import { fondPeint } from "../plan/peint.js";
import { VuePlan, signatureStructure } from "../plan/vue.js";
import { allegerPlan, rienDeRevele } from "../ecran-tv/tv-commun.js";
import { montrerCarton } from "./cartons.js";
import { afficher, cacher, montrerAccueil, montrerLegende, montrerPlanTv } from "./ecran.js";
import { DELAI_RESEAU, FEU_ECRAN, REGLAGES_TV, S, attenteTv, toileBrume, toileFeu, toilePlan } from "./etat.js";
import { leger, lireJson } from "./outils.js";

// ---------------------------------------------------------------- carte et plan

// La carte demandée. Même fond qu'à l'écran (le MJ a révélé du brouillard, tracé une route, déplacé le groupe…) : seul ce
// qui change est repris. Renvoie vrai pour une autre carte (la caméra repart de la vue d'ensemble), null en cas d'échec.
async function chargerCarte(etat) {
  const json = await lireJson(`/api/table/carte/${encodeURIComponent(etat.carte)}`);
  if (!json || !json.terrain) return null;
  const lieux = json.lieux || {};
  for (const l of Object.values(lieux)) l.connu = true;
  const style = etat.style || json.style || "couleur";
  const annonce = json.fond_peint;
  delete json.fond_peint;
  const carte = decoderCarte(json);
  const nouvelle = !memeFond(S.vue.carte, carte);
  if (nouvelle || !S.vue.actualiser(carte, lieux, style)) {
    S.vue.style = style;
    S.vue.charger(carte, lieux, { fond: style === "peint" ? await fondFourni(annonce) : null });
    if (nouvelle) S.vue.cadrer();
  }
  S.affiche = { carte: etat.carte, version: etat.version, style: etat.style || "couleur" };
  return nouvelle;
}

// Le fond de base d'une carte peinte, déjà peint par l'atelier (annoncé par le serveur avec la carte) ; null s'il manque
// ou n'arrive pas à temps : la TV le peint alors elle-même.
async function fondFourni(annonce) {
  if (!annonce || !annonce.url) return null;
  let minuterie = 0;
  try {
    const image = await Promise.race([
      chargerImage(annonce.url),
      new Promise((_, ko) => {
        minuterie = setTimeout(() => ko(new Error("délai")), DELAI_RESEAU);
      }),
    ]);
    return { image, nouveaux: annonce.nouveaux };
  } catch {
    return null;
  } finally {
    clearTimeout(minuterie);
  }
}

async function appliquerCarte(etat, precedent) {
  S.vue.reveiller();
  let nouvelle = false;
  if (etat.carte !== S.affiche.carte || etat.version !== S.affiche.version || (etat.style || "couleur") !== S.affiche.style) {
    const r = await chargerCarte(etat);
    if (r === null && S.affiche.carte !== etat.carte) {
      // Carte injoignable : plutôt l'accueil qu'une autre carte. L'état suivant la redemandera.
      montrerCarton(null);
      return montrerAccueil(true);
    }
    nouvelle = r === true;
  }
  montrerAccueil(false);
  const memeCarte = !nouvelle && precedent && precedent.vue === "carte" && precedent.carte === etat.carte;
  if (!memeCarte || JSON.stringify(precedent.camera || null) !== JSON.stringify(etat.camera || null)) {
    const petitPas = memeCarte && precedent.camera && etat.camera && Math.abs(Math.log((precedent.camera.hv || 1) / (etat.camera.hv || 1))) < 0.25;
    S.vue.animerVers(etat.camera || {}, petitPas ? 450 : 1600);
  }
  montrerCarton(etat.lieu || null, [etat.lieu, etat.carte, etat.version ?? null]);
}

// Un plan intérieur : repeint et fondu si sa structure change (une pièce révélée, la lumière d'un incendie), sinon les
// pions glissent, et la brume et le feu, chacun sur son calque, se fondent dans les nouveaux. Renvoie vrai pour un autre
// plan (la caméra s'y pose d'un coup), null en cas d'échec.
async function chargerPlan(etat) {
  const p = await lireJson(`/api/table/plan/${encodeURIComponent(etat.plan)}`);
  if (!p || !p.largeur) return null;
  allegerPlan(p, leger);
  const style = etat.style || p.style || "couleur";
  if (!S.vuePlan) S.vuePlan = new VuePlan(toilePlan, { style, joueurs: true, tv: true, surLegende: montrerLegende, texture: S.texture, fond: "#0b0806", brume: () => toileBrume, feu: () => toileFeu, reglagesFeu: FEU_ECRAN, ...REGLAGES_TV });
  const signature = signatureStructure(p);
  const meme = S.planAffiche.plan === etat.plan;
  if (meme && signature === S.planAffiche.signature && style === S.vuePlan.style) {
    S.vuePlan.majPions(p.pions || []);
    S.vuePlan.majBrume(p.brume || [], p.brume_teinte);
    S.vuePlan.majFeu(p.feu || []);
  } else {
    if (meme) S.vuePlan.fondu();
    S.vuePlan.style = style;
    // Hors du plan, la couleur de son vide : aucune bordure ne trahit la taille du plan.
    S.vuePlan.fond = style === "parchemin" ? "#c7b48e" : style === "peint" ? fondPeint(p) : "#0f0c0a";
    S.vuePlan.charger(p);
  }
  S.planAffiche = { plan: etat.plan, version: etat.version, style: etat.style || "couleur", signature };
  return !meme;
}

async function appliquerPlan(etat, precedent) {
  if (S.vuePlan) S.vuePlan.reveiller();
  let premier = false;
  // Sans caméra, la TV cadre ce qui est révélé : une pièce révélée ou cachée depuis la recadre.
  const revele = !etat.camera && S.vuePlan && S.vuePlan.plan ? JSON.stringify(S.vuePlan.cameraRevelee()) : null;
  if (etat.plan !== S.planAffiche.plan || etat.version !== S.planAffiche.version || (etat.style || "couleur") !== S.planAffiche.style) {
    const r = await chargerPlan(etat);
    if (r === null && S.planAffiche.plan !== etat.plan) {
      montrerPlanTv(false);
      return montrerAccueil(true);
    }
    premier = r === true;
    if (premier) S.basLegende = 0;
  }
  montrerAccueil(false);
  montrerPlanTv(true);
  // Rien de révélé : le losange et « … » sur le noir, la table sait que la suite arrive (la TV n'est pas en panne).
  montrerAttente(rienDeRevele(S.vuePlan.plan));
  const memeCamera = precedent && precedent.vue === "plan" && precedent.plan === etat.plan && JSON.stringify(precedent.camera) === JSON.stringify(etat.camera);
  const recadrer = revele !== null && JSON.stringify(S.vuePlan.cameraRevelee()) !== revele;
  if (premier || !memeCamera || recadrer) S.vuePlan.animerVers(sousBandeau(etat.camera || S.vuePlan.cameraRevelee()), premier ? 1 : 1100);
}

// Le cadrage voulu par le MJ, entre le bandeau du combat (en haut) et la légende des héros (en bas) : ce qu'il
// montrait tient dans la partie libre de l'écran.
function sousBandeau(cam) {
  // En bas, la légende des héros ou la rumeur posée sur le plan : la plus haute des deux (la rumeur monte au-dessus de la légende).
  const bas = Math.max(S.basLegende, S.basRumeur);
  if ((!S.bandeau && !bas) || !cam || !cam.hv) return cam;
  const libre = Math.max(0.2, 1 - S.bandeau - bas);
  const hv = cam.hv / libre;
  return Object.assign({}, cam, { hv, y: cam.y - ((S.bandeau - bas) * hv) / 2 });
}

// Le plan montré, recadré dans la partie libre de l'écran (le bandeau ou la légende vient de paraître ou de partir).
function recadrerPlan(duree) {
  if (S.vuePlan && toilePlan.classList.contains("visible") && S.dernierEtat && S.dernierEtat.vue === "plan") {
    S.vuePlan.animerVers(sousBandeau(S.dernierEtat.camera || S.vuePlan.cameraRevelee()), duree);
  }
}

function montrerAttente(oui) {
  if (oui === attenteTv.classList.contains("visible")) return;
  if (oui) afficher(attenteTv);
  else cacher(attenteTv, 900);
}

export { appliquerCarte, appliquerPlan, montrerAttente, recadrerPlan };
