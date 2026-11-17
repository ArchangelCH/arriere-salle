// Les idées de campagne, notées au fil de l'eau : un texte, des #mots-clés, un état. Sous chaque idée, ce que la
// série en dit (recherche dans la bible) et, une fois demandée, la note « au regard du canon ».

import { api, echapper as e, toast } from "../api.js";
import { annoncerCorbeille } from "../corbeille/corbeille.js";
import { markdown } from "../bible/bible.js";
import { lier as lierSquelette, panneau as panneauSquelette } from "./squelette.js";

export const ETATS = { "a-creuser": "À creuser", retenue: "Retenue", ecartee: "Écartée" };
const VERDICTS = {
  conforme: "Conforme au canon",
  "non-dit": "Non-dit : champ libre",
  flottement: "Flottement de la série",
  ecart: "Écart au canon",
  "a-verifier": "À vérifier",
};
const MOT_CLE = /#([\p{L}\p{N}][\p{L}\p{N}_'’-]*)/gu;

const plier = (t) => (t || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function motsCles(texte) {
  const vus = new Map();
  for (const [, mot] of (texte || "").matchAll(MOT_CLE)) {
    const propre = mot.replace(/['’-]+$/, "");
    if (propre && !vus.has(plier(propre))) vus.set(plier(propre), propre);
  }
  return [...vus.values()];
}

// Le nom sert seulement à fabriquer un identifiant lisible (le fichier de l'idée) : ses premiers mots, sans les #.
const nomDe = (texte) => texte.replace(MOT_CLE, "$1").split(/\s+/).filter(Boolean).slice(0, 6).join(" ").slice(0, 60);

export async function noterIdee(texte) {
  const propre = texte.trim();
  if (!propre) return null;
  const idee = await api.post("/api/idees", { nom: nomDe(propre), texte: propre, mots: motsCles(propre), etat: "a-creuser", texte_modifie: new Date().toISOString() });
  window.dispatchEvent(new CustomEvent("idee-notee", { detail: idee }));
  return idee;
}

// Le bouton « Idée » de l'en-tête : noter sans quitter la page en cours.
let dialogue = null;
export function ouvrirNoteRapide() {
  if (!dialogue) {
    dialogue = document.createElement("dialog");
    dialogue.className = "dialogue note-rapide";
    dialogue.innerHTML = `
      <form method="dialog">
        <h2>Noter une idée</h2>
        <textarea name="texte" rows="5" required placeholder="Un nom, une scène, une question… et des #mots-clés pour la retrouver"></textarea>
        <p class="aide">Elle rejoint l'onglet Idées. Ctrl+Entrée pour noter.</p>
        <div class="actions">
          <button value="annuler" formnovalidate>Annuler</button>
          <button class="principal" value="noter">Noter</button>
        </div>
      </form>`;
    document.body.append(dialogue);
    const zone = dialogue.querySelector("textarea");
    zone.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        dialogue.querySelector('button[value="noter"]').click();
      }
    });
    dialogue.addEventListener("close", async () => {
      if (dialogue.returnValue !== "noter" || !zone.value.trim()) return;
      const texte = zone.value;
      try {
        const idee = await noterIdee(texte);
        zone.value = "";
        // « Voir » mène à l'idée dans l'onglet Idées, mise en lumière un instant.
        toast("Idée notée.", "info", { action: { libelle: "Voir", faire: () => { location.hash = `#/idees?idee=${encodeURIComponent(idee.id)}`; } } });
      } catch (err) {
        zone.value = texte;
        toast(`Idée non enregistrée : ${err.message}`, "erreur");
        dialogue.showModal();
      }
    });
  }
  dialogue.returnValue = "";
  dialogue.showModal();
  dialogue.querySelector("textarea").focus();
}

function dateCourte(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-CH", { day: "numeric", month: "short" })} à ${d.toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" })}`;
}

// Le texte d'une idée, échappé, avec ses #mots-clés rendus cliquables. Les mots-clés se cherchent sur le texte brut,
// puis chaque morceau s'échappe : une apostrophe échappée (« &#39; ») ne fait pas un faux mot-clé « #39 ».
function texteIdee(texte) {
  let html = "";
  let fin = 0;
  for (const m of texte.matchAll(MOT_CLE)) {
    html += `${e(texte.slice(fin, m.index))}<button type="button" class="mot" data-mot="${e(m[1].replace(/['’-]+$/, ""))}">${e(m[0])}</button>`;
    fin = m.index + m[0].length;
  }
  return html + e(texte.slice(fin));
}

// Ce qu'on cherche dans la bible pour une idée : ses mots-clés, sinon ses noms propres, sinon ses mots les plus longs.
function termes(idee) {
  if (idee.mots?.length) return idee.mots.slice(0, 4);
  const mots = (idee.texte || "").replace(MOT_CLE, " ").split(/[^\p{L}\p{N}'’-]+/u).filter((m) => m.length >= 4);
  const propres = mots.filter((m, i) => i > 0 && /^\p{Lu}/u.test(m));
  const choix = propres.length ? propres : [...mots].sort((a, b) => b.length - a.length);
  return [...new Set(choix)].slice(0, 3);
}

export class Idees {
  constructor(racine, { parametres } = {}) {
    this.racine = racine;
    this.parametres = parametres || new URLSearchParams();
    this.idees = [];
    this.ouvertes = new Set();
    // ?q=… : venu de « Chercher » (l'en-tête), l'onglet s'ouvre sur les idées qui répondent.
    this.filtre = { q: this.parametres.get("q") || "", etat: this.parametres.get("etat") || "", mot: this.parametres.get("mot") || "" };
    this.recharger = () => this.charger();
  }

  async demarrer() {
    this.racine.innerHTML = `<section class="page-liste idees"><div class="chargement">Ouverture du carnet…</div></section>`;
    await this.charger(true);
    window.addEventListener("idee-notee", this.recharger);
  }

  detruire() {
    this.detruit = true;
    window.removeEventListener("idee-notee", this.recharger);
  }

  vider() {}

  async charger(premiere = false) {
    let idees;
    try {
      idees = await api.get("/api/idees");
    } catch (err) {
      if (!this.detruit) this.racine.innerHTML = `<section class="page-liste"><p class="vide">Le carnet ne répond pas : ${e(err.message)}.</p></section>`;
      return;
    }
    if (this.detruit) return;
    this.idees = idees.sort((a, b) => (b.cree || "").localeCompare(a.cree || ""));
    if (premiere || !this.racine.querySelector(".liste-idees")) {
      this.racine.innerHTML = this.gabarit();
      this.lier();
    }
    this.afficher();
    const voulue = premiere && this.parametres.get("idee");
    const li = voulue ? [...this.racine.querySelectorAll(".liste-idees .idee")].find((x) => x.dataset.id === voulue) : null;
    if (li) {
      li.scrollIntoView({ block: "center" });
      li.classList.add("eclat");
    }
  }

  gabarit() {
    return `
      <section class="page-liste idees">
        <header class="titre-page">
          <p class="kicker">Au fil de l'eau</p>
          <h1>Idées</h1>
          <p class="chapo">Un nom, une scène, une question : notez-la, avec des #mots-clés pour la retrouver. « Que dit la série ? » cherche, dans la série, les #mots-clés de l'idée (pas les mots du texte) ; et quand vous le demandez, l'idée est confrontée au canon.</p>
        </header>
        <form class="noter">
          <textarea name="texte" rows="3" placeholder="Une idée, un nom, une question… puis des #mots-clés pour la retrouver"></textarea>
          <div class="noter-pied">
            <span class="aide">#mot-clé pour classer, Ctrl+Entrée pour noter</span>
            <button class="principal" type="submit">Noter</button>
          </div>
        </form>
        <div class="filtres">
          <input type="search" name="q" placeholder="Chercher dans les idées" value="${e(this.filtre.q)}">
          <select name="etat" aria-label="État">
            <option value="">Toutes</option>
            ${Object.entries(ETATS).map(([k, v]) => `<option value="${k}" ${this.filtre.etat === k ? "selected" : ""}>${v}${k === "a-creuser" ? "" : "s"}</option>`).join("")}
          </select>
        </div>
        <div class="nuage-mots" aria-label="Mots-clés"></div>
        <p class="compte-idees aide"></p>
        <ol class="liste-idees"></ol>
      </section>`;
  }

  lier() {
    const r = this.racine.querySelector(".idees");
    const form = r.querySelector("form.noter");
    const zone = form.querySelector("textarea");
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const texte = zone.value;
      if (!texte.trim()) return;
      zone.value = "";
      try {
        await noterIdee(texte);
      } catch (err) {
        zone.value = texte;
        toast(`Idée non enregistrée : ${err.message}`, "erreur");
      }
    });
    zone.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        form.requestSubmit();
      }
    });
    r.querySelector('input[name="q"]').addEventListener("input", (ev) => {
      this.filtre.q = ev.target.value;
      this.afficher();
    });
    r.querySelector('select[name="etat"]').addEventListener("change", (ev) => {
      this.filtre.etat = ev.target.value;
      this.afficher();
    });
    r.addEventListener("click", (ev) => this.clic(ev));
    r.addEventListener("change", (ev) => {
      const sel = ev.target.closest("select[data-etat]");
      if (sel) this.modifier(sel.dataset.etat, { etat: sel.value });
    });
  }

  // Chaque mot cherché, sans accents ni majuscules, dans l'idée ou dans l'avis du canon (comme « Chercher »).
  visibles() {
    const mots = plier(this.filtre.q).split(/\s+/).filter(Boolean);
    return this.idees.filter((i) =>
      (!this.filtre.etat || (i.etat || "a-creuser") === this.filtre.etat)
      && (!this.filtre.mot || (i.mots || []).some((m) => plier(m) === plier(this.filtre.mot)))
      && mots.every((m) => plier(i.texte).includes(m) || plier(i.canon?.texte).includes(m)));
  }

  afficher() {
    const r = this.racine.querySelector(".idees");
    if (!r) return;
    const compte = new Map();
    for (const i of this.idees) {
      for (const m of i.mots || []) {
        const k = plier(m);
        compte.set(k, { mot: compte.get(k)?.mot || m, n: (compte.get(k)?.n || 0) + 1 });
      }
    }
    const nuage = [...compte.values()].sort((a, b) => b.n - a.n || a.mot.localeCompare(b.mot, "fr"));
    r.querySelector(".nuage-mots").innerHTML = nuage.map(({ mot, n }) =>
      `<button type="button" class="mot" data-mot="${e(mot)}" aria-pressed="${plier(mot) === plier(this.filtre.mot)}">#${e(mot)} <span>${n}</span></button>`).join("");
    const liste = this.visibles();
    r.querySelector(".compte-idees").textContent = this.idees.length
      ? `${liste.length} idée${liste.length > 1 ? "s" : ""}${liste.length < this.idees.length ? ` sur ${this.idees.length}` : ""}${this.filtre.mot ? `, #${this.filtre.mot}` : ""}`
      : "";
    r.querySelector(".liste-idees").innerHTML = liste.length
      ? liste.map((i) => this.carte(i)).join("")
      : `<li class="vide">${this.idees.length ? "Aucune idée ne correspond." : "Aucune idée pour l'instant : la première s'écrit juste au-dessus, ou depuis le bouton « Idée » de l'en-tête, de n'importe quel onglet."}</li>`;
    // Un panneau de squelette ouvert le reste quand la liste se redessine (un filtre, un état changé).
    for (const li of r.querySelectorAll(".liste-idees .idee")) {
      const idee = this.ouvertes.has(li.dataset.id) && this.idees.find((i) => i.id === li.dataset.id);
      if (idee) this.monterSquelette(idee, li);
    }
  }

  carte(i) {
    const canon = i.canon?.texte ? `
      <div class="canon" data-verdict="${e(i.canon.verdict || "a-verifier")}">
        <p class="canon-titre">Au regard du canon <span class="verdict">${e(VERDICTS[i.canon.verdict] || "À vérifier")}</span></p>
        ${i.canon.date && i.texte_modifie && new Date(i.texte_modifie) > new Date(i.canon.date) ? `<p class="aide">Écrit avant la dernière modification de l'idée.</p>` : ""}
        <div class="md">${markdown(i.canon.texte)}</div>
      </div>` : "";
    return `
      <li class="idee" data-id="${e(i.id)}" data-etat="${e(i.etat || "a-creuser")}">
        <div class="idee-tete">
          <time datetime="${e(i.cree || "")}">${e(dateCourte(i.cree))}</time>
          <select data-etat="${e(i.id)}" aria-label="État de l'idée">
            ${Object.entries(ETATS).map(([k, v]) => `<option value="${k}" ${(i.etat || "a-creuser") === k ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </div>
        <p class="idee-texte">${texteIdee(i.texte || "")}</p>
        ${canon}
        <div class="serie" hidden></div>
        ${(i.squelettes || []).length ? `<p class="aide idee-squelettes-compte">${i.squelettes.length} squelette${i.squelettes.length > 1 ? "s" : ""} de scénario proposé${i.squelettes.length > 1 ? "s" : ""}.</p>` : ""}
        <div class="idee-squelette" hidden></div>
        <div class="idee-actions">
          <button type="button" data-squelette="${e(i.id)}" aria-expanded="false" title="Trois structures de scénario à partir de cette idée">Squelette</button>
          <button type="button" data-serie="${e(i.id)}">Que dit la série ?</button>
          <button type="button" data-modifier="${e(i.id)}">Modifier</button>
          <button type="button" class="lien-danger" data-supprimer="${e(i.id)}">Supprimer</button>
        </div>
      </li>`;
  }

  async clic(ev) {
    const cible = ev.target.closest("button");
    if (!cible) return;
    if (cible.dataset.mot !== undefined) {
      this.filtre.mot = plier(this.filtre.mot) === plier(cible.dataset.mot) ? "" : cible.dataset.mot;
      this.afficher();
      return;
    }
    const id = cible.dataset.squelette || cible.dataset.serie || cible.dataset.modifier || cible.dataset.supprimer || cible.dataset.enregistrer || cible.dataset.annuler;
    const idee = this.idees.find((i) => i.id === id);
    if (!idee) return;
    const carte = cible.closest(".idee");
    if (cible.dataset.squelette) this.squelette(idee, carte, cible);
    else if (cible.dataset.serie) await this.serie(idee, carte, cible);
    else if (cible.dataset.modifier) this.editer(idee, carte);
    else if (cible.dataset.annuler) this.afficher();
    else if (cible.dataset.enregistrer) {
      const texte = carte.querySelector("textarea").value.trim();
      if (texte && texte !== idee.texte) await this.modifier(id, { texte, mots: motsCles(texte), texte_modifie: new Date().toISOString() });
      else this.afficher();
    } else if (cible.dataset.supprimer) {
      try {
        await api.del(`/api/idees/${encodeURIComponent(id)}`);
        this.idees = this.idees.filter((i) => i.id !== id);
        this.afficher();
        annoncerCorbeille("Idée mise à la corbeille.", "idees", id, { retour: location.hash });
      } catch (err) {
        toast(`Suppression impossible : ${err.message}`, "erreur");
      }
    }
  }

  editer(idee, carte) {
    carte.querySelector(".idee-texte").outerHTML = `<textarea class="idee-edition" rows="4">${e(idee.texte || "")}</textarea>`;
    carte.querySelector(".idee-actions").innerHTML = `
      <button type="button" class="principal" data-enregistrer="${e(idee.id)}">Enregistrer</button>
      <button type="button" data-annuler="${e(idee.id)}">Annuler</button>`;
    const zone = carte.querySelector("textarea");
    zone.focus();
    zone.setSelectionRange(zone.value.length, zone.value.length);
  }

  async modifier(id, champs) {
    const idee = this.idees.find((i) => i.id === id);
    try {
      const maj = await api.patch(`/api/idees/${encodeURIComponent(id)}`, { ...champs, version_base: idee?.modifie });
      this.idees = this.idees.map((i) => (i.id === id ? maj : i));
      this.afficher();
    } catch (err) {
      if (err.status === 409) {
        toast("Cette idée a changé sur un autre écran : voici sa dernière version.", "erreur");
        await this.charger();
      } else toast(`Enregistrement impossible : ${err.message}`, "erreur");
    }
  }

  // Le squelette de scénario : le panneau s'ouvre sous l'idée et reste ouvert quand la liste se redessine (un squelette
  // reçu, retiré, ou créé en scénario) ; seule la ligne de compte et l'état de l'idée sont repris.
  squelette(idee, carte, bouton) {
    const zone = carte.querySelector(".idee-squelette");
    if (!zone.hidden) {
      zone.hidden = true;
      bouton.setAttribute("aria-expanded", "false");
      this.ouvertes.delete(idee.id);
      return;
    }
    this.ouvertes.add(idee.id);
    this.monterSquelette(idee, carte);
  }

  monterSquelette(idee, carte) {
    const zone = carte.querySelector(".idee-squelette");
    zone.hidden = false;
    carte.querySelector("[data-squelette]")?.setAttribute("aria-expanded", "true");
    zone.innerHTML = panneauSquelette(idee);
    lierSquelette(zone.querySelector(".squelettes"), idee, (maj) => {
      this.idees = this.idees.map((i) => (i.id === maj.id ? maj : i));
      const compte = carte.querySelector(".idee-squelettes-compte");
      const n = (maj.squelettes || []).length;
      if (compte) compte.textContent = n ? `${n} squelette${n > 1 ? "s" : ""} de scénario proposé${n > 1 ? "s" : ""}.` : "";
      carte.dataset.etat = maj.etat || "a-creuser";
      const sel = carte.querySelector("select[data-etat]");
      if (sel) sel.value = maj.etat || "a-creuser";
    });
  }

  // Pour chaque terme de l'idée : combien de passages la bible en a, et les deux premiers.
  async serie(idee, carte, bouton) {
    const zone = carte.querySelector(".serie");
    if (!zone.hidden) {
      zone.hidden = true;
      bouton.setAttribute("aria-expanded", "false");
      return;
    }
    zone.hidden = false;
    bouton.setAttribute("aria-expanded", "true");
    const liste = termes(idee);
    if (!liste.length) {
      zone.innerHTML = `<p class="aide">Ajoutez un #mot-clé pour chercher dans la bible.</p>`;
      return;
    }
    zone.innerHTML = `<p class="aide">Recherche dans la bible…</p>`;
    const reponses = await Promise.all(liste.map((t) => api.get(`/api/bible/recherche?q=${encodeURIComponent(t)}&limite=2`).then((r) => [t, r]).catch(() => [t, null])));
    if (this.detruit) return;
    zone.innerHTML = reponses.map(([t, r]) => {
      const lien = `#/bible?q=${encodeURIComponent(t)}`;
      if (!r) return `<p class="aide">${e(t)} : la bible ne répond pas.</p>`;
      if (!r.total) return `<p class="aide"><strong>${e(t)}</strong> : rien dans la série. Champ libre, ou autre graphie ?</p>`;
      return `
        <div class="serie-terme">
          <p><strong>${e(t)}</strong> : ${r.total} passage${r.total > 1 ? "s" : ""} <a href="${lien}">tout voir dans la bible</a></p>
          <ul>${r.resultats.slice(0, 2).map((x) => `<li><a href="#/bible?doc=${encodeURIComponent(x.chemin)}&q=${encodeURIComponent(t)}"><span class="rubrique">${e(x.titre)}</span></a> ${e(x.lignes[0] || "")}</li>`).join("")}</ul>
        </div>`;
    }).join("");
  }
}
