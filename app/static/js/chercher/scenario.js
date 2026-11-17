// « Chercher dans ce scénario », dans la barre du scénario, au-dessus de « Chercher dans la bible » : chaque passage de
// chaque chapitre où paraît la recherche (l'expression entière d'abord), avec son chapitre et son extrait ; un clic
// ouvre le chapitre et y choisit le passage, Entrée passe au suivant (Maj+Entrée au précédent ; en mode Écrire, le texte
// prend la main pour que le passage choisi se voie, et ⌘F ramène au champ). ⌘F (Ctrl+F) y mène
// depuis la page, puisque celui du navigateur ne voit que le chapitre ouvert ; un second ⌘F, dans le champ, laisse
// faire le navigateur. Une recherche venue de « Chercher » (l'en-tête) arrive par ?chercher=…&passage=…
// Côté MJ seulement : rien ne part vers la TV.

import { differer, echapper as e } from "../api.js";
import { dialogueOuvert } from "../commun/echap.js";
import { ligneLisible, passagesDuScenario, plierPareil } from "./moteur.js";

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

export class ChercherScenario {
  // page : la page du scénario (scenarios.js), qui sait ouvrir un chapitre et y choisir un passage (allerAuPassage).
  constructor(page) {
    this.page = page;
    this.bloc = page.r.querySelector(".chercher-ici");
    this.champ = this.bloc.querySelector("input");
    this.zone = this.bloc.querySelector(".resultats-ici");
    this.passages = [];
    this.actuel = -1;
    this.differe = differer(() => this.afficher(), 160);
    this.champ.addEventListener("input", () => {
      this.actuel = -1;
      this.differe();
    });
    this.champ.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.isComposing) {
        ev.preventDefault();
        this.differe.vider();
        if (this.passages.length) this.aller((this.actuel + (ev.shiftKey ? this.passages.length - 1 : 1)) % this.passages.length, this.page.mode === "ecrire");
      } else if (ev.key === "ArrowDown" && this.passages.length) {
        ev.preventDefault();
        this.zone.querySelector("[data-passage]")?.focus();
      }
    });
    this.zone.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-passage]");
      if (b) this.aller(+b.dataset.passage);
    });
    this.zone.addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
      const boutons = [...this.zone.querySelectorAll("[data-passage]")];
      const i = boutons.indexOf(document.activeElement);
      if (i < 0) return;
      ev.preventDefault();
      if (ev.key === "ArrowUp" && i === 0) this.champ.focus();
      else boutons[Math.max(0, Math.min(boutons.length - 1, i + (ev.key === "ArrowDown" ? 1 : -1)))].focus();
    });
    // Le texte change sous la recherche : les passages suivent.
    page.zone.addEventListener("input", () => {
      if (this.champ.value.trim()) this.differe();
    });
    this.surTouche = (ev) => this.cmdF(ev);
    document.addEventListener("keydown", this.surTouche);
  }

  cmdF(ev) {
    if (this.page.detruit || !this.bloc.isConnected) {
      document.removeEventListener("keydown", this.surTouche);
      return;
    }
    if (!(ev.metaKey || ev.ctrlKey) || ev.altKey || ev.shiftKey || (ev.key || "").toLowerCase() !== "f") return;
    // Le second ⌘F, ou sous un dialogue : la recherche du navigateur.
    if (document.activeElement === this.champ || dialogueOuvert()) return;
    ev.preventDefault();
    const z = this.page.zone;
    const d = this.dernier;
    // Le passage qu'on vient de trouver est encore choisi : la recherche reste, Entrée ira au suivant.
    const memePassage = d && d.chapitre === this.page.chap && z.selectionStart === d.debut && z.selectionEnd === d.fin;
    const choisi = document.activeElement === z && !memePassage ? z.value.slice(z.selectionStart, z.selectionEnd).trim() : "";
    if (choisi && choisi.length <= 80 && !choisi.includes("\n")) {
      this.champ.value = choisi;
      this.actuel = -1;
    }
    this.ouvrir();
  }

  ouvrir() {
    this.bloc.open = true;
    // Sur un écran étroit, la barre du scénario est un tiroir : il s'ouvre.
    const tiroir = this.page.r.querySelector(".ouvrir-sommaire");
    if (tiroir && getComputedStyle(tiroir).display !== "none") this.page.basculerSommaire(true);
    this.champ.focus();
    this.champ.select();
    this.afficher();
  }

  calculer() {
    this.passages = passagesDuScenario(this.page.s, this.champ.value.trim(), { max: 80 });
  }

  afficher() {
    const q = this.champ.value.trim();
    if (!q) {
      this.passages = [];
      this.zone.innerHTML = "";
      return;
    }
    this.calculer();
    if (!this.passages.length) {
      this.zone.innerHTML = '<p class="aide">Nulle part dans ce scénario. Une autre graphie, ou « Chercher dans la bible » ?</p>';
      return;
    }
    const chapitres = new Set(this.passages.map((p) => p.chapitre)).size;
    let dernier = null;
    const lignes = this.passages.map((p, i) => {
      const tete = p.chapitre !== dernier ? `<li class="chapitre-ici" aria-hidden="true">ch. ${p.numero} · ${e(p.titre)}</li>` : "";
      dernier = p.chapitre;
      return `${tete}<li><button type="button" class="passage" data-passage="${i}" aria-current="${i === this.actuel}" title="Chapitre ${p.numero}, « ${e(p.titre)} »">${p.html}</button></li>`;
    }).join("");
    this.zone.innerHTML = `<p class="aide">${pluriel(this.passages.length, "passage", "passages")}${chapitres > 1 ? `, dans ${chapitres} chapitres` : ""}${this.passages.length >= 80 ? " (les 80 premiers)" : ""}. Entrée : le suivant.</p><ol>${lignes}</ol>`;
  }

  // Le passage i : relu sur le texte du moment (il a pu changer), puis ouvert. focus : le texte prend la main (sauf en
  // Aperçu, où il est caché).
  aller(i, focus = this.page.mode !== "apercu") {
    this.calculer();
    const p = this.passages[i];
    if (!p) return this.afficher();
    this.actuel = i;
    this.dernier = { chapitre: p.chapitre, debut: p.debut, fin: p.fin };
    this.page.allerAuPassage(p.chapitre, p.debut, p.fin, { focus });
    this.afficher();
    this.zone.querySelector(`[data-passage="${i}"]`)?.scrollIntoView({ block: "nearest" });
  }

  // Depuis « Chercher » de l'en-tête : la recherche remplie, et le passage choisi dans le chapitre demandé.
  depuisLien() {
    const q = this.page.parametres.get("chercher");
    if (!q) return;
    this.champ.value = q;
    this.bloc.open = true;
    this.calculer();
    const n = Math.max(0, +this.page.parametres.get("passage") || 0);
    const dans = this.passages.filter((p) => p.chapitre === this.page.chap);
    const p = dans[n] || dans[0] || this.passages[0];
    if (p) this.aller(this.passages.indexOf(p));
    else this.afficher();
  }
}

// Le paragraphe de l'aperçu qui porte une position du texte : le plus petit dont les lettres contiennent celles de sa
// ligne, telle qu'on la lit (liens réduits à leur libellé, sans marques).
export function blocDuTexte(racine, texte, pos) {
  const debut = texte.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
  const fin = texte.indexOf("\n", pos);
  const lettres = (t) => plierPareil(t).replace(/[^\p{L}\p{N}]+/gu, "");
  const cherche = lettres(ligneLisible(texte.slice(debut, fin < 0 ? texte.length : fin))).slice(0, 90);
  if (!cherche || !racine) return null;
  let meilleur = null;
  for (const el of racine.querySelectorAll("p, li, blockquote, h1, h2, h3, h4, h5, tr, td, th, aside, .consigne")) {
    const t = lettres(el.textContent);
    if (t.includes(cherche) && (!meilleur || t.length < meilleur.n)) meilleur = { el, n: t.length };
  }
  return meilleur?.el || null;
}
