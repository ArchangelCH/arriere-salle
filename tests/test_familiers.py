"""Les familiers d'un aventurier (panneau « Familier » du créateur) : typés comme le reste de la fiche, au plus trois, et
jamais montrés à la TV ni au MJ invité (listes blanches de tv_fiches)."""

import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import main  # noqa: E402,F401  (charge les modules de api/ dans leur ordre)
from api import tv_fiches  # noqa: E402
from commun import carnet  # noqa: E402

LUMI = {"nom": "Lumi", "espece": "Élémentaire de lumière", "element": "Lumière", "taille": "35-40 cm",
        "aspect": "Yeux dorés", "humeurs": "Au repos : lueur douce", "caractere": "Curieuse", "lien": "Velora", "regles": "À régler", "image": "/media/abc.jpg"}


def test_les_familiers_sont_gardes_et_bornes():
    propre = carnet.fiche_typee({"nom": "Velora", "familiers": [LUMI]})
    assert propre["familiers"] == [LUMI]
    quatre = carnet.fiche_typee({"familiers": [LUMI] * 5})
    assert len(quatre["familiers"]) == 3
    long = carnet.fiche_typee({"familiers": [{"nom": "x" * 1000, "aspect": "y" * 20000}]})["familiers"][0]
    assert len(long["nom"]) == carnet.COURT and len(long["aspect"]) == carnet.LONG


def test_un_familier_mal_forme_ne_casse_rien():
    assert carnet.fiche_typee({"familiers": "Lumi"})["familiers"] == []
    assert carnet.fiche_typee({"familiers": [None, 3, "x", {"nom": "Lumi", "pirate": "<script>"}]})["familiers"] == [{"nom": "Lumi"}]


def test_les_familiers_ne_sortent_ni_a_la_tv_ni_vers_le_mj_invite():
    heros = {"id": "velora", "nom": "Velora", "joueur": "Yuna", "couleur": "#b3261e", "element": "Lumière", "familiers": [LUMI]}
    assert "familiers" not in tv_fiches.aventurier_public(heros)
    assert "familiers" not in tv_fiches.CHAMPS_HEROS_INVITE
