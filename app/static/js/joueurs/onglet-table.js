// L'onglet « Table » de la barre du haut n'a lieu d'être que table ouverte : fermée par le MJ, il disparaît (sauf sur la page
// Table elle-même, qui dit alors que la table n'est pas ouverte). Lecture légère (GET /api/table/ouverte, un « oui » ou un
// « non »). De même l'onglet « Quêtes » (le tableau de la semaine) : seulement quand les activités sont ouvertes et le carnet
// aussi, sauf sur la page qu'il montre (GET /api/activites, la réponse du tableau entier : pas de route plus légère).
// Les deux se relisent au chargement, quand la page redevient visible et au retour arrière (Safari la garde en mémoire) ;
// sans réponse (hors ligne, plus connecté), l'onglet reste comme il est.

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

function relire() {
  if (onglet) lire();
  if (quetes) lireQuetes();
}

relire();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") relire();
});
window.addEventListener("pageshow", (ev) => {
  if (ev.persisted) relire();
});
