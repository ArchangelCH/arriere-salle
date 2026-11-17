"""Les billets secrets d'une séance : la feuille à imprimer, servie à l'atelier comme la feuille de combat, et la séance
qui les garde, sans que l'enregistrement d'une séance touche à ses billets ni à la clé de ses scènes."""
import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import joueurs  # noqa: E402
import main  # noqa: E402
from api import application, tv_etat  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def test_la_feuille_des_billets_est_servie_a_l_atelier(client):
    page = client.get("/billets?seance=seance")
    assert page.status_code == 200 and page.headers["cache-control"] == "no-cache"
    texte = re.sub(r"/static/v-[0-9a-f]{10}/", "/static/", page.text)
    assert "/static/js/seances/billets-page.js" in texte and "/static/css/billets.css" in texte
    for chemin in ("/static/js/seances/billets-page.js", "/static/js/seances/billets.js", "/static/css/billets.css",
                   "/static/js/seances/seance-suivante.js", "/static/js/seances/propose.js", "/static/css/billets-suite.css"):
        assert client.get(chemin).status_code == 200, chemin
    assert "/static/css/billets-suite.css" in re.sub(r"/static/v-[0-9a-f]{10}/", "/static/", client.get("/").text)


def test_la_seance_garde_ses_billets_et_sa_suite(client):
    """Les billets, la clé d'une scène et la suite préparée à la clôture passent par l'enregistrement ordinaire de la
    séance, avec sa version : rien de plus côté serveur, rien de moins."""
    s = client.post("/api/seances", json={"nom": "Avec billets", "numero": 90, "deroule": [{"titre": "La porte", "cle": "sc-porte"}],
                                          "billets": [{"id": "b-1", "pour": ["j1"], "texte": "Un murmure.", "scene": "sc-porte", "remis": False}]}).json()
    s["billets"][0]["remis"] = True
    s["suite"] = {"depuis": "seance", "numero": 1, "proposes": {"pnj": {"toma": "croisé en séance 1"}}, "retires": ["pnj:brom"], "date": "2026-11-14"}
    r = client.put(f"/api/seances/{s['id']}", json={**s, "version_base": s["modifie"]})
    assert r.status_code == 200
    relue = client.get(f"/api/seances/{s['id']}").json()
    assert relue["billets"][0]["remis"] is True and relue["deroule"][0]["cle"] == "sc-porte"
    assert relue["suite"]["proposes"]["pnj"] == {"toma": "croisé en séance 1"} and relue["suite"]["retires"] == ["pnj:brom"]
    # La date proposée n'est pas une date : la prochaine séance annoncée aux joueurs ne la voit pas.
    assert "14 novembre" not in tv_etat.prochaine_seance()
    client.delete(f"/api/seances/{s['id']}")


def test_le_coin_des_joueurs_ne_sert_rien_des_billets():
    """Le coin des joueurs ne sert que sa liste de fichiers : ni la feuille des billets, ni leurs scripts."""
    assert not [f for f in joueurs.FICHIERS if "billets" in str(f) or "seance-suivante" in str(f) or "propose" in str(f)]
    with TestClient(joueurs.app) as coin:
        for chemin in ("/billets", "/static/billets.html", "/static/js/seances/billets.js", "/static/js/seances/billets-page.js"):
            assert coin.get(chemin).status_code == 404, chemin
