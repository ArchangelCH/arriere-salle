// « Changer mon mot de passe » (page Réglages, section Accès) : le MJ connecté change le sien, l'actuel d'abord
// (POST /api/mj/mot-de-passe, mot_de_passe_mj.py). Toutes ses autres sessions et ses appareils reconnus tombent ; celui-ci
// reste dans l'atelier (une session neuve en ligne, ou le même appareil reconnu de nouveau sur le réseau local).

import { api, echapper as e, toast } from "../api.js";

const MIN = 12;

export async function blocMotDePasse(zone, { apres = () => {} } = {}) {
  if (!zone) return;
  let moi = null;
  let porte = null;
  try {
    [moi, porte] = await Promise.all([api.get("/api/moi"), api.get("/api/mj/appareils").catch(() => null)]);
  } catch {
    zone.innerHTML = '<section class="bloc mot-de-passe-mj"><h2>Mon mot de passe</h2><p class="aide">Le compte ne se lit pas pour l\'instant.</p></section>';
    return;
  }
  if (!zone.isConnected) return;
  // Sur le réseau local, porte endormie : l'atelier s'y ouvre sans mot de passe, il sert en ligne (et plus tard au LAN).
  const lanOuvert = porte && porte.lan && porte.porte !== "eveillee";
  zone.innerHTML = `
    <section class="bloc mot-de-passe-mj">
      <h2>Mon mot de passe</h2>
      <p>Celui du compte <b>${e(moi.nom)}</b> : il ouvre l'atelier depuis Internet, et sur un appareil que le réseau local ne reconnaît pas.</p>
      <form class="changer-mot-de-passe" autocomplete="on">
        <label class="champ">Mot de passe actuel<input type="password" name="actuel" autocomplete="current-password" required maxlength="256"></label>
        <label class="champ">Nouveau mot de passe<input type="password" name="nouveau" autocomplete="new-password" required minlength="${MIN}" maxlength="128"></label>
        <label class="champ">Encore une fois<input type="password" name="confirmation" autocomplete="new-password" required minlength="${MIN}" maxlength="128"></label>
        <div class="actions"><button class="principal" type="submit">Changer mon mot de passe</button></div>
      </form>
      <p class="aide">${MIN} caractères au moins. Vos autres appareils sont déconnectés, ceux que vous aviez reconnus aussi : ils vous redemanderont votre identifiant et ce nouveau mot de passe. Cet appareil reste connecté.${lanOuvert ? " Sur le réseau local, l'atelier s'ouvre aujourd'hui sans mot de passe : celui-ci sert depuis Internet, et quand le réseau local se fermera." : ""}</p>
    </section>`;
  const form = zone.querySelector("form");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    if (f.nouveau.value.length < MIN) return toast(`Le nouveau mot de passe : ${MIN} caractères au moins.`, "erreur");
    if (f.nouveau.value !== f.confirmation.value) return toast("Les deux nouveaux mots de passe ne sont pas les mêmes.", "erreur");
    const bouton = f.querySelector("button");
    bouton.disabled = true;
    try {
      await api.post("/api/mj/mot-de-passe", { actuel: f.actuel.value, nouveau: f.nouveau.value, confirmation: f.confirmation.value });
      f.reset();
      toast("Mot de passe changé. Vos autres appareils sont déconnectés ; celui-ci reste connecté.");
      apres();
    } catch (err) {
      toast(err.message, "erreur");
      if (err.status === 403) {
        f.actuel.value = "";
        f.actuel.focus();
      }
    } finally {
      bouton.disabled = false;
    }
  });
}
