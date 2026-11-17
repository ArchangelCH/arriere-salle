"""Corbeille, recherche, liens des fiches et confort, branchés sur les collections."""

from pathlib import Path

from mj import cloisonnement
from commun import confie
from commun import confort
from contenu import corbeille
from contenu import documents
from contenu import liens_fiches
from contenu import recherche

from api.application import app
from api import config, utilitaires, joueurs_mj, campagne_api


# La corbeille et les versions (corbeille.py) : remettre une fiche jetée ou revenir à une version gardée, pour chaque
# collection qui a son « Mettre à la corbeille ». Les champs tenus par leurs routes restent ceux du disque.
app.include_router(corbeille.routes({
    "cartes": (config.CARTES, (), None), "lieux": (config.LIEUX, (), None), "pnj": (config.PNJ, (), None), "plans": (config.PLANS, (), None),
    "scenarios": (config.SCENARIOS, ("reponses", "relectures"), None), "seances": (config.SEANCES, ("journal", "combat"), None),
    "fils": (config.FILS, (), None), "rencontres": (config.RENCONTRES, (), None), "boutiques": (config.BOUTIQUES, (), None),
    "contrats": (config.CONTRATS, (), None), "rumeurs": (config.RUMEURS, (), None), "aventuriers": (config.AVENTURIERS, (confie.CHAMP,), None),
    "idees": (config.IDEES, (), None), "regles-maison": (campagne_api.REGLES, (), campagne_api.publier_regles),
    "documents": (config.DOCUMENTS, tuple(documents.PROTEGES), None),
}, config.CORBEILLE, config.HISTORIQUE, config.SEANCES, lire=utilitaires.lire, ecrire=utilitaires.ecrire, maintenant=utilitaires.maintenant, nouvel_id=utilitaires.nouvel_id,
    corps_objet=utilitaires.corps_objet, verrou=lambda nom: campagne_api.verrou_de_collection(nom)))

# « Chercher » dans l'en-tête (recherche.py) : les textes de chaque collection, lus d'un coup ; fermé à la table publique.
# Chaque MJ n'y trouve que ses fiches et celles qu'on lui partage (lire_tout), et un invité la tablée sans ses secrets.
def lire_pour_la_recherche(dossier: Path) -> list:
    fiches = utilitaires.lire_tout(dossier, lecture=True)
    if dossier == config.AVENTURIERS and cloisonnement.est_invite() and cloisonnement.refuse("fiche-commune-entiere", "aventuriers"):
        return [tv_fiches.heros_pour_l_invite(a) for a in fiches]
    if dossier == campagne_api.REGLES:
        return campagne_api.regles_vues(fiches)
    return fiches


app.include_router(recherche.routes({
    "pnj": config.PNJ, "lieux": config.LIEUX, "plans": config.PLANS, "rencontres": config.RENCONTRES, "cartes": config.CARTES, "boutiques": config.BOUTIQUES,
    "aventuriers": config.AVENTURIERS, "contrats": config.CONTRATS, "rumeurs": config.RUMEURS, "seances": config.SEANCES, "regles": campagne_api.REGLES,
    "idees": config.IDEES, "scenarios": config.SCENARIOS, "documents": config.DOCUMENTS,
}, lire_tout=lire_pour_la_recherche))
# Les liens vers une fiche (liens_fiches.py) : les passages des scénarios qui citent un PNJ ou un lieu, et l'identifiant
# d'une fiche, qui suit son nom tant que rien ne la cite.
app.include_router(liens_fiches.routes(
    {"pnj": config.PNJ, "lieux": config.LIEUX, "plans": config.PLANS, "rencontres": config.RENCONTRES, "cartes": config.CARTES}, config.DONNEES, config.HISTORIQUE, config.SCENARIOS,
    lire_tout=utilitaires.lire_tout, lire_fiche=utilitaires.lire_fiche, existant=utilitaires.existant, ecrire=utilitaires.ecrire, slug=utilitaires.slug, nouvel_id=utilitaires.nouvel_id,
    maintenant=utilitaires.maintenant))
# Le confort de la table (confort.py) : les lignes et les voiles de la tablée, sans nom sauf accord, et la carte X à
# imprimer ; fermés à la table publique, inconnus du coin des joueurs.
app.include_router(confort.routes(config.PROPOSITIONS, config.DONNEES / "confort.json", config.ICI / "static" / "carte-x.html",
                                  joueurs_lus=joueurs_mj.joueurs_lus, corps_objet=utilitaires.corps_objet, lire_json=utilitaires.lire, ecrire_json=utilitaires.ecrire))


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import tv_fiches  # noqa: E402
