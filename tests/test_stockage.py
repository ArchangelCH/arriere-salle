"""commun/stockage.py : l'écriture atomique et le verrou de dossier que tout le serveur partage."""

import json
import os
import stat
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import pytest  # noqa: E402

from commun import stockage  # noqa: E402


def test_json_compact_garde_les_octets_d_avant(tmp_path):
    f = tmp_path / "a.json"
    stockage.ecrire_json_compact(f, {"nom": "Élodie", "n": [1, 2]})
    assert f.read_bytes() == json.dumps({"nom": "Élodie", "n": [1, 2]}, ensure_ascii=False, separators=(",", ":")).encode()


def test_json_aux_reglages_de_dumps_passes_tels_quels(tmp_path):
    f = tmp_path / "b.json"
    stockage.ecrire_json(f, {"é": 1})
    assert f.read_text(encoding="utf-8") == '{"\\u00e9": 1}'
    stockage.ecrire_json(f, {"é": 1}, indent=1, ensure_ascii=False)
    assert f.read_text(encoding="utf-8") == '{\n "é": 1\n}'


def test_le_mode_est_pose_avant_que_le_fichier_prenne_sa_place(tmp_path):
    f = tmp_path / "c.json"
    stockage.ecrire_texte(f, "x", mode=0o600)
    assert stat.S_IMODE(f.stat().st_mode) == 0o600
    stockage.ecrire_octets(f, b"y", mode=0o644)
    assert stat.S_IMODE(f.stat().st_mode) == 0o644 and f.read_bytes() == b"y"


def test_une_ecriture_qui_echoue_laisse_l_ancien_fichier_et_aucun_temporaire(tmp_path):
    f = tmp_path / "d.json"
    stockage.ecrire_texte(f, "ancien")
    with pytest.raises(TypeError):
        stockage.ecrire_json_compact(f, {"x": object()})
    assert f.read_text(encoding="utf-8") == "ancien"
    assert [p.name for p in tmp_path.iterdir()] == ["d.json"]


def test_ecrire_par_laisse_l_appelant_remplir_le_temporaire(tmp_path):
    f = tmp_path / "e.bin"
    stockage.ecrire_par(f, lambda tmp: tmp.write_bytes(b"\x00\x01"), mode=0o644)
    assert f.read_bytes() == b"\x00\x01" and [p.name for p in tmp_path.iterdir()] == ["e.bin"]


def test_ecritures_simultanees_jamais_a_moitie(tmp_path):
    f = tmp_path / "f.json"
    gros = ["ligne"] * 20000

    def ecrire(i):
        for _ in range(15):
            stockage.ecrire_json_compact(f, {"qui": i, "gros": gros})

    fils = [threading.Thread(target=ecrire, args=(i,)) for i in range(6)]
    for t in fils:
        t.start()
    for _ in range(100):
        if f.exists():
            assert stockage.lire_json(f)["gros"] == gros
    for t in fils:
        t.join()
    assert [p.name for p in tmp_path.iterdir()] == ["f.json"]


def test_lire_json(tmp_path):
    (tmp_path / "g.json").write_text('{"a": "é"}', encoding="utf-8")
    assert stockage.lire_json(tmp_path / "g.json") == {"a": "é"}
    with pytest.raises(ValueError):
        (tmp_path / "h.json").write_text("{", encoding="utf-8")
        stockage.lire_json(tmp_path / "h.json")


def test_verrou_de_dossier_cree_le_dossier_et_ses_droits(tmp_path):
    d = tmp_path / "x" / "y"
    with stockage.verrou_de_dossier(d, mode_dossier=0o700):
        assert (d / ".verrou").exists() and stat.S_IMODE(d.stat().st_mode) == 0o700
    d2 = tmp_path / "z"
    d2.mkdir(mode=0o755)
    os.chmod(d2, 0o755)
    with stockage.verrou_de_dossier(d2, "v", mode_dossier=0o700):
        assert stat.S_IMODE(d2.stat().st_mode) == 0o755  # un dossier existant garde ses droits...
    with stockage.verrou_de_dossier(d2, "v", mode_dossier=0o700, forcer_mode=True):
        assert stat.S_IMODE(d2.stat().st_mode) == 0o700  # ...sauf si on les impose


def test_le_verrou_est_exclusif_entre_fils(tmp_path):
    ordre = []
    entre = threading.Event()

    def premier():
        with stockage.verrou_de_dossier(tmp_path):
            entre.set()
            threading.Event().wait(0.3)
            ordre.append("premier")

    t = threading.Thread(target=premier)
    t.start()
    entre.wait()
    with stockage.verrou_de_dossier(tmp_path):
        ordre.append("second")
    t.join()
    assert ordre == ["premier", "second"]
