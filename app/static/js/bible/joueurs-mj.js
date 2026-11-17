// L'interrupteur « Bible ouverte aux joueurs », dans la page Réglages (section Coin des joueurs). Ouverte, le coin des
// joueurs lit la copie que l'atelier publie pour eux (bible.py : la liste blanche, passée par le masque) ; fermée, il
// répond « La bible n'est pas ouverte » et rien n'en reste dans les propositions. Sous la recherche de l'onglet Bible,
// où il vivait avant, une ligne dit seulement où elle en est, avec le lien vers les Réglages. Pour le MJ principal
// seulement : le coin ne sert pas ce module.

import { api, echapper as e, toast } from "../api.js";

function taille(octets) {
  if (!octets) return "";
  return octets >= 1e6 ? `${(octets / 1e6).toLocaleString("fr-CH", { maximumFractionDigits: 1 })} Mo` : `${Math.max(1, Math.round(octets / 1e3))} Ko`;
}

function quand(iso) {
  const d = new Date(iso || "");
  if (Number.isNaN(d.getTime())) return "";
  const jour = d.toDateString() === new Date().toDateString() ? "aujourd'hui" : `le ${d.toLocaleDateString("fr-CH", { day: "numeric", month: "long" })}`;
  return `${jour} à ${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
}

function etatEnClair(etat) {
  if (!etat.ouverte) return "Fermée : le coin des joueurs répond « La bible n'est pas ouverte ».";
  const maj = quand(etat.maj);
  const n = etat.documents || 0;
  return `Ouverte : ${n} document${n > 1 ? "s" : ""}${etat.octets ? ` (${taille(etat.octets)})` : ""}${maj ? `, à jour ${maj}` : ""}.`;
}

// Ce qui reste au MJ : les documents de la bible hors de la liste blanche, les Contrôles comptés à part.
function fermes(etat) {
  const liste = etat.fermes || [];
  const controles = liste.filter((d) => d.rubrique === "Contrôles").length;
  const autres = liste.filter((d) => d.rubrique !== "Contrôles").map((d) => `« ${d.titre} »`);
  if (controles) autres.push(`${controles > 1 ? `les ${controles} Contrôles` : "le Contrôle"}`);
  return autres.length ? `Restent pour vous : ${autres.join(", ")}.` : "";
}

function dessiner(zone, etat) {
  const retenus = etat.retenus || [];
  zone.innerHTML = `
    <div class="choix-publique" role="group" aria-label="Bible ouverte aux joueurs">
      <button type="button" data-bible="oui" aria-pressed="${etat.ouverte}">Ouverte</button>
      <button type="button" data-bible="non" aria-pressed="${!etat.ouverte}">Fermée</button>
    </div>
    <p class="aide etat-bible-joueurs">${e(etatEnClair(etat))}</p>
    ${retenus.length ? `<p class="alerte">Retenu, le nom caché de l'auberge y resterait : ${e(retenus.join(", "))}</p>` : ""}
    <p class="aide">Depuis leur coin, les joueurs lisent et fouillent les chapitres, les synthèses et arbitrages, le glossaire, l'inventaire et les fiches d'épisode. ${e(fermes(etat))}</p>`;
  for (const b of zone.querySelectorAll("[data-bible]")) {
    b.addEventListener("click", async () => {
      const ouverte = b.dataset.bible === "oui";
      if (ouverte === etat.ouverte) return;
      for (const x of zone.querySelectorAll("[data-bible]")) x.disabled = true;
      try {
        const suite = await api.put("/api/bible-joueurs", { ouverte });
        toast(ouverte ? "Bible ouverte : les joueurs la lisent depuis leur coin." : "Bible fermée aux joueurs.");
        dessiner(zone, suite);
      } catch (err) {
        toast(`Bible non changée : ${err.message}`, "erreur");
        dessiner(zone, etat);
      }
    });
  }
}

// Page Réglages : l'interrupteur, dans un bloc de la section Coin des joueurs.
export async function blocBibleJoueurs(zone) {
  if (!zone) return;
  try {
    dessiner(zone, await api.get("/api/bible-joueurs"));
  } catch (err) {
    zone.innerHTML = `<p class="alerte">Bible des joueurs indisponible : ${e(err.message)}</p>`;
  }
}

// Onglet Bible, sous la recherche : où en est la bible des joueurs, et le lien vers les Réglages.
export async function etatBibleJoueurs(page) {
  const tete = page.querySelector(".bible-nav header");
  if (!tete) return;
  let zone = tete.querySelector(".bible-joueurs");
  if (!zone) {
    zone = document.createElement("div");
    zone.className = "bible-joueurs";
    tete.append(zone);
  }
  let etat;
  try {
    etat = await api.get("/api/bible-joueurs");
  } catch (err) {
    zone.innerHTML = `<p class="alerte">Bible des joueurs indisponible : ${e(err.message)}</p>`;
    return;
  }
  zone.innerHTML = `
    <p class="titre-bible-joueurs">Aux joueurs</p>
    <p class="aide etat-bible-joueurs">${e(etatEnClair(etat))} <a class="vers-reglages" href="#/reglages/coin">Réglages</a></p>`;
}
