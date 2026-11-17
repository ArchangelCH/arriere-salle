// La charte visuelle des portraits : les repères (peuples, Églises, ordres…) que l'atelier glisse dans la consigne d'un
// portrait dès qu'un de leurs mots apparaît dans la description. Un seul document pour tout l'atelier, ouvert dans une
// fenêtre par-dessus la fiche, enregistré à la frappe avec sa version (fusion repère par repère si un autre écran l'a
// changé entre-temps).

import { api, differer, echapper as e, enregistrerAvecVersion, toast } from "../api.js";
import { demander } from "../commun/dialogue.js";

const TYPES = [["peuple", "Peuple"], ["faction", "Église ou ordre"], ["lieu", "Lieu"], ["autre", "Autre"]];
const CADRAGES = [["", "Libre, tiré au sort"], ["buste", "Buste"], ["mi-corps", "Mi-corps"], ["trois-quarts", "Trois-quarts"]];
const options = (liste, valeur) => liste.map(([v, n]) => `<option value="${v}" ${v === valeur ? "selected" : ""}>${n}</option>`).join("");

function nouvelId(entrees) {
  const pris = new Set(entrees.map((x) => x.id));
  let id = "";
  while (!id || pris.has(id)) id = `r-${Math.random().toString(36).slice(2, 8)}`;
  return id;
}

class Charte {
  constructor() {
    this.doc = null;
    this.bases = {};
    this.ouverts = new Set();
    this.sauver = differer(() => this.enregistrer(), 700);
    this.chaine = Promise.resolve();
    this.d = document.createElement("dialog");
    this.d.className = "charte-dialogue";
    document.body.append(this.d);
    this.d.addEventListener("input", (ev) => this.saisie(ev.target));
    this.d.addEventListener("change", (ev) => this.saisie(ev.target, true));
    this.d.addEventListener("click", (ev) => this.clic(ev));
    this.d.addEventListener("toggle", (ev) => {
      const id = ev.target.dataset?.repere;
      if (id) ev.target.open ? this.ouverts.add(id) : this.ouverts.delete(id);
    }, true);
    this.d.addEventListener("close", () => this.sauver.vider());
  }

  async ouvrir() {
    this.sauver.vider();
    await this.chaine;
    try {
      this.doc = await api.get("/api/charte-visuelle");
      this.bases.c = JSON.parse(JSON.stringify(this.doc));
    } catch (err) {
      return toast(`Charte illisible : ${err.message}`, "erreur");
    }
    this.afficher();
    if (!this.d.open) this.d.showModal();
  }

  afficher() {
    const entrees = this.doc.entrees || [];
    const relire = entrees.filter((x) => x.a_valider).length;
    this.d.innerHTML = `
      <div class="charte-tete">
        <h2>Charte visuelle des portraits</h2>
        <button data-action="fermer">Fermer</button>
      </div>
      <p class="aide">Quand un mot d'un repère apparaît dans la description d'un personnage (« nain », « inquisiteur »…),
        l'atelier ajoute son allure, ses couleurs et ses interdits à la consigne du portrait, puis vérifie l'image peinte.
        ${relire ? `<b>${relire} repère${relire > 1 ? "s" : ""} à relire</b> : des propositions de l'atelier, quand la bible ne dit rien.` : ""}</p>
      <div class="charte-liste">${entrees.map((x) => this.htmlRepere(x)).join("")}</div>
      <div class="actions"><button data-action="ajouter">Ajouter un repère</button></div>`;
  }

  htmlRepere(x) {
    const champ = (cle, titre, aide = "") => `<label class="champ">${titre}<input type="text" data-champ="${cle}" value="${e(cle === "mots" ? (x.mots || []).join(", ") : x[cle])}" ${aide ? `placeholder="ex. ${e(aide)}"` : ""}></label>`;
    return `
      <details class="charte-repere" data-repere="${e(x.id)}" ${this.ouverts.has(x.id) ? "open" : ""}>
        <summary><b>${e(x.nom || "Sans nom")}</b> <small>${e(TYPES.find(([v]) => v === x.type)?.[1] || "")}</small>${x.a_valider ? `<span class="a-relire">À relire</span>` : ""}</summary>
        <div class="charte-champs">
          <div class="deux">${champ("nom", "Nom")}<label class="champ">Sorte<select data-champ="type">${options(TYPES, x.type)}</select></label></div>
          ${champ("mots", "Mots qui le déclenchent, séparés par des virgules", "nain, naine")}
          <label class="champ">Allure<textarea rows="3" data-champ="allure">${e(x.allure)}</textarea></label>
          ${champ("couleurs", "Couleurs de la tenue", "blanc, ivoire, or")}
          ${champ("interdits", "À ne jamais montrer", "rouge, cramoisi")}
          <div class="deux">
            ${champ("appuyer", "Mots anglais à appuyer (facultatif)", "dwarf, wearing a hood")}
            <label class="champ">Cadrage<select data-champ="cadrage">${options(CADRAGES, x.cadrage || "")}</select></label>
          </div>
          <div class="charte-pied">
            <label class="case"><input type="checkbox" data-champ="a_valider" ${x.a_valider ? "checked" : ""}> À relire</label>
            <button class="retirer" data-action="retirer" data-id="${e(x.id)}">Retirer</button>
          </div>
        </div>
      </details>`;
  }

  repere(el) {
    const id = el.closest("[data-repere]")?.dataset.repere;
    return (this.doc?.entrees || []).find((x) => x.id === id);
  }

  saisie(el, change = false) {
    const cle = el.dataset?.champ;
    const x = cle && this.repere(el);
    if (!x) return;
    if (cle === "a_valider") x.a_valider = el.checked;
    else if (cle === "mots") x.mots = el.value.split(",").map((m) => m.trim()).filter(Boolean);
    else x[cle] = el.value;
    if (cle === "nom" || cle === "type" || cle === "a_valider") {
      const resume = el.closest("details")?.querySelector("summary");
      if (resume && change) resume.outerHTML = this.htmlRepere(x).match(/<summary>[\s\S]*?<\/summary>/)[0];
    }
    this.sauver();
  }

  async clic(ev) {
    const b = ev.target.closest("button[data-action]");
    if (!b) return;
    ev.preventDefault();
    const a = b.dataset.action;
    if (a === "fermer") this.d.close();
    else if (a === "ajouter") {
      const x = { id: nouvelId(this.doc.entrees), type: "autre", nom: "", mots: [], allure: "", couleurs: "", interdits: "", appuyer: "", cadrage: "", a_valider: false };
      this.doc.entrees.push(x);
      this.ouverts.add(x.id);
      this.afficher();
      this.d.querySelector(`[data-repere="${x.id}"] [data-champ="nom"]`)?.focus();
      this.sauver();
    } else if (a === "retirer") {
      const x = this.doc.entrees.find((r) => r.id === b.dataset.id);
      if (!x || !(await demander({ titre: `Retirer « ${x.nom || "ce repère"} »`, texte: "Le repère quitte la charte visuelle : les prochains portraits ne le suivront plus.", oui: "Retirer le repère", danger: true }))) return;
      if (!this.doc.entrees.includes(x)) return;
      this.doc.entrees = this.doc.entrees.filter((r) => r !== x);
      this.afficher();
      this.sauver.maintenant();
    }
  }

  // Les enregistrements s'enchaînent : chacun part avec la version rendue par le précédent.
  enregistrer() {
    this.chaine = this.chaine.then(async () => {
      try {
        const fusion = await enregistrerAvecVersion("/api/charte-visuelle", this.doc, this.bases, "c", { listes: { entrees: "id" } });
        if (fusion) {
          this.afficher();
          toast("La charte avait changé sur un autre écran : les deux versions sont réunies.");
        }
      } catch (err) {
        toast(`Charte non enregistrée : ${err.message}`, "erreur");
      }
    });
    return this.chaine;
  }
}

let charte = null;

export function ouvrirCharte() {
  charte ||= new Charte();
  return charte.ouvrir();
}
