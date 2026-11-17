"""Le lore du personnage dans l'atelier : ce que la boîte du MJ fait d'une histoire envoyée depuis le coin
(lore.py).

- La boîte l'ouvre sur une comparaison (GET /api/lore/{joueur}/{id}) : pour chaque passage, le texte de la fiche
  aujourd'hui, celui que le joueur lisait, celui qu'il propose. Si la fiche a changé depuis ce qu'il lisait, ou si le
  carnet garde ce passage (il ne l'a donc jamais lu), la comparaison le dit, et accepter demande de le confirmer
  (« ecraser ») : rien ne s'écrase à l'aveugle.
- Le MJ tranche passage par passage (POST …/trancher) : accepté, retouché (son texte à la place de celui du joueur) ou
  refusé, d'un seul geste et sous le verrou de la file, avec la version lue par son écran et l'empreinte du texte de la
  fiche qu'il avait sous les yeux. La fiche est écrite (avec son historique), puis « Mon héros » est republié ; le flux du
  coin le pousse au joueur (sujet « carnet »).
- Le texte accepté passe ensuite par le masque et par retenir comme tout le reste : un passage qui nomme un inconnu entre
  dans la fiche, mais reste hors du carnet et de la TV (la comparaison prévient le MJ avant qu'il accepte).

Ce module ne connaît de l'atelier que les fonctions que main.py lui passe.
"""
import asyncio
import hashlib
import hmac
import logging
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, HTTPException, Request

from mj import cloisonnement
from commun import demandes
from commun import inventaire
from commun import lore
from commun.demandes import Refus
from table.masque import contient_nom_cache, masquer, secrets_dans

# Ce que la ligne de la boîte dit de chaque passage.
COURTS = {"histoire": "l'histoire", "avant": "son passé", "pourquoi": "ce qui l'a poussé{|e} à partir",
          "jamais": "ce qu'{il|elle} ne fera jamais", "allure": "l'allure", "defaut": "le défaut", "lien": "le lien",
          "contacts": "les contacts", "particularites": "les particularités"}
journal = logging.getLogger("atelier.lore")
CHANGEE = "La fiche a changé pendant votre lecture : la comparaison se relit."


def empreinte(texte: str) -> str:
    return hashlib.sha256((texte or "").encode()).hexdigest()[:24]


def texte(v) -> str:
    if v is None:
        return ""
    if isinstance(v, list):
        return "\n".join(texte(x) for x in v)
    return v if isinstance(v, str) else str(v)


def en_liste(mots: list) -> str:
    return mots[0] if len(mots) == 1 else f"{', '.join(mots[:-1])} et {mots[-1]}"


def pl(n: int) -> str:
    return "s" if n > 1 else ""


def resultat(issue: dict) -> str:
    """La phrase que lit le joueur : « 2 passages acceptés, dont 1 retouché par votre MJ ; 1 refusé. » Rien du texte."""
    acceptes = sum(1 for v in issue.values() if v in ("acceptee", "retouchee"))
    retouches = sum(1 for v in issue.values() if v == "retouchee")
    refuses = sum(1 for v in issue.values() if v == "refusee")
    morceaux = []
    if acceptes:
        morceaux.append(f"{acceptes} passage{pl(acceptes)} accepté{pl(acceptes)}"
                        + (f", dont {retouches} retouché{pl(retouches)} par votre MJ" if retouches else ""))
    if refuses:
        morceaux.append(f"{refuses} refusé{pl(refuses)}" if acceptes else f"{refuses} passage{pl(refuses)} refusé{pl(refuses)}")
    return " ; ".join(morceaux) + "." if morceaux else ""


class LoreMJ:
    def __init__(self, depot: Path, *, heros_du_joueur: Callable[[str], dict | None], ref: Callable[[str], str],
                 projection: Callable[[dict, list], dict], candidats: Callable[[], list],
                 ecrire_recit: Callable[[str, dict], dict], publier: Callable[[set], object]):
        self.depot = depot
        self.heros_du_joueur = heros_du_joueur
        self.ref = ref
        self.projection = projection
        self.candidats = candidats
        self.ecrire_recit = ecrire_recit
        self.publier = publier
        self.boite = None

    def brancher(self, boite) -> None:
        self.boite = boite
        boite.brancher(lore.GENRE, accepter=self.accepter_d_un_bloc, dire=self.dire)

    @staticmethod
    def accepter_d_un_bloc(_j: dict, _d: dict, _mot: str):
        # Le bouton commun de la boîte n'accepte pas une histoire : elle se lit et se tranche passage par passage.
        raise Refus(400, "Une histoire se tranche passage par passage : ouvrez la comparaison.")

    # ------------------------------------------------------------ lectures

    def heros_de(self, joueur: str, corps: dict) -> tuple[dict | None, bool]:
        """Le héros du joueur, et s'il est bien celui pour qui l'histoire a été écrite (le jeton de la compagnie)."""
        a = self.heros_du_joueur(joueur)
        return a, bool(a) and hmac.compare_digest(self.ref(a["id"]), str(corps.get("ref") or ""))

    @staticmethod
    def inconnus(a: dict | None, cle: str, candidats: list) -> list:
        """Ce qu'un passage ne doit pas nommer pour sortir : comme retenir_recit (son propre peuple caché n'est pas un
        secret pour son joueur) ; l'allure, montrée à toute la tablée par la TV, pas même celui-là."""
        aid = (a or {}).get("id")
        if cle == "allure":
            return candidats
        return [(s, f) for s, f in candidats if s.get("genre") in ("pnj", "lieu") or (s.get("genre") == "peuple" and aid not in s.get("ids", []))]

    def demande(self, joueur: str, ident: str) -> tuple[dict, list, dict]:
        j = self.boite.joueur(joueur)
        liste = demandes.lire(self.depot, joueur)
        d = demandes.trouver(liste, ident)
        if d is None or d.get("genre") != lore.GENRE:
            raise Refus(404, "Cette histoire n'existe plus.")
        return j, liste, d

    def comparaison(self, joueur: str, ident: str) -> dict:
        """Ce que le MJ lit avant de trancher : passage par passage, la fiche d'aujourd'hui (secrets compris : c'est
        l'atelier), ce que le joueur lisait, ce qu'il propose, et ce qui ferait tiquer (fiche changée, passage gardé,
        un inconnu nommé, le nom caché de l'auberge)."""
        j, _, d = self.demande(joueur, ident)
        try:
            corps = lore.valider_lore(d["corps"])
        except Refus as refus:
            raise Refus(409, f"Cette histoire est illisible : {refus.message} Refusez-la.")
        a, sien = self.heros_de(joueur, corps)
        candidats = self.candidats()
        proj = self.projection(a, candidats) if a else {"champs": {}, "tenus": []}
        genre = (a or {}).get("genre")
        champs = []
        for cle, v in corps["champs"].items():
            actuel = texte((a or {}).get(cle))
            tenu = cle in proj["tenus"]
            nommes = secrets_dans(masquer(v["apres"]), self.inconnus(a, cle, candidats))
            champs.append({"cle": cle, "nom": lore.nom(cle, genre, mj=True), "actuel": actuel, "empreinte": empreinte(actuel),
                           "vu": v["avant"], "propose": v["apres"], "tenu": tenu,
                           "change_depuis": tenu or proj["champs"].get(cle, "") != v["avant"],
                           "secrets": [{"nom": s.get("nom", ""), "genre": s.get("genre", "")} for s in cloisonnement.secrets_vus(nommes)],
                           "auberge": contient_nom_cache(v["apres"])})
        return {"id": d["id"], "version": d["version"], "statut": d["statut"], "statut_dit": demandes.statut_dit(d),
                "cree": d.get("cree"), "traitee": d.get("traitee"), "mot": d.get("mot") or "",
                "issue": d.get("issue") if isinstance(d.get("issue"), dict) else {},
                "joueur": {"id": j["id"], "nom": j.get("nom", "")},
                "heros": {"id": a["id"], "nom": texte(a.get("nom")), "genre": genre if genre in ("h", "f") else ""} if a else None,
                "sien": sien, "champs": champs, "mot_max": demandes.MOT_MAX, "long": lore.LONG}

    # ------------------------------------------------------------ trancher

    def trancher(self, joueur: str, ident: str, corps: dict) -> tuple[dict, str | None]:
        """{version, mot, champs: {cle: {decision: accepter|refuser, texte (retouché), empreinte, ecraser}}} : un choix
        pour chaque passage, appliqué d'un bloc. Rend l'élément de la boîte et le héros dont la fiche a changé."""
        version = corps.get("version")
        if isinstance(version, bool) or not isinstance(version, int):
            raise Refus(400, "La version de la demande manque : relisez la boîte.")
        mot = corps.get("mot") or ""
        if not isinstance(mot, str):
            raise Refus(400, "Le mot doit être un texte.")
        mot = self.boite.nettoyer_mot(mot) if mot.strip() else ""
        choix = corps.get("champs")
        if not isinstance(choix, dict):
            raise Refus(400, "Un choix est attendu pour chaque passage.")
        with demandes.verrou(self.depot):
            j, liste, d = self.demande(joueur, ident)
            demandes.verifier(d, demandes.ACCEPTEE, "mj", version=version)
            propre = lore.valider_lore(d["corps"])
            manquent = [lore.nom(k, mj=True) for k in propre["champs"] if k not in choix]
            if manquent or set(choix) - set(propre["champs"]):
                raise Refus(400, f"Un choix est attendu pour chaque passage{' : ' + en_liste(manquent) if manquent else ''}.")
            a, sien = self.heros_de(joueur, propre)
            proj = self.projection(a, self.candidats()) if a else {"champs": {}, "tenus": []}
            acceptes, issue = {}, {}
            for cle, v in propre["champs"].items():
                x = choix[cle] if isinstance(choix[cle], dict) else {}
                nom = lore.nom(cle, (a or {}).get("genre"), mj=True)
                if x.get("decision") == "refuser":
                    issue[cle] = "refusee"
                    continue
                if x.get("decision") != "accepter":
                    raise Refus(400, f"« {nom} » : accepter ou refuser.")
                if not sien:
                    raise Refus(409, "Ce joueur n'a plus le héros pour qui il a écrit cette histoire : refusez-la.")
                neuf = v["apres"] if x.get("texte") is None else lore.propre(x["texte"], f"« {nom} »")
                if x.get("empreinte") != empreinte(texte(a.get(cle))):
                    raise Refus(409, CHANGEE)
                if (cle in proj["tenus"] or proj["champs"].get(cle, "") != v["avant"]) and x.get("ecraser") is not True:
                    raise Refus(409, f"« {nom} » a changé sur la fiche depuis que le joueur l'a lu : retouchez-le, ou "
                                     "confirmez que son texte remplace le vôtre.")
                acceptes[cle] = (x["empreinte"], neuf)
                issue[cle] = "retouchee" if neuf != v["apres"] else "acceptee"
            statut = demandes.ACCEPTEE if acceptes else demandes.REFUSEE
            demandes.verifier(d, statut, "mj", version=version)
            if acceptes:
                self.ecrire_recit(a["id"], acceptes)
            d["issue"] = issue
            demandes.passer(d, statut, "mj", version=version, mot=mot, resultat=resultat(issue))
            demandes.ecrire(self.depot, joueur, liste)
        return self.boite.element_demande(j, d), (a["id"] if acceptes else None)

    # ------------------------------------------------------------ la boîte

    def dire(self, j: dict, d: dict) -> str:
        """« Camille propose 3 passages pour Aldo : l'histoire, l'allure et les contacts. » ; traitée, ce qu'il en est."""
        champs = list(((d.get("corps") or {}).get("champs") or {}))
        a = self.heros_du_joueur(j.get("id", ""))
        pour = f" pour {inventaire.prenom(a.get('nom'))}" if a else ""
        qui = j.get("nom") or "Le joueur"
        if d.get("statut") in (demandes.ACCEPTEE, demandes.REFUSEE) and d.get("resultat"):
            return f"Histoire de {qui}{pour} : {d['resultat'][:1].lower()}{d['resultat'][1:]}"
        genre = (a or {}).get("genre")
        noms = [lore.accord(COURTS[k], genre) for k in lore.CHAMPS if k in champs]
        if not noms:
            return ""
        return f"{qui} propose {len(noms)} passage{pl(len(noms))}{pour} : {en_liste(noms)}."

    def routes(self) -> APIRouter:
        """Hors de /api/table/… : la garde de main.py les ferme à la table publique, et à Internet sans session."""
        r = APIRouter()

        @r.get("/api/lore/{joueur}/{ident}")
        async def lire_comparaison(joueur: str, ident: str):
            try:
                return await asyncio.to_thread(self.comparaison, joueur, ident)
            except Refus as refus:
                raise HTTPException(refus.statut, refus.message)

        @r.post("/api/lore/{joueur}/{ident}/trancher")
        async def trancher_histoire(joueur: str, ident: str, requete: Request):
            try:
                corps = await requete.json()
            except ValueError:
                raise HTTPException(400, "Corps de requête illisible (JSON attendu)")
            if not isinstance(corps, dict):
                raise HTTPException(400, "Corps de requête invalide (objet JSON attendu)")
            try:
                element, heros = await asyncio.to_thread(self.trancher, joueur, ident, corps)
            except Refus as refus:
                raise HTTPException(refus.statut, refus.message)
            if heros:
                # « Mon héros » tout de suite (une publication manquée se rattrape au passage suivant du carnet).
                try:
                    await asyncio.to_thread(self.publier, {heros})
                except Exception:
                    journal.exception("« Mon héros » non republié après une histoire acceptée")
            await self.boite.annoncer()
            return element

        return r
