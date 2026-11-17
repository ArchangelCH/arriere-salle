// « Les MJ » (page Réglages, section Accès, au compte principal) : les MJ invités à mener des quêtes annexes
// (comptes_mj.py). Le bloc ne paraît que si le serveur ouvre les invitations : tant qu'elles restent fermées, il reste
// vide.
//
// La clé d'un lien d'invitation est tirée au sort ici, par le navigateur : le serveur n'en garde que l'empreinte, et
// aucune de ses réponses ne la contient. Le lien ne s'affiche qu'une fois, le temps de le copier ; perdu, « Nouveau
// lien » en fait un autre (l'ancien cesse de marcher).
//
// Un invité n'entre qu'avec le cloisonnement en strict (comptes_mj.invites_permis, lot MJ-7) : en veille, le bloc le dit
// et ne propose ni lien ni nouveau lien (le serveur les refuserait).
//
// Chaque invité a un budget de rédaction par mois (budget_mj.py, 3 $ par défaut) : ce qu'il a dépensé, lu dans
// /api/ia/couts (la part de chaque invité, jamais le détail de ses demandes), et le champ pour le régler. Une demande
// qui le dépasserait ne part pas. Dans la page Réglages, ce budget vit dans la section Rédaction (blocBudgetsDesMJ) ;
// « Les MJ » le tait alors (budgets: false).

import { api, echapper as e, toast } from "../api.js";
import { demander } from "../commun/dialogue.js";

const dollars = (v) => `${v > 0 && v < 0.01 ? "moins de 0,01" : Number(v || 0).toFixed(2).replace(".", ",")} $`;
const BUDGET_MAX = 100;

const ETATS = {
  principal: "Vous",
  "lien-a-ouvrir": "Lien pas encore ouvert",
  "lien-expire": "Lien expiré : envoyez-en un nouveau",
  actif: "Accès ouvert",
  "sans-acces": "Sans accès",
  ferme: "Fermé",
};

// 24 octets tirés au sort, en base64 sans remplissage : 32 caractères. getRandomValues marche aussi en http (LAN).
export function tirerCle() {
  const octets = new Uint8Array(24);
  crypto.getRandomValues(octets);
  return btoa(String.fromCharCode(...octets)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function lienInvitation(adresse, cle) {
  return `${(adresse || location.origin).replace(/\/$/, "")}/connexion/invitation#cle=${cle}`;
}

export async function blocDesMJ(zone, { budgets = true } = {}) {
  if (!zone) return;
  let etat, couts;
  try {
    [etat, couts] = await Promise.all([api.get("/api/mj/comptes"), api.get("/api/ia/couts").catch(() => null)]);
  } catch {
    return;
  }
  if (!etat.invitations || !zone.isConnected) return;
  const vue = { zone, etat, couts, lien: null, budgets, dessin: dessiner };
  dessiner(vue);
  zone.addEventListener("submit", (ev) => inviter(vue, ev));
  zone.addEventListener("submit", (ev) => reglerBudget(vue, ev));
  zone.addEventListener("click", (ev) => cliquer(vue, ev));
}

// Le budget de rédaction de chaque MJ invité, seul (page Réglages, section Rédaction) : vide tant que les invitations
// restent fermées, comme « Les MJ ».
export async function blocBudgetsDesMJ(zone) {
  if (!zone) return;
  let etat, couts;
  try {
    [etat, couts] = await Promise.all([api.get("/api/mj/comptes"), api.get("/api/ia/couts").catch(() => null)]);
  } catch {
    return;
  }
  if (!etat.invitations || !zone.isConnected) return;
  const vue = { zone, etat, couts, lien: null, budgets: true, dessin: dessinerBudgets };
  dessinerBudgets(vue);
  zone.addEventListener("submit", (ev) => reglerBudget(vue, ev));
  // Un MJ invité ou fermé dans « Les MJ » (section Accès de la même page) : la liste des budgets suit, sans recharger.
  const suivre = () => {
    if (!zone.isConnected) return document.removeEventListener(COMPTES_CHANGES, suivre);
    recharger(vue).catch(() => {});
  };
  document.addEventListener(COMPTES_CHANGES, suivre);
}

// « Les MJ » a changé un compte (invité, nouveau lien, fermé) : le bloc des budgets de la page Réglages se relit.
const COMPTES_CHANGES = "mj-comptes-changes";
const annoncerComptes = () => document.dispatchEvent(new CustomEvent(COMPTES_CHANGES));

function dessinerBudgets(vue) {
  const ouverts = vue.etat.comptes.filter((c) => c.role !== "principal" && c.etat !== "ferme");
  vue.zone.innerHTML = `
    <section class="bloc joueurs-en-ligne budgets-mj">
      <h2>Le budget des autres MJ</h2>
      <p>Chaque MJ invité a son budget de rédaction pour le mois : une demande qui le dépasserait ne part pas.</p>
      <ul class="liste-joueurs liste-mj">${ouverts.length ? ouverts.map((c) => `
        <li class="joueur-en-ligne" data-etat="${e(c.etat)}" data-mj="${e(c.id)}">
          <div class="qui"><b>${e(c.nom)}</b><span class="etat-joueur">${e(ETATS[c.etat] || c.etat)}</span></div>
          ${blocBudget(vue, c)}
        </li>`).join("") : '<li class="aide">Aucun autre MJ pour l\'instant.</li>'}
      </ul>
    </section>`;
}

// Ce qu'un invité a dépensé ce mois-ci (ses demandes notées, plus ses relectures différées pas encore revenues) et son
// budget, avec le champ qui le règle.
function blocBudget(vue, c) {
  if (c.etat === "ferme") return "";
  const part = (vue.couts?.mj || []).find((m) => m.compte === c.id);
  const b = part?.budget;
  const budget = Number(c.budget_mois ?? 3);
  const mois = vue.couts?.mois ? new Date(`${vue.couts.mois}-01T12:00:00`).toLocaleDateString("fr-CH", { month: "long" }) : "ce mois";
  return `
    <form class="budget-mj" data-budget-mj="${e(c.id)}">
      <p class="compte-joueur depense-mj"${b?.atteint ? " data-atteint" : ""}>Rédaction en ${e(mois)} : <b>${dollars(b ? b.depense : part?.cout || 0)}</b> sur ${dollars(budget)}${b?.atteint ? ". Budget atteint : ses demandes ne partent plus." : ""}</p>
      <label class="champ">Budget du mois, en dollars<input type="number" name="budget" min="0" max="${BUDGET_MAX}" step="0.01" value="${e(budget)}" inputmode="decimal"></label>
      <button type="submit">Enregistrer</button>
    </form>`;
}

async function reglerBudget(vue, ev) {
  const f = ev.target.closest(".budget-mj");
  if (!f) return;
  ev.preventDefault();
  const valeur = Number(f.budget.value);
  if (f.budget.value === "" || !Number.isFinite(valeur) || valeur < 0 || valeur > BUDGET_MAX) {
    return toast(`Budget du mois : de 0 à ${BUDGET_MAX} dollars.`, "erreur");
  }
  const compte = vue.etat.comptes.find((c) => c.id === f.dataset.budgetMj);
  try {
    await api.put(`/api/mj/comptes/${encodeURIComponent(f.dataset.budgetMj)}/budget`, { budget_mois: valeur });
    await recharger(vue);
    toast(`Budget de rédaction de ${compte?.nom || "ce MJ"} : ${dollars(valeur)} par mois.`);
  } catch (err) {
    toast(`Budget non enregistré : ${err.message}`, "erreur");
  }
}

function dessiner(vue) {
  const { etat, lien } = vue;
  const autres = etat.comptes.filter((c) => c.role !== "principal");
  const veille = etat.strict === false;
  vue.zone.innerHTML = `
    <section class="bloc joueurs-en-ligne les-mj">
      <h2>Les MJ</h2>
      <p>Un autre MJ peut mener des quêtes annexes depuis l'atelier en ligne, avec son propre identifiant. Il voit le monde tel que les joueurs le connaissent, jamais vos scénarios ni vos secrets ; vous ne voyez pas les siens.</p>
      ${veille ? '<p class="alerte mj-en-veille">Le cloisonnement de l\'atelier est en veille : aucun MJ invité ne peut recevoir de lien, se connecter ni entrer par le réseau local tant qu\'il n\'est pas passé en strict (docker-compose.yml, ATELIER_CLOISONNEMENT).</p>' : ""}
      <p class="aide">Son lien sert une fois, pendant sept jours : il y choisit son identifiant et son mot de passe. Mot de passe oublié : « Nouveau lien ».</p>
      <ul class="liste-joueurs liste-mj">${autres.length ? autres.map((c) => `
        <li class="joueur-en-ligne" data-etat="${e(c.etat)}" data-mj="${e(c.id)}">
          <div class="qui"><b>${e(c.nom)}</b><span class="etat-joueur">${e(ETATS[c.etat] || c.etat)}</span>
            <span class="compte-joueur">${c.identifiant ? `Identifiant : ${e(c.identifiant)}` : "Pas encore d'identifiant"}</span>
            ${c.etat === "lien-a-ouvrir" && c.invitation_jusqu_a ? `<span class="aide">lien valable jusqu'au ${e(dateCourte(c.invitation_jusqu_a))}</span>` : ""}</div>
          ${lien && lien.mj === c.id ? `<input class="lien-joueur lien-mj" type="text" readonly value="${e(lien.adresse)}" aria-label="Lien de ${e(c.nom)}">` : ""}
          ${vue.budgets ? blocBudget(vue, c) : ""}
          <div class="actions">
            ${lien && lien.mj === c.id ? `<button data-mj-copier="${e(c.id)}">Copier le lien</button>` : ""}
            <button data-mj-lien="${e(c.id)}"${veille ? " disabled" : ""} title="L'ancien lien cesse de marcher, son mot de passe aussi, et ses appareils sont déconnectés">Nouveau lien</button>
            ${c.etat !== "ferme" ? `<button class="lien-danger" data-mj-fermer="${e(c.id)}" title="Ses appareils sont déconnectés ; ses fiches restent les siennes, invisibles pour vous">Fermer</button>` : ""}
          </div>
        </li>`).join("") : '<li class="aide">Aucun autre MJ pour l\'instant.</li>'}
      </ul>
      ${veille ? "" : `<form class="inviter-mj">
        <label class="champ">Inviter un MJ<input type="text" name="nom" maxlength="60" placeholder="Son prénom" required></label>
        <button class="principal" type="submit">Créer son lien</button>
      </form>`}
    </section>`;
}

function dateCourte(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("fr-CH", { day: "numeric", month: "long" });
}

async function recharger(vue) {
  [vue.etat, vue.couts] = await Promise.all([api.get("/api/mj/comptes"), api.get("/api/ia/couts").catch(() => vue.couts)]);
  vue.dessin(vue);
}

async function inviter(vue, ev) {
  if (!ev.target.closest(".inviter-mj")) return;
  ev.preventDefault();
  const champ = ev.target.querySelector('[name="nom"]');
  const cle = tirerCle();
  try {
    const avant = new Set(vue.etat.comptes.map((c) => c.id));
    vue.etat = await api.post("/api/mj/comptes", { nom: champ.value, cle });
    const neuf = vue.etat.comptes.find((c) => !avant.has(c.id));
    vue.lien = neuf ? { mj: neuf.id, adresse: lienInvitation(vue.etat.adresse, cle) } : null;
    dessiner(vue);
    annoncerComptes();
    if (neuf) await copier(vue, neuf);
  } catch (err) {
    toast(err.message, "erreur");
  }
}

async function copier(vue, compte) {
  const lien = vue.lien?.adresse;
  if (!lien) return;
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(lien);
    else {
      const champ = vue.zone.querySelector(".lien-mj");
      champ?.focus();
      champ?.select();
      if (!document.execCommand("copy")) throw new Error("copie refusée");
    }
    toast(`Lien de ${compte.nom} copié : envoyez-le lui. Il ne s'affichera plus ici.`);
  } catch {
    toast(`Copiez le lien de ${compte.nom} dans son champ (appui long sur l'iPad) : il ne s'affichera plus ici.`);
  }
}

async function cliquer(vue, ev) {
  const b = ev.target.closest("button[data-mj-copier], button[data-mj-lien], button[data-mj-fermer]");
  if (!b) return;
  const compte = vue.etat.comptes.find((c) => c.id === (b.dataset.mjCopier || b.dataset.mjLien || b.dataset.mjFermer));
  if (!compte) return;
  try {
    if (b.dataset.mjCopier) return await copier(vue, compte);
    if (b.dataset.mjLien) {
      if (!(await demander({
        titre: `Un nouveau lien pour ${compte.nom} ?`,
        texte: "L'ancien lien et son mot de passe cessent de marcher, et ses appareils sont déconnectés. En ouvrant le nouveau, il choisit un autre mot de passe.",
        oui: "Créer un nouveau lien",
      }))) return;
      const cle = tirerCle();
      vue.etat = await api.post(`/api/mj/comptes/${encodeURIComponent(compte.id)}/lien`, { cle });
      vue.lien = { mj: compte.id, adresse: lienInvitation(vue.etat.adresse, cle) };
      dessiner(vue);
      return await copier(vue, compte);
    }
    if (!(await demander({
      titre: `Fermer l'accès de ${compte.nom} ?`,
      texte: "Ses appareils sont déconnectés et son lien ne marche plus. Ses fiches restent les siennes : vous ne les voyez pas. « Nouveau lien » le rouvre.",
      oui: "Fermer son accès",
    }))) return;
    vue.etat = await api.post(`/api/mj/comptes/${encodeURIComponent(compte.id)}/fermer`, {});
    if (vue.lien?.mj === compte.id) vue.lien = null;
    dessiner(vue);
    annoncerComptes();
    toast(`Accès de ${compte.nom} fermé.`);
  } catch (err) {
    toast(err.message, "erreur");
    recharger(vue).catch(() => {});
  }
}
