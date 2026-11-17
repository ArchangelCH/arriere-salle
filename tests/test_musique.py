import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application  # noqa: E402
from table import musique  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.mark.parametrize("lien, attendu", [
    ("https://www.youtube.com/watch?v=Ambianc3abc", {"video": "Ambianc3abc", "liste": None}),
    ("youtu.be/Ambianc3abc?si=abc", {"video": "Ambianc3abc", "liste": None}),
    ("https://m.youtube.com/watch?v=Ambianc3abc&t=42s", {"video": "Ambianc3abc", "liste": None}),
    ("https://www.youtube.com/playlist?list=PLexempleDeListe_0123456789abcdefg",
     {"video": None, "liste": "PLexempleDeListe_0123456789abcdefg"}),
    ("https://www.youtube.com/watch?v=Ambianc3abc&list=PLexempleDeListe_0123456789abcdefg&index=3",
     {"video": "Ambianc3abc", "liste": "PLexempleDeListe_0123456789abcdefg"}),
    ("https://music.youtube.com/playlist?list=PLexempleDeListe_0123456789abcdefg",
     {"video": None, "liste": "PLexempleDeListe_0123456789abcdefg"}),
    ("https://www.youtube.com/embed/videoseries?list=PLexempleDeListe_0123456789abcdefg",
     {"video": None, "liste": "PLexempleDeListe_0123456789abcdefg"}),
    ("https://www.youtube.com/shorts/Ambianc3abc", {"video": "Ambianc3abc", "liste": None}),
])
def test_les_liens_youtube_sont_reconnus(lien, attendu):
    assert musique.analyser_lien(lien) == attendu


@pytest.mark.parametrize("lien", ["", "https://vimeo.com/123", "https://www.youtube.com/@MichaelGhelfi",
                                  "https://www.youtube.com/watch?v=court", "javascript:alert(1)",
                                  "https://www.youtube.com.exemple.ch/watch?v=Ambianc3abc"])
def test_les_autres_liens_sont_refuses(lien):
    with pytest.raises(musique.LienInvalide):
        musique.analyser_lien(lien)


def test_la_liste_de_bout_en_bout(client, monkeypatch):
    appels = []

    async def faux_youtube(source):
        appels.append(source)
        if source["video"] == "AAAAAAAAAAA":
            return {"lisible": False, "titre": "", "auteur": "", "raison": "YouTube refuse sa lecture hors de son site"}
        return {"lisible": True, "titre": f"Titre {source['video'] or source['liste']}", "auteur": "Studio"}

    monkeypatch.setattr(musique, "verifier", faux_youtube)
    assert client.get("/api/musique").json() == {"ambiances": [], "combat": None, "boutique": None, "modifie": None}

    d = client.put("/api/musique", json={"version_base": None, "ambiances": [
        {"nom": "  L'auberge  ", "lien": "https://www.youtube.com/playlist?list=PLexempleDeListe_0123456789abcdefg", "note": "Chapitre 1"},
        {"nom": "Le moulin", "lien": "https://youtu.be/Ambianc3abc"},
        {"nom": "Refusée", "lien": "https://www.youtube.com/watch?v=AAAAAAAAAAA"},
    ]}).json()
    a, b, c = d["ambiances"]
    assert a["nom"] == "L'auberge" and a["liste"] == "PLexempleDeListe_0123456789abcdefg" and a["video"] is None
    assert a["titre"] == "Titre PLexempleDeListe_0123456789abcdefg" and a["lisible"] is True and a["note"] == "Chapitre 1"
    assert b["lien"] == "https://www.youtube.com/watch?v=Ambianc3abc" and b["lisible"] is True
    assert c["lisible"] is False and "refuse" in c["raison"]
    assert len({a["id"], b["id"], c["id"]}) == 3 and "verifier" not in a
    assert client.get("/api/musique").json() == d

    # Réordonner et renommer ne redemande rien à YouTube ; un nouveau lien, si.
    appels.clear()
    d2 = client.put("/api/musique", json={"version_base": d["modifie"], "ambiances": [
        {"id": b["id"], "nom": "Le moulin des Varenne", "lien": b["lien"]},
        {"id": a["id"], "nom": a["nom"], "lien": a["lien"]},
        {"nom": "Combat", "lien": "https://www.youtube.com/watch?v=Altern4tive"},
    ]}).json()
    assert [x["nom"] for x in d2["ambiances"]] == ["Le moulin des Varenne", "L'auberge", "Combat"]
    assert d2["ambiances"][0]["id"] == b["id"] and d2["ambiances"][0]["titre"] == "Titre Ambianc3abc"
    assert appels == [{"video": "Altern4tive", "liste": None}]

    # Une version périmée est refusée ; un lien qui n'est pas YouTube aussi, avec le nom de l'ambiance.
    assert client.put("/api/musique", json={"version_base": d["modifie"], "ambiances": []}).status_code == 409
    r = client.put("/api/musique", json={"version_base": d2["modifie"], "ambiances": [{"nom": "Vimeo", "lien": "https://vimeo.com/1"}]})
    assert r.status_code == 422 and "Vimeo" in r.json()["detail"]
    r = client.put("/api/musique", json={"version_base": d2["modifie"], "ambiances": [{"nom": "", "lien": b["lien"]}]})
    assert r.status_code == 422
    assert client.get("/api/musique").json() == d2


def test_la_musique_ne_sort_pas_par_la_table_publique(client):
    # Tout ce qui passe par Cloudflare n'a droit qu'à la vue TV.
    assert client.get("/api/musique", headers={"cf-connecting-ip": "203.0.113.9"}).status_code == 404
    assert client.put("/api/musique", json={"ambiances": []}, headers={"cf-connecting-ip": "203.0.113.9"}).status_code == 404
