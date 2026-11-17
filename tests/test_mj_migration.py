"""outils/migrer_auteurs.py : « auteur » : « alban » dans chaque fiche des collections à auteur, à blanc par défaut,
idempotent, sans rien changer d'autre (ni « modifie », ni la date du fichier, ni ses droits, ni les autres dossiers)."""

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

OUTIL = Path(__file__).resolve().parent.parent / "outils" / "migrer_auteurs.py"
sys.path.insert(0, str(OUTIL.parent))

import migrer_auteurs  # noqa: E402


def compact(contenu) -> bytes:
    return json.dumps(contenu, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


@pytest.fixture
def donnees(tmp_path):
    d = tmp_path / "data"
    fiches = {
        "pnj/gaspard.json": {"id": "gaspard", "nom": "Gaspard", "secret": "é accentué", "modifie": "2026-11-01T10:00:00.000"},
        "lieux/castel.json": {"id": "castel", "nom": "Castel", "modifie": "2026-11-02T10:00:00.000"},
        "cartes/monde.json": {"id": "monde", "nom": "Monde", "terrain": "AAAA", "modifie": "2026-11-03T10:00:00.000"},
        "scenarios/quete.json": {"id": "quete", "nom": "Quête", "chapitres": [{"id": "c1", "texte": "Il était une fois"}]},
        "documents/lettre.json": {"id": "lettre", "nom": "Lettre", "texte": "Cher ami"},
        "corbeille/pnj/vieux-20261101-120000.json": {"id": "vieux", "nom": "Vieux"},
        "corbeille/aventuriers/heros-20261101-120000.json": {"id": "heros", "nom": "Héros jeté"},
        "historique/scenarios/quete/20261101-120000.json": {"id": "quete", "nom": "Quête (avant)"},
        "historique/lieux/castel/20261101-120000.json": {"id": "castel", "nom": "Castel (avant)"},
        "aventuriers/naima.json": {"id": "naima", "nom": "Naïma"},
        "regles-maison/postures.json": {"id": "postures", "titre": "Postures"},
        "campagne.json": {"nom": "Campagne"},
        "propositions/ben.json": {"joueur": "ben"},
    }
    for relatif, contenu in fiches.items():
        f = d / relatif
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(compact(contenu))
    # Déjà migrée (un autre MJ) : elle ne change pas.
    (d / "seances").mkdir()
    (d / "seances" / "s1.json").write_bytes(compact({"id": "s1", "nom": "Séance", "auteur": "lucas"}))
    # Écrite à la main, en retrait : elle prend la forme d'ecrire().
    (d / "idees" ).mkdir()
    (d / "idees" / "idee.json").write_text(json.dumps({"id": "idee", "texte": "Une idée"}, indent=2), encoding="utf-8")
    # Illisible : laissée telle quelle.
    (d / "rumeurs").mkdir()
    (d / "rumeurs" / "cassee.json").write_text("{pas du json", encoding="utf-8")
    (d / "rumeurs" / "liste.json").write_text("[1, 2]", encoding="utf-8")
    # Des dates et des droits à garder.
    for f in d.rglob("*.json"):
        os.utime(f, ns=(1_700_000_000_000_000_000, 1_700_000_000_000_000_000))
    os.chmod(d / "pnj" / "gaspard.json", 0o640)
    return d


def empreintes(d: Path) -> dict:
    return {str(f.relative_to(d)): (hashlib.sha256(f.read_bytes()).hexdigest(), f.stat().st_mtime_ns, f.stat().st_mode)
            for f in sorted(d.rglob("*")) if f.is_file()}


def test_a_blanc_rien_ne_bouge(donnees):
    avant = empreintes(donnees)
    resultat = migrer_auteurs.migrer(donnees, appliquer=False)
    assert empreintes(donnees) == avant
    c = resultat["collections"]
    assert c["pnj"]["fiches"]["a_ecrire"] == 1 and c["pnj"]["corbeille"]["a_ecrire"] == 1
    assert c["scenarios"]["historique"]["a_ecrire"] == 1 and c["seances"]["fiches"]["deja"] == 1
    assert c["rumeurs"]["fiches"]["illisibles"] == 2 and c["idees"]["fiches"]["reformatees"] == 1
    sortie = subprocess.run([sys.executable, str(OUTIL), str(donnees)], capture_output=True, text=True, check=True).stdout
    assert "Rien n'a été modifié" in sortie and "illisible : rumeurs/cassee.json" in sortie
    assert empreintes(donnees) == avant


def test_appliquee_puis_relancee(donnees):
    avant = {f: (f.read_bytes(), f.stat()) for f in donnees.rglob("*.json")}
    sortie = subprocess.run([sys.executable, str(OUTIL), str(donnees), "--appliquer"], capture_output=True, text=True,
                            check=True).stdout
    assert "9 fiche(s) écrites" in sortie, sortie
    changes = 0
    for f, (brut, stat) in avant.items():
        apres = f.read_bytes()
        relatif = f.relative_to(donnees).as_posix()
        dans_une_collection = (relatif.split("/")[0] in migrer_auteurs.COLLECTIONS
                               or relatif.split("/")[:2] in [["corbeille", c] for c in migrer_auteurs.COLLECTIONS]
                               or relatif.split("/")[:2] in [["historique", c] for c in migrer_auteurs.COLLECTIONS])
        # La date et les droits ne bougent jamais.
        assert f.stat().st_mtime_ns == stat.st_mtime_ns and f.stat().st_mode == stat.st_mode, relatif
        if apres == brut:
            continue
        changes += 1
        assert dans_une_collection, relatif
        fiche = json.loads(apres)
        assert fiche.pop("auteur") == "alban"
        # Sans le champ, le même fichier à l'octet près (ou, écrit à la main, sa forme ecrire()).
        assert compact(fiche) == brut or compact(fiche) == compact(json.loads(brut)), relatif
        assert fiche.get("modifie") == json.loads(brut).get("modifie")
    assert changes == 9
    # Rien hors des collections à auteur : la tablée, les règles, la campagne, le coin.
    for intact in ("aventuriers/naima.json", "corbeille/aventuriers/heros-20261101-120000.json", "regles-maison/postures.json",
                   "campagne.json", "propositions/ben.json", "seances/s1.json", "rumeurs/cassee.json", "rumeurs/liste.json"):
        assert (donnees / intact).read_bytes() == avant[donnees / intact][0], intact
    assert json.loads((donnees / "seances" / "s1.json").read_bytes())["auteur"] == "lucas"
    assert json.loads((donnees / "pnj" / "gaspard.json").read_bytes())["secret"] == "é accentué"
    # Relancée : rien à écrire, rien ne bouge.
    une_fois = empreintes(donnees)
    sortie = subprocess.run([sys.executable, str(OUTIL), str(donnees), "--appliquer"], capture_output=True, text=True,
                            check=True).stdout
    assert "0 fiche(s) écrites" in sortie and empreintes(donnees) == une_fois
    # Aucun fichier temporaire laissé, aucune version archivée.
    assert not list(donnees.rglob("*.tmp"))
    assert sorted(p.name for p in (donnees / "historique" / "lieux" / "castel").iterdir()) == ["20261101-120000.json"]


def test_refuse_un_dossier_qui_n_est_pas_celui_des_donnees(tmp_path):
    r = subprocess.run([sys.executable, str(OUTIL), str(tmp_path)], capture_output=True, text=True)
    assert r.returncode != 0 and "ne ressemble pas" in r.stderr
