// « Jouer la scène » : le geste du MJ au début d'une scène, dans Séances › Jouer. D'un clic, le plan lié passe sur la TV,
// l'ambiance liée prend le relais en fondu (sauf si elle joue déjà), le journal note la scène à l'heure du serveur, et la
// scène est marquée en cours. Les cartons des PNJ restent chacun à son bouton, et la rencontre ne se lance pas : un combat
// commence quand il commence.
// Le repère vit sur la ligne du déroulé (champ en_cours, l'heure du geste), pas dans un rang : monter, descendre ou
// retirer une scène l'emmène avec elle. Une seule ligne le porte, et une scène cochée ne le montre plus.

import { echapper as e } from "../api.js";
import { rienDeRevele } from "../ecran-tv/tv-commun.js";

export const repere = (d) => (d && typeof d.en_cours === "string" && d.en_cours ? d.en_cours : null);

// La ligne du déroulé marquée en cours, -1 quand aucune (ou qu'elle est cochée depuis).
export const ligneEnCours = (s) => (s?.deroule || []).findIndex((d) => !d.fait && repere(d));

// Pose le repère sur une ligne et le retire des autres.
export function marquerEnCours(deroule, ligne, quand) {
  for (const d of deroule || []) if (d !== ligne && "en_cours" in d) delete d.en_cours;
  ligne.en_cours = quand;
}

// « depuis 20 h 15 », ou « depuis le 3 novembre » pour un geste d'un autre jour.
export function depuis(iso, maintenant = new Date()) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  if (t.toDateString() !== maintenant.toDateString()) return `depuis le ${t.toLocaleDateString("fr-CH", { day: "numeric", month: "long" })}`;
  return `depuis ${t.getHours()} h ${String(t.getMinutes()).padStart(2, "0")}`.replace(/ h 00$/, " h");
}

// Le repère dans le déroulé (Jouer et Préparer), rien pour une scène qui ne le porte pas.
export function htmlRepere(d, balise = "span") {
  const quand = !d?.fait && repere(d);
  return quand ? `<${balise} class="repere-scene">En cours ${e(depuis(quand))}</${balise}>` : "";
}

// La TV sur un plan, comme le bouton « Montrer » des plans.
export const vuePlan = (p) => ({ vue: "plan", plan: p.id, camera: null, style: p.style || "couleur", version: p.modifie, lieu: null, contrat: null, avant: null });

const enPhrase = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(", ")} et ${parts[parts.length - 1]}` : parts[0]);

// En tête des liens de la scène en cours : ce que fait le geste, et son bouton. r : les liens résolus (liensResolus).
export function htmlGeste(d, i, r) {
  const parts = [r.plan && "plan sur la TV", r.ambiance && "ambiance", "journal"].filter(Boolean);
  const texte = parts.length > 1 ? enPhrase(parts) : "une ligne au journal";
  const marquee = Boolean(htmlRepere(d));
  return `
              <li class="geste-scene"><span><i>D'un geste</i> ${e(texte.charAt(0).toUpperCase() + texte.slice(1))}</span>
                <button ${marquee ? "" : 'class="principal" '}data-action="scene-jouer" data-i="${i}" title="Le plan sur la TV, l'ambiance en fondu, la scène notée au journal et marquée en cours. Les cartons et le combat restent à leur bouton.">${marquee ? "Relancer la scène" : "Jouer la scène"}</button></li>`;
}

// Le geste lui-même. r : les liens résolus de la scène ; musique : { courante, enPause } du lecteur ; quand : l'heure du
// geste (ISO). faire : les trois envois, partis ensemble : montrerPlan(plan) (rend { ecrans } ou { deja }),
// lancerAmbiance(id), noter(texte). Un envoi raté n'arrête pas les autres. Rend le compte rendu : { texte, erreur }, et
// action (« Ouvrir le plan ») quand le plan à la TV n'a encore rien de révélé : les joueurs voient un écran noir.
export async function jouerLaScene({ seance, i, r, musique = {}, quand }, faire) {
  const d = seance.deroule[i];
  const titre = (d.titre || "").trim() || `Scène ${i + 1}`;
  marquerEnCours(seance.deroule, d, quand);
  const ambiance = r.ambiance && !(musique.courante === r.ambiance.id && !musique.enPause) ? r.ambiance : null;
  const [plan, son, journal] = await Promise.allSettled([
    r.plan ? faire.montrerPlan(r.plan) : null,
    ambiance ? faire.lancerAmbiance(ambiance.id) : null,
    faire.noter(`Scène : ${titre}`),
  ]);
  const faits = [];
  const rates = [];
  const noire = Boolean(r.plan) && plan.status === "fulfilled" && rienDeRevele(r.plan);
  if (r.plan) {
    if (plan.status === "rejected") rates.push(`le plan (${plan.reason?.message || "erreur"})`);
    else if (!plan.value?.deja) faits.push(plan.value?.ecrans ? `plan sur la TV${noire ? ", encore tout dans le brouillard : la TV reste noire" : ""}` : "plan envoyé, mais aucun écran de table n'est ouvert");
    else if (noire) faits.push("le plan à la TV est encore tout dans le brouillard : la TV reste noire");
  }
  if (ambiance) {
    if (son.status === "rejected") rates.push(`l'ambiance (${son.reason?.message || "erreur"})`);
    else faits.push("ambiance en fondu");
  }
  if (journal.status === "rejected") rates.push(`le journal (${journal.reason?.message || "erreur"})`);
  else faits.push("notée au journal");
  const texte = `Scène en cours${faits.length ? ` : ${faits.join(", ")}` : ""}.${rates.length ? ` Pas fait : ${rates.join(" ; ")}.` : ""}`;
  const action = noire ? { libelle: "Ouvrir le plan", faire: () => (location.hash = `#/plan/${r.plan.id}`) } : null;
  return { texte, erreur: rates.length > 0, action };
}
