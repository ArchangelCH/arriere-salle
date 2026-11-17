"""Le héros dont on efface puis retape le nom revient à son rang de la tablée, même la page rechargée entre-temps : son
rang et la ligne d'avant sont notés dans sa fiche quand il la quitte (la page n'en garde rien au rechargement). Le geste
lui-même est rejoué dans un navigateur (essai heros-rang.mjs du lot de finitions)."""

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
from api import application  # noqa: E402

JS = Path(__file__).resolve().parent.parent / "app" / "static" / "js"


@pytest.fixture(scope="module")
def client():
    with TestClient(application.app) as c:
        yield c


def test_la_fiche_note_le_rang_et_le_createur_s_en_sert():
    source = (JS / "aventuriers" / "createur.js").read_text(encoding="utf-8")
    quitter = source[source.index("  quitterSansNom() {"):source.index("  rejoindreAuNom() {")]
    assert "a.rang_tablee = rang;" in quitter and 'a.apres_tablee = rang > 0 ? tablee[rang - 1].id || "" : "";' in quitter
    synchro = source[source.index("  async synchroniserTablee("):]
    synchro = synchro[:synchro.index("\n  }\n")]
    # Vue partir sur cette page : sa place gardée en mémoire d'abord ; sinon celle de sa fiche ; sinon au bout.
    ordre = [synchro.index(x) for x in ("else if (retiree)", "else if (garde && Number.isInteger(a.rang_tablee)) t.splice(rangNote(t, a), 0, ligne);",
                                         "else t.push(ligne);")]
    assert ordre == sorted(ordre)
    regle = re.search(r"function rangNote\(t, a\) \{(.*?)\n\}", source, flags=re.S).group(1)
    assert 'if (a.apres_tablee === "") return 0;' in regle and "avant >= 0 ? avant + 1" in regle


def test_le_rang_note_survit_a_l_enregistrement(client):
    """Les deux champs passent tels quels par l'enregistrement d'un aventurier de l'atelier."""
    a = client.post("/api/aventuriers", json={"nom": "Héros du rang", "tablee": True}).json()
    lue = client.get(f"/api/aventuriers/{a['id']}").json()
    r = client.put(f"/api/aventuriers/{a['id']}", json={**lue, "nom": "", "tablee": False, "tablee_au_nom": True, "ligne_tablee": "abc123",
                                                         "rang_tablee": 2, "apres_tablee": "xyz789", "version_base": lue["modifie"]})
    assert r.status_code == 200
    relue = client.get(f"/api/aventuriers/{a['id']}").json()
    assert (relue["ligne_tablee"], relue["rang_tablee"], relue["apres_tablee"]) == ("abc123", 2, "xyz789")
    client.delete(f"/api/aventuriers/{a['id']}")
