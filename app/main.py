"""L'atelier du MJ (L'Arrière-salle) : point d'entrée. Les routes et leur logique sont dans api/ ; ce fichier les charge
dans l'ordre, et expose l'application (uvicorn main:app)."""

from api import (
    config,
    application,
    portier,
    utilitaires,
    pages,
    cartes_api,
    tv_ecran,
    fiches_api,
    seances_api,
    heros_etat,
    scenarios_api,
    joueurs_mj,
    carnet_api,
    commandes_api,
    campagne_api,
    contenus_mj,
    noms_caches,
    illustrations_api,
    bible_api,
    tv_cartes,
    tv_fiches,
    tv_plans,
    tv_medias,
    tv_boutique_combat,
    refuge,
    tv_etat,
    pilotage,
    actions_coin,
    tv_temps_reel,
    contexte_du_modele,
    ia_api,
    squelettes_api,
)  # noqa: F401

app = application.app
