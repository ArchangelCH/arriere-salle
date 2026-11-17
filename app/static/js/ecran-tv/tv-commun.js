// Ce que l'atelier et la télécommande savent de la TV, sans page ni réseau : la vue qu'elle montre vraiment (comme
// table.js en décide), ce qu'y fait « Retirer », et si un plan sous brouillard n'y montre que du noir. Rien ici n'ouvre
// de liaison : la télécommande et le vérifieur (outils/verifier_tv.mjs) s'en servent tels quels.

// Les cartons posés par-dessus la vue : « Retirer » les ôte d'abord, et la vue d'en dessous revient.
export const CARTONS_TV = ["pnj", "rumeur", "aventurier"];
// Les vues plein écran : chacune note la vue qu'elle recouvre (avant), retrouvée quand on la retire.
export const VUES_PLEINES = ["planche", "precedemment", "episode", "heros", "fiches", "image", "boutique", "sanctuaire", "document"];
// Ce qu'une vue plein écran note de la vue qu'elle recouvre.
export const VUE_AVANT = ["vue", "plan", "carte", "camera", "style", "version", "lieu", "url", "titre"];
// Ce que GET /api/table ajoute à l'état : jamais renvoyé.
export const CHAMPS_LUS = ["ecrans", "ecrans_salon", "ecrans_internet", "publique"];
// Ce qui désigne ce que montre la TV : une autre valeur, et c'est autre chose à l'écran (la caméra, le style et les
// versions n'en font pas partie ; le bandeau du combat, si : il paraît ou s'en va).
const DESIGNE = ["carte", "plan", "lieu", "pnj", "rumeur", "contrat", "seance", "aventurier", "boutique", "article", "rayon", "batiment", "document", "url", "titre", "combat"];
// Les vues où le bandeau du combat se pose (table.js) : ailleurs, l'ordre du tour n'est pas à l'écran.
export const VUES_COMBAT = ["plan", "carte", "image"];

// La vue que montre la TV, comme table.js la choisit : une vue sans sa fiche retombe sur l'accueil.
export function vueTv(t) {
  if (!t) return "accueil";
  if (t.vue === "heros") return "heros";
  if (t.vue === "fiches") return "fiches";
  if (t.vue === "plan" && t.plan) return "plan";
  if (t.vue === "planche") return "planche";
  if (t.vue === "boutique" && t.boutique) return "boutique";
  if (t.vue === "sanctuaire") return "sanctuaire";
  if (t.vue === "precedemment" && t.seance) return "precedemment";
  if (t.vue === "episode" && t.seance) return "episode";
  if (t.vue === "image" && t.url) return "image";
  if (t.vue === "document" && t.document) return "document";
  if (t.vue === "carte" && t.carte) return "carte";
  return "accueil";
}

// L'ordre du combat est-il à l'écran ? Un combat montré par le MJ, sur une vue où le bandeau se pose.
export const combatTv = (t) => Boolean(t && t.combat) && VUES_COMBAT.includes(vueTv(t));

// Les cartons à l'écran, dans l'ordre de CARTONS_TV.
export const cartonsTv = (t) => CARTONS_TV.filter((k) => t && t[k]);

// Le lieu montré par-dessus une carte : seulement sur une carte, comme sur la TV.
export const lieuTv = (t) => (vueTv(t) === "carte" && t.lieu ? t.lieu : null);

// Ce que montre la TV, en une clé : elle change quand une autre vue, une autre fiche ou un autre carton arrive, pas
// quand la caméra bouge ou qu'une fiche montrée est réenregistrée. Marche sur l'état public (jetons) comme sur le réel.
export function cleTv(t) {
  if (!t) return "";
  const quoi = vueTv(t);
  return JSON.stringify([quoi, ...DESIGNE.map((k) => (t[k] === undefined ? null : t[k]))]);
}

// La vue recouverte, à noter dans « avant » par une vue plein écran ; par-dessus une autre, celle que l'autre avait notée.
export function avantDe(t) {
  return VUES_PLEINES.includes(t.vue) ? t.avant || null : Object.fromEntries(VUE_AVANT.map((k) => [k, t[k] ?? null]));
}

// Une vue plein écran retirée : la TV retrouve ce qu'elle recouvrait (le plan, avec son cadrage), sinon l'accueil.
export function sansVuePleine(t) {
  const avant = t.avant && !VUES_PLEINES.includes(t.avant.vue) ? t.avant : { vue: "accueil" };
  return { ...t, ...avant, boutique: null, article: null, batiment: null, contrat: null, document: null, avant: null };
}

// Ce que fait « Retirer » : d'abord les cartons posés par-dessus (la vue revient), puis le lieu montré sur une carte,
// puis une vue plein écran (la TV retrouve ce qu'elle recouvrait), enfin un plan ou une carte (l'écran d'accueil).
// null : la TV est déjà sur l'accueil, rien à retirer.
export function etatRetire(t) {
  if (!t) return null;
  const etat = { ...t };
  for (const k of CHAMPS_LUS) delete etat[k];
  if (cartonsTv(t).length) return { ...etat, pnj: null, rumeur: null, aventurier: null };
  const quoi = vueTv(t);
  if (quoi === "carte" && t.lieu) return { ...etat, lieu: null };
  if (VUES_PLEINES.includes(quoi)) return sansVuePleine(etat);
  if (quoi === "accueil") return null;
  return { vue: "accueil" };
}

// Ce que « Retirer » ôtera, pour le dire sur le bouton : « carton », « lieu », « vue » (une vue plein écran, la TV
// revient à ce qu'elle recouvrait), « tout » (un plan ou une carte : l'accueil), ou "" (rien).
export function genreRetrait(t) {
  if (!t) return "";
  if (cartonsTv(t).length) return "carton";
  const quoi = vueTv(t);
  if (quoi === "carte" && t.lieu) return "lieu";
  if (VUES_PLEINES.includes(quoi)) return "vue";
  return quoi === "accueil" ? "" : "tout";
}

// Un plan sous brouillard dont rien n'est révélé : la TV n'en montre que du noir (ni sol, ni pion, ni légende).
export function rienDeRevele(p) {
  if (!p || !p.brouillard_actif) return false;
  const b = Array.isArray(p.brouillard) ? p.brouillard : [];
  const sol = Array.isArray(p.sol) ? p.sol : [];
  for (let i = 0; i < b.length; i++) if (b[i] === 1 && (sol[i] || p.fond)) return false;
  return true;
}

// Sur la table publique, les images d'un plan en version réduite (/api/table/vignette, vignettes.py) : 160 pixels pour
// un pion, 640 pour une image du MJ posée sur le plan, qui garde sa transparence, comme au coin des joueurs
// (IMAGE_PLAN_COIN). leger(url, largeur, transparence) rend l'adresse telle quelle pour la TV du salon.
export function allegerPlan(p, leger) {
  for (const t of p.pions || []) t.image = leger(t.image, 160, t.image_libre === true);
  for (const o of p.objets || []) if (o && o.cle === "image") o.image = leger(o.image, 640, true);
  return p;
}
