"""L'aide à l'écriture par l'API dans l'atelier : contexte de campagne, consignes et relectures de scénario, lots
différés, régions peuplées, fiches de lieu, plans programmés. Le modèle est remplacé par un faux client."""
import asyncio
import base64
import json
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from api import application, bible_api, contexte_du_modele, ia_api  # noqa: E402
from ia import redaction  # noqa: E402
from faux_modele import FauxClient  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture
def lore(tmp_path, monkeypatch):
    (tmp_path / "bible").mkdir()
    (tmp_path / "glossaire.md").write_text("# Glossaire\n\n**Toma** : paladin.", encoding="utf-8")
    (tmp_path / "bible" / "ton-et-table.md").write_text("# Le ton\n\nUne comédie dans un univers sérieux.", encoding="utf-8")
    (tmp_path / "bible" / "personnages.md").write_text("# Personnages\n\nGrimbal, nain. [S1 E1 00:00:10](https://youtu.be/abcdefgh123?t=10)",
                                                         encoding="utf-8")
    monkeypatch.setattr(bible_api, "LORE", tmp_path)
    redaction.regler_sources_liens(contexte_du_modele.sources_des_liens)
    yield tmp_path
    redaction.regler_sources_liens(contexte_du_modele.sources_des_liens)


def evenements(reponse):
    return [json.loads(l[6:]) for l in reponse.text.splitlines() if l.startswith("data: ")]


def cle(consigne):
    return {"cle": consigne["cle"], "rang": consigne["rang"]}


def scenario(client, texte):
    s = client.post("/api/scenarios", json={"nom": "Essai IA", "chapitres": [{"id": "c-1", "titre": "La taverne", "texte": texte}]}).json()
    refs = client.get(f"/api/scenarios/{s['id']}/consignes").json()["consignes"]
    return s, refs


def test_sans_cle_les_routes_le_disent(client, monkeypatch):
    monkeypatch.setattr(redaction, "CLIENT", None)
    s, refs = scenario(client, "Ils entrent.\n\n[[carte blanche : une serveuse]]\n")
    assert client.post(f"/api/flux/scenarios/{s['id']}/consignes", json=cle(refs[0])).status_code == 503
    assert client.post("/api/plans/programme", json={"demande": "une crypte"}).status_code == 503
    assert client.get("/api/ia/couts").json()["disponible"] is False
    client.delete(f"/api/scenarios/{s['id']}")


def test_contexte_de_campagne(client, lore):
    a = client.post("/api/aventuriers", json={"nom": "Ilsa Brume", "joueur": "Lou", "peuple": "Demi-élémentaire", "peuple_cache": True,
                                              "physique": 60, "competences": [{"nom": "Lames", "bonus": 15, "avec": "Physique"}], "tablee": True}).json()
    leger, complet = contexte_du_modele.contexte_ia("leger"), contexte_du_modele.contexte_ia("complet")
    assert [b.get("cache_control", {}).get("ttl") for b in leger] == [None, "1h", "5m"]
    assert [b.get("cache_control", {}).get("ttl") for b in complet] == [None, "1h", "1h", "5m"]
    assert "Glossaire" in leger[1]["text"] and "comédie" in leger[1]["text"] and "Grimbal" in complet[2]["text"]
    etat = leger[-1]["text"]
    assert "Ilsa Brume" in etat and "secret : inconnu des autres joueurs" in etat and "Lames 75 %" in etat
    # Même données, même texte : le cache ne se rompt pas d'un appel à l'autre.
    assert contexte_du_modele.contexte_ia("leger") == leger
    client.delete(f"/api/aventuriers/{a['id']}")


def test_consigne_ecrite_au_fil_et_deposee_sans_changer_la_version(client, lore, monkeypatch):
    faux = FauxClient("Une serveuse boite — elle sourit. [S1 E1](https://youtu.be/abcdefgh123?t=10) [faux](https://youtu.be/inventee999?t=1)")
    monkeypatch.setattr(redaction, "CLIENT", faux)
    s, refs = scenario(client, "Ils entrent.\n\n[[carte blanche : une serveuse]]\n\nLa suite.")
    r = client.post(f"/api/flux/scenarios/{s['id']}/consignes", json={**cle(refs[0]), "variantes": 2, "precision": "drôle"})
    assert r.headers["content-type"].startswith("text/event-stream")
    evs = evenements(r)
    assert [e["t"] for e in evs][-1] == "fin" and sum(e["t"] == "texte" for e in evs) > 1
    fin = evs[-1]
    assert "—" not in fin["texte"] and "abcdefgh123" in fin["texte"] and "inventee999" not in fin["texte"]
    srv = client.get(f"/api/scenarios/{s['id']}").json()
    assert srv["modifie"] == s["modifie"] and srv["reponses"][0]["statut"] == "proposee"
    demande = faux.appels[0]["messages"][0]["content"]
    assert "### Version 1" in demande and "Précision du MJ pour cette demande : drôle" in demande and "Juste avant : « …Ils entrent." in demande
    assert len(faux.appels[0]["system"]) == 3 and faux.appels[0]["output_config"]["effort"] == "high"
    client.delete(f"/api/scenarios/{s['id']}")


def test_verifier_le_canon_lit_la_bible_entiere(client, lore, monkeypatch):
    faux = FauxClient("**Conforme**. Grimbal est bien un nain.")
    monkeypatch.setattr(redaction, "CLIENT", faux)
    s, refs = scenario(client, "Grimbal arrive. [[vérifier : Grimbal est un nain]]")
    fin = evenements(client.post(f"/api/flux/scenarios/{s['id']}/consignes", json=cle(refs[0])))[-1]
    assert fin["texte"].startswith("**Conforme**")
    assert len(faux.appels[0]["system"]) == 4 and "Passages de la bible" not in faux.appels[0]["messages"][0]["content"]
    client.delete(f"/api/scenarios/{s['id']}")


def test_consigne_pnj_et_combat_creent_leurs_fiches(client, lore, monkeypatch):
    pnj = {"presentation": "Il attend au comptoir.", "pnj": {"nom": "Odon le Passeur", "surnom": "", "genre": "h", "age": "50", "peuple": "Humain",
                                                            "role": "passeur", "faction": "", "rang": "civil", "apparence": "Grand.", "voix": "Rauque.",
                                                            "envie": "Partir.", "secret": "Il ment.", "offre": "Un bac."}}
    combat = {"presentation": "Des loups sortent du bois.", "rencontre": {"nom": "Les loups du gué", "notes": "Au gué.", "avant": 1,
                                                                        "adversaires": [{"nom": "Loup", "rang": "sbire", "n": 4, "capacites": "Meute."}]}}
    monkeypatch.setattr(redaction, "CLIENT", FauxClient(json.dumps(pnj), json.dumps(combat)))
    s, refs = scenario(client, "[[pnj : un passeur]]\n\n[[combat : des loups]]\n")
    fin = evenements(client.post(f"/api/flux/scenarios/{s['id']}/consignes", json=cle(refs[0])))[-1]
    cree = next(p for p in client.get("/api/pnj").json() if p["nom"] == "Odon le Passeur")
    assert f"(#/pnj/{cree['id']})" in fin["texte"] and cree["scenario"] == s["id"] and cree["connu"] is False
    fin = evenements(client.post(f"/api/flux/scenarios/{s['id']}/consignes", json=cle(refs[1])))[-1]
    rencontre = next(r for r in client.get("/api/rencontres").json() if r["nom"] == "Les loups du gué")
    assert rencontre["adversaires"][0] | {} == {"cle": "sbire", "nom": "Loup", "rang": "sbire", "att": 45, "degats": "1D6", "armure": 0,
                                                "sante": "5", "defense": 0, "nbDef": 0, "capacites": "Meute.", "n": 4}
    assert f"(#/combats/{rencontre['id']})" in fin["texte"] and "4 × Loup" in fin["texte"]
    for chemin in (f"/api/pnj/{cree['id']}", f"/api/rencontres/{rencontre['id']}", f"/api/scenarios/{s['id']}"):
        client.delete(chemin)


def test_relecture_directe_et_differee(client, lore, monkeypatch, tmp_path):
    faux = FauxClient("- *« elle boite »* : rien à redire.\n\n**Ce qui tient** : tout.", "Relecture de nuit.")
    monkeypatch.setattr(redaction, "CLIENT", faux)
    monkeypatch.setattr(redaction, "LOTS", tmp_path / "lots.json")
    s, _ = scenario(client, "Ils entrent.")
    fin = evenements(client.post(f"/api/flux/scenarios/{s['id']}/relectures/c-1"))[-1]
    assert fin["scenario"]["relectures"]["c-1"]["texte"].startswith("- *« elle boite »*")
    assert client.post(f"/api/flux/scenarios/{s['id']}/relectures/inconnu").status_code == 404
    lot = client.post(f"/api/scenarios/{s['id']}/relectures/ensemble/differee").json()
    assert lot["etat"] == "en-cours" and client.get("/api/ia/lots").json()[0]["cible"] == {"scenario": s["id"], "chapitre": "ensemble"}
    assert "fallbacks" not in faux.messages.batches.crees[0][0]["params"]
    assert asyncio.run(redaction.relever_lots(ia_api.deposer_lot)) == 0
    assert client.get(f"/api/scenarios/{s['id']}").json()["relectures"]["ensemble"]["texte"] == "Relecture de nuit."
    assert redaction.lots()[0]["etat"] == "fait"
    client.delete(f"/api/scenarios/{s['id']}")


def test_un_lot_lance_pendant_le_releve_reste_dans_la_liste(monkeypatch, tmp_path):
    faux = FauxClient("Relecture de nuit.")
    monkeypatch.setattr(redaction, "CLIENT", faux)
    monkeypatch.setattr(redaction, "LOTS", tmp_path / "lots.json")
    redaction._ecrire_lots([{"id": "lot_a", "fonction": "relecture", "cible": {}, "cree": "2026-11-11T10:00:00", "etat": "en-cours"}])
    vrai = faux.messages.batches.retrieve

    async def pendant_l_attente(ident):
        # Pendant que le relevé attend l'API, le MJ lance un autre lot.
        redaction._ecrire_lots([*redaction.lots(), {"id": "lot_b", "fonction": "relecture", "cible": {}, "cree": "2026-11-11T10:01:00", "etat": "en-cours"}])
        return await vrai(ident)
    monkeypatch.setattr(faux.messages.batches, "retrieve", pendant_l_attente)
    deposes = []
    assert asyncio.run(redaction.relever_lots(lambda cible, texte: deposes.append(texte))) == 1
    assert deposes == ["Relecture de nuit."]
    assert {e["id"]: e["etat"] for e in redaction.lots()} == {"lot_a": "fait", "lot_b": "en-cours"}


def test_un_lot_que_l_api_ne_connait_plus_n_est_plus_redemande(monkeypatch, tmp_path):
    import anthropic
    import httpx
    faux = FauxClient()
    monkeypatch.setattr(redaction, "CLIENT", faux)
    monkeypatch.setattr(redaction, "LOTS", tmp_path / "lots.json")
    hier = redaction.datetime.now().isoformat(timespec="seconds")
    redaction._ecrire_lots([{"id": "lot_perdu", "fonction": "relecture", "cible": {}, "cree": hier, "etat": "en-cours"},
                            {"id": "lot_vieux", "fonction": "relecture", "cible": {}, "cree": "2026-01-01T10:00:00", "etat": "en-cours"},
                            {"id": "lot_lent", "fonction": "relecture", "cible": {}, "cree": redaction.datetime.now().isoformat(timespec="seconds"), "etat": "en-cours"}])
    requete = httpx.Request("GET", "https://exemple.invalid/lots")

    async def en_panne(ident):
        if ident == "lot_perdu":
            raise anthropic.NotFoundError("introuvable", response=httpx.Response(404, request=requete), body=None)
        raise anthropic.APIConnectionError(request=requete)
    monkeypatch.setattr(faux.messages.batches, "retrieve", en_panne)
    assert asyncio.run(redaction.relever_lots(lambda cible, texte: None)) == 1
    etats = {e["id"]: (e["etat"], e.get("erreur")) for e in redaction.lots()}
    assert etats["lot_perdu"] == ("erreur", "lot introuvable") and etats["lot_vieux"] == ("erreur", "sans réponse de l'API")
    assert etats["lot_lent"] == ("en-cours", None)


def test_region_peuplee_jamais_sur_l_eau(client, lore, monkeypatch):
    terrain = bytes([0] * 40 + [9] * 40)  # 10 × 8 : la moitié haute en eau, la basse en collines
    carte = client.post("/api/cartes", json={"nom": "Essai peuplé", "largeur": 10, "hauteur": 8, "km_case": 2,
                                             "terrain": base64.b64encode(terrain).decode(), "marqueurs": []}).json()
    lieux = {"lieux": [{"nom": "Le phare", "type": "tour", "x": 2, "y": 1, "resume": "r", "secrets": "s", "accroche": "a", "rumeur": "u"},
                       {"nom": "La mine — vieille", "type": "mine", "x": 5, "y": 6, "resume": "r", "secrets": "s", "accroche": "a", "rumeur": "u"}]}
    faux = FauxClient(json.dumps(lieux))
    monkeypatch.setattr(redaction, "CLIENT", faux)
    r = client.post(f"/api/cartes/{carte['id']}/peupler", json={"zone": {"x0": 0, "y0": 0, "x1": 10, "y1": 8}, "nombre": 2,
                                                                  "image": "data:image/png;base64,iVBORw0KGgo="}).json()
    assert [l["nom"] for l in r["lieux"]] == ["La mine, vieille"] and r["lieux"][0]["terrain"] == "Collines"
    contenu = faux.appels[0]["messages"][0]["content"]
    assert contenu[0]["type"] == "image" and "~~~~~~~~~~" in contenu[1]["text"] and "kkkkkkkkkk" in contenu[1]["text"]
    assert '"lieux"' in contenu[-1]["text"]
    assert client.post(f"/api/cartes/{carte['id']}/peupler", json={"zone": {"x0": 0, "y0": 0, "x1": 2, "y1": 2}}).status_code == 400
    client.delete(f"/api/cartes/{carte['id']}")


def test_fiche_de_lieu_et_plan_programme(client, lore, monkeypatch):
    lieu = client.post("/api/lieux", json={"nom": "Le Moulin", "type": "village", "resume": "Un moulin.", "secrets": "", "notes": ""}).json()
    plan = {"modele": "crypte", "nom": "La crypte — oubliée", "notes": "On descend.",
            "salles": [{"nom": "Entrée", "role": "accueil", "joueurs": "Des marches.", "notes": "", "piege": "", "indice": "Une clé.", "rencontre": ""}]}
    monkeypatch.setattr(redaction, "CLIENT", FauxClient(json.dumps({"resume": "Un moulin qui grince.", "secrets": "Le meunier ment.", "notes": "- Ambiance"}),
                                                        json.dumps(plan)))
    r = client.post(f"/api/lieux/{lieu['id']}/redaction", json={"idee": "hanté"}).json()
    assert r == {"resume": "Un moulin qui grince.", "secrets": "Le meunier ment.", "notes": "- Ambiance"}
    p = client.post("/api/plans/programme", json={"demande": "une crypte de 4 salles", "lieu": lieu["id"]}).json()
    assert p["modele"] == "crypte" and p["nom"] == "La crypte, oubliée" and p["salles"][0]["indice"] == "Une clé."
    assert client.post("/api/plans/programme", json={"demande": ""}).status_code == 400
    client.delete(f"/api/lieux/{lieu['id']}")


def test_variantes_de_pnj_et_couts(client, monkeypatch, tmp_path):
    variantes = [{k: f"{k} {i}" for k in ("apparence", "voix", "envie", "secret", "offre")} for i in range(3)]
    monkeypatch.setattr(redaction, "CLIENT", FauxClient(json.dumps({"variantes": variantes})))
    monkeypatch.setattr(redaction, "JOURNAL", tmp_path / "journal.jsonl")
    r = client.post("/api/pnj-variantes", json={"fiche": {"nom": "Odon"}, "idee": ""}).json()
    assert [v["envie"] for v in r["variantes"]] == ["envie 0", "envie 1", "envie 2"]
    c = client.get("/api/ia/couts").json()
    assert c["appels"] == 1 and c["detail"][0]["nom"] == "PNJ (variantes)" and c["disponible"] is True
    assert client.get("/api/ia/couts?mois=octobre").status_code == 400
