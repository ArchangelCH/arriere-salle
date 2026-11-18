"""L'état de la table, sa diffusion aux écrans et la table du coin des joueurs."""

import asyncio
import hashlib
import io
import json
import re
from collections import OrderedDict
from datetime import datetime
from pathlib import Path

from fastapi import HTTPException, WebSocket
from fastapi.responses import Response

from campagne import univers
from mj import adresses
from commun import carnet
from mj import cloisonnement
from commun import deplacement
from table import horloges
from table import lectures_publiques
from ia import images_plan
from mj import proprietes
from contenu import sanctuaire
from commun import musique_coin
from commun import table_joueurs
from contenu import reserve
from table import vignettes
from coin_mj.mouvements import Mouvements
from table.masque import masquer, masquer_tout

from api.application import app
from api import config, utilitaires, seances_api, heros_etat, commandes_api, tv_cartes, tv_fiches, tv_plans, tv_medias, refuge


VERSIONS: dict[tuple, str] = {}


def version_en_cache(genre: str, ident: str, dossiers: tuple, calcul) -> str:
    """Le mode « Suivre » envoie un état toutes les 220 ms : la version n'est recalculée que si un fichier a bougé
    (chaque écriture remplace le fichier, donc change aussi la date de son dossier)."""
    # Un fichier encore absent (l'état des héros avant la première blessure) compte pour zéro.
    cle = (genre, ident, *(d.stat().st_mtime_ns if d.exists() else 0 for d in dossiers))
    if cle not in VERSIONS:
        if len(VERSIONS) > 64:
            VERSIONS.clear()
        VERSIONS[cle] = calcul()
    return VERSIONS[cle]


def etat_public(etat: dict) -> dict:
    public = {k: etat[k] for k in tv_boutique_combat.CLES_TABLE if k in etat}
    for cle, collection in tv_boutique_combat.REFS_TABLE.items():
        valeur = etat.get(cle)
        if isinstance(valeur, str) and config.ID_VALIDE.match(valeur):
            public[cle] = tv_cartes.jeton(collection, valeur)
        elif cle in etat:
            public[cle] = None
    # L'article d'une boutique montré de près : un identifiant court tiré au sort, rien d'autre ne passe.
    if etat.get("vue") == "boutique" and isinstance(etat.get("article"), str) and tv_boutique_combat.ARTICLE_VALIDE.match(etat["article"]):
        public["article"] = etat["article"]
    # Le rayon d'une boutique trop grande pour un écran (E07) : un numéro de page, rien d'autre.
    rayon = etat.get("rayon")
    if etat.get("vue") == "boutique" and isinstance(rayon, int) and not isinstance(rayon, bool) and 0 <= rayon < 100:
        public["rayon"] = rayon
    # Le bâtiment du sanctuaire montré de près (son identifiant : « auberge », « maison-2 »), s'il est montré aux joueurs.
    if etat.get("vue") == "sanctuaire" and isinstance(etat.get("batiment"), str) and sanctuaire.ID_COURT.match(etat["batiment"]):
        b = next((x for x in refuge.lire_sanctuaire().get("batiments", []) if x.get("id") == etat["batiment"]), None)
        if b and not b.get("cache"):
            public["batiment"] = etat["batiment"]
    if etat.get("vue") == "image":
        public["url"] = etat.get("url") if utilitaires.media_existant(etat.get("url")) else None
        public["titre"] = masquer(utilitaires.texte(etat.get("titre")))
    # Les horloges montrées à la TV (horloges.py), leur nom filtré ; pas de clé quand aucune n'est montrée.
    montrees = horloges.publiques(horloges.de_l_etat(etat))
    if montrees:
        public["horloges"] = montrees
    # Les deux réserves des dés d'aventure (reserve.py, lot G), quand la règle est en jeu : deux nombres, rien d'autre.
    des_aventure = reserve.publique_du_fichier(config.DONNEES)
    if des_aventure:
        public["reserve"] = des_aventure
    try:
        if etat.get("vue") == "carte" and public.get("carte"):
            ident = etat["carte"]
            public["version"] = version_en_cache("carte", ident, (utilitaires.existant(config.CARTES, ident, tout=True), config.LIEUX),
                                                 lambda: tv_cartes.version_carte(utilitaires.lire_fiche(utilitaires.existant(config.CARTES, ident, tout=True)), tv_cartes.lieux_connus()))
        elif etat.get("vue") == "plan" and public.get("plan"):
            ident = etat["plan"]
            public["version"] = version_en_cache("plan", ident, (utilitaires.existant(config.PLANS, ident, tout=True), config.PNJ, config.AVENTURIERS, heros_etat.ETATS_HEROS, config.SEANCES),
                                                 lambda: tv_plans.version_plan(utilitaires.lire_fiche(utilitaires.existant(config.PLANS, ident, tout=True))))
    except (HTTPException, OSError):
        pass
    return public


class Diffusion:
    """Les écrans de table branchés, comptés à part : ceux du salon (réseau local, VPN compris) et ceux venus d'Internet
    (la table publique), pour que des écrans en ligne ne prennent jamais la place de la TV du salon."""

    def __init__(self):
        self.salon: set[WebSocket] = set()
        self.internet: set[WebSocket] = set()
        # Les pages de l'atelier qui écoutent la table (/ws/atelier) : elles reçoivent ce que reçoit la TV du salon,
        # au même instant, sans compter parmi ses écrans. Chacune avec le compte MJ qui l'a ouverte : un message
        # qui ne concerne qu'un MJ ne part qu'à ses pages (adresses.py).
        self.atelier: dict[WebSocket, str] = {}

    async def envoyer_un(self, ecran: WebSocket, message: str, delai: float = 3) -> bool:
        try:
            await asyncio.wait_for(ecran.send_text(message), timeout=delai)
            return True
        except Exception:
            return False

    async def envoyer(self, ecrans: set[WebSocket], message: dict) -> None:
        # En parallèle et avec un délai : un écran qui ne lit plus ne bloque ni les autres ni le MJ.
        texte_ = json.dumps(message, ensure_ascii=False)
        liste = list(ecrans)
        resultats = await asyncio.gather(*(self.envoyer_un(e, texte_) for e in liste))
        for ecran, ok in zip(liste, resultats):
            if not ok:
                ecrans.discard(ecran)

    async def vers_atelier(self, message: dict, pour: str | None = None) -> None:
        """Vers les pages de l'atelier : toutes (pour None : ce que voit la TV, ce qui est commun aux deux MJ), ou celles
        du seul compte que le message concerne."""
        ecrans = {ws for ws, compte in list(self.atelier.items()) if adresses.adresse_a(pour, compte)}
        if not ecrans:
            return
        restes = set(ecrans)
        await self.envoyer(restes, message)
        for ws in ecrans - restes:
            self.atelier.pop(ws, None)

    async def couper(self, compte: str) -> None:
        """Les liaisons des pages de l'atelier ouvertes par ce compte se ferment (son mot de passe a changé) : une session
        coupée ne reçoit plus rien ; une page encore bonne se relie seule (canal-table.js)."""
        for ws in [w for w, c in list(self.atelier.items()) if c == compte]:
            self.atelier.pop(ws, None)
            try:
                await asyncio.wait_for(ws.close(code=1008), timeout=3)
            except Exception:
                pass

    async def signaler_combat(self, seance: str, combat: dict | None) -> None:
        """Un combat enregistré ou fini (combat None) : les pages de l'atelier le relisent aussitôt, même quand la TV ne
        montre pas l'ordre du tour. Ni la TV ni la table publique ne reçoivent ce signal ; l'autre MJ non plus."""
        if self.atelier:
            pour = cloisonnement.auteur_du_fichier(utilitaires.fichier(config.SEANCES, seance)) if config.ID_VALIDE.match(seance or "") else None
            await self.vers_atelier({"type": "combat", "seance": seance, "modifie": (combat or {}).get("modifie"),
                                     "par": (combat or {}).get("par", "")}, pour)

    async def diffuser(self, etat: dict) -> None:
        public = etat_public(etat)
        envois = [self.envoyer(self.salon, {"type": "etat", "etat": public})]
        if self.atelier:
            envois.append(self.vers_atelier({"type": "etat", "etat": etat_pour_l_atelier(etat, public)}))
        if self.internet:
            envois.append(self.envoyer(self.internet, {"type": "etat", "etat": etat_internet(public)}))
        await asyncio.gather(*envois)
        # La table du coin des joueurs suit, regroupée et sans la caméra (table_joueurs.py).
        table_coin.signaler()


diffusion = Diffusion()


def etat_pour_l_atelier(etat: dict, public: dict | None = None) -> dict:
    """Ce que reçoivent les pages de l'atelier : ce que reçoit la TV, et qui y a la main quand ce n'est pas le principal
    (« par », lot MJ-4 ; absent sans invité, comme avant). Jamais la TV."""
    public = etat_public(etat) if public is None else public
    tenant = adresses.tenant(etat)
    return public if tenant == proprietes.PRINCIPAL else public | {"par": tenant}


def table_publique() -> dict:
    """La table publique, ouverte ou fermée aux écrans venus d'Internet. Sans réglage, elle est ouverte ; un réglage illisible la ferme, par prudence."""
    if not config.TABLE_OUVERTURE.exists():
        return {"ouverte": True, "modifie": None}
    try:
        reglage = utilitaires.lire(config.TABLE_OUVERTURE)
    except (OSError, ValueError):
        reglage = None
    if not isinstance(reglage, dict) or not isinstance(reglage.get("ouverte"), bool):
        config.journal.warning("Réglage de la table publique illisible (%s) : table fermée", config.TABLE_OUVERTURE)
        return {"ouverte": False, "modifie": None}
    return {"ouverte": reglage["ouverte"], "modifie": reglage.get("modifie")}


JOURS = ("lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche")
MOIS = ("janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre")
HEURE_VALIDE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


def prochaine_seance(aujourdhui=None) -> str:
    """« dimanche 1er novembre à 14 h » : la plus proche des séances non closes datées d'aujourd'hui ou plus tard
    (l'année seulement si ce n'est pas celle-ci), sinon "". Rien d'autre de la séance : ni nom, ni lieux."""
    aujourdhui = aujourdhui or datetime.now().date()
    a_venir = []
    for s in utilitaires.lire_tout(config.SEANCES, tout=True):
        try:
            jour = datetime.strptime(utilitaires.texte(s.get("date")).strip(), "%Y-%m-%d").date()
        except ValueError:
            continue
        if not s.get("close") and jour >= aujourdhui:
            heure = HEURE_VALIDE.match(utilitaires.texte(s.get("heure")).strip())
            a_venir.append((jour, (int(heure.group(1)), heure.group(2)) if heure else None))
    if not a_venir:
        return ""
    jour, heure = min(a_venir, key=lambda x: (x[0], x[1] or (99, "")))
    clair = f"{JOURS[jour.weekday()]} {'1er' if jour.day == 1 else jour.day} {MOIS[jour.month - 1]}"
    if jour.year != aujourdhui.year:
        clair += f" {jour.year}"
    if heure:
        clair += f" à {heure[0]} h" + (f" {heure[1]}" if heure[1] != "00" else "")
    return clair


def etat_internet(public: dict) -> dict:
    """Ce que reçoit un écran venu d'Internet : ce que voit la TV du salon si la table publique est ouverte ; fermée,
    l'écran d'accueil, avec la date de la prochaine séance."""
    if table_publique()["ouverte"]:
        # « internet » : l'écran prend les portraits réduits (table.js), la TV du salon garde les images entières.
        return {**public, "internet": True}
    accueil = {"vue": "accueil"}
    prochaine = prochaine_seance()
    if prochaine:
        accueil["prochaine"] = prochaine
    return accueil


# La table dans le coin des joueurs (table_joueurs.py) : ce que montre la TV, sans sa caméra, publié dans
# propositions/table/ à chaque diffusion (regroupée), et le pion de chaque joueur sous la clé de son lien. Pour un plan,
# exactement ce que reçoit la TV (plan_public, passée au masque) ; pour une autre vue, son genre et un titre public. Le
# réglage du MJ (onglet Table) la tient fermée tant qu'il ne l'a pas ouverte.
TABLE_JOUEURS = config.DONNEES / "table-joueurs.json"
# Ce que la page du joueur écrit sous « La TV montre : » quand ce n'est pas un plan (les mots de l'onglet Table).
TITRES_TV = {"accueil": "l'écran d'accueil", "carte": "la carte", "plan": "un plan", "planche": "la planche à contrats",
             "precedemment": f"le « {univers.TITRE_PRECEDEMMENT}… »", "episode": "le titre de l'épisode",
             "heros": "la tablée des aventuriers", "fiches": "les fiches de la tablée", "boutique": "une boutique",
             "sanctuaire": "le sanctuaire", "image": "une illustration", "document": "un document"}
# Le champ sans lequel la TV ne montre pas cette vue (table.js, appliquer) : elle revient alors à l'accueil.
CHAMP_DE_LA_VUE = {"carte": "carte", "plan": "plan", "boutique": "boutique", "precedemment": "seance", "episode": "seance",
                   "image": "url", "document": "document"}
PORTRAIT_PION = 160  # pixels de large : le disque d'un pion, même zoomé sur un téléphone
IMAGE_PLAN_COIN = 640  # pixels de large : une image posée sur le plan, de quelques cases
STYLES_PLAN = ("couleur", "parchemin", "peint")


def reglage_table_joueurs() -> dict:
    try:
        return table_joueurs.reglage(utilitaires.lire(TABLE_JOUEURS))
    except (OSError, ValueError):
        return table_joueurs.reglage(None)


def genre_montre(etat: dict) -> str:
    vue = etat.get("vue")
    if vue not in TITRES_TV:
        return "accueil"
    champ = CHAMP_DE_LA_VUE.get(vue)
    return vue if not champ or etat.get(champ) else "accueil"


def portrait_pour_le_coin(url, medias: dict, largeur: int = PORTRAIT_PION, transparence: bool = False) -> str:
    """Le portrait d'un pion, réduit et publié sous un nom tiré de son contenu (le coin ne lit pas /media/). Une image
    du MJ (lot H2, pion ou décor) garde sa transparence : un PNG."""
    m = config.MEDIA_VALIDE.match(url) if isinstance(url, str) else None
    contenu = vignettes.vignette(config.IMAGES / m.group(1), largeur, transparence=transparence) if m else None
    if not contenu:
        return ""
    nom = table_joueurs.nom_media(contenu)
    medias[nom] = contenu
    return table_joueurs.adresse_media(nom)


# ---- Tout l'écran de la TV sur la table du coin (lot du 12/11) : pour chaque scène et chaque couche, la même projection
# publique que celle que lit la TV, publiée dans vue.json sous « ecran » :
#   - etat : l'état public de la table (etat_public : les jetons, jamais les identifiants), sans la caméra du MJ ;
#   - lectures : {chemin de /api/table/… : ce que la TV y lirait}, pour les seuls chemins que la table publique laisserait
#     lire en ce moment (lectures_publiques.chemins_montres fait référence), chacun par la fonction même de sa route : un
#     PNJ inconnu, une rumeur pas encore entendue, un document qui n'est plus à l'écran s'y refusent comme à la TV.
# Le coin ne sert pas /media/ : chaque image citée est réduite et publiée sous un nom tiré de son contenu (table/media/).
# Le plan et la carte gardent leur publication propre (le joueur les déplace, y bouge son pion) : seules leurs couches
# (cartons, horloges, réserve) passent par ici.
GRANDE_IMAGE = 1600  # pixels de large : une illustration en plein écran sur une tablette
MEDIA_CITE = re.compile(r"/media/[A-Za-z0-9][A-Za-z0-9._-]{0,120}")
_GRANDES: OrderedDict = OrderedDict()
GRANDES_GARDEES = 24


def grande_image(chemin: Path, largeur: int = GRANDE_IMAGE) -> bytes | None:
    """L'image réduite à `largeur` au plus, sans métadonnées : un JPEG, ou un PNG si elle a des pixels transparents.
    Gardée en mémoire tant que le fichier ne change pas ; None si elle est illisible."""
    try:
        st = chemin.stat()
    except OSError:
        return None
    cle = (str(chemin), st.st_size, st.st_mtime_ns, largeur)
    if cle in _GRANDES:
        _GRANDES.move_to_end(cle)
        return _GRANDES[cle]
    from PIL import Image, ImageOps

    try:
        with Image.open(chemin) as source:
            im = ImageOps.exif_transpose(source)
            im.thumbnail((largeur, 2 * largeur))
            sortie = io.BytesIO()
            if im.mode in ("RGBA", "LA", "PA", "P") and im.convert("RGBA").getchannel("A").getextrema()[0] < 255:
                propre = Image.new("RGBA", im.size)
                propre.paste(im.convert("RGBA"))
                propre.save(sortie, "PNG", optimize=True)
            else:
                im.convert("RGB").save(sortie, "JPEG", quality=82, optimize=True, progressive=True)
    except (OSError, ValueError, Image.DecompressionBombError):
        return None
    _GRANDES[cle] = sortie.getvalue()
    while len(_GRANDES) > GRANDES_GARDEES:
        _GRANDES.popitem(last=False)
    return _GRANDES[cle]


def image_pour_le_coin(url: str, medias: dict) -> str:
    """L'adresse publiée (table/media/…) d'une image de /media/, ou "" si elle n'existe pas ou ne se lit pas."""
    m = config.MEDIA_VALIDE.match(url) if isinstance(url, str) else None
    contenu = grande_image(config.IMAGES / m.group(1)) if m else None
    if not contenu:
        return ""
    nom = table_joueurs.nom_media(contenu)
    medias[nom] = contenu
    return table_joueurs.adresse_media(nom)


def medias_pour_le_coin(contenu, medias: dict):
    """Le contenu, où chaque adresse /media/… est remplacée par celle de l'image publiée pour le coin (rien si elle ne se
    publie pas) : aucune adresse de l'atelier ne reste."""
    if isinstance(contenu, dict):
        return {k: medias_pour_le_coin(v, medias) for k, v in contenu.items()}
    if isinstance(contenu, list):
        return [medias_pour_le_coin(v, medias) for v in contenu]
    if isinstance(contenu, str) and "/media/" in contenu:
        return MEDIA_CITE.sub(lambda m: image_pour_le_coin(m.group(0), medias), contenu)
    return contenu


def document_a_l_ecran(j: str) -> dict:
    """Le document que montre la TV, comme sa route (documents.py) : seulement tant qu'il est à l'écran."""
    chemin = tv_cartes.par_jeton(tv_fiches.remis.dossier, "documents", j)
    if not tv_fiches.remis.a_l_ecran(chemin.stem):
        raise HTTPException(404, "Introuvable")
    return masquer_tout(tv_fiches.remis.public(utilitaires.lire_fiche(chemin)))


def combat_sans_sablier(j: str):
    """Le bandeau du combat de la TV, sans le sablier : son compte se ferait sur une autre horloge."""
    c = json.loads(tv_boutique_combat.table_combat(j).body)
    c.pop("sablier", None)
    return c


# Chaque lecture de la TV (le premier segment de son chemin) et la fonction même de sa route. La carte et le plan n'y sont
# pas : le coin a les siens (carte_pour_le_coin, table_pour_le_coin).
LECTEURS_TV = {
    "planche": lambda _j: tv_fiches.table_planche(),
    "heros": lambda _j: tv_fiches.table_heros(),
    "fiches": lambda _j: tv_fiches.table_fiches(),
    "sanctuaire": lambda _j: tv_cartes.reponse_publique(sanctuaire.sanctuaire_public(refuge.lire_sanctuaire())),
    "lieu": lambda j: tv_medias.table_lieu(j),
    "boutique": lambda j: tv_boutique_combat.table_boutique(j),
    "precedemment": lambda j: tv_fiches.table_precedemment(j),
    "episode": lambda j: tv_fiches.table_episode(j),
    "pnj": lambda j: tv_fiches.table_pnj(j),
    "rumeur": lambda j: tv_fiches.table_rumeur(j),
    "document": document_a_l_ecran,
    "aventurier": lambda j: tv_fiches.table_aventurier(j),
    "combat": combat_sans_sablier,
}
SANS_ECRAN = ("carte", "plan")


def ecran_pour_le_coin(etat: dict, genre: str, medias: dict) -> dict:
    """{"etat", "lectures"} : ce que la TV reçoit et ce qu'elle lirait en ce moment, au masque, images publiées."""
    public = {k: v for k, v in etat_public(etat).items() if k != "camera"}
    if genre == "accueil":
        # Une vue sans sa fiche revient à l'accueil, comme à la TV ; la date de la prochaine séance s'y lit.
        public["vue"] = "accueil"
        prochaine = prochaine_seance()
        if prochaine:
            public["prochaine"] = prochaine
    if genre in SANS_ECRAN:
        # La page du joueur dessine elle-même le plan ou la carte publiés : leur version (une empreinte de la fiche entière,
        # qui change avec ce qui est encore caché) ne lui sert pas, et ne sort pas.
        public.pop("version", None)
    if genre == "plan":
        # La page du joueur a déjà le bandeau du combat du plan (vue.combat), sans sablier.
        public.pop("combat", None)
        public.pop("combat_maj", None)
    lectures = {}
    for chemin in lectures_publiques.chemins_montres(etat, tv_cartes.jeton):
        m = lectures_publiques.CHEMIN.match(chemin)
        quoi = m.group("quoi") if m else None
        if quoi not in LECTEURS_TV or (quoi == "combat" and genre == "plan"):
            continue
        try:
            reponse = LECTEURS_TV[quoi](m.group("jeton"))
        except HTTPException:
            continue  # refusé à la TV : refusé ici
        contenu = json.loads(reponse.body) if isinstance(reponse, Response) else reponse
        lectures[chemin] = masquer_tout(contenu)
    # Ce que la TV désigne sans pouvoir le lire (le carton d'un lieu ou d'un PNJ inconnus, un oubli du MJ) ne sort pas, même
    # sous son jeton : la référence s'efface de l'état.
    for cle in {c for c, _collection, _vue in lectures_publiques.FICHES.values()} - set(SANS_ECRAN):
        j = public.get(cle)
        if isinstance(j, str) and not any(ch.endswith(f"/{j}") for ch in lectures):
            public[cle] = None
    planche = lectures.get("/api/table/planche")
    if isinstance(public.get("contrat"), str) and public["contrat"] not in {c.get("id") for c in planche or [] if isinstance(c, dict)}:
        public["contrat"] = None
    return medias_pour_le_coin({"etat": masquer_tout(public), "lectures": lectures}, medias)


# ---- Les cartes : la carte que montre la TV, telle qu'elle la reçoit (carte_pour_table, passée au masque),
# sans sa caméra ni le carton d'un lieu. Des lieux, seulement le nom et le genre, tout ce que le dessin en lit : ni le
# résumé, que la TV ne montre qu'en carton, ni les illustrations. Le groupe n'y est que s'il est montré (carte_publique) ;
# seul le MJ le déplace. Le fond peint par l'atelier, quand il est à jour, part en JPEG dans les médias de la table.
def carte_pour_le_coin(etat: dict) -> tuple[dict, dict, dict]:
    ident = etat.get("carte")
    try:
        if not isinstance(ident, str) or not config.ID_VALIDE.match(ident):
            raise HTTPException(404, "Introuvable")
        chemin = utilitaires.existant(config.CARTES, ident, tout=True)
        publique = tv_cartes.carte_pour_table(chemin, tv_cartes.jeton("cartes", ident))
    except HTTPException:
        medias = {}
        return {"genre": "accueil", "titre": TITRES_TV["accueil"], "ecran": ecran_pour_le_coin(etat, "accueil", medias)}, medias, {}
    publique["lieux"] = {j: {"id": l.get("id"), "nom": l.get("nom", ""), "type": l.get("type", "point")}
                         for j, l in (publique.get("lieux") or {}).items()}
    style = next((x for x in (etat.get("style"), publique.get("style")) if x in STYLES_PLAN), "couleur")
    annonce = publique.pop("fond_peint", None)
    medias: dict = {}
    if annonce and style == "peint":
        contenu = table_joueurs.fond_en_jpeg(tv_cartes.FONDS_PEINTS / f"{chemin.stem}.png", annonce["url"])
        if contenu:
            nom = table_joueurs.nom_media(contenu)
            medias[nom] = contenu
            publique["fond_peint"] = {"url": table_joueurs.adresse_media(nom), "nouveaux": annonce.get("nouveaux")}
    return {"genre": "carte", "titre": TITRES_TV["carte"], "style": style, "carte": masquer_tout(publique),
            "ecran": ecran_pour_le_coin(etat, "carte", medias)}, medias, {}


def table_pour_le_coin() -> tuple[dict, dict, dict]:
    """(vue, images, {clé du lien : pion}) de ce que montre la TV en ce moment."""
    etat = tv_ecran.etat_table()
    genre = genre_montre(etat)
    if genre == "carte":
        return carte_pour_le_coin(etat)
    p = None
    if genre == "plan" and isinstance(etat["plan"], str) and config.ID_VALIDE.match(etat["plan"]):
        try:
            p = utilitaires.lire_fiche(utilitaires.existant(config.PLANS, etat["plan"], tout=True))
        except HTTPException:
            p = None
    medias: dict = {}
    if p is None:
        genre = "accueil" if genre == "plan" else genre
        return {"genre": genre, "titre": TITRES_TV[genre], "ecran": ecran_pour_le_coin(etat, genre, medias)}, medias, {}
    public = masquer_tout(tv_plans.plan_public(p, tv_cartes.jeton("plans", p["id"])))
    if public.get("fond"):
        contenu = tv_plans.fond_masque(p)
        nom = table_joueurs.nom_media(contenu)
        medias[nom] = contenu
        public["fond"]["url"] = table_joueurs.adresse_media(nom)
    for t in public["pions"]:
        t["image"] = portrait_pour_le_coin(t.get("image"), medias, transparence=t.get("image_libre") is True)
    # Les images posées sur le plan, réduites et publiées comme les portraits.
    for o in public["objets"]:
        if images_plan.est_image(o) and str(o.get("image")).startswith("/api/table/plan/"):
            # À demi révélée : masquée comme à la TV, puis publiée sous un nom tiré de son contenu.
            contenu = tv_plans.image_masquee(p, o["id"], IMAGE_PLAN_COIN)
            o["image"] = ""
            if contenu:
                nom = table_joueurs.nom_media(contenu)
                medias[nom] = contenu
                o["image"] = table_joueurs.adresse_media(nom)
        elif images_plan.est_image(o):
            o["image"] = portrait_pour_le_coin(o.get("image"), medias, IMAGE_PLAN_COIN, transparence=True)
    # Le bandeau du combat que la TV montre par-dessus le plan, sans le sablier (son compte se ferait sur une autre horloge).
    combat = None
    seance = etat.get("combat")
    if isinstance(seance, str) and config.ID_VALIDE.match(seance):
        try:
            c = seances_api.combat_de(utilitaires.lire_fiche(utilitaires.existant(config.SEANCES, seance, tout=True)))
        except HTTPException:
            c = None
        if c:
            bandeau = masquer_tout(tv_boutique_combat.combat_public(c, tv_cartes.jeton("seances", seance)))
            combat = {k: bandeau[k] for k in ("tour", "ordre", "actif", "strat")}
    style = next((x for x in (etat.get("style"), p.get("style")) if x in STYLES_PLAN), "couleur")
    # Le réglage des déplacements : la page du joueur montre où il peut aller, l'atelier revérifie toujours.
    reglage = reglage_table_joueurs()
    vue = {"genre": "plan", "titre": TITRES_TV["plan"], "style": style, "plan": public, "combat": combat,
           "regles": {k: reglage[k] for k in ("pions", "distance", "distance_combat", "entrer")},
           "ecran": ecran_pour_le_coin(etat, "plan", medias)}
    # Le pion de chaque joueur : celui de son héros, s'il est montré (ni caché, ni dans le noir, ni dans la brume épaisse).
    montres = {t.get("id") for t in public["pions"]}
    pions, liens = {}, carnet_api.heros_des_joueurs()
    for j in joueurs_mj.joueurs_lus():
        a = liens.get(utilitaires.texte(j.get("id"))) if isinstance(j, dict) else None
        if not a or not isinstance(j.get("jeton"), str):
            continue
        ref = f"aventurier:{a['id']}"
        sien = next((t for t in p.get("pions", []) if t.get("ref") == ref and t.get("id") in montres and isinstance(t.get("id"), str)), None)
        # Ses familiers montrés (19/11, ref « familier:<aventurier> ») : il les bouge aussi, au tour de son héros en combat.
        familiers = [{"id": t["id"], "debut": mouvements_joueurs.tour_publie(a["id"], p, t, familier=True)["debut"]}
                     for t in p.get("pions", []) if t.get("ref") == f"familier:{a['id']}" and t.get("id") in montres and isinstance(t.get("id"), str)]
        # Son tour au combat et la case où ce tour a commencé (mouvements.py), d'après le combat de sa séance non close.
        pions[carnet.cle_heros(hashlib.sha256(j["jeton"].encode()).hexdigest())] = {
            "pion": sien.get("id") if sien else None, **mouvements_joueurs.tour_publie(a["id"], p, sien), "familiers": familiers}
    return vue, medias, pions


@cloisonnement.au_fond
def publier_table_coin() -> dict:
    """Publie (ou retire) la table du coin ; rend ce que l'onglet Table en dit au MJ. Pour le serveur lui-même, d'où qu'on
    l'appelle (la tâche de la publication naît dans la requête qui la demande)."""
    if not reglage_table_joueurs()["ouverte"]:
        table_joueurs.fermer(config.PROPOSITIONS)
        musique_coin.effacer(config.PROPOSITIONS)
        return {"ouverte": False, "genre": None, "pions": 0}
    vue, medias, pions = table_pour_le_coin()
    table_joueurs.publier(config.PROPOSITIONS, vue, medias, pions)
    return {"ouverte": True, "genre": vue["genre"], "pions": sum(1 for x in pions.values() if x["pion"])}


table_coin = table_joueurs.Publication(publier_table_coin)


# Bouger son pion depuis le coin (lot E2, deplacement.py et mouvements.py) : la file des demandes pose le pion sur le plan
# que montre la TV, la TV et la table du coin suivent, l'éditeur ouvert le reçoit par /ws/atelier ({"type": "plan"}).

def plan_a_la_tv() -> tuple | None:
    """(chemin, fiche, jeton public) du plan que montre la TV, ou None."""
    etat = tv_ecran.etat_table()
    ident = etat.get("plan")
    if genre_montre(etat) != "plan" or not isinstance(ident, str) or not config.ID_VALIDE.match(ident):
        return None
    try:
        chemin = utilitaires.existant(config.PLANS, ident, tout=True)
        return chemin, utilitaires.lire_fiche(chemin), tv_cartes.jeton("plans", ident)
    except HTTPException:
        return None


def plan_par_id(ident: str) -> tuple | None:
    try:
        chemin = utilitaires.existant(config.PLANS, ident)
        return chemin, utilitaires.lire_fiche(chemin)
    except HTTPException:
        return None


def ecrire_plan_bouge(chemin: Path, p: dict) -> None:
    utilitaires.archiver(chemin, "plans")
    utilitaires.ecrire(chemin, p)


async def plan_a_jour_a_la_tv() -> None:
    etat = tv_ecran.etat_table()
    if etat.get("vue") == "plan":
        await diffusion.diffuser(etat)


def seances_en_jeu() -> list:
    """Les séances, pour le combat en cours d'un héros qui bouge son pion (mouvements.py) : celui que montre la TV, quel que
    soit le MJ qui le mène."""
    return utilitaires.lire_tout(config.SEANCES, tout=True)


async def signaler_plan(message: dict) -> None:
    """Les pions bougés depuis le coin : seulement aux pages du MJ dont c'est le plan."""
    plan = message.get("plan")
    pour = cloisonnement.auteur_du_fichier(utilitaires.fichier(config.PLANS, plan)) if isinstance(plan, str) and config.ID_VALIDE.match(plan) else None
    await commandes_api.signaler_demandes(message, pour)


def destinataire_deplacement(_j: dict, d: dict) -> str:
    """Un déplacement revient au MJ du plan où le joueur bouge son pion (désigné par le jeton de la TV) ; un plan disparu,
    au principal."""
    jeton_plan = (d.get("corps") or {}).get("plan")
    try:
        return cloisonnement.auteur_du_fichier(tv_cartes.par_jeton(config.PLANS, "plans", jeton_plan if isinstance(jeton_plan, str) else ""))
    except HTTPException:
        return proprietes.PRINCIPAL


mouvements_joueurs = Mouvements(
    config.DONNEES, reglage=reglage_table_joueurs, plan_montre=plan_a_la_tv, plan_par_id=plan_par_id, ecrire_plan=ecrire_plan_bouge,
    projection=tv_plans.plan_public, heros_du_joueur=lambda ident: carnet_api.heros_du_joueur(ident),
    seances=seances_en_jeu, diffuser=plan_a_jour_a_la_tv, publier_coin=table_coin.tout_de_suite,
    signaler=signaler_plan, maintenant=utilitaires.maintenant)
mouvements_joueurs.brancher(commandes_api.boite)
commandes_api.boite.adresser(deplacement.GENRE, destinataire_deplacement)


@app.get("/api/plans/{ident}/deplacements")
def deplacements_en_attente(ident: str):
    """Les déplacements des joueurs qui attendent le MJ sur ce plan, s'il est à la TV : l'éditeur montre leurs pions
    fantômes, et les accepte d'un clic (par la boîte, avec leur version). Et ce qui a arrêté un héros ces dernières minutes
    (lot E4 : une porte verrouillée, sa porte secrète tâtée), que l'éditeur dit au MJ. Seulement sur un plan du lecteur."""
    utilitaires.existant(config.PLANS, ident)
    return {"attente": mouvements_joueurs.en_attente(commandes_api.boite, ident), "tentatives": mouvements_joueurs.tentatives(ident)}


@app.get("/api/table-joueurs")
def lire_table_joueurs():
    return reglage_table_joueurs() | {"publie": table_coin.dernier}


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import joueurs_mj, carnet_api, tv_boutique_combat, tv_ecran  # noqa: E402
