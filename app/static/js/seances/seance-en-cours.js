// La séance en cours : une seule règle pour tout l'atelier (la campagne, le bouton Journal et la touche N, le Tableau,
// la télécommande, la balance, les boutiques…). Parmi les séances non closes :
//   1. celle d'un combat en cours (le plus récent) ;
//   2. sinon celle dont une scène a été jouée aujourd'hui (« Jouer la scène »), la plus récente ;
//   3. sinon celle à la date la plus proche, avant ou après : celle du jour d'abord ;
//   4. sinon la première sans date.
// À égalité, la plus petite par son numéro. Fonctions pures, le jour en argument : outils/verifier_seance_en_cours.mjs.

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

export const aujourdhui = () => new Date().toLocaleDateString("sv");
const enJours = (iso) => Math.round(Date.parse(`${iso}T12:00:00Z`) / 864e5);
const jourDe = (iso) => {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "" : t.toLocaleDateString("sv");
};
const instant = (iso) => {
  const t = Date.parse(iso || "");
  return Number.isNaN(t) ? 0 : t;
};

// L'heure du dernier « Jouer la scène » de la séance, s'il date de ce jour-là (0 sinon). Une scène cochée depuis compte
// encore : la séance a été jouée aujourd'hui.
export function jouee(s, jour = aujourdhui()) {
  let t = 0;
  for (const d of s?.deroule || []) {
    const q = typeof d?.en_cours === "string" ? d.en_cours : "";
    if (q && jourDe(q) === jour) t = Math.max(t, instant(q));
  }
  return t;
}

const enCombat = (s) => Boolean(s?.combat && typeof s.combat === "object");

// auCombat : la séance du combat en cours quand l'écran la sait mieux que la liste (etat-jeu.js, relu toutes les 5 s).
export function seanceEnCours(seances, { jour = aujourdhui(), auCombat = "" } = {}) {
  const ouvertes = (seances || []).filter((s) => s && !s.close).sort((a, b) => (a.numero || 0) - (b.numero || 0));
  if (!ouvertes.length) return null;
  const plusRecente = (liste, quand) => liste.reduce((m, s) => (quand(s) > quand(m) ? s : m), liste[0]);
  const combat = ouvertes.find((s) => auCombat && s.id === auCombat);
  if (combat) return combat;
  const auxPrises = ouvertes.filter(enCombat);
  if (auxPrises.length) return plusRecente(auxPrises, (s) => instant(s.combat.modifie || s.combat.debut));
  const jouees = ouvertes.filter((s) => jouee(s, jour));
  if (jouees.length) return plusRecente(jouees, (s) => jouee(s, jour));
  const datees = ouvertes.filter((s) => JOUR.test(s.date || ""));
  if (!datees.length) return ouvertes[0];
  const ref = enJours(jour);
  let choisie = null;
  let ecart = Infinity;
  for (const s of datees) {
    const d = Math.abs(enJours(s.date) - ref);
    if (d < ecart) [choisie, ecart] = [s, d];
  }
  return choisie;
}

// Une séance qu'on joue aujourd'hui : datée du jour, une scène jouée aujourd'hui ou un combat en cours. C'est elle que
// la campagne propose de jouer, qui s'ouvre sur Jouer, et dont le Tableau montre le fil.
export function seanceDuJour(s, jour = aujourdhui()) {
  return Boolean(s && !s.close && (s.date === jour || jouee(s, jour) || enCombat(s)));
}
