"""Le rangement des modules : `commun/` est tout ce que le coin des joueurs (service public) charge ; il ne dépend jamais
d'un autre paquet de l'atelier. Un import de `mj`, `ia`, `table`, `coin_mj` ou `contenu` là-dedans ferait entrer du code
et des secrets de l'atelier dans le service exposé sur Internet. Le contenu de campagne de l'atelier (`campagne/`) n'entre pas
non plus dans son image : celui dont le coin a besoin vit dans commun/campagne.py."""

import ast
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"
ATELIER = {"mj", "ia", "table", "coin_mj", "contenu", "api", "main", "campagne"}


def imports_de(chemin: Path) -> set[str]:
    trouves = set()
    for n in ast.walk(ast.parse(chemin.read_text(encoding="utf-8"))):
        if isinstance(n, ast.Import):
            trouves |= {a.name.split(".")[0] for a in n.names}
        elif isinstance(n, ast.ImportFrom) and n.level == 0 and n.module:
            trouves.add(n.module.split(".")[0])
    return trouves


def test_commun_ne_depend_pas_de_l_atelier():
    fautes = {f.name: sorted(imports_de(f) & ATELIER) for f in sorted((APP / "commun").glob("*.py"))}
    assert not {k: v for k, v in fautes.items() if v}, fautes


def test_le_coin_ne_charge_que_commun():
    assert not imports_de(APP / "joueurs.py") & ATELIER


def test_aucun_module_a_plat_de_plus():
    """À la racine de app/, seuls les deux points d'entrée : main (atelier) et joueurs (coin)."""
    assert {f.stem for f in APP.glob("*.py")} == {"main", "joueurs"}


def test_chaque_fichier_servi_au_coin_existe():
    """La liste FICHIERS de joueurs.py : ce qui n'existe pas ferait échouer la construction de l'image du coin."""
    import os
    import sys
    os.environ.setdefault("DEPOT_DIR", "/tmp/depot-essai")
    sys.path.insert(0, str(APP))
    import joueurs

    # Les jingles (sons/) viennent du pack de campagne, facultatif : docker/statique_joueurs.py s'en passe.
    manquants = sorted(f for f in joueurs.FICHIERS if not (APP / "static" / f).is_file() and not f.startswith("sons/"))
    assert manquants == [], manquants
