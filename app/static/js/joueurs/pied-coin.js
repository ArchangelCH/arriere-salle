// Le bas des pages du coin : « Changer mon mot de passe » (un simple lien vers /compte) et « Se déconnecter », ici.
// Tout bouton [data-deconnexion] de la page s'en sert, celui de la page du compte compris.

document.addEventListener("click", async (ev) => {
  const bouton = ev.target.closest("[data-deconnexion]");
  if (!bouton || bouton.disabled) return;
  bouton.disabled = true;
  try {
    const r = await fetch("/api/deconnexion", { method: "POST" });
    if (!r.ok) throw new Error(String(r.status));
  } catch {
    // Hors ligne : rien n'a changé, le bouton se rend pour réessayer.
    bouton.disabled = false;
    return;
  }
  location.replace("/connexion?raison=deconnecte");
});
