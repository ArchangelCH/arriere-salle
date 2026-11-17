"""L'état de son héros réglé par le joueur, dans l'atelier (etat_joueur.py, 11/11) : la boîte applique seule chaque geste
« etat-heros » (Santé, Psy, posture), sous le verrou de la file et dans la boucle d'événements, comme les autres écritures
de l'état des héros.

Ce module ne connaît de l'atelier que les fonctions qu'on lui passe :
  - changer(id du héros, corps) : écrit le geste là où vit l'état (le combat en cours si le héros s'y bat, sinon l'état des
    héros, et sa fiche pour la posture) et rend {vitalite, posture, combat, avant, apres} ; il lève Refus s'il ne peut pas ;
  - suites() : hors du verrou, la TV, l'écran du combat et la table du coin relisent ;
  - dire(message) : une ligne aux pages de l'atelier (« Camille : Santé d'Aldo 9 → 7 »), jamais à la TV.
Chaque geste appliqué est noté dans data/journal-etats.jsonl (qui, quel héros, avant, après, en combat ou non).
"""
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Awaitable, Callable

from commun import demandes
from commun import etat_joueur as ej
from commun.demandes import Refus

journal = logging.getLogger("atelier.etat-joueur")

FICHIER_JOURNAL = "journal-etats.jsonl"
JOURNAL_OCTETS_MAX = 2_000_000  # au-delà, le journal repart d'un fichier neuf (l'ancien garde le suffixe .1)


class EtatJoueurMJ:
    def __init__(self, donnees: Path, *, heros_des_joueurs: Callable[[], dict], table_ouverte: Callable[[], bool],
                 changer: Callable[[str, dict], dict], suites: Callable[[], Awaitable[None]] | None = None,
                 dire: Callable[[dict], Awaitable[None]] | None = None, nom_public: Callable[[dict], str] = lambda a: str(a.get("nom") or "")):
        self.fichier = donnees / FICHIER_JOURNAL
        self.heros_des_joueurs = heros_des_joueurs
        self.table_ouverte = table_ouverte
        self.changer = changer
        self.suites = suites
        self.dire = dire
        self.nom_public = nom_public
        self.a_dire: list[dict] = []  # posé par appliquer (sous le verrou), dit par apres

    def brancher(self, boite) -> None:
        boite.brancher(ej.GENRE, appliquer=self.appliquer, apres=self.apres)

    def noter(self, ligne: dict) -> None:
        try:
            self.fichier.parent.mkdir(parents=True, exist_ok=True)
            if self.fichier.exists() and self.fichier.stat().st_size > JOURNAL_OCTETS_MAX:
                self.fichier.replace(self.fichier.with_suffix(".jsonl.1"))
            with self.fichier.open("a", encoding="utf-8") as f:
                f.write(json.dumps(ligne, ensure_ascii=False) + "\n")
        except OSError:
            journal.exception("Journal des états non écrit")

    def appliquer(self, j: dict, d: dict) -> str:
        age = ej.age(d, datetime.now())
        if age is None or age >= ej.EN_ROUTE:
            raise Refus(409, ej.TROP_TARD)
        if not self.table_ouverte():
            raise Refus(409, ej.FERMEE)
        a = self.heros_des_joueurs().get(j["id"])
        if not a:
            raise Refus(409, ej.ABSENT)
        corps = d["corps"]
        r = self.changer(a["id"], corps)
        d["public"] = {"vitalite": r["vitalite"], "posture": r["posture"], "combat": bool(r.get("combat"))}
        quoi = "posture" if "posture" in corps else corps["champ"]
        self.noter({"quand": datetime.now().isoformat(timespec="seconds"), "joueur": j["id"], "heros": a["id"], "demande": d["id"],
                    "quoi": quoi, "avant": r["avant"], "apres": r["apres"], "combat": bool(r.get("combat"))})
        if "posture" in corps:
            phrase = f"Posture : {ej.POSTURES[r['apres']].lower()}."
        else:
            maximum = r["vitalite"]["sante_max" if quoi == "sante" else "psy_max"]
            phrase = f"{ej.CHAMPS[quoi]} : {r['avant']} → {r['apres']} (sur {maximum})."
        if r["avant"] != r["apres"]:
            self.a_dire.append({"type": "etat-joueur", "joueur": str(j.get("nom") or ""), "heros": self.nom_public(a), "heros_id": a["id"],
                                "quoi": quoi, "avant": r["avant"], "apres": r["apres"], "combat": bool(r.get("combat"))})
        return phrase

    async def apres(self, liste: list) -> None:
        """Hors du verrou : ce qui montre l'état des héros relit, puis les pages de l'atelier lisent la ligne du geste."""
        messages, self.a_dire = self.a_dire, []
        if any(d.get("statut") == demandes.APPLIQUEE for _j, d in liste) and self.suites:
            try:
                await self.suites()
            except Exception:
                journal.exception("État d'un héros changé par son joueur : écrans non prévenus")
        if self.dire:
            for m in messages:
                try:
                    await self.dire(m)
                except Exception:
                    journal.exception("État d'un héros changé par son joueur : atelier non prévenu")
