// Le confort de la table : les thèmes qu'un joueur coche dans son carnet (« Mes limites ») et que le MJ retrouve dans
// « Avant de jouer ». Servi aux deux : le coin des joueurs pour les cases, l'atelier pour repérer ces thèmes dans les
// textes préparés d'une séance. Les clés sont celles de confort.py (un test le vérifie).
//
// mots : ce qui désigne le thème dans un texte, sans accents ni casse ; « * » laisse la fin du mot libre (« tortur* » :
// torture, torturé, torturer). Des mots précis plutôt que nombreux : un avertissement de trop lasse plus qu'il n'aide.

export const THEMES = [
  { cle: "araignees", nom: "Les araignées", de: "d'araignées", mots: ["araignee*", "arachnide*", "tarentule*"] },
  { cle: "serpents", nom: "Les serpents", de: "de serpents", mots: ["serpent*", "vipere*", "couleuvre*", "aspic*"] },
  { cle: "insectes", nom: "Les insectes et la vermine", de: "d'insectes ou de vermine", mots: ["insecte*", "vermine*", "asticot*", "cafard*", "blatte*", "rat", "rats"] },
  { cle: "noyade", nom: "La noyade", de: "de noyade", mots: ["noyade*", "noye", "noyes", "noyee", "noyees", "se noie", "se noyer", "noient"] },
  { cle: "torture", nom: "La torture", de: "de torture", mots: ["tortur*", "tortionnaire*", "supplicie*"] },
  { cle: "enfants", nom: "La violence sur les enfants", de: "de violence sur des enfants", mots: ["infanticide*", "enfant* battu*", "enfant* maltrait*", "enfant* martyr*", "maltrait* un enfant", "maltrait* des enfants", "tuer un enfant", "tuer des enfants", "tue un enfant", "tue des enfants", "massacre des enfants"] },
  { cle: "violences-sexuelles", nom: "Les violences sexuelles", de: "de violences sexuelles", mots: ["viol", "viols", "violer", "violee", "violees", "violeur*", "abus sexuel*", "agression* sexuelle*", "violence* sexuelle*"] },
  { cle: "sexe", nom: "Les scènes de sexe", de: "de sexe", mots: ["sexe", "ebats", "nuit d'amour", "faire l'amour", "font l'amour", "fait l'amour", "coucher avec", "couche avec", "couchent ensemble"] },
  { cle: "gore", nom: "Le gore et les mutilations", de: "de gore ou de mutilations", mots: ["gore", "mutil*", "demembr*", "eviscer*", "eventr*", "decapit*"] },
  { cle: "suicide", nom: "Le suicide", de: "de suicide", mots: ["suicid*"] },
  { cle: "esclavage", nom: "L'esclavage", de: "d'esclavage", mots: ["esclav*"] },
  { cle: "brules-vifs", nom: "Le bûcher et les brûlés vifs", de: "de bûcher ou de gens brûlés vifs", mots: ["bucher", "buchers", "brule* vif*", "brulee* vive*", "immole*"] },
];

export const NIVEAUX = { ligne: "Ligne", voile: "Voile" };
// Une limite écrite avec ses mots : quelques mots, pas une page ; huit au plus par liste (confort.py, LIBRE_MAX, LIBRES_MAX).
export const LIBRE_MAX = 80;
export const LIBRES_MAX = 8;

export const forme = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’`]/g, "'");

const echapperRegex = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Un mot de la liste en motif : les mots se suivent, séparés par des espaces ou une ponctuation ; jamais au milieu d'un
// autre mot (« rat » ne trouve ni « rater » ni « pirate »).
function motif(mot) {
  const morceaux = forme(mot).split(/\s+/).filter(Boolean).map((m) => (m.endsWith("*") ? `${echapperRegex(m.slice(0, -1))}[a-z]*` : echapperRegex(m)));
  return `(?:^|[^a-z0-9])${morceaux.join("[^a-z0-9]+")}(?![a-z0-9])`;
}

const MOTIFS = new Map(THEMES.map((t) => [t.cle, new RegExp(t.mots.map(motif).join("|"))]));

// Les petits mots qui ne disent rien d'un thème : une limite écrite à la main ne se cherche que par ses mots pleins.
const VIDES = new Set(("le la les l un une des du de d et ou a au aux en dans sur sous par pour avec sans qui que quoi ce cet cette ces " +
  "mon ma mes son sa ses leur leurs tout tous toute toutes trop tres plus pas ne ni se s y quand comme etre avoir fait faire " +
  "chose choses truc trucs genre scene scenes theme themes").split(" "));
// Au-delà de trois mots pleins, une limite écrite est une phrase : on ne la cherche pas dans les textes, le MJ la lit.
// Ses mots pleins se cherchent ensemble, dans une même phrase du texte (chercheur).
const MOTS_PLEINS_MAX = 3;

function motifLibre(texte) {
  const mots = forme(texte).split(/[^a-z0-9]+/).filter((m) => m.length > 2 && !VIDES.has(m));
  if (!mots.length || mots.length > MOTS_PLEINS_MAX) return null;
  // Chaque mot plein, au singulier comme au pluriel (« serpent » trouve « serpents »), n'importe où dans le même texte.
  return mots.map((m) => new RegExp(`(?:^|[^a-z0-9])${echapperRegex(m.length > 3 ? m.replace(/[sx]$/, "") : m)}[sx]?(?![a-z0-9])`));
}

// Ce qu'une limite du confort cherche dans un texte : un thème par ses mots, une limite écrite par ses mots pleins.
// Rend une fonction (texte déjà passé par forme → vrai s'il en parle), ou null si elle ne se cherche pas.
export function chercheur(item) {
  if (item.cle) {
    const rx = MOTIFS.get(item.cle);
    return rx ? (t) => rx.test(t) : null;
  }
  const motifs = motifLibre(item.texte || "");
  if (!motifs) return null;
  // Plusieurs mots pleins : dans une même phrase, pas éparpillés dans un long chapitre.
  return motifs.length === 1 ? (t) => motifs[0].test(t) : (t) => t.split(/[.!?;\n]+/).some((phrase) => motifs.every((rx) => rx.test(phrase)));
}

export const themeDe = (cle) => THEMES.find((t) => t.cle === cle) || null;
// « de torture », « d'araignées », « de « la mort d'un chien » » : ce dont parle un texte, pour la phrase du MJ.
export const deQuoi = (item) => (item.cle ? themeDe(item.cle)?.de || "" : `de «\u00a0${item.texte}\u00a0»`);
// Le nom d'une limite dans une liste : celui du thème, en minuscules (« la torture »), ou les mots du joueur.
export const nomCourt = (item) => (item.cle ? (themeDe(item.cle)?.nom || "").replace(/^./, (x) => x.toLowerCase()) : item.texte);
