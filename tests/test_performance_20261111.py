"""Chargement : fichiers versionnés gardés un an, images légères, listes en cache avec ETag, relevé de la télécommande."""

import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

import main  # noqa: E402
from api import application, config, medias_legers, portier, statiques_versionnes  # noqa: E402
from table import telecommande, vignettes  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def prefixe(client) -> str:
    page = client.get("/").text
    return re.search(r"/static/(v-[0-9a-f]{10})/js/atelier\.js", page).group(1)


def test_les_liens_de_la_page_portent_l_empreinte(client):
    page = client.get("/").text
    v = prefixe(client)
    assert f"/static/{v}/css/atelier.css" in page and f'src="/static/{v}/js/atelier.js"' in page
    assert page.count('href="/static/css/') == 0
    # les polices gardent leur adresse (préchargées, 30 jours)
    assert 'href="/static/fonts/Cinzel-VF.woff2"' in page
    # tout le graphe des modules est annoncé d'un coup
    assert page.count('rel="modulepreload"') > 100
    assert f'rel="modulepreload" href="/static/{v}/js/atelier.js"' in page


def test_le_fichier_versionne_est_garde_un_an_et_l_ancienne_empreinte_ne_l_est_pas(client):
    v = prefixe(client)
    r = client.get(f"/static/{v}/js/atelier.js")
    assert r.status_code == 200 and r.headers["cache-control"] == "private, max-age=31536000, immutable"
    assert r.text == (config.ICI / "static/js/atelier.js").read_text(encoding="utf-8")
    vieux = client.get("/static/v-0000000000/js/atelier.js")
    assert vieux.status_code == 200 and vieux.headers["cache-control"] == "no-cache"
    # sans empreinte : comme avant
    assert client.get("/static/js/atelier.js").headers["cache-control"] == "no-cache"
    assert client.get(f"/static/{v}/js/n-existe-pas.js").status_code == 404


def test_les_adresses_absolues_des_scripts_et_les_polices_des_feuilles(client):
    v = prefixe(client)
    js = client.get(f"/static/{v}/js/mj/monde.js").text
    assert f'"/static/{v}/css/monde.css"' in js and '"/static/css/monde.css"' not in js
    css = client.get(f"/static/{v}/css/atelier.css").text
    assert "../fonts/" not in css and "/static/fonts/" in css


def test_modifier_un_fichier_change_l_empreinte(client, monkeypatch):
    avant = statiques_versionnes.version()
    fichier = config.ICI / "static" / "js" / "commun" / "miniature.js"
    st = fichier.stat()
    try:
        os.utime(fichier, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
        monkeypatch.setitem(statiques_versionnes._version, "quand", 0.0)
        assert statiques_versionnes.version() != avant
    finally:
        os.utime(fichier, ns=(st.st_atime_ns, st.st_mtime_ns))
        statiques_versionnes._version["quand"] = 0.0


def test_la_table_publique_ne_gagne_rien_par_l_empreinte(client, monkeypatch):
    monkeypatch.setattr(portier, "TABLE_PUBLIQUE", {"table.example.ch"})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {"table.example.ch"})
    h = {"Host": "table.example.ch", "CF-Connecting-IP": "203.0.113.9"}
    v = statiques_versionnes.version()
    # ce que la TV charge : permis, et public
    ok = client.get(f"/static/v-{v}/css/table.css", headers=h)
    assert ok.status_code == 200 and ok.headers["cache-control"].startswith("public")
    # le code de l'atelier (et ses fiches de départ) : fermé, versionné ou non
    for chemin in (f"/static/v-{v}/js/pnj/carnet.js", f"/static/v-{v}/js/aventuriers/kit.js", "/static/js/aventuriers/kit.js",
                   f"/static/v-{v}/js/campagne/pretires.js", "/static/js/campagne/pretires.js"):
        assert client.get(chemin, headers=h).status_code == 404, chemin
    assert "/static/v-" not in client.get("/", headers=h, follow_redirects=False).headers.get("location", "")


def test_une_grosse_image_part_en_webp_et_l_original_reste(client):
    nom = "essai-grosse-image.png"
    chemin = Path(config.IMAGES) / nom
    import random
    rnd = random.Random(1)
    image = Image.new("RGB", (900, 700))
    image.putdata([(rnd.randrange(256), rnd.randrange(256), rnd.randrange(256)) for _ in range(900 * 700)])
    image.save(chemin)
    assert chemin.stat().st_size > medias_legers.SEUIL
    octets = chemin.read_bytes()
    r = client.get(f"/media/{nom}", headers={"Accept": "image/webp,image/*"})
    assert r.headers["content-type"] == "image/webp" and r.headers["vary"] == "Accept"
    assert len(r.content) < len(octets) and r.content[:4] == b"RIFF"
    assert "immutable" in r.headers["cache-control"]
    # un navigateur sans WebP, ou la même image redemandée tout court : l'original, intact
    brut = client.get(f"/media/{nom}", headers={"Accept": "image/png"})
    assert brut.headers["content-type"] == "image/png" and brut.content == octets
    assert chemin.read_bytes() == octets
    # une petite image n'est pas touchée
    petite = "essai-petite-image.png"
    Image.new("RGB", (8, 8), (1, 2, 3)).save(Path(config.IMAGES) / petite)
    assert client.get(f"/media/{petite}", headers={"Accept": "image/webp"}).headers["content-type"] == "image/png"


def test_la_vignette_webp(client):
    nom = "essai-vignette-webp.jpg"
    Image.new("RGB", (800, 1200), (120, 90, 60)).save(Path(config.IMAGES) / nom)
    r = client.get(f"/api/table/vignette/{nom}?l=160&f=webp")
    assert r.status_code == 200 and r.headers["content-type"] == "image/webp"
    assert Image.open(__import__("io").BytesIO(r.content)).size[0] <= 160
    assert client.get(f"/api/table/vignette/{nom}?l=160").headers["content-type"] == "image/jpeg"
    assert vignettes.vignette(Path(config.IMAGES) / nom, 160, webp=True)[:4] == b"RIFF"


def plan(nom, **plus):
    return {"nom": nom, "lieu": "", "etage": "", "largeur": 40, "hauteur": 30, "style": "peint", "sol": [[1] * 40] * 30,
            "brouillard": [[0] * 40] * 30, "etapes": [{"a": 1}] * 3, "habillage": {"x": "y" * 500}, **plus}


def test_la_liste_des_plans_en_resume_et_en_304(client):
    cree = client.post("/api/plans", json=plan("Résumé essai")).json()
    complet = client.get("/api/plans")
    assert complet.status_code == 200 and any("sol" in p for p in complet.json())
    etag = complet.headers["etag"]
    assert client.get("/api/plans", headers={"If-None-Match": etag}).status_code == 304
    mini = client.get("/api/plans?resume=1").json()
    ligne = next(p for p in mini if p["id"] == cree["id"])
    assert ligne["nom"] == "Résumé essai" and ligne["nb_etapes"] == 3
    assert not {"sol", "brouillard", "habillage", "etapes"} & set(ligne)
    assert len(client.get("/api/plans?resume=1").content) < len(complet.content)
    # une écriture change l'ETag : jamais de liste périmée
    nouveau = client.get(f"/api/plans/{cree['id']}").json() | {"nom": "Résumé essai 2"}
    assert client.put(f"/api/plans/{cree['id']}", json=nouveau).status_code == 200
    apres = client.get("/api/plans", headers={"If-None-Match": etag})
    assert apres.status_code == 200 and apres.headers["etag"] != etag
    assert any(p["nom"] == "Résumé essai 2" for p in apres.json())
    # une collection sans champs de résumé déclarés rend sa liste entière
    assert client.get("/api/pnj?resume=1").content == client.get("/api/pnj").content


def test_les_listes_gardent_leur_forme(client):
    r = client.post("/api/lieux", json={"nom": "Lieu de liste"}).json()
    liste = client.get("/api/lieux")
    assert liste.headers["content-type"] == "application/json"
    assert any(x["id"] == r["id"] for x in liste.json())
    client.delete(f"/api/lieux/{r['id']}")
    assert not any(x["id"] == r["id"] for x in client.get("/api/lieux").json())


def test_le_releve_de_la_telecommande_ralentit_sans_telephone(client):
    relais = telecommande.Relais()
    assert relais.periode_de_releve(1000.0) == telecommande.PERIODE_AU_REPOS
    relais.signe_du_telephone(1000.0)
    assert relais.periode_de_releve(1010.0) == telecommande.PERIODE_ACTIVE
    assert relais.periode_de_releve(1100.0) == telecommande.PERIODE_AU_REPOS
    assert telecommande.PERIODE_AU_REPOS < telecommande.VIVANT * 1000  # jamais jugé endormi
    r = client.post("/api/telecommande/releve", json={"ecran": "a" * 16})
    assert r.status_code == 200 and int(r.headers["x-prochain-releve"]) in (telecommande.PERIODE_ACTIVE, telecommande.PERIODE_AU_REPOS)


def test_la_galerie_d_illustrations_definit_sa_miniature():
    # Régression de la recette finale : l'appel existait sans la fonction, la fiche d'un PNJ restait vide.
    from pathlib import Path
    source = (Path(__file__).resolve().parent.parent / "app/static/js/illustrations/illustrations.js").read_text(encoding="utf-8")
    assert "function miniatureGalerie(" in source
