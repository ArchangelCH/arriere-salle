// Ce que les joueurs voient vraiment de leurs boutiques, dit au MJ là où il en a besoin : sous la case « Ouverte aux
// joueurs » d'une boutique (d14), et dans « Commandes des joueurs » quand aucune n'attend. Le carnet ouvert ou fermé,
// les héros qui peuvent commander, ceux qu'aucun lien ne lit, et « Ouvrir le carnet » d'un clic, avec « Refermer ».

import { api, echapper as e, toast } from "../api.js";

const prenom = (nom) => String(nom || "").trim().split(/[\s,]+/)[0] || "";
const enListe = (l) => (l.length > 1 ? `${l.slice(0, -1).join(", ")} et ${l[l.length - 1]}` : l[0] || "");

async function lire() {
  const [carnet, joueurs] = await Promise.all([api.get("/api/carnet-joueurs"), api.get("/api/joueurs")]);
  return {
    carnet,
    commandent: joueurs.filter((j) => j.heros).map((j) => `${prenom(j.heros.nom)} (${j.nom})`),
    sansLien: (carnet.sans_lien || []).map((a) => `${prenom(a.nom)}${a.joueur ? ` (${a.joueur})` : ""}`),
  };
}

async function ouvrirLeCarnet(apres) {
  try {
    await api.put("/api/carnet-joueurs", { ouvert: true });
    toast("Carnet ouvert : les joueurs le lisent depuis leur lien, boutiques comprises.", "info", {
      action: { libelle: "Refermer", faire: () => api.put("/api/carnet-joueurs", { ouvert: false }).then(apres, (err) => toast(`Carnet non refermé : ${err.message}`, "erreur")) },
    });
  } catch (err) {
    toast(`Carnet non ouvert : ${err.message}`, "erreur");
  }
  apres();
}

function brancher(zone, apres) {
  zone.querySelector("[data-ouvrir-carnet]")?.addEventListener("click", () => ouvrirLeCarnet(apres));
}

const bouton = '<button type="button" class="principal" data-ouvrir-carnet>Ouvrir le carnet</button>';

// Sous la case de la boutique : rien tant qu'elle n'est pas cochée, sinon ce qui se passe vraiment chez les joueurs.
export async function etatAuxJoueurs(zone, boutique) {
  if (!zone) return;
  if (boutique?.ouverte_joueurs !== true) {
    zone.hidden = true;
    zone.innerHTML = "";
    return;
  }
  let x;
  try {
    x = await lire();
  } catch (err) {
    zone.hidden = false;
    zone.innerHTML = `<p class="alerte">État du carnet des joueurs indisponible : ${e(err.message)}</p>`;
    return;
  }
  if (!zone.isConnected) return;
  const nom = String(boutique.nom || "").split(/\s+/).filter(Boolean).join(" ");
  const retenus = (x.carnet.retenus || []).filter((r) => nom && r.includes(`« ${nom} »`));
  zone.hidden = false;
  zone.classList.toggle("ferme", !x.carnet.ouvert);
  zone.innerHTML = !x.carnet.ouvert
    ? `<p><b>Carnet des joueurs fermé</b> : ils ne voient pas cette boutique.</p><div class="actions">${bouton}</div>`
    : `<p><b>Les joueurs la voient</b> depuis leur lien.${x.commandent.length ? ` Peuvent commander : ${e(enListe(x.commandent))}.` : " Aucun héros ne peut encore commander : accueillez les aventuriers des joueurs, ou reliez vos héros à leur lien (onglet Aventuriers)."}</p>
      ${x.sansLien.length ? `<p class="aide">Sans lien, ne commandent pas : ${e(enListe(x.sansLien))}.</p>` : ""}
      ${retenus.length ? `<ul class="retenus-boutique">${retenus.map((r) => `<li>${e(r)}</li>`).join("")}</ul>` : ""}`;
  brancher(zone, () => etatAuxJoueurs(zone, boutique));
}

// « Aucune commande en attente », et pourquoi : le carnet fermé, aucune boutique ouverte, aucun héros relié.
export async function pourquoiSansCommande(zone) {
  if (!zone) return;
  let x;
  try {
    x = await lire();
  } catch {
    return;
  }
  if (!zone.isConnected) return;
  const boutiques = x.carnet.sections?.boutiques || 0;
  zone.innerHTML = !x.carnet.ouvert
    ? `<p>Le carnet des joueurs est fermé : personne ne peut commander, ni même voir les boutiques.</p><div class="actions">${bouton}</div>`
    : !boutiques ? "<p>Aucune boutique n'est ouverte aux joueurs : cochez « Ouverte aux joueurs » sur celles qu'ils peuvent parcourir.</p>"
    : !x.commandent.length ? "<p>Aucun joueur n'a encore son héros à la tablée : accueillez leurs aventuriers, ou reliez vos héros à leur lien (onglet Aventuriers).</p>"
    : `<p>Le carnet est ouvert, ${boutiques > 1 ? `${boutiques} boutiques sont ouvertes` : "une boutique est ouverte"} aux joueurs, et ${e(enListe(x.commandent))} ${x.commandent.length > 1 ? "peuvent" : "peut"} commander. Leurs commandes paraîtront ici.</p>
      ${x.sansLien.length ? `<p>Sans lien, ne commandent pas : ${e(enListe(x.sansLien))}.</p>` : ""}`;
  brancher(zone, () => pourquoiSansCommande(zone));
}
