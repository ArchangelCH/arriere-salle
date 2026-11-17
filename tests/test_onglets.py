"""La barre des onglets de l'atelier en trois familles (js/commun/onglets.js) : Préparer, La compagnie et Jouer sur la première
ligne de l'en-tête, les onglets de la famille ouverte sur la seconde, à la même place d'une page à l'autre ; Jouer s'y
ajoute le jour d'une séance. La disposition elle-même se vérifie avec node outils/verifier_onglets.mjs."""

import re
from pathlib import Path
from sources_front import source_page  # noqa: E402

APP = Path(__file__).resolve().parent.parent / "app"
STATIQUE = APP / "static"


def lire(chemin):
    return (STATIQUE / chemin).read_text(encoding="utf-8")


def sans_commentaires(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


JS_ROOT = Path(__file__).resolve().parent.parent / "app" / "static" / "js"


def test_chaque_changement_d_onglet_range_la_barre():
    source = source_page("atelier")
    assert re.search(r'^import \{ BarreOnglets \} from "\.\./commun/onglets\.js";$', source, flags=re.M)
    # Créée avant le premier router() : onglet() s'en sert dès la première page ; elle lit les séances par la route.
    # (Elle vit dans atelier/etat.js, que atelier.js charge avant d'appeler router().)
    entree = (JS_ROOT / "atelier.js").read_text(encoding="utf-8")
    assert "new BarreOnglets(" in (JS_ROOT / "atelier" / "etat.js").read_text(encoding="utf-8")
    assert entree.index('import "./atelier/etat.js";') < entree.index("  router();")
    assert 'new BarreOnglets(document.querySelector(".entete"), { lireSeances: () => api.get("/api/seances") })' in source
    onglet = re.search(r"\nfunction onglet\(nom\) \{(.*?)\n\}", source, flags=re.S).group(1)
    assert onglet.index('setAttribute("aria-current"') < onglet.index("barreOnglets.ranger()"), "l'onglet ouvert d'abord marqué"


def test_trois_familles_et_quinze_onglets_dans_la_page():
    page = lire("index.html")
    assert re.findall(r'<button type="button" class="famille" data-famille="(\w+)"', page) == ["preparer", "compagnie", "jouer"]
    for nom in (">Préparer<", ">La compagnie<", ">Jouer<"):
        assert nom in page, nom
    onglets = re.findall(r'<a href="#/(\w+)" data-onglet="(\w+)">', page)
    assert all(a == b for a, b in onglets)
    assert [a for a, _ in onglets] == ["scenarios", "cartes", "lieux", "pnj", "idees", "bible", "documents", "aventuriers", "auberge",
                                       "boutiques", "sanctuaire", "seances", "combats", "table", "regles"]
    # Les petits liens, les familles, les onglets et les outils dans le même en-tête ; d remplit le témoin de la TV.
    entete = page.split('<header class="entete entete-atelier">')[1].split("</header>")[0]
    for morceau in ('class="marque"', 'class="liens-atelier" hidden', 'class="familles"', 'class="onglets" id="onglets"',
                    'class="outils-entete"', 'class="temoin-tv" hidden', 'class="ouvrir-tableau"', 'class="noter-journal"', 'class="noter-idee"'):
        assert morceau in entete, morceau
    assert entete.index('class="temoin-tv"') < entete.index('class="ouvrir-tableau"')


def test_plus_de_bouton_plus_ni_de_barre_qui_se_reordonne():
    css = sans_commentaires(lire("css/atelier.css"))
    for ancien in (".onglets-plus", ".onglets-caches", ".onglets.serree"):
        assert ancien not in css, ancien
    # `.onglets a` pose display: flex, qui l'emporterait sur l'attribut hidden des onglets des familles fermées.
    assert re.search(r"\.onglets a\[hidden\][^{]*\{\s*display:\s*none", css)
    source = lire("js/commun/onglets.js")
    assert "onglets-plus" not in source and "choisirOnglets" not in source
    assert ".onglets-soir[hidden]" in lire("css/entete.css")


def test_la_hauteur_de_l_en_tete_vit_dans_une_variable():
    # Deux lignes dans l'atelier, une au coin des joueurs : aucune page ne compte plus sur 52 px écrits en dur.
    for chemin in sorted((STATIQUE / "css").glob("*.css")):
        css = sans_commentaires(chemin.read_text(encoding="utf-8"))
        for dur in ("100vh - 52px", "100dvh - 52px", "top: 52px", "top: 58px", "scroll-margin-top: 52px", "100vh - 70px"):
            assert dur not in css, f"{chemin.name} : {dur}"
    atelier = lire("css/atelier.css")
    assert re.search(r":root \{[^}]*--haut-entete: 52px;", atelier)
    assert "height: var(--haut-entete);" in atelier and ".tableau-mj {\n  position: fixed;\n  top: var(--haut-entete);" in atelier
    assert re.search(r"\.atelier \{[^}]*--haut-entete: calc\(var\(--haut-ligne1\) \+ var\(--haut-ligne2\)\)", lire("css/entete.css"))
    assert '<body class="atelier">' in lire("index.html")
    assert 'href="/static/css/entete.css"' in lire("index.html")
    for page in ("joueurs/index.html", "joueurs/sans-lien.html"):
        assert 'class="atelier"' not in lire(page) and "entete.css" not in lire(page), page


def test_la_barre_rangee_n_observe_pas_ce_qu_elle_change():
    source = lire("js/commun/onglets.js")
    assert "new ResizeObserver" in source
    assert not re.search(r"observe\(\s*this\.nav\b", source), "observer la ligne que l'on range ferait une boucle"
    # Seulement les liens déjà dans la page ; node outils/verifier_onglets.mjs le charge : sa seule importation est la
    # règle de la séance en cours, faite de fonctions pures.
    assert "innerHTML" not in source
    assert re.findall(r"^import .*$", source, flags=re.M) == ['import { seanceDuJour, seanceEnCours } from "../seances/seance-en-cours.js";']


def test_les_touches_de_la_barre_ne_vont_pas_aux_editeurs():
    source = lire("js/commun/onglets.js")
    # Flèches entre les familles et les onglets : arrêtées là, sinon le pion choisi d'un plan bouge et s'enregistre.
    for methode in ("toucheFamille", "toucheOnglets"):
        corps = re.search(rf"\n  {methode}\(ev\) \{{(.*?)\n  \}}", source, flags=re.S).group(1)
        assert "ev.stopPropagation()" in corps, methode
    famille = re.search(r"\n  toucheFamille\(ev\) \{(.*?)\n  \}", source, flags=re.S).group(1)
    # Entrée et Espace sur un mot : sinon la carte finit son tracé en cours, et Espace (la main) annule le clic.
    assert '"Enter"' in famille and '" "' in famille
    for editeur in ("js/plan/editeur.js", "js/carte/editeur.js"):
        assert 'window.addEventListener("keydown", this.clavier);' in lire(editeur), editeur


def test_une_famille_montree_d_un_clic_se_referme_comme_un_menu():
    source = lire("js/commun/onglets.js")
    assert "ouvert() {\n    return !!this.choisie;" in source
    assert re.search(r'document\.addEventListener\("pointerdown", \(ev\) => \{\s*if \(this\.choisie && !this\.entete\.contains', source)
    # La page suivante ouvre sa propre famille.
    assert 'window.addEventListener("hashchange", () => { this.choisie = null; });' in source
    # Échap la referme : elle est la première couche de echap.js.
    touches = lire("js/commun/touches.js")
    assert 'coucheEchap({ nom: "familles", ouvert: () => barre.ouvert(), fermer: (auClavier) => barre.fermer(auClavier) })' in touches


def test_jouer_s_ouvre_le_jour_d_une_seance():
    source = lire("js/commun/onglets.js")
    # « Jouer · ce soir » suit la même règle que le reste de l'atelier (seance-en-cours.js), pas la seule date.
    soir = re.search(r"\nexport function seanceDuSoir\(seances, jour = undefined\) \{(.*?)\n\}", source, flags=re.S).group(1)
    assert "seanceEnCours(" in soir and "seanceDuJour(s, jour)" in soir
    assert "estAujourdhui" not in source
    assert 'window.addEventListener("seances-modifiees"' in source and 'window.addEventListener("focus"' in source
    assert "ce soir" in source and "Ce soir" in source


def test_ni_la_tv_ni_le_coin_des_joueurs_ne_chargent_la_barre():
    assert "onglets" not in source_page("table")
    assert "onglets" not in lire("table.html") and "entete.css" not in lire("table.html")
    assert "onglets.js" not in (APP / "joueurs.py").read_text(encoding="utf-8")
    assert "onglets.js" not in lire("js/joueurs/joueur.js")
