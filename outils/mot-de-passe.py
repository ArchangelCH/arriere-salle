#!/usr/bin/env python3
"""Mot de passe de l'atelier publié par Internet (ATELIER_PUBLIC, docker-compose.yml).

    python3 outils/mot-de-passe.py            # demande le nouveau mot de passe
    python3 outils/mot-de-passe.py --generer  # en tire un au sort et l'affiche une fois
    python3 outils/mot-de-passe.py --fichier <chemin>  # ailleurs que dans secrets/acces.env

Écrit l'empreinte (scrypt) et la clé des sessions dans secrets/acces.env du dépôt (lu par le compose), ou dans le fichier
que donne --fichier, puis il faut relancer le conteneur : docker compose up -d aventures-atelier. Le compte principal des MJ (ATELIER_MJ_PRINCIPAL,
data/mj/comptes.json) reprend alors cette empreinte. Changer le mot de passe déconnecte tous les appareils. Le mot de
passe lui-même n'est écrit nulle part.

Secours, sans relancer le conteneur : le mot de passe d'un compte MJ écrit directement dans data/mj/comptes.json
(un fichier illisible est mis de côté, et le compte principal refait) ; les sessions de ce compte tombent.

    python3 outils/mot-de-passe.py --compte mj [--generer] [--donnees <dossier des données de l'atelier>]
"""

import getpass
import hashlib
import os
import secrets
import sys
import time
from pathlib import Path

DEPOT = Path(__file__).resolve().parent.parent
# Le fichier que lit le compose (env_file de docker-compose.yml) ; --fichier en désigne un autre.
FICHIER = DEPOT / "secrets" / "acces.env"
DONNEES = DEPOT / "data"
N, R, P = 2 ** 15, 8, 1

MOTS = """
ancre anneau arbre archer argent auberge aube avoine bannier barde baton bec biche blason bois bottes bouclier
braise brume bucher cape carte castor cendre cerf chaine chandelle chapelle chardon charrette chateau chene cheval
chouette ciel cire citadelle clairon cloche col colline comete coq corbeau corde cor coupe crane creux cuivre dague
dalle dent donjon dragon dune ecu elfe enclume epee epine etang etoile faucon fer feu figue flamme fleuve foret
forge fourche fronde gage gargouille geant gemme givre glaive gobelet gong gouffre grain granit grenier griffe grotte
gue hache hameau harpe herbe heron hibou houx hydre if lac lame lande lanterne laurier lierre lion loup lune lys
manteau marais masque menhir meule miel mine moine moulin mousse mur navire neige noix oasis ogre olive or orage
orme ours paille parchemin pavois peigne perle pic pierre pin plume poignard pomme pont porte potion puits quartz
rame rapace relais renard rempart rocher ronce rose rouet rubis ruisseau sable sabot sage saule sceau seigle sel
serpe sentier silex sorbier source tambour taverne tempete tisane toile tonneau torche tour trefle troll tunique
vallon vent verger vigne voile volcan
""".split()


def tirer() -> str:
    return "-".join(secrets.choice(MOTS) for _ in range(4)) + "-" + str(secrets.randbelow(90) + 10)


def lire_existant() -> dict:
    valeurs = {}
    if FICHIER.exists():
        for ligne in FICHIER.read_text().splitlines():
            cle, _, valeur = ligne.partition("=")
            if cle and not cle.startswith("#"):
                valeurs[cle.strip()] = valeur.strip()
    return valeurs


def valeur_option(nom: str) -> str | None:
    if nom not in sys.argv:
        return None
    rang = sys.argv.index(nom)
    if rang + 1 >= len(sys.argv) or sys.argv[rang + 1].startswith("--"):
        sys.exit(f"{nom} attend une valeur.")
    return sys.argv[rang + 1]


def ecrire_compte(ident: str, empreinte: str, donnees: Path) -> None:
    """Le secours : l'empreinte d'un compte MJ, directement dans data/mj/comptes.json (comptes_mj.py), sous son verrou."""
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
    from mj import comptes_mj

    if not donnees.is_dir():
        sys.exit(f"{donnees} n'existe pas : --donnees <dossier des données de l'atelier>.")
    # L'empreinte que tient l'environnement en ce moment : le principal la sait déjà vue, il ne la reprendra pas au
    # prochain démarrage par-dessus celle-ci.
    env = lire_existant().get("ATELIER_MDP_EMPREINTE", "")
    with comptes_mj.verrou(donnees):
        try:
            etat = comptes_mj.lire(donnees)
        except comptes_mj.Illisible as err:
            cote = comptes_mj.chemin(donnees).with_name(f"comptes.json.illisible-{time.strftime('%Y%m%d-%H%M%S')}")
            comptes_mj.chemin(donnees).replace(cote)
            print(f"Fichier illisible ({err}) mis de côté : {cote}")
            etat = comptes_mj.vide()
        instant = comptes_mj.maintenant()
        compte = comptes_mj.par_id(etat, ident)
        if compte is None and ident == comptes_mj.PRINCIPAL:
            compte = comptes_mj.nouveau_principal(empreinte, env, instant)
            etat["comptes"].insert(0, compte)
            # Un mot de passe neuf : le cookie d'avant les comptes ne vaut plus.
            etat["ancien_cookie"] = {"fin": 0, "generation": 0}
        elif compte is None or not compte.get("identifiant"):
            sys.exit(f"Aucun compte MJ « {ident} » qui ait déjà un identifiant.")
        else:
            compte.update(empreinte=empreinte, generation=compte["generation"] + 1, modifie=instant)
            if compte["role"] == "principal":
                compte["env"] = comptes_mj.marque_env(env)
        comptes_mj.ecrire(donnees, etat)
    comptes_mj.noter(donnees, "mot-de-passe-secours", ident, "outil")
    print(f"Écrit dans {comptes_mj.chemin(donnees)} : nouveau mot de passe du compte {ident}, ses sessions sont coupées.")


def main():
    global FICHIER
    FICHIER = Path(valeur_option("--fichier") or FICHIER).expanduser()
    compte = valeur_option("--compte")
    if "--generer" in sys.argv:
        mot_de_passe = tirer()
    else:
        mot_de_passe = getpass.getpass("Nouveau mot de passe : ")
        if mot_de_passe != getpass.getpass("Encore une fois : "):
            sys.exit("Les deux ne correspondent pas.")
        if len(mot_de_passe) < 12:
            sys.exit("Trop court : 12 caractères au moins.")
    sel = secrets.token_bytes(16)
    empreinte = hashlib.scrypt(mot_de_passe.encode(), salt=sel, n=N, r=R, p=P, maxmem=128 * 1024 * 1024, dklen=32)
    if compte:
        ecrire_compte(compte, f"scrypt:{N}:{R}:{P}:{sel.hex()}:{empreinte.hex()}", Path(valeur_option("--donnees") or DONNEES))
        if "--generer" in sys.argv:
            print(f"Mot de passe : {mot_de_passe}")
        return
    cle = lire_existant().get("ATELIER_CLE_SESSION") or secrets.token_hex(32)
    FICHIER.parent.mkdir(parents=True, exist_ok=True)
    os.umask(0o077)
    FICHIER.write_text(
        "# Accès à l'Arrière-salle par Internet : écrit par outils/mot-de-passe.py, ne pas éditer à la main.\n"
        f"ATELIER_MDP_EMPREINTE=scrypt:{N}:{R}:{P}:{sel.hex()}:{empreinte.hex()}\n"
        f"ATELIER_CLE_SESSION={cle}\n")
    FICHIER.chmod(0o600)
    print(f"Écrit dans {FICHIER}")
    if "--generer" in sys.argv:
        print(f"Mot de passe : {mot_de_passe}")
    print("À appliquer, depuis le dossier du dépôt : docker compose up -d aventures-atelier")


if __name__ == "__main__":
    main()
