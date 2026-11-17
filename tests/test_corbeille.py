"""La corbeille et les versions (corbeille.py) : remettre une fiche jetée, revenir à une version gardée, ramener une
ligne retirée du journal ; rien de cela depuis la table publique ni le coin des joueurs."""

import json
import os
import sys
import tempfile
import time
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import joueurs  # noqa: E402
import main  # noqa: E402
from api import application, campagne_api, config, portier  # noqa: E402

CF = {"CF-Connecting-IP": "203.0.113.7"}


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture
def sans_delai(monkeypatch):
    """Chaque enregistrement garde sa version (d'ordinaire, une toutes les cinq minutes au plus)."""
    monkeypatch.setattr(config, "ARCHIVE_DELAI", -1)


def jetees(client, collection, ident):
    return [x for x in client.get("/api/corbeille").json()["elements"] if x["collection"] == collection and x["id"] == ident]


def test_la_corbeille_liste_puis_annuler_remet_la_fiche_telle_quelle(client):
    p = client.post("/api/pnj", json={"nom": "Gaspard Lenoir", "role": "Passeur", "secret": "Doit trois mois au guet"}).json()
    assert client.delete(f"/api/pnj/{p['id']}").json() == {"ok": True}
    [x] = jetees(client, "pnj", p["id"])
    assert x["nom"] == "Gaspard Lenoir" and x["detail"] == "Passeur" and not x["repris"] and x["jete"][:4].isdigit()
    r = client.post(f"/api/corbeille/pnj/{p['id']}/annuler")
    assert r.status_code == 200 and r.json()["id"] == p["id"] and not r.json()["a_cote"]
    revenu = client.get(f"/api/pnj/{p['id']}").json()
    assert revenu == p
    assert not jetees(client, "pnj", p["id"])
    assert client.post(f"/api/corbeille/pnj/{p['id']}/annuler").status_code == 404


def test_deux_fiches_du_meme_identifiant_jetees_dans_la_meme_seconde_restent_toutes_deux(client, monkeypatch):
    """Jetée, refaite sous le même identifiant, rejetée dans la même seconde : la seconde ne s'écrit pas par-dessus la
    première, et « Annuler » ramène la dernière jetée."""
    from contenu import corbeille
    from datetime import datetime

    class Fige(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 11, 4, 21, 43, 0)

    monkeypatch.setattr(corbeille, "datetime", Fige)
    premiere = client.post("/api/pnj", json={"nom": "Ombeline Sauge", "role": "Herboriste"}).json()
    client.delete(f"/api/pnj/{premiere['id']}")
    seconde = client.post("/api/pnj", json={"nom": "Ombeline Sauge", "role": "Passeuse"}).json()
    assert seconde["id"] == premiere["id"]
    client.delete(f"/api/pnj/{seconde['id']}")
    jetes = jetees(client, "pnj", premiere["id"])
    assert sorted(x["detail"] for x in jetes) == ["Herboriste", "Passeuse"]
    assert sorted(x["fichier"] for x in jetes) == [f"{premiere['id']}-20261104-214300", f"{premiere['id']}-20261104-214301"]
    assert client.post(f"/api/corbeille/pnj/{premiere['id']}/annuler").json()["id"] == premiere["id"]
    assert client.get(f"/api/pnj/{premiere['id']}").json()["role"] == "Passeuse"
    [reste] = jetees(client, "pnj", premiere["id"])
    assert reste["detail"] == "Herboriste"
    client.delete(f"/api/pnj/{premiere['id']}")


def test_annuler_ne_confond_pas_deux_identifiants_voisins(client):
    a = client.post("/api/lieux", json={"nom": "Gué"}).json()
    b = client.post("/api/lieux", json={"nom": "Gué"}).json()
    assert b["id"].startswith(f"{a['id']}-")
    client.delete(f"/api/lieux/{b['id']}")
    client.delete(f"/api/lieux/{a['id']}")
    assert client.post(f"/api/corbeille/lieux/{a['id']}/annuler").json()["id"] == a["id"]
    assert client.get(f"/api/lieux/{b['id']}").status_code == 404
    assert client.post(f"/api/corbeille/lieux/{b['id']}/annuler").json()["id"] == b["id"]
    # Deux lieux inconnus nommés « Gué » retiendraient les textes des tests suivants qui citent le Gué.
    for lieu in (a, b):
        client.delete(f"/api/lieux/{lieu['id']}")


def test_remettre_quand_l_identifiant_est_repris(client):
    ancien = client.post("/api/boutiques", json={"nom": "L'Échoppe du Gué", "accroche": "Tout pour la route"}).json()
    client.delete(f"/api/boutiques/{ancien['id']}")
    nouveau = client.post("/api/boutiques", json={"nom": "L'Échoppe du Gué", "accroche": "La nouvelle"}).json()
    assert nouveau["id"] == ancien["id"]
    [x] = jetees(client, "boutiques", ancien["id"])
    assert x["repris"] and x["repris_par"] == "L'Échoppe du Gué"
    r = client.post(f"/api/corbeille/boutiques/{x['fichier']}/remettre", json={})
    assert r.status_code == 409 and "identifiant" in r.json()["detail"]
    r = client.post(f"/api/corbeille/boutiques/{x['fichier']}/remettre", json={"a_cote": True})
    assert r.status_code == 200 and r.json()["a_cote"] and r.json()["id"] != ancien["id"]
    remise = client.get(f"/api/boutiques/{r.json()['id']}").json()
    assert remise["accroche"] == "Tout pour la route" and remise["id"] == r.json()["id"]
    assert client.get(f"/api/boutiques/{ancien['id']}").json()["accroche"] == "La nouvelle"


def test_une_regle_remise_revient_au_carnet_des_joueurs(client):
    r = client.post("/api/regles-maison", json={"titre": "Le feu qui ronge", "texte": "1 point par tour dans les flammes.",
                                                "statut": "en-vigueur", "publique": True}).json()
    publiees = lambda: [e["titre"] for e in json.loads(campagne_api.CARNET_REGLES.read_text())["elements"]]  # noqa: E731
    assert "Le feu qui ronge" in publiees()
    client.delete(f"/api/regles-maison/{r['id']}")
    assert "Le feu qui ronge" not in publiees()
    client.post(f"/api/corbeille/regles-maison/{r['id']}/annuler")
    assert "Le feu qui ronge" in publiees()


def test_versions_d_une_fiche_et_retour_qui_garde_l_actuelle(client, sans_delai):
    lieu = client.post("/api/lieux", json={"nom": "Grange-Noire", "resume": "Une ferme incendiée", "connu": False}).json()
    for texte in ("La grange tient encore", "Plus rien ne tient"):
        time.sleep(1.05)  # une version par seconde au plus : son nom est l'heure de l'archivage
        f = client.get(f"/api/lieux/{lieu['id']}").json()
        f["resume"] = texte
        f["version_base"] = f["modifie"]
        assert client.put(f"/api/lieux/{lieu['id']}", json=f).status_code == 200
    v = client.get(f"/api/versions/lieux/{lieu['id']}").json()
    assert v["nom"] == "Grange-Noire" and len(v["versions"]) == 2
    plus_ancienne = v["versions"][-1]["version"]
    assert client.get(f"/api/versions/lieux/{lieu['id']}/{plus_ancienne}").json()["resume"] == "Une ferme incendiée"
    r = client.post(f"/api/versions/lieux/{lieu['id']}/{plus_ancienne}/remettre").json()
    assert r["fiche"]["resume"] == "Une ferme incendiée" and r["fiche"]["id"] == lieu["id"]
    assert client.get(f"/api/lieux/{lieu['id']}").json()["resume"] == "Une ferme incendiée"
    apres = client.get(f"/api/versions/lieux/{lieu['id']}").json()["versions"]
    assert len(apres) == 3
    assert client.get(f"/api/versions/lieux/{lieu['id']}/{r['gardee']}").json()["resume"] == "Plus rien ne tient"
    # Revenir en arrière du retour : la version d'avant revient, rien ne s'est perdu.
    client.post(f"/api/versions/lieux/{lieu['id']}/{r['gardee']}/remettre")
    assert client.get(f"/api/lieux/{lieu['id']}").json()["resume"] == "Plus rien ne tient"


def test_revenir_a_une_version_ne_touche_ni_au_journal_ni_au_combat(client, sans_delai):
    s = client.post("/api/seances", json={"nom": "La Ferme", "objectif": "Premier objectif"}).json()
    f = client.get(f"/api/seances/{s['id']}").json()
    f["objectif"] = "Objectif revu"
    f["version_base"] = f["modifie"]
    client.put(f"/api/seances/{s['id']}", json=f)
    client.post(f"/api/seances/{s['id']}/journal", json={"texte": "Les brigands fuient vers la grange."})
    [version] = client.get(f"/api/versions/seances/{s['id']}").json()["versions"]
    client.post(f"/api/versions/seances/{s['id']}/{version['version']}/remettre")
    revenue = client.get(f"/api/seances/{s['id']}").json()
    assert revenue["objectif"] == "Premier objectif"
    assert [j["texte"] for j in revenue["journal"]] == ["Les brigands fuient vers la grange."]


def test_revenir_garde_les_illustrations_du_jour(client, sans_delai):
    from PIL import Image
    Image.new("RGB", (8, 8), (200, 180, 120)).save(config.IMAGES / "berthe-corbeille.png")
    url = "/media/berthe-corbeille.png"
    p = client.post("/api/pnj", json={"nom": "Berthe", "voix": "Rauque"}).json()
    f = client.get(f"/api/pnj/{p['id']}").json()
    f["voix"] = "Douce"
    f["version_base"] = f["modifie"]
    client.put(f"/api/pnj/{p['id']}", json=f)
    client.post(f"/api/pnj/{p['id']}/illustrations", json={"url": url})
    [version] = client.get(f"/api/versions/pnj/{p['id']}").json()["versions"]
    client.post(f"/api/versions/pnj/{p['id']}/{version['version']}/remettre")
    revenue = client.get(f"/api/pnj/{p['id']}").json()
    assert revenue["voix"] == "Rauque" and revenue["illustration"] == url


def test_une_ligne_retiree_du_journal_revient_a_sa_place(client):
    s = client.post("/api/seances", json={"nom": "Le Moulin"}).json()
    for t in ("On arrive au moulin.", "Basile ment sur la farine.", "Vortan fouille la meule."):
        lignes = client.post(f"/api/seances/{s['id']}/journal", json={"texte": t}).json()["journal"]
    retiree = lignes[1]
    client.delete(f"/api/seances/{s['id']}/journal/{retiree['id']}")
    corps = {"ligne": retiree, "apres": lignes[0]["id"], "rang": 1}
    revenu = client.post(f"/api/seances/{s['id']}/journal/remettre", json=corps).json()["journal"]
    assert revenu == lignes
    # Deux clics : la ligne ne revient qu'une fois.
    assert client.post(f"/api/seances/{s['id']}/journal/remettre", json=corps).json()["journal"] == lignes
    # La ligne d'avant a disparu entre-temps : le rang suffit.
    client.delete(f"/api/seances/{s['id']}/journal/{retiree['id']}")
    client.delete(f"/api/seances/{s['id']}/journal/{lignes[0]['id']}")
    revenu = client.post(f"/api/seances/{s['id']}/journal/remettre", json=corps).json()["journal"]
    assert [j["texte"] for j in revenu] == ["Vortan fouille la meule.", "Basile ment sur la farine."]
    assert client.post(f"/api/seances/{s['id']}/journal/remettre", json={"ligne": {"texte": " "}}).status_code == 400


@pytest.mark.parametrize("methode,chemin", [
    ("get", "/api/corbeille/inconnue"), ("get", "/api/versions/inconnue/x"), ("get", "/api/versions/pnj/..%2Fsecret"),
    ("get", "/api/versions/pnj/gaspard/pas-une-date"), ("post", "/api/corbeille/pnj/pas-un-fichier/remettre"),
    ("post", "/api/corbeille/joueurs/x-20261104-120000/remettre"), ("post", "/api/corbeille/pnj/NOM/annuler"),
])
def test_entrees_invalides(client, methode, chemin):
    assert getattr(client, methode)(chemin).status_code in (400, 404, 405)


@pytest.mark.parametrize("methode,chemin", [
    ("get", "/api/corbeille"), ("post", "/api/corbeille/pnj/x-20261104-120000/remettre"),
    ("post", "/api/corbeille/pnj/x/annuler"), ("get", "/api/versions/pnj/x"), ("get", "/api/versions/pnj/x/20261104-120000"),
    ("post", "/api/versions/pnj/x/20261104-120000/remettre"), ("post", "/api/seances/x/journal/remettre"),
])
def test_ferme_a_la_table_publique_et_au_coin_des_joueurs(client, monkeypatch, methode, chemin):
    assert getattr(client, methode)(chemin, headers=CF).status_code == 404
    monkeypatch.setattr(joueurs, "DEPOT", config.PROPOSITIONS)
    monkeypatch.setattr(joueurs, "HOTES", set())
    with TestClient(joueurs.app) as coin:
        assert getattr(coin, methode)(chemin).status_code in (401, 404, 405)


def test_ferme_a_l_atelier_en_ligne_sans_session(client, monkeypatch):
    monkeypatch.setattr(portier, "ATELIER_PUBLIC", {"atelier.example.ch"})
    monkeypatch.setattr(portier, "HOTES", portier.HOTES | {"atelier.example.ch"})
    monkeypatch.setattr(portier, "EMPREINTE_MDP", "scrypt:1024:8:1:00:00")
    monkeypatch.setattr(portier, "CLE_SESSION", b"cle")
    h = {"Host": "atelier.example.ch", "CF-Connecting-IP": "203.0.113.9"}
    assert client.get("/api/corbeille", headers=h).status_code == 401
    assert client.get("/api/versions/pnj/x", headers=h).status_code == 401
