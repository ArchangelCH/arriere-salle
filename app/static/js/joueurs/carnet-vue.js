// Le carnet de la compagnie tel que le lit un joueur : ce que l'atelier a publié pour lui (le « Précédemment » des
// séances closes, les personnages et les lieux connus, les contrats pris, les rumeurs entendues, les documents reçus,
// les règles de la table, sa fiche), la date de la prochaine séance, l'aide-mémoire du kit, « Lire la table » (les mots du MJ et de la TV) et la
// compagnie, les héros de la tablée tels que la TV les présente. Le coin des joueurs
// (carnet.js) et l'aperçu du MJ (apercu.js, « Voir comme Léa ») le dessinent de la même main. Tout texte passe par
// echapper.

import { echapper as e } from "../api.js";
import { lisible } from "../aventuriers/etat.js";
import { accord, conseilsAuto, essentiel, titre, valeurCarac } from "../aventuriers/regles.js";
import { TYPES_LIEUX } from "../carte/biomes.js";
import { SABLIER } from "../combats/suivi.js";
import { genreDocument, htmlDocument, titreSurLePapier } from "../documents/rendu.js";
import { AIDE_MEMOIRE } from "../regles/aide-memoire.js";
// Le sanctuaire de la compagnie, quand le MJ le montre aux joueurs.
import { htmlSanctuaire, nombreDeChantiers } from "./sanctuaire-vue.js";
// Les activités entre les séances, quand le MJ les ouvre.
import { htmlSansGestes, nombreDActivites } from "./activites-vue.js";
import { NOM } from "../campagne/nom.js";

const TYPES = Object.fromEntries(TYPES_LIEUX.map((t) => [t.cle, t.nom]));
const CARACS = [["physique", "Physique"], ["social", "Social"], ["mental", "Mental"]];
const ETATS_CONTRAT = { pris: "Pris", reussi: "Réussi", echoue: "Échoué" };
// Au-delà, la Santé et la Psy se lisent en chiffres et en barre plutôt qu'en losanges.
const LOSANGES_MAX = 24;

// Les requêtes du coin : une erreur porte son statut (401 : plus connecté), sans renvoi vers une autre page.
export async function demander(methode, url, corps) {
  let r;
  try {
    r = await fetch(url, {
      method: methode,
      headers: corps === undefined ? {} : { "Content-Type": "application/json" },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });
  } catch {
    throw Object.assign(new Error("serveur injoignable, vérifiez la connexion"), { status: 0 });
  }
  if (!r.ok) {
    let message = `${r.status}`;
    try {
      message = (await r.json()).detail || message;
    } catch {
      // réponse sans JSON
    }
    throw Object.assign(new Error(message), { status: r.status });
  }
  return r.json();
}

export const forme = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
const paragraphes = (t) => String(t || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${e(x)}</p>`).join("");
const dizaine = (v) => {
  const s = String(v ?? "");
  return s.length > 1 ? `<span class="dizaine">${e(s.slice(0, -1))}</span>${e(s.slice(-1))}` : e(s);
};

export function dateFr(iso, { jour = true } = {}) {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? `${iso}T12:00` : iso || "");
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-CH", { ...(jour ? { weekday: "long" } : {}), day: "numeric", month: "long" });
}

export function heureFr(iso) {
  const d = new Date(iso || "");
  return Number.isNaN(d.getTime()) ? "" : `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
}

// « Prochaine séance : samedi 7 novembre à 18 h », la phrase de la table publique fermée (E22).
const htmlProchaine = (quand) => (quand ? `<p class="prochaine-coin">Prochaine séance : <b>${e(quand)}</b></p>` : "");

// Plus connecté (mot de passe changé, nouveau lien du MJ), ou le serveur ne répond pas : la page le dit sans rien d'autre.
export function pageErreur(page, err) {
  const perdu = err.status === 401 || err.status === 403;
  page.innerHTML = `<section class="feuille-coin message-coin"><p class="kicker">Le coin des joueurs</p>
    <h1>${perdu ? "Vous n'êtes plus connecté" : "Le carnet ne s'ouvre pas"}</h1>
    <p>${perdu ? '<a href="/connexion?suite=%2Fcarnet">Se connecter</a> avec votre identifiant et votre mot de passe.' : `Réessayez dans un instant (${e(err.message)}).`}</p></section>`;
}

export function pageFermee(page, prochaine = "") {
  page.innerHTML = `<section class="feuille-coin message-coin"><p class="kicker">Le carnet de la compagnie</p>
    <h1>Le carnet est fermé</h1>
    <p>Votre MJ l'ouvre entre les séances, avec les boutiques. Revenez un peu plus tard.</p>${htmlProchaine(prochaine)}</section>`;
}

// Une image du carnet qui ne vient pas : son cadre disparaît plutôt que de montrer une image cassée.
export function sansImagesCassees(racine) {
  for (const img of racine.querySelectorAll("img")) {
    img.addEventListener("error", () => img.closest("[data-image]")?.classList.add("sans-image"), { once: true });
  }
}

const filet = '<span class="filet" aria-hidden="true"></span>';
const titreSection = (id, titreS, sous = "") => `<header class="tete-section" id="${id}"><h2>${e(titreS)}</h2>${filet}${sous ? `<p class="sous-titre">${sous}</p>` : ""}</header>`;

// Les séances d'un autre MJ se numérotent à part : « Quête annexe 2 », ou le nom qu'il donne à sa suite.
function htmlPrecedemment(liste) {
  if (!liste.length) return '<p class="vide">Aucune séance close n\'a encore son « Précédemment ». Il paraît ici dès que le MJ l\'écrit.</p>';
  return liste.map((s, i) => `
    <article class="chronique${i ? "" : " recente"}"${s.suite ? ' data-suite="annexe"' : ""}>
      <p class="quand">${e([s.numero ? `${s.suite || "Séance"} ${s.numero}` : s.suite || "", dateFr(s.date)].filter(Boolean).join(" · "))}</p>
      ${s.titre ? `<h3>${e(s.titre)}</h3>` : ""}
      <div class="recit">${paragraphes(s.texte)}</div>
      ${s.images?.length ? `<div class="vignettes">${s.images.map((x) => `
        <figure data-image><img src="${e(x.image)}" alt="" loading="lazy" decoding="async"><figcaption>${e(x.nom)}</figcaption></figure>`).join("")}</div>` : ""}
    </article>`).join("");
}

function monogramme(nom) {
  const lettre = String(nom || "").replace(/^(le|la|les|l['’])\s*/i, "").trim().charAt(0).toUpperCase();
  return `<span class="monogramme" aria-hidden="true">${e(lettre || "?")}</span>`;
}

// Croisés en jouant d'abord, la dernière rencontre en tête ; puis ceux qu'on ne connaît que de réputation (E21). Un
// carnet publié avant ce partage (sans « croise ») reste une seule liste.
const derniere = (x) => Math.max(0, ...(x.seances || []));
const parRencontre = (x, y) => derniere(y) - derniere(x) || String(x.nom).localeCompare(String(y.nom), "fr");

function enGroupes(liste, html, [croisesTitre, autresTitre, autresAide]) {
  const croises = liste.filter((x) => x.croise).sort(parRencontre);
  const autres = liste.filter((x) => !x.croise);
  if (!croises.length) return html(autres);
  return `<div class="groupe-coin"><h3 class="intertitre">${e(croisesTitre)}</h3>${html(croises)}</div>
    ${autres.length ? `<div class="groupe-coin"><h3 class="intertitre">${e(autresTitre)}</h3><p class="aide-groupe">${e(autresAide)}</p>${html(autres)}</div>` : ""}`;
}

// La croix d'un personnage mort, posée sur son médaillon (dessinée : nette à toutes les tailles).
const CROIX_MORT = '<svg class="croix-mort" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5v19M5.5 8h13"/></svg>';

function htmlPersonnages(liste) {
  if (!liste.length) return '<p class="vide">Personne pour l\'instant : les personnages paraissent ici quand les héros les connaissent.</p>';
  const galerie = (l) => `<div class="galerie">${l.map((p) => `
    <article class="personnage${p.mort === true ? " mort" : ""}" data-cherche="${e(forme([p.nom, p.surnom, p.role, p.peuple, p.apparence, p.rencontre, p.mort === true ? "mort morte" : ""].join(" ")))}">
      <span class="medaillon${p.illustration ? "" : " sans-image"}" data-image>${p.illustration ? `<img src="${e(p.illustration)}" alt="" loading="lazy" decoding="async">` : ""}${monogramme(p.nom)}${p.mort === true ? CROIX_MORT : ""}</span>
      <div class="texte">
        <h3>${e(p.nom)}${p.mort === true ? '<span class="dit-mort">Mort</span>' : ""}</h3>
        ${p.surnom ? `<p class="surnom">« ${e(p.surnom)} »</p>` : ""}
        ${p.role || p.peuple ? `<p class="role">${e([p.role, p.peuple].filter(Boolean).join(" · "))}</p>` : ""}
        ${p.rencontre ? `<p class="rencontre">${e(p.rencontre)}</p>` : ""}
        ${p.apparence ? `<p class="apparence">${e(p.apparence)}</p>` : ""}
      </div>
    </article>`).join("")}</div>`;
  return enGroupes(liste, galerie, ["Croisés en jouant", "Connus de réputation", "Ceux dont on vous a parlé, sans les avoir croisés en séance."]);
}

function htmlLieux(liste) {
  if (!liste.length) return '<p class="vide">Aucun lieu encore : ils paraissent ici quand les héros les connaissent.</p>';
  const lieux = (l) => `<div class="lieux">${l.map((x) => `
    <article class="lieu${x.illustration ? "" : " sans-image"}" data-cherche="${e(forme([x.nom, TYPES[x.type], x.resume, x.rencontre].join(" ")))}">
      ${x.illustration ? `<span class="vue" data-image><img src="${e(x.illustration)}" alt="" loading="lazy" decoding="async"></span>` : ""}
      <div class="texte">
        ${TYPES[x.type] ? `<p class="genre">${e(TYPES[x.type])}</p>` : ""}
        <h3>${e(x.nom)}</h3>
        ${x.rencontre ? `<p class="rencontre">${e(x.rencontre)}</p>` : ""}
        ${x.resume ? `<p>${e(x.resume)}</p>` : ""}
      </div>
    </article>`).join("")}</div>`;
  return enGroupes(liste, lieux, ["Visités en jouant", "Connus de réputation", "Sur la carte, ou dans les récits : la compagnie n'y est pas encore allée."]);
}

function htmlContrats(contrats, rumeurs) {
  const affiches = contrats.length ? `<div class="affiches-coin">${contrats.map((c, i) => `
    <article class="affiche-coin etat-${e(c.etat)}${c.genre === "avis" ? " avis" : ""}" style="--r:${[-1.2, 0.9, -0.6, 1.4][i % 4]}deg" data-cherche="${e(forme([c.nom, c.affiche, c.recompense, c.contact, c.mention].join(" ")))}">
      <span class="tampon">${e(ETATS_CONTRAT[c.etat] || "")}</span>
      <h3>${e(c.nom)}</h3>
      ${c.affiche ? paragraphes(c.affiche) : ""}
      ${c.recompense ? `<p class="recompense">${e(c.recompense)}</p>` : ""}
      ${c.contact ? `<p class="contact">${e(c.contact)}</p>` : ""}
      ${c.mention ? `<p class="mention">${e(c.mention)}</p>` : ""}
    </article>`).join("")}</div>` : '<p class="vide">Aucun contrat pris pour l\'instant.</p>';
  const ouies = rumeurs.length ? `<ul class="rumeurs-coin">${rumeurs.map((r) => `
    <li data-cherche="${e(forme([r.texte, r.source].join(" ")))}"><blockquote>${e(r.texte)}</blockquote>${r.source ? `<p class="source">${e(r.source)}</p>` : ""}</li>`).join("")}</ul>`
    : '<p class="vide">Aucune rumeur entendue pour l\'instant.</p>';
  return `<h3 class="intertitre">Les contrats pris</h3>${affiches}<h3 class="intertitre">Les rumeurs entendues</h3>${ouies}`;
}

// Documents reçus : ce que le MJ a montré à la TV (une lettre, une affiche, un plan), à relire entre deux séances. Le plus
// récent ouvert, les autres repliés sous leur titre ; le papier est celui de la TV (documents/rendu.js).
function htmlDocuments(liste) {
  if (!liste.length) return '<p class="vide">Aucun document pour l\'instant : les lettres, affiches et plans que le MJ montre à la TV paraissent ici.</p>';
  return `<div class="documents-recus">${liste.map((d, i) => `
    <details class="document-recu"${i ? "" : " open"} data-cherche="${e(forme([d.nom, d.texte, d.signature, genreDocument(d).nom].join(" ")))}">
      <summary><span class="genre-recu">${e(genreDocument(d).court)}</span><span class="titre-recu">${e(d.nom || "Sans titre")}</span>${d.date ? `<span class="date-recu">reçu le ${e(dateFr(d.date, { jour: false }))}</span>` : ""}</summary>
      <div class="papier-recu" data-image>${htmlDocument(d)}${!titreSurLePapier(d) && d.nom ? `<p class="legende-recu">${e(d.nom)}</p>` : ""}</div>
    </details>`).join("")}</div>`;
}

function htmlRegles(liste) {
  const maison = liste.length ? `<ol class="regles-coin">${liste.map((r) => `
    <li data-cherche="${e(forme([r.titre, r.texte].join(" ")))}"><h3>${e(r.titre)}</h3>${paragraphes(r.texte)}${r.date ? `<p class="date">${e(dateFr(r.date, { jour: false }) || r.date)}</p>` : ""}</li>`).join("")}</ol>`
    : '<p class="vide">Le MJ n\'a pas encore noté de règle de table.</p>';
  return `${maison}${htmlAideMemoire()}`;
}

// L'aide-mémoire du kit (E22) : celui de la touche R de l'atelier (regles/aide-memoire.js), tel quel, pour que le carnet
// ne dise jamais autre chose que la table. La règle des postures du MJ y est déjà.
function htmlAideMemoire() {
  return `<div class="aide-memoire-coin groupe-coin" id="aide-memoire">
    <h3 class="intertitre">L'aide-mémoire du kit</h3>
    <p class="aide-groupe">Les règles que votre MJ applique, en bref. Pour réussir une action, lancez les deux D10, dizaines et unités : il faut faire égal ou moins que la valeur de votre fiche. Un coup fait les dégâts de l'arme, moins l'armure de la cible.</p>
    <dl>${AIDE_MEMOIRE.map((a) => `
      <div data-cherche="${e(forme([a.titre, a.texte, a.mots].join(" ")))}"><dt>${e(a.titre)}</dt><dd>${a.texte.split("\n").map((l) => `<p>${e(l)}</p>`).join("")}</dd></div>`).join("")}</dl>
  </div>`;
}

// « Lire la table » (E26) : le bandeau du combat légendé comme la TV le montre. Les postures, le test et la Psy sont
// dans l'aide-mémoire, avec les règles de la table : un renvoi y mène. Les textes reprennent l'aide du joueur du kit.
function htmlLireLaTable() {
  const heros = (nom, teinte, posture, plus = "", classe = "") => `<span class="be-heros${classe}"><i class="be-pastille" style="--teinte:${teinte}"></i><b>${nom}</b><em>${posture}</em>${plus}</span>`;
  return `
    <div class="bandeau-exemple" role="img" aria-label="Le bandeau du combat à la TV : le tour, les héros dans l'ordre, les ennemis, le point strat">
      <span class="be-tour"><small>Tour</small>2</span>
      ${heros("Mathis", "#7b4fa0", "focus", '<span class="be-carton jaune">P</span><span class="be-jeton">+</span>')}
      ${heros("Ilian", "#2f6ea5", "offensive", "", " actif")}
      <span class="be-heros ennemis"><b>Les ennemis</b><em>à eux de frapper</em></span>
      ${heros("Isaure", "#b3261e", "coma", '<span class="be-carton rouge">M</span>', " coma")}
      <span class="be-strat"><small>Point strat</small>disponible</span>
    </div>
    <dl class="lexique">
      <dt>Le nom sur parchemin</dt><dd>C'est à ce héros de jouer : annoncez votre posture, puis votre action.</dd>
      <dt>En italique, sous le nom</dt><dd>Sa posture du moment : offensive, défensive ou focus.</dd>
      <dt>Le nom barré, « coma »</dt><dd>Le héros est au tapis, à 0 Santé ou moins. On ne meurt que bien plus bas, au moins à −10.</dd>
      <dt>Les ennemis</dt><dd>Leur tour, d'un bloc, entre deux héros : le MJ annonce combien d'entre vous agissent avant eux.</dd>
      <dt>P, S, M en jaune ou en rouge</dt><dd>Un carton en Physique, Social ou Mental. Jaune : −10 % ; rouge : −30 %, à la place du jaune. Une nuit de repos retire les jaunes.</dd>
      <dt>Le + vert, le −</dt><dd>Un avantage, à dépenser quand vous voulez : +10 % à un test, +1 aux dégâts, ou agir avant l'ennemi. Le −, c'est un désavantage, que le MJ dépense contre vous. Un seul jeton à la fois.</dd>
      <dt>Point strat</dt><dd>Une fois par combat, le groupe peut demander un temps mort pour se concerter. « Pris » : il a déjà servi.</dd>
      <dt>« Le monstre rejoue »</dt><dd>Une barre se vide quand la table débat trop longtemps : au bout de ${SABLIER} secondes, l'ennemi rejoue.</dd>
    </dl>
    <p class="vers-aide">Les postures, les tests, la Psy et les repos sont dans <a href="#carnet" data-aller="aide-memoire">l'aide-mémoire du kit</a>, avec les règles de la table.</p>`;
}

// La compagnie (E22) : les héros de la tablée tels que la TV les présente sur leur carton, avec la couleur de leur pion,
// le vôtre marqué. Rien de leur fiche au-delà : ni histoire, ni dons, ni ce qui est « pour le MJ » (le serveur ne l'envoie pas).
const STATS_COMPAGNON = [["physique", "Physique"], ["social", "Social"], ["mental", "Mental"], ["sante", "Santé"], ["psy", "Psy"]];

function htmlCompagnie(liste) {
  if (!liste.length) return '<p class="vide">La tablée est vide pour l\'instant : les héros paraissent ici quand le MJ les accueille.</p>';
  return `<div class="compagnie-coin">${liste.map((h) => {
    const themes = (h.themes || []).join(" · ");
    const stats = STATS_COMPAGNON.filter(([k]) => typeof h[k] === "number");
    return `
    <article class="compagnon${h.moi ? " moi" : ""}" data-cherche="${e(forme([h.nom, titre(h), h.joueur, themes, h.allure].join(" ")))}">
      <span class="medaillon${h.illustration ? "" : " sans-image"}" data-image style="${h.couleur ? `border-color:${e(h.couleur)}` : ""}">${h.illustration ? `<img src="${e(h.illustration)}" alt="" loading="lazy" decoding="async">` : ""}${monogramme(h.nom)}</span>
      <div class="texte">
        <h3>${e(h.nom)}${h.moi ? ' <span class="vous">vous</span>' : ""}</h3>
        ${titre(h) ? `<p class="role">${e(titre(h))}</p>` : ""}
        <p class="joueur">${h.couleur ? `<span class="pastille" style="background:${e(h.couleur)}" title="Sa couleur à la TV"></span>` : ""}${h.joueur ? `${accord("{Joué|Jouée}", h)} par ${e(h.joueur)}` : `Niveau ${e(h.niveau || 1)}`}${h.moi ? ' · <a href="#carnet" data-aller="heros">votre fiche</a>' : ""}</p>
      </div>
      <div class="suite">
        ${stats.length ? `<dl class="stats-compagnon">${stats.map(([k, nom]) => `<div><dt>${nom}</dt><dd>${e(h[k])}</dd></div>`).join("")}</dl>` : ""}
        ${themes ? `<p class="themes">${e(themes)}</p>` : ""}
        ${h.allure ? `<p class="apparence">${e(h.allure)}</p>` : ""}
      </div>
    </article>`;
  }).join("")}</div>`;
}

// La Santé et la Psy en losanges (pleins : ce qu'il en reste), comme on coche les cases de la fiche.
function jauge(classe, nom, valeur, max) {
  const coma = classe === "sante" && valeur <= 0;
  const losanges = max <= LOSANGES_MAX
    ? `<span class="losanges" aria-hidden="true">${Array.from({ length: max }, (_, i) => `<i class="${i < valeur ? "plein" : ""}"></i>`).join("")}</span>`
    : `<span class="barre" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, (100 * valeur) / max))}%"></i></span>`;
  return `<div class="jauge ${classe}"><p><b>${e(nom)}</b><span class="chiffres">${e(String(valeur).replace("-", "−"))} / ${e(max)}</span>${coma ? '<i class="coma">dans le coma</i>' : ""}</p>${losanges}</div>`;
}

// Le coût d'un don tel qu'on le dit à la table : « 2 Psy », « X Psy », « sans coût », « 3 Santé ».
function coutDon(c) {
  const t = String(c ?? "").trim();
  if (t === "0") return "sans coût";
  return /^(\d+\+?|X)$/i.test(t) ? `${t} Psy` : t;
}

const phraseFinie = (t) => {
  const x = String(t || "").trim();
  return x && !/[.!?…»]$/.test(x) ? `${x}.` : x;
};

// Sans fiche : pas encore accueilli, ou mis de côté par le MJ depuis (absent : son nom et son genre).
function htmlSansHeros(absent) {
  if (!absent) return '<p class="vide">Votre héros paraîtra ici quand le MJ l\'aura accueilli dans la tablée.</p>';
  const qui = String(absent.nom || "").split(/[\s,]+/)[0] || accord("{Votre héros|Votre héroïne}", absent);
  return `<p class="vide">${e(qui)} n'est plus à la tablée pour l'instant : votre MJ ${accord("{l'a mis|l'a mise}", absent)} de côté. Sa fiche reparaîtra ici quand il l'y remettra.</p>`;
}

// Un bloc de la fiche rangé sous son titre : seul le titre se voit, un toucher l'ouvre (carnet.js se souvient de ceux qu'on a ouverts).
const repli = (cle, titreR, resume, contenu) => `<details class="repli-fiche" data-cle="${cle}"><summary><span>${titreR}</span>${resume ? `<small>${resume}</small>` : ""}</summary>${contenu}</details>`;

// « Mon héros », au complet : ce qu'il relit entre deux séances pour savoir ce qu'il peut faire samedi. Les valeurs de
// test, la défense, le coût et l'effet des dons du kit se calculent comme à la TV et sur la fiche imprimée (regles.js),
// sur les maximums de Santé et de Psy ; le titre s'accorde au genre du héros.
export function htmlHeros(h, absent) {
  if (!h) return htmlSansHeros(absent);
  const f = { ...h, sante: h.sante_max, psy: h.psy_max };
  const x = essentiel(f);
  const posture = x.posture;
  const bouclier = x.bouclier ? 2 : 0;
  const prenom = String(h.nom || "").split(/[\s,]+/)[0] || accord("{votre héros|votre héroïne}", h);
  const conseils = (h.conseils || []).length ? h.conseils : conseilsAuto(f);
  const meta = [["Élément", h.element], ["Thèmes", (h.themes || []).join(", ")], ["Langues", h.langues]].filter(([, v]) => String(v || "").trim());
  const histoire = String(h.histoire || "").trim() || [h.avant, h.pourquoi].map(phraseFinie).filter(Boolean).join(" ");
  const avec = /^(non|aucun|aucune|personne|rien|-+)$/i.test(String(h.lien_avec || "").trim()) ? "" : String(h.lien_avec || "").trim();
  const recit = [
    [accord("Ce qu'{il|elle} ne fera jamais", h), h.jamais],
    ["Allure et défaut", [phraseFinie(h.allure), phraseFinie(h.defaut)].filter(Boolean).join(" ")],
    ["Lien avec le groupe", [avec && !String(h.lien || "").includes(avec.split(/[\s,]+/)[0]) ? `Avec ${avec} :` : "", h.lien].filter(Boolean).join(" ")],
    ["Contacts, dettes et ennemis", h.contacts],
    ["Particularités", h.particularites],
  ].filter(([, v]) => String(v || "").trim());
  const cartons = CARACS.filter(([k]) => h.cartons?.[k]).map(([k, nom]) => `<span class="carton ${e(h.cartons[k])}">${e(nom)}</span>`).join("");
  const liste = (titreListe, lignes, vide) => `<div class="liste-sac"><h4>${e(titreListe)}</h4>${lignes.length ? `<ul>${lignes.map((l) => `<li>${e(l)}</li>`).join("")}</ul>` : `<p class="vide">${e(vide)}</p>`}</div>`;
  return `
    <article class="fiche-coin">
      <header class="identite">
        <span class="medaillon grand${h.illustration ? "" : " sans-image"}" data-image>${h.illustration ? `<img src="${e(h.illustration)}" alt="" loading="lazy" decoding="async">` : ""}${monogramme(h.nom)}</span>
        <div>
          <h3>${e(h.nom || "Sans nom")}</h3>
          ${titre(h) ? `<p class="titre-heros">${e(titre(h))}</p>` : ""}
          <p class="joueur">${h.couleur ? `<span class="pastille" style="background:${e(h.couleur)}"></span>` : ""}Niveau ${e(h.niveau || 1)}${h.joueur ? `, ${accord("{joué|jouée}", h)} par ${e(h.joueur)}` : ""}</p>
        </div>
      </header>
      <div class="caracs">${CARACS.map(([k, nom]) => `<div class="carac"><span class="valeur">${dizaine(h[k])}</span><span class="nom">${e(nom)}</span></div>`).join("")}</div>
      <div class="jauges">
        ${jauge("sante", "Santé", h.sante, h.sante_max)}
        ${jauge("psy", "Psy", h.psy, h.psy_max)}
        ${cartons ? `<p class="cartons"><b>Cartons</b>${cartons}</p>` : ""}
      </div>
      <div class="combat-coin">
        <p><b>Défense</b> <span class="valeur">${e(x.defense)} %</span></p>
        <p><b>Armure</b> <span class="valeur">${e(x.protection.indice)}</span>${x.protection.nom ? ` <i>${e(x.protection.nom)}${x.protection.gene ? `, gêne : ${e(x.protection.gene)}` : ""}</i>` : ""}${bouclier ? ` <i>· bouclier : +${bouclier} en posture défensive</i>` : ""}</p>
        ${posture ? `<p class="posture-coin"><b>Posture</b> ${e(posture.nom)} : ${e(posture.donne)} ${e(posture.coute)}</p>` : ""}
      </div>
      ${meta.length ? `<p class="meta-coin">${meta.map(([k, v]) => `<span><b>${k}</b> ${e(v)}</span>`).join("")}</p>` : ""}
      ${x.competences.length ? repli("competences", "Compétences", e(x.competences.length), `<ul class="competences">${x.competences.map((c) => `<li><span>${e(c.nom)}</span><span class="valeur">${e(c.valeur)} %</span><i>${e(c.avec)} ${e(valeurCarac(f, c.avec))} + ${e(c.bonus)}</i></li>`).join("")}</ul>`) : ""}
      ${x.armes.length ? repli("armes", "Armes", e(x.armes.length), `<ul class="armes">${x.armes.map((w) => `<li><b>${e(w.nom)}${w.nombre > 1 ? ` × ${w.nombre}` : ""}</b><span class="valeur">${e(w.valeur)} %</span>${[w.degats, w.notes].some(Boolean) ? `<i>${e([w.degats ? `dégâts ${w.degats}` : "", w.notes].filter(Boolean).join(" · "))}</i>` : ""}</li>`).join("")}</ul>`) : ""}
      ${x.dons.length ? repli("dons", "Dons", e(x.dons.length), `<ul class="dons">${x.dons.map((d) => `<li><b>${e(d.nom)}</b>${coutDon(d.cout) ? `<span class="cout">${e(coutDon(d.cout))}</span>` : ""}${d.effet ? `<p>${e(d.effet)}</p>` : ""}</li>`).join("")}</ul>`) : ""}
      ${repli("sac", "Le sac", "", `<section class="sac-coin">
        <h4>Le sac</h4>
        <p class="bourse-coin"><span class="pieces">${e(h.or ?? 0)}</span> pièce${(h.or ?? 0) > 1 ? "s" : ""} d'or</p>
        <div class="listes-sac">
          ${liste("Équipement", (h.equipement || []).map(lisible), "Rien pour l'instant.")}
          ${liste("Objets personnels", h.objets || [], "Aucun.")}
        </div>
      </section>`)}
      ${histoire || recit.length ? repli("histoire", "Son histoire", "", `<section class="histoire-coin"><h4>Son histoire</h4>${histoire ? paragraphes(histoire) : ""}
        ${recit.map(([k, v]) => `<p><span class="lbl">${e(k)}</span>${e(v)}</p>`).join("")}</section>`) : ""}
      ${conseils.length ? repli("conseils", `Pour bien jouer ${e(prenom)}`, "", `<div class="conseils-coin"><ul>${conseils.map((c) => `<li>${e(c)}</li>`).join("")}</ul></div>`) : ""}
    </article>`;
}

// Les pages du carnet. L'accueil garde l'essentiel (la prochaine séance, le dernier « Précédemment », la fiche du héros,
// les gestes en jeu) ; le reste est rangé dans des pages que le menu ouvre, chacune une vue de la même feuille, choisie par
// l'adresse (#lieux, #regles…). Les anciennes ancres de la longue page mènent à la page qui les porte.
export const VUES = {
  accueil: { titre: "Le carnet de la compagnie" },
  personnages: { titre: "Les personnages", chapo: "Ceux que vos héros ont croisés, et ce qu'ils en savent." },
  lieux: { titre: "Les lieux", chapo: "Ceux que vos héros ont visités ou dont ils ont entendu parler." },
  contrats: { titre: "Contrats et rumeurs", chapo: "Les contrats pris, et ce que vos héros ont entendu dire." },
  documents: { titre: "Les documents reçus", chapo: "Les lettres, affiches et plans que votre MJ vous a montrés à la TV." },
  compagnie: { titre: "La compagnie", chapo: "Les héros de la tablée, tels que la TV les présente, avec la couleur de leur pion." },
  regles: { titre: "Les règles de la table", chapo: "Ce que votre MJ applique, et comment lire ce que montre la TV." },
  sanctuaire: { titre: "Le sanctuaire", chapo: "Le refuge que la compagnie relève : chaque chantier, sa cagnotte, ce que le prochain niveau apporte." },
  activites: { titre: "Les quêtes", chapo: "Le tableau de l'auberge : les affiches de la période. Le dé se jette sur la fiche de votre héros, votre MJ valide l'or et raconte la suite." },
  precedemment: { titre: "Les séances d'avant", chapo: "Le « Précédemment » de chaque séance, de la plus récente à la plus ancienne." },
};
const VUE_DE_L_ANCRE = {
  carnet: "accueil", heros: "accueil", "mes-billets": "accueil", "mot-au-mj": "accueil", "dans-le-carnet": "accueil",
  "lire-la-table": "regles", "aide-memoire": "regles",
};

// L'adresse (#univers, ou une ancre de l'ancienne page : #lieux) dit la page à montrer et l'endroit où se poser.
export function vueDuHash(hash) {
  const ancre = String(hash || "").replace(/^#/, "");
  if (VUES[ancre]) return { vue: ancre, ancre: "" };
  const vue = VUE_DE_L_ANCRE[ancre];
  return vue ? { vue, ancre } : { vue: "accueil", ancre: "" };
}

const sectionCherchable = (id, titreS, sous, html, aucun) =>
  `<section class="section-coin cherchable">${titreSection(id, titreS, sous)}${html}<p class="aucun" hidden>${aucun}</p></section>`;
const secPersonnages = (c) => sectionCherchable("personnages", "Personnages", "", htmlPersonnages(c.personnages), "Personne ne correspond.");
const secLieux = (c) => sectionCherchable("lieux", "Lieux", "", htmlLieux(c.lieux), "Aucun lieu ne correspond.");
const secContrats = (c) => sectionCherchable("contrats", "Contrats et rumeurs", "", htmlContrats(c.contrats, c.rumeurs), "Rien ne correspond.");
const secDocuments = (c) => sectionCherchable("documents", "Documents reçus", "Les lettres, affiches et plans que le MJ vous a montrés à la TV.", htmlDocuments(c.documents || []), "Aucun document ne correspond.");
const secRegles = (c) => sectionCherchable("regles", "Règles de la table", "", htmlRegles(c.regles), "Aucune règle ne correspond.");
const secLireLaTable = () => `<section class="section-coin">${titreSection("lire-la-table", "Lire la table", "Les mots du MJ, et ce que montre la TV pendant un combat.")}${htmlLireLaTable()}</section>`;
const secCompagnie = (c) => sectionCherchable("compagnie", "La compagnie", "", htmlCompagnie(c.compagnie || []), "Aucun héros ne correspond.");
const secHeros = (c) => `<section class="section-coin">${titreSection("heros", c.heros ? accord("{Mon héros|Mon héroïne}", c.heros) : "Mon héros", c.heros ? "Sa fiche telle que le MJ la tient : Santé et Psy du moment, sac à jour." : "")}${htmlHeros(c.heros, c.absent)}</section>`;
const secSanctuaire = (c) => `<section class="section-coin section-sanctuaire">${(c.sanctuaire || []).length
  ? `<div class="sanctuaire-coin">${htmlSanctuaire(c.sanctuaire)}</div>`
  : '<p class="vide">Votre MJ n\'a pas encore ouvert le sanctuaire : le refuge paraîtra ici dès qu\'il le montrera aux joueurs.</p>'}</section>`;
const secActivites = (c) => `<section class="section-coin section-activites">${(c.activites || []).length
  ? `<div class="activites-coin">${htmlSansGestes(c.activites)}</div>`
  : '<p class="vide">Aucune activité entre les séances pour l\'instant : votre MJ les ouvre quand une période s\'y prête.</p>'}</section>`;

// Les activités de la période du héros, sur l'accueil : les dés jetés et ce qu'ils ont donné (activites-coin.js remplit la
// section ; sans activités ouvertes, elle reste vide et cachée).
const secResumeActivites = (c) => ((c.activites || []).length ? '<section class="section-coin section-resume-activites" hidden></section>' : "");

// Le dernier « Précédemment » seul, et la porte vers les autres.
const secDernierPrecedemment = (c) => `<section class="section-coin">${titreSection("precedemment", "Précédemment")}${htmlPrecedemment(c.precedemment.slice(0, 1))}${
  c.precedemment.length > 1 ? `<p class="vers-suite"><a href="#precedemment">Les séances d'avant (${c.precedemment.length - 1})</a></p>` : ""}</section>`;
const secToutPrecedemment = (c) => `<section class="section-coin">${htmlPrecedemment(c.precedemment)}</section>`;

// Les autres pages du carnet, en tuiles sous la fiche du héros : le menu les ouvre aussi, mais on les trouve ici sans le chercher.
function secTuiles(c) {
  const lignes = [
    ["personnages", pluriel(c.personnages.length, "personnage", "personnages")],
    ["lieux", pluriel(c.lieux.length, "lieu", "lieux")],
    ["contrats", `${pluriel(c.contrats.length, "contrat", "contrats")} · ${pluriel(c.rumeurs.length, "rumeur", "rumeurs")}`],
    ["documents", pluriel((c.documents || []).length, "document", "documents")],
    ["compagnie", pluriel((c.compagnie || []).length, "héros", "héros")],
    ["regles", `${pluriel(c.regles.length, "règle de table", "règles de table")} et l'aide-mémoire`],
    ...((c.sanctuaire || []).length ? [["sanctuaire", pluriel(nombreDeChantiers(c.sanctuaire), "chantier", "chantiers")]] : []),
    ...((c.activites || []).length ? [["activites", pluriel(nombreDActivites(c.activites), "activité", "activités")]] : []),
  ];
  return `<section class="section-coin">${titreSection("dans-le-carnet", "Dans le carnet")}<ul class="tuiles-carnet">${lignes.map(([vue, sous]) => `
    <li><a href="#${vue}"><b>${e(VUES[vue].titre)}</b><span>${e(sous)}</span></a></li>`).join("")}</ul>
    ${c.boutiques ? `<p class="vers-suite"><a href="#boutiques">${e(pluriel(c.boutiques, "boutique ouverte", "boutiques ouvertes"))} entre les séances</a></p>` : ""}</section>`;
}

// Un sommaire en tête des pages longues : le compte de chaque partie, et un saut vers elle.
function htmlSommaire(lignes) {
  return `<nav class="sommaire" aria-label="Sommaire de la page"><ol>${lignes.map(([id, titreL, n]) => `
    <li><a href="#carnet" data-aller="${id}"><span>${e(titreL)}</span><span class="points" aria-hidden="true"></span><span class="compte">${e(n === 0 ? "" : n)}</span></a></li>`).join("")}</ol></nav>`;
}
const htmlChercher = (placeholder) => `<label class="chercher"><span>Chercher dans cette page</span><input type="search" placeholder="${e(placeholder)}" autocomplete="off" enterkeyhint="search"></label>`;

function enTete(vue, c) {
  if (vue !== "accueil") {
    return `<header class="titre-carnet titre-page"><a class="retour-carnet" href="#carnet">Le carnet</a><h1>${e(VUES[vue].titre)}</h1>${VUES[vue].chapo ? `<p class="chapo">${e(VUES[vue].chapo)}</p>` : ""}</header>`;
  }
  const maj = c.maj ? `Mis à jour le ${dateFr(c.maj, { jour: false })} à ${heureFr(c.maj)}` : "";
  return `<header class="titre-carnet">
        <p class="kicker">${e(NOM)}</p>
        <h1>${e(VUES.accueil.titre)}</h1>
        ${htmlProchaine(c.prochaine)}
        <p class="chapo">Ce que vos héros ont vécu, croisé et appris, tenu à jour par votre MJ entre les séances.</p>
        ${maj ? `<p class="maj">${e(maj)}</p>` : ""}
      </header>`;
}

function corps(vue, c) {
  switch (vue) {
    case "personnages":
      return htmlChercher("Un nom, un métier, un peuple…") + secPersonnages(c);
    case "lieux":
      return htmlChercher("Un nom, un lieu, un genre…") + secLieux(c);
    case "contrats":
      return htmlChercher("Un contrat, une rumeur…") + secContrats(c);
    case "documents":
      return htmlChercher("Un titre, un mot…") + secDocuments(c);
    case "compagnie":
      return secCompagnie(c);
    case "regles":
      return htmlSommaire([["regles", "Règles de la table", c.regles.length], ["lire-la-table", "Lire la table", ""]])
        + htmlChercher("Une règle…") + secRegles(c) + secLireLaTable();
    case "sanctuaire":
      return secSanctuaire(c);
    case "activites":
      return secActivites(c);
    case "precedemment":
      return secToutPrecedemment(c);
    default:
      return secDernierPrecedemment(c) + secHeros(c) + secResumeActivites(c) + secTuiles(c);
  }
}

// Dessine une page du carnet. `ancre` : l'endroit où se poser (une partie de la page, ou l'ancienne ancre qui y menait).
export function afficherCarnet(page, c, vue = "accueil", ancre = "") {
  page.innerHTML = `
    <article class="feuille-coin carnet-coin" data-vue="${vue}">
      <span class="signet" aria-hidden="true"></span>
      ${enTete(vue, c)}
      ${corps(vue, c)}
    </article>`;
  sansImagesCassees(page);
  const carnet = page.querySelector(".carnet-coin");
  carnet.addEventListener("click", (ev) => {
    const lien = ev.target.closest("[data-aller]");
    if (!lien) return;
    ev.preventDefault();
    document.getElementById(lien.dataset.aller)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  carnet.querySelector(".chercher input")?.addEventListener("input", (ev) => chercher(carnet, forme(ev.target.value.trim())));
  if (ancre) document.getElementById(ancre)?.scrollIntoView({ block: "start" });
}

// Le filtre du carnet : les fiches dont le texte contient chaque mot tapé, sans accents ni casse ; un groupe sans
// fiche visible s'efface avec son titre.
function chercher(carnet, q) {
  const mots = q.split(/\s+/).filter(Boolean);
  for (const s of carnet.querySelectorAll(".cherchable")) {
    let vus = 0;
    const fiches = s.querySelectorAll("[data-cherche]");
    for (const f of fiches) {
      const ok = mots.every((m) => f.dataset.cherche.includes(m));
      f.hidden = !ok;
      vus += ok ? 1 : 0;
    }
    for (const g of s.querySelectorAll(".groupe-coin")) g.hidden = Boolean(mots.length) && !g.querySelector("[data-cherche]:not([hidden])");
    s.querySelector(".aucun").hidden = !fiches.length || vus > 0;
  }
}
