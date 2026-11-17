"""« Jouer la scène » : la ligne du journal passe par sa route, et le repère de la scène en cours (champ en_cours de la
ligne du déroulé) s'enregistre avec la séance, suit sa ligne quand le déroulé est réorganisé et ne part jamais vers la
TV. Le geste lui-même se vérifie sous node (outils/verifier_jouer_scene.mjs)."""

import copy
import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, tv_cartes  # noqa: E402

J = tv_cartes.jeton
JS = Path(__file__).resolve().parent.parent / "app" / "static" / "js"
REPERE = "2026-11-03T19:15:00.000Z"

DEROULE = [
    {"heure": "15:05", "titre": "Les chasseurs du Notaire", "duree": 20, "fait": True},
    {"heure": "15:25", "titre": "La rixe et le bouclier de Toma", "duree": 20,
     "liens": {"plan": "PLAN-MJ", "ambiance": "AMBIANCE-MJ", "rencontre": "RENCONTRE-MJ"}},
    {"heure": "15:45", "titre": "L'inquisiteur et Toma, dehors", "duree": 15},
]


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def test_le_repere_s_enregistre_et_suit_sa_ligne(client):
    s = client.post("/api/seances", json={"nom": "La rixe", "numero": 21, "deroule": DEROULE}).json()
    # Le geste : la ligne du journal par sa route (heure du serveur), puis la séance avec son repère.
    apres = client.post(f"/api/seances/{s['id']}/journal", json={"texte": "Scène : La rixe et le bouclier de Toma"}).json()
    ligne = apres["journal"][-1]
    assert ligne["texte"] == "Scène : La rixe et le bouclier de Toma" and re.fullmatch(r"\d{2}:\d{2}", ligne["t"])
    assert apres["deroule"] == DEROULE
    lue = client.get(f"/api/seances/{s['id']}").json()
    lue["deroule"][1]["en_cours"] = REPERE
    remise = client.put(f"/api/seances/{s['id']}", json={**lue, "version_base": lue["modifie"]}).json()
    assert remise["deroule"][1] == {**DEROULE[1], "en_cours": REPERE}
    assert [d.get("en_cours") for d in remise["deroule"]] == [None, REPERE, None]
    # Le journal noté par sa route reste, même si la fiche entière repart d'un onglet ouvert avant la ligne.
    assert remise["journal"][-1]["texte"] == "Scène : La rixe et le bouclier de Toma"

    # Le MJ fait monter la scène suivante avant celle en cours (Préparer) : le repère reste sur sa scène.
    lue = client.get(f"/api/seances/{s['id']}").json()
    lue["deroule"][1], lue["deroule"][2] = lue["deroule"][2], lue["deroule"][1]
    remise = client.put(f"/api/seances/{s['id']}", json={**lue, "version_base": lue["modifie"]}).json()
    assert remise["deroule"][2]["titre"] == "La rixe et le bouclier de Toma" and remise["deroule"][2]["en_cours"] == REPERE
    assert "en_cours" not in remise["deroule"][1]

    # Une scène d'avant le repère (sans le champ) se relit telle quelle.
    assert "en_cours" not in client.get(f"/api/seances/{s['id']}").json()["deroule"][0]


def test_le_repere_ne_part_pas_vers_la_tv(client):
    deroule = copy.deepcopy(DEROULE)
    deroule[1]["en_cours"] = REPERE
    s = client.post("/api/seances", json={"nom": "Le retour", "numero": 22, "deroule": deroule, "close": True,
                                          "precedemment": "Ils sont rentrés à l'auberge."}).json()
    for url in (f"/api/table/precedemment/{J('seances', s['id'])}", f"/api/table/episode/{J('seances', s['id'])}"):
        r = client.get(url)
        assert r.status_code == 200
        for interdit in ("en_cours", REPERE, "19:15", "deroule", "La rixe"):
            assert interdit not in r.text, f"{url} : {interdit}"


def test_le_geste_ne_montre_ni_carton_ni_combat():
    """Les cartons des PNJ restent à leur bouton, la rencontre ne se lance pas : le geste n'en touche aucun."""
    jeu = (JS / "seances" / "jouer-scene.js").read_text(encoding="utf-8")
    code = re.sub(r"//[^\n]*", "", jeu)
    for interdit in ("pnj", "rencontre", "/combat"):
        assert interdit not in code, interdit
    assert not re.search(r"\bapi\.(get|put|post|patch|del)\(", code), "les envois passent par seances.js"
    seances = (JS / "seances" / "seances.js").read_text(encoding="utf-8")
    geste = re.search(r'if \(a === "scene-jouer" && s\) \{(.*?)\n      \}\n', seances, flags=re.S).group(1)
    assert "pnj" not in geste and "combat" not in geste
    assert "noterAuJournal(s.id, texte)" in geste and "vuePlan(p)" in geste
