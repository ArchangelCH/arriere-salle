"""La carte des routes : chaque méthode et chaque chemin de l'appli, dans l'ordre où elle les essaie. Une refonte du code
(déplacer des fonctions, découper main.py) ne doit rien y changer. Pour mettre la référence à jour après un ajout voulu :
REGENERER_ROUTES=1 python -m pytest tests/test_carte_routes.py"""

import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arriere-salle-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

from mj import acces_mj  # noqa: E402
import main  # noqa: E402
from api import application  # noqa: E402

REFERENCE = Path(__file__).parent / "routes-reference.txt"


def carte() -> list[str]:
    return [cle for route, chemin in acces_mj.routes_a_plat(application.app.routes) for cle in acces_mj.cles_de(route, chemin)]


def motif(cle: str):
    """Le gabarit d'une route en expression régulière, pour savoir quels chemins concrets elle accepterait."""
    methode, chemin = cle.split(" ", 1)
    rx = re.sub(r"\{[^}:]+:path\}", ".+", chemin)
    rx = re.sub(r"\{[^}]+\}", "[^/]+", rx)
    return methode, chemin, re.compile("^" + rx + "$")


def exemple(chemin: str) -> str:
    return re.sub(r"\{[^}]+\}", "x", chemin)


def chevauchements(cles: list[str]) -> set[tuple[str, str]]:
    """Les couples (a, b) de routes de même méthode dont une accepterait un chemin de l'autre : leur ordre compte."""
    motifs = [motif(c) for c in cles if not c.startswith("*")]
    couples = set()
    for m1, c1, r1 in motifs:
        for m2, c2, r2 in motifs:
            if m1 == m2 and c1 != c2 and (r2.match(exemple(c1)) or r1.match(exemple(c2))):
                couples.add((f"{m1} {c1}", f"{m2} {c2}"))
    return couples


def test_la_carte_des_routes_ne_bouge_pas():
    actuelle = carte()
    if os.environ.get("REGENERER_ROUTES"):
        REFERENCE.write_text("\n".join(actuelle) + "\n", encoding="utf-8")
    attendue = REFERENCE.read_text(encoding="utf-8").splitlines()
    assert sorted(actuelle) == sorted(attendue), "des routes ont été ajoutées ou perdues"
    # Les montages (* /static, * /media) gardent leur place : ils ne se chevauchent avec rien, mais un doublon s'y verrait.
    assert [c for c in actuelle if c.startswith("*")] == [c for c in attendue if c.startswith("*")]
    position = {c: i for i, c in enumerate(actuelle)}
    ancienne = {c: i for i, c in enumerate(attendue)}
    # Deux routes qui peuvent répondre au même chemin restent dans le même ordre : le premier gabarit trouvé répond.
    desordre = sorted(f"{a}  avant  {b}" for a, b in chevauchements(attendue)
                      if (position[a] < position[b]) != (ancienne[a] < ancienne[b]))
    assert not desordre, desordre
