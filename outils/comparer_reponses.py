#!/usr/bin/env python3
"""L'instantané de toutes les réponses GET de l'atelier sur une copie des données, et la comparaison de deux
instantanés : la preuve qu'un lot ne change rien de ce que voit le MJ principal.

Chaque route GET de app.routes est appelée pour chaque fiche qu'elle peut désigner (identifiants des dossiers, jetons
de la TV, versions gardées, documents de la bible…), comme sur le réseau local, ou avec --en-ligne comme depuis
l'atelier en ligne avec l'ancien cookie de session du MJ principal. Les données ne sont jamais touchées : l'outil travaille
sur une copie temporaire. Une route dont il ne sait pas remplir l'adresse est notée « non couverte ».

Les autres portes, chacune son instantané : --table-publique (comme table.exemple.org, sans cookie),
--en-ligne --sans-session (l'atelier en ligne vu d'Internet sans session), --en-ligne --connexion (une session ouverte
par POST /connexion, avec --identifiant s'il en faut un), la porte du réseau local éveillée (--porte-eveillee, comme
après le premier MJ invité ; avec --appareil, un appareil du MJ principal reconnu, sinon un appareil inconnu), et la
sous-commande « coin » : le coin des joueurs, chaque joueur avec une session fabriquée sur la copie (--cookies : celles
d'un instantané précédent, pour prouver qu'elles tiennent d'une version du code à l'autre), après que l'atelier a publié
ses fichiers (--publier SECONDES).

À lancer dans l'image de l'atelier (ses bibliothèques), une fois par version du code :

    docker run --rm -e PYTHONDONTWRITEBYTECODE=1 -v <code>/app:/code:ro -v <code>/outils:/outils:ro \\
        -v <données>:/donnees:ro -v <sortie>:/sortie -v <bible>:/lore:ro aventures-atelier:latest \\
        python /outils/comparer_reponses.py instantane --code /code --donnees /donnees --sortie /sortie/avant.json

    python3 outils/comparer_reponses.py comparer avant.json apres.json [--sans-auteur] [--attendues /connexion,...]

--sans-auteur retire le champ « auteur » (outils/migrer_auteurs.py) des deux côtés avant de comparer, et la taille
des versions gardées (la migration les allonge de ce champ). --attendues : des
adresses dont la différence est voulue (dites à part, elles ne font pas échouer la comparaison). Les champs qui portent
l'heure du serveur au moment de la réponse (VOLATILES) ne se comparent jamais.
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

COLLECTIONS = ("cartes", "lieux", "pnj", "contrats", "rumeurs", "fils", "seances", "rencontres", "aventuriers", "plans",
               "idees", "boutiques", "documents", "scenarios", "regles-maison")
# Les vues de la TV et la collection de leurs jetons.
TABLE = {"carte": "cartes", "pnj": "pnj", "rumeur": "rumeurs", "document": "documents", "precedemment": "seances",
         "episode": "seances", "aventurier": "aventuriers", "plan": "plans", "lieu": "lieux", "boutique": "boutiques",
         "combat": "seances"}
# Par dossier de fiches, les sous-routes qui les prennent toutes.
SOUS_ROUTES = {"/api/seances/{ident}/combat": "seances", "/api/scenarios/{ident}/consignes": "scenarios",
               "/api/cartes/{ident}/publique": "cartes", "/api/pnj/{ident}/carton": "pnj",
               "/api/documents/{ident}/inconnus": "documents", "/api/documents/{ident}/imprime": "documents",
               "/api/plans/{ident}/deplacements": "plans", "/api/idees/{ident}/squelette/etat": "idees"}
# Ce que l'outil n'appelle pas : le rendu PDF passe par un navigateur et le serveur lui-même (127.0.0.1:8000).
IGNOREES = {"/fiche-aventurier.pdf"}
VIGNETTES = 12
MOTS = ("auberge", "Clairefonds", "loup", "mine", "or", "secret")
HOTE_EN_LIGNE = "atelier.instantane"
HOTE_TABLE = "table.instantane"
MOT_DE_PASSE = "mot-de-passe-de-l-instantane"
# Le coin : le flux SSE ne se referme pas seul, le PDF passe par Chromium.
IGNOREES_COIN = {"/api/flux", "/fiche.pdf"}
# L'heure du serveur au moment de la réponse (le sablier d'un combat) : elle change d'un appel à l'autre. Les tentatives
# d'un héros arrêté sur un plan (mouvements.tentatives, /api/plans/{ident}/deplacements) ne se lisent que dix minutes :
# deux instantanés pris de part et d'autre de cette fin ne les voient pas pareil.
VOLATILES = ("horloge", "tentatives")
VERSIONS = "/api/versions/"


def routes_a_plat(routes, contexte=None):
    # Comme acces_mj.routes_a_plat (le code d'avant n'a pas ce module).
    for r in routes:
        if hasattr(r, "original_router") and hasattr(r, "include_context"):
            ctx = r.include_context if contexte is None else contexte.combine(r.include_context)
            yield from routes_a_plat(r.original_router.routes, ctx)
        else:
            yield r, (contexte.path_for(r) if contexte is not None and hasattr(contexte, "path_for") else r.path)


def ids(dossier: Path) -> list:
    return sorted(f.stem for f in dossier.glob("*.json")) if dossier.is_dir() else []


def adresses(gabarit: str, donnees: Path, cartes, deja: dict) -> list | None:
    """Les adresses concrètes d'une route GET ; None si l'outil ne sait pas les remplir."""
    if "{" not in gabarit:
        return [gabarit]
    morceaux = gabarit.strip("/").split("/")
    if len(morceaux) == 3 and morceaux[0] == "api" and morceaux[2] == "{ident}" and morceaux[1] in COLLECTIONS:
        return [f"/api/{morceaux[1]}/{i}" for i in ids(donnees / morceaux[1])]
    if gabarit in SOUS_ROUTES:
        return [gabarit.replace("{ident}", i) for i in ids(donnees / SOUS_ROUTES[gabarit])]
    if gabarit == "/api/table/plan/{j}/image/{oid}":
        # Les images du MJ posées sur chaque plan : la route ne répond que pour celles que la projection désigne.
        sortie = []
        for i in ids(donnees / "plans"):
            try:
                objets = json.loads((donnees / "plans" / f"{i}.json").read_text(encoding="utf-8")).get("objets") or []
            except (OSError, ValueError, AttributeError):
                continue
            j = cartes.jeton("plans", i)
            sortie += [f"/api/table/plan/{j}/image/{o['id']}" for o in objets
                       if isinstance(o, dict) and isinstance(o.get("id"), str) and o.get("image")]
        return sortie
    if gabarit.startswith("/api/table/") and "{j}" in gabarit:
        vue = morceaux[2]
        if vue not in TABLE:
            return None
        c = TABLE[vue]
        return [gabarit.replace("{j}", cartes.jeton(c, i)) for i in ids(donnees / c)]
    if gabarit == "/api/monde/cartes/{j}":
        return [gabarit.replace("{j}", cartes.jeton("cartes", i)) for i in ids(donnees / "cartes")]
    if gabarit == "/api/table/vignette/{nom}" or gabarit == "/api/carnet-joueurs/media/{nom}":
        images = sorted(f.name for f in (donnees / "images").iterdir() if f.is_file())[:VIGNETTES] if (donnees / "images").is_dir() else []
        return [gabarit.replace("{nom}", n) for n in images]
    if gabarit == "/api/joueurs/{ident}/apercu":
        try:
            joueurs = json.loads((donnees / "joueurs.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            joueurs = []
        return [f"/api/joueurs/{j['id']}/apercu" for j in joueurs if isinstance(j, dict) and j.get("id")]
    if gabarit == "/api/versions/{nom}/{ident}":
        return [f"/api/versions/{c}/{i}" for c in COLLECTIONS for i in ids(donnees / c)]
    if gabarit == "/api/versions/{nom}/{ident}/{estampille}":
        sortie = []
        for c in COLLECTIONS:
            for f in sorted((donnees / "historique" / c).glob("*/*.json")) if (donnees / "historique" / c).is_dir() else []:
                sortie.append(f"/api/versions/{c}/{f.parent.name}/{f.stem}")
        return sortie
    if gabarit == "/api/mentions/{nom}/{ident}":
        return [f"/api/mentions/{c}/{i}" for c in ("pnj", "lieux") for i in ids(donnees / c)]
    if gabarit in ("/api/lore/{joueur}/{ident}", "/api/activites/demandes/{joueur}/{ident}",
                   "/api/portraits-joueurs/{joueur}/{ident}/image"):
        sortie = []
        for f in sorted((donnees / "propositions" / "demandes").glob("*.json")) if (donnees / "propositions" / "demandes").is_dir() else []:
            try:
                liste = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            for d in liste if isinstance(liste, list) else []:
                if isinstance(d, dict) and isinstance(d.get("id"), str):
                    sortie.append(gabarit.replace("{joueur}", f.stem).replace("{ident}", d["id"]))
        return sortie
    if gabarit == "/api/telecommande/commandes/{numero}":
        return [gabarit.replace("{numero}", "1")]
    return None


def avec_requetes(adresse: str, donnees: Path, deja: dict) -> list:
    """Les routes qui attendent une requête (?chemin=, ?q=…) : quelques valeurs tirées des données."""
    if adresse == "/api/bible/document":
        sommaire = deja.get("/api/bible", {}).get("corps")
        chemins = sorted({x for x in trouver(sommaire, "chemin") if isinstance(x, str)})
        return [f"/api/bible/document?chemin={c}" for c in chemins]
    if adresse in ("/api/bible/recherche", "/api/recherche"):
        return [f"{adresse}?q={m}" for m in MOTS]
    if adresse == "/api/illustrations/style":
        return [f"{adresse}?genre={g}" for g in ("lieu", "pnj", "aventurier")]
    if adresse == "/api/ia/couts":
        return [adresse, f"{adresse}?mois={time.strftime('%Y-%m')}"]
    if adresse in ("/document-imprime", "/feuille-combat", "/fiche-seance"):
        return [adresse]
    if adresse == "/documents-imprimes":
        return [f"{adresse}?seance={i}" for i in ids(donnees / "seances")][:3] or [adresse]
    if adresse == "/billets":
        return [f"{adresse}?seance={i}" for i in ids(donnees / "seances")][:3] or [adresse]
    return [adresse]


def trouver(valeur, cle: str):
    if isinstance(valeur, dict):
        for k, v in valeur.items():
            if k == cle:
                yield v
            yield from trouver(v, cle)
    elif isinstance(valeur, list):
        for v in valeur:
            yield from trouver(v, cle)


def reponse(r) -> dict:
    genre = r.headers.get("content-type", "").split(";")[0]
    if genre == "application/json":
        try:
            return {"statut": r.status_code, "genre": genre, "corps": r.json()}
        except ValueError:
            pass
    if genre.startswith("text/"):
        return {"statut": r.status_code, "genre": genre, "corps": r.text}
    return {"statut": r.status_code, "genre": genre, "empreinte": hashlib.sha256(r.content).hexdigest(), "taille": len(r.content)}


def copie_des_donnees(donnees: Path, tv: str = "") -> Path:
    """La copie de travail ; tv : ce que la TV y montre (le contenu de table.json, en JSON), pour qu'une porte qui ne lit
    que ce que la TV montre (table publique, table du coin) ait quelque chose à lire."""
    copie = Path(tempfile.mkdtemp(prefix="instantane-")) / "data"
    shutil.copytree(donnees, copie, symlinks=True)
    if tv:
        (copie / "table.json").write_text(json.dumps(json.loads(tv), ensure_ascii=False), encoding="utf-8")
    return copie


def mot_de_passe_de_l_instantane(copie: Path, empreinte: str) -> None:
    """Depuis les comptes MJ (lot MJ-0/1), l'ancien cookie ne vaut session que pour le mot de passe de l'environnement, et
    dans les 30 jours de sa fenêtre : sur des données qui ont déjà data/mj/comptes.json, il répondait 401 partout. Le
    principal de la copie prend le mot de passe de l'instantané (comme après un changement noté), sans changer de
    génération ni de date, et la fenêtre est rouverte : la porte de l'ancien cookie redevient celle du MJ principal. Sans
    fichier (ou un code d'avant les comptes), rien à faire : le principal naît de l'environnement, fenêtre ouverte."""
    fichier = copie / "mj" / "comptes.json"
    try:
        from mj import comptes_mj
    except ImportError:
        return
    if not fichier.is_file():
        return
    etat = json.loads(fichier.read_text(encoding="utf-8"))
    principal = next((c for c in etat.get("comptes") or [] if isinstance(c, dict) and c.get("role") == "principal"), None)
    if principal is None:
        return
    principal.update(empreinte=empreinte, env=comptes_mj.marque_env(empreinte))
    etat["ancien_cookie"] = {"fin": int(time.time()) + 30 * 86400, "generation": principal.get("generation", 1)}
    fichier.write_text(json.dumps(etat, ensure_ascii=False, indent=1), encoding="utf-8")


def cookie_pose(r, nom: str) -> str:
    """La valeur d'un cookie posé par une réponse (le client d'essai ne garde pas un cookie « secure » en http)."""
    for entete in r.headers.get_list("set-cookie"):
        cle, _, reste = entete.partition("=")
        if cle.strip() == nom:
            return reste.split(";", 1)[0]
    return ""


def instantane(code: Path, donnees: Path, sortie: Path, en_ligne: bool, cycle: bool, table_publique: bool = False,
               sans_session: bool = False, connexion: bool = False, identifiant: str = "", tv: str = "",
               porte_eveillee: bool = False, appareil: bool = False) -> None:
    if not (donnees / ".cle-jetons").is_file():
        print("Attention : pas de .cle-jetons dans ces données, les adresses de la TV changeront d'un instantané à l'autre.")
    copie = copie_des_donnees(donnees, tv)
    os.environ["DATA_DIR"] = str(copie)
    for cle in ("ATELIER_PUBLIC", "TABLE_PUBLIQUE", "ATELIER_MDP_EMPREINTE", "ATELIER_CLE_SESSION", "ANTHROPIC_API_KEY",
                "ATELIER_PORTE_LAN"):
        os.environ.pop(cle, None)
    if porte_eveillee:
        # L'interrupteur de test de la porte du réseau local (porte_lan.py) : éveillée sans créer d'invité.
        os.environ["ATELIER_PORTE_LAN"] = "eveillee"
    entetes = {}
    if en_ligne:
        sel = b"instantane-sel-0"
        h = hashlib.scrypt(MOT_DE_PASSE.encode(), salt=sel, n=2 ** 10, r=8, p=1, dklen=32)
        os.environ["ATELIER_PUBLIC"] = HOTE_EN_LIGNE
        os.environ["ATELIER_MDP_EMPREINTE"] = f"scrypt:{2 ** 10}:8:1:{sel.hex()}:{h.hex()}"
        os.environ["ATELIER_CLE_SESSION"] = "cle-de-l-instantane"
    if table_publique:
        os.environ["TABLE_PUBLIQUE"] = HOTE_TABLE
    sys.path.insert(0, str(code))
    if en_ligne:
        mot_de_passe_de_l_instantane(copie, os.environ["ATELIER_MDP_EMPREINTE"])
    import main
    from api import portier, tv_cartes
    from mj import porte_lan, proprietes
    from fastapi.testclient import TestClient
    from starlette.routing import Mount

    client = TestClient(main.app)
    if en_ligne:
        entetes = {"Host": HOTE_EN_LIGNE, "CF-Connecting-IP": "203.0.113.50"}
        if connexion:
            # Une session ouverte comme le MJ principal l'ouvre : le formulaire de connexion (identifiant s'il y en a un).
            r = client.post("/connexion", data={"identifiant": identifiant, "mot_de_passe": MOT_DE_PASSE, "suite": "/"},
                            headers=entetes, follow_redirects=False)
            valeur = cookie_pose(r, portier.COOKIE_SESSION)
            if r.status_code != 303 or not valeur:
                sys.exit(f"Connexion refusée : {r.status_code}")
            entetes["Cookie"] = f"{portier.COOKIE_SESSION}={valeur}"
        elif not sans_session:
            # L'ancien cookie de session du MJ principal (« échéance.signature ») : le même des deux côtés.
            expire = int(time.time()) + 3600
            entetes["Cookie"] = f"{portier.COOKIE_SESSION}={expire}.{portier.signature_session(expire)}"
    elif table_publique:
        entetes = {"Host": HOTE_TABLE, "CF-Connecting-IP": "203.0.113.51"}
    elif appareil:
        # Un appareil du MJ principal reconnu sur le réseau local, comme par « Reconnaître cet appareil ».
        _, valeur = portier.PORTE_LAN.reconnaitre(proprietes.PRINCIPAL, "Instantané")
        entetes = {"Cookie": f"{porte_lan.COOKIE}={valeur}"}
    if cycle:
        client.__enter__()
    resultats, non_couvertes, ignorees = {}, [], []
    gets = []
    for route, chemin in routes_a_plat(main.app.routes):
        if isinstance(route, Mount) or "GET" not in (getattr(route, "methods", None) or ()):
            continue
        gets.append(chemin)
    # La bible d'abord : ses documents se lisent sous les chemins de son sommaire.
    gets.sort(key=lambda g: g != "/api/bible")
    for gabarit in gets:
        if gabarit in IGNOREES:
            ignorees.append(gabarit)
            continue
        liste = adresses(gabarit, copie, tv_cartes, resultats)
        if liste is None:
            non_couvertes.append(gabarit)
            continue
        for adresse in liste:
            for concrete in avec_requetes(adresse, copie, resultats):
                resultats[concrete] = reponse(client.get(concrete, headers=entetes, follow_redirects=False))
    try:
        with client.websocket_connect("/ws/table", headers=entetes) as ws:
            resultats["WS /ws/table"] = {"statut": 101, "genre": "websocket", "corps": ws.receive_json()}
    except Exception as err:  # noqa: BLE001 : on note ce qui arrive, on ne juge pas ici
        resultats["WS /ws/table"] = {"statut": 0, "genre": "websocket", "corps": str(err)}
    if cycle:
        client.__exit__(None, None, None)
    # Ce que le cloisonnement a noté pendant l'instantané : sur des données sans invité, rien (le code d'avant
    # n'a pas ce module).
    cloisonnement = sys.modules.get("cloisonnement")
    notees = [list(v) for v in cloisonnement.vues()] if cloisonnement and hasattr(cloisonnement, "vues") else None
    sortie.write_text(json.dumps({"code": str(code), "en_ligne": en_ligne, "table_publique": table_publique, "reponses": resultats,
                                  "non_couvertes": non_couvertes, "ignorees": ignorees, "cloisonnement": notees},
                                 ensure_ascii=False, indent=1, sort_keys=True),
                      encoding="utf-8")
    shutil.rmtree(copie.parent, ignore_errors=True)
    print(f"{len(resultats)} réponses dans {sortie} ; {len(non_couvertes)} route(s) non couverte(s) : {', '.join(non_couvertes) or 'aucune'}")
    if notees is not None:
        print(f"Cloisonnement ({cloisonnement.MODE}) : {len(notees)} violation(s) notée(s)"
              + "".join(f"\n  {' | '.join(v)}" for v in notees[:20]))


def instantane_coin(code: Path, donnees: Path, sortie: Path, publier: float, cookies: Path | None, tv: str = "") -> None:
    """Le coin des joueurs (joueurs:app) : chaque route GET, sans session puis avec la session de chaque joueur (son
    compte), ou l'ancien cookie d'avant les comptes pour un joueur qui n'en a pas."""
    copie = copie_des_donnees(donnees, tv)
    depot = copie / "propositions"
    os.environ.update({"DATA_DIR": str(copie), "DEPOT_DIR": str(depot), "COOKIE_SECURE": "0"})
    for cle in ("HOTES", "ATELIER_PUBLIC", "TABLE_PUBLIQUE", "ATELIER_MDP_EMPREINTE", "ATELIER_CLE_SESSION", "ANTHROPIC_API_KEY"):
        os.environ.pop(cle, None)
    sys.path.insert(0, str(code))
    from fastapi.testclient import TestClient
    if publier:
        # L'atelier d'abord, ses tâches de fond un moment : ce qu'il publie pour le coin (carnet, portraits, table…).
        import main
        from api import tv_etat
        with TestClient(main.app):
            time.sleep(publier)
            # La table du coin se publie à chaque changement de la TV, pas au démarrage : une fois ici, comme après un
            # geste du MJ.
            tv_etat.publier_table_coin()
    from commun import comptes
    import joueurs
    from starlette.routing import Mount

    if cookies:
        par_joueur = json.loads(cookies.read_text(encoding="utf-8"))["cookies"]
    else:
        par_joueur = {}
        for j in joueurs.acces():
            compte = comptes.lire(depot, j["id"])
            if compte and comptes.ouvert(compte):
                par_joueur[j["id"]] = joueurs.session(j, compte)
            else:
                par_joueur[j["id"]] = f"{j['id']}.{joueurs.signature(j)}"
    client = TestClient(joueurs.app)
    gets = sorted(chemin for route, chemin in routes_a_plat(joueurs.app.routes)
                  if not isinstance(route, Mount) and "GET" in (getattr(route, "methods", None) or ()))

    def noms(*morceaux) -> list:
        d = depot.joinpath(*morceaux)
        return sorted(f.name for f in d.iterdir() if f.is_file() and not f.name.startswith(".")) if d.is_dir() else []

    def concretes(gabarit: str, qui: str, deja: dict) -> list | None:
        if gabarit == "/static/{chemin:path}":
            return [f"/static/{c}" for c in sorted(joueurs.FICHIERS)] if qui == "-" else []
        if gabarit == "/carnet/media/{nom}":
            return [f"/carnet/media/{n}" for n in noms("carnet", "media")]
        if gabarit == "/table/media/{nom}":
            return [f"/table/media/{n}" for n in noms("table", "media")]
        if gabarit == "/prives/media/{nom}":
            return [f"/prives/media/{n}" for n in noms("prives", "media")]
        if gabarit == "/portraits/media/{nom}":
            d = depot / "portraits"
            return sorted({f"/portraits/media/{f.name}" for f in d.glob("*/*.jpg")}) if d.is_dir() else []
        if gabarit == "/portraits/envoi/{fichier}":
            d = depot / "portraits-envois"
            return sorted({f"/portraits/envoi/{f.name}" for f in d.glob("*/*.jpg")}) if d.is_dir() else []
        if "{" in gabarit:
            return None
        if gabarit == "/api/bible/document":
            chemins = sorted({x for x in trouver(deja.get(f"{qui} /api/bible", {}).get("corps"), "chemin") if isinstance(x, str)})
            return [f"{gabarit}?chemin={c}" for c in chemins]
        if gabarit == "/api/bible/recherche":
            return [f"{gabarit}?q={m}" for m in MOTS]
        return [gabarit]

    resultats, non_couvertes = {}, set()
    gets.sort(key=lambda g: g != "/api/bible")
    for qui in ["-", *sorted(par_joueur)]:
        entetes = {"Cookie": f"{joueurs.COOKIE}={par_joueur[qui]}"} if qui != "-" else {}
        for gabarit in gets:
            if gabarit in IGNOREES_COIN:
                continue
            liste = concretes(gabarit, qui, resultats)
            if liste is None:
                non_couvertes.add(gabarit)
                continue
            for adresse in liste:
                resultats[f"{qui} {adresse}"] = reponse(client.get(adresse, headers=entetes, follow_redirects=False))
    # Les tâches de fond de l'atelier (--publier) lisent sous le lecteur « fond » : rien à noter.
    cloisonnement = sys.modules.get("cloisonnement")
    notees = [list(v) for v in cloisonnement.vues()] if cloisonnement and hasattr(cloisonnement, "vues") else None
    sortie.write_text(json.dumps({"code": str(code), "coin": True, "cookies": par_joueur, "reponses": resultats,
                                  "non_couvertes": sorted(non_couvertes), "ignorees": sorted(IGNOREES_COIN),
                                  "cloisonnement": notees},
                                 ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    shutil.rmtree(copie.parent, ignore_errors=True)
    print(f"{len(resultats)} réponses du coin dans {sortie} ; {len(par_joueur)} joueur(s) ; "
          f"{len(non_couvertes)} route(s) non couverte(s) : {', '.join(sorted(non_couvertes)) or 'aucune'}")


def sans_cles(valeur, cles: tuple):
    if isinstance(valeur, dict):
        return {k: sans_cles(v, cles) for k, v in valeur.items() if k not in cles}
    if isinstance(valeur, list):
        return [sans_cles(v, cles) for v in valeur]
    return valeur


def premiere_difference(a, b, chemin="") -> str:
    if type(a) is not type(b):
        return f"{chemin or '/'} : {type(a).__name__} / {type(b).__name__}"
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                return f"{chemin}/{k} : {'absent avant' if k not in a else 'absent après'}"
            if a[k] != b[k]:
                return premiere_difference(a[k], b[k], f"{chemin}/{k}")
    if isinstance(a, list):
        if len(a) != len(b):
            return f"{chemin or '/'} : {len(a)} / {len(b)} éléments"
        for i, (x, y) in enumerate(zip(a, b)):
            if x != y:
                return premiere_difference(x, y, f"{chemin}[{i}]")
    if isinstance(a, str) and isinstance(b, str):
        i = next((n for n, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
        return f"{chemin or '/'} : « …{a[max(0, i - 40):i + 60]}… » / « …{b[max(0, i - 40):i + 60]}… »"
    return f"{chemin or '/'} : {str(a)[:80]} / {str(b)[:80]}"


def comparer(avant: Path, apres: Path, retirer_auteur: bool, attendues: set) -> int:
    lu_a, lu_b = (json.loads(f.read_text(encoding="utf-8")) for f in (avant, apres))
    a, b = lu_a["reponses"], lu_b["reponses"]
    retirees = VOLATILES + (("auteur",) if retirer_auteur else ())
    a, b = sans_cles(a, retirees), sans_cles(b, retirees)
    if retirer_auteur:
        # La migration allonge aussi chaque version gardée (historique/) de son champ : la liste des versions en dit la
        # taille en octets, qui ne se compare donc pas non plus.
        for r in (a, b):
            for k in [k for k in r if k.startswith(VERSIONS)]:
                r[k] = sans_cles(r[k], ("taille",))
    communes = sorted(set(a) & set(b))
    differentes = [k for k in communes if a[k] != b[k]]
    voulues = [k for k in differentes if k.split("?")[0] in attendues]
    imprevues = [k for k in differentes if k not in voulues]
    print(f"{len(communes)} réponse(s) des deux côtés : {len(communes) - len(differentes)} identique(s), "
          f"{len(imprevues)} différente(s), {len(voulues)} différente(s) attendue(s).")
    for k in imprevues[:40]:
        print(f"  DIFFÉRENTE {k} : {premiere_difference(a[k], b[k])}")
    for k in voulues:
        print(f"  attendue   {k} : {premiere_difference(a[k], b[k])}")
    for k in sorted(set(b) - set(a)):
        print(f"  nouvelle   {k} ({b[k]['statut']})")
    for k in sorted(set(a) - set(b)):
        print(f"  DISPARUE   {k}")
    # Le journal de veille du cloisonnement : une violation notée d'un côté fait échouer la comparaison.
    notees = [*(lu_a.get("cloisonnement") or []), *(lu_b.get("cloisonnement") or [])]
    for v in notees[:20]:
        print(f"  CLOISONNEMENT {' | '.join(v)}")
    return 1 if imprevues or set(a) - set(b) or notees else 0


def main_() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sous = p.add_subparsers(dest="commande", required=True)
    i = sous.add_parser("instantane")
    i.add_argument("--code", type=Path, required=True, help="le dossier app/ du code à interroger")
    i.add_argument("--donnees", type=Path, required=True)
    i.add_argument("--sortie", type=Path, required=True)
    i.add_argument("--en-ligne", action="store_true", help="comme l'atelier en ligne, avec l'ancien cookie du MJ principal")
    i.add_argument("--cycle", action="store_true", help="lance aussi les tâches de fond (publications du coin)")
    i.add_argument("--table-publique", action="store_true", help="comme table.exemple.org, sans cookie")
    i.add_argument("--sans-session", action="store_true", help="avec --en-ligne : sans cookie, comme Internet")
    i.add_argument("--connexion", action="store_true", help="avec --en-ligne : une session ouverte par le formulaire")
    i.add_argument("--identifiant", default="", help="avec --connexion : l'identifiant tapé (vide : le mot de passe seul)")
    i.add_argument("--tv", default="", help="ce que montre la TV dans la copie (table.json en JSON)")
    i.add_argument("--porte-eveillee", action="store_true", help="la porte du réseau local éveillée (ATELIER_PORTE_LAN)")
    i.add_argument("--appareil", action="store_true", help="sur le réseau local, avec le cookie d'un appareil reconnu")
    k = sous.add_parser("coin")
    k.add_argument("--code", type=Path, required=True)
    k.add_argument("--donnees", type=Path, required=True)
    k.add_argument("--sortie", type=Path, required=True)
    k.add_argument("--publier", type=float, default=0, help="secondes de tâches de fond de l'atelier avant le coin")
    k.add_argument("--cookies", type=Path, help="un instantané du coin dont reprendre les cookies des joueurs")
    k.add_argument("--tv", default="", help="ce que montre la TV dans la copie (table.json en JSON)")
    c = sous.add_parser("comparer")
    c.add_argument("avant", type=Path)
    c.add_argument("apres", type=Path)
    c.add_argument("--sans-auteur", action="store_true")
    c.add_argument("--attendues", default="", help="adresses (sans requête) dont la différence est voulue, séparées par des virgules")
    args = p.parse_args()
    if args.commande == "instantane":
        instantane(args.code.resolve(), args.donnees.resolve(), args.sortie.resolve(), args.en_ligne, args.cycle,
                   args.table_publique, args.sans_session, args.connexion, args.identifiant, args.tv,
                   args.porte_eveillee, args.appareil)
    elif args.commande == "coin":
        instantane_coin(args.code.resolve(), args.donnees.resolve(), args.sortie.resolve(), args.publier,
                        args.cookies.resolve() if args.cookies else None, args.tv)
    else:
        sys.exit(comparer(args.avant, args.apres, args.sans_auteur, {x for x in args.attendues.split(",") if x}))


if __name__ == "__main__":
    main_()
