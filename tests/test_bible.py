import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, bible_api  # noqa: E402
from commun import campagne  # noqa: E402

# Le dernier groupe de la bible de la campagne (campagne d'exemple ou pack) : celui des fiches hors saison des essais.
DERNIER = campagne.ORDRE_GROUPES_BIBLE[-1]


def ecrire(racine, relatif, texte):
    chemin = racine / relatif
    chemin.parent.mkdir(parents=True, exist_ok=True)
    chemin.write_text(texte, encoding="utf-8")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    lore = tmp_path / "lore"
    ecrire(lore, "bible/chronologie.md", "# Chronologie du Calvère\n\n- Fondation de Clairefonds ([S1E1](https://youtu.be/abc?t=30))\n")
    ecrire(lore, "bible/etat-du-monde.md", "# Le Calvère à la fin de la saison 4\n\n- Édric règne sur Clairefonds.\n")
    ecrire(lore, "bible/brouillon.md", "# Brouillon\n\nClairefonds hors ordre\n")
    ecrire(lore, "saisons/saison-1.md", "# Saison 1\n\nLe Grimoire est volé.\n")
    ecrire(lore, "saisons/saison-1-arbitrages.md", "# Arbitrages\n\nGrimoire : deux versions.\n")
    ecrire(lore, "saisons/saison-1-fiches.md", "# Fusion de travail\n\nClairefonds intermédiaire\n")
    ecrire(lore, "episodes/saison-1/001-abc.md", "# Épisode 1 : Clairefonds\n\n- Toma arrive à CLAIREFONDS.\n- Clairefonds brûle.\n- Clairefonds a\n- Clairefonds b\n")
    ecrire(lore, f"episodes/{DERNIER}/001-def.md", "# Hors-série 1\n\n- Rien ici.\n")
    ecrire(lore, "glossaire.md", "# Glossaire\n\n- Clairefonds : la cité.\n")
    ecrire(lore, "inventaire.md", "# Inventaire\n\n- Clairefonds, épisode 1\n")
    ecrire(lore, "examen/s4.md", "# Examen : saison 4\n\n- Clairefonds, question piège\n")
    ecrire(tmp_path, "secret.md", "# Hors de la bible\n")
    monkeypatch.setattr(bible_api, "LORE", lore)
    with TestClient(application.app) as c:
        yield c


def test_sommaire(client):
    r = client.get("/api/bible").json()
    chemins = [d["chemin"] for d in r["documents"]]
    # La bible dans l'ordre voulu (un fichier imprévu passe à la fin), puis synthèses, arbitrages et références.
    assert chemins == ["bible/etat-du-monde.md", "bible/chronologie.md", "bible/brouillon.md", "saisons/saison-1.md",
                       "saisons/saison-1-arbitrages.md", "glossaire.md", "inventaire.md", "examen/s4.md"]
    assert r["documents"][-1] == {"chemin": "examen/s4.md", "titre": "Examen : saison 4", "rubrique": "Contrôles"}
    assert r["documents"][0]["titre"] == "Le Calvère à la fin de la saison 4"
    # Les fiches suivent l'ordre des groupes de la campagne (commun/campagne.py) : la saison 1, puis le hors-série.
    assert [g["groupe"] for g in r["episodes"]] == ["saison-1", DERNIER]
    assert r["episodes"][0]["fiches"] == [{"chemin": "episodes/saison-1/001-abc.md", "titre": "Épisode 1 : Clairefonds"}]


def test_document(client):
    r = client.get("/api/bible/document", params={"chemin": "bible/chronologie.md"})
    assert r.status_code == 200
    assert "https://youtu.be/abc?t=30" in r.json()["markdown"]
    for chemin in ("../secret.md", "bible/../../secret.md", "/etc/passwd", "bible/chronologie.txt", ""):
        assert client.get("/api/bible/document", params={"chemin": chemin}).status_code == 400
    assert client.get("/api/bible/document", params={"chemin": "bible/absent.md"}).status_code == 404


def test_recherche_sans_accents_ni_majuscules(client):
    r = client.get("/api/bible/recherche", params={"q": "EDRIC clairefonds"}).json()
    assert [x["chemin"] for x in r["resultats"]] == ["bible/etat-du-monde.md"]
    assert r["resultats"][0]["lignes"] == ["Édric règne sur Clairefonds."]
    # Apostrophes et ligatures ne gênent pas : « l’œil » se trouve en tapant « l'oeil ».
    ecrire(bible_api.LORE, "bible/lieux.md", "# Lieux\n\n- Il garde l’œil du Titan.\n")
    assert client.get("/api/bible/recherche", params={"q": "l'oeil"}).json()["total"] == 1


def test_recherche_par_paragraphe(client):
    # Un paragraphe coupé en deux lignes : les deux mots sont trouvés ensemble, les renvois ne comptent pas.
    ecrire(bible_api.LORE, "saisons/saison-2.md", "# Saison 2\n\nVolker quitte la table et Frey reprend\nToma jusqu'à l'épisode 19 [e08].\n\n[e08]: ../episodes/saison-2/008-x.md\n")
    r = client.get("/api/bible/recherche", params={"q": "volker toma"}).json()
    assert r["total"] == 1
    assert r["resultats"][0]["lignes"] == ["Volker quitte la table et Frey reprend Toma jusqu'à l'épisode 19 [e08]."]
    assert client.get("/api/bible/recherche", params={"q": "episodes saison"}).json()["total"] == 0


def test_extrait_centre_sur_le_mot_sans_les_liens():
    ligne = "- " + "Avant, " * 60 + "le [Grimoire](https://youtu.be/abc?t=30) et [ép. 3][e03] **brûlent** ; " + "après, " * 60
    texte = bible_api.extrait(ligne, ["grimoire"])
    assert texte.startswith("… ") and texte.endswith(" …")
    assert "le Grimoire et ép. 3 brûlent" in texte
    assert "youtu" not in texte and "[" not in texte and "*" not in texte
    assert len(texte) < 400


def test_recherche_ordre_et_extraits(client):
    r = client.get("/api/bible/recherche", params={"q": "clairefonds"}).json()
    chemins = [x["chemin"] for x in r["resultats"]]
    # Bible d'abord, puis le glossaire, puis les fiches ; ni l'inventaire ni les fusions de travail, ni les titres.
    assert chemins == ["bible/etat-du-monde.md", "bible/chronologie.md", "bible/brouillon.md", "glossaire.md",
                       "episodes/saison-1/001-abc.md"]
    fiche = r["resultats"][-1]
    assert fiche["rubrique"] == "Saison 1"
    assert len(fiche["lignes"]) == 3 and fiche["autres"] == 1
    assert r["total"] == 8


def test_recherche_trop_courte(client):
    assert client.get("/api/bible/recherche", params={"q": "é"}).json() == {"resultats": [], "total": 0}


def test_relecture_apres_modification(client):
    fiche = bible_api.LORE / "saisons/saison-1.md"
    assert client.get("/api/bible/recherche", params={"q": "Titan"}).json()["total"] == 0
    fiche.write_text("# Saison 1\n\nLe Titan se réveille.\n", encoding="utf-8")
    os.utime(fiche, ns=(fiche.stat().st_atime_ns, fiche.stat().st_mtime_ns + 1_000_000))
    assert client.get("/api/bible/recherche", params={"q": "Titan"}).json()["total"] == 1
