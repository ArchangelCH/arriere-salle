"""outils/comparer_reponses.py : l'instantané des réponses GET ne touche pas aux données, couvre chaque route GET, et la
comparaison voit une différence (sauf le champ « auteur » avec --sans-auteur)."""

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
OUTIL = RACINE / "outils" / "comparer_reponses.py"


def instantane(donnees: Path, sortie: Path, *options):
    env = {**os.environ, "LORE_DIR": str(donnees.parent / "lore"), "PYTHONDONTWRITEBYTECODE": "1"}
    env.pop("DATA_DIR", None)
    return subprocess.run([sys.executable, str(OUTIL), "instantane", "--code", str(RACINE / "app"), "--donnees", str(donnees),
                           "--sortie", str(sortie), *options], capture_output=True, text=True, env=env, timeout=300)


def comparer(a: Path, b: Path, *options):
    return subprocess.run([sys.executable, str(OUTIL), "comparer", str(a), str(b), *options], capture_output=True, text=True)


def empreintes(d: Path) -> dict:
    return {str(f.relative_to(d)): hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(d.rglob("*")) if f.is_file()}


def test_instantane_et_comparaison(tmp_path):
    donnees = tmp_path / "data"
    (donnees / "pnj").mkdir(parents=True)
    (donnees / "lieux").mkdir()
    (donnees / "pnj" / "gaspard.json").write_text(json.dumps({"id": "gaspard", "nom": "Gaspard", "connu": True,
                                                              "modifie": "2026-11-01T10:00:00.000"}), encoding="utf-8")
    (donnees / "lieux" / "castel.json").write_text(json.dumps({"id": "castel", "nom": "Castel", "connu": True}), encoding="utf-8")
    # La clé des jetons de la TV : sans elle, chaque instantané en tirerait une autre (et d'autres adresses).
    (donnees / ".cle-jetons").write_text("ab" * 32, encoding="utf-8")
    (tmp_path / "lore").mkdir()
    avant = empreintes(donnees)
    r = instantane(donnees, tmp_path / "a.json")
    assert r.returncode == 0, r.stderr[-2000:]
    assert "0 route(s) non couverte(s)" in r.stdout
    assert empreintes(donnees) == avant
    a = json.loads((tmp_path / "a.json").read_text(encoding="utf-8"))
    assert a["reponses"]["/api/pnj/gaspard"]["statut"] == 200 and "/api/table/heros" in a["reponses"]
    assert instantane(donnees, tmp_path / "b.json").returncode == 0
    assert comparer(tmp_path / "a.json", tmp_path / "b.json").returncode == 0
    # Le champ « auteur » posé par la migration : une différence, sauf --sans-auteur.
    (donnees / "pnj" / "gaspard.json").write_text(json.dumps({"id": "gaspard", "nom": "Gaspard", "connu": True,
                                                              "modifie": "2026-11-01T10:00:00.000", "auteur": "alban"}),
                                                  encoding="utf-8")
    assert instantane(donnees, tmp_path / "c.json").returncode == 0
    r = comparer(tmp_path / "a.json", tmp_path / "c.json")
    assert r.returncode == 1 and "DIFFÉRENTE /api/pnj/gaspard" in r.stdout
    assert comparer(tmp_path / "a.json", tmp_path / "c.json", "--sans-auteur").returncode == 0
    # En ligne, avec l'ancien cookie d'Alban : les mêmes réponses, sauf l'adresse publique que disent la télécommande et
    # la liste des MJ, et « sur le réseau local » que dit le bloc des appareils (porte_lan.py).
    r = instantane(donnees, tmp_path / "d.json", "--en-ligne")
    assert r.returncode == 0, r.stderr[-2000:]
    d = json.loads((tmp_path / "d.json").read_text(encoding="utf-8"))
    assert d["reponses"]["/api/pnj/gaspard"]["statut"] == 200
    assert comparer(tmp_path / "c.json", tmp_path / "d.json", "--attendues", "/api/telecommande,/api/mj/comptes,/api/mj/appareils").returncode == 0


def test_les_autres_portes(tmp_path):
    """La table publique et l'atelier vus d'Internet sans session, une session ouverte par le formulaire (avec ou sans
    identifiant), et le coin des joueurs avec la session de chaque joueur : chaque porte a son instantané, et les sessions
    fabriquées par un instantané tiennent dans le suivant (--cookies)."""
    sys.path.insert(0, str(RACINE / "app"))
    from commun import acces
    from commun import comptes

    donnees = tmp_path / "data"
    (donnees / "pnj").mkdir(parents=True)
    (donnees / "pnj" / "gaspard.json").write_text(json.dumps({"id": "gaspard", "nom": "Gaspard", "connu": True,
                                                              "modifie": "2026-11-01T10:00:00.000"}), encoding="utf-8")
    (donnees / ".cle-jetons").write_text("ab" * 32, encoding="utf-8")
    depot = donnees / "propositions"
    depot.mkdir()
    jeton = hashlib.sha256(b"jeton-de-lea").hexdigest()
    (depot / ".acces.json").write_text(json.dumps({"joueurs": [{"id": "lea", "nom": "Léa", "jeton": jeton},
                                                               {"id": "noe", "nom": "Noé", "jeton": hashlib.sha256(b"n").hexdigest()}]}),
                                       encoding="utf-8")
    (depot / ".cle-session").write_text("cd" * 32, encoding="utf-8")
    comptes.creer(depot, "lea", jeton, "lea", acces.empreinte("le mot de passe de lea"))
    (tmp_path / "lore").mkdir()

    r = instantane(donnees, tmp_path / "table.json", "--table-publique")
    assert r.returncode == 0, r.stderr[-2000:]
    table = json.loads((tmp_path / "table.json").read_text(encoding="utf-8"))["reponses"]
    # Depuis Internet, la table publique ne lit que ce que la TV montre : ici, rien d'autre que sa page.
    assert table["/api/pnj/gaspard"]["statut"] == 404 and table["/table"]["statut"] == 200

    r = instantane(donnees, tmp_path / "nue.json", "--en-ligne", "--sans-session")
    assert r.returncode == 0, r.stderr[-2000:]
    nue = json.loads((tmp_path / "nue.json").read_text(encoding="utf-8"))["reponses"]
    assert nue["/api/pnj/gaspard"]["statut"] == 401 and nue["/connexion"]["statut"] == 200

    assert instantane(donnees, tmp_path / "ancien.json", "--en-ligne").returncode == 0
    for identifiant in ("", "MJ", "Alban"):
        r = instantane(donnees, tmp_path / "cnx.json", "--en-ligne", "--connexion", "--identifiant", identifiant)
        assert r.returncode == 0, r.stderr[-2000:]
        assert comparer(tmp_path / "ancien.json", tmp_path / "cnx.json").returncode == 0

    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    env.pop("DATA_DIR", None)
    env.pop("DEPOT_DIR", None)
    coin = [sys.executable, str(OUTIL), "coin", "--code", str(RACINE / "app"), "--donnees", str(donnees)]
    avant = empreintes(donnees)
    r = subprocess.run([*coin, "--sortie", str(tmp_path / "coin-a.json")], capture_output=True, text=True, env=env, timeout=300)
    assert r.returncode == 0, r.stderr[-2000:]
    assert "0 route(s) non couverte(s)" in r.stdout
    assert empreintes(donnees) == avant
    a = json.loads((tmp_path / "coin-a.json").read_text(encoding="utf-8"))
    assert a["reponses"]["- /api/moi"]["statut"] == 401
    assert a["reponses"]["lea /api/moi"]["statut"] == 200 and a["reponses"]["lea /api/moi"]["corps"]["joueur"] == "Léa"
    # Noé n'a pas de compte : l'ancien cookie d'avant les comptes, qui ne vaut qu'invitation.
    assert a["reponses"]["noe /api/moi"]["statut"] == 401
    r = subprocess.run([*coin, "--sortie", str(tmp_path / "coin-b.json"), "--cookies", str(tmp_path / "coin-a.json")],
                       capture_output=True, text=True, env=env, timeout=300)
    assert r.returncode == 0, r.stderr[-2000:]
    assert comparer(tmp_path / "coin-a.json", tmp_path / "coin-b.json").returncode == 0


def test_sans_auteur_et_versions_gardees(tmp_path):
    """La migration écrit aussi les versions gardées (historique/) : leur liste en dit la taille, qui grandit du champ.
    --sans-auteur ne la compare pas ; sans l'option, la différence se voit. Et outils/migrer_auteurs.py ne change rien
    d'autre aux réponses : ni la date, ni « modifie », ni ce que lit la TV."""
    donnees = tmp_path / "data"
    fiche = {"id": "gaspard", "nom": "Gaspard", "connu": True, "modifie": "2026-11-01T10:00:00.000"}
    (donnees / "pnj").mkdir(parents=True)
    (donnees / "pnj" / "gaspard.json").write_text(json.dumps(fiche, separators=(",", ":")), encoding="utf-8")
    (donnees / "historique" / "pnj" / "gaspard").mkdir(parents=True)
    (donnees / "historique" / "pnj" / "gaspard" / "20261101-100000.json").write_text(
        json.dumps({**fiche, "nom": "Gaspard le jeune"}, separators=(",", ":")), encoding="utf-8")
    (donnees / "corbeille" / "pnj").mkdir(parents=True)
    (donnees / "corbeille" / "pnj" / "pinson-20261101-100000.json").write_text(
        json.dumps({"id": "pinson", "nom": "Le Pinson"}, separators=(",", ":")), encoding="utf-8")
    (donnees / ".cle-jetons").write_text("ab" * 32, encoding="utf-8")
    (tmp_path / "lore").mkdir()
    assert instantane(donnees, tmp_path / "a.json").returncode == 0
    r = subprocess.run([sys.executable, str(RACINE / "outils" / "migrer_auteurs.py"), str(donnees), "--appliquer"],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert '"auteur":"alban"' in (donnees / "historique" / "pnj" / "gaspard" / "20261101-100000.json").read_text(encoding="utf-8")
    assert instantane(donnees, tmp_path / "b.json").returncode == 0
    r = comparer(tmp_path / "a.json", tmp_path / "b.json")
    assert r.returncode == 1 and "DIFFÉRENTE /api/versions/pnj/gaspard " in r.stdout
    r = comparer(tmp_path / "a.json", tmp_path / "b.json", "--sans-auteur")
    assert r.returncode == 0, r.stdout


def test_la_tv_montre_un_plan(tmp_path):
    """--tv : ce que montre la TV dans la copie. Table publique et table du coin ouvertes, le plan montré se lit depuis
    Internet (et lui seul), et le coin le reçoit après la publication de l'atelier (--publier)."""
    sys.path.insert(0, str(RACINE / "app"))
    from commun import acces
    from commun import comptes

    donnees = tmp_path / "data"
    (donnees / "plans").mkdir(parents=True)
    plan = {"id": "cour", "nom": "Cour", "largeur": 3, "hauteur": 2, "brouillard_actif": False, "sol": [2] * 6,
            "piece": [1] * 6, "pieces": [{"id": 1, "nom": "Cour", "genre": "salle"}], "portes": [], "objets": [], "textes": [],
            "pions": [], "modifie": "2026-11-01T10:00:00.000"}
    for ident in ("cour", "cave"):
        (donnees / "plans" / f"{ident}.json").write_text(json.dumps({**plan, "id": ident}), encoding="utf-8")
    (donnees / ".cle-jetons").write_text("ab" * 32, encoding="utf-8")
    (donnees / "table-publique.json").write_text(json.dumps({"ouverte": True}), encoding="utf-8")
    (donnees / "table-joueurs.json").write_text(json.dumps({"ouverte": True}), encoding="utf-8")
    depot = donnees / "propositions"
    depot.mkdir()
    jeton = hashlib.sha256(b"jeton-de-lea").hexdigest()
    (depot / ".acces.json").write_text(json.dumps({"joueurs": [{"id": "lea", "nom": "Léa", "jeton": jeton}]}), encoding="utf-8")
    (depot / ".cle-session").write_text("cd" * 32, encoding="utf-8")
    comptes.creer(depot, "lea", jeton, "lea", acces.empreinte("le mot de passe de lea"))
    (tmp_path / "lore").mkdir()
    tv = json.dumps({"vue": "plan", "plan": "cour"})

    r = instantane(donnees, tmp_path / "table.json", "--table-publique", "--tv", tv)
    assert r.returncode == 0, r.stderr[-2000:]
    lus = {k for k, v in json.loads((tmp_path / "table.json").read_text(encoding="utf-8"))["reponses"].items()
           if k.startswith("/api/table/plan/") and v["statut"] == 200}
    assert len(lus) == 1

    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "LORE_DIR": str(tmp_path / "lore")}
    env.pop("DATA_DIR", None)
    env.pop("DEPOT_DIR", None)
    r = subprocess.run([sys.executable, str(OUTIL), "coin", "--code", str(RACINE / "app"), "--donnees", str(donnees),
                        "--sortie", str(tmp_path / "coin.json"), "--publier", "1", "--tv", tv],
                       capture_output=True, text=True, env=env, timeout=300)
    assert r.returncode == 0, r.stderr[-2000:]
    table = json.loads((tmp_path / "coin.json").read_text(encoding="utf-8"))["reponses"]["lea /api/table"]
    assert table["statut"] == 200 and table["corps"]["ouverte"] is True and table["corps"]["vue"]["genre"] == "plan"
    # La copie seule a changé : les données d'origine ne montrent rien.
    assert not (donnees / "table.json").exists()


def test_l_ancien_cookie_sur_des_donnees_qui_ont_deja_leurs_comptes(tmp_path):
    """Des données copiées du service, avec data/mj/comptes.json et le mot de passe d'Alban : la porte « ancien cookie »
    (--en-ligne) répondait 401 partout depuis MJ-0/1. Le principal de la copie prend le mot de passe de l'instantané, la
    fenêtre de 30 jours est rouverte : elle répond comme le réseau local. Les données d'origine ne bougent pas."""
    sys.path.insert(0, str(RACINE / "app"))
    from mj import comptes_mj

    donnees = tmp_path / "data"
    (donnees / "pnj").mkdir(parents=True)
    (donnees / "pnj" / "gaspard.json").write_text(json.dumps({"id": "gaspard", "nom": "Gaspard", "connu": True}), encoding="utf-8")
    (donnees / ".cle-jetons").write_text("ab" * 32, encoding="utf-8")
    (tmp_path / "lore").mkdir()
    autre = "scrypt:1024:8:1:" + "00" * 16 + ":" + "11" * 32  # le mot de passe d'Alban, que l'outil ne connaît pas
    principal = comptes_mj.nouveau_principal(autre, autre, "2026-11-09T12:00:00.000")
    principal["generation"] = 2
    (donnees / "mj").mkdir()
    (donnees / "mj" / "comptes.json").write_text(json.dumps({"comptes": [principal], "ancien_cookie": {"fin": 1, "generation": 1}}),
                                                 encoding="utf-8")
    avant = empreintes(donnees)
    assert instantane(donnees, tmp_path / "lan.json").returncode == 0
    r = instantane(donnees, tmp_path / "ligne.json", "--en-ligne")
    assert r.returncode == 0, r.stderr[-2000:]
    assert empreintes(donnees) == avant
    lan, ligne = (json.loads((tmp_path / f).read_text(encoding="utf-8"))["reponses"] for f in ("lan.json", "ligne.json"))
    assert ligne["/api/pnj/gaspard"]["statut"] == 200 and ligne["/api/pnj/gaspard"] == lan["/api/pnj/gaspard"]
    statuts = [x["statut"] for k, x in ligne.items() if k.startswith("/api/")]
    assert statuts.count(401) == 0, [k for k, x in ligne.items() if x["statut"] == 401][:5]
