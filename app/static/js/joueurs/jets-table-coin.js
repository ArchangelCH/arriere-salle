// Les jets de la tablée sur la page Table du coin des joueurs (lot du 12/11) : chaque joueur voit le jet des autres (et les
// dés du MJ montrés à la table), comme à la TV. Les dés roulent en 3D (ecran-tv/des-3d.js), s'arrêtent sur le résultat
// venu du serveur, puis le bandeau de la TV paraît (ecran-tv/jet-tv.js) avec le jingle de l'issue (ecran-tv/sons-jets.js),
// au volume réglé sur cet appareil (ecran-tv/volume-sons.js).
//
// Le flux poussé dit seulement qu'un jet est tombé (sujet « jets-table ») ; la page relit GET /api/table/jets, les derniers
// bandeaux tels que la TV les reçoit : prénom public, couleur, test, dé, issue ; jamais la valeur visée. Les jets présents
// à la première lecture sont tenus pour vus ; ensuite chacun ne se joue qu'une fois (son identifiant), et seulement s'il
// est frais (une page revenue de veille ne redit pas un vieux jet). Un test redit (« rappel » : l'effet d'un dé d'aventure
// changé) montre son bandeau sans dés ni jingle.
//
// Pour l'inclure dans la page Table :
//   import { monter as monterJetsDeLaTable } from "./jets-table-coin.js";
//   monterJetsDeLaTable();

import { creerDes3d } from "../ecran-tv/des-3d.js";
import { JetTv } from "../ecran-tv/jet-tv.js";
import { creerSonsJets } from "../ecran-tv/sons-jets.js";
import { monterVolume } from "../ecran-tv/volume-sons.js";
import { ecouterFlux } from "./flux.js";

const FEUILLE = new URL("../../css/jet-tv.css", import.meta.url).pathname;
const VUS_MAX = 200;

let monte = null;

export function monter() {
  if (monte) return monte;
  if (!document.querySelector(`link[href="${FEUILLE}"]`)) {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = FEUILLE;
    document.head.append(l);
  }
  const sons = creerSonsJets();
  const volume = monterVolume(sons, { classe: "volume-coin" });
  const des = creerDes3d();
  const bandeau = new JetTv();
  const vus = new Set();
  let premiere = true;
  let numero = 0;

  function montrer(msg) {
    if (msg.rappel) return bandeau.recevoir(msg);
    des.lancer(msg).then(() => {
      bandeau.recevoir(msg);
      // Le jingle de l'issue, avec le bandeau ; les dés libres n'en ont pas.
      if (msg.type === "jet") sons.jouer(msg.issue);
    });
  }

  async function lire() {
    const n = ++numero;
    let r = null;
    try {
      const reponse = await fetch("/api/table/jets");
      if (!reponse.ok) return;
      r = await reponse.json();
    } catch {
      return; // une coupure : le prochain jet relira
    }
    if (n !== numero) return;
    const nouveaux = (Array.isArray(r.jets) ? r.jets : []).filter((x) => x && typeof x.id === "string" && !vus.has(x.id));
    for (const x of nouveaux) vus.add(x.id);
    while (vus.size > VUS_MAX) vus.delete(vus.values().next().value);
    const aJouer = premiere ? [] : nouveaux.filter((x) => x.frais === true);
    premiere = false;
    if (document.visibilityState === "hidden") return;
    for (const x of aJouer) montrer(x);
  }

  ecouterFlux("jets-table", lire);
  lire();
  monte = { sons, volume, lire };
  return monte;
}
