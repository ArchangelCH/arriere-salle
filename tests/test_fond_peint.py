"""Le fond peint des cartes pour la TV : l'atelier le dépose (un PNG vérifié, tiré de la carte publique du moment), la TV
le reçoit par jeton, et il n'est plus servi dès que la carte publique a perdu quelque chose (il le montrerait encore)."""

import base64
import io
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image, PngImagePlugin  # noqa: E402

import main  # noqa: E402
from api import application, portier, tv_cartes  # noqa: E402

CF = {"CF-Connecting-IP": "203.0.113.7"}
J = tv_cartes.jeton
L, H = 12, 8  # cases : 96 × 64 pixels à l'échelle 8


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def b64(octets: bytes) -> str:
    return base64.b64encode(octets).decode()


def image(l=L * 8, h=H * 8, fmt="PNG", texte=None) -> bytes:
    sortie = io.BytesIO()
    im = Image.new("RGB", (l, h), (96, 140, 70))
    if fmt == "PNG":
        info = PngImagePlugin.PngInfo()
        if texte:
            info.add_text("Comment", texte)
        im.save(sortie, "PNG", pnginfo=info)
    else:
        im.save(sortie, fmt)
    return sortie.getvalue()


def lieu(client, nom, connu=True):
    return client.post("/api/lieux", json={"nom": nom, "type": "village", "connu": connu, "secrets": "SECRET-DU-LIEU"}).json()["id"]


def creer_carte(client, nom, marqueurs=(), traces=()):
    carte = {"nom": nom, "largeur": L, "hauteur": H, "km_case": 1, "style": "peint", "terrain": b64(bytes([1]) * (L * H)),
             "brouillard": b64(bytes(L * H)), "marqueurs": list(marqueurs), "traces": list(traces), "notes": "NOTE-DU-MJ"}
    return client.post("/api/cartes", json=carte).json()["id"]


def modifier_carte(client, ident, changer):
    carte = client.get(f"/api/cartes/{ident}").json()
    changer(carte)
    r = client.put(f"/api/cartes/{ident}", json={**carte, "version_base": carte["modifie"]})
    assert r.status_code == 200


def deposer(client, ident, contenu, version=None, echelle=8, entetes=None):
    if version is None:
        version = client.get(f"/api/cartes/{ident}/publique").json()["modifie"]
    return client.put(f"/api/cartes/{ident}/fond", params={"version": version, "echelle": echelle}, content=contenu,
                      headers={"Content-Type": "image/png", **(entetes or {})})


def annonce(client, ident):
    return client.get(f"/api/table/carte/{J('cartes', ident)}").json().get("fond_peint")


def test_le_fond_depose_est_annonce_par_jeton_et_nettoye(client):
    village = lieu(client, "Village du fond")
    ident = creer_carte(client, "Fond annonce", marqueurs=[{"id": "m1", "lieu": village, "x": 4, "y": 4}],
                        traces=[{"id": "t1", "type": "route", "points": [[0, 0], [6, 6]]}])
    assert deposer(client, ident, image(texte="METADONNEE-CACHEE")).status_code == 200
    j = J("cartes", ident)
    a = annonce(client, ident)
    assert a["echelle"] == 8 and a["url"].startswith(f"/api/table/carte/{j}/fond?v=")
    assert ident not in a["url"] and village not in a["url"]
    assert a["nouveaux"] == {"traces": [], "marqueurs": [], "habillage": {}}
    # L'atelier lit la même sortie que la TV.
    assert client.get(f"/api/cartes/{ident}/publique").json() == client.get(f"/api/table/carte/{j}").json()
    client.put("/api/table", json={"vue": "carte", "carte": ident})  # la table publique ne lit que la carte montrée
    r = client.get(a["url"], headers=CF)
    client.put("/api/table", json={"vue": "accueil"})
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert "gzip" not in r.headers.get("content-encoding", "")
    assert b"METADONNEE-CACHEE" not in r.content
    with Image.open(io.BytesIO(r.content)) as im:
        assert im.format == "PNG" and im.size == (L * 8, H * 8)
    # Rien de la fiche ni de la carte n'est écrit dans ce qui part vers la TV.
    texte = client.get(f"/api/table/carte/{j}").text
    assert "SECRET-DU-LIEU" not in texte and "NOTE-DU-MJ" not in texte


def test_un_fond_mal_forme_est_refuse(client):
    ident = creer_carte(client, "Fond refuse")
    assert deposer(client, ident, image(fmt="JPEG")).status_code == 415
    assert deposer(client, ident, b"pas une image").status_code == 415
    assert deposer(client, ident, image(l=L * 8 + 1)).status_code == 400
    assert deposer(client, ident, image(), echelle=1).status_code == 400
    assert deposer(client, ident, image(l=L * 40, h=H * 40), echelle=40).status_code == 400
    assert deposer(client, ident, image(), version="une-autre-version").status_code == 409
    assert client.put("/api/cartes/carte-inconnue/fond", params={"version": "x", "echelle": 8}, content=image()).status_code == 404
    assert annonce(client, ident) is None
    assert client.get(f"/api/table/carte/{J('cartes', ident)}/fond").status_code == 404


def test_par_cloudflare_on_lit_le_fond_mais_on_ne_le_depose_pas(client, monkeypatch):
    ident = creer_carte(client, "Fond public")
    assert deposer(client, ident, image(), entetes=CF).status_code == 404
    assert client.get(f"/api/cartes/{ident}/publique", headers=CF).status_code == 404
    assert annonce(client, ident) is None
    assert deposer(client, ident, image()).status_code == 200
    url = annonce(client, ident)["url"]
    # Le fond se lit tant que la TV montre la carte, pas avant (lectures_publiques.py).
    assert client.get(url, headers=CF).status_code == 404
    client.put("/api/table", json={"vue": "carte", "carte": ident})
    assert client.get(url, headers=CF).status_code == 200
    monkeypatch.setattr(portier, "TABLE_PUBLIQUE", {"table.example.ch"})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {"table.example.ch"})
    hote = {"Host": "table.example.ch"}
    assert client.get(url, headers=hote).status_code == 200
    assert deposer(client, ident, image(), entetes=hote).status_code == 404
    assert client.get(f"/api/cartes/{ident}/publique", headers=hote).status_code == 404
    client.put("/api/table", json={"vue": "accueil"})


def test_le_fond_ne_s_ouvre_que_par_son_jeton(client):
    ident = creer_carte(client, "Fond jeton")
    assert deposer(client, ident, image()).status_code == 200
    assert client.get(f"/api/table/carte/{ident}/fond").status_code == 404
    assert client.get(f"/api/table/carte/{'0' * 20}/fond").status_code == 404
    assert client.get(f"/api/table/carte/{J('plans', ident)}/fond").status_code == 404


def test_un_ajout_garde_le_fond_et_annonce_la_nouveaute(client):
    village = lieu(client, "Village ancien")
    nouveau = lieu(client, "Village nouveau", connu=False)
    ident = creer_carte(client, "Fond ajout", marqueurs=[{"id": "m1", "lieu": village, "x": 3, "y": 3}, {"id": "m2", "lieu": nouveau, "x": 8, "y": 5}])
    assert deposer(client, ident, image()).status_code == 200
    # Un lieu révélé en séance : le fond reste servi, la TV ne repeint que sa zone.
    assert client.patch(f"/api/lieux/{nouveau}", json={"connu": True}).status_code == 200
    a = annonce(client, ident)
    assert a is not None and a["nouveaux"]["marqueurs"] == [1] and a["nouveaux"]["traces"] == []
    assert client.get(a["url"]).status_code == 200
    modifier_carte(client, ident, lambda c: c["traces"].append({"id": "t9", "type": "chemin", "points": [[1, 1], [2, 6]]}))
    a = annonce(client, ident)
    assert a["nouveaux"]["traces"] == [0] and a["nouveaux"]["marqueurs"] == [1]


@pytest.mark.parametrize("cacher", ["lieu", "marqueur", "trace", "terrain", "brouillard"])
def test_ce_qui_disparait_retire_le_fond(client, cacher):
    village = lieu(client, f"Village {cacher}")
    ident = creer_carte(client, f"Fond {cacher}", marqueurs=[{"id": "m1", "lieu": village, "x": 4, "y": 4}],
                        traces=[{"id": "t1", "type": "route", "points": [[0, 0], [6, 6]]}])
    assert deposer(client, ident, image()).status_code == 200
    assert annonce(client, ident) is not None
    if cacher == "lieu":
        client.patch(f"/api/lieux/{village}", json={"connu": False})
    elif cacher == "marqueur":
        modifier_carte(client, ident, lambda c: c["marqueurs"][0].update(cache=True))
    elif cacher == "trace":
        modifier_carte(client, ident, lambda c: c["traces"][0].update(cache=True))
    elif cacher == "terrain":
        modifier_carte(client, ident, lambda c: c.update(terrain=b64(bytes([3]) * (L * H))))
    else:
        # Le brouillard repris sur le lieu : il quitte la carte publique.
        modifier_carte(client, ident, lambda c: c.update(brouillard_actif=True))
    assert annonce(client, ident) is None
    assert client.get(f"/api/table/carte/{J('cartes', ident)}/fond", headers=CF).status_code == 404


def test_la_garde_publique_laisse_lire_le_fond_seulement():
    assert portier.CHEMINS_TABLE.match("/api/table/carte/0123456789abcdef0123/fond")
    assert not portier.CHEMINS_TABLE.match("/api/cartes/une-carte/fond")
    assert not portier.CHEMINS_TABLE.match("/api/cartes/une-carte/publique")
