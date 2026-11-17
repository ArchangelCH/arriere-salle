// « Vos appareils » (page Réglages, section Accès, pour chaque MJ) : les appareils reconnus sur le réseau local
// (porte_lan.py).
// Le LAN s'ouvre aujourd'hui à tout appareil ; il se fermera dès qu'un autre MJ aura son accès, et seuls les appareils
// reconnus y entreront sans mot de passe. Reconnaître un appareil y pose un cookie de 400 jours, rattaché au compte de la
// page ; « Oublier » le coupe. Le cookie se rattache à l'adresse du LAN : depuis l'atelier en ligne, on peut seulement
// oublier.

//
// Au réveil de la porte, les appareils reconnus pendant qu'elle dormait l'ont été quand le LAN était ouvert à
// tous : rien n'est oublié tout seul, mais la liste paraît en tête de l'atelier (avisEnTete, page marquée
// data-appareils="a-relire" par le serveur) avec l'avis « Relisez vos appareils », jusqu'à « C'est relu ».

import { api, echapper as e, toast } from "../api.js";
import { demander } from "../commun/dialogue.js";

export async function blocDesAppareils(zone, { enTete = false } = {}) {
  if (!zone) return;
  let etat;
  try {
    etat = await api.get("/api/mj/appareils");
  } catch {
    return;
  }
  if (!zone.isConnected) return;
  if (enTete && !etat.a_relire) return zone.remove();
  const vue = { zone, etat, enTete };
  dessiner(vue);
  zone.addEventListener("submit", (ev) => reconnaitre(vue, ev));
  zone.addEventListener("click", (ev) => cliquer(vue, ev));
}

// La liste en tête de l'atelier, au-dessus de la page (qui se redessine à chaque onglet sans la toucher).
export function avisEnTete(page) {
  if (!page || document.querySelector(".avis-appareils")) return;
  const zone = document.createElement("div");
  zone.className = "avis-appareils";
  page.before(zone);
  return blocDesAppareils(zone, { enTete: true });
}

// Safari sur iPad se présente comme un Mac : l'écran tactile le trahit.
function nomPropose(nom) {
  const tactile = navigator.maxTouchPoints > 1 || "ontouchend" in document;
  return /^Mac\b/.test(nom || "") && tactile ? nom.replace(/^Mac/, "iPad") : nom || "";
}

function dateCourte(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-CH", { day: "numeric", month: "long", year: "numeric" });
}

// Les appareils, le plus récemment vu d'abord : les cinq premiers (et celui-ci) en vue, les plus anciens repliés.
function ligneAppareil(a, etat) {
  return `
        <li class="joueur-en-ligne" data-etat="${a.id === etat.cet_appareil ? "accueilli" : "appareil"}" data-appareil="${e(a.id)}">
          <div class="qui"><b>${e(a.nom)}</b>${a.id === etat.cet_appareil ? '<span class="etat-joueur">Cet appareil</span>' : ""}
            <span class="compte-joueur">reconnu le ${e(dateCourte(a.cree))}${a.vu ? `, vu le ${e(dateCourte(a.vu))}` : ""}</span></div>
          <div class="actions"><button class="lien-danger" data-appareil-oublier="${e(a.id)}">Oublier</button></div>
        </li>`;
}

const EN_VUE = 5;
function listeAppareils(etat) {
  if (!etat.appareils.length) return '<ul class="liste-joueurs liste-appareils"><li class="aide">Aucun appareil reconnu pour l\'instant.</li></ul>';
  const vus = etat.appareils.filter((a, i) => i < EN_VUE || a.id === etat.cet_appareil);
  const anciens = etat.appareils.filter((a) => !vus.includes(a));
  return `
      <ul class="liste-joueurs liste-appareils">${vus.map((a) => ligneAppareil(a, etat)).join("")}</ul>
      ${anciens.length ? `<details class="appareils-anciens"><summary>${anciens.length} appareil${anciens.length > 1 ? "s" : ""} plus ancien${anciens.length > 1 ? "s" : ""}</summary>
        <ul class="liste-joueurs liste-appareils">${anciens.map((a) => ligneAppareil(a, etat)).join("")}</ul></details>` : ""}`;
}

function dessiner(vue) {
  const { etat } = vue;
  const fermee = etat.porte === "eveillee";
  const porte = fermee
    ? "Sur le réseau local, l'atelier ne s'ouvre qu'aux appareils reconnus. Un autre appareil passe par l'identifiant et le mot de passe, ce qui le reconnaît. La TV et l'écran de table restent libres."
    : "Sur le réseau local (à la maison, ou par le VPN), l'atelier s'ouvre aujourd'hui à tout appareil. Dès qu'un autre MJ aura son accès, il ne s'ouvrira plus qu'aux appareils reconnus ; les autres passeront par l'identifiant et le mot de passe. La TV et l'écran de table resteront libres.";
  // Reconnu, le même formulaire le renomme (un appareil reconnu à la connexion porte le nom de son navigateur).
  const cet = etat.appareils.find((a) => a.id === etat.cet_appareil);
  let ici;
  if (!etat.lan) ici = '<p class="aide">Un appareil se reconnaît depuis le réseau local : ouvrez-y l\'atelier, à la maison ou par le VPN, puis « Reconnaître cet appareil ». D\'ici, vous pouvez en oublier un.</p>';
  else ici = `
      <form class="inviter-joueur reconnaitre-appareil" data-renommer="${cet ? "oui" : ""}">
        <label class="champ">Nom de cet appareil<input type="text" name="nom" maxlength="40" value="${e(cet ? cet.nom : nomPropose(etat.nom_propose))}" required></label>
        <button class="${cet ? "" : "principal"}" type="submit">${cet ? "Renommer" : "Reconnaître cet appareil"}</button>
      </form>`;
  const relire = etat.a_relire ? `
      <div class="relire-appareils" role="alert">
        <p><b>Relisez vos appareils.</b> Le réseau local s'est fermé le ${e(dateCourte(etat.a_relire))} : seuls les appareils ci-dessous y entrent désormais sans mot de passe. Ceux reconnus avant ce jour l'ont été quand le réseau était ouvert à tous. Oubliez ceux qui ne sont pas à vous ; aucun n'a été oublié sans vous.</p>
        <div class="actions"><button class="principal" data-appareils-relus>C'est relu</button></div>
      </div>` : "";
  vue.zone.innerHTML = `
    <section class="bloc joueurs-en-ligne appareils-mj">
      <h2>Vos appareils</h2>${relire}
      <p>${porte}</p>
      <p class="aide">Reconnaissez une fois chaque appareil dont vous vous servez : le Mac, l'iPad, l'iPhone. Il le reste tant qu'il revient au moins tous les six mois. Un appareil perdu ou prêté : « Oublier ».</p>
      ${ici}
      ${listeAppareils(etat)}
    </section>`;
}

async function reconnaitre(vue, ev) {
  if (!ev.target.closest(".reconnaitre-appareil")) return;
  ev.preventDefault();
  const champ = ev.target.querySelector('[name="nom"]');
  const renommer = ev.target.dataset.renommer === "oui";
  try {
    vue.etat = await api.post("/api/mj/appareils", { nom: champ.value });
    dessiner(vue);
    toast(renommer ? "Nom changé." : "Cet appareil est reconnu : il entrera dans l'atelier quand le réseau local sera fermé.");
  } catch (err) {
    toast(err.message, "erreur");
  }
}

async function relus(vue) {
  try {
    vue.etat = await api.post("/api/mj/appareils/relus", {});
    if (vue.enTete) return vue.zone.remove();
    dessiner(vue);
  } catch (err) {
    toast(err.message, "erreur");
  }
}

async function cliquer(vue, ev) {
  if (ev.target.closest("button[data-appareils-relus]")) return relus(vue);
  const b = ev.target.closest("button[data-appareil-oublier]");
  if (!b) return;
  const a = vue.etat.appareils.find((x) => x.id === b.dataset.appareilOublier);
  if (!a) return;
  const cet = a.id === vue.etat.cet_appareil;
  const fermee = vue.etat.porte === "eveillee";
  const texte = cet
    ? fermee
      ? "Cet appareil ne sera plus reconnu : l'atelier vous demandera aussitôt votre identifiant et votre mot de passe."
      : "Cet appareil ne sera plus reconnu. Rien ne change tant que le réseau local reste ouvert ; ensuite, il passera par l'identifiant et le mot de passe."
    : "Il ne sera plus reconnu : sur le réseau local fermé, il passera par l'identifiant et le mot de passe.";
  if (!(await demander({ titre: `Oublier « ${a.nom} » ?`, texte, oui: "Oublier", danger: true }))) return;
  try {
    vue.etat = await api.del(`/api/mj/appareils/${encodeURIComponent(a.id)}`);
    if (cet && fermee) {
      location.href = "/connexion?suite=" + encodeURIComponent("/" + location.hash);
      return;
    }
    dessiner(vue);
    toast(`« ${a.nom} » n'est plus reconnu.`);
  } catch (err) {
    toast(err.message, "erreur");
  }
}
