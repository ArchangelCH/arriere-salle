"""Rédaction : le modèle de l'API d'abord, qwen en secours, mêmes garde-fous sur le texte rendu."""
import asyncio
import json
import os
import sys
from pathlib import Path

os.environ["ANTHROPIC_API_KEY"] = ""
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ia import illustrations  # noqa: E402
from ia import redaction  # noqa: E402
from faux_modele import FauxClient  # noqa: E402


def lancer(coro):
    return asyncio.run(coro)


def test_pnj_par_l_api_avec_schema_et_contexte(monkeypatch):
    champs = dict(zip(illustrations.CHAMPS_PNJ, ("Un grand sec — mains tachées d'encre.", "Chuchote.", "Partir.",
                                                 "Il a vendu la carte.", "Un passage.")))
    faux = FauxClient(json.dumps(champs))
    monkeypatch.setattr(redaction, "CLIENT", faux)
    monkeypatch.setattr(redaction, "_CONTEXTE", lambda niveau: [{"type": "text", "text": "CONTEXTE"}])
    pnj = lancer(illustrations.proposer_pnj({"nom": "Odon", "genre": "h"}, "un copiste"))
    assert pnj["apparence"] == "Un grand sec , mains tachées d'encre."
    assert pnj["offre"] == "Un passage." and len(pnj) == 5
    appel = faux.appels[0]
    # Pas de format imposé (il romprait le cache) : le schéma part dans la demande.
    assert "format" not in appel["output_config"] and '"apparence"' in appel["messages"][0]["content"]
    assert appel["output_config"]["effort"] == "medium" and appel["fallbacks"] == "default"
    assert appel["system"] == [{"type": "text", "text": "CONTEXTE"}]
    assert "Idée du meneur : un copiste" in appel["messages"][0]["content"]


def test_panne_de_l_api_repasse_par_qwen(monkeypatch):
    monkeypatch.setattr(redaction, "CLIENT", FauxClient(erreur=RuntimeError("crédit épuisé")))
    envoye = {}

    class Reponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"response": "Ils ont trouvé la clé. Qui l'avait cachée ?"}

    class Client:
        def __init__(self, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, *a, **kw):
            envoye.update(kw["json"])
            return Reponse()

    monkeypatch.setattr(illustrations.httpx, "AsyncClient", Client)
    assert lancer(illustrations.rediger_precedemment({"resume": "clé", "questions": "Qui l'a cachée ?"})) == "Ils ont trouvé la clé. Qui l'avait cachée ?"
    # Les questions laissées en suspens partent désormais avec les notes.
    assert "Questions laissées en suspens :\nQui l'a cachée ?" in envoye["prompt"]


def test_refus_ou_sans_cle_rend_none(monkeypatch):
    monkeypatch.setattr(redaction, "CLIENT", FauxClient("x", arret="refusal"))
    assert lancer(illustrations.par_api("pnj", "c", "d")) is None
    monkeypatch.setattr(redaction, "CLIENT", None)
    assert lancer(illustrations.par_api("pnj", "c", "d")) is None


def test_prompt_anglais_sans_contexte(monkeypatch):
    faux = FauxClient('"a misty harbour at dawn, fishing boats, oil painting"')
    monkeypatch.setattr(redaction, "CLIENT", faux)
    assert lancer(illustrations.ecrire_prompt("un port brumeux")) == "a misty harbour at dawn, fishing boats, oil painting"
    assert faux.appels[0]["output_config"]["effort"] == "low"
    assert faux.appels[0]["system"][0]["text"] == illustrations.CONSIGNE


def test_variantes_de_pnj(monkeypatch):
    variantes = [{k: f"{k} {i} — fin" for k in illustrations.CHAMPS_PNJ} for i in range(3)]
    monkeypatch.setattr(redaction, "CLIENT", FauxClient(json.dumps({"variantes": variantes})))
    monkeypatch.setattr(redaction, "_CONTEXTE", lambda niveau: [])
    sortie = lancer(illustrations.proposer_pnj_variantes({"nom": "Odon"}, "", 3))
    assert len(sortie) == 3 and sortie[2]["envie"] == "envie 2 , fin"


def test_couts_et_liens(tmp_path, monkeypatch):
    monkeypatch.setattr(redaction, "JOURNAL", tmp_path / "journal.jsonl")
    source = tmp_path / "bible.md"
    source.write_text("Vu ici : [S1 E2 00:01:00](https://youtu.be/abcdefgh123?t=60).", encoding="utf-8")
    redaction.regler_sources_liens(lambda: [source])
    texte = ("Juste : [S1 E2](https://youtu.be/abcdefgh123?t=60). Inventé : [S9 E9](https://youtu.be/zzzzzzzz999?t=5) "
             "et brut https://youtu.be/yyyyyyyy888.")
    propre = redaction.verifier_liens(texte)
    assert "https://youtu.be/abcdefgh123?t=60" in propre
    assert "zzzzzzzz999" not in propre and "yyyyyyyy888" not in propre
    assert propre.count("(source à vérifier)") == 2
    faux = FauxClient("ok")
    monkeypatch.setattr(redaction, "CLIENT", faux)
    lancer(redaction.rediger("relecture", [], "x"))
    lancer(redaction.rediger("relecture", [], "y"))
    c = redaction.couts()
    # 1000 jetons d'entrée à 4 $ et 200 de sortie à 20 $ le million, deux fois.
    assert c["appels"] == 2 and abs(c["total"] - 2 * (1000 * 4 + 200 * 20) / 1e6) < 1e-6
    assert c["detail"][0]["nom"] == "Relectures" and faux.appels[0]["output_config"]["effort"] == "high"


def test_json_entoure_et_reessai(monkeypatch):
    faux = FauxClient("Pas du JSON.", '```json\n{"a": "b"}\n```')
    monkeypatch.setattr(redaction, "CLIENT", faux)
    assert lancer(redaction.rediger_json("lieu", [], "x", {"type": "object"})) == {"a": "b"}
    assert "n'était pas un objet JSON valide" in faux.appels[1]["messages"][0]["content"]
    monkeypatch.setattr(redaction, "CLIENT", FauxClient("non", "toujours non"))
    try:
        lancer(redaction.rediger_json("lieu", [], "x", {"type": "object"}))
        assert False
    except redaction.Indisponible:
        pass
