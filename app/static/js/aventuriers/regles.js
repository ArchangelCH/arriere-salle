// Les règles de création du kit (livret de règles, chapitres 03, 04, 09 et 10 ; fiche d'aventurier et ses guides) :
// caractéristiques, compétences, postures, équipement, niveaux, puis les calculs de la fiche et ses vérifications.
// Le monde de la campagne (peuples, vocations, éléments, thèmes, langues, dons, l'exemple du guide) vient de ses modules
// de données, campagne/regles.js et campagne/dons.js : ce module n'en garde que les règles, et les relaie.

import { DONS } from "../campagne/dons.js";
import {
  AIDES_COMPETENCES, ARMES_DE_DONS, ELEMENTS, EXEMPLES_BAREME, GUIDE, LANGUES, PEUPLES, POSTURES_ELEM, THEMES, TRAITS_PEUPLES,
  VOCATIONS,
} from "../campagne/regles.js";
import { accorder } from "../pnj/tables.js";

export { DONS, ELEMENTS, GUIDE, LANGUES, PEUPLES, POSTURES_ELEM, THEMES, VOCATIONS };

export const CARACS = [
  { cle: "physique", nom: "Physique", aide: "le corps : se battre, courir, encaisser" },
  { cle: "social", nom: "Social", aide: "les autres : convaincre, séduire, commander" },
  { cle: "mental", nom: "Mental", aide: "l'esprit : savoir, remarquer, la magie" },
];
const CLE_CARAC = { Physique: "physique", Social: "social", Mental: "mental" };

// Les compétences génériques, par caractéristique. La campagne peut colorer l'aide de l'une ou l'autre
// (AIDES_COMPETENCES, par nom) ; sans elle, l'aide des règles.
export const COMPETENCES = [
  ["Physique", [
    ["Lames", "épées, dagues, haches légères : attaquer et parer."],
    ["Armes lourdes", "haches, masses et marteaux, souvent à deux mains."],
    ["Armes d'hast", "lances, piques, hallebardes."],
    ["Bâton", "le bâton de voyage, arme des mages."],
    ["Pugilat", "mains nues, lutte, coups de tête."],
    ["Armes de tir", "arcs et arbalètes."],
    ["Armes de jet", "couteaux, haches de lancer, pierres."],
    ["Bouclier", "parer, protéger un allié."],
    ["Esquive", "éviter un coup, un éboulement, une flèche."],
    ["Athlétisme", "courir, sauter, grimper, nager."],
    ["Équitation", "monter, charger, rester en selle."],
    ["Discrétion", "se cacher, se faufiler sans bruit."],
    ["Escamotage", "voler à la tire, tours de passe-passe."],
    ["Nage", "nager, plonger, tenir son souffle."],
  ]],
  ["Social", [
    ["Présence", "impressionner, parler avec autorité."],
    ["Charme", "plaire, séduire, se faire des amis."],
    ["Baratin", "mentir, embobiner, gagner du temps."],
    ["Négociation", "marchander, conclure un accord."],
    ["Psychologie", "deviner les intentions, sentir un mensonge."],
    ["Intimidation", "faire peur, faire parler."],
    ["Spectacle", "chanter, jouer, raconter."],
    ["Étiquette", "les usages des nobles, des temples, des guildes."],
    ["Commandement", "diriger un groupe, rallier des fuyards."],
  ]],
  ["Mental", [
    ["Érudition", "histoire, légendes, religions, magie."],
    ["Concentration", "garder son calme, utiliser un don sous pression."],
    ["Perception", "remarquer, fouiller, entendre."],
    ["Vie en nature", "survivre, s'orienter, chasser."],
    ["Pistage", "suivre une piste, lire des traces."],
    ["Médecine", "soigner, reconnaître un poison."],
    ["Technologie", "mécanismes, machines, pièges complexes."],
    ["Artisanat", "fabriquer, réparer : précisez le métier."],
    ["Crochetage", "serrures et pièges simples."],
    ["Alchimie", "potions, poisons, mélanges qui explosent."],
    ["Jeux", "dés, cartes, et l'art de tricher."],
    ["Stratégie", "tactique, plans, lire un champ de bataille."],
    ["Langues anciennes", "runes, textes oubliés, inscriptions."],
  ]],
].map(([carac, liste]) => [carac, liste.map(([nom, aide]) => [nom, AIDES_COMPETENCES[nom] ?? aide])]);
const INDEX_COMP = new Map(COMPETENCES.flatMap(([c, l]) => l.map(([n, d]) => [simple(n), { nom: n, avec: c, aide: d }])));

export const PROFILS_COMP = [
  ["Le spécialiste", [25, 15, 15, 5], "une chose qu'il fait mieux que tout le monde"],
  ["L'équilibré", [20, 20, 10, 10], "deux points forts"],
  ["Le touche-à-tout", [15, 15, 15, 15], "bon partout, excellent nulle part"],
];

export const REPERES = [
  ["20 à 40 %", "novice : ça marche une fois sur trois"],
  ["40 à 60 %", "qualifié : une chance sur deux"],
  ["60 à 80 %", "doué : on peut compter dessus"],
  ["80 % et plus", "maîtrise : seuls les échecs critiques inquiètent"],
];

// Les teintes du médaillon d'un élément que la campagne ne connaît pas (ELEMENTS porte celles des autres).
const TEINTES_AUTRES = ["#efe3c8", "#8a6a34", "#2b1d12"];

export const POSTURES = [
  { cle: "offensive", nom: "Offensive", donne: "Dégâts au maximum du dé, sans lancer. Réussite critique de 01 à 10.", coute: "Aucune esquive ni parade. Échec critique de 91 à 100." },
  // Règle du MJ : une seule défense en défensive, aucune en focus, +5 % à tous les tests en focus.
  { cle: "defensive", nom: "Défensive", donne: "Une défense par tour : esquiver, parer, ou protéger un allié proche à sa place. Le bouclier s'ajoute à l'armure.", coute: "Dégâts normaux." },
  { cle: "focus", nom: "Focus", donne: "+5 % à tous les tests. Chaque don coûte 1 Psy de moins ; à 0, il s'active sans test, une fois par scène.", coute: "Aucune esquive ni parade." },
];

// Les armes du livret (chapitre 10) et la compétence qui s'en sert.
export const ARMES = [
  { nom: "Mains nues", degats: "1D4", competence: "Pugilat", notes: "" },
  { nom: "Dague", degats: "1D4", competence: "Lames", notes: "se lance" },
  { nom: "Deux dagues", degats: "1D4", competence: "Lames", notes: "se lancent" },
  { nom: "Couteau", degats: "1D4", competence: "Lames", notes: "se lance" },
  { nom: "Bâton", degats: "1D6", competence: "Bâton", notes: "" },
  { nom: "Gourdin", degats: "1D6", competence: "Armes lourdes", notes: "" },
  { nom: "Épée courte", degats: "1D6", competence: "Lames", notes: "" },
  { nom: "Hachette", degats: "1D6", competence: "Lames", notes: "se lance" },
  { nom: "Rapière", degats: "1D6", competence: "Lames", notes: "" },
  { nom: "Lance", degats: "1D8", competence: "Armes d'hast", notes: "allonge ; 1D10 à deux mains" },
  { nom: "Épée", degats: "1D10", competence: "Lames", notes: "" },
  { nom: "Hache", degats: "1D10", competence: "Armes lourdes", notes: "" },
  { nom: "Masse", degats: "1D10", competence: "Armes lourdes", notes: "" },
  { nom: "Cimeterre", degats: "1D10", competence: "Lames", notes: "" },
  { nom: "Arme à deux mains", degats: "2D6", competence: "Armes lourdes", notes: "marteau, grande hache, épée longue" },
  { nom: "Bâton ferré", degats: "2D6", competence: "Bâton", notes: "à deux mains" },
  // Les armes que donnent les dons de la campagne, entre les armes de contact et celles de tir.
  ...ARMES_DE_DONS,
  { nom: "Arc court", degats: "1D6", competence: "Armes de tir", notes: "" },
  { nom: "Arc long", degats: "1D8", competence: "Armes de tir", notes: "" },
  { nom: "Arbalète", degats: "1D10", competence: "Armes de tir", notes: "recharger : une action" },
];

export const ARMURES = [
  { nom: "Vêtements épais", indice: 0, gene: "" },
  { nom: "Cuir souple", indice: 1, gene: "" },
  { nom: "Armure de cuir", indice: 2, gene: "" },
  { nom: "Cotte de mailles", indice: 3, gene: "−10 % en discrétion" },
  { nom: "Plaques partielles", indice: 4, gene: "−10 % en discrétion, nage, acrobaties" },
  { nom: "Plaques complètes", indice: 5, gene: "−20 % en discrétion, nage, acrobaties" },
];

export const SAC = "Tout aventurier possède sans avoir à l'écrire : sac, couverture, gourde, briquet, corde de 10 m, torche, couteau, trois jours de vivres.";

// Le barème des dons : le coût, l'ampleur de l'effet, et des dons du livret à ce prix (EXEMPLES_BAREME, de la campagne).
export const BAREME = [
  ["0", "un talent permanent, un compagnon"],
  ["1", "un petit effet pour une scène : +20 % à un type de test, +2 dégâts, voir dans le noir, une question au MJ"],
  ["2", "un effet net : 1D6 de soin, une cible immobilisée un tour, +2 d'armure pour un combat"],
  ["3", "un effet fort ou de zone : 1D6 à tous ceux à 5 m, un brouillard, une conversation en pensée"],
  ["4 et +", "un effet qui change la scène : une monture, un mur, une tempête"],
  ["X", "on choisit la dépense, l'effet suit"],
].map(([cout, ampleur], i) => [cout, ampleur, EXEMPLES_BAREME[i] ?? ""]);

// Guide de progression (livret, chapitre 09). points : à répartir entre Santé et Psy.
export const NIVEAUX = [
  { n: 2, points: 3, texte: "+3 points à répartir entre Santé et Psy." },
  { n: 3, points: 3, don: "nouveau", texte: "+3 points, et un nouveau don." },
  { n: 4, points: 3, postureElementaire: true, texte: "+3 points, et la posture élémentaire." },
  { n: 5, points: 3, toutes: 5, texte: "+3 points, et +5 % à toutes les caractéristiques." },
  { n: 6, don: "au-choix", texte: "Un nouveau don, ou un don amélioré." },
  { n: 7, points: 3, competences: 10, texte: "+3 points, et +10 % de compétences, ou une nouvelle compétence à +10." },
  { n: 8, don: "au-choix", une: 5, texte: "Un don nouveau ou amélioré, et +5 % à une caractéristique." },
  { n: 9, points: 3, competences: 10, texte: "+3 points, et +10 % de compétences." },
  { n: 10, toutes: 5, don: "nouveau", texte: "+5 % à toutes les caractéristiques, et un nouveau don. Au-delà, on entre dans la légende." },
];
export const AMELIORATIONS = ["Le coût baisse de 1 (minimum 1).", "Les dégâts ou les soins gagnent 1D6.", "Une nouvelle utilisation, avec l'accord du MJ."];

// Les dix étapes du guide de création ; l'aventurier d'exemple, suivi d'étape en étape, vient de la campagne (GUIDE).
export const ETAPES = [
  { n: 1, titre: "Une idée", regle: "Qui étiez-vous avant ? Pourquoi l'aventure ? Qu'est-ce que vous ne ferez jamais ? Une phrase chacune suffit.", exemple: GUIDE.exemples[0] },
  { n: 2, titre: "Le peuple", regle: `${GUIDE.peuples} Le peuple colore l'histoire et les dons ; le MJ décide s'il apporte une particularité. Aucun peuple ne donne de bonus automatique.`, exemple: GUIDE.exemples[1] },
  { n: 3, titre: "Une ou deux vocations", regle: "Ce que vous savez faire. Deux vocations élargissent le choix des dons, sans point en plus. Les vocations ouvrent leurs listes de dons et donnent l'équipement de départ.", exemple: GUIDE.exemples[2] },
  { n: 4, titre: "Les caractéristiques", regle: "Répartissez 170 % entre Physique (le corps), Social (les autres) et Mental (l'esprit), par tranches de 5, aucune sous 25 ni au-dessus de 75.", exemple: GUIDE.exemples[3] },
  { n: 5, titre: "Les compétences", regle: "Choisissez 4 compétences et répartissez 60 % entre elles, de +5 à +25 chacune, par tranches de 5. Pour chacune, notez la caractéristique avec laquelle on l'utilise : la valeur est la caractéristique plus le bonus.", exemple: GUIDE.exemples[4] },
  { n: 6, titre: "Santé et Psy", regle: "Répartissez 12 points entre la Santé (ce que le corps encaisse) et la Psy (ce qui alimente les dons). Au moins 5 en Santé et 1 en Psy. Les niveaux 2, 3, 4, 5, 7 et 9 en ajouteront 3 chacun.", exemple: GUIDE.exemples[5] },
  { n: 7, titre: "Les dons", regle: "3 dons, plus 1 si votre Psy vaut 5 ou plus, plus 1 si elle vaut 7 ou plus. Prenez-les dans les listes qui collent à votre peuple, vos vocations et votre élément, ou créez-en avec le MJ. Le guerrier a peu de dons et beaucoup de Santé, le mage l'inverse.", exemple: GUIDE.exemples[6] },
  { n: 8, titre: "Élément, posture, thèmes", regle: "Un élément, même sans magie : il colore le caractère et les dons. Une posture de base : offensive, défensive ou focus. Trois thèmes, trois mots qui vous animent ; jouer un thème avec conviction est une bonne raison de recevoir un avantage.", exemple: GUIDE.exemples[7] },
  { n: 9, titre: "Équipement et langues", regle: "Le kit de votre vocation, trois objets personnels, 3D6 × 10 pièces d'or. Le commun et une autre langue. Pour chaque arme : valeur = Physique + compétence d'arme.", exemple: GUIDE.exemples[8] },
  { n: 10, titre: "Finitions", regle: "Un nom, une allure, un défaut visible, et un lien avec un autre aventurier du groupe : une dette, un souvenir, une rivalité.", exemple: GUIDE.exemples[9] },
];

// ---------------------------------------------------------------- outils

export function simple(t) {
  return String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "'").trim().toLowerCase();
}
const minuscule = (t) => (t ? `${t.charAt(0).toLowerCase()}${t.slice(1)}` : "");

export const competenceConnue = (nom) => INDEX_COMP.get(simple(nom)) || null;
export const donDuKit = (nom) => DONS.find((d) => simple(d.nom) === simple(nom)) || null;
export const elementConnu = (nom) => ELEMENTS.find((x) => simple(x.nom) === simple(nom)) || null;
export const peupleConnu = (nom) => PEUPLES.find((x) => simple(x.nom) === simple(nom) || simple(x.f) === simple(nom)) || null;
export const vocationConnue = (nom) => VOCATIONS.find((x) => simple(x.nom) === simple(nom)) || null;
export const armeConnue = (nom) => ARMES.find((x) => simple(x.nom) === simple(nom)) || null;
export const armureConnue = (nom) => ARMURES.find((x) => simple(x.nom) === simple(nom)) || null;

export function teintes(a) {
  return elementConnu(a.element)?.teintes || TEINTES_AUTRES;
}

// « Humaine », « Naine » : le peuple accordé au genre de l'aventurier.
export function peupleAccorde(a) {
  const p = peupleConnu(a.peuple);
  if (!p) return a.peuple || "";
  return a.genre === "f" ? p.f : p.nom;
}

export function vocationAccordee(nom, genre) {
  const v = vocationConnue(nom);
  return v ? (genre === "f" ? v.f : v.nom) : nom;
}

// Ce que la campagne dit d'un peuple (TRAITS_PEUPLES) : secret, element, conseil. Rien pour un peuple inventé.
const traitsDu = (nom) => {
  const p = peupleConnu(nom);
  return (p && Object.prototype.hasOwnProperty.call(TRAITS_PEUPLES, p.nom) && TRAITS_PEUPLES[p.nom]) || {};
};

// Un peuple que le monde traque ou surveille est gardé secret d'office (la TV ne l'affiche pas), et le MJ décoche la case
// si la table peut le savoir.
export function peupleSecret(nom) {
  return !!traitsDu(nom).secret;
}

// Le titre sous le nom : « Marquée de l'air · éclaireuse et archère » (un peuple qui dit son élément, TRAITS_PEUPLES).
export function titre(a) {
  let peuple = peupleAccorde(a);
  if (traitsDu(a.peuple).element && a.element) peuple += ` ${elementConnu(a.element)?.de || `de ${minuscule(a.element)}`}`;
  const metier = (a.specialite || "").trim() || (a.vocations || []).map((v) => minuscule(vocationAccordee(v, a.genre))).join(" et ");
  return [peuple, metier].filter(Boolean).join(" · ");
}

// La ligne d'un aventurier dans la tablée des séances (écran du MJ : le peuple y figure même gardé secret).
// Sert aussi aux prétirés du kit : PRETIRES.map(identiteTablee).
export function identiteTablee(a) {
  const vocation = (a.specialite || "").trim() || (a.vocations || []).map((v) => minuscule(vocationAccordee(v, a.genre))).join(" et ");
  return {
    personnage: a.nom || "",
    peuple: titre({ ...a, specialite: "", vocations: [] }),
    vocation: vocation ? `${vocation.charAt(0).toUpperCase()}${vocation.slice(1)}` : "",
  };
}

export const valeurCarac = (a, nom) => +a[CLE_CARAC[nom] || simple(nom)] || 0;

export function valeurCompetence(a, c) {
  return valeurCarac(a, c.avec || competenceConnue(c.nom)?.avec || "Physique") + (+c.bonus || 0);
}

// Valeur d'une arme : la caractéristique de sa compétence plus le bonus, ou le Physique seul sans la compétence.
export function valeurArme(a, arme) {
  const comp = (a.competences || []).find((c) => c.nom && simple(c.nom) === simple(arme.competence));
  if (comp) return valeurCompetence(a, comp);
  if (CLE_CARAC[arme.competence]) return valeurCarac(a, arme.competence);
  return valeurCarac(a, "Physique");
}

export function lireDes(expr) {
  const m = /^\s*(\d*)\s*[dD]\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/.exec(String(expr ?? ""));
  if (!m) return null;
  return (+(m[1] || 1)) * +m[2] + (m[3] ? (m[3] === "-" ? -1 : 1) * +m[4] : 0);
}

// Défense (livret, chapitre 05) : un test de Physique plus Esquive, Bouclier (s'il en porte un) ou son arme. On prend la
// meilleure : l'esquive, le bouclier, ou n'importe quelle arme de contact de la fiche (pas un arc, pas une arme de jet).
const ARME_A_DISTANCE = /tir|jet/;
export function defense(a) {
  const bonus = (nom) => (a.competences || []).filter((c) => (c.nom || "").trim() && simple(c.nom) === simple(nom)).reduce((m, c) => Math.max(m, +c.bonus || 0), 0);
  const contact = (a.armes || []).filter((w) => (w.nom || "").trim() && w.competence
    && !ARME_A_DISTANCE.test(simple(w.competence)) && !ARME_A_DISTANCE.test(simple(armeConnue(w.nom)?.competence)));
  const parArme = contact.reduce((m, w) => Math.max(m, bonus(w.competence)), 0);
  return valeurCarac(a, "Physique") + Math.max(bonus("Esquive"), a.bouclier ? bonus("Bouclier") : 0, parArme);
}

// Améliorer un don : « le coût baisse de 1 (minimum 1) ». Rend le nouveau coût, ou null s'il ne peut pas baisser
// (déjà à 1, gratuit, ou variable comme X ou ½ Santé max). « 2+ » devient « 1+ », « 3 Santé » devient « 2 Santé ».
export function coutBaisse(cout) {
  const m = /^(\d+)(.*)$/.exec(String(cout ?? "").trim());
  if (!m || +m[1] <= 1) return null;
  return `${+m[1] - 1}${m[2]}`;
}

// La bourse de départ : 3D6 × 10 pièces d'or, doublée pour un politicien.
export function bourseDeDepart(a) {
  const k = (a.vocations || []).some((v) => simple(v) === "politicien") ? 2 : 1;
  return { min: 30 * k, max: 180 * k, double: k === 2 };
}

export const nbDonsCreation = (psy) => 3 + (psy >= 5 ? 1 : 0) + (psy >= 7 ? 1 : 0);

// Les listes de dons ouvertes par le peuple, les vocations et l'élément.
export function listesDe(a) {
  const listes = [];
  const p = peupleConnu(a.peuple);
  if (p?.dons) listes.push({ liste: p.dons, pourquoi: "peuple" });
  for (const v of a.vocations || []) if (vocationConnue(v)) listes.push({ liste: vocationConnue(v).nom, pourquoi: "vocation" });
  const el = elementConnu(a.element);
  if (el?.liste && !listes.some((l) => l.liste === el.liste)) listes.push({ liste: el.liste, pourquoi: "élément" });
  return listes;
}

// Un don de la fiche : ceux du kit sont relus dans le livret, ceux créés avec le MJ gardent leur texte.
export function lireDon(d) {
  const kit = d.cree ? null : donDuKit(d.nom);
  return {
    nom: d.nom,
    cout: d.cout ?? kit?.cout ?? "?",
    effet: [d.effet ?? kit?.effet ?? "", d.ameliore ? `Amélioré : ${d.ameliore}` : ""].filter(Boolean).join(" "),
    liste: kit?.liste || "",
    heros: kit?.heros || "",
    cree: !kit,
  };
}

export function niveauxPasses(niveau) {
  return NIVEAUX.filter((x) => x.n <= (niveau || 1));
}

// Ce que la fiche doit totaliser à un niveau donné, d'après le guide de progression.
export function attendus(niveau) {
  const passes = niveauxPasses(niveau);
  return {
    santePsy: 12 + passes.reduce((s, x) => s + (x.points || 0), 0),
    caracs: 170 + passes.reduce((s, x) => s + (x.toutes || 0) * 3 + (x.une || 0), 0),
    competences: 60 + passes.reduce((s, x) => s + (x.competences || 0), 0),
    caracMax: 75 + passes.reduce((s, x) => s + (x.toutes || 0) + (x.une || 0), 0),
  };
}

// ---------------------------------------------------------------- vérifications

// Pour chaque étape : « ok », « a-faire » (incomplet) ou « erreur » (règle du kit enfreinte), et les messages.
// Un message « info » renseigne sans rien bloquer : l'étape reste conforme.
export function verifier(a) {
  const niv = a.niveau || 1;
  const creation = niv === 1;
  const att = attendus(niv);
  const r = Object.fromEntries(ETAPES.map((e) => [e.n, []]));
  const note = (n, niveau, texte) => r[n].push({ niveau, texte: accord(texte, a) });

  if (!(a.avant || "").trim() && !(a.histoire || "").trim()) note(1, "a-faire", "Qui était votre {aventurier|aventurière} avant ?");
  if (!(a.pourquoi || "").trim() && !(a.histoire || "").trim()) note(1, "a-faire", "Pourquoi {est-il devenu aventurier|est-elle devenue aventurière} ?");
  if (!(a.jamais || "").trim()) note(1, "a-faire", "Ce {qu'il|qu'elle} ne fera jamais.");

  if (!(a.peuple || "").trim()) note(2, "a-faire", "Choisissez un peuple.");

  const voc = a.vocations || [];
  if (!voc.length) note(3, "a-faire", "Choisissez une ou deux vocations.");
  if (voc.length > 2) note(3, "erreur", "Deux vocations au plus.");

  const cs = CARACS.map((c) => ({ ...c, v: +a[c.cle] || 0 }));
  const somme = cs.reduce((s, c) => s + c.v, 0);
  if (somme !== att.caracs) note(4, somme < att.caracs ? "a-faire" : "erreur", somme < att.caracs ? `Il reste ${att.caracs - somme} % à répartir.` : `${somme - att.caracs} % de trop.`);
  for (const c of cs) {
    if (c.v % 5) note(4, "erreur", `${c.nom} : par tranches de 5.`);
    if (c.v < 25) note(4, "erreur", `${c.nom} : ${c.v}, sous 25.`);
    if (c.v > att.caracMax) note(4, "erreur", `${c.nom} : ${c.v}, au-dessus de ${att.caracMax}.`);
  }

  const comps = (a.competences || []).filter((c) => (c.nom || "").trim());
  // Le bonus d'une ligne encore sans nom est déjà réparti : il compte dans le total.
  const total = (a.competences || []).reduce((s, c) => s + (+c.bonus || 0), 0);
  if (creation && comps.length < 4) note(5, "a-faire", `Encore ${4 - comps.length} compétence${comps.length === 3 ? "" : "s"} à choisir.`);
  if (creation && comps.length > 4) note(5, "erreur", "Quatre compétences à la création.");
  if (total !== att.competences) note(5, total < att.competences ? "a-faire" : "erreur", total < att.competences ? `Il reste ${att.competences - total} % à répartir.` : `${total - att.competences} % de trop.`);
  for (const c of comps) {
    if ((+c.bonus || 0) % 5) note(5, "erreur", `${c.nom} : par tranches de 5.`);
    if (creation && ((+c.bonus || 0) < 5 || (+c.bonus || 0) > 25)) note(5, "erreur", `${c.nom} : +${+c.bonus || 0}, entre +5 et +25 à la création.`);
  }
  const noms = comps.map((c) => simple(c.nom));
  if (new Set(noms).size !== noms.length) note(5, "erreur", "Une compétence est notée deux fois.");
  if (voc.some((v) => simple(v) === "combattant") && !comps.some((c) => /lames|armes|baton|pugilat|bouclier/.test(simple(c.nom))))
    note(5, "info", "{Un combattant|Une combattante} sans compétence d'arme frappe avec son seul Physique.");

  const sante = +a.sante || 0;
  const psy = +a.psy || 0;
  if (sante + psy !== att.santePsy) note(6, "erreur", `Santé et Psy font ${sante + psy} : ${att.santePsy} attendus${creation ? "" : ` au niveau ${niv}`}.`);
  if (sante < 5) note(6, "erreur", "Au moins 5 en Santé.");
  if (psy < 1) note(6, "erreur", "Au moins 1 en Psy.");

  const dons = (a.dons || []).filter((d) => (d.nom || "").trim());
  if (creation) {
    const voulu = nbDonsCreation(psy);
    if (dons.length < voulu) note(7, "a-faire", `Encore ${voulu - dons.length} don${voulu - dons.length > 1 ? "s" : ""} à choisir (${voulu} avec ${psy} en Psy).`);
    if (dons.length > voulu) note(7, "erreur", `${dons.length} dons pour ${voulu} permis avec ${psy} en Psy.`);
  }
  const listes = listesDe(a).map((l) => l.liste);
  for (const d of dons) {
    const kit = d.cree ? null : donDuKit(d.nom);
    if (kit && !listes.includes(kit.liste) && !d.valide_mj) note(7, "a-faire", `${d.nom} vient de la liste « ${kit.liste} » : cochez « validé par le MJ » quand il l'accepte.`);
    if (!kit && (!(d.effet || "").trim() || !String(d.cout ?? "").trim())) note(7, "a-faire", `${d.nom} : notez son coût et son effet, avec le MJ.`);
  }

  if (!(a.element || "").trim()) note(8, "a-faire", "Choisissez un élément.");
  if (!a.posture) note(8, "a-faire", "Choisissez une posture de base.");
  const themes = (a.themes || []).filter((t) => (t || "").trim());
  if (themes.length < 3) note(8, "a-faire", `Encore ${3 - themes.length} thème${themes.length === 2 ? "" : "s"}.`);

  if (!(a.armes || []).some((x) => (x.nom || "").trim())) note(9, "a-faire", "Au moins une arme, même un couteau.");
  if (!a.protection?.nom) note(9, "a-faire", "Choisissez une protection.");
  // Les prétirés du kit rangent leurs objets personnels dans leur équipement.
  const objets = (a.objets || []).filter((x) => (x || "").trim()).length;
  if (!a.source && objets < 3) note(9, "a-faire", objets ? `Encore ${3 - objets} objet${objets === 2 ? "" : "s"} personnel${objets === 2 ? "" : "s"}.` : "Trois objets personnels.");
  const bourse = bourseDeDepart(a);
  if (a.or === undefined || a.or === null || a.or === "") note(9, "a-faire", `Lancez 3D6 × 10 pour les pièces d'or${bourse.double ? ", doublées pour un politicien" : ""}.`);
  else if (creation && (+a.or < bourse.min || +a.or > bourse.max)) note(9, "a-faire", `La bourse de départ va de ${bourse.min} à ${bourse.max} pièces d'or${bourse.double ? " pour un politicien" : ""} : ${+a.or || 0}, à voir avec le MJ.`);
  const langues = (a.langues || "").split(/,|;|\s+et\s+/i).map(simple).filter(Boolean);
  if (!langues.length) note(9, "a-faire", "Le commun et au moins une autre langue.");
  else if (!langues.some((l) => l.startsWith("commun"))) note(9, "a-faire", "Tout aventurier parle le commun : ajoutez-le.");
  else if (langues.length < 2) note(9, "a-faire", `Une autre langue que le commun : ${LANGUES.slice(0, 3).join(", ")}…`);

  if (!(a.nom || "").trim() || /^nouvel aventurier|^nouvelle aventuriere/i.test(simple(a.nom))) note(10, "a-faire", "Donnez-lui un nom.");
  if (!(a.allure || "").trim() && !(a.histoire || "").trim()) note(10, "a-faire", "Son allure.");
  if (!(a.defaut || "").trim()) note(10, "a-faire", "Un défaut visible.");
  if (!(a.lien || "").trim()) note(10, "a-faire", "Un lien avec un autre aventurier.");

  const etapes = {};
  for (const [n, liste] of Object.entries(r)) {
    etapes[n] = { messages: liste, etat: liste.some((m) => m.niveau === "erreur") ? "erreur" : liste.some((m) => m.niveau !== "info") ? "a-faire" : "ok" };
  }
  const bloquantes = [2, 3, 4, 5, 6, 7, 8].filter((n) => etapes[n].etat !== "ok").length;
  return { etapes, pret: !bloquantes && !Object.values(etapes).some((e) => e.etat === "erreur") && !!(a.nom || "").trim() };
}

// ---------------------------------------------------------------- conseils

// « Pour bien jouer… » : trois conseils tirés des règles et de la fiche, quand le joueur n'a rien écrit.
export function conseilsAuto(a) {
  const conseils = [];
  const principale = (a.armes || []).find((x) => (x.nom || "").trim() && x.degats);
  const max = principale ? lireDes(principale.degats) : null;
  if (a.posture === "offensive") {
    conseils.push(principale && max
      ? `En posture offensive, votre ${minuscule(principale.nom)} frappe toujours au maximum : ${max}. Mais vous ne pouvez ni esquiver ni parer.`
      : "En posture offensive, vos coups font toujours leur maximum. Mais vous ne pouvez ni esquiver ni parer.");
  } else if (a.posture === "defensive") {
    const armure = +a.protection?.indice || 0;
    conseils.push(`Votre posture défensive vous donne une défense par tour : esquiver, parer, ou protéger un allié proche à sa place.${a.bouclier ? ` Avec le bouclier, votre armure passe à ${armure + 2}.` : ""}`);
  } else if (a.posture === "focus") {
    const gratuits = (a.dons || []).map(lireDon).filter((d) => d.cout === "1" && !/focus impossible|irréductible/i.test(d.effet)).map((d) => d.nom);
    conseils.push(gratuits.length
      ? `En posture focus, +5 % à tous vos tests, et ${liste(gratuits)} ne ${gratuits.length > 1 ? "coûtent" : "coûte"} rien une fois par scène, et ${gratuits.length > 1 ? "s'activent" : "s'active"} sans test. Mais vous ne pouvez ni esquiver ni parer.`
      : "En posture focus, +5 % à tous vos tests et chaque don coûte 1 Psy de moins ; un don ramené à 0 s'active sans test, une fois par scène. Mais vous ne pouvez ni esquiver ni parer.");
  }
  const comps = (a.competences || []).filter((c) => (c.nom || "").trim()).map((c) => ({ ...c, v: valeurCompetence(a, c), avec: c.avec || competenceConnue(c.nom)?.avec }));
  const meilleure = comps.sort((x, y) => y.v - x.v)[0];
  if (meilleure) {
    const n = simple(meilleure.nom);
    const suite = /tir|jet/.test(n) ? "À distance, c'est vous qui ouvrez le combat."
      : /lames|lourdes|hast|baton|pugilat|bouclier/.test(n) ? "En première ligne, c'est vous qu'on regarde."
      : /discretion|escamotage/.test(n) ? "Partez devant : personne ne vous voit venir."
      : /athletisme|equitation|esquive|nage/.test(n) ? "Quand il faut courir, grimper ou fuir, passez devant."
      : { Social: "Proposez de parler en premier.", Mental: "Quand le groupe cherche, c'est vers vous qu'il se tourne." }[meilleure.avec] || "";
    conseils.push(`Votre point fort : ${meilleure.nom}, ${meilleure.v} %. ${suite}`.trim());
  }
  const conseilDuPeuple = traitsDu(a.peuple).conseil;
  if (conseilDuPeuple) conseils.push(conseilDuPeuple);
  else if ((+a.sante || 0) <= 6) conseils.push(`Votre Santé est fragile (${+a.sante || 0}) : restez en retrait, laissez les autres encaisser.`);
  else if ((+a.psy || 0) <= 3 && (a.dons || []).length) conseils.push("Votre Psy est maigre : gardez-la pour le don qui sauve la situation. Au-delà, il se paie en Santé.");
  return conseils.slice(0, 3);
}

function liste(noms) {
  return noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}` : noms[0];
}

export function accord(texte, a) {
  return accorder(texte, a.genre);
}

// L'essentiel d'une fiche pour jouer, tel que le regardent le MJ et la table (vue de la tablée, TV) : les compétences
// et les armes portent leur valeur de test, caractéristique comprise ; deux armes identiques n'en font qu'une, « × 2 ».
export const DEFENSES_PAR_TOUR = { offensive: 0, defensive: 1, focus: 0, aucune: 0 };

// Sans posture (perdue sur un dé de mésaventure, ou retirée par le joueur depuis son coin) : hors de POSTURES (le créateur
// ne la propose pas), mais lue sur une fiche ou au combat.
export const SANS_POSTURE = { cle: "aucune", nom: "Aucune", donne: "Rien.", coute: "À découvert : aucune esquive ni parade." };

export function essentiel(a) {
  const posture = [...POSTURES, SANS_POSTURE].find((p) => p.cle === a.posture) || null;
  const competences = (a.competences || []).filter((c) => (c.nom || "").trim())
    .map((c) => ({ nom: c.nom.trim(), valeur: valeurCompetence(a, c), bonus: +c.bonus || 0, avec: c.avec || competenceConnue(c.nom)?.avec || "Physique" }))
    .sort((x, y) => y.valeur - x.valeur || x.nom.localeCompare(y.nom, "fr"));
  const armes = [];
  for (const w of (a.armes || []).filter((x) => (x.nom || "").trim())) {
    const degats = (w.degats || armeConnue(w.nom)?.degats || "").trim();
    const notes = (w.notes || "").trim();
    const meme = armes.find((x) => simple(x.nom) === simple(w.nom) && x.degats === degats && x.notes === notes && simple(x.competence) === simple(w.competence));
    if (meme) meme.nombre += 1;
    else armes.push({ nom: w.nom.trim(), competence: w.competence || "", valeur: valeurArme(a, w), degats, notes, nombre: 1 });
  }
  const dons = (a.dons || []).filter((d) => (d.nom || "").trim()).map(lireDon);
  if ((a.posture_elementaire || "").trim()) {
    dons.push({ nom: "Posture élémentaire", cout: "1 dé", effet: `${a.posture_elementaire.trim()} +10 % à tous les tests jusqu'à la fin du combat.`, cree: false });
  }
  const indice = +a.protection?.indice || 0;
  return {
    caracs: CARACS.map((c) => ({ ...c, valeur: valeurCarac(a, c.nom) })),
    sante: +a.sante || 0,
    psy: +a.psy || 0,
    defense: defense(a),
    defenses: posture ? DEFENSES_PAR_TOUR[posture.cle] : null,
    posture,
    protection: { nom: (a.protection?.nom || "").trim(), indice, gene: armureConnue(a.protection?.nom)?.gene || "" },
    bouclier: !!a.bouclier,
    competences,
    armes,
    dons,
  };
}
