// « Partager avec l'autre MJ » : une fiche (PNJ, lieu) que son auteur partage se lit entière chez l'autre MJ, qui peut la
// montrer à la table mais ne la modifie pas. Le serveur tient la règle (cloisonnement.py : une écriture répond 403) ; ici,
// seulement l'interface : la case chez l'auteur, la pastille et la lecture seule chez l'autre.
// La page de l'atelier porte le compte du MJ et les autres MJ ouverts (<body data-compte data-autres-mj>, pages.py)
// seulement quand il y a deux MJ : sans eux, ni case ni pastille, rien ne change.

const corps = () => (typeof document !== "undefined" && document.body ? document.body.dataset : {});

export const monCompte = () => corps().compte || "";

export function autresMJ() {
  try {
    const liste = JSON.parse(corps().autresMj || "[]");
    return Array.isArray(liste) ? liste.filter((m) => m && typeof m.id === "string") : [];
  } catch {
    return [];
  }
}

// La case n'a de sens qu'avec deux MJ.
export const partagePossible = () => Boolean(monCompte()) && autresMJ().length > 0;

const auteurDe = (fiche) => autresMJ().find((m) => m.id === fiche?.auteur) || null;

// Une fiche d'un autre MJ, qu'il partage : en lecture seule ici.
export const partageeParUnAutre = (fiche) => Boolean(fiche && fiche.partage === true && monCompte() && auteurDe(fiche));

export const nomDeLAuteur = (fiche) => auteurDe(fiche)?.nom || "l'autre MJ";

const echapper = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// La case, à côté de « Connu des joueurs » : chez l'auteur seulement, et seulement s'il existe un autre MJ.
// attributs : ceux de la case dans sa page (data-champ="partage", data-l="partage"…).
export function htmlCasePartage(fiche, attributs) {
  if (!partagePossible() || partageeParUnAutre(fiche)) return "";
  const autres = autresMJ();
  const qui = autres.length === 1 ? autres[0].nom : "les autres MJ";
  return `<label class="case case-partage" title="${echapper(qui)} pourra lire toute la fiche, secrets compris, et la montrer à la TV, sans rien y changer."><input type="checkbox" ${attributs} ${fiche?.partage === true ? "checked" : ""}> Partager avec ${echapper(qui)}</label>`;
}

// La pastille des listes, chez celui qui reçoit ; chez l'auteur, un rappel discret que la fiche est partagée.
export function htmlPastillePartage(fiche) {
  if (partageeParUnAutre(fiche)) return `<span class="pastille-partage" title="Fiche en lecture seule : vous pouvez la montrer à la TV">partagée par ${echapper(nomDeLAuteur(fiche))}</span>`;
  if (fiche?.partage === true && partagePossible()) return '<span class="pastille-partage a-moi" title="Vous partagez cette fiche">partagée</span>';
  return "";
}

export function htmlAvisLectureSeule(fiche, quoi = "Cette fiche") {
  return `<p class="avis-partage" role="note">${echapper(quoi)} est partagée par ${echapper(nomDeLAuteur(fiche))} : vous la lisez en entier et pouvez la montrer à la TV, mais seul son auteur la modifie.</p>`;
}

// Tous les champs de la zone passent en lecture seule ; ce qui est dans « sauf » (les boutons « Montrer à la TV ») reste.
export function figer(zone, sauf = ".tv-colle, .place-tv") {
  if (!zone) return;
  for (const el of zone.querySelectorAll("input, select, textarea, button")) {
    if (sauf && el.closest(sauf)) continue;
    if (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "file", "range"].includes(el.type))) el.readOnly = true;
    else el.disabled = true;
  }
  zone.classList.add("lecture-seule");
}
