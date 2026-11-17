// Le compte d'un joueur, dans la page Réglages (section Accès, provisoires.py) : « Créer son compte », puis « Nouveau
// mot de passe provisoire » quand il a oublié le sien ; sa carte de l'onglet Aventuriers en garde la ligne d'état. Plus aucun lien à clé : le serveur tire un mot de passe provisoire
// et ne le rend qu'une fois ; le dialogue le montre en grand (à dicter) avec la phrase à transmettre (à copier).

import { api, echapper as e } from "../api.js";
import { demander, montrerUneFois } from "../commun/dialogue.js";

const deux = (n) => String(n).padStart(2, "0");

// « 9 novembre à 14 h 05 », à l'heure de l'appareil du MJ.
export function quand(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("fr-CH", { day: "numeric", month: "long" })} à ${d.getHours()} h ${deux(d.getMinutes())}`;
}

// La ligne d'état de la carte : pas de compte, provisoire en attente (ou expiré), ou le compte et son identifiant.
export function htmlEtatCompte(j) {
  const c = j.compte;
  if (!c) return "Pas de compte";
  const p = c.provisoire;
  if (p) {
    const attente = p.expire ? `provisoire expiré le ${quand(p.jusqu_au)}` : `provisoire en attente depuis le ${quand(p.depuis)}`;
    return c.compte ? `Compte : ${e(c.identifiant)}, nouveau ${attente}`
      : `${attente[0].toUpperCase()}${attente.slice(1)} (identifiant ${e(c.identifiant)})`;
  }
  return `Compte : ${e(c.identifiant)}${c.bloque ? ", à rouvrir par un mot de passe provisoire" : ""}`;
}

// Sans compte ni provisoire : l'identifiant proposé (son prénom en forme simple), que le MJ peut changer, et le bouton.
export function htmlCreerCompte(j) {
  if (j.compte) return "";
  return `<div class="compte-a-creer">
      <label class="champ">Identifiant<input type="text" data-identifiant-de="${e(j.id)}" value="${e(j.identifiant_propose || "")}" maxlength="32" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"></label>
      <button class="principal" data-joueur-compte="${e(j.id)}">Créer son compte</button>
    </div>`;
}

export function htmlBoutonCompte(j) {
  const c = j.compte;
  if (!c) return "";
  if (c.provisoire) return `<button data-joueur-compte="${e(j.id)}" title="Le provisoire d'avant cessera de marcher">Nouveau provisoire</button>`;
  return `<button data-joueur-compte="${e(j.id)}" title="Mot de passe oublié : l'actuel cesse de marcher et ses appareils sont déconnectés">Nouveau mot de passe provisoire</button>`;
}

// Le clic sur « Créer son compte », « Nouveau provisoire » ou « Nouveau mot de passe provisoire ». Vrai si un provisoire a
// été tiré (la carte se relit). Les erreurs du serveur remontent à l'appelant, qui les dit.
export async function tirerProvisoire(bouton, joueurs) {
  const ident = bouton.dataset.joueurCompte;
  const j = joueurs?.find((x) => x.id === ident);
  if (!j) return false;
  const c = j.compte;
  const corps = {};
  if (!c) {
    corps.identifiant = bouton.closest(".joueur-en-ligne")?.querySelector("[data-identifiant-de]")?.value.trim() || "";
  } else if (c.provisoire) {
    if (!(await demander({
      titre: `Un nouveau provisoire pour ${j.nom} ?`,
      texte: "Le provisoire d'avant cessera de marcher, qu'il ait expiré ou non.",
      oui: "Tirer un provisoire",
    }))) return false;
  } else if (!(await demander({
    titre: `Nouveau mot de passe provisoire pour ${j.nom} ?`,
    texte: [`Son mot de passe actuel cessera de marcher, et ${j.nom} sera déconnecté de tous ses appareils.`,
      `Avec le provisoire, il choisira un nouveau mot de passe. Son identifiant (${c.identifiant}) ne change pas.`],
    oui: "Tirer un provisoire", danger: true,
  }))) return false;
  const r = await api.post(`/api/joueurs/${encodeURIComponent(ident)}/provisoire`, corps);
  await montrerUneFois({
    titre: `Le mot de passe provisoire de ${r.nom}`,
    texte: [`Il ne s'affiche qu'une fois : dictez-le, ou copiez la phrase et envoyez-la à ${r.nom}.`,
      `Il sert une seule fois, dans les 7 jours : ${r.nom} se connecte sur ${r.adresse}, puis choisit son propre mot de passe.`],
    enGrand: [["Identifiant", r.compte?.identifiant || ""], ["Mot de passe provisoire", r.provisoire]],
    valeur: r.phrase,
    aide: "Perdu ou oublié : « Nouveau provisoire » en tire un autre.",
    fermer: "C'est noté",
  });
  return true;
}
