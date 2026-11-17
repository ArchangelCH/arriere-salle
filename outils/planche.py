#!/usr/bin/env python3
"""Planche de chêne de la Petite Fanfrelée (fond de l'écran des contrats) : planches verticales, fil du bois, nœuds, clous.

Pur PIL, comme le parchemin du kit. Usage : python3 outils/planche.py  (écrit app/static/img/planche-chene.jpg)
"""
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

SORTIE = Path(__file__).resolve().parent.parent / "app" / "static" / "img" / "planche-chene.jpg"
L, H = 2400, 1350
FONCE, CLAIR = (38, 24, 14), (118, 82, 48)


def fil_du_bois(largeur, hauteur, graine):
    """Stries verticales : un bruit très étiré dans le sens des fibres, à plusieurs échelles."""
    random.seed(graine)
    acc = Image.new("L", (largeur, hauteur), 128)
    total = 0.0
    for i, (w, h, poids) in enumerate(((largeur // 3, 6, 1.0), (largeur // 2, 14, .7), (largeur, 40, .45), (largeur // 6, 3, .8))):
        n = Image.effect_noise((max(2, w), h), 70 + 10 * i).resize((largeur, hauteur), Image.BICUBIC)
        acc = Image.blend(acc, n, poids / (total + poids))
        total += poids
    return ImageOps.autocontrast(acc, cutoff=2)


def noeud(dessin, cx, cy, rx, ry):
    for k in range(9, 0, -1):
        f = k / 9
        teinte = int(18 + 30 * f)
        dessin.ellipse((cx - rx * f, cy - ry * f, cx + rx * f, cy + ry * f), outline=teinte, width=2)
    dessin.ellipse((cx - rx * .25, cy - ry * .25, cx + rx * .25, cy + ry * .25), fill=14)


def planche():
    random.seed(7)
    fond = Image.new("RGB", (L, H))
    x = 0
    bords = []
    while x < L:
        w = random.randint(250, 330)
        grain = fil_du_bois(w, H, random.randint(1, 10_000))
        calque = Image.new("L", (w, H), 0)
        d = ImageDraw.Draw(calque)
        for _ in range(random.randint(0, 2)):
            cx, cy = random.randint(40, w - 40), random.randint(80, H - 80)
            noeud(d, cx, cy, random.randint(14, 26), random.randint(26, 50))
        calque = calque.filter(ImageFilter.GaussianBlur(1.2))
        grain = ImageChops.subtract(grain, calque.point(lambda p: p * 2))
        teinte = random.uniform(.82, 1.08)
        bois = ImageOps.colorize(grain, black=FONCE, white=tuple(min(255, int(c * teinte)) for c in CLAIR))
        fond.paste(bois, (x, 0))
        bords.append(x)
        x += w
    d = ImageDraw.Draw(fond)
    for b in bords[1:]:
        d.rectangle((b - 3, 0, b + 2, H), fill=(14, 9, 5))
        d.line((b + 3, 0, b + 3, H), fill=(92, 64, 38), width=1)
    # Deux traverses clouées, en haut et en bas
    for y in (90, H - 120):
        d.rectangle((0, y, L, y + 34), fill=(52, 34, 20))
        d.line((0, y, L, y), fill=(98, 70, 42), width=2)
        d.line((0, y + 34, L, y + 34), fill=(12, 8, 4), width=3)
        for b in bords:
            cx = b + 40
            d.ellipse((cx - 7, y + 10, cx + 7, y + 24), fill=(30, 30, 32), outline=(90, 88, 84))
    fond = fond.filter(ImageFilter.GaussianBlur(.5))
    # Vignettage : la planche est dans un coin sombre de l'auberge, près de la porte
    masque = Image.new("L", (L // 8, H // 8), 0)
    ImageDraw.Draw(masque).rounded_rectangle((12, 10, L // 8 - 12, H // 8 - 10), 40, fill=255)
    masque = ImageOps.invert(masque.filter(ImageFilter.GaussianBlur(22))).resize((L, H), Image.BICUBIC)
    fond = Image.composite(Image.new("RGB", (L, H), (8, 5, 3)), fond, masque.point(lambda p: int(p * .75)))
    fond.save(SORTIE, quality=82, optimize=True, progressive=True)
    print("écrit", SORTIE, SORTIE.stat().st_size // 1024, "Ko")


if __name__ == "__main__":
    planche()
