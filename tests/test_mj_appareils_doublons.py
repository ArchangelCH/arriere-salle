"""Les appareils reconnus d'office à la connexion ne s'accumulent pas : au plus MEME_NOM_MAX du même nom (les plus
récemment vus) ; un appareil nommé à la main, lui, n'est jamais effacé pour ce motif."""

import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import shutil  # noqa: E402

import pytest  # noqa: E402

import main  # noqa: E402,F401
from api import config, portier  # noqa: E402
from mj import comptes_mj, porte_lan  # noqa: E402
from mj.proprietes import PRINCIPAL  # noqa: E402

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"


@pytest.fixture
def propre():
    shutil.rmtree(comptes_mj.dossier(config.DONNEES), ignore_errors=True)
    yield
    shutil.rmtree(comptes_mj.dossier(config.DONNEES), ignore_errors=True)


def test_la_liste_des_appareils_reconnus_d_office_ne_gonfle_pas(propre):
    porte = portier.PORTE_LAN
    for _ in range(porte_lan.MEME_NOM_MAX + 6):
        porte.reconnaitre(PRINCIPAL, "", UA)
    compte = PRINCIPAL
    noms = [a["nom"] for a in porte.liste(compte)]
    assert noms.count("Linux, Chrome") == porte_lan.MEME_NOM_MAX
    assert len(noms) == porte_lan.MEME_NOM_MAX


def test_un_appareil_nomme_a_la_main_reste(propre):
    porte = portier.PORTE_LAN
    compte = PRINCIPAL
    for i in range(porte_lan.MEME_NOM_MAX + 2):
        porte.reconnaitre(compte, "Mon portable", UA)
    for _ in range(porte_lan.MEME_NOM_MAX + 2):
        porte.reconnaitre(compte, "", UA)
    noms = [a["nom"] for a in porte.liste(compte)]
    assert noms.count("Mon portable") == porte_lan.MEME_NOM_MAX + 2
    assert noms.count("Linux, Chrome") == porte_lan.MEME_NOM_MAX
