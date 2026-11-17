"""La TV du salon (LG webOS 6, navigateur Chromium 79) : ce que ses feuilles de style et son script ne doivent pas employer,
et les fichiers auxquels renvoient les pages et les feuilles de style."""

import re
from pathlib import Path
from sources_front import source_page  # noqa: E402

STATIQUE = Path(__file__).resolve().parent.parent / "app" / "static"


def sans_commentaires(css: str) -> str:
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def test_les_feuilles_de_la_tv_restent_lisibles_par_chromium_79():
    for nom in ("table.css", "affiches.css"):
        css = sans_commentaires((STATIQUE / "css" / nom).read_text(encoding="utf-8"))
        assert not re.search(r"(^|[;{\s])inset\s*:", css), f"{nom} : inset, à écrire en top/right/bottom/left"
        assert ":has(" not in css, f"{nom} : :has(), à remplacer par une classe posée par table.js"
        # aspect-ratio : permis depuis que la table ne se lance plus sur la LG (écran de PC, de tablette ou de téléphone).
        for regle in re.findall(r"\{([^{}]*)\}", css):
            if re.search(r"display\s*:\s*(inline-)?flex", regle):
                assert not re.search(r"(^|[;\s])(row-|column-)?gap\s*:", regle), f"{nom} : gap dans une flexbox : {regle.strip()[:80]}"


def test_le_script_de_la_tv_n_attend_pas_au_premier_niveau():
    source = source_page("table")
    assert not re.search(r"^(await|for await)\b", source, flags=re.M), "await au premier niveau : Chromium 79 ne le connaît pas"
    assert 'import "./ecran-tv/compat-tv.js";' in source


def test_les_fichiers_cites_existent():
    for css in (STATIQUE / "css").glob("*.css"):
        for url in re.findall(r"url\(\"?([^\")]+)\"?\)", sans_commentaires(css.read_text(encoding="utf-8"))):
            if url.startswith("data:"):
                continue
            assert (css.parent / url).resolve().is_file(), f"{css.name} : {url} introuvable"
    for page in STATIQUE.glob("*.html"):
        for url in re.findall(r"(?:href|src)=\"(/static/[^\"]+)\"", page.read_text(encoding="utf-8")):
            if url.startswith("/static/tv/"):
                continue  # construit avec l'image (Dockerfile)
            assert (STATIQUE / url.removeprefix("/static/")).is_file(), f"{page.name} : {url} introuvable"


def test_les_prenoms_en_grand_restent_sur_la_tv():
    """Prénoms et numéros lisibles depuis le canapé, anneau épais, légende des héros collés : la TV seule les demande,
    l'éditeur garde son rendu (y compris sa vue joueurs)."""
    table = source_page("table")
    assert re.search(r"new VuePlan\([^)]*\btv: true", table)
    assert 'class="legende-heros"' in (STATIQUE / "table.html").read_text(encoding="utf-8")
    editeur = (STATIQUE / "js" / "plan" / "editeur.js").read_text(encoding="utf-8")
    assert not re.search(r"new VuePlan\([^)]*\btv:", editeur)


def test_le_fondu_d_une_piece_part_apres_le_repeint():
    """Une pièce révélée : le repeint du plan peut figer la TV une demi-seconde. Le chrono du fondu ne part donc pas de
    fondu(), appelé avant ce calcul, mais d'une image dessinée après lui ; sinon le fondu est fini avant d'être vu."""
    vue = (STATIQUE / "js" / "plan" / "vue.js").read_text(encoding="utf-8")
    fondu = re.search(r"\n  fondu\(\) \{\n(.*?)\n  \}\n", vue, flags=re.S).group(1)
    assert "t0: null" in fondu and "performance.now()" not in fondu
    dessiner = re.search(r"\n  dessiner\(\) \{\n(.*?)\n  \}\n", vue, flags=re.S).group(1)
    assert re.search(r"requestAnimationFrame\(\(\) => \{[^}]*\.t0 = performance\.now\(\)", dessiner)


def test_le_carton_d_un_pnj_tient_sous_le_bandeau_du_combat():
    """Le bandeau du combat pousse le carton d'un PNJ vers le bas : le carton se fait plus étroit (son portrait 3/4 avec
    lui) et ne dépasse jamais le bas de l'écran, avec ou sans bandeau (en dernier recours, le portrait se resserre)."""
    css = sans_commentaires((STATIQUE / "css" / "table.css").read_text(encoding="utf-8"))
    regles = {sel.strip(): corps for sel, corps in re.findall(r"([^{}]+)\{([^{}]*)\}", css)}
    carton, portrait = regles[".carton-pnj"], regles[".carton-pnj .portrait"]
    assert re.search(r"display:\s*flex", carton) and re.search(r"flex-direction:\s*column", carton)
    assert re.search(r"max-height:\s*\d+vh", carton)
    assert re.search(r"flex:\s*0 1 auto", portrait) and "padding-top" not in portrait
    assert re.search(r"height:\s*min\(40vw - 5px, 688px\)", portrait), "portrait 3/4 d'un carton de min(30vw, 520px)"
    combat = regles["body.avec-combat .carton-pnj"]
    assert re.search(r"max-height:\s*calc\(\d+vh - var\(--bandeau, 0px\)\)", combat)
    largeur = re.search(r"width:\s*min\(30vw, 520px, \((\d+)vh - var\(--bandeau, 0px\)\) \* \.75\)", combat)
    hauteur = re.search(r"height:\s*min\(40vw - 5px, 688px, (\d+)vh - var\(--bandeau, 0px\) - 5px\)", regles["body.avec-combat .carton-pnj .portrait"])
    assert largeur and hauteur and largeur.group(1) == hauteur.group(1), "la largeur et le portrait doivent suivre la même borne"


def test_la_molette_et_le_pave_restent_aux_editeurs():
    """Pincer le pavé suit les doigts, glisser à deux doigts déplace la vue (réglage « Pavé tactile / Souris ») : les deux
    éditeurs passent par molette() de carte/vue.js ; la TV n'écoute pas la molette et n'importe rien de ce réglage."""
    table = source_page("table")
    assert '"wheel"' not in table
    assert not re.search(r"\b(molette|gesteMolette|lireDefilement|garderDefilement|premierGlisser)\b", table)
    vue = (STATIQUE / "js" / "carte" / "vue.js").read_text(encoding="utf-8")
    assert "const PINCE = 0.01;" in vue, "Chrome : deltaY = -100 × ln(échelle) au pincement"
    for dossier in ("carte", "plan"):
        editeur = (STATIQUE / "js" / dossier / "editeur.js").read_text(encoding="utf-8")
        assert "molette(this.vue, ev, this.defilement)" in editeur, dossier
        assert "0.0016" not in editeur, f"{dossier} : le zoom à la molette vit dans carte/vue.js"
        assert 'data-defilement="pave"' in editeur and 'data-defilement="souris"' in editeur, dossier
    # Avec ces deux icônes, la barre des éditeurs déborde (« Accueil » hors de l'écran) de 821 à 1185 px environ.
    atelier = sans_commentaires((STATIQUE / "css" / "atelier.css").read_text(encoding="utf-8"))
    cache = re.search(r"\(min-width: 821px\) and \(max-width: (\d+)px\) \{ \.barre-carte \.defilement \{ display: none; \} \}", atelier)
    assert cache and int(cache.group(1)) >= 1190, "les icônes Pavé / Souris restent cachées tant que la barre n'a pas la place"


def test_la_brume_a_son_calque_sans_repeindre_le_plan():
    """La brume dérive sur son propre calque, posé juste sur le plan et sous le pointeur, à 20 images par seconde au plus :
    la changer ne repeint pas le plan de la TV (elle n'entre pas dans la signature de sa structure), et ce calque ne
    prend aucun geste, ni sur la TV ni dans l'éditeur (où il ne se crée qu'au premier plan qui a de la brume)."""
    vue = (STATIQUE / "js" / "plan" / "vue.js").read_text(encoding="utf-8")
    signature = re.search(r"export function signatureStructure\(p\) \{\n(.*?)\n\}", vue, flags=re.S).group(1)
    assert "brume" not in signature
    html = (STATIQUE / "table.html").read_text(encoding="utf-8")
    # Le calque du feu (test_feu.py) vient juste après celui de la brume.
    assert re.search(r'<canvas id="plan"[^>]*></canvas>\s*<canvas class="brume-plan"[^>]*></canvas>\s*<canvas class="feu-plan"[^>]*></canvas>\s*<div class="pointeur-tv"', html)
    table = source_page("table")
    assert re.search(r"new VuePlan\(.*\bbrume: \(\) => toileBrume\b", table) and "vuePlan.majBrume(" in table
    css = sans_commentaires((STATIQUE / "css" / "table.css").read_text(encoding="utf-8"))
    assert "#plan.visible + .brume-plan" in css and re.search(r"\.brume-plan \{[^}]*pointer-events: none", css)
    atelier = sans_commentaires((STATIQUE / "css" / "atelier.css").read_text(encoding="utf-8"))
    assert re.search(r"\.scene canvas\.brume-plan \{[^}]*pointer-events: none", atelier)
    editeur = (STATIQUE / "js" / "plan" / "editeur.js").read_text(encoding="utf-8")
    assert 'c.className = "brume-plan";' in editeur and "this.canvas.after(c);" in editeur
    brume = (STATIQUE / "js" / "plan" / "brume.js").read_text(encoding="utf-8")
    rythmes = [int(n) for n in re.findall(r"\bimages: (\d+)", brume)]
    assert len(rythmes) == 2 and max(rythmes) <= 20
