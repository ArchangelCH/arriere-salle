"""L'application FastAPI de l'atelier, son cycle de vie et ses fichiers servis."""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from ia.illustrations import Atelier
from mj import cloisonnement
from mj import comptes_mj
from ia import redaction

from api import config, medias_legers


# Les fiches qui ont des illustrations : les lieux, les PNJ et les aventuriers.
DOSSIERS = {"lieu": config.LIEUX, "pnj": config.PNJ, "aventurier": config.AVENTURIERS}


def ajouter_illustration(cible: str, ident: str, illustration: dict) -> dict:
    # Une illustration ne change pas la version de la fiche : l'écran qui la remplit ne doit pas tomber en conflit
    # parce qu'un portrait vient d'arriver (la PUT garde de toute façon les illustrations du serveur).
    # Sous le verrou des fiches illustrées (routes_fiches) : la file des portraits peints écrit d'un autre fil.
    with heros_etat.SAC_VERROU:
        chemin = utilitaires.existant(DOSSIERS[cible], ident)
        fiche = utilitaires.lire(chemin)
        illustration.setdefault("cree", utilitaires.maintenant())
        fiche.setdefault("illustrations", []).append(illustration)
        if not fiche.get("illustration"):
            fiche["illustration"] = illustration["url"]
        utilitaires.ecrire(chemin, fiche)
    return fiche


atelier = Atelier(config.IMAGES, ajouter_illustration, config.DONNEES / "file-illustrations.json")


@asynccontextmanager
async def cycle(_app):
    # Les tâches du cycle lisent pour le serveur lui-même (cloisonnement.py) : elles en héritent à leur création.
    cloisonnement.poser_lecteur(cloisonnement.FOND)
    atelier.demarrer()
    # Les comptes des MJ (comptes_mj.py) : au premier démarrage, le compte principal naît de ATELIER_MDP_EMPREINTE ; un
    # principal écrit sous un autre identifiant que ATELIER_MJ_PRINCIPAL arrête l'atelier.
    comptes_mj.verifier_principal(config.DONNEES)
    portier.comptes_mj_lus()
    # Les relectures demandées en différé sont relevées toutes les cinq minutes (deposer_lot, plus bas).
    surveillance = asyncio.create_task(redaction.surveiller_lots(ia_api.deposer_lot))
    # Le carnet des joueurs se tient à jour seul (surveiller_carnet, avec le coin des joueurs).
    publication = asyncio.create_task(carnet_api.surveiller_carnet())
    # La bible des joueurs suit /lore et l'interrupteur du MJ (surveiller_bible).
    bible_joueurs = asyncio.create_task(bible_api.surveiller_bible())
    # La file des demandes des joueurs (boite.py) : appliquer, recompter la boîte, prévenir l'atelier et Telegram.
    file_des_demandes = asyncio.create_task(commandes_api.boite.surveiller())
    # Les mains levées et la présence des joueurs (salle.py) : le Tableau et la télécommande les voient aussitôt.
    mains_levees = asyncio.create_task(commandes_api.salle.surveiller())
    # La table du coin des joueurs : republiée de secours, pour ce qui change sans passer par la TV (table_joueurs.py).
    table_du_coin = asyncio.create_task(tv_etat.table_coin.veiller())
    # L'aide à l'écriture des joueurs (aide_mj.py) : une à la fois pour toute la tablée, au quota du mois.
    aide_ecriture = asyncio.create_task(commandes_api.aides_joueurs.ouvrier())
    # Les billets privés (prives_mj.py) : leur publication suit ses sources, une lecture se voit chez le MJ dans la seconde.
    prives_des_joueurs = asyncio.create_task(tv_fiches.billets_prives.surveiller())
    # Les jets à distance (jets_mj.py) : la fiche de jet de chaque héros, publiée pour le coin quand ses sources changent.
    fiches_de_jet = asyncio.create_task(actions_coin.jets_mj.veiller())
    # Les portraits des joueurs (portraits_mj.py, lot P) : publiés pour le coin quand les fiches ou les joueurs changent.
    portraits_du_coin = asyncio.create_task(actions_coin.portraits_joueurs.veiller())
    # Le pointeur d'un joueur, posé sur la table du coin, paraît sur le plan ou la carte du MJ (pointeurs_mj.py).
    pointeurs_des_joueurs = asyncio.create_task(actions_coin.pointeurs_des_joueurs.veiller())
    yield
    pointeurs_des_joueurs.cancel()
    portraits_du_coin.cancel()
    surveillance.cancel()
    publication.cancel()
    bible_joueurs.cancel()
    file_des_demandes.cancel()
    mains_levees.cancel()
    table_du_coin.cancel()
    aide_ecriture.cancel()
    prives_des_joueurs.cancel()
    fiches_de_jet.cancel()


# Ni /docs ni /openapi.json : l'atelier n'a pas à décrire son API à qui passe.
app = FastAPI(title="L'Arrière-salle", lifespan=cycle, docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/static", StaticFiles(directory=config.ICI / "static"), name="static")
app.mount("/media", medias_legers.MediasLegers(directory=config.IMAGES), name="media")


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import portier, utilitaires, heros_etat, carnet_api, commandes_api, bible_api, tv_fiches, tv_etat, actions_coin, ia_api  # noqa: E402
