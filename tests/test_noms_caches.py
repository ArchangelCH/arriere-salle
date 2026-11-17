"""Les noms cachés aux joueurs ne sont pas dans le code : masque.py les lit dans data/noms-caches.json, réglé par le MJ. Sans
fichier, rien n'est masqué ; un nom s'y écrit en clair ou par un motif ; le fichier est relu quand il change ; un fichier
faux arrête l'atelier au démarrage et, en cours de route, laisse en place la liste d'avant."""
import json
import logging
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402

from table import masque  # noqa: E402

LANTERNE = "Ils ont bu à la Lanterne d'Ysembrin."
EXEMPLES = ("La Petite Fanfrelée", "Ils ont dormi à la Petite Fanfrelée.", "Le comptoir de la Petite Fanfrelée")


@pytest.fixture()
def poser(tmp_path, monkeypatch):
    """Un autre fichier de noms cachés le temps d'un essai ; ensuite, celui des essais revient."""
    fichier = tmp_path / "noms-caches.json"
    monkeypatch.setattr(masque, "FICHIER_NOMS_CACHES", fichier)

    def ecrire(contenu, relire=True):
        if contenu is None:
            fichier.unlink(missing_ok=True)
        else:
            fichier.write_text(contenu if isinstance(contenu, str) else json.dumps(contenu, ensure_ascii=False), encoding="utf-8")
        if relire:
            masque.recharger()

    yield ecrire
    monkeypatch.undo()
    masque.recharger()
    masque.regler_nom_public("")


def test_les_essais_lisent_le_nom_invente_des_essais():
    assert masque.contient_nom_cache("à la Petite Fanfrelée") and masque.contient_nom_cache("« Jamais ne dort »")
    # Ceux d'un pack superposé suivent (conftest.py).
    assert masque.lettres_cachees()[:2] == ("fanfrel", "jamaisnedort")


def test_sans_fichier_rien_n_est_masque(poser):
    poser(None)
    assert masque.MOTIFS == () and masque.lettres_cachees() == ()
    assert masque.masquer("Ils ont dormi à la Petite Fanfrelée.") == "Ils ont dormi à la Petite Fanfrelée."
    assert not masque.contient_nom_cache("la Petite Fanfrelée") and masque.nom_valide("La Petite Fanfrelée") == "La Petite Fanfrelée"
    # Les exemples de l'onglet Table ne dépendent pas du nom caché.
    assert masque.exemples_du_nom_public() == ["L'auberge", "Ils ont dormi à l'auberge.", "Le comptoir de l'auberge"]


def test_un_nom_ecrit_en_clair(poser):
    poser([{"nom": "la Lanterne d'Ysembrin"}])
    for texte in (LANTERNE, "Ils ont bu à la LANTERNE D’YSEMBRIN.", "Ils ont bu à la Lanterne-d'Ysembrin.",
                  "Ils ont bu à la Lan terne d'Ysem-brin.", "Ils ont bu à la Lanterne​d'Ysémbrin.", "Ils ont bu à la Lanterne d Ysembrin."):
        assert masque.masquer(texte) == "Ils ont bu à l'auberge.", texte
    assert masque.masquer("Le patron de la Lanterne d'Ysembrin, l'auberge de Garin.") == "Le patron de l'auberge de Garin."
    # Un mot du nom seul, ou le nom dans un autre mot, ne le désigne pas.
    for texte in ("Une lanterne pend au mur.", "Ysembrin dort.", "La Lanterne d'Ysembrinette."):
        assert masque.masquer(texte) == texte and not masque.contient_nom_cache(texte), texte
    # Les lettres du nom, par défaut celles du nom sans son article, ne passent pas dans le nom public.
    assert masque.lettres_cachees() == ("lanternedysembrin",)
    with pytest.raises(ValueError):
        masque.nom_valide("La L.a.n.t.e.r.n.e d'Ysembrin")
    assert masque.nom_valide("La Lanterne") == "La Lanterne"


def test_un_motif_ses_lettres_et_son_remplacement(poser):
    poser([{"motif": "(?:\\bvieille{sep})?ysembrin[e]?s?", "lettres": "ysembr", "remplacement": "ermitage"}])
    assert masque.masquer("Ils dorment à la Vieille Ysembrine.") == "Ils dorment à l'ermitage."
    assert masque.masquer("Ils dorment à laYsembrin.") == "Ils dorment à l'ermitage."
    with pytest.raises(ValueError):
        masque.nom_valide("Y-s-e-m-b-r-a")
    poser([{"nom": "la Lanterne d'Ysembrin", "lettres": ""}])
    assert masque.lettres_cachees() == () and masque.nom_valide("Ysembrin") == "Ysembrin"


def test_les_exemples_de_l_onglet_table_sont_ceux_du_masque():
    for public in ("", "le Chaudron", "la Taverne", "l'Étoile du soir", "chez Garin", "Au Bouclier", "Taverne", "les Trois Pots"):
        masque.regler_nom_public(public)
        assert masque.exemples_du_nom_public() == [masque.masquer(t) for t in EXEMPLES], public
    masque.regler_nom_public("")


def test_le_fichier_est_relu_quand_il_change(poser, monkeypatch):
    monkeypatch.setattr(masque, "RELIRE", 0)
    poser([{"nom": "la Lanterne d'Ysembrin"}])
    assert masque.masquer(LANTERNE) == "Ils ont bu à l'auberge."
    poser([{"nom": "la Lanterne d'Ysembrin"}, {"nom": "la Forge Close"}], relire=False)
    assert masque.masquer("Ils ont bu à la Forge Close.") == "Ils ont bu à l'auberge."
    poser(None, relire=False)
    assert masque.masquer(LANTERNE) == LANTERNE


@pytest.mark.parametrize("contenu", ["{pas du json", '{"nom": "la Lanterne"}', [{"motif": "(?:ysembrin"}], [{"nom": "!!!"}],
                                     [{"nom": 3}], [{"lettres": "abc"}], [{"nom": "la Lanterne", "remplacement": ["x"]}], ["la Lanterne"]])
def test_un_fichier_faux_n_efface_pas_la_liste(poser, contenu, caplog):
    poser([{"nom": "la Lanterne d'Ysembrin"}])
    with caplog.at_level(logging.ERROR, logger="atelier"):
        poser(contenu)
    assert "Noms cachés non relus" in caplog.text
    assert masque.masquer(LANTERNE) == "Ils ont bu à l'auberge."
    # Au démarrage, il arrête l'atelier : masquer sans lui laisserait passer le nom.
    with pytest.raises(ValueError):
        masque.recharger(strict=True)
