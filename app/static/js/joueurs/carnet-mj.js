// L'interrupteur du carnet des joueurs, dans la page Réglages (section Coin des joueurs) : ouvert, chaque joueur
// retrouve depuis son compte ce que l'atelier publie pour lui (carnet.py) ; fermé, son coin ne montre ni le carnet ni
// les boutiques. En dessous, ce que lisent les joueurs en ce moment, section par section, et ce que le
// carnet retient (ou retiendrait, avant d'ouvrir) parce que cela nomme une fiche encore inconnue des joueurs.

import { api, echapper as e, toast } from "../api.js";

const NOMS = [
  ["precedemment", "« Précédemment »", "« Précédemment »"], ["personnages", "personnage", "personnages"], ["lieux", "lieu", "lieux"],
  ["contrats", "contrat pris", "contrats pris"], ["rumeurs", "rumeur entendue", "rumeurs entendues"], ["documents", "document reçu", "documents reçus"],
  ["regles", "règle de table", "règles de table"],
  ["compagnie", "héros de la compagnie", "héros de la compagnie"], ["heros", "fiche de joueur", "fiches de joueurs"],
  ["boutiques", "boutique ouverte", "boutiques ouvertes"], ["sanctuaire", "fiche du sanctuaire", "fiches du sanctuaire"],
];

function quand(iso) {
  const d = new Date(iso || "");
  if (Number.isNaN(d.getTime())) return "";
  const jour = d.toDateString() === new Date().toDateString() ? "aujourd'hui" : `le ${d.toLocaleDateString("fr-CH", { day: "numeric", month: "long" })}`;
  return `${jour} à ${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
}

// Ce que le carnet garde pour lui (un rôle qui nomme un lieu inconnu, une fiche illisible) : le MJ coche « Connu des
// joueurs » sur la fiche nommée, ou retouche le texte, et le carnet le publie au passage suivant.
function retenus(etat) {
  const liste = etat.retenus || [];
  if (!liste.length) return "";
  return `<div class="retenus-carnet" role="status">
    <p><b>${etat.ouvert ? "Retenu pour ne rien dévoiler" : "Si vous ouvrez, ceci restera caché pour ne rien dévoiler"}</b></p>
    <ul>${liste.map((x) => `<li>${e(x)}</li>`).join("")}</ul>
    <p class="aide">Cochez « Connu des joueurs » sur la fiche nommée, ou retouchez le texte : le carnet le reprend de lui-même.</p>
  </div>`;
}

// Les héros de la tablée qu'aucun lien ne lit : leur joueur ne voit pas sa fiche et ne commande rien (Isaure, créée ici
// pour Jeanne). « Relier à… » sur l'invitation du joueur règle cela.
function sansLien(etat) {
  const liste = etat.sans_lien || [];
  if (!liste.length) return "";
  const noms = liste.map((a) => `${a.nom}${a.joueur ? ` (${a.joueur})` : ""}`).join(", ");
  return `<div class="sans-lien-carnet" role="status">
    <p><b>Sans lien</b> ${e(noms)}</p>
    <p class="aide">${liste.length > 1 ? "Leurs joueurs ne voient pas leur fiche" : "Son joueur ne voit pas sa fiche"} et ne peu${liste.length > 1 ? "vent" : "t"} rien commander : invitez-${liste.length > 1 ? "les" : "le"} (section Accès), puis « Relier à… » sur ${liste.length > 1 ? "leur carte" : "sa carte"}, <a href="#/aventuriers">onglet Aventuriers</a>.</p>
  </div>`;
}

function contenu(etat) {
  if (!etat.ouvert) return "Fermé : le coin des joueurs ne montre ni le carnet ni les boutiques, seulement le créateur d'aventurier.";
  const s = etat.sections || {};
  const morceaux = NOMS.map(([cle, un, plusieurs]) => (s[cle] ? `${s[cle]} ${s[cle] > 1 ? plusieurs : un}` : "")).filter(Boolean);
  const maj = quand(etat.maj);
  return `Ouvert${maj ? `, mis à jour ${maj}` : ""} : ${morceaux.length ? morceaux.join(", ") : "rien encore à lire"}.`;
}

export async function interrupteurCarnet(zone) {
  if (!zone) return;
  let etat;
  try {
    etat = await api.get("/api/carnet-joueurs");
  } catch (err) {
    zone.innerHTML = `<p class="alerte">Carnet des joueurs indisponible : ${e(err.message)}</p>`;
    return;
  }
  zone.innerHTML = `
    <h3>Carnet des joueurs</h3>
    <div class="choix-publique choix-carnet" role="group" aria-label="Carnet des joueurs">
      <button type="button" data-carnet="oui" aria-pressed="${etat.ouvert}">Ouvert</button>
      <button type="button" data-carnet="non" aria-pressed="${!etat.ouvert}">Fermé</button>
    </div>
    <p class="etat-carnet">${e(contenu(etat))}</p>
    ${sansLien(etat)}
    ${retenus(etat)}
    <p class="aide">Chaque joueur y relit le « Précédemment » des séances closes, les personnages et les lieux connus, les contrats pris, les rumeurs entendues, les documents montrés à la TV, les règles de la table, les héros de la compagnie tels que la TV les montre et sa propre fiche, puis passe commande dans les boutiques ouvertes aux joueurs. Rien de ce qui est noté pour le MJ.</p>`;
  for (const b of zone.querySelectorAll("[data-carnet]")) {
    b.addEventListener("click", async () => {
      const ouvert = b.dataset.carnet === "oui";
      if (ouvert === etat.ouvert) return;
      try {
        await api.put("/api/carnet-joueurs", { ouvert });
        toast(ouvert ? "Carnet ouvert : les joueurs le lisent dans leur coin." : "Carnet fermé : les joueurs ne voient plus que leur créateur d'aventurier.");
      } catch (err) {
        toast(`Carnet non changé : ${err.message}`, "erreur");
      }
      interrupteurCarnet(zone);
    });
  }
}
