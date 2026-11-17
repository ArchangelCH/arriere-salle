#!/usr/bin/env python3
"""Renomme les images de data/images sous des noms tirés au sort et met à jour toutes les fiches qui les citent.

Les anciennes images portaient l'identifiant de leur fiche (« ill-<fiche>-a1b2c3.jpg ») : leur adresse, envoyée à la
TV, trahissait le nom d'origine d'un lieu ou d'un PNJ. Les images que plus aucune fiche active ne cite (scénario
retiré, fiches à la corbeille) partent dans data/corbeille/images/, sans être effacées.

Usage (service arrêté, sauvegarde faite) :
    python3 outils/migrer_images.py data             # montre ce qui serait fait
    python3 outils/migrer_images.py data --appliquer # le fait, et écrit la correspondance dans data/
"""
import json
import re
import secrets
import sys
import time
from pathlib import Path

NOUVEAU = re.compile(r"^((ill|portrait)-)?[0-9a-f]{16}\.(jpg|png|webp)$")
ACTIFS = ("cartes", "lieux", "pnj", "contrats", "rumeurs", "fils", "seances", "rencontres", "aventuriers", "plans")


def cites(texte: str) -> set[str]:
    return set(re.findall(r"/media/([A-Za-z0-9][A-Za-z0-9._-]*)", texte))


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    donnees = Path(sys.argv[1])
    appliquer = "--appliquer" in sys.argv
    images = donnees / "images"
    tous_json = [f for f in donnees.rglob("*.json") if images not in f.parents]
    actifs = [f for d in ACTIFS for f in (donnees / d).glob("*.json")] + [f for f in (donnees / "campagne.json", donnees / "table.json") if f.exists()]
    utilisees = set()
    for f in actifs:
        utilisees |= cites(f.read_text(encoding="utf-8"))

    correspondance, orphelines = {}, []
    for image in sorted(images.iterdir()):
        if not image.is_file():
            continue
        if image.name not in utilisees:
            orphelines.append(image.name)
        elif not NOUVEAU.match(image.name):
            prefixe = next((p for p in ("ill-", "portrait-") if image.name.startswith(p)), "")
            correspondance[image.name] = f"{prefixe}{secrets.token_hex(8)}{image.suffix.lower()}"

    print(f"{len(correspondance)} image(s) à renommer, {len(orphelines)} orpheline(s) à mettre de côté.")
    for ancien, nouveau in correspondance.items():
        print(f"  {ancien} -> {nouveau}")
    for nom in orphelines:
        print(f"  orpheline : {nom}")
    if not appliquer:
        print("\nRien n'a été modifié. Relancer avec --appliquer.")
        return

    for ancien, nouveau in correspondance.items():
        (images / ancien).rename(images / nouveau)
    if orphelines:
        mise_de_cote = donnees / "corbeille" / "images"
        mise_de_cote.mkdir(parents=True, exist_ok=True)
        for nom in orphelines:
            (images / nom).rename(mise_de_cote / nom)
    motif = re.compile(r"/media/(" + "|".join(re.escape(a) for a in sorted(correspondance, key=len, reverse=True)) + r")(?![A-Za-z0-9._-])") if correspondance else None
    modifies = 0
    for f in tous_json:
        texte = f.read_text(encoding="utf-8")
        if motif and motif.search(texte):
            f.write_text(motif.sub(lambda m: "/media/" + correspondance[m.group(1)], texte), encoding="utf-8")
            modifies += 1
    journal = donnees / f"migration-images-{time.strftime('%Y%m%d-%H%M%S')}.json"
    journal.write_text(json.dumps({"renommees": correspondance, "mises_de_cote": orphelines}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nFait : {len(correspondance)} renommée(s), {len(orphelines)} mise(s) de côté, {modifies} fichier(s) JSON mis à jour. Correspondance : {journal}")


if __name__ == "__main__":
    main()
