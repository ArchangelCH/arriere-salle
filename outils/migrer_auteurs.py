#!/usr/bin/env python3
"""Pose « auteur » : le compte principal dans chaque fiche des collections à auteur (app/mj/proprietes.py), avant le deuxième MJ.

Les fiches en place, celles de la corbeille (corbeille/<collection>/) et les versions gardées (historique/<collection>/
<id>/) : une fiche qu'on remet de la corbeille, une version à laquelle on revient, sont aussi à leur auteur. Une fiche
qui a déjà le champ ne change pas : on peut relancer l'outil sans rien abîmer.

Rien d'autre ne bouge : ni « modifie » (aucun écran ouvert ne tombe en conflit), ni la date du fichier (les versions
gardées toutes les cinq minutes se comptent sur elle), ni ses droits ; aucune version n'est archivée. Le JSON s'écrit
comme ecrire() de api/utilitaires.py (compact, d'un coup par un fichier temporaire renommé), le champ à la fin : sans lui, le
fichier est le même à l'octet près.

Usage (service arrêté, sauvegarde faite) :
    python3 outils/migrer_auteurs.py data             # montre ce qui serait fait
    python3 outils/migrer_auteurs.py data --appliquer # le fait
"""
import json
import os
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
from mj.proprietes import COLLECTIONS, PRINCIPAL  # noqa: E402


def comme_ecrire(contenu) -> bytes:
    return json.dumps(contenu, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def ecrire_a_l_identique(chemin: Path, contenu: bytes) -> None:
    """Comme ecrire() de api/utilitaires.py, en gardant la date et les droits du fichier remplacé."""
    avant = chemin.stat()
    tmp = chemin.with_name(f".{chemin.name}.{secrets.token_hex(4)}.tmp")
    try:
        tmp.write_bytes(contenu)
        os.chmod(tmp, avant.st_mode & 0o7777)
        os.utime(tmp, ns=(avant.st_atime_ns, avant.st_mtime_ns))
        tmp.replace(chemin)
    finally:
        tmp.unlink(missing_ok=True)


def fichiers(donnees: Path, collection: str) -> dict:
    """Les fiches d'une collection, par endroit : en place, à la corbeille, versions gardées."""
    def tri(motif_dossier: Path, motif: str) -> list:
        return sorted(f for f in motif_dossier.glob(motif) if f.is_file()) if motif_dossier.is_dir() else []
    return {
        "fiches": tri(donnees / collection, "*.json"),
        "corbeille": tri(donnees / "corbeille" / collection, "*.json"),
        "historique": tri(donnees / "historique" / collection, "*/*.json"),
    }


def migrer(donnees: Path, appliquer: bool) -> dict:
    """Le compte rendu : {collection: {endroit: {"a_ecrire", "deja", "illisibles", "reformatees"}}}, plus les chemins
    illisibles. À blanc, rien n'est écrit."""
    rapport, illisibles = {}, []
    for collection in COLLECTIONS:
        par_endroit = {}
        for endroit, liste in fichiers(donnees, collection).items():
            compte = {"a_ecrire": 0, "deja": 0, "illisibles": 0, "reformatees": 0}
            for chemin in liste:
                try:
                    brut = chemin.read_bytes()
                    fiche = json.loads(brut)
                except (OSError, ValueError):
                    fiche = None
                if not isinstance(fiche, dict):
                    compte["illisibles"] += 1
                    illisibles.append(str(chemin.relative_to(donnees)))
                    continue
                if "auteur" in fiche:
                    compte["deja"] += 1
                    continue
                compte["a_ecrire"] += 1
                # Écrit autrement qu'ecrire() (à la main, par un vieil outil) : il en prend la forme.
                if comme_ecrire(fiche) != brut:
                    compte["reformatees"] += 1
                if appliquer:
                    ecrire_a_l_identique(chemin, comme_ecrire({**fiche, "auteur": PRINCIPAL}))
            par_endroit[endroit] = compte
        rapport[collection] = par_endroit
    return {"collections": rapport, "illisibles": illisibles}


def compte_rendu(resultat: dict, appliquer: bool) -> str:
    lignes, total = [], {"a_ecrire": 0, "deja": 0, "illisibles": 0, "reformatees": 0}
    for collection, endroits in resultat["collections"].items():
        morceaux = []
        for endroit, c in endroits.items():
            for k in total:
                total[k] += c[k]
            if c["a_ecrire"] or c["deja"] or c["illisibles"]:
                morceaux.append(f"{endroit} {c['a_ecrire']} {'écrites' if appliquer else 'à écrire'}, {c['deja']} déjà" + (f", {c['illisibles']} illisible(s)" if c["illisibles"] else ""))
        lignes.append(f"  {collection:<11} " + ("; ".join(morceaux) or "rien"))
    verbe = "écrites" if appliquer else "à écrire"
    lignes.append(f"\n{total['a_ecrire']} fiche(s) {verbe}, {total['deja']} déjà à leur auteur, {total['illisibles']} illisible(s) laissée(s) telles quelles.")
    if total["reformatees"]:
        lignes.append(f"{total['reformatees']} fiche(s) n'étaient pas écrites comme ecrire() : elles en prennent la forme.")
    for chemin in resultat["illisibles"]:
        lignes.append(f"  illisible : {chemin}")
    if not appliquer:
        lignes.append("\nRien n'a été modifié. Relancer avec --appliquer.")
    return "\n".join(lignes)


def main() -> None:
    arguments = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(arguments) != 1:
        sys.exit(__doc__)
    donnees = Path(arguments[0])
    if not (donnees / "pnj").is_dir() and not (donnees / "scenarios").is_dir():
        sys.exit(f"{donnees} ne ressemble pas au dossier des données de l'atelier.")
    appliquer = "--appliquer" in sys.argv
    print(f"Auteur « {PRINCIPAL} » dans {donnees} :")
    print(compte_rendu(migrer(donnees, appliquer), appliquer))


if __name__ == "__main__":
    main()
