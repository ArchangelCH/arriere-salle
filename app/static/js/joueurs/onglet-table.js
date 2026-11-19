// L'onglet « Table » de la barre du haut n'a lieu d'être que table ouverte : fermée par le MJ, il disparaît (sauf sur la page
// Table elle-même, qui dit alors que la table n'est pas ouverte). Une seule lecture légère par page (GET /api/table/ouverte,
// un « oui » ou un « non »), refaite quand la page redevient visible ; sans réponse (hors ligne, plus connecté), l'onglet reste.
// De même l'onglet « Quêtes » (le tableau de la semaine, 19/11) : seulement quand les activités sont ouvertes et le carnet
// aussi (GET /api/activites), sauf sur la page qu'il montre.

const onglet = document.querySelector('.onglets-coin a[href="/table"]');
const quetes = document.querySelector(".onglets-coin [data-quetes]");

async function lireQuetes() {
  try {
    const r = await fetch("/api/activites", { headers: { Accept: "application/json" } });
    if (!r.ok) return;
    const { ouvert, visible } = await r.json();
    quetes.hidden = !(ouvert && visible) && !(location.pathname === "/carnet" && location.hash.startsWith("#activites"));
  } catch {
    // pas de réseau : l'onglet reste comme il est
  }
}

if (quetes) {
  lireQuetes();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") lireQuetes();
  });
}

async function lire() {
  try {
    const r = await fetch("/api/table/ouverte", { headers: { Accept: "application/json" } });
    if (!r.ok) return;
    const { ouverte } = await r.json();
    onglet.hidden = ouverte === false && location.pathname !== "/table";
  } catch {
    // pas de réseau : l'onglet reste comme il est
  }
}

if (onglet) {
  lire();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") lire();
  });
  window.addEventListener("pageshow", (ev) => {
    if (ev.persisted) lire();
  });
}
