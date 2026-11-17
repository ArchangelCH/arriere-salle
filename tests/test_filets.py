"""Les derniers filets du second passage : plus aucune fenêtre grise du navigateur, ni dans l'atelier ni au coin des
joueurs (le dialogue maison, dialogue.js), le coin qui sert tout ce que ses modules chargent, une seule question pour le
carton d'un PNJ secret, et le même témoin d'enregistrement sur chaque page qui s'enregistre à la frappe."""

import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import joueurs  # noqa: E402
from sources_front import source_page  # noqa: E402

STATIQUE = Path(__file__).resolve().parent.parent / "app" / "static"
JS = STATIQUE / "js"
FENETRE_GRISE = re.compile(r"(?<![\w.])(?:window\.)?(confirm|prompt|alert)\(")


def lire(chemin):
    return (STATIQUE / chemin).read_text(encoding="utf-8")


def sans_commentaires(source):
    return re.sub(r"(?m)^\s*//.*$|\s//[^\"'`\n]*$", "", source)


def test_plus_aucune_fenetre_grise_dans_l_atelier():
    """confirm(), prompt() et alert() sortent de l'ambiance et se valident par Entrée sans être lus : l'atelier pose ses
    questions par le dialogue maison (dialogue.js), au parchemin ; le créateur et les illustrations aussi, servis au coin
    des joueurs, et l'échoppe du carnet par sa propre feuille."""
    restes = []
    for f in JS.rglob("*.js"):
        chemin = f.relative_to(STATIQUE).as_posix()
        if f.parent.name == "tv":
            continue
        for n, ligne in enumerate(sans_commentaires(f.read_text(encoding="utf-8")).splitlines(), 1):
            if FENETRE_GRISE.search(ligne):
                restes.append(f"{chemin}:{n}")
    assert not restes, restes


def test_le_coin_des_joueurs_ne_charge_que_ce_qu_il_sert():
    """Le coin des joueurs ne sert que sa liste blanche : un module qu'il charge n'importe jamais un module hors de cette
    liste, sinon le créateur du joueur ne se chargerait plus. Le dialogue maison et le témoin d'enregistrement y sont,
    avec leur feuille (filets.css, liée par la page du créateur) et son parchemin."""
    importe = re.compile(r"""(?m)^\s*import\s+(?:[^"';]*?\s+from\s+)?["'](\.{1,2}/[^"']+)["']""")
    for chemin in sorted(f for f in joueurs.FICHIERS if f.endswith(".js")):
        dossier = (STATIQUE / chemin).parent
        for cible in importe.findall(lire(chemin)):
            servi = (dossier / cible).resolve().relative_to(STATIQUE.resolve()).as_posix()
            assert servi in joueurs.FICHIERS, f"{chemin} importe {servi}, que le coin des joueurs ne sert pas"
    assert {"js/commun/dialogue.js", "js/commun/temoin-enregistrement.js", "css/filets.css", "img/carte-parchemin.jpg"} <= joueurs.FICHIERS
    assert '<link rel="stylesheet" href="/static/css/filets.css">' in lire("joueurs/index.html")


def test_le_carton_d_un_pnj_secret_ne_pose_qu_une_question():
    """Un PNJ secret dont le carton nomme aussi un inconnu : la question du carton le dit, et il ne devient connu qu'après
    son « oui » (avant, il restait connu même si l'on répondait ensuite « Ne pas montrer »)."""
    chemins = {
        "js/pnj/carnet.js": ("  async table(montrer) {", "\n  }\n"),
        "js/seances/seances.js": ('if (a === "pnj-montrer") {', "return this.majBoutonsTable();"),
        "js/auberge/auberge.js": ("  async montrerPnj(id) {", "\n  }\n"),
        "js/tableau/impro.js": ("  async montrerCarton(p) {", "\n  }\n"),
        "js/plan/editeur.js": ("  async cartonPion(t, montrer) {", "this.fileTable = this.fileTable.then"),
    }
    for chemin, (debut, fin) in chemins.items():
        source = lire(chemin)
        i = source.index(debut)
        corps = source[i:source.index(fin, i)]
        appel = re.search(r"cartonVerifie\([^;]*?secret:", corps)
        assert appel, f"{chemin} : la question du carton ne sait pas que le PNJ est secret"
        devenu = [m.start() for m in re.finditer(r"connu = true|connu: true", corps)]
        assert devenu and all(j > appel.start() for j in devenu), f"{chemin} : le PNJ devient connu avant la question"
        assert "confirm(" not in corps, chemin
    tc = source_page("telecommande")
    pnj = tc[tc.index("function basculerPnj("):tc.index("function sceneSuivante(")]
    assert "secret" in pnj and "Le rendre connu et montrer" in pnj and "confirm(" not in pnj


def test_le_temoin_d_enregistrement_est_le_meme_partout():
    """« Enregistré à 21 h 43 », à droite du titre, avec les mêmes mots (temoin-enregistrement.js) : plus de témoin propre
    à une page, et le sanctuaire comme les rencontres, qui s'enregistrent à la frappe, ont le leur."""
    for chemin in ("js/scenarios/scenarios.js", "js/pnj/carnet.js", "js/boutiques/boutiques.js", "js/auberge/auberge.js",
                   "js/seances/seances.js", "js/sanctuaire/sanctuaire.js", "js/carte/editeur.js", "js/plan/editeur.js",
                   "js/combats/balance.js", "js/aventuriers/createur.js", "js/lieux/fiche-lieu.js"):
        source = lire(chemin)
        assert "temoin-enregistrement.js" in source and "htmlTemoin(" in source and "afficherTemoin(" in source, chemin
        assert "etat-sauvegarde" not in source and 'class="etat-fiche"' not in source, chemin
    temoin = lire("js/commun/temoin-enregistrement.js")
    assert "Hors ligne" in temoin and "Envoi…" in temoin and "\\u00a0h\\u00a0" in temoin
    # Le compte à rebours d'un nouvel essai n'est jamais caché par un message.
    assert ".temoin-enregistrement" in lire("js/api.js").split("const HAUT_DE_L_ECRAN")[1].split(";")[0]


def test_l_entree_repetee_ne_repond_pas_aux_autres_questions():
    """La TV noire, le carton d'un PNJ et les repos donnent la main à un bouton : l'Entrée qui a ouvert la question,
    restée appuyée ou répétée, n'y répond pas, comme dans le dialogue maison (garderLaLecture, à chaque ouverture)."""
    assert "export function garderLaLecture(d)" in lire("js/commun/dialogue.js")
    for chemin in ("js/ecran-tv/tv-noire.js", "js/pnj/carton-pnj.js", "js/seances/compagnie.js"):
        source = lire(chemin)
        i = source.index("garderLaLecture(d);")
        assert source.index("showModal()", i) - i < 80, chemin


def test_le_sanctuaire_rattrape_une_coupure_comme_les_fiches():
    """Pendant une coupure, le sanctuaire dit « Hors ligne » avec son compte à rebours et renvoie seul ce qui n'est pas
    parti (Reessai), au lieu d'attendre la frappe suivante."""
    source = lire("js/sanctuaire/sanctuaire.js")
    assert 'import { Reessai } from "../commun/reessai.js";' in source
    corps = source[source.index("  enregistrer() {"):source.index("  async apresRoute(")]
    assert "this.reessai.reussite();" in corps and "this.reessai.echec(err);" in corps and "this.reessai.signaler(err" in corps
    assert "reessai: this.reessai" in source
