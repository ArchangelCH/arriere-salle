"""Les couleurs des héros telles que la TV les montre : chacun la sienne, et visible sur un plan sombre.

Sur la TV, la couleur d'un héros est le repère de son joueur : l'anneau de son pion, sa case du bandeau du combat, sa
ligne de la légende. Deux défauts la rendent inutile : un bleu nuit qui se perd sur un plan sombre, et deux héros de la
même couleur. La TV reçoit donc une couleur éclaircie juste assez quand elle est trop sombre et, pour un héros arrivé
après un autre de couleur presque pareille, la première couleur libre d'une palette. L'atelier et le carnet gardent la
couleur choisie. Fonctions pures : main.py les applique à ce que reçoit la TV.
"""
import colorsys
import re

COULEUR = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
# Au-dessous de cette luminance, une couleur se perd sur un plan sombre (le bleu nuit #01006e en est à 0,01).
LUMINANCE_MIN = 0.06
# Deux couleurs plus proches que cela se confondent sur la TV (écart « redmean », de 0 à 765).
ECART_MIN = 72
# Pour un héros de même couleur qu'un autre : des teintes franches, lisibles sur un plan sombre comme sur le parchemin.
PALETTE = ("#d9a21b", "#2e86de", "#e67e22", "#16a085", "#c2185b", "#7cb342", "#8e44ad", "#00acc1", "#c0392b", "#5c6bc0")


def rvb(couleur: str) -> tuple[int, int, int] | None:
    m = COULEUR.match(couleur or "") if isinstance(couleur, str) else None
    if not m:
        return None
    h = m.group(1)
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def hexa(r: float, v: float, b: float) -> str:
    return "#" + "".join(f"{max(0, min(255, round(x))):02x}" for x in (r, v, b))


def luminance(c: tuple[int, int, int]) -> float:
    def lin(x: int) -> float:
        x = x / 255
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    r, v, b = (lin(x) for x in c)
    return 0.2126 * r + 0.7152 * v + 0.0722 * b


def ecart(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    rm = (a[0] + b[0]) / 2
    dr, dv, db = a[0] - b[0], a[1] - b[1], a[2] - b[2]
    return ((2 + rm / 256) * dr * dr + 4 * dv * dv + (2 + (255 - rm) / 256) * db * db) ** 0.5


def lisible(couleur: str) -> str:
    """La couleur, éclaircie juste assez (même teinte) pour se voir sur un plan sombre ; telle quelle si elle s'y voit
    déjà ; "" si elle est illisible."""
    c = rvb(couleur)
    if not c:
        return ""
    if luminance(c) >= LUMINANCE_MIN:
        return couleur.lower() if len(couleur) == 7 else hexa(*c)
    h, l, s = colorsys.rgb_to_hls(*(x / 255 for x in c))
    s = min(s, 0.8)  # un bleu nuit devient un bleu roi, pas un bleu électrique
    while l < 0.62:
        l += 0.02
        c2 = tuple(x * 255 for x in colorsys.hls_to_rgb(h, l, s))
        if luminance(tuple(round(x) for x in c2)) >= LUMINANCE_MIN:
            return hexa(*c2)
    return hexa(*(x * 255 for x in colorsys.hls_to_rgb(h, l, s)))


def distinctes(heros: list[dict]) -> dict[str, str]:
    """Pour chaque héros (dans l'ordre de leur arrivée à la tablée : le premier garde sa couleur), la couleur que montre la
    TV. Un héros sans couleur n'y figure pas : la TV prend la sienne par défaut."""
    choisies = [rvb(texte) for texte in (h.get("couleur") for h in heros) if rvb(texte)]
    prises: list[tuple[int, int, int]] = []
    sortie: dict[str, str] = {}
    for h in heros:
        ident, couleur = h.get("id"), lisible(h.get("couleur") or "")
        if not isinstance(ident, str) or not couleur:
            continue
        c = rvb(couleur)
        if any(ecart(c, p) < ECART_MIN for p in prises):
            # Une couleur libre : loin de celles déjà données, et de celles que d'autres héros ont choisies.
            libre = next((x for x in PALETTE if all(ecart(rvb(x), p) >= ECART_MIN for p in prises + choisies)), None)
            libre = libre or next((x for x in PALETTE if all(ecart(rvb(x), p) >= ECART_MIN for p in prises)), couleur)
            couleur, c = libre, rvb(libre)
        prises.append(c)
        sortie[ident] = couleur
    return sortie


def pour_un_nouveau(avant: list[dict], couleur: str, apres: list[dict] = ()) -> dict | None:
    """Ce que la TV fera de la couleur d'un héros qui arrive à la tablée, après ceux d'avant (dans leur ordre) et avant
    ceux d'après (les héros hors de la tablée) : {"tv": la couleur qu'elle montrera, "pourquoi": "prise" (trop proche de
    celle d'un autre) ou "sombre" (éclaircie pour se voir sur un plan sombre), "comme": l'identifiant de l'autre héros,
    ou ""}. None si la TV la montre telle quelle, ou ne la lit pas (elle prend alors sa couleur par défaut)."""
    c, lue = rvb(couleur or ""), lisible(couleur or "")
    if not c or not lue:
        return None
    nouveau = "\0nouveau"
    tv = distinctes([*avant, {"id": nouveau, "couleur": couleur}, *apres])
    montree = tv.get(nouveau) or lue
    if montree != lue:
        proches = [(ecart(rvb(tv[h["id"]]), rvb(lue)), h["id"]) for h in avant if tv.get(h.get("id"))]
        proches = [x for x in proches if x[0] < ECART_MIN]
        return {"tv": montree, "pourquoi": "prise", "comme": min(proches)[1] if proches else ""}
    if lue != hexa(*c):
        return {"tv": montree, "pourquoi": "sombre", "comme": ""}
    return None
