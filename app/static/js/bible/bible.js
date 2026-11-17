// La bible de la campagne : recherche dans toutes les fiches d'épisode, lecture des synthèses et de la bible thématique.
// Chaque fait renvoie à la minute de la vidéo où il est dit. Rien ne part vers la TV. Le coin des joueurs sert ce module
// tel quel (joueurs/bible-coin.js), sur la copie que l'atelier publie pour eux : la liste blanche de bible.py, masquée.

import { api, echapper as e } from "../api.js";

// Le texte ramené sans accents ni majuscules, avec pour chaque caractère obtenu la place du caractère d'origine :
// « œ » donne deux lettres, « … » en donne trois, le surlignage doit pourtant tomber juste.
function plier(texte) {
  let plie = "";
  const debuts = [];
  const fins = [];
  let i = 0;
  for (const c of texte) {
    const f = /[œŒ]/.test(c) ? "oe" : /[æÆ]/.test(c) ? "ae" : c.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (let k = 0; k < f.length; k++) {
      debuts.push(i);
      fins.push(i + c.length);
    }
    plie += f;
    i += c.length;
  }
  return { plie, debuts, fins };
}

// Les mots d'une recherche, comme le serveur les lit : lettres et chiffres, deux au moins, six mots au plus.
const motsDe = (q) => [...new Set(plier(q).plie.match(/[a-z0-9]+/g) || [])].filter((m) => m.length >= 2).slice(0, 6);

function marquer(texte, mots) {
  const { plie, debuts, fins } = plier(texte);
  const zones = [];
  for (const m of mots) {
    for (let i = plie.indexOf(m); i >= 0; i = plie.indexOf(m, i + m.length)) zones.push([debuts[i], fins[i + m.length - 1]]);
  }
  if (!zones.length) return texte;
  zones.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let sortie = "";
  let pos = 0;
  for (const [d, f] of zones) {
    if (d < pos) continue;
    sortie += `${texte.slice(pos, d)}<mark>${texte.slice(d, f)}</mark>`;
    pos = f;
  }
  return sortie + texte.slice(pos);
}

// Surligne les mots dans du HTML déjà échappé : seulement le texte, jamais les balises ni les entités.
function surligner(html, mots) {
  if (!mots.length) return html;
  return html.replace(/[^<>]+(?=<|$)/g, (bloc) => bloc.split(/(&[#a-z0-9]+;)/i).map((m, n) => (n % 2 ? m : marquer(m, mots))).join(""));
}

// Le paragraphe du document qui porte un extrait de la recherche : le plus petit dont les lettres contiennent celles de
// l'extrait (sans ses « … », ni les adresses, que la page écrit autrement). Un extrait trop long se cherche par un bout.
function blocDeLExtrait(zone, ligne) {
  const lettres = (t) => plier(String(t).replace(/https?:\/\/\S+|youtu\.be\/\S+/g, "")).plie.replace(/[^a-z0-9]+/g, "");
  const tout = lettres(String(ligne || "").replace(/^…\s*|\s*…$/g, ""));
  if (!tout) return null;
  for (const cherche of [tout, tout.slice(0, 60), tout.slice(-60)]) {
    let meilleur = null;
    for (const el of zone.querySelectorAll("p, li, blockquote, td, th, tr, h1, h2, h3, h4")) {
      const t = lettres(el.textContent);
      if (t.includes(cherche) && (!meilleur || t.length < meilleur.n)) meilleur = { el, n: t.length };
    }
    if (meilleur) return meilleur.el;
  }
  return null;
}

// Un lien relatif vers une autre fiche de la bible (« ../episodes/saison-1/001-x.md ») s'ouvre dans la bible.
function resoudre(dossier, relatif) {
  const morceaux = dossier ? dossier.split("/") : [];
  for (const m of relatif.split("#")[0].split("/")) {
    if (m === "..") {
      if (!morceaux.length) return null;
      morceaux.pop();
    } else if (m && m !== ".") morceaux.push(m);
  }
  const chemin = morceaux.join("/");
  return /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.md$/.test(chemin) ? chemin : null;
}

function lien(url, libelle, dossier) {
  if (/^https?:\/\//.test(url)) return `<a href="${url}" target="_blank" rel="noopener">${libelle}</a>`;
  const chemin = resoudre(dossier, url);
  return chemin ? `<a href="#" data-doc="${chemin}">${libelle}</a>` : libelle;
}

// Le texte d'une ligne Markdown : liens (vidéos dans un nouvel onglet, fiches dans la bible), gras, italique, code.
// Dans une fiche d'épisode, un horodatage nu « [00:21:01] » mène à cet instant de sa vidéo.
function enLigne(texte, refs = {}, dossier = "", video = "") {
  let t = e(texte);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, lib, url) => lien(url, lib, dossier));
  t = t.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (tout, lib, ref) => {
    const url = refs[(ref || lib).toLowerCase()];
    return url ? lien(e(url), lib, dossier) : tout;
  });
  if (video) {
    t = t.replace(/\[(\d{1,2}):(\d{2}):(\d{2})\](?!\()/g, (_, h, m, s) =>
      `<a href="https://youtu.be/${video}?t=${h * 3600 + m * 60 + +s}" target="_blank" rel="noopener">${h}:${m}:${s}</a>`);
  }
  t = t.replace(/(^|[\s(])(https:\/\/youtu\.be\/[A-Za-z0-9_-]+(?:\?t=\d+)?)/g, (_, av, url) => `${av}<a href="${url}" target="_blank" rel="noopener">${url.replace("https://", "")}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  return t;
}

// Markdown réduit à ce que la bible utilise : titres, paragraphes, listes, citations, tableaux, filets, renvois.
export function markdown(texte, dossier = "", video = "") {
  const refs = {};
  const lignes = [];
  for (const l of texte.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    const renvoi = /^\s{0,3}\[([^\]]+)\]:\s+(\S+)/.exec(l);
    if (renvoi) refs[renvoi[1].toLowerCase()] = renvoi[2];
    else lignes.push(l);
  }
  const ligne = (t) => enLigne(t, refs, dossier, video);
  const sortie = [];
  let para = [];
  let liste = null;
  const fermerPara = () => {
    if (para.length) sortie.push(`<p>${para.map(ligne).join(" ")}</p>`);
    para = [];
  };
  const fermerListe = () => {
    if (liste) sortie.push(`<${liste.genre}>${liste.items.map((i) => `<li>${ligne(i)}</li>`).join("")}</${liste.genre}>`);
    liste = null;
  };
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];
    const titre = /^(#{1,4})\s+(.*)$/.exec(l);
    const puce = /^\s*[-*]\s+(.*)$/.exec(l);
    const numero = /^\s*\d+[.)]\s+(.*)$/.exec(l);
    if (titre) {
      fermerPara();
      fermerListe();
      const n = titre[1].length;
      sortie.push(`<h${n}>${ligne(titre[2])}</h${n}>`);
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) {
      fermerPara();
      fermerListe();
      sortie.push("<hr>");
    } else if (/^\s*\|.*\|\s*$/.test(l)) {
      fermerPara();
      fermerListe();
      const rangs = [];
      while (i < lignes.length && /^\s*\|.*\|\s*$/.test(lignes[i])) rangs.push(lignes[i++]);
      i--;
      const cellules = (r) => r.trim().slice(1, -1).split("|").map((c) => c.trim());
      const [tete, ...reste] = rangs.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      sortie.push(`<table><thead><tr>${cellules(tete).map((c) => `<th>${ligne(c)}</th>`).join("")}</tr></thead><tbody>${reste
        .map((r) => `<tr>${cellules(r).map((c) => `<td>${ligne(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
    } else if (puce || numero) {
      fermerPara();
      const genre = puce ? "ul" : "ol";
      if (liste && liste.genre !== genre) fermerListe();
      liste ||= { genre, items: [] };
      liste.items.push((puce || numero)[1]);
    } else if (/^>\s?/.test(l)) {
      fermerPara();
      fermerListe();
      sortie.push(`<blockquote>${ligne(l.replace(/^>\s?/, ""))}</blockquote>`);
    } else if (!l.trim()) {
      fermerPara();
      fermerListe();
    } else if (liste && /^\s{2,}\S/.test(l)) {
      liste.items[liste.items.length - 1] += ` ${l.trim()}`;
    } else {
      fermerListe();
      para.push(l.trim());
    }
  }
  fermerPara();
  fermerListe();
  return sortie.join("\n");
}

export class Bible {
  constructor(racine, { parametres, index }) {
    this.racine = racine;
    this.parametres = parametres || new URLSearchParams();
    // Le sommaire déjà lu par la page qui monte la bible (le coin des joueurs, qui doit d'abord savoir si elle est ouverte).
    this.sommaire = index;
    this.requete = 0;
  }

  async demarrer() {
    this.racine.innerHTML = `<section class="bible"><div class="chargement">Ouverture de la bible…</div></section>`;
    let index;
    try {
      index = this.sommaire || (await api.get("/api/bible"));
    } catch (err) {
      if (!this.detruit) this.racine.innerHTML = `<section class="page-liste"><p class="vide">La bible ne répond pas : ${e(err.message)}.</p></section>`;
      return;
    }
    if (this.detruit) return;
    this.index = index;
    this.racine.innerHTML = this.gabarit();
    this.lier();
    const q = this.parametres.get("q") || "";
    let doc = this.parametres.get("doc");
    // Un extrait choisi ailleurs (le scénario, « Chercher ») : le document s'ouvre à ce passage.
    const passage = this.parametres.get("passage");
    if (q) {
      this.racine.querySelector(".bible-recherche").value = q;
      const r = await this.chercher(q);
      if (this.detruit) return;
      doc ||= r?.resultats[0]?.chemin;
    }
    doc ||= this.index.documents[0]?.chemin;
    if (doc) this.ouvrir(doc, q, false, passage);
  }

  detruire() {
    this.detruit = true;
    clearTimeout(this.minuterie);
  }

  vider() {}

  gabarit() {
    const parRubrique = {};
    for (const d of this.index.documents) (parRubrique[d.rubrique] ||= []).push(d);
    return `
      <section class="bible">
        <aside class="bible-nav">
          <header>
            <p class="kicker">Le canon</p>
            <h1>La bible</h1>
            <input type="search" class="bible-recherche" placeholder="Chercher un nom, un lieu, un objet…" aria-label="Chercher dans la bible">
            <p class="aide">Toutes les fiches d'épisode, une par une. Chaque fait renvoie à la minute de la vidéo.</p>
          </header>
          <div class="bible-resultats" aria-live="polite"></div>
          <nav class="bible-docs">
            ${Object.entries(parRubrique).map(([rubrique, docs]) => `
              <h2>${e(rubrique)}</h2>
              <ul>${docs.map((d) => `<li><a href="#" data-doc="${e(d.chemin)}">${e(d.titre)}</a></li>`).join("")}</ul>`).join("")}
            <h2>Fiches d'épisode</h2>
            ${this.index.episodes.map((g) => `
              <details>
                <summary>${e(g.nom)} <span class="compte">${g.fiches.length}</span></summary>
                <ul>${g.fiches.map((f) => `<li><a href="#" data-doc="${e(f.chemin)}">${e(f.titre)}</a></li>`).join("")}</ul>
              </details>`).join("")}
          </nav>
        </aside>
        <article class="bible-doc"></article>
      </section>`;
  }

  lier() {
    const r = this.racine.querySelector(".bible");
    r.querySelector(".bible-recherche").addEventListener("input", (ev) => {
      clearTimeout(this.minuterie);
      this.minuterie = setTimeout(() => this.chercher(ev.target.value.trim()), 250);
    });
    r.addEventListener("click", (ev) => {
      const lien = ev.target.closest("[data-doc]");
      if (!lien) return;
      ev.preventDefault();
      this.ouvrir(lien.dataset.doc, this.racine.querySelector(".bible-recherche").value.trim(), true, lien.dataset.passage);
    });
  }

  memoriser(cle, valeur) {
    const p = new URLSearchParams(location.hash.split("?")[1] || "");
    if (valeur) p.set(cle, valeur);
    else p.delete(cle);
    const suite = p.toString();
    history.replaceState(null, "", `#/bible${suite ? `?${suite}` : ""}`);
  }

  async chercher(q) {
    const zone = this.racine.querySelector(".bible-resultats");
    const n = ++this.requete;
    this.memoriser("q", q);
    const mots = motsDe(q);
    if (!mots.length) {
      zone.innerHTML = "";
      return null;
    }
    zone.innerHTML = `<p class="aide">Recherche…</p>`;
    let r;
    try {
      r = await api.get(`/api/bible/recherche?q=${encodeURIComponent(q)}`);
    } catch (err) {
      if (n === this.requete && !this.detruit) zone.innerHTML = `<p class="alerte">Recherche impossible : ${e(err.message)}</p>`;
      return null;
    }
    if (n !== this.requete || this.detruit) return null;
    this.resultats = r.resultats;
    // Chaque extrait s'ouvre à son passage, là où l'œil se pose ; le titre, à la première occurrence.
    zone.innerHTML = r.resultats.length
      ? `<p class="aide">${r.total} passage${r.total > 1 ? "s" : ""} dans ${r.resultats.length} document${r.resultats.length > 1 ? "s" : ""}</p>
        <ol>${r.resultats.map((x) => `
          <li>
            <a href="#" data-doc="${e(x.chemin)}"><span class="rubrique">${e(x.rubrique)}</span> ${e(x.titre)}</a>
            ${x.lignes.map((l, k) => `<p><a href="#" class="extrait" data-doc="${e(x.chemin)}" data-passage="${k}" title="Ouvrir à ce passage">${surligner(e(l), mots)}</a></p>`).join("")}
            ${x.autres ? `<p class="aide">et ${x.autres} autre${x.autres > 1 ? "s" : ""}</p>` : ""}
          </li>`).join("")}</ol>`
      : `<p class="aide">Rien trouvé pour « ${e(q)} ».</p>`;
    return r;
  }

  async ouvrir(chemin, q = "", depuisClic = false, passage = null) {
    const zone = this.racine.querySelector(".bible-doc");
    this.memoriser("doc", chemin);
    this.memoriser("passage", passage ?? "");
    let doc;
    try {
      doc = await api.get(`/api/bible/document?chemin=${encodeURIComponent(chemin)}`);
    } catch (err) {
      if (!this.detruit) zone.innerHTML = `<p class="alerte">${err?.status === 404 ? "Ce document n'existe pas dans la bible (ou plus). Choisissez-en un dans la liste." : `Ce document ne s'ouvre pas : ${e(err?.message || "erreur inconnue")}.`}</p>`;
      return;
    }
    if (this.detruit) return;
    const video = /^episodes\/[^/]+\/\d+-([A-Za-z0-9_-]{11})\.md$/.exec(chemin)?.[1] || "";
    const html = markdown(doc.markdown, chemin.split("/").slice(0, -1).join("/"), video);
    zone.innerHTML = `<div class="md">${surligner(html, motsDe(q))}</div>`;
    for (const a of this.racine.querySelectorAll(".bible-docs [data-doc]")) a.toggleAttribute("aria-current", a.dataset.doc === chemin);
    // Sur une seule colonne (iPad en portrait), le document est sous la liste : on n'y descend qu'après un clic.
    const etroit = matchMedia("(max-width: 900px)").matches;
    const premier = zone.querySelector("mark");
    zone.scrollTop = 0;
    const ligne = passage !== null && passage !== "" ? this.resultats?.find((x) => x.chemin === chemin)?.lignes?.[+passage] : null;
    const bloc = ligne ? blocDeLExtrait(zone, ligne) : null;
    if (bloc) {
      bloc.scrollIntoView({ block: "center" });
      bloc.classList.remove("eclat");
      void bloc.offsetWidth;
      bloc.classList.add("eclat");
      return;
    }
    if (etroit && !depuisClic) return;
    if (premier) premier.scrollIntoView({ block: "center" });
    else if (etroit) zone.scrollIntoView({ block: "start" });
  }
}
