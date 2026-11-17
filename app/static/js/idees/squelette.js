// Le squelette d'un scénario, depuis une idée : trois structures proposées (actes, scènes, fins), à comparer, à refaire
// avec une précision, puis « Créer le scénario » en fait un nouveau, une consigne prête sous chaque scène. Rien n'est écrit
// dans un scénario existant ; les squelettes vivent à côté de l'idée (champ `squelettes`, routes de squelettes_api.py).

import { api, echapper as e, erreurIA, flux, toast } from "../api.js";

const TYPES = { combat: "Combat", enquete: "Enquête", social: "Social", exploration: "Exploration", autre: "Autre" };

const liste = (titre, lignes) => (lignes?.length
  ? `<h5>${e(titre)}</h5><ul>${lignes.map((l) => `<li>${e(l)}</li>`).join("")}</ul>`
  : "");

export function nombreDeScenes(s) {
  return (s.actes || []).reduce((n, a) => n + (a.scenes || []).length, 0);
}

function scene(sc) {
  const details = [
    sc.enjeu && `<p><strong>Enjeu.</strong> ${e(sc.enjeu)}</p>`,
    sc.sortie && `<p><strong>Sortie.</strong> ${e(sc.sortie)}</p>`,
    sc.indices?.length && `<p><strong>Indices.</strong> ${sc.indices.map(e).join(" ; ")}</p>`,
    sc.pnj?.length && `<p><strong>PNJ.</strong> ${sc.pnj.map(e).join(", ")}</p>`,
    sc.pnj_a_creer?.length && `<p><strong>À créer.</strong> ${sc.pnj_a_creer.map((p) => `${e(p.nom)}${p.role ? ` (${e(p.role)})` : ""}`).join(", ")}</p>`,
  ].filter(Boolean).join("");
  return `
    <li class="sq-scene" data-type="${e(sc.type)}">
      <p class="sq-scene-titre"><span class="sq-type">${e(TYPES[sc.type] || TYPES.autre)}</span> ${e(sc.titre)}${sc.lieu ? ` <span class="aide">${e(sc.lieu)}</span>` : ""}</p>
      ${details}
    </li>`;
}

export function structure(s, { ouvert = false } = {}) {
  const lien = s.scenario ? `<p class="aide">Devenu le scénario <a href="#/scenarios/${encodeURIComponent(s.scenario)}">ouvrir</a>.</p>` : "";
  return `
    <details class="squelette" data-sq="${e(s.id)}" ${ouvert ? "open" : ""}>
      <summary><span class="sq-titre">${e(s.titre)}</span> <span class="aide">${e(s.parti_pris || "")} · ${s.actes.length} acte${s.actes.length > 1 ? "s" : ""}, ${nombreDeScenes(s)} scènes${s.parent ? " · reprise" : ""}</span></summary>
      ${s.accroche ? `<p class="sq-accroche">${e(s.accroche)}</p>` : ""}
      ${lien}
      ${s.actes.map((a, i) => `
        <section class="sq-acte">
          <h4>Acte ${i + 1} : ${e(a.titre)} <button type="button" class="sq-refaire-acte" data-refaire-acte="${i}" title="Reprendre cet acte avec une précision">Refaire cet acte</button></h4>
          ${a.but ? `<p class="aide">${e(a.but)}</p>` : ""}
          <ol>${a.scenes.map(scene).join("")}</ol>
        </section>`).join("")}
      ${(s.fins || []).length ? `<h5>Fins possibles</h5><ul>${s.fins.map((f) => `<li><strong>${e(f.titre)}.</strong> ${e(f.description)}</li>`).join("")}</ul>` : ""}
      ${liste("À décider avant de jouer", s.questions)}
      ${liste("Points fragiles", s.risques)}
      <div class="sq-actions">
        <button type="button" class="principal" data-creer>Créer le scénario</button>
        <button type="button" data-refaire>Refaire avec une précision</button>
        <button type="button" class="lien-danger" data-retirer>Retirer</button>
      </div>
    </details>`;
}

export function panneau(idee) {
  const liste_ = idee.squelettes || [];
  return `
    <div class="squelettes" data-idee="${e(idee.id)}">
      <form class="sq-form">
        <p class="aide">Trois structures différentes sont proposées à partir de cette idée ; vous gardez, refaites ou retirez, et rien n'est écrit dans un scénario avant « Créer le scénario ».</p>
        <label>Durée <input name="duree" type="text" placeholder="2 séances de 4 heures"></label>
        <label>Ton <input name="ton" type="text" placeholder="comédie, mystère, sombre…"></label>
        <label class="sq-large">Contraintes <textarea name="contraintes" rows="2" placeholder="Un tutoriel d'abord, un fil par héros, pas de combat avant…"></textarea></label>
        <div class="sq-form-actions">
          <button type="submit" class="principal" data-estimation="squelette" title="Trois structures de scénario à partir de cette idée">Proposer trois structures</button>
          <span class="sq-etat aide" role="status"></span>
        </div>
      </form>
      <div class="sq-liste">${liste_.length ? liste_.map((s) => structure(s)).join("") : ""}</div>
    </div>`;
}

// Branche le panneau d'une idée. `surChangement(idee)` : l'idée a changé (squelettes ajoutés ou retirés, idée retenue).
export function lier(zone, idee, surChangement) {
  let courante = idee;
  const etat = zone.querySelector(".sq-etat");
  const liste_ = zone.querySelector(".sq-liste");

  const afficher = (ouvrir = "") => {
    liste_.innerHTML = (courante.squelettes || []).map((s) => structure(s, { ouvert: s.id === ouvrir })).join("");
  };

  const COUPURE = /network|réseau|interrompue|injoignable|failed to fetch|load failed|déjà en cours/i;

  // La connexion a lâché (une demande dure deux à trois minutes) mais le serveur finit son travail et range le résultat
  // dans l'idée : on le demande toutes les 10 s, et on montre ce qui est arrivé. Au bout de dix minutes, on renonce.
  async function reprendre(avant) {
    etat.textContent = "La connexion a été coupée, mais le serveur continue : les structures s'afficheront ici d'elles-mêmes…";
    for (let i = 0; i < 60 && zone.isConnected; i++) {
      await new Promise((r) => setTimeout(r, 10000));
      let encore = true;
      try {
        encore = (await api.get(`/api/idees/${encodeURIComponent(courante.id)}/squelette/etat`)).en_cours;
        if (encore) continue;
        const maj = await api.get(`/api/idees/${encodeURIComponent(courante.id)}`);
        const nouveaux = (maj.squelettes || []).filter((s) => !avant.has(s.id));
        courante = maj;
        afficher(nouveaux[0]?.id);
        surChangement?.(courante);
        etat.textContent = "";
        if (nouveaux.length) toast(`${nouveaux.length > 1 ? "Structures reçues" : "Structure reçue"} : voici ce que le serveur a rendu.`);
        else toast("La demande n'a rien donné : réessayez.", "erreur");
        return;
      } catch {
        // le serveur ne répond pas pour l'instant : on réessaie
      }
    }
    etat.textContent = "";
  }

  async function demandeAvecFlux(corps, message) {
    const bouton = zone.querySelector('button[type="submit"]');
    bouton.disabled = true;
    etat.textContent = message;
    const avant = new Set((courante.squelettes || []).map((s) => s.id));
    try {
      const fin = await flux(`/api/flux/idees/${encodeURIComponent(courante.id)}/squelette`, corps, (ev) => {
        if (ev.t === "etape") etat.textContent = ev.d;
        else if (ev.t === "attente") etat.textContent = `${message} ${ev.s} s (comptez une à deux minutes)`;
      });
      courante = fin.idee;
      afficher(fin.squelettes?.[0]?.id);
      surChangement?.(courante);
      etat.textContent = "";
      if (fin.echecs) toast(`${fin.echecs > 1 ? `${fin.echecs} structures n'ont` : "Une structure n'a"} pas abouti : relancez pour en obtenir d'autres.`, "erreur");
    } catch (err) {
      if (COUPURE.test(String(err?.message || err))) await reprendre(avant);
      else {
        etat.textContent = "";
        toast(`Squelette impossible : ${erreurIA(err)}.`, "erreur");
      }
    } finally {
      bouton.disabled = false;
    }
  }

  zone.querySelector("form.sq-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const f = ev.target;
    demandeAvecFlux({ duree: f.duree.value, ton: f.ton.value, contraintes: f.contraintes.value }, "Les structures se dessinent…");
  });

  // La précision du MJ : une zone de texte dans une boîte de dialogue (jamais prompt()). Rend le texte, ou null s'il renonce.
  function preciser(titre, aide) {
    return new Promise((fini) => {
      const d = document.createElement("dialog");
      d.className = "dialogue question";
      d.innerHTML = `
        <form method="dialog">
          <h2>${e(titre)}</h2>
          <p>${e(aide)}</p>
          <textarea name="precision" rows="3" required aria-label="Précision"></textarea>
          <div class="actions">
            <button value="non" formnovalidate>Annuler</button>
            <button value="oui" class="principal">Refaire</button>
          </div>
        </form>`;
      d.addEventListener("close", () => {
        const texte = d.returnValue === "oui" ? d.querySelector("textarea").value.trim() : null;
        d.remove();
        fini(texte || null);
      });
      document.body.append(d);
      d.showModal();
      d.querySelector("textarea").focus();
    });
  }

  liste_.addEventListener("click", async (ev) => {
    const bouton = ev.target.closest("button");
    const carte = ev.target.closest(".squelette");
    if (!bouton || !carte) return;
    ev.preventDefault();
    const id = carte.dataset.sq;
    if (bouton.dataset.creer !== undefined) {
      bouton.disabled = true;
      try {
        const r = await api.post(`/api/idees/${encodeURIComponent(courante.id)}/squelettes/${encodeURIComponent(id)}/scenario`, {});
        courante = r.idee;
        afficher(id);
        surChangement?.(courante);
        toast("Scénario créé : il est dans l'onglet Scénarios, en brouillon.");
      } catch (err) {
        bouton.disabled = false;
        toast(`Création impossible : ${err.message}`, "erreur");
      }
    } else if (bouton.dataset.retirer !== undefined) {
      try {
        courante = await api.del(`/api/idees/${encodeURIComponent(courante.id)}/squelettes/${encodeURIComponent(id)}`);
        afficher();
        surChangement?.(courante);
      } catch (err) {
        toast(`Retrait impossible : ${err.message}`, "erreur");
      }
    } else if (bouton.dataset.refaire !== undefined || bouton.dataset.refaireActe !== undefined) {
      const acte = bouton.dataset.refaireActe !== undefined ? Number(bouton.dataset.refaireActe) : null;
      const precision = await preciser(acte === null ? "Refaire cette structure" : `Refaire l'acte ${acte + 1}`,
        acte === null ? "Qu'est-ce qui doit changer ? (plus court, un autre ennemi, moins de combats…)" : "Qu'est-ce qui doit changer dans cet acte ?");
      if (!precision) return;
      demandeAvecFlux({ squelette: id, ...(acte === null ? {} : { acte }), precision }, "La structure se reprend…");
    }
  });
}
