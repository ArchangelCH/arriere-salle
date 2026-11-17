"""L'iPad et les téléphones du MJ : 44 px au toucher pour les boutons de partie (css/doigt.css, sous (pointer: coarse),
le Mac n'en voit rien), la rangée de dégâts au toucher du chiffre de Santé (js/commun/degats-doigt.js), les étapes du feu
nommées dans la barre, le Tableau ouvert sur l'iPad et la barre des éditeurs à l'étroit (css/etroit.css), l'en-tête
du téléphone sur trois lignes, et la télécommande dont le « Fait » ne couvre plus les touches."""

import re
from pathlib import Path
from sources_front import source_page  # noqa: E402

STATIQUE = Path(__file__).resolve().parent.parent / "app" / "static"


def lire(chemin):
    return (STATIQUE / chemin).read_text(encoding="utf-8")


def sans_commentaires(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def blocs_de_tete(css):
    """Les règles de premier niveau d'une feuille : (en-tête, corps)."""
    css = sans_commentaires(css)
    blocs, i = [], 0
    while True:
        debut = css.find("{", i)
        if debut < 0:
            return blocs
        profondeur, j = 1, debut + 1
        while profondeur:
            profondeur += {"{": 1, "}": -1}.get(css[j], 0)
            j += 1
        blocs.append((css[i:debut].strip(), css[debut + 1:j - 1]))
        i = j


def test_la_feuille_du_doigt_est_liee_en_dernier_et_ne_touche_pas_le_mac():
    page = lire("index.html")
    feuilles = re.findall(r'<link rel="stylesheet" href="/static/css/([\w-]+)\.css">', page)
    assert feuilles[-2:] == ["etroit", "doigt"], feuilles
    # Tout est sous (pointer: coarse), ou sous (hover: none) pour le survol collé par le toucher.
    for tete, _ in blocs_de_tete(lire("css/doigt.css")):
        assert tete in ("@media (pointer: coarse)", "@media (hover: none)"), tete


def test_44_px_pour_les_boutons_de_partie():
    css = sans_commentaires(lire("css/doigt.css"))
    for regle in (
        r"button, \.bouton \{ min-height: 44px; \}",
        r"\.etapes-plan button \{ min-width: 44px; min-height: 44px; \}",
        r"\.barre-carte \.icone-seule, \.barre-carte \.defilement button \{ width: 44px; \}",
        r"\.tc-cartons button \{ width: 44px; min-height: 44px;",
        r"\.jeton-combat button \{ width: 44px; height: 44px; min-height: 44px;",
        r"\.postures-combat button \{ width: 44px; height: 44px; min-height: 44px; \}",
        r"\.hz-pas button \{ width: 44px; height: 44px; min-height: 44px; \}",
        r"\.toast-action \{ min-height: 44px;",
        r"\.tableau-tete \.fermer \{ width: 44px; min-height: 44px;",
        r"\.entete-atelier \.temoin-tv \{ height: 44px;",
        r"\.bc-ordre button, \.barre-tableau \.bc-ordre button \{ min-height: 44px; \}",
        r"\.barre-combat \.bc-fin \{ min-height: 44px;",
        r"button\.mini \{ min-height: 44px;",
        r"\.presents \.case, \.deroule-jeu \.case \{ min-height: 44px;",
    ):
        assert re.search(regle, css), regle
    # Annuler et Rétablir écartés, « Suivre » en vrai bouton, enfoncé quand la TV suit.
    assert re.search(r'\.barre-carte \[data-action="annuler"\] \+ \[data-action="refaire"\] \{ margin-left: 1\dpx; \}', css)
    assert re.search(r"\.barre-carte \.bascule \{[^}]*min-height: 44px;[^}]*border: 1px solid", css)
    assert ".barre-carte .bascule:has(input:checked)" in css
    # Les cases à cocher et l'en-tête : 22 px, deux lignes plus hautes au doigt (le téléphone a les siennes).
    assert re.search(r'input\[type="checkbox"\], input\[type="radio"\] \{ width: 22px; height: 22px; \}', css)
    assert re.search(r"@media \(min-width: 761px\) \{\s*\.atelier \{ --haut-ligne1: 56px; --haut-ligne2: 45px; \}", css)


def test_le_bouton_tableau_ne_reste_pas_allume_apres_un_toucher():
    blocs = dict(blocs_de_tete(lire("css/doigt.css")))
    survol = blocs["@media (hover: none)"]
    assert re.search(r"\.ouvrir-tableau:hover, \.bouton-musique:hover \{ background: transparent; border-color: var\(--filet-fort\); \}", survol)
    # Ouvert, il garde son état.
    assert '.ouvrir-tableau[aria-expanded="true"]:hover' in survol


def test_les_boutiques_ecartent_retirer_et_passent_les_marques_sous_le_nom():
    css = sans_commentaires(lire("css/boutiques.css"))
    assert re.search(r'\.outils-article \.mini\[data-action="dupliquer"\] \{ margin-right: 1\dpx; \}', css)
    assert re.search(r"\.outils-article \.mini\.danger \{ margin-left: auto; \}", css)
    assert re.search(r"\.liste-boutiques \.texte \{ flex-basis: 100%; \}", css)


def test_la_rangee_de_degats_passe_par_la_saisie_de_la_ligne():
    source = lire("js/commun/degats-doigt.js")
    assert "const PAS = [-1, -2, -3, -5, 1, 3];" in source
    assert 'matchMedia("(pointer: coarse)")' in source
    # Le coup choisi part par la case de saisie, comme « -3 » puis Entrée : les pages la lisent à son changement.
    assert 'c.dispatchEvent(new Event("change", { bubbles: true }))' in source
    assert ".sante-combat, .tc-jauge.sante output" in source
    atelier = source_page("atelier")
    assert 'import { installerRangeeDegats } from "./commun/degats-doigt.js";' in atelier
    assert "\ninstallerRangeeDegats();" in atelier
    # Les trois pages qui la reçoivent lisent bien leur case de Santé au changement.
    assert 'zone.addEventListener("change", (ev) => this.choix(ev), option);' in lire("js/combats/combat.js")
    assert 'zone.addEventListener("change", (ev) => this.choix(ev), option);' in lire("js/seances/compagnie.js")
    assert 'this.zoneHors.addEventListener("change"' in lire("js/tableau/tableau.js")
    for genre in ('data-saisie="h:', 'data-saisie="a:'):
        assert genre in lire("js/combats/combat.js"), genre
    assert 'data-cp-saisie="sante"' in lire("js/seances/compagnie.js")


def test_les_etapes_du_feu_sont_nommees_dans_la_barre():
    source = lire("js/plan/editeur.js")
    maj = re.search(r"\n  majEtapes\(\) \{(.*?)\n  \}", source, flags=re.S).group(1)
    # Le nom avant les boutons : ils restent au bout de la barre, le doigt les retrouve.
    assert maj.index('class="nom-etape"') < maj.index("data-etape=")
    nom = re.search(r"\n  nomEtape\(i = this\.plan\.etape\) \{(.*?)\n  \}", source, flags=re.S).group(1)
    assert "`${i + 1} · ${nom}`" in nom and "`Étape ${i + 1}`" in nom
    # L'aperçu d'une autre étape se fait à la souris seulement : sous le doigt, il ferait perdre le toucher sur iPad.
    assert source.count('ev.pointerType === "mouse" && this.apercuEtape(') == 2
    assert ".etapes-plan .nom-etape" in lire("css/editeurs.css")


def test_le_tableau_ouvert_sur_l_ipad_et_le_nom_du_heros_au_dessus_de_ses_jauges():
    css = sans_commentaires(lire("css/etroit.css"))
    assert ".cp-liste, .bloc-combat { container-type: inline-size; }" in css
    contenant = re.search(r"@container \(max-width: 560px\) \{(.*?)\n\}", css, flags=re.S).group(1)
    assert ".ligne-heros .qui { grid-column: 1 / -1; }" in contenant
    tableau = re.search(r"@media \(min-width: 1100px\) and \(max-width: 1400px\) \{(.*?)\n\}", css, flags=re.S).group(1)
    assert "body.tableau-ouvert .seances { grid-template-columns: 64px minmax(0, 1fr); }" in tableau
    assert "body.tableau-ouvert .liste-seances header { display: none; }" in tableau
    assert "body.tableau-ouvert .carnet {" in tableau


def test_la_barre_des_editeurs_passe_sur_deux_lignes_a_l_etroit():
    css = sans_commentaires(lire("css/etroit.css"))
    grille = re.search(r"@media \(min-width: 821px\) and \(max-width: 1100px\), \(pointer: coarse\) and \(min-width: 821px\) and \(max-width: 1200px\) \{(.*?)\n\}", css, flags=re.S)
    assert grille and ".editeur { grid-template-rows: auto minmax(0, 1fr); }" in grille.group(1)
    barre = re.search(r"@media \(max-width: 1100px\), \(pointer: coarse\) and \(max-width: 1200px\) \{(.*?)\n\}", css, flags=re.S)
    assert barre, "la barre à l'étroit"
    corps = barre.group(1)
    assert ".barre-carte::after { content: \"\"; order: 1; flex-basis: 100%; height: 0; }" in corps
    assert ".barre-carte > .segments, .barre-carte > .icone-seule, .barre-carte > .menu-exporter { order: 2; }" in corps
    # Au téléphone, l'éditeur défile avec la page : le plan garde une vraie hauteur, le panneau vient dessous.
    tel = re.search(r"@media \(max-width: 640px\) \{(.*?)\n\}", css, flags=re.S).group(1)
    assert "grid-template-rows: auto minmax(340px, 64vh) auto;" in tel
    # La hauteur de barre propre au doigt ne vaut que pour les éditeurs larges : elle écraserait celle du téléphone.
    doigt = sans_commentaires(lire("css/doigt.css"))
    assert re.search(r"@media \(min-width: 821px\) \{\s*\.editeur \{ grid-template-rows: minmax\(56px, auto\) minmax\(0, 1fr\); \}", doigt)


def test_l_en_tete_du_telephone_tient_sur_trois_lignes_sans_defiler():
    css = sans_commentaires(lire("css/entete.css"))
    # Jusqu'à 760 px : l'iPhone plié tourné (678 px) n'a plus de bouton hors de l'écran ; la loupe a sa case.
    tel = next(b for b in re.findall(r"@media \(max-width: 760px\) \{(.*?)\n\}", css, flags=re.S) if "grid-template-areas" in b)
    assert '"marque outils outils outils" "familles familles chercher liens" "onglets onglets onglets onglets"' in tel
    chercher = sans_commentaires(lire("css/chercher.css"))
    assert re.search(r"@media \(max-width: 760px\) \{\s*\.entete-atelier \.chercher-entete, \.entete-atelier \.chercher-entete\[data-taille\] \{ grid-area: chercher;", chercher)
    assert 'matchMedia("(min-width: 761px)")' in lire("js/chercher/chercher.js")
    assert "--haut-entete: calc(var(--haut-ligne1) + var(--haut-ligne2) + var(--haut-ligne3))" in tel
    assert "display: flex" not in tel and "::after" not in tel
    # Le nom de l'atelier s'efface dès 1100 px : le témoin de la TV y garde sa largeur.
    assert re.search(r"@media \(max-width: 1100px\) \{\s*\.entete\.entete-atelier \{ grid-template-columns: auto auto minmax\(0, 1fr\) auto;", css)
    assert "@media (max-width: 1000px) { .temoin-tv { width: 160px; }" in lire("css/tv-atelier.css")


def test_ce_soir_suit_la_seance_en_cours_meme_pendant_un_combat():
    source = lire("js/commun/onglets.js")
    assert 'import { seanceDuJour, seanceEnCours } from "../seances/seance-en-cours.js";' in source
    # Un combat commencé ou fini sur la page : la séance du soir se relit peu après, sans attendre le retour sur l'onglet.
    assert re.search(r'window\.addEventListener\("etat-jeu-change", \(\) => \{\s*clearTimeout\(this\.relectureCombat\);', source)


def test_la_telecommande_ecrit_fait_en_tete_et_l_efface_au_changement_d_onglet():
    page = lire("telecommande.html")
    assert '<p class="annonce-tete" role="status" aria-live="polite" hidden></p>' in page
    source = source_page("telecommande")
    choisir = re.search(r"\nfunction choisirOnglet\(o\) \{(.*?)\n\}", source, flags=re.S).group(1)
    assert "effacerAnnonce(true);" in choisir
    annoncer = re.search(r"\nfunction annoncer\(texte, genre[^)]*\) \{(.*?)\n\}", source, flags=re.S).group(1)
    assert 'const enTete = !relancer && (genre === "fait" || genre === "info" || genre === "attente");' in annoncer
    # Les mots du Mac : « À la TV », « Retirer le carton ».
    assert "À l'écran" not in source and "à l'écran</small>" not in source
    assert ">Retirer le carton</button>" in source
    css = sans_commentaires(lire("css/telecommande.css"))
    assert ".touche.petite { min-height: 44px;" in css
    assert not re.search(r"min-height: (?:[0-3]\d|4[0-3])px", css), "aucune touche de la télécommande sous 44 px"
    assert ".annonce-en-tete .seance-du-jour { display: none; }" in css
