// L'aide-mémoire du kit dans la recherche des règles (touche R) : les règles de la table que l'atelier applique déjà
// (tests et critiques, cartons, coma, postures, sablier, Psy, qui commence, repos). Les textes viennent des mêmes listes
// que le combat, la compagnie et le créateur (combats/suivi.js, aventuriers/etat.js, aventuriers/regles.js) : l'aide ne
// dit jamais autre chose qu'eux. Lecture seule, rien ne s'y modifie. `mots` : d'autres mots qui la trouvent.

import { POSTURES } from "../aventuriers/regles.js";
import { REPOS } from "../aventuriers/etat.js";
import { CARTONS, SABLIER, SITUATIONS, seuilMort } from "../combats/suivi.js";

const signe = (n) => String(n).replace("-", "−");

export const AIDE_MEMOIRE = [
  {
    id: "kit-tests",
    titre: "Tests et critiques",
    texte: "Un test réussit sur un D100 égal ou inférieur à la valeur.\n"
      + "01 à 05 : réussite critique ; 96 à 100 : échec critique (en offensive : 01 à 10, et 91 à 100).\n"
      + "Un coup critique ne s'esquive ni ne se pare, et ses dégâts sont au maximum.",
    mots: "critique critiques reussite echec d100 jet test valeur",
  },
  {
    id: "kit-cartons",
    titre: "Les cartons",
    texte: `Un carton par caractéristique (Physique, Social, Mental) : ${Object.values(CARTONS).join(" ; ")}.\n`
      + "Un carton de plus sur une caractéristique déjà rouge coûte 1D6 Santé.\n"
      + "Une nuit de repos retire les cartons jaunes ; les rouges restent.",
    mots: "carton cartons jaune rouge malus penalite physique social mental",
  },
  {
    id: "kit-coma",
    titre: "Coma et mort",
    texte: "À 0 Santé ou moins, le héros est au tapis, dans le coma : plus d'action, et chaque coup reçu compte encore.\n"
      + `Mort à ${signe(seuilMort(0))}, ou à moins sa Santé maximale si elle dépasse 10.\n`
      + "Soigné au-dessus de 0, il se réveille aussitôt, avec un carton jaune en Physique ; sinon, une heure après le combat, à 1 Santé, avec le même carton.",
    mots: "coma tapis mort mourir reveil inconscient sante zero",
  },
  {
    id: "kit-postures",
    titre: "Les postures",
    texte: `${POSTURES.map((p) => `${p.nom} : ${p.donne} ${p.coute}`).join("\n")}\nOn change de posture au début d'un tour.`,
    mots: "posture postures offensive defensive focus defense esquive parade",
  },
  {
    id: "kit-sablier",
    titre: "Le sablier",
    texte: `La table débat trop longtemps : le sablier compte ${SABLIER} secondes, et à zéro le monstre rejoue.`,
    mots: "sablier minute temps debat lenteur monstre rejoue",
  },
  {
    id: "kit-psy",
    titre: "Psy et dons",
    texte: "Un don coûte sa Psy, même raté. Ce qui manque se paie en Santé, et cette Santé ne revient qu'après une journée entière de repos.\n"
      + "En Focus, chaque don coûte 1 Psy de moins.",
    mots: "psy don dons magie pouvoir cout",
  },
  {
    id: "kit-qui-commence",
    titre: "Qui commence",
    texte: "Aucun jet d'initiative : le MJ annonce combien d'aventuriers agissent avant les ennemis, puis les ennemis, puis le reste du groupe, le même ordre à chaque tour.\n"
      + SITUATIONS.map(([n, t]) => `${n} : ${t.replace(" : ", ", ")}`).join("\n"),
    mots: "initiative ordre tour commence surprise embuscade",
  },
  {
    id: "kit-repos",
    titre: "Les repos",
    texte: `${REPOS.nuit.regle}\n${REPOS.journee.regle}`,
    mots: "repos nuit journee soin soigner recuperer",
  },
];

// La recherche des règles maison (correspond) lit titre, texte et, sur demande, le contexte : les mots y passent.
export const aideCherchable = (a) => ({ titre: a.titre, texte: a.texte, contexte: a.mots });
