// Les horloges de la menace, côté MJ : une section du tableau (tableau.js) pour créer une horloge (un nom, 4, 6 ou 8
// parts), la remplir ou la vider d'une part, la montrer à la TV ou l'y retirer, la supprimer. Trois au plus, rangées
// dans l'état de la table par leurs routes (/api/horloges, horloges.py) : un écran qui envoie autre chose à la TV ne
// les touche pas. Touche H, sur toutes les pages hors d'un champ de saisie : l'horloge montrée touchée en dernier
// avance d'une part ; Maj+H la recule. Aucune n'est montrée : la dernière touchée avance, et le message propose de la
// montrer. Relues toutes les cinq secondes tant que le tableau est ouvert (l'iPad a pu en avancer une).

import { accorderEnfants } from "../commun/accorder.js";
import { api, echapper as e, toast } from "../api.js";
import { demander } from "../commun/dialogue.js";
import { horloge } from "../seances/fils.js";

const PERIODE = 5000;
const MAX = 3;
const NOM_MAX = 40;
const PARTS = [4, 6, 8];

const etat = (h) => `${h.remplies} sur ${h.parts}`;

export class Horloges {
  constructor(zone) {
    this.zone = zone;
    this.liste = null; // null tant qu'elles ne sont pas lues
    this.ouvert = false;
    this.minuterie = 0;
    this.lecture = 0; // chaque relecture numérotée : une réponse partie avant un geste est périmée
    this.envois = Promise.resolve();
    this.parts = 6; // le dernier découpage choisi, gardé pour la prochaine horloge
    zone.addEventListener("click", (ev) => this.clic(ev));
    zone.addEventListener("submit", (ev) => {
      ev.preventDefault();
      this.creer(ev.target);
    });
    zone.addEventListener("change", (ev) => {
      if (ev.target.name === "parts") this.parts = +ev.target.value;
    });
    document.addEventListener("keydown", (ev) => this.touche(ev));
  }

  ouvrir() {
    this.ouvert = true;
    this.afficher();
    this.relire();
    clearInterval(this.minuterie);
    this.minuterie = setInterval(() => document.visibilityState === "visible" && this.relire(), PERIODE);
  }

  fermer() {
    this.ouvert = false;
    clearInterval(this.minuterie);
    this.minuterie = 0;
  }

  async relire() {
    const n = ++this.lecture;
    try {
      const r = await api.get("/api/horloges");
      if (n === this.lecture) this.recu(r);
    } catch {
      // serveur muet : on garde ce qu'on montrait
    }
  }

  recu(r) {
    this.liste = Array.isArray(r?.horloges) ? r.horloges : [];
    this.afficher();
  }

  // Un geste part à la file, dans l'ordre des clics ; la réponse (la liste entière) remplace l'affichage.
  geste(requete, apres) {
    this.lecture++;
    this.envois = this.envois.then(async () => {
      try {
        const r = await requete();
        this.lecture++;
        this.recu(r);
        if (apres) apres(r);
      } catch (err) {
        // Un refus attendu (aucune horloge à avancer, trois au plus) se lit et s'en va ; une vraie panne reste affichée.
        toast(`Horloges : ${err.message}`, err.status === 409 ? "info" : "erreur");
        this.relire();
      }
    });
    return this.envois;
  }

  // ---------------------------------------------------------------- affichage

  afficher() {
    if (!this.ouvert) return;
    const neuf = document.createElement("div");
    neuf.innerHTML = this.html();
    accorderEnfants(this.zone, neuf);
  }

  html() {
    const liste = this.liste;
    if (!liste) return '<section class="tc-groupe hz-groupe"><h3>Horloges</h3><p class="vide">Lecture…</p></section>';
    return `
      <section class="tc-groupe hz-groupe" aria-label="Horloges de la menace">
        <h3>Horloges${liste.length ? ' <small class="hz-touches"><kbd>H</kbd> avance, <kbd>Maj</kbd>+<kbd>H</kbd> recule</small>' : ""}</h3>
        ${liste.map((h) => this.htmlHorloge(h)).join("")}
        ${liste.length < MAX ? this.htmlNouvelle(liste.length) : '<p class="aide">Trois horloges au plus : supprimez-en une pour en créer une autre.</p>'}
      </section>`;
  }

  htmlHorloge(h) {
    const echue = h.remplies >= h.parts;
    return `
      <article class="tc-ligne hz-ligne${echue ? " echue" : ""}" data-hz="${e(h.id)}">
        ${horloge(h.parts, h.remplies, 38)}
        <p class="hz-texte"><b>${e(h.nom)}</b><small>${etat(h)}${echue ? ' <span class="etat">Échue</span>' : ""}</small></p>
        <span class="hz-pas" role="group" aria-label="Parts de ${e(h.nom)}">
          <button type="button" data-hz-action="moins" title="Vider une part" aria-label="Vider une part de ${e(h.nom)}"${h.remplies ? "" : " disabled"}>−</button>
          <button type="button" data-hz-action="plus" title="Remplir une part" aria-label="Remplir une part de ${e(h.nom)}"${echue ? " disabled" : ""}>+</button>
        </span>
        <div class="hz-actions">
          <button type="button" data-hz-action="tv" aria-pressed="${h.visible}" title="${h.visible ? "Les joueurs la voient : la retirer de la TV" : "La montrer à la TV et à la table publique"}">${h.visible ? "Retirer de la TV" : "Montrer à la TV"}</button>
          <button type="button" class="lien-danger" data-hz-action="supprimer">Supprimer</button>
        </div>
      </article>`;
  }

  htmlNouvelle(n) {
    return `
      <form class="hz-nouvelle" autocomplete="off">
        <input type="text" name="nom" maxlength="${NOM_MAX}" required placeholder="${n ? "Une autre menace" : "Le toit va céder"}" aria-label="Nom de la nouvelle horloge" enterkeyhint="done">
        <select name="parts" aria-label="Nombre de parts">${PARTS.map((p) => `<option value="${p}"${p === this.parts ? " selected" : ""}>${p} parts</option>`).join("")}</select>
        <button type="submit" title="Une horloge vide, cachée : montrez-la à la TV quand la menace se précise">Créer</button>
      </form>`;
  }

  // ---------------------------------------------------------------- gestes

  horlogeDe(el) {
    const id = el.closest("[data-hz]")?.dataset.hz;
    return (this.liste || []).find((h) => h.id === id) || null;
  }

  async clic(ev) {
    const b = ev.target.closest("button[data-hz-action]");
    if (!b) return;
    // Touché à la souris, le bouton ne garde pas le focus : Entrée ne rejoue pas le geste.
    if (ev.detail) b.blur();
    const h = this.horlogeDe(b);
    if (!h) return;
    const url = `/api/horloges/${encodeURIComponent(h.id)}`;
    const action = b.dataset.hzAction;
    if (action === "plus" || action === "moins") return this.geste(() => api.patch(url, { pas: action === "plus" ? 1 : -1 }));
    if (action === "tv") return this.basculerTv(h, !h.visible);
    if (action === "supprimer" && (await demander({ titre: `Supprimer l'horloge « ${h.nom} »`, texte: `Ses cases et son nom s'effacent${h.visible ? ", et elle quitte la TV" : ""}.`, oui: "Supprimer l'horloge", danger: true }))) {
      return this.geste(() => api.del(url));
    }
  }

  // « Montrer à la TV » et « Retirer de la TV », ici et depuis le message de la touche H.
  basculerTv(h, montrer) {
    return this.geste(() => api.patch(`/api/horloges/${encodeURIComponent(h.id)}`, { visible: montrer }), (r) => {
      if (!montrer) return toast(`« ${h.nom} » n'est plus à la TV.`);
      toast(r.ecrans ? `« ${h.nom} » à la TV.` : "Montrée, mais aucun écran de table n'est ouvert.");
      this.verifierNom(h.nom);
    });
  }

  creer(form) {
    const champ = form.elements.nom;
    const tape = champ.value;
    const nom = tape.trim();
    if (!nom) return champ.focus();
    const parts = +form.elements.parts.value;
    this.parts = parts;
    return this.geste(() => api.post("/api/horloges", { nom, parts }), () => {
      // Le champ se vide une fois l'horloge créée, sauf si le MJ y tape déjà la suivante.
      const ici = this.zone.querySelector(".hz-nouvelle input[name=nom]");
      if (ici && ici.value === tape) ici.value = "";
      toast(`« ${nom} » est prête, cachée pour l'instant.`);
    });
  }

  // Le nom part vers les joueurs : le nom caché de l'auberge n'y paraît jamais (le serveur le remplace), et un PNJ ou un
  // lieu encore inconnu y est signalé. Un avertissement, rien n'est bloqué.
  async verifierNom(nom) {
    try {
      const r = await api.post("/api/masque", { texte: nom });
      if (r.trouve) toast(`À la TV, ce nom devient « ${r.texte} » : le nom secret de l'auberge n'y paraît pas.`, "erreur");
      const autres = (r.secrets || []).map((s) => s.nom).filter(Boolean);
      if (autres.length) toast(`Ce nom cite ${autres.join(", ")}, encore inconnu${autres.length > 1 ? "s" : ""} des joueurs.`, "erreur");
    } catch {
      // vérification de confort seulement
    }
  }

  // Après H ou Maj+H : l'horloge qui vient de bouger, même tableau fermé (le MJ regarde la TV ou son plan). H tapé
  // plusieurs fois : le dernier avis remplace le précédent au lieu de s'empiler.
  annoncer(r) {
    const h = (r.horloges || []).find((x) => x.id === r.horloge);
    if (!h) return;
    for (const t of document.querySelectorAll(".toasts .toast[data-horloge]")) if (t.dataset.horloge === h.id) t.remove();
    const texte = h.remplies >= h.parts ? `« ${h.nom} » est échue.` : `« ${h.nom} » : ${etat(h)}.`;
    // Cachée (elles naissent cachées) : elle avance quand même, et le message propose de la montrer.
    const avis = h.visible ? toast(texte)
      : toast(`${texte} Elle est cachée : les joueurs ne la voient pas.`, "info", { action: { libelle: "Montrer à la TV", faire: () => this.basculerTv(h, true) } });
    if (avis) avis.dataset.horloge = h.id;
  }

  // H hors d'un champ de saisie et d'un dialogue ouvert, sur toute page : l'horloge montrée touchée en dernier avance
  // (sans horloge montrée, la dernière touchée) ; Maj+H la recule. Ni les éditeurs de plan et de carte, ni le journal
  // (N) n'utilisent cette touche.
  touche(ev) {
    if ((ev.key || "").toLowerCase() !== "h" || ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat || ev.isComposing) return;
    const cible = ev.target instanceof Element ? ev.target : null;
    if (cible && (cible.closest("input, textarea, select, dialog, [contenteditable]") || cible.isContentEditable)) return;
    if (document.querySelector("dialog[open]")) return;
    ev.preventDefault();
    const pas = ev.shiftKey ? -1 : 1;
    this.geste(async () => {
      // Aucune horloge connue ici : la liste se relit d'abord (un autre écran a pu en créer une). Toujours aucune, le
      // refus est dit sans demander au serveur d'avancer ce qui n'existe pas (la console n'y voit plus d'erreur).
      if (!this.liste?.length && !((await api.get("/api/horloges")).horloges || []).length) {
        throw Object.assign(new Error("Aucune horloge pour l'instant : créez-en une dans le Tableau."), { status: 409 });
      }
      return api.post("/api/horloges/avancer", { pas });
    }, (r) => this.annoncer(r));
  }
}
