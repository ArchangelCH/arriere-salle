"""Les correctifs de la recette du coin des joueurs : page « introuvable » dans le décor du coin, redirection de
connexion explicite, lectures « ouverte ? » sans erreur 423, gzip sans casser le flux ni les en-têtes de cache, et les
nouveaux fichiers servis (sans rien de l'atelier)."""
import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import joueurs  # noqa: E402
from api import application, config  # noqa: E402
from comptes_coin import entrer as entrer_au_coin  # noqa: E402

HTML = {"Accept": "text/html"}
STATIQUE = Path(__file__).resolve().parent.parent / "app" / "static"


@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture()
def coin(monkeypatch):
    monkeypatch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    monkeypatch.setattr(joueurs, "COOKIE_SUR", False)
    monkeypatch.setattr(joueurs, "HOTES", set())
    with TestClient(joueurs.app) as c:
        yield c


@pytest.fixture()
def joueur(atelier, coin):
    invite = atelier.post("/api/joueurs", json={"nom": "Mira"}).json()
    entrer_au_coin(coin, invite["id"])
    yield coin
    atelier.delete(f"/api/joueurs/{invite['id']}")


def test_introuvable_dans_le_decor_du_coin(coin):
    r = coin.get("/nimporte-quoi", headers=HTML)
    assert r.status_code == 404 and "text/html" in r.headers["content-type"]
    assert "Page introuvable" in r.text and 'href="/carnet"' in r.text and "Detail" not in r.text
    assert "—" not in r.text
    # Une route d'API, un fichier, ou un client sans Accept html gardent le JSON.
    assert coin.get("/api/rien", headers=HTML).json() == {"detail": "Not Found"}
    assert coin.get("/nimporte-quoi").json() == {"detail": "Not Found"}
    assert coin.get("/static/css/inexistant.css", headers=HTML).status_code == 404


def test_page_protegee_sans_session_renvoie_a_la_connexion(coin):
    for chemin in ("/carnet", "/bible", "/table", "/histoire", "/fiche"):
        r = coin.get(chemin, follow_redirects=False)
        assert r.status_code == 303, chemin
        assert r.headers["location"] == f"/connexion?raison=session&suite=%2F{chemin[1:]}", chemin
    assert "session" in (STATIQUE / "js/joueurs/compte.js").read_text(encoding="utf-8")


def test_lectures_ouverte_sans_423(atelier, joueur):
    coin = joueur
    assert coin.get("/api/table/ouverte").json() == {"ouverte": False}
    atelier.put("/api/bible-joueurs", json={"ouverte": False})
    r = coin.get("/api/bible/ouverte")
    assert r.status_code == 200 and r.json() == {"ouverte": False}


def test_lectures_ouverte_exigent_la_session(coin):
    assert coin.get("/api/table/ouverte").status_code == 401
    assert coin.get("/api/bible/ouverte").status_code == 401


def test_gzip_garde_le_cache_immuable_et_epargne_le_flux(coin):
    v = re.search(r"/static/(v-[0-9a-f]{10})/", coin.get("/connexion").text).group(1)
    r = coin.get(f"/static/{v}/css/carnet.css", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers["content-encoding"] == "gzip" and "Accept-Encoding" in r.headers["vary"]
    assert r.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert r.text == (STATIQUE / "css/carnet.css").read_text(encoding="utf-8")
    # Les polices (déjà compressées) et le flux poussé ne passent pas par le gzip.
    f = coin.get(f"/static/{v}/fonts/Cinzel-VF.woff2", headers={"Accept-Encoding": "gzip"})
    assert "content-encoding" not in f.headers
    # Les API restent sans cache.
    assert coin.get("/api/compte", headers={"Accept-Encoding": "gzip"}).headers["cache-control"] == "no-store"


def test_flux_hors_du_gzip():
    # Le flux (SSE) ne passe jamais par la compression : elle retiendrait les évènements. Vérifié sur la règle elle-même.
    assert "/api/flux" in (Path(joueurs.__file__).read_text(encoding="utf-8").split("class GzipSaufFlux")[1].split("app.add_middleware")[0])


def test_nouveaux_fichiers_servis_sans_rien_de_l_atelier(coin):
    for f in ("js/joueurs/onglet-table.js", "css/introuvable-coin.css"):
        assert f in joueurs.FICHIERS and coin.get(f"/static/{f}").status_code == 200, f
    assert (STATIQUE / "joueurs/introuvable.html").is_file()
    texte = (STATIQUE / "joueurs/introuvable.html").read_text(encoding="utf-8") + (STATIQUE / "js/joueurs/onglet-table.js").read_text(encoding="utf-8")
    assert "/api/joueurs" not in texte and "notes_mj" not in texte


def test_navigation_un_seul_nom_par_onglet():
    for page in (STATIQUE / "joueurs").glob("*.html"):
        for long, court in re.findall(r'<span class="long">([^<]*)</span><span class="court">([^<]*)</span>', page.read_text(encoding="utf-8")):
            assert long == court, (page.name, long, court)
