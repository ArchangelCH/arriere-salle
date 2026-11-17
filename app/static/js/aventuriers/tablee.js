// La tablée pendant la partie : les fiches des aventuriers côte à côte, ce qu'il faut pour arbitrer d'un coup d'œil
// (valeurs de test, défense, santé, armes, dons) et, pour le MJ seul, ce que les joueurs ne voient pas.
// Un bouton envoie la même vue à la TV, sans les secrets.

import { api, echapper as e, toast } from "../api.js";
import { BoutonTv } from "../ecran-tv/bouton-tv.js";
import { htmlMedaillon } from "./embleme.js";
import { etatComplet, lisible } from "./etat.js";
import * as R from "./regles.js";
// Un MJ invité lit la tablée sans ses secrets : ni la fiche entière des héros, ni leur impression.
import { estInvite } from "../mj/role.js";

const VUES_PLEINES = ["planche", "precedemment", "episode", "heros", "fiches"];
const VUE_AVANT = ["vue", "carte", "camera", "style", "version", "lieu", "url", "titre"];
const DEFENSES = ["aucune défense", "une défense", "deux défenses"];

const pourcent = (v) => `${e(v)}<small>%</small>`;
// La jauge du moment sur son maximum (« 5/8 ») ; au maximum, le chiffre seul.
const jauge = (v, max) => (v < max ? `${e(String(v).replace("-", "−"))}<small class="sur">/${e(max)}</small>` : e(max));

export function herosDeLaTablee(liste) {
  return liste.filter((a) => a.tablee !== false && a.id).sort((x, y) => String(x.cree || "").localeCompare(String(y.cree || "")));
}

export class Tablee {
  constructor(racine) {
    this.racine = racine;
    this.ecoute = new AbortController();
    // Les fiches à la TV : le bouton commun, qui lit l'état réel de la table.
    this.boutonTv = new BoutonTv({
      estIci: (t) => t.vue === "fiches",
      montrer: async () => {
        const r = await this.basculer({ vue: "fiches" });
        toast(r.ecrans ? "À la TV : les fiches de la tablée." : "Envoyé, mais aucun écran de table n'est branché.");
      },
      retirer: async () => {
        await this.revenir();
        toast("Retiré de la TV : les fiches de la tablée.");
      },
      titre: "Les fiches côte à côte sur la TV, sans le bloc « Pour le MJ »",
      titreIci: "La TV montre les fiches : les retirer, elle revient à ce qu'elle montrait avant",
    });
  }

  async demarrer() {
    this.racine.innerHTML = `<section class="page-liste tablee-vue"><div class="chargement">On sort les fiches…</div></section>`;
    const [aventuriers, table, etats] = await Promise.all([
      api.get("/api/aventuriers"), api.get("/api/table").catch(() => ({})), api.get("/api/etats-heros").catch(() => null),
    ]);
    if (this.detruit) return;
    this.heros = herosDeLaTablee(aventuriers);
    this.etats = etats?.etats || {};
    this.table = table;
    this.afficher();
  }

  detruire() {
    this.detruit = true;
    this.ecoute.abort();
    this.boutonTv.detruire();
  }

  vider() {}

  afficher() {
    this.racine.innerHTML = `
      <section class="page-liste tablee-vue">
        <header class="titre-page tablee-tete">
          <div>
            <p class="kicker">${estInvite() ? "Les aventuriers" : '<a href="#/aventuriers">Les aventuriers</a>'}</p>
            <h1>La tablée</h1>
            <p class="chapo">Les fiches côte à côte : chaque valeur comprend déjà la caractéristique ; sans la compétence, on teste la caractéristique seule.${estInvite() ? "" : " Le bloc « Pour le MJ » ne part jamais sur la TV."}</p>
          </div>
          <div class="actions">
            ${estInvite() ? "" : '<a class="bouton" href="/fiche-aventurier?tablee=1" target="_blank" rel="noopener">Imprimer les fiches</a>'}
          </div>
        </header>
        ${this.heros.length
          ? `<div class="tablee-grille${this.heros.length > 4 ? " serree" : ""}" style="--colonnes: ${Math.min(this.heros.length, 6)}">${this.heros.map((a) => this.htmlFiche(a)).join("")}</div>`
          : `<p class="vide">Personne à la tablée pour l'instant.${estInvite() ? "" : ' <a href="#/aventuriers">Créer un aventurier</a>'}</p>`}
      </section>`;
    this.racine.querySelector(".tablee-tete .actions").prepend(this.boutonTv.el);
    this.boutonTv.desactiver(this.heros.length ? null : "Personne à la tablée pour l'instant");
  }

  htmlFiche(a) {
    const x = R.essentiel(a);
    const jour = etatComplet(a, this.etats[a.id]);
    const couleur = /^#[0-9a-f]{3,8}$/i.test(a.couleur || "") ? a.couleur : "var(--bronze)";
    const peuple = R.titre({ ...a, specialite: "", vocations: [] });
    const vocation = R.identiteTablee(a).vocation;
    const bouclier = x.bouclier ? 2 : 0;
    const pourMj = [
      ["Aujourd'hui", jour.notes], ["Secret", a.secret], ["Notes", a.notes_mj], ["Particularités", a.particularites],
      ["Ne fera jamais", a.jamais], ["Défaut", a.defaut],
    ].filter(([, v]) => (v || "").trim());
    const surLui = [
      ["Élément", a.element], ["Thèmes", (a.themes || []).filter(Boolean).join(", ")], ["Langues", a.langues],
      ["Bourse", a.or !== null && a.or !== undefined && a.or !== "" ? `${a.or} pièces d'or` : ""],
      ["Sac", [...(a.equipement || []).map(lisible), ...(a.objets || [])].filter((o) => (o || "").trim()).join(", ")],
    ].filter(([, v]) => String(v || "").trim());
    return `
      <article class="fiche-col" style="--couleur: ${e(couleur)}">
        <header class="fc-identite">
          ${estInvite() ? htmlMedaillon(a, { classe: "fc-medaillon" }) : `<a href="#/aventuriers/${e(a.id)}" title="Ouvrir sa fiche">${htmlMedaillon(a, { classe: "fc-medaillon" })}</a>`}
          <div>
            <h2>${estInvite() ? e(a.nom || "Sans nom") : `<a href="#/aventuriers/${e(a.id)}">${e(a.nom || "Sans nom")}</a>`}</h2>
            <p class="fc-peuple">${e(peuple)}${a.peuple_cache ? ' <span class="fc-secret" title="Peuple gardé secret : la TV ne le montre pas">secret</span>' : ""}</p>
            ${vocation ? `<p class="fc-vocation">${e(vocation)}</p>` : ""}
            ${a.joueur ? `<p class="fc-joueur"><span class="pastille"></span>${e(a.joueur)}</p>` : ""}
          </div>
        </header>
        <div class="fc-caracs">${x.caracs.map((c) => `<div><small>${e(c.nom)}</small><b>${pourcent(c.valeur)}</b></div>`).join("")}</div>
        <div class="fc-jauges">
          <div class="sante"><small>Santé</small><b>${x.sante ? jauge(jour.sante, x.sante) : x.sante}</b></div>
          <div class="psy"><small>Psy</small><b>${jauge(jour.psy, x.psy)}</b></div>
          <div><small>Défense</small><b>${pourcent(x.defense)}</b></div>
          <div><small>Armure</small><b>${x.protection.indice}${bouclier && x.posture?.cle === "defensive" ? `<small>+${bouclier}</small>` : ""}</b></div>
        </div>
        <p class="fc-posture">${x.posture
          ? `Posture <b>${e(x.posture.nom.toLowerCase())}</b> : ${DEFENSES[x.defenses] || ""} par tour${x.posture.cle === "focus" ? ", +5 % à tous les tests" : ""}${bouclier ? (x.posture.cle === "defensive" ? ", bouclier compris dans l'armure" : ", bouclier en posture défensive") : ""}.`
          : "Posture non choisie."}${x.protection.nom ? ` ${e(x.protection.nom)}${x.protection.gene ? ` (${e(x.protection.gene)})` : ""}.` : ""}</p>
        <section class="fc-bloc">
          <h3>Compétences</h3>
          <ul class="fc-lignes">${x.competences.map((c) => `
            <li><span class="nom">${e(c.nom)}</span><span class="detail">+${c.bonus} ${e(c.avec.toLowerCase())}</span><b>${pourcent(c.valeur)}</b></li>`).join("") || '<li class="vide">Aucune.</li>'}
          </ul>
        </section>
        <section class="fc-bloc">
          <h3>Armes</h3>
          <ul class="fc-lignes">${x.armes.map((w) => `
            <li><span class="nom">${e(w.nom)}${w.nombre > 1 ? ` <i>× ${w.nombre}</i>` : ""}</span><span class="detail">${e(w.degats || "")}</span><b>${pourcent(w.valeur)}</b>${w.notes ? `<span class="note">${e(w.notes)}</span>` : ""}</li>`).join("") || '<li class="vide">Mains nues.</li>'}
          </ul>
        </section>
        <section class="fc-bloc">
          <h3>Dons</h3>
          <ul class="fc-dons">${x.dons.map((d) => `
            <li><p class="titre-don"><b>${e(d.nom)}</b><span class="cout" title="Coût en Psy">${e(d.cout)}</span></p>${d.effet ? `<p class="effet">${e(d.effet)}</p>` : ""}</li>`).join("") || '<li class="vide">Aucun.</li>'}
          </ul>
        </section>
        <section class="fc-bloc fc-sur-lui">
          ${surLui.map(([k, v]) => `<p><span class="lbl">${k}</span> ${e(v)}</p>`).join("")}
        </section>
        <section class="fc-bloc fc-mj">${pourMj.length ? `<h3>Pour le MJ</h3>${pourMj.map(([k, v]) => `<p><span class="lbl">${k}</span> ${e(v)}</p>`).join("")}` : ""}</section>
      </article>`;
  }

  async envoyer(changements) {
    const etat = await api.get("/api/table");
    delete etat.ecrans;
    return api.put("/api/table", { ...etat, ...changements });
  }

  // Comme les autres vues plein écran : la TV retrouve ensuite ce qu'elle montrait avant.
  async basculer(extra) {
    const etat = await api.get("/api/table");
    const avant = VUES_PLEINES.includes(etat.vue) ? etat.avant || null : Object.fromEntries(VUE_AVANT.map((k) => [k, etat[k] ?? null]));
    return this.envoyer({ ...extra, avant, lieu: null });
  }

  async revenir() {
    const etat = await api.get("/api/table");
    const avant = etat.avant && !VUES_PLEINES.includes(etat.avant.vue) ? etat.avant : { vue: "accueil" };
    return this.envoyer({ ...avant, contrat: null, avant: null });
  }
}
