"""Le texte d'une page du front : son fichier d'entrée et les modules qu'il charge depuis son dossier (table.js et table/,
telecommande.js et telecommande/, atelier.js et atelier/). Les tests qui vérifient ce que dit le code d'une page lisent ceci."""

from pathlib import Path

JS = Path(__file__).resolve().parent.parent / "app" / "static" / "js"


def source_page(nom: str) -> str:
    morceaux = [(JS / f"{nom}.js").read_text(encoding="utf-8")]
    morceaux += [f.read_text(encoding="utf-8") for f in sorted((JS / nom).glob("*.js"))]
    return "\n".join(morceaux)
