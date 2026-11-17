// « Hors du scénario » dans le tableau du MJ, la partie qui ne touche pas à la page : le lieu où sont les héros, qui s'y
// trouve, les rumeurs à placer, une rencontre tirée du bestiaire et pesée par la balance, trois noms. Fonctions pures :
// tableau/impro.js les affiche, outils/verifier_aides_tableau.mjs les vérifie.

import { CREATURES, GENS, RANGS } from "../combats/bestiaire.js";
import { auNiveau, depuisAventurier } from "../combats/groupe.js";
import { plat } from "../combats/rencontre.js";
import { VERDICTS, etudier, verdict } from "../combats/simulation.js";
import { ORIGINES_PAR_NOM_DE_LIEU, ORIGINES_PAR_TYPE_DE_LIEU, ORIGINES_TIRAGE } from "../campagne/noms.js";
import { ORIGINES, accorder, tirerNom } from "../pnj/tables.js";
import { liensDe, sceneEnCours } from "../seances/liens-scene.js";
import { nomsDuHeros } from "./moments.js";

const CATALOGUE = [...RANGS, ...CREATURES, ...GENS];
const DIFFICULTES = Object.keys(VERDICTS);
const au = (liste, hasard) => liste[Math.floor(hasard() * liste.length)];

function melanger(liste, hasard) {
  const r = [...liste];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(hasard() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

// D'où vient le lieu affiché, dit au MJ sous le choix du lieu.
export const SOURCES_LIEU = {
  choisi: "Choisi pour cette séance.",
  tv: "D'après le plan montré à la TV.",
  plan: "D'après le plan ouvert.",
  scene: "D'après le plan de la scène en cours.",
  seance: "Premier lieu de la séance.",
};

// Le lieu où sont les héros : celui que le MJ a choisi pour la séance ; sinon celui du plan montré à la TV, du plan
// ouvert, du plan lié à la scène en cours ; sinon le premier lieu de la séance. lieuDuPlan(id) rend le lieu d'un plan
// ("" s'il n'est pas encore lu). Rend { id, source } (id vide : aucun).
export function lieuCourant({ choix = "", table = null, planOuvert = null, lieuDuPlan = () => "", seance = null, lieux = [] } = {}) {
  const existe = (id) => typeof id === "string" && !!id && lieux.some((l) => l.id === id);
  if (existe(choix)) return { id: choix, source: "choisi" };
  if (table?.vue === "plan" && table.plan && existe(lieuDuPlan(table.plan))) return { id: lieuDuPlan(table.plan), source: "tv" };
  if (existe(planOuvert?.lieu)) return { id: planOuvert.lieu, source: "plan" };
  const i = sceneEnCours(seance);
  const planScene = i >= 0 ? liensDe(seance.deroule[i]).plan : null;
  if (planScene && existe(lieuDuPlan(planScene))) return { id: lieuDuPlan(planScene), source: "scene" };
  const premier = (seance?.lieux || []).find(existe);
  return premier ? { id: premier, source: "seance" } : { id: "", source: "" };
}

// Les plans dont le lieu compte pour lieuCourant : celui de la TV et celui de la scène en cours.
export function plansAConnaitre({ table = null, seance = null } = {}) {
  const ids = [];
  // Le plan de l'autre MJ (deux MJ) arrive sous son jeton (GET /api/table, « jetons ») : son lieu ne se lit pas d'ici.
  const sienne = !(Array.isArray(table?.jetons) && table.jetons.includes("plan"));
  if (table?.vue === "plan" && typeof table.plan === "string" && table.plan && sienne) ids.push(table.plan);
  const i = sceneEnCours(seance);
  const planScene = i >= 0 ? liensDe(seance.deroule[i]).plan : null;
  if (planScene && !ids.includes(planScene)) ids.push(planScene);
  return ids;
}

// Qui est là : d'abord les PNJ que lie la scène en cours, où qu'ils habitent (un mort compris : la liste le dit), même
// sans lieu connu ; puis ceux du lieu, ni morts ni disparus : ceux que les joueurs connaissent (les habitués, qu'on va
// voir quand on improvise), puis les autres ; à rang égal, ceux que la séance a sous la main (sa liste et ses autres
// scènes), puis par leur nom.
export function pnjDuLieu(pnj, lieu, seance = null) {
  const i = sceneEnCours(seance);
  const scene = i >= 0 ? liensDe(seance.deroule[i]).pnj : [];
  const deLaScene = scene.map((id) => (pnj || []).find((p) => p && p.id === id)).filter(Boolean);
  if (!lieu) return deLaScene;
  const prevus = [...(Array.isArray(seance?.pnj) ? seance.pnj : []), ...(seance?.deroule || []).flatMap((d) => liensDe(d).pnj)];
  const rang = (p) => (p.connu ? 0 : 1);
  const prevu = (p) => (prevus.includes(p.id) ? 0 : 1);
  const duLieu = (pnj || []).filter((p) => p && p.lieu === lieu && !scene.includes(p.id) && !["mort", "disparu"].includes(p.statut));
  return [...deLaScene, ...duLieu.sort((a, b) => rang(a) - rang(b) || prevu(a) - prevu(b) || String(a.nom || "").localeCompare(String(b.nom || ""), "fr"))];
}

// Les rumeurs à placer (le même filtre que l'Auberge), celles de la séance d'abord. Une rumeur n'a pas de lieu : toutes
// sont bonnes à entendre où qu'on soit.
export function rumeursAPlacer(rumeurs, seance = null) {
  const prevues = Array.isArray(seance?.rumeurs) ? seance.rumeurs : [];
  const rang = (r) => (prevues.includes(r.id) ? 0 : 1);
  return (rumeurs || []).filter((r) => r && (!r.etat || r.etat === "a-placer") && String(r.texte || "").trim())
    .sort((a, b) => rang(a) - rang(b) || String(a.cree || "").localeCompare(String(b.cree || "")));
}

export function boutiquesDuLieu(boutiques, lieu) {
  if (!lieu) return [];
  return (boutiques || []).filter((b) => b && b.lieu === lieu).sort((a, b) => String(a.nom || "").localeCompare(String(b.nom || ""), "fr"));
}

// Les familles d'adversaires du bestiaire, selon le lieu : des gens là où l'on vit, des bêtes au dehors, des morts et des
// gardiens dans les vieilles pierres. Une troupe, dont la balance fixe le nombre, et parfois l'un des leurs en plus
// (nomAvec : la rencontre avec lui).
export const FAMILLES = [
  { cle: "brigands", nom: "Brigands", troupe: "brigand", avec: "chef-mercenaire", nomAvec: "Brigands et leur chef", lieux: ["habite", "dehors"] },
  { cle: "gardes", nom: "Gardes", troupe: "garde", avec: "arbaletrier", nomAvec: "Gardes et arbalétrier", lieux: ["habite"] },
  { cle: "mercenaires", nom: "Mercenaires", troupe: "garde", avec: "chef-mercenaire", nomAvec: "Mercenaires et leur chef", lieux: ["habite", "dehors"] },
  { cle: "inquisition", nom: "Gardes de l'Inquisition", troupe: "garde", avec: "inquisiteur", nomAvec: "Un inquisiteur et sa garde", lieux: ["habite", "ancien"] },
  { cle: "villageois", nom: "Villageois en colère", troupe: "billy", lieux: ["habite"] },
  { cle: "assassin", nom: "Hommes de main", troupe: "brigand", avec: "assassin", nomAvec: "Un assassin et ses hommes de main", lieux: ["habite"] },
  { cle: "loups", nom: "Loups", troupe: "loup", avec: "loup-druidique", nomAvec: "Loups et loup druidique", lieux: ["dehors"] },
  { cle: "araignees", nom: "Jeunes araignées", troupe: "jeune-araignee", avec: "araignee-geante", nomAvec: "Une araignée géante et ses petits", lieux: ["dehors", "ancien"] },
  { cle: "gobelins", nom: "Gobelins", troupe: "gobelin", avec: "orc", nomAvec: "Gobelins menés par un orc", lieux: ["dehors", "ancien"] },
  { cle: "orcs", nom: "Orcs", troupe: "orc", lieux: ["dehors"] },
  { cle: "squelettes", nom: "Squelettes", troupe: "squelette", lieux: ["ancien"] },
  { cle: "zombies", nom: "Morts qui marchent", troupe: "zombie", lieux: ["ancien", "dehors"] },
  { cle: "gardiens", nom: "Armures enchantées", troupe: "armure-enchantee", avec: "gargouille", nomAvec: "Gardiens de pierre", lieux: ["ancien"] },
  { cle: "ogre", nom: "Gobelins", troupe: "gobelin", avec: "ogre", nomAvec: "Un ogre et ses gobelins", lieux: ["dehors"] },
];
// Les types de lieux de la carte (carte/biomes.js) ; un lieu-dit ou un type inconnu : le dehors.
const GENRES_DE_LIEU = {
  habite: ["auberge", "village", "ville", "cite", "capitale", "comptoir", "cite_naine", "forteresse", "ile_volante", "port"],
  ancien: ["tombeau", "tour", "temple", "puits"],
  ancienDehors: ["ruine", "mine", "grotte"],
  habiteDehors: ["camp"],
};

export function famillesDuLieu(lieu) {
  if (!lieu) return FAMILLES;
  const t = lieu.type;
  const genres = GENRES_DE_LIEU.habite.includes(t) ? ["habite"] : GENRES_DE_LIEU.ancien.includes(t) ? ["ancien"]
    : GENRES_DE_LIEU.ancienDehors.includes(t) ? ["ancien", "dehors"] : GENRES_DE_LIEU.habiteDehors.includes(t) ? ["habite", "dehors"] : ["dehors"];
  return FAMILLES.filter((f) => f.lieux.some((g) => genres.includes(g)));
}

// Le groupe tel que la balance le pèse : les fiches de la tablée, au niveau de la campagne.
export const groupeDeLaTablee = (fiches, niveau) => (fiches || []).map((a) => auNiveau(depuisAventurier(a), niveau));

const fiche = (cle) => CATALOGUE.find((x) => x.cle === cle);
const ligne = (cle, n) => ({ ...fiche(cle), n });
// « Garde, mercenaire, pirate » : Garde.
const nomCourt = (cle) => String(fiche(cle)?.nom || "Adversaire").split(",")[0];

export function composer(f, avec, n) {
  return [...(avec && f.avec ? [ligne(f.avec, 1)] : []), ...(n > 0 ? [ligne(f.troupe, n)] : [])];
}

// Le nom d'une rencontre, selon ce qu'elle compte vraiment : un brigand seul n'est pas « Brigands ».
export function nomDeRencontre(f, avec, n) {
  if (avec && f.avec) return n > 0 ? f.nomAvec : nomCourt(f.avec);
  return n > 1 ? f.nom : nomCourt(f.troupe);
}

const ESSAIS_PESEE = 300;
const ESSAIS_VERDICT = 2000;
// Le travail permis à un tirage, en combats simulés (quelques dizaines de millisecondes).
const COMBATS_MAX = 40000;
const TROUPE_MAX = 8;

// Une rencontre pour la tablée : une famille qui convient au lieu (sauf celle qu'on vient de tirer), son nombre cherché
// avec le moteur de la balance (etudier, verdict). Une pesée rapide par nombre, du plus petit groupe au plus grand ;
// parmi ceux qui tombent sur la difficulté visée, celui du milieu d'abord (au bord, la pesée complète le ferait
// basculer), confirmé par une pesée complète, celle du verdict affiché. Sans réussite exacte, la composition la plus
// proche. hasard : une fonction qui rend un nombre entre 0 et 1 (une graine pour rejouer un tirage).
export function tirerRencontre({ groupe = [], niveau = 1, cible = "normale", lieu = null, sauf = "", hasard = Math.random } = {}) {
  if (!groupe.length) return null;
  const visee = Math.max(0, DIFFICULTES.indexOf(cible));
  const options = { avant: 2, style: "fiches", moral: true, niveau, hasard };
  const candidates = famillesDuLieu(lieu).filter((f) => f.cle !== sauf);
  let combats = 0;
  let proche = null;
  const peser = (f, avec, n, essais) => {
    combats += essais;
    const resultat = etudier(groupe, composer(f, avec, n), options, essais);
    return { f, avec, n, resultat, ecart: DIFFICULTES.indexOf(verdict(resultat)) - visee };
  };
  const retenir = (x) => {
    if (!proche || Math.abs(x.ecart) < Math.abs(proche.ecart) || (x.ecart === proche.ecart && x.resultat.n > proche.resultat.n)) proche = x;
  };
  let trouve = null;
  chercher: for (const f of melanger(candidates.length ? candidates : FAMILLES, hasard)) {
    for (const avec of f.avec ? (hasard() < 0.5 ? [true, false] : [false, true]) : [false]) {
      const justes = [];
      for (let n = avec ? 0 : 1; n <= TROUPE_MAX && combats < COMBATS_MAX; n++) {
        const x = peser(f, avec, n, ESSAIS_PESEE);
        if (x.ecart === 0) justes.push(n);
        else retenir(x);
        if (x.ecart > 0) break;
      }
      // Le milieu d'abord, puis ses voisins.
      const milieu = (justes.length - 1) / 2;
      for (const n of justes.sort((a, b) => Math.abs(justes.indexOf(a) - milieu) - Math.abs(justes.indexOf(b) - milieu))) {
        if (combats >= COMBATS_MAX) break;
        const x = peser(f, avec, n, ESSAIS_VERDICT);
        if (x.ecart === 0) {
          trouve = x;
          break chercher;
        }
        retenir(x);
      }
      if (combats >= COMBATS_MAX) break chercher;
    }
  }
  const choisi = trouve || proche;
  if (!choisi) return null;
  const resultat = choisi.resultat.n >= ESSAIS_VERDICT ? choisi.resultat : etudier(groupe, composer(choisi.f, choisi.avec, choisi.n), options, ESSAIS_VERDICT);
  return {
    famille: choisi.f.cle, nom: nomDeRencontre(choisi.f, choisi.avec, choisi.n), adversaires: composer(choisi.f, choisi.avec, choisi.n), cible,
    cle: verdict(resultat),
    resultat: { victoire: resultat.victoire, defaite: resultat.defaite, indecis: resultat.indecis, tours: resultat.tours, auTapis: resultat.auTapis, mort: resultat.mort },
  };
}

// La rencontre telle qu'elle s'enregistre (comme une rencontre de l'onglet Combats, verdict compris).
export function rencontreAEnregistrer(tirage, { lieu = null, seance = null, nbPj = 0, niveau = 1, quand = new Date().toISOString() } = {}) {
  const r = tirage.resultat;
  const pendant = seance ? ` pendant la séance${seance.numero != null && seance.numero !== "" ? ` ${seance.numero}` : ""}${seance.nom ? ` (${seance.nom})` : ""}` : "";
  return {
    nom: lieu?.nom ? `${tirage.nom}, ${lieu.nom}` : tirage.nom,
    adversaires: tirage.adversaires,
    avant: 2, style: "fiches", moral: true,
    verdict: { cle: tirage.cle, victoire: r.victoire, indecis: r.indecis, auTapis: r.auTapis, mort: r.mort, tours: r.tours, nbPj, niveau, quand },
    notes: `Tirée au hasard dans le tableau du MJ${pendant}, pour la tablée de ${nbPj}, niveau ${niveau}.`,
    ...(lieu?.id ? { lieu: lieu.id } : {}),
  };
}

// Les noms d'une région, selon la campagne (campagne/noms.js) : celle que donne le type du lieu (un peuple chez lui),
// sinon celle que son nom ou son identifiant cite ; ailleurs, le tirage habituel.
export function origineDuLieu(lieu) {
  if (!lieu) return "";
  if (Object.prototype.hasOwnProperty.call(ORIGINES_PAR_TYPE_DE_LIEU, lieu.type)) return ORIGINES_PAR_TYPE_DE_LIEU[lieu.type];
  const texte = plat(`${lieu.id || ""} ${lieu.nom || ""}`);
  return ORIGINES_PAR_NOM_DE_LIEU.find((o) => texte.includes(o)) || "";
}

// Trois noms prêts à servir : deux d'ici (la région du lieu, s'il en a une) et un voyageur ; un homme, une femme et un
// au hasard. Aucun ne reprend un prénom ou un nom déjà pris (eviter : les noms des PNJ et de la tablée), pour qu'on
// ne confonde personne, au journal non plus.
export function troisNoms({ origine = "", eviter = [], hasard = Math.random } = {}) {
  const pris = new Set(eviter.flatMap((n) => nomsDuHeros(n)));
  const genres = melanger(["h", "f", hasard() < 0.5 ? "h" : "f"], hasard);
  return genres.map((genre, i) => {
    // Le voyageur vient d'où vient un PNJ tiré au sort (pnj/tables.js, même table).
    const o = ORIGINES.some((x) => x.cle === origine) && i < 2 ? origine : au(ORIGINES_TIRAGE, hasard);
    let nom = tirerNom(o, genre);
    for (let essai = 0; essai < 20 && nomsDuHeros(nom).some((m) => pris.has(m)); essai++) nom = tirerNom(o, genre);
    for (const m of nomsDuHeros(nom)) pris.add(m);
    return { nom, genre, origine: o, peuple: accorder(ORIGINES.find((x) => x.cle === o)?.peuple || "", genre) };
  });
}
