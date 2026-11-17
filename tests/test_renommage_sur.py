"""Le renommage d'identifiant (a02, liens_fiches.py) ne casse jamais une référence ni ne perd une version : un lieu nommé
sur sa carte y garde son marqueur même si un autre écran enregistre la carte, une version gardée ou une fiche jetée qui
cite l'identifiant le retiennent (une fois remises, elles ne pointeraient plus vers rien), un identifiant neuf n'hérite
pas de l'histoire d'une autre fiche. Et la clôture d'une séance, qui ne se rattrape pas, ne part pas sur une Entrée."""

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

import main  # noqa: E402
from api import application, config  # noqa: E402

JS = Path(__file__).resolve().parent.parent / "app" / "static" / "js"


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def nommer(client, collection, ident, nom):
    lue = client.get(f"/api/{collection}/{ident}").json()
    assert client.put(f"/api/{collection}/{ident}", json={**lue, "nom": nom, "version_base": lue["modifie"]}).status_code == 200


def lieu_sur_sa_carte(client, nom_carte):
    carte = client.post("/api/cartes", json={"nom": nom_carte, "largeur": 20, "hauteur": 20, "terrain": "AA"}).json()
    lieu = client.post("/api/lieux", json={"nom": "Village sans nom", "type": "village", "carte": carte["id"]}).json()
    lue = client.get(f"/api/cartes/{carte['id']}").json()
    r = client.put(f"/api/cartes/{carte['id']}", json={**lue, "marqueurs": [{"id": "m1", "lieu": lieu["id"], "x": 3, "y": 4}],
                                                       "habillage": {"etiquettes": [{"lieu": lieu["id"], "texte": "ici"}]},
                                                       "version_base": lue["modifie"]})
    return carte, lieu, r.json()["modifie"]


def test_un_autre_ecran_qui_enregistre_la_carte_garde_l_identifiant(client):
    """La carte enregistrée entre-temps par un autre écran : le lieu garde son identifiant, et la carte ne pointe jamais
    vers un lieu disparu (avant, le serveur renommait et laissait la carte à l'éditeur, qui tombait alors en conflit)."""
    carte, lieu, version = lieu_sur_sa_carte(client, "Carte du gué sûr")
    nommer(client, "lieux", lieu["id"], "Le gué sûr")
    lue = client.get(f"/api/cartes/{carte['id']}").json()
    client.put(f"/api/cartes/{carte['id']}", json={**lue, "nom": "Carte du gué sûr, retouchée", "version_base": version})
    r = client.post(f"/api/lieux/{lieu['id']}/identifiant", json={"carte": carte["id"], "version_carte": version}).json()
    assert not r["change"] and r["id"] == lieu["id"] and "carte" not in r
    assert client.get(f"/api/lieux/{lieu['id']}").status_code == 200
    assert client.get(f"/api/cartes/{carte['id']}").json()["marqueurs"][0]["lieu"] == lieu["id"]
    # Une version qui ne dit pas laquelle (une page d'avant) : la carte compte comme une citation.
    actuelle = client.get(f"/api/cartes/{carte['id']}").json()["modifie"]
    for corps in ({"carte": carte["id"]}, {"carte": carte["id"], "version_carte": 3}, {"carte": "../cartes", "version_carte": actuelle}):
        assert not client.post(f"/api/lieux/{lieu['id']}/identifiant", json=corps).json()["change"], corps


def test_le_serveur_reecrit_la_carte_avec_le_lieu(client):
    """La bonne version : le lieu et tout ce que la carte dit de lui (marqueur, habillage) changent dans le même geste ;
    l'éditeur reprend la version écrite et enregistre ensuite sans conflit."""
    carte, lieu, version = lieu_sur_sa_carte(client, "Carte de la source sûre")
    nommer(client, "lieux", lieu["id"], "La source sûre")
    r = client.post(f"/api/lieux/{lieu['id']}/identifiant", json={"carte": carte["id"], "version_carte": version}).json()
    assert r["change"] and r["id"] == "la-source-sure"
    relue = client.get(f"/api/cartes/{carte['id']}").json()
    assert relue["marqueurs"][0]["lieu"] == "la-source-sure" and relue["habillage"]["etiquettes"][0]["lieu"] == "la-source-sure"
    assert r["carte"] == {"id": carte["id"], "modifie": relue["modifie"]} and relue["modifie"] != version
    assert lieu["id"] not in json.dumps(relue)
    r2 = client.put(f"/api/cartes/{carte['id']}", json={**relue, "nom": "Carte de la source sûre, bis", "version_base": r["carte"]["modifie"]})
    assert r2.status_code == 200


def test_une_version_gardee_ou_une_fiche_jetee_qui_cite_garde_l_identifiant(client):
    """Un PNJ posé sur un plan, puis retiré : l'ancienne version du plan le cite encore ; « Revenir à cette version »
    ramènerait un pion vers un identifiant disparu. Une fiche jetée qui le cite, de même."""
    p = client.post("/api/pnj", json={"nom": "Nouveau PNJ", "rang": "civil"}).json()
    plan = client.post("/api/plans", json={"nom": "Plan qui garde la trace", "largeur": 8, "hauteur": 6,
                                           "pions": [{"id": "t1", "genre": "pnj", "ref": f"pnj:{p['id']}", "x": 1, "y": 1}]}).json()
    lu = client.get(f"/api/plans/{plan['id']}").json()
    client.put(f"/api/plans/{plan['id']}", json={**lu, "pions": [], "version_base": lu["modifie"]})
    assert p["id"] in json.dumps([json.loads(f.read_text()) for f in (config.HISTORIQUE / "plans" / plan["id"]).glob("*.json")])
    nommer(client, "pnj", p["id"], "Gaspard des traces")
    assert not client.post(f"/api/pnj/{p['id']}/identifiant").json()["change"]
    # Une rencontre jetée qui le nomme le retient aussi.
    q = client.post("/api/pnj", json={"nom": "Nouveau PNJ", "rang": "civil"}).json()
    r = client.post("/api/rencontres", json={"nom": "Rencontre jetée", "adversaires": [{"ref": f"pnj:{q['id']}", "n": 1}]}).json()
    client.delete(f"/api/rencontres/{r['id']}")
    nommer(client, "pnj", q["id"], "Gaspard des cendres")
    assert not client.post(f"/api/pnj/{q['id']}/identifiant").json()["change"]


def test_ses_propres_traces_ne_le_retiennent_pas(client):
    """Ses propres versions gardées, et une autre fiche jetée autrefois sous le même identifiant, ne sont pas des
    citations : « Nouveau PNJ » prend son vrai nom même si la corbeille garde un autre « nouveau-pnj »."""
    vieux = client.post("/api/pnj", json={"nom": "Nouveau PNJ sûr", "rang": "civil"}).json()
    client.delete(f"/api/pnj/{vieux['id']}")
    neuf = client.post("/api/pnj", json={"nom": "Nouveau PNJ sûr", "rang": "civil"}).json()
    assert neuf["id"] == vieux["id"]
    nommer(client, "pnj", neuf["id"], "Hubert Sûr")
    r = client.post(f"/api/pnj/{neuf['id']}/identifiant").json()
    assert r["change"] and r["id"] == "hubert-sur"
    # La fiche jetée revient à côté : son identifiant d'origine mène désormais à Hubert (un écran resté dessus le suit).
    jetee = next(e for e in client.get("/api/corbeille").json()["elements"] if e["id"] == vieux["id"])
    assert jetee["repris"]
    assert client.post(f"/api/corbeille/pnj/{jetee['fichier']}/remettre", json={}).status_code == 409
    remise = client.post(f"/api/corbeille/pnj/{jetee['fichier']}/remettre", json={"a_cote": True}).json()
    assert remise["a_cote"] and remise["id"] != vieux["id"]
    assert client.get(f"/api/pnj/{vieux['id']}").json()["id"] == "hubert-sur"


def test_deux_nouveaux_pnj_suivent_chacun_leur_nom(client):
    """Les versions du premier, parties avec lui sous son nouveau nom, portent encore son identifiant d'avant : ce n'est
    pas une citation. Le second « Nouveau PNJ » ne reprend pas cet identifiant (il mène au premier, liens_fiches.py) et
    suit aussi son nom."""
    premier = client.post("/api/pnj", json={"nom": "Nouveau PNJ suivant", "rang": "civil"}).json()
    nommer(client, "pnj", premier["id"], "Anatole Suivant")
    assert client.post(f"/api/pnj/{premier['id']}/identifiant").json()["id"] == "anatole-suivant"
    assert any(json.loads(f.read_text())["id"] == premier["id"] for f in (config.HISTORIQUE / "pnj" / "anatole-suivant").glob("*.json"))
    second = client.post("/api/pnj", json={"nom": "Nouveau PNJ suivant", "rang": "civil"}).json()
    assert re.fullmatch(rf"{premier['id']}-[0-9a-f]{{4}}", second["id"])
    nommer(client, "pnj", second["id"], "Basile Suivant")
    r = client.post(f"/api/pnj/{second['id']}/identifiant").json()
    assert r["change"] and r["id"] == "basile-suivant"


def test_un_identifiant_neuf_n_herite_pas_de_l_histoire_d_une_autre_fiche(client):
    """« Le pont sûr » a existé, a été retouché puis jeté : ses versions et sa fiche dorment sous « le-pont-sur ». Un
    nouveau lieu nommé pareil prend un autre identifiant ; ses propres versions le suivent, celles de l'autre restent."""
    ancien = client.post("/api/lieux", json={"nom": "Le pont sûr", "type": "point"}).json()
    lu = client.get(f"/api/lieux/{ancien['id']}").json()
    client.put(f"/api/lieux/{ancien['id']}", json={**lu, "resume": "L'ancien pont", "version_base": lu["modifie"]})
    client.delete(f"/api/lieux/{ancien['id']}")
    assert (config.HISTORIQUE / "lieux" / "le-pont-sur").is_dir()
    nouveau = client.post("/api/lieux", json={"nom": "Lieu provisoire sûr", "type": "village"}).json()
    lu = client.get(f"/api/lieux/{nouveau['id']}").json()
    client.put(f"/api/lieux/{nouveau['id']}", json={**lu, "resume": "Le nouveau", "version_base": lu["modifie"]})
    nommer(client, "lieux", nouveau["id"], "Le pont sûr")
    r = client.post(f"/api/lieux/{nouveau['id']}/identifiant").json()
    assert r["change"] and re.fullmatch(r"le-pont-sur-[0-9a-f]{4}", r["id"])
    versions = client.get(f"/api/versions/lieux/{r['id']}").json()["versions"]
    assert versions and all(json.loads((config.HISTORIQUE / "lieux" / r["id"] / f"{v['version']}.json").read_text())["cree"] == nouveau["cree"]
                            for v in versions)
    restees = [json.loads(f.read_text()) for f in (config.HISTORIQUE / "lieux" / "le-pont-sur").glob("*.json")]
    assert restees and all(v["cree"] == ancien["cree"] for v in restees)
    # Les versions d'un homonyme jeté rangées sous l'identifiant de départ y restent ; les siennes le suivent.
    homonyme = config.HISTORIQUE / "lieux" / nouveau["id"]
    assert not homonyme.exists() or all(json.loads(f.read_text()).get("cree") != nouveau["cree"] for f in homonyme.glob("*.json"))


def test_clore_une_seance_ne_part_pas_sur_une_entree():
    """La clôture fait avancer les fils, et « Rouvrir » ne les fait pas reculer : la main est d'abord sur « Annuler »."""
    source = (JS / "seances" / "seances.js").read_text(encoding="utf-8")
    question = source[source.index("  async clore() {"):]
    question = question[:question.index("if (!(await this.enregistrer()))")]
    assert re.search(r'oui: "Clore la séance", danger: true \}', question)


def test_l_editeur_de_carte_annonce_sa_version_et_la_reprend():
    """L'éditeur envoie d'abord ce qui attend, dit au serveur la version de la carte qu'il a, et reprend celle que le
    serveur a écrite : son enregistrement suivant ne tombe pas en conflit et ne remet jamais l'ancien identifiant."""
    source = (JS / "lieux" / "panneau-lieu.js").read_text(encoding="utf-8")
    suivre = source[source.index("export function suivreNomSurLaCarte"):source.index("export function adopterSurLaCarte")]
    assert "version_carte: editeur.carte.modifie" in suivre
    assert suivre.index("await editeur.enregistrer()") < suivre.index("/identifiant`")
    reprise = suivre.index("editeur.carte.modifie = r.carte.modifie")
    # Même la page quittée ou le lieu changé entre-temps : la carte suit (adopterSurLaCarte sans fiche).
    garde = suivre.index("if (editeur.detruit || editeur.lieux[ancien] !== lieu) return adopterSurLaCarte(editeur, null, ancien, r.id);")
    assert reprise < garde
    adopter = source[source.index("export function adopterSurLaCarte"):]
    assert adopter.index("remplacer(editeur.carte.marqueurs);") < adopter.index("if (!lieu || editeur.detruit || editeur.lieux[ancien] !== lieu) return;")
