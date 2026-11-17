"""Chantiers, activités, jets et portraits : ce que la boîte des demandes branche côté atelier."""

import asyncio
import time

from fastapi import HTTPException, Request

from commun import demandes
from commun import table_joueurs
from contenu import sanctuaire
from coin_mj import sanctuaire_joueurs
from coin_mj.activites_mj import ActivitesMJ
from coin_mj.etat_joueur_mj import EtatJoueurMJ
from coin_mj.jets_mj import JetsMJ
from coin_mj.portraits_mj import PortraitsMJ
from coin_mj.pointeurs_mj import PointeursJoueurs, VersLeCoin

from api.application import app
from api import config, utilitaires, heros_etat, joueurs_mj, carnet_api, commandes_api, tv_cartes, refuge


chantiers = sanctuaire_joueurs.Chantiers(
    lire=lambda: refuge.lire_sanctuaire(), empreinte=refuge.empreinte_du_sanctuaire, verser=refuge.verser_au_sanctuaire, ouvrir=refuge.ouvrir_chantier, jeton=tv_cartes.jeton,
    heros_du_joueur=lambda ident: carnet_api.heros_du_joueur(ident), sac_de=heros_etat.sac_de, candidats=lambda: noms_caches.secrets_des_joueurs(),
    publier_heros=lambda ids: carnet_api.publier_heros(ids), publier_section=lambda: refuge.publier_sanctuaire_au_carnet(),
    noter_seance=refuge.noter_a_la_seance, annoncer=refuge.annoncer_sanctuaire, signaler=commandes_api.signaler_sacs)
chantiers.brancher(commandes_api.boite)


# Les activités entre les séances (lot D, activites.py, activites_mj.py, jets.py) : le catalogue du MJ (onglet Auberge), le
# dé jeté par l'atelier quand la boîte voit la demande, la section « activites » du carnet, et l'or validé dans la boîte,
# vers la bourse (route du sac) ou une cagnotte (verser_don).

def heros_par_id(ident: str) -> dict | None:
    try:
        return utilitaires.lire_fiche(utilitaires.existant(config.AVENTURIERS, ident))
    except HTTPException:
        return None


activites_mj = ActivitesMJ(
    config.DONNEES, config.PROPOSITIONS, jeton=tv_cartes.jeton, seances=refuge.seances_de_la_campagne, prochaine=lambda: tv_etat.prochaine_seance(),
    heros_du_joueur=lambda ident: carnet_api.heros_du_joueur(ident), lire_heros=heros_par_id, sac_de=heros_etat.sac_de, changer_sacs=heros_etat.changer_les_sacs,
    verser_don=refuge.verser_don, lire_sanctuaire=lambda: refuge.lire_sanctuaire(), prochain_niveau=sanctuaire.prochain,
    candidats=lambda: noms_caches.secrets_des_joueurs(), noms_secrets=carnet_api.noms_secrets, nettoyer_mot=commandes_api.mot_pour_le_coin, carnet_ouvert=lambda: carnet_api.carnet_ouvert(),
    archiver=lambda chemin: utilitaires.archiver(chemin, "activites"), publier_heros=lambda ids: carnet_api.publier_heros(ids),
    publier_sanctuaire=lambda: refuge.publier_sanctuaire_au_carnet(), noter_seance=refuge.noter_a_la_seance, annoncer_sanctuaire=refuge.annoncer_sanctuaire,
    signaler=commandes_api.signaler_sacs, cartons=lambda ident: (heros_etat.etats_heros().get(ident) or {}).get("cartons") or {})
activites_mj.brancher(commandes_api.boite)
app.include_router(activites_mj.routes(utilitaires.corps_objet))


async def jet_a_la_tv(message: dict) -> None:
    """Le bandeau d'un jet, vers les écrans qui voient ce que le MJ envoie : le salon, Internet si la table publique est
    ouverte, et la table du coin des joueurs si elle est ouverte. Rien ne s'écrit dans l'état de la table."""
    ecrans = set(tv_etat.diffusion.salon)
    if tv_etat.diffusion.internet and tv_etat.table_publique()["ouverte"]:
        ecrans |= tv_etat.diffusion.internet
    if ecrans:
        await tv_etat.diffusion.envoyer(ecrans, message)
    # La table du coin des joueurs (lot du 12/11) : le même message, pour que chacun voie le jet des autres sur sa page
    # Table. Écrit seulement table du coin ouverte ; un échec ne retient pas le bandeau de la TV.
    if tv_etat.reglage_table_joueurs()["ouverte"]:
        try:
            await asyncio.to_thread(table_joueurs.ajouter_jet, config.PROPOSITIONS, message)
        except Exception:
            config.journal.exception("Jet non publié à la table du coin")


def sources_des_jets() -> list:
    """Ce dont la fiche de jet dépend : les fiches, l'état des héros, les combats (la posture), les joueurs et leurs héros
    accueillis, le réglage de la table du coin, la pause, et ce que les joueurs ne savent pas (PNJ et lieux)."""
    return [*config.AVENTURIERS.glob("*.json"), *config.SEANCES.glob("*.json"), *config.PNJ.glob("*.json"), *config.LIEUX.glob("*.json"),
            *config.PROPOSITIONS.glob("*.json"), heros_etat.ETATS_HEROS, config.JOUEURS, tv_etat.TABLE_JOUEURS, config.PROPOSITIONS / demandes.DOSSIER / demandes.PAUSE]


async def reserve_a_la_tv() -> None:
    """Les réserves des dés d'aventure ont changé : la TV (et la table publique) relisent l'état public."""
    await tv_etat.diffusion.diffuser(tv_ecran.etat_table())


jets_mj = JetsMJ(config.PROPOSITIONS, config.DONNEES, joueurs_lus=joueurs_mj.joueurs_lus, heros_des_joueurs=lambda: carnet_api.heros_des_joueurs(),
                 etats_heros=lambda: heros_etat.etats_heros(), postures=lambda: heros_etat.postures_au_combat(), candidats=lambda: noms_caches.secrets_des_joueurs(),
                 table_ouverte=lambda: tv_etat.reglage_table_joueurs()["ouverte"], sources=sources_des_jets, envoyer_tv=jet_a_la_tv,
                 signaler=commandes_api.signaler_demandes, au_combat=lambda: heros_etat.heros_au_combat(), depenser_jeton=heros_etat.jeton_depense,
                 jetons_changes=heros_etat.suites_des_joueurs, reserve_tv=reserve_a_la_tv)
jets_mj.brancher(commandes_api.boite)
app.include_router(jets_mj.routes(utilitaires.corps_objet))


# L'état de son héros réglé par le joueur depuis la table du coin (etat_joueur.py, etat_joueur_mj.py, 11/11) : Santé, Psy
# et posture, appliqués seuls par la boîte, en combat (dans le combat) comme hors combat (heros_etat.change_par_son_joueur).

async def etat_joueur_dit(message: dict) -> None:
    """La ligne d'un geste de joueur (« Camille : Santé d'Aldo 9 → 7 ») aux pages de l'atelier, jamais à la TV."""
    await tv_etat.diffusion.vers_atelier(message)


async def suites_de_l_etat_joueur() -> None:
    await heros_etat.suites_des_joueurs()
    # La fiche de jet porte la Santé, la Psy et la posture que lit la page du joueur : republiée sans attendre son tour.
    await asyncio.to_thread(jets_mj.publier)


etat_joueur_mj = EtatJoueurMJ(config.DONNEES, heros_des_joueurs=lambda: carnet_api.heros_des_joueurs(),
                              table_ouverte=lambda: tv_etat.reglage_table_joueurs()["ouverte"], changer=heros_etat.change_par_son_joueur,
                              suites=suites_de_l_etat_joueur, dire=etat_joueur_dit)
etat_joueur_mj.brancher(commandes_api.boite)


async def portraits_a_la_tv(ids: set) -> None:
    """Un portrait changé depuis le coin : le carton du héros se relit s'il est à l'écran ; la tablée, les fiches et le
    plan (ses pions portent les portraits) aussi. Puis le carnet (« Mon héros », la compagnie), sans attendre son tour."""
    etat = tv_ecran.etat_table()
    if etat.get("aventurier") in ids:
        etat["aventurier_maj"] = int(time.time() * 1000)
        etat["maj"] = time.time()
        utilitaires.ecrire(config.TABLE, etat)
        await tv_etat.diffusion.diffuser(etat)
    elif etat.get("vue") in ("heros", "fiches", "plan"):
        await tv_etat.diffusion.diffuser(etat)
    try:
        await asyncio.to_thread(carnet_api.publier_carnet)
    except Exception:
        config.journal.exception("Carnet des joueurs non republié après un portrait")


portraits_joueurs = PortraitsMJ(
    config.PROPOSITIONS, config.DONNEES, config.IMAGES, joueurs_lus=joueurs_mj.joueurs_lus, heros_des_joueurs=lambda: carnet_api.heros_des_joueurs(),
    chemin_heros=lambda ident: utilitaires.existant(config.AVENTURIERS, ident), lire=utilitaires.lire_fiche, ecrire=utilitaires.ecrire, verrou=heros_etat.SAC_VERROU,
    media_existant=utilitaires.media_existant, url_publique=tv_cartes.url_publique, a_la_tv=portraits_a_la_tv,
    sources=lambda: [*config.AVENTURIERS.glob("*.json"), *config.PROPOSITIONS.glob("*.json"), config.JOUEURS, config.PROPOSITIONS / ".acces.json"])
portraits_joueurs.brancher(commandes_api.boite)
app.include_router(portraits_joueurs.routes())


# Les pointeurs de la table (pointeurs_mj.py, lot du 13/11) : le pointeur du MJ et sa règle vers la page Table du coin
# (table du coin ouverte seulement), et le pointeur d'un joueur vers le plan ou la carte du MJ, à la couleur de son héros.
pointeurs_vers_le_coin = VersLeCoin(config.PROPOSITIONS, table_ouverte=lambda: tv_etat.reglage_table_joueurs()["ouverte"])


def ce_que_montre_la_tv(genre: str, jeton: str) -> str | None:
    """L'identifiant du plan (ou de la carte) que la TV montre, si ce jeton est le sien ; sinon rien : un pointeur qui
    vise autre chose n'est pas montré."""
    etat = tv_ecran.etat_table()
    ident = etat.get(genre) if etat.get("vue") == genre else None
    if not isinstance(ident, str) or not config.ID_VALIDE.match(ident):
        return None
    return ident if tv_cartes.jeton(tv_boutique_combat.REFS_TABLE[genre], ident) == jeton else None


pointeurs_des_joueurs = PointeursJoueurs(
    config.PROPOSITIONS, joueurs_lus=joueurs_mj.joueurs_lus, heros_des_joueurs=lambda: carnet_api.heros_des_joueurs(),
    couleurs=lambda: tv_fiches.couleurs_de_la_tv(), resoudre=ce_que_montre_la_tv, signaler=lambda m: tv_etat.diffusion.vers_atelier(m))


@app.get("/api/table/sanctuaire")
def table_sanctuaire(requete: Request):
    # Depuis Internet (table publique), le sanctuaire ne se lit que quand la TV le montre : avant, il dévoilerait la suite.
    if portier.acces_table_seule(requete.headers) and tv_ecran.etat_table().get("vue") != "sanctuaire":
        raise HTTPException(404, "Introuvable")
    return tv_cartes.reponse_publique(sanctuaire.sanctuaire_public(refuge.lire_sanctuaire()))


# Modules qui se servent les uns des autres seulement à l'appel d'une route : importés ici, une fois les définitions
# posées, pour ne pas former de cycle au chargement.
from api import portier, noms_caches, tv_etat, tv_ecran, tv_fiches, tv_boutique_combat  # noqa: E402
