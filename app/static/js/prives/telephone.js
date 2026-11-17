// Les billets privés, côté atelier : « Envoyer sur son téléphone » sous un billet secret (Préparer, et le rappel
// de la scène en cours dans Jouer), « Remettre à… » sous un document (sa fiche, et « À montrer » dans Jouer). Le billet
// part vers le seul joueur relié à ce héros, publié sous la clé de son lien (prives_mj.py) ; le MJ lit « envoyé à 21 h 02 »,
// puis « lu à 21 h 04 » dès que le joueur l'ouvre, sans recharger (canal de l'atelier, message « prives »), et retire ce
// qui est parti par erreur. Rien ne part vers la TV ni « Documents reçus » ; le papier reste possible.
//
// L'état (GET /api/prives) est tenu ici, une fois pour toutes les pages : ecouterEtatPrives(fn) le donne et le redonne à
// chaque changement. Les pages dessinent avec htmlBilletTelephone() et htmlDocumentTelephone(), puis confient les clics à
// GestesPrives.

import { api, echapper as e, toast } from "../api.js";
import { ecouterPrives } from "../ecran-tv/canal-table.js";
import { demander } from "../commun/dialogue.js";

const FEUILLE = "/static/css/prives-atelier.css";
let etat = null;
let chargement = null;
let finCanal = null;
const abonnes = new Set();

// La feuille se pose avec le premier abonné : la feuille imprimée des billets, qui importe billets.js, n'en a pas besoin.
function poserFeuille() {
  if (document.querySelector(`link[href="${FEUILLE}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = FEUILLE;
  document.head.append(l);
}

function heure(iso) {
  const d = new Date(iso || "");
  return Number.isNaN(d.getTime()) ? "" : `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
}

// « à 21 h 02 » le jour même, « le 7 nov. à 21 h 02 » un autre jour.
function quand(iso) {
  const d = new Date(iso || "");
  if (Number.isNaN(d.getTime())) return "";
  const jour = d.toDateString() === new Date().toDateString() ? "" : `le ${d.toLocaleDateString("fr-CH", { day: "numeric", month: "short" })} `;
  return `${jour}à ${heure(iso)}`;
}

const et = (noms) => (noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}` : noms[0] || "");
// « le téléphone de Mathis », « le téléphone d'Isaure ».
const de = (t) => (/^[aeiouyhàâäéèêëîïôöûüœ]/i.test(t) ? `d'${t}` : `de ${t}`);

function recu(nouvel) {
  etat = nouvel;
  for (const fn of [...abonnes]) {
    try {
      fn(etat);
    } catch (err) {
      console.error(err);
    }
  }
}

export function chargerPrives() {
  if (chargement) return chargement;
  chargement = api.get("/api/prives").then(recu).catch(() => {}).finally(() => {
    chargement = null;
  });
  return chargement;
}

const surRetour = () => document.visibilityState === "visible" && abonnes.size && chargerPrives();

// fn(etat) tout de suite si l'état est connu, puis à chaque changement (un envoi d'un autre écran, un billet lu).
// Renvoie de quoi cesser d'écouter.
export function ecouterEtatPrives(fn) {
  abonnes.add(fn);
  poserFeuille();
  if (!finCanal) {
    finCanal = ecouterPrives((m) => {
      if (!etat || m.signature !== etat.signature) chargerPrives();
    });
    document.addEventListener("visibilitychange", surRetour);
  }
  // Une page qui s'ouvre relit : un héros a pu être relié à son joueur depuis (le canal ne le dit pas).
  if (etat) fn(etat);
  chargerPrives();
  return () => {
    abonnes.delete(fn);
    if (!abonnes.size && finCanal) {
      finCanal();
      finCanal = null;
      document.removeEventListener("visibilitychange", surRetour);
    }
  };
}

const joignable = (heros) => (etat?.joignables || []).find((x) => x.heros === heros) || null;

// ---- Un billet secret ----

// L'envoi a-t-il pris le billet tel qu'il est maintenant ? Sinon, « Renvoyer ».
const memeBillet = (x, b) => (x.titre || "") === String(b.titre || "").trim() && (x.texte || "") === String(b.texte || "").trim();

// destinataires : [{ j : la ligne de la tablée, prenom }], dans l'ordre de la tablée (billets.js).
export function htmlBilletTelephone(s, b, destinataires) {
  const vide = `<div class="tel-billet" data-tel-billet="${e(b.id)}" hidden></div>`;
  if (!etat || !s) return vide;
  const envois = etat.envois.filter((x) => x.nature === "billet" && x.seance === s.id && x.billet === b.id);
  const lignes = [];
  let aEnvoyer = 0;
  let aRenvoyer = 0;
  for (const { j, prenom } of destinataires) {
    const x = envois.find((y) => y.tablee === j.id);
    if (x) {
      const change = !memeBillet(x, b);
      if (change) aRenvoyer += 1;
      lignes.push(htmlEnvoi(x, prenom, change ? "modifié depuis l'envoi" : ""));
    } else if (joignable(j.aventurier)) {
      aEnvoyer += 1;
      lignes.push(`<li><span class="qui-tel">${e(prenom)}</span><span class="etat-tel">pas encore envoyé</span></li>`);
    } else lignes.push(`<li class="papier-tel"><span class="qui-tel">${e(prenom)}</span><span class="etat-tel">pas de joueur relié au coin : sur papier</span></li>`);
  }
  // Envoyé à un héros que le billet ne nomme plus : il reste sur son téléphone tant que le MJ ne le retire pas.
  for (const x of envois.filter((y) => !destinataires.some((d) => d.j.id === y.tablee))) {
    lignes.push(htmlEnvoi(x, x.pour, "n'est plus destinataire"));
  }
  if (!envois.length && !aEnvoyer) return vide;
  const texte = String(b.texte || "").trim();
  const plusieurs = destinataires.filter((d) => joignable(d.j.aventurier)).length > 1;
  const libelle = aRenvoyer && !aEnvoyer ? "Renvoyer la nouvelle version" : envois.length ? `Envoyer aussi ${aEnvoyer > 1 ? "aux autres" : "à l'autre"}`
    : `Envoyer sur ${plusieurs ? "leurs téléphones" : "son téléphone"}`;
  return `
          <div class="tel-billet" data-tel-billet="${e(b.id)}">
            <ul class="envois-tel" aria-label="Sur les téléphones">${lignes.join("")}</ul>
            ${aEnvoyer || aRenvoyer ? `<button type="button" class="envoyer-tel" data-tel-envoyer="${e(b.id)}" ${texte ? "" : 'disabled title="Écrivez d\'abord le texte du billet"'}><span class="losange-tel" aria-hidden="true"></span>${e(libelle)}</button>` : ""}
          </div>`;
}

function htmlEnvoi(x, prenom, note = "") {
  const lu = x.lu ? `lu ${quand(x.lu)}` : `envoyé ${quand(x.envoye)}`;
  const avis = [note, x.retenu ? `retenu : ${x.retenu}` : "", x.joueur_parti ? "joueur retiré du coin" : ""].filter(Boolean).join(" · ");
  return `<li class="${x.lu ? "lu-tel" : "envoye-tel"}${x.retenu ? " retenu-tel" : ""}"><span class="qui-tel">${e(prenom)}</span>
              <span class="etat-tel">${e(lu)}${avis ? ` <i>${e(avis)}</i>` : ""}</span>
              <button type="button" class="lien-danger retirer-tel" data-tel-retirer="${e(x.id)}" title="Le billet disparaît de son téléphone">Reprendre</button></li>`;
}

// ---- Un document ----

const memeDocument = (x, d) => (x.nom || "") === String(d.nom || "").trim() && (x.texte || "") === String(d.texte || "").trim()
  && (x.signature || "") === String(d.signature || "").trim() && (x.image || "") === (d.image || "") && (x.genre || "lettre") === (d.genre || "lettre");

// La ligne du document : à qui il a été remis (et s'il l'a lu), puis « Remettre à… » les héros qui ont un joueur relié.
export function htmlDocumentTelephone(d, { court = false } = {}) {
  const vide = `<div class="tel-document" data-tel-document="${e(d.id)}" hidden></div>`;
  if (!etat) return vide;
  const envois = etat.envois.filter((x) => x.nature === "document" && x.document === d.id);
  const libres = etat.joignables.filter((h) => !envois.some((x) => x.heros === h.heros && memeDocument(x, d)));
  if (!envois.length && !etat.joignables.length) return court ? vide : `<div class="tel-document" data-tel-document="${e(d.id)}">
    <p class="aide">Aucun héros n'a encore de joueur relié au coin : pour le remettre à un seul, imprimez-le.</p></div>`;
  const lignes = envois.map((x) => htmlEnvoi(x, x.pour, memeDocument(x, d) ? "" : "modifié depuis"));
  return `
          <div class="tel-document${court ? " court" : ""}" data-tel-document="${e(d.id)}">
            ${lignes.length ? `<ul class="envois-tel" aria-label="Remis sur un téléphone">${lignes.join("")}</ul>` : ""}
            ${libres.length ? `<details class="remettre-tel"><summary>Remettre à…</summary>
              <p class="aide">Sur son seul téléphone : ni la TV, ni «\u00a0Documents reçus\u00a0» ne le montrent.</p>
              <div class="choix-tel">${libres.map((h) => `<button type="button" data-tel-remettre="${e(d.id)}" data-heros="${e(h.heros)}">${e(h.prenom)}${h.joueur_nom ? ` <i>${e(h.joueur_nom)}</i>` : ""}</button>`).join("")}</div>
            </details>` : ""}
          </div>`;
}

// ---- Les gestes ----

// avant() : ce que la page doit enregistrer d'abord (le serveur lit le billet ou le document sur le disque) ; rend faux si
// l'enregistrement a échoué. apres(reponse, geste) : la page en tire ses conséquences (le billet coché « remis »).
export class GestesPrives {
  constructor({ avant = async () => true, apres = () => {} } = {}) {
    this.avant = avant;
    this.apres = apres;
    this.occupe = false;
  }

  // Rend vrai si le clic était le sien.
  clic(b) {
    if (b.dataset.telEnvoyer !== undefined) {
      this.faire(b, "billet", { seance: b.closest("[data-seance-tel]")?.dataset.seanceTel || this.seance?.(), billet: b.dataset.telEnvoyer });
      return true;
    }
    if (b.dataset.telRemettre !== undefined) {
      this.faire(b, "document", { document: b.dataset.telRemettre, heros: b.dataset.heros });
      return true;
    }
    if (b.dataset.telRetirer !== undefined) {
      this.retirer(b, b.dataset.telRetirer);
      return true;
    }
    return false;
  }

  async faire(b, genre, corps, confirme = false) {
    if (this.occupe) return;
    this.occupe = true;
    b.disabled = true;
    try {
      if (!(await this.avant())) return toast("Rien d'envoyé : la fiche n'a pas pu être enregistrée d'abord.", "erreur");
      let r = await api.post(`/api/prives/${genre}`, { ...corps, confirme });
      if (r.question) {
        const oui = await demander({
          titre: genre === "billet" ? "Ce billet nomme un inconnu" : "Ce document nomme un inconnu",
          texte: [`Il nomme ${r.question.secrets}, encore inconnu des joueurs.`,
            `Il partira tel que vous l'avez écrit sur le téléphone ${de(et(r.question.pour))} : ${r.question.pour.length > 1 ? "seuls leurs joueurs le liront" : "seul son joueur le lira"}.`],
          oui: "Envoyer quand même", non: "Pas maintenant",
        });
        if (!oui) return;
        r = await api.post(`/api/prives/${genre}`, { ...corps, confirme: true });
      }
      // Le choix « Remettre à… » se referme : le bloc se redessine avec « remis à … », puis « lu ».
      b.closest("details")?.removeAttribute("open");
      if (r.etat) recu(r.etat);
      this.dire(genre, r);
      this.apres(r, genre, corps);
    } catch (err) {
      toast(`Rien d'envoyé : ${err.message}`, "erreur");
    } finally {
      this.occupe = false;
      if (b.isConnected) b.disabled = false;
    }
  }

  dire(genre, r) {
    const morceaux = [];
    if (r.envoyes.length) morceaux.push(`${genre === "billet" ? "Billet envoyé" : "Document remis"} sur le téléphone ${de(et(r.envoyes))}${genre === "document" ? " : ni la TV, ni «\u00a0Documents reçus\u00a0» ne le montrent" : ""}.`);
    if (r.envoyes.length && r.masque) morceaux.push("Le nom caché de l'auberge y devient celui que lisent les joueurs.");
    else if (r.inchanges.length) morceaux.push(`${et(r.inchanges)} ${r.inchanges.length > 1 ? "l'ont" : "l'a"} déjà, tel quel.`);
    for (const x of r.bloques || []) morceaux.push(`Pas envoyé à ${x.pour} : ${x.raison}. Dites-le-lui de vive voix, ou imprimez-le.`);
    if ((r.papier || []).length) morceaux.push(`${et(r.papier)} : pas de joueur relié, sur papier.`);
    toast(morceaux.join(" "), (r.bloques || []).length && !r.envoyes.length ? "erreur" : "info");
  }

  async retirer(b, id) {
    b.disabled = true;
    try {
      const r = await api.del(`/api/prives/${encodeURIComponent(id)}`);
      if (r.etat) recu(r.etat);
      toast(`Repris du téléphone ${de(r.retire)} : il n'y est plus.`);
    } catch (err) {
      if (b.isConnected) b.disabled = false;
      toast(`Rien de repris : ${err.message}`, "erreur");
    }
  }
}
