// L'histoire d'un héros, envoyée depuis le coin des joueurs, dans la boîte « Demandes des joueurs » : une carte
// dans la liste, puis la comparaison, passage par passage. Pour chacun : ce que le joueur change (l'écart mot à mot avec
// ce qu'il lisait), son texte seul, et la fiche d'aujourd'hui quand elle a changé depuis. Le MJ accepte, retouche (son
// texte à la place) ou refuse chaque passage, puis valide d'un geste ; rien n'entre dans la fiche avant. Si la fiche a
// changé depuis ce que le joueur lisait, ou si le carnet garde ce passage, accepter demande de le confirmer : rien ne
// s'écrase à l'aveugle. Ce que le MJ a choisi reste en mémoire tant que la page est ouverte : fermer la comparaison ne
// perd rien. Tout texte passe par echapper.

import { api, echapper as e, toast } from "../api.js";
import { libelleInconnu } from "../pnj/carton-pnj.js";
import { bilan, ecart, htmlEcart } from "../lore/ecart.js";

const paragraphes = (t) => String(t || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${e(x)}</p>`).join("")
  || '<p class="vide">Vide.</p>';
const prenom = (nom) => String(nom || "").split(/[\s,]+/)[0];
const enListe = (l) => (l.length > 1 ? `${l.slice(0, -1).join(", ")} et ${l[l.length - 1]}` : l[0] || "");
const pl = (n) => (n > 1 ? "s" : "");
const DECISIONS = { accepter: "Accepté", retouche: "Retouché", refuser: "Refusé" };
// Les choix en cours, par demande : la comparaison rouverte les retrouve.
const choix = new Map();

function quand(iso) {
  const d = new Date(iso || "");
  if (Number.isNaN(d.getTime())) return "";
  return `le ${d.toLocaleDateString("fr-CH", { day: "numeric", month: "long" })} à ${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
}

// La carte de la liste « À traiter ».
export function htmlCarteLore(x, cle) {
  return `<li class="demande-mj lore" data-cle="${e(cle)}" data-joueur="${e(x.joueur)}" data-id="${e(x.id)}" data-version="${e(x.version)}">
    <p class="quoi"><b>${e(x.genre_nom)}</b> <span class="quand">${e(quand(x.cree))}</span></p>
    ${x.phrase ? `<p class="phrase-demande">${e(x.phrase)}</p>` : ""}
    <div class="actions"><button type="button" class="principal" data-lore-ouvrir>Lire et trancher</button></div></li>`;
}

export class ComparaisonLore {
  constructor(relireBoite) {
    this.relireBoite = relireBoite;
    this.d = null; // le dialogue ouvert
    this.v = null; // la comparaison lue
    this.cle = "";
    this.perimee = false;
  }

  etat() {
    if (!choix.has(this.cle)) choix.set(this.cle, { decisions: {}, vues: {}, retouches: {}, confirmer: {}, mot: "" });
    return choix.get(this.cle);
  }

  async ouvrir(joueur, id) {
    this.fermer();
    this.cle = `${joueur}/${id}`;
    this.perimee = false;
    const d = document.createElement("dialog");
    d.className = "comparaison-lore";
    d.setAttribute("aria-label", "L'histoire du héros");
    d.innerHTML = '<p class="chargement">Lecture de l\'histoire…</p>';
    document.body.append(d);
    d.addEventListener("close", () => {
      this.memoriser();
      d.remove();
      if (this.d === d) this.d = null;
    });
    d.addEventListener("click", (ev) => this.clic(ev));
    d.addEventListener("input", (ev) => this.saisie(ev));
    this.d = d;
    d.showModal();
    await this.lire(joueur, id);
  }

  fermer() {
    if (this.d?.open) this.d.close();
  }

  async lire(joueur = this.v?.joueur.id, id = this.v?.id) {
    let v;
    try {
      v = await api.get(`/api/lore/${encodeURIComponent(joueur)}/${encodeURIComponent(id)}`);
    } catch (err) {
      if (this.d) this.d.innerHTML = `<p class="vide">L'histoire ne s'ouvre pas : ${e(err.message)}.</p><form method="dialog"><button>Fermer</button></form>`;
      return;
    }
    if (!this.d) return;
    // Une fiche qui a changé depuis la dernière lecture : le choix « accepter » de ce passage ne vaut plus.
    const s = this.etat();
    for (const c of v.champs) {
      const avant = this.v?.champs.find((x) => x.cle === c.cle);
      if (avant && avant.empreinte !== c.empreinte && s.decisions[c.cle] !== "refuser") {
        delete s.decisions[c.cle];
        delete s.confirmer[c.cle];
      }
    }
    this.v = v;
    this.dessiner();
  }

  // La boîte vient de se relire : la demande attend-elle encore, à la même version ?
  verifier(vue) {
    if (!this.d || !this.v) return;
    const x = (vue.attente || []).find((a) => a.type === "demande" && a.joueur === this.v.joueur.id && a.id === this.v.id);
    const perimee = !x || x.version !== this.v.version;
    if (perimee === this.perimee) return;
    this.perimee = perimee;
    this.dessiner();
  }

  memoriser() {
    if (!this.d || !this.v) return;
    const s = this.etat();
    const mot = this.d.querySelector("textarea[name=mot]");
    if (mot) s.mot = mot.value;
    for (const t of this.d.querySelectorAll("textarea[data-retouche]")) s.retouches[t.dataset.retouche] = t.value;
  }

  // ------------------------------------------------------------ dessin

  dessiner() {
    const v = this.v;
    const s = this.etat();
    this.memoriser();
    const h = v.heros;
    const qui = v.joueur.nom || "Le joueur";
    const alertes = [];
    if (this.perimee) alertes.push("Cette histoire n'attend plus : le joueur l'a retirée ou renvoyée, ou un autre écran l'a traitée. Fermez, puis rouvrez-la depuis la boîte.");
    if (!h) alertes.push(`${qui} n'a plus de héros à la tablée : rien ne peut entrer dans une fiche. Refusez cette histoire.`);
    else if (!v.sien) alertes.push(`${qui} a écrit cette histoire pour un autre héros que ${h.nom} : refusez-la.`);
    this.d.innerHTML = `
      <header class="tete-comparaison">
        <div>
          <p class="kicker">L'histoire du héros</p>
          <h2>${e(h ? h.nom : "Héros absent")}<small>, par ${e(qui)}</small></h2>
          <p class="aide">Envoyée ${e(quand(v.cree))} : ${v.champs.length} passage${pl(v.champs.length)}. Rien n'entre dans la fiche avant « Valider ». Ce qui est accepté passe ensuite par le masque, comme tout ce que lisent les joueurs.</p>
        </div>
        <form method="dialog"><button class="fermer-lore" value="fermer">Fermer</button></form>
      </header>
      ${alertes.map((a) => `<p class="alerte-lore">${e(a)}</p>`).join("")}
      <div class="passages-lore">${v.champs.map((c) => this.htmlPassage(c, s)).join("")}</div>
      <footer class="pied-comparaison">
        <label class="champ">Un mot pour ${e(qui)} (facultatif)
          <textarea name="mot" rows="2" maxlength="${e(v.mot_max || 300)}" placeholder="Il le lira avec ce que vous avez fait de son histoire">${e(s.mot || "")}</textarea></label>
        <p class="bilan-lore" aria-live="polite"></p>
        <p class="erreur-demande" role="alert" hidden></p>
        <div class="actions">
          <button type="button" data-tout="refuser">Tout refuser</button>
          <button type="button" data-tout="accepter">Tout accepter</button>
          <button type="button" class="principal" data-valider>Valider mes choix</button>
        </div>
      </footer>`;
    this.majPied();
  }

  htmlPassage(c, s) {
    const decision = s.decisions[c.cle] || "";
    const vue = s.vues[c.cle] || "ecart";
    const qui = prenom(this.v.joueur.nom) || "le joueur";
    const alertes = [];
    if (c.tenu) alertes.push(`Le carnet garde ce passage pour vous : il nomme ce que les joueurs ne savent pas encore, ou le vrai nom de l'auberge. ${qui} ne l'a donc jamais lu tel quel ; accepter remplacerait votre texte.`);
    else if (c.change_depuis) alertes.push(`La fiche a changé depuis que ${qui} a lu ce passage : accepter remplacerait la version d'aujourd'hui, qu'il n'a pas lue. Comparez avec « La fiche aujourd'hui ».`);
    const avis = [];
    // Accepté tel quel, le joueur verrait son passage gardé (ou changé) : il comprendrait qu'il a touché juste.
    if (c.secrets.length) avis.push(`Ce texte nomme ${enListe(c.secrets.map(libelleInconnu))} : accepté, il entre dans la fiche, mais reste hors du carnet${c.cle === "allure" ? " et de la TV" : ""} tant que ${c.secrets.length > 1 ? "ils restent inconnus" : "ce nom reste inconnu"} des joueurs. ${qui} verrait alors ce passage gardé, et comprendrait qu'il a touché juste : retouchez-le si vous préférez.`);
    if (c.auberge) avis.push(`Ce texte écrit le vrai nom de l'auberge : les joueurs liront « l'auberge » à sa place, et ${qui} verrait ce passage gardé. Retouchez-le si vous préférez qu'il ne le remarque pas.`);
    const b = bilan(ecart(c.vu, c.propose));
    const onglets = [["ecart", "Ce qui change"], ["propose", "Le texte proposé"]];
    if (c.change_depuis) onglets.push(["fiche", "La fiche aujourd'hui"], ["ecart-fiche", "Écart avec la fiche"]);
    let corps;
    if (vue === "propose") corps = paragraphes(c.propose);
    else if (vue === "fiche") corps = paragraphes(c.actuel);
    else if (vue === "ecart-fiche") corps = `<p class="ecart-lore">${htmlEcart(ecart(c.actuel, c.propose), e)}</p>`;
    else corps = `<p class="ecart-lore">${htmlEcart(ecart(c.vu, c.propose), e)}</p>`;
    const retouche = decision === "retouche-en-cours" || decision === "retouche";
    const confirmer = s.confirmer[c.cle];
    const bloque = this.perimee || !this.v.heros || !this.v.sien;
    let actions;
    if (retouche && decision === "retouche-en-cours") {
      actions = `<label class="champ retouche-lore">Votre version de ce passage
          <textarea data-retouche="${e(c.cle)}" rows="6" maxlength="${e(this.v.long)}">${e(s.retouches[c.cle] ?? c.propose)}</textarea></label>
        <div class="actions">
          ${c.change_depuis ? `<button type="button" data-partir="${e(c.cle)}">Partir de la fiche</button>` : ""}
          <button type="button" data-partir-joueur="${e(c.cle)}">Repartir du texte de ${e(qui)}</button>
          <button type="button" data-annuler-choix="${e(c.cle)}">Laisser</button>
          <button type="button" class="principal" data-garder-retouche="${e(c.cle)}">Accepter ma version</button>
        </div>`;
    } else if (confirmer) {
      actions = `<p class="confirmer-lore">${e(c.tenu ? "Votre texte gardé sera remplacé par celui du joueur." : "La version d'aujourd'hui sera remplacée par le texte du joueur.")}</p>
        <div class="actions"><button type="button" data-annuler-choix="${e(c.cle)}">Laisser</button>
          <button type="button" data-decision="retouche" data-cle-lore="${e(c.cle)}">Retoucher plutôt</button>
          <button type="button" class="principal" data-ecraser="${e(c.cle)}">Remplacer quand même</button></div>`;
    } else if (decision) {
      actions = `<div class="actions"><button type="button" data-annuler-choix="${e(c.cle)}">Changer d'avis</button></div>`;
    } else {
      actions = `<div class="actions">
        <button type="button" data-decision="refuser" data-cle-lore="${e(c.cle)}"${this.perimee ? " disabled" : ""}>Refuser ce passage</button>
        <button type="button" data-decision="retouche" data-cle-lore="${e(c.cle)}"${bloque ? " disabled" : ""}>Retoucher</button>
        <button type="button" class="principal" data-decision="accepter" data-cle-lore="${e(c.cle)}"${bloque ? " disabled" : ""}>Accepter ce passage</button></div>`;
    }
    const final = decision === "retouche" ? `<div class="version-retenue"><p class="lbl">Votre version, retenue</p>${paragraphes(s.retouches[c.cle])}</div>` : "";
    return `<section class="passage-lore" data-passage-lore="${e(c.cle)}" data-decision="${e(decision)}">
      <header><h3>${e(c.nom)}</h3><span class="decision-lore">${e(DECISIONS[decision] || (decision === "retouche-en-cours" ? "Retouche en cours" : "À trancher"))}</span></header>
      ${alertes.map((a) => `<p class="alerte-lore">${e(a)}</p>`).join("")}
      ${avis.map((a) => `<p class="avis-lore">${e(a)}</p>`).join("")}
      <div class="vues-lore" role="group" aria-label="Lire ce passage">${onglets.map(([k, nom]) => `<button type="button" data-vue="${k}" data-cle-lore="${e(c.cle)}" aria-pressed="${vue === k}">${e(nom)}</button>`).join("")}
        <span class="compte-lore">${e(b.ajoutes || b.retires ? `${b.ajoutes} mot${pl(b.ajoutes)} ajouté${pl(b.ajoutes)}, ${b.retires} retiré${pl(b.retires)}` : "aucun mot changé")}</span></div>
      <div class="texte-lore">${corps}</div>
      ${final}
      ${actions}
    </section>`;
  }

  // Le pied : combien de passages tranchés, ce que « Valider » fera.
  majPied() {
    const v = this.v;
    const s = this.etat();
    const faits = v.champs.filter((c) => ["accepter", "retouche", "refuser"].includes(s.decisions[c.cle]));
    const acceptes = faits.filter((c) => s.decisions[c.cle] !== "refuser").length;
    const reste = v.champs.length - faits.length;
    const p = this.d.querySelector(".bilan-lore");
    p.textContent = reste
      ? `Encore ${reste} passage${pl(reste)} à trancher.`
      : `${acceptes} passage${pl(acceptes)} accepté${pl(acceptes)}, ${faits.length - acceptes} refusé${pl(faits.length - acceptes)} : « Valider » ${acceptes ? "écrit la fiche et prévient le joueur" : "prévient le joueur"}.`;
    const bloque = this.perimee || this.envoi;
    this.d.querySelector("[data-valider]").disabled = bloque || reste > 0;
    this.d.querySelector('[data-tout="refuser"]').disabled = bloque;
    // « Tout accepter » ne passe pas par-dessus une fiche changée : ces passages se tranchent un à un.
    const conflits = v.champs.filter((c) => c.change_depuis && !s.decisions[c.cle]);
    const tout = this.d.querySelector('[data-tout="accepter"]');
    tout.disabled = bloque || !v.heros || !v.sien || conflits.length > 0;
    tout.title = conflits.length ? `À trancher un à un : ${conflits.map((c) => c.nom).join(", ")} (la fiche a changé depuis).` : "";
  }

  erreur(message) {
    const p = this.d?.querySelector(".erreur-demande");
    if (!p) return toast(message, "erreur");
    p.textContent = message;
    p.hidden = !message;
  }

  // ------------------------------------------------------------ gestes

  saisie(ev) {
    const t = ev.target.closest("textarea[data-retouche]");
    if (t) this.etat().retouches[t.dataset.retouche] = t.value;
    if (ev.target.matches("textarea[name=mot]")) this.etat().mot = ev.target.value;
  }

  redessinerPassage(cle) {
    this.memoriser();
    const s = this.d.querySelector(`[data-passage-lore="${CSS.escape(cle)}"]`);
    const c = this.v.champs.find((x) => x.cle === cle);
    if (!s || !c) return;
    s.outerHTML = this.htmlPassage(c, this.etat());
    this.majPied();
  }

  async clic(ev) {
    const b = ev.target.closest("button");
    if (!b || b.disabled || !this.v) return;
    const s = this.etat();
    const cle = b.dataset.cleLore || b.dataset.annulerChoix || b.dataset.ecraser || b.dataset.partir || b.dataset.partirJoueur || b.dataset.garderRetouche;
    const c = cle ? this.v.champs.find((x) => x.cle === cle) : null;
    if (b.dataset.vue && c) {
      s.vues[cle] = b.dataset.vue;
      return this.redessinerPassage(cle);
    }
    if (b.dataset.decision && c) {
      const d = b.dataset.decision;
      delete s.confirmer[cle];
      if (d === "accepter" && c.change_depuis) s.confirmer[cle] = true;
      else if (d === "retouche") s.decisions[cle] = "retouche-en-cours";
      else s.decisions[cle] = d;
      return this.redessinerPassage(cle);
    }
    if (b.dataset.ecraser && c) {
      delete s.confirmer[cle];
      s.decisions[cle] = "accepter";
      return this.redessinerPassage(cle);
    }
    if (b.dataset.annulerChoix && c) {
      delete s.decisions[cle];
      delete s.confirmer[cle];
      return this.redessinerPassage(cle);
    }
    if ((b.dataset.partir || b.dataset.partirJoueur) && c) {
      s.retouches[cle] = b.dataset.partir ? c.actuel : c.propose;
      const t = this.d.querySelector(`textarea[data-retouche="${CSS.escape(cle)}"]`);
      if (t) t.value = s.retouches[cle];
      return;
    }
    if (b.dataset.garderRetouche && c) {
      this.memoriser();
      if (!String(s.retouches[cle] ?? "").trim() && c.propose.trim()) return this.erreur("Votre version est vide : refusez plutôt ce passage.");
      // Retoucher, c'est avoir lu les deux versions : le texte retenu remplace la fiche sans autre question.
      s.decisions[cle] = String(s.retouches[cle] ?? c.propose) === c.propose ? "accepter" : "retouche";
      this.erreur("");
      return this.redessinerPassage(cle);
    }
    if (b.dataset.tout) {
      for (const x of this.v.champs) {
        if (b.dataset.tout === "refuser") s.decisions[x.cle] = "refuser";
        else if (!s.decisions[x.cle] || s.decisions[x.cle] === "retouche-en-cours") s.decisions[x.cle] = "accepter";
      }
      return this.valider();
    }
    if (b.hasAttribute("data-valider")) return this.valider();
  }

  async valider() {
    const v = this.v;
    const s = this.etat();
    this.memoriser();
    const champs = {};
    for (const c of v.champs) {
      const d = s.decisions[c.cle];
      if (d === "refuser") champs[c.cle] = { decision: "refuser" };
      else if (d === "accepter" || d === "retouche") {
        champs[c.cle] = { decision: "accepter", empreinte: c.empreinte, ecraser: Boolean(c.change_depuis) };
        if (d === "retouche") champs[c.cle].texte = s.retouches[c.cle] ?? c.propose;
      } else return this.erreur(`« ${c.nom} » attend votre choix.`);
    }
    this.envoi = true;
    this.majPied();
    this.erreur("");
    try {
      await api.post(`/api/lore/${encodeURIComponent(v.joueur.id)}/${encodeURIComponent(v.id)}/trancher`, { version: v.version, mot: s.mot || "", champs });
    } catch (err) {
      this.envoi = false;
      this.erreur(err.message);
      if (err.status === 409 || err.status === 404) await this.lire();
      else this.majPied();
      return;
    }
    this.envoi = false;
    const acceptes = Object.values(champs).filter((x) => x.decision === "accepter").length;
    toast(acceptes ? `Histoire de ${v.joueur.nom} : ${acceptes} passage${pl(acceptes)} dans la fiche de ${prenom(v.heros?.nom)}. ${v.joueur.nom} le verra dans son coin.`
      : `Histoire de ${v.joueur.nom} refusée : il le verra dans son coin.`);
    choix.delete(this.cle);
    this.v = null;
    this.fermer();
    this.relireBoite();
  }
}
