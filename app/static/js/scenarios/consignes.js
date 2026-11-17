// Les consignes laissées dans le texte d'un scénario : « [[carte blanche : …]] », « [[pistes : …]] »…
// Même lecture que app/contenu/consignes.py (vérifiée sur tests/consignes-cas.json des deux côtés, outils/verifier_consignes.mjs).

const CONSIGNE = /\[\[([\s\S]*?)\]\]/g;
const TETE = /^\s*([^:：\n\]]{1,24}?)\s*[:：]\s*([\s\S]*)$/;

export const GENRES = {
  rediger: { nom: "Carte blanche", mot: "carte blanche", aide: "Rédige ce passage d'après mes indications." },
  pistes: { nom: "Des pistes", mot: "pistes", aide: "Propose deux ou trois options, je choisirai." },
  verifier: { nom: "Vérifier le canon", mot: "vérifier", aide: "Confronte le passage qui précède à la série." },
  pnj: { nom: "PNJ à créer", mot: "pnj", aide: "Crée ce personnage dans le carnet, avec sa fiche." },
  combat: { nom: "Combat à régler", mot: "combat", aide: "Prépare la rencontre et équilibre-la pour la tablée." },
};

const ALIAS = {
  "carte blanche": "rediger", rediger: "rediger", redige: "rediger", ecrire: "rediger", ecris: "rediger",
  completer: "rediger", complete: "rediger", decrire: "rediger", decris: "rediger",
  pistes: "pistes", piste: "pistes", proposer: "pistes", propose: "pistes", propositions: "pistes",
  idees: "pistes", options: "pistes",
  verifier: "verifier", verifie: "verifier", canon: "verifier",
  pnj: "pnj", personnage: "pnj",
  combat: "combat", rencontre: "combat",
};

const resserrer = (t) => (t || "").split(/\s+/).filter(Boolean).join(" ");
export const plier = (t) => resserrer((t || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase());

export function lireConsigne(contenu) {
  const tete = TETE.exec(contenu);
  if (tete && ALIAS[plier(tete[1])]) return { genre: ALIAS[plier(tete[1])], indications: tete[2].trim() };
  return { genre: "rediger", indications: contenu.trim() };
}

export const cleDe = (genre, indications) => `${genre}|${resserrer(indications)}`;

function enBloc(texte, debut, fin) {
  const avant = texte.slice(texte.lastIndexOf("\n", debut - 1) + 1, debut);
  const finLigne = texte.indexOf("\n", fin);
  const apres = texte.slice(fin, finLigne >= 0 ? finLigne : texte.length);
  return !avant.trim() && !apres.trim();
}

export function consignesDuTexte(texte) {
  const sortie = [];
  for (const m of (texte || "").matchAll(CONSIGNE)) {
    const { genre, indications } = lireConsigne(m[1]);
    const debut = m.index;
    const fin = m.index + m[0].length;
    sortie.push({ genre, indications, cle: cleDe(genre, indications), debut, fin, bloc: enBloc(texte, debut, fin) });
  }
  return sortie;
}

// Toutes les consignes du document, dans l'ordre, avec leur rang parmi les consignes identiques : c'est ce qui leur
// rattache leur proposition, même déplacées d'un chapitre à l'autre.
export function consignesDuScenario(scenario) {
  const rangs = new Map();
  const sortie = [];
  (scenario.chapitres || []).forEach((ch, i) => {
    for (const c of consignesDuTexte(ch.texte || "")) {
      const rang = (rangs.get(c.cle) || 0) + 1;
      rangs.set(c.cle, rang);
      sortie.push({ ...c, rang, chapitre: ch.id, numero: i + 1 });
    }
  });
  return sortie;
}

export function propositionDe(scenario, c) {
  const liste = scenario.reponses || [];
  for (let i = liste.length - 1; i >= 0; i--) {
    const r = liste[i];
    if (r.cle === c.cle && r.rang === c.rang && r.statut === "proposee") return r;
  }
  return null;
}

// Le texte d'une consigne tel qu'on l'écrit à la main.
export function ecrireConsigne(genre, indications) {
  const propre = (indications || "").replace(/\]\]/g, "] ]").trim();
  return `[[${GENRES[genre]?.mot || "carte blanche"} : ${propre}]]`;
}
