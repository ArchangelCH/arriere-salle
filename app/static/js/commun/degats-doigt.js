// Au doigt (iPad, téléphone), toucher le chiffre de Santé d'un héros ou d'un adversaire ouvre une rangée −1, −2, −3, −5,
// +1, +3 juste dessous. Le coup choisi passe par la case de saisie de la ligne, comme « -3 » puis Entrée : La compagnie,
// la page du combat et le Tableau le traitent comme d'habitude (rappels du kit, coma, repère de mort, enregistrement),
// sans ouvrir le clavier, où le signe moins demande de changer de clavier. Au clavier et à la souris, rien ne change.
// Une rangée à la fois ; un coup, un toucher ailleurs, un défilement ou Échap la referment.

import { echapper as e } from "../api.js";

const PAS = [-1, -2, -3, -5, 1, 3];
const DOIGT = matchMedia("(pointer: coarse)");
const CHIFFRES = ".sante-combat, .tc-jauge.sante output";

let rangee = null;
let champ = null;
let dansTableau = false;

// La case de saisie de la Santé qui va avec ce chiffre : dans sa jauge (Tableau), ou juste après lui sur la ligne (la
// compagnie, la page du combat). Rien pendant un combat dans La compagnie : la Santé s'y suit dans le combat.
export function caseDeSante(chiffre) {
  const jauge = chiffre.closest(".tc-jauge.sante");
  if (jauge) return jauge.querySelector("input.saisie");
  const suivant = chiffre.closest(".sante-combat")?.nextElementSibling;
  return suivant?.matches("input.saisie") ? suivant : null;
}

// « Santé de Tavarède Lavelle : -4, +3 ou =7 » : le nom, pour la rangée.
const qui = (c) => (c.getAttribute("aria-label") || "").split(" :")[0].replace(/^Santé de /, "") || "";

// La case, ou celle qui l'a remplacée si la ligne s'est redessinée entre-temps (même libellé, même panneau).
function retrouver(c, tableau) {
  if (!c || c.isConnected) return c;
  const ou = document.querySelector(tableau ? ".tableau-mj" : "#page");
  const libelle = c.getAttribute("aria-label");
  return (libelle && [...(ou?.querySelectorAll("input.saisie") || [])].find((x) => x.getAttribute("aria-label") === libelle)) || null;
}

export function fermerRangee() {
  rangee?.remove();
  rangee = null;
  champ = null;
}

function ouvrirRangee(chiffre, saisie) {
  fermerRangee();
  champ = saisie;
  dansTableau = !!saisie.closest(".tableau-mj");
  const nom = qui(saisie);
  rangee = document.createElement("div");
  rangee.className = "rangee-degats";
  rangee.setAttribute("role", "group");
  rangee.setAttribute("aria-label", nom ? `Santé de ${nom}` : "Santé");
  rangee.innerHTML = PAS.map((n) => {
    const texte = `${n < 0 ? "−" : "+"}${Math.abs(n)}`;
    const titre = n < 0 ? `Retirer ${-n} Santé` : `Rendre ${n} Santé`;
    return `<button type="button" data-pas="${n}" class="${n < 0 ? "coup" : "soin"}" title="${e(nom ? `${titre} à ${nom}` : titre)}">${texte}</button>`;
  }).join("");
  document.body.append(rangee);
  // Sous le chiffre, centrée sur lui et tenue dans l'écran ; au-dessus s'il n'y a pas la place dessous.
  const r = chiffre.getBoundingClientRect();
  const l = rangee.offsetWidth;
  const h = rangee.offsetHeight;
  const gauche = Math.max(8, Math.min(innerWidth - l - 8, r.left + r.width / 2 - l / 2));
  const haut = r.bottom + 6 + h <= innerHeight - 8 ? r.bottom + 6 : Math.max(8, r.top - 6 - h);
  rangee.style.left = `${Math.round(gauche)}px`;
  rangee.style.top = `${Math.round(haut)}px`;
  rangee.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-pas]");
    if (!b) return;
    const c = retrouver(champ, dansTableau);
    fermerRangee();
    if (!c) return;
    // La même saisie qu'au clavier : la page lit la case à son changement, puis la vide.
    const n = +b.dataset.pas;
    c.value = n < 0 ? String(n) : `+${n}`;
    c.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

let installee = false;

export function installerRangeeDegats() {
  if (installee) return;
  installee = true;
  document.addEventListener("click", (ev) => {
    if (!DOIGT.matches || !(ev.target instanceof Element)) return;
    if (rangee?.contains(ev.target)) return;
    const chiffre = ev.target.closest(CHIFFRES);
    const saisie = chiffre && caseDeSante(chiffre);
    if (!saisie || saisie.disabled) return fermerRangee();
    if (champ === saisie) return fermerRangee();
    ev.preventDefault();
    ouvrirRangee(chiffre, saisie);
  });
  // Toucher ailleurs, faire défiler, changer de page ou de taille : la rangée se referme.
  document.addEventListener("pointerdown", (ev) => {
    if (rangee && !rangee.contains(ev.target) && !(ev.target instanceof Element && ev.target.closest(CHIFFRES))) fermerRangee();
  }, true);
  document.addEventListener("scroll", () => rangee && fermerRangee(), true);
  window.addEventListener("resize", () => rangee && fermerRangee());
  window.addEventListener("hashchange", fermerRangee);
  // Échap la ferme d'abord, avant le Tableau (echap.js écoute sur le document, la fenêtre l'entend avant).
  window.addEventListener("keydown", (ev) => {
    if (!rangee || ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    fermerRangee();
  }, true);
}
