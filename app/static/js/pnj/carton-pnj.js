// Le carton d'un PNJ part vers la TV et la table publique : son nom, son surnom, son rôle, son peuple et son apparence
// s'y lisent. Avant l'envoi, ce qu'il nomme d'encore inconnu des joueurs (un lieu dans son rôle, un autre PNJ dans son
// apparence, un peuple caché) est montré au MJ, comme dans les avis de Séances : il le marque connu, montre quand même,
// ou ne montre pas. Le même passage pour tous les chemins : carnet des PNJ, pion d'un plan, Tableau, Séances, auberge,
// télécommande. Une vérification de confort : si le serveur ne répond pas, le carton part. Un PNJ encore secret ne pose
// qu'une question : la même dit qu'il deviendra connu, et rien ne change s'il ne part pas.

import { api, echapper as e, toast } from "../api.js";
import { TYPES_LIEUX } from "../carte/biomes.js";
import { garderLaLecture, demander as poserQuestion } from "../commun/dialogue.js";

const GENRES = { pnj: "PNJ", lieu: "lieu" };

// Les noms inconnus que nomme le carton de ce PNJ, tel que la TV le montrerait (vide si rien, ou faute de réponse).
export async function nomsInconnus(id) {
  return (await cartonLu(id)).secrets;
}

// lectureSeule : la fiche est partagée par l'autre MJ ; celui qui lit ne peut pas la rendre connue des joueurs.
async function cartonLu(id) {
  try {
    const r = await api.get(`/api/pnj/${encodeURIComponent(id)}/carton`);
    return { secrets: r.secrets || [], lectureSeule: r.lecture_seule === true };
  } catch {
    return { secrets: [], lectureSeule: false };
  }
}

export const REFUS_PARTAGE = "est encore inconnu des joueurs, et sa fiche est partagée par l'autre MJ : lui seul peut le rendre connu. Son carton ne part pas.";

// « La Ferme aux Corbeaux (lieu) », « Mathis Ferrand (PNJ) », « Gens du Marais (peuple caché) ».
export function libelleInconnu(x) {
  return `${x.nom} (${x.genre === "peuple" ? "peuple caché" : GENRES[x.genre] || "inconnu"})`;
}

const enListe = (noms) => (noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}` : noms[0] || "");
export const listeInconnus = (secrets) => enListe(secrets.map(libelleInconnu));

const de = (nom) => (/^[aeiouyàâéèêëîïôöùûœ]/i.test(nom) ? "d'" : "de ") + nom;

// Vrai si le carton peut partir : il ne nomme rien d'inconnu, ou le MJ a choisi de le montrer. secret : le PNJ lui-même
// est encore inconnu des joueurs ; la question le dit, et l'appelant ne le marque connu que sur ce « oui ».
export async function cartonVerifie(id, nom = "", { secret = false } = {}) {
  const { secrets, lectureSeule } = await cartonLu(id);
  // Montrer un PNJ secret le rend connu : sur une fiche partagée, ce geste revient à son auteur. Dit ici, pour tous les
  // chemins (carnet, plan, Tableau, Séances, auberge), plutôt qu'un refus du serveur après coup.
  if (secret && lectureSeule) {
    toast(`${nom ? `«\u00a0${nom}\u00a0»` : "Ce PNJ"} ${REFUS_PARTAGE}`, "erreur");
    return false;
  }
  if (secrets.length) return demander(secrets, nom, secret);
  if (!secret) return true;
  return poserQuestion({
    titre: nom ? `Le carton ${de(nom)}` : "Ce carton",
    texte: `${nom ? `«\u00a0${nom}\u00a0»` : "Ce PNJ"} est encore inconnu des joueurs. Montrer son carton le rend connu, sur la TV et dans le carnet des joueurs.`,
    oui: "Le rendre connu et montrer",
    non: "Ne pas montrer",
    danger: true,
  });
}

// Seul le champ « connu » change : une fiche ouverte sur un autre écran n'est pas écrasée.
async function marquerConnu(x) {
  const [id, ...autres] = x.ids || [];
  if (!id || autres.length) throw new Error("cette ligne ne désigne pas une seule fiche");
  await api.patch(`/api/${x.genre === "lieu" ? "lieux" : "pnj"}/${encodeURIComponent(id)}`, { connu: true });
}

// La même question pour un autre texte montré à la TV (un document remis aux joueurs : documents/tv.js). textes :
// { titre, part (ce qui part, et où), montrer (le bouton qui montre quand même) }. Vrai si le texte peut partir.
export function questionDesInconnus(secrets, textes) {
  return demander(secrets, "", false, textes);
}

let dialogue = null;

function demander(secrets, nom, secret = false, textes = null) {
  const types = Object.fromEntries(TYPES_LIEUX.map((t) => [t.cle, t.nom]));
  const precision = (x) => (x.genre === "lieu" ? types[x.precision] || x.precision : x.precision) || "";
  const montrer = textes?.montrer || (secret ? "Le rendre connu et montrer" : "Montrer quand même");
  dialogue?.remove();
  dialogue = document.createElement("dialog");
  dialogue.className = "dialogue question dialogue-carton";
  dialogue.innerHTML = `
    <form method="dialog">
      <h2>${textes?.titre ? e(textes.titre) : nom ? `Le carton ${e(de(nom))}` : "Ce carton"}</h2>
      ${secret ? `<p>${nom ? `«\u00a0${e(nom)}\u00a0»` : "Ce PNJ"} est encore inconnu des joueurs : montrer son carton le rend connu.</p>` : ""}
      <p>${textes?.part ? e(textes.part) : `${secret ? "Le carton" : "Il"} part vers la TV et la table publique, et nomme ${secret ? "aussi " : ""}ce que les joueurs ne connaissent pas encore :`}</p>
      <ul class="noms-inconnus">${secrets.map((x, i) => `
        <li><span><b>${e(x.nom)}</b> <i>${x.genre === "peuple" ? `peuple caché de ${e((x.de || []).join(", "))}` : e([GENRES[x.genre], precision(x)].filter(Boolean).join(", "))}</i></span>
          ${x.genre === "peuple" ? "" : x.partage ? '<span class="carnet" title="Fiche partagée par l\'autre MJ : lui seul peut la marquer connue.">Partagée par l\'autre MJ</span>' : x.ambigu ? '<span class="carnet" title="Des fiches pareilles portent ce nom : marquez la bonne dans son carnet.">Plusieurs fiches</span>' : `<button type="button" data-connu="${i}">Marquer connu</button>`}</li>`).join("")}
      </ul>
      <p class="aide">${textes ? "Marquez connu ce que les héros ont découvert en jouant. Sinon, corrigez le texte, ou montrez-le quand même." : "Marquez connu ce que les héros ont découvert en jouant. Sinon, corrigez la fiche, ou montrez le carton quand même."}</p>
      <div class="actions">
        <button value="non" formnovalidate autofocus>Ne pas montrer</button>
        <button class="principal" value="montrer">${montrer}</button>
      </div>
    </form>`;
  document.body.append(dialogue);
  const d = dialogue;
  const restants = new Set(secrets.map((x, i) => i).filter((i) => secrets[i].genre !== "peuple" && !secrets[i].ambigu && !secrets[i].partage));
  d.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button[data-connu]");
    if (!b) return;
    const i = +b.dataset.connu;
    b.disabled = true;
    try {
      await marquerConnu(secrets[i]);
      b.replaceWith(Object.assign(document.createElement("span"), { className: "fait", textContent: "Connu" }));
      restants.delete(i);
      toast(`« ${secrets[i].nom} » est maintenant connu des joueurs.`);
      // Plus rien d'inconnu : le carton part sans « quand même » (un PNJ secret le reste jusqu'au « oui »).
      if (!secret && secrets.every((x, j) => !restants.has(j) && x.genre !== "peuple" && !x.ambigu && !x.partage)) d.querySelector('button[value="montrer"]').textContent = textes ? "Montrer" : "Montrer le carton";
    } catch (err) {
      b.disabled = false;
      toast(`Impossible : ${err.message}`, "erreur");
    }
  });
  return new Promise((fini) => {
    d.addEventListener("close", () => {
      d.remove();
      fini(d.returnValue === "montrer");
    }, { once: true });
    d.returnValue = "";
    garderLaLecture(d);
    d.showModal();
  });
}
