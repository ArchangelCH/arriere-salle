// Mettre à la corbeille une carte où des lieux ont leur fiche. Le dialogue propose de les poser d'abord sur une autre
// carte (à leur place exacte quand l'une est le détail de l'autre, sinon au centre, « à valider »), ou de les garder
// sans carte : leur fiche s'ouvre alors seule (lieux/fiche-lieu.js). Rien ne part tant que le MJ n'a pas choisi.

import { api, echapper as e, toast } from "../api.js";
import { tailleMarqueur } from "../carte/outils.js";
import { annoncerCorbeille } from "../corbeille/corbeille.js";

const enListe = (noms) => (noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms.at(-1)}` : noms[0] || "");

// Où tombe un point (x, y) de la carte jetée sur la carte d'accueil, par le cadre de détail qui les relie (l'une est le
// détail de l'autre) ; null s'il n'y en a pas, ou si le point sort du détail.
export function versAccueil(jetee, accueil, x, y) {
  const p = jetee.parent;
  if (p?.carte === accueil.id) return [p.x0 + (x / jetee.largeur) * (p.x1 - p.x0), p.y0 + (y / jetee.hauteur) * (p.y1 - p.y0)];
  const q = accueil.parent;
  if (q?.carte === jetee.id && q.x1 > q.x0 && q.y1 > q.y0) {
    const ax = ((x - q.x0) / (q.x1 - q.x0)) * accueil.largeur;
    const ay = ((y - q.y0) / (q.y1 - q.y0)) * accueil.hauteur;
    if (ax >= 0 && ay >= 0 && ax <= accueil.largeur && ay <= accueil.hauteur) return [ax, ay];
  }
  return null;
}

// Les marqueurs à ajouter à la carte d'accueil pour ces lieux, et ceux dont la place n'est qu'une proposition. Un lieu
// déjà posé sur l'accueil n'y est pas doublé.
export function placer(jetee, accueil, lieux) {
  const k = accueil.taille_textes || 1;
  const deja = new Set((accueil.marqueurs || []).map((m) => m.lieu));
  const sansPlace = [];
  const marqueurs = [];
  const base = Date.now().toString(36);
  for (const l of lieux) {
    if (deja.has(l.id)) continue;
    const m = (jetee.marqueurs || []).find((x) => x.lieu === l.id);
    const point = m ? versAccueil(jetee, accueil, m.x, m.y) : null;
    if (!point) sansPlace.push(l);
    const taille = tailleMarqueur(l.type, k);
    marqueurs.push({ id: `m-${base}${marqueurs.length.toString(36)}`, lieu: l.id, x: point ? +point[0].toFixed(2) : 0, y: point ? +point[1].toFixed(2) : 0, taille });
  }
  // Sans cadre commun : en colonne au centre, les noms l'un sous l'autre, à déplacer (le cercle rouge des positions à
  // valider les signale).
  const pas = Math.min(4 * k, (accueil.hauteur * 0.8) / Math.max(1, sansPlace.length));
  sansPlace.forEach((l, i) => {
    const m = marqueurs.find((x) => x.lieu === l.id);
    m.x = +(accueil.largeur / 2).toFixed(2);
    m.y = +(accueil.hauteur / 2 + (i - (sansPlace.length - 1) / 2) * pas).toFixed(2);
  });
  return { marqueurs, aValider: new Set(sansPlace.map((l) => l.id)) };
}

let dialogue = null;

// carte : la carte de la liste ({ id, nom, parent }) ; lieux : ceux dont c'est la carte ; cartes : toutes les cartes.
// Vrai si la carte est partie à la corbeille.
export function jeterCarte(carte, lieux, cartes) {
  const autres = cartes.filter((c) => c.id !== carte.id);
  // La carte dont celle-ci est le détail d'abord, puis celles qui en sont le détail, puis les autres.
  const rang = (c) => (c.id === carte.parent?.carte ? 0 : c.parent?.carte === carte.id ? 1 : 2);
  autres.sort((a, b) => rang(a) - rang(b));
  dialogue?.remove();
  dialogue = document.createElement("dialog");
  dialogue.className = "dialogue dialogue-jeter-carte";
  const n = lieux.length;
  dialogue.innerHTML = `
    <form method="dialog">
      <h2>Mettre « ${e(carte.nom)} » à la corbeille</h2>
      <p>${n > 1 ? `${n} lieux ont leur fiche sur cette carte` : "Un lieu a sa fiche sur cette carte"} : ${e(enListe(lieux.map((l) => l.nom || "Lieu sans nom")))}.</p>
      <fieldset class="choix-modele">
        <label class="modele"><input type="radio" name="lieux" value="deplacer" ${autres.length ? "checked" : "disabled"}>
          <span><strong>${n > 1 ? "Les poser" : "Le poser"} sur une autre carte</strong>${autres.length ? `<span class="place-accueil"></span>` : "Il n'y a pas d'autre carte."}</span></label>
        ${autres.length ? `<label class="champ">Carte d'accueil<select name="accueil">${autres.map((c) => `<option value="${e(c.id)}">${e(c.nom)}</option>`).join("")}</select></label>` : ""}
        <label class="modele"><input type="radio" name="lieux" value="garder" ${autres.length ? "" : "checked"}>
          <span><strong>${n > 1 ? "Les garder" : "Le garder"} sans carte</strong>${n > 1 ? "Leurs fiches restent dans les Lieux, secrets et notes compris, et s'y ouvrent." : "Sa fiche reste dans les Lieux, secrets et notes compris, et s'y ouvre."} « Poser sur une carte » ${n > 1 ? "les remet" : "le remet"} sur une carte quand vous voulez.</span></label>
      </fieldset>
      <div class="actions">
        <button value="annuler" formnovalidate>Annuler</button>
        <button class="principal" value="jeter">Mettre à la corbeille</button>
      </div>
    </form>`;
  document.body.append(dialogue);
  const form = dialogue.querySelector("form");
  const place = dialogue.querySelector(".place-accueil");
  const dire = () => {
    const accueil = autres.find((c) => c.id === form.elements.accueil?.value);
    if (!place || !accueil) return;
    const relie = carte.parent?.carte === accueil.id || accueil.parent?.carte === carte.id;
    place.textContent = relie
      ? `L'une est le détail de l'autre : ${n > 1 ? "ils y prennent leur place exacte" : "il y prend sa place exacte"}.`
      : `${n > 1 ? "Ils sont posés" : "Il est posé"} au centre, ${n > 1 ? "entourés" : "entouré"} de rouge : à vous de ${n > 1 ? "les mettre à leur place" : "le mettre à sa place"}.`;
  };
  form.addEventListener("change", (ev) => {
    if (ev.target.name === "accueil") form.elements.lieux.value = "deplacer";
    dire();
  });
  dire();
  return new Promise((fini) => {
    dialogue.addEventListener("close", async () => {
      const d = dialogue;
      if (d.returnValue !== "jeter") {
        d.remove();
        return fini(false);
      }
      const choix = form.elements.lieux.value;
      const accueil = form.elements.accueil?.value;
      d.remove();
      try {
        if (choix === "deplacer" && accueil) await deplacer(carte.id, accueil, lieux);
        await api.del(`/api/cartes/${encodeURIComponent(carte.id)}`);
      } catch (err) {
        toast(`Suppression impossible : ${err.message}`, "erreur");
        return fini(false);
      }
      const nom = autres.find((c) => c.id === accueil)?.nom;
      if (choix === "deplacer" && accueil) {
        toast(`Carte mise à la corbeille (elle s'y récupère). ${n > 1 ? "Ses lieux sont" : "Son lieu est"} sur « ${nom} ».`);
      } else {
        // Les lieux n'ont pas bougé : « Annuler » remet simplement la carte.
        annoncerCorbeille(`Carte mise à la corbeille. ${n > 1 ? "Ses lieux restent" : "Son lieu reste"} dans les Lieux, sans carte.`, "cartes", carte.id, { retour: "#/cartes" });
      }
      fini(true);
    }, { once: true });
    dialogue.returnValue = "";
    dialogue.showModal();
  });
}

// Pose les lieux sur la carte d'accueil, puis leur fiche la désigne : la carte d'accueil d'abord (rien n'est changé si
// elle refuse), les fiches ensuite. Une fiche qui refuse arrête tout avant la corbeille.
async function deplacer(idJetee, idAccueil, lieux) {
  const [jetee, accueil] = await Promise.all([api.get(`/api/cartes/${encodeURIComponent(idJetee)}`), api.get(`/api/cartes/${encodeURIComponent(idAccueil)}`)]);
  const { marqueurs, aValider } = placer(jetee, accueil, lieux);
  if (marqueurs.length) {
    await api.put(`/api/cartes/${encodeURIComponent(idAccueil)}`, { ...accueil, marqueurs: [...(accueil.marqueurs || []), ...marqueurs], version_base: accueil.modifie });
  }
  for (const l of lieux) {
    try {
      await api.patch(`/api/lieux/${encodeURIComponent(l.id)}`, aValider.has(l.id) ? { carte: idAccueil, a_valider: true } : { carte: idAccueil });
    } catch (err) {
      throw new Error(`la fiche « ${l.nom} » n'a pas suivi (${err.message}) ; la carte reste en place`);
    }
  }
}
