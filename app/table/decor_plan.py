"""Ce que la TV et le coin des joueurs reçoivent du décor d'un plan, en plus de ce qu'ils recevaient déjà (main.py,
plan_public) : la teinte d'un meuble (tapis, tenture…), la teinte du sol et la matière des murs d'une pièce, la lumière du
plan. Rien d'autre qu'une couleur #rrggbb ou un mot d'une liste fermée ne passe, et rien n'est ajouté quand le MJ n'a rien
réglé : la projection d'un plan d'avant ne change pas d'un octet.

Mêmes listes que static/js/plan/modele.js (MURS, LUMIERES, teinteValide), vérifiées par les tests.
"""
import re

TEINTE = re.compile(r"^#[0-9a-fA-F]{6}$")
MURS = ("pierre", "torchis", "bois", "roche", "palissade")
LUMIERES = ("jour", "crepuscule", "nuit", "torches")


def teinte(v) -> str | None:
    return v.lower() if isinstance(v, str) and TEINTE.match(v) else None


def extras_objet(o: dict) -> dict:
    t = teinte(o.get("teinte"))
    return {"teinte": t} if t else {}


def extras_piece(x: dict) -> dict:
    res = {}
    t = teinte(x.get("teinte"))
    if t:
        res["teinte"] = t
    if x.get("mur") in MURS:
        res["mur"] = x["mur"]
    return res


def extras_plan(p: dict) -> dict:
    return {"lumiere": p["lumiere"]} if p.get("lumiere") in LUMIERES else {}
