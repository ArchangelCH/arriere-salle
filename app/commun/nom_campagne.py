"""Le nom de la campagne dans les pages HTML de l'atelier et du coin des joueurs : les repères {{campagne.nom}},
{{campagne.sous_titre}}, {{campagne.devise}}, {{campagne.marque}} (les lettres du logo) et {{campagne.longueur}} (son
resserrement, pour un nom long) sont remplacés au moment de servir la page, d'après commun/campagne.py. Le même logo se
dessine côté navigateur (js/aventuriers/fiche.js, d'après js/campagne/nom.js)."""

import html

from commun import campagne

# Au-delà de ce nombre de lettres, le logo se resserre pour tenir dans sa largeur (viewBox de 1000).
LETTRES_SANS_RESSERRER = 10


def marque(nom: str) -> str:
    """Les lettres du logo : en capitales, la première et la dernière plus grandes."""
    lettres = nom.upper()
    if len(lettres) < 3:
        return html.escape(lettres)
    grande = '<tspan font-size="150">{}</tspan>'
    return grande.format(html.escape(lettres[0])) + html.escape(lettres[1:-1]) + grande.format(html.escape(lettres[-1]))


def longueur(nom: str) -> str:
    return ' textLength="900" lengthAdjust="spacingAndGlyphs"' if len(nom) > LETTRES_SANS_RESSERRER else ""


def nommer(texte: str) -> str:
    if "{{campagne." not in texte:
        return texte
    reperes = {"nom": html.escape(campagne.NOM), "sous_titre": html.escape(campagne.SOUS_TITRE),
               "devise": html.escape(campagne.DEVISE), "marque": marque(campagne.NOM), "longueur": longueur(campagne.NOM)}
    for cle, valeur in reperes.items():
        texte = texte.replace("{{campagne." + cle + "}}", valeur)
    return texte
