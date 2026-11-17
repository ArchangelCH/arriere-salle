#!/usr/bin/env python3
"""Fabrique une copie du dépôt recouverte par un pack de campagne (docs/campagne.md), pour y lancer les tests et les
vérifieurs avec le contenu du pack, comme dans l'image construite avec lui.

    python3 outils/superposer_campagne.py <pack> <dossier>

Le dossier de sortie est vidé puis rempli : les fichiers du dépôt (suivis ou nouveaux, hors .gitignore), puis ceux du
pack par-dessus.
"""
import shutil
import subprocess
import sys
from pathlib import Path

DEPOT = Path(__file__).resolve().parent.parent


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    pack, sortie = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    if not (pack / "app").is_dir():
        sys.exit(f"{pack} n'a pas de dossier app/ : ce n'est pas un pack de campagne")
    if sortie == DEPOT or DEPOT in sortie.parents:
        sys.exit("Le dossier de sortie doit être hors du dépôt")
    if sortie.exists():
        shutil.rmtree(sortie)
    suivis = subprocess.run(["git", "-C", str(DEPOT), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                            capture_output=True, check=True).stdout
    for nom in filter(None, suivis.decode().split("\0")):
        source = DEPOT / nom
        if source.is_file():
            cible = sortie / nom
            cible.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, cible)
    recouverts = 0
    for source in sorted(pack.rglob("*")):
        if source.is_file() and ".git" not in source.relative_to(pack).parts:
            cible = sortie / source.relative_to(pack)
            cible.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, cible)
            recouverts += 1
    print(f"{sortie} : dépôt recouvert par {recouverts} fichiers de {pack.name}")


if __name__ == "__main__":
    main()
