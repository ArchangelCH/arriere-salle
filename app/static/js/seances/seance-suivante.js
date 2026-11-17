// « Préparer la suivante », dans Séances › Clore, une fois la séance close : la séance suivante préparée à moitié, avec
// ce que l'atelier sait déjà. Des règles simples, sans modèle de rédaction :
//   - les scènes non jouées de la séance close, dans leur ordre (ni l'installation, ni la pause, ni la fin) ;
//   - une scène par fil qui a avancé à la clôture, avec la rumeur qu'il laisse ;
//   - les affiches prises et pas encore réussies, celles de la séance encore sur la planche ;
//   - les rumeurs entendues pendant la séance (à suivre), celles qui restent à placer ;
//   - les PNJ croisés (ceux des scènes jouées et de « Sous la main »), ni morts ni disparus ;
//   - les lieux de la séance encore inconnus des joueurs ;
//   - les questions encore ouvertes, dans un champ resté vide ;
//   - une date, le même jour de la semaine à la même heure, une semaine plus tard, à confirmer.
// Une scène compte comme jouée si elle est cochée, si « Jouer la scène » l'a lancée, ou si le journal la cite (sa scène,
// ou le combat de sa rencontre). Si rien ne le dit, aucune scène n'est reprise : on ne devine pas.
// Chaque proposition est marquée (propose.js) : le MJ la garde ou la retire d'un clic. Une séance suivante qui existe
// déjà est complétée : on n'y ajoute que ce qui manque, sans toucher une ligne écrite. Une proposition retirée n'est
// plus jamais reproposée (suite.retires).

import { api, copie, echapper as e, toast } from "../api.js";
import { simplifier } from "./avant-de-jouer.js";
import { billetsDe, cleDeScene } from "./billets.js";
import { repere } from "./jouer-scene.js";
import { liensDe, sortDuPnj } from "./liens-scene.js";
import { GENRES_PROPOSES, proposesDe } from "./propose.js";
import { idsSousLaMain, sousLaMain } from "./sous-la-main.js";

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const enMinutes = (h) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(h || "");
  return m ? +m[1] * 60 + +m[2] : null;
};
const enHeure = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;
const heureFr = (h) => (h ? h.replace(/^0(\d)/, "$1").replace(":", " h ").replace(/ h 00$/, " h") : "");
const sansPoint = (t) => String(t || "").trim().replace(/[\s.]+$/, "");
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

// Une scène reprise de la séance close, encore proposée (pas celle d'un fil).
const nonJouee = (d) => Boolean(d?.propose) && String(d.suite_cle || "").startsWith("scene:");

// L'installation, la pause et la fin : le cadre de toute séance, jamais repris d'une séance à l'autre.
export const estDuCadre = (d) => /^(installation|pause|fin)( |$)/.test(simplifier(d?.titre));

// Les lignes du déroulé jouées, d'après ce que l'atelier a noté.
export function scenesJouees(s, rencontres = []) {
  // « Scène : <titre> » (Jouer la scène), « Combat « <rencontre> » : 2 tours… » (fin du combat).
  const journal = (s?.journal || []).map((j) => simplifier(j?.texte));
  return (s?.deroule || []).map((d) => {
    if (d?.fait || repere(d)) return true;
    const titre = simplifier(d?.titre);
    if (titre && journal.includes(`scene ${titre}`)) return true;
    const r = liensDe(d).rencontre && rencontres.find((x) => x.id === liensDe(d).rencontre);
    const nom = r && simplifier(r.nom);
    return Boolean(nom && journal.some((l) => l.startsWith(`combat ${nom} `)));
  });
}

// La ligne reprise : son texte tel quel, ses liens, sa durée. Ni heure (recalculée), ni repère, ni coche.
function reprise(d) {
  const ligne = { titre: d.titre || "", duree: d.duree ?? 30, note: d.note || "" };
  if (d.liens && typeof d.liens === "object") ligne.liens = copie(d.liens);
  return ligne;
}

// Le même jour de la semaine, une semaine plus tard (à partir de la date de la séance, sinon du jour de sa clôture).
export function dateProposee(s) {
  const base = JOUR.test(s?.date || "") ? s.date : (typeof s?.close_le === "string" ? new Date(s.close_le).toLocaleDateString("sv") : "");
  if (!JOUR.test(base)) return "";
  const t = new Date(`${base}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 7);
  return t.toISOString().slice(0, 10);
}

export function dateEnClair(iso, heure = "") {
  if (!JOUR.test(iso || "")) return "";
  const t = new Date(`${iso}T12:00:00Z`);
  const jour = t.getUTCDate();
  return `${JOURS[t.getUTCDay()]} ${jour === 1 ? "1er" : jour} ${MOIS[t.getUTCMonth()]}${heure ? ` à ${heureFr(heure)}` : ""}`;
}

// Ce que la séance close laisse à la suivante. monde : les fiches que la page Séances a chargées.
// Rend { scenes: [{ cle, raison, ligne, billets }], lignes: { genre: [{ id, raison }] }, questions, date, heure, sansScenes }.
export function propositionsDeLaSuite(s, { fils = [], contrats = [], rumeurs = [], pnj = [], lieux = [], plans = [], rencontres = [] } = {}) {
  const n = s.numero ?? "?";
  const deroule = s.deroule || [];
  const jouees = scenesJouees(s, rencontres);
  const derniere = jouees.lastIndexOf(true);
  const scenes = [];
  if (derniere >= 0) {
    deroule.forEach((d, i) => {
      if (jouees[i] || estDuCadre(d) || !(d.titre || "").trim()) return;
      // Les billets de la scène qui n'ont pas été remis la suivent.
      const billets = billetsDe(s).filter((b) => b.scene && b.scene === d.cle && !b.remis && (b.texte || "").trim());
      scenes.push({ cle: `scene:${s.id}:${d.cle || simplifier(d.titre)}`, raison: i < derniere ? `sautée en séance ${n}` : `pas jouée en séance ${n}`, ligne: reprise(d), billets });
    });
  }
  const lignes = Object.fromEntries(GENRES_PROPOSES.map((g) => [g, new Map()]));
  const proposer = (genre, id, raison) => {
    if (typeof id === "string" && id && !lignes[genre].has(id)) lignes[genre].set(id, raison);
  };
  for (const f of fils) {
    if (!f || f.actif === false) continue;
    for (const j of (f.journal || []).filter((x) => x && x.seance === s.id && x.a > 0)) {
      const etape = (f.etapes || [])[j.a - 1] || {};
      const rumeur = rumeurs.find((r) => r.fil === f.id && r.etape_fil === j.a);
      const fini = j.a >= (f.etapes || []).length;
      const note = [`Le fil « ${f.nom || "sans nom"} » a franchi l'étape ${j.a} à la clôture de la séance ${n}.`,
        etape.rumeur ? `À l'auberge : « ${sansPoint(etape.rumeur)} ».` : "",
        fini ? "Le fil est allé au bout." : ""].filter(Boolean).join(" ");
      scenes.push({ cle: `fil:${f.id}:${j.a}`, raison: `le fil « ${f.nom || "sans nom"} » a avancé`, ligne: { titre: sansPoint(etape.texte) || `${f.nom}, étape ${j.a}`, duree: 10, note }, billets: [] });
      if (rumeur && (!rumeur.etat || rumeur.etat === "a-placer")) proposer("rumeurs", rumeur.id, `laissée par le fil « ${f.nom || "sans nom"} »`);
      // L'affiche que l'étape cloue sur la planche, pour la montrer de près.
      const affiche = etape.afficher && contrats.find((c) => c.repere === etape.afficher || c.id === etape.afficher);
      if (affiche?.etat === "affiche") proposer("contrats", affiche.id, `affichée par le fil « ${f.nom || "sans nom"} »`);
    }
  }
  // Ce qu'amènent déjà les scènes proposées n'a pas besoin de sa ligne.
  const amenes = idsSousLaMain({ deroule: scenes.map((x) => x.ligne) }, plans);
  const amenesPnj = new Set(amenes.pnj.map((x) => x.id));
  const amenesLieux = new Set(amenes.lieux.map((x) => x.id));
  const fichePnj = new Map(pnj.map((p) => [p.id, p]));
  const ficheLieu = new Map(lieux.map((l) => [l.id, l]));
  for (const c of contrats) if (c?.etat === "pris") proposer("contrats", c.id, "prise, pas encore réussie");
  for (const id of s.contrats || []) if (contrats.find((c) => c.id === id)?.etat === "affiche") proposer("contrats", id, "encore sur la planche");
  const deLaSeance = new Set(s.rumeurs || []);
  for (const r of rumeurs) {
    if (!r || !(deLaSeance.has(r.id) || r.seance === s.id)) continue;
    if (r.etat === "entendue") proposer("rumeurs", r.id, r.seance === s.id ? `entendue en séance ${n}, à suivre` : "entendue, à suivre");
    else if ((!r.etat || r.etat === "a-placer") && deLaSeance.has(r.id)) proposer("rumeurs", r.id, "pas encore placée");
  }
  const sous = idsSousLaMain(s, plans);
  for (const x of sous.pnj) {
    const p = fichePnj.get(x.id);
    if (!p || sortDuPnj(p) || amenesPnj.has(x.id)) continue;
    // Croisé : lié à une scène jouée. Une scène pas jouée l'amène déjà ; choisi à la main seulement, il était sous la
    // main. Sans scène jouée connue, rien ne dit qui a été croisé : tout « Sous la main » compte.
    const croise = x.scenes.some((i) => jouees[i]);
    if (!croise && !x.choisi && derniere >= 0) continue;
    if (croise) proposer("pnj", x.id, p.connu ? `croisé en séance ${n}` : `croisé en séance ${n}, encore inconnu des joueurs`);
    else proposer("pnj", x.id, p.connu ? `sous la main en séance ${n}` : "pas encore rencontré");
  }
  for (const x of sous.lieux) {
    const l = ficheLieu.get(x.id);
    if (l && !l.connu && !amenesLieux.has(x.id)) proposer("lieux", x.id, "encore inconnu des joueurs");
  }
  return {
    scenes,
    lignes: Object.fromEntries(GENRES_PROPOSES.map((g) => [g, [...lignes[g]].map(([id, raison]) => ({ id, raison }))])),
    questions: (s.questions || "").trim(),
    date: dateProposee(s),
    heure: s.heure || "",
    sansScenes: derniere < 0 && deroule.some((d) => !estDuCadre(d)),
  };
}

// La séance suivante : la première non close après celle-ci, sinon aucune (il faut la créer).
export function seanceSuivante(s, seances = []) {
  return seances.filter((x) => x && x.id !== s.id && !x.close && (x.numero || 0) > (s.numero || 0))
    .sort((a, b) => (a.numero || 0) - (b.numero || 0))[0] || null;
}

// Les heures, de la première à la dernière, à partir de debut (« recaler les heures »).
function recaler(deroule, debut) {
  let m = enMinutes(debut);
  if (m === null) return;
  for (const d of deroule) {
    d.heure = enHeure(m);
    m += +d.duree || 0;
  }
}

// Ajoute à cible ce qui lui manque. Ne retouche aucune ligne existante : les scènes se glissent avant la fin, une
// ligne de « Sous la main » s'ajoute à sa rubrique. Rend { scenes, lignes, billets } : ce qui a été ajouté.
export function completer(cible, props, source, { plans = [] } = {}) {
  const ancienne = cible.suite && typeof cible.suite === "object" ? cible.suite : {};
  const retires = new Set(Array.isArray(ancienne.retires) ? ancienne.retires : []);
  const proposes = Object.fromEntries(GENRES_PROPOSES.map((g) => [g, { ...proposesDe(cible, g) }]));
  const deroule = Array.isArray(cible.deroule) ? cible.deroule : [];
  const presentes = new Set(deroule.map((d) => d?.suite_cle).filter(Boolean));
  const nouvelles = props.scenes.filter((x) => !retires.has(x.cle) && !presentes.has(x.cle));
  const lignes = nouvelles.map((x) => ({ ...copie(x.ligne), heure: "", propose: x.raison, suite_cle: x.cle }));
  // Avant la fin de séance si elle est la dernière ligne, sinon au bout ; l'heure suit la ligne d'avant.
  let ou = deroule.length;
  if (ou && estDuCadre(deroule[ou - 1]) && simplifier(deroule[ou - 1].titre).startsWith("fin")) ou -= 1;
  deroule.splice(ou, 0, ...lignes);
  for (let k = ou; k < ou + lignes.length; k++) {
    const avant = deroule[k - 1];
    const m = avant ? enMinutes(avant.heure) : enMinutes(cible.heure);
    deroule[k].heure = m === null ? "" : enHeure(m + (avant ? +avant.duree || 0 : 0));
  }
  cible.deroule = deroule;
  // Les billets non remis d'une scène reprise la suivent, sur sa nouvelle ligne.
  let billets = 0;
  const dejaBillets = new Set(billetsDe(cible).map((b) => b.suite_cle).filter(Boolean));
  nouvelles.forEach((x, k) => {
    for (const b of x.billets || []) {
      const cleB = `billet:${source.id}:${b.id}`;
      if (dejaBillets.has(cleB)) continue;
      cible.billets = [...billetsDe(cible), { ...copie(b), id: `b-${Math.random().toString(36).slice(2, 8)}`, scene: cleDeScene(lignes[k]), remis: false, suite_cle: cleB }];
      billets++;
    }
  });
  // Après les scènes : ce qu'elles lient est déjà sous la main.
  const sous = idsSousLaMain(cible, plans);
  let ajouts = 0;
  for (const genre of GENRES_PROPOSES) {
    const deja = new Set(genre === "pnj" || genre === "lieux" ? sous[genre].map((x) => x.id) : cible[genre] || []);
    for (const { id, raison } of props.lignes[genre] || []) {
      if (deja.has(id) || retires.has(`${genre}:${id}`)) continue;
      cible[genre] = [...(Array.isArray(cible[genre]) ? cible[genre] : []), id];
      proposes[genre][id] = raison;
      deja.add(id);
      ajouts++;
    }
  }
  if (props.questions && !(cible.questions || "").trim()) cible.questions = props.questions;
  const suite = { ...ancienne, depuis: source.id, numero: source.numero ?? null, le: new Date().toISOString(), proposes, retires: [...retires] };
  if (!JOUR.test(cible.date || "") && props.date) {
    suite.date = props.date;
    suite.heure = props.heure || cible.heure || "";
  }
  if (props.sansScenes) suite.sans_scenes = true;
  else delete suite.sans_scenes;
  cible.suite = suite;
  return { scenes: lignes.length, lignes: ajouts, billets };
}

// Une séance neuve, comme « Nouvelle séance » : le cadre (installation, pause, fin) autour des scènes proposées, la
// pause au milieu dès deux scènes ; sans scène proposée, le déroulé type tel quel. cadre : [[titre, durée], …].
export function nouvelleSuite(source, props, { numero, cadre = [], plans = [] }) {
  const heure = source.heure || "14:00";
  const type = cadre.map(([titre, duree]) => ({ heure: "", titre, duree, note: "" }));
  const estPause = (d) => simplifier(d.titre).startsWith("pause");
  const s = {
    nom: "", numero, date: "", heure, scenario: "", objectif: "", conseils: "",
    deroule: props.scenes.length ? type.filter((d) => estDuCadre(d) && !estPause(d)) : type,
    fin: "Terminez la séance sur une question, jamais sur une réponse.", questions: "", notes: "",
    pnj: [], lieux: [], contrats: [], rumeurs: [], fils_touches: [], journal: [], presents: [], reputations: [], close: false,
  };
  const bilan = completer(s, props, source, { plans });
  const pause = type.find(estPause);
  if (bilan.scenes >= 2 && pause) s.deroule.splice(s.deroule.findIndex((d) => d.propose) + Math.ceil(bilan.scenes / 2), 0, pause);
  recaler(s.deroule, heure);
  return { seance: s, bilan };
}

// Ce qui attend encore le choix du MJ. listes : { pnj, lieux, contrats, rumeurs, plans } (une fiche jetée ne compte plus).
export function enAttente(s, listes = {}) {
  const scenes = (s?.deroule || []).filter((d) => d?.propose).length;
  const presents = (genre) => {
    const ids = genre === "pnj" || genre === "lieux"
      ? sousLaMain(s, listes)[genre].map((x) => x.id)
      : (s?.[genre] || []).filter((id) => (listes[genre] || []).some((f) => f.id === id));
    return Object.keys(proposesDe(s, genre)).filter((id) => ids.includes(id)).length;
  };
  const lignes = GENRES_PROPOSES.reduce((t, g) => t + presents(g), 0);
  return { scenes, lignes, total: scenes + lignes };
}

// Les gestes, pour la page Séances (seances.js). cadre : le déroulé type de « Nouvelle séance ».
export class SuiteDeSeance {
  constructor(seances, { cadre = [] } = {}) {
    this.seances = seances;
    this.cadre = cadre;
  }

  listes() {
    const S = this.seances;
    return { pnj: S.pnj, lieux: S.lieux, contrats: S.contrats, rumeurs: S.rumeurs, rencontres: S.rencontres, plans: S.plans };
  }

  // Clore, une fois la séance close : le bouton et ce qu'il fera.
  htmlClore(s) {
    if (!s.close) return "";
    const cible = seanceSuivante(s, this.seances.seances);
    const deja = cible?.suite?.depuis === s.id;
    return `
      <section class="suite-clore" aria-labelledby="suite-clore-titre">
        <h2 id="suite-clore-titre">La séance suivante</h2>
        <p class="aide">Les scènes pas jouées, les fils qui ont avancé, les affiches prises, les rumeurs à suivre, les PNJ croisés et ce que le carnet laisse en suspens, proposés dans ${cible ? `la séance ${e(cible.numero ?? "")}` : "une séance neuve"}, avec une date à confirmer. Chaque proposition se garde ou se retire d'un clic ; rien de ce que vous avez écrit n'est touché.</p>
        ${deja ? `<p class="aide">Déjà préparée : un nouveau clic n'ajoute que ce qui manque.</p>` : ""}
        <div class="actions">
          <button class="principal" data-suite="preparer">Préparer la suivante</button>
          ${cible ? `<a class="bouton" href="#/seances/${e(cible.id)}" data-aller="${e(cible.id)}" data-onglet="preparer">Ouvrir la séance ${e(cible.numero ?? "")}</a>` : ""}
        </div>
      </section>`;
  }

  // Clore, une fois la séance close : le même bouton, tout en haut, qui ne bouge pas avec le défilement du message.
  htmlBandeauClose(s) {
    if (!s.close) return "";
    const cible = seanceSuivante(s, this.seances.seances);
    const deja = cible?.suite?.depuis === s.id;
    return `
      <section class="bandeau-clos" aria-label="Séance close">
        <p><b>Séance close${s.close_le ? ` le ${e(new Date(s.close_le).toLocaleDateString("fr-CH", { day: "numeric", month: "long" }))}` : ""}.</b> ${deja ? `La séance ${e(cible.numero ?? "")} est déjà préparée : un nouveau clic n'ajoute que ce qui manque.` : "Reste à préparer la suivante : scènes pas jouées, fils qui ont avancé, affiches, rumeurs, PNJ croisés."}</p>
        <div class="actions">
          <button class="principal" data-suite="preparer">Préparer la suivante</button>
          ${cible ? `<a class="bouton" href="#/seances/${e(cible.id)}" data-aller="${e(cible.id)}" data-onglet="preparer">Ouvrir la séance ${e(cible.numero ?? "")}</a>` : ""}
        </div>
      </section>`;
  }

  // Préparer : en tête, d'où vient la séance et ce qui attend un choix. Rien quand tout est décidé.
  htmlBandeau(s) {
    const suite = s?.suite;
    if (!suite || typeof suite !== "object" || !suite.depuis) return "";
    const attente = enAttente(s, this.listes());
    const date = JOUR.test(suite.date || "") && !JOUR.test(s.date || "") ? suite.date : "";
    if (!attente.total && !date && !suite.sans_scenes) return "";
    const n = suite.numero ?? "";
    const nonJouees = (s.deroule || []).filter(nonJouee).length;
    const quoi = [attente.scenes && pluriel(attente.scenes, "scène", "scènes"), attente.lignes && pluriel(attente.lignes, "ligne de « Sous la main »", "lignes de « Sous la main »")].filter(Boolean).join(" et ");
    return `
      <section class="suite-preparee" aria-label="Séance préparée à la clôture">
        <p class="kicker">Préparée à la clôture de la séance ${e(n)}</p>
        ${attente.total ? `<p>${e(quoi.charAt(0).toUpperCase() + quoi.slice(1))} ${attente.total > 1 ? "attendent" : "attend"} votre choix : chaque proposition, marquée « proposé », se garde ou se retire d'un clic.</p>` : ""}
        ${suite.sans_scenes ? `<p class="aide">Aucune scène de la séance ${e(n)} n'est notée jouée : son déroulé n'est pas repris. Cochez dans Jouer les scènes jouées, puis « Préparer la suivante » de nouveau.</p>` : ""}
        ${date ? `<p class="date-proposee"><span>Date proposée</span>${e(dateEnClair(date, suite.heure || s.heure))}, une semaine après la séance ${e(n)}.<button type="button" data-suite="date">Confirmer la date</button></p>` : ""}
        <div class="actions">
          ${attente.total > 1 ? '<button type="button" data-suite="tout-garder">Tout garder</button>' : ""}
          ${nonJouees > 1 ? `<button type="button" class="lien-danger" data-suite="retirer-scenes" title="Si la séance ${e(n)} est allée plus loin que ce que Jouer a noté">Retirer les ${nonJouees} scènes non jouées</button>` : ""}
          <details class="regles-suite"><summary>D'où viennent ces propositions</summary>
            <ul>
              <li>Les scènes de la séance ${e(n)} ni cochées, ni lancées, ni citées au journal (sans l'installation, la pause et la fin).</li>
              <li>Une scène par fil qui a avancé à la clôture, et la rumeur qu'il laisse.</li>
              <li>Les affiches prises et pas encore réussies, et celles de la séance encore sur la planche.</li>
              <li>Les rumeurs entendues pendant la séance, à suivre, et celles qui restent à placer.</li>
              <li>Les PNJ croisés, ni morts ni disparus, et les lieux encore inconnus des joueurs.</li>
            </ul>
          </details>
        </div>
      </section>`;
  }

  async clic(b) {
    const S = this.seances;
    const s = S.seance;
    const d = b.dataset;
    if (!s) return;
    if (d.suite === "preparer") return this.preparer(s, b);
    if (d.suite === "date") return this.confirmerDate(s);
    if (d.suite === "tout-garder") return this.toutGarder(s, d.genre || "");
    if (d.suite === "retirer-scenes") return this.retirerScenes(s);
    if (d.genre === "scene") {
      const i = +d.i;
      if (!s.deroule?.[i]?.propose) return;
      if (d.suite === "garder") {
        delete s.deroule[i].propose;
        S.marquer("seance");
        return this.redessiner();
      }
      if (d.suite === "retirer") return this.retirerScene(s, i);
    }
    if (GENRES_PROPOSES.includes(d.genre) && d.id) {
      if (d.suite === "garder") {
        this.oublier(s, d.genre, d.id);
        S.marquer("seance");
        return this.redessiner();
      }
      if (d.suite === "retirer") return this.retirerLigne(s, d.genre, d.id);
    }
  }

  // Préparer se redessine, la page reste où elle était.
  redessiner() {
    const S = this.seances;
    const corps = S.racine.querySelector(".seances-corps");
    const haut = corps?.scrollTop || 0;
    S.afficherOnglet();
    if (corps) corps.scrollTop = haut;
  }

  oublier(s, genre, id) {
    const p = s.suite?.proposes?.[genre];
    if (p && typeof p === "object") delete p[id];
  }

  toutGarder(s, genre) {
    const genres = genre ? [genre] : GENRES_PROPOSES;
    if (!genre) for (const d of s.deroule || []) delete d.propose;
    for (const g of genres) if (s.suite?.proposes) s.suite.proposes[g] = {};
    this.seances.marquer("seance");
    this.redessiner();
  }

  confirmerDate(s) {
    const suite = s.suite || {};
    if (!JOUR.test(suite.date || "")) return;
    s.date = suite.date;
    if (suite.heure) s.heure = suite.heure;
    delete suite.date;
    delete suite.heure;
    const S = this.seances;
    S.marquer("seance");
    S.afficherListe();
    S.afficherSeance();
    toast(`Date confirmée : ${dateEnClair(s.date, s.heure)}.`);
  }

  // La date choisie à la main remplace la proposée.
  dateChoisie(s) {
    if (!s?.suite?.date) return;
    delete s.suite.date;
    delete s.suite.heure;
    this.majBandeau(s);
  }

  majBandeau(s) {
    const S = this.seances;
    if (S.onglet !== "preparer" || S.seance !== s) return;
    const ancien = S.racine.querySelector(".suite-preparee");
    const html = this.htmlBandeau(s);
    if (ancien) ancien.outerHTML = html;
    else if (html) S.racine.querySelector(".contenu-onglet")?.insertAdjacentHTML("afterbegin", html);
  }

  // Les scènes non jouées reprises d'un coup (la séance d'avant est allée plus loin que ce que Jouer a noté), avec les
  // billets venus avec elles ; celles des fils restent. « Annuler » les remet.
  retirerScenes(s) {
    const avant = { deroule: [...(s.deroule || [])], billets: billetsDe(s), retires: [...(s.suite?.retires || [])] };
    const parties = avant.deroule.filter(nonJouee);
    if (!parties.length) return;
    const cles = new Set(parties.map((d) => d.cle).filter(Boolean));
    s.deroule = avant.deroule.filter((d) => !parties.includes(d));
    s.billets = avant.billets.filter((b) => !(b.suite_cle && cles.has(b.scene)));
    s.suite.retires = [...new Set([...avant.retires, ...parties.map((d) => d.suite_cle).filter(Boolean)])];
    this.seances.marquer("seance");
    this.redessiner();
    toast(`${parties.length} scènes non jouées retirées.`, "info", {
      action: {
        libelle: "Annuler",
        faire: () => {
          Object.assign(s, { deroule: avant.deroule, billets: avant.billets });
          s.suite.retires = avant.retires;
          this.seances.marquer("seance", s.id);
          if (this.seances.seance === s) this.redessiner();
        },
      },
    });
  }

  retirerScene(s, i) {
    const ligne = s.deroule[i];
    const suite = s.suite || (s.suite = {});
    const retires = new Set(suite.retires || []);
    if (ligne.suite_cle) retires.add(ligne.suite_cle);
    suite.retires = [...retires];
    s.deroule.splice(i, 1);
    // Les billets venus avec elle partent avec elle.
    const avant = billetsDe(s);
    const partis = ligne.cle ? avant.filter((b) => b.suite_cle && b.scene === ligne.cle) : [];
    if (partis.length) s.billets = avant.filter((b) => !partis.includes(b));
    this.seances.marquer("seance");
    this.redessiner();
    toast(`Scène proposée retirée : « ${(ligne.titre || "").trim().slice(0, 60)} ».`, "info", {
      action: {
        libelle: "Annuler",
        faire: () => {
          if (s.deroule.includes(ligne)) return;
          s.deroule.splice(Math.min(i, s.deroule.length), 0, ligne);
          suite.retires = (suite.retires || []).filter((x) => x !== ligne.suite_cle);
          if (partis.length) s.billets = [...billetsDe(s), ...partis];
          this.seances.marquer("seance", s.id);
          if (this.seances.seance === s) this.redessiner();
        },
      },
    });
  }

  retirerLigne(s, genre, id) {
    const raison = s.suite?.proposes?.[genre]?.[id] ?? "";
    const rang = (s[genre] || []).indexOf(id);
    s[genre] = (s[genre] || []).filter((x) => x !== id);
    this.oublier(s, genre, id);
    const suite = s.suite || (s.suite = {});
    suite.retires = [...new Set([...(suite.retires || []), `${genre}:${id}`])];
    this.seances.marquer("seance");
    this.redessiner();
    const fiche = (this.listes()[genre] || []).find((f) => f.id === id);
    const nom = String(fiche?.nom || fiche?.texte || "").trim();
    toast(`Proposition retirée${nom ? ` : « ${nom.length > 50 ? `${nom.slice(0, 48).trimEnd()}…` : nom} »` : ""}.`, "info", {
      action: {
        libelle: "Annuler",
        faire: () => {
          if ((s[genre] || []).includes(id)) return;
          const liste = [...(s[genre] || [])];
          liste.splice(rang < 0 ? liste.length : Math.min(rang, liste.length), 0, id);
          s[genre] = liste;
          suite.retires = (suite.retires || []).filter((x) => x !== `${genre}:${id}`);
          suite.proposes = suite.proposes || {};
          suite.proposes[genre] = { ...(suite.proposes[genre] || {}), [id]: raison };
          this.seances.marquer("seance", s.id);
          if (this.seances.seance === s) this.redessiner();
        },
      },
    });
  }

  // Le geste : la séance suivante créée, ou complétée, puis ouverte sur Préparer. « Annuler » la remet comme avant.
  async preparer(s, bouton = null) {
    const S = this.seances;
    if (!s.close) return;
    if (bouton) bouton.disabled = true;
    try {
      await S.vider();
      const props = propositionsDeLaSuite(s, { ...this.listes(), fils: S.fils });
      let cible = seanceSuivante(s, S.seances);
      let bilan;
      let annuler;
      if (cible) {
        const avant = copie(cible);
        bilan = completer(cible, props, s, { plans: S.plans });
        S.marquer("seance", cible.id);
        if (!(await S.enregistrer())) throw new Error("la séance suivante n'a pas pu être enregistrée");
        const ref = cible;
        annuler = () => {
          for (const k of Object.keys(ref)) if (!(k in avant)) delete ref[k];
          Object.assign(ref, copie(avant), { modifie: ref.modifie });
          S.marquer("seance", ref.id);
          if (S.seance === ref) S.afficherCorps();
        };
      } else {
        const numero = Math.max(0, ...S.seances.map((x) => x.numero || 0)) + 1;
        const neuve = nouvelleSuite(s, props, { numero, cadre: this.cadre, plans: S.plans });
        bilan = neuve.bilan;
        cible = await api.post("/api/seances", neuve.seance);
        S.seances.push(cible);
        S.bases.seances[cible.id] = copie(cible);
        S.seances.sort((a, b) => (a.numero || 0) - (b.numero || 0));
        S.annoncerSeances();
        const ref = cible;
        annuler = async () => {
          await S.vider();
          await api.del(`/api/seances/${encodeURIComponent(ref.id)}`);
          S.modifs.seance.delete(ref.id);
          S.seances = S.seances.filter((x) => x !== ref);
          S.annoncerSeances();
          S.aller(s.id, "clore");
        };
      }
      S.aller(cible.id, "preparer");
      const quoi = [bilan.scenes && pluriel(bilan.scenes, "scène", "scènes"), bilan.lignes && pluriel(bilan.lignes, "ligne", "lignes")].filter(Boolean).join(" et ");
      const texte = quoi
        ? `Séance ${cible.numero ?? ""} préparée : ${quoi} proposée${bilan.scenes + bilan.lignes > 1 ? "s" : ""}, à garder ou retirer.`
        : `La séance ${cible.numero ?? ""} avait déjà tout : rien à ajouter.`;
      toast(texte.replace("  ", " "), "info", quoi ? { action: { libelle: "Annuler", faire: () => Promise.resolve(annuler()).catch((err) => toast(`Impossible d'annuler : ${err.message}`, "erreur")) } } : {});
    } catch (err) {
      toast(`Séance suivante non préparée : ${err.message}`, "erreur");
    } finally {
      if (bouton) bouton.disabled = false;
    }
  }
}
