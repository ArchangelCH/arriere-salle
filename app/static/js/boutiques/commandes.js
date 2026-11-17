// Les commandes des joueurs, passées depuis l'échoppe de leur téléphone (le coin des joueurs) entre les séances. Le MJ
// les lit d'après ses boutiques d'aujourd'hui (prix ajusté, stock, article caché ou retiré), puis vend (l'or quitte la
// bourse du héros, les articles entrent dans son sac comme avec « Vendre à… », le stock baisse, l'achat est noté au
// journal de la séance) ou refuse avec un mot que le joueur lira. Le serveur revérifie tout au moment de vendre.

import { api, echapper as e, toast } from "../api.js";
import { noterAuJournal, seanceDuJournal } from "../seances/journal.js";
import { pourquoiSansCommande } from "../joueurs/etat-carnet.js";

const RELIRE = 30000; // la pastille du bouton se tient à jour tant que l'onglet est ouvert

function quand(iso) {
  const d = new Date(iso || "");
  if (Number.isNaN(d.getTime())) return "";
  const jour = d.toDateString() === new Date().toDateString() ? "aujourd'hui" : `le ${d.toLocaleDateString("fr-CH", { day: "numeric", month: "long" })}`;
  return `${jour} à ${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
}

const prenom = (nom) => String(nom || "").trim().split(/[\s,]+/)[0] || "";
// Sans commande, le panneau dit pourquoi : carnet fermé, aucune boutique ouverte, aucun héros relié (etat-carnet.js).
const VIDE = '<p class="vide">Aucune commande en attente.</p><div class="pourquoi-vide aide"></div>';
const ligneSac = (l) => (l.quantite > 1 ? `${l.nom} ×${l.quantite}` : l.nom);

export class Commandes {
  constructor(bouton, { surVente = () => {} } = {}) {
    this.bouton = bouton;
    this.surVente = surVente;
    this.liste = [];
    this.dialogue = null;
    this.occupe = false;
    this.minuterie = setInterval(() => this.relire(), RELIRE);
    this.surFocus = () => this.relire();
    window.addEventListener("focus", this.surFocus);
    bouton.addEventListener("click", () => this.ouvrir());
    this.relire();
  }

  detruire() {
    clearInterval(this.minuterie);
    window.removeEventListener("focus", this.surFocus);
    this.dialogue?.close();
    this.dialogue?.remove();
  }

  async relire() {
    try {
      this.liste = await api.get("/api/commandes");
    } catch {
      return; // serveur muet : la pastille garde ce qu'elle savait
    }
    const n = this.liste.filter((c) => c.statut === "en-attente").length;
    this.bouton.querySelector(".compte-commandes").textContent = n ? String(n) : "";
    this.bouton.classList.toggle("a-traiter", n > 0);
    this.bouton.title = n ? `${n} commande${n > 1 ? "s" : ""} de joueurs en attente` : "Aucune commande de joueur en attente";
    if (this.dialogue?.open && !this.occupe) this.fondre();
  }

  // Le panneau ouvert se tient à jour sans rien effacer (relu toutes les trente secondes et au retour sur la fenêtre) :
  // une commande nouvelle s'ajoute ; celle à laquelle personne n'a touché se relit (prix, stock, bourse du jour) ; celle
  // où le MJ a écrit (mot de refus, montant retouché) reste telle quelle, même si le joueur l'a retirée entre-temps.
  fondre() {
    const zone = this.dialogue.querySelector(".attente-mj");
    if (!zone) return this.remplir();
    const attente = this.liste.filter((c) => c.statut === "en-attente");
    const enPlace = new Map([...zone.querySelectorAll("[data-commande]")].map((li) => [`${li.dataset.joueur}/${li.dataset.commande}`, li]));
    let ul = zone.querySelector(".commandes-mj");
    for (const c of attente) {
      const li = enPlace.get(`${c.joueur}/${c.id}`);
      enPlace.delete(`${c.joueur}/${c.id}`);
      if (li && this.touchee(li)) continue;
      if (li) li.outerHTML = this.htmlCommande(c);
      else {
        if (!ul) {
          zone.innerHTML = '<ul class="commandes-mj"></ul>';
          ul = zone.querySelector(".commandes-mj");
        }
        ul.insertAdjacentHTML("beforeend", this.htmlCommande(c));
      }
    }
    for (const li of enPlace.values()) {
      if (this.touchee(li)) this.perimer(li);
      else li.remove();
    }
    if (!zone.querySelector("[data-commande]") && !zone.querySelector(".pourquoi-vide")) {
      zone.innerHTML = VIDE;
      pourquoiSansCommande(zone.querySelector(".pourquoi-vide"));
    }
    const bloc = this.dialogue.querySelector(".traitees-mj");
    const ouvert = bloc.querySelector("details")?.open;
    bloc.innerHTML = this.htmlTraitees();
    if (ouvert) bloc.querySelector("details")?.setAttribute("open", "");
  }

  // Le MJ y a écrit (un mot, un montant), ou il est en train de le faire.
  touchee(li) {
    return li.classList.contains("perimee") || li.contains(document.activeElement)
      || [...li.querySelectorAll("input")].some((x) => x.value !== x.defaultValue);
  }

  // Une commande retirée par le joueur (ou traitée sur un autre écran) pendant que le MJ y écrivait : elle reste lisible.
  perimer(li) {
    li.classList.add("perimee");
    li.querySelectorAll("button").forEach((x) => { x.disabled = true; });
    this.erreur(li, "Cette commande n'attend plus : le joueur l'a retirée, ou elle a été traitée sur un autre écran. Ce que vous aviez écrit reste ici.");
  }

  creerDialogue() {
    if (this.dialogue) return;
    const d = document.createElement("dialog");
    d.className = "dialogue commandes-joueurs";
    d.setAttribute("aria-labelledby", "commandes-joueurs-titre");
    d.addEventListener("click", (ev) => this.clic(ev));
    d.addEventListener("submit", (ev) => ev.preventDefault());
    document.body.append(d);
    this.dialogue = d;
  }

  async ouvrir() {
    this.creerDialogue();
    this.remplir();
    this.dialogue.showModal();
    await this.relire();
  }

  htmlLigne(l) {
    return `<li class="${l.probleme ? "probleme" : ""}">
      <span class="quoi">${l.quantite > 1 ? `${e(l.quantite)} × ` : ""}${e(l.nom || "article")}</span>
      <span class="prix">${l.montant !== null ? `${e(l.montant)} po` : l.prix ? e(l.prix) : ""}</span>
      ${l.probleme ? `<span class="souci">${e(l.probleme)}</span>` : ""}
    </li>`;
  }

  htmlCommande(c) {
    const chez = c.boutique?.nom || c.boutique_nom || "une boutique disparue";
    const heros = c.heros ? `pour <b>${e(c.heros.nom)}</b> (${e(c.heros.or ?? 0)} po en bourse)` : "sans héros à la tablée";
    if (c.statut !== "en-attente") {
      const issue = c.statut === "vendue" ? `Vendue ${e(quand(c.traitee))}, ${c.montant ? `${e(c.montant)} po` : "offerte"}` : `Refusée ${e(quand(c.traitee))}${c.mot ? ` : « ${e(c.mot)} »` : ""}`;
      return `<li class="commande-mj traitee statut-${e(c.statut)}"><p><b>${e(c.joueur_nom)}</b> chez ${e(chez)} : ${e(c.lignes.map(ligneSac).join(", "))}.</p><p class="issue">${issue}.</p></li>`;
    }
    const bloque = c.refus.length > 0;
    return `
      <li class="commande-mj" data-joueur="${e(c.joueur)}" data-commande="${e(c.id)}">
        <p class="qui"><b>${e(c.joueur_nom)}</b> ${heros}, chez <b>${e(chez)}</b><span class="quand">${e(quand(c.cree))}</span></p>
        <ul class="lignes-commande">${c.lignes.map((l) => this.htmlLigne(l)).join("")}</ul>
        ${bloque ? "" : `<p class="total-commande">${c.total !== null ? `Total : ${e(c.total)} po` : "Un prix est à fixer : tapez le montant payé."}</p>`}
        ${bloque ? `<p class="refus" role="alert">Vente impossible : ${e(c.refus.join(" ; "))}.</p>` : ""}
        <div class="actions-commande">
          <label class="champ champ-montant">Montant payé, en po<input type="number" name="montant" min="0" step="1" inputmode="numeric" value="${c.total ?? ""}"></label>
          <button type="button" class="principal" data-vendre ${bloque ? "disabled" : ""}>Vendre</button>
        </div>
        <div class="actions-commande">
          <label class="champ champ-mot">Un mot pour le joueur, s'il est refusé<input type="text" name="mot" maxlength="200" placeholder="Facultatif"></label>
          <button type="button" data-refuser>Refuser</button>
        </div>
        <p class="erreur-commande" role="alert" hidden></p>
      </li>`;
  }

  htmlTraitees() {
    const traitees = this.liste.filter((c) => c.statut !== "en-attente");
    return traitees.length ? `<details class="commandes-traitees"><summary>Déjà traitées (${traitees.length})</summary><ul class="commandes-mj">${traitees.map((c) => this.htmlCommande(c)).join("")}</ul></details>` : "";
  }

  remplir() {
    const attente = this.liste.filter((c) => c.statut === "en-attente");
    this.dialogue.innerHTML = `
      <form method="dialog">
        <p class="kicker">Le coin des joueurs</p>
        <h2 id="commandes-joueurs-titre">Commandes des joueurs</h2>
        <p class="aide">Passées depuis l'échoppe de leur téléphone, dans les boutiques ouvertes aux joueurs. « Vendre » retire l'or de la bourse du héros et met les articles dans son sac ; « Refuser » lui renvoie votre mot.</p>
        <div class="attente-mj">${attente.length ? `<ul class="commandes-mj">${attente.map((c) => this.htmlCommande(c)).join("")}</ul>` : VIDE}</div>
        <div class="traitees-mj">${this.htmlTraitees()}</div>
        <div class="actions"><button value="fermer">Fermer</button></div>
      </form>`;
    this.dialogue.querySelector('[value="fermer"]').addEventListener("click", () => this.dialogue.close());
    pourquoiSansCommande(this.dialogue.querySelector(".pourquoi-vide"));
  }

  erreur(li, texte) {
    const p = li.querySelector(".erreur-commande");
    p.textContent = texte;
    p.hidden = !texte;
  }

  async clic(ev) {
    const b = ev.target.closest("button");
    const li = b?.closest("[data-commande]");
    if (!li || this.occupe || b.disabled) return;
    const c = this.liste.find((x) => x.id === li.dataset.commande && x.joueur === li.dataset.joueur);
    if (!c) return;
    if (b.hasAttribute("data-vendre")) return this.vendre(li, c);
    if (b.hasAttribute("data-refuser")) return this.refuser(li, c);
  }

  async vendre(li, c) {
    const saisi = li.querySelector('[name="montant"]').value.trim();
    const montant = Number(saisi);
    if (saisi === "" || !Number.isInteger(montant) || montant < 0) return this.erreur(li, "Indiquez le montant payé, en pièces d'or entières.");
    this.erreur(li, "");
    this.occupe = true;
    li.querySelectorAll("button").forEach((x) => { x.disabled = true; });
    let r;
    try {
      r = await api.post(`/api/commandes/${encodeURIComponent(c.joueur)}/${encodeURIComponent(c.id)}/vendre`, { montant });
    } catch (err) {
      this.occupe = false;
      li.querySelectorAll("button").forEach((x) => { x.disabled = false; });
      return this.erreur(li, err.message);
    }
    this.occupe = false;
    li.remove();
    if (r.boutique) this.surVente(r.boutique);
    const qui = prenom(r.heros.nom) || "Le héros";
    const chez = c.boutique?.nom || "le marchand";
    const quoi = c.lignes.map(ligneSac).join(", ");
    let journal = "";
    try {
      const seance = seanceDuJournal(await api.get("/api/seances"));
      if (seance) {
        await noterAuJournal(seance.id, montant ? `${qui} achète ${quoi} (${montant} po) chez ${chez}, sur commande.` : `${qui} reçoit ${quoi} (offert) chez ${chez}, sur commande.`);
        journal = ", noté au journal";
      }
    } catch (err) {
      toast(`Achat non noté au journal : ${err.message}`, "erreur");
    }
    toast(`${qui} reçoit ${quoi}${montant ? ` pour ${montant} po : il lui reste ${r.heros.or ?? 0} po` : ""}${journal}.`);
    await this.relire();
  }

  async refuser(li, c) {
    const mot = li.querySelector('[name="mot"]').value.trim();
    this.erreur(li, "");
    this.occupe = true;
    li.querySelectorAll("button").forEach((x) => { x.disabled = true; });
    try {
      await api.post(`/api/commandes/${encodeURIComponent(c.joueur)}/${encodeURIComponent(c.id)}/refuser`, { mot });
      li.remove();
      toast(`Commande de ${c.joueur_nom} refusée${mot ? " : il lira votre mot" : ""}.`);
    } catch (err) {
      this.erreur(li, err.message);
    } finally {
      this.occupe = false;
    }
    await this.relire();
  }
}
