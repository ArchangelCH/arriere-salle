"""Les touches de l'atelier qu'on voit et qu'on retrouve (js/commun/touches.js, js/commun/echap.js) : la carte des raccourcis ne cite
que des touches lues par le code, les lettres des outils ne prennent pas celles de l'atelier, Mesurer a la même touche
dans les deux éditeurs, les boutons de l'en-tête portent leur lettre, le pied du Tableau rappelle les touches de la
soirée, Échap fait partout la même chose et une lettre tapée dans un champ ne déclenche jamais de raccourci. Enfin, la
touche R : en vigueur d'abord, l'aide-mémoire du kit, à trancher replié, et rien de créé par Entrée."""

import re
from pathlib import Path
from sources_front import source_page  # noqa: E402

APP = Path(__file__).resolve().parent.parent / "app"
STATIQUE = APP / "static"


def lire(chemin):
    return (STATIQUE / chemin).read_text(encoding="utf-8")


def outils(editeur):
    """Les lettres des outils d'un éditeur, lues dans sa liste OUTILS : {outil: lettre}."""
    source = lire(editeur)
    liste = source.split("export const OUTILS = [")[1].split("\n];")[0]
    return dict(re.findall(r'\["(\w+)", "[^"]+", "(\w)"\]', liste))


def methode(source, nom):
    return re.search(rf"\n  {nom}\(ev\) \{{(.*?)\n  \}}", source, flags=re.S).group(1)


# Les lettres des outils de la carte vivent à part (carte/outils.js) : la carte des touches les lit sans charger l'éditeur,
# qui porte les cartes du kit.
CARTE = outils("js/carte/outils.js")
PLAN = outils("js/plan/editeur.js")


def test_les_outils_des_editeurs_sont_lus():
    assert list(CARTE) == ["main", "terrain", "lieu", "trace", "texte", "brouillard", "groupe", "mesure", "pointeur"]
    assert list(PLAN) == ["main", "piece", "sol", "porte", "meuble", "pion", "image", "brouillard", "brume", "feu", "lumiere", "sang", "texte", "mesure", "pointeur"]
    for lettres in (CARTE, PLAN):
        assert len(set(lettres.values())) == len(lettres), "une lettre par outil"


def test_mesurer_a_la_meme_touche_dans_les_deux_editeurs():
    assert CARTE["mesure"] == PLAN["mesure"] == "G"
    # Les autres outils qui se répondent d'un éditeur à l'autre ont aussi la même lettre.
    for outil in ("main", "brouillard", "texte", "pointeur"):
        assert CARTE[outil] == PLAN[outil], outil
    assert CARTE["groupe"] == PLAN["pion"] == "J"


def test_les_touches_de_l_atelier_ne_sont_l_outil_d_aucun_editeur():
    # N, H, T, I et « ? » valent sur toutes les pages, cartes et plans compris. R reste l'outil Rivière de la carte (la
    # carte des touches le dit), et tourne un meuble sur un plan quand son orientation est à l'écran.
    for lettre in ("N", "H", "T", "I"):
        assert lettre not in CARTE.values() and lettre not in PLAN.values(), lettre
    assert CARTE["trace"] == "R" and "R" not in PLAN.values()
    assert "sur une carte, R reste l'outil Rivière" in lire("js/commun/touches.js")


def test_la_carte_des_touches_ne_cite_que_des_touches_lues_par_le_code():
    touches = lire("js/commun/touches.js")
    # Les outils viennent des listes des éditeurs eux-mêmes.
    assert 'import { OUTILS as OUTILS_CARTE } from "../carte/outils.js";' in touches
    assert 'import { OUTILS, tailleMarqueur } from "./outils.js";' in lire("js/carte/editeur.js")
    assert 'import { OUTILS as OUTILS_PLAN } from "../plan/editeur.js";' in touches
    # Les touches de l'atelier : chacune a son écoute.
    assert '.toLowerCase() !== "n"' in lire("js/seances/journal.js")
    assert '.toLowerCase() !== "r"' in lire("js/regles/rapide.js")
    assert '.toLowerCase() !== "h"' in lire("js/horloges/horloges.js") and "ev.shiftKey ? -1 : 1" in lire("js/horloges/horloges.js")
    assert 'lettre !== "t" && lettre !== "i"' in touches and 'ev.key === "?"' in touches
    # Le combat, l'écriture.
    combat = lire("js/combats/combat.js")
    assert 'ev.key !== "Enter"' in methode(combat, "touche") and "Case vide : Entrée passe la main" in combat
    scenarios = lire("js/scenarios/scenarios.js")
    assert 'ev.data === "@"' in scenarios and 'ev.key.toLowerCase() === "s"' in scenarios and '"ArrowDown"' in scenarios
    for fichier in ("js/regles/rapide.js", "js/idees/idees.js", "js/scenarios/scenarios.js"):
        assert re.search(r'ev\.key === "Enter" && \(ev\.ctrlKey \|\| ev\.metaKey\)', lire(fichier)), fichier
    # La carte : vue, pinceau, tracé, sélection.
    carte = methode(lire("js/carte/editeur.js"), "touche")
    for lu in ('ev.code === "Space"', 'ev.key === "+"', 'ev.key === "-"', 'ev.key === "0"', 'ev.key === "["', 'ev.key === "]"',
               'ev.key === "Enter" && this.traceEnCours', 'ev.key === "Backspace" && this.traceEnCours', 'ev.key === "Delete"',
               'ev.key === "Escape"', '"z"', '"y"'):
        assert lu in carte, lu
    assert "(ev.altKey || ev.shiftKey)" in lire("js/carte/editeur.js")
    # Le plan : flèches, rotation, vue, sélection, et les gestes Maj et Alt.
    plan_source = lire("js/plan/editeur.js")
    plan = methode(plan_source, "touche")
    for lu in ("ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", 'ev.key === "0"', 'ev.key.toLowerCase() === "r"', "ev.shiftKey ? -1 : 1",
               'ev.code === "Space"', 'ev.key === "Escape"', 'ev.key === "Delete"'):
        assert lu in plan, lu
    assert "effacer: ev.altKey, etendre: ev.shiftKey" in plan_source and plan_source.count("ev.altKey ? 0 :") >= 3
    # Maj + clic, Maj + glisser (plusieurs pions, le rectangle, tous les héros visibles) : lus dans basSelection.
    selection = plan_source.split("  basSelection(x, y, ev, genres) {")[1].split("\n  }\n")[0]
    assert "this.multiple || ev.shiftKey || ev.ctrlKey || ev.metaKey" in selection and 'type: "lasso"' in selection
    assert "ev.shiftKey && herosVisible(o)" in selection and "pasDuGroupe" in plan and 'sel.genre === "pions"' in plan_source
    # Ni + ni − ni [ ] sur un plan : la carte du plan n'en parle pas.
    page_plan = touches.split("  plan: {")[1].split("\n  },\n};")[0]
    assert '"+ −"' not in page_plan and '"[ ]"' not in page_plan


def test_les_boutons_de_l_en_tete_portent_leur_lettre():
    page = lire("index.html")
    assert re.search(r'class="ouvrir-tableau"[^>]*title="[^"]*\(touche T\)">Tableau<kbd class="touche" aria-hidden="true">T</kbd>', page)
    assert re.search(r'class="noter-journal" type="button" hidden>Journal<kbd class="touche" aria-hidden="true">N</kbd>', page)
    assert re.search(r'class="noter-idee"[^>]*title="[^"]*\(touche I\)">Idée<kbd class="touche" aria-hidden="true">I</kbd>', page)
    assert "(touche N)" in lire("js/seances/journal.js")
    css = lire("css/touches.css")
    # Les lettres des outils des éditeurs : 11 px, plus claires qu'avant (9 px, --texte-pale).
    assert re.search(r"\.editeur \.outils kbd \{[^}]*font-size: 11px;[^}]*color: var\(--texte-doux\)", css)
    assert 'href="/static/css/touches.css"' in page


def test_le_pied_du_tableau_rappelle_les_touches_de_la_soiree():
    tableau = lire("js/tableau/tableau.js")
    assert 'this.pied.className = "tableau-pied";' in tableau and "this.panneau.append(this.pied);" in tableau
    touches = lire("js/commun/touches.js")
    assert ("<kbd>N</kbd> journal · <kbd>R</kbd> règles · <kbd>H</kbd> horloge · <kbd>Entrée</kbd> main suivante") in touches
    pied = re.search(r"\nfunction poserPiedTableau\(\) \{(.*?)\n\}", touches, flags=re.S).group(1)
    assert 'querySelector(".tableau-mj .tableau-pied")' in pied and "pied.hidden = false;" in pied
    # Posé une fois le Tableau construit.
    atelier = source_page("atelier")
    assert atelier.index('new Tableau(document.querySelector(".entete"));') < atelier.index("installerTouches({ barre: barreOnglets });")


def test_une_lettre_tapee_dans_un_champ_ne_declenche_aucun_raccourci():
    touche = re.search(r"\nfunction touche\(ev\) \{(.*?)\n\}", lire("js/commun/touches.js"), flags=re.S).group(1)
    for garde in ("ev.ctrlKey", "ev.metaKey", "ev.altKey", "ev.isComposing", "ev.repeat", "champDeSaisie(cible)",
                  'closest("input, textarea, select, dialog")', "dialogueOuvert()", "ev.stopPropagation()"):
        assert garde in touche, garde
    for fichier, garde in (("js/seances/journal.js", 'closest("input, textarea, select, dialog")'),
                           ("js/regles/rapide.js", 'closest("input, textarea, select, dialog")'),
                           ("js/horloges/horloges.js", 'closest("input, textarea, select, dialog, [contenteditable]")')):
        assert garde in lire(fichier), fichier
    echap = lire("js/commun/echap.js")
    assert 'el.closest("input, textarea, select, [contenteditable]")' in echap


def test_echap_partout_pareil():
    echap = lire("js/commun/echap.js")
    assert 'document.addEventListener("keydown", touche, true);' in echap
    touche = re.search(r"\nfunction touche\(ev\) \{(.*?)\n\}", echap, flags=re.S).group(1)
    # 1. Dans un dialogue : une recherche remplie ne retient plus Échap, le dialogue se ferme du premier coup.
    assert 'champ.matches(\'input[type="search"]\') && champ.value' in touche and "fermerDialogue(dialogue)" in touche
    # 2. Dans un champ : il perd le focus, rien d'autre (la recherche ne se vide pas).
    champ = touche.split("if (champ) {")[1].split("\n  }\n")[0]
    assert "ev.preventDefault();" in champ and "champ.blur();" in champ
    assert touche.index("if (dialogue)") < touche.index("if (champ)") < touche.index("for (const c of couches)")
    # 3. Les couches : les menus avant le Tableau, qui sur une carte ou un plan laisse Échap à l'éditeur.
    touches = lire("js/commun/touches.js")
    noms = re.findall(r'coucheEchap\(\{\s*nom: "(\w+)"', touches)
    assert noms == ["familles", "exporter", "musique", "sommaire", "tableau"]
    assert "garde: () => !surUnEditeur() || tableauVientDEtreTouche()" in touches
    # Le menu Exporter des éditeurs se ferme aussi au clic ailleurs.
    assert re.search(r'pointerdown", \(ev\) => \{\s*if \(ev\.target instanceof Element && ev\.target\.closest\("\.menu-exporter"\)\) return;', touches)
    assert "installerEchap();" in touches


def test_la_touche_r_revue():
    rapide = lire("js/regles/rapide.js")
    # Entrée ne crée rien : le formulaire de recherche ne fait plus que s'arrêter.
    assert 'this.formChercher.addEventListener("submit", (ev) => ev.preventDefault());' in rapide
    assert "Appuyez sur Entrée" not in rapide and "this.nouvelle(q)" not in rapide
    afficher = re.search(r"\n  afficher\(\) \{(.*?)\n  \}", rapide, flags=re.S).group(1)
    # En vigueur, puis l'aide-mémoire du kit, puis « À trancher », replié.
    assert afficher.index('STATUTS["en-vigueur"]') < afficher.index("this.htmlKit(kit, mots)}\n") < afficher.index('STATUTS["a-trancher"]')
    assert '<details class="rm-groupe-rapide rm-a-trancher" ${deplie ? "open" : ""}>' in afficher
    assert "this.trancherOuvert = false;" in rapide
    assert 'import { AIDE_MEMOIRE, aideCherchable } from "./aide-memoire.js";' in rapide
    kit = lire("js/regles/aide-memoire.js")
    for titre in ("Tests et critiques", "Les cartons", "Coma et mort", "Les postures", "Le sablier"):
        assert f'titre: "{titre}"' in kit, titre
    # Les chiffres viennent du combat et du créateur, pas d'une copie.
    assert 'import { CARTONS, SABLIER, SITUATIONS, seuilMort } from "../combats/suivi.js";' in kit
    assert 'import { POSTURES } from "../aventuriers/regles.js";' in kit


def test_ni_la_tv_ni_le_coin_des_joueurs_ne_chargent_les_touches():
    for module in ("touches.js", "echap.js", "aide-memoire.js"):
        assert module not in source_page("table"), module
        assert module not in lire("js/joueurs/joueur.js"), module
    assert "touches.css" not in lire("table.html") and "touches.css" not in lire("joueurs/index.html")


def test_le_texte_suit_le_style_de_l_atelier():
    for fichier in ("js/commun/touches.js", "js/commun/echap.js", "js/commun/onglets.js", "js/regles/aide-memoire.js", "css/touches.css", "css/entete.css"):
        texte = lire(fichier)
        assert "—" not in texte and "–" not in texte, fichier


def test_trancher_depuis_l_onglet_comme_par_la_touche_r():
    regles = lire("js/regles/regles.js")
    # La séance en cours est proposée (la même règle que la touche R), seulement si la règle n'en a pas.
    assert "if (trancher && !r.seance) this.proposerSeance(this.edition);" in regles
    proposer = re.search(r"\n  async proposerSeance\(ed\) \{(.*?)\n  \}", regles, flags=re.S).group(1)
    assert "await seanceEnCours()" in proposer and "v.journal = s.date === aujourdhui();" in proposer
    assert "this.edition !== ed" in proposer and "v.seance) return;" in proposer
    # Enregistrée en vigueur, la ligne part au journal de cette séance, comme par la touche R.
    enregistrer = re.search(r"\n  async enregistrer\(\) \{(.*?)\n  \}", regles, flags=re.S).group(1)
    assert "ed.trancher && v.journal && v.seance" in enregistrer
    assert "noterAuJournal(v.seance, `Règle maison : ${maj.titre}`)" in enregistrer
    assert "noterAuJournal(seance.id, `Règle maison : ${regle.titre}`)" in lire("js/regles/rapide.js")
    # Le journal coché n'est pas un champ de la règle : il ne part pas au serveur.
    champs = re.search(r"const champs = \{(.*?)\};", enregistrer, flags=re.S).group(1)
    assert "journal" not in champs
