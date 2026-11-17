"""Le guide du coin (/guide) : une page statique lisible sans compte, puisque la page de connexion y renvoie. Elle ne
porte rien de la campagne ni du serveur, ne sert que des fichiers de la liste blanche, et chaque page du coin y mène."""
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
import main  # noqa: E402
from api import config  # noqa: E402

STATIQUE = Path(joueurs.__file__).resolve().parent / "static"
GUIDE = STATIQUE / "joueurs" / "guide.html"


@pytest.fixture(autouse=True)
def coin_branche(monkeypatch):
    monkeypatch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    monkeypatch.setattr(joueurs, "COOKIE_SUR", False)
    monkeypatch.setattr(joueurs, "HOTES", set())


def test_le_guide_se_lit_sans_compte():
    anonyme = TestClient(joueurs.app)
    r = anonyme.get("/guide")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    assert "<h1>Le guide du coin</h1>" in r.text and 'id="connexion"' in r.text
    assert r.headers.get("cache-control") == "no-cache"
    # La page brute n'est pas servie comme fichier statique : seulement par sa route.
    assert anonyme.get("/static/joueurs/guide.html").status_code == 404


def test_le_guide_ne_charge_que_des_fichiers_servis():
    html = GUIDE.read_text(encoding="utf-8")
    refs = re.findall(r'(?:href|src)="/static/([^"]+)"', html)
    assert refs, "le guide charge au moins ses feuilles"
    anonyme = TestClient(joueurs.app)
    for f in refs:
        assert f in joueurs.FICHIERS, f
        assert anonyme.get(f"/static/{f}").status_code == 200, f
    # Une page statique : pour tout script, celui du menu de la barre du haut ; rien qui parte ailleurs que sur le coin.
    assert re.findall(r'<script[^>]*src="([^"]+)"', html) == ["/static/js/joueurs/menu-coin.js"]
    assert len(re.findall(r"<script", html)) == 1
    assert not re.search(r'(?:href|src)="(?:https?:)?//', html)


def test_le_guide_ne_dit_rien_de_la_campagne_ni_du_serveur():
    html = GUIDE.read_text(encoding="utf-8")
    texte = re.sub(r"<[^>]+>", " ", html)
    # Ni tiret cadratin, ni outil nommé, ni ancien vocabulaire des liens à clé.
    for interdit in ("—", "Claude", "Anthropic", "Ollama", "192.168.", "Nouveau lien",
                     "Ce lien n'est plus valable", "?cle="):
        assert interdit not in html, interdit
    assert not re.search(r"\bIA\b", texte)


def test_chaque_page_du_coin_mene_au_guide():
    for nom in ("carnet.html", "heros.html", "histoire.html", "index.html", "connexion.html"):
        html = (STATIQUE / "joueurs" / nom).read_text(encoding="utf-8")
        assert 'href="/guide"' in html, nom
    assert '"/guide"' in (STATIQUE / "js" / "joueurs" / "menu-coin.js").read_text(encoding="utf-8")
    assert "css/guide-coin.css" in joueurs.FICHIERS


def test_le_guide_ne_prend_que_la_lecture():
    anonyme = TestClient(joueurs.app)
    assert anonyme.post("/guide", json={}).status_code in (403, 405, 415)


def test_le_guide_dit_les_regles_de_bouger_d_aujourd_hui():
    """Le guide suit le coin : la confirmation à partir de LOIN cases (bouger.js), l'eau profonde et la falaise des plans
    extérieurs, que seuls un pont, un ponton, une passerelle ou une barque traversent (deplacement.py)."""
    from commun import deplacement
    texte = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", GUIDE.read_text(encoding="utf-8")))
    loin = int(re.search(r"const LOIN = (\d+);", (STATIQUE / "js" / "joueurs" / "bouger.js").read_text(encoding="utf-8")).group(1))
    assert f"Au-delà de {loin - 1} cases" in texte
    assert "l'eau profonde et la falaise arrêtent votre héros" in texte
    passages = {"pont", "ponton", "passerelle", "barque"}
    assert passages <= set(deplacement.PASSAGES_MEUBLES)
    for mot in passages:
        assert re.search(rf"\b{mot}\b", texte), mot


def test_les_pages_du_coin_versionnent_leurs_fichiers():
    """Cloudflare fait garder un fichier statique quatre heures dans le navigateur : les pages mettent une empreinte dans
    l'adresse de leurs fichiers, que le coin sert un an (immutable) ; l'ancienne adresse sert les fichiers du moment."""
    anonyme = TestClient(joueurs.app)
    html = anonyme.get("/guide").text
    version = joueurs.version_statique()
    assert re.fullmatch(r"[0-9a-f]{10}", version)
    refs = re.findall(r'(?:href|src)="(/static/[^"]+)"', html)
    assert refs and all(r.startswith(f"/static/v-{version}/") for r in refs), refs
    for r in refs:
        reponse = anonyme.get(r)
        assert reponse.status_code == 200 and "immutable" in reponse.headers["cache-control"], r
    # Les anciennes adresses (sans empreinte, ou d'une version passée) servent les fichiers d'aujourd'hui, sans cache durable.
    for r in ("/static/css/carnet.css", "/static/v-0000000000/css/carnet.css"):
        reponse = anonyme.get(r)
        assert reponse.status_code == 200 and "immutable" not in reponse.headers["cache-control"], r
    assert anonyme.get(f"/static/v-{version}/js/atelier.js").status_code == 404
    assert anonyme.get(f"/static/v-{version}/../../joueurs.py").status_code == 404
