"""Coûts de l'API justes et annoncés : tarif de lecture du cache, lots sans cache, durée notée au journal, prix et attente
probables des boutons (lus dans le journal, sans appel), relecture rapide d'un chapitre. Le modèle est un faux client."""
import asyncio
import json
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, bible_api, contexte_du_modele  # noqa: E402
from ia import redaction  # noqa: E402
from faux_modele import FauxClient  # noqa: E402

# Le journal réel du 30 et du 31/10 (data/journal-ia.jsonl), plus un lot qui ne doit compter dans aucune estimation.
JOURNAL = [
    ("2026-10-30T17:40:45", "prompt-image", 368, 161, 0, 0),
    ("2026-10-31T14:46:06", "habillage-plan", 4218, 3845, 42504, 0),
    ("2026-10-31T14:46:12", "habillage-plan", 4433, 4314, 42504, 0),
    ("2026-10-31T14:46:25", "habillage-plan", 4436, 6075, 42504, 0),
    ("2026-10-31T14:46:39", "habillage-carte", 4529, 2232, 0, 42504),
    ("2026-10-31T17:36:35", "relecture", 13126, 9789, 304352, 0),
    ("2026-10-31T17:59:31", "habillage-plan", 5284, 8187, 5406, 36962),
    ("2026-10-31T18:00:18", "habillage-plan", 5451, 5588, 0, 42368),
    ("2026-10-31T18:01:04", "habillage-plan", 5209, 4683, 0, 42368),
    ("2026-10-31T18:01:48", "habillage-plan", 3893, 4905, 0, 42368),
    ("2026-10-31T18:02:34", "habillage-plan", 4064, 5304, 0, 42368),
    ("2026-10-31T18:15:08", "prompt-image", 440, 234, 0, 0),
]


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture
def journal(tmp_path, monkeypatch):
    chemin = tmp_path / "journal-ia.jsonl"
    lignes = [{"date": d, "fonction": f, "modele": "claude-opus-5-5", "lot": False, "entree": e, "sortie": s, "cache_ecrit": ce,
               "cache_lu": cl, "cout": 0} for d, f, e, s, ce, cl in JOURNAL]
    lignes.append({"date": "2026-10-31T18:20:00", "fonction": "relecture", "modele": "claude-opus-5-5", "lot": True, "entree": 1,
                   "sortie": 1, "cache_ecrit": 999999, "cache_lu": 0, "cout": 0})
    chemin.write_text("".join(json.dumps(x) + "\n" for x in lignes), encoding="utf-8")
    monkeypatch.setattr(redaction, "JOURNAL", chemin)
    return chemin


@pytest.fixture
def lore(tmp_path, monkeypatch):
    (tmp_path / "bible").mkdir()
    (tmp_path / "glossaire.md").write_text("# Glossaire\n\n**Toma** : paladin.", encoding="utf-8")
    (tmp_path / "bible" / "ton-et-table.md").write_text("# Le ton\n\nUne comédie dans un univers sérieux.", encoding="utf-8")
    (tmp_path / "bible" / "personnages.md").write_text("# Personnages\n\nGrimbal, nain du Calvère.\n\nBrom, demi-diable.", encoding="utf-8")
    monkeypatch.setattr(bible_api, "LORE", tmp_path)
    redaction.regler_sources_liens(contexte_du_modele.sources_des_liens)
    yield tmp_path
    redaction.regler_sources_liens(contexte_du_modele.sources_des_liens)


def usage(entree=0, sortie=0, ecrit=0, lu=0, ecrit_1h=0):
    return SimpleNamespace(input_tokens=entree, output_tokens=sortie, cache_creation_input_tokens=ecrit, cache_read_input_tokens=lu,
                           cache_creation=SimpleNamespace(ephemeral_1h_input_tokens=ecrit_1h, ephemeral_5m_input_tokens=ecrit - ecrit_1h))


def test_lecture_du_cache_au_tarif_de_chaque_modele():
    # Opus 5.5 : 0,05 × l'entrée (0,20 $ le million) ; Sonnet 5.5, et Sonnet 5 son repli : 0,1 × (0,20 $) ; Opus 5 : 0,1 × (0,50 $).
    assert redaction.cout("claude-opus-5-5", usage(lu=1_000_000)) == pytest.approx(0.20)
    assert redaction.cout("claude-sonnet-5-5", usage(lu=1_000_000)) == pytest.approx(0.20)
    assert redaction.cout("claude-sonnet-5", usage(lu=1_000_000)) == pytest.approx(0.20)
    assert redaction.cout("claude-opus-5", usage(lu=1_000_000)) == pytest.approx(0.50)
    assert redaction.cout("claude-haiku-5-5", usage(lu=1_000_000)) == pytest.approx(0.01)
    # Écritures : 5 $ (5 min) et 8 $ (1 h) le million sur Opus 5.5 ; un lot, moitié prix de tout.
    assert redaction.cout("claude-opus-5-5", usage(ecrit=2_000_000, ecrit_1h=1_000_000)) == pytest.approx(5 + 8)
    assert redaction.cout("claude-opus-5-5", usage(entree=1_000_000, sortie=1_000_000, lu=1_000_000), lot=True) == pytest.approx((4 + 20 + 0.2) / 2)
    # La relecture du 31/10 : 2,67 $ au journal (l'état de la campagne, 5 407 jetons, écrit pour cinq minutes, le reste pour
    # une heure). Un modèle inconnu se compte comme Opus 5.5.
    assert redaction.cout("claude-opus-5-5", usage(13126, 9789, 304352, 0, 304352 - 5407)) == pytest.approx(2.66688, abs=1e-5)
    assert redaction.cout("inconnu", usage(lu=1_000_000)) == pytest.approx(0.20)


def test_un_lot_part_sans_cache_et_l_attente_est_notee(tmp_path, monkeypatch):
    faux = FauxClient("ok", "Relu.")
    monkeypatch.setattr(redaction, "CLIENT", faux)
    monkeypatch.setattr(redaction, "JOURNAL", tmp_path / "journal.jsonl")
    monkeypatch.setattr(redaction, "LOTS", tmp_path / "lots.json")
    blocs = [{"type": "text", "text": "A"}, {"type": "text", "text": "B", "cache_control": {"type": "ephemeral", "ttl": "1h"}}]
    asyncio.run(redaction.rediger("relecture", blocs, "x"))
    # L'appel direct garde son cache ; le lot, non (il ne relirait jamais ce qu'il écrit).
    assert faux.appels[0]["system"][1]["cache_control"] == {"type": "ephemeral", "ttl": "1h"}
    asyncio.run(redaction.lancer_lot("relecture", {"scenario": "s"}, blocs, "y"))
    systeme = faux.messages.batches.crees[0][0]["params"]["system"]
    assert systeme == [{"type": "text", "text": "A"}, {"type": "text", "text": "B"}] and "cache_control" in blocs[1]
    asyncio.run(redaction.relever_lots(lambda cible, texte: None))
    lignes = [json.loads(x) for x in (tmp_path / "journal.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [x["lot"] for x in lignes] == [False, True]
    assert isinstance(lignes[0]["duree"], float) and lignes[0]["duree"] >= 0 and "duree" not in lignes[1]


def test_estimations_d_apres_le_journal(journal):
    avant = journal.read_bytes()
    # Quatre minutes après la relecture : la bible est encore en cache, la relecture suivante coûte environ 0,31 $.
    chaud = redaction.estimations(datetime(2026, 10, 31, 17, 40))["usages"]
    r = chaud["relecture"]
    variable = (13126 * 4 + 9789 * 20) / 1e6
    assert r["connu"] and r["en_cache"] and r["famille"] == "bible" and r["appels"] == 1
    assert r["cout"] == pytest.approx(variable + 304352 * 0.2 / 1e6, abs=1e-4) and r["contexte_a_charger"] == 0
    assert r["duree"] == 98 and r["duree_mesuree"] is False
    # Le lendemain matin : la bible est à recharger (cache d'une heure, deux fois l'entrée).
    froid = redaction.estimations(datetime(2026, 11, 1, 8, 0))["usages"]
    r = froid["relecture"]
    assert not r["en_cache"] and r["contexte_a_charger"] == pytest.approx(304352 * 8 / 1e6, abs=1e-4)
    assert r["cout"] == pytest.approx(variable + 304352 * 8 / 1e6, abs=1e-4)
    assert r["cout_en_cache"] == chaud["relecture"]["cout"]
    # En différé : moitié prix et sans cache, la bible payée comme une entrée ordinaire (0,73 $ au lieu de 1,34 $ avec le cache d'une heure).
    assert r["differe"] == pytest.approx(((304352 + 13126) * 4 + 9789 * 20) / 2e6, abs=1e-4)
    # Habillage d'un plan : médianes des cinq derniers appels (le lot de la relecture n'y entre pas).
    h = froid["habillage-plan"]
    assert h["appels"] == 5 and h["sortie"] == pytest.approx(5304 * 20 / 1e6, abs=1e-4) and h["duree"] == 53
    assert h["cout"] == pytest.approx((5209 * 4 + 5304 * 20 + 42368 * 8) / 1e6, abs=1e-4)
    assert chaud["habillage-plan"]["en_cache"] and chaud["habillage-plan"]["cout"] == pytest.approx((5209 * 4 + 5304 * 20 + 42368 * 0.2) / 1e6, abs=1e-4)
    # Sans contexte (consigne d'illustration) : toujours le même prix.
    assert froid["prompt-image"]["cout"] == chaud["prompt-image"]["cout"] == pytest.approx((404 * 4 + 197.5 * 20) / 1e6, abs=1e-4)
    # Jamais appelé : pas de prix, seulement le plancher du contexte.
    assert froid["pnj"] == {"connu": False, "famille": "leger", "minimum": pytest.approx(42368 * 8 / 1e6, abs=1e-4), "en_cache": False}
    assert froid["verifier"]["minimum"] == pytest.approx(304352 * 8 / 1e6, abs=1e-4) and froid["relecture-rapide"]["connu"] is False
    assert set(froid) == set(redaction.ESTIMATIONS)
    assert journal.read_bytes() == avant


def test_l_attente_mesuree_passe_devant_la_longueur(journal):
    with journal.open("a", encoding="utf-8") as f:
        for d in (40.0, 50.0, 70.0):
            f.write(json.dumps({"date": "2026-10-31T19:00:00", "fonction": "lieu", "lot": False, "entree": 900, "sortie": 1000,
                                "cache_ecrit": 0, "cache_lu": 42368, "cout": 0, "duree": d}) + "\n")
    lieu = redaction.estimations(datetime(2026, 10, 31, 19, 10))["usages"]["lieu"]
    assert lieu["duree"] == 50 and lieu["duree_mesuree"] is True and lieu["en_cache"] is True


def test_route_des_estimations(client, journal, monkeypatch):
    monkeypatch.setattr(redaction, "CLIENT", None)
    r = client.get("/api/ia/estimations").json()
    assert r["disponible"] is False and r["usages"]["relecture"]["connu"] is True
    # Sans clé, l'atelier atténue les boutons qui en dépendent, sauf ceux auxquels le modèle local répond.
    assert set(r["repli_local"]) == {"pnj", "precedemment", "histoire"} and set(r["repli_local"]) <= set(r["usages"])
    monkeypatch.setattr(redaction, "CLIENT", FauxClient())
    assert client.get("/api/ia/estimations").json()["disponible"] is True
    assert redaction.CLIENT.appels == []


def test_relecture_rapide_d_un_chapitre(client, lore, monkeypatch):
    faux = FauxClient("Rien à redire.", "Tout tient.", "Ensemble.")
    monkeypatch.setattr(redaction, "CLIENT", faux)
    s = client.post("/api/scenarios", json={"nom": "Essai rapide", "chapitres": [
        {"id": "c-1", "titre": "Au Calvère", "texte": "Grimbal boit avec Brom."}]}).json()
    fin = [json.loads(l[6:]) for l in client.post(f"/api/flux/scenarios/{s['id']}/relectures/c-1?rapide=true").text.splitlines()
           if l.startswith("data: ")][-1]
    assert fin["scenario"]["relectures"]["c-1"]["rapide"] is True
    appel = faux.appels[0]
    demande = appel["messages"][0]["content"]
    # Contexte léger (trois blocs, sans la bible entière) et les passages liés aux noms du chapitre.
    assert len(appel["system"]) == 3 and "Passages de la bible liés au chapitre" in demande and "Grimbal, nain du Calvère" in demande
    assert demande.index("Passages de la bible") < demande.index("Relis le chapitre 1")
    # Sans « rapide », la bible entière, et la relecture redevient « au regard du canon ».
    fin = [json.loads(l[6:]) for l in client.post(f"/api/flux/scenarios/{s['id']}/relectures/c-1").text.splitlines()
           if l.startswith("data: ")][-1]
    assert len(faux.appels[1]["system"]) == 4 and "rapide" not in fin["scenario"]["relectures"]["c-1"]
    assert "Passages de la bible" not in faux.appels[1]["messages"][0]["content"]
    # L'ensemble garde toujours la bible entière.
    client.post(f"/api/flux/scenarios/{s['id']}/relectures/ensemble?rapide=true")
    assert len(faux.appels[2]["system"]) == 4 and "Passages de la bible" not in faux.appels[2]["messages"][0]["content"]
    client.delete(f"/api/scenarios/{s['id']}")
