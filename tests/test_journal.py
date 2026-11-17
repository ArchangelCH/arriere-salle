import os
import re
import sys
import tempfile
import threading
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, config, seances_api, utilitaires  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def nouvelle(client, **champs):
    corps = {"nom": "Séance du journal", "numero": 7, "date": "2026-11-01", "journal": [{"t": "10:00", "texte": "injecté"}]} | champs
    return client.post("/api/seances", json=corps).json()


def test_le_journal_ne_s_ecrit_que_par_ses_routes(client):
    s = nouvelle(client)
    assert s["journal"] == []
    url = f"/api/seances/{s['id']}/journal"
    r = client.post(url, json={"texte": "  Vadim s'enfuit\n vers le nord  "})
    assert r.status_code == 200
    ligne = r.json()["journal"][-1]
    assert ligne["texte"] == "Vadim s'enfuit vers le nord" and re.fullmatch(r"\d{2}:\d{2}", ligne["t"]) and ligne["id"]
    # La version de la fiche ne bouge pas : l'onglet Séances ouvert avant la ligne enregistre ensuite sans conflit,
    # et son journal (ancien ou réécrit) ne remplace pas celui du serveur.
    assert r.json()["modifie"] == s["modifie"]
    put = client.put(f"/api/seances/{s['id']}", json={**s, "objectif": "Mac", "journal": [{"t": "11:00", "texte": "réécrit"}], "version_base": s["modifie"]})
    assert put.status_code == 200 and put.json()["objectif"] == "Mac" and put.json()["journal"] == [ligne]
    assert client.put(f"/api/seances/{s['id']}", json={**s, "journal": []}).json()["journal"] == [ligne]
    assert client.patch(f"/api/seances/{s['id']}", json={"journal": []}).json()["journal"] == [ligne]
    assert client.get(f"/api/seances/{s['id']}").json()["journal"] == [ligne]
    assert client.post(url, json={"texte": "   "}).status_code == 400
    assert client.post(url, json={"texte": "x" * (seances_api.JOURNAL_LIGNE_MAX + 1)}).status_code == 413
    assert client.post("/api/seances/inconnue/journal", json={"texte": "Rien"}).status_code == 404


def test_deux_ecrans_qui_notent_en_meme_temps_ne_perdent_rien(client):
    s = nouvelle(client)
    url = f"/api/seances/{s['id']}/journal"
    erreurs = []

    def noter(ecran):
        for k in range(15):
            r = client.post(url, json={"texte": f"{ecran} {k}"})
            if r.status_code != 200:
                erreurs.append(r.status_code)

    def noter_puis_retirer():
        # Un troisième écran note puis retire ses lignes : seules les siennes partent.
        for k in range(15):
            r = client.post(url, json={"texte": f"Brouillon {k}"})
            ligne = next(j for j in reversed(r.json()["journal"]) if j["texte"] == f"Brouillon {k}")
            if client.delete(f"{url}/{ligne['id']}").status_code != 200:
                erreurs.append("retrait")

    def enregistrer_la_fiche():
        # Pendant ce temps, un dernier écran enregistre la séance entière, avec le journal qu'il avait à l'ouverture.
        for k in range(15):
            r = client.put(f"/api/seances/{s['id']}", json={**s, "notes": f"notes {k}"})
            if r.status_code != 200:
                erreurs.append(r.status_code)

    fils = [threading.Thread(target=noter, args=(e,)) for e in ("Mac", "iPad")]
    fils += [threading.Thread(target=noter_puis_retirer), threading.Thread(target=enregistrer_la_fiche)]
    for f in fils:
        f.start()
    for f in fils:
        f.join()
    assert erreurs == []
    journal = client.get(f"/api/seances/{s['id']}").json()["journal"]
    assert len(journal) == 30 and len({j["id"] for j in journal}) == 30
    for ecran in ("Mac", "iPad"):
        assert [j["texte"] for j in journal if j["texte"].startswith(ecran)] == [f"{ecran} {k}" for k in range(15)]


def test_retirer_une_ligne_du_journal(client):
    s = nouvelle(client)
    url = f"/api/seances/{s['id']}/journal"
    for t in ("Le groupe entre dans la grange", "Eloran tombe dans le puits", "Vadim s'enfuit"):
        client.post(url, json={"texte": t})
    journal = client.get(f"/api/seances/{s['id']}").json()["journal"]
    r = client.delete(f"{url}/{journal[1]['id']}")
    assert r.status_code == 200 and [j["texte"] for j in r.json()["journal"]] == ["Le groupe entre dans la grange", "Vadim s'enfuit"]
    assert r.json()["modifie"] == s["modifie"]
    # Retirée deux fois (deux écrans) : la seconde ne retire rien d'autre.
    assert client.delete(f"{url}/{journal[1]['id']}").status_code == 404
    assert len(client.get(f"/api/seances/{s['id']}").json()["journal"]) == 2


def test_une_ligne_d_avant_les_identifiants_se_retire_par_sa_place_et_son_texte(client):
    s = nouvelle(client)
    chemin = config.SEANCES / f"{s['id']}.json"
    utilitaires.ecrire(chemin, {**utilitaires.lire(chemin), "journal": [{"t": "14:05", "texte": "ancienne"}, {"t": "14:10", "texte": "autre"}]})
    url = f"/api/seances/{s['id']}/journal"
    assert client.delete(f"{url}/n1", params={"texte_ligne": "pas celle-ci"}).status_code == 404
    assert client.delete(f"{url}/n5", params={"texte_ligne": "autre"}).status_code == 404
    r = client.delete(f"{url}/n1", params={"texte_ligne": "autre"})
    assert r.status_code == 200 and r.json()["journal"] == [{"t": "14:05", "texte": "ancienne"}]
    # Une nouvelle ligne s'ajoute à la suite, sans toucher aux anciennes.
    apres = client.post(url, json={"texte": "nouvelle"}).json()["journal"]
    assert apres[0] == {"t": "14:05", "texte": "ancienne"} and apres[1]["texte"] == "nouvelle"
