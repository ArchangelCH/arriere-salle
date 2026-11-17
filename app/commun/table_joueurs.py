"""La table dans le coin des joueurs : depuis son téléphone ou sa tablette, en visio comme autour de la table, un joueur
voit le plan que montre la TV, le déplace et le zoome à sa guise (sans la caméra du MJ), et y voit son propre pion.

L'atelier publie dans le dossier des propositions (table/) ce que montre la TV, sans sa caméra :
  - vue.json : pour un plan, la projection même de la TV (plan_public, passée au masque) et le bandeau du combat montré ;
    pour une carte du monde, la carte même de la TV (carte_pour_table, passée au masque), sans le résumé ni les
    illustrations des lieux ; pour une autre vue (accueil, fiche…), son genre et un titre public, rien d'autre ;
  - media/ : le fond du plan, noirci hors des cases révélées, et les portraits réduits des pions montrés ; ou le fond
    peint de la carte, en JPEG ;
  - pions/<clé>.json : pour chaque joueur dont le héros est à la tablée, sous la clé de son lien (carnet.cle_heros),
    l'id public de son pion sur le plan montré (jamais sa référence), s'il est au combat, s'il y a la main, et la case où
    son tour a commencé (mouvements.py) ;
  - dans vue.json, le réglage des déplacements (regles : pions libres, à valider ou figés, distances, entrer).
  - jets.json (lot du 12/11) : les derniers bandeaux de jets partis à la TV (les tests et les dés des joueurs, les dés du
    MJ montrés à la table), tels que la TV les reçoit, avec leur heure : chaque joueur voit le jet des autres sur sa page
    Table. Jamais dans propositions/jets/, que la publication des fiches de jet efface.
Table fermée par le MJ : table/ n'existe pas. Un autre plan ou une autre carte montrés effacent le fond de l'ancien.

Le coin ne choisit jamais un fichier d'après la requête : la vue a un nom fixe, le pion se trouve par la clé du lien du
joueur (son cookie), une image par un nom vérifié.

Ce module ne lit rien de l'atelier : main.py lui passe ce qu'il publie (pour le fond d'une carte, le chemin de son PNG),
joueurs.py lit ce qui est publié. Le réglage du
MJ (data/table-joueurs.json) règle aussi les déplacements des joueurs (deplacement.py, mouvements.py) : pions libres, à
valider ou figés, distances hors combat et en combat, pièce révélée quand un héros y entre.
"""
import asyncio
import hashlib
import io
import json
import logging
import re
import shutil
import threading
from datetime import datetime
from pathlib import Path
from typing import Callable
from commun import stockage

journal = logging.getLogger("atelier.table-joueurs")

DOSSIER = "table"
VUE = "vue.json"
MEDIA = "media"
PIONS = "pions"
# Un JPEG, ou un PNG pour une image du MJ qui garde sa transparence.
NOM_MEDIA = re.compile(r"^[a-f0-9]{24}\.(?:jpg|png)$")
CLE = re.compile(r"^[a-f0-9]{32}$")
VUE_OCTETS_MAX = 8 * 1024 * 1024  # un plan de 100 × 100 cases pèse quelques centaines de Ko
PION_OCTETS_MAX = 4096
JETS = "jets.json"
JETS_GARDES = 8  # les derniers bandeaux publiés : une page qui relit ne manque pas un jet tombé juste avant
JET_FRAIS = 20  # secondes : au-delà, un jet n'est plus rejoué (une page revenue de veille ne redit pas un vieux jet)
JETS_OCTETS_MAX = 64 * 1024
VERROU_JETS = threading.Lock()

# Le réglage du MJ. Fermée par défaut : rien ne part vers le coin tant qu'il ne l'a pas ouverte.
MODES_PIONS = ("libres", "a-valider", "figes")
DISTANCE = (1, 60)  # cases par déplacement, hors combat
DISTANCE_COMBAT = (1, 30)  # cases par tour de combat
REGLAGE_DEFAUT = {"ouverte": False, "pions": "a-valider", "distance": 12, "distance_combat": 6, "entrer": True}

REGROUPEMENT = 0.15  # secondes : la TV qui change plusieurs fois de suite ne republie qu'une fois
SECOURS = 30  # secondes : ce qui change sans passer par la TV (un héros relié à son joueur) se rattrape


class Refus(Exception):
    def __init__(self, statut: int, message: str):
        super().__init__(message)
        self.statut = statut
        self.message = message


def maintenant() -> str:
    return datetime.now().isoformat(timespec="milliseconds")


# ------------------------------------------------------------ le réglage du MJ

def entier(v, bornes: tuple, defaut: int) -> int:
    if isinstance(v, bool) or not isinstance(v, int) or not bornes[0] <= v <= bornes[1]:
        return defaut
    return v


def reglage(valeur) -> dict:
    """Le réglage lu du disque, champ par champ : un champ absent ou abîmé reprend sa valeur par défaut (un réglage
    illisible laisse donc la table fermée)."""
    v = valeur if isinstance(valeur, dict) else {}
    r = dict(REGLAGE_DEFAUT)
    if isinstance(v.get("ouverte"), bool):
        r["ouverte"] = v["ouverte"]
    if v.get("pions") in MODES_PIONS:
        r["pions"] = v["pions"]
    r["distance"] = entier(v.get("distance"), DISTANCE, r["distance"])
    r["distance_combat"] = entier(v.get("distance_combat"), DISTANCE_COMBAT, r["distance_combat"])
    if isinstance(v.get("entrer"), bool):
        r["entrer"] = v["entrer"]
    r["modifie"] = v.get("modifie") if isinstance(v.get("modifie"), str) else None
    return r


def changer(avant: dict, corps: dict) -> dict:
    """Le réglage après un geste du MJ : seuls les champs envoyés changent ; une valeur hors bornes est refusée."""
    if not isinstance(corps, dict) or not set(corps) & set(REGLAGE_DEFAUT):
        raise Refus(400, "Aucun réglage reconnu")
    r = reglage(avant)
    for cle in ("ouverte", "entrer"):
        if cle in corps:
            if not isinstance(corps[cle], bool):
                raise Refus(400, f"Champ « {cle} » attendu : vrai ou faux")
            r[cle] = corps[cle]
    if "pions" in corps:
        if corps["pions"] not in MODES_PIONS:
            raise Refus(400, "Champ « pions » attendu : libres, a-valider ou figes")
        r["pions"] = corps["pions"]
    for cle, bornes in (("distance", DISTANCE), ("distance_combat", DISTANCE_COMBAT)):
        if cle in corps:
            if entier(corps[cle], bornes, None) is None:
                raise Refus(400, f"Champ « {cle} » attendu : un nombre de cases de {bornes[0]} à {bornes[1]}")
            r[cle] = corps[cle]
    return r


# ------------------------------------------------------------ écrire (l'atelier)

def nom_media(contenu: bytes) -> str:
    """Le nom d'une image publiée : tiré de son contenu, il ne dit rien de son nom dans l'atelier."""
    return hashlib.sha256(contenu).hexdigest()[:24] + (".png" if contenu[:8] == b"\x89PNG\r\n\x1a\n" else ".jpg")


def adresse_media(nom: str) -> str:
    return f"/table/media/{nom}"


def ecrire_atomique(chemin: Path, contenu: bytes) -> None:
    chemin.parent.mkdir(parents=True, exist_ok=True)
    stockage.ecrire_octets(chemin, contenu, mode=0o644)


def json_octets(contenu) -> bytes:
    return json.dumps(contenu, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def lire_json(chemin: Path, maximum: int):
    try:
        if chemin.stat().st_size > maximum:
            return None
        return stockage.lire_json(chemin)
    except (OSError, ValueError):
        return None


def ecrire_si_change(chemin: Path, contenu: dict) -> bool:
    """Écrit {"maj", ...} seulement si le contenu a changé : « maj » reste la date du dernier vrai changement, et le
    flux du coin ne réveille les pages que pour du nouveau."""
    avant = lire_json(chemin, VUE_OCTETS_MAX)
    if isinstance(avant, dict) and {k: v for k, v in avant.items() if k != "maj"} == json.loads(json_octets(contenu)):
        return False
    ecrire_atomique(chemin, json_octets({"maj": maintenant(), **contenu}))
    return True


def publier(depot: Path, vue: dict, medias: dict, pions: dict) -> int:
    """Écrit la table du coin : les images d'abord (la vue y renvoie), puis le pion de chaque joueur et la vue ; enfin,
    ce qui n'est plus montré s'en va (le fond d'un plan qui n'est plus à la TV, le pion d'un joueur parti). Rend le
    nombre de fichiers écrits ou retirés."""
    dossier = depot / DOSSIER
    for d in (dossier, dossier / MEDIA, dossier / PIONS):
        d.mkdir(parents=True, exist_ok=True)
    ecrits = 0
    for nom, contenu in medias.items():
        if NOM_MEDIA.match(nom) and not (dossier / MEDIA / nom).exists():
            ecrire_atomique(dossier / MEDIA / nom, contenu)
            ecrits += 1
    for cle, pion in pions.items():
        if CLE.match(cle):
            ecrits += ecrire_si_change(dossier / PIONS / f"{cle}.json", pion)
    for f in (dossier / PIONS).glob("*.json"):
        if f.stem not in pions:
            f.unlink(missing_ok=True)
            ecrits += 1
    ecrits += ecrire_si_change(dossier / VUE, vue)
    for f in (dossier / MEDIA).iterdir():
        if f.name not in medias and not f.name.startswith("."):
            f.unlink(missing_ok=True)
            ecrits += 1
    return ecrits


# ---- Les jets des autres (lot du 12/11) : le bandeau qui part à la TV part aussi vers la table du coin.

def ajouter_jet(depot: Path, message: dict) -> bool:
    """Le message d'un jet (celui de la TV, déjà au masque) rejoint les derniers publiés, avec son heure. Seulement table
    du coin ouverte (table/ existe) ; rend vrai s'il est écrit."""
    dossier = depot / DOSSIER
    if not dossier.is_dir() or not isinstance(message, dict) or message.get("type") not in ("jet", "des"):
        return False
    with VERROU_JETS:
        avant = lire_json(dossier / JETS, JETS_OCTETS_MAX)
        liste = [x for x in (avant.get("jets") if isinstance(avant, dict) else None) or [] if isinstance(x, dict)]
        liste.append({**message, "quand": maintenant()})
        ecrire_atomique(dossier / JETS, json_octets({"jets": liste[-JETS_GARDES:]}))
    return True


def jets_publies(depot: Path, instant: datetime | None = None) -> list:
    """Les derniers bandeaux de jets, chacun avec son âge en secondes (compté ici : l'horloge du téléphone ne compte pas)
    et « frais » s'il est assez récent pour être joué. Table fermée : rien."""
    if vue_publiee(depot) is None:
        return []
    lu = lire_json(depot / DOSSIER / JETS, JETS_OCTETS_MAX)
    instant = instant or datetime.now()
    sortie = []
    for x in (lu.get("jets") if isinstance(lu, dict) else None) or []:
        if not isinstance(x, dict) or x.get("type") not in ("jet", "des") or not isinstance(x.get("id"), str):
            continue
        try:
            age = (instant - datetime.fromisoformat(x.get("quand"))).total_seconds()
        except (TypeError, ValueError):
            continue
        sortie.append({**{k: v for k, v in x.items() if k != "quand"}, "age": round(max(0.0, age), 1), "frais": -60 < age < JET_FRAIS})
    return sortie[-JETS_GARDES:]


# ---- Les cartes : le fond peint d'une carte, que l'atelier garde en PNG (une dizaine de Mo pour une grande carte),
# part au coin en JPEG, huit fois plus léger, aux mêmes dimensions (la vue de la carte le pose tel quel sous ce qui se
# dessine dessus). Converti une fois par fond, gardé tant que la TV le montre.
FONDS_CARTES: dict = {}
QUALITE_FOND_CARTE = 85


def fond_en_jpeg(chemin: Path, cle: str) -> bytes | None:
    """Le fond peint de chemin (PNG), en JPEG ; cle : ce qui le désigne pour la TV (son adresse et son empreinte)."""
    try:
        etat = chemin.stat()
    except OSError:
        return None
    ident = (str(chemin), etat.st_mtime_ns, etat.st_size, cle)
    if ident in FONDS_CARTES:
        return FONDS_CARTES[ident]
    from PIL import Image

    try:
        with Image.open(chemin) as source:
            image = source.convert("RGB")
    except (OSError, ValueError, Image.DecompressionBombError):
        return None
    sortie = io.BytesIO()
    image.save(sortie, "JPEG", quality=QUALITE_FOND_CARTE, optimize=True)
    while len(FONDS_CARTES) >= 3:
        FONDS_CARTES.pop(next(iter(FONDS_CARTES)))
    FONDS_CARTES[ident] = sortie.getvalue()
    return FONDS_CARTES[ident]


def fermer(depot: Path) -> bool:
    """Table fermée : il ne reste rien dans les propositions."""
    dossier = depot / DOSSIER
    if not dossier.exists():
        return False
    shutil.rmtree(dossier, ignore_errors=True)
    return True


class Publication:
    """Publie la table du coin quand la TV change (signaler, en fin de diffusion), regroupé sur REGROUPEMENT : le mode
    « Suivre » de l'éditeur, qui envoie sa caméra toutes les 220 ms, ne republie qu'au rythme de ses vrais changements
    (publier n'écrit que ce qui change). Une publication à la fois, hors de la boucle d'événements. veiller() republie de
    secours toutes les SECOURS secondes : un héros relié à son joueur, un nom changé, sans rien à la TV."""

    def __init__(self, publier_: Callable[[], dict], regroupement: float = REGROUPEMENT, secours: float = SECOURS):
        self.publier = publier_
        self.regroupement = regroupement
        self.secours = secours
        self.verrou = threading.Lock()
        self.tache: asyncio.Task | None = None
        self.boucle = None
        self.encore = False
        self.dernier: dict | None = None
        self.erreur = ""

    def tout_de_suite(self) -> dict:
        with self.verrou:
            try:
                self.dernier = self.publier()
                self.erreur = ""
            except Exception as err:
                # La même erreur n'est notée qu'une fois : la publication suivante réessaie.
                if repr(err) != self.erreur:
                    self.erreur = repr(err)
                    journal.exception("Table du coin des joueurs non publiée")
                raise
            return self.dernier

    def signaler(self) -> None:
        try:
            boucle = asyncio.get_running_loop()
        except RuntimeError:
            return
        self.encore = True
        # Une autre boucle (un redémarrage, un autre client d'essai) : la tâche d'avant n'y tourne plus.
        if self.tache is None or self.tache.done() or self.boucle is not boucle:
            self.boucle = boucle
            self.tache = boucle.create_task(self.tourner())

    async def tourner(self) -> None:
        while True:
            await asyncio.sleep(self.regroupement)
            self.encore = False
            try:
                await asyncio.to_thread(self.tout_de_suite)
            except Exception:
                pass
            # Un changement arrivé pendant la publication en demande une autre ; ceux d'avant y sont déjà.
            if not self.encore:
                return

    async def veiller(self) -> None:
        while True:
            await asyncio.sleep(self.secours)
            self.signaler()


# ------------------------------------------------------------ lire (le coin)

def vue_publiee(depot: Path) -> dict | None:
    """La vue publiée, ou None : table fermée, ou rien de lisible."""
    v = lire_json(depot / DOSSIER / VUE, VUE_OCTETS_MAX)
    return v if isinstance(v, dict) and isinstance(v.get("genre"), str) else None


def case_publiee(v) -> list | None:
    return [v[0], v[1]] if isinstance(v, list) and len(v) == 2 and all(isinstance(x, int) and not isinstance(x, bool) and 0 <= x < 1000 for x in v) else None


def pion_publie(depot: Path, cle: str, vue: dict | None) -> dict:
    """Le pion du joueur de cette clé sur le plan publié : son id public s'il y est vraiment montré, s'il a la main au
    combat, s'il est au combat, et la case où son tour a commencé (bouger son pion, lot E2). Sinon, rien."""
    rien = {"pion": None, "mon_tour": False, "combat": False, "debut": None}
    plan = (vue or {}).get("plan")
    if not CLE.match(cle or "") or not isinstance(plan, dict):
        return rien
    p = lire_json(depot / DOSSIER / PIONS / f"{cle}.json", PION_OCTETS_MAX)
    if not isinstance(p, dict) or not isinstance(p.get("pion"), str):
        return rien
    montres = {t.get("id") for t in plan.get("pions") or [] if isinstance(t, dict) and isinstance(t.get("id"), str)}
    if p["pion"] not in montres:
        return rien
    return {"pion": p["pion"], "mon_tour": p.get("mon_tour") is True, "combat": p.get("combat") is True, "debut": case_publiee(p.get("debut"))}


def media_publie(depot: Path, nom: str) -> Path | None:
    if not NOM_MEDIA.match(nom or ""):
        return None
    chemin = depot / DOSSIER / MEDIA / nom
    return chemin if chemin.is_file() else None
