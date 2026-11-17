import json
import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from contenu import consignes  # noqa: E402
import main  # noqa: E402
from api import application, config, utilitaires  # noqa: E402
from sources_front import source_page  # noqa: E402

CAS = json.loads((Path(__file__).parent / "consignes-cas.json").read_text(encoding="utf-8"))["cas"]


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.mark.parametrize("cas", CAS, ids=[c["nom"] for c in CAS])
def test_consignes_lues_comme_dans_le_navigateur(cas):
    scenario = {"chapitres": [{"id": f"c-{i}", "texte": t} for i, t in enumerate(cas["chapitres"])]}
    lues = [{k: c[k] for k in ("genre", "indications", "cle", "rang", "bloc")} | {"numero": c["chapitre"]["numero"]}
            for c in consignes.consignes_du_scenario(scenario)]
    assert lues == cas["attendu"]


def nouveau(client, **champs):
    corps = {"nom": "La chasse est ouverte", "etat": "brouillon", "chapitres": [
        {"id": "c-un", "titre": "L'arrivée", "texte": "La pluie SECRET-SCENARIO.\n\n[[carte blanche : l'auberge au matin]]\n\nPuis [[pistes : un nom de village]]."},
        {"id": "c-deux", "titre": "La traque", "texte": "Le chasseur [[pnj : le chasseur, froid]]"},
    ]} | champs
    return client.post("/api/scenarios", json=corps).json()


def test_un_scenario_de_bout_en_bout(client):
    s = nouveau(client, reponses=[{"faux": True}], relectures={"c-un": {"texte": "injecté"}})
    # Les propositions et relectures ne s'écrivent que par leurs routes, même à la création.
    assert s["reponses"] == [] and s["relectures"] == {}

    lues = client.get(f"/api/scenarios/{s['id']}/consignes").json()
    assert [c["genre"] for c in lues["consignes"]] == ["rediger", "pistes", "pnj"]
    auberge, village, chasseur = lues["consignes"]
    assert auberge["bloc"] and not village["bloc"] and auberge["chapitre"]["titre"] == "L'arrivée"
    assert "SECRET-SCENARIO" in auberge["avant"] and auberge["etat"] == "ouverte" and lues["orphelines"] == []

    # Une proposition se dépose par la référence de sa consigne ; la suivante remplace la précédente.
    s1 = client.post(f"/api/scenarios/{s['id']}/reponses", json={"ref": auberge["ref"], "texte": "Première version."}).json()
    assert s1["modifie"] > s["modifie"]
    s2 = client.post(f"/api/scenarios/{s['id']}/reponses", json={"ref": auberge["ref"], "texte": "Seconde version."}).json()
    assert [r["statut"] for r in s2["reponses"]] == ["remplacee", "proposee"]
    assert client.post(f"/api/scenarios/{s['id']}/reponses", json={"ref": "000000", "texte": "x"}).status_code == 404
    assert client.post(f"/api/scenarios/{s['id']}/reponses", json={"ref": village["ref"], "texte": "  "}).status_code == 400
    lues = client.get(f"/api/scenarios/{s['id']}/consignes").json()
    assert lues["consignes"][0]["etat"] == "proposee" and lues["consignes"][0]["proposition"]["texte"] == "Seconde version."

    # Le MJ enregistre son texte avec une copie périmée des propositions : elles ne sont pas écrasées.
    texte = dict(s2)
    texte["chapitres"][1]["texte"] += " qui attend."
    texte["reponses"] = []
    texte["version_base"] = s2["modifie"]
    s3 = client.put(f"/api/scenarios/{s['id']}", json=texte).json()
    assert len(s3["reponses"]) == 2 and s3["chapitres"][1]["texte"].endswith("qui attend.")
    # Une version périmée est refusée, comme pour toutes les fiches.
    assert client.put(f"/api/scenarios/{s['id']}", json=texte).status_code == 409
    assert client.patch(f"/api/scenarios/{s['id']}", json={"reponses": [], "nom": "Renommé"}).json()["reponses"] == s3["reponses"]

    # Intégrer : le texte change côté MJ, le statut par sa route, sans changer la version de la fiche.
    proposee = s3["reponses"][-1]
    apres = client.patch(f"/api/scenarios/{s['id']}/reponses/{proposee['id']}", json={"statut": "integree"}).json()
    assert apres["reponses"][-1]["statut"] == "integree" and apres["modifie"] == client.get(f"/api/scenarios/{s['id']}").json()["modifie"]
    assert client.patch(f"/api/scenarios/{s['id']}/reponses/{proposee['id']}", json={"statut": "proposee"}).status_code == 400

    # Une consigne réécrite laisse sa proposition orpheline, signalée à part.
    client.post(f"/api/scenarios/{s['id']}/reponses", json={"ref": village["ref"], "texte": "Brumeval, Sombrecombe."})
    courant = client.get(f"/api/scenarios/{s['id']}").json()
    courant["chapitres"][0]["texte"] = courant["chapitres"][0]["texte"].replace("un nom de village", "un nom de hameau")
    client.put(f"/api/scenarios/{s['id']}", json=courant)
    lues = client.get(f"/api/scenarios/{s['id']}/consignes").json()
    assert [o["texte"] for o in lues["orphelines"]] == ["Brumeval, Sombrecombe."]

    # Relectures : par chapitre ou d'ensemble, effaçables, jamais pour un chapitre inconnu.
    r = client.put(f"/api/scenarios/{s['id']}/relectures/c-un", json={"texte": "Conforme au canon."}).json()
    assert r["relectures"]["c-un"]["texte"] == "Conforme au canon."
    assert client.put(f"/api/scenarios/{s['id']}/relectures/ensemble", json={"texte": "Vue d'ensemble."}).status_code == 200
    assert client.put(f"/api/scenarios/{s['id']}/relectures/c-inconnu", json={"texte": "x"}).status_code == 404
    assert "c-un" not in client.delete(f"/api/scenarios/{s['id']}/relectures/c-un").json()["relectures"]

    # Rien ne part vers la TV ; supprimer envoie à la corbeille.
    assert "SECRET-SCENARIO" not in client.get("/api/table").text
    assert client.delete(f"/api/scenarios/{s['id']}").status_code == 200
    assert client.get(f"/api/scenarios/{s['id']}").status_code == 404
    assert any(f.name.startswith(s["id"]) for f in (config.CORBEILLE / "scenarios").glob("*.json"))


def test_historique_plus_long_pour_les_scenarios(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "HISTORIQUE", tmp_path)
    fiche = tmp_path / "s.json"
    fiche.write_text("{}")
    for sous_dossier, maximum, gardees in (("scenarios", 200, 46), ("lieux", config.ARCHIVES_MAX, config.ARCHIVES_MAX)):
        dossier = tmp_path / sous_dossier / "s"
        dossier.mkdir(parents=True)
        for i in range(45):
            ancienne = dossier / f"2026{i:04d}-000000.json"
            ancienne.write_text("{}")
            os.utime(ancienne, (0, 0))
        utilitaires.archiver(fiche, sous_dossier, maximum)
        assert len(list(dossier.glob("*.json"))) == gardees


JS = Path(__file__).resolve().parent.parent / "app" / "static" / "js"


def test_un_lien_vers_une_fiche_reste_tel_quel(client):
    """Les liens insérés par le bouton Fiche ou « @ » sont du texte du MJ : gardés à l'identique, ils ne changent ni les
    consignes voisines ni leurs propositions, et rien ne part vers la TV."""
    texte = ("Au matin, [Vadim](#/pnj/vadim) attend à [La Grange-Noire](#/carte/la-route-de-tarvan?lieu=la-grange-noire).\n\n"
             "[[pistes : ce que voit LIEN-MJ]] puis [le combat](#/combats/la-grange-noire) sur [le plan](#/plan/la-grange-noire).")
    s = client.post("/api/scenarios", json={"nom": "Les liens", "chapitres": [{"id": "c-un", "titre": "Un", "texte": texte}]}).json()
    assert s["chapitres"][0]["texte"] == texte
    lues = client.get(f"/api/scenarios/{s['id']}/consignes").json()["consignes"]
    assert [(c["genre"], c["indications"]) for c in lues] == [("pistes", "ce que voit LIEN-MJ")]
    remis = client.put(f"/api/scenarios/{s['id']}", json={**s, "version_base": s["modifie"]}).json()
    assert remis["chapitres"][0]["texte"] == texte
    for url in ("/api/table", "/api/table/planche"):
        r = client.get(url)
        assert "LIEN-MJ" not in r.text and "#/pnj/vadim" not in r.text, url


def test_les_fiches_que_vise_un_lien_se_lisent_et_s_ouvrent():
    """fiches.js lit ces listes et produit ces routes : elles doivent exister côté serveur et dans le routeur de l'atelier."""
    with TestClient(application.app) as c:
        for url in ("/api/pnj", "/api/lieux", "/api/plans", "/api/rencontres", "/api/cartes"):
            r = c.get(url)
            assert r.status_code == 200 and isinstance(r.json(), list), url
    fiches = (JS / "scenarios" / "fiches.js").read_text(encoding="utf-8")
    routeur = source_page("atelier")
    for page in ("pnj", "plan", "combats", "carte"):
        assert f"`#/{page}/${{enc(f.id)}}`" in fiches, page
        assert f'morceaux[0] === "{page}"' in routeur, page
    # Côté MJ seulement : la TV et le coin des joueurs n'en chargent rien, et le module n'écrit rien.
    assert not re.search(r"\bapi\.(put|post|patch|del)\(", fiches)
    for f in [JS / "table.js", *(JS / "joueurs").rglob("*.js")]:
        source = f.read_text(encoding="utf-8")
        assert "scenarios/" not in source, f.name
