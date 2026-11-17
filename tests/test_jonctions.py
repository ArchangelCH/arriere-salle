"""Les jonctions entre les chantiers du premier passage : la page Jouer lit la TV comme le témoin, tout carton de PNJ
passe par la question des inconnus, un plan tout noir n'arrive pas à la TV sans le dire (question ou « Ouvrir le plan »),
les messages ne cachent ni la barre du combat ni le bandeau de la séance, le témoin de la TV garde sa place quand une
ambiance joue, le témoin écrit les noms comme la TV (le nom caché de l'auberge y devient « l'auberge »), la touche T
compte comme un geste vers le Tableau, et un héros remis de la corbeille retrouve sa place parmi les présents."""

import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application  # noqa: E402

STATIQUE = Path(__file__).resolve().parent.parent / "app" / "static"
JS = STATIQUE / "js"
CF = {"CF-Connecting-IP": "203.0.113.7"}


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def lire(chemin):
    return (STATIQUE / chemin).read_text(encoding="utf-8")


def bloc(source, debut):
    """Le corps d'un « if (a === …) { … } » de premier niveau, jusqu'à l'accolade qui le ferme."""
    i = source.index(debut)
    profondeur = 0
    for j in range(source.index("{", i), len(source)):
        profondeur += {"{": 1, "}": -1}.get(source[j], 0)
        if profondeur == 0:
            return source[i:j + 1]
    raise AssertionError(debut)


def test_jouer_lit_la_tv_comme_le_temoin():
    """Un autre écran ou la télécommande change la TV : les boutons « Montrer » et « Retirer » de Jouer suivent l'état
    que lit le témoin (etat-tv.js), pas une copie relue à l'ouverture de la page."""
    seances = lire("js/seances/seances.js")
    assert 'import { ecouterTv } from "../ecran-tv/etat-tv.js";' in seances
    demarrer = seances.split("  async demarrer() {")[1].split("\n  }\n")[0]
    assert "this.finTv = ecouterTv(" in demarrer and "this.majBoutonsTable();" in demarrer.split("this.finTv = ecouterTv(")[1]
    assert "this.finTv?.();" in seances.split("  detruire() {")[1].split("\n  }\n")[0]


# Les façons d'écrire « le carton de ce PNJ sur la TV » dans un état envoyé à la table.
CARTON_VERS_LA_TV = re.compile(r"\bpnj:\s*(?:montrer \? [\w.]+ : null|p\.id|b\.dataset\.pnj|id)\s*[,}]")


def test_tout_carton_de_pnj_vers_la_tv_passe_par_la_question():
    """Ce qu'un carton nomme d'inconnu des joueurs (un lieu dans son rôle…) se vérifie avant la TV, par tous les chemins :
    le carnet, le pion d'un plan, Séances, le Tableau, la télécommande et le comptoir de l'auberge."""
    chemins = set()
    for f in JS.rglob("*.js"):
        if f.name in ("table.js", "carton-pnj.js") or "tv" == f.parent.name:
            continue
        source = f.read_text(encoding="utf-8")
        if CARTON_VERS_LA_TV.search(source):
            chemins.add(str(f.relative_to(JS)))
            assert re.search(r"\b(cartonVerifie|nomsInconnus)\(", source), f"{f.relative_to(JS)} envoie un carton sans la question"
    assert {"pnj/carnet.js", "plan/editeur.js", "seances/seances.js", "tableau/impro.js", "telecommande/gestes.js", "auberge/auberge.js"} <= chemins
    auberge = lire("js/auberge/auberge.js")
    montrer = auberge.split("  async montrerPnj(id) {")[1].split("\n  }\n")[0]
    assert montrer.index("cartonVerifie(p.id, p.nom") < montrer.index("this.envoyer({ pnj: id })")


def test_un_plan_noir_montre_depuis_jouer_pose_la_question():
    """« Montrer » un plan sous brouillard dont rien n'est révélé : la même question que la page Table, sur le plan relu."""
    seances = lire("js/seances/seances.js")
    assert 'import { questionTvNoire } from "../ecran-tv/tv-noire.js";' in seances and 'import { rienDeRevele } from "../ecran-tv/tv-commun.js";' in seances
    montrer = bloc(seances, 'if (a === "plan-montrer") {')
    assert "api.get(`/api/plans/" in montrer and "rienDeRevele(frais)" in montrer
    assert montrer.index("questionTvNoire({ nom: p.nom, editeur: false })") < montrer.index("this.envoyer(")
    assert 'if (choix !== "noire") return;' in montrer


def test_la_scene_suivante_garde_ouvrir_le_plan():
    """Le bandeau de Jouer et le Tableau jouent la scène suivante comme « Jouer la scène » : un plan encore noir à la TV
    vient avec « Ouvrir le plan » dans le compte rendu."""
    seances = lire("js/seances/seances.js")
    suite = bloc(seances, 'if (a === "jouer-suite") {')
    # Le compte rendu peut finir par le rappel des billets de la scène (billets.js) : l'action reste.
    assert "toast(bilan.texte + billets, bilan.erreur ? \"erreur\" : undefined, { action: bilan.action });" in suite
    tableau = lire("js/tableau/seance.js")
    assert "toast(bilan.texte, bilan.erreur ? \"erreur\" : undefined, { action: bilan.action });" in tableau


def test_les_messages_passent_sous_les_barres_collees():
    """En haut à droite, un message ne couvre ni « Suivant » de la barre du combat, ni « Jouer » du bandeau de la séance,
    ni le bouton de la TV d'une fiche, ni l'état de l'enregistrement : il se pose dessous, et suit quand la page défile et
    qu'une barre se colle. La barre du combat collée en haut de la page le renvoie en bas à droite : juste sous elle se joue
    la première ligne d'adversaires."""
    api = lire("js/api.js")
    haut = re.search(r'const HAUT_DE_L_ECRAN = "([^"]+)";', api).group(1)
    assert {s.strip() for s in haut.split(",")} == {".entete", ".barre-carte", ".barre-combat.barre-page", ".bandeau-seance", ".tv-colle .bouton-tv",
                                                     ".temoin-enregistrement"}
    placer = api.split("function placerToasts(zone) {")[1].split("\n}\n")[0]
    assert "querySelectorAll(HAUT_DE_L_ECRAN)" in placer
    assert 'el.matches(".barre-combat")' in placer and 'zone.style.bottom = combat ? "16px" : ""' in placer
    zone = api.split("function zoneToasts() {")[1].split("\n}\n")[0]
    assert 'document.addEventListener("scroll"' in zone and "{ capture: true, passive: true }" in zone


def test_le_temoin_garde_sa_place_quand_une_ambiance_joue():
    """Le nom d'une ambiance qui joue s'abrège avant le témoin de la TV ; sous 1250 px, la musique se réduit à son signe
    et « Retirer » reste aux pages, puis le témoin cède le dernier."""
    entete = lire("css/entete.css")
    assert ".entete-atelier .bouton-musique { min-width: 0; flex: 0 1 auto; }" in entete
    assert ".entete-atelier .temoin-tv { min-width: 0; flex: none; }" in entete
    etroit = entete.split("@media (max-width: 1250px) {")[1].split("\n}\n")[0]
    for regle in (".entete-atelier .bouton-musique .libelle { display: none; }", ".entete-atelier .temoin-retirer { display: none; }",
                  ".entete-atelier .outils-entete kbd.touche { display: none; }", ".entete-atelier .temoin-tv { flex: 0 1 auto; }"):
        assert regle in etroit, regle


def test_t_compte_comme_un_geste_vers_le_tableau():
    """Sur un plan, Échap ferme le Tableau seulement si l'on vient de le toucher : la touche T qui l'ouvre en est un."""
    echap = lire("js/commun/echap.js")
    assert re.search(r"export const toucherLeTableau = \(\) => \{\s*tableauTouche = true;\s*\};", echap)
    touche = re.search(r"\nfunction touche\(ev\) \{(.*?)\n\}", lire("js/commun/touches.js"), flags=re.S).group(1)
    assert touche.index('if (lettre === "t") toucherLeTableau();') < touche.index('.entete .ouvrir-tableau')


def test_un_heros_remis_retrouve_sa_place_parmi_les_presents():
    """Mis à la corbeille sans question, puis « Annuler » : le héros retrouve sa ligne de la tablée des séances (même
    identifiant, même rang), celle par laquelle la séance du soir le compte parmi ses présents (Jouer › La compagnie)."""
    createur = lire("js/aventuriers/createur.js")
    synchro = createur.split("  async synchroniserTablee(a, retirer = false) {")[1].split("\n  }\n")[0]
    assert synchro.index("this.ligneRetiree = { ligne: t[i], rang: i };") < synchro.index("t.splice(i, 1);")
    assert "const place = this.ligneRetiree;" in createur and "apres: (r) => remettreALaTablee(r.id, place)" in createur
    corbeille = lire("js/corbeille/corbeille.js")
    remettre = corbeille.split("export async function remettreALaTablee(id, place = null) {")[1].split("\n}\n")[0]
    assert "place?.ligne?.id && !t.some((j) => j.id === place.ligne.id)" in remettre
    assert "t.splice(Math.min(Math.max(0, +place.rang || 0), t.length), 0, ligne)" in remettre


def test_le_temoin_ecrit_les_noms_comme_la_tv(client):
    """Le sanctuaire « de près » sur l'auberge, ou le lieu de l'auberge sur une carte : la TV écrit « L'auberge », le témoin
    aussi. Les noms de la description passent ensemble par le masque du serveur, chacun retrouvé à sa place."""
    etat = lire("js/ecran-tv/etat-tv.js")
    decrire = etat.split("export async function decrire(t) {")[1].split("\n}\n")[0]
    assert decrire.index("await Promise.all(travaux);") < decrire.index("await commeLaTv(d);") < decrire.index("return d;")
    comme = etat.split("async function commeLaTv(d) {")[1].split("\n}\n")[0]
    assert 'api.post("/api/masque"' in comme and "r?.trouve" in comme and "parts.length === champs.length" in comme
    separation = re.search(r'const SEPARATION = "(.*?)";', etat).group(1).encode().decode("unicode_escape")
    noms = ["Le sanctuaire", "La petite fanfrelée", "La petite Fanfrelée", "Toma de Silbermann"]
    r = client.post("/api/masque", json={"texte": separation.join(noms)}).json()
    assert r["trouve"] and r["texte"].split(separation) == ["Le sanctuaire", "L'auberge", "L'auberge", "Toma de Silbermann"]
    # La route reste à l'atelier : la table publique ne s'en sert pas.
    assert client.post("/api/masque", json={"texte": "x"}, headers=CF).status_code == 404


def test_avant_de_jouer_suit_les_liens_des_scenes():
    """Un plan tout noir lié à une scène dans Préparer : « Avant de jouer » le signale aussitôt, sans attendre le
    prochain dessin de l'onglet."""
    seances = lire("js/seances/seances.js")
    maj = seances.split("  majLier(i, focus) {")[1].split("\n  }\n")[0]
    assert "this.majAvantDeJouer();" in maj
    avant = seances.split("  majAvantDeJouer() {")[1].split("\n  }\n")[0]
    assert "htmlAvantDeJouer(this.lignesAvantDeJouer(s))" in avant and '.querySelector(".avant-de-jouer")' in avant
    assert "${htmlAvantDeJouer(this.lignesAvantDeJouer(s))}" in seances.split("  ongletPreparer(s) {")[1].split("\n  }\n")[0]


def test_h_sans_horloge_se_lit_et_s_en_va():
    """H par réflexe sans horloge créée : le refus du serveur (409) passe comme un message ordinaire ; seules les vraies
    pannes restent affichées jusqu'au ×."""
    horloges = lire("js/horloges/horloges.js")
    assert 'toast(`Horloges : ${err.message}`, err.status === 409 ? "info" : "erreur");' in horloges


def test_le_tableau_qui_couvre_la_page_garde_son_jouer():
    """Sous 1 100 px (l'iPad en portrait, l'iPhone déplié), le Tableau couvre la page au lieu de la pousser : sur la page
    de la séance, le « Jouer » du bandeau est dessous, et le Tableau garde alors le fil de la séance en tête."""
    css = lire("css/atelier.css")
    assert re.search(r"@media \(min-width: 1100px\) \{\s*body\.tableau-ouvert #page \{ margin-right: var\(--largeur-tableau\); \}", css)
    seance = lire("js/tableau/seance.js")
    assert 'const POUSSE = matchMedia("(min-width: 1100px)");' in seance
    assert "const ici = s && POUSSE.matches && " in seance and 'POUSSE.addEventListener("change"' in seance


def test_la_touche_h_sans_horloge_ne_laisse_pas_d_erreur_dans_la_console():
    """H sans aucune horloge : la liste se relit d'abord, et le refus se dit sans requête refusée (409) dans la console."""
    source = lire("js/horloges/horloges.js")
    touche = source[source.index("  touche(ev) {"):]
    assert 'api.get("/api/horloges")' in touche
    assert touche.index('api.get("/api/horloges")') < touche.index('api.post("/api/horloges/avancer"')
