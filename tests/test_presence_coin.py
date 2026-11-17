"""Qui est au coin des joueurs (presence.py, flux_coin.py, salle.py) : la liste se publie à l'ouverture et à la fermeture
des flux, regroupée, avec un délai de grâce au départ ; le coin la tient à jour tant que quelqu'un est là ; un fichier
trop vieux ne nomme plus personne ; rien d'autre que des identifiants et l'heure dans presence/ ; l'atelier ne retient
que ses joueurs invités, avec leur prénom et leur héros, et le sait par son canal."""
import asyncio
import json
import os
import sys
import tempfile
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from commun import flux_coin  # noqa: E402
import joueurs  # noqa: E402
from commun import presence  # noqa: E402
from comptes_coin import entrer as entrer_au_coin  # noqa: E402
import main  # noqa: E402
from api import application, config  # noqa: E402

FICHIER = presence.chemin(config.PROPOSITIONS)


@pytest.fixture(scope="module")
def atelier():
    with TestClient(application.app) as c:
        yield c
    FICHIER.unlink(missing_ok=True)


@pytest.fixture()
def coin(monkeypatch):
    monkeypatch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    monkeypatch.setattr(joueurs, "COOKIE_SUR", False)
    monkeypatch.setattr(joueurs, "HOTES", set())
    monkeypatch.setattr(flux_coin, "BATTEMENT", 0.2)
    monkeypatch.setattr(flux_coin, "DUREE_MAX", 2.0)
    monkeypatch.setattr(presence, "GRACE", 0.3)
    with TestClient(joueurs.app) as c:
        yield c
    joueurs.FLUX.abonnes.clear()
    joueurs.FLUX.partis.clear()


@pytest.fixture()
def invites(atelier):
    crees = []

    def inviter(nom):
        j = atelier.post("/api/joueurs", json={"nom": nom}).json()
        crees.append(j["id"])
        return j
    yield inviter
    for ident in crees:
        atelier.delete(f"/api/joueurs/{ident}")
    FICHIER.unlink(missing_ok=True)


def entrer(client, j):
    cle = j["id"]
    entrer_au_coin(client, cle)


def lire_fichier(depot: Path):
    try:
        return json.loads(presence.chemin(depot).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def attendre(condition, delai=4.0):
    fin = time.monotonic() + delai
    while time.monotonic() < fin:
        if condition():
            return True
        time.sleep(0.05)
    return False


# ---------------------------------------------------------------- le coin publie

def test_la_presence_suit_les_flux(monkeypatch, tmp_path):
    monkeypatch.setattr(presence, "GRACE", 0.4)
    monkeypatch.setattr(flux_coin, "REGROUPEMENT_PRESENCE", 0.05)

    async def essai():
        f = flux_coin.Flux(lambda: tmp_path)
        relevés = []

        async def noter(etiquette, pause=0.25):
            await asyncio.sleep(pause)
            relevés.append((etiquette, (lire_fichier(tmp_path) or {}).get("joueurs")))
        f.demarrer()
        lea = f.ouvrir("lea")
        await noter("lea arrive")
        lea2 = f.ouvrir("lea")
        max_ = f.ouvrir("max")
        await noter("max arrive, Léa ouvre une seconde page")
        f.fermer("lea", lea)
        await noter("Léa ferme une de ses pages", 0.1)
        f.fermer("lea", lea2)
        await noter("Léa ferme sa dernière page : la grâce", 0.1)
        await noter("la grâce passée", 0.5)
        lea3 = f.ouvrir("lea")
        f.fermer("lea", lea3)
        await noter("une page rechargée ne fait pas partir Léa", 0.15)
        f.fermer("max", max_)
        await noter("tout le monde est parti", 0.7)
        f.tache.cancel()
        f.tache_presence.cancel()
        return relevés

    relevés = asyncio.run(essai())
    assert relevés == [("lea arrive", ["lea"]), ("max arrive, Léa ouvre une seconde page", ["lea", "max"]),
                       ("Léa ferme une de ses pages", ["lea", "max"]), ("Léa ferme sa dernière page : la grâce", ["lea", "max"]),
                       ("la grâce passée", ["max"]), ("une page rechargée ne fait pas partir Léa", ["lea", "max"]),
                       ("tout le monde est parti", [])], relevés


def test_le_coin_tient_le_fichier_a_jour(monkeypatch, tmp_path):
    monkeypatch.setattr(presence, "BATTEMENT", 0.4)
    monkeypatch.setattr(presence, "GRACE", 0.3)
    monkeypatch.setattr(flux_coin, "REGROUPEMENT_PRESENCE", 0.05)

    async def essai():
        f = flux_coin.Flux(lambda: tmp_path)
        f.demarrer()
        q = f.ouvrir("lea")
        await asyncio.sleep(0.2)
        avant = presence.chemin(tmp_path).stat().st_mtime_ns
        await asyncio.sleep(0.6)
        apres = presence.chemin(tmp_path).stat().st_mtime_ns
        f.fermer("lea", q)
        await asyncio.sleep(presence.GRACE + 0.3)
        vide = presence.chemin(tmp_path).stat().st_mtime_ns
        await asyncio.sleep(0.9)
        # Personne : plus rien à republier.
        encore = presence.chemin(tmp_path).stat().st_mtime_ns
        f.tache.cancel()
        f.tache_presence.cancel()
        return avant, apres, vide, encore

    avant, apres, vide, encore = asyncio.run(essai())
    assert apres > avant and vide > apres and encore == vide
    assert lire_fichier(tmp_path)["joueurs"] == []


# ---------------------------------------------------------------- le fichier : vieilli, et rien d'autre

def ecrire_brut(depot: Path, contenu):
    presence.chemin(depot).parent.mkdir(parents=True, exist_ok=True)
    presence.chemin(depot).write_text(contenu if isinstance(contenu, str) else json.dumps(contenu), encoding="utf-8")


def test_un_fichier_vieilli_ne_nomme_personne(tmp_path):
    instant = datetime(2026, 11, 8, 20, 0, 0)
    vers = lambda s: (instant - timedelta(seconds=s)).isoformat(timespec="seconds")  # noqa: E731
    ecrire_brut(tmp_path, {"maj": vers(5), "joueurs": ["lea", "max"]})
    assert presence.lire(tmp_path, instant) == {"joueurs": ["lea", "max"], "maj": vers(5), "a_jour": True}
    # Le coin s'est arrêté sans le dire : son dernier fichier ne fait croire à personne que la tablée est là.
    ecrire_brut(tmp_path, {"maj": vers(presence.PERIME + 1), "joueurs": ["lea", "max"]})
    assert presence.lire(tmp_path, instant) == {"joueurs": [], "maj": vers(presence.PERIME + 1), "a_jour": False}
    # Vieux et vide : il dit vrai (le coin ne republie rien quand personne n'est là).
    ecrire_brut(tmp_path, {"maj": vers(3600), "joueurs": []})
    assert presence.lire(tmp_path, instant)["a_jour"] is True
    # D'une autre forme, trop lourd, illisible : personne.
    for brut in ({"maj": vers(1), "joueurs": ["lea"], "noms": ["Léa"]}, {"maj": vers(1), "joueurs": "lea"},
                 {"maj": "hier", "joueurs": ["lea"]}, "pas du json", json.dumps({"maj": vers(1), "joueurs": ["x" * 10] * 2000})):
        ecrire_brut(tmp_path, brut)
        assert presence.lire(tmp_path, instant)["joueurs"] == [], brut
    # Un identifiant qui n'en est pas un ne passe pas.
    ecrire_brut(tmp_path, {"maj": vers(1), "joueurs": ["lea", "../carnet", "Max Dupont", 3]})
    assert presence.lire(tmp_path, instant)["joueurs"] == ["lea"]


def test_l_atelier_ne_croit_pas_un_vieux_fichier(atelier, invites):
    j = invites("Vieux fichier")
    ecrire_brut(config.PROPOSITIONS, {"maj": datetime.now().isoformat(timespec="seconds"), "joueurs": [j["id"], "inconnu-du-mj"]})
    v = atelier.get("/api/salle").json()
    # Seuls les joueurs invités par le MJ, avec leur prénom.
    assert [x["joueur"] for x in v["en_ligne"]] == [j["id"]] and v["en_ligne"][0]["nom"] == "Vieux fichier"
    assert v["presence"]["a_jour"] is True
    vieux = (datetime.now() - timedelta(seconds=presence.PERIME + 5)).isoformat(timespec="seconds")
    ecrire_brut(config.PROPOSITIONS, {"maj": vieux, "joueurs": [j["id"]]})
    v = atelier.get("/api/salle").json()
    assert v["en_ligne"] == [] and v["presence"] == {"a_jour": False, "maj": vieux}


def test_rien_d_autre_que_des_identifiants_dans_presence(atelier, coin, invites):
    lea = invites("Léa-présente")
    entrer(coin, lea)
    vus = []

    def guetter():
        attendre(lambda: (lire_fichier(config.PROPOSITIONS) or {}).get("joueurs") == [lea["id"]], 3)
        vus.append(lire_fichier(config.PROPOSITIONS))
        vus.append(atelier.get("/api/salle").json())
    t = threading.Thread(target=guetter)
    t.start()
    r = coin.get("/api/flux")
    t.join()
    assert r.status_code == 200
    fichier, vue = vus
    assert fichier["joueurs"] == [lea["id"]] and set(fichier) == {"maj", "joueurs"}
    # L'atelier le voit, avec le prénom.
    assert [(x["joueur"], x["nom"]) for x in vue["en_ligne"]] == [(lea["id"], "Léa-présente")]
    # La page fermée, la grâce passée : plus personne.
    assert attendre(lambda: (lire_fichier(config.PROPOSITIONS) or {}).get("joueurs") == [], 3)
    assert attendre(lambda: atelier.get("/api/salle").json()["en_ligne"] == [], 3)
    # Dans presence/, ce seul fichier : ni prénom, ni lien, ni cookie, ni adresse ; lisible par l'atelier, sans plus.
    dossier = config.PROPOSITIONS / presence.DOSSIER
    assert sorted(p.name for p in dossier.iterdir()) == [presence.FICHIER]
    brut = presence.chemin(config.PROPOSITIONS).read_text(encoding="utf-8")
    assert "Léa" not in brut and "cle" not in brut and "testclient" not in brut and "aventurier" not in brut
    assert presence.chemin(config.PROPOSITIONS).stat().st_mode & 0o777 == 0o644
    # Rien de nouveau à la racine des propositions (elle est lue comme des héros proposés).
    assert not (config.PROPOSITIONS / presence.FICHIER).exists()


def test_le_canal_de_l_atelier_porte_la_presence(atelier, invites):
    j = invites("Canal présence")
    recus = []
    with atelier.websocket_connect("/ws/atelier") as ws:
        assert json.loads(ws.receive_text())["type"] == "etat"

        def ecouter():
            while True:
                try:
                    m = json.loads(ws.receive_text())
                except Exception:
                    return
                recus.append(m)
                if m.get("type") == "salle" and any(x["joueur"] == j["id"] for x in m["en_ligne"]):
                    return
        t = threading.Thread(target=ecouter, daemon=True)
        t.start()
        time.sleep(0.2)
        presence.ecrire(config.PROPOSITIONS, [j["id"]])
        t.join(3)
    m = next((m for m in recus if m.get("type") == "salle" and m["en_ligne"]), None)
    assert m is not None, recus
    assert m["en_ligne"][0]["nom"] == "Canal présence"


def test_les_modules_de_la_salle_restent_a_l_atelier(coin):
    import re
    statique = Path(joueurs.__file__).resolve().parent / "static"
    source = (statique / "js/joueurs/main-levee.js").read_text(encoding="utf-8")
    # Le bouton du coin ne parle qu'à /api/main, et n'importe que le flux.
    assert re.findall(r'^import\b[^;]*?from\s+"([^"]+)"', source, flags=re.M) == ["./flux.js"]
    assert set(re.findall(r'"(/api/[^"]*)"', source)) == {"/api/main"}
