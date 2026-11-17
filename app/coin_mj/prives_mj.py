"""Les billets privés, côté atelier : le MJ envoie un billet secret d'une séance (Préparer, ou le rappel de la scène en
cours dans Jouer) sur le téléphone de chaque héros destinataire qui a un joueur relié, ou remet un document à un seul
héros, sans le montrer à la TV ni le mettre dans « Documents reçus » ; il voit « envoyé à 21 h 02 », puis « lu à 21 h 04 »,
et retire ce qui est parti par erreur. L'impression des billets ne change pas.

Ce que le MJ a envoyé vit dans data/prives.json, que l'atelier seul écrit : pour chaque héros, une copie du billet ou du
document tel qu'il est parti (un envoi). Le coin en reçoit la publication (prives.py) ; il écrit lui-même les lectures,
que la tâche de fond (surveiller) guette pour prévenir les pages de l'atelier par leur canal ({"type": "prives"}).

La règle de ce qui part :
  - tout passe au masque : le nom caché de l'auberge ne sort jamais, même vers le seul joueur qui reçoit le billet ;
  - un billet est fait pour dire à un joueur ce que les autres ignorent : un PNJ ou un lieu encore inconnu qu'il nomme
    part tel que le MJ l'a écrit, après une question (comme le carton d'un PNJ avant la TV) ;
  - le peuple caché d'un autre héros n'est pas un secret du MJ mais celui d'un joueur : un billet qui le nomme ne part
    pas vers un autre que ce héros (retenir), le MJ le dit de vive voix ou l'imprime.
"""
import asyncio
import hashlib
import json
import logging
import threading
from pathlib import Path
from typing import Awaitable, Callable

from fastapi import APIRouter, HTTPException, Request

from commun import carnet
from mj import cloisonnement
from contenu import documents as docs
from commun import prives
from mj import proprietes
from commun import veille
from commun import stockage

journal = logging.getLogger("atelier.prives")

REGROUPEMENT = 100  # millisecondes : un billet lu se voit chez le MJ dans la seconde
SECOURS = 5  # secondes : un lien renouvelé, le nom de l'auberge changé, la publication suit
ENVOIS_MAX = 600  # gardés dans data/prives.json, les plus récents
CHAMPS_DOCUMENT = ("genre", "nom", "texte", "signature", "image", "sceau")


class Refus(Exception):
    def __init__(self, statut: int, message: str):
        super().__init__(message)
        self.statut = statut
        self.message = message


def prenom_de(rangee: dict | None, heros: dict | None = None) -> str:
    """Le prénom du héros, tel qu'on le dit à table et tel que l'imprime le billet (billets.js, prenom)."""
    for nom in ((rangee or {}).get("personnage"), (heros or {}).get("nom")):
        if isinstance(nom, str) and nom.split():
            return nom.split()[0]
    joueur = (rangee or {}).get("joueur")
    return joueur.strip() if isinstance(joueur, str) and joueur.strip() else "un héros"


class PrivesMJ:
    """Les fonctions de main.py arrivent par le constructeur :
      joueurs_lus() : les joueurs invités (avec leur jeton) ; heros_des_joueurs() : {joueur : fiche de son héros} ;
      tablee() : la tablée de la campagne ; lire_seance(id), lire_document(id) : la fiche, ou None ;
      masquer_tout(contenu) ; candidats() : les secrets des joueurs (secrets_des_joueurs) ;
      retenir(element, essentiel, quoi, candidats, retenus) ; secrets_dans(texte, candidats) ; noms_secrets(trouves) ;
      image_source(url) : le fichier d'une image de l'atelier, ou None ; sources() : les fichiers dont la publication
      dépend ; signaler(message) : vers les pages de l'atelier seules. comptes() (lot MJ-4) : les MJ qui ouvrent
      l'atelier, [{"id", "nom"}] ; avec eux, chacun n'est prévenu que de ses billets, par signaler(message, compte)."""

    def __init__(self, depot: Path, donnees: Path, *, joueurs_lus, heros_des_joueurs, tablee, lire_seance, lire_document,
                 masquer_tout, candidats, retenir, secrets_dans, noms_secrets, image_source, sources,
                 signaler: Callable[..., Awaitable[None]], comptes: Callable[[], list] | None = None):
        self.depot = depot
        self.fichier = donnees / "prives.json"
        self.joueurs_lus = joueurs_lus
        self.heros_des_joueurs = heros_des_joueurs
        self.tablee = tablee
        self.lire_seance = lire_seance
        self.lire_document = lire_document
        self.masquer_tout = masquer_tout
        self.candidats = candidats
        self.retenir = retenir
        self.secrets_dans = secrets_dans
        self.noms_secrets = noms_secrets
        self.image_source = image_source
        self.sources = sources
        self.signaler = signaler
        self.verrou = threading.Lock()
        self.vu = None  # l'empreinte des sources à la dernière publication
        self.vu_lus = None  # celle des lectures notées par le coin, au dernier état annoncé
        self.signature = None  # le dernier état annoncé aux pages de l'atelier (celles du principal)
        self.signatures: dict[str, str] = {}  # le même, compte par compte
        self.comptes = comptes
        # {envoi : pourquoi il ne part pas}, refait à chaque publication : l'état du MJ le dit sans relire les secrets.
        self.retenus: dict = {}
        self.passages = 0

    # ------------------------------------------------------------ les envois

    def lire(self) -> list:
        try:
            contenu = stockage.lire_json(self.fichier)
        except (OSError, ValueError):
            return []
        envois = contenu.get("envois") if isinstance(contenu, dict) else None
        return [x for x in envois or [] if isinstance(x, dict) and isinstance(x.get("id"), str) and prives.ID.match(x["id"])
                and x.get("nature") in prives.NATURES]

    def ecrire(self, envois: list) -> None:
        envois = sorted(envois, key=lambda x: str(x.get("envoye") or ""))[-ENVOIS_MAX:]
        self.fichier.parent.mkdir(parents=True, exist_ok=True)
        stockage.ecrire_json_compact(self.fichier, {"envois": envois})

    def liens(self) -> dict:
        """{id du héros : (id du joueur, fiche du héros)} des héros qui ont un joueur relié."""
        return {a["id"]: (jid, a) for jid, a in self.heros_des_joueurs().items() if isinstance(a, dict) and isinstance(a.get("id"), str)}

    # ------------------------------------------------------------ la règle de ce qui part

    def element(self, envoi: dict) -> dict:
        """Le billet tel que le lit son joueur, avant le masque : liste blanche, sans rien de la séance ni de la fiche."""
        e = {"id": envoi["id"], "nature": envoi["nature"], "pour": str(envoi.get("pour") or ""), "envoye": str(envoi.get("envoye") or "")}
        if envoi["nature"] == "billet":
            return e | {"titre": prives.court(envoi.get("titre"), prives.TITRE_MAX), "texte": prives.court(envoi.get("texte"), prives.TEXTE_MAX),
                        "aussi": [x for x in envoi.get("aussi") or [] if isinstance(x, str)][:8]}
        return e | {k: envoi.get(k) for k in CHAMPS_DOCUMENT}

    def peuples_des_autres(self, heros: str, candidats: list) -> list:
        """Les peuples cachés que porte un autre héros que le destinataire : ils ne lui partent pas."""
        return [(s, f) for s, f in candidats if s.get("genre") == "peuple" and set(s.get("ids") or []) - {heros}]

    def raison_retenue(self, element: dict, heros: str, candidats: list) -> str:
        """Pourquoi ce billet ne part pas vers ce héros ("" s'il part)."""
        autres = self.peuples_des_autres(heros, candidats)
        if not autres:
            return ""
        vu = self.masquer_tout(element)
        retenus: list = []
        if self.retenir(vu, "texte", ("Ce billet", False), autres, retenus) is None or retenus:
            trouves = self.secrets_dans("\n".join(str(vu.get(k) or "") for k in ("titre", "texte", "nom", "signature")), autres)
            return f"il nomme {self.noms_secrets(trouves)}, le secret d'un autre joueur" if trouves else "il nomme le secret d'un autre joueur"
        return ""

    def inconnus(self, element: dict, candidats: list) -> list:
        """Les PNJ et lieux encore inconnus des joueurs que nomme le billet, tel qu'il partirait (après le masque)."""
        vu = self.masquer_tout(element)
        texte = "\n".join(str(vu.get(k) or "") for k in ("titre", "texte", "nom", "signature"))
        return self.secrets_dans(texte, [(s, f) for s, f in candidats if s.get("genre") in ("pnj", "lieu")])

    # ------------------------------------------------------------ publier

    def publier(self) -> int:
        """Chaque envoi va au joueur noté à l'envoi, sous la clé de son lien du moment (un lien renouvelé suit) ; un joueur
        retiré ne reçoit plus rien. Le masque et la règle des peuples cachés s'appliquent à chaque publication : un nom
        d'auberge changé, un peuple caché depuis, sont suivis.
        Sous le verrou des envois de bout en bout : une publication partie avant un retrait (la veille de secours) ne peut
        pas écrire après celle du retrait, le billet ne revient pas sur le téléphone. Quelques millisecondes, rien d'attendu."""
        with self.verrou:
            envois = self.lire()
            joueurs = {j["id"]: j for j in self.joueurs_lus() if isinstance(j, dict) and isinstance(j.get("id"), str)
                       and isinstance(j.get("jeton"), str) and j["jeton"]}
            candidats = self.candidats() if envois else []
            par_cle, images, retenus = {}, {}, {}
            for envoi in envois:
                element = self.element(envoi)
                # Le motif d'un billet retenu se lit dans l'atelier de son MJ : il y nomme ce que ce MJ peut lire.
                with cloisonnement.ecrit_pour(proprietes.auteur_de(envoi)):
                    raison = self.raison_retenue(element, str(envoi.get("heros") or ""), candidats)
                if raison:
                    retenus[envoi["id"]] = raison
                    continue
                j = joueurs.get(envoi.get("joueur"))
                if not j:
                    continue
                if element["nature"] == "document":
                    element["image"] = self.miniature(element.get("image"), images)
                cle = carnet.cle_heros(hashlib.sha256(j["jeton"].encode()).hexdigest())
                par_cle.setdefault(cle, []).append(self.masquer_tout(element))
            self.retenus = retenus
            return prives.publier(self.depot, par_cle, images)

    def miniature(self, url, images: dict) -> str | None:
        source = self.image_source(url)
        nom = carnet.nom_media(source) if source else None
        if not nom:
            return None
        images[nom] = source
        return f"/prives/media/{nom}"

    # ------------------------------------------------------------ ce que voit le MJ

    @staticmethod
    def au_lecteur(envoi: dict) -> bool:
        """Un envoi du MJ qui lit (« auteur » ; absent : le principal) : chacun ne voit et ne retire que les siens."""
        return proprietes.auteur_de(envoi) == cloisonnement.destinataire() or not cloisonnement.refuse("billet-d-un-autre")

    def etat(self) -> dict:
        """Pour l'atelier : les héros joignables (un joueur relié) et chaque envoi, avec l'heure où son joueur l'a lu."""
        liens = self.liens()
        joueurs = {j.get("id"): j for j in self.joueurs_lus() if isinstance(j, dict)}
        with self.verrou:
            envois = [x for x in self.lire() if self.au_lecteur(x)]
        lus: dict = {}
        vue = []
        for x in envois:
            jid = x.get("joueur")
            if jid not in lus:
                try:
                    lus[jid] = prives.lire_lus(self.depot, jid)
                except ValueError:
                    lus[jid] = {}
            vue.append({k: v for k, v in x.items() if k != "auteur"}
                       | {"lu": lus[jid].get(x["id"]), "joueur_nom": str((joueurs.get(jid) or {}).get("nom") or ""),
                          "retenu": self.retenus.get(x["id"], ""), "joueur_parti": jid not in joueurs})
        joignables = [{"heros": aid, "joueur": jid, "joueur_nom": str((joueurs.get(jid) or {}).get("nom") or ""),
                       "prenom": prenom_de(None, a)} for aid, (jid, a) in liens.items()]
        # Ce qui se dit aux pages ouvertes : un envoi, une lecture, un retrait. Les héros joignables se relisent à
        # l'ouverture de chaque page (un joueur relié ailleurs ne fait pas parler le canal).
        signature = hashlib.sha256(json.dumps([(v["id"], v["lu"], v["retenu"], v["envoye"]) for v in vue],
                                              sort_keys=True, default=str).encode()).hexdigest()[:20]
        return {"joignables": joignables, "envois": vue, "signature": signature}

    async def annoncer(self, etat: dict | None = None) -> dict:
        etat = etat or await asyncio.to_thread(self.etat)
        if self.comptes is not None:
            await self.annoncer_a_chacun()
            return etat
        if self.signature is None:
            # Au démarrage : rien de nouveau à dire, les pages qui s'ouvrent lisent l'état elles-mêmes.
            self.signature = etat["signature"]
        elif etat["signature"] != self.signature:
            self.signature = etat["signature"]
            try:
                await self.signaler({"type": "prives", "signature": etat["signature"]})
            except Exception:
                journal.exception("Pages de l'atelier non prévenues (billets privés)")
        return etat

    def etats_de_chacun(self) -> list:
        """[(compte, état)] : l'état de chaque MJ, lu comme il le lit (ses envois seuls)."""
        sortie = []
        for c in self.comptes():
            with cloisonnement.ecrit_pour(c["id"]):
                sortie.append((c["id"], self.etat()))
        return sortie

    async def annoncer_a_chacun(self) -> None:
        """Deux MJ : les pages de chacun prévenues si son état a changé. Au premier passage d'un compte, rien à dire : ses
        pages lisent l'état elles-mêmes en s'ouvrant."""
        for compte, vu in await asyncio.to_thread(self.etats_de_chacun):
            avant = self.signatures.get(compte)
            self.signatures[compte] = vu["signature"]
            if compte == proprietes.PRINCIPAL:
                self.signature = vu["signature"]
            if avant is None or avant == vu["signature"]:
                continue
            try:
                await self.signaler({"type": "prives", "signature": vu["signature"]}, compte)
            except Exception:
                journal.exception("Pages de l'atelier non prévenues (billets privés)")

    # ------------------------------------------------------------ les gestes du MJ

    def envoyer(self, nouveaux: list) -> tuple[list, list]:
        """Sous le verrou : chaque (clé, envoi) remplace l'envoi de même clé s'il a changé, ou s'ajoute. Rend (envoyés,
        inchangés)."""
        envoyes, inchanges = [], []
        with self.verrou:
            envois = self.lire()
            for cle, neuf in nouveaux:
                deja = next((x for x in envois if cle(x)), None)
                contenu = {k: v for k, v in neuf.items() if k not in ("id", "envoye")}
                if deja is not None and all(deja.get(k) == v for k, v in contenu.items()):
                    inchanges.append(deja)
                    continue
                if deja is not None:
                    envois.remove(deja)
                neuf = neuf | {"id": prives.nouvel_id(), "envoye": prives.maintenant()}
                if proprietes.compte_courant() != proprietes.PRINCIPAL:
                    neuf["auteur"] = proprietes.compte_courant()
                envois.append(neuf)
                envoyes.append(neuf)
            if envoyes:
                self.ecrire(envois)
        return envoyes, inchanges

    def envoyer_billet(self, seance: str, billet: str, confirme: bool) -> dict:
        s = self.lire_seance(seance)
        if not isinstance(s, dict):
            raise Refus(404, "Cette séance n'existe plus.")
        b = next((x for x in s.get("billets") or [] if isinstance(x, dict) and x.get("id") == billet), None)
        if b is None:
            raise Refus(404, "Ce billet n'est plus dans la séance : rechargez la page.")
        contenu = {"titre": prives.court(b.get("titre"), prives.TITRE_MAX), "texte": prives.court(b.get("texte"), prives.TEXTE_MAX)}
        if not contenu["texte"]:
            raise Refus(400, "Écrivez d'abord le texte du billet.")
        pour = set(b.get("pour") or [])
        rangees = [t for t in self.tablee() if isinstance(t, dict) and t.get("id") in pour]
        if not rangees:
            raise Refus(400, "Choisissez d'abord pour qui est ce billet.")
        liens = self.liens()
        joignables = [(t, *liens[t["aventurier"]]) for t in rangees if t.get("aventurier") in liens]
        papier = [prenom_de(t) for t in rangees if t.get("aventurier") not in liens]
        if not joignables:
            raise Refus(409, "Aucun de ces héros n'a de joueur relié au coin : le billet reste sur papier.")
        candidats = self.candidats()
        nouveaux, bloques = [], []
        for t, jid, a in joignables:
            neuf = {"nature": "billet", "seance": s.get("id"), "billet": billet, "tablee": t["id"], "heros": a["id"], "joueur": jid,
                    "pour": prenom_de(t, a), **contenu, "aussi": [prenom_de(x) for x in rangees if x is not t]}
            raison = self.raison_retenue(self.element(neuf | {"id": "0" * 24}), a["id"], candidats)
            if raison:
                bloques.append({"pour": neuf["pour"], "raison": raison})
                continue
            nouveaux.append(neuf)
        noms = self.inconnus({"titre": contenu["titre"], "texte": contenu["texte"]}, candidats) if nouveaux else []
        if noms and not confirme:
            return {"question": {"secrets": self.noms_secrets(noms), "pour": [n["pour"] for n in nouveaux]}}
        cle = lambda n: (lambda x: x.get("nature") == "billet" and x.get("seance") == n["seance"] and x.get("billet") == billet  # noqa: E731
                         and x.get("tablee") == n["tablee"])
        envoyes, inchanges = self.envoyer([(cle(n), n) for n in nouveaux])
        return {"envoyes": [x["pour"] for x in envoyes], "inchanges": [x["pour"] for x in inchanges], "bloques": bloques,
                "papier": papier, "tous": not bloques and not papier, "masque": self.masque_change(contenu)}

    def masque_change(self, contenu: dict) -> bool:
        """Le masque a-t-il changé ce texte (le nom caché de l'auberge) ? Le MJ le sait, comme pour le « Précédemment »."""
        return self.masquer_tout(contenu) != contenu

    def remettre_document(self, document: str, heros: str, confirme: bool) -> dict:
        d = self.lire_document(document)
        if not isinstance(d, dict):
            raise Refus(404, "Ce document n'existe plus.")
        liens = self.liens()
        if heros not in liens:
            raise Refus(409, "Ce héros n'a pas de joueur relié au coin : imprimez le document pour le lui tendre.")
        jid, a = liens[heros]
        rangee = next((t for t in self.tablee() if isinstance(t, dict) and t.get("aventurier") == heros), None)
        image = d.get("image") if self.image_source(d.get("image")) else None
        neuf = {"nature": "document", "document": d.get("id"), "heros": heros, "joueur": jid, "pour": prenom_de(rangee, a),
                "genre": docs.genre_de(d), "nom": docs.court(d.get("nom"), docs.TITRE_MAX), "texte": docs.court(d.get("texte"), docs.TEXTE_MAX),
                "signature": docs.court(d.get("signature"), docs.SIGNATURE_MAX), "image": image, "sceau": docs.sceau_de(d)}
        candidats = self.candidats()
        raison = self.raison_retenue(self.element(neuf | {"id": "0" * 24}), heros, candidats)
        if raison:
            raise Refus(409, f"Ce document ne part pas vers {neuf['pour']} : {raison}. Montrez-le autrement, ou imprimez-le.")
        noms = self.inconnus(self.element(neuf | {"id": "0" * 24}), candidats)
        if noms and not confirme:
            return {"question": {"secrets": self.noms_secrets(noms), "pour": [neuf["pour"]]}}
        cle = lambda x: x.get("nature") == "document" and x.get("document") == neuf["document"] and x.get("heros") == heros  # noqa: E731
        envoyes, inchanges = self.envoyer([(cle, neuf)])
        return {"envoyes": [x["pour"] for x in envoyes], "inchanges": [x["pour"] for x in inchanges], "bloques": [], "papier": [], "tous": True,
                "masque": self.masque_change({k: neuf[k] for k in ("nom", "texte", "signature")})}

    def retirer(self, ident: str) -> dict:
        with self.verrou:
            envois = self.lire()
            x = next((e for e in envois if e["id"] == ident), None)
            if x is None or not self.au_lecteur(x):
                raise Refus(404, "Ce billet n'est plus sur aucun téléphone.")
            self.ecrire([e for e in envois if e is not x])
        return x

    # ------------------------------------------------------------ la tâche de fond

    def garder(self, chemin: Path) -> bool:
        try:
            parties = chemin.relative_to(self.depot).parts
        except ValueError:
            return False
        return len(parties) == 2 and parties[0] == prives.LUS and not parties[1].startswith(".")

    async def passage(self) -> None:
        """Une lecture notée par le coin, ou de secours : la publication suit ses sources (seulement si l'une a bougé),
        l'état part vers les pages de l'atelier s'il a changé."""
        self.passages += 1
        sources = veille.empreinte([self.fichier, *self.sources()])
        lus = veille.empreinte((self.depot / prives.LUS).glob("*.json"))
        if sources != self.vu:
            await asyncio.to_thread(self.publier)
            self.vu = sources
        elif lus == self.vu_lus:
            return
        self.vu_lus = lus
        await self.annoncer()

    async def surveiller(self) -> None:
        """La tâche de fond du cycle de l'atelier."""
        self.vu = self.vu_lus = self.signature = None
        self.signatures = {}
        try:
            await self.passage()
        except Exception:
            journal.exception("Billets privés : premier passage impossible")
        await veille.veiller(self.depot, self.garder, self.passage, regroupement=REGROUPEMENT, secours=SECOURS, nom="Billets privés")

    # ------------------------------------------------------------ les routes

    def routes(self, corps_objet) -> APIRouter:
        """Hors de /api/table/… : la garde de main.py les ferme à la table publique, et à Internet sans session."""
        r = APIRouter()

        async def apres(resultat: dict) -> dict:
            if "question" not in resultat:
                await asyncio.to_thread(self.publier)
            return resultat | {"etat": await self.annoncer()}

        @r.get("/api/prives")
        async def etat_des_prives():
            return await asyncio.to_thread(self.etat)

        @r.post("/api/prives/billet")
        async def envoyer_un_billet(requete: Request):
            corps = await corps_objet(requete)
            seance, billet = corps.get("seance"), corps.get("billet")
            if not isinstance(seance, str) or not isinstance(billet, str):
                raise HTTPException(400, "La séance et le billet sont attendus.")
            try:
                resultat = await asyncio.to_thread(self.envoyer_billet, seance, billet, corps.get("confirme") is True)
            except Refus as refus:
                raise HTTPException(refus.statut, refus.message)
            return await apres(resultat)

        @r.post("/api/prives/document")
        async def remettre_un_document(requete: Request):
            corps = await corps_objet(requete)
            document, heros = corps.get("document"), corps.get("heros")
            if not isinstance(document, str) or not isinstance(heros, str):
                raise HTTPException(400, "Le document et le héros sont attendus.")
            try:
                resultat = await asyncio.to_thread(self.remettre_document, document, heros, corps.get("confirme") is True)
            except Refus as refus:
                raise HTTPException(refus.statut, refus.message)
            return await apres(resultat)

        @r.delete("/api/prives/{ident}")
        async def retirer_un_billet(ident: str):
            if not prives.ID.match(ident):
                raise HTTPException(404, "Introuvable")
            try:
                x = await asyncio.to_thread(self.retirer, ident)
            except Refus as refus:
                raise HTTPException(refus.statut, refus.message)
            return await apres({"retire": x["pour"]})

        return r
