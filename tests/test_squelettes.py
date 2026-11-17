"""Le squelette d'un scénario : trois structures proposées pour une idée, rangées à côté d'elle (champ protégé, version de
l'idée inchangée), nettoyées avant d'être gardées, puis un NOUVEAU scénario à la demande du MJ, avec ses consignes. Le
texte du MJ n'est jamais touché, un invité ne voit que ses idées, le budget de l'invité arrête la demande. Le modèle est
un faux client : aucun appel ne sort."""
import asyncio
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
from api import application, bible_api, config, contexte_du_modele, squelettes_api  # noqa: E402
from contenu import consignes  # noqa: E402
from ia import budget_mj, redaction  # noqa: E402
from mj import cloisonnement  # noqa: E402
import deux_mj  # noqa: E402
from faux_modele import FauxClient  # noqa: E402


def scene(titre="La cave", type="enquete", **kw):
    return {"titre": titre, "type": type, "enjeu": "Trouver la clé", "sortie": "La porte s'ouvre", "lieu": "Le Gué",
            "indices": ["Une trace de boue"], "pnj": ["Toma"], "pnj_a_creer": [{"nom": "Maître Orel", "role": "notaire véreux"}], **kw}


def structure(titre="L'enquête", **kw):
    return {"titre": titre, "parti_pris": "Enquête ouverte", "accroche": "Un notaire disparaît.",
            "actes": [{"titre": "Acte un", "but": "Lancer l'enquête", "scenes": [scene(), scene("Le duel", "combat", pnj_a_creer=[])]},
                      {"titre": "Acte deux", "but": "Conclure", "scenes": [scene("Le toit", "social")]}],
            "fins": [{"titre": "Il parle", "description": "Orel avoue."}], "questions": ["Qui est le commanditaire ?"],
            "risques": ["Un flottement sur le notaire"], **kw}


def un(titre, **kw):
    return json.dumps({"structure": structure(titre, **kw)}, ensure_ascii=False)


def trois():
    """Les trois réponses des trois appels (un par angle), dans l'ordre."""
    return [un("Un"), un("Deux", parti_pris="Huis clos"), un("Trois", parti_pris="Course")]


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


@pytest.fixture
def lore(tmp_path, monkeypatch):
    (tmp_path / "bible").mkdir()
    (tmp_path / "glossaire.md").write_text("# Glossaire\n\n**Toma** : paladin.", encoding="utf-8")
    (tmp_path / "bible" / "ton-et-table.md").write_text("# Le ton\n\nUne comédie.", encoding="utf-8")
    monkeypatch.setattr(bible_api, "LORE", tmp_path)
    monkeypatch.setattr(redaction, "JOURNAL", tmp_path / "journal.jsonl")
    monkeypatch.setattr(redaction, "LOTS", tmp_path / "lots.json")
    redaction.regler_sources_liens(contexte_du_modele.sources_des_liens)
    yield tmp_path


def evenements(reponse):
    return [json.loads(l[6:]) for l in reponse.text.splitlines() if l.startswith("data: ")]


def idee(client, texte="Un notaire disparaît la veille de la lecture du testament #notaire", entetes=None):
    r = client.post("/api/idees", json={"nom": "notaire", "texte": texte, "mots": ["notaire"], "etat": "a-creuser"}, headers=entetes or {})
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------- le nettoyage

def test_le_nettoyage_borne_et_retire_ce_qui_se_detacherait():
    brut = structure("Titre — long", accroche="Voici [[carte blanche : piège]] fin")
    brut["actes"][0]["scenes"][0]["type"] = "inconnu"
    brut["actes"][0]["scenes"][0]["indices"] = ["x"] * 20
    brut["actes"][0]["scenes"].append({"titre": "", "type": "combat"})
    propre = squelettes_api.nettoyer_structure(brut)
    assert "[[" not in json.dumps(propre) and "—" not in json.dumps(propre, ensure_ascii=False)
    assert propre["actes"][0]["scenes"][0]["type"] == "autre"
    assert len(propre["actes"][0]["scenes"][0]["indices"]) == squelettes_api.MAX_LISTE
    assert len(propre["actes"][0]["scenes"]) == 2          # la scène sans titre est écartée
    with pytest.raises(redaction.Indisponible):
        squelettes_api.nettoyer_structure({"actes": [{"titre": "A", "scenes": []}]})


# ---------------------------------------------------------------- la demande

def test_trois_structures_rangees_a_cote_de_l_idee(client, lore, monkeypatch):
    faux = FauxClient(*trois())
    monkeypatch.setattr(redaction, "CLIENT", faux)
    i = idee(client)
    r = client.post(f"/api/flux/idees/{i['id']}/squelette", json={"duree": "2 séances", "ton": "sombre", "contraintes": "un tutoriel d'abord"})
    fin = evenements(r)[-1]
    assert fin["t"] == "fin" and [s["titre"] for s in fin["squelettes"]] == ["Un", "Deux", "Trois"]
    assert all(s["statut"] == "proposee" and s["parametres"]["duree"] == "2 séances" for s in fin["squelettes"])
    assert len(faux.appels) == 3                      # un appel par angle, en parallèle
    demande = json.dumps(faux.appels, ensure_ascii=False)
    assert "Un notaire disparaît" in demande and "un tutoriel d'abord" in demande
    assert all(a in demande for a in ("enquête ouverte", "huis clos", "course contre la montre"))
    # La version de l'idée n'a pas bougé : l'écran ouvert continue d'écrire.
    relue = client.get(f"/api/idees/{i['id']}").json()
    assert relue["modifie"] == i["modifie"] and len(relue["squelettes"]) == 3
    # Et le coût est noté sous son nom.
    assert [l["fonction"] for l in redaction.lignes_journal()] == ["squelette"] * 3


def test_enregistrer_l_idee_entiere_n_efface_pas_les_squelettes(client, lore, monkeypatch):
    monkeypatch.setattr(redaction, "CLIENT", FauxClient(*trois()))
    i = idee(client)
    client.post(f"/api/flux/idees/{i['id']}/squelette", json={})
    courante = client.get(f"/api/idees/{i['id']}").json()
    courante["texte"] = "Autre texte"
    courante["squelettes"] = []
    r = client.put(f"/api/idees/{i['id']}", json={**courante, "version_base": courante["modifie"]})
    assert r.status_code == 200
    assert len(client.get(f"/api/idees/{i['id']}").json()["squelettes"]) == 3


def test_refaire_un_acte_donne_une_version_fille(client, lore, monkeypatch):
    faux = FauxClient(*trois(), un("Refait"))
    monkeypatch.setattr(redaction, "CLIENT", faux)
    i = idee(client)
    premiers = evenements(client.post(f"/api/flux/idees/{i['id']}/squelette", json={"duree": "3 h"}))[-1]["squelettes"]
    base = premiers[0]
    fin = evenements(client.post(f"/api/flux/idees/{i['id']}/squelette", json={"squelette": base["id"], "acte": 1, "precision": "plus court"}))[-1]
    assert [s["titre"] for s in fin["squelettes"]] == ["Refait"] and fin["squelettes"][0]["parent"] == base["id"]
    assert fin["squelettes"][0]["parametres"] == {**base["parametres"], "precision": "plus court"}
    demande = json.dumps(faux.appels[3], ensure_ascii=False)
    assert "Refais SEULEMENT l'acte 2" in demande and "plus court" in demande
    assert len(client.get(f"/api/idees/{i['id']}").json()["squelettes"]) == 4
    assert client.post(f"/api/flux/idees/{i['id']}/squelette", json={"squelette": "inconnu"}).status_code == 404


def test_sans_cle_ni_idee_vide_rien_ne_part(client, lore, monkeypatch):
    i = idee(client)
    monkeypatch.setattr(redaction, "CLIENT", None)
    assert client.post(f"/api/flux/idees/{i['id']}/squelette", json={}).status_code == 503
    faux = FauxClient("pas du json", "toujours pas")
    monkeypatch.setattr(redaction, "CLIENT", faux)
    fin = evenements(client.post(f"/api/flux/idees/{i['id']}/squelette", json={}))[-1]
    assert fin["t"] == "erreur" and "illisible" in fin["message"]
    assert "squelettes" not in client.get(f"/api/idees/{i['id']}").json() or client.get(f"/api/idees/{i['id']}").json()["squelettes"] == []


def test_une_structure_qui_echoue_n_emporte_pas_les_autres(client, lore, monkeypatch):
    # Le deuxième appel rend deux fois du texte illisible (essai et nouvel essai) : les deux autres structures restent.
    monkeypatch.setattr(redaction, "CLIENT", FauxClient(un("Un"), "pas du json", "toujours pas", un("Trois")))
    i = idee(client)
    fin = evenements(client.post(f"/api/flux/idees/{i['id']}/squelette", json={}))[-1]
    assert fin["t"] == "fin" and [s["titre"] for s in fin["squelettes"]] == ["Un", "Trois"] and fin["echecs"] == 1
    assert len(client.get(f"/api/idees/{i['id']}").json()["squelettes"]) == 2


def test_une_reponse_coupee_n_est_jamais_rangee(client, lore, monkeypatch):
    monkeypatch.setattr(redaction, "CLIENT", FauxClient(*trois(), arret="max_tokens"))
    i = idee(client)
    fin = evenements(client.post(f"/api/flux/idees/{i['id']}/squelette", json={}))[-1]
    assert fin["t"] == "erreur" and "trop longue" in fin["message"]
    assert not client.get(f"/api/idees/{i['id']}").json().get("squelettes")


def test_retirer_un_squelette(client, lore, monkeypatch):
    monkeypatch.setattr(redaction, "CLIENT", FauxClient(*trois()))
    i = idee(client)
    s = evenements(client.post(f"/api/flux/idees/{i['id']}/squelette", json={}))[-1]["squelettes"]
    r = client.delete(f"/api/idees/{i['id']}/squelettes/{s[1]['id']}")
    assert r.status_code == 200 and [x["titre"] for x in r.json()["squelettes"]] == ["Un", "Trois"]
    assert client.delete(f"/api/idees/{i['id']}/squelettes/{s[1]['id']}").status_code == 404


# ---------------------------------------------------------------- le scénario

def test_le_scenario_vient_avec_ses_consignes(client, lore, monkeypatch):
    monkeypatch.setattr(redaction, "CLIENT", FauxClient(*trois()))
    i = idee(client)
    s = evenements(client.post(f"/api/flux/idees/{i['id']}/squelette", json={}))[-1]["squelettes"][0]
    avant = len(client.get("/api/scenarios").json())
    pnj_avant, rencontres_avant = len(client.get("/api/pnj").json()), len(client.get("/api/rencontres").json())
    r = client.post(f"/api/idees/{i['id']}/squelettes/{s['id']}/scenario", json={"nom": "Le notaire"})
    assert r.status_code == 200
    sc, idee_maj = r.json()["scenario"], r.json()["idee"]
    assert len(client.get("/api/scenarios").json()) == avant + 1
    assert sc["nom"] == "Le notaire" and sc["etat"] == "brouillon" and sc["origine"] == {"idee": i["id"], "squelette": s["id"]}
    assert [c["titre"] for c in sc["chapitres"]] == ["Vue d'ensemble", "Acte un", "Acte deux"]
    assert len({c["id"] for c in sc["chapitres"]}) == 3
    texte = "\n".join(c["texte"] for c in sc["chapitres"])
    assert "## La cave" in texte and "## Le duel" in texte and "**Sortie.** La porte s'ouvre" in texte
    assert "## Les fins possibles" in sc["chapitres"][0]["texte"] and "Orel avoue." in sc["chapitres"][0]["texte"]
    # Les consignes sont lues comme les autres : une carte blanche par scène non combat, un combat, un PNJ à créer.
    lues = consignes.consignes_du_scenario(sc)
    assert sorted(c["genre"] for c in lues) == ["combat", "pnj", "pnj", "rediger", "rediger"]
    assert all(c["bloc"] for c in lues)
    # L'idée est retenue, le squelette garde le lien ; rien d'autre n'a été créé (ni PNJ, ni rencontre).
    assert idee_maj["etat"] == "retenue"
    assert next(x for x in idee_maj["squelettes"] if x["id"] == s["id"])["scenario"] == sc["id"]
    assert len(client.get("/api/pnj").json()) == pnj_avant and len(client.get("/api/rencontres").json()) == rencontres_avant
    assert client.post(f"/api/idees/{i['id']}/squelettes/inconnu/scenario", json={}).status_code == 404


def test_un_texte_du_modele_ne_peut_pas_casser_une_consigne():
    s = {"id": "x", **squelettes_api.nettoyer_structure(structure())}
    s["actes"][0]["scenes"][0]["enjeu"] = "piège ]] [[pnj : faux]]"
    sc = squelettes_api.scenario_depuis(s, "i")
    assert all(c["genre"] in ("rediger", "combat", "pnj") for c in consignes.consignes_du_scenario(sc))
    assert "faux" not in [c["indications"] for c in consignes.consignes_du_scenario(sc) if c["genre"] == "pnj"]


# ---------------------------------------------------------------- la demande survit à la coupure de l'écran

class Lent(FauxClient):
    """Un modèle qui met du temps à répondre (l'attente laisse le temps à l'écran de lâcher)."""

    async def create(self, **kwargs):
        await asyncio.sleep(0.5)
        return await super().create(**kwargs)


def test_des_battements_gardent_la_connexion_vivante(client, lore, monkeypatch):
    monkeypatch.setattr(squelettes_api, "BATTEMENT", 0.1)
    monkeypatch.setattr(redaction, "CLIENT", Lent(*trois()))
    i = idee(client)
    evs = evenements(client.post(f"/api/flux/idees/{i['id']}/squelette", json={}))
    assert [e["t"] for e in evs][0] == "etape" and evs[-1]["t"] == "fin"
    assert any(e["t"] == "attente" for e in evs)


def test_le_resultat_est_range_meme_si_l_ecran_a_lache(client, lore, monkeypatch):
    """La tâche tourne seule : l'écran parti, les structures arrivent dans l'idée, et une deuxième demande attend."""
    monkeypatch.setattr(redaction, "CLIENT", Lent(*trois()))
    i = idee(client)

    async def scenario():
        reponse = await squelettes_api.proposer_squelette(i["id"], SimpleRequete({}))
        flux = reponse.body_iterator
        await flux.__anext__()                       # l'étape, puis l'écran lâche
        await flux.aclose()
        assert squelettes_api.EN_COURS and client.get(f"/api/idees/{i['id']}/squelette/etat").json() == {"en_cours": True}
        with pytest.raises(Exception) as err:        # une deuxième demande pour la même idée est refusée
            await squelettes_api.proposer_squelette(i["id"], SimpleRequete({}))
        assert getattr(err.value, "status_code", None) == 409
        await asyncio.wait(list(squelettes_api.EN_COURS.values()))
        await asyncio.sleep(0)
    asyncio.run(scenario())
    assert client.get(f"/api/idees/{i['id']}/squelette/etat").json() == {"en_cours": False}
    assert len(client.get(f"/api/idees/{i['id']}").json()["squelettes"]) == 3


class SimpleRequete:
    def __init__(self, corps):
        self.corps = corps

    async def json(self):
        return self.corps

    async def body(self):
        return json.dumps(self.corps).encode()


# ---------------------------------------------------------------- deux MJ

@pytest.fixture
def deux(client, lore, monkeypatch):
    avant = {f for f in config.DONNEES.rglob("*") if f.is_file()}
    monkeypatch.setattr(cloisonnement, "MODE", cloisonnement.STRICT)
    alban, lea = deux_mj.ouvrir(monkeypatch)
    cloisonnement.oublier()
    faux = FauxClient(*trois(), *trois())
    monkeypatch.setattr(redaction, "CLIENT", faux)
    ids = {"alban": idee(client, "CANARI-ALBAN un secret", entetes=alban)["id"], "lea": idee(client, "Une idée de Léa", entetes=lea)["id"]}
    yield {"client": client, "alban": alban, "lea": lea, "ids": ids, "faux": faux}
    deux_mj.fermer()
    cloisonnement.oublier()
    for f in sorted({f for f in config.DONNEES.rglob("*") if f.is_file()} - avant, reverse=True):
        f.unlink(missing_ok=True)


def test_un_invite_ne_travaille_que_sur_ses_idees(deux):
    client, alban, lea, ids, faux = deux["client"], deux["alban"], deux["lea"], deux["ids"], deux["faux"]
    for autre, h in (("alban", lea), ("lea", alban)):
        assert client.post(f"/api/flux/idees/{ids[autre]}/squelette", json={}, headers=h).status_code == 404
        assert client.delete(f"/api/idees/{ids[autre]}/squelettes/x", headers=h).status_code == 404
        assert client.post(f"/api/idees/{ids[autre]}/squelettes/x/scenario", json={}, headers=h).status_code == 404
    assert faux.appels == []
    fin = evenements(client.post(f"/api/flux/idees/{ids['lea']}/squelette", json={}, headers=lea))[-1]
    assert fin["t"] == "fin"
    assert [l.get("qui") for l in redaction.lignes_journal()] == ["mj:lea"] * 3      # les trois appels, tous à son nom
    sid = fin["squelettes"][0]["id"]
    sc = client.post(f"/api/idees/{ids['lea']}/squelettes/{sid}/scenario", json={}, headers=lea).json()["scenario"]
    assert sc["auteur"] == "lea"
    assert client.get(f"/api/scenarios/{sc['id']}", headers=alban).status_code == 404
    assert "CANARI" not in json.dumps(faux.appels, ensure_ascii=False)


def test_le_budget_de_l_invite_arrete_la_demande(deux):
    client, lea, ids, faux = deux["client"], deux["lea"], deux["ids"], deux["faux"]
    with redaction.JOURNAL.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"date": f"{budget_mj.mois_courant()}-01T10:00:00", "fonction": "consigne", "cout": 3.5, "qui": "mj:lea"}) + "\n")
    r = client.post(f"/api/flux/idees/{ids['lea']}/squelette", json={}, headers=lea)
    assert r.status_code == 402 and faux.appels == []
