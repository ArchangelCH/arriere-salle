"""Les aides du tableau du MJ (js/tableau/) : « Hors du scénario » crée des PNJ, marque des rumeurs entendues, enregistre
des rencontres et montre des cartons ou des boutiques par les routes existantes ; « Chacun son moment » ne parle jamais à
la TV. Rien de ce qu'elles écrivent ne part vers la TV, la table publique ou le coin des joueurs sans les projections
publiques : un PNJ improvisé reste inconnu, une rumeur entendue ne montre que son texte, une rencontre reste au MJ.
Le calcul lui-même se vérifie avec node outils/verifier_aides_tableau.mjs."""

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
from api import application, tv_cartes  # noqa: E402

J = tv_cartes.jeton
JS = Path(__file__).resolve().parent.parent / "app" / "static" / "js"
CF = {"CF-Connecting-IP": "203.0.113.7"}


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def etat_tv(client):
    with client.websocket_connect("/ws/table") as ws:
        return json.loads(ws.receive_text())["etat"]


def test_un_pnj_improvise_reste_inconnu_jusqu_a_son_carton(client):
    """« Créer ce PNJ » : la fiche minimale du tableau, au lieu courant, inconnue des joueurs. Même posée dans l'état de
    la table, son carton ne répond pas tant qu'elle n'est pas connue ; ensuite, la projection publique seule."""
    lieu = client.post("/api/lieux", json={"nom": "La Petite Fanfrelée", "type": "auberge", "connu": True}).json()
    p = client.post("/api/pnj", json={
        "statut": "vivant", "attitude": "neutre", "etiquette": "maison", "connu": False, "rang": "civil",
        "nom": "Aldwin Brisefer", "genre": "h", "peuple": "Humain", "origine": "clairefonds", "lieu": lieu["id"],
    }).json()
    assert p["connu"] is False and p["lieu"] == lieu["id"]
    client.put("/api/table", json={"vue": "plan", "plan": "plan-essai", "pnj": p["id"]})
    tv = etat_tv(client)
    vu = json.dumps(tv, ensure_ascii=False)
    assert tv["pnj"] == J("pnj", p["id"]) and "Aldwin" not in vu and "anfrel" not in vu and lieu["id"] not in vu
    assert client.get(f"/api/table/pnj/{J('pnj', p['id'])}").status_code == 404
    # « Montrer » après confirmation : seul « connu » change, puis le carton part.
    client.patch(f"/api/pnj/{p['id']}", json={"connu": True, "secret": "SECRET-ALDWIN", "notes": "NOTE-ALDWIN"})
    carton = client.get(f"/api/table/pnj/{J('pnj', p['id'])}")
    assert carton.status_code == 200 and carton.json()["nom"] == "Aldwin Brisefer"
    for interdit in ("SECRET-ALDWIN", "NOTE-ALDWIN", "clairefonds", lieu["id"], "anfrel"):
        assert interdit not in carton.text
    client.put("/api/table", json={"vue": "accueil"})
    client.delete(f"/api/pnj/{p['id']}")
    client.delete(f"/api/lieux/{lieu['id']}")


def test_une_rumeur_entendue_depuis_le_tableau(client):
    """« Entendue » : la même transition que l'Auberge, pendant la séance du journal. Rien ne part à la TV ; une fois
    montrée, elle n'en dit que son texte et sa source."""
    r = client.post("/api/rumeurs", json={"texte": "Des cavaliers en gris remontent la route.", "source": "un charretier",
                                          "verite": "vraie", "fond": "FOND-AUDE", "etat": "a-placer"}).json()
    avant = etat_tv(client)
    apres = client.patch(f"/api/rumeurs/{r['id']}", json={"etat": "entendue", "seance": "seance-d-essai"}).json()
    assert apres["etat"] == "entendue" and apres["seance"] == "seance-d-essai" and apres["fond"] == "FOND-AUDE"
    assert etat_tv(client) == avant
    publique = client.get(f"/api/table/rumeur/{J('rumeurs', r['id'])}")
    assert publique.status_code == 200 and publique.json()["texte"].startswith("Des cavaliers")
    for interdit in ("FOND-AUDE", "vraie", "seance-d-essai"):
        assert interdit not in publique.text
    client.delete(f"/api/rumeurs/{r['id']}")


def test_la_rencontre_tiree_reste_au_mj(client):
    """« Enregistrer » : une rencontre comme celles de l'onglet Combats, verdict et notes compris. La TV n'en reçoit rien,
    même si un écran glissait son identifiant dans l'état de la table ; Internet n'y a pas accès."""
    r = client.post("/api/rencontres", json={
        "nom": "Brigands, La Petite Fanfrelée", "lieu": "la-petite-fanfrelee", "avant": 2, "style": "fiches", "moral": True,
        "adversaires": [{"cle": "brigand", "nom": "Brigand", "rang": "sbire", "att": 45, "degats": "1D6", "armure": 1, "sante": "5", "n": 5}],
        "verdict": {"cle": "normale", "victoire": 1, "nbPj": 4, "niveau": 1},
        "notes": "Tirée au hasard dans le tableau du MJ pendant la séance 2 (Le Sanctuaire), pour la tablée de 4, niveau 1.",
    }).json()
    assert r["id"] and r["verdict"]["cle"] == "normale"
    client.put("/api/table", json={"vue": "plan", "plan": "plan-essai", "rencontre": r["id"]})
    vu = json.dumps(etat_tv(client), ensure_ascii=False)
    assert "rencontre" not in vu and "Brigand" not in vu and "anfrel" not in vu
    assert client.get("/api/rencontres", headers=CF).status_code == 404
    client.put("/api/table", json={"vue": "accueil"})
    client.delete(f"/api/rencontres/{r['id']}")


def test_les_aides_ne_parlent_a_la_tv_que_par_les_routes_existantes():
    """« Chacun son moment » ne touche pas à la table ; « Hors du scénario » n'y pose qu'un carton de PNJ ou une boutique
    (comme Séances et Boutiques), jamais une rumeur, et n'affiche ni secret ni note du MJ."""
    dossier = JS / "tableau"
    for nom in ("projecteur.js", "moments.js"):
        source = (dossier / nom).read_text(encoding="utf-8")
        assert "/api/table" not in source and "/ws/" not in source, nom
    impro = (dossier / "impro.js").read_text(encoding="utf-8")
    assert "/ws/" not in impro
    ecritures = set(re.findall(r"api\.(put|post|patch|del)\([\"`]([^\"`$]+)", impro))
    assert ecritures == {("put", "/api/table"), ("post", "/api/rencontres"), ("post", "/api/pnj"), ("patch", "/api/pnj/"), ("patch", "/api/rumeurs/")}, ecritures
    envois = re.findall(r"\{ \.\.\.etat, ([^}]*)\}", impro)
    cles = {c.split(":")[0].strip().lstrip(".") for e in envois for c in e.split(",") if c.strip()}
    assert cles <= {"pnj", "vue", "boutique", "article", "avant", "lieu"}, cles
    assert "rumeur:" not in impro.replace("`rumeur:${", "")
    for interdit in (".secret", "notes_mj", "note_mj", ".fond"):
        assert interdit not in impro, interdit


def test_le_tableau_monte_ses_aides_sans_toucher_au_reste():
    """tableau.js ne fait que les monter et les prévenir (ouvert, fermé, état du jeu reçu) ; la feuille est liée."""
    source = (JS / "tableau/tableau.js").read_text(encoding="utf-8")
    assert 'import { Impro } from "./impro.js";' in source and 'import { Projecteur } from "./projecteur.js";' in source
    for appel in ("a.ouvrir()", "a.fermer()", "a.recu(jeu)"):
        assert source.count(appel) == 1, appel
    page = (JS.parent / "index.html").read_text(encoding="utf-8")
    assert '<link rel="stylesheet" href="/static/css/tableau-aides.css">' in page
