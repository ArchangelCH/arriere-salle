// Écrire sans quitter le fil : quand « Lier une fiche » ne trouve rien, « Créer le PNJ « … » » ou « Créer le lieu « … » »
// crée une fiche minimale et insère le lien ; « Reprendre » rouvre le dernier chapitre écrit ; un lien suivi depuis
// l'aperçu laisse sur la fiche « Retour au chapitre » ; et « Dans les scénarios » ouvre le passage qui cite la fiche
// (?voir=<adresse>). Ce que la page Scénarios (scenarios.js) confie : son scénario, sa zone, ses fiches, son dialogue.

import { api, echapper as e, toast } from "../api.js";
import { noterDepart } from "../liens/dans-les-scenarios.js";
import { lienLieu } from "../seances/avant-de-jouer.js";
import { plier } from "./consignes.js";
import { liensCourts } from "./liens-courts.js";

const CLE_REPRENDRE = "scenarios.reprendre";
const court = (t, n) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
// Le nom tapé dans la recherche, tel quel, avec une capitale au début : « zébulon le passeur » → « Zébulon le passeur ».
export const nomTape = (t) => {
  const propre = String(t || "").replace(/[[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return propre ? propre[0].toLocaleUpperCase("fr") + propre.slice(1) : "";
};

export function lireReprise() {
  try {
    return JSON.parse(localStorage.getItem(CLE_REPRENDRE) || "null");
  } catch {
    return null;
  }
}

export class LierEnEcrivant {
  constructor(page) {
    this.page = page;
  }

  // Le scénario et le chapitre ouverts en dernier, gardés d'un jour à l'autre sur cet appareil.
  retenir(scenario, chapitre) {
    try {
      localStorage.setItem(CLE_REPRENDRE, JSON.stringify({ scenario, chapitre, quand: new Date().toISOString() }));
    } catch {
      // sans « Reprendre », la liste reste là
    }
  }

  // En tête de la liste des scénarios : « Reprendre », s'il existe encore.
  htmlReprendre(scenarios) {
    const r = lireReprise();
    const s = r && scenarios.find((x) => x.id === r.scenario);
    if (!s) return "";
    const ch = (s.chapitres || []).find((c) => c.id === r.chapitre);
    const n = ch ? (s.chapitres || []).indexOf(ch) + 1 : 0;
    return `
        <a class="reprendre" href="#/scenarios/${e(encodeURIComponent(s.id))}${ch ? `?chapitre=${e(encodeURIComponent(ch.id))}` : ""}">
          <span class="kicker">Reprendre</span>
          <span class="quoi"><b>${e(s.nom || "Sans titre")}</b>${ch ? `<span class="ou">chapitre ${n} · ${e(court(ch.titre || "Sans titre", 60))}</span>` : ""}</span>
        </a>`;
  }

  // Les liens de l'aperçu : suivre l'un d'eux note d'où l'on part (la fiche ouverte proposera d'y revenir).
  brancher(racine) {
    racine.querySelector(".apercu")?.addEventListener("click", (ev) => {
      const a = ev.target.closest('a[href^="#/"]');
      const p = this.page;
      if (!a || !p.s) return;
      noterDepart({ scenario: p.s.id, chapitre: p.chap, titre: p.chapitre().titre || "", href: a.getAttribute("href") });
    });
  }

  // « Lier une fiche » sans résultat : de quoi créer la fiche qui manque, sous le nom tapé.
  htmlAucune(recherche) {
    const nom = nomTape(recherche);
    if (!nom) return '<li class="vide">Aucune fiche ne porte ce nom.</li>';
    return `
        <li class="vide creer-fiche">
          <span>Aucune fiche ne porte ce nom. La créer, sans rien d'autre que son nom : elle se complète plus tard.</span>
          <span class="actions">
            <button type="button" data-creer="pnj">Créer le PNJ «&nbsp;${e(court(nom, 40))}&nbsp;»</button>
            <button type="button" data-creer="lieu">Créer le lieu «&nbsp;${e(court(nom, 40))}&nbsp;»</button>
          </span>
        </li>`;
  }

  // La fiche minimale, puis le lien inséré comme pour une fiche trouvée (scenarios.js, fermerFiches). Un lieu créé ici n'a
  // pas encore de carte : sa fiche s'ouvre seule (#/lieu/…), et « Poser sur une carte » l'y mettra.
  async creer(genre, recherche, bouton) {
    const p = this.page;
    const dlg = p.r.querySelector(".dialogue-fiche");
    const nom = nomTape(recherche);
    if (!nom || !dlg?.open) return;
    for (const b of dlg.querySelectorAll("[data-creer]")) b.disabled = true;
    let fiche;
    try {
      fiche = genre === "pnj"
        ? await api.post("/api/pnj", { nom, statut: "vivant", attitude: "neutre", etiquette: "maison", connu: false, rang: "civil" })
        : await api.post("/api/lieux", { nom, type: "point", etiquette: "maison", connu: false, a_valider: false, resume: "", secrets: "", notes: "" });
    } catch (err) {
      for (const b of dlg.querySelectorAll("[data-creer]")) b.disabled = false;
      return toast(`Création impossible : ${err.message}`, "erreur");
    }
    const route = genre === "pnj" ? `#/pnj/${encodeURIComponent(fiche.id)}` : lienLieu(fiche);
    const entree = { genre, id: fiche.id, nom: fiche.nom, detail: "", route, cle: plier(fiche.nom) };
    // La nouvelle fiche se retrouve aussitôt par « @ » et ne passe pas pour un lien mort dans l'aperçu.
    if (p.fiches) p.fiches.push(entree);
    p.index?.[genre]?.add(fiche.id);
    if (!dlg.open) return toast(`${genre === "pnj" ? "PNJ" : "Lieu"} « ${fiche.nom} » créé.`);
    p.trouvees = [entree];
    p.choixFiche = 0;
    dlg.close("lier");
    toast(`${genre === "pnj" ? "PNJ" : "Lieu"} « ${fiche.nom} » créé et lié : sa fiche se complète quand vous voulez.`, "info", {
      action: { libelle: "Ouvrir sa fiche", faire: () => { location.hash = route; } },
    });
  }

  // Le passage qui cite une fiche (« Dans les scénarios ») : l'aperçu y défile et l'éclaire ; dans la zone d'écriture, le
  // lien est choisi. href : l'adresse écrite dans le fichier, ou le lien court tel quel.
  voir(href) {
    const p = this.page;
    if (!href || !p.r) return;
    if (p.mode !== "ecrire") {
      const a = [...p.r.querySelectorAll(".apercu a")].find((x) => x.getAttribute("href") === href);
      if (a) {
        a.scrollIntoView({ block: "center" });
        a.classList.remove("eclat");
        void a.offsetWidth;
        a.classList.add("eclat");
      }
    }
    if (p.mode === "apercu") return;
    const z = p.zone;
    const t = z.value;
    const table = p.courts.table(p.chap);
    const courtTrouve = liensCourts(t).find((l) => table.get(l.libelle) === href || `@[${l.libelle}]` === href);
    let debut = courtTrouve?.debut ?? -1;
    let fin = courtTrouve?.fin ?? -1;
    if (debut < 0) {
      const i = t.indexOf(`](${href})`);
      if (i >= 0) {
        debut = t.lastIndexOf("[", i);
        fin = i + href.length + 3;
      }
    }
    if (debut < 0) return;
    z.focus({ preventScroll: true });
    z.setSelectionRange(debut, fin);
    p.zoneTouchee = true;
    z.scrollTop = Math.max(0, p.hauteurDans(debut) - z.clientHeight / 3);
  }
}
