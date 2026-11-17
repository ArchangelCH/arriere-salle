import base64
import re
import json
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, config, tv_cartes  # noqa: E402
from PIL import Image, PngImagePlugin  # noqa: E402

# Le dossier des données de main tel qu'il a été importé : par un essai lancé avant celui-ci (un fichier « test_a… »),
# l'ordre des fichiers ne compte plus.
DOSSIER = str(config.DONNEES)

J = tv_cartes.jeton


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def media(nom, taille=(8, 8), couleur=(200, 180, 120)):
    """Une vraie petite image dans /media, pour les routes qui vérifient que l'illustration existe."""
    Image.new("RGB", taille, couleur).save(Path(DOSSIER) / "images" / nom)
    return f"/media/{nom}"


def carte_vide(nom, marqueurs=(), traces=(), etiquettes=()):
    return {
        "nom": nom,
        "largeur": 10,
        "hauteur": 8,
        "km_case": 1,
        "terrain": base64.b64encode(bytes(80)).decode(),
        "brouillard": base64.b64encode(bytes(80)).decode(),
        "marqueurs": list(marqueurs),
        "traces": list(traces),
        "etiquettes": list(etiquettes),
        "notes": "notes du MJ sur la carte",
    }


def test_la_table_ne_recoit_jamais_les_secrets(client):
    public = client.post("/api/lieux", json={"nom": "Clairefonds", "type": "capitale", "connu": True, "resume": "Cité de la Lumière", "secrets": "SECRET-PUITS", "notes": "NOTE-MJ"}).json()
    cache = client.post("/api/lieux", json={"nom": "Le nid", "type": "grotte", "connu": False, "resume": "NID-CACHE", "secrets": "SECRET-NID"}).json()
    carte = client.post("/api/cartes", json=carte_vide(
        "Essai table",
        marqueurs=[{"id": "a", "lieu": public["id"], "x": 2, "y": 2}, {"id": "b", "lieu": cache["id"], "x": 5, "y": 5}, {"id": "c", "lieu": public["id"], "x": 6, "y": 6, "cache": True}],
        traces=[{"id": "t1", "type": "route", "points": [[0, 0], [3, 3]]}, {"id": "t2", "type": "chemin", "points": [[1, 1], [4, 4]], "cache": True}],
        etiquettes=[{"id": "e1", "texte": "Visible"}, {"id": "e2", "texte": "ETIQUETTE-CACHEE", "cache": True}],
    )).json()
    # La TV ne connaît la carte que par un jeton : l'identifiant (tiré du nom d'origine) ne lui sert pas d'adresse.
    assert client.get(f"/api/table/carte/{carte['id']}").status_code == 404
    reponse = client.get(f"/api/table/carte/{J('cartes', carte['id'])}")
    assert reponse.status_code == 200
    texte = reponse.text
    for interdit in ("SECRET-PUITS", "NOTE-MJ", "SECRET-NID", "NID-CACHE", "ETIQUETTE-CACHEE", "notes du MJ", '"clairefonds"', '"essai-table"'):
        assert interdit not in texte
    donnees = reponse.json()
    assert [(m["x"], m["y"], m["lieu"]) for m in donnees["marqueurs"]] == [(2, 2, J("lieux", public["id"]))]
    assert all("id" not in m for m in donnees["marqueurs"])
    assert [t["type"] for t in donnees["traces"]] == ["route"]
    assert set(donnees["lieux"]) == {J("lieux", public["id"])}

    lieu = client.get(f"/api/table/lieu/{J('lieux', public['id'])}").json()
    assert "secrets" not in lieu and "notes" not in lieu and lieu["id"] == J("lieux", public["id"])
    client.post(f"/api/lieux/{public['id']}/illustrations", json={"url": media("clairefonds.jpg"), "prompt": "PROMPT-DU-MJ"})
    assert "PROMPT-DU-MJ" not in client.get(f"/api/table/lieu/{J('lieux', public['id'])}").text
    assert "PROMPT-DU-MJ" not in client.get(f"/api/table/carte/{J('cartes', carte['id'])}").text
    assert client.get(f"/api/table/lieu/{J('lieux', cache['id'])}").status_code == 404
    assert client.get(f"/api/table/lieu/{public['id']}").status_code == 404


def test_brouillard_et_groupe_de_la_carte(client):
    lieu = client.post("/api/lieux", json={"nom": "Sous la brume", "connu": True}).json()
    brume = bytearray(80)
    brume[2 * 10 + 2] = 1  # seule la case (2, 2) est connue des joueurs
    c = carte_vide("Brumeuse", marqueurs=[{"id": "a", "lieu": lieu["id"], "x": 2.5, "y": 2.5}, {"id": "b", "lieu": lieu["id"], "x": 7, "y": 7}],
                   etiquettes=[{"id": "e1", "texte": "VUE", "x": 2.2, "y": 2.8}, {"id": "e2", "texte": "SOUS-LA-BRUME", "x": 8, "y": 1}])
    c |= {"brouillard": base64.b64encode(bytes(brume)).decode(), "brouillard_actif": True,
          "groupe": {"visible": True, "montrer": False, "x": 7, "y": 7, "trajet": [[1, 1], [7, 7]]}}
    carte = client.post("/api/cartes", json=c).json()
    pub = client.get(f"/api/table/carte/{J('cartes', carte['id'])}").json()
    assert [m["x"] for m in pub["marqueurs"]] == [2.5] and [e["texte"] for e in pub["etiquettes"]] == ["VUE"]
    assert "groupe" not in pub


def test_une_fiche_ouverte_n_efface_pas_les_illustrations(client):
    lieu = client.post("/api/lieux", json={"nom": "La Petite Fanfrelée", "type": "auberge"}).json()
    avec = client.post(f"/api/lieux/{lieu['id']}/illustrations", json={"url": media("auberge.jpg")}).json()
    assert avec["illustration"] == "/media/auberge.jpg"
    # Une illustration arrivée pendant qu'un écran remplit la fiche ne le met pas en conflit.
    assert avec["modifie"] == lieu["modifie"]
    lieu["resume"] = "Une auberge"
    lieu["illustrations"] = []
    apres = client.put(f"/api/lieux/{lieu['id']}", json={**lieu, "version_base": lieu["modifie"]}).json()
    assert [i["url"] for i in apres["illustrations"]] == ["/media/auberge.jpg"]
    assert apres["resume"] == "Une auberge"
    client.post(f"/api/lieux/{lieu['id']}/illustrations", json={"url": media("auberge-nuit.jpg")})
    assert client.put(f"/api/lieux/{lieu['id']}/illustration", json={"url": "/media/auberge-nuit.jpg"}).json()["illustration"] == "/media/auberge-nuit.jpg"
    assert client.put(f"/api/lieux/{lieu['id']}/illustration", json={"url": "/media/inconnue.jpg"}).status_code == 400
    reste = client.delete(f"/api/lieux/{lieu['id']}/illustrations", params={"url": "/media/auberge-nuit.jpg"}).json()
    assert reste["illustration"] == "/media/auberge.jpg" and reste["modifie"] == apres["modifie"]
    assert client.post(f"/api/lieux/{lieu['id']}/illustrations", json={"url": "https://ailleurs/image.jpg"}).status_code == 400
    assert client.post(f"/api/lieux/{lieu['id']}/illustrations", json={"url": "/media/absente.jpg"}).status_code == 400
    # À la création, une illustration inventée n'est pas reprise.
    autre = client.post("/api/lieux", json={"nom": "Ailleurs", "illustrations": [{"url": "https://ailleurs/x.jpg"}], "illustration": "https://ailleurs/x.jpg"}).json()
    assert autre["illustrations"] == [] and autre["illustration"] is None


def test_modifier_quelques_champs(client):
    pnj = client.post("/api/pnj", json={"nom": "Gardien", "connu": False, "secret": "SECRET-GARDIEN"}).json()
    ailleurs = client.put(f"/api/pnj/{pnj['id']}", json={**pnj, "secret": "NOUVEAU-SECRET", "version_base": pnj["modifie"]}).json()
    # Montrer le PNJ depuis un écran resté sur l'ancienne version ne ramène pas l'ancien secret.
    apres = client.patch(f"/api/pnj/{pnj['id']}", json={"connu": True, "illustrations": [{"url": "x"}], "modifie": "0"}).json()
    assert apres["connu"] is True and apres["secret"] == "NOUVEAU-SECRET" and apres["illustrations"] == [] and apres["modifie"] > ailleurs["modifie"]
    assert client.patch(f"/api/pnj/{pnj['id']}", json={"connu": False, "version_base": pnj["modifie"]}).status_code == 409


def test_nom_cache_de_l_auberge(client):
    lieu = client.post("/api/lieux", json={"nom": "L'auberge de Toma", "connu": True, "resume": "On dort à la « Petite Fanfrelée » depuis dix ans."}).json()
    public = client.get(f"/api/table/lieu/{J('lieux', lieu['id'])}").json()
    assert "anfrel" not in json.dumps(public, ensure_ascii=False) and "l'auberge" in public["resume"]
    seance = client.post("/api/seances", json={"nom": "Séance 9", "precedemment": "Le groupe a dormi à la Petite-Fanfrelee. Puis il est reparti."}).json()
    recap = client.get(f"/api/table/precedemment/{J('seances', seance['id'])}").json()
    assert recap["texte"].startswith("Le groupe a dormi à l'auberge.")
    verif = client.post("/api/masque", json={"texte": "Retour chez Petite Fanfrelée"}).json()
    assert verif["trouve"] and "anfrel" not in verif["texte"]
    client.put("/api/table", json={"vue": "image", "url": media("vue.jpg"), "titre": "La Petite Fanfrelée", "lieu": lieu["id"]})
    with client.websocket_connect("/ws/table") as ws:
        etat = json.loads(ws.receive_text())["etat"]
    assert etat["titre"] == "L'auberge" and etat["url"] == "/media/vue.jpg" and etat["lieu"] == J("lieux", lieu["id"])
    client.put("/api/table", json={"vue": "image", "url": "https://ailleurs/piege.jpg", "avant": {"lieu": "secret"}})
    with client.websocket_connect("/ws/table") as ws:
        etat = json.loads(ws.receive_text())["etat"]
    assert etat["url"] is None and "avant" not in etat
    client.put("/api/table", json={"vue": "accueil"})


def test_une_image_garde_les_cartons_et_la_vue_d_avant(client):
    """Une illustration montrée par-dessus un plan (illustrations.js) : les cartons restent, la vue recouverte reste
    chez le MJ pour « Revenir au plan », et la TV ne reçoit ni cette vue ni l'identifiant du lieu."""
    lieu = client.post("/api/lieux", json={"nom": "La Petite Fanfrelée", "connu": True}).json()
    assert "fanfrelee" in lieu["id"]
    pnj = client.post("/api/pnj", json={"nom": "Lisette", "connu": True}).json()
    heros = client.post("/api/aventuriers", json={"nom": "Velora"}).json()
    camera = {"x": 3, "y": 4, "hv": 12}
    client.put("/api/table", json={
        "vue": "image", "url": media("salle.jpg"), "titre": "L'auberge de Toma", "lieu": None, "plan": "plan-essai",
        "pnj": pnj["id"], "aventurier": heros["id"], "aventurier_maj": 5,
        "avant": {"vue": "plan", "plan": "plan-essai", "camera": camera, "lieu": lieu["id"], "titre": "La Petite Fanfrelée"},
    })
    with client.websocket_connect("/ws/table") as ws:
        tv = json.loads(ws.receive_text())["etat"]
    assert tv["vue"] == "image" and tv["url"] == "/media/salle.jpg" and tv["titre"] == "L'auberge de Toma"
    assert tv["pnj"] == J("pnj", pnj["id"]) and tv["aventurier"] == J("aventuriers", heros["id"]) and tv["aventurier_maj"] == 5
    vu = json.dumps(tv, ensure_ascii=False)
    assert "avant" not in tv and tv["lieu"] is None and "anfrel" not in vu and lieu["id"] not in vu and "hv" not in vu
    assert client.get("/api/table").json()["avant"] == {"vue": "plan", "plan": "plan-essai", "camera": camera, "lieu": lieu["id"], "titre": "La Petite Fanfrelée"}
    client.put("/api/table", json={"vue": "accueil"})
    # Les fiches d'essai ne restent pas dans la tablée des tests suivants.
    for chemin in (f"/api/aventuriers/{heros['id']}", f"/api/pnj/{pnj['id']}", f"/api/lieux/{lieu['id']}"):
        client.delete(chemin)


def test_versions_archivees_et_corbeille(client):
    carte = client.post("/api/cartes", json=carte_vide("Archives")).json()
    for i in range(3):
        c = client.get(f"/api/cartes/{carte['id']}").json()
        c["nom"] = f"Archives {i}"
        c["version_base"] = c["modifie"]
        assert client.put(f"/api/cartes/{carte['id']}", json=c).status_code == 200
    versions = list((Path(DOSSIER) / "historique" / "cartes" / carte["id"]).glob("*.json"))
    assert len(versions) == 1
    assert client.delete(f"/api/cartes/{carte['id']}").json() == {"ok": True}
    assert client.get(f"/api/cartes/{carte['id']}").status_code == 404
    assert list((Path(DOSSIER) / "corbeille" / "cartes").glob(f"{carte['id']}-*.json"))


def test_identifiants(client):
    assert client.get("/api/cartes/..%2Fsecret").status_code in (400, 404)
    assert client.get("/api/cartes/NOM_INVALIDE").status_code == 400
    a = client.post("/api/lieux", json={"nom": "Élan d'Été"}).json()
    b = client.post("/api/lieux", json={"nom": "Élan d'Été"}).json()
    assert a["id"] == "elan-d-ete" and b["id"].startswith("elan-d-ete-")
    assert client.post("/api/cartes", json={"nom": "Sans terrain"}).status_code == 400


def test_etat_de_la_table(client):
    assert client.put("/api/table", json={"vue": "carte", "carte": "x", "camera": {"x": 1, "y": 2, "hv": 30}}).json()["ok"]
    etat = client.get("/api/table").json()
    assert etat["vue"] == "carte" and etat["camera"]["hv"] == 30 and "ecrans" in etat
    with client.websocket_connect("/ws/table") as ws:
        assert json.loads(ws.receive_text())["etat"]["carte"] == J("cartes", "x")
        client.put("/api/table", json={"vue": "accueil"})
        assert json.loads(ws.receive_text())["etat"]["vue"] == "accueil"


def test_requetes_etrangeres_et_entrees_invalides(client):
    assert client.put("/api/table", json={"vue": "accueil"}, headers={"Origin": "http://site-piege.example"}).status_code == 403
    assert client.put("/api/table", json={"vue": "accueil"}, headers={"Origin": "http://testserver"}).status_code == 200
    assert client.get("/api/table", headers={"Host": "rebinding.example"}).status_code == 400
    assert client.get("/api/table", headers={"Host": "192.0.2.10:8323"}).status_code == 200
    assert client.get("/docs").status_code == 404 and client.get("/openapi.json").status_code == 404
    assert client.post("/api/lieux", json=["pas", "un", "objet"]).status_code == 400
    assert client.put("/api/table", content=b"{", headers={"Content-Type": "application/json"}).status_code == 400
    lieu = client.post("/api/lieux", json={"nom": "Nombre"}).json()
    assert client.post("/api/illustrations", json={"lieu": lieu["id"], "prompt": "a", "nombre": "deux"}).status_code in (200, 429)
    contrat = client.post("/api/contrats", json={"nom": "Ordre nul", "etat": "affiche", "ordre": None}).json()
    assert client.get("/api/table/planche").status_code == 200
    client.delete(f"/api/contrats/{contrat['id']}")
    # Un fichier abîmé est ignoré au lieu de rendre la liste (et tout l'atelier) inutilisable.
    (Path(DOSSIER) / "lieux" / "abime.json").write_text("{ pas du json", encoding="utf-8")
    assert client.get("/api/lieux").status_code == 200
    (Path(DOSSIER) / "lieux" / "abime.json").unlink()


def test_televersement(client):
    faux = client.post("/api/images", files={"image": ("page.png", b"<html><script>alert(1)</script></html>", "image/png")})
    assert faux.status_code == 415
    infos = PngImagePlugin.PngInfo()
    infos.add_text("prompt", "PROMPT-DU-MJ")
    brut = __import__("io").BytesIO()
    Image.new("RGB", (16, 12), (10, 20, 30)).save(brut, "PNG", pnginfo=infos)
    r = client.post("/api/images", files={"image": ("La Petite Fanfrelee.png", brut.getvalue(), "image/png")}).json()
    assert r["url"].endswith(".png") and "fanfrel" not in r["url"].lower()
    contenu = (Path(DOSSIER) / "images" / r["nom"]).read_bytes()
    assert b"PROMPT-DU-MJ" not in contenu and Image.open(Path(DOSSIER) / "images" / r["nom"]).size == (16, 12)
    assert client.get(r["url"]).headers["x-content-type-options"] == "nosniff"


def test_file_des_illustrations(client):
    lieu = client.post("/api/lieux", json={"nom": "Tarvan", "type": "ville"}).json()
    assert client.post("/api/illustrations", json={"lieu": lieu["id"], "prompt": ""}).status_code == 400
    assert client.post("/api/illustrations", json={"lieu": "inconnu", "prompt": "a village"}).status_code == 404
    etat = client.get("/api/illustrations").json()
    assert "moteur" in etat and etat["formats"][0] == "paysage"


def test_detection_du_francais_dans_un_prompt():
    from ia.illustrations import FRANCAIS

    anglais = "A village of grey stone houses, a small chapel, a menhir with offerings, set in a rocky valley at dusk"
    francais = "village minier inondé de clartés rosées, maisons de pierre grise, linge gris accroché aux poutres"
    assert len(FRANCAIS.findall(anglais)) <= 1
    assert len(FRANCAIS.findall(francais)) > 1


def test_un_ecran_en_retard_n_ecrase_pas_la_carte(client):
    carte = client.post("/api/cartes", json=carte_vide("Deux écrans")).json()
    mac = client.get(f"/api/cartes/{carte['id']}").json()
    pc = client.get(f"/api/cartes/{carte['id']}").json()
    mac["nom"] = "Depuis le Mac"
    assert client.put(f"/api/cartes/{carte['id']}", json={**mac, "version_base": mac["modifie"]}).status_code == 200
    pc["nom"] = "Depuis le PC"
    reponse = client.put(f"/api/cartes/{carte['id']}", json={**pc, "version_base": pc["modifie"]})
    assert reponse.status_code == 409
    assert client.put(f"/api/cartes/{carte['id']}", json=pc).status_code == 409
    assert client.get(f"/api/cartes/{carte['id']}").json()["nom"] == "Depuis le Mac"


def test_carnet_de_pnj(client):
    fiche = {
        "nom": "Frère Aubin", "role": "moine de Tarvan", "peuple": "humain", "apparence": "robe de bure",
        "secret": "SECRET-AUBIN", "envie": "ENVIE-AUBIN", "offre": "OFFRE-AUBIN", "notes": "NOTE-AUBIN",
        "profil": {"pv": 12}, "connu": False,
    }
    aubin = client.post("/api/pnj", json=fiche).json()
    assert aubin["id"] == "frere-aubin" and aubin["illustrations"] == []
    assert client.get(f"/api/table/pnj/{J('pnj', aubin['id'])}").status_code == 404

    client.post(f"/api/pnj/{aubin['id']}/illustrations", json={"url": media("portrait-aubin.jpg")})
    aubin["connu"] = True
    aubin["illustrations"] = []
    apres = client.put(f"/api/pnj/{aubin['id']}", json=aubin).json()
    assert apres["illustration"] == "/media/portrait-aubin.jpg"

    reponse = client.get(f"/api/table/pnj/{J('pnj', aubin['id'])}")
    assert reponse.status_code == 200
    for interdit in ("SECRET-AUBIN", "ENVIE-AUBIN", "OFFRE-AUBIN", "NOTE-AUBIN", "pv"):
        assert interdit not in reponse.text
    assert reponse.json()["illustration"] == "/media/portrait-aubin.jpg"

    assert client.post("/api/illustrations", json={"cible": "pnj", "fiche": "inconnu", "prompt": "a monk"}).status_code == 404
    assert client.post("/api/illustrations", json={"cible": "dragon", "fiche": aubin["id"], "prompt": "a monk"}).status_code == 400
    assert client.delete(f"/api/pnj/{aubin['id']}").json() == {"ok": True}
    assert client.get(f"/api/table/pnj/{J('pnj', aubin['id'])}").status_code == 404


def test_la_planche_ne_montre_que_les_affiches(client):
    affiche = client.post("/api/contrats", json={"nom": "Escorte vers Tarvan", "affiche": "Six jours de route.", "etat": "affiche",
                                                 "verite": "VERITE-ESCORTE", "notes": "NOTE-ESCORTE", "mention": "Allez-y de jour."}).json()
    client.post("/api/contrats", json={"nom": "Brouillon", "affiche": "CONTRAT-BROUILLON", "etat": "brouillon"})
    client.post("/api/contrats", json={"nom": "Fini", "affiche": "CONTRAT-FINI", "etat": "reussi"})
    pris = client.post("/api/contrats", json={"nom": "Rats au moulin", "affiche": "Des rats gros comme des chiens.", "etat": "pris", "delave": True}).json()
    reponse = client.get("/api/table/planche")
    for interdit in ("VERITE-ESCORTE", "NOTE-ESCORTE", "CONTRAT-BROUILLON", "CONTRAT-FINI"):
        assert interdit not in reponse.text
    planche = {c["id"]: c for c in reponse.json()}
    assert set(planche) == {J("contrats", affiche["id"]), J("contrats", pris["id"])}
    assert planche[J("contrats", affiche["id"])]["mention"] == "Allez-y de jour." and planche[J("contrats", pris["id"])]["delave"] is True


def test_rumeurs_et_precedemment_publics(client):
    rumeur = client.post("/api/rumeurs", json={"texte": "Les araignées sont revenues.", "source": "un marchand nain",
                                               "verite": "vraie", "fond": "FOND-RUMEUR", "etat": "a-placer"}).json()
    assert rumeur["id"].startswith("rumeur")
    assert client.get(f"/api/table/rumeur/{J('rumeurs', rumeur['id'])}").status_code == 404
    rumeur["etat"] = "entendue"
    client.put(f"/api/rumeurs/{rumeur['id']}", json=rumeur)
    publique = client.get(f"/api/table/rumeur/{J('rumeurs', rumeur['id'])}")
    assert publique.status_code == 200 and "FOND-RUMEUR" not in publique.text and "vraie" not in publique.text

    lieu = client.post("/api/lieux", json={"nom": "Kwen", "connu": True}).json()
    client.post(f"/api/lieux/{lieu['id']}/illustrations", json={"url": media("kwen.jpg")})
    cache = client.post("/api/lieux", json={"nom": "Le nid caché", "connu": False}).json()
    client.post(f"/api/lieux/{cache['id']}/illustrations", json={"url": media("nid.jpg")})
    seance = client.post("/api/seances", json={"nom": "Séance 1", "numero": 1, "notes": "NOTE-SEANCE", "lieux": [lieu["id"], cache["id"]]}).json()
    # Le journal s'écrit par sa route ; l'enregistrement de la fiche entière, plus bas, le garde.
    assert client.post(f"/api/seances/{seance['id']}/journal", json={"texte": "JOURNAL-MJ"}).json()["journal"][0]["texte"] == "JOURNAL-MJ"
    assert client.get(f"/api/table/precedemment/{J('seances', seance['id'])}").status_code == 404
    seance["precedemment"] = "Nos aventuriers ont quitté l'auberge."
    assert client.put(f"/api/seances/{seance['id']}", json=seance).json()["journal"][0]["texte"] == "JOURNAL-MJ"
    recap = client.get(f"/api/table/precedemment/{J('seances', seance['id'])}")
    for interdit in ("JOURNAL-MJ", "NOTE-SEANCE", "nid"):
        assert interdit not in recap.text
    assert [i["url"] for i in recap.json()["images"]] == ["/media/kwen.jpg"]


def test_une_seance_ouverte_ailleurs_n_ecrase_pas(client):
    seance = client.post("/api/seances", json={"nom": "Séance 2", "numero": 2}).json()
    mac = client.get(f"/api/seances/{seance['id']}").json()
    pc = dict(mac)
    assert client.put(f"/api/seances/{seance['id']}", json={**mac, "objectif": "Mac", "version_base": mac["modifie"]}).status_code == 200
    assert client.put(f"/api/seances/{seance['id']}", json={**pc, "objectif": "PC", "version_base": pc["modifie"]}).status_code == 409
    assert client.get(f"/api/seances/{seance['id']}").json()["objectif"] == "Mac"

    camp = client.get("/api/campagne").json()
    assert camp["niveau"] == 1 and camp["tablee"] == []
    camp["tablee"] = [{"id": "j1", "joueur": "Alban", "personnage": "Orlane"}]
    enregistree = client.put("/api/campagne", json={**camp, "version_base": camp["modifie"]}).json()
    assert enregistree["tablee"][0]["personnage"] == "Orlane"
    assert client.put("/api/campagne", json={**camp, "version_base": camp["modifie"]}).status_code == 409


def test_feuille_de_combat_servie_a_l_atelier(client):
    # La page à imprimer depuis Séances ; elle lit les rencontres et les plans par les routes de l'atelier.
    page = client.get("/feuille-combat?id=seance")
    assert page.status_code == 200 and page.headers["cache-control"] == "no-cache"
    texte = re.sub(r"/static/v-[0-9a-f]{10}/", "/static/", page.text)  # liens sous l'empreinte des fichiers (statiques_versionnes.py)
    assert "/static/js/seances/feuille-combat.js" in texte and "/static/css/feuille-combat.css" in texte
    assert client.get("/static/js/seances/feuille-combat.js").status_code == 200


def test_aventuriers_a_la_table(client):
    fiche = {
        "nom": "Naïma Hautvent", "genre": "f", "joueur": "Lucas", "couleur": "#2f6ea5", "peuple": "Demi-élémentaire", "peuple_cache": True,
        "vocations": ["Rôdeur"], "specialite": "éclaireuse", "element": "Air", "physique": 70, "social": 40, "mental": 60, "sante": 7, "psy": 5,
        "themes": ["Liberté", "", "Promesse"], "allure": "Les yeux gris comme l'orage.",
        "histoire": "REVENUE-DE-LA-MORT", "particularites": "PARTICULARITE-MJ", "secret": "SECRET-JOUEUR", "notes_mj": "NOTE-MJ",
        "dons": [{"nom": "Déplacement élémentaire"}], "tablee": True, "posture": "focus", "posture_elementaire": "Le vent se lève.",
        "competences": [{"nom": "Pistage", "bonus": 15, "avec": "Mental"}, {"nom": "", "bonus": 5}],
        "armes": [{"nom": "Arc long", "competence": "Armes de tir", "degats": "1D8", "notes": ""}], "protection": {"nom": "Cuir souple", "indice": 1},
    }
    a = client.post("/api/aventuriers", json=fiche).json()
    assert a["id"] == "naima-hautvent" and a["illustrations"] == []
    client.post("/api/aventuriers", json={"nom": "Figurant", "tablee": False})

    carton = client.get(f"/api/table/aventurier/{J('aventuriers', a['id'])}")
    assert carton.status_code == 200
    for interdit in ("REVENUE-DE-LA-MORT", "PARTICULARITE-MJ", "SECRET-JOUEUR", "NOTE-MJ", "Demi-élémentaire", "Déplacement élémentaire"):
        assert interdit not in carton.text
    public = carton.json()
    assert public["peuple"] == "" and public["joueur"] == "Lucas" and public["themes"] == ["Liberté", "Promesse"]
    assert (public["physique"], public["sante"], public["psy"]) == (70, 7, 5)

    tablee = client.get("/api/table/heros").json()
    assert [x["nom"] for x in tablee] == ["Naïma Hautvent"]

    # Les fiches en partie : les valeurs de jeu, jamais ce qui est pour le MJ, ni les dons d'un peuple gardé secret.
    fiches = client.get("/api/table/fiches")
    for interdit in ("REVENUE-DE-LA-MORT", "PARTICULARITE-MJ", "SECRET-JOUEUR", "NOTE-MJ", "Demi-élémentaire", "Déplacement élémentaire"):
        assert interdit not in fiches.text
    (naima,) = fiches.json()
    assert naima["competences"] == [{"nom": "Pistage", "bonus": 15, "avec": "Mental"}]
    assert naima["armes"][0]["degats"] == "1D8" and naima["protection"] == {"nom": "Cuir souple", "indice": 1}
    assert naima["dons"] == [] and "posture_elementaire" not in naima and naima["posture"] == "focus"
    bram = client.post("/api/aventuriers", json={"nom": "Bram", "peuple": "Nain", "tablee": True, "secret": "SECRET-BRAM",
                                                 "dons": [{"nom": "Vision dans le noir"}], "posture": "nimporte"}).json()
    fiches = client.get("/api/table/fiches")
    assert "SECRET-BRAM" not in fiches.text
    assert [(x["nom"], x["dons"], x["posture"]) for x in fiches.json()] == [
        ("Naïma Hautvent", [], "focus"), ("Bram", [{"nom": "Vision dans le noir", "cout": None, "effet": None, "cree": None, "ameliore": None}], "")]
    client.delete(f"/api/aventuriers/{bram['id']}")

    # Une fiche ouverte sur deux écrans : le plus ancien ne doit pas écraser le plus récent.
    mac = client.get(f"/api/aventuriers/{a['id']}").json()
    assert client.put(f"/api/aventuriers/{a['id']}", json={**mac, "niveau": 2, "version_base": mac["modifie"]}).status_code == 200
    assert client.put(f"/api/aventuriers/{a['id']}", json={**mac, "niveau": 3, "version_base": mac["modifie"]}).status_code == 409
    assert client.get(f"/api/aventuriers/{a['id']}").json()["niveau"] == 2

    assert client.get("/fiche-aventurier").status_code == 200
    assert client.post("/api/aventurier/histoire", json={"nom": "Naïma"}).status_code == 400
    assert client.delete(f"/api/aventuriers/{a['id']}").json() == {"ok": True}
    assert client.get(f"/api/table/aventurier/{J('aventuriers', a['id'])}").status_code == 404


def test_plan_a_la_table(client):
    # Deux salles côte à côte (A révélée à gauche, B cachée à droite), sur 6 × 3 cases.
    w, h = 6, 3
    sol = [2] * (w * h)
    piece = [1 if x < 3 else 2 for y in range(h) for x in range(w)]
    brouillard = [1 if x < 3 else 0 for y in range(h) for x in range(w)]
    plan = {
        "nom": "Crypte d'essai", "lieu": "LIEU-SECRET", "largeur": w, "hauteur": h, "m_case": 1.5, "brouillard_actif": True,
        "sol": sol, "piece": piece, "brouillard": brouillard, "notes": "NOTE-PLAN",
        "pieces": [{"id": 1, "nom": "Salle A", "genre": "salle", "notes": "NOTE-A", "nom_visible": True},
                   {"id": 2, "nom": "SALLE-B", "genre": "salle", "notes": "NOTE-B"}],
        "portes": [{"id": "p1", "sens": "v", "x": 3, "y": 0, "genre": "secrete", "etat": "fermee", "decouverte": False, "note": "NOTE-PORTE"},
                   {"id": "p2", "sens": "v", "x": 3, "y": 2, "genre": "porte", "etat": "verrouillee"},
                   {"id": "p3", "sens": "v", "x": 6, "y": 1, "genre": "porte", "etat": "fermee"}],
        "objets": [{"id": "o1", "cle": "table", "x": 0, "y": 0, "l": 2, "h": 1, "rot": 0, "note": "NOTE-TABLE"},
                   {"id": "o2", "cle": "piege", "x": 1, "y": 1, "l": 1, "h": 1, "cache": True},
                   {"id": "o3", "cle": "coffre", "x": 4, "y": 1, "l": 1, "h": 1}],
        "pions": [{"id": "t1", "genre": "heros", "nom": "Naïma", "ref": "aventurier:naima", "x": 1.5, "y": 2.5},
                  {"id": "t2", "genre": "ennemi", "nom": "EMBUSCADE", "x": 0.5, "y": 1.5, "cache": True},
                  {"id": "t3", "genre": "ennemi", "nom": "GOBELIN-B", "x": 4.5, "y": 0.5},
                  {"id": "t4", "genre": "pnj", "nom": "PNJ-INCONNU", "ref": "pnj:inconnu-du-plan", "image": "/media/PORTRAIT-INCONNU.jpg", "x": 2.5, "y": 0.5},
                  {"id": "t5", "genre": "ennemi", "nom": "NOM-DU-GOBELIN", "court": "3", "x": 0.5, "y": 0.5}],
        "fond": {"url": media("fond-plan.png", (60, 30), (250, 250, 250)), "x": 0, "y": 0, "l": 6, "h": 3, "opacite": 1},
        "textes": [{"id": "x1", "texte": "TEXTE-MJ", "x": 1, "y": 1, "mj": True}, {"id": "x2", "texte": "Entrée", "x": 1, "y": 2}],
    }
    client.post("/api/pnj", json={"nom": "Inconnu du plan", "connu": False})
    p = client.post("/api/plans", json=plan).json()
    assert p["id"] == "crypte-d-essai"
    jp = J("plans", p["id"])
    assert client.get(f"/api/table/plan/{p['id']}").status_code == 404
    public = client.get(f"/api/table/plan/{jp}")
    assert public.status_code == 200
    for interdit in ("LIEU-SECRET", "NOTE-", "SALLE-B", "EMBUSCADE", "GOBELIN-B", "TEXTE-MJ", "piege", "coffre", "aventurier:", "secrete", "verrouillee",
                     "Crypte d'essai", "crypte-d-essai", "PNJ-INCONNU", "PORTRAIT-INCONNU", "NOM-DU-GOBELIN", "fond-plan"):
        assert interdit not in public.text, interdit
    pub = public.json()
    assert pub["sol"] == [2, 2, 2, 0, 0, 0] * 3
    # Le mur entre A et B est vu depuis A ; rien de la salle B.
    assert pub["murs"][2] & 2 and pub["murs"][3] == 0
    assert [d["id"] for d in pub["portes"]] == ["p2"]
    assert [o["id"] for o in pub["objets"]] == ["o1"] and [t["id"] for t in pub["pions"]] == ["t1", "t4", "t5"]
    assert [(t["nom"], t["image"]) for t in pub["pions"]] == [("", ""), ("", ""), ("", "")]
    assert [t["texte"] for t in pub["textes"]] == ["Entrée"] and [x["nom"] for x in pub["pieces"]] == ["Salle A"]
    # Le fond arrive noirci hors des cases révélées (ici la moitié droite).
    fond = client.get(pub["fond"]["url"])
    assert fond.status_code == 200 and fond.headers["content-type"] == "image/jpeg"
    image = Image.open(__import__("io").BytesIO(fond.content)).convert("L")
    assert image.getpixel((5, 15)) > 200 and image.getpixel((55, 15)) < 30

    # La porte secrète découverte apparaît, comme une porte ordinaire.
    p["portes"][0]["decouverte"] = True
    client.put(f"/api/plans/{p['id']}", json=p)
    pub = client.get(f"/api/table/plan/{jp}").json()
    assert {d["id"]: d["genre"] for d in pub["portes"]} == {"p1": "porte", "p2": "porte"}
    # Sans brouillard, tout le plan est visible, et toujours sans les notes.
    p["brouillard_actif"] = False
    client.put(f"/api/plans/{p['id']}", json=p)
    public = client.get(f"/api/table/plan/{jp}")
    assert public.json()["sol"] == sol and "NOTE-" not in public.text and "EMBUSCADE" not in public.text
    # Des données abîmées (meuble sans taille, pion sans position) n'empêchent pas la TV de montrer le plan.
    p["objets"].append({"id": "o9", "cle": "table", "x": 0, "y": 0, "l": None, "h": 1})
    p["pions"].append({"id": "t9", "genre": "autre", "nom": "Sans position"})
    client.put(f"/api/plans/{p['id']}", json=p)
    assert client.get(f"/api/table/plan/{jp}").status_code == 200
    assert client.delete(f"/api/plans/{p['id']}").json() == {"ok": True}


def test_rencontres(client):
    r = client.post("/api/rencontres", json={"nom": "Le gué", "adversaires": [{"cle": "soldat", "nom": "Soldat", "n": 3}], "avant": 2}).json()
    assert r["id"] == "le-gue"
    r["adversaires"][0]["n"] = 4
    assert client.put(f"/api/rencontres/{r['id']}", json=r).json()["adversaires"][0]["n"] == 4
    assert client.delete(f"/api/rencontres/{r['id']}").json() == {"ok": True}
    assert client.get(f"/api/rencontres/{r['id']}").status_code == 404
