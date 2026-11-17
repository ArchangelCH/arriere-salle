"""Les listes de fiches (GET /api/<collection>) servies en JSON déjà écrit, gardé en mémoire tant que le dossier ne change pas.

Un plan porte cinq grilles et ses objets : 13 plans font 340 Ko. Lus, filtrés, passés au sérialiseur de FastAPI puis
compressés à chaque appel, ils coûtaient 80 ms de processeur, et vingt appels à la fois (les écrans qui lisent tout au
chargement) s'attendaient les uns les autres : 1,8 s. Ici, la liste n'est faite qu'une fois par état du dossier (nom, taille,
date et inode de chaque fichier) et par lecteur (cloisonnement.py : le filtre dépend de qui lit) ; elle part avec un ETag, et
un navigateur qui la connaît déjà reçoit 304 sans corps. `resume` : seulement les champs désignés (la liste d'un menu n'a
pas besoin des grilles)."""

import hashlib
import json
import os
from pathlib import Path

from fastapi import Request, Response

from mj import cloisonnement

GARDEES = 64
_listes: dict = {}


def signature(dossier: Path) -> tuple:
    """L'état du dossier : ce qui change à chaque écriture d'une fiche (l'écriture remplace le fichier)."""
    etat = []
    try:
        with os.scandir(dossier) as entrees:
            for e in entrees:
                if e.name.endswith(".json"):
                    st = e.stat()
                    etat.append((e.name, st.st_size, st.st_mtime_ns, st.st_ino))
    except OSError:
        return ()
    return tuple(sorted(etat))


def reponse(requete: Request, dossier: Path, genre: str, fabriquer, resume: tuple | None = None) -> Response:
    """La liste (fabriquer() rend les fiches, déjà filtrées pour le lecteur) en JSON, avec son ETag ; 304 si la page l'a déjà.
    `genre` distingue les vues d'un même dossier (liste entière, projection d'un invité...) ; `resume` : champs gardés."""
    cle = (str(dossier), genre, cloisonnement.lecteur(), cloisonnement.strict(), resume, signature(dossier))
    gardee = _listes.get(cle)
    if gardee is None:
        notees = cloisonnement.notees()
        fiches = fabriquer()
        if resume:
            # « nb_x » : le nombre d'éléments de la liste x (sans la liste).
            fiches = [{k: (len(f.get(k[3:]) or []) if k.startswith("nb_") else f[k]) for k in resume if k in f or k.startswith("nb_")}
                      for f in fiches if isinstance(f, dict)]
        corps = json.dumps(fiches, ensure_ascii=False, separators=(",", ":")).encode()
        gardee = (corps, '"' + hashlib.sha1(corps).hexdigest()[:20] + '"')
        # Une lecture qui a noté une violation du cloisonnement (veille) ne se garde pas : chacune doit rester vue.
        if cloisonnement.notees() == notees:
            for ancienne in [c for c in _listes if c[:5] == cle[:5]]:
                _listes.pop(ancienne)
            while len(_listes) >= GARDEES:
                _listes.pop(next(iter(_listes)))
            _listes[cle] = gardee
    corps, etag = gardee
    entetes = {"ETag": etag, "Cache-Control": "no-cache"}
    if etag in [x.strip() for x in requete.headers.get("if-none-match", "").split(",")]:
        return Response(status_code=304, headers=entetes)
    return Response(corps, media_type="application/json", headers=entetes)
