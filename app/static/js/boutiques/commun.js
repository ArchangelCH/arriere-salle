// Les prix d'une boutique, partagés par l'atelier et la TV. Un prix s'écrit tel que le MJ le tape (« 25 », « à partir
// de 150 », « 15 / 120 / 600 ») ; pour les joueurs, chaque nombre passe à l'ajustement de la boutique (« -10 » pour une
// bonne réputation), arrondi à la pièce, jamais sous 1 pour un prix non nul. Le serveur fait le même calcul pour la TV
// (prix_ajuste dans api/tv_boutique_combat.py) : les deux doivent rester d'accord.

const NOMBRES = /\d+(?:[.,]\d+)?/g;
export const AJUSTEMENT_MIN = -100;
export const AJUSTEMENT_MAX = 1000;

// L'ajustement de la boutique, en pour cent, borné ; 0 pour une valeur illisible.
export function ajustementDe(boutique) {
  const a = Number(boutique?.ajustement);
  return Number.isFinite(a) ? Math.max(AJUSTEMENT_MIN, Math.min(AJUSTEMENT_MAX, a)) : 0;
}

export function ajusterPrix(prix, pourcent) {
  const texte = String(prix ?? "").trim();
  if (!pourcent) return texte;
  return texte.replace(NOMBRES, (m) => {
    const n = Number(m.replace(",", "."));
    if (!n) return m;
    return String(Math.max(1, Math.floor((n * (100 + pourcent)) / 100 + 0.5)));
  });
}

// « 25 po », « à partir de 150 po » ; un prix qui ne finit pas par un nombre (« sur demande ») reste tel quel.
export function avecPo(prix) {
  const t = String(prix ?? "").trim();
  return /\d$/.test(t) ? `${t} po` : t;
}

// Le montant d'un prix fait d'un seul nombre (« 25 », « 25 po ») ; null pour un prix libre ou à plusieurs nombres.
export function montantDuPrix(prix) {
  const m = /^\s*(\d+)\s*(?:po|pièces? d'or)?\s*$/i.exec(String(prix ?? ""));
  return m ? Number(m[1]) : null;
}

// Le premier nombre du prix, pour proposer un montant quand il n'est pas simple ; null sans nombre.
export function premierNombre(prix) {
  const m = String(prix ?? "").match(/\d+/);
  return m ? Number(m[0]) : null;
}

// Les articles par catégorie, dans l'ordre où chaque catégorie paraît d'abord ; l'ordre des articles est gardé.
export function grouper(articles) {
  const groupes = [];
  const parNom = new Map();
  for (const a of articles || []) {
    const cle = String(a.categorie || "").trim();
    if (!parNom.has(cle)) {
      const g = { categorie: cle, articles: [] };
      parNom.set(cle, g);
      groupes.push(g);
    }
    parNom.get(cle).articles.push(a);
  }
  return groupes;
}

// Pour comparer deux noms d'article : sans accents, sans casse, espaces resserrées.
export function forme(texte) {
  return String(texte ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export const CATEGORIES = ["Armes", "Armures", "Équipement", "Soins et potions", "Vivres", "Montures", "Services", "Curiosités"];

// Les prix indicatifs du kit de règles, en pièces d'or. Une ligne du kit qui groupe plusieurs objets au même prix
// (« Dague, bâton », « Épée, hache, arc long ») devient un article par objet : on les vend un par un.
export const PRIX_DU_KIT = [
  { nom: "Repas et lit à l'auberge", prix: "1", categorie: "Services" },
  { nom: "Semaine de vivres", prix: "5", categorie: "Vivres" },
  { nom: "Dague", prix: "3", categorie: "Armes" },
  { nom: "Bâton", prix: "3", categorie: "Armes" },
  { nom: "Épée", prix: "25", categorie: "Armes" },
  { nom: "Hache", prix: "25", categorie: "Armes" },
  { nom: "Arc long", prix: "25", categorie: "Armes" },
  { nom: "Arbalète", prix: "40", categorie: "Armes" },
  { nom: "Armure de cuir", prix: "15", categorie: "Armures" },
  { nom: "Cotte de mailles", prix: "120", categorie: "Armures" },
  { nom: "Armure de plaques", prix: "600", categorie: "Armures" },
  { nom: "Cheval", prix: "80", categorie: "Montures" },
  { nom: "Trousse de soins (5 usages)", prix: "10", categorie: "Soins et potions" },
  { nom: "Potion de soins (1D6+2)", prix: "30", categorie: "Soins et potions" },
  { nom: "Gemme brute", prix: "à partir de 150", categorie: "Curiosités" },
];
