// Échap, partout pareil dans l'atelier :
// 1. dans un dialogue ouvert, il le ferme du premier coup, même depuis une recherche remplie (Chrome la viderait
//    d'abord, et il faudrait un second Échap) ;
// 2. dans un champ de saisie, il rend la main à la page : le champ perd le focus, rien d'autre ne bouge, et les lettres
//    redeviennent des touches (N, R, H…) ;
// 3. sinon, il ferme ce qui est ouvert par-dessus la page : un menu d'abord, puis le Tableau. Sur une carte ou un plan,
//    Échap lâche d'abord la sélection ou le tracé en cours (l'éditeur s'en charge) : le Tableau ne s'y ferme que si
//    c'est lui qu'on vient de toucher.
// Une lettre tapée dans un champ ne déclenche jamais de raccourci : champDeSaisie() sert aussi aux touches de l'atelier.

const NON_SAISIE = new Set(["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image", "hidden"]);

// Le champ où s'écrit ce qu'on tape (texte, nombre, liste, zone de texte), ou null : une case à cocher ou une
// réglette n'en sont pas, Échap y ferme directement le panneau.
export function champDeSaisie(el) {
  const champ = el instanceof Element ? el.closest("input, textarea, select, [contenteditable]") : null;
  if (!champ) return null;
  if (champ.isContentEditable === false && champ.matches("[contenteditable]")) return null;
  if (champ.tagName === "INPUT" && NON_SAISIE.has((champ.type || "").toLowerCase())) return null;
  return champ;
}

// Le dialogue du dessus : celui qui contient le focus, sinon le dernier ouvert.
export function dialogueOuvert(cible = null) {
  const ici = cible instanceof Element ? cible.closest("dialog[open]") : null;
  if (ici) return ici;
  const ouverts = document.querySelectorAll("dialog[open]");
  return ouverts.length ? ouverts[ouverts.length - 1] : null;
}

// Ferme un dialogue comme le ferait Échap : « cancel » d'abord (qui peut le retenir), puis « close ».
export function fermerDialogue(d) {
  if (typeof d.requestClose === "function") return d.requestClose();
  if (d.dispatchEvent(new Event("cancel", { cancelable: true }))) d.close();
}

const couches = [];
let tableauTouche = false;

// Une couche que ferme Échap : { nom, ouvert(), fermer(auClavier), garde?(ev) }. L'ordre d'inscription est l'ordre de
// fermeture : les menus avant le Tableau.
export function coucheEchap(couche) {
  couches.push(couche);
}

// Sur une carte ou un plan, Échap appartient d'abord à l'éditeur ; ailleurs, rien ne le réclame.
export const surUnEditeur = () => !!document.querySelector("#page .editeur");
export const tableauVientDEtreTouche = () => tableauTouche;
// La touche T qui ouvre le Tableau compte comme un geste vers lui : sur un plan, l'Échap qui suit le referme.
export const toucherLeTableau = () => {
  tableauTouche = true;
};

function touche(ev) {
  if (ev.key !== "Escape" || ev.isComposing || ev.defaultPrevented) return;
  const cible = ev.target instanceof Element ? ev.target : null;
  const champ = champDeSaisie(cible);
  const dialogue = dialogueOuvert(cible);
  if (dialogue) {
    // Une recherche remplie retiendrait Échap pour se vider : le dialogue se ferme tout de suite, comme avec Annuler.
    if (champ && dialogue.contains(champ) && champ.matches('input[type="search"]') && champ.value) {
      ev.preventDefault();
      fermerDialogue(dialogue);
    }
    return; // sinon, le navigateur ferme le dialogue de lui-même
  }
  if (champ) {
    // Rien d'autre : une recherche ne se vide pas, et le menu ou le Tableau qui contient le champ reste ouvert.
    ev.preventDefault();
    champ.blur();
    // Dans un éditeur, sa propre écoute (sur la fenêtre) voit encore la touche, partie d'un champ : elle la laisse.
    if (!cible.closest("#page .editeur")) ev.stopPropagation();
    return;
  }
  for (const c of couches) {
    if (!c.ouvert() || (c.garde && !c.garde(ev))) continue;
    ev.preventDefault();
    ev.stopPropagation();
    c.fermer(true);
    return;
  }
}

let installe = false;

export function installerEchap() {
  if (installe) return;
  installe = true;
  // À la capture, avant les écoutes des pages et des éditeurs : la couche fermée, la touche s'arrête là.
  document.addEventListener("keydown", touche, true);
  // Ce qu'on vient de toucher, le Tableau ou la page : sur une carte ou un plan, Échap ferme le Tableau seulement si
  // c'est lui.
  const noter = (ev) => {
    if (ev.target instanceof Element) tableauTouche = !!ev.target.closest(".tableau-mj, .ouvrir-tableau");
  };
  document.addEventListener("pointerdown", noter, true);
  document.addEventListener("focusin", noter, true);
}
