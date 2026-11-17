"""L'état du moment des héros (Santé, Psy, Santé payée faute de Psy, cartons, note du MJ) : rangé à part des fiches,
écrit héros par héros en fusionnant les champs, tenu par le combat en cours, gardé d'un combat à l'autre ; et le sac
(or, équipement, objets) écrit dans la fiche par une route étroite. Rien de tout cela depuis Internet, rien de la note
vers la TV."""

import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, config, heros_etat, seances_api, tv_cartes  # noqa: E402

CF = {"CF-Connecting-IP": "203.0.113.7"}
NOTE = "EMPOISONNE-PAR-VADIM"


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture(autouse=True)
def etats_neufs():
    heros_etat.ETATS_HEROS.unlink(missing_ok=True)
    yield
    heros_etat.ETATS_HEROS.unlink(missing_ok=True)


@pytest.fixture(scope="module")
def heros(client):
    a = client.post("/api/aventuriers", json={"nom": "Tavarède Lavelle", "sante": 7, "psy": 5, "tablee": True, "or": 110,
                                             "equipement": ["Matériel de camp", ""], "objets": ["Un harmonica", "Une loupe"],
                                             "secret": "SECRET-TAVAREDE"}).json()
    b = client.post("/api/aventuriers", json={"nom": "Velora Dorvan", "sante": 8, "psy": 4, "tablee": True}).json()
    yield a, b
    for x in (a, b):
        client.delete(f"/api/aventuriers/{x['id']}")


@pytest.fixture()
def seance(client):
    s = client.post("/api/seances", json={"nom": "Séance de l'état", "numero": 8, "date": "2026-11-01"}).json()
    yield s
    client.delete(f"/api/seances/{s['id']}/combat")
    client.delete(f"/api/seances/{s['id']}")


def un_combat(heros, id="c1", **champs_tavarede):
    a, b = heros
    t = {"id": a["id"], "nom": a["nom"], "max": 7, "sante": 3, "psy": 1, "psyMax": 5, "santeDon": 2, "posture": "focus",
         "cartons": {"physique": "jaune", "mental": "rouge", "social": "violet"}} | champs_tavarede
    # Velora : un héros d'avant le suivi de la Psy, en pleine forme.
    v = {"id": b["id"], "nom": b["nom"], "max": 8, "sante": 8, "posture": "defensive", "cartons": {}}
    return {"id": id, "rencontre": "r", "nom": "La Grange-Noire", "tour": 1, "actif": 0, "avant": 1,
            "ordre": [f"aventurier:{a['id']}", "ennemis", f"aventurier:{b['id']}"], "heros": [t, v], "adversaires": [],
            "strat": False, "sablier": None}


def etats(client):
    return client.get("/api/etats-heros").json()


def test_sans_fichier_tout_le_monde_est_en_pleine_forme(client, heros):
    assert etats(client) == {"etats": {}, "au_combat": {}}
    assert not heros_etat.ETATS_HEROS.exists()


def test_chaque_ecran_ne_change_que_ses_champs(client, heros):
    a, _ = heros
    url = f"/api/etats-heros/{a['id']}"
    r = client.patch(url, json={"sante": 5, "cartons": {"physique": "jaune"}})
    assert r.status_code == 200 and r.json()["etat"]["sante"] == 5 and r.json()["etat"]["modifie"]
    # L'iPad note autre chose en même temps : rien de ce que le Mac a noté ne se perd.
    r = client.patch(url, json={"notes": "  bras   en écharpe ", "cartons": {"mental": "rouge"}, "psy": 2})
    e = r.json()["etat"]
    assert (e["sante"], e["psy"], e["notes"], e["cartons"]) == (5, 2, "bras en écharpe", {"physique": "jaune", "mental": "rouge"})
    # Un carton vide ou inconnu retire le sien ; None remet au maximum ; une Santé payée à 0 disparaît.
    e = client.patch(url, json={"cartons": {"physique": "", "mental": "violet", "pied": "rouge"}, "psy": None, "santeDon": 0}).json()["etat"]
    assert "cartons" not in e and "psy" not in e and "santeDon" not in e and e["sante"] == 5
    # Revenu à rien : le héros n'a plus d'état.
    assert client.patch(url, json={"sante": None, "notes": ""}).json()["etat"] == {}
    assert etats(client)["etats"] == {}
    # La fiche, elle, garde ses maximums.
    fiche = client.get(f"/api/aventuriers/{a['id']}").json()
    assert (fiche["sante"], fiche["psy"], fiche["modifie"]) == (7, 5, a["modifie"])


def test_un_etat_mal_forme_est_refuse(client, heros):
    a, _ = heros
    url = f"/api/etats-heros/{a['id']}"
    for faux in ({"sante": "5"}, {"psy": True}, {"santeDon": [1]}, {"cartons": "jaune"}, {"notes": 4}):
        assert client.patch(url, json=faux).status_code == 400, faux
    assert client.patch(url, json={"notes": "x" * 400}).status_code == 413
    assert client.patch("/api/etats-heros/inconnu", json={"sante": 1}).status_code == 404
    assert client.patch("/api/etats-heros/Pas%20bon", json={"sante": 1}).status_code == 400
    # Bornés, en entiers ; les champs inconnus laissés de côté.
    e = client.patch(url, json={"sante": -5000, "psy": 7.6, "santeDon": 10**9, "pirate": 1}).json()["etat"]
    assert (e["sante"], e["psy"], e["santeDon"]) == (-heros_etat.SANTE_ETAT_MAX, 8, seances_api.PSY_MAX) and "pirate" not in e
    assert not heros_etat.ETATS_HEROS.read_text(encoding="utf-8").count("pirate")


def test_un_repos_calcule_sur_un_etat_perime_est_refuse(client, heros):
    a, _ = heros
    url = f"/api/etats-heros/{a['id']}"
    client.patch(url, json={"sante": 2, "cartons": {"mental": "jaune"}, "notes": NOTE})
    # L'iPad a noté une Santé pendant que le Mac calculait sa nuit de repos sur l'état d'avant : refusé, rien ne change.
    client.patch(url, json={"sante": 4})
    nuit = {"sante": 5, "psy": None, "cartons": {"mental": None}}
    r = client.patch(url, json={**nuit, "avant": {"sante": 2, "psy": None, "cartons": {"mental": "jaune"}}})
    assert r.status_code == 409 and "autre écran" in r.json()["detail"]
    e = etats(client)["etats"][a["id"]]
    assert (e["sante"], e["cartons"], e["notes"]) == (4, {"mental": "jaune"}, NOTE)
    # Relu et recalculé : il passe. Absent, santeDon 0 et None se valent ; seuls les cartons nommés comptent.
    r = client.patch(url, json={"sante": None, "cartons": {"mental": None},
                                "avant": {"sante": 4, "santeDon": 0, "psy": None, "cartons": {"mental": "jaune", "physique": None}}})
    assert r.status_code == 200 and r.json()["etat"] == {"notes": NOTE, "modifie": r.json()["etat"]["modifie"]}
    # « avant » avec cartons à None : aucun carton attendu ; la note se compare aussi (vide = sans note).
    client.patch(url, json={"cartons": {"social": "rouge"}})
    assert client.patch(url, json={"sante": 1, "avant": {"cartons": None}}).status_code == 409
    assert client.patch(url, json={"sante": 1, "avant": {"notes": ""}}).status_code == 409
    assert client.patch(url, json={"sante": 1, "avant": {"notes": NOTE, "sante": None}}).status_code == 200
    # Mal formé : refusé sans rien écrire.
    for faux in ("2", [2], {"sante": "2"}):
        assert client.patch(url, json={"sante": 3, "avant": faux}).status_code == 400, faux
    assert etats(client)["etats"][a["id"]]["sante"] == 1
    # Les écrans d'avant (sans « avant ») enregistrent comme toujours.
    assert client.patch(url, json={"sante": 6}).json()["etat"]["sante"] == 6


def test_le_combat_tient_l_etat_et_le_laisse_au_suivant(client, heros, seance):
    a, b = heros
    url = f"/api/seances/{seance['id']}/combat"
    client.patch(f"/api/etats-heros/{a['id']}", json={"notes": NOTE})
    c = client.put(url, json={**un_combat(heros), "version_base": None}).json()["combat"]
    e = etats(client)
    t = e["etats"][a["id"]]
    assert (t["sante"], t["psy"], t["santeDon"], t["cartons"], t["notes"]) == (3, 1, 2, {"physique": "jaune", "mental": "rouge"}, NOTE)
    # Velora en pleine forme, sans Psy dans le combat : rien d'inventé.
    assert b["id"] not in e["etats"]
    assert e["au_combat"] == {a["id"]: {"seance": seance["id"], "combat": "La Grange-Noire"},
                              b["id"]: {"seance": seance["id"], "combat": "La Grange-Noire"}}
    # Pendant le combat, sa Santé, sa Psy et ses cartons ne changent que là ; la note reste libre.
    for champs in ({"sante": 7}, {"psy": 5}, {"cartons": {}}, {"santeDon": 0}, {"sante": 7, "notes": "x"}):
        assert client.patch(f"/api/etats-heros/{a['id']}", json=champs).status_code == 409, champs
    assert client.patch(f"/api/etats-heros/{a['id']}", json={"notes": "guéri ?"}).status_code == 200
    # Chaque enregistrement du combat le suit : un carton retiré, la Psy remontée au maximum.
    c = client.put(url, json={**un_combat(heros, sante=2, psy=5, cartons={"mental": "rouge"}), "version_base": c["modifie"]}).json()["combat"]
    t = etats(client)["etats"][a["id"]]
    assert (t["sante"], "psy" in t, t["cartons"], t["notes"]) == (2, False, {"mental": "rouge"}, "guéri ?")
    # Un autre combat le remplace, puis il finit : l'état reste.
    c = client.put(url, json={**un_combat(heros, id="c2", sante=1), "version_base": c["modifie"]}).json()["combat"]
    assert client.delete(url).status_code == 200
    e = etats(client)
    assert e["au_combat"] == {} and e["etats"][a["id"]]["sante"] == 1
    assert client.patch(f"/api/etats-heros/{a['id']}", json={"sante": 4}).status_code == 200
    # La séance, elle, garde sa version : l'onglet Séances ouvert avant enregistre sans conflit.
    assert client.get(f"/api/seances/{seance['id']}").json()["modifie"] == seance["modifie"]


def test_un_heros_rendu_au_maximum_par_le_combat_n_a_plus_de_sante_notee(client, heros, seance):
    a, _ = heros
    client.patch(f"/api/etats-heros/{a['id']}", json={"sante": 2, "psy": 1})
    url = f"/api/seances/{seance['id']}/combat"
    client.put(url, json={**un_combat(heros, sante=7, psy=5, santeDon=0, cartons={}), "version_base": None})
    assert etats(client)["etats"] == {}


def test_un_etat_illisible_n_est_jamais_ecrase(client, heros, seance):
    a, _ = heros
    heros_etat.ETATS_HEROS.write_text("{pas du json", encoding="utf-8")
    assert etats(client)["etats"] == {}
    assert client.patch(f"/api/etats-heros/{a['id']}", json={"sante": 3}).status_code == 500
    # Le combat s'enregistre quand même, sans toucher au fichier.
    assert client.put(f"/api/seances/{seance['id']}/combat", json={**un_combat(heros), "version_base": None}).status_code == 200
    assert heros_etat.ETATS_HEROS.read_text(encoding="utf-8") == "{pas du json"


def test_le_sac_change_dans_la_fiche_et_seulement_lui(client, heros):
    a, _ = heros
    url = f"/api/aventuriers/{a['id']}/sac"
    fiche = client.get(f"/api/aventuriers/{a['id']}").json()
    r = client.patch(url, json={"or": {"avant": 110, "apres": 115},
                                "objets": {"avant": ["Un harmonica", "Une loupe", ""], "apres": ["Un harmonica", "Une loupe", "Une plume"]},
                                "equipement": {"avant": ["Matériel de camp", ""], "apres": ["Matériel de camp", "Corde"]}})
    assert r.status_code == 200
    f = r.json()
    assert (f["or"], f["objets"], f["equipement"]) == (115, ["Un harmonica", "Une loupe", "Une plume"], ["Matériel de camp", "Corde"])
    assert f["modifie"] > fiche["modifie"] and f["secret"] == "SECRET-TAVAREDE" and f["sante"] == 7
    assert client.get(f"/api/aventuriers/{a['id']}").json() == f
    # Le même envoi, reparti après une réponse perdue : déjà fait, rien ne change.
    assert client.patch(url, json={"or": {"avant": 110, "apres": 115}}).json()["modifie"] == f["modifie"]
    # Un autre écran a changé l'or entre-temps : refus, l'écran rejouera son geste sur la fiche relue.
    assert client.patch(url, json={"or": {"avant": 100, "apres": 95}}).status_code == 409
    # Objets : toujours trois cases, vides comprises.
    f = client.patch(url, json={"objets": {"avant": ["Un harmonica", "Une loupe", "Une plume"], "apres": ["", "Une loupe"]}}).json()
    assert f["objets"] == ["", "Une loupe", ""]
    # Une fiche ouverte dans l'onglet Aventuriers avant ce changement passe par le conflit habituel (409 puis fusion).
    assert client.put(f"/api/aventuriers/{a['id']}", json={**fiche, "version_base": fiche["modifie"]}).status_code == 409
    # L'historique garde la version d'avant.
    assert list((config.HISTORIQUE / "aventuriers" / a["id"]).glob("*.json"))


def test_un_sac_mal_forme_est_refuse(client, heros):
    a, _ = heros
    url = f"/api/aventuriers/{a['id']}/sac"
    for faux in ({"or": 5}, {"or": {"apres": 5}}, {"or": {"avant": 115, "apres": -1}}, {"or": {"avant": 115, "apres": "5"}},
                 {"equipement": {"avant": [], "apres": "Corde"}}, {"equipement": {"avant": [], "apres": [3]}},
                 {"objets": {"avant": None, "apres": []}}):
        assert client.patch(url, json=faux).status_code == 400, faux
    assert client.patch(url, json={"equipement": {"avant": [], "apres": ["x" * 400]}}).status_code == 413
    assert client.patch("/api/aventuriers/inconnu/sac", json={}).status_code == 404


def test_la_tv_voit_la_sante_du_moment_jamais_la_note(client, heros):
    a, b = heros
    client.patch(f"/api/etats-heros/{a['id']}", json={"sante": 5, "psy": 2, "notes": NOTE, "cartons": {"physique": "jaune"}})
    client.patch(f"/api/etats-heros/{b['id']}", json={"sante": 12})
    r = client.get("/api/table/fiches")
    assert NOTE not in r.text and "SECRET-TAVAREDE" not in r.text
    fiches = {x["nom"]: x for x in r.json()}
    assert (fiches["Tavarède Lavelle"]["sante_actuelle"], fiches["Tavarède Lavelle"]["psy_actuelle"]) == (5, 2)
    assert (fiches["Tavarède Lavelle"]["sante"], fiches["Tavarède Lavelle"]["psy"]) == (7, 5)
    # Au-dessus du maximum de la fiche : au maximum.
    assert (fiches["Velora Dorvan"]["sante_actuelle"], fiches["Velora Dorvan"]["psy_actuelle"]) == (None, None)
    for route in ("/api/table/heros", f"/api/table/aventurier/{tv_cartes.jeton('aventuriers', a['id'])}"):
        assert NOTE not in client.get(route).text
    # Les fiches déjà sur la TV se relisent quand une Santé change ; une note ne lui envoie rien.
    avant = client.get("/api/table").json()
    try:
        client.put("/api/table", json={"vue": "fiches"})
        with client.websocket_connect("/ws/table") as ws:
            assert ws.receive_json()["etat"]["vue"] == "fiches"
            client.patch(f"/api/etats-heros/{a['id']}", json={"notes": "autre"})
            client.patch(f"/api/etats-heros/{a['id']}", json={"sante": 4})
            message = ws.receive_json()
        assert message["etat"]["vue"] == "fiches" and NOTE not in str(message)
    finally:
        client.put("/api/table", json={"vue": avant.get("vue") or "accueil"})


def test_depuis_internet_l_etat_et_le_sac_restent_a_l_atelier(client, heros):
    a, _ = heros
    assert client.get("/api/etats-heros", headers=CF).status_code == 404
    assert client.patch(f"/api/etats-heros/{a['id']}", json={"sante": 1}, headers=CF).status_code == 404
    assert client.patch(f"/api/aventuriers/{a['id']}/sac", json={"or": {"avant": 0, "apres": 1}}, headers=CF).status_code == 404
    assert etats(client)["etats"] == {}
    # Un écran de table ne pilote rien par le WebSocket.
    with client.websocket_connect("/ws/table", headers=CF) as ws:
        ws.receive_json()
        ws.send_json({"type": "etat", "etat": {"vue": "fiches"}, "sante": 0, "id": a["id"]})
    assert etats(client)["etats"] == {}
