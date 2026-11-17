// Les dés du MJ (lot du 12/11, POST /api/jets/mj, jets_mj.py) : des dés libres (D4 à D100, 1 à 5 dés, un bonus) lancés
// depuis l'atelier, et le D100 d'un adversaire contre sa valeur d'attaque (combat compact). Les dés roulent sur le serveur.
// Le résultat revient toujours au MJ ; case « Montrer à la TV » cochée, le bandeau part aussi à la table (et à la table
// du coin des joueurs), sous le nom « Le MJ » ou celui de l'adversaire s'il ne nomme aucun secret des joueurs. La valeur
// visée ne sort jamais.
//
// Une seule section par page (LanceurMJ) : dans le Tableau, toujours visible ; sur la télécommande, repliée sous un titre.
// Le dernier résultat y reste affiché ; un lancer parti d'ailleurs (la ligne d'un adversaire) s'y affiche aussi.

import { api, echapper as e, toast } from "../api.js";
import { BONUS_MAX, FACES, NOMBRE_MAX, bornes, ecrire, lire } from "./des.js";
import { deux, facesDe, poserFeuilleJets } from "./jets.js";

const MONTRER = "des-mj.montrer"; // la case « Montrer à la TV », retenue sur ce navigateur
const abonnes = new Set();
let dernier = null;
let montrer = null; // la case, une fois touchée sur cette page (le stockage peut être refusé)

export function montrerALaTable() {
  if (montrer !== null) return montrer;
  try {
    return localStorage.getItem(MONTRER) === "oui";
  } catch {
    return false;
  }
}

function retenirMontrer(oui) {
  montrer = Boolean(oui);
  try {
    localStorage.setItem(MONTRER, oui ? "oui" : "non");
  } catch {
    // stockage refusé : la case vaut pour cette page seulement
  }
}

// « Gobelin 2, Attaque : 34 sur 55, réussite » ; des dés : « Le MJ, 2D6+1 : 9 ».
export function phraseDuResultat(r) {
  const qui = `${r.nom}${r.libelle ? `, ${r.libelle}` : ""}`;
  if (r.genre === "des") return `${qui}${r.libelle ? " " : ", "}${r.texte} : ${r.total}${r.des.length > 1 || r.bonus ? ` (${facesDe(r)})` : ""}`;
  return `${qui} : ${deux(r.de)} sur ${r.visee}, ${String(r.issue_nom).toLowerCase()}`;
}

// Lance, prévient les sections ouvertes, rend le résultat. corps : { des } ou { test: { valeur, libelle, nom } }, et nom.
export async function lancerDesMJ(corps, tv = montrerALaTable()) {
  const r = await api.post("/api/jets/mj", { ...corps, tv: Boolean(tv) });
  dernier = r;
  for (const f of abonnes) f(r);
  return r;
}

// Les deux boutons d'un adversaire du combat compact : son attaque (D100 contre a.att) et ses dégâts, s'ils se lisent.
export function htmlDesAdversaire(a) {
  const degats = lire(String(a.degats || ""));
  return `<span class="des-adversaire" role="group" aria-label="Les dés de cet adversaire">
            <button type="button" data-action="de-attaque" data-id="${e(a.id)}" title="Lance son attaque : D100 contre ${+a.att || 0} %">Attaque</button>
            ${degats ? `<button type="button" data-action="de-degats" data-id="${e(a.id)}" title="Lance ses dégâts : ${e(degats.texte)}">Dégâts</button>` : ""}
          </span>`;
}

export async function lancerPourAdversaire(a, nom, quoi) {
  const degats = lire(String(a.degats || ""));
  const corps = quoi === "degats" && degats ? { des: degats.texte, libelle: "Dégâts", nom }
    : { test: { valeur: Math.max(0, Math.min(999, Math.round(+a.att || 0))), libelle: "Attaque", nom } };
  const r = await lancerDesMJ(corps);
  toast(`${phraseDuResultat(r)}${r.tv ? " (montré à la table)" : ""}`);
  return r;
}

export class LanceurMJ {
  // replie : sur la télécommande, la section tient sous un titre qu'on touche.
  // touches : sur la télécommande, les boutons prennent la classe de ses touches.
  constructor(parent, { classe = "des-mj", replie = false, avant = null, touches = false } = {}) {
    this.touche = touches ? "touche" : "";
    poserFeuilleJets();
    this.faces = 6;
    this.nombre = 1;
    this.bonus = 0;
    this.occupe = false;
    this.erreur = "";
    this.zone = document.createElement(replie ? "details" : "section");
    this.zone.className = classe;
    this.zone.setAttribute("aria-label", "Dés du MJ");
    if (avant) avant.after(this.zone);
    else parent.append(this.zone);
    this.replie = replie;
    this.zone.addEventListener("click", (ev) => this.clic(ev));
    this.zone.addEventListener("change", (ev) => {
      if (ev.target.dataset.desMj === "montrer") retenirMontrer(ev.target.checked);
    });
    this.suivre = () => this.dessiner();
    abonnes.add(this.suivre);
    this.dessiner();
  }

  detruire() {
    abonnes.delete(this.suivre);
    this.zone.remove();
  }

  // L'interface des aides du Tableau.
  ouvrir() {}
  fermer() {}
  recu() {}

  htmlResultat() {
    const r = dernier;
    if (!r) return '<p class="des-mj-resultat vide">Rien de lancé pour l\'instant.</p>';
    const tete = `<span class="quoi"><b>${e(r.nom)}</b>${r.libelle ? `, ${e(r.libelle)}` : ""}${r.genre === "des" ? ` <span class="expr">${e(r.texte)}</span>` : ""}</span>`;
    const corps = r.genre === "des"
      ? `<span class="de">${e(r.total)}</span><span class="detail">${r.des.length > 1 || r.bonus ? e(facesDe(r)) : "Total"}</span>`
      : `<span class="de">${e(deux(r.de))}</span><span class="detail">${e(r.issue_nom)} <small>sur ${e(r.visee)}</small></span>`;
    const table = r.tv ? `Montré à la table${r.nom_montre && r.nom_montre !== r.nom ? ` sous le nom « ${e(r.nom_montre)} »` : ""}.` : "Pour vous seulement.";
    return `<p class="des-mj-resultat" data-issue="${e(r.issue || "")}" role="status">${tete}${corps}<small class="ou">${table}</small></p>`;
  }

  dessiner() {
    const expr = ecrire(this.nombre, this.faces, this.bonus);
    const b = bornes({ nombre: this.nombre, faces: this.faces, bonus: this.bonus });
    const ouvert = this.replie && this.zone.open;
    this.zone.innerHTML = `${this.replie ? "<summary>Dés du MJ</summary>" : "<h3>Dés du MJ</h3>"}
      <div class="des-mj-faces" role="group" aria-label="Quel dé">${FACES.map((f) => `<button type="button" class="${this.touche}" data-des-faces="${f}" aria-pressed="${f === this.faces}">D${f}</button>`).join("")}</div>
      <div class="des-mj-reglages">
        <span class="mod" role="group" aria-label="Nombre de dés"><button type="button" class="${this.touche}" data-des-nombre="-1" aria-label="Un dé de moins"${this.nombre <= 1 ? " disabled" : ""}>−</button><output>${this.nombre}</output><button type="button" class="${this.touche}" data-des-nombre="1" aria-label="Un dé de plus"${this.nombre >= NOMBRE_MAX ? " disabled" : ""}>+</button><small>dés</small></span>
        <span class="mod" role="group" aria-label="Bonus"><button type="button" class="${this.touche}" data-des-bonus="-1" aria-label="Bonus moins un"${this.bonus <= -BONUS_MAX ? " disabled" : ""}>−</button><output>${this.bonus > 0 ? `+${this.bonus}` : this.bonus < 0 ? `−${-this.bonus}` : "0"}</output><button type="button" class="${this.touche}" data-des-bonus="1" aria-label="Bonus plus un"${this.bonus >= BONUS_MAX ? " disabled" : ""}>+</button><small>bonus</small></span>
      </div>
      <div class="des-mj-lancer">
        <button type="button" class="${this.touche ? "touche principale" : "principal"}" data-des-mj="lancer"${this.occupe ? ' aria-busy="true"' : ""}>Lancer ${e(expr)} <small>de ${b.min} à ${b.max}</small></button>
        <label class="des-mj-montrer"><input type="checkbox" data-des-mj="montrer"${montrerALaTable() ? " checked" : ""}> Montrer à la TV</label>
      </div>
      ${this.erreur ? `<p class="des-mj-erreur" role="alert">${e(this.erreur)}</p>` : ""}
      ${this.htmlResultat()}`;
    if (ouvert) this.zone.open = true;
  }

  // Le bouton touché au clavier garde le focus après le redessin.
  redessiner(b) {
    const cle = ["desFaces", "desNombre", "desBonus", "desMj"].find((k) => b.dataset[k] !== undefined);
    const garde = document.activeElement === b && cle;
    this.dessiner();
    if (garde) {
      const attribut = `data-${cle.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
      const suivant = this.zone.querySelector(`[${attribut}="${b.dataset[cle]}"]`);
      if (suivant && !suivant.disabled) suivant.focus({ preventScroll: true });
    }
  }

  async clic(ev) {
    const b = ev.target.closest("button");
    if (!b || b.disabled || this.occupe) return;
    if (ev.detail) b.blur();
    const d = b.dataset;
    if (d.desFaces) this.faces = Number(d.desFaces);
    else if (d.desNombre) this.nombre = Math.max(1, Math.min(NOMBRE_MAX, this.nombre + Number(d.desNombre)));
    else if (d.desBonus) this.bonus = Math.max(-BONUS_MAX, Math.min(BONUS_MAX, this.bonus + Number(d.desBonus)));
    else if (d.desMj === "lancer") {
      this.occupe = true;
      this.erreur = "";
      try {
        await lancerDesMJ({ des: ecrire(this.nombre, this.faces, this.bonus) });
      } catch (err) {
        this.erreur = err.message;
      } finally {
        this.occupe = false;
      }
    } else return;
    this.redessiner(b);
  }
}
