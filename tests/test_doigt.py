"""Au doigt (iPad, iPhone), un pincement commence toujours par un seul doigt : dans les éditeurs de plans et de cartes, ce
premier contact ne doit ni révéler, ni poser, ni peindre (js/commun/doigt.js). Le geste lui-même s'essaie avec des touchers
simulés dans Chrome ; ici, ce que le code ne doit pas perdre."""

import re
from pathlib import Path
from sources_front import source_page  # noqa: E402

STATIQUE = Path(__file__).resolve().parent.parent / "app" / "static"


def lire(chemin):
    return (STATIQUE / chemin).read_text(encoding="utf-8")


def methode(source, nom):
    debut = source.index(f"\n  {nom}(")
    fin = re.compile(r"\n  \}\n").search(source, debut).end()
    return source[debut:fin]


def test_le_doigt_se_reconnait_et_n_agit_qu_au_pointerup():
    source = lire("js/commun/doigt.js")
    assert not re.search(r"^import ", source, flags=re.M)
    assert 'ev.pointerType === "touch"' in source
    leve = methode(source, "leve")
    assert 'ev.type === "pointerup"' in leve, "un pointercancel (geste repris par le navigateur) ne fait aucune action"
    assert "clearTimeout" in methode(source, "annuler")


def test_au_doigt_les_actions_attendent_le_lever():
    attendus = {
        "plan": ["this.basculerPiece(cx, cy)", "this.poserPions(x, y)", "this.clicPorte(x, y)", "this.poserMeuble(x, y)",
                 "this.creerTexte(x, y)"],
        "carte": ["this.creerLieu(x, y)", "this.clicTrace(x, y)", "this.creerEtiquette(x, y)", "this.placerGroupe(x, y)"],
    }
    for dossier, actions in attendus.items():
        source = lire(f"js/{dossier}/editeur.js")
        assert re.search(r'^import \{ Attente, DELAI, [^}]*auDoigt \} from "\.\./commun/doigt\.js";$', source, flags=re.M), dossier
        bas = methode(source, "pointeurBas")
        for action in actions:
            assert f"this.auLever(ev, () => {action})" in bas, f"{dossier} : {action} part au premier contact"
            assert bas.count(action) == 1, f"{dossier} : {action} appelé ailleurs dans pointeurBas"
        # Les traits au pinceau attendent un court délai ou un petit glissé (le plan en a cinq : sol, brouillard, brume,
        # feu, sang).
        assert bas.count("this.auTrait(ev, ") == {"plan": 5, "carte": 2}[dossier], dossier
        assert "new Attente(ev, commencer, commencer, DELAI)" in methode(source, "auTrait"), dossier
        assert "if (!this.doigt) return action();" in methode(source, "auLever"), f"{dossier} : la souris agit tout de suite"
        # Un deuxième (ou troisième) doigt n'agit jamais : il pince la vue et interrompt le geste du premier. Un objet
        # glissé est défait même au stylet : lâché en route, un pion révélerait la pièce qu'il survole.
        assert "if (this.pointeurs.size > 1) {" in bas, dossier
        assert 'return this.interrompre(this.doigt || this.glisse?.type === "objet");' in bas, dossier
        assert bas.index("this.pointeurs.size > 1") < bas.index("switch (this.outil)"), dossier


def test_un_geste_interrompu_au_doigt_est_defait_sans_rien_enregistrer():
    for dossier in ("plan", "carte"):
        source = lire(f"js/{dossier}/editeur.js")
        interrompre = methode(source, "interrompre")
        assert "this.attente?.annuler();" in interrompre, dossier
        assert "if (!defaire) return this.lacher(g);" in interrompre, f"{dossier} : souris et stylet finissent leur geste"
        # Le plan a aussi les pinceaux de la brume (nappe) et du feu ; « brume » est, dans les deux éditeurs, celui du
        # brouillard.
        traits = r'g\.type === "peinture" \|\| g\.type === "brume" \|\| ' + (r'g\.type === "nappe" \|\| g\.type === "feu" \|\| g\.type === "sang" \|\| ' if dossier == "plan" else "")
        assert re.search(traits + r'\(g\.type === "objet" && g\.bouge\)\) this\.oublierGeste\(g\.debut\)', interrompre), dossier
        oublier = methode(source, "oublierGeste")
        assert "this.passe.pop()" in oublier, dossier
        assert "envoyerTable" not in oublier and "sauver" not in oublier.replace("this.modifie()", ""), dossier
        # Seulement si un enregistrement est parti pendant le geste : le serveur reçoit alors l'état défait.
        assert re.search(r"if \([^)]*\) this\.modifie\(\);", oublier), dossier
        haut = methode(source, "pointeurHaut")
        assert 'if (ev.type === "pointercancel" && this.doigt) return this.interrompre(true);' in haut, dossier
        assert haut.index("a.leve(ev)") < haut.index("const g = this.glisse;"), f"{dossier} : la touche de pinceau finit au lever"
        assert "this.attente?.annuler();" in methode(source, "detruire"), dossier
    # Échap pendant un trait du plan le défait au lieu de laisser un état non enregistré.
    touche = methode(lire("js/plan/editeur.js"), "touche")
    echap = touche[touche.index('ev.key === "Escape"'):]
    assert "this.interrompre(true);" in echap[:200]


def test_la_tv_ne_charge_pas_les_gestes_des_editeurs():
    assert "doigt.js" not in source_page("table")
    for vue in ("js/plan/vue.js", "js/carte/vue.js"):
        assert "doigt.js" not in lire(vue), "la vue est aussi celle de la TV"
