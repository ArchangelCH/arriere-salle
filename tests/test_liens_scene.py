"""Les liens d'une scène du déroulé (plan, PNJ, rencontre, ambiance) : gardés tels quels avec la séance, jamais envoyés
à la TV, et la musique d'une scène ne part que d'un clic du MJ."""

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
from sources_front import source_page  # noqa: E402

J = tv_cartes.jeton
JS = Path(__file__).resolve().parent.parent / "app" / "static" / "js"


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


DEROULE = [
    {"heure": "15:15", "titre": "La Grange-Noire, avec O4 Le guetteur", "duree": 40, "note": "Normal pour trois.",
     "liens": {"plan": "PLAN-MJ", "pnj": ["PNJ-CACHE-MJ"], "rencontre": "RENCONTRE-MJ", "ambiance": "AMBIANCE-MJ"}},
    {"heure": "15:55", "titre": "Le Pinson", "duree": 10, "note": ""},
]


def test_les_liens_d_une_scene_restent_avec_la_seance(client):
    s = client.post("/api/seances", json={"nom": "Les liens", "numero": 7, "deroule": DEROULE}).json()
    assert s["deroule"] == DEROULE
    # Le journal s'écrit par sa route : la séance garde son déroulé et ses liens.
    assert client.post(f"/api/seances/{s['id']}/journal", json={"texte": "Ils entrent dans la grange."}).json()["deroule"] == DEROULE
    # La scène cochée dans Jouer, l'enregistrement de la fiche entière : le texte et les liens ne bougent pas.
    lue = client.get(f"/api/seances/{s['id']}").json()
    lue["deroule"][0]["fait"] = True
    remise = client.put(f"/api/seances/{s['id']}", json={**lue, "version_base": lue["modifie"]}).json()
    assert remise["deroule"][0] == {**DEROULE[0], "fait": True}
    assert remise["deroule"][1] == DEROULE[1]


def test_les_liens_d_une_scene_ne_partent_pas_vers_la_tv(client):
    s = client.post("/api/seances", json={"nom": "Le retour", "numero": 8, "deroule": DEROULE, "close": True,
                                          "precedemment": "Ils sont rentrés à l'auberge."}).json()
    for url in (f"/api/table/precedemment/{J('seances', s['id'])}", f"/api/table/episode/{J('seances', s['id'])}"):
        r = client.get(url)
        assert r.status_code == 200
        for interdit in ("PLAN-MJ", "PNJ-CACHE-MJ", "RENCONTRE-MJ", "AMBIANCE-MJ", "liens", "guetteur"):
            assert interdit not in r.text, f"{url} : {interdit}"


def test_la_musique_d_une_scene_ne_part_que_d_un_clic():
    """jouerAmbiance n'a que trois appelants : deux clics du MJ dans Jouer (« Lancer l'ambiance » et « Jouer la scène »)
    et la télécommande (commanderMusique), quand le MJ touche une ambiance sur son téléphone. Ni la TV ni le redessin de
    l'onglet n'y mènent. La musique des combats (musique-combat.js) ne passe pas par lui : elle change seulement ce qui
    joue déjà (outils/verifier_musique_combat.mjs)."""
    appels = {}
    for f in JS.rglob("*.js"):
        n = len(re.findall(r"\bjouerAmbiance\(", f.read_text(encoding="utf-8")))
        if n:
            appels[f.relative_to(JS).as_posix()] = n
    assert appels == {"musique/musique.js": 2, "seances/seances.js": 2}
    musique = (JS / "musique/musique.js").read_text(encoding="utf-8")
    assert re.search(r"export async function commanderMusique\(action, id\) \{[^}]*return jouerAmbiance\(id\)", musique)
    importeurs = {f.relative_to(JS).as_posix() for f in JS.rglob("*.js") if "commanderMusique" in f.read_text(encoding="utf-8")}
    assert importeurs == {"musique/musique.js", "ecran-tv/relais-telecommande.js"}
    seances = (JS / "seances" / "seances.js").read_text(encoding="utf-8")
    bloc = re.search(r'if \(a === "ambiance-jouer"\) \{(.*?)\n      \}\n', seances, flags=re.S)
    assert bloc and "jouerAmbiance(b.dataset.ambiance)" in bloc.group(1)
    geste = re.search(r'if \(a === "scene-jouer" && s\) \{(.*?)\n      \}\n', seances, flags=re.S)
    assert geste and "jouerAmbiance(id)" in geste.group(1)
    liens = (JS / "seances" / "liens-scene.js").read_text(encoding="utf-8")
    assert "musique.js" not in liens and "api.put" not in liens and "api.post" not in liens
    jeu = (JS / "seances" / "jouer-scene.js").read_text(encoding="utf-8")
    # Deux imports seulement : l'échappement, et le test sans réseau d'un plan tout noir (tv-commun.js).
    for permis in ('import { echapper as e } from "../api.js";', 'import { rienDeRevele } from "../ecran-tv/tv-commun.js";'):
        jeu = jeu.replace(permis, "")
    assert "import" not in jeu
    commun = (JS / "ecran-tv/tv-commun.js").read_text(encoding="utf-8")
    assert "import " not in commun and "api." not in commun and "fetch(" not in commun
    combats = (JS / "musique/musique-combat.js").read_text(encoding="utf-8")
    assert "jouerAmbiance" not in combats and combats.count(".choisir(") == 1
    table = source_page("table")
    assert "musique" not in table and "liens-scene" not in table
