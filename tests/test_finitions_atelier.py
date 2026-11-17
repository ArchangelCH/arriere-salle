"""Les finitions de l'atelier et des éditeurs : la feuille de combat et le suivi numérotent d'après le même plan (celui de
la scène, sinon un plan du lieu de la rencontre, sinon aucun), les petits liens de préparation font 44 px au doigt, la
barre des étapes tient sur une rangée au téléphone, et les messages se posent en bas à droite de la page, loin de ses
boutons du haut."""

import re
from pathlib import Path
from sources_front import source_page  # noqa: E402

STATIQUE = Path(__file__).resolve().parent.parent / "app" / "static"
JS = STATIQUE / "js"
CSS = STATIQUE / "css"


def lire(chemin):
    return (STATIQUE / chemin).read_text(encoding="utf-8")


def bloc(css, media):
    """Le contenu d'un bloc @media, accolades équilibrées."""
    debut = css.index(media)
    i = css.index("{", debut) + 1
    profondeur = 1
    while profondeur:
        profondeur += {"{": 1, "}": -1}.get(css[i], 0)
        i += 1
    return css[debut:i]


def test_feuille_et_suivi_numerotent_d_apres_le_meme_plan():
    """L'étang de la séance 2 prenait les pions de l'auberge en flammes : une scène le lie sans plan, et planDe choisissait
    le plan qui portait le plus de Frères de l'Eau. La règle commune ne cherche plus hors du lieu de la rencontre."""
    regle = lire("js/combats/plan-de-scene.js")
    corps = regle.split("export function planDesNumeros(")[1].split("\n}\n")[0]
    assert "planDeLaScene(seance, rencontre, plans)" in corps
    assert "x.lieu === rencontre.lieu" in corps
    feuille = lire("js/seances/feuille-combat.js")
    assert "planDesNumeros(seance, r, plans)" in feuille and "planDe(" not in feuille
    combat = lire("js/combats/combat.js")
    assert "return planDesNumeros(this.seance, r, this.plans || []);" in combat and "planDe(" not in combat


def test_les_petits_liens_de_preparation_font_44_px_au_doigt():
    doigt = bloc(lire("css/doigt.css"), "@media (pointer: coarse)")
    for selecteur in (".lien-versions", ".identite-boutique .liens a", ".resume-boutique a", ".corbeille-genres button.lien", ".tableau-pied .toutes-les-touches"):
        assert selecteur in doigt, selecteur
    regle = doigt.split(".tableau-pied .toutes-les-touches {")[1].split("}")[0]
    assert "min-height: 44px" in regle
    # Sur le Mac, ils gardent leur taille : rien hors du bloc (pointer: coarse).
    reste = lire("css/doigt.css").replace(doigt, "")
    assert ".lien-versions" not in reste


def test_la_barre_des_etapes_tient_sur_une_rangee_au_telephone():
    tel = bloc(lire("css/etroit.css"), "@media (max-width: 640px)")
    assert re.search(r"\.scene \.etapes-plan \{[^}]*left: 0; right: 0; bottom: 0;", tel)
    assert re.search(r"\.scene \.etapes-plan button \{[^}]*flex: 1 1 0; min-width: 44px;", tel)
    # Le nom de l'étape reste écrit, au-dessus des boutons.
    assert re.search(r"\.etapes-plan \.nom-etape \{[^}]*flex: 1 0 100%;", tel)


def test_les_messages_se_posent_en_bas_a_droite_dans_l_atelier():
    api = lire("js/api.js")
    placer = api.split("function placerToasts(zone) {")[1].split("\n}\n")[0]
    # Dans l'atelier hors des éditeurs : en bas, au-dessus du clavier, de l'avis des inconnus et du pied du Tableau.
    assert 'document.body.classList.contains("atelier") && !document.querySelector(".editeur")' in placer
    assert "visualViewport" in placer and "querySelectorAll(BAS_DE_L_ECRAN)" in placer
    bas = re.search(r'const BAS_DE_L_ECRAN = "([^"]+)";', api).group(1)
    assert {s.strip() for s in bas.split(",")} == {".avis-secrets", ".tableau-mj:not([hidden]) .tableau-pied"}
    # Toujours à gauche du Tableau, même quand il couvre la page, s'il reste de la place.
    assert "bordTableau >= 360" in placer
    # La télécommande, le coin des joueurs et les feuilles gardent la règle du haut.
    assert '<body class="atelier">' in lire("index.html")
    assert 'class="atelier' not in lire("telecommande.html") and "atelier" not in lire("joueurs/index.html").split("<body")[1].split(">")[0]


def test_une_carte_vierge_peut_naitre_avec_un_relief_au_hasard():
    """b17 : la carte vierge n'est plus forcément 33 000 cases d'herbe ; le relief au hasard se choisit comme terrain de
    départ, et ne pose ni rivière, ni route, ni lieu."""
    atelier = source_page("atelier")
    assert '<option value="hasard">Relief au hasard' in atelier
    assert 'relief: hasard' in atelier and 'fond: hasard ? B.plaine : +form.fond.value' in atelier
    gen = lire("js/carte/generateur.js")
    assert "export function reliefAuHasard(largeur, hauteur, graine = 1)" in gen
    assert "const terrain = relief ? reliefAuHasard(largeur, hauteur, graine) : new Uint8Array(largeur * hauteur).fill(fond);" in gen
    vierge = gen.split("export function genererVierge(")[1].split("\n}\n")[0]
    assert "traces: []" in vierge and "marqueurs: []" in vierge


def test_le_passage_au_style_peint_dit_peinture_en_cours():
    """b15 : le style Peint se peint morceau par morceau ; l'éditeur dit « Peinture de la carte… » jusqu'au dernier
    morceau. Le signal est inerte sur la TV (aucun écouteur, et son fond fourni ne passe pas par les morceaux)."""
    vue = lire("js/carte/vue.js")
    corps = vue.split("  construireBasePeinte() {")[1].split("\n  }\n")[0]
    assert "this.peintureEnCours = true;" in corps
    assert "if (faits.size === blocs.length) {" in corps and "if (this.surPeinturePrete) this.surPeinturePrete();" in corps
    # Le fond fourni (TV) revient avant : la peinture n'y est jamais « en cours ».
    assert corps.index("if (f && f.image") < corps.index("this.peintureEnCours = true;")
    editeur = lire("js/carte/editeur.js")
    assert "this.annoncerPeinture();" in editeur.split("  changerStyle(style) {")[1].split("\n  }\n")[0]
    assert 'toast("Peinture de la carte…", "info", { duree: 60000 })' in editeur
    assert "surPeinturePrete" not in source_page("table")


def test_la_liste_des_boutiques_rappelle_l_article_trouve():
    """Comme les listes des PNJ et des lieux : une boutique trouvée par ses articles les rappelle sous son nom, surlignés."""
    js = lire("js/boutiques/boutiques.js")
    liste = js.split("  afficherListe() {")[1].split("\n  }\n")[0]
    assert "this.articlesQuiRepondent(b, brut)" in liste and '<span class="trouve"><b>Article' in liste
    assert "surligner(t, brut)" in liste
    # « potion soin » trouve « Potion de soins » : la liste garde la boutique, comme le Comptoir garde l'article.
    assert "this.articlesQuiRepondent(b, brut).length > 0)" in liste.split(".sort(")[0]
    regle = js.split("  articlesQuiRepondent(b, brut) {")[1].split("\n  }\n")[0]
    # Trouvée par son nom, son accroche, son marchand ou son lieu : rien à rappeler.
    assert "b.nom, b.accroche, this.nomDe(this.pnj, b.marchand), this.nomDe(this.lieux, b.lieu)" in regle
    css = lire("css/chercher.css")
    assert ".liste-boutiques .trouve {" in css.replace(".liste-pnj .trouve, .repertoire .trouve, ", "") and ".liste-boutiques mark {" in css.replace(".ch-resultats mark, .liste-pnj mark, .repertoire mark, .resultats-ici mark, .resultats-rapides mark, ", "")


def test_seances_cite_le_nom_que_liront_les_joueurs():
    """E03 côté atelier : l'avertissement du nom secret et la copie du message aux joueurs citent le nom choisi dans
    l'onglet Table (« l'auberge de Toma »), plus « l'auberge » en dur."""
    seances = lire("js/seances/seances.js")
    assert "« l'auberge »" not in seances
    assert seances.count("${await nomPourLesJoueurs()}") == 2
    bloc = lire("js/auberge/nom-auberge.js")
    assert "export async function nomPourLesJoueurs()" in bloc and 'api.get("/api/nom-auberge")' in bloc
    assert "Fanfrel" not in bloc
