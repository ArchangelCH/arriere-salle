"""Le sanctuaire : l'auberge en ruines au départ, les chantiers du catalogue, les versements pris dans la bourse d'un
héros (jamais plus que ce qui manque, jamais plus que son or), le niveau bâti dès qu'il est payé, l'or rendu ; un
enregistrement entier ne touche ni niveau, ni cagnotte, ni la liste des bâtiments ; la TV ne voit ni notes du MJ ni
bâtiment caché, et rien du sanctuaire ne s'écrit depuis Internet."""

import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, refuge  # noqa: E402

CF = {"CF-Connecting-IP": "203.0.113.7"}
NOTE = "NOTE-DU-MJ-SANCTUAIRE"


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture(autouse=True)
def sanctuaire_neuf():
    refuge.SANCTUAIRE.unlink(missing_ok=True)
    yield
    refuge.SANCTUAIRE.unlink(missing_ok=True)


@pytest.fixture()
def heros(client):
    a = client.post("/api/aventuriers", json={"nom": "Orlane Bâtisseuse", "sante": 8, "psy": 4, "tablee": True, "or": 200}).json()
    yield a
    client.delete(f"/api/aventuriers/{a['id']}")


def or_de(client, a):
    return client.get(f"/api/aventuriers/{a['id']}").json()["or"]


def test_au_depart_l_auberge_est_en_ruines(client):
    s = client.get("/api/sanctuaire").json()
    assert s["modifie"] is None and [b["id"] for b in s["batiments"]] == ["auberge"]
    assert s["batiments"][0]["ruine"] and s["batiments"][0]["niveau"] == 0
    assert len(s["catalogue"]) >= 10 and all(t["niveaux"] for t in s["catalogue"])
    pub = client.get("/api/table/sanctuaire").json()
    assert pub["batiments"][0]["etat"] == "En ruines" and pub["habitants"] == 0 and pub["bonus"] == []


def test_verser_batit_des_que_c_est_paye(client, heros):
    url = "/api/sanctuaire/versements"
    r = client.post(url, json={"batiment": "auberge", "aventurier": heros["id"], "or": 100}).json()
    assert (r["pris"], r["construit"], r["or"]) == (100, None, 100)
    # Jamais plus que ce qui manque (50) : le reste reste dans la bourse, et le niveau est bâti.
    r = client.post(url, json={"batiment": "auberge", "aventurier": heros["id"], "or": 80}).json()
    assert r["pris"] == 50 and r["construit"]["rang"] == 1 and r["or"] == 50
    b = r["sanctuaire"]["batiments"][0]
    assert (b["niveau"], b["cagnotte"], b["ruine"]) == (1, 0, False)
    assert or_de(client, heros) == 50
    # Plus que sa bourse : refusé, rien ne bouge.
    r = client.post(url, json={"batiment": "auberge", "aventurier": heros["id"], "or": 60})
    assert r.status_code == 409 and or_de(client, heros) == 50
    for mauvais in ({"or": 0}, {"or": -5}, {"or": "dix"}, {"or": True}):
        assert client.post(url, json={"batiment": "auberge", "aventurier": heros["id"], **mauvais}).status_code == 400, mauvais
    assert client.post(url, json={"batiment": "nulle-part", "aventurier": heros["id"], "or": 5}).status_code == 404
    pub = client.get("/api/table/sanctuaire").json()
    auberge = pub["batiments"][0]
    assert auberge["niveau"] == 1 and auberge["prochain"]["rang"] == 2 and auberge["donateurs"] == []
    assert pub["habitants"] == 2 and len(pub["bonus"]) == 1
    journal = client.get("/api/sanctuaire").json()["journal"]
    assert any("passe au niveau 1" in l["texte"] for l in journal)


def test_un_versement_se_rend_tant_que_le_niveau_n_est_pas_bati(client, heros):
    url = "/api/sanctuaire/versements"
    a = client.post(url, json={"batiment": "auberge", "aventurier": heros["id"], "or": 30}).json()["versement"]
    b = client.post(url, json={"batiment": "auberge", "aventurier": heros["id"], "or": 20}).json()["versement"]
    # Seul le dernier se rend.
    assert client.delete(f"{url}/{a['id']}").status_code == 409
    r = client.delete(f"{url}/{b['id']}").json()
    assert r["rendu"]["or"] == 20 and or_de(client, heros) == 170
    assert client.get("/api/sanctuaire").json()["batiments"][0]["cagnotte"] == 30
    # Les prénoms de ceux qui ont versé pour le niveau en cours vont à la TV.
    assert client.get("/api/table/sanctuaire").json()["batiments"][0]["donateurs"] == [{"nom": "Orlane", "or": 30}]


def test_le_versement_qui_a_bati_se_rend_et_le_niveau_recule(client, heros):
    url = "/api/sanctuaire/versements"
    a = client.post(url, json={"batiment": "auberge", "aventurier": heros["id"], "or": 100}).json()["versement"]
    r = client.post(url, json={"batiment": "auberge", "aventurier": heros["id"], "or": 50}).json()
    assert r["construit"]["rang"] == 1 and or_de(client, heros) == 50
    b = r["versement"]
    # Le dernier versement du niveau bâti se rend : l'auberge redescend, en ruines comme avant, la cagnotte d'avant revient.
    assert client.delete(f"{url}/{a['id']}").status_code == 409
    r = client.delete(f"{url}/{b['id']}").json()
    assert r["rendu"]["recul"]["rang"] == 1 and or_de(client, heros) == 100
    auberge = r["sanctuaire"]["batiments"][0]
    assert (auberge["niveau"], auberge["cagnotte"], auberge["ruine"]) == (0, 100, True)
    assert any("revient au niveau 0" in l["texte"] for l in r["sanctuaire"]["journal"])
    # Puis le précédent, comme avant.
    assert client.delete(f"{url}/{a['id']}").json()["rendu"]["or"] == 100 and or_de(client, heros) == 200
    assert client.get("/api/sanctuaire").json()["batiments"][0]["cagnotte"] == 0


def test_un_niveau_entame_garde_le_niveau_d_avant(client, heros):
    url = "/api/sanctuaire/versements"
    b = client.post(url, json={"batiment": "auberge", "aventurier": heros["id"], "or": 150}).json()["versement"]
    client.post(url, json={"batiment": "auberge", "aventurier": heros["id"], "or": 10})
    # Un versement pour le niveau II est venu après : celui qui a bâti le niveau I ne se rend plus.
    assert client.delete(f"{url}/{b['id']}").status_code == 409


def test_l_enregistrement_entier_ne_touche_ni_niveau_ni_cagnotte(client, heros):
    client.post("/api/sanctuaire/batiments", json={"type": "maison"})
    client.post("/api/sanctuaire/versements", json={"batiment": "auberge", "aventurier": heros["id"], "or": 40})
    s = client.get("/api/sanctuaire").json()
    vieux = {**s, "version_base": s["modifie"]}
    vieux["batiments"] = [{**b, "niveau": 3, "cagnotte": 0, "versements": [], "nom": "Le Refuge", "x": 500} if b["id"] == "auberge" else b
                          for b in s["batiments"] if b["id"] == "auberge"]
    vieux["batiments"].append({"id": "pirate", "type": "forge", "nom": "Forge fantôme", "niveau": 3})
    s2 = client.put("/api/sanctuaire", json=vieux).json()
    auberge = next(b for b in s2["batiments"] if b["id"] == "auberge")
    # Le nom et la place changent ; niveau, cagnotte et versements restent ; la maison oubliée par l'écran reste aussi.
    assert (auberge["nom"], auberge["x"], auberge["niveau"], auberge["cagnotte"], len(auberge["versements"])) == ("Le Refuge", 500, 0, 40, 1)
    assert [b["id"] for b in s2["batiments"]] == ["auberge", "maison"]
    # Une vieille version : 409.
    assert client.put("/api/sanctuaire", json={**s, "version_base": s["modifie"]}).status_code == 409


def test_chantiers_corrections_et_retraits(client):
    r = client.post("/api/sanctuaire/batiments", json={"type": "forge"})
    assert r.status_code == 200 and r.json()["batiment"] == "forge"
    assert client.post("/api/sanctuaire/batiments", json={"type": "forge"}).status_code == 409  # unique
    assert client.post("/api/sanctuaire/batiments", json={"type": "maison"}).json()["batiment"] == "maison"
    assert client.post("/api/sanctuaire/batiments", json={"type": "maison"}).json()["batiment"] == "maison-2"
    assert client.post("/api/sanctuaire/batiments", json={"type": "dragon"}).status_code == 404
    s = client.patch("/api/sanctuaire/batiments/forge", json={"niveau": 2}).json()["sanctuaire"]
    forge = next(b for b in s["batiments"] if b["id"] == "forge")
    assert forge["niveau"] == 2
    assert client.patch("/api/sanctuaire/batiments/forge", json={"niveau": 99}).json()["sanctuaire"]["batiments"][1]["niveau"] == 3
    s = client.delete("/api/sanctuaire/batiments/maison-2").json()["sanctuaire"]
    assert "maison-2" not in [b["id"] for b in s["batiments"]]


def test_la_tv_ne_voit_ni_notes_ni_batiment_cache(client):
    client.post("/api/sanctuaire/batiments", json={"type": "autel", "cache": True})
    client.post("/api/sanctuaire/batiments", json={"type": "tour"})
    s = client.get("/api/sanctuaire").json()
    s["notes_mj"] = NOTE
    for b in s["batiments"]:
        b["notes_mj"] = NOTE
    client.put("/api/sanctuaire", json={**s, "version_base": s["modifie"]})
    r = client.get("/api/table/sanctuaire")
    assert NOTE not in r.text and "catalogue" not in r.json()
    assert [b["id"] for b in r.json()["batiments"]] == ["auberge", "tour"]
    # Le nom caché de l'auberge ne passe jamais vers la TV.
    s = client.get("/api/sanctuaire").json()
    s["batiments"][0]["nom"] = "La Petite Fanfrelée"
    client.put("/api/sanctuaire", json={**s, "version_base": s["modifie"]})
    assert "Fanfrel" not in client.get("/api/table/sanctuaire").text


def test_depuis_internet_rien_ne_s_ecrit(client, heros):
    # Depuis Internet, le sanctuaire ne se lit que quand la TV le montre : avant, il dévoilerait la suite de la campagne.
    client.put("/api/table", json={"vue": "accueil"})
    assert client.get("/api/table/sanctuaire", headers=CF).status_code == 404
    assert client.get("/api/table/sanctuaire").status_code == 200
    client.put("/api/table", json={"vue": "sanctuaire"})
    assert client.get("/api/table/sanctuaire", headers=CF).status_code == 200
    client.put("/api/table", json={"vue": "accueil"})
    assert client.get("/api/sanctuaire", headers=CF).status_code == 404
    assert client.post("/api/sanctuaire/versements", headers=CF, json={"batiment": "auberge", "aventurier": heros["id"], "or": 5}).status_code == 404
    assert client.post("/api/sanctuaire/batiments", headers=CF, json={"type": "maison"}).status_code == 404
    assert or_de(client, heros) == 200


def test_la_tv_qui_montre_le_sanctuaire_le_relit(client, heros):
    avant = client.get("/api/table").json()
    try:
        client.put("/api/table", json={"vue": "sanctuaire", "batiment": "auberge"})
        with client.websocket_connect("/ws/table") as ws:
            etat = ws.receive_json()["etat"]
            assert etat["vue"] == "sanctuaire" and etat["batiment"] == "auberge"
            client.post("/api/sanctuaire/versements", json={"batiment": "auberge", "aventurier": heros["id"], "or": 10})
            message = ws.receive_json()
        assert message["etat"]["vue"] == "sanctuaire" and message["etat"]["sanctuaire_maj"]
    finally:
        client.put("/api/table", json={"vue": avant.get("vue") or "accueil"})


def test_un_niveau_deja_paye_se_batit_sans_or(client, heros):
    s = client.get("/api/sanctuaire").json()
    t = next(x for x in s["catalogue"] if x["type"] == "auberge")
    t["niveaux"][0]["cout"] = 0
    client.put("/api/sanctuaire", json={**s, "version_base": s["modifie"]})
    r = client.post("/api/sanctuaire/versements", json={"batiment": "auberge", "aventurier": heros["id"], "or": 1}).json()
    assert r["pris"] == 0 and r["construit"]["rang"] == 1 and or_de(client, heros) == 200
    # Enregistré, pas seulement renvoyé.
    assert client.get("/api/sanctuaire").json()["batiments"][0]["niveau"] == 1


def test_un_catalogue_ne_retire_pas_un_niveau_bati(client):
    client.patch("/api/sanctuaire/batiments/auberge", json={"niveau": 2})
    s = client.get("/api/sanctuaire").json()
    t = next(x for x in s["catalogue"] if x["type"] == "auberge")
    t["niveaux"] = t["niveaux"][:1]
    assert client.put("/api/sanctuaire", json={**s, "version_base": s["modifie"]}).status_code == 409
    assert client.get("/api/sanctuaire").json()["batiments"][0]["niveau"] == 2


def test_un_batiment_cache_ne_part_jamais_de_pres(client):
    client.post("/api/sanctuaire/batiments", json={"type": "autel", "cache": True})
    avant = client.get("/api/table").json()
    try:
        client.put("/api/table", json={"vue": "sanctuaire", "batiment": "autel"})
        with client.websocket_connect("/ws/table") as ws:
            assert "batiment" not in ws.receive_json()["etat"]
        # Une autre vue ne garde pas le bâtiment montré de près.
        client.put("/api/table", json={"vue": "planche", "batiment": "auberge"})
        with client.websocket_connect("/ws/table") as ws:
            assert "batiment" not in ws.receive_json()["etat"]
    finally:
        client.put("/api/table", json={"vue": avant.get("vue") or "accueil"})
